'use strict';
// לקוחות להזמנות (משימה 2026-11-08_בוט-הזמנות, ענף fb/ord-cust). כל כתיבה רק כאן; מהאפליקציה – קריאה לפי החוקים (תוספת 'orders' + הרשאת ord).
//
//   cust/{id}     { name, phone, tz?, mail?, addr?, last4?, port?, x:{<k>:txt}, wholesale?, at, upd, by, src:'manual'|'import'|'order', mv? }
//                 מזהה = t{tz} אם יש ת"ז, אחרת p{phone}. זיהוי בלי שאילתה, ייחודי בתוך העסק.
//                 2026-11-09 (לקוח לפי טלפון): לקוח נוסף עם טלפון שכבר קיים (asNew) – c{מזהה אקראי של 20 תווים}, לא תלוי בת"ז ובטלפון.
//                 עדכון לקוח קיים לפי מזהה – id. רשומות t/p קיימות לא משתנות ולא עוברות מזהה.
//                 לקוח עסקי (= סיטונאי, wholesale:true): bn שם העסק, vat ע.מ (9 ספרות), ct איש קשר, pay תנאי תשלום (+payTxt כש-pay='other').
//                 mv = הלקוח הועבר למסמך t{tz} (נוספה לו ת"ז אחר כך). לא נמחק.
//   custcfg/main  { xKeys:[{k,label}], upd }  – שמות השדות החופשיים (מנהל)
//
// אשראי (החלטת המשתמש 22:04): נשמרות רק 4 ספרות אחרונות. אם מגיע מספר כרטיס מלא (13–19 ספרות) בשדה last4 – נחתך ל-4 האחרונות
// לפני כל שימוש, ולא נשמר ולא נרשם ביומן בשום צורה. בכל שדה טקסט אחר – 8+ ספרות ברצף נדחה (txt של orders.js).
// סיטונאי (22:10): ברירת מחדל = רגיל. הייבוא מתעלם ממנו.
// 2026-11-09 (החלטת המשתמש 2): עובד פעיל עם ord רשאי לפתוח לקוח עסקי (wholesale:true בלקוח שנוצר באותה קריאה).
// הפיכת לקוח קיים רגיל לעסקי, וביטול סימון – מנהל בלבד (נבדק כאן, בטרנזקציה).

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const T = require('./lib/tenant');
const { requireStaff, inputObject, hasPerm } = require('./lib/roles');
const core = require('./orders')._core;
const { defineSecret } = require('firebase-functions/params');
const CARD = require('./lib/card');
// fb/ord-card: מפתח הצפנה לפרטי כרטיס (Secret Manager). באמולטור – ערך דמה מ-functions/.secret.local
const CARD_ENC_KEY = defineSecret('CARD_ENC_KEY');
// סבב 2 (החלטה 1): עד 3 כרטיסים מוצפנים ללקוח. מקום 1 = cust/{id}/p/card (הכרטיס הקיים, AAD 'cust/{id}' – בלי שינוי, תאימות מלאה);
// מקום 2/3 = p/card2, p/card3 (AAD 'cust/{id}#2'). בלקוח: cards:[{s,last4}] + card:true/last4 של הכרטיס הראשון (כמו היום, לשאר הקוד).
// לקוח ישן בלי cards ועם card:true נקרא כרשימה של כרטיס אחד במקום 1.
const SLOTS = [1, 2, 3];
const cardPath = (id, n) => `cust/${id}/p/card${n > 1 ? n : ''}`;
const cardAad = (id, n) => 'cust/' + id + (n > 1 ? '#' + n : '');
function cardsOf(d) {
  if (!d) return [];
  if (Array.isArray(d.cards)) return d.cards.filter((x) => x && SLOTS.includes(x.s)).map((x) => ({ s: x.s, last4: String(x.last4 || '') }));
  return d.card === true ? [{ s: 1, last4: String(d.last4 || '') }] : [];
}
function cardsUp(list) {
  const l = list.slice().sort((a, b) => a.s - b.s);
  return l.length ? { cards: l, card: true, last4: l[0].last4 } : { cards: FieldValue.delete(), card: FieldValue.delete(), last4: FieldValue.delete() };
}
function slotOf(v) {
  if (v == null) return 1; // בלי מקום = הכרטיס הראשון (כמו לפני השינוי)
  if (!SLOTS.includes(v)) throw bad('bad-slot', 'מספר כרטיס ללקוח: 1 עד 3');
  return v;
}

const bad = (reason, message) => new HttpsError('invalid-argument', message, { reason });
const deny = (reason, message) => new HttpsError('permission-denied', message, { reason });
const pre = (reason, message) => new HttpsError('failed-precondition', message, { reason });
const txt = core.txt;
const REQ_RE = /^[A-Za-z0-9_-]{8,40}$/;
const XK_RE = /^x[0-9a-z_]{1,20}$/;
const MAX_X = 20;
const MAX_ROWS = 200;
const MAX_PORTS = 30;
// 2026-11-10: bph/btz (טלפון/ת"ז לא תקינים שנשמרו כמו שהם) חלק מהמפתח – קווים שונים עם ערך לא תקין לא מתאחדים
const portKey = (r) => [r.d || '', r.phone || '', r.tz || ''].concat(r.bph || r.btz ? [r.bph || '', r.btz || ''] : []).join('|'); // br (סניף, 01:00) לא חלק מהמפתח – אותו ניוד מסניף אחר אינו כפילות
// 2026-11-10 (ייבוא לקוחות מלא): שדות מידע בכרטיס הלקוח – רק בעסק עם מתג cellular; בלי השפעה על דוחות.
// bank = טקסט גלוי (החלטת המשתמש, בלי בדיקת ספרות). השאר – חסום רק מספר כרטיס (13–19 ספרות שעוברים ספרת ביקורת), כדי שטלפונים בהערות יישמרו.
const INFO = [['bank', 300, 'פרטי בנק'], ['prod', 300, 'מוצר'], ['due', 200, 'לתשלום'], ['orig', 100, 'מקור'], ['stat', 200, 'סטטוס'], ['note', 1000, 'הערות'], ['od', 100, 'תאריך הזמנה']];
const INFO_KEYS = INFO.map((x) => x[0]);
// סימון "לא תקין": הערך המקורי נשמר כמו שהוא (bph טלפון, btz ת"ז, bml מייל). לא משמש לזיהוי או לאיחוד לקוחות.
const FLAG = [['bph', 30, 'טלפון (לא תקין)'], ['btz', 20, 'ת.ז (לא תקינה)'], ['bml', 120, 'מייל (לא תקין)']];
const FLAG_KEYS = FLAG.map((x) => x[0]);
const PACT = ['y', 'n', 'u']; // נויד בפועל: כן / לא / לא ידוע
const BIZF = ['bn', 'vat', 'ct', 'pay', 'payTxt']; // לקוח עסקי
const PAYS = ['cash', 'n30', 'n60', 'n90', 'credit', 'transfer', 'other'];
const FIELDS = ['name', 'phone', 'tz', 'mail', 'addr', 'last4', 'port'].concat(core.CPART_KEYS, BIZF, INFO_KEYS, FLAG_KEYS);
const CKEYS = ['name', 'phone', 'tz', 'mail', 'addr', 'last4', 'port', 'x', 'ports', 'phs'].concat(core.CPART_KEYS, INFO_KEYS, FLAG_KEYS);
const NEWK = INFO_KEYS.concat(FLAG_KEYS);
const hasInfo = (c) => !!c && typeof c === 'object' && (INFO_KEYS.some((k) => c[k] !== undefined) || (Array.isArray(c.ports) && c.ports.some((p) => p && typeof p === 'object' && (p.co !== undefined || p.act !== undefined))));
// טקסט חופשי בלי בדיקת ספרות (פרטי בנק); plain + חסימת מספר כרטיס (שאר שדות המידע והערכים הלא תקינים)
function plain(v, max, reason, label) {
  if (typeof v !== 'string' && typeof v !== 'number') throw bad(reason, label + ' לא תקין');
  const s = String(v).replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').replace(/[ \t]+/g, ' ').trim();
  if (s.length > max) throw bad(reason, `${label} – עד ${max} תווים`);
  return s;
}
function info(v, max, reason, label, lu) {
  const s = plain(v, max, reason, label);
  if (core.cardLike(s, lu)) throw bad('card-like', `${label}: אסור להקליד מספר כרטיס אשראי.`);
  return s;
}

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
  if (core.cardLike(m)) throw bad('card-like', 'מייל: אסור מספר כרטיס (13–19 ספרות).'); // 2026-11-10: מייל עם מספר טלפון מותר
  return m;
}
function portOf(raw) {
  const s = String(raw).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(Date.parse(s + 'T00:00:00Z'))) throw bad('bad-port', 'תאריך ניוד: YYYY-MM-DD');
  return s;
}
const empty = (v) => v == null || v === '';
// סבב 2 (החלטה 4): ללקוח עם טלפון/ת"ז תקינים לא נשמר ערך לא תקין נוסף כסימון (bph/btz). אם הוא שונה – מצטרף להערות (רק כש-cellular פעיל; אחרת לא נשמר).
// chk = הרשומה אחרי המיזוג (old + o). חל על לקוח חדש, על מילוי (fill) ועל עריכה. o משתנה במקום.
function flagFix(old, o, cell, fill) {
  old = old || {};
  const add = [];
  for (const [b, v, l] of [['bph', 'phone', 'טלפון נוסף (לא תקין)'], ['btz', 'tz', 'ת.ז נוספת (לא תקינה)']]) {
    if (empty(o[b])) continue;
    const has = !empty(o[v]) || !empty(old[v]);
    if (!has) continue;
    if (o[b] !== o[v] && o[b] !== old[v]) add.push(l + ': ' + o[b]);
    delete o[b];
  }
  if (!add.length || !cell) return;
  // הבסיס: עריכה – ההערה שנשלחה (או הקיימת); fill/חדש – הקיימת, ואם אין – זו שנשלחה
  const base = String((fill ? (empty(old.note) ? o.note : old.note) : (o.note !== undefined ? o.note : old.note)) || '');
  let n = base;
  for (const a of add) if (!n.split(' | ').includes(a)) { const j = n ? n + ' | ' + a : a; if (j.length <= 1000) n = j; }
  if (n === base) return;
  if (fill && !empty(old.note)) { if (n !== old.note) o.__note = n; } else o.note = n; // fill לא דורס הערה קיימת – לכן מעדכנים במפורש (__note)
}
// סבב 1 (ליקוי 2): פתיחת לקוח עסקי, או סימון לקוח קיים כעסקי – כל השדות חובה (על הרשומה אחרי המיזוג).
// לקוח שכבר מסומן סיטונאי (גם ישן בלי השדות) – שמירות רגילות לא נחסמות.
const BIZ_REQ = [['bn', 'bad-bn', 'שם העסק'], ['vat', 'bad-vat', 'ע.מ'], ['ct', 'bad-ct', 'איש קשר'], ['phone', 'bad-phone', 'טלפון'], ['st', 'bad-addr', 'כתובת'], ['city', 'bad-city', 'עיר'], ['pay', 'bad-pay', 'תנאי תשלום']];
function needBiz(base, o, fill) {
  const f = Object.assign({}, base || {});
  for (const [k, v] of Object.entries(o)) {
    if (k === 'x' || v === undefined) continue;
    if (fill) { if (empty(f[k]) && !empty(v)) f[k] = v; } else if (v === '') delete f[k]; else f[k] = v;
  }
  for (const [k, r, l] of BIZ_REQ) if (empty(f[k])) throw bad(r, 'לקוח עסקי: ' + l + ' – חובה');
  if (f.pay === 'other' && empty(f.payTxt)) throw bad('bad-pay', 'לקוח עסקי: פירוט תנאי התשלום – חובה');
}
// מנקה פרטי לקוח. keys = מפתחות השדות החופשיים המותרים (custcfg). name/phone חובה רק כשיוצרים לקוח בלי ת"ז.
// סניפי העסק (01:00: סניף בניוד הקודם / בייבוא). עסק בלי מסמך (legacy) – אין סניפים
async function brIds(w) {
  if (!w || !w.biz || !w.biz.exists) return [];
  const s = await getFirestore().doc('b/' + w.bizId).get();
  const org = s.exists && s.get('org') && typeof s.get('org') === 'object' ? s.get('org') : {};
  return (Array.isArray(org.branches) ? org.branches : []).map((b) => b && b.id).filter((x) => typeof x === 'string');
}
function clean(c, keys, brs, byId, imp) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw bad('bad-cust', 'פרטי לקוח חסרים');
  const o = core.custParts(c, {}); // 00:19: שם פרטי/משפחה, רחוב/עיר/קומה/דירה → גם name/addr כרשור
  if (!o.name && !empty(c.name)) o.name = txt(c.name, 60, 'bad-name', 'שם הלקוח');
  if (!empty(c.bn)) o.bn = txt(c.bn, 60, 'bad-bn', 'שם העסק');
  if (!empty(c.vat)) { const v = String(c.vat).replace(/[\s-]/g, ''); if (!/^\d{9}$/.test(v)) throw bad('bad-vat', 'ע.מ: 9 ספרות'); o.vat = v; }
  if (!empty(c.ct)) o.ct = txt(c.ct, 60, 'bad-ct', 'איש קשר');
  if (!empty(c.pay)) { if (!PAYS.includes(c.pay)) throw bad('bad-pay', 'תנאי תשלום לא תקינים'); o.pay = c.pay; }
  if (o.pay === 'other') o.payTxt = txt(c.payTxt, 60, 'bad-pay', 'תנאי תשלום', true);
  else if (!empty(c.payTxt)) throw bad('bad-pay', 'פירוט תנאי תשלום – רק כשנבחר "אחר"');
  if (!empty(c.phone)) o.phone = phoneOf(c.phone);
  if (!empty(c.tz)) o.tz = tzOf(c.tz);
  if (c.phs != null) o.phs = core.phsOf(Array.isArray(c.phs) ? c.phs.map(phoneOf) : c.phs, o.phone); // 2026-11-10: עד 3 טלפונים נוספים; [] בעריכה = מחיקה
  if (!empty(c.mail)) o.mail = mailOf(c.mail);
  if (!o.addr && !empty(c.addr)) o.addr = txt(c.addr, 150, 'bad-addr', 'כתובת');
  if (!empty(c.last4)) o.last4 = last4Of(c.last4);
  if (!empty(c.port)) o.port = portOf(c.port);
  for (const [k, max, label] of INFO.concat(FLAG)) { // '' = מחיקה בעריכה
    if (c[k] === '') o[k] = '';
    else if (!empty(c[k])) o[k] = (k === 'bank' ? plain : info)(c[k], max, 'bad-' + k, label, true);
  }
  if (c.ports != null) { // 00:21: ניודים קודמים [{d?,phone?,tz?}] – כל שדה רשות, רשומה ריקה נזרקת. סבב הניוד (fb/ord-lines) בודק לפיו
    if (!Array.isArray(c.ports) || c.ports.length > MAX_PORTS) throw bad('bad-ports', `ניודים: עד ${MAX_PORTS} רשומות`);
    const seen = new Set();
    o.ports = [];
    for (const p of c.ports) {
      if (!p || typeof p !== 'object' || Array.isArray(p)) throw bad('bad-ports', 'רשומת ניוד לא תקינה');
      onlyKeys(p, ['d', 'phone', 'tz', 'br', 'co', 'act', 'bph', 'btz'], 'רשומת ניוד');
      const r = {};
      if (!empty(p.br)) { if (typeof p.br !== 'string' || !(brs || []).includes(p.br)) throw bad('bad-br', 'סניף הניוד לא קיים בעסק'); r.br = p.br; }
      if (!empty(p.d)) r.d = portOf(p.d);
      if (!empty(p.phone)) r.phone = phoneOf(p.phone);
      if (!empty(p.tz)) r.tz = tzOf(p.tz);
      if (!empty(p.bph)) r.bph = info(p.bph, 30, 'bad-ports', 'טלפון ניוד (לא תקין)', true);
      if (!empty(p.btz)) r.btz = info(p.btz, 20, 'bad-ports', 'ת.ז ניוד (לא תקינה)', true);
      if (!empty(p.co)) r.co = txt(String(p.co), 40, 'bad-ports', 'חברת ניוד'); // סבב 2: txt חוסם 8+ ספרות (card-like) – זהה לממשק (CARD8)
      if (!empty(p.act)) { if (!PACT.includes(p.act)) throw bad('bad-ports', 'נויד בפועל: כן/לא/לא ידוע'); r.act = p.act; }
      const k = portKey(r);
      if (Object.keys(r).some((x) => x !== 'br') && !seen.has(k)) { seen.add(k); o.ports.push(r); }
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
  // ייבוא (2026-11-10): שורה בלי טלפון/ת"ז תקינים נכנסת לפי שם, כלקוח נפרד (לא מתאחדת)
  if (!o.tz && !o.phone && !byId && !(imp && o.name)) throw bad('bad-cust', 'צריך ת.ז או טלפון');
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
  if (o.__note !== undefined) up.note = o.__note;
  for (const k of FIELDS) if (o[k] !== undefined && !(o[k] === '' && empty(old[k]) && NEWK.includes(k)) && (fill ? empty(old[k]) : old[k] !== o[k])) up[k] = o[k];
  if (o.ports) { // fill (ייבוא/הזמנה) = מוסיפים רק רשומות שאין (בלי כפילות); עריכה = הרשימה שנשלחה מחליפה
    const op = Array.isArray(old.ports) ? old.ports : (old.port ? [{ d: old.port }] : []); // port ישן (תאריך בלבד) נכנס כרשומה ראשונה; port עצמו לא נמחק
    if (fill) { const ks = new Set(op.map(portKey)); const add = o.ports.filter((r) => !ks.has(portKey(r))); if (add.length) up.ports = op.concat(add).slice(0, MAX_PORTS); }
    else if (JSON.stringify(op) !== JSON.stringify(o.ports)) up.ports = o.ports;
  }
  if (o.phs) { // fill = מצרפים טלפונים שאין (עד 3, בלי הראשי); עריכה = הרשימה שנשלחה מחליפה
    const main = up.phone || old.phone, op = Array.isArray(old.phs) ? old.phs : [];
    const nx = (fill ? op.concat(o.phs) : o.phs).filter((p, i, A) => p !== main && A.indexOf(p) === i).slice(0, core.MAX_PHS);
    if (JSON.stringify(nx) !== JSON.stringify(op)) up.phs = nx.length ? nx : FieldValue.delete();
  }
  if (o.x) {
    const ox = old.x && typeof old.x === 'object' ? old.x : {};
    for (const [k, v] of Object.entries(o.x)) if (fill ? empty(ox[k]) : ox[k] !== v) up['x.' + k] = v;
  }
  return Object.keys(up).length ? up : null;
}
// כתיבה בטרנזקציה: לקוח שקיים רק לפי טלפון ועכשיו יש לו ת"ז – מועתק ל-t{tz}, והישן מסומן mv (לא נמחק).
// fb/ord-card (ליקוי 2): כרטיס מוצפן של הישן מפוענח ומוצפן מחדש לנתיב החדש (ה-AAD הוא הנתיב), הישן נמחק באותה טרנזקציה, ונרשם ביומן act:'move'.
async function upsert(tx, db, w, o, opts) {
  const id = idFor(o);
  const ref = db.doc('cust/' + id);
  const pref = o.tz && o.phone ? db.doc('cust/p' + o.phone) : null;
  const pcref = pref ? SLOTS.map((n) => db.doc(cardPath('p' + o.phone, n))) : null;
  const [s, ps, ...pcs] = pref ? await tx.getAll(ref, pref, ...pcref) : [await tx.get(ref), null];
  const now = Date.now();
  let base = s.exists ? s.data() : null;
  let moved = false;
  if (!base && ps && ps.exists && !ps.get('mv') && empty(ps.get('tz'))) { base = Object.assign({}, ps.data()); moved = true; }
  const ws = opts.wholesale;
  if (base && ws === true && base.wholesale !== true && !opts.mgr) throw deny('manager-only', 'הפיכת לקוח קיים ללקוח עסקי – מנהל בלבד');
  if (ws === true && !(base && base.wholesale === true)) needBiz(base, o, opts.fill);
  flagFix(base, o, opts.cell, opts.fill);
  if (!base) {
    if (!o.name && o.bn) o.name = o.bn; // לקוח עסקי חדש: השם המוצג = שם העסק (בלקוח קיים השם לא נדרס)
    if (!o.name) throw bad('bad-name', 'שם הלקוח – חובה');
    if (!o.phone && opts.src !== 'import') throw bad('bad-phone', 'טלפון – חובה'); // ייבוא: טלפון לא תקין נשמר ב-bph
    const d = newDoc(o, w, opts, now);
    if (ws === true) d.wholesale = true;
    tx.set(ref, d);
    return { id, created: true };
  }
  return update(tx, db, w, o, opts, { id, ref, base, moved, pref, pcs, pcref, now });
}
async function update(tx, db, w, o, opts, st) {
  const { id, ref, base, moved, pref, pcs, pcref, now } = st;
  const ws = opts.wholesale;
  if (moved) {
    const d = Object.assign({}, base, { tz: o.tz, upd: now, by: w.uid });
    delete d.mv;
    const up = merge(base, o, opts.fill) || {};
    for (const [k, v] of Object.entries(up)) { if (k.startsWith('x.')) { d.x = Object.assign({}, d.x || {}); d.x[k.slice(2)] = v; } else d[k] = v; }
    if (up.phs instanceof FieldValue) delete d.phs;
    if (typeof ws === 'boolean') d.wholesale = ws;
    const cards = [], nums = []; // כל הכרטיסים (עד 3) מפוענחים ומוצפנים מחדש לנתיב החדש, באותו מקום
    (pcs || []).forEach((cs, i) => {
      if (!cs || !cs.exists) return;
      const n = SLOTS[i], key = CARD_ENC_KEY.value();
      const c = CARD.open(key, w.bizId, cardAad('p' + o.phone, n), cs.get('box'));
      tx.set(db.doc(cardPath(id, n)), Object.assign({}, cs.data(), { box: CARD.seal(key, w.bizId, cardAad(id, n), c), last4: c.num.slice(-4) }));
      tx.delete(pcref[i]);
      cards.push({ s: n, last4: c.num.slice(-4) }); nums.push(c.num); // nums – רק בזיכרון (זיהוי כפילות בייבוא), לא נשמר
      tx.set(db.collection('cardLog').doc(), Object.assign({ t: now, by: w.uid, cust: id, act: 'move', from: 'p' + o.phone }, n > 1 ? { s: n } : {}));
    });
    delete d.card; delete d.cards; // סימון בלי מוצפן – לא מועבר
    if (cards.length) { const u = cardsUp(cards); d.cards = u.cards; d.card = true; d.last4 = u.last4; }
    const cardMoved = cards.length > 0;
    tx.set(ref, d);
    tx.update(pref, Object.assign({ mv: id, upd: now }, cardMoved ? { card: FieldValue.delete(), cards: FieldValue.delete() } : {}));
    return { id, created: false, moved: true, cardMoved, cards, nums };
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
function newDoc(o, w, opts, now) {
  const d = Object.assign({ x: {} }, o, { at: now, upd: now, by: w.uid, src: opts.src });
  for (const k of NEWK) if (d[k] === '') delete d[k];
  if (Array.isArray(d.phs)) { d.phs = d.phs.filter((p) => p !== d.phone); if (!d.phs.length) delete d.phs; }
  delete d.__note;
  return d;
}
// לקוח נוסף עם אותו טלפון (asNew, בלי ת"ז): מזהה אקראי c{20}, לא תלוי בת"ז/טלפון. גם שורת ייבוא בלי טלפון/ת"ז תקינים
async function createNew(tx, db, w, o, opts) {
  if (opts.wholesale === true) needBiz(null, o, false);
  flagFix(null, o, opts.cell, false);
  if (!o.name && o.bn) o.name = o.bn;
  if (!o.name) throw bad('bad-name', 'שם הלקוח – חובה');
  if (!o.phone && opts.src !== 'import') throw bad('bad-phone', 'טלפון – חובה');
  const ref = db.collection('cust').doc('c' + db.collection('cust').doc().id);
  const now = Date.now();
  const d = newDoc(o, w, opts, now);
  if (opts.wholesale === true) d.wholesale = true;
  tx.set(ref, d);
  return { id: ref.id, created: true };
}
// עדכון לקוח קיים לפי מזהה (id). t – הת"ז לא משתנה; p – הטלפון לא משתנה (המזהה נגזר ממנו), ת"ז חדשה → המעבר הרגיל ל-t{tz};
// c – טלפון ניתן לשינוי; ת"ז חדשה נרשמת במסמך עצמו רק אם אין לקוח אחר עם הת"ז הזו.
async function upsertId(tx, db, w, id, o, opts) {
  const ref = db.doc('cust/' + id);
  if (id[0] === 'p') {
    if (o.phone && o.phone !== id.slice(1)) throw bad('phone-fixed', 'אי אפשר לשנות את הטלפון של הלקוח הזה. פתחו לקוח חדש.');
    o.phone = id.slice(1);
  }
  if (id[0] === 't' && o.tz && o.tz !== id.slice(1)) throw bad('tz-fixed', 'אי אפשר לשנות ת.ז של לקוח');
  if (id[0] === 'p' && o.tz) {
    const [s, ts] = await tx.getAll(ref, db.doc('cust/t' + o.tz));
    if (!s.exists || s.get('mv')) throw new HttpsError('not-found', 'הלקוח לא נמצא', { reason: 'no-cust' });
    if (ts.exists) throw bad('tz-taken', 'כבר יש לקוח עם הת.ז הזו. בחרו אותו.');
    return upsert(tx, db, w, o, opts); // המעבר הקיים p→t (הישן מסומן mv, לא נמחק)
  }
  const tref = id[0] === 'c' && o.tz ? db.doc('cust/t' + o.tz) : null;
  const [s, ts] = tref ? await tx.getAll(ref, tref) : [await tx.get(ref), null];
  if (!s.exists || s.get('mv')) throw new HttpsError('not-found', 'הלקוח לא נמצא', { reason: 'no-cust' });
  const base = s.data();
  if (o.tz && !empty(base.tz) && base.tz !== o.tz) throw bad('tz-fixed', 'אי אפשר לשנות ת.ז של לקוח');
  if (ts && ts.exists && base.tz !== o.tz) throw bad('tz-taken', 'כבר יש לקוח עם הת.ז הזו. בחרו אותו.');
  if (opts.wholesale === true && base.wholesale !== true && !opts.mgr) throw deny('manager-only', 'הפיכת לקוח קיים ללקוח עסקי – מנהל בלבד');
  if (opts.wholesale === true && base.wholesale !== true) needBiz(base, o, opts.fill);
  flagFix(base, o, opts.cell, opts.fill);
  return update(tx, db, w, o, opts, { id, ref, base, moved: false, now: Date.now() });
}

// saveCust({ cust:{name,phone,tz,mail,addr,last4,port,x,bn,vat,ct,pay,payTxt}, id?, asNew?, fill?, wholesale? }) – עובד עם ord או מנהל.
// fill:true (שמירה מתוך הזמנה) = ממלא רק שדות ריקים. id = עדכון לקוח קיים (גם צירוף פרטים מהזמנה). asNew = לקוח נוסף עם טלפון קיים.
// wholesale:true – עובד: רק בלקוח שנוצר עכשיו (פתיחת לקוח עסקי); מנהל: תמיד. wholesale:false – מנהל בלבד.
async function saveCust(request) {
  const w = await who(request);
  const input = inputObject(request);
  onlyKeys(input, ['cust', 'fill', 'wholesale', 'id', 'asNew']);
  const mgr = w.role === 'manager';
  if (input.wholesale !== undefined) {
    if (typeof input.wholesale !== 'boolean') throw bad('bad-field', 'סיטונאי: כן/לא');
    if (input.wholesale === false && !mgr) throw deny('manager-only', 'ביטול סימון לקוח עסקי – מנהל בלבד');
  }
  if (input.asNew !== undefined && input.asNew !== true) throw bad('bad-field', 'asNew: true בלבד');
  const id = input.id == null || input.id === '' ? null : custIdOf(input.id);
  if (id && input.asNew) throw bad('bad-field', 'לקוח קיים או חדש – לא שניהם');
  onlyKeys(input.cust || {}, CKEYS.concat(BIZF), 'פרטי לקוח');
  const db = T.tdb();
  if (input.cust && input.cust.ports !== undefined && !cellOn(w)) throw deny('feature-off', 'ניודים – התוספת "סלולר" כבויה בעסק הזה');
  if (hasInfo(input.cust) && !cellOn(w)) throw deny('feature-off', 'שדות המידע (בנק, מוצר, סטטוס…) – רק כשהתוספת "סלולר" פעילה');
  const o = clean(input.cust, await xKeys(db), input.cust && input.cust.ports ? await brIds(w) : [], !!id);
  // עריכה (לא fill): חלק ששדה אחר מקבוצתו נשלח ריק – נמחק, כדי שהשדה הנפרד יתאים לרשור החדש
  if (input.fill !== true) for (const g of [['fn', 'ln'], ['st', 'city', 'fl', 'apt']]) if (g.some((k) => o[k] !== undefined)) for (const k of g) if (o[k] === undefined) o[k] = '';
  // עריכה: addr:'' בלי אף חלק כתובת = מחיקת הכתובת כולה (גם החלקים). ב-fill מתעלמים
  if (input.fill !== true && input.cust && input.cust.addr === '' && !['st', 'city', 'fl', 'apt'].some((k) => o[k])) for (const k of ['addr', 'st', 'city', 'fl', 'apt']) o[k] = '';
  let r;
  // עריכה של שדות עסקיים: pay שאינו 'other' מוחק את הפירוט הישן
  if (input.fill !== true && o.pay && o.pay !== 'other') o.payTxt = '';
  const opts = { fill: input.fill === true, wholesale: input.wholesale, src: input.fill === true ? 'order' : 'manual', mgr, cell: cellOn(w) };
  await db.runTransaction(async (tx) => {
    r = id ? await upsertId(tx, db, w, id, o, opts) : (input.asNew && !o.tz) ? await createNew(tx, db, w, o, opts) : await upsert(tx, db, w, o, opts);
  });
  if (r) delete r.nums; // מספרי כרטיס מלאים – לעולם לא חוזרים לאפליקציה
  return Object.assign({ ok: true }, r);
}

// mergeCust({ a, b, keep }) – 2026-11-10 (שינוי 13:16; תיקון 17:23): איחוד שני לקוחות לאחד. מותר למי שמורשה לערוך לקוחות (ord, כמו saveCust).
// keep = הלקוח שנשאר, לפי בחירת העובד (חייב להיות a או b). הערכים שלו גוברים; שדות ריקים מתמלאים מהשני; טלפונים (ראשי+נוספים) מצטרפים ל-phs;
// ניודים מתאחדים; כרטיסים עוברים (מפוענחים ומוצפנים מחדש) למקומות פנויים; ההזמנות של השני עוברות. השני מסומן mv:<יעד> (לא נמחק – אפשר לשחזר).
// מסמך היעד: של keep. חריג: אם רק לשני יש ת"ז – הנתונים של keep נכתבים למסמך t{tz} של השני (החיפוש לפי ת"ז נשען על המזהה הזה), ו-keep מסומן mv.
// הכול בטרנזקציה אחת, ונרשם ביומן (cardLog act:'merge', keep).
// התנגשות – לא מאחדים: ת"ז שונות, יותר מ-3 כרטיסים, יותר מ-3 טלפונים נוספים, הערות ארוכות מדי, יותר מ-400 הזמנות, סימון עסקי שונה (עובד).
const MAX_MERGE_ORD = 400;
const CARDF = ['cards', 'card', 'last4'];
async function mergeCust(request) {
  const w = await who(request);
  const input = inputObject(request);
  onlyKeys(input, ['a', 'b', 'keep']);
  const a = custIdOf(input.a), b = custIdOf(input.b);
  if (a === b) throw bad('same-cust', 'זה אותו לקוח');
  if (typeof input.keep !== 'string' || ![a, b].includes(input.keep)) throw bad('bad-keep', 'בחרו איזה משני הלקוחות נשאר');
  const k = input.keep, o = k === a ? b : a; // k = נשאר (ערכיו גוברים), o = השני
  const db = T.tdb();
  let out = null;
  await db.runTransaction(async (tx) => {
    const [sk, so] = await tx.getAll(db.doc('cust/' + k), db.doc('cust/' + o));
    if (!sk.exists || sk.get('mv') || !so.exists || so.get('mv')) throw new HttpsError('not-found', 'אחד הלקוחות לא נמצא (אולי כבר אוחד)', { reason: 'no-cust' });
    const A = sk.data(), B = so.data();
    if (!empty(A.tz) && !empty(B.tz) && A.tz !== B.tz) throw pre('merge-tz', 'אי אפשר לאחד: לשני הלקוחות ת.ז שונות. בחרו לאיזה לקוח לשייך את ההזמנה.');
    if ((A.wholesale === true) !== (B.wholesale === true) && w.role !== 'manager') throw deny('manager-only', 'אחד הלקוחות עסקי והשני לא – איחוד כזה רק למנהל');
    const flip = empty(A.tz) && !empty(B.tz); // היעד = מסמך הת"ז של השני
    const d = flip ? o : k, s = flip ? k : o, sd = flip ? sk : so, dd = flip ? so : sk; // d = מסמך היעד, s = המסמך שמסומן mv
    const cd = cardsOf(dd.data()), cs = cardsOf(sd.data());
    if (cd.length + cs.length > SLOTS.length) throw pre('merge-cards', `אי אפשר לאחד: יחד יש ${cd.length + cs.length} כרטיסי אשראי, והמקסימום 3. מחקו כרטיס בכרטיס הלקוח, או בחרו לאיזה לקוח לשייך את ההזמנה.`);
    const main = A.phone || B.phone;
    const phs = [[B.phone], B.phs].flat().filter((p) => p && typeof p === 'string');
    const allPh = (Array.isArray(A.phs) ? A.phs : []).concat(phs).filter((p, i, L) => p !== main && L.indexOf(p) === i);
    if (allPh.length > core.MAX_PHS) throw pre('merge-phs', `אי אפשר לאחד: יחד יש ${allPh.length} טלפונים נוספים, והמקסימום ${core.MAX_PHS}.`);
    const scs = cs.length ? await tx.getAll(...cs.map((x) => db.doc(cardPath(s, x.s)))) : [];
    const os = await tx.get(db.collection('ord').where('custId', '==', s).limit(MAX_MERGE_ORD + 1));
    if (os.size > MAX_MERGE_ORD) throw pre('merge-ords', 'אי אפשר לאחד: ללקוח יותר מ-400 הזמנות.');
    const up = {};
    const SKIP = ['x', 'ports', 'phs', 'cards', 'card', 'last4', 'at', 'upd', 'by', 'src', 'mv', 'phone', 'tz', 'wholesale'];
    for (const [kk, v] of Object.entries(B)) if (!SKIP.includes(kk) && empty(A[kk]) && !empty(v)) up[kk] = v;
    if (!empty(A.note) && !empty(B.note) && A.note !== B.note) {
      const n = A.note + ' | ' + B.note;
      if (n.length > 1000) throw pre('merge-note', 'אי אפשר לאחד: ההערות של שני הלקוחות יחד ארוכות מ-1000 תווים. קצרו הערה בכרטיס הלקוח.');
      up.note = n;
    }
    if (empty(A.phone) && !empty(B.phone)) up.phone = B.phone;
    if (flip) up.tz = B.tz;
    if (B.wholesale === true && A.wholesale !== true) up.wholesale = true;
    const ox = A.x && typeof A.x === 'object' ? A.x : {}, bx = B.x && typeof B.x === 'object' ? B.x : {};
    const x = Object.assign({}, bx, ox);
    if (JSON.stringify(x) !== JSON.stringify(ox)) up.x = x;
    const pa = Array.isArray(A.ports) ? A.ports : (A.port ? [{ d: A.port }] : []), pb = Array.isArray(B.ports) ? B.ports : (B.port ? [{ d: B.port }] : []);
    if (pb.length) { const ks = new Set(pa.map(portKey)), add = pb.filter((r) => !ks.has(portKey(r))); if (add.length) { if (pa.length + add.length > MAX_PORTS) throw pre('merge-ports', `אי אפשר לאחד: יחד יותר מ-${MAX_PORTS} ניודים.`); up.ports = pa.concat(add); } }
    if (JSON.stringify(allPh) !== JSON.stringify(Array.isArray(A.phs) ? A.phs : [])) up.phs = allPh;
    const now = Date.now();
    const list = cd.slice();
    scs.forEach((q, j) => {
      if (!q.exists) return;
      const key = CARD_ENC_KEY.value(), c = CARD.open(key, w.bizId, cardAad(s, cs[j].s), q.get('box'));
      const n = SLOTS.find((y) => !list.some((z) => z.s === y));
      tx.set(db.doc(cardPath(d, n)), Object.assign({}, q.data(), { box: CARD.seal(key, w.bizId, cardAad(d, n), c), last4: c.num.slice(-4) }));
      tx.delete(q.ref);
      list.push({ s: n, last4: c.num.slice(-4) });
      tx.set(db.collection('cardLog').doc(), Object.assign({ t: now, by: w.uid, cust: d, act: 'move', from: s }, n > 1 ? { s: n } : {}));
    });
    if (!flip) {
      if (list.length !== cd.length) Object.assign(up, cardsUp(list));
      tx.update(dd.ref, Object.assign(up, { upd: now, by: w.uid }));
    } else { // הנתונים של keep (עם ההשלמות) נכתבים במלואם למסמך הת"ז; הכרטיסים – אלה שבמסמך היעד בפועל
      const full = Object.assign({}, A, up, { upd: now, by: w.uid });
      delete full.mv; CARDF.forEach((f) => delete full[f]);
      const l = list.slice().sort((p, q) => p.s - q.s);
      if (l.length) Object.assign(full, { cards: l, card: true, last4: l[0].last4 });
      tx.set(dd.ref, full);
    }
    tx.update(sd.ref, Object.assign({ mv: d, upd: now, by: w.uid }, cs.length ? { card: FieldValue.delete(), cards: FieldValue.delete(), last4: FieldValue.delete() } : {}));
    os.docs.forEach((q) => tx.update(q.ref, { custId: d, upd: now }));
    tx.set(db.collection('cardLog').doc(), { t: now, by: w.uid, cust: d, act: 'merge', from: s, keep: k, ords: os.size, cards: list.length - cd.length });
    out = { ok: true, id: d, from: s, keep: k, ords: os.size, cards: list.length };
  });
  return out;
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
      if (hasInfo(r0) && !cellOn(w)) throw deny('feature-off', 'שדות המידע – רק כשהתוספת "סלולר" פעילה');
      // fb/ord-card: מוצפן בשרת (00:50 – כולל CVV). סבב 2: cards = עד 3 כרטיסים; card (כרטיס יחיד) – נתמך כמו קודם
      if (r0.cards != null && (!Array.isArray(r0.cards) || r0.cards.length > SLOTS.length)) throw bad('bad-card-num', 'עד 3 כרטיסים ללקוח');
      const cl = (r0.cards || []).concat(r0.card == null ? [] : [r0.card]).map((c) => CARD.cleanCard(c)).filter((c, j, A) => A.findIndex((q) => q.num === c.num) === j);
      delete r0.card; delete r0.cards;
      if (cl.length) r0.last4 = cl[0].num.slice(-4);
      onlyKeys(r0, CKEYS, 'שורה');
      const o = clean(r0, keys, brs, false, true);
      const keyed = !!(o.tz || o.phone); // בלי טלפון/ת"ז תקינים – לקוח חדש נפרד (c{20}), בלי איחוד
      const id = keyed ? idFor(o) : null;
      if (keyed && seen.has(id)) { res.same++; continue; } // כפילות בתוך אותה מנה
      if (keyed) seen.add(id);
      const opts = { fill: true, src: 'import', cell: cellOn(w) };
      // כרטיסים חדשים נכנסים למקומות הפנויים בלבד (קיים לא נדרס). 2026-11-10 (סעיף 1): כפילות = אותו מספר מלא בלבד.
      // כרטיס שמור עם אותן 4 ספרות מפוענח בזיכרון להשוואה (לא נרשם ולא מוחזר) – כך ייבוא חוזר לא מכפיל, ושני כרטיסים שונים עם אותן 4 ספרות נשמרים שניהם
      let skip = 0, added = 0;
      const putCards = (tx, cid, have, nums) => {
        const list = have.slice(); skip = 0; added = 0;
        for (const c of cl) {
          const l4 = c.num.slice(-4);
          if (nums.includes(c.num)) continue;
          const n = SLOTS.find((q) => !list.some((x) => x.s === q));
          if (!n) { skip++; continue; }
          tx.set(db.doc(cardPath(cid, n)), { box: CARD.seal(CARD_ENC_KEY.value(), w.bizId, cardAad(cid, n), c), last4: l4, at: Date.now(), by: w.uid, src: 'import' });
          tx.set(db.collection('cardLog').doc(), Object.assign({ t: Date.now(), by: w.uid, cust: cid, act: 'import' }, n > 1 ? { s: n } : {}));
          list.push({ s: n, last4: l4 }); nums.push(c.num);
        }
        added = list.length - have.length;
        if (added) tx.update(db.doc('cust/' + cid), cardsUp(list));
      };
      let r;
      if (!keyed) {
        await db.runTransaction(async (tx) => {
          r = await createNew(tx, db, w, o, opts);
          putCards(tx, r.id, [], []);
        });
        res.created++; res.cardSkip = (res.cardSkip || 0) + skip;
        continue;
      }
      await db.runTransaction(async (tx) => {
        // קריאות לפני כתיבות (חובה בטרנזקציה): קודם הכרטיסים השמורים של הלקוח
        const cs = cl.length ? await tx.get(db.doc('cust/' + id)) : null;
        const have = cardsOf(cs && cs.exists && !cs.get('mv') ? cs.data() : null), nums = [];
        const same = have.filter((x) => cl.some((c) => c.num.slice(-4) === x.last4));
        if (same.length) {
          const ss = await tx.getAll(...same.map((x) => db.doc(cardPath(id, x.s))));
          ss.forEach((q, j) => { if (q.exists) nums.push(CARD.open(CARD_ENC_KEY.value(), w.bizId, cardAad(id, same[j].s), q.get('box')).num); });
        }
        r = await upsert(tx, db, w, o, opts);
        if (cl.length) putCards(tx, r.id, r.moved ? (r.cards || []) : have, r.moved ? (r.nums || []) : nums);
      });
      res.cardSkip = (res.cardSkip || 0) + skip;
      if (r.created) res.created++; else if (r.same && !added) res.same++; else res.updated++;
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
const CID_RE = /^(?:[tp][0-9]{8,10}|c[A-Za-z0-9]{20})$/; // c = לקוח נוסף עם טלפון קיים (2026-11-09)
const OPEN_ST = ['new', 'work', 'wait_pay'];
function custIdOf(v) { if (typeof v !== 'string' || !CID_RE.test(v)) throw bad('bad-id', 'לקוח לא תקין'); return v; }
const mgrOnly = (w) => { if (w.role !== 'manager') throw deny('manager-only', 'הפעולה מותרת למנהל בלבד'); };

// setCard({ custId, card:{num,exp?,name?,cvv?}, ordId?, slot? }) – מנהל; או עובד עם ord מתוך הזמנה שלא שולמה. דורס כרטיס קיים.
// עובד עם ord: רק עם ordId של הזמנה פתוחה (לא שולמה) בסניף שלו שמקושרת ללקוח – הזנת כרטיס מתוך ההזמנה (00:37).
async function ordGate(db, w, id, ordId) {
  if (typeof ordId !== 'string' || !/^[A-Za-z0-9_-]{1,60}$/.test(ordId)) throw deny('need-ord', 'פרטי כרטיס לעובד – רק מתוך הזמנה שלא שולמה');
  const o = await db.doc('ord/' + ordId).get();
  if (!o.exists) throw new HttpsError('not-found', 'ההזמנה לא נמצאה', { reason: 'no-ord' });
  if (o.get('custId') !== id) throw deny('not-linked', 'הלקוח לא מקושר להזמנה הזו');
  if (!OPEN_ST.includes(o.get('status'))) throw deny('ord-paid', 'ההזמנה כבר שולמה – פרטי הכרטיס למנהל בלבד');
  const br = o.get('br'), mine = w.staff && Array.isArray(w.staff.get('br')) ? w.staff.get('br') : null;
  // סמנטיקה זהה ל-orders.js (canBr ו-assertOrdBr): עובד בלי רשימת br במסמך staff = כל הסניפים (mine=null),
  // והזמנה בלי סניף ('' או '_' = עסק בלי סניפים) – בלי בדיקת סניף. ליקוי 3 – מיושר בכוונה, לא חסימה.
  if (mine && br && br !== '_' && !mine.includes(br)) throw deny('foreign-br', 'אין לך הרשאה להזמנה של סניף אחר');
  return ordId;
}
async function setCard(request) {
  const w = await who(request);
  const input = inputObject(request);
  onlyKeys(input, ['custId', 'card', 'ordId', 'slot', 'add']);
  const id = custIdOf(input.custId);
  if (input.add !== undefined && input.add !== true) throw bad('bad-field', 'add: true בלבד');
  if (input.add && input.slot != null) throw bad('bad-field', 'מקום או הוספה – לא שניהם');
  let n = input.add ? 0 : slotOf(input.slot); // 1–3; בלי = מקום 1 (כמו היום – מחליף את הכרטיס הראשון); add = המקום הפנוי הראשון
  // תוספת 11:50: הזנת כרטיס מתוך הזמנה (ordId) – רק כשמתג ordCard של העסק פעיל (ברירת מחדל פעיל; מנהל־על מכבה)
  if (input.ordId != null && w.biz && w.biz.features && w.biz.features.ordCard === false) throw deny('feature-off', 'הזנת כרטיס אשראי בהזמנה כבויה בעסק הזה');
  const card = CARD.cleanCard(input.card);
  const db = T.tdb();
  const ordId = w.role === 'manager' ? (typeof input.ordId === 'string' && /^[A-Za-z0-9_-]{1,60}$/.test(input.ordId) ? input.ordId : null) : await ordGate(db, w, id, input.ordId);
  await db.runTransaction(async (tx) => {
    const s = await tx.get(db.doc('cust/' + id));
    if (!s.exists || s.get('mv')) throw new HttpsError('not-found', 'הלקוח לא נמצא', { reason: 'no-cust' });
    if (input.add) { n = SLOTS.find((q) => !cardsOf(s.data()).some((x) => x.s === q)) || 0; if (!n) throw bad('cards-full', 'ללקוח כבר שמורים 3 כרטיסים. מחקו כרטיס בכרטיס הלקוח.'); }
    tx.set(db.doc(cardPath(id, n)), { box: CARD.seal(CARD_ENC_KEY.value(), w.bizId, cardAad(id, n), card), last4: card.num.slice(-4), at: Date.now(), by: w.uid, src: 'manual' });
    const list = cardsOf(s.data()).filter((x) => x.s !== n).concat([{ s: n, last4: card.num.slice(-4) }]);
    tx.update(s.ref, Object.assign(cardsUp(list), { upd: Date.now() }));
    tx.set(db.collection('cardLog').doc(), Object.assign({ t: Date.now(), by: w.uid, cust: id, act: 'set' }, ordId ? { ord: ordId } : {}, n > 1 ? { s: n } : {}));
  });
  return { ok: true, last4: card.num.slice(-4), slot: n };
}

// getCard({ custId, act:'view'|'copy', ordId? }) → { card:{num,exp?,name?,cvv?} } למנהל; { card:{num} } לעובד.
// עובד עם ord: רק עם ordId של הזמנה שלא שולמה (new/work/wait_pay), בסניף שלו, שמקושרת ללקוח הזה (custId). נבדק בשרת.
// כל קריאה מוצלחת נרשמת ב-cardLog לפני שהערך מוחזר.
// מכסת פענוח לכל משתמש (ליקוי 4, הנחה): עובד 20 לדקה / 150 ליום, מנהל 60 / 500. מונה cardQ/{uid} בטרנזקציה (חוקים: סגור).
// יום = תאריך UTC. חריגה → resource-exhausted (card-quota) ונרשמת ביומן act:'quota'.
const QUOTA = { manager: [60, 500], other: [20, 150] };
async function quota(db, w) {
  const [perMin, perDay] = QUOTA[w.role === 'manager' ? 'manager' : 'other'];
  const ref = db.doc('cardQ/' + w.uid);
  const now = Date.now(), m = Math.floor(now / 60000), d = new Date(now).toISOString().slice(0, 10);
  let over = null;
  await db.runTransaction(async (tx) => {
    over = null;
    const s = await tx.get(ref);
    const q = s.exists ? s.data() : {};
    const mn = q.m === m ? q.mn || 0 : 0, dn = q.d === d ? q.dn || 0 : 0;
    if (mn >= perMin) { over = 'min'; return; }
    if (dn >= perDay) { over = 'day'; return; }
    tx.set(ref, { m, mn: mn + 1, d, dn: dn + 1, upd: now });
  });
  if (over) {
    await db.collection('cardLog').add({ t: now, by: w.uid, act: 'quota', f: over });
    throw new HttpsError('resource-exhausted', over === 'min'
      ? `הגעת למכסת הצגת פרטי כרטיס (${perMin} בדקה). נסו שוב בעוד דקה.`
      : `הגעת למכסה היומית של הצגת פרטי כרטיס (${perDay}). פנו למנהל.`, { reason: 'card-quota' });
  }
}
async function getCard(request) {
  const w = await who(request);
  const input = inputObject(request);
  onlyKeys(input, ['custId', 'act', 'ordId', 'slot']);
  const id = custIdOf(input.custId);
  const n = slotOf(input.slot);
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
  const cs = await db.doc('cust/' + id).get();
  if (!cs.exists || cs.get('mv') || !cardsOf(cs.data()).some((x) => x.s === n)) throw new HttpsError('not-found', 'אין כרטיס שמור ללקוח', { reason: 'no-card' });
  await quota(db, w);
  const s = await db.doc(cardPath(id, n)).get();
  if (!s.exists) throw new HttpsError('not-found', 'אין כרטיס שמור ללקוח', { reason: 'no-card' });
  const c = CARD.open(CARD_ENC_KEY.value(), w.bizId, cardAad(id, n), s.get('box'));
  const out = w.role === 'manager' ? c : { num: c.num };
  const log = { t: Date.now(), by: w.uid, cust: id, act: input.act, f: w.role === 'manager' ? 'all' : 'num' };
  if (ordId) log.ord = ordId;
  if (n > 1) log.s = n;
  await db.collection('cardLog').add(log);
  return { card: out };
}

// delCard({ custId, slot? }) – מנהל. מוחק את המוצפן ואת last4/card מהלקוח. נרשם ביומן.
async function delCard(request) {
  const w = await who(request); mgrOnly(w);
  const input = inputObject(request);
  onlyKeys(input, ['custId', 'slot']);
  const id = custIdOf(input.custId);
  const n = slotOf(input.slot); // בלי = מקום 1 (כמו היום)
  const db = T.tdb();
  await db.runTransaction(async (tx) => {
    const s = await tx.get(db.doc('cust/' + id));
    if (!s.exists) throw new HttpsError('not-found', 'הלקוח לא נמצא', { reason: 'no-cust' });
    tx.delete(db.doc(cardPath(id, n)));
    tx.update(s.ref, Object.assign(cardsUp(cardsOf(s.data()).filter((x) => x.s !== n)), { upd: Date.now() }));
    tx.set(db.collection('cardLog').doc(), Object.assign({ t: Date.now(), by: w.uid, cust: id, act: 'del' }, n > 1 ? { s: n } : {}));
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
const FNS = { setCustCfg };
for (const [k, f] of Object.entries(FNS)) exports[k] = onCall(wrap(k, f));
const SFNS = { saveCust, importCusts, setCard, getCard, delCard, mergeCust }; // צריכות את מפתח הכרטיסים
for (const [k, f] of Object.entries(SFNS)) exports[k] = onCall({ secrets: [CARD_ENC_KEY], ...(k === 'importCusts' ? { timeoutSeconds: 540, memory: '512MiB' } : {}) }, wrap(k, f)); // ייבוא גדול: 60 שניות לא מספיקות (10.11)
Object.defineProperty(exports, '_core', { enumerable: false, value: { tzOf, last4Of, phoneOf, clean, idFor, portKey, cardsOf, flagFix } });
