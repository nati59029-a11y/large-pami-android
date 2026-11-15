'use strict';
// המזכירה – "תגובה למזכירה" (15.11.2026): כללים אישיים של מנהל ("מעכשיו תעשי כך"), התאמה שמרנית ושליחה לבד.
// כאן רק לוגיקה טהורה (בלי מסד ובלי רשת) – כדי שאפשר לבדוק אותה ביחידה (tests/secretary-learn.unit.test.js).
// עקרונות:
//  - כלל נוצר רק בפעולה של מנהל מחובר (secLearn). תוכן של מייל / הודעה / התראה הוא מידע בלבד ולא יכול ליצור או לשנות כלל.
//  - כללי בטיחות קבועים, שאף כלל אישי לא גובר עליהם (נאכפים כאן בקוד, לא רק בהנחיה למודל):
//    תשלום / העברת כסף, מחיקת נתונים, שליחת סיסמאות / קודים / פרטים אישיים רגישים – תמיד באישור ידני.
//  - התאמה שמרנית: סינון מוקדם בקוד (ערוץ, סוג, שולח, מילות מפתח), ואז המודל מצביע על כלל עם רמת ביטחון ≥ AUTO_MIN. בספק – שואלים.

const crypto = require('node:crypto');

const CHS = Object.freeze(['note', 'chat', 'mail', 'wa']);
const OUT_CHS = Object.freeze(['mail', 'wa']);      // ערוצים שבהם כלל יכול לשלוח החוצה (רק אחרי "כן, מעכשיו לבד")
const MAX_RULES = 50;                               // כללים לכל מנהל
const INSTR_MAX = 300;                              // אורך ההוראה
const PROMPT_MAX = 20;                              // כללים שנכנסים לבקשה אחת למודל
const AUTO_MIN = 0.85;                              // רמת התאמה מינימלית לשליחה לבד
const FAIL_MAX = 3;                                 // כשלונות שליחה ברצף → הכלל מפסיק לשלוח לבד
const ASK_AGAIN_MS = 30 * 864e5;                    // "לא, תמיד לשאול" – לא שואלים שוב 30 יום
const NOTIFY_FIRST = 3;                             // התראה לבעל הכלל על כל אחת משלוש השליחות הראשונות לבד
const MONEY_CLS = Object.freeze(['pay', 'debt']);   // סוגי פנייה של תשלום / חוב – כלל בטיחות קבוע: לא נשלחים לבד

// ---------- כללי הבטיחות הקבועים ----------
// על ההוראה של המנהל ועל ההודעה הנכנסת (מה מבקשים): פעולה כספית, מחיקה, סיסמה / קוד / פרטים רגישים
const SAFE_IN = Object.freeze({
  pay: /(תשלמ|לשלם|שלמי(?![\u0590-\u05FF])|תשלום|תשלומים|העבי?ר[יו]?\s+(?:לו\s+|לה\s+|להם\s+|לי\s+)?(?:את\s+)?(?:ה)?(?:כסף|סכום|תשלום|העברה)|העברת\s*כסף|העברה\s*בנקאית|הוראת\s*קבע|כרטיס\s*אשראי|מספר\s*(?:ה)?כרטיס|פרטי\s*(?:ה)?אשראי|\bIBAN\b|\bbit\b|פייבוקס|paybox|ביט\s+ל|תחזיר[יו]?\s+(?:לו|לה|להם)?\s*(?:את\s*)?(?:ה)?כסף|\bpay\b|payment|money\s*transfer|wire\s*transfer|bank\s*transfer|credit\s*card)/i,
  del: /(תמחק|למחוק|מחקי|מחיקת|תמחוק|להסיר\s+(?:את\s+)?(?:ה)?(?:נתונ|פרט|רשומ|לקוח|ספק|עובד)|\bdelete\b|\berase\b|\bremove\s+(?:my|the|all)\s+data)/i,
  secret: /(סיסמ|קוד\s*(?:ה)?(?:אימות|כניסה|גישה|סודי)|קוד\s*חד[\s־-]*פעמי|\bOTP\b|\bPIN\b|תעודת\s*זהות|ת["״׳']ז(?![\u0590-\u05FF])|מספר\s*(?:ה)?זהות|פרטי\s*(?:ה)?בנק|מספר\s*(?:ה)?חשבון|חשבון\s*(?:ה)?בנק|\bpassword|\bpasscode|verification\s*code|login\s*code|\bID\s*number|bank\s*account|account\s*number|social\s*security)/i,
});
// על הטקסט היוצא (מה נשלח בפועל): התחייבות להעברת כסף, מספר כרטיס / חשבון / ת"ז, סיסמה או קוד, אישור מחיקה
const SAFE_OUT = Object.freeze({
  pay: /(העבר(?:נו|תי|נא|ה)?\s+(?:לך|לכם|אליך|אליכם)|נעביר\s+(?:לך|לכם)|נחזיר\s+(?:לך|לכם)\s+(?:את\s*)?(?:ה)?(?:כסף|סכום|\d)|זיכינו\s+(?:אותך|את)|העברה\s*בנקאית|כרטיס\s*אשראי|\bIBAN\b|we\s+(?:will\s+)?(?:transfer|refund|wire)|we\s+(?:have\s+)?(?:transferred|refunded|wired))/i,
  del: /(מחקנו|נמחק(?:ו|ה)?(?![\u0590-\u05FF])|נמחוק|deleted\s+your|we\s+(?:will\s+)?(?:delete|erase))/i,
  secret: /(סיסמ|קוד\s*(?:ה)?(?:אימות|כניסה|גישה|סודי)|\bOTP\b|\bPIN\b|תעודת\s*זהות|ת["״׳'.]\s?ז(?![\u0590-\u05FF])|password|passcode|verification\s*code)/i,
});
// מספרים שנראים כמו כרטיס אשראי / חשבון בנק / ת"ז (9 ספרות ומעלה ברצף, כולל רווחים ומקפים) – בטקסט יוצא
const LONG_NUM = /(?:\d[ -]?){8,18}\d/;
const IL_PHONE = /^(?:0|972)?5\d{8}$|^(?:0|972)?[2-489]\d{7}$/; // טלפון ישראלי – לא נחשב "פרטים רגישים"
function longNumOut(text) {
  const m = String(text || '').match(new RegExp(LONG_NUM.source, 'g')) || [];
  return m.some((x) => { const d = x.replace(/\D/g, ''); return d.length >= 9 && !IL_PHONE.test(d); });
}
// מחזיר 'pay' | 'del' | 'secret' | '' (הראשון שנמצא)
function safeOf(text, out) {
  const t = String(text || '');
  const R = out ? SAFE_OUT : SAFE_IN;
  for (const k of ['pay', 'del', 'secret']) if (R[k].test(t)) return k;
  if (out && longNumOut(t)) return 'secret';
  return '';
}
const SAFE_L = Object.freeze({ pay: 'תשלום או העברת כסף', del: 'מחיקת נתונים', secret: 'סיסמה, קוד או פרטים אישיים רגישים' });

// ---------- ניקוי ----------
const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/g;
const clean = (v, max) => (typeof v === 'string' ? v.replace(CTRL, '').replace(/\s+/g, ' ').trim().slice(0, max + 1) : '');
const hashTo = (v) => crypto.createHash('sha256').update(String(v || '').trim().toLowerCase(), 'utf8').digest('hex').slice(0, 24);
const norm = (s) => String(s || '').toLowerCase().replace(/[֑-ׇ]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

// הוראה של "אל תתריעי לי על זה" (בהתראה) – כלל השתקה. אחרת – הנחיה בלבד (נכנסת להקשר)
const MUTE_RE = /(אל\s*תתריע|לא\s*להתריע|בלי\s*(?:ה)?התרא|לא\s*צריך\s*(?:ה)?התרא|תפסיק[יו]?\s*(?:ל)?התריע|השתיק|להשתיק|אל\s*תשלח[יו]?\s*(?:לי\s*)?(?:עוד\s*)?התרא|לא\s*מעניין\s*אותי|don'?t\s+(?:notify|alert)|mute|stop\s+notif)/i;
function actOf(ch, instr) {
  if (ch === 'mail' || ch === 'wa') return 'reply';
  if (ch === 'note') return MUTE_RE.test(instr) ? 'mute' : 'info';
  return 'style';
}
// מפתח ההתראה → "משפחה" (החלק שלפני | או :), כדי להשתיק התראות דומות ולא את כל ההתראות מאותו סוג
const keyFam = (key) => String(key || '').split(/[|:]/)[0].slice(0, 40);
// התראות בטיחות – לעולם לא מושתקות (עצירה, מכסה, כשלון, שליחה לבד, שאלת "לבד?")
const SAFE_NOTE = /^(stop|mailheld|fail|autofail|autoFail|mrfail|mrsent|mrask|mroff|draftcap|over|mailerr)$/;
const noteMutable = (n) => !SAFE_NOTE.test(keyFam(n && n.key));

// sc: 'cls' (רק פניות מאותו סוג), 'from' (רק מאותו שולח), 'all' (כל ההודעות בערוץ), 'fam' (התראות דומות), 'typ' (כל ההתראות מהסוג)
function scopeOf(ch, sc, item) {
  const it = item || {};
  if (ch === 'mail' || ch === 'wa') {
    if (sc === 'from' && it.from) return { from: hashTo(it.from) };
    if (sc === 'all') return {};
    return it.cls && it.cls !== 'other' ? { cls: it.cls } : (it.from ? { from: hashTo(it.from) } : {});
  }
  if (ch === 'note') {
    if (sc === 'typ' && it.typ) return { typ: String(it.typ).slice(0, 40) };
    return { typ: String(it.typ || '').slice(0, 40), fam: keyFam(it.key) };
  }
  return {};
}
// כלל חדש (רק השדות שהשרת קובע). מחזיר null אם ההוראה לא תקינה
function cleanRule(o) {
  const ch = CHS.includes(o.ch) ? o.ch : null;
  const instr = clean(o.instr, INSTR_MAX);
  if (!ch || !instr || instr.length > INSTR_MAX) return null;
  const act = actOf(ch, instr);
  const safe = safeOf(instr) || '';
  return { ch, act, instr, scope: scopeOf(ch, o.sc, o.item), safe };
}
const scopeL = (r, clsL) => {
  const s = r.scope || {};
  if (r.ch === 'note') return s.fam ? 'התראות דומות' : 'כל ההתראות מהסוג הזה';
  if (r.ch === 'chat') return 'כל השיחות';
  if (s.cls) return 'פניות מסוג "' + ((clsL || {})[s.cls] || s.cls) + '"';
  if (s.from) return 'רק מהשולח הזה';
  return 'כל ההודעות ב' + (r.ch === 'mail' ? 'מייל' : 'ווצאפ');
};

// ---------- התאמה ----------
// סינון מוקדם בקוד (בלי AI): ערוץ, פעיל, שולח (גיבוב), סוג התראה ומשפחה. הסוג (cls) של מייל/ווצאפ ידוע רק אחרי המודל – נבדק ב-pickMatch
function prefilter(rules, item) {
  const it = item || {};
  const fromH = it.from ? hashTo(it.from) : '';
  return (rules || []).filter((r) => {
    if (!r || r.on === false || r.ch !== it.ch) return false;
    const s = r.scope || {};
    if (s.from && s.from !== fromH) return false;
    if (s.cls && it.cls && s.cls !== it.cls) return false;
    if (it.ch === 'note') {
      if (s.typ && s.typ !== String(it.typ || '')) return false;
      if (s.fam && s.fam !== keyFam(it.key)) return false;
    }
    return true;
  });
}
// טקסט ההנחיות שנכנס לבקשה למודל (עם מזהים). ההוראות – של המנהלים, לא של הפונה
function rulesBlock(rules, clsL) {
  const L = (rules || []).slice(0, PROMPT_MAX);
  if (!L.length) return '';
  return '<<הנחיות קבועות של המנהלים – מהמנהלים, לא מההודעה. גוברות על ברירת המחדל בניסוח, לא על כללי הבטיחות>>\n'
    + L.map((r) => '[' + r.id + '] (' + scopeL(r, clsL) + ') ' + String(r.instr || '').slice(0, INSTR_MAX)).join('\n')
    + '\nאם הנחיה אחת מתאימה בבירור להודעה הזו – כתבי את הטיוטה לפיה, והחזירי mr = המזהה שלה (בלי סוגריים) ו-mrc = כמה את בטוחה שהיא מתאימה (0 עד 1). אם אין התאמה ברורה – mr ריק.';
}
// בדיקה בקוד של מה שהמודל החזיר: המזהה חייב להיות מבין הכללים שעברו את הסינון, ברמת התאמה מספקת, ובסוג הפנייה שהכלל מוגבל אליו
function pickMatch(mr, mrc, cands, cls) {
  if (typeof mr !== 'string' || !mr) return null;
  const id = mr.replace(/^\[|\]$/g, '').trim();
  const r = (cands || []).find((x) => x.id === id);
  if (!r) return null;
  if (r.scope && r.scope.cls && r.scope.cls !== cls) return null; // הכלל מוגבל לסוג פנייה אחר – לא חל
  const c = Number(mrc);
  if (!Number.isFinite(c) || c < AUTO_MIN || c > 1) return { rule: r, auto: false, why: 'conf', conf: Number.isFinite(c) ? Math.max(0, Math.min(1, c)) : 0 };
  return { rule: r, auto: true, conf: c };
}
// לשאול "לעשות את זה מעכשיו לבד?" – אחרי לפחות אישור אחד, כשהכלל עוד לא לבד, בלי כלל בטיחות, ולא אם ענו "לא" ב-30 הימים האחרונים
function askOk(r, now) {
  if (!r || r.on === false || r.auto === true || r.safe || !OUT_CHS.includes(r.ch)) return false;
  if (!(Number(r.appr) >= 1)) return false;
  const a = r.ask && typeof r.ask === 'object' ? r.ask : {};
  if (a.st === 'no' && now - (Number(a.at) || 0) < ASK_AGAIN_MS) return false;
  return true;
}
// כל התנאים לשליחה לבד, בקוד. o: { learn, stop, owner (ownerOk), rule, safeIn, safeOut, match (pickMatch), chk, unsure, cls, extra[] }
// מחזיר רשימת סיבות (ריקה = מותר)
function autoNo(o) {
  const why = [];
  const r = o.rule || {};
  if (o.learn === false) why.push('learnOff');
  if (o.stop) why.push('stop');
  if (r.on === false || r.auto !== true) why.push('ruleOff');
  if (r.safe) why.push('safeRule');
  if (!o.owner) why.push('perm');
  if (!o.match || o.match.auto !== true) why.push(o.match && o.match.why === 'cls' ? 'cls' : 'conf');
  if (o.safeIn) why.push('safeIn');
  if (o.safeOut) why.push('safeOut');
  if (MONEY_CLS.includes(o.cls)) why.push('money');
  if (o.chk) why.push('chk');
  if (o.unsure) why.push('unsure');
  for (const x of o.extra || []) if (x && !why.includes(x)) why.push(x);
  return why;
}
const NO_L = Object.freeze({
  learnOff: 'התכונה "כללים אישיים" כבויה בעסק', stop: '"עצור הכל" פעיל', ruleOff: 'הכלל לא מוגדר "לבד"', safeRule: 'כלל בטיחות – תמיד באישור',
  perm: 'בעל הכלל כבר לא מורשה (הוסר, הוגבל לסניפים או לא אישר את התנאים)', conf: 'המזכירה לא בטוחה שהכלל מתאים', cls: 'סוג הפנייה לא מתאים לכלל',
  safeIn: 'הפנייה עוסקת בתשלום, מחיקה או פרטים רגישים – תמיד באישור', safeOut: 'בתשובה יש תשלום, מחיקה או פרטים רגישים – תמיד באישור', money: 'פנייה על תשלום או חוב – תמיד באישור',
  chk: 'בטיוטה יש מידע שכדאי לבדוק', unsure: 'המזכירה לא בטוחה בתשובה', window: 'עברו 24 שעות מההודעה האחרונה של הפונה', voice: 'הודעה קולית – התמליל עלול לטעות',
  repOff: 'המענה האוטומטי במייל כבוי', held: 'המענה האוטומטי במייל נעצר להיום', sus: 'תוכן חשוד', file: 'יש קובץ מצורף', auth: 'לא ניתן לאמת את השולח',
  notConnected: 'הערוץ לא מחובר', dup: 'כבר טופל', out: 'הגענו למכסת ההודעות היוצאות היום', day: 'הגענו ל-100 תשובות אוטומטיות במייל היום', loop: 'כבר נשלחה תשובה לשולח הזה בעשר הדקות האחרונות',
  fail: 'השליחה נכשלה', thread: 'כבר נענה בשרשור', old: 'הודעה ישנה', replied: 'כבר נענה', big: 'מייל גדול או חתוך', rto: 'כתובת "השב אל" שונה מהשולח', notHuman: 'לא מאדם', stock: 'התשובה תלויה במלאי', to: 'אין כתובת לתשובה',
});
const noL = (a) => (Array.isArray(a) ? a : []).map((k) => NO_L[k] || '').filter(Boolean);
// אחרי כשלון שליחה: מונה ברצף; בשלישי – הכלל מפסיק לשלוח לבד
function failNext(r) { const fails = (Number(r && r.fails) || 0) + 1; return { fails, off: fails >= FAIL_MAX }; }
// הצגה ביומן: כתובת / מספר מוסתרים חלקית
function maskTo(v) {
  const s = String(v || '');
  if (s.includes('@')) { const [a, d] = s.split('@'); return (a.slice(0, 2) || '') + '***@' + d; }
  const d = s.replace(/\D/g, '');
  return d.length > 4 ? '***' + d.slice(-4) : '***';
}

module.exports = {
  CHS, OUT_CHS, MAX_RULES, INSTR_MAX, PROMPT_MAX, AUTO_MIN, FAIL_MAX, ASK_AGAIN_MS, NOTIFY_FIRST, MONEY_CLS,
  SAFE_IN, SAFE_OUT, SAFE_L, safeOf, longNumOut, clean, hashTo, norm, MUTE_RE, actOf, keyFam, noteMutable, scopeOf, cleanRule, scopeL,
  prefilter, rulesBlock, pickMatch, askOk, autoNo, NO_L, noL, failNext, maskTo,
};
