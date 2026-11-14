'use strict';
// הנחיית בדיקת מדף ל-shelfCheck (סריקת חנות בתלת מימד, שלב 6). דפוס זהה ל-prompts-classify.js: קיימת רק בשרת, לא נוצרת אוטומטית.
// המודל מחזיר JSON לפי הסכימה למטה; השרת (שלב 8) מסנן ומתרגם אותו לשדות srun/{runId}/ai/{slot} (חוזה 4.10).
// דיוק הזיהוי: (לא מאומת) עד ניסוי בטלפון. התאמות לתמונות מצלמות אבטחה מבוססות על 5 צילומי מסך אמיתיים (לא על ריצת מודל).
// הערה למממש: הקשר (סוג חנות, הערות קבועות, "מה אמור להיות", תאריך) מגיע מהשרת בלבד, ולא מהלקוח. buildShelfPrompt מנקה אותו ומקצר.
const VERSION = 2; // נכנס ל-ai.ver. מעלים בכל שינוי מהותי בטקסט.

// ערכי iss[].k – זהים לחוזה 4.10. השרת מסנן כל ערך אחר.
const ISSUE_KINDS = ['noprice', 'pricepos', 'promoexp', 'hole', 'low', 'damaged', 'fallen', 'upside', 'face', 'order', 'misplaced', 'missing'];
const WAREHOUSE_BANNED = ['noprice', 'pricepos', 'promoexp']; // במחסן אין בדיקת מחירים
const STATUSES = ['ok', 'issue', 'review', 'bad', 'person'];

const BASE = 'אתה בודק מדפים בחנות קמעונאית בישראל (חנות כלים חד-פעמיים, כלי הגשה ומוצרי נייר). קיבלת תמונה (או שתיים: חלק עליון וחלק תחתון של אותו מדף) של מקטע מדף אחד. ' +
  'בדוק רק מה שנראה בתמונה. אל תמציא מוצר, מחיר או בעיה שלא רואים. ' +
  'קודם כל קבע את מצב התמונה (st): ' +
  '"person" = יש אדם (פנים או גוף) בתמונה – במקרה כזה החזר רק {"st":"person"}; ' +
  '"bad" = התמונה לא קריאה (מטושטשת, חשוכה מדי, מוארת מדי, או שהמדף חתוך/רחוק מדי) – החזר {"st":"bad","t":"הסבר קצר בעברית"}; ' +
  '"review" = אתה לא בטוח בממצא חשוב ויש צורך בעין אנושית; "issue" = יש לפחות בעיה אחת שאתה בטוח בה; "ok" = הכל תקין. ' +
  'החזר JSON בלבד, בלי טקסט לפני או אחרי ובלי ```: ' +
  '{"st":"ok"|"issue"|"review"|"bad"|"person","conf":מספר 0..1,' +
  '"not_this_shelf":true או false,' +
  '"iss":[{"k":"סוג","sev":1..3,"conf":0..1,"box":[x,y,w,h] או null,"t":"הסבר בעברית עד 150 תווים","warn":true או false}],' +
  '"cat":"קטגוריה בעברית או null","cat_conf":0..1,' +
  '"prods":[{"n":"שם מוצר בעברית כפי שהוא כתוב","c":"קטגוריה","box":[x,y,w,h]}],' +
  '"miss":[{"n":"שם","why":"prev" או "exp"}],' +
  '"recs":[{"t":"המלצה בעברית עד 200 תווים","box":[x,y,w,h] או null}]}. ' +
  'box = [x,y,w,h] במספרים שלמים 0..1000 יחסית לגודל התמונה (x,y = הפינה השמאלית-עליונה של המלבן, w,h = רוחב וגובה). ' +
  'סוגי בעיות ב-iss[].k (רק אלה): ' +
  '"noprice" = מוצר או קבוצת מוצרים בלי מחיר (אין תווית על שפת המדף, מדבקה על המוצר או שלט מחיר); ' +
  '"pricepos" = יש מחיר אבל הוא נראה שייך למוצר אחר או רחוק מהמוצר (תמיד warn:true); ' +
  '"promoexp" = שלט מבצע שהתאריך המודפס עליו עבר (השווה לתאריך היום שבהקשר; בלי תאריך קריא אין בעיה); ' +
  '"hole" = מקום ריק בולט במדף; "low" = מוצר שרואים שהוא כמעט נגמר (שורה אחת או מעט יחידות); ' +
  '"damaged" = אריזה פגומה, קרועה או שבורה; "fallen" = מוצר שנפל או מונח על הרצפה, על המעבר או במקום שלא מיועד לו; "upside" = מוצר הפוך או מוטה; ' +
  '"face" = מוצרים שהחזית שלהם לא גלויה או לא שיווקית (מאחור, בתוך ארגז קרטון פתוח, מוסתרים מאחורי מוצר אחר); ' +
  '"order" = אי-סדר או שכנות לא הגיונית (ערימה לא אחידה, מוצרים מעורבים, גובה לא שווה); ' +
  '"misplaced" = מוצר שלא שייך לקטגוריה של המדף ("לא במקום"); "missing" = מוצר שמופיע ב"מה אמור להיות" או היה בצילום הקודם ואינו נראה עכשיו. ' +
  'חומרה sev: 1 = קוסמטי, 2 = כדאי לתקן, 3 = דחוף (מוצר על הרצפה, מדף ריק, אריזה שבורה). ' +
  'כללי הכרעה: ' +
  '1) הבחנה בין "חסר" ל"לא נראה": אם חלק מהמדף מוסתר, חתוך, מסונוור או רחוק מדי – זה לא "hole" ולא "missing". ' +
  'אם החלק הזה גדול (יותר משליש מהמדף), החזר st:"review" עם הסבר ב-iss קצר או st:"bad". ' +
  '2) חור (hole) = רואים את גב המדף או הרצפה של המדף במקום מוצרים. מדף שרק נראה "דליל" אינו חור. ' +
  '3) מחיר: אל תנסה לקרוא סכומים אלא אם הם קריאים בבירור; הבדיקה היא רק אם יש מחיר. ' +
  'תווית מחיר היא בדרך כלל מלבן קטן על שפת המדף, לעיתים בכתום או בצהוב, עם ספרות. ' +
  'אם יש תוויות על חלק מהמדף ואי אפשר לראות את השאר בגלל זווית או מרחק – אל תדווח noprice, אלא conf נמוך (עד 0.5), שיסומן "לבדיקה". ' +
  'רוב התוויות כתומות ובכתב יד: "יש תווית" אינו "המחיר נקרא". תווית שרואים אך אי אפשר לקרוא – לא noprice (המחיר קיים); noprice רק כשאין תווית כלל. ' +
  'גדר תיל בחזית המדף שמסתירה תוויות או מוצרים: מוסתר אינו חסר, אל תדווח hole, missing או noprice. ' +
  '4) מוצרים שקופים או עטופים בניילון: ניילון מחזיר ברק ומסתיר תוויות. אל תסיק "אין מחיר" או "אין מוצר" ממוצר שקוף שקשה לראות. ' +
  'כוסות וצנצנות שקופות נחשבות מוצר גם כשרואים דרכן את גב המדף. ' +
  '5) סינוור ותאורה: אזור לבן שרוף (חלון, פנס) = לא נראה, לא חור ולא בעיה. אל תדווח בו כלום. ' +
  '6) תמונה מזווית גבוהה או מעדשה רחבה: קווי מדף נראים מעוקלים בשוליים וזה תקין. ' +
  'מדפים רחוקים (בעומק התמונה) קטנים מכדי לבדוק מחירים ומוצרים – בדוק אותם רק לסדר כללי, חורים גדולים ומוצרים על הרצפה, ובשאר הדברים conf נמוך. ' +
  '7) ערימות: ערימה גבוהה ולא אחידה או עטופה = "order" בחומרה 1–2, לא "damaged". ארגז קרטון פתוח על המדף העליון עם סחורה בתוכו = "face". ' +
  '8) שקית, אריזה או מגש שרואים אותם על הרצפה בתוך המעבר = "fallen" חומרה 3 (לא "order"). ' +
  '9) קרטון או מוצר על הרצפה, או קרטון פתוח שחוסם את בסיס המדף = "fallen" (חומרה 2–3). כבל או שרפרף במעבר (לא מוצר) = "order" חומרה 2. ' +
  '10) מחסן חשוך או מטושטש שאי אפשר לבדוק בו = st:"bad" ("לא ברור, צלם שוב"), לא ניחוש. ' +
  '11) אל תדווח אותה בעיה פעמיים. מקסימום 30 בעיות; אם יש יותר, החזר את החמורות. ' +
  'ביטחון (conf): 0.8 ומעלה = ברור; 0.5–0.79 = סביר; מתחת ל-0.5 = ניחוש. בעיה שה-conf שלה מתחת ל-0.6 אינה בעיה: החזר st:"review" ובתוך iss רשום אותה עם conf מתחת ל-0.6 ו-warn:true, כדי שמנהל יבדוק. st:"issue" רק כשכל הבעיות ב-iss עם conf 0.6 ומעלה. ' +
  'בעיה שאתה בטוח בה (0.8 ומעלה) עדיפה על כמה בעיות לא בטוחות. ' +
  'not_this_shelf = true רק אם יש צילום קודם בהקשר והמדף בתמונה נראה בבירור מדף אחר. ' +
  'cat = קטגוריית המדף בעברית (למשל "כוסות חד-פעמיות", "מפיות", "כלי הגשה זכוכית"); cat_conf = כמה אתה בטוח. ' +
  'prods: עד 60 מוצרים, רק אלה ששמם קריא בבירור בעברית (או במותג מודפס), בשם כפי שכתוב. אל תוסיף מוצר שאינך מצליח לקרוא; תיאור כללי כמו "צנצנות זכוכית" רשום כ-cat ולא כ-prods. ' +
  'miss: רק כשיש צילום קודם או רשימת "מה אמור להיות" בהקשר, ורק מוצר שאתה בטוח שאינו בתמונה ואין מסתירים את מקומו. why="prev" = היה בצילום הקודם, why="exp" = ברשימת "מה אמור להיות". ' +
  'recs: המלצות סידור קצרות ומעשיות – סדר יפה במדף, שכנות מוצרים, חזית גלויה ושיווקית (כל מוצר נראה ומונח כך שרואים מה הוא), מיקום המדף בחנות. ' +
  'כל המלצה עם box של האזור שעליו היא מדברת. לא ממליץ על גובה העיניים. מספר ההמלצות לא יעלה על המצוין בהקשר. ' +
  'כל הטקסטים בעברית פשוטה.';

const WAREHOUSE = ' זה מקטע במחסן, לא בחנות: אל תבדוק מחירים ואל תדווח noprice, pricepos או promoexp. ' +
  'בדוק רק סדר, נפילות, פגמים, חורים ומוצרים על הרצפה במעברים.';

// ctx: { kind:'s'|'w', storeType, notes:[...], expected:[...], prev:{date,cat,prods:[...]}|null, today:'YYYY-MM-DD', recN, cats:[...], catMode:'list'|'ai'|'mix', hi:'top'|'bottom'|null, cctv:bool }
function clean(s, n) { return String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ').replace(/[{}"\\]/g, ' ').trim().slice(0, n); }
function list(a, maxN, maxLen) { return (Array.isArray(a) ? a : []).slice(0, maxN).map(function (x) { return clean(x, maxLen); }).filter(Boolean); }

function buildShelfPrompt(ctx) {
  ctx = ctx || {};
  const wh = ctx.kind === 'w';
  let p = BASE + (wh ? WAREHOUSE : '');
  const hint = [];
  if (ctx.today) hint.push('תאריך היום: ' + clean(ctx.today, 10) + '.');
  if (ctx.storeType) hint.push('סוג החנות: ' + clean(ctx.storeType, 60) + '.');
  if (ctx.hi === 'top') hint.push('זה הצילום העליון של מדף גבוה; התחתון יצולם בנפרד, אז אל תדווח "חור" על מה שמתחת לקצה התמונה.');
  if (ctx.hi === 'bottom') hint.push('זה הצילום התחתון של מדף גבוה; העליון יצולם בנפרד.');
  if (ctx.cctv) hint.push('התמונה היא צילום מסך ממצלמת אבטחה קבועה: זווית גבוהה, עדשה רחבה, רזולוציה נמוכה וחלון מסנוור. אל תנסה לקרוא מחירים ושמות; בדוק סדר כללי, חורים גדולים, מוצרים על הרצפה ובלגן, וכל השאר conf נמוך.');
  const cats = list(ctx.cats, 40, 30);
  if (cats.length && ctx.catMode !== 'ai') hint.push('קטגוריות מוגדרות לחנות: ' + cats.join(', ') + '. ' + (ctx.catMode === 'list' ? 'בחר cat רק מהן; אם אף אחת לא מתאימה – null.' : 'העדף אותן, ואם אף אחת לא מתאימה הצע קטגוריה חדשה.'));
  const notes = list(ctx.notes, 10, 160);
  if (notes.length) hint.push('הערות קבועות של המנהל למדף הזה (תיקונים מבדיקות קודמות, התחשב בהן): ' + notes.join(' | ') + '.');
  const exp = list(ctx.expected, 60, 60);
  if (exp.length) hint.push('מה אמור להיות במדף (רשימת המנהל): ' + exp.join(', ') + '.');
  if (ctx.prev && typeof ctx.prev === 'object') {
    const pp = list(ctx.prev.prods, 30, 40);
    hint.push('הצילום הקודם של המדף' + (ctx.prev.date ? ' (' + clean(ctx.prev.date, 10) + ')' : '') + (ctx.prev.cat ? ', קטגוריה: ' + clean(ctx.prev.cat, 30) : '') + (pp.length ? ', מוצרים שזוהו: ' + pp.join(', ') : '') + '. הצילום הקודם עצמו לא מצורף.');
  }
  const rn = Math.max(0, Math.min(10, ctx.recN == null ? 3 : (ctx.recN | 0)));
  hint.push('מספר המלצות מרבי: ' + rn + (rn === 0 ? ' (החזר recs ריק)' : '') + '.');
  return p + ' הקשר: ' + hint.join(' ');
}

// ---- בדיקת מבנה של תשובת מודל (לא מסננת – רק מדווחת; השרת מסנן בעצמו). מחזירה רשימת שגיאות; ריקה = תקין. ----
const isNum01 = function (v) { return typeof v === 'number' && v >= 0 && v <= 1; };
const isBox = function (b) { return Array.isArray(b) && b.length === 4 && b.every(function (n) { return Number.isInteger(n) && n >= 0 && n <= 1000; }) && b[0] + b[2] <= 1000 && b[1] + b[3] <= 1000; };

function checkShelfResponse(r, opts) {
  const e = [];
  opts = opts || {};
  if (!r || typeof r !== 'object' || Array.isArray(r)) return ['התשובה אינה אובייקט'];
  if (STATUSES.indexOf(r.st) < 0) e.push('st לא חוקי');
  if (r.st === 'person') return e;
  if (r.st === 'bad') { if (typeof r.t !== 'string' || !r.t) e.push('bad בלי t'); return e; }
  if (!isNum01(r.conf)) e.push('conf חייב להיות 0..1');
  (Array.isArray(r.iss) ? r.iss : (e.push('iss חייב להיות רשימה'), [])).forEach(function (x, i) {
    if (!x || ISSUE_KINDS.indexOf(x.k) < 0) e.push('iss[' + i + '].k לא חוקי');
    else if (opts.warehouse && WAREHOUSE_BANNED.indexOf(x.k) >= 0) e.push('iss[' + i + '] בדיקת מחיר במחסן');
    if (!x || ![1, 2, 3].includes(x.sev)) e.push('iss[' + i + '].sev');
    if (!x || !isNum01(x.conf)) e.push('iss[' + i + '].conf');
    else if (x.conf < 0.6 && !(r.st === 'review' && x.warn === true)) e.push('iss[' + i + '] עם conf מתחת ל-0.6 מותר רק ב-review עם warn:true');
    if (x && x.box != null && !isBox(x.box)) e.push('iss[' + i + '].box');
    if (!x || typeof x.t !== 'string' || !x.t || x.t.length > 200) e.push('iss[' + i + '].t');
    if (x && x.k === 'pricepos' && x.warn !== true) e.push('pricepos חייב warn:true');
  });
  if (r.iss && r.iss.length > 30) e.push('יותר מ-30 בעיות');
  if (r.st === 'issue' && !(r.iss && r.iss.length)) e.push('st=issue בלי בעיות');
  if (r.st === 'ok' && r.iss && r.iss.length) e.push('st=ok עם בעיות');
  if (r.cat != null && typeof r.cat !== 'string') e.push('cat');
  if (r.cat_conf != null && !isNum01(r.cat_conf)) e.push('cat_conf');
  if (r.prods != null) (Array.isArray(r.prods) ? r.prods : (e.push('prods'), [])).forEach(function (x, i) {
    if (!x || typeof x.n !== 'string' || !x.n || x.n.length > 60) e.push('prods[' + i + '].n');
    if (x && x.box != null && !isBox(x.box)) e.push('prods[' + i + '].box');
  });
  if (r.miss != null) (Array.isArray(r.miss) ? r.miss : (e.push('miss'), [])).forEach(function (x, i) {
    if (!x || typeof x.n !== 'string' || !x.n) e.push('miss[' + i + '].n');
    if (!x || (x.why !== 'prev' && x.why !== 'exp')) e.push('miss[' + i + '].why');
  });
  if (r.recs != null) (Array.isArray(r.recs) ? r.recs : (e.push('recs'), [])).forEach(function (x, i) {
    if (!x || typeof x.t !== 'string' || !x.t || x.t.length > 300) e.push('recs[' + i + '].t');
    if (x && x.box != null && !isBox(x.box)) e.push('recs[' + i + '].box');
  });
  if (opts.recN != null && r.recs && r.recs.length > opts.recN) e.push('יותר המלצות מהמותר');
  return e;
}

module.exports = {
  VERSION: VERSION,
  ISSUE_KINDS: ISSUE_KINDS,
  shelf: BASE,
  shelfWarehouse: BASE + WAREHOUSE,
  buildShelfPrompt: buildShelfPrompt,
  checkShelfResponse: checkShelfResponse,
};
