'use strict';
// בדיקת שומר לפני כל הרצה מול פרויקט אמיתי (גם מהתהליך הידני ב-GitHub וגם מהסקריפט עצמו).
// נכשלת (exit 1) אם אחד התנאים לא מתקיים. ברירת המחדל תמיד: קריאה בלבד.
//
// תנאים:
//  1. מזהה פרויקט תקין, והוקלד פעמיים זהה (project === confirm).
//  2. mode הוא readonly או write. ריק = readonly.
//  3. mode=write מחייב קלט נוסף: write_confirm === 'write-to-' + project.
//  4. מזהה פרויקט שמכיל "test" מחייב אישור נפרד ומפורש: allow_test_project === 'true'.
//  5. אם ידוע הפרויקט של חשבון השירות (מהסוד), הוא חייב להיות זהה לפרויקט שהוקלד.
//  6. פרויקט דמו של האמולטור (demo-*) לא מותר כאן: אין לו משמעות מחוץ לאמולטור.
//  7. אם נמסר bucket של Storage: שם תקין, ששייך לאותו פרויקט (מתחיל ב-"<project>.").

const PROJECT_RE = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

function bucketBelongs(bucket, project) {
  return /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(bucket || '') && !!project && bucket.startsWith(project + '.');
}

function checkGuard(i) {
  const errors = [];
  const project = String(i.project || '').trim();
  const confirm = String(i.confirm || '').trim();
  const mode = String(i.mode || 'readonly').trim() || 'readonly';
  if (!PROJECT_RE.test(project)) errors.push('מזהה הפרויקט לא תקין או חסר: "' + project + '"');
  if (project.startsWith('demo-')) errors.push('פרויקט demo-* הוא של האמולטור בלבד');
  if (confirm !== project) errors.push('אישור מזהה הפרויקט לא זהה למזהה (צריך להקליד את המזהה המלא פעמיים)');
  if (mode !== 'readonly' && mode !== 'write') errors.push('מצב לא מוכר: "' + mode + '" (מותר: readonly או write)');
  if (mode === 'write' && String(i.writeConfirm || '').trim() !== 'write-to-' + project) {
    errors.push('מצב כתיבה דורש להקליד בשדה האישור: write-to-' + project);
  }
  if (/test/i.test(project) && String(i.allowTest || '').trim() !== 'true') {
    errors.push('מזהה הפרויקט מכיל "test": נדרש אישור נפרד ומפורש (allow_test_project)');
  }
  if (i.saProject !== undefined && String(i.saProject).trim() !== project) {
    errors.push('חשבון השירות שייך לפרויקט אחר ("' + i.saProject + '"), לא ל-"' + project + '"');
  }
  if (i.bucket !== undefined && i.bucket !== '') {
    const b = String(i.bucket).trim();
    if (!bucketBelongs(b, project)) errors.push('ה-bucket "' + b + '" לא שייך לפרויקט "' + project + '" (חייב להתחיל ב-"' + project + '.")');
  }
  return { ok: errors.length === 0, errors, project, mode: errors.length ? 'readonly' : mode };
}

function fromEnv(env = process.env) {
  return {
    project: env.MIGRATE_PROJECT,
    confirm: env.MIGRATE_PROJECT_CONFIRM,
    mode: env.MIGRATE_MODE,
    writeConfirm: env.MIGRATE_WRITE_CONFIRM,
    allowTest: env.MIGRATE_ALLOW_TEST_PROJECT,
    saProject: env.MIGRATE_SA_PROJECT === undefined ? undefined : env.MIGRATE_SA_PROJECT,
    bucket: env.MIGRATE_BUCKET,
  };
}

if (require.main === module) {
  const r = checkGuard(fromEnv());
  if (!r.ok) {
    for (const e of r.errors) console.error('::error::שומר: ' + e);
    process.exit(1);
  }
  console.log(`שומר: עבר. פרויקט ${r.project}, מצב ${r.mode}`);
}

module.exports = { checkGuard, fromEnv, bucketBelongs, PROJECT_RE };
