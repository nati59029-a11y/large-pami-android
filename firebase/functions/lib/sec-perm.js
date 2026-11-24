'use strict';
// גיטי – הרשאות לפי סוג פעולה, לכל מנהל בנפרד (24.11.2026, "גיטי מנהלת עסק", סבב 4 חלק א; עדכון המשתמש: כל מנהל מגדיר לעצמו).
//   מה גיטי רשאית לעשות לבד בשם המנהל, לכל סוג פעולה: auto (לבד) / approve (מכינה ואני מאשר) / deny (אסור), ובפעולה כספית – תקרת סכום (₪).
//   נשמר במסמך נפרד לכל מנהל – sec_perm/{uid} { perm: { <סוג>: { m, cap?, t } }, pq: { <סוג>: { t, n, note } }, upd }.
//   השרת בלבד קורא וכותב (firestore.rules: אף אחד מהאפליקציה – גם לא מנהל אחר); האפליקציה מקבלת רק את של המנהל המחובר דרך secState.
//   אין מסמך = "טרם הוגדר". תיקון סבב 1 (ליקוי 4): גרסה קודמת בענף שמרה ב-sec_cfg/main.mgr.<uid>.perm/pq (קריא לכל המנהלים) –
//   נקרא משם כגיבוי אם אין מסמך חדש, ובכתיבה הראשונה מועבר למסמך החדש ונמחק מהמיקום הישן (באותה טרנזקציה – בלי לאבד הגדרה).
//   שינוי: רק המנהל עצמו (secPrefs op:'perm', לפי uid בשרת), כל שינוי ביומן. "שאלה בפעם הראשונה" – pq של אותו מנהל (מרכז האישורים שלו).
//   ההגדרה של מנהל אחד לא חלה על מנהל אחר. כל פעולה לבד נבדקת לפי ההרשאות של המנהל שבשמו היא נעשית ("בעלים"):
//     כלל אישי – בעל הכלל; כלל מענה במייל – מי שאישר אותו, ואם לא נשמר – מי שהפעיל את המענה האוטומטי במייל; שליחה לבד ללקוח – מי שהפעיל אותה;
//     חשבונית – המנהל שהמכשיר שלו מכניס אותה. אין בעלים ידוע – לאישור (בלי שאלה, בלי נפילה למנהל הראשי).
//   ההחלטה (decide) – ממש לפני הביצוע (קריאה טרייה):
//     deny → לא מבוצע לבד; approve → נשאר לאישור (הטיוטה / החשבונית / הכרטיס במנגנון הקיים);
//     auto → רק אם "עצור הכל" כבוי, ובסוג כספי – רק עם סכום ידוע ועד התקרה; אחרת – לאישור.
//     בלי הגדרה → ask: נרשמת שאלה לאותו מנהל (ask) והפעולה עצמה – לאישור (כמו approve).
//   ברמת העסק וקבוע: "עצור הכל", תקרת העלות (מנגנונים קיימים), "הזמנה מספק" – תמיד באישור (גם אם נשמר "לבד" בטעות).
//   החלטות המשתמש (24.11.2026): (1) התשובה הראשונה חלה מיד גם על הפריט שעורר את השאלה (pq.<סוג>.ref – האפליקציה מבצעת / מבטלת אותו);
//   (2) "לבד" גם למשימה, תזכורת והתחייבות; (3) כלל שכבר סומן "לבד" לפני הפריסה – מיגרציה עצלה ל"לבד, תמיד" לסוג שלו בלבד (legacyAuto).
//   סוג שאין לגיטי דרך לבצע לבד (auto:false) – "לבד" לא נשמר. "לבד" לא עוקף שום בדיקה קיימת (כללי הבטיחות, מכסות) – רק תנאי נוסף.

const TYPES = Object.freeze({
  task: Object.freeze({ l: 'יצירת משימה', auto: true }), // 24.11.2026 (החלטת המשתמש 2): "לבד" גם למשימה, תזכורת והתחייבות
  rem: Object.freeze({ l: 'תזכורת', auto: true }),
  mail: Object.freeze({ l: 'שליחת מייל', auto: true }),
  wa: Object.freeze({ l: 'הודעת ווצאפ', auto: true }),
  fin: Object.freeze({ l: 'רישום הוצאה / הכנסה', auto: true, money: true }),
  cmt: Object.freeze({ l: 'אישור התחייבות', auto: true }),
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
const COLL = 'sec_perm';
const DEL = () => require('firebase-admin/firestore').FieldValue.delete(); // רק בהעברה מהמיקום הישן

// הרשומה של מנהל אחד: { perm, pq } – מהמסמך sec_perm/{uid} (או מהמיקום הישן mgr.<uid>)
// ההגדרות השמורות, מנוקות: רק סוגים מוכרים ומצבים תקינים. רשומה לא תקינה = "טרם הוגדר"
function permOf(rec) {
  const p = obj(obj(rec).perm), out = {};
  for (const k of KEYS) {
    const e = obj(p[k]);
    if (!MODES.includes(e.m)) continue;
    const o = { m: e.m };
    if (TYPES[k].money && capOk(e.cap)) o.cap = e.cap;
    if (Number.isFinite(e.t)) o.t = e.t;
    if (e.mig === 1) o.mig = 1;
    out[k] = o;
  }
  return out;
}
// שאלות שממתינות למנהל (רק לסוגים שעדיין לא הוגדרו אצלו)
function pqOf(rec) {
  const q = obj(obj(rec).pq), p = permOf(rec), out = {};
  for (const k of KEYS) {
    if (p[k]) continue;
    const e = obj(q[k]);
    if (!Number.isFinite(e.t)) continue;
    out[k] = { t: e.t, n: Number.isInteger(e.n) && e.n > 0 ? e.n : 1, note: typeof e.note === 'string' ? e.note.slice(0, 120) : '' };
    const r = refOf(e.ref);
    if (r) out[k].ref = r;
  }
  return out;
}
const oldOf = (main, uid) => obj(obj(obj(main).mgr)[uid]);
const hasOld = (main, uid) => { const m = oldOf(main, uid); return m.perm !== undefined || m.pq !== undefined; };
// מהמסמכים שכבר נקראו: המסמך החדש (snap) ואם אין – המיקום הישן במסמך sec_cfg/main (data)
function recFrom(snap, main, uid) {
  if (snap && snap.exists) { const d = snap.data() || {}; return { perm: obj(d.perm), pq: obj(d.pq) }; }
  const m = oldOf(main, uid);
  return { perm: obj(m.perm), pq: obj(m.pq) };
}
// קריאה טרייה (מחוץ לטרנזקציה). אין uid תקין – רשומה ריקה
async function readRec(db, uid) {
  if (!uidOk(uid)) return { perm: {}, pq: {} };
  const s = await db.doc(COLL + '/' + uid).get();
  if (s.exists) return recFrom(s, null, uid);
  const m = await db.doc('sec_cfg/main').get();
  return recFrom(null, m.exists ? m.data() : {}, uid);
}

// ההחלטה. rec – הרשומה של המנהל שבשמו הפעולה; o = { amount (₪, בסוג כספי), stop ("עצור הכל") }.
// מחזיר { d: 'auto'|'approve'|'deny'|'ask', why: '' | מפתח ב-WHY }. d==='auto' הוא היחיד שמתיר ביצוע לבד
function decide(rec, type, o) {
  const t = TYPES[type];
  if (!t) return { d: 'deny', why: 'pmDeny' }; // סוג לא מוכר – לא מבצעים לבד
  const p = permOf(rec)[type];
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
const isAuto = (rec, type, o) => decide(rec, type, o).d === 'auto';

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
// הרשומה החדשה אחרי השינוי (טהור): השאלה על הסוג נסגרת תמיד; "תמיד כך" מחליף את ההגדרה של הסוג; unset – מוחק אותה
function nextRec(rec, s, now) {
  const perm = Object.assign({}, obj(obj(rec).perm)), pq = Object.assign({}, obj(obj(rec).pq));
  delete pq[s.type];
  if (s.m === 'unset') delete perm[s.type];
  else if (s.save) perm[s.type] = Object.assign({ m: s.m, t: now }, s.cap !== undefined ? { cap: s.cap } : {});
  return { perm, pq };
}
// כתיבה בטרנזקציה: הרשומה כולה ל-sec_perm/{uid}; אם היא הגיעה מהמיקום הישן – מוחקים אותו (העברה, לא איבוד). log – שורת יומן (או null).
// fn(rec) מחזיר את הרשומה החדשה, או null כדי לא לכתוב כלום. מחזיר את מה ש-fn החזירה
async function writeRec(db, uid, fn, log) {
  const ref = db.doc(COLL + '/' + uid), mref = db.doc('sec_cfg/main');
  return db.runTransaction(async (tx) => {
    const [s, ms] = await Promise.all([tx.get(ref), tx.get(mref)]);
    const main = ms.exists ? ms.data() || {} : {};
    const cur = recFrom(s, main, uid);
    const r = fn(cur, main);
    if (!r) return null;
    tx.set(ref, { perm: r.perm, pq: r.pq, upd: Date.now() });
    if (!s.exists && ms.exists && hasOld(main, uid)) tx.update(mref, { ['mgr.' + uid + '.perm']: DEL(), ['mgr.' + uid + '.pq']: DEL() });
    const logs = typeof log === 'function' ? log(r) : log;
    if (logs) tx.set(db.collection('sec_log').doc(), logs);
    return r;
  });
}

// הפריט שעורר את השאלה (החלטת המשתמש 1: התשובה חלה מיד גם עליו). k – סוג הפריט: 'tkp' (כרטיס בשיחה, cid), 'cmt' (הצעות ההתחייבות שהוצגו), 'app' (התראות בטלפון)
const REF_K = ['tkp', 'cmt', 'app'];
function refOf(x) {
  const r = obj(x);
  if (!REF_K.includes(r.k)) return null;
  const o = { k: r.k };
  if (typeof r.cid === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(r.cid)) o.cid = r.cid;
  return o;
}

// "שאלה בפעם הראשונה" למנהל uid: נרשמת פעם אחת לכל סוג (כל עוד לא נענתה), עם מונה כמה פעמים גיטי הגיעה אליה. רישום ביומן – רק בפעם הראשונה.
// רק למנהל שאישר את התנאים (sec_cfg/main.mgr.<uid>.cv). שורת היומן – באותו מבנה כמו logData ב-secretary.js.
// לא זורק (תקלה כאן לא עוצרת את הפעולה – היא ממילא נשארת לאישור)
async function ask(db, uid, type, note, ref) {
  if (!TYPES[type] || !uidOk(uid)) return false;
  let first = false;
  try {
    await writeRec(db, uid, (rec, main) => {
      if (!oldOf(main, uid).cv) return null; // לא מנהל שאישר את התנאים – לא שואלים
      if (permOf(rec)[type]) return null; // בינתיים הוגדר
      const cur = obj(obj(rec.pq)[type]);
      first = !Number.isFinite(cur.t);
      const n = (Number.isInteger(cur.n) ? cur.n : 0) + 1;
      const q = { t: first ? Date.now() : cur.t, n, note: String(note || cur.note || '').slice(0, 120) };
      const rf = refOf(ref) || refOf(cur.ref); // הפריט האחרון שעורר את השאלה
      if (rf) q.ref = rf;
      return { perm: rec.perm, pq: Object.assign({}, rec.pq, { [type]: q }) };
    }, () => (first ? { t: Date.now(), by: uid, who: 'auto', act: 'permAsk', ch: 'app', tgt: type, note: String(note || '').slice(0, 120) } : null));
    return first;
  } catch (e) { return false; }
}

// החלטת המשתמש 3 (24.11.2026) – מיגרציה עצלה ולא הרסנית: כלל שכבר סומן "לבד" לפני הפריסה ממשיך לעבוד. כשבעל הכלל עוד לא הגדיר את סוג
// הפעולה – נשמר אצלו "לבד, תמיד" לאותו סוג בלבד (mig:1), ושורה אחת ביומן (permMig). לא נוגע בסוג שכבר הוגדר, ולא בסוגים אחרים.
// o.cap – תקרה לסוג כספי (למשל תקרת "נכנס ישר" של החשבוניות). מחזיר true אם נשמר עכשיו
async function legacyAuto(db, uid, type, o, note) {
  const t = TYPES[type];
  if (!t || !t.auto || t.fixed || !uidOk(uid)) return false;
  const cap = t.money ? obj(o).cap : undefined;
  if (t.money && !capOk(cap)) return false;
  let done = false;
  try {
    await writeRec(db, uid, (rec, main) => {
      if (!oldOf(main, uid).cv) return null; // רק מנהל שאישר את התנאים
      if (permOf(rec)[type]) return null; // כבר הוגדר – לא משנים
      done = true;
      const perm = Object.assign({}, rec.perm, { [type]: Object.assign({ m: 'auto', t: Date.now(), mig: 1 }, t.money ? { cap } : {}) });
      const pq = Object.assign({}, rec.pq); delete pq[type];
      return { perm, pq };
    }, () => (done ? { t: Date.now(), by: uid, who: 'auto', act: 'permMig', ch: 'app', tgt: type, note: String(note || '').slice(0, 120) + (cap !== undefined ? ' cap=' + cap : '') } : null));
  } catch (e) { return false; }
  return done;
}

// לנקודות הביצוע: '' = מותר לבד; אחרת קוד הסיבה (WHY). בלי הגדרה – גם רושם שאלה לאותו מנהל. אין בעלים – לאישור, בלי שאלה.
// opt.legacy – הפעולה באה מכלל שכבר מסומן "לבד" (החלטה 3): בלי הגדרה – מיגרציה ל"לבד" במקום שאלה. opt.ref – הפריט שעורר את השאלה
async function blockWhy(db, uid, type, o, note, opt) {
  if (!uidOk(uid)) return 'pmOwner';
  let r = decide(await readRec(db, uid), type, o);
  if (r.d === 'ask' && opt && opt.legacy && (await legacyAuto(db, uid, type, opt, note))) r = decide(await readRec(db, uid), type, o);
  if (r.d === 'auto') return '';
  if (r.d === 'ask') await ask(db, uid, type, note, opt && opt.ref);
  return r.why;
}

// לאפליקציה (secState): ההגדרות והשאלות הפתוחות של המנהל המחובר בלבד, ושמות הסוגים
function stateOf(rec) {
  return {
    edit: true, m: permOf(rec), q: pqOf(rec),
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

module.exports = { COLL, TYPES, KEYS, MODES, SCOPES, CAP_MAX, WHY, permOf, pqOf, recFrom, readRec, decide, isAuto, parseSet, noteOf, nextRec, writeRec, refOf, ask, legacyAuto, blockWhy, stateOf, isOtp };
