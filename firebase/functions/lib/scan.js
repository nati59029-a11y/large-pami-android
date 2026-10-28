'use strict';
// scanDocument: בדיקת הקלט, מגבלה יומית, ופנייה ל-Gemini.
// הפנייה ל-Gemini היא העתקה של מה שהאפליקציה עושה היום (shModels + shAIcall ב-www/index.html),
// עם אותן הנחיות (prompts), אותן הגדרות ואותו סדר ניסיון של מודלים. ההבדל היחיד: המפתח נמצא בשרת.

const { HttpsError } = require('firebase-functions/v2/https');
const { getFirestore } = require('firebase-admin/firestore');
const PROMPTS = require('./prompts');

// ---------- סוגי זיהוי (מה האפליקציה מזהה היום) ----------
// invoice  = ocrAI  (חשבונית / תעודת משלוח), עד 4 עמודים, temperature 0
// product  = shAI   (צילום מוצר למדף), תמונה אחת, temperature 0.1
// feedback = fbAI   (טופס משוב לקוחות), תמונה אחת או 4 (דף מלא + 3 הגדלות), temperature 0.1, מודל "pro", עד 150 שניות
// timeoutMs = זמן מרבי למודל אחד (כמו באפליקציה היום).
// budgetMs  = תקציב זמן כולל לכל הקריאה בשרת (כל המודלים, ההמתנות והניסיון החוזר יחד).
//             תמיד קצר מהזמן שהטלפון מחכה (PHONE_WAIT_MS), כדי שהשרת יסיים ויחזיר תשובה לפני שהטלפון מוותר.
const KINDS = Object.freeze({
  invoice: { minFiles: 1, maxFiles: 4, temperature: 0, pro: false, timeoutMs: 30000, budgetMs: 100000 },
  product: { minFiles: 1, maxFiles: 1, temperature: 0.1, pro: false, timeoutMs: 30000, budgetMs: 100000 },
  feedback: { allowedCounts: [1, 4], minFiles: 1, maxFiles: 4, temperature: 0.1, pro: true, timeoutMs: 150000, budgetMs: 135000 },
});
// בדיקת סוג הזיהוי מול רשימה קבועה בלבד. Object.hasOwn ולא KINDS[kind], כי KINDS[kind] "מוצא" גם שמות
// שכל אובייקט ב-JavaScript מכיר מעצמו (__proto__, constructor, toString…) – פרצה שהבודק מצא בסבב 1.
const KIND_NAMES = Object.freeze(['invoice', 'product', 'feedback']);
function isKind(kind) {
  return typeof kind === 'string' && KIND_NAMES.includes(kind) && Object.hasOwn(KINDS, kind) && Object.hasOwn(PROMPTS, kind);
}
function kindCfg(kind) {
  if (!isKind(kind)) throw bad('סוג זיהוי לא מוכר', 'bad-kind', { allowed: KIND_NAMES.slice() });
  return KINDS[kind];
}
// כמה זמן הטלפון מחכה לתשובה מ-scanDocument (לפי קוד האפליקציה בשלב 4, כפי שהועבר מהמתאם): חשבונית ומוצר 120 שניות, משוב 150.
const PHONE_WAIT_MS = { invoice: 120000, product: 120000, feedback: 150000 };

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
  const cfg = kindCfg(kind); // שוב, ליתר ביטחון: רק אחד משלושת הסוגים
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

async function reserveScan(uid, limit) {
  const db = getFirestore();
  const ref = db.doc(`${USAGE}/${uid}`);
  const day = israelDay();
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const used = s.exists && s.get('day') === day ? (s.get('count') || 0) : 0;
    if (used >= limit) {
      throw new HttpsError('resource-exhausted',
        `עברת את מגבלת השימוש היומית: ${limit} זיהויים ביום למשתמש. אפשר למלא ידנית, או לנסות שוב מחר.`,
        { reason: 'daily-limit', limit, used });
    }
    tx.set(ref, { day, count: used + 1, updatedAt: new Date().toISOString() });
    return { day, used: used + 1 };
  });
}

// מחזירה למונה את הזיהוי שנספר ב-reserveScan. scanDocument קוראת לה רק כשאף בקשת זיהוי לא יצאה ל-Gemini
// (stats.sent === 0): למשל התקציב נגמר עוד לפני, או שלא נוצר חיבור בכלל (ECONNREFUSED / ENOTFOUND / EAI_AGAIN).
// כל ניסיון שבו בקשה יצאה – נספר, גם אם נכשל, נגמר לו הזמן או לא הגיעה תשובה (ייתכן שמשלמים עליו).
async function refundScan(uid, day) {
  const db = getFirestore();
  const ref = db.doc(`${USAGE}/${uid}`);
  try {
    await db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      if (s.exists && s.get('day') === day && (s.get('count') || 0) > 0) tx.update(ref, { count: s.get('count') - 1 });
    });
  } catch (e) { /* לא קריטי */ }
}

// ---------- Gemini (העתקה של shModels / shAIcall) ----------
const FALLBACK_MODELS = ['gemini-flash-latest', 'gemini-2.5-flash'];
const modelCache = { false: null, true: null };   // כמו SHML / SHMLP באפליקציה
const lastGood = { false: '', true: '' };         // כמו localStorage 'lp-gmodel' / 'lp-gmodelp'

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
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body), signal: ctl.signal,
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
    if ([500, 502, 503, 504].includes(r.status)) { err = new HttpsError('unavailable', 'המודל ' + m + ' עמוס כרגע', { reason: 'overloaded' }); await sleep(Math.max(0, Math.min(RETRY_WAIT_MS, left()))); continue; }
    if (r.status === 429) { qt.push(m); err = new HttpsError('resource-exhausted', 'המודל ' + m + ' חרג מהמכסה', { reason: 'gemini-quota' }); continue; }
    if (!r.ok) {
      const t = await within(r.text().catch(() => ''));
      if ((r.status === 400 && /API key/i.test(t)) || r.status === 403) throw new HttpsError('failed-precondition', 'מפתח הזיהוי החכם בשרת לא תקין או חסום', { reason: 'key-invalid' });
      throw new HttpsError('internal', 'שגיאה ' + r.status + ' משירות הזיהוי', { reason: 'gemini-error', status: r.status });
    }
    const j = await readJson();
    const pt = (((j.candidates || [])[0] || {}).content || {}).parts;
    if (!pt) throw new HttpsError('internal', 'אין תשובה מהמודל' + (j.promptFeedback && j.promptFeedback.blockReason ? ' (' + j.promptFeedback.blockReason + ')' : ''), { reason: 'no-answer' });
    lastGood[pro] = m;
    return { text: pt.map((p) => p.text || '').join(''), model: m };
  }
  if (!o.isRetry && err && err.details && err.details.reason === 'overloaded') {
    await sleep(Math.max(0, Math.min(RETRY_WAIT_MS * 2.5, left())));
    return callGemini(base, key, body, timeoutMs, pro, { deadline, isRetry: true, stats });
  }
  if (qt.length && qt.length + nf.length === ms.length) {
    throw new HttpsError('resource-exhausted', 'עברת את מגבלת השימוש היומית של המפתח החינמי בכל המודלים. המכסה מתאפסת בערך ב-10:00 בבוקר, או אפשר להפעיל חיוב ב-AI Studio', { reason: 'gemini-quota' });
  }
  if (nf.length && nf.length === ms.length) {
    throw new HttpsError('failed-precondition', 'כל המודלים נדחו כ"לא קיים" (' + nf.join(', ') + '). ייתכן שהמפתח לא מאפשר שימוש בזיהוי', { reason: 'models-not-found' });
  }
  throw err || new HttpsError('unavailable', 'לא זמין', { reason: 'unavailable' });
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
  KINDS, KIND_NAMES, isKind, neverConnected, NO_CONNECTION_CODES, PHONE_WAIT_MS, timesFor, ALLOWED_MIME, sniff, validateScanInput, buildGeminiBody, israelDay, reserveScan, refundScan,
  callGemini, parseLikeApp, USAGE, _resetCacheForTests,
};
