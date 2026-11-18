'use strict';
// קופה ש6 (POS:M6, 17.11.2026): מסכי הניהול של מוצרים, הוספה מהירה, ספירת מלאי, מדבקות וצילום מחירון – מול רשת מדומה.
// נתונים מומצאים (דוגמה). שימוש: node ui-pos-m6.js <www-dir> [out.json] [shots-dir]
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const out = {}; let fail = 0;
const check = (name, ok, info) => { out[name] = { ok: !!ok, info }; if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const F = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders', 'pos'].map((k) => [k, true]));
const S = (v) => ({ stringValue: v }), N = (v) => (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }), A = (a) => ({ arrayValue: { values: a } }), M = (o) => ({ mapValue: { fields: o } }), B = (v) => ({ booleanValue: v });
const D = (col, id, f) => ({ name: `projects/demo-largpeami/databases/(default)/documents/b/biz-o/${col}/${id}`, fields: f });
const PRODS = [
  D('prod', 'p1', { name: S('צלחות 20 יח׳ (דוגמה)'), price: N(12.9), barcode: S('5901234123457'), sku: S('10001'), cat: S('c_dis'), on: B(true), flags: A([]), q: M({ _: N(5) }) }),
  D('prod', 'p2', { name: S('עוגת שמרים (דוגמה)'), price: N(0), barcode: S('4006381333931'), sku: S('10002'), cat: S('c_bake'), on: B(true), flags: A([S('noPrice')]), q: M({ _: N(0) }) }),
  D('prod', 'p3', { name: S('מוצר מהקופה (דוגמה)'), price: N(5), barcode: S('7290000001029'), on: B(true), flags: A([S('fromPos'), S('missing')]), q: M({}) }),
  D('prod', 'p4', { name: S('מוצר מוסתר (דוגמה)'), price: N(3), barcode: S('96385074'), on: B(false), flags: A([]), q: M({}) }),
];
const CATS = [D('cat', 'c_dis', { name: S('חד פעמי'), ord: N(1) }), D('cat', 'c_bake', { name: S('מאפים'), ord: N(2) })];
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function open(browser, www, who, calls) {
  const cfg = { mode: 'new', users: { m: 'biz-o', w: 'biz-o' }, biz: { 'biz-o': { dataRoot: 'b', features: F, name: 'עסק בדיקה' } }, admins: { 'b/biz-o/|m': 1 }, staff: { 'b/biz-o/|w': 1 } };
  const log = [];
  const { ctx, page } = await H.newPage(browser, www, cfg, log, 'm6' + who);
  page.on('pageerror', (e) => log.push('pageerror: ' + e.message));
  await ctx.route(/:8080\/.*/, async (route) => {
    const u = new URL(route.request().url());
    const J = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (route.request().method() === 'GET' && /\/documents\/b\/biz-o\/prod$/.test(u.pathname)) return J({ documents: PRODS });
    if (route.request().method() === 'GET' && /\/documents\/b\/biz-o\/cat$/.test(u.pathname)) return J({ documents: CATS });
    if (route.request().method() === 'GET' && /\/documents\/b\/biz-o\/posdev$/.test(u.pathname)) return J({ documents: [] });
    if (/\/prod\/p1\/p\/cost$/.test(u.pathname)) return J({ name: 'x', fields: { cost: N(7.5) } });
    return route.fallback();
  });
  const cnt = { st: 'open', c: {}, appr: 0 };
  await ctx.route(/:5001\/.*/, async (route) => {
    const n = new URL(route.request().url()).pathname.split('/').pop(); let d = {}; try { d = JSON.parse(route.request().postData()).data; } catch (e) { /* */ }
    calls.push({ n, d });
    let R = { ok: true };
    if (n === 'posCfg') R = { ok: true, type: 'bakeryDisposable', cfg: {}, src: {}, defs: {}, types: [], who: 'mgr' };
    else if (n === 'posAlert') R = { ok: true, items: d.op === 'list' ? [{ id: 'a1', k: 'newProd', pid: 'p3', name: 'מוצר מהקופה (דוגמה)', st: 'open', at: 1 }] : [] };
    else if (n === 'posProdSave') R = { ok: true, id: d.id || 'pNew', sku: d.sku || '10005', barcode: d.barcode || (d.autoBc ? '2000000000015' : ''), flags: [], priceChanged: !!d.id && d.price !== 12.9 };
    else if (n === 'posPriceBulk') R = { ok: true, dry: d.dry !== false, n: 1, items: [{ id: 'p1', name: 'צלחות', old: 12.9, new: 14.19 }] };
    else if (n === 'posLbl') R = d.op === 'list' ? { ok: true, items: [{ id: 'l1', pid: 'p1', n: 2, kind: 'lbl', why: 'price', name: 'צלחות 20 יח׳ (דוגמה)', price: 12.9, barcode: '5901234123457' }] } : { ok: true, n: (d.items || []).length };
    else if (n === 'posProdQuick') R = { ok: true, id: 'pq', sku: '10009', name: d.name, price: d.price, created: true };
    else if (n === 'posCnt') {
      if (d.op === 'list') R = { ok: true, items: [] };
      else if (d.op === 'open') { R = { ok: true, id: 'k1', n: 3 }; }
      else if (d.op === 'get') R = { ok: true, cnt: { id: 'k1', name: 'ספירה מלאה', br: '_', scope: 'all', st: cnt.st, at: 1 }, lines: [{ pid: 'p1', name: 'צלחות', bc: '5901234123457', sys: 5, now: 5, cnt: cnt.c.p1 }, { pid: 'p2', name: 'עוגה', bc: '4006381333931', sys: 0, now: 0 }] };
      else if (d.op === 'add') { R = { ok: true, items: d.items.map((x) => { cnt.c[x.pid] = x.set ? x.n : (cnt.c[x.pid] || 0) + x.n; return { pid: x.pid, cnt: cnt.c[x.pid] }; }) }; }
      else if (d.op === 'submit') { cnt.st = 'review'; R = { ok: true, st: 'review' }; }
      else if (d.op === 'approve') { cnt.appr++; R = { ok: true, applied: 1, left: cnt.appr === 1 ? 1 : 0, st: cnt.appr === 1 ? 'apply' : 'done' }; if (cnt.appr > 1) cnt.st = 'done'; }
    } else if (n === 'posOcr') R = { ok: true, n: 2, rows: [{ name: 'צלחות (דוגמה)', price: 12.9, bc: '5901234123457' }, { name: 'מפיות (דוגמה)', price: null, bc: '' }] };
    else if (n === 'posImpList') R = { ok: true, list: [], cats: [] };
    else if (n === 'getCosts') R = { cost: {} };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: R }) });
  });
  await H.login(page, who + '@x.co');
  await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden && ACT.startBlank) ACT.startBlank(); });
  await page.setViewportSize({ width: 360, height: 740 });
  return { ctx, page, log };
}

(async () => {
  const [www, outFile, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const shot = async (page, n) => { if (shots) await page.screenshot({ path: path.join(shots, n + '.png'), fullPage: true }); };
  const browser = await H.launch();
  const view = async (page, v) => { await page.evaluate((a) => go(a), v); await H.settle(page, 900); await page.evaluate((a) => go(a), v); await H.settle(page, 500);
    return page.evaluate(() => { const m = document.getElementById('main'); return { t: m.innerText, ov: document.documentElement.scrollWidth - innerWidth }; }); };
  const dlgT = (page) => page.evaluate(() => { const d = document.querySelector('#dlg'); return d && d.open ? d.innerText : ''; });
  const since = (calls, n0, name) => calls.slice(n0).filter((c) => c.n === name);

  { const calls = []; const { ctx, page, log } = await open(browser, www, 'm', calls);
    const adm = await view(page, 'posAdm');
    check('m 1 ניהול קופה: מרכז "מוצרים ומלאי" – מוצרים, ייבוא מכספיט, ספירת מלאי, מדבקות', /מוצרים ומלאי/.test(adm.t) && /ספירת מלאי/.test(adm.t) && /מדבקות ושלטי מדף/.test(adm.t) && /ייבוא מכספיט/.test(adm.t), adm.t.slice(0, 200));
    const pl = await view(page, 'posProds'); await shot(page, 'm-01-מוצרים');
    check('m 2 מוצרים: רשימה, התראה "נוצרו בקופה", מסננים עם ספירה, מוסתר לא ברשימה הראשית, 360px בלי גלילה לרוחב',
      /צלחות 20/.test(pl.t) && /1 מוצרים נוצרו בקופה/.test(pl.t) && /חסר מחיר \(1\)/.test(pl.t) && /נוצר בקופה \(1\)/.test(pl.t) && /מוסתרים \(1\)/.test(pl.t) && !/מוצר מוסתר/.test(pl.t) && pl.ov <= 0, { t: pl.t.slice(0, 300), ov: pl.ov });
    await page.fill('#pmQ', '3931'); await H.settle(page, 700);
    const s4 = await page.evaluate(() => document.getElementById('main').innerText);
    check('m 3 חיפוש ב-4 ספרות אחרונות של ברקוד', /עוגת שמרים/.test(s4) && !/צלחות 20/.test(s4), s4.slice(0, 200));
    await page.fill('#pmQ', ''); await H.settle(page, 600);
    await page.click('[data-a=pmEd][data-id=p1]'); await H.settle(page, 600);
    const ed = await page.evaluate(() => { const f = document.querySelector('#dlg form[data-f=pmSave]'); return f ? { name: f.elements.name.value, cost: f.elements.cost.value, cat: f.elements.cat.value } : null; });
    check('m 4 עריכה: הטופס מלא (שם, עלות מ-p/cost, קטגוריה)', ed && ed.name === 'צלחות 20 יח׳ (דוגמה)' && ed.cost === '7.5' && ed.cat === 'c_dis', ed);
    let n0 = calls.length;
    await page.fill('#dlg [name=price]', '13.9'); await page.click('#dlg form[data-f=pmSave] button:not([type=button])'); await H.settle(page, 900);
    const sv = since(calls, n0, 'posProdSave')[0];
    const askT = await dlgT(page);
    check('m 5 שמירה: posProdSave עם id, מחיר, עלות וקטגוריה; אחרי שינוי מחיר – הצעה להוסיף מדבקה לתור', sv && sv.d.id === 'p1' && sv.d.price === 13.9 && sv.d.cost === 7.5 && sv.d.cat === 'c_dis' && /מדבקת מחיר/.test(askT), { d: sv && sv.d, askT: askT.slice(0, 80) });
    n0 = calls.length; await page.click('#dlg [data-a=yes]'); await H.settle(page, 600);
    check('m 6 "כן" – posLbl add (why price)', since(calls, n0, 'posLbl').some((c) => c.d.op === 'add' && c.d.why === 'price'), since(calls, n0, 'posLbl').map((c) => c.d));
    await view(page, 'posProds');
    await page.click('[data-a=pmNew]'); await H.settle(page, 400);
    await page.fill('#dlg [name=name]', 'מוצר חדש (דוגמה)'); await page.fill('#dlg [name=price]', '9.9'); await page.selectOption('#dlg [name=cat]', 'c_bake'); await page.fill('#dlg [name=cost]', '4');
    n0 = calls.length; await page.click('#dlg form[data-f=pmSave] button:not([type=button])'); await H.settle(page, 900);
    const nw = since(calls, n0, 'posProdSave')[0];
    check('m 7 מוצר חדש: autoBc (בלי ברקוד), בלי id, ומדבקה למוצר חדש נוספת לתור', nw && !nw.d.id && nw.d.autoBc === true && nw.d.barcode === '' && since(calls, n0, 'posLbl').some((c) => c.d.why === 'new'), nw && nw.d);
    await page.evaluate(() => closeDlg());
    await view(page, 'posProds'); await page.click('[data-a=pmBulk]'); await H.settle(page, 300);
    await page.fill('#dlg [name=val]', '10'); n0 = calls.length; await page.click('#dlg form[data-f=pmBulkF] button:not([type=button])'); await H.settle(page, 700);
    const pv = await dlgT(page);
    await page.click('#dlg [data-a=pmBulkGo]'); await H.settle(page, 900);
    const bk = since(calls, n0, 'posPriceBulk');
    check('m 8 שינוי מחירים: תצוגה מקדימה (dry) ואז אישור (dry:false), אותו מקור', bk.length === 2 && bk[0].d.dry === true && bk[1].d.dry === false && bk[0].d.mode === 'pct' && bk[0].d.val === 10 && Array.isArray(bk[0].d.pids) && /14\.19/.test(pv), { n: bk.length, pv: pv.slice(0, 120) });
    await page.evaluate(() => closeDlg());
    // הוספה מהירה (נקראת ממסך המכירה – ש1)
    await page.evaluate(() => { window.__q = null; PosProdQuick.open('5901234123457', { onDone: (p) => { window.__q = p; } }); }); await H.settle(page, 300);
    await page.fill('#dlg [name=name]', 'חדש מהקופה'); await page.fill('#dlg [name=price]', '7');
    n0 = calls.length; await page.click('#dlg form[data-f=pqF] button:not([type=button])'); await H.settle(page, 700);
    const q = since(calls, n0, 'posProdQuick')[0]; const got = await page.evaluate(() => window.__q);
    const bad = await page.evaluate(() => PosProdQuick.open('5901234123458'));
    check('m 9 הוספה מהירה: reqId, ברקוד, שם, מחיר → onDone עם המוצר; ברקוד עם ספרת ביקורת שגויה – לא נפתח', q && /^q[0-9a-f]{24}$/.test(q.d.reqId) && q.d.bc === '5901234123457' && q.d.price === 7 && got && got.id === 'pq' && bad === false, { d: q && q.d, got });
    // ספירה
    await view(page, 'posCnt');
    n0 = calls.length; await page.click('form[data-f=pcOpen] button'); await H.settle(page, 1200);
    const run = await page.evaluate(() => document.getElementById('main').innerText);
    check('m 10 ספירה חדשה: posCnt open (all) ← מסך הספירה', since(calls, n0, 'posCnt').some((c) => c.d.op === 'open' && c.d.scope === 'all') && /סרקו מוצרים/.test(run), run.slice(0, 120));
    n0 = calls.length;
    for (let k = 0; k < 2; k++) { for (const ch of '5901234123457') await page.keyboard.press(ch, { delay: 0 }); await page.keyboard.press('Enter'); await H.settle(page, 80); }
    for (const ch of '0000000000000') await page.keyboard.press(ch, { delay: 0 }); await page.keyboard.press('Enter');
    await H.settle(page, 2200); await shot(page, 'm-02-ספירה');
    const ad = since(calls, n0, 'posCnt').filter((c) => c.d.op === 'add');
    const rt = await page.evaluate(() => document.getElementById('main').innerText);
    check('m 11 סריקה בסורק (מקלדת): 2 סריקות = +2 באותה שורה, נשלח במנה; ברקוד לא מוכר – לא נספר', ad.length >= 1 && ad.reduce((a, c) => a + c.d.items.filter((x) => x.pid === 'p1').reduce((s, x) => s + x.n, 0), 0) === 2 && !ad.some((c) => c.d.items.some((x) => x.pid !== 'p1')) && /צלחות 20 יח׳ \(דוגמה\) · 2/.test(rt), { ad: ad.map((c) => c.d.items), rt: rt.slice(0, 160) });
    await page.evaluate(() => closeDlg());
    n0 = calls.length; await page.click('[data-a=pcSubmit]'); await H.settle(page, 300); await page.click('#dlg [data-a=yes]'); await H.settle(page, 1500);
    const rv = await page.evaluate(() => document.getElementById('main').innerText);
    check('m 12 "סיימתי" → submit → דוח פערים (נספר 2 מול 5 = ‎-3), אחד לא נספר', since(calls, n0, 'posCnt').some((c) => c.d.op === 'submit') && /-3/.test(rv) && /1 לא נספרו/.test(rv), rv.slice(0, 200));
    n0 = calls.length; await page.click('[data-a=pcAppr]'); await H.settle(page, 300); await page.click('#dlg [data-a=yes]'); await H.settle(page, 1500);
    check('m 13 אישור מנהל: approve עד left=0 (2 קריאות)', since(calls, n0, 'posCnt').filter((c) => c.d.op === 'approve').length === 2, since(calls, n0, 'posCnt').map((c) => c.d.op));
    // מדבקות
    const lb = await view(page, 'posLbls'); await shot(page, 'm-03-מדבקות');
    await page.evaluate(() => { window.__open = 0; window.open = () => { window.__open++; return null; }; });
    n0 = calls.length; await page.click('[data-a=lbPrint][data-k=lbl]'); await H.settle(page, 1500);
    const pd = await dlgT(page); const opened = await page.evaluate(() => window.__open);
    const pages = await page.evaluate(() => PosLabels.sheets([{ name: 'א', price: 1, barcode: '5901234123457', n: 30 }], 'lbl').length);
    await page.click('#dlg [data-a=lbDone]'); await H.settle(page, 600);
    check('m 14 מדבקות: תור, PDF נפתח, "הודפס" → posLbl done; 30 מדבקות = 2 דפים של 24', /צלחות 20/.test(lb.t) && opened === 1 && /ההדפסה נשלחה/.test(pd) && pages === 2 && since(calls, n0, 'posLbl').some((c) => c.d.op === 'done' && c.d.ids[0] === 'l1'), { opened, pages, pd: pd.slice(0, 60) });
    // צילום מחירון
    const ip = await page.evaluate(() => { go('posImp'); return 1; }); void ip; await H.settle(page, 900);
    const hasOcr = await page.evaluate(() => !!document.querySelector('[data-c=ocrFile]'));
    n0 = calls.length;
    if (hasOcr) { await page.setInputFiles('[data-c=ocrFile]', { name: 'list.png', mimeType: 'image/png', buffer: PNG }); await H.settle(page, 1500); }
    const om = await page.evaluate(() => [...document.querySelectorAll('#dlg form[data-f=piMapF] select[name^=m]')].map((s) => s.value));
    const oc = since(calls, n0, 'posOcr')[0];
    check('m 15 צילום מחירון: התמונה מוקטנת ל-JPEG ונשלחת ל-posOcr; השורות עוברות להתאמת העמודות של הייבוא (שם / מחיר / ברקוד); לא נוצר כלום',
      hasOcr && oc && oc.d.mime === 'image/jpeg' && oc.d.b64.length > 50 && JSON.stringify(om) === JSON.stringify(['name', 'price', 'barcode']) && !since(calls, n0, 'posImport').length, { hasOcr, om });
    const errs = log.filter((x) => /pageerror|TypeError|ReferenceError/.test(x));
    check('m 16 בלי שגיאות JS', errs.length === 0, errs.slice(0, 3));
    await ctx.close(); }

  { const calls = []; const { ctx, page, log } = await open(browser, www, 'w', calls);
    const v = await view(page, 'posProds'); const c = await view(page, 'posCnt');
    check('w 1 עובד בלי posMgr: מוצרים – "למנהל בלבד", ספירה – אין הרשאה, בלי קריאות לשרת', /למנהל בלבד/.test(v.t) && /לאחראי משמרת ולמנהל/.test(c.t) && !calls.some((x) => /^pos(Prod|Cnt|Alert|Lbl)/.test(x.n)), { v: v.t.slice(0, 60), c: c.t.slice(0, 60) });
    const errs = log.filter((x) => /pageerror|TypeError|ReferenceError/.test(x));
    check('w 2 בלי שגיאות JS', errs.length === 0, errs.slice(0, 3));
    await ctx.close(); }

  await browser.close();
  if (outFile) fs.writeFileSync(outFile, JSON.stringify({ out }, null, 1));
  console.log(fail ? `תוצאה: נכשל (${fail})` : 'תוצאה: הכול עבר'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
