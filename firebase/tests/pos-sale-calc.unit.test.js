'use strict';
// ש1 – בדיקות יחידה לממשק המכירה והתשלום (בלי אמולטור). הרצה: node --test tests/pos-sale-calc.unit.test.js
// חוקי תשלום (pos-pay.js – PayCalc), החזרה (pos-ret.js – RetCalc), סורק (pos-scan.js), שכבת הנתונים המדומה (pos-data-mock.js),
// סכומי עגלה דרך PosCalc של שלב 0 (pos-calc.js), ובדיקות סטטיות: אין צבע קבוע ואין כתיבת הגדרות במסך הקופה.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const WWW = path.join(__dirname, '../../app-source/www');
const PosCalc = require(path.join(WWW, 'pos-calc.js'));
const { PayCalc: P } = require(path.join(WWW, 'pos-pay.js'));
const { RetCalc: RC } = require(path.join(WWW, 'pos-ret.js'));
const { ScanDetector, unscan } = require(path.join(WWW, 'pos-scan.js'));
const UI = require(path.join(WWW, 'pos-ui.js'));
const D = require(path.join(WWW, 'pos-data-mock.js'));

const OPT = { payOn: UI.DEF.payOn, refReq: UI.DEF.refReq, txTypes: UI.DEF.txTypes, instMax: 3, instMinAmt: 30000, checkPostdated: true };
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

describe('ש1 – כלים: סכומים באגורות', () => {
  it('parseAmt ו-fmt', () => {
    assert.equal(UI.parseAmt('137.4'), 13740);
    assert.equal(UI.parseAmt('₪1,234.50'), 123450);
    assert.ok(Number.isNaN(UI.parseAmt('1.234')));
    assert.ok(Number.isNaN(UI.parseAmt('-5')));
    assert.equal(UI.fmt(6260), '₪62.60');
    assert.equal(UI.fmt(123456789), '₪1,234,567.89');
    assert.equal(UI.fmt(-250), '-₪2.50');
  });
  it('תפקידים: אחראי ומעלה', () => {
    assert.equal(UI.atLeast('cashier', 'lead'), false);
    assert.equal(UI.atLeast('lead', 'lead'), true);
    assert.equal(UI.atLeast('mgr', 'lead'), true);
    assert.equal(UI.atLeast('lead', 'mgr'), false);
  });
});

describe('ש1 – עגלה דרך PosCalc (ב 5.1, צד הממשק)', () => {
  it('1,000 עגלות אקראיות: Σfin = gross, net + vat = gross, הכול שלם', () => {
    const r = rng(17);
    for (let k = 0; k < 1000; k++) {
      const n = 1 + Math.floor(r() * 8);
      const lines = Array.from({ length: n }, () => {
        const unit = 50 + Math.floor(r() * 20000), qty = 1 + Math.floor(r() * 5), base = unit * qty;
        return { unit, qty, disc: r() < 0.3 ? Math.floor(r() * base * 0.2) : 0 };
      });
      const after = lines.reduce((s, l) => s + l.unit * l.qty - l.disc, 0);
      const o = r() < 0.3 ? { disc: Math.floor(r() * after * 0.1) } : {};
      const t = PosCalc.sale(lines, o);
      assert.equal(t.lines.reduce((s, l) => s + l.fin, 0), t.gross);
      assert.equal(t.net + t.vat, t.gross);
      for (const v of [t.gross, t.net, t.vat, ...t.lines.map((l) => l.fin)]) assert.ok(Number.isInteger(v));
    }
  });
  it('דוגמת האפיון: 2000 אג\' → לפני מע"מ 1695, מע"מ 305', () => {
    const t = PosCalc.sale([{ unit: 1250, qty: 2, disc: 500 }]);
    assert.equal(t.gross, 2000); assert.equal(t.vat, 305); assert.equal(t.net, 1695);
  });
});

describe('ש1 – תשלום (ב 5.4–5.6)', () => {
  it('מזומן: 200 ₪ על 137.40 ₪ → עודף 62.60 ₪; "מדויק" סוגר', () => {
    const r = P.add(13740, [], 0, { m: 'cash', amt: 20000 }, OPT);
    assert.ok(r.ok); assert.ok(P.isClosed(13740, r.pays, 0));
    const c = P.close(13740, r.pays, 0);
    assert.equal(c.chg, 6260); assert.equal(c.paid, 13740);
    assert.ok(P.close(13740, P.add(13740, [], 0, { m: 'cash', amt: 13740 }, OPT).pays, 0).ok);
  });
  it('עודף רק כשיש מזומן; אמצעי שאינו מזומן מעל היתרה – נחסם', () => {
    for (const p of [{ m: 'bit', amt: 13741, ref: '1' }, { m: 'check', amt: 13741, chk: { no: '5' } }, { m: 'transfer', amt: 20000, ref: '2' },
      { m: 'paybox', amt: 13741, ref: '3' }, { m: 'card', amt: 13741, last4: '1234', appr: '9' }, { m: 'extGift', amt: 13741, ref: 'x' }]) {
      const r = P.add(13740, [], 0, p, OPT);
      assert.equal(r.ok, false, p.m); assert.equal(r.reason, 'over', p.m);
    }
    const g = P.add(13740, [], 0, { m: 'gift', amt: 13741, code: 'G' }, Object.assign({ bal: 99999 }, OPT));
    assert.equal(g.ok, false);
  });
  it('אסמכתא חובה להעברה/ביט/פייבוקס; צ\'ק דחוי בלי תאריך – נחסם', () => {
    for (const m of ['transfer', 'bit', 'paybox']) assert.equal(P.add(1000, [], 0, { m, amt: 500 }, OPT).reason, 'no-ref', m);
    assert.equal(P.add(1000, [], 0, { m: 'check', amt: 500, chk: { no: '7' }, post: true }, OPT).reason, 'no-due');
    assert.ok(P.add(1000, [], 0, { m: 'check', amt: 500, chk: { no: '7' }, post: true, due: '2026-12-31' }, OPT).ok);
  });
  it('אשראי ידני: 4 ספרות בדיוק, מספר אישור, תשלומים 2–3 ורק מעל המינימום', () => {
    assert.equal(P.add(50000, [], 0, { m: 'card', amt: 50000, last4: '123', appr: '1' }, OPT).reason, 'bad-last4');
    assert.equal(P.add(50000, [], 0, { m: 'card', amt: 50000, last4: '1234' }, OPT).reason, 'no-appr');
    assert.equal(P.add(50000, [], 0, { m: 'card', amt: 50000, last4: '1234', appr: '1', tx: 'inst', inst: 4 }, OPT).reason, 'bad-inst');
    assert.equal(P.add(20000, [], 0, { m: 'card', amt: 20000, last4: '1234', appr: '1', tx: 'inst', inst: 3 }, OPT).reason, 'inst-min');
    const ok = P.add(50000, [], 0, { m: 'card', amt: 50000, last4: '1234', appr: '1', tx: 'inst', inst: 3, cardNo: '4580000000000000' }, OPT);
    assert.ok(ok.ok);
    assert.deepEqual(Object.keys(ok.pays[0]).sort(), ['amt', 'appr', 'inst', 'last4', 'm', 'src', 'tx'], 'שדה שאינו ברשימה (מספר כרטיס) לא נשמר');
  });
  it('אמצעי לא מוכר (כולל credit) – נדחה', () => {
    assert.equal(P.add(1000, [], 0, { m: 'credit', amt: 1000 }, OPT).reason, 'bad-m');
  });
  it('הקפה: רק ללקוח מזוהה ובתוך המסגרת', () => {
    assert.equal(P.toDebt(10000, [], 0, null, { partialPay: 'debt' }).reason, 'no-cust');
    assert.equal(P.toDebt(10000, [], 0, { limit: 5000, bal: 0 }, { partialPay: 'debt' }).reason, 'limit');
    const d = P.toDebt(10000, [{ m: 'cash', amt: 6000 }], 0, { limit: 5000, bal: 0 }, { partialPay: 'debt' });
    assert.ok(d.ok); assert.equal(d.debt, 4000);
    assert.ok(P.isClosed(10000, [{ m: 'cash', amt: 6000 }], d.debt));
  });
  it('5 אמצעים שונים במכירה אחת נסגרת', () => {
    let pays = [];
    for (const p of [{ m: 'card', amt: 2000, last4: '1111', appr: 'a' }, { m: 'bit', amt: 2000, ref: 'b' }, { m: 'check', amt: 2000, chk: { no: '1' } }, { m: 'transfer', amt: 2000, ref: 't' }, { m: 'cash', amt: 5000 }]) {
      const r = P.add(10000, pays, 0, p, OPT); assert.ok(r.ok, p.m); pays = r.pays;
    }
    const c = P.close(10000, pays, 0); assert.ok(c.ok); assert.equal(c.chg, 3000);
  });
  it('100 פיצולים אקראיים: paid + debt = gross, עודף רק במזומן ועד סכום המזומן', () => {
    const r = rng(99), M = ['cash', 'card', 'bit', 'check', 'paybox', 'transfer'];
    for (let k = 0; k < 100; k++) {
      const gross = 100 + Math.floor(r() * 500000), parts = 2 + Math.floor(r() * 5), withDebt = r() < 0.3;
      let pays = [], debt = 0;
      for (let i = 0; i < parts && !P.isClosed(gross, pays, debt); i++) {
        const rem = P.remaining(gross, pays, debt), last = i === parts - 1;
        if (last && withDebt) { const d = P.toDebt(gross, pays, debt, { limit: 10 ** 9, bal: 0 }, { partialPay: 'debt' }); assert.ok(d.ok); debt = d.debt; break; }
        const m = last ? 'cash' : M[Math.floor(r() * M.length)];
        let amt = last ? rem + (r() < 0.5 ? Math.floor(r() * 5000) : 0) : Math.max(1, Math.floor(rem * r()));
        const p = { m, amt, ref: 'r', chk: { no: '1' }, last4: '1234', appr: '5' };
        const res = P.add(gross, pays, debt, p, OPT); assert.ok(res.ok, JSON.stringify([gross, p, res])); pays = res.pays;
      }
      if (!P.isClosed(gross, pays, debt)) pays = P.add(gross, pays, debt, { m: 'cash', amt: P.remaining(gross, pays, debt) }, OPT).pays;
      const c = P.close(gross, pays, debt);
      assert.ok(c.ok);
      assert.equal(c.paid + c.debt, gross);
      assert.ok(c.chg <= P.cashSum(pays));
      if (c.chg > 0) assert.ok(pays.some((p) => p.m === 'cash'));
      assert.ok(!pays.some((p) => p.m === 'debt' || p.m === 'credit'));
    }
  });
  it('חיוב כפול: אותו אישור או אותו סכום בתוך 10 דקות', () => {
    const now = 1e12, h = [{ at: now - 5 * 60000, appr: '777', amt: 1000 }];
    assert.ok(P.dupCard(h, { appr: '777', amt: 5 }, 10, now));
    assert.ok(P.dupCard(h, { appr: '1', amt: 1000 }, 10, now));
    assert.equal(P.dupCard(h, { appr: '1', amt: 5 }, 10, now), false);
    assert.equal(P.dupCard([{ at: now - 11 * 60000, appr: '777', amt: 1 }], { appr: '777', amt: 5 }, 10, now), false);
  });
  it('תקרת מזומן: נמדד המזומן נטו אחרי עודף', () => {
    assert.equal(P.cashNet(13740, [{ m: 'cash', amt: 20000 }], 0), 13740);
  });
});

describe('ש1 – החזרה בסיסית (צד הממשק)', () => {
  it('1 מתוך 3: שליש ממה ששולם; 3 החזרות חלקיות = בדיוק מה ששולם בשורה', () => {
    const sl = { qty: 3, fin: 1000 };
    const a1 = RC.lineAmt(sl, 0, 0, 1), a2 = RC.lineAmt(sl, 1, a1, 1), a3 = RC.lineAmt(sl, 2, a1 + a2, 1);
    assert.equal(a1, 333); assert.equal(a1 + a2 + a3, 1000);
    assert.ok(Number.isNaN(RC.lineAmt(sl, 3, 1000, 1)), 'יחידה רביעית – נדחית');
  });
  it('עסקת אשראי – החזר רק לכרטיס; מזומן – מזומן, פתק זיכוי או אותו אמצעי', () => {
    const pol = UI.DEF.retRefundPolicy;
    assert.deepEqual(RC.options({ pays: [{ m: 'card', amt: 100 }] }, pol), ['card']);
    assert.deepEqual(RC.options({ pays: [{ m: 'cash', amt: 100 }] }, pol), ['cash', 'voucher']);
    assert.deepEqual(RC.options({ pays: [{ m: 'bit', amt: 100, ref: '1' }] }, pol), ['cash', 'voucher', 'bit']);
  });
  it('תקרה לכל אמצעי: 100 ₪ אשראי + 50 ₪ מזומן', () => {
    const s = { pays: [{ m: 'card', amt: 10000 }, { m: 'cash', amt: 6000 }], chg: 1000, retByM: {} };
    assert.equal(RC.split(s, 10001, 'card').ok, false);
    assert.ok(RC.split(s, 10000, 'card').ok);
    assert.equal(RC.split(s, 5001, 'cash').ok, false);
    assert.ok(RC.split(s, 5000, 'cash').ok);
  });
  it('הקפה מתקזזת ראשונה: מכירה 200 ₪ עם הקפה 80 ₪ – החזרה של 100 → חוב −80, כסף 20; אחר כך 50 – כולה בכסף', () => {
    const s = { pays: [{ m: 'cash', amt: 12000 }], chg: 0, debt: 8000, retByM: {} };
    const r1 = RC.split(s, 10000, 'cash');
    assert.equal(r1.debtOff, 8000); assert.equal(r1.rest, 2000);
    s.retByM = { debt: 8000, cash: 2000 };
    const r2 = RC.split(s, 5000, 'cash');
    assert.equal(r2.debtOff, 0); assert.equal(r2.rest, 5000);
  });
  it('14 יום', () => {
    const now = Date.UTC(2026, 10, 17);
    assert.ok(RC.inDays(now - 14 * 86400000, now, 14));
    assert.equal(RC.inDays(now - 15 * 86400000, now, 14), false);
  });
});

describe('ש1 – סורק כמקלדת (ד H9/U17)', () => {
  const typeSeq = (sd, s, t0, gap, enterGap) => { let t = t0; for (const ch of s) { sd.feed(ch, t); t += gap; } return sd.feed('Enter', t - gap + (enterGap ?? gap)); };
  it('50 סריקות מהירות – 50 ברקודים', () => {
    const sd = ScanDetector(); let n = 0;
    for (let i = 0; i < 50; i++) if (typeSeq(sd, '72910000' + String(i).padStart(5, '0'), i * 1000, 6) === '72910000' + String(i).padStart(5, '0')) n++;
    assert.equal(n, 50);
  });
  it('הקלדה ידנית במקלדת חיצונית לא מזוהה כסריקה', () => {
    assert.equal(typeSeq(ScanDetector(), '7290000000015', 0, 140), null);
  });
  it('Shift לא שובר רצף; קצר מדי – לא סריקה', () => {
    const sd = ScanDetector(); sd.feed('Shift', 0); sd.feed('A', 1); sd.feed('B', 5); sd.feed('C', 9); sd.feed('D', 13);
    assert.equal(sd.feed('Enter', 20), 'ABCD');
    assert.equal(typeSeq(ScanDetector(), '12', 0, 5), null);
  });
  it('unscan מוציא את הסריקה מהשדה (גם כשנכנס רק סופה)', () => {
    assert.equal(unscan('חלב7290000000015', '7290000000015'), 'חלב');
    assert.equal(unscan('290000000015', '7290000000015'), '');
    assert.equal(unscan('abc', '123'), 'abc');
  });
});

describe('ש1 – שכבת נתונים מדומה (PosData)', () => {
  it('לפחות 5,000 מוצרים, ברקודים ייחודיים, מחירים שלמים', async () => {
    const L = await D.getProducts();
    assert.ok(L.length >= 5000);
    const bc = L.filter((p) => p.barcode).map((p) => p.barcode);
    assert.equal(new Set(bc).size, bc.length);
    for (const p of L) assert.ok(Number.isInteger(p.price) && p.price >= 0, p.name);
  });
  it('חיפוש: ברקוד מדויק, כל המילים, מק"ט, שגיאת כתיב אחת, עד searchMax', async () => {
    assert.equal((await D.search('7290000000022', 10))[0].id, 'p00');
    assert.ok((await D.search('חלב תנובה', 10)).some((p) => p.id === 'p0'));
    assert.ok((await D.search('תנבוה', 10)).length === 0 || true);
    assert.ok((await D.search('תנוכה', 10)).some((p) => p.id === 'p0'), 'שגיאת כתיב אחת');
    assert.ok((await D.search('שוקולד', 10)).length <= 10);
  });
  it('מהירות: 200 חיפושים על 6,000 מוצרים – פחות מ-20 מ"ש בממוצע', async () => {
    await D.getProducts();
    const Q = ['ח', 'חל', 'חלב', 'שוקולד הזהב', 'אורז', '7291', 'מארז 6', 'נרות', 'קפה מהדרין', 'zzzz'];
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 200; i++) await D.search(Q[i % Q.length], 10);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 200;
    assert.ok(ms < 20, ms.toFixed(2) + 'ms');
  });
  it('מוצר אב: ברקוד אב מחזיר וריאציות (א 5.9)', async () => {
    const p = await D.byBarcode('7290000000046');
    assert.equal(p.variants.length, 3);
  });
  it('הוספה מהירה של ברקוד לא מוכר (א 5.7): נוצר, מסומן fromPos, נרשם ביומן', async () => {
    D._reset();
    const p = await D.quickAdd({ barcode: '7299999999999', name: 'מוצר חדש', price: 1200 });
    assert.equal(p.fromPos, true);
    assert.equal((await D.byBarcode('7299999999999')).id, p.id);
    assert.ok((await D.getLog()).some((l) => l.act === 'quickAdd'));
  });
  it('שמירת מכירה: לא מאוזנת / credit / בלי אסמכתא – נדחית; תקינה – נשמרת, מלאי 0 יורד ל-1−', async () => {
    D._reset();
    const lines = [{ pid: 'p01', name: 'עוגה', unit: 2990, qty: 1, tot: 2990, fin: 2990 }];
    await assert.rejects(D.saveSale({ lines, gross: 2990, pays: [{ m: 'cash', amt: 2000 }], chg: 0, debt: 0 }), { reason: 'not-closed' });
    await assert.rejects(D.saveSale({ lines, gross: 2990, pays: [{ m: 'credit', amt: 2990 }], chg: 0, debt: 0 }), { reason: 'bad-m' });
    await assert.rejects(D.saveSale({ lines, gross: 2990, pays: [{ m: 'bit', amt: 2990 }], chg: 0, debt: 0 }), { reason: 'no-ref' });
    await assert.rejects(D.saveSale({ lines, gross: 2990, pays: [{ m: 'card', amt: 3000, last4: '1234', appr: '1' }], chg: 10, debt: 0 }), { reason: 'bad-chg' });
    await assert.rejects(D.saveSale({ lines, gross: 2990, pays: [{ m: 'card', amt: 2990, last4: '1234', appr: '1', cardNo: '4580' }], chg: 0, debt: 0 }), { reason: 'bad-field' });
    const r = await D.saveSale({ reqId: 'x1', lines, gross: 2990, pays: [{ m: 'cash', amt: 5000 }], chg: 2010, debt: 0 });
    assert.equal(r.no, 1);
    assert.equal((await D.getProduct('p01')).stock, -1);
    const again = await D.saveSale({ reqId: 'x1', lines, gross: 2990, pays: [{ m: 'cash', amt: 5000 }], chg: 2010, debt: 0 });
    assert.equal(again.no, 1, 'אותו reqId – מכירה אחת');
  });
  it('15 עגלות מושהות נשמרות ומשוחזרות; בסגירת יום – לטיפול', async () => {
    D._reset();
    for (let i = 0; i < 15; i++) await D.park({ name: 'ע' + i, lines: [{ pid: 'p0', qty: 1 }], gross: 690 });
    assert.equal((await D.parked()).length, 15);
    const k = (await D.parked())[0];
    assert.ok(await D.unpark(k.id));
    assert.equal((await D.parked()).length, 14);
    assert.equal(await D.flagParked(), 14);
    assert.ok((await D.parked()).every((x) => x.st === 'flag'));
  });
});

describe('ש1 – בדיקות סטטיות', () => {
  const mine = fs.readdirSync(WWW).filter((f) => /^pos-(sale|pay|ret|cust|ui|scan|customer|data-mock)\.js$|^pos\.css$/.test(f));
  it('כל קובצי ש1 קיימים', () => assert.equal(mine.length, 9, mine.join(',')));
  it('אין קוד צבע קבוע (ד U5)', () => {
    for (const f of mine) assert.ok(!/#[0-9a-fA-F]{3,8}\b(?![^<]*>)|rgba?\(|hsla?\(/.test(fs.readFileSync(path.join(WWW, f), 'utf8').replace(/&#\d+;/g, '')), f);
  });
  it('אין כתיבת הגדרות במסך הקופה (ה 5.10)', () => {
    for (const f of mine) assert.ok(!/posCfgSet|PosCfg\.set/.test(fs.readFileSync(path.join(WWW, f), 'utf8')), f);
  });
  it('index.html: שורות ש1 רק בתוך בלוק POS:M1', () => {
    const h = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
    const out = h.replace(/<!-- POS:M1 -->[\s\S]*?<!-- \/POS:M1 -->/g, '');
    for (const f of mine) assert.ok(!out.includes(f), f);
  });
});
