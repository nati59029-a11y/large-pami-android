'use strict';
// סבב 3, חבילה ב': קבוצות התכתבות (www/groups.js). רשת מדומה, בלי אמולטור.
// רשימה ומונה, פס "לא נקרא", שליחה (by נכון), קבוצה עם ao לעובד, השתקה, הגדרות מנהל, מחיקת הודעה (מנהל בלבד), 403 ← "יופעלו בקרוב".
// שימוש: node ui-grp.js <www-dir> [shots-dir]
const fs = require('fs'); const path = require('path'); const H = require('./harness');
const BZ0 = ['larg', 'peami'].join('');
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders', 'groups'].map((k) => [k, true]));
let fail = 0; const check = (n, ok, info) => { if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const S = (v) => ({ stringValue: String(v) }), I = (v) => ({ integerValue: String(v) }), B = (v) => ({ booleanValue: !!v }), A = (a) => ({ arrayValue: { values: a.map(S) } });
const T0 = H.T0, D1 = 864e5, H1 = 36e5, MIN = 6e4;
const DOCS = 'projects/demo-largpeami/databases/(default)/documents/';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
let DB, LOG, G403, VID404, PIN403;
const reset = () => { DB = { grp: {}, m: {}, r: {}, p: {}, staff: {} }; LOG = []; G403 = false; VID404 = false; PIN403 = false; };
const grp = (id, o) => { DB.grp[id] = Object.assign({ name: S('קבוצה'), mem: A(['w1', 'w2']), ao: B(false), md: B(true), by: S('m'), t: I(T0 - 9 * D1) }, o); DB.m[id] = DB.m[id] || {}; };
const msg = (g, id, o) => { DB.m[g][id] = Object.assign({ by: S('m'), byN: S('המנהל'), t: I(T0 - H1), k: S('t'), txt: S('הודעה ' + id) }, o); };
const seed = () => {
  reset();
  DB.staff.w1 = { name: S('עובד א'), email: S('w1@x.co'), active: B(true) }; DB.staff.w2 = { name: S('עובד ב'), email: S('w2@x.co'), active: B(true) };
  grp('g1', { name: S('כל הצוות'), last: { mapValue: { fields: { txt: S(''), byN: S('המנהל'), t: I(T0 - 30 * MIN), k: S('img') } } } });
  msg('g1', 'm0', { t: I(T0 - 6 * H1), k: S('vid'), vp: S('grpv/g1/m0'), vs: I(24), vb: I(1000), txt: S('') });
  msg('g1', 'm1', { t: I(T0 - 5 * H1), txt: S('בוקר טוב') });
  msg('g1', 'm2', { t: I(T0 - 4 * H1), by: S('w1'), byN: S('w1'), txt: S('הגעתי') });
  msg('g1', 'm3', { t: I(T0 - 2 * H1), txt: S('הגיעו הצבעים') });
  msg('g1', 'm4', { t: I(T0 - H1), by: S('w2'), byN: S('w2'), txt: S('מצוין') });
  msg('g1', 'm5', { t: I(T0 - 30 * MIN), k: S('img'), txt: S('ככה סידרתי') }); DB.p['g1/m5'] = { img: S(PNG), t: I(T0 - 30 * MIN), uid: S('m') };
  DB.r['g1/w1'] = { t: I(T0 - 3 * H1) };
  grp('g2', { name: S('הודעות מהמנהל'), mem: A(['w1']), ao: B(true), last: { mapValue: { fields: { txt: S('מחר פתיחה ב-8'), byN: S('המנהל'), t: I(T0 - D1), k: S('t') } } } });
  msg('g2', 'n1', { t: I(T0 - D1), txt: S('מחר פתיחה ב-8') });
  grp('g3', { name: S('סניף אחר'), mem: A(['w2']) });
  grp('g4', { name: S('וידאו ישן'), mem: A(['w1']), last: { mapValue: { fields: { txt: S(''), byN: S('המנהל'), t: I(T0 - 100 * D1), k: S('vid') } } } });
  msg('g4', 'v1', { t: I(T0 - 100 * D1), k: S('vid'), vp: S('grpv/g4/v1'), vs: I(30), vb: I(1000), txt: S('') }); DB.r['g4/w1'] = { t: I(T0) };
};
const docOf = (name, f) => ({ name: DOCS + name, fields: f, createTime: '2026-11-03T09:00:00Z', updateTime: '2026-11-03T09:00:00Z' });
async function mockCloud(ctx, who) {
  await ctx.route((u) => new URL(u).port === '9199', async (route) => { const u = new URL(route.request().url()); LOG.push({ who, st: 1, m: route.request().method(), url: u.pathname });
    if (route.request().method() === 'GET') return VID404 ? route.fulfill({ status: 404, body: '{}' }) : route.fulfill({ status: 200, contentType: 'video/mp4', body: Buffer.from('xx') });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); });
  await ctx.route((u) => new URL(u).port === '8080', async (route) => {
    const req = route.request(), u = new URL(req.url()), m = req.method(), p = decodeURIComponent(u.pathname), body = req.postData() || '';
    const i = p.indexOf('/documents'); if (i < 0) return route.fallback(); const rest = p.slice(i + 10);
    const ok = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    const err = (c, s) => route.fulfill({ status: c, contentType: 'application/json', body: JSON.stringify({ error: { code: c, message: s, status: s } }) });
    const R = rest.split('?')[0];
    if (m === 'GET' && R === '/staff') return ok({ documents: Object.keys(DB.staff).map((id) => docOf('staff/' + id, DB.staff[id])) });
    let rootQ = false; if (R === ':runQuery') { try { rootQ = JSON.parse(body).structuredQuery.from[0].collectionId === 'grp'; } catch (e) { /* */ } }
    if (!/^\/grp/.test(R) && !rootQ) return route.fallback();
    LOG.push({ who, m, R, body: body ? JSON.parse(body) : null, q: u.search });
    if (G403) return err(403, 'PERMISSION_DENIED');
    const rq = R.match(/^(?:\/grp(?:\/([^/:]+))?)?:runQuery$/);
    if (rq) { const sq = JSON.parse(body).structuredQuery, c = sq.from[0].collectionId, w = sq.where && sq.where.fieldFilter; let rows;
      if (c === 'grp') rows = Object.keys(DB.grp).filter((id) => !w || DB.grp[id].mem.arrayValue.values.some((x) => x.stringValue === w.value.stringValue)).map((id) => docOf('grp/' + id, DB.grp[id]));
      else { rows = Object.keys(DB.m[rq[1]] || {}).map((id) => docOf('grp/' + rq[1] + '/m/' + id, DB.m[rq[1]][id]));
        if (w) { const v = +w.value.integerValue; rows = rows.filter((d) => w.op === 'GREATER_THAN' ? +d.fields.t.integerValue > v : +d.fields.t.integerValue < v); }
        if (sq.orderBy) { const dsc = sq.orderBy[0].direction === 'DESCENDING'; rows.sort((a, b) => (+a.fields.t.integerValue - +b.fields.t.integerValue) * (dsc ? -1 : 1)); }
        rows = rows.slice(0, sq.limit || 100); }
      return ok(rows.length ? rows.map((d) => ({ document: d, readTime: 'x' })) : [{ readTime: 'x' }]); }
    const s = R.split('/').filter(Boolean);
    if (s.length === 1) { if (m === 'GET') return ok({ documents: Object.keys(DB.grp).map((id) => docOf('grp/' + id, DB.grp[id])) });
      if (m === 'POST') { const id = u.searchParams.get('documentId'); DB.grp[id] = JSON.parse(body).fields; DB.m[id] = {}; return ok(docOf('grp/' + id, DB.grp[id])); } }
    const g = s[1];
    if (s.length === 2) { if (m === 'DELETE') { delete DB.grp[g]; return ok({}); }
      if (m === 'GET') return DB.grp[g] ? ok(docOf('grp/' + g, DB.grp[g])) : err(404, 'NOT_FOUND');
      if (m === 'PATCH') { if (PIN403) return err(403, 'PERMISSION_DENIED'); const f = JSON.parse(body).fields; for (const k of u.searchParams.getAll('updateMask.fieldPaths')) { if (f[k]) DB.grp[g][k] = f[k]; else delete DB.grp[g][k]; } return ok(docOf('grp/' + g, DB.grp[g])); } }
    if (s[2] === 'r' && s.length === 4) { const k = g + '/' + s[3]; if (m === 'GET') return DB.r[k] ? ok(docOf('grp/' + k.replace('/', '/r/'), DB.r[k])) : err(404, 'NOT_FOUND');
      if (m === 'PATCH') { const f = JSON.parse(body).fields; DB.r[k] = DB.r[k] || {}; for (const q of u.searchParams.getAll('updateMask.fieldPaths')) DB.r[k][q] = f[q]; return ok({}); } }
    if (s[2] === 'm' && s.length === 4) { if (m === 'DELETE') { delete DB.m[g][s[3]]; return ok({}); } }
    if (s[2] === 'm' && s.length === 3 && m === 'POST') { DB.m[g][u.searchParams.get('documentId')] = JSON.parse(body).fields; return ok({}); }
    if (s[2] === 'm' && s[4] === 'p') { const k = g + '/' + s[3]; if (m === 'GET') return DB.p[k] ? ok(docOf('grp/' + k + '/p/1', DB.p[k])) : err(404, 'NOT_FOUND');
      if (m === 'PATCH') { DB.p[k] = JSON.parse(body).fields; return ok({}); } if (m === 'DELETE') { delete DB.p[k]; return ok({}); } }
    return err(404, 'NOT_FOUND');
  });
}
const shot = async (page, dir, name) => { if (!dir) return; fs.mkdirSync(dir, { recursive: true }); await page.waitForTimeout(300); await page.screenshot({ path: path.join(dir, name + '.png'), fullPage: false }); };
const waitFor = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 4000)) { if (await fn()) return true; await sleep(60); } return false; };
const closeD = async (page) => { if (await page.evaluate(() => { const d = document.getElementById('dlg'); return !!(d && d.open); })) { await page.evaluate(() => closeDlg()); await sleep(150); } };
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const toasts = (page) => page.evaluate(() => [...document.querySelectorAll('.toast')].map((x) => x.innerText).join('|'));
const sent = (re) => LOG.filter((l) => l.m === 'POST' && re.test(l.R));

(async () => {
  const [www, shots] = process.argv.slice(2); const browser = await H.launch();
  const cfg = { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: ALL } }, admins: { '|m': 1 }, staff: { '|w1': 1, '|w2': 1 } };
  const open = async (label, email) => { const x = await H.newPage(browser, www, cfg, [], label); await x.page.setViewportSize({ width: 412, height: 900 });
    await mockCloud(x.ctx, email.split('@')[0]); await H.login(x.page, email); if (await x.page.$('[data-a=startBlank]')) { await x.page.click('[data-a=startBlank]'); await sleep(300); }
    await sleep(1200); await closeD(x.page); return x; };

  // ================= עובד =================
  seed(); let w = await open('w-grp', 'w1@x.co'); let wp = w.page;
  await waitFor(() => wp.evaluate(() => !!document.querySelector('.wbar [data-w=gr]') && getComputedStyle(document.querySelector('.wbar [data-w=gr] .bdg')).display !== 'none'), 6000);
  let bar = await wp.evaluate(() => [...document.querySelectorAll('.wbar button')].map((b) => ({ t: b.innerText.replace(/\d+\+?/g, '').trim(), bd: (b.querySelector('.bdg') || {}).innerText || '', h: b.querySelector('.bdg') ? b.querySelector('.bdg').hidden : null })));
  check('1 סרגל העובד: בית · משימות · קבוצות · בקשות · עוד', bar.map((b) => b.t).join('|') === 'בית|משימות|קבוצות|בקשות|עוד', bar);
  check('1א מונה "קבוצות" בסרגל = 3 (g1) + 1 (g2); g4 נקרא, g3 לא שלו', bar[2].bd === '4' && bar[2].h === false, bar[2]);
  await wp.click('.wbar [data-w=gr]'); await waitFor(() => wp.evaluate(() => document.querySelectorAll('.gr-row').length >= 2)); await sleep(300);
  const rows = await wp.evaluate(() => [...document.querySelectorAll('.gr-row')].map((r) => ({ n: r.querySelector('b').innerText, c: (r.querySelector('.gr-cnt') || {}).innerText || '', av: r.querySelector('.gr-av').innerText, l: r.querySelector('.t span').innerText })));
  check('2 רשימה: 3 קבוצות של העובד (לא g3), אות בעיגול, הודעה אחרונה, מונה (3 / 1 / בלי)', rows.length === 3 && rows.find((r) => r.n === 'כל הצוות').c === '3' && rows.find((r) => r.n === 'כל הצוות').av === 'כ' && /המנהל: 📷 תמונה/.test(rows.find((r) => r.n === 'כל הצוות').l) && rows.find((r) => r.n === 'הודעות מהמנהל').c === '1' && rows.find((r) => r.n === 'וידאו ישן').c === '', rows);
  check('2א לעובד אין "קבוצה חדשה"', !(await wp.evaluate(() => /קבוצה חדשה/.test(document.getElementById('main').innerText))));
  check('2ב שאילתת העובד מסוננת לפי mem (לא קוראת את כל האוסף)', LOG.some((l) => l.who === 'w1' && l.R === ':runQuery' && l.body.structuredQuery.where && l.body.structuredQuery.where.fieldFilter.op === 'ARRAY_CONTAINS') && !LOG.some((l) => l.m === 'GET' && l.R === '/grp'));
  check('2ג המונה נספר בשאילתה מוגבלת (limit) ולא נטענת ההיסטוריה', LOG.filter((l) => /\/grp\/g\d:runQuery/.test(l.R)).every((l) => l.body.structuredQuery.limit <= 100));
  await shot(wp, shots, 'r3-ב-רשימה');
  await wp.click('.gr-row[data-id=g1]'); await waitFor(() => wp.evaluate(() => !!document.getElementById('grunr'))); await sleep(600);
  const ch = await wp.evaluate(() => { const u = document.getElementById('grunr'), r = u && u.getBoundingClientRect(); return { unr: u && u.innerText.trim(), top: r && Math.round(r.top), mine: [...document.querySelectorAll('.gr-b.me')].map((x) => x.innerText.slice(0, 8)), n: document.querySelectorAll('.gr-b').length, who: [...document.querySelectorAll('.gr-b:not(.me) .who')].map((x) => x.innerText).join(), dsep: document.querySelectorAll('.gr-dsep').length, bar: getComputedStyle(document.querySelector('.wbar')).display, vh: innerHeight }; });
  check('3 מסך קבוצה: פס "3 הודעות שלא נקראו" והמסך נפתח עליו (הפס בתוך החלון)', /^3 הודעות שלא נקראו/.test(ch.unr) && ch.top >= 0 && ch.top < ch.vh, ch);
  check('3א בועות: שלי (me) אחת, של אחרים עם שם שולח, מפרידי תאריך, אין סרגל תחתון', ch.mine.length === 1 && /המנהל/.test(ch.who) && ch.dsep >= 1 && ch.n === 6 && ch.bar === 'none', ch);
  check('3ב התמונה נטענה כתמונה ממוזערת (img), סרטון עם ▶ ומשך 0:24', await wp.evaluate(() => !!document.querySelector('.gr-pic img') && /▶/.test(document.querySelector('[data-a=grVid]').innerText) && /0:24/.test(document.querySelector('[data-a=grVid]').innerText)));
  await shot(wp, shots, 'r3-ב-צ׳אט-לא-נקרא');
  // 23.11 (וי): הרשימה כותבת קודם d,u,n ("התקבל"); הכניסה כותבת t (ועמו d,u,n) – מחפשים את הכתיבה עם t
  const rd = LOG.find((l) => l.m === 'PATCH' && /\/grp\/g1\/r\/w1/.test(l.R) && l.body.fields.t);
  check('4 כניסה עדכנה r/w1: t להודעה האחרונה + d,u,n (נקרא/התקבל) בבקשה אחת, בלי לגעת ב-mu', rd && rd.body.fields.t.integerValue === String(T0 - 30 * MIN) && !!rd.body.fields.d && !!rd.body.fields.u && !!rd.body.fields.n && !rd.body.fields.mu && /updateMask.fieldPaths=t(&|$)/.test(rd.q) && !/fieldPaths=mu/.test(rd.q), rd && rd.body);
  await wp.click('[data-a=grVid]'); await waitFor(() => wp.evaluate(() => !!document.querySelector('#viewer video')));
  check('4א לחיצה על סרטון: <video> מתוך Storage (הורדה עם הרשאה)', await wp.evaluate(() => !!document.querySelector('#viewer video[src^=blob]')) && LOG.some((l) => l.st && l.m === 'GET' && /grpv/.test(l.url)));
  await wp.evaluate(() => ACT.grVidX());
  await wp.click('.gr-pic img'); await sleep(500);
  check('4ב לחיצה על תמונה פותחת אותה בגדול', await wp.evaluate(() => !!document.querySelector('#viewer .vimg img')));
  await wp.evaluate(() => vwClose());
  // שליחה
  await wp.fill('#grtx', 'תודה רבה'); LOG.length = 0; await wp.click('[data-a=grSend]'); await waitFor(async () => sent(/\/grp\/g1\/m$/).length >= 1);
  const P = sent(/\/grp\/g1\/m$/)[0], f = P && P.body.fields;
  check('5 שליחה: by = uid של העובד, byN, k=t, txt, t; בלי שדות אחרים', f && f.by.stringValue === 'w1' && f.byN.stringValue === 'w1' && f.k.stringValue === 't' && f.txt.stringValue === 'תודה רבה' && +f.t.integerValue > 0 && Object.keys(f).sort().join() === 'by,byN,k,t,txt', f && Object.keys(f));
  await sleep(300); check('5א ההודעה מופיעה כבועה שלי והשורה נוקתה', await wp.evaluate(() => document.querySelectorAll('.gr-b.me').length === 2 && document.getElementById('grtx').value === ''));
  // תמונה (8d29a58: בחירת הקובץ עברה לחלון "צירוף" שנפתח מכפתור 📎)
  LOG.length = 0; await wp.click('[data-a=grAtt]'); await sleep(200); await wp.setInputFiles('#dlg input[data-c=grFile]', { name: 'a.png', mimeType: 'image/png', buffer: Buffer.from(PNG.split(',')[1], 'base64') });
  await waitFor(async () => LOG.some((l) => l.m === 'PATCH' && /\/m\/[^/]+\/p\/1$/.test(l.R)), 6000);
  const pm = sent(/\/grp\/g1\/m$/)[0], pp = LOG.find((l) => l.m === 'PATCH' && /\/p\/1$/.test(l.R));
  check('5ב שליחת תמונה: הודעה k=img ואז p/1 עם img, t, uid', pm && pm.body.fields.k.stringValue === 'img' && pp && /^data:image\//.test(pp.body.fields.img.stringValue) && pp.body.fields.uid.stringValue === 'w1' && pp.R.includes('/m/' + (Object.keys(DB.m.g1).find((k) => DB.m.g1[k].k.stringValue === 'img' && k !== 'm5')) + '/'), pp && Object.keys(pp.body.fields));
  // סרטון גדול
  await wp.evaluate(() => { window.__T = []; new MutationObserver((l) => l.forEach((r) => r.addedNodes.forEach((n) => n.classList && n.classList.contains('toast') && window.__T.push(n.innerText)))).observe(document.body, { childList: true }); });
  LOG.length = 0; await wp.click('[data-a=grAtt]'); await sleep(200); await wp.setInputFiles('#dlg input[data-c=grFile]', { name: 'big.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(31 * 1024 * 1024) }); await waitFor(() => wp.evaluate(() => window.__T.some((x) => /30MB/.test(x))), 5000);
  check('5ג סרטון מעל 30MB: הודעה ברורה, בלי העלאה ובלי הודעה', (await wp.evaluate(() => window.__T)).some((x) => /30MB/.test(x)) && !LOG.some((l) => l.st || (l.m === 'POST' && !/:runQuery$/.test(l.R))), await wp.evaluate(() => window.__T));
  LOG.length = 0; await wp.click('[data-a=grAtt]'); await sleep(200); await wp.setInputFiles('#dlg input[data-c=grFile]', { name: 'x.mov', mimeType: 'video/quicktime', buffer: Buffer.alloc(100) }); await sleep(500);
  // 25.11.2026: נכשל לסירוגין ב-CI בלבד. "שליחה" = העלאה ל-Storage או POST (לא הורדה של תמונה/סרטון קיימים שמוצגים שוב); ה-toast נבדק גם מהרישום (__T); פירוט בכשל
  const s5d = LOG.filter((l) => (l.st && l.m !== 'GET') || (l.m === 'POST' && !/:runQuery$/.test(l.R))).map((l) => l.m + ' ' + (l.R || l.url));
  check('5ד פורמט לא נתמך: הודעה ובלי שליחה', /פורמט/.test((await wp.evaluate(() => window.__T.join('|'))) + '|' + (await toasts(wp))) && !s5d.length, { sent: s5d, all: LOG.map((l) => l.m + ' ' + (l.R || l.url)) });
  // השתקה בוטלה (docs/tasks/2026-11-23-read-presence-actlog.md): אין בקרת השתקה, והאפליקציה לא כותבת mu=true לעולם
  check('6 השתקה בוטלה: אין תיבת "השתק התראות" בקבוצה, ואף כתיבה ל-r/w1 לא מגדירה mu=true', await wp.evaluate(() => !document.querySelector('input[data-c=grMute]') && !/השתק התראות/.test(document.getElementById('main').innerText)) && !LOG.some((l) => l.m === 'PATCH' && /\/r\/w1$/.test(l.R) && l.body && l.body.fields.mu && l.body.fields.mu.booleanValue === true) && !(DB.r['g1/w1'].mu && DB.r['g1/w1'].mu.booleanValue === true));
  check('6א לעובד אין כפתור הגדרות/הצמדה בקבוצה (תפריט ⋯ לכל הודעה – לכולם מ-#150, מחיקה/הצמדה רק למנהל)', await wp.evaluate(() => !document.querySelector('[data-a=grPin]') && !document.querySelector('[data-a=grSet]')));
  await wp.evaluate(() => goBack()); await sleep(400); await wp.click('.gr-row[data-id=g2]'); await sleep(900);
  const ao = await wp.evaluate(() => ({ lock: (document.querySelector('.gr-lock') || {}).innerText || '', ta: !!document.getElementById('grtx'), clip: !!document.querySelector('#main [data-a=grAtt]'), /* 8d29a58: כפתור 📎 במקום שדה קובץ במסך (תוכן חלון ישן נשאר ב-#dlg גם כשהוא סגור) */ mute: !!document.querySelector('input[data-c=grMute]') }));
  check('7 קבוצה עם ao לעובד: פס "רק המנהל יכול לשלוח", בלי שורת כתיבה, בלי השתקה', /רק המנהל יכול לשלוח הודעות בקבוצה הזו/.test(ao.lock) && !ao.ta && !ao.clip && !ao.mute, ao);
  await shot(wp, shots, 'r3-ב-רק-מנהל-שולח');
  await wp.evaluate(() => goBack()); await sleep(400); await wp.click('.gr-row[data-id=g4]'); await sleep(900);
  check('8 סרטון ישן (מעל 90 יום): "הסרטון נמחק אחרי 90 יום", בלי נגן', await wp.evaluate(() => /הסרטון נמחק אחרי 90 יום/.test(document.getElementById('main').innerText) && !document.querySelector('[data-a=grVid]')));
  check('9 אין שגיאות JS (עובד)', wp.__errors.length === 0, wp.__errors);
  await w.ctx.close();

  // ================= עובד: שרת ישן (403) =================
  seed(); G403 = true; w = await open('w-grp403', 'w1@x.co'); wp = w.page;
  await wp.evaluate(() => tab('gr')); await waitFor(() => wp.evaluate(() => /יופעלו בקרוב/.test(document.getElementById('main').innerText)));
  check('10 403 ברשימה: "הקבוצות יופעלו בקרוב", בלי קריסה ובלי שגיאות JS', await wp.evaluate(() => /הקבוצות יופעלו בקרוב/.test(document.getElementById('main').innerText)) && wp.__errors.length === 0, wp.__errors);
  check('10א הסרגל והמסך נשארים שמישים (חזרה לבית)', await wp.evaluate(() => { tab('wk'); return cur().v === 'wk'; }));
  await w.ctx.close();

  // ================= מנהל =================
  seed(); let m = await open('m-grp', 'm@x.co'); let mp = m.page;
  await mp.evaluate(() => go('gr')); await waitFor(() => mp.evaluate(() => document.querySelectorAll('.gr-row').length >= 4)); await sleep(300);
  check('11 מנהל: כל 4 הקבוצות ברשימה (גם של אחרים) + "＋ קבוצה חדשה"', await mp.evaluate(() => document.querySelectorAll('.gr-row').length === 4 && /＋ קבוצה חדשה/.test(document.getElementById('main').innerText)));
  check('11א משבצת "קבוצות" במסך ה-+ של המנהל (עם מונה; עברה מ"עוד" ב-#150)', await mp.evaluate(() => { openAdd(); const ok = !!document.querySelector('#sheet .tile[data-v=gr]'); sheetClose(); return ok; }));
  await mp.evaluate(() => go('gr')); await sleep(400);
  await mp.click('[data-a=grNew]'); await waitFor(() => mp.evaluate(() => document.querySelectorAll('input[data-c=grMem]').length === 2)); await sleep(200);
  await mp.fill('input[data-i=grName]', 'קבוצה חדשה'); LOG.length = 0; await mp.click('form[data-f=grSave] button.btn.w'); await sleep(400);
  check('12 שמירה בלי חברים נחסמת (בלי POST)', !sent(/^\/grp$/).length && /לפחות עובד/.test(await toasts(mp)));
  await mp.click('[data-a=grAll]'); await sleep(200);
  check('12א "בחר הכול" מסמן את כל העובדים', await mp.evaluate(() => [...document.querySelectorAll('input[data-c=grMem]')].every((c) => c.checked)));
  await mp.check('input[data-c=grAo]'); await shot(mp, shots, 'r3-ב-הגדרות-מנהל');
  check('12ב טקסט המתג והשורה "סרטון עד דקה · נמחק אחרי 90 יום", בלי גלישה', await mp.evaluate(() => /רק המנהל יכול לשלוח/.test(document.getElementById('main').innerText) && /סרטון עד דקה · נמחק אחרי 90 יום/.test(document.getElementById('main').innerText)) && await noOverflow(mp));
  await mp.click('form[data-f=grSave] button.btn.w'); await waitFor(async () => sent(/^\/grp$/).length >= 1); await sleep(500);
  const gp = sent(/^\/grp$/)[0], gf = gp && gp.body.fields;
  check('13 יצירה: name, mem (2), ao=true, md=true, by=m, t', gf && gf.name.stringValue === 'קבוצה חדשה' && gf.mem.arrayValue.values.length === 2 && gf.ao.booleanValue === true && gf.md.booleanValue === true && gf.by.stringValue === 'm' && Object.keys(gf).sort().join() === 'ao,by,md,mem,name,t', gf && Object.keys(gf));
  check('13א אחרי השמירה חוזרים לרשימה והקבוצה החדשה מוצגת', await waitFor(() => mp.evaluate(() => cur().v === 'gr' && document.querySelectorAll('.gr-row').length === 5)));
  // עריכה
  await mp.click('.gr-row[data-id=g1]'); await waitFor(() => mp.evaluate(() => !!document.querySelector('[data-a=grSet]'))); await sleep(700);
  check('14 מנהל בשיחה: ⋯ על כל הודעה, "הגדרות", בלי שורת השתקה, ובלי פס לא-נקרא לשליחות שלו', await mp.evaluate(() => document.querySelectorAll('[data-a=grMenu]').length === 6 && !document.querySelector('input[data-c=grMute]')));
  LOG.length = 0; await mp.evaluate(() => document.querySelector('[data-a=grMenu][data-id=m4]').click()); await sleep(300); await mp.click('#dlg [data-a=grDel]'); await sleep(300);
  check('15 מחיקת הודעה: חלון אישור, ובלי אישור לא נמחק', await mp.evaluate(() => document.getElementById('dlg').open && /למחוק את ההודעה/.test(document.getElementById('dlg').innerText)) && !LOG.some((l) => l.m === 'DELETE'));
  await mp.click('#dlg [data-a=yes]'); await waitFor(async () => LOG.some((l) => l.m === 'DELETE')); await sleep(300);
  check('15א אחרי אישור: DELETE להודעה והיא נעלמה מהמסך', LOG.some((l) => l.m === 'DELETE' && l.R === '/grp/g1/m/m4') && !DB.m.g1.m4 && await mp.evaluate(() => !document.querySelector('[data-mid=m4]')));
  await mp.evaluate(() => ACT.grSet({ dataset: { id: 'g1' } })); await waitFor(() => mp.evaluate(() => document.querySelectorAll('input[data-c=grMem]').length === 2)); await sleep(200);
  await mp.uncheck('input[data-c=grMem][data-u=w2]'); await mp.uncheck('input[data-c=grMd]'); LOG.length = 0; await mp.click('form[data-f=grSave] button.btn.w'); await waitFor(async () => LOG.some((l) => l.m === 'PATCH')); await sleep(300);
  const ed = LOG.find((l) => l.m === 'PATCH' && l.R === '/grp/g1');
  check('16 עריכה: PATCH עם updateMask לשם, חברים, ao, md; md=false, חבר אחד', ed && /fieldPaths=name/.test(ed.q) && /fieldPaths=md/.test(ed.q) && ed.body.fields.md.booleanValue === false && ed.body.fields.mem.arrayValue.values.length === 1, ed && ed.body.fields);
  await mp.evaluate(() => go('gr')); await sleep(300);
  await mp.evaluate(() => ACT.grSet({ dataset: { id: 'g3' } })); await sleep(500); LOG.length = 0;
  await mp.click('[data-a=grDelG]'); await sleep(300);
  check('17 מחיקת קבוצה: חלון אישור לפני המחיקה', await mp.evaluate(() => document.getElementById('dlg').open) && !LOG.some((l) => l.m === 'DELETE'));
  await mp.click('#dlg [data-a=yes]'); await waitFor(async () => LOG.some((l) => l.m === 'DELETE')); await sleep(400);
  check('17א נמחקה הקבוצה וחזרנו לרשימה בלי g3', !DB.grp.g3 && await waitFor(() => mp.evaluate(() => cur().v === 'gr' && !/סניף אחר/.test(document.getElementById('main').innerText))));
  check('18 אין שגיאות JS (מנהל)', mp.__errors.length === 0, mp.__errors);

  // ===== הצמדה =====
  await mp.evaluate(() => go('gr')); await sleep(300); await mp.click('.gr-row[data-id=g1]'); await waitFor(() => mp.evaluate(() => !!document.querySelector('[data-a=grMenu]'))); await sleep(500);
  check('19 לפני הצמדה אין פס', await mp.evaluate(() => !document.querySelector('.gr-pin')));
  await mp.evaluate(() => document.querySelector('[data-a=grMenu][data-id=m3]').click()); await sleep(300);
  check('19א תפריט ⋯ למנהל: "📌 הצמד" ו"מחק הודעה"', await mp.evaluate(() => /📌 הצמד/.test(document.getElementById('dlg').innerText) && !!document.querySelector('#dlg [data-a=grDel]')));
  LOG.length = 0; await mp.click('#dlg [data-a=grPin]'); await waitFor(async () => LOG.some((l) => l.m === 'PATCH' && l.R === '/grp/g1')); await sleep(300);
  const pn = LOG.find((l) => l.m === 'PATCH' && l.R === '/grp/g1'), pf = pn && pn.body.fields.pin && pn.body.fields.pin.mapValue.fields;
  check('20 הצמדה: PATCH ל-grp/g1 עם updateMask=pin בלבד ו-pin {mid,txt,byN,t,k}', pn && /^\?updateMask\.fieldPaths=pin$/.test(pn.q) && Object.keys(pn.body.fields).join() === 'pin' && pf && pf.mid.stringValue === 'm3' && pf.txt.stringValue === 'הגיעו הצבעים' && pf.byN.stringValue === 'm' && +pf.t.integerValue > 0 && pf.k.stringValue === 't' && Object.keys(pf).sort().join() === 'byN,k,mid,t,txt', pn && pn.body);
  check('20א הפס מופיע אצל המנהל: "📌 הגיעו הצבעים"', await mp.evaluate(() => { const e = document.querySelector('.gr-pin'); return !!e && e.innerText.trim() === '📌 הגיעו הצבעים'; }));
  await mp.evaluate(() => document.querySelector('[data-a=grMenu][data-id=m3]').click()); await sleep(300);
  check('20ב בהודעה המוצמדת התפריט מציג "בטל הצמדה"', await mp.evaluate(() => /בטל הצמדה/.test(document.getElementById('dlg').innerText)));
  await mp.evaluate(() => closeDlg());
  await shot(mp, shots, 'r3-הצמדה');
  // תמונה וסרטון: טקסט קבוע
  LOG.length = 0; await mp.evaluate(() => document.querySelector('[data-a=grMenu][data-id=m5]').click()); await sleep(300); await mp.click('#dlg [data-a=grPin]'); await waitFor(async () => LOG.some((l) => l.m === 'PATCH' && l.R === '/grp/g1')); await sleep(200);
  check('20ג הצמדת תמונה: txt="📷 תמונה", k=img', DB.grp.g1.pin.mapValue.fields.txt.stringValue === '📷 תמונה' && DB.grp.g1.pin.mapValue.fields.k.stringValue === 'img');
  await mp.evaluate(() => document.querySelector('[data-a=grMenu][data-id=m0]').click()); await sleep(300); await mp.click('#dlg [data-a=grPin]'); await sleep(400);
  check('20ד הצמדת סרטון: txt="🎬 סרטון"; ההצמדה החדשה מחליפה את הקודמת', DB.grp.g1.pin.mapValue.fields.txt.stringValue === '🎬 סרטון' && DB.grp.g1.pin.mapValue.fields.mid.stringValue === 'm0');
  // ביטול
  await mp.evaluate(() => document.querySelector('[data-a=grMenu][data-id=m0]').click()); await sleep(300); LOG.length = 0; await mp.click('#dlg [data-a=grPin]'); await waitFor(async () => LOG.some((l) => l.m === 'PATCH' && l.R === '/grp/g1')); await sleep(300);
  const un = LOG.find((l) => l.m === 'PATCH' && l.R === '/grp/g1');
  check('21 ביטול הצמדה: PATCH עם updateMask=pin וגוף ריק, pin נמחק והפס נעלם', un && /^\?updateMask\.fieldPaths=pin$/.test(un.q) && Object.keys(un.body.fields).length === 0 && !DB.grp.g1.pin && await mp.evaluate(() => !document.querySelector('.gr-pin')), un && un.body);
  // שרת ישן
  PIN403 = true; await mp.evaluate(() => document.querySelector('[data-a=grMenu][data-id=m3]').click()); await sleep(300); await mp.click('#dlg [data-a=grPin]'); await sleep(500);
  check('22 שרת ישן (403): הודעה ברורה, בלי פס ובלי קריסה', /ההצמדה תופעל בקרוב/.test(await toasts(mp)) && await mp.evaluate(() => !document.querySelector('.gr-pin')) && mp.__errors.length === 0, mp.__errors);
  PIN403 = false;
  await m.ctx.close();

  // ===== פס אצל עובד, גלילה, הודעה ישנה =====
  seed(); DB.grp.g1.pin = { mapValue: { fields: { mid: S('m3'), txt: S('הגיעו הצבעים'), byN: S('המנהל'), t: I(T0 - H1), k: S('t') } } };
  w = await open('w-pin', 'w1@x.co'); wp = w.page;
  await wp.evaluate(() => tab('gr')); await waitFor(() => wp.evaluate(() => document.querySelectorAll('.gr-row').length >= 2)); await sleep(300);
  check('23 ברשימת הקבוצות אין שינוי (בלי סימן הצמדה)', await wp.evaluate(() => !/📌/.test(document.getElementById('main').innerText)));
  await wp.click('.gr-row[data-id=g1]'); await waitFor(() => wp.evaluate(() => !!document.getElementById('grunr') && !!document.querySelector('.gr-pin'))); await sleep(700);
  const wc = await wp.evaluate(() => { const u = document.getElementById('grunr').getBoundingClientRect(), p = document.querySelector('.gr-pin'); return { pin: p.innerText.trim(), ut: Math.round(u.top), vh: innerHeight, tail: getComputedStyle(p).textOverflow, ws: getComputedStyle(p).whiteSpace, bg: getComputedStyle(p).backgroundColor, adm: !!document.querySelector('[data-a=grMenu]') }; });
  check('23א אצל עובד: פס "📌 הגיעו הצבעים" בשורה אחת עם ellipsis (תפריט ⋯ לכולם מ-#150); פס "לא נקרא" עדיין בחלון', wc.pin === '📌 הגיעו הצבעים' && wc.tail === 'ellipsis' && wc.ws === 'nowrap' && wc.ut >= 0 && wc.ut < wc.vh, wc);
  await wp.evaluate(() => window.scrollTo(0, 0)); await sleep(200); await wp.click('.gr-pin'); await sleep(900);
  check('24 לחיצה על הפס גוללת להודעה ומדגישה אותה', await wp.evaluate(() => { const e = document.querySelector('[data-mid=m3]'), r = e.getBoundingClientRect(); return e.classList.contains('hl') && r.top >= 0 && r.bottom <= innerHeight; }));
  await sleep(2000); check('24א ההדגשה יורדת אחרי רגע', await wp.evaluate(() => !document.querySelector('.gr-b.hl')));
  // לחיצה על התראה (רכיב התראות מדומה, כמו ב-ui-push-s3)
  await wp.evaluate(() => { while (cur().v === 'grc') goBack(); const L = {}; window.__pnL = L; window.Capacitor = window.Capacitor || {}; window.Capacitor.Plugins = Object.assign({}, window.Capacitor.Plugins || {}, { PushGate: { state: async () => ({ ready: true }) }, PushNotifications: { removeAllListeners: async () => {}, unregister: async () => {}, addListener: async (e, f) => { L[e] = f; return { remove() {} }; }, checkPermissions: async () => ({ receive: 'granted' }), requestPermissions: async () => ({ receive: 'granted' }), register: async () => {} } }); window.secPushOff(); window.secPushBoot(); });
  await sleep(600);
  await wp.evaluate(() => { window.__pnL.pushNotificationActionPerformed({ actionId: 'tap', notification: { data: { k: 'grp', id: 'g1' } } }); });
  check('25א לחיצה על התראת קבוצה (data.k=grp, id) פותחת את מסך הקבוצה', await waitFor(() => wp.evaluate(() => cur().v === 'grc' && cur().a === 'g1' && document.querySelectorAll('.gr-b').length > 0)));
  // שם שולח ארוך: 80 תווים לפני ה-@ נשמרים בלי חיתוך ל-60
  await wp.evaluate(() => { SY.email = 'a'.repeat(80) + '@x.co'; }); LOG.length = 0; await wp.fill('#grtx', 'בדיקה'); await wp.click('[data-a=grSend]'); await waitFor(async () => sent(/\/grp\/g1\/m$/).length >= 1);
  const lf = sent(/\/grp\/g1\/m$/)[0]; check('25ב byN ארוך (80) נשלח שלם, לא נחתך ל-60', lf && lf.body.fields.byN.stringValue.length === 80, lf && lf.body.fields.byN.stringValue.length);
  check('25 אין שגיאות JS (עובד, הצמדה)', wp.__errors.length === 0, wp.__errors);
  await w.ctx.close();
  // הודעה מוצמדת ישנה: לא בעמוד הראשון (50 הודעות) ← נטענים עמודים קודמים
  seed(); for (let i = 0; i < 120; i++) msg('g1', 'o' + i, { t: I(T0 - 10 * D1 + i * MIN), txt: S('ישנה ' + i) });
  DB.grp.g1.pin = { mapValue: { fields: { mid: S('o3'), txt: S('ישנה 3'), byN: S('המנהל'), t: I(T0 - 10 * D1), k: S('t') } } };
  w = await open('w-pin-old', 'w1@x.co'); wp = w.page; await wp.evaluate(() => tab('gr')); await waitFor(() => wp.evaluate(() => document.querySelectorAll('.gr-row').length >= 2));
  await wp.click('.gr-row[data-id=g1]'); await waitFor(() => wp.evaluate(() => !!document.querySelector('.gr-pin'))); await sleep(600);
  check('26 ההודעה המוצמדת הישנה לא בעמוד הראשון', await wp.evaluate(() => !document.querySelector('[data-mid=o3]')));
  await wp.click('.gr-pin'); await waitFor(() => wp.evaluate(() => !!document.querySelector('[data-mid=o3]')), 6000); await sleep(900);
  check('26א לחיצה טוענת עמודים קודמים, גוללת ומדגישה', await wp.evaluate(() => { const e = document.querySelector('[data-mid=o3]'); return !!e && e.classList.contains('hl'); }));
  await w.ctx.close();
  // הודעה מוצמדת שלא קיימת: הודעה קצרה
  seed(); DB.grp.g1.pin = { mapValue: { fields: { mid: S('nope'), txt: S('נעלמה'), byN: S('המנהל'), t: I(T0), k: S('t') } } };
  w = await open('w-pin-gone', 'w1@x.co'); wp = w.page; await wp.evaluate(() => tab('gr')); await waitFor(() => wp.evaluate(() => document.querySelectorAll('.gr-row').length >= 2));
  await wp.click('.gr-row[data-id=g1]'); await waitFor(() => wp.evaluate(() => !!document.querySelector('.gr-pin'))); await sleep(600); await wp.click('.gr-pin'); await sleep(600);
  check('27 הודעה מוצמדת שלא נמצאה: הודעה קצרה ובלי קריסה', /לא נמצאה/.test(await toasts(wp)) && wp.__errors.length === 0, wp.__errors);
  check('28 אין שגיאות JS (הודעה ישנה)', wp.__errors.length === 0, wp.__errors);
  await w.ctx.close();
  await browser.close();
  console.log(fail ? 'תוצאה: ' + fail + ' נכשלו' : 'כל הבדיקות עברו'); process.exit(fail ? 1 : 0);
})();
