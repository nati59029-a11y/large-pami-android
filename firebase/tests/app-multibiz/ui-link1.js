'use strict';
// חיבורים פשוטים למשימות (22.11.2026, www/tasks-wc.js + yemot-promo.js + hs.js):
//   1. חשבונית פתוחה לתשלום (payDlg) ← "📋 צור משימה לטיפול בחשבונית": טופס "משימה חדשה" ממולא (טקסט + יעד = יום התשלום 12:00). עובד – בלי כפתור.
//   2. מבצע שנשלח לקו ← "צור משימות פרסום": שתי משימות פרטיות למנהל (ptk), מזהה קבוע; לחיצה חוזרת – 409, בלי כפילות.
//   3. לחיצה כפולה על "הוסף משימה" – כתיבה אחת בלבד.
// רשת מדומה ("ענן" בזיכרון), בלי אמולטור. שימוש: node ui-link1.js <www-dir> [shots-dir]
const fs = require('fs'); const path = require('path'); const H = require('./harness');
const BZ0 = ['larg', 'peami'].join('');
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
let fail = 0; const check = (n, ok, info) => { if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const S = (v) => ({ stringValue: String(v) });
const T0 = H.T0;
const DOCS = 'projects/demo-largpeami/databases/(default)/documents/';
let DB, LOG;
const reset = () => { DB = { tasks: {}, ptk: {}, rtk: {}, rq: {}, staff: {} }; LOG = []; };
const docOf = (col, id) => ({ name: DOCS + col + '/' + id, fields: DB[col][id], createTime: '2026-11-03T09:00:00Z', updateTime: '2026-11-03T09:00:00Z' });
const MINE = new Set(['tasks', 'ptk', 'rtk', 'rq']);
async function mockCloud(ctx, who) {
  await ctx.route((u) => new URL(u).port === '8080', async (route) => {
    const req = route.request(), u = new URL(req.url()), m = req.method(), p = decodeURIComponent(u.pathname), body = req.postData() || '';
    const i = p.indexOf('/documents'); if (i < 0) return route.fallback(); const rest = p.slice(i + 10);
    const ok = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    const err = (c, s) => route.fulfill({ status: c, contentType: 'application/json', body: JSON.stringify({ error: { code: c, message: s, status: s } }) });
    if (rest === '/rv/tk2') return err(404, 'NOT_FOUND');
    if (rest === ':runQuery') {
      let q = {}; try { q = JSON.parse(body).structuredQuery; } catch (e) { /* */ }
      const c = q.from && q.from[0].collectionId; if (!MINE.has(c)) return route.fallback();
      let ids = Object.keys(DB[c]); const w = q.where && q.where.fieldFilter;
      if (w) ids = ids.filter((id) => { const v = DB[c][id][w.field.fieldPath]; const sv = v && v.stringValue; return w.op === 'IN' ? w.value.arrayValue.values.some((x) => x.stringValue === sv) : sv === w.value.stringValue; });
      return ok(ids.length ? ids.map((id) => ({ document: docOf(c, id), readTime: 'x' })) : [{ readTime: 'x' }]);
    }
    if (m === 'GET' && rest.split('?')[0] === '/staff') return ok({ documents: Object.keys(DB.staff).map((id) => docOf('staff', id)) });
    const s = rest.split('?')[0].split('/').filter(Boolean); const col = s[0], id = s[1];
    if (!MINE.has(col) || s.length > 2) return route.fallback();
    if (m === 'GET') return id ? (DB[col][id] ? ok(docOf(col, id)) : err(404, 'NOT_FOUND')) : ok({ documents: Object.keys(DB[col]).map((k) => docOf(col, k)) });
    if (m === 'POST') { const nid = u.searchParams.get('documentId'); const f = JSON.parse(body).fields;
      if (DB[col][nid]) { LOG.push({ who, m, col, id: nid, st: 409 }); return err(409, 'ALREADY_EXISTS'); } // כמו Firestore: create על מזהה קיים
      DB[col][nid] = f; LOG.push({ who, m, col, id: nid, f }); return ok(docOf(col, nid)); }
    return route.fallback();
  });
}
const shot = async (page, dir, name) => { if (!dir) return; fs.mkdirSync(dir, { recursive: true }); await page.waitForTimeout(250); await page.screenshot({ path: path.join(dir, name + '.png'), fullPage: true }); };
const waitFor = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 4000)) { if (await fn()) return true; await sleep(60); } return false; };
const dlgOpen = (page) => page.evaluate(() => { const d = document.getElementById('dlg'); return !!(d && d.open); });
const closeD = async (page) => { if (await dlgOpen(page)) { await page.evaluate(() => closeDlg()); await sleep(150); } };
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
// חשבונית ספק פתוחה (קטגוריה עם beh 'sup'), יום תשלום 20/11/2026
const addInv = (page) => page.evaluate(() => { const c = S.cats.find((x) => x.beh === 'sup'); if (!c) return '';
  const t = { id: 'invT1', t: 'exp', cat: c.id, sub: '', desc: 'ספק בדיקה', date: '2026-11-01', due: '2026-11-20', amt: 1234, inv: '777', pays: [] }; S.tx.push(t); return t.id; });

(async () => {
  const [www, shots] = process.argv.slice(2); const browser = await H.launch();
  const cfg = { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: ALL } }, admins: { '|m': 1 }, staff: { '|w1': 1, '|w2': 1 } };
  const open = async (label, email) => { const x = await H.newPage(browser, www, cfg, [], label); await x.page.setViewportSize({ width: 360, height: 740 });
    await mockCloud(x.ctx, email.split('@')[0]); await H.login(x.page, email); if (await x.page.$('[data-a=startBlank]')) { await x.page.click('[data-a=startBlank]'); await sleep(300); }
    await sleep(1200); await closeD(x.page); return x; };
  reset();
  DB.staff.w1 = { name: S('עובד א'), email: S('w1@x.co'), active: { booleanValue: true } };
  DB.staff.w2 = { name: S('עובד ב'), email: S('w2@x.co'), active: { booleanValue: true } };
  const m = await open('m-link', 'm@x.co'); const mp = m.page;
  await mp.evaluate(() => { TKT = 'open'; go('tk'); }); await sleep(800); await mp.evaluate(() => tkLoad()); await sleep(600);
  await mp.evaluate(() => go('home')); await sleep(300);

  // 1. חשבונית → משימה
  const iid = await addInv(mp);
  check('1 נוצרה חשבונית לבדיקה', !!iid);
  await mp.evaluate((id) => payDlg(id), iid); await sleep(250);
  check('1א בחלון "סגירת תשלום" יש כפתור "צור משימה" (44px)', await mp.evaluate(() => { const b = document.querySelector('#dlg #tkwPfInv'); return !!b && b.getBoundingClientRect().height >= 44; }));
  await shot(mp, shots, 'link-paydlg');
  await mp.click('#dlg #tkwPfInv'); await sleep(700);
  const f1 = await mp.evaluate(() => { const f = document.querySelector('form[data-f=tkAdd]'); return f ? { v: cur().v, hidden: f.hidden, txt: f.elements.txt.value, d: (document.querySelector('input[data-i=tkwD]') || {}).value || '', tm: (document.querySelector('input[data-i=tkwTm]') || {}).value || '', dlg: document.getElementById('dlg').open } : null; });
  check('1ב טופס "משימה חדשה" פתוח וממולא: ספק, סכום, מס׳ חשבונית, יעד', f1 && f1.v === 'tk' && !f1.hidden && !f1.dlg && /^לטפל בחשבונית ספק בדיקה .*1,?234.*\(מס׳ 777\) – יעד 20\/11\/2026$/.test(f1.txt), f1);
  check('1ג יעד מוצע: תאריך ושעה = 20/11/2026 12:00', f1 && f1.d === '2026-11-20' && f1.tm === '12:00', f1);
  await shot(mp, shots, 'link-form');

  // 3. לחיצה כפולה על "הוסף משימה" – כתיבה אחת (נמען אחד: עובד א)
  await mp.evaluate(() => { TKN.sel = new Set(['w1']); });
  LOG.length = 0;
  await mp.evaluate(() => { const b = document.querySelector('form[data-f=tkAdd] button.w'); b.click(); b.click(); });
  await waitFor(async () => LOG.some((l) => l.col === 'tasks' && l.m === 'POST'), 5000); await sleep(800);
  const posts = LOG.filter((l) => l.col === 'tasks' && l.m === 'POST');
  check('3 לחיצה כפולה על "הוסף משימה" – משימה אחת בלבד', posts.length === 1, posts.map((x) => x.id));
  const tf = posts[0] && posts[0].f;
  check('3א המשימה נשמרה עם הטקסט מהחשבונית ויעד dl (20/11 12:00 שעון ישראל)', tf && /חשבונית ספק בדיקה/.test(tf.txt.stringValue) && +((tf.dl || {}).integerValue) === Date.UTC(2026, 10, 20, 10, 0), tf && tf.dl);

  // 2. מבצע → משימות פרסום (פרטיות למנהל)
  LOG.length = 0;
  await mp.evaluate(() => TKW.promoAsk('pkTEST12345', 'חלב 1+1')); await sleep(200);
  check('2 חלון "צור משימות פרסום" עם שתי המשימות', await mp.evaluate(() => { const t = document.getElementById('dlg').innerText; return /צור משימות פרסום/.test(t) && /בקבוצות הווצאפ/.test(t) && /עלה בקו/.test(t); }));
  await shot(mp, shots, 'link-promo');
  await mp.evaluate(() => { const b = document.querySelector('#dlg [data-a=tkwPromo]'); b.click(); b.click(); });
  await waitFor(async () => LOG.filter((l) => l.col === 'ptk').length >= 2, 5000); await sleep(500);
  const pp = LOG.filter((l) => l.col === 'ptk' && !l.st);
  const ids = pp.map((x) => x.id).sort();
  check('2א נוצרו 2 משימות פרטיות עם מזהה קבוע (יום + מבצע + מספר)', pp.length === 2 && ids.join() === 'ymp20261103_pkTEST12345_1,ymp20261103_pkTEST12345_2', ids);
  const okKeys = ['owner', 'by', 'txt', 'cr', 'due', 'st', 'sub', 'late', 'dl', 'pri', 'cat', 'est', 'ck', 'ckd'];
  check('2ב שדות לפי כללי ptk: owner = המנהל, due ≥ cr+72h, dl היום 23:59', pp.length === 2 && pp.every((x) => Object.keys(x.f).every((k) => okKeys.includes(k)) && x.f.owner.stringValue === 'm' && +x.f.due.integerValue >= +x.f.cr.integerValue + 259200000 && +x.f.dl.integerValue === Date.UTC(2026, 10, 3, 21, 59)) && /חלב 1\+1/.test(pp[0].f.txt.stringValue), pp[0] && pp[0].f);
  LOG.length = 0;
  await mp.evaluate(() => TKW.promoAsk('pkTEST12345', 'חלב 1+1')); await sleep(150);
  await mp.click('#dlg [data-a=tkwPromo]'); await waitFor(async () => LOG.filter((l) => l.col === 'ptk').length >= 2, 4000); await sleep(300);
  check('2ג לחיצה חוזרת באותו יום – אין כפילות (409, לא נוצר מסמך חדש)', LOG.filter((l) => l.col === 'ptk' && !l.st).length === 0 && Object.keys(DB.ptk).length === 2, LOG.map((l) => l.st));
  check('4 אין שגיאות JS (מנהל)', mp.__errors.length === 0, mp.__errors);
  check('4א 360px: אין גלילה אופקית', await noOverflow(mp));

  // עובד: בלי כפתורי החיבורים
  const w = await open('w-link', 'w1@x.co'); const wp = w.page;
  check('5 עובד: TKW.pfOk() = false (אין כפתורי "צור משימה")', await wp.evaluate(() => !!window.TKW && TKW.pfOk() === false));
  const wi = await addInv(wp);
  if (wi) { await wp.evaluate((id) => { try { payDlg(id); } catch (e) { /* */ } }, wi); await sleep(200); }
  check('5א עובד: בחלון התשלום אין כפתור "צור משימה"', await wp.evaluate(() => !document.querySelector('#dlg #tkwPfInv')));
  await wp.evaluate(() => { try { TKW.promoAsk('pkTEST12345', 'x'); } catch (e) { /* */ } }); await sleep(100);
  check('5ב עובד: אין חלון "צור משימות פרסום"', await wp.evaluate(() => !document.querySelector('#dlg [data-a=tkwPromo]')));
  check('5ג אין שגיאות JS (עובד)', wp.__errors.length === 0, wp.__errors);
  await browser.close();
  console.log(fail ? `נכשלו ${fail}` : 'כל הבדיקות עברו'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
