'use strict';
// ריבוי עסקים (שלב 5, סבב 2): בדיקה סטטית של storage.rules – מגבלת 2 הקריאות (עדכון חוזה 6).
// לכל allow, סופרים את כל המסמכים השונים ב-Firestore (firestore.get / firestore.exists) שיכולים להיקרא בהערכה,
// כולל בתוך פונקציות (רקורסיבית), באיחוד של כל המסלולים (||, &&) – כלומר המקרה הגרוע ביותר. המגבלה: 2.
// מסמך שנקרא כמה פעמים (exists ואז get של אותו נתיב) נספר פעם אחת (לפי הבלוג של Firebase, לא מאומת).
// לא צריך אמולטור: node --test tests/multi-business-storage-reads.test.js
// STORAGE_RULES=<קובץ> – לבדיקת גרסה אחרת (למשל: git show 6d301c2:firebase/storage.rules > /tmp/x.rules).

const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FILE = process.env.STORAGE_RULES || path.join(__dirname, '..', 'storage.rules');
const LIMIT = 2;

function stripComments(src) { return src.replace(/\/\/[^\n]*/g, ''); }
// גוף בסוגריים מסולסלים מאוזנים, החל מהאינדקס של '{'
function block(src, i) { let d = 0; for (let j = i; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) return src.slice(i + 1, j); } throw new Error('סוגריים לא מאוזנים'); }

function parse(src) {
  const s = stripComments(src);
  const fns = {};
  for (const m of s.matchAll(/function\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*\{/g)) fns[m[1]] = block(s, m.index + m[0].length - 1);
  const allows = [];
  // allow <ops>: if <expr>;  – עם הנתיב של ה-match שמעליו
  const matchRe = /match\s+(\/\S+)\s+\{/g;
  for (const m of s.matchAll(matchRe)) {
    const body = block(s, m.index + m[0].length - 1);
    const own = body.replace(/match\s+\/\S+\s+\{/g, '\u0000').split('\u0000')[0]; // רק עד ה-match הפנימי הראשון
    for (const a of own.matchAll(/allow\s+([a-z, ]+):\s*if\s+([\s\S]*?);/g)) allows.push({ match: m[1], ops: a[1].trim(), expr: a[2] });
  }
  return { fns, allows };
}

// כל נתיבי המסמכים שנקראים בביטוי, כולל דרך קריאות לפונקציות (רקורסיבית)
function docsOf(expr, fns, seen) {
  const out = new Set();
  // נתיב מסמך: מקטעים 'שם/$(ביטוי)' או 'שם/מילה', למשל users/$(request.auth.uid) או b/$(bizId)/admins/$(request.auth.uid)
  for (const m of expr.matchAll(/firestore\.(?:get|exists)\(\s*\/databases\/\(default\)\/documents\/((?:[A-Za-z_]\w*\/(?:\$\([^)]*\)|\w+)\/?)+)/g)) out.add(m[1].replace(/\/$/, ''));
  for (const m of expr.matchAll(/([A-Za-z_]\w*)\s*\(/g)) {
    const n = m[1];
    if (!fns[n] || seen.has(n)) continue;
    const next = new Set(seen); next.add(n);
    for (const d of docsOf(fns[n], fns, next)) out.add(d);
  }
  return out;
}

it(`storage.rules: בכל allow נקראים לכל היותר ${LIMIT} מסמכים שונים ב-Firestore, בכל המסלולים (${path.basename(FILE)})`, () => {
  const { fns, allows } = parse(fs.readFileSync(FILE, 'utf8'));
  assert.ok(allows.length >= 8, 'נמצאו מעט מדי כללי allow – הפענוח נכשל');
  const report = allows.map((a) => ({ where: `${a.match} [${a.ops}]`, docs: [...docsOf(a.expr, fns, new Set())].sort() }));
  for (const r of report) console.log(`${r.where}: ${r.docs.length} – ${r.docs.join(', ') || '(אין)'}`);
  const over = report.filter((r) => r.docs.length > LIMIT).map((r) => `${r.where}: ${r.docs.join(', ')}`);
  assert.deepEqual(over, [], 'כללים שקוראים יותר מ-2 מסמכים שונים');
});
