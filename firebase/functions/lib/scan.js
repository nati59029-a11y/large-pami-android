'use strict';
// scanDocument: בדיקת הקלט, מגבלה יומית, ופנייה ל-Gemini.
// הפנייה ל-Gemini היא העתקה של מה שהאפליקציה עושה היום (shModels + shAIcall ב-www/index.html),
// עם אותן הנחיות (prompts), אותן הגדרות ואותו סדר ניסיון של מודלים. ההבדל היחיד: המפתח נמצא בשרת.

const { HttpsError } = require('firebase-functions/v2/https');
const { getFirestore } = require('firebase-admin/firestore');
const T = require('./tenant');
// prompts.js נוצר אוטומטית מהאפליקציה; ההנחיה של recipe קיימת רק בשרת (prompts-recipe.js)
const PROMPTS = Object.assign({}, require('./prompts'), require('./prompts-recipe'), require('./prompts-classify'), { ordlist: require('./prompts-ord').ordlist }, { payproof: require('./prompts-ar').payproof });

// ---------- סוגי זיהוי (מה האפליקציה מזהה היום) ----------
// invoice  = ocrAI  (חשבונית / תעודת משלוח), עד 4 עמודים, temperature 0
// product  = shAI   (צילום מוצר למדף), תמונה אחת, temperature 0.1
// feedback = fbAI   (טופס משוב לקוחות), תמונה אחת או 4 (דף מלא + 3 הגדלות), temperature 0.1, מודל "pro", עד 150 שניות
// zreport  = zcAI   (סגירת קופה: דוח Z), בדיוק 3 תמונות (חלק עליון, אמצעי ותחתון), temperature 0
// opening  = zcAI   (הצהרת פתיחת קופה), תמונה אחת, temperature 0
// deposit  = dpScan (אישור הפקדה מהבנק – סגירת קופה, שלב 2), תמונה אחת בכל קריאה, temperature 0
// cashout  = coScan (פתק "הוצאת מזומן מהקופה" – סכום, תאריך, שעה וקופה), תמונה אחת, temperature 0
// invlines = שורות מוצרים מחשבונית ספק (תמחור), עד 4 עמודים, temperature 0
// transfer = trAI   (צילום העברה בנקאית: סוג המסמך, ולכל מוטב סכום, תאריך, שם, חשבון ואסמכתא), קובץ אחד (תמונה או PDF), temperature 0
// timeoutMs = זמן מרבי למודל אחד (כמו באפליקציה היום).
// budgetMs  = תקציב זמן כולל לכל הקריאה בשרת (כל המודלים, ההמתנות והניסיון החוזר יחד).
//             תמיד קצר מהזמן שהטלפון מחכה (PHONE_WAIT_MS), כדי שהשרת יסיים ויחזיר תשובה לפני שהטלפון מוותר.
const KINDS = Object.freeze({
  invoice: { minFiles: 1, maxFiles: 4, temperature: 0, pro: false, timeoutMs: 30000, budgetMs: 100000 },
  product: { minFiles: 1, maxFiles: 1, temperature: 0.1, pro: false, timeoutMs: 30000, budgetMs: 100000 },
  feedback: { allowedCounts: [1, 4], minFiles: 1, maxFiles: 4, temperature: 0.1, pro: true, timeoutMs: 150000, budgetMs: 135000 },
  zreport: { allowedCounts: [3], minFiles: 3, maxFiles: 3, temperature: 0, pro: false, timeoutMs: 30000, budgetMs: 100000 },
  opening: { minFiles: 1, maxFiles: 1, temperature: 0, pro: false, timeoutMs: 30000, budgetMs: 100000 },
  deposit: { minFiles: 1, maxFiles: 1, temperature: 0, pro: false, timeoutMs: 30000, budgetMs: 100000 },
  cashout: { minFiles: 1, maxFiles: 1, temperature: 0, pro: false, timeoutMs: 30000, budgetMs: 100000 },
  transfer: { minFiles: 1, maxFiles: 1, temperature: 0, pro: false, timeoutMs: 30000, budgetMs: 100000 },
  // recipe = מתכון מצילום (שלוחה 1), גם כתב יד: תמונה אחת או שתיים, מודל "pro", כמו משוב
  recipe: { minFiles: 1, maxFiles: 2, temperature: 0.1, pro: true, timeoutMs: 150000, budgetMs: 135000 },
  // classify = סריקה אחידה (משימה 2026-11-07): דף אחד – סיווג + נתונים באותה קריאה = דף אחד במכסה
  classify: { minFiles: 1, maxFiles: 1, temperature: 0, pro: false, timeoutMs: 30000, budgetMs: 100000 },
  // invlines = שורות המוצרים מחשבונית ספק (תמחור חשבונית ספק, שלב 2; הנחיה INVL_P מהאפליקציה), עד 4 עמודים.
  // תשובה ארוכה (טבלה) – 60 שניות למודל (הנחה), באותו תקציב כולל של חשבונית
  invlines: { minFiles: 1, maxFiles: 4, temperature: 0, pro: false, timeoutMs: 60000, budgetMs: 100000 },
  // ordlist = צילום רשימת הזמנה (שלב 2 חלק ב', 14.11.2026): שורות שם + כמות, עד 3 תמונות. ההתאמה למוצרים – ordParse (orders.js). הרשאת ord (index.js)
  ordlist: { minFiles: 1, maxFiles: 3, temperature: 0, pro: false, timeoutMs: 30000, budgetMs: 100000 },
  // payproof = אסמכתת תשלום של לקוח (שלב 4, 15.11.2026): צ'ק / העברה / אשראי / מזומן – קובץ אחד. הרשאת ord (index.js)
  payproof: { minFiles: 1, maxFiles: 1, temperature: 0, pro: false, timeoutMs: 30000, budgetMs: 100000 },
});
// בדיקת סוג הזיהוי מול רשימה קבועה בלבד. Object.hasOwn ולא KINDS[kind], כי KINDS[kind] "מוצא" גם שמות
// שכל אובייקט ב-JavaScript מכיר מעצמו (__proto__, constructor, toString…) – פרצה שהבודק מצא בסבב 1.
const KIND_NAMES = Object.freeze(['invoice', 'product', 'feedback', 'zreport', 'opening', 'deposit', 'cashout', 'transfer', 'recipe', 'classify', 'invlines', 'ordlist', 'payproof']);
function isKind(kind) {
  return typeof kind === 'string' && KIND_NAMES.includes(kind) && Object.hasOwn(KINDS, kind) && Object.hasOwn(PROMPTS, kind);
}
function kindCfg(kind) {
  if (!isKind(kind)) throw bad('סוג זיהוי לא מוכר', 'bad-kind', { allowed: KIND_NAMES.slice() });
  return KINDS[kind];
}
// כמה זמן הטלפון מחכה לתשובה מ-scanDocument (לפי קוד האפליקציה בשלב 4, כפי שהועבר מהמתאם): חשבונית ומוצר 120 שניות, משוב 150.
// סגירת קופה (zreport, opening): 120 שניות (zcAI באפליקציה). אישור הפקדה (deposit): 120 שניות (dpScan). פתק הוצאה מקופה (cashout): 120 שניות (coScan). מתכון (recipe): 150.
const PHONE_WAIT_MS = { invoice: 120000, product: 120000, feedback: 150000, zreport: 120000, opening: 120000, deposit: 120000, cashout: 120000, transfer: 120000, recipe: 150000, classify: 120000, invlines: 120000, ordlist: 120000, payproof: 120000 };

// באמולטור בלבד: אפשר לקצר את כל הזמנים באותו יחס (SCAN_TIME_SCALE), כדי שבדיקות התקציב לא יחכו 100 שניות.
// מחוץ לאמולטור היחס תמיד 1.
function timeScale() {
  const v = Number(process.env.SCAN_TIME_SCALE);
  return process.env.FUNCTIONS_EMULATOR === 'true' && v > 0 && v <= 1 ? v : 1;
}
function timesFor(kind) {
  const k = timeScale(), c = kindCfg(kind);
  return { timeoutMs: Math.round(c.timeoutMs * k), budgetMs: Math.round(c.budgetMs * k) };
}

// ---------- סוג הקובץ: תמונה או PDF, לפי התוכן עצמו ולא רק לפי מה שהלקוח הצהיר ----------
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];
function sniff(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buf.length >= 5 && buf.slice(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf.length >= 12 && buf.slice(4, 8).toString('latin1') === 'ftyp') {
    const brand = buf.slice(8, 12).toString('latin1');
    if (['heic', 'heix', 'hevc', 'hevx'].includes(brand)) return 'image/heic';
    if (['mif1', 'msf1', 'heif'].includes(brand)) return 'image/heif';
  }
  return null;
}

function bad(message, reason, extra) {
  return new HttpsError('invalid-argument', message, Object.assign({ reason }, extra || {}));
}

// מחזיר { kind, cfg, files: [{ mimeType, data(base64), bytes }] } או זורק שגיאה ברורה בעברית.
function validateScanInput(data, maxFileBytes) {
  const kind = data.kind;
  const cfg = kindCfg(kind);
  const files = data.files;
  if (!Array.isArray(files) || files.length < cfg.minFiles || files.length > cfg.maxFiles
    || (cfg.allowedCounts && !cfg.allowedCounts.includes(files.length))) {
    throw bad('מספר הקבצים לא תקין לסוג הזיהוי הזה', 'bad-file-count');
  }
  const maxB64 = Math.ceil(maxFileBytes / 3) * 4;
  let total = 0;
  const out = files.map((f, i) => {
    if (!f || typeof f !== 'object' || typeof f.mimeType !== 'string' || typeof f.data !== 'string') throw bad(`קובץ ${i + 1}: חסרים סוג קובץ או תוכן`, 'bad-file');
    const mimeType = f.mimeType.toLowerCase().trim();
    if (!ALLOWED_MIME.includes(mimeType)) throw bad(`קובץ ${i + 1}: מותר רק תמונה או PDF`, 'bad-type');
    if (f.data.length > maxB64) throw bad(`קובץ ${i + 1}: הקובץ גדול מ-${Math.round(maxFileBytes / 1048576)}MB`, 'too-big');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(f.data) || f.data.length % 4 !== 0) throw bad(`קובץ ${i + 1}: התוכן לא בפורמט base64`, 'bad-base64');
    const buf = Buffer.from(f.data, 'base64');
    if (!buf.length) throw bad(`קובץ ${i + 1}: הקובץ ריק`, 'empty');
    if (buf.length > maxFileBytes) throw bad(`קובץ ${i + 1}: הקובץ גדול מ-${Math.round(maxFileBytes / 1048576)}MB`, 'too-big');
    const real = sniff(buf);
    const same = real === mimeType || (real && mimeType.startsWith('image/hei') && real.startsWith('image/hei'));
    if (!same) throw bad(`קובץ ${i + 1}: התוכן אינו תמונה או PDF מהסוג שהוצהר`, 'bad-type');
    total += buf.length;
    return { mimeType, data: f.data, bytes: buf.length };
  });
  if (total > maxFileBytes) throw bad(`הקבצים יחד גדולים מ-${Math.round(maxFileBytes / 1048576)}MB`, 'too-big');
  return { kind, cfg, files: out };
}

// הבקשה ל-Gemini – בדיוק כמו באפליקציה.
function buildGeminiBody(kind, files) {
  const cfg = kindCfg(kind); // שוב, ליתר ביטחון: רק אחד מהסוגים המוכרים
  const img = (f) => ({ inline_data: { mime_type: f.mimeType, data: f.data } });
  let parts;
  if (kind === 'feedback') {
    // fbAI: [{text:FB_P}, {text:'תמונה 1: …'}, תמונה, {text:'תמונה 2: …'}, תמונה, …]
    parts = [{ text: PROMPTS.feedback }];
    files.forEach((f, i) => { parts.push({ text: PROMPTS.feedbackCaptions[i] }, img(f)); });
  } else {
    parts = [{ text: PROMPTS[kind] }].concat(files.map(img)); // kind כבר נבדק ב-kindCfg למעלה
  }
  return { contents: [{ parts }], generationConfig: { responseMimeType: 'application/json', temperature: cfg.temperature } };
}

// ---------- מגבלה יומית לכל משתמש (מונה בשרת, בטרנזקציה) ----------
// המסמך scan_usage/{uid} = { day: 'YYYY-MM-DD' (שעון ישראל), count, updatedAt }. הכללים סוגרים אותו לגמרי.
const USAGE = 'scan_usage';
function israelDay(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d || new Date());
}

// ריבוי עסקים (שלב 5): המונים בתוך העסק (T.tdb(): בשורש ללארג' פעמי במצב legacy, אחרת b/{bizId}/scan_usage).
// בנוסף למונה לכל משתמש יש מונה לכל העסק (המסמך scan_usage/_biz), עם תקרה מ-b/{bizId}/private/info.adv.limits.scanDaily.
// ללארג' פעמי אין תקרת עסק אלא אם הוגדרה (בדיוק כמו היום). לעסק אחר בלי הגדרה: BIZ_DEFAULT_DAILY (הנחה).
const BIZ_DOC = '_biz';
const BIZ_DEFAULT_DAILY = 50;
// סריקה אחידה, שלב 2: סוג הגבלה לעסק (מנהל־על בלבד, setScanQuota) ב-b/{bizId}/private/info.scanQuota:
//   { period: 'day'|'week'|'month'|'total', n }  – N דפים ליום / לשבוע / לחודש / סך הכול בלי איפוס ("קבועה")
//   { release: { until: ms } }                   – שחרור החסימה עד רגע מסוים (יום/שבוע/חודש), ואחריו חוזרים להגבלה הרגילה
//   { release: { until: null } }                 – שחרור קבוע (ללא תפוגה)
// בלי scanQuota – בדיוק כמו היום (adv.limits.scanDaily, או ברירת המחדל). התקרה לכל משתמש נשארת תמיד.
// מפתח התקופה נשמר בשדה day של המונה _biz: ליום – YYYY-MM-DD (כמו היום), לשבוע – W:<יום ראשון>, לחודש – M:YYYY-MM, קבועה – T.
function periodKey(period, d) {
  const day = israelDay(d);
  if (period === 'week') {
    const [y, m, dd] = day.split('-').map(Number);
    const u = new Date(Date.UTC(y, m - 1, dd));
    u.setUTCDate(u.getUTCDate() - u.getUTCDay());
    return 'W:' + u.toISOString().slice(0, 10);
  }
  if (period === 'month') return 'M:' + day.slice(0, 7);
  if (period === 'total') return 'T';
  return day;
}
async function bizCaps(bizId, perUserDefault, now) {
  let lim = {}, q = null;
  try {
    const s = await getFirestore().doc(`b/${bizId}/private/info`).get();
    const l = s.exists && s.get('adv') && s.get('adv').limits;
    if (l && typeof l === 'object') lim = l;
    const sq = s.exists && s.get('scanQuota');
    if (sq && typeof sq === 'object' && !Array.isArray(sq)) q = sq;
  } catch (e) { /* בלי הגדרות – ברירות המחדל */ }
  const int = (v) => (Number.isInteger(v) && v >= 0 ? v : null);
  // 25.11.2026 (החלטת הבעלים): התקרה לכל משתמש – מה שמנהל־על קבע (adv.limits.scanPerUserDaily, גם מעל ברירת המחדל).
  // בלי הגדרה: ללארג' פעמי – בלי הגבלה (null); לעסק אחר – ברירת המחדל (SCAN_DAILY_LIMIT).
  const perUser = int(lim.scanPerUserDaily) !== null ? int(lim.scanPerUserDaily) : bizId === T.BIZ0 ? null : perUserDefault;
  let bizDaily = int(lim.scanDaily) !== null ? int(lim.scanDaily) : bizId === T.BIZ0 ? null : BIZ_DEFAULT_DAILY;
  if (!q) return { perUser, bizDaily };
  const t = now || Date.now();
  const rel = q.release && typeof q.release === 'object' ? q.release : null;
  if (rel && (rel.until === null || (Number.isInteger(rel.until) && rel.until > t))) return { perUser, bizDaily: null, period: 'release', releaseUntil: rel.until };
  if (QUOTA_PERIODS.includes(q.period) && int(q.n) !== null) return { perUser, bizDaily: int(q.n), period: q.period, bizKey: periodKey(q.period, new Date(t)) };
  return { perUser, bizDaily };
}
const QUOTA_PERIODS = ['day', 'week', 'month', 'total'];

// pages = כמה דפים נספרים במונה העסק (מספר הקבצים). המונה לכל משתמש סופר קריאות, כמו היום.
// bizKey/period – מ-bizCaps (סוג הגבלה של מנהל־על). בלי – מפתח יומי, כמו היום.
async function reserveScan(uid, limit, bizDaily, pages, bizKey, period) {
  const n = Number.isInteger(pages) && pages > 0 ? pages : 1;
  const db = T.tdb();
  const ref = db.doc(`${USAGE}/${uid}`);
  const bref = bizDaily == null ? null : db.doc(`${USAGE}/${BIZ_DOC}`);
  const day = israelDay();
  const bkey = bizKey || day;
  const r = await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const bs = bref ? await tx.get(bref) : null;
    const used = s.exists && s.get('day') === day ? (s.get('count') || 0) : 0;
    if (limit != null && used >= limit) {
      throw new HttpsError('resource-exhausted',
        `עברת את מגבלת השימוש היומית: ${limit} זיהויים ביום למשתמש. אפשר למלא ידנית, או לנסות שוב מחר.`,
        { reason: 'daily-limit', limit, used });
    }
    const bused = bs && bs.exists && bs.get('day') === bkey ? (bs.get('count') || 0) : 0;
    if (bref && bused + n > bizDaily) {
      const daily = !period || period === 'day';
      const word = { week: 'השבועית', month: 'החודשית', total: 'הכוללת' }[period] || 'היומית';
      throw new HttpsError('resource-exhausted',
        `העסק הגיע למגבלת הזיהויים ${word} (${bizDaily} דפים). אפשר למלא ידנית` + (daily ? ', או לנסות שוב מחר.' : '.'),
        { reason: daily ? 'biz-daily-limit' : 'biz-period-limit', period: period || 'day', limit: bizDaily, used: bused, pages: n });
    }
    // 25.11.2026: הודעה למנהלי העסק ב-80% וב-100% של המכסה – פעם אחת לכל תקופה (הסימון נשמר במונה עצמו, w80/w100 = מפתח התקופה)
    const ntf = [];
    const cross = (snap, key, before, after, cap) => {
      const up = {};
      if (cap == null || cap <= 0) return up;
      for (const [f, pct] of [['w80', 80], ['w100', 100]]) {
        const th = Math.ceil(cap * pct / 100);
        if (before < th && after >= th && !(snap && snap.exists && snap.get(f) === key)) { up[f] = key; ntf.push(pct); }
      }
      return up;
    };
    const uUp = cross(s, day, used, used + 1, limit);
    const uN = ntf.length;
    const bUp = bref ? cross(bs, bkey, bused, bused + n, bizDaily) : {};
    tx.set(ref, Object.assign({ day, count: used + 1, updatedAt: new Date().toISOString() }, uUp), { merge: true });
    if (bref) tx.set(bref, Object.assign({ day: bkey, count: bused + n, updatedAt: new Date().toISOString() }, bUp), { merge: true });
    return { day, used: used + 1, bizUsed: bref ? bused + n : null, nU: ntf.slice(0, uN), nB: ntf.slice(uN) };
  });
  if (r.nU.length || r.nB.length) {
    try { await quotaNotify(uid, r, limit, bizDaily, period); } catch (e) { /* הודעה שנכשלה לא מפילה את הזיהוי */ }
  }
  // refundScan (באותה קריאה) מחזיר גם את מונה העסק, אם נספר – באותו מפתח ובאותו מספר דפים
  const sc = T.scope();
  if (sc) Object.assign(sc, { scanBiz: !!bref, scanBizKey: bkey, scanPages: n });
  return r;
}

// 25.11.2026: הודעת דחיפה למנהלי העסק (admins) כשמשתמש או העסק מגיעים ל-80% / 100% מהמכסה. רק למנהל העסק (החלטת הבעלים).
// בבדיקות: _setNotify(fn) מחליף את השליחה. שמות משתמשים – מ-staff (שם בלבד), בלי פרטים נוספים.
let notifyHook = null;
function _setNotify(fn) { notifyHook = fn; }
async function quotaNotify(uid, r, limit, bizDaily, period) {
  const db = T.tdb();
  const sc = T.scope() || {};
  const msgs = [];
  if (r.nU.length) {
    let nm = '';
    try { const st = await db.doc('staff/' + uid).get(); nm = st.exists ? String(st.get('name') || '') : ''; } catch (e) { nm = ''; }
    const pct = Math.max(...r.nU);
    const who = nm ? nm.slice(0, 40) : (uid === 'sec' ? 'המזכירה' : 'משתמש');
    msgs.push(pct >= 100
      ? { id: 'su100', title: 'הגעתם למכסת הזיהויים', body: who + ' השתמש/ה היום בכל ' + limit + ' הזיהויים החכמים. המכסה מתאפסת בחצות.' }
      : { id: 'su80', title: 'מכסת הזיהויים מתקרבת', body: who + ' השתמש/ה היום ב-80% מהזיהויים החכמים (' + Math.ceil(limit * 0.8) + ' מתוך ' + limit + ').' });
  }
  if (r.nB.length) {
    const pct = Math.max(...r.nB);
    const word = { week: 'השבועית', month: 'החודשית', total: 'הכוללת', release: '' }[period] || 'היומית';
    const reset = period === 'total' ? 'פנו לספק להגדלה.' : period === 'week' ? 'המכסה מתאפסת בתחילת השבוע.' : period === 'month' ? 'המכסה מתאפסת בתחילת החודש.' : 'המכסה מתאפסת בחצות.';
    msgs.push(pct >= 100
      ? { id: 'sb100', title: 'העסק הגיע למכסת הזיהויים', body: 'נוצלו כל ' + bizDaily + ' הדפים במכסה ' + word + '. ' + reset }
      : { id: 'sb80', title: 'מכסת הזיהויים של העסק מתקרבת', body: 'נוצלו 80% מהמכסה ' + word + ' (' + Math.ceil(bizDaily * 0.8) + ' מתוך ' + bizDaily + ' דפים).' });
  }
  const adm = await db.collection('admins').limit(20).get();
  const to = adm.docs.map((d) => d.id);
  for (const m of msgs) {
    const msg = Object.assign({ k: 'scanq' }, m);
    if (notifyHook) { await notifyHook({ bizId: sc.bizId || T.BIZ0, to, msg }); continue; }
    const RM = require('../secretary-remind')._core;
    const { getMessaging } = require('firebase-admin/messaging');
    for (const u of to) {
      try {
        const toks = await RM.tokensOf(db, u);
        if (!toks.length) continue;
        await getMessaging().sendEachForMulticast({ tokens: toks, notification: { title: msg.title, body: msg.body }, data: { k: msg.k, id: msg.id }, android: RM.androidOf(msg.k + '_' + msg.id) });
      } catch (e) { /* בשקט */ }
    }
  }
}

// מחזירה למונה את הזיהוי שנספר ב-reserveScan. scanDocument קוראת לה רק כשאף בקשת זיהוי לא יצאה ל-Gemini
// (stats.sent === 0): למשל התקציב נגמר עוד לפני, או שלא נוצר חיבור בכלל (ECONNREFUSED / ENOTFOUND / EAI_AGAIN).
// כל ניסיון שבו בקשה יצאה – נספר, גם אם נכשל, נגמר לו הזמן או לא הגיעה תשובה (ייתכן שמשלמים עליו).
// סריקה אחידה: ההחזר אטומי – המונה של המשתמש ומונה העסק (כל הדפים שנספרו) בטרנזקציה אחת.
async function refundScan(uid, day) {
  const db = T.tdb();
  const sc = T.scope();
  const ref = db.doc(`${USAGE}/${uid}`);
  const bref = sc && sc.scanBiz ? db.doc(`${USAGE}/${BIZ_DOC}`) : null;
  const bkey = (sc && sc.scanBizKey) || day;
  const n = (sc && sc.scanPages) || 1;
  try {
    await db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      const bs = bref ? await tx.get(bref) : null;
      if (s.exists && s.get('day') === day && (s.get('count') || 0) > 0) tx.update(ref, { count: s.get('count') - 1 });
      if (bs && bs.exists && bs.get('day') === bkey && (bs.get('count') || 0) > 0) tx.update(bref, { count: Math.max(0, bs.get('count') - n) });
    });
    if (sc) sc.scanBiz = false; // לא להחזיר פעמיים
  } catch (e) { /* לא קריטי */ }
}

// ---------- Gemini (העתקה של shModels / shAIcall) ----------
const FALLBACK_MODELS = ['gemini-flash-latest', 'gemini-2.5-flash'];
const modelCache = { false: null, true: null };   // כמו SHML / SHMLP באפליקציה
const lastGood = { false: '', true: '' };         // כמו localStorage 'lp-gmodel' / 'lp-gmodelp'
// מגבלת הפלט (outputTokenLimit) של כל מודל, מרשימת המודלים. משמש רק כשהקורא מבקש opts.maxOut (טיוטת מפה, 15.11.2026)
const outLimit = {};

function assertSafeBase(base) {
  // באמולטור מותר לפנות רק לשרת דמה מקומי – אף פעם לא ל-Gemini האמיתי.
  if (process.env.FUNCTIONS_EMULATOR === 'true' && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) {
    throw new HttpsError('internal', 'באמולטור מותר לפנות רק לשרת דמה מקומי', { reason: 'emulator-outbound-blocked' });
  }
}

async function listModels(base, key, pro, deadline) {
  const cc = modelCache[pro];
  if (cc) return cc.slice();
  const out = [];
  if (lastGood[pro]) out.push(lastGood[pro]);
  // גם בקשת רשימת המודלים מוגבלת בזמן: עד 10 שניות, ולא יותר ממה שנשאר מהתקציב
  const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), Math.max(0, Math.min(10000 * timeScale(), deadline - Date.now())));
  try {
    const r = await fetch(`${base}/v1beta/models?pageSize=200`, { headers: { 'x-goog-api-key': key }, signal: ctl.signal });
    if (r.ok) {
      const j = await r.json();
      const L = (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent') && /gemini/.test(m.name)
        && !/image|tts|live|audio|embed|robotics|computer|gemma|-exp|aqa|imagen|veo|learnlm|vision/.test(m.name))
        .map((m) => {
          const n = m.name.replace('models/', ''), v = /(\d+(?:\.\d+)?)/.exec(n);
          if (Number.isInteger(m.outputTokenLimit) && m.outputTokenLimit > 0) outLimit[n] = m.outputTokenLimit;
          return { n, v: v ? parseFloat(v[1]) : 0, t: /lite/.test(n) ? (pro ? 2 : 1) : /flash/.test(n) ? (pro ? 1 : 0) : (pro ? 0 : 2), pv: /preview/.test(n) ? 0 : 1, lt: /latest/.test(n) ? 1 : 0 };
        })
        .sort((x, y) => x.t - y.t || y.v - x.v || y.pv - x.pv || y.lt - x.lt);
      L.slice(0, 6).forEach((m) => { if (!out.includes(m.n)) out.push(m.n); });
    }
  } catch (e) { /* כמו באפליקציה: בלי רשימה – ממשיכים עם ברירת המחדל */ } finally { clearTimeout(tm); }
  FALLBACK_MODELS.forEach((m) => { if (!out.includes(m)) out.push(m); });
  if (out.length > 2) modelCache[pro] = out.slice();
  return out;
}

const sleep = (ms) => new Promise((z) => setTimeout(z, ms));
const RETRY_WAIT_MS = Number(process.env.SCAN_RETRY_WAIT_MS || 1200);

// השגיאה כשנגמר תקציב הזמן הכולל. אם עד אז יצאה בקשה ל-Gemini, הקריאה נשארת ספורה במגבלה היומית;
// רק אם שום בקשה לא יצאה, scanDocument מחזירה אותה למונה (refundScan).
const budgetError = () => new HttpsError('deadline-exceeded',
  'הזיהוי החכם לקח יותר מדי זמן ולא הושלם. אפשר למלא ידנית או לנסות שוב.', { reason: 'time-budget' });
const MIN_TRY_MS = 50; // פחות מזה לא שווה לנסות מודל נוסף

// שגיאות רשת שבהן ברור שלא נוצר חיבור לשירות, ולכן הבקשה בוודאות לא הגיעה. כל שגיאת רשת אחרת
// (למשל חיבור שנקטע אחרי שהבקשה נשלחה) נחשבת כבקשה שיצאה.
const NO_CONNECTION_CODES = ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'];
function neverConnected(e) {
  const codes = [];
  for (const x of [e, e && e.cause]) {
    if (!x) continue;
    if (x.code) codes.push(x.code);
    if (Array.isArray(x.errors)) x.errors.forEach((y) => y && y.code && codes.push(y.code));
  }
  return codes.length > 0 && codes.every((c) => NO_CONNECTION_CODES.includes(c));
}

// deadline = רגע (במילישניות) שאחריו השרת לא מנסה יותר, ומחזיר שגיאה. ברירת מחדל: עכשיו + 100 שניות.
// opts.maxOut (לא חובה, טיוטת מפה 15.11.2026): maxOutputTokens מפורש – לכל מודל לא יותר ממגבלת הפלט שלו לפי רשימת המודלים.
// מחזיר { text, model, finish } – finish = finishReason של המודל (למשל STOP / MAX_TOKENS), או '' אם לא נשלח.
async function callGemini(base, key, body, timeoutMs, pro, opts) {
  assertSafeBase(base);
  const o = opts || {};
  // o.stats.sent = כמה בקשות זיהוי באמת יצאו ל-Gemini. scanDocument סופרת במגבלה היומית כל קריאה שבה יצאה בקשה אחת לפחות.
  const stats = o.stats || { sent: 0 };
  const deadline = o.deadline || (Date.now() + 100000);
  const left = () => deadline - Date.now();
  if (left() < MIN_TRY_MS) throw budgetError();
  let err = null;
  const nf = [], qt = [];
  const ms = await listModels(base, key, pro, deadline);
  for (const m of ms) {
    if (left() < MIN_TRY_MS) throw budgetError();
    let r;
    // הזמן למודל הזה נחתך כך שלא יעבור את מה שנשאר מהתקציב
    const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), Math.min(timeoutMs, left()));
    stats.sent++;
    try {
      r = await fetch(`${base}/v1beta/models/${m}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(o.maxOut ? withMaxOut(body, Math.min(o.maxOut, outLimit[m] || o.maxOut)) : body), signal: ctl.signal,
      });
    } catch (e) {
      clearTimeout(tm);
      if (e.name === 'AbortError') {
        if (left() < MIN_TRY_MS) throw budgetError();
        err = new HttpsError('deadline-exceeded', 'המודל ' + m + ' לא הגיב בזמן', { reason: 'timeout' });
        if (lastGood[pro] === m) lastGood[pro] = '';
        modelCache[pro] = null;
        continue;
      }
      if (neverConnected(e)) stats.sent--; // לא נוצר חיבור בכלל – הבקשה בוודאות לא הגיעה לשירות
      throw new HttpsError('unavailable', 'שירות הזיהוי החכם לא זמין כרגע. אפשר למלא ידנית.', { reason: 'network' });
    }
    clearTimeout(tm);
    // אחרי שהתקבלו הכותרות, גם קריאת גוף התשובה – תקינה או שגיאה – מוגבלת בזמן שנשאר מהתקציב.
    // בסוף הזמן החיבור מבוטל (ctl.abort) ומוחזרת שגיאת תקציב.
    const within = (p) => {
      let t;
      const timer = new Promise((_, no) => { t = setTimeout(() => { ctl.abort(); no(budgetError()); }, Math.max(0, left())); });
      return Promise.race([p, timer]).finally(() => clearTimeout(t));
    };
    const readJson = () => within(r.json());
    if (r.status === 404) { nf.push(m); err = new HttpsError('unavailable', 'המודל ' + m + ' לא קיים', { reason: 'model-not-found' }); if (lastGood[pro] === m) lastGood[pro] = ''; continue; }
    if ([500, 502, 503, 504].includes(r.status)) { err = new HttpsError('unavailable', 'הזיהוי עמוס כרגע, נסו שוב בעוד דקה', { reason: 'overloaded' }); await sleep(Math.max(0, Math.min(RETRY_WAIT_MS, left()))); continue; }
    if (r.status === 429) { qt.push(m); err = new HttpsError('resource-exhausted', 'המודל ' + m + ' חרג מהמכסה', { reason: 'gemini-quota' }); continue; }
    if (!r.ok) {
      const t = await within(r.text().catch(() => ''));
      if ((r.status === 400 && /API key/i.test(t)) || r.status === 403) throw new HttpsError('failed-precondition', 'מפתח הזיהוי החכם בשרת לא תקין או חסום', { reason: 'key-invalid' });
      throw new HttpsError('internal', 'שגיאה ' + r.status + ' משירות הזיהוי', { reason: 'gemini-error', status: r.status });
    }
    const j = await readJson();
    const c0 = (j.candidates || [])[0] || {};
    const pt = (c0.content || {}).parts;
    if (!pt) throw new HttpsError('internal', 'אין תשובה מהמודל' + (j.promptFeedback && j.promptFeedback.blockReason ? ' (' + j.promptFeedback.blockReason + ')' : ''), { reason: 'no-answer' });
    lastGood[pro] = m;
    return { text: pt.map((p) => p.text || '').join(''), model: m, finish: typeof c0.finishReason === 'string' ? c0.finishReason.slice(0, 30) : '' };
  }
  if (!o.isRetry && err && err.details && err.details.reason === 'overloaded') {
    await sleep(Math.max(0, Math.min(RETRY_WAIT_MS * 2.5, left())));
    return callGemini(base, key, body, timeoutMs, pro, { deadline, isRetry: true, stats, maxOut: o.maxOut });
  }
  if (qt.length && qt.length + nf.length === ms.length) {
    throw new HttpsError('resource-exhausted', 'עברת את מגבלת השימוש היומית של המפתח החינמי בכל המודלים. המכסה מתאפסת בערך ב-10:00 בבוקר, או אפשר להפעיל חיוב ב-AI Studio', { reason: 'gemini-quota' });
  }
  if (nf.length && nf.length === ms.length) {
    throw new HttpsError('failed-precondition', 'כל המודלים נדחו כ"לא קיים" (' + nf.join(', ') + '). ייתכן שהמפתח לא מאפשר שימוש בזיהוי', { reason: 'models-not-found' });
  }
  throw err || new HttpsError('unavailable', 'לא זמין', { reason: 'unavailable' });
}

// עותק רדוד של גוף הבקשה עם maxOutputTokens (הגוף המקורי לא משתנה)
function withMaxOut(body, n) {
  return Object.assign({}, body, { generationConfig: Object.assign({}, body && body.generationConfig, { maxOutputTokens: n }) });
}

// האפליקציה מפענחת היום כך: JSON.parse(String(t).replace(/```json|```/g,'').trim())
function parseLikeApp(text) {
  try {
    const o = JSON.parse(String(text).replace(/```json|```/g, '').trim());
    return o && typeof o === 'object' ? o : null;
  } catch (e) { return null; }
}

function _resetCacheForTests() { modelCache.false = null; modelCache.true = null; lastGood.false = ''; lastGood.true = ''; }

module.exports = {
  KINDS, KIND_NAMES, isKind, neverConnected, NO_CONNECTION_CODES, PHONE_WAIT_MS, timesFor, ALLOWED_MIME, sniff, validateScanInput, buildGeminiBody, israelDay, reserveScan, refundScan, bizCaps, BIZ_DEFAULT_DAILY, periodKey, QUOTA_PERIODS,
  callGemini, parseLikeApp, USAGE, _resetCacheForTests, _setNotify, quotaNotify,
};
