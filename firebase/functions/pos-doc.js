'use strict';
// קופה (POS), גל 2 – ש2: מסמכים של הקופה (ardoc דרך ar-doc.js) ונתוני הקבלה. 17.11.2026.
// מסמך לא נמחק ולא משתנה: ביטול = מסמך נגדי (cr). המספור – ספר המסמכים (Book) בתוך הטרנזקציה של המכירה / ההחזרה,
// ולכן מכירה שנכשלה לא "שורפת" מספר: אין חור ואין כפילות. סדרה לפי docSeries: 'dev' = מונה לכל קופה (arcfg/seq_{t}{O|D}_{dev}),
// 'biz' = מונה אחד לעסק (בדיוק כמו המסמכים הקיימים). סדרה O/D – לפי arcfg/off (docDraft של מנהל־על).
// docShowSaleId=false (ברירת המחדל) – מזהה המכירה הפנימי (possale.id) לא נשמר ולא מודפס במסמך. הקשר נשמר במכירה (possale.docs).
//
// פונקציה (onCall):
//   posDoc({ op:'get', sale })              → { sale, pays, docs, hdr } – נתוני הקבלה להדפסה חוזרת / שליחה (pos-receipt.js בונה את הקבלה).
//   posDoc({ op:'printed', sale, ok })      → { prn } – ok:true = הודפסה ('ok'); false = נייר נגמר / תקלה ('pend', ד H7). הדפסה שנייה = reprint ביומן.
//   posDoc({ op:'gift', sale })            → { ok } – קבלת מתנה: רישום ביומן (giftRcpt).
//   posDoc({ op:'send', sale, ch })         → { ok, sent:[{ch,to,at,ok,why?,doc,t,no,auto:false,by}] } – קופה גל 3 (19.11.2026): שליחת מסמכי המכירה
//                                             ללקוח (ch: 'wa' | 'mail' | 'both') בלחיצה – "שלח שוב" / בחירה בסוף מכירה. אותו מנוע כמו חשבוניות ההזמנות
//                                             (ar.js sendDoc → lib/ar-send.js: תבנית וואטסאפ מאושרת, מונה יומי, מונה מיילים). רישום: ardoc.sent + possale.sent.
//   posDoc({ op:'pdf', sale })              → { files:[{ id, t, no, name, b64 }] } – קובץ ה-PDF של מסמכי המכירה (הדפסת A4 באנדרואיד – PdfPrint).
// טריגר posSaleSend (onDocumentCreated b/{biz}/possale/{id}) – שליחה אוטומטית מיד אחרי שהמכירה נשמרה, ללקוח עסקי (cust.wholesale)
//   שבכרטיס שלו ערוץ (cust.snd.ch). לא חוסם את המכירה ולא מבטל אותה; "עצור הכל" עוצר (auto). פעם אחת למכירה (possale.autoSnd).
// שגיאות (details.reason): bad-input, bad-op, bad-sale, bad-ch, no-sale, no-doc, not-pos.

const { HttpsError } = require('firebase-functions/v2/https');
const { onCall, NEW_REGION } = require('./lib/region');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { requireStaff, inputObject, hasPerm } = require('./lib/roles');
const T = require('./lib/tenant');
const ARD = require('./lib/ar-doc');
const PC = require('./lib/pos-calc');

const SALE_RE = /^K[1-9][0-9]{0,3}-[0-9]{6}$/;
const bad = (reason, msg) => new HttpsError('invalid-argument', msg, { reason });
const pre = (reason, msg) => new HttpsError('failed-precondition', msg, { reason });
const deny = (reason, msg) => new HttpsError('permission-denied', msg, { reason });
const nf = (reason, msg) => new HttpsError('not-found', msg, { reason });

// ---------- איזה מסמך ----------
// lim: לקוח עסקי (cust.wholesale) – docBiz; לקוח רגיל – docDef. מכירה עם הקפה (debt>0) – תמיד חשבונית + קבלה לחלק ששולם
// (אפיון ב פ3: inv + rc; חשבונית מס קבלה לא יכולה להשאיר יתרה פתוחה).
// → ['ir'] | ['inv','rc'] | ['inv'] | ['rc']  (rc נשמט כשלא שולם כלום)
function kinds(cfg, o) {
  const biz = !!(o && o.biz);
  let k = biz ? cfg.docBiz : cfg.docDef;
  if (biz && k === 'choice') k = o.docAs === 'ir' ? 'ir' : 'inv+rc';
  let out;
  if (k === 'ir') out = ['ir'];
  else if (k === 'rc') out = ['rc'];
  else out = ['inv', 'rc']; // 'inv' / 'inv+rc'
  if (o && o.debt > 0 && out[0] !== 'inv') out = ['inv', 'rc'];
  if (o && !(o.paid > 0)) out = out.filter((t) => t !== 'rc');
  if (!out.length) out = ['inv'];
  return out;
}
// ה 5.16: חשבונית ללקוח עוסק מעל allocMin (לפני מע"מ) כש-allocMode:'manual' – לא מופקת בלי מספר הקצאה שהוקלד (alloc, 9 ספרות)
const needAlloc = (cfg, o) => !!(o && o.biz && o.ks.some((t) => t === 'inv' || t === 'ir') && cfg.allocMode === 'manual' && Number.isInteger(cfg.allocMin) && o.net > cfg.allocMin && !/^[0-9]{9}$/.test(String(o.alloc || '')));

// שורות המסמך (ardoc.lines: n, q, p בשקלים כמו ar-doc) + dsc = הנחה באגורות (מבצע + ידנית + חלק מהנחת החשבון)
function docLines(lines) {
  return lines.map((l) => {
    const o = { n: String(l.n || '').slice(0, 120), q: l.qty, p: l.unit / 100 };
    if (l.pid) o.pid = String(l.pid);
    const dsc = (l.disc || 0) + (l.sd || 0);
    if (dsc) o.dsc = dsc;
    return o;
  });
}
const paySum = (pays, chg) => {
  const m = {};
  for (const p of pays) m[p.m] = (m[p.m] || 0) + p.amt;
  if (chg > 0) m.cash = (m.cash || 0) - chg;
  return Object.entries(m).filter(([, v]) => v > 0).map(([k, v]) => ({ m: k, amt: v }));
};

// קריאות לפני הכתיבות (הטרנזקציה של Firestore): המונים של כל סוגי המסמכים שעשויים להידרש, והלקוח
async function prep(tx, db, w, now, cfg, dev, cust) {
  const B = new ARD.Book(tx, db, w, now, cfg.docSeries === 'biz' ? undefined : { dev });
  await B.init();
  await B.needSeq('ir', 'inv', 'rc', 'cr');
  const c = cust ? await B.needCust(cust) : null;
  return { B, c };
}
// מסמכי המכירה. s = { lines, vm, rate, net, vat, gross, paid, debt, chg, pays, cust, custData, br, note, id, alloc, ks }
function issueSale(B, cfg, s) {
  const snap = s.cust ? ARD.custSnap(s.custData || {}) : undefined;
  const base = Object.assign({ lines: docLines(s.lines), vm: s.vm, rate: s.rate, br: s.br || ARD.NB, cust: s.cust || '' }, snap ? { custSnap: snap } : {},
    s.note ? { note: String(s.note).slice(0, 300) } : {}, s.alloc ? { alloc: String(s.alloc) } : {}, cfg.docShowSaleId === true ? { req: s.id } : {});
  const out = [];
  const pay = paySum(s.pays, s.chg);
  if (s.ks[0] === 'ir') {
    const x = B.issue('ir', Object.assign({}, base, { net: s.net, vat: s.vat, gross: s.gross, pay }));
    out.push({ t: 'ir', id: x.id, no: x.d.no });
    return out;
  }
  if (s.ks[0] === 'rc') { // docDef 'rc' (עוסק פטור / קבלה בלבד)
    const x = B.issue('rc', Object.assign({}, base, { net: s.paid, vat: 0, gross: s.paid, pay }));
    if (!s.cust) B.set(x, { open: 0 });
    out.push({ t: 'rc', id: x.id, no: x.d.no });
    return out;
  }
  const inv = B.issue('inv', Object.assign({}, base, { net: s.net, vat: s.vat, gross: s.gross }));
  out.push({ t: 'inv', id: inv.id, no: inv.d.no });
  if (s.ks.includes('rc') && s.paid > 0) {
    const rc = B.issue('rc', Object.assign({}, base, { lines: [{ n: 'תשלום', q: 1, p: s.paid / 100 }], net: s.paid, vat: 0, gross: s.paid, pay }));
    B.alloc(rc, inv, s.paid);
    out.push({ t: 'rc', id: rc.id, no: rc.d.no });
  }
  return out;
}
// קבלה על תשלום חוב (posDebtPay) או מכירת כרטיס מתנה (posGift sell, giftDocMode 'advance' = מקדמה). open = מסמכים פתוחים של הלקוח
function issueRc(B, o) {
  const snap = o.cust ? ARD.custSnap(o.custData || {}) : undefined;
  const rc = B.issue('rc', Object.assign({ lines: [{ n: o.n, q: 1, p: o.amt / 100 }], vm: 'inc', rate: 0, net: o.amt, vat: 0, gross: o.amt, cust: o.cust || '',
    br: o.br || ARD.NB, pay: paySum(o.pays, o.chg) }, snap ? { custSnap: snap } : {}));
  if (o.cust && o.open) for (const inv of o.open) { if (rc.d.open <= 0) break; if (ARD.isDr(inv.d) && inv.d.open > 0 && !inv.d.void) B.alloc(rc, inv, rc.d.open); }
  if (!o.cust) B.set(rc, { open: 0 });
  return { t: 'rc', id: rc.id, no: rc.d.no };
}
// חשבונית זיכוי על החזרה. o = { lines, gross, rate, cust, custData, ref (מסמך המקור), debtOff, refund, refM, br, open (חשבוניות פתוחות, המקור קודם) }
// debtOff – מקוזז מחוב ההקפה (alloc לחשבוניות הפתוחות). refund – הוחזר בכסף / פתק (rf). debtOff + refund = gross.
function issueCr(B, o) {
  const v = PC.vatIn(o.gross, o.rate);
  const snap = o.cust ? ARD.custSnap(o.custData || {}) : undefined;
  const cr = B.issue('cr', Object.assign({ lines: o.lines, vm: 'inc', rate: v.rate, net: v.net, vat: v.vat, gross: o.gross, cust: o.cust || '', br: o.br || ARD.NB },
    snap ? { custSnap: snap } : {}, o.ref ? { ref: o.ref } : {}));
  let left = o.debtOff || 0;
  if (left > 0 && o.cust) for (const inv of o.open || []) { if (left <= 0) break; if (ARD.isDr(inv.d) && inv.d.open > 0 && !inv.d.void) left -= B.alloc(cr, inv, left); }
  if (left > 0) throw new Error('pos-doc: debt offset not allocated');
  const r = o.refund || 0;
  if (r > 0) {
    // כמו Book.refund, אבל בסכום מפורש (ההחזר יכול להתחלק בין כמה אמצעים – הפירוט ב-posret.refunds)
    cr.d.rf = { m: o.refM || 'mix', amt: r };
    B.set(cr, { open: cr.d.open - r });
    const c = cr.d.cust ? B.custs[cr.d.cust] : null;
    if (c) { c.ar.cr -= r; c.ar.bal += r; c.dirty = true; }
  }
  if (cr.d.open !== 0) throw new Error('pos-doc: cr not closed');
  return { t: 'cr', id: cr.id, no: cr.d.no };
}

// ---------- נתוני הקבלה ----------
// hdr: פרטי העסק מ-arcfg/main (name, bn, addr, phone, brand) + פרטי הסניף posbr/{br} (rcptHdr, addr, phone) – מה שקיים
async function hdrOf(db, br) {
  const [m, b] = await db.getAll(db.doc('arcfg/main'), db.doc('posbr/' + (br || '_')));
  const a = m.exists ? m.data() || {} : {}, x = b.exists ? b.data() || {} : {};
  const pick = (o, ks) => { const r = {}; for (const k of ks) if (typeof o[k] === 'string' && o[k]) r[k] = o[k].slice(0, 200); return r; };
  return Object.assign(pick(a, ['name', 'brand', 'bn', 'addr', 'phone', 'mail']), pick(x, ['rcptHdr', 'addr', 'phone']), x.name ? { brName: String(x.name).slice(0, 80) } : {});
}
const LOG_ACT = { reprint: 'reprint', gift: 'giftRcpt', send: 'send' };
async function docIn(request) {
  const input = inputObject(request);
  const who = await requireStaff(request);
  if (!who.prefix) throw pre('legacy', 'הקופה זמינה רק אחרי מעבר העסק למבנה החדש');
  if (!who.superadmin) T.requireFeature(who.biz, 'pos');
  if (!(hasPerm(who, 'pos') || hasPerm(who, 'posMgr'))) throw deny('not-pos', 'אין לך הרשאת קופה'); // 18.11.2026: גם מנהל רק עם pos / posMgr (מנהל־על מדליק; hasPerm).
  for (const k of Object.keys(input)) if (!['op', 'sale', 'ok', 'ch'].includes(k)) throw bad('bad-input', 'קלט לא תקין');
  if (!['get', 'printed', 'gift', 'send', 'pdf'].includes(input.op)) throw bad('bad-op', 'פעולה לא מוכרת');
  if (input.op === 'send' && !SEND_CH.includes(input.ch)) throw bad('bad-ch', 'ערוץ: וואטסאפ, מייל או שניהם');
  if (typeof input.sale !== 'string' || !SALE_RE.test(input.sale)) throw bad('bad-sale', 'מספר מכירה לא תקין');
  const db = T.tdb();
  const ref = db.doc('possale/' + input.sale);
  const s0 = await ref.get();
  if (!s0.exists) throw nf('no-sale', 'המכירה לא נמצאה');
  const sale = s0.data();
  // קופאי – רק מכירה שלו (כמו בכללים); אחראי / מנהל – הכול
  if (who.role !== 'manager' && !hasPerm(who, 'posMgr') && sale.cashier !== who.uid) throw deny('not-pos', 'אין גישה למכירה הזו');
  const now = Date.now();
  const log = (act, note) => db.collection('poslog').doc().set({ act, sale: input.sale, dev: sale.dev, br: sale.br || '_', by: who.uid, at: now, note: String(note || '').slice(0, 200) });
  if (input.op === 'printed') {
    if (typeof input.ok !== 'boolean') throw bad('bad-input', 'קלט לא תקין');
    let prn, again = false;
    await db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      const cur = s.get('prn');
      again = input.ok && cur === 'ok';
      prn = input.ok ? 'ok' : (cur === 'ok' ? 'ok' : 'pend');
      tx.update(ref, Object.assign({ prn, prnAt: now }, input.ok ? { prnN: (Number.isInteger(s.get('prnN')) ? s.get('prnN') : 0) + 1 } : {}));
    });
    if (again || (input.ok && sale.prn === 'pend')) await log('reprint', again ? 'עותק' : 'הדפסה אחרי תקלה');
    if (!input.ok) await log('prnFail', 'הקבלה ממתינה להדפסה');
    return { ok: true, prn };
  }
  if (input.op === 'gift') {
    await log(LOG_ACT.gift, '');
    return { ok: true };
  }
  if (input.op === 'send' || input.op === 'pdf') {
    if (!Array.isArray(sale.docs) || !sale.docs.length) throw pre('no-doc', 'למכירה עוד אין מסמך – נסו שוב כשהרשת תחזור');
    const w = { bizId: who.bizId, uid: who.uid };
    if (input.op === 'pdf') {
      const AR = arCore(), cfg = await AR.cfgOf(db), files = [];
      for (const d of sale.docs) { const doc = await AR.docOf(db, d.id); const b = await AR.docBuf(db, w, doc, cfg, false); files.push({ id: d.id, t: doc.t, no: doc.no, name: AR.docName(doc, false), b64: b.toString('base64') }); }
      return { ok: true, files };
    }
    const sent = await sendSale(w, input.sale, sale, input.ch, false);
    await log(LOG_ACT.send, input.ch + ':' + (sent.some((r) => r.ok) ? 'ok' : (sent[0] && sent[0].why) || 'fail'));
    return { ok: true, sent };
  }
  // get
  const pq = await db.collection('pospay').where('sale', '==', input.sale).get();
  const pays = pq.docs.map((d) => d.data()).sort((a, b) => (a.i || 0) - (b.i || 0));
  const docs = [];
  for (const d of sale.docs || []) {
    const x = await db.doc('ardoc/' + d.id).get();
    if (x.exists) { const v = x.data(); docs.push({ id: d.id, t: v.t, no: v.no, ser: v.ser, d: v.d, alloc: v.alloc || '', custSnap: v.custSnap || null }); }
  }
  return { ok: true, sale, pays, docs, hdr: await hdrOf(db, sale.br) };
}

// ---------- שליחה ללקוח (קופה גל 3) ----------
const SEND_CH = ['wa', 'mail', 'both'];
const POS_SENT_MAX = 30;
const arCore = () => require('./ar')._core; // טעינה מאוחרת: ar.js טוען את orders.js
// ערוצים לפי הבחירה (ch) או לפי הכרטיס (snd.ch); כרטיס בלי ערוץ תקין – אין שליחה אוטומטית
function chsOf(ch, snd) {
  const c = ch || (snd && typeof snd === 'object' && SEND_CH.includes(snd.ch) ? snd.ch : '');
  return c === 'both' ? ['wa', 'mail'] : c ? [c] : [];
}
// לקוח עסקי (כמו kinds/posSale: cust.wholesale) שבכרטיס שלו ערוץ – שליחה אוטומטית. אחרת – [] (פרטי / בלי הגדרה: כמו היום)
function autoChs(c) { return c && c.wholesale === true ? chsOf('', c.snd) : []; }
// שולח כל מסמך של המכירה בכל ערוץ. כשל לא זורק – נרשם (why). deps – לבדיקות בלבד ({ send, mail })
async function sendSale(w, saleId, sale, ch, auto, deps) {
  const AR = arCore();
  const db = T.tdb();
  const c = sale.cust ? await AR.custOf(db, { custId: sale.cust }) : null;
  const chs = ch ? chsOf(ch) : autoChs(c);
  const out = [];
  if (!chs.length) return out;
  const cfg = await AR.cfgOf(db);
  for (const d of sale.docs || []) {
    let doc, buf;
    try { doc = await AR.docOf(db, d.id); buf = await AR.docBuf(db, w, doc, cfg, false); } catch (e) {
      const why = String((e && e.details && e.details.reason) || 'pdf').slice(0, 40);
      for (const x of chs) out.push({ ch: x, to: '', at: Date.now(), ok: false, why, doc: d.id, t: d.t, no: d.no, auto: !!auto, by: w.uid });
      continue;
    }
    const recs = [];
    for (const [x, to] of AR.targets({ ch: ch || (c && c.snd && c.snd.ch) }, { cust: doc.custSnap || {} }, c).filter(([x]) => chs.includes(x))) {
      let r;
      try { r = to ? await AR.sendDoc(db, w, doc, x, to, !!auto, buf, cfg, false, deps) : { ch: x, to: '', at: Date.now(), ok: false, why: 'no-to' }; } catch (e) {
        r = { ch: x, to: String(to || '').slice(0, 254), at: Date.now(), ok: false, why: String((e && e.details && e.details.reason) || 'error').slice(0, 40) };
      }
      recs.push(Object.assign({}, r, { auto: !!auto, by: w.uid }));
    }
    try { await AR.docRecord(db, d.id, recs); } catch (e) { /* הרישום במסמך לא מבטל את השליחה */ }
    for (const r of recs) out.push(Object.assign({}, r, { doc: d.id, t: d.t, no: d.no }));
  }
  if (out.length) {
    const ref = db.doc('possale/' + saleId);
    await db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      if (!s.exists) return;
      tx.update(ref, { sent: (Array.isArray(s.get('sent')) ? s.get('sent') : []).concat(out).slice(-POS_SENT_MAX) });
    });
  }
  return out;
}
// הטריגר: פעם אחת למכירה (autoSnd נכתב בטרנזקציה לפני השליחה – אירוע כפול לא שולח פעמיים)
async function autoSend(bizId, saleId, deps) {
  const db = T.tdb();
  const ref = db.doc('possale/' + saleId);
  const s0 = await ref.get();
  if (!s0.exists) return { skip: 'no-sale' };
  const sale = s0.data() || {};
  if (!sale.cust || !Array.isArray(sale.docs) || !sale.docs.length || sale.chk) return { skip: 'no-doc' };
  const c = await arCore().custOf(db, { custId: sale.cust });
  if (!autoChs(c).length) return { skip: 'no-snd' };
  let first = false;
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists || s.get('autoSnd')) return;
    first = true;
    tx.update(ref, { autoSnd: Date.now() });
  });
  if (!first) return { skip: 'dup' };
  const sent = await sendSale({ bizId, uid: sale.cashier || '' }, saleId, sale, '', true, deps);
  return { sent };
}

const wrap = (name, fn) => T.scoped(async (request) => {
  try { return await fn(request); } catch (e) {
    if (e instanceof HttpsError) throw e;
    require('firebase-functions/logger').error(`pos: ${name} failed`, { msg: String(e && e.message || '').slice(0, 300) });
    throw new HttpsError('internal', 'שגיאה בפעולה. נסו שוב.', { reason: 'internal' });
  }
});
// שליחה מחייבת את סודות הוואטסאפ והמייל (כמו arDoc / arIssue ב-ar.js)
const SEND_SECRETS = () => [arCore().WA_ACCESS_TOKEN].concat(require('./lib/ar-send').MAIL_SECRETS);
exports.posDoc = onCall({ secrets: SEND_SECRETS(), timeoutSeconds: 120, memory: '512MiB' }, wrap('posDoc', docIn));
exports.posSaleSend = onDocumentCreated({ document: 'b/{bizId}/possale/{id}', region: NEW_REGION, retry: false, timeoutSeconds: 120, memory: '512MiB', maxInstances: 5, secrets: SEND_SECRETS() }, async (ev) => {
  const bizId = String(ev.params.bizId || '');
  if (!T.BIZ_RE.test(bizId) || !SALE_RE.test(String(ev.params.id || ''))) return null;
  const d = ev.data && typeof ev.data.data === 'function' ? ev.data.data() : null;
  if (!d || !d.cust || !Array.isArray(d.docs) || !d.docs.length) return null; // לקוח מזדמן / בלי מסמך – בלי קריאות נוספות
  try { return await T.runInBiz({ bizId, prefix: 'b/' + bizId + '/' }, () => autoSend(bizId, ev.params.id)); } catch (e) {
    require('firebase-functions/logger').error('pos: posSaleSend failed', { name: e && e.name, msg: String(e && e.message || '').slice(0, 200) });
    return null;
  }
});
Object.defineProperty(exports, '_core', { enumerable: false, value: {
  kinds, needAlloc, docLines, paySum, prep, issueSale, issueRc, issueCr, hdrOf, docIn, chsOf, autoChs, sendSale, autoSend, call: { posDoc: () => wrap('posDoc', docIn) },
} });
