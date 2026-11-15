'use strict';
// 15.11.2026 (החלטה 32, חלק א): אמצעי גבייה וחיוב אחרי ליקוט – מסגרת בכרטיס ההזמנה ("שלח קישור ללקוח" / "אמלא בשיחה" / "המסגרת אושרה"),
// "חויב" בסוף הליקוט בתוך המסגרת, "חורג מהמסגרת", לקוח בשוטף בלי מסגרת, ותאימות (קישור / טלפון / שניהם) – 360px. השרת מדומה (השרת האמיתי – ord-auth.test.js).
// שימוש: node ui-ord-auth.js <www-dir> [out.json] [shots-dir]
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const out = {}; let fail = 0;
const check = (name, ok, info) => { out[name] = { ok: !!ok, info }; if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 500) : '')); };
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
const enc = (v) => (v === null || v === undefined ? { nullValue: null } : typeof v === 'string' ? { stringValue: v } : typeof v === 'boolean' ? { booleanValue: v }
  : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }) : Array.isArray(v) ? { arrayValue: { values: v.map(enc) } }
  : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } });
const doc = (p, o) => ({ document: { name: 'projects/demo-largpeami/databases/(default)/documents/b/biz-o/' + p, fields: enc(o).mapValue.fields } });
const T1 = Date.UTC(2026, 10, 14, 8, 0, 0);
const PROD = [['pA', 'עוגה', 10, 3], ['pB', 'לחם', 7.5, 0], ['pC', 'מפית', 5, 10, 'ספק המפיות'], ['pD', 'מפית דומה', 6, 10]].map(([id, name, price, q, sup]) => doc('prod/' + id, Object.assign({ name, price, on: true, q: { br1: q } }, sup ? { sup } : {})));
const IT3 = () => [{ pid: 'pA', n: 'עוגה', qty: 2, price: 10 }, { pid: 'pB', n: 'לחם', qty: 1, price: 7.5 }, { pid: 'pC', n: 'מפית', qty: 3, price: 5 }];
function freshOrd() {
  const o = (id, no, status, items, x) => Object.assign({ id, no, br: 'br1', status, items, total: items.reduce((s, it) => s + it.qty * it.price, 0), at: T1, upd: T1, cust: { name: 'לקוח ' + no, phone: '0541111111' } }, x || {});
  return { o1: o('o1', 1, 'work', IT3()),
    o3: o('o3', 3, 'work', [{ pid: 'pA', n: 'עוגה', qty: 3, price: 10 }, { pid: 'pB', n: 'לחם', qty: 1, price: 7.5 }, { pid: 'pC', n: 'מפית', qty: 3, price: 5 }], { auth: { amt: 43, due: 42.5, mg: 10, via: 'link', at: T1, by: 'w' }, pk: { st: 'ok', l: [{ i: 0, ok: true }, { i: 1, ok: true }, { i: 2, ok: true }], sum: { it: IT3(), t: 42.5 }, by: 'w', at: T1 } }),
    o5: o('o5', 5, 'work', IT3(), { custId: 'cT' }) };
}

async function open(browser, www, who, calls, S, PAY) {
  const cfg = { mode: 'new', users: { m: 'biz-o', w: 'biz-o' }, biz: { 'biz-o': { dataRoot: 'b', features: ALL, name: 'עסק בדיקה' } }, admins: { 'b/biz-o/|m': 1 }, staff: { 'b/biz-o/|w': 1 } };
  const log = [];
  const { ctx, page } = await H.newPage(browser, www, cfg, log, 'au' + who + Math.random().toString(36).slice(2, 6));
  page.on('pageerror', (e) => log.push('pageerror: ' + e.message));
  await ctx.route(/:8080\/.*/, async (route) => {
    const req = route.request(); const u = new URL(req.url()); const body = req.postData() || '';
    const J = (st, b) => route.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(b) });
    if (/:runQuery$/.test(u.pathname)) { let c = ''; try { c = JSON.parse(body).structuredQuery.from[0].collectionId; } catch (e) { /* */ }
      return J(200, c === 'ord' ? Object.values(S.ord).map((o) => doc('ord/' + o.id, o)) : c === 'prod' ? PROD : [{ readTime: '2026-11-14T09:00:00Z' }]); }
    if (/\/cust\//.test(u.pathname)) return J(404, { error: { code: 404 } });
    if (/\/ordcfg\/main$/.test(u.pathname)) return J(200, { name: 'x', fields: { pay: enc(PAY), src: enc({ br1: 'stock' }) } });
    if (/\/ord\/o\d\/log/.test(u.pathname)) return J(200, { documents: [] });
    if (/\/documents\/b\/biz-o$/.test(u.pathname) && req.method() === 'GET') return J(200, { name: 'x', fields: { dataRoot: enc('b'), status: enc('active'), name: enc('עסק בדיקה'), features: enc(ALL) } });
    return route.fallback();
  });
  await ctx.route(/:5001\/.*/, async (route) => {
    const n = new URL(route.request().url()).pathname.split('/').pop(); let d = {}; try { d = JSON.parse(route.request().postData()).data; } catch (e) { /* */ }
    calls.push({ n, d });
    const o = d && S.ord[d.id]; let R = { ok: true };
    if (n === 'getCosts') R = { cost: {} };
    else if (n === 'ordProfit') R = { n: 0, total: 0, paid: 0, paidN: 0 };
    else if (n === 'getPayLink' && o) R = Object.assign({ link: 'https://pay.example.com/biz', total: o.total }, PAY.after ? { fr: Math.ceil(o.total * 1.1 - 1e-9) } : {});
    else if (n === 'orderAuth' && o) { o.auth = Object.assign({ amt: d.amt, due: o.total, mg: 10, via: d.via, at: Date.now(), by: who }, d.last4 ? { last4: d.last4 } : {}); R = { ok: true, auth: o.auth }; }
    else if (n === 'orderPick' && o) { o.pk = { st: 'ok', rq: d.reqId, l: d.l, sum: { it: o.items.map((x) => Object.assign({}, x)), t: o.total }, by: 'w', at: Date.now() }; R = { ok: true, st: 'ok', applied: false, so: [], upd: 777 }; }
    else if (n === 'markOrderPaid' && o) { o.status = 'paid'; o.paid = { method: d.method, amt: o.total, at: Date.now(), by: who }; R = { ok: true, dup: false }; }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: R }) });
  });
  await H.login(page, who + '@x.co');
  await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden && ACT.startBlank) ACT.startBlank(); });
  await page.setViewportSize({ width: 360, height: 740 });
  await page.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; }; });
  return { ctx, page, log };
}

(async () => {
  const [www, outFile, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const shot = async (page, n) => { if (shots) await page.screenshot({ path: path.join(shots, n + '.png'), fullPage: true }); };
  const browser = await H.launch();
  const ov = (page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  const txt = (page) => page.evaluate(() => document.getElementById('main').innerText);
  const has = (page, sel) => page.evaluate((s) => !!document.querySelector(s), sel);
  for (const who of ['w', 'm']) {
    const calls = [], S = { ord: freshOrd() };
    const { ctx, page, log } = await open(browser, www, who, calls, S, { mode: 'link', has: true, after: true });
    const card = async (id) => { await page.evaluate((i) => { NAV = [{ v: 'home' }]; go('ox'); go('oxOrd', i); }, id); await H.settle(page, 1200); await page.evaluate(() => rerender()); await H.settle(page, 300); };
    const since = (k, nm) => calls.slice(k).filter((x) => x.n === nm);
    // 1. מסגרת בכרטיס – במקום "לתשלום"
    await card('o1');
    const t1 = await txt(page);
    check(who + ' 1 חיוב אחרי ליקוט: מסגרת ₪47 (42.50 + 10%), "שלח קישור" / "אמלא בשיחה" / "המסגרת אושרה", בלי "לתשלום", בלי גלילה לרוחב',
      /מסגרת לאישור/.test(t1) && /47/.test(await page.evaluate(() => document.getElementById('oxfr').innerText)) && await has(page, '[data-a=oxAuthSend]') && await has(page, '[data-a=oxAuthCall]') && await has(page, '[data-a=oxAuthOk]') && !(await page.evaluate(() => [...document.querySelectorAll('[data-a=oxPay]')].some((b) => b.innerText.trim() === 'לתשלום'))) && await ov(page) <= 0 && await has(page, '[data-a=oxPaid]'),
      { ov: await ov(page) });
    if (who === 'w') await shot(page, 'מסגרת-בכרטיס-360');
    // 2. שלח קישור ללקוח
    let k = calls.length; await page.click('[data-a=oxAuthSend]'); await H.settle(page, 600);
    const g = since(k, 'getPayLink')[0];
    const dl = await page.evaluate(() => { const d = document.getElementById('dlg'); return d ? d.innerHTML : ''; });
    if (who === 'w') await shot(page, 'שליחת-קישור-360');
    await page.click('[data-a=oxAmGo][data-k=wa]'); await H.settle(page, 300);
    const op = await page.evaluate(() => window.__opened.slice());
    check(who + ' 2 "שלח קישור ללקוח": getPayLink {send:true}, חלון ווטסאפ/SMS/שיתוף בלי הקישור עצמו, ווטסאפ נפתח למספר הלקוח עם הסכום והקישור',
      !!g && g.d.send === true && /ווטסאפ/.test(dl) && /SMS/.test(dl) && /שיתוף/.test(dl) && !dl.includes('pay.example.com') && op.length === 1 && op[0].startsWith('https://wa.me/972541111111?text=') && decodeURIComponent(op[0]).includes('https://pay.example.com/biz') && decodeURIComponent(op[0]).includes('47'),
      { g: g && g.d, op: op.map((x) => x.slice(0, 60)) });
    // 3. "המסגרת אושרה"
    await page.click('[data-a=oxAuthOk]'); await H.settle(page, 300);
    const f3 = await page.evaluate(() => { const f = document.querySelector('#dlg form[data-f=oxAuthF]'); return f ? { amt: f.amt.value, via: f.via.value, ml: f.last4.maxLength } : null; });
    if (who === 'w') await shot(page, 'המסגרת-אושרה-360');
    await page.fill('#dlg input[name=last4]', '12a4'); k = calls.length; await page.click('#dlg form[data-f=oxAuthF] button.btn:not(.g)'); await H.settle(page, 300);
    const bad4 = since(k, 'orderAuth').length;
    await page.fill('#dlg input[name=last4]', '1234'); await page.click('#dlg form[data-f=oxAuthF] button.btn:not(.g)'); await H.settle(page, 1500);
    const a3 = since(k, 'orderAuth');
    check(who + ' 3 "המסגרת אושרה": סכום 47 מוכן, "קישור" נבחר אחרי שליחה, 4 ספרות בלבד (12a4 לא נשלח), orderAuth {amt:47, via:link, last4}',
      !!f3 && f3.amt === '47' && f3.via === 'link' && f3.ml === 4 && bad4 === 0 && a3.length === 1 && a3[0].d.amt === 47 && a3[0].d.via === 'link' && a3[0].d.last4 === '1234', { f3, a3: a3.map((x) => x.d) });
    // 4. אחרי אישור, לפני ליקוט – בלי "חויב"
    await card('o1'); const t4 = await txt(page);
    check(who + ' 4 מסגרת אושרה לפני ליקוט: "מסגרת אושרה: ₪47", ****1234, "החיוב – בסוף הליקוט", בלי "חויב"', /מסגרת אושרה/.test(t4) && /1234/.test(t4) && /בסוף הליקוט/.test(t4) && !(await has(page, '[data-a=oxCharged]')), { t: t4.slice(0, 0) });
    // 5. ליקוט – הכול במלאי ← "חויב ₪42.50" ← markOrderPaid {link, amt}
    await page.evaluate(() => go('oxPick', 'o1')); await H.settle(page, 400);
    await page.click('[data-a=oxPkAll]'); await page.click('[data-a=oxPkDone]'); await H.settle(page, 1800);
    await card('o1'); const t5 = await txt(page);
    if (who === 'w') await shot(page, 'חויב-בסוף-ליקוט-360');
    const ov5 = await ov(page);
    await page.evaluate(() => go('oxPick', 'o1')); await H.settle(page, 500); const sv = await has(page, '[data-a=oxCharged]'); await page.evaluate(() => { NAV.pop(); render(0); }); await H.settle(page, 300);
    k = calls.length; await page.click('[data-a=oxCharged]'); await H.settle(page, 300); await page.click('[data-a=yes]'); await H.settle(page, 1500);
    const m5 = since(k, 'markOrderPaid');
    check(who + ' 5 בסוף הליקוט: סכום סופי מול מסגרת, "לחייב ₪42.50 באתר הסליקה", "חויב" (גם בסיכום הליקוט) → markOrderPaid {method:link, amt:42.5}',
      /סכום סופי/.test(t5) && /לחייב/.test(t5) && /42\.50/.test(t5) && sv && m5.length === 1 && m5[0].d.method === 'link' && m5[0].d.amt === 42.5 && ov5 <= 0, { m5: m5.map((x) => x.d), ov5, sv });
    // 6. מעל המסגרת
    await card('o3'); const t6 = await txt(page);
    if (who === 'w') await shot(page, 'חורג-מהמסגרת-360');
    check(who + ' 6 מעל המסגרת (52.50 > 43): "הסכום חורג מהמסגרת – יש לשלוח ללקוח קישור חדש", מסגרת חדשה ₪58, בלי "חויב"',
      /חורג מהמסגרת/.test(t6) && /קישור חדש/.test(t6) && /58/.test(await page.evaluate(() => document.getElementById('oxfr').innerText)) && !(await has(page, '[data-a=oxCharged]')) && await has(page, '[data-a=oxAuthSend]'), {});
    // 7. לקוח בשוטף – בלי מסגרת ובלי קישור
    await page.evaluate(() => { window.__onTermsOrig = window.__onTerms; window.__onTerms = (c) => c === 'cT'; }); await card('o5');
    check(who + ' 7 לקוח בשוטף: בלי מסגרת, בלי "לתשלום"/"שלח קישור"', !(await has(page, '#oxauth')) && !(await has(page, '[data-a=oxPay]')) && !(await has(page, '[data-a=oxAuthSend]')), {});
    await page.evaluate(() => { window.__onTerms = window.__onTermsOrig; });
    const errs = log.filter((x) => /pageerror|TypeError|ReferenceError/.test(x));
    check(who + ' 8 בלי שגיאות JS', errs.length === 0, errs.slice(0, 3));
    await ctx.close();
  }
  // 9. תאימות: קישור בלי "אחרי ליקוט" / טלפון / שניהם
  for (const [nm, PAY] of [['link', { mode: 'link', has: true }], ['phone', { mode: 'phone' }], ['both', { mode: 'link', has: true, kind: 'both' }], ['both-after', { mode: 'link', has: true, kind: 'both', after: true }]]) {
    const calls = [], S = { ord: freshOrd() };
    const { ctx, page, log } = await open(browser, www, 'w', calls, S, PAY);
    await page.evaluate(() => { NAV = [{ v: 'home' }]; go('ox'); go('oxOrd', 'o1'); }); await H.settle(page, 1200); await page.evaluate(() => rerender()); await H.settle(page, 300);
    const r = await page.evaluate(() => ({ pay: [...document.querySelectorAll('[data-a=oxPay]')].some((b) => b.innerText.trim() === 'לתשלום'), tel: /תשלום בטלפון/.test(document.getElementById('main').innerText), auth: !!document.getElementById('oxauth'), kind: window.__payKind() }));
    const exp = { link: { pay: true, tel: false, auth: false, kind: 'link' }, phone: { pay: false, tel: true, auth: false, kind: 'phone' }, both: { pay: true, tel: true, auth: false, kind: 'both' }, 'both-after': { pay: false, tel: true, auth: true, kind: 'both' } }[nm];
    if (nm === 'both-after') await shot(page, 'שניהם-עם-מסגרת-360');
    const errs = log.filter((x) => /pageerror|TypeError|ReferenceError/.test(x));
    check('9 תאימות ' + nm + ': ' + JSON.stringify(exp), JSON.stringify(r) === JSON.stringify(exp) && !errs.length && await ov(page) <= 0, { r, errs: errs.slice(0, 2) });
    await ctx.close();
  }
  await browser.close();
  if (outFile) fs.writeFileSync(outFile, JSON.stringify({ out }, null, 1));
  console.log(fail ? `תוצאה: נכשל (${fail})` : 'תוצאה: הכול עבר'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
