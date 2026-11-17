'use strict';
// הקמת חנות – שלב 4 (17.11.2026): עורך "חיבור וחיתוך" (store3d-crop.js + store3d-warp.js) במסך "צילום החנות". רשת מדומה, בלי AI. תמונות סינתטיות בלבד.
// בודק (360px): כפתור "חיבור וחיתוך" אחרי צילום; 3 תמונות חופפות ⇒ חזית אחת בלי חסר; פער ⇒ "חסר קטע" ו"אשרו" נעול; גרירת פינה;
// שמירה ⇒ s3CapPut op front, man:true, JPEG עד 2048px ועד 1.5MB, מוקטנת עד 512; תמונה מהשרת נטענת דרך Storage; 6×1600px בלי קריסה (זמן וזיכרון);
// בלי גלישה, כפתורים ≥44px, בלי שגיאות JS. (לא מאומת על תמונות אמיתיות.)
// שלב 4ב: הנחיית צילום במקטע של יותר מתמונה אחת; "שמרו תיקונים" ⇒ s3CapPut op geo (quad/xr/yr) דרך התור, גם בלי רשת; טעינה מחדש מחזירה את הערכים.
// שימוש: node ui-st3d-warp.js <www-dir> [out.json] [shot-prefix]
const fs = require('fs'); const path = require('path'); const { execSync } = require('child_process'); const H = require('./harness');
let fail = 0; const res = []; const check = (n, ok, info) => { if (!ok) fail++; res.push({ n, ok: !!ok, info }); console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 500) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const enc = (v) => (v == null ? { nullValue: null } : typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }) : typeof v === 'string' ? { stringValue: v } : Array.isArray(v) ? { arrayValue: { values: v.map(enc) } } : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } });
const DOCS = 'projects/demo-largpeami/databases/(default)/documents/b/biz-s/';
// מקטע 200×100 ס"מ (f1: גונדולה 400 ס"מ, 2 מקטעים, גובה 100) ⇒ חזית 2048×1024; f2: קיר עם 2 מקטעים
const mkMap = () => ({ br: 'main', kind: 's', name: 'חנות הבדיקה', v: 3, seq: 3, grid: 50, numDir: 'rtl', ent: 'd1', src: 'manual', upd: 1763100000000, by: 'm',
  rooms: [{ id: 'r1', name: 'אולם', p: [0, 0, 1200, 0, 1200, 800, 0, 800], h: 300 }], walls: [], cols: [], doors: [{ id: 'd1', x: 600, y: 800, w: 180, a: 0, k: 'ent' }],
  fx: [{ id: 'f1', k: 'gon', x: 600, y: 300, w: 400, d: 90, h: 100, a: 0, sides: 1, bays: 2, lvl: 4, hi: false, room: 'r1', num: 1, name: 'יבשים' },
    { id: 'f2', k: 'wall', x: 600, y: 600, w: 120, d: 50, h: 240, a: 0, sides: 1, bays: 1, lvl: 7, hi: true, room: 'r1', num: 2 }], syms: [] });
const S = { calls: [], docs: {}, st: 0 };
async function server(ctx, jpg) {
  const doc = (name, o) => ({ name: DOCS + name, fields: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, enc(v)])), createTime: '2026-11-03T09:00:00Z', updateTime: '2026-11-03T09:00:00Z' });
  const j = (route, st, b) => route.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(b) });
  await ctx.route((u) => u.port === '8080' && /\/documents\/b\/biz-s\/(smap|s3br|s3sum|sround|s3setup|s3look)/.test(u.pathname), (route) => {
    const p = new URL(route.request().url()).pathname.replace(/^.*\/documents\/b\/biz-s\//, '');
    if (p === 'smap/s-main') return j(route, 200, doc(p, mkMap()));
    if (p === 'sround') return j(route, 200, { documents: [] });
    if (p === 's3setup/s-main/cap') return j(route, 200, { documents: Object.entries(S.docs).map(([k, o]) => doc('s3setup/s-main/cap/' + k, o)) });
    const m = /^s3setup\/s-main\/cap\/(.+)$/.exec(p);
    if (m && S.docs[m[1]]) return j(route, 200, doc(p, S.docs[m[1]]));
    return j(route, 404, { error: { code: 404, status: 'NOT_FOUND' } });
  });
  await ctx.route((u) => /alt=media/.test(u.search), (route) => { S.st++; route.fulfill({ status: 200, contentType: 'image/jpeg', body: jpg() }); });
  const rec = (route, fn) => { let b = {}; try { b = JSON.parse(route.request().postData()).data || {}; } catch (e) { /* */ } S.calls.push({ fn, b }); return b; };
  await ctx.route('**/s3CapPut', (route) => {
    if (S.down) return route.abort('internetdisconnected');/* בלי רשת (setOffline לא עוצר route מדומה) */
    const b = rec(route, 's3CapPut');
    const d = S.docs[b.key] || { k: b.key.split('_')[0], ord: 1, st: 'todo', ph: [], upd: 1, by: 'm' };
    if (b.op === 'ph') { const n = (d.ph || []).length + 1; d.ph = (d.ph || []).concat([{ p: 'b/biz-s/store3d/main/cap/s-main/' + b.key + '_' + n + '.jpg', th: 'b/biz-s/store3d/main/cap/s-main/' + b.key + '_' + n + '_t.jpg', n, lv: b.lv, w: 1600, h: 1200, at: 1, by: 'm' }]); if (d.st !== 'ok') d.st = 'part'; }
    if (b.op === 'geo') { const i = (d.ph || []).findIndex((x) => x.n === b.n); if (i < 0) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { status: 'NOT_FOUND', message: 'התמונה לא נמצאה', details: { reason: 'no-photo' } } }) }); for (const f of ['quad', 'xr', 'yr']) if (b[f]) d.ph[i][f] = b[f]; }
    if (b.op === 'front') Object.assign(d, { fr: 'f', frTh: 'f_t', frV: 1, st: b.man ? 'ok' : 'part', okBy: 'm', man: !!b.man });
    S.docs[b.key] = d;
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { ok: true, mapId: b.mapId, key: b.key, op: b.op, st: d.st, ph: (d.ph || []).length } }) });
  });
  await ctx.route('**/s3View', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { runs: [], fixes: [], take: [] } }) }));
}
const noOverflow = (page) => page.evaluate(() => { const W = document.documentElement.clientWidth; const bad = [...document.querySelectorAll('#main *, #dlg *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > W + 1 || r.left < -1) && !e.closest('.s3tabs') && !e.closest('.s3wpst'); }).map((e) => e.tagName + '.' + e.className).slice(0, 5); return { sw: document.documentElement.scrollWidth, W, bad }; });
// חזית אמת סינתטית (2000×1000) ו"צילום" של טווח [a,b] ממנה, בגודל w×h – בתוך הדף
const mkShot = (page, a, b, w, h, q) => page.evaluate(([a, b, w, h, q]) => {
  if (!window.__G) { const g = document.createElement('canvas'); g.width = 2000; g.height = 1000; const x = g.getContext('2d'); let s = 5; const R = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < 2600; i++) { x.fillStyle = `hsl(${R() * 360},${40 + R() * 50}%,${25 + R() * 50}%)`; x.fillRect(R() * 2000, R() * 1000, 10 + R() * 70, 10 + R() * 90); }
    x.fillStyle = '#ddd'; for (let y = 0; y < 1000; y += 250) x.fillRect(0, y, 2000, 12); window.__G = g; }
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.drawImage(window.__G, a * 2, 0, (b - a) * 2, 1000, 0, 0, w, h);
  /* רעש קל כדי שה-JPEG יהיה בגודל אמיתי */ const d = x.getImageData(0, 0, w, h); for (let i = 0; i < d.data.length; i += 4) { const n = (Math.random() - .5) * 18; d.data[i] += n; d.data[i + 1] += n; d.data[i + 2] += n; } x.putImageData(d, 0, 0);
  return c.toDataURL('image/jpeg', q).split(',')[1]; }, [a, b, w, h, q || .9]).then((s) => ({ name: 'p.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(s, 'base64') }));
const last = (fn) => S.calls.filter((c) => c.fn === fn).slice(-1)[0];
const setRange = (page, i, a, b) => page.evaluate(async ([i, a, b]) => { ACT.s3wpSel({ dataset: { n: String(i) } }); await new Promise((r) => setTimeout(r, 50));
  const A = document.querySelector('#dlg [data-i=s3wpA]'), B = document.querySelector('#dlg [data-i=s3wpB]');
  B.value = String(b); B.dispatchEvent(new Event('input', { bubbles: true })); A.value = String(a); A.dispatchEvent(new Event('input', { bubbles: true })); }, [i, a, b]);
const dlgTx = (page) => page.evaluate(() => document.getElementById('dlg').innerText);
const rss = () => { try { return execSync("ps -eo rss,comm | awk '/chrom/{s+=$1} END{print s}'").toString().trim() | 0; } catch (e) { return 0; } };
const jpgDims = (page, b64) => page.evaluate(async (s) => { const b = await (await fetch('data:image/jpeg;base64,' + s)).blob(); const i = await createImageBitmap(b); return { w: i.width, h: i.height, size: b.size }; }, b64);

(async () => {
  const [www, out, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(path.dirname(shots), { recursive: true });
  const browser = await H.launch();
  const cfg = { mode: 'new', users: { m: 'biz-s' }, biz: { 'biz-s': { dataRoot: 'b', features: { store3d: true }, name: 'עסק בדיקה' } }, admins: { 'b/biz-s/|m': 1 }, staff: {} };
  const { ctx, page } = await H.newPage(browser, www, cfg, [], 'm@x.co'); await page.setViewportSize({ width: 360, height: 760 });
  let stJpg = null; await server(ctx, () => stJpg);
  await H.login(page, 'm@x.co');
  await page.evaluate(() => { const sh = document.getElementById('sheet'); if (sh && !sh.hidden && typeof ACT.startBlank === 'function') ACT.startBlank(); });
  await H.settle(page, 400);
  await page.evaluate(() => go('st3')); await sleep(1800);
  await page.click('[data-a=s3cpOpen]'); await sleep(1500);
  check('0 הקבצים נטענו (S3Warp, wpBtn) ושמות הפעולות החדשות ייחודיים (s3wp*)', await page.evaluate(() => !!window.S3Warp && typeof S3UI.wpBtn === 'function' && typeof ACT.s3wpOpen === 'function' && typeof ACT.s3cpFront === 'function'));
  await page.evaluate(() => { S3UI.K3.cur = 'b_f1-a-1'; S3UI.K3.open = 'r1'; rerender(); }); await sleep(300);
  check('1 לפני צילום – אין כפתור "חיבור וחיתוך" ואין הנחיית צילום (מקטע רגיל בלי תמונות)', !(await page.$('[data-a=s3wpOpen]')) && !(await page.$('[data-tip=wp]')));

  // ---- 2. שלוש תמונות חופפות: [0–400], [300–700], [600–1000] ----
  const XR = [[0, 400], [300, 700], [600, 1000]];
  for (const [a, b] of XR) { await page.setInputFiles('input[data-c=s3cpPick]', await mkShot(page, a, b, 1200, 1500)); await sleep(1800); }
  const nPh = S.calls.filter((c) => c.fn === 's3CapPut' && c.b.op === 'ph').length;
  const b2 = await page.evaluate(() => (document.querySelector('[data-a=s3wpOpen]') || {}).innerText);
  check('2 אחרי 3 צילומים: 3 נשלחו (op ph) ויש "חיבור וחיתוך (3)"', nPh === 3 && /חיבור וחיתוך \(3\)/.test(b2 || ''), { nPh, b2 });
  const tip = await page.evaluate(() => (document.querySelector('[data-tip=wp]') || {}).innerText || '');
  check('2-הנחיה: אחרי תמונה ראשונה – "צלמו מאותו מרחק ובזווית ישרה…"', /צלמו מאותו מרחק ובזווית ישרה; כוונו שהחיבור בין תמונות ייפול על שפת מדף או על עמוד/.test(tip), tip);
  await page.click('[data-a=s3wpOpen]'); await sleep(600);
  const d1 = await page.evaluate(() => ({ open: document.getElementById('dlg').open, th: document.querySelectorAll('#dlg .s3wpst button').length, imgs: [...document.querySelectorAll('#dlg .s3wpst img')].filter((i) => /^blob:/.test(i.src)).length, c: document.querySelectorAll('#dlg svg[data-wp=q] circle').length, rg: document.querySelectorAll('#dlg input[type=range]').length, cv: document.querySelectorAll('#dlg .s3wpcv i').length }));
  check('2א העורך נפתח: 3 תמונות (מהזיכרון, בלי הורדה), 4 פינות, 2 מחוונים לטווח, פס כיסוי', d1.open && d1.th === 3 && d1.imgs === 3 && d1.c === 4 && d1.rg === 2 && d1.cv === 3 && S.st === 0, Object.assign(d1, { st: S.st }));
  if (shots) { await sleep(300); await page.screenshot({ path: shots + '-editor.png' }); }
  let o = await noOverflow(page); check('2ב העורך בלי גלישה ב-360px', o.sw <= o.W && !o.bad.length, o);
  const small = await page.evaluate(() => [...document.querySelectorAll('#dlg .btn, #dlg .s3wpst button, #dlg input[type=range]')].filter((b) => b.getBoundingClientRect().height < 43).map((b) => b.innerText || b.dataset.i));
  check('2ג כל הכפתורים והמחוונים בעורך לפחות 44px', !small.length, small);
  // ברירת מחדל (בלי AI): חלוקה שווה ⇒ אין חסר
  for (let i = 0; i < 3; i++) await setRange(page, i, XR[i][0], XR[i][1]);
  const cvW = await page.evaluate(() => [...document.querySelectorAll('#dlg .s3wpcv i')].map((i) => i.style.left + '/' + i.style.width));
  check('2ד המחוונים מעדכנים את הטווח ואת פס הכיסוי (0/40, 30/40, 60/40)', cvW.join() === '0%/40%,30%/40%,60%/40%', cvW);
  const tb = Date.now(); await page.click('[data-a=s3wpBuild]'); await page.waitForFunction(() => /החזית מלאה|חסר קטע|לא הצלחנו/.test(document.getElementById('dlg').innerText), null, { timeout: 30000 }); const msB = Date.now() - tb;
  let t = await dlgTx(page);
  check('3 3 חופפות ⇒ חזית אחת מלאה, "אשרו חזית" פתוח', /החזית מלאה/.test(t) && /3 תמונות/.test(t) && !(await page.evaluate(() => document.querySelector('[data-a=s3wpSave]').disabled)), { t: t.slice(0, 160), ms: msB });
  if (shots) { await sleep(300); await page.screenshot({ path: shots + '-front.png' }); }
  o = await noOverflow(page); check('3א תצוגת החזית בלי גלישה', o.sw <= o.W && !o.bad.length, o);

  // ---- 4. פער אמיתי ⇒ "חסר קטע", אשרו נעול ----
  await page.click('[data-a=s3wpBack]'); await sleep(200);
  await setRange(page, 1, 300, 550); await setRange(page, 2, 700, 1000);
  await page.click('[data-a=s3wpBuild]'); await page.waitForFunction(() => /החזית מלאה|חסר קטע|לא הצלחנו/.test(document.getElementById('dlg').innerText), null, { timeout: 30000 });
  t = await dlgTx(page);
  const g4 = await page.evaluate(() => ({ dis: document.querySelector('[data-a=s3wpSave]').disabled, mark: document.querySelectorAll('#dlg .s3wppv i').length }));
  check('4 פער 55%–70% ⇒ "חסר קטע: ~55%–70%" (התחלה יכולה לזוז קצת בגלל תיקון ההזזה), סימון אדום על החזית, "אשרו חזית" נעול', /חסר קטע/.test(t) && /5[4-9]%–70%/.test(t) && g4.dis && g4.mark === 1, { t: t.slice(0, 200), g4 });
  if (shots) { await sleep(300); await page.screenshot({ path: shots + '-gap.png' }); }
  const n4 = S.calls.length; await page.evaluate(() => ACT.s3wpSave()); await sleep(300);
  check('4א עם חסר – שמירה לא נשלחת גם בקריאה ישירה', S.calls.length === n4);

  // ---- 5. גרירת פינה (יעד מגע ~30px סביב הנקודה) ----
  await page.click('[data-a=s3wpBack]'); await sleep(200);
  await page.evaluate(() => ACT.s3wpSel({ dataset: { n: '0' } })); await sleep(200);
  const box = await page.evaluate(() => { const r = document.querySelector('#dlg svg[data-wp=q]').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  await page.mouse.move(box.x + 18, box.y + 16); await page.mouse.down(); await page.mouse.move(box.x + 40, box.y + 30, { steps: 4 }); await page.mouse.up(); await sleep(200);
  const q5 = await page.evaluate(() => { const e = S3UI.K3 && Object.values(window.__wpEd || {}); return [...document.querySelectorAll('#dlg svg[data-wp=q] circle')].map((c) => +(+c.getAttribute('cx')).toFixed(1)); });
  check('5 גרירה של הפינה השמאלית-עליונה (נגיעה 18px ממנה) מזיזה אותה', q5[0] > 5 && q5[1] > 95, q5);
  await page.evaluate(() => ACT.s3wpReset()); await sleep(150);
  const q5b = await page.evaluate(() => [...document.querySelectorAll('#dlg svg[data-wp=q] circle')].map((c) => +(+c.getAttribute('cx')).toFixed(1)));
  check('5א "כל התמונה" מחזיר את הפינות', q5b[0] === 0 && q5b[1] === 100, q5b);

  // ---- 6. תיקון ושמירה ⇒ s3CapPut op front ----
  await setRange(page, 1, 300, 700); await setRange(page, 2, 600, 1000);
  await page.click('[data-a=s3wpBuild]'); await page.waitForFunction(() => /החזית מלאה|חסר קטע|לא הצלחנו/.test(document.getElementById('dlg').innerText), null, { timeout: 30000 });
  await page.click('[data-a=s3wpSave]'); await sleep(1500);
  const p6 = last('s3CapPut');
  const dm = p6 && p6.b.op === 'front' ? await jpgDims(page, p6.b.img) : {}, dt = p6 && p6.b.op === 'front' ? await jpgDims(page, p6.b.th) : {};
  const after = await page.evaluate(() => ({ open: document.getElementById('dlg').open, cur: S3UI.K3.cur, msg: (document.querySelector('.s3k').innerText.match(/החזית המחוברת נשמרה[^\n]*/) || [''])[0] }));
  check('6 שמירה: op front, man:true, key נכון, qid; JPEG ≤2048px ו-≤1.5MB; מוקטנת ≤512', !!p6 && p6.b.op === 'front' && p6.b.man === true && p6.b.key === 'b_f1-a-1' && /^[A-Za-z0-9-]{16,40}$/.test(p6.b.qid) && dm.w === 2048 && dm.h === 1024 && dm.size <= 1500000 && Math.max(dt.w, dt.h) <= 512 && dt.size <= 150000, { dm, dt });
  check('6א אחרי השמירה: העורך נסגר, עוברים לפריט הבא, הודעה בעברית', !after.open && after.cur !== 'b_f1-a-1' && !!after.msg, after);

  // ---- 7. תמונה שכבר בשרת (לא מהצילום הנוכחי) נטענת מ-Storage ----
  stJpg = (await mkShot(page, 0, 1000, 1600, 800)).buffer;
  S.docs['b_f1-a-2'] = { k: 'b', ord: 5, st: 'part', ph: [{ p: 'b/biz-s/store3d/main/cap/s-main/b_f1-a-2_1.jpg', th: 'b/biz-s/store3d/main/cap/s-main/b_f1-a-2_1_t.jpg', n: 1, lv: 'a', w: 1600, h: 800, at: 1, by: 'm', quad: [0, 0, 1000, 0, 1000, 1000, 0, 1000], xr: { a: 0, b: 1000 } }], upd: 1, by: 'm' };
  await page.evaluate(() => ACT.s3cpReload()); await sleep(1500);
  await page.evaluate(() => { S3UI.K3.cur = 'b_f1-a-2'; rerender(); }); await sleep(200);
  await page.click('[data-a=s3wpOpen]'); await sleep(800);
  await page.click('[data-a=s3wpBuild]'); await page.waitForFunction(() => /החזית מלאה|חסר קטע|לא הצלחנו/.test(document.getElementById('dlg').innerText), null, { timeout: 30000 });
  t = await dlgTx(page);
  check('7 תמונה מהשרת (quad/xr מהשרת): מוקטנת + מלאה נטענו מ-Storage, חזית מלאה', S.st >= 2 && /החזית מלאה/.test(t), { st: S.st, t: t.slice(0, 120) });
  await page.evaluate(() => ACT.s3wpClose());

  // ---- 8. זיכרון: 6 תמונות 1600px לאותו מקטע ----
  S.docs = {}; await page.evaluate(() => ACT.s3cpReload()); await sleep(1500);
  await page.evaluate(() => { S3UI.K3.cur = 'b_f1-a-2'; rerender(); }); await sleep(200);
  const X6 = [[0, 200], [160, 360], [320, 520], [480, 680], [640, 840], [800, 1000]];
  for (const [a, b] of X6) { await page.setInputFiles('input[data-c=s3cpPick]', await mkShot(page, a, b, 1600, 1200, .95)); await sleep(1600); }
  const sizes = S.calls.filter((c) => c.fn === 's3CapPut' && c.b.op === 'ph' && c.b.key === 'b_f1-a-2').map((c) => Math.round(c.b.img.length * 3 / 4 / 1024));
  await page.click('[data-a=s3wpOpen]'); await sleep(600);
  for (let i = 0; i < 6; i++) await setRange(page, i, X6[i][0], X6[i][1]);
  const cdp = await ctx.newCDPSession(page); await cdp.send('Performance.enable');
  const heap = async () => { try { const m = (await cdp.send('Performance.getMetrics')).metrics; return (m.find((x) => x.name === 'JSHeapUsedSize') || {}).value || 0; } catch (e) { return 0; } };
  const h0 = await heap(), r0 = rss(); let rMax = r0, hMax = h0, on = true;
  const iv = setInterval(() => { const r = rss(); if (r > rMax) rMax = r; }, 100);
  const hp = (async () => { while (on) { const h = await heap(); if (h > hMax) hMax = h; await sleep(30); } })();
  const t8 = Date.now(); await page.click('[data-a=s3wpBuild]'); await page.waitForFunction(() => /החזית מלאה|חסר קטע|לא הצלחנו/.test(document.getElementById('dlg').innerText), null, { timeout: 60000 }); const ms8 = Date.now() - t8;
  clearInterval(iv); on = false; await hp;
  const m8 = { peak: hMax, end: await heap() };
  t = await dlgTx(page);
  const MEM = { photosKB: sizes, ms: ms8, jsHeapMB: { before: +(h0 / 1048576).toFixed(1), peak: +(m8.peak / 1048576).toFixed(1), after: +(m8.end / 1048576).toFixed(1) }, chromeRssMB: { before: Math.round(r0 / 1024), peak: Math.round(rMax / 1024), delta: Math.round((rMax - r0) / 1024) } };
  console.log('  זיכרון 6×1600:', JSON.stringify(MEM));
  check('8 6 תמונות 1600×1200 ⇒ חזית מלאה בלי קריסה (הדף חי, אין שגיאות JS)', sizes.length === 6 && /החזית מלאה/.test(t) && /6 תמונות/.test(t) && !(page.__errors || []).length, MEM);
  if (shots) { await sleep(300); await page.screenshot({ path: shots + '-six.png' }); }
  o = await noOverflow(page); check('8א בלי גלישה עם 6 תמונות', o.sw <= o.W && !o.bad.length, o);
  // ---- 9. מדף גבוה: עליון בלבד ⇒ מחווני גובה (yr) ו"חסר קטע" בתחתון ----
  await page.evaluate(() => ACT.s3wpClose());
  await page.evaluate(() => { S3UI.K3.cur = 'b_f2-a-1'; rerender(); }); await sleep(200);
  await page.setInputFiles('input[data-c=s3cpPick][data-lv=t]', await mkShot(page, 0, 1000, 1200, 1200)); await sleep(1800);
  await page.click('[data-a=s3wpOpen]'); await sleep(600);
  const d9 = await page.evaluate(() => ({ rg: [...document.querySelectorAll('#dlg input[type=range]')].map((i) => i.dataset.i + ':' + i.value), bars: document.querySelectorAll('#dlg .s3wpcv').length }));
  check('9 מדף גבוה: 4 מחוונים (רוחב + גובה 0–50%), 2 פסי כיסוי', d9.rg.join() === 's3wpA:0,s3wpB:1000,s3wpC:0,s3wpD:500' && d9.bars === 2, d9);
  await page.click('[data-a=s3wpBuild]'); await page.waitForFunction(() => /החזית מלאה|חסר קטע|לא הצלחנו/.test(document.getElementById('dlg').innerText), null, { timeout: 30000 });
  t = await dlgTx(page);
  check('9א עליון בלבד ⇒ "חסר קטע: תחתון: 0%–100%", אשרו נעול', /חסר קטע/.test(t) && /תחתון: 0%–100%/.test(t) && await page.evaluate(() => document.querySelector('[data-a=s3wpSave]').disabled), t.slice(0, 200));

  // ---- 10. שלב 4ב: שמירת התיקונים בשרת (op geo), בלי רשת, וטעינה מחדש ----
  await page.click('[data-a=s3wpBack]').catch(() => {}); await sleep(200);
  const geo0 = S.calls.filter((c) => c.fn === 's3CapPut' && c.b.op === 'geo').length;
  await ctx.setOffline(true); S.down = true; await sleep(200);
  await page.evaluate(() => { const set = (i, v) => { const e = document.querySelector('#dlg [data-i=' + i + ']'); e.value = String(v); e.dispatchEvent(new Event('input', { bubbles: true })); };
    set('s3wpB', 800); set('s3wpA', 100); set('s3wpD', 650); set('s3wpC', 0); });
  await sleep(150);
  const hasBtn = await page.evaluate(() => { const b = document.querySelector('#dlg [data-a=s3wpGeo]'); return !!b && !b.disabled; });
  await page.click('[data-a=s3wpGeo]'); await sleep(600);
  const tOff = await dlgTx(page);
  check('10 תיקון ⇒ כפתור "שמרו תיקונים"; בלי רשת – לא נשלח, הודעה "יישלחו כשתהיה רשת"', hasBtn && S.calls.filter((c) => c.fn === 's3CapPut' && c.b.op === 'geo').length === geo0 && /יישלחו כשתהיה רשת/.test(tOff), { hasBtn, t: tOff.slice(-120), sent: S.calls.filter((c) => c.fn === 's3CapPut' && c.b.op === 'geo').slice(geo0).map((c) => c.b) });
  await ctx.setOffline(false); S.down = false; await page.evaluate(() => window.dispatchEvent(new Event('online'))); await sleep(1500);
  const g10 = S.calls.filter((c) => c.fn === 's3CapPut' && c.b.op === 'geo').slice(geo0);
  check('10א חזרה לרשת ⇒ s3CapPut op geo אחד: key, n=1, xr 100–800, yr 0–650, בלי quad (לא נערך), qid', g10.length === 1 && g10[0].b.key === 'b_f2-a-1' && g10[0].b.n === 1 && JSON.stringify(g10[0].b.xr) === '{"a":100,"b":800}' && JSON.stringify(g10[0].b.yr) === '{"a":0,"b":650}' && g10[0].b.quad === undefined && /^[A-Za-z0-9-]{16,40}$/.test(g10[0].b.qid), g10.map((c) => c.b));
  check('10ב אחרי השמירה "שמרו תיקונים" נעול (אין תיקון חדש)', await page.evaluate(() => document.querySelector('#dlg [data-a=s3wpGeo]').disabled));
  // שינוי פינה ⇒ נשמר ב"סגרו"
  await page.evaluate(() => ACT.s3wpSel({ dataset: { n: '0' } })); await sleep(150);
  const bx = await page.evaluate(() => { const r = document.querySelector('#dlg svg[data-wp=q]').getBoundingClientRect(); return { x: r.left, y: r.top }; });
  await page.mouse.move(bx.x + 4, bx.y + 4); await page.mouse.down(); await page.mouse.move(bx.x + 30, bx.y + 24, { steps: 4 }); await page.mouse.up(); await sleep(150);
  await page.evaluate(() => ACT.s3wpClose()); await sleep(1200);
  const g10c = S.calls.filter((c) => c.fn === 's3CapPut' && c.b.op === 'geo').slice(geo0 + 1);
  check('10ג גרירת פינה ואז "סגרו" ⇒ op geo עם quad שהשתנה', g10c.length === 1 && g10c[0].b.quad[0] > 0 && g10c[0].b.quad[1] > 0, g10c.map((c) => c.b));
  // טעינה מחדש מהשרת (המסמך המדומה עודכן לפי op geo) ⇒ העורך נפתח עם אותם ערכים
  await page.evaluate(() => ACT.s3cpReload()); await sleep(1500);
  await page.evaluate(() => { S3UI.K3.cur = 'b_f2-a-1'; rerender(); }); await sleep(200);
  await page.click('[data-a=s3wpOpen]'); await sleep(600);
  const d10 = await page.evaluate(() => ({ rg: [...document.querySelectorAll('#dlg input[type=range]')].map((i) => i.dataset.i + ':' + i.value).join(), cx: +document.querySelector('#dlg svg[data-wp=q] circle').getAttribute('cx'), btn: !document.querySelector('#dlg [data-a=s3wpGeo]').disabled }));
  check('10ד אחרי טעינה מחדש: הטווחים (100–800, 0–650) והפינה נטענו מ-ph[] של השרת, "שמרו תיקונים" נעול', d10.rg === 's3wpA:100,s3wpB:800,s3wpC:0,s3wpD:650' && d10.cx > 0 && !d10.btn && JSON.stringify(S.docs['b_f2-a-1'].ph[0].yr) === '{"a":0,"b":650}', d10);
  await page.evaluate(() => ACT.s3wpClose());
  check('9ב אין שגיאות JavaScript', !(page.__errors || []).length, page.__errors);
  res.push({ n: 'mem', ok: true, info: MEM });

  await ctx.close(); await browser.close();
  if (out) fs.writeFileSync(out, JSON.stringify({ fail, res }, null, 1));
  console.log(fail ? `נכשלו ${fail}` : 'הכול עבר');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
