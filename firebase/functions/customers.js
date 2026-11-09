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

const bad = (reason, message) => new HttpsError('invalid-argument', message, { reason });
const deny = (reason, message) => new HttpsError('permission-denied', message, { reason });
const txt = core.txt;
const REQ_RE = /^[A-Za-z0-9_-]{8,40}$/;
const XK_RE = /^x[0-9a-z_]{1,20}$/;
const MAX_X = 20;
const MAX_ROWS = 200;
const MAX_PORTS = 30;
const portKey = (r) => [r.d || '', r.phone || '', r.tz || ''].join('|'); // br (סניף, 01:00) לא חלק מהמפתח – אותו ניוד מסניף אחר אינו כפילות
const FIELDS = ['name', 'phone', 'tz', 'mail', 'addr', 'last4', 'port'].concat(core.CPART_KEYS);

// 00:24: ports נכתב רק כשמתג cellular פעיל בעסק. כבוי – נתונים קיימים נשארים (רק מוסתרים באפליקציה)
function cellOn(w) { const b = w && w.biz; return !!(b && b.features && b.features.cellular === true); }
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
// סניפי העסק (01:00: סניף בניוד הקודם / בייבוא). עסק בלי מסמך (legacy) – אין סניפים
async function brIds(w) {
  if (!w || !w.biz || !w.biz.exists) return [];
  const s = await getFirestore().doc('b/' + w.bizId).get();
  const org = s.exists && s.get('org') && typeof s.get('org') === 'object' ? s.get('org') : {};
  return (Array.isArray(org.branches) ? org.branches : []).map((b) => b && b.id).filter((x) => typeof x === 'string');
}
function clean(c, keys, brs) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw bad('bad-cust', 'פרטי לקוח חסרים');
  const o = core.custParts(c, {}); // 00:19: שם פרטי/משפחה, רחוב/עיר/קומה/דירה → גם name/addr כרשור
  if (!o.name && !empty(c.name)) o.name = txt(c.name, 60, 'bad-name', 'שם הלקוח');
  if (!empty(c.phone)) o.phone = phoneOf(c.phone);
  if (!empty(c.tz)) o.tz = tzOf(c.tz);
  if (!empty(c.mail)) o.mail = mailOf(c.mail);
  if (!o.addr && !empty(c.addr)) o.addr = txt(c.addr, 150, 'bad-addr', 'כתובת');
  if (!empty(c.last4)) o.last4 = last4Of(c.last4);
  if (!empty(c.port)) o.port = portOf(c.port);
  if (c.ports != null) { // 00:21: ניודים קודמים [{d?,phone?,tz?}] – כל שדה רשות, רשומה ריקה נזרקת. סבב הניוד (fb/ord-lines) בודק לפיו
    if (!Array.isArray(c.ports) || c.ports.length > MAX_PORTS) throw bad('bad-ports', `ניודים: עד ${MAX_PORTS} רשומות`);
    const seen = new Set();
    o.ports = [];
    for (const p of c.ports) {
      if (!p || typeof p !== 'object' || Array.isArray(p)) throw bad('bad-ports', 'רשומת ניוד לא תקינה');
      onlyKeys(p, ['d', 'phone', 'tz', 'br'], 'רשומת ניוד');
      const r = {};
      if (!empty(p.br)) { if (typeof p.br !== 'string' || !(brs || []).includes(p.br)) throw bad('bad-br', 'סניף הניוד לא קיים בעסק'); r.br = p.br; }
      if (!empty(p.d)) r.d = portOf(p.d);
      if (!empty(p.phone)) r.phone = phoneOf(p.phone);
      if (!empty(p.tz)) r.tz = tzOf(p.tz);
      const k = portKey(r);
      if (k !== '||' && !seen.has(k)) { seen.add(k); o.ports.push(r); }
    }
  }
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
  if (o.ports) { // fill (ייבוא/הזמנה) = מוסיפים רק רשומות שאין (בלי כפילות); עריכה = הרשימה שנשלחה מחליפה
    const op = Array.isArray(old.ports) ? old.ports : (old.port ? [{ d: old.port }] : []); // port ישן (תאריך בלבד) נכנס כרשומה ראשונה; port עצמו לא נמחק
    if (fill) { const ks = new Set(op.map(portKey)); const add = o.ports.filter((r) => !ks.has(portKey(r))); if (add.length) up.ports = op.concat(add).slice(0, MAX_PORTS); }
    else if (JSON.stringify(op) !== JSON.stringify(o.ports)) up.ports = o.ports;
  }
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
  onlyKeys(input.cust || {}, ['name', 'phone', 'tz', 'mail', 'addr', 'last4', 'port', 'x', 'ports'].concat(core.CPART_KEYS), 'פרטי לקוח');
  const db = T.tdb();
  if (input.cust && input.cust.ports !== undefined && !cellOn(w)) throw deny('feature-off', 'ניודים – התוספת "סלולר" כבויה בעסק הזה');
  const o = clean(input.cust, await xKeys(db), input.cust && input.cust.ports ? await brIds(w) : []);
  // עריכה (לא fill): חלק ששדה אחר מקבוצתו נשלח ריק – נמחק, כדי שהשדה הנפרד יתאים לרשור החדש
  if (input.fill !== true) for (const g of [['fn', 'ln'], ['st', 'city', 'fl', 'apt']]) if (g.some((k) => o[k] !== undefined)) for (const k of g) if (o[k] === undefined) o[k] = '';
  // עריכה: addr:'' בלי אף חלק כתובת = מחיקת הכתובת כולה (גם החלקים). ב-fill מתעלמים
  if (input.fill !== true && input.cust && input.cust.addr === '' && !['st', 'city', 'fl', 'apt'].some((k) => o[k])) for (const k of ['addr', 'st', 'city', 'fl', 'apt']) o[k] = '';
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
  const brs = await brIds(w);
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
      if (r0.ports !== undefined && !cellOn(w)) throw deny('feature-off', 'ניודים – התוספת "סלולר" כבויה');
      onlyKeys(r0, ['name', 'phone', 'tz', 'mail', 'addr', 'last4', 'port', 'x', 'ports'].concat(core.CPART_KEYS), 'שורה');
      const o = clean(r0, keys, brs);
      const id = idFor(o);
      if (seen.has(id)) { res.same++; continue; } // כפילות בתוך אותה מנה
      seen.add(id);
      let r;
      await db.runTransaction(async (tx) => { r = await upsert(tx, db, w, o, { fill: true, src: 'import' }); });
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

const wrap = (name, fn) => T.scoped(async (request) => {
  try { return await fn(request); } catch (e) {
    if (e instanceof HttpsError) throw e;
    // בלי קלט ובלי הודעת השגיאה המלאה – כדי שפרטים אישיים לא ייכנסו ליומן
    logger.error(`customers: ${name} failed`, { reason: 'internal', name: e && e.name, code: e && e.code });
    throw new HttpsError('internal', 'שגיאה בפעולה. נסו שוב.', { reason: 'internal' });
  }
});
const FNS = { saveCust, importCusts, setCustCfg };
for (const [k, f] of Object.entries(FNS)) exports[k] = onCall(wrap(k, f));
Object.defineProperty(exports, '_core', { enumerable: false, value: { tzOf, last4Of, phoneOf, clean, idFor } });
