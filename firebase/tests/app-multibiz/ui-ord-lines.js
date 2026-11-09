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
const ORG = M({ v: N(1), branches: A([M({ id: S('br1'), name: S('נחל לכיש'), on: { booleanValue: true } }), M({ id: S('br2'), name: S('יהודה הנשיא'), on: { booleanValue: true } })]) });

(async () => {
  const [www, outFile, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  let src = www;
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
    if (/\/ordcfg\/cell$/.test(u.pathname)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ name: 'x', fields: { carriers: A([S('פרטנר'), S('סלקום')]), ads: A([S('פייסבוק')]) } }) });
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


  const fresh = async () => { await page.evaluate(() => { const g = document.getElementById('dlg'); if (g && g.open) g.close(); window.__ox.draft = null; NAV = [{ v: 'home' }]; go('oxNew'); }); await H.settle(page, 400); await page.selectOption('select[data-k=br]', 'br1'); };
  if (!CELLON) { // מתג כבוי: אין שום שדה ניוד, createOrder בלי cell, אין תוכניות ניוד
    await fresh(); const t = await page.innerText('#main');
    const noTz = !(await page.$('#octz')); // 2026-11-09: בלי ניוד – אין ת"ז בטופס
    await page.fill('input[data-k=fn]', 'רות'); await page.fill('input[data-k=ln]', 'כהן'); await page.fill('input[data-k=phone]', '0529998888');
    await page.fill('#oxq', 'לחם'); await page.click('[data-a=oxAdd]'); await H.settle(page, 200); await page.click('[data-a=oxSave]'); await H.settle(page, 800);
    const co = calls.find((c) => c.n === 'createOrder'); await goV('ox'); await H.settle(page, 300); const lt = await page.innerText('#main');
    check('כבוי: אין "ניוד" ואין ת"ז בטופס, createOrder בלי cell, אין checkLines, אין "תוכניות ניוד"', noTz && !/ניוד/.test(t) && !!co && co.d.cell === undefined && !calls.some((c) => c.n === 'checkLines') && !/תוכניות ניוד/.test(lt), { co: co && co.d });
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
  await page.fill('#octz', '000000018'); await H.settle(page, 300); // 2026-11-09: שדה הת"ז מופיע רק בניוד
  if (!tz0) throw new Error('ת"ז מוצגת לפני סימון ניוד');
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
  await page.selectOption('[data-c=olSel][data-f=plan] >> nth=1', 'pl1'); await page.selectOption('[data-c=olSel][data-f=carrier] >> nth=1', 'סלקום'); await H.settle(page, 400);
  await page.selectOption('[data-c=olAd]', 'פייסבוק');
  await page.click('#olin details summary'); await page.fill('[data-i=olB][data-f=bank]', '12'); await page.fill('[data-i=olB][data-f=br]', '345'); await page.fill('[data-i=olB][data-f=acct]', '123456'); await page.fill('[data-i=olB][data-f=ctz]', '123456782');
  await page.click('[data-a=oxSave]'); await H.settle(page, 900);
  const co = calls.filter((c) => c.n === 'createOrder').pop(); const cl = co && co.d.cell;
  check('3 שמירה נחסמת עד מענה להתראה; אחרי "המשך" נשלח cell: קו של הלקוח + קו נוסף עם ת"ז/תוכנית/חברה, ack, פרסום, בנק, ת"ז בעל כרטיס', blocked && !!cl && cl.ack === true && cl.lines.length === 2 && cl.lines[0].same === true && cl.lines[0].sameTz === true && cl.lines[1].phone === '0532222222' && cl.lines[1].tz === '123456782' && cl.lines[1].plan === 'pl1' && cl.lines[1].carrier === 'סלקום' && cl.ad === 'פייסבוק' && cl.bank.acct === '123456' && cl.ctz === '123456782', { blocked, cl });
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
  check('5 מסך תוכניות ניוד (מנהל): טווח 30 מוצג, ברירת מחדל 60 בתוכנית חדשה, saveLinePlan {name, days:45, carrier}; מגע/ניגודיות/גלילה', okAll(s5) && /התראה על ניוד חוזר: 30 יום/.test(s5.a.text) && def === '60' && !!sp && sp.d.days === 45 && sp.d.carrier === 'סלקום', { def, sp: sp && sp.d, s: sum(s5) });
  // 6. עובד: אין מסך תוכניות
  await page.evaluate(() => { window.__role0 = SY.role; SY.role = 'worker'; }); await goV('oxLines'); await H.settle(page, 200); const e6 = await page.innerText('#main'); await goV('ox'); await H.settle(page, 200); const e6b = await page.innerText('#main');
  await page.evaluate(() => { SY.role = window.__role0; });
  check('6 עובד: אין "תוכניות ניוד"', /אין לך הרשאה/.test(e6) && !/תוכניות ניוד/.test(e6b), { e6: e6.slice(0, 80) });
  // 7. ייבוא לקוחות: עמודת סניף הניוד (01:00)
  await goV('ocList'); await H.settle(page, 300); await page.click('[data-a=ocImp]'); await H.settle(page, 200);
  const csv = 'שם,טלפון,תאריך ניוד,טלפון ניוד,סניף\nדנה,0501111111,02/01/2025,0521234567,יהודה הנשיא\nיוסי,0502222222,02/01/2025,,סניף לא קיים\n';
  await page.setInputFiles('#dlg input[type=file]', { name: 'c.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) }); await H.settle(page, 500);
  const g7 = await page.inputValue('#dlg select[name=m4]');
  await page.click('#dlg button.btn.grow:not(.g)'); await H.settle(page, 400); const pv = await page.innerText('#dlg');
  await page.click('#dlg [data-a=ocGo]'); await H.settle(page, 600);
  const ic = calls.filter((c) => c.n === 'importCusts').pop();
  check('7 ייבוא: עמודת "סניף" מזוהה כסניף הניוד, נשלח מזהה הסניף; סניף לא קיים – שורה מסומנת', g7 === 'pbr' && !!ic && ic.d.rows.length === 1 && ic.d.rows[0].ports[0].br === 'br2' && /שורה 3: סניף/.test(pv), { g7, rows: ic && ic.d.rows, pv: pv.slice(0, 200) });
  check('8 בלי שגיאות JS', page.__errors.length === 0, page.__errors);
  }
  await browser.close();
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
  console.log(fail ? `נכשלו ${fail}` : 'הכול עבר');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
