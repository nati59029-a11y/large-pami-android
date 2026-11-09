'use strict';
// fb/ord-catalog (orders-staff.js): קטגוריות, מחיר לסניף, טופס מוצר, ייבוא מלאי עם התאמת עמודות, העברות, סיטונאי בהזמנה.
// רשת מדומה. שימוש: node ui-ord-cat.js <www-dir> [out.json] [shots-dir].
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
const CATS = [doc('cat/c1', { name: S('מאפים'), ord: N(0) }), doc('cat/s1', { name: S('לחמים'), parent: S('c1'), ord: N(0) }), doc('cat/c2', { name: S('עוגות'), ord: N(1) })];
const PROD = [doc('prod/pA', { name: S('עוגת שוקולד'), price: N(12), barcode: S('7290001'), on: { booleanValue: true }, q: M({ br1: N(5), br2: N(1) }), cat: S('c2'), bp: M({ br2: N(15) }), pk: N(6) }),
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
      const r = c === 'ordpay' ? (globalThis.__OP || []) : c === 'ord' ? ORD : c === 'prod' ? PROD : c === 'cat' ? CATS : c === 'xfer' ? [doc('xfer/x1', { name: S('לחם מחמצת'), from: S('br2'), to: S('br1'), qty: N(2), why: S('order'), no: N(12), at: N(T1) })] : c === 'stockLog' ? [doc('stockLog/s1', { name: S('עוגת שוקולד'), br: S('br1'), delta: N(5), why: S('in'), at: N(T1) })] : [{ readTime: '2026-11-03T09:00:00Z' }];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(r) }); }
    if (/\/ordcfg\/main$/.test(u.pathname)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ name: 'x', fields: { pay: M({ mode: S('link'), has: { booleanValue: true } }), src: M({ br1: S('stock') }) } }) });
    if (/\/ord\/o1\/log/.test(u.pathname)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ documents: [{ name: 'x/log/l1', fields: { t: N(T1), act: S('create'), note: S('₪34.5') } }] }) });
    if (/\/documents\/b\/biz-o$/.test(u.pathname) && req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ name: 'x', fields: { dataRoot: S('b'), status: S('active'), name: S('עסק בדיקה'), features: M(Object.fromEntries(Object.keys(ALL).map((k) => [k, { booleanValue: true }]))), org: ORG, brand: M({ name: S('עסק בדיקה') }) } }) });
    return route.fallback();
  });
  await ctx.route(/:5001\/.*/, async (route) => {
    const n = new URL(route.request().url()).pathname.split('/').pop(); let d = {}; try { d = JSON.parse(route.request().postData()).data; } catch (e) { /* */ }
    calls.push({ n, d });
    if (n === 'getWsPrices' && globalThis.__WSDENY) return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { status: 'PERMISSION_DENIED', message: 'x', details: { reason: 'not-wholesale' } } }) });
    const R = { importProducts: { ok: true, added: 2, updated: 1, bad: [] }, getWsPrices: { wp: { pA: 9 } }, getCosts: { cost: { pA: 4 } }, transferStock: { ok: true }, saveCat: { ok: true, id: 'c3' }, createOrder: { id: 'o1', no: 13, total: 24, warn: [] }, getPayLink: { link: LINK, total: 34.5 }, markOrderPaid: { ok: true }, setBusinessPayLink: { ok: true, mode: 'link', has: true }, getBackupKey: { key: Buffer.alloc(32, 7).toString('base64') } };
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


  // 1. מלאי: סינון קטגוריה, מחיר לפי הסניף, כפתורי קטגוריות/ייבוא/העברות
  const st = await screen('קטלוג-מלאי', () => goV('oxStock'));
  check('1 מלאי: בורר קטגוריה, קטגוריות/ייבוא/העברות (מנהל), מחיר סניף נחל לכיש = בסיס ₪12, מארז; מגע/ניגודיות/גלילה (3 ערכות)', okAll(st) && /ייבוא מלאי/.test(st.a.text) && /העברות/.test(st.a.text) && /קטגוריות/.test(st.a.text) && /עוגות/.test(st.a.text) && /מארז 6/.test(st.a.text) && /12\.00/.test(st.a.text), sum(st));
  await page.selectOption('select[data-c=oxCF]', 'c2'); await H.settle(page, 200);
  const f1 = await page.evaluate(() => document.getElementById('oxpl').innerText);
  check('2 סינון קטגוריה "עוגות": רק עוגת שוקולד', /עוגת שוקולד/.test(f1) && !/לחם מחמצת/.test(f1), f1.slice(0, 120));
  await page.selectOption('select[data-c=oxCF]', ''); await H.settle(page, 100);
  await page.click('[data-a=oxSBr][data-id=br2]'); await H.settle(page, 200);
  const f2 = await page.evaluate(() => document.getElementById('oxpl').innerText);
  check('3 בסניף יהודה הנשיא – מחיר הסניף ₪15 (bp); לחם ישן בלי bp – ₪10.50', /15\.00/.test(f2) && /10\.50/.test(f2), f2.slice(0, 160));
  // 4. טופס מוצר: קטגוריה, מחיר לסניף, מארז/קרטון, סניף בית, סיטונאי (מנהל)
  await page.click('[data-a=oxEditP][data-id=pA]'); await H.settle(page, 300); await setDs('a'); await shot('קטלוג-טופס-מוצר-a');
  const pf = await page.evaluate(() => __q('#dlg'));
  await page.fill('#dlg input[name=bp_br1]', '11'); await page.fill('#dlg input[name=bp_br2]', ''); await page.fill('#dlg input[name=ct]', '24'); await page.fill('#dlg input[name=wp]', '9');
  await page.selectOption('#dlg select[name=sub]', 's1'); await page.selectOption('#dlg select[name=cat]', 'c1'); await page.selectOption('#dlg select[name=home]', 'br2');
  await page.click('#dlg button.btn.grow:not(.g)'); await H.settle(page, 500);
  const sp = calls.filter((c) => c.n === 'saveProduct').pop();
  check('4 טופס מוצר: saveProduct עם cat/sub, bp {br1:11, br2:""}, pk 6, ct 24, home, wp; מגע בדיאלוג', !!sp && sp.d.cat === 'c1' && sp.d.sub === 's1' && sp.d.bp.br1 === 11 && sp.d.bp.br2 === '' && sp.d.pk === 6 && sp.d.ct === 24 && sp.d.home === 'br2' && sp.d.wp === 9 && pf.small.length === 0 && pf.sw <= pf.iw, { d: sp && sp.d, small: pf.small });
  // 5. ייבוא: קובץ CSV עם כותרות בסדר אחר + עמודה מיותרת + מחיר טקסט
  await page.evaluate(() => { localStorage.removeItem('lp-ox-imp-map'); window.__ox.im = null; });
  const im = await screen('קטלוג-ייבוא', () => goV('oxImp'));
  const csv = 'ברקוד,הערה,כמות,מחיר,שם,קטגוריה\n111,x,3,5,קפה,שתייה\n222,y,1,abc,תה,שתייה\n333,z,,7.5,סוכר,\n';
  await page.setInputFiles('input[data-c=oxImpFile]', { name: 'm.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) }); await H.settle(page, 400);
  for (const [k, i] of [['name', 4], ['price', 3], ['barcode', 0], ['qty', 2], ['cat', 5]]) { await page.selectOption(`select[data-c=oxImpMap][data-k=${k}]`, String(i)); await H.settle(page, 120); }
  await setDs('a'); await H.settle(page, 100); await shot('קטלוג-ייבוא-התאמה-a');
  const mp = await page.evaluate(() => __q('#main'));
  check('5 ייבוא – מסך התאמה: 2 תקינות, 1 שגויה (מחיר "abc" מסומן); מסך הבחירה עובר מגע/ניגודיות/גלילה', okAll(im) && /2 שורות תקינות/.test(mp.text) && /1 שגויות/.test(mp.text) && /מחיר לא תקין/.test(mp.text) && mp.small.length === 0 && mp.sw <= mp.iw, { text: mp.text.slice(0, 300), small: mp.small });
  await page.click('[data-a=oxImpGo]'); await H.settle(page, 600);
  const ip = calls.filter((c) => c.n === 'importProducts');
  check('6 ייבוא נשלח: מנה אחת, 2 שורות, addQty=false, בלי השורה השגויה, שם/מחיר/ברקוד/כמות/קטגוריה; reqId', (ip.length === 1 && ip[0].d.rows.length === 2 && ip[0].d.addQty === false && ip[0].d.rows[0].name === 'קפה' && ip[0].d.rows[0].price === 5 && ip[0].d.rows[0].barcode === '111' && ip[0].d.rows[0].qty === 3 && ip[0].d.rows[0].cat === 'שתייה' && !ip[0].d.rows.some((r) => r.name === 'תה') && /^r/.test(ip[0].d.reqId)), ip.map((x) => x.d));
  const mem = await page.evaluate(() => JSON.parse(localStorage.getItem('lp-ox-imp-map') || '{}'));
  check('7 ההתאמה נזכרת לפי שם הכותרת', mem.name === 'שם' && mem.price === 'מחיר' && mem.barcode === 'ברקוד', mem);
  await page.evaluate(() => { window.__ox.im = null; rerender(); }); await H.settle(page, 200);
  await page.setInputFiles('input[data-c=oxImpFile]', { name: 'm2.csv', mimeType: 'text/csv', buffer: Buffer.from('שם,מחיר,ברקוד\nא,1,123\n') }); await H.settle(page, 300);
  const auto = await page.evaluate(() => window.__ox.im && window.__ox.im.map);
  check('8 קובץ שני עם סדר עמודות אחר – ההתאמה נטענת אוטומטית', auto && auto.name === 0 && auto.price === 1 && auto.barcode === 2, auto);
  // 9. 250 שורות → 2 מנות (200 + 50)
  const big = 'שם,מחיר,ברקוד\n' + Array.from({ length: 250 }, (_, i) => `מוצר ${i},${i + 1},B${String(i).padStart(4, '0')}`).join('\n') + '\n';
  await page.evaluate(() => { window.__ox.im = null; rerender(); }); await H.settle(page, 200);
  await page.setInputFiles('input[data-c=oxImpFile]', { name: 'big.csv', mimeType: 'text/csv', buffer: Buffer.from(big) }); await H.settle(page, 400);
  const n0 = calls.filter((c) => c.n === 'importProducts').length;
  await page.click('[data-a=oxImpGo]'); await H.settle(page, 900);
  const ip2 = calls.filter((c) => c.n === 'importProducts').slice(n0);
  check('9 250 שורות: שתי מנות 200+50 עם reqId שונה לכל מנה', ip2.length === 2 && ip2[0].d.rows.length === 200 && ip2[1].d.rows.length === 50 && ip2[0].d.reqId !== ip2[1].d.reqId, ip2.map((x) => [x.d.rows.length, x.d.reqId]));
  // 10. העברות
  const xf = await screen('קטלוג-העברות', async () => { await page.evaluate(() => { window.__ox.xf = undefined; }); await goV('oxXfer'); await H.settle(page, 400); });
  check('10 העברות: רשימה (יהודה הנשיא ← נחל לכיש, הזמנה #12) + העברה ידנית; מגע/ניגודיות/גלילה', okAll(xf) && /העברה ידנית/.test(xf.a.text) && /הזמנה #12/.test(xf.a.text), sum(xf));
  await page.click('[data-a=oxXfNew]'); await H.settle(page, 300); await setDs('a'); await shot('קטלוג-העברה-ידנית-a');
  await page.selectOption('#dlg select[name=pid]', 'pB'); await page.selectOption('#dlg select[name=from]', 'br2'); await page.selectOption('#dlg select[name=to]', 'br1'); await page.fill('#dlg input[name=qty]', '3');
  await page.click('#dlg button.btn.grow:not(.g)'); await H.settle(page, 500);
  const tr = calls.find((c) => c.n === 'transferStock');
  check('11 העברה ידנית: transferStock pB br2→br1 ×3 עם reqId', !!tr && tr.d.pid === 'pB' && tr.d.from === 'br2' && tr.d.to === 'br1' && tr.d.qty === 3 && /^r/.test(tr.d.reqId), tr && tr.d);
  // 12. הזמנה: מחיר לפי סניף; שינוי סניף מעדכן מחיר שלא נערך ידנית
  await page.evaluate(() => { window.__ox.draft = null; NAV = [{ v: 'home' }]; go('oxNew'); }); await H.settle(page, 300);
  await page.selectOption('select[data-k=br]', 'br2'); await page.fill('#oxq', 'עוגת'); await page.click('[data-a=oxAdd]'); await H.settle(page, 200);
  const p2 = await page.evaluate(() => window.__ox.draft.items[0].price);
  await page.selectOption('select[data-k=br]', 'br1'); await H.settle(page, 200);
  const p1 = await page.evaluate(() => window.__ox.draft.items[0].price);
  check('12 הזמנה: עוגה בסניף יהודה הנשיא ₪15, אחרי מעבר לנחל לכיש ₪12', p2 === '15' && p1 === '12', { p2, p1 });
  // 13. סיטונאי: מנהל רואה כפתור; עובד – רק כשנבחר לקוח wholesale
  const hasWs = () => page.evaluate(() => !!document.querySelector('[data-a=oxWs]'));
  const m1 = await hasWs();
  await page.click('[data-a=oxWs]'); await H.settle(page, 400);
  const pw = await page.evaluate(() => window.__ox.draft.items[0].price);
  await page.evaluate(() => { window.__mgrSave = SY.role; SY.role = 'worker'; SY.perms = { ord: true }; rerender(); }); await H.settle(page, 200);
  const e0 = await hasWs();
  await page.evaluate(() => { const D = window.__ox.draft; D.custId = 'p0502222222'; D.wholesale = false; rerender(); }); await H.settle(page, 200);
  const e1 = await hasWs();
  await page.evaluate(() => { const D = window.__ox.draft; D.custId = 't000000018'; D.wholesale = true; rerender(); }); await H.settle(page, 200);
  const e2 = await hasWs();
  const wsv = await page.evaluate(() => document.getElementById('main').innerHTML);
  await page.click('[data-a=oxWs]'); await H.settle(page, 400);
  const gw = calls.filter((c) => c.n === 'getWsPrices');
  const gwE = gw[gw.length - 1].d; // עובד: הלקוח + מזהה הטיוטה + רק מוצרי ההזמנה (השרת בודק את הקישור)
  const wsOk = gwE.custId === 't000000018' && typeof gwE.reqId === 'string' && Array.isArray(gwE.pids) && gwE.pids.length === 1;
  check('13 סיטונאי: מנהל – כפתור ומחיר ₪9 הוחל; עובד בלי לקוח / לקוח רגיל – אין כפתור; לקוח סיטונאי – יש; העובד רואה עלות (00:12)', m1 && pw === '9' && !e0 && !e1 && e2 && gw.length >= 2 && wsOk && /עלות/.test(wsv), { m1, pw, e0, e1, e2, gwE });
  // 13ב. עובד (00:12): רואה "ייבוא מלאי" עם עמודות סיטונאי ועלות, ושולח אותן
  await page.evaluate(() => { window.__ox.im = null; NAV = [{ v: 'home' }]; go('oxImp'); }); await H.settle(page, 300);
  await page.setInputFiles('input[data-c=oxImpFile]', { name: 'w.csv', mimeType: 'text/csv', buffer: Buffer.from('שם,מחיר,סיטונאי\nא,5,3\n') }); await H.settle(page, 400);
  const wImp = await page.evaluate(() => ({ wp: !!document.querySelector('select[data-c=oxImpMap][data-k=wp]'), cost: !!document.querySelector('select[data-c=oxImpMap][data-k=cost]'), name: !!document.querySelector('select[data-c=oxImpMap][data-k=name]') }));
  await page.selectOption('select[data-c=oxImpMap][data-k=wp]', '2'); await H.settle(page, 200);
  await page.click('[data-a=oxImpGo]'); await H.settle(page, 400);
  const ipW = calls.filter((c) => c.n === "importProducts").pop();
  check('13ב עובד: ייבוא מלאי עם עמודות סיטונאי ועלות, wp נשלח', wImp.name && wImp.wp && wImp.cost && !!ipW && ipW.d.rows[0].wp === 3, { wImp, ip: ipW && ipW.d });
  await page.evaluate(() => { SY.role = window.__mgrSave; });
  // 15. מסך ה-+ (00:27): מנהל – "משימה חדשה" בחצי רוחב ולידה "הזמנות"; עובד עם ord – "הזמנות"; עובד בלי ord – אין
  const plus = async () => { await page.evaluate(() => { NAV = [{ v: 'home' }]; rerender(); openAdd(); }); await H.settle(page, 300);
    return page.evaluate(() => { const o = document.querySelector('#sheet [data-a=addGo][data-v=ox]'), t = document.querySelector('#sheet [data-a=addGo][data-v=tk]');
      return { ox: !!o, row: !!(o && t && o.parentElement === t.parentElement), half: !!(t && t.getBoundingClientRect().width < window.innerWidth * 0.6) }; }); };
  const pm = await plus(); if (shots) await page.screenshot({ path: path.join(shots, 'plus-mgr-390.png') });
  await page.click('#sheet [data-a=addGo][data-v=ox]'); await H.settle(page, 300);
  const toOx = await page.evaluate(() => cur().v === 'ox');
  await page.evaluate(() => { SY.role = 'worker'; SY.perms = { ord: true }; }); const pw1 = await plus(); if (shots) await page.screenshot({ path: path.join(shots, 'plus-wk-390.png') });
  await page.evaluate(() => { SY.perms = { ord: false }; }); const pw0 = await plus();
  await page.evaluate(() => { SY.role = window.__mgrSave; SY.perms = {}; sheetClose(); });
  check('15 מסך +: מנהל – הזמנות ליד משימה חדשה (חצי רוחב) ופותח הזמנות; עובד עם ord – יש; בלי ord – אין', pm.ox && pm.row && pm.half && toOx && pw1.ox && !pw0.ox, { pm, toOx, pw1, pw0 });
  check('14 בלי שגיאות JS', page.__errors.length === 0, page.__errors);
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
  await browser.close();
  console.log(fail ? `נכשלו ${fail}` : 'הכול עבר');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
