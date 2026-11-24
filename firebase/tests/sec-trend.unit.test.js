'use strict';
// גיטי – ניתוחים (firebase/functions/lib/sec-trend.js = app-source/www/sec-trend.js, סבב 4 חלק ב, 24.11.2026). בדיקות יחידה, בלי אמולטור ובלי רשת.
// מגמות (חודש קודם / אשתקד / 12 חודשים), הוצאה חריגה (גבולות 30% ו-200 ₪, זיכוי, ספק בלי היסטוריה, בלי כפילות), קצב הזמנות,
// בדיקת המבנה בשרת (cleanFin), הכלים בצ'אט (getTrends / getOrderSuggestions) וסיכום הבוקר (daySum – פסקה, כל חריגה פעם אחת).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const TR = require('../functions/lib/sec-trend');
const ST = require('../functions/lib/sec-tools');
const R = require('../functions/lib/sec-remind');

// fin לדוגמה: m = { 'YYYY-MM': { e: { ספק: סכום }, c: { קטגוריה: סכום } } }; ספקים בקטגוריה "ספקים"
function finOf(m, o) {
  o = o || {};
  const spn = [], ix = {};
  const id = (n, k) => { const key = n + '|' + k; if (!(key in ix)) { ix[key] = spn.length; spn.push([n, k, k === 'i' ? 'מכירות' : 'ספקים']); } return ix[key]; };
  const months = {};
  for (const [mon, x] of Object.entries(m)) {
    const sp = [], cats = [];
    let exp = 0, inc = 0;
    for (const [n, v] of Object.entries(x.e || {})) { sp.push([id(n, 'e'), v]); exp += v; }
    for (const [n, v] of Object.entries(x.i || {})) { sp.push([id(n, 'i'), v]); inc += v; }
    for (const [n, v] of Object.entries(x.c || {})) cats.push([n, 'e', v]);
    if (!x.c && exp) cats.push(['ספקים', 'e', exp]);
    if (inc) cats.push(['מכירות', 'i', inc]);
    months[mon] = { inc, exp, own: 0, cats, sp };
  }
  const f = { v: 1, at: o.at || Date.UTC(2026, 10, 20, 9), months, spn };
  if (o.ord) f.ord = Object.entries(o.ord).map(([n, D]) => [id(n, 'e'), D.map(TR.dayNum)]);
  return f;
}
const T = '2026-11-20';
const hist = (v) => ({ '2026-08': { e: { A: v[0] } }, '2026-09': { e: { A: v[1] } }, '2026-10': { e: { A: v[2] } } });

describe('sec-trend: אותו קובץ במכשיר ובשרת', () => {
  it('app-source/www/sec-trend.js זהה ל-firebase/functions/lib/sec-trend.js', () => {
    const a = fs.readFileSync(path.join(__dirname, '../functions/lib/sec-trend.js'), 'utf8');
    const b = fs.readFileSync(path.join(__dirname, '../../app-source/www/sec-trend.js'), 'utf8');
    assert.equal(a, b);
  });
});

describe('sec-trend: הוצאה חריגה – גבולות', () => {
  it('בדיוק 30% מעל הממוצע וגם מעל 200 – חריג; פחות מ-30% – לא', () => {
    assert.ok(TR.isAnomaly(1300, [1000, 1000, 1000]));
    assert.equal(TR.isAnomaly(1299.99, [1000, 1000, 1000]), null);
    const a = TR.isAnomaly(1300, [1000, 1000, 1000]);
    assert.deepEqual([a.avg3, a.over, a.overPct], [1000, 300, 30]);
  });
  it('ממוצע לא עגול (אגורות): 30% בדיוק מעל 333.33 – חריג, אגורה פחות – לא', () => {
    // ממוצע 1000/3 = 333.333…; ‎×1.3 = 433.333… – 433.34 עובר, 433.33 לא
    assert.ok(TR.isAnomaly(433.34, [300, 300, 400]));
    assert.equal(TR.isAnomaly(433.33, [300, 300, 400]), null);
  });
  it('גבול 200 ₪: בדיוק 200 – לא חריג (צריך "מעל"); 200.01 – חריג', () => {
    assert.equal(TR.isAnomaly(200, [100, 100, 100]), null);
    assert.ok(TR.isAnomaly(200.01, [100, 100, 100]));
  });
  it('ספק בלי היסטוריה / חודש אחד בלבד – לא חריג', () => {
    assert.equal(TR.isAnomaly(5000, [0, 0, 0]), null);
    assert.equal(TR.isAnomaly(5000, [0, 0, 100]), null);
    assert.ok(TR.isAnomaly(5000, [0, 100, 100]), 'שני חודשים – מספיק');
  });
  it('זיכוי: סך חודשי שלילי בהיסטוריה לא נספר כחודש פעיל; סך שלילי עכשיו – לא חריג', () => {
    assert.equal(TR.isAnomaly(5000, [-300, 0, 100]), null);
    assert.equal(TR.isAnomaly(-500, [100, 100, 100]), null);
  });
});

describe('sec-trend: anomalies על נתוני כספים', () => {
  it('ספק חריג בחודש הנוכחי, עם מזהה קבוע', () => {
    const f = finOf(Object.assign(hist([1000, 1000, 1000]), { '2026-11': { e: { A: 1500 } } }));
    const L = TR.anomalies(f, { today: T });
    assert.equal(L.length, 1);
    assert.deepEqual([L[0].by, L[0].name, L[0].month, L[0].amount, L[0].avg3, L[0].overPct], ['sup', 'A', '2026-11', 1500, 1000, 50]);
    assert.equal(L[0].key, 'an:sup:A:2026-11');
    assert.deepEqual(TR.anomalies(f, { today: T }).map((x) => x.key), [L[0].key], 'אותה תוצאה בכל קריאה');
  });
  it('זיכוי באותו חודש מוריד את הסכום – אחרי הזיכוי כבר לא חריג', () => {
    // החשבונית 1500 והזיכוי -300 (secFin סוכם ל-1200)
    const f = finOf(Object.assign(hist([1000, 1000, 1000]), { '2026-11': { e: { A: 1200 } } }));
    assert.equal(TR.anomalies(f, { today: T }).length, 0);
  });
  it('בלי כפילות: הקטגוריה של ספק חריג לא מסומנת שוב; קטגוריה בלי ספק חריג – כן', () => {
    const m = {};
    for (const mon of ['2026-08', '2026-09', '2026-10']) m[mon] = { e: { A: 1000 }, c: { 'ספקים': 1000, 'חשמל': 500 } };
    m['2026-11'] = { e: { A: 2000 }, c: { 'ספקים': 2000, 'חשמל': 900 } };
    const L = TR.anomalies(finOf(m), { today: T });
    assert.deepEqual(L.map((x) => x.by + ':' + x.name).sort(), ['cat:חשמל', 'sup:A']);
  });
  it('פחות מ-3 חודשי נתונים לפני החודש – אין חריגות (אין היסטוריה)', () => {
    const f = finOf({ '2026-10': { e: { A: 100 } }, '2026-11': { e: { A: 5000 } } });
    assert.equal(TR.anomalies(f, { today: T }).length, 0);
  });
  it('גם החודש הקודם נבדק (תחילת חודש), והכנסות לא נבדקות', () => {
    const m = Object.assign({ '2026-07': { e: { A: 1000 } } }, hist([1000, 1000, 2000]));
    m['2026-07'].i = { C: 100 }; m['2026-10'].i = { C: 900 };
    m['2026-07'].c = { 'ספקים': 1000 }; m['2026-08'].c = { 'ספקים': 1000 }; m['2026-09'].c = { 'ספקים': 1000 }; m['2026-10'].c = { 'ספקים': 2000 };
    const L = TR.anomalies(finOf(m), { today: '2026-11-02' });
    assert.deepEqual(L.map((x) => x.key), ['an:sup:A:2026-10']);
  });
  it('בלי נתונים / מכשיר ישן (בלי פירוט ספקים) – לא נשבר', () => {
    assert.deepEqual(TR.anomalies(null, { today: T }), []);
    const f = finOf(Object.assign(hist([1000, 1000, 1000]), { '2026-11': { e: { A: 1500 } } }));
    delete f.spn; Object.values(f.months).forEach((x) => delete x.sp);
    assert.deepEqual(TR.anomalies(f, { today: T }).map((x) => x.by), ['cat'], 'לפי קטגוריה בלבד');
  });
});

describe('sec-trend: מגמות', () => {
  const m = {};
  for (let i = 0; i < 14; i++) { const mon = TR.addMon('2026-11', -i); m[mon] = { e: { A: 100 + i, B: 50 }, i: { C: 1000 } }; }
  m['2025-11'].e.A = 80;
  const f = finOf(m);
  it('12 חודשים, החודש מול הקודם ומול אשתקד, לפי ספק', () => {
    const r = TR.trends(f, { today: T, by: 'sup', kind: 'e' });
    assert.equal(r.months.length, 12); assert.equal(r.months[11], '2026-11'); assert.equal(r.months[0], '2025-12');
    assert.equal(r.prevMonth, '2026-10'); assert.equal(r.lastYearMonth, '2025-11');
    const A = r.rows.find((x) => x.name === 'A');
    assert.deepEqual([A.month, A.prevMonth, A.lastYear, A.vsPrevPct, A.vsLastYearPct], [100, 101, 80, -1, 25]);
    assert.equal(A.series.length, 12);
    assert.ok(r.rows.every((x) => x.by === 'sup' && x.kind === 'e'));
    assert.equal(r.totals.find((x) => x.month === '2026-11').expenses, 150);
  });
  it('חודש שנבחר, קטגוריות, הכנסות, חיפוש', () => {
    const r = TR.trends(f, { today: T, month: '2026-06', by: 'cat', kind: 'i' });
    assert.equal(r.month, '2026-06'); assert.deepEqual(r.rows.map((x) => x.name), ['מכירות']);
    assert.deepEqual(TR.trends(f, { today: T, q: 'b' }).rows.map((x) => x.name), ['B']);
  });
  it('בסיס 0 – בלי אחוז (null), לא אינסוף', () => {
    const g = finOf({ '2026-11': { e: { N: 300 } } });
    const N = TR.trends(g, { today: T, by: 'sup' }).rows[0];
    assert.equal(N.vsPrevPct, null); assert.equal(N.vsLastYearPct, null);
    assert.equal(TR.trends(g, { today: T }).hasLastYear, false);
  });
});

describe('sec-trend: קצב הזמנות', () => {
  it('כל 7 ימים, האחרונה לפני 7 – מוצע; פרטים נכונים', () => {
    const f = finOf({ '2026-11': { e: { A: 1 } } }, { ord: { A: ['2026-10-23', '2026-10-30', '2026-11-06', '2026-11-13'] } });
    const L = TR.orderTips(f, { today: T });
    assert.equal(L.length, 1);
    assert.deepEqual([L[0].name, L[0].every, L[0].daysSince, L[0].lastDate, L[0].orders], ['A', 7, 7, '2026-11-13', 4]);
  });
  it('עוד לא הגיע הזמן – לא מוצע (אלא אם all)', () => {
    const f = finOf({ '2026-11': { e: { A: 1 } } }, { ord: { A: ['2026-10-30', '2026-11-06', '2026-11-13', '2026-11-18'] } });
    assert.equal(TR.orderTips(f, { today: T }).length, 0);
    assert.equal(TR.orderTips(f, { today: T, all: true })[0].due, false);
  });
  it('פחות מ-3 חשבוניות / הפסיקו לעבוד (הרבה מעבר לקצב) / תאריך עתידי – לא מוצע', () => {
    const two = finOf({ '2026-11': { e: { A: 1 } } }, { ord: { A: ['2026-11-01', '2026-11-08'] } });
    assert.equal(TR.orderTips(two, { today: T }).length, 0);
    const old = finOf({ '2026-11': { e: { A: 1 } } }, { ord: { A: ['2026-06-01', '2026-06-08', '2026-06-15'] } });
    assert.equal(TR.orderTips(old, { today: T }).length, 0);
    const fut = finOf({ '2026-11': { e: { A: 1 } } }, { ord: { A: ['2026-10-30', '2026-11-06', '2026-11-13', '2026-11-25'] } });
    assert.equal(TR.orderTips(fut, { today: T })[0].lastDate, '2026-11-13', 'חשבונית עתידית לא נחשבת');
  });
  it('קצב לפי חציון (חשבונית חריגה באמצע לא משנה), בלי ord – ריק', () => {
    const f = finOf({ '2026-11': { e: { A: 1 } } }, { ord: { A: ['2026-10-02', '2026-10-12', '2026-10-13', '2026-10-23', '2026-11-02', '2026-11-12'] } });
    assert.equal(TR.orderTips(f, { today: T, all: true })[0].every, 10);
    assert.deepEqual(TR.orderTips(finOf({ '2026-11': { e: { A: 1 } } }), { today: T }), []);
  });
});

describe('sec-trend: שרת – cleanFin, כלים בצ\'אט, סיכום בוקר', () => {
  const base = () => finOf(Object.assign(hist([1000, 1000, 1000]), { '2026-11': { e: { A: 1500 } } }), { ord: { A: ['2026-10-23', '2026-10-30', '2026-11-06', '2026-11-13'] } });
  it('cleanFin שומר spn/sp/ord תקינים וזורק לא תקינים', () => {
    const x = base();
    x.spn.push(['', 'e', '']); x.months['2026-11'].sp.push([99, 5], [0, 'x']); x.ord.push([99, [1]]);
    const f = ST.cleanFin(x);
    assert.equal(f.spn[0][0], 'A');
    assert.deepEqual(f.months['2026-11'].sp, [[0, 1500]]);
    assert.equal(f.ord.length, 1);
    assert.equal(ST.cleanFin({ v: 1, at: 1, months: {} }).spn, undefined, 'מכשיר ישן – בלי השדות');
  });
  it('getTrends: מגמות + חריגות, עם מקור; getOrderSuggestions: הצעה בלבד', async () => {
    const fin = ST.cleanFin(base());
    const ctx = { now: Date.UTC(2026, 10, 20, 9), fin, finFrom: 'dev' };
    const r = await ST.runTool('getTrends', { by: 'supplier' }, ctx);
    assert.equal(r.month, '2026-11');
    assert.equal(r.rows[0].name, 'A'); assert.equal(r.rows[0].vsPrevPct, 50);
    assert.equal(r.anomalies.length, 1); assert.equal(r.anomalies[0].overPct, 50);
    const o = await ST.runTool('getOrderSuggestions', {}, ctx);
    assert.equal(o.items[0].everyDays, 7); assert.equal(o.items[0].daysSinceLast, 7);
    assert.match(o.note, /הצעה בלבד/);
    assert.ok(ST.FIN_TOOLS.includes('getTrends') && ST.toolsFor('app', {}).includes('getOrderSuggestions'));
    assert.ok(!ST.toolsFor('app', { brLimited: true }).includes('getTrends'), 'מנהל עם הגבלת סניפים – לא');
    const src = ST.sourceOf('getTrends', {}, ctx);
    assert.match(src.l, /נתוני המכשיר/);
    const v = ST.verify('הוצאה חריגה: 1,500 ₪ (+50%)', [{ data: r, src }], '');
    assert.equal(v.unverified.length, 0); assert.equal(v.srcs.length, 1);
    assert.equal((await ST.runTool('getTrends', {}, { now: 1, fin: null })).error, 'no-data');
  });
  it('סיכום בוקר: פסקת חריגות פעם אחת; לא בסיכום ערב', () => {
    const fin = ST.cleanFin(base());
    const o = { kind: 'am', today: T, now: Date.UTC(2026, 10, 20, 6), dayStart: 0, fin, tasks: [], cal: [], wait: {}, acts: { ok: 0, fail: 0 } };
    const a = R.daySum(o);
    assert.match(a.body, /הוצאות חריגות/); assert.match(a.body, /ספק A/);
    assert.deepEqual(a.an, ['an:sup:A:2026-11']);
    const b = R.daySum(Object.assign({}, o, { anSeen: { 'an:sup:A:2026-11': 1 } }));
    assert.doesNotMatch(b.body, /הוצאות חריגות/); assert.deepEqual(b.an, []);
    assert.doesNotMatch(R.daySum(Object.assign({}, o, { kind: 'pm' })).body, /הוצאות חריגות/);
  });
});
