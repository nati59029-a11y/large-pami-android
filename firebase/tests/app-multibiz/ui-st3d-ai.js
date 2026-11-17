'use strict';
// הקמת חנות – שלב 5 (17.11.2026): "בדיקה חכמה" ו"המערכת מציעה" (store3d-capai.js) במסך "צילום החנות". רשת מדומה, בלי אמולטור ובלי AI אמיתי.
// בודק (360px): הכפתור רק כשיש תמונה בשרת; s3CapCheck עם qid/mapId/key; "נכתב X, נמצא Y"; מוצר שנכנס לבד – "בטלו"; "לבדיקה" – אשרו/דחו;
// שינוי סוג – "אשרו" (באישור בלבד) ← s3CapDec עם at; באנר 80%; "העתיקו לרשימה" רק למנהל; מכסה מלאה – הודעה בעברית; בלי גלישה, ≥44px, בלי שגיאות JS.
// שימוש: node ui-st3d-ai.js <www-dir> [out.json] [shot-prefix]
const fs = require('fs'); const path = require('path'); const H = require('./harness');
let fail = 0; const res = []; const check = (n, ok, info) => { if (!ok) fail++; res.push({ n, ok: !!ok, info }); console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const enc = (v) => (v == null ? { nullValue: null } : typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }) : typeof v === 'string' ? { stringValue: v } : Array.isArray(v) ? { arrayValue: { values: v.map(enc) } } : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } });
const DOCS = 'projects/demo-largpeami/databases/(default)/documents/b/biz-s/';
const mkMap = () => ({ br: 'main', kind: 's', name: 'חנות הבדיקה', v: 3, seq: 3, grid: 50, numDir: 'rtl', ent: 'd1', src: 'manual', upd: 1763100000000, by: 'm',
  rooms: [{ id: 'r1', name: 'אולם', p: [0, 0, 1000, 0, 1000, 800, 0, 800], h: 300 }], walls: [], cols: [], doors: [{ id: 'd1', x: 500, y: 800, w: 180, a: 0, k: 'ent' }],
  fx: [{ id: 'f1', k: 'gon', x: 300, y: 300, w: 200, d: 90, h: 180, a: 0, sides: 1, bays: 2, lvl: 5, hi: false, room: 'r1', num: 1, name: 'ירקות' }], syms: [] });
const AT = 1800000001000;
const AI = () => ({ cov: 0.97, conf: 0.88, ver: 'bayscan-v1', at: AT, ends: ['l', 'r'], kind: 'dfr', kc: 0.9, lvl: 5,
  prods: [{ n: 'כוסות קרטון 250 מ"ל', brand: 'תבניכל', size: '50 יח\'', bc: '7290000000011', lv: 2, conf: 0.92, st: 'auto' }, { n: 'מפיות לבנות', conf: 0.6, st: 'rev' }],
  diff: [{ k: 'kind', was: 'גונדולה', got: 'מקרר דלתות', conf: 0.9, st: 'rev' }, { k: 'prod', was: 'צלחות', got: 'כוסות קרטון', conf: 0.85, st: 'auto' }] });
const S = { calls: [], docs: {}, use: { n: 5, lim: 56, w80: false }, limit: false };
const ALL = { store3d: true };
async function server(ctx) {
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
  const rec = (route, fn) => { let b = {}; try { b = JSON.parse(route.request().postData()).data || {}; } catch (e) { /* */ } S.calls.push({ fn, b }); return b; };
  const ok = (route, r) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: r }) });
  await ctx.route('**/s3CapCheck', (route) => {
    const b = rec(route, 's3CapCheck');
    if (S.limit) return route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED', message: 'נגמרה מכסת הבדיקות החכמות של ההקמה במפה הזו (56 מתוך 56). מנהל המערכת יכול להגדיל אותה.', details: { reason: 's3-setup-limit' } } }) });
    S.use = { n: S.use.n + 1, lim: S.use.lim, w80: S.use.n + 1 >= 0.8 * S.use.lim };
    S.docs[b.key].ai = AI();
    ok(route, { ok: true, mapId: b.mapId, key: b.key, st: 'part', cov: 0.97, prods: 2, rev: 2, per: 0, usage: S.use, at: AT });
  });
  await ctx.route('**/s3CapDec', (route) => {
    const b = rec(route, 's3CapDec'); const d = S.docs[b.key];
    if (b.k === 'exp') return ok(route, { ok: true, added: 1, n: 3 });
    const L = b.k === 'prod' ? d.ai.prods : d.ai.diff; L[b.i].st = b.st;
    ok(route, Object.assign({ ok: true, k: b.k, i: b.i, st: b.st }, b.k === 'diff' && L[b.i].k === 'kind' && b.st === 'ok' ? { mapV: 4 } : {}));
  });
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
const small = (page) => page.evaluate(() => [...document.querySelectorAll('#dlg .s3ai .btn')].filter((b) => b.getBoundingClientRect().height > 0 && b.getBoundingClientRect().height < 43).map((b) => b.innerText));
const last = (fn) => S.calls.filter((c) => c.fn === fn).slice(-1)[0];
const dlgTxt = (page) => page.evaluate(() => (document.querySelector('#dlg .s3ai') || {}).innerText || '');
const toBay = (page) => page.evaluate(() => { S3UI.K3.cur = 'b_f1-a-1'; S3UI.K3.open = 'r1'; rerender(); });

(async () => {
  const [www, out, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(path.dirname(shots), { recursive: true });
  const browser = await H.launch();
  const cM = () => ({ mode: 'new', users: { m: 'biz-s', d: 'biz-s' }, biz: { 'biz-s': { dataRoot: 'b', features: ALL, name: 'עסק בדיקה' } }, admins: { 'b/biz-s/|m': 1 }, staff: { 'b/biz-s/|d': 1 } });

  // ---- 1. מנהל: הכפתור רק כשיש תמונה בשרת ----
  const A = await open(browser, www, cM(), 'm@x.co');
  await A.page.evaluate(() => go('st3')); await sleep(1800);
  await A.page.click('[data-a=s3cpOpen]'); await sleep(1500);
  await toBay(A.page); await sleep(300);
  check('1 בלי תמונה בשרת – אין "בדיקה חכמה"', !(await A.page.evaluate(() => !!document.querySelector('[data-a=s3aiOpen]'))));
  S.docs['b_f1-a-1'] = { k: 'b', ord: 3, st: 'part', ph: [{ p: 'x', th: 'x', n: 1, lv: 'a', w: 800, h: 600, at: 1, by: 'm' }], upd: 1, by: 'm' };
  await A.page.evaluate(() => ACT.s3cpReload()); await sleep(1500); await toBay(A.page); await sleep(300);
  check('1א עם תמונה בשרת – יש "בדיקה חכמה"', await A.page.evaluate(() => !!document.querySelector('[data-a=s3aiOpen]')));
  await A.page.click('[data-a=s3aiOpen]'); await sleep(800);
  let t = await dlgTxt(A.page);
  check('1ב החלון נפתח: הסבר + "נספרת במכסת ההקמה" + "בדקו עכשיו"', /המערכת מציעה/.test(t) && /נספרת במכסת ההקמה/.test(t) && /בדקו עכשיו/.test(t), t.slice(0, 200));

  // ---- 2. בדיקה ← תוצאה ----
  await A.page.click('[data-a=s3aiRun]'); await sleep(1500);
  const c1 = last('s3CapCheck');
  check('2 s3CapCheck: qid, mapId, key', !!c1 && /^[A-Za-z0-9-]{16,40}$/.test(c1.b.qid) && c1.b.mapId === 's-main' && c1.b.key === 'b_f1-a-1', c1 && c1.b);
  t = await dlgTxt(A.page);
  check('2א "נכתב גונדולה, נמצא מקרר דלתות" (לבדיקה) ו"נכתב צלחות, נמצא כוסות קרטון" (נכנס לבד)', /נכתב גונדולה, נמצא מקרר דלתות/.test(t) && /נכתב צלחות, נמצא כוסות קרטון/.test(t) && /נכנס לבד/.test(t), t.slice(0, 500));
  check('2ב מוצרים: "לבדיקה (1)" ו"מוצרים שזוהו (1)", כיסוי 97%', /לבדיקה \(1\)/.test(t) && /מוצרים שזוהו \(1\)/.test(t) && /כיסוי 97%/.test(t) && /אישור ישנה את המפה/.test(t));
  check('2ג מנהל: יש "העתיקו לרשימה"', await A.page.evaluate(() => !!document.querySelector('[data-a=s3aiExp]')));
  let o = await noOverflow(A.page); check('2ד בלי גלישה ב-360px', o.sw <= o.W && !o.bad.length, o);
  let sm = await small(A.page); check('2ה כל הכפתורים לפחות 44px', !sm.length, sm);
  if (shots) { await sleep(300); await A.page.screenshot({ path: shots + '-ai.png' }); }

  // ---- 3. החלטות ----
  await A.page.click('[data-a=s3aiDec][data-k=prod][data-i="0"][data-st=no]'); await sleep(1200);
  const d1 = last('s3CapDec');
  check('3 "בטלו" מוצר שנכנס לבד: s3CapDec k=prod i=0 st=no עם at', d1 && d1.b.k === 'prod' && d1.b.i === 0 && d1.b.st === 'no' && d1.b.at === AT && /^[A-Za-z0-9-]{16,40}$/.test(d1.b.qid), d1 && d1.b);
  check('3א המוצר עבר ל"בוטלו"', /בוטלו \(1\)/.test(await dlgTxt(A.page)));
  await A.page.click('[data-a=s3aiDec][data-k=prod][data-i="0"][data-st=ok]'); await sleep(1200);
  check('3א1 "החזירו": k=prod i=0 st=ok, שוב ב"מוצרים שזוהו"', last('s3CapDec').b.st === 'ok' && /מוצרים שזוהו \(1\)/.test(await dlgTxt(A.page)));
  await A.page.click('[data-a=s3aiDec][data-k=diff][data-i="0"][data-st=ok]'); await sleep(1500);
  const d2 = last('s3CapDec');
  check('3ב אישור שינוי סוג: k=diff i=0 st=ok, "המפה עודכנה"', d2 && d2.b.k === 'diff' && d2.b.i === 0 && d2.b.st === 'ok' && /המפה עודכנה/.test(await dlgTxt(A.page)), d2 && d2.b);
  await A.page.click('[data-a=s3aiExp]'); await sleep(1200);
  check('3ג "העתיקו לרשימה": k=exp, הודעה', last('s3CapDec').b.k === 'exp' && /נוספו 1 מוצרים/.test(await dlgTxt(A.page)));

  // ---- 4. 80% ומכסה מלאה ----
  S.use = { n: 44, lim: 56, w80: false };
  await A.page.click('[data-a=s3aiRun]'); await sleep(1500);
  check('4 80%: באנר "נוצלו 45 מתוך 56"', /נוצלו 45 מתוך 56/.test(await dlgTxt(A.page)));
  check('4 80%: באנר משותף s3qt ("נוצלו 45 מתוך 56 בהקמה")', await A.page.evaluate(() => { const e = document.querySelector('#dlg .s3qt[data-q=swarn]'); return !!e && /נוצלו 45 מתוך 56 בהקמה/.test(e.textContent); }));
  if (shots) { await sleep(300); await A.page.screenshot({ path: shots + '-qt80.png' }); }
  S.limit = true;
  await A.page.click('[data-a=s3aiRun]'); await sleep(1500);
  check('4א1 מכסה מלאה: באנר "נחסם" משותף', await A.page.evaluate(() => !!document.querySelector('#dlg .s3qt[data-q=sfull]')));
  check('4א מכסה מלאה: הודעה בעברית', /נגמרה מכסת הבדיקות החכמות/.test(await dlgTxt(A.page)));
  S.limit = false;
  o = await noOverflow(A.page); check('4ב בלי גלישה', o.sw <= o.W && !o.bad.length, o);
  const qc = await A.page.evaluate(() => { const c = S3UI.qtCalc, m = (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); })();
    return [c('m', { n: 79, lim: 100, mo: m }), c('m', { n: 80, lim: 100, mo: m }), c('m', { n: 100, lim: 100, mo: m }), c('m', { n: 100, lim: 100, mo: '2000-01' }), c('m', { blocked: true, mo: m }), c('s', { n: 79, lim: 100 }), c('s', { n: 80, lim: 100 })].map((x) => x && x.lvl); });
  check('4ה חישוב באנר: 79% בלי, 80% אזהרה, 100% חסום, חודש ישן מתאפס, שגיאת מכסה = חסום', JSON.stringify(qc) === JSON.stringify([null, 'warn', 'full', null, 'full', null, 'warn']), qc);
  await A.page.click('[data-a=s3aiClose]'); await sleep(300);
  check('4ג סגירה – חוזרים למסך הצילום', await A.page.evaluate(() => !document.getElementById('dlg').open && cur().v === 'st3k'));
  const re = await A.page.evaluate(() => { const K = S3UI.K3, k = K.cur, t = () => document.body.textContent.includes('החזית סומנה לצילום מחדש – יש אדם בתמונה');
    const d = K.docs[k] || (K.docs[k] = {}); Object.assign(d, { fr: 'f', frV: 2, frRe: 1 }); rerender(); const before = t();
    Object.assign(d, { frV: 2, frRe: 2 }); rerender(); const marked = t(); Object.assign(d, { frV: 3 }); rerender(); const fresh = t(); return [before, marked, fresh]; });
  check('4ו חזית שסומנה לצילום מחדש (frRe===frV): הודעה; חזית חדשה (frV עולה) – בלי הודעה', JSON.stringify(re) === JSON.stringify([false, true, false]), re);
  check('4ד אין שגיאות JavaScript (מנהל)', !(A.page.__errors || []).length, A.page.__errors);
  await A.ctx.close();

  // ---- 5. עובד עם s3m: בודק, אבל בלי "העתיקו לרשימה" ----
  const D = await open(browser, www, cM(), 'd@x.co', { s3m: true });
  await D.page.evaluate(() => go('st3')); await sleep(1800);
  await D.page.click('[data-a=s3cpOpen]'); await sleep(1500); await toBay(D.page); await sleep(300);
  await D.page.click('[data-a=s3aiOpen]'); await sleep(1000);
  t = await dlgTxt(D.page);
  check('5 s3m: רואה את התוצאה, בלי "העתיקו לרשימה"', /נכתב גונדולה/.test(t) && !(await D.page.evaluate(() => !!document.querySelector('[data-a=s3aiExp]'))), t.slice(0, 120));
  check('5א אין שגיאות JavaScript (s3m)', !(D.page.__errors || []).length, D.page.__errors);
  await D.ctx.close();

  await browser.close();
  if (out) fs.writeFileSync(out, JSON.stringify({ fail, res }, null, 1));
  console.log(fail ? `נכשלו ${fail}` : 'הכול עבר');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
