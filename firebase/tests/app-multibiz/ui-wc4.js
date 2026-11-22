'use strict';
// מרכז עבודה – סבב 3 (www/tasks-wc.js + index.html): בקשות למנהל (rq) – סוג פנייה (k), תגיות שלב (ph: נשלחה/נקראה/בטיפול; אושרה/טופלה/נדחתה),
// מנהל: פתיחת שרשור כותבת ph:'r', "בטיפול" (ph:'w'), "הפוך למשימה" (טופס ממולא, נמען = מי ששלח, ואחרי יצירה ph:'w' + tk).
// כללים ישנים (rv → 403): בלי k/ph/tk ובלי הכפתורים; 403 על k ← נשלח שוב בלי k. "הזכר לעובד" קורא ל-tkNudge (כשל נבלע).
// ליטוש: 360px בלי גלילה אופקית, RTL, וביצועים עם 500 משימות (זמן ציור "היום שלי" / "פתוחות").
// רשת מדומה ("ענן" בזיכרון), בלי אמולטור. שימוש: node ui-wc4.js <www-dir> [shots-dir]
const fs = require('fs'); const path = require('path'); const H = require('./harness');
const BZ0 = ['larg', 'peami'].join('');
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
let fail = 0; const check = (n, ok, info) => { if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const S = (v) => ({ stringValue: String(v) }), I = (v) => ({ integerValue: String(v) }), A = (a) => ({ arrayValue: { values: a.map(S) } });
const T0 = H.T0, D1 = 864e5, H1 = 36e5;
const DOCS = 'projects/demo-largpeami/databases/(default)/documents/';
let DB, LOG, RV, K403 = false, FN = [];
const reset = () => { DB = { tasks: {}, ptk: {}, rtk: {}, rq: {}, staff: {} }; LOG = []; FN = []; };
const docOf = (col, id) => ({ name: DOCS + col + '/' + id, fields: DB[col][id], createTime: '2026-11-03T09:00:00Z', updateTime: '2026-11-03T09:00:00Z' });
const MINE = new Set(['tasks', 'ptk', 'rtk', 'rq']);
async function mockCloud(ctx, who) {
  // פונקציות שרת (fnCall): tkNudge – נרשם ומחזיר תשובה / שגיאה
  await ctx.route((u) => /\/tkNudge$/.test(new URL(u).pathname), async (route) => { const b = JSON.parse(route.request().postData() || '{}'); FN.push({ who, data: b.data });
    return FN_FAIL ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { status: 'INTERNAL', message: 'x' } }) }) : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { ok: true, n: 1, sent: 1 } }) }); });
  await ctx.route((u) => new URL(u).port === '8080', async (route) => {
    const req = route.request(), u = new URL(req.url()), m = req.method(), p = decodeURIComponent(u.pathname), body = req.postData() || '';
    const i = p.indexOf('/documents'); if (i < 0) return route.fallback(); const rest = p.slice(i + 10);
    const ok = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    const err = (c, s) => route.fulfill({ status: c, contentType: 'application/json', body: JSON.stringify({ error: { code: c, message: s, status: s } }) });
    if (rest === '/rv/tk2') { LOG.push({ who, m, col: 'rv' }); return RV === 'old' ? err(403, 'PERMISSION_DENIED') : err(404, 'NOT_FOUND'); }
    if (rest === ':runQuery') {
      let q = {}; try { q = JSON.parse(body).structuredQuery; } catch (e) { /* */ }
      const c = q.from && q.from[0].collectionId; if (!MINE.has(c)) return route.fallback();
      let ids = Object.keys(DB[c]); const w = q.where && q.where.fieldFilter;
      if (w) ids = ids.filter((id) => { const v = DB[c][id][w.field.fieldPath]; const sv = v && v.stringValue; return w.op === 'IN' ? w.value.arrayValue.values.some((x) => x.stringValue === sv) : sv === w.value.stringValue; });
      return ok(ids.length ? ids.map((id) => ({ document: docOf(c, id), readTime: 'x' })) : [{ readTime: 'x' }]);
    }
    if (m === 'GET' && rest.split('?')[0] === '/staff') return ok({ documents: Object.keys(DB.staff).map((id) => docOf('staff', id)) });
    const s = rest.split('?')[0].split('/').filter(Boolean);
    if (s[0] === 'rq' && s[2] === 'c') { const col = 'rq/' + s[1] + '/c'; DB[col] = DB[col] || {}; if (m === 'GET') return ok({ documents: Object.keys(DB[col]).map((k) => docOf(col, k)) });
      if (m === 'POST') { const nid = u.searchParams.get('documentId'); DB[col][nid] = JSON.parse(body).fields; return ok(docOf(col, nid)); } return route.fallback(); }
    const col = s[0], id = s[1];
    if (!MINE.has(col) || s.length > 2) return route.fallback();
    if (m === 'GET') return id ? (DB[col][id] ? ok(docOf(col, id)) : err(404, 'NOT_FOUND')) : ok({ documents: Object.keys(DB[col]).map((k) => docOf(col, k)) });
    if (m === 'POST') { const nid = u.searchParams.get('documentId'); const f = JSON.parse(body).fields;
      if (col === 'rq' && 'k' in f && (RV === 'old' || K403)) { LOG.push({ who, m, col, id: nid, f, st: 403 }); return err(403, 'PERMISSION_DENIED'); }
      DB[col][nid] = f; LOG.push({ who, m, col, id: nid, f }); return ok(docOf(col, nid)); }
    if (m === 'PATCH') { const mask = u.searchParams.getAll('updateMask.fieldPaths'); if (!DB[col][id]) return err(404, 'NOT_FOUND'); const f = JSON.parse(body).fields; const ch = {};
      if (col === 'rq' && RV === 'old' && mask.some((k) => k === 'ph' || k === 'tk')) { LOG.push({ who, m, col, id, mask, st: 403 }); return err(403, 'PERMISSION_DENIED'); }
      for (const k of mask) { if (k.includes('.')) continue; DB[col][id][k] = f[k]; ch[k] = f[k]; } LOG.push({ who, m, col, id, f: ch, mask }); return ok(docOf(col, id)); }
    return route.fallback();
  });
}
let FN_FAIL = false;
const task = (id, o) => { DB.tasks[id] = Object.assign({ owner: S('m'), by: S('m'), role: S('a'), txt: S('משימה ' + id), cr: I(T0 - D1), due: I(T0 + D1), st: S('open'), open: S('1'), pr: S(''), sub: I(0), doneBy: S(''), note: S(''), ok: I(0), late: S(''), to: A(['w1']), toN: A(['עובד א']), ow: S('w1'), owN: S('עובד א'), clt: I(T0 - D1), np: I(0), wp: I(0), mi: I(0) }, o || {}); };
const rq = (id, o) => { DB.rq[id] = Object.assign({ owner: S('w1'), by: S('w1'), txt: S('בקשה ' + id), t: I(T0 - H1), st: S('new'), ans: S('') }, o || {}); };
const seed = () => {
  reset();
  DB.staff.w1 = { name: S('עובד א'), email: S('w1@x.co'), active: { booleanValue: true } };
  DB.staff.w2 = { name: S('עובד ב'), email: S('w2@x.co'), active: { booleanValue: true } };
  rq('r1', { txt: S('המקרר במחסן לא מקרר'), k: S('b') });
  rq('r2', { txt: S('אפשר לקבל משמרת בוקר?'), ph: S('w'), t: I(T0 - 2 * H1) });
  rq('r3', { txt: S('איפה המפתח של המחסן?'), k: S('s'), st: S('done'), ans: S('במגירה'), aBy: S('m'), aAt: I(T0 - 3 * H1), t: I(T0 - 4 * H1) });
  rq('r4', { txt: S('אפשר חופש מחר?'), st: S('rej'), ans: S('לא מחר'), aBy: S('m'), aAt: I(T0 - 3 * H1), t: I(T0 - 5 * H1) });
  rq('r5', { txt: S('בקשה ישנה שאושרה'), st: S('done'), ans: S('כן'), aBy: S('m'), aAt: I(T0 - 3 * H1), t: I(T0 - 6 * H1) });
  task('t1', { txt: S('לסדר מדף') });
};
const shot = async (page, dir, name) => { if (!dir) return; fs.mkdirSync(dir, { recursive: true }); await page.waitForTimeout(250); await page.screenshot({ path: path.join(dir, name + '.png'), fullPage: true }); };
const txt = (page, sel) => page.evaluate((s) => (document.querySelector(s) || {}).innerText || '', sel);
const waitFor = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 4000)) { if (await fn()) return true; await sleep(60); } return false; };
const dlgOpen = (page) => page.evaluate(() => { const d = document.getElementById('dlg'); return !!(d && d.open); });
const closeD = async (page) => { if (await dlgOpen(page)) { await page.evaluate(() => closeDlg()); await sleep(150); } };
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const cardOf = (page, re) => page.evaluate((s) => { const c = [...document.querySelectorAll('#main .card')].find((x) => new RegExp(s).test(x.innerText)); return c ? c.innerText : ''; }, re);

(async () => {
  const [www, shots] = process.argv.slice(2); const browser = await H.launch();
  const cfg = { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: ALL } }, admins: { '|m': 1 }, staff: { '|w1': 1, '|w2': 1 } };
  const open = async (label, email) => { const x = await H.newPage(browser, www, cfg, [], label); await x.page.setViewportSize({ width: 360, height: 740 });
    await mockCloud(x.ctx, email.split('@')[0]); await H.login(x.page, email); if (await x.page.$('[data-a=startBlank]')) { await x.page.click('[data-a=startBlank]'); await sleep(300); }
    await sleep(1200); await closeD(x.page); return x; };
  // לוח מנהל: מונים, מיון, סטטוס אחיד, פעולות מהירות, שינוי יעד, חבילת שגרה
  seed(); RV = 'new'; DB.rq = {};
  DB.staff.m = { name: S('מנהל'), email: S('m@x.co'), active: { booleanValue: true } };
  DB.tasks = {};
  task('a-late', { txt: S('באיחור יומיים'), due: I(T0 - 2 * D1), dl: I(T0 - 2 * D1), cr: I(T0 - 5 * D1) });
  task('b-wait', { txt: S('ממתין ישן'), st: S('wait'), sub: I(T0 - 2 * D1), due: I(T0 + D1), dl: I(T0 + D1) });
  task('c-urg', { txt: S('דחוף להמשך'), pri: S('h'), due: I(T0 + 5 * D1), dl: I(T0 + 5 * D1) });
  task('d-today', { txt: S('להיום'), dl: I(T0 + 5 * H1), due: I(T0 + 5 * D1) });
  task('e-later', { txt: S('בהמשך'), due: I(T0 + 6 * D1), dl: I(T0 + 6 * D1) });
  const m = await open('m-board', 'm@x.co'); const mp = m.page;
  await mp.evaluate(() => { TKT = 'open'; go('tk'); }); await sleep(800); await mp.evaluate(() => tkLoad()); await sleep(800); await mp.evaluate(() => rerender()); await sleep(300);
  const bar = await mp.evaluate(() => [...document.querySelectorAll('.tkmg .tkm')].map((x) => x.innerText.replace(/\s+/g, ' ').trim()));
  check('1 מונים: היום 1, דחוף 1, באיחור 1, ממתין 1, בהמשך 1 (+ לא טופלו 2)', bar.join('|') === '1 היום|1 דחוף|1 באיחור|1 ממתין לאישור|1 בהמשך|2 לא טופלו', bar);
  const order = await mp.evaluate(() => [...document.querySelectorAll('#main .card[id^=tkc-]')].map((x) => x.id));
  check('1א מיון: באיחור ← ממתין ← דחוף ← היום ← בהמשך', order.join() === 'tkc-a-late,tkc-b-wait,tkc-c-urg,tkc-d-today,tkc-e-later', order);
  const c1 = await mp.evaluate(() => document.getElementById('tkc-a-late').innerText);
  check('2 כרטיס באיחור: תגית "באיחור 2 ימים" + אחראי', /באיחור 2 ימים/.test(c1) && /אחראי/.test(c1), c1.slice(0, 200));
  check('3 כפתור ראשי: "✓ אשר" לממתין, "✓ בוצע" לפתוח, ותפריט ⋯', await mp.evaluate(() => !!document.querySelector('#tkc-b-wait [data-a=tkOk]') && !!document.querySelector('#tkc-a-late [data-a=tkDone]') && !!document.querySelector('#tkc-a-late [data-a=tkwMenu]') && !document.querySelector('#tkc-a-late [data-a=tkMv]')));
  await shot(mp, shots, 'm-board');
  await mp.click('.tkm[data-v=late]'); await sleep(200);
  check('1ב סינון "באיחור" מציג רק אותה', (await mp.evaluate(() => [...document.querySelectorAll('#main .card[id^=tkc-]')].length)) === 1);
  await mp.click('.tkm[data-v=late]'); await sleep(200);
  await mp.click('.tkm[data-v=stale]'); await sleep(200);
  check('5 "לא טופלו": באיחור + ממתין יותר מ-24 שעות', (await mp.evaluate(() => [...document.querySelectorAll('#main .card[id^=tkc-]')].map((x) => x.id).join())) === 'tkc-a-late,tkc-b-wait');
  await mp.click('.tkm[data-v=stale]'); await sleep(200);
  await mp.click('#tkc-e-later [data-a=tkwMenu]'); await sleep(200);
  const menu = await txt(mp, '#dlg');
  check('3א תפריט ⋯: העבר, שנה יעד, הערה, תזכורת', /העבר לעובד/.test(menu) && /שנה תאריך יעד/.test(menu) && /הערה/.test(menu) && /תזכורת לעובד/.test(menu), menu);
  await shot(mp, shots, 'm-menu');
  await mp.click('#dlg [data-go=tkwDl]'); await sleep(200); LOG.length = 0;
  await mp.click('#dlg [data-a=tkwDlGo]:nth-child(2)'); await waitFor(async () => LOG.some((l) => l.m === 'PATCH' && l.col === 'tasks'));
  const pd = LOG.find((l) => l.m === 'PATCH' && l.col === 'tasks');
  check('3ב שינוי יעד: PATCH עם dl בלבד', pd && pd.id === 'e-later' && pd.mask.join() === 'dl' && +pd.f.dl.integerValue > T0, pd && pd.mask);
  // כללים ישנים (rv=0): אין "שנה תאריך יעד" בתפריט, ו-tkwDlGo / FRM.tkwDl לא כותבים dl
  await sleep(300); await mp.evaluate(() => { const k = Object.keys(localStorage).find((x) => /lp-tk-rv$/.test(x)); localStorage.setItem(k, JSON.stringify({ v: 0, t: Date.now() })); closeDlg(); });
  await mp.click('#tkc-e-later [data-a=tkwMenu]'); await sleep(200);
  const menuOld = await txt(mp, '#dlg'); LOG.length = 0;
  await mp.evaluate(() => { closeDlg(); const b = document.createElement('button'); b.dataset.id = 'e-later'; b.dataset.v = String(Date.now() + 864e5); ACT.tkwDlGo(b); });
  await sleep(500);
  check('3ג כללים ישנים: אין "שנה תאריך יעד" בתפריט, ושינוי יעד לא נשלח (dl)', !/שנה תאריך יעד/.test(menuOld) && /הערה/.test(menuOld) && !LOG.some((l) => l.m === 'PATCH' && l.col === 'tasks'), menuOld);
  await mp.evaluate(() => { const k = Object.keys(localStorage).find((x) => /lp-tk-rv$/.test(x)); localStorage.setItem(k, JSON.stringify({ v: 1, t: Date.now() })); });
  await mp.evaluate(() => { TKT = 'rc'; rerender(); }); await sleep(600);
  await mp.click('[data-a=rcPackOpen]'); await sleep(500);
  await shot(mp, shots, 'm-pack');
  check('7 חבילת שגרה: 6 שגרות ברשימה', (await mp.evaluate(() => document.querySelectorAll('#dlg form[data-f=rcPack] input[type=checkbox]').length)) === 6);
  LOG.length = 0; await mp.click('#dlg form[data-f=rcPack] button.btn.grow'); await waitFor(async () => LOG.filter((l) => l.m === 'POST' && l.col === 'rtk').length === 6, 6000);
  const rl = LOG.filter((l) => l.m === 'POST' && l.col === 'rtk');
  check('7א נוצרו 6 כללים באותם שדות של הקבועות, אחראי = המנהל', rl.length === 6 && Object.keys(rl[0].f).sort().join() === 'by,cr,ed,fq,hh,hol,md,mm,np,on,owner,to,toN,txt,wd' && rl[0].f.to.arrayValue.values[0].stringValue === 'm', rl[0] && Object.keys(rl[0].f).join());
  await sleep(500); await mp.evaluate(() => { RC.t = 0; });
  await mp.click('[data-a=rcPackOpen]'); await sleep(500);
  check('7ב כפילות: אחרי היצירה כל השגרות מסומנות "כבר קיימת"', (await mp.evaluate(() => document.querySelectorAll('#dlg form[data-f=rcPack] input[type=checkbox]:not([disabled])').length)) === 0);
  check('8 אין שגיאות JS', mp.__errors.length === 0, mp.__errors);
  check('8א 360px: אין גלילה אופקית', await noOverflow(mp));
  await browser.close();
  console.log(fail ? `נכשלו ${fail}` : 'כל הבדיקות עברו'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
