'use strict';
// מרכז עבודה – סבב 3 (www/tasks-wc.js + index.html): בקשות למנהל (rq) – סוג פנייה (k), תגיות שלב (ph: נשלחה/נקראה/בטיפול; אושרה/טופלה/נדחתה),
// מנהל: פתיחת שרשור כותבת ph:'r', "בטיפול" (ph:'w'), "הפוך למשימה" (טופס ממולא, נמען = מי ששלח, ואחרי יצירה ph:'w' + tk).
// כללים ישנים (rv → 403): בלי k/ph/tk ובלי הכפתורים; 403 על k ← נשלח שוב בלי k. "הזכר לעובד" קורא ל-tkNudge (כשל נבלע).
// ליטוש: 360px בלי גלילה אופקית, RTL, וביצועים עם 500 משימות (זמן ציור "היום שלי" / "פתוחות").
// רשת מדומה ("ענן" בזיכרון), בלי אמולטור. שימוש: node ui-wc3.js <www-dir> [shots-dir]
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
  const rvWait = (page, v) => waitFor(() => page.evaluate((v) => { try { const c = JSON.parse(localStorage.getItem(LK('lp-tk-rv'))); return !!c && c.v === v; } catch (e) { return false; } }, v));

  // ================= כללים חדשים – עובד =================
  seed(); RV = 'new';
  let w = await open('w-new', 'w1@x.co'); let wp = w.page;
  await wp.evaluate(() => go('rq')); await rvWait(wp, 1); await sleep(300); await wp.evaluate(() => rerender()); await sleep(500);
  check('1 עובד: בחירת סוג פנייה (בקשה/שאלה/תקלה/עדכון), ברירת מחדל "בקשה"', await wp.evaluate(() => [...document.querySelectorAll('form[data-f=rqNew] input[name=k]')].map((x) => x.value + (x.checked ? '*' : '')).join() === 'q*,s,b,u'));
  const c1 = await cardOf(wp, 'המקרר במחסן'), c2 = await cardOf(wp, 'משמרת בוקר'), c3 = await cardOf(wp, 'המפתח של המחסן'), c4 = await cardOf(wp, 'חופש מחר'), c5 = await cardOf(wp, 'ישנה שאושרה');
  check('2 תגיות: תקלה · נשלחה; בקשה · בטיפול; שאלה · טופלה; נדחתה; בקשה ישנה (בלי k) שטופלה · אושרה', /תקלה/.test(c1) && /נשלחה/.test(c1) && /בקשה/.test(c2) && /בטיפול/.test(c2) && /שאלה/.test(c3) && /טופלה/.test(c3) && /נדחתה/.test(c4) && /אושרה/.test(c5), [c1, c2, c3, c4, c5].map((x) => x.split('\n').slice(0, 2).join(' | ')));
  check('3 360px: אין גלילה אופקית במסך הבקשות (עובד); כיוון RTL', (await noOverflow(wp)) && await wp.evaluate(() => getComputedStyle(document.querySelector('form[data-f=rqNew]')).direction === 'rtl'));
  await shot(wp, shots, 'w-rq-new');
  await wp.fill('form[data-f=rqNew] textarea', 'נשבר מדף בחנות'); await wp.click('form[data-f=rqNew] input[name=k][value=b]');
  await wp.click('form[data-f=rqNew] button.btn.w'); await waitFor(async () => LOG.some((l) => l.m === 'POST' && l.col === 'rq'));
  const p1 = LOG.find((l) => l.m === 'POST' && l.col === 'rq');
  check('4 שליחה: k=b (תקלה) נשמר עם השדות הרגילים, בלי ph/tk', p1 && !p1.st && p1.f.k.stringValue === 'b' && p1.f.st.stringValue === 'new' && !('ph' in p1.f) && !('tk' in p1.f), p1 && Object.keys(p1.f));
  // 403 על k (הגלאי אמר "חדשים" אבל השרת דוחה): נשלח שוב בלי k והמכשיר מסומן "ישן"
  K403 = true; LOG.length = 0;
  await sleep(500); await wp.fill('form[data-f=rqNew] textarea', 'עוד בקשה'); await wp.click('form[data-f=rqNew] button.btn.w');
  await waitFor(async () => LOG.filter((l) => l.m === 'POST' && l.col === 'rq').length >= 2);
  const ps = LOG.filter((l) => l.m === 'POST' && l.col === 'rq');
  check('5 403 על k: נשלח שוב בלי k, והמכשיר מסומן "כללים ישנים"', ps.length === 2 && ps[0].st === 403 && !ps[1].st && !('k' in ps[1].f) && await wp.evaluate(() => !TKW.rv()), ps.map((x) => [x.st, Object.keys(x.f).join()]));
  await sleep(400);
  check('5א אחרי סימון "ישן": בחירת הסוג והתגיות החדשות מוסתרות (חוזר ל"ממתין לטיפול"/"טופל")', await wp.evaluate(() => !document.querySelector('form[data-f=rqNew] input[name=k]')) && /ממתין לטיפול/.test(await txt(wp, '#main')));
  K403 = false;
  check('6 אין שגיאות JS (עובד)', wp.__errors.length === 0, wp.__errors);
  await w.ctx.close();

  // ================= כללים חדשים – מנהל =================
  seed(); RV = 'new';
  let m = await open('m-new', 'm@x.co'); let mp = m.page;
  await mp.evaluate(() => { go('rq'); }); await rvWait(mp, 1); await mp.evaluate(() => { RQ.at = 0; rqLoad(); }); await sleep(800);
  const mc1 = await cardOf(mp, 'המקרר במחסן');
  check('7 מנהל: תגיות "תקלה · נשלחה" בכרטיס', /תקלה/.test(mc1) && /נשלחה/.test(mc1), mc1.slice(0, 120));
  LOG.length = 0;
  await mp.click('[data-a=rqThread][data-id=r1]'); await waitFor(async () => LOG.some((l) => l.m === 'PATCH' && l.col === 'rq'));
  const pr = LOG.find((l) => l.m === 'PATCH' && l.col === 'rq');
  check('8 פתיחת שרשור של בקשה שלא נקראה: ph=r בלבד (updateMask ph)', pr && pr.id === 'r1' && pr.mask.join() === 'ph' && pr.f.ph.stringValue === 'r', pr);
  const dl = await txt(mp, '#dlg');
  check('9 בשרשור: "בטיפול" ו"הפוך למשימה", לצד טופל/נדחה', /בטיפול/.test(dl) && /הפוך למשימה/.test(dl) && /טופל/.test(dl) && /נדחה/.test(dl), dl.slice(-200));
  check('9א 360px: אין גלילה אופקית עם חלון השרשור', await noOverflow(mp));
  await shot(mp, shots, 'm-rq-thread');
  await mp.fill('#dlg textarea[name=txt]', 'טקסט שמוקלד');
  await mp.click('#dlg [data-a=tkwRqW]'); await waitFor(async () => DB.rq.r1.ph.stringValue === 'w');
  await sleep(200);
  check('10 "בטיפול": ph=w; החלון נשאר פתוח והטקסט שהוקלד לא נמחק', DB.rq.r1.ph.stringValue === 'w' && await dlgOpen(mp) && await mp.evaluate(() => document.querySelector('#dlg textarea[name=txt]').value === 'טקסט שמוקלד') && !(await mp.$('#dlg [data-a=tkwRqW]')));
  await closeD(mp); await sleep(300);
  check('10א אחרי סגירה הכרטיס מציג "בטיפול"', /בטיפול/.test(await cardOf(mp, 'המקרר במחסן')));
  // שרשור של בקשה שכבר "בטיפול" – לא נכתב ph שוב
  LOG.length = 0; await mp.click('[data-a=rqThread][data-id=r2]'); await sleep(600);
  check('11 שרשור של בקשה שכבר בטיפול: אין כתיבה, ואין כפתור "בטיפול"', !LOG.some((l) => l.m === 'PATCH') && !(await mp.$('#dlg [data-a=tkwRqW]')) && !!(await mp.$('#dlg [data-a=tkwRqTk]')));
  // הפוך למשימה
  await mp.click('#dlg [data-a=tkwRqTk]'); await sleep(900);
  const fm = await mp.evaluate(() => ({ v: cur().v, t: TKT, txt: document.querySelector('form[data-f=tkAdd] textarea').value, sel: [...(TKN.sel || [])].join(), ban: /משימה מבקשה של עובד א/.test(document.querySelector('form[data-f=tkAdd]').innerText), dlg: document.getElementById('dlg').open }));
  check('12 "הפוך למשימה": מסך המשימות, הטופס ממולא בטקסט הבקשה, הנמען = מי ששלח, הודעה "משימה מבקשה של…"', fm.v === 'tk' && fm.txt === 'אפשר לקבל משמרת בוקר?' && fm.sel === 'w1' && fm.ban && !fm.dlg, fm);
  check('12א 360px: אין גלילה אופקית בטופס הממולא', await noOverflow(mp));
  await shot(mp, shots, 'm-rq-to-task');
  LOG.length = 0;
  await mp.click('form[data-f=tkAdd] button.btn.w'); await waitFor(async () => LOG.some((l) => l.m === 'PATCH' && l.col === 'rq'), 5000);
  const pt = LOG.find((l) => l.m === 'POST' && l.col === 'tasks'), pq = LOG.find((l) => l.m === 'PATCH' && l.col === 'rq');
  check('13 נוצרה משימה לעובד ששלח (to=[w1], ow=w1) עם טקסט הבקשה', pt && pt.f.txt.stringValue === 'אפשר לקבל משמרת בוקר?' && pt.f.to.arrayValue.values.map((x) => x.stringValue).join() === 'w1' && pt.f.ow.stringValue === 'w1', pt && Object.keys(pt.f));
  check('14 אחרי היצירה: הבקשה מקבלת ph=w ו-tk = מזהה המשימה', pq && pq.id === 'r2' && pq.mask.slice().sort().join() === 'ph,tk' && pq.f.tk.stringValue === pt.id && pq.f.ph.stringValue === 'w', pq);
  check('14א ההודעה "משימה מבקשה" נעלמה מהטופס', await mp.evaluate(() => !/משימה מבקשה של/.test(document.querySelector('form[data-f=tkAdd]').innerText) && !TKW.rqc));
  // "הזכר לעובד" ← tkNudge; כשל נבלע
  await mp.evaluate(() => { TKT = 'open'; tkLoad(); }); await sleep(600); await mp.evaluate(() => rerender()); await sleep(300);
  FN_FAIL = true;
  await mp.click('#tkc-t1 [data-a=tkwNd]'); await mp.click('#dlg [data-a=yes]'); await waitFor(async () => FN.length === 1);
  await sleep(500);
  check('15 "הזכר לעובד": nd נכתב ואחריו קריאה ל-tkNudge({taskId}); כשל בשרת נבלע (אין שגיאת JS)', LOG.some((l) => l.m === 'PATCH' && l.col === 'tasks' && l.mask.includes('nd')) && FN[0].data.taskId === 't1' && !('bizId' in FN[0].data) && mp.__errors.length === 0, FN);
  FN_FAIL = false;
  check('16 אין שגיאות JS (מנהל)', mp.__errors.length === 0, mp.__errors);
  await m.ctx.close();

  // ================= כללים ישנים: אין k/ph/tk ואין כפתורים =================
  seed(); RV = 'old';
  w = await open('w-old', 'w1@x.co'); wp = w.page;
  await wp.evaluate(() => go('rq')); await rvWait(wp, 0); await wp.evaluate(() => rerender()); await sleep(400);
  check('17 כללים ישנים – עובד: אין בחירת סוג; התגיות כמו קודם', await wp.evaluate(() => !document.querySelector('form[data-f=rqNew] input[name=k]')) && /ממתין לטיפול/.test(await txt(wp, '#main')) && !/נשלחה\s/.test(await cardOf(wp, 'המקרר במחסן')));
  await wp.fill('form[data-f=rqNew] textarea', 'בקשה בכללים ישנים'); await wp.click('form[data-f=rqNew] button.btn.w'); await waitFor(async () => LOG.some((l) => l.m === 'POST' && l.col === 'rq'));
  const po = LOG.filter((l) => l.m === 'POST' && l.col === 'rq');
  check('18 כללים ישנים – עובד: נשלח בלי k (בקשה אחת, בלי 403)', po.length === 1 && !po[0].st && !('k' in po[0].f), po.map((x) => [x.st, Object.keys(x.f).join()]));
  await w.ctx.close();
  m = await open('m-old', 'm@x.co'); mp = m.page; LOG.length = 0;
  await mp.evaluate(() => go('rq')); await rvWait(mp, 0); await mp.evaluate(() => { RQ.at = 0; rqLoad(); }); await sleep(700);
  await mp.click('[data-a=rqThread][data-id=r1]'); await sleep(700);
  check('19 כללים ישנים – מנהל: פתיחת שרשור לא כותבת ph, ואין "בטיפול"/"הפוך למשימה"', !LOG.some((l) => l.m === 'PATCH' && l.col === 'rq') && !(await mp.$('#dlg [data-a=tkwRqW]')) && !(await mp.$('#dlg [data-a=tkwRqTk]')));
  check('20 אין שגיאות JS (כללים ישנים)', mp.__errors.length === 0, mp.__errors);
  await m.ctx.close();

  // ================= ביצועים: 500 משימות =================
  seed(); RV = 'new';
  for (let i = 0; i < 500; i++) task('p' + i, { txt: S('משימת דמו ' + i), to: A(['w1', 'w2']), toN: A(['עובד א', 'עובד ב']), ow: S(i % 3 ? 'w1' : ''), owN: S(i % 3 ? 'עובד א' : ''), dl: I(T0 + (i % 40 - 10) * H1), pri: S(i % 7 ? '' : 'h'), cat: S('נושא ' + (i % 5)) });
  for (let i = 0; i < 100; i++) DB.ptk['pp' + i] = { owner: S('w1'), by: S('w1'), txt: S('פרטית ' + i), cr: I(T0 - D1), due: I(T0 + D1), st: S('open'), sub: I(0), late: S('') };
  w = await open('w-perf', 'w1@x.co'); wp = w.page;
  await wp.evaluate(() => { TKT = 'my'; go('tk'); }); await sleep(600); await wp.evaluate(() => tkLoad()); await waitFor(() => wp.evaluate(() => (TK.L || []).length >= 500 && (PT.L || []).length >= 100), 8000);
  const perf = await wp.evaluate(() => { const t = (tab) => { TKT = tab; const a = performance.now(); for (let i = 0; i < 3; i++) rerender(); return Math.round((performance.now() - a) / 3); };
    return { my: t('my'), open: t('open'), late: t('late'), n: document.querySelectorAll('#main .card').length }; });
  check('21 500 משימות + 100 פרטיות: ציור "היום שלי" / "פתוחות" / "באיחור" מתחת ל-400ms (ממוצע 3 ציורים)', perf.my < 400 && perf.open < 400 && perf.late < 400, perf);
  check('21א 360px: אין גלילה אופקית עם 500 משימות', await noOverflow(wp));
  check('22 אין שגיאות JS (ביצועים)', wp.__errors.length === 0, wp.__errors);
  console.log('# זמני ציור (ms): ' + JSON.stringify(perf));
  await w.ctx.close();

  await browser.close();
  console.log(fail ? `נכשלו ${fail}` : 'כל הבדיקות עברו'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
