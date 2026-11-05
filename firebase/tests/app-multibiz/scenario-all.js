'use strict';
// ריבוי עסקים, שלב 6ב: מריץ את scenario.js כשבמסמך העסק של לארג' פעמי כל תשע התוספות מופעלות (כמו בייצור).
// הסיבה: ב-scenario.js המקורי מופעלות שתיים בלבד, ובעקבות הסתרת התוספות הכבויות (6ב) תחזיות כמו "משוב" לא היו נשלחות.
// שימוש זהה: node scenario-all.js <www-dir> <out.json> <variant>
const fs = require('fs');
const path = require('path');
const ALL = "Object.fromEntries(['scan','shelf','feedback','tasks','suppliers','requests','cashClose','yemot','orders'].map((k) => [k, true]))";
let src = fs.readFileSync(path.join(__dirname, 'scenario.js'), 'utf8');
const a = "dataRoot: 'legacy', features: { tasks: true, cashClose: true }";
if (!src.includes(a)) throw new Error('scenario.js השתנה: לא נמצא המקום להחלפה');
src = src.replace(a, "dataRoot: 'legacy', features: " + ALL).replace("require('./harness')", 'require(path.join(__dirname, \'harness\'))');
new Function('require', 'process', '__dirname', 'path', src)(require, process, __dirname, path);
