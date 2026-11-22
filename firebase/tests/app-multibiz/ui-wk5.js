'use strict';
// תצוגת עובד "היום שלי" (סבב 5): תגיות סטטוס אחידות, יעד קריא, הערת מנהל, "הבאות בתור" (עד 3) וקישור "כל המשימות". שימוש: node ui-wk5.js <www-dir> [shots-dir]
const fs = require('fs'); const path = require('path'); const H = require('./harness');
const BZ0 = ['larg', 'peami'].join('');
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
let fail = 0; const check = (n, ok, info) => { if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const S = (v) => ({ stringValue: String(v) }), I = (v) => ({ integerValue: String(v) }), A = (a) => ({ arrayValue: { values: a.map(S) } });
const T0 = H.T0, D1 = 864e5, H1 = 36e5;
const DOCS = 'projects/demo-largpeami/databases/(default)/documents/';
const IMG = 'data:image/jpeg;base64,' + 'QUJD'.repeat(120);
let DB, LOG, K403 = false, HOLD = null;
const reset = () => { DB = { tasks: {}, ptk: {}, rtk: {}, rq: {}, staff: {}, tkt: {} }; LOG = []; };
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
    const s = rest.split('?')[0].split('/').filter(Boolean);
    // תבניות בענן (tkt) ותמונת הדוגמה (tkt/{id}/p/1); K403 = שרת ישן
    if (s[0] === 'tkt') {
      if (K403) { LOG.push({ who, m, col: 'tkt', st: 403 }); return err(403, 'PERMISSION_DENIED'); }
      if (s.length === 1) { if (m === 'GET') { LOG.push({ who, m, col: 'tkt', list: 1 }); return ok({ documents: Object.keys(DB.tkt).map((k) => docOf('tkt', k)) }); }
        if (m === 'POST') { const nid = u.searchParams.get('documentId'); DB.tkt[nid] = JSON.parse(body).fields; LOG.push({ who, m, col: 'tkt', id: nid, f: DB.tkt[nid] }); return ok(docOf('tkt', nid)); } }
      if (s.length === 2) { const id = s[1];
        if (m === 'GET') return DB.tkt[id] ? ok(docOf('tkt', id)) : err(404, 'NOT_FOUND');
        if (m === 'DELETE') { delete DB.tkt[id]; LOG.push({ who, m, col: 'tkt', id, del: 1 }); return ok({}); }
        if (m === 'PATCH') { if (!DB.tkt[id]) return err(404, 'NOT_FOUND'); const f = JSON.parse(body).fields; const mask = u.searchParams.getAll('updateMask.fieldPaths'); for (const k of mask) DB.tkt[id][k] = f[k]; LOG.push({ who, m, col: 'tkt', id, mask, f }); return ok(docOf('tkt', id)); } }
      if (s.length === 4 && s[2] === 'p') { const col = 'tkt/' + s[1] + '/p'; DB[col] = DB[col] || {};
        if (m === 'GET') return DB[col][s[3]] ? ok(docOf(col, s[3])) : err(404, 'NOT_FOUND');
        if (m === 'PATCH') { if (DB[col][s[3]]) return err(403, 'PERMISSION_DENIED'); DB[col][s[3]] = JSON.parse(body).fields; LOG.push({ who, m, col, id: s[3], f: DB[col][s[3]] }); return ok(docOf(col, s[3])); }
        if (m === 'DELETE') { delete DB[col][s[3]]; LOG.push({ who, m, col, id: s[3], del: 1 }); return ok({}); } }
      return route.fallback();
    }
    // תמונות משימה (tasks/{id}/p)
    if (s[0] === 'tasks' && s[2] === 'p' && s.length === 3 && m === 'GET') { if (HOLD && s[1] === 'a3') await HOLD; const col = 'tasks/' + s[1] + '/p'; DB[col] = DB[col] || {}; return ok({ documents: Object.keys(DB[col]).map((k) => docOf(col, k)) }); }
    const col = s[0], id = s[1];
    if (!MINE.has(col) || s.length > 2) return route.fallback();
    if (m === 'GET') return id ? (DB[col][id] ? ok(docOf(col, id)) : err(404, 'NOT_FOUND')) : ok({ documents: Object.keys(DB[col]).map((k) => docOf(col, k)) });
    if (m === 'POST') { const nid = u.searchParams.get('documentId'); DB[col][nid] = JSON.parse(body).fields; LOG.push({ who, m, col, id: nid, f: DB[col][nid] }); return ok(docOf(col, nid)); }
    if (m === 'PATCH') { const mask = u.searchParams.getAll('updateMask.fieldPaths'); if (!DB[col][id]) return err(404, 'NOT_FOUND'); const f = JSON.parse(body).fields; const ch = {};
      for (const k of mask) { if (k.includes('.')) continue; DB[col][id][k] = f[k]; ch[k] = f[k]; } LOG.push({ who, m, col, id, f: ch, mask }); return ok(docOf(col, id)); }
    return route.fallback();
  });
}
const task = (id, o) => { DB.tasks[id] = Object.assign({ owner: S('m'), by: S('m'), role: S('a'), txt: S('משימה ' + id), cr: I(T0 - D1), due: I(T0 + D1), st: S('open'), open: S('1'), pr: S(''), sub: I(0), doneBy: S(''), note: S(''), ok: I(0), late: S(''), to: A(['w1']), toN: A(['עובד א']), ow: S('w1'), owN: S('עובד א'), clt: I(T0 - D1), np: I(0), wp: I(0), mi: I(0) }, o || {}); };
const shot = async (page, dir, name) => { if (!dir) return; fs.mkdirSync(dir, { recursive: true }); await page.waitForTimeout(250); await page.screenshot({ path: path.join(dir, name + '.png'), fullPage: false }); };
const txt = (page, sel) => page.evaluate((s) => (document.querySelector(s) || {}).innerText || '', sel);
const waitFor = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 4000)) { if (await fn()) return true; await sleep(60); } return false; };
const dlgOpen = (page) => page.evaluate(() => { const d = document.getElementById('dlg'); return !!(d && d.open); });
const dtxt = (page) => page.evaluate(() => (document.getElementById('dlg') || {}).innerText || '');
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const yes = async (page) => { await waitFor(() => dlgOpen(page)); await page.click('#dlg [data-a=yes]'); await sleep(300); };

(async () => {
  const [www, shots] = process.argv.slice(2); const browser = await H.launch();
  const cfg = { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: ALL } }, admins: { '|m': 1 }, staff: { '|w1': 1, '|w2': 1 } };
  const open = async (label, email) => { const x = await H.newPage(browser, www, cfg, [], label); await x.page.setViewportSize({ width: 360, height: 740 });
    await mockCloud(x.ctx, email.split('@')[0]); await H.login(x.page, email); if (await x.page.$('[data-a=startBlank]')) { await x.page.click('[data-a=startBlank]'); await sleep(300); }
    await sleep(1200); if (await dlgOpen(x.page)) { await x.page.evaluate(() => closeDlg()); await sleep(150); } return x; };
  reset(); DB.staff.w1 = { name: S('עובד א'), email: S('w1@x.co'), active: { booleanValue: true } };
  task('t1', { txt: S('לסדר את המדף'), due: I(T0 - 2 * D1), dl: I(T0 - 2 * D1), note: S('לא מסודר עד הסוף'), rt: S('1') });
  task('t2', { txt: S('לנקות את הדלפק'), pri: S('h'), due: I(T0 + 2 * H1), dl: I(T0 + 2 * H1) });
  task('t3', { txt: S('להזמין סחורה'), due: I(T0 + 2 * D1), dl: I(T0 + 2 * D1) });
  task('t4', { txt: S('לספור קופה'), due: I(T0 + 3 * D1), dl: I(T0 + 3 * D1) });
  task('t5', { txt: S('משימה חמישית'), due: I(T0 + 4 * D1), dl: I(T0 + 4 * D1) });
  const w = await open('w-wk5', 'w1@x.co'); const wp = w.page;
  await wp.evaluate(() => { go('tk'); }); await sleep(1100);
  const main = await txt(wp, '#main');
  check('1 משימה נוכחית: באיחור, יעד קריא "באיחור 2 ימים", תגית tk-late', /לסדר את המדף/.test(await txt(wp, '#main [id^=tkc-]')) && /באיחור 2 ימים/.test(await txt(wp, '#main [id^=tkc-]')) && !!(await wp.$('#main [id^=tkc-] .tag.tk-late')));
  check('2 הערת המנהל מוצגת (note שהוחזרה)', /לא מסודר עד הסוף/.test(main));
  const q = await wp.evaluate(() => [...document.querySelectorAll('#main [data-a=tkwPick]')].map((b) => b.innerText.replace(/\s+/g, ' ').trim()));
  check('3 "הבאות בתור": 3 שורות בלבד (הרביעית לא מוצגת)', q.length === 3 && /לנקות את הדלפק/.test(q[0]) && /דחוף/.test(q[0]) && !/משימה חמישית/.test(main), q);
  const lnk = await wp.evaluate(() => { const b = document.querySelector('#main [data-a=tkwAll]'); return b ? { t: b.innerText, h: b.getBoundingClientRect().height } : null; });
  check('4 "כל המשימות (5)" נשאר כקישור משני בגובה 44+', lnk && /כל המשימות \(5\)/.test(lnk.t) && lnk.h >= 43, lnk);
  const order = await wp.evaluate(() => { const m = document.querySelector('#main'), a = m.querySelector('[id^=tkc-]'), b = m.querySelector('[data-a=tkwPick]'), c = m.querySelector('[data-a=tkwAll]'); const f = (x, y) => !!(x.compareDocumentPosition(y) & 4); return f(a, b) && f(b, c) && !!a.querySelector('.btn.w,label.btn'); });
  check('5 סדר: משימה נוכחית (עם כפתור ראשי) ← הבאות בתור ← כל המשימות', order);
  await shot(wp, shots, 'worker-tasks-360');
  await wp.click('[data-a=tkwPick]'); await sleep(500);
  const cur = await txt(wp, '#main [id^=tkc-]');
  check('6 לחיצה על שורה הופכת אותה למשימה הנוכחית', /לנקות את הדלפק/.test(cur) && !!(await wp.$('#main [id^=tkc-] .tag.tk-urg')), cur.slice(0, 80));
  check('7 אין שגיאות JS', wp.__errors.length === 0, wp.__errors);
  check('8 360px: אין גלילה אופקית', await noOverflow(wp), await wp.evaluate(() => [...document.querySelectorAll('#main *:not(.chips *)')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1 || e.getBoundingClientRect().left < -1).slice(0, 4).map((e) => (e.parentElement.dataset.a||e.parentElement.className) + ':' + e.getBoundingClientRect().left + ',' + e.getBoundingClientRect().right)));
  await browser.close();
  console.log(fail ? `נכשלו ${fail}` : 'כל הבדיקות עברו'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
