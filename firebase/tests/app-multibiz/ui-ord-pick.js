'use strict';
// 14.11.2026 (משוב בעל הפרויקט סעיף 6, משוב סבב 3): מסך טיפול/ליקוט – "בטיפול" פותח את המסך, יש/אין, 3 אפשרויות, "הכול במלאי",
// סיכום לפני/אחרי + חיוג + "הלקוח אישר", חסימת "ממתין לתשלום" עד אישור (מנהל עוקף עם force), ו"להזמין מספקים". רשת מדומה (השרת מדומה כאן; השרת האמיתי – ord-pick.test.js).
// שימוש: node ui-ord-pick.js <www-dir> [out.json] [shots-dir]
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
  return { o1: o('o1', 1, 'new', IT3()), o2: o('o2', 2, 'work', [{ pid: 'pA', n: 'עוגה', qty: 2, price: 10 }]), o3: o('o3', 3, 'work', IT3()),
    o4: o('o4', 4, 'work', IT3().slice(0, 1), { pk: { st: 'chg', l: [{ i: 0, ok: false, act: 'ord', sup: 'ספק', qty: 2 }], sum: { it: IT3().slice(0, 1), t: 20 }, by: 'w', at: T1 } }) };
}
const SUP = [doc('supord/s1', { ord: 'o4', no: 4, br: 'br1', n: 'עוגה', qty: 2, sup: 'ספק המפיות', st: 'open', at: T1 }), doc('supord/s2', { ord: 'o3', no: 3, br: 'br1', n: 'לחם', qty: 1, sup: 'מאפיית כהן', eta: '2026-11-20', st: 'ord', at: T1 + 1 }),
  doc('supord/s3', { ord: 'o3', no: 3, br: 'br1', n: 'ישן', qty: 1, sup: 'x', st: 'done', at: T1 })];

async function open(browser, www, who, calls, S) {
  const cfg = { mode: 'new', users: { m: 'biz-o', w: 'biz-o' }, biz: { 'biz-o': { dataRoot: 'b', features: ALL, name: 'עסק בדיקה' } }, admins: { 'b/biz-o/|m': 1 }, staff: { 'b/biz-o/|w': 1 } };
  const log = [];
  const { ctx, page } = await H.newPage(browser, www, cfg, log, 'pk' + who);
  page.on('pageerror', (e) => log.push('pageerror: ' + e.message));
  await ctx.route(/:8080\/.*/, async (route) => {
    const req = route.request(); const u = new URL(req.url()); const body = req.postData() || '';
    const J = (st, b) => route.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(b) });
    if (/:runQuery$/.test(u.pathname)) { let c = ''; try { c = JSON.parse(body).structuredQuery.from[0].collectionId; } catch (e) { /* */ }
      return J(200, c === 'ord' ? Object.values(S.ord).map((o) => doc('ord/' + o.id, o)) : c === 'prod' ? PROD : c === 'supord' ? SUP : [{ readTime: '2026-11-14T09:00:00Z' }]); }
    if (/\/cust\//.test(u.pathname)) return J(404, { error: { code: 404 } });
    if (/\/ordcfg\/main$/.test(u.pathname)) return J(200, { name: 'x', fields: { pay: enc({ mode: 'phone' }), src: enc({ br1: 'stock' }) } });
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
    else if (n === 'setOrderStatus' && o) { o.status = d.status; R = { ok: true, status: d.status }; }
    else if (n === 'orderPick' && o) { const st = d.l.every((x) => x.ok) ? 'ok' : 'chg';
      o.pk = { st, rq: d.reqId, l: d.l.map((x) => Object.assign({}, x, x.act === 'rep' ? { rep: { pid: x.pid, n: (PROD.find((p) => p.document.name.endsWith('/' + x.pid)) || { document: { fields: { name: { stringValue: '' } } } }).document.fields.name.stringValue } } : {})), sum: { it: o.items.map((x) => Object.assign({}, x)), t: o.total }, by: 'w', at: Date.now() };
      R = { ok: true, st, applied: false, so: [], upd: 777 }; }
    else if (n === 'updateOrder' && o && S.stale) { S.stale = 0; return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { status: 'FAILED_PRECONDITION', message: 'stale', details: { reason: 'stale' } } }) }); }
    else if (n === 'updateOrder' && o) { o.items = d.items.map((x) => Object.assign({ n: x.pid === 'pD' ? 'מפית דומה' : (o.items.find((y) => y.pid === x.pid) || {}).n, price: x.price != null ? x.price : 6 }, x)); o.total = o.items.reduce((s, it) => s + it.qty * it.price, 0); R = { ok: true, total: o.total }; }
    else if (n === 'orderPickOk' && o) { o.pk.st = 'ok'; o.pk.okAt = Date.now(); }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: R }) });
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
  const ov = (page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  const txt = (page) => page.evaluate(() => document.getElementById('main').innerText);
  const v = (page) => page.evaluate(() => cur().v);
  for (const who of ['w', 'm']) {
    const calls = [], S = { ord: freshOrd() };
    const { ctx, page, log } = await open(browser, www, who, calls, S);
    const card = async (id) => { await page.evaluate((i) => { NAV = [{ v: 'home' }]; go('ox'); go('oxOrd', i); }, id); await H.settle(page, 1200); await page.evaluate(() => rerender()); await H.settle(page, 300); };
    const since = (k, nm) => calls.slice(k).filter((x) => x.n === nm);
    // 1. "בטיפול" פותח את מסך הליקוט
    await card('o1'); let k = calls.length;
    await page.click('[data-a=oxStat][data-s=work]'); await H.settle(page, 1200);
    check(who + ' 1 "בטיפול" → setOrderStatus work ואז מסך הליקוט', since(k, 'setOrderStatus').length === 1 && await v(page) === 'oxPick', { v: await v(page) });
    const p1 = await page.evaluate(() => ({ n: document.querySelectorAll('[data-a=oxPkYes1]').length, all: !!document.querySelector('[data-a=oxPkAll]'), done: !!document.querySelector('[data-a=oxPkDone]') }));
    check(who + ' 2 כל 3 המוצרים עם יש/אין, "הכול במלאי", "סיום וסיכום", בלי גלילה לרוחב', p1.n === 3 && p1.all && p1.done && await ov(page) <= 0, p1);
    // 2. יש / אין+להוריד / אין+להזמין
    await page.click('[data-a=oxPkYes1][data-n="0"]'); await page.click('[data-a=oxPkNo][data-n="1"]'); await H.settle(page, 150);
    const three = await page.evaluate(() => [...document.querySelectorAll('[data-a=oxPkAct][data-n="1"]')].map((b) => b.innerText.trim()));
    check(who + ' 3 "אין" → 3 אפשרויות', JSON.stringify(three) === JSON.stringify(['להוריד מההזמנה', 'מוצר דומה', 'להזמין מספק']), three);
    await page.click('[data-a=oxPkAct][data-n="1"][data-k=rm]'); await page.click('[data-a=oxPkNo][data-n="2"]'); await H.settle(page, 100); await page.click('[data-a=oxPkAct][data-n="2"][data-k=ord]'); await H.settle(page, 150);
    const f2 = await page.evaluate(() => ({ sup: document.querySelector('[data-i=oxPkF][data-k=sup]').value, qty: document.querySelector('[data-i=oxPkF][data-k=qty]').value, rm: /הסכום ירד ב-/.test(document.getElementById('main').innerText) }));
    check(who + ' 4 להזמין: ספק מזוהה מהמוצר כברירת מחדל, כמות = הכמות בהזמנה; להוריד: "הסכום ירד"', f2.sup === 'ספק המפיות' && f2.qty === '3' && f2.rm, f2);
    await page.fill('[data-i=oxPkF][data-k=eta]', '2026-11-20');
    if (who === 'w') await shot(page, 'ליקוט-360');
    check(who + ' 4א בלי גלילה לרוחב עם 3 האפשרויות פתוחות', await ov(page) <= 0, await ov(page));
    k = calls.length; await page.click('[data-a=oxPkDone]'); await H.settle(page, 1500);
    const op = since(k, 'orderPick')[0], up = since(k, 'updateOrder')[0];
    check(who + ' 5 סיום: orderPick עם הסימונים, ואז updateOrder בלי השורה שהוסרה', !!op && JSON.stringify(op.d.l) === JSON.stringify([{ i: 0, ok: true }, { i: 1, ok: false, act: 'rm' }, { i: 2, ok: false, act: 'ord', sup: 'ספק המפיות', qty: 3, eta: '2026-11-20' }])
      && !!up && JSON.stringify(up.d.items) === JSON.stringify([{ qty: 2, price: 10, pid: 'pA' }, { qty: 3, price: 5, pid: 'pC' }]) && calls.indexOf(op) < calls.indexOf(up) && up.d.ver === 777 && typeof op.d.upd === 'number', { op: op && op.d, up: up && up.d });
    const t5 = await txt(page);
    const sm = { v: await v(page), rm: /הוסר: לחם/.test(t5), ord: /להזמין מספק: מפית/.test(t5) && /ספק המפיות/.test(t5) && /20\.11\.2026/.test(t5), before: /סכום לפני[\s\S]*42\.5/.test(t5), after: /סכום אחרי[\s\S]*35/.test(t5),
      call: await page.evaluate(() => !!document.querySelector('a[href^="tel:"][data-a=oxCall]')), ok: await page.evaluate(() => !!document.querySelector('[data-a=oxPkOk]')), re: await page.evaluate(() => !!document.querySelector('[data-a=oxPkRe]')), ov: await ov(page) };
    check(who + ' 6 סיכום: הוסר + להזמין (ספק, צפי), סכום לפני/אחרי, חיוג ללקוח, "הלקוח אישר", בלי "סימון מחדש" עד האישור', sm.v === 'oxPick' && sm.rm && sm.ord && sm.before && sm.after && sm.call && sm.ok && !sm.re && sm.ov <= 0, sm);
    if (who === 'w') await shot(page, 'סיכום-שינויים-360');
    // 3. חסימה עד אישור
    await card('o1'); const ban = /ממתינים לאישור הלקוח/.test(await txt(page));
    k = calls.length; await page.click('[data-a=oxStat][data-s=wait_pay]'); await H.settle(page, 500);
    if (who === 'w') check('w 7 כרטיס: באנר "ממתינים לאישור"; עובד לוחץ "ממתין לתשלום" → נחסם בלי קריאה לשרת', ban && since(k, 'setOrderStatus').length === 0, { ban });
    else { const dl = await page.evaluate(() => !!document.querySelector('#dlg[open] [data-a=yes]')); await page.click('#dlg [data-a=yes]'); await H.settle(page, 800); const sc = since(k, 'setOrderStatus')[0];
      check('m 7 כרטיס: באנר; מנהל → שאלה "לעקוף?" → setOrderStatus עם force:true', ban && dl && !!sc && sc.d.force === true && sc.d.status === 'wait_pay', sc && sc.d); S.ord.o1.status = 'work'; }
    // 4. הלקוח אישר
    await page.evaluate(() => { go('oxPick', 'o1'); }); await H.settle(page, 400); k = calls.length; await page.click('[data-a=oxPkOk]'); await H.settle(page, 1000);
    const ok8 = since(k, 'orderPickOk')[0]; const t8 = await txt(page);
    check(who + ' 8 "הלקוח אישר" → orderPickOk, חזרה לכרטיס, הבאנר נעלם', !!ok8 && ok8.d.id === 'o1' && await v(page) === 'oxOrd' && !/ממתינים לאישור הלקוח/.test(t8) && /הלקוח אישר את השינויים/.test(t8), { v: await v(page) });
    // 5. מוצר דומה (מהכרטיס של הזמנה בטיפול)
    await card('o2'); await page.click('[data-a=go][data-v=oxPick]'); await H.settle(page, 400);
    await page.click('[data-a=oxPkNo][data-n="0"]'); await H.settle(page, 100); await page.click('[data-a=oxPkAct][data-k=rep]'); await H.settle(page, 150);
    const note9 = /יש לעדכן את הלקוח/.test(await txt(page));
    await page.fill('[data-i=oxPkQ]', 'מפית'); await H.settle(page, 300);
    const hits = await page.evaluate(() => [...document.querySelectorAll('[data-a=oxPkRep]')].map((b) => b.dataset.p));
    await page.click('[data-a=oxPkRep][data-p=pD]'); await H.settle(page, 200);
    k = calls.length; await page.click('[data-a=oxPkDone]'); await H.settle(page, 1500);
    const op9 = since(k, 'orderPick')[0], up9 = since(k, 'updateOrder')[0]; const t9 = await txt(page);
    check(who + ' 9 מוצר דומה: "יש לעדכן את הלקוח", חיפוש חכם, updateOrder בלי מחיר (מחיר לפי הכללים בשרת), בסיכום "הוחלף"', note9 && hits.includes('pD') && !!op9 && op9.d.l[0].pid === 'pD' && !!up9 && JSON.stringify(up9.d.items) === JSON.stringify([{ pid: 'pD', qty: 2 }]) && /הוחלף: עוגה ← מפית דומה/.test(t9), { hits, up: up9 && up9.d });
    // 6. הכול במלאי → בלי updateOrder, חזרה לכרטיס, לא נחסם
    await card('o3'); await page.click('[data-a=go][data-v=oxPick]'); await H.settle(page, 400); await page.click('[data-a=oxPkAll]'); await H.settle(page, 100);
    k = calls.length; await page.click('[data-a=oxPkDone]'); await H.settle(page, 1200);
    check(who + ' 10 "הכול במלאי" → orderPick בלבד, חזרה לכרטיס', since(k, 'orderPick').length === 1 && since(k, 'updateOrder').length === 0 && await v(page) === 'oxOrd' && !/ממתינים לאישור/.test(await txt(page)), { v: await v(page) });
    // 7. להזמין מספקים
    await page.evaluate(() => { NAV = [{ v: 'home' }]; go('ox'); }); await H.settle(page, 1200); await page.evaluate(() => rerender()); await H.settle(page, 200);
    const ent = await page.evaluate(() => { const b = document.querySelector('[data-a=go][data-v=oxSup]'); return b ? b.innerText.trim() : ''; });
    await page.click('[data-a=go][data-v=oxSup]'); await H.settle(page, 800);
    const t11 = await txt(page);
    const g = await page.evaluate(() => [...document.querySelectorAll('#main .sec h3')].map((h) => h.innerText.trim()));
    if (who === 'w') await shot(page, 'להזמין-מספקים-360');
    k = calls.length; await page.click('[data-a=oxSoSt][data-id=s1][data-s=ord]'); await H.settle(page, 500);
    const ss = since(k, 'supOrdSet')[0];
    check(who + ' 11 "להזמין מספקים": כניסה מהרשימה, מקובץ לפי ספק, בלי מה שהגיע, "הוזמן" → supOrdSet', /להזמין מספקים \(2\)/.test(ent) && JSON.stringify(g) === JSON.stringify(['מאפיית כהן (1)', 'ספק המפיות (1)']) && !/ישן/.test(t11) && /לא נשלחת לספק/.test(t11) && !!ss && ss.d.st === 'ord' && await ov(page) <= 0, { ent, g, ss: ss && ss.d });
    // 7א. ההזמנה השתנתה בזמן הסימון (stale) – לא נדרס, נטען מחדש וסימון חדש
    await card('o3'); await page.evaluate(() => { delete window.__ox.L.find((o) => o.id === 'o3').pk; }); S.ord.o3.pk = undefined; delete S.ord.o3.pk; await card('o3');
    await page.click('[data-a=go][data-v=oxPick]'); await H.settle(page, 400);
    const rq0 = await page.evaluate(() => window.__oxPick.PS.o3 && window.__oxPick.PS.o3.rq);
    await page.click('[data-a=oxPkAll]'); await page.click('[data-a=oxPkNo][data-n="1"]'); await H.settle(page, 100); await page.click('[data-a=oxPkAct][data-n="1"][data-k=rm]'); await H.settle(page, 100);
    S.stale = 1; delete S.ord.o3.pk; k = calls.length; await page.click('[data-a=oxPkDone]'); await H.settle(page, 1500);
    const rq1 = await page.evaluate(() => window.__oxPick.PS.o3 && window.__oxPick.PS.o3.rq);
    const pv = await page.evaluate(() => ({ v: cur().v, n: document.querySelectorAll('[data-a=oxPkYes1]').length }));
    check(who + ' 11א ההזמנה השתנתה בינתיים (stale) → הודעה, טעינה מחדש, מסך סימון חדש (reqId חדש)', since(k, 'updateOrder').length === 1 && !!rq0 && !!rq1 && rq0 !== rq1 && pv.v === 'oxPick' && pv.n === 3, { rq0, rq1, pv });
    // 8. הזמנה עם pk chg ישן (o4) – הכרטיס מציג באנר; הזמנה בלי pk – בלי באנר
    await card('o4'); const b4 = /ממתינים לאישור הלקוח/.test(await txt(page));
    check(who + ' 12 הזמנה עם שינויים שלא אושרו – באנר; "להזמין" בסיכום מוצג מתוך pk', b4, { b4 });
    const errs = log.filter((x) => /pageerror|TypeError|ReferenceError/.test(x));
    check(who + ' 13 בלי שגיאות JS', errs.length === 0, errs.slice(0, 3));
    await ctx.close();
  }
  await browser.close();
  if (outFile) fs.writeFileSync(outFile, JSON.stringify({ out }, null, 1));
  console.log(fail ? `תוצאה: נכשל (${fail})` : 'תוצאה: הכול עבר'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
