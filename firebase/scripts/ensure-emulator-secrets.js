'use strict';
// יוצר את functions/.secret.local עם ערכי דמה לאמולטור, אם הקובץ לא קיים.
// הקובץ רשום ב-.gitignore ולא נכנס למאגר. הערכים כאן אינם מפתחות אמיתיים.
// לא דורס קובץ קיים.
const fs = require('node:fs');
const path = require('node:path');
const f = path.join(__dirname, '..', 'functions', '.secret.local');
if (!fs.existsSync(f)) {
  fs.writeFileSync(f, [
    '# ערכי דמה לאמולטור בלבד – לא מפתחות אמיתיים. הקובץ לא נכנס למאגר (.gitignore).',
    'GEMINI_API_KEY=dummy-gemini-key-for-emulator',
    // 32 בתים קבועים בקידוד base64 (דמה)
    'BACKUP_MASTER_KEY=' + Buffer.from('dummy-backup-master-key-32-bytes').toString('base64'),
    '',
  ].join('\n'));
  console.log('נוצר functions/.secret.local עם ערכי דמה לאמולטור');
}
// מפתח דמה לימות המשיח (60-yemot.js) – מתווסף גם לקובץ קיים, בלי לדרוס ערכים אחרים
if (!/^YEMOT_API_KEY=/m.test(fs.readFileSync(f, 'utf8'))) fs.appendFileSync(f, '\nYEMOT_API_KEY=DUMMY-SECRET-yemot-7f3a\n');
// סוד דמה לשלוחה 5 (tzintukJoin, 61-yemot-line.js) – באותה שיטה
if (!/^YEMOT_HOOK_SECRET=/m.test(fs.readFileSync(f, 'utf8'))) fs.appendFileSync(f, '\nYEMOT_HOOK_SECRET=DUMMY-HOOK-5b1e\n');
// מפתח דמה ל-ElevenLabs (הקול המשוכפל, 61-yemot-line.js) – באותה שיטה
if (!/^ELEVENLABS_API_KEY=/m.test(fs.readFileSync(f, 'utf8'))) fs.appendFileSync(f, '\nELEVENLABS_API_KEY=DUMMY-ELEVEN-9c2d\n');
// מייל הזמנה עצמי: ערכים ריקים באמולטור – הפונקציה נופלת ל-fallback ולא שולחת מייל אמיתי
if (!/^MAIL_USER=/m.test(fs.readFileSync(f, 'utf8'))) fs.appendFileSync(f, '\nMAIL_USER=dummy-not-an-email\nMAIL_APP_PASSWORD=dummy\n');
// מפתח בדיקה להצפנת כרטיסים (fb/ord-card, customers.js) – 32 בתים קבועים, לא מפתח אמיתי
if (!/^CARD_ENC_KEY=/m.test(fs.readFileSync(f, 'utf8'))) fs.appendFileSync(f, '\nCARD_ENC_KEY=' + Buffer.from('test-only-card-key-32-bytes-0000').toString('base64') + '\n');
// מפתח בדיקה להצפנת המידע הרגיש של המזכירה (שלב 3, lib/sec-sens.js) – 32 בתים קבועים, לא מפתח אמיתי
if (!/^SEC_SENS_KEY=/m.test(fs.readFileSync(f, 'utf8'))) fs.appendFileSync(f, '\nSEC_SENS_KEY=' + Buffer.from('test-only-sec-sens-key-32-bytes!').toString('base64') + '\n');
