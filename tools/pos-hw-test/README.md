# קופה – חומרה (LpPosPlugin) – בדיקות

## מה יש
- `app-source/android-plugin/LpPosEscPos.java` – פקודות ESC/POS, המרת תמונה לנקודות (סף או Floyd-Steinberg), פסי `GS v 0`, פתיחת מגירה (`ESC p`), פענוח מצב (`DLE EOT 1/2/4`). Java נקי.
- `LpPosTransport.java` – חיבור רשת (TCP 9100) ומדפסת מדומה (mock). Java נקי.
- `LpPosBtUsb.java` – בלוטות' (SPP, רק מכשירים מצומדים) ו-USB (OTG).
- `LpPosRender.java` – ציור הקבלה כתמונה (עברית, עמודות, לוגו, ברקוד, QR).
- `LpPosDisplay.java` – מסך לקוח שני (Presentation, WebView בלי JavaScript ובלי רשת).
- `LpPosPlugin.java` – התוסף (`LpPos`).
- `app-source/www/pos-hw.js` – השכבה ב-JS (`window.LpPosHw`): הגדרת מדפסת למכשיר, זיהוי סורק במצב מקלדת, מסך לקוח, מצב רכיבים וחלון "בדיקת ציוד".

## הרצה
```
cd tools/pos-hw-test && mvn -q test      # Java: LpPosEscPos + LpPosTransport (12 בדיקות, כולל מדפסת רשת מדומה על localhost)
node tools/pos-hw-test/pos-hw.test.js    # JS: pos-hw.js עם תוסף מדומה
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
