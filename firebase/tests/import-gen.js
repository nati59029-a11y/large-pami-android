'use strict';
// מחולל קובצי ייבוא מדומים (ייבוא ברקע, 11.11.2026). נתונים מומצאים בלבד – לא קובץ לקוחות אמיתי.
// מספרי הכרטיס: 16 ספרות שעוברות ספרת ביקורת, עם תחילית 4580 ומספר רץ – לא כרטיסים אמיתיים. ת"ז: ספרת ביקורת תקינה, מספרים אקראיים.
// שימוש בבדיקות: const G = require('./import-gen'); G.customers(916) → { rows, ns }  (rows = כמו שהאפליקציה שולחת, ns = מספר השורה בקובץ)
// שימוש מהמסוף (קובץ CSV לבדיקה בטלפון, לא נכנס למאגר):
//   node tests/import-gen.js cust 916 /tmp/customers-916.csv [--cards]
//   node tests/import-gen.js prod 300 /tmp/products-300.csv
const fs = require('node:fs');

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const FIRST = ['דנה', 'יוסי', 'מיכל', 'אבי', 'רות', 'משה', 'שרה', 'דוד', 'נועה', 'איתי', 'תמר', 'אורי', 'ליאת', 'עמית', 'יעל', 'רון'];
const LAST = ['כהן', 'לוי', 'מזרחי', 'פרץ', 'ביטון', 'אברהם', 'פרידמן', 'אזולאי', 'דהן', 'שפירא', 'גולן', 'אוחיון'];
const CITY = ['אשדוד', 'ירושלים', 'חיפה', 'באר שבע', 'נתניה', 'חולון', 'רמת גן', 'אשקלון'];
const STREET = ['הרצל', 'ויצמן', 'בן גוריון', 'רוטשילד', 'הנשיא', 'ז\'בוטינסקי', 'העצמאות'];
function tzCheck(d8) { let s = 0; for (let i = 0; i < 8; i++) { let x = +d8[i] * ((i % 2) + 1); if (x > 9) x -= 9; s += x; } return d8 + String((10 - (s % 10)) % 10); }
function luhn15(d15) { let s = 0; for (let i = 0; i < 15; i++) { let x = +d15[14 - i]; if (i % 2 === 0) { x *= 2; if (x > 9) x -= 9; } s += x; } return d15 + String((10 - (s % 10)) % 10); }
const cardNo = (i) => luhn15('4580' + String(1000000 + i).padStart(11, '0'));

// לקוחות: כל השורות עם טלפון ייחודי (רובן גם ת"ז), כ-רבע עם כרטיס מוצפן (מספר, תוקף, שם, CVV), חלק עם 4 ספרות בלבד.
// bad = כמה שורות שגויות בכוונה (טלפון לא תקין ובלי ת"ז) – אותה דחייה בייבוא הישן ובחדש.
function customers(n, opts) {
  const o = Object.assign({ seed: 916, bad: 4, xKey: 'xcity' }, opts || {});
  const r = rng(o.seed); const pick = (a) => a[Math.floor(r() * a.length)];
  const rows = [], ns = [], cards = [];
  const tzs = new Set();
  for (let i = 0; i < n; i++) {
    const row = { name: pick(FIRST) + ' ' + pick(LAST), phone: '05' + String(2 + (i % 7)) + String(1000000 + i * 7 + 13).slice(-7) };
    if (i < o.bad) { row.phone = 'abc' + i; rows.push(row); ns.push(i + 2); continue; }
    if (r() < 0.6) { let tz; do { tz = tzCheck(String(10000000 + Math.floor(r() * 89999999))); } while (tzs.has(tz)); tzs.add(tz); row.tz = tz; }
    if (r() < 0.5) row.mail = 'user' + i + '@example.invalid';
    if (r() < 0.7) row.addr = pick(STREET) + ' ' + (1 + Math.floor(r() * 120)) + ', ' + pick(CITY);
    if (o.xKey && r() < 0.5) row.x = { [o.xKey]: pick(CITY) };
    if (i % 4 === 1) {
      const c = { num: cardNo(i), exp: String(1 + (i % 12)).padStart(2, '0') + '/' + (27 + (i % 5)), name: 'Test Holder', cvv: String(100 + (i % 900)) };
      row.cards = [c]; row.last4 = c.num.slice(-4); cards.push(c);
    } else if (i % 4 === 2) row.last4 = String(1000 + (i % 9000));
    rows.push(row); ns.push(i + 2);
  }
  return { rows, ns, cards };
}

// מוצרים: שם ייחודי, מחיר, ברקוד לרובם, כמות, קטגוריה/תת־קטגוריה, עלות וסיטונאי לחלק, הערה לחלק.
function products(n, opts) {
  const o = Object.assign({ seed: 300 }, opts || {});
  const r = rng(o.seed); const CAT = ['שתייה', 'מאפים', 'חלב', 'ניקיון']; const SUB = ['קר', 'חם', 'מבצע'];
  const rows = [], ns = [];
  for (let i = 0; i < n; i++) {
    const p = { name: 'מוצר ' + (i + 1), price: Math.round((1 + r() * 200) * 100) / 100 };
    if (i % 5) p.barcode = 'B' + String(i).padStart(6, '0');
    if (i % 3) p.qty = 1 + Math.floor(r() * 40);
    if (i % 2) { p.cat = CAT[i % CAT.length]; if (i % 4 === 1) p.sub = SUB[i % SUB.length]; }
    if (i % 3 === 0) p.cost = Math.round(p.price * 0.6 * 100) / 100;
    if (i % 7 === 0) p.wp = Math.round(p.price * 0.8 * 100) / 100;
    if (i % 11 === 0) p.note = 'הערה למוצר ' + (i + 1);
    rows.push(p); ns.push(i + 2);
  }
  return { rows, ns };
}

// השורה התקינה הגדולה ביותר (כל שדה במגבלה שלו, באותיות עבריות = 2 בתים לתו) – לבדיקת הגודל של חלק מוצפן.
const H = (k) => 'א'.repeat(k);
function maxCustomer(i, xKeys) {
  const port = (j) => ({ d: '2025-01-02', phone: '0521234567', tz: tzCheck(String(20000000 + j)), br: 'br1', co: H(40), act: 'y', bph: H(30), btz: H(20) });
  return {
    fn: H(30), ln: H(30), st: H(80), city: H(40), fl: H(10), apt: H(10), name: H(60), addr: H(150),
    bn: H(60), vat: '515555555', ct: H(60), pay: 'other', payTxt: H(60),
    phone: '05' + String(20000000 + i).slice(-8), tz: tzCheck(String(30000000 + i)), mail: 'a'.repeat(60) + '@' + 'b'.repeat(180) + '.com',
    last4: '1234', bank: H(300), prod: H(300), due: H(200), orig: H(100), stat: H(200), note: H(1000), od: H(100), bph: H(30), btz: H(20), bml: H(120),
    phs: ['0531111111', '0532222222', '0533333333'],
    ports: Array.from({ length: 30 }, (_, j) => port(j)),
    x: Object.fromEntries((xKeys || []).slice(0, 20).map((k) => [k, H(200)])),
    cards: [0, 1, 2].map((j) => ({ num: cardNo(900000 + i * 3 + j), exp: '12/30', name: 'A'.repeat(60), cvv: '1234' })),
  };
}
function maxProduct(i) { return { name: H(60), price: 99999.99, barcode: 'Z'.repeat(30), qty: 99999.999, cat: H(40), sub: H(40), wp: 99999.99, cost: 99999.99, pk: 9999, ct: 9999, note: H(500) }; }

function csv(kind, n, cardsCol) {
  const q = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
  if (kind === 'prod') {
    const { rows } = products(n);
    return ['שם,מחיר,ברקוד,כמות,קטגוריה,תת קטגוריה,עלות,מחיר סיטונאי,הערות'].concat(rows.map((p) => [p.name, p.price, p.barcode, p.qty, p.cat, p.sub, p.cost, p.wp, p.note].map(q).join(','))).join('\n') + '\n';
  }
  const { rows } = customers(n, { xKey: null });
  const head = ['שם', 'טלפון', 'ת.ז', 'מייל', 'כתובת'].concat(cardsCol ? ['מספר כרטיס מלא', 'תוקף', 'CVV'] : ['4 ספרות']);
  return [head.join(',')].concat(rows.map((c) => [c.name, c.phone, c.tz, c.mail, c.addr].concat(cardsCol ? (c.cards ? [c.cards[0].num, c.cards[0].exp, c.cards[0].cvv] : ['', '', '']) : [c.last4]).map(q).join(','))).join('\n') + '\n';
}

module.exports = { customers, products, maxCustomer, maxProduct, cardNo, tzCheck, csv };

if (require.main === module) {
  const [kind, n, out] = process.argv.slice(2);
  if (!['cust', 'prod'].includes(kind) || !(+n > 0) || !out) { console.error('usage: node tests/import-gen.js cust|prod <rows> <out.csv> [--cards]'); process.exit(1); }
  fs.writeFileSync(out, '﻿' + csv(kind, +n, process.argv.includes('--cards')));
  console.log('נכתב ' + out + ' (' + n + ' שורות מדומות)');
}
