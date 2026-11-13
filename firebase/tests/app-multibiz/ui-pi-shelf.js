'use strict';
// תמחור מחשבונית ספק, שלב 6 (12.11.2026): "הדפס מחיר" / "הדפס מבצע" ממסך התמחור (V.piEd) – פתק במודול המדף וחזרה לחשבונית.
// בודק (360px): פתק ממולא מהשורה → אישור → חזרה לאותה חשבונית ולאותה גלילה, הפתק בטיוטות, מחיר ששונה בפתק חוזר לשורה;
// ביטול / חזרה – בלי פתק; מבצע (מחיר המבצע לא משנה את השורה); "הדף מלא – המשך"; הנעילה לא משתחררת והפעימה ממשיכה;
// מדף רגיל אחרי זה – בדיוק כמו קודם (נשאר במסך המדף); עסק בלי מדף – בלי הכפתורים.
// הרשת המדומה – כמו ui-pi-ed.js. שימוש: node ui-pi-shelf.js <www-dir> [out.json] [shot.png]
const fs = require('fs'); const path = require('path'); const H = require('./harness');
let fail = 0; const res = []; const check = (n, ok, info) => { if (!ok) fail++; res.push({ n, ok: !!ok, info }); console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 600) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
const NAMES = { m: 'דני', m2: 'רותי', w: 'עובד', sm: 'מדף' };
const T0 = H.T0;

// ---- "שרת" מדומה ----
const CAT = {
  pA: { pid: 'pA', name: 'במבה', price: 5.9, barcode: '729001', sup: 'אסם', on: true, pk: 1, ct: 24, cto: false, q: {}, cost: 3.54, costx: 3, wp: 4.5 },
  pO: { pid: 'pO', name: 'במבה שטראוס', price: 6, barcode: '729005', sup: 'שטראוס', on: true, cto: false, q: {}, cost: 2.95, costx: 2.5, wp: 4 },
  pM: { pid: 'pM', name: 'מפיות', price: 7.9, barcode: '', sup: 'אסם', on: true, cto: true, q: {}, cost: 3.72, costx: 3.15, wp: null },
};
const sugg = { i1: [{ k: 'bc', pid: 'pA' }, { k: 'otherSup', oth: ['pO'] }, { k: '' }, { k: 'name', pid: 'pM' }], i3: [{ k: '' }] };
function fresh() {
  return {
    i1: { st: 'new', sup: 'אסם בע"מ', inv: '5001', date: '2026-11-01', at: T0 - 5000, by: 'w', byName: 'עובד', np: 1, lines: [
      { n: 'במבה 80 גרם', bc: '729001', qty: 10, unit: 'u', cost: 3.2 },
      { n: 'במבה אדומה', bc: '729005', qty: 6, unit: 'u', cost: 2 },
      { n: 'כוסות חד פעמי ארוז במארזים גדולים', bc: '729099', qty: 24, unit: 'ct', pk: 6, ct: 12, cost: 10, raw: '2 קרטון × 120 = 240', chk: 'סה"כ שורה לא תואם' },
      { n: 'מפיות', sku: 'A12', qty: 10, unit: 'pk', cost: 3.15 }] },
    i2: { st: 'new', sup: 'תנובה', inv: '77', date: '2026-11-02', at: T0 - 3000, by: 'm', byName: 'דני', np: 0, lk: { uid: 'x9', name: 'רותי', t: T0 - 60e3 }, lines: [{ n: 'חלב', qty: 1, unit: 'u', cost: 5 }] },
    i3: { st: 'new', sup: 'שטראוס', inv: '88', date: '2026-11-03', at: T0 - 1000, by: 'm', byName: 'דני', np: 0, lines: [{ n: 'יוגורט', bc: '729777', qty: 12, unit: 'u', cost: 2.4 }] },
  };
}
const S = { inv: fresh(), calls: [], ord: true };
const view = (pid) => { const p = CAT[pid]; return Object.assign({}, p); };
function matches(id, lines) {
  if (!S.ord) return [];
  return lines.map((l, i) => {
    const s = (sugg[id] || [])[i] || { k: '' };
    const oth = (s.oth || []).map((p) => { const v = view(p); return { pid: v.pid, name: v.name, sup: v.sup, price: v.price, costx: v.costx, wp: v.wp }; });
    let m = null, k = '';
    if (l.pid) { m = view(l.pid); k = 'pid'; } else if (l.nw) k = ''; else if (s.pid) { m = view(s.pid); k = s.k; } else if (oth.length) k = 'otherSup';
    return { m, k, nosup: false, oth: oth.filter((o) => !m || o.pid !== m.pid), cch: '' };
  });
}
const DU = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, '..', '..', '..', 'app-source', 'www', 'icon-192.png')).toString('base64');
const err = (route, reason, message) => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { status: 'FAILED_PRECONDITION', message, details: { reason } } }) });
const ok = (route, result) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result }) });
const fresh30 = (lk, now) => lk && now - lk.t < 30 * 60e3;
async function server(ctx, me) {
  const uidOf = (route) => String(route.request().headers().authorization || '').replace(/^Bearer tok-/, '');
  for (const fn of ['piClaim', 'piBeat', 'piRelease', 'piDraft', 'piFinish']) await ctx.route('**/' + fn, async (route) => {
    let b = {}; try { b = JSON.parse(route.request().postData()).data || {}; } catch (e) { /* */ }
    const uid = uidOf(route) || me; const d = S.inv[b.id]; const now = T0;
    S.calls.push({ fn, uid, b });
    if (!d) return err(route, 'no-pinv', 'החשבונית לא נמצאה');
    if (fn === 'piRelease') { if (d.st === 'new' && d.lk && d.lk.uid === uid) { delete d.lk; return ok(route, { ok: true, rel: true }); } return ok(route, { ok: true, rel: false }); }
    if (d.st !== 'new') return err(route, 'closed', 'החשבונית כבר טופלה');
    if (fn === 'piClaim') {
      if (fresh30(d.lk, now) && d.lk.uid !== uid) return err(route, 'locked', 'החשבונית בטיפול של ' + d.lk.name);
      d.lk = { uid, name: NAMES[uid] || uid, t: now };
      return ok(route, { ok: true, id: b.id, inv: { st: d.st, sup: d.sup, inv: d.inv, date: d.date, by: d.by, byName: d.byName, at: d.at, np: d.np, lines: JSON.parse(JSON.stringify(d.lines)) }, rev: d.rev || 0, lk: d.lk, until: now + 30 * 60e3, vat: 18, ord: S.ord, m: matches(b.id, d.lines) });
    }
    if (!(d.lk && d.lk.uid === uid)) return fresh30(d.lk, now) ? err(route, 'locked', 'החשבונית בטיפול של ' + d.lk.name) : err(route, 'not-locked', 'צריך להיכנס לחשבונית מחדש');
    if (fn === 'piBeat') { d.lk.t = now; return ok(route, { ok: true }); }
    if ((fn === 'piDraft' || fn === 'piFinish') && b.rev !== (d.rev || 0)) { S.calls.push({ fn: 'conflict', uid, b }); return err(route, 'conflict', 'עובד אחר ערך את החשבונית בינתיים – צריך לטעון אותה מחדש'); }
    if (fn === 'piDraft') { d.lines = b.lines; d.rev = (d.rev || 0) + 1; return ok(route, { ok: true, rev: d.rev }); }
    if (fn === 'piFinish') { d.rev = (d.rev || 0) + 1; d.st = 'done'; delete d.lk; d.lines = b.lines; return ok(route, { ok: true, id: b.id, dup: false, added: 1, updated: 3, qty: 38 }); }
  });
  // Firestore: שאילתת pinv (st == 'new') וחלקי הצילום
  const fv = (v) => (v == null ? { nullValue: null } : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }) : typeof v === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fv(x)])) } } : { stringValue: String(v) });
  await ctx.route((u) => u.port === '8080' && /\/documents\/.*:runQuery$/.test(u.pathname), async (route) => {
    let q = {}; try { q = JSON.parse(route.request().postData()).structuredQuery; } catch (e) { /* */ }
    if (!q.from || q.from[0].collectionId !== 'pinv') return route.fallback();
    const base = route.request().url().replace(/^https?:\/\/[^/]+\/v1\//, '').replace(/:runQuery$/, '');
    S.calls.push({ fn: 'list' });
    const docs = Object.entries(S.inv).filter(([, d]) => d.st === 'new').map(([id, d]) => ({ document: { name: base + '/pinv/' + id, fields: Object.fromEntries(['sup', 'inv', 'date', 'at', 'byName', 'lk', 'np'].filter((k) => d[k] != null).map((k) => [k, fv(d[k])]).concat([['n', fv(d.lines.length)]])) }, readTime: '2026-11-03T09:00:00Z' }));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(docs.length ? docs : [{ readTime: '2026-11-03T09:00:00Z' }]) });
  });
  await ctx.route((u) => u.port === '8080' && /\/pinv\/[^/]+\/p\/\d+$/.test(u.pathname), async (route) => {
    S.calls.push({ fn: 'img', url: route.request().url() });
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ name: 'x', fields: { data: { stringValue: DU } } }) });
  });
}
async function open(browser, www, cfg, email, w, perms) {
  const { ctx, page } = await H.newPage(browser, www, cfg, [], email); await page.setViewportSize({ width: w, height: 760 });
  const uid = email.split('@')[0];
  await server(ctx, uid);
  if (perms) await ctx.route((u) => u.port === '8080' && new RegExp('/staff/' + uid + '$').test(u.pathname), (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ name: 'x', fields: { active: { booleanValue: true }, perms: { mapValue: { fields: Object.fromEntries(Object.entries(perms).map(([k, v]) => [k, { booleanValue: v }])) } } } }) }));
  await H.login(page, email);
  await page.evaluate(() => { const sh = document.getElementById('sheet'); if (sh && !sh.hidden && typeof ACT.startBlank === 'function') ACT.startBlank(); if (window.PI) { PI.draftMs = 300; PI.beatMs = 700; } });
  await H.settle(page, 300);
  return { ctx, page };
}
const waitFor = async (page, fn, arg, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 8000)) { if (await page.evaluate(fn, arg).catch(() => false)) return true; await sleep(150); } return false; };
const noOverflow = (page) => page.evaluate(() => { const W = document.documentElement.clientWidth; const bad = [...document.querySelectorAll('#main *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > W + 1 || r.left < -1); }).slice(0, 5).map((e) => e.tagName + '.' + e.className + ' ' + (e.textContent || '').slice(0, 30)); return { W, sw: document.documentElement.scrollWidth, bad }; });
const calls = (fn, uid) => S.calls.filter((c) => c.fn === fn && (!uid || c.uid === uid));
const inp = (i, k) => `#pil${i} input[data-k="${k}"]`;

(async () => {
  const [www, out, shot] = process.argv.slice(2);
  const PC = require(path.join(path.resolve(www), 'pricing-calc.js'));
  const browser = await H.launch();
  const cfg = { mode: 'new', users: { m: 'biz-o' }, biz: { 'biz-o': { dataRoot: 'b', features: ALL, name: 'עסק בדיקה' } }, admins: { 'b/biz-o/|m': 1 } };
  const A = await open(browser, www, cfg, 'm@x.co', 360); const pg = A.page;
  await pg.evaluate(() => go('piEd', 'i1'));
  await waitFor(pg, () => document.querySelectorAll('.pil').length === 4); await sleep(400);
  const btn = await pg.evaluate(() => ({ p: document.querySelectorAll('[data-a=piPrP]').length, s: document.querySelectorAll('[data-a=piPrS]').length }));
  check('0 עסק עם מדף: "הדפס מחיר" ו"הדפס מבצע" בכל שורה', btn.p === 4 && btn.s === 4, btn);
  const cnt = (k) => pg.evaluate((k) => SH[k].items.filter(Boolean).length, k);
  const where = () => pg.evaluate(() => cur().v + ':' + (cur().a || ''));
  const rel = () => calls('piRelease', 'm').length;

  // ---- 1. הדפס מחיר: פתק ממולא ----
  await pg.fill(inp(2, 'price'), '19.9'); await sleep(100);
  await pg.evaluate(() => document.getElementById('pil2').scrollIntoView()); await sleep(200);
  const y0 = await pg.evaluate(() => window.scrollY);
  const nP0 = await cnt('price'), nB0 = calls('piBeat', 'm').length;
  await pg.click('#pil2 [data-a=piPrP]');
  await waitFor(pg, () => cur().v === 'shAdd' && !!document.querySelector('form[data-f=shadd]')); await sleep(600);
  const f1 = await pg.evaluate(() => { const q = (n) => (document.querySelector(`form[data-f=shadd] input[name=${n}]`) || {}).value; return { v: cur().v, a: cur().a, n: q('n'), d: q('d'), bc: q('bc'), p: q('p'), nav: NAV.map((x) => x.v).join('>') }; });
  check('1 "הדפס מחיר" → מסך "מחיר למדף" עם פתק ממולא: שם, ברקוד, מחיר כולל מע"מ שהוקלד בשורה', f1.v === 'shAdd' && f1.n.startsWith('כוסות') && f1.bc === '729099' && f1.p === '19.9' && /piEd>shAdd$/.test(f1.nav), f1);
  const dB = calls('piDraft', 'm').slice(-1)[0];
  check('1א לפני המעבר נשמרה טיוטה (המחיר שהוקלד בשורה)', dB && dB.b.lines[2].price === 19.9, dB && dB.b.lines[2]);
  const o1 = await noOverflow(pg);
  check('1ב פתק ממולא 360px – בלי גלישה', o1.sw <= o1.W && !o1.bad.length, o1);
  if (shot) { fs.mkdirSync(path.dirname(shot), { recursive: true }); await pg.screenshot({ path: shot, fullPage: true }); }
  await sleep(1600);
  check('1ג במסך המדף: הנעילה נשמרת (בלי piRelease) והפעימה ממשיכה', rel() === 0 && S.inv.i1.lk && S.inv.i1.lk.uid === 'm' && calls('piBeat', 'm').length > nB0, { rel: rel(), beats: calls('piBeat', 'm').length - nB0 });

  // ---- 2. שינוי מחיר בפתק ואישור → חזרה לאותה חשבונית ולאותה גלילה ----
  await pg.fill('form[data-f=shadd] input[name=p]', '21.5');
  await pg.click('form[data-f=shadd] button.btn:not([type])');
  await waitFor(pg, () => cur().v === 'piEd' && document.querySelectorAll('.pil').length === 4); await sleep(900);
  const r2 = await pg.evaluate(() => { const it = SH.price.items.filter(Boolean).slice(-1)[0]; return { w: cur().v + ':' + cur().a, y: window.scrollY, it, price: document.querySelector('#pil2 input[data-k=price]').value, l: PI.ed().L[2].price, mg: document.getElementById('pim2').textContent, rt: PI.rt() }; });
  check('2 אישור → הפתק נכנס לדף הטיוטה (שם, מחיר 21.50) וחוזרים לאותה חשבונית', r2.w === 'piEd:i1' && (await cnt('price')) === nP0 + 1 && r2.it && r2.it.n.startsWith('כוסות') && r2.it.p === '21.50' && !r2.rt, r2);
  check('2א חוזרים לאותה גלילה', Math.abs(r2.y - y0) <= 2 && y0 > 0, { y0, y: r2.y });
  check('2ב מחיר ששונה בפתק חוזר לשורה ו-% הרווח מחושב מחדש', r2.price === '21.5' && r2.l === 21.5 && r2.mg === `רווח: ${PC.marginInc(21.5, 10, 18)}%`, r2);
  const dC = calls('piDraft', 'm').slice(-1)[0];
  check('2ג המחיר החדש נשמר בטיוטה; הנעילה עדיין אצלי', dC && dC.b.lines[2].price === 21.5 && rel() === 0 && S.inv.i1.lk && S.inv.i1.lk.uid === 'm', dC && dC.b.lines[2]);

  // ---- 3. ביטול / חזרה → בלי פתק ----
  const p0 = await pg.evaluate(() => PI.ed().L[0].price);
  await pg.click('#pil0 [data-a=piPrP]'); await waitFor(pg, () => cur().v === 'shAdd'); await sleep(200);
  await pg.fill('form[data-f=shadd] input[name=p]', '3');
  await pg.click('form[data-f=shadd] [data-a=shCancel]'); await sleep(400);
  check('3 ביטול → חזרה לחשבונית, בלי פתק ובלי שינוי מחיר בשורה', (await where()) === 'piEd:i1' && (await cnt('price')) === nP0 + 1 && (await pg.evaluate(() => PI.ed().L[0].price)) === p0 && rel() === 0);
  await pg.click('#pil0 [data-a=piPrP]'); await waitFor(pg, () => cur().v === 'shAdd'); await sleep(200);
  await pg.evaluate(() => goBack()); await sleep(400);
  check('3א חזרה (כפתור חזרה) → לחשבונית, בלי פתק', (await where()) === 'piEd:i1' && (await cnt('price')) === nP0 + 1 && rel() === 0);

  // ---- 4. הדפס מבצע ----
  const nS0 = await cnt('p8');
  await pg.click('#pil0 [data-a=piPrS]'); await waitFor(pg, () => cur().v === 'shPromo' && !!document.querySelector('form[data-f=shpromo]')); await sleep(300);
  const f4 = await pg.evaluate(() => { const q = (n) => (document.querySelector(`form[data-f=shpromo] input[name=${n}]`) || {}).value; return { n: q('n'), bc: q('bc'), reg: q('reg'), now: q('now'), kind: SHP.kind }; });
  check('4 "הדפס מבצע" → מסך "מבצע למדף" ממולא: שם, ברקוד, מחיר רגיל = המחיר בשורה', f4.n === 'במבה 80 גרם' && f4.bc === '729001' && f4.reg === String(p0) && f4.now === '' && f4.kind === 'B', f4);
  await pg.fill('form[data-f=shpromo] input[name=now]', '4.9');
  await pg.click('form[data-f=shpromo] button.btn:not([type]):not([name])');
  await waitFor(pg, () => cur().v === 'piEd'); await sleep(400);
  const r4 = await pg.evaluate(() => ({ it: SH.p8.items.filter(Boolean).slice(-1)[0], l: PI.ed().L[0].price }));
  check('4א אישור → המבצע בדף, חזרה לחשבונית; מחיר המבצע לא שינה את המחיר בשורה', (await where()) === 'piEd:i1' && (await cnt('p8')) === nS0 + 1 && r4.it && r4.it.kind === 'B' && r4.it.now === 4.9 && r4.l === p0 && rel() === 0, r4);
  await pg.click('#pil0 [data-a=piPrS]'); await waitFor(pg, () => cur().v === 'shPromo'); await sleep(200);
  await pg.click('form[data-f=shpromo] [data-a=shCancel]'); await sleep(300);
  check('4ב ביטול מבצע → חזרה בלי מבצע', (await where()) === 'piEd:i1' && (await cnt('p8')) === nS0 + 1);

  // ---- 5. הדף מלא: חלון אזהרה, "המשך" → נוסף וחוזרים; "ביטול" בחלון → נשארים בפתק ----
  await pg.evaluate(() => { const L = SH.price; L.items = L.items.map((x, i) => x || { id: 'f' + i, n: 'מילוי ' + i, d: '', p: '1.00' }); L.next = 0; });
  await pg.click('#pil3 [data-a=piPrP]'); await waitFor(pg, () => cur().v === 'shAdd'); await sleep(200);
  await pg.click('form[data-f=shadd] button.btn:not([type])'); await sleep(300);
  const w5 = await pg.evaluate(() => ({ dlg: document.getElementById('dlg').open, v: cur().v }));
  await pg.evaluate(() => closeDlg()); await sleep(200);
  const w5b = await where();
  await pg.click('form[data-f=shadd] button.btn:not([type])'); await sleep(300);
  await pg.click('#dlg [data-a=shGoOn]'); await sleep(500);
  const r5 = await pg.evaluate(() => ({ w: cur().v + ':' + cur().a, first: SH.price.items[0] && SH.price.items[0].n }));
  check('5 הדף מלא: חלון אזהרה; ביטול בחלון נשאר בפתק; "המשך" מוסיף וחוזר לחשבונית', w5.dlg && w5.v === 'shAdd' && w5b === 'shAdd:pi' && r5.w === 'piEd:i1' && r5.first === 'מפיות', { w5, w5b, r5 });

  // ---- 6. יציאה מהחשבונית משחררת; מדף רגיל אחרי זה – כמו קודם ----
  await pg.evaluate(() => goBack()); await sleep(800);
  check('6 יציאה מהחשבונית (חזרה) – עכשיו piRelease', rel() === 1 && !S.inv.i1.lk);
  await pg.evaluate(() => { tab('home'); go('shelf'); }); await sleep(300);
  await pg.evaluate(() => ACT.shGo({ dataset: { k: 'shAdd' } })); await sleep(200);
  await pg.evaluate(() => ACT.shManual()); await sleep(200);
  await pg.fill('form[data-f=shadd] input[name=n]', 'מוצר מדף'); await pg.fill('form[data-f=shadd] input[name=p]', '12');
  const n6 = await cnt('price');
  await pg.click('form[data-f=shadd] button.btn:not([type])'); await sleep(300);
  if (await pg.evaluate(() => document.getElementById('dlg').open)) { await pg.click('#dlg [data-a=shGoOn]'); await sleep(300); }
  const r6 = await pg.evaluate(() => ({ w: cur().v, nav: NAV.map((x) => x.v).join('>'), shf: SHF, any: SH.price.items.some((x) => x && x.n === 'מוצר מדף') }));
  check('6א מדף רגיל: אישור מוסיף פתק ונשאר במסך "מחיר למדף" (כמו קודם)', r6.w === 'shAdd' && r6.nav === 'home>shelf>shAdd' && r6.shf === null && r6.any, r6);
  await pg.evaluate(() => ACT.shManual()); await sleep(100);
  await pg.evaluate(() => ACT.shCancel()); await sleep(200);
  check('6ב מדף רגיל: ביטול נשאר במסך "מחיר למדף" (כמו קודם)', (await pg.evaluate(() => NAV.map((x) => x.v).join('>'))) === 'home>shelf>shAdd' && (await pg.evaluate(() => SHF)) === null);
  await pg.evaluate(() => ACT.shGo({ dataset: { k: 'shPromo' } })); await sleep(200);
  await pg.evaluate(() => ACT.shPManual()); await sleep(200);
  await pg.fill('form[data-f=shpromo] input[name=n]', 'מבצע מדף'); await pg.fill('form[data-f=shpromo] input[name=tot]', '10');
  await pg.click('form[data-f=shpromo] button.btn:not([type]):not([name])'); await sleep(300);
  if (await pg.evaluate(() => document.getElementById('dlg').open)) { await pg.click('#dlg [data-a=shGoOn]'); await sleep(300); }
  check('6ג מדף רגיל: מבצע נוסף ונשאר במסך "מבצע למדף"', (await pg.evaluate(() => cur().v)) === 'shPromo' && (await pg.evaluate(() => SH.p8.items.some((x) => x && x.n === 'מבצע מדף'))));
  check('6ד אין שגיאות JavaScript', !pg.__errors.length, pg.__errors);
  await A.ctx.close();

  // ---- 7. עסק בלי מודול המדף (הזמנות בלבד) – בלי הכפתורים ----
  S.inv = fresh();
  const cfgO = { mode: 'new', users: { mo: 'biz-x' }, biz: { 'biz-x': { dataRoot: 'b', features: { scan: true, orders: true }, name: 'הזמנות בלבד' } }, admins: { 'b/biz-x/|mo': 1 } };
  const O = await open(browser, www, cfgO, 'mo@x.co', 360);
  await O.page.evaluate(() => go('piEd', 'i3')); await waitFor(O.page, () => document.querySelectorAll('.pil').length === 1); await sleep(200);
  const b7 = await O.page.evaluate(() => ({ p: document.querySelectorAll('[data-a=piPrP],[data-a=piPrS]').length, price: !!document.querySelector('#pil0 input[data-k=price]'), wp: !!document.querySelector('#pil0 input[data-k=wp]') }));
  const o7 = await noOverflow(O.page);
  check('7 עסק עם הזמנות בלבד: "הדפס מחיר" / "הדפס מבצע" מוסתרים (שאר השורה במקום), בלי גלישה', b7.p === 0 && b7.price && b7.wp && o7.sw <= o7.W, { b7, o7 });
  check('7א אין שגיאות JavaScript', !O.page.__errors.length, O.page.__errors);
  await O.ctx.close();

  await browser.close();
  if (out) fs.writeFileSync(out, JSON.stringify({ fail, res }, null, 1));
  console.log(fail ? `נכשלו ${fail}` : 'הכול עבר');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
