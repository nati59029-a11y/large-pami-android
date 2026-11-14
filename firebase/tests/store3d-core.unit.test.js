'use strict';
// סריקת חנות בתלת מימד – שלב 5 (14.11.2026): בדיקות יחידה בלי אמולטור ל-functions/lib/store3d-core.js
//   מועד הבא (שבוע/חודש/כל X ימים/ידני, שעון ישראל, מעבר שעון), מזהה קבוע בלי כפילויות, חלוקה לעובדים, מחליף,
//   עובד מושבת = שגיאה, יומן זמנים, סיום/תזכורת/איחור, העברה/לקיחה, ומה עובד רואה (s3View).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const FN = path.join(__dirname, '..', 'functions');
const C = require(path.join(FN, 'lib', 'store3d-core.js'));
const TK = require(path.join(FN, 'lib', 'tk-time.js'));
const at = (y, m, d, hh, mm) => TK.zoned(y, m - 1, d, hh || 0, mm || 0);
const D1 = 86400000;
const RID = 'r8k2m4q1';
const U1 = 'emp_one1', U2 = 'emp_two2', U3 = 'emp_three', SUB = 'sub_user1';

const fx = (id, o) => Object.assign({ id, k: 'gon', x: 100, y: 100, w: 200, d: 60, h: 180, a: 0, sides: 1, bays: 2, lvl: 5, hi: false, room: 'r1', num: 1 }, o);
const MAP = { br: 'main', kind: 's', name: 'חנות', v: 3, seq: 9, rooms: [{ id: 'r1' }, { id: 'r2' }],
  fx: [fx('f1', { sides: 2, bays: 3 }), fx('f2', { hi: true }), fx('f3', { room: 'r2', bays: 4 }), fx('f4', { del: 1, delAt: 1, delBy: 'x' })] };

describe('store3d: מועד הבא ומזהה קבוע', () => {
  it('שבוע ביום קבוע: ראשון 06:00 שעון ישראל, אחרי העריכה; אחרי פתיחה – השבוע הבא', () => {
    assert.equal(C.nextOpen({ f: { k: 'week', dow: 0 }, upd: at(2026, 11, 14, 10) }), at(2026, 11, 15, 6));
    assert.equal(C.nextOpen({ f: { k: 'week', dow: 0 }, upd: at(2026, 11, 15, 5, 59) }), at(2026, 11, 15, 6), 'נשמר לפני 06:00 – היום');
    assert.equal(C.nextOpen({ f: { k: 'week', dow: 0 }, upd: at(2026, 11, 15, 6, 1) }), at(2026, 11, 22, 6), 'נשמר אחרי 06:00 – שבוע הבא');
    assert.equal(C.nextOpen({ f: { k: 'week', dow: 0 }, upd: at(2026, 11, 1, 9), last: at(2026, 11, 15, 6, 3) }), at(2026, 11, 22, 6));
    assert.equal(C.nextOpen({ f: { k: 'week', dow: 6 }, upd: at(2026, 11, 14, 10) }), at(2026, 11, 21, 6), 'שבת');
  });
  it('חודש ביום קבוע (1–28), כולל מעבר שנה', () => {
    assert.equal(C.nextOpen({ f: { k: 'month', dom: 1 }, upd: at(2026, 11, 14, 10) }), at(2026, 12, 1, 6));
    assert.equal(C.nextOpen({ f: { k: 'month', dom: 20 }, upd: at(2026, 11, 14, 10) }), at(2026, 11, 20, 6));
    assert.equal(C.nextOpen({ f: { k: 'month', dom: 5 }, upd: at(2026, 1, 1), last: at(2026, 12, 5, 6, 2) }), at(2027, 1, 5, 6));
    assert.equal(C.nextOpen({ f: { k: 'month', dom: 28 }, upd: at(2027, 2, 1) }), at(2027, 2, 28, 6), 'פברואר');
  });
  it('כל X ימים: מהפתיחה האחרונה; כלל חדש – 06:00 הבא; עריכה אחרי המועד (הפעלה מחדש) – מתחיל מהעריכה; עריכה באמצע – לא מזיזה', () => {
    assert.equal(C.nextOpen({ f: { k: 'days', n: 3 }, upd: at(2026, 11, 14, 5) }), at(2026, 11, 14, 6));
    assert.equal(C.nextOpen({ f: { k: 'days', n: 3 }, upd: at(2026, 11, 14, 7) }), at(2026, 11, 15, 6));
    assert.equal(C.nextOpen({ f: { k: 'days', n: 3 }, upd: at(2026, 11, 14, 5), last: at(2026, 11, 14, 6, 3) }), at(2026, 11, 17, 6));
    assert.equal(C.nextOpen({ f: { k: 'days', n: 3 }, upd: at(2026, 11, 16, 12), last: at(2026, 11, 14, 6, 3) }), at(2026, 11, 17, 6), 'עריכה באמצע המחזור');
    assert.equal(C.nextOpen({ f: { k: 'days', n: 3 }, upd: at(2026, 11, 30, 12), last: at(2026, 11, 14, 6, 3) }), at(2026, 12, 1, 6), 'הופעל מחדש אחרי הפסקה');
    assert.equal(C.nextOpen({ f: { k: 'days', n: 90 }, upd: 1, last: at(2026, 11, 14, 6) }), at(2027, 2, 12, 6));
  });
  it('ידני / תדירות לא תקינה / בלי upd – אין מועד', () => {
    assert.equal(C.nextOpen({ f: { k: 'manual' }, upd: at(2026, 11, 14) }), 0);
    for (const f of [null, {}, { k: 'week' }, { k: 'week', dow: 7 }, { k: 'week', dow: '1' }, { k: 'month', dom: 29 }, { k: 'month', dom: 0 }, { k: 'days', n: 0 }, { k: 'days', n: 91 }, { k: 'year' }]) {
      assert.equal(C.nextOpen({ f, upd: at(2026, 11, 14) }), 0, JSON.stringify(f));
    }
    assert.equal(C.nextOpen({ f: { k: 'week', dow: 0 } }), 0);
  });
  it('מעבר שעון (קיץ 27.3.2026, חורף 25.10.2026): 06:00 שעון קיר בישראל', () => {
    const fmt = (t) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(t));
    for (const [upd, dow] of [[at(2026, 3, 25, 12), 0], [at(2026, 3, 26, 12), 5], [at(2026, 10, 23, 12), 0], [at(2026, 10, 24, 12), 1]]) {
      const n = C.nextOpen({ f: { k: 'week', dow }, upd });
      assert.equal(fmt(n), '06:00', new Date(n).toISOString());
    }
    const d = C.nextOpen({ f: { k: 'days', n: 1 }, upd: 1, last: at(2026, 10, 24, 6, 1) });
    assert.equal(fmt(d), '06:00'); assert.equal(d, at(2026, 10, 25, 6));
  });
  it('decideOpen: כבוי / בסל / ידני / מוקדם – לא; בזמן – מזהה <rid>_<יום המועד>, זהה בכל ריצה עד הפתיחה (בלי כפילויות)', () => {
    const r = { on: true, f: { k: 'week', dow: 0 }, upd: at(2026, 11, 10, 9) };
    assert.equal(C.decideOpen(RID, Object.assign({}, r, { on: false }), at(2026, 11, 15, 7)).go, false);
    assert.equal(C.decideOpen(RID, Object.assign({}, r, { del: 1 }), at(2026, 11, 15, 7)).why, 'deleted');
    assert.equal(C.decideOpen(RID, Object.assign({}, r, { f: { k: 'manual' } }), at(2026, 11, 15, 7)).why, 'manual');
    const e = C.decideOpen(RID, r, at(2026, 11, 15, 5, 55));
    assert.deepEqual([e.go, e.why, e.next], [false, 'early', at(2026, 11, 15, 6)]);
    const ids = [at(2026, 11, 15, 6), at(2026, 11, 15, 6, 5), at(2026, 11, 16, 23), at(2026, 11, 21, 23, 59)].map((t) => C.decideOpen(RID, r, t));
    assert.ok(ids.every((d) => d.go && d.runId === RID + '_20261115'), JSON.stringify(ids));
    assert.ok(C.RE.runSched.test(ids[0].runId));
    // אחרי הפתיחה (last) – לא שוב עד המועד הבא
    const after = Object.assign({}, r, { last: at(2026, 11, 15, 6, 2) });
    assert.equal(C.decideOpen(RID, after, at(2026, 11, 21, 23)).go, false);
    assert.equal(C.decideOpen(RID, after, at(2026, 11, 22, 6)).runId, RID + '_20261122');
    // השרת היה כבוי כמה ימים (כל יום): סבב אחד בלבד, ואז ממשיכים מהיום
    const daily = { on: true, f: { k: 'days', n: 1 }, upd: 1, last: at(2026, 11, 10, 6) };
    assert.equal(C.decideOpen(RID, daily, at(2026, 11, 14, 9)).runId, RID + '_20261111');
    assert.equal(C.decideOpen(RID, Object.assign({}, daily, { last: at(2026, 11, 14, 9) }), at(2026, 11, 14, 23)).go, false);
  });
  it('מזהי סבב: מתוזמן, ידני, יזום', () => {
    assert.ok(C.isRunId('r8k2m4q1_20261116') && C.isRunId('r8k2m4q1_m1794715200000') && C.isRunId('ad_0123456789abcdef'));
    assert.ok(!C.isRunId('r8k2m4q1_2026111') && !C.isRunId('../x') && !C.isRunId(5));
  });
});

describe('store3d: הגדרות, חלוקה לעובדים ומחליף', () => {
  it('settingsFor: הכלל דורס את s3set; ברירות מחדל manual, בלי מחליף, 2 ימים', () => {
    assert.deepEqual(C.settingsFor({}, {}), { sub: 'manual', subU: '', due: 2 });
    assert.deepEqual(C.settingsFor({}, { sub: 'fixed', subU: SUB, due: 5 }), { sub: 'fixed', subU: SUB, due: 5 });
    assert.deepEqual(C.settingsFor({ sub: 'any', subU: U3, due: 1 }, { sub: 'fixed', subU: SUB, due: 5 }), { sub: 'any', subU: U3, due: 1 });
    assert.deepEqual(C.settingsFor({ sub: 'x', subU: '', due: 15 }, { sub: 'any', due: 0 }), { sub: 'any', subU: '', due: 2 });
  });
  it('baysOf: מקטעים מהגופים (צד b בגונדולה דו-צדדית), גוף מחוק מדולג, מדף גבוה = 2 צילומים', () => {
    const b = C.baysOf(MAP);
    assert.deepEqual(b.map((x) => x.bay), ['f1-a-1', 'f1-a-2', 'f1-a-3', 'f1-b-1', 'f1-b-2', 'f1-b-3', 'f2-a-1', 'f2-a-2', 'f3-a-1', 'f3-a-2', 'f3-a-3', 'f3-a-4']);
    assert.ok(b.every((x) => C.RE.bay.test(x.bay)));
    assert.deepEqual(b.filter((x) => x.k === 2).map((x) => x.bay), ['f2-a-1', 'f2-a-2']);
    const big = { fx: Array.from({ length: 100 }, (_, i) => fx('f' + (i + 1), { sides: 2, bays: 30 })) };
    assert.equal(C.baysOf(big).length, 2000, 'עד 2000 מקטעים');
  });
  it('mapProblem: חסרה / נמחקה / סניף אחר / בלי מקטעים', () => {
    assert.equal(C.mapProblem(null, 'main'), 'no-map');
    assert.equal(C.mapProblem(Object.assign({}, MAP, { del: 1 }), 'main'), 'map-deleted');
    assert.equal(C.mapProblem(MAP, 'other'), 'no-map');
    assert.equal(C.mapProblem(Object.assign({}, MAP, { fx: [] }), 'main'), 'no-map');
    assert.equal(C.mapProblem(MAP, 'main'), '');
  });
  it('splitBays: עובד אחד – הכל; z לפי חדר/גוף; z ריק = השאר; אף מקטע לא אצל שניים; n/nUid נכונים', () => {
    const b = C.baysOf(MAP);
    const one = C.splitBays(b, [{ u: U1, z: [] }]);
    assert.equal(one.asg[U1].length, 12); assert.equal(one.n, 14); assert.deepEqual(one.nUid, { [U1]: { n: 14, d: 0 } });
    const z = C.splitBays(b, [{ u: U1, z: ['r2'] }, { u: U2, z: ['f2', 'f3'] }, { u: U3, z: [] }]);
    assert.deepEqual(z.asg[U1], ['f3-a-1', 'f3-a-2', 'f3-a-3', 'f3-a-4']);
    assert.deepEqual(z.asg[U2], ['f2-a-1', 'f2-a-2'], 'f3 כבר אצל הראשון – לא פעמיים');
    assert.deepEqual(z.asg[U3], ['f1-a-1', 'f1-a-2', 'f1-a-3', 'f1-b-1', 'f1-b-2', 'f1-b-3']);
    assert.equal(z.n, 14); assert.deepEqual(z.uids, [U1, U2, U3]);
    const all = Object.values(z.asg).flat();
    assert.equal(new Set(all).size, all.length);
    // רק z מפורש – מה שלא שויך לא בסבב
    const part = C.splitBays(b, [{ u: U1, z: ['f2'] }]);
    assert.deepEqual([part.asg[U1].length, part.n], [2, 4]);
  });
  it('splitBays: כמה עובדים עם z ריק – חלוקה רציפה לפי גופים, מאוזנת; uid כפול מאוחד; uid לא תקין מדולג; עד 10', () => {
    const m = { fx: Array.from({ length: 8 }, (_, i) => fx('f' + (i + 1), { bays: 2 })) };
    const s = C.splitBays(C.baysOf(m), [{ u: U1, z: [] }, { u: U2, z: [] }]);
    assert.deepEqual([s.nUid[U1].n, s.nUid[U2].n], [8, 8]);
    assert.deepEqual(s.asg[U1].slice(0, 2), ['f1-a-1', 'f1-a-2']);
    assert.ok(s.asg[U2].every((x) => /^f[5-8]-/.test(x)), 'רציף');
    const d = C.cleanAsg([{ u: U1, z: ['r1'] }, { u: U1, z: ['f3'] }, { u: 'bad id', z: [] }, { u: U2, z: ['x9', 'f2'] }]);
    assert.deepEqual(d, [{ u: U1, z: ['r1', 'f3'] }, { u: U2, z: ['f2'] }]);
    const many = Array.from({ length: 12 }, (_, i) => ({ u: 'worker_' + i, z: [] }));
    assert.equal(C.cleanAsg(many).length, 10);
    assert.deepEqual(C.uidsOf([{ u: U1, z: [] }], SUB), [U1, SUB]);
    assert.deepEqual(C.uidsOf([{ u: U1, z: [] }, { u: SUB, z: [] }], SUB), [U1, SUB]);
  });
  it('planDeparted: כולם פעילים – כלום; מחליף קבוע פעיל – החלק עובר אליו (מאוחד אם כבר משויך)', () => {
    const asg = [{ u: U1, z: ['r1'] }, { u: U2, z: ['f3'] }];
    assert.deepEqual(C.planDeparted(asg, () => true, 'fixed', SUB), { asg: null, moved: [], stuck: [], err: '' });
    const act = (u) => u !== U1;
    assert.deepEqual(C.planDeparted(asg, act, 'fixed', SUB), { asg: [{ u: SUB, z: ['r1'] }, { u: U2, z: ['f3'] }], moved: [U1], stuck: [], err: '' });
    assert.deepEqual(C.planDeparted(asg, act, 'fixed', U2).asg, [{ u: U2, z: ['f3', 'r1'] }]);
    assert.deepEqual(C.planDeparted([{ u: U1, z: [] }, { u: U2, z: ['f3'] }], act, 'fixed', U2).asg, [{ u: U2, z: [] }], 'z ריק = הכל');
  });
  it('planDeparted: עובד מושבת בלי מחליף = שגיאה (manual/any: staff-disabled; fixed עם מחליף מושבת/חסר: sub-disabled)', () => {
    const asg = [{ u: U1, z: [] }];
    assert.deepEqual(C.planDeparted(asg, () => false, 'manual', SUB), { asg: null, moved: [], stuck: [U1], err: 'staff-disabled' });
    assert.equal(C.planDeparted(asg, () => false, 'any', '').err, 'staff-disabled');
    assert.equal(C.planDeparted(asg, (u) => u !== U1 && u !== SUB, 'fixed', SUB).err, 'sub-disabled');
    assert.equal(C.planDeparted(asg, (u) => u !== U1, 'fixed', '').err, 'sub-disabled');
  });
  it('runDoc: מבנה לפי החוזה 4.8 – מועד סיום לפי הימים, יומן ריק לכל עובד', () => {
    const split = C.splitBays(C.baysOf(MAP), [{ u: U1, z: [] }]);
    const now = at(2026, 11, 15, 6, 1);
    const d = C.runDoc({ rid: RID, br: 'main', mapId: 's-main', mapV: 3, k: 'sched', split, now, due: 2, subFrom: {} });
    assert.deepEqual(Object.keys(d).sort(), ['asg', 'br', 'dueAt', 'k', 'map', 'mapV', 'n', 'nDone', 'nUid', 'openAt', 'rid', 'st', 'tlog', 'uids'].sort());
    assert.deepEqual([d.st, d.openAt, d.dueAt, d.n, d.nDone], ['open', now, now + 2 * D1, 14, 0]);
    assert.deepEqual(d.tlog, { [U1]: [] });
    assert.deepEqual(C.runDoc({ br: 'main', mapId: 's-main', mapV: 3, k: 'manual', split, now, due: 1, subFrom: { [U2]: U1 } }).subFrom, { [U2]: U1 });
  });
});

describe('store3d: זמנים, סיום, תזכורת ואיחור', () => {
  const open = at(2026, 11, 15, 6), now = at(2026, 11, 15, 12);
  it('addEvent: סוג וזמן נבדקים (דקה לפני הפתיחה עד 2 דקות קדימה), מסודר לפי זמן, עד 100', () => {
    assert.throws(() => C.addEvent([], 'x', now, open, now), { code: 'bad-ev' });
    assert.throws(() => C.addEvent([], 's', open - 60001, open, now), { code: 'bad-time' });
    assert.throws(() => C.addEvent([], 's', now + 120001, open, now), { code: 'bad-time' });
    assert.throws(() => C.addEvent([], 's', 1.5, open, now), { code: 'bad-time' });
    let l = C.addEvent([], 'p', open + 3600000, open, now);
    l = C.addEvent(l, 's', open + 60000, open, now); // נשלח מאוחר (בלי רשת) – נכנס לפי הזמן
    assert.deepEqual(l.map((e) => e.k), ['s', 'p']);
    const full = Array.from({ length: 100 }, (_, i) => ({ k: 'p', t: open + i }));
    assert.throws(() => C.addEvent(full, 'r', now, open, now), { code: 'full' });
  });
  it('workPause: עבודה מ-s/r עד p/e, הפסקה מ-p עד r/e; קטע פתוח לא נספר', () => {
    const m = (x) => open + x * 60000;
    assert.deepEqual(C.workPause([{ k: 's', t: m(0) }, { k: 'p', t: m(30) }, { k: 'r', t: m(45) }, { k: 'e', t: m(105) }]), { work: 90, pause: 15, pauses: 1 });
    assert.deepEqual(C.workPause([{ k: 's', t: m(0) }, { k: 'p', t: m(10) }, { k: 'e', t: m(20) }]), { work: 10, pause: 10, pauses: 1 });
    assert.deepEqual(C.workPause([{ k: 's', t: m(0) }]), { work: 0, pause: 0, pauses: 0 });
    assert.deepEqual(C.workPause([{ k: 's', t: m(0) }, { k: 's', t: m(5) }, { k: 'e', t: m(20) }]), { work: 20, pause: 0, pauses: 0 }, 'התחלה כפולה לא מאפסת');
  });
  it('finished: הכל צולם, או שכל עובד עם חלק סיים (e אחרון); עובד בלי מקטעים לא מעכב', () => {
    const base = { n: 4, nDone: 1, uids: [U1, U2], nUid: { [U1]: { n: 4, d: 1 }, [U2]: { n: 0, d: 0 } }, tlog: { [U1]: [{ k: 's', t: 1 }], [U2]: [] } };
    assert.equal(C.finished(base), false);
    assert.equal(C.finished(Object.assign({}, base, { nDone: 4 })), true);
    assert.equal(C.finished(Object.assign({}, base, { tlog: { [U1]: [{ k: 's', t: 1 }, { k: 'e', t: 2 }] } })), true);
    assert.equal(C.finished(Object.assign({}, base, { tlog: { [U1]: [{ k: 'e', t: 2 }, { k: 'r', t: 3 }] } })), false, 'המשיך אחרי סיום');
    assert.equal(C.closeSt({ dueAt: 10 }, 10), 'done'); assert.equal(C.closeSt({ dueAt: 10 }, 11), 'closed');
  });
  it('timeStep: תזכורת 24 שעות לפני המועד (בסבב קצר – באמצע), איחור במועד; רק לסבב פתוח', () => {
    const r = { st: 'open', openAt: open, dueAt: open + 2 * D1 };
    assert.deepEqual(C.timeStep(r, open + D1 - 1), {});
    assert.deepEqual(C.timeStep(r, open + D1), { kind: 'remind' });
    assert.deepEqual(C.timeStep(r, open + 2 * D1), { st: 'late', kind: 'late' });
    assert.deepEqual(C.timeStep(Object.assign({}, r, { st: 'late' }), open + 3 * D1), {});
    assert.deepEqual(C.timeStep(Object.assign({}, r, { st: 'done' }), open + 3 * D1), {});
    const short = { st: 'open', openAt: open, dueAt: open + D1 };
    assert.equal(C.remindAt(short), open + D1 / 2);
    assert.deepEqual(C.behind({ uids: [U1, U2, U3], nUid: { [U1]: { n: 3, d: 3 }, [U2]: { n: 2, d: 1 }, [U3]: { n: 0, d: 0 } } }), [U2]);
    const ended = { uids: [U1, U2], nUid: { [U1]: { n: 3, d: 0 }, [U2]: { n: 2, d: 0 } }, tlog: { [U1]: [{ k: 's', t: 1 }, { k: 'e', t: 2 }], [U2]: [{ k: 'e', t: 1 }, { k: 'r', t: 2 }] } };
    assert.deepEqual(C.behind(ended), [U2], 'מי שרשם סיום לא מקבל תזכורת; מי שהמשיך אחרי סיום – כן');
  });
});

describe('store3d: העברה ומה עובד רואה', () => {
  const run = { st: 'open', asg: { [U1]: ['f1-a-1', 'f1-a-2'], [U2]: ['f2-a-1'] }, uids: [U1, U2], nUid: { [U1]: { n: 2, d: 1 }, [U2]: { n: 2, d: 0 } },
    tlog: { [U1]: [{ k: 's', t: 5 }], [U2]: [{ k: 's', t: 7 }, { k: 'p', t: 9 }] }, work: { [U1]: 3, [U2]: 4 }, pause: { [U2]: 1 }, openAt: 1, dueAt: 2, map: 's-main', mapV: 3,
    sum: { score: 80, nOk: 1 }, recs: [{ t: 'להזיז' }] };
  it('moveRun: החלק עובר, הספירות מתאחדות, היומן הישן נשאר, subFrom נרשם; אותו עובד / לא בסבב – שגיאה', () => {
    const p = C.moveRun(run, U1, U3);
    assert.deepEqual(p.asg, { [U2]: ['f2-a-1'], [U3]: ['f1-a-1', 'f1-a-2'] });
    assert.deepEqual(p.uids, [U2, U3]);
    assert.deepEqual(p.nUid, { [U2]: { n: 2, d: 0 }, [U3]: { n: 2, d: 1 } });
    assert.deepEqual(p.tlog[U1], [{ k: 's', t: 5 }]); assert.deepEqual(p.tlog[U3], []);
    assert.deepEqual(p.subFrom, { [U1]: U3 });
    const m = C.moveRun(run, U1, U2);
    assert.deepEqual([m.asg[U2], m.nUid[U2], m.uids], [['f2-a-1', 'f1-a-1', 'f1-a-2'], { n: 4, d: 1 }, [U2]]);
    assert.throws(() => C.moveRun(run, U1, U1), { code: 'same' });
    assert.throws(() => C.moveRun(run, U3, U1), { code: 'not-in-run' });
  });
  it('takeParts / partKey: בלי uid, מזהה עקיף קבוע ושונה לכל עובד ולכל סבב', () => {
    const t = C.takeParts('r8k2m4q1_20261115', run);
    assert.deepEqual(t.map((x) => [x.n, x.d, x.bays]), [[2, 1, 2], [2, 0, 1]]);
    assert.ok(t.every((x) => /^[0-9a-f]{16}$/.test(x.h)));
    assert.ok(!JSON.stringify(t).includes(U1) && !JSON.stringify(t).includes(U2));
    assert.equal(t[0].h, C.partKey('r8k2m4q1_20261115', U1));
    assert.notEqual(C.partKey('r8k2m4q1_20261115', U1), C.partKey('r8k2m4q1_20261122', U1));
    assert.notEqual(t[0].h, t[1].h);
  });
  it('viewRun: רק המקטעים שלו, הזמנים שלו בלבד; ברירת מחדל fix בלבד (בלי ציון, המלצות, מוצרים)', () => {
    const ai = [
      ['f1-a-1_a', { st: 'issue', conf: 0.9, iss: [{ k: 'hole', sev: 2, conf: 0.8, t: 'חור', box: [1, 2, 3, 4], warn: false }], sc: { p: 1, h: 2, o: 3, d: 4, all: 70 }, recs: [{ t: 'סדר' }], prods: [{ n: 'במבה' }], tok: { in: 1, out: 2 }, model: 'm' }],
      ['f2-a-1_a', { st: 'ok', iss: [] }],
    ];
    const v = C.viewRun('r8k2m4q1_20261115', run, U1, undefined, ai);
    assert.deepEqual(v.bays, ['f1-a-1', 'f1-a-2']);
    assert.deepEqual([v.tlog, v.work, v.pause], [[{ k: 's', t: 5 }], 3, 0]);
    assert.deepEqual(Object.keys(v.ai), ['f1-a-1_a'], 'לא של עובד אחר');
    assert.deepEqual(v.ai['f1-a-1_a'], { st: 'issue', iss: [{ k: 'hole', sev: 2, t: 'חור', box: [1, 2, 3, 4] }] });
    assert.equal(v.sum, undefined); assert.equal(v.recs, undefined);
    assert.ok(!JSON.stringify(v).includes(U2), 'אין זכר לעובד האחר');
  });
  it('viewRun: score / recs / full לפי show; full בלי tok; ערך לא מוכר מתעלם', () => {
    const ai = [['f1-a-1_a', { st: 'issue', iss: [], sc: { all: 70, p: 1 }, recs: [{ t: 'סדר' }], prods: [{ n: 'במבה' }], tok: { in: 1 } }]];
    const s = C.viewRun('x', run, U1, ['score', 'bogus'], ai);
    assert.deepEqual(s.ai['f1-a-1_a'], { st: 'issue', iss: [], sc: { all: 70 } }); assert.deepEqual(s.sum, { score: 80 });
    assert.deepEqual(C.viewRun('x', run, U1, ['recs'], ai).ai['f1-a-1_a'].recs, [{ t: 'סדר' }]);
    const f = C.viewRun('x', run, U1, ['full'], ai);
    assert.deepEqual(f.ai['f1-a-1_a'].prods, [{ n: 'במבה' }]); assert.equal(f.ai['f1-a-1_a'].tok, undefined);
    assert.deepEqual(f.sum, run.sum); assert.deepEqual(f.recs, run.recs);
    assert.deepEqual([f.tlog, f.work], [[{ k: 's', t: 5 }], 3], 'גם ב-full – רק הזמנים שלו');
  });
});

describe('store3d: הפונקציות מיוצאות', () => {
  it('s3Rounds מתוזמנת כל 5 דקות בשעון ישראל, us-central1 בלבד; s3Run/s3Move/s3Log/s3View – onCall; ליבה לבדיקות לא נספרת', () => {
    const ex = require(path.join(FN, 'index.js'));
    const e = ex.s3Rounds.__endpoint;
    assert.ok(e.scheduleTrigger);
    assert.equal(e.scheduleTrigger.schedule, 'every 5 minutes');
    assert.equal(e.scheduleTrigger.timeZone, 'Asia/Jerusalem');
    assert.deepEqual([].concat(e.region), ['us-central1']);
    for (const n of ['s3Run', 's3Move', 's3Log', 's3View']) assert.ok(ex[n].__endpoint.callableTrigger, n);
    const m = require(path.join(FN, 'store3d.js'));
    assert.deepEqual(Object.keys(m).sort(), ['s3Log', 's3Move', 's3Rounds', 's3Run', 's3View']);
    assert.equal(typeof m._core.runAll, 'function');
  });
});
