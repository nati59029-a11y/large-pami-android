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
