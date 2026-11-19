'use strict';
// "השכר שלי" לעובד (שלב E, 19.11.2026): www/pay-me.js. רשת מדומה, בלי אמולטור. האכיפה עצמה – בחוקים (tests/wv-pay.test.js).
// מנהל: wv/pay_<חודש>_<uid> נכתב רק לעובד עם pay.show && pay.uid (חודש נוכחי וקודם); בלי src, בלי הערות, בלי שמות של אחרים;
// רכיב מכירות בלי amt – בלי סכומי מכירות (רק אחוז מהיעד), עם amt – עם סכומים; כתיבה רק כשהתוכן השתנה; uid השתנה / מתג כבוי ← מחיקה;
// 403 על pay_ לא עוצר את inc_ (wvSync); בונוס אוטומטי 0 – לא בפירוט לעובד ולא בדוחות (PayOut).
// עובד: בלי מסמך – אין משבצת; עם מסמך – משבצת "שכר משוער", מסך עם טבלת רכיבים, פירוט ו"מה אפשר לשפר", חודש קודם; 360px ו-412px בלי גלילה לרוחב; אין שגיאות JS.
// שימוש: node ui-pay-me.js <www-dir> [out.json] [shots-dir]
const fs = require('fs'); const path = require('path'); const H = require('./harness');
let fail = 0; const res = []; const check = (n, ok, info) => { if (!ok) fail++; res.push({ n, ok: !!ok }); console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined && !ok ? ' | ' + JSON.stringify(info).slice(0, 600) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const MS = (y, m, d, h, mi) => Date.UTC(y, m - 1, d, h, mi || 0);
const iv = (v) => ({ integerValue: String(v) }); const sv = (v) => ({ stringValue: v }); const av = (a) => ({ arrayValue: { values: a.map(sv) } });
const TD = 'projects/demo-largpeami/databases/(default)/documents/b/acme/tasks/';
const task = (id, f) => ({ document: { name: TD + id, fields: Object.assign({ txt: sv('משימה ' + id), late: sv('') }, f), createTime: '2026-11-03T09:00:00Z', updateTime: '2026-11-03T09:00:00Z' }, readTime: '2026-11-03T09:00:00Z' });
const TASKS = [
  task('n1', { cr: iv(MS(2026, 11, 1, 8)), dl: iv(MS(2026, 11, 2, 8)), st: sv('done'), sub: iv(MS(2026, 11, 1, 10)), to: av(['dana']), ow: sv('dana') }),
  task('n2', { cr: iv(MS(2026, 11, 1, 8)), dl: iv(MS(2026, 11, 1, 9)), st: sv('open'), sub: iv(0), to: av(['yossi']), txt: sv('משימה של יוסי') }),
];
const DAYS = {
  '2026-10': [{ d: '2026-10-10', bk: '6200', gross: 4000, ret: 0, disc: 0, h: { '09': 1000, 12: 3000 } }],
  '2026-11': [{ d: '2026-11-01', bk: '6200', gross: 2000, ret: 0, disc: 0, h: { '08': 300, '09': 200, 10: 100, 11: 400, 15: 1000 } }, { d: '2026-11-02', bk: '6200', gross: 1500, ret: 0, disc: 0 }],
};
const SECRET = 'SRC-SECRET-מנהל';
const COMP = [{ id: 'k1', k: 'tk', m: 'all', a: 200 }, { id: 'k2', k: 'sl', n: 'מדרגות מכירות', t: [{ min: 1000, a: 100 }, { min: 3000, a: 300 }], ss: 'hrs', src: SECRET, ai: 1 }, { id: 'k3', k: 'pc', n: 'אחוז', p: 10, th: 500, ss: 'day', amt: 1 }];

(async () => {
  const A = process.argv.slice(2), www = A[0], out = A.length > 2 ? A[1] : null, shots = A.length > 2 ? A[2] : A[1];
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const shot = async (pg, n) => { if (shots) { await pg.waitForTimeout(250); await pg.screenshot({ path: path.join(shots, n + '.png'), fullPage: true }); } };
  const browser = await H.launch();
  let DOC = null; // המסמך שהמנהל פרסם – לחלק העובד

  // ===== 1. מכשיר המנהל =====
  { const cfg = { mode: 'new', users: { ma: 'acme' }, biz: { acme: { dataRoot: 'b', features: {} } }, admins: { 'b/acme/|ma': 1 } };
    const x = await H.newPage(browser, www, cfg, [], 'm-pay'); const pg = x.page;
    const W = []; let deny = false; const net = { tasks: 0, sales: 0 };
    await x.ctx.route((u) => { const q = new URL(u); return q.port === '8080' && /\/documents\/b\/acme\/wv\//.test(decodeURIComponent(q.pathname)); }, (route) => {
      const rq = route.request(), id = decodeURIComponent(new URL(rq.url()).pathname).split('/wv/')[1], mt = rq.method();
      if (mt === 'GET') return route.fallback();
      let f = {}; try { f = JSON.parse(rq.postData() || '{}').fields || {}; } catch (e) { /* */ }
      if (deny && /^pay_/.test(id)) { W.push({ mt, id, st: 403 }); return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { code: 403, message: 'PERMISSION_DENIED', status: 'PERMISSION_DENIED' } }) }); }
      W.push({ mt, id, data: f.data && f.data.stringValue, m: f.m && f.m.stringValue, keys: Object.keys(f).sort().join() });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ name: id, fields: f }) }); });
    await x.ctx.route((u) => { const q = new URL(u); return q.port === '8080' && /:runQuery$/.test(q.pathname); }, (route) => {
      let c = ''; try { c = JSON.parse(route.request().postData()).structuredQuery.from[0].collectionId; } catch (e) { /* */ }
      if (c === 'tasks') { net.tasks++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TASKS) }); }
      return route.fallback(); });
    await x.ctx.route(/:5001\/.*/, async (route) => {
      const n = new URL(route.request().url()).pathname.split('/').pop(); let d = {}; try { d = JSON.parse(route.request().postData()).data; } catch (e) { /* */ }
      if (n === 'cxSales') { net.sales++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { days: DAYS[String(d.from).slice(0, 7)] || [], items: {} } }) }); }
      return route.fallback(); });
    await H.login(pg, 'ma@x.co'); if (await pg.$('[data-a=startBlank]')) { await pg.click('[data-a=startBlank]'); await sleep(300); }
    await sleep(800); await pg.evaluate(() => { const d = document.getElementById('dlg'); if (d && d.open) closeDlg(); });
    check('0 pay-me.js נטען (PayMe, pmSync, pmTile, pmView)', await pg.evaluate(() => typeof PayMe === 'object' && typeof pmSync === 'function' && typeof pmTile === 'function' && typeof pmView === 'function'));
    // הסנכרון האוטומטי (wvSched אחרי save) מושבת בזמן הבדיקה, כדי שלא ירוץ במקביל לקריאות הישירות; מוחזר בבדיקה 8
    await pg.evaluate(() => { clearTimeout(WVS.t); window.__wvS = wvSched; wvSched = function () {}; PayMe._reset(); });
    await pg.evaluate((C) => { const emp = S.cats.find((c) => c.kind === 'exp' && !c.hid && c.beh === 'emp'), inc = S.cats.find((c) => c.kind === 'inc' && !c.hid);
      S.subs.push({ id: 'pmA', cat: emp.id, name: 'דנה בדיקה', ext: { notes: 'הערה-סודית' }, pay: { mode: 'hr', rate: 40, m: 'מזומן', slip: false, uid: 'dana', from: '2026-09', rules: [], add: [{ id: 'a1', n: 'נסיעות', k: 'day', a: 10 }], comp: C, show: true } });
      S.subs.push({ id: 'pmB', cat: emp.id, name: 'יוסי אחר', pay: { mode: 'hr', rate: 99, m: 'מזומן', slip: false, uid: 'yossi', rules: [], add: [] } });
      S.subs.push({ id: 'pmC', cat: emp.id, name: 'בלי משתמש', pay: { mode: 'hr', rate: 50, m: 'מזומן', slip: false, uid: '', rules: [], add: [], show: true } });
      S.wh.push({ id: 'w1', sub: 'pmA', d: '2026-11-01', in: '08:00', out: '12:00', brk: 0, src: 'man' }, { id: 'w2', sub: 'pmA', d: '2026-11-02', in: '10:00', out: '14:00', brk: 0, src: 'man' },
        { id: 'w3', sub: 'pmA', d: '2026-10-10', in: '09:00', out: '13:00', brk: 0, src: 'man' }, { id: 'w4', sub: 'pmB', d: '2026-11-01', in: '08:00', out: '12:00', brk: 0, src: 'man' });
      // אוקטובר: בונוס אוטומטי מאושר בסכום 0 (k2) + בונוס ידני עם פירוט שהמנהל כתב
      S.bon.push({ id: 'b0', sub: 'pmA', mon: '2026-10', a: 0, n: 'מדרגות מכירות', src: 'auto', cid: 'k2', calc: 0, det: 'מכירות 4,000' }, { id: 'b1', sub: 'pmA', mon: '2026-10', a: 50, n: 'פירוט-ידני-של-המנהל' });
      S.enotes.push({ id: 'en1', sub: 'pmA', t: 'הערה-סודית-2', d: '2026-11-01' });
      if (inc) S.tx.push({ id: 'ti1', t: 'inc', kind: 'inc', cat: inc.id, amt: 100, date: '2026-11-02' });
      save(); localStorage.removeItem(LK('lp-wvpay')); }, COMP);
    W.length = 0;
    const r1 = await pg.evaluate(async () => { try { await pmSync(); return 'ok'; } catch (e) { return 'err:' + e.message; } });
    const puts = W.filter((w) => w.mt === 'PATCH'), dels = W.filter((w) => w.mt === 'DELETE');
    check('1 נכתב רק pay_ של העובד עם show+uid (דנה), לחודש הנוכחי ולקודם; לא ליוסי (בלי show) ולא לכרטיס בלי uid', r1 === 'ok' && puts.map((w) => w.id).sort().join() === 'pay_2026-10_dana,pay_2026-11_dana', { r1, W });
    check('1א השדות הקבועים של wv בלבד (at,data,h,m), m = החודש שבמזהה', puts.every((w) => w.keys === 'at,data,h,m' && w.m === w.id.split('_')[1]), puts.map((w) => [w.id, w.keys, w.m]));
    check('1ב כרטיס מקושר שהמתג שלו כבוי (יוסי): מחיקת pay_ שלו (פעם אחת בהפעלה), לא של דנה', dels.map((w) => w.id).sort().join() === 'pay_2026-10_yossi,pay_2026-11_yossi', dels);
    check('1ג טעינת משימות/מכירות רק לעובד עם show (שאילתה אחת לכל חודש)', net.tasks === 2 && net.sales >= 1 && net.sales <= 2, net);
    const nov = puts.find((w) => w.id === 'pay_2026-11_dana'), oct = puts.find((w) => w.id === 'pay_2026-10_dana');
    const D = nov ? JSON.parse(nov.data) : {}, O = oct ? JSON.parse(oct.data) : {}; DOC = D;
    const all = (nov ? nov.data : '') + (oct ? oct.data : '');
    check('2 בלי src / טקסט המנהל, בלי הערות, בלי שמות או נתונים של עובד אחר, בלי פירוט בונוס שהמנהל כתב', all && !/SRC-SECRET|"src"|הערה-סודית|יוסי|yossi|פירוט-ידני|"ai"|warnings|toAccountant|"sales"/.test(all), all.slice(0, 400));
    const row = (d, n) => (d.rows || []).find((r) => r.n === n) || null;
    const k2 = row(D, 'מדרגות מכירות'), k3 = row(D, 'אחוז'), k1 = row(D, 'בונוס משימות בזמן');
    // נובמבר: מכירות בשעות המשמרת = 1,000 (1.11 08–12) + 1,500 (2.11 בלי פילוח, לפי יום) = 2,500. מדרגות 1,000/3,000 → מדרגה 1 (100), חסרים 16.7% ל-3,000
    check('3 רכיב מכירות בלי amt: אין סכומי מכירות (לא 2,500 / 1,000 / 3,000) – רק מדרגה ואחוז מהיעד, כולל ב"מה אפשר לשפר"',
      k2 && !/2,500|2500|1,000|3,000|1,500/.test(JSON.stringify(k2)) && k2.a === 10000 && k2.s === 'exp' && /מדרגה 1 מתוך 2/.test(k2.det.join('|')) && /83\.3% מהיעד/.test(k2.det.join('|')) && /חסרים 16\.7% מהיעד/.test(k2.h.join('|')) && k2.bd === 1, k2);
    // ss:'day' = 2,000 + 1,500 = 3,500; 10% מעל 500 = 300
    check('3א רכיב עם amt:1 – עם סכומי מכירות (3,500), סכום 300', k3 && /3,500/.test(k3.det.join('|')) && k3.a === 30000 && /1,000 ₪/.test(k3.h.join('|')), k3);
    check('3ב רכיב משימות: 1 מתוך 1 בזמן, צפוי 200; שעות, ימים, שכר לפי שעות + תוספת', k1 && k1.a === 20000 && /1 מתוך 1/.test(k1.det.join('|')) && D.min === 480 && D.days === 2 && row(D, 'שכר לפי שעות').a === 32000 && row(D, 'נסיעות').a === 2000, { k1, min: D.min, rows: (D.rows || []).map((r) => [r.n, r.a]) });
    check('3ג שכר משוער = לפי שעות ותוספות + צפוי; צפוי לא ב"נשאר"', D.calc === 34000 && D.exp === 60000 && D.est === 94000 && D.left === 34000 && D.st === 'open' && D.slip === false, { calc: D.calc, exp: D.exp, est: D.est, left: D.left });
    check('4 אוקטובר: בונוס אוטומטי 0 שאושר – לא מוצג; בונוס ידני – "בונוס" בלי הפירוט של המנהל', O.rows && !row(O, 'מדרגות מכירות') && row(O, 'בונוס') && row(O, 'בונוס').a === 5000, O.rows && O.rows.map((r) => [r.n, r.a, r.s]));
    const bz = await pg.evaluate(() => { const s = S.subs.find((q) => q.id === 'pmA'); const m = PayOut._model(s, '2026-10'); return m && m.ms.bons.map((b) => b.id); });
    check('4א דוחות PayOut (גם לרואה החשבון): בונוס אוטומטי 0 לא ברשימת הבונוסים; הידני כן', JSON.stringify(bz) === '["b1"]', bz);
    // כתיבה רק כשהתוכן השתנה
    W.length = 0; await pg.evaluate(() => pmSync());
    check('5 הרצה חוזרת בלי שינוי – אין כתיבה ואין מחיקה', W.length === 0, W);
    await pg.evaluate(() => { S.wh.push({ id: 'w5', sub: 'pmA', d: '2026-11-03', in: '08:00', out: '09:00', brk: 0, src: 'man' }); }); W.length = 0; await pg.evaluate(() => pmSync());
    check('5א שעה נוספת בנובמבר – נכתב רק pay_2026-11_dana', W.map((w) => w.mt + ' ' + w.id).join() === 'PATCH pay_2026-11_dana', W);
    // uid השתנה
    await pg.evaluate(() => { S.subs.find((q) => q.id === 'pmA').pay.uid = 'dana2'; }); W.length = 0; await pg.evaluate(() => pmSync());
    check('6 uid השתנה: נכתב ל-dana2, ונמחקו שני המסמכים של dana', W.filter((w) => w.mt === 'PATCH').map((w) => w.id).sort().join() === 'pay_2026-10_dana2,pay_2026-11_dana2' && W.filter((w) => w.mt === 'DELETE').map((w) => w.id).sort().join() === 'pay_2026-10_dana,pay_2026-11_dana', W.map((w) => w.mt + ' ' + w.id));
    // מתג כבוי
    await pg.evaluate(() => { S.subs.find((q) => q.id === 'pmA').pay.show = false; }); W.length = 0; await pg.evaluate(() => pmSync());
    check('7 מתג כבוי: שני המסמכים נמחקו, אין כתיבה', W.filter((w) => w.mt === 'PATCH').length === 0 && W.filter((w) => w.mt === 'DELETE').map((w) => w.id).sort().join() === 'pay_2026-10_dana2,pay_2026-11_dana2', W.map((w) => w.mt + ' ' + w.id));
    // 403 על pay_ לא עוצר את inc_
    await pg.evaluate(() => { const s = S.subs.find((q) => q.id === 'pmA'); s.pay.show = true; s.pay.uid = 'dana'; localStorage.removeItem(WVK); localStorage.removeItem(LK('lp-wvpay')); PayMe._reset(); WVS.off = 0; wvSched = window.__wvS; });
    deny = true; W.length = 0; await pg.evaluate(() => wvSched()); await sleep(7000);
    const st = await pg.evaluate(() => ({ off: PayMe._st.PS.off > Date.now(), woff: WVS.off > Date.now() }));
    const inc = W.filter((w) => w.mt === 'PATCH' && /^inc_/.test(w.id)), p403 = W.filter((w) => w.st === 403);
    check('8 403 על pay_: inc_ עדיין נכתב (wvSync לא נעצר), pay נעצר ל-10 דקות, wv לא', p403.length >= 1 && inc.length === 2 && st.off && !st.woff, { inc: inc.map((w) => w.id), p403: p403.map((w) => w.id), st });
    W.length = 0; await pg.evaluate(() => pmSync());
    check('8א אחרי 403 – אין ניסיון נוסף ל-pay_ בעשר הדקות הקרובות', W.length === 0, W);
    check('9 אין שגיאות JS אצל המנהל', pg.__errors.length === 0, pg.__errors);
    await x.ctx.close(); }

  // ===== 2. מכשיר העובד =====
  { const cfg = { mode: 'new', users: { wa: 'acme' }, biz: { acme: { dataRoot: 'b', features: {} } }, staff: { 'b/acme/|wa': 1 } };
    const x = await H.newPage(browser, www, cfg, [], 'w-pay'); const pg = x.page; await pg.setViewportSize({ width: 360, height: 760 });
    const have = {}; const req = [];
    await x.ctx.route((u) => { const q = new URL(u); return q.port === '8080' && /\/documents\/b\/acme\/wv\/pay_/.test(decodeURIComponent(q.pathname)); }, (route) => {
      const id = decodeURIComponent(new URL(route.request().url()).pathname).split('/wv/')[1]; req.push(route.request().method() + ' ' + id);
      if (route.request().method() !== 'GET' || !have[id]) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 404, message: 'NOT_FOUND' } }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ name: id, fields: { data: sv(JSON.stringify(have[id])), h: sv('x'), m: sv(id.split('_')[1]), at: iv(MS(2026, 11, 3, 8, 30)) } }) }); });
    await H.login(pg, 'wa@x.co');
    const home = async () => { await pg.evaluate(() => { WS = 'home'; NAV = [{ v: 'wk' }]; render(0); }); await sleep(900); return pg.evaluate(() => !!document.querySelector('[data-pay-tile]')); };
    check('10 בלי מסמך – אין משבצת "שכר משוער" (ורק המסמכים של העובד עצמו נבדקו)', !(await home()) && req.length >= 1 && req.every((r) => /^GET pay_2026-1[01]_wa$/.test(r)), req);
    have['pay_2026-11_wa'] = Object.assign({}, DOC, { m: '2026-11' });
    await pg.evaluate(() => PayMe._reset());
    const t = await home();
    const tileTxt = await pg.evaluate(() => { const b = document.querySelector('[data-pay-tile]'); return b ? b.innerText.replace(/\s+/g, ' ') : ''; });
    check('11 עם מסמך – משבצת "שכר משוער" עם הסכום (940) ו"הסכום הסופי בסוף החודש"', t && /שכר משוער/.test(tileTxt) && /940/.test(tileTxt) && /הסכום הסופי בסוף החודש/.test(tileTxt), tileTxt);
    check('11א 360px – מסך הבית בלי גלילה לרוחב', await noOverflow(pg));
    await shot(pg, 'pay-me-1-בית-360');
    await pg.click('[data-pay-tile]'); await sleep(700);
    const v = await pg.evaluate(() => ({ t: document.getElementById('main').innerText, rows: document.querySelectorAll('[data-pay-tbl] [data-a=pmRow]').length, hero: (document.querySelector('[data-pay-hero]') || {}).innerText || '', at: (document.querySelector('[data-pay-at]') || {}).innerText || '' }));
    check('12 מסך "השכר שלי": כותרת "שכר משוער", טבלת רכיבים, "נכון ל-", צפוי ושולם', /שכר משוער/.test(v.hero) && /940/.test(v.hero) && /הסכום הסופי – בסוף החודש/.test(v.hero) && v.rows === (DOC.rows || []).length && v.rows >= 5 && /נכון ל-/.test(v.at) && /בונוס צפוי/.test(v.t) && /נשאר לקבל/.test(v.t), v);
    check('12א 360px – בלי גלילה לרוחב', await noOverflow(pg));
    await shot(pg, 'pay-me-2-טבלה-360');
    const i2 = (DOC.rows || []).findIndex((r) => r.n === 'מדרגות מכירות');
    await pg.click(`[data-a=pmRow][data-i="${i2}"]`); await sleep(300);
    const dt = await pg.evaluate(() => { const d = document.getElementById('dlg'); return d && d.open ? d.innerText : ''; });
    check('13 לחיצה על רכיב – פירוט + "מה אפשר לשפר" (אחוז מהיעד, בלי סכומי מכירות)', /מדרגה 1 מתוך 2/.test(dt) && /מה אפשר לשפר/.test(dt) && /16\.7%/.test(dt) && !/2,500/.test(dt), dt);
    check('13א 360px – הפירוט בלי גלילה לרוחב', await noOverflow(pg));
    await shot(pg, 'pay-me-3-פירוט-360');
    await pg.evaluate(() => closeDlg());
    await pg.click('[data-a=pmMon][data-m="2026-10"]'); await sleep(600);
    check('14 חודש קודם בלי מסמך – "המנהל עוד לא פרסם"', /עוד לא פרסם נתוני שכר/.test(await pg.evaluate(() => document.getElementById('main').innerText)));
    await pg.click('[data-a=pmMon][data-m="2026-11"]'); await sleep(300);
    await pg.setViewportSize({ width: 412, height: 860 }); await sleep(200);
    check('15 412px – בלי גלילה לרוחב', await noOverflow(pg) && (await pg.evaluate(() => document.querySelectorAll('[data-a=pmRow]').length)) >= 5);
    await shot(pg, 'pay-me-4-טבלה-412');
    check('16 העובד לא שולח כתיבה/מחיקה ל-pay_', req.every((r) => r.startsWith('GET ')), req);
    check('17 אין שגיאות JS אצל העובד', pg.__errors.length === 0, pg.__errors);
    await x.ctx.close(); }

  await browser.close();
  if (out) fs.writeFileSync(out, JSON.stringify({ res }, null, 1));
  console.log(fail ? `תוצאה: נכשל (${fail})` : 'תוצאה: הכול עבר'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
