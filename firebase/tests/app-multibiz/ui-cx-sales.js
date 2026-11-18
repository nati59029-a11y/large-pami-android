'use strict';
// סנכרון כספית A2/A3 (caspit-sales.js): קליטת דוח מכירות (windows-1255), תצוגה מקדימה, תיקון "לא בטוח", אישור;
// מסך "מכירות כספית": תקופה, סיכומים, מוצרים, קופות, קטגוריות, התאמה מול סגירת קופה, שורות "לא בטוח", מקור הכנסות (מנהל־על).
// רשת מדומה, נתונים מומצאים. שימוש: node ui-cx-sales.js <www-dir> [out.json] [shots-dir]. מסך טלפון קטן (360×740).
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const out = {}; let fail = 0;
const check = (name, ok, info) => { out[name] = { ok: !!ok, info }; if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
// windows-1255 (אותיות עבריות בלבד – מספיק לכותרות ולשמות המומצאים)
const w1255 = (t) => Buffer.from([...t].map((ch) => { const c = ch.codePointAt(0); return c >= 0x5d0 && c <= 0x5ea ? c - 0x5d0 + 0xe0 : c < 128 ? c : 0x3f; }));
const SH = 'תאריך מכירה,שם פריט,מספר ברקוד,מספר עסקה,שם סניף,מספר סניף,משקל,הנחה,פדיון';
const CSV = [SH, '16/11/2026,כוס נייר,400001,9001,סניף בדיקה א,6200,"",0.0,20', '16/11/2026,פריט כללי,1000,9001,סניף בדיקה א,6200,"",0.0,23.6', '16/11/2026,צלחת,400002,9002,סניף בדיקה ב,7700,"",0.0,13', '17/11/2026,כוס נייר,400001,9003,סניף בדיקה א,6200,"",1.7763568394002505e-15,-10'].join('\r\n') + '\r\n';
const PV = { kind: 'sales', br: '_', reg: {}, bks: { 6200: 'סניף בדיקה א', 7700: 'סניף בדיקה ב' }, gone: [],
  cnt: { kind: 'sales', lines: 4, tx: 3, nw: 4, dup: 0, sure: 2, disc: 0, unsure: 1, skip: 1, nolink: 0, ret: 1, gross: 56.6, retA: 10, discA: 0, gone: 0, days: ['2026-11-16', '2026-11-17'] },
  rows: [[0, '2026-11-16', '9001', '400001', 'כוס נייר', 20, 0, '6200', 'sure', 2, 10, ''], [1, '2026-11-16', '9001', '1000', 'פריט כללי', 23.6, 0, '6200', 'skip', null, null, ''], [2, '2026-11-16', '9002', '400002', 'צלחת', 13, 0, '7700', 'unsure', 1, 10, 'frac'], [3, '2026-11-17', '9003', '400001', 'כוס נייר', -10, 0, '6200', 'sure', -1, 10, '']] };
const it = (n, cat, q, r, a, u, sp) => Object.assign({ n, cat, q, r, a, ds: 0, u }, sp ? { sp: true } : {});
const DAYS = [
  { d: '2026-11-16', bk: '6200', bn: 'יהודה הנשיא', gross: 443.6, ret: 0, disc: 0, ntx: 3, nl: 4, sp: 23.6, un: 0, it: { 400001: it('כוס נייר', 'k1', 2, 0, 20, 0), 400003: it('מפית', 'k2', 40, 0, 400, 0), 1000: it('פריט כללי', '', 0, 0, 23.6, 0, 1) } },
  { d: '2026-11-16', bk: '7700', bn: 'נחל לכיש', gross: 13, ret: 0, disc: 0, ntx: 1, nl: 1, sp: 0, un: 1, it: { 400002: it('צלחת', 'k1', 1, 0, 13, 1) } },
  { d: '2026-11-17', bk: '6200', bn: 'יהודה הנשיא', gross: 0, ret: 10, disc: 0, ntx: 1, nl: 1, sp: 0, un: 0, it: { 400001: it('כוס נייר', 'k1', 0, 1, -10, 0) } }];
const SALES = { days: DAYS, cats: { k1: 'כלים', k2: 'נייר' }, cfg: { reg: { 6200: 'i_yh', 7700: 'i_nl' }, inc: 'zc', br: '_', lastSales: { run: 'r', at: Date.UTC(2026, 10, 17, 10) } }, sa: true };
const TX = { tx: [{ id: '6200_20261116_9001', d: '2026-11-16', tx: '9001', bk: '6200', bn: 'יהודה הנשיא', lines: [{ k: 'a', c: '400001', n: 'כוס נייר', a: 20, ds: 0, q: 2, qs: 'sure' }, { k: 'b', c: '1000', n: 'פריט כללי', a: 23.6, ds: 0, q: null, qs: 'skip' }] }] };
const UN = { tx: [{ id: '7700_20261116_9002', d: '2026-11-16', tx: '9002', bk: '7700', bn: 'נחל לכיש', lines: [{ k: '400002|13|0|0', c: '400002', n: 'צלחת', a: 13, ds: 0, q: 1, qs: 'unsure', why: 'frac', P: 10 }] }] };

(async () => {
  const [www, outFile, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const browser = await H.launch();
  const cfg = { mode: 'new', users: { m: 'biz-o' }, biz: { 'biz-o': { dataRoot: 'b', features: ALL, name: 'עסק בדיקה' } }, admins: { 'b/biz-o/|m': 1 }, ctx: { hasTouch: true, isMobile: true } };
  const log = []; const calls = [];
  const { ctx, page } = await H.newPage(browser, www, cfg, log, 'm');
  await ctx.route(/:8080\/.*/, async (route) => {
    const u = new URL(route.request().url());
    if (/:runQuery$/.test(u.pathname)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ readTime: '2026-11-03T09:00:00Z' }]) });
    if (/\/ordcfg\/main$/.test(u.pathname)) return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    return route.fallback();
  });
  await ctx.route(/:5001\/.*/, async (route) => {
    const n = new URL(route.request().url()).pathname.split('/').pop(); let d = {}; try { d = JSON.parse(route.request().postData()).data; } catch (e) { /* */ }
    calls.push({ n, d });
    const R = { cxCfg: { cfg: { skip: ['1000'], last: { run: 'r', at: 1 } }, items: 10, br: '_', sa: false }, cxUpload: { ok: true }, cxPreview: PV,
      cxApply: { done: true, res: { lines: 4, sold: 3, back: 1, unsure: 0, skip: 1, nolink: 0, stock: 3, dup: 0, tx: 3 } }, cxSales: SALES,
      cxLines: d && d.un ? UN : TX, cxFix: { ok: true, q: 2, delta: 1, qs: 'own' }, cxSetCfg: { ok: true, reg: d && d.reg }, getCosts: { cost: {} } };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: R[n] || { ok: true } }) });
  });
  await H.login(page, 'm@x.co');
  await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden) ACT.startBlank(); });
  await H.settle(page, 500);
  await page.setViewportSize({ width: 360, height: 740 });
  const q = () => page.evaluate(() => { const R = document.querySelector('#dlg[open]') || document.querySelector('#main');
    const els = [...R.querySelectorAll('button, a, select, input:not([type=hidden]):not([type=checkbox]):not([type=file])')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    const small = els.filter((e) => { const r = e.getBoundingClientRect(); return r.height < 44 && !e.closest('label.f'); }).map((e) => (e.dataset.a || e.dataset.c || e.tagName) + ':' + Math.round(e.getBoundingClientRect().height));
    return { small, sw: document.documentElement.scrollWidth, iw: innerWidth, text: R.innerText.replace(/[‎‏]/g, ''), dir: getComputedStyle(R).direction }; });
  const shot = async (n) => { if (shots) await page.screenshot({ path: path.join(shots, n + '.png'), fullPage: false }); };
  const goV = (v) => page.evaluate((v) => { NAV = [{ v: 'home' }]; go(v); }, v);
  const fine = (r) => r.small.length === 0 && r.sw <= r.iw && r.dir === 'rtl';
  const close = () => page.evaluate(() => closeDlg());

  // 1. קובץ דוח מכירות ב-windows-1255 → זיהוי, פענוח, שליחה
  await goV('cxSync'); await H.settle(page, 800);
  const s0 = await q();
  check('1 מסך הסנכרון: כפתור "מכירות כספית", והסבר על שני סוגי הקבצים', /מכירות כספית והתאמה לסגירת קופה/.test(s0.text) && /דוח מכירות לפריטים/.test(s0.text) && fine(s0), { small: s0.small });
  await page.setInputFiles('input[data-c=cxFile]', { name: 'sales-items-report.csv', mimeType: 'text/csv', buffer: w1255(CSV) });
  await H.settle(page, 1500);
  const up = calls.filter((x) => x.n === 'cxUpload');
  const l0 = up[0] && up[0].d.lines;
  check('2 windows-1255 מפוענח: 4 שורות, סוג sales, שם סניף בעברית, תאריך ISO, הנחה בכתיב מדעי = 0', up.length === 1 && up[0].d.kind === 'sales' && l0.length === 4 && l0[0].bn === 'סניף בדיקה א' && l0[0].d === '2026-11-16' && l0[3].a === -10 && l0[3].ds === 0 && l0[2].bk === '7700', l0 && l0[0]);
  const p1 = await q(); await shot('cx-11-sales-preview');
  check('3 תצוגה מקדימה: משבצות (חדשות 4, לא בטוח 1, קודים מיוחדים 1, החזרות 1), שדה כמות ל"לא בטוח", אשר/ביטול; מגע ≥44, RTL, בלי גלילה לצד', fine(p1) && /שורות חדשות\s*4/.test(p1.text) && /לא בטוח – לבדיקה\s*1/.test(p1.text) && /קודים מיוחדים\s*1/.test(p1.text) && /החזרות\s*1/.test(p1.text) && /אשר ושמור/.test(p1.text) && (await page.$('input[data-c=cxSQ]')) !== null, { small: p1.small, sw: p1.sw });
  await page.click('[data-a=cxSDl][data-k=skip]'); await H.settle(page, 300);
  const d1 = await q();
  check('4 משבצת "קודים מיוחדים" → השורה: קוד, עסקה, סניף, פדיון, תווית', /קודים מיוחדים \(בלי מלאי\) · 1/.test(d1.text) && /קוד 1000/.test(d1.text) && /עסקה 9001/.test(d1.text) && /סניף בדיקה א/.test(d1.text) && /קוד מיוחד – בלי מלאי/.test(d1.text) && d1.small.length === 0, d1.text.slice(0, 200));
  await close();
  await page.fill('input[data-c=cxSQ]', '2'); await page.dispatchEvent('input[data-c=cxSQ]', 'change'); await H.settle(page, 100);
  await page.click('[data-a=cxSApply]'); await H.settle(page, 300);
  const c1 = await q();
  check('5 חלון אישור: יחידות יורדות 4 (2 + 2 מתוקן), חוזרות 1, לא בטוח 0 אחרי התיקון', /יחידות יורדות מהמלאי\s*4/.test(c1.text) && /חוזרות למלאי \(החזרות\)\s*1/.test(c1.text) && /לא בטוח – יסומנו לבדיקה\s*0/.test(c1.text) && c1.small.length === 0, c1.text.slice(0, 200));
  await page.click('[data-a=cxSGo]'); await H.settle(page, 800);
  const ap = calls.find((x) => x.n === 'cxApply');
  check('6 אישור: נשלחו run והכמות המתוקנת לשורה 2 בלבד', ap && JSON.stringify(ap.d.qty) === '{"2":2}' && ap.d.run === up[0].d.run, ap && ap.d);
  const p2 = await q();
  check('7 מסך סיום: משבצות + "למסך המכירות"', fine(p2) && /המכירות נשמרו/.test(p2.text) && /שורות שנקלטו\s*4/.test(p2.text) && /למסך המכירות/.test(p2.text), { small: p2.small });

  // 8. מסך "מכירות כספית"
  await page.evaluate(() => { S.zc = S.zc || []; S.zc.push({ id: 'zq1', reg: 'i_yh', d: '2026-11-16', tm: '21:00', od: '2026-11-16', otm: '08:00', no: '55', by: 'דנה', at: 1, tx: ['ztx1', 'ztx2'] }, { id: 'zq2', reg: 'i_nl', d: '2026-11-16', tm: '21:05', od: '2026-11-15', no: '56', by: 'רון', at: 1, tx: ['ztx3'] });
    S.tx.push({ id: 'ztx1', t: 'inc', cat: 'i_yh', date: '2026-11-16', amt: 300, note: 'סגירת קופה', pays: [] }, { id: 'ztx2', t: 'inc', cat: 'i_yh', date: '2026-11-16', amt: 143.6, note: 'סגירת קופה', pays: [] }, { id: 'ztx3', t: 'inc', cat: 'i_nl', date: '2026-11-16', amt: 13, note: 'סגירת קופה', pays: [] }); });
  await page.click('[data-a=cxGoSales]'); await H.settle(page, 300);
  await page.click('[data-a=cxYPer][data-k=week]'); await H.settle(page, 800);
  const sc = await q(); await shot('cx-12-sales-screen');
  const per = calls.filter((x) => x.n === 'cxSales').pop();
  check('8 מסך מכירות (שבוע): נטו 446.6, החזרות 10, עסקאות 5, לא בטוח 1; טווח של 7 ימים נשלח; מגע ≥44, RTL, בלי גלילה לצד', fine(sc) && /הכנסה נטו \(אחרי הנחות והחזרות\)\s*446\.60/.test(sc.text) && /עסקאות\s*5/.test(sc.text) && /לא בטוח\s*1/.test(sc.text) && per && (Date.parse(per.d.to) - Date.parse(per.d.from)) / 864e5 === 6, { small: sc.small, sw: sc.sw, per: per && per.d, t: sc.text.slice(0, 300) });
  // טווח חופשי: 16–17.11 (השעון בדפדפן הבדיקה הוא 3.11)
  await page.click('[data-a=cxYPer][data-k=custom]'); await H.settle(page, 200);
  await page.fill('form[data-f=cxYRange] input[name=from]', '2026-11-16'); await page.fill('form[data-f=cxYRange] input[name=to]', '2026-11-17');
  await page.click('form[data-f=cxYRange] button'); await H.settle(page, 600);
  const cu = calls.filter((x) => x.n === 'cxSales').pop();
  check('8ב טווח חופשי נשלח לשרת', cu && cu.d.from === '2026-11-16' && cu.d.to === '2026-11-17', cu && cu.d);
  const names = await page.evaluate(() => [...document.querySelectorAll('#cxypl [data-a=cxYProd] .m > b')].map((b) => b.textContent));
  check('9 "כמה נמכר מכל מוצר": מיון לפי כמות – מפית ראשונה; תווית "לא בטוח" על צלחת', /^מפית/.test(names[0]) && names.some((n) => /צלחת.*לא בטוח/.test(n)), names);
  await page.click('[data-a=cxYSort][data-k=a]'); await H.settle(page, 200);
  await page.fill('input[data-i=cxYQ]', 'כוס'); await page.dispatchEvent('input[data-i=cxYQ]', 'input'); await H.settle(page, 200);
  const hit = await page.evaluate(() => [...document.querySelectorAll('#cxypl [data-a=cxYProd]')].map((b) => b.innerText.replace(/[‎‏]/g, '')));
  check('10 חיפוש "כוס": מוצר אחד, נמכרו 2, הוחזרו 1, פדיון 10', hit.length === 1 && /נמכרו\s+2/.test(hit[0]) && /הוחזרו\s+1/.test(hit[0]) && /10\.00/.test(hit[0]), hit);
  await page.click('#cxypl [data-a=cxYProd]'); await H.settle(page, 300);
  const pd = await q();
  check('11 מוצר → לפי יום (2 ימים) + "כל העסקאות"', /נמכרו/.test(pd.text) && /16\/11\/2026/.test(pd.text) && /17\/11\/2026/.test(pd.text) && /כל העסקאות בתקופה/.test(pd.text) && pd.small.length === 0, { small: pd.small });
  await page.click('#dlg [data-a=cxYPL][data-d="2026-11-16"]'); await H.settle(page, 400);
  const pl = await q(); const lc = calls.filter((x) => x.n === 'cxLines').pop();
  check('12 יום → העסקאות מהשרת (לפי מוצר ויום)', lc && lc.d.c === '400001' && JSON.stringify(lc.d.days) === '["2026-11-16"]' && /עסקה 9001/.test(pl.text) && /כוס נייר/.test(pl.text), lc && lc.d);
  await close();
  await page.click('[data-a=cxYDl][data-k=net]'); await H.settle(page, 300);
  const nd = await q();
  check('13 משבצת "הכנסה נטו" → לפי יום', /הכנסה נטו לפי יום/.test(nd.text) && /456\.60/.test(nd.text) && /-10\.00|10\.00-/.test(nd.text), nd.text.slice(0, 200));
  await page.click('#dlg [data-a=cxYDay][data-d="2026-11-16"]'); await H.settle(page, 500);
  const bds = calls.filter((x) => x.n === 'cxLines').slice(-2).map((x) => x.d.bd);
  check('14 יום → עסקאות שני הסניפים (cxLines לפי יום+סניף)', JSON.stringify(bds.sort()) === '["6200_20261116","7700_20261116"]', bds);
  await close();
  await page.click('[data-a=cxYTab][data-k=reg]'); await H.settle(page, 200);
  const rg = await q();
  check('15 קופות: יהודה הנשיא ונחל לכיש עם נטו', /יהודה הנשיא/.test(rg.text) && /נחל לכיש/.test(rg.text) && /433\.60/.test(rg.text) && /13\.00/.test(rg.text), rg.text.slice(0, 300));
  await page.click('[data-a=cxYTab][data-k=prod]'); await H.settle(page, 200);
  await page.fill('input[data-i=cxYQ]', ''); await page.dispatchEvent('input[data-i=cxYQ]', 'input'); await H.settle(page, 100);
  await page.click('[data-a=cxYTab][data-k=cat]'); await H.settle(page, 200);
  await page.click('[data-a=cxYCat][data-k=k2]'); await H.settle(page, 200);
  const cf = await q();
  check('16 קטגוריה → רשימת המוצרים שלה בלבד', /קטגוריה: נייר/.test(cf.text) && (await page.evaluate(() => document.querySelectorAll('#cxypl [data-a=cxYProd]').length)) === 1, cf.text.slice(0, 200));
  await page.click('[data-a=cxYCatX]'); await H.settle(page, 100);
  // 17. התאמה מול סגירת קופה
  await page.click('[data-a=cxYTab][data-k=rec]'); await H.settle(page, 300);
  const rc = await q(); await page.evaluate(() => { const e = document.querySelector('[data-a=cxYRz]'); if (e) e.closest('.card').scrollIntoView({ block: 'start' }); }); await shot('cx-13-recon');
  check('17 התאמה: יהודה הנשיא 16.11 – תואם (443.60); נחל לכיש – הסגירה נפתחה ביום אחר → לא ניתן להשוות; 17.11 – אין סגירה; מגע ≥44', /✓ תואם/.test(rc.text) && /לא ניתן להשוות – הסגירה נפתחה ביום אחר/.test(rc.text) && /אין סגירת קופה/.test(rc.text) && /443\.60/.test(rc.text) && fine(rc), { small: rc.small, t: rc.text.slice(0, 500) });
  await page.click('[data-a=cxYRz][data-k="2026-11-16|i_yh"]'); await H.settle(page, 300);
  const zd = await q();
  check('18 סכום הסגירה → דוח Z 55 ושורות ההכנסה (300 + 143.60)', /דוח Z 55/.test(zd.text) && /300\.00/.test(zd.text) && /143\.60/.test(zd.text), zd.text.slice(0, 200));
  await close();
  await page.click('[data-a=cxYRc][data-k="2026-11-16|i_yh"]'); await H.settle(page, 400);
  const lr = calls.filter((x) => x.n === 'cxLines').pop();
  check('19 סכום כספית → עסקאות היום של הסניף הממופה', lr && lr.d.bd === '6200_20261116', lr && lr.d);
  await close();
  // 20. שורות "לא בטוח"
  await page.click('[data-a=cxYTab][data-k=un]'); await H.settle(page, 500);
  const un = await q(); await page.evaluate(() => { const e = document.querySelector('form[data-f=cxYFix]'); if (e) e.scrollIntoView({ block: 'center' }); }); await shot('cx-14-unsure');
  check('20 לא בטוח: השורה עם פדיון, מחיר, סיבה ושדה כמות + אישור; מגע ≥44', /צלחת/.test(un.text) && /הפדיון לא מתחלק במחיר/.test(un.text) && /אישור/.test(un.text) && fine(un), { small: un.small });
  await page.fill('form[data-f=cxYFix] input[name=q]', '2');
  await page.click('form[data-f=cxYFix] button'); await H.settle(page, 500);
  const fx = calls.find((x) => x.n === 'cxFix');
  check('21 תיקון: cxFix עם מזהה העסקה, מפתח השורה וכמות 2', fx && fx.d.id === '7700_20261116_9002' && fx.d.k === '400002|13|0|0' && fx.d.q === 2, fx && fx.d);
  const st = await q();
  check('22 מקור ההכנסות (מנהל־על): "סגירת קופה (פעיל)", "דוח מכירות כספית" לא זמין', /מקור ההכנסות \(מנהל־על\)/.test(st.text) && (await page.evaluate(() => { const b = [...document.querySelectorAll('[role=radio]')]; return b.length === 2 && b[1].disabled && /פעיל/.test(b[0].textContent); })), st.text.slice(-300));
  check('23 בלי שגיאות JavaScript', page.__errors.length === 0, page.__errors.slice(0, 3));
  await browser.close();
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
  console.log(fail ? `נכשלו ${fail}` : 'הכול עבר');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
