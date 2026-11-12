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
const CUST = [doc('cust/t' + TZL, { name: S(LN), phone: S('0507777777'), tz: S(TZL), addr: S(LA), mail: S('old@x.co') }), doc('cust/t' + TZ, { name: S('משה כהן'), phone: S('0501234567'), tz: S(TZ), mail: S('moshe@x.co'), addr: S('הרצל 1'), x: M({ xcity: S('אשדוד') }) }),
  // 2026-11-10 (ייבוא לקוחות מלא): לקוח בדוי עם ת"ז ומייל לא תקינים, שדות מידע וקווים עם חברה / נויד בפועל
  doc('cust/p0509990000', { name: S('נועה בדויה'), fn: S('נועה'), ln: S('בדויה'), phone: S('0509990000'), btz: S('12345'), bml: S('noa@@demo'), bank: S('בנק לדוגמה, סניף 100, חשבון 12345'), prod: S('חבילת גלישה'), due: S('₪99'), orig: S('פייסבוק'), stat: S('ממתין'), note: S('לחזור בערב'), od: S('2026-11-01'),
    ports: A([M({ phone: S('0521230000'), co: S('חברה א'), act: S('y'), d: S('2026-10-20') }), M({ bph: S('05212'), co: S('חברה ב'), act: S('u') })]) })];
const PLANS = [doc('lineplan/pl1', { name: S('פרטנר 30'), carrier: S('פרטנר'), days: N(30), on: { booleanValue: true } })];
// שלב 4 (חבילות): ערך JS → שדה Firestore REST
const FV = (v) => (v === null ? { nullValue: null } : typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? N(v) : typeof v === 'string' ? S(v) : Array.isArray(v) ? A(v.map(FV)) : M(Object.fromEntries(Object.entries(v).map(([k, x]) => [k, FV(x)]))));
const PK = { pP: { name: 'פרטנר חדשה', carrier: 'פרטנר', monthly: 39.9, details: '5G ללא הגבלה', ship: { amt: 30, pay: 'store' }, sim: { amt: 20, pay: 'carrier' }, on: true, promo: { disc: 20, qty: { n: 3, amt: 100, scope: 'carrier' } } },
  pH: { name: 'הוט 29', carrier: 'הוט', monthly: 29.9, ship: { amt: 30, pay: 'store' }, sim: { amt: 10, pay: 'store' }, on: true, promo: { gifts: [{ pid: 'pA', price: 0 }, { pid: 'pB', price: 5 }] } },
  pC: { name: 'סלקום 49', carrier: 'סלקום', monthly: 49, sim: { amt: 25, pay: 'store' }, on: true, promo: { gifts: [{ pid: 'pA', price: 0 }] } },
  pM: { name: 'גולן כמה מבצעים', carrier: 'סלקום', on: true, promos: [{ disc: 15 }, { qty: { n: 2, amt: 40 } }] } }; // 23:52
for (const [id, p] of Object.entries(PK)) PLANS.push(doc('lineplan/' + id, Object.fromEntries(Object.entries(p).map(([k, v]) => [k, FV(v)]))));
const CCFG = { carriers: ['פרטנר', 'סלקום', 'הוט'], ads: ['פייסבוק'] };
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
    if (n === 'getCard' && globalThis.__GCOLD) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { status: 'INVALID_ARGUMENT', message: 'פעולה לא תקינה', details: { reason: 'bad-act' } } }) }); // שרת ישן
    if (n === 'getCard' && globalThis.__GCNOCARD) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { status: 'FAILED_PRECONDITION', message: 'לא נבחרו שדות אשראי', details: { reason: 'copy-no-card' } } }) });
    if (n === 'getCard' && d.act === 'copyAll') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { card: d.slot === 2 ? { num: '5326100020003456', exp: '03/29', name: 'Noa B', cvv: '987' } : { num: '4580123456789012', exp: '07/28', cvv: '123' } } }) });
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
  // 12.11.2026: בעסק עם ניוד – אחרי "שמור הזמנה" מופיע מסך כרטיס אשראי (לא חובה); "סיום הזמנה" ריק ממשיך לשמירה
  const fin = async () => { if (await page.$('[data-a=ocFinish]')) { await page.click('[data-a=ocFinish]'); await H.settle(page, 900); } };
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
  await page.click('[data-a=oxSave]'); await H.settle(page, 900); await fin();
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
  // 5ג (פישוט 9.11). מבצע בתוך החבילה: הנחה בקנייה, 2 מתנות (0 ומחיר מבצע), מבצע כמות לפי חברה, תאריך; אין מסך "הנחות, תקרות ומבצעים"
  await goV('oxLines'); await H.settle(page, 300); const noCfg = (await page.evaluate(() => typeof V.oxLnCfg)) === 'undefined' && !/הנחות, תקרות ומבצעים/.test(await page.innerText('#main'));
  await page.click('[data-a=olPE][data-id=pl1]'); await H.settle(page, 200); await page.click('#dlg details summary'); await H.settle(page, 100);
  await page.fill('#dlg input[name=pd0]', '200'); await page.selectOption('#dlg select[name=g0_0]', 'pA'); await page.selectOption('#dlg select[name=g0_1]', 'pB'); await page.fill('#dlg input[name=gp0_1]', '100');
  await page.fill('#dlg input[name=qn0]', '3'); await page.fill('#dlg input[name=qa0]', '150'); await page.fill('#dlg input[name=pt0]', '2026-12-31');
  await page.setViewportSize({ width: 360, height: 780 }); await H.settle(page, 100);
  const sw = await page.evaluate(() => { const g = document.getElementById('dlg'); const gr = g.getBoundingClientRect(); return [document.documentElement.scrollWidth, innerWidth, g.scrollWidth, g.clientWidth, [...g.querySelectorAll('*')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.left < gr.left - 1 || r.right > gr.right + 1); }).map((e) => e.tagName + '.' + (e.name || '')).slice(0, 8)]; });
  await page.evaluate(() => { const d = document.querySelector('#dlg details'); if (d) d.scrollIntoView({ block: 'start' }); }); await shot('חבילה-מבצע'); await page.setViewportSize({ width: 390, height: 844 }); await H.settle(page, 100);
  await page.click('#dlg button.btn.grow:not(.g)'); await H.settle(page, 500);
  const spr = calls.filter((c) => c.n === 'saveLinePlan').pop(); const PR0 = spr && spr.d.promos;
  check('5ג מבצע בחבילה: הנחה 200, מתנות (0 / 100), 3 קווים ← 150, תאריך (נשמר כרשימת מבצעים); אין מסך הנחות/תקרות; 360px בלי חריגה', noCfg && JSON.stringify(PR0) === JSON.stringify([{ disc: 200, gifts: [{ pid: 'pA', price: 0 }, { pid: 'pB', price: 100 }], qty: { n: 3, amt: 150 }, to: '2026-12-31' }]) && sw[0] <= sw[1] && sw[2] <= sw[3] && !sw[4].length, { noCfg, PR0, sw });
  await page.click('[data-a=olPE][data-id=pl1]'); await H.settle(page, 200); await page.click('#dlg details summary'); await page.fill('#dlg input[name=qn0]', '1'); const nq = calls.filter((c) => c.n === 'saveLinePlan').length; await page.click('#dlg button.btn.grow:not(.g)'); await H.settle(page, 300);
  check('5ד מבצע כמות של קו אחד נחסם בטופס', calls.filter((c) => c.n === 'saveLinePlan').length === nq);
  await page.evaluate(() => { const g = document.getElementById('dlg'); if (g && g.open) g.close(); });
  // 5ה (23:52): חבילה עם מבצע קיים – "מבצע 1" פתוח ו"הוספת מבצע" ריק; מוסיפים מבצע שני
  await goV('oxLines'); await H.settle(page, 200); await page.click('[data-a=olPE][data-id=pP]'); await H.settle(page, 200);
  const sum5 = await page.$$eval('#dlg details summary', (a) => a.map((x) => x.innerText.trim()));
  await page.click('#dlg details[data-pr="1"] summary'); await H.settle(page, 100); await page.fill('#dlg input[name=pd1]', '50'); await page.click('#dlg button.btn.grow:not(.g)'); await H.settle(page, 500);
  const PR5 = (calls.filter((c) => c.n === 'saveLinePlan').pop() || { d: {} }).d.promos;
  check('5ה כמה מבצעים לחבילה: מבצע קיים + "הוספת מבצע"; נשמרים 2 מבצעים', sum5.join('|') === 'מבצע 1|הוספת מבצע (רשות)' && JSON.stringify(PR5) === JSON.stringify([{ disc: 20, qty: { n: 3, amt: 100 } }, { disc: 50 }]), { sum5, PR5 });
  await page.evaluate(() => { const g = document.getElementById('dlg'); if (g && g.open) g.close(); });
  await goV('oxLines'); await H.settle(page, 200);
  check('5 מסך תוכניות ניוד (מנהל): טווח 30 מוצג, ברירת מחדל 60 בתוכנית חדשה, saveLinePlan {name, days:45, carrier}; מגע/ניגודיות/גלילה', okAll(s5) && /התראה על ניוד חוזר: 30 יום/.test(s5.a.text) && def === '60' && !!sp && sp.d.days === 45 && sp.d.carrier === 'סלקום', { def, sp: sp && sp.d, s: sum(s5) });
  // 6. עובד: אין מסך תוכניות
  await page.evaluate(() => { window.__role0 = SY.role; window.__sa0 = SY.sa; SY.role = 'worker'; delete SY.sa; }); await goV('oxLines'); await H.settle(page, 200); const e6 = await page.innerText('#main');
  await page.click('[data-a=olPE][data-id=pl1]'); await H.settle(page, 200); /* החלטה 21:25: גם עובד רואה ומשנה את הטווח */ const noDays = !!(await page.$('#dlg input[name=days]')); await page.click('#dlg button.btn.grow:not(.g)'); await H.settle(page, 500); const sw6 = calls.filter((c) => c.n === 'saveLinePlan').pop();
  await goV('ox'); await H.settle(page, 200); const e6b = await page.innerText('#main');
  await page.evaluate(() => { SY.role = window.__role0; if (window.__sa0) SY.sa = window.__sa0; });
  check('6 עובד: רואה ועורך חבילות (כולל טווח התראה ומבצע), בלי רשימות', /פרטנר 30/.test(e6) && !/הנחות, תקרות ומבצעים|עריכת הרשימות/.test(e6) && /התראה על ניוד חוזר: 30 יום/.test(e6) && noDays && !!sw6 && sw6.d.days === 30 && !/חבילות ניוד/.test(e6b), { e6: e6.slice(0, 120), sw6: sw6 && sw6.d });
  // 7. ייבוא לקוחות: עמודת סניף הניוד (01:00)
  await goV('imp'); await H.settle(page, 300); await page.click('#main [data-a=ocImp]'); // 9.11.2026: ייבוא לקוחות – ממרכז הייבוא await H.settle(page, 200);
  const csv = 'שם,טלפון,תאריך ניוד,טלפון ניוד,סניף\nדנה,0501111111,02/01/2025,0521234567,יהודה הנשיא\nיוסי,0502222222,02/01/2025,,סניף לא קיים\n';
  await page.setInputFiles('#dlg input[type=file]', { name: 'c.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) }); await H.settle(page, 500);
  const g7 = await page.inputValue('#dlg select[name=m4]');
  await page.click('#dlg button.btn.grow:not(.g)'); await H.settle(page, 400); const pv = await page.innerText('#dlg');
  await page.click('#dlg [data-a=ocGo]'); await H.settle(page, 600);
  const ic = calls.filter((c) => c.n === 'startImport' && c.d.kind === 'cust').pop(); // 11.11.2026: ייבוא ברקע
  check('7 ייבוא: עמודת "סניף" מזוהה כסניף הניוד, נשלח מזהה הסניף; סניף לא קיים – שורה מסומנת', g7 === 'pbr' && !!ic && ic.d.rows.length === 1 && ic.d.rows[0].ports[0].br === 'br2' && /שורה 3: סניף/.test(pv), { g7, rows: ic && ic.d.rows, pv: pv.slice(0, 200) });
  // 9 (2026-11-09, Dפון): מנהל־על שנכנס לעסק – כל קריאות ההזמנות נושאות bizId של העסק שנבחר; מנהל רגיל – בלי bizId
  const n0 = calls.length;
  await fresh(); await page.fill('input[data-k=fn]', 'רות'); await page.fill('input[data-k=ln]', 'כהן'); await page.fill('input[data-k=phone]', '0529998887'); await H.settle(page, 300);
  const tz9 = !!(await page.$('#octz')) && /רשות/.test(await page.evaluate(() => document.getElementById('octz').closest('label').innerText));
  await page.fill('#oxq', 'לחם'); await page.click('[data-a=oxAdd]'); await H.settle(page, 200); await page.click('[data-a=oxSave]'); await H.settle(page, 800); await fin();
  const m9 = calls.slice(n0).filter((c) => c.n !== 'getBackupKey'); const co9 = m9.find((c) => c.n === 'createOrder');
  check('9 עסק עם ניוד: ת"ז (רשות) מוצגת מההתחלה; הזמנה בלי ת"ז ובלי ניוד נשמרת; מנהל רגיל – בלי bizId', tz9 && !!co9 && !(co9.d.cust && co9.d.cust.tz) && co9.d.cell === undefined && m9.every((c) => !('bizId' in (c.d || {}))), m9.map((c) => c.n));
  await page.evaluate(() => { window.__sa0 = SY.sa; SY.sa = 1; }); const n1 = calls.length;
  await fresh(); await page.fill('input[data-k=fn]', 'רות'); await page.fill('input[data-k=ln]', 'כהן'); await page.fill('input[data-k=phone]', '0529998886'); await H.settle(page, 300);
  await page.fill('#oxq', 'לחם'); await page.click('[data-a=oxAdd]'); await H.settle(page, 200); await page.click('[data-a=oxSave]'); await H.settle(page, 800); await fin();
  await page.evaluate(() => { SY.sa = window.__sa0; });
  const m10 = calls.slice(n1).filter((c) => c.n !== 'getBackupKey'); const co10 = m10.find((c) => c.n === 'createOrder');
  check('10 מנהל־על בתוך העסק: createOrder (עם הסניף שנבחר) וכל קריאות ההזמנות נשלחות עם bizId=biz-o', !!co10 && co10.d.br === 'br1' && m10.every((c) => c.d && c.d.bizId === 'biz-o'), m10.map((c) => [c.n, c.d && c.d.bizId]));
  // 11 (פישוט 9.11): חבילה לכל קו, מבצע מהחבילה, מתנות כשורות מוצר, משבצת "סה"כ הנחה" שהעובד משנה, המלצה בשורה אחת. הסכום בטופס = אותה פונקציה של השרת.
  const same = fs.readFileSync(path.join(www, 'line-discount.js'), 'utf8') === fs.readFileSync(path.join(__dirname, '../../functions/lib/line-discount.js'), 'utf8');
  check('11א line-discount.js בטופס זהה לקובץ של השרת', same);
  const pm = new Map(Object.entries(PK));
  globalThis.__CC = CCFG; await goV('oxLines'); await H.settle(page, 200); await page.click('[data-a=olCfg]'); await H.settle(page, 200); await page.click('#dlg button.btn.grow:not(.g)'); await H.settle(page, 600);
  const srvNet = (d) => { const it = d.items.reduce((s, x) => s + Math.round(x.qty * x.price * 100), 0); return LD.calcCell(d.cell.lines, pm, typeof d.cell.man === 'number' ? d.cell.man : null, { itemsAg: it, today: LD.ilDay(), items: d.items }).net; };
  const tot = async () => +String(await page.innerText('#oxtot')).replace(/[^\d.]/g, '');
  const build = async (ph, pkgs) => { await fresh(); await page.fill('input[data-k=fn]', 'רות'); await page.fill('input[data-k=ln]', 'כהן'); await page.fill('input[data-k=phone]', ph); await H.settle(page, 300); await page.fill('#octz', '123456782');
    await page.fill('#oxq', 'לחם'); if (!(await page.waitForSelector('[data-a=oxAdd]', { timeout: 8000 }).catch(() => null))) { await page.fill('#oxq', ''); await H.settle(page, 300); await page.fill('#oxq', 'לחם'); } // תזמון: החיפוש אחרי שמירה קודמת
    await page.click('[data-a=oxAdd]'); await H.settle(page, 200); await page.click('[data-c=olOn]'); await H.settle(page, 500);
    for (let i = 0; i < pkgs.length; i++) { if (i) { await page.click('[data-a=olAdd]'); await H.settle(page, 150); await page.fill(`[data-i=olF][data-f=phone] >> nth=${i - 1}`, '05344444' + (10 + i)); await H.settle(page, 300); }
      await page.selectOption(`[data-c=olSel][data-f=plan] >> nth=${i}`, pkgs[i]); await H.settle(page, 250); } };
  const save = async () => { const n = calls.filter((c) => c.n === 'createOrder').length; await page.click('[data-a=oxSave]'); await H.settle(page, 700); await fin(); globalThis.__T = await page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.innerText).join(' | ')); const a = calls.filter((c) => c.n === 'createOrder'); return a.length > n ? a[a.length - 1].d : null; };
  const manV = () => page.inputValue('#olman').catch(() => null);
  // ב: קו אחד, פרטים לפני בחירה; הנחה 20 מהחבילה → 10.5 + 30 − 20 = 20.5; המשבצת = 20; אין המלצה
  await build('0529998880', ['pP']); const ta = await tot(); const tA = await page.innerText('#main'); const mA = await manV();
  const pkInfo = /עלות חודשית: \W*39\.9/.test(tA) && /משלוח \W*30\.00.*משלמים לחנות/.test(tA) && /סים \W*20\.00.*משלמים לחברה/.test(tA) && /5G ללא הגבלה/.test(tA);
  const noHintA = !(await page.$('#olhint')); const noOld = !/הנחה ידנית|שינוי \/ ביטול מבצע/.test(tA); const dA = await save();
  check('11ב קו עם חבילה: פרטים מוצגים; משבצת "סה״כ הנחה" = 20; סכום 20.5 = השרת; אין המלצה; אין כפתורי הנחה ידנית/מבצע ישנים', pkInfo && noHintA && noOld && mA === '20' && ta === 20.5 && !!dA && dA.cell.man === 20 && srvNet(dA) === ta, { toast: globalThis.__T, ta, mA, man: dA && dA.cell.man });
  // ג: 2 קווי פרטנר + סלקום (מתנה חינם אחת → נוספת לבד במחיר המלא 12, וה-12 נכנס להנחה: 40 + 12 = 52) → המלצה בשורה אחת; 360px
  await build('0529998881', ['pP', 'pP', 'pC']); await H.settle(page, 200); const tb = await tot(); const hb = (await page.$('#olhint')) ? await page.innerText('#olhint') : '';
  const mB = await manV(); const gB = await page.evaluate(() => window.__ox.draft.items.filter((it) => it.gk).map((it) => [it.pid, it.price]));
  await page.setViewportSize({ width: 360, height: 780 }); await H.settle(page, 150); const w360 = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  await page.evaluate(() => document.getElementById('olcalc') && document.getElementById('olcalc').scrollIntoView({ block: 'center' })); await shot('הזמנה-סהכ-הנחה-המלצה'); await page.setViewportSize({ width: 390, height: 844 }); await H.settle(page, 100);
  const dB = await save();
  check('11ג המלצה בשורה אחת ("עוד קו אחד באותו מבצע … ₪100"); מתנה חינם נוספה כשורת מוצר במחיר המלא 12; "סה״כ הנחה" = 40 + 12 = 52; 55.5 = השרת; 360px בלי גלילה', /עוד קו אחד באותו מבצע יזכה בהנחה של ₪100/.test(hb) && hb.split('\n').length === 1 && JSON.stringify(gB) === JSON.stringify([['pA', '12']]) && mB === '52' && tb === 55.5 && !!dB && dB.items.some((it) => it.pid === 'pA' && it.price === 12) && dB.cell.man === 52 && dB.cell.lines[2].gift === 'pA' && srvNet(dB) === tb && w360[0] <= w360[1], { hb, gB, mB, tb, w360, man: dB && dB.cell.man });
  // ד: 3 קווי פרטנר → 60 + 100 = 160, מוגבל לסכום לחנות (100.5) → 0; העובד משנה ל-80 → 20.5, ואז 0 = בלי הנחה → 100.5
  await build('0529998882', ['pP', 'pP', 'pP']); const td0 = await tot(); const md0 = await manV();
  await page.fill('#olman', '80'); await H.settle(page, 150); const td1 = await tot(); const sug1 = await page.innerText('#olsug');
  await page.fill('#olman', '0'); await H.settle(page, 150); const td2 = await tot(); const dD = await save();
  check('11ד מבצע כמות: מוצע 160, סה"כ לא מתחת ל-0; העובד משנה ל-80 (20.5) ול-0 (100.5); נשמר man=0', md0 === '160' && td0 === 0 && td1 === 20.5 && /160/.test(sug1) && td2 === 100.5 && !!dD && dD.cell.man === 0 && srvNet(dD) === td2, { md0, td0, td1, sug1, td2, man: dD && dD.cell.man });
  // ה: בחירה בין 2 מתנות – מתנה במחיר מבצע 5 ← שורת מוצר במחיר המלא 10.5, וההפרש 5.5 ב"סה״כ הנחה"; עובד מעלה ל-15
  await page.evaluate(() => { window.__role0 = SY.role; window.__sa0 = SY.sa; SY.role = 'worker'; delete SY.sa; });
  await build('0529998883', ['pH']); const opts = await page.$$eval('[data-c=olGift] option', (o) => o.map((x) => x.value));
  await page.selectOption('[data-c=olGift]', 'pB'); await H.settle(page, 300); const mE = await manV(); const teg = await tot();
  await page.setViewportSize({ width: 360, height: 780 }); await H.settle(page, 150); await page.evaluate(() => document.getElementById('olcalc') && document.getElementById('olcalc').scrollIntoView({ block: 'center' })); await shot('הזמנה-עם-מתנה'); await page.setViewportSize({ width: 390, height: 844 }); await H.settle(page, 100);
  await page.fill('#olman', '15'); await H.settle(page, 150); const te = await tot(); const dE = await save();
  await page.evaluate(() => { SY.role = window.__role0; if (window.__sa0) SY.sa = window.__sa0; });
  check('11ה בחירת מתנה מתוך 2 → שורת מוצר במחיר המלא 10.5; "סה״כ הנחה" = 5.5 (10.5 − 5), סכום 10.5 + 10.5 + 40 − 5.5 = 55.5; עובד מעלה ל-15 → 10.5 + 10.5 + 40 − 15 = 46 = השרת', opts.join() === ',pA,pB' && mE === '5.5' && teg === 55.5 && te === 46 && !!dE && dE.items.some((it) => it.pid === 'pB' && it.price === 10.5) && dE.cell.lines[0].gift === 'pB' && dE.cell.man === 15 && srvNet(dE) === te, { opts, mE, teg, te, items: dE && dE.items, man: dE && dE.cell.man });
  // ו (23:52): כמה מבצעים – ברירת מחדל הראשון (15 לכל קו); כל קו בוחר; מבצע כמות סופר רק מי שבחר; "בלי מבצע"
  await build('0529998884', ['pM', 'pM']); const mF0 = await manV(); const oF = await page.$$eval('[data-c=olPr] >> nth=0', (s) => [...s[0].options].map((o) => o.value));
  await page.selectOption('[data-c=olPr] >> nth=0', '1'); await H.settle(page, 200); const mF1 = await manV();
  await page.selectOption('[data-c=olPr] >> nth=1', '1'); await H.settle(page, 200); const mF2 = await manV();
  await page.selectOption('[data-c=olPr] >> nth=1', '-1'); await H.settle(page, 200); const mF3 = await manV(); const dF = await save();
  check('11ו כמה מבצעים: רשימה לכל קו (2 מבצעים + "בלי מבצע"); ברירת מחדל 15+15=30; קו אחד במבצע כמות → 15; שניהם → 40; אחד "בלי מבצע" → 0; pr נשלח לשרת', oF.join() === '0,1,-1' && mF0 === '30' && mF1 === '15' && mF2 === '40' && mF3 === '0' && !!dF && dF.cell.lines[0].pr === 1 && dF.cell.lines[1].pr === -1 && srvNet(dF) === 10.5, { oF, mF0, mF1, mF2, mF3, lines: dF && dF.cell.lines });
  { // 12 (2026-11-10): כרטיס לקוח – שדות מידע, חברת ניוד / נויד בפועל, סימון אדום "לא תקין"; הזמנה חדשה – סימון כשבוחרים את הלקוח; טופס עריכה
    await page.evaluate(() => { const g = document.getElementById('dlg'); if (g && g.open) g.close(); window.__oc.L = null; }); await goV('ocCard', 'p0509990000'); await H.settle(page, 900);
    const ct = await page.innerText('#main'); const red = await page.$$eval('#main [data-bad]', (e) => e.length);
    await shot('כרטיס-לקוח-לא-תקין');
    const okCard = CELLON ? /פרט לא תקין: ת\.ז, מייל, פרטי ניוד/.test(ct) && /פרטי בנק: בנק לדוגמה/.test(ct) && /סטטוס: ממתין/.test(ct) && /תאריך הזמנה: 2026-11-01/.test(ct) && /חברת ניוד: חברה א/.test(ct) && /נויד בפועל: כן/.test(ct) && /נויד בפועל: לא ידוע/.test(ct) && red >= 3
      : /פרט לא תקין: ת\.ז, מייל, פרטי ניוד/.test(ct) && !/פרטי בנק|סטטוס:|חברת ניוד/.test(ct);
    check('12 כרטיס לקוח: ' + (CELLON ? 'שדות מידע, חברה ונויד בפועל לכל קו, סימון אדום' : 'בלי cellular – שדות המידע מוסתרים, הסימון נשאר'), okCard, { red, ct: ct.slice(0, 300) });
    await page.click('#main [data-a=ocEdit]'); await H.settle(page, 400); const ft = await page.innerText('#dlg');
    check('12א טופס עריכה: ' + (CELLON ? 'שדות המידע + חברת ניוד/נויד בפועל, ת"ז לא תקינה מסומנת' : 'בלי שדות המידע'), CELLON ? /פרטי בנק/.test(ft) && /חברת ניוד/.test(ft) && /נויד בפועל/.test(ft) && /\(לא תקין\)/.test(ft) : !/פרטי בנק|חברת ניוד/.test(ft), ft.slice(0, 200));
    await page.click('#dlg button.btn.grow:not(.g)'); await H.settle(page, 500);
    const sv = calls.filter((c) => c.n === 'saveCust').pop();
    check('12ב שמירה בלי שינוי: ת"ז ומייל לא תקינים לא נשלחים (נשארים כמו שהם), פרטי הניוד הלא תקינים נשמרים', !!sv && sv.d.id === 'p0509990000' && sv.d.cust.tz === undefined && sv.d.cust.mail === undefined && sv.d.cust.btz === undefined && (!CELLON || (sv.d.cust.ports[1].bph === '05212' && sv.d.cust.ports[1].act === 'u' && sv.d.cust.bank === 'בנק לדוגמה, סניף 100, חשבון 12345')), sv && sv.d);
    await fresh(); await page.fill('input[data-k=phone]', '0509990000'); await H.settle(page, 700);
    const hl = await page.innerText('#ocst'); await page.click('#ocst [data-a=ocPick]'); await H.settle(page, 400);
    const st = await page.innerText('#ocst'); const inf = CELLON ? await page.inputValue('input[data-k=stat]') : '';
    check('12ג הזמנה חדשה: ברשימה ואחרי בחירה – סימון אדום של הפרט הלא תקין' + (CELLON ? '; שדות המידע נטענים לטופס' : ''), /לא תקין/.test(hl) && /פרט לא תקין אצל הלקוח: ת\.ז, מייל/.test(st) && (!CELLON || inf === 'ממתין'), { hl: hl.slice(0, 120), st: st.slice(0, 160), inf });
  }
  { // 12ד (סבב 2): פענוח הייבוא – לקוח עם טלפון תקין + שורה עם טלפון לא תקין (לא נשמר bph, עובר להערות), שני טלפונים בתא, שורה בלי שם, עד 3 כרטיסים
    const R = await page.evaluate(() => { const C = window.__oc;
      const I = { map: ['fn', 'phone', 'tz', 'cnum', 'note'], R: [
        ['דנה', '0501234567', '123456782', '4580123456789012', ''], ['דנה', '05012', '123456782', '5326100020003456', 'ה1'], ['דנה', '', '123456782', '4111111111111111', ''], ['דנה', '', '123456782', '4000000000000002', ''],
        ['', '0521111111', '', '', ''], ['רון', '05222222220533333333', '', '', 'הערה'], ['טל', '0544444444 / 0555555555', '', '', '']] };
      const { out } = C.prepRows(I); const { G, cardX } = C.groupRows(out.filter((r) => !r.why.length));
      return { rej: out.filter((r) => r.why.length).length, G: G.map((g) => ({ name: g.o.name || g.o.fn, phone: g.o.phone, bph: g.o.bph, note: g.o.note, cards: (g.o.cards || []).length })), cardX }; });
    const d = R.G.find((g) => g.name === 'דנה') || {}, nn = R.G.find((g) => g.name === 'ללא שם') || {}, rn = R.G.find((g) => g.name === 'רון') || {}, tl = R.G.find((g) => g.name === 'טל') || {};
    check('12ד ייבוא סבב 2: טלפון תקין + לא תקין → בלי bph' + (CELLON ? ' והערך בהערות' : '') + '; 3 כרטיסים + 1 מעבר; שורה בלי שם → "ללא שם"; שני טלפונים בתא מפוצלים', R.rej === 0 && d.phone === '0501234567' && d.bph === undefined && d.cards === 3 && R.cardX === 1 &&
      (!CELLON || /טלפון נוסף \(לא תקין\): 05012/.test(d.note || '')) && nn.phone === '0521111111' && rn.phone === '0522222222' && tl.phone === '0544444444' && (!CELLON || (/^הערה \| טלפון נוסף: 0533333333$/.test(rn.note || '') && /טלפון נוסף: 0555555555/.test(tl.note || ''))), R);
    // כרטיס לקוח עם 3 כרטיסים: כל כרטיס עם 4 ספרות + הצגה/העתקה/החלפה/מחיקה משלו; בלי "הוספה" (מלא)
    await page.evaluate(() => { const C = window.__oc; const c = (C.L || []).find((x) => x.id === 'p0509990000'); if (c) { c.cards = [{ s: 1, last4: '9012' }, { s: 2, last4: '3456' }, { s: 3, last4: '1111' }]; c.card = true; c.last4 = '9012'; } });
    await goV('ocCard', 'p0509990000'); await H.settle(page, 500);
    const cc = await page.evaluate(() => ({ t: (document.getElementById('occard') || {}).innerText || '', v: [...document.querySelectorAll('#occard [data-a=ocCardView]')].map((b) => b.dataset.s || '1').join(), del: document.querySelectorAll('#occard [data-a=ocCardDel]').length, add: /הוספת כרטיס/.test((document.getElementById('occard') || {}).innerText || '') }));
    check('12ה כרטיס לקוח: 3 כרטיסים, לכל אחד 4 ספרות והצגה/מחיקה משלו (מקום 1/2/3), בלי הוספה רביעית', /\*{4}9012/.test(cc.t) && /\*{4}3456/.test(cc.t) && /\*{4}1111/.test(cc.t) && cc.v === '1,2,3' && cc.del === 3 && !cc.add, cc);
  }
  check('8 בלי שגיאות JS', page.__errors.length === 0, page.__errors);
  }
  { // 13 (2026-11-10, סעיף 2): עסק עם ניוד – "+ כרטיס אשראי נוסף" בטופס ההזמנה (עד 3); בלי ניוד – אין כפתור
    await fresh(); await page.click('#occd summary'); await H.settle(page, 200);
    const hasAdd = !!(await page.$('[data-a=ocCdAdd]'));
    if (!CELLON) check('13 בלי ניוד: אין "+ כרטיס אשראי נוסף"', !hasAdd);
    else {
      await page.fill('input[data-k=fn]', 'רות'); await page.fill('input[data-k=ln]', 'כהן'); await page.fill('input[data-k=phone]', '0529998877'); await H.settle(page, 400);
      await page.fill('input[data-i=ocCd][data-k=num]', '4580123456789012');
      await page.click('[data-a=ocCdAdd]'); await H.settle(page, 200);
      await page.fill('input[data-i=ocCdM][data-n="0"][data-k=num]', '5326100020003456'); await page.fill('input[data-i=ocCdM][data-n="0"][data-k=cvv]', '987');
      await page.click('[data-a=ocCdAdd]'); await H.settle(page, 200);
      const third = !!(await page.$('input[data-i=ocCdM][data-n="1"]')), noFourth = !(await page.$('[data-a=ocCdAdd]'));
      await page.click('[data-a=ocCdX][data-n="1"]'); await H.settle(page, 200);
      await page.fill('#oxq', 'לחם'); await page.click('[data-a=oxAdd]'); await H.settle(page, 200);
      const n13 = calls.length; await page.click('[data-a=oxSave]'); await H.settle(page, 500); await fin(); await H.settle(page, 800);
      const sc = calls.slice(n13).filter((c) => c.n === 'setCard');
      check('13 ניוד: "+" מוסיף משבצת כרטיס, עד 3 בסה"כ; שני כרטיסים נשמרים (setCard add, עם ההזמנה)', hasAdd && third && noFourth && sc.length === 2 && sc.every((c) => c.d.add === true && c.d.ordId === 'o1') && sc[1].d.card.num === '5326100020003456' && sc[1].d.card.cvv === '987', { hasAdd, third, noFourth, sc: sc.map((c) => c.d.card.num.slice(-4)) });
    }
  }
  if (CELLON) { // 14 (12.11.2026): מסך כרטיס אשראי לפני סיום ההזמנה – בעסק עם ניוד מופיע גם כשמשלמים בקישור; "חזרה לטופס"; כרטיס שגוי נשאר במסך; כרטיס → setCard עם ordId
    await page.evaluate(() => { const g = document.getElementById('dlg'); if (g && g.open) g.close(); });
    await fresh(); await page.fill('input[data-k=fn]', 'רות'); await page.fill('input[data-k=ln]', 'כהן'); await page.fill('input[data-k=phone]', '0529998870'); await H.settle(page, 300);
    await page.fill('#oxq', 'לחם'); await page.click('[data-a=oxAdd]'); await H.settle(page, 200);
    const nc0 = calls.filter((c) => c.n === 'createOrder').length; await page.click('[data-a=oxSave]'); await H.settle(page, 500);
    const v1 = await page.evaluate(() => cur().v); const t1 = await page.innerText('#main'); const add1 = !!(await page.$('[data-a=ocCdAdd]'));
    await page.setViewportSize({ width: 360, height: 780 }); await H.settle(page, 150); await page.evaluate(M3); const q1 = await page.evaluate(() => __q('#main')); await shot('מסך-כרטיס-לפני-סיום'); await page.setViewportSize({ width: 390, height: 844 });
    await page.click('#main [data-a=back]'); await H.settle(page, 300); const v2 = await page.evaluate(() => [cur().v, (window.__ox.draft || {}).items && window.__ox.draft.items.length]);
    await page.click('[data-a=oxSave]'); await H.settle(page, 500); await page.fill('input[data-i=ocCs][data-k=num]', '1234'); await page.click('[data-a=ocFinish]'); await H.settle(page, 500);
    const v3 = await page.evaluate(() => cur().v); const none = calls.filter((c) => c.n === 'createOrder').length === nc0;
    check('14 ניוד + קישור: "שמור הזמנה" → מסך "כרטיס אשראי (לא חובה)" בלי createOrder, בלי "+ כרטיס נוסף" (נשאר במשבצת שבטופס); "חזרה לטופס" שומר את הטיוטה; כרטיס שגוי – נשאר במסך; כפתורים ≥44px, 360px',
      v1 === 'ocCardStep' && /כרטיס אשראי \(לא חובה\)/.test(t1) && /סיום הזמנה/.test(t1) && /חזרה לטופס/.test(t1) && !add1 && q1.small.length === 0 && q1.sw <= q1.iw && v2[0] === 'oxNew' && v2[1] === 1 && v3 === 'ocCardStep' && none, { v1, add1, small: q1.small, sw: [q1.sw, q1.iw], v2, v3, none });
    await page.fill('input[data-i=ocCs][data-k=num]', '4580 1234 5678 9012'); await page.fill('input[data-i=ocCs][data-k=exp]', '7/28'); await page.fill('input[data-i=ocCs][data-k=cvv]', '123');
    const k0 = calls.length; await page.click('[data-a=ocFinish]'); await H.settle(page, 1500);
    const a = calls.slice(k0), ci = a.findIndex((c) => c.n === 'createOrder'), si = a.findIndex((c) => c.n === 'setCard'), sd = si >= 0 ? a[si].d : null;
    const st = await page.evaluate(() => ({ v: cur().v, d: window.__ox.draft, /* טיוטה ריקה חדשה מותרת */ ls: JSON.stringify(localStorage).includes('4580123456789012') }));
    check('14א "סיום הזמנה" עם כרטיס: createOrder ואחריו setCard {ordId, add, num, exp}; עוברים לכרטיס ההזמנה; לא נשמר באחסון', ci >= 0 && si > ci && !!sd && sd.ordId === 'o1' && sd.add === true && sd.card.num === '4580123456789012' && sd.card.exp === '07/28' && st.v === 'oxOrd' && (!st.d || !st.d.items.length) && !JSON.stringify(st.d || {}).includes('4580') && !st.ls, { ci, si, st, sd: sd && { ordId: sd.ordId, add: sd.add } });
    { // 14ג (ניוד): המשבצת שבטופס = כרטיס לקו (הערה בולטת), המסך המלא = כרטיס להזמנה (נפרד, ריק). שניהם נשלחים: קודם המשבצת ואחריה המסך; אותו מספר בשניהם – נחסם במסך
      await fresh(); await page.fill('input[data-k=fn]', 'רות'); await page.fill('input[data-k=ln]', 'כהן'); await page.fill('input[data-k=phone]', '0529998869'); await H.settle(page, 300);
      await page.click('#occd summary'); await H.settle(page, 150); await page.fill('input[data-i=ocCd][data-k=num]', '4111111111111111'); await page.fill('#oxq', 'לחם'); await page.click('[data-a=oxAdd]'); await H.settle(page, 200);
      const note = await page.evaluate(() => (document.getElementById('occdline') || {}).innerText || '');
      const n0 = calls.length; await page.click('[data-a=oxSave]'); await H.settle(page, 500);
      const sv = await page.evaluate(() => ({ v: cur().v, num: (document.querySelector('input[data-i=ocCs][data-k=num]') || {}).value, mid: !!document.querySelector('[data-i=ocCd]') }));
      await page.fill('input[data-i=ocCs][data-k=num]', '4111 1111 1111 1111'); await page.click('[data-a=ocFinish]'); await H.settle(page, 500);
      const dupStay = (await page.evaluate(() => cur().v)) === 'ocCardStep' && !calls.slice(n0).some((c) => c.n === 'createOrder');
      await page.fill('input[data-i=ocCs][data-k=num]', '4580123456789012'); await page.click('[data-a=ocFinish]'); await H.settle(page, 1500);
      const sc = calls.slice(n0).filter((c) => c.n === 'setCard').map((c) => [c.d.card.num.slice(-4), c.d.ordId]);
      check('14ג ניוד: הערה "לתשלום על הקו…" במשבצת; המסך המלא מופיע גם כשבמשבצת הוקלד כרטיס, ריק ונפרד; אותו מספר – נחסם ונשארים; שני הכרטיסים נשמרים: קודם המשבצת ואחריו המסך',
        /לתשלום על הקו באשראי אחר מההזמנה יש להקליד כאן את פרטי האשראי לקו/.test(note) && sv.v === 'ocCardStep' && sv.num === '' && !sv.mid && dupStay && JSON.stringify(sc) === JSON.stringify([['1111', 'o1'], ['9012', 'o1']]), { note, sv, dupStay, sc });
    }
    // 15: הגדרת הפרטים להעתקה (מנהל) + "העתק פרטי לקוח" בהזמנת ניוד ששולמה
    await goV('oxCfg'); await H.settle(page, 600);
    const h15 = await page.evaluate(() => (document.getElementById('occpf') || {}).innerText || '');
    await page.uncheck('#occpf input[data-c=ocCpOn][data-k=tz]'); await H.settle(page, 200);
    await page.click('#occpf [data-a=ocCpMv][data-k=st][data-d="-1"]'); await H.settle(page, 200);
    for (const k of ['cnum', 'ccvv', 'x:xcity']) { await page.check(`#occpf input[data-c=ocCpOn][data-k="${k}"]`); await H.settle(page, 200); }
    await page.evaluate(M3); const q15 = await page.evaluate(() => __q('#occpf'));
    const k1 = calls.length; await page.click('#occpf [data-a=ocCpSave]'); await H.settle(page, 500);
    const sc = calls.slice(k1).find((c) => c.n === 'setOrderCfg');
    check('15 הגדרות: "פרטים להעתקה בהזמנת ניוד" – ברירת מחדל שם/טלפון/ת.ז/עיר/רחוב/קווים; ביטול, חץ למעלה וסימון → setOrderCfg {copyF} בסדר הנכון; כפתורים ≥44px', /פרטים להעתקה|בכרטיס הזמנת ניוד/.test(h15) && !!sc && JSON.stringify(sc.d.copyF) === JSON.stringify(['name', 'phone', 'st', 'city', 'lines', 'cnum', 'ccvv', 'x:xcity']) && q15.small.length === 0, { copyF: sc && sc.d.copyF, small: q15.small });
    // עסק בלי סניפים: כניסה "הגדרות הזמנות" ממסך ההזמנות, בלי טופס מקור המלאי
    const nb = await page.evaluate(async () => { const b0 = brAll; brAll = () => []; NAV = [{ v: 'home' }]; go('ox'); await new Promise((r) => setTimeout(r, 200)); const btn = !!document.querySelector('#main [data-v=oxCfg]'); go('oxCfg'); await new Promise((r) => setTimeout(r, 200));
      const f = document.querySelector('#main form[data-f=oxCfgF]'); const r = { btn, t: document.querySelector('#main') && cur().v, cp: !!document.getElementById('occpf'), srcHidden: !f || f.hidden, title: (document.querySelector('h1,.ttl,header h2') || {}).innerText || '' }; brAll = b0; return r; });
    check('15א עסק עם ניוד בלי סניפים: כפתור "הגדרות הזמנות" במסך ההזמנות; במסך – הפרטים להעתקה, בלי טופס מקור המלאי', nb.btn && nb.cp && nb.srcHidden, nb);
    CUST.push(doc('cust/cCopy0000000000000001', { name: S('נועה בדויה'), phone: S('0501112233'), city: S('אשדוד'), x: M({ xcity: S('אשקלון') }), card: { booleanValue: true }, last4: S('9012'), cards: A([M({ s: N(1), last4: S('9012') }), M({ s: N(2), last4: S('3456') })]) }));
    await page.evaluate((T1) => { const O = window.__ox; O.L = O.L.filter((o) => !['o7', 'o8'].includes(o.id)); const base = { br: 'br1', total: 99.9, at: T1, items: [], custId: 'cCopy0000000000000001', cust: { name: 'נועה בדויה', phone: '0501112233' }, cell: { n: 1, lines: [{ phone: '0521234567', tz: '123456782', carrier: 'סלקום' }] } };
      O.L.push(Object.assign({ id: 'o7', no: 17, status: 'paid', paid: { method: 'cash', at: T1 } }, base), Object.assign({ id: 'o8', no: 18, status: 'cancel', cancel: { reason: 'x' } }, base));
      window.__clip = []; Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t) => { window.__clip.push(t); return Promise.resolve(); }, readText: () => Promise.resolve('') }, configurable: true }); }, T1);
    await page.evaluate(() => { window.__r0 = SY.role; SY.role = 'worker'; }); await goV('oxOrd', 'o7'); await H.settle(page, 500);
    const hasB = !!(await page.$('#main [data-a=ocCopyAll]')); const k2 = calls.length;
    if (hasB) { await page.click('#main [data-a=ocCopyAll]'); await H.settle(page, 800); }
    const gc = calls.slice(k2).filter((c) => c.n === 'getCard'); const txt = await page.evaluate(() => window.__clip[window.__clip.length - 1] || '');
    await goV('oxOrd', 'o8'); await H.settle(page, 300); const noCancel = !(await page.$('#main [data-a=ocCopyAll]'));
    check('15ב עובד, הזמנת ניוד ששולמה: "העתק פרטי לקוח" → getCard copyAll + ordId רק לכרטיס הראשון (ללקוח 2 כרטיסים), בלי "כרטיס N"; טקסט "תווית: ערך" לפי הסדר, כולל CVV; שדה ריק לא נכתב; בהזמנה מבוטלת – אין כפתור',
      hasB && gc.length === 1 && gc.every((c) => c.d.act === 'copyAll' && c.d.ordId === 'o7' && c.d.custId === 'cCopy0000000000000001') && gc[0].d.slot === undefined
      && /^שם: נועה בדויה\nטלפון: 0501112233\nעיר: אשדוד\nקווים לניוד: \n  קו 1: 0521234567, ת\.ז 123456782, סלקום\nמספר כרטיס: 4580123456789012\nCVV: 123\nעיר: אשקלון$/.test(txt) && !/רחוב ומספר/.test(txt) && noCancel, { hasB, gc: gc.map((c) => c.d), txt, noCancel });
    globalThis.__GCOLD = 1; await goV('oxOrd', 'o7'); await H.settle(page, 300); await page.click('#main [data-a=ocCopyAll]'); await H.settle(page, 3200); globalThis.__GCOLD = 0;
    const t2 = await page.evaluate(() => ({ c: window.__clip[window.__clip.length - 1] || '', toast: [...document.querySelectorAll('.toast,#toast')].map((t) => t.innerText).join(' | ') }));
    check('15ג שרת ישן (getCard copyAll נדחה): שאר הפרטים מועתקים בלי אשראי + הודעה "דורשת עדכון שרת"', /^שם: נועה בדויה/.test(t2.c) && !/כרטיס/.test(t2.c) && /עדכון שרת/.test(t2.toast), t2);
    { // 15ד: copyF בלי שדות אשראי → לא נקרא getCard; השרת דוחה copy-no-card → מועתק בלי אשראי + הודעה
      const cf0 = await page.evaluate(() => { const v = window.__ox.cfg.copyF; window.__ox.cfg.copyF = ['name', 'phone']; return v; });
      const k3 = calls.length; await goV('oxOrd', 'o7'); await H.settle(page, 300); await page.click('#main [data-a=ocCopyAll]'); await H.settle(page, 800);
      const noGc = !calls.slice(k3).some((c) => c.n === 'getCard'); const c3 = await page.evaluate(() => window.__clip[window.__clip.length - 1] || '');
      await page.evaluate((v) => { window.__ox.cfg.copyF = v; }, cf0);
      globalThis.__GCNOCARD = 1; await goV('oxOrd', 'o7'); await H.settle(page, 300); await page.click('#main [data-a=ocCopyAll]'); await H.settle(page, 3200); globalThis.__GCNOCARD = 0;
      const t4 = await page.evaluate(() => ({ c: window.__clip[window.__clip.length - 1] || '', toast: [...document.querySelectorAll('.toast,#toast')].map((t) => t.innerText).join(' | ') }));
      check('15ד בלי שדות אשראי ב-copyF – בלי getCard; copy-no-card → בלי אשראי + הודעה בעברית', noGc && c3 === 'שם: נועה בדויה\nטלפון: 0501112233' && /^שם: נועה בדויה/.test(t4.c) && !/כרטיס/.test(t4.c) && /לא נבחרו שדות אשראי/.test(t4.toast), { noGc, c3, t4 });
    }
    await page.evaluate(() => { SY.role = window.__r0; window.__ox.L = window.__ox.L.filter((o) => !['o7', 'o8'].includes(o.id)); }); CUST.pop();
    check('14ב בלי שגיאות JS', page.__errors.length === 0, page.__errors);
  }
  await browser.close();
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
  console.log(fail ? `נכשלו ${fail}` : 'הכול עבר');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
