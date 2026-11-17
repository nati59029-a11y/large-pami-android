'use strict';
// פונקציות שרת של שלב 0 (מוכנות לפרסום, אבל לא מפורסמות מכאן):
//   scanDocument       – זיהוי חשבונית, מוצר, טופס משוב, דוח Z או הצהרת פתיחת קופה דרך Gemini, עם המפתח בכספת של השרת.
//   registerPushToken  – רישום הטלפון להתראות: staff/{uid}.pushTokens (וטלפון עם כפתורים – גם pushAct).
//   reportBackupStatus – עדכון מצב הגיבוי: app_backup_status/{uid} של השולח בלבד.
//   getBackupKey       – מפתח הצפנה קבוע לכל משתמש, נגזר מ-BACKUP_MASTER_KEY ומהמזהה שלו.
//   sendPromoToLine (עובד/מנהל), expirePromosOnLine (מתוזמנת, לא נקראת ממשתמש) – מבצע לקו ימות והורדתו (yemot.js).
//   publishLineItem, getLineState (עובד/מנהל), removeLineItem, listLineFiles (מנהל) – תוכן שלוחות הקו (yemot-line.js).
//   previewVoice (עובד/מנהל) – "שמע קודם" בקול המשוכפל (ElevenLabs, yemot-line.js + lib/voice.js).
//   recurringTasks (מתוזמנת, לא נקראת ממשתמש) – משימות קבועות (recurring.js).
//   s3Rounds (מתוזמנת), s3Run, s3Move, s3Log, s3View – סבבי סריקת חנות בתלת מימד (store3d.js).
//   s3SaveMap, s3SetBranch (מנהל־על), s3PutTex – המפה של סריקת החנות: שמירה עם נעילה וגרסאות, הגדרות סניף, טקסטורות (store3d-map.js).
//   s3PutPano, s3DelPano – נקודות סיור 360 (שלב 18א, store3d-map.js).
//   shelfCheck, mapDraft – בדיקת מדף וטיוטת מפה דרך Gemini, עם מכסה חודשית לסניף (store3d-ai.js).
//   s3MovePh – העברת תמונה בין מקטעים בסבב, בלי AI ובלי מכסה (שלב 20ב, store3d-ai.js).
//   mapFix – תיקון טיוטת מפה בכתב דרך Gemini, בלי מכסה (רק הבלם היומי לעובד) (store3d-fix.js).
//   s3Fix, s3Clean – משימות תיקון, ניקוי יומי וביצועי עובדים (store3d-extra.js).
// כולן: רק מנהל (admins/{uid}) או עובד פעיל (staff/{uid}.active == true). התפקיד נקרא מהמסד בכל קריאה.

const { HttpsError } = require('firebase-functions/v2/https');
const { onCall, LEGACY_REGION } = require('./lib/region'); // onCall בשני אזורים (europe-west1 + us-central1) – lib/region.js
const { setGlobalOptions } = require('firebase-functions/v2');
const logger = require('firebase-functions/logger');
const { defineSecret, defineInt, defineString } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
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
    // שורות מוצרים מחשבונית ספק (invlines): expW (מי שמכניס את החשבונית) או prc (עדכון מחירים ומלאי – "נסה לזהות שוב")
    if (who.biz && who.biz.dataRoot === 'b' && ((['invoice', 'cashout', 'check'].includes(kind) && !hasPerm(who, 'expW')) || (['zreport', 'opening', 'deposit'].includes(kind) && !hasPerm(who, 'incW'))
      || (kind === 'invlines' && !hasPerm(who, 'expW') && !hasPerm(who, 'prc')))) {
      throw new HttpsError('permission-denied', 'אין לך הרשאה לפעולה הזו. פנה למנהל.', { reason: 'no-perm' });
    }
    // צילום רשימת הזמנה (ordlist, 14.11.2026): התוספת "הזמנות" והרשאת ord – בכל העסקים (גם legacy), לפני הספירה במכסה
    if ((kind === 'ordlist' || kind === 'payproof') && (!(who.biz && who.biz.features && who.biz.features.orders === true) || !hasPerm(who, 'ord'))) throw new HttpsError('permission-denied', 'אין לך הרשאה להזמנות. פנה למנהל.', { reason: 'no-perm' });
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
// המזכירה שלב 4: מנהל בלי רשומת עובד (רק admins/{uid}) – נרשם ב-push_tokens/{uid} (אותו מבנה; שרת בלבד, אין גישה מהאפליקציה).
// מי שיש לו staff/{uid} – בדיוק כמו קודם. מי שאין לו לא staff ולא admins (למשל מנהל־על שאינו מנהל העסק) – אותה שגיאה כמו קודם.
// פלט: { ok: true, count, removed, moved } – moved = מכמה משתמשים אחרים הטלפון הוסר
// כפתורים בהתראה (16.11.2026): { token, act: 1 } – הטלפון תומך בכפתורים (הדגל מגיע מהקוד של אנדרואיד) → גם pushAct (באותו מסמך, תת־קבוצה של pushTokens).
// בלי act – pushAct לא משתנה (גם orders/api.js רושם את אותו טלפון בלי act – אסור שזה יבטל את הכפתורים). act: 0 – הטלפון יוצא מ-pushAct.
// pushTokens כמו קודם. מסמך בלי pushAct וטלפון בלי act – לא נוסף שדה (המבנה הישן נשמר). מעבר למשתמש אחר / קיצוץ / dropTokens – יוצא גם מ-pushAct.
// תיקוני אבטחה (16.11.2026), תוספות בלבד – בלי מיגרציה:
//   pushActAt  { <sha256 של הטלפון>: זמן } – הרישום האחרון עם act:1 (מסכים חדשים שולחים תמיד act: 1 או 0).
//   pushPlainAt { <sha256>: זמן } – הרישום האחרון בלי act של טלפון שנמצא ב-pushAct (מסכים ישנים / חזרה ל-APK בלי כפתורים).
//   הכלל (tokensAct ב-secretary-remind.js): כפתורים רק אם pushActAt קיים, מלפני פחות מ-30 יום, ואין אחריו pushPlainAt. אחרת – ההודעה הרגילה.
//   שתי המפות נשמרות רק לטלפונים שעדיין ב-pushTokens, ונכתבות רק במסמך שיש בו pushAct (או ברישום עם act:1).
//   push_dev/{sha256} { biz, uid, t } (בשורש) – למי הטלפון רשום עכשיו בכל העסקים; נכתב בכל רישום. pushAct דורש שהשיוך יתאים (push-act.js).
// מכשיר אחד למשתמש (16.11.2026, one-device.js): קלט אופציונלי s = מזהה הכניסה (אותו s של devClaim).
//   s של הטלפון הנוכחי (dev_cur/{uid}.phone.sh) – נרשם, phone.fh = sha256(הטלפון), וכל שאר הטלפונים של המשתמש יוצאים (pushTokens / pushAct / push_dev).
//   בלי s (מסכים ישנים / orders/api.js) – כמו קודם, רק אם אין רישום טלפון או שזה הטלפון הנוכחי (fh). אחרת { ok: false, reason: 'not-current' } בלי שום כתיבה.
//   s שלא תואם, כשיש רישום טלפון – אותו דבר. מנהל־העל ומתג ONE_DEVICE=off – כמו קודם. ONE_DEVICE=log – כמו קודם + יומן (גם עם s תואם לא מוחקים טלפונים אחרים).
// =====================================================================================
const TOKEN_RE = /^[A-Za-z0-9_:.\-]+$/;
exports.registerPushToken = onCall(T.scoped(async (request) => {
  const who = await requireStaff(request);
  const input = inputObject(request);
  const token = typeof input.token === 'string' ? input.token.trim() : '';
  const act = input.act === 1 || input.act === true ? 1 : input.act === 0 || input.act === false ? 0 : null; // null = לא נשלח – בלי שינוי
  if (token.length < 20 || token.length > 4096 || !TOKEN_RE.test(token)) {
    throw new HttpsError('invalid-argument', 'מזהה הטלפון להתראות לא תקין', { reason: 'bad-token' });
  }
  const max = MAX_PUSH_TOKENS.value();
  const db = T.tdb(); // staff/{uid} בתוך העסק (בשורש ללארג' פעמי במצב legacy)
  const staffRef = db.doc('staff/' + who.uid);
  const mgrRef = db.doc('push_tokens/' + who.uid);
  const OD = require('./one-device')._core;
  const odMode = who.superadmin ? 'off' : OD.mode(); // מנהל־העל – פטור
  const sIn = typeof input.s === 'string' ? input.s : null;
  const curRef = getFirestore().doc(OD.pathOf(who.uid));
  const out = await db.runTransaction(async (tx) => {
    const [st, adm, cd] = await Promise.all([tx.get(staffRef), tx.get(db.doc('admins/' + who.uid)), odMode === 'off' ? null : tx.get(curRef)]);
    // מכשיר אחד: mine = הטלפון הנוכחי עם s (רק הוא נשאר רשום). אין רישום טלפון – כמו קודם
    const ph = cd ? OD.kindOf(cd, 'phone') : null;
    const mine = !!ph && sIn !== null && ph.sh === OD.sha(sIn);
    const solo = mine && odMode === 'on'; // רק במצב on שאר הטלפונים יוצאים. log – רק יומן, בלי למחוק טלפונים
    let ref = staffRef, s = st;
    if (!st.exists && adm.exists) { ref = mgrRef; s = await tx.get(mgrRef); }
    else if (!st.exists) throw new HttpsError('failed-precondition', 'אין לך עדיין רשומה ברשימת העובדים (staff). המנהל צריך להוסיף אותה.', { reason: 'no-staff-doc' });
    if (ph && !mine && !(sIn === null && ph.fh === OD.sha(token))) {
      if (odMode === 'on') return { ok: false, reason: 'not-current' };
      logger.info('registerPushToken: not current phone (log only)');
    }
    // התראות לטלפון (12.11.2026): טלפון אחד = משתמש אחד. אם הטלפון היה רשום למשתמש אחר בעסק (למשל עובד נכנס בטלפון שהיה של מנהל),
    // הוא יוצא מהמשתמש הקודם – כדי שעובד לא יקבל התראות של מנהל. כל הקריאות לפני הכתיבות (חובה בטרנזקציה).
    const others = await Promise.all(['staff', 'push_tokens'].map((c) => tx.get(db.collection(c).where('pushTokens', 'array-contains', token).limit(20))));
    const old = (Array.isArray(s.get('pushTokens')) ? s.get('pushTokens') : []).filter((t) => typeof t === 'string' && t !== token);
    const all = old.concat([token]);
    const kept = solo ? [token] : all.slice(Math.max(0, all.length - max));
    let moved = 0;
    for (const q of others) {
      for (const d of q.docs) {
        if (d.ref.path === ref.path) continue;
        tx.update(d.ref, Object.assign({ pushTokens: FieldValue.arrayRemove(token) }, Array.isArray(d.get('pushAct')) ? { pushAct: FieldValue.arrayRemove(token) } : {}));
        moved++;
      }
    }
    // pushAct: רק טלפונים שעדיין ב-pushTokens (גם אחרי שהישן ביותר יצא)
    const hadAct = Array.isArray(s.get('pushAct'));
    const prev = (hadAct ? s.get('pushAct') : []).filter((t) => typeof t === 'string');
    const keepTok = act === 1 || (act === null && prev.includes(token));
    const acts = prev.filter((t) => t !== token && kept.includes(t)).concat(keepTok && kept.includes(token) ? [token] : []);
    const now = Date.now();
    const PA = require('./push-act')._core;
    const h = PA.hashOf(token);
    const keptH = new Set(kept.map((t) => PA.hashOf(t)));
    const mapIn = (f) => { const v = s.get(f); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; };
    const prune = (m) => Object.fromEntries(Object.entries(m || {}).filter(([k, v]) => keptH.has(k) && typeof v === 'number'));
    const actAt = prune(mapIn('pushActAt')), plainAt = prune(mapIn('pushPlainAt'));
    if (act === 1) actAt[h] = now;
    if (act === 0) { delete actAt[h]; delete plainAt[h]; }
    if (act === null && prev.includes(token)) plainAt[h] = now; // מסכים ישנים – הכפתורים נעצרים עד רישום חדש עם act:1
    const upd = Object.assign({ pushTokens: kept }, hadAct || act === 1 ? { pushAct: acts, pushActAt: actAt } : {},
      (hadAct || act === 1) && (mapIn('pushPlainAt') || Object.keys(plainAt).length) ? { pushPlainAt: plainAt } : {});
    if (ref === mgrRef) tx.set(ref, Object.assign(upd, { upd: now }));
    else tx.update(ref, upd);
    // השיוך הגלובלי של הטלפון (שרת בלבד) – גם בלי act. טלפון שעבר לעסק אחר: השיוך עובר איתו, והעסק הקודם כבר לא יכול לפעול דרכו
    tx.set(getFirestore().doc(PA.devPath(token)), { biz: who.bizId, uid: who.uid, t: now });
    if (mine) tx.update(curRef, { 'phone.fh': h });
    return { ok: true, count: kept.length, removed: all.length - kept.length, moved, _drop: solo ? old : null };
  });
  // הטלפון הנוכחי: שאר הטלפונים יוצאים גם מהמסמך השני (staff / push_tokens) ומ-push_dev (רק אם עדיין של המשתמש)
  const drop = out._drop;
  delete out._drop;
  if (drop) {
    try {
      const RM = require('./secretary-remind')._core;
      const rest = [...new Set(drop.concat(await RM.tokensOf(db, who.uid)))].filter((t) => t !== token);
      if (rest.length) await RM.dropTokens(db, who.uid, rest);
    } catch (e) { logger.warn('registerPushToken: drop other phones failed', { name: e && e.name, code: e && e.code }); }
  }
  return out;
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
// + setLineLayout (מנהל, משימה 2026-11-17): "כל התוכן בשלוחה אחת" (yemot_state/layout)
Object.assign(exports, require('./yemot-line'));

// "ההודעות שבקו" (משימה 2026-11-04, שלב 5): getLineBoard, getLineAudio (עובד/מנהל), extendLineItem, restoreLineItem (מנהל)
Object.assign(exports, require('./yemot-board'));

// לקוחות משוב ← רשימת התפוצה "לקוחות משוב" בימות (משימה 2026-11-17, שלב 4): yemotFbList (מנהל)
Object.assign(exports, require('./yemot-fblist'));

// ריבוי עסקים (משימה 2026-11-05, שלב 5): פונקציות ניהול – createBusiness, inviteBusinessAdmin,
// setBusinessStatus, setBusinessFeatures, setBusinessAdv, setYemotToken, logBusinessEntry, addStaff, setStaffActive (completeInvite הוסרה בשלב 6ג: כניסה ראשונה במייל המובנה של Firebase)
Object.assign(exports, require('./business'));

// דף הפתיחה להזמנה (2026-11-08): publicBrand – שם תצוגה, לוגו וצבעים בלבד, ציבורי, עם הגבלת קצב
Object.assign(exports, require('./public-brand'));

// מייל הזמנה עצמי (2026-11-08): sendInviteMail – קישור מהשרת לדף welcome.html, שליחה ב-Gmail (MAIL_USER/MAIL_APP_PASSWORD), נפילה למייל של Firebase
Object.assign(exports, require('./invite-mail'));

// מערכת הזמנות – שלב 1 (2026-11-08): מוצרים ומלאי לכל סניף, הזמנות עובד, תשלום ידני וקישור סליקה (orders.js)
Object.assign(exports, require('./orders'));
// מסך טיפול/ליקוט (14.11.2026, משוב סבב 3): orderPick, orderPickOk, supOrdSet – ord-pick.js; orderAuth ("המסגרת אושרה", החלטה 32, 15.11.2026)
Object.assign(exports, require('./ord-pick'));
// תמחור מחשבונית ספק (12.11.2026): pinv – piCreate, piClaim, piBeat, piRelease, piDraft, piFinish, piVoid, piImg (צילום, שלב 4)
Object.assign(exports, require('./pricing'));

// מסמכים ללקוח (14.11.2026, שלב 3 חלק א'): arFile – קישור עם אסימון לקובץ PDF (onRequest, us-central1 בלבד). ar-file.js
Object.assign(exports, require('./ar-file'));
// אישור הזמנה (14.11.2026, שלב 3 חלק ב'): arOc (מספור רץ נפרד + קובץ + שליחה אוטומטית לפי סימון הלקוח), arPdf, arSend, setArCfg. ar.js
// חשבוניות, קבלות וזיכויים (15.11.2026, שלב 4): arIssue, arReceipt, arCredit, arVoidRc, arProof, arProofGet, arDoc, arMonthly, setArOff. ar.js + lib/ar-doc.js
Object.assign(exports, require('./ar'));
// כרטסת ותזכורות (15.11.2026, שלב 5): arStatement, setRemCfg (ar.js); arRemind – מתוזמנת כל 15 דקות (ar-remind.js)
Object.assign(exports, require('./ar-remind'));
// ייבוא מתוכנה קודמת (15.11.2026, שלב 6): arImp (תצוגה מקדימה / ייבוא במנות של 25), arImpVoid (ביטול קבוצה = void), arImpList. ar-import.js
Object.assign(exports, require('./ar-import'));

// לקוחות להזמנות (2026-11-08, fb/ord-cust): saveCust, importCusts, setCustCfg (customers.js)
Object.assign(exports, require('./customers'));

// המזכירה העסקית – שלב 1 (2026-11-11): secState, secConsent, secSetup (מנהל העסק), secAdminGet, secAdminSetCfg, secAdminReadChat (מנהל־על),
// secBackupDaily (מתוזמנת – גיבוי אוספי sec_* ל-Storage). secretary.js
Object.assign(exports, require('./secretary'));
// המזכירה שלב 3 (2026-11-11): secFacts, secSens (מידע רגיש מוצפן), secRules, secCal, secImport. secretary-know.js
Object.assign(exports, require('./secretary-know'));
// ייבוא קבצים ברקע (2026-11-11, שלב 3): startImport (מנהל, שני האזורים) + runImportChunk (טריגר, europe-west1 בלבד) – imports.js
Object.assign(exports, require('./imports'));
// המזכירה שלב 4 (2026-11-11): secNotes, secReports, secHistory (מנהל העסק), secRemind (מתוזמנת – תזכורות, דוחות, התראות), secDaily (מתוזמנת – שמירה ומחיקה 9.5). secretary-remind.js
Object.assign(exports, require('./secretary-remind'));
// המזכירה שלב 5 (2026-11-11): secWaHook (webhook ווצאפ, us-central1 בלבד – כתובת קבועה אצל Meta), secWaWork (טריגר תור, europe-west1),
// secInbox, secSend, secWaCfg (מנהל העסק), secAdminWa (מנהל־על). secretary-wa.js
Object.assign(exports, require('./secretary-wa'));
// המזכירה שלב 6 (2026-11-12): secOAuthCb (חזרה מ-Google, us-central1 בלבד – כתובת קבועה אצל Google), secMailHook (Pub/Sub – התראות Gmail),
// secCalSync (מתוזמנת – יומן Google וחידוש התראות Gmail), secGoogle, secMail, secMailSend (מנהל העסק), secAdminMail (מנהל־על). secretary-google.js
// שלב ב של המייל (14.11): secMailWork (טריגר על התור sec_mailq, europe-west1) – טיוטה אוטומטית למייל מאדם, משימה מהמייל ושליחה אוטומטית לפי כלל מאושר
Object.assign(exports, require('./secretary-google'));
// המזכירה שלב 7 (2026-11-12): secInv (רשימה, קובץ, הגדרות, רשימת ספקים), secDecide (תפיסה חד־פעמית, אישור, דחייה, עיכוב, ביטול, אישור שולח).
// הזיהוי רץ בטריגר הקיים secWaWork (רשומת תור עם inv:true). secretary-inv.js
Object.assign(exports, require('./secretary-inv'));
// "תגובה למזכירה" (15.11.2026): secLearn – תגובה על הודעה של המזכירה, כללים אישיים לכל מנהל, "לעשות את זה מעכשיו לבד?", יומן "נשלח לבד". secretary-learn.js + lib/sec-learn.js
Object.assign(exports, require('./secretary-learn'));
// קול, תמונה וסרטון למזכירה (15.11.2026): secMedia (תמלול, תמונה/סרטון, סימון כרטיס), secMediaClean (ניקוי הקבצים הזמניים ב-sec_tmp). secretary-media.js
Object.assign(exports, require('./secretary-media'));

// משימות קבועות (12.11.2026): recurringTasks – מתוזמנת כל 5 דקות, פותחת משימות מכללי rtk (recurring.js + lib/tk-time.js)
Object.assign(exports, require('./recurring'));
// מרכז עבודה סבב 3 (15.11.2026): tkNudge – "הזכר לעובד" בהתראת טלפון (tasks-nudge.js). לא מפורסם עד מיזוג ואישור
Object.assign(exports, require('./tasks-nudge'));
// קבוצות התכתבות סבב 3 (17.11.2026): grpMsg / grpMsgB – התראה לטלפון על הודעה חדשה בקבוצה ועדכון grp/{gid}.last; grpDel / grpDelB – מחיקה מדורגת של קבוצה (grp-notify.js). לא מפורסם עד מיזוג ואישור
Object.assign(exports, require('./grp-notify'));
// דיווח יומי (16.11.2026): drSubmit, drMgr, drSetCfg (מנהל), drSetCap (מנהל־על), drRemind (מתוזמנת, us-central1 בלבד). daily-rep.js + lib/dr-core.js. לא מפורסם עד מיזוג ואישור
Object.assign(exports, require('./daily-rep'));
// כפתורים בהתראת הטלפון (16.11.2026): pushAct – "טופל" / "הזכר לי מחר" / "בעוד שעה" עם אסימון חד־פעמי (onRequest, us-central1 בלבד). push-act.js
Object.assign(exports, require('./push-act'));
// מכשיר אחד למשתמש (16.11.2026): devClaim – טלפון אחד + מחשב אחד, כניסה חדשה מחליפה את הקודמת (onCall, שני האזורים). one-device.js
Object.assign(exports, require('./one-device'));

// סריקת חנות בתלת מימד – שלב 5 (14.11.2026): s3Rounds (מתוזמנת כל 5 דקות – פתיחת סבבים, תזכורות, איחור, העברה למחליף),
// s3Run (פתיחה ידנית/ביטול – מנהל), s3Move (העברה/לקיחה), s3Log (אירועי זמן), s3View (מה עובד רואה). store3d.js + lib/store3d-core.js
Object.assign(exports, require('./store3d'));
// שלב 5ב (14.11.2026): s3SaveMap (מנהל / s3m; נעילה לפי baseV, גרסאות, 30 אחרונות), s3SetBranch (מנהל־על, audit), s3PutTex (טקסטורה ל-Storage).
// store3d-map.js + lib/store3d-map.js. שלב 18א (15.11.2026): s3PutPano (נקודת 360 – מנהל / s3m), s3DelPano (מחיקה רכה – מנהל).
Object.assign(exports, require('./store3d-map'));
// שלב 8 (14.11.2026): shelfCheck (בדיקת מדף – עובד אחראי בסבב / דיווח יזום), mapDraft (טיוטת מפה – מנהל / s3m). Gemini, מכסה חודשית לסניף
// (s3use, אזהרה ב-80%) ובלם יומי לעובד, החזרה בכשל, תמונה עם אדם לא נשמרת. store3d-ai.js + lib/store3d-ai.js
Object.assign(exports, require('./store3d-ai'));
// שלב 20ג (15.11.2026): mapFix (תיקון טיוטה בכתב – מנהל / s3m). טקסט בלבד, בלי תמונות; לא נספר במכסה (החלטת המשתמש), רק בלם 400 ביום לעובד.
// store3d-fix.js + lib/store3d-fix.js
Object.assign(exports, require('./store3d-fix'));
// שלב 10 (14.11.2026): s3Fix (משימת תיקון ידנית / ביטול / הכרעה – מנהל), s3Clean (מתוזמנת יומית: סל מחזור אחרי 30 יום, 3 סבבים אחרונים
// של תמונות לכל מקום, טקסטורות יתומות, ביצועי עובדים). סיום סבב (ציון, חוסרים, משימות תיקון) וערעורים – store3d-extra.js + lib/store3d-extra.js
Object.assign(exports, require('./store3d-extra'));
// הקמת חנות שלב 3 (17.11.2026): s3CapPut (צילום החנות לפי תוכנית הצילום – תמונה / חזית / דילוג; מנהל או s3m), s3SetupDone (סיום ההקמה). s3cap.js + lib/store3d-capplan.js
Object.assign(exports, require('./s3cap'));
// הקמת חנות שלב 2 (17.11.2026): s3SetupNote (הערה כללית / לפריט), mapQs (שאלות AI על הטיוטה, מחוץ למכסה), s3SetupAns (תשובות). store3d-setup.js + lib/store3d-setup.js
Object.assign(exports, require('./store3d-setup'));
// הקמת חנות שלב 5 (17.11.2026): s3CapCheck (בדיקה חכמה לפריט – מכסת הקמה למפה), s3CapDec ("המערכת מציעה"), s3SetupLim (תקרת מכסת ההקמה – מנהל־על). s3capai.js + lib/store3d-capai.js + lib/prompts-bayscan.js
Object.assign(exports, require('./s3capai'));

// אפליקציה עם סמל העסק – בנייה מיידית (12.11.2026): requestBizApk – מנהל־על בלבד, מפעיל את build-biz-apks ב-GitHub (biz-apk.js)
Object.assign(exports, require('./biz-apk'));
