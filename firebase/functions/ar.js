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
const WT_KEYS = ['oc', 'inv', 'ir', 'rc', 'cr', 'st'];

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
  onlyKeys(input, ['on', 'name', 'bn', 'addr', 'phone', 'mail', 'foot', 'wt', 'logo', 'z']); // z (שלב 4): לכל סניף – "מה ששולם בקופה כבר נספר בדוח Z" (החלטה 6)
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
    onlyKeys(x, WT_KEYS, 'תבנית'); // שלב 4: גם חשבונית (inv), חשבונית מס קבלה (ir), קבלה (rc), זיכוי (cr), סיכום חודשי (st)
    const cur = (await cfgOf(db)).wt || {};
    const wt = {};
    for (const k of WT_KEYS) {
      const v = x[k] === undefined ? (k === 'oc' ? '' : cur[k] || '') : x[k] == null ? '' : String(x[k]).trim();
      if (v && !TPL_RE.test(v)) throw bad('bad-tpl', 'שם תבנית: אותיות אנגליות קטנות, ספרות וקו תחתון');
      if (v || k === 'oc') wt[k] = v;
    }
    up.wt = wt;
  }
  if (input.z !== undefined) {
    const x = input.z;
    if (!x || typeof x !== 'object' || Array.isArray(x) || Object.keys(x).length > 50) throw bad('bad-cfg', 'דוח Z לפי סניף – לא תקין');
    for (const [k, v] of Object.entries(x)) if (!/^([a-z0-9_]{2,20}|_)$/.test(k) || typeof v !== 'boolean') throw bad('bad-cfg', 'דוח Z לפי סניף – לא תקין');
    up.z = x;
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

// =====================================================================================
// שלב 4 (15.11.2026): חשבוניות מס, קבלות וזיכויים – "טיוטה – לא מסמך רשמי" עד שמנהל־העל מדליק את arcfg/off.on.
// הספר עצמו (מספור, יתרה, הקצאות, docUpd) – lib/ar-doc.js. כאן: הרשאות, קלט, PDF ושליחה.
//   arIssue    – חשבונית ידנית מהזמנה (מנהל / עובד עם הזמנות בסניף). הזמנה ישנה בלי vm – רק עם בחירה מפורשת.
//   arReceipt  – קבלה ללקוח: תשלום חלקי, בחירת חשבוניות, עודף = זכות. עובד – רק עם אסמכתא שהעלה (arProof), גם במזומן (החלטה 25).
//   arCredit   – חשבונית זיכוי (מלא / שורות / סכום) עם הפניה לחשבונית; "החזרה למלאי" כבויה כברירת מחדל (החלטה 11). מנהל ועובד עם הזמנות (73).
//   arVoidRc   – ביטול קבלה (מנהל, עם סיבה): המספר נשמר, ההקצאות מבוטלות, קובץ חדש עם "מבוטל" ליד המקור (הנוהל – לא מאומת).
//                החלטה 37: נדחה (rc-refunded) כשעל חשבונית שהקבלה הוקצתה אליה יש זיכוי עם החזר כסף.
//   arProof / arProofGet – אסמכתא בחלקים (עד 5MB, jpeg/png/pdf). צפייה: מנהל ומי שהעלה. לא נשלחת ללקוח ולא נכתבת ליומן.
//   arMonthly  – מסמך סיכום חודשי ללקוח (לא חשבונית מס – החלטה 23). ידני בשלב הזה.
//   arDoc      – קובץ המסמך (pdf), שליחה בלחיצה (send), שינוי מועד תשלום לחשבונית (due – מנהל, 79).
//   setArOff   – מנהל־על בלבד: on (רשמי), bt (עוסק מורשה / חברה / פטור), start (מספר התחלה לסדרה הרשמית), amin (סף מספר הקצאה).
// =====================================================================================
const ARD = require('./lib/ar-doc');
const DT = { inv: 'חשבונית מס', ir: 'חשבונית מס קבלה', rc: 'קבלה', cr: 'חשבונית מס זיכוי', st: 'סיכום חשבוניות' };
const DT_PATUR = { inv: 'חשבון עסקה', ir: 'חשבון עסקה / קבלה', cr: 'זיכוי' }; // עוסק פטור – לא מוציא חשבונית מס (לא מאומת – לבדיקה עם רואה החשבון)
const PAYN = { cash: 'מזומן', transfer: 'העברה בנקאית', chq: 'צ׳ק', card: 'אשראי', other: 'אחר' };
const titleOf = (doc) => (doc.bt === 'patur' && DT_PATUR[doc.t]) || DT[doc.t] || '';
const docName = (doc, v) => `${titleOf(doc)} ${doc.no}${v ? ' (מבוטל)' : ''}.pdf`;
const shDate = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || '')); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
const ag2 = (a) => PDF.moneyAg(a);
// "זיכוי לחשבונית מס מספר 12" / "... לחשבונית מס קבלה מספר 7 (טיוטה)" – מהמזהה של חשבונית החיוב ({t}{D|O}{no}, ar-doc.docId)
// החלטה 31: "הוחזר ללקוח: זיכוי באשראי, ₪X" – על מסמך הזיכוי
const RFN = { card: 'זיכוי באשראי', cash: 'החזר מזומן', transfer: 'החזר בהעברה בנקאית', chq: 'החזר בצ׳ק', other: 'החזר – אחר' };
const rfTxt = (rf) => (rf && Number.isInteger(rf.amt) ? `הוחזר ללקוח: ${RFN[rf.m] || RFN.other}, ${ag2(rf.amt)}` : '');
const refTxt = (ref, bt) => { const m = /^(inv|ir)([DO])(\d+)$/.exec(String(ref || '')); return m ? `זיכוי ל${titleOf({ t: m[1], bt })} מספר ${m[3]}${m[2] === 'D' ? ' (טיוטה)' : ''}` : ''; };
const AMT_MAX = 100000000; // ₪1,000,000 באגורות לקבלה / זיכוי אחד (הנחה)

async function bizOf(db, w, cfg) {
  const biz = { name: cfg.name || '', bn: cfg.bn || '', addr: cfg.addr || '', phone: cfg.phone || '', mail: cfg.mail || '', foot: cfg.foot || '', logo: await logoOf(db, w.bizId) };
  if (!biz.name) { try { const b = await require('./public-brand')._core.brandOf(w.bizId); biz.name = (b && b.name) || ''; } catch (e) { /* */ } }
  return biz;
}
// מסמך PDF מ-ardoc. התוכן קבוע – בנייה חוזרת נותנת אותו מסמך. isVoid – עותק עם "מבוטל" (ביטול קבלה)
async function docRender(db, w, doc, cfg, isVoid) {
  const base = { t: doc.t === 'rc' ? 'rc' : doc.t, no: doc.no, d: doc.d, draft: !!doc.draft, biz: await bizOf(db, w, cfg), cust: doc.custSnap || {}, vm: doc.vm, rate: doc.rate, title: titleOf(doc) + (isVoid ? ' – מבוטל' : '') };
  const notes = [];
  if (doc.t === 'rc') {
    const p = doc.pay || {};
    const det = [p.chq ? `צ׳ק ${p.chq.no} · ${p.chq.bank} · פירעון ${shDate(p.chq.d)}` : '', p.last4 ? '****' + p.last4 : '', p.conf ? 'אישור ' + p.conf : ''].filter(Boolean).join(' · ');
    base.table = { head: ['אמצעי תשלום', 'פרטים', 'סכום'], rows: [[PAYN[p.m] || 'אחר', det, ag2(doc.gross)]], num: [2] };
    base.sums = [['סה״כ שולם', doc.gross / 100]];
    const al = await db.collection('aralloc').where('rc', '==', doc.id || '').get().catch(() => null);
    const live = al ? al.docs.map((s) => s.data()).filter((a) => !a.void) : [];
    // שלב 6, תיקון סבב 1 (ליקוי 2): מסמך מיובא – המספר המקורי (ext); יתרת פתיחה – "יתרת פתיחה" (לא המזהה הפנימי)
    const xs = live.filter((a) => /^x_/.test(a.inv));
    const xd = {};
    if (xs.length) { const ss = await db.getAll(...xs.map((a) => db.doc('ardoc/' + a.inv))).catch(() => []); ss.forEach((q) => { if (q.exists) xd[q.id] = q.get('t') === 'ob' ? 'יתרת פתיחה' : String(q.get('ext') || q.get('no') || ''); }); }
    const lbl = (id) => (/^x_ob_/.test(id) ? 'יתרת פתיחה' : /^x_/.test(id) ? (xd[id] || 'מסמך מיובא') : id.replace(/^inv[DO]/, ''));
    const inv = live.map((a) => `${lbl(a.inv)} (${ag2(a.amt)})`);
    if (inv.length) notes.push('עבור חשבוניות: ' + inv.join(', '));
  } else {
    base.lines = (doc.lines || []).map((l) => ({ n: l.n, q: l.q, p: l.p, u: l.u || '' }));
    if (doc.disc) base.disc = doc.disc;
    if (doc.adj) base.adj = doc.adj;
    if (doc.terms) base.terms = doc.terms;
    if (doc.t === 'inv') base.due = doc.dueX || doc.due || '';
    // החלטה 29: שורה בולטת עם המספר המודפס של חשבונית החיוב (וסימון טיוטה כשהיא מסדרת הטיוטה)
    if (doc.t === 'cr' && doc.ref) base.refTxt = refTxt(doc.ref, doc.bt);
    if (doc.t === 'cr' && doc.rf) base.rfTxt = rfTxt(doc.rf);
    if (doc.t === 'ir' && doc.pay) notes.push('שולם: ' + (PAYN[doc.pay.m] || 'אחר') + (doc.pay.last4 ? ' ****' + doc.pay.last4 : ''));
    const k = PDF.calc(base);
    if (k.gross !== doc.gross) throw pre('sum-mismatch', 'סכום המסמך לא תואם. פנו למנהל');
  }
  if (doc.alloc) notes.push('מספר הקצאה: ' + doc.alloc);
  if (doc.note) notes.push(String(doc.note));
  if (isVoid && doc.void) notes.push(`המסמך בוטל ב-${shDate(ARD.ilDay(doc.void.at))}. סיבה: ${doc.void.why || ''}`);
  if (notes.length) base.note = notes.join('\n');
  return PDF.render(base);
}
async function docBuf(db, w, doc, cfg, isVoid) {
  const f = ARD.fileOf(doc.id, isVoid);
  try { const [b] = await getStorage().bucket().file(AF.pathOf(w.bizId, f)).download(); return b; } catch (e) { /* עוד לא נוצר – בונים */ }
  const b = await docRender(db, w, doc, cfg, isVoid);
  await AF.put(w.bizId, f, b);
  return b;
}
async function docOf(db, id) {
  if (typeof id !== 'string' || !OC.ID_RE.test(id)) throw bad('bad-id', 'מסמך לא תקין');
  const s = await db.doc('ardoc/' + id).get();
  if (!s.exists) throw new HttpsError('not-found', 'המסמך לא נמצא', { reason: 'no-doc' });
  if (['ob', 'old'].includes(s.get('t'))) throw pre('imported', 'מסמך מיובא מתוכנה קודמת – אין לו קובץ'); // שלב 6: בלי PDF
  return Object.assign({ id: s.id }, s.data());
}
function docAccess(w, doc) { if (doc.br && doc.br !== NB && w.mine && !w.mine.includes(doc.br)) throw deny('foreign-br', 'אין לך הרשאה למסמך של סניף אחר'); }
async function sendDoc(db, w, doc, ch, to, auto, buf, cfg, isVoid) {
  const now = Date.now();
  const amt = ag2(doc.gross);
  const nm = (doc.custSnap && doc.custSnap.name) || '';
  const title = titleOf(doc);
  if (ch === 'wa') {
    const wt = cfg.wt || {};
    const tpl = [wt[doc.t], doc.t === 'ir' ? wt.inv : ''].find((x) => TPL_RE.test(String(x || ''))) || '';
    if (!tpl) return { ch: 'wa', to: String(to || '').slice(0, 30), at: now, ok: false, why: 'no-tpl' };
    const lk = await AF.mkLink({ biz: w.bizId, id: ARD.fileOf(doc.id, isVoid), n: docName(doc, isVoid) });
    return S.sendWa(db, { to, tpl: { name: tpl, lang: 'he', params: [nm, String(doc.no), amt] }, link: lk.url, fileName: docName(doc, isVoid), auto, by: w.uid, token: sv(WA_ACCESS_TOKEN), now });
  }
  const text = `שלום ${nm},\nמצורף/ת ${title} מס׳ ${doc.no} על סך ${amt}.${doc.draft ? '\n(טיוטה – לא מסמך רשמי)' : ''}\n${cfg.name || ''}`;
  return S.sendMail(w.bizId, { to, subject: `${title} ${doc.no}${cfg.name ? ' – ' + cfg.name : ''}`, text, replyTo: cfg.mail, fromName: cfg.name || '', pdf: buf, fileName: docName(doc, isVoid), by: w.uid, now });
}
async function docRecord(db, id, recs) {
  if (!recs.length) return;
  const ref = db.doc('ardoc/' + id);
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) return;
    ARD.docUpd(tx, ref, { sent: (Array.isArray(s.get('sent')) ? s.get('sent') : []).concat(recs).slice(-SENT_MAX), upd: Date.now() });
  });
}
// אחרי הפקה (גם מ-orders.js): קובץ, ושליחה אוטומטית לפי סימון הלקוח (cust.snd.inv / snd.rc) – גם בתקופת הטיוטה (החלטה 24). "עצור הכל" עוצר.
async function afterIssue(w, id, opts) {
  const db = T.tdb();
  const doc = await docOf(db, id);
  const cfg = await cfgOf(db);
  const buf = await docBuf(db, w, doc, cfg, !!(opts && opts.isVoid));
  const recs = [];
  const c = doc.cust ? await custOf(db, { custId: doc.cust }) : null;
  const snd = c && c.snd && typeof c.snd === 'object' ? c.snd : null;
  const want = snd && CHS.includes(snd.ch) && (doc.t === 'rc' ? snd.rc === true : doc.t === 'ir' ? (snd.inv === true || snd.rc === true) : snd.inv === true);
  if (want) {
    for (const [ch, to] of targets(snd, { cust: doc.custSnap || {} }, c)) {
      const r = to ? await sendDoc(db, w, doc, ch, to, true, buf, cfg, !!(opts && opts.isVoid)) : { ch, to: '', at: Date.now(), ok: false, why: 'no-to' };
      recs.push(Object.assign({}, r, { auto: true, by: w.uid }));
    }
    await docRecord(db, id, recs);
  }
  return recs;
}
// עובד בלי הרשאה לסניף ההזמנה – נדחה; הזמנה בלי סניף / עסק בלי סניפים – כמו בהזמנות
const markRef = (db, reqId) => db.doc('arcfg/req_' + reqId);
function markHit(m, k, key) {
  if (!m.exists) return null;
  if (m.get('k') !== k || (key && m.get('key') !== key)) throw bad('bad-req', 'מזהה הבקשה כבר שימש לפעולה אחרת');
  return Object.assign({}, m.get('r') || {}, { dup: true });
}
function agIn(v, label) {
  if (!isNum(v) || v <= 0) throw bad('bad-amt', label + ': סכום גדול מ-0');
  const a = Math.round(v * 100);
  if (Math.abs(v * 100 - a) > 1e-6 || a > AMT_MAX) throw bad('bad-amt', label + ': עד שתי ספרות אחרי הנקודה, ועד ₪1,000,000');
  return a;
}

// ---------- arIssue({ reqId, ord, t?, vm?, alloc?, skipAlloc? }) ----------
async function arIssue(request) {
  const w = await OC.who(request);
  const input = inputObject(request);
  onlyKeys(input, ['reqId', 'ord', 't', 'vm', 'alloc', 'skipAlloc']);
  const reqId = reqIdOf(input);
  const ordId = idOf(input.ord, 'הזמנה');
  if (input.t != null && input.t !== 'inv' && input.t !== 'ir') throw bad('bad-type', 'סוג מסמך: חשבונית מס או חשבונית מס קבלה');
  if (input.vm != null && input.vm !== 'ex' && input.vm !== 'inc') throw bad('bad-vm', 'בחרו: מחירים כוללים מע"מ או לפני מע"מ');
  if (input.alloc != null && input.alloc !== '' && (typeof input.alloc !== 'string' || !/^\d{1,20}$/.test(input.alloc))) throw bad('bad-alloc', 'מספר הקצאה: ספרות בלבד, עד 20');
  if (input.skipAlloc !== undefined && typeof input.skipAlloc !== 'boolean') throw bad('bad-field', 'skipAlloc: כן/לא');
  const db = T.tdb();
  const oref = db.doc('ord/' + ordId);
  let res = null;
  await db.runTransaction(async (tx) => {
    res = null;
    const [m, s] = await tx.getAll(markRef(db, reqId), oref);
    const d = s.exists ? s.data() : null;
    access(w, d);
    const hit = markHit(m, 'arIssue', ordId); if (hit) { res = hit; return; }
    const B = await new ARD.Book(tx, db, w).init();
    needOn(B.cfg);
    if (d.status === 'cancel') throw pre('cancelled', 'ההזמנה בוטלה');
    if (d.inv && d.inv.id) throw pre('has-inv', 'להזמנה כבר יש חשבונית');
    const paid = !!d.paid && ['paid', 'out', 'done'].includes(d.status);
    const t = input.t || (paid ? 'ir' : 'inv');
    if (t === 'ir' && !paid) throw pre('not-paid', 'חשבונית מס קבלה – רק להזמנה ששולמה');
    if (t === 'inv' && paid) throw pre('paid', 'ההזמנה שולמה – מפיקים חשבונית מס קבלה');
    const vm = d.vm || input.vm || (d.oc && d.oc.vm) || null;
    if (!vm) throw pre('need-vm', 'הזמנה ישנה: בחרו אם המחירים כוללים מע"מ');
    const dd = d.vm ? d : Object.assign({}, d, { vm, vr: d.oc && isNum(d.oc.vr) ? d.oc.vr : undefined, gross: undefined });
    const c = typeof d.custId === 'string' && OC.ID_RE.test(d.custId) ? await B.needCust(d.custId) : null;
    if (t === 'inv' && !(c && c.data)) throw pre('need-cust', 'חשבונית מס (לתשלום בהמשך) – רק להזמנה עם לקוח');
    // החלטה 36 (תיקון בודק 7ב): עסק עם "חיוב אחרי ליקוט" – חשבונית מס להזמנה של לקוח מיידי רק אחרי ליקוט שלא השתנה מאז,
    // אחרת קבלה מכרטיס הלקוח שסוגרת אותה הייתה מסמנת "שולם" לפני הליקוט. לקוח בשוטף – כמו קודם
    if (t === 'inv' && AC.termsOfCust(c.data).b === 'imm') {
      const pp = await tx.get(db.doc('private/pay'));
      if (pp.exists && pp.get('after') === true) {
        const pk = d.pk;
        if (!pk || pk.st !== 'ok') throw pre('pay-pick', 'בעסק הזה מפיקים חשבונית ללקוח מיידי רק אחרי שהליקוט הסתיים');
        if (pk.fin && typeof pk.fin === 'object') { const f = OC.pickFin(d); if (f.k !== pk.fin.k || Math.round(f.due * 100) !== Math.round(pk.fin.due * 100)) throw pre('pick-old', 'ההזמנה השתנתה אחרי הליקוט – יש ללקט מחדש לפני הפקת החשבונית'); }
      }
    }
    await B.needSeq(t);
    const open = t === 'inv' ? await B.openDocs(c.id) : [];
    const ob = ARD.ordBody(B, dd, ordId, c, t);
    if (ob.err) throw pre(ob.err, 'סכום החשבונית לא תואם להזמנה. פנו למנהל');
    if (ob.body.alq) {
      if (input.alloc) { ob.body.alloc = input.alloc; delete ob.body.alq; } else if (input.skipAlloc !== true) throw pre('need-alloc', 'נדרש מספר הקצאה מרשות המסים. הקלידו אותו, או בחרו לדלג');
    } else if (input.alloc) ob.body.alloc = input.alloc;
    if (t === 'ir') ob.body.pay = ARD.payOf(d.paid);
    ob.body.req = reqId;
    const r = B.issue(t, ob.body);
    if (t === 'inv') B.offset(r, open);
    B.flush();
    tx.update(oref, { inv: { id: r.id, no: r.d.no, t, draft: r.d.draft } });
    tx.set(logRef(db, ordId), { t: B.now, by: w.uid, act: 'ardoc', note: `${DT[t]} #${r.d.no}${r.d.draft ? ' (טיוטה)' : ''}` });
    res = { t, id: r.id, no: r.d.no, draft: r.d.draft, gross: r.d.gross, due: r.d.due || '' };
    tx.set(markRef(db, reqId), { k: 'arIssue', key: ordId, r: res, t: B.now, by: w.uid });
  }, { maxAttempts: 50 });
  if (!res.dup) { try { res.sent = await afterIssue(w, res.id); } catch (e) { logger.error('ar: arIssue after failed', { name: e && e.name, msg: String(e && e.message).slice(0, 200) }); } }
  return res;
}

// ---------- arReceipt({ reqId, cust, amt, method, chq?, last4?, conf?, note?, proofId?, alloc?:[{inv, amt}] }) ----------
async function arReceipt(request) {
  const w = await OC.who(request);
  const input = inputObject(request);
  onlyKeys(input, ['reqId', 'cust', 'amt', 'method', 'chq', 'last4', 'conf', 'note', 'proofId', 'alloc']);
  const reqId = reqIdOf(input);
  const cid = idOf(input.cust, 'לקוח');
  const amt = agIn(input.amt, 'סכום');
  if (!ARD.PAYM.includes(input.method)) throw bad('bad-method', 'אמצעי תשלום: מזומן, העברה, צ׳ק, אשראי או אחר');
  const pay = { method: input.method };
  if (input.method === 'chq') {
    const q = input.chq;
    if (!q || typeof q !== 'object' || Array.isArray(q)) throw bad('bad-chq', 'צ׳ק: מספר, בנק ותאריך פירעון');
    onlyKeys(q, ['no', 'bank', 'd'], 'צ׳ק');
    if (typeof q.no !== 'string' || !/^\d{1,12}$/.test(q.no)) throw bad('bad-chq', 'מספר צ׳ק: ספרות בלבד');
    if (typeof q.bank !== 'string' || !q.bank.trim() || q.bank.length > 40) throw bad('bad-chq', 'בנק: עד 40 תווים');
    if (!AC.ymdOk(q.d)) throw bad('bad-chq', 'תאריך פירעון לא תקין');
    pay.chq = { no: q.no, bank: txtIn(q.bank, 40, 'בנק'), d: q.d };
  } else if (input.chq != null) throw bad('bad-chq', 'פרטי צ׳ק – רק בתשלום בצ׳ק');
  if (input.last4 != null && input.last4 !== '') { if (typeof input.last4 !== 'string' || !/^\d{4}$/.test(input.last4)) throw bad('bad-last4', '4 ספרות'); pay.last4 = input.last4; }
  if (input.conf != null && input.conf !== '') { if (typeof input.conf !== 'string' || !/^[0-9A-Za-z-]{1,20}$/.test(input.conf)) throw bad('bad-conf', 'מספר אישור / אסמכתא: ספרות ואותיות, עד 20'); pay.conf = input.conf; }
  if (input.note != null && input.note !== '') pay.note = txtIn(input.note, 200, 'הערה');
  let want = null;
  if (input.alloc != null) {
    if (!Array.isArray(input.alloc) || input.alloc.length > 50) throw bad('bad-alloc', 'בחירת חשבוניות לא תקינה');
    want = input.alloc.map((x) => {
      if (!x || typeof x !== 'object') throw bad('bad-alloc', 'בחירת חשבוניות לא תקינה');
      onlyKeys(x, ['inv', 'amt'], 'הקצאה');
      return { inv: idOf(x.inv, 'חשבונית'), amt: agIn(x.amt, 'סכום לחשבונית') };
    });
    if (new Set(want.map((x) => x.inv)).size !== want.length) throw bad('bad-alloc', 'אותה חשבונית פעמיים');
    if (want.reduce((s, x) => s + x.amt, 0) > amt) throw bad('bad-alloc', 'הסכום לחשבוניות גדול מסכום הקבלה');
  }
  const db = T.tdb();
  let res = null;
  await db.runTransaction(async (tx) => {
    res = null;
    const m = await tx.get(markRef(db, reqId));
    const hit = markHit(m, 'arReceipt', cid); if (hit) { res = hit; return; }
    const B = await new ARD.Book(tx, db, w).init();
    needOn(B.cfg);
    const c = await B.needCust(cid);
    if (!c.data || c.data.mv) throw new HttpsError('not-found', 'הלקוח לא נמצא', { reason: 'no-cust' });
    await B.needSeq('rc');
    const open = await B.openDocs(cid);
    const pf = await ARD.proofPlan(B, input.proofId);
    if (!pf.ok && (w.role !== 'manager' || input.proofId)) throw pre(pf.why || 'need-proof', ARD.PROOF_MSG[pf.why] || ARD.PROOF_MSG['need-proof']);
    const invs = open.filter((x) => ARD.isDr(x.d) && !x.d.void && x.d.open > 0); // שלב 6: גם חוב מיובא (ob/old)
    let plan;
    if (want) {
      plan = want.map((x) => {
        const v = invs.find((y) => y.id === x.inv);
        if (!v) throw pre('bad-alloc', `חשבונית ${x.inv} לא פתוחה אצל הלקוח הזה`);
        if (x.amt > v.d.open) throw pre('bad-alloc', `לחשבונית ${v.d.no} נשארו לתשלום ${ag2(v.d.open)}`);
        return [v, x.amt];
      });
    } else plan = invs.slice().sort((a, b) => String(a.d.dueX || a.d.due || a.d.d).localeCompare(String(b.d.dueX || b.d.due || b.d.d))).map((v) => [v, v.d.open]);
    const r = B.issue('rc', { cust: cid, custSnap: ARD.custSnap(c.data), lines: [], vm: 'inc', rate: 0, net: amt, vat: 0, gross: amt, pay: ARD.payOf(pay), req: reqId, ...(pf.ok ? { proof: pf.id } : {}) });
    for (const [v, a] of plan) { if (r.d.open <= 0) break; B.alloc(r, v, a); }
    if (pf.ok) pf.use(r.id);
    // תיקון סבב 1 (הערה 2): קבלה שסוגרת במלואה את החשבונית של הזמנה – ההזמנה עוברת ל"שולם" / "הושלם" (נשלחה), כמו "שולם".
    // paid.rc = הקבלה, כך שביטול הקבלה מחזיר אותה ל"ממתין לתשלום". הזמנה עם קווים (cell) נשארת כמו היום – "שולם" ידני (ניוד)
    const shut = [...new Set(B.allocs.filter((a) => a.rc === r.id).map((a) => B.docs[a.inv]).filter((v) => v && v.d.open === 0).flatMap((v) => (v.d.ord || []).map((o) => o + '|' + v.id)))];
    const oss = shut.length ? await tx.getAll(...shut.map((k) => db.doc('ord/' + k.split('|')[0]))) : [];
    B.flush();
    oss.forEach((os, i) => {
      const iv = shut[i].split('|')[1], inv = os.exists ? os.get('inv') : null, cl = os.exists ? os.get('cell') : null;
      if (!os.exists || !OC.PAYABLE.includes(os.get('status')) || !inv || inv.id !== iv || (cl && Array.isArray(cl.lines) && cl.lines.length)) return;
      const amt0 = os.get('vm') && isNum(os.get('gross')) ? os.get('gross') : os.get('total');
      const paid = { method: OC.PAY_METHODS.includes(input.method) ? input.method : 'other', at: B.now, by: w.uid, amt: amt0, rc: r.id, note: `${DT.rc} #${r.d.no}` };
      tx.update(os.ref, { status: os.get('shp') ? 'done' : 'paid', paid, upd: B.now });
      tx.set(logRef(db, os.id), { t: B.now, by: w.uid, act: 'paid', note: `${DT.rc} #${r.d.no} סגרה את החשבונית` });
    });
    res = { id: r.id, no: r.d.no, draft: r.d.draft, gross: amt, left: r.d.open, alloc: B.allocs.map((a) => ({ inv: a.inv, amt: a.amt })), bal: c.ar.bal };
    tx.set(markRef(db, reqId), { k: 'arReceipt', key: cid, r: res, t: B.now, by: w.uid });
  }, { maxAttempts: 50 });
  if (!res.dup) { try { res.sent = await afterIssue(w, res.id); } catch (e) { logger.error('ar: arReceipt after failed', { name: e && e.name, msg: String(e && e.message).slice(0, 200) }); } }
  return res;
}

// ---------- arCredit({ reqId, inv, mode:'full'|'lines'|'amt', lines?:[{i,q}], amt?, restock?, reason, refund?:{m} }) ----------
// refund (החלטה 31): החזר כסף באמצעי התשלום (cash / card / transfer / chq / other) במקום יתרת זכות. רק על מה ששולם: בחשבונית מס הזיכוי קודם סוגר
// את החוב הפתוח, ורק העודף מוחזר; בלי עודף – nothing-paid. אמצעי התשלום של החשבונית המקורית: ir.pay / הקבלות שהוקצו לה (via עובר מהם באשראי)
async function arCredit(request) {
  const w = await OC.who(request);
  const input = inputObject(request);
  onlyKeys(input, ['reqId', 'inv', 'mode', 'lines', 'amt', 'restock', 'reason', 'refund']);
  const reqId = reqIdOf(input);
  const invId = idOf(input.inv, 'חשבונית');
  if (!['full', 'lines', 'amt'].includes(input.mode)) throw bad('bad-mode', 'זיכוי: מלא, לפי שורות או סכום');
  if (input.restock !== undefined && typeof input.restock !== 'boolean') throw bad('bad-field', 'החזרה למלאי: כן או לא');
  if (input.restock === true && input.mode === 'amt') throw bad('bad-field', 'החזרה למלאי – רק בזיכוי מלא או לפי שורות');
  const reason = txtIn(input.reason, 200, 'סיבה');
  if (!reason) throw bad('bad-reason', 'כתבו סיבה לזיכוי');
  let rfm = '';
  if (input.refund != null) {
    if (typeof input.refund !== 'object' || Array.isArray(input.refund)) throw bad('bad-field', 'החזר כסף: אמצעי תשלום');
    onlyKeys(input.refund, ['m'], 'החזר');
    if (!Object.prototype.hasOwnProperty.call(RFN, input.refund.m)) throw bad('bad-field', 'החזר כסף: מזומן, אשראי, העברה, צ׳ק או אחר');
    rfm = input.refund.m;
  }
  let li = null, amt = 0;
  if (input.mode === 'lines') {
    if (!Array.isArray(input.lines) || !input.lines.length || input.lines.length > 500) throw bad('bad-lines', 'בחרו שורות לזיכוי');
    li = input.lines.map((x) => {
      if (!x || typeof x !== 'object') throw bad('bad-lines', 'שורה לא תקינה');
      onlyKeys(x, ['i', 'q'], 'שורה');
      if (!Number.isInteger(x.i) || x.i < 0 || !isNum(x.q) || x.q <= 0) throw bad('bad-lines', 'שורה לא תקינה');
      return { i: x.i, q: Math.round(x.q * 1000) / 1000 };
    });
    if (new Set(li.map((x) => x.i)).size !== li.length) throw bad('bad-lines', 'אותה שורה פעמיים');
  } else if (input.lines != null) throw bad('bad-lines', 'שורות – רק בזיכוי לפי שורות');
  if (input.mode === 'amt') amt = agIn(input.amt, 'סכום הזיכוי'); else if (input.amt != null) throw bad('bad-amt', 'סכום – רק בזיכוי לפי סכום');
  const db = T.tdb();
  let res = null;
  await db.runTransaction(async (tx) => {
    res = null;
    const m = await tx.get(markRef(db, reqId));
    const hit = markHit(m, 'arCredit', invId); if (hit) { res = hit; return; }
    const B = await new ARD.Book(tx, db, w).init();
    needOn(B.cfg);
    const x = await B.needDoc(invId);
    if (!x || !['inv', 'ir'].includes(x.d.t)) throw new HttpsError('not-found', 'החשבונית לא נמצאה', { reason: 'no-doc' });
    docAccess(w, x.d);
    const prev = await tx.get(db.collection('ardoc').where('ref', '==', invId));
    const prevG = prev.docs.reduce((s, p) => s + (p.get('t') === 'cr' ? p.get('gross') || 0 : 0), 0);
    const prevAmt = prev.docs.some((p) => p.get('t') === 'cr' && !Array.isArray(p.get('li')));
    const used = new Map();
    prev.docs.forEach((p) => (p.get('t') === 'cr' ? p.get('li') || [] : []).forEach((l) => used.set(l.i, Math.round(((used.get(l.i) || 0) + l.q) * 1000) / 1000)));
    const L = x.d.lines || [];
    let mode = input.mode, sel = li;
    if (mode === 'full') {
      if (!prev.size) sel = L.map((l, i) => ({ i, q: l.q }));
      else if (!prevAmt) sel = L.map((l, i) => ({ i, q: Math.round((l.q - (used.get(i) || 0)) * 1000) / 1000 })).filter((l) => l.q > 0);
      else { mode = 'amt'; amt = x.d.gross - prevG; }
      if (sel && !sel.length) throw pre('nothing-left', 'כבר זוכו כל השורות של החשבונית');
    }
    let lines, vm = x.d.vm, disc = x.d.disc || 0;
    if (mode === 'amt') {
      lines = [{ n: `זיכוי לחשבונית ${x.d.no}`, q: 1, p: amt / 100 }]; vm = 'inc'; disc = 0;
    } else {
      lines = sel.map((s) => {
        const l = L[s.i];
        if (!l) throw bad('bad-lines', 'שורה לא קיימת בחשבונית');
        if (s.q > Math.round((l.q - (used.get(s.i) || 0)) * 1000) / 1000 + 1e-9 || (l.q < 0)) throw pre('too-much', `בשורה "${l.n}" אפשר לזכות עד ${Math.max(0, l.q - (used.get(s.i) || 0))}`);
        return Object.assign({ n: l.n, q: s.q, p: l.p, u: '' }, l.pid ? { pid: l.pid } : {}, l.fr ? { fr: l.fr } : {});
      });
    }
    const sm = AC.docSums(lines, vm, x.d.rate, disc);
    // תיקון סבב 1 (ליקוי 2): זיכוי שסוגר את כל השורות שנשארו (מלא, או לפי שורות עד הסוף) מזכה בדיוק את היתרה: gross − זיכויים קודמים.
    // עיגול המע"מ/ההנחה בכל זיכוי בנפרד יכול להשאיר אגורה פתוחה (או לחסום ב-too-much). ההפרש נשמר ב-adj (אגורות) ומודפס כ"התאמת עיגול",
    // ו-net/vat הם היתרה המדויקת של החשבונית – כך שסך הזיכויים = החשבונית גם בלפני מע"מ וגם במע"מ.
    if (mode !== 'amt' && !prevAmt && L.every((l, i) => !(l.q > 0) || Math.round((l.q - (used.get(i) || 0) - ((sel.find((s) => s.i === i) || {}).q || 0)) * 1000) / 1000 <= 0)) {
      const pN = prev.docs.reduce((s, p) => s + (p.get('t') === 'cr' ? p.get('net') || 0 : 0), 0);
      const pV = prev.docs.reduce((s, p) => s + (p.get('t') === 'cr' ? p.get('vat') || 0 : 0), 0);
      const adj = (x.d.gross - prevG) - sm.gross;
      if (adj) {
        if (Math.abs(adj) > 100) throw pre('sum-mismatch', 'סכום הזיכוי לא תואם ליתרת החשבונית. פנו למנהל');
        sm.net = x.d.net - pN; sm.vat = x.d.vat - pV; sm.gross = x.d.gross - prevG; sm.adj = adj;
      }
    }
    if (sm.gross <= 0) throw pre('bad-amt', 'סכום הזיכוי חייב להיות גדול מ-0');
    if (prevG + sm.gross > x.d.gross) throw pre('too-much', `אפשר לזכות עד ${ag2(Math.max(0, x.d.gross - prevG))} בחשבונית הזו`);
    // אמצעי התשלום של החשבונית המקורית (לסימון via בהחזר באשראי) – קריאות לפני הכתיבות
    let srcPay = [];
    if (rfm) {
      if (x.d.t === 'ir') srcPay = x.d.pay ? [x.d.pay] : [];
      else {
        const al = (await tx.get(db.collection('aralloc').where('inv', '==', invId))).docs.map((s) => s.data()).filter((a) => !a.void && /^rc/.test(a.rc || ''));
        const rs = al.length ? await tx.getAll(...[...new Set(al.map((a) => a.rc))].map((k) => db.doc('ardoc/' + k))) : [];
        srcPay = rs.filter((s) => s.exists && !s.get('void') && s.get('pay')).map((s) => s.get('pay'));
      }
    }
    const back = input.restock === true ? lines.filter((l) => l.pid) : [];
    const prods = back.length ? await OC.loadProds(tx, db, back.map((l) => l.pid)) : null;
    if (x.d.cust) await B.needCust(x.d.cust);
    await B.needSeq('cr');
    const body = { cust: x.d.cust || '', custSnap: x.d.custSnap, lines, vm, rate: x.d.rate, net: sm.net, vat: sm.vat, gross: sm.gross, ord: x.d.ord || [], br: x.d.br || NB, ref: invId, note: 'סיבה: ' + reason, req: reqId };
    if (disc) body.disc = disc;
    if (sm.adj) body.adj = sm.adj;
    if (mode !== 'amt') body.li = sel;
    if (back.length) body.rs = true;
    const r = B.issue('cr', body);
    if (x.d.t === 'inv' && !x.d.void) B.alloc(r, x, r.d.gross);
    if (rfm) {
      const sv = srcPay.filter((p) => p.m === rfm);
      const via = rfm === 'card' && sv.length && sv.every((p) => p.via && p.via === sv[0].via) ? sv[0].via : '';
      if (!B.refund(r, rfm, via)) throw pre('nothing-paid', 'החשבונית לא שולמה – הזיכוי רק מוריד את החוב, ואין כסף להחזיר. בחרו "זיכוי ללקוח"');
    }
    B.flush();
    if (back.length) {
      const br = x.d.br || NB;
      OC.applyMoves(tx, db, w, prods, back.filter((l) => prods.has(l.pid)).map((l) => ({ pid: l.pid, br, delta: l.q, why: 'credit' })), { ord: (x.d.ord || [])[0] || '', cr: r.id });
    }
    for (const o of x.d.ord || []) tx.set(logRef(db, o), { t: B.now, by: w.uid, act: 'ardoc', note: `${DT.cr} #${r.d.no} לחשבונית ${x.d.no}${back.length ? ' · הוחזר למלאי' : ''}${r.d.rf ? ' · ' + rfTxt(r.d.rf) : ''}` });
    res = Object.assign({ id: r.id, no: r.d.no, draft: r.d.draft, gross: r.d.gross, left: r.d.open, rs: !!back.length }, r.d.rf ? { rf: r.d.rf } : {});
    tx.set(markRef(db, reqId), { k: 'arCredit', key: invId, r: res, t: B.now, by: w.uid });
  }, { maxAttempts: 50 });
  if (!res.dup) { try { res.sent = await afterIssue(w, res.id); } catch (e) { logger.error('ar: arCredit after failed', { name: e && e.name, msg: String(e && e.message).slice(0, 200) }); } }
  return res;
}

// ---------- arVoidRc({ reqId, id, reason }) – מנהל ----------
async function arVoidRc(request) {
  const w = await OC.who(request);
  mgr(w);
  const input = inputObject(request);
  onlyKeys(input, ['reqId', 'id', 'reason']);
  const reqId = reqIdOf(input);
  const id = idOf(input.id, 'קבלה');
  const reason = txtIn(input.reason, 200, 'סיבה');
  if (!reason) throw bad('bad-reason', 'כתבו סיבה לביטול');
  const db = T.tdb();
  let res = null;
  await db.runTransaction(async (tx) => {
    res = null;
    const m = await tx.get(markRef(db, reqId));
    const hit = markHit(m, 'arVoidRc', id); if (hit) { res = hit; return; }
    const B = await new ARD.Book(tx, db, w).init();
    const x = await B.needDoc(id);
    if (!x || x.d.t !== 'rc') throw new HttpsError('not-found', 'הקבלה לא נמצאה', { reason: 'no-doc' });
    if (x.d.void) { res = { id, dup: true }; return; }
    const al = await tx.get(db.collection('aralloc').where('rc', '==', id));
    const live = al.docs.filter((a) => !a.get('void'));
    const invs = [];
    for (const a of live) invs.push([a, await B.needDoc(a.get('inv'))]);
    // החלטה 37: על אחת החשבוניות של הקבלה יש זיכוי עם החזר כסף (cr.rf) – אי אפשר לבטל את הקבלה (הכסף כבר הוחזר מתוכה). תיקון – בזיכוי
    for (const iv of [...new Set(live.map((a) => a.get('inv')))]) {
      const crs = await tx.get(db.collection('ardoc').where('ref', '==', iv));
      if (crs.docs.some((p) => p.get('t') === 'cr' && !p.get('void') && p.get('rf'))) throw pre('rc-refunded', 'הוחזר כסף על החשבונית – אי אפשר לבטל את הקבלה. תיקון – בזיכוי');
    }
    const c = x.d.cust ? await B.needCust(x.d.cust) : null;
    // קבלה שנרשמה ב"שולם" של הזמנה (paid.rc) – ההזמנה חוזרת ל"ממתין לתשלום"
    // תיקון סבב 1 (הערה 2): גם הזמנות של החשבוניות שהקבלה סגרה (arReceipt מכרטיס הלקוח) – לפי paid.rc
    const oids = [...new Set([(x.d.ord || [])[0]].concat(...invs.map(([, v]) => (v && v.d.ord) || [])).filter(Boolean))];
    const oss = oids.length ? await tx.getAll(...oids.map((o) => db.doc('ord/' + o))) : [];
    const backs = oss.filter((os) => os.exists && os.get('paid') && os.get('paid').rc === id);
    let sum = 0;
    for (const [a, v] of invs) {
      const amt = a.get('amt');
      sum += amt;
      if (v) B.set(v, { open: v.d.open + amt, st: ARD.stOf('inv', v.d.open + amt, v.d.gross) });
      tx.update(a.ref, { void: true, voidAt: B.now, voidBy: w.uid });
    }
    if (c && c.data) { c.ar.bal += x.d.gross; c.ar.open += sum; c.ar.cr -= x.d.open; c.dirty = true; }
    B.set(x, { open: 0, st: 'void', void: { at: B.now, by: w.uid, why: reason } });
    B.flush();
    for (const back of backs) {
      const oid = back.id, pd = back.get('paid');
      tx.update(back.ref, { status: 'wait_pay', paid: require('firebase-admin/firestore').FieldValue.delete(), upd: B.now });
      if (pd && pd.sup) tx.set(db.doc('ordpay/' + oid), { st: 'void', upd: B.now, why: 'unpay' }, { merge: true });
      tx.set(logRef(db, oid), { t: B.now, by: w.uid, act: 'unpay', note: `ביטול קבלה #${x.d.no}: ${reason}` });
    }
    res = { id, no: x.d.no, reopened: invs.map(([a]) => a.get('inv')), ord: backs.length ? backs[0].id : '' };
    tx.set(markRef(db, reqId), { k: 'arVoidRc', key: id, r: res, t: B.now, by: w.uid });
  }, { maxAttempts: 50 });
  if (!res.dup) { try { await afterIssue(w, id, { isVoid: true }); } catch (e) { logger.error('ar: arVoidRc after failed', { name: e && e.name, msg: String(e && e.message).slice(0, 200) }); } }
  return res;
}

// ---------- arProof({ id?, k, np, data }) / arProofGet({ id }) ----------
// arproof/{id} { by, np, at, done, mime, size, used? } + arproof/{id}/p/{k} { data } – אף אחד לא קורא מהאפליקציה (החוקים). עד 5MB אחרי פענוח.
const PF_CH = 700000, PF_MAX = 10, PF_BYTES = 5 * 1024 * 1024;
const PF_HEAD = /^data:(image\/jpeg|image\/png|application\/pdf);base64,/;
const PF_CHARS = /^[A-Za-z0-9+/=]*$/;
function sniffMime(b) {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 4 && b.slice(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return '';
}
async function arProof(request) {
  const w = await OC.who(request);
  const input = inputObject(request);
  onlyKeys(input, ['id', 'k', 'np', 'data']);
  const { k, np } = input;
  let data = input.data;
  if (!Number.isInteger(np) || np < 1 || np > PF_MAX) throw bad('proof-big', 'הקובץ גדול מדי (עד 5MB)');
  if (!Number.isInteger(k) || k < 0 || k >= np) throw bad('bad-part', 'חלק לא תקין');
  if (typeof data !== 'string' || !data.length || data.length > PF_CH) throw bad('proof-big', 'חלק בקובץ גדול מדי');
  let mime = '';
  if (k === 0) { const h = PF_HEAD.exec(data); if (!h) throw bad('bad-proof', 'רק תמונה (JPEG / PNG) או PDF'); mime = h[1]; data = data.slice(h[0].length); }
  if (!PF_CHARS.test(data)) throw bad('bad-proof', 'הקובץ לא תקין');
  const db = T.tdb();
  let id = input.id;
  if (id == null) {
    if (k !== 0) throw bad('bad-part', 'מתחילים מהחלק הראשון');
    id = 'p' + crypto.randomBytes(12).toString('hex');
    await db.doc('arproof/' + id).create({ by: w.uid, np, at: Date.now(), done: false, mime });
  } else {
    id = idOf(id, 'אסמכתא');
    const s = await db.doc('arproof/' + id).get();
    if (!s.exists) throw new HttpsError('not-found', 'האסמכתא לא נמצאה', { reason: 'no-proof' });
    if (s.get('by') !== w.uid) throw deny('proof-owner', 'רק מי שהתחיל להעלות ממשיך');
    if (s.get('done')) throw pre('proof-done', 'האסמכתא כבר הועלתה');
    if (s.get('np') !== np) throw bad('bad-part', 'מספר החלקים השתנה');
    if (k === 0) await s.ref.update({ mime });
  }
  const ref = db.doc('arproof/' + id);
  await ref.collection('p').doc(String(k)).set({ data });
  if (k !== np - 1) return { ok: true, id, k, np };
  // החלק האחרון: כל החלקים קיימים, גודל אחרי פענוח עד 5MB, ותוכן הקובץ מתאים לסוג (לא רק הכותרת)
  const parts = await ref.collection('p').get();
  const m = new Map(parts.docs.map((p) => [p.id, p.get('data')]));
  for (let i = 0; i < np; i++) if (typeof m.get(String(i)) !== 'string') throw pre('proof-missing', 'חסר חלק בקובץ. העלו שוב');
  const all = Array.from({ length: np }, (_, i) => m.get(String(i))).join('');
  const size = Math.floor(all.length * 3 / 4) - (all.endsWith('==') ? 2 : all.endsWith('=') ? 1 : 0);
  if (size > PF_BYTES) throw bad('proof-big', 'הקובץ גדול מ-5MB');
  const s0 = await ref.get();
  const head = Buffer.from(all.slice(0, 16), 'base64');
  if (sniffMime(head) !== s0.get('mime')) throw bad('bad-proof', 'תוכן הקובץ לא תואם לסוג שלו');
  await ref.update({ done: true, size, doneAt: Date.now() });
  return { ok: true, id, k, np, done: true, size };
}
async function arProofGet(request) {
  const w = await OC.who(request);
  const input = inputObject(request);
  onlyKeys(input, ['id']);
  const id = idOf(input.id, 'אסמכתא');
  const db = T.tdb();
  const s = await db.doc('arproof/' + id).get();
  if (!s.exists || !s.get('done')) throw new HttpsError('not-found', 'האסמכתא לא נמצאה', { reason: 'no-proof' });
  if (w.role !== 'manager' && s.get('by') !== w.uid) throw deny('proof-owner', 'האסמכתא זמינה למנהל ולמי שהעלה אותה');
  const parts = await s.ref.collection('p').get();
  const m = new Map(parts.docs.map((p) => [p.id, p.get('data')]));
  const np = s.get('np');
  return { id, mime: s.get('mime'), size: s.get('size'), used: s.get('used') || '', data: `data:${s.get('mime')};base64,` + Array.from({ length: np }, (_, i) => m.get(String(i)) || '').join('') };
}

// ---------- arDoc({ id, op:'pdf'|'send'|'due', ch?, to?, reqId?, due? }) ----------
async function arDoc(request) {
  const w = await OC.who(request);
  const input = inputObject(request);
  const op = input.op;
  if (!['pdf', 'send', 'due'].includes(op)) throw bad('bad-op', 'פעולה לא מוכרת');
  onlyKeys(input, op === 'pdf' ? ['id', 'op'] : op === 'send' ? ['id', 'op', 'ch', 'to', 'reqId'] : ['id', 'op', 'due']);
  const db = T.tdb();
  const doc = await docOf(db, input.id);
  docAccess(w, doc);
  const cfg = await cfgOf(db);
  needOn(cfg);
  const isVoid = !!doc.void;
  if (op === 'pdf') { const b = await docBuf(db, w, doc, cfg, isVoid); return { id: doc.id, no: doc.no, t: doc.t, name: docName(doc, isVoid), b64: b.toString('base64'), void: isVoid }; }
  if (op === 'due') {
    mgr(w);
    if (doc.t !== 'inv') throw pre('bad-type', 'מועד תשלום – רק בחשבונית מס');
    if (!AC.ymdOk(input.due) || input.due < doc.d) throw bad('bad-due', 'תאריך לא תקין (לא לפני תאריך החשבונית)');
    const ref = db.doc('ardoc/' + doc.id);
    await db.runTransaction(async (tx) => { await tx.get(ref); ARD.docUpd(tx, ref, { dueX: input.due, upd: Date.now() }); });
    return { ok: true, due: input.due };
  }
  const reqId = reqIdOf(input);
  if (input.ch !== 'wa' && input.ch !== 'mail') throw bad('bad-ch', 'בחרו ווטסאפ או מייל');
  const to = input.to == null || input.to === '' ? '' : String(input.to).trim().slice(0, 254);
  const mark = markRef(db, reqId);
  try { await mark.create({ k: 'arDocSend', key: doc.id, t: Date.now(), by: w.uid }); } catch (e) {
    if (e && (e.code === 6 || /already exists/i.test(String(e.message)))) { const ms = await mark.get(); markHit(ms, 'arDocSend', doc.id); return Object.assign({}, ms.get('r') || { sent: [] }, { dup: true }); }
    throw e;
  }
  const c = doc.cust ? await custOf(db, { custId: doc.cust }) : null;
  const buf = await docBuf(db, w, doc, cfg, isVoid);
  const recs = [];
  for (const [ch, t] of targets({}, { cust: doc.custSnap || {} }, c, input.ch, to)) {
    const r = t ? await sendDoc(db, w, doc, ch, t, false, buf, cfg, isVoid) : { ch, to: '', at: Date.now(), ok: false, why: 'no-to' };
    recs.push(Object.assign({}, r, { auto: false, by: w.uid }));
  }
  await docRecord(db, doc.id, recs);
  const r = { id: doc.id, no: doc.no, sent: recs };
  await mark.update({ r });
  return r;
}

// ---------- arMonthly({ cust, ym:'YYYY-MM', ch?, to?, reqId? }) – מסמך סיכום חודשי (לא חשבונית מס, החלטה 23) ----------
// שלב 5: הבנייה והשליחה הופרדו (monBuild / monSend), כדי שגם ar-remind.js (סיכום אוטומטי בתחילת החודש ללקוח עם invM) ישתמש בהן. ההתנהגות לא השתנתה.
async function monBuild(db, w, cfg, c, cid, ym) {
  const [y, mo] = ym.split('-').map(Number);
  const from = ym + '-01', to = AC.ymdAdd(`${y}-${String(mo).padStart(2, '0')}-01`, new Date(Date.UTC(y, mo, 0)).getUTCDate() - 1);
  const q = await db.collection('ardoc').where('cust', '==', cid).where('d', '>=', from).where('d', '<=', to).get();
  const L = q.docs.map((s) => Object.assign({ id: s.id }, s.data())).filter((x) => ['inv', 'ir', 'cr'].includes(x.t)).sort((a, b) => a.d.localeCompare(b.d) || a.no - b.no);
  if (!L.length) throw pre('no-docs', 'אין חשבוניות ללקוח בחודש הזה');
  const sgn = (x) => (x.t === 'cr' ? -x.gross : x.gross);
  const rows = L.map((x) => [shDate(x.d), titleOf(x), String(x.no), ag2(sgn(x)), x.t === 'inv' ? ag2(x.open) : '']);
  const tot = L.reduce((s, x) => s + sgn(x), 0), open = L.reduce((s, x) => s + (x.t === 'inv' ? x.open : 0), 0);
  const ar = ARD.arOf(c);
  const doc = { t: 'st', d: ARD.ilDay(Date.now()), draft: L.some((x) => x.draft), title: `סיכום חשבוניות – ${String(mo).padStart(2, '0')}/${y}`, biz: await bizOf(db, w, cfg), cust: ARD.custSnap(c),
    table: { head: ['תאריך', 'מסמך', 'מס׳', 'סכום', 'יתרה לתשלום'], rows, num: [3, 4] },
    sums: [['סה״כ החודש', tot / 100], ['מזה פתוח לתשלום', open / 100], ['יתרת החשבון כעת', ar.bal / 100]],
    note: 'מסמך סיכום בלבד – לא חשבונית מס. החשבוניות עצמן נשלחו בנפרד.' };
  const buf = await PDF.render(doc);
  const f = `sum_${cid}_${ym}`;
  await AF.put(w.bizId, f, buf);
  const sref = db.doc(`arsum/${cid}_${ym}`);
  await sref.set({ cust: cid, ym, n: L.length, tot, open, at: Date.now(), by: w.uid, f }, { merge: true });
  return { buf, doc, f, sref, mo, y, name: `סיכום חשבוניות ${ym}.pdf`, n: L.length, tot, open };
}
async function monSend(db, w, cfg, c, m, list, auto) {
  const out = [];
  for (const [ch, t] of list) {
    let r;
    if (!t) r = { ch, to: '', at: Date.now(), ok: false, why: 'no-to' };
    else if (ch === 'wa') {
      const tpl = cfg.wt && TPL_RE.test(String(cfg.wt.st || '')) ? cfg.wt.st : '';
      if (!tpl) r = { ch, to: t, at: Date.now(), ok: false, why: 'no-tpl' };
      else { const lk = await AF.mkLink({ biz: w.bizId, id: m.f, n: m.name }); r = await S.sendWa(db, { to: t, tpl: { name: tpl, lang: 'he', params: [m.doc.cust.name, `${String(m.mo).padStart(2, '0')}/${m.y}`, ag2(m.tot)] }, link: lk.url, fileName: m.name, auto, by: w.uid, token: sv(WA_ACCESS_TOKEN), now: Date.now() }); }
    } else r = await S.sendMail(w.bizId, { to: t, subject: `${m.doc.title}${cfg.name ? ' – ' + cfg.name : ''}`, text: `שלום ${m.doc.cust.name},\nמצורף ${m.doc.title}.\n${cfg.name || ''}`, replyTo: cfg.mail, fromName: cfg.name || '', pdf: m.buf, fileName: m.name, by: w.uid, now: Date.now() });
    out.push(Object.assign({}, r, { by: w.uid }, auto ? { auto: true } : {}));
  }
  await m.sref.update({ sent: out.slice(-SENT_MAX) });
  return out;
}
async function arMonthly(request) {
  const w = await OC.who(request);
  const input = inputObject(request);
  onlyKeys(input, ['cust', 'ym', 'ch', 'to', 'reqId']);
  const cid = idOf(input.cust, 'לקוח');
  if (typeof input.ym !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(input.ym)) throw bad('bad-ym', 'חודש לא תקין');
  if (input.ch != null && input.ch !== 'wa' && input.ch !== 'mail') throw bad('bad-ch', 'בחרו ווטסאפ או מייל');
  const db = T.tdb();
  const cfg = await cfgOf(db);
  needOn(cfg);
  const cs = await db.doc('cust/' + cid).get();
  if (!cs.exists || cs.get('mv')) throw new HttpsError('not-found', 'הלקוח לא נמצא', { reason: 'no-cust' });
  const c = cs.data();
  const m = await monBuild(db, w, cfg, c, cid, input.ym);
  const out = { name: m.name, b64: m.buf.toString('base64'), n: m.n, tot: m.tot, open: m.open, sent: [] };
  if (input.ch) {
    const reqId = reqIdOf(input);
    const mark = markRef(db, reqId);
    try { await mark.create({ k: 'arMonthly', key: cid + '_' + input.ym, t: Date.now(), by: w.uid }); } catch (e) { if (e && (e.code === 6 || /already exists/i.test(String(e.message)))) return Object.assign(out, { dup: true }); throw e; }
    out.sent = await monSend(db, w, cfg, c, m, targets({}, { cust: m.doc.cust }, c, input.ch, input.to ? String(input.to).trim().slice(0, 254) : ''), false);
    await mark.update({ r: { sent: out.sent } });
  }
  return out;
}

// =====================================================================================
// שלב 5 (15.11.2026): כרטסת ותזכורות תשלום.
//   arStatement – כרטסת ללקוח (104–105): PDF עם תאריך, מסמך, חובה, זכות, יתרה מצטברת, בטווח תאריכים; או "יתרה פתוחה" (open:true – רק החשבוניות הפתוחות).
//                 מנהל ועובד עם הזמנות (106). שליחה ללקוח במייל / ווטסאפ (ווטסאפ רק עם תבנית wt.st מאושרת), עם מזהה בקשה.
//   setRemCfg   – מנהל בלבד: הגדרות התזכורות (arcfg/rem), וללקוח – כיבוי תזכורות / ימים לפני (cust.rem) וסיכום חודשי אוטומטי (cust.invM).
//                 { get:true } – ההגדרות וסיכומי 7 הימים האחרונים (arrem/sum_*), כי לאוספים האלה אין קריאה מהאפליקציה.
// המנוע עצמו – ar-remind.js (arRemind, מתוזמנת).
// =====================================================================================
const LTN = { inv: 'חשבונית מס', ir: 'חשבונית מס קבלה', rc: 'קבלה', cr: 'זיכוי', ob: 'יתרת פתיחה (מיובא)', old: 'מסמך מיובא' };
const LXN = { inv: 'חשבונית (מיובא)', rc: 'קבלה (מיובא)', cr: 'זיכוי (מיובא)' }; // שלב 6: old לפי הסוג המקורי (ot)
const agS = (a) => (a ? ag2(a) : '');
// PDF של כרטסת / יתרה פתוחה. L = מסמכי הלקוח (ardoc). opts: { from, to, open }
async function stmtBuild(db, w, cfg, c, L, opts) {
  const o = opts || {};
  const cust = ARD.custSnap(c);
  const biz = await bizOf(db, w, cfg);
  const d = ARD.ilDay(Date.now());
  const draft = L.some((x) => x.draft);
  let doc;
  if (o.open) {
    // שלב 6: גם חוב מיובא (ob/old)
    const inv = L.filter((x) => ARD.isDr(x) && !x.void && x.open > 0).sort((a, b) => String(a.dueX || a.due).localeCompare(String(b.dueX || b.due)) || a.no - b.no);
    const sum = inv.reduce((s, x) => s + x.open, 0);
    doc = { t: 'st', d, draft, title: 'פירוט יתרה פתוחה', biz, cust,
      table: { head: ['תאריך', 'חשבונית', 'לתשלום עד', 'סכום', 'יתרה לתשלום'], rows: inv.map((x) => [shDate(x.d), x.t === 'ob' ? 'יתרת פתיחה' : String(x.no), shDate(x.dueX || x.due), ag2(x.gross), ag2(x.open)]), num: [3, 4] },
      sums: [['סה״כ לתשלום', sum / 100]].concat(ARD.arOf(c).cr > 0 ? [['יתרת זכות (תקוזז)', ARD.arOf(c).cr / 100]] : []), note: o.note || '' };
    return { buf: await PDF.render(doc), doc, sum, n: inv.length, name: 'פירוט יתרה.pdf' };
  }
  const lg = AC.ledger(L, o.from, o.to);
  const rows = (o.from ? [[shDate(o.from), 'יתרת פתיחה', '', '', ag2(lg.open)]] : []).concat(lg.rows.map((r) => [shDate(r.d), `${(r.t === 'old' && LXN[r.ot]) || LTN[r.t] || ''} ${r.no || ''}`.trim(), agS(r.dr), agS(r.cr), ag2(r.bal)]));
  doc = { t: 'st', d, draft, title: 'כרטסת לקוח' + (o.from || o.to ? ` ${shDate(o.from) || '…'} – ${shDate(o.to) || shDate(d)}` : ''), biz, cust,
    table: { head: ['תאריך', 'מסמך', 'חובה', 'זכות', 'יתרה'], rows, num: [2, 3, 4] },
    sums: [['סה״כ חובה', lg.dr / 100], ['סה״כ זכות', lg.cr / 100], ['יתרה לסוף התקופה', lg.end / 100]],
    note: 'יתרה חיובית = הלקוח חייב. מסמך מידע – לא חשבונית מס.' };
  return { buf: await PDF.render(doc), doc, lg, name: 'כרטסת.pdf' };
}
async function custDocs(db, cid) {
  const q = await db.collection('ardoc').where('cust', '==', cid).get();
  return q.docs.map((s) => Object.assign({ id: s.id }, s.data()));
}
// ---------- arStatement({ cust, from?, to?, open?, ch?, dest?, reqId? }) – dest = נמען אחר (לא חובה); to = עד תאריך ----------
async function arStatement(request) {
  const w = await OC.who(request);
  const input = inputObject(request);
  onlyKeys(input, ['cust', 'from', 'to', 'open', 'ch', 'dest', 'reqId']);
  const cid = idOf(input.cust, 'לקוח');
  for (const k of ['from', 'to']) if (input[k] != null && input[k] !== '' && !AC.ymdOk(input[k])) throw bad('bad-date', 'תאריך לא תקין');
  if (input.from && input.to && input.from > input.to) throw bad('bad-date', 'טווח תאריכים לא תקין');
  if (input.open !== undefined && typeof input.open !== 'boolean') throw bad('bad-field', 'open: כן/לא');
  if (input.ch != null && input.ch !== 'wa' && input.ch !== 'mail') throw bad('bad-ch', 'בחרו ווטסאפ או מייל');
  const db = T.tdb();
  const cfg = await cfgOf(db);
  needOn(cfg);
  const cs = await db.doc('cust/' + cid).get();
  if (!cs.exists || cs.get('mv')) throw new HttpsError('not-found', 'הלקוח לא נמצא', { reason: 'no-cust' });
  const c = cs.data();
  const st = await stmtBuild(db, w, cfg, c, await custDocs(db, cid), { from: input.from || '', to: input.to || '', open: input.open === true });
  const out = { name: st.name, b64: st.buf.toString('base64'), bal: ARD.arOf(c).bal, sent: [] };
  if (st.lg) Object.assign(out, { end: st.lg.end, calc: st.lg.bal });
  if (input.ch) {
    const reqId = reqIdOf(input);
    const mark = markRef(db, reqId);
    try { await mark.create({ k: 'arStatement', key: cid, t: Date.now(), by: w.uid }); } catch (e) {
      if (e && (e.code === 6 || /already exists/i.test(String(e.message)))) { const ms = await mark.get(); markHit(ms, 'arStatement', cid); return Object.assign(out, ms.get('r') || {}, { dup: true }); }
      throw e;
    }
    const f = `stm_${cid}_${Date.now()}`;
    await AF.put(w.bizId, f, st.buf);
    for (const [ch, t] of targets({}, { cust: st.doc.cust }, c, input.ch, input.dest ? String(input.dest).trim().slice(0, 254) : '')) {
      let r;
      if (!t) r = { ch, to: '', at: Date.now(), ok: false, why: 'no-to' };
      else if (ch === 'wa') {
        const tpl = cfg.wt && TPL_RE.test(String(cfg.wt.st || '')) ? cfg.wt.st : '';
        if (!tpl) r = { ch, to: t, at: Date.now(), ok: false, why: 'no-tpl' };
        else { const lk = await AF.mkLink({ biz: w.bizId, id: f, n: st.name }); r = await S.sendWa(db, { to: t, tpl: { name: tpl, lang: 'he', params: [st.doc.cust.name, st.doc.title, ag2(out.bal)] }, link: lk.url, fileName: st.name, auto: false, by: w.uid, token: sv(WA_ACCESS_TOKEN), now: Date.now() }); }
      } else r = await S.sendMail(w.bizId, { to: t, subject: `${st.doc.title}${cfg.name ? ' – ' + cfg.name : ''}`, text: `שלום ${st.doc.cust.name},\nמצורף/ת ${st.doc.title}.${st.doc.draft ? '\n(כולל מסמכי טיוטה – לא רשמיים)' : ''}\n${cfg.name || ''}`, replyTo: cfg.mail, fromName: cfg.name || '', pdf: st.buf, fileName: st.name, by: w.uid, now: Date.now() });
      out.sent.push(Object.assign({}, r, { by: w.uid }));
    }
    await mark.update({ r: { sent: out.sent } });
  }
  return out;
}

// ---------- setRemCfg ----------
//   עסק:  { on?, hour?, b?, steps?, mon?, cap?, txt?, sum? }  → arcfg/rem (merge)
//   לקוח: { cust, rem?:{ on, b? } | null, invM?:boolean }    → cust.rem / cust.invM
//   קריאה: { get:true } → { cfg, sums:[arrem/sum_* של 7 הימים האחרונים] }
const REM_TXT = 1500;
async function setRemCfg(request) {
  const w = await OC.who(request);
  mgr(w);
  const input = inputObject(request);
  const db = T.tdb();
  const now = Date.now();
  if (input.get === true) {
    onlyKeys(input, ['get']);
    const s = await db.doc('arcfg/rem').get();
    const days = Array.from({ length: 7 }, (_, i) => ARD.ilDay(now - i * 864e5));
    const ss = await db.getAll(...days.map((d) => db.doc('arrem/sum_' + d)));
    return { cfg: s.exists ? s.data() : {}, sums: ss.filter((x) => x.exists).map((x) => x.data()) };
  }
  if (input.cust !== undefined) {
    onlyKeys(input, ['cust', 'rem', 'invM']);
    const cid = idOf(input.cust, 'לקוח');
    const up = {};
    if (input.rem !== undefined) {
      const x = input.rem;
      if (x === null) up.rem = require('firebase-admin/firestore').FieldValue.delete();
      else {
        if (typeof x !== 'object' || Array.isArray(x)) throw bad('bad-rem', 'הגדרת תזכורות לא תקינה');
        onlyKeys(x, ['on', 'b'], 'תזכורות');
        if (typeof x.on !== 'boolean') throw bad('bad-rem', 'תזכורות ללקוח: כן/לא');
        if (x.b != null && !(Number.isInteger(x.b) && x.b >= 0 && x.b <= 60)) throw bad('bad-rem', 'ימים לפני המועד: 0–60');
        up.rem = x.b == null ? { on: x.on } : { on: x.on, b: x.b };
      }
    }
    if (input.invM !== undefined) { if (typeof input.invM !== 'boolean') throw bad('bad-field', 'סיכום חודשי אוטומטי: כן/לא'); up.invM = input.invM; }
    if (!Object.keys(up).length) throw bad('bad-cfg', 'אין מה לשמור');
    const ref = db.doc('cust/' + cid);
    const s = await ref.get();
    if (!s.exists || s.get('mv')) throw new HttpsError('not-found', 'הלקוח לא נמצא', { reason: 'no-cust' });
    await ref.update(Object.assign(up, { remBy: w.uid, remAt: now }));
    return { ok: true };
  }
  onlyKeys(input, ['on', 'hour', 'b', 'steps', 'mon', 'cap', 'txt', 'sum']);
  const up = {};
  if (input.on !== undefined) { if (typeof input.on !== 'boolean') throw bad('bad-cfg', 'תזכורות: כן/לא'); up.on = input.on; }
  if (input.sum !== undefined) { if (typeof input.sum !== 'boolean') throw bad('bad-cfg', 'סיכום יומי: כן/לא'); up.sum = input.sum; }
  if (input.hour !== undefined) { if (!Number.isInteger(input.hour) || input.hour < 6 || input.hour > 19) throw bad('bad-cfg', 'שעת שליחה: 6–19 (לא שולחים אחרי 20:00)'); up.hour = input.hour; }
  if (input.b !== undefined) { if (!Number.isInteger(input.b) || input.b < 0 || input.b > 60) throw bad('bad-cfg', 'ימים לפני המועד: 0–60'); up.b = input.b; }
  if (input.steps !== undefined) {
    const x = input.steps;
    if (!Array.isArray(x) || x.length > 8 || !x.every((v) => Number.isInteger(v) && v >= 0 && v <= 365)) throw bad('bad-cfg', 'ימים אחרי המועד: עד 8 מספרים, 0–365');
    up.steps = [...new Set(x)].sort((a, b) => a - b);
  }
  if (input.mon !== undefined) { if (!(input.mon === 0 || (Number.isInteger(input.mon) && input.mon >= 7 && input.mon <= 90))) throw bad('bad-cfg', 'תזכורת חוזרת: 0 (בלי) או 7–90 ימים'); up.mon = input.mon; }
  if (input.cap !== undefined) { if (!Number.isInteger(input.cap) || input.cap < 1 || input.cap > 1000) throw bad('bad-cfg', 'תקרה יומית: 1–1000'); up.cap = input.cap; }
  if (input.txt !== undefined) up.txt = txtIn(input.txt, REM_TXT, 'נוסח');
  if (!Object.keys(up).length) throw bad('bad-cfg', 'אין מה לשמור');
  await db.doc('arcfg/rem').set(Object.assign(up, { upd: now, by: w.uid }), { merge: true });
  return { ok: true };
}

// ---------- setArOff – מנהל־על בלבד ----------
async function setArOff(request) {
  const w = await OC.who(request);
  if (!w.uid || !(await T.isSuper(w.uid))) throw deny('not-superadmin', 'הפעולה מותרת למנהל המערכת בלבד');
  const input = inputObject(request);
  onlyKeys(input, ['bizId', 'on', 'bt', 'start', 'amin']);
  const db = T.tdb();
  const up = {};
  if (input.on !== undefined) { if (typeof input.on !== 'boolean') throw bad('bad-cfg', 'רשמי: כן/לא'); up.on = input.on; }
  if (input.bt !== undefined) { if (!ARD.BTS.includes(input.bt)) throw bad('bad-cfg', 'סוג העסק: עוסק מורשה, חברה או פטור'); up.bt = input.bt; }
  if (input.amin !== undefined) { if (input.amin !== null && (!isNum(input.amin) || input.amin < 0 || input.amin > 1e8)) throw bad('bad-cfg', 'סף מספר הקצאה לא תקין'); up.amin = input.amin === null ? 0 : input.amin; }
  if (input.start !== undefined) {
    const x = input.start;
    if (!x || typeof x !== 'object' || Array.isArray(x)) throw bad('bad-cfg', 'מספרי התחלה לא תקינים');
    onlyKeys(x, ARD.TYPES, 'מספרי התחלה');
    const seqs = await Promise.all(Object.keys(x).map((t) => db.doc(`arcfg/seq_${t}O`).get()));
    Object.keys(x).forEach((t, i) => {
      if (!Number.isInteger(x[t]) || x[t] < 1 || x[t] > 1e9) throw bad('bad-cfg', 'מספר התחלה: מספר שלם חיובי');
      if (seqs[i].exists) throw pre('seq-started', 'כבר הופקו מסמכים רשמיים בסדרה הזו – אי אפשר לשנות את מספר ההתחלה');
      up['start.' + t] = x[t];
    });
  }
  if (!Object.keys(up).length) throw bad('bad-cfg', 'אין מה לשמור');
  const ref = db.doc('arcfg/off');
  const s = await ref.get();
  // תיקון סבב 1 (הערה 4): אחרי שהופק מסמך רשמי אחד – אין חזרה לטיוטה (המספור הרשמי חייב להמשיך ברצף)
  if (up.on === false && s.exists && s.get('on') === true) {
    const ss = await Promise.all(ARD.TYPES.map((t) => db.doc(`arcfg/seq_${t}O`).get()));
    if (ss.some((x) => x.exists)) throw pre('official-started', 'כבר הופקו מסמכים רשמיים – אי אפשר לחזור למצב טיוטה');
  }
  const now = Date.now();
  if (!s.exists) await ref.set({}, { merge: true });
  await ref.update(Object.assign(up, { upd: now, by: w.uid }));
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
const FNS = { arOc, arPdf, arSend, setArCfg, arIssue, arReceipt, arCredit, arVoidRc, arProof, arProofGet, arDoc, arMonthly, setArOff, arStatement, setRemCfg };
const SENDS = ['arOc', 'arSend', 'arIssue', 'arReceipt', 'arCredit', 'arVoidRc', 'arDoc', 'arMonthly', 'arStatement']; // שולחות: סוד ווטסאפ + סודות המייל
for (const [k, f] of Object.entries(FNS)) exports[k] = onCall(SENDS.includes(k) ? { secrets: [WA_ACCESS_TOKEN].concat(S.MAIL_SECRETS), timeoutSeconds: 120, memory: '512MiB' } : { memory: '512MiB' }, wrap(k, f));
Object.defineProperty(exports, '_core', { enumerable: false, value: { sigOf, linesOf, fileOf, ilDay, afterIssue, docRender, sniffMime, refTxt, rfTxt, cfgOf, bizOf, stmtBuild, monBuild, monSend, targets, custOf, WA_ACCESS_TOKEN } });
