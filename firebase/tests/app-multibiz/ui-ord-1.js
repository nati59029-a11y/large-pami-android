'use strict';
// הזמנות שלב 1 (orders-staff.js): רשימה, הזמנה חדשה, כרטיס הזמנה, סימון שולם, מלאי, מקור מלאי, תשלום בכרטיס העסק (מנהל־על).
// רשת מדומה. שימוש: node ui-ord-1.js <www-dir> [out.json] [shots-dir]. MUTATE=pay – באג מכוון: הקישור מוצג על המסך → בדיקה 4 נכשלת.
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const out = {}; let fail = 0;
const check = (name, ok, info) => { out[name] = { ok: !!ok, info }; if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
const S = (v) => ({ stringValue: v }), N = (v) => (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }), M = (o) => ({ mapValue: { fields: o } }), A = (a) => ({ arrayValue: { values: a } });
const doc = (p, f) => ({ document: { name: 'projects/demo-largpeami/databases/(default)/documents/b/biz-o/' + p, fields: f } });
const LINK = 'https://pay.example.com/secret-biz-123';
const T1 = Date.UTC(2026, 10, 3, 8, 0, 0);
const ORD = [doc('ord/o1', { no: N(12), br: S('br1'), status: S('new'), total: N(34.5), at: N(T1), byName: S('דנה'), cust: M({ name: S('משה כהן'), phone: S('0501234567'), addr: S('הרצל 1') }), items: A([M({ pid: S('pA'), n: S('עוגת שוקולד'), qty: N(2), price: N(12) }), M({ pid: S('pB'), n: S('לחם מחמצת'), qty: N(1), price: N(10.5), from: S('br2') })]) }),
  doc('ord/o2', { no: N(11), br: S('br2'), status: S('paid'), total: N(80), at: N(T1 - 9e6), cust: M({ name: S('רחל'), phone: S('0521112222') }), items: A([M({ n: S('מגש אירוח'), qty: N(1), price: N(80) })]), paid: M({ method: S('link'), last4: S('4242'), at: N(T1), amt: N(80) }) })];
const PROD = [doc('prod/pA', { name: S('עוגת שוקולד'), price: N(12), barcode: S('7290001'), on: { booleanValue: true }, q: M({ br1: N(5), br2: N(1) }) }),
  doc('prod/pB', { name: S('לחם מחמצת'), price: N(10.5), on: { booleanValue: true }, q: M({ br1: N(0), br2: N(8) }) })];
const ORG = M({ v: N(1), branches: A([M({ id: S('br1'), name: S('נחל לכיש'), on: { booleanValue: true } }), M({ id: S('br2'), name: S('יהודה הנשיא'), on: { booleanValue: true } })]) });

(async () => {
  const [www, outFile, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  let src = www;
  if (process.env.MUTATE === 'pay') {
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ord-')); fs.cpSync(www, tmp, { recursive: true });
    const f = path.join(tmp, 'orders-staff.js'); const s = fs.readFileSync(f, 'utf8'); const t = s.replace("window.open(u,'_system');", "window.open(u,'_system');toast(u);");
    if (s === t) throw new Error('mutation target not found'); fs.writeFileSync(f, t); src = tmp;
  }
  const browser = await H.launch();
  const cfg = { mode: 'new', users: { m: 'biz-o', sa: 'biz-o' }, sa: { sa: 1 }, biz: { 'biz-o': { dataRoot: 'b', features: ALL, name: 'עסק בדיקה' } }, admins: { 'b/biz-o/|m': 1 }, ctx: { hasTouch: true, isMobile: true } };
  const log = []; const calls = [];
  const { ctx, page } = await H.newPage(browser, src, cfg, log, 'm');
  await ctx.route(/:8080\/.*/, async (route) => {
    const req = route.request(); const u = new URL(req.url()); const body = req.postData() || '';
    if (/:runQuery$/.test(u.pathname)) { globalThis.__RQ = (globalThis.__RQ || []).concat([body]); let c = ''; try { c = JSON.parse(body).structuredQuery.from[0].collectionId; } catch (e) { /* */ }
      const r = c === 'ordpay' ? (globalThis.__OP || []) : c === 'ord' ? ORD : c === 'prod' ? PROD : c === 'stockLog' ? [doc('stockLog/s1', { name: S('עוגת שוקולד'), br: S('br1'), delta: N(5), why: S('in'), at: N(T1) })] : [{ readTime: '2026-11-03T09:00:00Z' }];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(r) }); }
    if (/\/ordcfg\/main$/.test(u.pathname)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ name: 'x', fields: { pay: M({ mode: S('link'), has: { booleanValue: true } }), src: M({ br1: S('stock') }) } }) });
    if (/\/ord\/o1\/log/.test(u.pathname)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ documents: [{ name: 'x/log/l1', fields: { t: N(T1), act: S('create'), note: S('₪34.5') } }] }) });
    if (/\/documents\/b\/biz-o$/.test(u.pathname) && req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ name: 'x', fields: { dataRoot: S('b'), status: S('active'), name: S('עסק בדיקה'), features: M(Object.fromEntries(Object.keys(ALL).map((k) => [k, { booleanValue: true }]))), org: ORG, brand: M({ name: S('עסק בדיקה') }) } }) });
    return route.fallback();
  });
  await ctx.route(/:5001\/.*/, async (route) => {
    const n = new URL(route.request().url()).pathname.split('/').pop(); let d = {}; try { d = JSON.parse(route.request().postData()).data; } catch (e) { /* */ }
    calls.push({ n, d });
    const R = { createOrder: { id: 'o1', no: 13, total: 24, warn: [] }, getPayLink: { link: LINK, total: 34.5 }, markOrderPaid: { ok: true }, setBusinessPayLink: { ok: true, mode: 'link', has: true }, getBackupKey: { key: Buffer.alloc(32, 7).toString('base64') } };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: R[n] || { ok: true } }) });
  });
  await page.addInitScript(() => { window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; }; });
  await H.login(page, 'm@x.co');
  await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden) ACT.startBlank(); });
  await H.settle(page, 500);
  await page.setViewportSize({ width: 390, height: 844 });
  const M3 = `(() => { const P = (s) => { const m = /rgba?\\(([^)]+)\\)/.exec(s); if (!m) return [0,0,0,0]; const a = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [a[0],a[1],a[2],a.length>3?a[3]:1]; };
    const lin = (v) => { v /= 255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); }; const L = (c) => 0.2126*lin(c[0])+0.7152*lin(c[1])+0.0722*lin(c[2]);
    const bgOf = (el) => { const layers = []; for (let e = el; e; e = e.parentElement) { const c = P(getComputedStyle(e).backgroundColor); if (c[3] > 0) layers.push(c); if (c[3] >= 1) break; } let acc = [255,255,255]; const d = document.createElement('i'); d.style.color = getComputedStyle(document.documentElement).getPropertyValue('--bg'); document.body.appendChild(d); const bg = P(getComputedStyle(d).color); d.remove(); if (!layers.length || layers[layers.length-1][3] < 1) acc = bg.slice(0,3); for (let i = layers.length-1; i >= 0; i--) { const c = layers[i]; acc = [0,1,2].map((k) => c[k]*c[3]+acc[k]*(1-c[3])); } return acc; };
    window.__cr = (el) => { const f = P(getComputedStyle(el).color), b = bgOf(el); const fg = [0,1,2].map((k) => f[k]*f[3]+b[k]*(1-f[3])); const x = L(fg), y = L(b); return Math.round((Math.max(x,y)+0.05)/(Math.min(x,y)+0.05)*100)/100; };
    window.__q = (root) => { const R = document.querySelector(root); const els = [...R.querySelectorAll('button, a, select, input:not([type=hidden]):not([type=checkbox]):not([type=radio])')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
      const small = els.filter((e) => { const r = e.getBoundingClientRect(); return r.height < 44 && !e.closest('label.f'); }).map((e) => (e.dataset.a || e.tagName) + ':' + Math.round(e.getBoundingClientRect().height));
      const txt = [...R.querySelectorAll('b, small, .note, .tag, button, span')].filter((e) => e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && e.getBoundingClientRect().width > 0);
      const crs = txt.map((e) => [__cr(e), (e.textContent||'').trim().slice(0,20)]).sort((a,b) => a[0]-b[0]);
      return { small, minCr: crs.length ? crs[0] : null, sw: document.documentElement.scrollWidth, iw: innerWidth, text: R.innerText }; }; })()`;
  await page.evaluate(M3);
  const setDs = (t) => page.evaluate((t) => { SY.biz = Object.assign({}, SY.biz, { brand: { name: 'עסק בדיקה', colors: {}, theme: t, base: 'dark-gold' } }); BZK = '~'; bzSkin(); }, t);
  const shot = async (n) => { if (shots) await page.screenshot({ path: path.join(shots, n + '.png'), fullPage: false }); };
  const screen = async (name, open, root) => { const r = {}; for (const t of ['a', 'b', 'c']) { await setDs(t); await open(); await H.settle(page, 400); await page.evaluate(M3);
      await page.setViewportSize({ width: 320, height: 700 }); await H.settle(page, 100); const n = await page.evaluate((rt) => __q(rt), root || '#main');
      await page.setViewportSize({ width: 390, height: 844 }); await H.settle(page, 100); r[t] = n; await shot(`${name}-${t}`); } return r; };
  const okAll = (r) => ['a', 'b', 'c'].every((t) => r[t].small.length === 0 && r[t].sw <= r[t].iw && (!r[t].minCr || r[t].minCr[0] >= 4.5));
  const sum = (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, [v.small, v.minCr, v.sw + '/' + v.iw]]));
  const goV = (v, a) => page.evaluate(([v, a]) => { NAV = [{ v: 'home' }]; go(v, a); }, [v, a]);

  // 1. רשימה
  const l = await screen('הזמנות-רשימה', () => goV('ox'));
  check('1 רשימה: הזמנה #12 פתוחה, צ\'יפים לסטטוס ולסניף, מגע ≥44, ניגודיות ≥4.5, בלי גלילה אופקית ב-320 (3 ערכות)', okAll(l) && /#12/.test(l.a.text) && /כל הסניפים/.test(l.a.text) && /ממתין לתשלום/.test(l.a.text), sum(l));
  // 2. הזמנה חדשה עם שורת מוצר
  const nw = await screen('הזמנה-חדשה', async () => { await page.evaluate(() => { window.__ox.draft = null; NAV = [{ v: 'home' }]; go('oxNew'); }); await H.settle(page, 200);
    await page.evaluate(() => { const D = window.__ox.draft || {}; }); await page.selectOption('select[data-k=br]', 'br1'); await page.fill('#oxq', 'לחם'); await page.click('[data-a=oxAdd]'); });
  check('2 הזמנה חדשה: סניף, שם/טלפון, חיפוש מוצר, "הסחורה מסניף" עם הצעה לסניף שיש בו (יהודה הנשיא), מגע/ניגודיות/גלילה', okAll(nw) && /הסחורה מסניף/.test(nw.a.text) && (await page.evaluate(() => document.querySelector('select[data-k=from]').value)) === 'br2', sum(nw));
  await page.fill('input[data-k=fn]', 'משה'); await page.fill('input[data-k=phone]', '0501234567');
  await page.click('[data-a=oxSave]'); await H.settle(page, 600);
  const co = calls.find((c) => c.n === 'createOrder');
  check('3 שמירה: createOrder עם br1, פריט pB מסניף br2, reqId, בלי total', !!co && co.d.br === 'br1' && co.d.items[0].pid === 'pB' && co.d.items[0].from === 'br2' && /^r[0-9a-z]{8,}/.test(co.d.reqId) && co.d.total === undefined, co && co.d);
  // 4. כרטיס הזמנה + לתשלום
  const cd = await screen('כרטיס-הזמנה', () => goV('oxOrd', 'o1'));
  await page.click('[data-a=oxPay]'); await H.settle(page, 800);
  const op = await page.evaluate(() => window.__opened.slice());
  const txt = await page.evaluate(() => document.body.innerText + document.body.innerHTML);
  check('4 "לתשלום": getPayLink ונפתח בדיוק הקישור, והקישור לא מופיע בשום מקום בעמוד', op.length === 1 && op[0] === LINK && !txt.includes('secret-biz-123'), { op, inPage: txt.includes('secret-biz-123') });
  check('5 כרטיס הזמנה: פריטים, סכום, "מסניף יהודה הנשיא", שינוי סטטוס, ביטול, מגע/ניגודיות/גלילה', okAll(cd) && /מסניף יהודה הנשיא/.test(cd.a.text) && /סמן שולם/.test(cd.a.text) && /בטיפול/.test(cd.a.text), sum(cd));
  // 6. סימון שולם
  await page.click('[data-a=oxPaid]'); await H.settle(page, 300); await setDs('a'); await shot('סימון-שולם-a');
  const dl = await page.evaluate(() => __q('#dlg'));
  await page.fill('#dlg input[name=last4]', '4242'); await page.fill('#dlg input[name=conf]', 'A123'); await page.click('#dlg button.btn.grow:not(.g)'); await H.settle(page, 500);
  const mp = calls.find((c) => c.n === 'markOrderPaid');
  check('6 סימון שולם: אמצעי + 4 ספרות + אישור; אין שדה מספר כרטיס מלא; מגע', !!mp && mp.d.last4 === '4242' && mp.d.conf === 'A123' && mp.d.id === 'o1' && dl.small.length === 0 && !/תוקף|CVV/i.test(await page.evaluate(() => [...document.querySelectorAll('#dlg input')].map((i) => i.name).join())), { mp: mp && mp.d, small: dl.small });
  // 7. מלאי
  const st = await screen('מלאי', () => goV('oxStock'));
  check('7 מלאי: הכנסת מלאי, מוצר חדש, נגמר במלאי, תיקון (מנהל), היסטוריה, כמויות לכל סניף; מגע/ניגודיות/גלילה', okAll(st) && /הכנסת מלאי/.test(st.a.text) && /נגמר במלאי/.test(st.a.text) && /תיקון כמות/.test(st.a.text) && /יהודה הנשיא: 1/.test(st.a.text), sum(st));
  await page.click('[data-a=oxIn]'); await H.settle(page, 300); await shot('הכנסת-מלאי-a');
  await page.selectOption('#dlg select[name=p0]', 'pA'); await page.fill('#dlg input[name=q0]', '5'); await page.click('#dlg button.btn.grow:not(.g)'); await H.settle(page, 500);
  const si = calls.find((c) => c.n === 'stockIn');
  check('8 הכנסת מלאי: stockIn עם הסניף שנבחר ושורה pA×5', !!si && si.d.br === 'br1' && si.d.lines[0].pid === 'pA' && si.d.lines[0].qty === 5, si && si.d);
  // 9. מקור מלאי
  const cf = await screen('מקור-מלאי', () => goV('oxCfg'));
  check('9 מקור מלאי לכל סניף (מנהל): "לפי המלאי" / "תמיד מ..."; מגע/ניגודיות/גלילה', okAll(cf) && /לפי המלאי/.test(cf.a.text) && /תמיד מיהודה הנשיא/.test(cf.a.text), sum(cf));
  // 10. בית – באנר
  await goV('home'); await H.settle(page, 400); await page.evaluate(() => { NAV = [{ v: 'home' }]; rerender(); }); await H.settle(page, 300);
  const hm = await page.evaluate(() => { const b = document.querySelector('#main .ban[data-v=ox]'); return b ? b.innerText : ''; });
  check('10 בית המנהל: באנר הזמנות פתוחות וסכום ששולם החודש', /פתוחות/.test(hm) && /שולם/.test(hm), hm);
  // 11. "עוד"
  await page.evaluate(() => tab('more')); await H.settle(page, 300);
  check('11 "עוד": שורת "הזמנות" (מנהל)', await page.evaluate(() => !!document.querySelector('#main [data-v=ox]')));
  // 13. מנהל־על: תשלום בהזמנות בכרטיס העסק
  await page.evaluate(() => { SY.sa = true; ADM.sa = true; ADM.L = [{ id: 'biz-o', name: 'עסק בדיקה', status: 'active', dataRoot: 'b', features: {} }]; ADM.info['biz-o'] = { adv: {} }; NAV = [{ v: 'more' }]; go('sab', 'biz-o'); }); await H.settle(page, 600);
  await page.evaluate(() => { const f = document.querySelector('form[data-f=oxPayF]'); if (f) f.scrollIntoView(); }); await setDs('a'); await H.settle(page, 200); await shot('תשלום-מנהל-על-a');
  const pf = await page.evaluate(() => { const f = document.querySelector('form[data-f=oxPayF]'); return f ? f.innerText : ''; });
  await page.fill('form[data-f=oxPayF] input[name=link]', 'http://bad.example.com'); await page.click('form[data-f=oxPayF] button'); await H.settle(page, 200);
  const n0 = calls.filter((c) => c.n === 'setBusinessPayLink').length;
  await page.fill('form[data-f=oxPayF] input[name=link]', LINK); await page.click('form[data-f=oxPayF] button'); await H.settle(page, 400);
  const sp = calls.filter((c) => c.n === 'setBusinessPayLink');
  check('13 מנהל־על: "תשלום בהזמנות" – קישור/טלפון; הקישור הקיים לא מוצג; http נחסם בטופס; https נשלח', /קישור סליקה/.test(pf) && /לא מוצג/.test(pf) && n0 === 0 && sp.length === 1 && sp[0].d.link === LINK && sp[0].d.bizId === 'biz-o', { pf: pf.slice(0, 120), n0, sp: sp.map((x) => x.d) });
  // 14. הכנסה + זיכוי: ordpay → תנועת הכנסה אחת בסניף ההזמנה עם off.sub; void → מבוטלת; בלי כפילות
  globalThis.__OP = [doc('ordpay/o2', { ord: S('o2'), no: N(11), br: S('br2'), amt: N(80), at: N(T1), st: S('paid'), sup: M({ id: S('s_sup1'), name: S('סמוויקס') }) })];
  await page.evaluate(() => { SY.sa = false; });
  const a1 = await page.evaluate(async () => { await window.__opSync(); await window.__opSync(); const L = S.tx.filter((t) => t.id === 'op_o2'); return L.map((t) => ({ t: t.t, amt: t.amt, br: t.br, off: t.off, x: !!t.x, cat: t.cat })); });
  globalThis.__OP = [doc('ordpay/o2', { ord: S('o2'), no: N(11), br: S('br2'), amt: N(80), at: N(T1), st: S('void'), sup: M({ id: S('s_sup1'), name: S('סמוויקס') }) })];
  const a2 = await page.evaluate(async () => { await window.__opSync(); const t = S.tx.find((x) => x.id === 'op_o2'); return { x: !!t.x, n: S.tx.filter((x) => x.id === 'op_o2').length }; });
  check('14 שולם בקישור הספק → הכנסה אחת (₪80, סניף ההזמנה, זכות אצל הספק); סנכרון כפול לא מכפיל; void → מבוטלת', a1.length === 1 && a1[0].t === 'inc' && a1[0].amt === 80 && a1[0].br === 'br2' && a1[0].off.sub === 's_sup1' && !a1[0].x && a2.x && a2.n === 1, { a1, a2 });
  // 15. העברה פנימית: זכות מהזמנה (₪80, br2) נוצלה ₪50 לחשבונית של הספק בסניף br1 → br2 −50, br1 +50, סה"כ 0; ניצול באותו סניף – בלי העברה
  const xf = await page.evaluate(() => {
    const M0 = new Date().toISOString().slice(0, 7);
    let u = S.subs.find((x) => x.id === 's_sup1'); if (!u) { const c = S.cats.find((x) => x.beh === 'sup'); u = { id: 's_sup1', cat: c.id, name: 'סמוויקס' }; S.subs.push(u); } u.offset = true;
    S.tx = S.tx.filter((t) => !/^(op_|xf_)/.test(t.id));
    S.tx.push({ id: 'op_x1', t: 'inc', cat: 'c_ordinc', sub: 's_ordlink', date: M0 + '-02', amt: 80, br: 'br2', off: { sub: 's_sup1' } });
    S.tx.push({ id: 'xf_i1', t: 'exp', cat: u.cat, sub: 's_sup1', date: M0 + '-03', amt: 50, br: 'br1', kind: 'inv', pays: [{ id: 'p1', d: M0 + '-03', a: 50, m: 'קיזוז' }] });
    const a = window.__brXfer(M0);
    S.tx.find((t) => t.id === 'xf_i1').br = 'br2';
    const b = window.__brXfer(M0);
    S.tx.find((t) => t.id === 'xf_i1').br = 'br1';
    HM = M0; NAV = [{ v: 'home' }]; render(0);
    const tb = document.querySelector('#brXfer'); return { a, b, html: tb ? tb.innerText : '', inc: document.querySelector('#brTbl') ? document.querySelector('#brTbl').innerText : '' };
  });
  await setDs('b'); await H.settle(page, 200); await page.evaluate(() => { const t = document.querySelector('#brXfer'); if (t) t.scrollIntoView(); }); await shot('העברה-פנימית-b');
  check('15 העברה פנימית בדוח לפי סניף: ‎−50/+50, סה"כ 0; באותו סניף – אין שורה', xf.a && xf.a.br2 === -50 && xf.a.br1 === 50 && xf.b === null && /סה״כ לעסק/.test(xf.html), xf);
  // 16. ספק הקישור מסומן אוטומטית כספק קיזוז (ליקוי 2), והזכות נראית בכרטיס שלו
  globalThis.__OP = [doc('ordpay/o9', { ord: S('o9'), no: N(9), br: S('br1'), amt: N(30), at: N(T1), upd: N(T1), st: S('paid'), sup: M({ id: S('s_sup2'), name: S('ספק ב') }) })];
  const ao = await page.evaluate(async () => { const c = S.cats.find((x) => x.beh === 'sup'); S.subs = S.subs.filter((x) => x.id !== 's_sup2'); S.subs.push({ id: 's_sup2', cat: c.id, name: 'ספק ב' });
    await window.__opSync(); const u = subById('s_sup2'); const B = offBal('s_sup2'); NAV = [{ v: 'home' }]; go('card', 's_sup2'); return { off: u.offset === true, bal: B.bal, card: /קיזוז|זכות/.test(document.querySelector('#main').innerText) }; });
  const oq = calls.length; void oq;
  check('16 ספק הקישור שאינו ספק קיזוז – מסומן אוטומטית; הזכות (₪30) בכרטיס הספק', ao.off && ao.bal === 30 && ao.card, ao);
  // 17. ordpay נשאל לפי upd יורד (2,000 האחרונים)
  const oqB = (globalThis.__RQ || []).filter((b) => /"ordpay"/.test(b)).pop(); const oqLog = oqB ? { body: oqB } : null;
  check('17 סנכרון ordpay ממוין לפי upd יורד', !!oqLog && /"orderBy":\[\{"field":\{"fieldPath":"upd"\},"direction":"DESCENDING"/.test(oqLog.body), oqLog && oqLog.body.slice(0, 200));
  check('12 בלי שגיאות JS', page.__errors.length === 0, page.__errors);
  await browser.close();
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
  console.log(fail ? `נכשלו ${fail}` : 'הכול עבר'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
