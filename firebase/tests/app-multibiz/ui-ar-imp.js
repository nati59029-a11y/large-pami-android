'use strict';
// 15.11.2026 (שלב 6 – ייבוא מתוכנה קודמת): www/ar-import.js + התוספות ב-ar-inv.js (מסמך מיובא בכרטיס הלקוח) וב-orders-cust.js (שדות עסקיים בייבוא הלקוחות), מול רשת מדומה.
// מסך הייבוא (מנהל), התאמת עמודות (זיהוי + שמירה), תצוגה מקדימה עם שגיאות, ייבוא במנות של 25, ביטול קבוצה, ועובד – בלי גישה.
// שימוש: node ui-ar-imp.js <www-dir> [out.json] [shots-dir]
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const out = {}; let fail = 0;
const check = (name, ok, info) => { out[name] = { ok: !!ok, info }; if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 500) : '')); };
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
const S = (v) => ({ stringValue: v }), N = (v) => (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }), M = (o) => ({ mapValue: { fields: o } }), A = (a) => ({ arrayValue: { values: a } }), B = (v) => ({ booleanValue: v });
const doc = (p, f) => ({ document: { name: 'projects/demo-largpeami/databases/(default)/documents/b/biz-o/' + p, fields: f } });
const T2 = Date.UTC(2026, 10, 12, 9, 0, 0);
const CUST = [doc('cust/cT', { name: S('מאפיית השקד'), bn: S('מאפיית השקד בע"מ'), phone: S('0541111111'), wholesale: B(true), xc: S('1001'), ar: M({ bal: N(95000), open: N(100000), cr: N(5000), at: N(T2) }) })];
const SNAP = M({ name: S('מאפיית השקד בע"מ') });
const X = (id, f) => doc('ardoc/' + id, Object.assign({ ser: S('X'), d: S('2025-09-01'), cust: S('cT'), custSnap: SNAP, lines: A([]), vm: S('inc'), rate: N(0), vat: N(0), draft: B(false), br: S('_'), ord: A([]), imp: S('bAAAAAAAA1'), note: S('מסמך מיובא'), at: N(T2), upd: N(T2) }, f));
const ARDOC = [X('x_ob_cT', { t: S('ob'), k: S('dr'), no: S(''), ext: S(''), net: N(100000), gross: N(100000), open: N(60000), st: S('part') }),
  X('x_inv_103', { t: S('old'), k: S('cr'), ot: S('inv'), no: S('103'), ext: S('103'), net: N(5000), gross: N(5000), open: N(5000), st: S('ok') })];
const BATCHES = [{ id: 'bAAAAAAAA1', kind: 'inv', name: 'חשבוניות.xlsx', at: T2, n: 2, sum: 95000, st: 'ok', nv: 0 }, { id: 'bAAAAAAAA2', kind: 'ob', name: 'יתרות.csv', at: T2 - 1000, n: 3, sum: 1000, st: 'void', nv: 3 }];

async function open(browser, www, who, calls) {
  const cfg = { mode: 'new', users: { m: 'biz-o', w: 'biz-o' }, biz: { 'biz-o': { dataRoot: 'b', features: ALL, name: 'עסק בדיקה' } }, admins: { 'b/biz-o/|m': 1 }, staff: { 'b/biz-o/|w': 1 } };
  const log = [];
  const { ctx, page } = await H.newPage(browser, www, cfg, log, 'aim' + who);
  page.on('pageerror', (e) => log.push('pageerror: ' + e.message));
  await ctx.route(/:8080\/.*/, async (route) => {
    const req = route.request(); const u = new URL(req.url()); const body = req.postData() || '';
    const J = (st, b) => route.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(b) });
    if (/:runQuery$/.test(u.pathname)) { let c = ''; try { c = JSON.parse(body).structuredQuery.from[0].collectionId; } catch (e) { /* */ }
      if (c === 'ardoc') return J(200, ARDOC);
      return J(200, c === 'cust' ? CUST : [{ readTime: '2026-11-03T09:00:00Z' }]); }
    if (/\/arcfg\/main$/.test(u.pathname)) return J(200, { name: 'x', fields: { on: B(true), name: S('עסק') } });
    if (/\/arcfg\/off$/.test(u.pathname)) return J(404, { error: { code: 404 } });
    const dm = /\/ardoc\/([^/]+)$/.exec(u.pathname); if (dm) { const d = ARDOC.find((x) => x.document.name.endsWith('/' + dm[1])); return d ? J(200, d.document) : J(404, { error: { code: 404 } }); }
    const cm = /\/cust\/([^/]+)$/.exec(u.pathname); if (cm) { const d = CUST.find((x) => x.document.name.endsWith('/' + cm[1])); return d ? J(200, d.document) : J(404, { error: { code: 404 } }); }
    if (/\/ordcfg\/main$/.test(u.pathname)) return J(200, { name: 'x', fields: { pay: M({ mode: S('phone') }) } });
    if (/\/documents\/b\/biz-o$/.test(u.pathname) && req.method() === 'GET') return J(200, { name: 'x', fields: { dataRoot: S('b'), status: S('active'), name: S('עסק בדיקה'), features: M(Object.fromEntries(Object.keys(ALL).map((k) => [k, B(true)]))), org: M({ v: N(1), branches: A([M({ id: S('br1'), name: S('סניף 1'), on: B(true) })]) }) } });
    return route.fallback();
  });
  let voidN = 0;
  await ctx.route(/:5001\/.*/, async (route) => {
    const n = new URL(route.request().url()).pathname.split('/').pop(); let d = {}; try { d = JSON.parse(route.request().postData()).data; } catch (e) { /* */ }
    calls.push({ n, d });
    let R = { ok: true };
    if (n === 'arImpList') R = { batches: BATCHES, maps: { rc: { 'אסמכתא': 'no' } } };
    else if (n === 'arImp' && d.dry) R = { n: d.rows.length, add: d.rows.length - 1, dup: 0, bad: 1, sum: 12345, rows: d.rows.map((r, i) => (i === 1 ? { i, ok: false, why: 'bad-date', msg: 'תאריך לא תקין' } : { i, ok: true, st: 'new', name: 'מאפיית השקד', k: 'dr', ag: 100, no: String(r.no), d: '2025-09-01' })) };
    else if (n === 'arImp') R = { add: d.rows.length, dup: 0, bad: 0, sum: d.rows.length * 100, rows: [] };
    else if (n === 'arImpVoid') { voidN++; R = { voided: 25, left: voidN === 1 ? 5 : 0 }; }
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
  const view = async (page, v, id) => { await page.evaluate(([a, b]) => go(a, b), [v, id]); await H.settle(page, 1200); await page.evaluate(([a, b]) => go(a, b), [v, id]); await H.settle(page, 500);
    return page.evaluate(() => { const m = document.getElementById('main'); return { t: m.innerText, file: !!m.querySelector('[data-c=aiFile]'), imp: !!m.querySelector('[data-v=arImp]'), voids: m.querySelectorAll('[data-a=aiVoid]').length, ov: document.documentElement.scrollWidth - innerWidth }; }); };
  const dlgT = (page) => page.evaluate(() => { const d = document.querySelector('#dlg'); return d && d.open ? d.innerText : ''; });

  // ---------- מנהל ----------
  { const calls = []; const { ctx, page, log } = await open(browser, www, 'm', calls);
    await page.evaluate(() => go('ox')); await H.settle(page, 1200);
    const cf = await view(page, 'arCfg');
    check('m 1 הגדרות החשבוניות: כפתור "ייבוא מתוכנה קודמת"', cf.imp, { t: cf.t.slice(-200) });
    const v = await view(page, 'arImp'); await shot(page, 'm-01-מסך-ייבוא');
    check('m 2 מסך הייבוא: בחירת סוג וקובץ, ייבואים קודמים (פעיל עם "ביטול קבוצה", מבוטל בלי), 360px בלי גלילה לרוחב',
      v.file && /ייבואים קודמים/.test(v.t) && /חשבוניות\.xlsx/.test(v.t) && /בוטל/.test(v.t) && v.voids === 1 && v.ov <= 0 && calls.some((c) => c.n === 'arImpList'), { voids: v.voids, ov: v.ov });
    // קובץ דוגמה (החלטה 15.11.2026): הכפתור מוריד קובץ לפי הסוג שנבחר; הקובץ עצמו נקלט והעמודות מזוהות לבד.
    // בדפדפן הבדיקה אין את ספריית האקסל (xlsx.full.min.js נוצר בבנייה) – לכן נבדק המסלול החלופי CSV (גיליון הנתונים בלבד). באפליקציה: xlsx עם גיליון "הסבר"
    await page.selectOption('#aiK', 'inv');
    const tpl = await page.evaluate(async () => { let got = null; const o = window.saveFile; window.saveFile = async (n, d) => { got = { n, d: typeof d === 'string' ? d : new TextDecoder().decode(d) }; };
      try { document.querySelector('[data-a=aiTpl]').click(); await new Promise((r) => setTimeout(r, 300)); } finally { window.saveFile = o; }
      if (!got) return null; return { n: got.n, xlsx: typeof XLSX !== 'undefined', rows: typeof XLSX === 'undefined' ? parseCsv(got.d.replace(/^\ufeff/, '')) : null, d: got.d }; });
    check('m 2ב קובץ דוגמה לחשבוניות: "דוגמה לייבוא – חשבוניות", הכותרות כולל "תאריך לתשלום", 2 שורות דוגמה',
      !!tpl && /^דוגמה לייבוא – חשבוניות\.(csv|xlsx)$/.test(tpl.n) && !!tpl.rows && tpl.rows[0].join() === 'מספר לקוח,ע.מ / ח.פ,טלפון,שם הלקוח,מספר מסמך,תאריך,סכום,תאריך לתשלום' && tpl.rows.filter((r) => r.some((c) => String(c).trim())).length === 3,
      tpl && { n: tpl.n, rows: tpl.rows && tpl.rows.slice(0, 2) });
    if (tpl && tpl.rows) { await page.setInputFiles('[data-c=aiFile]', { name: 'דוגמה.csv', mimeType: 'text/csv', buffer: Buffer.from(tpl.d, 'utf8') }); await H.settle(page, 1000);
      const mt = await page.evaluate(() => [...document.querySelectorAll('#dlg form[data-f=aiMapF] select')].map((s) => s.value));
      check('m 2ג קובץ הדוגמה נקלט: כל העמודות מזוהות לבד', JSON.stringify(mt) === JSON.stringify(['xc', 'vat', 'phone', 'name', 'no', 'd', 'amt', 'due']), mt);
      await page.evaluate(() => closeDlg()); await view(page, 'arImp'); }
    // קובץ CSV: 30 שורות, השנייה עם תאריך שגוי
    const csv = ['מספר לקוח,שם לקוח,מספר חשבונית,תאריך,סכום,הערות'].concat(Array.from({ length: 30 }, (_, i) => `1001,מאפיית השקד,${100 + i},${i === 1 ? '31/02/2025' : '01/09/2025'},"1,180.00",x`)).join('\n');
    await page.selectOption('#aiK', 'inv');
    await page.setInputFiles('[data-c=aiFile]', { name: 'חשבוניות.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') }); await H.settle(page, 1200);
    const mp = await page.evaluate(() => [...document.querySelectorAll('#dlg form[data-f=aiMapF] select')].map((s) => s.value));
    await shot(page, 'm-02-התאמת-עמודות');
    check('m 3 התאמת עמודות: זיהוי לפי הכותרות (מספר לקוח, שם, מספר מסמך, תאריך, סכום; הערות – לא לייבא)', JSON.stringify(mp) === JSON.stringify(['xc', 'name', 'no', 'd', 'amt', '']), mp);
    let n0 = calls.length;
    await page.click('#dlg form[data-f=aiMapF] button:not([type=button])'); await H.settle(page, 1200);
    const dry = calls.slice(n0).filter((c) => c.n === 'arImp');
    const pv = await dlgT(page); await shot(page, 'm-03-תצוגה-מקדימה');
    check('m 4 תצוגה מקדימה מהשרת: קריאה אחת dry עם 30 שורות והתאמת העמודות לשמירה; "29 חדשות", "שורה 3: תאריך לא תקין", הסכום',
      dry.length === 1 && dry[0].d.dry === true && dry[0].d.rows.length === 30 && dry[0].d.map['מספר לקוח'] === 'xc' && dry[0].d.map['הערות'] === '' && dry[0].d.rows[0].amt === '1,180.00' && /29.*חדשות/.test(pv) && /שורה 3: תאריך לא תקין/.test(pv) && /123\.45/.test(pv),
      { dry: dry.map((c) => [c.d.rows.length, c.d.map]), pv: pv.slice(0, 300) });
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    n0 = calls.length;
    await page.click('#dlg [data-a=aiGo]'); await H.settle(page, 2000);
    const run = calls.slice(n0).filter((c) => c.n === 'arImp');
    const done = await dlgT(page);
    check('m 5 ייבוא במנות של 25: 2 קריאות (25 + 5), אותה קבוצה, בלי dry; סיכום "הייבוא הסתיים", בלי גלילה לרוחב',
      run.length === 2 && run[0].d.rows.length === 25 && run[1].d.rows.length === 5 && run[0].d.batch === run[1].d.batch && /^b/.test(run[0].d.batch) && !run[0].d.dry && run[0].d.kind === 'inv' && /הייבוא הסתיים/.test(done) && ov <= 0,
      { run: run.map((c) => [c.d.rows.length, c.d.batch]), done: done.slice(0, 120) });
    await page.evaluate(() => closeDlg());
    // התאמה שמורה (קבלות): "אסמכתא" → מספר מסמך, גם בלי שהכותרת מזוהה
    await view(page, 'arImp'); await page.selectOption('#aiK', 'rc');
    await page.setInputFiles('[data-c=aiFile]', { name: 'קבלות.csv', mimeType: 'text/csv', buffer: Buffer.from('ח.פ,אסמכתא,ת. ערך,סכום,לחשבונית\n515000001,500,05/10/2025,100,A-100', 'utf8') }); await H.settle(page, 1000);
    const mp2 = await page.evaluate(() => [...document.querySelectorAll('#dlg form[data-f=aiMapF] select')].map((s) => s.value));
    check('m 6 התאמה שמורה מהשרת (קבלות): "אסמכתא" → מספר מסמך; ח.פ → ע.מ; "לחשבונית" → מספר חשבונית', JSON.stringify(mp2) === JSON.stringify(['vat', 'no', 'd', 'amt', 'ref']), mp2);
    await page.evaluate(() => closeDlg());
    // ביטול קבוצה: אישור, ואז קריאות עד left=0
    await view(page, 'arImp');
    n0 = calls.length;
    await page.click('[data-a=aiVoid]'); await H.settle(page, 300);
    const ask = await dlgT(page);
    await page.click('#dlg [data-a=yes]'); await H.settle(page, 1500);
    const vc = calls.slice(n0).filter((c) => c.n === 'arImpVoid');
    check('m 7 ביטול קבוצה: שאלת אישור ("לא נמחקות"), ואז arImpVoid עד שלא נשאר (2 קריאות)', /לא נמחקות/.test(ask) && vc.length === 2 && vc[0].d.batch === 'bAAAAAAAA1', { n: vc.length, ask: ask.slice(0, 120) });
    // כרטיס הלקוח: מסמכים מיובאים
    await page.evaluate(() => go('ox')); await H.settle(page, 1000);
    const c = await view(page, 'ocCard', 'cT'); await shot(page, 'm-04-כרטיס-לקוח');
    c.t = c.t.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ''); // סימני כיוון בלתי נראים
    check('m 8 כרטיס הלקוח: "יתרת פתיחה" (פתוח ₪600), "חשבונית (מיובא) #103" בסכום שלילי עם זכות, בלי גלילה לרוחב',
      /יתרת פתיחה/.test(c.t) && /חשבונית \(מיובא\) #103/.test(c.t) && /פתוח 600\.00\s*₪/.test(c.t) && /-50\.00\s*₪\s*זכות 50\.00/.test(c.t) && c.ov <= 0, { t: c.t.slice(-400) });
    await page.evaluate(() => ACT.arDocV({ dataset: { id: 'x_inv_103' } })); await H.settle(page, 300);
    const dv = await page.evaluate(() => { const d = document.querySelector('#dlg'); return { t: d.innerText, share: !!d.querySelector('[data-a=arDShare]'), cr: !!d.querySelector('[data-a=arCr]') }; });
    check('m 9 מסמך מיובא: "מסמך מיובא מתוכנה קודמת – בלי קובץ", בלי שיתוף / שליחה / זיכוי', /מסמך מיובא מתוכנה קודמת/.test(dv.t) && !dv.share && !dv.cr, dv);
    await page.evaluate(() => closeDlg());
    // ייבוא הלקוחות הקיים: עמודות עסקיות מזוהות ונבנות לשורה
    const oc = await page.evaluate(() => { const C = window.__oc, H0 = ['שם', 'טלפון', 'שם העסק', 'ע.מ', 'איש קשר', 'תנאי תשלום', 'סיטונאי', "מס' לקוח"];
      const map = H0.map((h) => C.guess(h));
      const R = [['מאפיית השקד', '0541111111', 'מאפיית השקד בע"מ', '51-5000001', 'יוסי', 'שוטף+30', 'כן', 1001], ['פרטי', '0541111112', '', '12', '', 'מוזר', 'לא', ''], ['ב', '0541111113', '', '', '', '45 יום', '', '']];
      const r = C.prepRows({ map, R });
      return { map, o: r.out.map((x) => x.o), warn: r.out.map((x) => x.warn) }; });
    check('m 10 ייבוא לקוחות: שם העסק / ע.מ / איש קשר / תנאי תשלום / סיטונאי / מספר לקוח מזוהים; שוטף+30, "כן" = עסקי, ע.מ לא תקין – אזהרה ולא נשלח, 45 יום = ימים מהחשבונית',
      JSON.stringify(oc.map) === JSON.stringify(['name', 'phone', 'bn', 'vat', 'ct', 'terms', 'ws', 'xc']) && oc.o[0].wholesale === true && oc.o[0].vat === '515000001' && oc.o[0].bn === 'מאפיית השקד בע"מ' && oc.o[0].ct === 'יוסי'
      && JSON.stringify(oc.o[0].terms) === JSON.stringify({ b: 'eom', d: 30 }) && oc.o[0].xc === '1001' && !oc.o[0].x && oc.o[1].wholesale === undefined && oc.o[1].vat === undefined && oc.warn[1].includes('ע.מ') && oc.warn[1].includes('תנאי תשלום')
      && JSON.stringify(oc.o[2].terms) === JSON.stringify({ b: 'inv', d: 45 }), oc);
    const errs = log.filter((x) => /pageerror|TypeError|ReferenceError/.test(x));
    check('m 11 בלי שגיאות JS', errs.length === 0, errs.slice(0, 3));
    await ctx.close(); }

  // ---------- עובד ----------
  { const calls = []; const { ctx, page, log } = await open(browser, www, 'w', calls);
    await page.evaluate(() => go('ox')); await H.settle(page, 1200);
    const v = await view(page, 'arImp');
    check('w 1 עובד: מסך הייבוא – "למנהל בלבד", בלי קובץ ובלי קריאה לשרת', /למנהל בלבד/.test(v.t) && !v.file && !calls.some((c) => /^arImp/.test(c.n)), { t: v.t.slice(0, 100) });
    const errs = log.filter((x) => /pageerror|TypeError|ReferenceError/.test(x));
    check('w 2 בלי שגיאות JS', errs.length === 0, errs.slice(0, 3));
    await ctx.close(); }

  await browser.close();
  if (outFile) fs.writeFileSync(outFile, JSON.stringify({ out }, null, 1));
  console.log(fail ? `תוצאה: נכשל (${fail})` : 'תוצאה: הכול עבר'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
