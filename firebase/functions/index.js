'use strict';
// פונקציות שרת של שלב 0 (מוכנות לפרסום, אבל לא מפורסמות מכאן):
//   scanDocument       – זיהוי חשבונית, מוצר, טופס משוב, דוח Z או הצהרת פתיחת קופה דרך Gemini, עם המפתח בכספת של השרת.
//   registerPushToken  – רישום הטלפון להתראות: staff/{uid}.pushTokens.
//   reportBackupStatus – עדכון מצב הגיבוי: app_backup_status/{uid} של השולח בלבד.
//   getBackupKey       – מפתח הצפנה קבוע לכל משתמש, נגזר מ-BACKUP_MASTER_KEY ומהמזהה שלו.
//   sendPromoToLine (עובד/מנהל), expirePromosOnLine (מתוזמנת, לא נקראת ממשתמש) – מבצע לקו ימות והורדתו (yemot.js).
//   publishLineItem, getLineState (עובד/מנהל), removeLineItem, listLineFiles (מנהל) – תוכן שלוחות הקו (yemot-line.js).
//   previewVoice (עובד/מנהל) – "שמע קודם" בקול המשוכפל (ElevenLabs, yemot-line.js + lib/voice.js).
//   recurringTasks (מתוזמנת, לא נקראת ממשתמש) – משימות קבועות (recurring.js).
// כולן: רק מנהל (admins/{uid}) או עובד פעיל (staff/{uid}.active == true). התפקיד נקרא מהמסד בכל קריאה.

const { HttpsError } = require('firebase-functions/v2/https');
const { onCall, LEGACY_REGION } = require('./lib/region'); // onCall בשני אזורים (europe-west1 + us-central1) – lib/region.js
const { setGlobalOptions } = require('firebase-functions/v2');
const { defineSecret, defineInt, defineString } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');

const { requireStaff, inputObject, hasPerm } = require('./lib/roles');
const scan = require('./lib/scan');
const CL = require('./lib/classify');
const { deriveBackupKey, KEY_VERSION } = require('./lib/backupKey');
const T = require('./lib/tenant');

initializeApp();

// אזור ברירת מחדל = האזור הישן (לכל מה שלא קובע אזור). פונקציות onCall מתפרסמות בשני אזורים דרך lib/region.js.
// מגבלת מופעים נמוכה – הגנה על העלות.
setGlobalOptions({ region: LEGACY_REGION, maxInstances: 5 });

// ---- סודות (Secret Manager). באמולטור: ערכי דמה מתוך functions/.secret.local, שלא נכנס למאגר ----
const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
const BACKUP_MASTER_KEY = defineSecret('BACKUP_MASTER_KEY');

// ---- הגדרות שאפשר לשנות בלי לגעת בקוד (functions/.env) ----
const SCAN_DAILY_LIMIT = defineInt('SCAN_DAILY_LIMIT', { default: 100, description: 'מספר זיהויים מותר ביום לכל משתמש' });
const SCAN_MAX_FILE_MB = defineInt('SCAN_MAX_FILE_MB', { default: 10, description: 'גודל מרבי לקובץ בזיהוי (MB)' });
const MAX_PUSH_TOKENS = defineInt('MAX_PUSH_TOKENS', { default: 5, description: 'מספר מרבי של טלפונים רשומים להתראות לכל משתמש' });
const GEMINI_API_BASE = defineString('GEMINI_API_BASE', { default: 'https://generativelanguage.googleapis.com', description: 'כתובת השירות של Gemini' });
const BACKUP_BUCKET = defineString('BACKUP_BUCKET', { default: '', description: 'שם ה-bucket של הגיבויים ב-Storage. ריק = ברירת המחדל של הפרויקט' });

// =====================================================================================
// scanDocument
// קלט:  { kind: 'invoice' | 'product' | 'feedback', files: [{ mimeType, data /* base64, בלי "data:...;base64," */ }] }
// פלט:  { text, data, model, usage: { day, used, limit } }
//   text  – בדיוק המחרוזת ש-shAIcall מחזירה היום באפליקציה (חלקי הטקסט של התשובה, מחוברים).
//   data  – אותה מחרוזת אחרי JSON.parse, כמו שהאפליקציה מפענחת היום (null אם לא JSON).
// =====================================================================================
exports.scanDocument = onCall(
  { secrets: [GEMINI_API_KEY], timeoutSeconds: 300, memory: '512MiB' },
  T.scoped(async (request) => {
    // ריבוי עסקים: התוספת "זיהוי חכם" (scan) חייבת להיות מופעלת – נבדק לפני כל דבר אחר, ולכן כבויה = אין שליחה ל-Gemini
    const who = await requireStaff(request, { feature: 'scan' });
    const input = inputObject(request);
    const maxBytes = SCAN_MAX_FILE_MB.value() * 1024 * 1024;
    const { kind, cfg, files } = scan.validateScanInput(input, maxBytes);
    // סריקה אחידה: classify מותר למי שיש לו לפחות סוג מסמך אחד (expW/incW/trf). מה שמוחזר מסונן לפי הסוגים המותרים.
    const allowed = kind === 'classify' ? CL.allowedTypes(who) : null;
    // חלק ג' §5א: צ'ק אצל עובד = route:'mgr' (לא נדחה). הזכאות לסריקה עצמה – לפי הסוגים האחרים, כמו קודם
    const route = kind === 'classify' && who.role !== 'manager';
    // החלטת המשתמש (8.11): גם עובד בלי שום הרשאת הזנה שסורק צ'ק – נשלח למנהל (route:'mgr'). לכן אין דחייה מוקדמת של עובד: כל סוג אחר מוחזר allowed:false בלי שדות
    // (נוגע בהרשאות: עובד בלי הרשאות יכול לצרוך סריקה אחת במכסה היומית של העסק)
    if (kind === 'classify' && !route && !allowed.length) throw new HttpsError('permission-denied', 'אין לך הרשאה להכניס מסמכים. פנה למנהל.', { reason: 'no-perm' });
    // צילום העברה בנקאית – מנהל בלבד (החלטת המשתמש). נבדק לפני הספירה במכסה היומית ולפני Gemini
    if (kind === 'transfer' && who.role !== 'manager' && !(who.biz && who.biz.dataRoot === 'b' && hasPerm(who, 'trf'))) throw new HttpsError('permission-denied', 'צילום העברה מותר למנהל בלבד.', { reason: 'manager-only' });
    // 6ה: מתגי עובד (רק בעסק במבנה b; בעסק legacy – כמו היום). חשבונית/הוצאה מקופה = expW; דוח Z/פתיחה/הפקדה = incW
    if (who.biz && who.biz.dataRoot === 'b' && ((['invoice', 'cashout', 'check'].includes(kind) && !hasPerm(who, 'expW')) || (['zreport', 'opening', 'deposit'].includes(kind) && !hasPerm(who, 'incW')))) {
      throw new HttpsError('permission-denied', 'אין לך הרשאה לפעולה הזו. פנה למנהל.', { reason: 'no-perm' });
    }
    const key = GEMINI_API_KEY.value();
    if (!key) throw new HttpsError('failed-precondition', 'אין מפתח לזיהוי חכם בשרת', { reason: 'no-key' });
    const limit = SCAN_DAILY_LIMIT.value();
    // תקציב הזמן מתחיל עכשיו: 100 שניות לחשבונית ולמוצר, 135 למשוב – תמיד פחות ממה שהטלפון מחכה
    const t = scan.timesFor(kind);
    const deadline = Date.now() + t.budgetMs;
    // מגבלה לפי עסק (תקרה מ-b/{bizId}/private/info.adv.limits) – בנוסף למגבלה לכל משתמש. המונים בתוך העסק.
    const caps = await scan.bizCaps(who.bizId, limit);
    // מונה העסק סופר דפים (מספר הקבצים): דוח Z = 3, חשבונית בת 4 עמודים = 4, classify = 1
    const usage = await scan.reserveScan(who.uid, caps.perUser, caps.bizDaily, files.length, caps.bizKey, caps.period);
    const stats = { sent: 0 };
    try {
      const body = scan.buildGeminiBody(kind, files);
      const r = await scan.callGemini(GEMINI_API_BASE.value().replace(/\/+$/, ''), key, body, t.timeoutMs, cfg.pro, { deadline, stats });
      const u = { day: usage.day, used: usage.used, limit };
      if (kind !== 'classify') return { text: r.text, data: scan.parseLikeApp(r.text), model: r.model, usage: u };
      // classify: בלי text גולמי (כדי שסוג חסום לא ידלוף), רק התשובה המסוננת
      const raw = scan.parseLikeApp(r.text);
      if (!raw) throw new HttpsError('internal', 'התשובה מהזיהוי לא נקראה. אפשר למלא ידנית או לנסות שוב.', { reason: 'bad-answer' });
      return { result: CL.shapeClassify(raw, allowed, { route }), model: r.model, usage: Object.assign(u, { pages: files.length, bizUsed: usage.bizUsed, bizLimit: caps.bizDaily, period: caps.period || 'day' }) };
    } catch (e) {
      // classify (החלטת המשתמש 33): דף שנכשל לא נספר – כל כשל מחזיר את הדף, בטרנזקציה אחת (משתמש + עסק).
      // שאר הסוגים – כמו היום (מוחזר רק כשאף בקשה לא יצאה).
      if (kind === 'classify') { await scan.refundScan(who.uid, usage.day); if (e instanceof HttpsError) throw e; throw new HttpsError('internal', 'שגיאה בזיהוי', { reason: 'internal' }); }
      // נספר במגבלה היומית כל ניסיון שבו יצאה בקשה ל-Gemini (גם אם נגמר הזמן או לא הגיעה תשובה – ייתכן שמשלמים עליו).
      // מוחזר למונה רק ניסיון שבו שום בקשה לא יצאה (למשל: התקציב נגמר עוד לפני, או שגיאת רשת).
      if (stats.sent === 0) await scan.refundScan(who.uid, usage.day);
      if (e instanceof HttpsError) throw e;
      throw new HttpsError('internal', 'שגיאה בזיהוי', { reason: 'internal' });
    }
  }),
);

// =====================================================================================
// registerPushToken
// קלט: { token }  ←  מוסיף ל-staff/{uid}.pushTokens (בלי כפילויות). מעל MAX_PUSH_TOKENS – הישן ביותר יוצא.
// פלט: { ok: true, count, removed }
// =====================================================================================
const TOKEN_RE = /^[A-Za-z0-9_:.\-]+$/;
exports.registerPushToken = onCall(T.scoped(async (request) => {
  const who = await requireStaff(request);
  const input = inputObject(request);
  const token = typeof input.token === 'string' ? input.token.trim() : '';
  if (token.length < 20 || token.length > 4096 || !TOKEN_RE.test(token)) {
    throw new HttpsError('invalid-argument', 'מזהה הטלפון להתראות לא תקין', { reason: 'bad-token' });
  }
  const max = MAX_PUSH_TOKENS.value();
  const db = T.tdb(); // staff/{uid} בתוך העסק (בשורש ללארג' פעמי במצב legacy)
  const ref = db.doc('staff/' + who.uid);
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) throw new HttpsError('failed-precondition', 'אין לך עדיין רשומה ברשימת העובדים (staff). המנהל צריך להוסיף אותה.', { reason: 'no-staff-doc' });
    const old = (Array.isArray(s.get('pushTokens')) ? s.get('pushTokens') : []).filter((t) => typeof t === 'string' && t !== token);
    const all = old.concat([token]);
    const kept = all.slice(Math.max(0, all.length - max));
    tx.update(ref, { pushTokens: kept });
    return { ok: true, count: kept.length, removed: all.length - kept.length };
  });
}));

// =====================================================================================
// reportBackupStatus
// קלט: { file, device }  –  file = שם קובץ הגיבוי שכבר הועלה ל-app_backups/{uid}/ של השולח.
// השרת בודק שהקובץ באמת קיים, לוקח את הגודל מ-Storage (לא מהלקוח), ואת השעה מהשעון של השרת.
// כותב: app_backup_status/{uid} = { lastBackupAt (ISO), size, device }   ←  של השולח בלבד.
// =====================================================================================
const FILE_RE = /^[A-Za-z0-9._-]{1,200}$/;
exports.reportBackupStatus = onCall(T.scoped(async (request) => {
  const who = await requireStaff(request);
  const input = inputObject(request);
  const file = typeof input.file === 'string' ? input.file : '';
  if (!FILE_RE.test(file) || file === '.' || file === '..') throw new HttpsError('invalid-argument', 'שם קובץ הגיבוי לא תקין', { reason: 'bad-file' });
  if (input.uid != null && input.uid !== who.uid) throw new HttpsError('permission-denied', 'אפשר לעדכן רק את הגיבוי של עצמך', { reason: 'other-user' });
  const device = typeof input.device === 'string' ? input.device.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 100) : '';
  const bucketName = BACKUP_BUCKET.value();
  const obj = (bucketName ? getStorage().bucket(bucketName) : getStorage().bucket()).file(`${who.prefix}app_backups/${who.uid}/${file}`);
  const [exists] = await obj.exists();
  if (!exists) throw new HttpsError('not-found', 'קובץ הגיבוי לא נמצא בשרת', { reason: 'no-backup-file' });
  const [meta] = await obj.getMetadata();
  const status = { lastBackupAt: new Date().toISOString(), size: Number(meta.size) || 0, device };
  await T.tdb().doc('app_backup_status/' + who.uid).set(status);
  return status;
}));

// =====================================================================================
// getBackupKey
// קלט: אין (אם נשלח uid של מישהו אחר – נדחה).  פלט: { key /* base64, 32 בתים */, alg: 'AES-GCM', bits: 256, version }
// =====================================================================================
exports.getBackupKey = onCall({ secrets: [BACKUP_MASTER_KEY] }, T.scoped(async (request) => {
  const who = await requireStaff(request);
  const input = inputObject(request);
  if (input.uid != null && input.uid !== who.uid) throw new HttpsError('permission-denied', 'אפשר לקבל רק את המפתח של עצמך', { reason: 'other-user' });
  const key = deriveBackupKey(BACKUP_MASTER_KEY.value(), who.uid);
  return { key: key.toString('base64'), alg: 'AES-GCM', bits: 256, version: KEY_VERSION };
}));

// 6ז (עדכון חוזה 17): cashoutTotal – סכום ההוצאות מקופה לסגירה, בשרת (לעובד שלא רואה את כל ההוצאות). מחזיר רק { s, diff? }.
exports.cashoutTotal = onCall(T.scoped(require('./lib/cashout-total').cashoutTotal));

// שליחת מבצעים לקו ימות המשיח (שלוחה 2): sendPromoToLine, expirePromosOnLine
Object.assign(exports, require('./yemot'));

// תוכן שלוחות הקו (שלוחות 1, 3, 4 והפתיחה): publishLineItem, removeLineItem, getLineState
Object.assign(exports, require('./yemot-line'));

// "ההודעות שבקו" (משימה 2026-11-04, שלב 5): getLineBoard, getLineAudio (עובד/מנהל), extendLineItem, restoreLineItem (מנהל)
Object.assign(exports, require('./yemot-board'));

// ריבוי עסקים (משימה 2026-11-05, שלב 5): פונקציות ניהול – createBusiness, inviteBusinessAdmin,
// setBusinessStatus, setBusinessFeatures, setBusinessAdv, setYemotToken, logBusinessEntry, addStaff, setStaffActive (completeInvite הוסרה בשלב 6ג: כניסה ראשונה במייל המובנה של Firebase)
Object.assign(exports, require('./business'));

// דף הפתיחה להזמנה (2026-11-08): publicBrand – שם תצוגה, לוגו וצבעים בלבד, ציבורי, עם הגבלת קצב
Object.assign(exports, require('./public-brand'));

// מייל הזמנה עצמי (2026-11-08): sendInviteMail – קישור מהשרת לדף welcome.html, שליחה ב-Gmail (MAIL_USER/MAIL_APP_PASSWORD), נפילה למייל של Firebase
Object.assign(exports, require('./invite-mail'));

// מערכת הזמנות – שלב 1 (2026-11-08): מוצרים ומלאי לכל סניף, הזמנות עובד, תשלום ידני וקישור סליקה (orders.js)
Object.assign(exports, require('./orders'));

// לקוחות להזמנות (2026-11-08, fb/ord-cust): saveCust, importCusts, setCustCfg (customers.js)
Object.assign(exports, require('./customers'));

// ייבוא קבצים ברקע (2026-11-11, שלב 3): startImport (מנהל, שני האזורים) + runImportChunk (טריגר, europe-west1 בלבד) – imports.js
Object.assign(exports, require('./imports'));

// משימות קבועות (12.11.2026): recurringTasks – מתוזמנת כל 5 דקות, פותחת משימות מכללי rtk (recurring.js + lib/tk-time.js)
Object.assign(exports, require('./recurring'));

// אפליקציה עם סמל העסק – בנייה מיידית (12.11.2026): requestBizApk – מנהל־על בלבד, מפעיל את build-biz-apks ב-GitHub (biz-apk.js)
Object.assign(exports, require('./biz-apk'));
