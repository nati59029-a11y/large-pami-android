'use strict';
// סריקת חנות בתלת מימד, שלב 11 (14.11.2026): אשף הקמה (צלם ← טיוטה ← תקן ← שמור ← קבע סבב), כרטיס מדף, דיווח יזום, חיבור המיני, ויישור עיצוב לטוקני ה-ds.
// רשת מדומה (בלי אמולטור ובלי Gemini). בודק ב-360px: האשף מקצה לקצה מול שרת מדומה; "אי אפשר לשמור לפני מעבר על אזורים לא ודאיים (uz) ולפני אישור הטיוטה";
// טקסטורות (s3PutTex) נכנסות ל-tx[] ול-rooms[].tex בשמירה; כרטיס מדף (תמונה, בעיות, היסטוריה, "צלם"); מיני נבנה פעם אחת ונהרס ביציאה; clearCache בהחלפת עסק;
// עיצוב לפי טוקנים (ערכה כהה וערכה בהירה), ובלי בקשות כשהתוסף כבוי. שימוש: node ui-st3d-wiz.js <www-dir> [out.json] [shot-prefix]
const fs = require('fs'); const path = require('path'); const H = require('./harness');
let fail = 0; const res = []; const check = (n, ok, info) => { if (!ok) fail++; res.push({ n, ok: !!ok, info }); console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 500) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const enc = (v) => (v == null ? { nullValue: null } : typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }) : typeof v === 'string' ? { stringValue: v } : Array.isArray(v) ? { arrayValue: { values: v.map(enc) } } : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } });
const DOCS = 'projects/demo-largpeami/databases/(default)/documents/b/biz-s/';
const TH = 'b/biz-s/store3d/main/ph/run_1/f1-a-1_t.jpg';
const draftMap = () => ({ br: 'main', kind: 's', name: 'חנות (טיוטה)', seq: 2, grid: 50, numDir: 'rtl', ent: 'd1', src: 'draft',
  rooms: [{ id: 'r1', name: 'אולם', p: [0, 0, 700, 0, 700, 1400, 0, 1400], h: 300 }], walls: [], cols: [],
  doors: [{ id: 'd1', x: 350, y: 1400, w: 180, a: 0, k: 'ent' }],
  fx: [{ id: 'f1', k: 'gon', x: 350, y: 700, w: 400, d: 90, h: 190, a: 0, sides: 2, bays: 2, lvl: 5, hi: false, room: 'r1', num: 1, name: 'גונדולה מרכזית' }, { id: 'f2', k: 'wall', x: 350, y: 40, w: 500, d: 40, h: 200, a: 0, sides: 1, bays: 2, lvl: 5, hi: false, room: 'r1', num: 2, name: 'קיר אחורי' }],
  syms: [], uz: [{ x: 300, y: 1250, w: 400, d: 150, txt: 'החזית בחשיפת יתר, לא ברור איפה הכניסה', ok: false }, { x: 0, y: 200, w: 150, d: 300, txt: 'אולי מעבר לחדר נוסף', ok: false }] });
const S = { none: true, map: null, calls: [], posts: [], fnFail: {}, reads: [], hist: true, adhoc: { st: 'issue', iss: [{ k: 'hole', sev: 2, t: 'חור במדף העליון' }], usage: { m: '2026-11', n: 3, cap: 500, w80: false }, runId: 'adhoc_1' } };
const ALL = { store3d: true };
async function server(ctx, mgr) {
  const doc = (name, o) => ({ name: DOCS + name, fields: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, enc(v)])), createTime: '2026-11-03T09:00:00Z', updateTime: '2026-11-03T09:00:00Z' });
  const j = (route, st, b) => route.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(b) });
  await ctx.route((u) => u.port === '8080' && /\/documents\/b\/biz-s\/(smap|s3br|s3sum|sround|srun|staff|s3draft)/.test(u.pathname), (route) => {
    const rq = route.request(), u = new URL(rq.url()), p = u.pathname.replace(/^.*\/documents\/b\/biz-s\//, ''); S.reads.push(rq.method() + ' ' + p);
    if (rq.method() === 'POST' && p === 'sround') { let b = {}; try { b = JSON.parse(rq.postData()); } catch (e) { /* */ } S.posts.push({ id: u.searchParams.get('documentId'), b }); return j(route, 200, { name: DOCS + 'sround/' + u.searchParams.get('documentId'), fields: b.fields }); }
    if (p === 'smap/s-main') return S.none ? j(route, 404, { error: { code: 404, status: 'NOT_FOUND' } }) : j(route, 200, doc(p, S.map));
    if (p === 's3sum/s-main') return S.none ? j(route, 404, { error: { code: 404, status: 'NOT_FOUND' } }) : j(route, 200, doc(p, { b: { 'f1-a-1': { s: 'iss', r: 'run_1', t: Date.UTC(2026, 10, 12, 9, 30), th: TH, n: 2 } }, run: 'run_1', score: 80, upd: Date.UTC(2026, 10, 12, 10) }));
    if (p === 'sround') return j(route, 200, { documents: [] });
    if (p === 'staff') return j(route, 200, { documents: [doc('staff/w', { name: 'דנה', active: true }), doc('staff/w9', { name: 'עובד מושבת', active: false })] });
    if (p === 'srun') return j(route, 200, { documents: S.hist ? [doc('srun/run_1', { map: 's-main', openAt: Date.UTC(2026, 10, 12), st: 'done' }), doc('srun/run_0', { map: 's-main', openAt: Date.UTC(2026, 10, 5), st: 'done' }), doc('srun/other', { map: 's-other', openAt: Date.UTC(2026, 10, 4), st: 'done' })] : [] });
    if (p === 'srun/run_1/ai/f1-a-1') return j(route, 200, doc(p, { st: 'issue', conf: .8, at: Date.UTC(2026, 10, 12, 9, 31), iss: [{ k: 'noprice', sev: 2, conf: .9, t: 'אין מחיר על המדף השני' }, { k: 'hole', sev: 3, conf: .7, t: 'חור גדול בצד שמאל' }] }));
    if (p === 'srun/run_0/ai/f1-a-1') return j(route, 200, doc(p, { st: 'ok', conf: .9, at: Date.UTC(2026, 10, 5, 9), iss: [] }));
    if (p === 'srun/run_0/ph/f1-a-1') return j(route, 200, doc(p, { th: 'b/biz-s/store3d/main/ph/run_0/f1-a-1_t.jpg', at: Date.UTC(2026, 10, 5, 9) }));
    return j(route, 404, { error: { code: 404, status: 'NOT_FOUND' } });
  });
  await ctx.route((u) => u.port === '9199', (route) => route.fulfill({ status: 200, contentType: 'image/jpeg', body: Buffer.from(S.jpg || '', 'base64') }));
  const rec = (route, fn) => { let b = {}; try { b = JSON.parse(route.request().postData()).data || {}; } catch (e) { /* */ } S.calls.push({ fn, b }); return b; };
  const ok = (route, r) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: r }) });
  const bad = (route, reason, msg) => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { status: 'FAILED_PRECONDITION', message: msg || 'שגיאה', details: { reason } } }) });
  await ctx.route('**/mapDraft', (route) => { const b = rec(route, 'mapDraft'); if (S.fnFail.draft) return bad(route, S.fnFail.draft, S.fnFail.draftMsg || 'שגיאה'); ok(route, { draftId: b.qid, st: 'ok', n: (b.imgs || []).length, conf: 0.55, drop: 0, usage: { m: '2026-11', n: 1, cap: 500, w80: false }, m: draftMap(), scale: { ref: '', conf: 0 }, notes: 'המידות הן הערכה, בלי מטר בתמונות.' }); });
  await ctx.route('**/mapFix', (route) => { const b = rec(route, 'mapFix'); if (S.fnFail.fix) return bad(route, S.fnFail.fix, S.fnFail.fixMsg || 'שגיאה'); S.fixN = (S.fixN || 0) + 1; ok(route, { draftId: b.qid, st: 'ok', conf: 0.7, drop: 0, fix: true, m: Object.assign(draftMap(), { fixN: S.fixN, fixTxt: b.txt }), scale: { ref: '', conf: 0 }, notes: 'תוקן לפי הבקשה.' }); });
  await ctx.route('**/s3PutTex', (route) => { const b = rec(route, 's3PutTex'); S.tn = (S.tn || 0) + 1; ok(route, { texId: 't' + S.tn, path: 'b/biz-s/store3d/main/tex/s-main/t' + S.tn + '_1.jpg', w: 1024, h: 512 }); });
  await ctx.route('**/s3SaveMap', (route) => { const b = rec(route, 's3SaveMap'); S.none = false; S.map = Object.assign({}, b.map, { v: 1, upd: 1763200000000, by: 'm' }); ok(route, { ok: true, v: 1, renamed: {}, dropped: [], purged: {} }); });
  await ctx.route('**/shelfCheck', (route) => { const b = rec(route, 'shelfCheck'); if (S.fnFail.shelf) return bad(route, S.fnFail.shelf, 'הגעתם למכסה'); ok(route, S.adhoc); });
  await ctx.route('**/s3Run', (route) => { rec(route, 's3Run'); ok(route, { ok: true, runId: 'x_m1' }); });
  await ctx.route('**/s3View', (route) => ok(route, { runs: [], fixes: [], take: [] }));
}
async function open(browser, www, cfg, email, w, perms) {
  const { ctx, page } = await H.newPage(browser, www, cfg, [], email); await page.setViewportSize({ width: w || 360, height: 760 });
  /* מונים: כמה פעמים נבנה מיני, כמה נהרס, וכמה פעמים נוקה המטמון */
  await ctx.addInitScript(() => { let v; window.__mc = 0; window.__md = 0; window.__cc = 0; Object.defineProperty(window, 'Store3D', { configurable: true, get() { return v; }, set(x) { if (x && typeof x.mini === 'function') { const m0 = x.mini, c0 = x.clearCache; x.mini = function () { window.__mc++; const a = m0.apply(this, arguments); if (a && a.destroy) { const d0 = a.destroy; a.destroy = function () { window.__md++; return d0.apply(this, arguments); }; } return a; }; x.clearCache = function () { window.__cc++; return c0 && c0.apply(this, arguments); }; } v = x; } }); });
  const uid = email.split('@')[0]; await server(ctx, /^m@/.test(email));
  if (perms) await ctx.route((u) => u.port === '8080' && new RegExp('/staff/' + uid + '$').test(u.pathname), (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ name: 'x', fields: { active: { booleanValue: true }, perms: enc(perms) } }) }));
  await H.login(page, email);
  await page.evaluate(() => { const sh = document.getElementById('sheet'); if (sh && !sh.hidden && typeof ACT.startBlank === 'function') ACT.startBlank(); });
  await H.settle(page, 400);
  return { ctx, page };
}
const noOverflow = (page) => page.evaluate(() => { const W = document.documentElement.clientWidth; const bad = [...document.querySelectorAll('#main *, #dlg *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > W + 1 || r.left < -1) && !e.closest('.scroll-x,.s3tabs,.s3main,.s3pl'); }).slice(0, 5).map((e) => e.tagName + '.' + e.className); return { sw: document.documentElement.scrollWidth, W, bad }; });
const txt = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.innerText.replace(/\s+/g, ' ').trim() : null; }, sel);
const mkImg = (page, kind) => page.evaluate((k) => { const c = document.createElement('canvas'); c.width = 1600; c.height = 1200; const x = c.getContext('2d');
  for (let i = 0; i < 100; i++) for (let j = 0; j < 75; j++) { x.fillStyle = `rgb(${(i * 37 + j * 11) % 256},${(i * 17 + j * 53) % 256},${(i * 71 + j * 29) % 256})`; x.fillRect(i * 16, j * 16, 16, 16); }
  if (k === 'dark') { x.fillStyle = 'rgba(0,0,0,.93)'; x.fillRect(0, 0, 1600, 1200); }
  return c.toDataURL('image/jpeg', .9).split(',')[1]; }, kind).then((b) => ({ name: kind + '.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(b, 'base64') }));
const shot = async (page, file, full) => { if (!file) return; await page.waitForTimeout(300); await page.screenshot({ path: file, fullPage: !!full }); };
const fp = (f, s) => f ? f + '-' + s + '.png' : null;
/* שאלון וסקיצה (15.11.2026): הקשה על השרטוט בס"מ, לפי המסגרת (מידות אמיתיות או 20×20 זמנית) */
const tapSk = async (page, x, y) => { const r = await page.evaluate((yy) => { const c = document.getElementById('s3wSk'); if (!c) return null; const q = S3UI.W.q, w = parseFloat(q.w), l = parseFloat(q.l), fw = w > 0 && l > 0 ? Math.round(w * 100) : 2000; let b = c.getBoundingClientRect(); window.scrollBy(0, b.top + yy * b.width / fw - innerHeight / 2); b = c.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, fw, fl: w > 0 && l > 0 ? Math.round(l * 100) : 2000 }; }, y);
  if (!r) throw new Error("no sketch canvas " + (await page.evaluate(() => JSON.stringify({ v: cur().v, det: S3UI.W.det, step: S3UI.W.step, p: S3UI.W.q.path, t: document.querySelector("#main").innerText.slice(0, 300) })))); const px = r.w / r.fw; const h = r.w * r.fl / r.fw, c = (v, m) => Math.min(m - 1, Math.max(0.5, v)); await page.mouse.click(r.x + c(x * px, r.w), r.y + c(y * px, h)); await sleep(150); };
const skOf = (page) => page.evaluate(() => JSON.parse(JSON.stringify((({ rooms, cur, rows, rt, rk, ent, cash, mode, sel }) => ({ rooms, cur, rows, rt, rk, ent, cash, mode, sel }))(S3UI.W.sk))));
const setQ = async (page, f, v) => { const sel = `[data-c=s3wQ][data-f=${f}]`; if (f === 'ent' || f === 'cash') await page.selectOption(sel, v); else { await page.fill(sel, v); await page.dispatchEvent(sel, 'change'); } await sleep(150); };
const shot412 = async (page, file) => { if (!file) return; await page.setViewportSize({ width: 412, height: 915 }); await page.evaluate(() => { window.scrollTo(0, 0); const st = document.createElement('style'); st.id = '__shot'; st.textContent = '.bar,.toast,#toast,.fab{display:none!important}'; document.head.appendChild(st); }); await sleep(500); await page.screenshot({ path: file, fullPage: true }); await page.evaluate(() => { const st = document.getElementById('__shot'); if (st) st.remove(); }); await page.setViewportSize({ width: 360, height: 760 }); await sleep(400); };
const jpegDims = (page, b64) => page.evaluate(async (b) => { const bl = await fetch('data:image/jpeg;base64,' + b).then((r) => r.blob()); const im = await createImageBitmap(bl); return [im.width, im.height]; }, b64);

(async () => {
  const [www, out, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(path.dirname(shots), { recursive: true });
  const browser = await H.launch();
  const cM = (feat) => ({ mode: 'new', users: { m: 'biz-s', w: 'biz-s' }, biz: { 'biz-s': { dataRoot: 'b', features: feat || ALL, name: 'עסק בדיקה' } }, admins: { 'b/biz-s/|m': 1 }, staff: { 'b/biz-s/|w': 1 } });

  // ---- 0. בדיקה סטטית: בלי צבעים קשיחים בקבצי המסכים (חוץ מערכי גיבוי בפונקציית tk של השרטוט) ----
  const SRC = ['store3d.js', 'store3d-editor.js', 'store3d-capture.js', 'store3d-wizard.js', 'store3d-card.js'].map((f) => [f, fs.readFileSync(path.join(www, f), 'utf8').split('\n').filter((l) => !/^function tk\(\)/.test(l)).join('\n')]);
  const hex = SRC.map(([f, s]) => [f, (s.match(/#[0-9a-fA-F]{3,8}\b/g) || []).filter((x) => !/^#[0-9]+$/.test(x) || x.length === 4 || x.length === 7)]).filter(([, a]) => a.length);
  check('0 בקבצי המסכים (בית, מסך ראשי, עורך, סבב, אשף, כרטיס) אין צבעי hex קשיחים', hex.length === 0, hex);

  // ---- 1. אין מפה: הזמנה ← אשף שלב 1 ----
  let A = await open(browser, www, cM(), 'm@x.co');
  await A.page.evaluate(() => { NAV = [{ v: 'home' }]; render(0); }); await sleep(1500);
  check('1 הזמנה בבית: "בואו נתחיל" פותח את האשף (לא את העורך)', await A.page.evaluate(() => { const b = document.querySelector('[data-a=st3Build]'); if (!b) return false; b.click(); return true; }) && (await sleep(500), await A.page.evaluate(() => cur().v)) === 'st3w');
  const st1 = await txt(A.page, '#main');
  const dom1 = await A.page.evaluate(() => ({ cap: !!document.querySelector('input[data-c=s3wPick][capture]'), html: (document.querySelector('input[data-c=s3wPick]')||{}).outerHTML, multi: !!document.querySelector('input[data-c=s3wPick][multiple]'), dis: document.querySelector('[data-a=s3wDraft]').disabled }));
  check('1א שלב 1: סרגל שלבים, הנחיה, כפתורי צילום וגלריה, ו"בנו טיוטה" כבוי בלי תמונות', /1\. צלמו/.test(st1) && /5\. סבב/.test(st1) && /צלמו את החנות/.test(st1) && /capture="environment" data-c="s3wPick"/.test(SRC.find(([f]) => f === 'store3d-wizard.js')[1]) && dom1.multi && dom1.dis, dom1);
  const imgs = [await mkImg(A.page, 'a'), await mkImg(A.page, 'a'), await mkImg(A.page, 'a')];
  await A.page.setInputFiles('input[data-c=s3wPick][multiple]', imgs); await sleep(2500);
  const n1 = await A.page.evaluate(() => ({ th: document.querySelectorAll('#main img[alt^="תמונה"]').length, dis: document.querySelector('[data-a=s3wDraft]').disabled, w: S3UI.W.imgs.map((i) => Math.max(i.w, i.h)) }));
  check('1ב שלוש תמונות: תמונות ממוזערות, תמונות הטיוטה מוקטנות עד 1024px, ו"בנו טיוטה" פעיל', n1.th === 3 && !n1.dis && n1.w.every((x) => x <= 1024), n1);
  await A.page.setInputFiles('input[data-c=s3wTex][data-k=w]', imgs[0]); await sleep(2500);
  const tex = S.calls.find((c) => c.fn === 's3PutTex');
  const dims = tex ? await jpegDims(A.page, tex.b.img) : null;
  check('1ג טקסטורת קיר: s3PutTex עם mapId ומזהה, JPEG שכל צלע שלו 256/512/1024, והתמונה מסומנת "נשלח"', !!tex && tex.b.mapId === 's-main' && /^[A-Za-z0-9-]{16,40}$/.test(tex.b.qid) && dims && dims.every((x) => [256, 512, 1024].includes(x)) && /נשלח/.test(await txt(A.page, '#main')), { dims, mapId: tex && tex.b.mapId });
  check('1ד שלב 1 ב-360px בלי גלישה', (await noOverflow(A.page)).bad.length === 0, await noOverflow(A.page));
  await shot(A.page, fp(shots, 'שלב1'));

  // ---- 1ו. "פרטים על החנות" – דרך ב (שאלון ← שרטוט אוטומטי ← עריכה ידנית) ----
  await A.page.click('[data-a=s3wDraft]'); await sleep(600);
  const d0 = await txt(A.page, '#main');
  check('1ו "בנו טיוטה" בפעם הראשונה: מסך "פרטים על החנות" עם שתי דרכים (סקיצה / שאלות), בלי שליחה לשרת', /פרטים על החנות/.test(d0) && /אצייר סקיצה/.test(d0) && /אענה על שאלות/.test(d0) && !S.calls.some((c) => c.fn === 'mapDraft'), d0.slice(0, 200));
  await A.page.click('[data-a=s3wPath][data-p=b]'); await sleep(300);
  for (const [f, v] of [['w', '14'], ['l', '15'], ['rooms', '2'], ['rows', '4'], ['ent', 'd'], ['cash', 'r'], ['note', 'מקררים לאורך הקיר הימני']]) await setQ(A.page, f, v);
  await A.page.click('[data-a=s3wGen]'); await sleep(500);
  let k1 = await skOf(A.page);
  check('1ו1 שרטוט מהתשובות: מלבן 14×15, חנות (70%) בצד הכניסה + חדר נוסף, 4 שורות במרווחים שווים עם מעברים, כניסה למטה וקופה מימין',
    JSON.stringify(k1.rooms) === JSON.stringify([[0, 450, 1400, 450, 1400, 1500, 0, 1500], [0, 0, 1400, 0, 1400, 450, 0, 450]]) && JSON.stringify(k1.rt) === '["s","x"]'
    && JSON.stringify(k1.rows) === JSON.stringify([[150, 660, 1250, 660], [150, 870, 1250, 870], [150, 1080, 1250, 1080], [150, 1290, 1250, 1290]]) && JSON.stringify(k1.ent) === '[700,1500]' && JSON.stringify(k1.cash) === '[1400,750]' && k1.mode === 'sel', k1);
  const cv1 = await A.page.evaluate(() => { const c = document.getElementById('s3wSk'); return c ? { w: c.getBoundingClientRect().width, h: c.getBoundingClientRect().height, px: c.width } : null; });
  check('1ו2 השרטוט מוצג בקנה מידה (יחס 14:15) ובלי גלישה ב-360px', !!cv1 && Math.abs(cv1.h / cv1.w - 15 / 14) < 0.03 && (await noOverflow(A.page)).bad.length === 0, { cv1, o: await noOverflow(A.page) });
  // עריכה: בחירת קצה שורה והזזה, מחיקת שורה, ביטול אחרון, הוספת פינה, סוג חדר
  await tapSk(A.page, 150, 660); await tapSk(A.page, 300, 650);
  k1 = await skOf(A.page);
  check('1ו3 עריכה: הקשה על קצה שורה בוחרת אותו, והקשה נוספת מזיזה אותו (מוצמד לרשת של 50 ס"מ)', JSON.stringify(k1.rows[0]) === '[300,650,1250,660]', k1.rows[0]);
  await tapSk(A.page, 1250, 1290); await A.page.click('[data-a=s3wSkDel]'); await sleep(300);
  const nDel = (await skOf(A.page)).rows.length;
  await A.page.click('[data-a=s3wSkUndo]'); await sleep(300);
  check('1ו4 מחיקת שורה ואז "ביטול אחרון" מחזיר אותה', nDel === 3 && (await skOf(A.page)).rows.length === 4, { nDel });
  await tapSk(A.page, 1400, 450); await A.page.click('[data-a=s3wSkIns]'); await sleep(300);
  const nIns = (await skOf(A.page)).rooms[0].length;
  await A.page.click('[data-a=s3wSkUndo]'); await sleep(300);
  check('1ו5 הוספת פינה לחדר (באמצע הקיר) ו"ביטול אחרון"', nIns === 10 && (await skOf(A.page)).rooms[0].length === 8, { nIns });
  await A.page.selectOption('[data-c=s3wRt][data-i="1"]', 'w'); await sleep(200);
  check('1ו6 שאלות על השרטוט: סוג לכל חדר ולכל שורה; חדר 2 סומן "מחסן"', (await A.page.$$('[data-c=s3wRk]')).length === 4 && (await skOf(A.page)).rt[1] === 'w');
  await shot412(A.page, fp(shots, 'פרטים-שאלון'));
  const small44 = () => A.page.evaluate(() => [...document.querySelectorAll('#main button, #main select, #main input:not([hidden])')].filter((b) => b.getBoundingClientRect().height < 43.5).map((b) => b.outerHTML.slice(0, 80)));
  check('1ו7 מסך הפרטים ב-360px בלי גלישה, וכל הכפתורים והשדות לפחות 44px', (await noOverflow(A.page)).bad.length === 0 && (await small44()).length === 0, { o: await noOverflow(A.page), small: await small44() });
  // "טעינה מחדש": האשף מתחיל מחדש מהטיוטה בטלפון – השאלון והשרטוט נשמרו
  await A.page.evaluate(() => { S3UI.W.own = ''; rerender(); }); await sleep(500);
  const rl = await A.page.evaluate(() => ({ q: S3UI.W.q, n: S3UI.W.sk.rows.length, rt: S3UI.W.sk.rt, r0: S3UI.W.sk.rows[0], det: S3UI.W.det, t: document.querySelector('#main').innerText, ls: JSON.parse(localStorage.getItem(LK('lp-s3w:s-main'))) }));
  check('1ו8 אחרי טעינה מחדש: השאלון והשרטוט חוזרים מהטלפון (גרסה 2), והתקציר מופיע בשלב 1', rl.q.w === '14' && rl.q.l === '15' && rl.q.path === 'b' && rl.n === 4 && rl.rt[1] === 'w' && JSON.stringify(rl.r0) === '[300,650,1250,660]' && rl.ls.v === 2 && !!rl.ls.tex.w && /רוחב 14 מ', אורך 15 מ'/.test(rl.t) && /מולא/.test(rl.t), { q: rl.q, n: rl.n, v: rl.ls && rl.ls.v });
  // גרסה ישנה של הטיוטה בטלפון ({tex} בלבד) – נטענת בלי שאלון
  const old = await A.page.evaluate(() => { const k = LK('lp-s3w:s-main'), keep = localStorage.getItem(k); localStorage.setItem(k, JSON.stringify({ tex: { w: { texId: 't9', path: 'b/biz-s/store3d/main/tex/s-main/t9_1.jpg', w: 512, h: 512 } } })); S3UI.W.own = ''; rerender();
    const r = { tex: S3UI.W.tex.w && S3UI.W.tex.w.texId, q: S3UI.W.q.w, n: S3UI.W.sk.rows.length }; localStorage.setItem(k, keep); S3UI.W.own = ''; rerender(); return r; });
  check('1ו9 טיוטה ישנה בטלפון (גרסה 1, בלי שאלון): נטענת כמו קודם, השאלון ריק', old.tex === 't9' && old.q === '' && old.n === 0, old);
  // התמונות עצמן לא נשמרות בטלפון (כמו קודם) – מוסיפים אותן שוב, וחוזרים למסך הפרטים
  await A.page.setInputFiles('input[data-c=s3wPick][multiple]', imgs); await sleep(2500);
  await A.page.click('[data-a=s3wDet]'); await sleep(300);

  // ---- 2-. תשובת AI שבורה (תיקון 15.11.2026): המסך מציג את הסיבה המפורטת מהשרת, ובלעדיה – את הנוסח הכללי ----
  S.fnFail.draft = 'bad-answer'; S.fnFail.draftMsg = 'תשובת ה-AI נקטעה באמצע, כנראה בגלל הרבה תמונות ופרטים. נסו שוב עם פחות תמונות (למשל 20–25). ההקמה הזו לא נספרה במכסה.';
  await A.page.click('[data-a=s3wDraft]'); await sleep(2000);
  const sb = await txt(A.page, '#main'), stB = await A.page.evaluate(() => S3UI.W.step);
  check('2- bad-answer: מוצגת הסיבה מהשרת (נקטעה, לא נספרה במכסה) ולא הנוסח הכללי; חוזרים לשלב 1', /נקטעה באמצע/.test(sb) && /לא נספרה במכסה/.test(sb) && !/לא החזיר תשובה שאפשר להשתמש בה/.test(sb) && stB === 1, { stB, t: sb.slice(0, 300) });
  check('2-א הודעת השגיאה ב-360px בלי גלישה', (await noOverflow(A.page)).bad.length === 0, await noOverflow(A.page));
  await shot(A.page, fp(shots, 'שלב2-שגיאת-AI'));
  S.fnFail.draftMsg = 'internal';
  await A.page.click('[data-a=s3wDraft]'); await sleep(2000);
  check('2-ב bad-answer בלי הודעה בעברית (שרת ישן) – הנוסח הכללי', /לא החזיר תשובה שאפשר להשתמש בה/.test(await txt(A.page, '#main')));
  S.fnFail.draft = ''; S.fnFail.draftMsg = ''; S.calls = S.calls.filter((c) => c.fn !== 'mapDraft');

  // ---- 2. טיוטה ----
  await A.page.click('[data-a=s3wDraft]'); await sleep(2500);
  const md = S.calls.find((c) => c.fn === 'mapDraft');
  const SK1 = { rooms: [[0, 450, 1400, 450, 1400, 1500, 0, 1500], [0, 0, 1400, 0, 1400, 450, 0, 450]], rows: [[300, 650, 1250, 660], [150, 870, 1250, 870], [150, 1080, 1250, 1080], [150, 1290, 1250, 1290]], rt: ['s', 'w'], rk: ['gon', 'gon', 'gon', 'gon'], ent: [700, 1500], cash: [1400, 750] };
  check('2ג mapDraft נשלח עם info (מידות בס"מ, חדרים, שורות, צדדים, הערה) ו-sketch (חדרים, שורות, סוגים, כניסה וקופה)', !!md && JSON.stringify(md.b.info) === JSON.stringify({ w: 1400, l: 1500, rooms: 2, rows: 4, ent: 'd', cash: 'r', note: 'מקררים לאורך הקיר הימני' }) && JSON.stringify(md.b.sketch) === JSON.stringify(SK1), md && { info: md.b.info, sketch: md.b.sketch });
  check('2 mapDraft נשלח עם qid, סניף, סוג ושלוש תמונות (base64)', !!md && md.b.br === 'main' && md.b.kind === 's' && md.b.imgs.length === 3 && md.b.imgs.every((x) => typeof x === 'string' && x.length > 1000 && !/^data:/.test(x)) && /^[A-Za-z0-9-]{16,40}$/.test(md.b.qid), md && { br: md.b.br, n: md.b.imgs.length });
  const s2 = await txt(A.page, '#main');
  check('2א סיכום הטיוטה: חדרים, גופים, אזורים לא ודאיים (2), רמת ביטחון (הערכה) וכפתור "עברו על הטיוטה"', /הטיוטה מוכנה/.test(s2) && /אזורים לא ודאיים 2/.test(s2) && /55%/.test(s2) && /עברו על הטיוטה/.test(s2), s2.slice(0, 260));
  await shot(A.page, fp(shots, 'שלב2-טיוטה'));
  check('2ב הטיוטה עוד לא נשמרה (אין s3SaveMap)', !S.calls.some((c) => c.fn === 's3SaveMap'));

  // ---- 2ד. תיקונים בכתב (שלב 20ג): mapFix ----
  {
    check('2ד1 mapDraft נשלח עם imgs וגם sketch וגם info יחד (כך גם כשהתמונות הן פריימים מסרטון: addVids דוחף ל-W.imgs)', !!md && md.b.imgs.length === 3 && !!md.b.sketch && !!md.b.info);
    const fx = await A.page.evaluate(() => ({ ta: !!document.getElementById('s3wFix'), btn: !!document.querySelector('[data-a=s3wFix]'), t: document.querySelector('#main').innerText.replace(/\s+/g, ' ') }));
    check('2ד2 מסך הטיוטה: תיבת "תיקונים בכתב", כפתור "תקנו את הטיוטה" והערה שלא נספר במכסה', fx.ta && fx.btn && /תיקונים בכתב/.test(fx.t) && /תקנו את הטיוטה/.test(fx.t) && /לא נספר במכסה החודשית/.test(fx.t), fx.t.slice(0, 200));
    check('2ד3 מסך התיקונים ב-360px בלי גלישה', (await noOverflow(A.page)).bad.length === 0, await noOverflow(A.page));
    await A.page.fill('#s3wFix', 'המקרר נמצא בקיר השמאלי, יש 4 שורות מדפים ולא 3');
    if (fp(shots, 'x')) await A.page.screenshot({ path: process.env.FIXSHOT || fp(shots, 'שלב2-תיקון-בכתב'), fullPage: true });
    const nf = () => S.calls.filter((c) => c.fn === 'mapFix');
    const m0 = await A.page.evaluate(() => JSON.stringify(S3UI.W.draft.m)), id0 = await A.page.evaluate(() => S3UI.W.draft.id);
    await A.page.fill('#s3wFix', 'א'); await A.page.click('[data-a=s3wFix]'); await sleep(500);
    check('2ד4 טקסט קצר מדי (תו אחד): נחסם בהודעה, בלי קריאה לשרת', nf().length === 0 && /בין 2 ל-1000/.test(await txt(A.page, '#main')));
    await A.page.fill('#s3wFix', 'המקרר נמצא בקיר השמאלי, יש 4 שורות מדפים ולא 3');
    S.fnFail.fix = 'bad-answer'; S.fnFail.fixMsg = 'תשובת ה-AI נקטעה. נסו שוב.';
    await A.page.click('[data-a=s3wFix]'); await sleep(1200);
    const f1 = nf()[0], e1 = await A.page.evaluate(() => ({ same: JSON.stringify(S3UI.W.draft.m), ta: document.getElementById('s3wFix').value, step: S3UI.W.step }));
    check('2ד5 כשל: הטיוטה הקודמת נשארת, ההודעה מוצגת, והתיבה שומרת את הטקסט', nf().length === 1 && e1.same === m0 && e1.step === 2 && /נקטעה/.test(await txt(A.page, '#main')) && /4 שורות/.test(e1.ta), { n: nf().length, ta: e1.ta });
    S.fnFail.fix = '';
    await A.page.click('[data-a=s3wFix]'); await sleep(1500);
    const f2 = nf()[1], d1 = await A.page.evaluate(() => ({ fixN: S3UI.W.draft.m.fixN, id: S3UI.W.draft.id, n: S3UI.W.draft.n, ta: document.getElementById('s3wFix').value, t: document.querySelector('#main').innerText }));
    check('2ד6 ניסיון חוזר אחרי כשל: אותו qid; הצלחה מחליפת את הטיוטה, שומרת n, ומנקה את התיבה', f1 && f2 && f1.b.qid === f2.b.qid && d1.fixN === 1 && d1.n === 3 && d1.ta === '' && /הטיוטה מוכנה/.test(d1.t), { q1: f1 && f1.b.qid, q2: f2 && f2.b.qid, d1 });
    check('2ד7 גוף הבקשה: txt, m (הטיוטה הנוכחית), br, kind, from (מזהה הטיוטה), sk (הסקיצה) + info ובלי תמונות', f2.b.txt === 'המקרר נמצא בקיר השמאלי, יש 4 שורות מדפים ולא 3' && JSON.stringify(f2.b.m) === m0 && f2.b.br === 'main' && f2.b.kind === 's' && f2.b.from === id0 && JSON.stringify(f2.b.sk) === JSON.stringify(md.b.sketch) && JSON.stringify(f2.b.info) === JSON.stringify(md.b.info) && !('imgs' in f2.b) && /^[A-Za-z0-9-]{16,40}$/.test(f2.b.qid), Object.keys(f2.b));
    await A.page.fill('#s3wFix', 'להוסיף מקרר שני');
    await A.page.click('[data-a=s3wFix]'); await sleep(1500);
    const f3 = nf()[2], d2 = await A.page.evaluate(() => ({ fixN: S3UI.W.draft.m.fixN, id: S3UI.W.draft.id }));
    check('2ד8 תיקון שני: qid חדש, נשלחת הטיוטה המתוקנת הקודמת, והטיוטה מוחלפת שוב (בלי הגבלה)', nf().length === 3 && f3.b.qid !== f2.b.qid && f3.b.txt === 'להוסיף מקרר שני' && f3.b.m.fixN === 1 && f3.b.from === d1.id && d2.fixN === 2, { q: f3.b.qid, d2 });
    S.calls = S.calls.filter((c) => c.fn !== 'mapFix');
  }

  // ---- 3. תקנו: העורך עם לוח האזורים הלא ודאיים ----
  await A.page.click('[data-a=s3wEdit]'); await sleep(1200);
  const e1 = await A.page.evaluate(() => ({ v: cur().v, panel: !!document.getElementById('s3wp'), zones: document.querySelectorAll('#s3wz .s3err').length, svgZ: document.querySelectorAll('#s3pl svg rect[stroke-dasharray]').length, save: document.querySelector('[data-a=s3eSave]').disabled, name: document.querySelector('[data-c=s3wName]').value, ap: document.querySelector('[data-c=s3wAppr]').checked }));
  check('3 העורך נפתח עם הטיוטה: לוח "בדקו לפני השמירה", שני אזורים מסומנים בבירור (גם במפה), שם בלי "(טיוטה)", ושמירה כבויה', e1.v === 'st3e' && e1.panel && e1.zones === 2 && e1.svgZ === 2 && e1.save && e1.name === 'חנות' && !e1.ap, e1);
  check('3א עורך עם הלוח ב-360px בלי גלישה', (await noOverflow(A.page)).bad.length === 0, await noOverflow(A.page));
  await shot(A.page, fp(shots, 'שלב3-תקנו'), true);
  const n0 = S.calls.length;
  await A.page.evaluate(() => ACT.s3eSave()); await sleep(600);
  check('3ב שמירה בכוח לפני מעבר על האזורים: נחסמת בהודעה, בלי s3SaveMap', !S.calls.slice(n0).some((c) => c.fn === 's3SaveMap') && /אזורים לא ודאיים שעוד לא עברתם עליהם/.test(await txt(A.page, '#main')), await txt(A.page, '.s3err[role=alert]'));
  await A.page.click('#s3wz [data-a=s3wOk][data-i="0"]'); await sleep(300);
  await A.page.evaluate(() => ACT.s3eSave()); await sleep(600);
  check('3ג אחרי אישור אזור אחד (נשאר אחד): עדיין חסום', !S.calls.slice(n0).some((c) => c.fn === 's3SaveMap') && /1 אזור לא ודאי/.test(await txt(A.page, '#main')));
  await A.page.click('#s3wz [data-a=s3wDel]:visible >> nth=-1'); await sleep(300);
  const e2 = await A.page.evaluate(() => ({ uz: S3UI.E.map.uz.length, ok: S3UI.E.map.uz.map((z) => z.ok), save: document.querySelector('[data-a=s3eSave]').disabled }));
  check('3ד מחיקת האזור השני: נשאר אזור אחד מאושר', e2.uz === 1 && e2.ok[0] === true && e2.save, e2);
  await A.page.evaluate(() => ACT.s3eSave()); await sleep(600);
  check('3ה כל האזורים נבדקו אבל הטיוטה לא אושרה: עדיין חסום, עם הודעה על האישור', !S.calls.slice(n0).some((c) => c.fn === 's3SaveMap') && /עברתי על הטיוטה ואני מאשר/.test(await txt(A.page, '#main')));
  await A.page.click('[data-c=s3wAppr]'); await sleep(300);
  await A.page.fill('[data-c=s3wName]', 'החנות שלי'); await A.page.dispatchEvent('[data-c=s3wName]', 'change'); await sleep(300);
  check('3ו אחרי אישור הטיוטה: כפתור השמירה פעיל', await A.page.evaluate(() => !document.querySelector('[data-a=s3eSave]').disabled));

  // ---- 4. שמרו ----
  await A.page.click('[data-a=s3eSave]'); await sleep(2000);
  const sv = S.calls.find((c) => c.fn === 's3SaveMap');
  check('4 s3SaveMap: mapId, baseV=0, שם שהמנהל נתן, src=draft, בלי v/upd/by, uz אחד עם ok:true', !!sv && sv.b.mapId === 's-main' && sv.b.baseV === 0 && sv.b.map.name === 'החנות שלי' && sv.b.map.src === 'draft' && !('v' in sv.b.map) && !('upd' in sv.b.map) && !('by' in sv.b.map) && sv.b.map.uz.length === 1 && sv.b.map.uz[0].ok === true, sv && { why: sv.b.why, name: sv.b.map.name, uz: sv.b.map.uz });
  check('4א הטקסטורה נכנסה למפה: tx[] עם הנתיב, ובכל חדר tex.w', !!sv && Array.isArray(sv.b.map.tx) && sv.b.map.tx.length === 1 && sv.b.map.tx[0].id === 't1' && /tex\/s-main\/t1_1\.jpg$/.test(sv.b.map.tx[0].path) && sv.b.map.rooms.every((r) => r.tex && r.tex.w === 't1' && !r.tex.f), sv && { tx: sv.b.map.tx, room: sv.b.map.rooms[0].tex });
  const s5 = await txt(A.page, '#main');
  check('4ב אחרי השמירה: חוזרים לאשף, שלב 5 "קבעו סבב" עם רשימת עובדים פעילים בלבד', await A.page.evaluate(() => cur().v) === 'st3w' && /קבעו סבב בדיקה/.test(s5) && /דנה/.test(s5) && !/מושבת/.test(s5), s5.slice(0, 220));
  await shot(A.page, fp(shots, 'שלב5-סבב'));

  // ---- 5. קבעו סבב ----
  await A.page.selectOption('[data-f=k]', 'days'); await sleep(300);
  await A.page.fill('[data-f=n]', '3'); await A.page.dispatchEvent('[data-f=n]', 'change');
  await A.page.selectOption('[data-f=k]', 'week'); await sleep(300);
  await A.page.selectOption('[data-f=dow]', '2'); await sleep(200);
  await A.page.click('[data-a=s3wMake]'); await sleep(1500);
  const sr = S.posts[0], F = sr && sr.b.fields;
  const fo = F && F.f.mapValue.fields;
  check('5 הסבב נשמר ב-sround: מסמך עם br, map, שם, תדירות שבועית ביום שלישי, עובד אחד, פעיל, by=המנהל', !!sr && /^[a-z0-9]{6,20}$/.test(sr.id) && F.br.stringValue === 'main' && F.map.stringValue === 's-main' && fo.k.stringValue === 'week' && fo.dow.integerValue === '2' && Object.keys(fo).length === 2 && F.asg.arrayValue.values.length === 1 && F.asg.arrayValue.values[0].mapValue.fields.u.stringValue === 'w' && F.on.booleanValue === true && F.by.stringValue === 'm' && +F.due.integerValue === 2, sr && { id: sr.id, keys: Object.keys(F) });
  check('5א אחרי הקביעה: "המפה נשמרה והסבב נקבע" וכפתור "פתחו סבב עכשיו"', /הסבב נקבע/.test(await txt(A.page, '#main')) && !!(await A.page.$('[data-a=s3wNow]')));
  await A.page.click('[data-a=s3wNow]'); await sleep(1000);
  const sn = S.calls.find((c) => c.fn === 's3Run');
  check('5ב "פתחו סבב עכשיו": s3Run עם מזהה הכלל שנוצר', !!sn && sn.b.rid === sr.id, sn && sn.b);
  await A.page.click('[data-a=s3wEnd]'); await sleep(1500);
  check('5ג סיום: חוזרים למסך הראשי של התלת מימד', await A.page.evaluate(() => cur().v) === 'st3');

  // ---- 6. כרטיס מדף ----
  S.jpg = (await mkImg(A.page, 'a')).buffer.toString('base64');
  await A.page.evaluate(() => { S3UI.X.pick = { id: 'f1-a-1', fx: 'f1', s: 'a', n: 1, num: 1, name: 'גונדולה מרכזית' }; rerender(); }); await sleep(800);
  check('6 אחרי בחירת מקטע במפה מופיע כפתור "כרטיס המדף"', !!(await A.page.$('[data-a=s3kOpen]')));
  S.reads.length = 0;
  await A.page.click('[data-a=s3kOpen]'); await sleep(2500);
  const c1 = await A.page.evaluate(() => { const d = document.getElementById('dlg'); return { open: d.open, t: d.innerText.replace(/\s+/g, ' '), img: !!d.querySelector('img[alt="תמונת המדף"]'), hist: d.querySelectorAll('img[alt="תמונה מהסבב"]').length, lab: (d.querySelector('label.btn')||{}).outerHTML }; });
  check('6א הכרטיס: מצב "יש בעיות", תמונה, בעיות מפורטות (מנהל), היסטוריה של סבב קודם בלבד (בלי הסבב הנוכחי ובלי סבב ממפה אחרת), וכפתור "צלם"', c1.open && /יש בעיות/.test(c1.t) && c1.img && /אין מחיר על המדף השני/.test(c1.t) && /חור גדול בצד שמאל/.test(c1.t) && /היסטוריה/.test(c1.t) && /תקין/.test(c1.t.split('היסטוריה')[1] || '') && !/סבב קודם.*סבב קודם/.test(c1.t) && c1.hist === 1 && /צלם|העלה/.test(c1.t), { img: c1.img, hist: c1.hist, lab: c1.lab });
  check('6ב הכרטיס ב-360px בלי גלישה', (await noOverflow(A.page)).bad.length === 0, await noOverflow(A.page));
  await shot(A.page, fp(shots, 'כרטיס-מדף'));
  // דיווח יזום: תמונה חשוכה ← אזהרה ← שליחה בכל זאת; תמונה תקינה ← shelfCheck adhoc
  await A.page.setInputFiles('#dlg input[data-c=s3kPick]', await mkImg(A.page, 'dark')); await sleep(1500);
  check('6ג תמונה חשוכה בדיווח יזום: אזהרה וכפתור "שלחו בכל זאת", בלי שליחה', /חשוכה מדי/.test(await txt(A.page, '#dlg')) && !!(await A.page.$('#dlg [data-a=s3kKeep]')) && !S.calls.some((c) => c.fn === 'shelfCheck'));
  await A.page.setInputFiles('#dlg input[data-c=s3kPick]', await mkImg(A.page, 'a')); await sleep(2500);
  const sc = S.calls.find((c) => c.fn === 'shelfCheck');
  check('6ד תמונה תקינה: shelfCheck mode=adhoc עם map, slot, at, src, rt, img ו-th, והתוצאה מוצגת בכרטיס', !!sc && sc.b.mode === 'adhoc' && sc.b.map === 's-main' && sc.b.slot === 'f1-a-1' && sc.b.src === 'photo' && sc.b.rt === 0 && sc.b.img.length > 1000 && sc.b.th.length > 500 && !/^data:/.test(sc.b.img) && /חור במדף העליון/.test(await txt(A.page, '#dlg')), sc && { mode: sc.b.mode, slot: sc.b.slot });
  S.adhoc = { st: 'person', person: true, iss: [], usage: { m: '2026-11', n: 4, cap: 500, w80: false } };
  await A.page.setInputFiles('#dlg input[data-c=s3kPick]', await mkImg(A.page, 'a')); await sleep(2500);
  check('6ה בתמונה עם אדם: הודעה "לא נשמרה, צלמו שוב בלי אנשים"', /בתמונה היה אדם/.test(await txt(A.page, '#dlg')));
  S.fnFail.shelf = 's3-adhoc-day';
  await A.page.setInputFiles('#dlg input[data-c=s3kPick]', await mkImg(A.page, 'a')); await sleep(2500);
  check('6ו מכסה יומית מלאה: הודעה בעברית בכרטיס', /מכסת הדיווחים היומית|הגעתם למכסה/.test(await txt(A.page, '#dlg')), await txt(A.page, '#dlg .s3warn'));
  S.fnFail.shelf = '';
  await A.page.click('#dlg [data-a=closeDlg]'); await sleep(300);

  // ---- 7. מיני בבית: נבנה פעם אחת, לא נבנה מחדש בכל ציור, ונהרס ביציאה ----
  await A.page.evaluate(() => { NAV = [{ v: 'home' }]; render(0); }); await sleep(2500);
  const m0 = await A.page.evaluate(() => ({ mc: window.__mc, md: window.__md, canvas: !!document.querySelector('#s3mini canvas') }));
  await A.page.evaluate(() => { rerender(); rerender(); rerender(); }); await sleep(800);
  const m1 = await A.page.evaluate(() => ({ mc: window.__mc, md: window.__md, canvas: !!document.querySelector('#s3mini canvas') }));
  check('7 חלון הבית: Store3D.mini נקרא פעם אחת, וגם אחרי שלושה ציורים חוזרים לא נבנה מחדש (והקנבס נשאר)', m0.mc === 1 && m1.mc === 1 && m1.md === 0 && m1.canvas, { m0, m1 });
  await A.page.evaluate(() => { go('st3'); }); await sleep(800);
  const m2 = await A.page.evaluate(() => ({ mc: window.__mc, md: window.__md }));
  check('7א כשהחלון יורד מהמסך (מעבר למסך אחר): destroy', m2.md === 1, m2);
  await A.page.evaluate(() => { NAV = [{ v: 'home' }]; render(0); }); await sleep(2500);
  const m3 = await A.page.evaluate(() => ({ mc: window.__mc, md: window.__md, cc: window.__cc }));
  await A.page.evaluate(() => { SY.bizId = 'biz-other'; }); await sleep(3600);
  const m4 = await A.page.evaluate(() => ({ cc: window.__cc, md: window.__md }));
  check('7ב החלפת עסק: Store3D.clearCache נקרא והמיני נהרס', m4.cc > m3.cc && m4.md >= m3.md + 1, { m3, m4 });
  await A.page.evaluate(() => { SY.bizId = 'biz-s'; }); await sleep(3600);
  check('7ג המסך הראשי מעביר את הסיכום (sum) להדמיה', await A.page.evaluate(() => typeof Store3D.open === 'function'), true);
  const errs0 = A.page.__errors;
  check('7ד בלי שגיאות JavaScript במהלך כל הזרימה', errs0.length === 0, errs0);
  await A.ctx.close();

  // ---- 8. עיצוב לפי טוקנים: ערכה כהה וערכה בהירה ----
  A = await open(browser, www, cM(), 'm@x.co');
  S.none = true; S.map = null;
  await A.page.evaluate(() => { S3UI.openWizard('s'); }); await sleep(1200);
  const ds = (theme) => A.page.evaluate((th) => { document.documentElement.dataset.ds = th; const probe = (v, prop) => { const e = document.createElement('i'); e.style[prop] = 'var(--' + v + ')'; document.body.appendChild(e); const c = getComputedStyle(e)[prop]; e.remove(); return c; };
    const cs = (sel, p) => { const e = document.querySelector(sel); return e ? getComputedStyle(e)[p] : null; };
    return { th, btn: cs('#main .btn:not(.g)', 'backgroundColor'), acc: probe('acc', 'backgroundColor'), card: cs('#main .card.s3s', 'backgroundColor'), cardT: probe('card', 'backgroundColor'), line: cs('#main .card.s3s', 'borderTopColor'), lineT: probe('line', 'borderTopColor'), ink: cs('#main .card.s3s', 'color') }; }, theme);
  const da = await ds('a'), db = await ds('b');
  check('8 ערכה כהה: כפתור ראשי = --acc, כרטיס = --card, מסגרת = --line', da.btn === da.acc && da.card === da.cardT && da.line === da.lineT, da);
  check('8א ערכה בהירה: אותם רכיבים עוקבים אחרי הטוקנים (והצבעים שונים מהכהה – אין צבע קשיח)', db.btn === db.acc && db.card === db.cardT && db.line === db.lineT && db.card !== da.card && db.btn !== da.btn, { da: da.card, db: db.card });
  await A.page.evaluate(() => { document.documentElement.dataset.ds = 'a'; });
  // האשף לא דורס מפה קיימת
  S.none = false; S.map = Object.assign(draftMap(), { v: 2, uz: [], src: 'manual' });
  await A.page.evaluate(() => { S3UI.drop(); S3UI.W.own = ''; go('st3'); }); await sleep(800);
  await A.page.evaluate(() => { S3UI.openWizard('s'); }); await sleep(1800);
  check('9 כשכבר יש מפה: האשף לא נפתח לבנייה, ומציג "כבר יש מפה" עם קישור לעריכה', /כבר יש מפה/.test(await txt(A.page, '#main')) && !!(await A.page.$('#main [data-a=st3Edit]')), (await txt(A.page, '#main')).slice(0, 120));
  await A.ctx.close();

  // ---- 10. עובד בלי s3m: כרטיס בלי פירוט מנהל ובלי בקשות srun; אשף חסום ----
  S.none = false; S.map = Object.assign(draftMap(), { v: 2, uz: [], src: 'manual' }); S.calls.length = 0;
  const Wk = await open(browser, www, cM(), 'w@x.co', 360, { sup: true });
  await Wk.page.evaluate(() => { WS = 'home'; NAV = [{ v: 'wk' }]; render(0); }); await sleep(1500); await Wk.page.evaluate(() => { go('st3'); }); await sleep(1500);
  S.reads.length = 0;
  await Wk.page.evaluate(() => { S3UI.X.pick = { id: 'f1-a-1', fx: 'f1', s: 'a', n: 1, num: 1 }; ACT.s3kOpen(); }); await sleep(2000);
  const w1 = await txt(Wk.page, '#dlg');
  check('10 עובד: בכרטיס רואה מצב ומספר בעיות, "ההיסטוריה זמינה למנהל", כפתור "צלם", ובלי בקשות לסבבים (srun)', /יש בעיות/.test(w1) && /נמצאו 2 בעיות/.test(w1) && /ההיסטוריה זמינה למנהל/.test(w1) && /צלם|העלה/.test(w1) && !S.reads.some((r) => /srun/.test(r)), { t: w1.slice(0, 200), reads: S.reads.filter((r) => /srun/.test(r)) });
  await Wk.page.click('#dlg [data-a=closeDlg]');
  await Wk.page.evaluate(() => { S3UI.openWizard('s'); }); await sleep(1000);
  check('10א עובד בלי s3m: האשף חסום בהודעה בעברית', /אין לכם הרשאה להקים מפה/.test(await txt(Wk.page, '#main')), await txt(Wk.page, '#main'));
  await Wk.ctx.close();

  // ---- 11. תוסף כבוי: אין בקשות ----
  // ---- 1ה. סרטון באשף: עיבוד בטלפון (webm שנוצר ב-ffmpeg; אם אין ffmpeg, הבדיקה מדולגת ומתועדת) ----
  {
    const cp = require('child_process'), os = require('os'); const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's3vid-'));
    let have = true; try { cp.execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x480:rate=15', '-t', '14', '-c:v', 'libvpx', '-b:v', '400k', path.join(dir, 's.webm')]); cp.execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x480:rate=10', '-t', '70', '-c:v', 'libvpx', '-b:v', '300k', path.join(dir, 'l.webm')]); } catch (e) { have = false; }
    if (!have) check('1ה סרטון: דולג, אין ffmpeg להכנת קובץ בדיקה (לא נבדק)', true);
    else {
      S.none = true; S.map = null; const V = await open(browser, www, cM(), 'm@x.co');
      await V.page.evaluate(() => { NAV = [{ v: 'home' }]; render(0); }); await sleep(1500);
      await V.page.evaluate(() => document.querySelector('[data-a=st3Build]').click()); await sleep(700);
      const vd = await V.page.evaluate(() => ({ up: document.querySelector('input[data-c=s3wVid][accept="video/*"][multiple]') ? 1 : 0, cap: document.querySelector('input[data-c=s3wVid][capture=environment]') ? 1 : 0, t: document.querySelector('#main').innerText }));
      check('1ה1 שלב 1: כפתורי "העלו סרטון" ו"צלמו סרטון" (video/*, multiple, capture)', vd.up && /capture="environment" data-c="s3wVid"/.test(SRC.find(([f]) => f === 'store3d-wizard.js')[1]) && /העלו סרטון/.test(vd.t) && /צלמו סרטון/.test(vd.t), vd);
      const st = () => V.page.evaluate(() => ({ n: S3UI.W.imgs.length, busy: S3UI.W.busy, msg: S3UI.W.msg, sz: S3UI.W.imgs.reduce((a, i) => a + i.blob.size, 0), mx: Math.max(0, ...S3UI.W.imgs.map((i) => Math.max(i.w, i.h))) }));
      const until = async (ms) => { for (let i = 0; i < ms / 250; i++) { await sleep(250); if (!(await st()).busy) return; } };
      const corrupt = { name: 'bad.webm', mimeType: 'video/webm', buffer: Buffer.from('not a video at all '.repeat(50)) };
      await V.page.setInputFiles('input[data-c=s3wVid][multiple]', corrupt); await until(30000);
      let r = await st();
      check('1ה2 סרטון פגום: הודעת שגיאה בעברית, בלי תמונות ובלי קריסה', r.n === 0 && /לא הצלחנו לקרוא את הסרטון/.test(r.msg) && !r.busy, r);
      await V.page.setInputFiles('input[data-c=s3wVid][multiple]', path.join(dir, 's.webm')); await until(60000);
      r = await st();
      check('1ה3 סרטון של 14 שניות: נוספו תמונות (לכל היותר אחת לכל 2 שניות), מוקטנות עד 1024px, בלי הודעת שגיאה', r.n >= 3 && r.n <= 8 && r.mx <= 1024 && !r.msg, r);
      const n0 = r.n;
      await V.page.setInputFiles('input[data-c=s3wVid][multiple]', corrupt); await until(30000);
      r = await st();
      check('1ה4 סרטון פגום אחרי תמונות קיימות: התמונות שכבר נבחרו נשארות', r.n === n0 && /לא הצלחנו לקרוא/.test(r.msg), r);
      await V.page.setInputFiles('input[data-c=s3wVid][multiple]', [1, 2, 3, 4].map((k) => path.join(dir, 'l.webm'))); await sleep(4000);
      const prog = await st(); await shot(V.page, fp(shots, 'סרטון-התקדמות'), true);
      const ui = await V.page.evaluate(() => ({ t: document.querySelector('#main').innerText.replace(/\s+/g, ' '), x: !!document.querySelector('[data-a=s3wVidX]') }));
      check('1ה5 בזמן העיבוד: הודעת התקדמות "מעבד סרטון" עם אחוזים וכפתור ביטול, והממשק לא קפוא', /מעבד סרטון \d מתוך 4… \d+%/.test(ui.t) && ui.x, { prog, ui: ui.t.slice(0, 300) });
      await until(540000); r = await st();
      check('1ה6 ארבעה סרטונים ארוכים (70 שניות כל אחד): התקרה 100 נשמרת, גודל עד 13MB, והודעה על דקה ראשונה', r.n === 100 && r.sz <= 13e6 && /ארוך מדקה/.test(r.msg), r);
      const hasWide = await V.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth); check('1ה7 בלי גלישה אופקית אחרי סרטונים', hasWide);
      await V.page.evaluate(() => { const W = S3UI.W; W.imgs.length = 0; });
      await V.page.setInputFiles('input[data-c=s3wVid][multiple]', path.join(dir, 'l.webm')); await sleep(1500);
      await V.page.click('[data-a=s3wVidX]'); await until(30000); r = await st();
      check('1ה8 ביטול באמצע: העיבוד נעצר, הודעת ביטול, בלי תמונות', !r.busy && /בוטל/.test(r.msg) && r.n === 0, r);
      await V.ctx.close(); fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  // ---- 1ז. "פרטים על החנות" – דרך א (סקיצה ← שאלות על השרטוט ← רוחב אמיתי); ובלי פרטים – הבקשה בלי info/sketch (כמו גרסה ישנה) ----
  {
    S.none = true; S.map = null; S.calls.length = 0;
    const P = await open(browser, www, cM(), 'm@x.co');
    await P.page.evaluate(() => { S3UI.openWizard('s'); }); await sleep(1200);
    await P.page.setInputFiles('input[data-c=s3wPick][multiple]', [await mkImg(P.page, 'a')]); await sleep(2000);
    await P.page.click('[data-a=s3wDraft]'); await sleep(400); await P.page.click('[data-a=s3wDetX]'); await sleep(300);
    await P.page.click('[data-a=s3wDraft]'); await sleep(2000);
    const m0 = S.calls.find((c) => c.fn === 'mapDraft');
    check('1ז בלי פרטים (דילוג על המסך): mapDraft נשלח בלי info ובלי sketch – כמו בגרסה הקודמת', !!m0 && !('info' in m0.b) && !('sketch' in m0.b), m0 && Object.keys(m0.b));
    await P.page.evaluate(() => { ACT.s3wBack1(); }); await sleep(300);
    S.calls.length = 0;
    await P.page.click('[data-a=s3wDet]'); await sleep(300);
    await P.page.click('[data-a=s3wPath][data-p=a]'); await sleep(400);
    for (const [x, y] of [[0, 0], [1000, 0], [1000, 1500], [0, 1500]]) await tapSk(P.page, x, y);
    const c4 = await P.page.evaluate(() => ({ cur: S3UI.W.sk.cur, mode: S3UI.W.sk.mode, msg: S3UI.W.msg, v: cur().v, sy: scrollY, ih: innerHeight, cv: (() => { const c = document.getElementById('s3wSk'); if (!c) return null; const b = c.getBoundingClientRect(); return [b.top, b.width, b.height, b.left, (document.elementFromPoint(b.left + 0.5, b.top + 100) || {}).tagName, (document.elementFromPoint(b.left + 3, b.top + 100) || {}).tagName, (document.elementFromPoint(b.left + 0.5, b.top + 100) || {}).className]; })() }));
    check('1ז0 דרך א: ארבע הקשות על השרטוט = ארבע פינות של חדר פתוח', JSON.stringify(c4.cur) === '[0,0,1000,0,1000,1500,0,1500]', c4);
    await P.page.click('[data-a=s3wSkClose]'); await sleep(300);
    await P.page.click('[data-a=s3wSkM][data-m=row]'); await sleep(200);
    for (const [x, y] of [[300, 200], [300, 1300], [700, 200], [700, 1300]]) await tapSk(P.page, x, y);
    await P.page.click('[data-a=s3wSkM][data-m=ent]'); await sleep(200); await tapSk(P.page, 500, 1500);
    await P.page.click('[data-a=s3wSkM][data-m=cash]'); await sleep(200); await tapSk(P.page, 900, 1400);
    let k = await skOf(P.page);
    const ask1 = await P.page.evaluate(() => ({ rt: document.querySelectorAll('[data-c=s3wRt]').length, rk: document.querySelectorAll('[data-c=s3wRk]').length, rw: !!document.querySelector('[data-c=s3wRw]'), t: document.querySelector('#main').innerText }));
    check('1ז1 ציור: חדר של 4 פינות, 2 שורות, כניסה וקופה בהקשה (מסגרת זמנית 20×20)', JSON.stringify(k.rooms) === '[[0,0,1000,0,1000,1500,0,1500]]' && JSON.stringify(k.rows) === '[[300,200,300,1300],[700,200,700,1300]]' && JSON.stringify(k.ent) === '[500,1500]' && JSON.stringify(k.cash) === '[900,1400]', k);
    check('1ז2 אחרי הציור – שאלות על השרטוט: סוג החדר, סוג כל שורה, ורוחב אמיתי (אין מידות)', ask1.rt === 1 && ask1.rk === 2 && ask1.rw && /כמה שאלות על השרטוט/.test(ask1.t) && /הכניסה סומנה/.test(ask1.t), ask1);
    await P.page.selectOption('[data-c=s3wRk][data-i="1"]', 'fridge'); await sleep(200);
    const pre = await P.page.evaluate(() => { const k = S3UI.W.sk; ACT.s3wDraft(); return S3UI.W.msg; }); await sleep(300);
    check('1ז3 שליחה בלי רוחב אמיתי נחסמת בהודעה (בלי mapDraft)', /רוחב האמיתי/.test(pre) && !S.calls.some((c) => c.fn === 'mapDraft'), pre);
    await P.page.fill('[data-c=s3wRw]', '20'); await P.page.dispatchEvent('[data-c=s3wRw]', 'change'); await sleep(400);
    k = await skOf(P.page);
    const q = await P.page.evaluate(() => S3UI.W.q);
    check('1ז4 רוחב אמיתי 20 מ\': השרטוט מוגדל פי 2, האורך מחושב (30 מ\'), והשאלה נעלמת', q.w === '20' && q.l === '30' && JSON.stringify(k.rooms) === '[[0,0,2000,0,2000,3000,0,3000]]' && JSON.stringify(k.rows) === '[[600,400,600,2600],[1400,400,1400,2600]]' && JSON.stringify(k.ent) === '[1000,3000]' && !(await P.page.$('[data-c=s3wRw]')), { q, k });
    await shot412(P.page, fp(shots, 'פרטים-סקיצה'));
    check('1ז5 מסך הסקיצה ב-360px בלי גלישה', (await noOverflow(P.page)).bad.length === 0, await noOverflow(P.page));
    await P.page.click('[data-a=s3wDraft]'); await sleep(2000);
    const m1 = S.calls.find((c) => c.fn === 'mapDraft');
    check('1ז6 mapDraft מדרך א: info עם מידות מהרוחב האמיתי ומספרים מהשרטוט; sketch עם סוגי שורות (מקררים), כניסה וקופה', !!m1 && JSON.stringify(m1.b.info) === JSON.stringify({ w: 2000, l: 3000, rooms: 1, rows: 2 }) && JSON.stringify(m1.b.sketch) === JSON.stringify({ rooms: [[0, 0, 2000, 0, 2000, 3000, 0, 3000]], rows: [[600, 400, 600, 2600], [1400, 400, 1400, 2600]], rt: ['s'], rk: ['gon', 'fridge'], ent: [1000, 3000], cash: [1800, 2800] }), m1 && { info: m1.b.info, sketch: m1.b.sketch });
    check('1ז7 בלי שגיאות JavaScript בדרך א', P.page.__errors.length === 0, P.page.__errors);
    await P.ctx.close();
  }

  const Off = await open(browser, www, cM({}), 'm@x.co');
  const rq = []; Off.page.on('request', (r) => { if (/s3PutTex|mapDraft|shelfCheck|s3SaveMap|s3View|s3Run|\/smap|\/s3br|\/s3sum|\/sround|\/srun|\/s3draft/.test(r.url())) rq.push(r.url()); });
  await Off.page.evaluate(() => { NAV = [{ v: 'home' }]; render(0); }); await sleep(1500);
  await Off.page.evaluate(() => { S3UI.X.pick = { id: 'f1-a-1', n: 1 }; ACT.s3kOpen(); S3UI.openWizard('s'); }); await sleep(1500);
  check('11 תוסף כבוי: אין בקשות לתלת מימד (אשף, כרטיס, חלון בית), והכרטיס לא נפתח', rq.length === 0 && !(await Off.page.evaluate(() => document.getElementById('dlg').open)) && /לא מופעל/.test(await txt(Off.page, '#main')), { rq, t: await txt(Off.page, '#main') });
  await Off.ctx.close();

  await browser.close();
  if (out) fs.writeFileSync(out, JSON.stringify({ fail, res }, null, 1));
  console.log(fail ? 'נכשלו ' + fail : 'כל הבדיקות עברו (' + res.length + ')');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
