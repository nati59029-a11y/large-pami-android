'use strict';
// לקוחות משוב ← רשימת תפוצה בימות (משימה 2026-11-17, שלב 4).
//   runFbSync(opts) – מוסיפה לרשימת התפוצה "לקוחות משוב" בימות את הטלפונים מטופסי משוב מאושרים (fb, st=='ok'),
//                     גם בשורש וגם ב-b/largpeami/fb, שעוד לא נשלחו (yemot_fbsent/{טלפון}). נקראת מהריצה הלילית (yemot.js) ומ-yemotFbList.
//   yemotFbList      – מנהל בלבד: { action:'state' } מצב, { action:'sync' } סנכרון עכשיו, { action:'setTz', on } מתג צינתוק (רק שמירה – הצינתוק עצמו ב-sendPromo ב-yemot.js).
//                      (משימה 2026-11-19, "מספרים בקו") { action:'numbers' } – המספרים ברשימה החינמית ובלקוחות משוב (קריאה בלבד);
//                      { action:'block'|'unblock', phone } – חסימה/ביטול חסימה של מספר שכבר ברשימת לקוחות המשוב (UpdateTemplateEntry לפי rowid). לא מוחק ולא מוסיף.
// בטיחות: רק הוספה ועדכון (UploadPhoneList עם updateType UPDATE, ב-lib/yemot-client.js). אין מחיקת מספרים, אין ניקוי רשימה ואין מחיקת תבנית.
// הרשימה נוצרת פעם אחת: קודם templateId השמור, אחר כך GetTemplates לפי השם, ורק אם אין – CreateTemplate. יצירה שלא ודאית (פסק זמן) לא חוזרת באותה ריצה;
// בריצה הבאה GetTemplates ימצא אותה אם נוצרה.
// טלפון מסומן "נשלח" רק אחרי תשובת OK מימות. פסק זמן = "לא ודאי": לא מסומן, ונשלח שוב בריצה הבאה (UPDATE לא יוצר כפילות).
// המפתח של ימות רק בכותרת authorization (yemot-client). לא נכתב ליומן, לרשומה או לתשובה.

const { HttpsError } = require('firebase-functions/v2/https');
const { onCall } = require('./lib/region');
const { defineSecret, defineInt, defineString } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const roles = require('./lib/roles');
const T = require('./lib/tenant');
const { inputObject } = roles;
const { YemotError, apiBase, getTemplates, createTemplate, uploadPhoneList, getTemplateEntries, setEntryBlocked, tzlEntries } = require('./lib/yemot-client');

const YEMOT_API_KEY = defineSecret('YEMOT_API_KEY');
const YEMOT_API_BASE = defineString('YEMOT_API_BASE', { default: 'https://www.call2all.co.il/ym/api/', description: 'כתובת ה-API של ימות המשיח' });
const YEMOT_FB_TZ_MAX = defineInt('YEMOT_FB_TZ_MAX', { default: 1500, description: 'מכסה לצינתוק ללקוחות משוב במבצע אחד (מעל זה לא שולחים להם)' });
const YEMOT_TIMEOUT_MS = defineInt('YEMOT_TIMEOUT_MS', { default: 15000, description: 'זמן המתנה מרבי לכל קריאה לימות' });

const requireStaff = (request) => roles.requireStaff(request, { feature: 'yemot', yemotLine: true });

const LIST_NAME = 'לקוחות משוב';
const STATE = 'yemot_state/fblist';
const SENT = 'yemot_fbsent';
const BATCH = 500; // (לא מאומת) כמה מספרים מותר בקריאה אחת – הנחה
const LOCK_MS = 10 * 60 * 1000; // סנכרון אחד בכל רגע; נעילה ישנה (קריסה) משתחררת אחרי 10 דקות
const NAME_MAX = 40;

// ---------------- טלפון ושם ----------------
// מספר ישראלי: נייד/VoIP 05X/07X (10 ספרות) או קווי 02/03/04/08/09 (9 ספרות). +972/972/00972 ← 0. כל השאר = לא תקין (null).
function normPhone(raw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  let s = String(raw).trim().replace(/[\s\-().‎‏]/g, '');
  if (/^\+972/.test(s)) s = '0' + s.slice(4);
  else if (/^00972/.test(s)) s = '0' + s.slice(5);
  else if (/^972\d{8,9}$/.test(s)) s = '0' + s.slice(3);
  if (/^0\d/.test(s) === false && /^[57]\d{8}$/.test(s)) s = '0' + s; // בלי האפס המוביל (נפוץ בגיליונות)
  return /^0[57]\d{8}$/.test(s) || /^0[23489]\d{7}$/.test(s) ? s : null;
}
// שם לרשימה: בלי תווי בקרה וכיווניות, בלי פסיקים ושורות (המפריד בקובץ), עד 40 תווים
function cleanName(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁠-⁯﻿]/g, ' ')
    .replace(/[,;="]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim();
}

// ---------------- איסוף טופסי המשוב ----------------
// fb בשורש ו-b/largpeami/fb (גם לפני וגם אחרי ההעברה), רק st=='ok'. רק השדה data נקרא (לא התמונה).
// data = מחרוזת JSON { f: { phone, name, ... }, ... } (fbRecJ באפליקציה). מאוחד לפי טלפון.
async function collect() {
  const raw = getFirestore();
  const byPhone = new Map();
  let okFb = 0, invalid = 0;
  for (const col of ['fb', `b/${T.BIZ0}/fb`]) {
    const snap = await raw.collection(col).where('st', '==', 'ok').select('data').get();
    for (const d of snap.docs) {
      okFb++;
      let f = null;
      try { const j = JSON.parse(String(d.get('data') || '')); f = j && typeof j.f === 'object' ? j.f : null; } catch (e) { f = null; }
      const phone = f ? normPhone(f.phone) : null;
      if (!phone) { invalid++; continue; }
      const name = cleanName(f.name);
      const cur = byPhone.get(phone);
      if (!cur) byPhone.set(phone, { phone, name });
      else if (!cur.name && name) cur.name = name;
    }
  }
  return { okFb, invalid, rows: [...byPhone.values()] };
}

// מי מהטלפונים עוד לא טופל (אין לו yemot_fbsent/{טלפון})
async function notSent(db, rows) {
  const out = [];
  for (let i = 0; i < rows.length; i += 300) {
    const part = rows.slice(i, i + 300);
    const snaps = await db.getAll(...part.map((r) => db.doc(`${SENT}/${r.phone}`)));
    snaps.forEach((s, k) => { if (!s.exists) out.push(part[k]); });
  }
  return out;
}

// ---------------- נעילה ----------------
async function lock(db, nowIso) {
  const ref = db.doc(STATE);
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const x = s.exists ? s.data() : {};
    if (x.lockAt && Date.now() - Date.parse(x.lockAt) < LOCK_MS) return false;
    tx.set(ref, { lockAt: nowIso }, { merge: true });
    return true;
  });
}

// ---------------- הרשימה בימות ----------------
// מחזיר { id } או { error, uncertain }. נשמר ב-fblist.templateId בטרנזקציה, ולא דורס מזהה שכבר נשמר.
async function ensureTemplate(db, ctx) {
  const ref = db.doc(STATE);
  const saved = (await ref.get()).get('templateId');
  if (Number.isInteger(saved) && saved > 0) return { id: saved };
  let found;
  try { found = (await getTemplates(ctx)).filter((t) => t.description === LIST_NAME).map((t) => t.templateId).sort((a, b) => a - b)[0]; } catch (e) {
    logger.warn('yemot-fblist: templates failed', { reason: 'templates-failed', code: e.code });
    return { error: 'templates-failed', uncertain: false };
  }
  let id = found, created = false;
  if (!id) {
    await ref.set({ createTriedAt: new Date().toISOString() }, { merge: true });
    try { id = await createTemplate(ctx, LIST_NAME); created = true; } catch (e) {
      // פסק זמן: ייתכן שנוצרה. לא מנסים שוב באותה ריצה; בריצה הבאה GetTemplates ימצא אותה.
      logger.warn('yemot-fblist: create failed', { reason: 'create-failed', code: e.code });
      return { error: e.code === 'timeout' ? 'create-uncertain' : 'create-failed', uncertain: e.code === 'timeout' };
    }
  }
  return { created, id: await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const cur = s.exists ? s.get('templateId') : null;
    if (Number.isInteger(cur) && cur > 0) return cur;
    tx.set(ref, { templateId: id, templateName: LIST_NAME }, { merge: true });
    return id;
  }) };
}

// ---------------- הסנכרון ----------------
// opts: { key, base, timeoutMs, by: 'nightly'|'manual' }. מחזיר סיכום (נשמר גם ב-fblist.lastRun).
async function runFbSync(opts) {
  const o = opts || {};
  const db = T.tdb();
  const key = o.key !== undefined ? o.key : YEMOT_API_KEY.value();
  const base = o.base !== undefined ? o.base : YEMOT_API_BASE.value();
  const at = new Date().toISOString();
  const out = { at, by: o.by === 'manual' ? 'manual' : 'nightly', okFb: 0, phones: 0, invalid: 0, already: 0, pending: 0, sent: 0, rejected: 0, uncertain: 0, created: false, error: null };
  if (!(await lock(db, at))) return Object.assign(out, { error: 'busy', busy: true });
  try {
    const c = await collect();
    out.okFb = c.okFb; out.invalid = c.invalid; out.phones = c.rows.length;
    const todo = await notSent(db, c.rows);
    out.already = c.rows.length - todo.length; out.pending = todo.length;
    if (!todo.length) return out; // אין מה לשלוח – בלי שום פנייה לימות
    if (!key) { logger.error('yemot-fblist: no key', { reason: 'no-key' }); out.error = 'no-key'; return out; }
    const ctx = { key, base: apiBase(base), timeoutMs: o.timeoutMs || YEMOT_TIMEOUT_MS.value() };
    const t = await ensureTemplate(db, ctx);
    out.created = !!t.created;
    if (t.error) { out.error = t.error; return out; }
    for (let i = 0; i < todo.length; i += BATCH) {
      const part = todo.slice(i, i + BATCH);
      let r;
      try { r = await uploadPhoneList(ctx, t.id, part); } catch (e) {
        const unsure = e.code === 'timeout';
        logger.warn('yemot-fblist: upload failed', { reason: 'upload-failed', code: e.code });
        if (unsure) out.uncertain += part.length;
        out.error = unsure ? 'upload-uncertain' : 'upload-failed';
        break; // לא ממשיכים; מה שלא סומן יישלח שוב בריצה הבאה
      }
      // ספירה של ימות קטנה ממספר השורות (למשל השורה הראשונה נקראה ככותרת – לא מאומת): לא מסמנים אף מספר בקבוצה,
      // כדי שאף לקוח לא יסומן "נשלח" בלי שנכנס. נספר "לא ודאי" ויישלח שוב בריצה הבאה (UPDATE לא יוצר כפילות).
      if (r.parsed < part.length || r.inserted + r.updated + r.rejected.length < part.length) {
        logger.warn('yemot-fblist: count mismatch', { reason: 'count-mismatch', rows: part.length, parsed: r.parsed });
        out.uncertain += part.length; out.error = 'count-mismatch';
        break;
      }
      const bad = new Map(r.rejected.map((x) => [normPhone(x.phone), x.errorState]));
      const now = new Date().toISOString();
      const wb = db.batch();
      for (const row of part) {
        const st = bad.get(row.phone) === 'INVALID' ? 'rejected' : 'sent';
        if (st === 'rejected') out.rejected++; else out.sent++;
        wb.set(db.doc(`${SENT}/${row.phone}`), { st, at: now, tpl: t.id, by: out.by });
      }
      await wb.commit();
    }
    return out;
  } finally {
    const sum = Object.assign({}, out); delete sum.busy;
    const upd = { lockAt: null, lastRun: sum, updatedAt: new Date().toISOString() };
    if (out.sent) upd.sentCount = FieldValue.increment(out.sent);
    if (out.rejected) upd.rejectedCount = FieldValue.increment(out.rejected);
    try { await db.doc(STATE).set(upd, { merge: true }); } catch (e) { logger.error('yemot-fblist: state save failed', { reason: 'state-failed' }); }
    if (out.sent || out.rejected || out.error) logger.info('yemot-fblist: sync done', { sent: out.sent, rejected: out.rejected, uncertain: out.uncertain, pending: out.pending, error: out.error });
  }
}

// ---------------- yemotFbList (מנהל) ----------------
// חוזה מסך המנהל (שלב 6): אותו אובייקט state בכל שלוש הפעולות.
// sent/rejected = סה"כ מצטבר; uncertain = מהריצה האחרונה; pending = מספרים תקינים ממשוב מאושר שעוד לא נשלחו;
// lastRun = זמן הריצה האחרונה; lastError = קוד קצר בלבד (לא טקסט מימות); tzMonth = צינתוקים בתשלום ללקוחות משוב בחודש הנוכחי (נספר ב-yemot.js, שלב 5).
const israelMonth = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
async function stateOf(db) {
  const x = (await db.doc(STATE).get()).data() || {};
  const c = await collect();
  const todo = await notSent(db, c.rows);
  const lr = x.lastRun && typeof x.lastRun === 'object' ? x.lastRun : null;
  const month = israelMonth();
  const tm = x.tzMonth && x.tzMonth.month === month && Number.isInteger(x.tzMonth.count) ? x.tzMonth.count : 0;
  return { ok: true, templateId: Number.isInteger(x.templateId) ? x.templateId : null, tzOn: x.tzOn === true,
    sent: Number.isInteger(x.sentCount) ? x.sentCount : 0, rejected: Number.isInteger(x.rejectedCount) ? x.rejectedCount : 0,
    uncertain: lr && Number.isInteger(lr.uncertain) ? lr.uncertain : 0, pending: todo.length,
    lastRun: lr && typeof lr.at === 'string' ? lr.at : null, lastError: lr && typeof lr.error === 'string' ? lr.error.slice(0, 40) : null,
    tzMonth: { month, count: tm }, tzMax: Number.isInteger(YEMOT_FB_TZ_MAX.value()) && YEMOT_FB_TZ_MAX.value() > 0 ? YEMOT_FB_TZ_MAX.value() : 1500 };
}

// ---------------- "מספרים בקו" (משימה 2026-11-19) ----------------
// שגיאה מימות ← קוד קצר בלבד (לא טקסט מימות). פסק זמן בחסימה = לא ודאי (ייתכן שבוצעה).
const yErr = (e) => (e instanceof YemotError ? String(e.code).slice(0, 30) : 'internal');
const tplIdOf = async (db) => { const v = (await db.doc(STATE).get()).get('templateId'); return Number.isInteger(v) && v > 0 ? v : null; };
function yemotCtx(key, base) {
  if (!key) throw new HttpsError('failed-precondition', 'הקו הטלפוני עוד לא מחובר בשרת.', { reason: 'no-key' });
  try { return { key, base: apiBase(base), timeoutMs: YEMOT_TIMEOUT_MS.value() }; } catch (e) { throw new HttpsError('failed-precondition', 'כתובת ימות לא תקינה בשרת.', { reason: 'bad-base' }); }
}

// הרשימה החינמית (רק טלפונים) + לקוחות משוב ({ p, b, n }). כל רשימה בנפרד: כשל באחת לא מסתיר את השנייה (freeErr/fbErr).
async function numbersOf(db, key, base) {
  const ctx = yemotCtx(key, base);
  const list = require('./yemot').shared.readCfg().list;
  const tplId = await tplIdOf(db);
  const out = { ok: true, listName: String(list), listReady: tplId !== null, free: [], fb: [], freeErr: null, fbErr: null };
  const [fr, fe] = await Promise.allSettled([tzlEntries(ctx, list), tplId ? getTemplateEntries(ctx, tplId) : Promise.resolve([])]);
  if (fr.status === 'fulfilled') out.free = [...new Set(fr.value.map((p) => normPhone(p) || String(p).slice(0, 20)))];
  else { out.freeErr = yErr(fr.reason); logger.warn('yemot-fblist: numbers free failed', { reason: 'free-failed', code: out.freeErr }); }
  if (fe.status === 'fulfilled') {
    const m = new Map(); // מאוחד לפי מספר מנורמל; חסום אם אחת השורות חסומה
    for (const e of fe.value) {
      const p = normPhone(e.phone) || String(e.phone).slice(0, 20);
      const cur = m.get(p);
      if (!cur) m.set(p, { p, b: e.blocked, n: cleanName(e.name || '') });
      else { cur.b = cur.b || e.blocked; if (!cur.n) cur.n = cleanName(e.name || ''); }
    }
    out.fb = [...m.values()];
  } else { out.fbErr = yErr(fe.reason); logger.warn('yemot-fblist: numbers fb failed', { reason: 'fb-failed', code: out.fbErr }); }
  out.counts = { free: out.free.length, fbActive: out.fb.filter((x) => !x.b).length, fbBlocked: out.fb.filter((x) => x.b).length };
  return out;
}

// חסימה / ביטול חסימה. רק מספר שכבר ברשימת לקוחות המשוב. אחרי העדכון קוראים שוב מימות ומוודאים שהמצב השתנה.
async function setBlocked(db, key, base, who, rawPhone, on) {
  const phone = normPhone(rawPhone);
  if (!phone) throw new HttpsError('invalid-argument', 'מספר טלפון לא תקין.', { reason: 'bad-phone' });
  const tplId = await tplIdOf(db);
  if (!tplId) throw new HttpsError('failed-precondition', 'רשימת לקוחות המשוב עוד לא נוצרה בימות.', { reason: 'no-list' });
  const ctx = yemotCtx(key, base);
  const fail = (e) => { const c = yErr(e); logger.warn('yemot-fblist: block failed', { reason: 'block-failed', code: c });
    return c === 'timeout' ? new HttpsError('unavailable', 'ימות לא ענה בזמן. לא ידוע אם השינוי בוצע – רעננו את הרשימה ובדקו.', { reason: 'uncertain' })
      : new HttpsError('unavailable', 'הפעולה מול ימות נכשלה. נסו שוב.', { reason: 'yemot-failed', code: c }); };
  let rows;
  try { rows = (await getTemplateEntries(ctx, tplId)).filter((e) => normPhone(e.phone) === phone); } catch (e) { throw fail(e); }
  if (!rows.length) throw new HttpsError('failed-precondition', 'המספר לא נמצא ברשימת לקוחות המשוב.', { reason: 'not-in-list' });
  const todo = rows.filter((e) => e.blocked !== on);
  if (todo.some((e) => !Number.isInteger(e.rowid))) throw new HttpsError('unavailable', 'ימות לא החזיר מזהה שורה. לא בוצע שינוי.', { reason: 'no-rowid' });
  // חסימה: מסמנים "נשלח" (אם עוד לא) כדי שהסנכרון הלילי לא יעלה את המספר שוב (העלאה עם blocked:0 עלולה לבטל חסימה – לא מאומת)
  if (on) { try { await db.doc(`${SENT}/${phone}`).create({ st: 'sent', at: new Date().toISOString(), tpl: tplId, by: 'block' }); } catch (e) { if (e.code !== 6) throw e; } }
  try { for (const e of todo) await setEntryBlocked(ctx, tplId, e, on); } catch (e) { throw fail(e); }
  let after;
  try { after = (await getTemplateEntries(ctx, tplId)).filter((e) => normPhone(e.phone) === phone); } catch (e) { throw fail(e); }
  const ok = after.length > 0 && after.every((e) => e.blocked === on);
  if (!ok) { logger.warn('yemot-fblist: block not applied', { reason: 'not-applied' }); throw new HttpsError('unavailable', 'ימות לא עדכן את המספר. נסו שוב.', { reason: 'not-applied' }); }
  logger.info('yemot-fblist: block', { on, changed: todo.length, by: who.uid });
  return { ok: true, phone, blocked: on, changed: todo.length };
}

async function fbList(request, key, base) {
  const who = await requireStaff(request);
  if (who.role !== 'manager') throw new HttpsError('permission-denied', 'הפעולה הזו מותרת למנהל בלבד.', { reason: 'manager-only' });
  const input = inputObject(request);
  const db = T.tdb();
  if (input.action === 'state') return stateOf(db);
  if (input.action === 'sync') {
    const r = await runFbSync({ key, base, by: 'manual' });
    if (r.busy) throw new HttpsError('failed-precondition', 'סנכרון כבר רץ עכשיו. נסו שוב בעוד כמה דקות.', { reason: 'busy' });
    return Object.assign(await stateOf(db), { run: { sent: r.sent, rejected: r.rejected, uncertain: r.uncertain, created: !!r.created } });
  }
  if (input.action === 'setTz') {
    if (typeof input.on !== 'boolean') throw new HttpsError('invalid-argument', 'קלט לא תקין', { reason: 'bad-input' });
    await db.doc(STATE).set({ tzOn: input.on, tzBy: who.uid, tzAt: new Date().toISOString() }, { merge: true });
    return stateOf(db);
  }
  if (input.action === 'numbers') return numbersOf(db, key, base);
  if (input.action === 'block' || input.action === 'unblock') {
    if (typeof input.phone !== 'string' || input.phone.length > 30) throw new HttpsError('invalid-argument', 'קלט לא תקין', { reason: 'bad-input' });
    return setBlocked(db, key, base, who, input.phone, input.action === 'block');
  }
  throw new HttpsError('invalid-argument', 'קלט לא תקין', { reason: 'bad-input' });
}

exports.yemotFbList = onCall({ secrets: [YEMOT_API_KEY], timeoutSeconds: 300 }, T.scoped(async (request) => {
  try { return await fbList(request, YEMOT_API_KEY.value(), YEMOT_API_BASE.value()); } catch (e) {
    if (e instanceof HttpsError) throw e;
    logger.error('yemot-fblist: call failed', { reason: 'internal', name: e && e.name });
    throw new HttpsError('internal', 'שגיאה בפעולה מול הקו.', { reason: 'internal' });
  }
}));

// לריצה הלילית (yemot.js) ולבדיקות. לא נספרים כפונקציות.
Object.defineProperty(exports, 'runFbSync', { enumerable: false, value: runFbSync });
Object.defineProperty(exports, '_core', { enumerable: false, value: { fbList, runFbSync, normPhone, cleanName, LIST_NAME } });
