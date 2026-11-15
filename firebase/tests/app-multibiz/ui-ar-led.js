'use strict';
// 15.11.2026 (שלב 5 – כרטסת, דוח חובות ותזכורות): www/ar-ledger.js מול רשת מדומה. כרטיס חשבון (לשוניות, כרטסת עם סינון, יתרה = cust.ar.bal),
// PDF / Excel / שליחה, תזכורות ללקוח (מנהל), דוח חובות (סינון לפי שם / סוג / תאריך), הגדרות תזכורות (מנהל), ובלי "מסמכים פעילים" – אין שום שינוי.
// ב-360 וב-412 פיקסלים, בלי גלילה לרוחב ובלי שגיאות JS. שימוש: node ui-ar-led.js <www-dir> [out.json] [shots-dir]
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const out = {}; let fail = 0;
const check = (name, ok, info) => { out[name] = { ok: !!ok, info }; if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 500) : '')); };
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
const S = (v) => ({ stringValue: v }), N = (v) => (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }), M = (o) => ({ mapValue: { fields: o } }), A = (a) => ({ arrayValue: { values: a } }), B = (v) => ({ booleanValue: v });
const doc = (p, f) => ({ document: { name: 'projects/demo-largpeami/databases/(default)/documents/b/biz-o/' + p, fields: f } });
const T2 = Date.UTC(2026, 10, 12, 9, 0, 0);
const CUST = [doc('cust/cT', { name: S('חברת שוטף'), bn: S('חברת שוטף בע"מ'), phone: S('0541111111'), mail: S('t@x.co'), wholesale: B(true), terms: M({ b: S('eom'), d: N(30) }), ar: M({ bal: N(12500), open: N(12500), cr: N(0), at: N(T2) }) })];
const SNAP = M({ name: S('חברת שוטף בע"מ'), phone: S('0541111111'), mail: S('t@x.co') });
const LINES = A([M({ n: S('עוגה'), q: N(1), p: N(12) }), M({ n: S('כוס'), q: N(10), p: N(5) })]);
const base = { custSnap: SNAP, lines: LINES, vm: S('ex'), rate: N(18), draft: B(true), br: S('br1'), ord: A([]), upd: N(T2) };
const ARDOC = [doc('ardoc/invD1', Object.assign({ t: S('inv'), ser: S('D'), no: N(1), d: S('2026-11-01'), due: S('2026-11-30'), cust: S('cT'), net: N(6200), vat: N(1116), gross: N(7316), open: N(7316), st: S('open'), at: N(T2) }, base)),
  doc('ardoc/invD2', Object.assign({ t: S('inv'), ser: S('D'), no: N(2), d: S('2026-11-13'), due: S('2026-12-31'), cust: S('cT'), net: N(6200), vat: N(1116), gross: N(7316), open: N(5184), st: S('part'), at: N(T2 + 1) }, base)),
  doc('ardoc/rcD1', Object.assign({ t: S('rc'), ser: S('D'), no: N(1), d: S('2026-11-14'), cust: S('cT'), net: N(2132), vat: N(0), gross: N(2132), open: N(0), st: S('ok'), pay: M({ m: S('transfer') }), at: N(T2 + 2) }, base, { lines: A([]) })),
  doc('ardoc/rcD9', Object.assign({ t: S('rc'), ser: S('D'), no: N(9), d: S('2026-11-14'), cust: S('cT'), net: N(999), vat: N(0), gross: N(999), open: N(0), st: S('void'), void: M({ at: N(T2), why: S('x') }), pay: M({ m: S('cash') }), at: N(T2 + 3) }, base, { lines: A([]) }))];

async function open(browser, www, who, calls, arOn) {
  const cfg = { mode: 'new', users: { m: 'biz-o', w: 'biz-o' }, biz: { 'biz-o': { dataRoot: 'b', features: ALL, name: 'עסק בדיקה' } }, admins: { 'b/biz-o/|m': 1 }, staff: { 'b/biz-o/|w': 1 } };
  const log = [];
  const { ctx, page } = await H.newPage(browser, www, cfg, log, 'al' + who + (arOn ? 1 : 0));
  page.on('pageerror', (e) => log.push('pageerror: ' + e.message));
  await ctx.route(/:8080\/.*/, async (route) => {
    const req = route.request(); const u = new URL(req.url()); const body = req.postData() || '';
    const J = (st, b) => route.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(b) });
    if (/:runQuery$/.test(u.pathname)) { let c = '', f = null; try { const q = JSON.parse(body).structuredQuery; c = q.from[0].collectionId; f = q.where && q.where.fieldFilter; } catch (e) { /* */ }
      if (c === 'ardoc') { calls.push({ n: 'q:ardoc', d: f ? f.field.fieldPath + ' ' + f.op : '' });
        const L = !f ? ARDOC : ARDOC.filter((d) => { const v = d.document.fields[f.field.fieldPath]; if (!v) return false; return f.op === 'GREATER_THAN' ? +(v.integerValue || 0) > +(f.value.integerValue || 0) : v.stringValue === f.value.stringValue; });
        return J(200, L); }
      return J(200, c === 'cust' ? CUST : [{ readTime: '2026-11-03T09:00:00Z' }]); }
    if (/\/arcfg\/main$/.test(u.pathname)) return arOn ? J(200, { name: 'x', fields: { on: B(true), name: S('עסק') } }) : J(404, { error: { code: 404 } });
    if (/\/arcfg\/off$/.test(u.pathname)) return J(404, { error: { code: 404 } });
    const cm = /\/cust\/([^/]+)$/.exec(u.pathname); if (cm) { const d = CUST.find((x) => x.document.name.endsWith('/' + cm[1])); return d ? J(200, d.document) : J(404, { error: { code: 404 } }); }
    if (/\/ordcfg\/main$/.test(u.pathname)) return J(200, { name: 'x', fields: { pay: M({ mode: S('phone') }) } });
    if (/\/documents\/b\/biz-o$/.test(u.pathname) && req.method() === 'GET') return J(200, { name: 'x', fields: { dataRoot: S('b'), status: S('active'), name: S('עסק בדיקה'), features: M(Object.fromEntries(Object.keys(ALL).map((k) => [k, B(true)]))) } });
    return route.fallback();
  });
  await ctx.route(/:5001\/.*/, async (route) => {
    const n = new URL(route.request().url()).pathname.split('/').pop(); let d = {}; try { d = JSON.parse(route.request().postData()).data; } catch (e) { /* */ }
    calls.push({ n, d });
    const R = { getCosts: { cost: {} }, ordProfit: { n: 0, total: 0, paid: 0, paidN: 0 }, arStatement: { b64: 'JVBERi0xLjQ=', name: 'x.pdf', bal: 12500, sent: d && d.ch ? [{ ch: d.ch, ok: true }] : [] },
      setRemCfg: d && d.get ? { cfg: { on: true, hour: 8, b: 2, steps: [0, 5], mon: 0, cap: 50, txt: 'שלום {שם}' }, sums: [{ d: '2026-11-15', sent: [{ cust: 'cT', name: 'חברת שוטף בע"מ', ok: true }, { cust: 'cX', name: 'בלי מייל', ok: false, why: 'no-to' }], owe: [], nOwe: 2, tot: 12500 }] } : { ok: true } };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: R[n] || { ok: true } }) });
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
    return page.evaluate(() => { const m = document.getElementById('main'); const t = m.querySelector('#arled table');
      return { t: m.innerText, led: !!m.querySelector('[data-v=arLed]'), debt: !!m.querySelector('[data-v=arDebt]'), rows: t ? [...t.querySelectorAll('tbody tr')].map((r) => [...r.cells].map((c) => c.innerText.trim())) : null,
        bal: (m.querySelector('#arbal') || {}).innerText || '', dt: (m.querySelector('#ardebt') || {}).innerText || '', li: m.querySelectorAll('.li').length, rem: !!m.querySelector('form[data-f=arCRemF]'), ov: document.documentElement.scrollWidth - innerWidth }; }); };
  const num = (s) => +String(s || '').replace(/[^\d.-]/g, '');

  // בלי "מסמכים פעילים": אין שום תוספת
  { const calls = []; const { ctx, page, log } = await open(browser, www, 'm', calls, false);
    await page.evaluate(() => go('ox')); await H.settle(page, 1500);
    const o = await view(page, 'ox'), c = await view(page, 'ocCard', 'cT');
    check('0 מתג כבוי: אין "דוח חובות" במסך ההזמנות, אין "כרטיס חשבון" בכרטיס הלקוח, אין שאילתת ardoc', !o.debt && !c.led && !calls.some((x) => x.n === 'q:ardoc'), { o: o.debt, c: c.led, calls: calls.map((x) => x.n) });
    check('0א בלי שגיאות JS', !log.some((x) => /pageerror|TypeError|ReferenceError/.test(x)), log.filter((x) => /pageerror/.test(x)).slice(0, 3));
    await ctx.close(); }

  for (const who of ['w', 'm']) {
    const calls = []; const { ctx, page, log } = await open(browser, www, who, calls, true);
    await page.evaluate(() => go('ox')); await H.settle(page, 1500);
    const c = await view(page, 'ocCard', 'cT');
    const q0 = calls.filter((x) => x.n === 'q:ardoc' && x.d === 'cust EQUAL').length;
    check(who + ' 1 כרטיס הלקוח: כפתור "כרטיס חשבון וכרטסת"', c.led, c.t.slice(-200));
    const a = await view(page, 'arLed', 'cT'); await shot(page, who + '-01-כרטיס-חשבון-360');
    check(who + ' 2 כרטיס חשבון: יתרה ₪125 (= cust.ar.bal), 2 פתוחות, לשוניות, בלי גלילה לרוחב', num(a.bal) === 125 && /2 חשבוניות פתוחות/.test(a.t) && /כרטסת/.test(a.t) && a.ov <= 0, { bal: a.bal, ov: a.ov });
    check(who + ' 2א המסמכים נטענים רק בפתיחת המסך (שאילתה אחת נוספת)', calls.filter((x) => x.n === 'q:ardoc' && x.d === 'cust EQUAL').length === q0 + 1, calls.filter((x) => x.n === 'q:ardoc').map((x) => x.d));
    await page.click('[data-a=arLedT][data-k=open]'); await H.settle(page, 300);
    const op = await page.evaluate(() => document.getElementById('main').querySelectorAll('.li').length);
    await page.click('[data-a=arLedT][data-k=led]'); await H.settle(page, 300);
    const l = await view(page, 'arLed', 'cT'); await shot(page, who + '-02-כרטסת-360');
    const last = l.rows && l.rows[l.rows.length - 1];
    check(who + ' 3 לשונית "פתוחות" – 2; כרטסת: 3 שורות (קבלה מבוטלת לא נספרת), חובה/זכות, היתרה האחרונה = cust.ar.bal, בלי גלילה לרוחב (360)', op === 2 && l.rows && l.rows.length === 3 && num(last[4]) === 125 && num(l.rows[0][2]) === 73.16 && num(l.rows[2][3]) === 21.32 && l.ov <= 0, { op, rows: l.rows, ov: l.ov });
    await page.setViewportSize({ width: 412, height: 800 }); await H.settle(page, 300);
    const w4 = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); await shot(page, who + '-03-כרטסת-412');
    check(who + ' 3א כרטסת ב-412 – בלי גלילה לרוחב', w4 <= 0, w4);
    await page.setViewportSize({ width: 360, height: 740 });
    await page.fill('form[data-f=arLedF] [name=from]', '2026-11-10'); await page.selectOption('form[data-f=arLedF] [name=t]', 'rc'); await page.click('form[data-f=arLedF] button'); await H.settle(page, 400);
    const f = await view(page, 'arLed', 'cT');
    check(who + ' 4 סינון: מתאריך 10.11 + קבלות – שורת "יתרת פתיחה" ₪73.16, ואז רק הקבלה', f.rows && f.rows.length === 2 && /יתרת פתיחה/.test(f.rows[0][1]) && num(f.rows[0][4]) === 73.16 && /קבלה 1/.test(f.rows[1][1]), f.rows);
    let n0 = calls.length; await page.click('[data-a=arLedPdf]'); await H.settle(page, 800);
    const pdf = calls.slice(n0).find((x) => x.n === 'arStatement');
    check(who + ' 5 PDF: arStatement עם הלקוח והטווח', pdf && pdf.d.cust === 'cT' && pdf.d.from === '2026-11-10' && !pdf.d.ch, pdf && pdf.d);
    await page.evaluate(() => { window.__dl = []; const k = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__dl.push(this.download); return; } return k.call(this); }; });
    await page.click('[data-a=arLedXls]'); await H.settle(page, 500);
    const fn = await page.evaluate(() => (window.__dl || [])[0] || (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() ? 'native' : ''));
    check(who + ' 5א Excel: קובץ הכרטסת (xlsx; ‏CSV כשספריית האקסל לא נטענת, כמו בבדיקה)', /\.xlsx$/.test(fn) || /\.csv$/.test(fn), fn);
    await page.click('[data-a=arLedSend]'); await H.settle(page, 300); n0 = calls.length;
    await page.click('#dlg form[data-f=arLedSF] button[value=mail]'); await H.settle(page, 800);
    const sd = calls.slice(n0).find((x) => x.n === 'arStatement');
    check(who + ' 5ב שליחה ללקוח במייל: arStatement עם ch=mail ומזהה בקשה', sd && sd.d.ch === 'mail' && /^r[a-z0-9]{8,}$/.test(sd.d.reqId) && sd.d.cust === 'cT', sd && sd.d);
    if (who === 'm') {
      check('m 6 טופס תזכורות ללקוח (מנהל)', f.rem, '');
      await page.uncheck('form[data-f=arCRemF] [name=on]'); await page.fill('form[data-f=arCRemF] [name=b]', '2'); await page.check('form[data-f=arCRemF] [name=invM]');
      n0 = calls.length; await page.click('form[data-f=arCRemF] button'); await H.settle(page, 800);
      const rc = calls.slice(n0).find((x) => x.n === 'setRemCfg');
      check('m 6א שמירה: setRemCfg {cust, rem:{on:false,b:2}, invM:true}', rc && JSON.stringify(rc.d) === JSON.stringify({ cust: 'cT', rem: { on: false, b: 2 }, invM: true }), rc && rc.d);
    } else check('w 6 עובד – בלי טופס תזכורות ללקוח', !f.rem, '');
    // דוח חובות
    const o = await view(page, 'ox');
    check(who + ' 7 מסך ההזמנות: "דוח חובות לקוחות"', o.debt, '');
    const d = await view(page, 'arDebt'); await shot(page, who + '-04-דוח-חובות-360');
    check(who + ' 7א דוח חובות: לקוח אחד, ₪125 (חשבוניות פתוחות), שאילתת open>0, בלי גלילה לרוחב', d.li === 1 && num(d.dt) === 125 && /הוותיק לתשלום עד 30\/11\/26/.test(d.t) && calls.some((x) => x.n === 'q:ardoc' && x.d === 'open GREATER_THAN') && d.ov <= 0, { li: d.li, dt: d.dt, ov: d.ov });
    await page.fill('form[data-f=arDebtF] [name=q]', 'xyz'); await page.click('form[data-f=arDebtF] button'); await H.settle(page, 300);
    const d2 = await view(page, 'arDebt');
    await page.fill('form[data-f=arDebtF] [name=q]', 'שוטף'); await page.fill('form[data-f=arDebtF] [name=from]', '2026-11-10'); await page.click('form[data-f=arDebtF] button'); await H.settle(page, 300);
    const d3 = await view(page, 'arDebt');
    check(who + ' 7ב סינון לפי שם (xyz – אין; "שוטף" + מתאריך 10.11 – רק חשבונית 2, ₪51.84)', d2.li === 0 && d3.li === 1 && num(d3.dt) === 51.84, { d2: d2.li, d3: d3.dt });
    await page.setViewportSize({ width: 412, height: 800 }); await H.settle(page, 300);
    const dw = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    check(who + ' 7ג דוח חובות ב-412 – בלי גלילה לרוחב', dw <= 0, dw);
    await page.setViewportSize({ width: 360, height: 740 });
    // הגדרות תזכורות
    const r = await view(page, 'arRemCfg');
    if (who === 'm') {
      await shot(page, 'm-05-הגדרות-תזכורות-360');
      check('m 8 הגדרות תזכורות: נטען מהשרת (setRemCfg get), סיכום אחרון עם "לא נשלח – אין מייל", בלי גלילה לרוחב', /תזכורות תשלום/.test(r.t) && /אין מייל/.test(r.t) && calls.some((x) => x.n === 'setRemCfg' && x.d.get === true) && r.ov <= 0, r.t.slice(0, 200));
      const v = await page.evaluate(() => ({ h: document.querySelector('form[data-f=arRemF] [name=hour]').value, s: document.querySelector('form[data-f=arRemF] [name=steps]').value }));
      await page.fill('form[data-f=arRemF] [name=steps]', '0, 3, 10'); n0 = calls.length; await page.click('form[data-f=arRemF] button'); await H.settle(page, 800);
      const sv = calls.slice(n0).find((x) => x.n === 'setRemCfg' && !x.d.get);
      check('m 8א שמירה: {on, sum, hour 8, b 2, steps [0,3,10], mon 0, cap 50, txt}', v.h === '8' && v.s === '0, 5' && sv && JSON.stringify(sv.d) === JSON.stringify({ on: true, sum: true, hour: 8, b: 2, steps: [0, 3, 10], mon: 0, cap: 50, txt: 'שלום {שם}' }), { v, d: sv && sv.d });
      const cf = await view(page, 'arCfg');
      check('m 8ב הגדרות אישור הזמנה: כפתורי "תזכורות תשלום" ו"דוח חובות"', /תזכורות תשלום/.test(cf.t) && cf.debt, '');
    } else check('w 8 עובד – הגדרות תזכורות: למנהל בלבד', /למנהל בלבד/.test(r.t) && !calls.some((x) => x.n === 'setRemCfg'), r.t.slice(0, 80));
    const errs = log.filter((x) => /pageerror|TypeError|ReferenceError/.test(x));
    check(who + ' 9 בלי שגיאות JS', errs.length === 0, errs.slice(0, 3));
    await ctx.close();
  }
  await browser.close();
  if (outFile) fs.writeFileSync(outFile, JSON.stringify({ out }, null, 1));
  console.log(fail ? `תוצאה: נכשל (${fail})` : 'תוצאה: הכול עבר'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
