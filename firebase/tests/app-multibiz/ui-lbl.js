'use strict';
// מדבקות שלב 1 (24.11.2026, lbl-print.js + orders-staff.js): "מוצר חדש במלאי" מהמדבקה, "עריכת מוצר", לוגו וחותמת כשרות – מול רשת מדומה.
// נתונים מומצאים (דוגמה). שימוש: node ui-lbl.js <www-dir> [out.json] [shots-dir]
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const out = {}; let fail = 0;
const check = (name, ok, info) => { out[name] = { ok: !!ok, info }; if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const F = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
const S = (v) => ({ stringValue: v }), N = (v) => (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }), M = (o) => ({ mapValue: { fields: o } }), B = (v) => ({ booleanValue: v });
const PFX = 'projects/demo-largpeami/databases/(default)/documents/b/biz-o/';
const D = (id, f) => ({ document: { name: PFX + 'prod/' + id, fields: f } });
const NEWBC = '7290000000999';
const ST = { prods: [D('p1', { name: S('צלחות 20 יח׳ (דוגמה)'), price: N(12.9), barcode: S('5901234123457'), on: B(true), q: M({ _: N(5) }) })], cfg: null, patches: [] };

async function open(browser, www, who, calls) {
  const cfg = { mode: 'new', users: { m: 'biz-o', w: 'biz-o' }, biz: { 'biz-o': { dataRoot: 'b', features: F, name: 'עסק בדיקה' } }, admins: { 'b/biz-o/|m': 1 }, staff: { 'b/biz-o/|w': { perms: { lbl: true } } }, ctx: { deviceScaleFactor: 1 } };
  const log = [];
  const { ctx, page } = await H.newPage(browser, www, cfg, log, 'lbl' + who);
  page.on('pageerror', (e) => log.push('pageerror: ' + e.message));
  await ctx.route(/:8080\/.*/, async (route) => {
    const req = route.request(), u = new URL(req.url()), m = req.method();
    const J = (b, st) => route.fulfill({ status: st || 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (/:runQuery$/.test(u.pathname)) { let c = ''; try { c = JSON.parse(req.postData()).structuredQuery.from[0].collectionId; } catch (e) { /* */ }
      return J(c === 'prod' ? ST.prods : []); }
    if (/\/ordcfg\/main$/.test(u.pathname)) return J({ error: { code: 404, message: 'NOT_FOUND' } }, 404);
    if (/\/cfg\/lbl$/.test(u.pathname)) {
      if (m === 'GET') return ST.cfg ? J({ name: PFX + 'cfg/lbl', fields: ST.cfg }) : J({ error: { code: 404, message: 'NOT_FOUND' } }, 404);
      if (m === 'PATCH') { const f = JSON.parse(req.postData()).fields; ST.patches.push({ url: u.href, f, who }); ST.cfg = Object.assign({}, ST.cfg || {}, f); return J({ name: PFX + 'cfg/lbl', fields: ST.cfg }); }
    }
    return route.fallback();
  });
  await ctx.route(/:5001\/.*/, async (route) => {
    const n = new URL(route.request().url()).pathname.split('/').pop(); let d = {}; try { d = JSON.parse(route.request().postData()).data; } catch (e) { /* */ }
    calls.push({ n, d });
    let R = { ok: true };
    if (n === 'saveProduct') {
      if (d.id) { const x = ST.prods.find((p) => p.document.name.endsWith('/' + d.id)); if (x) Object.assign(x.document.fields, { name: S(d.name), price: N(d.price), barcode: S(d.barcode || '') }); R = { ok: true, id: d.id }; }
      else { ST.prods.push(D('pNew', { name: S(d.name), price: N(d.price), barcode: S(d.barcode || ''), on: B(true), q: M({}) })); R = { ok: true, id: 'pNew' }; }
    } else if (n === 'getCosts') R = { cost: {} };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: R }) });
  });
  await page.addInitScript(() => { window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; }; });
  await H.login(page, who + '@x.co');
  await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden && ACT.startBlank) ACT.startBlank(); });
  await page.setViewportSize({ width: 360, height: 740 });
  return { ctx, page, log };
}

(async () => {
  const [www, outFile, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const browser = await H.launch();
  const mainT = (page) => page.evaluate(() => document.getElementById('main').innerText);
  const dlgOpen = (page) => page.evaluate(() => { const d = document.querySelector('#dlg'); return !!(d && d.open); });
  const goLbl = async (page) => { await page.evaluate(() => go('lbl')); await H.settle(page, 1500); };
  const search = async (page, q) => { await page.fill('#main [data-i=lblQ]', q); await page.press('#main [data-i=lblQ]', 'Enter'); await H.settle(page, 500); };
  const submitPF = async (page) => { await page.evaluate(() => document.querySelector('#dlg form[data-f=oxPF]').requestSubmit()); await H.settle(page, 1500); };
  const val = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.value : null; }, sel);

  { const calls = []; const { ctx, page, log } = await open(browser, www, 'm', calls);
    await goLbl(page);
    await search(page, NEWBC);
    const t1 = await mainT(page);
    const hasNew = await page.evaluate(() => !!document.querySelector('#main [data-a=lblNewInv]') && !!document.querySelector('#main form[data-f=lblNew]'));
    check('m 1 ברקוד לא קיים: "מוצר חדש במלאי" (ראשי) וגם מדבקה למוצר ידני', hasNew && /מוצר חדש במלאי/.test(t1) && /מדבקה למוצר ידני/.test(t1), t1.slice(0, 200));
    await page.click('#main [data-a=lblNewInv]'); await H.settle(page, 800);
    const pf = await page.evaluate(() => { const f = document.querySelector('#dlg form[data-f=oxPF]'); return f ? { bc: f.elements.barcode.value, id: !!f.elements.id, qty: !!f.elements.qty, cost: !!f.elements.cost } : null; });
    check('m 2 נפתח טופס המוצר המלא של המלאי (כמות פתיחה, עלות), הברקוד ממולא', pf && pf.bc === NEWBC && !pf.id && pf.qty && pf.cost, pf);
    await page.fill('#dlg [name=name]', 'מוצר חדש (דוגמה)'); await page.fill('#dlg [name=price]', '9.9');
    let n0 = calls.length; await submitPF(page);
    const sv = calls.slice(n0).find((c) => c.n === 'saveProduct');
    const ed = { name: await val(page, '#main #lblEd [data-k=name]'), price: await val(page, '#main #lblEd [data-k=price]'), code: await val(page, '#main #lblEd [data-k=code]'), dlg: await dlgOpen(page) };
    check('m 3 שמירה: saveProduct (שם, מחיר, ברקוד) → המוצר נבחר למדבקה', sv && sv.d.name === 'מוצר חדש (דוגמה)' && sv.d.price === 9.9 && sv.d.barcode === NEWBC && !sv.d.id && ed.name === 'מוצר חדש (דוגמה)' && ed.price === '9.9' && ed.code === NEWBC && !ed.dlg, { d: sv && sv.d, ed });
    // עריכת מוצר: מחיר מתעדכן, מילה מודגשת נשמרת
    await page.fill('#main #lblEd [data-k=hl]', 'חדש!');
    const hasEd = await page.evaluate(() => !!document.querySelector('#main [data-a=lblEditP]'));
    await page.click('#main [data-a=lblEditP]'); await H.settle(page, 800);
    const eid = await val(page, '#dlg form[data-f=oxPF] [name=id]');
    await page.fill('#dlg [name=price]', '11.5');
    n0 = calls.length; await submitPF(page);
    const sv2 = calls.slice(n0).find((c) => c.n === 'saveProduct');
    const ed2 = { price: await val(page, '#main #lblEd [data-k=price]'), hl: await val(page, '#main #lblEd [data-k=hl]') };
    check('m 4 "עריכת מוצר": טופס עריכה של אותו מוצר → המחיר במדבקה מתעדכן, המילה המודגשת נשמרת', hasEd && eid === 'pNew' && sv2 && sv2.d.id === 'pNew' && sv2.d.price === 11.5 && ed2.price === '11.5' && ed2.hl === 'חדש!', { eid, d: sv2 && sv2.d, ed2 });
    // מוצר ידני – המסלול הישן נשאר
    await search(page, 'מוצר שלא קיים');
    const man = await page.evaluate(() => !!document.querySelector('#main form[data-f=lblNew]'));
    check('m 5 המסלול הידני (lblNew) עדיין קיים', man);
    await page.evaluate(() => ACT.lblNfX()); await H.settle(page, 200);
    // הגדרות לוגו וכשרות (מנהל)
    const pngs = await page.evaluate(() => { const mk = (w, h, f) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); f(g); return c.toDataURL('image/png').split(',')[1]; };
      return { logo: mk(360, 120, (g) => { g.fillStyle = '#e8d9a0'; g.fillRect(0, 0, 360, 120); g.fillStyle = '#7a1f1f'; g.font = 'bold 72px Arial'; g.textBaseline = 'middle'; g.fillText('LOGO', 40, 62); g.fillStyle = '#787878'; g.fillRect(40, 100, 280, 10); }),
        stamp: mk(200, 200, (g) => { g.strokeStyle = '#123'; g.lineWidth = 14; g.beginPath(); g.arc(100, 100, 86, 0, 7); g.stroke(); g.fillStyle = '#123'; g.font = 'bold 60px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('כשר', 100, 104); }) }; });
    const row0 = await page.evaluate(() => ({ set: !!document.querySelector('#main [data-a=lblBSet]'), on: !!document.querySelector('#main [data-c=lblBOn]') }));
    await page.click('#main [data-a=lblBSet]'); await H.settle(page, 400);
    await page.setInputFiles('#dlg input[data-c=lblBUp][data-k=logo]', { name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from(pngs.logo, 'base64') }); await H.settle(page, 600);
    await page.setInputFiles('#dlg input[data-c=lblBUp][data-k=stamp]', { name: 'stamp.png', mimeType: 'image/png', buffer: Buffer.from(pngs.stamp, 'base64') }); await H.settle(page, 600);
    const s0 = await page.evaluate(() => document.getElementById('lblBI-logo') && document.getElementById('lblBI-logo').src);
    await page.evaluate(() => { const r = document.querySelector('#dlg input[data-i=lblBThr][data-k=logo]'); r.value = '200'; r.dispatchEvent(new Event('input', { bubbles: true })); }); await H.settle(page, 300);
    const s1 = await page.evaluate(() => document.getElementById('lblBI-logo') && document.getElementById('lblBI-logo').src);
    const dl = await page.evaluate(() => ({ cv: document.querySelectorAll('#dlg canvas[data-lbl-d]').length, sl: document.querySelectorAll('#dlg input[data-i=lblBThr]').length, t: document.getElementById('dlg').innerText }));
    if (shots) await page.screenshot({ path: path.join(shots, 'm-settings.png') });
    check('m 6 חלון ההגדרות: העלאה, תמונה בשחור-לבן, סרגל בהירות משנה את התמונה, דוגמה בשתי הפריסות', row0.set && !row0.on && /^data:image\/png;base64,/.test(s0 || '') && s1 !== s0 && dl.cv === 2 && dl.sl === 2 && /פריסה כברירת מחדל/.test(dl.t), { row0, cv: dl.cv, sl: dl.sl, ch: s1 !== s0 });
    await page.selectOption('#dlg select[data-c=lblBDLay]', 'bot');
    await page.click('#dlg [data-a=lblBSave]'); await H.settle(page, 800);
    const p = ST.patches[ST.patches.length - 1];
    const mask = p ? new URL(p.url).searchParams.getAll('updateMask.fieldPaths').sort() : [];
    check('m 7 שמירה: PATCH ל-cfg/lbl עם updateMask (logo, stamp, lay, on, at, by), PNG עד 40,000 תווים, lay=bot', p && JSON.stringify(mask) === JSON.stringify(['at', 'by', 'lay', 'logo', 'on', 'stamp']) && /^data:image\/png;base64,/.test(p.f.logo.stringValue) && p.f.logo.stringValue.length <= 40000 && /^data:image\/png;base64,/.test(p.f.stamp.stringValue) && p.f.lay.stringValue === 'bot' && p.f.on.booleanValue === true && p.f.by.stringValue === 'm' && !(await dlgOpen(page)), { mask, lay: p && p.f.lay, len: p && p.f.logo.stringValue.length });
    const row1 = await page.evaluate(() => { const c = document.querySelector('#main [data-c=lblBOn]'), s = document.querySelector('#main [data-c=lblBLay]'); return { on: !!(c && c.checked), lay: s && s.value }; });
    check('m 8 שורת "לוגו וכשרות" מעל הסל: מסומן, פריסת ברירת המחדל (בפינות למטה)', row1.on && row1.lay === 'bot', row1);
    // צילומי 5 תבניות × 2 פריסות – כפי שיודפס (סף שחור-לבן כמו ב-PDF), גודל אמיתי 591×295
    const IT = { name: 'עוגת שמרים שוקולד (דוגמה)', price: '24.9', code: '5901234123457', fs: 100, hl: 'חדש!', pp: '19.9', pack: '500 גרם' };
    const geo = {};
    for (const lay of ['top', 'bot']) for (let t = 1; t <= 5; t++) {
      const g = await page.evaluate(async ([lay, t, it]) => { const b = Object.assign({}, LblPrint.brand(), { lay }); await LblPrint.ensureImgs(b);
        let c = document.getElementById('__shot'); if (!c) { c = document.createElement('canvas'); c.id = '__shot'; c.width = 591; c.height = 295; c.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;background:#fff'; document.body.appendChild(c); }
        const x = c.getContext('2d'); const rects = LblPrint.draw(x, t, it, { rects: [], brand: b });
        const d = x.getImageData(0, 0, 591, 295); for (let i = 0; i < d.data.length; i += 4) { const v = (d.data[i] * 299 + d.data[i + 1] * 587 + d.data[i + 2] * 114) / 1000 >= 150 ? 255 : 0; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; } x.putImageData(d, 0, 0);
        x.fillStyle = '#000'; rects.forEach((r) => x.fillRect(r[0], r[1], r[2], r[3]));
        const L = LblPrint.layBox(lay), inside = rects.every((r) => r[0] >= 0 && r[1] >= 0 && r[0] + r[2] <= 591 && r[1] + r[3] <= 295);
        const hit = L.t ? rects.some((r) => r[1] < 64) : rects.some((r) => [L.logo, L.stamp].some((q) => r[0] < q[0] + q[2] && r[0] + r[2] > q[0] && r[1] < q[1] + q[3] && r[1] + r[3] > q[1]));
        return { n: rects.length, inside, hit }; }, [lay, t, IT]);
      geo[lay + t] = g;
      if (shots) await page.locator('#__shot').screenshot({ path: path.join(shots, `tpl${t}-${lay}.png`) });
    }
    await page.evaluate(() => { const c = document.getElementById('__shot'); if (c) c.remove(); });
    check('m 9 5 תבניות × 2 פריסות: פסי הברקוד בתוך המדבקה ולא על הלוגו / החותמת (תבניות 2, 4 – בלי ברקוד)', Object.entries(geo).every(([k, g]) => g.inside && !g.hit && (/[24]$/.test(k) ? g.n === 0 : g.n > 0)), geo);
    // הדפסה = תצוגה: ה-PDF שנשלח בנוי עם אותו brand; בלי לוגו – זהה ל-build בלי brand
    // הדפסה = תצוגה: "הדפס" שולח ישר (בלי סל). מסלול ה-PDF (טלפון/דפדפן נייד) – בנוי עם אותו brand; בלי לוגו – זהה ל-build בלי brand
    const pdfEq = async () => { await search(page, '5901234123457');
      await page.evaluate(() => { window.__opened = []; Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Linux; Android 13) Mobile', configurable: true }); });
      await page.click('#main [data-a=lblAdd]'); await H.settle(page, 1200);
      const r = await page.evaluate(async () => { delete navigator.userAgent; const u = window.__opened.pop(); if (!u) return null; const a = new Uint8Array(await (await fetch(u)).arrayBuffer()); const L = LblPrint.last;
        const eq = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]); const b = LblPrint.brand();
        return { brand: !!b, lay: b && b.lay, withB: b ? eq(a, await LblPrint.build(L, b)) : null, noB: eq(a, await LblPrint.build(L, null)) }; });
      return r; };
    const q1 = await pdfEq();
    await page.selectOption('#main select[data-c=lblBLay]', 'top'); await H.settle(page, 400);
    const q2 = await pdfEq();
    await page.click('#main [data-c=lblBOn]'); await H.settle(page, 400);
    const q3 = await pdfEq();
    check('m 10 PDF: עם לוגו (bot ואז top לכל ההדפסה) – בדיוק build עם אותו brand ושונה מבלי; כיבוי – זהה לבלי לוגו', q1 && q1.brand && q1.lay === 'bot' && q1.withB && !q1.noB && q2 && q2.lay === 'top' && q2.withB && !q2.noB && q3 && !q3.brand && q3.noB, { q1, q2, q3 });
    await search(page, '5901234123457'); const noBk = await page.evaluate(() => !/סל ההדפסה|הוסף לסל/.test(document.getElementById('main').innerText) && !document.querySelector('#main [data-a=lblPrint]') && document.querySelector('#main [data-a=lblAdd]').innerText.trim());
    await page.evaluate(() => { window.__opened = []; }); await page.click('#main [data-a=lblQn][data-v="10"]'); await page.click('#main [data-a=lblAdd]'); await H.settle(page, 1500);
    const dk = await page.evaluate(() => { const f = document.getElementById('lblPf'), D = f && f.contentDocument, im = D ? [...D.images] : [];
      return { f: !!f, n: D ? D.querySelectorAll('.p').length : 0, u: new Set(im.map((x) => x.src)).size, w: im[0] && im[0].naturalWidth, h: im[0] && im[0].naturalHeight, css: D ? D.querySelector('style').textContent.match(/@page\{[^}]*\}/)[0] : '',
        opened: window.__opened.length, dlg: !!document.querySelector('#dlg[open]'), toast: [...document.querySelectorAll('.toast')].map((e) => e.textContent).join(' | '), cur: !document.getElementById('lblEd'), rows: LblPrint.last.length, n0: LblPrint.last[0].n }; });
    check('m 10b מחשב: "הדפס" מדפיס ישר (בלי סל, בלי לשונית חדשה, בלי חלון אישור) – 10 עמודים בגודל 50×25 מ"מ, תמונה אחת 591×295', noBk === 'הדפס' && dk.f && dk.n === 10 && dk.u === 1 && dk.w === 591 && dk.h === 295 && /size:50\.00mm 25\.00mm;margin:0/.test(dk.css) && !dk.opened && !dk.dlg && /נשלח להדפסה \(10 מדבקות\)/.test(dk.toast) && dk.cur && dk.rows === 1 && dk.n0 === 10, { noBk, dk });
    await page.evaluate(() => go('home')); await H.settle(page, 1500); await goLbl(page);
    const row2 = await page.evaluate(() => { const c = document.querySelector('#main [data-c=lblBOn]'), s = document.querySelector('#main [data-c=lblBLay]'); return { on: !!(c && c.checked), lay: s && s.value }; });
    check('m 11 כניסה חדשה למסך – הבחירה חוזרת לברירת המחדל של העסק', row2.on && row2.lay === 'bot', row2);
    const errs = log.filter((x) => /pageerror|TypeError|ReferenceError/.test(x));
    check('m 12 בלי שגיאות JS', errs.length === 0, errs.slice(0, 3));
    await ctx.close(); }

  { const calls = []; const { ctx, page, log } = await open(browser, www, 'w', calls);
    await goLbl(page);
    await search(page, '7290000000888');
    const w1 = await page.evaluate(() => ({ inv: !!document.querySelector('#main [data-a=lblNewInv]'), man: !!document.querySelector('#main form[data-f=lblNew]'), set: !!document.querySelector('#main [data-a=lblBSet]'), on: !!document.querySelector('#main [data-c=lblBOn]') }));
    check('w 1 עובד עם "מדבקות" בלי "הזמנות": אין "מוצר חדש במלאי", יש מוצר ידני; הלוגו של העסק מופיע; אין הגדרות', !w1.inv && w1.man && w1.on && !w1.set, w1);
    await page.fill('#main form[data-f=lblNew] [name=name]', 'מוצר ידני (דוגמה)'); await page.fill('#main form[data-f=lblNew] [name=price]', '5');
    await page.evaluate(() => document.querySelector('#main form[data-f=lblNew]').requestSubmit()); await H.settle(page, 800);
    const w2 = await val(page, '#main #lblEd [data-k=name]');
    const ed = await page.evaluate(() => !!document.querySelector('#main [data-a=lblEditP]'));
    check('w 2 מוצר ידני נשמר ונבחר; אין "עריכת מוצר" למוצר ידני', w2 === 'מוצר ידני (דוגמה)' && !ed, { w2, ed });
    const n0 = ST.patches.length; await page.evaluate(() => ACT.lblBSet()); await H.settle(page, 300);
    check('w 3 עובד: חלון ההגדרות לא נפתח ואין כתיבה ל-cfg/lbl', !(await dlgOpen(page)) && ST.patches.length === n0 && !calls.some((c) => c.n === 'saveProduct'));
    const errs = log.filter((x) => /pageerror|TypeError|ReferenceError/.test(x));
    check('w 4 בלי שגיאות JS', errs.length === 0, errs.slice(0, 3));
    await ctx.close(); }

  await browser.close();
  if (outFile) fs.writeFileSync(outFile, JSON.stringify({ out }, null, 1));
  console.log(fail ? `תוצאה: נכשל (${fail})` : 'תוצאה: הכול עבר'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
