# כלי העברת הנתונים של לארג' פעמי (ריבוי עסקים, שלב 4)

הכלי מעתיק את הנתונים של לארג' פעמי מהשורש (`admins`, `staff`, `cfg`, `inbox` וכו') אל העסק הראשון במבנה החדש: `b/largpeami/...`.
**המקור לא נמחק ולא משתנה.** הוא נשאר כגיבוי עד שהמשתמש יאשר אחרת.

> **אזהרה:** הכלי נבדק רק באמולטור, עם נתוני דמה. הרצה על פרויקט אמיתי (גם על `largpeami-test-f4691`) רק באישור מפורש של המשתמש. הדרך המומלצת: התהליך הידני ב-GitHub (`.github/workflows/migrate-largpeami.yml`), שבו כל הפעולות זמינות, כולל החזרה. הרצה מהמחשב אפשרית רק לפי הסעיף "הרצה מהמחשב" למטה.

## מה יש כאן
| קובץ | מה הוא עושה |
|---|---|
| `migrate.js` | הכלי. פקודות: `backup`, `dry-run`, `copy`, `copy-docs`, `verify`, `compare-backup`, `report-since`, `set-dataroot` |
| `fsrest.js` | גישה ל-Firestore דרך REST, עם ההגנות על הכתיבה (ראו למטה) |
| `guard.js` | בדיקת השומר לפני הרצה על פרויקט אמיתי |
| `ROLLBACK.md` | מסמך חזרה, צעד אחר צעד |
| `../tests/migrate-tool.test.js` | הבדיקות באמולטור |

## שלבי העבודה
1. **גיבוי** (`backup`): כל האוספים בשורש (חוץ מ-`b`), כולל תת-אוספים, לקובץ JSON. לכל מסמך נשמרים הערכים הגולמיים של Firestore, גיבוב (SHA-256) ותווית זמן. אחרי הכתיבה הכלי קורא את הקובץ שוב ומוודא שכל גיבוב יוצא זהה. עם `--upload` הקובץ נשמר גם ב-bucket הפרטי של הפרויקט, בתיקייה `migrate_backups/<זמן>_<תווית>/backup.json` (יצירה בלבד, אף פעם לא דריסה). בתהליך ב-GitHub זו ברירת המחדל. קובץ הגיבוי **לא** עולה ל-GitHub.
2. **ספירה** (`dry-run`): מציג כמה מסמכים ייווצרו, יתעדכנו או יתנגשו, ואת האוספים שלא מועתקים (נדחים, משותפים ולא ידועים) עם מספר המסמכים בהם. לא כותב כלום.
3. **העתקה** (`copy --mode write`): יוצר את המסמכים ב-`b/largpeami/...`, מעתיק את קבצי `app_backups/` ב-Storage אל `b/largpeami/app_backups/`, יוצר `users/{uid}` לכל מנהל ועובד, ויוצר את מסמך העסק `b/largpeami` (`status: active`, `dataRoot: legacy`, כל התוספות מופעלות, `createdBy: migrate`, `migrationTarget: true`).
   - **מותר רק לעסק `largpeami`.** כל מזהה אחר נדחה, כדי שטעות הקלדה לא תעתיק את הנתונים לעסק זר.
   - אם מסמך העסק כבר קיים, ההעתקה מותרת רק אם הוא נוצר על ידי הכלי (`createdBy: migrate` ו-`migrationTarget: true`), ורק כש-`dataRoot` הוא `legacy`.
4. **אימות** (`verify`): ספירה וגיבוב לכל אוסף, מקור מול יעד, ודוח הבדלים. נבדקים גם קבצי Storage (מספר, גודל ו-md5), `users/{uid}` לכל מנהל ועובד, ומסמך העסק. האימות **נכשל** בכל אחד מהמקרים האלה:
   - לא נמצא במקור אף אוסף להעתקה, או שנמצאו 0 מסמכים.
   - יש בשורש אוסף לא ידוע שיש בו מסמכים. מה עושים: מחליטים עליו, ואז מעבירים אותו במפורש ב-`--ack-unknown name1,name2` (בתהליך ב-GitHub: `ack_unknown`).
5. **השלמה:** מריצים שוב את `copy` עם קובץ המצב של ההעתקה הקודמת. רק מה שהשתנה במקור מאז ההעתקה הקודמת מועתק. מסמך ששונה גם ביעד מדווח "התנגשות", עם שני הגיבובים, ולא נכתב. הרצה בלי שינוי במקור לא כותבת דבר.
6. **חזרה:** ראו `ROLLBACK.md`. הפקודות `report-since`, `set-dataroot --to legacy` ו-`compare-backup --backup-gcs`.
7. **העתקה ממוקדת של מסמכים בודדים** (`copy-docs --mode write --paths cashout/abc,tasks/xyz --backup /tmp/lp-migrate/backup.json`), נוסף ב-16.11.2026. מיועד למסמכים שמכשיר ישן (שנשאר במצב legacy) כתב לשורש **אחרי** המעבר ל-`b`. `copy` הרגיל מסרב אחרי המעבר, וזה הכלי למקרה הזה.
   - עובד כש-`dataRoot` הוא `b` (וגם `legacy`). רק לעסק `largpeami`, ורק אם מסמך העסק נוצר על ידי הכלי.
   - `--paths`: עד 50 נתיבי מסמכים בשורש, מופרדים בפסיק. כל נתיב = `<אוסף>/<מזהה>` (או נתיב עמוק יותר עם מספר זוגי של קטעים), האוסף העליון חייב להיות ב-`COPY`, ומותרים רק אותיות לטיניות, ספרות, `_` ו-`-`. נתיב אחד לא תקין = שום דבר לא נקרא ולא נכתב.
   - אסור להעתיק מאוספי הרשאות וזהות, גם אם הם ב-`COPY`: `admins`, `staff`, `private`, `push_tokens` (וגם `users`, `superadmins`). למשל `admins/<uid>` היה מחזיר הרשאת מנהל למי שהוסר ב-`b`.
   - רק המסמכים שברשימה, **בלי תת-אוספים**. הערכים מועתקים בצורה הגולמית, בדיוק כמו ב-`copy`. אם למסמך מקור יש תתי-אוספים, הדוח מציג **אזהרה** עם נתיבי כל המסמכים שבהם (`subDocs` בקובץ הדוח). כדי להעתיק אותם מוסיפים את הנתיבים ל-`--paths` בהרצה נוספת. האזהרה לא משנה את קוד היציאה.
   - **יצירה בלבד:** יעד שכבר קיים לא נדרס לעולם. זהה למקור = "כבר קיים", לא נכתב. שונה = "התנגשות", לא נכתב. מסמך שלא קיים בשורש = "לא נמצא".
   - בסוף: דוח בעברית לכל מסמך. יוצא עם קוד 1 אם יש התנגשות, מסמך חסר או כשל (מסמכים תקינים באותה הרצה כן מועתקים). הדוח (`--report`) מכיל רק נתיבים וגיבובים, בלי הנתונים עצמם.
   - לא נוגע בקובץ המצב. לכן `report-since` יראה את המסמכים האלה כ"חדשים ב-b" – זה צפוי.
   - בתהליך ב-GitHub: `action=copy-docs`, `doc_paths`, ו-`write_confirm`. הנתיבים נבדקים לפני הכול, אחר כך נשמר גיבוי (כמו בכל פעולה שכותבת), ורק אז ההעתקה.

## אילו אוספים
הרשימה המלאה והמדויקת: `COPY`, `DEFERRED` ו-`SHARED` בראש `migrate.js`.
- **מועתקים (`COPY`):** `admins`, `staff`, `cfg`, `bk`, `chunks`, `inbox`, `app_backup_status`, `shelf`, `fb`, `tasks` (+`c`), `supinv` (+`p`), `appreq` (+`p`), `closings` (+`p`), `cashout`, `deposits` (+`p`), `zlast`, `yemot_*`, `voice_usage`, `scan_usage`, `audit_log`, `table_bases`, הזמנות (`ord`, `prod`, `stockLog`, `ordcfg`, `ordpay`, `private`), סריקת חנות (`s3*`, `smap`, `sround`, `srun`), ומאז 15.11.2026 גם:
  - משימות ובקשות: `ptk`, `rtk`, `rq` (+`c`), `mq` (+`p`).
  - לקוחות: `cust` (+`p`, כולל כרטיסים מוצפנים כמו שהם), `custcfg`, `custBak` (+`items`), `cardLog`, `cardQ`.
  - מלאי והזמנות: `cat`, `xfer`, `pinv` (+`p`), `stockBak` (+`items`), `impJobs`, `lineplan`, `lineLog`.
  - שונות: `push_tokens`, `fn_rate`, `wv`.
  - המזכירה העסקית: כל `SEC_COLLS` מ-`functions/secretary.js` (`sec_cfg`, `sec_chat`, `sec_in`, `sec_draft`, `sec_inv`, `sec_facts`, `sec_rules`, `sec_cal`, `sec_mirror`, `sec_rep`, `sec_log`, `sec_usage`, `sec_facts_sensitive`, `sec_note`, `sec_snd`, `sec_clean`, `sec_gcal`, `sec_learn`) ועוד `sec_ord`.
  - כל תת-אוסף אחר שנמצא מתחתם מועתק גם הוא. בדיקה 13 ב-`migrate-tool.test.js` נכשלת אם נוסף כלל ב-`b/{bizId}` או אוסף ל-`SEC_COLLS` בלי להוסיף אותו כאן.
- **טבלאות שרת משותפות (`SHARED`), נשארות בשורש:** `sec_route`, `sec_mailroute`, `sec_oauth`, `sec_mailq`, `sec_waq`, `mailRate`, `impQ`. השרת כותב אליהן תמיד בשורש (`getFirestore()`), בשביל כל העסקים, עם מזהה העסק בתוך המסמך. מגובות, לא מועתקות, לא נחשבות "לא ידוע", לא מכשילות את האימות, ולא נכללות ב-`compare-backup` (הן ממשיכות להשתנות גם אחרי המעבר).
- **מגובים ולא מועתקים (הזמנות אתר, נדחה לסבב נפרד):** `site_income_daily` ואוספי `orders/`. מוצגים עם ספירה.
- **אוסף שלא מופיע ברשימות:** מגובה, לא מועתק, ומכשיל את האימות עד החלטה מפורשת (`--ack-unknown`).
- `users` ו-`superadmins` (חדשים) לא נחשבים חלק מהמקור, ולכן לא נכללים בהשוואה לגיבוי.
- `b/{bizId}/audit` נכתב תמיד ישירות תחת `b/`, ולכן אין לו מקור בשורש.

## ההגנות
- **ברירת המחדל: קריאה בלבד.** כתיבה לנתוני העסק רק עם `--mode write`. החריג היחיד הוא שמירת קובץ הגיבוי ב-`migrate_backups/` עם `--upload`.
- **לאן מותר לכתוב:** רק ל-`b/largpeami`, ל-`b/largpeami/...`, וליצירה של `users/<uid>` חדש. כל ניסיון לכתוב למקום אחר נעצר בקוד.
- **אין דריסה:** כל כתיבה עם תנאי מוקדם.
  - יצירה רק אם המסמך לא קיים.
  - עדכון רק אם מסמך היעד לא השתנה מאז שנקרא.
  - אין בקוד מחיקה.
- **Storage:** קובץ מועתק רק אם הוא לא קיים ביעד. בענן נוסף גם התנאי `ifGenerationMatch: 0`. באמולטור התנאי הזה לא נאכף, ולכן הכלי בודק קודם שהקובץ לא קיים.
- **אמולטור:** חובה שגם `FIREBASE_STORAGE_EMULATOR_HOST` יהיה מוגדר (או להוסיף `--no-storage`). ה-bucket חייב להיות של פרויקט ה-`demo-`. בלי זה, Storage היה פונה לענן.
- **פרויקט אמיתי:** הכלי מסרב לרוץ אם השומר (`guard.js`) לא עבר. השומר בודק גם שה-bucket שייך לאותו פרויקט: השם חייב להתחיל ב-`<project>.`.
- **קבצים:** הכלי מסרב לכתוב קובץ גיבוי, מצב או דוח בתוך תיקייה של מאגר git. כתבו לתיקייה זמנית, למשל `/tmp/lp-migrate/`. בנוסף, `.gitignore` מחריג את הקבצים האלה.
- **נעילה:** קובץ `<state>.lock` מונע שתי העתקות במקביל באותו מחשב. בתהליך ב-GitHub יש גם `concurrency`.
- **טיפוסים נשמרים בדיוק:** הנתונים עוברים בצורה הגולמית של Firestore. firebase-admin היה הופך סכום שלם שנשמר כ-`doubleValue` ל-`integerValue`.

## הרצה באמולטור (פיתוח ובדיקות)
```bash
cd firebase
firebase emulators:exec --only firestore,storage --project demo-largpeami \
  "node --test tests/migrate-tool.test.js"
```

או בקיצור: `npm run test:migrate`.

**חשוב:** את הבדיקות האלה מריצים **בלי** אמולטור הפונקציות. הטריגרים `syncLegacyAdmin` ו-`syncLegacyStaff` יוצרים בעצמם את `users` כשהבדיקה זורעת `admins` ו-`staff`, ואז ספירת "ייווצרו" בבדיקה 2 משתנה (5 הופך ל-1). הכלי עצמו מטפל נכון ב-`users` שכבר קיים ותואם (נספר כ"קיימים ותואמים").

## הרצה על פרויקט אמיתי דרך GitHub (מומלץ) – רק באישור המשתמש
Actions ← "Migrate largpeami data" ← Run workflow. העסק קבוע: `largpeami`.

| קלט | משמעות |
|---|---|
| `project_id`, `project_id_confirm` | מזהה הפרויקט המלא, פעמיים |
| `action` | `check` (ברירת מחדל: גיבוי, ספירה ואימות, קריאה בלבד), `copy` (העתקה/השלמה), `copy-docs` (מסמכים בודדים, גם אחרי המעבר), `report-since`, `compare-backup`, `switch-to-b`, `rollback-to-legacy` |
| `write_confirm` | בפעולות שכותבות (`copy`, `copy-docs`, `switch-to-b`, `rollback-to-legacy`): `write-to-<מזהה>` |
| `doc_paths` | ל-`copy-docs` בלבד: נתיבי מסמכים בשורש, מופרדים בפסיק (למשל `cashout/abc,tasks/xyz`), עד 50 |
| `allow_test_project` | מזהה שמכיל `test` דורש `true`. לפרויקט כזה נדרש הסוד `FIREBASE_SERVICE_ACCOUNT_TEST` (חשבון שירות של פרויקט הבדיקה). השומר בודק שחשבון השירות שייך לפרויקט שהוקלד |
| `state_run_id` | ל-`copy` (השלמה) ול-`report-since`: מספר ההרצה **האחרונה עם `action=copy`**. הרצת `check` לא יוצרת קובץ מצב. בלי קובץ מצב, כל שינוי במקור ידווח כהתנגשות ולא יועתק |
| `backup_path` | ל-`compare-backup` ול-`rollback-to-legacy`: הנתיב `migrate_backups/.../backup.json` שמופיע בסיכום ההרצה שיצרה את הגיבוי |
| `upload_backup` | `true` כברירת מחדל: הגיבוי נשמר ב-bucket הפרטי של הפרויקט. אף פעם לא ב-GitHub |
| `ack_unknown` | אוספים לא ידועים שהוחלט לא להעביר |

**ה-bucket:** נקבע לפי הפרויקט שהוקלד: `<project>.firebasestorage.app`. אם הוגדר `vars.FIREBASE_STORAGE_BUCKET` והוא שייך לאותו פרויקט (מתחיל ב-`<project>.`), משתמשים בו.

## הרצה מהמחשב (רק אם אין ברירה, ורק באישור המשתמש)
משתני סביבה נדרשים, בנוסף לפרמטרים:
| משתנה | ערך |
|---|---|
| `GOOGLE_APPLICATION_CREDENTIALS` | נתיב לקובץ חשבון השירות של **אותו** פרויקט. לשמור מחוץ למאגר, ולמחוק בסוף |
| `MIGRATE_PROJECT_CONFIRM` | מזהה הפרויקט, שוב (חייב להיות זהה ל-`--project`) |
| `MIGRATE_MODE` | `write` לפקודות שכותבות. אחרת לא מגדירים |
| `MIGRATE_WRITE_CONFIRM` | `write-to-<מזהה>`, רק לפקודות שכותבות |
| `MIGRATE_ALLOW_TEST_PROJECT` | `true`, רק לפרויקט שמזהה שלו מכיל `test` |
| `MIGRATE_BUCKET` (או `--bucket`) | ה-bucket של אותו פרויקט, למשל `largpeami.firebasestorage.app` |

דוגמה (קריאה בלבד, הקבצים ב-`/tmp/lp-migrate/`, מחוץ למאגר):
```bash
mkdir -p /tmp/lp-migrate
export GOOGLE_APPLICATION_CREDENTIALS=/tmp/lp-migrate/sa.json MIGRATE_PROJECT_CONFIRM=largpeami MIGRATE_BUCKET=largpeami.firebasestorage.app
node firebase/migrate/migrate.js backup --project largpeami --out /tmp/lp-migrate/backup.json --upload --upload-tag manual
node firebase/migrate/migrate.js dry-run --project largpeami --report /tmp/lp-migrate/dry.json
```

### ייצוא מנוהל של Firestore (גיבוי נוסף לפני ההעתקה) – טקסט בלבד, הכלי לא מריץ אותו
```bash
# דורש gcloud מחובר לחשבון עם הרשאה, ו-bucket ייעודי לגיבויים (לבחור לפני ההרצה)
gcloud firestore export gs://<BUCKET-לגיבויים>/firestore-export-$(date -u +%Y%m%d-%H%M%S) --project=<PROJECT_ID>
```
שחזור מייצוא כזה (`gcloud firestore import`) **דורס** מסמכים בפרויקט. משתמשים בו רק במקרה חירום, ורק באישור.

## הערה לייצור
אחרי המעבר ל-`b` (16.11.2026) כללי Firestore חוסמים כתיבה מהאפליקציה לאוספי העסק בשורש (הפונקציה `lpW()` ב-`firestore.rules`), כל עוד `b/largpeami.dataRoot` אינו `legacy`. קריאה מהשורש לא נחסמת. בחזרה ל-`legacy` הכתיבה לשורש נפתחת שוב.
**חריג אחד:** יצירת דף משוב חדש (`fb`, `st: 'new'`) נשארת מותרת בשורש. הסיבה: בקוד הישן (`fbWSent`), 403 בניסיון חוזר נחשב "כבר נשלח", והדף היה נמחק מהטלפון ואובד. לכן אחרי הנעילה מריצים `compare-backup` מול הגיבוי של המעבר, ודף `fb/...` חדש מעתיקים ב-`copy-docs`.

**בדיקה אחרי הנעילה: `inbox` בלי `cashout` תואם.** בקוד הישן `coPush` בולע 403 ב-`cashout`. אם הנעילה נכנסה לתוקף בדיוק בין שליחת ה-`inbox` (שהצליחה) לשליחת ה-`cashout`, רשומת בדיקת הסגירה אובדת והפריט לא נשלח שוב. החלון קצר מאוד, אבל אחרי הנעילה בודקים: `compare-backup` מול הגיבוי של המעבר, ולכל `inbox/<id>` חדש בשורש שהוא הוצאה מקופה (`reg` בנתונים) ואין לו `cashout/<id>` – הרשומה מוזנת מחדש ידנית או מטופלת לפי החלטה.

בייצור הנתונים בשורש ממשיכים להשתנות כל עוד האפליקציה עובדת. לכן `verify` ו-`compare-backup` שרצים אחרי `copy` עלולים להראות הבדלים, שנוצרו מכתיבה של האפליקציה ולא של הכלי. הכלי לא כותב לשורש. כדאי להריץ את ההעברה בזמן שהאפליקציה לא בשימוש.
