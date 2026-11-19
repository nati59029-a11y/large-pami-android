'use strict';
// POS:W2 – איחוד גל 2 (18.11.2026): קריאת הגדרות הקופה בשרת, במקום אחד, לפי הסכמה של ש4 (lib/pos-cfg-schema.js).
// ש4 שומר ערכים ישירות במסמך poscfg/main (ומתגי מודולים ב-poscfg/sa); שלב 0 שמר אותם ב-poscfg/main.v. כאן שניהם נקראים:
// הערך של שלב 0 (v) הוא שכבה מתחת לערך של ש4, כך שאף ערך שמור לא הולך לאיבוד ולא נמחק. ערך לא תקין – ברירת המחדל (כמו ב-eff).
// → cfg: { <מפתח>: ערך } לכל 313 המפתחות (vatRate, discMax, cashMax, devApprove ...).
const S = require('./pos-cfg-schema');

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

function mainOf(doc) {
  if (!isObj(doc)) return null;
  if (!isObj(doc.v)) return doc;
  const m = Object.assign({}, doc.v, doc);
  delete m.v;
  return m;
}

async function cfgOf(db) {
  const [m, sa] = await Promise.all([db.doc('poscfg/main').get(), db.doc('poscfg/sa').get()]);
  return S.eff({ main: mainOf(m.exists ? m.data() : null), sa: sa.exists ? sa.data() : null }).cfg;
}

module.exports = { cfgOf, mainOf };
