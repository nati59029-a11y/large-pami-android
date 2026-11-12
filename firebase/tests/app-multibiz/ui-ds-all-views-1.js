'use strict';
// עיצוב מחדש D5-1 (כספים והזמנות): כל מסך × 3 ערכות. בלי שגיאת קונסול/JS, בלי גלילה אופקית ב-360, ניגודיות טקסט ≥4.5,
// בלי אימוג׳י כאייקון ובלי צבע hex קבוע חדש בבלוק DS:D5-1. רשת מדומה (לא צריך אמולטור).
// שימוש: node ui-ds-all-views-1.js <www-dir> [out.json] [shots-dir]
// MUTATE=contrast – באג מכוון: ב-DS:D5-1 צבע טקסט מושתק נהיה בהיר מדי → בדיקת הניגודיות נכשלת.
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const out = {}; let fail = 0;
const check = (name, ok, info) => { out[name] = { ok: !!ok, info }; if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 600) : '')); };
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
const S = (v) => ({ stringValue: v }), N = (v) => (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }), M = (o) => ({ mapValue: { fields: o } }), A = (a) => ({ arrayValue: { values: a } });
const doc = (p, f) => ({ document: { name: 'projects/demo-largpeami/databases/(default)/documents/b/biz-o/' + p, fields: f } });
const T1 = Date.UTC(2026, 10, 3, 8, 0, 0);
const ORD = [doc('ord/o1', { no: N(12), br: S('br1'), status: S('new'), total: N(34.5), at: N(T1), byName: S('דנה'), cust: M({ name: S('משה כהן'), phone: S('0501234567'), addr: S('הרצל 1') }), items: A([M({ pid: S('pA'), n: S('עוגת שוקולד'), qty: N(2), price: N(12) }), M({ pid: S('pB'), n: S('לחם מחמצת'), qty: N(1), price: N(10.5) })]) }),
  doc('ord/o2', { no: N(11), br: S('br2'), status: S('paid'), total: N(80), at: N(T1 - 9e6), cust: M({ name: S('רחל'), phone: S('0521112222') }), items: A([M({ n: S('מגש אירוח'), qty: N(1), price: N(80) })]) })];
const PROD = [doc('prod/pA', { name: S('עוגת שוקולד'), price: N(12), barcode: S('7290001'), on: { booleanValue: true }, q: M({ br1: N(5), br2: N(1) }) }),
  doc('prod/pB', { name: S('לחם מחמצת'), price: N(10.5), on: { booleanValue: true }, q: M({ br1: N(0), br2: N(8) }) })];
const ORG = M({ v: N(1), branches: A([M({ id: S('br1'), name: S('נחל לכיש'), on: { booleanValue: true } }), M({ id: S('br2'), name: S('יהודה הנשיא'), on: { booleanValue: true } })]) });
const CUST = [doc('cust/c1', { name: S('משה כהן'), phone: S('0501234567'), addr: S('הרצל 1'), at: N(T1) })];

const BR = `(() => {
  const P = (s) => { const m = /rgba?\\(([^)]+)\\)/.exec(s); if (!m) return [0,0,0,0]; const a = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [a[0],a[1],a[2],a.length>3?a[3]:1]; };
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); }; const L = (c) => 0.2126*lin(c[0])+0.7152*lin(c[1])+0.0722*lin(c[2]);
  const bgOf = (el) => { const layers = []; for (let e = el; e; e = e.parentElement) { const c = P(getComputedStyle(e).backgroundColor); if (c[3] > 0) layers.push(c); if (c[3] >= 1) break; } let acc = [255,255,255]; const d = document.createElement('i'); d.style.color = getComputedStyle(document.documentElement).getPropertyValue('--bg'); document.body.appendChild(d); const bg = P(getComputedStyle(d).color); d.remove(); if (!layers.length || layers[layers.length-1][3] < 1) acc = bg.slice(0,3); for (let i = layers.length-1; i >= 0; i--) { const c = layers[i]; acc = [0,1,2].map((k) => c[k]*c[3]+acc[k]*(1-c[3])); } return acc; };
  window.__cr = (el) => { const f = P(getComputedStyle(el).color), b = bgOf(el); const fg = [0,1,2].map((k) => f[k]*f[3]+b[k]*(1-f[3])); const x = L(fg), y = L(b); return Math.round((Math.max(x,y)+0.05)/(Math.min(x,y)+0.05)*100)/100; };
  const emo = /[\\u{1F300}-\\u{1FAFF}\\u2600-\\u27BF\\u2B50]/u;
  window.__q = (root) => { const R = document.querySelector(root); if (!R) return null;
    const txt = [...R.querySelectorAll('*')].filter((e) => { if (e.closest('svg,[hidden],script,style')) return false; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); if (!(r.width > 0 && r.height > 0) || cs.visibility === 'hidden' || cs.opacity === '0') return false; if (e.disabled || e.closest('[disabled],:disabled')) return false; return [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1); });
    const crs = txt.map((e) => [__cr(e), (e.textContent||'').trim().slice(0,22), e.tagName.toLowerCase() + (e.className ? '.' + String(e.className).split(' ')[0] : '')]).sort((a,b) => a[0]-b[0]);
    const text = R.innerText; return { minCr: crs[0] || null, low: crs.filter((c) => c[0] < 4.5).slice(0, 3), sw: document.documentElement.scrollWidth, iw: innerWidth, bw: document.body.scrollWidth, emoji: [...text].filter((c) => emo.test(c) && c !== '\\u2713' && c !== '\\u2717').join(''), text: text.slice(0, 400), n: txt.length }; }; })()`;

(async () => {
  const [www, outFile, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  let src = www;
  if (process.env.MUTATE === 'contrast') {
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'dsv-')); fs.cpSync(www, tmp, { recursive: true });
    const f = path.join(tmp, 'index.html'); const s = fs.readFileSync(f, 'utf8'); const t = s.replace('/* DS:D5-1 */', '/* DS:D5-1 */\nhtml[data-ds] #main .note,html[data-ds] #main small{color:#cfcfcf!important}\nhtml[data-ds=b] #main .note,html[data-ds=c] #main .note,html[data-ds=b] #main small,html[data-ds=c] #main small{color:#c8c8c8!important}');
    if (s === t) throw new Error('mutation target not found'); fs.writeFileSync(f, t); src = tmp;
  }
  const browser = await H.launch();
  const cfg = { mode: 'new', users: { m: 'biz-o' }, biz: { 'biz-o': { dataRoot: 'b', features: ALL, name: 'עסק בדיקה' } }, admins: { 'b/biz-o/|m': 1 }, ctx: { hasTouch: true, isMobile: true } };
  const { ctx, page } = await H.newPage(browser, src, cfg, [], 'm');
  const cons = []; page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) cons.push(m.text().slice(0, 200)); });
  await ctx.route(/:8080\/.*/, async (route) => {
    const req = route.request(); const u = new URL(req.url()); const body = req.postData() || '';
    if (/:runQuery$/.test(u.pathname)) { let c = ''; try { c = JSON.parse(body).structuredQuery.from[0].collectionId; } catch (e) { /* */ }
      const r = c === 'ord' ? ORD : c === 'prod' ? PROD : c === 'cust' ? CUST : [{ readTime: '2026-11-03T09:00:00Z' }];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(r) }); }
    if (/\/documents\/b\/biz-o$/.test(u.pathname) && req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ name: 'x', fields: { dataRoot: S('b'), status: S('active'), name: S('עסק בדיקה'), features: M(Object.fromEntries(Object.keys(ALL).map((k) => [k, { booleanValue: true }]))), org: ORG, brand: M({ name: S('עסק בדיקה') }) } }) });
    return route.fallback();
  });
  await ctx.route(/:5001\/.*/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { ok: true } }) }));
  await H.login(page, 'm@x.co');
  await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden) ACT.startBlank(); });
  await H.settle(page, 500);
  await page.setViewportSize({ width: 390, height: 844 });
  // נתונים: הדגמה פנימית של האפליקציה (sample) + ספק קיזוז, חיובי אשראי, ממתינים לסיווג, דף בנק
  const ids = await page.evaluate(() => {
    sample(); const sup = S.subs.find((s) => s.cat === 'e_sup'); const inc = S.subs.find((s) => s.cat === 'i_nl' || s.cat === 'i_yh');
    S.subs.push({ id: 'offA', cat: 'e_sup', name: 'ספק קיזוז', offset: true });
    S.tx.push({ id: 'pd1', t: 'exp', cat: 'p_exp', date: '2026-11-02', amt: 150, note: '', desc: 'תנועה ישנה' });
    const cc = S.subs.find((s) => s.cat === 'e_cc') || (() => { const x = { id: 'ccA', cat: 'e_cc', name: 'ויזה 1234', ext: { last4: '1234' } }; S.subs.push(x); return x; })();
    S.ccx.push({ id: 'cx1', sub: cc.id, date: '2026-11-03', desc: 'חיוב לדוגמה', amt: 320, match: '', exp: '' });
    S.stm = [{ id: 'stm1', acc: (S.subs.find((s) => s.cat === 'e_bank') || { id: 'x' }).id, src: 'manual', n: 2, from: '2026-10-01', to: '2026-10-31', at: Date.now() }];
    save(); NAV = [{ v: 'home' }]; render(0);
    return { sup: sup && sup.id, supCat: sup && sup.cat, inc: inc && inc.id, incCat: inc && inc.cat, cc: cc.id, loan: S.loans[0] && S.loans[0].id, fixCat: (S.cats.find((c) => c.beh === 'fix') || {}).id, supBeh: (S.cats.find((c) => c.id === (sup && sup.cat)) || {}).beh };
  });
  console.log('ids', JSON.stringify(ids));
  await page.evaluate(BR);
  const setDs = (t) => page.evaluate((t) => { SY.biz = Object.assign({}, SY.biz, { brand: { name: 'עסק בדיקה', colors: {}, theme: t, base: 'dark-gold' } }); BZK = '~'; bzSkin(); }, t);
  const shot = async (n) => { if (shots) await page.screenshot({ path: path.join(shots, n + '.png'), fullPage: false }); };
  const goV = (v, a) => page.evaluate(([v, a]) => { closeDlg(); try { sheetClose(); } catch (e) { /* */ } NAV = [{ v: 'home' }]; if (v === 'rep') RS = scopeOf('all:exp'); go(v, a); }, [v, a]);
  const views = [
    ['inc', () => goV('inc')], ['cat', () => goV('cat', ids.supCat)], ['card', () => goV('card', ids.sup)], ['ledger', () => goV('ledger', ids.sup)],
    ['todo', () => goV('todo')], ['cash', () => goV('cash')], ['tdn', () => goV('tdn')], ['tr', () => goV('tr')], ['fix', () => goV('fix')], ['loans', () => goV('loans')],
    ['cc', () => goV('cc')], ['pend', () => goV('pend')], ['ownMv', () => goV('ownMv')], ['rep', () => goV('rep')], ['imp', () => goV('imp')], ['cmp', () => goV('cmp')],
    ['cf', () => goV('cf')], ['rec', () => goV('rec')], ['recStm', () => goV('recStm', 'stm1')], ['offSup', () => goV('offSup', 'offA')], ['wk', () => goV('wk')],
    ['ox', () => goV('ox')], ['oxNew', () => goV('oxNew')], ['oxOrd', () => goV('oxOrd', 'o1')], ['oxStock', () => goV('oxStock')], ['oxCfg', () => goV('oxCfg')], ['oxXfer', () => goV('oxXfer')],
    ['oxImp', () => goV('oxImp')], ['oxLines', () => goV('oxLines')], ['ocList', () => goV('ocList')], ['ocCard', () => goV('ocCard', 'c1')],
  ];
  const overlays = [
    ['payDlg', 'dlg', () => page.evaluate(() => { closeDlg(); const t = S.tx.find((x) => x.t === 'exp' && x.kind === 'inv' && bal(x) > 0.01); NAV = [{ v: 'home' }]; go('ledger', t.sub); payDlg(t.id); }), '#dlg'],
    ['dlg', 'dlg', () => page.evaluate(() => { closeDlg(); NAV = [{ v: 'home' }]; render(0); dlg('<h3>כותרת חלון</h3><p class="note">הערה קטנה לבדיקה.</p><div class="row"><button class="btn grow">אישור</button><button class="btn g grow">ביטול</button></div>'); }), '#dlg'],
    ['sheet', 'sheet', () => page.evaluate(() => { closeDlg(); NAV = [{ v: 'home' }]; render(0); openAdd(); }), '#sheet'],
  ];
  const res = {}; const t0 = Date.now();
  for (const t of ['a', 'b', 'c']) {
    await setDs(t);
    for (const [name, open] of views) {
      const e0 = page.__errors.length; await page.setViewportSize({ width: 390, height: 844 });
      await open(); await H.settle(page, 350); await page.evaluate(BR);
      if (/^ox|^oc/.test(name)) await H.settle(page, 500);
      await page.setViewportSize({ width: 360, height: 700 }); await H.settle(page, 120);
      const r = await page.evaluate(() => __q('#main')); await page.setViewportSize({ width: 390, height: 844 }); await H.settle(page, 80);
      r.err = page.__errors.length - e0; (res[name] = res[name] || {})[t] = r;
      if (t === 'a' || ['inc', 'ledger', 'todo', 'loans', 'ox'].includes(name)) await shot(`${name}-${t}-390`);
    }
    for (const [name, , open, root] of overlays) {
      const e0 = page.__errors.length; await page.setViewportSize({ width: 390, height: 844 }); await open(); await H.settle(page, 350); await page.evaluate(BR);
      await page.setViewportSize({ width: 360, height: 700 }); await H.settle(page, 120);
      const r = await page.evaluate((rt) => __q(rt), root); await page.setViewportSize({ width: 390, height: 844 }); await H.settle(page, 80);
      if (r) { r.err = page.__errors.length - e0; (res[name] = res[name] || {})[t] = r; }
      if (t === 'a' || name === 'payDlg') await shot(`${name}-${t}-390`);
      await page.evaluate(() => { closeDlg(); try { sheetClose(); } catch (e) { /* */ } });
    }
    // הודעה קופצת
    await page.evaluate(() => { closeDlg(); toast('הפעולה בוצעה בהצלחה'); }); await H.settle(page, 150);
    const tr = await page.evaluate(() => { const e = document.querySelector('.toast'); return e ? { cr: __cr(e), t: e.textContent } : null; });
    (res.toast = res.toast || {})[t] = tr; if (t === 'a') await shot('toast-a-390');
  }
  const names = Object.keys(res).filter((n) => n !== 'toast');
  const sum = (f) => Object.fromEntries(names.map((n) => [n, f(res[n])]).filter(([, v]) => v !== undefined));
  const bad = (f) => names.filter((n) => ['a', 'b', 'c'].some((t) => res[n][t] && f(res[n][t])));
  check('1 כל המסכים נפתחים בשלוש הערכות (לא ריקים)', names.length >= 33 && names.every((n) => ['a', 'b', 'c'].every((t) => res[n][t] && (res[n][t].text.trim().length > 0))), { n: names.length, empty: names.filter((n) => ['a', 'b', 'c'].some((t) => !res[n][t] || (res[n][t].text || '').trim().length === 0)) });
  check('2 בלי שגיאות JS ובלי שגיאות קונסול', page.__errors.length === 0 && cons.length === 0, { js: page.__errors.slice(0, 5), cons: cons.slice(0, 5) });
  const hs = bad((r) => r.sw === undefined ? false : (r.sw > r.iw || r.bw > r.iw));
  check('3 בלי גלילה אופקית ב-360 (כל מסך × 3 ערכות)', hs.length === 0, hs.map((n) => [n, res[n].a.sw, res[n].a.iw]));
  const lowCr = bad((r) => r.minCr && r.minCr[0] < 4.5);
  check('4 ניגודיות טקסט ≥4.5 (כל מסך × 3 ערכות)', lowCr.length === 0, lowCr.map((n) => [n, ['a', 'b', 'c'].map((t) => res[n][t].low[0])]));
  const emo = bad((r) => r.emoji);
  check('5 בלי אימוג׳י כאייקון בתוכן המסכים', emo.length === 0, emo.map((n) => [n, res[n].a.emoji + res[n].b.emoji]));
  const tt = Object.values(res.toast).every((x) => x && x.cr >= 4.5);
  check('6 הודעה קופצת: ניגודיות ≥4.5', tt, sum((r) => r.a && r.a.cr).toast);
  // CSS: בלי hex קבוע בבלוק DS:D5-1
  const html = fs.readFileSync(path.join(src, 'index.html'), 'utf8');
  const i0 = html.indexOf('/* DS:D5-1 */'); const blk = i0 < 0 ? '' : html.slice(i0, html.indexOf('</style>', i0));
  const hexes = [...blk.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
  check('7 בלוק DS:D5-1 קיים ובלי צבע hex קבוע', i0 > 0 && hexes.length === 0, { len: blk.length, hexes: hexes.slice(0, 10) });
  console.log('זמן', Math.round((Date.now() - t0) / 1000) + 's');
  await browser.close();
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
  console.log(fail ? 'תוצאה: ' + fail + ' נכשלו' : 'תוצאה: הכול עבר');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
