'use strict';
// שעות עובדים (cx-hours.js באפליקציה, סבב 2, 22.11.2026): כספית מול השעון של הקופה, "לבדוק" בהפרש מעל 5 דקות (6 – כן, 4 – לא),
// רשומה רק באחד המקורות, התאמה לפי שם + "אשר", שם כפול → "לבדוק" בלי הצעה + בחירה ידנית, משבצות לחיצות, מנהל רואה / עובד לא.
// רשת מדומה, נתונים מומצאים. שימוש: node ui-cx-hours.js <www-dir> [out.json] [shots-dir]. מסך טלפון קטן (360×740).
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const out = {}; let fail = 0;
const check = (name, ok, info) => { out[name] = { ok: !!ok, info }; if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders', 'pos'].map((k) => [k, true]));
// שעון ישראל
const F = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const wall = (t) => { const p = F.formatToParts(new Date(t)), g = (k) => p.find((z) => z.type === k).value; return { d: g('year') + '-' + g('month') + '-' + g('day'), hm: g('hour') + ':' + g('minute') }; };
const IL = (d, hm) => { const z = Date.parse(d + 'T' + hm + ':00Z'); let t = z; for (let k = 0; k < 2; k++) { const w = wall(t); t += z - Date.parse(w.d + 'T' + w.hm + ':00Z'); } return t; };
const M = wall(Date.now()).d.slice(0, 7);
const [D1, D2, D3, D4] = ['02', '03', '04', '05'].map((x) => M + '-' + x);
const STAFF = [{ uid: 'm', name: 'המנהל', mgr: true }, { uid: 'w', name: 'דנה כהן', mgr: false }, { uid: 'w2', name: 'יוסי לוי', mgr: false }, { uid: 'w3', name: 'משה', mgr: false }];
const LIST = [
  { br: 'יהודה הנשיא', e: '12', nm: 'דנה כהן', n: 3, at: IL(D4, '09:00'), rows: [{ d: D1, i: '08:00', o: '16:00', b: 30, t: 450 }, { d: D2, i: '08:06', o: '16:00', b: 0 }, { d: D3, i: '08:00', o: '14:00', b: 0 }] },
  { br: 'נחל לכיש', e: '20', nm: 'יוסי  לוי', n: 1, at: 1, rows: [{ d: D1, i: '10:00', o: '18:00', b: 0 }] },
  { br: 'יהודה הנשיא', e: '30', nm: 'משה', n: 1, at: 1, rows: [{ d: D2, i: '07:00', o: '12:00', b: 0 }] },
  { br: 'יהודה הנשיא', e: '31', nm: 'משה', n: 1, at: 1, rows: [{ d: D3, i: '13:00', o: '19:00', b: 0 }] },
];
const rec = (d, a, b) => ({ id: 'w_' + IL(d, a), who: 'w', name: 'דנה כהן', in: IL(d, a), out: b ? IL(d, b) : null, day: d.replace(/-/g, ''), br: null });
const RECS = [rec(D1, '08:04', '16:02'), rec(D2, '08:00', '16:00'), rec(D4, '10:00', '12:00')];

async function open(browser, www, who, calls) {
  const cfg = { mode: 'new', users: { m: 'biz-o', w: 'biz-o' }, biz: { 'biz-o': { dataRoot: 'b', features: ALL, name: 'עסק בדיקה' } }, admins: { 'b/biz-o/|m': 1 }, staff: { 'b/biz-o/|w': 1 }, ctx: { hasTouch: true, isMobile: true } };
  const { ctx, page } = await H.newPage(browser, www, cfg, [], who);
  await ctx.route(/:5001\/.*/, async (route) => {
    const n = new URL(route.request().url()).pathname.split('/').pop(); let d = {}; try { d = JSON.parse(route.request().postData()).data; } catch (e) { /* */ }
    calls.push({ n, d });
    let R = { ok: true };
    if (n === 'cxBotTok' && d.op === 'hours') R = { m: d.m, list: d.m === M ? LIST : [] };
    if (n === 'posClock' && d.op === 'list') R = { ok: true, recs: RECS, sum: {} };
    if (n === 'shApi' && d.op === 'week') R = { from: D1, days: [D1, D2, D3, D4, M + '-06', M + '-07', M + '-08'], today: D2, now: 0, full: true, mgr: who === 'm', occ: [], hrs: null, holes: {}, tasks: {}, orph: [], staff: STAFF };
    if (n === 'shApi' && (d.op === 'cfg' || d.op === 'setCfg')) R = { cfg: { late: 5, at: '07:00', hrs: null }, map: { 'דנה כהן': 'w' }, staff: STAFF };
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
const dayTxt = (page, k, d) => page.evaluate(([k2, d2]) => { const b = document.querySelector(`#main [data-a=cxhDay][data-k="${k2}"][data-v="${d2}"]`); return b ? b.innerText : null; }, [k, d]);

(async () => {
  const [www, outFile, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const browser = await H.launch();
  // ---- מנהל ----
  let calls = [];
  let { ctx, page } = await open(browser, www, 'm', calls);
  await page.evaluate(() => { NAV = [{ v: 'home' }]; go('shf'); }); await H.settle(page, 700);
  let v = await q(page);
  check('0 כפתור "שעות עובדים" במסך המשמרות של המנהל; השורה לא נשברת במסך צר', /שעות עובדים/.test(v.text) && fine(v), { small: v.small, sw: v.sw });
  await page.click('[data-a=cxhGo]'); await H.settle(page, 900);
  v = await q(page);
  check('1 המסך: חודש נוכחי, עובדים, ימים לבדוק, התאמות; RTL, מגע ≥44, בלי גלילה לצד',
    /דנה כהן/.test(v.text) && /ימים לבדוק/.test(v.text) && /עוד לא הותאמו/.test(v.text) && fine(v) && calls.some((c) => c.n === 'cxBotTok' && c.d.op === 'hours' && c.d.m === wall(Date.now()).d.slice(0, 7)) && calls.some((c) => c.n === 'posClock' && c.d.op === 'list'), { small: v.small, sw: v.sw, t: v.text.slice(0, 300) });
  await page.click('[data-a=cxhTog][data-k="u:w"]'); await H.settle(page, 300);
  if (shots) { await page.evaluate(() => document.querySelector('#main [data-a=cxhTog][data-k="u:w"]').closest('.card').scrollIntoView()); await H.settle(page, 200); await page.screenshot({ path: path.join(shots, 'cx-hours.png') }); }
  const t1 = await dayTxt(page, 'u:w', D1), t2 = await dayTxt(page, 'u:w', D2), t3 = await dayTxt(page, 'u:w', D3), t4 = await dayTxt(page, 'u:w', D4);
  check('2 הפרש 4 דקות – בלי "לבדוק"; הפרש 6 דקות – "לבדוק"; כספית עם הסניף לצד הקופה', t1 && !/לבדוק/.test(t1) && /יהודה הנשיא/.test(t1) && /08:04/.test(t1) && t2 && /לבדוק/.test(t2), { t1, t2 });
  check('3 רשומה רק בכספית / רק בקופה – "לבדוק"', t3 && /לבדוק/.test(t3) && t4 && /לבדוק/.test(t4), { t3, t4 });
  await page.click(`#main [data-a=cxhDay][data-k="u:w"][data-v="${D2}"]`); await H.settle(page, 300);
  v = await q(page);
  check('4 לחיצה על יום: השורות משני המקורות וסיבת "לבדוק"', /הפרש בכניסה 6/.test(v.text) && /08:06/.test(v.text) && /08:00/.test(v.text) && fine(v), { t: v.text.slice(0, 300), small: v.small });
  await page.evaluate(() => closeDlg());
  await page.click(`#main [data-a=cxhDay][data-k="u:w"][data-v="${D3}"]`); await H.settle(page, 300);
  const v3 = await q(page); await page.evaluate(() => closeDlg());
  await page.click(`#main [data-a=cxhDay][data-k="u:w"][data-v="${D4}"]`); await H.settle(page, 300);
  const v4 = await q(page); await page.evaluate(() => closeDlg());
  check('4א פירוט: "רק בכספית" / "רק בקופה"', /רק בכספית/.test(v3.text) && /רק בקופה/.test(v4.text));
  await page.click('#main [data-a=cxhSum][data-k="u:w"][data-v=c]'); await H.settle(page, 300);
  v = await q(page);
  check('5 משבצת "שעות לפי כספית" לחיצה ומציגה את השורות שמרכיבות אותה', /שעות לפי כספית: 21:24/.test(v.text) && (v.text.match(/יהודה הנשיא/g) || []).length === 3, v.text.slice(0, 300));
  await page.evaluate(() => closeDlg());
  await page.click('#main [data-a=cxhSum][data-k="u:w"][data-v=p]'); await H.settle(page, 300);
  v = await q(page);
  check('5א משבצת "שעות לפי הקופה" – 7:58 + 8:00 + 2:00', /שעות לפי הקופה: 17:58/.test(v.text), v.text.slice(0, 200));
  await page.evaluate(() => closeDlg());
  const yo = await page.evaluate(() => { const c = [...document.querySelectorAll('#main .card')].find((x) => /^יוסי/.test((x.querySelector('h3') || {}).textContent || '')); return c ? c.innerText : ''; });
  check('6 עובד לא מותאם – מוצג בלי השוואה לקופה', /לא מותאם למשתמש/.test(yo) && !/שעות לפי הקופה/.test(yo), yo.slice(0, 200));
  const sug = await page.evaluate(() => { const c = [...document.querySelectorAll('#main .card')].find((x) => /עוד לא הותאמו/.test(x.innerText)); return c ? c.innerText : ''; });
  check('7 הצעה לפי שם (אחרי נרמול רווחים) עם "אשר"; שם כפול – "לבדוק" בלי הצעה', /יוסי לוי[\s\S]*הצעה: יוסי לוי/.test(sug) && /משה[\s\S]*לבדוק[\s\S]*שם כפול/.test(sug) && await page.evaluate(() => document.querySelectorAll('#main [data-a=cxhOk]').length === 1), sug.slice(0, 300));
  await page.click('#main [data-a=cxhOk]'); await H.settle(page, 600);
  let sc = calls.filter((c) => c.n === 'shApi' && c.d.op === 'setCfg');
  check('7א "אשר" → setCfg עם כל הטבלה + יוסי לוי', sc.length === 1 && sc[0].d.map['דנה כהן'] === 'w' && sc[0].d.map['יוסי לוי'] === 'w2' && Object.keys(sc[0].d).sort().join() === 'map,op', sc.map((c) => c.d));
  const i = await page.evaluate(() => { const s = [...document.querySelectorAll('#main select[id^=cxhSel]')]; const k = s.findIndex((x) => /משה/.test(x.closest('div[style*=padding]').innerText.split('\n')[0])); return k; });
  const n0 = calls.length;
  await page.click(`#main [data-a=cxhPick][data-v="${i}"]`); await H.settle(page, 300);
  check('8 בחירה ידנית בלי משתמש – לא נשלח', calls.slice(n0).every((c) => c.d.op !== 'setCfg'));
  await page.selectOption(`#cxhSel${i}`, 'w3'); await page.click(`#main [data-a=cxhPick][data-v="${i}"]`); await H.settle(page, 600);
  sc = calls.filter((c) => c.n === 'shApi' && c.d.op === 'setCfg');
  check('8א בחירה ידנית → setCfg עם משה ← w3', sc.length === 2 && sc[1].d.map['משה'] === 'w3' && sc[1].d.map['דנה כהן'] === 'w', sc.map((c) => c.d));
  await page.click('#main [data-a=cxhM][data-v="-1"]'); await H.settle(page, 700);
  v = await q(page);
  check('9 חודש קודם: בקשה לחודש הקודם, "הבא" פעיל', calls.some((c) => c.n === 'cxBotTok' && c.d.op === 'hours' && c.d.m < M) && /אין שעות בחודש הזה/.test(v.text) && await page.evaluate(() => !document.querySelector('#main [data-a=cxhM][data-v="1"]').disabled));
  check('10 בלי שגיאות JavaScript (מנהל)', page.__errors.length === 0, page.__errors.slice(0, 3));
  await ctx.close();
  // ---- עובד ----
  calls = [];
  ({ ctx, page } = await open(browser, www, 'w', calls));
  check('11 עובד: בלי כפתור, המסך "למנהל בלבד", בלי קריאה לשרת', await page.evaluate(() => window.cxhBtn() === '' && /למנהל בלבד/.test(V.cxHrs().h)) && !calls.some((c) => c.n === 'cxBotTok' || c.n === 'posClock'));
  check('12 בלי שגיאות JavaScript (עובד)', page.__errors.length === 0, page.__errors.slice(0, 3));
  await ctx.close();
  await browser.close();
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
  console.log(fail ? `נכשלו ${fail}` : 'הכול עבר');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
