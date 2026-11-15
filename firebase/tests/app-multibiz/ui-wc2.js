'use strict';
// מרכז עבודה – סבב 2 (www/tasks-wc.js + index.html): גלאי rv/tk2 (כללים ישנים / חדשים), יעד גמיש, עדיפות, משך, נושא, רשימת סימון,
// "התחלתי" (sa), פס צבע ו"2/5" בכרטיס, סינון דחוף/נושא, תבניות עם השדות החדשים, איחור לפי tkDl ב"בוצע" ובאישור, הגנת 403,
// טופס מקופל ב"היום שלי", "סמן כנקרא" קטן, ויציאה מהחשבון שמבטלת התראות ומוחקת מפתחות. רשת מדומה ("ענן" בזיכרון), מסך 360px.
// שימוש: node ui-wc2.js <www-dir> [shots-dir]
const fs = require('fs'); const path = require('path'); const H = require('./harness');
const BZ0 = ['larg', 'peami'].join('');
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
let fail = 0; const check = (n, ok, info) => { if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const S = (v) => ({ stringValue: String(v) }), I = (v) => ({ integerValue: String(v) }), A = (a) => ({ arrayValue: { values: a.map(S) } }), IA = (a) => ({ arrayValue: { values: a.map(I) } });
const T0 = H.T0, D1 = 864e5, H1 = 36e5; // T0 = יום ג' 3.11.2026 11:00 שעון ישראל
const DOCS = 'projects/demo-largpeami/databases/(default)/documents/';
let DB, LOG, RV; // RV: 'old' (403) / 'new' (404); NEWF403: יצירה עם שדות חדשים נדחית (כללים ישנים אחרי שהגלאי אמר "חדשים")
let NEWF403 = false;
const reset = () => { DB = { tasks: {}, ptk: {}, rtk: {}, rq: {}, staff: {} }; LOG = []; };
const docOf = (col, id) => ({ name: DOCS + col + '/' + id, fields: DB[col][id], createTime: '2026-11-03T09:00:00Z', updateTime: '2026-11-03T09:00:00Z' });
const MINE = new Set(['tasks', 'ptk', 'rtk', 'rq']);
const NEWK = ['dl', 'pri', 'cat', 'est', 'ck', 'ckd', 'sa'];
async function mockCloud(ctx, who) {
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
    const s = rest.split('?')[0].split('/').filter(Boolean), col = s[0], id = s[1];
    if (!MINE.has(col) || s.length > 2) return route.fallback();
    if (m === 'GET') return id ? (DB[col][id] ? ok(docOf(col, id)) : err(404, 'NOT_FOUND')) : ok({ documents: Object.keys(DB[col]).map((k) => docOf(col, k)) });
    if (m === 'POST') { const nid = u.searchParams.get('documentId'); const f = JSON.parse(body).fields;
      if ((RV === 'old' || NEWF403) && Object.keys(f).some((k) => NEWK.includes(k))) { LOG.push({ who, m, col, id: nid, f, st: 403 }); return err(403, 'PERMISSION_DENIED'); }
      DB[col][nid] = f; LOG.push({ who, m, col, id: nid, f }); return ok(docOf(col, nid)); }
    if (m === 'PATCH') { const mask = u.searchParams.getAll('updateMask.fieldPaths'); if (!DB[col][id]) return err(404, 'NOT_FOUND'); const f = JSON.parse(body).fields; const ch = {};
      for (const k of mask) { if (k.includes('.')) continue; DB[col][id][k] = f[k]; ch[k] = f[k]; } LOG.push({ who, m, col, id, f: ch, mask, url: u.search }); return ok(docOf(col, id)); }
    if (m === 'DELETE') { delete DB[col][id]; return ok({}); }
    return route.fallback();
  });
}
const task = (id, o) => { DB.tasks[id] = Object.assign({ owner: S('m'), by: S('m'), role: S('a'), txt: S('משימה ' + id), cr: I(T0 - D1), due: I(T0 + D1), st: S('open'), open: S('1'), pr: S(''), sub: I(0), doneBy: S(''), note: S(''), ok: I(0), late: S(''), to: A(['w1']), toN: A(['עובד א']), ow: S('w1'), owN: S('עובד א'), clt: I(T0 - D1), np: I(0), wp: I(0), mi: I(0) }, o || {}); };
const seed = () => {
  reset();
  DB.staff.w1 = { name: S('עובד א'), email: S('w1@x.co'), active: { booleanValue: true } };
  DB.staff.w2 = { name: S('עובד ב'), email: S('w2@x.co'), active: { booleanValue: true } };
  task('t-ck', { txt: S('ספירת מלאי'), dl: I(T0 + 3 * H1), pri: S('h'), cat: S('מלאי'), est: I(30), ck: A(['מדף 1', 'מדף 2', 'מדף 3', 'מקרר', 'מחסן']), ckd: IA([0, 1]) });
  task('t-low', { txt: S('לסדר ארון'), pri: S('l'), cat: S('ניקיון'), dl: I(T0 + 2 * D1) });
  task('t-dlpast', { txt: S('יעד שעבר'), dl: I(T0 - H1) });               // due בעתיד, יעד בפועל עבר
  task('t-dl0', { txt: S('בלי יעד'), dl: I(0), due: I(T0 - H1) });        // due עבר, בלי יעד
  task('t-old', { txt: S('ישנה בלי השדות') });
  task('t-new', { txt: S('משימה חדשה שלא נקראה'), rd: { mapValue: { fields: {} } } });
  task('t-sa', { txt: S('בעבודה כבר'), sa: I(T0 - 30 * 60000) });
  task('t-wait', { txt: S('ממתינה לאישור'), st: S('wait'), sub: I(T0 - H1), doneBy: S('w1'), dl: I(T0 - 2 * H1), due: I(T0 + D1) });
  DB.ptk.p1 = { owner: S('w1'), by: S('w1'), txt: S('פרטית עם רשימה'), cr: I(T0 - D1), due: I(T0 + 2 * D1), st: S('open'), sub: I(0), late: S(''), dl: I(T0 + 5 * H1), pri: S('h'), ck: A(['א', 'ב']), ckd: IA([]) };
};
const shot = async (page, dir, name) => { if (!dir) return; fs.mkdirSync(dir, { recursive: true }); await page.waitForTimeout(250); await page.screenshot({ path: path.join(dir, name + '.png'), fullPage: true }); };
const txt = (page, sel) => page.evaluate((s) => (document.querySelector(s) || {}).innerText || '', sel);
const waitFor = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 4000)) { if (await fn()) return true; await sleep(60); } return false; };
const dlgOpen = (page) => page.evaluate(() => { const d = document.getElementById('dlg'); return !!(d && d.open); });
const closeD = async (page) => { if (await dlgOpen(page)) { await page.evaluate(() => closeDlg()); await sleep(150); } };
const LN_MOCK = () => { const pend = []; window.__ln = { pend, req: 0, perm: 'granted', canceled: [] };
  const P = { checkPermissions: async () => ({ display: window.__ln.perm }), requestPermissions: async () => ({ display: 'granted' }),
    registerActionTypes: async () => ({}), addListener: async (n, fn) => { window.__ln.fn = fn; return { remove() {} }; },
    getPending: async () => ({ notifications: pend.slice() }), cancel: async (o) => { for (const n of o.notifications) { window.__ln.canceled.push(n.id); const i = pend.findIndex((x) => x.id === n.id); if (i >= 0) pend.splice(i, 1); } },
    schedule: async (o) => { for (const n of o.notifications) pend.push(JSON.parse(JSON.stringify(n))); return { notifications: o.notifications.map((n) => ({ id: n.id })) }; } };
  window.Capacitor = { isNativePlatform: () => false, getPlatform: () => 'web', isPluginAvailable: (n) => n === 'LocalNotifications', Plugins: { LocalNotifications: P } }; };
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

(async () => {
  const [www, shots] = process.argv.slice(2); const browser = await H.launch();
  const cfg = { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: ALL } }, admins: { '|m': 1 }, staff: { '|w1': 1, '|w2': 1 } };
  const open = async (label, email, ln) => { const x = await H.newPage(browser, www, cfg, [], label); await x.page.setViewportSize({ width: 360, height: 740 }); if (ln) await x.page.addInitScript(LN_MOCK);
    await mockCloud(x.ctx, email.split('@')[0]); await H.login(x.page, email); if (await x.page.$('[data-a=startBlank]')) { await x.page.click('[data-a=startBlank]'); await sleep(300); }
    await sleep(1200); await closeD(x.page); return x; };

  // ================= כללים ישנים (rv → 403): הכול מוסתר =================
  seed(); RV = 'old'; NEWF403 = false;
  let w = await open('w-old', 'w1@x.co'); let wp = w.page;
  await wp.evaluate(() => { TKW.d0 = 1; TKT = 'open'; go('tk'); }); await sleep(800); await wp.evaluate(() => tkLoad()); await sleep(500);
  check('1 כללים ישנים: הגלאי שמר v=0 במכשיר (לכל עסק)', await wp.evaluate(() => { const c = JSON.parse(localStorage.getItem(LK('lp-tk-rv'))); return c && c.v === 0 && !TKW.rv(); }));
  let main = await txt(wp, '#main');
  check('2 כללים ישנים: אין צ\'יפי יעד/עדיפות בטופס, יש "יופעל אחרי עדכון השרת" והסבר 72 השעות', !(await wp.$('[data-a=tkwDk]')) && !(await wp.$('[data-a=tkwPri]')) && /יופעל אחרי עדכון השרת/.test(main) && /3 ימי עסקים/.test(main));
  check('3 כללים ישנים: אין "התחלתי" ואין סימון פריטים (רק תצוגה)', !(await wp.$('[data-a=tkwSa]')) && !(await wp.$('[data-a=tkwCk]')) && /2\/5/.test(main));
  await wp.fill('form[data-f=tkAdd] textarea', 'משימה בכללים ישנים'); await wp.click('form[data-f=tkAdd] button.btn.w');
  await waitFor(async () => LOG.some((l) => l.m === 'POST' && l.col === 'tasks'));
  const po = LOG.find((l) => l.m === 'POST' && l.col === 'tasks');
  check('4 כללים ישנים: יצירה בפורמט הישן בלבד (בלי dl/pri/cat/est/ck)', po && !po.st && !Object.keys(po.f).some((k) => NEWK.includes(k)) && po.f.due.integerValue > 0, po && Object.keys(po.f));
  check('5 אין שגיאות JS (כללים ישנים)', wp.__errors.length === 0, wp.__errors);
  await w.ctx.close();

  // ================= כללים חדשים – עובד =================
  seed(); RV = 'new';
  w = await open('w-new', 'w1@x.co', true); wp = w.page;
  await wp.evaluate(() => { TKT = 'my'; go('tk'); }); await sleep(900); await wp.evaluate(() => tkLoad()); await sleep(600);
  check('6 כללים חדשים: v=1 נשמר במכשיר', await wp.evaluate(() => JSON.parse(localStorage.getItem(LK('lp-tk-rv'))).v === 1 && TKW.rv()));
  check('7 "היום שלי": הטופס מקופל לכפתור "+ משימה חדשה"', await wp.evaluate(() => !!document.querySelector('[data-a=tkwFold]') && document.querySelector('form[data-f=tkAdd]').hidden));
  main = await txt(wp, '#main');
  check('8 כרטיס: פס צבע דחוף, תגיות דחוף/נושא/משך/"2/5"', await wp.evaluate(() => /border-inline-start: 5px solid var\(--bad\)/.test(document.getElementById('tkc-t-ck').getAttribute('style').replace(/:(\S)/g, ': $1'))) && /דחוף/.test(await txt(wp, '#tkc-t-ck')) && /מלאי/.test(await txt(wp, '#tkc-t-ck')) && /30 דק׳/.test(await txt(wp, '#tkc-t-ck')) && /☑ 2\/5/.test(await txt(wp, '#tkc-t-ck')));
  check('9 משימה נמוכה: פס אפור', await wp.evaluate(() => /var\(--mut\)/.test(document.getElementById('tkc-t-low').getAttribute('style'))));
  check('10 "סמן כנקרא" הוא צ\'יפ קטן בשורת התגיות, לא כפתור בשורת הפעולות', await wp.evaluate(() => { const c = document.getElementById('tkc-t-new'); const b = c && c.querySelector('[data-a=tkRead]'); return !!b && b.classList.contains('chip') && !b.closest('.row'); }));
  check('11 "בעבודה" אצל העובד עצמו: "התחלתי ב-10:30"', /התחלתי ב-10:30/.test(await txt(wp, '#tkc-t-sa')));
  await shot(wp, shots, 'w-my-new-rules');
  // רשימת סימון
  await wp.click('#tkc-t-ck summary[data-a=tkwCkTog]'); await sleep(150);
  await wp.click('#tkc-t-ck [data-a=tkwCk][data-n="3"]'); await waitFor(async () => LOG.some((l) => l.id === 't-ck' && l.mask && l.mask.join() === 'ckd'));
  const ckp = LOG.find((l) => l.id === 't-ck' && l.mask && l.mask.join() === 'ckd');
  check('12 סימון פריט: PATCH עם updateMask ckd בלבד, מערך מספרים [0,1,3]', ckp && ckp.f.ckd.arrayValue.values.map((v) => v.integerValue).join() === '0,1,3', ckp);
  await sleep(300);
  check('13 אחרי הסימון: "3/5" והרשימה נשארת פתוחה', /☑ 3\/5/.test(await txt(wp, '#tkc-t-ck')) && await wp.evaluate(() => document.querySelector('#tkc-t-ck details').open));
  // "התחלתי"
  await wp.click('#tkc-t-ck [data-a=tkwSa]'); await waitFor(async () => LOG.some((l) => l.id === 't-ck' && l.mask && l.mask.join() === 'sa'));
  const sap = LOG.find((l) => l.id === 't-ck' && l.mask && l.mask.join() === 'sa');
  check('14 "התחלתי": PATCH sa בלבד = עכשיו', sap && sap.f.sa.integerValue === String(T0), sap);
  await sleep(500);
  check('15 אחרי "התחלתי": התגית מופיעה והכפתור נעלם', /התחלתי ב-11:00/.test(await txt(wp, '#tkc-t-ck')) && !(await wp.$('#tkc-t-ck [data-a=tkwSa]')));
  // "בוצע" עם רשימה חלקית – אזהרה בלבד
  await wp.click('#tkc-t-ck [data-a=tkDone]'); await sleep(200);
  check('16 "בוצע" ברשימה חלקית: אזהרה "סומנו 3 מתוך 5" (לא חוסם)', /סומנו 3 מתוך 5/.test(await txt(wp, '#dlg')));
  await wp.click('#dlg [data-a=yes]'); await waitFor(async () => DB.tasks['t-ck'].st.stringValue === 'done');
  check('17 בוצע לפני היעד: late ""', DB.tasks['t-ck'].late.stringValue === '');
  // איחור לפי tkDl
  await wp.click('[data-a=tkTab][data-v=open]'); await sleep(300);
  await wp.click('#tkc-t-dlpast [data-a=tkDone]'); await wp.click('#dlg [data-a=yes]'); await waitFor(async () => DB.tasks['t-dlpast'].st.stringValue === 'done');
  await wp.click('#tkc-t-dl0 [data-a=tkDone]'); await wp.click('#dlg [data-a=yes]'); await waitFor(async () => DB.tasks['t-dl0'].st.stringValue === 'done');
  check('18 "בוצע": late לפי היעד בפועל – dl שעבר → "1"; dl=0 (גם כש-due עבר) → ""', DB.tasks['t-dlpast'].late.stringValue === '1' && DB.tasks['t-dl0'].late.stringValue === '', [DB.tasks['t-dlpast'].late, DB.tasks['t-dl0'].late]);
  // פרטית: סימון פריט (docPatch) ותגית יעד
  check('19 פרטית: תגית "יעד: היום 16:00", דחוף, 0/2', /יעד: היום 16:00/.test(await txt(wp, '#ptc-p1')) && /☑ 0\/2/.test(await txt(wp, '#ptc-p1')));
  await wp.click('#ptc-p1 summary[data-a=tkwCkTog]'); await sleep(100); await wp.click('#ptc-p1 [data-a=tkwCk][data-n="1"]');
  await waitFor(async () => LOG.some((l) => l.col === 'ptk' && l.mask && l.mask.join() === 'ckd'));
  check('20 פרטית: סימון פריט → PATCH ptk ckd [1]', (DB.ptk.p1.ckd.arrayValue.values || []).map((v) => v.integerValue).join() === '1');
  // סינון דחוף ונושא
  await wp.click('[data-a=tkwF][data-v=urg]'); await sleep(300); main = await txt(wp, '#main');
  check('21 צ\'יפ "דחוף": רק משימות דחופות', /פרטית עם רשימה/.test(main) && !/לסדר ארון/.test(main) && !/ישנה בלי השדות/.test(main));
  await wp.click('[data-a=tkwF][data-v=""]'); await sleep(200);
  await wp.selectOption('select[data-c=tkwT]', 'ניקיון'); await sleep(300); main = await txt(wp, '#main');
  check('22 סינון נושא "ניקיון": רק המתאימה, נשמר במכשיר', /לסדר ארון/.test(main) && !/ישנה בלי השדות/.test(main) && await wp.evaluate(() => JSON.parse(localStorage.getItem(LK('lp-tk-flt'))).t === 'ניקיון'));
  await wp.selectOption('select[data-c=tkwT]', ''); await sleep(200);
  // טופס חדש עם השדות
  await wp.click('[data-a=tkTab][data-v=my]'); await sleep(300); await wp.click('[data-a=tkwFold]'); await sleep(300);
  check('23 אחרי פתיחה: צ\'יפי יעד (היום 23:59 / מחר / תאריך ושעה / 3 ימי עסקים / בלי יעד), "3 ימי עסקים" ברירת מחדל', await wp.evaluate(() => [...document.querySelectorAll('[data-a=tkwDk]')].map((b) => b.innerText.trim()).join('|') === 'היום 23:59|מחר|תאריך ושעה|3 ימי עסקים|בלי יעד' && document.querySelector('[data-a=tkwDk].on').dataset.v === 'd3'));
  await wp.fill('form[data-f=tkAdd] textarea', 'לבדוק תוקף');
  await wp.click('[data-a=tkwDk][data-v=td]'); await wp.click('[data-a=tkwPri][data-v=h]'); await wp.click('[data-a=tkwMore]'); await sleep(150);
  await wp.click('[data-a=tkwEst][data-v="60"]'); await wp.fill('input[data-i=tkwCat]', 'מלאי');
  await wp.click('[data-a=tkwCkAdd]'); await wp.fill('input[data-i=tkwCkI][data-n="0"]', 'חלב'); await wp.click('[data-a=tkwCkAdd]'); await wp.fill('input[data-i=tkwCkI][data-n="1"]', 'גבינות');
  await wp.evaluate(() => tkRe()); await sleep(150);
  check('24 רענון באמצע לא מוחק טקסט ושדות (מצב בזיכרון)', await wp.evaluate(() => document.querySelector('form[data-f=tkAdd] textarea').value === 'לבדוק תוקף' && document.querySelector('input[data-i=tkwCat]').value === 'מלאי' && document.querySelector('input[data-i=tkwCkI][data-n="1"]').value === 'גבינות'));
  check('25 360px: אין גלילה אופקית עם הטופס הפתוח', await noOverflow(wp));
  await shot(wp, shots, 'w-form-new-rules');
  const n0 = LOG.filter((l) => l.m === 'POST').length;
  await wp.click('form[data-f=tkAdd] button.btn.w'); await waitFor(async () => LOG.filter((l) => l.m === 'POST').length > n0);
  const pn = LOG.filter((l) => l.m === 'POST' && l.col === 'tasks').pop();
  check('26 יצירה: dl = היום 23:59 שעון ישראל, pri h, cat, est 60, ck 2, ckd ריק, due עדיין 72 ש\'', pn && pn.f.dl.integerValue === String(Date.UTC(2026, 10, 3, 21, 59)) && pn.f.pri.stringValue === 'h' && pn.f.cat.stringValue === 'מלאי' && pn.f.est.integerValue === '60' && pn.f.ck.arrayValue.values.map((v) => v.stringValue).join() === 'חלב,גבינות' && !(pn.f.ckd.arrayValue.values || []).length && +pn.f.due.integerValue > T0 + 3 * D1 - 1 && !('sa' in pn.f), pn && pn.f);
  await sleep(400);
  // סבב 3: יצירה מתוך "היום שלי" – נשארים ב"היום שלי" (הטופס מתקפל שוב); משאר הלשוניות – עוברים ל"פתוחות" כמו קודם
  check('27 אחרי שליחה מ"היום שלי": נשארים ב"היום שלי", הטופס מקופל', await wp.evaluate(() => TKT === 'my' && document.querySelector('form[data-f=tkAdd]').hidden && !!document.querySelector('[data-a=tkwFold]')));
  await wp.click('[data-a=tkwFold]'); await sleep(200);
  check('27א השדות החדשים התאפסו', await wp.evaluate(() => document.querySelector('[data-a=tkwDk].on').dataset.v === 'd3' && !document.querySelector('[data-a=tkwPri].on[data-v=h]') && document.querySelector('form[data-f=tkAdd] textarea').value === ''));
  // פרטית עם "בלי יעד"
  await wp.fill('form[data-f=tkAdd] textarea', 'פרטית בלי יעד'); await wp.check('form[data-f=tkAdd] input[name=prv]');
  await wp.click('[data-a=tkwDk][data-v=none]'); await wp.click('form[data-f=tkAdd] button.btn.w');
  await waitFor(async () => Object.values(DB.ptk).some((x) => x.txt.stringValue === 'פרטית בלי יעד'));
  const pp = Object.values(DB.ptk).find((x) => x.txt.stringValue === 'פרטית בלי יעד');
  check('28 משימה פרטית: dl=0 ("בלי יעד")', pp && pp.dl.integerValue === '0', pp);
  // תאריך+שעה שעבר – נחסם בטופס
  await sleep(800); check('28א גם אחרי פרטית מ"היום שלי" – נשארים ב"היום שלי"', await wp.evaluate(() => TKT === 'my')); await wp.click('[data-a=tkwFold]'); await sleep(200); await wp.fill('form[data-f=tkAdd] textarea', 'יעד שעבר');
  await wp.click('[data-a=tkwDk][data-v=at]'); await sleep(100); await wp.fill('input[data-i=tkwD]', '2026-11-02'); await wp.fill('input[data-i=tkwTm]', '09:00');
  const n1 = LOG.filter((l) => l.m === 'POST').length; await wp.click('form[data-f=tkAdd] button.btn.w'); await sleep(400);
  check('29 תאריך+שעה שעבר: לא נשלח (הודעה)', LOG.filter((l) => l.m === 'POST').length === n1);
  await wp.fill('input[data-i=tkwD]', '2026-11-05'); await wp.fill('input[data-i=tkwTm]', '14:30'); await wp.click('form[data-f=tkAdd] button.btn.w');
  await waitFor(async () => LOG.filter((l) => l.m === 'POST').length > n1);
  const pa = LOG.filter((l) => l.m === 'POST' && l.col === 'tasks').pop();
  check('30 תאריך+שעה: dl = 5.11 14:30 שעון ישראל', pa && pa.f.dl.integerValue === String(Date.UTC(2026, 10, 5, 12, 30)), pa && pa.f.dl);
  // רענון: הגלאי נבדק שוב
  const rv0 = LOG.filter((l) => l.col === 'rv').length; await wp.click('[data-a=tkRefresh]'); await sleep(600);
  check('31 "רענן" בודק שוב את הגלאי (גם בתוך 6 השעות)', LOG.filter((l) => l.col === 'rv').length === rv0 + 1);
  check('32 אין שגיאות JS (עובד, כללים חדשים)', wp.__errors.length === 0, wp.__errors);
  // יציאה מהחשבון: ביטול התראות ומחיקת מפתחות
  await wp.evaluate(() => { localStorage.setItem(LK('lp-rem-w1'), JSON.stringify([{ id: 'r1', txt: 'x', at: Date.now() + 864e5, rp: '', nid: 7 }])); localStorage.setItem(LK('lp-snz-w1'), '{"p:p1":1}'); localStorage.setItem(LK('lp-tk-tpl'), '[{"txt":"t"}]'); localStorage.setItem(LK('lp-tk-mn-w1'), '{"on":true,"hm":"07:30"}'); TKW.sched(); });
  await waitFor(async () => (await wp.evaluate(() => window.__ln.pend.length)) > 0, 5000);
  const pend0 = await wp.evaluate(() => window.__ln.pend.length);
  await wp.evaluate(() => syOut()); await sleep(500);
  const out = await wp.evaluate(() => ({ p: window.__ln.pend.length, k: ['lp-rem-w1', 'lp-snz-w1', 'lp-tk-dt-w1', 'lp-tk-ndv-w1', 'lp-tk-mn-w1', 'lp-ln-ids-w1', 'lp-tk-flt', 'lp-tk-tpl', 'lp-tk-rv'].filter((k) => localStorage.getItem(LK(k)) !== null), sy: !SY.uid }));
  check('33 יציאה מהחשבון: ההתראות המקומיות בוטלו, מפתחות התזכורות/דחיות/תבניות/סינון נמחקו, syOut השלים (SY ריק)', pend0 > 0 && out.p === 0 && out.k.length === 0 && out.sy, { pend0, out });
  check('34 אין שגיאות JS אחרי היציאה', wp.__errors.length === 0, wp.__errors);
  await w.ctx.close();

  // ================= הגנת 403: הגלאי אמר "חדשים" אבל השרת דוחה =================
  seed(); RV = 'new'; NEWF403 = true;
  w = await open('w-403', 'w1@x.co'); wp = w.page;
  await wp.evaluate(() => { TKW.d0 = 1; TKT = 'open'; go('tk'); }); await sleep(800); await wp.evaluate(() => tkLoad()); await sleep(400);
  await wp.fill('form[data-f=tkAdd] textarea', 'רק עדיפות'); await wp.click('[data-a=tkwPri][data-v=h]'); await wp.click('form[data-f=tkAdd] button.btn.w');
  await waitFor(async () => LOG.some((l) => l.m === 'POST' && l.col === 'tasks' && !l.st));
  const ps = LOG.filter((l) => l.m === 'POST' && l.col === 'tasks');
  check('35 403 עם שדות חדשים בלי יעד שונה: נשלח שוב בפורמט הישן, והמכשיר מסומן "ישן"', ps.length === 2 && ps[0].st === 403 && !ps[1].st && !('pri' in ps[1].f) && await wp.evaluate(() => !TKW.rv()), ps.map((x) => [x.st, Object.keys(x.f).length]));
  // יעד שונה: לא שולחים שוב
  await wp.evaluate(() => localStorage.setItem(LK('lp-tk-rv'), JSON.stringify({ v: 1, t: Date.now() }))); await wp.evaluate(() => tkRe()); await sleep(200);
  await wp.fill('form[data-f=tkAdd] textarea', 'עם יעד מחר'); await wp.click('[data-a=tkwDk][data-v=tm]'); const n2 = LOG.filter((l) => l.m === 'POST').length;
  await wp.click('form[data-f=tkAdd] button.btn.w'); await sleep(900);
  const ps2 = LOG.filter((l) => l.m === 'POST').slice(n2);
  check('36 403 עם יעד שונה מ-72 ש\': לא נשלח שוב, הטקסט נשאר בטופס, והשדות החדשים מוסתרים', ps2.length === 1 && ps2[0].st === 403 && await wp.evaluate(() => document.querySelector('form[data-f=tkAdd] textarea').value === 'עם יעד מחר' && !document.querySelector('[data-a=tkwDk]')), ps2.map((x) => x.st));
  check('37 אין שגיאות JS (403)', wp.__errors.length === 0, wp.__errors);
  await w.ctx.close();

  // ================= מנהל – כללים חדשים =================
  seed(); RV = 'new'; NEWF403 = false;
  const mm = await open('m-new', 'm@x.co'); const page = mm.page;
  await page.evaluate(() => { go('tk'); }); await sleep(400); await page.evaluate(() => tkLoad()); await sleep(600);
  check('38 מנהל: "בעבודה אצל עובד א מ-10:30" בכרטיס', /בעבודה אצל עובד א מ-10:30/.test(await txt(page, '#tkc-t-sa')));
  await page.click('[data-a=tkTab][data-v=team]'); await sleep(500);
  const wa = await page.evaluate(() => { const c = [...document.querySelectorAll('#main .card')].find((x) => /^עובד א/.test(x.innerText)); return c ? c.innerText.replace(/\s+/g, ' ') : ''; });
  check('39 לוח צוות: מונה "בעבודה" 1 לעובד א', /1 בעבודה/.test(wa), wa);
  await page.click('[data-a=tkTab][data-v=open]'); await sleep(300);
  await page.click('#tkc-t-sa [data-a=tkUnclaim]'); await page.click('#dlg [data-a=yes]');
  await waitFor(async () => LOG.some((l) => l.id === 't-sa' && l.mask && l.mask.includes('ow')));
  const un = LOG.find((l) => l.id === 't-sa' && l.mask && l.mask.includes('ow'));
  check('40 ביטול תפיסה מאפס גם sa', un && un.mask.includes('sa') && un.f.sa.integerValue === '0', un && un.mask);
  // אישור משימה שממתינה: late לפי tkDl
  await page.click('[data-a=tkTab][data-v=wait]'); await sleep(300);
  await page.click('#tkc-t-wait [data-a=tkOk]'); await waitFor(async () => DB.tasks['t-wait'].st.stringValue === 'done');
  check('41 אישור מנהל: late לפי היעד בפועל (sub אחרי dl → "1", למרות ש-due בעתיד)', DB.tasks['t-wait'].late.stringValue === '1');
  // תבניות עם השדות החדשים
  await page.click('[data-a=tkTab][data-v=open]'); await sleep(300);
  await page.fill('form[data-f=tkAdd] textarea', 'לנקות מקרר'); await page.click('[data-a=tkwDk][data-v=tm]'); await page.click('[data-a=tkwPri][data-v=h]');
  await page.click('[data-a=tkwMore]'); await sleep(100); await page.fill('input[data-i=tkwCat]', 'ניקיון'); await page.click('[data-a=tkwCkAdd]'); await page.fill('input[data-i=tkwCkI][data-n="0"]', 'מדפים');
  await page.click('form[data-f=tkAdd] summary'); await page.click('[data-a=tkwTplSave]'); await sleep(300);
  const tpl = await page.evaluate(() => JSON.parse(localStorage.getItem(LK('lp-tk-tpl'))));
  check('42 תבנית שומרת גם יעד (מחר), עדיפות, נושא ורשימה', tpl[0].dk === 'tm' && tpl[0].pri === 'h' && tpl[0].cat === 'ניקיון' && tpl[0].ck.join() === 'מדפים', tpl[0]);
  await page.fill('form[data-f=tkAdd] textarea', ''); await page.evaluate(() => { tkRe(); }); await page.click('[data-a=tkwPri][data-v=""]'); await page.click('[data-a=tkwDk][data-v=d3]'); await sleep(100);
  if (!(await page.isVisible('[data-a=tkwTplFill]'))) await page.click('form[data-f=tkAdd] summary');
  await page.click('[data-a=tkwTplFill]'); await sleep(300);
  check('43 "מלא טופס" משחזר יעד, עדיפות, נושא ורשימה', await page.evaluate(() => document.querySelector('[data-a=tkwDk].on').dataset.v === 'tm' && document.querySelector('[data-a=tkwPri].on').dataset.v === 'h' && document.querySelector('input[data-i=tkwCat]').value === 'ניקיון' && document.querySelector('input[data-i=tkwCkI]').value === 'מדפים'));
  check('44 360px: אין גלילה אופקית (מנהל)', await noOverflow(page));
  check('45 אין שגיאות JS (מנהל)', page.__errors.length === 0, page.__errors);
  await mm.ctx.close();

  await browser.close();
  console.log(fail ? `נכשלו ${fail} בדיקות` : 'כל הבדיקות עברו'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
