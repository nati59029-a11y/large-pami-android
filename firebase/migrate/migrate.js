#!/usr/bin/env node
'use strict';
// כלי העברת הנתונים של לארג' פעמי לעסק הראשון במבנה ריבוי העסקים (שלב 4, משימה 2026-11-05).
// הוראות מלאות: README.md. מסמך חזרה: ROLLBACK.md.
//
// עקרונות:
//  - ברירת המחדל: קריאה בלבד (readonly). כתיבה רק עם --mode write.
//  - המקור (האוספים בשורש) לא נמחק ולא מתעדכן לעולם. הכתיבה רק ליעד b/<bizId>/..., למסמך העסק b/<bizId>,
//    וליצירה (בלבד) של users/<uid> חדשים. ראו ההגנות ב-fsrest.js.
//  - מסמך יעד שכבר קיים לא נדרס. שינוי בשני הצדדים = "התנגשות", מדווח ולא נכתב.
//  - בלי אמולטור (FIRESTORE_EMULATOR_HOST), חובה לעבור את בדיקת השומר (guard.js) באמצעות משתני סביבה.
//
// פקודות:
//   backup          גיבוי כל האוספים בשורש לקובץ JSON (--out)
//   dry-run         ספירה של מה שההעתקה תעשה, בלי לכתוב כלום
//   copy            העתקה / השלמה (אותה פקודה; בפעם הראשונה הכול חדש). דורש --mode write, --state, --backup
//   verify          השוואת ספירה וגיבוב לכל אוסף, מקור מול יעד, וקבצי Storage
//   compare-backup  השוואה מלאה של המקור (השורש) לקובץ גיבוי
//   report-since    דוח: מה נכתב ב-b/<bizId> מאז ההעתקה האחרונה (לפי קובץ המצב). לא כותב
//   set-dataroot    שינוי b/<bizId>.dataRoot ל-legacy או b (חזרה / מעבר). דורש --mode write

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { FsRest, scanTree, hashFields, MISSING, pmap } = require('./fsrest');
const { checkGuard, fromEnv, bucketBelongs } = require('./guard');

// firebase-admin שכבר מותקן בפונקציות השרת (בלי להוסיף תלות)
const requireFromFunctions = createRequire(path.join(__dirname, '..', 'functions', 'package.json'));

// ---- רשימות האוספים (לפי המיפוי של שלב 1, תוצרים/עזר/1-מיפוי-מלא.md סעיף ט, וחוקי השורש) ----
const COPY = [
  'admins', 'staff', 'cfg', 'bk', 'chunks', 'inbox', 'app_backup_status',
  'shelf', 'fb', 'tasks', 'supinv', 'appreq', 'closings', 'cashout', 'deposits', 'zlast',
  'yemot_items', 'yemot_line_backups', 'yemot_hook_usage', 'yemot_lexicon',
  'yemot_promos', 'yemot_state', 'yemot_usage', 'yemot_test', 'voice_usage', 'scan_usage',
  'audit_log', 'table_bases', // אוספים שנמצאו בבדיקה 7.11 – הועברו בהחלטת המשתמש
  'ord', 'prod', 'stockLog', 'ordcfg', 'ordpay', 'private', // הזמנות שלב 1 (2026-11-08): לארג' פעמי ב-legacy כותב לשורש, באותם שמות כמו ב-b/{bizId}
];
// הזמנות אתר: נדחה לסבב נפרד (לפי התוכנית). מגובים, לא מועתקים.
const DEFERRED = [
  'site_income_daily', 'products', 'categories', 'settings', 'product_costs', 'wholesale_prices', 'photo_jobs',
  'customers', 'orders', 'invoices', 'wholesale_terms', 'payments', 'notifications', 'product_requests',
  'inspirations', 'event_types', 'quantity_rules', 'recognition_jobs', 'promotions', 'coupons', 'credits',
  'credit_rules', 'ai_usage', 'faqs', 'recipes', 'ai_conversations', 'staging_items',
];
// אוספים חדשים של ריבוי העסקים: לא מקור להעתקה. b לא נכלל אפילו בגיבוי (זה היעד)
const NEW_ROOT = ['users', 'superadmins'];
const FEATURES = ['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'];
const STORAGE_PREFIX = 'app_backups/';
// העסק היחיד שמותר להעתיק אליו (לארג' פעמי). עסק אחר = סירוב, כדי שטעות הקלדה לא תחשוף את הנתונים לעסק זר
const MIGRATION_BIZ = 'largpeami';
// גיבוי לפני ההעברה נשמר ב-bucket הפרטי של הפרויקט, בתיקייה הזו בלבד (יצירה בלבד, אף פעם לא דריסה)
const BACKUP_PREFIX = 'migrate_backups/';

// קבצים שהכלי כותב (גיבוי, מצב, דוח) אסורים בתוך תיקיית מאגר git: הם מכילים נתונים כספיים
function assertOutsideRepo(file) {
  let dir = path.dirname(path.resolve(file));
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) throw new Error('אסור לכתוב את ' + file + ' בתוך מאגר git (' + dir + '). כתבו לתיקייה זמנית מחוץ למאגר, למשל /tmp/lp-migrate/');
    const up = path.dirname(dir);
    if (up === dir) return;
    dir = up;
  }
}

// ---- פרמטרים ----
function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      o[k] = v;
    } else o._.push(a);
  }
  return o;
}

function log(...a) { console.log(...a); }

function writeJsonAtomic(file, obj) {
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 1));
  fs.renameSync(tmp, file);
}

// ---- סביבה: אמולטור או פרויקט אמיתי (עם שומר) ----
function setup(args) {
  const project = args.project || process.env.MIGRATE_PROJECT;
  const bizId = args.biz || 'largpeami';
  const mode = args.mode || 'readonly';
  if (!/^[a-z0-9-]{3,30}$/.test(bizId)) throw new Error('מזהה עסק לא תקין: ' + bizId);
  if (mode !== 'readonly' && mode !== 'write') throw new Error('מצב לא מוכר: ' + mode);
  const emu = process.env.FIRESTORE_EMULATOR_HOST;
  const noStorage = !!args['no-storage'];
  const bucketName = args.bucket || process.env.MIGRATE_BUCKET || (emu && project ? project + '.appspot.com' : '');
  for (const k of ['out', 'state', 'report']) if (args[k] && args[k] !== 'true') assertOutsideRepo(args[k]);
  if (emu) {
    if (!/^demo-/.test(project || '')) throw new Error('באמולטור מותר רק פרויקט demo-*');
    // Storage חייב להיות מופנה גם הוא לאמולטור, אחרת firebase-admin היה פונה ל-bucket אמיתי בלי שומר
    if (!noStorage && !process.env.FIREBASE_STORAGE_EMULATOR_HOST && !process.env.STORAGE_EMULATOR_HOST) {
      throw new Error('מצב אמולטור בלי FIREBASE_STORAGE_EMULATOR_HOST: Storage היה פונה לענן. הגדירו אותו, או הוסיפו --no-storage');
    }
    if (!noStorage && !bucketBelongs(bucketName, project)) throw new Error('באמולטור ה-bucket חייב להיות של פרויקט הדמו (' + project + '.*), לא "' + bucketName + '"');
  } else {
    // פרויקט אמיתי: השומר חייב לעבור (כולל ה-bucket), והמצב שלו חייב להתאים למצב המבוקש
    if (!noStorage && !bucketName) throw new Error('חסר --bucket (שם ה-bucket של Storage בפרויקט)');
    const g = checkGuard({ ...fromEnv(), project, bucket: noStorage ? undefined : bucketName });
    if (!g.ok) throw new Error('השומר נכשל:\n - ' + g.errors.join('\n - '));
    if (mode === 'write' && g.mode !== 'write') throw new Error('מצב כתיבה לא אושר בשומר');
  }
  let tokenFn;
  if (emu) tokenFn = async () => 'owner';
  else {
    const { applicationDefault } = requireFromFunctions('firebase-admin/app');
    const cred = applicationDefault();
    let cached = null;
    tokenFn = async () => {
      if (!cached || cached.exp < Date.now() + 60000) {
        const t = await cred.getAccessToken();
        cached = { tok: t.access_token, exp: Date.now() + (t.expires_in || 3000) * 1000 };
      }
      return cached.tok;
    };
  }
  const fsr = new FsRest({ project, mode, bizId, token: tokenFn, emulatorHost: emu });
  return { project, bizId, mode, fsr, emu, args, bucketName };
}

let bucketCache = null;
function bucket(ctx) {
  if (bucketCache) return bucketCache;
  if (ctx.args['no-storage']) throw new Error('--no-storage: אין גישה ל-Storage');
  const name = ctx.bucketName;
  if (!bucketBelongs(name, ctx.project)) throw new Error('bucket לא שייך לפרויקט: ' + name);
  const { initializeApp, getApps } = requireFromFunctions('firebase-admin/app');
  const { getStorage } = requireFromFunctions('firebase-admin/storage');
  const app = getApps().find(a => a.name === 'migrate') || initializeApp({ projectId: ctx.project, storageBucket: name }, 'migrate');
  bucketCache = getStorage(app).bucket(name);
  return bucketCache;
}

async function listStorage(ctx, prefix) {
  const [files] = await bucket(ctx).getFiles({ prefix });
  return files.map(f => ({ name: f.name, size: Number(f.metadata.size), md5: f.metadata.md5Hash, contentType: f.metadata.contentType }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---- סיכומים ----
function topColl(rel) { return rel.split('/')[0]; }
function collSummary(map, colls) {
  const by = {};
  for (const c of colls) by[c] = [];
  for (const [rel, d] of map) { const c = topColl(rel); if (by[c]) by[c].push(rel + '\t' + d.hash); }
  const out = {};
  for (const c of colls) {
    const lines = by[c].sort();
    out[c] = {
      count: lines.length,
      countMissing: lines.filter(l => l.endsWith('\t' + MISSING)).length,
      hash: crypto.createHash('sha256').update(lines.join('\n')).digest('hex'),
    };
  }
  return out;
}

function classify(c) {
  if (COPY.includes(c)) return 'copy';
  if (DEFERRED.includes(c)) return 'deferred';
  if (NEW_ROOT.includes(c)) return 'new';
  return 'unknown';
}

async function rootCollections(ctx) {
  return (await ctx.fsr.listCollectionIds('')).filter(c => c !== 'b');
}

// ---- 1. גיבוי ----
async function cmdBackup(ctx) {
  const out = ctx.args.out;
  if (!out) throw new Error('חסר --out (קובץ הגיבוי)');
  if (fs.existsSync(out)) throw new Error('קובץ הגיבוי כבר קיים, לא דורסים: ' + out);
  const takenAt = new Date().toISOString();
  const colls = await rootCollections(ctx);
  const map = await scanTree(ctx.fsr, '', colls);
  const docs = {};
  for (const [rel, d] of [...map].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    docs[rel] = d.missing ? { missing: true, hash: MISSING } : { hash: d.hash, updateTime: d.updateTime, fields: d.fields };
  }
  const sum = collSummary(map, colls);
  const collections = {};
  for (const c of colls) collections[c] = { ...sum[c], plan: classify(c) };
  let storage = [];
  try { storage = await listStorage(ctx, STORAGE_PREFIX); } catch (e) { if (!ctx.args['no-storage']) throw e; }
  const backup = { kind: 'lp-migrate-backup', version: 1, project: ctx.project, takenAt, collections, docs, storage };
  writeJsonAtomic(out, backup);
  // בדיקת סיבוב מלא: קוראים את הקובץ שנכתב ומחשבים מחדש את הגיבוב של כל מסמך
  const back = JSON.parse(fs.readFileSync(out, 'utf8'));
  let bad = 0;
  for (const [rel, d] of Object.entries(back.docs)) if (!d.missing && hashFields(d.fields) !== map.get(rel).hash) bad++;
  if (bad) throw new Error('בדיקת סיבוב של קובץ הגיבוי נכשלה: ' + bad + ' מסמכים');
  log(`גיבוי: ${Object.keys(docs).length} מסמכים ב-${colls.length} אוספים, ${storage.length} קבצי Storage → ${out}`);
  for (const c of colls) log(`  ${c}: ${collections[c].count} (${collections[c].plan}) ${collections[c].hash.slice(0, 16)}`);
  log('בדיקת סיבוב של קובץ הגיבוי: עברה (כל הגיבובים זהים אחרי קריאה חוזרת)');
  // שמירה ב-bucket הפרטי של הפרויקט (ברירת המחדל בתהליך הידני). יצירה בלבד, בשם ייחודי, אף פעם לא דריסה
  let uploaded = null;
  if (ctx.args.upload) {
    const tag = String(ctx.args['upload-tag'] || 'local').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'local';
    const dest = BACKUP_PREFIX + takenAt.replace(/[:.]/g, '-') + '_' + tag + '/backup.json';
    const f = bucket(ctx).file(dest);
    const [exists] = await f.exists();
    if (exists) throw new Error('קובץ גיבוי עם אותו שם כבר קיים ב-bucket, לא נדרס: ' + dest);
    await f.save(fs.readFileSync(out), { contentType: 'application/json', resumable: false, preconditionOpts: { ifGenerationMatch: 0 } });
    const [m] = await f.getMetadata();
    if (Number(m.size) !== fs.statSync(out).size) throw new Error('גודל קובץ הגיבוי ב-bucket לא תואם');
    uploaded = 'gs://' + ctx.bucketName + '/' + dest;
    log('הגיבוי נשמר ב-bucket הפרטי של הפרויקט: ' + uploaded);
  }
  const unknown = colls.filter(c => classify(c) === 'unknown');
  if (unknown.length) log('אוספים לא ידועים (מגובים, לא מועתקים, דורש החלטה): ' + unknown.join(', '));
  return { ok: true, docs: Object.keys(docs).length, collections, unknown, uploaded };
}

// ---- 2/3/5. תכנון והעתקה ----
function loadState(ctx, file, mustExist) {
  if (!file) throw new Error('חסר --state (קובץ המצב של ההעתקה)');
  if (!fs.existsSync(file)) {
    if (mustExist) throw new Error('קובץ מצב לא נמצא: ' + file);
    return { kind: 'lp-migrate-state', version: 1, project: ctx.project, bizId: ctx.bizId, runs: [], docs: {}, storage: {} };
  }
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (s.kind !== 'lp-migrate-state' || s.project !== ctx.project || s.bizId !== ctx.bizId) throw new Error('קובץ המצב שייך לפרויקט או לעסק אחר');
  return s;
}

// אוספים בשורש שלא מועתקים (נדחים / לא ידועים), עם מספר המסמכים בהם (רמה עליונה)
async function otherColls(ctx, colls) {
  const out = [];
  for (const c of colls) {
    const k = classify(c);
    if (k !== 'unknown' && k !== 'deferred') continue;
    const docs = await ctx.fsr.listDocuments(c);
    out.push({ coll: c, plan: k, count: docs.length });
  }
  return out;
}
function printOther(list, ack) {
  for (const o of list) {
    if (o.plan === 'deferred') log(`  נדחה (מגובה, לא מועתק): ${o.coll} – ${o.count} מסמכים`);
    else log(`  !!! אוסף לא ידוע (לא מועתק${ack.includes(o.coll) ? ', אושר ב---ack-unknown' : ', דורש החלטה'}): ${o.coll} – ${o.count} מסמכים`);
  }
}
const ackList = ctx => String(ctx.args['ack-unknown'] || '').split(',').map(x => x.trim()).filter(Boolean);

// העתקה ושינוי dataRoot מותרים רק לעסק ההעברה, ורק אם מסמך העסק (אם קיים) נוצר על ידי הכלי ומסומן כיעד ההעברה
function assertMigrationTarget(ctx, bizDoc, needLegacy) {
  if (ctx.bizId !== MIGRATION_BIZ) throw new Error(`כתיבה מותרת רק לעסק ההעברה "${MIGRATION_BIZ}", לא ל-"${ctx.bizId}"`);
  if (!bizDoc) return;
  const f = bizDoc.fields || {};
  const sv = k => (f[k] && f[k].stringValue) || '';
  if (!(f.migrationTarget && f.migrationTarget.booleanValue === true) || sv('createdBy') !== 'migrate') {
    throw new Error(`מסמך העסק b/${ctx.bizId} קיים ולא נוצר על ידי כלי ההעברה (חסר migrationTarget:true או createdBy:migrate). לא נוגעים בו`);
  }
  if (needLegacy && sv('dataRoot') !== 'legacy') throw new Error(`b/${ctx.bizId}.dataRoot הוא "${sv('dataRoot')}", לא legacy. העתקה/השלמה רק לפני המעבר (ראו ROLLBACK.md)`);
}

// מה צריך להיות ב-users/{uid} לכל חבר, באותו מבנה ש-syncLegacyMember (שרת, business.js) כותב:
// role: admin למי שב-admins, אחרת worker. active: מנהל = true, עובד = staff.active === true.
// email: של admins, אחרת של staff, אחרת ''. (bizId, bizStatus ו-createdAt במילישניות נוספים בכתיבה)
function expectedPeople(src) {
  const people = new Map();
  const str = (f, k) => (f && f[k] && typeof f[k].stringValue === 'string' ? f[k].stringValue : '');
  for (const [r, d] of src) {
    if (!/^staff\/[^/]+$/.test(r) || d.missing) continue;
    people.set(r.split('/')[1], { role: 'worker', active: !!(d.fields.active && d.fields.active.booleanValue === true), email: str(d.fields, 'email') });
  }
  for (const [r, d] of src) {
    if (!/^admins\/[^/]+$/.test(r) || d.missing) continue;
    const uid = r.split('/')[1], prev = people.get(uid);
    people.set(uid, { role: 'admin', active: true, email: str(d.fields, 'email') || (prev && prev.email) || '' });
  }
  return people;
}

async function plan(ctx, state) {
  const colls = await rootCollections(ctx);
  const copyColls = colls.filter(c => classify(c) === 'copy');
  const src = await scanTree(ctx.fsr, '', copyColls);
  const dst = await scanTree(ctx.fsr, 'b/' + ctx.bizId, copyColls);
  const P = { create: [], update: [], same: [], adopt: [], conflict: [], targetOnlyChanged: [], deletedInSource: [], newInTarget: [] };
  const keys = new Set([...src.keys(), ...Object.keys(state.docs)]);
  for (const rel of [...keys].sort()) {
    const s = src.get(rel), t = dst.get(rel), st = state.docs[rel];
    if (!s) { if (st) P.deletedInSource.push({ rel }); continue; }
    if (s.missing) continue; // אב "ריק": נוצר לבד מהתת-אוסף
    if (!st) {
      if (!t || t.missing) P.create.push({ rel, s });
      else if (t.hash === s.hash) P.adopt.push({ rel, s, t });
      else P.conflict.push({ rel, why: 'קיים ביעד עם תוכן אחר (לפני העתקה ראשונה)', src: s.hash, dst: t.hash });
      continue;
    }
    const srcCh = s.hash !== st.src;
    const dstCh = !t || t.missing ? true : t.hash !== st.dst;
    if (!srcCh && !dstCh) P.same.push({ rel });
    else if (srcCh && !dstCh) P.update.push({ rel, s, t });
    else if (!srcCh && dstCh) P.targetOnlyChanged.push({ rel, dst: t && !t.missing ? t.hash : 'נמחק ביעד' });
    else if (t && !t.missing && t.hash === s.hash) P.adopt.push({ rel, s, t });
    else P.conflict.push({ rel, why: 'השתנה גם במקור וגם ביעד', src: s.hash, dst: t && !t.missing ? t.hash : 'נמחק ביעד' });
  }
  for (const [rel, t] of dst) if (!t.missing && !src.has(rel) && !state.docs[rel]) P.newInTarget.push({ rel });
  // users/{uid} לכל מנהל ועובד
  const people = expectedPeople(src);
  const U = { create: [], same: [], conflict: [] };
  await pmap([...people.keys()].sort(), 16, async uid => {
    const p = people.get(uid);
    const cur = await ctx.fsr.getDoc('users/' + uid);
    if (!cur) { U.create.push({ uid, ...p }); return; }
    const cb = cur.fields.bizId && cur.fields.bizId.stringValue, cr = cur.fields.role && cur.fields.role.stringValue;
    if (cb === ctx.bizId && cr === p.role) U.same.push({ uid });
    else U.conflict.push({ uid, why: `קיים עם bizId=${cb} role=${cr}, לא נדרס` });
  });
  const bizDoc = await ctx.fsr.getDoc('b/' + ctx.bizId);
  const other = await otherColls(ctx, colls);
  // Storage
  const S = { create: [], same: [], conflict: [] };
  if (!ctx.args['no-storage']) {
    const sFiles = await listStorage(ctx, STORAGE_PREFIX);
    const dFiles = new Map((await listStorage(ctx, 'b/' + ctx.bizId + '/' + STORAGE_PREFIX)).map(f => [f.name, f]));
    for (const f of sFiles) {
      const to = 'b/' + ctx.bizId + '/' + f.name;
      const d = dFiles.get(to);
      if (!d) S.create.push({ from: f.name, to, size: f.size, md5: f.md5 });
      else if (d.md5 === f.md5 && d.size === f.size) S.same.push({ from: f.name, to, md5: f.md5 });
      else S.conflict.push({ from: f.name, to, src: f.md5, dst: d.md5, why: 'קובץ היעד שונה, לא נדרס' });
    }
  }
  return { P, U, S, bizDoc, src, dst, colls, copyColls, other };
}

function printPlan(pl, ctx, title) {
  const { P, U, S, bizDoc } = pl;
  log(`${title} (עסק ${ctx.bizId}, פרויקט ${ctx.project}):`);
  log(`  מסמכים: ייווצרו ${P.create.length}, יעודכנו (השלמה) ${P.update.length}, ללא שינוי ${P.same.length}, זהים כבר ${P.adopt.length}, התנגשויות ${P.conflict.length}`);
  log(`  השתנו רק ביעד ${P.targetOnlyChanged.length}, נמחקו במקור ${P.deletedInSource.length}, חדשים ביעד ${P.newInTarget.length}`);
  log(`  users: ייווצרו ${U.create.length}, קיימים ותואמים ${U.same.length}, התנגשויות ${U.conflict.length}`);
  log(`  מסמך העסק b/${ctx.bizId}: ${bizDoc ? 'קיים, לא נדרס' : 'ייווצר (dataRoot: legacy)'}`);
  log(`  Storage: ייווצרו ${S.create.length}, זהים ${S.same.length}, התנגשויות ${S.conflict.length}`);
  const byColl = {};
  for (const x of P.create) byColl[topColl(x.rel)] = (byColl[topColl(x.rel)] || 0) + 1;
  if (Object.keys(byColl).length) log('  ייווצרו לפי אוסף: ' + Object.entries(byColl).map(([c, n]) => c + '=' + n).join(', '));
  for (const c of P.conflict) log(`  התנגשות: ${c.rel} – ${c.why} (מקור ${String(c.src).slice(0, 12)}, יעד ${String(c.dst).slice(0, 12)})`);
  for (const c of U.conflict) log(`  התנגשות users/${c.uid}: ${c.why}`);
  for (const c of S.conflict) log(`  התנגשות Storage ${c.to}: ${c.why}`);
  printOther(pl.other, ackList(ctx));
}

function planSummary(pl) {
  const n = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.length]));
  return { docs: n(pl.P), users: n(pl.U), storage: n(pl.S), bizDocExists: !!pl.bizDoc, conflicts: pl.P.conflict.map(({ rel, why, src, dst }) => ({ rel, why, src, dst })), userConflicts: pl.U.conflict, storageConflicts: pl.S.conflict, other: pl.other, targetOnlyChanged: pl.P.targetOnlyChanged, deletedInSource: pl.P.deletedInSource, newInTarget: pl.P.newInTarget };
}

async function cmdDryRun(ctx) {
  const state = ctx.args.state && fs.existsSync(ctx.args.state) ? loadState(ctx, ctx.args.state, true) : loadState(ctx, ctx.args.state || '-', false);
  const pl = await plan(ctx, state);
  printPlan(pl, ctx, 'dry-run (לא נכתב כלום)');
  return { ok: true, ...planSummary(pl) };
}

function bizDocFields(ctx) {
  const now = new Date().toISOString();
  const name = ctx.args['biz-name'] || "לארג' פעמי";
  return {
    name: { stringValue: name },
    status: { stringValue: 'active' },
    dataRoot: { stringValue: 'legacy' },
    schemaVersion: { integerValue: '1' },
    createdAt: { timestampValue: now },
    createdBy: { stringValue: 'migrate' },
    migrationTarget: { booleanValue: true },
    features: { mapValue: { fields: Object.fromEntries(FEATURES.map(k => [k, { booleanValue: true }])) } },
  };
}

async function cmdCopy(ctx) {
  if (ctx.mode !== 'write') throw new Error('copy דורש --mode write. לספירה בלבד: dry-run');
  if (!ctx.args.backup || !fs.existsSync(ctx.args.backup)) throw new Error('copy דורש --backup עם קובץ גיבוי קיים (מריצים backup קודם)');
  const bk = JSON.parse(fs.readFileSync(ctx.args.backup, 'utf8'));
  if (bk.kind !== 'lp-migrate-backup' || bk.project !== ctx.project) throw new Error('קובץ הגיבוי לא שייך לפרויקט הזה');
  assertMigrationTarget(ctx, await ctx.fsr.getDoc('b/' + ctx.bizId), true);
  const stateFile = ctx.args.state;
  const state = loadState(ctx, stateFile, false);
  // נעילה: שתי העתקות במקביל אסורות
  const lock = stateFile + '.lock';
  let fd;
  try { fd = fs.openSync(lock, 'wx'); } catch (e) { throw new Error('העתקה אחרת רצה (או נעצרה באמצע). קובץ נעילה: ' + lock); }
  fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
  fs.closeSync(fd);
  try {
    const startedAt = new Date().toISOString();
    const pl = await plan(ctx, state);
    assertMigrationTarget(ctx, pl.bizDoc, true);
    printPlan(pl, ctx, 'העתקה');
    const { P, U, S } = pl;
    // מסמכים קיימים שזהים: נרשמים במצב בלי כתיבה
    for (const x of P.adopt) state.docs[x.rel] = { src: x.s.hash, dst: x.t.hash, dstUpdateTime: x.t.updateTime };
    const writes = [
      ...P.create.map(x => ({ path: 'b/' + ctx.bizId + '/' + x.rel, fields: x.s.fields, kind: 'create', rel: x.rel, hash: x.s.hash })),
      ...P.update.map(x => ({ path: 'b/' + ctx.bizId + '/' + x.rel, fields: x.s.fields, kind: 'update', updateTime: x.t.updateTime, rel: x.rel, hash: x.s.hash })),
    ];
    const failed = [];
    const res = await ctx.fsr.writeDocs(writes);
    res.forEach((r, i) => {
      const w = writes[i];
      if (r.ok) state.docs[w.rel] = { src: w.hash, dst: w.hash, dstUpdateTime: r.updateTime };
      else failed.push({ rel: w.rel, error: r.error });
    });
    // users/{uid}: יצירה בלבד
    const nowMs = String(Date.now());
    // bizStatus = הסטטוס של מסמך העסק (כמו בשרת). מסמך חדש נוצר עם active
    const bizStatus = (pl.bizDoc && pl.bizDoc.fields.status && pl.bizDoc.fields.status.stringValue) || 'active';
    const uw = U.create.map(p => ({
      path: 'users/' + p.uid, kind: 'create', fields: {
        bizId: { stringValue: ctx.bizId }, role: { stringValue: p.role }, email: { stringValue: p.email },
        createdAt: { integerValue: nowMs }, active: { booleanValue: p.active }, bizStatus: { stringValue: bizStatus },
      },
    }));
    const ur = await ctx.fsr.writeDocs(uw);
    ur.forEach((r, i) => { if (!r.ok) failed.push({ rel: uw[i].path, error: r.error }); });
    // מסמך העסק: רק אם לא קיים
    if (!pl.bizDoc) {
      const [br] = await ctx.fsr.writeDocs([{ path: 'b/' + ctx.bizId, kind: 'create', fields: bizDocFields(ctx) }]);
      if (!br.ok) failed.push({ rel: 'b/' + ctx.bizId, error: br.error });
    }
    // Storage: יצירה בלבד (ifGenerationMatch: 0 בענן; באמולטור נבדק קודם שהיעד לא קיים)
    for (const f of S.create) {
      try {
        const bk2 = bucket(ctx);
        const [exists] = await bk2.file(f.to).exists();
        if (exists) { failed.push({ rel: f.to, error: 'קובץ יעד נוצר בינתיים, לא נדרס' }); continue; }
        await bk2.file(f.from).copy(bk2.file(f.to), { preconditionOpts: { ifGenerationMatch: 0 } });
        const [m] = await bk2.file(f.to).getMetadata();
        if (m.md5Hash !== f.md5) failed.push({ rel: f.to, error: 'md5 לא תואם אחרי העתקה' });
        state.storage[f.from] = { to: f.to, md5: m.md5Hash, size: Number(m.size) };
      } catch (e) { failed.push({ rel: f.to, error: String(e.message || e) }); }
    }
    for (const f of S.same) state.storage[f.from] = { to: f.to, md5: f.md5 };
    state.runs.push({ startedAt, endedAt: new Date().toISOString(), created: P.create.length, updated: P.update.length, conflicts: P.conflict.length, failed: failed.length });
    state.lastCopyAt = startedAt;
    writeJsonAtomic(stateFile, state);
    log(`נכתבו ${ctx.fsr.stats.writes} מסמכים (כולל users ומסמך העסק). כשלים: ${failed.length}. התנגשויות: ${P.conflict.length + U.conflict.length + S.conflict.length}`);
    for (const f of failed) log('  כשל: ' + f.rel + ' – ' + f.error);
    return { ok: failed.length === 0, writes: ctx.fsr.stats.writes, failed, ...planSummary(pl) };
  } finally {
    fs.unlinkSync(lock); // קובץ הנעילה המקומי של ההרצה הזו בלבד
  }
}

// ---- 4. אימות ----
async function cmdVerify(ctx) {
  const all = await rootCollections(ctx);
  const colls = all.filter(c => classify(c) === 'copy');
  const src = await scanTree(ctx.fsr, '', colls);
  const dst = await scanTree(ctx.fsr, 'b/' + ctx.bizId, colls);
  const a = collSummary(src, colls), b = collSummary(dst, colls);
  const diffs = [];
  // אימות שלא בדק כלום = נכשל
  const problems = [];
  if (!colls.length) problems.push('לא נמצא במקור אף אוסף מהרשימה להעתקה');
  if (!src.size) problems.push('נמצאו 0 מסמכים במקור');
  const other = await otherColls(ctx, all);
  const ack = ackList(ctx);
  for (const o of other) if (o.plan === 'unknown' && o.count > 0 && !ack.includes(o.coll)) problems.push(`אוסף לא ידוע עם ${o.count} מסמכים לא הועתק: ${o.coll}`);
  log(`אימות: מקור (שורש) מול יעד (b/${ctx.bizId}), ${colls.length} אוספים`);
  for (const c of colls) {
    const eq = a[c].count === b[c].count && a[c].hash === b[c].hash;
    log(`  ${eq ? 'שווה ' : 'שונה '} ${c}: מקור ${a[c].count} ${a[c].hash.slice(0, 16)} | יעד ${b[c].count} ${b[c].hash.slice(0, 16)}`);
    if (!eq) diffs.push(c);
  }
  const docDiffs = [];
  for (const [rel, s] of src) { const t = dst.get(rel); if (!t || t.hash !== s.hash) docDiffs.push({ rel, src: s.hash, dst: t ? t.hash : 'חסר' }); }
  for (const [rel, t] of dst) if (!src.has(rel)) docDiffs.push({ rel, src: 'חסר', dst: t.hash });
  for (const d of docDiffs.slice(0, 50)) log(`  הבדל: ${d.rel} (מקור ${d.src.slice(0, 12)}, יעד ${d.dst.slice(0, 12)})`);
  let storage = null;
  if (!ctx.args['no-storage']) {
    const s = await listStorage(ctx, STORAGE_PREFIX), t = await listStorage(ctx, 'b/' + ctx.bizId + '/' + STORAGE_PREFIX);
    const tm = new Map(t.map(f => [f.name, f]));
    const miss = s.filter(f => { const x = tm.get('b/' + ctx.bizId + '/' + f.name); return !x || x.md5 !== f.md5 || x.size !== f.size; });
    const sum = l => l.reduce((n, f) => n + f.size, 0);
    storage = { srcCount: s.length, srcBytes: sum(s), dstCount: t.length, dstBytes: sum(t), mismatched: miss.map(f => f.name) };
    log(`  Storage: מקור ${s.length} קבצים / ${sum(s)} בתים | יעד ${t.length} קבצים / ${sum(t)} בתים | שונים/חסרים ${miss.length}`);
  }
  printOther(other, ack);
  // users/{uid} לכל מנהל ועובד, ומסמך העסק
  // לכל מסמך ב-admins וב-staff בשורש: users/{uid} תואם (bizId, role, active, bizStatus, createdAt במילישניות)
  const bizDoc = await ctx.fsr.getDoc('b/' + ctx.bizId);
  const wantStatus = (bizDoc && bizDoc.fields.status && bizDoc.fields.status.stringValue) || 'active';
  const expect = expectedPeople(src);
  const badUsers = [];
  await pmap([...expect.keys()], 16, async uid => {
    const e = expect.get(uid);
    const u = await ctx.fsr.getDoc('users/' + uid);
    const f = (u && u.fields) || {};
    const why = [];
    if (!u) why.push('חסר');
    else {
      if ((f.bizId || {}).stringValue !== ctx.bizId) why.push('bizId=' + (f.bizId || {}).stringValue);
      if ((f.role || {}).stringValue !== e.role) why.push('role=' + (f.role || {}).stringValue + ' (צפוי ' + e.role + ')');
      if ((f.active || {}).booleanValue !== e.active) why.push('active=' + (f.active || {}).booleanValue + ' (צפוי ' + e.active + ')');
      if ((f.bizStatus || {}).stringValue !== wantStatus) why.push('bizStatus=' + (f.bizStatus || {}).stringValue);
      if (!f.createdAt || !/^\d+$/.test(String(f.createdAt.integerValue || ''))) why.push('createdAt לא במילישניות');
    }
    if (why.length) badUsers.push(uid + ': ' + why.join(', '));
  });
  const people = [...expect.keys()];
  if (badUsers.length) problems.push(`users לא תואם ל-admins/staff: ${badUsers.sort().join('; ')}`);
  if (!bizDoc) problems.push(`מסמך העסק b/${ctx.bizId} לא קיים`);
  log(`  users: ${people.length - badUsers.length}/${people.length} תואמים ל-admins/staff. מסמך העסק: ${bizDoc ? 'קיים, dataRoot=' + ((bizDoc.fields.dataRoot || {}).stringValue) : 'חסר'}`);
  for (const p of problems) log('  בעיה: ' + p);
  const ok = !problems.length && !diffs.length && !docDiffs.length && (!storage || !storage.mismatched.length);
  log(ok ? 'אימות: עבר – הספירה והגיבוב של כל אוסף זהים במקור וביעד' : `אימות: נכשל – ${diffs.length} אוספים, ${docDiffs.length} מסמכים שונים, ${problems.length} בעיות`);
  return { ok, collections: Object.fromEntries(colls.map(c => [c, { src: a[c], dst: b[c] }])), docDiffs, storage, problems, other, srcDocs: src.size };
}

// ---- השוואת המקור לגיבוי ----
// --backup <קובץ מקומי> או --backup-gcs <נתיב בתוך migrate_backups/ ב-bucket של הפרויקט>
async function loadBackup(ctx) {
  let txt;
  if (ctx.args['backup-gcs']) {
    const p = String(ctx.args['backup-gcs']).replace(/^gs:\/\/[^/]+\//, '');
    if (!p.startsWith(BACKUP_PREFIX) || p.includes('..')) throw new Error('--backup-gcs חייב להיות בתוך ' + BACKUP_PREFIX);
    [txt] = await bucket(ctx).file(p).download();
    txt = txt.toString('utf8');
  } else if (ctx.args.backup && fs.existsSync(ctx.args.backup)) txt = fs.readFileSync(ctx.args.backup, 'utf8');
  else throw new Error('חסר --backup (קובץ קיים) או --backup-gcs');
  const bk = JSON.parse(txt);
  if (bk.kind !== 'lp-migrate-backup' || bk.project !== ctx.project) throw new Error('קובץ הגיבוי לא שייך לפרויקט הזה');
  return bk;
}
async function cmdCompareBackup(ctx) {
  const bk = await loadBackup(ctx);
  // users ו-superadmins הם אוספים חדשים שהכלי והשרת כותבים אליהם: לא חלק מ"המקור" שמושווה
  const colls = Object.keys(bk.collections).filter(c => !NEW_ROOT.includes(c));
  bk.docs = Object.fromEntries(Object.entries(bk.docs).filter(([rel]) => !NEW_ROOT.includes(topColl(rel)))); // סינון בזיכרון בלבד
  const now = await rootCollections(ctx);
  const map = await scanTree(ctx.fsr, '', colls);
  const diffs = [];
  for (const [rel, d] of Object.entries(bk.docs)) {
    const c = map.get(rel);
    if (!c) diffs.push({ rel, why: 'חסר עכשיו' });
    else if (c.hash !== d.hash) diffs.push({ rel, why: 'תוכן שונה' });
    else if (!d.missing && hashFields(d.fields) !== d.hash) diffs.push({ rel, why: 'קובץ הגיבוי פגום' });
  }
  for (const rel of map.keys()) if (!bk.docs[rel]) diffs.push({ rel, why: 'נוסף אחרי הגיבוי' });
  const newColls = now.filter(c => !colls.includes(c) && !NEW_ROOT.includes(c));
  log(`השוואה לגיבוי מ-${bk.takenAt}: ${Object.keys(bk.docs).length} מסמכים בגיבוי, ${map.size} עכשיו, הבדלים ${diffs.length}`);
  for (const d of diffs.slice(0, 50)) log(`  ${d.rel}: ${d.why}`);
  if (newColls.length) log('  אוספים חדשים בשורש מאז הגיבוי (לא נכללים בהשוואה): ' + newColls.join(', '));
  log(diffs.length ? 'המקור שונה מהגיבוי' : 'המקור זהה לחלוטין לגיבוי');
  return { ok: diffs.length === 0, diffs, backupDocs: Object.keys(bk.docs).length, nowDocs: map.size, newColls };
}

// ---- 6. דוח לחזרה: מה נכתב ב-b/ מאז ההעתקה האחרונה ----
async function cmdReportSince(ctx) {
  const state = loadState(ctx, ctx.args.state, true);
  const colls = await ctx.fsr.listCollectionIds('b/' + ctx.bizId);
  const dst = await scanTree(ctx.fsr, 'b/' + ctx.bizId, colls);
  const changed = [], added = [], removed = [];
  for (const [rel, t] of dst) {
    if (t.missing) continue;
    const st = state.docs[rel];
    if (!st) added.push({ rel, updateTime: t.updateTime, coll: topColl(rel) });
    else if (st.dst !== t.hash) changed.push({ rel, updateTime: t.updateTime, coll: topColl(rel) });
  }
  for (const rel of Object.keys(state.docs)) { const t = dst.get(rel); if (!t || t.missing) removed.push({ rel }); }
  let storageNew = [];
  if (!ctx.args['no-storage']) {
    const known = new Set(Object.values(state.storage).map(x => x.to));
    storageNew = (await listStorage(ctx, 'b/' + ctx.bizId + '/')).filter(f => !known.has(f.name)).map(f => ({ name: f.name, size: f.size }));
  }
  log(`דוח מאז ההעתקה האחרונה (${state.lastCopyAt}) ב-b/${ctx.bizId}: חדשים ${added.length}, שונו ${changed.length}, נעלמו ${removed.length}, קבצי Storage חדשים ${storageNew.length}`);
  for (const x of [...added.map(a => ['חדש', a]), ...changed.map(a => ['שונה', a])].slice(0, 200)) log(`  ${x[0]}: ${x[1].rel} (${x[1].updateTime})`);
  for (const x of removed.slice(0, 200)) log(`  נעלם: ${x.rel}`);
  for (const f of storageNew.slice(0, 200)) log(`  קובץ חדש: ${f.name}`);
  log('הדוח לא משנה דבר. ההחלטה מה להחזיר לשורש – של המשתמש (ראו ROLLBACK.md).');
  return { ok: true, since: state.lastCopyAt, added, changed, removed, storageNew };
}

// ---- מעבר / חזרה: dataRoot ----
async function cmdSetDataRoot(ctx) {
  const to = ctx.args.to;
  if (to !== 'legacy' && to !== 'b') throw new Error('--to חייב להיות legacy או b');
  if (ctx.mode !== 'write') throw new Error('set-dataroot דורש --mode write');
  const cur = await ctx.fsr.getDoc('b/' + ctx.bizId);
  if (!cur) throw new Error('מסמך העסק b/' + ctx.bizId + ' לא קיים');
  assertMigrationTarget(ctx, cur, false);
  const before = cur.fields.dataRoot && cur.fields.dataRoot.stringValue;
  const [r] = await ctx.fsr.writeDocs([{ path: 'b/' + ctx.bizId, kind: 'setField', fieldPaths: ['dataRoot'], fields: { dataRoot: { stringValue: to } } }]);
  if (!r.ok) throw new Error('הכתיבה נכשלה: ' + r.error);
  log(`dataRoot של b/${ctx.bizId}: ${before} ← ${to}`);
  return { ok: true, before, after: to };
}

const COMMANDS = { backup: cmdBackup, 'dry-run': cmdDryRun, copy: cmdCopy, verify: cmdVerify, 'compare-backup': cmdCompareBackup, 'report-since': cmdReportSince, 'set-dataroot': cmdSetDataRoot };

async function main(argv) {
  const args = parseArgs(argv);
  const cmd = args._[0];
  if (!COMMANDS[cmd]) {
    console.error('פקודה לא מוכרת. אפשרויות: ' + Object.keys(COMMANDS).join(', ') + '. ראו README.md');
    return 2;
  }
  const ctx = setup(args);
  log(`== ${cmd} | פרויקט ${ctx.project} | עסק ${ctx.bizId} | מצב ${ctx.mode} | ${ctx.emu ? 'אמולטור ' + ctx.emu : 'פרויקט אמיתי'}`);
  const r = await COMMANDS[cmd](ctx);
  if (args.report) writeJsonAtomic(args.report, { cmd, at: new Date().toISOString(), project: ctx.project, bizId: ctx.bizId, mode: ctx.mode, reads: ctx.fsr.stats.reads, ...r });
  log(`קריאות: ${ctx.fsr.stats.reads}, כתיבות: ${ctx.fsr.stats.writes}`);
  return r.ok ? 0 : 1;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, e => { console.error('שגיאה: ' + (e && e.message ? e.message : e)); process.exitCode = 1; });
}

module.exports = { main, COPY, DEFERRED, FEATURES, classify };
