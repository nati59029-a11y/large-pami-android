#!/usr/bin/env node
'use strict';
// מחולל נתוני דמו לקופה. כל רשומה מסומנת demo:true ו-src:'pos-load-demo', וכל שם מתחיל ב"דוגמה".
// דטרמיניסטי (זרע קבוע) – אותה פקודה מייצרת בדיוק אותם נתונים.
//
// שימוש:
//   node gen-demo-data.js [--products 5000] [--customers 2000] [--branches 4] [--sales 520] [--peak 60] [--seed 5787] [--out out]
//   node gen-demo-data.js --seed-emulator     # גם כותב לאמולטור (רק דרך run-emulator.sh)
//
// ברקודים: EAN-13 עם ספרת ביקורת תקינה, בטווח 200–299 (טווח פנימי לחנויות) – לא מתנגש בברקודים של מוצרים אמיתיים.
// מכירות: לכל סניף יום אחד (09:00–21:00), עם שעת שיא של --peak מכירות בשעה, וסה"כ לפחות --sales מכירות.

const fs = require('node:fs');
const path = require('node:path');

function args(argv) {
  const o = { products: 5000, customers: 2000, branches: 4, sales: 520, peak: 60, seed: 5787, out: path.join(__dirname, 'out'), seedEmulator: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--seed-emulator') o.seedEmulator = true;
    else if (a.startsWith('--')) { const k = a.slice(2); const v = argv[++i]; o[k] = k === 'out' ? v : Number(v); }
  }
  if (o.products < 1 || o.branches < 1 || o.branches > 9) throw new Error('פרמטרים לא תקינים');
  return o;
}

// PRNG דטרמיניסטי (mulberry32)
function rng(seed) {
  let a = seed >>> 0;
  const r = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  r.int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.weighted = (arr, w) => { let s = 0; const t = r() * w.reduce((x, y) => x + y, 0); for (let i = 0; i < arr.length; i++) { s += w[i]; if (t < s) return arr[i]; } return arr[arr.length - 1]; };
  return r;
}

function ean13(body12) {
  const d = body12.split('').map(Number);
  const s = d.reduce((acc, x, i) => acc + x * (i % 2 ? 3 : 1), 0);
  return body12 + ((10 - (s % 10)) % 10);
}
function eanOk(code) { return /^\d{13}$/.test(code) && ean13(code.slice(0, 12)) === code; }

const CATS = [
  ['אביזרי סלולר', ['מטענים', 'כבלים', 'כיסויים', 'מגני מסך', 'אוזניות']],
  ['כלי בית', ['מטבח', 'ניקיון', 'אחסון', 'כלי הגשה']],
  ['כלי כתיבה', ['עטים', 'מחברות', 'תיקים', 'קלסרים']],
  ['משחקים', ['קופסה', 'הרכבה', 'פאזלים', 'חוץ']],
  ['ממתקים', ['שוקולד', 'סוכריות', 'חטיפים', 'מארזים']],
  ['משקאות', ['מים', 'מיצים', 'קלים', 'חמים']],
  ['חשמל קטן', ['תאורה', 'סוללות', 'מפצלים', 'מאווררים']],
  ['כלי עבודה', ['ידניים', 'מדידה', 'ברגים', 'דבקים']],
  ['אריזות ומתנות', ['שקיות', 'נייר עטיפה', 'כרטיסי ברכה', 'סרטים']],
  ['ספרי קודש וכלי קודש', ['כריכות', 'נרתיקים', 'עמדות', 'תשמישים']],
];
const COLORS = ['שחור', 'לבן', 'כחול', 'אדום', 'ירוק', 'אפור'];
const SIZES = ['קטן', 'בינוני', 'גדול'];
const PAY = ['cash', 'card', 'card', 'card', 'bit']; // התפלגות משוערת – מסומנת כהערכה בדוח

// פרופיל שעתי של יום (09–21): משקל יחסי לכל שעה. שעת השיא מנורמלת ל-peak.
const HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
const HOUR_W = [0.45, 0.6, 0.75, 0.85, 0.7, 0.6, 0.65, 0.8, 0.95, 1.0, 0.85, 0.55];

function hourPlan(total, peak) {
  // מספר מכירות לכל שעה: השיא = peak, והשאר יחסי. אם הסכום קטן מ-total – מגדילים את השעות שאינן שיא (עד peak) עד שמגיעים.
  const plan = HOUR_W.map((w) => Math.round(w * peak));
  let sum = plan.reduce((a, b) => a + b, 0);
  for (let guard = 0; sum < total && guard < 10000; guard++) {
    const i = plan.reduce((best, v, j) => (v < plan[best] ? j : best), 0);
    if (plan[i] >= peak) break;
    plan[i]++; sum++;
  }
  return plan;
}

function generate(o) {
  const r = rng(o.seed);
  const branches = Array.from({ length: o.branches }, (_, i) => ({ id: 'br' + (i + 1), name: `סניף דוגמה ${i + 1}`, demo: true, src: 'pos-load-demo' }));

  const categories = [];
  CATS.forEach(([name, subs], ci) => subs.forEach((s, si) => categories.push({ id: `c${ci + 1}_${si + 1}`, cat: name, sub: s, name: `${name} / ${s}`, demo: true })));

  const products = [];
  const barcodes = new Set();
  let skuCount = 0;
  const nextBarcode = () => { // '2' + 11 ספרות אקראיות = 12 ספרות + ספרת ביקורת (טווח 200–299)
    let code;
    do { code = ean13('2' + String(r.int(0, 99_999_999_999)).padStart(11, '0')); } while (barcodes.has(code));
    barcodes.add(code);
    return code;
  };
  for (let i = 1; i <= o.products; i++) {
    const c = r.pick(categories);
    const base = Math.round((r() < 0.7 ? r.int(5, 60) : r.int(60, 600)) * 10) / 10;
    const cost = Math.round(base * (0.45 + r() * 0.25) * 100) / 100;
    const vkind = r.weighted(['none', 'color', 'size', 'color+size'], [55, 25, 12, 8]);
    const variants = [];
    if (vkind === 'none') variants.push({ vid: 'v0', label: '', barcode: nextBarcode(), price: base });
    else if (vkind === 'color') COLORS.slice(0, r.int(2, 4)).forEach((col, k) => variants.push({ vid: 'v' + k, label: col, barcode: nextBarcode(), price: base }));
    else if (vkind === 'size') SIZES.forEach((s, k) => variants.push({ vid: 'v' + k, label: s, barcode: nextBarcode(), price: Math.round(base * (1 + k * 0.15) * 10) / 10 }));
    else COLORS.slice(0, 2).forEach((col, a) => SIZES.forEach((s, b) => variants.push({ vid: `v${a}${b}`, label: `${col} ${s}`, barcode: nextBarcode(), price: Math.round(base * (1 + b * 0.15) * 10) / 10 })));
    skuCount += variants.length;
    products.push({
      id: 'p' + String(i).padStart(5, '0'), name: `מוצר דוגמה ${String(i).padStart(5, '0')} – ${c.sub}`, cat: c.id, price: base, cost, vat: true,
      variants, on: r() > 0.02, demo: true, src: 'pos-load-demo',
    });
  }

  const customers = Array.from({ length: o.customers }, (_, i) => ({
    id: 'k' + String(i + 1).padStart(5, '0'), name: `לקוח דוגמה ${String(i + 1).padStart(5, '0')}`,
    phone: '050000' + String(i + 1).padStart(4, '0'), // טווח 050-000xxxx – לא מספרים אמיתיים בפועל, לסימון בלבד
    biz: r() < 0.12, demo: true, src: 'pos-load-demo',
  }));

  // מוצרים "פופולריים" (80/20): 20% מהמוצרים מופיעים ב-80% מהשורות
  const hot = products.filter((p) => p.on).slice(0, Math.ceil(products.length * 0.2));
  const all = products.filter((p) => p.on);
  const plan = hourPlan(o.sales, o.peak);
  const sales = [];
  const day = '2026-11-17';
  for (const b of branches) {
    let n = 0;
    HOURS.forEach((h, hi) => {
      const cnt = plan[hi];
      // זמני הגעה אחידים-אקראיים בתוך השעה, ממוינים
      const mins = Array.from({ length: cnt }, () => r() * 3600).sort((a, b2) => a - b2);
      for (const sec of mins) {
        n++;
        const linesN = r.weighted([1, 2, 3, 4, 5, 6, 8, 12], [30, 22, 16, 11, 8, 6, 4, 3]);
        const lines = [];
        const used = new Set();
        for (let k = 0; k < linesN; k++) {
          const p = r() < 0.8 ? r.pick(hot) : r.pick(all);
          const v = r.pick(p.variants);
          const key = p.id + ':' + v.vid;
          if (used.has(key)) continue;
          used.add(key);
          lines.push({ pid: p.id, vid: v.vid, bc: v.barcode, qty: r.weighted([1, 2, 3, 5], [75, 15, 6, 4]), price: v.price });
        }
        const total = Math.round(lines.reduce((s, l) => s + l.qty * l.price, 0) * 100) / 100;
        const at = new Date(`${day}T${String(h).padStart(2, '0')}:00:00+02:00`).getTime() + Math.round(sec * 1000);
        sales.push({
          reqId: `demo-${b.id}-${String(n).padStart(4, '0')}`, // מזהה בקשה שהמכשיר יוצר מראש (גם בלי אינטרנט)
          br: b.id, dev: `${b.id}-pos${r.int(1, 2)}`, at, hour: h, lines, total,
          pay: { m: r.pick(PAY), amt: total }, custId: r() < 0.25 ? r.pick(customers).id : null, demo: true,
        });
      }
    });
  }
  sales.sort((a, b) => a.at - b.at);

  const meta = {
    demo: true, note: 'נתוני דוגמה בלבד – נוצרו אוטומטית ב-scripts/pos-load/gen-demo-data.js', seed: o.seed, day,
    counts: { branches: branches.length, categories: categories.length, products: products.length, skus: skuCount, barcodes: barcodes.size, customers: customers.length, sales: sales.length },
    salesPerBranch: plan.reduce((a, b) => a + b, 0), hourPlan: Object.fromEntries(HOURS.map((h, i) => [h, plan[i]])), peakPerHour: Math.max(...plan),
  };
  return { meta, branches, categories, products, customers, sales };
}

function validate(d, o) {
  const errs = [];
  const bcs = d.products.flatMap((p) => p.variants.map((v) => v.barcode));
  if (new Set(bcs).size !== bcs.length) errs.push('ברקודים כפולים');
  if (!bcs.every(eanOk)) errs.push('ברקוד עם ספרת ביקורת שגויה');
  if (d.products.length < 5000 && o.products >= 5000) errs.push('פחות מ-5,000 מוצרים');
  if (d.meta.salesPerBranch < o.sales) errs.push(`פחות מ-${o.sales} מכירות לסניף ביום (${d.meta.salesPerBranch})`);
  if (d.meta.peakPerHour !== o.peak) errs.push('שעת השיא אינה ' + o.peak);
  if (d.branches.length < 3 || d.branches.length > 5) errs.push('מספר הסניפים מחוץ לטווח 3–5');
  for (const k of ['branches', 'categories', 'products', 'customers', 'sales']) if (!d[k].every((x) => x.demo === true)) errs.push(`רשומה ב-${k} בלי סימון demo`);
  if (!d.products.every((p) => p.name.startsWith('מוצר דוגמה'))) errs.push('שם מוצר בלי "דוגמה"');
  return errs;
}

async function seedEmulator(d) {
  const { db, P } = require('./lib/env');
  const fdb = db();
  const w = fdb.bulkWriter();
  let n = 0;
  const put = (p, v) => { w.set(fdb.doc(P(p)), v); n++; };
  put('poscfg/demo', { demo: true, note: d.meta.note, counts: d.meta.counts, at: Date.now() });
  d.branches.forEach((b) => put('br/' + b.id, b));
  d.categories.forEach((c) => put('cat/' + c.id, c));
  d.customers.forEach((c) => put('cust/' + c.id, c));
  for (const p of d.products) {
    put('prod/' + p.id, p);
    for (const v of p.variants) put('bc/' + v.barcode, { pid: p.id, vid: v.vid, demo: true }); // חיפוש לפי ברקוד = קריאה אחת
  }
  await w.close();
  return n;
}

async function main() {
  const o = args(process.argv);
  const t0 = Date.now();
  const d = generate(o);
  const errs = validate(d, o);
  if (errs.length) { console.error('שגיאות בנתונים:\n- ' + errs.join('\n- ')); process.exit(1); }
  fs.mkdirSync(o.out, { recursive: true });
  for (const k of ['meta', 'branches', 'categories', 'products', 'customers', 'sales']) fs.writeFileSync(path.join(o.out, `demo-${k}.json`), JSON.stringify(d[k]));
  console.log('נתוני דוגמה נוצרו ב-' + o.out + ` (${Date.now() - t0}ms)`);
  console.log(JSON.stringify(d.meta, null, 1));
  if (o.seedEmulator) {
    const t1 = Date.now();
    const n = await seedEmulator(d);
    console.log(`נכתבו לאמולטור ${n} מסמכים (${Date.now() - t1}ms)`);
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { generate, validate, ean13, eanOk, hourPlan, rng };
