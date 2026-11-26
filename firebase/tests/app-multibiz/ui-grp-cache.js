'use strict';
// קבוצות – שמירה במכשיר ומהירות (24.11.2026, www/groups.js). רשת מדומה, בלי אמולטור.
// שמירה ב-IndexedDB, פתיחה בלי רשת (רשימה, הודעות, תמונה), שליחה בלי רשת (🕓) ושליחה כשהרשת חוזרת (גם אחרי טעינה מחדש),
// הודעה חדשה מופיעה תוך כ-3 שניות, GRP.kick = מיד, GRP.open פותח את הקבוצה, יציאה מהחשבון מוחקת את השמירה.
// שימוש: node ui-grp-cache.js <www-dir>
const H = require('./harness');
const BZ0 = ['larg', 'peami'].join('');
const ALL = Object.fromEntries(['tasks', 'requests', 'groups'].map((k) => [k, true]));
let fail = 0; const check = (n, ok, info) => { if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const S = (v) => ({ stringValue: String(v) }), I = (v) => ({ integerValue: String(v) }), B = (v) => ({ booleanValue: !!v }), A = (a) => ({ arrayValue: { values: a.map(S) } });
const T0 = H.T0, H1 = 36e5;
const DOCS = 'projects/demo-largpeami/databases/(default)/documents/';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const DB = { grp: {}, m: {}, r: {}, p: {}, staff: {} }; let OFF = false;
const msg = (g, id, o) => { DB.m[g][id] = Object.assign({ by: S('m'), byN: S('המנהל'), t: I(T0 - H1), k: S('t'), txt: S('הודעה ' + id) }, o); };
DB.staff.w1 = { name: S('עובד א'), email: S('w1@x.co'), active: B(true) };
DB.grp.g1 = { name: S('כל הצוות'), mem: A(['w1']), ao: B(false), md: B(true), by: S('m'), t: I(T0 - 9 * H1), last: { mapValue: { fields: { txt: S(''), byN: S('המנהל'), t: I(T0 - H1), k: S('img') } } } }; DB.m.g1 = {};
DB.grp.g2 = { name: S('הודעות'), mem: A(['w1']), ao: B(false), md: B(true), by: S('m'), t: I(T0 - 9 * H1), last: { mapValue: { fields: { txt: S('שלום'), byN: S('המנהל'), t: I(T0 - 2 * H1), k: S('t') } } } }; DB.m.g2 = {};
msg('g1', 'm1', { t: I(T0 - 3 * H1), txt: S('בוקר טוב') });
msg('g1', 'm2', { t: I(T0 - 2 * H1), by: S('w1'), byN: S('w1'), txt: S('הגעתי') });
msg('g1', 'm3', { t: I(T0 - H1), k: S('img'), txt: S('') }); DB.p['g1/m3'] = { img: S(PNG), t: I(T0 - H1), uid: S('m') };
msg('g2', 'n1', { t: I(T0 - 2 * H1), txt: S('שלום') });
const docOf = (name, f) => ({ name: DOCS + name, fields: f, createTime: '2026-11-03T09:00:00Z', updateTime: '2026-11-03T09:00:00Z' });
async function mockCloud(ctx) {
  await ctx.route((u) => new URL(u).port === '8080', async (route) => {
    const req = route.request(), u = new URL(req.url()), m = req.method(), p = decodeURIComponent(u.pathname), body = req.postData() || '';
    const i = p.indexOf('/documents'); if (i < 0) return route.fallback(); const R = p.slice(i + 10).split('?')[0];
    const ok = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    const err = (c, s) => route.fulfill({ status: c, contentType: 'application/json', body: JSON.stringify({ error: { code: c, message: s, status: s } }) });
    if (m === 'GET' && R === '/staff') return ok({ documents: Object.keys(DB.staff).map((id) => docOf('staff/' + id, DB.staff[id])) });
    let rootQ = false; if (R === ':runQuery') { try { rootQ = JSON.parse(body).structuredQuery.from[0].collectionId === 'grp'; } catch (e) { /* */ } }
    if (!/^\/grp/.test(R) && !rootQ) return route.fallback();
    if (OFF) return route.abort('internetdisconnected');
    const rq = R.match(/^(?:\/grp(?:\/([^/:]+))?)?:runQuery$/);
    if (rq) { const sq = JSON.parse(body).structuredQuery, c = sq.from[0].collectionId, w = sq.where && sq.where.fieldFilter; let rows;
      if (c === 'grp') rows = Object.keys(DB.grp).filter((id) => !w || DB.grp[id].mem.arrayValue.values.some((x) => x.stringValue === w.value.stringValue)).map((id) => docOf('grp/' + id, DB.grp[id]));
      else if (c === 'm') { rows = Object.keys(DB.m[rq[1]] || {}).map((id) => docOf('grp/' + rq[1] + '/m/' + id, DB.m[rq[1]][id]));
        if (w) { const v = +w.value.integerValue; rows = rows.filter((d) => w.op === 'GREATER_THAN' ? +d.fields.t.integerValue > v : +d.fields.t.integerValue < v); }
        if (sq.orderBy) { const dsc = sq.orderBy[0].direction === 'DESCENDING'; rows.sort((a, b) => (+a.fields.t.integerValue - +b.fields.t.integerValue) * (dsc ? -1 : 1)); }
        rows = rows.slice(0, sq.limit || 100); } else rows = [];
      return ok(rows.length ? rows.map((d) => ({ document: d, readTime: 'x' })) : [{ readTime: 'x' }]); }
    const s = R.split('/').filter(Boolean), g = s[1];
    if (s.length === 2 && m === 'GET') return DB.grp[g] ? ok(docOf('grp/' + g, DB.grp[g])) : err(404, 'NOT_FOUND');
    if (s[2] === 'r' && s.length === 3) return ok({ documents: [] });
    if (s[2] === 'r' && s.length === 4) { const k = g + '/' + s[3]; if (m === 'GET') return DB.r[k] ? ok(docOf('grp/' + g + '/r/' + s[3], DB.r[k])) : err(404, 'NOT_FOUND');
      if (m === 'PATCH') { const f = JSON.parse(body).fields; DB.r[k] = DB.r[k] || {}; for (const q of u.searchParams.getAll('updateMask.fieldPaths')) DB.r[k][q] = f[q]; return ok({}); } }
    if (s[2] === 'm' && s.length === 3 && m === 'POST') { const id = u.searchParams.get('documentId'); if (DB.m[g][id]) return err(409, 'ALREADY_EXISTS'); DB.m[g][id] = JSON.parse(body).fields; return ok({}); }
    if (s[2] === 'm' && s[4] === 'p') { const k = g + '/' + s[3]; if (m === 'GET') return DB.p[k] ? ok(docOf('grp/' + k + '/p/1', DB.p[k])) : err(404, 'NOT_FOUND'); }
    if (s.length === 1 && m === 'GET') return ok({ documents: [] });
    return err(404, 'NOT_FOUND');
  });
}
const waitFor = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 4000)) { if (await fn()) return true; await sleep(60); } return false; };
const idbKeys = (page) => page.evaluate(() => new Promise((res) => { const r = indexedDB.open('lp-grp', 1); r.onupgradeneeded = () => r.result.createObjectStore('k'); r.onsuccess = () => { const d = r.result, q = d.transaction('k').objectStore('k').getAllKeys(); q.onsuccess = () => { d.close(); res(q.result.map(String)); }; q.onerror = () => { d.close(); res([]); }; }; r.onerror = () => res(['ERR']); }));
const bubbles = (page) => page.evaluate(() => [...document.querySelectorAll('#grmsgs .gr-b')].map((b) => (b.querySelector('.tx') || {}).innerText || (b.querySelector('.gr-pic img') ? 'IMG' : '?')));
const openG = async (page, gid) => { await page.evaluate(() => tab('gr')); await waitFor(() => page.evaluate((g) => !!document.querySelector('.gr-row[data-id=' + g + ']'), gid), 6000); await page.click('.gr-row[data-id=' + gid + ']'); };

(async () => {
  const [www] = process.argv.slice(2); const browser = await H.launch();
  const cfg = { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: ALL } }, admins: { '|m': 1 }, staff: { '|w1': 1 } };
  const x = await H.newPage(browser, www, cfg, [], 'w-grp-cache'); const wp = x.page; await wp.setViewportSize({ width: 412, height: 900 });
  await mockCloud(x.ctx); await H.login(wp, 'w1@x.co'); await sleep(1200);

  // 1. כניסה ראשונה (עם רשת) – נשמר במכשיר
  await openG(wp, 'g1'); await waitFor(async () => (await bubbles(wp)).length === 3 && (await bubbles(wp)).includes('IMG'), 6000); await sleep(1200);
  const k1 = await idbKeys(wp);
  check('1 נשמר במכשיר: רשימת הקבוצות, ההודעות של g1 והתמונה', k1.some((k) => /\|w1\|L$/.test(k)) && k1.some((k) => /\|w1\|c:g1$/.test(k)) && k1.some((k) => /\|w1\|i:g1\/m3$/.test(k)), k1);

  // 2. בלי רשת, אחרי טעינה מחדש: הרשימה וההודעות מהמכשיר
  OFF = true; await wp.reload(); await sleep(1500);
  await openG(wp, 'g1');
  const ok2 = await waitFor(async () => (await bubbles(wp)).join('|') === 'בוקר טוב|הגעתי|IMG', 5000);
  check('2 בלי רשת: ההודעות והתמונה מוצגות מהמכשיר', ok2, await bubbles(wp));
  check('2א בלי רשת: שורת "אין חיבור" מעל ההודעות', await waitFor(() => wp.evaluate(() => /אין חיבור לשרת/.test((document.getElementById('grnet') || {}).innerText || '')), 8000));

  // 3. שליחה בלי רשת: מופיעה מיד עם 🕓, לא מגיעה לשרת; נשמרת גם אחרי טעינה מחדש
  await wp.fill('#grtx', 'בדרך'); await wp.click('[data-a=grSend]'); await sleep(300);
  const pend = await wp.evaluate(() => { const b = [...document.querySelectorAll('#grmsgs .gr-b.me')].pop(); return { tx: b && b.querySelector('.tx').innerText, clock: !!(b && /🕓/.test(b.innerText)), box: document.getElementById('grtx').value }; });
  check('3 שליחה בלי רשת: הבועה מופיעה מיד עם 🕓 והתיבה התרוקנה', pend.tx === 'בדרך' && pend.clock && pend.box === '', pend);
  check('3א ההודעה עוד לא בשרת', !Object.values(DB.m.g1).some((f) => f.txt && f.txt.stringValue === 'בדרך'));
  await sleep(300); await wp.reload(); await sleep(1500); await openG(wp, 'g1');
  check('3ב אחרי טעינה מחדש (עדיין בלי רשת): ההודעה הממתינה עדיין מוצגת עם 🕓', await waitFor(() => wp.evaluate(() => [...document.querySelectorAll('#grmsgs .gr-b.me')].some((b) => /בדרך/.test(b.innerText) && /🕓/.test(b.innerText))), 5000));

  // 4. הרשת חוזרת: נשלחת, ה-🕓 נעלם, שורת "אין חיבור" נעלמת
  OFF = false; await wp.evaluate(() => window.dispatchEvent(new Event('online')));
  const sentOk = await waitFor(() => Object.values(DB.m.g1).some((f) => f.txt && f.txt.stringValue === 'בדרך'), 8000);
  const f4 = Object.values(DB.m.g1).find((f) => f.txt && f.txt.stringValue === 'בדרך');
  check('4 הרשת חזרה: ההודעה נשלחה לשרת פעם אחת, עם by/byN/k/t/txt בלבד', sentOk && Object.values(DB.m.g1).filter((f) => f.txt && f.txt.stringValue === 'בדרך').length === 1 && Object.keys(f4).sort().join() === 'by,byN,k,t,txt', f4 && Object.keys(f4));
  check('4א ה-🕓 נעלם והשורה "אין חיבור" ירדה', await waitFor(() => wp.evaluate(() => ![...document.querySelectorAll('#grmsgs .gr-b')].some((b) => /🕓/.test(b.innerText)) && !((document.getElementById('grnet') || {}).innerText || '').trim()), 8000));
  check('4ב התור במכשיר התרוקן', await waitFor(() => wp.evaluate(() => new Promise((res) => { const r = indexedDB.open('lp-grp', 1); r.onsuccess = () => { const d = r.result, t = d.transaction('k').objectStore('k'), all = t.getAllKeys(); all.onsuccess = () => { const k = all.result.find((z) => /\|q$/.test(z)); if (!k) { d.close(); return res(true); } const g = t.get(k); g.onsuccess = () => { d.close(); res(Array.isArray(g.result) && g.result.length === 0); }; }; }; })), 4000));

  // 5. מהירות: הודעה חדשה בשרת מופיעה תוך כ-3 שניות; GRP.kick (התראה) – מיד
  msg('g1', 'm9', { t: I(T0 + 1000), txt: S('הגיעה סחורה') }); const t5 = Date.now();
  await waitFor(async () => (await bubbles(wp)).includes('הגיעה סחורה'), 6000); const dt = Date.now() - t5;
  check('5 הודעה חדשה מופיעה תוך 4.5 שניות (בדיקה כל 3 שניות)', dt < 4500, dt);
  await sleep(200); msg('g1', 'm10', { t: I(T0 + 2000), txt: S('תודה') }); const t6 = Date.now(); await wp.evaluate(() => GRP.kick('g1'));
  await waitFor(async () => (await bubbles(wp)).includes('תודה'), 3000); const dt2 = Date.now() - t6;
  check('5א התראה שהגיעה (GRP.kick) – ההודעה מופיעה מיד (פחות משנייה וחצי)', dt2 < 1500, dt2);

  // 6. לחיצה על התראה: GRP.open פותח את הקבוצה הנכונה
  await wp.evaluate(() => tab('wk')); await sleep(300); await wp.evaluate(() => GRP.open('g2'));
  check('6 GRP.open (לחיצה על התראה) פותח את שיחת הקבוצה g2', await waitFor(async () => (await wp.evaluate(() => cur().v + ':' + cur().a)) === 'grc:g2' && (await bubbles(wp)).includes('שלום'), 5000), await wp.evaluate(() => cur()));

  // 7. יציאה מהחשבון: הכול נמחק מהמכשיר
  await wp.evaluate(() => syOut(1)); await sleep(800); // היציאה האמיתית מהחשבון (1 = בלי מחיקת כל נתוני הדפדפן)
  const dbs = await wp.evaluate(async () => (indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name) : ['?']));
  check('7 יציאה מהחשבון (syOut → GRP.out) מוחקת את מאגר lp-grp', !dbs.includes('lp-grp'), dbs);
  check('8 אין שגיאות JS', wp.__errors.length === 0, wp.__errors);
  await x.ctx.close(); await browser.close();
  console.log(fail ? fail + ' בדיקות נכשלו' : 'כל הבדיקות עברו'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
