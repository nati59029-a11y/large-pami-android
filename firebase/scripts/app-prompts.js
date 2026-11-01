'use strict';
// קורא את שלוש ההנחיות (prompts) ל-Gemini מתוך קוד האפליקציה המקורי (www/index.html שבתוך
// large-pami-android-project.zip – הגרסה שבטלפונים, c9bac16). הקובץ הזה משמש גם ליצירת
// functions/lib/prompts.js וגם לבדיקה שההנחיות בשרת זהות תו-בתו לאלה שבאפליקציה.
// שימוש: node scripts/app-prompts.js --write   (כותב מחדש את functions/lib/prompts.js)

const fs = require('node:fs');
const path = require('node:path');
const { appSourceLines } = require('../tests/helpers');

const NAMES = { invoice: 'OCAI_P', product: 'SHAI_P', feedback: 'FB_P' };

function extract(lines, name) {
  const start = lines.findIndex((l) => l.startsWith(`const ${name}=`));
  if (start < 0) throw new Error(`ההנחיה ${name} לא נמצאה בקוד האפליקציה`);
  let text = lines[start].slice(`const ${name}=`.length);
  let end = start;
  const q = text[0];
  if (q === "'") {
    if (!text.endsWith("';")) throw new Error(`${name}: מבנה שורה לא צפוי`);
  } else if (q === '`') {
    while (!lines[end].endsWith('`;')) { end++; text += '\n' + lines[end]; }
    if (text.includes('${')) throw new Error(`${name}: יש ביטוי בתוך התבנית – לא נתמך`);
  } else throw new Error(`${name}: סוג מחרוזת לא צפוי`);
  const literal = text.slice(0, -1); // בלי ה-; בסוף
  // eslint-disable-next-line no-new-func
  const value = new Function('return ' + literal)(); // מחרוזת קבועה מקוד האפליקציה שלנו, בלי ביטויים
  return { value, line: start + 1, endLine: end + 1 };
}

// הכיתובים שהאפליקציה שמה לפני כל תמונה בזיהוי טופס משוב (fbAI): im('תמונה 1: …', …)
function feedbackCaptions(lines) {
  const i = lines.findIndex((l) => l.includes('let parts=[{text:FB_P}'));
  if (i < 0) throw new Error('fbAI: השורה שבונה את חלקי הבקשה לא נמצאה');
  const caps = [];
  for (const l of [lines[i], lines[i + 1]]) for (const m of l.matchAll(/im\('([^']*)'/g)) caps.push(m[1]);
  if (caps.length !== 4) throw new Error('fbAI: ציפיתי ל-4 כיתובים, נמצאו ' + caps.length);
  return { value: caps, line: i + 1, endLine: i + 2 };
}

function appPrompts() {
  const lines = appSourceLines();
  const out = {};
  for (const [kind, name] of Object.entries(NAMES)) out[kind] = { name, ...extract(lines, name) };
  out.feedbackCaptions = { name: 'fbAI im(...)', ...feedbackCaptions(lines) };
  return out;
}

module.exports = { appPrompts, NAMES };

if (require.main === module && process.argv.includes('--write')) {
  const p = appPrompts();
  const body = [
    "'use strict';",
    '// נוצר אוטומטית על ידי firebase/scripts/app-prompts.js מתוך www/index.html שב-large-pami-android-project.zip.',
    '// אל תערכו ידנית: הבדיקות מוודאות שהטקסט כאן זהה תו-בתו להנחיות שהאפליקציה שולחת היום ל-Gemini.',
    ...Object.entries(p).map(([kind, x]) => `// ${kind}: ${x.name}, שורות ${x.line}-${x.endLine}`),
    'module.exports = ' + JSON.stringify(Object.fromEntries(Object.entries(p).map(([k, x]) => [k, x.value])), null, 2) + ';',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(__dirname, '..', 'functions', 'lib', 'prompts.js'), body);
  console.log('נכתב functions/lib/prompts.js');
}
