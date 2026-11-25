'use strict';
// הצעת מחיר – מסמך PDF ושליחה ללקוח (משימה 2026-11-24_הצעת-מחיר-ומיון-חיפוש, שלב 4).
// קובץ נפרד מ-quotes.js (שם: שמירה, אישור, המרה). כאן רק קריאה של ההצעה – בלי שינוי בתוכן, במחירים או בסטטוס.
//
//   qtPdf({ id })                         → { no, name, b64, vu }   – הקובץ לשיתוף מהטלפון
//   qtSend({ id, reqId, ch:'wa'|'mail', to? }) → { no, sent:[{ch,to,at,ok,why?,id?,auto,by}], dup? }
//
// בדיוק כמו arPdf / arSend של אישור ההזמנה (ar.js):
//   - דורש arcfg/main.on (פרטי העסק למסמך). אחרת ar-off.
//   - הרשאה: quotes._core.loadQt – who() (תוספת orders + הרשאת ord) וסניף ההצעה (עובד מסניף אחר → foreign-br).
//   - עיצוב: אותו מנוע (lib/ar-pdf.js), t:'qt' → כותרת "הצעת מחיר", מס׳ רץ (qt.no), "בתוקף עד" (qt.vu – תאריך, לא מספר ימים).
//     הסכום לתשלום במסמך חייב להיות בדיוק qt.gross (אחרת sum-mismatch – לא יוצא מסמך עם סכום אחר).
//   - ווטסאפ מהשרת רק עם תבנית מאושרת arcfg.wt.qt (WT_KEYS ב-ar.js). בלי תבנית → why:'no-tpl' (המסך מציע "שיתוף").
//   - מזהה בקשה (reqId): arcfg/req_{reqId} { qt, k:'qtSend' } נוצר **לפני** השליחה (create אטומי) – ניסיון חוזר / לחיצה כפולה
//     (גם במקביל) לא שולחים פעמיים. מחזירים את התוצאה הקודמת עם dup:true.
//   - הקובץ נשמר ב-Storage (ar/{biz}/qt_{id}.pdf – נדרש לקישור בווטסאפ). הצעה לא ניתנת לעריכה, לכן הקובץ נבנה פעם אחת (qt.pf).
//   - תוספת בלבד במסמך ההצעה: f, pf, sent[] (עד 50 אחרונים) + יומן qt/{id}/log (act:'send'). שום שדה אחר לא משתנה.
//   - הצעה שבוטלה (st:'cancel') – לא נשלחת (qt-closed). הפקת קובץ לצפייה – מותרת בכל מצב (הנחה).
// בבדיקות: deps = { send } לווטסאפ ו-{ mail } למייל (ספק מדומה) – רק דרך _core.call, לעולם לא מהאפליקציה.

const { HttpsError } = require('firebase-functions/v2/https');
const { onCall } = require('./lib/region');
const logger = require('firebase-functions/logger');
const { getStorage } = require('firebase-admin/storage');
const T = require('./lib/tenant');
const { inputObject } = require('./lib/roles');
const AC = require('./lib/ar-calc');
const PDF = require('./lib/ar-pdf');
const S = require('./lib/ar-send');
const AF = require('./ar-file')._core;
const AR = require('./ar')._core;
const O = require('./orders')._core;
const Q = require('./quotes')._core;

const { bad, pre } = O;
const SENT_MAX = 50;
const TPL_RE = /^[a-z0-9_]{1,100}$/;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const sv = (s) => { try { return s.value() || ''; } catch (e) { return ''; } };

const fileOf = (id) => 'qt_' + id;
const nameOf = (d) => `הצעת מחיר ${d.no}.pdf`;
const shDate = (d) => PDF.dateTxt(d);
function needOn(cfg) { if (cfg.on !== true) throw pre('ar-off', 'מסמכים ללקוח כבויים. מנהל מפעיל אותם בהגדרות ההזמנות'); }

// ---------- המסמך ----------
async function build(db, w, d, cfg) {
  const c = await AR.custOf(db, d);
  const k = d.cust || {};
  const doc = {
    t: 'qt', no: d.no, d: Q.ilDay(isNum(d.at) ? d.at : Date.now()), vu: d.vu,
    biz: await AR.bizOf(db, w, cfg),
    cust: { name: (c && c.wholesale === true && c.bn) || k.name || '', bn: (c && c.vat) || '', addr: (k.ship && k.ship.addr) || k.addr || '', phone: k.phone || '', mail: k.mail || (c && c.mail) || '' },
    vm: d.vm, rate: d.vr, lines: AR.linesOf(d),
  };
  if (isNum(d.disc) && d.disc > 0) doc.disc = d.disc;
  if (c && c.wholesale === true) doc.terms = AC.termsTxt(AC.termsOfCust(c));
  const k2 = PDF.calc(doc);
  if (!isNum(d.gross) || k2.gross !== AC.ag(d.gross)) throw pre('sum-mismatch', 'סכום הצעת המחיר לא תואם. פנו למנהל');
  return PDF.render(doc);
}
// הקובץ: מ-Storage אם כבר נבנה, אחרת בונים, שומרים ומסמנים pf (תוספת בלבד – ההצעה עצמה לא משתנה)
async function bufOf(db, w, ref, d, cfg) {
  const f = fileOf(ref.id);
  if (d.pf) { try { const [b] = await getStorage().bucket().file(AF.pathOf(w.bizId, f)).download(); return b; } catch (e) { /* קובץ חסר – בונים שוב */ } }
  const b = await build(db, w, d, cfg);
  await AF.put(w.bizId, f, b);
  if (!d.pf) await ref.update({ f, pf: true });
  return b;
}

// ---------- שליחה ----------
async function sendOne(db, w, ch, to, d, cfg, buf, deps) {
  const now = Date.now();
  const amt = PDF.money(d.gross);
  const nm = (d.cust && d.cust.name) || '';
  const bizName = cfg.name || '';
  if (ch === 'wa') {
    const tpl = cfg.wt && TPL_RE.test(String(cfg.wt.qt || '')) ? cfg.wt.qt : '';
    if (!tpl) return { ch: 'wa', to: String(to || '').slice(0, 30), at: now, ok: false, why: 'no-tpl' };
    const lk = await AF.mkLink({ biz: w.bizId, id: d.f || fileOf(d.id), n: nameOf(d) });
    return S.sendWa(db, { to, tpl: { name: tpl, lang: 'he', params: [nm, String(d.no), amt, shDate(d.vu)] }, link: lk.url, fileName: nameOf(d), auto: false, by: w.uid, token: sv(AR.WA_ACCESS_TOKEN), now, send: deps && deps.send });
  }
  const text = `שלום ${nm},\nמצורפת הצעת מחיר מס׳ ${d.no} על סך ${amt}.\nההצעה בתוקף עד ${shDate(d.vu)}.\n${bizName}`;
  return S.sendMail(w.bizId, { to, subject: `הצעת מחיר ${d.no}${bizName ? ' – ' + bizName : ''}`, text, replyTo: cfg.mail, fromName: bizName, pdf: buf, fileName: nameOf(d), by: w.uid, now }, deps && deps.mail);
}

// =====================================================================================
// qtPdf({ id }) → { no, name, b64, vu }
// =====================================================================================
async function qtPdf(request) {
  const w = await O.who(request);
  const input = inputObject(request);
  O.onlyKeys(input, ['id']);
  const db = T.tdb();
  const cfg = await AR.cfgOf(db);
  needOn(cfg);
  const { ref, d } = await Q.loadQt(null, db, w, input.id);
  const buf = await bufOf(db, w, ref, d, cfg);
  return { no: d.no, name: nameOf(d), b64: buf.toString('base64'), vu: d.vu };
}

// =====================================================================================
// qtSend({ id, reqId, ch:'wa'|'mail', to? }) → { no, sent, dup? }   – שליחה בלחיצה בלבד (auto:false)
// =====================================================================================
async function qtSend(request, deps) {
  const w = await O.who(request);
  const input = inputObject(request);
  O.onlyKeys(input, ['id', 'reqId', 'ch', 'to']);
  const reqId = O.reqIdOf(input);
  if (input.ch !== 'wa' && input.ch !== 'mail') throw bad('bad-ch', 'בחרו ווטסאפ או מייל');
  const to = input.to == null || input.to === '' ? '' : String(input.to).trim().slice(0, 254);
  const db = T.tdb();
  const cfg = await AR.cfgOf(db);
  needOn(cfg);
  const { ref, d } = await Q.loadQt(null, db, w, input.id);
  const id = ref.id;
  const mark = db.doc('arcfg/req_' + reqId);
  const ms = await mark.get();
  if (ms.exists) {
    if (ms.get('qt') !== id || ms.get('k') !== 'qtSend') throw bad('bad-req', 'מזהה הבקשה כבר שימש לפעולה אחרת');
    return Object.assign({ no: d.no, sent: [] }, ms.get('r') || {}, { dup: true });
  }
  if (d.st === 'cancel') throw pre('qt-closed', 'ההצעה בוטלה');
  // רישום לפני השליחה: create אטומי – קריאה מקבילה עם אותו reqId לא תשלח שוב
  try { await mark.create({ qt: id, k: 'qtSend', t: Date.now(), by: w.uid }); } catch (e) {
    if (e && (e.code === 6 || /already exists/i.test(String(e.message)))) return { no: d.no, dup: true, sent: [] };
    throw e;
  }
  const c = await AR.custOf(db, d);
  const buf = await bufOf(db, w, ref, d, cfg);
  const dd = Object.assign({ id, f: fileOf(id) }, d);
  const recs = [];
  for (const [ch, t] of AR.targets({}, d, c, input.ch, to)) {
    const r = t ? await sendOne(db, w, ch, t, dd, cfg, buf, deps) : { ch, to: '', at: Date.now(), ok: false, why: 'no-to' };
    recs.push(Object.assign({}, r, { auto: false, by: w.uid }));
  }
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) return;
    tx.update(ref, { sent: (Array.isArray(s.get('sent')) ? s.get('sent') : []).concat(recs).slice(-SENT_MAX) });
    const ok = recs.some((x) => x.ok);
    tx.set(Q.logRef(db, id), O.logData(w, 'send', `${ok ? 'נשלחה' : 'לא נשלחה'} ב${input.ch === 'wa' ? 'ווטסאפ' : 'מייל'}${ok ? '' : ' (' + recs.map((x) => x.why || '').join(',') + ')'}`));
  });
  const r = { no: d.no, sent: recs };
  await mark.update({ r });
  return r;
}

const wrap = (name, fn, deps) => T.scoped(async (request) => {
  try { return await fn(request, deps); } catch (e) {
    if (e instanceof HttpsError) throw e;
    if (e && e.reason && /^ar-pdf: /.test(String(e.message))) throw pre(e.reason, 'לא ניתן להפיק את המסמך: ' + e.reason);
    logger.error(`quotes-pdf: ${name} failed`, { reason: 'internal', name: e && e.name, code: e && e.code });
    throw new HttpsError('internal', 'שגיאה בפעולה. נסו שוב.', { reason: 'internal' });
  }
});
const FNS = { qtPdf, qtSend };
const OPT = { qtPdf: { memory: '512MiB' }, qtSend: { secrets: [AR.WA_ACCESS_TOKEN].concat(S.MAIL_SECRETS), timeoutSeconds: 120, memory: '512MiB' } };
for (const [k, f] of Object.entries(FNS)) exports[k] = onCall(OPT[k], wrap(k, f));
// call.<fn>(deps) – לבדיקות בתהליך: אותה עטיפה, עם ספק שליחה מדומה
Object.defineProperty(exports, '_core', { enumerable: false, value: { qtPdf, qtSend, build, fileOf, nameOf, call: { qtPdf: () => wrap('qtPdf', qtPdf), qtSend: (deps) => wrap('qtSend', qtSend, deps) } } });
