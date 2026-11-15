'use strict';
// סריקת חנות בתלת מימד – שלב 10 (14.11.2026): בדיקות יחידה ללוגיקה הטהורה של השרת הנלווה (functions/lib/store3d-extra.js), בלי אמולטור.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const X = require(path.join(__dirname, '..', 'functions', 'lib', 'store3d-extra.js'));

const D1 = 86400000, NOW = 1800000000000;
const I = (k, o) => Object.assign({ k, sev: 2, conf: 0.9, t: '', warn: false }, o);

describe('store3d-extra: ציון לפי משקלות', () => {
  it('משקלות: ברירת מחדל 35/30/20/15; משקלות תקינים (סכום 100) נלקחים; לא תקינים – ברירת מחדל', () => {
    assert.deepEqual(X.weights(null), { p: 35, h: 30, o: 20, d: 15 });
    assert.deepEqual(X.weights({ p: 25, h: 25, o: 25, d: 25 }), { p: 25, h: 25, o: 25, d: 25 });
    assert.deepEqual(X.weights({ p: 50, h: 50, o: 50, d: 0 }), { p: 35, h: 30, o: 20, d: 15 }, 'סכום 150');
    assert.deepEqual(X.weights({ p: 100, h: 0, o: 0 }), { p: 35, h: 30, o: 20, d: 15 }, 'חסר מפתח');
  });
  it('ציון מקום: 100 בלי בעיות; בעיה קשה מורידה בקטגוריה שלה לפי חומרה; הכולל משוקלל; ניתן לשינוי במשקלות', () => {
    assert.deepEqual(X.scoreSlot({ st: 'ok', iss: [] }), { p: 100, h: 100, o: 100, d: 100, all: 100 });
    const ai = { st: 'issue', iss: [I('noprice', { sev: 3 }), I('hole', { sev: 1 })] };
    assert.deepEqual(X.scoreSlot(ai), { p: 50, h: 85, o: 100, d: 100, all: Math.round((50 * 35 + 85 * 30 + 100 * 20 + 100 * 15) / 100) });
    assert.equal(X.scoreSlot(ai, { p: 0, h: 0, o: 50, d: 50 }).all, 100, 'משקל 0 למחירים ולחורים');
    assert.equal(X.scoreSlot({ st: 'issue', iss: [I('fallen', { sev: 3 }), I('upside', { sev: 3 }), I('damaged', { sev: 3 })] }).d, 0, 'לא פחות מ-0');
  });
  it('"לבדיקה" ואזהרות לא מורידים ציון; תמונה לא קריאה / אדם – בלי ציון', () => {
    assert.equal(X.scoreSlot({ st: 'review', iss: [I('noprice', { warn: true, conf: 0.4 })] }).all, 100);
    assert.equal(X.scoreSlot({ st: 'issue', iss: [I('pricepos', { warn: true }), I('order')] }).p, 100, 'pricepos – אזהרה');
    assert.equal(X.scoreSlot({ st: 'bad', iss: [] }), null);
    assert.equal(X.scoreSlot({ st: 'person', iss: [] }), null);
  });
  it('ערעור שהתקבל (ovr) מבטל את הבעיה בציון ובמצב; ovr.all מבטל הכל', () => {
    const ai = { st: 'issue', iss: [I('noprice', { sev: 3 }), I('hole')], ovr: { 0: 'acc' } };
    assert.deepEqual([X.scoreSlot(ai).p, X.scoreSlot(ai).h, X.hardIdx(ai), X.effSt(ai)], [100, 70, [1], 'issue']);
    const all = Object.assign({}, ai, { ovr: { all: 'acc' } });
    assert.deepEqual([X.scoreSlot(all).all, X.hardIdx(all), X.effSt(all)], [100, [], 'ok']);
    assert.equal(X.effAi(all).iss.every((i) => i.warn), true);
  });
});

describe('store3d-extra: סיכום סבב, חוסרים, משימות תיקון', () => {
  const run = { map: 's-main', br: 'main', n: 6, asg: { u_emp001: ['f1-a-1', 'f1-a-2'], u_emp002: ['f2-a-1'] } };
  const E = [
    ['f1-a-1_a', { st: 'ok', iss: [] }],
    ['f1-a-2_a', { st: 'issue', iss: [I('hole', { t: 'חסר חלב' }), I('noprice', { warn: true })], miss: [{ n: 'גבינה', why: 'prev', pid: 'p9' }], cat: 'חלב' }],
    ['f2-a-1_t', { st: 'review', iss: [I('low', { warn: true, conf: 0.4 })] }],
    ['f2-a-1_b', { st: 'bad', iss: [] }],
  ];
  it('סיכום: ספירות, לא צולם = n פחות מה שנבדק, ציון ממוצע של המקומות שנבדקו, השוואה לסבב הקודם', () => {
    const s = X.runSum(E, run, null, { runId: 'r8k2m4q1_20261108', score: 80 });
    assert.deepEqual([s.nOk, s.nIss, s.nRev, s.nBad, s.nMiss], [1, 1, 1, 1, 2]);
    assert.deepEqual(s.cat, { p: 100, h: 90, o: 100, d: 100 });
    assert.equal(s.score, 97);
    assert.deepEqual([s.prev, s.dScore], ['r8k2m4q1_20261108', 17]);
    assert.deepEqual([X.runSum([], run, null, null).score, X.runSum([], run, null, null).prev], [0, '']);
  });
  it('הסבב הקודם: האחרון שהסתיים לפני הפתיחה, עם sum, בלי יזום', () => {
    const L = [['a1xxxx_20261101', { st: 'done', k: 'sched', doneAt: 10, sum: { score: 60 } }], ['a1xxxx_20261108', { st: 'closed', k: 'sched', doneAt: 20, sum: { score: 70 } }],
      ['ad_xxxxxxxxxxxxxxxxxxxx', { st: 'done', k: 'adhoc', doneAt: 25, sum: { score: 10 } }], ['a1xxxx_20261115', { st: 'open', k: 'sched' }], ['a1xxxx_20261122', { st: 'done', doneAt: 50, sum: { score: 99 } }]];
    assert.deepEqual(X.prevRun(L, 'a1xxxx_20261115', 30), { runId: 'a1xxxx_20261108', score: 70 });
  });
  it('חוסרים: miss + low/hole קשים, בלי אזהרות ובלי כפילויות', () => {
    const L = X.shortList(E.concat([['f1-a-2_a', E[1][1]]]));
    assert.deepEqual(L, [{ n: 'גבינה', c: 'חלב', bay: 'f1-a-2', why: 'miss', pid: 'p9' }, { n: 'חסר חלב', c: 'חלב', bay: 'f1-a-2', why: 'hole' }]);
    assert.deepEqual(X.shortList([['f1-a-2_a', Object.assign({}, E[1][1], { ovr: { all: 'acc' } })]]), [], 'ערעור על הכל');
  });
  it('משימות תיקון: רק מקום עם בעיה קשה, לעובד שהמקטע שלו, מזהה <runId>__<slot>, מועד לפי due', () => {
    const t = X.fixTasks(E, run, 'r8k2m4q1_20261115', NOW, 3);
    assert.equal(t.length, 1);
    assert.deepEqual(t[0], { id: 'r8k2m4q1_20261115__f1-a-2_a', doc: { run: 'r8k2m4q1_20261115', slot: 'f1-a-2_a', map: 's-main', br: 'main', iks: [0], by: 'ai', u: 'u_emp001', st: 'open', at: NOW, dueAt: NOW + 3 * D1 } });
    assert.equal(X.fixTasks([['f1-a-2_a', Object.assign({}, E[1][1], { ovr: { 0: 'acc' } })]], run, 'r8k2m4q1_20261115', NOW, 2).length, 0, 'הבעיה בוטלה בערעור');
  });
  it('צילום אימות: הבעיה נעלמה – ok; עדיין קיימת – rej; לא בטוח – sent; משימה ידנית – sent; לא קריא – null', () => {
    const f = { iks: [0], run: 'r8k2m4q1_20261115' };
    assert.equal(X.verifyResult(f, ['hole'], { st: 'ok', iss: [] }), 'ok');
    assert.equal(X.verifyResult(f, ['hole'], { st: 'issue', iss: [I('hole')] }), 'rej');
    assert.equal(X.verifyResult(f, ['hole'], { st: 'issue', iss: [I('fallen')] }), 'ok', 'בעיה אחרת – המשימה הזו תוקנה');
    assert.equal(X.verifyResult(f, ['hole'], { st: 'review', iss: [I('hole', { warn: true, conf: 0.4 })] }), 'sent');
    assert.equal(X.verifyResult({ iks: [], man: 'לסדר' }, [], { st: 'ok', iss: [] }), 'sent');
    assert.equal(X.verifyResult(f, ['hole'], { st: 'person', iss: [] }), null);
    assert.equal(X.verifyResult(f, ['hole'], { st: 'bad', iss: [] }), null);
  });
});

describe('store3d-extra: ביצועי עובדים לחודש', () => {
  const R = X.monthRange(Date.UTC(2026, 10, 14, 12));
  it('חודש לפי שעון ישראל', () => {
    assert.equal(R.key, '2026-11');
    assert.equal(R.start, Date.UTC(2026, 9, 31, 22), '1.11 00:00 בישראל = 31.10 22:00 UTC');
    assert.equal(R.end, Date.UTC(2026, 10, 30, 22));
    assert.equal(X.monthRange(Date.UTC(2026, 11, 20)).end, Date.UTC(2026, 11, 31, 22), 'דצמבר → ינואר');
  });
  it('סבבים, זמנים, הפסקות, צילומים, תיקונים וערעורים; עובד שעזב נשאר; מחוץ לחודש / יזום / מבוטל – לא בסבבים', () => {
    const t = R.start + D1;
    const run = { st: 'closed', k: 'sched', doneAt: t + 5 * D1, dueAt: t + 2 * D1, nUid: { u_emp001: { n: 4, d: 4 }, u_left01: { n: 2, d: 1 }, u_zero01: { n: 0, d: 0 } },
      tlog: { u_emp001: [{ k: 's', t }, { k: 'p', t: t + 1 }, { k: 'r', t: t + 2 }, { k: 'e', t: t + 3 }], u_left01: [{ k: 's', t }] }, work: { u_emp001: 40, u_left01: 10 }, pause: { u_emp001: 5 } };
    const runs = [{ id: 'a', d: run, ph: [{ by: 'u_emp001', rt: 2 }, { by: 'u_emp001', rt: 0 }, { by: 'u_left01', rt: 1, person: true }] },
      { id: 'b', d: Object.assign({}, run, { doneAt: R.end + 1 }), ph: [{ by: 'u_emp001', rt: 9 }] },
      { id: 'c', d: { st: 'done', k: 'adhoc', doneAt: t, nUid: { u_emp001: { n: 1, d: 1 } } }, ph: [{ by: 'u_emp001', rt: 0 }] },
      { id: 'd', d: Object.assign({}, run, { st: 'cancel' }), ph: [] }];
    const fixes = [{ u: 'u_emp001', st: 'ok', doneAt: t }, { u: 'u_emp001', st: 'rej', doneAt: t }, { u: 'u_emp001', st: 'ok', doneAt: R.start - 1 }];
    const apps = [{ by: 'u_left01', st: 'acc', at: t }, { by: 'u_left01', st: 'rej', at: t }, { by: 'u_left01', st: 'open', at: t }];
    const P = X.perfAll(R, runs, fixes, apps);
    assert.deepEqual(Object.keys(P).sort(), ['u_emp001', 'u_left01']);
    assert.deepEqual(P.u_emp001, { runs: 1, onTime: 1, late: 0, work: 40, pause: 5, pauses: 1, photos: 3, retakes: 2, fixOk: 1, fixRej: 1, appeals: 0, appAcc: 0 });
    assert.deepEqual(P.u_left01, { runs: 1, onTime: 0, late: 1, work: 10, pause: 0, pauses: 0, photos: 1, retakes: 1, fixOk: 0, fixRej: 0, appeals: 3, appAcc: 1 });
    const lateEnd = Object.assign({}, run, { st: 'done', tlog: { u_emp001: [{ k: 's', t }, { k: 'e', t: run.dueAt + 1 }] } });
    const early = X.perfAll(R, [{ id: 'a', d: lateEnd, ph: [] }], [], []);
    assert.deepEqual([early.u_emp001.onTime, early.u_left01.onTime], [0, 1], 'סיום אחרי המועד = איחור; בלי סיום וסבב בזמן = בזמן');
  });
});

describe('store3d-extra: ניקוי – 3 סבבים אחרונים, סל מחזור 30 יום, טקסטורות יתומות', () => {
  const P = 'b/biz-x/store3d/main/run/';
  const F = (run, slot, n, t, th) => ({ name: `${P}${run}/${slot}_${n}${th ? '_t' : ''}.jpg`, t });
  it('נשמרים הקבצים של 3 הסבבים האחרונים לכל מקום צילום; ישנים יותר נמחקים; קובץ מהיום האחרון לא נבחר', () => {
    const files = [];
    for (let i = 1; i <= 5; i++) { files.push(F(`r8k2m4q1_2026110${i}`, 'f1-a-1_a', 1, NOW - (10 - i) * D1), F(`r8k2m4q1_2026110${i}`, 'f1-a-1_a', 1, NOW - (10 - i) * D1, 1)); }
    files.push(F('r8k2m4q1_20261101', 'f2-a-1_a', 1, NOW - 9 * D1), F('r8k2m4q1_20261101', 'f2-a-1_a', 1, NOW - 9 * D1, 1));
    files.push({ name: P + 'r8k2m4q1_20261101/readme.txt', t: 0 });
    const RM = {}; for (let i = 1; i <= 5; i++) RM[`r8k2m4q1_2026110${i}`] = 's-main';
    const plan = X.keepPlan(files, NOW, 3, RM);
    assert.deepEqual(plan.drop.map((d) => [d.runId, d.slot, d.names.length]), [['r8k2m4q1_20261102', 'f1-a-1_a', 2], ['r8k2m4q1_20261101', 'f1-a-1_a', 2]]);
    const young = [1, 2, 3, 4].map((i) => F(`r8k2m4q1_2026110${i}`, 'f1-a-1_a', 1, NOW - i * 3600000));
    assert.deepEqual(X.keepPlan(young, NOW, 3, RM).drop, [], 'כל הקבצים מהיממה האחרונה');
    assert.deepEqual(X.keepPlan(files, NOW, 3, {}).drop, [], 'סבב בלי מפה ידועה – לא נמחק');
  });
  it('תיקון סבב 1: חנות ומחסן של אותו סניף עם אותו מקום צילום – כל אחד שומר 3 סבבים משלו', () => {
    const files = [], RM = {};
    // 3 סבבי חנות ישנים, ואחריהם 3 סבבי מחסן חדשים יותר – כולם f1-a-1_a בתיקיית run/ המשותפת
    for (let i = 1; i <= 6; i++) {
      const id = `r8k2m4q1_2026110${i}`;
      RM[id] = i <= 3 ? 's-main' : 'w-main';
      files.push(F(id, 'f1-a-1_a', 1, NOW - (10 - i) * D1), F(id, 'f1-a-1_a', 1, NOW - (10 - i) * D1, 1));
    }
    assert.deepEqual(X.keepPlan(files, NOW, 3, RM).drop, [], 'אף סבב לא נמחק');
    files.push(F('r8k2m4q1_20261107', 'f1-a-1_a', 1, NOW - 2 * D1), F('r8k2m4q1_20261107', 'f1-a-1_a', 1, NOW - 2 * D1, 1));
    RM.r8k2m4q1_20261107 = 's-main';
    assert.deepEqual(X.keepPlan(files, NOW, 3, RM).drop.map((d) => d.runId), ['r8k2m4q1_20261101'], 'סבב רביעי בחנות – רק הישן של החנות');
  });
  it('החלטת מתאם: דיווחים יזומים בשמירה נפרדת – לא דוחקים החוצה תמונות של סבבים', () => {
    const files = [], RM = {};
    for (let i = 1; i <= 3; i++) { const id = `r8k2m4q1_2026110${i}`; RM[id] = 's-main'; files.push(F(id, 'f1-a-1_a', 1, NOW - (20 - i) * D1)); }
    const ads = [1, 2, 3, 4, 5].map((i) => `ad_q${i}xxxxxxxxxxxxxxxxx`);
    ads.forEach((id, i) => { RM[id] = 's-main'; files.push(F(id, 'f1-a-1_a', 1, NOW - (10 - i) * D1)); });
    assert.deepEqual(X.keepPlan(files, NOW, 3, RM).drop.map((d) => d.runId), [ads[1], ads[0]], '3 הסבבים נשארו; מהיזומים – 3 האחרונים');
  });
  it('קבצים תועים: לא ph.p ולא ph.th, ישנים מיום', () => {
    const L = [F('r8k2m4q1_20261101', 'f1-a-1_a', 1, NOW - 2 * D1), F('r8k2m4q1_20261101', 'f1-a-1_a', 2, NOW - 2 * D1), F('r8k2m4q1_20261101', 'f1-a-1_a', 2, NOW - 2 * D1, 1), F('r8k2m4q1_20261101', 'f1-a-1_a', 3, NOW)];
    assert.deepEqual(X.strayFiles(L, { p: L[1].name, th: L[2].name }, NOW), [L[0].name]);
  });
  it('סל המחזור: נמחק סופית רק פריט עם del:1 ש-delAt לפני 30 יום ומעלה; פריט חי ופריט שנמחק לאחרונה נשארים', () => {
    const map = { v: 4, ent: 'd2', rooms: [{ id: 'r1' }], doors: [{ id: 'd1', del: 1, delAt: NOW - 31 * D1, delBy: 'u_mgr001' }, { id: 'd2' }],
      fx: [{ id: 'f1' }, { id: 'f2', del: 1, delAt: NOW - 30 * D1, delBy: 'u_mgr001' }, { id: 'f3', del: 1, delAt: NOW - 29 * D1, delBy: 'u_mgr001' }, { id: 'f4', delAt: NOW - 99 * D1 }, { id: 'f5', del: 1 }],
      tx: [{ id: 't1', path: 'x', del: 1, delAt: NOW - 40 * D1, delBy: 'u_mgr001' }] };
    const r = X.binPurge(map, NOW);
    assert.equal(r.n, 3);
    assert.deepEqual(r.purged, { doors: ['d1'], fx: ['f2'], tx: ['t1'] });
    assert.deepEqual(r.map.fx.map((f) => f.id), ['f1', 'f3', 'f4', 'f5'], 'חי, נמחק לאחרונה, בלי del, בלי delAt – נשארים');
    assert.deepEqual([r.map.ent, r.map.rooms, r.map.v], ['d2', [{ id: 'r1' }], 4]);
    assert.deepEqual(X.binPurge({ fx: [{ id: 'f1' }, { id: 'f3', del: 1, delAt: NOW - D1 }] }, NOW), { map: null, purged: {}, n: 0 });
    assert.equal(X.expired({ del: 1, delAt: NOW - 31 * D1 }, NOW), true);
    assert.equal(X.expired({ del: 0, delAt: NOW - 31 * D1 }, NOW), false);
  });
  it('טקסטורות יתומות: לא במפה ולא בגרסה, בנות 30 יום ומעלה', () => {
    const T = 'b/biz-x/store3d/main/tex/s-main/';
    const files = [{ name: T + 't1_1.jpg', t: NOW - 90 * D1 }, { name: T + 't2_1.jpg', t: NOW - 90 * D1 }, { name: T + 't3_1.jpg', t: NOW - 90 * D1 }, { name: T + 't4_1.jpg', t: NOW - 5 * D1 }, { name: T + 'x.png', t: 0 }];
    const refs = new Set(X.txPaths({ tx: [{ id: 't1', path: T + 't1_1.jpg', del: 1 }] }).concat(X.txPaths({ tx: [{ id: 't2', path: T + 't2_1.jpg' }] })));
    assert.deepEqual(X.texOrphans(files, refs, new Map(), NOW), [T + 't3_1.jpg'], 't1, t2 מופנות');
    assert.deepEqual(X.texOrphans(files, new Set([T + 't1_1.jpg']), new Map(), NOW), [T + 't2_1.jpg', T + 't3_1.jpg'], 'בלי גרסה – לפי זמן היצירה');
    const lu = new Map([[T + 't2_1.jpg', NOW - 10 * D1]]);
    assert.deepEqual(X.texOrphans(files, new Set([T + 't1_1.jpg']), lu, NOW), [T + 't3_1.jpg'], 't2 הופיעה בגרסה שהוחלפה לפני 10 ימים – נשארת');
    lu.set(T + 't2_1.jpg', NOW - 31 * D1);
    assert.deepEqual(X.texOrphans(files, new Set([T + 't1_1.jpg']), lu, NOW), [T + 't2_1.jpg', T + 't3_1.jpg']);
  });
  it('תיקון סבב 1: טקסטורה שחדר שנשאר מפנה אליה לא נמחקת מסל המחזור; split של audit בלי חיתוך', () => {
    const old = { del: 1, delAt: NOW - 40 * D1, delBy: 'u_mgr001' };
    const map = { rooms: [{ id: 'r1', tex: { w: 't1' } }, Object.assign({ id: 'r2', tex: { f: 't2' } }, old, { delAt: NOW - 5 * D1 }), Object.assign({ id: 'r3', tex: { c: 't3' } }, old)],
      tx: ['t1', 't2', 't3', 't4'].map((id) => Object.assign({ id, path: id }, old)) };
    const r = X.binPurge(map, NOW);
    assert.deepEqual(r.purged, { rooms: ['r3'], tx: ['t3', 't4'] }, 't1 מחדר חי, t2 מחדר בסל שעוד לא נמחק – נשארות');
    const parts = X.splitNote(['a'.repeat(60), 'b'.repeat(60), 'c'.repeat(130)], 100);
    assert.deepEqual(parts.map((x) => x.length), [60, 60, 100, 30]);
    assert.equal(parts.join('').replace(/ \| /g, '').length, 250, 'שום תו לא נחתך');
  });
});

describe('שלב 13ב – סיכום למזכירה (secLatest / secText)', () => {
  const sum = (score, o) => Object.assign({ score, nOk: 5, nIss: 3, nRev: 1, nMiss: 2, nBad: 0, cat: { p: 55, h: 90, o: 69, d: 100 }, prev: '', dScore: 0 }, o);
  const L = [
    ['a_1', { st: 'done', br: 'main', map: 's-main', doneAt: NOW - D1, sum: sum(78, { prev: 'a_0', dScore: 4 }) }],
    ['a_0', { st: 'closed', br: 'main', map: 's-main', doneAt: NOW - 8 * D1, sum: sum(74) }],
    ['w_1', { st: 'done', br: 'main', map: 'w-main', doneAt: NOW - 2 * D1, sum: sum(90, { cat: { p: 90, h: 90, o: 90, d: 90 } }) }],
    ['n_1', { st: 'done', br: 'north', map: 's-north', doneAt: NOW - 3 * D1, sum: sum(60) }],
    ['ad', { st: 'done', k: 'adhoc', br: 'main', map: 's-main', doneAt: NOW, sum: sum(5) }],
    ['c_1', { st: 'cancel', br: 'main', map: 's-main', doneAt: NOW, sum: sum(6) }],
    ['x_1', { st: 'done', br: 'main', map: 's-main', doneAt: NOW, sum: { score: 'x' } }],
    ['b_1', { st: 'done', br: 'BAD!', map: 's-bad', doneAt: NOW, sum: sum(7) }],
  ];
  it('secLatest: הסבב האחרון שהסתיים לכל מפה, בלי יזום/מבוטל/בלי ציון/סניף לא תקין; לפי הסניפים המותרים', () => {
    assert.deepEqual(X.secLatest(L, null).map((x) => x[0]), ['a_1', 'w_1', 'n_1']);
    assert.deepEqual(X.secLatest(L, ['north']).map((x) => x[0]), ['n_1']);
    assert.deepEqual(X.secLatest(L, []).map((x) => x[0]), []);
    const many = Array.from({ length: 10 }, (_, i) => ['m' + i, { st: 'done', br: 'main', map: 's-m' + i, doneAt: NOW - i, sum: sum(50) }]);
    assert.equal(X.secLatest(many, null).length, X.SEC_MAPS);
  });
  it('secText: ציון, שינוי, בעיות, קטגוריות חלשות (מתחת ל-70), חוסרים, משימות תיקון פתוחות בסניפים המותרים; אין נתונים – null', () => {
    const fixes = [{ br: 'main', st: 'open' }, { br: 'north', st: 'rej' }, { br: 'main', st: 'ok' }, { br: 'main', st: 'sent' }];
    const t = X.secText(X.secLatest(L, ['main']), fixes, { a_1: { items: [1, 2, 3], st: 'draft' } }, ['main']);
    assert.match(t.text, /בסניפים שלך/);
    assert.match(t.text, /חנות, סניף main, .*ציון 78 מתוך 100 \(\+4 מהסבב הקודם\); מקומות עם בעיה 3, לבדיקה 1, לא צולמו 2; קטגוריות חלשות: מחירים 55, סדר וחזית 69; רשימת חוסרים: 3 פריטים \(ממתינה לאישור\)\./);
    assert.match(t.text, /מחסן, סניף main, .*ציון 90 מתוך 100; מקומות/);
    assert.match(t.text, /משימות תיקון פתוחות: 2\./);
    assert.ok(!t.text.includes('north') && !t.text.includes('60'));
    assert.equal(t.at, NOW - D1);
    assert.ok(t.text.length < 700, 'קצר: ' + t.text.length);
    assert.equal(X.secText([], [], {}, null), null);
    assert.equal(X.secText([], [{ br: 'north', st: 'open' }], {}, ['main']), null, 'משימה בסניף אחר לא נספרת');
    assert.match(X.secText([], [{ br: 'main', st: 'open' }], {}, null).text, /משימות תיקון פתוחות: 1\./);
  });
  it('תיקון סבב 2: ספירה כמספר (count), סימון "חלקי", והבהרה למנהל מוגבל שמותר לענות', () => {
    const t = X.secText(X.secLatest(L, ['main']), 5, {}, ['main'], true);
    assert.match(t.text, /משימות תיקון פתוחות: 5\./);
    assert.match(t.text, /ייתכן שהסיכום חלקי/);
    assert.match(t.text, /מותר לענות עליהם/);
    const u = X.secText(X.secLatest(L, null), 0, {}, null, false);
    assert.ok(!/חלקי|מותר לענות/.test(u.text), 'מנהל בלי הגבלה, לא חלקי – בלי התוספות');
    assert.equal(X.secText([], 0, {}, null), null);
    assert.equal(X.secText([], -3, {}, null), null);
  });
});

describe('תיקון סבב 3 – secPlan: כל שאילתה עד 30 צירופים של in', () => {
  const brs = (n) => Array.from({ length: n }, (_, i) => 'b' + i);
  const combos = (st, g) => (st ? st.length : 1) * (g ? g.length : 1);
  it('כל העסק – שאילתה אחת לכל סוג, בלי br', () => {
    assert.deepEqual(X.secPlan(null), { runs: [null], fix: [null], cut: false });
  });
  for (const n of [1, 10, 11, 30, 31, 60]) {
    it(`מנהל עם ${n} סניפים – כל הסניפים מכוסים, ובכל שאילתה עד 30 צירופים`, () => {
      const p = X.secPlan(brs(n));
      assert.deepEqual(p.runs.flat(), brs(n)); assert.deepEqual(p.fix.flat(), brs(n));
      assert.ok(p.runs.every((g) => combos(null, g) <= 30), 'סבבים');
      assert.ok(p.fix.every((g) => combos(X.SEC_FIX, g) <= 30), 'משימות: st in × br in');
      assert.equal(p.cut, false);
    });
  }
  it('יותר מ-SEC_BRS סניפים – נחתך ומסומן cut; כפילויות וסניף לא תקין מסוננים; ריק – אין שאילתות', () => {
    const p = X.secPlan(brs(X.SEC_BRS + 5));
    assert.equal(p.runs.flat().length, X.SEC_BRS); assert.equal(p.cut, true);
    assert.deepEqual(X.secPlan(['main', 'main', 'BAD!', 7]).fix, [['main']]);
    assert.deepEqual(X.secPlan([]), { runs: [], fix: [], cut: false });
  });
});
