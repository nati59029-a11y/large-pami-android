# firebase/ – כללי הרשאות, פונקציות שרת ובדיקות באמולטור (שלב 0)

התיקייה הזו **לא** משתתפת בבניית האפליקציה, ושום דבר ממנה לא מפורסם מכאן.
פרסום הכללים והפונקציות לפרויקט האמיתי `largpeami` דורש אישור מפורש של בעל הפרויקט, ומעבר לתוכנית Blaze.

| קובץ | מה יש בו |
|---|---|
| `firestore.rules` | כללי Firestore: 7 האוספים הקיימים + `staff` + `app_backup_status`. כל השאר סגור. |
| `storage.rules` | כללי Storage: רק `app_backups/{uid}/`. כל השאר סגור. |
| `firebase.json` | הגדרות האמולטור (Firestore 8080, Storage 9199, Auth 9099, Functions 5001) ומיקום הפונקציות. |
| `functions/` | 4 פונקציות השרת: `scanDocument`, `registerPushToken`, `reportBackupStatus`, `getBackupKey` (`functions/index.js`). |
| `functions/.env` | הגדרות שאינן סודות: מגבלה יומית (100), גודל קובץ (10MB), מספר טלפונים (5). |
| `functions/.env.demo-largpeami` | רק לאמולטור: Gemini מוחלף בשרת דמה מקומי (127.0.0.1:9799). |
| `functions/lib/prompts.js` | ההנחיות ל-Gemini, מועתקות אוטומטית מהאפליקציה (`node scripts/app-prompts.js --write`). |
| `scripts/ensure-emulator-secrets.js` | יוצר `functions/.secret.local` עם ערכי דמה (לא נכנס למאגר). |
| `tests/permissions-matrix.json` | הרשימה "אוסף × תפקיד × פעולה" לפי טבלת ההרשאות באפיון (פרקים 3.3, 20.3). |
| `tests/app-operations.json` | כל פעולה של האפליקציה מול Firestore, עם שורה בקוד (ה-ZIP של הבסיס c9bac16). |
| `tests/*.js` | הבדיקות. `tests/all.test.js` מריץ את כולן בסדר קבוע. |

## הרצה
```
cd firebase
npm install
npm test
```
דרוש: Node 20 ומעלה, Java 21 (לאמולטור). הפקודה מפעילה אמולטור מקומי בפרויקט דמה `demo-largpeami`, מריצה את הבדיקות, וסוגרת אותו.
בסוף מודפס: `==== סיכום: N בדיקות עברו, 0 נכשלו ====`.

`npm install` מתקין גם את התלויות של `functions/`. `npm test` יוצר (אם חסר) קובץ סודות דמה לאמולטור,
מפעיל את האמולטורים של Auth, Firestore, Storage ו-Functions, ושרת דמה של Gemini. אין שום פנייה החוצה.

הערה לסביבה עם שרת מתווך (proxy): אם האמולטור של Storage לא מצליח לקרוא מ-Firestore המקומי, מריצים כך:
`env -u JAVA_TOOL_OPTIONS -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy npm test`
