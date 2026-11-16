'use strict';
// חשבוניות לתמחור – כפתורי "שינוי ספק" ו"מחק" ברשימה (16.11.2026). רשת מדומה כמו ui-pi-ed.js (שממנו הועתק השרת המדומה, עם piVoid).
// שימוש: node ui-pi-list-act.js <www-dir> [out.json] [shots-dir]
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
  for (const fn of ['piClaim', 'piBeat', 'piRelease', 'piDraft', 'piFinish', 'piVoid']) await ctx.route('**/' + fn, async (route) => {
    let b = {}; try { b = JSON.parse(route.request().postData()).data || {}; } catch (e) { /* */ }
    const uid = uidOf(route) || me; const d = S.inv[b.id]; const now = T0;
    S.calls.push({ fn, uid, b });
    if (!d) return err(route, 'no-pinv', 'החשבונית לא נמצאה');
    if (fn === 'piRelease') { if (d.st === 'new' && d.lk && d.lk.uid === uid) { delete d.lk; return ok(route, { ok: true, rel: true }); } return ok(route, { ok: true, rel: false }); }
    if (d.st !== 'new') return err(route, 'closed', 'החשבונית כבר טופלה');
    if (fn === 'piVoid') { if (fresh30(d.lk, now) && d.lk.uid !== uid) return err(route, 'locked', 'החשבונית בטיפול של ' + d.lk.name); d.st = 'void'; delete d.lk; return ok(route, { ok: true, dup: false }); }
    if (fn === 'piClaim') {
      if (fresh30(d.lk, now) && d.lk.uid !== uid) return err(route, 'locked', 'החשבונית בטיפול של ' + d.lk.name);
      d.lk = { uid, name: NAMES[uid] || uid, t: now };
      return ok(route, { ok: true, id: b.id, inv: { st: d.st, sup: d.sup, inv: d.inv, date: d.date, by: d.by, byName: d.byName, at: d.at, np: d.np, lines: JSON.parse(JSON.stringify(d.lines)) }, rev: d.rev || 0, lk: d.lk, until: now + 30 * 60e3, vat: 18, ord: S.ord, m: matches(b.id, d.lines) });
    }
    if (!(d.lk && d.lk.uid === uid)) return fresh30(d.lk, now) ? err(route, 'locked', 'החשבונית בטיפול של ' + d.lk.name) : err(route, 'not-locked', 'צריך להיכנס לחשבונית מחדש');
    if (fn === 'piBeat') { d.lk.t = now; return ok(route, { ok: true }); }
    if ((fn === 'piDraft' || fn === 'piFinish') && b.rev !== (d.rev || 0)) { S.calls.push({ fn: 'conflict', uid, b }); return err(route, 'conflict', 'עובד אחר ערך את החשבונית בינתיים – צריך לטעון אותה מחדש'); }
    if (fn === 'piDraft') { d.lines = b.lines; if (b.sup !== undefined) d.sup = b.sup; if (b.supId !== undefined) d.supId = b.supId; d.rev = (d.rev || 0) + 1; return ok(route, { ok: true, rev: d.rev }); }
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


const rows = (page) => page.evaluate(() => [...document.querySelectorAll('.pi-it')].map((d) => ({ t: d.querySelector('.pi-row').innerText.replace(/\s+/g, ' ').trim(), sup: !!d.querySelector('[data-a="piSup"]'), del: !!d.querySelector('[data-a="piDel"]') })));
const addSubs = (page) => page.evaluate(() => { S.cats.push({ id: 'cS9', name: 'ספקי בדיקה', beh: 'sup' }); S.subs.push({ id: 's1', name: 'אסם בע"מ', cat: 'cS9' }, { id: 's2', name: 'שטראוס בדיקה', cat: 'cS9' }, { id: 's3', name: 'תנובה בדיקה', cat: 'cS9' }); });
(async () => {
  const [www, out, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const browser = await H.launch();
  const cfg = { mode: 'new', users: { m: 'biz-o', w: 'biz-o' }, biz: { 'biz-o': { dataRoot: 'b', features: ALL, name: 'עסק בדיקה' } }, admins: { 'b/biz-o/|m': 1 }, staff: { 'b/biz-o/|w': 1 } };
  const A = await open(browser, www, cfg, 'm@x.co', 360);
  const errs = []; A.page.on('pageerror', (e) => errs.push(String(e)));
  await addSubs(A.page);
  await A.page.evaluate(() => go('pi'));
  await waitFor(A.page, () => document.querySelectorAll('.pi-row').length > 0); await sleep(400);
  const r1 = await rows(A.page);
  check('1 מנהל: "שינוי ספק" ו"מחק" מתחת לכל חשבונית; לא בחשבונית שבטיפול של אחר', r1.length === 3 && r1[0].sup && r1[0].del && r1[2].sup && r1[2].del && !r1[1].sup && !r1[1].del, r1);
  check('1א 360px – בלי גלישה אופקית', await noOverflow(A.page).then((r) => r.sw <= r.W && !r.bad.length), await noOverflow(A.page));
  if (shots) await A.page.screenshot({ path: path.join(shots, 'רשימה-כפתורים-360.png'), fullPage: true });
  // שינוי ספק
  await A.page.click('[data-a="piSup"]'); await sleep(300);
  const d1 = await A.page.evaluate(() => ({ open: document.getElementById('dlg').open, n: document.querySelectorAll('#piSl .li').length }));
  await A.page.fill('input[data-i="piSupQ"]', 'תנובה'); await sleep(200);
  const d2 = await A.page.evaluate(() => [...document.querySelectorAll('#piSl .li')].map((b) => b.innerText.trim()));
  check('2 חלון בחירת ספק נפתח, והחיפוש מסנן', d1.open && d1.n >= 3 && d2.length === 1 && d2[0] === 'תנובה בדיקה', { d1, d2 });
  if (shots) await A.page.screenshot({ path: path.join(shots, 'בחירת-ספק-360.png') });
  const l0 = JSON.stringify(S.inv.i3.lines);
  await A.page.click('#piSl .li'); await waitFor(A.page, () => /תנובה בדיקה/.test(document.querySelector('.pi-row').innerText)); await sleep(500);
  const dr = calls('piDraft').pop();
  check('2א הספק נשמר (piDraft עם sup + supId, אותן שורות), הנעילה שוחררה, והרשימה מציגה את הספק החדש', S.inv.i3.sup === 'תנובה בדיקה' && S.inv.i3.supId === 's3' && JSON.stringify(S.inv.i3.lines) === l0 && !S.inv.i3.lk && calls('piRelease').length >= 1 && dr && dr.b.rev === 0, { sup: S.inv.i3.sup, lk: S.inv.i3.lk, dr: dr && dr.b });
  // מחק – ביטול ואז אישור
  const n0 = calls('piVoid').length;
  await A.page.click('.pi-it:nth-child(3) [data-a="piDel"]'); await sleep(200);
  const q = await A.page.evaluate(() => document.querySelector('#dlg h3').innerText);
  await A.page.click('#dlg [data-a="closeDlg"]'); await sleep(200);
  check('3 "מחק" שואל לפני מחיקה, וביטול לא מוחק', /למחוק את החשבונית של אסם/.test(q) && calls('piVoid').length === n0 && S.inv.i1.st === 'new', q);
  await A.page.click('.pi-it:nth-child(3) [data-a="piDel"]'); await sleep(200);
  await A.page.click('#dlg [data-a="yes"]'); await waitFor(A.page, () => document.querySelectorAll('.pi-it').length === 2); await sleep(400);
  const r3 = await rows(A.page);
  check('3א אישור – piVoid, והחשבונית יוצאת מהרשימה', S.inv.i1.st === 'void' && r3.length === 2 && !r3.some((r) => /אסם/.test(r.t)), r3);
  check('3ב אין שגיאות JavaScript (מנהל)', !errs.length, errs);
  // עובד עם prc: שינוי ספק כן, מחק לא
  S.inv = fresh();
  const W = await open(browser, www, cfg, 'w@x.co', 412, { prc: true });
  await W.page.evaluate(() => go('pi'));
  await waitFor(W.page, () => document.querySelectorAll('.pi-row').length > 0); await sleep(400);
  const rw = await rows(W.page);
  check('4 עובד עם הרשאת תמחור: "שינוי ספק" בלבד, בלי "מחק"', rw.length === 3 && rw[0].sup && !rw.some((r) => r.del), rw);
  if (out) fs.writeFileSync(out, JSON.stringify(res, null, 1));
  console.log(fail ? `נכשלו ${fail}` : 'הכול עבר');
  await browser.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
