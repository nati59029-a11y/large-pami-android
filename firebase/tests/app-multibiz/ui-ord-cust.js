'use strict';
// לקוחות (orders-cust.js, fb/ord-cust): טלפון ראשון בהזמנה (2026-11-09, ת"ז רק בניוד), לקוח עסקי, כרטיס לקוח, סיטונאי (מנהל), ייבוא עם חיתוך כרטיס ל-4 ספרות.
// רשת מדומה. שימוש: node ui-ord-cust.js <www-dir> [out.json] [shots-dir]. MUTATE=card – באג מכוון: בלי חיתוך → בדיקה 6 נכשלת.
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
const ORD = [doc('ord/o1', { no: N(12), br: S('br1'), status: S('new'), custId: S('t123456782'), total: N(34.5), at: N(T1), byName: S('דנה'), cust: M({ name: S('משה כהן'), phone: S('0501234567'), addr: S('הרצל 1') }), items: A([M({ pid: S('pA'), n: S('עוגת שוקולד'), qty: N(2), price: N(12) }), M({ pid: S('pB'), n: S('לחם מחמצת'), qty: N(1), price: N(10.5), from: S('br2') })]) }),
  doc('ord/o2', { no: N(11), br: S('br2'), status: S('paid'), total: N(80), at: N(T1 - 9e6), cust: M({ name: S('רחל'), phone: S('0521112222') }), items: A([M({ n: S('מגש אירוח'), qty: N(1), price: N(80) })]), paid: M({ method: S('link'), last4: S('4242'), at: N(T1), amt: N(80) }) })];
const PROD = [doc('prod/pA', { name: S('עוגת שוקולד'), price: N(12), barcode: S('7290001'), on: { booleanValue: true }, q: M({ br1: N(5), br2: N(1) }) }),
  doc('prod/pB', { name: S('לחם מחמצת'), price: N(10.5), on: { booleanValue: true }, q: M({ br1: N(0), br2: N(8) }) })];
const TZ = '123456782';
const TZL = '222222226', LN = 'א'.repeat(45), LA = 'ב'.repeat(120);
const CUST = [doc('cust/t' + TZL, { name: S(LN), phone: S('0507777777'), tz: S(TZL), addr: S(LA), mail: S('old@x.co') }), doc('cust/t' + TZ, { name: S('משה כהן'), phone: S('0501234567'), tz: S(TZ), last4: S('3456'), card: { booleanValue: true }, mail: S('moshe@x.co'), addr: S('הרצל 1'), x: M({ xcity: S('אשדוד') }) }),
  doc('cust/cAbCdEfGhIjKlMnOpQrSt', { name: S('בן כהן'), phone: S('0501234567'), addr: S('הגפן 2, אשקלון') })];
const ORG = M({ v: N(1), branches: A([M({ id: S('br1'), name: S('נחל לכיש'), on: { booleanValue: true } }), M({ id: S('br2'), name: S('יהודה הנשיא'), on: { booleanValue: true } })]) });

(async () => {
  const [www, outFile, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  let src = www;
  if (process.env.MUTATE === 'card') {
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ord-')); fs.cpSync(www, tmp, { recursive: true });
    const f = path.join(tmp, 'orders-cust.js'); const s = fs.readFileSync(f, 'utf8'); const t = s.replace("if(/^\\d{13,19}$/.test(d))return {v:d.slice(-4),cut:1};", "if(/^\\d{13,19}$/.test(d))return {v:d,cut:1};");
    if (s === t) throw new Error('mutation target not found'); fs.writeFileSync(f, t); src = tmp;
  }
  { // זיהוי מספר כרטיס בשדות חופשיים (טלפון): כל תו שאינו אות/ספרה הוא מפריד
    const s = fs.readFileSync(path.join(src, 'orders-cust.js'), 'utf8');
    const line = s.split('\n').find((l) => l.startsWith('const CARD8='));
    const CARD8 = new Function(line.replace(/^const /, 'let ') + '\nreturn CARD8;')();
    for (const sep of ['\u2013', '\u2014', '\u05BE', '=', '!', '\u200F', '\u200B', '\u00A0', ' ', '.', '/', '@']) {
      const v = ['4580', '1234', '5678', '9012'].join(sep);
      if (!CARD8.test('x ' + v)) throw new Error('CARD8 missed separator ' + JSON.stringify(sep));
    }
    if (CARD8.test('רחוב 12 דירה 3456 כניסה 5678')) throw new Error('CARD8 false positive (letters separate runs)');
    console.log('ok card8 separators');
  }
  const browser = await H.launch();
  const cfg = { mode: 'new', users: { m: 'biz-o', sa: 'biz-o' }, sa: { sa: 1 }, biz: { 'biz-o': { dataRoot: 'b', features: ALL, name: 'עסק בדיקה' } }, admins: { 'b/biz-o/|m': 1 }, ctx: { hasTouch: true, isMobile: true } };
  const log = []; const calls = [];
  const { ctx, page } = await H.newPage(browser, src, cfg, log, 'm');
  await ctx.route(/:8080\/.*/, async (route) => {
    const req = route.request(); const u = new URL(req.url()); const body = req.postData() || '';
    if (/:runQuery$/.test(u.pathname)) { globalThis.__RQ = (globalThis.__RQ || []).concat([body]); let c = ''; try { c = JSON.parse(body).structuredQuery.from[0].collectionId; } catch (e) { /* */ }
      const r = c === 'cust' ? CUST : c === 'ordpay' ? (globalThis.__OP || []) : c === 'ord' ? ORD : c === 'prod' ? PROD : c === 'stockLog' ? [doc('stockLog/s1', { name: S('עוגת שוקולד'), br: S('br1'), delta: N(5), why: S('in'), at: N(T1) })] : [{ readTime: '2026-11-03T09:00:00Z' }];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(r) }); }
    const cm = /\/cust\/([^/]+)$/.exec(u.pathname); if (cm) { const d = CUST.find((x) => x.document.name.endsWith('/' + cm[1])); return d ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(d.document) }) : route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":{"code":404}}' }); }
    if (/\/custcfg\/main$/.test(u.pathname)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ name: 'x', fields: { xKeys: A([M({ k: S('xcity'), label: S('עיר') })]) } }) });
    if (/\/ordcfg\/main$/.test(u.pathname)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ name: 'x', fields: { pay: M({ mode: S('link'), has: { booleanValue: true } }), src: M({ br1: S('stock') }) } }) });
    if (/\/ord\/o1\/log/.test(u.pathname)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ documents: [{ name: 'x/log/l1', fields: { t: N(T1), act: S('create'), note: S('₪34.5') } }] }) });
    if (/\/documents\/b\/biz-o$/.test(u.pathname) && req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ name: 'x', fields: { dataRoot: S('b'), status: S('active'), name: S('עסק בדיקה'), features: M(Object.fromEntries(Object.keys(ALL).map((k) => [k, { booleanValue: true }]))), org: ORG, brand: M({ name: S('עסק בדיקה') }) } }) });
    return route.fallback();
  });
  await ctx.route(/:5001\/.*/, async (route) => {
    const n = new URL(route.request().url()).pathname.split('/').pop(); let d = {}; try { d = JSON.parse(route.request().postData()).data; } catch (e) { /* */ }
    calls.push({ n, d });
    const R = { saveCust: { ok: true, id: 't' + TZ }, setCustCfg: { ok: true, xKeys: [{ k: 'xcity', label: 'עיר' }, { k: 'xab12', label: 'הערות' }] }, importCusts: { ok: true, created: 2, updated: 0, same: 0, bad: [] }, createOrder: { id: 'o1', no: 13, total: 24, warn: [] }, mergeCust: { ok: true, id: 't' + TZ, from: 'cXyZ12345678901234567', ords: 1, cards: 1 }, getPayLink: { link: LINK, total: 34.5 }, markOrderPaid: { ok: true }, setBusinessPayLink: { ok: true, mode: 'link', has: true }, getBackupKey: { key: Buffer.alloc(32, 7).toString('base64') }, getCard: n === 'getCard' && d.act === 'view' ? { card: { num: '5326100020003456', exp: '03/29', name: 'Moshe C', cvv: '987' } } : { card: { num: '5326100020003456' } }, setCard: { ok: true, last4: '3456' }, delCard: { ok: true } };
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


  // 1. הזמנה חדשה: טלפון ראשון; אין ת"ז (לא ניוד); משלוח ברשות
  const nw = await screen('הזמנה-טלפון', async () => { await page.evaluate(() => { window.__ox.draft = null; NAV = [{ v: 'home' }]; go('oxNew'); }); await H.settle(page, 300); });
  const order = await page.evaluate(() => [...document.querySelectorAll('#main input')].filter((e) => e.offsetParent).map((e) => e.dataset.k || e.id));
  const h1 = await page.evaluate(() => document.querySelector('#main').innerHTML);
  check('1 הזמנה חדשה: השדה הראשון טלפון, שם פרטי ומשפחה, אין ת"ז; משלוח (רחוב/עיר/קומה/דירה) ברשות; מגע/ניגודיות/גלילה', okAll(nw) && order[0] === 'phone' && order[1] === 'fn' && order[2] === 'ln' && !order.includes('tz') && !h1.includes('id="octz"') && /משלוח – כתובת, עיר, קומה ודירה \(רשות\)/.test(h1), { order, s: sum(nw) });
  // 2. טלפון קיים → שני לקוחות לבחירה; בחירה ממלאת
  await page.selectOption('select[data-k=br]', 'br1');
  await page.fill('input[data-k=phone]', '050-1234567'); await H.settle(page, 700);
  const st2 = await page.innerText('#ocst');
  await shot('הזמנה-טלפון-קיים');
  await page.click('[data-a=ocPick][data-id="t' + TZ + '"]'); await H.settle(page, 300);
  const D = await page.evaluate(() => Object.assign({}, window.__ox.draft));
  check('2 טלפון קיים: מוצגים שני הלקוחות (ת"ז ישן + נוסף); בחירה ממלאת שם/מייל/כתובת, לקוח רגיל, מקושר', /2 לקוחות/.test(st2) && /משה כהן/.test(st2) && /בן כהן/.test(st2) && D.fn === 'משה כהן' && D.mail === 'moshe@x.co' && D.st === 'הרצל 1' && D.wholesale === false && D.custId === 't' + TZ && /לקוח קיים/.test(await page.innerText('#main')), { st2, D });
  // 2ב. צירוף כתובת ללקוח הקיים → saveCust {id, fill}
  await page.fill('#oxq', 'לחם'); await page.click('[data-a=oxAdd]'); await H.settle(page, 200);
  const n2 = calls.length; await page.click('[data-a=oxSave]'); await H.settle(page, 800);
  const sc2 = calls.slice(n2).find((c) => c.n === 'saveCust'), co2 = calls.slice(n2).find((c) => c.n === 'createOrder');
  check('2ב שמירה עם לקוח שנבחר: saveCust {id, fill:true} (פרטים מצטרפים, לא דורסים), createOrder עם custId', !!sc2 && sc2.d.id === 't' + TZ && sc2.d.fill === true && !sc2.d.asNew && !!co2 && co2.d.custId === 't' + TZ, { sc2: sc2 && sc2.d });
  // 3. "לקוח חדש עם אותו טלפון" → asNew
  await page.evaluate(() => { window.__ox.draft = null; NAV = [{ v: 'home' }]; go('oxNew'); }); await H.settle(page, 300);
  await page.selectOption('select[data-k=br]', 'br1'); await page.fill('input[data-k=phone]', '0501234567'); await H.settle(page, 700);
  await page.click('[data-a=ocAsNew]'); await H.settle(page, 200);
  await page.fill('input[data-k=fn]', 'דן'); await page.fill('input[data-k=ln]', 'לוי');
  await page.fill('#oxq', 'לחם'); await page.click('[data-a=oxAdd]'); await H.settle(page, 200);
  const n3 = calls.length; await page.click('[data-a=oxSave]'); await H.settle(page, 800);
  const sc3 = calls.slice(n3).find((c) => c.n === 'saveCust');
  check('3 "לקוח חדש עם אותו טלפון": saveCust {asNew:true} בלי id ובלי ת"ז', !!sc3 && sc3.d.asNew === true && !sc3.d.id && sc3.d.cust.tz === undefined && sc3.d.cust.fn === 'דן' && sc3.d.cust.phone === '0501234567', { sc3: sc3 && sc3.d });
  // 4. טלפון חדש → "לקוח חדש"; שמירה → saveCust fill בלי ת"ז ובלי wholesale; createOrder מקושר ללקוח שנוצר
  await page.evaluate(() => { window.__ox.draft = null; NAV = [{ v: 'home' }]; go('oxNew'); }); await H.settle(page, 300);
  await page.selectOption('select[data-k=br]', 'br1'); await page.fill('input[data-k=phone]', '0529998888'); await H.settle(page, 600); const nu = await page.innerText('#ocst');
  // סבב 1: שם פרטי בלי שם משפחה – השמירה נחסמת (לא נשלח כלום)
  await page.fill('input[data-k=fn]', 'רות'); await page.fill('#oxq', 'לחם'); await page.click('[data-a=oxAdd]'); await H.settle(page, 200);
  const nb = calls.length; await page.click('[data-a=oxSave]'); await H.settle(page, 400);
  const noLn = calls.length === nb;
  await page.evaluate(() => { window.__ox.draft.items = []; });
  await page.fill('input[data-k=ln]', 'כהן'); await page.click('#main details summary'); await page.fill('input[data-k=city]', 'אשדוד'); await page.fill('input[data-k=fl]', '3');
  await page.fill('#oxq', 'לחם'); await page.click('[data-a=oxAdd]'); await H.settle(page, 200);
  const n4 = calls.length; await page.click('[data-a=oxSave]'); await H.settle(page, 800);
  const sc = calls.slice(n4).find((c) => c.n === 'saveCust'), co = calls.slice(n4).find((c) => c.n === 'createOrder');
  check('4א הזמנה ללקוח חדש בלי שם משפחה – נחסמת (בלי saveCust ובלי createOrder)', noLn, null);
  check('4 טלפון חדש → "לקוח חדש"; saveCust {fill} בלי ת"ז/wholesale עם עיר וקומה; createOrder עם custId', /לקוח חדש/.test(nu) && !!sc && sc.d.fill === true && sc.d.cust.tz === undefined && sc.d.cust.city === 'אשדוד' && sc.d.cust.fl === '3' && sc.d.wholesale === undefined && !sc.d.id && !sc.d.asNew && !!co && co.d.cust.tz === undefined && co.d.custId === 't' + TZ, { sc: sc && sc.d, co: co && co.d });
  { // 4ב (תוספת 11:50): כרטיס אשראי בטופס ההזמנה → אחרי createOrder: setCard {custId, ordId, add:true}; המספר לא נשאר בטיוטה; מתג ordCard כבוי – אין משבצת
    await page.evaluate(() => { window.__ox.draft = null; NAV = [{ v: 'home' }]; go('oxNew'); }); await H.settle(page, 300);
    await page.selectOption('select[data-k=br]', 'br1'); await page.fill('input[data-k=phone]', '0529998877'); await H.settle(page, 600);
    await page.fill('input[data-k=fn]', 'גל'); await page.fill('input[data-k=ln]', 'לוי'); await page.fill('#oxq', 'לחם'); await page.click('[data-a=oxAdd]'); await H.settle(page, 200);
    const box = await page.$('#occd'); await page.click('#occd summary');
    await page.fill('input[data-i=ocCd][data-k=num]', '4580 1234 5678 9012'); await page.fill('input[data-i=ocCd][data-k=exp]', '7/28'); await page.fill('input[data-i=ocCd][data-k=cvv]', '123');
    const inDraft = await page.evaluate(() => JSON.stringify(window.__ox.draft || {}).includes('4580'));
    const n5 = calls.length; await page.click('[data-a=oxSave]'); await H.settle(page, 1200);
    const co5 = calls.slice(n5).findIndex((c) => c.n === 'createOrder'), sc5 = calls.slice(n5).findIndex((c) => c.n === 'setCard'), sd = sc5 >= 0 ? calls.slice(n5)[sc5].d : null;
    await page.evaluate(() => { SY.biz = Object.assign({}, SY.biz || {}, { features: Object.assign({}, (SY.biz && SY.biz.features) || {}, { ordCard: false }) }); window.__ox.draft = null; NAV = [{ v: 'home' }]; go('oxNew'); }); await H.settle(page, 300);
    const off = !(await page.$('#occd'));
    await page.evaluate(() => { delete SY.biz.features.ordCard; });
    check('4ב כרטיס בטופס ההזמנה: משבצת קיימת; setCard אחרי createOrder עם ordId ו-add; המספר לא בטיוטה; מתג כבוי → בלי משבצת', !!box && !inDraft && co5 >= 0 && sc5 > co5 && !!sd && sd.custId === 't' + TZ && sd.ordId === 'o1' && sd.add === true && sd.card.num === '4580123456789012' && sd.card.exp === '07/28' && sd.card.cvv === '123' && off, { box: !!box, inDraft, co5, sc5, off, sd: sd && Object.assign({}, sd, { card: sd.card && { l: String(sd.card.num).slice(-4) } }) });
  }
  // 5. רשימה + כרטיס (מנהל): כפתור סיטונאי
  const ls = await screen('לקוחות-רשימה', () => goV('ocList'));
  const cdr = await screen('כרטיס-לקוח', () => goV('ocCard', 't' + TZ));
  await page.click('[data-a=ocWs]'); await H.settle(page, 300); // סבב 1: סימון כעסקי פותח טופס עם כל שדות העסק
  const n5w = calls.length; await page.click('#dlg form button.grow:not(.g)'); await H.settle(page, 300); const wsBlk = calls.slice(n5w).filter((c) => c.n === 'saveCust').length === 0;
  await page.fill('#dlg input[name=bn]', 'כהן בע"מ'); await page.fill('#dlg input[name=vat]', '515555555'); await page.fill('#dlg input[name=ct]', 'משה'); await page.fill('#dlg input[name=city]', 'אשדוד'); await page.selectOption('#dlg select[name=pay]', 'n30');
  await page.click('#dlg form button.grow:not(.g)'); await H.settle(page, 600);
  const ws = calls.filter((c) => c.n === 'saveCust').pop();
  check('5 רשימה וכרטיס לקוח (פרטים, שדה חופשי, הזמנות); מנהל מסמן סיטונאי → saveCust wholesale:true; מגע/ניגודיות/גלילה', okAll(ls) && okAll(cdr) && /משה כהן/.test(ls.a.text) && /עיר: אשדוד/.test(cdr.a.text) && /סמן כלקוח עסקי \(סיטונאי\)/.test(cdr.a.text) && wsBlk && ws.d.wholesale === true && ws.d.id === 't' + TZ && ws.d.cust.bn === 'כהן בע"מ' && ws.d.cust.st === 'הרצל 1', { ws: ws.d, l: sum(ls), c: sum(cdr) });
  // 6. ייבוא: קובץ CSV עם עמודת כרטיס מלא ועמודת "סיטונאי"
  const ih = await screen('מרכז-ייבוא', () => goV('imp'));
  check('6 מרכז הייבוא (עוד ← ייבוא מאקסל): מוצרים ומלאי, לקוחות, הכנסות והוצאות; מגע/ניגודיות/גלילה (3 ערכות)', okAll(ih) && /מוצרים ומלאי/.test(ih.a.text) && /לקוחות/.test(ih.a.text) && /הכנסות והוצאות/.test(ih.a.text), sum(ih));
  // 9.11.2026: ייבוא לקוחות עבר למרכז הייבוא (עוד ← ייבוא מאקסל), ולא נמצא יותר ברשימת הלקוחות
  await goV('ocList'); await H.settle(page, 300);
  check('6א ברשימת הלקוחות אין כפתור ייבוא (עבר למרכז הייבוא)', !(await page.$('#main [data-a=ocImp]')), null);
  await goV('imp'); await H.settle(page, 300);
  await page.click('#main [data-a=ocImp]'); await H.settle(page, 200);
  const csv = 'שם,טלפון,ת.ז,כרטיס,סיטונאי,עיר,מספר מלא,תוקף,CVV\nדנה,0501111111,123456782,4580 1234 5678 9012,כן,אשדוד,,,\nאבי,0505555555,,,,,4012888888881881,07/28,321\nיוסי,521112222,,1234,כן,\nשגוי,abc,,12345,,\nרות,0503333333,,4111.1111.1111.1111,,\nטל,0504444444,,,,רחוב 5326/1000/2000/3456\n';
  await page.setInputFiles('#dlg input[type=file]', { name: 'c.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) }); await H.settle(page, 500);
  await shot('ייבוא-התאמה-a');
  const mapTxt = await page.innerText('#dlg');
  await page.selectOption('#dlg select[name=m3]', 'last4'); await page.selectOption('#dlg select[name=m4]', ''); await page.selectOption('#dlg select[name=m5]', 'xcity'); await page.selectOption('#dlg select[name=m6]', 'cnum'); await page.selectOption('#dlg select[name=m7]', 'cexp'); await page.selectOption('#dlg select[name=m8]', 'ccvv');
  await page.click('#dlg button.btn.grow:not(.g)'); await H.settle(page, 400); await shot('ייבוא-תצוגה-a');
  const pv = await page.innerText('#dlg');
  await page.click('#dlg [data-a=ocGo]'); await H.settle(page, 600);
  const ic = calls.find((c) => c.n === 'importCusts'); const all = JSON.stringify(calls.filter((c) => c.n !== 'setCard')) /* setCard (4ב) שולח את המספר לשרת בכוונה */ + (await page.evaluate(() => document.body.innerHTML + JSON.stringify(window.__oc) + JSON.stringify(localStorage)));
  check('6 ייבוא (כולל עמודת כרטיס מלא מוצפן + תוקף + CVV שנשלחים ב-cards בלבד – סבב 2): מספר כרטיס מלא → last4 9012 בלבד; המספר המלא לא נשלח, לא מוצג ולא בזיכרון/אחסון; עמודת סיטונאי לא נשלחת; 0 בטלפון משוחזר; שורה שגויה מסומנת', !!ic && ic.d.rows.length === 4 && ic.d.rows[3].last4 === '1111' && ic.d.rows[1].last4 === '1881' && ic.d.rows[1].cards && ic.d.rows[1].cards.length === 1 && ic.d.rows[1].cards[0].num === '4012888888881881' && ic.d.rows[1].cards[0].exp === '07/28' && ic.d.rows[1].cards[0].cvv === '321' && ic.d.rows.filter((r) => r.cards || r.card).length === 1 && ic.d.rows[0].last4 === '9012' && ic.d.rows[0].x.xcity === 'אשדוד' && ic.d.rows[2].phone === '0521112222' && ic.d.rows[2].last4 === '1234' && ic.d.rows.every((r) => r.wholesale === undefined) && !/4580\s?1234|4111\.1111|5326\/1000/.test(all) && /שורה 7: מספר ארוך/.test(pv) && /\*\*\*\*9012/.test(mapTxt) && /שורה 5/.test(pv) && /נחתכו/.test(pv), { rows: ic && ic.d.rows, leak: /4580\s?1234|4111\.1111|5326\/1000/.test(all), pv: pv.slice(0, 600) });
  const mem = JSON.stringify(await page.evaluate(() => [window.__oc, localStorage, document.body.innerHTML]));
  check('6ב אחרי ייבוא: מספר הכרטיס המלא לא נשאר בזיכרון/אחסון/מסך', !mem.includes('4012888888881881'), null);
  await page.evaluate(() => { try { closeDlg(); } catch (e) { /* */ } }); await H.settle(page, 200);
  // 9. מנהל: כרטיס לקוח – הצגה (getCard view), העתקה, מחיקה
  await goV('ocCard', 't' + TZ); await H.settle(page, 400);
  const cc = await page.innerText('#main');
  await page.click('[data-a=ocCardView]'); await H.settle(page, 400); const cv = await page.innerText('#occv');
  const gv = calls.filter((c) => c.n === 'getCard').pop();
  await page.click('[data-a=ocCardDel]'); await H.settle(page, 200); await page.click('#dlg [data-a=yes]'); await H.settle(page, 400);
  const dc = calls.filter((c) => c.n === 'delCard').pop();
  const ls9 = await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(window.__oc));
  check('9 מנהל: ****3456 מוצפן; "הצג" → getCard view ומציג מספר/תוקף/CVV; מחיקה → delCard; לא נשמר באחסון', /\*\*\*\*3456/.test(cc) && /מוצפן/.test(cc) && gv && gv.d.act === 'view' && gv.d.custId === 't' + TZ && /5326 1000 2000 3456/.test(cv) && /03\/29/.test(cv) && /987/.test(cv) && dc && dc.d.custId === 't' + TZ && !ls9.includes('5326100020003456'), { cv, gv: gv && gv.d });
  // 10. עובד: כרטיס הזמנה פתוחה – "העתק מספר כרטיס" שולח ordId
  await page.evaluate(() => { window.__r0 = SY.role; SY.role = 'worker'; }); await goV('oxOrd', 'o1'); await H.settle(page, 600); await goV('oxOrd', 'o1'); await H.settle(page, 300);
  const oh = await page.innerText('#main');
  const hasCopy = await page.$('[data-a=ocCardCopy][data-ord=o1]');
  if (hasCopy) { await page.click('[data-a=ocCardCopy][data-ord=o1]'); await H.settle(page, 400); }
  const gc = calls.filter((c) => c.n === 'getCard').pop();
  const noView = !(await page.$('[data-a=ocCardView]'));
  await goV('oxOrd', 'o2'); await H.settle(page, 300); const paidNo = !(await page.$('[data-a=ocCardCopy]'));
  check('10 עובד: בהזמנה שלא שולמה – העתק מספר (getCard copy + ordId), בלי "הצג"; בהזמנה ששולמה – אין כפתור', !!hasCopy && gc && gc.d.act === 'copy' && gc.d.ordId === 'o1' && noView && paidNo && /העתק מספר כרטיס/.test(oh), { gc: gc && gc.d, noView, paidNo });
  // 10ב (ליקוי 5): אחרי העתקה – טיימר 45 שניות מנקה את הלוח: קריאה זהה → ריק; תוכן אחר → לא נוגעים; בלי readText / קריאה נדחית → כותבים ריק
  const clip = [];
  for (const mode of ['same', 'other', 'noread', 'deny']) {
    await page.evaluate((mode) => {
      window.__clip = { v: null, w: [] }; window.__tm = [];
      const st = window.__st0 || (window.__st0 = window.setTimeout);
      window.setTimeout = (f, ms, ...a) => { if (ms === 45000) { window.__tm.push(f); return 0; } return st(f, ms, ...a); };
      const cb = { writeText: (t) => { window.__clip.v = t; window.__clip.w.push(t); return Promise.resolve(); } };
      if (mode === 'same') cb.readText = () => Promise.resolve(window.__clip.v);
      if (mode === 'other') cb.readText = () => Promise.resolve('אחר');
      if (mode === 'deny') cb.readText = () => Promise.reject(new Error('NotAllowed'));
      Object.defineProperty(navigator, 'clipboard', { value: cb, configurable: true });
    }, mode);
    await goV('oxOrd', 'o1'); await H.settle(page, 300);
    if (await page.$('[data-a=ocCardCopy][data-ord=o1]')) { await page.click('[data-a=ocCardCopy][data-ord=o1]'); await H.settle(page, 400); }
    clip.push(await page.evaluate(async () => { const n = window.__tm.length; window.__tm.forEach((f) => f()); await new Promise((r) => window.__st0(r, 50)); window.setTimeout = window.__st0; return { n, w: window.__clip.w }; }));
  }
  check('10ב לוח ההעתקה מתנקה אחרי 45 שניות (זהה → ריק; אחר → לא נוגעים; בלי הרשאת קריאה → ריק), בלי שגיאות',
    clip.every((c) => c.n === 1 && c.w[0] && c.w[0] !== '') && clip[0].w[1] === '' && clip[1].w.length === 1 && clip[2].w[1] === '' && clip[3].w[1] === '', { clip: clip.map((c) => ({ n: c.n, k: c.w.length, last: c.w[c.w.length - 1] === '' })) });
  await page.evaluate(() => { SY.role = window.__r0; });
  // 7. עובד: אין כפתור סיטונאי ואין ייבוא
  await page.evaluate(() => { window.__role0 = SY.role; SY.role = 'worker'; }); await goV('ocCard', 't' + TZ); await H.settle(page, 300);
  const emp = await page.innerText('#main'); await goV('ocList'); await H.settle(page, 200); const empL = await page.innerText('#main');
  check('7 עובד: בלי "סמן כלקוח עסקי", בלי ייבוא, בלי הגדרת שדות ובלי מחיקת כל הלקוחות', !/סמן כלקוח עסקי|הפוך ללקוח רגיל/.test(emp) && !/ייבוא/.test(empL) && !/שדות נוספים/.test(empL) && !/מחיקת כל הלקוחות|שחזור לקוחות/.test(empL), { emp: emp.slice(0, 150) });
  await page.evaluate(() => { SY.role = window.__role0; }); await goV('ocList'); await H.settle(page, 200);
  { const n0 = calls.length; await page.click('#main [data-a=ocWipe]'); await H.settle(page, 200); const wt = await page.innerText('#dlg');
    await page.fill('#dlg input[name=cf]', 'כן'); await page.click('#dlg form button.r'); await H.settle(page, 300); const blk = calls.slice(n0).every((c) => c.n !== 'wipeCusts');
    await page.fill('#dlg input[name=cf]', 'מחק'); await page.click('#dlg form button.r'); await H.settle(page, 500); const wc = calls.slice(n0).find((c) => c.n === 'wipeCusts');
    await page.click('#main [data-a=ocRest]'); await H.settle(page, 200); await page.click('#dlg [data-a=yes]'); await H.settle(page, 400); const rc = calls.slice(n0).find((c) => c.n === 'restoreCusts');
    check('7א מנהל: מחיקת כל הלקוחות – אזהרה עם גיבוי, בלי "מחק" לא נשלח, עם "מחק" → wipeCusts confirm; שחזור → restoreCusts', /גיבוי/.test(wt) && blk && !!wc && wc.d.confirm === 'מחק' && /^r/.test(wc.d.reqId) && !!rc, { wt: wt.slice(0, 120), wc: wc && wc.d }); }
  check('8 בלי שגיאות JS', page.__errors.length === 0, page.__errors);
  { const L = await page.evaluate(() => { const n = 'א'.repeat(45), a = 'ב'.repeat(120); const D = window.__oc.split({ name: n, addr: a }, {}); const S = window.__oc.split({ name: 'קצר', addr: 'הרצל 1' }, {}); return { D, S }; });
    check('ישן ארוך: שם 45 / כתובת 120 נשארים בשדה המלא, לא נדחסים לשם פרטי/רחוב', L.D.name.length === 45 && L.D.addr.length === 120 && !L.D.fn && !L.D.st && L.S.fn === 'קצר' && L.S.st === 'הרצל 1', L); }
  { // סבב 3 (מעודכן לטלפון): לקוח ישן עם שם 45 / כתובת 120, ואז החלפת טלפון – ההזמנה לא יורשת שם/כתובת/מייל
    const fresh = async () => { await page.evaluate(() => { SY.role = window.__role0; const g = document.getElementById('dlg'); if (g && g.open) g.close(); window.__ox.draft = null; NAV = [{ v: 'home' }]; go('oxNew'); }); await H.settle(page, 300); await page.selectOption('select[data-k=br]', 'br1'); };
    await fresh(); await page.fill('input[data-k=phone]', '0507777777'); await H.settle(page, 700); await page.click('[data-a=ocPick]'); await H.settle(page, 300);
    const a = await page.evaluate(() => Object.assign({}, window.__ox.draft));
    await page.fill('input[data-k=phone]', '0529990000'); await H.settle(page, 600);
    const b = await page.evaluate(() => Object.assign({}, window.__ox.draft));
    const n0 = calls.length; await page.fill('#oxq', 'לחם'); await page.click('[data-a=oxAdd]'); await H.settle(page, 200);
    await page.click('[data-a=oxSave]'); await H.settle(page, 600);
    const after = calls.slice(n0).map((c) => c.n);
    check('12 לקוח ישן ארוך ואז שינוי טלפון: name/addr/מייל וקישור נמחקים, אין שמירה בלי שם', a.name === LN && a.addr === LA && a.custId === 't' + TZL && !b.name && !b.addr && !b.mail && !b.custId && !b.tz && b.phone === '0529990000' && !after.includes('createOrder') && !after.includes('saveCust'), { a: [a.name && a.name.length, a.addr && a.addr.length], b, after });
    // לקוח עסקי בטופס לקוח חדש (עובד): שם עסק, ע.מ, איש קשר, תנאי תשלום "אחר" + פירוט → saveCust wholesale:true
    await page.evaluate(() => { SY.role = 'worker'; }); await goV('ocList'); await H.settle(page, 300);
    await page.click('[data-a=ocNew]'); await H.settle(page, 300); await page.click('#dlg [data-a=ocFt][data-t=biz]'); await H.settle(page, 200);
    const fz = await page.evaluate(() => { const d = document.querySelector('#dlg'); return { names: [...d.querySelectorAll('input:not([type=hidden]),select')].map((e) => e.name), sw: d.scrollWidth <= d.clientWidth + 1 }; });
    await shot('לקוח-עסקי-a');
    await page.fill('#dlg input[name=bn]', 'מאפיית הדר'); await page.fill('#dlg input[name=vat]', '515555555'); await page.fill('#dlg input[name=ct]', 'יוסי'); await page.fill('#dlg input[name=phone]', '0541234567');
    const req = await page.evaluate(() => ['bn', 'vat', 'ct', 'phone', 'st', 'city', 'pay'].every((n) => document.querySelector('#dlg [name=' + n + ']').required));
    const n5 = calls.length;
    await page.evaluate(() => FRM.ocF(document.querySelector('#dlg form'))); await H.settle(page, 300); const blkCity = calls.slice(n5).filter((c) => c.n === 'saveCust').length === 0;
    await page.fill('#dlg input[name=st]', 'הרצל 3'); await page.fill('#dlg input[name=city]', 'אשדוד'); await page.selectOption('#dlg select[name=pay]', 'other'); await H.settle(page, 100); await page.click('#dlg form button.grow:not(.g)'); await H.settle(page, 300); const blk = calls.slice(n5).filter((c) => c.n === 'saveCust').length === 0;
    await page.fill('#dlg input[name=payTxt]', 'צק דחוי'); await page.click('#dlg form button.grow:not(.g)'); await H.settle(page, 600);
    const bz = calls.slice(n5).filter((c) => c.n === 'saveCust').pop();
    check('13 עובד פותח לקוח עסקי (סיטונאי): שם העסק, ע.מ, איש קשר, טלפון, כתובת, עיר, תנאי תשלום; "אחר" בלי פירוט נחסם; saveCust wholesale:true', req && blkCity && ['bn', 'vat', 'ct', 'pay', 'phone', 'st', 'city'].every((k) => fz.names.includes(k)) && !fz.names.includes('fn') && blk && !!bz && bz.d.wholesale === true && bz.d.cust.bn === 'מאפיית הדר' && bz.d.cust.vat === '515555555' && bz.d.cust.pay === 'other' && bz.d.cust.payTxt === 'צק דחוי' && bz.d.cust.city === 'אשדוד' && !bz.d.id, { req, blkCity, fz, bz: bz && bz.d });
    // לקוח רגיל חדש עם טלפון קיים → חלון בחירה: פתיחה / צירוף / חדש
    await page.evaluate(() => { try { closeDlg(); } catch (e) { /* */ } }); await goV('ocList'); await H.settle(page, 300); await page.click('[data-a=ocNew]'); await H.settle(page, 300);
    await page.fill('#dlg input[name=fn]', 'דן'); await page.fill('#dlg input[name=ln]', 'לוי'); await page.fill('#dlg input[name=phone]', '0501234567');
    const n6 = calls.length; await page.click('#dlg form button.grow:not(.g)'); await H.settle(page, 600);
    const dup = await page.innerText('#dlg'); await shot('טלפון-קיים-חלון-a');
    await page.click('#dlg [data-a=ocDupNew]'); await H.settle(page, 600);
    const dn = calls.slice(n6).filter((c) => c.n === 'saveCust').pop();
    check('13ב לקוח חדש עם טלפון קיים: חלון עם הלקוחות הקיימים, "צרף" ו"לקוח חדש"; בחירה בחדש → asNew', /הטלפון כבר שייך/.test(dup) && /משה כהן/.test(dup) && /צרף את הפרטים/.test(dup) && calls.slice(n6, n6 + 1).every((c) => c.n !== 'saveCust' || c.d.asNew) && !!dn && dn.d.asNew === true && dn.d.cust.fn === 'דן', { dn: dn && dn.d });
    await page.evaluate(() => { SY.role = window.__role0; try { closeDlg(); } catch (e) { /* */ } });
  }
  { // סבב 3: עריכת לקוח ישן ארוך – מחיקת כתובת, ושם משפחה בלבד לא דורס שם קיים
    await goV('ocList'); await H.settle(page, 600);
    await page.evaluate((id) => { window.__oc.L.find((x) => x.id === id) || window.__oc.L.push({ id, name: 'א'.repeat(45), addr: 'ב'.repeat(120), phone: '0507777777', tz: '222222226' }); }, 't' + TZL);
    await page.evaluate((id) => ACT.ocEdit({ dataset: { id } }), 't' + TZL); await H.settle(page, 300);
    await page.fill('#dlg input[name=ln]', 'לוי'); const n2 = calls.length; await page.click('#dlg form button.grow:not(.g)'); await H.settle(page, 400);
    const blocked = calls.slice(n2).filter((x) => x.n === 'saveCust').length === 0;
    await page.fill('#dlg input[name=ln]', ''); await page.check('#dlg input[name=odel]'); await page.click('#dlg form button.grow:not(.g)'); await H.settle(page, 600);
    const sv = calls.slice(n2).filter((x) => x.n === 'saveCust').pop();
    check('14 עריכה: שם משפחה בלבד עם שם ישן – נחסם עם הודעה; "מחק את הכתובת" שולח addr:"" ושומר את השם הישן', blocked && !!sv && sv.d.cust.addr === '' && sv.d.cust.name === 'א'.repeat(45) && sv.d.cust.fn === undefined, { blocked, sv: sv && sv.d });
  }
  // 15. (2026-11-10) טלפון נוסף + כתובת משלוח נפרדת. לקוח שהטלפון 0538887777 שמור אצלו כטלפון נוסף (phs) – נמצא בשאילתת השרת
  CUST.push(doc('cust/cXyZ12345678901234567', { name: S('שרה לוי'), phone: S('0549998888'), phs: A([S('0538887777')]) }));
  await page.evaluate(() => { window.__ox.draft = null; NAV = [{ v: 'home' }]; go('oxNew'); }); await H.settle(page, 300);
  globalThis.__RQ = [];
  const h15 = await page.evaluate(() => document.querySelector('#main').innerHTML);
  await page.selectOption('select[data-k=br]', 'br1');
  await page.fill('input[data-k=phone]', '050-1234567'); await H.settle(page, 700);
  await page.click('[data-a=ocPick][data-id="t' + TZ + '"]'); await H.settle(page, 300);
  await page.click('[data-a=ocP2Add]'); await H.settle(page, 200);
  await page.fill('input[data-i=ocP2][data-n="0"]', '053-8887777'); await H.settle(page, 700);
  const rq = (globalThis.__RQ || []).some((b) => /"phs"/.test(b) && /ARRAY_CONTAINS/.test(b) && /0538887777/.test(b));
  const st15 = await page.evaluate(() => (document.getElementById('ocp2st') || {}).innerText || '');
  check('15 טלפון נוסף: כפתור פלוס בכל העסקים; חיפוש בשרת לפי phs (array-contains); שייך ללקוח אחר → שאלה: לאחד / לשייך לאחר / לשייך לנוכחי', /data-a="ocP2Add"/.test(h15) && /data-a="oxShip"/.test(h15) && rq && /שייך ללקוח אחר/.test(st15) && /לאחד את שני הכרטיסים/.test(st15) && /שרה לוי/.test(st15) && /הנוכחי/.test(st15), { rq, st15 });
  await page.fill('#oxq', 'לחם'); await page.click('[data-a=oxAdd]'); await H.settle(page, 200);
  let n15 = calls.length; await page.click('[data-a=oxSave]'); await H.settle(page, 500);
  check('15א שמירה נחסמת כל עוד לא נבחר מה לעשות עם הטלפון הנוסף', !calls.slice(n15).some((c) => c.n === 'createOrder'), calls.slice(n15).map((c) => c.n));
  await page.click('[data-a=oxShip]'); await H.settle(page, 200);
  await page.fill('input[data-i=oxS][data-k=st]', 'הגפן 5'); await page.fill('input[data-i=oxS][data-k=city]', 'אשקלון');
  await setDs('a'); await page.evaluate(() => { rerender(); document.querySelectorAll('.toast,#toast').forEach((e) => e.remove()); const d = document.getElementById('occd'); if (d) d.open = true; });
  await page.evaluate(() => window.scrollTo(0, 0)); await page.setViewportSize({ width: 360, height: 1100 }); await H.settle(page, 200);
  const g15 = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
  if (shots) await page.screenshot({ path: path.join(shots, 'הזמנה-טלפון-נוסף-ומשלוח.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('[data-a=ocMerge]'); await H.settle(page, 300);
  const dl15 = await page.evaluate(() => [...document.querySelectorAll('#dlg [data-a=ocMergeK]')].map((b) => ({ k: b.dataset.k, t: b.innerText })));
  check('15ב-1 חלון האיחוד: שתי בחירות "להשאיר את" עם שם, טלפון ות"ז של כל לקוח', dl15.length === 2 && dl15[0].k === 't' + TZ && dl15[1].k === 'cXyZ12345678901234567' && dl15.every((x) => /להשאיר את/.test(x.t) && /טלפון/.test(x.t) && /ת"ז/.test(x.t)) && /050-1234567/.test(dl15[0].t) && /שרה לוי/.test(dl15[1].t), dl15);
  await page.click('#dlg [data-a=ocMergeK][data-k="cXyZ12345678901234567"]'); await H.settle(page, 900);
  const mc = calls.filter((c) => c.n === 'mergeCust').pop();
  const D15 = await page.evaluate(() => ({ p2c: window.__ox.draft && window.__ox.draft.p2c, id: window.__ox.draft && window.__ox.draft.custId, ph: window.__ox.draft && window.__ox.draft.phone }));
  check('15ב איחוד: mergeCust {a: הנוכחי, b: האחר, keep: הנבחר}, השאלה נסגרת, ההזמנה נשארת מקושרת והטלפון הראשי לא נמחק; 360px בלי גלילה לצד', !!mc && mc.d.a === 't' + TZ && mc.d.b === 'cXyZ12345678901234567' && mc.d.keep === 'cXyZ12345678901234567' && !D15.p2c && D15.id === 't' + TZ && D15.ph === '050-1234567' && g15.sw <= g15.iw, { mc: mc && mc.d, D15, g15 });
  n15 = calls.length; await page.click('[data-a=oxSave]'); await H.settle(page, 900);
  const sc15 = calls.slice(n15).find((c) => c.n === 'saveCust'), co15 = calls.slice(n15).find((c) => c.n === 'createOrder');
  check('15ג שמירה: הזמנה עם phs וכתובת משלוח נפרדת (ship); הלקוח מקבל את הטלפון הנוסף (phs), כתובת הלקוח לא מוחלפת בכתובת המשלוח', !!co15 && JSON.stringify(co15.d.cust.phs) === '["0538887777"]' && co15.d.cust.ship && co15.d.cust.ship.st === 'הגפן 5' && co15.d.cust.ship.city === 'אשקלון' && co15.d.cust.st === 'הרצל 1' && !!sc15 && JSON.stringify(sc15.d.cust.phs) === '["0538887777"]' && sc15.d.cust.st === 'הרצל 1', { co: co15 && co15.d.cust, sc: sc15 && sc15.d.cust });
  CUST.pop();
  await browser.close();
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
  console.log(fail ? `נכשלו ${fail}` : 'הכול עבר'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
