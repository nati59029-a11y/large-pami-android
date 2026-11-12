'use strict';
// 2026-11-12: רווחיות הזמנות (orders-staff.js): רווח בכרטיס ההזמנה, "סך הכול הרווחת" אחרי סימון שולם, מסך רווחיות לתקופה (ordProfit),
// הגדרת שורה בלי עלות (מנהל), ומתג ordP אצל עובד. רשת מדומה. שימוש: node ui-ordprof.js <www-dir> [out.json] [shots-dir]
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const out = {}; let fail = 0;
const check = (name, ok, info) => { out[name] = { ok: !!ok, info }; if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
const S = (v) => ({ stringValue: v }), N = (v) => (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }), M = (o) => ({ mapValue: { fields: o } }), A = (a) => ({ arrayValue: { values: a } });
const doc = (p, f) => ({ document: { name: 'projects/demo-largpeami/databases/(default)/documents/b/biz-o/' + p, fields: f } });
const T1 = Date.UTC(2026, 10, 3, 8, 0, 0);
// o1: 2×12 (עלות 7 שמורה) + 1×10 (בלי c – העלות הנוכחית של pB = 4) + שורה ידנית 1×5 בלי עלות → total 39
const ORD = [doc('ord/o1', { no: N(12), br: S('br1'), status: S('new'), total: N(39), at: N(T1), cust: M({ name: S('משה כהן'), phone: S('0501234567') }),
  items: A([M({ pid: S('pA'), n: S('עוגה'), qty: N(2), price: N(12), c: N(7) }), M({ pid: S('pB'), n: S('לחם'), qty: N(1), price: N(10) }), M({ n: S('משלוח'), qty: N(1), price: N(5) })]) })];
const PROD = [doc('prod/pA', { name: S('עוגה'), price: N(12), on: { booleanValue: true }, q: M({ br1: N(5) }) }), doc('prod/pB', { name: S('לחם'), price: N(10), on: { booleanValue: true }, q: M({ br1: N(5) }) })];
const ORG = M({ v: N(1), branches: A([M({ id: S('br1'), name: S('נחל לכיש'), on: { booleanValue: true } }), M({ id: S('br2'), name: S('יהודה הנשיא'), on: { booleanValue: true } })]) });
const PROF = { n: 2, total: 139, cost: 70.5, profit: 63.5, miss: 1, nc: 'skip', rows: [{ id: 'o1', no: 12, name: 'משה כהן', at: T1, br: 'br1', st: 'new', total: 39, cost: 18, profit: 16, miss: 1 }, { id: 'o9', no: 9, name: 'רחל', at: T1, br: 'br2', st: 'paid', total: 100, cost: 52.5, profit: 47.5, miss: 0 }] };

async function open(browser, www, who, calls) {
  const cfg = { mode: 'new', users: { m: 'biz-o', w: 'biz-o' }, biz: { 'biz-o': { dataRoot: 'b', features: ALL, name: 'עסק בדיקה' } }, admins: { 'b/biz-o/|m': 1 }, staff: { 'b/biz-o/|w': 1 } };
  const { ctx, page } = await H.newPage(browser, www, cfg, [], 'pf' + who);
  await ctx.route(/:8080\/.*/, async (route) => {
    const req = route.request(); const u = new URL(req.url()); const body = req.postData() || '';
    if (/:runQuery$/.test(u.pathname)) { let c = ''; try { c = JSON.parse(body).structuredQuery.from[0].collectionId; } catch (e) { /* */ }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(c === 'ord' ? ORD : c === 'prod' ? PROD : [{ readTime: '2026-11-03T09:00:00Z' }]) }); }
    if (/\/ordcfg\/main$/.test(u.pathname)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ name: 'x', fields: { src: M({ br1: S('stock') }) } }) });
    if (/\/ord\/o1\/log/.test(u.pathname)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ documents: [] }) });
    if (/\/documents\/b\/biz-o$/.test(u.pathname) && req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ name: 'x', fields: { dataRoot: S('b'), status: S('active'), name: S('עסק בדיקה'), features: M(Object.fromEntries(Object.keys(ALL).map((k) => [k, { booleanValue: true }]))), org: ORG } }) });
    return route.fallback();
  });
  await ctx.route(/:5001\/.*/, async (route) => {
    const n = new URL(route.request().url()).pathname.split('/').pop(); let d = {}; try { d = JSON.parse(route.request().postData()).data; } catch (e) { /* */ }
    calls.push({ n, d });
    const R = { getCosts: { cost: { pB: 4 } }, markOrderPaid: { ok: true }, ordProfit: PROF, setOrderCfg: { ok: true, nc: d && d.nc }, getBackupKey: { key: Buffer.alloc(32, 7).toString('base64') } };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: R[n] || { ok: true } }) });
  });
  await H.login(page, who + '@x.co');
  await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden && ACT.startBlank) ACT.startBlank(); });
  await page.setViewportSize({ width: 360, height: 740 });
  return { ctx, page };
}

(async () => {
  const [www, outFile, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const shot = async (page, n) => { if (shots) await page.screenshot({ path: path.join(shots, n + '.png'), fullPage: true }); };
  const browser = await H.launch();
  const ov = (page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

  // מנהל
  { const calls = []; const { ctx, page } = await open(browser, www, 'm', calls);
    await page.evaluate(() => go('ox')); await H.settle(page, 1500);
    const btn = await page.evaluate(() => !!document.querySelector('[data-v=oxProf]'));
    check('1 מנהל: כפתור "רווחיות הזמנות" ברשימת ההזמנות', btn);
    await page.evaluate(() => go('oxOrd', 'o1')); await H.settle(page, 800);
    const c = await page.evaluate(() => (document.getElementById('oxprof') || {}).innerText || '');
    await shot(page, '01-כרטיס-הזמנה');
    // skip: total 39 − משלוח 5 (בלי עלות) − עלות (2×7 + 1×4 = 18) = 16
    check('2 כרטיס הזמנה: עלות 18 (שמורה + נוכחית), רווח 16, ו"חסר מחיר עלות ב-1 שורות"', /18\.00/.test(c) && /16\.00/.test(c) && /חסר מחיר עלות ב-1 שורות/.test(c) && /לא נספרו ברווח/.test(c), c);
    await page.evaluate(() => { ACT.oxPaid({ dataset: { id: 'o1' } }); }); await H.settle(page, 300);
    await page.click('#dlg form[data-f=oxPaidF] button:not([type=button])'); await H.settle(page, 1500);
    const pd = await page.evaluate(() => ({ t: (document.getElementById('dlg') || {}).innerText || '', p: (document.getElementById('oxpaidp') || {}).innerText || '' }));
    await shot(page, '02-אחרי-תשלום');
    check('3 אחרי "שולם": "סך הכול הרווחת 16"', /סך הכול הרווחת/.test(pd.t) && /16\.00/.test(pd.p), pd);
    await page.evaluate(() => closeDlg());
    calls.length = 0;
    await page.evaluate(() => go('oxProf')); await H.settle(page, 1200);
    const today = await page.evaluate(() => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' })); // שעון הדפדפן המדומה (harness)
    const pf = await page.evaluate(() => ({ t: document.getElementById('main').innerText, sum: (document.getElementById('oxpfsum') || {}).innerText || '', rows: document.querySelectorAll('#main .li[data-a=oxPfGo]').length, nc: !!document.querySelector('[data-c=oxNc]') }));
    const c1 = calls.find((x) => x.n === 'ordProfit');
    await shot(page, '03-מסך-רווחיות');
    check('4 מסך רווחיות: ברירת מחדל = היום, בלי "רק ששולמו"', c1 && c1.d.from === today && c1.d.to === today && c1.d.paid === false, c1 && c1.d);
    check('4א סיכום: 2 הזמנות, 139, עלות 70.5, רווח 63.5; שורה לכל הזמנה; הגדרת "שורה בלי עלות" למנהל; בלי גלילה רוחבית', /139\.00/.test(pf.sum) && /70\.50/.test(pf.sum) && /63\.50/.test(pf.sum) && pf.rows === 2 && pf.nc, pf);
    // מרוץ: שתי טעינות ברצף – מוצגת רק התשובה של האחרונה
    const race = await page.evaluate(async () => { const P = __ox.pf; let k = 0; const f0 = window.fnCall; window.fnCall = (n, d) => { const i = k++; return new Promise((res) => setTimeout(() => res({ n: i === 0 ? 1 : 7, total: 0, cost: 0, profit: 0, miss: 0, nc: 'skip', rows: [] }), i === 0 ? 400 : 50)); };
      ACT.oxPfK({ dataset: { k: 'yest' } }); ACT.oxPfK({ dataset: { k: 'today' } }); await new Promise((r) => setTimeout(r, 700)); window.fnCall = f0; return { n: P.r && P.r.n, k: P.k }; });
    check('4ב מרוץ: שינוי תקופה בזמן טעינה – מוצגים נתוני הבחירה האחרונה', race.n === 7 && race.k === 'today', race);
    await page.evaluate(() => ACT.oxPfRe()); await H.settle(page, 600);
    // הזמנה ישנה שלא ברשימה – נטענת ונפתחת
    const og = await page.evaluate(async () => { const f0 = window.fsx; window.fsx = async (p) => (p === '/ord/o9' ? { name: 'x/ord/o9', fields: { no: { integerValue: '9' }, status: { stringValue: 'paid' }, total: { integerValue: '100' }, br: { stringValue: 'br2' }, items: { arrayValue: { values: [] } }, cust: { mapValue: { fields: { name: { stringValue: 'רחל' } } } } } } : f0(p));
      await ACT.oxPfGo({ dataset: { id: 'o9' } }); window.fsx = f0; return { v: cur().v, t: document.getElementById('main').innerText.slice(0, 200) }; });
    check('4ג לחיצה על הזמנה ישנה (לא ב-500 האחרונות) – נטענת ונפתחת', og.v === 'oxOrd' && /רחל/.test(og.t), og);
    await page.evaluate(() => go('oxProf')); await H.settle(page, 600);
    calls.length = 0; await page.evaluate(() => ACT.oxPfK({ dataset: { k: 'month' } })); await H.settle(page, 600);
    const c2 = calls.find((x) => x.n === 'ordProfit');
    check('5 "החודש": מה-1 בחודש עד היום', c2 && c2.d.from === today.slice(0, 8) + '01' && c2.d.to === today, c2 && c2.d);
    calls.length = 0; await page.evaluate(() => ACT.oxPfK({ dataset: { k: 'custom' } })); await H.settle(page, 300);
    await page.fill('form[data-f=oxPfF] input[name=from]', '2026-10-01'); await page.fill('form[data-f=oxPfF] input[name=to]', '2026-10-15');
    await page.click('form[data-f=oxPfF] button'); await H.settle(page, 600);
    const c3 = calls.find((x) => x.n === 'ordProfit');
    check('6 תאריכים אחרים: 1.10–15.10', c3 && c3.d.from === '2026-10-01' && c3.d.to === '2026-10-15', c3 && c3.d);
    calls.length = 0; await page.evaluate(() => ACT.oxPfPaid()); await H.settle(page, 600);
    const c4 = calls.find((x) => x.n === 'ordProfit');
    calls.length = 0; await page.evaluate(() => ACT.oxPfBr({ dataset: { id: 'br2' } })); await H.settle(page, 600);
    const c5 = calls.find((x) => x.n === 'ordProfit');
    check('7 סינון "רק ששולמו" וסניף', c4 && c4.d.paid === true && c5 && c5.d.br === 'br2' && c5.d.paid === true, [c4 && c4.d, c5 && c5.d]);
    calls.length = 0; await page.selectOption('[data-c=oxNc]', 'zero'); await H.settle(page, 800);
    const c6 = calls.find((x) => x.n === 'setOrderCfg');
    check('8 מנהל משנה "שורה בלי עלות" → setOrderCfg({nc:"zero"})', c6 && c6.d.nc === 'zero', c6 && c6.d);
    const o = await ov(page);
    check('9 מסך רווחיות ב-360px: בלי גלילה רוחבית ובלי שגיאות JS', o <= 1 && page.__errors.length === 0, { o, err: page.__errors });
    await ctx.close(); }

  // עובד: בלי ordP – אין כפתור, אין רווח בכרטיס, אין "הרווחת"; עם ordP – יש
  { const calls = []; const { ctx, page } = await open(browser, www, 'w', calls);
    const st = async (perms) => page.evaluate((p) => { SY.perms = p; go('ox'); }, perms);
    await st({ incR: false, incW: true, expR: true, expW: true, sup: true, sal: false, rep: false, ord: true, trf: false, bal: false, ordP: false }); await H.settle(page, 1500);
    const a = await page.evaluate(() => { const b = !!document.querySelector('[data-v=oxProf]'); go('oxOrd', 'o1'); return b; }); await H.settle(page, 600);
    const a2 = await page.evaluate(() => !!document.getElementById('oxprof'));
    await page.evaluate(() => go('oxProf')); await H.settle(page, 500);
    const a3 = await page.evaluate(() => document.getElementById('main').innerText);
    check('10 עובד בלי "רווחיות הזמנות": אין כפתור, אין רווח בכרטיס, המסך חסום, ולא נקרא ordProfit', !a && !a2 && /אין לך הרשאה לרווחיות הזמנות/.test(a3) && !calls.some((x) => x.n === 'ordProfit'), { a, a2 });
    await st({ incR: false, incW: true, expR: true, expW: true, sup: true, sal: false, rep: false, ord: true, trf: false, bal: false, ordP: true }); await H.settle(page, 600);
    const b = await page.evaluate(() => { const x = !!document.querySelector('[data-v=oxProf]'); go('oxProf'); return x; }); await H.settle(page, 800);
    const b2 = await page.evaluate(() => ({ sum: !!document.getElementById('oxpfsum'), nc: !!document.querySelector('[data-c=oxNc]') }));
    check('11 עובד עם "רווחיות הזמנות": כפתור ומסך; בלי הגדרת "שורה בלי עלות" (מנהל בלבד)', b && b2.sum && !b2.nc, b2);
    await shot(page, '04-עובד-רווחיות');
    await ctx.close(); }

  await browser.close();
  if (outFile) fs.writeFileSync(outFile, JSON.stringify({ out }, null, 1));
  console.log(fail ? `תוצאה: נכשל (${fail})` : 'תוצאה: הכול עבר'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
