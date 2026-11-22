'use strict';
// בית המנהל (כרטיס "מה דורש טיפול היום") וביצועי עובד – ui-home2.js. מבוסס על ui-wc4.js.
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
  seed(); RV = 'new'; DB.rq = {}; DB.tasks = {};
  DB.staff.m = { name: S('מנהל'), email: S('m@x.co'), active: { booleanValue: true } };
  // עובד א: 2 באיחור פתוחות, 1 ממתינה, 1 בוצעה בזמן, 1 בוצעה באיחור, 1 הוחזרה; עובד ב: לא קיים בסיכום
  task('l1', { txt: S('באיחור 1'), due: I(T0 - 2 * D1), dl: I(T0 - 2 * D1), cr: I(T0 - 5 * D1) });
  task('l2', { txt: S('באיחור 2'), due: I(T0 - D1), dl: I(T0 - D1), cr: I(T0 - 4 * D1) });
  task('w1', { txt: S('ממתינה'), st: S('wait'), sub: I(T0 - H1), dl: I(T0 + D1), due: I(T0 + D1) });
  task('o1', { txt: S('פתוחה'), dl: I(T0 + 3 * D1), due: I(T0 + 3 * D1) });
  task('r1', { txt: S('שגרה'), rc: S('r1'), dl: I(T0 + 5 * H1), due: I(T0 + 5 * D1) });
  task('d1', { txt: S('בוצעה בזמן'), st: S('done'), open: S(''), sub: I(T0 - 2 * D1), doneBy: S('w1@x.co'), dl: I(T0 - D1), due: I(T0 - D1), cr: I(T0 - 6 * D1) });
  task('d2', { txt: S('בוצעה באיחור'), st: S('done'), open: S(''), sub: I(T0 - D1), doneBy: S('w1@x.co'), dl: I(T0 - 3 * D1), due: I(T0 - 3 * D1), cr: I(T0 - 8 * D1), late: S('1') });
  task('rt1', { txt: S('הוחזרה'), rt: S('1'), dl: I(T0 + 2 * D1), due: I(T0 + 2 * D1) });
  rq('q1', {}); rq('q2', {});
  const m = await open('m-home2', 'm@x.co'); const mp = m.page;
  await mp.evaluate(() => { go('home'); }); await sleep(400); await mp.evaluate(() => tkLoad()); await sleep(800); await mp.evaluate(() => { RQ.at = 0; return rqLoad(); }); await sleep(800); await mp.evaluate(() => rerender()); await sleep(300);
  const rows = () => mp.evaluate(() => [...document.querySelectorAll('#hmTodo button.k')].map((x) => (x.querySelector('small').innerText + ' ' + x.querySelector('b').innerText).replace(/\s+/g, ' ').trim()));
  let r = await rows();
  check('1 כרטיס "דורש טיפול" מתחת לנתוני העסק (אחרי אריחי התשלום)', await mp.evaluate(() => { const c = document.getElementById('hmTodo'), k = document.getElementById('hcards'); return !!c && !!k && !!(k.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING); }));
  check('1א משימות באיחור 2 / ממתינות 1 / פתוחות 3 (כולל הקבועה וההוחזרה)', r.some((x) => /משימות באיחור 2/.test(x)) && r.some((x) => /ממתינות לאישור 1/.test(x)) && r.some((x) => /משימות פתוחות 3/.test(x)), r);
  check('1ב בקשות עובדים 2 + שגרה יומית 1', r.some((x) => /בקשות עובדים שממתינות 2/.test(x)) && r.some((x) => /שגרה יומית.* 1$/.test(x)), r);
  check('1ג קיצורים: משימה חדשה', await mp.evaluate(() => !!document.querySelector('#hmTodo [data-a=hmTkNew]')));
  await mp.evaluate(() => { const c = S.cats.find((x) => x.beh === 'sup' && !x.hid && !x.off); S.subs.push({ id: 'sX', cat: c.id, name: 'ספק בדיקה' }); S.tx.push({ id: 'iv1', t: 'exp', cat: c.id, sub: 'sX', date: '2026-10-01', amt: 500, plan: '2026-10', inv: '', note: '', desc: '', kind: 'inv', pays: [] }, { id: 'iv2', t: 'exp', cat: c.id, sub: 'sX', date: '2026-11-02', amt: 300, plan: '2026-11', inv: '', note: '', desc: '', kind: 'inv', pays: [] }); rerender(); }); await sleep(300);
  r = await rows();
  check('2 חשבוניות: שורת איחור ושורת "לתשלום החודש"', r.some((x) => /חשבוניות באיחור/.test(x)) && r.some((x) => /חשבוניות לתשלום/.test(x)), r);
  await shot(mp, shots, 'home-360');
  check('3 360px: אין גלילה אופקית בבית', await noOverflow(mp));
  await mp.click('#hmTodo [data-a=hmTk][data-v=late]'); await sleep(500);
  check('4 לחיצה על "באיחור" פותחת את מרכז המשימות בלשונית באיחור', await mp.evaluate(() => cur().v === 'tk' && TKT === 'late'));
  await mp.evaluate(() => { go('home'); }); await sleep(400);
  await mp.click('#hmTodo [data-a=rq]').catch(() => {}); 
  await mp.click('#hmTodo [data-a=go][data-v=rq]'); await sleep(400);
  check('5 לחיצה על בקשות פותחת את מסך הבקשות', await mp.evaluate(() => cur().v === 'rq'));
  // אפס: הכול ריק ← "אין דברים פתוחים"
  DB.tasks = {}; DB.rq = {};
  await mp.evaluate(() => { go('home'); S.tx = S.tx.filter((t) => !/^iv/.test(t.id)); TK.L = []; TK.at = Date.now(); RQ.L = []; RQ.at = Date.now(); rerender(); }); await sleep(400);
  check('6 הכול 0 ← "✓ אין דברים פתוחים", בלי שורות', (await txt(mp, '#hmTodo')).includes('✓ אין דברים פתוחים') && (await rows()).length === 0, await txt(mp, '#hmTodo'));
  // ביצועי עובד
  DB.tasks = {}; DB.rq = {};
  task('l1', { txt: S('באיחור 1'), due: I(T0 - 2 * D1), dl: I(T0 - 2 * D1), cr: I(T0 - 5 * D1) });
  task('d1', { txt: S('בוצעה בזמן'), st: S('done'), open: S(''), sub: I(T0 - 2 * D1), doneBy: S('w1@x.co'), dl: I(T0 - D1), due: I(T0 - D1), cr: I(T0 - 6 * D1) });
  task('d2', { txt: S('בוצעה באיחור'), st: S('done'), open: S(''), sub: I(T0 - D1), doneBy: S('w1@x.co'), dl: I(T0 - 3 * D1), due: I(T0 - 3 * D1), cr: I(T0 - 8 * D1), late: S('1') });
  task('d3', { txt: S('ישנה'), st: S('done'), open: S(''), sub: I(T0 - 60 * D1), doneBy: S('w1@x.co'), dl: I(T0 - 59 * D1), due: I(T0 - 59 * D1), cr: I(T0 - 62 * D1) });
  task('rt1', { txt: S('הוחזרה'), rt: S('1'), dl: I(T0 + 2 * D1), due: I(T0 + 2 * D1) });
  await mp.evaluate(() => { const c = S.cats.find((x) => x.beh === 'emp') || S.cats[0]; S.subs.push({ id: 'sEmp', cat: c.id, name: 'עובד א', pay: { uid: 'w1', comp: [{ k: 'tk', m: 'all', a: 100 }] } }); S.enotes = [{ id: 'n1', sub: 'sEmp', t: 'הערה', d: '2026-11-01', at: '2026-11-01T09:00:00Z' }, { id: 'n2', sub: 'sEmp', t: 'ישנה', d: '2026-09-01', at: '2026-09-01T09:00:00Z' }]; TKT = 'team'; go('tk'); }); await sleep(600);
  await mp.evaluate(() => tkLoad()); await sleep(900); await mp.evaluate(() => { TKT = 'team'; rerender(); }); await sleep(300);
  const ca = async () => (await cardOf(mp, '^עובד א')).replace(/\s+/g, ' ');
  let c = await ca();
  check('7 30 יום: הוטלו 4 (l1, d1, d2, rt1; d3 ישנה)', /4 הוטלו/.test(c), c);
  check('7א בוצעו 2, באיחור 1, פתוחות באיחור 1', /2 בוצעו/.test(c) && /1 באיחור/.test(c) && /1 פתוחות באיחור/.test(c), c);
  check('7ב אחוז בזמן 50% והוחזרו 1', /50%/.test(c) && /1 הוחזרו לתיקון/.test(c), c);
  check('7ג הערות מנהל: 1 בתקופה, עם קישור לכרטיס העובד', /הערות מנהל: 1/.test(c) && await mp.evaluate(() => !!document.querySelector('#main [data-a=go][data-v=card][data-arg=sEmp]')), c);
  check('7ד בונוס משימות – קישור כי קיים רכיב tk', /בונוס משימות/.test(c), c);
  await shot(mp, shots, 'team-360');
  await mp.click('[data-a=tkwPf][data-v="90"]'); await sleep(300); c = await ca();
  check('8 בורר 90 ימים: הוטלו 5, בוצעו 3 והערות 2', /5 הוטלו/.test(c) && /3 בוצעו/.test(c) && /הערות מנהל: 2/.test(c), c);
  await mp.click('[data-a=tkwPf][data-v="7"]'); await sleep(300); c = await ca();
  check('8א בורר 7 ימים: הערות 1', /הערות מנהל: 1/.test(c), c);
  check('9 360px: אין גלילה אופקית בצוות', await noOverflow(mp));
  check('10 אין שגיאות JS', mp.__errors.length === 0, mp.__errors);
  // עובד לא רואה את הכרטיס
  const w = await open('w-home2', 'w1@x.co'); await sleep(500);
  check('11 עובד: אין כרטיס "מה דורש טיפול"', (await w.page.evaluate(() => !!document.getElementById('hmTodo'))) === false);
  await browser.close();
  console.log(fail ? `נכשלו ${fail}` : 'כל הבדיקות עברו'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
