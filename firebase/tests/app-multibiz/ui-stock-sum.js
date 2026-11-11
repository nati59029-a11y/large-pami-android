'use strict';
// סיכום מלאי (שורת מוצרים/יחידות/שווי לפני מע"מ, מנהל בלבד) + מספר לקוחות בולט. רשת מדומה.
// שימוש: node ui-stock-sum.js <www-dir> [out.json] [shots-dir]
const fs = require('fs');
const path = require('path');
const H = require('./harness');
let fail = 0;
const check = (name, ok, info) => { if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
const S = (v) => ({ stringValue: v }), N = (v) => (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }), M = (o) => ({ mapValue: { fields: o } }), A = (a) => ({ arrayValue: { values: a } });
const doc = (p, f) => ({ document: { name: 'projects/demo-largpeami/databases/(default)/documents/b/biz-o/' + p, fields: f } });
// 3 מוצרים: pA עלות 11.8 כולל מע"מ (=10.00 לפני) כמויות 5+1; pB בלי עלות 0+8; pC עלות 5.9 (=5.00) כמות -2 ב-br1
const PROD = [doc('prod/pA', { name: S('מוצר א'), price: N(12), on: { booleanValue: true }, q: M({ br1: N(5), br2: N(1) }) }),
  doc('prod/pB', { name: S('מוצר ב'), price: N(10), on: { booleanValue: true }, q: M({ br1: N(0), br2: N(8) }) }),
  doc('prod/pC', { name: S('מוצר ג'), price: N(9), on: { booleanValue: true }, q: M({ br1: N(-2) }) })];
const COST = { pA: 11.8, pC: 5.9 };
const CUST = [1, 2, 3, 4, 5, 6, 7].map((i) => doc('cust/c' + i, { name: S('לקוח ' + i), phone: S('05000000' + String(i).padStart(2, '0')) }));
const ORG = M({ v: N(1), branches: A([M({ id: S('br1'), name: S('סניף 1'), on: { booleanValue: true } }), M({ id: S('br2'), name: S('סניף 2'), on: { booleanValue: true } })]) });

(async () => {
  const [www, outFile, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const browser = await H.launch();
  const cfg = { mode: 'new', users: { m: 'biz-o', sa: 'biz-o' }, sa: { sa: 1 }, biz: { 'biz-o': { dataRoot: 'b', features: ALL, name: 'עסק בדיקה' } }, admins: { 'b/biz-o/|m': 1 }, ctx: { hasTouch: true, isMobile: true } };
  const log = []; const calls = [];
  const { ctx, page } = await H.newPage(browser, www, cfg, log, 'm');
  await ctx.route(/:8080\/.*/, async (route) => {
    const req = route.request(); const u = new URL(req.url()); const body = req.postData() || '';
    if (/:runQuery$/.test(u.pathname)) { let c = ''; try { c = JSON.parse(body).structuredQuery.from[0].collectionId; } catch (e) { /* */ }
      const r = c === 'cust' ? CUST : c === 'prod' ? PROD : [{ readTime: '2026-11-03T09:00:00Z' }];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(r) }); }
    if (/\/ordcfg\/main$/.test(u.pathname)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ name: 'x', fields: { src: M({ br1: S('stock') }) } }) });
    if (/\/custcfg\/main$/.test(u.pathname)) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":{"code":404}}' });
    if (/\/documents\/b\/biz-o$/.test(u.pathname) && req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ name: 'x', fields: { dataRoot: S('b'), status: S('active'), name: S('עסק בדיקה'), features: M(Object.fromEntries(Object.keys(ALL).map((k) => [k, { booleanValue: true }]))), org: ORG } }) });
    return route.fallback();
  });
  await ctx.route(/:5001\/.*/, async (route) => {
    const n = new URL(route.request().url()).pathname.split('/').pop(); calls.push(n);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: n === 'getCosts' ? { cost: COST } : { ok: true } }) });
  });
  await H.login(page, 'm@x.co');
  await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden) ACT.startBlank(); });
  await H.settle(page, 500);
  await page.setViewportSize({ width: 390, height: 844 });
  const goV = (v) => page.evaluate((v) => { NAV = [{ v: 'home' }]; go(v); }, v);
  const txt = (id) => page.evaluate((id) => { const e = document.getElementById(id); return e ? e.innerText.replace(/\s+/g, ' ').trim() : null; }, id);

  // יחידת חישוב: באגורות
  const u = await page.evaluate(() => ({ a: oxStockSum([{ id: 'x', q: { b: 3 } }], { x: 0.1 }, 18, 'b'), b: oxStockSum([{ id: 'x', q: { b: 3 } }], null, 18, 'b'), c: oxStockSum([{ id: 'x', q: { b: 1.5 } }], { x: 0 }, 18, 'b') }));
  check('0 חישוב: 0.10 כולל → 8 אג׳ ליחידה × 3 = 24 אג׳; בלי מפת עלויות – הכול "בלי עלות"; עלות 0 נספרת', u.a.v === 24 && u.b.nc === 1 && u.b.v === 0 && u.c.nc === 0 && u.c.v === 0, u);

  // מנהל
  await goV('oxStock'); await H.settle(page, 900);
  const m = { n: await txt('oxSumN'), u: await txt('oxSumU'), v: await txt('oxSumV'), a: await txt('oxSumA'), nc: await txt('oxSumNC') };
  check('1 מנהל: מוצרים 3 | יחידות בסניף br1 = 5+0-2 = 3 | שווי 5×10.00 + (-2)×5.00 = ₪40.00', m.n === '3' && m.u === '3' && /40\.00|40/.test(m.v) && /לפני מע"מ/.test(await txt('oxsum')), m);
  check('2 כל הסניפים: 9 יחידות (5+1+0+8-2=12? → 12), שווי ₪50.00; מוצר אחד בלי עלות מסומן', /12 יחידות/.test(m.a) && /50/.test(m.a) && /מוצר אחד בלי עלות/.test(m.nc), m);
  const gc1 = calls.filter((c) => c === 'getCosts').length;
  await page.evaluate(() => { rerender(); rerender(); }); await H.settle(page, 300);
  check('3 ציור חוזר לא קורא ל-getCosts שוב ', calls.filter((c) => c === 'getCosts').length === gc1, { gc1 });
  // מעבר לסניף 2 – נמצא בצ'יפ
  await page.click('button[data-a=oxSBr][data-id=br2]'); await H.settle(page, 200);
  const m2 = { u: await txt('oxSumU'), v: await txt('oxSumV') };
  check('4 סניף br2: יחידות 1+8=9, שווי 1×10.00 = ₪10.00', m2.u === '9' && /10/.test(m2.v), m2);
  const sizes = await page.evaluate(() => { const r = document.getElementById('oxsum').getBoundingClientRect(); return { w: Math.round(r.width), sw: document.documentElement.scrollWidth, iw: innerWidth }; });
  check('5 אין גלישה אופקית בכרטיס הסיכום', sizes.sw <= sizes.iw, sizes);
  if (shots) { await page.click('button[data-a=oxSBr][data-id=br1]'); await H.settle(page, 200); await page.screenshot({ path: path.join(shots, 'מלאי-סיכום.png') }); }

  // לקוחות
  await goV('ocList'); await H.settle(page, 700);
  const cc = await page.evaluate(() => ({ big: (document.getElementById('ocCount') || {}).innerText, rows: document.querySelectorAll('#ocl .li').length }));
  check('6 לקוחות: מספר בולט = 7 = מספר השורות ברשימה', /^7\s+לקוחות/.test((cc.big || '').replace(/\s+/g, ' ').trim()) && cc.rows === 7, cc);

  // עובד: בלי שווי
  await page.evaluate(() => { SY.role = 'worker'; SY.perms = { ord: true }; });
  await goV('oxStock'); await H.settle(page, 600);
  const w = { n: await txt('oxSumN'), u: await txt('oxSumU'), v: await txt('oxSumV'), a: await txt('oxSumA'), nc: await txt('oxSumNC'), html: await page.evaluate(() => document.getElementById('oxsum').innerText) };
  check('7 עובד: רואה מוצרים ויחידות, אין שווי, אין "כל הסניפים", אין "בלי עלות"', w.n && w.u && w.v === null && w.a === null && w.nc === null && !/₪|שווי/.test(w.html), w);
  // הערה: load() הקיים קורא ל-getCosts גם אצל עובד (החלטה 00:12) – לא שונה
  console.log('INFO getCosts calls total:', calls.filter((c) => c === 'getCosts').length);
  const errs = log.filter((l) => /error/i.test(String(l)) && !/net::|Failed to load/.test(String(l)));
  check('8 אין שגיאות JavaScript', errs.length === 0, errs.slice(0, 3));
  if (outFile) fs.writeFileSync(outFile, JSON.stringify({ fail }));
  await browser.close();
  console.log(fail ? 'נכשלו: ' + fail : 'הכול עבר');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
