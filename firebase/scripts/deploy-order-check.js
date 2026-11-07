'use strict';
// 6ז: בדיקת הסדר המחייב לפני פרסום ידני (עדכון חוזה 8א): פונקציות ← העברה (users) ← firestore.rules ← storage.rules.
// רץ בתהליך "Deploy Firebase (manual)" לפני הפרסום. קורא בלבד, לא כותב כלום.
// מדפיס רק ספירות ושמות פונקציות – לא מזהי משתמשים, לא מיילים ולא תוכן חוקים.
// שימוש: node scripts/deploy-order-check.js <firestore-rules|storage-rules> <project>
// דורש GOOGLE_APPLICATION_CREDENTIALS (קובץ זמני של חשבון השירות), ו-DEPLOYED_FUNCTIONS (רשימת שמות מ-functions:list, מופרדים בפסיק).
const fs = require('fs');
const path = require('path');
const target = process.argv[2];
const project = process.argv[3];
const fail = (m) => { console.error('::error::' + m); process.exit(1); };
if (!['firestore-rules', 'storage-rules'].includes(target) || !/^[a-z0-9-]+$/.test(project || '')) fail('usage');

const fnDir = path.join(__dirname, '..', 'functions');
const admin = require(path.join(fnDir, 'node_modules', 'firebase-admin'));

async function token() {
  const t = await admin.credential.applicationDefault().getAccessToken();
  return t.access_token;
}
async function deployedRules(release) {
  const h = { Authorization: 'Bearer ' + await token() };
  const base = 'https://firebaserules.googleapis.com/v1/';
  const r = await fetch(`${base}projects/${project}/releases/${release}`, { headers: h });
  if (r.status === 404) return null;
  if (!r.ok) fail(`Rules API (release) HTTP ${r.status}`);
  const rel = await r.json();
  const s = await fetch(base + rel.rulesetName, { headers: h });
  if (!s.ok) fail(`Rules API (ruleset) HTTP ${s.status}`);
  const files = ((await s.json()).source || {}).files || [];
  return files.map((f) => f.content || '').join('\n');
}
const norm = (s) => String(s || '').replace(/\r\n/g, '\n').trim();

(async () => {
  // 1. כל הפונקציות שהקוד מייצא כבר פרוסות (צעד 1).
  const exported = Object.keys(require(path.join(fnDir, 'index.js'))).sort();
  const deployed = new Set(String(process.env.DEPLOYED_FUNCTIONS || '').split(',').map((x) => x.trim()).filter(Boolean));
  const missing = exported.filter((n) => !deployed.has(n));
  if (missing.length) fail(`צעד 1 לא הושלם: ${missing.length} פונקציות לא פרוסות בפרויקט: ${missing.join(', ')}`);
  console.log(`צעד 1: ${exported.length}/${exported.length} פונקציות פרוסות.`);

  // 2. ההעברה יצרה users לכל מנהל ועובד בשורש (צעד 2). ספירה בלבד.
  admin.initializeApp({ projectId: project });
  const db = admin.firestore();
  const ids = async (c) => (await db.collection(c).select().get()).docs.map((d) => d.id);
  const members = new Set([...(await ids('admins')), ...(await ids('staff'))]);
  const users = new Set(await ids('users'));
  const noUser = [...members].filter((u) => !users.has(u)).length;
  if (noUser) fail(`צעד 2 לא הושלם: ל-${noUser} מתוך ${members.size} חברים בשורש אין מסמך users. מריצים קודם את ההעברה (copy).`);
  console.log(`צעד 2: users קיים לכל ${members.size} החברים בשורש.`);

  // 3. לפני storage.rules: firestore.rules שפרוס זהה לקובץ בענף (צעד 3, החלק הראשון).
  if (target === 'storage-rules') {
    const live = await deployedRules('cloud.firestore');
    const mine = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
    if (norm(live) !== norm(mine)) fail('firestore.rules הפרוס שונה מהקובץ בענף. מפרסמים קודם את firestore.rules, ורק אחריו את storage.rules.');
    console.log('צעד 3: firestore.rules הפרוס זהה לקובץ בענף.');
  }
  console.log('הסדר המחייב תקין. אפשר לפרסם: ' + target);
})().catch((e) => fail('בדיקת הסדר נכשלה: ' + (e && e.code ? e.code : 'error')));
