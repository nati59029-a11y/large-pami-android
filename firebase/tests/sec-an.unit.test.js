'use strict';
// גיטי – סבב 4 חלק ב (24.11.2026): חישובי מגמות, הוצאה חריגה והצעות הזמנה (lib/sec-an.js) – טהור, בלי אמולטור.
// מקרי קצה: אין נתונים, פחות מ-3 חודשים, חודש חסר, זיכויים / סכומים שליליים, מראה ישנה בלי ספקים, רשימת ספקים מקוצרת, ספים מותאמים,
// חודש נוכחי חלקי; הצעות הזמנה: מלאי אמין / לא אמין / אין נתונים / כבר ב"להזמין מספקים" / בלי ספק / לא זמין / החזרות / קיצוץ תנועות.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const AN = require('../functions/lib/sec-an.js');
const ST = require('../functions/lib/sec-tools.js');

const AT = Date.parse('2026-11-15T10:00:00+02:00'); // הנתונים "נכונים ל" 15.11.2026 → החודש האחרון שהסתיים: 2026-10
const mo = (inc, exp, cats, sups, supT) => Object.assign({ inc, exp, own: 0, cats: cats || [] }, sups ? { sups } : {}, supT ? { supT: 1 } : {});
const e = (n, v) => [n, 'e', v];
function fin(months) { return { v: 1, at: AT, months }; }
// 2026-07..10 + 2025-10 + 2026-11 (חלקי)
function base() {
  return fin({
    '2025-10': mo(9000, 5000, [e('חומרי גלם', 2000)], [['אבי', 1500]]),
    '2026-07': mo(10000, 6000, [e('חומרי גלם', 1000), e('חשמל', 500)], [['אבי', 1000], ['דני', 300]]),
    '2026-08': mo(10000, 6000, [e('חומרי גלם', 1000), e('חשמל', 500)], [['אבי', 1000], ['דני', 300]]),
    '2026-09': mo(11000, 6200, [e('חומרי גלם', 1000), e('חשמל', 520)], [['אבי', 1000], ['דני', 300]]),
    '2026-10': mo(12100, 7000, [e('חומרי גלם', 1600), e('חשמל', 600), ['מכירות', 'i', 12100]], [['אבי', 1700], ['דני', 360]]),
    '2026-11': mo(5000, 3000, [e('חומרי גלם', 1500)], [['אבי', 1400]]),
  });
}

describe('מגמות – trends', () => {
  it('החודש האחרון שהסתיים מול הקודם ומול אשתקד: הכנסות, הוצאות, קטגוריות, ספקים; החודש הנוכחי – חלקי, בלי אחוזים', () => {
    const t = AN.trends(base(), {});
    assert.equal(t.ok, true); assert.deepEqual([t.cur, t.last, t.prev, t.py], ['2026-11', '2026-10', '2026-09', '2025-10']);
    assert.deepEqual(t.inc, { v: 12100, prev: 11000, py: 9000, dPrev: 10, dPy: 34 });
    assert.deepEqual(t.exp, { v: 7000, prev: 6200, py: 5000, dPrev: 13, dPy: 40 });
    assert.deepEqual(t.cats.map((c) => c.n), ['חומרי גלם', 'חשמל'], 'רק הוצאות, מהגדולה');
    assert.deepEqual(t.cats[0], { n: 'חומרי גלם', v: 1600, prev: 1000, py: 2000, dPrev: 60, dPy: -20 });
    assert.equal(t.cats[1].py, 0, 'קטגוריה שלא הייתה בחודש קיים – 0'); assert.equal(t.cats[1].dPy, null, 'אחוז מול 0 – אין');
    assert.equal(t.supOk, true); assert.deepEqual(t.sups[0], { n: 'אבי', v: 1700, prev: 1000, py: 1500, dPrev: 70, dPy: 13 });
    assert.deepEqual(t.part, { m: '2026-11', to: '2026-11-15', inc: 5000, exp: 3000 });
    assert.equal(t.part.dPrev, undefined, 'חודש חלקי – בלי אחוזי שינוי');
  });
  it('הוצאה חריגה: ≥30% מעל ממוצע 3 חודשים וגם ≥200 ₪ – קטגוריה וספק; חודש נוכחי שכבר עבר את הסף – מסומן חלקי', () => {
    const t = AN.trends(base(), {});
    assert.equal(t.hist, true);
    const k = (a) => a.k + ':' + a.n + ':' + a.m + (a.part ? ':p' : '');
    // חומרי גלם 1600 מול 1000 (+60%, +600) – כן; חשמל 600 מול 506.67 (+18%) – לא; אבי 1700 מול 1000 – כן; דני 360 מול 300 (+20%, +60) – לא
    // נובמבר (חלקי): חומרי גלם 1500 מול ממוצע 08–10 (1200): +25% – לא; אבי 1400 מול 1233.33: +14% – לא
    assert.deepEqual(t.anoms.map(k), ['sup:אבי:2026-10', 'cat:חומרי גלם:2026-10']);
    const a = t.anoms.find((x) => x.k === 'cat');
    assert.deepEqual([a.v, a.avg, a.diff, a.pct], [1600, 1000, 600, 60]);
    const f = base(); f.months['2026-11'].cats = [e('חומרי גלם', 2000)];
    assert.ok(AN.trends(f, {}).anoms.some((x) => x.k === 'cat' && x.m === '2026-11' && x.part === true && x.v === 2000), 'חודש נוכחי שכבר חרג');
  });
  it('גבולות: אחוז בלי סכום (פחות מ-200 ₪) – לא; סכום בלי אחוז – לא; בדיוק על הסף – כן; ספים מותאמים מ-sec_cfg/perm', () => {
    const m3 = (v) => mo(0, v, [e('X', v)]);
    const F = (cur) => fin({ '2026-07': m3(100), '2026-08': m3(100), '2026-09': m3(100), '2026-10': m3(cur) });
    assert.equal(AN.trends(F(250), {}).anoms.length, 0, '+150% אבל רק 150 ₪');
    const G = (cur) => fin({ '2026-07': m3(10000), '2026-08': m3(10000), '2026-09': m3(10000), '2026-10': m3(cur) });
    assert.equal(AN.trends(G(12000), {}).anoms.length, 0, '+2,000 ₪ אבל רק 20%');
    assert.equal(AN.trends(G(13000), {}).anoms.length, 1, 'בדיוק 30% ו-3,000 ₪');
    assert.equal(AN.trends(F(300), {}).anoms.length, 1, 'בדיוק 200 ₪ (+200%)');
    assert.equal(AN.trends(G(12000), { anPct: 20, anMin: 2000 }).anoms.length, 1, 'ספים מותאמים');
    assert.equal(AN.trends(F(300), { anPct: 30, anMin: 500 }).anoms.length, 0);
  });
  it('פחות מ-3 חודשי היסטוריה / חודש חסר באמצע – לא בודקים חריגות (hist:false), עם הערה', () => {
    const f = base(); delete f.months['2026-07'];
    const t = AN.trends(f, {});
    assert.equal(t.hist, false); assert.equal(t.anoms.filter((a) => !a.part).length, 0);
    assert.ok(t.notes.some((n) => /3 חודשים/.test(n)));
    const g = base(); delete g.months['2026-08'];
    assert.equal(AN.trends(g, {}).hist, false, 'חודש חסר באמצע');
    assert.equal(AN.anLine(AN.trends(g, {})).includes('אין מספיק היסטוריה'), true);
  });
  it('זיכויים וסכומים שליליים: ממוצע ≤ 0 – אין בסיס; החודש שלילי – לא חריגה; חודש עם זיכוי נכנס לממוצע', () => {
    const m3 = (v) => mo(0, v, [e('X', v)]);
    const F = (a, b, c, cur) => fin({ '2026-07': m3(a), '2026-08': m3(b), '2026-09': m3(c), '2026-10': m3(cur) });
    assert.equal(AN.trends(F(-100, 0, 50, 5000), {}).anoms.length, 0, 'ממוצע שלילי');
    assert.equal(AN.trends(F(0, 0, 0, 5000), {}).anoms.length, 0, 'ממוצע 0 (קטגוריה חדשה) – אין בסיס');
    assert.equal(AN.trends(F(1000, 1000, 1000, -400), {}).anoms.length, 0, 'החודש – זיכוי');
    const t = AN.trends(F(1000, 1000, -500, 1000), {}); // ממוצע 500 → 1000 = +100%, +500
    assert.deepEqual(t.anoms.map((a) => [a.avg, a.pct]), [[500, 100]]);
  });
  it('מראה ישנה בלי sups: ההשוואה לספקים לא מוצגת (sups:null) והקטגוריות ממשיכות לעבוד', () => {
    const f = base(); for (const k of Object.keys(f.months)) delete f.months[k].sups;
    const t = AN.trends(f, {});
    assert.equal(t.supOk, false); assert.equal(t.sups, null);
    assert.ok(t.notes.some((n) => /סכומי ספקים/.test(n)));
    assert.deepEqual(t.anoms.map((a) => a.k), ['cat']);
    const g = base(); delete g.months['2026-07'].sups; // חודש היסטוריה אחד בלי ספקים – לא בודקים ספקים
    assert.deepEqual(AN.trends(g, {}).anoms.map((a) => a.k), ['cat']);
  });
  it('רשימת ספקים מקוצרת (supT): ספק שלא ברשימה – "לא ידוע" (לא 0, בלי חריגה מומצאת); ברשימה מלאה – 0', () => {
    const f = base();
    f.months['2026-10'].sups.push(['חדש', 900]);
    f.months['2026-07'].supT = 1; // ב-07 הרשימה קוצרה – "חדש" לא ידוע שם
    assert.ok(!AN.trends(f, {}).anoms.some((a) => a.n === 'חדש'));
    const t = AN.trends(f, {}); assert.equal(t.sups.find((s) => s.n === 'חדש').prev, 0);
    const g = base(); g.months['2026-10'].sups.push(['חדש', 900]); g.months['2026-07'].sups.push(['חדש', 100]); g.months['2026-08'].sups.push(['חדש', 100]); g.months['2026-09'].sups.push(['חדש', 100]);
    assert.ok(AN.trends(g, {}).anoms.some((a) => a.n === 'חדש' && a.pct === 800));
  });
  it('אין נתונים / אין חודש אחרון: ok:false או has:false, ושורת הבוקר ריקה', () => {
    assert.equal(AN.trends(null, {}).ok, false);
    assert.equal(AN.trends({ v: 1, months: {} }, {}).ok, false, 'בלי at');
    const t = AN.trends(fin({ '2026-11': mo(1, 1) }), {});
    assert.equal(t.ok, true); assert.equal(t.has, false); assert.equal(t.inc.v, null); assert.equal(t.inc.dPrev, null);
    assert.equal(AN.anLine(t), ''); assert.equal(AN.anLine(null), '');
  });
  it('anLine: שורה אחת – הכנסות והוצאות מול החודש הקודם והחריגות', () => {
    const s = AN.anLine(AN.trends(base(), {}));
    assert.equal(s.split('\n').length, 1);
    assert.match(s, /^מגמות וחריגות: הכנסות 10\/2026: 12,100 ₪ \(\+10% מול החודש הקודם\); הוצאות: 7,000 ₪ \(\+13%\); הוצאות חריגות: 2 – ספק "אבי" \+70%, "חומרי גלם" \+60%$/);
    const f = base(); f.months['2026-10'].cats = [e('חומרי גלם', 1000)]; f.months['2026-10'].sups = [['אבי', 1000]]; f.months['2026-11'].cats = []; f.months['2026-11'].sups = [];
    assert.match(AN.anLine(AN.trends(f, {})), /אין הוצאות חריגות$/);
  });
});

describe('cleanFin + ideas – תאימות לאחור', () => {
  it('cleanFin שומר sups / supT לחודש, זורק שורות לא תקינות, ועד 40; מראה בלי השדה – בלי sups', () => {
    const raw = { v: 1, at: AT, months: { '2026-10': { inc: 1, exp: 2, own: 0, cats: [], sups: [['א', 5], ['ב', 'x'], 'zz', ['ג', -3]] }, '2026-09': { inc: 1, exp: 1, own: 0, cats: [] } } };
    const f = ST.cleanFin(raw);
    assert.deepEqual(f.months['2026-10'].sups, [['א', 5], ['ג', -3]]); assert.equal(f.months['2026-10'].supT, undefined);
    assert.equal('sups' in f.months['2026-09'], false);
    raw.months['2026-10'].sups = Array.from({ length: 50 }, (_, i) => ['s' + i, i + 1]);
    const g = ST.cleanFin(raw); assert.equal(g.months['2026-10'].sups.length, 40); assert.equal(g.months['2026-10'].supT, 1);
  });
  it('ideas() – אותה תוצאה כמו לפני (prevYear / pct ממודול החישוב המשותף)', () => {
    const f = ST.cleanFin({ v: 1, at: AT, months: { '2025-10': { inc: 1, exp: 1, own: 0, cats: [e('A', 1000)] }, '2026-10': { inc: 100, exp: 2000, own: 0, cats: [e('A', 1600)] } } });
    const L = ST.ideas(f, {}, AT);
    assert.deepEqual(L.map((x) => x.key), ['catUp:A:2026-10', 'loss:2026-10']);
    assert.equal(L[0].changePct, 60); assert.equal(L[1].loss, 1900);
    assert.equal(AN.prevYear('2026-01'), '2025-01'); assert.equal(AN.pct(130, 100), 30); assert.equal(AN.pct(5, 0), null); assert.equal(AN.pct(-50, -100), 50);
    assert.equal(AN.addMon('2026-01', -1), '2025-12'); assert.equal(AN.addMon('2026-12', 1), '2027-01');
  });
});

describe('הצעות הזמנה – ordSuggest', () => {
  const NOW = Date.parse('2026-12-01T07:30:00+02:00'), D = 864e5;
  const mv = (prod, delta, why, daysAgo) => ({ prod, delta, why, at: NOW - daysAgo * D });
  it('מלאי אמין + מכירות: מלאי לפחות מ-7 ימים → כמות ל-21 ימים פחות המלאי; מספיק – לא מוצע; לפי ספק', () => {
    const r = AN.ordSuggest({ now: NOW, prods: [{ id: 'p1', name: 'חלב', sup: 'תנובה', q: { _: 4 } }, { id: 'p2', name: 'לחם', sup: 'אנג\'ל', q: { a: 50, b: 10 } }, { id: 'p3', name: 'גבינה', sup: ' תנובה ', q: { _: 0 } }],
      moves: [mv('p1', -28, 'pos', 3), mv('p2', -14, 'cx', 2), mv('p3', -10, 'order', 5), mv('p3', 2, 'posret', 4)] });
    assert.equal(r.drafts.length, 1, 'לחם: 60 במלאי מול 0.5 ליום – מספיק');
    const g = r.drafts[0];
    assert.equal(g.sup, 'תנובה'); assert.deepEqual(g.lines.map((l) => [l.n, l.qty, l.m]), [['גבינה', 6, 's'], ['חלב', 17, 's']]); // גבינה: 8 נטו → 8/28*21=6; חלב: 1 ליום*21-4=17
    assert.match(g.lines[1].why, /נמכרו 28 ב-28 ימים; במלאי 4 \(מספיק לכ-4 ימים\)/);
  });
  it('מלאי לא אמין ("לא נספר" / בלי כמות) → לפי היסטוריית ההזמנות; בלי מספיק היסטוריה – לא מוצע (noData)', () => {
    const so = [{ pid: 'p1', sup: 'תנובה', qty: 10, st: 'done', at: NOW - 40 * D }, { pid: 'p1', sup: 'תנובה', qty: 14, st: 'done', at: NOW - 20 * D }, { pid: 'p1', qty: 6, st: 'done', at: NOW - 20 * D + 3600e3 }];
    const r = AN.ordSuggest({ now: NOW, prods: [{ id: 'p1', name: 'חלב', sup: 'תנובה', q: { _: 2 }, nc: true }, { id: 'p2', name: 'קמח', sup: 'תנובה' }], moves: [mv('p1', -30, 'pos', 1), mv('p2', -5, 'pos', 1)], so });
    assert.deepEqual(r.drafts[0].lines.map((l) => [l.pid, l.qty, l.m]), [['p1', 15, 'h']], 'שני ימי הזמנה (10, 14+6), כל 20 יום, האחרונה לפני 20 – ממוצע 15');
    assert.match(r.drafts[0].lines[0].why, /2 הזמנות, בממוצע כל 20 ימים.*המלאי לא אמין/);
    assert.equal(r.stat.noData, 1, 'קמח: מכירות בלי מלאי ובלי היסטוריה');
    const r2 = AN.ordSuggest({ now: NOW, prods: [{ id: 'p1', name: 'חלב', sup: 'תנובה', nc: true }], moves: [], so: so.map((x) => Object.assign({}, x, { at: x.at + 15 * D })) });
    assert.equal(r2.drafts.length, 0, 'עוד לא עבר המרווח הממוצע');
  });
  it('לא מציעים: כבר ב"להזמין מספקים" (פתוח / הוזמן), בלי ספק, לא זמין; אין נתונים בכלל – ריק', () => {
    const prods = [{ id: 'a', name: 'א', sup: 'ס', q: { _: 0 } }, { id: 'b', name: 'ב', q: { _: 0 } }, { id: 'c', name: 'ג', sup: 'ס', q: { _: 0 }, on: false }];
    const moves = ['a', 'b', 'c'].map((p) => mv(p, -10, 'pos', 1));
    const r = AN.ordSuggest({ now: NOW, prods, moves, so: [{ pid: 'a', st: 'open', qty: 3, at: NOW - D }] });
    assert.equal(r.drafts.length, 0); assert.deepEqual([r.stat.open, r.stat.noSup, r.stat.off], [1, 1, 1]);
    assert.deepEqual(AN.ordSuggest({ now: NOW, prods: [], moves: [], so: [] }).drafts, []);
  });
  it('תנועות מחוץ לחלון / לא מכירה לא נספרות; החזרות מקזזות; קיצוץ תנועות (movesFrom) – הקצב לפי התקופה שנקראה', () => {
    const p = [{ id: 'a', name: 'א', sup: 'ס', q: { _: 0 } }];
    assert.equal(AN.ordSuggest({ now: NOW, prods: p, moves: [mv('a', -50, 'pos', 40), mv('a', -50, 'in', 1), mv('a', -50, 'set', 1)] }).drafts.length, 0);
    assert.equal(AN.ordSuggest({ now: NOW, prods: p, moves: [mv('a', -5, 'pos', 1), mv('a', 5, 'cancel', 1)] }).drafts.length, 0, 'בוטל – 0 נטו');
    const r = AN.ordSuggest({ now: NOW, prods: p, moves: [mv('a', -7, 'pos', 1)], movesFrom: NOW - 7 * D });
    assert.equal(r.drafts[0].lines[0].qty, 21, '7 ב-7 ימים = 1 ליום → 21');
  });
  it('stockOf ו-supKey', () => {
    assert.equal(AN.stockOf({ a: 1.5, b: 2, c: 'x' }), 3.5); assert.equal(AN.stockOf({}), null); assert.equal(AN.stockOf(null), null); assert.equal(AN.stockOf([1]), null);
    assert.equal(AN.supKey('  Tnuva  '), 'tnuva');
  });
});
