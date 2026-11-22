'use strict';
// המזכירה – "התראות מהטלפון" (app-source/www/sec-notif.js, החלק הטהור): בדיקות יחידה, בלי אמולטור ובלי רשת.
// למידה (ספירה, הצעה אחרי פעמיים, "תמיד לשאול", מחיקת כלל), החרגת שולחים, מניעת כפילות ומזהה משימה קבוע.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../app-source/www/sec-notif.js');

const T = 1795000000000;
const N = (k, o) => Object.assign({ k, p: 'com.whatsapp', a: 'WhatsApp', s: 'דני ספק', x: 'הסחורה תגיע מחר', t: T }, o || {});

describe('sec-notif: שולח והחרגה', () => {
  it('senderKey: בלי "(3 הודעות)", אותיות קטנות, רווחים אחידים', () => {
    assert.equal(C.senderKey('  Dani   Cohen (3 הודעות) '), 'dani cohen');
    assert.equal(C.senderKey('דני (2 messages)'), 'דני');
    assert.equal(C.senderKey(null), '');
  });
  it('isSkipped: התאמה לפי senderKey, שם ריק לא מוחרג', () => {
    assert.equal(C.isSkipped(['Dani Cohen'], 'dani  cohen (4 הודעות)'), true);
    assert.equal(C.isSkipped(['דני'], 'דני ספק'), false);
    assert.equal(C.isSkipped([''], ''), false);
    assert.equal(C.isSkipped(null, 'x'), false);
  });
});

describe('sec-notif: מיזוג מהתוסף', () => {
  it('מפתח שכבר קיים לא נכנס פעמיים (גם באותה משיכה)', () => {
    const a = C.merge([], [N('k1'), N('k1'), N('k2', { t: T + 1 })], []);
    assert.equal(a.list.length, 2); assert.equal(a.added.length, 2);
    const b = C.merge(a.list, [N('k1'), N('k3', { t: T + 2 })], []);
    assert.deepEqual(b.added.map((x) => x.k), ['k3']); assert.equal(b.list.length, 3);
    assert.ok(b.list.every((x) => x.st === 'new'));
  });
  it('שולח מוחרג לא נכנס; פריט בלי מפתח נדחה', () => {
    const a = C.merge([], [N('k1', { s: 'ספאם (5 הודעות)' }), N(''), { x: 'בלי מפתח' }, N('k2')], ['ספאם']);
    assert.deepEqual(a.list.map((x) => x.k), ['k2']);
  });
  it('טקסט עד 1,000 תווים; עד 300 פריטים – קודם נמחקים הישנים שטופלו', () => {
    const big = C.merge([], [N('b', { x: 'א'.repeat(1500) })], []);
    assert.equal(big.list[0].x.length, 1000);
    const L = []; for (let i = 0; i < 300; i++) L.push(Object.assign(N('o' + i, { t: T + i }), { st: i === 5 ? 'done' : 'new' }));
    const m = C.merge(L, [N('new1', { t: T + 999 })], [], 300);
    assert.equal(m.list.length, 300); assert.ok(!m.list.some((x) => x.k === 'o5')); assert.ok(m.list.some((x) => x.k === 'o0'));
    assert.equal(m.added.length, 1);
  });
});

describe('sec-notif: למידה', () => {
  const W = { uid: 'u1', un: 'מרים' };
  it('פעם אחת – אין הצעה; פעמיים אותו שולח+פעולה+עובד – הצעה', () => {
    const L = {}, R = {};
    C.record(L, N('a'), 'task', W, T);
    assert.equal(C.suggest(L, R).length, 0);
    C.record(L, N('b', { x: 'עוד הודעה' }), 'task', W, T + 1);
    const s = C.suggest(L, R);
    assert.equal(s.length, 1); assert.equal(s[0].act, 'task'); assert.equal(s[0].uid, 'u1'); assert.equal(s[0].un, 'מרים'); assert.equal(s[0].n, 2);
    assert.equal(s[0].rk, 'com.whatsapp|דני ספק');
  });
  it('עובד אחר = ספירה נפרדת (אין הצעה)', () => {
    const L = {};
    C.record(L, N('a'), 'task', W, T); C.record(L, N('b'), 'task', { uid: 'u2', un: 'יוסי' }, T + 1);
    assert.equal(C.suggest(L, {}).length, 0);
  });
  it('אפליקציה אחרת = שולח אחר', () => {
    const L = {};
    C.record(L, N('a'), 'ign', null, T); C.record(L, N('b', { p: 'com.google.android.gm' }), 'ign', null, T + 1);
    assert.equal(C.suggest(L, {}).length, 0);
  });
  it('רק פעולות שמותר לבצע לבד: "התעלם" כן; "טופל"/תזכורת/שאלה לא; משימה בלי עובד לא', () => {
    const L = {};
    ['done', 'rem', 'ask'].forEach((a, i) => { C.record(L, N('x' + i, { s: 'S' + a }), a, null, T); C.record(L, N('y' + i, { s: 'S' + a }), a, null, T + 1); });
    C.record(L, N('t1', { s: 'בלי עובד' }), 'task', null, T); C.record(L, N('t2', { s: 'בלי עובד' }), 'task', null, T + 1);
    assert.equal(C.suggest(L, {}).length, 0);
    C.record(L, N('i1', { s: 'פרסומות' }), 'ign', null, T); C.record(L, N('i2', { s: 'פרסומות' }), 'ign', null, T + 1);
    assert.deepEqual(C.suggest(L, {}).map((e) => e.act), ['ign']);
  });
  it('הבחירה האחרונה קובעת: אחרי פעמיים משימה ואז "טופל" – אין הצעה', () => {
    const L = {};
    C.record(L, N('a'), 'task', W, T); C.record(L, N('b'), 'task', W, T + 1); C.record(L, N('c'), 'done', null, T + 2);
    assert.equal(C.suggest(L, {}).length, 0);
  });
  it('פרטיות: הלמידה לא שומרת מילה מטקסט ההודעה; kwOf עדיין עובד', () => {
    const L = {}; const e = C.record(L, N('a', { x: 'שלום, החשבונית של החודש מצורפת' }), 'ign', null, T);
    assert.equal('kw' in e, false); assert.equal(JSON.stringify(L).includes('החשבונית'), false); assert.equal(JSON.stringify(L).includes('מצורפת'), false);
    assert.equal(C.kwOf('שלום, החשבונית של החודש מצורפת'), 'החשבונית');
    assert.equal(C.kwOf('היי מה נשמע'), 'נשמע');
    assert.equal(C.kwOf(''), '');
  });
  it('אישור הצעה = כלל שמבוצע; "תמיד לשאול" = אין כלל ואין הצעה; מחיקה מאפסת', () => {
    const L = {}, R = {};
    C.record(L, N('a'), 'task', W, T); C.record(L, N('b'), 'task', W, T + 1);
    const e = C.suggest(L, R)[0];
    C.setRule(R, e, true, T + 2);
    assert.equal(C.suggest(L, R).length, 0);
    const r = C.ruleFor(R, N('z', { s: 'דני ספק (2 הודעות)' }));
    assert.ok(r); assert.equal(r.act, 'task'); assert.equal(r.uid, 'u1');
    assert.equal(C.ruleFor(R, N('z', { s: 'מישהו אחר' })), null);
    C.setRule(R, e, false, T + 3);
    assert.equal(C.ruleFor(R, N('z')), null); assert.equal(C.suggest(L, R).length, 0);
    C.delRule(R, L, e.rk);
    assert.equal(Object.keys(R).length, 0); assert.equal(Object.keys(L).length, 0);
  });
});

describe('sec-notif: מזהה משימה ויומן', () => {
  it('tidOf: קבוע לאותו מפתח, שונה למפתחות שונים, רק אותיות וספרות', () => {
    const a = C.tidOf('com.whatsapp|1a2b|lx1'), b = C.tidOf('com.whatsapp|1a2b|lx1'), c = C.tidOf('com.whatsapp|1a2b|lx2');
    assert.equal(a, b); assert.notEqual(a, c); assert.match(a, /^n[0-9a-f]{16}$/);
    const S = new Set(); for (let i = 0; i < 5000; i++) S.add(C.tidOf('k|' + i)); assert.equal(S.size, 5000);
  });
  it('logAdd: החדש ראשון, עד 50', () => {
    let G = []; for (let i = 0; i < 60; i++) G = C.logAdd(G, { t: i });
    assert.equal(G.length, 50); assert.equal(G[0].t, 59);
  });
});

describe('sec-notif: מצב לפי מפתח (בלי טקסט)', () => {
  it('stPut שומר רק st/by/tk/at/cap – לא שולח ולא טקסט; applySt מחזיר "new" כברירת מחדל', () => {
    const M = {};
    C.stPut(M, 'k1', { st: 'ign', by: 'auto', s: 'דני', x: 'סוד', p: 'com.whatsapp' }, T);
    assert.deepEqual(Object.keys(M.k1).sort(), ['at', 'by', 'st']); assert.equal(M.k1.at, T);
    assert.equal(JSON.stringify(M).includes('סוד'), false); assert.equal(JSON.stringify(M).includes('דני'), false);
    const L = C.applySt([N('k1'), N('k2')], M);
    assert.equal(L[0].st, 'ign'); assert.equal(L[0].by, 'auto'); assert.equal(L[1].st, 'new'); assert.equal(L[1].x, 'הסחורה תגיע מחר');
    assert.equal(C.stPut(M, '', { st: 'x' }, T), null);
  });
  it('stTrim: מוחק מפתחות שלא בתור, ועד MAXM – קודם הישנים', () => {
    const M = { a: { st: 'done', at: 1 }, b: { st: 'done', at: 2 }, c: { st: 'done', at: 3 } };
    assert.equal(C.stTrim(M, new Set(['b', 'c'])), true); assert.deepEqual(Object.keys(M).sort(), ['b', 'c']);
    assert.equal(C.stTrim(M, new Set(['b', 'c'])), false);
    assert.equal(C.stTrim(M, null, 1), true); assert.deepEqual(Object.keys(M), ['c']);
  });
});

describe('sec-notif: תקרה לביצוע אוטומטי', () => {
  it('עד 10 בעיבוד אחד', () => {
    let Cc = null, ok = 0, used = 0;
    for (let i = 0; i < 15; i++) { const r = C.capTake(Cc, 'p|s', '2026-11-22', used); Cc = r.C; if (r.ok) { ok++; used++; } else assert.equal(r.why, 'run'); }
    assert.equal(ok, C.AUTO_RUN); assert.equal(C.AUTO_RUN, 10); assert.equal(Cc.n['p|s'], 10);
  });
  it('עד 30 ביום לכל כלל; כלל אחר נפרד; יום חדש מתאפס', () => {
    let Cc = null, ok = 0;
    for (let run = 0; run < 5; run++) for (let i = 0; i < 10; i++) { const r = C.capTake(Cc, 'p|s', '2026-11-22', i); Cc = r.C; if (r.ok) ok++; else assert.equal(r.why, 'day'); }
    assert.equal(ok, C.AUTO_DAY); assert.equal(C.AUTO_DAY, 30);
    assert.equal(C.capTake(Cc, 'p|other', '2026-11-22', 0).ok, true);
    const r = C.capTake(Cc, 'p|s', '2026-11-23', 0); assert.equal(r.ok, true); assert.equal(r.C.d, '2026-11-23'); assert.equal(r.C.n['p|s'], 1);
  });
});
