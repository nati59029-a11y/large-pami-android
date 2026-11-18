'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/lib/plan.js');

const T0 = Date.parse('2026-11-18T01:02:00Z');
const run0 = (o) => P.newRun(Object.assign({ id: 'r1', now: T0, slot: '2026-11-18' }, o || {}));
// מריץ מכונה עם "שלבים" מדומים: fn(step, run) → info או זורק
function drive(run, fn, maxN) {
  let r = run, now = T0, seen = [];
  for (let i = 0; i < (maxN || 100) && r.st === 'run'; i++) {
    seen.push(r.step + (r.step === 'sales' ? ':' + r.days[r.day] : ''));
    try { const info = fn(r.step, r); r = P.advance(r, now, info); } catch (e) { r = P.fail(r, now, e); }
    now += 1000;
  }
  return { r, seen };
}

test('ריצה מלאה: כל השלבים לפי הסדר, יום מכירות אחרי יום', () => {
  const { r, seen } = drive(run0(), (s, run) => { if (s === 'hello') run.days = ['2026-11-16', '2026-11-17']; return { ok: 1 }; });
  assert.equal(r.st, 'ok');
  assert.deepEqual(seen, ['hello', 'login', 'catalog', 'catPreview', 'catApply', 'sales:2026-11-16', 'sales:2026-11-17', 'exportNew', 'exportPrice', 'report']);
  assert.ok(r.info.sales['2026-11-16']);
});

test('בלי ימים – מדלגים על מכירות; סנכרון ראשון ידני – מדלגים על קבצים לכספית', () => {
  const { r, seen } = drive(run0(), (s, run) => { if (s === 'catApply') run.flags.noCat = true; return {}; });
  assert.equal(r.st, 'ok');
  assert.deepEqual(seen, ['hello', 'login', 'catalog', 'catPreview', 'catApply', 'report']);
});

test('שגיאת רשת: ניסיון חוזר אחרי 1, 4, 15 דקות ואז נכשל', () => {
  let r = run0();
  r = P.advance(r, T0, {}); // hello → login
  const at = [];
  for (let i = 0; i < 3; i++) {
    r = P.fail(r, T0, P.err('network'));
    assert.equal(r.st, 'wait');
    at.push(r.retryAt - T0);
    assert.equal(P.canResume(r, r.retryAt - 1), false);
    assert.equal(P.canResume(r, r.retryAt), true);
    r = P.resumeFrom(r);
    assert.equal(r.step, 'login');
  }
  assert.deepEqual(at, [60e3, 240e3, 900e3]);
  r = P.fail(r, T0, P.err('server'));
  assert.equal(r.st, 'fail');
  assert.equal(r.err.code, 'server');
});

test('הצלחה מאפסת את מונה הניסיונות', () => {
  let r = P.fail(run0(), T0, P.err('timeout'));
  r = P.advance(P.resumeFrom(r), T0, {});
  assert.equal(r.attempt, 0);
  assert.equal(r.step, 'login');
});

test('צריך התחברות / כפתור לא נמצא / הרשאה / מגבלה – בלי ניסיון חוזר', () => {
  for (const [c, st] of [['needs-login', 'needs-login'], ['selector-miss', 'fail'], ['auth', 'fail'], ['limit', 'fail'], ['endpoint-changed', 'fail'], ['min-ver', 'fail']]) {
    const r = P.fail(run0(), T0, P.err(c));
    assert.equal(r.st, st, c);
    assert.equal(P.canResume(r, T0 + 3600e3), false);
    assert.ok(P.isTerminal(r));
  }
});

test('המשך אחרי שה-service worker נסגר באמצע שלב; ריצה ישנה (6 שעות) לא ממשיכה', () => {
  let r = run0();
  r = P.advance(r, T0, {});
  r = P.advance(r, T0, {});
  assert.equal(r.step, 'catalog');
  const saved = JSON.parse(JSON.stringify(r)); // מה שנשמר ב-storage
  assert.equal(P.canResume(saved, T0 + 60e3), true);
  assert.equal(P.resumeFrom(saved).step, 'catalog');
  assert.equal(P.canResume(saved, T0 + P.STALE_MS + 1), false);
});

test('המשך באמצע ימי המכירות – מאותו יום', () => {
  let r = run0();
  r.days = ['2026-11-15', '2026-11-16', '2026-11-17'];
  while (r.step !== 'sales') r = P.advance(r, T0, {});
  r = P.advance(r, T0, { n: 3 });
  assert.equal(r.days[r.day], '2026-11-16');
  r = P.fail(r, T0, P.err('network'));
  r = P.resumeFrom(r);
  assert.equal(r.step, 'sales');
  assert.equal(r.days[r.day], '2026-11-16');
});

test('יומן מוגבל באורכו, ו-advance/fail לא משנים את האובייקט המקורי', () => {
  const r = run0();
  const r2 = P.fail(r, T0, P.err('network'));
  assert.equal(r.st, 'run');
  assert.equal(r.log.length, 0);
  assert.equal(r2.log.length, 1);
  let x = r;
  for (let i = 0; i < 100; i++) x = P.resumeFrom(P.fail(x, T0, P.err('busy')));
  assert.ok(x.log.length <= 60);
});

test('הודעות בעברית לכל קוד', () => {
  for (const c of ['needs-login', 'selector-miss', 'limit', 'auth', 'network']) assert.match(P.msgOf(c), /[א-ת]/);
  assert.equal(P.msgOf('???'), P.MSG.fail);
});
