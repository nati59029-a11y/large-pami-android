'use strict';
// POS:W2 – איחוד גל 2, סבב 2 (18.11.2026): בדיקת Playwright לחיבורים של pos-w2.js בתוך index.html האמיתי (file://), עם שכבת הנתונים
// האמיתית (pos-data.js) ושרת מדומה (fnCall / fsx מוחלפים כאן). מכסה:
//   קטגוריות ואריחים – לשונית לכל קטגוריה ראשית שיש בה מוצרים (תת־קטגוריה בתוך הראשית, קטגוריה ריקה – בלי לשונית).
//   אישור אחראי – קופאי מבקש הנחה, חלון PIN אמיתי (posAuth leads / approve), קוד שגוי – הודעה, קוד נכון – ההנחה נכנסת; מזהה האישור נשלח ל-posSale.
//   מספר המסמך – הקבלה עם מספר המסמך מהשרת; בלי רשת – "ממתין למסמך", והמסמך מגיע כשהרשת חוזרת.
//   החזרה – posReturn עם המכירה, השורות, אמצעי ההחזר ומזהה האישור; חשבונית זיכוי בקבלה; החזרה שהשרת דחה – הודעה בחלון ולא נשארת בתור.
// הרצה: node tests/pos-w2-ui.e2e.js   (צריך playwright)
const { chromium } = require('playwright');
const path = require('node:path');
const assert = require('node:assert/strict');
const URL = 'file://' + path.join(__dirname, '../../app-source/www/index.html');
const modal = '#pos .pos-modal';
const txt = (page, sel) => page.locator(sel).first().innerText();

async function run(width, height) {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME, args: ['--no-sandbox'] } : {});
  const ctx = await browser.newContext({ viewport: { width, height }, locale: 'he-IL' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('lp-pos-dev', JSON.stringify({ bizId: 'biz-w2', dev: 'K1' })); localStorage.setItem('lp-pos-inst', 'inst_w2test_aaaaaaaaaaaa'); } catch (e) {} });
  await page.goto(URL);
  await page.waitForFunction(() => typeof window.posOpen === 'function' && !!window.PosData && window.PosData.isMock === false && !!window.PosApprove);
  await page.evaluate(() => {
    document.body.classList.remove('gate', 'susp'); const g = document.getElementById('gate'); if (g) g.style.display = 'none';
    SY.bizId = 'biz-w2'; SY.uid = 'u_cash'; SY.name = 'קופאית';
    window.Devices = undefined; // ההדפסות והמגירה – דרך הגרסה המדומה של PosUI.Dev (נספרות ב-PosUI.UI.printed / drawer)
    const F = (v) => (typeof v === 'number' ? { doubleValue: v } : { stringValue: String(v) });
    const doc = (coll, id, o) => ({ name: 'projects/x/databases/(default)/documents/b/biz-w2/' + coll + '/' + id, fields: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, F(v)])) });
    const PROD = [['p1', { name: 'קולה', price: 5, cat: 'drinks', barcode: '7290000000101' }], ['p2', { name: 'לחמניה', price: 3.5, cat: 'bake', barcode: '7290000000102' }], ['p3', { name: 'מיץ תפוזים', price: 8, cat: 'juice', barcode: '7290000000103' }]];
    const CAT = [['drinks', { name: 'משקאות', ord: 1 }], ['bake', { name: 'מאפים', ord: 2 }], ['misc', { name: 'שונות', ord: 3 }], ['juice', { name: 'מיצים', parent: 'drinks', ord: 4 }]];
    const W = window.__w2 = { calls: [], off: false, seq: 0, rseq: 0, doc: 1000, rejectRet: false };
    window.fsx = async (p) => {
      if (W.off) { const e = new Error('אין חיבור לאינטרנט'); e.offline = true; throw e; }
      if (p.startsWith('/prod')) return { documents: PROD.map(([id, o]) => doc('prod', id, o)) };
      if (p.startsWith('/cat')) return { documents: CAT.map(([id, o]) => doc('cat', id, o)) };
      if (p.startsWith('/posdev/')) return doc('posdev', 'K1', { lastSeq: W.seq });
      return { documents: [] };
    };
    const err = (reason, msg) => { const e = new Error(msg); e.details = { reason }; e.code = 'failed-precondition'; return e; };
    window.fnCall = async (fn, b) => {
      W.calls.push({ fn, b: JSON.parse(JSON.stringify(b || {})) });
      if (W.off) { const e = new Error('אין חיבור לאינטרנט'); e.offline = true; throw e; }
      if (fn === 'posAuth' && b.op === 'leads') return { ok: true, staff: [{ uid: 'u_lead', name: 'אבי', role: 'lead', locked: false }, { uid: 'u_mgr', name: 'מירב', role: 'manager', locked: false }] };
      if (fn === 'posAuth' && b.op === 'approve') {
        if (b.pin !== '4826') throw Object.assign(new Error('קוד שגוי. נותרו 4 ניסיונות'), { details: { reason: 'bad-pin' }, code: 'permission-denied' });
        return { ok: true, ap: 'ApW2test' + String(W.calls.length).padStart(6, '0'), by: b.by, name: 'אבי', role: 'lead', need: 'lead' };
      }
      if (fn === 'posSale') { W.seq = b.seq; W.doc += 1; return { ok: true, id: 'K1-' + String(b.seq).padStart(6, '0'), seq: b.seq, gross: b.gross, docs: [{ t: 'ir', id: 'irD-K1-' + b.seq, no: W.doc }] }; }
      if (fn === 'posReturn') {
        if (W.rejectRet) throw err('ret-qty', 'הכמות גדולה ממה שנשאר להחזרה בשורה');
        W.rseq += 1; const amt = (b.refunds || []).reduce((s, r) => s + r.amt, 0);
        return { ok: true, id: 'K1-R' + String(W.rseq).padStart(6, '0'), amt, debtOff: 0, refunds: (b.refunds || []).map((r) => Object.assign({ src: r.m }, r)), vouchers: [], docs: [{ t: 'cr', id: 'crD-K1-' + W.rseq, no: 500 + W.rseq }] };
      }
      throw err('not-found', 'לא קיים בבדיקה');
    };
  });
  await page.evaluate(() => window.posOpen());
  await page.waitForSelector('#pos #posCats');
  const tag = String(width);
  const tot = async () => (await txt(page, '#posTotal')).trim();

  // ---- קטגוריות ואריחים ----
  await page.waitForFunction(() => document.querySelectorAll('#posCats button').length >= 3);
  const tabs = await page.$$eval('#posCats button', (b) => b.map((x) => x.textContent.trim()));
  assert.deepEqual(tabs, ['מועדפים', 'משקאות', 'מאפים'], tag + ' לשוניות: רק קטגוריות ראשיות עם מוצרים, לפי הסדר');
  await page.click('#posCats [data-v=drinks]');
  await page.waitForFunction(() => document.querySelectorAll('#pos .pos-row').length === 2);
  const tiles = await page.$$eval('#pos .pos-row .n', (b) => b.map((x) => x.firstChild.textContent.trim()).sort());
  assert.deepEqual(tiles, ['מיץ תפוזים', 'קולה'].sort(), tag + ' משקאות: כולל תת־הקטגוריה מיצים');
  await page.click('#posCats [data-v=bake]');
  await page.waitForFunction(() => document.querySelectorAll('#pos .pos-row').length === 1);
  await page.click('#posCats [data-v=drinks]');
  await page.waitForFunction(() => document.querySelectorAll('#pos .pos-row').length === 2);

  // ---- אישור אחראי: קופאית מבקשת 10% הנחה ----
  await page.click('#pos .pos-row:has-text("קולה")'); await page.click('#pos .pos-row:has-text("קולה")');
  assert.equal(await tot(), '₪10.00', tag);
  assert.equal(await page.locator('#pos [data-pa=disc]').count(), 1, tag + ' לקופאית יש כפתור הנחה (באישור)');
  await page.click('#pos [data-pa=disc]'); await page.fill('#dPct', '10'); await page.click(`${modal} [data-v=ok]`);
  await page.waitForSelector('#apPin');
  await page.waitForFunction(() => document.querySelectorAll('#apBy option').length === 2);
  assert.match(await txt(page, `${modal} h2`), /נדרש אישור אחראי/, tag);
  await page.fill('#apPin', '0000'); await page.click(`${modal} [data-v=ok]`);
  await page.waitForSelector(`${modal} .pos-err`);
  assert.match(await txt(page, `${modal} .pos-err`), /קוד שגוי/, tag + ' קוד שגוי – הודעה, החלון נשאר');
  assert.equal(await tot(), '₪10.00', tag + ' בלי אישור – בלי הנחה');
  await page.fill('#apPin', '4826'); await page.click(`${modal} [data-v=ok]`);
  await page.waitForFunction(() => !document.querySelector('#pos .pos-modal'));
  assert.equal(await tot(), '₪9.00', tag + ' אחרי אישור – ההנחה נכנסה');
  const appr = await page.evaluate(() => window.__w2.calls.filter((c) => c.fn === 'posAuth' && c.b.op === 'approve').map((c) => c.b));
  assert.equal(appr.length, 2); assert.deepEqual([appr[1].act, appr[1].by, appr[1].pct, appr[1].dev], ['disc', 'u_lead', 10, 'K1'], tag);

  // ---- תשלום: מזהה האישור ל-posSale, מספר המסמך בקבלה ----
  await page.click('#posPay'); await page.click(`${modal} [data-pa=m][data-v=cash]`); await page.click(`${modal} [data-pa=q]`);
  await page.waitForSelector('#posChg');
  const s1 = await page.evaluate(() => window.__w2.calls.filter((c) => c.fn === 'posSale').map((c) => c.b));
  assert.equal(s1.length, 1); assert.equal(s1[0].gross, 900); assert.equal(s1[0].lines[0].mdisc.amt, 100);
  assert.deepEqual(s1[0].aps, [appr[1] && (await page.evaluate(() => window.POS_DEBUG.S.last.lines[0].mdisc.ap))], tag + ' aps');
  assert.ok(/^ApW2test/.test(s1[0].aps[0]), tag);
  let pr = await page.evaluate(() => PosUI.UI.printed.map((p) => ({ kind: p.kind, docs: p.doc.docs })));
  assert.deepEqual(pr[0].docs, [{ t: 'ir', id: 'irD-K1-1', no: 1001 }], tag + ' הקבלה מודפסת עם מספר המסמך מהשרת');
  await page.click('#pos [data-pa=last]');
  assert.match(await txt(page, `${modal} .pos-rcpt`), /חשבונית מס קבלה 1001/, tag);
  await page.click(`${modal} [data-v=no]`);

  // ---- בלי רשת: "ממתין למסמך", והמסמך מגיע כשהרשת חוזרת ----
  await ctx.setOffline(true); await page.evaluate(() => { window.__w2.off = true; });
  await page.click('#posCats [data-v=bake]'); await page.waitForFunction(() => document.querySelectorAll('#pos .pos-row').length === 1);
  await page.click('#pos .pos-row:has-text("לחמניה")');
  await page.click('#posPay'); await page.click(`${modal} [data-pa=m][data-v=cash]`); await page.click(`${modal} [data-pa=q]`);
  await page.waitForSelector('#posChg');
  pr = await page.evaluate(() => PosUI.UI.printed.map((p) => ({ kind: p.kind, docs: p.doc.docs })));
  assert.deepEqual(pr[1].docs, [], tag + ' בלי רשת – בלי מסמך');
  await page.click('#pos [data-pa=last]');
  assert.match(await txt(page, `${modal} .pos-rcpt`), /ממתין למסמך/, tag);
  await page.click(`${modal} [data-v=no]`);
  await page.evaluate(() => { window.__w2.off = false; }); await ctx.setOffline(false);
  await page.waitForFunction(() => { const l = window.POS_DEBUG.S.last; return l && Array.isArray(l.docs) && l.docs.length; }, null, { timeout: 15000 });
  await page.click('#pos [data-pa=last]');
  assert.match(await txt(page, `${modal} .pos-rcpt`), /חשבונית מס קבלה 1002/, tag + ' המסמך הגיע כשהרשת חזרה');
  await page.click(`${modal} [data-v=no]`);

  // ---- החזרה: posReturn עם אישור; חשבונית זיכוי ----
  await page.click('#pos [data-pa=nav][data-v=ret]');
  await page.waitForSelector(`${modal} [data-pa=pick][data-no="1"]`); await page.click(`${modal} [data-pa=pick][data-no="1"]`);
  await page.click(`${modal} .pos-line:has-text("קולה") [data-pa=rq][data-d="1"]`);
  assert.equal((await txt(page, '#retTotal')).trim(), '₪4.50', tag + ' מה ששולם בפועל (אחרי ההנחה)');
  await page.selectOption('#retWhy', { index: 1 }); await page.check('#retTag');
  await page.click(`${modal} [data-pa=do]`);
  await page.waitForSelector('#apPin'); await page.waitForFunction(() => document.querySelectorAll('#apBy option').length === 2);
  await page.fill('#apPin', '4826'); await page.click('#pos .pos-modal:last-child [data-v=ok]');
  await page.waitForFunction(() => !document.querySelector('#pos .pos-modal'));
  const r1 = await page.evaluate(() => window.__w2.calls.filter((c) => c.fn === 'posReturn').map((c) => c.b));
  assert.equal(r1.length, 1);
  assert.deepEqual([r1[0].op, r1[0].sale, r1[0].items, r1[0].refunds, r1[0].tag], ['do', 'K1-000001', [{ i: 0, qty: 1 }], [{ m: 'cash', amt: 450 }], true], tag);
  assert.ok(/^ApW2test/.test(r1[0].aps[0]) && typeof r1[0].reqId === 'string', tag + ' אישור ו-reqId להחזרה');
  pr = await page.evaluate(() => PosUI.UI.printed.filter((p) => p.kind === 'ret').map((p) => p.doc.docs));
  assert.deepEqual(pr[0], [{ t: 'cr', id: 'crD-K1-1', no: 501 }], tag + ' חשבונית זיכוי מהשרת');
  assert.ok(await page.evaluate(() => PosUI.UI.drawer.includes('refund')), tag + ' מגירה נפתחה להחזר במזומן');

  // ---- החזרה שהשרת דחה: הודעה בחלון, לא נשארת בתור ----
  await page.evaluate(() => { window.__w2.rejectRet = true; });
  await page.click('#pos [data-pa=nav][data-v=ret]');
  await page.waitForSelector(`${modal} [data-pa=pick][data-no="1"]`); await page.click(`${modal} [data-pa=pick][data-no="1"]`);
  await page.click(`${modal} .pos-line:has-text("קולה") [data-pa=rq][data-d="1"]`);
  await page.selectOption('#retWhy', { index: 1 }); await page.check('#retTag');
  await page.click(`${modal} [data-pa=do]`);
  await page.waitForSelector('#apPin'); await page.waitForFunction(() => document.querySelectorAll('#apBy option').length === 2);
  await page.fill('#apPin', '4826'); await page.click('#pos .pos-modal:last-child [data-v=ok]');
  await page.waitForSelector(`${modal} .pos-err`);
  assert.match(await txt(page, `${modal} .pos-err`), /הכמות גדולה ממה שנשאר/, tag);
  assert.equal(await page.evaluate(() => PosData.retPending()), 0, tag + ' ההחזרה שנדחתה לא בתור');
  await page.click(`${modal} [data-pa=x]`); await page.click(`${modal} [data-pa=x]`);

  // בלי גלישה אופקית, בלי שגיאות JS
  const ov = await page.evaluate(() => document.querySelector('#pos').scrollWidth - document.querySelector('#pos').clientWidth);
  assert.ok(ov <= 0, tag + ' overflow ' + ov);
  assert.deepEqual(errs.filter((e) => /pos|Pos/.test(e)), [], tag + ' שגיאות JS');
  await browser.close();
}

(async () => {
  for (const [w, h] of [[390, 844], [1280, 800]]) { await run(w, h); console.log('ok', w); }
  console.log('PASS');
})().catch((e) => { console.error(e); process.exit(1); });
