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
// כשל בזיהוי (Gemini / מכסה / קובץ שלא מתאים לזיהוי): החשבונית **לא** נוצרת (נרשם ביומן). הסיבה: במסך העריכה אין "נסה לזהות שוב"
//   ואין הוספת שורות, וחשבונית ריקה הייתה חוסמת (dup) את הטלפון של העובד, שבגרסה הנוכחית ממשיך לנסות בעצמו עם ניסיונות חוזרים.
//   זיהוי שהצליח אבל בלי שורות – נוצרת חשבונית עם 0 שורות, בדיוק כמו בטלפון.
// "חוסרים" (hsOnInv, hs.js) – נשאר בטלפון בלבד; השרת לא קורא לו.
// אזור: europe-west1 בלבד, בלי ניסיון חוזר. שגיאה נרשמת ביומן (בלי תוכן הצילום ובלי פרטים אישיים) ולא נזרקת.
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const logger = require('firebase-functions/logger');
const { defineSecret, defineInt, defineString } = require('firebase-functions/params');
const { NEW_REGION } = require('./lib/region');
const T = require('./lib/tenant');
const scan = require('./lib/scan');
const PL = require('./lib/pricing-lines');
const { hasPerm } = require('./lib/roles');
const P = require('./pricing')._core;

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
function eligible(doc) {
  if (!doc || typeof doc !== 'object' || doc.status !== 'new' || !ID_RE.test(String(doc.owner || ''))) return null;
  let d = null;
  try { d = JSON.parse(typeof doc.data === 'string' ? doc.data : ''); } catch (e) { return null; }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  if (d.repl || d.reg || d.kind === 'check' || doc.k === 'check' || !(num(d.amt) > 0)) return null;
  const np = Number(doc.parts);
  if (!Number.isInteger(np) || np < 1 || np > MAX_PARTS) return null;
  return { d, np };
}

// הקובץ השמור מ-chunks/{id}_{k} (נכתבים לפני מסמך ה-inbox). כל חלק – של אותו עובד. אין קובץ = אין צילום
async function fileOf(db, id, np, owner) {
  const S = await db.getAll(...Array.from({ length: np }, (_, k) => db.doc('chunks/' + id + '_' + k)));
  let f = '';
  for (const s of S) {
    if (!s.exists || s.get('owner') !== owner || typeof s.get('data') !== 'string') return '';
    f += s.get('data');
  }
  return f;
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

// הזיהוי – כמו scanDocument kind 'invlines'. מחזיר { text } או זורק (המכסה כבר טופלה)
async function recognize(uid, bizId, files, o) {
  const key = o.key != null ? o.key : GEMINI_API_KEY.value();
  if (!key) throw Object.assign(new Error('no-key'), { r: 'no-key' });
  const t = scan.timesFor('invlines');
  const deadline = Date.now() + t.budgetMs;
  const caps = await scan.bizCaps(bizId, SCAN_DAILY_LIMIT.value());
  const usage = await scan.reserveScan(uid, caps.perUser, caps.bizDaily, files.length, caps.bizKey, caps.period);
  const stats = { sent: 0 };
  try {
    const body = scan.buildGeminiBody('invlines', files);
    const base = String(o.base || GEMINI_API_BASE.value()).replace(/\/+$/, '');
    const r = await scan.callGemini(base, key, body, t.timeoutMs, scan.KINDS.invlines.pro, { deadline, stats });
    return { text: r.text };
  } catch (e) {
    // כמו scanDocument: מוחזר למונה רק ניסיון שבו שום בקשה לא יצאה ל-Gemini
    if (stats.sent === 0) await scan.refundScan(uid, usage.day);
    throw e;
  }
}

// הליבה. bizId = null לשורש (legacy). doc = מסמך ה-inbox. o – לבדיקות בלבד ({ key, base })
async function onInbox(bizId, id, doc, opts) {
  const o = opts || {};
  if (!ID_RE.test(String(id || '')) || (bizId && !T.BIZ_RE.test(String(bizId)))) return { ok: false, r: 'bad' };
  const e0 = eligible(doc);
  if (!e0) return { ok: true, r: 'skip' };
  const { d, np } = e0;
  const owner = doc.owner;
  const biz = await T.loadBiz(bizId || T.BIZ0);
  if (!biz || biz.status !== 'active') return { ok: true, r: 'biz' };
  const prefix = T.bizPrefix(biz);
  if (prefix !== (bizId ? 'b/' + bizId + '/' : '')) return { ok: true, r: 'wrong-root' }; // הנתונים של העסק לא כאן
  if (!(biz.features.shelf || biz.features.orders)) return { ok: true, r: 'feature-off' };
  if (!biz.features.scan) return { ok: true, r: 'scan-off' };
  const m = await T.resolveMember(owner);
  if (m.bizId !== biz.bizId) return { ok: true, r: 'not-member' };
  return T.runInBiz({ bizId: biz.bizId, prefix, biz, uid: owner }, async () => {
    const db = T.tdb();
    const [admin, staff, cfg] = await Promise.all([db.doc('admins/' + owner).get(), db.doc('staff/' + owner).get(), db.doc('cfg/main').get()]);
    if (admin.exists || !staff.exists || staff.get('active') !== true) return { ok: true, r: 'not-staff' };
    const w = { uid: owner, role: 'employee', staff, admin, biz, bizId: biz.bizId, superadmin: false };
    if (biz.dataRoot === 'b' && !hasPerm(w, 'expW') && !hasPerm(w, 'prc')) return { ok: true, r: 'no-perm' };
    let cats = [];
    try { const j = JSON.parse(cfg.exists ? cfg.get('data') || '{}' : '{}'); cats = j && Array.isArray(j.cats) ? j.cats : []; } catch (e) { cats = []; }
    const c = cats.find((z) => z && z.id === d.cat);
    if (!c || c.beh !== 'sup') return { ok: true, r: 'not-sup' };
    P.feats(w); // w.uname – כמו piCreate
    const reqId = rqOf('o' + id);
    const pid = 'i' + reqId;
    if ((await db.doc('pinv/' + pid).get()).exists) return { ok: true, r: 'dup', id: pid }; // הטלפון כבר יצר – בלי זיהוי נוסף
    const file = await fileOf(db, id, np, owner);
    const P0 = file ? pagesOf(file) : [];
    if (!P0.length) return { ok: true, r: 'no-photo' };
    let x;
    try {
      const { files } = scan.validateScanInput({ kind: 'invlines', files: P0 }, SCAN_MAX_FILE_MB.value() * 1024 * 1024);
      const r = await recognize(owner, biz.bizId, files, o);
      x = PL.invLines(String(r.text || ''), await vatOf(db));
    } catch (e) {
      const reason = (e && e.details && e.details.reason) || (e && e.r) || 'scan-failed';
      logger.warn('piInbox: recognition failed, pinv not created', { bizId: biz.bizId, reason, code: e && e.code });
      return { ok: false, r: 'scan', reason };
    }
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
    let img = 0;
    try { img = await P.imgCore(cr.id, imgOf(P0)); } catch (e) { logger.warn('piInbox: image not stored', { bizId: biz.bizId, name: e && e.name, code: e && e.code }); }
    logger.info('piInbox: pinv created', { bizId: biz.bizId, n: hdr.lines.length, np: img });
    return { ok: true, r: 'created', id: cr.id, n: hdr.lines.length, img };
  });
}

const OPTS = { region: NEW_REGION, retry: false, timeoutSeconds: 300, memory: '512MiB', maxInstances: 5, secrets: [GEMINI_API_KEY] };
const fail = (e) => { logger.error('piInbox failed', { reason: 'internal', name: e && e.name, code: e && e.code }); };
const run = (bizId, ev, opts) => Promise.resolve().then(() => onInbox(bizId, ev.params.id, ev.data && typeof ev.data.data === 'function' ? ev.data.data() : null, opts)).catch(fail);
exports.piInbox = onDocumentCreated(Object.assign({ document: 'inbox/{id}' }, OPTS), (ev) => run(null, ev));
exports.piInboxB = onDocumentCreated(Object.assign({ document: 'b/{bizId}/inbox/{id}' }, OPTS), (ev) => {
  if (!T.BIZ_RE.test(String(ev.params.bizId || ''))) return null;
  return run(ev.params.bizId, ev);
});
Object.defineProperty(exports, '_core', { enumerable: false, value: { onInbox, eligible, pagesOf, imgOf, rqOf, run } });
