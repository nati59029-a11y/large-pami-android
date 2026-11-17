'use strict';
// סבב 2, חבילה ב': (1) סרגל תחתון לעובד בלבד (בית · משימות · בקשות · עוד, מונה "בקשות"; סרגל המנהל לא משתנה),
// (2) משימה חדשה למנהל: 3 סוגים (לעובד אחד / כל הנבחרים – עותק לכל עובד / אחד מהנבחרים – מי שלוקח ראשון),
// (3) "X מתוך Y ביצעו" לקבוצת עותקים (אותו טקסט ואותו cr). רשת מדומה, בלי אמולטור.
// שימוש: node ui-r2b.js <www-dir> [shots-dir]
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
const shot = async (page, dir, name) => { if (!dir) return; fs.mkdirSync(dir, { recursive: true }); await page.waitForTimeout(250); await page.screenshot({ path: path.join(dir, name + '.png'), fullPage: false }); };
const txt = (page, sel) => page.evaluate((s) => (document.querySelector(s) || {}).innerText || '', sel);
const waitFor = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 4000)) { if (await fn()) return true; await sleep(60); } return false; };
const dlgOpen = (page) => page.evaluate(() => { const d = document.getElementById('dlg'); return !!(d && d.open); });
const closeD = async (page) => { if (await dlgOpen(page)) { await page.evaluate(() => closeDlg()); await sleep(150); } };
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const cardOf = (page, re) => page.evaluate((s) => { const c = [...document.querySelectorAll('#main .card')].find((x) => new RegExp(s).test(x.innerText)); return c ? c.innerText : ''; }, re);
const ALLOWED = ['owner', 'by', 'role', 'txt', 'cr', 'due', 'st', 'open', 'pr', 'img', 'sub', 'doneBy', 'note', 'ok', 'late', 'to', 'toN', 'ow', 'owN', 'clt', 'np', 'mi', 'wp', 'dl', 'pri', 'cat', 'est', 'ck', 'ckd', 'sa', 'nd'];
const posts = () => LOG.filter((l) => l.m === 'POST' && l.col === 'tasks');
const vis = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0; }, sel);

(async () => {
  const [www, shots] = process.argv.slice(2); const browser = await H.launch();
  const cfg = { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: ALL } }, admins: { '|m': 1 }, staff: { '|w1': 1, '|w2': 1 } };
  const open = async (label, email) => { const x = await H.newPage(browser, www, cfg, [], label); await x.page.setViewportSize({ width: 412, height: 900 });
    await mockCloud(x.ctx, email.split('@')[0]); await H.login(x.page, email); if (await x.page.$('[data-a=startBlank]')) { await x.page.click('[data-a=startBlank]'); await sleep(300); }
    await sleep(1200); await closeD(x.page); return x; };
  const seed2 = () => { seed(); DB.staff.w3 = { name: S('עובד ג'), email: S('w3@x.co'), active: { booleanValue: true } }; DB.tasks = {}; };

  // ================= מנהל: טופס משימה חדשה =================
  seed2();
  let m = await open('m-r2b', 'm@x.co'); let mp = m.page;
  const cr0 = T0 - 2 * H1;
  // קבוצת עותקים קיימת: 4 עותקים, 2 בוצעו, אחד ממתין לאישור, אחד פתוח + משימה בודדת עם אותו טקסט וזמן אחר
  ['a1', 'a2'].forEach((id, i) => task(id, { txt: S('לספור מלאי'), cr: I(cr0), to: A(['w' + (i + 1)]), toN: A(['עובד']), ow: S('w' + (i + 1)), st: S('done'), open: S(''), sub: I(T0 - H1), ok: I(T0 - H1) }));
  task('a3', { txt: S('לספור מלאי'), cr: I(cr0), to: A(['w3']), toN: A(['עובד ג']), ow: S('w3'), st: S('wait'), sub: I(T0 - H1) });
  task('a4', { txt: S('לספור מלאי'), cr: I(cr0), to: A(['w4']), toN: A(['עובד ד']), ow: S('w4') });
  task('s1', { txt: S('לספור מלאי'), cr: I(cr0 - D1), to: A(['w1']), toN: A(['עובד א']), ow: S('w1') });
  await mp.evaluate(() => { go('tk'); TKT = 'open'; }); await sleep(900); await mp.evaluate(() => { tkLoad().then(() => rerender()); }); await sleep(900);
  const tagTxt = await mp.evaluate(() => [...document.querySelectorAll('#main .card .tag')].map((x) => x.innerText).filter((x) => /ביצעו/.test(x)));
  check('1 מעקב קבוצה: "2 מתוך 4 ביצעו · 1 ממתינות לאישור" על העותקים הפתוחים; משימה בודדת עם אותו טקסט (cr אחר) לא נספרת', tagTxt.length >= 1 && tagTxt.every((x) => /2 מתוך 4 ביצעו/.test(x) && /1 ממתינות לאישור/.test(x)), tagTxt);
  DB.tasks = {};
  await mp.evaluate(() => { TK.at = 0; return tkLoad().then(() => rerender()); }); await sleep(600);
  await waitFor(() => mp.evaluate(() => !!document.querySelector('#tkrc .chip')));
  const kd = await mp.evaluate(() => ({ opts: [...document.querySelectorAll('#tkkd .opt')].map((x) => x.innerText.replace(/\s+/g, ' ').trim()), sel: [...document.querySelectorAll('#tkkd .opt.on')].map((x) => x.dataset.v), np: [...document.querySelectorAll('#tknp .chip')].map((x) => x.innerText).join(), img: !!document.querySelector('input[data-c=tkMimg]'), imgTxt: (document.querySelector('input[data-c=tkMimg]').parentElement.innerText || ''), order: [...document.querySelectorAll('form[data-f=tkAdd] .f > span, form[data-f=tkAdd] label.btn')].map((x) => x.innerText.trim().slice(0, 14)) }));
  check('2 הטופס: שלושה סוגים בבחירה אחת (ברירת מחדל "אחד מהנבחרים" = ההתנהגות הקיימת), תמונה 0-3, הוספת תמונה להוראות', kd.opts.length === 3 && /לעובד אחד/.test(kd.opts[0]) && /כל העובדים שנבחרו צריכים לבצע/.test(kd.opts[1]) && /מי שלוקח ראשון/.test(kd.opts[2]) && kd.sel.join() === 'any' && kd.np === '0,1,2,3' && kd.img && /הוסף תמונה להוראות/.test(kd.imgTxt), kd);
  await mp.evaluate(() => { const e = document.querySelector('input[data-c=tkMimg]'); e.parentElement.scrollIntoView({ block: 'start' }); window.scrollBy(0, -70); }); await shot(mp, shots, 'r2-ב-משימה-חדשה');
  // כל העובדים צריכים לבצע
  await mp.fill('form[data-f=tkAdd] textarea', 'לנקות את המקרר'); await mp.click('#tkkd [data-v=all]'); await sleep(300);
  await mp.click('#tknp [data-v="1"]'); LOG.length = 0;
  await mp.click('form[data-f=tkAdd] button.btn.w'); await waitFor(async () => posts().length >= 3, 6000); await sleep(500);
  const P = posts(), toOf = (p) => p.f.to.arrayValue.values.map((x) => x.stringValue).join();
  check('3 "כל הנבחרים": 3 משימות נפרדות, כל אחת לנמען אחד, תפוסה אצלו (ow=to[0]), אותו טקסט ואותו cr/due, np=1', P.length === 3 && P.map(toOf).sort().join() === 'w1,w2,w3' && P.every((p) => p.f.ow.stringValue === toOf(p) && p.f.txt.stringValue === 'לנקות את המקרר' && p.f.cr.integerValue === P[0].f.cr.integerValue && p.f.due.integerValue === P[0].f.due.integerValue && p.f.np.integerValue === '1' && p.f.toN.arrayValue.values.length === 1), P.map(toOf));
  check('3א כל שדה בעותק מותר בחוקי היצירה הקיימים (אין שדה חדש)', P.every((p) => Object.keys(p.f).every((k) => ALLOWED.includes(k))), P[0] && Object.keys(P[0].f));
  check('3ב אחרי השליחה: הטופס נוקה וחזר לברירת מחדל', await mp.evaluate(() => TKN.kind === 'any' && TKN.sel.size === 3 && TKN.np === 0));
  const cardsTag = await mp.evaluate(() => [...document.querySelectorAll('#main .card .tag')].map((x) => x.innerText).filter((x) => /ביצעו/.test(x)));
  check('3ג במעקב: "0 מתוך 3 ביצעו" לקבוצה שנוצרה', cardsTag.length >= 1 && cardsTag.every((x) => /0 מתוך 3 ביצעו/.test(x)), cardsTag);
  // לעובד אחד – עם שניים נבחרים נחסם; בבחירת סוג הבחירה מתאפסת
  await mp.fill('form[data-f=tkAdd] textarea', 'להזמין שקיות'); await mp.click('#tkkd [data-v=one]'); await sleep(300);
  const sel0 = await mp.evaluate(() => [...(TKN.sel || [])].length);
  LOG.length = 0; await mp.click('form[data-f=tkAdd] button.btn.w'); await sleep(600);
  check('4 "לעובד אחד": מעבר לסוג מאפס את הבחירה; בלי נבחר אין שליחה', sel0 === 0 && posts().length === 0, sel0);
  await mp.click('#tkrc [data-v=w2]'); await mp.click('#tkrc [data-v=w3]'); await sleep(200);
  const only = await mp.evaluate(() => [...(TKN.sel || [])].join());
  check('4א בסוג "לעובד אחד" בחירת עובד שני מחליפה את הראשון (עובד אחד בדיוק)', only === 'w3', only);
  await mp.click('form[data-f=tkAdd] button.btn.w'); await waitFor(async () => posts().length >= 1, 5000); await sleep(400);
  const P1 = posts();
  check('4ב נוצרה משימה אחת: to=[w3], ow=w3', P1.length === 1 && toOf(P1[0]) === 'w3' && P1[0].f.ow.stringValue === 'w3', P1.map(toOf));
  // אחד מהנבחרים
  await mp.fill('form[data-f=tkAdd] textarea', 'לפנות קרטונים'); LOG.length = 0;
  await mp.click('form[data-f=tkAdd] button.btn.w'); await waitFor(async () => posts().length >= 1, 5000); await sleep(400);
  const P2 = posts();
  check('5 "אחד מהנבחרים" (ברירת מחדל): משימה אחת עם כל הנמענים, ow ריק (מי שלוקח ראשון) – כמו קודם', P2.length === 1 && P2[0].f.to.arrayValue.values.length === 3 && P2[0].f.ow.stringValue === '', P2.map(toOf));
  check('5א אין שגיאות JS (מנהל)', mp.__errors.length === 0, mp.__errors);
  // סרגל המנהל לא השתנה
  const ab = await mp.evaluate(() => ({ adm: [...document.querySelectorAll('.bar:not(.wbar) button')].map((b) => b.innerText.trim()), wb: getComputedStyle(document.querySelector('.wbar')).display, admBar: getComputedStyle(document.querySelector('.bar:not(.wbar)')).display }));
  check('6 סרגל המנהל: בית · הכנסות · + · הוצאות · עוד (ללא שינוי), סרגל העובד מוסתר', ab.adm.join('|') === 'בית|הכנסות||הוצאות|עוד' && ab.wb === 'none' && ab.admBar !== 'none', ab);
  await m.ctx.close();

  // ================= עובד: סרגל =================
  seed2();
  rq('r1', { txt: S('המקרר במחסן לא מקרר'), ph: S('w'), ans: S('בטיפול'), aBy: S('m'), aAt: I(T0 - H1) });
  rq('r2', { txt: S('בקשה בלי תשובה') });
  task('t1', { txt: S('לסדר מדף') });
  let w = await open('w-r2b', 'w1@x.co'); let wp = w.page;
  await wp.evaluate(() => rqMine()); await sleep(900);
  const wb = await wp.evaluate(() => ({ cls: document.body.className, bar: [...document.querySelectorAll('.wbar button')].map((b) => ({ t: b.innerText.trim(), d: getComputedStyle(b).display, on: b.classList.contains('on'), bd: (b.querySelector('.bdg') || {}).innerText || '', bh: b.querySelector('.bdg') ? b.querySelector('.bdg').hidden : null })), old: getComputedStyle(document.querySelector('.bar:not(.wbar)')).display, wbd: getComputedStyle(document.querySelector('.wbar')).display }));
  check('7 עובד: סרגל בית · משימות · בקשות · עוד; סרגל המנהל מוסתר; "בית" פעיל', wb.wbd === 'grid' && wb.old === 'none' && wb.bar.map((b) => b.t.replace(/\d+/g, '')).join('|').replace(/\s/g, '') === 'בית|משימות|בקשות|עוד' && wb.bar[0].on, wb);
  check('7א מונה "בקשות" = תשובות שלא נקראו (4: r1,r3,r4,r5 נענו; r2 בלי תשובה)', wb.bar[2].bd === '4' && wb.bar[2].bh === false, wb.bar[2]);
  check('7ב כל המסכים של בית עדיין נגישים לעובד: משבצות הבית קיימות', await wp.evaluate(() => document.querySelectorAll('#main .tile').length >= 3), await wp.evaluate(() => [...document.querySelectorAll('#main .tile')].map((x) => x.innerText.trim().slice(0, 12))));
  await shot(wp, shots, 'r2-ב-סרגל-עובד-בית');
  await wp.click('.wbar [data-w=tk]'); await sleep(900);
  let st = await wp.evaluate(() => ({ v: cur().v, n: NAV.length, on: document.querySelector('.wbar .on').dataset.w, vis: getComputedStyle(document.querySelector('.wbar')).display, bk: document.getElementById('bk').style.display }));
  check('8 "משימות": מסך המשימות, הסרגל נשאר, "משימות" פעיל, אין כפתור חזרה (לשונית ראשית)', st.v === 'tk' && st.n === 1 && st.on === 'tk' && st.vis === 'grid' && st.bk === 'none', st);
  check('8א 412px: אין גלילה אופקית ואין חפיפה של הסרגל עם התוכן האחרון', (await noOverflow(wp)) && await wp.evaluate(() => parseFloat(getComputedStyle(document.querySelector('main')).paddingBottom) >= 90));
  await wp.click('.wbar [data-w=rq]'); await sleep(900);
  st = await wp.evaluate(() => ({ v: cur().v, on: document.querySelector('.wbar .on').dataset.w, form: !!document.querySelector('form[data-f=rqNew]') }));
  check('9 "בקשות": מסך הבקשות עם הטופס; "בקשות" פעיל', st.v === 'rq' && st.on === 'rq' && st.form, st);
  await wp.click('.wbar [data-w=more]'); await sleep(500);
  st = await wp.evaluate(() => ({ v: cur().v, t: document.getElementById('main').innerText }));
  check('10 "עוד": עדכון והתנתקות', st.v === 'wkMore' && /בדוק עדכון/.test(st.t) && /התנתק/.test(st.t), st);
  await wp.click('.wbar [data-w=home]'); await sleep(500);
  st = await wp.evaluate(() => ({ v: cur().v, ws: WS, on: document.querySelector('.wbar .on').dataset.w }));
  check('11 "בית": חזרה למסך הבית', st.v === 'wk' && st.ws === 'home' && st.on === 'home', st);
  // כניסה למסך משימות דרך משבצת הבית (go) – הסרגל מוצג וחזרה עובדת
  await wp.evaluate(() => go('tk')); await sleep(500);
  st = await wp.evaluate(() => ({ vis: getComputedStyle(document.querySelector('.wbar')).display, bk: document.getElementById('bk').style.display, back: goBack(), v: cur().v }));
  check('12 מעבר דרך משבצת: הסרגל מוצג, ו"חזרה" מחזירה לבית', st.vis === 'grid' && st.bk !== 'none' && st.back === true && st.v === 'wk', st);
  // אשף הוצאה: בלי סרגל
  await wp.evaluate(() => { WS = 'exp'; rerender(); }); await sleep(300);
  check('13 באשף הוצאה (WS=exp) הסרגל מוסתר', (await wp.evaluate(() => getComputedStyle(document.querySelector('.wbar')).display)) === 'none');
  await wp.evaluate(() => { WS = 'home'; rerender(); }); await sleep(300);
  // כפתור חזרה באנדרואיד משלשונית ראשית חוזר לבית
  await wp.evaluate(() => tab('rq')); await sleep(300);
  check('14 "חזרה" ממסך ראשי של הסרגל (בקשות) מחזירה לבית ולא יוצאת', await wp.evaluate(() => goBack() === true && cur().v === 'wk'));
  check('15 אין שגיאות JS (עובד)', wp.__errors.length === 0, wp.__errors);
  await w.ctx.close();
  await browser.close();
  console.log(fail ? 'תוצאה: ' + fail + ' נכשלו' : 'כל הבדיקות עברו'); process.exit(fail ? 1 : 0);
})();
