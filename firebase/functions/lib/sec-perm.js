'use strict';
// גיטי – הרשאות לפי סוג פעולה, לכל מנהל בנפרד (24.11.2026, "גיטי מנהלת עסק", סבב 4 חלק א; עדכון המשתמש: כל מנהל מגדיר לעצמו).
//   מה גיטי רשאית לעשות לבד בשם המנהל, לכל סוג פעולה: auto (לבד) / approve (מכינה ואני מאשר) / deny (אסור), ובפעולה כספית – תקרת סכום (₪).
//   נשמר במסמך הקיים sec_cfg/main, בתוך הרשומה האישית של המנהל (mgr.<uid>) – בלי אוסף חדש ובלי מיגרציה (אין שדה = "טרם הוגדר"):
//     mgr.<uid>.perm { <סוג>: { m: 'auto'|'approve'|'deny', cap?: ₪ (רק בסוג כספי), t } } – רק המנהל עצמו משנה (secPrefs op:'perm', לפי uid בשרת), כל שינוי ביומן
//     mgr.<uid>.pq   { <סוג>: { t, n, note } }                                           – "שאלה בפעם הראשונה" שממתינה למנהל הזה (מרכז האישורים שלו)
//   ההגדרה של מנהל אחד לא חלה על מנהל אחר. כל פעולה לבד נבדקת לפי ההרשאות של המנהל שבשמו היא נעשית ("בעלים"):
//     כלל אישי – בעל הכלל; כלל מענה במייל – מי שאישר אותו; שליחה לבד ללקוח – מי שהפעיל אותה; חשבונית – המנהל שהמכשיר שלו מכניס אותה.
//     אין בעלים ידוע – לאישור (בלי שאלה).
//   ההחלטה (decide) – ממש לפני הביצוע (קריאה טרייה של sec_cfg/main):
//     deny → לא מבוצע לבד; approve → נשאר לאישור (הטיוטה / החשבונית / הכרטיס במנגנון הקיים);
//     auto → רק אם "עצור הכל" כבוי, ובסוג כספי – רק עם סכום ידוע ועד התקרה; אחרת – לאישור.
//     בלי הגדרה → ask: נרשמת שאלה לאותו מנהל (ask) והפעולה עצמה – לאישור (כמו approve).
//   ברמת העסק וקבוע: "עצור הכל", תקרת העלות (מנגנונים קיימים), "הזמנה מספק" – תמיד באישור (גם אם נשמר "לבד" בטעות).
//   סוג שאין לגיטי עדיין דרך לבצע לבד (auto:false) – "לבד" לא נשמר. "לבד" לא עוקף שום בדיקה קיימת (כללי הבטיחות, מכסות) – רק תנאי נוסף.

const TYPES = Object.freeze({
  task: Object.freeze({ l: 'יצירת משימה', auto: false }),
  rem: Object.freeze({ l: 'תזכורת', auto: false }),
  mail: Object.freeze({ l: 'שליחת מייל', auto: true }),
  wa: Object.freeze({ l: 'הודעת ווצאפ', auto: true }),
  fin: Object.freeze({ l: 'רישום הוצאה / הכנסה', auto: true, money: true }),
  cmt: Object.freeze({ l: 'אישור התחייבות', auto: false }),
  ord: Object.freeze({ l: 'הזמנה מספק', auto: false, money: true, fixed: 'approve' }),
  app: Object.freeze({ l: 'פעולה על הודעה מאפליקציה / SMS', auto: true }),
});
const KEYS = Object.freeze(Object.keys(TYPES));
const MODES = Object.freeze(['auto', 'approve', 'deny']);
const SCOPES = Object.freeze(['always', 'once', 'again']); // תמיד כך / רק הפעם / לשאול שוב בפעם הבאה
const CAP_MAX = 10000000; // ₪ – גבול עליון סביר להקלדה שגויה
const UID_RE = /^[A-Za-z0-9_-]{1,128}$/;
// סיבות (נרשמות ביומן ובטיוטה כמו שאר סיבות "לא נשלח לבד")
const WHY = Object.freeze({
  pmAsk: 'טרם הוגדרה הרשאה לסוג הפעולה – גיטי שאלה את המנהל, ובינתיים באישור',
  pmApr: 'לפי מסך ההרשאות – מכינה והמנהל מאשר',
  pmDeny: 'לפי מסך ההרשאות – אסור לגיטי לבצע את הפעולה לבד',
  pmCap: 'הסכום מעל התקרה שנקבעה במסך ההרשאות (או שאינו ידוע)',
  pmStop: '"עצור הכל" פעיל',
  pmOwner: 'לא ידוע באיזה מנהל לבדוק את ההרשאה – באישור',
});

const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
const capOk = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= CAP_MAX;
const uidOk = (u) => typeof u === 'string' && UID_RE.test(u);
const mine = (d, uid) => (uidOk(uid) ? obj(obj(obj(d).mgr)[uid]) : {});

// ההגדרות השמורות של מנהל אחד, מנוקות: רק סוגים מוכרים ומצבים תקינים. רשומה לא תקינה = "טרם הוגדר". d – המסמך sec_cfg/main
function permOf(d, uid) {
  const p = obj(mine(d, uid).perm), out = {};
  for (const k of KEYS) {
    const e = obj(p[k]);
    if (!MODES.includes(e.m)) continue;
    const o = { m: e.m };
    if (TYPES[k].money && capOk(e.cap)) o.cap = e.cap;
    if (Number.isFinite(e.t)) o.t = e.t;
    out[k] = o;
  }
  return out;
}
// שאלות שממתינות למנהל הזה (רק לסוגים שעדיין לא הוגדרו אצלו)
function pqOf(d, uid) {
  const q = obj(mine(d, uid).pq), p = permOf(d, uid), out = {};
  for (const k of KEYS) {
    if (p[k]) continue;
    const e = obj(q[k]);
    if (!Number.isFinite(e.t)) continue;
    out[k] = { t: e.t, n: Number.isInteger(e.n) && e.n > 0 ? e.n : 1, note: typeof e.note === 'string' ? e.note.slice(0, 120) : '' };
  }
  return out;
}

// ההחלטה. d – המסמך sec_cfg/main; uid – המנהל שבשמו הפעולה; o = { amount (₪, בסוג כספי), stop ("עצור הכל") }.
// מחזיר { d: 'auto'|'approve'|'deny'|'ask', why: '' | מפתח ב-WHY }. d==='auto' הוא היחיד שמתיר ביצוע לבד
function decide(d, uid, type, o) {
  const t = TYPES[type];
  if (!t) return { d: 'deny', why: 'pmDeny' }; // סוג לא מוכר – לא מבצעים לבד
  if (!uidOk(uid)) return { d: 'approve', why: 'pmOwner' };
  const p = permOf(d, uid)[type];
  const x = o || {};
  if (!p) return { d: 'ask', why: 'pmAsk' };
  if (p.m === 'deny') return { d: 'deny', why: 'pmDeny' };
  if (t.fixed === 'approve' || p.m === 'approve' || !t.auto) return { d: 'approve', why: 'pmApr' };
  if (x.stop) return { d: 'approve', why: 'pmStop' };
  if (t.money) {
    const a = x.amount;
    if (!(typeof a === 'number' && Number.isFinite(a)) || !capOk(p.cap) || Math.abs(a) > p.cap) return { d: 'approve', why: 'pmCap' };
  }
  return { d: 'auto', why: '' };
}
const isAuto = (d, uid, type, o) => decide(d, uid, type, o).d === 'auto';

// בדיקת בקשת שינוי (secPrefs op:'perm'). uid – המנהל המחובר (מהשרת). אפשר לשנות רק את ההגדרות של עצמך:
// input.uid (אם נשלח) חייב להיות אותו uid. זורק Error עם code בשגיאה.
// input = { type, m: 'auto'|'approve'|'deny'|'unset', scope: 'always'|'once'|'again', cap? }
// מחזיר { uid, type, m, scope, cap?, save } – save=true רק ב"תמיד כך" (או "unset" – מחיקת ההגדרה)
function parseSet(input, uid) {
  const err = (code, msg) => { const e = new Error(msg); e.code = code; throw e; };
  const i = obj(input);
  if (!uidOk(uid)) err('not-allowed', 'לא מזוהה מנהל');
  if (i.uid !== undefined && i.uid !== uid) err('not-yours', 'אפשר לשנות רק את ההרשאות שלך');
  const type = typeof i.type === 'string' && Object.hasOwn(TYPES, i.type) ? i.type : null;
  if (!type) err('bad-input', 'סוג פעולה לא מוכר');
  const t = TYPES[type];
  if (i.m === 'unset') return { uid, type, m: 'unset', scope: 'always', save: true };
  if (!MODES.includes(i.m)) err('bad-input', 'מצב לא תקין');
  const scope = SCOPES.includes(i.scope) ? i.scope : 'always';
  if (i.m === 'auto' && (!t.auto || t.fixed)) err('no-auto', t.fixed ? 'הזמנה מספק תמיד באישור' : 'בסוג הזה גיטי עדיין לא יכולה לבצע לבד – אפשר "מכינה ואני מאשר" או "אסור"');
  const out = { uid, type, m: i.m, scope, save: scope === 'always' };
  if (t.money && i.m === 'auto') {
    if (!capOk(i.cap)) err('bad-cap', 'צריך לקבוע עד איזה סכום (₪) גיטי רשאית לבד');
    out.cap = Math.round(i.cap * 100) / 100;
  }
  return out;
}
const noteOf = (s) => 'm=' + s.m + (s.cap !== undefined ? ',cap=' + s.cap : '') + ',scope=' + s.scope;
// שדות העדכון במסמך sec_cfg/main (update עם נתיבי שדות – מחליף רק את הרשומה של הסוג הזה אצל המנהל הזה). del – FieldValue.delete()
function updOf(s, now, del) {
  const base = 'mgr.' + s.uid + '.';
  const up = { [base + 'pq.' + s.type]: del };
  if (s.m === 'unset') up[base + 'perm.' + s.type] = del;
  else if (s.save) up[base + 'perm.' + s.type] = Object.assign({ m: s.m, t: now }, s.cap !== undefined ? { cap: s.cap } : {});
  return up;
}

// "שאלה בפעם הראשונה" למנהל uid: נרשמת פעם אחת לכל סוג (כל עוד לא נענתה), עם מונה כמה פעמים גיטי הגיעה אליה. רישום ביומן – רק בפעם הראשונה.
// db – מסד העסק. שורת היומן – באותו מבנה כמו logData ב-secretary.js. לא זורק (תקלה כאן לא עוצרת את הפעולה – היא ממילא נשארת לאישור)
async function ask(db, uid, type, note) {
  if (!TYPES[type] || !uidOk(uid)) return false;
  try {
    const ref = db.doc('sec_cfg/main');
    return await db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      const d = s.exists ? s.data() || {} : {};
      if (!s.exists || !obj(obj(d.mgr)[uid]).cv) return false; // לא מנהל שאישר את התנאים – לא שואלים
      if (permOf(d, uid)[type]) return false; // בינתיים הוגדר
      const cur = obj(obj(mine(d, uid).pq)[type]);
      const first = !Number.isFinite(cur.t);
      const n = (Number.isInteger(cur.n) ? cur.n : 0) + 1;
      tx.update(ref, { ['mgr.' + uid + '.pq.' + type]: { t: first ? Date.now() : cur.t, n, note: String(note || cur.note || '').slice(0, 120) } });
      if (first) tx.set(db.collection('sec_log').doc(), { t: Date.now(), by: uid, who: 'auto', act: 'permAsk', ch: 'app', tgt: type, note: String(note || '').slice(0, 120) });
      return first;
    });
  } catch (e) { return false; }
}

// לנקודות הביצוע: '' = מותר לבד; אחרת קוד הסיבה (WHY). בלי הגדרה – גם רושם שאלה לאותו מנהל. d – sec_cfg/main (קריאה טרייה)
async function blockWhy(db, d, uid, type, o, note) {
  const r = decide(d, uid, type, o);
  if (r.d === 'auto') return '';
  if (r.d === 'ask') await ask(db, uid, type, note);
  return r.why;
}

// לאפליקציה (secState): ההגדרות והשאלות הפתוחות של המנהל המחובר, ושמות הסוגים
function stateOf(d, uid) {
  return {
    edit: uidOk(uid), m: permOf(d, uid), q: pqOf(d, uid),
    types: KEYS.map((k) => ({ k, l: TYPES[k].l, auto: TYPES[k].auto && !TYPES[k].fixed, money: !!TYPES[k].money, fixed: TYPES[k].fixed || '' })),
  };
}

// --- קודי אימות וסיסמאות (OTP) – לא נשמרים ולא נשלחים ל-AI. אותו כלל כמו isOtp ב-sec-notif.js וב-LpNotifListen.java ---
const OTP_KW = /(קוד\s*(ה)?(אימות|זיהוי|כניסה|חד[\s-]?פעמי|סודי|גישה)|סיסמ[אה]\s*(חד[\s-]?פעמית|זמנית)?|סיסמתך|קוד\s*ה?OTP|\bOTP\b|verification\s*code|security\s*code|one[\s-]?time\s*(pass(word|code)?|code|pin)|\bpasscode\b|\bpassword\b|login\s*code|auth(entication)?\s*code|\b2FA\b|confirmation\s*code|your\s*code\s*is|is\s+your\s+(\w+\s+)?code|\bcode\s*[:：]|הקוד\s*(שלך|שלכם|הוא)|קוד\s*[:：]|\bPIN\b|\bG-\d{6}\b)/i;
const OTP_NUM = /(^|[^\d])\d{4,8}([^\d]|$)|\b[A-Z0-9]{3,4}-[A-Z0-9]{3,4}\b/;
function isOtp(text, title) {
  const s = String(title || '') + ' ' + String(text || '');
  if (!OTP_KW.test(s)) return false;
  return OTP_NUM.test(s) || /סיסמ|password|passcode/i.test(s);
}

module.exports = { TYPES, KEYS, MODES, SCOPES, CAP_MAX, WHY, permOf, pqOf, decide, isAuto, parseSet, noteOf, updOf, ask, blockWhy, stateOf, isOtp };
