'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/lib/days.js');

const TZ = 'Asia/Jerusalem';
// זמן מקומי בירושלים → ms (UTC)
const J = (s) => { const [d, t] = s.split(' '); return D.zonedToUtc(d, t, TZ); };

test('isDue: 02:59 לא, 03:01 כן (הריצה האחרונה אתמול)', () => {
  assert.equal(D.isDue(J('2026-11-18 02:59'), '03:00', '2026-11-17', TZ), false);
  assert.equal(D.isDue(J('2026-11-18 03:00'), '03:00', '2026-11-17', TZ), true);
  assert.equal(D.isDue(J('2026-11-18 03:01'), '03:00', '2026-11-17', TZ), true);
});

test('isDue: מחשב שהתעורר ב-08:30 – רץ; אחרי הצלחה לא רץ שוב (טריגר כפול)', () => {
  const now = J('2026-11-18 08:30');
  assert.equal(D.isDue(now, '03:00', '2026-11-17', TZ), true);
  const slot = D.slotDay(now, '03:00', TZ);
  assert.equal(slot, '2026-11-18');
  assert.equal(D.isDue(now + 60e3, '03:00', slot, TZ), false);
  assert.equal(D.isDue(J('2026-11-18 23:59'), '03:00', slot, TZ), false);
  assert.equal(D.isDue(J('2026-11-19 03:00'), '03:00', slot, TZ), true);
});

test('isDue: 3 ימים כבוי – רץ, ומביא את כל הימים החסרים עד אתמול', () => {
  const now = J('2026-11-18 10:00');
  assert.equal(D.isDue(now, '03:00', '2026-11-14', TZ), true);
  assert.deepEqual(D.daysToFetch('2026-11-14', D.dayStr(now, TZ)), ['2026-11-15', '2026-11-16', '2026-11-17']);
});

test('isDue: בלי ריצה קודמת – רץ; לפני 03:00 עם ריצה של שלשום – רץ (השלמה)', () => {
  assert.equal(D.isDue(J('2026-11-18 01:00'), '03:00', null, TZ), true);
  assert.equal(D.isDue(J('2026-11-18 01:00'), '03:00', '2026-11-16', TZ), true);
  assert.equal(D.isDue(J('2026-11-18 01:00'), '03:00', '2026-11-17', TZ), false);
});

test('שעון קיץ/חורף: 03:00 המקומית נשמרת', () => {
  // כניסה לשעון קיץ: 27.3.2026 02:00 → 03:00 (UTC+3 אחרי)
  const a = D.nextAt(J('2026-03-26 12:00'), '03:00', TZ);
  assert.equal(new Date(a).toISOString(), '2026-03-27T00:00:00.000Z');
  assert.equal(D.parts(a, TZ).h, 3);
  // יציאה משעון קיץ: 25.10.2026 02:00 → 01:00 (UTC+2 אחרי)
  const b = D.nextAt(J('2026-10-24 12:00'), '03:00', TZ);
  assert.equal(new Date(b).toISOString(), '2026-10-25T01:00:00.000Z');
  // isDue ביום המעבר
  assert.equal(D.isDue(Date.parse('2026-10-25T00:59:00Z'), '03:00', '2026-10-24', TZ), false); // 02:59 מקומי
  assert.equal(D.isDue(Date.parse('2026-10-25T01:01:00Z'), '03:00', '2026-10-24', TZ), true); // 03:01 מקומי
  assert.equal(D.isDue(Date.parse('2026-03-27T00:01:00Z'), '03:00', '2026-03-26', TZ), true); // 03:01 מקומי, אחרי הקפיצה
});

test('nextAt: בדיוק ב-03:00 → מחר; ב-02:00 → היום', () => {
  assert.equal(D.nextAt(J('2026-11-18 03:00'), '03:00', TZ), J('2026-11-19 03:00'));
  assert.equal(D.nextAt(J('2026-11-18 02:00'), '03:00', TZ), J('2026-11-18 03:00'));
});

test('מחשב שמכוון לאזור זמן אחר – אותן תוצאות', () => {
  const old = process.env.TZ;
  const now = J('2026-11-18 03:01');
  const base = [D.isDue(now, '03:00', '2026-11-17', TZ), D.nextAt(now, '03:00', TZ), D.slotDay(J('2026-11-18 02:59'), '03:00', TZ)];
  for (const tz of ['America/New_York', 'Pacific/Kiritimati', 'UTC']) {
    process.env.TZ = tz;
    assert.deepEqual([D.isDue(now, '03:00', '2026-11-17', TZ), D.nextAt(now, '03:00', TZ), D.slotDay(J('2026-11-18 02:59'), '03:00', TZ)], base, tz);
  }
  if (old === undefined) delete process.env.TZ; else process.env.TZ = old;
  assert.equal(base[2], '2026-11-17');
});

test('daysToFetch: לא יותר מ-14 ימים, אף פעם לא היום', () => {
  const d = D.daysToFetch('2026-10-01', '2026-11-18');
  assert.equal(d.length, 14);
  assert.equal(d[0], '2026-11-04');
  assert.equal(d[d.length - 1], '2026-11-17');
  assert.deepEqual(D.daysToFetch(null, '2026-11-18'), ['2026-11-17']);
  assert.deepEqual(D.daysToFetch('2026-11-17', '2026-11-18'), []);
  assert.deepEqual(D.daysToFetch('2026-11-18', '2026-11-18'), []);
  assert.deepEqual(D.daysToFetch('2026-02-27', '2026-03-02'), ['2026-02-28', '2026-03-01']);
});

test('safeDays: מסנן את היום, עתיד, תאריך לא תקין, כפולים, ויותר מ-14 אחורה', () => {
  const r = D.safeDays(['2026-11-17', '2026-11-18', '2026-11-19', '2026-11-16', '2026-11-16', '2026-02-30', 'x', 5, '2026-10-01'], '2026-11-18');
  assert.deepEqual(r, ['2026-11-16', '2026-11-17']);
  assert.deepEqual(D.safeDays(null, '2026-11-18'), []);
});

test('שעה לא תקינה → ברירת מחדל 03:00', () => {
  assert.equal(D.isDue(J('2026-11-18 02:59'), 'bad', '2026-11-17', TZ), false);
  assert.equal(D.isDue(J('2026-11-18 03:00'), '25:99', '2026-11-17', TZ), true);
});
