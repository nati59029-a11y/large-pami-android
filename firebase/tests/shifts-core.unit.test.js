'use strict';
// משמרות (שלב 3, 18.11.2026) – בדיקות יחידה לליבה הטהורה (functions/lib/shifts-core.js), בלי אמולטור:
// פריסת משמרות קבועות (from/to/skip), משמרת שחוצה חצות, מעבר לשעון קיץ/חורף, חורים בשעות הפעילות, חלון התזכורת, התראת 07:00,
// חלון השקט בשבת וחג (תזכורת שלא נעלמת), skip שלא נמחק, מופע מקביל, בדיקת קלט.
// הרצה: node --test tests/shifts-core.unit.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const SC = require('../functions/lib/shifts-core');
const TK = require('../functions/lib/tk-time');

const IL = (day, hm) => { const [y, m, d] = day.split('-').map(Number); return TK.zoned(y, m - 1, d, +hm.slice(0, 2), +hm.slice(3)); };
const H = 3600000;
// 18.11.2026 = יום רביעי (3). השבוע: 15.11 (ראשון) – 21.11 (שבת)
const WEEK = '2026-11-15';
const fixed = (id, o) => Object.assign({ id, u: 'u1', nm: 'דנה', fx: true, wd: 3, from: '2026-11-01', to: '', s: '08:00', e: '14:00', skip: [] }, o);
const one = (id, o) => Object.assign({ id, u: 'u2', nm: 'יוסי', fx: false, d: '2026-11-18', s: '14:00', e: '20:00' }, o);
const HRS = [{ s: '08:00', e: '20:00' }, { s: '08:00', e: '20:00' }, { s: '08:00', e: '20:00' }, { s: '08:00', e: '20:00' }, { s: '08:00', e: '20:00' }, { s: '08:00', e: '14:00' }, null];

describe('shifts-core – תאריכים ושעות', () => {
  it('addDays / weekdayOf / weekStart / isDay', () => {
    assert.equal(SC.addDays('2026-11-30', 1), '2026-12-01');
    assert.equal(SC.addDays('2026-01-01', -1), '2025-12-31');
    assert.equal(SC.weekdayOf('2026-11-18'), 3);
    assert.equal(SC.weekStart('2026-11-18'), WEEK);
    assert.equal(SC.weekStart(WEEK), WEEK);
    assert.equal(SC.isDay('2026-02-30'), false);
    assert.equal(SC.isDay('2026-2-3'), false);
    assert.equal(SC.isDay('2028-02-29'), true);
  });
  it('משמרת רגילה: 08:00–14:00 = 6 שעות, באותו יום, בשעון ישראל', () => {
    const t = SC.times('2026-11-18', '08:00', '14:00');
    assert.equal(t.x, false);
    assert.equal(t.start, IL('2026-11-18', '08:00'));
    assert.equal(t.end - t.start, 6 * H);
    assert.equal(SC.hmOf(t.start), '08:00');
  });
  it('משמרת שחוצה חצות: 20:00–02:00 מסתיימת למחרת (6 שעות)', () => {
    const t = SC.times('2026-11-18', '20:00', '02:00');
    assert.equal(t.x, true);
    assert.equal(t.end, IL('2026-11-19', '02:00'));
    assert.equal(t.end - t.start, 6 * H);
  });
  it('מעבר לשעון קיץ (26.3.2027) ולשעון חורף (25.10.2026): משמרת לילה 22:00–06:00 = 7 / 9 שעות', () => {
    const s = SC.times('2027-03-25', '22:00', '06:00'), w = SC.times('2026-10-24', '22:00', '06:00');
    assert.equal(s.end - s.start, 7 * H);
    assert.equal(w.end - w.start, 9 * H);
    assert.equal(SC.hmOf(s.end), '06:00');
    assert.equal(SC.hmOf(w.end), '06:00');
  });
});

describe('shifts-core – פריסה (משמרת קבועה וחד־פעמית)', () => {
  it('קבועה ביום רביעי מופיעה פעם בשבוע, בטווח from..to בלבד', () => {
    const d = fixed('A', { from: '2026-11-10', to: '2026-12-02' });
    const occ = SC.expand([d], '2026-11-01', 42).map((o) => o.day);
    assert.deepEqual(occ, ['2026-11-11', '2026-11-18', '2026-11-25', '2026-12-02']);
  });
  it('"רק הפעם": skip + חד־פעמית עם of – השבוע הזה שונה, השבוע הבא לא השתנה', () => {
    const base = fixed('A');
    const before = SC.expand([base], WEEK, 14);
    const after = SC.expand([fixed('A', { skip: ['2026-11-18'] }), one('B', { of: 'A', u: 'u1', nm: 'דנה', s: '10:00', e: '16:00' })], WEEK, 14);
    assert.deepEqual(after.map((o) => [o.id, o.s]), [['B_2026-11-18', '10:00'], ['A_2026-11-25', '08:00']]);
    assert.deepEqual(after[1], before[1], 'השבוע הבא זהה');
  });
  it('"מכאן והלאה": to = יום לפני + קבועה חדשה – השבועות הקודמים לא השתנו', () => {
    const before = SC.expand([fixed('A')], '2026-11-01', 28);
    const after = SC.expand([fixed('A', { to: '2026-11-24' }), fixed('C', { from: '2026-11-25', s: '09:00', e: '15:00' })], '2026-11-01', 28);
    assert.deepEqual(after.filter((o) => o.day < '2026-11-25'), before.filter((o) => o.day < '2026-11-25'));
    assert.deepEqual(after.filter((o) => o.day >= '2026-11-25').map((o) => o.id + ' ' + o.s), ['C_2026-11-25 09:00']);
  });
  it('מיון לפי שעת התחלה; מופע שייך ליום שבו הוא מתחיל (גם כשחוצה חצות)', () => {
    const occ = SC.expand([one('N', { d: '2026-11-18', s: '20:00', e: '02:00' }), fixed('A')], '2026-11-18', 2);
    assert.deepEqual(occ.map((o) => o.id), ['A_2026-11-18', 'N_2026-11-18']);
    assert.equal(occ[1].x, true);
  });
  it('occById / parseOcc: מופע קיים, מופע שדולג, מזהה לא תקין', () => {
    const defs = [fixed('A', { skip: ['2026-11-25'] })];
    assert.equal(SC.occById(defs, 'A_2026-11-18').start, IL('2026-11-18', '08:00'));
    assert.equal(SC.occById(defs, 'A_2026-11-25'), null);
    assert.equal(SC.occById(defs, 'A_2026-11-19'), null);
    assert.equal(SC.occById(defs, '../x_2026-11-18'), null);
    assert.equal(SC.parseOcc('A_B_2026-11-18').sid, 'A_B');
  });
  it('הגדרה פגומה (שעה שגויה / התחלה = סיום) – לא נפרסת', () => {
    assert.equal(SC.expand([one('X', { s: '25:00' }), one('Y', { s: '10:00', e: '10:00' })], '2026-11-18', 1).length, 0);
  });
});

describe('shifts-core – חורים בשעות הפעילות', () => {
  it('בלי משמרות – כל שעות הפעילות הן חור; שבת סגורה – אין חורים', () => {
    const h = SC.holes('2026-11-18', HRS, []);
    assert.equal(SC.holesTxt(h), '08:00–20:00');
    assert.deepEqual(SC.holes('2026-11-21', HRS, []), []);
  });
  it('08:00–12:00 + 14:00–18:00 → חורים 12:00–14:00 ו-18:00–20:00', () => {
    const occ = SC.expand([fixed('A', { e: '12:00' }), one('B', { s: '14:00', e: '18:00' })], '2026-11-18', 1);
    assert.equal(SC.holesTxt(SC.holes('2026-11-18', HRS, occ)), '12:00–14:00, 18:00–20:00');
  });
  it('משמרת פתוחה (בלי עובד) לא מכסה; חפיפה בין משמרות – בלי חור', () => {
    const occ = SC.expand([fixed('A', { u: '' }), one('B', { s: '07:00', e: '15:00' }), one('C', { s: '13:00', e: '21:00' })], '2026-11-18', 1);
    assert.deepEqual(SC.holes('2026-11-18', HRS, occ), []);
    const occ2 = SC.expand([fixed('A', { u: '', e: '20:00' })], '2026-11-18', 1);
    assert.equal(SC.holesTxt(SC.holes('2026-11-18', HRS, occ2)), '08:00–20:00');
  });
  it('משמרת לילה של אתמול (22:00–10:00) מכסה את הבוקר; שעות פעילות שחוצות חצות', () => {
    const occ = SC.expand([one('N', { d: '2026-11-17', s: '22:00', e: '10:00' })], '2026-11-17', 2);
    assert.equal(SC.holesTxt(SC.holes('2026-11-18', HRS, occ)), '10:00–20:00');
    const late = HRS.slice(); late[3] = { s: '18:00', e: '02:00' };
    const occ2 = SC.expand([one('B', { s: '18:00', e: '23:00' })], '2026-11-18', 1);
    assert.equal(SC.holesTxt(SC.holes('2026-11-18', late, occ2)), '23:00–02:00');
  });
});

describe('shifts-core – תזכורת והתראת הבוקר', () => {
  const oc = SC.expand([fixed('A')], '2026-11-18', 1)[0];
  it('תזכורת: מ-07:00 עד לפני 08:00 בלבד; משמרת בלי עובד – אף פעם', () => {
    assert.equal(SC.remDue(oc, IL('2026-11-18', '06:59')), false);
    assert.equal(SC.remDue(oc, IL('2026-11-18', '07:00')), true);
    assert.equal(SC.remDue(oc, IL('2026-11-18', '07:55')), true);
    assert.equal(SC.remDue(oc, IL('2026-11-18', '08:00')), false);
    assert.equal(SC.remDue(Object.assign({}, oc, { u: '' }), IL('2026-11-18', '07:30')), false);
  });
  it('תזכורת למשמרת שמתחילה אחרי חצות (00:30) – נשלחת ב-23:30 של היום הקודם', () => {
    const n = SC.expand([one('N', { d: '2026-11-19', s: '00:30', e: '06:00' })], '2026-11-19', 1)[0];
    assert.equal(SC.remDue(n, IL('2026-11-18', '23:35')), true);
  });
  it('התראת חורים: אחרי 07:00 ועד 10:00; בלי שעות פעילות – לא; שעה אחרת לפי ההגדרה', () => {
    const c = SC.cfgOf({ hrs: HRS });
    assert.equal(c.at, '07:00');
    assert.equal(c.late, 5);
    assert.equal(SC.holesDue(c, IL('2026-11-18', '06:55')).go, false);
    assert.equal(SC.holesDue(c, IL('2026-11-18', '07:05')).go, true);
    assert.equal(SC.holesDue(c, IL('2026-11-18', '10:05')).go, false);
    assert.equal(SC.holesDue(SC.cfgOf({}), IL('2026-11-18', '07:05')).go, false);
    assert.equal(SC.holesDue(SC.cfgOf({ hrs: HRS, at: '06:30' }), IL('2026-11-18', '06:35')).go, true);
  });
  it('חלון השקט: שישי 14:00 עד מוצאי שבת 21:00 (שעון ישראל)', () => {
    assert.equal(SC.quiet(IL('2026-11-20', '13:59')), false);
    assert.equal(SC.quiet(IL('2026-11-20', '14:00')), true);
    assert.equal(SC.quiet(IL('2026-11-21', '07:05')), true);
    assert.equal(SC.quiet(IL('2026-11-21', '20:59')), true);
    assert.equal(SC.quiet(IL('2026-11-21', '21:00')), false);
    assert.equal(SC.quiet(IL('2026-11-18', '07:05')), false);
    assert.deepEqual(SC.quietWin(IL('2026-11-21', '10:00')), [IL('2026-11-20', '14:00'), IL('2026-11-21', '21:00')]);
  });
  it('חג צמוד לשבת: חלון אחד רצוף (ראש השנה תשפ"ח, 2–3.10.2027 + שבת 2.10)', () => {
    const w = SC.quietWin(IL('2027-10-02', '12:00'));
    assert.equal(w[0], IL('2027-10-01', '14:00'));
    assert.equal(w[1], IL('2027-10-03', '21:00'));
  });
  it('תזכורת שנופלת בחלון לא נעלמת: שישי 15:00 – לפני 14:00; שבת בבוקר – שישי לפני 14:00; מוצאי שבת 21:30 – מ-21:00', () => {
    const at = (d, s) => SC.expand([one('X', { d, s, e: '06:00' })], d, 1)[0];
    const fri = at('2026-11-20', '15:00');
    assert.equal(SC.remDue(fri, IL('2026-11-20', '13:35')), true);
    assert.equal(SC.remDue(fri, IL('2026-11-20', '14:05')), false);
    const f2 = at('2026-11-20', '14:59'); // השעה שלפני מתחילה דקה לפני החלון – עדיין חצי שעה לשלוח
    assert.equal(SC.remDue(f2, IL('2026-11-20', '13:40')), true);
    const sat = at('2026-11-21', '10:00');
    assert.equal(SC.remDue(sat, IL('2026-11-20', '13:40')), true);
    assert.equal(SC.remDue(sat, IL('2026-11-21', '09:05')), false);
    const mo = at('2026-11-21', '21:30');
    assert.equal(SC.remDue(mo, IL('2026-11-21', '20:35')), false);
    assert.equal(SC.remDue(mo, IL('2026-11-21', '21:05')), true);
    const late = at('2026-11-21', '23:00');
    assert.equal(SC.remDue(late, IL('2026-11-21', '22:05')), true);
    assert.equal(SC.remDue(at('2026-11-20', '12:00'), IL('2026-11-20', '11:05')), true);
  });
});

describe('shifts-core – skip ומופע מקביל', () => {
  it('addSkip לא מוחק תאריכים ישנים; מגבלה רק על עתידיים; מעל 400 – רק מלפני שנה, ו-from עולה', () => {
    const r = SC.addSkip({ from: '2020-01-01', skip: ['2020-01-08', '2026-10-07'] }, '2026-11-25', '2026-11-18');
    assert.deepEqual(r, { skip: ['2020-01-08', '2026-10-07', '2026-11-25'], from: '2020-01-01' });
    const fut = Array.from({ length: 60 }, (_, i) => SC.addDays('2026-11-18', 7 * i));
    assert.equal(SC.addSkip({ from: '2026-01-01', skip: fut }, SC.addDays('2026-11-18', 7 * 60), '2026-11-18').err, true);
    const old = Array.from({ length: 401 }, (_, i) => SC.addDays('2010-01-06', 7 * i));
    const p = SC.addSkip({ from: '2010-01-06', skip: old }, '2026-11-25', '2026-11-18');
    assert.equal(p.from, '2025-11-17');
    assert.ok(p.skip.every((x) => x >= '2025-11-17') && p.skip.includes('2026-11-25'));
    // מופע שבוטל לפני הגבול לא חוזר: הוא לפני from
    assert.equal(SC.appliesOn({ id: 'A', fx: true, wd: 3, from: p.from, to: '', s: '08:00', e: '10:00', skip: p.skip }, '2015-01-07'), false);
  });
  it('sameWeek: המופע המקביל באותו שבוע (ראשון–שבת)', () => {
    assert.equal(SC.sameWeek('2026-11-18', 1), '2026-11-16');
    assert.equal(SC.sameWeek('2026-11-21', 0), '2026-11-15');
  });
  it('בעיה שהבודק מצא: "רק הפעם" ישן נשמר – בשבוע ההוא רק המחליפה', () => {
    const r1 = SC.addSkip({ from: '2026-09-02', skip: [] }, '2026-10-07', '2026-10-01');
    const r2 = SC.addSkip(Object.assign({ from: r1.from }, { skip: r1.skip }), '2026-11-25', '2026-11-18');
    const occ = SC.expand([fixed('A', { from: '2026-09-02', skip: r2.skip }), one('B', { d: '2026-10-07', of: 'A' })], '2026-10-04', 7);
    assert.deepEqual(occ.map((o) => o.id), ['B_2026-10-07']);
  });
});

describe('shifts-core – בדיקת קלט', () => {
  it('normDef: קבועה – wd ו-from מהתאריך; חד־פעמית – d; חציית חצות מותרת; שגיאות בעברית', () => {
    const f = SC.normDef({ u: 'u1', d: '2026-11-18', s: '20:00', e: '02:00', fx: true, nt: '  סגירה ' });
    assert.deepEqual(f.def, { u: 'u1', s: '20:00', e: '02:00', nt: 'סגירה', fx: true, wd: 3, from: '2026-11-18', to: '', skip: [] });
    assert.deepEqual(SC.normDef({ d: '2026-11-18', s: '08:00', e: '12:00', fx: false }).def, { u: '', s: '08:00', e: '12:00', nt: '', fx: false, d: '2026-11-18' });
    assert.equal(SC.normDef({ d: '2026-11-18', s: '08:00', e: '08:00', fx: false }).err.reason, 'bad-time');
    assert.equal(SC.normDef({ d: '2026-11-18', s: '8:00', e: '12:00', fx: false }).err.reason, 'bad-time');
    assert.equal(SC.normDef({ d: '2026-11-31', s: '08:00', e: '12:00', fx: false }).err.reason, 'bad-day');
    assert.equal(SC.normDef({ d: '2026-11-18', s: '08:00', e: '12:00' }).err.reason, 'bad-fx');
    assert.equal(SC.normDef({ d: '2026-11-18', s: '08:00', e: '12:00', fx: false, u: 'a/b' }).err.reason, 'bad-user');
  });
  it('normHrs: 7 ימים, null = סגור; שדה זר / שעה שגויה / 6 ימים – נדחה', () => {
    assert.deepEqual(SC.normHrs(HRS), HRS);
    assert.equal(SC.normHrs(HRS.slice(0, 6)), null);
    assert.equal(SC.normHrs(HRS.map((h, i) => (i === 0 ? { s: '08:00', e: '20:00', x: 1 } : h))), null);
    assert.equal(SC.normHrs(HRS.map((h, i) => (i === 0 ? { s: '08:00', e: '08:00' } : h))), null);
  });
  it('cfgOf: ערכים לא תקינים חוזרים לברירת המחדל', () => {
    assert.deepEqual(SC.cfgOf({ late: 99, at: '7:00', hrs: [1, 2] }), { late: 5, at: '07:00', hrs: null });
    assert.deepEqual(SC.cfgOf({ late: 0, at: '06:15' }), { late: 0, at: '06:15', hrs: null });
  });
});
