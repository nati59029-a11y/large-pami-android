'use strict';
// שלב 6 (משימה 2026-11-14_הזמנות-לקוח-עסקי-וחשבוניות): ייבוא יתרות ומסמכים מתוכנה קודמת (כספית ואחרות). מנהל בלבד.
// לקוחות (כולל לקוח עסקי, תנאי תשלום ו-xc = מספר הלקוח בתוכנה הקודמת) – במסך ייבוא הלקוחות הקיים (customers.js / imports.js).
// פורמט הייצוא של כספית לא ידוע (לא מאומת) – לכן התאמת העמודות ידנית במכשיר, ונשמרת כאן (arcfg/impmap) לפעם הבאה.
//
//   ardoc/x_{סוג}_{מספר}  { t:'ob'|'old', k:'dr'|'cr', ot?:'inv'|'rc'|'cr' (old), ext, no, ser:'X', d, cust, custSnap, lines:[], vm:'inc', rate:0,
//                           net, vat:0, gross, due?, ref?, ord:[], br:'_', draft:false, bt, imp (קבוצה), note:'מסמך מיובא', by, at, sent:[], upd, open, st }
//       ob = יתרת פתיחה (המזהה x_ob_{מזהה הלקוח} – אחת ללקוח), old = מסמך ישן עם המספר המקורי (ext), מחוץ למספור שלנו, בלי PDF.
//       k = צד: dr חובה (כמו חשבונית, st open/part/paid) / cr זכות (כמו קבלה, st ok). סכומים באגורות, חיוביים. תוכן קבוע – רק docUpd (open/st/void).
//       סכום שלילי: חשבונית / יתרה → זכות; קבלה → חובה (למשל צ׳ק חוזר); זיכוי – תמיד זכות.
//       ייבוא חוזר: אותו מזהה קיים → "כבר יובא" (0 חדשים). מזהה של מסמך מבוטל (ביטול קבוצה) → x_..._v2 ... _v9, כדי שאפשר לייבא קובץ מתוקן.
//   aralloc  – כמו בקבלה רגילה: קבלה/זיכוי מיובאים עם "מספר חשבונית" (ref) סוגרים קודם את החשבונית הזו, ואז כל זכות פתוחה של הלקוח
//              סוגרת חובות פתוחים מהישן לחדש (כמו קיזוז זכות בחשבונית הבאה). cust.ar מתעדכן באותה טרנזקציה (bal = open − cr).
//   arimp/{batch}  { kind, name, at, by, n (נוצרו), sum (חובה − זכות של מה שנוצר, אגורות), st:'ok'|'void', nv?, voidAt?, upd }
//   arcfg/impmap   { [kind]: { [כותרת עמודה]: שדה } } – התאמת העמודות האחרונה לכל סוג.
// ביטול קבוצה = void (open=0, st:'void', void{at,by,why}) והקצאות מבוטלות – לא מחיקה. הכנסות: מסמכים מיובאים לא נרשמים (ar-inc.js מתעלם מ-ob/old).
// מחירים קבועים ללקוח – לא בייבוא (הבהרה 115).

const crypto = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { onCall } = require('./lib/region');
const logger = require('firebase-functions/logger');
const { FieldValue } = require('firebase-admin/firestore');
const T = require('./lib/tenant');
const { inputObject } = require('./lib/roles');
const ARD = require('./lib/ar-doc');
const AC = require('./lib/ar-calc');
const OC = require('./orders')._core;
const CUS = require('./customers')._core;

const { bad, deny, pre, onlyKeys } = OC;
const KINDS = ['ob', 'inv', 'rc', 'cr'];
const RUN_MAX = 25, DRY_MAX = 500, VOID_MAX = 25;
const ROW_KEYS = ['xc', 'vat', 'phone', 'tz', 'name', 'no', 'd', 'amt', 'dr', 'cr', 'ref', 'due'];
const BATCH_RE = /^[A-Za-z0-9_-]{8,40}$/;
const AG_MAX = 1000000000; // ₪10,000,000 למסמך מיובא (הנחה)
const MSG = {
  'bad-date': 'תאריך לא תקין', 'future': 'תאריך עתידי', 'bad-amt': 'סכום לא תקין', 'zero': 'סכום 0', 'no-no': 'חסר מספר מסמך', 'bad-no': 'מספר מסמך ארוך מדי',
  'no-key': 'חסר פרט לזיהוי הלקוח (מספר לקוח / ע.מ / טלפון / שם)', 'no-cust': 'הלקוח לא נמצא – ייבאו קודם את הלקוחות', 'cust-many': 'כמה לקוחות מתאימים – הוסיפו מספר לקוח או ע.מ',
  'dup-file': 'מופיע פעמיים בקובץ', 'bad-due': 'תאריך לתשלום לא תקין', 'too-many-v': 'המסמך יובא ובוטל יותר מדי פעמים',
  'dup-diff': 'מספר מסמך כפול עם נתונים שונים (לקוח / סכום / תאריך) – בדקו את הקובץ',
};

// ---------- פונקציות טהורות (גם לבדיקות) ----------
const ymd = (y, m, d) => `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
function realDate(y, m, d) {
  if (!(y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? ymd(y, m, d) : null;
}
// תאריך → 'YYYY-MM-DD' או null. מספר סידורי של Excel, YYYY-MM-DD (גם עם שעה), DD/MM/YYYY, DD.MM.YY, DD-MM-YYYY (יום קודם – כמו בישראל)
function dateOf(v) {
  if (typeof v === 'number') {
    if (!(v > 20000 && v < 80000)) return null;
    const t = new Date(Math.round((Math.floor(v) - 25569) * 864e5));
    return realDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }
  const s = String(v == null ? '' : v).trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/.exec(s);
  if (m) return realDate(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})(?:\s.*)?$/.exec(s);
  if (m) { let y = +m[3]; if (m[3].length === 2) y += y <= 69 ? 2000 : 1900; return realDate(y, +m[2], +m[1]); }
  if (/^\d{5}(\.\d+)?$/.test(s)) return dateOf(Number(s));
  return null;
}
// סכום → אגורות (שלם, עם סימן) או null. "1,234.50", "-1,234.50", "1,234.50-", "(1,234.50)", "₪ 1234", "1234,5" (פסיק עשרוני)
function agOf(v) {
  if (typeof v === 'number') { if (!Number.isFinite(v)) return null; const a = Math.round(v * 100 + (v >= 0 ? 1e-7 : -1e-7)); return Math.abs(a) <= AG_MAX ? a : null; }
  let s = String(v == null ? '' : v).replace(/[\s ‎‏₪$]|ש"ח|ש״ח|nis|ils/gi, '');
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); if (/^-|-$/.test(s)) return null; } // תיקון סבב 1 (הערה): "(-5)" – לא חד משמעי
  if (/^-/.test(s)) { neg = !neg; s = s.slice(1); } else if (/-$/.test(s)) { neg = !neg; s = s.slice(0, -1); }
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');
  const m = /^(\d+)(?:\.(\d*))?$/.exec(s);
  if (!m) return null;
  const f = ((m[2] || '') + '000').slice(0, 3);
  let a = Number(m[1]) * 100 + Number(f.slice(0, 2)) + (Number(f[2]) >= 5 ? 1 : 0);
  if (!Number.isSafeInteger(a) || a > AG_MAX) return null;
  if (neg) a = -a;
  return a;
}
const strOf = (v, n) => { if (v == null) return ''; const s = typeof v === 'number' ? (Number.isInteger(v) ? String(v) : String(v)) : String(v); return s.replace(/\s+/g, ' ').trim().slice(0, n); };
// חלק המספר במזהה: מספר "נקי" כמו שהוא, אחרת גיבוב קבוע (מזהה Firestore לא יכול להכיל "/")
const keyOf = (no) => (/^[A-Za-z0-9-]{1,30}$/.test(no) ? no : 'h' + crypto.createHash('sha1').update(no).digest('hex').slice(0, 16));
const sideOf = (kind, a) => (kind === 'cr' ? 'cr' : kind === 'rc' ? (a >= 0 ? 'cr' : 'dr') : (a >= 0 ? 'dr' : 'cr'));
// שורה גולמית → { ok, why } או { ok:true, no, d, ag (חיובי), k, ref?, due?, ck:{xc,vat,phone,tz,name} }
function parseRow(kind, r, today) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return { ok: false, why: 'bad-row' };
  const no = strOf(r.no, 40);
  if (kind !== 'ob' && !no) return { ok: false, why: 'no-no' };
  if (no.length > 30) return { ok: false, why: 'bad-no' };
  let d = '', dd = false;
  if (r.d != null && String(r.d).trim() !== '') { d = dateOf(r.d); if (!d) return { ok: false, why: 'bad-date' }; } else if (kind !== 'ob') return { ok: false, why: 'bad-date' };
  else { d = today; dd = true; } // יתרה בלי תאריך – היום (בהשוואה לייבוא קודם התאריך לא נבדק)
  if (d > today) return { ok: false, why: 'future' };
  let a, side = null;
  const has = (x) => x != null && String(x).trim() !== '';
  if (has(r.amt)) { a = agOf(r.amt); if (a == null) return { ok: false, why: 'bad-amt' }; }
  else if (has(r.dr) || has(r.cr)) { const x = has(r.dr) ? agOf(r.dr) : 0, y = has(r.cr) ? agOf(r.cr) : 0; if (x == null || y == null) return { ok: false, why: 'bad-amt' }; a = x - y; side = a >= 0 ? 'dr' : 'cr'; } // תיקון סבב 1 (ליקוי 1): עמודות חובה / זכות – הצד לפי העמודה, בכל סוג מסמך
  else return { ok: false, why: 'bad-amt' };
  if (a === 0) return { ok: false, why: 'zero' };
  if (Math.abs(a) > AG_MAX) return { ok: false, why: 'bad-amt' };
  const o = { ok: true, no, d, ag: Math.abs(a), k: side || sideOf(kind, a), ...(dd ? { dd: true } : {}) };
  const ref = strOf(r.ref, 30);
  if (ref && kind !== 'ob') o.ref = ref;
  if (has(r.due) && o.k === 'dr') { const u = dateOf(r.due); if (!u) return { ok: false, why: 'bad-due' }; o.due = u; }
  const vat = String(r.vat == null ? '' : r.vat).replace(/\D/g, '');
  o.ck = { xc: strOf(r.xc, 20), vat: /^\d{8,9}$/.test(vat) ? vat.padStart(9, '0') : '', phone: '', tz: '', name: strOf(r.name, 60) };
  try { if (has(r.phone)) o.ck.phone = CUS.phoneOf(r.phone); } catch (e) { /* לא תקין – לא משמש לזיהוי */ }
  try { if (has(r.tz)) o.ck.tz = CUS.tzOf(r.tz); } catch (e) { /* */ }
  if (!o.ck.xc && !o.ck.vat && !o.ck.phone && !o.ck.tz && !o.ck.name) return { ok: false, why: 'no-key' };
  return o;
}

// ---------- זיהוי לקוח: מספר לקוח ← ע.מ ← ת"ז ← טלפון (כולל אנשי קשר) ← שם / שם העסק (מדויק) ----------
async function findCust(db, ck, cache) {
  const ck2 = JSON.stringify(ck);
  if (cache.has(ck2)) return cache.get(ck2);
  const live = (L) => { const m = new Map(); L.forEach((s) => { if (s.exists && !s.get('mv')) m.set(s.id, s); }); return [...m.values()]; };
  const q = async (f, op, v) => (await db.collection('cust').where(f, op, v).limit(3).get()).docs;
  const steps = [];
  if (ck.xc) steps.push(async () => live(await q('xc', '==', ck.xc)));
  if (ck.vat) steps.push(async () => live(await q('vat', '==', ck.vat)));
  if (ck.tz) steps.push(async () => live([await db.doc('cust/t' + ck.tz).get()]));
  if (ck.phone) steps.push(async () => { const p = live([await db.doc('cust/p' + ck.phone).get()]); return p.length ? p : live(await q('phx', 'array-contains', ck.phone)); });
  if (ck.name) steps.push(async () => live((await q('name', '==', ck.name)).concat(await q('bn', '==', ck.name))));
  let r = { why: 'no-cust' };
  for (const st of steps) {
    const L = await st();
    if (L.length === 1) { r = { id: L[0].id, name: String(L[0].get('bn') || L[0].get('name') || '') }; break; }
    if (L.length > 1) { r = { why: 'cust-many' }; break; }
  }
  cache.set(ck2, r);
  return r;
}
const baseId = (kind, p, cid) => (kind === 'ob' ? 'x_ob_' + cid : `x_${kind}_${keyOf(p.no)}`);

// תיקון סבב 1 (ליקויים 3, 4): המזהה הפנוי בשרשרת x_… → _v2.._v9 (אחרי ביטול), וזהות המסמך הקיים.
// get(id) → נתוני המסמך או null. מחזיר { st:'dup' } (אותו מסמך כבר יובא), { st:'new', id }, או { why } (שגיאה בשורה)
const same = (x, r) => x.cust === r.cust && x.gross === r.ag && x.k === r.k && (x.d === r.d || (r.dd === true && x.t === 'ob'));
async function slotOf(get, r) {
  let id = r.id, x = await get(id), v = 1;
  while (x && x.void && v < 9) { v++; id = r.id + '_v' + v; x = await get(id); }
  if (x && !x.void) return same(x, r) ? { st: 'dup' } : { why: 'dup-diff' };
  if (x) return { why: 'too-many-v' };
  return { st: 'new', id };
}
async function who(request) {
  const w = await OC.who(request);
  if (w.role !== 'manager') throw deny('manager-only', 'ייבוא מתוכנה קודמת – מנהל בלבד');
  return w;
}
// בודק את השורות ומזהה לקוחות (בלי כתיבה). מחזיר לכל שורה { i, ok, why?, cust?, name?, id?, k, ag }
async function prepare(db, kind, rows, today) {
  const cache = new Map(), out = [], seen = new Set();
  for (let i = 0; i < rows.length; i++) {
    const p = parseRow(kind, rows[i], today);
    if (!p.ok) { out.push({ i, ok: false, why: p.why }); continue; }
    const c = await findCust(db, p.ck, cache);
    if (!c.id) { out.push({ i, ok: false, why: c.why }); continue; }
    const id = baseId(kind, p, c.id);
    if (seen.has(id)) { out.push({ i, ok: false, why: 'dup-file' }); continue; }
    seen.add(id);
    out.push(Object.assign({ i, ok: true, cust: c.id, name: c.name, id }, p));
  }
  return out;
}
const pub = (r) => (r.ok ? { i: r.i, ok: true, st: r.st || 'new', name: r.name, k: r.k, ag: r.ag, no: r.no, d: r.d } : { i: r.i, ok: false, why: r.why, msg: MSG[r.why] || 'שורה לא תקינה' });

// ---------- arImp({ batch, kind, rows, dry?, name?, map? }) ----------
// dry – תצוגה מקדימה: עד 500 שורות, בלי כתיבה (חוץ מהתאמת העמודות). אחרת – עד 25 שורות, טרנזקציה אחת.
async function arImp(request) {
  const w = await who(request);
  const input = inputObject(request);
  onlyKeys(input, ['batch', 'kind', 'rows', 'dry', 'name', 'map']);
  if (!KINDS.includes(input.kind)) throw bad('bad-kind', 'סוג ייבוא לא תקין');
  const kind = input.kind, dry = input.dry === true;
  if (!Array.isArray(input.rows) || !input.rows.length || input.rows.length > (dry ? DRY_MAX : RUN_MAX)) throw bad('bad-rows', `שורות: 1 עד ${dry ? DRY_MAX : RUN_MAX}`);
  for (const r of input.rows) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw bad('bad-rows', 'שורה לא תקינה');
    onlyKeys(r, ROW_KEYS, 'שורה');
    for (const v of Object.values(r)) if (!(v == null || typeof v === 'number' || (typeof v === 'string' && v.length <= 80))) throw bad('bad-rows', 'ערך לא תקין בשורה');
  }
  const db = T.tdb();
  const today = ARD.ilDay(Date.now());
  const rows = await prepare(db, kind, input.rows, today);
  if (dry) {
    if (input.map != null) {
      const m = input.map;
      if (!m || typeof m !== 'object' || Array.isArray(m) || Object.keys(m).length > 60) throw bad('bad-map', 'התאמת עמודות לא תקינה');
      const clean = {};
      for (const [h, f] of Object.entries(m)) if (typeof h === 'string' && h.length <= 40 && h.trim() && !/[.$#[\]/]/.test(h) && (f === '' || ROW_KEYS.includes(f))) clean[h] = f;
      await db.doc('arcfg/impmap').set({ [kind]: clean, upd: Date.now() }, { merge: true });
    }
    const ok = rows.filter((r) => r.ok);
    const get = async (id) => { const s = await db.doc('ardoc/' + id).get(); return s.exists ? s.data() : null; };
    for (const r of ok) { const z = await slotOf(get, r); if (z.why) { r.ok = false; r.why = z.why; } else r.st = z.st; }
    const ok2 = rows.filter((r) => r.ok), nw = ok2.filter((r) => r.st !== 'dup');
    return { rows: rows.map(pub), n: rows.length, add: nw.length, dup: ok2.length - nw.length, bad: rows.length - ok2.length, sum: nw.reduce((s, r) => s + (r.k === 'dr' ? r.ag : -r.ag), 0) };
  }
  if (typeof input.batch !== 'string' || !BATCH_RE.test(input.batch)) throw bad('bad-batch', 'מזהה קבוצה חסר');
  const batch = input.batch, name = strOf(input.name, 80);
  let res = null;
  await db.runTransaction(async (tx) => {
    const B = await new ARD.Book(tx, db, w).init();
    const bref = db.doc('arimp/' + input.batch);
    const bs = await tx.get(bref);
    if (bs.exists && bs.get('st') === 'void') throw pre('batch-void', 'הקבוצה הזו בוטלה. התחילו ייבוא חדש');
    if (bs.exists && bs.get('kind') !== kind) throw bad('bad-batch', 'מזהה הקבוצה שייך לסוג אחר');
    const L = rows.map((r) => Object.assign({}, r, { st: undefined }));
    // קריאות: המזהה (ומזהי _v2.. אם המקור בוטל), הלקוחות, המסמכים הפתוחים שלהם, וחשבונית ההפניה
    for (const r of L) {
      if (!r.ok) continue;
      const z = await slotOf(async (id) => { const x = await B.needDoc(id); return x ? x.d : null; }, r);
      if (z.why) { r.ok = false; r.why = z.why; continue; }
      if (z.st === 'dup') { r.st = 'dup'; continue; }
      r.id = z.id;
      const c = await B.needCust(r.cust);
      if (!c.data || c.data.mv) { r.ok = false; r.why = 'no-cust'; }
    }
    const nw = L.filter((r) => r.ok && r.st !== 'dup');
    const cids = [...new Set(nw.map((r) => r.cust))];
    const open = {};
    for (const cid of cids) open[cid] = await B.openDocs(cid);
    const refs = {};
    for (const r of nw) if (r.ref && r.k === 'cr') { const rid = `x_inv_${keyOf(r.ref)}`; if (!refs[rid]) refs[rid] = await B.needDoc(rid); }
    // כתיבות (בזיכרון עד flush)
    const made = [];
    for (const r of nw) {
      const c = B.custs[r.cust];
      const d = { t: kind === 'ob' ? 'ob' : 'old', k: r.k, ...(kind === 'ob' ? {} : { ot: kind }), ext: r.no, no: r.no, ser: 'X', d: r.d, cust: r.cust, custSnap: ARD.custSnap(c.data),
        lines: [], vm: 'inc', rate: 0, net: r.ag, vat: 0, gross: r.ag, ord: [], br: ARD.NB, draft: false, bt: B.bt, imp: batch, note: 'מסמך מיובא',
        // החלטת בעל הפרויקט (15.11.2026): חוב מיובא בלי "תאריך לתשלום" – המועד לפי תנאי התשלום של הלקוח (כמו בחשבונית חדשה), מתאריך המסמך
        ...(r.due ? { due: r.due } : r.k === 'dr' ? { due: ARD.dueFor(AC.termsOfCust(c.data), r.d), dueT: 1 } : {}), ...(r.ref && r.k === 'cr' ? { ref: `x_inv_${keyOf(r.ref)}` } : {}),
        by: w.uid, at: B.now, sent: [], upd: B.now, open: r.ag, st: r.k === 'dr' ? 'open' : 'ok' };
      const x = { id: r.id, ref: db.doc('ardoc/' + r.id), d, patch: null, isNew: true };
      B.docs[r.id] = x; B.news.push(x); made.push(x);
      if (r.k === 'dr') { c.ar.bal += r.ag; c.ar.open += r.ag; } else { c.ar.bal -= r.ag; c.ar.cr += r.ag; }
      c.dirty = true;
    }
    // הקצאות: קודם לפי מספר חשבונית, ואז כל זכות פתוחה מול חובות פתוחים (מהישן לחדש)
    for (const x of made) {
      if (x.d.k !== 'cr' || !x.d.ref) continue;
      const v = B.docs[x.d.ref];
      if (v && !v.d.void && v.d.cust === x.d.cust && v.d.open > 0 && ARD.isDr(v.d)) B.alloc(x, v, x.d.open);
    }
    const byD = (a, b) => String(a.d.dueX || a.d.due || a.d.d).localeCompare(String(b.d.dueX || b.d.due || b.d.d)) || String(a.d.d).localeCompare(String(b.d.d)) || (a.d.at || 0) - (b.d.at || 0);
    for (const cid of cids) {
      const all = open[cid].concat(made.filter((x) => x.d.cust === cid));
      const drs = all.filter((x) => ARD.isDr(x.d) && !x.d.void).sort(byD), crs = all.filter((x) => ARD.isCr(x.d) && !x.d.void).sort(byD);
      for (const s of crs) for (const v of drs) { if (s.d.open <= 0) break; if (v.d.open > 0) B.alloc(s, v, s.d.open); }
    }
    B.flush();
    const sum = made.reduce((s, x) => s + (x.d.k === 'dr' ? x.d.gross : -x.d.gross), 0);
    if (!bs.exists) tx.set(bref, { kind, name, at: B.now, by: w.uid, n: made.length, sum, st: 'ok', upd: B.now });
    else tx.update(bref, { n: FieldValue.increment(made.length), sum: FieldValue.increment(sum), upd: B.now });
    res = { rows: L.map(pub), add: made.length, dup: L.filter((r) => r.st === 'dup').length, bad: L.filter((r) => !r.ok).length, sum };
  }, { maxAttempts: 30 });
  return res;
}

// ---------- arImpVoid({ batch, reason? }) – עד 25 מסמכים בקריאה; left > 0 → קוראים שוב ----------
async function arImpVoid(request) {
  const w = await who(request);
  const input = inputObject(request);
  onlyKeys(input, ['batch', 'reason']);
  if (typeof input.batch !== 'string' || !BATCH_RE.test(input.batch)) throw bad('bad-batch', 'מזהה קבוצה חסר');
  const why = strOf(input.reason, 200) || 'ביטול ייבוא';
  const db = T.tdb();
  let res = null;
  await db.runTransaction(async (tx) => {
    const bref = db.doc('arimp/' + input.batch);
    const bs = await tx.get(bref);
    if (!bs.exists) throw new HttpsError('not-found', 'הקבוצה לא נמצאה', { reason: 'no-batch' });
    const q = await tx.get(db.collection('ardoc').where('imp', '==', input.batch).limit(2000));
    const live = q.docs.filter((s) => !s.get('void') && ['ob', 'old'].includes(s.get('t')));
    const now0 = live.slice(0, VOID_MAX);
    const B = await new ARD.Book(tx, db, w).init();
    const xs = [], als = new Map();
    for (const s of now0) {
      const x = await B.needDoc(s.id);
      const [a1, a2] = await Promise.all([tx.get(db.collection('aralloc').where('rc', '==', s.id)), tx.get(db.collection('aralloc').where('inv', '==', s.id))]);
      const mine = a1.docs.concat(a2.docs).filter((a) => !a.get('void'));
      for (const a of mine) { als.set(a.id, a); await B.needDoc(a.get('rc') === s.id ? a.get('inv') : a.get('rc')); }
      await B.needCust(x.d.cust);
      xs.push([x, mine]);
    }
    const done = new Set();
    for (const [x, mine] of xs) {
      const c = B.custs[x.d.cust], dr = ARD.isDr(x.d);
      for (const a of mine) {
        if (done.has(a.id)) continue;
        done.add(a.id);
        const amt = a.get('amt'), o = B.docs[dr ? a.get('rc') : a.get('inv')];
        if (o) { if (dr) B.set(o, { open: o.d.open + amt }); else B.set(o, { open: o.d.open + amt, st: ARD.stOf('inv', o.d.open + amt, o.d.gross) }); }
        if (c && c.data) { if (dr) c.ar.cr += amt; else c.ar.open += amt; }
        tx.update(a.ref, { void: true, voidAt: B.now, voidBy: w.uid });
      }
      if (c && c.data) { if (dr) { c.ar.open -= x.d.open; c.ar.bal -= x.d.gross; } else { c.ar.cr -= x.d.open; c.ar.bal += x.d.gross; } c.dirty = true; }
      B.set(x, { open: 0, st: 'void', void: { at: B.now, by: w.uid, why } });
    }
    B.flush();
    const left = live.length - now0.length;
    tx.update(bref, Object.assign({ nv: FieldValue.increment(now0.length), upd: B.now }, left ? {} : { st: 'void', voidAt: B.now, voidBy: w.uid }));
    res = { voided: now0.length, left };
  }, { maxAttempts: 30 });
  return res;
}

// ---------- arImpList() – הקבוצות האחרונות והתאמות העמודות השמורות ----------
async function arImpList(request) {
  await who(request);
  const db = T.tdb();
  const [q, m] = await Promise.all([db.collection('arimp').orderBy('at', 'desc').limit(30).get(), db.doc('arcfg/impmap').get()]);
  const maps = m.exists ? m.data() || {} : {};
  delete maps.upd;
  return { batches: q.docs.map((s) => { const d = s.data(); return { id: s.id, kind: d.kind, name: d.name || '', at: d.at, n: d.n || 0, sum: d.sum || 0, st: d.st, nv: d.nv || 0 }; }), maps };
}

const wrap = (name, fn) => T.scoped(async (request) => {
  try { return await fn(request); } catch (e) {
    if (e instanceof HttpsError) throw e;
    logger.error(`ar-import: ${name} failed`, { reason: 'internal', name: e && e.name, code: e && e.code });
    throw new HttpsError('internal', 'שגיאה בפעולה. נסו שוב.', { reason: 'internal' });
  }
});
const FNS = { arImp, arImpVoid, arImpList };
for (const [k, f] of Object.entries(FNS)) exports[k] = onCall({ memory: '512MiB', timeoutSeconds: 120 }, wrap(k, f));
Object.defineProperty(exports, '_core', { enumerable: false, value: { dateOf, agOf, keyOf, sideOf, parseRow, slotOf, MSG } });
