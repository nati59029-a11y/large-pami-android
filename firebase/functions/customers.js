'use strict';
// לקוחות להזמנות (משימה 2026-11-08_בוט-הזמנות, ענף fb/ord-cust). כל כתיבה רק כאן; מהאפליקציה – קריאה לפי החוקים (תוספת 'orders' + הרשאת ord).
//
//   cust/{id}     { name, phone, tz?, mail?, addr?, last4?, port?, x:{<k>:txt}, wholesale?, at, upd, by, src:'manual'|'import'|'order', mv? }
//                 מזהה = t{tz} אם יש ת"ז, אחרת p{phone}. זיהוי בלי שאילתה, ייחודי בתוך העסק.
//                 mv = הלקוח הועבר למסמך t{tz} (נוספה לו ת"ז אחר כך). לא נמחק.
//   custcfg/main  { xKeys:[{k,label}], upd }  – שמות השדות החופשיים (מנהל)
//
// אשראי (החלטת המשתמש 22:04): נשמרות רק 4 ספרות אחרונות. אם מגיע מספר כרטיס מלא (13–19 ספרות) בשדה last4 – נחתך ל-4 האחרונות
// לפני כל שימוש, ולא נשמר ולא נרשם ביומן בשום צורה. בכל שדה טקסט אחר – 8+ ספרות ברצף נדחה (txt של orders.js).
// סיטונאי (22:10): ברירת מחדל = רגיל. רק מנהל משנה wholesale; הייבוא מתעלם ממנו; לקוח חדש מעובד – תמיד רגיל.

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const { getFirestore } = require('firebase-admin/firestore');
const T = require('./lib/tenant');
const { requireStaff, inputObject, hasPerm } = require('./lib/roles');
const core = require('./orders')._core;
const { defineSecret } = require('firebase-functions/params');
const CARD = require('./lib/card');
// fb/ord-card: מפתח הצפנה לפרטי כרטיס (Secret Manager). באמולטור – ערך דמה מ-functions/.secret.local
const CARD_ENC_KEY = defineSecret('CARD_ENC_KEY');

const bad = (reason, message) => new HttpsError('invalid-argument', message, { reason });
const deny = (reason, message) => new HttpsError('permission-denied', message, { reason });
const txt = core.txt;
const REQ_RE = /^[A-Za-z0-9_-]{8,40}$/;
const XK_RE = /^x[0-9a-z_]{1,20}$/;
const MAX_X = 20;
const MAX_ROWS = 200;
const FIELDS = ['name', 'phone', 'tz', 'mail', 'addr', 'last4', 'port'];

async function who(request) {
  const w = await requireStaff(request, { feature: 'orders' });
  if (!hasPerm(w, 'ord')) throw deny('no-perm', 'אין לך הרשאה להזמנות. פנה למנהל.');
  return w;
}
function onlyKeys(o, keys, label) {
  for (const k of Object.keys(o)) if (!keys.includes(k)) throw bad('bad-field', `שדה לא מוכר${label ? ' ב' + label : ''}: ` + String(k).slice(0, 30));
}
function phoneOf(raw) {
  let p = String(raw == null ? '' : raw).trim().replace(/[\s-]/g, '');
  if (/^\+?972\d{8,9}$/.test(p)) p = '0' + p.replace(/^\+?972/, '');
  if (/^5\d{8}$/.test(p)) p = '0' + p; // אקסל מוחק את ה-0 בהתחלה
  if (!/^0(5\d{8}|7\d{8}|[23489]\d{7})$/.test(p)) throw bad('bad-phone', 'מספר הטלפון לא תקין');
  return p;
}
// ת"ז ישראלית: עד 9 ספרות (משלימים 0 משמאל) + ספרת ביקורת
function tzOf(raw) {
  const t = String(raw == null ? '' : raw).replace(/\D/g, '');
  if (!/^\d{5,9}$/.test(t)) throw bad('bad-tz', 'ת.ז: 5 עד 9 ספרות');
  const z = t.padStart(9, '0');
  let s = 0;
  for (let i = 0; i < 9; i++) { let d = +z[i] * ((i % 2) + 1); if (d > 9) d -= 9; s += d; }
  if (s % 10 !== 0 || z === '000000000') throw bad('bad-tz', 'ת.ז לא תקינה (ספרת ביקורת)');
  return z;
}
// 4 ספרות אחרונות. מספר כרטיס מלא (13–19 ספרות, עם רווחים/מקפים) – נחתך ל-4 האחרונות (22:04). כל דבר אחר – נדחה.
function last4Of(raw) {
  const s = String(raw == null ? '' : raw).trim();
  const d = /\p{L}/u.test(s) ? s : s.replace(/\D/g, ''); // כל מפריד (רווח, מקף, נקודה, /, _) מוסר
  if (/^\d{4}$/.test(d)) return d;
  if (/^\d{13,19}$/.test(d)) return d.slice(-4);
  throw bad('bad-last4', '4 ספרות אחרונות: בדיוק 4 ספרות');
}
function mailOf(raw) {
  const m = String(raw).trim().toLowerCase();
  if (m.length > 254 || !/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(m)) throw bad('bad-email', 'כתובת המייל לא תקינה');
  if (core.digRun(m) >= 8) throw bad('card-like', 'מייל: אסור רצף של 8 ספרות ומעלה (מספר כרטיס).');
  return m;
}
function portOf(raw) {
  const s = String(raw).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(Date.parse(s + 'T00:00:00Z'))) throw bad('bad-port', 'תאריך ניוד: YYYY-MM-DD');
  return s;
}
const empty = (v) => v == null || v === '';
// מנקה פרטי לקוח. keys = מפתחות השדות החופשיים המותרים (custcfg). name/phone חובה רק כשיוצרים לקוח בלי ת"ז.
function clean(c, keys) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw bad('bad-cust', 'פרטי לקוח חסרים');
  const o = {};
  if (!empty(c.name)) o.name = txt(c.name, 60, 'bad-name', 'שם הלקוח');
  if (!empty(c.phone)) o.phone = phoneOf(c.phone);
  if (!empty(c.tz)) o.tz = tzOf(c.tz);
  if (!empty(c.mail)) o.mail = mailOf(c.mail);
  if (!empty(c.addr)) o.addr = txt(c.addr, 150, 'bad-addr', 'כתובת');
  if (!empty(c.last4)) o.last4 = last4Of(c.last4);
  if (!empty(c.port)) o.port = portOf(c.port);
  if (c.x != null) {
    if (typeof c.x !== 'object' || Array.isArray(c.x)) throw bad('bad-x', 'שדות נוספים לא תקינים');
    const ent = Object.entries(c.x).filter(([, v]) => !empty(v));
    if (ent.length > MAX_X) throw bad('bad-x', `עד ${MAX_X} שדות נוספים`);
    o.x = {};
    for (const [k, v] of ent) {
      if (!XK_RE.test(k) || !keys.includes(k)) throw bad('bad-x', 'שדה נוסף לא מוגדר: ' + String(k).slice(0, 25));
      o.x[k] = txt(String(v), 200, 'bad-x', 'שדה נוסף');
    }
  }
  if (!o.tz && !o.phone) throw bad('bad-cust', 'צריך ת.ז או טלפון');
  return o;
}
const idFor = (o) => (o.tz ? 't' + o.tz : 'p' + o.phone);
async function xKeys(db) {
  const s = await db.doc('custcfg/main').get();
  const a = s.exists && Array.isArray(s.get('xKeys')) ? s.get('xKeys') : [];
  return a.map((x) => x && x.k).filter((k) => typeof k === 'string');
}
// ממזג: fill = ממלא רק שדות ריקים (לא דורס); אחרת – דורס את מה שנשלח. מחזיר את השדות לעדכון (או null אם אין שינוי).
function merge(old, o, fill) {
  const up = {};
  for (const k of FIELDS) if (o[k] !== undefined && (fill ? empty(old[k]) : old[k] !== o[k])) up[k] = o[k];
  if (o.x) {
    const ox = old.x && typeof old.x === 'object' ? old.x : {};
    for (const [k, v] of Object.entries(o.x)) if (fill ? empty(ox[k]) : ox[k] !== v) up['x.' + k] = v;
  }
  return Object.keys(up).length ? up : null;
}
// כתיבה בטרנזקציה: לקוח שקיים רק לפי טלפון ועכשיו יש לו ת"ז – מועתק ל-t{tz}, והישן מסומן mv (לא נמחק).
async function upsert(tx, db, w, o, opts) {
  const id = idFor(o);
  const ref = db.doc('cust/' + id);
  const pref = o.tz && o.phone ? db.doc('cust/p' + o.phone) : null;
  const [s, ps] = pref ? await tx.getAll(ref, pref) : [await tx.get(ref), null];
  const now = Date.now();
  let base = s.exists ? s.data() : null;
  let moved = false;
  if (!base && ps && ps.exists && !ps.get('mv') && empty(ps.get('tz'))) { base = Object.assign({}, ps.data()); moved = true; }
  const ws = opts.wholesale;
  if (!base) {
    if (!o.name) throw bad('bad-name', 'שם הלקוח – חובה');
    if (!o.phone) throw bad('bad-phone', 'טלפון – חובה');
    const d = Object.assign({ x: {} }, o, { at: now, upd: now, by: w.uid, src: opts.src });
    if (ws === true) d.wholesale = true;
    tx.set(ref, d);
    return { id, created: true };
  }
  if (moved) {
    const d = Object.assign({}, base, { tz: o.tz, upd: now, by: w.uid });
    delete d.mv;
    const up = merge(base, o, opts.fill) || {};
    for (const [k, v] of Object.entries(up)) { if (k.startsWith('x.')) { d.x = Object.assign({}, d.x || {}); d.x[k.slice(2)] = v; } else d[k] = v; }
    if (typeof ws === 'boolean') d.wholesale = ws;
    tx.set(ref, d);
    tx.update(pref, { mv: id, upd: now });
    return { id, created: false, moved: true };
  }
  const u = merge(base, o, opts.fill) || {};
  if (typeof ws === 'boolean' && (base.wholesale === true) !== ws) u.wholesale = ws;
  if (!Object.keys(u).length) return { id, created: false, same: true };
  if (!base.x || typeof base.x !== 'object') { // מסמך ישן בלי x – יוצרים את המפה לפני עדכון נקודתי
    const xs = {};
    for (const k of Object.keys(u)) if (k.startsWith('x.')) { xs[k.slice(2)] = u[k]; delete u[k]; }
    u.x = xs;
  }
  tx.update(ref, Object.assign(u, { upd: now, by: w.uid }));
  return { id, created: false };
}

// saveCust({ cust:{name,phone,tz,mail,addr,last4,port,x}, fill?, wholesale? }) – עובד עם ord או מנהל.
// fill:true (שמירה מתוך הזמנה) = ממלא רק שדות ריקים. wholesale – מנהל בלבד; עובד ששולח אותו נדחה.
async function saveCust(request) {
  const w = await who(request);
  const input = inputObject(request);
  onlyKeys(input, ['cust', 'fill', 'wholesale']);
  if (input.wholesale !== undefined) {
    if (typeof input.wholesale !== 'boolean') throw bad('bad-field', 'סיטונאי: כן/לא');
    if (w.role !== 'manager') throw deny('manager-only', 'רק מנהל מסמן לקוח סיטונאי');
  }
  onlyKeys(input.cust || {}, ['name', 'phone', 'tz', 'mail', 'addr', 'last4', 'port', 'x'], 'פרטי לקוח');
  const db = T.tdb();
  const o = clean(input.cust, await xKeys(db));
  let r;
  await db.runTransaction(async (tx) => { r = await upsert(tx, db, w, o, { fill: input.fill === true, wholesale: input.wholesale, src: input.fill === true ? 'order' : 'manual' }); });
  return Object.assign({ ok: true }, r);
}

// importCusts({ reqId, rows:[{name,phone,tz,mail,addr,last4,port,x}] }) – מנהל בלבד, עד 200 שורות למנה.
// לקוח קיים (לפי t{tz}/p{phone}) – רק שדות ריקים מתמלאים (ייבוא חוזר לא יוצר כפולים ולא דורס). wholesale – לא מיובא (22:10).
// שורה שגויה לא עוצרת את המנה – מוחזרת ב-bad עם מספר השורה והסיבה (בלי הערך עצמו).
async function importCusts(request) {
  const w = await who(request);
  if (w.role !== 'manager') throw deny('manager-only', 'ייבוא לקוחות – מנהל בלבד');
  const input = inputObject(request);
  onlyKeys(input, ['reqId', 'rows']);
  if (typeof input.reqId !== 'string' || !REQ_RE.test(input.reqId)) throw bad('bad-req', 'מזהה בקשה חסר (reqId)');
  if (!Array.isArray(input.rows) || !input.rows.length || input.rows.length > MAX_ROWS) throw bad('bad-rows', `שורות: 1 עד ${MAX_ROWS}`);
  const db = T.tdb();
  const mark = db.doc('custcfg/req_' + input.reqId);
  if ((await mark.get()).exists) return { ok: true, dup: true, created: 0, updated: 0, bad: [] };
  const keys = await xKeys(db);
  const res = { ok: true, dup: false, created: 0, updated: 0, same: 0, bad: [] };
  const seen = new Set();
  for (let i = 0; i < input.rows.length; i++) {
    const row = input.rows[i];
    try {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw bad('bad-row', 'שורה לא תקינה');
      const r0 = Object.assign({}, row); delete r0.wholesale; delete r0.ws; // מתעלמים מעמודת סיטונאי
      // עמודה חופשית שמכילה מספר כרטיס מלא (13–19 ספרות) – נחתכת ל-4 ספרות ונשמרת כ-last4 בלבד (22:04)
      if (r0.x && typeof r0.x === 'object' && !Array.isArray(r0.x)) {
        r0.x = Object.assign({}, r0.x);
        for (const [k, v] of Object.entries(r0.x)) {
          const s0 = String(v == null ? '' : v), d = /\p{L}/u.test(s0) ? s0 : s0.replace(/\D/g, '');
          if (/^\d{13,19}$/.test(d)) { if (empty(r0.last4)) r0.last4 = d.slice(-4); delete r0.x[k]; }
        }
      }
      const card = r0.card == null ? null : CARD.cleanCard(r0.card); delete r0.card; // fb/ord-card: מוצפן בשרת (00:50 – כולל CVV)
      if (card) r0.last4 = card.num.slice(-4);
      onlyKeys(r0, ['name', 'phone', 'tz', 'mail', 'addr', 'last4', 'port', 'x'], 'שורה');
      const o = clean(r0, keys);
      const id = idFor(o);
      if (seen.has(id)) { res.same++; continue; } // כפילות בתוך אותה מנה
      seen.add(id);
      let r;
      await db.runTransaction(async (tx) => {
        r = await upsert(tx, db, w, o, { fill: true, src: 'import' });
        if (card) { // כרטיס קיים לא נדרס בייבוא (כמו שאר השדות – רק ריקים מתמלאים)
          const cref = db.doc(`cust/${r.id}/p/card`);
          if (!(await tx.get(cref)).exists) {
            tx.set(cref, { box: CARD.seal(CARD_ENC_KEY.value(), w.bizId, 'cust/' + r.id, card), last4: card.num.slice(-4), at: Date.now(), by: w.uid, src: 'import' });
            tx.update(db.doc('cust/' + r.id), { last4: card.num.slice(-4), card: true });
            tx.set(db.collection('cardLog').doc(), { t: Date.now(), by: w.uid, cust: r.id, act: 'import' });
          }
        }
      });
      if (r.created) res.created++; else if (r.same) res.same++; else res.updated++;
    } catch (e) {
      if (!(e instanceof HttpsError)) throw e;
      res.bad.push({ i, reason: (e.details && e.details.reason) || 'bad', msg: String(e.message).slice(0, 120) });
    }
  }
  await mark.set({ t: Date.now(), by: w.uid, k: 'importCusts', n: input.rows.length });
  return res;
}

// setCustCfg({ xKeys:[{k?,label}] }) – מנהל. k חסר = שדה חדש (נוצר מזהה). שדה שהוסר מהרשימה – הערכים הקיימים נשארים בלקוחות.
async function setCustCfg(request) {
  const w = await who(request);
  if (w.role !== 'manager') throw deny('manager-only', 'הפעולה מותרת למנהל בלבד');
  const input = inputObject(request);
  onlyKeys(input, ['xKeys']);
  if (!Array.isArray(input.xKeys) || input.xKeys.length > MAX_X) throw bad('bad-x', `עד ${MAX_X} שדות`);
  const out = [], ks = new Set();
  for (const x of input.xKeys) {
    if (!x || typeof x !== 'object' || Array.isArray(x)) throw bad('bad-x', 'שדה לא תקין');
    onlyKeys(x, ['k', 'label'], 'שדה');
    const label = txt(x.label, 40, 'bad-x', 'שם השדה', true);
    let k = x.k;
    if (k == null || k === '') { do { k = 'x' + Math.random().toString(36).slice(2, 8); } while (ks.has(k)); }
    if (typeof k !== 'string' || !XK_RE.test(k) || ks.has(k)) throw bad('bad-x', 'מזהה שדה לא תקין');
    ks.add(k);
    out.push({ k, label });
  }
  await T.tdb().doc('custcfg/main').set({ xKeys: out, upd: Date.now() }, { merge: true });
  return { ok: true, xKeys: out };
}

// ---------- fb/ord-card: פרטי כרטיס מוצפנים ----------
// cust/{id}/p/card { box:{v,iv,ct,tag}, last4, at, by, src } – אין קריאה מהאפליקציה (חוקים). cust/{id}.card=true + last4 בלבד גלויים.
// cardLog/{id} { t, by, cust, act:'set'|'import'|'view'|'copy'|'del', ord?, f? } – כל פעולה נרשמת. קריאה – מנהל בלבד.
const CID_RE = /^[tp][0-9]{8,10}$/;
const OPEN_ST = ['new', 'work', 'wait_pay'];
function custIdOf(v) { if (typeof v !== 'string' || !CID_RE.test(v)) throw bad('bad-id', 'לקוח לא תקין'); return v; }
const mgrOnly = (w) => { if (w.role !== 'manager') throw deny('manager-only', 'הפעולה מותרת למנהל בלבד'); };

// setCard({ custId, card:{num,exp?,name?,cvv?}, ordId? }) – מנהל; או עובד עם ord מתוך הזמנה שלא שולמה. דורס כרטיס קיים.
// עובד עם ord: רק עם ordId של הזמנה פתוחה (לא שולמה) בסניף שלו שמקושרת ללקוח – הזנת כרטיס מתוך ההזמנה (00:37).
async function ordGate(db, w, id, ordId) {
  if (typeof ordId !== 'string' || !/^[A-Za-z0-9_-]{1,60}$/.test(ordId)) throw deny('need-ord', 'פרטי כרטיס לעובד – רק מתוך הזמנה שלא שולמה');
  const o = await db.doc('ord/' + ordId).get();
  if (!o.exists) throw new HttpsError('not-found', 'ההזמנה לא נמצאה', { reason: 'no-ord' });
  if (o.get('custId') !== id) throw deny('not-linked', 'הלקוח לא מקושר להזמנה הזו');
  if (!OPEN_ST.includes(o.get('status'))) throw deny('ord-paid', 'ההזמנה כבר שולמה – פרטי הכרטיס למנהל בלבד');
  const br = o.get('br'), mine = w.staff && Array.isArray(w.staff.get('br')) ? w.staff.get('br') : null;
  if (mine && br && br !== '_' && !mine.includes(br)) throw deny('foreign-br', 'אין לך הרשאה להזמנה של סניף אחר');
  return ordId;
}
async function setCard(request) {
  const w = await who(request);
  const input = inputObject(request);
  onlyKeys(input, ['custId', 'card', 'ordId']);
  const id = custIdOf(input.custId);
  const card = CARD.cleanCard(input.card);
  const db = T.tdb();
  const ordId = w.role === 'manager' ? null : await ordGate(db, w, id, input.ordId);
  await db.runTransaction(async (tx) => {
    const s = await tx.get(db.doc('cust/' + id));
    if (!s.exists || s.get('mv')) throw new HttpsError('not-found', 'הלקוח לא נמצא', { reason: 'no-cust' });
    tx.set(db.doc(`cust/${id}/p/card`), { box: CARD.seal(CARD_ENC_KEY.value(), w.bizId, 'cust/' + id, card), last4: card.num.slice(-4), at: Date.now(), by: w.uid, src: 'manual' });
    tx.update(s.ref, { last4: card.num.slice(-4), card: true, upd: Date.now() });
    tx.set(db.collection('cardLog').doc(), Object.assign({ t: Date.now(), by: w.uid, cust: id, act: 'set' }, ordId ? { ord: ordId } : {}));
  });
  return { ok: true, last4: card.num.slice(-4) };
}

// getCard({ custId, act:'view'|'copy', ordId? }) → { card:{num,exp?,name?,cvv?} } למנהל; { card:{num} } לעובד.
// עובד עם ord: רק עם ordId של הזמנה שלא שולמה (new/work/wait_pay), בסניף שלו, שמקושרת ללקוח הזה (custId). נבדק בשרת.
// כל קריאה מוצלחת נרשמת ב-cardLog לפני שהערך מוחזר.
async function getCard(request) {
  const w = await who(request);
  const input = inputObject(request);
  onlyKeys(input, ['custId', 'act', 'ordId']);
  const id = custIdOf(input.custId);
  if (!['view', 'copy'].includes(input.act)) throw bad('bad-act', 'פעולה לא תקינה');
  const db = T.tdb();
  let ordId = null;
  if (w.role !== 'manager') {
    if (input.act !== 'copy') throw deny('manager-only', 'הצגת פרטי כרטיס – מנהל בלבד');
    ordId = await ordGate(db, w, id, input.ordId);
  } else if (input.ordId != null) {
    if (typeof input.ordId !== 'string' || !/^[A-Za-z0-9_-]{1,60}$/.test(input.ordId)) throw bad('bad-id', 'הזמנה לא תקינה');
    ordId = input.ordId;
  }
  const s = await db.doc(`cust/${id}/p/card`).get();
  if (!s.exists) throw new HttpsError('not-found', 'אין כרטיס שמור ללקוח', { reason: 'no-card' });
  const c = CARD.open(CARD_ENC_KEY.value(), w.bizId, 'cust/' + id, s.get('box'));
  const out = w.role === 'manager' ? c : { num: c.num };
  const log = { t: Date.now(), by: w.uid, cust: id, act: input.act, f: w.role === 'manager' ? 'all' : 'num' };
  if (ordId) log.ord = ordId;
  await db.collection('cardLog').add(log);
  return { card: out };
}

// delCard({ custId }) – מנהל. מוחק את המוצפן ואת last4/card מהלקוח. נרשם ביומן.
async function delCard(request) {
  const w = await who(request); mgrOnly(w);
  const input = inputObject(request);
  onlyKeys(input, ['custId']);
  const id = custIdOf(input.custId);
  const db = T.tdb();
  const { FieldValue } = require('firebase-admin/firestore');
  await db.runTransaction(async (tx) => {
    const s = await tx.get(db.doc('cust/' + id));
    if (!s.exists) throw new HttpsError('not-found', 'הלקוח לא נמצא', { reason: 'no-cust' });
    tx.delete(db.doc(`cust/${id}/p/card`));
    tx.update(s.ref, { card: FieldValue.delete(), last4: FieldValue.delete(), upd: Date.now() });
    tx.set(db.collection('cardLog').doc(), { t: Date.now(), by: w.uid, cust: id, act: 'del' });
  });
  return { ok: true };
}

const wrap = (name, fn) => T.scoped(async (request) => {
  try { return await fn(request); } catch (e) {
    if (e instanceof HttpsError) throw e;
    // בלי קלט ובלי הודעת השגיאה המלאה – כדי שפרטים אישיים לא ייכנסו ליומן
    logger.error(`customers: ${name} failed`, { reason: 'internal', name: e && e.name, code: e && e.code });
    throw new HttpsError('internal', 'שגיאה בפעולה. נסו שוב.', { reason: 'internal' });
  }
});
const FNS = { saveCust, setCustCfg };
for (const [k, f] of Object.entries(FNS)) exports[k] = onCall(wrap(k, f));
const SFNS = { importCusts, setCard, getCard, delCard }; // צריכות את מפתח הכרטיסים
for (const [k, f] of Object.entries(SFNS)) exports[k] = onCall({ secrets: [CARD_ENC_KEY] }, wrap(k, f));
Object.defineProperty(exports, '_core', { enumerable: false, value: { tzOf, last4Of, phoneOf, clean, idFor } });
