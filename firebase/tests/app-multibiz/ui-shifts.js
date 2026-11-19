'use strict';
// משמרות (shifts.js באפליקציה, 18.11.2026): טבלה שבועית (משמרת שחוצה חצות, חור באדום, גלילה לצד), לחיצה על משמרת (משימות + שליחה),
// "משמרת קבועה?" חובה ביצירה, "רק הפעם / מכאן והלאה" בעריכה ובמחיקה של קבועה, הגדרות מנהל (סף איחור, שעת התראה, שעות פעילות, טבלת התאמה),
// עובד בלי הרשאה – רק המשמרות שלו בלי עריכה, עובד עם shf – עורך בלי הגדרות, המתג shf ב-PMK, והתראה k:'sh'.
// סבב בדיקה 1: משימה שלא נשלחה (orph) באדום, מופע שעבר בלי עריכה, "מכאן והלאה" לתאריך מוקדם / תאריך שעבר – לא נשלח.
// רשת מדומה, נתונים מומצאים. שימוש: node ui-shifts.js <www-dir> [out.json] [shots-dir]. מסך טלפון קטן (360×740).
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const out = {}; let fail = 0;
const check = (name, ok, info) => { out[name] = { ok: !!ok, info }; if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
const enc = (v) => (typeof v === 'boolean' ? { booleanValue: v } : { stringValue: String(v) });
const IL = (d, hm) => Date.parse(d + 'T' + hm + ':00+02:00');
const DAYS = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07'];
const STAFF = [{ uid: 'm', name: 'המנהל', mgr: true }, { uid: 'w', name: 'דנה', mgr: false }, { uid: 'w2', name: 'יוסי', mgr: false }];
const OCC = [
  { id: 'A_2026-11-03', sid: 'A', day: '2026-11-03', s: '08:00', e: '14:00', u: 'w', nm: 'דנה', fx: true, nt: '', start: IL('2026-11-03', '08:00'), end: IL('2026-11-03', '14:00'), x: false },
  { id: 'B_2026-11-03', sid: 'B', day: '2026-11-03', s: '20:00', e: '02:00', u: 'w2', nm: 'יוסי', fx: false, nt: 'סגירה', start: IL('2026-11-03', '20:00'), end: IL('2026-11-04', '02:00'), x: true },
  { id: 'D_2026-11-05', sid: 'D', day: '2026-11-05', s: '16:00', e: '20:00', u: 'w2', nm: 'יוסי', fx: true, nt: '', start: IL('2026-11-05', '16:00'), end: IL('2026-11-05', '20:00'), x: false },
  { id: 'P_2026-11-02', sid: 'P', day: '2026-11-02', s: '08:00', e: '10:00', u: 'w2', nm: 'יוסי', fx: false, nt: '', start: IL('2026-11-02', '08:00'), end: IL('2026-11-02', '10:00'), x: false },
  { id: 'C_2026-11-04', sid: 'C', day: '2026-11-04', s: '10:00', e: '12:00', u: '', nm: '', fx: false, nt: '', start: IL('2026-11-04', '10:00'), end: IL('2026-11-04', '12:00'), x: false },
];
const WEEK = (full, mgr, uid) => (full ? { from: DAYS[0], days: DAYS, today: '2026-11-03', now: 0, full: true, mgr, occ: OCC, hrs: [1, 1, 1, 1, 1, 1, null], holes: { '2026-11-03': [['14:00', '20:00']] }, tasks: { 'B_2026-11-03': [{ id: 't1', txt: 'לספור קופה', st: 'wait', bn: 'm', at: 1 }] }, orph: [{ id: 't9', txt: 'משימה שהלכה לאיבוד', st: 'orph', day: '2026-11-02', why: 'moved' }], staff: STAFF }
  : { from: DAYS[0], days: DAYS, today: '2026-11-03', now: 0, full: false, mgr: false, occ: OCC.filter((o) => o.u === uid) });

async function open(browser, www, who, perms, calls) {
  const cfg = { mode: 'new', users: { m: 'biz-o', w: 'biz-o' }, biz: { 'biz-o': { dataRoot: 'b', features: ALL, name: 'עסק בדיקה' } }, admins: { 'b/biz-o/|m': 1 }, staff: { 'b/biz-o/|w': 1 }, ctx: { hasTouch: true, isMobile: true } };
  const { ctx, page } = await H.newPage(browser, www, cfg, [], who);
  if (perms) await ctx.route((u) => u.port === '8080' && /\/staff\/w$/.test(u.pathname), (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ name: 'x', fields: { active: { booleanValue: true }, perms: { mapValue: { fields: Object.fromEntries(Object.entries(perms).map(([k, v]) => [k, enc(v)])) } } } }) }));
  await ctx.route(/:5001\/.*/, async (route) => {
    const n = new URL(route.request().url()).pathname.split('/').pop(); let d = {}; try { d = JSON.parse(route.request().postData()).data; } catch (e) { /* */ }
    calls.push({ n, d });
    let R = { ok: true };
    if (n === 'shApi' && d.op === 'week') R = WEEK(who === 'm' || !!(perms && perms.shf), who === 'm', who);
    if (n === 'shApi' && d.op === 'task') R = { ok: true, id: 't2', st: 'wait' };
    if (n === 'shApi' && (d.op === 'cfg' || d.op === 'setCfg')) R = { cfg: { late: 5, at: '07:00', hrs: null }, map: { 'דנה כ.': 'w' }, staff: STAFF };
    if (n === 'getBackupKey') R = { key: Buffer.alloc(32, 7).toString('base64') };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: R }) });
  });
  await H.login(page, who + '@x.co');
  await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden && typeof ACT.startBlank === 'function') ACT.startBlank(); });
  await H.settle(page, 500);
  await page.setViewportSize({ width: 360, height: 740 });
  return { ctx, page };
}
const q = (page) => page.evaluate(() => { const R = document.querySelector('#dlg[open]') || document.querySelector('#main');
  const els = [...R.querySelectorAll('button, a, select, input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  const small = els.filter((e) => { const r = e.getBoundingClientRect(); return r.height < 44; }).map((e) => (e.dataset.a || e.name || e.tagName) + ':' + Math.round(e.getBoundingClientRect().height));
  return { small, sw: document.documentElement.scrollWidth, iw: innerWidth, text: R.innerText.replace(/[‎‏]/g, ''), dir: getComputedStyle(R).direction }; });
const fine = (r) => r.small.length === 0 && r.sw <= r.iw && r.dir === 'rtl';

(async () => {
  const [www, outFile, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const browser = await H.launch();
  // ---- מנהל ----
  let calls = [];
  let { ctx, page } = await open(browser, www, 'm', null, calls);
  check('0 משבצת "משמרות" במסך ה-+ של המנהל; המתג shf ב-PMK', await page.evaluate(() => /משמרות/.test(window.shTile()) && PMK.some((x) => x[0] === 'shf' && /משמרות/.test(x[1]))));
  await page.evaluate(() => { NAV = [{ v: 'home' }]; go('shf'); }); await H.settle(page, 700);
  let v = await q(page);
  if (shots) await page.screenshot({ path: path.join(shots, 'shifts.png') });
  check('1 טבלה שבועית: ימים, משמרות, חציית חצות, חור באדום, משמרת בלי עובד, משימות; RTL, מגע ≥44, בלי גלילה של הדף לצד',
    /שלישי/.test(v.text) && /08:00–14:00/.test(v.text) && /20:00–02:00 ☾/.test(v.text) && /אין עובדים 14:00–20:00/.test(v.text) && /בלי עובד/.test(v.text) && /📋 1 משימות/.test(v.text) && /\+ משמרת/.test(v.text) && /הגדרות/.test(v.text) && fine(v), { small: v.small, sw: v.sw, t: v.text.slice(0, 200) });
  check('1א הטבלה נגללת לצד בתוך המסגרת שלה', await page.evaluate(() => { const w = document.querySelector('.shw'); return w.scrollWidth > w.clientWidth && getComputedStyle(w).overflowX === 'auto'; }));
  await page.click('[data-a=shOpen][data-k="B_2026-11-03"]'); await H.settle(page, 300);
  v = await q(page);
  check('2 לחיצה על משמרת: פרטים, "נגמרת למחרת", משימה ממתינה, שליחה, עריכה ומחיקה', /יוסי/.test(v.text) && /נגמרת למחרת/.test(v.text) && /לספור קופה/.test(v.text) && /תוצג לעובד בתחילת המשמרת/.test(v.text) && /עריכה/.test(v.text) && fine(v), v.small);
  await page.fill('#dlg textarea[name=txt]', 'לסדר מדף'); await page.click('#dlg form[data-f=shTaskF] button'); await H.settle(page, 400);
  check('2א שליחת משימה → shApi task עם occ ו-txt', calls.some((c) => c.n === 'shApi' && c.d.op === 'task' && c.d.occ === 'B_2026-11-03' && c.d.txt === 'לסדר מדף'));
  await page.evaluate(() => closeDlg());
  await page.click('[data-a=shNew]'); await H.settle(page, 300);
  v = await q(page);
  check('3 משמרת חדשה: שאלה "משמרת קבועה?" בלי בחירה מראש', /משמרת קבועה\?/.test(v.text) && await page.evaluate(() => ![...document.querySelectorAll('#dlg input[name=fx]')].some((r) => r.checked)) && fine(v), v.small);
  const n0 = calls.length;
  await page.evaluate(() => { const f = document.querySelector('#dlg form[data-f=shSaveF]'); f.querySelector('[name=u]').value = 'w2'; f.querySelector('[name=s]').value = '20:00'; f.querySelector('[name=e]').value = '02:00'; FRM.shSaveF(f); });
  await H.settle(page, 300);
  check('3א בלי בחירה – לא נשלח כלום', calls.length === n0);
  await page.evaluate(() => { const f = document.querySelector('#dlg form[data-f=shSaveF]'); f.querySelector('input[name=fx][value="1"]').checked = true; FRM.shSaveF(f); });
  await H.settle(page, 400);
  check('3ב בחירה "כן" → save עם fx:true, חציית חצות', calls.some((c) => c.n === 'shApi' && c.d.op === 'save' && c.d.fx === true && c.d.s === '20:00' && c.d.e === '02:00' && c.d.u === 'w2' && !c.d.id));
  await H.settle(page, 400);
  await page.click('[data-a=shOpen][data-k="A_2026-11-03"]'); await H.settle(page, 300);
  await page.click('#dlg [data-a=shEdit]'); await H.settle(page, 300);
  await page.evaluate(() => { const f = document.querySelector('#dlg form[data-f=shSaveF]'); f.querySelector('[name=s]').value = '09:00'; FRM.shSaveF(f); });
  await H.settle(page, 300);
  v = await q(page);
  check('4 עריכה של קבועה: "רק הפעם / מכאן והלאה"', /רק הפעם/.test(v.text) && /מכאן והלאה/.test(v.text) && fine(v), v.small);
  await page.click('#dlg [data-a=shMode][data-v=one]'); await H.settle(page, 400);
  check('4א "רק הפעם" → save עם id, day, mode one', calls.some((c) => c.n === 'shApi' && c.d.op === 'save' && c.d.id === 'A' && c.d.day === '2026-11-03' && c.d.mode === 'one' && c.d.s === '09:00'));
  await H.settle(page, 400);
  await page.click('[data-a=shOpen][data-k="A_2026-11-03"]'); await H.settle(page, 300);
  await page.click('#dlg [data-a=shDel]'); await H.settle(page, 300);
  await page.click('#dlg [data-a=shMode][data-v=fwd]'); await H.settle(page, 400);
  check('5 מחיקת קבועה "מכאן והלאה" → del עם mode fwd', calls.some((c) => c.n === 'shApi' && c.d.op === 'del' && c.d.id === 'A' && c.d.mode === 'fwd' && c.d.day === '2026-11-03'));
  await H.settle(page, 400);
  await page.evaluate(() => go('shfCfg')); await H.settle(page, 600);
  v = await q(page);
  if (shots) await page.screenshot({ path: path.join(shots, 'shifts-cfg.png'), fullPage: true });
  check('6 הגדרות: שעת התראה, סף איחור, שעות פעילות (הצעה), טבלת התאמה', /שעת ההתראה היומית/.test(v.text) && /סף איחור/.test(v.text) && /הצעה – עוד לא נשמרה/.test(v.text) && /שבת/.test(v.text) && /עובדים בכספית/.test(v.text) && (await page.inputValue('input[name=mn0]')) === 'דנה כ.' && fine(v), { small: v.small, sw: v.sw });
  await page.click('[data-a=shMapAdd]'); await H.settle(page, 200);
  await page.fill('input[name=mn1]', 'יוסי כספית'); await page.selectOption('select[name=mu1]', 'w2');
  await page.fill('input[name=late]', '7');
  await page.click('form[data-f=shCfgF] > button'); await H.settle(page, 500);
  const sc = calls.filter((c) => c.n === 'shApi' && c.d.op === 'setCfg').pop();
  check('6א שמירה → setCfg: late 7, at 07:00, 7 ימים (שבת סגור), טבלת התאמה', sc && sc.d.late === 7 && sc.d.at === '07:00' && sc.d.hrs.length === 7 && sc.d.hrs[6] === null && sc.d.hrs[0].s === '08:00' && sc.d.map['דנה כ.'] === 'w' && sc.d.map['יוסי כספית'] === 'w2', sc && sc.d);
  // סבב בדיקה 1: משימה שלא נשלחה מוצגת; מופע שעבר – בלי עריכה; "מכאן והלאה" לתאריך מוקדם – לא נשלח
  await page.evaluate(() => { NAV = [{ v: 'home' }]; go('shf'); }); await H.settle(page, 600);
  v = await q(page);
  check('7א משימה שלא נשלחה – באדום, עם מחיקה', /משימה שלא נשלחה \(המשמרת השתנתה\): משימה שהלכה לאיבוד/.test(v.text) && !!(await page.$('[data-a=shTDel][data-k=t9]')) && fine(v), v.small);
  await page.click('[data-a=shOpen][data-k="P_2026-11-02"]'); await H.settle(page, 300);
  v = await q(page);
  check('7ב מופע שעבר: "אי אפשר לשנות", בלי עריכה ומחיקה', /אי אפשר לשנות/.test(v.text) && !(await page.$('#dlg [data-a=shEdit]')) && !(await page.$('#dlg [data-a=shDel]')));
  await page.evaluate(() => closeDlg());
  await page.click('[data-a=shOpen][data-k="D_2026-11-05"]'); await H.settle(page, 300);
  await page.click('#dlg [data-a=shEdit]'); await H.settle(page, 300);
  const n1 = calls.length;
  await page.evaluate(() => { const f = document.querySelector('#dlg form[data-f=shSaveF]'); f.querySelector('[name=d]').value = '2026-11-04'; FRM.shSaveF(f); });
  await H.settle(page, 300);
  await page.click('#dlg [data-a=shMode][data-v=fwd]'); await H.settle(page, 300);
  check('7ג "מכאן והלאה" לתאריך שלפני המופע – לא נשלח; גם תאריך שעבר – לא נשלח', calls.filter((c) => c.n === 'shApi' && c.d.op === 'save').length === calls.slice(0, n1).filter((c) => c.n === 'shApi' && c.d.op === 'save').length);
  await page.evaluate(() => { closeDlg(); ACT.shEdit({ dataset: { k: 'D_2026-11-05' } }); const f = document.querySelector('#dlg form[data-f=shSaveF]'); f.querySelector('[name=d]').value = '2026-11-01'; FRM.shSaveF(f); });
  await H.settle(page, 300);
  check('7ד תאריך שעבר בעריכה – לא נשלח, בלי שאלת "רק הפעם"', !/מכאן והלאה/.test((await q(page)).text) && calls.filter((c) => c.n === 'shApi' && c.d.op === 'save').length === calls.slice(0, n1).filter((c) => c.n === 'shApi' && c.d.op === 'save').length);
  await page.evaluate(() => closeDlg());
  check('7 בלי שגיאות JavaScript (מנהל)', page.__errors.length === 0, page.__errors.slice(0, 3));
  await ctx.close();
  // ---- עובד בלי הרשאה ----
  calls = [];
  ({ ctx, page } = await open(browser, www, 'w', null, calls));
  check('8 עובד בלי shf: כפתור "המשמרות שלי", בלי משבצת מנהל', await page.evaluate(() => /המשמרות שלי/.test(window.shBtn()) && !window.shTile()));
  await page.evaluate(() => { NAV = [{ v: 'home' }]; go('shf'); }); await H.settle(page, 700);
  v = await q(page);
  check('8א רק המשמרות שלו, בלי "+ משמרת", בלי חורים, בלי הגדרות', /08:00–14:00/.test(v.text) && !/20:00–02:00/.test(v.text) && !/\+ משמרת/.test(v.text) && !/אין עובדים/.test(v.text) && !/הגדרות/.test(v.text) && fine(v), { t: v.text.slice(0, 200), small: v.small });
  await page.click('[data-a=shOpen][data-k="A_2026-11-03"]'); await H.settle(page, 300);
  v = await q(page);
  check('8ב לחיצה – פרטים בלבד, בלי עריכה ומשימות', /משמרת קבועה/.test(v.text) && !/עריכה/.test(v.text) && !/משימות למשמרת/.test(v.text));
  check('8ג התראה k:sh פותחת את המסך (shOpen)', await page.evaluate(() => { closeDlg(); NAV = [{ v: 'home' }]; render(); window.shOpen(); return cur().v === 'shf'; }));
  check('9 בלי שגיאות JavaScript (עובד)', page.__errors.length === 0, page.__errors.slice(0, 3));
  await ctx.close();
  // ---- עובד עם shf ----
  calls = [];
  ({ ctx, page } = await open(browser, www, 'w', { shf: true, incW: true, expW: true, expR: true }, calls));
  await page.evaluate(() => { NAV = [{ v: 'home' }]; go('shf'); }); await H.settle(page, 700);
  v = await q(page);
  check('10 עובד עם shf: רואה הכול ועורך ("+ משמרת"), בלי הגדרות', /20:00–02:00/.test(v.text) && /\+ משמרת/.test(v.text) && !/הגדרות/.test(v.text) && await page.evaluate(() => /משמרות/.test(window.shBtn()) && !/המשמרות שלי/.test(window.shBtn())), v.text.slice(0, 200));
  check('11 בלי שגיאות JavaScript (עובד עם shf)', page.__errors.length === 0, page.__errors.slice(0, 3));
  await ctx.close();
  await browser.close();
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
  console.log(fail ? `נכשלו ${fail}` : 'הכול עבר');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
