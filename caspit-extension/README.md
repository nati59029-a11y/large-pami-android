# תוסף Chrome – סנכרון כספית (שלב B, צד הלקוח)

תוסף MV3 שרץ ב-Chrome במחשב של החנות, מוריד מכספית את הקטלוג ואת דוח המכירות, שולח לשרת (`cxBot`), ומעלה לכספית קבצי פריטים חדשים ומחירים.
מדריך התקנה לבעל העסק: `docs/caspit-extension-install.md`.

## מבנה
- `src/manifest.json` – הרשאות: `alarms, storage, scripting, idle`; אתרים: `https://caspit.valu.co.il/*` + כתובת השרת (נקבעת בבנייה). בלי `<all_urls>`, `downloads`, `cookies`, `tabs`, קוד מרוחק או eval.
  - `key` קבוע → מזהה התוסף תמיד **`mianlmahikfdnffiipdfpojnfjhcipbp`**. ה-CORS בשרת: `chrome-extension://mianlmahikfdnffiipdfpojnfjhcipbp` בלבד.
- `src/sw.js` – תזמון, מכונת המצבים של הריצה (`lib/plan.js`), מצב היכרות, הודעות מהחלון הקופץ.
- `src/lib/` – `days.js` (isDue / nextAt / ימים להבאה), `plan.js`, `sanitize.js`, `selectors.js` (מריץ צעדי מסך), `util.js` (sha256, CSV/Excel), `api.js` (לקוח cxBot),
  ו-`caspit-core.js` + `xlsx.full.min.js` – עותקים זהים לאפליקציה (נבדק ב-`scripts/sync-ext-core.js`).
- `src/content/hook-main.js` (בתוך הדף) + `bridge.js` – תפיסת קובץ שכספית מורידה, בלי הרשאת downloads, רק כשהתוסף "דרוך" עם nonce.
- אבטחה: האסימון נשמר ב-`chrome.storage.local` ונקרא רק ב-service worker; סקריפטי התוכן לא קוראים אחסון, וה-SW מבקש `setAccessLevel(TRUSTED_CONTEXTS)` (ב-local – אם נתמך, לא מאומת). `hook-main.js` לוקח הפניות נקיות (postMessage, btoa, Blob.arrayBuffer, addEventListener) כבר ב-document_start. בדוח ההיכרות אין טקסט של קישורים בתוך טבלאות, ואין אפשרויות של רשימות בחירה ארוכות (מעל 30).
- **רק המשרד האחורי (`/bo`)**: התוסף פותח ומשתמש רק ב-`https://caspit.valu.co.il/bo#/...`. מעבר מסך – תמיד בכתובת מלאה (`tabs.update`). לפני כל צעד (וגם בתוך הדף, `guard` ב-`runSteps`) נבדק שהלשונית ב-`/bo`; אחרת הריצה נעצרת ב-`wrong-page` (בלי ניסיון חוזר, דיווח והתראה למנהל) ולא נוגעים בדף. קופת המכירה (שורש האתר) – אף פעם.
- `src/selectors.json` – נתונים בלבד (צעדים: nav/waitFor/click/select/setDate/setFile/text). **גרסה 0 = ניחוש**; מצב ההיכרות מגלה את הערכים האמיתיים.
  - דף היכרות בלי `flow` – לקריאה בלבד, בלי שום לחיצה: רק פקדים, כותרות טבלה וכתובת. בכתובת ישירה (`hash`, למשל `hours` → `#/hours-reports`) או לפי טקסט קישור בתפריט (`menu` + `find`, רק `#/...` בתוך `/bo`). `btn: true` – גם טקסט של כפתורים עם מילת פעולה, מחוץ לטבלאות.
  - `setFile` (0.1.6): בזרימה רגילה ה-service worker מבצע אותו בתוך הדף (MAIN world): בחירה רגילה → גרירה → סוג Excel, כל עוד "ממתין לטעינה" ריק; בכישלון – `selector-miss` עם אבחון.
    בכל ריצת היכרות נאספת גם רשימת קישורי התפריט (`menu`: טקסט + hash, עד 200; כותרות התפריט שבהגדרה נפתחות במעבר עכבר בלבד).
- `src/updater/` + `src/install-auto-update.cmd` (0.1.7) – עדכון אוטומטי במחשב החנות: משימה מתוזמנת של Windows שמורידה את ה-release האחרון (`caspit-ext-v*`), בודקת SHA-256 ומזהה תוסף, מחליפה קבצים וכותבת `upd.json`. התוסף (`lib/upd.js`) מרענן את עצמו כשבטוח ומדווח `upd` ב-hello (התראות `updfail/updstale/updlag` בשרת).
- `build.js` – `node caspit-extension/build.js --backend prod|test [--zip]` → `dist/<backend>/` (+zip). בודק הרשאות ו-eval לפני בנייה.

## תזמון
- כל יום ב-03:00 לפי שעון ישראל (`Asia/Jerusalem`, לא לפי שעון המחשב). alarm `daily` נוצר מחדש אחרי כל הפעלה.
- השלמה: `tick` כל 15 דקות, הפעלת Chrome, התקנה, וחזרה מחוסר פעילות (`idle`). אם `isDue` – מתחילים אחרי 2 דקות (בודקים רשת + `hello`).
- "סנכרן עכשיו" מהטלפון (0.1.5): alarm `poll` כל דקה – רק כשמחוברים, יש רשת ואין ריצה. בקשה חדשה (`id` שונה מ-`lastReq`) → ריצה ידנית אחת עם `req`.
  שרת ישן (`bad-op`) → כל 15 דקות, בלי תקלה. החיבור בוטל (`auth`) → מפסיקים עד חיבור מחדש / הפעלת Chrome.
- ריצה אחת בכל רגע. שגיאת רשת/שרת: ניסיון חוזר אחרי 1, 4, 15 דקות. צריך התחברות לכספית → דיווח (פעם ביום) והבדיקה הבאה מנסה שוב.
- לשונית כספית ייעודית של התוסף (מוצמדת, לא פעילה). התוסף לא נוגע בלשוניות של בעל העסק ולא ממלא סיסמה.

## חוזה cxBot (צד השרת: `firebase/functions/caspit-bot.js`, בדיקות: `firebase/tests/caspit-bot.test.js`)
`POST <functions>/cxBot`, `Authorization: Bearer <bizId>.<32B base64url>`, `Content-Type: application/json`.
גוף: `{ op, ver, ...שדות }`. תשובה: `{ ok:true, ... }`, או `{ ok:false, reason, msg }` (msg בעברית).
סטטוס: 401/403 → החיבור בוטל (התוסף מפסיק); 429 → מגבלה; 5xx → ניסיון חוזר; 4xx עם `reason` → לפי reason.

| op | שדות שהתוסף שולח | תשובה מצופה |
|---|---|---|
| `hello` | `mode: 'sync'\|'connect'`, `manual`, `req?` (מזהה בקשה מהטלפון – נלקחת פעם אחת; אחרת `reason:'req-gone'`), `upd?` (0.1.7: מצב העדכון האוטומטי מ-upd.json – `{at, ok, ver, err, fails}`) | `runId`, `minVer`, `enabled`, `biz:{name}`, `days:['YYYY-MM-DD']` (מ-lastSales+1 עד אתמול, ≤14), `lastSales`, `schedule:{at:'03:00', tz:'Asia/Jerusalem'}`, `limits:{price, newMax}` |
| `cfg` | – | `schedule`, `lastSales`, `limits` (שמור לשימוש עתידי; התוסף כרגע מסתפק ב-hello) |
| `upload` | קטלוג: `run, log, part, parts, items` (כמו cxUpload, בלי kind). מכירות: `run, log, kind:'sales', day, part, parts, lines` | `{ok:true}` |
| `preview` | `run, log` | כמו cxPreview (התוסף שומר רק `cnt`) |
| `apply` | `run, log` | `done`, `res`. קטלוג ראשון → `reason:'first-manual'` (התוסף ממשיך למכירות ומדלג על הקבצים לכספית). תצוגה מיושנת → `reason:'stale'` (התוסף עושה preview מחדש, עד פעמיים) |
| `export` | `kind:'new'\|'price'`, `max`, `log` | `n, csv, rows` (כמו cxExport). **מומלץ שהשרת יסרב לפני סימון pd אם n > max** – התוסף מסרב לטעון לכספית מעל המגבלה |
| `importResult` | `run, kind, n, ok, text (≤500), hash` | `{ok:true}` |
| `poll` | – (פטור מהמונה היומי; אסימון ומונה IP כרגיל) | `want`, `id` (בקשה שלא נלקחה, עד 10 דקות). השרת שומר `pl` (מתי המחשב בדק) לכל היותר פעם ב-5 דקות |
| `report` | ריצה: `run, kind:'run', st, err?, steps, info`. היכרות: `kind:'disc', data` (מסונן, ≤1MB) | `{ok:true}` |

השרת: היום האחרון שנקלט (`lastSales`) מתקדם לפי `report` – רק ימים מתוך `days` של ה-hello, ברצף מההתחלה, שמופיעים ב-`info.sales` (גם יום בלי מכירות). `export` מעל המגבלה → `reason:'limit'` לפני שמשהו מסומן. `apply`/`export` בזמן שמנהל שומר בטלפון → `reason:'busy'` (ניסיון חוזר).

`run` של upload/preview/apply הוא מזהה משנה שהתוסף יוצר לכל קטלוג/יום (`/^[A-Za-z0-9_-]{8,40}$/`); `log` = `runId` מ-hello.
מגבלות בתוסף: ≤500 שורות מחיר, ≤50 פריטים חדשים (או `limits.newMax` אם נמוך יותר), אחרת עוצר עם `limit` ומדווח.

## בדיקות
`node --test --test-concurrency=1 'caspit-extension/test/*.test.js'` (צריך `playwright` עם Chromium). e2e: כספית מדומה (`test/fixtures/caspit/`) דרך `context.route`, ושרת cxBot מדומה.
