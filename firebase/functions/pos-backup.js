'use strict';
// POS:M7 – קופה, ש7: גיבוי ושחזור (17.11.2026). אפיון ד O10–O12, "פתוח" 9–10.
//   posBackup({ op:'list' })                    → { items:[{id,at,kind,ok,n,size}], lastExt, canRun, canRestore } – מנהל
//   posBackup({ op:'now' })                     → { id, n, size } – לפי bkManual ('mgr' = מנהל, 'owner' = בעל העסק בלבד)
//   posBackup({ op:'restore', id, confirm:'שחזור' }) → { n, skipped } – לפי restoreBy ('owner' = בעל העסק בלבד; מנהל־על לא, אלא אם הוא בעלים).
//        לפני שחזור – גיבוי אוטומטי של המצב הנוכחי (kind:'pre').
//        משחזרים רק הגדרות: poscfg/main, promo, clubcfg. מכירות, תשלומים, משמרות, מסמכים ויומנים לא נדרסים ולא נמחקים לעולם
//        (מסמך כספי לא נמחק – אפיון סופי 1.7). מסמך שנוסף אחרי הגיבוי באוספים האלה נשאר (skipped).
//   posBackupDaily (מתוזמן, כל לילה 02:40): גיבוי 'auto' לכל עסק עם קופה. ב-1 לחודש (bkExt:'monthly') או ביום א' (bkExt:'weekly') – גם עותק 'month'
//        שנשמר retainYears שנים (ברירת מחדל 7, לא מאומת). גיבויי 'auto' ו-'pre' נשמרים 35 יום. כשלון → posbk ok:false + התראה לבעלים (bkAlert).
// הקובץ: כל אוספי הקופה (רק מסמכים ברמה העליונה של כל אוסף), JSON → gzip → AES-256-GCM. המפתח נגזר מ-BACKUP_MASTER_KEY לכל עסק
//   (HKDF, lib/backupKey.js, מזהה 'pos:'+bizId). נשמר ב-Storage: {prefix}pos_backups/{id}.lpbk. האינדקס: posbk/{id} (רק השרת כותב, מנהל קורא).
// "גרסה לנקודת זמן" מלאה (כולל מכירות) – שחזור Firestore לנקודת זמן (PITR) בקונסולה, בידי המפתח ובאישור בעל העסק. עלות – לא מאומת.

const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret, defineString } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const { getStorage } = require('firebase-admin/storage');
const { onCall, LEGACY_REGION } = require('./lib/region');
const { inputObject } = require('./lib/roles');
const T = require('./lib/tenant');
const { deriveBackupKey } = require('./lib/backupKey');
const OPS = require('./pos-ops')._core;

const BACKUP_MASTER_KEY = defineSecret('BACKUP_MASTER_KEY');
const BACKUP_BUCKET = defineString('BACKUP_BUCKET', { default: '', description: 'שם ה-bucket של הגיבויים ב-Storage. ריק = ברירת המחדל של הפרויקט' });

// כל אוספי הקופה (אפיון סופי פרק 3 + שלב 0). אוסף חדש של מודול אחר – מוסיפים כאן שורה.
const COLLS = ['possale', 'pospay', 'posret', 'posshift', 'posz', 'posdev', 'poscfg', 'poslog', 'posgift', 'posgiftlog', 'posclock', 'posimp', 'posreq',
  'poserr', 'posconf', 'promo', 'clubcfg', 'clublog', 'pos_income_daily'];
// מה משוחזר: הגדרות בלבד
const RESTORE = { poscfg: ['main'], promo: null, clubcfg: null };
const KEEP_DAYS = 35;
const MAGIC = Buffer.from('LPBK1');
const ID_RE = /^b[0-9]{13}[a-z]{0,2}$/;
const deny = (reason, msg) => new HttpsError('permission-denied', msg, { reason });
const pre = (reason, msg) => new HttpsError('failed-precondition', msg, { reason });
const bad = (reason, msg) => new HttpsError('invalid-argument', msg, { reason });
const nf = (reason, msg) => new HttpsError('not-found', msg, { reason });

function masterKey() {
  let v = '';
  try { v = BACKUP_MASTER_KEY.value(); } catch (e) { v = ''; }
  if (!v && process.env.FUNCTIONS_EMULATOR === 'true') v = process.env.POS_TEST_BK_KEY || '';
  return v;
}
const keyOf = (bizId) => deriveBackupKey(masterKey(), 'pos:' + bizId);
const bucket = () => { const n = BACKUP_BUCKET.value(); return n ? getStorage().bucket(n) : getStorage().bucket(); };

// Timestamp / GeoPoint / Bytes של Firestore → JSON עם סימון, וחזרה
function enc(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(enc);
  if (typeof v.toMillis === 'function' && typeof v.toDate === 'function') return { $ts: v.toMillis() };
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return { $b: Buffer.from(v).toString('base64') };
  const o = {};
  for (const k of Object.keys(v)) o[k] = enc(v[k]);
  return o;
}
function decv(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(decv);
  if (Object.keys(v).length === 1 && typeof v.$ts === 'number') { const { Timestamp } = require('firebase-admin/firestore'); return Timestamp.fromMillis(v.$ts); }
  if (Object.keys(v).length === 1 && typeof v.$b === 'string') return Buffer.from(v.$b, 'base64');
  const o = {};
  for (const k of Object.keys(v)) o[k] = decv(v[k]);
  return o;
}
function seal(obj, key) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(zlib.gzipSync(Buffer.from(JSON.stringify(obj), 'utf8'))), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), body]);
}
function open(buf, key) {
  if (!Buffer.isBuffer(buf) || buf.length < 33 || !buf.subarray(0, 5).equals(MAGIC)) throw new Error('bad backup file');
  const iv = buf.subarray(5, 17), tag = buf.subarray(17, 33), body = buf.subarray(33);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return JSON.parse(zlib.gunzipSync(Buffer.concat([d.update(body), d.final()])).toString('utf8'));
}
async function dump(db) {
  const out = {}, cnt = {};
  for (const c of COLLS) {
    out[c] = {};
    let last = null, n = 0;
    for (;;) {
      let q = db.collection(c).orderBy('__name__').limit(1000);
      if (last) q = q.startAfter(last);
      const s = await q.get();
      for (const d of s.docs) { out[c][d.id] = enc(d.data()); n++; }
      if (s.size < 1000) break;
      last = s.docs[s.docs.length - 1];
    }
    cnt[c] = n;
  }
  return { data: out, cnt };
}
const newId = (now) => 'b' + String(now).padStart(13, '0');

// גיבוי אחד. kind: 'auto' | 'manual' | 'month' | 'pre'. כשלון – נרשם ב-posbk עם ok:false וזורק הלאה
async function backupOnce(db, ctx, kind, by, now) {
  now = now || Date.now();
  let id = newId(now);
  if ((await db.doc('posbk/' + id).get()).exists) id += kind === 'pre' ? 'p' : kind === 'month' ? 'm' : 'x';
  const ref = db.doc('posbk/' + id);
  try {
    const { data, cnt } = await dump(db);
    const n = Object.values(cnt).reduce((a, b) => a + b, 0);
    const file = seal({ v: 1, biz: ctx.bizId, at: now, kind, data }, keyOf(ctx.bizId));
    const path = ctx.prefix + 'pos_backups/' + id + '.lpbk';
    await bucket().file(path).save(file, { resumable: false, contentType: 'application/octet-stream', metadata: { cacheControl: 'private, no-store' } });
    await ref.set({ at: now, kind, by: by || 'auto', ok: true, n, size: file.length, path, cnt });
    if (kind === 'month') await db.doc('posbk/meta').set({ lastExt: now }, { merge: true });
    return { id, n, size: file.length };
  } catch (e) {
    await ref.set({ at: now, kind, by: by || 'auto', ok: false, err: String(e && (e.reason || e.code || e.name) || 'error').slice(0, 60) }).catch(() => {});
    throw e;
  }
}
async function restoreOnce(db, ctx, id, who) {
  const s = await db.doc('posbk/' + id).get();
  if (!s.exists) throw nf('no-backup', 'הגיבוי לא נמצא');
  if (s.get('ok') !== true || typeof s.get('path') !== 'string') throw pre('bad-backup', 'הגיבוי הזה לא הצליח ואי אפשר לשחזר ממנו');
  const [buf] = await bucket().file(s.get('path')).download();
  const obj = open(buf, keyOf(ctx.bizId));
  if (obj.biz !== ctx.bizId) throw pre('bad-backup', 'הגיבוי שייך לעסק אחר');
  await backupOnce(db, ctx, 'pre', who.uid);
  let n = 0;
  const skipped = {};
  for (const [c, only] of Object.entries(RESTORE)) {
    const docs = (obj.data && obj.data[c]) || {};
    const ids = Object.keys(docs).filter((d) => !only || only.includes(d));
    for (let i = 0; i < ids.length; i += 400) {
      const b = db.batch();
      for (const d of ids.slice(i, i + 400)) { b.set(db.doc(c + '/' + d), decv(docs[d])); n++; }
      await b.commit();
    }
    const now = await db.collection(c).select().get();
    skipped[c] = now.docs.filter((d) => !(d.id in docs) && (!only || only.includes(d.id))).length;
  }
  await db.collection('poslog').doc().set({ kind: 'restore', id, by: who.uid, n, at: Date.now() });
  await db.collection('audit').doc().set({ by: who.uid, t: Date.now(), act: 'posRestore', note: id });
  return { ok: true, n, skipped };
}

async function canRun(db, who, cfg) { return cfg.bkManual === 'owner' ? OPS.isOwner(db, who) : who.role === 'manager'; }
async function canRestore(db, who, cfg) { return cfg.restoreBy === 'mgr' ? who.role === 'manager' : OPS.isOwner(db, who); }

async function bk(request) {
  const input = inputObject(request);
  const op = input.op;
  if (!['list', 'now', 'restore'].includes(op)) throw bad('bad-op', 'פעולה לא מוכרת');
  const { who, db } = await OPS.gate(request, { mgr: true });
  const cfg = await OPS.cfgOf(db);
  const ctx = { bizId: who.bizId, prefix: who.prefix };
  if (op === 'list') {
    const [s, meta] = await Promise.all([db.collection('posbk').orderBy('at', 'desc').limit(60).get(), db.doc('posbk/meta').get()]);
    const items = s.docs.filter((d) => ID_RE.test(d.id)).map((d) => ({ id: d.id, at: d.get('at'), kind: d.get('kind'), ok: d.get('ok') === true, n: d.get('n') || 0, size: d.get('size') || 0 }));
    return { ok: true, items, lastExt: meta.exists ? meta.get('lastExt') || 0 : 0, canRun: await canRun(db, who, cfg), canRestore: await canRestore(db, who, cfg) };
  }
  if (op === 'now') {
    if (!(await canRun(db, who, cfg))) throw deny('not-owner', 'גיבוי ידני – רק בעל העסק');
    return Object.assign({ ok: true }, await backupOnce(db, ctx, 'manual', who.uid));
  }
  if (!(await canRestore(db, who, cfg))) throw deny('not-owner', 'שחזור – רק בעל העסק');
  if (typeof input.id !== 'string' || !ID_RE.test(input.id)) throw bad('bad-input', 'קלט לא תקין');
  if (input.confirm !== 'שחזור') throw bad('no-confirm', 'חסר אישור שני');
  return restoreOnce(db, ctx, input.id, who);
}

// ---------- לילה: גיבוי, עותק חודשי, ניקוי ----------
async function nightBiz(db, ctx, now, opts) {
  const cfg = await OPS.cfgOf(db);
  const d = new Date(now + 2 * 3600e3); // שעון ישראל בקירוב – רק לבחירת היום
  const ext = cfg.bkExt === 'monthly' ? d.getUTCDate() === 1 : cfg.bkExt === 'weekly' ? d.getUTCDay() === 0 : false;
  const res = { auto: null, month: null, del: 0 };
  try {
    res.auto = await backupOnce(db, ctx, 'auto', 'auto', now);
    if (ext) res.month = await backupOnce(db, ctx, 'month', 'auto', now + 1);
  } catch (e) {
    logger.error('pos-backup: failed', { bizId: ctx.bizId, name: e && e.name, reason: e && e.reason });
    const to = Array.isArray(cfg.bkAlert) && cfg.bkAlert.includes('owner') ? await OPS.ownerUids(db) : [];
    if (to.length && opts && opts.alert) await opts.alert(db, to, { id: 'bk' + now, title: 'גיבוי הקופה נכשל', body: 'הגיבוי הלילי של הקופה לא הצליח. אפשר ללחוץ "גבה עכשיו" באזור הניהול ← תפעול.' });
    res.err = true;
  }
  // ניקוי: auto/pre אחרי 35 יום, month אחרי retainYears שנים. רק הקובץ והאינדקס של הגיבוי – לא נתוני הקופה
  const years = Number.isInteger(cfg.retainYears) ? cfg.retainYears : 7;
  const old = await db.collection('posbk').where('at', '<', now - KEEP_DAYS * 864e5).limit(200).get();
  for (const x of old.docs) {
    if (!ID_RE.test(x.id)) continue;
    const k = x.get('kind');
    if (k === 'month' && x.get('at') > now - years * 365 * 864e5) continue;
    if (k === 'manual' && x.get('at') > now - 365 * 864e5) continue;
    if (x.get('path')) await bucket().file(x.get('path')).delete().catch(() => {});
    await x.ref.delete();
    res.del++;
  }
  return res;
}
async function nightAll(opts) {
  const now = Date.now();
  const out = {};
  for (const biz of await T.bizzesWith('pos')) {
    const prefix = T.bizPrefix(biz);
    if (!prefix) continue;
    try { out[biz.bizId] = await T.runInBiz({ bizId: biz.bizId, prefix, biz }, () => nightBiz(T.tdb(), { bizId: biz.bizId, prefix }, now, opts)); } catch (e) { logger.warn('pos-backup: night failed', { bizId: biz.bizId, name: e && e.name }); }
  }
  return out;
}
async function alertPush(db, uids, msg) {
  const RM = require('./secretary-remind')._core;
  const { getMessaging } = require('firebase-admin/messaging');
  for (const u of uids.slice(0, 20)) {
    try {
      const toks = await RM.tokensOf(db, u);
      if (toks.length) await getMessaging().sendEachForMulticast({ tokens: toks, notification: { title: msg.title, body: msg.body }, data: { k: 'pos', id: String(msg.id) }, android: RM.androidOf('pos_' + msg.id) });
    } catch (e) { logger.warn('pos-backup: alert failed', { name: e && e.name }); }
  }
}

const wrap = (name, fn) => T.scoped(async (request) => {
  try { return await fn(request); } catch (e) {
    if (e instanceof HttpsError) throw e;
    logger.error(`pos-backup: ${name} failed`, { name: e && e.name, code: e && e.code, reason: e && e.reason });
    if (e && e.reason === 'master-key-missing') throw pre('master-key-missing', 'מפתח הגיבוי בשרת לא מוגדר');
    throw new HttpsError('internal', 'שגיאה בפעולה. נסו שוב.', { reason: 'internal' });
  }
});

exports.posBackup = onCall({ secrets: [BACKUP_MASTER_KEY], timeoutSeconds: 300, memory: '512MiB' }, wrap('posBackup', bk));
exports.posBackupDaily = onSchedule({ region: LEGACY_REGION, schedule: '40 2 * * *', timeZone: 'Asia/Jerusalem', timeoutSeconds: 540, memory: '1GiB', secrets: [BACKUP_MASTER_KEY] },
  async () => { await nightAll({ alert: alertPush }); });

Object.defineProperty(exports, '_core', { enumerable: false, value: {
  bk, backupOnce, restoreOnce, nightBiz, nightAll, seal, open, enc, decv, COLLS, RESTORE,
  call: { posBackup: () => wrap('posBackup', bk) },
} });
