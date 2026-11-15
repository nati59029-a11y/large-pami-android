'use strict';
// סריקת חנות בתלת מימד, שלב 13 (14.11.2026): דוחות, מגמה, עובדים, סניפים, חוסרים, תיקונים וערעורים, המלצות, הגדרות, PDF, משימת תיקון של עובד וצילום אימות, ורענון ההדמיה אחרי דיווח יזום.
// רשת מדומה (בלי אמולטור ובלי Gemini), 360px. store3d-report.js מחובר ב-index.html. שימוש: node ui-st3d-rep.js <www-dir> [out.json] [shot-prefix]
const fs = require('fs'); const path = require('path'); const H = require('./harness');
let fail = 0; const res = []; const check = (n, ok, info) => { if (!ok) fail++; res.push({ n, ok: !!ok, info }); console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 500) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const enc = (v) => (v == null ? { nullValue: null } : typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }) : typeof v === 'string' ? { stringValue: v } : Array.isArray(v) ? { arrayValue: v.length ? { values: v.map(enc) } : {} } : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } });
const dec = (v) => { if (!v) return v; if ('stringValue' in v) return v.stringValue; if ('integerValue' in v) return +v.integerValue; if ('doubleValue' in v) return v.doubleValue; if ('booleanValue' in v) return v.booleanValue; if ('arrayValue' in v) return (v.arrayValue.values || []).map(dec); if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, dec(x)])); return null; };
const DOCS = 'projects/demo-largpeami/databases/(default)/documents/b/biz-s/';
const D = (y, m, d, h) => Date.UTC(y, m - 1, d, h || 9);
const mapDoc = () => ({ br: 'main', kind: 's', name: 'החנות הראשית', seq: 2, grid: 50, numDir: 'rtl', ent: 'd1', src: 'manual', v: 2, upd: D(2026, 11, 1),
  rooms: [{ id: 'r1', name: 'אולם', p: [0, 0, 700, 0, 700, 1400, 0, 1400], h: 300 }], walls: [], cols: [], doors: [{ id: 'd1', x: 350, y: 1400, w: 180, a: 0, k: 'ent' }],
  fx: [{ id: 'f1', k: 'gon', x: 350, y: 700, w: 400, d: 90, h: 190, a: 0, sides: 2, bays: 2, lvl: 5, hi: false, room: 'r1', num: 1, name: 'גונדולה מרכזית' }, { id: 'f2', k: 'wall', x: 350, y: 40, w: 500, d: 40, h: 200, a: 0, sides: 1, bays: 2, lvl: 5, hi: false, room: 'r1', num: 2, name: 'קיר אחורי' }], syms: [] });
const TH = (r, s) => 'b/biz-s/store3d/main/ph/' + r + '/' + s + '_t.jpg';
const sumDoc = () => ({ b: { 'f1-a-1': { s: 'iss', r: 'run_2', t: D(2026, 11, 12), th: TH('run_2', 'f1-a-1_a'), n: 2 } }, run: 'run_2', score: S.score, upd: D(2026, 11, 12) });
const RUNS = { run_2: { br: 'main', map: 's-main', k: 'sched', st: 'done', n: 4, nDone: 4, openAt: D(2026, 11, 12), dueAt: D(2026, 11, 14), doneAt: D(2026, 11, 13), uids: ['w'], recs: [{ t: 'להזיז את המבצעים לגובה העיניים', bay: 'f1-a-1' }], sum: { score: 82, nOk: 1, nIss: 2, nRev: 1, nMiss: 0, nBad: 0, cat: { p: 70, h: 85, o: 90, d: 100 }, prev: 'run_1', dScore: 6 } },
  run_1: { br: 'main', map: 's-main', k: 'sched', st: 'done', n: 4, nDone: 4, openAt: D(2026, 11, 5), dueAt: D(2026, 11, 7), uids: ['w'], sum: { score: 76, nOk: 2, nIss: 2, nRev: 0, nMiss: 0, nBad: 0, cat: { p: 60, h: 80, o: 90, d: 100 }, prev: 'run_0', dScore: 6 } },
  run_0: { br: 'main', map: 's-main', k: 'sched', st: 'done', n: 4, nDone: 4, openAt: D(2026, 10, 29), dueAt: D(2026, 10, 31), uids: ['w'], sum: { score: 70, nOk: 2, nIss: 2, nRev: 0, nMiss: 0, nBad: 0, cat: { p: 55, h: 75, o: 90, d: 100 } } },
  run_b: { br: 'b2', map: 's-b2', k: 'sched', st: 'done', n: 4, nDone: 4, openAt: D(2026, 11, 11), uids: ['w'], sum: { score: 91, nOk: 4, nIss: 0, nRev: 0, nMiss: 0, nBad: 0, dScore: 3 } } };
const AI = {
  run_2: { 'f1-a-1_a': { st: 'issue', conf: .8, iss: [{ k: 'noprice', sev: 2, conf: .9, box: [100, 100, 300, 200], t: 'אין מחיר על המדף השני' }, { k: 'hole', sev: 3, conf: .8, t: 'חור גדול בצד שמאל' }], recs: [{ t: 'לקרב את המוצרים לקצה המדף', box: [500, 300, 300, 300] }] },
    'f1-a-2_a': { st: 'issue', conf: .7, iss: [{ k: 'face', sev: 1, conf: .7, t: 'החזית לא גלויה' }, { k: 'pricepos', sev: 1, warn: true, t: 'מחיר רחוק מהמוצר' }] },
    'f2-a-1_a': { st: 'review', conf: .4, iss: [] }, 'f2-a-2_a': { st: 'ok', conf: .9, iss: [] } },
  run_1: { 'f1-a-1_a': { st: 'issue', conf: .8, iss: [{ k: 'noprice', sev: 2, t: 'אין מחיר' }] }, 'f1-a-2_a': { st: 'ok', iss: [] }, 'f2-a-1_a': { st: 'ok', iss: [] }, 'f2-a-2_a': { st: 'issue', iss: [{ k: 'low', sev: 2, t: 'נגמר' }] } } };
const S = { past: [{ runId: 'run_p2', st: 'done', openAt: D(2026, 11, 8), dueAt: D(2026, 11, 10), doneAt: D(2026, 11, 9), map: 's-main', n: { n: 3, d: 3 } }, { runId: 'ad_1', st: 'done', k: 'adhoc', openAt: D(2026, 11, 5), doneAt: D(2026, 11, 5), map: 's-main', n: { n: 1, d: 1 } }], score: 80, writes: [], calls: [], reads: [], setDoc: null, short: { items: [{ n: 'מוצר א', c: 'חטיפים', bay: 'f1-a-1', why: 'low' }, { n: 'מוצר ב', c: 'חטיפים', bay: 'f1-a-2', why: 'miss' }, { n: 'מוצר ג', c: 'שתייה', bay: 'f2-a-1', why: 'hole' }], st: 'draft' }, jpg: '' };
const FIX = { f_m1: { run: 'run_2', slot: 'f1-a-1_a', map: 's-main', br: 'main', iks: [0], st: 'sent', u: 'w', by: 'ai', at: D(2026, 11, 12), dueAt: D(2026, 11, 14), vth: TH('run_2', 'f1-a-1_a'), vst: 'ok' }, f_m2: { run: 'run_2', slot: 'f1-a-2_a', map: 's-main', br: 'main', iks: [0], st: 'open', u: 'w', by: 'ai', at: D(2026, 11, 12), dueAt: D(2026, 11, 14) } };
const APP = { 'run_2__f1-a-1_a__0': { run: 'run_2', slot: 'f1-a-1_a', ik: '0', by: 'w', txt: 'המחיר כן קיים על המדף', at: D(2026, 11, 13), st: 'open' } };
const mon = () => { const d = new Date(); d.setDate(15); const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit' }).formatToParts(d); return p.find((x) => x.type === 'year').value + '-' + p.find((x) => x.type === 'month').value; };
async function server(ctx) {
  const doc = (name, o) => ({ name: DOCS + name, fields: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, enc(v)])), createTime: '2026-11-03T09:00:00Z', updateTime: '2026-11-03T09:00:00Z' });
  const j = (route, st, b) => route.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(b) });
  const nf = (route) => j(route, 404, { error: { code: 404, status: 'NOT_FOUND' } });
  await ctx.route((u) => u.port === '8080' && /\/documents\/b\/biz-s\/(smap|s3br|s3sum|sround|srun|staff|s3set|s3fix|s3appeal|s3short|s3perf|s3use)/.test(u.pathname), (route) => {
    const rq = route.request(), u = new URL(rq.url()), p = decodeURIComponent(u.pathname.replace(/^.*\/documents\/b\/biz-s\//, '')); S.reads.push(rq.method() + ' ' + p);
    if (rq.method() === 'PATCH' || rq.method() === 'POST') { let b = {}; try { b = JSON.parse(rq.postData()); } catch (e) { /* */ } const f = Object.fromEntries(Object.entries(b.fields || {}).map(([k, v]) => [k, dec(v)]));
      S.writes.push({ m: rq.method(), p, id: u.searchParams.get('documentId'), mask: u.searchParams.getAll('updateMask.fieldPaths'), f });
      if (/^s3set\//.test(p)) S.setDoc = f; if (/^s3short\//.test(p)) Object.assign(S.short, f);
      return j(route, 200, { name: DOCS + p, fields: b.fields || {} }); }
    if (p === 'smap/s-main/ver') return j(route, 200, { documents: [doc('smap/s-main/ver/000001', { v: 1, at: D(2026, 11, 3), by: 'system', why: 'ניקוי' }), doc('smap/s-main/ver/000002', { v: 2, at: D(2026, 11, 4), by: 'm', why: 'עריכה' })] });
    if (p === 'smap/s-main') return j(route, 200, doc(p, mapDoc())); if (/^smap\/|^s3br\//.test(p)) return nf(route);
    if (p === 's3sum/s-main') return j(route, 200, doc(p, sumDoc()));
    if (p === 'sround') return j(route, 200, { documents: [] });
    if (p === 'staff/w') return j(route, 200, doc(p, { name: 'דנה', active: true }));
    if (p === 'staff') return j(route, 200, { documents: [doc('staff/w', { name: 'דנה', active: true }), doc('staff/w2', { name: 'יוסי', active: true }), doc('staff/w9', { name: 'מושבת', active: false })] });
    if (p === 'srun') return j(route, 200, { documents: Object.entries(RUNS).sort((a, b) => b[1].openAt - a[1].openAt).map(([id, o]) => doc('srun/' + id, o)) });
    let m = /^srun\/(\w+)\/ai$/.exec(p); if (m) return j(route, 200, { documents: Object.entries(AI[m[1]] || {}).map(([s, o]) => doc('srun/' + m[1] + '/ai/' + s, o)) });
    m = /^srun\/(\w+)\/ai\/(.+)$/.exec(p); if (m) return AI[m[1]] && AI[m[1]][m[2]] ? j(route, 200, doc(p, AI[m[1]][m[2]])) : nf(route);
    m = /^srun\/(\w+)\/ph\/(.+)$/.exec(p); if (m) return j(route, 200, doc(p, { th: TH(m[1], m[2]), at: D(2026, 11, 12) }));
    if (p === 's3set/main') return S.setDoc ? j(route, 200, doc(p, S.setDoc)) : nf(route);
    if (p === 's3fix') return j(route, 200, { documents: Object.entries(FIX).map(([id, o]) => doc('s3fix/' + id, o)) });
    if (p === 's3appeal') return j(route, 200, { documents: Object.entries(APP).map(([id, o]) => doc('s3appeal/' + id, o)) });
    if (p === 's3short/run_2') return j(route, 200, doc(p, S.short)); if (/^s3short\//.test(p)) return nf(route);
    if (p === 's3use/b_main') return j(route, 200, doc(p, { m: '2026-11', n: 120, cap: 500 }));
    if (/^s3perf\/w\/m\//.test(p)) return j(route, 200, doc(p, { runs: 3, onTime: 2, late: 1, work: 95, pause: 10, pauses: 2, photos: 40, retakes: 4, fixOk: 2, fixRej: 1, appeals: 2, appAcc: 1, upd: D(2026, 11, 12) }));
    return nf(route);
  });
  await ctx.route((u) => u.port === '9199', (route) => route.fulfill({ status: 200, contentType: 'image/jpeg', body: Buffer.from(S.jpg, 'base64') }));
  const rec = (route, fn) => { let b = {}; try { b = JSON.parse(route.request().postData()).data || {}; } catch (e) { /* */ } S.calls.push({ fn, b }); return b; };
  const ok = (route, r) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: r }) });
  await ctx.route('**/s3Fix', (route) => { const b = rec(route, 's3Fix'); ok(route, b.decide ? { ok: true, fixTaskId: b.fixTaskId, st: b.decide } : b.cancel ? { ok: true, st: 'cancel' } : { ok: true, fixTaskId: 'm_' + b.qid, st: 'open' }); });
  await ctx.route('**/s3SetBranch', (route) => { rec(route, 's3SetBranch'); ok(route, { ok: true }); });
  await ctx.route('**/shelfCheck', (route) => { const b = rec(route, 'shelfCheck'); if (b.mode === 'adhoc') S.score = 90; ok(route, b.mode === 'verify' ? { st: 'ok', iss: [], fixSt: 'ok', usage: { m: '2026-11', n: 3, cap: 500, w80: false } } : { st: 'ok', iss: [], usage: { m: '2026-11', n: 3, cap: 500, w80: false }, runId: 'ad_1' }); });
  await ctx.route('**/s3View', (route) => { const b = rec(route, 's3View');
    if (b.runId === 'run_open') return ok(route, { run: { runId: 'run_open', st: 'open', map: 's-main', openAt: D(2026, 11, 13), dueAt: D(2026, 11, 16), bays: ['f1-a-1'], ai: { 'f1-a-1_a': { st: 'issue', iss: [{ k: 'noprice', sev: 2, t: 'אין מחיר על המדף' }] } }, sum: { score: 77 } } });
    if (b.runId === 'run_2') return ok(route, { run: { runId: 'run_2', st: 'done', map: 's-main', ai: { 'f1-a-2_a': { st: 'issue', iss: [{ k: 'face', sev: 1, t: 'החזית לא גלויה' }] } } } });
    ok(route, { runs: [{ runId: 'run_open', st: 'open', openAt: D(2026, 11, 13), dueAt: D(2026, 11, 16), map: 's-main', n: { n: 3, d: 1 } }], fixes: [Object.assign({ id: 'f_m2' }, FIX.f_m2)], take: [], past: S.past }); });
}
async function open(browser, www, cfg, email, report) {
  const { ctx, page } = await H.newPage(browser, www, cfg, [], email); await page.setViewportSize({ width: 360, height: 760 });
  await ctx.addInitScript(() => { let v; window.__os = null; Object.defineProperty(window, 'Store3D', { configurable: true, get() { return v; }, set(x) { if (x && typeof x.open === 'function') { const o0 = x.open; x.open = function (el, m, o) { window.__os = o && o.sum ? o.sum.score : null; return o0.apply(this, arguments); }; } v = x; } }); });
  await server(ctx); await H.login(page, email);
  await page.evaluate(() => { const sh = document.getElementById('sheet'); if (sh && !sh.hidden && typeof ACT.startBlank === 'function') ACT.startBlank(); });
  await H.settle(page, 400);
  return { ctx, page };
}
const txt = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.innerText.replace(/\s+/g, ' ').trim() : null; }, sel);
const noOverflow = (page) => page.evaluate(() => { const W = document.documentElement.clientWidth; const bad = [...document.querySelectorAll('#main *, #dlg *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > W + 1 || r.left < -1) && !e.closest('.scroll-x,.s3tabs,.s3main,.s3pl'); }).slice(0, 5).map((e) => e.tagName + '.' + e.className); return { sw: document.documentElement.scrollWidth, W, bad }; });
const fp = (f, s) => f ? f + '-' + s + '-360.png' : null;
const shot = async (page, file) => { if (!file) return; await page.waitForTimeout(300); await page.screenshot({ path: file, fullPage: true }); };
const goTab = async (page, tab, sub) => { await page.evaluate(([t, s]) => { S3UI.X.tab = t; S3UI.X.d = S3UI.X.d; if (s) { /* תת-לשונית */ } rerender(); }, [tab, sub]); if (sub) { await page.click('[data-a=s3rSub][data-k=' + sub + ']'); } await sleep(900); };

(async () => {
  const [www, out, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(path.dirname(shots), { recursive: true });
  S.jpg = ''; const browser = await H.launch();
  const cM = () => ({ mode: 'new', users: { m: 'biz-s', w: 'biz-s' }, biz: { 'biz-s': { dataRoot: 'b', features: { store3d: true, secretary: true }, name: 'עסק בדיקה' } }, admins: { 'b/biz-s/|m': 1 }, staff: { 'b/biz-s/|w': 1 } });
  // ---- 0. בדיקה סטטית: בלי צבעי hex קשיחים ----
  const src = fs.readFileSync(path.join(www, 'store3d-report.js'), 'utf8');
  check('0 בקובץ הדוחות אין צבעי hex קשיחים (עיצוב לפי טוקנים)', !/#[0-9a-fA-F]{3,8}\b/.test(src.replace(/#s3r\w*/g, '')), (src.match(/#[0-9a-fA-F]{3,8}\b/g) || []).slice(0, 5));
  const M = await open(browser, www, cM(), 'm@x.co', true); const pg = M.page;
  S.jpg = await pg.evaluate(() => { const c = document.createElement('canvas'); c.width = 400; c.height = 300; const x = c.getContext('2d'); x.fillStyle = 'rgb(90,120,160)'; x.fillRect(0, 0, 400, 300); x.fillStyle = 'rgb(200,180,60)'; x.fillRect(40, 60, 200, 120); return c.toDataURL('image/jpeg', .8).split(',')[1]; });
  await pg.evaluate(() => { NAV = [{ v: 'home' }]; render(0); }); await sleep(1200); await pg.evaluate(() => { go('st3'); }); await sleep(1500);
  // ---- 1. דוח סבב ----
  await goTab(pg, 'rep');
  let t = await txt(pg, '#main');
  check('11 מנהל: כפתור "שאלו את המזכירה" קיים ופותח את המזכירה (secOpen)', await pg.evaluate(() => { const b = document.querySelector('#main [data-a=secOpen]'); return !!b && /המזכירה/.test(b.innerText); }));
  check('11א מנהל: אין את רשימת "הסבבים הקודמים שלי" של העובד', !(await pg.$('[data-past]')));
  check('1 דוח: ציון 82, שינוי +6, מדפים תקינים, פסי קטגוריות, ובלי נתוני דוגמה', /ציון 82/.test(t) && /\+6/.test(t) && /מדפים תקינים 1 מתוך 4/.test(t) && /מחירים 70/.test(t) && /חורים ומוצרים שנגמרו 85/.test(t), t.slice(0, 400));
  check('1א בעיות לפי מדף: גוף 1 מקטע 1 ראשון (חומרה), "נשארה מהסבב הקודם" / "חדשה", "טופלו 1", אזהרה אינה בעיה', /בעיות לפי מדף \(3\)/.test(t) && /נשארה מהסבב הקודם/.test(t) && /חדשה/.test(t) && /טופלו: 1/.test(t) && /לבדיקה/.test(t) && /נתוני מכירות לפי מוצר: לא זמין/.test(t), t.slice(300, 1400));
  await shot(pg, fp(shots, 'דוח'));
  const ov = await noOverflow(pg); check('1ב 360px: אין גלישה לרוחב', ov.sw <= ov.W + 1 && !ov.bad.length, ov);
  await pg.click('[data-a=s3rImg][data-slot="f1-a-1_a"]'); await sleep(1500);
  check('1ג "הצג תמונה": תמונה עם מסגרת סימון על הבעיה', await pg.evaluate(() => !!document.querySelector('.s3pic img') && document.querySelectorAll('.s3pic .s3bx').length >= 1), await pg.evaluate(() => document.querySelectorAll('.s3bx').length));
  // ---- 2. מגמה, עובדים, סניפים ----
  await pg.click('[data-a=s3rSub][data-k=trend]'); await sleep(700);
  const tr = await pg.evaluate(() => ({ pl: document.querySelectorAll('#main svg[role=img] polyline').length, c: document.querySelectorAll('#main svg[role=img] circle').length, tx: [...document.querySelectorAll('#main svg[role=img] text')].map((e) => e.textContent).join(',') }));
  check('2 מגמה: גרף עם 3 נקודות (70, 76, 82)', tr.pl === 1 && tr.c === 3 && /70/.test(tr.tx) && /76/.test(tr.tx) && /82/.test(tr.tx), tr); await shot(pg, fp(shots, 'מגמה'));
  S.reads.length = 0; await pg.click('[data-a=s3rSub][data-k=wk]'); await sleep(1500); t = await txt(pg, '#main');
  check('2א עובדים: דנה ויוסי (לא המושבת) עם נתוני החודש מ-s3perf, ללא נתונים ליוסי', /דנה/.test(t) && /יוסי/.test(t) && !/מושבת/.test(t) && /דקות עבודה 95/.test(t) && /צלם שוב: 4 \(10%\)/.test(t) && /תיקונים: 2 אושרו, 1 נדחו/.test(t) && /אין נתונים לחודש הזה/.test(t), t.slice(0, 500)); await shot(pg, fp(shots, 'עובדים'));
  check('2ב אין לשונית "סניפים" למנהל רגיל', await pg.evaluate(() => !document.querySelector('[data-a=s3rSub][data-k=br]')));
  await pg.evaluate(() => { SY.sa = true; window.brList = () => [{ id: 'main', name: 'החנות' }, { id: 'b2', name: 'סניף צפון' }]; rerender(); }); await sleep(600);
  await pg.click('[data-a=s3rSub][data-k=br]'); await sleep(700); t = await txt(pg, '#main');
  check('2ג מנהל־על: השוואת סניפים לפי ציון (צפון 91 לפני החנות 82)', /סניף צפון 91.*החנות 82/.test(t), t.slice(0, 300)); await shot(pg, fp(shots, 'סניפים'));
  await pg.evaluate(() => { SY.sa = false; }); 
  // ---- 3. חוסרים ----
  S.writes.length = 0; await pg.evaluate(() => { rerender(); }); await pg.click('[data-a=s3rSub][data-k=short]'); await sleep(1200); t = await txt(pg, '#main');
  check('3 חוסרים: 3 פריטים לפי קטגוריה, "הרשימה לא נשלחת לספק"', /חטיפים/.test(t) && /שתייה/.test(t) && /מוצר ג/.test(t) && /לא נשלחת לספק/.test(t), t.slice(0, 300)); await shot(pg, fp(shots, 'חוסרים'));
  await pg.click('input[data-c=s3rShDrop][data-i="1"]'); await pg.click('[data-a=s3rShOk]'); await sleep(300); await pg.click('[data-a=yes]'); await sleep(900);
  const sw = S.writes.find((w) => /^s3short\/run_2/.test(w.p));
  check('3א אישור: PATCH אחד עם st=ok, drop=[1], okBy, ובלי שליחה לשום ספק', sw && sw.f.st === 'ok' && JSON.stringify(sw.f.drop) === '[1]' && sw.f.okBy === 'm' && sw.mask.includes('st') && !S.calls.some((c) => /send|order/i.test(c.fn)), sw);
  check('3ב אחרי האישור: מוצג "אושרה" ובלי כפתורי אישור', /אושרה/.test(await txt(pg, '#main')) && !(await pg.$('[data-a=s3rShOk]')));
  // ---- 4. תיקונים וערעורים ----
  await pg.click('[data-a=s3rSub][data-k=fix]'); await sleep(1500); t = await txt(pg, '#main');
  check('4 תיקונים: ערעור פתוח של דנה, משימה "נשלח, ממתין לאישור" עם כפתורי הכרעה, ומשימה "לתקן"', /ערעורים פתוחים \(1\)/.test(t) && /המחיר כן קיים/.test(t) && /ממתין לאישור/.test(t) && /אישור תיקון/.test(t) && /לתקן/.test(t), t.slice(0, 500)); await shot(pg, fp(shots, 'תיקונים'));
  S.calls.length = 0; await pg.click('[data-a=s3rFixDec][data-id=f_m1][data-d=ok]'); await sleep(300); await pg.click('[data-a=yes]'); await sleep(800);
  check('4א הכרעה במשימה שנשלחה: s3Fix עם decide=ok', S.calls.some((c) => c.fn === 's3Fix' && c.b.fixTaskId === 'f_m1' && c.b.decide === 'ok'), S.calls);
  await pg.click('[data-a=s3rDec]'); await sleep(1500); t = await txt(pg, '#dlg');
  check('4ב מסך הכרעה: מקום, הבעיה, טקסט העובד, תמונה עם סימון, תיבת "הערה קבועה"', /הכרעה בערעור/.test(t) && /אין מחיר על המדף השני/.test(t) && /המחיר כן קיים/.test(t) && /הערה קבועה/.test(t) && await pg.evaluate(() => !!document.querySelector('#dlg .s3pic .s3bx')), t.slice(0, 300));
  await shot(pg, fp(shots, 'הכרעה'));
  await pg.fill('#s3rdt', 'צודק, נוסיף הערה'); await pg.check('#s3rdn'); S.writes.length = 0; await pg.click('[data-a=s3rDecGo][data-d=acc]'); await sleep(1000);
  const aw = S.writes.find((w) => /^s3appeal\//.test(w.p));
  check('4ג קבלת ערעור: PATCH עם st=acc, note=true, dec, decBy, decAt; מסכה בלי שדות אחרים', aw && aw.f.st === 'acc' && aw.f.note === true && aw.f.dec === 'צודק, נוסיף הערה' && aw.f.decBy === 'm' && aw.f.decAt > 0 && aw.mask.sort().join() === 'dec,decAt,decBy,note,st', aw);
  // יצירת משימת תיקון מהדוח
  await pg.click('[data-a=s3rSub][data-k=run]'); await sleep(800); S.calls.length = 0;
  await pg.click('[data-a=s3rFixNew][data-slot="f1-a-2_a"]'); await sleep(500); await pg.fill('#s3rfm', 'להחזיר את המוצרים קדימה'); await pg.selectOption('#s3rfu', 'w2'); await pg.fill('#s3rfd', '3');
  await pg.click('[data-a=s3rFixGo]'); await sleep(1000); const fc = S.calls.find((c) => c.fn === 's3Fix');
  check('4ד יצירת משימה: s3Fix עם qid, מפה, מקטע מלא, עובד, תיאור וימים', fc && /^[A-Za-z0-9-]{16,40}$/.test(fc.b.qid) && fc.b.map === 's-main' && fc.b.slot === 'f1-a-2_a' && fc.b.u === 'w2' && fc.b.man === 'להחזיר את המוצרים קדימה' && fc.b.dueDays === 3, fc);
  S.calls.length = 0; await pg.click('[data-a=s3rFixNew][data-slot="f1-a-2_a"]'); await sleep(400); await pg.click('[data-a=s3rFixGo]'); await sleep(400);
  check('4ה משימה בלי תיאור: לא נשלחת בקשה', !S.calls.some((c) => c.fn === 's3Fix')); await pg.click('#dlg [data-a=closeDlg]');
  // ערעור מהדוח
  S.writes.length = 0; await pg.click('[data-a=s3rAppeal][data-slot="f1-a-2_a"][data-ik="0"]'); await sleep(400); await pg.fill('#s3rat', 'החזית דווקא גלויה'); await pg.click('[data-a=s3rApGo]'); await sleep(900);
  const pw = S.writes.find((w) => w.m === 'POST' && /^s3appeal/.test(w.p));
  check('4ו ערעור: POST עם מזהה run__slot__ik ושדות לפי החוקים (st=open, by, at, txt)', pw && pw.id === 'run_2__f1-a-2_a__0' && pw.f.st === 'open' && pw.f.by === 'm' && pw.f.ik === '0' && pw.f.txt === 'החזית דווקא גלויה' && Object.keys(pw.f).sort().join() === 'at,by,ik,run,slot,st,txt', pw);
  // ---- 5. המלצות ----
  await goTab(pg, 'recs'); t = await txt(pg, '#main');
  check('5 המלצות: המלצת חנות, המלצת מדף, תמונה עם סימון בצבע הדגשה', /להזיז את המבצעים/.test(t) && /לקרב את המוצרים לקצה המדף/.test(t) && await pg.evaluate(() => !!document.querySelector('.s3pic .s3bx.rc')), t.slice(0, 300)); await shot(pg, fp(shots, 'המלצות'));
  // ---- 6. הגדרות ----
  await goTab(pg, 'set'); t = await txt(pg, '#main');
  check('6 הגדרות: ברירות מחדל (35/30/20/15, סכום 100), "משימות התיקון מוצגות תמיד", ובלי מכסה למנהל רגיל', /סכום: 100/.test(t) && /משימות התיקון שלו מוצגות תמיד/.test(t) && await pg.evaluate(() => document.getElementById('s3rw-p').value === '35' && !document.getElementById('s3rcap')), t.slice(0, 200)); await shot(pg, fp(shots, 'הגדרות'));
  S.writes.length = 0; await pg.fill('#s3rw-p', '50'); await pg.dispatchEvent('#s3rw-p', 'change'); await sleep(200);
  check('6א שינוי משקל: הסכום מתעדכן (115) והודעה', /115/.test(await txt(pg, '#s3rwt')) && /צריך להיות 100/.test(await txt(pg, '#s3rwm')));
  await pg.click('[data-a=s3rSetSave]'); await sleep(500);
  check('6ב שמירה עם סכום שונה מ-100: נחסמת בהודעה, בלי כתיבה', /חייב להיות 100/.test(await txt(pg, '#main')) && !S.writes.length);
  await pg.fill('#s3rw-p', '30'); await pg.fill('#s3rw-h', '35'); await pg.check('#s3rs-score'); await pg.check('#s3rs-recs'); await pg.fill('#s3rrn', '5'); await pg.fill('#s3rst', 'חנות שכונתית'); await pg.fill('#s3rcc', 'חלב\nחטיפים\nחלב\n'); await pg.selectOption('#s3rsb', 'fixed'); await pg.selectOption('#s3rsu', 'w2'); await pg.fill('#s3rdu', '4');
  await pg.click('[data-a=s3rSetSave]'); await sleep(900); const sv = S.writes.find((w) => w.p === 's3set/main');
  check('6ג שמירה: s3set עם w=30/35/20/15, show=[fix,score,recs], recN 5, cats בלי כפילות, sub fixed + subU, due 4, numDir, upd, by', sv && JSON.stringify(sv.f.w) === '{"p":30,"h":35,"o":20,"d":15}' && JSON.stringify(sv.f.show) === '["fix","score","recs"]' && sv.f.recN === 5 && sv.f.stype === 'חנות שכונתית' && JSON.stringify(sv.f.cats) === '["חלב","חטיפים"]' && sv.f.sub === 'fixed' && sv.f.subU === 'w2' && sv.f.due === 4 && sv.f.numDir === 'rtl' && sv.f.by === 'm' && sv.f.upd > 0 && sv.f.catMode === 'mix', sv && sv.f);
  // ---- 7. PDF ----
  await goTab(pg, 'rep'); await pg.click('[data-a=s3rSub][data-k=run]'); await sleep(1500);
  await pg.evaluate(() => { window.saveFile = (n, d, t) => { window.__pdf = { n, t, len: d.length, head: new TextDecoder('latin1').decode(d.slice(0, 600)) }; }; });
  await pg.click('[data-a=s3rPdf]'); await pg.waitForFunction(() => window.__pdf, null, { timeout: 30000 }).catch(() => {}); const pdf = await pg.evaluate(() => window.__pdf || null);
  check('7 PDF: נוצר במכשיר (%PDF, application/pdf, שם עם תאריך), 2 עמודים: סיכום ועמוד בעיות עם תמונות', pdf && /^%PDF-/.test(pdf.head) && pdf.t === 'application/pdf' && /דוח-סבב-2026-11-12\.pdf/.test(pdf.n) && /\/Count 2/.test(pdf.head) && pdf.len > 20000, pdf && { n: pdf.n, len: pdf.len, count: (pdf.head.match(/\/Count \d+/) || [])[0] });
  // ---- 8. דיווח יזום ← רענון ההדמיה ----
  await pg.evaluate(() => { S3UI.X.tab = 'map'; rerender(); }); await sleep(1500);
  const sc0 = await pg.evaluate(() => window.__os); await pg.evaluate(() => { S3UI.X.pick = { id: 'f1-a-1', fx: 'f1', s: 'a', n: 1, num: 1 }; ACT.s3kOpen(); }); await sleep(1500);
  const img = await pg.evaluate((b) => b, S.jpg); await pg.setInputFiles('input[data-c=s3kPick]', { name: 'a.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(await pg.evaluate(() => { const c = document.createElement('canvas'); c.width = 1200; c.height = 900; const x = c.getContext('2d'); for (let i = 0; i < 60; i++) for (let j = 0; j < 45; j++) { x.fillStyle = `rgb(${(i * 37 + j * 11) % 256},${(i * 17 + j * 53) % 256},${(i * 71 + j * 29) % 256})`; x.fillRect(i * 20, j * 20, 20, 20); } return c.toDataURL('image/jpeg', .9).split(',')[1]; }), 'base64') }); await sleep(3500);
  const sc1 = await pg.evaluate(() => ({ os: window.__os, d: S3UI.data() && S3UI.data().sum && S3UI.data().sum.score }));
  check('8 אחרי דיווח יזום: הסיכום נטען מחדש וההדמיה נפתחת עם הציון החדש', sc0 === 80 && sc1.d === 90 && sc1.os === 90, { sc0, sc1 });
  await pg.evaluate(() => { go('st3e'); }); await sleep(1200); await pg.evaluate(() => { const b = document.querySelector('[data-a=s3eSec][data-k=ver]'); if (b) b.click(); }); await sleep(1200);
  t = await txt(pg, '#main');
  check('13 גרסאות קודמות: by=system מוצג "ניקוי אוטומטי", ובגרסה אחרת לא', /גרסה 1 · ניקוי אוטומטי/.test(t) && !/גרסה 2 · ניקוי אוטומטי/.test(t), t.slice(0, 400));
  await M.ctx.close();
  // ---- 9. עובד ----
  const Wk = await open(browser, www, cM(), 'w@x.co', true); const wp = Wk.page;
  await wp.evaluate(() => { WS = 'home'; NAV = [{ v: 'wk' }]; render(0); }); await sleep(1200); S.reads.length = 0; S.calls.length = 0; await wp.evaluate(() => { go('st3'); }); await sleep(2000);
  t = await txt(wp, '#main');
  check('9 עובד: במסך המפה רואה משימת תיקון עם כפתור צילום אימות, ובלשוניות "הדוח שלי" בלבד (בלי המלצות והגדרות)', /משימות תיקון \(1\)/.test(t) && /צלמו לאימות/.test(t) && /הדוח שלי/.test(t) && !/הגדרות/.test(await txt(wp, '.s3tabs')) && !/המלצות/.test(await txt(wp, '.s3tabs')), t.slice(0, 400)); await shot(wp, fp(shots, 'עובד-תיקון'));
  await wp.setInputFiles('input[data-c=s3rVPick]', { name: 'a.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(await wp.evaluate(() => { const c = document.createElement('canvas'); c.width = 1200; c.height = 900; const x = c.getContext('2d'); for (let i = 0; i < 60; i++) for (let j = 0; j < 45; j++) { x.fillStyle = `rgb(${(i * 37 + j * 11) % 256},${(i * 17 + j * 53) % 256},${(i * 71 + j * 29) % 256})`; x.fillRect(i * 20, j * 20, 20, 20); } return c.toDataURL('image/jpeg', .9).split(',')[1]; }), 'base64') }); await sleep(3500);
  const vc = S.calls.find((c) => c.fn === 'shelfCheck');
  check('9א צילום אימות: shelfCheck mode=verify עם fix, slot של המשימה, qid, תמונה ומוקטנת; והתוצאה "תוקנה" מוצגת', vc && vc.b.mode === 'verify' && vc.b.fix === 'f_m2' && vc.b.slot === 'f1-a-2_a' && /^[A-Za-z0-9-]{16,40}$/.test(vc.b.qid) && vc.b.img.length > 1000 && vc.b.th.length > 500 && /הבעיה תוקנה/.test(await txt(wp, '#main')), vc && Object.keys(vc.b));
  await wp.evaluate(() => { S3UI.X.tab = 'rep'; rerender(); }); await sleep(2000); t = await txt(wp, '#main');
  check('9ב "הדוח שלי": רק הנתונים של עצמו (דקות עבודה 95), ציון הסבב הפתוח 77, מדף עם בעיה וכפתור "זו טעות"', /דקות עבודה 95/.test(t) && /ציון הסבב 77/.test(t) && /אין מחיר על המדף/.test(t) && /זו טעות/.test(t), t.slice(0, 500)); await shot(wp, fp(shots, 'עובד-דוח'));
  const bad = S.reads.filter((r) => /srun( |\?|$)|\/ai|s3fix|s3appeal|s3short|s3perf\/(?!w\/)|^GET staff$|s3use/.test(r.replace(/^GET /, '')) && !/^GET s3perf\/w\//.test(r));
  check('9ג העובד לא קורא נתוני מנהל או עובדים אחרים: אין בקשות לרשימת הסבבים, תוצאות AI, משימות/ערעורים של אחרים, חוסרים, מכסה ועובדים', !bad.length, bad);
  S.writes.length = 0; await wp.click('[data-a=s3rAppeal][data-slot="f1-a-1_a"][data-ik="0"]'); await sleep(300); await wp.fill('#s3rat', 'המחיר קיים'); await wp.click('[data-a=s3rApGo]'); await sleep(800);
  check('9ד עובד מערער: POST ל-s3appeal עם by=w', S.writes.some((w) => w.m === 'POST' && w.id === 'run_open__f1-a-1_a__0' && w.f.by === 'w'), S.writes);
  const ovw = await noOverflow(wp); check('9ה 360px: אין גלישה לרוחב אצל העובד', ovw.sw <= ovw.W + 1 && !ovw.bad.length, ovw);
  check('12 עובד: "הסבבים הקודמים שלי" מציג 2 סבבים מ-past (החדש קודם) והדיווח היזום מסומן', await wp.evaluate(() => { const e = [...document.querySelectorAll('#main [data-past]')]; return e.length === 2 && e[0].dataset.past === 'run_p2' && /סבב/.test(e[0].innerText) && /דיווח יזום/.test(e[1].innerText) && /יזום/.test(e[1].querySelector('.chip').innerText); }), t.slice(0, 600));
  check('12א עובד: אין כפתור "שאלו את המזכירה"', !(await wp.$('#main [data-a=secOpen]')));
  await shot(wp, fp(shots, 'הדוח-שלי'));
  S.past = []; await wp.evaluate(() => { S3UI.X.runsAt = 0; S3UI.loadRuns(true); }); await sleep(1200);
  check('12ב עובד בלי past: הודעה בעברית ובלי נתוני דוגמה', /עוד אין סבבים קודמים/.test(await txt(wp, '#main')) && !(await wp.$('[data-past]')));
  await Wk.ctx.close();
  // ---- 10. תוסף כבוי ----
  const Off = await open(browser, www, Object.assign(cM(), { biz: { 'biz-s': { dataRoot: 'b', features: {}, name: 'x' } } }), 'm@x.co', true); const rq = [];
  Off.page.on('request', (r) => { if (/\/srun|\/s3fix|\/s3appeal|\/s3short|\/s3perf|\/s3set|s3View/.test(r.url())) rq.push(r.url()); });
  await Off.page.evaluate(() => { S3UI.X.tab = 'rep'; go('st3'); }); await sleep(1500);
  check('10 תוסף כבוי: אין בקשות לדוחות', rq.length === 0, rq);
  await Off.ctx.close(); await browser.close();
  if (out) fs.writeFileSync(out, JSON.stringify({ fail, res }, null, 1));
  console.log(fail ? 'נכשלו ' + fail : 'כל הבדיקות עברו (' + res.length + ')'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
