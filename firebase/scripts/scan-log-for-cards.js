'use strict';
// ייבוא ברקע (11.11.2026): בדיקה שביומן הריצה של הבדיקות (כולל היומנים של הפונקציות באמולטור) אין אף מספר כרטיס
// מהקבצים המדומים (tests/import-gen.js) ואין CVV ליד שם השדה. רץ ב-CI אחרי test:multibiz.
// שימוש: node scripts/scan-log-for-cards.js <קובץ יומן>   ← יוצא עם קוד 1 אם נמצא משהו (בלי להדפיס את המספר עצמו)
const fs = require('node:fs');
const path = require('node:path');
const G = require(path.join(__dirname, '..', 'tests', 'import-gen.js'));

const file = process.argv[2];
if (!file || !fs.existsSync(file)) { console.error('usage: node scripts/scan-log-for-cards.js <log>'); process.exit(2); }
const log = fs.readFileSync(file, 'utf8');
const nums = new Set();
G.customers(916).cards.forEach((c) => nums.add(c.num));
G.customers(60, { seed: 77, bad: 0 }).cards.forEach((c) => nums.add(c.num));
const XK = Array.from({ length: 20 }, (_, i) => 'x' + String.fromCharCode(97 + i) + 'k');
for (let i = 0; i < 200; i++) G.maxCustomer(i, XK).cards.forEach((c) => nums.add(c.num));
// גם עם מפרידים (רווח/מקף/נקודה בין קבוצות של 4)
const fmt = (n) => [n, n.replace(/(\d{4})(?=\d)/g, '$1 '), n.replace(/(\d{4})(?=\d)/g, '$1-'), n.replace(/(\d{4})(?=\d)/g, '$1.')];
let hits = 0;
for (const n of nums) for (const v of fmt(n)) if (log.includes(v)) hits++;
const cvv = (log.match(/cvv\W{0,4}\d{3,4}/gi) || []).length;
if (hits || cvv) { console.error(`נמצאו ביומן: ${hits} מספרי כרטיס מדומים, ${cvv} ערכי CVV. (המספרים עצמם לא מודפסים)`); process.exit(1); }
console.log(`יומן נקי: ${nums.size} מספרי כרטיס מדומים ו-CVV נבדקו, לא נמצאו (${log.length} תווים).`);
