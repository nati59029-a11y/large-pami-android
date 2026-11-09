'use strict';
// לקוחות (orders-cust.js, fb/ord-cust): ת"ז ראשונה בהזמנה, כרטיס לקוח, סיטונאי (מנהל), ייבוא עם חיתוך כרטיס ל-4 ספרות.
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
const CUST = [doc('cust/t' + TZ, { name: S('משה כהן'), phone: S('0501234567'), tz: S(TZ), last4: S('3456'), card: { booleanValue: true }, mail: S('moshe@x.co'), addr: S('הרצל 1'), x: M({ xcity: S('אשדוד') }) })];
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
    const R = { saveCust: { ok: true, id: 't' + TZ }, setCustCfg: { ok: true, xKeys: [{ k: 'xcity', label: 'עיר' }, { k: 'xab12', label: 'הערות' }] }, importCusts: { ok: true, created: 2, updated: 0, same: 0, bad: [] }, createOrder: { id: 'o1', no: 13, total: 24, warn: [] }, getPayLink: { link: LINK, total: 34.5 }, markOrderPaid: { ok: true }, setBusinessPayLink: { ok: true, mode: 'link', has: true }, getBackupKey: { key: Buffer.alloc(32, 7).toString('base64') }, getCard: n === 'getCard' && d.act === 'view' ? { card: { num: '5326100020003456', exp: '03/29', name: 'Moshe C', cvv: '987' } } : { card: { num: '5326100020003456' } }, setCard: { ok: true, last4: '3456' }, delCard: { ok: true } };
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


  // 1. הזמנה חדשה: ת"ז ראשונה וגלויה, מייל גלוי
  const nw = await screen('הזמנה-תז', async () => { await page.evaluate(() => { window.__ox.draft = null; NAV = [{ v: 'home' }]; go('oxNew'); }); await H.settle(page, 300); });
  const order = await page.evaluate(() => { const i = [...document.querySelectorAll('#main input')].filter((e) => e.offsetParent); return i.map((e) => e.dataset.k || e.id); });
  check('1 הזמנה חדשה: השדה הראשון ת"ז, ת"ז ומייל גלויים (לא בתוך "רשות"), מגע/ניגודיות/גלילה', okAll(nw) && order[0] === 'tz' && order.includes('mail') && !/\(רשות\)<\/summary>/.test(await page.evaluate(() => document.querySelector('#main').innerHTML)), { order, s: sum(nw) });
  // 2. ת"ז קיימת → מילוי
  await page.selectOption('select[data-k=br]', 'br1');
  await page.fill('#octz', TZ); await H.settle(page, 700);
  const D = await page.evaluate(() => Object.assign({}, window.__ox.draft));
  check('2 ת"ז קיימת ממלאת שם/טלפון/מייל/כתובת, לקוח רגיל', D.name === 'משה כהן' && D.phone === '0501234567' && D.mail === 'moshe@x.co' && D.addr === 'הרצל 1' && D.wholesale === false && /^[tp]\w+$/.test(D.custId || '') && /לקוח קיים/.test(await page.innerText('#main')), D);
  // 3. ת"ז לא קיימת → לקוח חדש; ת"ז שגויה
  await page.evaluate(() => { window.__ox.draft = null; NAV = [{ v: 'home' }]; go('oxNew'); }); await H.settle(page, 300);
  await page.fill('#octz', '123456789'); await H.settle(page, 200); const bad = await page.innerText('#ocst');
  await page.fill('#octz', '000000018'); await H.settle(page, 600); const nu = await page.innerText('#ocst');
  check('3 ת"ז שגויה מסומנת; ת"ז תקינה שלא קיימת → "לקוח חדש"', /לא תקינה/.test(bad) && /לקוח חדש/.test(nu), { bad, nu });
  // 4. שמירה → saveCust עם fill ובלי wholesale
  await page.selectOption('select[data-k=br]', 'br1'); await page.fill('input[data-k=name]', 'רות'); await page.fill('input[data-k=phone]', '0529998888'); await page.fill('input[data-k=mail]', 'r@x.co');
  await page.fill('#oxq', 'לחם'); await page.click('[data-a=oxAdd]'); await H.settle(page, 200);
  await page.click('[data-a=oxSave]'); await H.settle(page, 800);
  const sc = calls.find((c) => c.n === 'saveCust'), co = calls.find((c) => c.n === 'createOrder');
  check('4 שמירת הזמנה: saveCust {fill:true, tz, mail} בלי wholesale, ו-createOrder עם tz+mail', !!sc && sc.d.fill === true && sc.d.cust.tz === '000000018' && sc.d.cust.mail === 'r@x.co' && sc.d.wholesale === undefined && !!co && co.d.cust.tz === '000000018' && co.d.cust.mail === 'r@x.co', { sc: sc && sc.d, co: co && co.d.cust });
  // 5. רשימה + כרטיס (מנהל): כפתור סיטונאי
  const ls = await screen('לקוחות-רשימה', () => goV('ocList'));
  const cdr = await screen('כרטיס-לקוח', () => goV('ocCard', 't' + TZ));
  await page.click('[data-a=ocWs]'); await H.settle(page, 200); await page.click('#dlg [data-a=yes]'); await H.settle(page, 500);
  const ws = calls.filter((c) => c.n === 'saveCust').pop();
  check('5 רשימה וכרטיס לקוח (פרטים, שדה חופשי, הזמנות); מנהל מסמן סיטונאי → saveCust wholesale:true; מגע/ניגודיות/גלילה', okAll(ls) && okAll(cdr) && /משה כהן/.test(ls.a.text) && /עיר: אשדוד/.test(cdr.a.text) && /סמן כסיטונאי/.test(cdr.a.text) && ws.d.wholesale === true && ws.d.cust.tz === TZ, { ws: ws.d, l: sum(ls), c: sum(cdr) });
  // 6. ייבוא: קובץ CSV עם עמודת כרטיס מלא ועמודת "סיטונאי"
  await goV('ocList'); await H.settle(page, 300);
  await page.click('[data-a=ocImp]'); await H.settle(page, 200);
  const csv = 'שם,טלפון,ת.ז,כרטיס,סיטונאי,עיר,מספר מלא,תוקף,CVV\nדנה,0501111111,123456782,4580 1234 5678 9012,כן,אשדוד,,,\nאבי,0505555555,,,,,4012888888881881,07/28,321\nיוסי,521112222,,1234,כן,\nשגוי,abc,,12345,,\nרות,0503333333,,4111.1111.1111.1111,,\nטל,0504444444,,,,רחוב 5326/1000/2000/3456\n';
  await page.setInputFiles('#dlg input[type=file]', { name: 'c.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) }); await H.settle(page, 500);
  await shot('ייבוא-התאמה-a');
  const mapTxt = await page.innerText('#dlg');
  await page.selectOption('#dlg select[name=m3]', 'last4'); await page.selectOption('#dlg select[name=m4]', ''); await page.selectOption('#dlg select[name=m5]', 'xcity'); await page.selectOption('#dlg select[name=m6]', 'cnum'); await page.selectOption('#dlg select[name=m7]', 'cexp'); await page.selectOption('#dlg select[name=m8]', 'ccvv');
  await page.click('#dlg button.btn.grow:not(.g)'); await H.settle(page, 400); await shot('ייבוא-תצוגה-a');
  const pv = await page.innerText('#dlg');
  await page.click('#dlg [data-a=ocGo]'); await H.settle(page, 600);
  const ic = calls.find((c) => c.n === 'importCusts'); const all = JSON.stringify(calls) + (await page.evaluate(() => document.body.innerHTML + JSON.stringify(window.__oc) + JSON.stringify(localStorage)));
  check('6 ייבוא (כולל עמודת כרטיס מלא מוצפן + תוקף + CVV שנשלחים ב-card בלבד): מספר כרטיס מלא → last4 9012 בלבד; המספר המלא לא נשלח, לא מוצג ולא בזיכרון/אחסון; עמודת סיטונאי לא נשלחת; 0 בטלפון משוחזר; שורה שגויה מסומנת', !!ic && ic.d.rows.length === 4 && ic.d.rows[3].last4 === '1111' && ic.d.rows[1].last4 === '1881' && ic.d.rows[1].card && ic.d.rows[1].card.num === '4012888888881881' && ic.d.rows[1].card.exp === '07/28' && ic.d.rows[1].card.cvv === '321' && ic.d.rows.filter((r) => r.card).length === 1 && ic.d.rows[0].last4 === '9012' && ic.d.rows[0].x.xcity === 'אשדוד' && ic.d.rows[2].phone === '0521112222' && ic.d.rows[2].last4 === '1234' && ic.d.rows.every((r) => r.wholesale === undefined) && !/4580\s?1234|4111\.1111|5326\/1000/.test(all) && /שורה 7: מספר ארוך/.test(pv) && /\*\*\*\*9012/.test(mapTxt) && /שורה 5/.test(pv) && /נחתכו/.test(pv), { rows: ic && ic.d.rows, leak: /4580\s?1234|4111\.1111|5326\/1000/.test(all), pv: pv.slice(0, 200) });
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
  await page.evaluate(() => { SY.role = 'worker'; }); await goV('ocCard', 't' + TZ); await H.settle(page, 300);
  const emp = await page.innerText('#main'); await goV('ocList'); await H.settle(page, 200); const empL = await page.innerText('#main');
  check('7 עובד: בלי "סמן כסיטונאי", בלי ייבוא ובלי הגדרת שדות', !/סיטונאי/.test(emp.replace('לקוח רגיל', '')) && !/ייבוא/.test(empL) && !/שדות נוספים/.test(empL), { emp: emp.slice(0, 150) });
  check('8 בלי שגיאות JS', page.__errors.length === 0, page.__errors);
  await browser.close();
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
  console.log(fail ? `נכשלו ${fail}` : 'הכול עבר'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
