'use strict';
// "כל ההכנסות" (inc-all.js, 20.11.2026): מנהל – סגירות והכנסות אחרות מהמכשיר + סגירה שרק בענן, קופה חדשה, כספית להשוואה והפרש;
// כל משבצת → לפי יום → הרשומות; בחירת עובדים שרואים. עובד מסומן (staff.incA) – כפתור בבית, בלי "אחר"; עובד לא מסומן – אין גישה.
// רשת מדומה, נתונים מומצאים. שימוש: node ui-inc-all.js <www-dir> [out.json] [shots-dir]. מסך טלפון קטן (360×740).
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const out = {}; let fail = 0;
const check = (name, ok, info) => { out[name] = { ok: !!ok, info }; if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'orders', 'pos', 'cxSales'].map((k) => [k, true]));
const SV = (v) => ({ stringValue: v });
const STAFF = { documents: [
  { name: 'projects/demo-largpeami/databases/(default)/documents/b/biz-o/staff/w1', fields: { name: SV('דוד בדיקה'), email: SV('w1@x.co'), role: SV('employee'), active: { booleanValue: true } } },
  { name: 'projects/demo-largpeami/databases/(default)/documents/b/biz-o/staff/w2', fields: { name: SV('משה בדיקה'), email: SV('w2@x.co'), role: SV('employee'), active: { booleanValue: true }, incA: { booleanValue: true } } },
  { name: 'projects/demo-largpeami/databases/(default)/documents/b/biz-o/staff/m', fields: { name: SV('המנהל'), role: SV('manager'), active: { booleanValue: true } } }] };
// השרת: zq1 – אותה סגירה שבמכשיר (לא נספרת פעמיים); zcl – סגירה שהוכנסה בענן ולא נמצאת במכשיר
const GET = { from: '2026-11-16', to: '2026-11-17',
  zc: { on: true, list: [{ id: 'zq1', reg: 'i_yh', d: '2026-11-16', od: '2026-11-16', tm: '21:00', no: '55', by: 'דנה', amt: 443.6, rows: [['אשראי', 300], ['מזומן', 143.6]] },
    { id: 'zcl', reg: 'i_nl', d: '2026-11-17', od: '2026-11-17', tm: '20:00', no: '9', by: 'יוסי', amt: 100, rows: [['אשראי', 100]] }] },
  pos: { on: true, days: { '2026-11-16': { s: 22.34, n: 2, r: 2.34, rn: 1, debt: 5 }, '2026-11-17': { s: 7.77, n: 1, r: 0, rn: 0, debt: 0 } } },
  cx: { on: true, reg: { 6200: 'i_yh' }, days: [{ d: '2026-11-16', bk: '6200', bn: 'יהודה הנשיא', gross: 200, ret: 10, disc: 5, ntx: 3, sp: 0 }, { d: '2026-11-17', bk: '6200', bn: 'יהודה הנשיא', gross: 50, ret: 0, disc: 0, ntx: 1, sp: 0, pt: { hm: '13:00' } }] } };
const DAY = { sales: [{ id: 'K1-S1', dev: 'K1', seq: 1, hm: '10:00', gross: 12.34, debt: 5, st: 'ok', cust: 'לקוח א' }, { id: 'K1-S4', dev: 'K1', seq: 4, hm: '11:00', gross: 99.99, debt: 0, st: 'void' }, { id: 'K1-S2', dev: 'K1', seq: 2, hm: '23:30', gross: 10, debt: 0, st: 'ok' }],
  rets: [{ id: 'K1-R1', dev: 'K1', hm: '12:00', amt: 2.34, st: 'ok', sale: 'K1-S1' }] };

async function open(browser, www, user, staffDoc, shots, tag) {
  const cfg = { mode: 'new', users: { [user]: 'biz-o' }, biz: { 'biz-o': { dataRoot: 'b', features: ALL, name: 'עסק בדיקה' } }, ctx: { hasTouch: true, isMobile: true } };
  if (user === 'm') cfg.admins = { 'b/biz-o/|m': 1 }; else cfg.staff = { ['b/biz-o/|' + user]: staffDoc || 1 };
  const log = []; const calls = [];
  const x = await H.newPage(browser, www, cfg, log, tag);
  await x.ctx.route(/:8080\/.*/, async (route) => {
    const u = new URL(route.request().url()); const p = decodeURIComponent(u.pathname);
    if (/\/b\/biz-o\/staff$/.test(p) && route.request().method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STAFF) });
    if (/:runQuery$/.test(u.pathname)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ readTime: '2026-11-03T09:00:00Z' }]) });
    return route.fallback();
  });
  await x.ctx.route(/:5001\/.*/, async (route) => {
    const n = new URL(route.request().url()).pathname.split('/').pop(); let d = {}; try { d = JSON.parse(route.request().postData()).data; } catch (e) { /* */ }
    calls.push({ n, d });
    if (n === 'incAll') {
      const r = d.op === 'get' ? Object.assign({}, GET, { from: d.from, to: d.to }) : d.op === 'day' ? DAY : { ok: true, uid: d.uid, on: d.on };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: r }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { ok: true } }) });
  });
  await H.login(x.page, user + '@x.co');
  await x.page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden && typeof ACT.startBlank === 'function') ACT.startBlank(); }).catch(() => {});
  await H.settle(x.page, 500);
  await x.page.setViewportSize({ width: 360, height: 740 });
  x.calls = calls; x.shot = async (nm) => { if (shots) await x.page.screenshot({ path: path.join(shots, 'inc-' + tag + '-' + nm + '.png') }).catch(() => {}); };
  return x;
}
const q = (page) => page.evaluate(() => { const R = document.querySelector('#dlg[open]') || document.querySelector('#main');
  const els = [...R.querySelectorAll('button, a, select, input:not([type=hidden]):not([type=checkbox]):not([type=file])')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  const small = els.filter((e) => { const r = e.getBoundingClientRect(); return r.height < 44 && !e.closest('label.f'); }).map((e) => (e.dataset.a || e.dataset.c || e.tagName) + ':' + Math.round(e.getBoundingClientRect().height));
  return { small, sw: document.documentElement.scrollWidth, iw: innerWidth, text: R.innerText.replace(/[‎‏]/g, ''), dir: getComputedStyle(R).direction }; });
const fine = (r) => r.small.length === 0 && r.sw <= r.iw && r.dir === 'rtl';
const range = async (page) => {
  await page.click('[data-a=incPer][data-k=custom]'); await H.settle(page, 200);
  await page.fill('form[data-f=incRange] input[name=from]', '2026-11-16'); await page.fill('form[data-f=incRange] input[name=to]', '2026-11-17');
  await page.click('form[data-f=incRange] button'); await H.settle(page, 700);
};

(async () => {
  const [www, outFile, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const browser = await H.launch();
  try {
    // ===== 1. מנהל =====
    { const x = await open(browser, www, 'm', null, shots, 'mgr'); const pg = x.page;
      // ספר ההכנסות במכשיר: סגירה zq1 (300 + 143.60), הכנסה אחרת 50 וזיכוי −20 (16.11), הכנסה שנמחקה (לא נספרת), הוצאה (לא הכנסה)
      await pg.evaluate(() => { S.zc = S.zc || []; S.zc.push({ id: 'zq1', reg: 'i_yh', d: '2026-11-16', tm: '21:00', od: '2026-11-16', no: '55', by: 'דנה', at: 1, tx: ['ztx1', 'ztx2'] });
        S.tx.push({ id: 'ztx1', src: 'zc:zq1', t: 'inc', cat: 'i_yh', date: '2026-11-16', amt: 300, note: 'סגירת קופה', pays: [] }, { id: 'ztx2', src: 'zc:zq1', t: 'inc', cat: 'i_yh', date: '2026-11-16', amt: 143.6, note: 'סגירת קופה', pays: [] },
          { id: 'o1', t: 'inc', cat: 'i_yh', date: '2026-11-16', amt: 50, note: 'אירוע פרטי', pays: [] }, { id: 'o2', t: 'inc', cat: 'i_yh', date: '2026-11-16', amt: -20, note: 'זיכוי ללקוח', pays: [] },
          { id: 'o3', t: 'inc', cat: 'i_yh', date: '2026-11-16', amt: 999, note: 'נמחק', x: 1, pays: [] }, { id: 'e1', t: 'exp', cat: 'e_own', date: '2026-11-16', amt: 70, pays: [] }); });
      await pg.evaluate(() => { NAV = [{ v: 'home' }]; go('more'); }); await H.settle(pg, 500);
      const mo = await q(pg);
      check('1 "עוד" (מנהל): "כל ההכנסות"', /כל ההכנסות/.test(mo.text) && fine(mo), { small: mo.small });
      await pg.click('[data-a=go][data-v=incAll]'); await H.settle(pg, 800);
      const g0 = x.calls.filter((c) => c.n === 'incAll' && c.d.op === 'get').pop();
      check('2 כניסה: תקופה "היום" – בקשה אחת לשרת עם תאריך אחד', g0 && g0.d.from === g0.d.to && /^\d{4}-\d{2}-\d{2}$/.test(g0.d.from), g0 && g0.d);
      await range(pg);
      const g1 = x.calls.filter((c) => c.n === 'incAll' && c.d.op === 'get').pop();
      check('3 טווח חופשי נשלח לשרת (16–17.11)', g1 && g1.d.from === '2026-11-16' && g1.d.to === '2026-11-17', g1 && g1.d);
      const s = await q(pg); await x.shot('summary');
      // סגירות 443.60 (מכשיר) + 100 (ענן) = 543.60; קופה חדשה 22.34 − 2.34 + 7.77 = 27.77; אחר 50 − 20 = 30; סך 601.37. כספית 185 + 50 = 235; הפרש 16.11: 185 − 443.60 = −258.60
      check('4 משבצות: סך 601.37, סגירות 543.60, קופה חדשה 27.77, אחר 30.00; מגע ≥44, RTL, בלי גלילה לצד', fine(s) && /סך ההכנסות\s*601\.37/.test(s.text) && /סגירות קופה\s*543\.60/.test(s.text) && /קופה חדשה\s*27\.77/.test(s.text) && /הכנסות אחרות\s*30\.00/.test(s.text), { small: s.small, t: s.text.slice(0, 500) });
      check('5 כספית בנפרד: 235.00, "לא נכלל בסך", הפרש 258.60- ליום אחד שאפשר להשוות', /כספית – להשוואה בלבד/.test(s.text) && /מכירות כספית \(נטו\)\s*235\.00[^\n]*\s*לא נכלל בסך/.test(s.text) && /הפרש כספית מול סגירות\s*(-258\.60|258\.60-)[^\n]*\s*1 ימים/.test(s.text), s.text.slice(0, 900));
      check('6 הקפה בקופה החדשה + סגירה מהענן מוסברות', /בהקפה: 5\.00/.test(s.text) && /נוספה מהענן/.test(s.text));
      check('7 לפי יום: 17.11 עם "חלקי – עד השעה 13:00", 16.11 עם "פער"', /17\/11\/2026[\s\S]*חלקי – עד השעה 13:00/.test(s.text) && /16\/11\/2026[\s\S]*פער/.test(s.text), s.text.slice(-700));
      // משבצת סגירות → לפי יום → הרשומות
      await pg.click('[data-a=incDl][data-k=zc]'); await H.settle(pg, 300);
      const z1 = await q(pg); await x.shot('zc-days');
      check('8 סגירות לפי יום: 16.11 443.60, 17.11 100.00, סה"כ 543.60', /סגירות קופה · לפי יום/.test(z1.text) && /443\.60/.test(z1.text) && /100\.00/.test(z1.text) && /סה"כ\s*543\.60/.test(z1.text) && z1.small.length === 0, z1);
      await pg.click('#dlg [data-a=incDay][data-k=zc][data-d="2026-11-17"]'); await H.settle(pg, 300);
      const z2 = await q(pg);
      check('9 יום → הסגירה מהענן: דוח Z 9, הקופה (עסק חדש: "קופה"), "מהענן", יוסי', /דוח Z 9 · קופה/.test(z2.text) && /מהענן/.test(z2.text) && /יוסי/.test(z2.text) && z2.small.length === 0, z2.text.slice(0, 300));
      await pg.click('#dlg [data-a=incDl][data-k=zc]'); await H.settle(pg, 200);
      await pg.click('#dlg [data-a=incDay][data-k=zc][data-d="2026-11-16"]'); await H.settle(pg, 300);
      const z3 = await q(pg);
      check('10 "לכל הימים" חוזר; 16.11 → דוח Z 55 מהמכשיר: 300.00 + 143.60, בלי "מהענן"', /דוח Z 55/.test(z3.text) && /300\.00/.test(z3.text) && /143\.60/.test(z3.text) && !/מהענן/.test(z3.text), z3.text.slice(0, 300));
      await pg.evaluate(() => closeDlg());
      // קופה חדשה → יום → מכירות מהשרת
      await pg.click('[data-a=incDl][data-k=pos]'); await H.settle(pg, 300);
      await pg.click('#dlg [data-a=incDay][data-k=pos][data-d="2026-11-16"]'); await H.settle(pg, 700);
      const p1 = await q(pg); await x.shot('pos-day');
      const dc = x.calls.filter((c) => c.n === 'incAll' && c.d.op === 'day').pop();
      check('11 יום בקופה החדשה: op:day לשרת; מכירות 2 (מבוטלת מסומנת ולא נספרת), הקפה, החזרה, סה"כ 20.00', dc && dc.d.d === '2026-11-16' && /מכירות \(2\)/.test(p1.text) && /בוטלה – לא נספרה/.test(p1.text) && /בהקפה/.test(p1.text) && /לקוח א/.test(p1.text) && /החזרות \(1\)/.test(p1.text) && /סה"כ אחרי החזרות\s*20\.00/.test(p1.text) && p1.small.length === 0, { t: p1.text.slice(0, 500), small: p1.small });
      await pg.click('#dlg [data-a=incDl][data-k=pos]'); await H.settle(pg, 200);
      await pg.click('#dlg [data-a=incDay][data-k=pos][data-d="2026-11-16"]'); await H.settle(pg, 400);
      check('12 אותו יום שוב – בלי בקשה נוספת לשרת', x.calls.filter((c) => c.n === 'incAll' && c.d.op === 'day').length === 1);
      await pg.evaluate(() => closeDlg());
      // אחר → יום → הרשומות
      await pg.click('[data-a=incDl][data-k=oth]'); await H.settle(pg, 300);
      await pg.click('#dlg [data-a=incDay][data-k=oth][data-d="2026-11-16"]'); await H.settle(pg, 300);
      const o1 = await q(pg);
      check('13 הכנסות אחרות: אירוע פרטי 50, זיכוי −20, בלי הנמחקת ובלי ההוצאה, סה"כ 30.00', /אירוע פרטי/.test(o1.text) && /זיכוי ללקוח/.test(o1.text) && /(-20\.00|20\.00-)/.test(o1.text) && !/נמחק/.test(o1.text) && /סה"כ\s*30\.00/.test(o1.text) && o1.small.length === 0, o1.text.slice(0, 300));
      await pg.evaluate(() => closeDlg());
      // כספית → יום → הסניפים, עם ההפרש
      await pg.click('[data-a=incDl][data-k=cx]'); await H.settle(pg, 300);
      await pg.click('#dlg [data-a=incDay][data-k=cx][data-d="2026-11-16"]'); await H.settle(pg, 300);
      const c1 = await q(pg); await x.shot('cx-day');
      check('14 כספית 16.11: יהודה הנשיא, פדיון 200, נטו 185, "להשוואה בלבד", פער מול סגירות 443.60', /להשוואה בלבד/.test(c1.text) && /יהודה הנשיא/.test(c1.text) && /200\.00/.test(c1.text) && /נטו\s*185\.00/.test(c1.text) && /פער/.test(c1.text) && /סגירות 443\.60/.test(c1.text) && c1.small.length === 0, c1.text.slice(0, 400));
      await pg.evaluate(() => closeDlg());
      await pg.click('[data-a=incDl][data-k=gap]'); await H.settle(pg, 300);
      const gp = await q(pg);
      check('15 משבצת ההפרש → הימים: רק 16.11 (17.11 חלקי), כספית 185 וסגירה 443.60 לחיצים', /16\/11\/2026/.test(gp.text) && !/17\/11\/2026/.test(gp.text) && /185\.00/.test(gp.text) && /443\.60/.test(gp.text) && gp.small.length === 0, gp.text.slice(0, 300));
      await pg.evaluate(() => closeDlg());
      // כרטיס יום → הרשומות
      await pg.click('#main [data-a=incDay][data-k=oth][data-d="2026-11-16"]'); await H.settle(pg, 300);
      check('16 סכום בכרטיס היום פותח את הרשומות', /אירוע פרטי/.test((await q(pg)).text));
      await pg.evaluate(() => closeDlg());
      // בחירת עובדים
      await pg.click('[data-a=go][data-v=incSee]'); await H.settle(pg, 1200);
      const se = await q(pg); await x.shot('see');
      const st = await pg.evaluate(() => [...document.querySelectorAll('[data-c=incSeeT]')].map((e) => [e.dataset.uid, e.checked, Math.round(e.closest('label').getBoundingClientRect().height)]));
      check('17 בחירת עובדים: שני העובדים בלי המנהל; w2 מסומן; שורה ≥44', /דוד בדיקה/.test(se.text) && /משה בדיקה/.test(se.text) && JSON.stringify(st.map((r) => r.slice(0, 2))) === '[["w1",false],["w2",true]]' && st.every((r) => r[2] >= 44) && fine(se), st);
      await pg.click('[data-c=incSeeT][data-uid=w1]'); await H.settle(pg, 800);
      const sc = x.calls.filter((c) => c.n === 'incAll' && c.d.op === 'see');
      check('18 סימון עובד שולח incAll { op:see, uid:w1, on:true }', sc.length === 1 && sc[0].d.uid === 'w1' && sc[0].d.on === true, sc);
      check('19 בלי שגיאות JavaScript (מנהל)', !pg.__errors.length, pg.__errors.slice(0, 3));
      await x.ctx.close(); }

    // ===== 2. עובד מסומן =====
    { const x = await open(browser, www, 'w2', { incA: true }, shots, 'emp'); const pg = x.page;
      await pg.evaluate(() => { WS = 'home'; NAV = [{ v: 'wk' }]; render(0); }); await sleep(900);
      check('20 עובד מסומן: כפתור "כל ההכנסות" בבית', await pg.evaluate(() => !!document.querySelector('[data-a=go][data-v=incAll]')));
      await x.shot('home');
      await pg.click('[data-a=go][data-v=incAll]'); await H.settle(pg, 800);
      await range(pg);
      const s = await q(pg); await x.shot('summary');
      // בלי "אחר": סגירות מהשרת 543.60 + קופה חדשה 27.77 = 571.37
      check('21 עובד: סך 571.37 (סגירות מהשרת + קופה חדשה), בלי משבצת "אחר", עם הסבר; בלי בחירת עובדים', fine(s) && /סך ההכנסות\s*571\.37/.test(s.text) && !/הכנסות אחרות\s*[\d-]/.test(s.text) && /נשמרות רק במכשיר המנהל/.test(s.text) && !/עובדים שרואים/.test(s.text), { small: s.small, t: s.text.slice(0, 500) });
      await pg.evaluate(() => { NAV = [{ v: 'incSee' }]; render(0); }); await sleep(600);
      check('22 עובד לא נכנס לבחירת העובדים', /למנהל בלבד/.test((await q(pg)).text));
      check('23 בלי שגיאות JavaScript (עובד מסומן)', !pg.__errors.length, pg.__errors.slice(0, 3));
      await x.ctx.close(); }

    // ===== 3. עובד לא מסומן =====
    { const x = await open(browser, www, 'w1', null, shots, 'emp0'); const pg = x.page;
      await pg.evaluate(() => { WS = 'home'; NAV = [{ v: 'wk' }]; render(0); }); await sleep(900);
      check('24 עובד לא מסומן: אין כפתור בבית', !(await pg.evaluate(() => !!document.querySelector('[data-a=go][data-v=incAll]'))));
      await pg.evaluate(() => { NAV = [{ v: 'incAll' }]; render(0); }); await sleep(800);
      const e = await q(pg);
      check('25 כניסה ישירה – "אין לך הרשאה", בלי קריאה לשרת', /אין לך הרשאה/.test(e.text) && !x.calls.some((c) => c.n === 'incAll'), e.text.slice(0, 100));
      await x.ctx.close(); }
  } catch (e) { console.error(e); fail++; }
  await browser.close();
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
  console.log(fail ? 'נכשלו ' + fail : 'הכול עבר');
  process.exit(fail ? 1 : 0);
})();
