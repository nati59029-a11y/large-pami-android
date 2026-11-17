'use strict';
// הקמת חנות – שלב 3 (17.11.2026): המסך "צילום החנות" (store3d-setupcap.js + store3d-capplan.js). רשת מדומה, בלי אמולטור ובלי AI.
// בודק (360px): כפתור הכניסה רק למנהל / s3m; תוכנית הצילום בטלפון זהה לחישוב של S3Plan (דלת הכניסה ראשונה); מפה (SVG) עם הפריט הנוכחי בזהב;
// צילום ← תור ← s3CapPut (op ph, qid, key, lv, base64 JPEG) ← "אשרו כחזית" (op front, man); מדף גבוה = עליון/תחתון; דילוג רק עם סיבה;
// "סיום ההקמה" נעול עד שהכול הושלם, ואז s3SetupDone; שרת ישן (403) – הודעה בעברית; עובד בלי s3m – אין כניסה ואין בקשות; בלי גלישה, כפתורים ≥44px, בלי שגיאות JS.
// שימוש: node ui-st3d-setup.js <www-dir> [out.json] [shot-prefix]
const fs = require('fs'); const path = require('path'); const H = require('./harness');
let fail = 0; const res = []; const check = (n, ok, info) => { if (!ok) fail++; res.push({ n, ok: !!ok, info }); console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const enc = (v) => (v == null ? { nullValue: null } : typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }) : typeof v === 'string' ? { stringValue: v } : Array.isArray(v) ? { arrayValue: { values: v.map(enc) } } : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } });
const DOCS = 'projects/demo-largpeami/databases/(default)/documents/b/biz-s/';
const mkMap = () => ({ br: 'main', kind: 's', name: 'חנות הבדיקה', v: 3, seq: 3, grid: 50, numDir: 'rtl', ent: 'd1', src: 'manual', upd: 1763100000000, by: 'm',
  rooms: [{ id: 'r1', name: 'אולם', p: [0, 0, 1000, 0, 1000, 800, 0, 800], h: 300 }], walls: [], cols: [], doors: [{ id: 'd1', x: 500, y: 800, w: 180, a: 0, k: 'ent' }],
  fx: [{ id: 'f1', k: 'gon', x: 300, y: 300, w: 200, d: 90, h: 180, a: 0, sides: 2, bays: 2, lvl: 5, hi: false, room: 'r1', num: 1, name: 'ירקות' },
    { id: 'f3', k: 'gon', x: 600, y: 500, w: 120, d: 90, h: 260, a: 0, sides: 1, bays: 1, lvl: 6, hi: true, room: 'r1', num: 2 }], syms: [{ id: 'y1', k: 'cash', x: 850, y: 700, a: 0 }] });
const S = { calls: [], docs: {}, setup: null, deny: false, fail: '' };
const ALL = { store3d: true };
async function server(ctx) {
  const doc = (name, o) => ({ name: DOCS + name, fields: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, enc(v)])), createTime: '2026-11-03T09:00:00Z', updateTime: '2026-11-03T09:00:00Z' });
  const j = (route, st, b) => route.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(b) });
  await ctx.route((u) => u.port === '8080' && /\/documents\/b\/biz-s\/(smap|s3br|s3sum|sround|s3setup|s3look)/.test(u.pathname), (route) => {
    const p = new URL(route.request().url()).pathname.replace(/^.*\/documents\/b\/biz-s\//, '');
    if (p === 'smap/s-main') return j(route, 200, doc(p, mkMap()));
    if (p === 'sround') return j(route, 200, { documents: [] });
    if (/^s3setup/.test(p) && S.deny) return j(route, 403, { error: { code: 403, status: 'PERMISSION_DENIED' } });
    if (p === 's3setup/s-main/cap') return j(route, 200, { documents: Object.entries(S.docs).map(([k, o]) => doc('s3setup/s-main/cap/' + k, o)) });
    const m = /^s3setup\/s-main\/cap\/(.+)$/.exec(p);
    if (m && S.docs[m[1]]) return j(route, 200, doc(p, S.docs[m[1]]));
    if (p === 's3setup/s-main' && S.setup) return j(route, 200, doc(p, S.setup));
    return j(route, 404, { error: { code: 404, status: 'NOT_FOUND' } });
  });
  const rec = (route, fn) => { let b = {}; try { b = JSON.parse(route.request().postData()).data || {}; } catch (e) { /* */ } S.calls.push({ fn, b }); return b; };
  const ok = (route, r) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: r }) });
  await ctx.route('**/s3CapPut', (route) => {
    const b = rec(route, 's3CapPut');
    if (S.fail) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { status: 'FAILED_PRECONDITION', message: 'הפריט הזה כבר לא נמצא במפה', details: { reason: S.fail } } }) });
    const d = S.docs[b.key] || { k: b.key.split('_')[0], ord: 1, st: 'todo', ph: [], upd: 1, by: 'm' };
    if (b.op === 'ph') { d.ph = (d.ph || []).concat([{ p: 'x', th: 'x', n: (d.ph || []).length + 1, lv: b.lv, w: 800, h: 600, at: 1, by: 'm' }]); if (d.st !== 'ok') d.st = 'part'; }
    if (b.op === 'front') Object.assign(d, { fr: 'f', frTh: 'f_t', frV: 1, st: b.man ? 'ok' : 'part', okBy: 'm', man: !!b.man });
    if (b.op === 'skip') Object.assign(d, { st: 'skip', why: b.why });
    if (b.op === 'unskip') { d.st = d.ph && d.ph.length ? 'part' : 'todo'; delete d.why; }
    S.docs[b.key] = d;
    ok(route, { ok: true, mapId: b.mapId, key: b.key, op: b.op, st: d.st, ph: (d.ph || []).length });
  });
  await ctx.route('**/s3SetupDone', (route) => { rec(route, 's3SetupDone'); ok(route, { ok: true, mapId: 's-main', n: 1, done: 1, skip: 0, notes: 0 }); });
  await ctx.route('**/s3View', (route) => ok(route, { runs: [], fixes: [], take: [] }));
}
async function open(browser, www, cfg, email, perms) {
  const { ctx, page } = await H.newPage(browser, www, cfg, [], email); await page.setViewportSize({ width: 360, height: 760 });
  const uid = email.split('@')[0]; await server(ctx);
  if (perms) await ctx.route((u) => u.port === '8080' && new RegExp('/staff/' + uid + '$').test(u.pathname), (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ name: 'x', fields: { active: { booleanValue: true }, perms: enc(perms) } }) }));
  await H.login(page, email);
  await page.evaluate(() => { const sh = document.getElementById('sheet'); if (sh && !sh.hidden && typeof ACT.startBlank === 'function') ACT.startBlank(); });
  await H.settle(page, 400);
  return { ctx, page };
}
const noOverflow = (page) => page.evaluate(() => { const W = document.documentElement.clientWidth; const bad = [...document.querySelectorAll('#main *, #dlg *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > W + 1 || r.left < -1) && !e.closest('.s3tabs'); }).map((e) => e.tagName + '.' + e.className).slice(0, 5); return { sw: document.documentElement.scrollWidth, W, bad }; });
const mkImg = (page) => page.evaluate(() => { const c = document.createElement('canvas'); c.width = 800; c.height = 600; const x = c.getContext('2d');
  for (let i = 0; i < 100; i++) for (let j = 0; j < 75; j++) { x.fillStyle = `rgb(${(i * 37 + j * 11) % 256},${(i * 17 + j * 53) % 256},${(i * 71 + j * 29) % 256})`; x.fillRect(i * 8, j * 8, 8, 8); }
  return c.toDataURL('image/jpeg', .9).split(',')[1]; }).then((b) => ({ name: 'sharp.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(b, 'base64') }));
const last = (fn) => S.calls.filter((c) => c.fn === fn).slice(-1)[0];
const shot = async (page, f) => { if (f) { await sleep(300); await page.screenshot({ path: f }); } };
const fp = (f, s) => f ? f + '-' + s + '.png' : null;

(async () => {
  const [www, out, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(path.dirname(shots), { recursive: true });
  const browser = await H.launch();
  const cM = () => ({ mode: 'new', users: { m: 'biz-s', w: 'biz-s', d: 'biz-s' }, biz: { 'biz-s': { dataRoot: 'b', features: ALL, name: 'עסק בדיקה' } }, admins: { 'b/biz-s/|m': 1 }, staff: { 'b/biz-s/|w': 1, 'b/biz-s/|d': 1 } });

  // ---- 1. מנהל: כניסה, תוכנית ומפה ----
  const A = await open(browser, www, cM(), 'm@x.co');
  await A.page.evaluate(() => go('st3')); await sleep(1800);
  check('1 מסך התלת מימד: יש כפתור "צילום החנות" למנהל', await A.page.evaluate(() => !!document.querySelector('[data-a=s3cpOpen]')));
  await A.page.click('[data-a=s3cpOpen]'); await sleep(1500);
  const o1 = await A.page.evaluate((m) => { const pl = S3Plan.capPlan(m); return { v: cur().v, n: pl.n, first: pl.items[0].key, kcur: S3UI.K3.cur, head: (document.querySelector('.s3k > b') || {}).innerText, svg: !!document.querySelector('svg.s3kmap'),
    gold: [...document.querySelectorAll('svg.s3kmap [stroke="#d4a017"], svg.s3kmap [fill="#d4a017"]')].length, info: (document.querySelector('.s3k .s3info') || {}).innerText }; }, mkMap());
  check('1א נפתח "צילום החנות": הושלמו 0 מתוך N (N = S3Plan.capPlan), מתחילים מדלת הכניסה', o1.v === 'st3k' && o1.first === 'd_d1' && o1.kcur === 'd_d1' && new RegExp('הושלמו 0 מתוך ' + o1.n).test(o1.head || ''), o1);
  check('1ב מפה (SVG) עם הפריט הנוכחי בזהב, וכרטיס עם הנחיה בעברית', o1.svg && o1.gold === 1 && /דלת 1/.test(o1.info || '') && /צלמו את הדלת/.test(o1.info || ''), o1);
  let o = await noOverflow(A.page); check('1ג בלי גלישה ב-360px', o.sw <= o.W && !o.bad.length, o);
  const small = await A.page.evaluate(() => [...document.querySelectorAll('.s3k .btn, .s3k label.btn, .s3kcc button, .s3k .hd')].filter((b) => b.getBoundingClientRect().height < 43).map((b) => b.innerText));
  check('1ד כל הכפתורים לפחות 44px', !small.length, small);

  // ---- 2. צילום ← תור ← s3CapPut; "אשרו כחזית" ----
  await A.page.setInputFiles('input[data-c=s3cpPick]', await mkImg(A.page)); await sleep(2500);
  const p1 = last('s3CapPut');
  check('2 צילום: s3CapPut עם qid, mapId, key=d_d1, op ph, lv a, img+th ב-base64 JPEG', !!p1 && /^[A-Za-z0-9-]{16,40}$/.test(p1.b.qid) && p1.b.mapId === 's-main' && p1.b.key === 'd_d1' && p1.b.op === 'ph' && p1.b.lv === 'a' && /^\/9j\//.test(p1.b.img) && /^\/9j\//.test(p1.b.th), p1 && Object.keys(p1.b));
  const o2 = await A.page.evaluate(() => ({ q: Object.keys(S3UI.K3.q).length, front: !!document.querySelector('[data-a=s3cpFront]'), st: (document.querySelector('.s3k .s3info') || {}).innerText }));
  check('2א אחרי השליחה: התור ריק, הפריט "צולם – עוד לא אושר", יש "אשרו כחזית"', o2.q === 0 && o2.front && /צולם – עוד לא אושר/.test(o2.st || ''), o2);
  if (shots) await shot(A.page, fp(shots, 'cap'));
  await A.page.click('[data-a=s3cpFront]'); await sleep(1500);
  const p2 = last('s3CapPut');
  const o3 = await A.page.evaluate(() => ({ cur: S3UI.K3.cur, head: (document.querySelector('.s3k > b') || {}).innerText }));
  check('2ב "אשרו כחזית": op front עם man:true ואותה תמונה; עוברים לפריט הבא; הושלם 1', p2.b.op === 'front' && p2.b.man === true && p2.b.key === 'd_d1' && /^\/9j\//.test(p2.b.img) && o3.cur !== 'd_d1' && /הושלמו 1 /.test(o3.head || ''), { b: p2 && { op: p2.b.op, man: p2.b.man }, o3 });

  // ---- 3. מדף גבוה: עליון ותחתון ----
  await A.page.evaluate(() => { S3UI.K3.cur = 'b_f3-a-1'; S3UI.K3.open = 'r1'; rerender(); }); await sleep(300);
  const hi = await A.page.evaluate(() => [...document.querySelectorAll('.s3k label.btn input[data-c=s3cpPick]')].map((i) => i.dataset.lv + ':' + i.parentElement.innerText.trim()));
  check('3 מדף גבוה: "צלמו עליון" ו"צלמו תחתון"', hi.join() === 't:צלמו עליון,b:צלמו תחתון', hi);
  await A.page.setInputFiles('input[data-c=s3cpPick][data-lv=t]', await mkImg(A.page)); await sleep(2500);
  check('3א צילום עליון: lv=t, והודעה לצלם את התחתונה', last('s3CapPut').b.lv === 't' && /התחתונה/.test(await A.page.evaluate(() => document.querySelector('.s3k').innerText)), last('s3CapPut').b.lv);

  // ---- 4. דילוג רק עם סיבה ----
  await A.page.evaluate(() => { S3UI.K3.cur = 'k_y1'; rerender(); }); await sleep(200);
  await A.page.click('[data-a=s3cpSkip]'); await sleep(300);
  const n0 = S.calls.length;
  await A.page.click('[data-a=s3cpSkipGo]'); await sleep(400);
  check('4 דילוג בלי סיבה – לא נשלח', S.calls.length === n0 && await A.page.evaluate(() => document.getElementById('dlg').open));
  o = await noOverflow(A.page); check('4א חלון הדילוג בלי גלישה', o.sw <= o.W && !o.bad.length, o);
  await A.page.click('[data-a=s3cpWhy]'); await A.page.click('[data-a=s3cpSkipGo]'); await sleep(1200);
  const p4 = last('s3CapPut');
  check('4ב דילוג עם סיבה: op skip עם why', p4.b.op === 'skip' && p4.b.key === 'k_y1' && p4.b.why === 'מוסתר / אין גישה', p4.b);

  // ---- 5. סיום: נעול עד שהכול הושלם ----
  check('5 "סיום ההקמה" נעול כשיש פריטים חסרים', await A.page.evaluate(() => document.querySelector('[data-a=s3cpDone]').disabled));
  const all = await A.page.evaluate((m) => S3Plan.capPlan(m).items.map((i) => ({ key: i.key, k: i.k, ord: i.ord, geo: i.geo })), mkMap());
  for (const it of all) S.docs[it.key] = { k: it.k, ord: it.ord, st: 'ok', geo: it.geo, okBy: 'm', fr: 'f', upd: 1, by: 'm' };
  await A.page.evaluate(() => ACT.s3cpReload()); await sleep(1500);
  const dn = await A.page.evaluate(() => ({ dis: document.querySelector('[data-a=s3cpDone]').disabled, head: (document.querySelector('.s3k > b') || {}).innerText }));
  check('5א כשהכול הושלם – "סיום ההקמה" פתוח', !dn.dis && new RegExp('הושלמו ' + all.length + ' מתוך ' + all.length).test(dn.head || ''), dn);
  await A.page.click('[data-a=s3cpDone]'); await sleep(1200);
  const pd = last('s3SetupDone');
  check('5ב סיום: s3SetupDone עם qid ו-mapId, והודעה בעברית', !!pd && pd.b.mapId === 's-main' && /^[A-Za-z0-9-]{16,40}$/.test(pd.b.qid) && /ההקמה הסתיימה/.test(await A.page.evaluate(() => document.querySelector('.s3k').innerText)), pd && pd.b);
  if (shots) await shot(A.page, fp(shots, 'done'));

  // ---- 6. שרת/כללים ישנים (403) ----
  S.deny = true; await A.page.evaluate(() => ACT.s3cpReload()); await sleep(1200);
  check('6 כללים ישנים (403 על s3setup): "העדכון בשרת עוד לא הותקן"', /העדכון בשרת עוד לא הותקן/.test(await A.page.evaluate(() => document.querySelector('#main').innerText)));
  S.deny = false;
  check('6א אין שגיאות JavaScript (מנהל)', !(A.page.__errors || []).length, A.page.__errors);
  await A.ctx.close();

  // ---- 7. עובד בלי s3m: אין כניסה ואין בקשות ----
  const W = await open(browser, www, cM(), 'w@x.co');
  await W.page.evaluate(() => go('st3')); await sleep(1800);
  const nc = S.calls.length;
  const w1 = await W.page.evaluate(async () => { const b = !!document.querySelector('[data-a=s3cpOpen]'); ACT.s3cpOpen({ dataset: { k: 's' } }); await new Promise((r) => setTimeout(r, 600)); go('st3k'); await new Promise((r) => setTimeout(r, 300)); return { b, t: document.querySelector('#main').innerText }; });
  check('7 עובד בלי s3m: אין כפתור, פתיחה ישירה לא טוענת ולא שולחת, הודעה בעברית', !w1.b && S.calls.length === nc && /שרטוט מפה/.test(w1.t), { b: w1.b, n: S.calls.length - nc });
  await W.ctx.close();

  // ---- 8. עובד עם s3m: יש כניסה ----
  const D = await open(browser, www, cM(), 'd@x.co', { s3m: true });
  await D.page.evaluate(() => go('st3')); await sleep(1800);
  check('8 עובד עם s3m: יש כפתור "צילום החנות"', await D.page.evaluate(() => !!document.querySelector('[data-a=s3cpOpen]')));
  await D.ctx.close();

  await browser.close();
  if (out) fs.writeFileSync(out, JSON.stringify({ fail, res }, null, 1));
  console.log(fail ? `נכשלו ${fail}` : 'הכול עבר');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
