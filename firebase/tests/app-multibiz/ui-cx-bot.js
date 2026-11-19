'use strict';
// רובוט כספית (caspit-bot.js באפליקציה): כרטיס "רובוט – מחשב החנות" במסך "סנכרון כספית" – חיבור מחשב (קוד פעם אחת + העתקה), מצב, תקלה בעברית,
// 14 הריצות האחרונות, newMax, הורדת התוסף והוראות התקנה, ניתוק, דוח היכרות (מנהל־על בלבד).
// 0.1.10: "עדכון המחשב" (גרסה, בדיקה אחרונה, מצב, בקשה לתוסף – cxBotTok op:'upd', תשובה ב-ureq; תוסף ישן – כפתור כבוי) ושורת "מכירות היום" (tp).
// רשת מדומה, נתונים מומצאים. שימוש: node ui-cx-bot.js <www-dir> [out.json] [shots-dir]. מסך טלפון קטן (360×740).
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const out = {}; let fail = 0;
const check = (name, ok, info) => { out[name] = { ok: !!ok, info }; if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders', 'cxSales'].map((k) => [k, true])); // cxSales – תוספת "מכירות כספית" (19.11.2026)
const T0 = Date.UTC(2026, 10, 18, 1, 10);
const RUNS = [{ id: 'r2', at: T0, end: T0 + 600e3, st: 'fail', manual: false, days: ['2026-11-17'], err: { code: 'selector-miss', msg: 'x', step: 'catalog' }, imp: null },
  { id: 'r1', at: T0 - 864e5, st: 'ok', manual: true, days: ['2026-11-15', '2026-11-16'], err: null, imp: { price: { n: 3, ok: true, text: '', id: 25520, status: 'בוצע', errors: 0, loaded: 3 } } }];

async function scenario(browser, www, sa, shots) {
  const cfg = { mode: 'new', users: { m: 'biz-o' }, biz: { 'biz-o': { dataRoot: 'b', features: ALL, name: 'עסק בדיקה' } }, admins: { 'b/biz-o/|m': 1 }, ctx: { hasTouch: true, isMobile: true } };
  const log = []; const calls = []; const opened = [];
  const st = { dev: null };
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
    let R = { ok: true };
    if (n === 'cxCfg') R = { cfg: { skip: ['1000'], last: { run: 'r', at: 1 } }, items: 10, br: '_', sa };
    if (n === 'cxBotTok' && d.op === 'upd') { if (st.oldSrv) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { status: 'INVALID_ARGUMENT', message: 'פעולה לא מוכרת', details: { reason: 'bad-op' } } }) }); st.ureq = { id: 'qupd0001', at: Date.now(), took: null, res: null }; R = { ok: true, req: { id: 'qupd0001', at: st.ureq.at } }; }
    if (n === 'cxBotTok' && d.op === 'info') R = { now: Date.now(), reqMs: 600000, ureq: st.ureq || null, updVer: '0.1.10', tp: st.tp || null, dev: st.dev, sd: st.dev ? '2026-11-16' : null, lr: st.dev ? { id: 'r2', at: T0, st: 'fail', code: 'selector-miss', msg: 'x', step: 'catalog', manual: false } : null, newMax: 1, limits: { price: 500, newMax: 50 }, first: false, sa, li: st.dev ? { kind: 'price', at: T0, id: 25521, status: 'בוצע', errors: 0, loaded: 1 } : null, runs: st.dev ? RUNS : [], disc: sa ? [{ id: 'd1', at: T0, size: 2048 }] : undefined };
    if (n === 'cxBotTok' && d.op === 'new') { st.dev = { id: 'ab12cd34', at: T0, last: T0 + 60e3, ver: '0.1.0', ua: '', upd: { at: T0, ok: false, ver: '0.1.0', err: 'bad-hash', fails: 2, rx: T0 } }; R = { token: 'biz-o.' + 'A'.repeat(43), id: 'ab12cd34' }; }
    if (n === 'cxBotTok' && d.op === 'revoke') { st.dev = null; R = { ok: true }; }
    if (n === 'cxBotDisc') R = { id: 'd1', at: T0, size: 30, data: JSON.stringify({ pages: [{ p: '#/catalogs' }] }) };
    if (n === 'getCosts') R = { cost: {} };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: R }) });
  });
  await H.login(page, 'm@x.co');
  await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden) ACT.startBlank(); window.open = (u, t) => { (window.__op = window.__op || []).push([u, t]); return null; }; });
  await H.settle(page, 500);
  await page.setViewportSize({ width: 360, height: 740 });
  const q = () => page.evaluate(() => { const R = document.querySelector('#dlg[open]') || document.querySelector('#main');
    const els = [...R.querySelectorAll('button, a, select, input:not([type=hidden]):not([type=checkbox]):not([type=file])')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    const small = els.filter((e) => { const r = e.getBoundingClientRect(); return r.height < 44 && !e.closest('label.f'); }).map((e) => (e.dataset.a || e.dataset.c || e.tagName) + ':' + Math.round(e.getBoundingClientRect().height));
    return { small, sw: document.documentElement.scrollWidth, iw: innerWidth, text: R.innerText.replace(/[‎‏]/g, ''), dir: getComputedStyle(R).direction }; });
  const shot = async (nm) => { if (shots) await page.screenshot({ path: path.join(shots, nm + '.png'), fullPage: true }); };
  const fine = (r) => r.small.length === 0 && r.sw <= r.iw && r.dir === 'rtl';
  const P = sa ? 'SA ' : '';
  await page.evaluate(() => { NAV = [{ v: 'home' }]; go('cxSync'); }); await H.settle(page, 700);
  let v = await q(); await shot((sa ? 'sa-' : '') + 'bot-1-empty');
  check(P + '1 כרטיס הרובוט בלי מחשב: "אין מחשב מחובר", חיבור, הורדה והוראות; RTL, מגע ≥44, בלי גלילה לצד', /רובוט – מחשב החנות/.test(v.text) && /אין מחשב מחובר/.test(v.text) && /חיבור מחשב/.test(v.text) && /הורדת התוסף/.test(v.text) && /הוראות התקנה/.test(v.text) && fine(v), { small: v.small, sw: v.sw });
  await page.click('[data-a=cxBotNew]'); await H.settle(page, 500);
  v = await q(); await shot((sa ? 'sa-' : '') + 'bot-2-code');
  check(P + '2 קוד חיבור מוצג פעם אחת, עם העתקה', /פעם אחת בלבד/.test(v.text) && v.text.includes('biz-o.' + 'A'.repeat(43)) && /העתקה/.test(v.text) && fine(v), v.small);
  await page.evaluate(() => closeDlg()); await H.settle(page, 400);
  check(P + '2ב הקוד נמחק מהמסך בסגירה', await page.evaluate(() => !document.getElementById('cxBotTok')));
  v = await q(); await shot((sa ? 'sa-' : '') + 'bot-3-status');
  check(P + '3 מצב: סנכרון אחרון נכשל · אוטומטי, מכירות עד 16/11, תקלה בעברית פשוטה, newMax=1', /סנכרון אחרון/.test(v.text) && /נכשל/.test(v.text) && /אוטומטי/.test(v.text) && /16\/11/.test(v.text) && /מסך בכספית השתנה/.test(v.text) && /טעינה אחרונה לכספית \(מחירים[^)]*\): מזהה 25521 · בוצע · נטענו 1 · שגויים 0/.test(v.text) && (await page.inputValue('form[data-f=cxBotMaxF] input[name=n]')) === '1' && fine(v), { small: v.small, t: v.text.slice(0, 300) });
  check(P + '3ג עדכון אוטומטי של התוסף: נכשל, כמה פעמים ברצף, הסיבה', /עדכון אוטומטי של התוסף נכשל \([^)]*2 פעמים ברצף\): bad-hash/.test(v.text), v.text.slice(0, 600));
  // "עדכון המחשב": תוסף ישן (0.1.0) – הכפתור בחלון כבוי עם הסבר; ההסבר על 10 דקות ועל install-auto-update.cmd
  await page.click('[data-a=cxBotUpd]'); await H.settle(page, 500);
  v = await q(); await shot((sa ? 'sa-' : '') + 'bot-3d-upd-old');
  check(P + '3ד "עדכון המחשב" (תוסף ישן): גרסה מותקנת, מצב "נכשל", כפתור הבדיקה כבוי + "צריך גרסה 0.1.10"; 10 דקות; להריץ שוב install-auto-update.cmd; מגע ≥44, RTL', /גרסה מותקנת\s*0\.1\.0/.test(v.text) && /נכשל/.test(v.text) && await page.evaluate(() => document.querySelector('#dlg [data-a=cxBotUpdGo]').disabled) && /צריך גרסה 0\.1\.10/.test(v.text) && /10 דקות/.test(v.text) && /install-auto-update\.cmd/.test(v.text) && /פעם אחת/.test(v.text) && fine(v), { small: v.small, t: v.text.slice(0, 600) });
  await page.evaluate(() => closeDlg()); await H.settle(page, 300);
  // תוסף 0.1.10, עדכון תקין, מכירות היום עודכנו עד 13:00
  const tday = await page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()));
  const yd = new Date(Date.parse(tday + 'T12:00:00Z') - 864e5).toISOString().slice(0, 10);
  st.dev = Object.assign({}, st.dev, { ver: '0.1.10', upd: { at: T0 + 3600e3, ok: true, ver: '0.1.10', err: '', fails: 0, rx: T0 } }); st.tp = { d: yd, hm: '23:00', at: T0, n: 40 };
  await page.evaluate(() => { cxBotReset(); rerender(); }); await H.settle(page, 700);
  v = await q();
  check(P + '3ה0 עדכון "מכירות היום" של אתמול – לא מוצג', !/מכירות היום \(/.test(v.text), v.text.slice(0, 300));
  st.tp = { d: tday, hm: '13:00', at: T0, n: 40 };
  await page.evaluate(() => { cxBotReset(); rerender(); }); await H.settle(page, 700);
  v = await q();
  check(P + '3ה שורת "מכירות היום": עודכנו עד 13:00 – חלקי', new RegExp('מכירות היום \\(' + tday.slice(8) + '\\/' + tday.slice(5, 7) + '\\) עודכנו מהמחשב עד השעה 13:00 – חלקי').test(v.text), v.text.slice(0, 800));
  await page.click('[data-a=cxBotUpd]'); await H.settle(page, 500);
  v = await q();
  check(P + '3ו חלון "עדכון המחשב": גרסה 0.1.10, מצב תקין, כפתור פעיל', /גרסה מותקנת\s*0\.1\.10/.test(v.text) && /מצב\s*תקין/.test(v.text) && await page.evaluate(() => !document.querySelector('#dlg [data-a=cxBotUpdGo]').disabled) && fine(v), { small: v.small, t: v.text.slice(0, 300) });
  await page.click('#dlg [data-a=cxBotUpdGo]'); await H.settle(page, 700);
  v = await q(); await shot((sa ? 'sa-' : '') + 'bot-3g-upd-wait');
  check(P + '3ז בדיקה עכשיו → cxBotTok { op:upd }; "ממתין למחשב", הכפתור כבוי', calls.some((c) => c.n === 'cxBotTok' && c.d.op === 'upd') && /ממתין למחשב/.test(v.text) && await page.evaluate(() => document.querySelector('#dlg [data-a=cxBotUpdGo]').disabled), v.text.slice(0, 400));
  st.ureq = Object.assign({}, st.ureq, { took: Date.now(), res: { st: 'reload', cur: '0.1.10', disk: '0.1.11' } });
  await page.evaluate(() => closeDlg()); await page.click('[data-a=cxBotUpd]'); await H.settle(page, 700);
  v = await q();
  check(P + '3ח תשובת המחשב: נטען מחדש, גרסה בדיסק 0.1.11', /המחשב ענה/.test(v.text) && /נטען מחדש/.test(v.text) && /0\.1\.11/.test(v.text) && fine(v), v.text.slice(0, 400));
  st.oldSrv = true;
  await page.click('#dlg [data-a=cxBotUpdGo]'); await H.settle(page, 500);
  const tst = await page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | '));
  check(P + '3ט שרת ישן (bad-op) – הודעה ברורה, בלי קריסה', /השרת עוד לא תומך/.test(tst), tst.slice(0, 200));
  st.oldSrv = false; st.ureq = null;
  await page.evaluate(() => closeDlg()); await H.settle(page, 300);
  v = await q();
  check(P + '3ב דוח היכרות – ' + (sa ? 'מוצג למנהל־על' : 'מוסתר ממנהל רגיל'), sa === /דוח היכרות/.test(v.text));
  await page.click('[data-a=cxBotRuns]'); await H.settle(page, 400);
  v = await q(); await shot((sa ? 'sa-' : '') + 'bot-4-runs');
  check(P + '4 הריצות האחרונות: אוטומטי/ידני, ימים, תקלה, טעינת מחירים', /ידני – "סנכרן עכשיו"/.test(v.text) && /אוטומטי/.test(v.text) && /15\/11, 16\/11/.test(v.text) && /מסך בכספית השתנה/.test(v.text) && /מחירים לכספית: 3 \(טעינה 25520: נטענו 3, שגויים 0\)/.test(v.text) && fine(v), v.small);
  await page.evaluate(() => closeDlg()); await H.settle(page, 300);
  await page.fill('form[data-f=cxBotMaxF] input[name=n]', '5');
  await page.click('form[data-f=cxBotMaxF] button'); await H.settle(page, 400);
  check(P + '5 שמירת newMax → cxSetCfg { newMax:5 }', calls.some((c) => c.n === 'cxSetCfg' && c.d.newMax === 5 && Object.keys(c.d).filter((k) => k !== 'bizId').length === 1));
  await page.click('[data-a=cxBotDl]'); await page.click('[data-a=cxBotGuide]'); await H.settle(page, 300);
  v = await q(); await shot((sa ? 'sa-' : '') + 'bot-5-guide');
  const op = await page.evaluate(() => window.__op || []);
  check(P + '6 הורדת התוסף → releases caspit-ext; הוראות התקנה בעברית', op.some(([u]) => /github\.com\/nati59029-a11y\/large-pami-android\/releases\?q=caspit-ext/.test(u)) && /chrome:\/\/extensions/.test(v.text) && /מצב מפתח/.test(v.text) && fine(v), { op, small: v.small });
  await page.evaluate(() => closeDlg()); await H.settle(page, 300);
  if (sa) {
    await page.evaluate(() => { const d = document.querySelector('details:has([data-a=cxBotDisc])'); if (d) d.open = true; }); await H.settle(page, 200);
    await page.click('[data-a=cxBotDisc]'); await H.settle(page, 400);
    v = await q();
    check(P + '7 דוח היכרות: צפייה + הורדה', /#\/catalogs/.test(v.text) && /הורדה \(JSON\)/.test(v.text) && calls.some((c) => c.n === 'cxBotDisc' && c.d.id === 'd1'));
    await page.evaluate(() => closeDlg()); await H.settle(page, 300);
  }
  await page.click('[data-a=cxBotRev]'); await H.settle(page, 300);
  await page.click('#dlg [data-a=yes]'); await H.settle(page, 600);
  v = await q();
  check(P + '8 ניתוק → cxBotTok revoke, חזרה ל"אין מחשב מחובר"', calls.some((c) => c.n === 'cxBotTok' && c.d.op === 'revoke') && /אין מחשב מחובר/.test(v.text), v.text.slice(0, 200));
  check(P + '9 בלי שגיאות JavaScript', page.__errors.length === 0, page.__errors.slice(0, 3));
  await ctx.close();
}

(async () => {
  const [www, outFile, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const browser = await H.launch();
  await scenario(browser, www, false, shots);
  await scenario(browser, www, true, shots);
  await browser.close();
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
  console.log(fail ? `נכשלו ${fail}` : 'הכול עבר');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
