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
// סבב 2 (ליקויים 1–2): אכיפה שמרנית לפי שורשים וגזעים, ולא לפי ביטויים מדויקים. אותם ביטויים על ההוראה של המנהל, על ההודעה הנכנסת
// ועל הטקסט היוצא. זיהוי שגוי רק משאיר טיוטה לאישור ידני – וזה בסדר. בשפה שאינה עברית או אנגלית אין בדיקה בקוד, ולכן אין שליחה לבד (langBad).
// ב = מילה עברית שלפניה אות או אותיות תחילית (ו, ה, ש, כ, ל, ב, מ) – נתפסת בלי עוגן כי ההתאמה היא בתוך הטקסט
const HE = '[\\u0590-\\u05FF]';
const NOT_FWD = '(?!' + HE + '*\\s+(?:לך\\s+|לכם\\s+)?(?:את\\s+)?(?:ה)?(?:פני|הודע|בקש|שאל|מייל|מכתב|ל?מנהל|ל?צוות|ל?מחלק|הלאה|תשוב|טלפון|שיחה|אליך|אליכם))';
const SAFE_RE = Object.freeze({
  pay: new RegExp([
    'כסף', 'כספ(?!ת)', 'מזומן',
    // העברה: העביר/העבר(ה|נו|תי)/הועבר/יועבר/תועבר/נעביר/תעביר/אעביר/להעביר – לא "נעביר את הפנייה למנהל"
    '(?:הו|יו|תו|מו|לה|ה|נ|ת|א|י)עבי?ר' + NOT_FWD, 'מעביר' + NOT_FWD,
    // החזר / זיכוי: החזר(נו|תי)/הוחזר/יוחזר/נחזיר/תחזיר(ו|י) לי – לא "נחזור אליך" ולא "נחזיר לך תשובה"
    '(?:הו|יו|תו|מו|לה|ה|נ|ת|א|י)חזי?ר' + NOT_FWD, 'זיכ(?:וי|ינו|יתי|ית|תה|ה|ו)', 'יזוכ', 'תזוכ', 'זוכ(?:ה|ית|ינו)(?!' + HE + ')',
    // תשלום: תשלום/תשלמ/לשלם/משלמ/שילמ/שלמתי/שולם/ישולם/ישלם/נשלם/אשלם – לא "שלום", "מושלם", "שלמה"
    'תשלו?[מם]', 'לשלם', 'משל[מם]', 'שיל[מם]', 'שלמת', 'שלמנו', 'ישולם', 'שולם(?!' + HE + ')', 'ישלם', 'נשלם', 'אשלם', 'שלמי(?!' + HE + ')', 'שלמו(?!' + HE + ')',
    'חיוב', 'לחייב', 'חויב', 'חייבנו', 'חייבתי', 'אשראי', 'הוראת\\s*קבע', 'פייבוקס', 'ביט\\s+ל', 'צ[\'׳]ק(?!' + HE + ')', 'שיק(?!' + HE + ')', 'עמלה', 'קנס',
    '\\bpay', '\\bpaid\\b', 'refund', 'reimburs', '\\bwir(?:e|ed|es|ing)\\b', 'transfer', '\\bfunds?\\b', '\\bmoney\\b', '\\bcash\\b', 'credit\\s*card', 'debit\\s*card',
    '\\bcharg(?:e|ed|es|ing)\\b', 'chargeback', '\\bIBAN\\b', '\\bbit\\b', 'paypal', 'venmo', '\\bdeposit',
  ].join('|'), 'i'),
  del: new RegExp([
    // מחיקה: מחק/מחוק/מחיק/נמחק – מחקתי, מחקנו, נמחקו, למחוק, מחיקה
    'מחק', 'מחוק', 'מחיק',
    // הסרה: הסר/הוסר/יוסר/תוסר/להסיר/נסיר/תסיר(ו) – לא "מסר" (הודעה)
    '(?:הו|יו|תו|לה|ה|נ|ת|א|י)סי?ר(?!ט)', 'מסיר', 'הסרה', 'השמד', 'למחות(?!' + HE + ')',
    '\\bdelet', '\\bremov', '\\beras', '\\bunsubscrib', '\\bwip(?:e|ed|ing)\\b', '\\bpurg', 'forget\\s+(?:me|my)', '\\bGDPR\\b',
  ].join('|'), 'i'),
  secret: new RegExp([
    'סיסמ', 'קוד\\s*(?:ה)?(?:אימות|כניסה|גישה|סודי|זיהוי|חד|SMS|OTP)', 'קוד\\s*שקיבלת', 'אימות\\s*דו', 'תעודת\\s*(?:ה)?זהות', 'ת["״׳\'.]\\s?ז(?!' + HE + ')', 'מספר\\s*(?:ה)?זהות',
    'מספר\\s*(?:ה)?(?:כרטיס|חשבון)', 'פרטי\\s*(?:ה)?(?:בנק|כרטיס|חשבון)', 'בנק(?!וד|ל)', 'דרכון', 'שלוש\\s*(?:ה)?ספרות', '3\\s*(?:ה)?ספרות',
    'passw', 'passcode', '\\bpin\\b', '\\bOTP\\b', '\\b2FA\\b', '(?:verification|security|login|access|one[-\\s]?time)\\s*code', 'one[-\\s]?time\\s*pass', '\\bCVV', '\\bCVC',
    '\\bSSN\\b', 'social\\s*security', '\\bID\\s*(?:number|no\\b|card)', 'identity\\s*(?:number|card)', 'passport', 'card\\s*(?:number|details)', 'account\\s*(?:number|details)',
    'routing\\s*number', 'sort\\s*code', '\\bbank', 'credentials',
  ].join('|'), 'i'),
});
// תאימות: אותם ביטויים בשני הכיוונים
const SAFE_IN = SAFE_RE;
const SAFE_OUT = SAFE_RE;
// מספרים שנראים כמו כרטיס אשראי / חשבון בנק / ת"ז (9 ספרות ומעלה ברצף, כולל רווחים ומקפים)
const LONG_NUM = /(?:\d[ -]?){8,18}\d/;
const IL_PHONE = /^(?:0|972)?5\d{8}$|^(?:0|972)?[2-489]\d{7}$/; // טלפון ישראלי – לא נחשב "פרטים רגישים"
function longNumOut(text) {
  const m = String(text || '').match(new RegExp(LONG_NUM.source, 'g')) || [];
  return m.some((x) => { const d = x.replace(/\D/g, ''); return d.length >= 9 && !IL_PHONE.test(d); });
}
// מחזיר 'pay' | 'del' | 'secret' | '' (הראשון שנמצא). out נשמר לתאימות – הבדיקה זהה בשני הכיוונים
function safeOf(text) {
  const t = String(text || '');
  for (const k of ['pay', 'del', 'secret']) if (SAFE_RE[k].test(t)) return k;
  if (longNumOut(t)) return 'secret';
  return '';
}
// ליקוי 1: אותיות בכתב שאינו עברי ואינו לטיני (ערבית, קירילית ועוד) – אין בהן בדיקה בקוד, ולכן אין שליחה לבד. 2 אותיות ומעלה = "משמעותי"
const FOREIGN = /(?![\p{Script=Hebrew}\p{Script=Latin}])\p{L}/gu;
const foreignOf = (text) => (String(text || '').match(FOREIGN) || []).length >= 2;
const langBad = (...texts) => texts.some(foreignOf);
const SAFE_L = Object.freeze({ pay: 'תשלום או העברת כסף', del: 'מחיקת נתונים', secret: 'סיסמה, קוד או פרטים אישיים רגישים' });
// ההודעה נראית אוטומטית (מענה אוטומטי של עסק אחר, בוט) – לא עונים לבד, כדי לא להיכנס ללולאה (הערה 1 בסבב 1)
const BOT_RE = /(מענה\s*אוטומטי|הודעה\s*אוטומטית|תשובה\s*אוטומטית|זוהי\s*הודעה|אין\s*להשיב|נא\s*לא\s*להשיב|לא\s*לענות\s*להודעה|auto[-\s]?reply|automatic(?:ally)?\s*(?:reply|response|message|generated)|out\s*of\s*(?:the\s*)?office|do\s*not\s*reply|no[-\s]?reply|this\s*is\s*an\s*automated)/i;
const botLike = (text) => BOT_RE.test(String(text || ''));
const WA_LOOP_MAX = 0;                              // ווצאפ: 0 = בלי הגבלה על תשובות לבד לאותו שולח (החלטת המשתמש 15.11.2026). מספר חיובי מחזיר הגבלה לשעה
const WA_LOOP_MS = 36e5;

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
// התראות בטיחות – לעולם לא מושתקות (עצירה, מכסה, כשלון, שליחה לבד, שאלת "לבד?", חיבור / ניתוק / פקיעה של Google, מיילים שלא נקלטו, אישור העברה לאשפה)
const SAFE_NOTE = /^(stop|mailheld|fail|autofail|autoFail|mrfail|mrsent|mrask|mroff|draftcap|over|mailerr|gmailon|gcalon|gexp|mailgap|mailskip|mailover|maillag|histcap|clean)$/;
// סוגי התראה כלליים שמשותפים לכמה ערוצים (notifyMgrs נותן typ 'wa' גם להתראות מייל ו-Google) – השתקה רק לפי משפחה, אף פעם לא "כל הסוג"
const SHARED_TYP = Object.freeze(['wa']);
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
    if (sc === 'typ' && it.typ && !SHARED_TYP.includes(String(it.typ))) return { typ: String(it.typ).slice(0, 40) };
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
  if (r.ch === 'route') return (RK[s.kind] || 'פריטים') + ' ← ' + (RD[r.dest] || '');
  if (r.ch === 'note') return r.act === 'info' ? 'הנחיה בשיחה' : s.fam ? 'התראות דומות' : 'כל ההתראות מהסוג הזה';
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
      if (!s.fam && SHARED_TYP.includes(String(s.typ || ''))) return false; // כלל ישן / לא תקין: "כל הסוג" בסוג משותף – לא משתיק כלום
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
// כל התנאים לשליחה לבד, בקוד. o: { learn, stop, owner (ownerOk), rule, safeIn, safeOut, inText, outText, match (pickMatch), chk, unsure, cls, extra[] }
// inText / outText – הטקסט הנכנס והיוצא: כללי הבטיחות, שפה שאי אפשר לבדוק בה, והודעה שנראית אוטומטית – נבדקים כאן
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
  if (o.safeIn || (o.inText !== undefined && safeOf(o.inText))) why.push('safeIn');
  if (o.safeOut || (o.outText !== undefined && safeOf(o.outText))) why.push('safeOut');
  if ((o.inText !== undefined || o.outText !== undefined) && langBad(o.inText, o.outText)) why.push('lang');
  if (o.inText !== undefined && botLike(o.inText)) why.push('bot');
  if (MONEY_CLS.includes(o.cls)) why.push('money');
  if (o.chk) why.push('chk');
  if (o.unsure) why.push('unsure');
  for (const x of o.extra || []) if (x && !why.includes(x)) why.push(x);
  return why;
}
const NO_L = Object.freeze({
  learnOff: 'התכונה "כללים אישיים" כבויה בעסק', permNo: 'מנהל־העל הגדיר: שליחת הודעות – אסור', stop: '"עצור הכל" פעיל', ruleOff: 'הכלל לא מוגדר "לבד"', safeRule: 'כלל בטיחות – תמיד באישור',
  perm: 'בעל הכלל כבר לא מורשה (הוסר, הוגבל לסניפים או לא אישר את התנאים)', conf: 'המזכירה לא בטוחה שהכלל מתאים', cls: 'סוג הפנייה לא מתאים לכלל',
  safeIn: 'הפנייה עוסקת בתשלום, מחיקה או פרטים רגישים – תמיד באישור', safeOut: 'בתשובה יש תשלום, מחיקה או פרטים רגישים – תמיד באישור', money: 'פנייה על תשלום או חוב – תמיד באישור',
  lang: 'שפה שהמזכירה לא יכולה לבדוק בה את כללי הבטיחות – תמיד באישור', bot: 'ההודעה נראית כמו מענה אוטומטי', waLoop: 'הגיע מספר התשובות לבד לשולח הזה בשעה האחרונה',
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

// ---------- צ'אט נקי ו"מול העיניים" (15.11.2026, סעיף 6) ----------
// הוראות ניתוב: "חשבוניות מהיום – לטיפול" (hold = המסך "לטיפול" הקיים באפליקציה, V.todo – החלטת המשתמש 15.11). סוג פריט → יעד. ברירת מחדל (בלי כלל): הכול ב"מול העיניים" בצ'אט.
// כלל ניתוב הוא כלל אישי (sec_mrule, ch:'route'), נוצר רק בלחיצת המנהל. הכלל האחרון לכל סוג גובר (קודמים מכובים בשמירה).
const RK = Object.freeze({ inv: 'חשבוניות', rem: 'תזכורות', note: 'התראות', draft: 'טיוטות תשובה', appr: 'הצעות לאישור' });
const RD = Object.freeze({ hold: 'מסך "לטיפול" באפליקציה', tab: 'רק בלשונית שלהן', chat: 'מול העיניים בצ\'אט' });
const RK_RE = [['inv', /(חשבוני|קבלות|תעודות?\s*משלוח|invoice)/i], ['rem', /תזכור/], ['note', /התרא/], ['draft', /(טיוט|הודעות\s*(?:ה)?ווצאפ|מיילים)/], ['appr', /הצעות/]];
// 15.11.2026 (תיקון סבב 1): הוראת ניתוב = מילת "מעכשיו" + סוג פריט + יעד מפורש אחרי הסוג. "טיפול" אחרי שם עצם ("טיפול ברכב") או בשלילה – לא יעד
const RT_FROM = /(מעכשיו|מהיום|מעתה|תמיד|מכאן\s*(?:ו)?הלאה|from\s+now\s+on)/i;
const RT_Q = /^(?:למה|מה|כמה|איך|האם|מתי|איפה|מי|איזה|אילו|הא)(?:\s|$)/;
const RT_NEG = /(?:לא|שלא|אינ\S*|בלי)\s+(?:ב|ל)?(?:ה)?טיפול/;
const Q_ = '["\'״׳]?\\s*';
// אחרי "טיפול" של יעד: סוף, סימן, "באפליקציה" או "ולא…" – לא שם עצם ("טיפול ברכב")
const RD_END = '(?=$|[.!,;–—\\-]|באפליקציה|של\\s*האפליקציה|ולא(?:\\s|$))';
const RD_RE = [
  ['hold', new RegExp('(?:(?:ל|ב)(?:ה)?(?:מסך|קטגוריה|לשונית|רשימה|רשימת)\\s*' + Q_ + '(?:ה)?(?:ל|ב|לב)?(?:ה)?טיפול' + Q_ + RD_END
    + '|[–—\\-:,]\\s*(?:ל|ב|לב)?(?:ה)?טיפול' + Q_ + RD_END
    + '|(?:ל|ב|לב)(?:ה)?טיפול\\s*(?:באפליקציה|של\\s*האפליקציה))')],
  ['tab', /(רק\s*ב(?:ה)?לשונית|ללשונית|לא\s*(?:ב|ל)?(?:ה)?(?:צ['׳]?אט|שיחה)|בלי\s*(?:ה)?(?:צ['׳]?אט|שיחה)|מחוץ\s*ל(?:ה)?(?:צ['׳]?אט|שיחה))/],
  ['chat', /((?:ל|ב)(?:ה)?(?:צ['׳]?אט|שיחה)|מול\s*העיניים)/],
];
// מחזיר { kind, dest } או null. שאלה (סימן שאלה / מילת שאלה בהתחלה) – לא הוראה. היעד חייב לבוא אחרי סוג הפריט
function routeOf(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 200 || /[?؟]/.test(t) || RT_Q.test(t) || !RT_FROM.test(t) || RT_NEG.test(t)) return null;
  let k = null;
  for (const [key, re] of RK_RE) { const m = re.exec(t); if (m && (!k || m.index < k.i)) k = { key, i: m.index, end: m.index + m[0].length }; }
  if (!k) return null;
  const rest = t.slice(k.end);
  const d = RD_RE.find((x) => x[1].test(rest));
  return d ? { kind: k.key, dest: d[0] } : null;
}
// כלל ניתוב חדש (השדות שהשרת קובע)
function routeRule(instr, rt) {
  const i = clean(instr, INSTR_MAX);
  if (!i || i.length > INSTR_MAX || !rt || !RK[rt.kind] || !RD[rt.dest]) return null;
  return { ch: 'route', act: 'route', instr: i, scope: { kind: rt.kind }, dest: rt.dest, safe: '' };
}
// יעד לכל סוג לפי הכללים הפעילים (האחרון גובר)
function routesOf(rules) {
  const out = {};
  for (const r of (rules || []).filter((x) => x && x.ch === 'route' && x.on !== false && x.scope && RK[x.scope.kind] && RD[x.dest]).sort((a, b) => (a.t || 0) - (b.t || 0))) out[r.scope.kind] = r.dest;
  return out;
}
// חלוקת הפריטים: מול העיניים (chat) / בטיפול (hold) / רק בלשונית (מוסתר מהצ'אט)
function applyRoutes(items, routes) {
  const feed = [], hold = [];
  for (const x of items || []) { const d = (routes || {})[x.k] || 'chat'; if (d === 'hold') hold.push(x); else if (d !== 'tab') feed.push(x); }
  return { feed, hold };
}
// "מאז הכניסה הקודמת": rec = { chat (הכניסה האחרונה), prev (ה"מאז" שלה) }. כניסה חוזרת תוך 2 דקות – אותו "מאז" (רינדור כפול / חזרה מהירה)
const VISIT_SAME_MS = 120000, VISIT_MAX_MS = 7 * 864e5, VISIT_FIRST_MS = 864e5;
function sinceOf(rec, now, visit) {
  const r = rec && typeof rec === 'object' ? rec : {};
  const c = Number(r.chat) || 0, p = Number(r.prev) || 0;
  let since;
  if (!c) since = now - VISIT_FIRST_MS;
  else if (!visit || now - c < VISIT_SAME_MS) since = p || c;
  else since = c;
  return Math.max(since, now - VISIT_MAX_MS);
}
// יום יחסי לתצוגה: היום / מחר / יום שלישי 18.11
const WD = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
function relDay(d, today) {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return '';
  const ms = (x) => Date.UTC(+x.slice(0, 4), +x.slice(5, 7) - 1, +x.slice(8, 10));
  const k = Math.round((ms(d) - ms(today)) / 864e5);
  if (k === 0) return 'היום';
  if (k === 1) return 'מחר';
  return 'יום ' + WD[new Date(ms(d)).getUTCDay()] + ' ' + (+d.slice(8, 10)) + '.' + (+d.slice(5, 7));
}
// "תזכורת: להתקשר לספק – מחר 08:00" (תזכורת בלי שעה – בבוקר, כמו בשליחת ההתראה)
function remLine(e, today, morning) {
  const tm = e.tm || (e.rem === true ? morning || '08:00' : '');
  return (e.rem === true ? 'תזכורת: ' : 'ביומן: ') + String(e.title || '').slice(0, 100) + ' – ' + relDay(e.d, today) + (tm ? ' ' + tm : '');
}

module.exports = {
  RK, RD, routeOf, routeRule, routesOf, applyRoutes, sinceOf, relDay, remLine, VISIT_SAME_MS,
  CHS, OUT_CHS, MAX_RULES, INSTR_MAX, PROMPT_MAX, AUTO_MIN, FAIL_MAX, ASK_AGAIN_MS, NOTIFY_FIRST, MONEY_CLS,
  SAFE_IN, SAFE_OUT, SAFE_RE, SAFE_L, safeOf, longNumOut, foreignOf, langBad, botLike, WA_LOOP_MAX, WA_LOOP_MS, SHARED_TYP, SAFE_NOTE, clean, hashTo, norm, MUTE_RE, actOf, keyFam, noteMutable, scopeOf, cleanRule, scopeL,
  prefilter, rulesBlock, pickMatch, askOk, autoNo, NO_L, noL, failNext, maskTo,
};
