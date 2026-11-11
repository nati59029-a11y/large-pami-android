'use strict';
// מעבר לאירופה (11.11.2026): רשימת פונקציות לפרסום, מופקת מהקוד עצמו (functions/index.js) – לא רשימה ידנית.
// קורא בלבד: טוען את index.js ובודק לכל פונקציה מה סוגה ובאילו אזורים היא מוגדרת. לא פונה לשום שרת.
// שימוש (מתוך התיקייה firebase/, אחרי npm ci):
//   node scripts/list-callable-functions.js              ← כל פונקציות onCall, מופרדות בפסיק (קלט ל-deploy-functions.yml)
//   node scripts/list-callable-functions.js --batches 20 ← אותה רשימה במנות של 20 שמות (שורה לכל מנה – הרצה לכל שורה)
//   node scripts/list-callable-functions.js --table      ← כל הפונקציות המיוצאות: שם, סוג, אזורים
const path = require('path');
const m = require(path.join(__dirname, '..', 'functions', 'index.js'));

const kindOf = (e) => (e.callableTrigger ? 'onCall' : e.httpsTrigger ? 'onRequest' : e.scheduleTrigger ? 'onSchedule' : e.eventTrigger ? 'event' : 'unknown');
const all = Object.entries(m)
  .filter(([, f]) => f && f.__endpoint)
  .map(([name, f]) => ({ name, kind: kindOf(f.__endpoint), regions: [].concat(f.__endpoint.region || []) }))
  .sort((a, b) => a.name.localeCompare(b.name));
const callable = all.filter((x) => x.kind === 'onCall').map((x) => x.name);

const arg = process.argv[2];
if (arg === '--table') {
  for (const x of all) console.log([x.name, x.kind, x.regions.join('+')].join('\t'));
  console.log(`סה"כ ${all.length} פונקציות, מתוכן ${callable.length} onCall`);
} else if (arg === '--batches') {
  const n = Number(process.argv[3]);
  if (!Number.isInteger(n) || n < 1) { console.error('usage: --batches <N>'); process.exit(1); }
  for (let i = 0; i < callable.length; i += n) console.log(callable.slice(i, i + n).join(','));
} else if (!arg) {
  console.log(callable.join(','));
} else {
  console.error('usage: [--table | --batches <N>]');
  process.exit(1);
}
