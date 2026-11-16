'use strict';
// סיור 360 בתוך האפליקציה (שלבים 18ג, 18ד, 18ה – 15.11.2026). רשת מדומה, בלי אמולטור; הצילום מוחלף בבדיקה (S3PanoCap.start מחזיר תמונה שנוצרת בקוד).
// בודק: מנהל מוסיף נקודה (צילום ← מיקום בתוך חדר ← יישור כיוון ±5° ← s3PutPano עם השדות הנכונים), רואה אותה במפה, הזזה (עדכון בלי תמונה),
// שגיאה בעברית + "נסו שוב" עם אותו qid, בלי רשת – הודעה, קובץ שאינו 2:1 נחסם, מחיקה (s3DelPano) רק למנהל ועם אישור,
// "סיור בחנות" מופיע רק כשיש נקודה ונפתח עם הנקודות והתגים, "חזרה" סוגרת; עובד בלי s3m – סיור בלי עריכה; עובד עם s3m – עריכה בלי מחיקה;
// אין שגיאות JS; 4 גדלים בלי גלישה. שימוש: node ui-st3d-pano.js <www-dir> [out.json] [shot-prefix]
const fs = require('fs'); const path = require('path'); const H = require('./harness');
let fail = 0; const res = []; const check = (n, ok, info) => { if (!ok) fail++; res.push({ n, ok: !!ok, info }); console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const enc = (v) => (v == null ? { nullValue: null } : typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }) : typeof v === 'string' ? { stringValue: v } : Array.isArray(v) ? { arrayValue: { values: v.map(enc) } } : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } });
const DOCS = 'projects/demo-largpeami/databases/(default)/documents/b/biz-s/';
const mkMap = () => ({ br: 'main', kind: 's', name: 'חנות הבדיקה', v: 3, seq: 1, grid: 50, numDir: 'rtl', ent: 'd1', src: 'manual', upd: 1763100000000, by: 'm',
  rooms: [{ id: 'r1', name: 'אולם', p: [0, 0, 1000, 0, 1000, 800, 0, 800], h: 300 }], walls: [], cols: [], doors: [{ id: 'd1', x: 500, y: 800, w: 180, a: 0, k: 'ent' }],
  fx: [{ id: 'f1', k: 'gon', x: 500, y: 400, w: 200, d: 90, h: 180, a: 0, sides: 2, bays: 2, lvl: 5, hi: false, room: 'r1', num: 1 }], syms: [] });
const S = { pano: {}, calls: [], fail: '', jpg: '' };
const ALL = { store3d: true };
const pth = (id, v, s) => 'b/biz-s/store3d/main/pano/s-main/' + id + '_' + v + (s ? '_s' : '') + '.jpg';
async function server(ctx) {
  const doc = (name, o) => ({ name: DOCS + name, fields: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, enc(v)])), createTime: '2026-11-03T09:00:00Z', updateTime: '2026-11-03T09:00:00Z' });
  const j = (route, st, b) => route.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(b) });
  await ctx.route((u) => u.port === '8080' && /\/documents\/b\/biz-s\/(smap|s3br|s3sum|sround)/.test(u.pathname), (route) => {
    const p = new URL(route.request().url()).pathname.replace(/^.*\/documents\/b\/biz-s\//, '');
    if (p === 'smap/s-main') return j(route, 200, doc(p, mkMap()));
    if (p === 'smap/s-main/pano') return j(route, 200, { documents: Object.entries(S.pano).map(([id, o]) => doc('smap/s-main/pano/' + id, o)) });
    if (p === 's3sum/s-main') return j(route, 200, doc(p, { b: { 'f1-a-1': { s: 'iss', r: 'run_1', t: 1, n: 1 }, 'f1-b-2': { s: 'ok', r: 'run_1', t: 1, n: 1 } }, run: 'run_1', score: 80, upd: 2 }));
    if (p === 'sround') return j(route, 200, { documents: [] });
    return j(route, 404, { error: { code: 404, status: 'NOT_FOUND' } });
  });
  await ctx.route((u) => u.port === '9199', (route) => route.fulfill({ status: 200, contentType: 'image/jpeg', body: Buffer.from(S.jpg || '', 'base64') }));
  const rec = (route, fn) => { let b = {}; try { b = JSON.parse(route.request().postData()).data || {}; } catch (e) { /* */ } S.calls.push({ fn, b }); return b; };
  const ok = (route, r) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: r }) });
  const bad = (route, reason) => route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED', message: 'x', details: { reason } } }) });
  await ctx.route('**/s3PutPano', (route) => {
    const b = rec(route, 's3PutPano'); if (S.fail) return bad(route, S.fail);
    let id = b.id; const o0 = id ? S.pano[id] : null; let ver = o0 ? o0.ver : 0;
    if (!id) { id = 'p' + (Object.keys(S.pano).length + 1); }
    if (b.full) ver += 1;
    const o = { x: b.x, y: b.y, yaw: b.yaw, nb: [], full: pth(id, ver), sm: pth(id, ver, 1), w: 2048, h: 1024, sz: 1000, ver, by: 'm', at: 1, upd: 2 };
    S.pano[id] = o; ok(route, Object.assign({ ok: true, mapId: b.mapId, id, linked: [] }, o));
  });
  await ctx.route('**/s3DelPano', (route) => { const b = rec(route, 's3DelPano'); delete S.pano[b.id]; ok(route, { ok: true, mapId: b.mapId, id: b.id, delAt: 3 }); });
  await ctx.route('**/s3View', (route) => ok(route, { runs: [], fixes: [], take: [] }));
}
/* צילום מדומה: תמונת 360 שנוצרת בקוד (לא תמונת דוגמה באפליקציה) + עטיפת S3Pano.open כדי לראות מה נשלח לסיור */
const STUB = () => {
  const mk = async (W) => { const c = document.createElement('canvas'); c.width = W; c.height = W / 2; const g = c.getContext('2d');
    for (let i = 0; i < 16; i++) { g.fillStyle = `hsl(${i * 22},60%,${30 + (i % 3) * 15}%)`; g.fillRect(i * W / 16, 0, W / 16 + 1, W / 2); }
    return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.7)); };
  window.__capN = 0;
  S3PanoCap.start = async () => { window.__capN++; return { full: await mk(2048), sm: await mk(1024), w: 2048, h: 1024, meta: { n: 20, mode: 'pts', dev: 'mock' } }; };
  const o0 = S3Pano.open; window.__tour = null; S3Pano.open = function (el, tour, opts) { window.__tour = { tour, tags: (opts.tags || []).length, load: typeof opts.load }; return o0.apply(this, arguments); };
};
async function open(browser, www, cfg, email, perms, w) {
  const { ctx, page } = await H.newPage(browser, www, cfg, [], email); await page.setViewportSize({ width: w || 360, height: 760 });
  const uid = email.split('@')[0]; await server(ctx);
  if (perms) await ctx.route((u) => u.port === '8080' && new RegExp('/staff/' + uid + '$').test(u.pathname), (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ name: 'x', fields: { active: { booleanValue: true }, perms: enc(perms) } }) }));
  await H.login(page, email);
  await page.evaluate(() => { const sh = document.getElementById('sheet'); if (sh && !sh.hidden && typeof ACT.startBlank === 'function') ACT.startBlank(); });
  await H.settle(page, 400);
  await page.evaluate(STUB);
  return { ctx, page };
}
const noOverflow = (page) => page.evaluate(() => { const W = document.documentElement.clientWidth; const bad = [...document.querySelectorAll('#main *, #dlg *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > W + 1 || r.left < -1) && !e.closest('.scroll-x,.s3tabs,.s3main'); }).slice(0, 5).map((e) => e.tagName + '.' + e.className + ':' + (e.innerText || '').slice(0, 20)); return { sw: document.documentElement.scrollWidth, W, bad }; });
const txt = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.innerText.replace(/\s+/g, ' ').trim() : ''; }, sel);
const cbox = async (page, x, y) => { const b = await page.evaluate(() => { const el = document.getElementById('s3pl'); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, vx: S3UI.E.vx, vy: S3UI.E.vy, vw: S3UI.E.vw }; }); return [b.x + (x - b.vx) * b.w / b.vw, b.y + (y - b.vy) * b.w / b.vw]; };
const tap = async (page, x, y) => { const [cx, cy] = await cbox(page, x, y); await page.mouse.click(cx, cy); await sleep(200); };
const last = (fn) => S.calls.filter((c) => c.fn === fn).slice(-1)[0];
const shotP = (pre, n) => pre ? pre + '-' + n + '.png' : null;
const shot = async (page, f, full) => { if (f) { await sleep(300); await page.screenshot({ path: f, fullPage: !!full }); } };
const toEditorPano = async (page) => { await page.evaluate(() => { S3UI.drop(); S3UI.openEditor('s'); if (cur().v !== 'st3e') go('st3e'); }); await sleep(1500); await page.click('[data-a=s3eTool][data-k=pano]'); await sleep(300); };

(async () => {
  const [www, out, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(path.dirname(shots), { recursive: true });
  const browser = await H.launch();
  const cM = () => ({ mode: 'new', users: { m: 'biz-s', w: 'biz-s' }, biz: { 'biz-s': { dataRoot: 'b', features: ALL, name: 'עסק בדיקה' } }, admins: { 'b/biz-s/|m': 1 }, staff: { 'b/biz-s/|w': 1 } });

  // ---- 1. מנהל, עוד אין נקודות: אין "סיור בחנות", יש כרטיס "צילום נקודת 360" (ולא כרטיס הניסוי) ----
  let A = await open(browser, www, cM(), 'm@x.co');
  S.jpg = await A.page.evaluate(() => { const c = document.createElement('canvas'); c.width = 1024; c.height = 512; const g = c.getContext('2d'); g.fillStyle = 'teal'; g.fillRect(0, 0, 1024, 512); return c.toDataURL('image/jpeg', .7).split(',')[1]; });
  await A.page.evaluate(() => go('st3')); await sleep(1800);
  const s1 = await A.page.evaluate(() => ({ tour: !!document.querySelector('[data-a=s3qTour]'), card: !!document.querySelector('[data-a=s3qEd]'), tryC: !!document.querySelector('[data-a=s3pTry]') }));
  check('1 מסך התלת מימד בלי נקודות: אין "סיור בחנות"; יש "צילום נקודת 360"; כרטיס הניסוי לא מוצג כשיש מפה', !s1.tour && s1.card && !s1.tryC, s1);
  await A.page.click('[data-a=s3qEd]'); await sleep(1200);
  const e1 = await A.page.evaluate(() => ({ v: cur().v, tool: S3UI.E.tool, add: !!document.querySelector('[data-a=s3qAdd]'), file: !!document.querySelector('input[data-c=s3qFile]') }));
  check('1א "לנקודות 360" פותח את העורך בכלי "נקודות 360", עם "הוספת נקודה" ו"העלאת קובץ 360"', e1.v === 'st3e' && e1.tool === 'pano' && e1.add && e1.file, e1);

  // ---- 2. הוספת נקודה ----
  await A.page.click('[data-a=s3qAdd]'); await sleep(1200);
  check('2 אחרי הצילום: שלב 2 "הקישו על המפה במקום שבו עמדתם"', /במקום שבו עמדתם/.test(await txt(A.page, '#main')) && await A.page.evaluate(() => window.__capN) === 1);
  await tap(A.page, 1030, 400);
  check('2א הקשה מחוץ לחדר: "הקישו בתוך חדר", נשארים בשלב המיקום', /הקישו בתוך חדר/.test(await txt(A.page, '#main')) && await A.page.evaluate(() => S3UI.P360.step) === 'place');
  await tap(A.page, 300, 600); await sleep(400);
  const a1 = await A.page.evaluate(() => { const c = document.getElementById('s3qStrip'); return { step: S3UI.P360.step, x: S3UI.P360.x, y: S3UI.P360.y, strip: !!c && c.width > 0, nw: document.querySelector('#s3pl [data-pano=new]') ? 1 : 0 }; });
  check('2ב הקשה בתוך חדר: שלב יישור הכיוון, רצועה מהצילום עם קו, והנקודה מסומנת במפה', a1.step === 'aim' && a1.x === 300 && a1.y === 600 && a1.strip && a1.nw === 1, a1);
  await tap(A.page, 600, 600);
  const y1 = await A.page.evaluate(() => S3UI.P360.yaw);
  await A.page.click('[data-a=s3qRot][data-d="5"]'); await sleep(200);
  const y2 = await A.page.evaluate(() => S3UI.P360.yaw);
  check('2ג הקשה על מדף מימין לנקודה = כיוון 90° (כמו בצפייה: atan2(dx,-dy)), ו-+5° = 95°', Math.abs(y1 - 90) < 1.5 && Math.abs(y2 - y1 - 5) < .01, { y1, y2 });
  for (const w of [320, 360, 412, 768]) { await A.page.setViewportSize({ width: w, height: 760 }); await sleep(250); const o = await noOverflow(A.page); check('2ד יישור כיוון ב-' + w + 'px בלי גלישה', o.sw <= o.W && !o.bad.length, o); }
  await A.page.setViewportSize({ width: 360, height: 760 }); await sleep(300);
  await shot(A.page, shotP(shots, 'יישור-כיוון'), true);
  await A.page.click('[data-a=s3qSave]'); await sleep(2000);
  const p1 = last('s3PutPano');
  check('2ה s3PutPano: qid תקין, mapId, x/y בס"מ, yaw=95, full ו-sm ב-base64, בלי id', !!p1 && /^[A-Za-z0-9-]{16,40}$/.test(p1.b.qid) && p1.b.mapId === 's-main' && p1.b.x === 300 && p1.b.y === 600 && Math.abs(p1.b.yaw - (y2 % 360)) < .2 && typeof p1.b.full === 'string' && p1.b.full.length > 1000 && !/^data:/.test(p1.b.full) && typeof p1.b.sm === 'string' && p1.b.sm.length > 300 && !('id' in p1.b), p1 && Object.assign({}, p1.b, { full: (p1.b.full || '').length, sm: (p1.b.sm || '').length }));
  const a2 = await A.page.evaluate(() => ({ dot: !!document.querySelector('#s3pl circle[data-pano=p1]'), step: S3UI.P360.step, sel: S3UI.P360.sel, n: S3UI.data().pano.s.length }));
  check('2ו אחרי השמירה: הנקודה נטענה מחדש ומוצגת במפה (עיגול + חרוט), ונבחרה', a2.dot && a2.step === '' && a2.sel === 'p1' && a2.n === 1, a2);
  check('2ז פאנל הנקודה למנהל: צפייה, הזזה, יישור, צילום מחדש ומחיקה', await A.page.evaluate(() => ['s3qView', 's3qMove', 's3qAim', 's3qRe', 's3qDel'].every((a) => !!document.querySelector('[data-a=' + a + ']'))));
  await shot(A.page, shotP(shots, 'נקודה-במפה'), true);

  // ---- 3. הזזה = עדכון בלי תמונה ----
  await A.page.click('[data-a=s3qMove]'); await sleep(200); await tap(A.page, 700, 600); await sleep(1500);
  const p2 = last('s3PutPano');
  check('3 הזזה: s3PutPano עם id, מיקום חדש ואותו כיוון, בלי full/sm', p2 !== p1 && p2.b.id === 'p1' && p2.b.x === 700 && p2.b.y === 600 && Math.abs(p2.b.yaw - 95) < .2 && !('full' in p2.b) && !('sm' in p2.b), p2 && p2.b);

  // ---- 4. שגיאת שרת בעברית ו"נסו שוב" עם אותו qid ----
  S.fail = 'pano-day';
  await A.page.click('[data-a=s3qAdd]'); await sleep(1000); await tap(A.page, 200, 200); await sleep(200);
  await A.page.click('[data-a=s3qSkip]'); await sleep(1500);
  const f1 = last('s3PutPano'), et = await txt(A.page, '.s3err[role=alert]');
  check('4 "דלג" שולח yaw=0; מכסה יומית: הודעה בעברית וכפתור "נסו שוב"', f1.b.yaw === 0 && /מכסת העלאות ה-360/.test(et) && !!(await A.page.$('[data-a=s3qRetry]')), et);
  S.fail = ''; await A.page.click('[data-a=s3qRetry]'); await sleep(1500);
  const f2 = last('s3PutPano');
  check('4א "נסו שוב": אותו qid ואותם נתונים, והפעם נשמר (2 נקודות)', f2 !== f1 && f2.b.qid === f1.b.qid && f2.b.x === 200 && f2.b.full === f1.b.full && await A.page.evaluate(() => S3UI.data().pano.s.length) === 2, { q1: f1.b.qid, q2: f2.b.qid });

  // ---- 5. בלי רשת ----
  const nCalls = S.calls.length;
  await A.ctx.setOffline(true); await A.page.click('[data-a=s3qAdd]'); await sleep(500);
  check('5 בלי רשת: הודעה שצריך חיבור, בלי צילום ובלי שליחה', /צריך חיבור/.test(await txt(A.page, '#main')) && S.calls.length === nCalls && await A.page.evaluate(() => window.__capN) === 2);
  await A.ctx.setOffline(false); await sleep(300);

  // ---- 6. קובץ שאינו 2:1 נחסם ----
  const b43 = await A.page.evaluate(() => { const c = document.createElement('canvas'); c.width = 1600; c.height = 1200; const g = c.getContext('2d'); g.fillStyle = 'olive'; g.fillRect(0, 0, 1600, 1200); return c.toDataURL('image/jpeg', .8).split(',')[1]; });
  await A.page.setInputFiles('input[data-c=s3qFile]', { name: 'x.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(b43, 'base64') }); await sleep(1200);
  check('6 קובץ 1600×1200: נחסם בהודעה "ביחס 2:1", בלי שליחה', /ביחס 2:1/.test(await txt(A.page, '#main')) && S.calls.length === nCalls);

  // ---- 7. מחיקה (מנהל, עם אישור) ----
  await A.page.click('[data-a=s3qCancel]').catch(() => {}); await sleep(200);
  await tap(A.page, 200, 200); await sleep(200);
  await A.page.click('[data-a=s3qDel]'); await sleep(400);
  const dl = await A.page.evaluate(() => { const d = document.getElementById('dlg'); return { open: d && d.open, t: d ? d.innerText : '' }; });
  check('7 מחיקה: חלון אישור לפני השליחה', dl.open && /למחוק את נקודה 2/.test(dl.t) && !S.calls.some((c) => c.fn === 's3DelPano'), dl);
  await A.page.click('#dlg [data-a=yes]'); await sleep(1500);
  const d1 = last('s3DelPano');
  check('7א אחרי אישור: s3DelPano עם mapId ו-id, והנקודה ירדה מהמפה', !!d1 && d1.b.mapId === 's-main' && d1.b.id === 'p2' && await A.page.evaluate(() => S3UI.data().pano.s.length === 1 && !document.querySelector('#s3pl circle[data-pano=p2]')), d1 && d1.b);

  // ---- 8. "סיור בחנות" ----
  await A.page.evaluate(() => { NAV = [{ v: 'home' }]; go('st3'); }); await sleep(1500);
  check('8 עם נקודה פעילה: "סיור בחנות" מופיע ליד "מבט מלמעלה / הליכה בחנות"', await A.page.evaluate(() => { const b = document.querySelector('[data-a=s3qTour]'), m = document.querySelector('[data-a=st3Mode]'); return !!b && b.parentNode === m.parentNode; }));
  for (const w of [320, 360, 412, 768]) { await A.page.setViewportSize({ width: w, height: 760 }); await sleep(250); const o = await noOverflow(A.page); check('8א מסך התלת מימד עם "סיור בחנות" ב-' + w + 'px בלי גלישה', o.sw <= o.W && !o.bad.length, o); }
  await A.page.setViewportSize({ width: 360, height: 760 }); await sleep(300);
  await shot(A.page, shotP(shots, 'מסך-עם-סיור'));
  await A.page.click('[data-a=s3qTour]'); await sleep(2500);
  const t1 = await A.page.evaluate(() => ({ t: window.__tour && { n: window.__tour.tour.pts.length, start: window.__tour.tour.start, p: window.__tour.tour.pts[0], tags: window.__tour.tags, load: window.__tour.load }, layer: !!document.querySelector('.s3q-layer') }));
  check('8ב הסיור נפתח במסך מלא: נקודה אחת עם full/sm/yaw, מתחיל ממנה, תגי מצב מ-s3sum (2), ופונקציית טעינה', t1.layer && t1.t && t1.t.n === 1 && t1.t.start === 'p1' && t1.t.p.full === pth('p1', 1) && t1.t.p.sm === pth('p1', 1, 1) && Math.abs(t1.t.p.yaw - 95) < .2 && t1.t.tags === 2 && t1.t.load === 'function', t1);
  const ld = await A.page.evaluate(async () => { const L = []; for (const p of ['b/biz-s/store3d/main/pano/s-main/p1_1.jpg', 'b/biz-x/store3d/main/pano/s-main/p1_1.jpg', 'b/biz-s/store3d/main/tex/s-main/t1_1.jpg', 'b/biz-s/store3d/main/pano/s-main/../p1_1.jpg']) { try { const b = await S3UI.panoLoad(p); L.push(b && b.size > 0); } catch (e) { L.push(false); } } return L; }).catch(() => null);
  check('8ג בדיקת נתיב בטעינה: רק b/{העסק}/store3d/{br}/pano/...jpg נטען (עסק אחר, טקסטורה ו-".." נדחים)', Array.isArray(ld) && ld[0] === true && ld.slice(1).every((x) => x === false), ld);
  await shot(A.page, shotP(shots, 'סיור'));
  await A.page.evaluate(() => goBack()); await sleep(400);
  check('8ד "חזרה" של אנדרואיד סוגרת את הסיור ונשארים במסך התלת מימד', await A.page.evaluate(() => !document.querySelector('.s3q-layer') && cur().v === 'st3'));
  check('8ה אין שגיאות JavaScript (מנהל)', !A.page.__errors.length, A.page.__errors);
  await A.ctx.close();

  // ---- 9. עובד בלי s3m: רואה סיור, בלי עריכה ----
  let W = await open(browser, www, cM(), 'w@x.co', { sup: true });
  await W.page.evaluate(() => go('st3')); await sleep(1800);
  const w1 = await W.page.evaluate(() => ({ tour: !!document.querySelector('[data-a=s3qTour]'), card: !!document.querySelector('[data-a=s3qEd]'), edit: !!document.querySelector('[data-a=st3Edit]'), ed: (() => { go('st3e'); const t = document.getElementById('main').innerText; ACT.back(); return /אין לכם הרשאה/.test(t); })() }));
  check('9 עובד בלי s3m: "סיור בחנות" מופיע; אין "צילום נקודת 360", אין עריכה, והעורך חסום', w1.tour && !w1.card && !w1.edit && w1.ed, w1);
  await sleep(800); await W.page.click('[data-a=s3qTour]'); await sleep(2000);
  check('9א עובד בלי s3m: הסיור נפתח, בלי כפתור שיתוף', await W.page.evaluate(() => !!document.querySelector('.s3q-layer') && window.__tour && window.__tour.tour.pts.length === 1 && ![...document.querySelectorAll('.s3q-layer button')].some((b) => /שיתוף/.test(b.textContent))));
  await W.page.evaluate(() => goBack()); await sleep(300);
  check('9ב אין שגיאות JavaScript (עובד)', !W.page.__errors.length, W.page.__errors);
  await W.ctx.close();

  // ---- 10. עובד עם s3m: עריכה, בלי מחיקה ----
  W = await open(browser, www, cM(), 'w@x.co', { s3m: true });
  await toEditorPano(W.page);
  await tap(W.page, 700, 600); await sleep(200);
  const w2 = await W.page.evaluate(() => ({ sel: S3UI.P360.sel, move: !!document.querySelector('[data-a=s3qMove]'), del: !!document.querySelector('[data-a=s3qDel]'), t: document.getElementById('main').innerText }));
  check('10 עובד עם s3m: בוחר נקודה ורואה הזזה/יישור, בלי מחיקה (הודעה "למנהל בלבד")', w2.sel === 'p1' && w2.move && !w2.del && /מחיקת נקודה מותרת למנהל בלבד/.test(w2.t), { sel: w2.sel, move: w2.move, del: w2.del });
  const nd = S.calls.filter((c) => c.fn === 's3DelPano').length;
  await W.page.evaluate(() => ACT.s3qDel()); await sleep(300);
  check('10א עובד עם s3m: קריאה ישירה למחיקה לא שולחת כלום', S.calls.filter((c) => c.fn === 's3DelPano').length === nd && await W.page.evaluate(() => !document.getElementById('dlg').open));
  await W.page.click('[data-a=s3qAim]'); await sleep(1200);
  await tap(W.page, 700, 200); await W.page.click('[data-a=s3qSave]'); await sleep(1500);
  const p3 = last('s3PutPano');
  check('10ב יישור כיוון לנקודה קיימת: עדכון בלי תמונה עם yaw=0 (הקשה ישר למעלה)', p3.b.id === 'p1' && p3.b.x === 700 && p3.b.yaw === 0 && !('full' in p3.b), p3.b);
  check('10ג אין שגיאות JavaScript (עובד עם s3m)', !W.page.__errors.length, W.page.__errors);
  await W.ctx.close();

  await browser.close();
  if (out) fs.writeFileSync(out, JSON.stringify({ fail, res }, null, 1));
  console.log(fail ? `נכשלו ${fail}` : 'הכול עבר');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
