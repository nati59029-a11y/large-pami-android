'use strict';
// מרכז עבודה – סבב 1 (www/tasks-wc.js): "היום שלי", "בוצע היום", "הזכר לעובד" (nd/ndN), תזכורות ודחייה במכשיר, התראות מקומיות (תוסף מדומה),
// סינון וחיפוש, לוח צוות ו"דורש ממני", תבניות מנהל. רשת מדומה עם "ענן" בזיכרון, בלי אמולטור. מסך 360px.
// שימוש: node ui-wc1.js <www-dir> [shots-dir]
const fs = require('fs'); const path = require('path'); const H = require('./harness');
const BZ0 = ['larg', 'peami'].join('');
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
let fail = 0; const check = (n, ok, info) => { if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const S = (v) => ({ stringValue: String(v) }), I = (v) => ({ integerValue: String(v) }), A = (a) => ({ arrayValue: { values: a.map(S) } });
const T0 = H.T0, D1 = 864e5, H1 = 36e5; // T0 = יום ג' 3.11.2026 11:00 שעון ישראל
const DOCS = 'projects/demo-largpeami/databases/(default)/documents/';
const DB = { tasks: {}, ptk: {}, rtk: {}, rq: {}, staff: {} }; const LOG = [];
const docOf = (col, id) => ({ name: DOCS + col + '/' + id, fields: DB[col][id], createTime: '2026-11-03T09:00:00Z', updateTime: '2026-11-03T09:00:00Z' });
const MINE = new Set(['tasks', 'ptk', 'rtk', 'rq']);
async function mockCloud(ctx, who) {
  await ctx.route((u) => new URL(u).port === '8080', async (route) => {
    const req = route.request(), u = new URL(req.url()), m = req.method(), p = decodeURIComponent(u.pathname), body = req.postData() || '';
    const i = p.indexOf('/documents'); if (i < 0) return route.fallback(); const rest = p.slice(i + 10);
    const ok = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    const err = (c, s) => route.fulfill({ status: c, contentType: 'application/json', body: JSON.stringify({ error: { code: c, message: s, status: s } }) });
    if (rest === ':runQuery') {
      let q = {}; try { q = JSON.parse(body).structuredQuery; } catch (e) { /* */ }
      const c = q.from && q.from[0].collectionId; if (!MINE.has(c)) return route.fallback();
      let ids = Object.keys(DB[c]); const w = q.where && q.where.fieldFilter;
      if (w) ids = ids.filter((id) => { const v = DB[c][id][w.field.fieldPath]; const sv = v && v.stringValue; return w.op === 'IN' ? w.value.arrayValue.values.some((x) => x.stringValue === sv) : sv === w.value.stringValue; });
      return ok(ids.length ? ids.map((id) => ({ document: docOf(c, id), readTime: 'x' })) : [{ readTime: 'x' }]);
    }
    if (m === 'GET' && rest.split('?')[0] === '/staff') return ok({ documents: Object.keys(DB.staff).map((id) => docOf('staff', id)) });
    const s = rest.split('?')[0].split('/').filter(Boolean), col = s[0], id = s[1];
    if (!MINE.has(col) || s.length > 2) return route.fallback();
    if (m === 'GET') return id ? (DB[col][id] ? ok(docOf(col, id)) : err(404, 'NOT_FOUND')) : ok({ documents: Object.keys(DB[col]).map((k) => docOf(col, k)) });
    if (m === 'POST') { const nid = u.searchParams.get('documentId'); DB[col][nid] = JSON.parse(body).fields; LOG.push({ who, m, col, id: nid, f: DB[col][nid] }); return ok(docOf(col, nid)); }
    if (m === 'PATCH') { const mask = u.searchParams.getAll('updateMask.fieldPaths'); if (!DB[col][id]) return err(404, 'NOT_FOUND'); const f = JSON.parse(body).fields; const ch = {};
      for (const k of mask) { if (k.includes('.')) continue; DB[col][id][k] = f[k]; ch[k] = f[k]; } LOG.push({ who, m, col, id, f: ch, mask, url: u.search }); return ok(docOf(col, id)); }
    if (m === 'DELETE') { delete DB[col][id]; return ok({}); }
    return route.fallback();
  });
}
const task = (id, o) => { DB.tasks[id] = Object.assign({ owner: S('m'), by: S('m'), role: S('a'), txt: S('משימה ' + id), cr: I(T0 - D1), due: I(T0 + D1), st: S('open'), open: S('1'), pr: S(''), sub: I(0), doneBy: S(''), note: S(''), ok: I(0), late: S(''), to: A(['w1']), toN: A(['עובד א']), ow: S('w1'), owN: S('עובד א'), clt: I(T0 - D1), np: I(0), wp: I(0), mi: I(0) }, o || {}); };
const shot = async (page, dir, name) => { if (!dir) return; fs.mkdirSync(dir, { recursive: true }); await page.waitForTimeout(250); await page.screenshot({ path: path.join(dir, name + '.png'), fullPage: true }); };
const txt = (page, sel) => page.evaluate((s) => (document.querySelector(s) || {}).innerText || '', sel);
const waitFor = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 4000)) { if (await fn()) return true; await sleep(60); } return false; };
const dlgOpen = (page) => page.evaluate(() => { const d = document.getElementById('dlg'); return !!(d && d.open); });
const closeD = async (page) => { if (await dlgOpen(page)) { await page.evaluate(() => closeDlg()); await sleep(150); } };
// תוסף התראות מקומיות מדומה (כמו ב-APK חדש). בלי זה – כמו דפדפן/APK ישן
const LN_MOCK = () => { const pend = []; window.__ln = { pend, req: 0, perm: 'prompt' };
  const P = { checkPermissions: async () => ({ display: window.__ln.perm }), requestPermissions: async () => { window.__ln.req++; window.__ln.perm = 'granted'; return { display: 'granted' }; },
    registerActionTypes: async () => ({}), addListener: async (n, fn) => { window.__ln.fn = fn; return { remove() {} }; },
    getPending: async () => ({ notifications: pend.slice() }), cancel: async (o) => { for (const n of o.notifications) { const i = pend.findIndex((x) => x.id === n.id); if (i >= 0) pend.splice(i, 1); } },
    schedule: async (o) => { for (const n of o.notifications) pend.push(JSON.parse(JSON.stringify(n))); return { notifications: o.notifications.map((n) => ({ id: n.id })) }; } };
  window.Capacitor = { isNativePlatform: () => false, getPlatform: () => 'web', isPluginAvailable: (n) => n === 'LocalNotifications', Plugins: { LocalNotifications: P } }; };

(async () => {
  const [www, shots] = process.argv.slice(2); const browser = await H.launch();
  const cfg = { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: ALL } }, admins: { '|m': 1 }, staff: { '|w1': 1, '|w2': 1 } };
  DB.staff.w1 = { name: S('עובד א'), email: S('w1@x.co'), active: { booleanValue: true } };
  DB.staff.w2 = { name: S('עובד ב'), email: S('w2@x.co'), active: { booleanValue: true } };
  task('t-late', { cr: I(T0 - 8 * D1), txt: S('משימה באיחור') }); // בלי dl: 72 שעות ימי עסקים מ-cr – עבר
  task('t-today', { dl: I(T0 + 3 * H1), txt: S('לסדר מדף היום') });
  task('t-tom', { dl: I(T0 + D1), txt: S('להזמין סחורה מחר') });
  task('t-week', { dl: I(T0 + 3 * D1), txt: S('ספירת מלאי השבוע') });
  task('t-later', { dl: I(T0 + 10 * D1), txt: S('צביעה בהמשך') });
  task('t-nodl', { dl: I(0), txt: S('רעיון בלי תאריך') });
  task('t-nd', { nd: I(T0 - 600e3), ndN: S('m'), txt: S('לנקות את המקרר') });
  task('t-w2', { to: A(['w2']), toN: A(['עובד ב']), ow: S('w2'), owN: S('עובד ב'), txt: S('משימה של עובד ב') });
  task('t-free', { to: A(['w1', 'w2']), toN: A(['עובד א', 'עובד ב']), ow: S(''), owN: S(''), txt: S('פנויה לשניהם') });
  task('t-done', { st: S('done'), open: S(''), sub: I(T0 - H1), ok: I(T0 - H1), doneBy: S('w1'), txt: S('בוצעה הבוקר') });
  DB.ptk.p1 = { owner: S('w1'), by: S('w1'), txt: S('להתקשר לספק'), cr: I(T0 - D1), due: I(T0 + 2 * H1), st: S('open'), sub: I(0), late: S('') };

  // ================= עובד (דפדפן – בלי תוסף התראות) =================
  const w = await H.newPage(browser, www, cfg, [], 'w1'); const wp = w.page; await wp.setViewportSize({ width: 360, height: 740 });
  await mockCloud(w.ctx, 'w1');
  await H.login(wp, 'w1@x.co'); await sleep(1500); await closeD(wp);
  await wp.evaluate(() => tkLoad()); await sleep(300);
  check('1 tkDl: dl>0 → dl; dl==0 → בלי יעד; בלי dl → due (72ש\')', await wp.evaluate(([T0, H1]) => { const g = (id) => tkGet(id); return tkDl(g('t-today')) === T0 + 3 * H1 && tkDl(g('t-nodl')) === Infinity && tkDl(g('t-late')) === g('t-late').due && g('t-late').dl === -1 && tkLateNow(g('t-late')) && !tkLateNow(g('t-nodl')) && !tkIsLate(g('t-nodl')); }, [T0, H1]));
  // תזכורת מהמנהל – חלון בתוך האפליקציה
  await wp.evaluate(() => tkAlert()); await sleep(500);
  const al = await txt(wp, '#dlg');
  check('2 חלון "תזכורת מהמנהל" עם המשימה, שם המנהל והשעה', /תזכורת מהמנהל/.test(al) && /לנקות את המקרר/.test(al) && /m · 10:50/.test(al), al.slice(0, 200));
  await shot(wp, shots, 'w-nd-alert');
  await wp.click('#dlg [data-a=tkwAlGo]'); await sleep(500);
  const my = await txt(wp, '#main');
  check('3 ברירת המחדל לעובד: "היום שלי" פעילה', await wp.evaluate(() => TKT === 'my') && /היום שלי/.test(my));
  const grp = await wp.evaluate(() => { const o = {}, seq = []; let g = ''; for (const el of document.querySelectorAll('#main > *')) { if (el.classList.contains('mh')) { g = el.firstElementChild.innerText.trim(); seq.push(g); continue; } if (g && el.classList.contains('card') && el.tagName === 'DIV') (o[g] = o[g] || []).push(el.querySelector('div').innerText.trim()); } return { o, seq }; });
  check('4 קבוצות לפי יעד בפועל, לפי הסדר: באיחור/היום/מחר/השבוע/בהמשך/בלי תאריך', grp.seq.join('|') === 'באיחור / הגיע הזמן|היום|מחר|השבוע|בהמשך|בלי תאריך', grp.seq);
  const G = grp.o, has = (g, t) => (G[g] || []).includes(t);
  check('5 המשימות בקבוצה הנכונה (כולל פרטית בקבוצת "היום")', has('באיחור / הגיע הזמן', 'משימה באיחור') && has('היום', 'לסדר מדף היום') && has('היום', 'להתקשר לספק') && has('מחר', 'להזמין סחורה מחר') && has('השבוע', 'ספירת מלאי השבוע') && has('בהמשך', 'צביעה בהמשך') && has('בלי תאריך', 'רעיון בלי תאריך'), G);
  check('6 "הזכר לעובד" אחרי "ראיתי" כבר לא בראש (נשמר במכשיר)', !grp.seq.includes('תזכורת מהמנהל') && await wp.evaluate(() => JSON.parse(localStorage.getItem(LK('lp-tk-ndv-w1')))['t-nd'] > 0));
  check('7 משימה של עובד אחר לא ב"היום שלי"; פנויה לשניהם כן', !/משימה של עובד ב/.test(my) && /פנויה לשניהם/.test(my));
  check('8 סימן מקור: "מהמנהל" ו"פרטית"', /מהמנהל/.test(my) && /פרטית/.test(my));
  check('9 פס התקדמות: "בוצעו 0 מתוך N היום" + הערה שאין התראות בדפדפן', /בוצעו 0 מתוך \d+ היום/.test(my) && /אין התראות בטלפון/.test(my), my.slice(0, 160));
  await shot(wp, shots, 'w-my');
  // בוצע → "בוצע היום"
  await wp.click('#tkc-t-today [data-a=tkDone]'); await wp.click('#dlg [data-a=yes]'); await sleep(800);
  const my2 = await txt(wp, '#main');
  check('10 אחרי "בוצע": "בוצעו 1 מתוך" ו"בוצע היום (1)" מקופל', /בוצעו 1 מתוך/.test(my2) && /בוצע היום \(1\)/.test(my2) && await wp.evaluate(() => !document.querySelector('details[open]')), my2.slice(0, 120));
  // דחייה של פרטית
  await wp.click('#ptc-p1 [data-a=tkwSnz]'); await sleep(200);
  check('11 חלון דחייה: עוד שעה / מחר 08:00 / שבוע הבא', /עוד שעה/.test(await txt(wp, '#dlg')) && /מחר ב-08:00/.test(await txt(wp, '#dlg')) && /שבוע הבא/.test(await txt(wp, '#dlg')));
  await wp.click('#dlg [data-v=t]'); await sleep(400);
  const my3 = await txt(wp, '#main'); const snz = await wp.evaluate(() => JSON.parse(localStorage.getItem(LK('lp-snz-w1'))));
  check('12 פרטית שנדחתה עוברת ל"נדחו" עד מחר 08:00 (שעון ישראל), היעד בשרת לא השתנה', /נדחו \(1\)/.test(my3) && snz['p:p1'] === Date.UTC(2026, 10, 4, 6, 0) && DB.ptk.p1.due.integerValue === String(T0 + 2 * H1) && !LOG.some((l) => l.col === 'ptk'), snz);
  // תזכורת חדשה (בלי תוסף)
  await wp.click('[data-a=tkwRNew]'); await sleep(200);
  check('13 טופס תזכורת: "בעוד שעה", תאריך, שעה, חזרה + הערה שאין התראות', /בעוד שעה/.test(await txt(wp, '#dlg')) && /חזרה/.test(await txt(wp, '#dlg')) && /בתוך האפליקציה בלבד/.test(await txt(wp, '#dlg')));
  await wp.fill('#dlg input[name=txt]', 'לקחת קבלה'); await wp.click('#dlg [data-a=tkwRQ][data-v=h]'); await wp.click('#dlg form button.btn.grow'); await sleep(400);
  const rem = await wp.evaluate(() => JSON.parse(localStorage.getItem(LK('lp-rem-w1'))));
  check('14 תזכורת נשמרה במכשיר בעוד שעה ומופיעה בקבוצת "היום" עם סימן "תזכורת"', rem.length === 1 && rem[0].at === T0 + H1 && /לקחת קבלה/.test(await txt(wp, '#main')), rem);
  // תזכורת חוזרת – ימים בשבוע
  await wp.click('[data-a=tkwRNew]'); await sleep(200);
  await wp.fill('#dlg input[name=txt]', 'להוציא זבל'); await wp.fill('#dlg input[name=d]', '2026-11-03'); await wp.fill('#dlg input[name=tm]', '07:00');
  await wp.selectOption('#dlg select[name=rp]', 'w'); await wp.check('#dlg input[name=wd0]'); await wp.check('#dlg input[name=wd3]');
  await wp.click('#dlg form button.btn.grow'); await sleep(400);
  const r2 = (await wp.evaluate(() => JSON.parse(localStorage.getItem(LK('lp-rem-w1'))))).find((r) => r.txt === 'להוציא זבל');
  check('15 תזכורת חוזרת א׳+ד׳ 07:00: המופע הבא = רביעי 4.11 07:00 שעון ישראל', r2 && r2.rp === 'w' && r2.wd.join() === '0,3' && r2.at === Date.UTC(2026, 10, 4, 5, 0), r2);
  await wp.click(`#rmc-${r2.id} [data-a=tkwRDone]`); await sleep(300);
  const r2b = (await wp.evaluate(() => JSON.parse(localStorage.getItem(LK('lp-rem-w1'))))).find((r) => r.txt === 'להוציא זבל');
  check('16 "בוצע" בתזכורת חוזרת מקדם למופע הבא (ראשון 8.11 07:00) ונרשם ב"בוצע היום"', r2b.at === Date.UTC(2026, 10, 8, 5, 0) && /בוצע היום \(2\)/.test(await txt(wp, '#main')), r2b.at);
  // סינון וחיפוש
  await wp.click('[data-a=tkwF][data-v=mgr]'); await sleep(300);
  const f1 = await txt(wp, '#main');
  check('17 צ\'יפ "מהמנהל": רק משימות מנהל (בלי תזכורות)', /משימה באיחור/.test(f1) && !/לקחת קבלה/.test(f1));
  await wp.fill('input[data-i=tkwQ]', 'מקרר'); await sleep(700);
  const f2 = await txt(wp, '#main');
  check('18 חיפוש "מקרר": רק המשימה המתאימה, הפוקוס נשאר בשדה, נשמר במכשיר', /לנקות את המקרר/.test(f2) && !/משימה באיחור/.test(f2) && await wp.evaluate(() => document.activeElement && document.activeElement.dataset.i === 'tkwQ' && JSON.parse(localStorage.getItem(LK('lp-tk-flt'))).q === 'מקרר'));
  await wp.click('[data-a=tkTab][data-v=open]'); await sleep(300);
  const f3 = await txt(wp, '#main');
  check('19 הסינון חל גם בלשונית "פתוחות"', /לנקות את המקרר/.test(f3) && !/לסדר מדף/.test(f3) && !/להזמין סחורה/.test(f3));
  await wp.fill('input[data-i=tkwQ]', ''); await sleep(700); await wp.click('[data-a=tkwF][data-v=""]'); await sleep(300);
  check('20 ניקוי הסינון מחזיר את כל המשימות', /להזמין סחורה מחר/.test(await txt(wp, '#main')));
  check('21 עובד: אין לשונית "צוות" ואין כפתור "הזכר לעובד"', !(await wp.$('[data-a=tkTab][data-v=team]')) && !(await wp.$('[data-a=tkwNd]')));
  const overflow = await wp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check('22 360px: אין גלילה אופקית במסך', !overflow);
  check('23 אין שגיאות JS (עובד)', wp.__errors.length === 0, wp.__errors);
  await w.ctx.close();

  // ================= עובד עם תוסף התראות (APK חדש) =================
  const w2 = await H.newPage(browser, www, cfg, [], 'w1b'); const w2p = w2.page; await w2p.setViewportSize({ width: 360, height: 740 });
  await w2p.addInitScript(LN_MOCK); await mockCloud(w2.ctx, 'w1');
  await H.login(w2p, 'w1@x.co'); await sleep(1500); await closeD(w2p);
  await w2p.evaluate(() => { TKT = 'my'; go('tk'); }); await sleep(500);
  check('24 עם התוסף: אין הערת "אין התראות"', !/אין התראות בטלפון/.test(await txt(w2p, '#main')));
  await w2p.click('[data-a=tkwRNew]'); await sleep(200);
  await w2p.fill('#dlg input[name=txt]', 'להתקשר לרואה חשבון'); await w2p.click('#dlg [data-a=tkwRQ][data-v=t]'); await w2p.click('#dlg form button.btn.grow');
  await waitFor(async () => (await w2p.evaluate(() => window.__ln.pend.length)) > 0, 5000);
  const ln = await w2p.evaluate(() => window.__ln);
  const n1 = ln.pend.find((n) => n.body === 'להתקשר לרואה חשבון');
  check('25 הרשאה מתבקשת בתזכורת הראשונה, והתראה מתוזמנת למחר 08:00 עם allowWhileIdle, ic_stat_notify ופעולת "בעוד שעה"', ln.req === 1 && n1 && new Date(n1.schedule.at).getTime() === Date.UTC(2026, 10, 4, 6, 0) && n1.schedule.allowWhileIdle === true && n1.smallIcon === 'ic_stat_notify' && n1.actionTypeId === 'lpwc' && n1.extra.u === 'w1', n1);
  await closeD(w2p); await w2p.click('[data-a=tkwMorn]'); await sleep(200); await w2p.check('#dlg input[name=on]'); await w2p.fill('#dlg input[name=hm]', '07:15'); await w2p.click('#dlg form button.btn.grow');
  await waitFor(async () => (await w2p.evaluate(() => window.__ln.pend.some((n) => n.id === 7000001))), 5000);
  const mn = await w2p.evaluate(() => window.__ln.pend.find((n) => n.id === 7000001));
  check('26 הודעת בוקר: מחר 07:15 שעון ישראל, "לפי העדכון האחרון"', mn && new Date(mn.schedule.at).getTime() === Date.UTC(2026, 10, 4, 5, 15) && /^לפי העדכון האחרון/.test(mn.body), mn);
  const cntBefore = await w2p.evaluate(() => window.__ln.pend.length);
  await w2p.evaluate(() => window.__ln.fn({ actionId: 'h1', notification: window.__ln.pend.find((n) => n.body === 'להתקשר לרואה חשבון') })); await sleep(1800);
  const after = await w2p.evaluate(() => ({ p: window.__ln.pend, s: JSON.parse(localStorage.getItem(LK('lp-snz-w1'))) }));
  const n2 = after.p.filter((n) => n.body === 'להתקשר לרואה חשבון');
  check('27 "בעוד שעה" מההתראה: נדחה ל-12:00 ומתוזמן מחדש בלי כפילויות', n2.length >= 1 && new Date(n2[0].schedule.at).getTime() === T0 + H1 && after.p.length === cntBefore + 0 && Object.values(after.s).includes(T0 + H1), { n: n2.length, before: cntBefore, after: after.p.length });
  check('28 אין שגיאות JS (עובד עם תוסף)', w2p.__errors.length === 0, w2p.__errors);
  await w2.ctx.close();

  // ================= מנהל =================
  const { ctx, page } = await H.newPage(browser, www, cfg, [], 'm'); await page.setViewportSize({ width: 360, height: 740 });
  await mockCloud(ctx, 'm');
  await H.login(page, 'm@x.co'); if (await page.$('[data-a=startBlank]')) { await page.click('[data-a=startBlank]'); await sleep(300); }
  await sleep(800); await closeD(page);
  await page.evaluate(() => { go('tk'); }); await sleep(400); await page.evaluate(() => tkLoad()); await sleep(600);
  check('29 מנהל: ברירת המחדל נשארת "פתוחות"; יש לשוניות "היום שלי" ו"צוות"', await page.evaluate(() => TKT === 'open') && !!(await page.$('[data-a=tkTab][data-v=my]')) && !!(await page.$('[data-a=tkTab][data-v=team]')));
  await page.click('[data-a=tkTab][data-v=team]'); await sleep(500);
  const tm = await txt(page, '#main');
  check('30 "דורש ממני" + לוח צוות עם שני העובדים', /דורש ממני/.test(tm) && /משימות שממתינות לאישור/.test(tm) && /בקשות חדשות מעובדים/.test(tm) && /עובד א/.test(tm) && /עובד ב/.test(tm), tm.slice(0, 300));
  const wa = await page.evaluate(() => { const c = [...document.querySelectorAll('#main .card')].find((x) => /^עובד א/.test(x.innerText)); return c ? c.innerText.replace(/\s+/g, ' ') : ''; });
  check('31 עובד א: פתוחות 7 (6 שלו + הפנויה), באיחור 1, בוצעו היום 2 (בוצעה הבוקר + לסדר מדף), בזמן 100%', /^עובד א 7 פתוחות 1 באיחור 2 בוצעו היום 100% בזמן/.test(wa), wa);
  await shot(page, shots, 'm-team');
  await page.click('[data-a=tkTab][data-v=open]'); await sleep(300);
  await page.click('#tkc-t-tom [data-a=tkwNd]'); await page.click('#dlg [data-a=yes]'); await sleep(800);
  const nd = LOG.find((l) => l.who === 'm' && l.id === 't-tom' && l.mask && l.mask.includes('nd'));
  check('32 "הזכר לעובד": PATCH עם updateMask nd,ndN בלבד ו-currentDocument.exists', nd && nd.mask.join() === 'nd,ndN' && nd.f.nd.integerValue === String(T0) && nd.f.ndN.stringValue === 'm' && /currentDocument.exists=true/.test(nd.url), nd);
  check('33 בכרטיס של המנהל: "נשלחה תזכורת · 11:00"', /נשלחה תזכורת · 11:00/.test(await txt(page, '#tkc-t-tom')));
  const n0 = LOG.length; await page.click('#tkc-t-tom [data-a=tkwNd]'); await sleep(300);
  check('34 שוב תוך 30 דקות: לא נשלח (הודעה בלבד)', LOG.length === n0 && !(await dlgOpen(page)));
  check('35 אין "הזכר לעובד" במשימה ישנה בלי נמענים / שבוצעה', !(await page.$('#tkc-t-done [data-a=tkwNd]')));
  // תבניות
  await page.fill('form[data-f=tkAdd] textarea', 'לבדוק תוקף מוצרי חלב');
  await page.click('form[data-f=tkAdd] [data-a=tkSel][data-v="*"]'); await page.click('form[data-f=tkAdd] [data-a=tkSel][data-v=w2]'); await page.click('form[data-f=tkAdd] [data-a=tkNp][data-v="1"]');
  await page.click('form[data-f=tkAdd] summary'); await page.click('[data-a=tkwTplSave]'); await sleep(300);
  const tpl = await page.evaluate(() => JSON.parse(localStorage.getItem(LK('lp-tk-tpl'))));
  check('36 שמירת תבנית: טקסט, נמען עובד ב, 1 תמונה (במכשיר)', tpl.length === 1 && tpl[0].txt === 'לבדוק תוקף מוצרי חלב' && tpl[0].to.join() === 'w2' && tpl[0].np === 1, tpl);
  await page.fill('form[data-f=tkAdd] textarea', ''); await page.evaluate(() => { TKN.sel = null; TKN.np = 0; tkRe(); }); await sleep(200);
  await page.click('form[data-f=tkAdd] summary'); await page.click('[data-a=tkwTplFill]'); await sleep(300);
  const filled = await page.evaluate(() => ({ t: document.querySelector('form[data-f=tkAdd] textarea').value, sel: [...tkSelInit()], np: TKN.np, sentN: 0 }));
  check('37 "מלא טופס" ממלא טקסט, נמענים ותמונות בלי לשלוח', filled.t === 'לבדוק תוקף מוצרי חלב' && filled.sel.join() === 'w2' && filled.np === 1 && !LOG.some((l) => l.m === 'POST' && l.col === 'tasks'), filled);
  await page.click('form[data-f=tkAdd] summary').catch(() => {}); await sleep(100);
  if (!(await page.isVisible('[data-a=tkwTplSend]'))) await page.click('form[data-f=tkAdd] summary');
  await page.click('[data-a=tkwTplSend]'); await sleep(150);
  check('38 "שלח מתבנית" מבקש אישור קצר עם שם העובד', /לשלוח את המשימה "לבדוק תוקף מוצרי חלב" לעובד ב/.test(await txt(page, '#dlg')));
  await page.click('#dlg [data-a=yes]'); await waitFor(async () => LOG.some((l) => l.m === 'POST' && l.col === 'tasks'), 4000);
  const sent = LOG.find((l) => l.m === 'POST' && l.col === 'tasks');
  check('39 נשלחה משימה רגילה דרך FRM.tkAdd: נמען w2, np=1', sent && sent.f.txt.stringValue === 'לבדוק תוקף מוצרי חלב' && sent.f.to.arrayValue.values.map((x) => x.stringValue).join() === 'w2' && sent.f.np.integerValue === '1', sent && Object.keys(sent.f));
  await page.click('[data-a=tkTab][data-v=my]'); await sleep(300);
  check('40 "היום שלי" של מנהל עובד (בלי משימות אישיות)', /אין משימות להיום|בוצעו/.test(await txt(page, '#main')));
  check('41 360px: אין גלילה אופקית (מנהל)', !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
  check('42 אין שגיאות JS (מנהל)', page.__errors.length === 0, page.__errors);
  await shot(page, shots, 'm-my');

  // ================= עסק בלי התוספת "משימות": אין לשוניות חדשות =================
  const cfg2 = JSON.parse(JSON.stringify(cfg)); cfg2.biz[BZ0].features = Object.assign({}, ALL, { tasks: false }); // עסק ברירת המחדל: bzF תמיד true – בודקים את TKW ישירות
  void cfg2;
  check('43 TKW מחזיר ריק כש-bzF(tasks) כבוי', await (async () => { const x = await H.newPage(browser, www, cfg, [], 'm2'); await mockCloud(x.ctx, 'm'); await H.login(x.page, 'm@x.co'); const r = await x.page.evaluate(() => { const o = bzF; bzF = () => false; try { return TKW.tabs(true, [], []).length === 0 && TKW.view('my', () => '') === '' && TKW.fbar('open') === '' && TKW.tplBar() === ''; } finally { bzF = o; } }); await x.ctx.close(); return r; })());

  await browser.close();
  console.log(fail ? `נכשלו ${fail} בדיקות` : 'כל הבדיקות עברו'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
