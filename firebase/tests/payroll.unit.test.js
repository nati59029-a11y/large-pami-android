'use strict';
// שכר ותלושים (שלב א', 18.11.2026) – בדיקות יחידה לחישוב הטהור app-source/www/payroll-core.js, בלי אמולטור:
// חציית חצות, שישי-לילה→שבת, חפיפת כללים, הפסקה, שכר חודשי, תוספת ליום/לחודש, בונוס, מקדמות, תשלום ביתר,
// תלוש גובר + הפרש, אגורות, חודש ריק, קלט פגום. נתונים סינתטיים בלבד.
// הרצה: node --test tests/payroll.unit.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const PC = require(path.join(__dirname, '../../app-source/www/payroll-core.js'));

// 18.11.2026 = רביעי (3); 20.11 = שישי (5); 21.11 = שבת (6)
const MON = '2026-11';
const emp = (pay, id) => ({ id: id || 'e1', name: 'עובד בדיקה', pay });
const wh = (d, a, b, o) => Object.assign({ id: 'w' + d + a, sub: 'e1', d, in: a, out: b, brk: 0, src: 'man' }, o);
const pmon = (t) => t.plan || (t.date || '').slice(0, 7);
const sum = (pay, data) => PC.monthSum(emp(pay), MON, Object.assign({ pmon }, data));

describe('payroll-core – משך שורת שעות', () => {
  it('משמרת רגילה 08:00–16:00 = 480 דקות', () => {
    const r = PC.shiftMin(wh('2026-11-18', '08:00', '16:00'));
    assert.equal(r.ok, true); assert.equal(r.min, 480); assert.equal(r.x, false);
  });
  it('חציית חצות: 22:00–02:00 = 240 דקות', () => {
    const r = PC.shiftMin(wh('2026-11-18', '22:00', '02:00'));
    assert.equal(r.x, true); assert.equal(r.min, 240);
  });
  it('הפסקה יורדת מהמשך', () => {
    assert.equal(PC.shiftMin(wh('2026-11-18', '08:00', '16:30', { brk: 30 })).min, 480);
    assert.equal(PC.shiftMin(wh('2026-11-18', '08:00', '16:30', { brk: '30' })).min, 480);
  });
  it('הפסקה ארוכה מהמשמרת ← 0 עם אזהרה, לא שלילי', () => {
    const r = PC.shiftMin(wh('2026-11-18', '08:00', '09:00', { brk: 90 }));
    assert.equal(r.min, 0); assert.ok(r.warnings.length);
  });
  it('הפסקה שלילית/טקסט ← לא מנוכה, עם אזהרה', () => {
    const r = PC.shiftMin(wh('2026-11-18', '08:00', '10:00', { brk: -5 }));
    assert.equal(r.min, 120); assert.ok(r.warnings.length);
    assert.equal(PC.shiftMin(wh('2026-11-18', '08:00', '10:00', { brk: 'abc' })).min, 120);
  });
  it('כניסה = יציאה ← 0 דקות עם אזהרה (טעות הזנה), לא 24 שעות', () => {
    const r = PC.shiftMin(wh('2026-11-18', '08:00', '08:00'));
    assert.equal(r.min, 0); assert.equal(r.x, false); assert.ok(r.warnings.length);
    const m = PC.monthSum({ id: 'e1', pay: { mode: 'hr', rate: 40 } }, '2026-11', { wh: [wh('2026-11-18', '08:00', '08:00')] });
    assert.equal(m.minutes, 0); assert.equal(m.days, 0); assert.equal(m.base, 0); assert.ok(m.warnings.length);
  });
  it('שעה או תאריך פגומים ← 0 בלי לזרוק', () => {
    for (const r of [wh('2026-11-18', '25:00', '10:00'), wh('2026-11-18', '8', '10:00'), wh('2026-02-30', '08:00', '10:00'), null, {}, wh('2026-11-18', '08:60', '10:00')]) {
      const x = PC.shiftMin(r);
      assert.equal(x.ok, false); assert.equal(x.min, 0); assert.ok(x.warnings.length);
    }
  });
});

describe('payroll-core – פיצול לפי תעריף', () => {
  it('בלי כללים – הכול בתעריף הבסיס', () => {
    const s = PC.splitMin(wh('2026-11-18', '08:00', '12:00'), { mode: 'hr', rate: 40 });
    assert.deepEqual(s.buckets, [{ rAg: 4000, min: 240 }]);
  });
  it('כלל ערב ברביעי 18:00–22:00: חלק בבסיס, חלק בתעריף הכלל', () => {
    const pay = { mode: 'hr', rate: 40, rules: [{ id: 'r1', d: [3], s: '18:00', e: '22:00', r: 50 }] };
    const s = PC.splitMin(wh('2026-11-18', '16:00', '20:00'), pay);
    assert.deepEqual(s.buckets, [{ rAg: 4000, min: 120 }, { rAg: 5000, min: 120 }]);
  });
  it('כלל לא חל ביום אחר בשבוע', () => {
    const pay = { mode: 'hr', rate: 40, rules: [{ id: 'r1', d: [3], s: '00:00', e: '24:00', r: 50 }] };
    assert.deepEqual(PC.splitMin(wh('2026-11-19', '08:00', '10:00'), pay).buckets, [{ rAg: 4000, min: 120 }]);
  });
  it('שישי-לילה ← שבת: הדקות אחרי חצות לפי יום שבת', () => {
    const pay = { mode: 'hr', rate: 40, rules: [{ id: 'sat', d: [6], s: '00:00', e: '24:00', r: 60 }] };
    const s = PC.splitMin(wh('2026-11-20', '22:00', '02:00'), pay);
    assert.deepEqual(s.buckets, [{ rAg: 4000, min: 120 }, { rAg: 6000, min: 120 }]);
  });
  it('כלל שחוצה חצות (e<=s): שישי 20:00–02:00 כולל את 00:00–02:00 של שבת', () => {
    const pay = { mode: 'hr', rate: 40, rules: [{ id: 'n', d: [5], s: '20:00', e: '02:00', r: 55 }] };
    const s = PC.splitMin(wh('2026-11-20', '19:00', '03:00'), pay);
    assert.deepEqual(s.buckets, [{ rAg: 4000, min: 120 }, { rAg: 5500, min: 360 }]);
    // החלק שאחרי חצות לא חל ביום רביעי← חמישי (הכלל מוגדר רק לשישי)
    assert.deepEqual(PC.splitMin(wh('2026-11-18', '23:00', '01:00'), pay).buckets, [{ rAg: 4000, min: 120 }]);
  });
  it('חפיפה בין כללים ← התעריף הגבוה', () => {
    const pay = { mode: 'hr', rate: 40, rules: [
      { id: 'a', d: [3], s: '16:00', e: '22:00', r: 50 },
      { id: 'b', d: [3], s: '18:00', e: '20:00', r: 70 },
      { id: 'c', d: [3], s: '19:00', e: '21:00', r: 45 },
    ] };
    const s = PC.splitMin(wh('2026-11-18', '16:00', '22:00'), pay);
    assert.deepEqual(s.buckets, [{ rAg: 5000, min: 240 }, { rAg: 7000, min: 120 }]);
  });
  it('כלל בתעריף נמוך מהבסיס עדיין חל (הכלל מחליף את הבסיס)', () => {
    const pay = { mode: 'hr', rate: 40, rules: [{ id: 'a', d: [3], s: '08:00', e: '10:00', r: 30 }] };
    assert.deepEqual(PC.splitMin(wh('2026-11-18', '08:00', '10:00'), pay).buckets, [{ rAg: 3000, min: 120 }]);
  });
  it('הפסקה מנוכה מהתעריף הנמוך קודם', () => {
    const pay = { mode: 'hr', rate: 40, rules: [{ id: 'a', d: [3], s: '18:00', e: '22:00', r: 50 }] };
    const s = PC.splitMin(wh('2026-11-18', '16:00', '20:00', { brk: 150 }), pay);
    assert.deepEqual(s.buckets, [{ rAg: 5000, min: 90 }]);
    assert.equal(s.min, 90);
  });
  it('כלל פגום מדולג עם אזהרה, השאר עובד', () => {
    const pay = { mode: 'hr', rate: 40, rules: [{ id: 'bad', d: [3], s: 'x', e: '22:00', r: 50 }, { id: 'neg', d: [3], s: '08:00', e: '22:00', r: -1 }, { id: 'nod', d: [], s: '08:00', e: '22:00', r: 90 }, null] };
    const s = PC.splitMin(wh('2026-11-18', '08:00', '09:00'), pay);
    assert.deepEqual(s.buckets, [{ rAg: 4000, min: 60 }]);
    assert.equal(s.warnings.length, 4);
  });
});

describe('payroll-core – סיכום חודש', () => {
  it('עובד בלי pay ← null', () => {
    assert.equal(PC.monthSum({ id: 'e1' }, MON, {}), null);
    assert.equal(PC.monthSum(null, MON, {}), null);
    assert.equal(PC.monthSum({ id: 'e1', pay: null }, MON, {}), null);
  });
  it('חודש ריק: הכול 0, סטטוס סגור, בלי שגיאה', () => {
    const r = sum({ mode: 'hr', rate: 40 }, {});
    assert.equal(r.minutes, 0); assert.equal(r.days, 0); assert.equal(r.base, 0); assert.equal(r.due, 0);
    assert.equal(r.paid, 0); assert.equal(r.left, 0); assert.equal(r.status, 'closed'); assert.equal(r.slip, null);
  });
  it('לפי שעה: רק שורות העובד והחודש נספרות', () => {
    const W = [wh('2026-11-18', '08:00', '16:00'), wh('2026-11-19', '08:00', '12:00'), wh('2026-10-31', '08:00', '16:00'), wh('2026-11-18', '08:00', '16:00', { sub: 'e2' })];
    const r = sum({ mode: 'hr', rate: 40 }, { wh: W });
    assert.equal(r.minutes, 720); assert.equal(r.days, 2); assert.equal(r.base, 48000); assert.equal(r.calc, 48000); assert.equal(r.due, 48000);
  });
  it('משמרת שחוצה חצות ב-31 לחודש שייכת לחודש שבו התחילה', () => {
    const r = sum({ mode: 'hr', rate: 40 }, { wh: [wh('2026-11-30', '22:00', '02:00')] });
    assert.equal(r.minutes, 240); assert.equal(r.base, 16000);
    const d = PC.monthSum(emp({ mode: 'hr', rate: 40 }), '2026-12', { wh: [wh('2026-11-30', '22:00', '02:00')] });
    assert.equal(d.minutes, 0);
  });
  it('אגורות: עיגול פעם אחת בסוף (7 × 10 דקות × 33.33 ₪ = 38.89 ₪)', () => {
    const W = [1, 2, 3, 4, 5, 6, 7].map((i) => wh('2026-11-0' + i, '08:00', '08:10'));
    const r = sum({ mode: 'hr', rate: 33.33 }, { wh: W });
    // 70 × 3333 / 60 = 3888.5 ← 3889. עיגול לכל שורה היה נותן 7 × 556 = 3892
    assert.equal(r.base, 3889);
    assert.ok(Number.isInteger(r.base) && Number.isInteger(r.due));
  });
  it('תעריף 0.1+0.2 ושבר אגורה לא יוצר רעש', () => {
    assert.equal(PC.toAg(0.1 + 0.2), 30);
    assert.equal(PC.toAg(1.005), 101);
    assert.equal(PC.toAg(-1.005), -101);
    assert.equal(PC.toAg('12.5'), 1250);
    assert.equal(PC.toAg('abc'), 0);
  });
  it('שכר חודשי: הבסיס קבוע, השעות רק לדיווח', () => {
    const r = sum({ mode: 'mo', mo: 9000, rate: 40, rules: [{ id: 'a', d: [3], s: '00:00', e: '24:00', r: 99 }] }, { wh: [wh('2026-11-18', '08:00', '16:00')] });
    assert.equal(r.mode, 'mo'); assert.equal(r.base, 900000); assert.equal(r.minutes, 480); assert.equal(r.days, 1); assert.equal(r.due, 900000);
  });
  it('שכר חודשי חסר ← 0 עם אזהרה', () => {
    const r = sum({ mode: 'mo' }, {});
    assert.equal(r.base, 0); assert.ok(r.warnings.length);
  });
  it('תוספת חודשית פעם בחודש, תוספת יומית × ימי עבודה (שתי משמרות באותו יום = יום אחד)', () => {
    const W = [wh('2026-11-18', '08:00', '12:00'), wh('2026-11-18', '14:00', '16:00'), wh('2026-11-19', '08:00', '10:00')];
    const r = sum({ mode: 'hr', rate: 40, add: [{ id: 'car', n: 'רכב', k: 'mo', a: 500 }, { id: 'food', n: 'אוכל', k: 'day', a: 25.5 }] }, { wh: W });
    assert.equal(r.days, 2);
    assert.deepEqual(r.adds.map((a) => [a.id, a.per, a.cnt, a.amt]), [['car', 50000, 1, 50000], ['food', 2550, 2, 5100]]);
    assert.equal(r.base, 32000); assert.equal(r.calc, 32000 + 50000 + 5100);
  });
  it('תוספת פגומה מדולגת עם אזהרה', () => {
    const r = sum({ mode: 'hr', rate: 40, add: [{ id: 'x', k: 'week', a: 10 }, { id: 'y', k: 'mo', a: 'abc' }, null] }, {});
    assert.equal(r.adds.length, 0); assert.equal(r.warnings.length, 3);
  });
  it('בונוס לעובד במזומן נכנס לחישוב, רק של החודש והעובד', () => {
    const B = [{ id: 'b1', sub: 'e1', mon: MON, a: 200, n: 'יעד' }, { id: 'b2', sub: 'e1', mon: MON, a: 50.25 }, { id: 'b3', sub: 'e1', mon: '2026-10', a: 999 }, { id: 'b4', sub: 'e2', mon: MON, a: 999 }];
    const r = sum({ mode: 'mo', mo: 1000 }, { bon: B });
    assert.equal(r.bonus, 25025); assert.equal(r.calc, 125025); assert.deepEqual(r.toAccountant, []);
  });
  it('מקדמות: כל תשלום מוריד מ"נשאר"; נסגר כשהושלם', () => {
    const pay = { mode: 'mo', mo: 5000 };
    const t1 = { id: 't1', t: 'exp', sub: 'e1', amt: 2000, date: '2026-11-10', plan: MON, pays: [] };
    const t2 = { id: 't2', t: 'exp', sub: 'e1', amt: 3000, date: '2026-12-01', plan: MON, pays: [] };
    let r = sum(pay, { tx: [t1] });
    assert.equal(r.paid, 200000); assert.equal(r.left, 300000); assert.equal(r.status, 'open');
    r = sum(pay, { tx: [t1, t2] });
    assert.equal(r.paid, 500000); assert.equal(r.left, 0); assert.equal(r.status, 'closed');
  });
  it('תשלום ביתר ← over ויתרה שלילית', () => {
    const r = sum({ mode: 'mo', mo: 1000 }, { tx: [{ id: 't', sub: 'e1', amt: 1000.01, plan: MON }] });
    assert.equal(r.left, -1); assert.equal(r.status, 'over');
  });
  it('שולם: בלי מבוטלות (x), בלי עלויות מעביד (ec), בלי עובד/חודש אחר; plan גובר על תאריך', () => {
    const T = [
      { id: 'a', sub: 'e1', amt: 100, date: '2026-11-05' },
      { id: 'b', sub: 'e1', amt: 100, plan: MON, x: 1 },
      { id: 'c', sub: 'e1', amt: 100, plan: MON, ec: 1, pays: [] },
      { id: 'd', sub: 'e2', amt: 100, plan: MON },
      { id: 'e', sub: 'e1', amt: 100, date: '2026-11-05', plan: '2026-10' },
      { id: 'f', sub: 'e1', amt: 100, date: '2026-12-02', plan: MON },
      null,
      { id: 'g', sub: 'e1', amt: 'abc', plan: MON },
    ];
    const r = sum({ mode: 'mo', mo: 1000 }, { tx: T });
    assert.equal(r.paid, 20000); assert.ok(r.warnings.some((w) => w.includes('g')));
  });
  it('פונקציית החודש מתקבלת כקלט (ולא מגלובלים)', () => {
    const r = PC.monthSum(emp({ mode: 'mo', mo: 100 }), MON, { tx: [{ id: 'a', sub: 'e1', amt: 100, zz: MON }], pmon: (t) => t.zz });
    assert.equal(r.paid, 10000); assert.equal(r.status, 'closed');
    const bad = PC.monthSum(emp({ mode: 'mo', mo: 100 }), MON, { tx: [{ id: 'a', sub: 'e1', amt: 100 }], pmon: () => { throw new Error('x'); } });
    assert.equal(bad.paid, 0);
  });
  it('עובד בתלוש עם תלוש מאושר: due=נטו, diff=חישוב−נטו, הבונוס לרואה החשבון ולא בחישוב', () => {
    const pay = { mode: 'hr', rate: 50, slip: 1 };
    const r = sum(pay, {
      wh: [wh('2026-11-18', '08:00', '16:00')],
      bon: [{ id: 'b1', sub: 'e1', mon: MON, a: 300, n: 'חג' }],
      psl: [{ id: 'p1', sub: 'e1', mon: MON, net: 350.5, gross: 420, ok: true, at: 1 }],
    });
    assert.equal(r.base, 40000); assert.equal(r.bonus, 30000); assert.equal(r.calc, 40000);
    assert.deepEqual(r.slip, { id: 'p1', net: 35050, diff: 4950 });
    assert.equal(r.due, 35050);
    assert.deepEqual(r.toAccountant, [{ k: 'bon', id: 'b1', n: 'חג', a: 30000 }]);
  });
  it('עובד בתלוש: העברה סוגרת לפי נטו התלוש', () => {
    const r = sum({ mode: 'mo', mo: 6000, slip: 1 }, { psl: [{ id: 'p1', sub: 'e1', mon: MON, net: 5123.45, ok: 1 }], tx: [{ id: 't', sub: 'e1', amt: 5123.45, plan: MON }] });
    assert.equal(r.due, 512345); assert.equal(r.status, 'closed'); assert.equal(r.slip.diff, 600000 - 512345);
  });
  it('עובד בתלוש בלי תלוש מאושר: slip=null, due=חישוב (בלי בונוס)', () => {
    const r = sum({ mode: 'mo', mo: 6000, slip: 1 }, {
      bon: [{ id: 'b1', sub: 'e1', mon: MON, a: 100 }],
      psl: [{ id: 'p1', sub: 'e1', mon: MON, net: 1, ok: false }, { id: 'p2', sub: 'e1', mon: '2026-10', net: 1, ok: true }],
    });
    assert.equal(r.slip, null); assert.equal(r.due, 600000); assert.equal(r.toAccountant.length, 1);
  });
  it('תלוש לעובד שאינו בתלוש – לא משפיע', () => {
    const r = sum({ mode: 'mo', mo: 6000 }, { psl: [{ id: 'p1', sub: 'e1', mon: MON, net: 1, ok: true }] });
    assert.equal(r.slip, null); assert.equal(r.due, 600000);
  });
  it('כמה תלושים מאושרים לחודש ← האחרון, עם אזהרה', () => {
    const r = sum({ mode: 'mo', mo: 100, slip: 1 }, { psl: [
      { id: 'new', sub: 'e1', mon: MON, net: 90, ok: true, at: '2026-12-02T10:00:00Z' },
      { id: 'old', sub: 'e1', mon: MON, net: 80, ok: true, at: '2026-12-01T10:00:00Z' },
    ] });
    assert.equal(r.slip.id, 'new'); assert.equal(r.due, 9000); assert.ok(r.warnings.length);
  });
  it('תעריף שעתי חסר ← 0 עם אזהרה אחת (גם בכמה שורות)', () => {
    const r = sum({ mode: 'hr' }, { wh: [wh('2026-11-18', '08:00', '10:00'), wh('2026-11-19', '08:00', '10:00')] });
    assert.equal(r.base, 0); assert.equal(r.minutes, 240);
    assert.equal(r.warnings.filter((w) => w.includes('תעריף')).length, 1);
  });
  it('קלט פגום כללי (data חסר, מערכים לא מערכים, חודש לא תקין) – לא זורק', () => {
    assert.doesNotThrow(() => PC.monthSum(emp({ mode: 'hr', rate: 40 }), MON));
    const r = PC.monthSum(emp({ mode: 'zz', rate: 40 }), '2026-13', { wh: 'x', bon: {}, psl: 5, tx: null });
    assert.equal(r.due, 0); assert.equal(r.mode, 'hr'); assert.ok(r.warnings.length >= 2);
  });
  it('בונוס שלילי (קיזוז) יורד מהחישוב', () => {
    const r = sum({ mode: 'mo', mo: 1000 }, { bon: [{ id: 'b', sub: 'e1', mon: MON, a: -100 }] });
    assert.equal(r.bonus, -10000); assert.equal(r.due, 90000);
  });
  it('תרחיש מלא: שעות בשישי-לילה + חפיפה + הפסקה + תוספות + בונוס + מקדמה', () => {
    const pay = { mode: 'hr', rate: 40, rules: [{ id: 'sat', d: [6], s: '00:00', e: '24:00', r: 60 }, { id: 'eve', d: [5], s: '20:00', e: '23:00', r: 50 }],
      add: [{ id: 'd', n: 'נסיעות', k: 'day', a: 10 }] };
    const r = sum(pay, {
      wh: [wh('2026-11-20', '18:00', '02:00', { brk: 30 }), wh('2026-11-18', '08:00', '12:00')],
      bon: [{ id: 'b', sub: 'e1', mon: MON, a: 100 }],
      tx: [{ id: 't', sub: 'e1', amt: 500, plan: MON }],
    });
    // שישי: 18–20 בסיס (120, פחות 30 הפסקה = 90) · 20–23 ‏50 ₪ (180) · 23–24 בסיס (60) · 00–02 שבת 60 ₪ (120)
    // בסיס: (90+60)×4000 + 180×5000 + 120×6000 = 600000+900000+720000 = 2,220,000 ÷ 60 = 37000; רביעי 240×4000/60 = 16000
    assert.equal(r.minutes, 450 + 240); assert.equal(r.base, 53000);
    assert.equal(r.calc, 53000 + 2000 + 10000); assert.equal(r.paid, 50000); assert.equal(r.left, 15000); assert.equal(r.status, 'open');
  });
});
