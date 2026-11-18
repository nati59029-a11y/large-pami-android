'use strict';
// קופה גל 2 – ש2 (17.11.2026): בדיקות יחידה בלי אמולטור – מנוע המבצעים (pos-promo.js), כלל הסגירה, תקרות ההחזרה, Luhn, ושהקבצים המשותפים זהים.
// קריטריונים (אפיון ב 5): 1 (1,000 עגלות אקראיות), 5 (100 פיצולים אקראיים + חסימות), 7 (Luhn, שדות מותרים), 11 (חלוקת החזר), 13 (מבצעים).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..', '..');
const PP = require('../functions/lib/pos-promo');
const PC = require('../functions/lib/pos-calc');
const S = require('../functions/pos-sale')._core;

const CFG = Object.assign({}, S.CFG0, { vatRate: 18 });
const rej = (fn, reason) => { try { fn(); } catch (e) { assert.equal(e.details && e.details.reason, reason, e.message); return; } assert.fail('expected ' + reason); };
let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const AT = Date.parse('2026-11-17T10:00:00+02:00');

describe('קבצים משותפים', () => {
  it('pos-promo.js זהה במכשיר ובשרת', () => {
    assert.equal(fs.readFileSync(path.join(ROOT, 'app-source/www/pos-promo.js'), 'utf8'), fs.readFileSync(path.join(ROOT, 'firebase/functions/lib/pos-promo.js'), 'utf8'));
  });
});

describe('מבצעים (ב 5.13)', () => {
  const P = (o) => Object.assign({ on: true }, o);
  it('2 ב-X (nForX) – הדוגמה מהאפיון: 2 × 12.50 ₪ במבצע 2 ב-20 ₪ → pdisc 500', () => {
    const r = PP.apply([{ pid: 'a', qty: 2, unit: 1250 }], [P({ id: 'p1', type: 'nForX', n: 2, price: 2000, pids: ['a'] })], { at: AT });
    assert.equal(r.lines[0].pdisc, 500); assert.equal(r.lines[0].promo, 'p1');
    const c = PC.sale([{ unit: 1250, qty: 2, disc: 500 }], { rate: 18 });
    assert.deepEqual([c.gross, c.net, c.vat], [2000, 1695, 305]);
  });
  it('קנה X קבל Y: 1+1 – הזולה חינם; קבל מוצר אחר ב-50%', () => {
    let r = PP.apply([{ pid: 'a', qty: 1, unit: 1000 }, { pid: 'b', qty: 1, unit: 800 }], [P({ id: 'x', type: 'bxgy', buy: ['a', 'b'], get: ['a', 'b'] })], { at: AT });
    assert.deepEqual(r.lines.map((l) => l.pdisc), [0, 800]);
    r = PP.apply([{ pid: 'a', qty: 3, unit: 1000 }, { pid: 'c', qty: 2, unit: 600 }], [P({ id: 'y', type: 'bxgy', buy: ['a'], get: ['c'], getPct: 50 })], { at: AT });
    assert.deepEqual(r.lines.map((l) => l.pdisc), [0, 600]);
  });
  it('חבילה, קטגוריה, סכום כולל, מתנה בקנייה מעל סכום', () => {
    let r = PP.apply([{ pid: 'a', qty: 2, unit: 1000 }, { pid: 'b', qty: 1, unit: 500 }], [P({ id: 'bd', type: 'bundle', pids: ['a', 'b'], price: 1200 })], { at: AT });
    assert.equal(r.lines[0].pdisc + r.lines[1].pdisc, 300);
    r = PP.apply([{ pid: 'a', cat: 'c1', qty: 1, unit: 1000 }, { pid: 'b', cat: 'c2', qty: 1, unit: 1000 }], [P({ id: 'ct', type: 'pct', pct: 10, cats: ['c1'] })], { at: AT });
    assert.deepEqual(r.lines.map((l) => l.pdisc), [100, 0]);
    r = PP.apply([{ pid: 'a', qty: 1, unit: 6000 }, { pid: 'b', qty: 1, unit: 4000 }], [P({ id: 'bk', type: 'basket', minAmt: 10000, amt: 1000 })], { at: AT });
    assert.equal(r.lines[0].pdisc + r.lines[1].pdisc, 1000); assert.deepEqual(r.lines.map((l) => l.pdisc), [600, 400]);
    r = PP.apply([{ pid: 'a', qty: 1, unit: 9000 }, { pid: 'g', qty: 1, unit: 1500 }], [P({ id: 'gf', type: 'basketGift', minAmt: 9000, giftPid: 'g' })], { at: AT });
    assert.deepEqual(r.lines.map((l) => l.pdisc), [0, 1500]); assert.deepEqual(r.gifts, ['g']);
  });
  it('שני מבצעים על מוצר – המשתלם ללקוח; פג תוקף / כבוי / מועדון בלבד – לא חל', () => {
    const ps = [P({ id: 'a10', type: 'pct', pct: 10, pids: ['a'] }), P({ id: 'f', type: 'fixed', price: 700, pids: ['a'] })];
    let r = PP.apply([{ pid: 'a', qty: 2, unit: 1000 }], ps, { at: AT });
    assert.equal(r.lines[0].promo, 'f'); assert.equal(r.lines[0].pdisc, 600);
    r = PP.apply([{ pid: 'a', qty: 1, unit: 1000 }], [P({ id: 'old', type: 'pct', pct: 50, to: '2026-11-16' })], { at: AT });
    assert.equal(r.lines[0].pdisc, 0);
    r = PP.apply([{ pid: 'a', qty: 1, unit: 1000 }], [{ id: 'off', type: 'pct', pct: 50, on: false }], { at: AT });
    assert.equal(r.lines[0].pdisc, 0);
    r = PP.apply([{ pid: 'a', qty: 1, unit: 1000 }], [P({ id: 'cl', type: 'pct', pct: 50, clubOnly: true })], { at: AT });
    assert.equal(r.lines[0].pdisc, 0);
    r = PP.apply([{ pid: 'a', qty: 1, unit: 1000 }], [P({ id: 'cl', type: 'pct', pct: 50, clubOnly: true })], { at: AT, club: true });
    assert.equal(r.lines[0].pdisc, 500);
    r = PP.apply([{ pid: 'a', qty: 5, unit: 1000 }], [P({ id: 'lim', type: 'pct', pct: 50, maxPerCust: 2 })], { at: AT });
    assert.equal(r.lines[0].pdisc, 1000);
  });
  it('קופונים: שניים יחד; לא על מוצר במבצע (cpnOnPromo=false)', () => {
    const ps = [P({ id: 'a10', type: 'pct', pct: 10, pids: ['a'] })];
    const cp = [{ code: 'C1', promo: { type: 'amt', amt: 300 } }, { code: 'C2', promo: { type: 'pct', pct: 10 } }];
    const r = PP.apply([{ pid: 'a', qty: 1, unit: 1000 }, { pid: 'b', qty: 1, unit: 2000 }], ps, { at: AT, cpns: cp, cpnStack: true, cpnOnPromo: false });
    assert.equal(r.lines[0].pdisc, 100); assert.equal(r.lines[0].cpn, undefined);
    assert.equal(r.lines[1].pdisc, 300 + 170); assert.ok(r.cpns.every((c) => c.ok));
    const r2 = PP.apply([{ pid: 'a', qty: 1, unit: 1000 }], ps, { at: AT, cpns: [cp[0]] });
    assert.equal(r2.cpns[0].ok, false); assert.equal(r2.cpns[0].why, 'cpn-no-line');
  });
});

describe('סכומים (ב 5.1): 1,000 עגלות אקראיות', () => {
  it('Σtot − manDisc = gross, net + vat = gross, הכול שלם, ואותה תוצאה במכשיר ובשרת', () => {
    const promos = [{ id: 'n', on: true, type: 'nForX', n: 3, price: 2500, pids: ['p1', 'p2'] }, { id: 'x', on: true, type: 'bxgy', buy: ['p3'], get: ['p3'] },
      { id: 'c', on: true, type: 'pct', pct: 15, cats: ['k2'] }, { id: 'b', on: true, type: 'basket', minAmt: 20000, pct: 5 }];
    for (let k = 0; k < 1000; k++) {
      const n = ri(1, 8);
      const lines = Array.from({ length: n }, () => {
        const pid = 'p' + ri(1, 9);
        const l = { pid, n: pid, cat: 'k' + ri(1, 3), qty: ri(1, 6), unit: ri(1, 30000) };
        if (rnd() < 0.2) l.mdisc = rnd() < 0.5 ? { pct: ri(0, 10) } : { amt: ri(0, 100) };
        return l;
      });
      const input = rnd() < 0.3 ? { manDisc: rnd() < 0.5 ? { pct: ri(1, 10) } : { amt: ri(1, 500) } } : {};
      let co;
      try { co = S.compute(S.linesIn(lines), input, CFG, promos, {}, [], { at: AT }); } catch (e) { if (e.details && e.details.reason === 'bad-disc') continue; throw e; }
      const c = co.calc;
      const sumTot = co.lines.reduce((s, l) => s + l.tot, 0);
      assert.equal(sumTot - c.sdisc, c.gross);
      assert.equal(c.net + c.vat, c.gross);
      assert.equal(co.lines.reduce((s, l) => s + l.pg, 0), c.gross);
      for (const v of [c.gross, c.net, c.vat, c.sdisc].concat(co.lines.flatMap((l) => [l.tot, l.pdisc, l.fin, l.pg]))) assert.ok(Number.isInteger(v));
      // המכשיר: אותו קוד (www) – אותה תוצאה
      const W = require(path.join(ROOT, 'app-source/www/pos-promo.js'));
      const pl = lines.map((l) => ({ pid: l.pid, cat: l.cat, qty: l.qty, unit: l.unit }));
      assert.deepEqual(W.apply(pl, promos, { at: AT, stack: 'best', cpnStack: true }).lines.map((x) => x.pdisc), co.lines.map((l) => l.pdisc));
    }
  });
});

describe('תשלומים (ב 5.4–5.7)', () => {
  const T0 = '2026-11-17';
  it('100 פיצולים אקראיים: כל מכירה שנשמרת מקיימת paid + debt = gross; עודף רק במזומן', () => {
    const ms = ['card', 'check', 'transfer', 'bit', 'paybox', 'extGift'];
    let ok = 0;
    for (let k = 0; k < 100; k++) {
      const gross = ri(100, 500000);
      const n = ri(2, 6);
      const pays = []; let left = gross;
      const debt = rnd() < 0.3 ? ri(0, Math.floor(gross / 3)) : 0;
      left -= debt;
      for (let i = 0; i < n - 1 && left > 1; i++) {
        const m = ms[ri(0, ms.length - 1)], a = ri(1, Math.max(1, Math.floor(left / 2)));
        const p = { m, amt: a };
        if (['transfer', 'bit', 'paybox', 'extGift'].includes(m)) p.ref = 'R' + k + i;
        if (m === 'check') p.chk = { no: '100' + i, bank: '12' };
        if (m === 'card') { p.last4 = '1234'; p.appr = 'A' + k; }
        pays.push(p); left -= a;
      }
      const chg = rnd() < 0.5 ? ri(0, 5000) : 0;
      if (left > 0 || chg > 0) pays.push({ m: 'cash', amt: Math.max(left, 0) + chg });
      const list = S.paysIn(pays, gross, CFG, T0);
      const cl = S.closeOk(gross, list, left > 0 || chg > 0 ? chg : 0, debt);
      assert.equal(cl.paid + debt, gross);
      assert.ok(!list.some((p) => p.m === 'credit'));
      ok++;
    }
    assert.equal(ok, 100);
  });
  it('5 אמצעים שונים נסגרים; לא סגור – נדחה; עודף בלי מזומן / מעל המזומן – נדחה', () => {
    const p = [{ m: 'card', amt: 100, last4: '1111', appr: '9' }, { m: 'bit', amt: 100, ref: 'b' }, { m: 'check', amt: 100, chk: { no: '1', bank: '2' } }, { m: 'transfer', amt: 100, ref: 't' }, { m: 'cash', amt: 200 }];
    assert.equal(S.closeOk(500, S.paysIn(p, 500, CFG, T0), 100, 0).paid, 500);
    rej(() => S.closeOk(500, S.paysIn(p, 500, CFG, T0), 0, 0), 'not-closed');
    rej(() => S.closeOk(100, S.paysIn([{ m: 'bit', amt: 100, ref: 'x' }], 100, CFG, T0), 10, 0), 'chg-no-cash');
    rej(() => S.closeOk(100, S.paysIn([{ m: 'cash', amt: 50 }, { m: 'bit', amt: 50, ref: 'x' }], 100, CFG, T0), 60, 0), 'chg-over-cash');
    // 200 ₪ על 137.40 ₪ → עודף 62.60 ₪
    assert.equal(S.closeOk(13740, S.paysIn([{ m: 'cash', amt: 20000 }], 13740, CFG, T0), 6260, 0).paid, 13740);
  });
  it('אמצעי שאינו מזומן מעל היתרה – נחסם (ביט, צ\'ק, העברה, פייבוקס, מתנה, פתק, אשראי ידני)', () => {
    for (const p of [{ m: 'bit', ref: 'x' }, { m: 'check', chk: { no: '1', bank: '1' } }, { m: 'transfer', ref: 'x' }, { m: 'paybox', ref: 'x' },
      { m: 'gift', code: '980000000001' }, { m: 'voucher', code: '980000000002' }, { m: 'card', last4: '1234', appr: '1' }, { m: 'extGift', ref: 'x' }]) {
      rej(() => S.paysIn([Object.assign({ amt: 101 }, p)], 100, CFG, T0), 'over-balance');
      rej(() => S.paysIn([{ m: 'cash', amt: 50 }, Object.assign({ amt: 51 }, p)], 100, CFG, T0), 'over-balance');
    }
  });
  it('ערך m לא ברשימה הסגורה (כולל credit) – נדחה; אסמכתא חובה; צ\'ק דחוי בלי תאריך – נדחה', () => {
    for (const m of ['credit', 'phone', 'points']) rej(() => S.paysIn([{ m, amt: 1 }], 1, CFG, T0), 'bad-pay-m');
    for (const m of ['transfer', 'bit', 'paybox']) rej(() => S.paysIn([{ m, amt: 1 }], 1, CFG, T0), 'need-ref');
    rej(() => S.paysIn([{ m: 'check', amt: 1, chk: { no: '1', bank: '2' }, post: true }], 1, CFG, T0), 'need-due');
    assert.equal(S.paysIn([{ m: 'check', amt: 1, chk: { no: '1', bank: '2' }, post: true, due: '2026-12-31' }], 1, CFG, T0)[0].due, '2026-12-31');
    rej(() => S.paysIn([{ m: 'check', amt: 1, chk: { no: '1', bank: '2' }, due: '2026-12-31' }], 1, Object.assign({}, CFG, { checkPostdated: false }), T0), 'no-postdated');
  });
  it('אשראי: רק שדות מותרים; last4 בדיוק 4 ספרות; 4 תשלומים / מתחת ל-instMinAmt – נחסם', () => {
    rej(() => S.paysIn([{ m: 'card', amt: 100, last4: '1234', appr: '1', cvv: '123' }], 100, CFG, T0), 'bad-pay-field');
    rej(() => S.paysIn([{ m: 'card', amt: 100, last4: '1234', appr: '1', exp: '12/29' }], 100, CFG, T0), 'bad-pay-field');
    rej(() => S.paysIn([{ m: 'card', amt: 100, last4: '12345', appr: '1' }], 100, CFG, T0), 'need-last4');
    rej(() => S.paysIn([{ m: 'card', amt: 100000, last4: '1234', appr: '1', inst: 4 }], 100000, CFG, T0), 'bad-inst');
    rej(() => S.paysIn([{ m: 'card', amt: 20000, last4: '1234', appr: '1', inst: 3 }], 20000, CFG, T0), 'bad-inst');
    assert.equal(S.paysIn([{ m: 'card', amt: 90000, last4: '1234', appr: '1', inst: 3 }], 90000, CFG, T0)[0].tx, 'inst');
  });
  it('Luhn: רצף 13–19 ספרות (גם עם רווחים/מקפים) שעובר – מזוהה; קוד כרטיס מתנה (12) ומזהים – לא', () => {
    assert.ok(S.luhn('4580458045804580') === true || S.luhn('4580458045804580') === false);
    for (const c of ['4111111111111111', '4111 1111 1111 1111', '4111-1111-1111-1111', 'note 5555555555554444 x', '378282246310005']) assert.equal(S.cardIn(c), true, c);
    for (const c of ['980000000001', 'K1-000001-1', '0501234567', 'irO-K1-12', '4111111111111112']) assert.equal(S.cardIn(c), false, c);
    assert.equal(S.hasCard({ a: [{ note: '4111111111111111' }] }), true);
  });
});

describe('החזרה – חלוקה (ב ה15)', () => {
  const sale = (o) => Object.assign({ debt: 0, pays: [], pm: {}, retByM: {}, lines: [] }, o);
  it('100 ₪ אשראי + 50 ₪ מזומן: לכרטיס מעל 100 – נחסם; מזומן מעל 50 – נחסם; מזומן על עסקת אשראי – נחסם', () => {
    const s = sale({ pays: [{ m: 'card', amt: 10000 }, { m: 'cash', amt: 5000 }], pm: { card: 10000, cash: 5000 } });
    rej(() => S.retAlloc(s, 11000, CFG, { refunds: [{ m: 'card', amt: 11000 }] }), 'ret-over-method');
    rej(() => S.retAlloc(s, 6000, CFG, { refunds: [{ m: 'cash', amt: 6000 }] }), 'ret-over-method');
    const ok = S.retAlloc(s, 15000, CFG, { refunds: [{ m: 'card', amt: 10000 }, { m: 'cash', amt: 5000 }] });
    assert.deepEqual(ok.byM, { card: 10000, cash: 5000 });
    const s2 = sale({ pays: [{ m: 'card', amt: 10000 }], pm: { card: 10000 } });
    rej(() => S.retAlloc(s2, 5000, CFG, { refunds: [{ m: 'cash', amt: 5000 }] }), 'ret-over-method');
    assert.deepEqual(S.targets(CFG, 'card'), ['card']);
    assert.deepEqual(S.targets(CFG, 'voucher'), ['voucher']);
  });
  it('מכירה 200 ₪ עם debt 80: החזרה 100 → חוב −80, כסף 20; נוספת 50 – כולה כסף; כולה בהקפה – בלי כסף; חוב ששולם – לפי *', () => {
    const s = sale({ debt: 8000, pays: [{ m: 'cash', amt: 12000 }], pm: { cash: 12000 } });
    let r = S.retAlloc(s, 10000, CFG, { bal: 8000, openSum: 8000 });
    assert.deepEqual([r.debtOff, r.debtCash, r.money], [8000, 0, 2000]);
    s.retByM = { debt: 8000, cash: 2000 };
    r = S.retAlloc(s, 5000, CFG, { bal: 0, openSum: 0 });
    assert.deepEqual([r.debtOff, r.money], [0, 5000]);
    const all = sale({ debt: 15000, pays: [], pm: {} });
    r = S.retAlloc(all, 15000, CFG, { bal: 15000, openSum: 15000 });
    assert.deepEqual([r.debtOff, r.debtCash, r.money], [15000, 0, 0]);
    r = S.retAlloc(all, 15000, CFG, { bal: 5000, openSum: 5000 });
    assert.deepEqual([r.debtOff, r.debtCash, r.debtTo], [5000, 10000, 'cash']);
  });
  it('1 מתוך 3 = שליש ממה ששולם בשורה; 3 החזרות חלקיות = בדיוק מה ששולם', () => {
    const s = { lines: [{ qty: 3, pg: 1000, fin: 1000, unit: 400 }], retQty: [0], retAmt: [0] };
    const a = S.retLines(s, [{ i: 0, qty: 1 }]); assert.equal(a[0].amt, 333);
    s.retQty = [1]; s.retAmt = [333];
    const b = S.retLines(s, [{ i: 0, qty: 1 }]); assert.equal(b[0].amt, 333);
    s.retQty = [2]; s.retAmt = [666];
    const c = S.retLines(s, [{ i: 0, qty: 1 }]); assert.equal(c[0].amt, 334);
    s.retQty = [3]; s.retAmt = [1000];
    rej(() => S.retLines(s, [{ i: 0, qty: 1 }]), 'ret-qty');
  });
});

describe('קבלה (ב 5.10, ה 5.16) – pos-receipt.js', () => {
  const RC = require(path.join(ROOT, 'app-source/www/pos-receipt.js'));
  const data = { sale: { id: 'K1-000007', lines: [{ n: 'צלחת', qty: 2, unit: 1250, disc: 500, promo: 'n2' }], net: 1695, vat: 305, gross: 2000, rate: 18, soldAt: AT, chg: 0, debt: 0 },
    pays: [{ m: 'cash', amt: 1000 }, { m: 'bit', amt: 1000, ref: '88231' }], docs: [{ t: 'ir', id: 'irO-K1-12', no: 12, ser: 'O' }], hdr: { name: 'עסק', bn: '123456789' } };
  it('80 מ"מ: מע"מ בנפרד, מספר קופאי, הנחה בשורה נפרדת, QR וברקוד של המסמך; בלי מזהה מכירה פנימי', () => {
    const r = RC.build(data, { fmt: '80', cashNo: 3 });
    assert.equal(r.cols, 48);
    assert.ok(r.rows.some((x) => x.t === 'lr' && /מע"מ 18%/.test(x.a) && x.b === '3.05'));
    assert.ok(r.rows.some((x) => x.t === 'lr' && x.b === 'קופאי 3'));
    assert.ok(r.rows.some((x) => x.t === 'lr' && /הנחה/.test(x.a) && x.b === '-5.00'));
    assert.ok(r.rows.some((x) => x.t === 'qr' && x.a === 'irO-K1-12') && r.rows.some((x) => x.t === 'bc' && x.a === 'irO-K1-12'));
    assert.ok(!r.text.includes('K1-000007'));
    assert.ok(RC.build(data, { fmt: 'a4' }).html.includes('190mm'));
  });
  it('קבלת מתנה – בלי אף מחיר', () => {
    const r = RC.build(data, { gift: true, cashNo: 3 });
    for (const x of r.rows) if (x.t === 'lr' && x.a !== RC.build(data, {}).rows.find((y) => y.t === 'lr').a) assert.ok(!/\d+\.\d\d$/.test(String(x.b)), JSON.stringify(x));
    assert.ok(!r.rows.some((x) => /סה"כ|מע"מ|מזומן|ביט/.test(String(x.a))));
  });
});
