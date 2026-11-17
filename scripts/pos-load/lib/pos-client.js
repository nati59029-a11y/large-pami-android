'use strict';
// בוחר מול מה רצות הבדיקות:
//   POS_IMPL=ref (ברירת מחדל) – מימוש הייחוס (lib/pos-sale-ref.js) ישירות מול אמולטור Firestore. רץ כבר עכשיו.
//   POS_IMPL=fn               – פונקציית השרת האמיתית (סשן ז') דרך אמולטור הפונקציות. ⏳ ירוץ רק אחרי המיזוג של פונקציות הקופה.
//                               דורש: FUNCTIONS_EMULATOR_HOST, FIREBASE_AUTH_EMULATOR_HOST, ושם הפונקציה ב-POS_FN (ברירת מחדל posSale).
//                               במצב הזה מספר הקריאות/כתיבות לא נמדד מבפנים – הדוח מסמן אותו כהערכה לפי מימוש הייחוס.

const { posSale, counter } = require('./pos-sale-ref');
const { target, BIZ } = require('./env');

function refClient(db) {
  return { kind: 'ref', send: (sale, ops, opt) => posSale(db, sale, ops, opt), measuresOps: true };
}

async function fnClient() {
  const fnHost = process.env.FUNCTIONS_EMULATOR_HOST;
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (!fnHost || !authHost) throw new Error('POS_IMPL=fn דורש FUNCTIONS_EMULATOR_HOST ו-FIREBASE_AUTH_EMULATOR_HOST (אמולטור בלבד)');
  const project = target().project;
  const name = process.env.POS_FN || 'posSale';
  const region = process.env.POS_REGION || 'us-central1';
  // משתמש דמו באמולטור ההזדהות. ההרשאות שלו (עובד בסניף) נקבעות לפי users/{uid} – ראו README, "אחרי המיזוג".
  const email = 'pos-load-demo@example.com';
  const pw = 'demo-only-123456';
  const base = `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts`;
  let r = await fetch(`${base}:signUp?key=demo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: pw, returnSecureToken: true }) });
  if (!r.ok) r = await fetch(`${base}:signInWithPassword?key=demo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: pw, returnSecureToken: true }) });
  const { idToken } = await r.json();
  const url = `http://${fnHost}/${project}/${region}/${name}`;
  return {
    kind: 'fn', measuresOps: false,
    send: async (sale) => {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + idToken }, body: JSON.stringify({ data: Object.assign({ biz: BIZ }, sale) }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) throw new Error(`${name}: ${res.status} ${JSON.stringify(j.error || j).slice(0, 200)}`);
      return j.result;
    },
  };
}

async function client(db) {
  return (process.env.POS_IMPL || 'ref') === 'fn' ? fnClient() : refClient(db);
}

module.exports = { client, counter };
