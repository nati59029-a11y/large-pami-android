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
