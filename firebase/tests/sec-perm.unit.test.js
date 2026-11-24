'use strict';
// גיטי – סבב 4 חלק א (24.11.2026): הפונקציה המשותפת להרשאות הפעולה (lib/sec-perm.js) – בלי מסד.
// ברירת מחדל = אחרי אישור; "אסור" חוסם גם הצעה; תקרה לפעולה ותקרה יומית עוקפות "לבד"; אין סוג תשלום; זיהוי הוראה בצ'אט.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../functions/lib/sec-perm.js');

const auto = (o) => P.permOf(Object.assign({ t: { task: 'auto', rem: 'auto', msg: 'auto', ord: 'auto', tag: 'auto' } }, o));

describe('lib/sec-perm – permOf / decide', () => {
  it('בלי מסמך (נתונים קיימים): כל הסוגים "רק אחרי אישור", 500/2000, ספי חריגה 30%/200', () => {
    const p = P.permOf(null);
    assert.deepEqual(p.t, { task: 'ask', rem: 'ask', msg: 'ask', ord: 'ask', tag: 'ask' });
    assert.deepEqual([p.cap1, p.capD, p.anPct, p.anMin], [500, 2000, 30, 200]);
    for (const k of P.KEYS) assert.deepEqual(P.decide(p, k, { amount: 10 }), { r: 'ask', why: 'perm' });
    assert.deepEqual(P.decide(undefined, 'msg'), { r: 'ask', why: 'perm' }, 'גם בלי הגדרות בכלל');
  });
  it('ערכים לא תקינים במסמך – ברירת המחדל (כולל שמות שדה של אובייקט)', () => {
    const p = P.permOf({ t: { msg: 'yes', task: 'toString', rem: null, ord: 'auto', tag: ['auto'] }, cap1: -5, capD: 'x', anPct: 0, anMin: 2e9 });
    assert.deepEqual(p.t, { task: 'ask', rem: 'ask', msg: 'ask', ord: 'auto', tag: 'ask' });
    assert.deepEqual([p.cap1, p.capD, p.anPct, p.anMin], [500, 2000, 30, 200]);
    assert.equal(P.permOf({ t: Object.create({ msg: 'auto' }) }).t.msg, 'ask', 'רק שדות של המסמך עצמו');
  });
  it('"אסור" חוסם גם הצעה; "אחרי אישור" – הצעה בלבד; "לבד" – ביצוע', () => {
    const p = P.permOf({ t: { msg: 'no', task: 'ask', rem: 'auto' } });
    assert.deepEqual(P.decide(p, 'msg'), { r: 'no', why: 'perm' });
    assert.equal(P.canPropose(p, 'msg'), false); assert.equal(P.legacyOk(p, 'msg'), false);
    assert.equal(P.canPropose(p, 'task'), true); assert.equal(P.decide(p, 'task').r, 'ask');
    assert.equal(P.decide(p, 'rem').r, 'auto');
    assert.equal(P.legacyOk(P.permOf(null), 'msg'), true, 'מנגנון קיים שהודלק – ממשיך בברירת המחדל');
  });
  it('תקרה לפעולה (500) עוקפת "לבד"; בדיוק 500 – בתוך התקרה; זיכוי לפי ערך מוחלט', () => {
    const p = auto();
    assert.deepEqual(P.decide(p, 'ord', { amount: 500 }), { r: 'auto', why: '' });
    assert.deepEqual(P.decide(p, 'ord', { amount: 500.01 }), { r: 'ask', why: 'cap1' });
    assert.deepEqual(P.decide(p, 'tag', { amount: -800 }), { r: 'ask', why: 'cap1' });
  });
  it('תקרה יומית (2000) – מצטבר מעל התקרה תמיד באישור', () => {
    const p = auto();
    assert.equal(P.decide(p, 'ord', { amount: 400, dayUsed: 1600 }).r, 'auto');
    assert.deepEqual(P.decide(p, 'ord', { amount: 401, dayUsed: 1600 }), { r: 'ask', why: 'capD' });
    assert.deepEqual(P.decide(auto({ cap1: 5000, capD: 1000 }), 'ord', { amount: 1200 }), { r: 'ask', why: 'capD' }, 'תקרה יומית נמוכה מהתקרה לפעולה');
  });
  it('טיוטת הזמנה / תיוג בלי סכום תקין – באישור; סכום NaN/מחרוזת – באישור', () => {
    const p = auto();
    assert.deepEqual(P.decide(p, 'ord'), { r: 'ask', why: 'amount' });
    assert.deepEqual(P.decide(p, 'tag', { amount: '300' }), { r: 'ask', why: 'amount' });
    assert.deepEqual(P.decide(p, 'msg', { amount: NaN }), { r: 'ask', why: 'amount' });
    assert.deepEqual(P.decide(p, 'msg'), { r: 'auto', why: '' }, 'הודעה בלי סכום – לבד');
  });
  it('תשלום / העברת כסף / סוג לא מוכר – תמיד אסור, גם כשהכול "לבד"', () => {
    const p = auto();
    for (const t of ['pay', 'transfer', 'payment', '', 'toString', '__proto__', null, 7]) assert.deepEqual(P.decide(p, t, { amount: 1 }), { r: 'no', why: 'type' });
    assert.ok(!P.KEYS.some((k) => /pay|transfer/.test(k)) && !Object.values(P.TYPES).some((l) => /תשלום|העבר/.test(l)), 'אין סוג תשלום ברשימה');
  });
});

describe('lib/sec-perm – applyChange', () => {
  it('שינוי סוג ותקרה: נתונים למיזוג + תיאור ליומן; same כשאין שינוי', () => {
    const p = P.permOf(null);
    assert.deepEqual(P.applyChange(p, { type: 'msg', lvl: 'auto' }), { set: { t: { msg: 'auto' } }, note: 'msg:ask>auto', same: false });
    assert.deepEqual(P.applyChange(p, { num: 'cap1', v: 1000.4 }), { set: { cap1: 1000 }, note: 'cap1:500>1000', same: false });
    assert.equal(P.applyChange(p, { type: 'task', lvl: 'ask' }).same, true);
    assert.equal(P.changeText(p, { type: 'msg', lvl: 'auto' }), 'שליחת הודעה (ווצאפ / מייל): רק אחרי אישור ← לבד');
  });
  it('נדחה: סוג תשלום, רמה לא מוכרת, סכום מחוץ לגבולות, קלט ריק', () => {
    const p = P.permOf(null);
    const code = (ch) => { try { P.applyChange(p, ch); return 'ok'; } catch (e) { return e.badPerm; } };
    assert.equal(code({ type: 'pay', lvl: 'auto' }), 'bad-type');
    assert.equal(code({ type: 'msg', lvl: 'always' }), 'bad-level');
    assert.equal(code({ num: 'pay', v: 1 }), 'bad-type');
    assert.equal(code({ num: 'cap1', v: 100001 }), 'bad-amount');
    assert.equal(code({ num: 'capD', v: -1 }), 'bad-amount');
    assert.equal(code({ num: 'anPct', v: '40' }), 'bad-amount');
    assert.equal(code(null), 'bad-input'); assert.equal(code({}), 'bad-input');
  });
});

describe('lib/sec-perm – זיהוי הוראה בצ\'אט (בלי AI)', () => {
  const c = (t) => P.parseChat(t);
  it('הוראות הרשאה ותקרה', () => {
    assert.deepEqual(c('תני לעצמך לשלוח הודעות לבד'), { change: { type: 'msg', lvl: 'auto' } });
    assert.deepEqual(c('אסור לך לשלוח מיילים'), { change: { type: 'msg', lvl: 'no' } });
    assert.deepEqual(c('מעכשיו משימות רק באישור'), { change: { type: 'task', lvl: 'ask' } });
    assert.deepEqual(c('תעלי את התקרה ל-1000'), { change: { num: 'cap1', v: 1000 } });
    assert.deepEqual(c('תעלי את התקרה היומית ל-5,000'), { change: { num: 'capD', v: 5000 } });
    assert.deepEqual(c('שני את סף החריגה ל-40%'), { change: { num: 'anPct', v: 40 } });
    assert.deepEqual(c('תעלי את התקרה ל-500000'), { bad: 'range', num: 'cap1' });
  });
  it('בקשת הרשאת תשלום – מזוהה (ונדחית בשרת)', () => {
    for (const t of ['תני לעצמך לשלם לספקים', 'תוסיפי לעצמך הרשאת תשלום', 'מעכשיו תעשי העברות בנקאיות לבד', 'אפשר לתת לך הרשאה לתשלומים?']) assert.deepEqual(c(t), { pay: true }, t);
  });
  it('שאלות רגילות – לא הוראת הרשאה (השיחה ממשיכה כרגיל)', () => {
    for (const t of ['כמה שילמתי לספקים החודש?', 'מה התקרה?', 'תעלי את תקרת העלות החודשית ל-50', 'מה המצב עם ההודעות בווצאפ?', 'מעכשיו תזכירי לי לשלם חשבונות', 'פתחי משימה לדוד לנקות את המחסן', "חשבוניות מהיום – לקטגוריה 'בטיפול' באפליקציה", 'מעכשיו ההודעות של דוד – לקטגוריה אחרת', '', null]) assert.equal(c(t), null, String(t));
  });
});
