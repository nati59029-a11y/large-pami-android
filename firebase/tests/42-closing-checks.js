'use strict';
// סגירת קופה – שרשרת הבדיקות (17.11): בדיקות 1–4, שורת התוצאה וסף הפער בשקלים.
// הפונקציות נלקחות כמו שהן מ-www/index.html שב-large-pami-android-project.zip (כמו 41-closing-logic), ורצות ב-vm בלי דפדפן ובלי אמולטור:
// zcCalc (e1/d1/d2), zcRes/zcResT (תוצאה עם כיוון), zcThr/zcGap/zcNeed (סף – כבוי כברירת מחדל), zc3 (פתקים), zsDep4 (הפקדות, שתי הקופות יחד).

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { appSourceLines } = require('./helpers');

const PARTS = ['const s_=', 'const rnd=', 'function pNum(', 'var ZPAY=', 'function zcN(', 'function zcCalc(', 'function zcRes(', 'const zcResT=', 'const zcThr=',
  'function zcGap(', 'function zcNeed(', 'function zc3(', 'function dpAiChk(', 'function zsDepAuto(', 'function zsOf(', 'function zsDep4(', 'function zsDep4H('];

function load() {
  const L = appSourceLines();
  const chunks = PARTS.map((p) => {
    const i = L.findIndex((l) => l.startsWith(p));
    if (i < 0) throw new Error('לא נמצא בקוד האפליקציה: ' + p);
    let j = i + 1; while (j < L.length && L[j].startsWith(' ')) j++;
    return L.slice(i, j).join('\n');
  });
  const pre = 'var S={zc:[]};const ils=n=>(Math.round((n||0)*100)/100).toFixed(2),cat=()=>true,zcRegOk=()=>true,zcDup=()=>null,zcNsNeed=()=>[],dfmt=d=>d,esc=t=>String(t);\n';
  const post = '\n;({S,zcCalc,zcRes,zcResT,zcThr,zcGap,zcNeed,zc3,zsDep4,zsDep4H})';
  return vm.runInNewContext(pre + chunks.join('\n') + post, {}, { filename: 'index.html (חלקים)' });
}
// טופס סגירה תקין: סכום השורות = סה"כ, קרן 1500 + 2350 − 1400 = 2450
const F = (o) => Object.assign({ d: '2026-11-17', no: '12', credit: '5820', cash: '2350', checks: '', vbuy: '', vcred: '', vissue: '', house: '', round: '', total: '8170',
  float: '1500', csales: '2350', cout: '1400', drawer: '2450', oTot: '2450', oD: '2026-11-17' }, o);
const need = (M, f, o) => { const c = M.zcCalc(f, 'i_nl'); return [...M.zcNeed(Object.assign({ reg: 'i_nl', f, c, ack: 1, id: 'x' }, o))]; }; // מערך מה-vm → מערך רגיל להשוואה

describe('סגירת קופה – שרשרת הבדיקות (index.html)', () => {
  it('בדיקה 1: קרן + עסקאות מזומן − הוצאה מול המזומן בקופה, עם כיוון ובאגורות', () => {
    const M = load();
    let c = M.zcCalc(F({}), 'i_nl');
    assert.equal(c.e1, 2450); assert.equal(c.d1, 0);
    c = M.zcCalc(F({ drawer: '2405' }), 'i_nl');                       // חוסר 45
    assert.equal(c.e1, 2450); assert.equal(c.d1, -45);
    c = M.zcCalc(F({ drawer: '2450.10' }), 'i_nl');                    // עודף 10 אג'
    assert.equal(c.d1, 0.1);
    c = M.zcCalc(F({ float: '1500.11', csales: '2350.22', cout: '1400.30', drawer: '2450.03' }), 'i_nl');
    assert.equal(c.e1, 2450.03); assert.equal(c.d1, 0);                 // אגורות בלי שגיאת עיגול
    c = M.zcCalc(F({ cout: '-1400' }), 'i_nl');                        // הוצאה שנרשמה במינוס – תמיד בניכוי
    assert.equal(c.e1, 2450); assert.equal(c.d1, 0);
    c = M.zcCalc(F({ csales: '-50', cout: '0', drawer: '1450' }), 'i_nl'); // עסקאות מזומן שליליות (החזרים)
    assert.equal(c.e1, 1450); assert.equal(c.d1, 0);
  });
  it('בדיקה 1: שדה חסר או לא מספר – לא ניתן לבדוק (null), בלי שגיאה', () => {
    const M = load();
    for (const k of ['float', 'csales', 'cout', 'drawer']) {
      const c = M.zcCalc(F({ [k]: '' }), 'i_nl');
      assert.equal(c.d1, null, k); assert.equal(c.e1, null, k);
    }
    assert.equal(M.zcCalc(F({ float: 'abc' }), 'i_nl').d1, null);
    const f = F({}); delete f.float;                                     // השדה לא קיים בכלל
    assert.equal(M.zcCalc(f, 'i_nl').d1, null);
  });
  it('בדיקה 2: הפתיחה הבאה מול המזומן בסגירה, עם כיוון; השדות הקיימים (a, p, lvl) לא השתנו', () => {
    const M = load();
    let c = M.zcCalc(F({ oTot: '2405' }), 'i_nl');
    assert.equal(c.d2, -45); assert.equal(c.a, 45); assert.equal(c.lvl, 1);
    c = M.zcCalc(F({ oTot: '2500' }), 'i_nl');
    assert.equal(c.d2, 50); assert.equal(c.a, 50); assert.equal(c.lvl, 1);
    c = M.zcCalc(F({ oTot: '2000' }), 'i_nl');
    assert.equal(c.d2, -450); assert.equal(c.lvl, 2);
    c = M.zcCalc(F({ oTot: '' }), 'i_nl');
    assert.equal(c.d2, null); assert.equal(c.lvl, null);
    c = M.zcCalc(F({ drawer: '-10', oTot: '0', float: '', csales: '' }), 'i_nl'); // מזומן שלילי בסגירה
    assert.equal(c.d2, 10); assert.equal(c.lvl, 2);
  });
  it('שורת התוצאה: חוסר קודם לעודף; מאוזן; לא ניתן לבדוק; סגירה ישנה בלי d1/d2', () => {
    const M = load();
    const R = (o) => { const r = M.zcRes(M.zcCalc(F(o), 'i_nl')); return r.k + ':' + r.a; };
    assert.equal(R({}), 'inc:0');
    assert.equal(R({ drawer: '2405', oTot: '2405' }), 'bad:45');       // בדיקה 1 חוסר, 2 תואם
    assert.equal(R({ oTot: '2460' }), 'warn:10');                       // עודף בלבד
    assert.equal(R({ drawer: '2460', oTot: '2440' }), 'bad:20');        // עודף 10 בבדיקה 1 + חוסר 20 בבדיקה 2 → חוסר
    assert.equal(R({ oTot: '2449.99' }), 'bad:0.01');                   // אגורה אחת
    assert.equal(R({ drawer: '', oTot: '' }), ':null');
    assert.equal(M.zcResT(M.zcRes(M.zcCalc(F({ oTot: '2405' }), 'i_nl'))), 'חוסר 45.00');
    assert.equal(M.zcResT({ k: '', a: null }), 'לא ניתן לבדוק');
    // סגירה שנשמרה רק במכשיר (בלי d1/d2): מחושב מ-c ו-o
    assert.equal(M.zcRes({ c: 100, o: 90, a: 10 }).k, 'bad');
    assert.equal(M.zcRes({ c: 100, o: null }).k, '');
    assert.equal(M.zcRes(undefined).k, '');
  });
  it('סף בשקלים: כבוי כברירת מחדל ולא משנה כלום; מעל הסף – לאישור מנהל', () => {
    const M = load();
    const f = F({ oTot: '2420' });                                       // חוסר 30, עד 10% – עובד אישר
    assert.equal(M.zcThr(), 0);
    assert.deepEqual(need(M, f), []);                                    // כבוי: כמו קודם
    for (const v of [0, -5, 'abc', NaN, null, '30']) { M.S.zcThr = v; assert.equal(M.zcThr(), 0, String(v)); assert.deepEqual(need(M, f), [], String(v)); }
    M.S.zcThr = 30; assert.deepEqual(need(M, f), []);                    // שווה לסף – לא מעל
    M.S.zcThr = 29.99; assert.equal(need(M, f).length, 1); assert.match(need(M, f)[0], /מעל הסף/);
    M.S.zcThr = 20; assert.match(need(M, F({ oTot: '2475' }))[0], /\(25\.00, הסף 20\.00\)/); // גם עודף
    assert.match(need(M, F({ drawer: '2420', oTot: '2420' }))[0], /\(30\.00,/); // גם בדיקה 1
    // סבב 2: עודף 50 בבדיקה 2 עם חוסר קטן (5) בבדיקה 1 – הסף לפי הגדול בערך מוחלט; שורת התוצאה עדיין מעדיפה חוסר
    const mix = F({ drawer: '2445', oTot: '2495' });
    assert.equal(M.zcGap(M.zcCalc(mix, 'i_nl')), 50); assert.equal(M.zcRes(M.zcCalc(mix, 'i_nl')).k, 'bad');
    assert.equal(need(M, mix).length, 1); assert.match(need(M, mix)[0], /\(50\.00, הסף 20\.00\)/);
    const big = need(M, F({ oTot: '1000' }));                            // מעל 10% – הודעה אחת (הקיימת), בלי כפילות
    assert.equal(big.length, 1); assert.match(big[0], /מעל 10%/);
    assert.deepEqual(need(M, F({ drawer: '', oTot: '' })).filter((m) => /הסף/.test(m)), []); // אין מה לבדוק – אין הודעת סף
    M.S.zcThr = 1000; assert.deepEqual(need(M, f), []);
  });
  it('בדיקה 3: פתקים מול הוצאת המזומן בדוח, עם כיוון; לא ידוע – null', () => {
    const M = load();
    assert.deepEqual({ ...M.zc3({ known: 1, z: 1400, s: 800 }) }, { e: 1400, r: 800, d: -600 });
    assert.deepEqual({ ...M.zc3({ known: 1, z: 100.1, s: 100.3 }) }, { e: 100.1, r: 100.3, d: 0.2 });
    assert.equal(M.zc3({ known: 0, z: 1, s: 0 }), null);
    assert.equal(M.zc3(null), null);
  });
  it('בדיקה 4: פתקים מול הפקדות בפועל, שתי הקופות יחד; ממתין להפקדה; סגירות שנדחו לא נספרות', () => {
    const M = load();
    const c = { lvl: 0, sumOk: true, dateWarn: false, tot: 0, inc: 0 };
    const Z = (id, reg, st) => ({ id, reg, st, c, f: { d: '2026-11-17' } });
    const C = (id, zc, a, dp, dep) => ({ id, zc, a, dp: dp || '', dep: dep || '' });
    const P = (id, a, st) => ({ id, a, st: st || 'ok', items: [], rows: [] });
    const D = { L: [Z('z1', 'i_yh', 'ok'), Z('z2', 'i_nl', 'ok'), Z('z3', 'i_nl', 'rej')],
      C: [C('a', 'z1', 500, 'p1'), C('b', 'z2', 300.5, 'p1'), C('c', 'z2', 600, '', '1'), C('d', 'z3', 999, 'p2')],
      P: { p1: P('p1', 800.5), p2: P('p2', 999) }, DC: [] };
    let x = M.zsDep4(D);
    assert.equal(x.e, 1400.5); assert.equal(x.r, 800.5); assert.equal(x.d, -600); assert.equal(x.w, 600); assert.equal(x.k, 'wait');
    D.P.p1.a = 800; x = M.zsDep4(D); assert.equal(x.d, -600.5); assert.equal(x.k, 'bad');
    D.C[2].dp = 'p1'; D.C[2].dep = '1'; D.P.p1.a = 1400.5; x = M.zsDep4(D); assert.equal(x.d, 0); assert.equal(x.k, 'inc');
    D.P.p1.a = 1500; x = M.zsDep4(D); assert.equal(x.d, 99.5); assert.equal(x.k, 'warn');
    // סבב 2: "מתוכו ממתין להפקדה" רק בחוסר, ולכל היותר בגובה החוסר; בעודף או בלי פער – לא מוצג
    const T = (d) => M.zsDep4H(d).replace(/<[^>]+>/g, ' ');
    D.C[2].dp = ''; D.P.p1.a = 1500; assert.doesNotMatch(T(D), /ממתין/);       // פתקים 1400.5, הופקד 1500: עודף 99.5 עם ממתין 600
    D.P.p1.a = 1000; assert.match(T(D), /חוסר 400\.50 · מתוכו ממתין להפקדה 400\.50/); // חוסר 400.5 < ממתין 600
    D.P.p1.a = 0; assert.match(T(D), /חוסר 1400\.50 · מתוכו ממתין להפקדה 600\.00/);  // חוסר גדול מהממתין
    D.C[2].dp = 'p1'; D.P.p1.a = 1400.5; assert.doesNotMatch(T(D), /ממתין/);   // מאוזן
    D.P.p1.st = 'rej'; x = M.zsDep4(D); assert.equal(x.r, 0);           // הפקדה שנדחתה – לא נספרת
    x = M.zsDep4({ L: [], C: [], P: {}, DC: [] }); assert.equal(x.k, 'inc'); assert.equal(x.e, 0);
  });
});
