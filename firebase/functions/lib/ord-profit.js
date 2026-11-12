'use strict';
// 2026-11-12: רווחיות הזמנות – נוסחה משותפת (orders.js: ordProfit) ושעון ישראל. אותה נוסחה באפליקציה (orders-staff.js, ordProfitOf).
const { HttpsError } = require('firebase-functions/v2/https');
const bad = (reason, message) => new HttpsError('invalid-argument', message, { reason });
// רווח של הזמנה, באגורות: total פחות העלות של השורות. עלות השורה: it.c (נשמרה בהזמנה) או העלות הנוכחית של המוצר (הזמנה ישנה).
// שורה בלי עלות: nc = 'zero' – עלות 0; אחרת ('skip', ברירת מחדל) – השורה לא נספרת ברווח (גם המחיר שלה יורד מהסכום), ונספרת ב-miss.
// אותה נוסחה בדיוק באפליקציה (orders-staff.js, ordProfitOf).
function profitOf(o, cur, nc) {
  const items = Array.isArray(o.items) ? o.items : [];
  let cost = 0, skip = 0, miss = 0;
  for (const it of items) {
    if (!it) continue;
    const qty = typeof it.qty === 'number' ? it.qty : 0, price = typeof it.price === 'number' ? it.price : 0;
    const c = typeof it.c === 'number' ? it.c : (it.pid && cur && typeof cur.get(it.pid) === 'number' ? cur.get(it.pid) : null);
    if (c == null) { miss++; if (nc !== 'zero') skip += Math.round(qty * price * 100); } else cost += Math.round(qty * c * 100);
  }
  const total = Math.round((typeof o.total === 'number' ? o.total : 0) * 100);
  return { total, cost, profit: total - skip - cost, miss };
}

const ilFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
function ilDayStart(d) { // חצות בשעון ישראל של היום d, ב-ms
  const [y, m, dd] = d.split('-').map(Number);
  for (const off of [2, 3]) {
    const t = Date.UTC(y, m - 1, dd) - off * 3600e3;
    const p = Object.fromEntries(ilFmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    if (`${p.year}-${p.month}-${p.day}` === d && p.hour === '00') return t;
  }
  throw bad('bad-date', 'תאריך לא תקין');
}

module.exports = { profitOf, ilDayStart };
