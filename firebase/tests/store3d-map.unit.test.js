'use strict';
// סריקת חנות בתלת מימד – שלב 5ב (14.11.2026): בדיקות יחידה בלי אמולטור ל-functions/lib/store3d-map.js
//   תקינות המפה (חוזה 4.3), נעילה לפי baseV, הרשאות מחיקה (מנהל בלבד), גודל מרבי, גרסאות (30 אחרונות), סניפים, טקסטורה.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const M = require(path.join(__dirname, '..', 'functions', 'lib', 'store3d-map.js'));
const BIZ = 'biz-s3a', MID = 's-main';
const MGR = { mgr: true, uid: 's3_mgr1', now: 1800000000000 };
const EMP = { mgr: false, uid: 's3_emp1', now: 1800000000000 };
const fx = (id, o) => Object.assign({ id, k: 'gon', x: 300, y: 300, w: 200, d: 60, h: 180, a: 0, sides: 1, bays: 2, lvl: 5, hi: false, room: 'r1', num: 1 }, o);
const room = (id, o) => Object.assign({ id, name: 'אולם', p: [0, 0, 1000, 0, 1000, 1000, 0, 1000], h: 300 }, o);
const MAP = (o) => Object.assign({ br: 'main', kind: 's', name: 'החנות', seq: 2, grid: 50, numDir: 'rtl', src: 'manual',
  rooms: [room('r1')], walls: [], cols: [], doors: [{ id: 'd1', x: 0, y: 500, w: 180, a: 0, k: 'ent' }], fx: [fx('f1'), fx('f2', { x: 600 })], syms: [], ent: 'd1' }, o);
const clean = (m, mapId) => M.cleanMap(m, { bizId: BIZ, mapId: mapId || MID });
const code = (fn) => { try { fn(); } catch (e) { return e.code; } return 'OK'; };
const msg = (fn) => { try { fn(); } catch (e) { return e.message; } return ''; };
// מפה שמורה (כמו שהשרת כתב): v, upd, by
const SAVED = (o) => Object.assign(clean(MAP()).map, { v: 4, upd: 1790000000000, by: 's3_mgr1' }, o);

describe('store3d-map: תקינות המפה (cleanMap)', () => {
  it('מפה תקינה עוברת; v/upd/by מהלקוח לא נשמרים; br ו-kind נגזרים ממזהה המפה', () => {
    const r = clean(Object.assign(MAP(), { v: 99, upd: 1, by: 'hacker1' }));
    assert.equal(r.map.v, undefined); assert.equal(r.map.upd, undefined); assert.equal(r.map.by, undefined);
    assert.deepEqual([r.map.br, r.map.kind, r.map.fx.length, r.map.ent], ['main', 's', 2, 'd1']);
    assert.deepEqual(r.dropped, []);
  });
  it('שדות לא מוכרים לא נשמרים ונרשמים ב-dropped (למשל זווית לעמוד, שדה עליון זר)', () => {
    const r = clean(MAP({ foo: 1, cols: [{ id: 'c1', x: 10, y: 10, w: 40, d: 40, rnd: false, a: 90 }] }));
    assert.deepEqual(r.map.cols, [{ id: 'c1', x: 10, y: 10, w: 40, d: 40, rnd: false }]);
    assert.deepEqual(r.dropped.sort(), ['cols.a', 'foo']);
    assert.equal(r.map.foo, undefined);
  });
  it('אי התאמה למזהה המפה, שדות חובה, גבולות, סוגים – נדחים עם הודעה בעברית', () => {
    assert.equal(code(() => clean(MAP({ br: 'other' }))), 'bad-map');
    assert.equal(code(() => clean(MAP({ kind: 'w' }))), 'bad-map');
    assert.equal(code(() => clean(MAP(), 'w-main')), 'bad-map', 'kind s במזהה w-');
    assert.equal(code(() => clean(MAP({ name: '' }))), 'bad-map');
    assert.equal(code(() => clean(MAP({ grid: 30 }))), 'bad-map');
    assert.equal(code(() => clean(MAP({ numDir: 'up' }))), 'bad-map');
    assert.equal(code(() => clean(MAP({ fx: [fx('f1', { w: 5 })] }))), 'bad-map');
    assert.equal(code(() => clean(MAP({ fx: [fx('f1', { k: 'fridge', sides: 2 })] }))), 'bad-map', 'מקרר עם שני צדדים');
    assert.equal(code(() => clean(MAP({ fx: [fx('f1'), fx('f1')] }))), 'bad-map', 'מזהה כפול');
    assert.equal(code(() => clean(MAP({ fx: [fx('x1')] }))), 'bad-map');
    assert.equal(code(() => clean(MAP({ rooms: [room('r1', { h: 100 })] }))), 'bad-map');
    assert.equal(code(() => clean(MAP({ rooms: [room('r1', { p: [0, 0, 10, 0] })] }))), 'bad-map');
    assert.equal(code(() => clean(MAP({ walls: [{ id: 'w1', p: [0, 0, 100], t: 10 }] }))), 'bad-map');
    assert.equal(code(() => clean(MAP({ doors: [{ id: 'd1', x: 0, y: 0, w: 30, a: 0, k: 'ent' }] }))), 'bad-map');
    assert.equal(code(() => clean(MAP({ fx: [fx('f1', { del: 2 })] }))), 'bad-map');
    assert.equal(code(() => clean(null)), 'bad-map');
    assert.match(msg(() => clean(MAP({ name: '' }))), /^המפה לא תקינה: /);
  });
  it('טקסטורות: נתיב חייב להיות של אותו עסק, סניף ומפה, ומידות 256/512/1024', () => {
    const ok = `b/${BIZ}/store3d/main/tex/${MID}/t3_1.jpg`;
    assert.equal(clean(MAP({ tx: [{ id: 't3', path: ok, w: 512, h: 512 }] })).map.tx.length, 1);
    assert.equal(code(() => clean(MAP({ tx: [{ id: 't3', path: `b/other/store3d/main/tex/${MID}/t3_1.jpg`, w: 512, h: 512 }] }))), 'bad-map');
    assert.equal(code(() => clean(MAP({ tx: [{ id: 't3', path: `b/${BIZ}/store3d/main/tex/w-main/t3_1.jpg`, w: 512, h: 512 }] }))), 'bad-map');
    assert.equal(code(() => clean(MAP({ tx: [{ id: 't3', path: ok + '/../x.jpg', w: 512, h: 512 }] }))), 'bad-map');
    assert.equal(code(() => clean(MAP({ tx: [{ id: 't3', path: ok, w: 300, h: 512 }] }))), 'bad-map');
    assert.equal(code(() => clean(MAP({ rooms: [room('r1', { tex: { w: 'bad' } })] }))), 'bad-map');
  });
});

describe('store3d-map: מחיקה וסל מחזור (mergeDel) – מנהל בלבד', () => {
  it('עובד עם s3m: עריכה והוספה – מותר; מחיקה, שחזור, הסרת פריט שמור או מחיקת המפה – נחסם', () => {
    const old = SAVED();
    const edit = clean(MAP({ fx: [fx('f1', { x: 400 }), fx('f2', { x: 600 }), fx('f3', { x: 800 })] })).map;
    assert.equal(M.mergeDel(old, edit, EMP).fx.length, 3);
    assert.equal(code(() => M.mergeDel(old, clean(MAP({ fx: [fx('f1', { del: 1 }), fx('f2', { x: 600 })] })).map, EMP)), 'del-mgr');
    assert.equal(code(() => M.mergeDel(old, clean(MAP({ fx: [fx('f1')] })).map, EMP)), 'del-mgr', 'הסרה מהרשימה = מחיקה');
    assert.equal(code(() => M.mergeDel(old, clean(MAP({ del: 1 })).map, EMP)), 'del-mgr');
    assert.equal(code(() => M.mergeDel(old, clean(MAP({ fx: [fx('f1'), fx('f2', { x: 600 }), fx('f9', { del: 1 })] })).map, EMP)), 'del-mgr', 'פריט חדש שמסומן מחוק');
    const oldDel = SAVED({ fx: [fx('f1'), Object.assign(fx('f2'), { del: 1, delAt: 1790000000000, delBy: 's3_mgr1' })] });
    assert.equal(code(() => M.mergeDel(oldDel, clean(MAP()).map, EMP)), 'del-mgr', 'שחזור מסל המחזור');
    assert.equal(M.mergeDel(oldDel, clean(MAP({ fx: [fx('f1', { x: 900 }), fx('f2', { del: 1 })] })).map, EMP).fx[1].delAt, 1790000000000, 'פריט מחוק נשאר מחוק – מותר');
  });
  it('מנהל: מחיקה = del:1 עם delAt/delBy שהשרת קובע (לא של הלקוח); פריט שמחוק כבר שומר את הזמן המקורי; שחזור מוחק את del*', () => {
    const old = SAVED();
    const c = MAP({ fx: [Object.assign(fx('f1'), { del: 1, delAt: 5, delBy: 'fake_user' }), fx('f2', { x: 600 })] });
    const m = M.mergeDel(old, clean(c).map, MGR);
    assert.deepEqual([m.fx[0].del, m.fx[0].delAt, m.fx[0].delBy], [1, MGR.now, MGR.uid]);
    assert.equal('del' in m.fx[1], false);
    const m2 = M.mergeDel(m, clean(MAP({ fx: [fx('f1', { del: 1 }), fx('f2', { x: 600 })] })).map, Object.assign({}, MGR, { now: MGR.now + 1000 }));
    assert.equal(m2.fx[0].delAt, MGR.now, 'זמן המחיקה המקורי');
    const m3 = M.mergeDel(m, clean(MAP({ fx: [fx('f1', { del: 0 }), fx('f2', { x: 600 })] })).map, MGR);
    assert.deepEqual(Object.keys(m3.fx[0]).filter((k) => k.startsWith('del')), []);
  });
  it('מנהל: פריט שמור שחסר (למשל בשחזור גרסה ישנה) – לא נעלם, נשמר כמחוק', () => {
    const old = SAVED();
    const m = M.mergeDel(old, clean(MAP({ fx: [fx('f1')] })).map, MGR);
    assert.deepEqual(m.fx.map((f) => [f.id, f.del || 0]), [['f1', 0], ['f2', 1]]);
    assert.equal(m.fx[1].delBy, MGR.uid);
  });
  it('מחיקת מפה שלמה – מנהל; delAt/delBy של השרת', () => {
    const m = M.mergeDel(SAVED(), clean(MAP({ del: 1, delAt: 1, delBy: 'x' })).map, MGR);
    assert.deepEqual([m.del, m.delAt, m.delBy], [1, MGR.now, MGR.uid]);
  });
});

describe('store3d-map: בדיקות אחרי המיזוג (finalCheck)', () => {
  it('חדר חי אחד לפחות; מצולע חוצה את עצמו / קטן ממ"ר; גוף בחדר שנמחק – נדחים', () => {
    assert.equal(code(() => M.finalCheck(clean(MAP({ rooms: [room('r1', { del: 1 })], fx: [] })).map, null)), 'bad-map');
    assert.equal(code(() => M.finalCheck(clean(MAP({ rooms: [room('r1', { p: [0, 0, 1000, 1000, 1000, 0, 0, 1000] })] })).map, null)), 'bad-map', 'שעון חול');
    assert.equal(code(() => M.finalCheck(clean(MAP({ rooms: [room('r1', { p: [0, 0, 90, 0, 90, 90, 0, 90] })], fx: [] })).map, null)), 'bad-map', 'פחות ממ"ר');
    assert.equal(code(() => M.finalCheck(clean(MAP({ rooms: [room('r1'), room('r2', { del: 1 })], fx: [fx('f1', { room: 'r2' })] })).map, null)), 'bad-map');
    assert.equal(code(() => M.finalCheck(clean(MAP({ fx: [fx('f1', { room: 'r2', del: 1 })] })).map, null)), 'OK', 'גוף מחוק לא נבדק');
  });
  it('עד 2000 מקטעים; עד 400 גופים', () => {
    const many = Array.from({ length: 34 }, (_, i) => fx('f' + (i + 1), { sides: 2, bays: 30 }));
    assert.equal(M.bayCount({ fx: many }), 2040);
    assert.equal(code(() => M.finalCheck(clean(MAP({ fx: many })).map, null)), 'bad-map');
    const tooMany = Array.from({ length: 401 }, (_, i) => fx('f' + (i + 1), { bays: 1 }));
    assert.equal(code(() => M.finalCheck(clean(MAP({ fx: tooMany })).map, null)), 'bad-map');
  });
  it('seq של הלקוח לא נקרא; גוף חדש מחוץ ל-oseq+1..oseq+400 מקבל מזהה חדש (renamed); ent לדלת שלא קיימת או מחוקה – לא נשמר', () => {
    const old = SAVED({ seq: 5 });
    const a = M.finalCheck(M.mergeDel(old, clean(MAP({ seq: 9999, fx: [fx('f1'), fx('f2'), fx('f4')] })).map, MGR), old);
    assert.deepEqual([a.map.seq, a.renamed], [6, { f4: 'f6' }], 'f4 <= oseq – מזהה חדש');
    assert.deepEqual(a.map.fx.map((f) => f.id), ['f1', 'f2', 'f6']);
    const b = M.finalCheck(clean(MAP({ fx: [fx('f1'), fx('f2'), fx('f6')] })).map, old);
    assert.deepEqual([b.map.seq, b.renamed], [6, {}]);
    const c = M.finalCheck(clean(MAP({ fx: [fx('f1'), fx('f2'), fx('f405'), fx('f406'), fx('f9999')] })).map, old);
    // שלב 10: הטווח = מספר הגופים החדשים (3) ולא 400 – seq עולה רק לפי גופים שנוספו בפועל
    assert.deepEqual([c.renamed, c.map.seq, c.map.fx.map((f) => f.id)], [{ f405: 'f6', f406: 'f7', f9999: 'f8' }, 8, ['f1', 'f2', 'f6', 'f7', 'f8']], 'שלושה גופים חדשים – f6..f8');
    const d = M.finalCheck(clean(MAP({ fx: [fx('f1'), fx('f2'), fx('f8'), fx('f7'), fx('f9999')] })).map, old);
    assert.deepEqual([d.renamed, d.map.seq], [{ f9999: 'f6' }, 8], 'f7, f8 בטווח (5+3); f9999 – המזהה הפנוי f6');
    assert.equal(M.finalCheck(clean(MAP({ seq: 1 })).map, null).map.seq, 2, 'seq לפחות כמו המזהה הגבוה');
    assert.equal(M.finalCheck(clean(MAP({ ent: 'd7' })).map, null).map.ent, undefined);
    assert.equal(M.finalCheck(clean(MAP({ doors: [{ id: 'd1', x: 0, y: 500, w: 180, a: 0, k: 'ent', del: 1 }] })).map, null).map.ent, undefined, 'דלת מחוקה');
    assert.equal(M.finalCheck(clean(MAP()).map, null).map.ent, 'd1');
  });
  it('שלב 10: עובד עם s3m לא יכול להקפיץ את seq – מזהה f(oseq+400) עם גוף חדש אחד מקדם את seq ב-1 בלבד; 25 שמירות כאלה = +25', () => {
    let old = SAVED();
    for (let i = 0; i < 25; i++) {
      const o = Number.isInteger(old.seq) ? old.seq : 2;
      const L = old.fx.concat([fx('f' + (o + 400), { x: 100 + (i % 9) * 100, y: 100 + Math.floor(i / 9) * 100 })]);
      const e = M.finalCheck(M.mergeDel(old, clean(MAP({ seq: 9999, fx: L })).map, EMP), old);
      assert.equal(e.map.seq, o + 1);
      old = Object.assign(e.map, { v: (old.v || 1) + 1 });
    }
    assert.equal(old.seq, 27);
  });
  it('התקפת seq: עובד עם s3m שולח seq:9999 ו-f9999 – נשמר עם מזהה תקין; אחריו מנהל מוסיף גוף בהצלחה', () => {
    const old = SAVED();
    const e = M.finalCheck(M.mergeDel(old, clean(MAP({ seq: 9999, fx: [fx('f1'), fx('f2', { x: 600 }), fx('f9999')] })).map, EMP), old);
    assert.deepEqual([e.map.seq, e.renamed], [3, { f9999: 'f3' }]);
    const saved = Object.assign(e.map, { v: 5 });
    const m = M.finalCheck(M.mergeDel(saved, clean(MAP({ fx: [fx('f1'), fx('f2', { x: 600 }), fx('f3'), fx('f4')] })).map, MGR), saved);
    assert.deepEqual([m.map.seq, m.renamed, m.map.fx.length], [4, {}, 4]);
  });
});

describe('store3d-map: מגבלות על פריטים חיים, סל מחזור עם תקרה נפרדת (החלטת מתאם, תיקון סבב 1)', () => {
  const BIG = { id: 'r1', name: 'אולם', p: [0, 0, 9000, 0, 9000, 9000, 0, 9000], h: 300 };
  const fxN = (a, b, o) => Array.from({ length: b - a + 1 }, (_, i) => fx('f' + (a + i), Object.assign({ x: 100 + (i % 80) * 100, y: 100 + Math.floor(i / 80) * 100, bays: 1 }, o)));
  const texP = (id) => `b/${BIZ}/store3d/main/tex/${MID}/${id}_1.jpg`;
  it('מנהל מחליף 300 גופים ב-150 חדשים: נשמר – 150 חיים, 300 בסל המחזור', () => {
    const old = SAVED({ seq: 300, rooms: [BIG], fx: fxN(1, 300) });
    const r = M.finalCheck(M.mergeDel(old, clean(MAP({ rooms: [BIG], fx: fxN(301, 450) })).map, MGR), old);
    assert.equal(r.map.fx.filter((f) => f.del !== 1).length, 150);
    assert.equal(r.map.fx.filter((f) => f.del === 1).length, 300);
    assert.deepEqual([r.map.seq, r.renamed, r.purged], [450, {}, {}]);
  });
  it('שוב: עוד 150 חדשים – 450 בסל, מעל התקרה (400): 50 המחוקים הישנים ביותר (לפי delAt) מוסרים סופית', () => {
    const dead = fxN(1, 300).map((f, i) => Object.assign(f, { del: 1, delAt: 1700000000000 + i, delBy: 's3_mgr1' }));
    const old = SAVED({ seq: 450, rooms: [BIG], fx: dead.concat(fxN(301, 450)) });
    const r = M.finalCheck(M.mergeDel(old, clean(MAP({ rooms: [BIG], fx: dead.concat(fxN(451, 600)) })).map, MGR), old);
    assert.equal(r.map.fx.filter((f) => f.del !== 1).length, 150);
    assert.equal(r.map.fx.filter((f) => f.del === 1).length, 400);
    assert.deepEqual(r.purged.fx, fxN(1, 50).map((f) => f.id), 'הישנים ביותר');
    assert.ok(r.map.fx.every((f) => f.id !== 'f1'));
  });
  it('צילום מחדש של טקסטורה במפה מלאה (60): הישנה לסל, החדשה נכנסת; גם כשהסל מלא – הישנה ביותר בסל מוסרת', () => {
    const tx = Array.from({ length: 60 }, (_, i) => ({ id: 't' + (i + 1), path: texP('t' + (i + 1)), w: 512, h: 512 }));
    const old = SAVED({ tx });
    const next = tx.map((t) => (t.id === 't1' ? Object.assign({}, t, { del: 1 }) : t)).concat([{ id: 't61', path: texP('t61'), w: 512, h: 512 }]);
    const r = M.finalCheck(M.mergeDel(old, clean(MAP({ tx: next })).map, MGR), old);
    assert.deepEqual([r.map.tx.filter((t) => t.del !== 1).length, r.map.tx.filter((t) => t.del === 1).length], [60, 1]);
    const dead = Array.from({ length: 60 }, (_, i) => ({ id: 't' + (100 + i), path: texP('t' + (100 + i)), w: 512, h: 512, del: 1, delAt: 1700000000000 + i, delBy: 's3_mgr1' }));
    const old2 = SAVED({ tx: tx.concat(dead) });
    const r2 = M.finalCheck(M.mergeDel(old2, clean(MAP({ tx: next.concat(dead) })).map, MGR), old2);
    assert.deepEqual([r2.map.tx.filter((t) => t.del !== 1).length, r2.map.tx.filter((t) => t.del === 1).length, r2.purged.tx], [60, 60, ['t100']]);
  });
  it('עדיין: יותר מ-60 טקסטורות חיות / 400 גופים חיים – נדחה', () => {
    const tx = Array.from({ length: 61 }, (_, i) => ({ id: 't' + (i + 1), path: texP('t' + (i + 1)), w: 512, h: 512 }));
    assert.equal(code(() => M.finalCheck(clean(MAP({ tx })).map, null)), 'bad-map');
  });
  it('טקסטורה: המזהה חייב להתאים לנתיב הקובץ', () => {
    assert.equal(code(() => clean(MAP({ tx: [{ id: 't1', path: texP('t7'), w: 512, h: 512 }] }))), 'bad-map');
    assert.equal(code(() => clean(MAP({ tx: [{ id: 't7', path: texP('t7'), w: 512, h: 512 }] }))), 'OK');
  });
  it('תקרת העלאות טקסטורה: ספירה של 24 השעות האחרונות', () => {
    const now = 1800000000000;
    assert.equal(M.recentCount([new Date(now - 1000).toISOString(), new Date(now - 86400000 - 1).toISOString(), now - 5, 'bad', undefined], now), 2);
    assert.equal(M.TEX_DAY, 200);
  });
});

describe('store3d-map: נעילה, גודל, גרסאות', () => {
  it('baseV: מפה חדשה = 0 → v=1; שווה ל-v → v+1; אחר → "המפה השתנתה בטלפון אחר. טענו מחדש."', () => {
    assert.equal(M.checkLock(null, 0), 1);
    assert.equal(M.checkLock({ v: 4 }, 4), 5);
    assert.equal(code(() => M.checkLock({ v: 4 }, 3)), 'stale');
    assert.equal(code(() => M.checkLock(null, 2)), 'stale');
    assert.equal(msg(() => M.checkLock({ v: 4 }, 5)), 'המפה השתנתה בטלפון אחר. טענו מחדש.');
    assert.equal(code(() => M.checkLock({ v: 4 }, '4')), 'bad-base');
    assert.equal(code(() => M.checkLock({ v: 4 })), 'bad-base');
  });
  it('גודל: מפה גדולה מ-800KB מזוהה', () => {
    assert.ok(M.bytesOf(SAVED()) < 2000);
    const big = SAVED({ uz: Array.from({ length: 50 }, () => ({ x: 1, y: 1, w: 50, d: 50, txt: 'א'.repeat(80), ok: false })) });
    assert.ok(M.bytesOf(big) < M.MAX_BYTES);
    assert.ok(M.bytesOf({ s: 'x'.repeat(M.MAX_BYTES) }) > M.MAX_BYTES);
    assert.equal(M.MAX_BYTES, 800000);
  });
  it('גרסה: מזהה 6 ספרות; עותק בלי del* של המפה; why עד 80 תווים', () => {
    assert.equal(M.verId(12), '000012');
    const d = M.verDoc(SAVED({ del: 1, delAt: 1, delBy: 'x' }), { uid: 'u_abc123', now: 7 }, 'שחזור');
    assert.deepEqual([d.v, d.at, d.by, d.why, 'del' in d.m, d.m.v], [4, 7, 'u_abc123', 'שחזור', false, 4]);
    assert.equal(M.verDoc(SAVED(), { uid: 'u_abc123', now: 7 }, 'x'.repeat(200)).why.length, 80);
    assert.equal('why' in M.verDoc(SAVED(), { uid: 'u_abc123', now: 7 }), false);
  });
  it('ניקוי גרסאות: נשארות 30 האחרונות', () => {
    const ids = Array.from({ length: 35 }, (_, i) => M.verId(i + 1));
    assert.deepEqual(M.prune(ids), ['000001', '000002', '000003', '000004', '000005']);
    assert.deepEqual(M.prune(ids.slice(0, 30)), []);
    assert.deepEqual(M.prune(ids.slice(0, 31).reverse()), ['000001']);
    assert.deepEqual(M.prune(['000001', 'zzz']), []);
  });
});

describe('store3d-map: סניפים (s3SetBranch)', () => {
  it('סניפים מ-org.branches (כולל מושבתים); בלי סניפים = main', () => {
    assert.deepEqual(M.branchIds({ branches: [{ id: 'ramat_gan', on: true }, { id: 'bb', on: false }] }), ['ramat_gan', 'bb']);
    assert.deepEqual(M.branchIds(null), ['main']);
    assert.deepEqual(M.branchIds({ branches: [] }), ['main']);
  });
  it('קלט: brId לפי התבנית, wh/on בוליאני, cap 0–100000', () => {
    assert.deepEqual(M.cleanBranch({ brId: 'main', wh: true, cap: 800, on: true }), { brId: 'main', wh: true, cap: 800, on: true });
    assert.equal(code(() => M.cleanBranch({ brId: 'Main!', wh: true, cap: 1, on: true })), 'bad-br');
    assert.equal(code(() => M.cleanBranch({ brId: 'main', wh: 1, cap: 1, on: true })), 'bad-input');
    assert.equal(code(() => M.cleanBranch({ brId: 'main', wh: true, cap: 100001, on: true })), 'bad-cap');
    assert.equal(code(() => M.cleanBranch({ brId: 'main', wh: true, cap: 1.5, on: true })), 'bad-cap');
    assert.deepEqual(M.brCfg(null), { wh: false, cap: 500, on: true });
  });
});

// JPEG מינימלי עם כותרת SOF0 במידות נתונות
function jpeg(w, h, pad) {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.alloc(pad || 0), Buffer.from([0xff, 0xd9])]);
}
describe('store3d-map: טקסטורה (s3PutTex)', () => {
  it('מידות מתוך JPEG; JPEG תקין 512×256 עובר (גם עם התחילית data:)', () => {
    assert.deepEqual(M.jpegSize(jpeg(512, 256)), { w: 512, h: 256 });
    const t = M.decodeTex(jpeg(512, 256).toString('base64'));
    assert.deepEqual([t.w, t.h], [512, 256]);
    assert.equal(M.decodeTex('data:image/jpeg;base64,' + jpeg(1024, 1024).toString('base64')).w, 1024);
  });
  it('לא JPEG / מידות לא חזקת 2 / גדול מ-600,000 בתים / לא base64 / ריק – נדחה', () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]);
    assert.equal(code(() => M.decodeTex(png.toString('base64'))), 'bad-type');
    assert.equal(code(() => M.decodeTex(jpeg(300, 512).toString('base64'))), 'bad-size');
    assert.equal(code(() => M.decodeTex(jpeg(512, 512, M.TEX_MAX).toString('base64'))), 'too-big');
    assert.equal(code(() => M.decodeTex('@@@@')), 'bad-img');
    assert.equal(code(() => M.decodeTex('')), 'bad-img');
    assert.equal(code(() => M.decodeTex(Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64'))), 'bad-img', 'בלי כותרת מידות');
  });
  it('נתיב ומספר הטקסטורה הבא (מהקבצים ומהמפה)', () => {
    assert.equal(M.texPath(BIZ, 'main', MID, 't4', 1), `b/${BIZ}/store3d/main/tex/${MID}/t4_1.jpg`);
    assert.equal(M.nextTexN([], null), 1);
    assert.equal(M.nextTexN([`b/${BIZ}/store3d/main/tex/${MID}/t3_1.jpg`, `b/${BIZ}/store3d/main/tex/${MID}/t12_2.jpg`], [{ id: 't5' }]), 13);
    assert.equal(M.nextTexN([], [{ id: 't7' }, { id: 'bad' }]), 8);
  });
});
