'use strict';
// 14.11.2026 (משוב בעל הפרויקט, סבב 2 – סעיפים 2 ו-5): לקוח בשוטף (תנאי תשלום שאינם מיידי) – בלי "תשלום בטלפון"/"לתשלום", בלי מסך כרטיס בסוף ההזמנה,
// "נשלח" במקום "ממתין לתשלום", הזמנה שנשלחה נעולה ו"נשלח בתאריך". לקוח מיידי/פרטי – כמו היום. רשת מדומה. שימוש: node ui-ord-terms.js <www-dir> [out.json] [shots-dir]
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const out = {}; let fail = 0;
const check = (name, ok, info) => { out[name] = { ok: !!ok, info }; if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 500) : '')); };
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
const S = (v) => ({ stringValue: v }), N = (v) => (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }), M = (o) => ({ mapValue: { fields: o } }), A = (a) => ({ arrayValue: { values: a } });
const doc = (p, f) => ({ document: { name: 'projects/demo-largpeami/databases/(default)/documents/b/biz-o/' + p, fields: f } });
const T1 = Date.UTC(2026, 10, 3, 8, 0, 0), T2 = Date.UTC(2026, 10, 12, 9, 0, 0);
const CUST = [doc('cust/cT', { name: S('חברת שוטף'), bn: S('חברת שוטף'), phone: S('0541111111'), terms: M({ b: S('eom'), d: N(30) }) }),
  doc('cust/cN', { name: S('ישן שוטף 60'), phone: S('0541111113'), pay: S('n60') }),
  doc('cust/cI', { name: S('עסקי מיידי'), bn: S('עסקי מיידי'), phone: S('0541111114'), terms: M({ b: S('imm'), d: N(0) }) }),
  doc('cust/cP', { name: S('פרטי'), phone: S('0541111115'), pay: S('cash') })];
const it1 = () => A([M({ pid: S('pA'), n: S('עוגה'), qty: N(1), price: N(12) })]);
const o = (id, no, st, custId, x) => doc('ord/' + id, Object.assign({ no: N(no), br: S('br1'), status: S(st), total: N(12), at: N(T1), custId: S(custId), cust: M({ name: S('לקוח ' + no), phone: S('0541111111') }), items: it1() }, x || {}));
const ORD = [o('o1', 1, 'work', 'cT'), o('o2', 2, 'wait_pay', 'cT', { shp: M({ at: N(T2), by: S('w') }) }), o('o3', 3, 'work', 'cP'), o('o4', 4, 'work', 'cN'), o('o5', 5, 'work', 'cI'),
  o('o6', 6, 'done', 'cT', { shp: M({ at: N(T2), by: S('w') }), paid: M({ method: S('transfer'), amt: N(12), at: N(T2), by: S('w') }) }), o('o7', 7, 'wait_pay', 'cP')];
const PROD = [doc('prod/pA', { name: S('עוגה'), price: N(12), on: { booleanValue: true }, q: M({ br1: N(5) }) })];

async function open(browser, www, who, calls) {
  const cfg = { mode: 'new', users: { m: 'biz-o', w: 'biz-o' }, biz: { 'biz-o': { dataRoot: 'b', features: ALL, name: 'עסק בדיקה' } }, admins: { 'b/biz-o/|m': 1 }, staff: { 'b/biz-o/|w': 1 } };
  const log = [];
  const { ctx, page } = await H.newPage(browser, www, cfg, log, 'tr' + who);
  page.on('pageerror', (e) => log.push('pageerror: ' + e.message));
  await ctx.route(/:8080\/.*/, async (route) => {
    const req = route.request(); const u = new URL(req.url()); const body = req.postData() || '';
    const J = (st, b) => route.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(b) });
    if (/:runQuery$/.test(u.pathname)) { let c = ''; try { c = JSON.parse(body).structuredQuery.from[0].collectionId; } catch (e) { /* */ }
      return J(200, c === 'ord' ? ORD : c === 'prod' ? PROD : c === 'cust' ? CUST : [{ readTime: '2026-11-03T09:00:00Z' }]); }
    const cm = /\/cust\/([^/]+)$/.exec(u.pathname); if (cm) { const d = CUST.find((x) => x.document.name.endsWith('/' + cm[1])); return d ? J(200, d.document) : J(404, { error: { code: 404 } }); }
    if (/\/ordcfg\/main$/.test(u.pathname)) return J(200, { name: 'x', fields: { pay: M({ mode: S(globalThis.__PAY || 'phone') }), src: M({ br1: S('stock') }) } });
    if (/\/ord\/o\d\/log/.test(u.pathname)) return J(200, { documents: [] });
    if (/\/documents\/b\/biz-o$/.test(u.pathname) && req.method() === 'GET') return J(200, { name: 'x', fields: { dataRoot: S('b'), status: S('active'), name: S('עסק בדיקה'), features: M(Object.fromEntries(Object.keys(ALL).map((k) => [k, { booleanValue: true }]))) } });
    return route.fallback();
  });
  await ctx.route(/:5001\/.*/, async (route) => {
    const n = new URL(route.request().url()).pathname.split('/').pop(); let d = {}; try { d = JSON.parse(route.request().postData()).data; } catch (e) { /* */ }
    calls.push({ n, d });
    const R = { getCosts: { cost: {} }, createOrder: { id: 'oN', no: 9, total: 12 }, saveCust: { ok: true, id: d && d.id }, setOrderStatus: { ok: true, status: 'wait_pay' }, ordProfit: { n: 0, total: 0, paid: 0, paidN: 0 } };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: R[n] || { ok: true } }) });
  });
  await H.login(page, who + '@x.co');
  await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden && ACT.startBlank) ACT.startBlank(); });
  await page.setViewportSize({ width: 360, height: 740 });
  return { ctx, page, log };
}

(async () => {
  const [www, outFile, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const shot = async (page, n) => { if (shots) await page.screenshot({ path: path.join(shots, n + '.png'), fullPage: true }); };
  const browser = await H.launch();
  const card = async (page, id) => { await page.evaluate((i) => go('oxOrd', i), id); await H.settle(page, 1200); await page.evaluate((i) => go('oxOrd', i), id); await H.settle(page, 400);
    return page.evaluate(() => { const m = document.getElementById('main'); const st = [...m.querySelectorAll('[data-a=oxStat]')].map((b) => b.dataset.s + ':' + b.innerText.trim());
      return { st, pay: !!m.querySelector('[data-a=oxPay]'), phone: /תשלום בטלפון/.test(m.innerText), paid: !!m.querySelector('[data-a=oxPaid]'), edit: !!m.querySelector('[data-a=oxEdit]'),
        unpay: !!m.querySelector('[data-a=oxUnpay]'), cancel: !!m.querySelector('[data-a=oxCancel]'), ccard: !!m.querySelector('#ocordcard'), shp: /נשלח בתאריך/.test(m.innerText), lock: /הסכום נעול/.test(m.innerText), ov: document.documentElement.scrollWidth - innerWidth }; }); };

  for (const who of ['w', 'm']) {
    const calls = []; const { ctx, page, log } = await open(browser, www, who, calls);
    await page.evaluate(() => go('ox')); await H.settle(page, 1500);
    await page.evaluate(() => ['cT', 'cN', 'cI', 'cP', 'nope'].forEach((id) => window.__onTerms(id))); await H.settle(page, 800); // לקוח שעוד לא נטען – false ונטען ברקע
    const fn = await page.evaluate(() => ['cT', 'cN', 'cI', 'cP', '', 'nope'].map((id) => window.__onTerms(id)));
    check(who + ' 0 __onTerms: שוטף+30 / ישן n60 – כן; מיידי / פרטי / בלי לקוח – לא', JSON.stringify(fn) === JSON.stringify([true, true, false, false, false, false]), fn);
    const c1 = await card(page, 'o1'); await shot(page, who + '-01-בשוטף-בטיפול');
    check(who + ' 1 בשוטף, בטיפול: "נשלח" (out) במקום "ממתין לתשלום", בלי תשלום בטלפון/לתשלום, "סמן שולם" נשאר, עריכה נשארת, בלי משבצת כרטיס, בלי גלילה לרוחב',
      JSON.stringify(c1.st) === JSON.stringify(['out:נשלח', 'new:חדשה']) && !c1.pay && !c1.phone && c1.paid && c1.edit && !c1.ccard && !c1.shp && c1.ov <= 0, c1);
    const c2 = await card(page, 'o2'); await shot(page, who + '-02-נשלח');
    check(who + ' 2 נשלח (wait_pay+shp): "נשלח בתאריך", נעול לעריכה, אין חזרה לבטיפול, בלי כפתורי תשלום, "סמן שולם" נשאר, בלי "ביטול הזמנה"', !c2.cancel && c2.st.length === 0 && c2.shp && !c2.edit && c2.lock && !c2.pay && !c2.phone && c2.paid && c2.ov <= 0, c2);
    const c3 = await card(page, 'o3');
    check(who + ' 3 פרטי, בטיפול – כמו היום: "ממתין לתשלום" + "חדשה", תשלום בטלפון, סמן שולם, עריכה, משבצת כרטיס', JSON.stringify(c3.st) === JSON.stringify(['wait_pay:ממתין לתשלום', 'new:חדשה']) && c3.phone && c3.paid && c3.edit && c3.ccard && c3.cancel && !c3.shp, c3);
    const c4 = await card(page, 'o4');
    check(who + ' 4 לקוח ישן שוטף+60: "נשלח", בלי תשלום בטלפון', JSON.stringify(c4.st) === JSON.stringify(['out:נשלח', 'new:חדשה']) && !c4.phone && c4.paid, c4);
    const c5 = await card(page, 'o5');
    check(who + ' 5 עסקי מיידי – כמו פרטי', JSON.stringify(c5.st) === JSON.stringify(['wait_pay:ממתין לתשלום', 'new:חדשה']) && c5.phone && c5.paid && c5.edit, c5);
    const c7 = await card(page, 'o7');
    check(who + ' 5א פרטי, ממתין לתשלום – כמו היום ("בטיפול", תשלום בטלפון)', JSON.stringify(c7.st) === JSON.stringify(['work:בטיפול']) && c7.phone && c7.edit, c7);
    const c6 = await card(page, 'o6');
    check(who + ' 6 נשלח ושולם (הושלם): ' + (who === 'm' ? 'מנהל רואה ביטול "שולם"' : 'עובד לא רואה ביטול "שולם"'), c6.shp && c6.st.length === 0 && c6.unpay === (who === 'm') && !c6.edit, c6);
    // לחיצה על "נשלח"
    await card(page, 'o1'); const n0 = calls.length; await page.click('[data-a=oxStat][data-s=out]'); await H.settle(page, 800);
    const sc = calls.slice(n0).find((x) => x.n === 'setOrderStatus');
    check(who + ' 7 לחיצה על "נשלח" → setOrderStatus {status:out}', !!sc && sc.d.id === 'o1' && sc.d.status === 'out', sc && sc.d);
    // טופס הזמנה: לקוח בשוטף – נשמר בלי מסך הכרטיס; פרטי (תשלום בטלפון, בלי ניוד) – מסך הכרטיס כמו היום
    const save = async (cid) => { await page.evaluate(() => { window.__ox.draft = null; NAV = [{ v: 'home' }]; go('oxNew'); }); await H.settle(page, 400);
      await page.selectOption('select[data-k=br]', 'br1').catch(() => {}); await page.fill('input[data-k=phone]', '0541111199'); await H.settle(page, 500);
      await page.fill('input[data-k=fn]', 'גל').catch(() => {}); await page.fill('input[data-k=ln]', 'לוי').catch(() => {}); await page.fill('#oxq', 'עוגה'); await page.click('[data-a=oxAdd]'); await H.settle(page, 300);
      await page.evaluate((c) => { window.__ox.draft.custId = c; window.__onTerms(c); }, cid); await H.settle(page, 500);
      const a0 = calls.length; await page.click('[data-a=oxSave]'); await H.settle(page, 1200);
      return { v: await page.evaluate(() => cur().v), co: calls.slice(a0).some((x) => x.n === 'createOrder'), mid: false }; };
    const sT = await save('cT'); const sP = await save('cP');
    check(who + ' 8 טופס: לקוח בשוטף – נשמר ישר בלי מסך כרטיס; פרטי (תשלום בטלפון) – מסך הכרטיס כמו היום', sT.co && sT.v !== 'ocCardStep' && !sP.co && sP.v === 'ocCardStep', { sT, sP });
    const errs = log.filter((x) => /pageerror|TypeError|ReferenceError/.test(x));
    check(who + ' 9 בלי שגיאות JS', errs.length === 0, errs.slice(0, 3));
    await ctx.close();
  }
  await browser.close();
  if (outFile) fs.writeFileSync(outFile, JSON.stringify({ out }, null, 1));
  console.log(fail ? `תוצאה: נכשל (${fail})` : 'תוצאה: הכול עבר'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
