'use strict';
// מילון הגייה (חוזה 5.5). אותו אלגוריתם בדיוק ימומש באפליקציה (www/yemot-preview.js),
// ושני המימושים נבדקים מול אותו קובץ דוגמאות: firebase/tests/lexicon-cases.json.
//   parseLexicon(text) → { entries:[{from,to}], bad:[מספרי שורות] }
//     שורה לכל ערך: "מילה=הגייה". שורה ריקה או שמתחילה ב-# מדולגת. from ו-to: 1-40 תווים אחרי trim.
//     from כפול (בלי הבדל בין אותיות לטיניות גדולות לקטנות): האחרון קובע. עד 300 ערכים (שורות מעבר לזה = bad).
//   applyLexicon(text, entries) → מחרוזת
//     הארוך קודם. מילה שלמה בלבד: לפניה אין אות/ספרה/גרש/מירכאות, ואחריה אין אות/ספרה/גרש.
//     מותרת קידומת של עד 2 אותיות מתוך ובהלמשכ, והיא נשמרת. כל מקום מוחלף פעם אחת (לא מחליפים תוצאה של החלפה).

const MAX_ENTRIES = 300;
const MAX_LEN = 40;

function parseLexicon(text) {
  const byKey = new Map();
  const bad = [];
  String(text == null ? '' : text).split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const eq = line.indexOf('=');
    const from = eq < 0 ? '' : line.slice(0, eq).trim();
    const to = eq < 0 ? '' : line.slice(eq + 1).trim();
    if (!from || !to || from.length > MAX_LEN || to.length > MAX_LEN) { bad.push(i + 1); return; }
    const k = from.toLowerCase();
    if (!byKey.has(k) && byKey.size >= MAX_ENTRIES) { bad.push(i + 1); return; }
    byKey.delete(k); // האחרון קובע (וגם עובר לסוף הסדר)
    byKey.set(k, { from, to });
  });
  return { entries: [...byKey.values()], bad };
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\\/-]/g, '\\$&');

function applyLexicon(text, entries) {
  const s = String(text == null ? '' : text);
  const list = (Array.isArray(entries) ? entries : []).filter((e) => e && typeof e.from === 'string' && e.from && typeof e.to === 'string');
  if (!list.length) return s;
  const map = new Map();
  for (const e of list) map.set(e.from.toLowerCase(), e.to);
  const froms = [...map.keys()].sort((a, b) => b.length - a.length);
  const re = new RegExp(`(?<![\\p{L}\\p{N}'׳"״])([ובהלמשכ]{0,2})(${froms.map(esc).join('|')})(?![\\p{L}\\p{N}'׳])`, 'giu');
  return s.replace(re, (m, pre, word) => pre + map.get(word.toLowerCase()));
}

module.exports = { parseLexicon, applyLexicon, MAX_ENTRIES, MAX_LEN };
