'use strict';
// כלל שכר בכתב חופשי (שלב D, 19.11.2026) – בדיקות יחידה ל-lib/pay-ai.js (קלט, הנחיה, אימות התשובה), בלי אמולטור.
// הרצה: node --test tests/pay-ai.unit.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../functions/lib/pay-ai');
const PC = require('../functions/lib/payroll-core');
const GM = require('./gemini-mock');

const TXT = 'בונוס 150 אם כל המשימות בזמן, ו-2% מעל 20 אלף';
let seq = 0;
const idOf = () => 'ai_t' + (++seq);
const raw = (name) => { GM.state.payrule = name; return GM.rawAnswer('payrule', {}).candidates[0].content.parts[0].text; };

describe('payroll-core בשרת', () => {
  it('lib/payroll-core.js זהה בייט-בייט ל-app-source/www/payroll-core.js (אחרת: cp app-source/www/payroll-core.js firebase/functions/lib/payroll-core.js)', () => {
    const a = fs.readFileSync(path.join(__dirname, '../../app-source/www/payroll-core.js'));
    const b = fs.readFileSync(path.join(__dirname, '../functions/lib/payroll-core.js'));
    assert.ok(a.equals(b), 'payroll-core.js בשרת שונה מהאפליקציה');
    assert.equal(typeof PC.validComp, 'function');
  });
});

describe('checkInput – קלט מהאפליקציה', () => {
  it('טקסט חובה, 1–500 תווים אחרי trim', () => {
    assert.equal(P.checkInput({}).reason, 'bad-text');
    assert.equal(P.checkInput({ text: 5 }).reason, 'bad-text');
    assert.equal(P.checkInput(null).reason, 'bad-text');
    assert.equal(P.checkInput({ text: '   ' }).reason, 'empty');
    assert.equal(P.checkInput({ text: 'א'.repeat(501) }).reason, 'too-long');
    const r = P.checkInput({ text: '  ' + 'א'.repeat(500) + ' ' });
    assert.equal(r.ok, true); assert.equal(r.text.length, 500); assert.equal(r.cur, null);
  });
  it('base: רק mode/rate/mo תקינים נשמרים להקשר; לא אובייקט – bad-base', () => {
    assert.equal(P.checkInput({ text: 'x', base: 'hr' }).reason, 'bad-base');
    assert.equal(P.checkInput({ text: 'x', base: [1] }).reason, 'bad-base');
    const r = P.checkInput({ text: 'x', base: { mode: 'hr', rate: '40', mo: -5, name: 'דנה כהן', uid: 'u1' } });
    assert.deepEqual(r.cur, { mode: 'hr', rate: 40 });
  });
});

describe('ההנחיה ל-Gemini', () => {
  it('מתחילה ב-PAY-RULE-V1, מתארת את כל סוגי הרכיבים ואת הבסיס, ודורשת JSON בלבד', () => {
    assert.ok(P.SYS.startsWith('PAY-RULE-V1'));
    for (const s of ['"k":"tk"', '"m":"tier"', '"k":"sl"', '"k":"pc"', '"k":"man"', '"ss"', '"base"', '"explain"', '"unsure"', 'JSON בלבד', 'אל תמציא']) assert.ok(P.SYS.includes(s), s);
  });
  it('החלק של המשתמש: רק הכלל והבסיס המספרי – בלי שמות ומזהים', () => {
    const inp = P.checkInput({ text: TXT, base: { mode: 'mo', mo: 6000, name: 'דנה כהן', id: 'e1' } });
    const u = P.userPart(inp.text, inp.cur);
    assert.deepEqual(JSON.parse(u), { rule: TXT, cur: { mode: 'mo', mo: 6000 } });
    assert.ok(!u.includes('דנה') && !u.includes('e1'));
    assert.deepEqual(JSON.parse(P.userPart('x', null)), { rule: 'x' });
  });
});

describe('parseOut – אימות התשובה עם validComp', () => {
  it('תשובה תקינה: כל רכיב עובר validComp, עם id חדש, src = הכלל ו-ai:1', () => {
    GM.reset();
    const r = P.parseOut(raw('ok'), TXT, { idOf });
    assert.equal(r.ok, true);
    assert.equal(r.comp.length, 2);
    for (const c of r.comp) {
      const v = PC.validComp(c);
      assert.equal(v.ok, true, v.err);
      assert.deepEqual(v.comp, c); // כבר מנורמל
      assert.match(c.id, /^ai_/); assert.equal(c.src, TXT); assert.equal(c.ai, 1);
    }
    assert.deepEqual(r.comp[1], { id: r.comp[1].id, k: 'pc', n: 'אחוז ממכירות', on: true, src: TXT, ai: 1, p: 2, th: 20000, ss: 'hrs' });
    assert.ok(r.explain.length > 5); assert.equal(r.unsure, ''); assert.equal(r.dropped, 0); assert.equal(r.base, undefined);
  });
  it('שינוי בסיס בלבד: ok, comp ריק, base מנוקה עם מזהים', () => {
    GM.reset();
    const r = P.parseOut(raw('base'), TXT, { idOf });
    assert.equal(r.ok, true); assert.deepEqual(r.comp, []);
    assert.equal(r.base.mode, 'hr'); assert.equal(r.base.rate, 45);
    assert.equal(r.base.add.length, 1); assert.equal(r.base.add[0].k, 'day'); assert.ok(r.base.add[0].id);
    assert.deepEqual(r.base.rules[0].d, [5]); assert.equal(r.base.rules[0].e, '24:00'); assert.equal(r.base.rules[0].r, 60);
  });
  it('JSON שבור ← unparsed עם הסבר ברירת מחדל', () => {
    GM.reset();
    const r = P.parseOut(raw('broken'), TXT, { idOf });
    assert.deepEqual(r, { ok: false, unparsed: true, explain: P.FALLBACK, unsure: '', dropped: 0, errs: [] });
    assert.equal(P.parseOut(undefined, TXT).unparsed, true);
    assert.equal(P.parseOut('[1,2]', TXT).unparsed, true);
  });
  it('כל הרכיבים והבסיס לא חוקיים ← unparsed, עם explain/unsure מהתשובה וסיבות', () => {
    GM.reset();
    const r = P.parseOut(raw('bad'), TXT, { idOf });
    assert.equal(r.ok, false); assert.equal(r.unparsed, true);
    assert.equal(r.explain, 'ניסיתי'); assert.equal(r.unsure, 'לא ברור');
    assert.equal(r.dropped, 5); // 3 רכיבים + mode + rate
    assert.ok(r.errs.includes('סוג רכיב לא מוכר'));
    assert.equal(r.comp, undefined);
  });
  it('תערובת: רכיב תקין נשאר, לא תקין נזרק; id/src/ai מהתשובה נדרסים; שדות זרים לא עוברים', () => {
    const t = JSON.stringify({ comp: [{ id: 'evil', k: 'man', n: 'בונוס חג', src: 'x', ai: 0, uid: 'u1', amt: 5 }, { k: 'pc', p: 0 }, 'str'], explain: 'א' });
    const r = P.parseOut('```json\n' + t + '\n```', TXT, { idOf });
    assert.equal(r.ok, true); assert.equal(r.comp.length, 1); assert.equal(r.dropped, 2);
    assert.deepEqual(Object.keys(r.comp[0]).sort(), ['ai', 'id', 'k', 'n', 'on', 'src']);
    assert.notEqual(r.comp[0].id, 'evil'); assert.equal(r.comp[0].src, TXT);
  });
  it('רשימה ריקה ← unparsed עם ההסבר של המודל; יותר מ-10 רכיבים נחתכים', () => {
    GM.reset();
    const r = P.parseOut(raw('empty'), TXT);
    assert.equal(r.unparsed, true); assert.equal(r.explain, 'הטקסט אינו כלל שכר.');
    const many = JSON.stringify({ comp: Array.from({ length: 13 }, () => ({ k: 'man' })) });
    const m = P.parseOut(many, TXT);
    assert.equal(m.comp.length, 10); assert.equal(m.dropped, 3);
    assert.equal(new Set(m.comp.map((c) => c.id)).size, 10);
  });
  it('explain/unsure: תווי בקרה ורווחים מנוקים, עד 300 תווים', () => {
    const r = P.parseOut(JSON.stringify({ comp: [{ k: 'man' }], explain: 'א\n\tב  ' + 'ג'.repeat(400), unsure: 7 }), TXT);
    assert.ok(r.explain.startsWith('א ב ')); assert.equal(r.explain.length, 300); assert.equal(r.unsure, '');
  });
});
