# קופה – חומרה (LpPosPlugin) – בדיקות

## מה יש
- `app-source/android-plugin/LpPosEscPos.java` – פקודות ESC/POS, המרת תמונה לנקודות (סף או Floyd-Steinberg), פסי `GS v 0`, פתיחת מגירה (`ESC p`), פענוח מצב (`DLE EOT 1/2/4`). Java נקי.
- `LpPosTransport.java` – חיבור רשת (TCP 9100) ומדפסת מדומה (mock). Java נקי.
- `LpPosBtUsb.java` – בלוטות' (SPP, רק מכשירים מצומדים) ו-USB (OTG).
- `LpPosRender.java` – ציור הקבלה כתמונה (עברית, עמודות, לוגו, ברקוד, QR).
- `LpPosDisplay.java` – מסך לקוח שני (Presentation, WebView בלי JavaScript ובלי רשת).
- `LpPosPlugin.java` – התוסף (`LpPos`).
- `app-source/www/pos-hw.js` – השכבה ב-JS (`window.LpPosHw`): הגדרת מדפסת למכשיר, זיהוי סורק במצב מקלדת, מסך לקוח, מצב רכיבים וחלון "בדיקת ציוד".

## גל 2 – ש7: חומרה, מכשירים וגיבוי (17.11.2026)
- `www/pos-devices.js` – הממשק `Devices` לכל מודולי הקופה: `print` (תמונת קבלה או קבלה), `openDrawer(reason)`, `reprint`, תור "ממתין להדפסה" `lp-pos-prnq`,
  קודים מפורשים `PAPER_OUT` / `OFFLINE` / `NO_PRINTER` / `ERROR` והודעות לקופאי בעברית, `onScan`, `showCustomer`, `beep`, `vibrate`, `state()` / `blocked()`
  (קופה שנותקה מרחוק / מחכה לאישור), דיווח מצב ציוד לשרת ודיווח תקלה (`reportErr`) בלי פרטים אישיים. בלי תוסף (מחשב) – חלון ההדפסה.
- `www/pos-admin-hw.js` – "ציוד ומכשירים" באזור הניהול: בדיקת ציוד והגדרת מדפסת למכשיר, מצב ציוד חי לכל הקופות, אישור מכשיר, ניתוק מרחוק והחזרה.
  הכפתור הזמני בסוף מסך ההגדרות הכללי **הוסר** (במסך הקופה אין הגדרות).
- `www/pos-admin-ops.js` – "תפעול": גיבוי ושחזור, יומן תקלות, התנגשויות, הזנה ידנית אחרי תקלה.
- `www/pos-help.js` – כפתור "?" ועזרה קצרה לכל מסך, ומדריך התקנת ציוד לבעל העסק.
- `firebase/functions/pos-ops.js` – `posOps` (approve / kill / unkill / hw / err / conf / manual) ו-`posOpsWatch` (מתוזמן: תור ארוך/ישן, תקלה חמורה → התראה לבעלים).
- `firebase/functions/pos-backup.js` – `posBackup` (list / now / restore) ו-`posBackupDaily` (מתוזמן: גיבוי לילי מוצפן, עותק חודשי, ניקוי).
- התוסף (P1–P9): קודי שגיאה מפורשים בהדפסה, בדיקת נייר לפני ואחרי, אירוע USB עם vid/pid וחיבור מחדש של התור, `intent-filter` למדפסת USB
  (אנדרואיד מציע "תמיד" – ההרשאה נשמרת), `vibrate` (הרשאת `VIBRATE`, בלי שאלה), `showCustomer`, מקום למתאם Sunmi (לא בנוי).

## גל 3 – קופה במחשב Windows (Chrome), 19.11.2026
- `www/pos-hw-web.js` (`window.LpPosWeb`) – "תוסף" JS לדפדפן עם ממשק LpPos. `pos-hw.js` משתמש בו רק כשאין תוסף מקורי ולא רצים בתוך האפליקציה (באנדרואיד – בלי שינוי).
  ציור הקבלה ב-canvas (העתק של `LpPosRender`), CODE128 ו-QR בלי ספרייה. סוגי מדפסת: `win` (iframe + `window.print`, ל-Chrome עם `--kiosk-printing`;
  המגירה – דרך מנהל ההתקן; "ללא מכירה" = פתק "פתיחת מגירה") ו-`serial` (Web Serial: `ESC @`, `GS v 0`, `GS V`, `ESC p` פין 2/5; baud 9600/19200/38400/115200).
- `win`: אין דיווח אם הנייר יצא – התשובה היא "נשלח" (`via:'win'`). מסך לקוח = חלון שני (`window.open`), במסך השני אם Window Management API מאושר.

## הרצה
```
cd tools/pos-hw-test && mvn -q test      # Java: LpPosEscPos + LpPosTransport (12 בדיקות, כולל מדפסת רשת מדומה על localhost)
node tools/pos-hw-test/pos-hw.test.js       # JS: pos-hw.js עם תוסף מדומה
node tools/pos-hw-test/pos-devices.test.js  # JS: pos-devices.js + pos-help.js
node tools/pos-hw-test/pos-hw-web.test.js   # JS: pos-hw-web.js (+ ציור ב-Chromium אם Playwright מותקן; WIN_RECEIPT_PNG=<קובץ> שומר תמונה)
cd firebase && npm run test:pos             # שרת: tests/pos-ops.test.js (כללים, posOps, posOpsWatch, posBackup) מול האמולטור
```

## ספריות
- ZXing core 3.5.3 (`com.google.zxing:core`) – רישיון Apache 2.0 – ברקוד ו-QR בקבלה. נוסף ב-`patch-android.sh` (בלוק POS-HW).
- JUnit 5 (רק לבדיקות, לא נכנס ל-APK) – רישיון EPL 2.0.
- אין ספריות נוספות. ESC/POS נכתב בקוד שלנו.

## הרשאות
- `BLUETOOTH` עד אנדרואיד 11 (בלי שאלה), `BLUETOOTH_CONNECT` מאנדרואיד 12 (נשאל רק כשבוחרים מדפסת בלוטות').
- בלי `BLUETOOTH_SCAN`, בלי מיקום: רק מכשירים שכבר צומדו בהגדרות הטלפון.
- USB: אין הרשאה במניפסט; אנדרואיד שואל פעם אחת לכל מכשיר.
- `usb.host` ו-`bluetooth` מסומנים `required="false"` – האפליקציה ממשיכה להתקין גם בטלפון בלי אלה.

## כרטיסי אשראי
אין שום טיפול. קלט מהסורק שנראה כמו פס מגנטי או מספר כרטיס (15–19 ספרות שעוברות Luhn) נזרק – לא נשמר, לא מוצג, לא מועבר.

## מה לא נבדק (אין חומרה בסביבת הפיתוח)
- הדפסה אמיתית ב-USB, בבלוטות' וברשת; פתיחת מגירה אמיתית; תשובות מצב ממדפסת אמיתית.
- ציור הקבלה (`LpPosRender`) ומסך הלקוח (`LpPosDisplay`) – תלויים באנדרואיד, נבדקים רק בטלפון.
- הרשאת USB ובלוטות' בטלפון אמיתי, וסורק אמיתי (מהירות ההקלדה של הסורק).

## פתוח (ש7, גל 2)
- **אכיפה בשרת של "מחכה לאישור":** `posSale` (שלב 0 / ש2) דוחה קופה מושבתת (`on:false`, כולל ניתוק מרחוק), אבל עוד לא בודק `appr`. היום החסימה של מכשיר לא מאושר היא בצד המכשיר (`Devices.blocked()`). צריך ש-ש2 יבדוק `posdev.appr` כש-`devApprove` דלוק.
- **"בעל העסק":** `admins/{uid}.own === true`. עסק שאף מנהל בו לא סומן – כל המנהלים נחשבים בעלים. צריך לסמן את בעל העסק (ש4 / מנהל־על).
- **הגדרות ש7 בסכמה:** `devApprove`, `manEntry`, `qWarnCnt`, `qStaleH`, `errNotify`, `bkManual`, `restoreBy`, `bkExt`, `bkAlert` – ברירות המחדל נמצאות ב-`pos-ops.js` (`M7_DEF`). ש4 צריך להוסיף אותן ל-`pos-cfg-schema.js`.
- **שחזור:** מחזיר רק הגדרות (`poscfg/main`, `promo`, `clubcfg`). שחזור מלא לנקודת זמן (כולל מכירות) – PITR של Firestore, בידי המפתח. עלות – לא מאומת.
- **עותק חיצוני:** העותק החודשי נשמר מוצפן ב-Storage. שליחה למייל או לדרייב של העסק – לא נבנתה.
- **מצב ציוד:** הכללים מתירים לקופאי לקרוא את מסמך `posdev` (כולל `hwSt`). ההסתרה מהקופאי היא במסך בלבד.
- **התנגשויות:** המסך מכריע ב-`posconf`. מי שיוצר רשומות `posconf` (ש3, סנכרון) – עוד לא קיים.
- **סיור מודרך** על המסך – לא נבנה (יש עזרה קצרה ומדריך התקנה).
- **מספר הפונקציות בבדיקות** (193→197) ורשימת `test:pos` ב-`package.json` – שורות משותפות שיתנגשו במיזוג עם מודולים אחרים.
