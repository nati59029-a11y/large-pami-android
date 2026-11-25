'use strict';
// חשבונית ספק של עובד → "חשבוניות לתמחור" (pinv) בשרת, מיד כשההוצאה נשלחת למנהל (22.11.2026, שלב 1 – שרת בלבד).
//   piInbox  – טריגר על יצירת inbox/{id} (לארג' פעמי במצב legacy, בשורש).
//   piInboxB – טריגר על יצירת b/{bizId}/inbox/{id}.
// עד היום זה קרה רק בטלפון של העובד (www/pricing.js, ההוק על pushItem: תור ב-localStorage → scanDocument 'invlines' → piCreate → piImg),
// ורק כשהאפליקציה שלו פתוחה. כאן אותו תהליך בשרת, בלי תלות בטלפון ובלי אישור:
// תנאים – בדיוק כמו ההוק באפליקציה: לא צילום חלופי (repl), לא הוצאה מקופה (reg), לא צ'ק, יש צילום (chunks), סכום > 0,
//   והקטגוריה (cfg/main שהמנהל פרסם, באותו עסק) מסוג ספק (beh === 'sup'). בנוסף, כמו on() + scanDocument + piCreate:
//   עסק פעיל, תוספת "מדף" או "הזמנות", ותוספת "זיהוי חכם" (scan); השולח (owner) הוא עובד פעיל של העסק הזה (לא מנהל – רק עובד שולח inbox),
//   ובעסק במבנה b – עם expW או prc (כמו scanDocument kind 'invlines'). הזהות נלקחת רק מהמסד (users / staff / admins), לא מהמסמך.
// מזהה: pinv/'i' + rqOf('o' + id) – אותו מזהה שהטלפון מחשב, כך שטלפון עם גרסה ישנה (שעדיין מעבד בעצמו) מקבל dup ולא נוצרת כפילות.
// זיהוי: כמו scanDocument (מכסה reserveScan לשולח, אותו כלל החזר: רק כשאף בקשה לא יצאה), פענוח – PricingLines.invLines
//   (lib/pricing-lines.js – עותק זהה תו-בתו של www/pricing-lines.js). מע"מ – ordcfg/main.vat (כמו vatOf באפליקציה).
// כותרת: ספק = subName מההוצאה, אחרת מהזיהוי; supId = sub אם תקין; מספר חשבונית ותאריך – מההוצאה, אחרת מהזיהוי.
// יצירה – createCore של piCreate (אותו ניקוי, src 'worker', by = השולח, byName כמו w.uname). אחר כך הצילום – imgCore (כמו piImg).
// כשל בזיהוי (25.11.2026, במקום "לא נוצרת"): עמוד-עמוד, ואם עדיין נכשל – תור pinvq וניסיונות חוזרים (piRetry). אחרי הניסיון
//   האחרון, או כשהקובץ לא מתאים לזיהוי בכלל, נוצרת חשבונית עם הצילום ובלי שורות (rf: 1) – כל חשבונית מגיעה לתמחור.
//   זיהוי שהצליח אבל בלי שורות – נוצרת חשבונית עם 0 שורות, בדיוק כמו בטלפון.
// "חוסרים" (hsOnInv, hs.js) – נשאר בטלפון בלבד; השרת לא קורא לו.
// תקופת מעבר (עד שלב 2): APK קיים ממשיך לזהות בעצמו (ההוק על pushItem ב-www/pricing.js), ולכן רוב החשבוניות מזוהות פעמיים –
//   פעמיים במכסה של העובד ופעמיים עלות Gemini (רק הראשון שיוצר את pinv נשמר; השני מקבל dup). שלב 2: להסיר את ההוק מהאפליקציה.
// דרישה לשלב 2 (לא משנים את app-source עכשיו): אפליקציית המנהל (pullInbox2 ב-index.html) מוחקת את chunks של הוצאה מיד אחרי המשיכה.
//   היא חייבת לא למחוק chunks של פריט inbox שנשלח לפני פחות מכמה דקות (לפי inbox.t), אחרת הטריגר עלול לא למצוא את הצילום (no-chunk).
// כל דילוג נרשם ביומן: logger.info('piInbox skip', { reason, biz }) – בלי פרטים אישיים ובלי תוכן הצילום.
// אזור: europe-west1 בלבד, בלי ניסיון חוזר. שגיאה נרשמת ביומן (בלי תוכן הצילום ובלי פרטים אישיים) ולא נזרקת.
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const logger = require('firebase-functions/logger');
const { defineSecret, defineInt, defineString } = require('firebase-functions/params');
const { NEW_REGION } = require('./lib/region');
const T = require('./lib/tenant');
const scan = require('./lib/scan');
const PL = require('./lib/pricing-lines');
const { hasPerm } = require('./lib/roles');
const P = require('./pricing')._core;
const { getFirestore } = require('firebase-admin/firestore');

// אותם פרמטרים כמו ב-index.js (אותו שם = אותו פרמטר)
const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
const SCAN_DAILY_LIMIT = defineInt('SCAN_DAILY_LIMIT', { default: 100, description: 'מספר זיהויים מותר ביום לכל משתמש' });
const SCAN_MAX_FILE_MB = defineInt('SCAN_MAX_FILE_MB', { default: 10, description: 'גודל מרבי לקובץ בזיהוי (MB)' });
const GEMINI_API_BASE = defineString('GEMINI_API_BASE', { default: 'https://generativelanguage.googleapis.com', description: 'כתובת השירות של Gemini' });

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const ID_OK = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v);
const DATE_OK = (v) => typeof v === 'string' && /^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v);
const MAX_PARTS = 12; // כמו pushItem ('הצילומים גדולים מדי')
const num = (v) => parseFloat(v) || 0; // כמו num() באפליקציה
const s_ = (v) => String(v == null ? '' : v).trim();
// rqOf באפליקציה (www/pricing.js)
const rqOf = (fid) => { let s = ('pi' + String(fid || '')).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40); while (s.length < 8) s += '0'; return s; };

// התנאים של ההוק באפליקציה, על ההוצאה עצמה (בלי קריאה מהמסד)
// מחזיר { d, np } או { r: קוד הסיבה לדילוג }
function eligible(doc) {
  if (!doc || typeof doc !== 'object' || doc.status !== 'new' || !ID_RE.test(String(doc.owner || ''))) return { r: 'bad-doc' };
  let d = null;
  try { d = JSON.parse(typeof doc.data === 'string' ? doc.data : ''); } catch (e) { return { r: 'bad-data' }; }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return { r: 'bad-data' };
  if (d.repl) return { r: 'repl' };
  // הוצאה מקופה (reg) נכנסת לתמחור כמו חשבונית רגילה, אלא אם הספק כבוי לתמחור (subs[].prOff, 23.11.2026)
  if (d.kind === 'check' || doc.k === 'check') return { r: 'check' };
  if (!(num(d.amt) > 0)) return { r: 'amt' };
  const np = Number(doc.parts);
  if (!Number.isInteger(np) || np < 1 || np > MAX_PARTS) return { r: 'parts' };
  return { d, np };
}

// הקובץ השמור מ-chunks/{id}_{k} (נכתבים לפני מסמך ה-inbox). כל חלק – של אותו עובד. pfx = שורש הנתונים לפי נתיב הטריגר.
// נקרא מוקדם ככל האפשר (במקביל לשאר הקריאות), כי אפליקציית המנהל מוחקת את החלקים אחרי שהיא מושכת את ההוצאה (pullInbox2).
// מחזיר { f } או { r: 'no-chunk' } (חלק חסר / של עובד אחר / בלי data)
async function fileOf(pfx, id, np, owner) {
  const fs = getFirestore();
  const S = await fs.getAll(...Array.from({ length: np }, (_, k) => fs.doc(pfx + 'chunks/' + id + '_' + k)));
  let f = '';
  for (const s of S) {
    if (!s.exists || s.get('owner') !== owner || typeof s.get('data') !== 'string') return { r: 'no-chunk' };
    f += s.get('data');
  }
  return { f };
}

// כמו pages() באפליקציה: עד 4 עמודים, PDF – כמו שהוא ועוצרים. תמונה – כמו שהיא (בשרת אין הקטנה; מגבלת הגודל של scanDocument חלה)
function pagesOf(v) {
  let L;
  if (v.startsWith('PAGES:')) { try { L = JSON.parse(v.slice(6)); } catch (e) { L = []; } } else L = [v];
  if (!Array.isArray(L)) L = [];
  L = L.filter((x) => typeof x === 'string' && /^data:/.test(x)).slice(0, 4);
  const out = [];
  for (const u of L) {
    const m = /^data:([A-Za-z0-9.+/-]+);base64,(.*)$/s.exec(u);
    if (!m) continue;
    const mt = m[1].toLowerCase();
    if (mt === 'application/pdf') { out.push({ mimeType: mt, data: m[2] }); break; }
    out.push({ mimeType: mt, data: m[2] });
  }
  return out;
}
// הצילום לענן – כמו upImg באפליקציה: PDF לבד, אחרת כל העמודים
function imgOf(P0) {
  const pdf = P0.find((p) => p.mimeType === 'application/pdf');
  const U = (pdf ? [pdf] : P0).map((p) => 'data:' + p.mimeType + ';base64,' + p.data);
  return U.length === 1 ? U[0] : 'PAGES:' + JSON.stringify(U);
}

async function vatOf(db) {
  try {
    const s = await db.doc('ordcfg/main').get();
    const v = s.exists ? s.get('vat') : null;
    return typeof v === 'number' && v >= 0 && v <= 100 ? v : undefined;
  } catch (e) { return undefined; }
}

// הזיהוי – כמו scanDocument kind 'invlines'. מחזיר { text } או זורק (המכסה כבר טופלה).
// 25.11.2026: deadline ו-timeoutMs נקבעים מבחוץ (scanAll) – בשרת יש יותר זמן מאשר לטלפון שמחכה לתשובה.
async function recognize(uid, bizId, files, o, deadline, timeoutMs) {
  const key = o.key != null ? o.key : GEMINI_API_KEY.value();
  if (!key) throw Object.assign(new Error('no-key'), { r: 'no-key' });
  const caps = await scan.bizCaps(bizId, SCAN_DAILY_LIMIT.value());
  const usage = await scan.reserveScan(uid, caps.perUser, caps.bizDaily, files.length, caps.bizKey, caps.period);
  const stats = { sent: 0 };
  try {
    const body = scan.buildGeminiBody('invlines', files);
    const base = String(o.base || GEMINI_API_BASE.value()).replace(/\/+$/, '');
    const r = await scan.callGemini(base, key, body, timeoutMs, scan.KINDS.invlines.pro, { deadline, stats });
    return { text: r.text };
  } catch (e) {
    // כמו scanDocument: מוחזר למונה רק ניסיון שבו שום בקשה לא יצאה ל-Gemini
    if (stats.sent === 0) await scan.refundScan(uid, usage.day);
    throw e;
  }
}

// 25.11.2026 (חשבונית סופר קייק, 3 עמודים, נפלה על time-budget אחרי 100 שניות): כל חשבונית, בכל גודל, נכנסת לתמחור.
// 1. יותר זמן: עד SRV.total לכל הזיהוי (הפונקציה רצה עד 540 שניות), ועד SRV.call לכל מודל.
// 2. חשבונית של כמה תמונות שנכשלה בבת אחת – מזהים עמוד-עמוד ומחברים את השורות (כל בקשה קטנה ומהירה יותר).
// 3. עדיין נכשל – נשמר בתור pinvq (עם הצילום) ו-piRetry מנסה שוב לפי Q_DELAYS. אחרי הניסיון האחרון נוצרת חשבונית
//    לתמחור עם הצילום ובלי שורות (rf: 1), כדי שתמיד תופיע ברשימה.
// הזמנים מוכפלים ביחס של SCAN_TIME_SCALE (באמולטור בלבד), כמו שאר הזיהויים.
const SRV = { total: 470000, first: 240000, call: 180000 };
const Q_DELAYS = [15, 30, 60, 120, 240, 480].map((m) => m * 60000); // אחרי ניסיון 1..6; ניסיון 7 = האחרון
const Q_MAX = Q_DELAYS.length + 1;
const Q_CH = 700000;
const NO_SPLIT = ['daily-limit', 'key-invalid', 'no-key'];
// קובץ שהזיהוי לא יכול לקבל בכלל – אין טעם לנסות שוב: נכנס מיד לתמחור עם הצילום ובלי שורות
const NO_RETRY = ['bad-file', 'bad-file-count', 'bad-type', 'empty', 'too-big'];
const scale = () => scan.timesFor('invlines').budgetMs / 100000;
const why = (e) => String((e && e.details && e.details.reason) || (e && e.r) || 'scan-failed').slice(0, 40);

async function scanAll(owner, bizId, files, vat, o) {
  const k = scale(), t0 = Date.now(), end = t0 + SRV.total * k, call = SRV.call * k;
  try {
    const r = await recognize(owner, bizId, files, o, Math.min(end, t0 + SRV.first * k), call);
    return PL.invLines(String(r.text || ''), vat);
  } catch (e) {
    if (files.length < 2 || NO_SPLIT.includes(why(e))) throw e;
    logger.info('piInbox: page by page', { biz: bizId, pages: files.length, reason: why(e) });
  }
  const out = { sup: '', inv: '', date: '', lines: [] };
  for (let i = 0; i < files.length; i++) {
    const left = end - Date.now();
    const r = await recognize(owner, bizId, [files[i]], o, Date.now() + left / (files.length - i), call);
    const x = PL.invLines(String(r.text || ''), vat);
    out.sup = out.sup || x.sup; out.inv = out.inv || x.inv; out.date = out.date || x.date;
    out.lines = out.lines.concat(x.lines || []);
  }
  return out;
}

// הכותרת + יצירה + צילום (משותף לטריגר, לניסיון החוזר ולגיבוי האחרון). x = תוצאת הזיהוי, או null = בלי שורות
async function createWith(w, d, reqId, x, P0, extra) {
  x = x || { lines: [] };
  const hdr = {
    reqId,
    sup: String(s_(d.subName) || x.sup || '').slice(0, 60),
    inv: String(s_(d.inv) || x.inv || '').slice(0, 30),
    date: DATE_OK(d.date) ? d.date : (DATE_OK(x.date) ? x.date : ''),
    lines: (x.lines || []).slice(0, 100),
  };
  if (ID_OK(d.sub)) hdr.supId = d.sub;
  const cr = await P.createCore(w, hdr);
  if (cr.dup) return { ok: true, r: 'dup', id: cr.id };
  if (extra) await T.tdb().doc('pinv/' + cr.id).update(extra);
  let img = 0;
  try { img = await P.imgCore(cr.id, imgOf(P0)); } catch (e) { logger.warn('piInbox: image not stored', { bizId: w.bizId, name: e && e.name, code: e && e.code }); }
  return { ok: true, r: 'created', id: cr.id, n: hdr.lines.length, img };
}

// תור לניסיון חוזר: pinvq/{inbox id} + הצילום ב-pinvq/{id}/p/{k}. רק השרת קורא וכותב (החוקים סוגרים את האוסף)
async function enqueue(owner, id, d, P0, reason, now) {
  const db = T.tdb();
  const ref = db.doc('pinvq/' + id);
  const du = imgOf(P0);
  const np = Math.ceil(du.length / Q_CH);
  for (let k = 0; k < np; k++) await ref.collection('p').doc(String(k)).set({ data: du.slice(k * Q_CH, (k + 1) * Q_CH) });
  const keep = { cat: d.cat, sub: d.sub, subName: d.subName, inv: d.inv, date: d.date };
  await ref.set({ owner, d: JSON.stringify(keep), np, n: 1, nx: now + Q_DELAYS[0], at: now, why: reason });
}
async function dequeue(ref, np) {
  for (let k = 0; k < np; k++) { try { await ref.collection('p').doc(String(k)).delete(); } catch (e) { /* */ } }
  await ref.delete();
}

// הליבה. bizId = null לשורש (legacy). doc = מסמך ה-inbox. o – לבדיקות בלבד ({ key, base })
async function onInbox(bizId, id, doc, opts) {
  const o = opts || {};
  let bz = bizId || T.BIZ0;
  const skip = (reason, extra) => { logger.info('piInbox skip', { reason, biz: bz }); return Object.assign({ ok: true, r: reason }, extra || {}); };
  if (!ID_RE.test(String(id || '')) || (bizId && !T.BIZ_RE.test(String(bizId)))) { bz = ''; return Object.assign(skip('bad'), { ok: false }); }
  const e0 = eligible(doc); // בדיקות בזיכרון בלבד
  if (!e0.d) return skip(e0.r);
  const { d, np } = e0;
  const owner = doc.owner;
  // כל הקריאות במקביל, והצילום ראשון: נתיב הנתונים נגזר מנתיב הטריגר; אחר כך מוודאים שהעסק באמת שם (wrong-root)
  const pfx = bizId ? 'b/' + bizId + '/' : '';
  const fs = getFirestore();
  const [fr, biz, m, admin, staff, cfg] = await Promise.all([fileOf(pfx, id, np, owner), T.loadBiz(bz), T.resolveMember(owner),
    fs.doc(pfx + 'admins/' + owner).get(), fs.doc(pfx + 'staff/' + owner).get(), fs.doc(pfx + 'cfg/main').get()]);
  if (!biz || biz.status !== 'active') return skip('biz');
  const prefix = T.bizPrefix(biz);
  if (prefix !== pfx) return skip('wrong-root'); // הנתונים של העסק לא כאן
  if (!(biz.features.shelf || biz.features.orders)) return skip('feature-off');
  if (!biz.features.scan) return skip('scan-off');
  if (m.bizId !== biz.bizId) return skip('not-member');
  if (admin.exists || !staff.exists || staff.get('active') !== true) return skip('not-staff');
  const w = { uid: owner, role: 'employee', staff, admin, biz, bizId: biz.bizId, superadmin: false };
  if (biz.dataRoot === 'b' && !hasPerm(w, 'expW') && !hasPerm(w, 'prc')) return skip('no-perm');
  let cats = [];
  try { const j = JSON.parse(cfg.exists ? cfg.get('data') || '{}' : '{}'); cats = j && Array.isArray(j.cats) ? j.cats : []; } catch (e) { cats = []; }
  const c = cats.find((z) => z && z.id === d.cat);
  if (!c || c.beh !== 'sup') return skip('not-sup');
  // מתג בכרטיס ספק (23.11.2026): כבוי (prOff) – אף חשבונית של הספק לא נכנסת; דלוק (ברירת מחדל) – גם הוצאה מקופה נכנסת
  { const sb = (Array.isArray(c.subs) ? c.subs : []).find((z) => z && z.id === d.sub); if (sb && sb.prOff) return skip('sup-off'); }
  if (fr.r) return skip(fr.r);
  const P0 = fr.f ? pagesOf(fr.f) : [];
  if (!P0.length) return skip('no-photo');
  return T.runInBiz({ bizId: biz.bizId, prefix, biz, uid: owner }, async () => {
    const db = T.tdb();
    P.feats(w); // w.uname – כמו piCreate
    const reqId = rqOf('o' + id);
    const pid = 'i' + reqId;
    if ((await db.doc('pinv/' + pid).get()).exists) return skip('dup', { id: pid }); // הטלפון כבר יצר – בלי זיהוי נוסף
    let x;
    try {
      const { files } = scan.validateScanInput({ kind: 'invlines', files: P0 }, SCAN_MAX_FILE_MB.value() * 1024 * 1024);
      x = await scanAll(owner, biz.bizId, files, await vatOf(db), o);
    } catch (e) {
      const reason = why(e);
      if (NO_RETRY.includes(reason)) {
        const r = await createWith(w, d, reqId, null, P0, { rf: 1 });
        logger.warn('piInbox: file not readable, pinv created without lines', { bizId: biz.bizId, reason });
        return Object.assign(r, { reason });
      }
      logger.warn('piInbox: recognition failed, queued for retry', { bizId: biz.bizId, reason, code: e && e.code });
      try { await enqueue(owner, id, d, P0, reason, Date.now()); } catch (e2) { logger.error('piInbox: enqueue failed', { bizId: biz.bizId, name: e2 && e2.name, code: e2 && e2.code }); }
      return { ok: false, r: 'scan', reason, q: 1 };
    }
    const r = await createWith(w, d, reqId, x, P0);
    if (r.r === 'dup') return skip('dup', { id: r.id });
    logger.info('piInbox: pinv created', { bizId: biz.bizId, n: r.n, np: r.img });
    return r;
  });
}

// ניסיון חוזר לפריט אחד בתור (בתוך העסק). מחזיר קוד תוצאה
async function retryOne(biz, qs, now, opts) {
  const o = opts || {};
  const prefix = T.bizPrefix(biz);
  return T.runInBiz({ bizId: biz.bizId, prefix, biz, uid: '' }, async () => {
    const db = T.tdb();
    const ref = db.doc('pinvq/' + qs.id);
    const q = qs.data() || {};
    const id = qs.id, owner = String(q.owner || ''), np = Number(q.np) || 0;
    let d = {};
    try { d = JSON.parse(q.d || '{}') || {}; } catch (e) { d = {}; }
    const reqId = rqOf('o' + id);
    if ((await db.doc('pinv/i' + reqId).get()).exists) { await dequeue(ref, np); return 'dup'; } // נוצרה בינתיים (למשל "שלח לתמחור")
    let du = '';
    for (let k = 0; k < np; k++) { const c = await ref.collection('p').doc(String(k)).get(); du += c.exists ? String(c.get('data') || '') : ''; }
    const P0 = du ? pagesOf(du) : [];
    if (!P0.length || !ID_RE.test(owner)) { await dequeue(ref, np); return 'bad'; }
    const [staff, admin] = await Promise.all([db.doc('staff/' + owner).get(), db.doc('admins/' + owner).get()]);
    const w = { uid: owner, role: 'employee', staff, admin, biz, bizId: biz.bizId, superadmin: false };
    try { P.feats(w); } catch (e) { await dequeue(ref, np); return 'feature-off'; }
    let n = (Number(q.n) || 1) + 1;
    let x = null, reason = '';
    try {
      const { files } = scan.validateScanInput({ kind: 'invlines', files: P0 }, SCAN_MAX_FILE_MB.value() * 1024 * 1024);
      x = await scanAll(owner, biz.bizId, files, await vatOf(db), o);
    } catch (e) { reason = why(e); }
    if (NO_RETRY.includes(reason)) n = Q_MAX;
    if (x) {
      const r = await createWith(w, d, reqId, x, P0);
      await dequeue(ref, np);
      logger.info('piRetry: pinv created', { bizId: biz.bizId, n: r.n, tries: n });
      return r.r;
    }
    if (n < Q_MAX) {
      await ref.update({ n, nx: now + Q_DELAYS[n - 1], why: reason });
      logger.warn('piRetry: recognition failed again', { bizId: biz.bizId, reason, tries: n });
      return 'later';
    }
    // הניסיון האחרון: נכנסת לתמחור עם הצילום ובלי שורות, כדי שלא תיעלם
    const r = await createWith(w, d, reqId, null, P0, { rf: 1 });
    await dequeue(ref, np);
    logger.warn('piRetry: gave up recognition, pinv created without lines', { bizId: biz.bizId, reason, tries: n });
    return r.r === 'dup' ? 'dup' : 'empty';
  });
}

// כל הפריטים שהגיע זמנם, בכל העסקים עם מדף או הזמנות. מחזיר { id: קוד }
async function retryDue(now, opts) {
  const t = now || Date.now(), stop = Date.now() + 420000 * scale(), out = {};
  const seen = new Set(), L = [];
  for (const b of [...await T.bizzesWith('shelf'), ...await T.bizzesWith('orders')]) if (!seen.has(b.bizId)) { seen.add(b.bizId); L.push(b); }
  for (const biz of L) {
    if (biz.status !== 'active') continue;
    const qs = await getFirestore().collection(T.bizPrefix(biz) + 'pinvq').where('nx', '<=', t).limit(10).get();
    for (const s of qs.docs) {
      if (Date.now() > stop) return out;
      try { out[s.id] = await retryOne(biz, s, t, opts); } catch (e) { out[s.id] = 'error'; logger.error('piRetry failed', { bizId: biz.bizId, name: e && e.name, code: e && e.code }); }
    }
  }
  return out;
}

const OPTS = { region: NEW_REGION, retry: false, timeoutSeconds: 540, memory: '512MiB', maxInstances: 5, secrets: [GEMINI_API_KEY] };
const fail = (e) => { logger.error('piInbox failed', { reason: 'internal', name: e && e.name, code: e && e.code }); };
const run = (bizId, ev, opts) => Promise.resolve().then(() => onInbox(bizId, ev.params.id, ev.data && typeof ev.data.data === 'function' ? ev.data.data() : null, opts)).catch(fail);
exports.piInbox = onDocumentCreated(Object.assign({ document: 'inbox/{id}' }, OPTS), (ev) => run(null, ev));
exports.piInboxB = onDocumentCreated(Object.assign({ document: 'b/{bizId}/inbox/{id}' }, OPTS), (ev) => {
  if (!T.BIZ_RE.test(String(ev.params.bizId || ''))) return null;
  return run(ev.params.bizId, ev);
});
exports.piRetry = onSchedule({ region: NEW_REGION, schedule: 'every 15 minutes', timeZone: 'Asia/Jerusalem', timeoutSeconds: 540, memory: '512MiB', maxInstances: 1, secrets: [GEMINI_API_KEY] }, async () => {
  const r = await retryDue(Date.now());
  if (Object.keys(r).length) logger.info('piRetry', { n: Object.keys(r).length, r: Object.values(r) });
});
Object.defineProperty(exports, '_core', { enumerable: false, value: { onInbox, eligible, pagesOf, imgOf, rqOf, run, retryDue, retryOne, Q_DELAYS, Q_MAX } });
