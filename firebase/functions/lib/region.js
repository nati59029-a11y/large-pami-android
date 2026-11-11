'use strict';
// אזורי הפונקציות (מעבר לאירופה, 11.11.2026).
// מסד הנתונים (Firestore) באירופה, ולכן כל פונקציה שהאפליקציה קוראת לה (onCall) מתפרסמת בשני אזורים:
//   europe-west1 – האזור החדש, קרוב למסד הנתונים. האפליקציה החדשה פונה אליו.
//   us-central1  – האזור הישן. נשאר עד שכל הטלפונים מתעדכנים (טלפון עם גרסה ישנה פונה לכאן).
// אותו קוד בדיוק בשני האזורים. אין minInstances (אין עלות קבועה).
// פונקציות שאסור להריץ כפול (מתוזמנת, טריגרים) או שכתובתן קבועה מחוץ לקוד (ימות, hosting) – רק ב-LEGACY_REGION, במפורש.
// סגירת האזור הישן (מחיקת הפונקציות ב-us-central1) – רק באישור מפורש, בשלב נפרד.
const https = require('firebase-functions/v2/https');

const NEW_REGION = 'europe-west1';
const LEGACY_REGION = 'us-central1';
const CALL_REGIONS = [NEW_REGION, LEGACY_REGION];

// כמו onCall של firebase-functions, עם אזור ברירת מחדל = שני האזורים. מי שמציין region במפורש – גובר.
function onCall(optsOrHandler, handler) {
  if (handler === undefined) return https.onCall({ region: CALL_REGIONS }, optsOrHandler);
  return https.onCall({ region: CALL_REGIONS, ...optsOrHandler }, handler);
}

module.exports = { onCall, NEW_REGION, LEGACY_REGION, CALL_REGIONS };
