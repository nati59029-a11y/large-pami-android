'use strict';
// רכיבי שכר גמישים (שלב B, 19.11.2026) – בדיקות יחידה ל-validComp / compSum / autoBon והרחבת monthSum
// ב-app-source/www/payroll-core.js. נתונים סינתטיים בלבד. הרצה: node --test tests/payroll-comp.unit.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const PC = require(path.join(__dirname, '../../app-source/www/payroll-core.js'));

const MON = '2026-11';
const NOW = Date.UTC(2026, 10, 20, 12); // 20.11.2026 12:00
const H = 3600000;
const wh = (d, a, b, o) => Object.assign({ id: 'w' + d + a, sub: 'e1', d, in: a, out: b, brk: 0, src: 'man' }, o);
const emp = (comp, o) => ({ id: 'e1', pay: Object.assign({ mode: 'hr', rate: 40, comp }, o) });
const tk = (id, o) => Object.assign({ id, n: 'משימה ' + id, dl: NOW - 48 * H, st: 'done', late: '', sub: NOW - 50 * H }, o);
const cs = (comp, ctx) => PC.compSum(emp(comp), MON, Object.assign({ now: NOW }, ctx));
const one = (c, ctx) => { const r = cs([c], ctx); assert.equal(r.items.length, 1, JSON.stringify(r.warnings)); return r.items[0]; };

describe('validComp – אימות ונרמול', () => {
  it('כל הסוגים התקינים עוברים ומנורמלים (מחרוזות מספריות, מיון מדרגות, ברירת מחדל ss/on/n)', () => {
    let r = PC.validComp({ id: 'a', k: 'tk', m: 'all', a: '150' });
    assert.equal(r.ok, true); assert.deepEqual(r.comp, { id: 'a', k: 'tk', n: 'בונוס משימות בזמן', on: true, m: 'all', a: 150 });
    r = PC.validComp({ id: 'b', k: 'tk', m: 'tier', t: [{ p: 100, a: 300 }, { p: 80, a: 100 }] });
    assert.deepEqual(r.comp.t, [{ p: 80, a: 100 }, { p: 100, a: 300 }]);
    r = PC.validComp({ id: 'c', k: 'sl', t: [{ min: 50000, a: 200 }, { min: '30000', a: 100 }], on: false });
    assert.deepEqual(r.comp, { id: 'c', k: 'sl', n: 'בונוס מכירות', on: false, t: [{ min: 30000, a: 100 }, { min: 50000, a: 200 }], ss: 'day' });
    r = PC.validComp({ id: 'd', k: 'pc', p: 1.5, th: 20000, ss: 'hrs', src: 'אחוז וחצי מעל 20 אלף', ai: 1 });
    assert.deepEqual(r.comp, { id: 'd', k: 'pc', n: 'אחוז ממכירות', on: true, src: 'אחוז וחצי מעל 20 אלף', ai: 1, p: 1.5, th: 20000, ss: 'hrs' });
    r = PC.validComp({ id: 'e', k: 'man', n: 'בונוס חג' });
    assert.deepEqual(r.comp, { id: 'e', k: 'man', n: 'בונוס חג', on: true });
  });
  it('קלט פגום ← ok:false עם הודעה, בלי לזרוק', () => {
    const bads = [null, 5, [], {}, { id: 'x' }, { id: 'x', k: 'zz' }, { k: 'tk', m: 'all', a: 1 },
      { id: 'x', k: 'tk', m: 'all', a: -1 }, { id: 'x', k: 'tk', m: 'all' }, { id: 'x', k: 'tk', m: 'some', a: 1 },
      { id: 'x', k: 'tk', m: 'tier', t: [] }, { id: 'x', k: 'tk', m: 'tier', t: [{ p: 120, a: 1 }] },
      { id: 'x', k: 'tk', m: 'tier', t: [{ p: 50, a: 1 }, { p: 50, a: 2 }] },
      { id: 'x', k: 'sl', t: [{ min: 'abc', a: 1 }] }, { id: 'x', k: 'sl', t: [{ min: 10, a: 1 }], ss: 'week' },
      { id: 'x', k: 'pc', p: 0 }, { id: 'x', k: 'pc', p: 101 }, { id: 'x', k: 'pc', p: 2, th: -5 }];
    for (const b of bads) { const r = PC.validComp(b); assert.equal(r.ok, false, JSON.stringify(b)); assert.ok(r.err); assert.equal(r.comp, null); }
  });
  it('לא משנה את האובייקט המקורי', () => {
    const c = { id: 's', k: 'sl', t: [{ min: 2, a: 1 }, { min: 1, a: 1 }] }, j = JSON.stringify(c);
    PC.validComp(c); assert.equal(JSON.stringify(c), j);
  });
});

describe('compSum – בונוס משימות', () => {
  it('all: כל המשימות בזמן ← הבונוס; משימות בלי יעד (dl=0/חסר/-1) לא נספרות', () => {
    const tasks = [tk('1'), tk('2'), tk('3', { dl: 0, st: 'open' }), tk('4', { dl: undefined, st: 'open' }), tk('5', { dl: -1, late: '1' })];
    const it = one({ id: 'c1', k: 'tk', m: 'all', a: 150 }, { tasks });
    assert.equal(it.amt, 15000);
    assert.deepEqual([it.tk.on, it.tk.dec, it.tk.nod], [2, 2, 3]);
    assert.ok(it.det[0].includes('2 מתוך 2 משימות בזמן'));
  });
  it('all: משימה שאחרה ומשימה פתוחה אחרי היעד ← 0, עם hints בשמות', () => {
    const tasks = [tk('1'), tk('2', { late: '1', n: 'ספירת מלאי' }), tk('3', { st: 'open', sub: 0, n: 'ניקוי מחסן' })];
    const it = one({ id: 'c1', k: 'tk', m: 'all', a: 150 }, { tasks });
    assert.equal(it.amt, 0);
    assert.deepEqual([it.tk.on, it.tk.late, it.tk.lateOpen], [1, 1, 1]);
    const t = it.hints.map((h) => h.t).join('\n');
    assert.ok(t.includes('ספירת מלאי')); assert.ok(t.includes('ניקוי מחסן')); assert.ok(t.includes('2 באיחור'));
  });
  it('משימה פתוחה שהיעד עוד לא עבר – לא נספרת כאיחור (ממתינה); wait שהוגשה בזמן – ממתינה; wait שהוגשה אחרי היעד – באיחור', () => {
    const tasks = [tk('1'), tk('2', { st: 'open', dl: NOW + 5 * H, sub: 0 }),
      tk('3', { st: 'wait', dl: NOW - 10 * H, sub: NOW - 11 * H }), tk('4', { st: 'wait', dl: NOW - 10 * H, sub: NOW - 9 * H })];
    const it = one({ id: 'c1', k: 'tk', m: 'all', a: 100 }, { tasks });
    assert.deepEqual([it.tk.on, it.tk.pend, it.tk.late, it.tk.dec], [1, 2, 1, 2]);
    assert.equal(it.amt, 0);
  });
  it('all בלי משימות עם יעד ← 0, בלי לזרוק; משימות פגומות מדולגות', () => {
    const it = one({ id: 'c1', k: 'tk', m: 'all', a: 100 }, { tasks: [null, 'x', tk('1', { dl: 0 })] });
    assert.equal(it.amt, 0); assert.ok(it.det[0].includes('אין עדיין'));
    assert.equal(one({ id: 'c1', k: 'tk', m: 'all', a: 100 }, {}).amt, 0);
  });
  it('all: רק ממתינות ← 0 עם hint לסיים בזמן', () => {
    const it = one({ id: 'c1', k: 'tk', m: 'all', a: 100 }, { tasks: [tk('1', { st: 'open', dl: NOW + H, sub: 0 })] });
    assert.equal(it.amt, 0); assert.ok(it.hints.some((h) => h.t.includes('המשימות הפתוחות')));
  });
  const tier = { id: 't1', k: 'tk', m: 'tier', t: [{ p: 80, a: 100 }, { p: 90, a: 200 }, { p: 100, a: 300 }] };
  const mk = (on, late) => [...Array(on)].map((_, i) => tk('o' + i)).concat([...Array(late)].map((_, i) => tk('l' + i, { late: '1' })));
  it('tier: מתחת לראשונה ← 0 + hint כמה משימות חסרות', () => {
    const it = one(tier, { tasks: mk(7, 3) }); // 70%
    assert.equal(it.amt, 0);
    assert.ok(it.det.some((d) => d.includes('מתחת למדרגה הראשונה')));
    const h = it.hints.find((x) => x.need === 80);
    assert.equal(h.k, 5); // (7+5)/(10+5)=80%
    assert.equal(h.gapPct, 10); assert.equal(h.next, 10000);
  });
  it('tier: בדיוק על הסף ← המדרגה', () => {
    const it = one(tier, { tasks: mk(8, 2) }); // 80%
    assert.equal(it.amt, 10000);
    assert.ok(it.det.some((d) => d.includes('מדרגה 80% = 100')));
    assert.equal(it.hints.find((x) => x.need).need, 90);
  });
  it('tier: 100% ← המדרגה האחרונה, בלי hint למדרגה הבאה', () => {
    const it = one(tier, { tasks: mk(18, 0) });
    assert.equal(it.amt, 30000); assert.ok(it.det[0].includes('18 מתוך 18 משימות בזמן'));
    assert.equal(it.hints.length, 0);
  });
  it('tier: מדרגת 100% כשיש איחור ← hint "לא אפשרי החודש"', () => {
    const it = one(tier, { tasks: mk(19, 1) }); // 95%
    assert.equal(it.amt, 20000);
    assert.ok(it.hints.find((x) => x.need === 100).t.includes('לא אפשרי'));
  });
});

describe('compSum – מכירות', () => {
  const W = [wh('2026-11-01', '08:00', '16:00'), wh('2026-11-02', '08:00', '12:00'), wh('2026-10-31', '08:00', '16:00'), wh('2026-11-03', '08:00', '16:00', { sub: 'e2' })];
  const SALES = { '2026-11-01': 30000, '2026-11-02': 22300, '2026-11-03': 99999, '2026-10-31': 99999, '2026-11-05': 77777 };
  const sl = { id: 's1', k: 'sl', t: [{ min: 30000, a: 100 }, { min: 50000, a: 200 }, { min: 80000, a: 500 }] };
  it('ss:day – רק ימים שבהם לעובד יש שעות בחודש; מדרגה גבוהה שהושגה; פירוט ו-hint', () => {
    const it = one(sl, { wh: W, salesByDay: SALES });
    assert.equal(it.sales, 5230000); assert.equal(it.amt, 20000); assert.equal(it.est, undefined);
    assert.equal(it.det[0], 'מכירות 52,300 ← מדרגה 50,000 = 200');
    const h = it.hints[0];
    assert.equal(h.gap, 2770000); assert.equal(h.gapPct, 34.6); assert.equal(h.next, 50000);
    assert.ok(h.t.includes('חסרים 27,700'));
  });
  it('מתחת לראשונה / בדיוק על הסף / מעל האחרונה', () => {
    const W1 = [wh('2026-11-01', '08:00', '16:00')];
    let it = one(sl, { wh: W1, salesByDay: { '2026-11-01': 29999.99 } });
    assert.equal(it.amt, 0); assert.equal(it.hints[0].gap, 1);
    it = one(sl, { wh: W1, salesByDay: { '2026-11-01': 30000 } });
    assert.equal(it.amt, 10000);
    it = one(sl, { wh: W1, salesByDay: { '2026-11-01': 95000 } });
    assert.equal(it.amt, 50000); assert.equal(it.hints.length, 0);
  });
  it('pc בלי סף ועם סף (מתחת לסף, מעל הסף); אגורות שלמות', () => {
    const W1 = [wh('2026-11-01', '08:00', '16:00')];
    let it = one({ id: 'p', k: 'pc', p: 1.5 }, { wh: W1, salesByDay: { '2026-11-01': 12345.67 } });
    assert.equal(it.amt, 18519); // 1,234,567 × 1.5% = 18518.5 ← 18519
    assert.ok(Number.isInteger(it.amt));
    assert.ok(it.hints[0].t.includes('15'));
    it = one({ id: 'p', k: 'pc', p: 2, th: 20000 }, { wh: W1, salesByDay: { '2026-11-01': 15000 } });
    assert.equal(it.amt, 0); assert.equal(it.hints[0].gap, 500000); assert.equal(it.hints[0].gapPct, 25);
    it = one({ id: 'p', k: 'pc', p: 2, th: 20000 }, { wh: W1, salesByDay: { '2026-11-01': 25000 } });
    assert.equal(it.amt, 10000); assert.ok(it.det[0].includes('סף 20,000 = 5,000 × 2% = 100'));
  });
  it('ss:hrs – הערכה לפי שעות: יחס דקות, מוגבל ל-1, est:true', () => {
    const W2 = [wh('2026-11-01', '08:00', '12:00'), wh('2026-11-02', '06:00', '23:00')];
    const it = one({ id: 'p', k: 'pc', p: 10, ss: 'hrs' }, { wh: W2, salesByDay: { '2026-11-01': 10000, '2026-11-02': 5000 }, hoursOpenByDay: { '2026-11-01': 480, '2026-11-02': 600 } });
    assert.equal(it.est, true);
    assert.equal(it.sales, 1000000); // 10,000×240/480 + 5,000×1
    assert.equal(it.amt, 100000);
  });
  it('ss:hrs – חציית חצות: הדקות מתחלקות בין שני הימים; הפסקה מתחלקת יחסית', () => {
    const W3 = [wh('2026-11-01', '22:00', '02:00', { brk: 60 })]; // 120 דק' ברוטו בכל יום, נטו 90+90
    const it = one({ id: 'p', k: 'pc', p: 100, ss: 'hrs' }, { wh: W3, salesByDay: { '2026-11-01': 1000, '2026-11-02': 2000 }, hoursOpenByDay: { '2026-11-01': 900, '2026-11-02': 900 } });
    assert.equal(it.sales, 30000); // 1000×90/900 + 2000×90/900 = 100+200
  });
  it('ss:hrs – יום בלי שעות פעילות ← 0 לאותו יום + אזהרה; חסר יום מכירות ← אזהרה', () => {
    const W4 = [wh('2026-11-01', '08:00', '12:00'), wh('2026-11-02', '08:00', '12:00'), wh('2026-11-03', '08:00', '12:00')];
    const r = cs([{ id: 'p', k: 'pc', p: 100, ss: 'hrs' }], { wh: W4, salesByDay: { '2026-11-01': 1000, '2026-11-02': 1000 }, hoursOpenByDay: { '2026-11-01': 240 } });
    assert.equal(r.items[0].sales, 100000);
    assert.ok(r.warnings.some((w) => w.includes('אין שעות פעילות')));
    assert.ok(r.warnings.some((w) => w.includes('חסרים נתוני מכירות ל-1')));
  });
  it('בלי נתוני מכירות בכלל ← 0 + אזהרה, לא זורק', () => {
    const r = cs([sl, { id: 'p', k: 'pc', p: 2, ss: 'hrs' }], { wh: W });
    assert.deepEqual(r.items.map((x) => x.amt), [0, 0]);
    assert.ok(r.warnings.some((w) => w.includes('אין נתוני מכירות')));
    assert.doesNotThrow(() => PC.compSum(emp([sl]), MON, null));
    assert.doesNotThrow(() => PC.compSum(emp([sl]), MON, { wh: 'x', salesByDay: 5, hoursOpenByDay: 'y' }));
  });
});

describe('compSum – כללי', () => {
  it('man – בלי חישוב ולא בסכום; רכיב כבוי לא מופיע; רכיב פגום ← אזהרה ודילוג', () => {
    const r = cs([{ id: 'm', k: 'man', n: 'בונוס חג' }, { id: 'o', k: 'tk', m: 'all', a: 5, on: false }, { id: 'bad', k: 'pc', p: 500 }, 'junk', { id: 'a', k: 'tk', m: 'all', a: 10 }], { tasks: [tk('1')] });
    assert.deepEqual(r.items.map((x) => x.id), ['m', 'a']);
    assert.equal(r.items[0].man, true); assert.equal(r.items[0].amt, 0);
    assert.equal(r.sum, 1000);
    assert.ok(r.warnings.some((w) => w.includes('(bad)'))); assert.ok(r.warnings.some((w) => w.includes('(#4)')));
  });
  it('עובד בלי pay/comp או חודש לא תקין ← תוצאה ריקה', () => {
    assert.deepEqual(PC.compSum(null, MON, {}).items, []);
    assert.deepEqual(PC.compSum({ id: 'e1', pay: { mode: 'hr' } }, MON, {}).items, []);
    const r = PC.compSum(emp([{ id: 'a', k: 'man' }]), '2026-13', {});
    assert.deepEqual(r.items, []); assert.ok(r.warnings.length);
  });
  it('fmtAg – אלפים ואגורות', () => {
    assert.equal(PC.fmtAg(5230000), '52,300'); assert.equal(PC.fmtAg(123456789), '1,234,567.89'); assert.equal(PC.fmtAg(-5), '-0.05'); assert.equal(PC.fmtAg(0), '0');
  });
});

describe('monthSum – הרחבה (exp, comp, hints)', () => {
  const W = [wh('2026-11-01', '08:00', '16:00')];
  const COMP = [{ id: 'c1', k: 'tk', m: 'all', a: 150 }, { id: 's1', k: 'sl', t: [{ min: 1000, a: 50 }, { min: 9000, a: 99 }] }, { id: 'm', k: 'man' }];
  const D = { wh: W, tasks: [tk('1')], salesByDay: { '2026-11-01': 2000 }, now: NOW };
  it('בונוס צפוי ב-exp ולא ב-calc/due/left', () => {
    const plain = PC.monthSum({ id: 'e1', pay: { mode: 'hr', rate: 40 } }, MON, { wh: W });
    const m = PC.monthSum(emp(COMP), MON, D);
    assert.equal(m.exp, 15000 + 5000);
    for (const k of ['base', 'calc', 'due', 'left', 'bonus', 'paid']) assert.equal(m[k], plain[k], k);
    assert.equal(m.comp.length, 3);
    assert.ok(m.hints.some((h) => h.cid === 's1' && h.gap === 700000));
  });
  it('רכיב שאושר (bon src:auto, cid, mon) – נספר רק דרך bons ולא שוב ב-exp', () => {
    const bon = [{ id: 'b1', sub: 'e1', mon: MON, a: 120, n: 'משימות', src: 'auto', cid: 'c1' }, { id: 'b2', sub: 'e1', mon: '2026-10', a: 77, src: 'auto', cid: 's1' }];
    const m = PC.monthSum(emp(COMP), MON, Object.assign({ bon }, D));
    assert.equal(m.bonus, 12000); assert.equal(m.exp, 5000);
    const c1 = m.comp.find((x) => x.id === 'c1');
    assert.equal(c1.appr, true); assert.equal(c1.bonA, 12000);
    assert.ok(!m.hints.some((h) => h.cid === 'c1'));
    assert.equal(m.comp.find((x) => x.id === 's1').appr, undefined); // אישור של חודש אחר לא חל
  });
  it('עובד בלי comp – בדיוק אותם שדות כמו קודם; comp:[] – שדות ריקים', () => {
    const m = PC.monthSum({ id: 'e1', pay: { mode: 'hr', rate: 40 } }, MON, D);
    assert.deepEqual(Object.keys(m), ['sub', 'mon', 'mode', 'minutes', 'days', 'rows', 'base', 'adds', 'bonus', 'bons', 'calc', 'slip', 'due', 'paid', 'left', 'status', 'toAccountant', 'warnings']);
    const e = PC.monthSum(emp([]), MON, D);
    assert.deepEqual([e.comp, e.exp, e.hints], [[], 0, []]);
  });
  it('רכיב פגום ב-monthSum ← אזהרה, לא זורק', () => {
    const m = PC.monthSum(emp([{ id: 'x', k: 'pc', p: 'abc' }]), MON, { wh: W });
    assert.equal(m.exp, 0); assert.ok(m.warnings.some((w) => w.includes('(x)')));
  });
});

describe('autoBon – רשומות בונוס מוצעות', () => {
  const COMP = [{ id: 'c1', k: 'tk', m: 'all', a: 150 }, { id: 'p1', k: 'pc', p: 1.5, ss: 'hrs' }, { id: 'm', k: 'man' }];
  const D = { wh: [wh('2026-11-01', '08:00', '12:00')], tasks: [tk('1')], salesByDay: { '2026-11-01': 12345.67 }, hoursOpenByDay: { '2026-11-01': 240 }, now: NOW };
  it('רשומה לכל רכיב מחושב (לא man), a/calc בש"ח, det טקסט, est בהערכה', () => {
    const L = PC.autoBon(emp(COMP), MON, D);
    assert.equal(L.length, 2);
    assert.deepEqual(L[0], { sub: 'e1', mon: MON, a: 150, n: 'בונוס משימות בזמן', src: 'auto', cid: 'c1', calc: 150, det: '1 מתוך 1 משימות בזמן (100%) · כל המשימות בזמן = 150' });
    assert.equal(L[1].a, 185.19); assert.equal(L[1].est, true); assert.equal(PC.toAg(L[1].a), 18519);
  });
  it('רכיב שכבר אושר לא מוצע שוב; עובד בלי comp ← []', () => {
    const L = PC.autoBon(emp(COMP), MON, Object.assign({ bon: [{ sub: 'e1', mon: MON, a: 150, src: 'auto', cid: 'c1' }] }, D));
    assert.deepEqual(L.map((x) => x.cid), ['p1']);
    assert.deepEqual(PC.autoBon({ id: 'e1', pay: { mode: 'hr' } }, MON, D), []);
    assert.deepEqual(PC.autoBon(null, MON, D), []);
  });
});
