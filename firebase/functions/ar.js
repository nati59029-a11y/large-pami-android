'use strict';
// אישור הזמנה (משימה 2026-11-14_הזמנות-לקוח-עסקי-וחשבוניות, שלב 3 חלק ב'): arOc, arPdf, arSend, setArCfg.
// המנוע (PDF, קישור עם אסימון, שליחה) – שלב 3 חלק א': lib/ar-pdf.js, ar-file.js, lib/ar-send.js. כאן: הרשאות, מספור, שמירה ושליחה.
//
//   arcfg/main    { on, name, bn, addr, phone, mail, foot, wt:{oc}, logo?:true, upd, by } – פרטי העסק למסמכים (מנהל, setArCfg).
//                 on = "מסמכים פעילים" (גם בעסק legacy בלי מסמך b/). חסר / false – אין אישורי הזמנה (כמו היום).
//   arcfg/logo    { d:'data:image/png|jpeg;base64,…', at, by } – לוגו למסמכים (שרת בלבד). חסר – הלוגו של העסק (publicBrand), אם יש.
//   arcfg/seq_oc  { n } – מספור רץ נפרד לאישורי הזמנה (63). מספר נצרך רק בטרנזקציה, ולכן אין כפילות ואין חור.
//   arcfg/req_{reqId} { ord, k, r, t, by } – מזהה בקשה: ניסיון חוזר מחזיר את אותה תוצאה (לא מספר חדש, לא שליחה כפולה).
//   ord/{id}.oc   { no, ed, at, d, by, vm, vr, sig, f, pf?, sent:[{ch,to,at,ok,why?,id?,ed,auto,by}] } – תוספת בלבד (חוזה הנתונים: ord.oc).
//                 ed = מהדורה. אחרי עריכת ההזמנה (sig השתנה) – אותו מספר, מהדורה +1 (הנחה). f = שם הקובץ ב-Storage (ar/{biz}/{f}.pdf).
//   cust/{id}.snd { ch:'wa'|'mail'|'both', oc, inv, rc } – מה שולחים ללקוח ובאיזה ערוץ (85). כאן רק oc בשימוש; inv/rc – שלב 4.
//
// הרשאות: arOc / arPdf / arSend – מנהל, או עובד עם הזמנות בסניף של ההזמנה. setArCfg – פרטי העסק: מנהל; סימון שליחה ללקוח: עובד עם הזמנות ומנהל.
// הזמנה ישנה בלי vm: אישור הזמנה רק אחרי בחירה מפורשת אם המחירים כוללים מע"מ (vm בקלט).

const crypto = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { onCall } = require('./lib/region');
const logger = require('firebase-functions/logger');
const { defineSecret } = require('firebase-functions/params');
const { getStorage } = require('firebase-admin/storage');
const T = require('./lib/tenant');
const { inputObject } = require('./lib/roles');
const AC = require('./lib/ar-calc');
const PDF = require('./lib/ar-pdf');
const S = require('./lib/ar-send');
const AF = require('./ar-file')._core;
const OC = require('./orders')._core;

const WA_ACCESS_TOKEN = defineSecret('WA_ACCESS_TOKEN'); // אותו סוד של המזכירה (secretary-wa.js)
const sv = (s) => { try { return s.value() || ''; } catch (e) { return ''; } };
const { bad, deny, pre, onlyKeys, idOf, reqIdOf, NB } = OC;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const SENT_MAX = 50;
const TPL_RE = /^[a-z0-9_]{1,100}$/;
const LOGO_MAX = 400 * 1024; // אורך ה-data URL (Firestore – עד 1MB למסמך)
const CHS = ['wa', 'mail', 'both'];
const CFG_TXT = { name: 80, bn: 20, addr: 160, phone: 30, foot: 1500 };

const ilDay = (now) => new Date(now).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
const fileOf = (id, ed) => `oc_${id}_${ed}`;
const logRef = (db, id) => db.collection(`ord/${id}/log`).doc();

function access(w, d) {
  if (!d) throw new HttpsError('not-found', 'ההזמנה לא נמצאה', { reason: 'no-ord' });
  if (d.br && d.br !== NB && w.mine && !w.mine.includes(d.br)) throw deny('foreign-br', 'אין לך הרשאה להזמנה של סניף אחר');
}
function mgr(w) { if (w.role !== 'manager') throw deny('manager-only', 'הפעולה מותרת למנהל בלבד'); }
async function cfgOf(db) { const s = await db.doc('arcfg/main').get(); return s.exists ? s.data() || {} : {}; }
function needOn(cfg) { if (cfg.on !== true) throw pre('ar-off', 'מסמכים ללקוח כבויים. מנהל מפעיל אותם בהגדרות ההזמנות'); }

// חתימת התוכן של ההזמנה – כשהיא משתנה (עריכה), אישור ההזמנה הבא הוא מהדורה חדשה
function sigOf(d, vm, rate) {
  const c = d.cust || {};
  const items = (Array.isArray(d.items) ? d.items : []).map((i) => [i.pid || '', i.n || '', i.qty, i.price, i.ct || 0]);
  const s = JSON.stringify([items, d.total, d.gross, d.disc || 0, vm, rate, c.name || '', c.phone || '', c.addr || '', (c.ship && c.ship.addr) || '', d.custId || '']);
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 20);
}

// ---------- מסמך PDF ----------
async function logoOf(db, bizId) {
  try { const s = await db.doc('arcfg/logo').get(); if (s.exists && typeof s.get('d') === 'string') return s.get('d'); } catch (e) { /* */ }
  try { const b = await require('./public-brand')._core.brandOf(bizId); return (b && b.logo) || ''; } catch (e) { return ''; }
}
async function custOf(db, d) {
  if (typeof d.custId !== 'string' || !OC.ID_RE.test(d.custId)) return null;
  const s = await db.doc('cust/' + d.custId).get();
  return s.exists ? s.data() || {} : null;
}
// שורות המסמך מהפריטים. הזמנה שהסכום שלה שונה מסכום השורות (חבילת קווים – cellTotal) מקבלת שורת התאמה, כדי שהמסמך יתאים לסכום ההזמנה (הנחה)
function linesOf(d) {
  const lines = (Array.isArray(d.items) ? d.items : []).map((it) => {
    const q = Number(it.qty), ct = Number(it.ct);
    return { n: String(it.n || ''), q, p: Number(it.price), u: ct > 0 && Number.isInteger(q / ct) ? `${q / ct} קרטונים × ${ct}` : '' };
  });
  const sum = lines.reduce((s, l) => s + Math.round(l.q * l.p * 100), 0);
  const tot = isNum(d.total) ? AC.ag(d.total) : sum;
  if (tot !== sum) lines.push({ n: 'התאמה לפי מחיר החבילה', q: 1, p: (tot - sum) / 100, u: '' });
  return lines;
}
async function build(db, w, d, oc, cfg) {
  const c = await custOf(db, d);
  const k = d.cust || {};
  const doc = {
    t: 'oc', no: oc.no, ed: oc.ed, d: oc.d,
    biz: { name: cfg.name || '', bn: cfg.bn || '', addr: cfg.addr || '', phone: cfg.phone || '', mail: cfg.mail || '', foot: cfg.foot || '', logo: await logoOf(db, w.bizId) },
    cust: { name: (c && c.wholesale === true && c.bn) || k.name || '', bn: (c && c.vat) || '', addr: (k.ship && k.ship.addr) || k.addr || '', phone: k.phone || '', mail: k.mail || (c && c.mail) || '' },
    vm: oc.vm, rate: oc.vr, lines: linesOf(d),
  };
  if (d.vm && isNum(d.disc) && d.disc > 0) doc.disc = d.disc;
  if (c && c.wholesale === true) doc.terms = AC.termsTxt(AC.termsOfCust(c));
  if (!doc.biz.name) { try { const b = await require('./public-brand')._core.brandOf(w.bizId); doc.biz.name = (b && b.name) || ''; } catch (e) { /* */ } }
  // הזמנה עם vm: הסכום לתשלום במסמך חייב להיות בדיוק gross של ההזמנה (אותו חישוב – ar-calc.totals)
  const k2 = PDF.calc(doc);
  if (d.vm && isNum(d.gross) && k2.gross !== AC.ag(d.gross)) throw pre('sum-mismatch', 'סכום אישור ההזמנה לא תואם להזמנה. פנו למנהל');
  return { buf: await PDF.render(doc), gross: k2.gross / 100, cust: doc.cust };
}
async function put(w, f, buf) { return AF.put(w.bizId, f, buf); }
async function bufOf(db, w, d, oc, cfg) {
  if (oc.pf) { try { const [b] = await getStorage().bucket().file(AF.pathOf(w.bizId, oc.f)).download(); return { buf: b }; } catch (e) { /* קובץ חסר – נבנה שוב אם התוכן לא השתנה */ } }
  if (sigOf(d, oc.vm, oc.vr) !== oc.sig) throw pre('oc-stale', 'ההזמנה השתנתה מאז אישור ההזמנה. הפיקו מהדורה חדשה');
  const r = await build(db, w, d, oc, cfg);
  await put(w, oc.f, r.buf);
  return r;
}

// ---------- שליחה ----------
const nameOf = (oc) => `אישור הזמנה ${oc.no}${oc.ed > 1 ? '-' + oc.ed : ''}.pdf`;
async function sendOne(db, w, ch, to, auto, ctx) {
  const { oc, cfg, buf, d } = ctx;
  const now = Date.now();
  const amt = PDF.money(AC.payOf(d));
  const bizName = cfg.name || '';
  if (ch === 'wa') {
    const tpl = cfg.wt && TPL_RE.test(String(cfg.wt.oc || '')) ? cfg.wt.oc : '';
    if (!tpl) return { ch: 'wa', to: String(to || '').slice(0, 30), at: now, ok: false, why: 'no-tpl' };
    const lk = await AF.mkLink({ biz: w.bizId, id: oc.f, n: nameOf(oc) });
    return S.sendWa(db, { to, tpl: { name: tpl, lang: 'he', params: [(d.cust && d.cust.name) || '', String(oc.no), amt] }, link: lk.url, fileName: nameOf(oc), auto, by: w.uid, token: sv(WA_ACCESS_TOKEN), now });
  }
  const text = `שלום ${(d.cust && d.cust.name) || ''},\nמצורף אישור הזמנה מס׳ ${oc.no}${oc.ed > 1 ? ' (מהדורה ' + oc.ed + ')' : ''} על סך ${amt}.\n${bizName}`;
  return S.sendMail(w.bizId, { to, subject: `אישור הזמנה ${oc.no}${bizName ? ' – ' + bizName : ''}`, text, replyTo: cfg.mail, fromName: bizName, pdf: buf, fileName: nameOf(oc), by: w.uid, now });
}
function targets(snd, d, c, ch, to) {
  const k = d.cust || {};
  const phone = k.phone || (c && c.phone) || '';
  const mail = k.mail || (c && c.mail) || '';
  if (ch) return [[ch, to || (ch === 'wa' ? phone : mail)]];
  const out = [];
  if (snd.ch === 'wa' || snd.ch === 'both') out.push(['wa', phone]);
  if (snd.ch === 'mail' || snd.ch === 'both') out.push(['mail', mail]);
  return out;
}
// רישום ב-ord.oc.sent (עד 50 אחרונים), רק אם המהדורה לא התחלפה בינתיים
async function record(db, id, ed, recs, extra) {
  const ref = db.doc('ord/' + id);
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const oc = s.exists && s.get('oc');
    if (!oc || oc.ed !== ed) return;
    const up = Object.assign({}, extra || {});
    if (recs.length) up['oc.sent'] = (Array.isArray(oc.sent) ? oc.sent : []).concat(recs).slice(-SENT_MAX);
    if (Object.keys(up).length) tx.update(ref, up);
  });
}
const sentRec = (r, ed, auto, by) => Object.assign({}, r, { ed, auto: !!auto, by });

// ---------- arOc ----------
// arOc({ id, reqId, vm? }) → { no, ed, fresh, dup, gross, sent:[…], oc }
//   מספר חדש רק בפעם הראשונה להזמנה. אותו תוכן – אותו מספר ואותה מהדורה. תוכן שהשתנה – אותו מספר, מהדורה חדשה.
//   לקוח שמסומן לקבל אישור הזמנה (cust.snd.oc) – נשלח אוטומטית, בלי לחיצה נוספת (84), במהדורה חדשה בלבד.
async function arOc(request) {
  const w = await OC.who(request);
  const input = inputObject(request);
  onlyKeys(input, ['id', 'reqId', 'vm']);
  const id = idOf(input.id, 'הזמנה');
  const reqId = reqIdOf(input);
  if (input.vm != null && input.vm !== 'ex' && input.vm !== 'inc') throw bad('bad-vm', 'בחרו: מחירים כוללים מע"מ או לפני מע"מ');
  const db = T.tdb();
  const cfg = await cfgOf(db);
  needOn(cfg);
  const ref = db.doc('ord/' + id), seq = db.doc('arcfg/seq_oc'), mark = db.doc('arcfg/req_' + reqId);
  let res = null;
  await db.runTransaction(async (tx) => {
    const [m, s, q, mc] = await tx.getAll(mark, ref, seq, db.doc('ordcfg/main'));
    const d = s.exists ? s.data() : null;
    access(w, d);
    if (m.exists) {
      if (m.get('ord') !== id || m.get('k') !== 'oc') throw bad('bad-req', 'מזהה הבקשה כבר שימש לפעולה אחרת');
      res = Object.assign({}, m.get('r'), { dup: true });
      return;
    }
    if (d.status === 'cancel') throw pre('cancelled', 'ההזמנה בוטלה');
    const old = d.oc && typeof d.oc === 'object' && Number.isInteger(d.oc.no) ? d.oc : null;
    const vm = d.vm === 'ex' || d.vm === 'inc' ? d.vm : input.vm || (old && old.vm) || null;
    if (!vm) throw pre('need-vm', 'הזמנה ישנה: בחרו אם המחירים כוללים מע"מ');
    const rate = isNum(d.vr) ? d.vr : (mc.exists && isNum(mc.get('vat')) ? mc.get('vat') : AC.VAT0);
    const sig = sigOf(d, vm, rate);
    const now = Date.now();
    let oc, fresh = false;
    if (old && old.sig === sig) oc = old;
    else {
      fresh = true;
      const no = old ? old.no : (q.exists && Number.isInteger(q.get('n')) ? q.get('n') : 0) + 1;
      const ed = old ? (old.ed || 1) + 1 : 1;
      if (!old) tx.set(seq, { n: no });
      oc = { no, ed, at: now, d: ilDay(now), by: w.uid, vm, vr: rate, sig, f: fileOf(id, ed), sent: old && Array.isArray(old.sent) ? old.sent : [] };
      tx.update(ref, { oc });
      tx.set(logRef(db, id), { t: now, by: w.uid, act: 'oc', note: `אישור הזמנה #${no}${ed > 1 ? ' מהדורה ' + ed : ''}` });
    }
    res = { no: oc.no, ed: oc.ed, fresh };
    tx.set(mark, { ord: id, k: 'oc', r: res, t: now, by: w.uid });
  }, { maxAttempts: 50 });
  // אחרי הטרנזקציה: קובץ, ושליחה אוטומטית. כשל כאן לא מבטל את המספר (אין חור) – הלחיצה הבאה בונה שוב את הקובץ
  const s = await ref.get();
  const d = s.data();
  const oc = d.oc;
  const out = Object.assign({}, res, { gross: AC.payOf(d), sent: [] });
  if (oc.ed !== res.ed) return Object.assign(out, { oc });
  let buf = null, extra = {};
  if (!oc.pf) {
    const r = await build(db, w, d, oc, cfg);
    await put(w, oc.f, r.buf);
    buf = r.buf; extra = { 'oc.pf': true };
  }
  const recs = [];
  if (res.fresh && !res.dup) {
    const c = await custOf(db, d);
    const snd = c && c.snd && typeof c.snd === 'object' ? c.snd : null;
    if (snd && snd.oc === true && CHS.includes(snd.ch)) {
      if (!buf) buf = (await bufOf(db, w, d, oc, cfg)).buf;
      for (const [ch, to] of targets(snd, d, c)) {
        const r = to ? await sendOne(db, w, ch, to, true, { oc, cfg, buf, d }) : { ch, to: '', at: Date.now(), ok: false, why: 'no-to' };
        recs.push(sentRec(r, oc.ed, true, w.uid));
      }
    }
  }
  await record(db, id, oc.ed, recs, extra);
  out.sent = recs;
  out.oc = Object.assign({}, oc, extra['oc.pf'] ? { pf: true } : {}, { sent: (oc.sent || []).concat(recs).slice(-SENT_MAX) });
  return out;
}

// arPdf({ id }) → { no, ed, name, b64, stale } – הקובץ של המהדורה האחרונה (לשיתוף מהטלפון). stale = ההזמנה השתנתה מאז
async function arPdf(request) {
  const w = await OC.who(request);
  const input = inputObject(request);
  onlyKeys(input, ['id']);
  const id = idOf(input.id, 'הזמנה');
  const db = T.tdb();
  const cfg = await cfgOf(db);
  needOn(cfg);
  const s = await db.doc('ord/' + id).get();
  const d = s.exists ? s.data() : null;
  access(w, d);
  const oc = d.oc && Number.isInteger(d.oc.no) ? d.oc : null;
  if (!oc) throw pre('no-oc', 'עוד לא הופק אישור הזמנה');
  const stale = sigOf(d, oc.vm, oc.vr) !== oc.sig;
  let buf;
  try { const [b] = await getStorage().bucket().file(AF.pathOf(w.bizId, oc.f)).download(); buf = b; } catch (e) { buf = (await bufOf(db, w, d, oc, cfg)).buf; }
  return { no: oc.no, ed: oc.ed, name: nameOf(oc), b64: buf.toString('base64'), stale };
}

// arSend({ id, reqId, ch:'wa'|'mail', to? }) – שליחה בלחיצה של המהדורה האחרונה ("עצור הכל" לא עוצר לחיצה – כמו בהחלטה 31).
// מזהה בקשה: ניסיון חוזר לא שולח שוב.
async function arSend(request) {
  const w = await OC.who(request);
  const input = inputObject(request);
  onlyKeys(input, ['id', 'reqId', 'ch', 'to']);
  const id = idOf(input.id, 'הזמנה');
  const reqId = reqIdOf(input);
  if (input.ch !== 'wa' && input.ch !== 'mail') throw bad('bad-ch', 'בחרו ווטסאפ או מייל');
  const to = input.to == null || input.to === '' ? '' : String(input.to).trim().slice(0, 254);
  const db = T.tdb();
  const cfg = await cfgOf(db);
  needOn(cfg);
  const s = await db.doc('ord/' + id).get();
  const d = s.exists ? s.data() : null;
  access(w, d);
  const mark = db.doc('arcfg/req_' + reqId);
  const ms = await mark.get();
  if (ms.exists) {
    if (ms.get('ord') !== id || ms.get('k') !== 'send') throw bad('bad-req', 'מזהה הבקשה כבר שימש לפעולה אחרת');
    return Object.assign({}, ms.get('r') || {}, { dup: true });
  }
  const oc = d.oc && Number.isInteger(d.oc.no) ? d.oc : null;
  if (!oc) throw pre('no-oc', 'עוד לא הופק אישור הזמנה');
  try { await mark.create({ ord: id, k: 'send', t: Date.now(), by: w.uid }); } catch (e) {
    if (e && (e.code === 6 || /already exists/i.test(String(e.message)))) return { dup: true, sent: [] };
    throw e;
  }
  const c = await custOf(db, d);
  const { buf } = await bufOf(db, w, d, oc, cfg);
  const recs = [];
  for (const [ch, t] of targets({}, d, c, input.ch, to)) {
    const r = t ? await sendOne(db, w, ch, t, false, { oc, cfg, buf, d }) : { ch, to: '', at: Date.now(), ok: false, why: 'no-to' };
    recs.push(sentRec(r, oc.ed, false, w.uid));
  }
  await record(db, id, oc.ed, recs);
  if (recs.some((r) => r.ok)) await db.collection(`ord/${id}/log`).doc().set({ t: Date.now(), by: w.uid, act: 'ocSend', note: `אישור הזמנה #${oc.no} נשלח ב${input.ch === 'wa' ? 'ווטסאפ' : 'מייל'}` });
  const r = { no: oc.no, ed: oc.ed, sent: recs };
  await mark.update({ r });
  return r;
}

// ---------- setArCfg ----------
// מנהל: { on?, name?, bn?, addr?, phone?, mail?, foot?, wt?:{oc}, logo?:data URL | '' }
// סימון ללקוח (עובד עם הזמנות ומנהל): { cust, snd:{ ch, oc, inv?, rc? } | null }
function txtIn(v, n, label) {
  if (v == null) return '';
  if (typeof v !== 'string') throw bad('bad-cfg', label + ': טקסט');
  const s = v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f‪-‮⁦-⁩]/g, '').trim();
  if (s.length > n) throw bad('bad-cfg', `${label}: עד ${n} תווים`);
  return s;
}
async function setArCfg(request) {
  const w = await OC.who(request);
  const input = inputObject(request);
  const db = T.tdb();
  const now = Date.now();
  if (input.cust !== undefined) {
    onlyKeys(input, ['cust', 'snd']);
    const cid = idOf(input.cust, 'לקוח');
    let snd = null;
    if (input.snd != null) {
      const x = input.snd;
      if (typeof x !== 'object' || Array.isArray(x)) throw bad('bad-snd', 'סימון שליחה לא תקין');
      onlyKeys(x, ['ch', 'oc', 'inv', 'rc'], 'סימון שליחה');
      if (!CHS.includes(x.ch)) throw bad('bad-snd', 'ערוץ: ווטסאפ, מייל או שניהם');
      snd = { ch: x.ch, oc: x.oc === true, inv: x.inv === true, rc: x.rc === true };
    }
    const ref = db.doc('cust/' + cid);
    const s = await ref.get();
    if (!s.exists || s.get('mv')) throw new HttpsError('not-found', 'הלקוח לא נמצא', { reason: 'no-cust' });
    await ref.update({ snd: snd || require('firebase-admin/firestore').FieldValue.delete(), sndBy: w.uid, sndAt: now });
    return { ok: true, snd };
  }
  mgr(w);
  onlyKeys(input, ['on', 'name', 'bn', 'addr', 'phone', 'mail', 'foot', 'wt', 'logo']);
  const up = {};
  if (input.on !== undefined) { if (typeof input.on !== 'boolean') throw bad('bad-cfg', 'מסמכים פעילים: כן/לא'); up.on = input.on; }
  for (const [k, n] of Object.entries(CFG_TXT)) if (input[k] !== undefined) up[k] = txtIn(input[k], n, k);
  if (input.mail !== undefined) {
    const m = txtIn(input.mail, 254, 'mail').toLowerCase();
    if (m && !S.EMAIL_RE.test(m)) throw bad('bad-email', 'כתובת המייל לא תקינה');
    up.mail = m;
  }
  if (input.wt !== undefined) {
    const x = input.wt;
    if (!x || typeof x !== 'object' || Array.isArray(x)) throw bad('bad-cfg', 'תבנית ווטסאפ לא תקינה');
    onlyKeys(x, ['oc'], 'תבנית');
    const oc = x.oc == null ? '' : String(x.oc).trim();
    if (oc && !TPL_RE.test(oc)) throw bad('bad-tpl', 'שם תבנית: אותיות אנגליות קטנות, ספרות וקו תחתון');
    up.wt = { oc };
  }
  if (input.logo !== undefined) {
    if (input.logo === '' || input.logo === null) { await db.doc('arcfg/logo').delete(); up.logo = false; }
    else {
      if (typeof input.logo !== 'string' || input.logo.length > LOGO_MAX || !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(input.logo) || !PDF.logoBuf(input.logo)) throw bad('bad-logo', 'לוגו: קובץ PNG או JPEG עד 300KB');
      await db.doc('arcfg/logo').set({ d: input.logo, at: now, by: w.uid });
      up.logo = true;
    }
  }
  if (!Object.keys(up).length) throw bad('bad-cfg', 'אין מה לשמור');
  await db.doc('arcfg/main').set(Object.assign(up, { upd: now, by: w.uid }), { merge: true });
  return { ok: true };
}

const wrap = (name, fn) => T.scoped(async (request) => {
  try { return await fn(request); } catch (e) {
    if (e instanceof HttpsError) throw e;
    if (e && e.reason && /^ar-pdf: /.test(String(e.message))) throw pre(e.reason, 'לא ניתן להפיק את המסמך: ' + e.reason);
    logger.error(`ar: ${name} failed`, { reason: 'internal', name: e && e.name, code: e && e.code });
    throw new HttpsError('internal', 'שגיאה בפעולה. נסו שוב.', { reason: 'internal' });
  }
});
const FNS = { arOc, arPdf, arSend, setArCfg };
const SENDS = ['arOc', 'arSend']; // שולחות: סוד ווטסאפ + סודות המייל
for (const [k, f] of Object.entries(FNS)) exports[k] = onCall(SENDS.includes(k) ? { secrets: [WA_ACCESS_TOKEN].concat(S.MAIL_SECRETS), timeoutSeconds: 120, memory: '512MiB' } : { memory: '512MiB' }, wrap(k, f));
Object.defineProperty(exports, '_core', { enumerable: false, value: { sigOf, linesOf, fileOf, ilDay } });
