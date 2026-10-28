'use strict';
// פונקציות שרת של שלב 0 (מוכנות לפרסום, אבל לא מפורסמות מכאן):
//   scanDocument       – זיהוי חשבונית, מוצר או טופס משוב דרך Gemini, עם המפתח בכספת של השרת.
//   registerPushToken  – רישום הטלפון להתראות: staff/{uid}.pushTokens.
//   reportBackupStatus – עדכון מצב הגיבוי: app_backup_status/{uid} של השולח בלבד.
//   getBackupKey       – מפתח הצפנה קבוע לכל משתמש, נגזר מ-BACKUP_MASTER_KEY ומהמזהה שלו.
// כולן: רק מנהל (admins/{uid}) או עובד פעיל (staff/{uid}.active == true). התפקיד נקרא מהמסד בכל קריאה.

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const { defineSecret, defineInt, defineString } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');

const { requireStaff, inputObject } = require('./lib/roles');
const scan = require('./lib/scan');
const { deriveBackupKey, KEY_VERSION } = require('./lib/backupKey');

initializeApp();

// אזור ברירת המחדל של Firebase. מגבלת מופעים נמוכה – הגנה על העלות.
const REGION = 'us-central1';
setGlobalOptions({ region: REGION, maxInstances: 5 });

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
  async (request) => {
    const who = await requireStaff(request);
    const input = inputObject(request);
    const maxBytes = SCAN_MAX_FILE_MB.value() * 1024 * 1024;
    const { kind, cfg, files } = scan.validateScanInput(input, maxBytes);
    const key = GEMINI_API_KEY.value();
    if (!key) throw new HttpsError('failed-precondition', 'אין מפתח לזיהוי חכם בשרת', { reason: 'no-key' });
    const limit = SCAN_DAILY_LIMIT.value();
    const usage = await scan.reserveScan(who.uid, limit);
    try {
      const body = scan.buildGeminiBody(kind, files);
      const r = await scan.callGemini(GEMINI_API_BASE.value().replace(/\/+$/, ''), key, body, cfg.timeoutMs, cfg.pro);
      return { text: r.text, data: scan.parseLikeApp(r.text), model: r.model, usage: { day: usage.day, used: usage.used, limit } };
    } catch (e) {
      await scan.refundScan(who.uid, usage.day);
      if (e instanceof HttpsError) throw e;
      throw new HttpsError('internal', 'שגיאה בזיהוי', { reason: 'internal' });
    }
  },
);

// =====================================================================================
// registerPushToken
// קלט: { token }  ←  מוסיף ל-staff/{uid}.pushTokens (בלי כפילויות). מעל MAX_PUSH_TOKENS – הישן ביותר יוצא.
// פלט: { ok: true, count, removed }
// =====================================================================================
const TOKEN_RE = /^[A-Za-z0-9_:.\-]+$/;
exports.registerPushToken = onCall(async (request) => {
  const who = await requireStaff(request);
  const input = inputObject(request);
  const token = typeof input.token === 'string' ? input.token.trim() : '';
  if (token.length < 20 || token.length > 4096 || !TOKEN_RE.test(token)) {
    throw new HttpsError('invalid-argument', 'מזהה הטלפון להתראות לא תקין', { reason: 'bad-token' });
  }
  const max = MAX_PUSH_TOKENS.value();
  const db = getFirestore();
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
});

// =====================================================================================
// reportBackupStatus
// קלט: { file, device }  –  file = שם קובץ הגיבוי שכבר הועלה ל-app_backups/{uid}/ של השולח.
// השרת בודק שהקובץ באמת קיים, לוקח את הגודל מ-Storage (לא מהלקוח), ואת השעה מהשעון של השרת.
// כותב: app_backup_status/{uid} = { lastBackupAt (ISO), size, device }   ←  של השולח בלבד.
// =====================================================================================
const FILE_RE = /^[A-Za-z0-9._-]{1,200}$/;
exports.reportBackupStatus = onCall(async (request) => {
  const who = await requireStaff(request);
  const input = inputObject(request);
  const file = typeof input.file === 'string' ? input.file : '';
  if (!FILE_RE.test(file) || file === '.' || file === '..') throw new HttpsError('invalid-argument', 'שם קובץ הגיבוי לא תקין', { reason: 'bad-file' });
  if (input.uid != null && input.uid !== who.uid) throw new HttpsError('permission-denied', 'אפשר לעדכן רק את הגיבוי של עצמך', { reason: 'other-user' });
  const device = typeof input.device === 'string' ? input.device.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 100) : '';
  const bucketName = BACKUP_BUCKET.value();
  const obj = (bucketName ? getStorage().bucket(bucketName) : getStorage().bucket()).file(`app_backups/${who.uid}/${file}`);
  const [exists] = await obj.exists();
  if (!exists) throw new HttpsError('not-found', 'קובץ הגיבוי לא נמצא בשרת', { reason: 'no-backup-file' });
  const [meta] = await obj.getMetadata();
  const status = { lastBackupAt: new Date().toISOString(), size: Number(meta.size) || 0, device };
  await getFirestore().doc('app_backup_status/' + who.uid).set(status);
  return status;
});

// =====================================================================================
// getBackupKey
// קלט: אין (אם נשלח uid של מישהו אחר – נדחה).  פלט: { key /* base64, 32 בתים */, alg: 'AES-GCM', bits: 256, version }
// =====================================================================================
exports.getBackupKey = onCall({ secrets: [BACKUP_MASTER_KEY] }, async (request) => {
  const who = await requireStaff(request);
  const input = inputObject(request);
  if (input.uid != null && input.uid !== who.uid) throw new HttpsError('permission-denied', 'אפשר לקבל רק את המפתח של עצמך', { reason: 'other-user' });
  const key = deriveBackupKey(BACKUP_MASTER_KEY.value(), who.uid);
  return { key: key.toString('base64'), alg: 'AES-GCM', bits: 256, version: KEY_VERSION };
});
