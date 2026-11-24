'use strict';
// גיטי – הרשאות פעולה (24.11.2026, "גיטי מנהלת עסק", סבב 4 חלק א, החלטות 1–5, 12).
//   sec_cfg/perm { t: { task, rem, msg, ord, tag: 'no'|'ask'|'auto' }, cap1, capD, anPct, anMin, upd, updBy } – שרת בלבד (secPrefs op:'perm' / op:'permCard').
//     אין מסמך / אין שדה = ברירת המחדל: כל סוג "רק אחרי אישור" (ask), תקרה 500 ₪ לפעולה ו-2,000 ₪ ליום,
//     ספי הוצאה חריגה לחלק ב: 30% ו-200 ₪. רק מנהל־העל משנה (במסך, או בכרטיס אישור מהצ'אט).
//   sec_cfg/use.pa { d: 'YYYY-MM-DD', s: סכום } – מה שגיטי ביצעה לבד היום (לתקרה היומית). נכתב רק ב-takeAuto.
//
// הפונקציה המשותפת: decide(p, type, { amount, dayUsed }) → { r: 'no'|'ask'|'auto', why }
//   'no'   – אסור: לא מבצעים וגם לא מציעים.
//   'ask'  – רק אחרי אישור: מותר להציע (כרטיס / טיוטה), לא לבצע לבד.
//   'auto' – לבד: רק כשהסוג הוגדר "לבד" וגם הסכום בתוך התקרה לפעולה ובתוך התקרה היומית.
//   סוג שלא ברשימה (כולל תשלום / העברת כסף) – תמיד 'no'. אין ואין להוסיף סוג תשלום.
//
// מנגנונים קיימים שהמנהל כבר הדליק כ"לבד" (מענה אוטומטי במייל, הכללים שלי, פתיחה/"קיבלנו" בווצאפ, שליחת טיוטת הזמנה ללקוח):
//   ממשיכים לפעול כל עוד הסוג לא הוגדר "אסור" (legacyOk) – הנחה שנבחרה בסבב 4, כדי לא לשנות התנהגות קיימת כברירת מחדל.
//
// נקודת חיבור לחלק ב (טיוטת הזמנה מספק): canPropose(p, 'ord') לפני יצירת טיוטה; takeAuto(db, 'ord', סכום) אם בעתיד יהיה ביצוע לבד.

const TYPES = Object.freeze({ task: 'משימה', rem: 'תזכורת', msg: 'שליחת הודעה (ווצאפ / מייל)', ord: 'טיוטת הזמנה מספק', tag: 'תיוג / סיווג הוצאה' });
const KEYS = Object.freeze(Object.keys(TYPES));
const LEVELS = Object.freeze(['no', 'ask', 'auto']);
const LV_L = Object.freeze({ no: 'אסור', ask: 'רק אחרי אישור', auto: 'לבד' });
const AMT_TYPES = Object.freeze(['ord', 'tag']); // סוגים שתמיד יש להם סכום – בלי סכום תקין: אישור
const DEF = Object.freeze({ lvl: 'ask', cap1: 500, capD: 2000, anPct: 30, anMin: 200 });
// גבולות להקלדה: תקרה לפעולה עד 100,000 ₪, יומית עד 1,000,000 ₪; חריגה 1%–500%; מינימום חריגה עד 1,000,000 ₪
const LIM = Object.freeze({ cap1: [0, 100000], capD: [0, 1000000], anPct: [1, 500], anMin: [0, 1000000] });
const NUMS = Object.freeze(Object.keys(LIM));
const NUM_L = Object.freeze({ cap1: 'תקרת סכום לפעולה', capD: 'תקרת סכום ליום', anPct: 'סף הוצאה חריגה (%)', anMin: 'מינימום להוצאה חריגה' });
const TZ = 'Asia/Jerusalem';
const own = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
const dayKey = (ms) => new Date(ms).toLocaleString('sv-SE', { timeZone: TZ }).slice(0, 10);

// ההגדרות האפקטיביות מתוך נתוני המסמך (או null). ערך לא תקין = ברירת המחדל
function permOf(data) {
  const d = data && typeof data === 'object' ? data : {};
  const lv = d.t && typeof d.t === 'object' && !Array.isArray(d.t) ? d.t : {};
  const t = {};
  for (const k of KEYS) t[k] = own(lv, k) && LEVELS.includes(lv[k]) ? lv[k] : DEF.lvl;
  const out = { t };
  for (const k of NUMS) out[k] = typeof d[k] === 'number' && Number.isFinite(d[k]) && d[k] >= LIM[k][0] && d[k] <= LIM[k][1] ? d[k] : DEF[k];
  return out;
}

// ההחלטה – טהורה. p = permOf(...); o = { amount?, dayUsed? } (₪). סכום שלילי (זיכוי) – לפי הערך המוחלט
function decide(p, type, o) {
  const P = p && p.t ? p : permOf(null);
  if (typeof type !== 'string' || !KEYS.includes(type)) return { r: 'no', why: 'type' };
  const lv = P.t[type];
  if (lv === 'no') return { r: 'no', why: 'perm' };
  if (lv !== 'auto') return { r: 'ask', why: 'perm' };
  const x = o || {};
  const has = x.amount !== undefined && x.amount !== null;
  if (!has) return AMT_TYPES.includes(type) ? { r: 'ask', why: 'amount' } : { r: 'auto', why: '' };
  if (typeof x.amount !== 'number' || !Number.isFinite(x.amount)) return { r: 'ask', why: 'amount' };
  const a = Math.abs(x.amount);
  if (a > P.cap1) return { r: 'ask', why: 'cap1' };
  const used = typeof x.dayUsed === 'number' && Number.isFinite(x.dayUsed) && x.dayUsed > 0 ? x.dayUsed : 0;
  if (used + a > P.capD) return { r: 'ask', why: 'capD' };
  return { r: 'auto', why: '' };
}
// מותר להציע (כרטיס / טיוטה לאישור)? – כל עוד לא "אסור"
const canPropose = (p, type) => decide(p, type).r !== 'no';
// מנגנון קיים שהמנהל כבר הדליק כ"לבד" – ממשיך כל עוד הסוג לא "אסור" (ראו למעלה)
const legacyOk = (p, type) => decide(p, type).r !== 'no';

// שינוי אחד (מהמסך או מכרטיס בצ'אט): { type, lvl } או { num: 'cap1'|'capD'|'anPct'|'anMin', v }.
// מחזיר { set: נתונים למיזוג במסמך, note: לרישום ביומן } או זורק { badPerm: קוד }. סוג תשלום / לא מוכר – נדחה
function applyChange(cur, ch) {
  const P = cur && cur.t ? cur : permOf(null);
  const c = ch && typeof ch === 'object' && !Array.isArray(ch) ? ch : null;
  const fail = (code) => { const e = new Error(code); e.badPerm = code; throw e; };
  if (!c) fail('bad-input');
  if (c.type !== undefined) {
    if (typeof c.type !== 'string' || !KEYS.includes(c.type)) fail('bad-type');
    if (typeof c.lvl !== 'string' || !LEVELS.includes(c.lvl)) fail('bad-level');
    return { set: { t: { [c.type]: c.lvl } }, note: c.type + ':' + P.t[c.type] + '>' + c.lvl, same: P.t[c.type] === c.lvl };
  }
  if (c.num !== undefined) {
    if (typeof c.num !== 'string' || !NUMS.includes(c.num)) fail('bad-type');
    const v = c.v;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < LIM[c.num][0] || v > LIM[c.num][1]) fail('bad-amount');
    const r = Math.round(v);
    return { set: { [c.num]: r }, note: c.num + ':' + P[c.num] + '>' + r, same: P[c.num] === r };
  }
  return fail('bad-input');
}
// תיאור שינוי בעברית (כרטיס בצ'אט)
function changeText(cur, ch) {
  const P = cur && cur.t ? cur : permOf(null);
  if (ch && ch.type) return TYPES[ch.type] + ': ' + LV_L[P.t[ch.type]] + ' ← ' + LV_L[ch.lvl];
  if (ch && ch.num) { const u = ch.num === 'anPct' ? '%' : ' ₪'; return NUM_L[ch.num] + ': ' + P[ch.num].toLocaleString('he-IL') + u + ' ← ' + Math.round(ch.v).toLocaleString('he-IL') + u; }
  return '';
}

// ---------- הוראה בצ'אט ("תני לעצמך לשלוח הודעות לבד", "תעלי את התקרה ל-1000") – זיהוי בלי AI ----------
// מחזיר null (לא הוראת הרשאה – השיחה ממשיכה כרגיל) | { pay: true } | { change } | { bad: 'range', num }
const PAY_RE = /(תשלו?ם|תשלומים|לשלם|ישלם|תשלמי|העבר(ת|ות)\s*(ה)?כסף|העברה בנקאית|העברות בנקאיות|העברת כספים|להעביר כסף|תעבירי כסף|pay(ment)?s?\b|transfer money)/i;
const PAY_ASK_RE = /(הרשא|לעצמך|מותר לך|רשאית|לבד|בעצמך|בלי לשאול|בלי אישור|תאפשרי|לאפשר|תוסיפי|להוסיף)/;
const INTENT_RE = /(תני לעצמך|תרשי לעצמך|לעצמך|מותר לך|אסור לך|את רשאית|רשאית|הרשא|תפסיקי|מעכשיו|מעתה|מהיום|תמיד|לעולם|אף פעם|בלי לשאול|בלי אישור|רק (אחרי |ב)אישור)/;
const TYPE_RE = [['msg', /(הודע|ווטסאפ|וואטסאפ|ווצאפ|וואצאפ|whatsapp|מייל|אימייל|דוא"ל)/i], ['task', /משימ/], ['rem', /תזכור/], ['ord', /(הזמנ\S* (מ|ל|אצל )?ספק|הזמנות לספק|טיוט\S* הזמנ|הזמנות רכש|הזמנת רכש)/], ['tag', /(תיוג|לתייג|תתייגי|סיווג|לסווג|תסווגי|קטגורי)/]];
const NO_RE = /(אסור|תפסיקי|בכלל לא|לעולם לא|אף פעם לא|חסמי|לחסום|לא מותר)/;
const ASK_RE = /(רק (אחרי |ב)אישור|באישור|אחרי אישור|תשאלי|לשאול אותי|לא לבד|אל ת\S+ לבד)/;
const AUTO_RE = /(לבד|בעצמך|בלי לשאול|בלי אישור|אוטומטי)/;
const CAP_RE = /(תקרה|תקרת|התקרה)/;
const NOT_PERM_CAP_RE = /(חודשי|עלות|שימוש|ניצול|\$|דולר|AI|בינה)/i; // תקרת העלות של המזכירה – לא כאן (מנהל־על, secAdminSetCfg)
function numIn(text) {
  const m = /(\d[\d,]*(?:\.\d+)?)\s*(אלף|k)?/i.exec(text);
  if (!m) return null;
  let v = Number(m[1].replace(/,/g, ''));
  if (m[2]) v *= 1000;
  return Number.isFinite(v) ? v : null;
}
function parseChat(text) {
  const s = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().slice(0, 400) : '';
  if (!s) return null;
  const intent = INTENT_RE.test(s);
  // תשלום / העברת כסף – רק כשמבקשים הרשאה ("תני לעצמך לשלם", "הרשאה לתשלומים"), לא שאלה רגילה על תשלומים
  // (תזכורת לשלם – לא בקשת הרשאה; ממשיכה לשיחה הרגילה)
  if (PAY_RE.test(s) && !/תזכ/.test(s) && PAY_ASK_RE.test(s)) return { pay: true };
  // תקרות (לפעולה / ליום) וספי הוצאה חריגה
  if (CAP_RE.test(s) && !NOT_PERM_CAP_RE.test(s) && /(תעלי|תורידי|תשני|שני|קבעי|תקבעי|להעלות|להוריד|לשנות|לקבוע|העלי|הורידי)/.test(s)) {
    const v = numIn(s);
    if (v === null) return null;
    const num = /(יומי|ליום|ביום|ליומית)/.test(s) ? 'capD' : 'cap1';
    if (v < LIM[num][0] || v > LIM[num][1]) return { bad: 'range', num };
    return { change: { num, v: Math.round(v) } };
  }
  if (/חריג/.test(s) && /(סף|תשני|שני|קבעי|תקבעי|תעלי|תורידי)/.test(s)) {
    const v = numIn(s);
    if (v === null) return null;
    const num = /%|אחוז/.test(s) ? 'anPct' : 'anMin';
    if (v < LIM[num][0] || v > LIM[num][1]) return { bad: 'range', num };
    return { change: { num, v: Math.round(v) } };
  }
  if (!intent) return null;
  const tp = TYPE_RE.find((x) => x[1].test(s));
  if (!tp) return null;
  const lvl = NO_RE.test(s) ? 'no' : ASK_RE.test(s) ? 'ask' : AUTO_RE.test(s) ? 'auto' : '';
  if (!lvl) return null; // בלי רמה ברורה – לא הוראת הרשאה (למשל הוראת ניתוב "חשבוניות מהיום – לקטגוריה…"); השיחה ממשיכה כרגיל
  return { change: { type: tp[0], lvl } };
}

// ---------- גישה למסד ----------
async function readPerm(db) {
  const s = await db.doc('sec_cfg/perm').get();
  return permOf(s.exists ? s.data() : null);
}
// ביצוע לבד עם סכום (לחלק ב ואילך): ההחלטה והמונה היומי באותה טרנזקציה – שתי פעולות בו-זמנית לא עוברות את התקרה היומית.
// מחזיר את ההחלטה; רק 'auto' מוסיף את הסכום למונה
async function takeAuto(db, type, amount, now) {
  const t = now || Date.now();
  const day = dayKey(t);
  return db.runTransaction(async (tx) => {
    const [ps, us] = await Promise.all([tx.get(db.doc('sec_cfg/perm')), tx.get(db.doc('sec_cfg/use'))]);
    const pa = us.exists && us.get('pa') && typeof us.get('pa') === 'object' ? us.get('pa') : {};
    const used = pa.d === day && Number.isFinite(pa.s) ? pa.s : 0;
    const r = decide(permOf(ps.exists ? ps.data() : null), type, { amount, dayUsed: used });
    if (r.r === 'auto' && typeof amount === 'number') tx.set(db.doc('sec_cfg/use'), { pa: { d: day, s: used + Math.abs(amount) } }, { merge: true });
    return Object.assign({ used }, r);
  });
}
// מנגנון קיים חסום? (קריאה טרייה, ממש לפני הביצוע) – רק כשהסוג הוגדר "אסור"
async function blocked(db, type) { return !legacyOk(await readPerm(db), type); }
const NO_LABEL = 'מנהל־העל הגדיר: שליחת הודעות – אסור';
// למסך ההגדרות (secState): הערכים, השמות והאם מותר לשנות
function stateOf(p, edit) {
  return { t: Object.assign({}, p.t), cap1: p.cap1, capD: p.capD, anPct: p.anPct, anMin: p.anMin, edit: !!edit,
    types: KEYS.map((k) => ({ k, l: TYPES[k] })), lv: LEVELS.map((k) => ({ k, l: LV_L[k] })), lim: LIM };
}

module.exports = { blocked, NO_LABEL, TYPES, KEYS, LEVELS, LV_L, DEF, LIM, NUMS, NUM_L, AMT_TYPES, permOf, decide, canPropose, legacyOk, applyChange, changeText, parseChat, readPerm, takeAuto, stateOf, dayKey };
