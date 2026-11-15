'use strict';
// שלב 4 (משימה 2026-11-14_הזמנות-לקוח-עסקי-וחשבוניות): ספר המסמכים – חשבונית מס (inv), חשבונית מס קבלה (ir), קבלה (rc), זיכוי (cr).
// מספור, יתרת לקוח והקצאות – תמיד בתוך טרנזקציה אחת של Firestore (Book). בלי PDF ובלי שליחה (אלה ב-ar.js, אחרי הטרנזקציה).
//
//   ardoc/{t}{D|O}{no}  { t, ser, no, d, cust, custSnap, lines:[{n,q,p,u?,pid?,fr?}], vm, rate, disc?, net, vat, gross, due?, terms?, ord:[], br,
//                         ref?, li?, draft, bt, alloc?, alq?, pay?, proof?, req?, note?, by, at, f }  – תוכן קבוע. סכומים באגורות (שלמים, תמיד חיוביים).
//                       + שדות שמותר לשנות (רק דרך docUpd): open (אגורות: בחשבונית – יתרה לתשלום; בקבלה/זיכוי – זכות שעוד לא הוקצתה),
//                         st ('open'|'part'|'paid' בחשבונית, 'paid' ב-ir, 'ok'|'void' בקבלה ובזיכוי), sent[], void {at,by,why}, dueX (מועד שמנהל שינה), upd.
//   aralloc/{id}        { rc (הקבלה או הזיכוי), inv, amt (אגורות), cust, at, by, void? } – איזה תשלום/זיכוי סגר איזו חשבונית.
//   arcfg/seq_{t}{D|O}  { n } – המספר האחרון שהופק בכל סדרה. D = טיוטה, O = רשמי (רק כש-arcfg/off.on – מנהל־על). רשמי מתחיל מ-arcfg/off.start[t].
//   cust/{id}.ar        { bal, open, cr, at } – באגורות: bal = חובה − זכות; open = סכום החשבוניות הפתוחות; cr = זכות שלא הוקצתה. תמיד bal = open − cr.
//
// חובה: inv.gross, ir.gross. זכות: rc.gross (שלא בוטלה), ir.gross, cr.gross. מסמך לא נמחק ולא משתנה – רק docUpd, שמאפשר רק את השדות שלמעלה.

const { HttpsError } = require('firebase-functions/v2/https');
const AC = require('./ar-calc');
const TK = require('./tk-time');

const TYPES = ['inv', 'ir', 'rc', 'cr'];
const MUT = ['open', 'st', 'sent', 'void', 'dueX', 'upd'];
const BTS = ['osek', 'co', 'patur'];
const OPEN_MAX = 300;
const NB = '_';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isBiz = (s) => { const [y, m, d] = s.split('-').map(Number); return TK.tkBiz({ y, m: m - 1, d }); };
const ilDay = (now) => new Date(now).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
const docId = (t, ser, no) => t + ser + no;
const fileOf = (id, isVoid) => 'doc_' + id + (isVoid ? '_void' : '');
const dueFor = (terms, d) => AC.dueOf(terms, d, isBiz);
const arOf = (c) => { const a = c && c.ar && typeof c.ar === 'object' ? c.ar : {}; return { bal: Number.isInteger(a.bal) ? a.bal : 0, open: Number.isInteger(a.open) ? a.open : 0, cr: Number.isInteger(a.cr) ? a.cr : 0 }; };

// העדכון היחיד שמותר על ardoc קיים. כל שדה אחר (תוכן) – שגיאה, לפני שנכתב משהו.
function docUpd(tx, ref, patch) {
  const keys = Object.keys(patch || {});
  if (!keys.length) return;
  for (const k of keys) if (!MUT.includes(String(k).split('.')[0])) { const e = new Error('ar-doc: immutable field ' + k); e.reason = 'immutable'; throw e; }
  tx.update(ref, patch);
}

// פרטי הלקוח במסמך (צילום ברגע ההפקה): לקוח עסקי – השם העסקי וע.מ
function custSnap(c, k) {
  c = c || {}; k = k || {};
  return { name: String((c.wholesale === true && c.bn) || k.name || c.name || '').slice(0, 120), bn: String(c.vat || '').slice(0, 20),
    addr: String((k.ship && k.ship.addr) || k.addr || c.addr || '').slice(0, 160), phone: String(k.phone || c.phone || '').slice(0, 30), mail: String(k.mail || c.mail || '').slice(0, 254) };
}
// שורות מהזמנה (כמו linesOf של אישור ההזמנה) + pid ו-fr (סניף המקור) – לזיכוי עם החזרה למלאי. חבילת קווים: שורת התאמה
function ordLines(d) {
  const lines = (Array.isArray(d.items) ? d.items : []).map((it) => {
    const q = Number(it.qty), ct = Number(it.ct);
    const l = { n: String(it.n || '').slice(0, 120), q, p: Number(it.price), u: ct > 0 && Number.isInteger(q / ct) ? `${q / ct} קרטונים × ${ct}` : '' };
    if (it.pid) l.pid = String(it.pid);
    if (it.from) l.fr = String(it.from);
    return l;
  });
  const sum = lines.reduce((s, l) => s + Math.round(l.q * l.p * 100), 0);
  const tot = isNum(d.total) ? AC.ag(d.total) : sum;
  if (tot !== sum) lines.push({ n: 'התאמה לפי מחיר החבילה', q: 1, p: (tot - sum) / 100, u: '' });
  return lines;
}
const stOf = (t, open, gross) => (t === 'inv' ? (open <= 0 ? 'paid' : open < gross ? 'part' : 'open') : t === 'ir' ? 'paid' : 'ok');

// ---------- Book: כל הקריאות קודם (init / needSeq / needCust / openDocs / needDoc), אחר כך issue / alloc, ובסוף flush (כל הכתיבות) ----------
class Book {
  constructor(tx, db, w, now) {
    this.tx = tx; this.db = db; this.w = w; this.now = now || Date.now(); this.d = ilDay(this.now);
    this.seqs = {}; this.custs = {}; this.docs = {}; this.news = []; this.allocs = []; this.extra = [];
  }
  async init() {
    const { tx, db } = this;
    const [m, o, oc] = await tx.getAll(db.doc('arcfg/main'), db.doc('arcfg/off'), db.doc('ordcfg/main'));
    this.cfg = m.exists ? m.data() || {} : {};
    this.off = o.exists ? o.data() || {} : {};
    this.on = this.cfg.on === true;
    this.ser = this.off.on === true ? 'O' : 'D';
    this.bt = BTS.includes(this.off.bt) ? this.off.bt : 'osek';
    this.vat0 = oc.exists && isNum(oc.get('vat')) ? oc.get('vat') : AC.VAT0;
    return this;
  }
  rateOf(v) { return this.bt === 'patur' ? 0 : (isNum(v) && v >= 0 && v <= 100 ? v : this.vat0); }
  async needSeq(...ts) {
    for (const t of ts) {
      if (this.seqs[t]) continue;
      const ref = this.db.doc(`arcfg/seq_${t}${this.ser}`);
      const s = await this.tx.get(ref);
      this.seqs[t] = { ref, n: s.exists && Number.isInteger(s.get('n')) ? s.get('n') : null, dirty: false };
    }
  }
  async needCust(id) {
    if (!id) return null;
    if (!this.custs[id]) {
      const s = await this.tx.get(this.db.doc('cust/' + id));
      this.custs[id] = { id, ref: s.ref, data: s.exists ? s.data() || {} : null, ar: arOf(s.exists ? s.data() : null), dirty: false };
    }
    return this.custs[id];
  }
  // מסמך קיים (לעדכון open/st/void). מטמון – כדי ששתי פעולות באותה טרנזקציה יראו את אותו מצב
  async needDoc(id) {
    if (this.docs[id]) return this.docs[id];
    const s = await this.tx.get(this.db.doc('ardoc/' + id));
    if (!s.exists) return null;
    return (this.docs[id] = { id, ref: s.ref, d: s.data(), patch: {} });
  }
  // מסמכים פתוחים של הלקוח (חשבוניות עם יתרה, קבלות/זיכויים עם זכות שלא הוקצתה), מהישן לחדש
  async openDocs(custId) {
    const q = await this.tx.get(this.db.collection('ardoc').where('cust', '==', custId).where('open', '>', 0).limit(OPEN_MAX));
    const out = [];
    q.forEach((s) => { if (!this.docs[s.id]) this.docs[s.id] = { id: s.id, ref: s.ref, d: s.data(), patch: {} }; out.push(this.docs[s.id]); });
    return out.sort((a, b) => String(a.d.d).localeCompare(String(b.d.d)) || (a.d.at || 0) - (b.d.at || 0));
  }

  // ---- כתיבות (בזיכרון עד flush) ----
  issue(t, body) {
    if (!TYPES.includes(t)) throw new Error('ar-doc: bad type ' + t);
    const sq = this.seqs[t];
    if (!sq) throw new Error('ar-doc: seq not read ' + t);
    const start = this.ser === 'O' && this.off.start && Number.isInteger(this.off.start[t]) ? this.off.start[t] : 1;
    const no = AC.nextNo(sq.n, start);
    sq.n = no; sq.dirty = true;
    const id = docId(t, this.ser, no);
    const g = body.gross;
    if (!Number.isInteger(g) || g < 0) throw new Error('ar-doc: bad gross');
    const d = Object.assign({ t, ser: this.ser, no, d: this.d, cust: '', ord: [], br: NB, draft: this.ser !== 'O', bt: this.bt }, body,
      { by: this.w.uid, at: this.now, f: fileOf(id), sent: [], upd: this.now });
    d.open = t === 'ir' ? 0 : g;
    d.st = stOf(t, d.open, g);
    const x = { id, ref: this.db.doc('ardoc/' + id), d, patch: null, isNew: true };
    this.docs[id] = x; this.news.push(x);
    const c = d.cust ? this.custs[d.cust] : null;
    if (d.cust && !c) throw new Error('ar-doc: cust not read');
    if (c) {
      if (t === 'inv') { c.ar.bal += g; c.ar.open += g; }
      else if (t === 'rc' || t === 'cr') { c.ar.bal -= g; c.ar.cr += g; }
      c.dirty = true;
    }
    return x;
  }
  // src = קבלה/זיכוי עם זכות פתוחה, inv = חשבונית פתוחה. amt באגורות
  alloc(src, inv, amt) {
    const a = Math.min(amt, src.d.open, inv.d.open);
    if (!(a > 0)) return 0;
    if (inv.d.t !== 'inv' || !['rc', 'cr'].includes(src.d.t) || src.d.cust !== inv.d.cust) throw new Error('ar-doc: bad alloc');
    this.set(src, { open: src.d.open - a });
    this.set(inv, { open: inv.d.open - a, st: stOf('inv', inv.d.open - a, inv.d.gross) });
    const c = this.custs[inv.d.cust];
    if (c) { c.ar.open -= a; c.ar.cr -= a; c.dirty = true; }
    this.allocs.push({ rc: src.id, inv: inv.id, amt: a, cust: inv.d.cust });
    return a;
  }
  // עדכון שדה שמותר לשנות – במסמך חדש (לפני create) או קיים (docUpd ב-flush)
  set(x, patch) {
    for (const k of Object.keys(patch)) if (!MUT.includes(k)) throw new Error('ar-doc: immutable field ' + k);
    Object.assign(x.d, patch);
    if (!x.isNew) Object.assign(x.patch, patch);
  }
  // זכות פתוחה של הלקוח (קבלות / זיכויים) מקוזזת אוטומטית בחשבונית חדשה (101–102)
  offset(inv, open) {
    let n = 0;
    for (const s of open) { if (inv.d.open <= 0) break; if (['rc', 'cr'].includes(s.d.t) && s.d.open > 0 && !s.d.void) n += this.alloc(s, inv, s.d.open); }
    return n;
  }
  flush() {
    const { tx, db, now } = this;
    for (const sq of Object.values(this.seqs)) if (sq.dirty) tx.set(sq.ref, { n: sq.n });
    for (const x of this.news) tx.create(x.ref, x.d);
    for (const x of Object.values(this.docs)) if (!x.isNew && x.patch && Object.keys(x.patch).length) docUpd(tx, x.ref, Object.assign({}, x.patch, { upd: now }));
    for (const a of this.allocs) tx.set(db.collection('aralloc').doc(), Object.assign({}, a, { at: now, by: this.w.uid }));
    for (const c of Object.values(this.custs)) if (c.dirty && c.data) tx.update(c.ref, { ar: { bal: c.ar.bal, open: c.ar.open, cr: c.ar.cr, at: now } });
    for (const f of this.extra) f();
  }
}

// ---------- גוף חשבונית מהזמנה ----------
// → { body } או { err } (סכום לא תואם – לא מפיקים, ההזמנה ממשיכה כרגיל)
function ordBody(B, d, ordId, c, t) {
  const vm = d.vm === 'ex' ? 'ex' : 'inc';
  const rate = B.rateOf(d.vr);
  const lines = ordLines(d);
  const disc = d.vm && isNum(d.disc) && d.disc > 0 ? d.disc : 0;
  const s = AC.docSums(lines, vm, rate, disc);
  if (B.bt !== 'patur' && isNum(d.gross) && s.gross !== AC.ag(d.gross)) return { err: 'sum-mismatch' };
  const body = { cust: c && c.data ? c.id : '', custSnap: custSnap(c && c.data, d.cust), lines, vm, rate, net: s.net, vat: s.vat, gross: s.gross, ord: [ordId], br: d.br || NB };
  if (disc) body.disc = disc;
  if (t === 'inv') {
    const terms = AC.termsOfCust(c && c.data);
    body.terms = AC.termsTxt(terms);
    body.due = dueFor(terms, B.d);
  } else if (c && c.data && c.data.wholesale === true) body.terms = AC.termsTxt(AC.termsOfCust(c.data));
  // מספר הקצאה (67): נדרש ללקוח עסקי מעל הסף (arcfg/off.amin, ₪ לפני מע"מ – ערך לא מאומת). בהפקה אוטומטית אין את מי לשאול – מסומן alq
  if (needAlloc(B, c && c.data, s.net)) body.alq = true;
  return { body };
}
function needAlloc(B, c, net) { return !!(c && c.wholesale === true && isNum(B.off.amin) && B.off.amin > 0 && net > Math.round(B.off.amin * 100)); }

// ---------- חיבור להזמנה: setOrderStatus / markOrderPaid (orders.js) ----------
// planOrder(tx, db, w, s, kind, pay) – קריאות בלבד; מחזיר null (אין שינוי – המתג כבוי, הזמנה ישנה בלי vm, כבר יש מסמך) או
// { write(), res } – write() כותב באותה טרנזקציה (אחרי כל הקריאות של הקורא). kind:
//   'ship' – "נשלח" (לקוח בשוטף): חשבונית מס, מועד תשלום מתאריך היום (החלטה 22).
//   'paid' – "שולם": יש חשבונית פתוחה → קבלה על היתרה (עובד – רק עם אסמכתא שהעלה, החלטה 25); אין מסמך ולקוח לא עסקי → חשבונית מס קבלה;
//            לקוח עסקי בלי מסמך → כלום (חשבונית מס קבלה כשהסחורה יוצאת).
//   'out'  – שולם → יצא/הושלם בלי מסמך: חשבונית מס קבלה.
async function planOrder(tx, db, w, s, kind, pay) {
  const d = s.data() || {};
  if (!d.vm) return null;
  const B = new Book(tx, db, w);
  await B.init();
  if (!B.on) return null;
  const inv = d.inv && typeof d.inv === 'object' && d.inv.id ? d.inv : null;
  let t = null;
  if (kind === 'ship' && !inv) t = 'inv';
  else if (kind === 'out' && !inv && d.paid) t = 'ir';
  else if (kind === 'paid') {
    if (inv && inv.t === 'inv') t = 'rc';
    else if (!inv) {
      const cid = typeof d.custId === 'string' ? d.custId : '';
      const c0 = cid ? await B.needCust(cid) : null;
      if (!(c0 && c0.data && c0.data.wholesale === true)) t = 'ir';
    }
  }
  if (!t) return null;
  const c = typeof d.custId === 'string' && d.custId ? await B.needCust(d.custId) : null;
  await B.needSeq(t);
  if (t === 'rc') {
    const x = await B.needDoc(inv.id);
    if (!x || x.d.void || !(x.d.open > 0)) return null; // כבר שולמה (קבלות קודמות)
    const pf = await proofPlan(B, pay && pay.proofId);
    if (!pf.ok && w.role !== 'manager') throw new HttpsError('failed-precondition', PROOF_MSG[pf.why] || PROOF_MSG['need-proof'], { reason: pf.why || 'need-proof' });
    return { res: null, write() {
      const r = B.issue('rc', { cust: x.d.cust, custSnap: x.d.custSnap, lines: [], vm: x.d.vm, rate: 0, net: x.d.open, vat: 0, gross: x.d.open, ord: [s.id], br: d.br || NB,
        pay: payOf(pay), ...(pf.ok ? { proof: pf.id } : {}) });
      B.alloc(r, x, r.d.gross);
      if (pf.ok) pf.use(r.id);
      B.flush();
      return (this.res = { t: 'rc', id: r.id, no: r.d.no, draft: r.d.draft, gross: r.d.gross });
    } };
  }
  const ob = ordBody(B, d, s.id, c, t);
  if (ob.err) return { res: { err: ob.err }, write() { return this.res; } };
  if (t === 'ir') ob.body.pay = payOf(pay || d.paid);
  const open = t === 'inv' && c && c.data ? await B.openDocs(c.id) : [];
  return { res: null, write() {
    const r = B.issue(t, ob.body);
    if (t === 'inv') B.offset(r, open);
    B.flush();
    tx.update(s.ref, { inv: { id: r.id, no: r.d.no, t, draft: r.d.draft } });
    return (this.res = { t, id: r.id, no: r.d.no, draft: r.d.draft, gross: r.d.gross, due: r.d.due || '' });
  } };
}
// אמצעי התשלום בקבלה. method של "שולם" בהזמנה: link/phone = אשראי, והדרך המקורית נשמרת ב-via (תיקון סבב 1, ליקוי 4):
// "דוח Z" (ar-inc.js) מדלג רק על מה שנגבה בקופה – תשלום בקישור / בטלפון לא עובר בקופה, ולכן נרשם כהכנסה (הנחה)
const PAYM = ['cash', 'transfer', 'chq', 'card', 'other'];
function payOf(p) {
  p = p || {};
  const rem = p.method === 'link' || p.method === 'phone';
  const m = PAYM.includes(p.method) ? p.method : rem ? 'card' : 'other';
  const o = { m };
  if (rem) o.via = p.method;
  if (p.last4) o.last4 = String(p.last4);
  if (p.conf) o.conf = String(p.conf);
  if (p.note) o.note = String(p.note).slice(0, 200);
  if (p.chq && typeof p.chq === 'object') o.chq = { no: String(p.chq.no || ''), bank: String(p.chq.bank || ''), d: String(p.chq.d || '') };
  return o;
}
const PROOF_MSG = { 'need-proof': 'כדי לרשום תשלום צריך לצלם אסמכתא (העברה, צ\'ק, או צילום של הכסף / פתק חתום)', 'bad-proof': 'האסמכתא לא נמצאה או לא הועלתה עד הסוף. צלמו שוב',
  'proof-owner': 'אפשר להשתמש רק באסמכתא שהעליתם בעצמכם', 'proof-used': 'האסמכתא הזו כבר שימשה לקבלה אחרת' };
// אסמכתא (arproof): של המשתמש עצמו, הועלתה במלואה, ועוד לא שימשה קבלה. use(rcId) – מסמן שימוש באותה טרנזקציה
async function proofPlan(B, id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{8,40}$/.test(id)) return { ok: false, why: id ? 'bad-proof' : 'need-proof' };
  const s = await B.tx.get(B.db.doc('arproof/' + id));
  if (!s.exists || s.get('done') !== true) return { ok: false, why: 'bad-proof' };
  if (s.get('by') !== B.w.uid) return { ok: false, why: 'proof-owner' };
  if (s.get('used')) return { ok: false, why: 'proof-used' };
  return { ok: true, id, use: (rcId) => B.extra.push(() => B.tx.update(s.ref, { used: rcId, usedAt: B.now })) };
}

module.exports = { PROOF_MSG, Book, TYPES, MUT, BTS, PAYM, docUpd, custSnap, ordLines, ordBody, needAlloc, planOrder, proofPlan, payOf, dueFor, isBiz, ilDay, docId, fileOf, arOf, stOf, NB };
