'use strict';
// סגירת קופה – בדיקות יחידה ללוגיקה שבאפליקציה (בדיקה סבב 2 ליקוי 1(ג), וסבב 3).
// הפונקציות נלקחות כמו שהן מ-www/index.html שב-large-pami-android-project.zip (כמו app-prompts), ורצות ב-vm בלי דפדפן ובלי אמולטור:
// zcB (גבול לפי שעת הפתיחה), coChk/coIn (החלון), zcPendBefore (סגירה ממתינה מוקדמת), coLost (הוצאות שלא נבדקו),
// zsDepAuto (הפקדה שאושרה אוטומטית – לפי ההפקדה עצמה), coMerge (מילוי מהפתק בלי לדרוס), zcTime, coScanParse.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { appSourceLines } = require('./helpers');

// תחילת השורה של כל קטע; נלקחת השורה ואחריה כל שורות ההמשך (שמתחילות ברווח)
const PARTS = ['const s_=', 'const rnd=', 'const ymd=', 'const dfmt=', 'function mk(', 'function pNum(', 'var ZREG=', 'var ZC=null', 'function zcN(', 'function zcV(',
  'const zcDate=', 'const zcTime=', 'function zcRegOne(', 'const ZPB=', 'function zcPendBefore(', 'function coLost(', 'function coScanParse(', 'const coDate=', 'const coHeld=',
  'const zlKey=', 'function zcB(', 'function zcPrev(', 'function coIn(', 'function coChk(', 'function dpAiChk(', 'function zsDepAuto(', 'var COIN=', 'const COM=', 'const coSame=', 'function coMerge('];

function load() {
  const L = appSourceLines();
  const chunks = PARTS.map((p) => {
    const i = L.findIndex((l) => l.startsWith(p));
    if (i < 0) throw new Error('לא נמצא בקוד האפליקציה: ' + p);
    let j = i + 1; while (j < L.length && L[j].startsWith(' ')) j++;
    return L.slice(i, j).join('\n');
  });
  const pre = 'var S={zc:[]},ADM=true;const isA=()=>ADM,coVer=()=>true,gv=()=>"",ils=n=>String(Math.round((n||0)*100)/100);\n';
  const post = '\n;({S,COQ,setZQP:(v)=>{ZQP=v},setAdm:(v)=>{ADM=v},zcB,coIn,coChk,coLost,zcPendBefore,zsDepAuto,coMerge,COM,zcTime,coScanParse,ZPB})';
  return vm.runInNewContext(pre + chunks.join('\n') + post, {}, { filename: 'index.html (חלקים)' });
}
const ids = (L) => L.map((x) => x.id).sort().join(',');
const X = (id, d, tm, a, o) => Object.assign({ id, uid: 'u', by: 'dani', t: 1, reg: 'i_nl', d, tm, a, why: 'w', dep: '', src: id, zc: '', dp: '' }, o);
const B = (M, x) => { const b = M.zcB(x); return b.d + ' ' + b.tm + ' ' + b.o; };

describe('סגירת קופה – לוגיקה באפליקציה (index.html)', () => {
  it('zcB: הגבול בין סגירות הוא הפתיחה שצורפה (עם שעה, אחרי הסגירה, עד יום אחריה); אחרת זמן הסגירה', () => {
    const M = load();
    assert.equal(B(M, { d: '2026-10-20', tm: '09:02', od: '2026-10-20', otm: '09:11' }), '2026-10-20 09:11 1');
    assert.equal(B(M, { d: '2026-10-20', tm: '09:02', od: '2026-10-20', otm: '' }), '2026-10-20 09:02 0');      // פתיחה בלי שעה
    assert.equal(B(M, { d: '2026-10-20', tm: '22:00', od: '2026-10-20', otm: '08:00' }), '2026-10-20 22:00 0');  // פתיחה לפני הסגירה
    assert.equal(B(M, { d: '2026-10-20', tm: '22:00', od: '2026-10-21', otm: '08:00' }), '2026-10-21 08:00 1');  // למחרת
    assert.equal(B(M, { d: '2026-10-20', tm: '22:00', od: '2026-10-22', otm: '08:00' }), '2026-10-20 22:00 0');  // יומיים אחרי – לא
    assert.equal(B(M, { d: '2026-10-31', tm: '22:00', od: '2026-11-01', otm: '08:00' }), '2026-11-01 08:00 1');  // סוף חודש
    assert.equal(B(M, { d: '2026-12-31', tm: '22:00', od: '2027-01-01', otm: '08:00' }), '2027-01-01 08:00 1');  // סוף שנה
    assert.equal(B(M, { d: '2026-10-20', tm: '09:02', od: '2026-10-20', otm: '99:99' }), '2026-10-20 09:02 0');  // שעה לא תקינה
    assert.equal(M.zcTime('25:00') + '|' + M.zcTime('9:05') + '|' + M.zcTime('23:59'), '|09:05|23:59');
  });

  it('חלון לפי שעת הפתיחה: בין הסגירה לפתיחה – לסגירה הזו; בדיוק בזמן הפתיחה – לא לבאה; בלי שעה ביום הפתיחה – "לא ברור"', () => {
    const M = load();
    M.S.zc.push({ id: 'z0', reg: 'i_nl', d: '2026-10-20', tm: '09:02', od: '2026-10-20', otm: '09:11' });
    M.COQ.L = [X('a', '2026-10-20', '09:00', 1), X('b', '2026-10-20', '09:02', 2), X('c', '2026-10-20', '09:05', 4), X('d', '2026-10-20', '09:11', 8), X('e', '2026-10-20', '09:12', 16),
      X('f', '2026-10-20', '', 32), X('g', '2026-10-21', '09:00', 64), X('h', '2026-10-21', '09:05', 128), X('i', '2026-10-21', '09:10', 256), X('j', '2026-10-21', '09:11', 512)];
    const r = M.coChk('i_nl', '2026-10-21', '09:00', '-1', { id: 'z1', od: '2026-10-21', otm: '09:10' });
    assert.equal(ids(r.L), 'e,g,h,i'); assert.equal(ids(r.U), 'f');
    assert.equal(ids(M.coChk('i_nl', '2026-10-21', '09:00', '-1', { id: 'z1' }).L), 'e,g');          // בלי פתיחה – עד הסגירה
    M.S.zc.length = 0;
    assert.equal(ids(M.coChk('i_nl', '2026-10-20', '09:02', '-1', { id: 'z0', od: '2026-10-20', otm: '09:11' }).L), 'a,b,c,d,f'); // z0 עצמה – עד הפתיחה שלה
  });

  it('התרחיש מסבב 2: Z1 ממתינה – Z2 לא נכנסת אוטומטית; אחרי דחיית Z1 – 147 מול 40, "לא תואם"; Z2 רשומה – 100 ו-7 לא נבדקו', () => {
    const M = load();
    M.S.zc.push({ id: 'z0', reg: 'i_nl', d: '2026-10-18', tm: '' });
    M.setZQP([{ id: 'z1', reg: 'i_nl', d: '2026-10-20', tm: '09:00', od: '', otm: '' }, { id: 'z2', reg: 'i_nl', d: '2026-10-22', tm: '', od: '', otm: '' }]);
    M.COQ.L = [X('a', '2026-10-19', '', 100), X('b', '2026-10-20', '', 7), X('c', '2026-10-21', '', 40)];
    const z2 = { id: 'z2', reg: 'i_nl', f: { d: '2026-10-22', tm: '' } };
    let r = M.coChk('i_nl', '2026-10-22', '', '-40', { id: 'z2' });
    assert.equal(r.ok, true, 'בזמן ש-Z1 ממתינה החלון של Z2 תואם (40)…');
    assert.equal(M.zcPendBefore(z2), true, '…ולכן היא לא נכנסת אוטומטית');
    assert.equal(M.ZPB, 'יש סגירה קודמת של הקופה שממתינה לאישור');
    assert.equal(ids(M.coLost(M.COQ.L)), '', 'בזמן ש-Z1 ממתינה – אין הוצאות "שלא נבדקו"');
    // דחיית Z1 (יוצאת מ-ZQP): Z2 נבדקת מחדש
    M.setZQP([{ id: 'z2', reg: 'i_nl', d: '2026-10-22', tm: '', od: '', otm: '' }]);
    r = M.coChk('i_nl', '2026-10-22', '', '-40', { id: 'z2' });
    assert.equal(M.zcPendBefore(z2), false);
    assert.equal(r.s, 147); assert.equal(r.ok, false); assert.equal(r.diff, 107);
    // Z2 כבר רשומה ו-Z1 נדחתה: 100 ו-7 לא נבדקים בשום סגירה; 40 (בחלון של Z2, עוד לא שויך) – גם
    M.S.zc.push({ id: 'z2', reg: 'i_nl', d: '2026-10-22', tm: '' }); M.setZQP([]);
    M.COQ.L[2].zc = 'z2';
    assert.equal(ids(M.coLost(M.COQ.L)), 'a,b');
    // קופה אחרת או אותו זמן – לא חוסמות
    M.setZQP([{ id: 'zy', reg: 'i_yh', d: '2026-10-20', tm: '' }, { id: 'zx', reg: 'i_nl', d: '2026-10-22', tm: '' }]);
    assert.equal(M.zcPendBefore({ id: 'z9', reg: 'i_nl', f: { d: '2026-10-22', tm: '' } }), false);
    // סגירה מזויפת ממתינה עם פתיחה מאוחרת – הבאה עוברת לאישור
    M.setZQP([{ id: 'fake', reg: 'i_nl', d: '2026-10-23', tm: '09:00', od: '2026-10-23', otm: '23:59' }]);
    assert.equal(M.zcPendBefore({ id: 'real', reg: 'i_nl', f: { d: '2026-10-24', tm: '09:00' } }), true);
  });

  it('zsDepAuto: לפי ההפקדה עצמה – כל ההוצאות שלה (גם מסגירות אחרות), סכום וזיהוי תואמים, בלי סיבה', () => {
    const M = load();
    const p = { id: 'dp1', st: 'ok', why: '', a: 120, items: ['c1', 'c2'], rows: [{ d: '2026-10-25', a: 120, ai: { d: '2026-10-25', a: 120 } }] };
    const DC = [X('c1', '2026-10-20', '', 50, { dp: 'dp1', zc: 'zA' }), X('c2', '2026-09-30', '', 70, { dp: 'dp1', zc: 'zOld' })];
    assert.equal(M.zsDepAuto(p, { DC }), true, 'הוצאה מסגירה של חודש אחר – עדיין אוטומטית');
    assert.equal(M.zsDepAuto(Object.assign({}, p, { why: 'עמלה' }), { DC }), false);
    assert.equal(M.zsDepAuto(Object.assign({}, p, { st: 'new' }), { DC }), false);
    assert.equal(M.zsDepAuto(Object.assign({}, p, { rows: [{ d: '2026-10-25', a: 120, ai: { d: '2026-10-25', a: 100 } }] }), { DC }), false, 'זוהה סכום אחר');
    assert.equal(M.zsDepAuto(p, { DC: DC.slice(0, 1) }), false, 'הוצאה שלא סומנה בהפקדה');
    assert.equal(M.zsDepAuto(Object.assign({}, p, { a: 130, rows: [{ d: '2026-10-25', a: 130, ai: { d: '2026-10-25', a: 130 } }] }), { DC }), false, 'סכום שונה מההוצאות');
  });

  it('coMerge: מילוי מהפתק רק בשדה ריק או בברירת המחדל; ערך שהוקלד ושונה – הצעה, לא דריסה', () => {
    const M = load();
    const r = { a: 4650, d: '2026-10-20', tm: '09:02', reg: 'i_yh' };
    let m = M.coMerge({ amt: '', date: '2026-11-02', ctm: '', creg: '' }, { amt: '', date: '2026-11-02', ctm: '', creg: '' }, r, M.COM);
    assert.equal(JSON.stringify(m.set), JSON.stringify({ amt: '4650', date: '2026-10-20', ctm: '09:02', creg: 'i_yh' })); assert.equal(m.sug.length, 0);
    m = M.coMerge({ amt: '465', date: '2026-10-19', ctm: '09:02', creg: 'i_nl' }, { amt: '', date: '2026-11-02', ctm: '', creg: '' }, r, M.COM);
    assert.equal(JSON.stringify(m.set), '{}');
    assert.equal(m.sug.map((s) => s.n + '=' + s.v).join(','), 'amt=4650,date=2026-10-20,creg=i_yh');
    m = M.coMerge({ amt: '4,650.00' }, {}, { a: 4650 }, [['amt', 'a', 'סכום']]);
    assert.equal(m.sug.length + Object.keys(m.set).length, 0, 'אותו סכום בכתיב אחר – בלי הצעה');
  });

  it('coScanParse: קופה לפי מספר או שם, סכום חיובי, ערכים לא תקינים – ריקים', () => {
    const M = load();
    const f = (o) => { const r = M.coScanParse(o); return [r.a, r.d, r.tm, r.reg].join('|'); };
    assert.equal(f({ register: '6346053', date: '2026-10-20', time: '09:02', amount: 4650 }), '4650|2026-10-20|09:02|i_yh');
    assert.equal(f({ store: 'נחל לכיש', date: '24/10/2026', time: '21:49', amount: '-7,150.00' }), '7150|2026-10-24|21:49|i_nl');
    assert.equal(f({ amount: 1e9, date: '2026-02-30', time: '25:00', register: [1] }), '|||');
  });
});
