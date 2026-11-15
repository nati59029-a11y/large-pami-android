'use strict';
// סריקת חנות בתלת מימד – שלב 8 (14.11.2026): הלוגיקה הטהורה של בדיקת מדף (shelfCheck) וטיוטת מפה (mapDraft), בלי Firestore
// (נבדקת ב-Node בלי אמולטור). המקור המחייב: חוזה הנתונים, סעיפים 4.3, 4.6, 4.9, 4.10, 4.15, 4.17, 5.1, 5.3.
//   decodeJpeg(b64, lim)        – תמונה מהטלפון: base64 של JPEG בלבד (לפי התוכן, scan.sniff), גודל ומידות לפי הגבולות.
//   checkSlot(slot, map)        – מקום הצילום קיים במפה: הגוף לא מחוק, הצד והמקטע בטווח, וגובה הצילום (a / t+b) לפי hi.
//   quotaStep(...)              – הזמנת מכסה: חודשית לסניף (s3use/b_{br}) + בלם יומי לעובד (s3use/u_{uid}), אזהרה ב-80%.
//   draftDayStep(...)           – עד DRAFT_DAY_MAX (5) הקמות (mapDraft) ביום לסניף (s3use/d_{br}).
//   shelfBroken / cleanShelf    – תשובת המודל לבדיקת מדף: "שבורה" (נדחית, המכסה מוחזרת) או מסוננת לשדות ai (4.10).
//                                 גם תשובה תקינה במבנה מסוננת כאן: סוגים, טווחים, מחסן בלי מחירים, conf<0.6 = אזהרה, מספר המלצות.
//   cleanDraft                  – תשובת המודל לטיוטת מפה → מפה במבנה 4.3 (מזהים, מספור, חדר לכל גוף, uz עם ok:false).
//   sumEntry / countsDone       – s3sum.b[bay] ומספר המקומות שצולמו בפועל (רק ok / issue / review נחשבים "צולם").

const { sniff } = require('./scan');
const M = require('./store3d-map');

const ISSUE_KINDS = ['noprice', 'pricepos', 'promoexp', 'hole', 'low', 'damaged', 'fallen', 'upside', 'face', 'order', 'misplaced', 'missing'];
const PRICE_KINDS = ['noprice', 'pricepos', 'promoexp']; // במחסן השרת מוחק אותם (4.10)
const STATUSES = ['ok', 'issue', 'review', 'bad', 'person'];
const DONE_ST = ['ok', 'issue', 'review'];               // "צולם" לספירת nDone. bad / person = צריך לצלם שוב
const LOW_CONF = 0.6;                                    // מתחת לזה – אזהרה בלבד, "לבדיקה" (6-הנחיות-AI, לא מאומת)
const MIN_T = 1735689600000, MAX_T = 4102444800000;      // טווח שדות זמן (ע7)

// גבולות תמונה (4.9, 4.20, 5.1)
const IMG = { min: 1000, max: 1500000, longMin: 400, longMax: 1600, shortMin: 200, shortMax: 1600 };
const THUMB = { min: 500, max: 150000, longMin: 1, longMax: 512, shortMin: 1, shortMax: 512 };
// טיוטת מפה: כל תמונה כמו תמונת מדף (צלע ארוכה עד 1600, אותה דחיסה), עד 100 תמונות, וסך הכל עד 13,000,000 בתים אחרי פענוח
// (החלטת המשתמש 15.11.2026: "הכמות הכי גדולה בלי להוריד איכות"). 13MB ב-base64 ≈ 17.3MB – מתחת למגבלת בקשה inline של Gemini
// (כ-20MB, לא מאומת) ומתחת למגבלת גודל בקשה של onCall / Cloud Run (32MiB, לא מאומת).
const DRAFT = { maxImgs: 100, maxTotal: 13000000, img: { min: 1000, max: 1500000, longMin: 200, longMax: 1600, shortMin: 100, shortMax: 1600 } };

const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const inR = (v, a, b) => Number.isInteger(v) && v >= a && v <= b;
const str = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n) : '');
const num01 = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null);
const r2 = (v) => Math.round(v * 100) / 100;
function fail(code, msg) { const e = new Error(msg || code); e.code = code; return e; }

// ---------- תמונות ----------
// b64 = base64 (מותרת התחילית data:image/jpeg;base64,). lim = IMG / THUMB / DRAFT.img. מחזיר { buf, w, h } או זורק fail.
function decodeJpeg(b64, lim, label) {
  const L = label || 'התמונה';
  if (typeof b64 !== 'string' || !b64) throw fail('bad-img', 'חסרה ' + (label ? label : 'תמונה'));
  const s = b64.replace(/^data:image\/jpeg;base64,/, '');
  if (s.length > Math.ceil(lim.max / 3) * 4 + 4) throw fail('too-big', `${L} גדולה מדי`);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.length % 4 !== 0) throw fail('bad-img', `${L} לא בפורמט base64`);
  const buf = Buffer.from(s, 'base64');
  if (buf.length > lim.max) throw fail('too-big', `${L} גדולה מדי`);
  if (buf.length < lim.min) throw fail('bad-img', `${L} קטנה מדי או ריקה`);
  if (sniff(buf) !== 'image/jpeg') throw fail('bad-type', 'מותרת רק תמונת JPEG');
  const sz = M.jpegSize(buf);
  if (!sz) throw fail('bad-img', `לא הצלחנו לקרוא את המידות של ${L}`);
  const lo = Math.min(sz.w, sz.h), hi = Math.max(sz.w, sz.h);
  if (hi < lim.longMin || hi > lim.longMax || lo < lim.shortMin || lo > lim.shortMax) throw fail('bad-size', `המידות של ${L} לא מתאימות (צלע ארוכה עד ${lim.longMax} פיקסלים)`);
  return { buf, w: sz.w, h: sz.h, b64: s };
}

// טיוטת מפה: מערך התמונות (1–DRAFT.maxImgs, כל אחת לפי DRAFT.img, סך הכל עד DRAFT.maxTotal). מחזיר [{ buf, w, h, b64 }] או זורק fail.
function draftImgs(arr) {
  if (!Array.isArray(arr) || arr.length < 1 || arr.length > DRAFT.maxImgs) throw fail('bad-img-count', `צריך לשלוח בין 1 ל-${DRAFT.maxImgs} תמונות`);
  let total = 0;
  const imgs = arr.map((s, i) => { const d = decodeJpeg(s, DRAFT.img, 'תמונה ' + (i + 1)); total += d.buf.length; return d; });
  if (total > DRAFT.maxTotal) throw fail('too-big', 'התמונות יחד גדולות מדי. שלחו פחות תמונות או תמונות קטנות יותר.');
  return imgs;
}

// ---------- מקום הצילום ----------
const RE_SLOT = /^(f[0-9]{1,4})-([ab])-([0-9]{1,2})_([atb])$/;
// map = המפה הנוכחית. מחזיר { bay, fx, lv, hi } או זורק fail('bad-slot').
function checkSlot(slot, map) {
  const m = typeof slot === 'string' ? RE_SLOT.exec(slot) : null;
  if (!m) throw fail('bad-slot', 'מקום הצילום לא תקין');
  const f = (isObj(map) && Array.isArray(map.fx) ? map.fx : []).find((x) => isObj(x) && x.id === m[1] && x.del !== 1);
  if (!f) throw fail('bad-slot', 'המדף לא קיים במפה (אולי נמחק). טענו את המפה מחדש.');
  const n = +m[3];
  if (m[2] === 'b' && f.sides !== 2) throw fail('bad-slot', 'למדף הזה יש רק צד אחד');
  if (!inR(n, 1, inR(f.bays, 1, 30) ? f.bays : 0)) throw fail('bad-slot', 'מספר המקטע לא קיים במדף');
  const hi = f.hi === true;
  if (hi ? m[4] === 'a' : m[4] !== 'a') throw fail('bad-slot', hi ? 'במדף גבוה מצלמים חלק עליון וחלק תחתון בנפרד' : 'במדף הזה מצלמים תמונה אחת');
  return { bay: `${m[1]}-${m[2]}-${m[3]}`, fx: m[1], lv: m[4], hi };
}

// ---------- מכסה (4.15) ----------
// b = מסמך s3use/b_{br} (או null), u = s3use/u_{uid} (או null). o = { k, cap, month, day, now, userMax, a?, adhocMax? }.
// דיווח יזום (החלטת המשתמש, תיקון סבב 1): o.adhocMax (20) = מונה יומי נפרד לעובד, s3use/a_{uid} = o.a, בנוסף למכסה החודשית.
//   מנהל – בלי המונה הזה (adhocMax = null). מחזיר { b, u, a?, warn, usage } לכתיבה, או זורק fail('s3-month-limit' | 's3-user-day' | 's3-adhoc-day').
const dayN = (doc, day) => (isObj(doc) && doc.d === day && inR(doc.n, 0, 100000) ? doc.n : 0);
function quotaStep(b, u, o) {
  const k = o.k, cap = inR(o.cap, 0, 100000) ? o.cap : 500;
  const n0 = isObj(b) && b.m === o.month && inR(b.n, 0, 100000) ? b.n : 0;
  const w80 = isObj(b) && b.m === o.month && typeof b.w80 === 'string' ? b.w80 : '';
  const un0 = dayN(u, o.day);
  const lim = Number.isInteger(o.adhocMax);
  const an0 = lim ? dayN(o.a, o.day) : 0;
  if (n0 + k > cap) throw fail('s3-month-limit', `נגמרה המכסה החודשית של הסניף (${n0} מתוך ${cap} בדיקות). התמונות נשמרות בטלפון ויישלחו כשהמכסה תוגדל או בחודש הבא.`);
  if (un0 + k > o.userMax) throw fail('s3-user-day', `שלחת היום יותר מ-${o.userMax} בדיקות. נסו שוב מחר.`);
  if (lim && an0 + k > o.adhocMax) throw fail('s3-adhoc-day', `אפשר לשלוח עד ${o.adhocMax} דיווחים יזומים ביום. נסו שוב מחר.`);
  const n = n0 + k;
  const warn = n >= 0.8 * cap && w80 !== o.month;
  const out = {
    b: { m: o.month, n, cap, w80: warn ? o.month : w80, upd: o.now },
    u: { d: o.day, n: un0 + k, upd: o.now },
    warn,
    usage: { m: o.month, n, cap, w80: n >= 0.8 * cap },
  };
  if (lim) out.a = { d: o.day, n: an0 + k, upd: o.now };
  return out;
}
// החזרה (רק כשהבקשה לא הגיעה ל-AI או נדחתה ממנו בלי חיוב – החלטת המשתמש, תיקון סבב 1): המונה החודשי של הסניף, באותו חודש.
// הבלם היומי לעובד לא מוחזר (נגד לולאת שליחה תקועה).
function refundStep(b, month, k, now) {
  if (!isObj(b) || b.m !== month || !inR(b.n, 0, 100000)) return null;
  return { n: Math.max(0, b.n - k), upd: now };
}
// הקמות (mapDraft) ביום לסניף (החלטת המשתמש 15.11.2026): s3use/d_{br} = { d: יום בשעון ישראל, n, upd }. יום חדש = מתחילים מ-0.
// doc = המסמך הקיים (או null). מחזיר את המסמך החדש לכתיבה, או זורק fail('draft-daily'). בהחזרה – refundDay (אותו מבנה).
const DRAFT_DAY_MAX = 5;
function draftDayStep(doc, day, now, max) {
  const lim = inR(max, 0, 100000) ? max : DRAFT_DAY_MAX;
  const n0 = dayN(doc, day);
  if (n0 + 1 > lim) throw fail('draft-daily', `הגעתם ל-${lim} הקמות היום בסניף הזה. נסו שוב מחר.`);
  return { d: day, n: n0 + 1, upd: now };
}
// החזרה במונה יומי (דיווח יזום, הקמות), באותו יום
function refundDay(doc, day, k, now) {
  if (!isObj(doc) || doc.d !== day || !inR(doc.n, 0, 100000)) return null;
  return { n: Math.max(0, doc.n - k), upd: now };
}

// ---------- בדיקת מדף: תשובת המודל ----------
// "שבורה" = לא אובייקט, או st לא מוכר, או (לא person/bad) בלי רשימת iss. במקרה כזה אין מה לשמור – המכסה מוחזרת.
function shelfBroken(r) {
  if (!isObj(r) || !STATUSES.includes(r.st)) return true;
  if (r.st === 'person' || r.st === 'bad') return false;
  return !Array.isArray(r.iss);
}
const isBox = (b) => Array.isArray(b) && b.length === 4 && b.every((n) => inR(n, 0, 1000));
function box(b) {
  if (!Array.isArray(b) || b.length !== 4 || !b.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  const x = b.map((n) => Math.min(1000, Math.max(0, Math.round(n))));
  if (x[0] + x[2] > 1000) x[2] = 1000 - x[0];
  if (x[1] + x[3] > 1000) x[3] = 1000 - x[1];
  return isBox(x) && x[2] > 0 && x[3] > 0 ? x : null;
}
const norm = (s) => str(s, 60).replace(/["'״׳]/g, '').toLowerCase();
// pid לפי שם: קודם מ"מה אמור להיות" של המקטע (bay.exp), אחר כך מהקטלוג (prod.name זהה). cat = Map(שם מנורמל → pid)
function pidOf(n, ctx) {
  const k = norm(n);
  if (!k) return '';
  for (const e of ctx.exp || []) if (isObj(e) && typeof e.pid === 'string' && e.pid && norm(e.n) === k) return e.pid.slice(0, 60);
  return (ctx.catalog && ctx.catalog.get(k)) || '';
}

// r = תשובת המודל (אחרי JSON.parse), ctx = { wh, recN, cats, catMode, exp, catalog }. מחזיר { ai, ask, t } – ai בלי model/at/ver.
function cleanShelf(r, ctx) {
  const c = ctx || {};
  if (r.st === 'person') return { ai: { st: 'person', conf: num01(r.conf) == null ? 1 : r2(num01(r.conf)), iss: [] }, ask: false, t: '' };
  if (r.st === 'bad') return { ai: { st: 'bad', conf: num01(r.conf) == null ? 1 : r2(num01(r.conf)), iss: [] }, ask: false, t: str(r.t, 120) };
  const iss = [];
  for (const x of r.iss) {
    if (iss.length >= 30) break;
    if (!isObj(x) || !ISSUE_KINDS.includes(x.k)) continue;
    if (c.wh && PRICE_KINDS.includes(x.k)) continue;
    const conf = num01(x.conf);
    if (conf == null) continue;
    const sev = typeof x.sev === 'number' && Number.isFinite(x.sev) ? Math.min(3, Math.max(1, Math.round(x.sev))) : 2;
    const it = { k: x.k, sev, conf: r2(conf), t: str(x.t, 200), warn: x.warn === true || x.k === 'pricepos' || conf < LOW_CONF };
    const b = box(x.box);
    if (b) it.box = b;
    iss.push(it);
  }
  const hard = iss.some((i) => !i.warn);
  const st = hard ? 'issue' : (r.st === 'review' || iss.some((i) => i.conf < LOW_CONF)) ? 'review' : 'ok';
  const ai = { st, conf: num01(r.conf) == null ? 0 : r2(num01(r.conf)), iss };
  const cat = str(r.cat, 30);
  const cats = (Array.isArray(c.cats) ? c.cats : []).map((x) => str(x, 30)).filter(Boolean);
  if (cat && (c.catMode !== 'list' || cats.includes(cat))) {
    ai.cat = cat;
    const cc = num01(r.cat_conf);
    if (cc != null) ai.catConf = r2(cc);
  }
  if (Array.isArray(r.prods)) {
    const L = [];
    for (const x of r.prods) {
      if (L.length >= 60) break;
      const n = isObj(x) ? str(x.n, 60) : '';
      if (!n) continue;
      const it = { n, c: str(x.c, 30) };
      const pid = pidOf(n, c); if (pid) it.pid = pid;
      const b = box(x.box); if (b) it.box = b;
      L.push(it);
    }
    if (L.length) ai.prods = L;
  }
  if (Array.isArray(r.miss)) {
    const L = [];
    for (const x of r.miss) {
      if (L.length >= 60) break;
      const n = isObj(x) ? str(x.n, 60) : '';
      if (!n || (x.why !== 'prev' && x.why !== 'exp')) continue;
      const it = { n, why: x.why };
      const pid = pidOf(n, c); if (pid) it.pid = pid;
      L.push(it);
    }
    if (L.length) ai.miss = L;
  }
  const recN = inR(c.recN, 0, 10) ? c.recN : 3;
  if (Array.isArray(r.recs) && recN > 0) {
    const L = [];
    for (const x of r.recs) {
      if (L.length >= recN) break;
      const t = isObj(x) ? str(x.t, 300) : '';
      if (!t) continue;
      const it = { t };
      const b = box(x.box); if (b) it.box = b;
      L.push(it);
    }
    if (L.length) ai.recs = L;
  }
  return { ai, ask: r.not_this_shelf === true, t: '' };
}
// שמות מוצרים מהתשובה, לחיפוש בקטלוג (עד 30 – מגבלת 'in' של Firestore)
function prodNames(r) {
  const out = new Set();
  for (const L of [r && r.prods, r && r.miss]) for (const x of Array.isArray(L) ? L : []) { const n = isObj(x) ? str(x.n, 60) : ''; if (n) out.add(n); }
  return [...out].slice(0, 30);
}

// ---------- s3sum (4.11) ----------
const SUM_RANK = { miss: 4, iss: 3, rev: 2, ok: 1 };
const sumOf = (st) => (st === 'ok' ? 'ok' : st === 'issue' ? 'iss' : st === 'review' ? 'rev' : 'miss');
const hardCount = (ai) => (isObj(ai) && Array.isArray(ai.iss) ? ai.iss.filter((i) => i && !i.warn).length : 0);
// הרשומה של מקטע: הגרוע מבין מקומות הצילום שלו באותו סבב (עליון/תחתון). ais = [ai של המקום הזה, ai של המקום השני או null]
function sumEntry(ais, runId, now, th, oldTh) {
  const L = ais.filter(isObj);
  let s = 'ok', n = 0;
  for (const a of L) { const x = sumOf(a.st); if (SUM_RANK[x] > SUM_RANK[s]) s = x; n += hardCount(a); }
  const e = { s, r: runId, t: now, n: Math.min(30, n) };
  const t = th || oldTh;
  if (typeof t === 'string' && t) e.th = t;
  return e;
}
const countsDone = (ai) => !!(isObj(ai) && DONE_ST.includes(ai.st));

// ---------- טיוטת מפה (4.3, 4.6) ----------
const ROUND = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : NaN);
const deg = (v) => { const a = ROUND(v); return Number.isFinite(a) ? ((a % 360) + 360) % 360 : 0; };
const DOOR_K = ['ent', 'in', 'emg', 'wh'], SYM_K = ['cash', 'ent', 'exit'], FX_K = ['gon', 'wall', 'fridge', 'table', 'stand', 'bin'], TWO = ['gon', 'table', 'stand'];
const clampI = (v, a, b) => { const x = ROUND(v); return Number.isFinite(x) && x >= a && x <= b ? x : null; };

// r = תשובת המודל, ctx = { br, kind, numDir }. מחזיר { map, drop, conf, scale, notes } או זורק fail('bad-answer') כשאין אף חדר תקין.
// פריט לא תקין לא נכנס (נספר ב-drop). אזור שהמודל לא בטוח בו נשמר ב-uz עם ok:false, כדי שהמסך יבקש מהמנהל לאשר.
function cleanDraft(r, ctx) {
  if (!isObj(r)) throw fail('bad-answer', 'הטיוטה שהתקבלה לא תקינה');
  let drop = 0;
  const list = (k, max) => { const L = Array.isArray(r[k]) ? r[k] : []; if (L.length > max) drop += L.length - max; return L.slice(0, max); };
  const rooms = [], byName = new Map();
  for (const x of list('rooms', 20)) {
    const p = isObj(x) && Array.isArray(x.p) ? x.p.map(ROUND) : null;
    const name = isObj(x) ? str(x.name, 30) || 'אולם מכירות' : '';
    if (!p || !p.every(Number.isFinite) || M.polyErr(p)) { drop++; continue; }
    const id = 'r' + (rooms.length + 1);
    rooms.push({ id, name, p, h: clampI(x.h, 200, 600) || 300 });
    if (!byName.has(name)) byName.set(name, id);
  }
  if (!rooms.length) throw fail('bad-answer', 'בטיוטה אין אף חדר תקין. נסו לצלם שוב, ממקום שרואים ממנו את כל החנות.');
  const walls = [];
  for (const x of list('walls', 100)) {
    const p = isObj(x) && Array.isArray(x.p) && x.p.length === 4 ? x.p.map((v) => clampI(v, 0, 10000)) : null;
    if (!p || p.some((v) => v == null)) { drop++; continue; }
    walls.push({ id: 'w' + (walls.length + 1), p, t: clampI(x.t, 5, 50) || 15 });
  }
  const cols = [];
  for (const x of list('cols', 100)) {
    const o = isObj(x) ? { x: clampI(x.x, 0, 10000), y: clampI(x.y, 0, 10000), w: clampI(x.w, 10, 300), d: clampI(x.d, 10, 300) } : null;
    if (!o || Object.values(o).some((v) => v == null)) { drop++; continue; }
    cols.push(Object.assign({ id: 'c' + (cols.length + 1) }, o, { rnd: x.rnd === true }));
  }
  const doors = [];
  for (const x of list('doors', 40)) {
    const o = isObj(x) ? { x: clampI(x.x, 0, 10000), y: clampI(x.y, 0, 10000), w: clampI(x.w, 60, 500) } : null;
    if (!o || Object.values(o).some((v) => v == null) || !DOOR_K.includes(x.k)) { drop++; continue; }
    doors.push(Object.assign({ id: 'd' + (doors.length + 1) }, o, { a: deg(x.a), k: x.k }));
  }
  const fx = [];
  let bays = 0;
  for (const x of list('fx', 400)) {
    const o = isObj(x) ? { x: clampI(x.x, 0, 10000), y: clampI(x.y, 0, 10000), w: clampI(x.w, 30, 2000), d: clampI(x.d, 20, 300), h: clampI(x.h, 30, 300), bays: clampI(x.bays, 1, 30), lvl: clampI(x.lvl, 1, 12) } : null;
    if (!o || Object.values(o).some((v) => v == null) || !FX_K.includes(x.k)) { drop++; continue; }
    const sides = x.sides === 2 && TWO.includes(x.k) ? 2 : 1;
    if (bays + sides * o.bays > M.MAX_BAYS) { drop++; continue; }
    bays += sides * o.bays;
    const room = byName.get(str(x.room, 30)) || rooms[0].id;
    const f = { id: 'f' + (fx.length + 1), k: x.k, x: o.x, y: o.y, w: o.w, d: o.d, h: o.h, a: deg(x.a), sides, bays: o.bays, lvl: o.lvl, hi: o.lvl >= 6, room, num: fx.length + 1 };
    if (x.glass === true) f.glass = true;
    const nm = str(x.name, 30); if (nm) f.name = nm;
    fx.push(f);
  }
  const syms = [];
  for (const x of list('syms', 40)) {
    const o = isObj(x) ? { x: clampI(x.x, 0, 10000), y: clampI(x.y, 0, 10000) } : null;
    if (!o || o.x == null || o.y == null || !SYM_K.includes(x.k)) { drop++; continue; }
    syms.push({ id: 'y' + (syms.length + 1), k: x.k, x: o.x, y: o.y, a: deg(x.a) });
  }
  const uz = [];
  for (const x of list('uz', 50)) {
    const o = isObj(x) ? { x: clampI(x.x, 0, 10000), y: clampI(x.y, 0, 10000), w: clampI(x.w, 50, 10000), d: clampI(x.d, 50, 10000) } : null;
    if (!o || Object.values(o).some((v) => v == null)) { drop++; continue; }
    uz.push(Object.assign(o, { txt: str(x.txt, 80), ok: false }));
  }
  const map = {
    br: ctx.br, kind: ctx.kind, name: ctx.kind === 'w' ? 'מחסן (טיוטה)' : 'חנות (טיוטה)', seq: fx.length, grid: 50, numDir: ctx.numDir === 'ltr' ? 'ltr' : 'rtl',
    rooms, walls, cols, doors, fx, syms, uz, src: 'draft',
  };
  const ent = doors.find((d) => d.k === 'ent');
  if (ent) map.ent = ent.id;
  const sc = isObj(r.scale) ? { ref: str(r.scale.ref, 120), conf: num01(r.scale.conf) == null ? 0 : r2(num01(r.scale.conf)) } : { ref: '', conf: 0 };
  return { map, drop, conf: num01(r.conf) == null ? 0 : r2(num01(r.conf)), scale: sc, notes: str(r.notes, 200) };
}

const israelMonth = (day) => String(day).slice(0, 7);
const validAt = (t, now) => Number.isInteger(t) && t >= MIN_T && t <= MAX_T && t <= now + 120000;

module.exports = {
  ISSUE_KINDS, PRICE_KINDS, STATUSES, DONE_ST, LOW_CONF, IMG, THUMB, DRAFT, RE_SLOT,
  ADHOC_DAY: 20, DRAFT_DAY_MAX, decodeJpeg, draftImgs, checkSlot, quotaStep, draftDayStep, refundStep, refundDay, shelfBroken, cleanShelf, prodNames, pidOf, norm, box, sumEntry, sumOf, countsDone, cleanDraft,
  israelMonth, validAt, fail,
};
