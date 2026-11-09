'use strict';
// ניוד קווים (orders-lines.js, fb/ord-lines): מתג cellular, התראה לעובד מיד בסימון ניוד (לפני שמירה), cell בהזמנה, בנק, תוכניות ניוד (מנהל).
// רשת מדומה. שימוש: node ui-ord-lines.js <www-dir> [out.json] [shots-dir]. MUTATE=nohit – באג מכוון: בלי בדיקת התראה → בדיקה 3 נכשלת.
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const out = {}; let fail = 0;
const check = (name, ok, info) => { out[name] = { ok: !!ok, info }; if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const CELLON = process.env.CELL !== 'off';
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]).concat([['cellular', CELLON]]));
const S = (v) => ({ stringValue: v }), N = (v) => (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }), M = (o) => ({ mapValue: { fields: o } }), A = (a) => ({ arrayValue: { values: a } });
const doc = (p, f) => ({ document: { name: 'projects/demo-largpeami/databases/(default)/documents/b/biz-o/' + p, fields: f } });
const LINK = 'https://pay.example.com/secret-biz-123';
const T1 = Date.UTC(2026, 10, 3, 8, 0, 0);
const ORD = [doc('ord/o1', { no: N(12), br: S('br1'), status: S('new'), total: N(34.5), at: N(T1), byName: S('דנה'), cust: M({ name: S('משה כהן'), phone: S('0501234567'), addr: S('הרצל 1') }), items: A([M({ pid: S('pA'), n: S('עוגת שוקולד'), qty: N(2), price: N(12) }), M({ pid: S('pB'), n: S('לחם מחמצת'), qty: N(1), price: N(10.5), from: S('br2') })]) }),
  doc('ord/o2', { no: N(11), br: S('br2'), status: S('paid'), total: N(80), at: N(T1 - 9e6), cust: M({ name: S('רחל'), phone: S('0521112222') }), items: A([M({ n: S('מגש אירוח'), qty: N(1), price: N(80) })]), paid: M({ method: S('link'), last4: S('4242'), at: N(T1), amt: N(80) }) })];
const PROD = [doc('prod/pA', { name: S('עוגת שוקולד'), price: N(12), barcode: S('7290001'), on: { booleanValue: true }, q: M({ br1: N(5), br2: N(1) }) }),
  doc('prod/pB', { name: S('לחם מחמצת'), price: N(10.5), on: { booleanValue: true }, q: M({ br1: N(0), br2: N(8) }) })];
const TZ = '123456782';
const TZL = '222222226', LN = 'א'.repeat(45), LA = 'ב'.repeat(120);
const CUST = [doc('cust/t' + TZL, { name: S(LN), phone: S('0507777777'), tz: S(TZL), addr: S(LA), mail: S('old@x.co') }), doc('cust/t' + TZ, { name: S('משה כהן'), phone: S('0501234567'), tz: S(TZ), mail: S('moshe@x.co'), addr: S('הרצל 1'), x: M({ xcity: S('אשדוד') }) })];
const PLANS = [doc('lineplan/pl1', { name: S('פרטנר 30'), carrier: S('פרטנר'), days: N(30), on: { booleanValue: true } })];
// שלב 4 (חבילות): ערך JS → שדה Firestore REST
const FV = (v) => (v === null ? { nullValue: null } : typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? N(v) : typeof v === 'string' ? S(v) : Array.isArray(v) ? A(v.map(FV)) : M(Object.fromEntries(Object.entries(v).map(([k, x]) => [k, FV(x)]))));
const PK = { pP: { name: 'פרטנר חדשה', carrier: 'פרטנר', monthly: 39.9, details: '5G ללא הגבלה', ship: { amt: 30, pay: 'store' }, sim: { amt: 20, pay: 'carrier' }, on: true },
  pH: { name: 'הוט 29', carrier: 'הוט', monthly: 29.9, ship: { amt: 30, pay: 'store' }, sim: { amt: 10, pay: 'store' }, on: true },
  pC: { name: 'סלקום 49', carrier: 'סלקום', monthly: 49, sim: { amt: 25, pay: 'store' }, on: true } };
for (const [id, p] of Object.entries(PK)) PLANS.push(doc('lineplan/' + id, Object.fromEntries(Object.entries(p).map(([k, v]) => [k, FV(v)]))));
const CCFG = { carriers: ['פרטנר', 'סלקום', 'הוט'], ads: ['פייסבוק'], disc: { 'פרטנר': { t: 'amt', v: 20 } }, cap: { 'פרטנר': { t: 'amt', v: 50 }, 'הוט': { t: 'amt', v: 50 } },
  promos: [{ id: 'x3', name: '3 קווים', carriers: ['פרטנר', 'הוט'], min: 3, kind: 'once', disc: { t: 'amt', v: 100 }, stack: 'add', on: true }] };
const CC0 = { carriers: ['פרטנר', 'סלקום'], ads: ['פייסבוק'] }; // בדיקות 1–10 כמו קודם; בדיקה 11 – CCFG (נטען מחדש דרך שמירת הרשימות)
const LD = require('../../functions/lib/line-discount');
const ORG = M({ v: N(1), branches: A([M({ id: S('br1'), name: S('נחל לכיש'), on: { booleanValue: true } }), M({ id: S('br2'), name: S('יהודה הנשיא'), on: { booleanValue: true } })]) });

(async () => {
  const [www, outFile, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  let src = www;
  if (process.env.MUTATE === 'nobiz') { // באג מכוון: בלי העטיפה של bizId → בדיקה 10 נכשלת
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ob-')); fs.cpSync(www, tmp, { recursive: true });
    for (const n of ['orders-staff.js', 'orders-cust.js', 'orders-lines.js']) { const f = path.join(tmp, n); const s = fs.readFileSync(f, 'utf8'); const t = s.replace(/^const fnCall=\(n,d\)=>.*$/m, ''); if (s === t) throw new Error('mutation target not found'); fs.writeFileSync(f, t); }
    src = tmp;
  }
  if (process.env.MUTATE === 'nohit') {
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ol-')); fs.cpSync(www, tmp, { recursive: true });
    const f = path.join(tmp, 'orders-lines.js'); const s = fs.readFileSync(f, 'utf8'); const t = s.replace("const r=await fnCall('checkLines',{lines:[ln]});", "const r={hits:[]};");
    if (s === t) throw new Error('mutation target not found'); fs.writeFileSync(f, t); src = tmp;
  }
  const browser = await H.launch();
  const cfg = { mode: 'new', users: { m: 'biz-o', sa: 'biz-o' }, sa: { sa: 1 }, biz: { 'biz-o': { dataRoot: 'b', features: ALL, name: 'עסק בדיקה' } }, admins: { 'b/biz-o/|m': 1 }, ctx: { hasTouch: true, isMobile: true } };
  const log = []; const calls = [];
  const { ctx, page } = await H.newPage(browser, src, cfg, log, 'm');
  await ctx.route(/:8080\/.*/, async (route) => {
    const req = route.request(); const u = new URL(req.url()); const body = req.postData() || '';
    if (/:runQuery$/.test(u.pathname)) { globalThis.__RQ = (globalThis.__RQ || []).concat([body]); let c = ''; try { c = JSON.parse(body).structuredQuery.from[0].collectionId; } catch (e) { /* */ }
      const r = c === 'lineplan' ? PLANS : c === 'cust' ? CUST : c === 'ordpay' ? (globalThis.__OP || []) : c === 'ord' ? ORD : c === 'prod' ? PROD : c === 'stockLog' ? [doc('stockLog/s1', { name: S('עוגת שוקולד'), br: S('br1'), delta: N(5), why: S('in'), at: N(T1) })] : [{ readTime: '2026-11-03T09:00:00Z' }];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(r) }); }
    const cm = /\/cust\/([^/]+)$/.exec(u.pathname); if (cm) { const d = CUST.find((x) => x.document.name.endsWith('/' + cm[1])); return d ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(d.document) }) : route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":{"code":404}}' }); }
    if (/\/ordcfg\/cell$/.test(u.pathname)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ name: 'x', fields: Object.fromEntries(Object.entries(globalThis.__CC || CC0).map(([k, v]) => [k, FV(v)])) }) });
    if (/\/custcfg\/main$/.test(u.pathname)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ name: 'x', fields: { xKeys: A([M({ k: S('xcity'), label: S('עיר') })]) } }) });
    if (/\/ordcfg\/main$/.test(u.pathname)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ name: 'x', fields: { pay: M({ mode: S('link'), has: { booleanValue: true } }), src: M({ br1: S('stock') }) } }) });
    if (/\/ord\/o1\/log/.test(u.pathname)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ documents: [{ name: 'x/log/l1', fields: { t: N(T1), act: S('create'), note: S('₪34.5') } }] }) });
    if (/\/documents\/b\/biz-o$/.test(u.pathname) && req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ name: 'x', fields: { dataRoot: S('b'), status: S('active'), name: S('עסק בדיקה'), features: M(Object.fromEntries(Object.keys(ALL).map((k) => [k, { booleanValue: ALL[k] }]))), org: ORG, brand: M({ name: S('עסק בדיקה') }) } }) });
    return route.fallback();
  });
  await ctx.route(/:5001\/.*/, async (route) => {
    const n = new URL(route.request().url()).pathname.split('/').pop(); let d = {}; try { d = JSON.parse(route.request().postData()).data; } catch (e) { /* */ }
    calls.push({ n, d });
    const R = { checkLines: { hits: d && d.lines && d.lines[0] && d.lines[0].phone === '0521111111' ? [{ i: 0, phone: '0521111111', d: '2026-10-30', br: 'br2', days: 30, src: 'ord' }] : [] }, saveLinePlan: { ok: true, id: 'pl2', days: 45 }, saveCust: { ok: true, id: 't' + TZ }, setCustCfg: { ok: true, xKeys: [{ k: 'xcity', label: 'עיר' }, { k: 'xab12', label: 'הערות' }] }, importCusts: { ok: true, created: 2, updated: 0, same: 0, bad: [] }, createOrder: { id: 'o1', no: 13, total: 24, warn: [] }, getPayLink: { link: LINK, total: 34.5 }, markOrderPaid: { ok: true }, setBusinessPayLink: { ok: true, mode: 'link', has: true }, getBackupKey: { key: Buffer.alloc(32, 7).toString('base64') } };
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


  const fresh = async () => { await page.evaluate(() => { const g = document.getElementById('dlg'); if (g && g.open) g.close(); window.__ox.draft = null; NAV = [{ v: 'home' }]; go('oxNew'); }); await H.settle(page, 400); if (await page.$('select[data-k=br]')) await page.selectOption('select[data-k=br]', 'br1'); };
  if (!CELLON) { // מתג כבוי: אין שום שדה ניוד, createOrder בלי cell, אין תוכניות ניוד
    await fresh(); const t = await page.innerText('#main');
    const noTz = !(await page.$('#octz')); // 2026-11-09: בלי ניוד – אין ת"ז בטופס
    await page.fill('input[data-k=fn]', 'רות'); await page.fill('input[data-k=ln]', 'כהן'); await page.fill('input[data-k=phone]', '0529998888');
    await page.fill('#oxq', 'לחם'); await page.click('[data-a=oxAdd]'); await H.settle(page, 200); await page.click('[data-a=oxSave]'); await H.settle(page, 800);
    const co = calls.find((c) => c.n === 'createOrder'); await goV('ox'); await H.settle(page, 300); const lt = await page.innerText('#main');
    check('כבוי: אין "ניוד" ואין ת"ז בטופס, createOrder בלי cell, אין checkLines, אין "תוכניות ניוד"', noTz && !/ניוד/.test(t) && !!co && co.d.cell === undefined && !calls.some((c) => c.n === 'checkLines') && !/תוכניות ניוד|חבילות ניוד/.test(lt), { co: co && co.d });
    check('בלי שגיאות JS', page.__errors.length === 0, page.__errors);
  } else {
  // 1. טופס: חלק "ניוד קווים" + מגע/ניגודיות/גלילה
  const s1 = await screen('הזמנה-ניוד', async () => { await fresh(); await page.click('[data-c=olOn]'); await H.settle(page, 500); });
  check('1 הזמנה חדשה עם ניוד: קו ראשון "הטלפון/הת.ז של הלקוח", תוכנית וחברה מהרשימות, פרסום, בנק; מגע/ניגודיות/גלילה', okAll(s1) && /ניוד קווים/.test(s1.a.text) && /פרטנר 30/.test(await page.innerHTML('#main')) && /סלקום/.test(await page.innerHTML('#main')) && /פייסבוק/.test(await page.innerHTML('#main')), sum(s1));
  // 2. התראה מיד בסימון – לפני שמירה (טלפון הלקוח נויד לאחרונה)
  await fresh(); await page.fill('input[data-k=fn]', 'רות'); await page.fill('input[data-k=ln]', 'כהן'); await page.fill('input[data-k=phone]', '0521111111'); await H.settle(page, 400);
  const tz0 = !(await page.$('#octz'));
  const before = calls.filter((c) => c.n === 'createOrder').length;
  await page.click('[data-c=olOn]'); await H.settle(page, 700);
  await page.fill('#octz', '000000018'); await H.settle(page, 300); // 2026-11-09: בעסק עם ניוד השדה מוצג מההתחלה (רשות)
  if (tz0) throw new Error('ת"ז (רשות) לא מוצגת בתחילת ההזמנה בעסק עם ניוד'); // 2026-11-09 (Dפון): בעסק עם ניוד – השדה מוצג מההתחלה, לא חובה
  const t2 = await page.innerText('#main'); const ck = calls.filter((c) => c.n === 'checkLines').pop();
  check('2 סימון "הלקוח רוצה ניוד" → checkLines מיד ובלי שמירה; "קו זה כבר נויד בתאריך 30.10.2026 בסניף יהודה הנשיא" + המשך/בטל', !!ck && ck.d.lines[0].phone === '0521111111' && /כבר נויד בתאריך 30\.10\.2026 בסניף יהודה הנשיא/.test(t2) && /המשך בכל זאת/.test(t2) && /בטל ניוד לקו/.test(t2) && calls.filter((c) => c.n === 'createOrder').length === before, { t2: t2.slice(0, 300), ck: ck && ck.d });
  await shot('התראת-ניוד');
  // 3. שמירה לפני מענה – נחסמת; "המשך" → נשמר עם ack ו-cell מלא
  await page.fill('#oxq', 'לחם'); await page.click('[data-a=oxAdd]'); await H.settle(page, 300);
  await page.click('[data-a=oxSave]'); await H.settle(page, 400);
  const blocked = calls.filter((c) => c.n === 'createOrder').length === before;
  await page.click('[data-a=olOk]'); await H.settle(page, 200);
  await page.click('[data-a=olAdd]'); await H.settle(page, 200);
  await page.fill('[data-i=olF][data-f=phone] >> nth=0', '0532222222'); await H.settle(page, 500);
  await page.fill('[data-i=olF][data-f=tz] >> nth=0', '123456782');
  await page.selectOption('[data-c=olSel][data-f=carrier] >> nth=1', 'סלקום'); await page.selectOption('[data-c=olSel][data-f=plan] >> nth=1', 'pl1'); await H.settle(page, 400); // שלב 4: חבילה עם חברה קובעת את החברה
  await page.selectOption('[data-c=olAd]', 'פייסבוק');
  await page.click('#olin details summary'); await page.fill('[data-i=olB][data-f=bank]', '12'); await page.fill('[data-i=olB][data-f=br]', '345'); await page.fill('[data-i=olB][data-f=acct]', '123456'); await page.fill('[data-i=olB][data-f=ctz]', '123456782');
  await page.click('[data-a=oxSave]'); await H.settle(page, 900);
  const co = calls.filter((c) => c.n === 'createOrder').pop(); const cl = co && co.d.cell;
  check('3 שמירה נחסמת עד מענה להתראה; אחרי "המשך" נשלח cell: קו של הלקוח + קו נוסף עם ת"ז/תוכנית/חברה, ack, פרסום, בנק, ת"ז בעל כרטיס', blocked && !!cl && cl.ack === true && cl.lines.length === 2 && cl.lines[0].same === true && cl.lines[0].sameTz === true && cl.lines[1].phone === '0532222222' && cl.lines[1].tz === '123456782' && cl.lines[1].plan === 'pl1' && cl.lines[1].carrier === 'פרטנר' && cl.man === undefined && cl.ad === 'פייסבוק' && cl.bank.acct === '123456' && cl.ctz === '123456782', { blocked, cl });
  // 4. "בטל ניוד לקו" מסיר את הקו; בנק עם אותיות נחסם בטופס
  await fresh(); await page.fill('input[data-k=fn]', 'רות'); await page.fill('input[data-k=ln]', 'כהן'); await page.fill('input[data-k=phone]', '0521111111'); await page.click('[data-c=olOn]'); await H.settle(page, 700);
  await page.click('[data-a=olDel]'); await H.settle(page, 200); const n4 = await page.evaluate(() => window.__ox.draft.cell.lines.length);
  await page.click('[data-a=olAdd]'); await page.fill('[data-i=olF][data-f=phone] >> nth=0', '0533333333'); await page.click('#olin details summary'); await page.fill('[data-i=olB][data-f=bank]', '1a');
  await page.fill('#oxq', 'לחם'); await page.click('[data-a=oxAdd]'); await H.settle(page, 300);
  const nb = calls.filter((c) => c.n === 'createOrder').length; await page.click('[data-a=oxSave]'); await H.settle(page, 400);
  check('4 "בטל ניוד לקו" מסיר אותו; בנק לא תקין נחסם לפני שליחה', n4 === 0 && calls.filter((c) => c.n === 'createOrder').length === nb, { n4 });
  // 5. מנהל: תוכניות ניוד, ברירת מחדל 60
  const s5 = await screen('תוכניות-ניוד', () => goV('oxLines'));
  await page.click('[data-a=olPE][data-id=""]'); await H.settle(page, 200); const def = await page.inputValue('#dlg input[name=days]');
  await page.fill('#dlg input[name=name]', 'סלקום 45'); await page.fill('#dlg input[name=days]', '45'); await page.selectOption('#dlg select[name=carrier]', 'סלקום'); await page.click('#dlg button.btn.grow:not(.g)'); await H.settle(page, 500);
  const sp = calls.filter((c) => c.n === 'saveLinePlan').pop();
  // 5א. חבילה עם פרטים, עלות, משלוח/סים ולמי משלמים
  await page.click('[data-a=olPE][data-id=pl1]'); await H.settle(page, 200);
  await page.fill('#dlg textarea[name=details]', '5G ללא הגבלה'); await page.fill('#dlg input[name=monthly]', '29.9'); await page.fill('#dlg input[name=ship]', '20'); await page.selectOption('#dlg select[name=shipP]', 'carrier'); await page.fill('#dlg input[name=sim]', '10');
  await shot('חבילה-עריכה'); await page.click('#dlg button.btn.grow:not(.g)'); await H.settle(page, 500);
  const sk = calls.filter((c) => c.n === 'saveLinePlan').pop();
  check('5א חבילה: פרטים, עלות חודשית, משלוח לחברה, סים לחנות, כיבוי', !!sk && sk.d.id === 'pl1' && sk.d.details === '5G ללא הגבלה' && sk.d.monthly === 29.9 && sk.d.ship.amt === 20 && sk.d.ship.pay === 'carrier' && sk.d.sim.amt === 10 && sk.d.sim.pay === 'store' && sk.d.on === true && sk.d.days === 30, sk && sk.d);
  // 5ב. מלאי: כפתור "חבילות ניוד"
  await goV('oxStock'); await H.settle(page, 400); const st = await page.innerText('#main');
  check('5ב מלאי: כפתור "חבילות ניוד"', /חבילות ניוד/.test(st), st.slice(0, 120));
  // 5ג. הגדרות ניוד: הנחה קבועה, תקרה (0 נשמרת, ריק = בלי), מבצע
  const s5c = await screen('הגדרות-ניוד', () => goV('oxLnCfg'));
  await page.fill('#main input[name=d0]', '50'); await page.fill('#main input[name=k0]', '0'); await page.fill('#main input[name=d1]', '10'); await page.selectOption('#main select[name=d1T]', 'pct');
  await page.click('form[data-f=olDF] button'); await H.settle(page, 500);
  const sc = calls.filter((c) => c.n === 'setCellCfg').pop();
  check('5ג הנחה קבועה ותקרה לכל חברה; מגע/ניגודיות/גלילה', okAll(s5c) && !!sc && JSON.stringify(sc.d) === JSON.stringify({ disc: { 'פרטנר': { t: 'amt', v: 50 }, 'סלקום': { t: 'pct', v: 10 } }, cap: { 'פרטנר': { t: 'amt', v: 0 } } }), { d: sc && sc.d, s: sum(s5c) });
  await page.click('[data-a=olPrE][data-id=""]'); await H.settle(page, 200);
  await page.fill('#dlg input[name=name]', '3 קווים'); await page.check('#dlg input[name=c0]'); await page.check('#dlg input[name=c1]'); await page.fill('#dlg input[name=min]', '3'); await page.fill('#dlg input[name=disc]', '10'); await page.selectOption('#dlg select[name=discT]', 'pct'); await page.selectOption('#dlg select[name=kind]', 'once');
  const nPr = calls.filter((c) => c.n === 'setCellCfg').length; await page.click('#dlg button.btn.grow:not(.g)'); await H.settle(page, 300);
  const blockedPct = calls.filter((c) => c.n === 'setCellCfg').length === nPr;
  await page.fill('#dlg input[name=disc]', '100'); await page.selectOption('#dlg select[name=discT]', 'amt'); await page.selectOption('#dlg select[name=stack]', 'replace'); await page.fill('#dlg input[name=to]', '2026-12-31');
  await page.setViewportSize({ width: 320, height: 700 }); await H.settle(page, 100); const sw = await page.evaluate(() => { const g = document.getElementById('dlg'); const gr = g.getBoundingClientRect(); window.__ovf = [...g.querySelectorAll('*')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.left < gr.left - 1 || r.right > gr.right + 1); }).map((e) => e.tagName + '.' + (e.name || e.className) + ':' + Math.round(e.getBoundingClientRect().width)).slice(0, 8); return [document.documentElement.scrollWidth, innerWidth, g.scrollWidth, g.clientWidth, window.__ovf]; }); await page.setViewportSize({ width: 390, height: 844 }); await H.settle(page, 100); await shot('מבצע-חדש');
  await page.click('#dlg button.btn.grow:not(.g)'); await H.settle(page, 500);
  const pr = calls.filter((c) => c.n === 'setCellCfg').pop(); const P0 = pr && pr.d.promos && pr.d.promos[0];
  check('5ד מבצע: כמה חברות, מינימום, סכום, פעם אחת, מחליף, תאריך; אחוז "פעם אחת" נחסם', blockedPct && !!P0 && P0.carriers.join() === 'פרטנר,סלקום' && P0.min === 3 && P0.kind === 'once' && P0.stack === 'replace' && P0.disc.t === 'amt' && P0.disc.v === 100 && P0.to === '2026-12-31' && P0.on === true && sw[0] <= sw[1] && sw[2] <= sw[3] && !sw[4].length, { blockedPct, P0, sw });
  await goV('oxLines'); await H.settle(page, 200);
  check('5 מסך תוכניות ניוד (מנהל): טווח 30 מוצג, ברירת מחדל 60 בתוכנית חדשה, saveLinePlan {name, days:45, carrier}; מגע/ניגודיות/גלילה', okAll(s5) && /התראה על ניוד חוזר: 30 יום/.test(s5.a.text) && def === '60' && !!sp && sp.d.days === 45 && sp.d.carrier === 'סלקום', { def, sp: sp && sp.d, s: sum(s5) });
  // 6. עובד: אין מסך תוכניות
  await page.evaluate(() => { window.__role0 = SY.role; window.__sa0 = SY.sa; SY.role = 'worker'; delete SY.sa; }); await goV('oxLines'); await H.settle(page, 200); const e6 = await page.innerText('#main');
  await page.click('[data-a=olPE][data-id=pl1]'); await H.settle(page, 200); /* החלטה 21:25: גם עובד רואה ומשנה את הטווח */ const noDays = !!(await page.$('#dlg input[name=days]')); await page.click('#dlg button.btn.grow:not(.g)'); await H.settle(page, 500); const sw6 = calls.filter((c) => c.n === 'saveLinePlan').pop();
  await goV('oxLnCfg'); await H.settle(page, 200); const e6c = await page.innerText('#main'); await goV('ox'); await H.settle(page, 200); const e6b = await page.innerText('#main');
  await page.evaluate(() => { SY.role = window.__role0; if (window.__sa0) SY.sa = window.__sa0; });
  check('6 עובד: רואה ועורך חבילות (כולל טווח התראה), בלי הנחות/תקרות/מבצעים ובלי רשימות', /פרטנר 30/.test(e6) && !/הנחות, תקרות ומבצעים|עריכת הרשימות/.test(e6) && /התראה על ניוד חוזר: 30 יום/.test(e6) && noDays && !!sw6 && sw6.d.days === 30 && /אין לך הרשאה/.test(e6c) && !/חבילות ניוד/.test(e6b), { e6: e6.slice(0, 120), sw6: sw6 && sw6.d });
  // 7. ייבוא לקוחות: עמודת סניף הניוד (01:00)
  await goV('ocList'); await H.settle(page, 300); await page.click('[data-a=ocImp]'); await H.settle(page, 200);
  const csv = 'שם,טלפון,תאריך ניוד,טלפון ניוד,סניף\nדנה,0501111111,02/01/2025,0521234567,יהודה הנשיא\nיוסי,0502222222,02/01/2025,,סניף לא קיים\n';
  await page.setInputFiles('#dlg input[type=file]', { name: 'c.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) }); await H.settle(page, 500);
  const g7 = await page.inputValue('#dlg select[name=m4]');
  await page.click('#dlg button.btn.grow:not(.g)'); await H.settle(page, 400); const pv = await page.innerText('#dlg');
  await page.click('#dlg [data-a=ocGo]'); await H.settle(page, 600);
  const ic = calls.filter((c) => c.n === 'importCusts').pop();
  check('7 ייבוא: עמודת "סניף" מזוהה כסניף הניוד, נשלח מזהה הסניף; סניף לא קיים – שורה מסומנת', g7 === 'pbr' && !!ic && ic.d.rows.length === 1 && ic.d.rows[0].ports[0].br === 'br2' && /שורה 3: סניף/.test(pv), { g7, rows: ic && ic.d.rows, pv: pv.slice(0, 200) });
  // 9 (2026-11-09, Dפון): מנהל־על שנכנס לעסק – כל קריאות ההזמנות נושאות bizId של העסק שנבחר; מנהל רגיל – בלי bizId
  const n0 = calls.length;
  await fresh(); await page.fill('input[data-k=fn]', 'רות'); await page.fill('input[data-k=ln]', 'כהן'); await page.fill('input[data-k=phone]', '0529998887'); await H.settle(page, 300);
  const tz9 = !!(await page.$('#octz')) && /רשות/.test(await page.evaluate(() => document.getElementById('octz').closest('label').innerText));
  await page.fill('#oxq', 'לחם'); await page.click('[data-a=oxAdd]'); await H.settle(page, 200); await page.click('[data-a=oxSave]'); await H.settle(page, 800);
  const m9 = calls.slice(n0).filter((c) => c.n !== 'getBackupKey'); const co9 = m9.find((c) => c.n === 'createOrder');
  check('9 עסק עם ניוד: ת"ז (רשות) מוצגת מההתחלה; הזמנה בלי ת"ז ובלי ניוד נשמרת; מנהל רגיל – בלי bizId', tz9 && !!co9 && !(co9.d.cust && co9.d.cust.tz) && co9.d.cell === undefined && m9.every((c) => !('bizId' in (c.d || {}))), m9.map((c) => c.n));
  await page.evaluate(() => { window.__sa0 = SY.sa; SY.sa = 1; }); const n1 = calls.length;
  await fresh(); await page.fill('input[data-k=fn]', 'רות'); await page.fill('input[data-k=ln]', 'כהן'); await page.fill('input[data-k=phone]', '0529998886'); await H.settle(page, 300);
  await page.fill('#oxq', 'לחם'); await page.click('[data-a=oxAdd]'); await H.settle(page, 200); await page.click('[data-a=oxSave]'); await H.settle(page, 800);
  await page.evaluate(() => { SY.sa = window.__sa0; });
  const m10 = calls.slice(n1).filter((c) => c.n !== 'getBackupKey'); const co10 = m10.find((c) => c.n === 'createOrder');
  check('10 מנהל־על בתוך העסק: createOrder (עם הסניף שנבחר) וכל קריאות ההזמנות נשלחות עם bizId=biz-o', !!co10 && co10.d.br === 'br1' && m10.every((c) => c.d && c.d.bizId === 'biz-o'), m10.map((c) => [c.n, c.d && c.d.bizId]));
  // 11 (שלב 4): חבילה לכל קו, פירוט הנחות, המלצה, הנחה ידנית/מבצע, תקרה. הסכום בטופס = אותה פונקציה של השרת על מה שנשלח.
  const same = fs.readFileSync(path.join(www, 'line-discount.js'), 'utf8') === fs.readFileSync(path.join(__dirname, '../../functions/lib/line-discount.js'), 'utf8');
  check('11א line-discount.js בטופס זהה לקובץ של השרת', same);
  const pm = new Map(Object.entries(PK));
  globalThis.__CC = CCFG; await goV('oxLines'); await H.settle(page, 200); await page.click('[data-a=olCfg]'); await H.settle(page, 200); await page.click('#dlg button.btn.grow:not(.g)'); await H.settle(page, 600);
  const srvNet = (d, capped) => { const it = d.items.reduce((s, x) => s + Math.round(x.qty * x.price * 100), 0); try { return LD.calcCell(d.cell.lines, pm, CCFG, d.cell.man || {}, { itemsAg: it, today: LD.ilDay(), capped }).net; } catch (e) { return 'ERR ' + e.reason; } };
  const tot = async () => +String(await page.innerText('#oxtot')).replace(/[^\d.]/g, '');
  const build = async (ph, pkgs) => { await fresh(); await page.fill('input[data-k=fn]', 'רות'); await page.fill('input[data-k=ln]', 'כהן'); await page.fill('input[data-k=phone]', ph); await H.settle(page, 300); await page.fill('#octz', '123456782');
    await page.fill('#oxq', 'לחם'); await page.click('[data-a=oxAdd]'); await H.settle(page, 200); await page.click('[data-c=olOn]'); await H.settle(page, 500);
    for (let i = 0; i < pkgs.length; i++) { if (i) { await page.click('[data-a=olAdd]'); await H.settle(page, 150); await page.fill(`[data-i=olF][data-f=phone] >> nth=${i - 1}`, '05344444' + (10 + i)); await H.settle(page, 300); }
      await page.selectOption(`[data-c=olSel][data-f=plan] >> nth=${i}`, pkgs[i]); await H.settle(page, 250); } };
  const save = async () => { const n = calls.filter((c) => c.n === 'createOrder').length; await page.click('[data-a=oxSave]'); await H.settle(page, 700); globalThis.__T = await page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.innerText).join(' | ')); const a = calls.filter((c) => c.n === 'createOrder'); return a.length > n ? a[a.length - 1].d : null; };
  // א: קו אחד, פרטים לפני בחירה; קבועה 20 → 10.5 + 30 − 20 = 20.5; אין המלצה
  await build('0529998880', ['pP']); const ta = await tot(); const tA = await page.innerText('#main');
  const pkInfo = /עלות חודשית: \W*39\.9/.test(tA) && /משלוח \W*30\.00.*משלמים לחנות/.test(tA) && /סים \W*20\.00.*משלמים לחברה/.test(tA) && /5G ללא הגבלה/.test(tA);
  const noHintA = !(await page.$('#olhint')); const dA = await save();
  check('11ב קו עם חבילה: עלות חודשית, משלוח וסים ולמי משלמים מוצגים לפני השמירה; סכום 20.5 = השרת; אין המלצה כשאין שיפור', pkInfo && noHintA && ta === 20.5 && !!dA && srvNet(dA, false) === ta, { toast: globalThis.__T, ta, srv: dA && srvNet(dA, false), pkInfo, t: tA.slice(tA.indexOf('קו 1'), tA.indexOf('קו 1') + 260) });
  // ב: 3 קווים, 2 בפרטנר (במבצע 3 קווים) ו-1 בסלקום → המלצה עם החברות, המבצע וההנחה; 360px בלי גלילה אופקית
  await build('0529998881', ['pP', 'pP', 'pC']); await H.settle(page, 200); const tb = await tot(); const hb = (await page.$('#olhint')) ? await page.innerText('#olhint') : '';
  await page.setViewportSize({ width: 360, height: 780 }); await H.settle(page, 150); const w360 = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  await page.evaluate(() => document.getElementById('olhint') && document.getElementById('olhint').scrollIntoView({ block: 'center' })); await shot('הזמנה-חבילות-המלצה'); await page.setViewportSize({ width: 390, height: 844 }); await H.settle(page, 100);
  const dB = await save();
  check('11ג 3 קווים (2 במבצע, 1 לא): הודעה עם "פרטנר / הוט", שם המבצע, 3 קווים והנחה "עד"; סכום = השרת; 360px בלי גלילה', /העברת קו 3 לפרטנר \/ הוט/.test(hb) && /"3 קווים"/.test(hb) && /עד ₪140/.test(hb) && /פעם אחת להזמנה/.test(hb) && !!dB && srvNet(dB, false) === tb && w360[0] <= w360[1], { hb, tb, srv: dB && srvNet(dB, false), w360 });
  // ג: 3 קווים במבצע → ביטול המבצע בהזמנה (חוזר לקבועה 40): 10.5 + 30 + 30 + 40 − 40 = 70.5
  await build('0529998882', ['pP', 'pP', 'pH']); const tc0 = await tot(); const hasPromo = /מבצע "3 קווים"/.test(await page.innerText('#olcalc'));
  await page.click('[data-a=olMan]'); await H.settle(page, 200); await page.selectOption('#dlg select[name=sc]', 'poff'); await shot('הנחה-ידנית-מבצע'); await page.click('#dlg button.btn.grow:not(.g)'); await H.settle(page, 300);
  const tc = await tot(); const dC = await save();
  check('11ד מבצע פעיל מוצג; ביטול המבצע בהזמנה → 70.5; נשלח man.promo.off; סכום = השרת', hasPromo && tc0 === 0 && tc === 70.5 && !!dC && dC.cell.man && dC.cell.man.promo && dC.cell.man.promo.off === true && srvNet(dC, false) === tc, { tc0, tc, man: dC && dC.cell.man });
  // ד: עובד – הנחה ידנית לקו מעל התקרה → שגיאה בעברית בלי לחשוף את התקרה, לא נשמר; 40 → מחליפה את הקבועה: 10.5 + 30 − 40 = 0.5
  await page.evaluate(() => { window.__role0 = SY.role; window.__sa0 = SY.sa; SY.role = 'worker'; delete SY.sa; });
  await build('0529998883', ['pP']); await page.click('[data-a=olMan]'); await H.settle(page, 200); await page.fill('#dlg input[name=v]', '60'); await page.click('#dlg button.btn.grow:not(.g)'); await H.settle(page, 300);
  const toastT = await page.evaluate(() => { return [...document.querySelectorAll('.toast')].map((t) => t.innerText).join(' | '); }); const stillOpen = await page.evaluate(() => document.getElementById('dlg').open);
  await page.evaluate(() => { const m = window.__ox.draft.cell.man; m.lines[window.__ox.draft.cell.lines[0].k] = { t: 'amt', v: 60 }; }); const nSv = calls.filter((c) => c.n === 'createOrder').length; await page.evaluate(() => document.getElementById('dlg').close()); await page.click('[data-a=oxSave]'); await H.settle(page, 500);
  const blockedCap = calls.filter((c) => c.n === 'createOrder').length === nSv; const banT = await page.innerText('#olcalc').catch(() => '');
  await page.click('#olcalc [data-a=olMClr]'); await H.settle(page, 200); await page.click('[data-a=olMan]'); await H.settle(page, 200); await page.fill('#dlg input[name=v]', '40'); await page.click('#dlg button.btn.grow:not(.g)'); await H.settle(page, 300);
  const td = await tot(); const dD = await save();
  await page.evaluate(() => { SY.role = window.__role0; if (window.__sa0) SY.sa = window.__sa0; });
  check('11ה עובד: מעל התקרה – שגיאה בעברית בלי סכום התקרה, ההזמנה לא נשמרת; 40 מחליפה את הקבועה → 0.5 = השרת', stillOpen && /גבוהה מהמותר לעובד/.test(toastT + banT) && !/50/.test(toastT + banT) && blockedCap && td === 0.5 && !!dD && JSON.stringify(dD.cell.man) === JSON.stringify({ lines: [{ t: 'amt', v: 40 }] }) && srvNet(dD, true) === td, { toastT, banT, blockedCap, td, man: dD && dD.cell.man });
  // ה: הנחה ידנית להזמנה (מנהל) מחליפה הכול: 10% מ-(10.5 + 30 + 25) = 6.55 → 58.95
  await build('0529998884', ['pP', 'pC']); await page.click('[data-a=olMan]'); await H.settle(page, 200); await page.selectOption('#dlg select[name=sc]', 'order'); await page.fill('#dlg input[name=v]', '10'); await page.selectOption('#dlg select[name=vT]', 'pct'); await page.click('#dlg button.btn.grow:not(.g)'); await H.settle(page, 300);
  const te = await tot(); const dE = await save();
  check('11ו הנחה להזמנה באחוזים מחליפה את הקבועה → 58.95 = השרת', te === 58.95 && !!dE && srvNet(dE, false) === te, { te, srv: dE && srvNet(dE, false), man: dE && dE.cell.man });
  check('8 בלי שגיאות JS', page.__errors.length === 0, page.__errors);
  }
  await browser.close();
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
  console.log(fail ? `נכשלו ${fail}` : 'הכול עבר');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
