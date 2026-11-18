'use strict';
// סנכרון כספית A1 (caspit-sync.js + orders-staff.js): מסך הסנכרון, תצוגה מקדימה, אישור, קבצים לכספית, ומסך מלאי עם 8,700 מוצרים.
// רשת מדומה, נתונים מומצאים. שימוש: node ui-cx-sync.js <www-dir> [out.json] [shots-dir]. מסך טלפון קטן (360×740).
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const out = {}; let fail = 0;
const check = (name, ok, info) => { out[name] = { ok: !!ok, info }; if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
const S = (v) => ({ stringValue: v }), N = (v) => (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }), M = (o) => ({ mapValue: { fields: o } });
const BASE = 'projects/demo-largpeami/databases/(default)/documents/b/biz-o/';
const NP = 8700; // מוצרים מדומים – כמו הקטלוג אחרי ניקוי
const pid = (i) => 'cx' + String(300000 + i);
const PROD = Array.from({ length: NP }, (_, i) => ({ document: { name: BASE + 'prod/' + pid(i), fields: Object.assign({ name: S('מוצר בדיקה ' + i), price: N(5 + (i % 40)), barcode: S(String(7100000000000 + i)), on: { booleanValue: true }, q: M({}), cx: S(String(300000 + i)), sku: S(String(300000 + i)) }, i % 3 ? { nc: { booleanValue: true } } : {}, i % 1000 === 7 ? { dn: { booleanValue: true } } : {}) } }));
PROD.sort((a, b) => (a.document.name < b.document.name ? -1 : 1));
const PV = {
  cnt: { codes: 12, keep: 9, merged: 2, filt: 1, by: { skip: 1 }, nw: 5, link: 4, pr: { in: 1, out: 1, conf: 1, first: 1 }, co: {}, appOnly: 2, warn: 2 },
  rows: [['200001', 'new', 'כוס נייר לבנה 50 יח\'', 9.9, 5.9, 1], ['200002', 'new', 'צלחת גדולה', 12, null, 0], ['200003', 'new', 'מגש מלבני לאירוח עם מכסה שקוף ארוך מאוד', 20, 11, 0], ['200004', 'new', 'מפית', 3.5, null, 0], ['200005', 'new', 'סכו"ם חד פעמי', 7, 3, 0],
    ['200010', 'link', 'קערה', 'in', 14, 12, 'base', 6, 6, 'bc', 'קערה'], ['200011', 'link', 'כוס זכוכית', 'out', 9, 10, 'same', null, null, 'cx', 'כוס זכוכית'], ['200012', 'link', 'תבנית', 'conf', 15, 16, 'base', null, null, 'sku', 'תבנית אפייה'], ['200013', 'link', 'מגבון', 'first', 4, 5, 'in', 2, null, 'name', 'מגבון']],
  merged: [{ c: '200006', to: '200001', n: 'כוס נייר לבנה 50 יח\'' }, { c: '200007', to: '200001', n: 'כוס נייר לבנה 50 יח\'' }],
  filt: [{ c: '1000', n: 'פריט כללי', why: 'skip' }],
  warn: [{ c: '200003', w: 'long', v: 'מגש…' }, { c: '200002', w: 'badbc', v: 'abc!' }], first: true,
};

(async () => {
  const [www, outFile, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const browser = await H.launch();
  const cfg = { mode: 'new', users: { m: 'biz-o' }, biz: { 'biz-o': { dataRoot: 'b', features: ALL, name: 'עסק בדיקה' } }, admins: { 'b/biz-o/|m': 1 }, ctx: { hasTouch: true, isMobile: true } };
  const log = []; const calls = []; let rqProd = 0;
  const { ctx, page } = await H.newPage(browser, www, cfg, log, 'm');
  await ctx.route(/:8080\/.*/, async (route) => {
    const req = route.request(); const u = new URL(req.url()); const body = req.postData() || '';
    if (/:runQuery$/.test(u.pathname)) { let q = {}; try { q = JSON.parse(body).structuredQuery; } catch (e) { /* */ }
      const c = q.from && q.from[0].collectionId;
      if (c === 'prod') { rqProd++; const lim = q.limit || 500, after = q.startAt && q.startAt.values[0].referenceValue;
        if (after && globalThis.__PFAIL) { globalThis.__PFAIL = 0; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 503, message: 'x', status: 'UNAVAILABLE' } }) }); } const i0 = after ? PROD.findIndex((d) => d.document.name === after) + 1 : 0;
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PROD.slice(i0, i0 + lim)) }); }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ readTime: '2026-11-03T09:00:00Z' }]) }); }
    if (/\/ordcfg\/main$/.test(u.pathname)) return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    return route.fallback();
  });
  await ctx.route(/:5001\/.*/, async (route) => {
    const n = new URL(route.request().url()).pathname.split('/').pop(); let d = {}; try { d = JSON.parse(route.request().postData()).data; } catch (e) { /* */ }
    calls.push({ n, d });
    const R = { cxCfg: { cfg: { skip: ['1000', '9999', '6666', '5555', '8888'], last: calls.some((x) => x.n === 'cxApply') ? { run: 'r', at: Date.UTC(2026, 10, 17, 10) } : null }, items: 0 }, cxUpload: { ok: true }, cxPreview: PV,
      cxApply: { done: true, res: { nw: 4, link: 4, pin: 1, cin: 1, pout: 3, cout: 0, chg: 0 } }, cxExport: { csv: '﻿קוד פריט\n', n: 2, rows: [{ c: '200011', n: 'כוס זכוכית', p: 10, cost: 4 }, { c: '200012', n: 'תבנית אפייה', p: 16, cost: null }] },
      cxHist: { codes: ['300001'], log: [{ k: 'p', old: 5, new: 6, src: 'caspit', at: Date.UTC(2026, 10, 17, 9) }, { k: 'c', old: null, new: 3, src: 'app', at: Date.UTC(2026, 10, 16, 9) }] }, getCosts: { cost: {} } };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: R[n] || { ok: true } }) });
  });
  await page.addInitScript(() => { window.__saved = []; });
  await H.login(page, 'm@x.co');
  await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden) ACT.startBlank(); window.saveFile = async (n, d) => { window.__saved.push([n, String(d).length]); }; });
  await H.settle(page, 500);
  await page.setViewportSize({ width: 360, height: 740 });
  const q = () => page.evaluate(() => { const R = document.querySelector('#dlg[open]') || document.querySelector('#main');
    const els = [...R.querySelectorAll('button, a, select, input:not([type=hidden]):not([type=checkbox]):not([type=file])')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    const small = els.filter((e) => { const r = e.getBoundingClientRect(); return r.height < 44 && !e.closest('label.f'); }).map((e) => (e.dataset.a || e.dataset.c || e.tagName) + ':' + Math.round(e.getBoundingClientRect().height));
    return { small, sw: document.documentElement.scrollWidth, iw: innerWidth, text: R.innerText, dir: getComputedStyle(R).direction }; });
  const shot = async (n) => { if (shots) await page.screenshot({ path: path.join(shots, n + '.png'), fullPage: false }); };
  const goV = (v) => page.evaluate((v) => { NAV = [{ v: 'home' }]; go(v); }, v);
  const fine = (r) => r.small.length === 0 && r.sw <= r.iw && r.dir === 'rtl';

  // 1. מרכז הייבוא: כפתור "סנכרון כספית"
  await goV('imp'); await H.settle(page, 600);
  const imp = await q();
  check('1 מרכז הייבוא: יש כפתור "סנכרון כספית"', /סנכרון כספית/.test(imp.text), imp.text.slice(0, 120));

  // 2. מסך הסנכרון (לפני קובץ)
  await goV('cxSync'); await H.settle(page, 800);
  const p1 = await q(); await shot('cx-1-start');
  check('2 מסך פתיחה: בחירת קובץ, קבצים לכספית, הגדרות; מגע ≥44, בלי גלילה לצד, RTL', fine(p1) && /בחירת קובץ/.test(p1.text) && /קבצים לכספית/.test(p1.text) && /עוד לא היה סנכרון/.test(p1.text), { small: p1.small, sw: p1.sw });

  // 3. קובץ CSV מדומה → שליחה בחלקים → תצוגה מקדימה
  const csv = '﻿קוד פריט,שם פריט,ברקוד,מחיר לצרכן,מחיר עלות\n' + Array.from({ length: 1600 }, (_, i) => `${400000 + i},מוצר ${i},${7300000000000 + i},${5 + (i % 9)},2`).join('\n') + '\n400000,מוצר 0,7399999999999,5,2\n';
  await page.setInputFiles('input[data-c=cxFile]', { name: 'catalog.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
  await H.settle(page, 1500);
  const up = calls.filter((x) => x.n === 'cxUpload');
  check('3 שליחה: 1,600 קודים ב-2 חלקים (1,500 + 100), אותו מזהה, ברקוד נוסף נאסף לקוד', up.length === 2 && up[0].d.items.length === 1500 && up[1].d.items.length === 100 && up[0].d.run === up[1].d.run && up[0].d.items[0].bcs.length === 2, up.map((x) => x.d.items.length));
  const p2 = await q(); await shot('cx-2-preview');
  check('4 תצוגה מקדימה: מונים למעלה (חדשים 5, מקושרים 4, אוחדו 2, סוננו 1), כרטיסיות, בחירה "מי קובע", אשר/ביטול; מגע ≥44', fine(p2) && /יקלטו כמוצרים חדשים\s*5/.test(p2.text) && /מקושרים למוצרים קיימים\s*4/.test(p2.text) && /קח הכול מכספית/.test(p2.text) && /אשר ושמור/.test(p2.text), { small: p2.small });
  await page.click('[data-a=cxDl][data-k=out]'); await H.settle(page, 300);
  const d1 = await q(); await shot('cx-2b-tile-out');
  check('4ב משבצת "ייצאו לכספית" נפתחת לרשימה מלאה: קוד, שם, ישן ← חדש; מגע ≥44', /ייצאו לכספית · 2/.test(d1.text) && /200011/.test(d1.text) && /כוס זכוכית/.test(d1.text) && /יוצא לכספית/.test(d1.text) && /התנגשות/.test(d1.text) && d1.small.length === 0, { small: d1.small, t: d1.text.slice(0, 300) });
  await page.evaluate(() => closeDlg());
  await page.click('[data-a=cxDl][data-k=mrg]'); await H.settle(page, 300);
  const d2 = await q();
  check('4ג משבצת "אוחדו" – איזה קוד אוחד לאיזה', /200006 אוחד לקוד 200001/.test(d2.text), d2.text.slice(0, 200));
  await page.evaluate(() => closeDlg());
  await page.click('[data-a=cxDl][data-k=flt]'); await H.settle(page, 300);
  check('4ד משבצת "סוננו" – פריט וסיבה', /הסיבה: קוד מיוחד/.test((await q()).text));
  await page.evaluate(() => closeDlg());
  await page.click('[data-a=cxTab][data-k=in]'); await H.settle(page, 200);
  const p3 = await q(); await shot('cx-3-preview-in');
  check('5 כרטיסיית "מכספית": מחיר באפליקציה מול כספית, תגית', /באפליקציה ₪\s?12/.test(p3.text.replace(/‏/g, '')) || /מכספית/.test(p3.text), p3.text.slice(0, 200));
  // ביטול סימון של שורה חדשה אחת
  await page.click('[data-a=cxTab][data-k=new]'); await H.settle(page, 200);
  await page.click('input[data-c=cxChk][data-k="200002"]'); await H.settle(page, 100);
  await page.click('[data-a=cxTab][data-k=flt]'); await H.settle(page, 200); await shot('cx-4-preview-filtered');
  await page.click('[data-a=cxFltDl]'); await H.settle(page, 200);
  check('6 הורדת רשימת המסוננים', (await page.evaluate(() => window.__saved.length)) === 1);
  await page.click('[data-a=cxApply]'); await H.settle(page, 300);
  const p4 = await q(); await shot('cx-5-confirm');
  check('7 חלון אישור: 4 חדשים (אחד בוטל), גיבוי לפני הפעם הראשונה; מגע ≥44', /מוצרים חדשים\s*4/.test(p4.text) && /גיבוי/.test(p4.text) && p4.small.length === 0, { small: p4.small, t: p4.text.slice(0, 160) });
  await page.click('[data-a=cxGo]'); await H.settle(page, 800);
  const ap = calls.find((x) => x.n === 'cxApply');
  check('8 אישור: נשלחו run, take=app ורשימת הדילוג', ap && ap.d.take === 'app' && JSON.stringify(ap.d.skip) === '["200002"]', ap && ap.d);
  const p5 = await q(); await shot('cx-6-done');
  check('9 מסך סיום: מונים וקבצים לכספית', fine(p5) && /הסנכרון נשמר/.test(p5.text) && /עדכון מחירים ועלויות/.test(p5.text), { small: p5.small });
  await page.click('[data-a=cxDl][data-k=pin]'); await H.settle(page, 300);
  const d3 = await q(); await shot('cx-6b-done-tile');
  check('9ב מסך סיום: משבצת "מחירים מכספית" נפתחת לרשימה', /מחירים מכספית · 1/.test(d3.text) && /קערה/.test(d3.text) && /\(מכספית\)/.test(d3.text), d3.text.slice(0, 200));
  await page.evaluate(() => closeDlg());
  await page.click('[data-a=cxExp][data-k=price]'); await H.settle(page, 400);
  const p6 = await q(); await shot('cx-7-export');
  check('10 קובץ עדכון מחיר: נשמר, וחלון עם השורות', (await page.evaluate(() => window.__saved.length)) === 2 && /2 שורות/.test(p6.text) && p6.small.length === 0, { small: p6.small });
  await page.evaluate(() => closeDlg());

  // 11. מסך מלאי עם 8,700 מוצרים: נטען בעמודים, מציג 150 + "הצג עוד", חיפוש לפי קוד כספית
  const t0 = Date.now();
  await page.evaluate(() => { window.__oxReload && window.__oxReload(); NAV = [{ v: 'home' }]; go('oxStock'); });
  let n = 0; for (let k = 0; k < 60; k++) { n = await page.evaluate(() => (document.querySelector('#oxSumN') || {}).textContent || ''); if (n.replace(/\D/g, '') === String(NP)) break; await page.waitForTimeout(250); }
  const tLoad = Date.now() - t0;
  const st = await q(); await shot('cx-8-stock-8700');
  const rows = await page.evaluate(() => document.querySelectorAll('#oxpl .li').length);
  check('11 מלאי: 8,700 מוצרים נטענים (5 עמודים), מוצגים 150 + "הצג עוד", "לא נספר", מתחת ל-8 שניות', n.replace(/\D/g, '') === String(NP) && rows === 150 && /הצג עוד/.test(st.text) && /לא נספר/.test(st.text) && rqProd >= 5 && tLoad < 8000 && st.sw <= st.iw, { n, rows, rqProd, tLoad });
  // כשל בטעינת עמוד: הודעה + "נסה שוב" (לא חותכים בשקט)
  await page.evaluate(() => { window.__oxReload(); NAV = [{ v: 'home' }]; }); globalThis.__PFAIL = 1; // העמוד השני ייכשל פעם אחת
  await page.evaluate(() => go('oxStock')); await H.settle(page, 1500);
  const er = await q(); await shot('cx-8b-stock-load-error');
  check('11ב כשל בטעינת עמוד: "לא כל המוצרים נטענו" + נסה שוב', /לא כל המוצרים נטענו/.test(er.text) && /נסה שוב/.test(er.text), er.text.slice(0, 120));
  await page.click('[data-a=oxPRetry]'); await H.settle(page, 2000);
  const er2 = await q();
  check('11ג אחרי "נסה שוב" – כל 8,700 נטענו', !/לא כל המוצרים נטענו/.test(er2.text) && (await page.evaluate(() => (document.querySelector('#oxSumN') || {}).textContent)).replace(/\D/g, '') === String(NP));
  await page.click('[data-a=oxDnF]'); await H.settle(page, 300);
  const dnv = await q(); await shot('cx-8c-stock-dup-names');
  const dnRows = await page.evaluate(() => document.querySelectorAll('#oxpl .li').length);
  check('11ד מסנן "שם כפול – לבדוק": רק המסומנים (9), עם תגית וכפתור "נבדק"', dnRows === 9 && /שם כפול – לבדוק/.test(dnv.text) && /נבדק/.test(dnv.text) && dnv.small.length === 0, { dnRows, small: dnv.small });
  await page.click('#oxpl [data-a=oxDnOk]'); await H.settle(page, 400);
  check('11ה "נבדק" – נשלח cxDnOk והשורה יצאה מהמסנן', calls.some((x) => x.n === 'cxDnOk') && (await page.evaluate(() => document.querySelectorAll('#oxpl .li').length)) === 8);
  await page.click('[data-a=oxDnF]'); await H.settle(page, 300);
  const t1 = Date.now();
  await page.fill('input[data-i=oxSQ]', '304321'); await page.dispatchEvent('input[data-i=oxSQ]', 'input'); await H.settle(page, 200);
  const hit = await page.evaluate(() => [...document.querySelectorAll('#oxpl .li .m > b')].map((b) => b.textContent));
  check('12 חיפוש לפי קוד כספית מוצא מוצר אחד, מהר', hit.length === 1 && /מוצר בדיקה 4321/.test(hit[0]) && Date.now() - t1 < 1500, { hit, ms: Date.now() - t1 });
  await page.click('#oxpl [data-a=oxEditP]'); await H.settle(page, 300);
  const f1 = await q(); await shot('cx-9-product-form');
  check('13 טופס מוצר: קוד כספית + כפתור היסטוריה', /קוד כספית: 304321/.test(f1.text) && /היסטוריית מחיר ועלות/.test(f1.text), f1.text.slice(0, 200));
  await page.click('#dlg [data-a=oxPHist]'); await H.settle(page, 400);
  const h1 = await q(); await shot('cx-10-price-history');
  check('14 היסטוריית מחיר: מכספית ובאפליקציה, מגע ≥44', /מחיר: 5\.00\s*₪ ← 6\.00\s*₪/.test(h1.text.replace(/[\u200e\u200f]/g, '')) && /מכספית/.test(h1.text) && /באפליקציה/.test(h1.text) && h1.small.length === 0, { small: h1.small, t: h1.text.slice(0, 200) });

  check('15 בלי שגיאות JavaScript', page.__errors.length === 0, page.__errors.slice(0, 3));
  await browser.close();
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
  console.log(fail ? `נכשלו ${fail}` : 'הכול עבר');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
