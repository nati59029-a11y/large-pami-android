'use strict';
// ייבוא ברקע (11.11.2026): בדיקות בלי אמולטור – חלוקה לחלקים, גודל חלק מוצפן, הצפנה עם AAD, ואין ספרות כרטיס גלויות.
// הבדיקות מול האמולטור (טריגר, כפילויות, הרשאות, השוואה לייבוא הישן) – ב-imports.test.js.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');

const FN = path.join(__dirname, '..', 'functions');
require(path.join(FN, 'index.js'));
const I = require(path.join(FN, 'imports.js'))._core;
const CARD = require(path.join(FN, 'lib', 'card.js'));
const G = require('./import-gen');

const KEY = crypto.randomBytes(32).toString('base64'); // מפתח בדיקה חד־פעמי
const MB = 1024 * 1024;
const JOB = 'AbCdEfGhIjKlMnOpQrSt';
const XK = Array.from({ length: 20 }, (_, i) => 'x' + String.fromCharCode(97 + i) + 'k');
// כל הערכים מסוג מחרוזת במסמך (מספרים – זמנים וכו' – לא נבדקים)
const strings = (o, out = []) => { if (typeof o === 'string') out.push(o); else if (o && typeof o === 'object') Object.values(o).forEach((v) => strings(v, out)); return out; };
const CARD_RUN = /\d(?:[\s.\-/]*\d){12,18}/; // 13–19 ספרות, גם עם מפרידים

describe('ייבוא ברקע – חלוקה, גודל והצפנה (בלי אמולטור)', () => {
  it('לקוחות רגילים: 916 שורות בקריאות של 200 → חלקים של עד 100, מספור רציף לפי מיקום בקובץ; שליחה חוזרת = אותם חלקים', () => {
    const { rows, ns } = G.customers(916);
    const all = [];
    for (let at = 0; at < rows.length; at += 200) all.push(...I.pack('cust', rows.slice(at, at + 200), ns.slice(at, at + 200), at));
    assert.ok(all.every((c) => c.rows.length <= 100));
    let next = 0;
    for (const c of all) { assert.equal(c.n, next); next += c.rows.length; }
    assert.equal(next, 916);
    assert.deepEqual(I.pack('cust', rows.slice(200, 400), ns.slice(200, 400), 200).map((c) => [c.n, c.rows.length]), all.filter((c) => c.n >= 200 && c.n < 400).map((c) => [c.n, c.rows.length]));
  });

  it('מוצרים: חלק = מנה של 200 (כמו הייבוא הישן)', () => {
    const { rows, ns } = G.products(200);
    const p = I.pack('prod', rows, ns, 0);
    assert.equal(p.length, 1); assert.equal(p[0].rows.length, 200);
  });

  it('כל חלק מוצפן < 1MB גם עם השורות הגדולות ביותר המותרות (לקוחות: כל השדות במגבלה, 30 ניודים, 3 כרטיסים; מוצרים: 200 שורות מלאות)', () => {
    const cust = Array.from({ length: 200 }, (_, i) => G.maxCustomer(i, XK));
    const one = Buffer.byteLength(JSON.stringify(cust[0]), 'utf8');
    assert.ok(one < I.KINDS.cust.rowMax, 'שורת לקוח מקסימלית (' + one + ' בתים) חייבת להיכנס בלי להיחתך');
    const pc = I.pack('cust', cust, cust.map((_, i) => i + 2), 0);
    assert.ok(pc.every((c) => c.rows.every((r) => r !== null)), 'אף שורה תקינה לא נחתכה');
    const prod = Array.from({ length: 200 }, (_, i) => G.maxProduct(i));
    assert.ok(Buffer.byteLength(JSON.stringify(prod[0]), 'utf8') < I.KINDS.prod.rowMax);
    const pp = I.pack('prod', prod, prod.map((_, i) => i + 2), 0);
    const sizes = [];
    for (const [kind, list] of [['cust', pc], ['prod', pp]]) for (const c of list) {
      const s = I.sealChunk(KEY, 'biz-o', JOB, c);
      const doc = { biz: 'biz-o', job: JOB, n: s.n, cnt: s.cnt, k: kind, uid: 'u'.repeat(28), box: s.box, t: Date.now(), tries: 0, st: 'q', kk: 0 };
      const b = I.docBytes(doc);
      sizes.push(b);
      assert.ok(b < MB, `${kind} חלק ${c.n}: ${b} בתים`);
      assert.ok(b <= I.DOC_MAX, `${kind} חלק ${c.n}: מעל הגבול הפנימי`);
    }
    console.log('גודל חלק מוצפן מרבי (בתים, הערכה עליונה):', Math.max(...sizes));
  });

  it('שורה גדולה מכל שורה תקינה → null (תיספר כשורה לא תקינה), השאר נשמרות', () => {
    const p = I.pack('cust', [{ name: 'א', phone: '0501111111' }, { name: 'א'.repeat(60000) }], [2, 3], 0);
    assert.deepEqual(p[0].rows.map((r) => r && r.name), ['א', null]);
  });

  it('הצפנה: כל תוכן החלק בתוך box; אין מספר כרטיס/CVV/ת"ז/טלפון גלויים; AAD = עסק+עבודה+חלק (העתקה לעסק/עבודה/חלק אחר – לא נפתח)', () => {
    const { rows, ns, cards } = G.customers(200);
    const [c] = I.pack('cust', rows.slice(0, 100), ns.slice(0, 100), 0);
    const s = I.sealChunk(KEY, 'biz-o', JOB, c);
    const txt = JSON.stringify(s);
    for (const k of cards) { assert.ok(!txt.includes(k.num)); assert.ok(!txt.includes('"' + k.cvv + '"')); }
    assert.ok(!txt.includes('cvv') && !txt.includes(rows[10].phone) && !txt.includes(rows.find((r) => r.tz).tz) && !txt.includes(rows[10].name));
    assert.ok(!strings(s).some((v) => CARD_RUN.test(v) && !/^[A-Za-z0-9+/=]+$/.test(v)), 'רצף ספרות גלוי מחוץ להצפנה');
    assert.deepEqual(CARD.open(KEY, 'biz-o', I.aadOf('biz-o', JOB, 0), s.box).rows, c.rows);
    for (const [b, j, n] of [['biz-p', JOB, 0], ['biz-o', 'ZZZZZZZZZZZZZZZZZZZZ', 0], ['biz-o', JOB, 100]]) {
      assert.throws(() => CARD.open(KEY, b, I.aadOf(b, j, n), s.box), (e) => e.details && e.details.reason === 'bad-box');
    }
  });

  it('הודעת שגיאה לשורה נשמרת בלי רצפי ספרות ארוכים (גם עם מפרידים); מספרים קצרים נשארים', () => {
    assert.equal(I.clean('שדה לא מוכר: 4580123456789012'), 'שדה לא מוכר: …');
    assert.equal(I.clean('x 4580-1234 5678.9012 y'), 'x … y');
    assert.equal(I.clean('הערות – עד 1000 תווים'), 'הערות – עד 1000 תווים');
    assert.equal(I.clean('13 עד 19 ספרות'), '13 עד 19 ספרות');
  });

  it('מצב העבודה: up (עוד לא כל השורות נשלחו) → run → done / part (יש חלקים שנכשלו)', () => {
    assert.equal(I.stOf({ total: 10, recv: 5, dn: 5, fr: 0 }), 'up');
    assert.equal(I.stOf({ total: 10, recv: 10, dn: 5, fr: 0 }), 'run');
    assert.equal(I.stOf({ total: 10, recv: 10, dn: 10, fr: 0 }), 'done');
    assert.equal(I.stOf({ total: 10, recv: 10, dn: 7, fr: 3 }), 'part');
  });
});
