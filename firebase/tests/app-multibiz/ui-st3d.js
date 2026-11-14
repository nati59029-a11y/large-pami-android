'use strict';
// סריקת חנות בתלת מימד, שלבים 3 ו-4 (14.11.2026): מסגרת המסכים + עורך המפה. רשת מדומה, בלי אמולטור ובלי Gemini.
// בודק (360px): חלון הבית (מיקום מתחת להכנסות, בלי נתוני דוגמה, הזמנה כשאין מפה, הסתרה), הסתרה כשהתוסף כבוי, לשוניות לפי הרשאה,
// משימת עובד (s3View), עורך: חדר לא חוקי נחסם בעברית, גוף ומספור, שמירה (s3SaveMap עם baseV), שמירה/טעינה זהות, מחיקה = del:1 עם אישור כפול למנהל בלבד,
// גרסאות קודמות ושחזור, מתג s3m ב-PMK, אין שגיאות JS. שימוש: node ui-st3d.js <www-dir> [out.json] [shot-prefix]
const fs = require('fs'); const path = require('path'); const H = require('./harness');
let fail = 0; const res = []; const check = (n, ok, info) => { if (!ok) fail++; res.push({ n, ok: !!ok, info }); console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 500) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const enc = (v) => (v == null ? { nullValue: null } : typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }) : typeof v === 'string' ? { stringValue: v } : Array.isArray(v) ? { arrayValue: { values: v.map(enc) } } : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } });
const DOCS = 'projects/demo-largpeami/databases/(default)/documents/b/biz-s/';
const mkMap = () => ({ br: 'main', kind: 's', name: 'חנות הבדיקה', v: 3, seq: 1, grid: 50, numDir: 'rtl', ent: 'd1', src: 'manual', upd: 1763100000000, by: 'm',
  rooms: [{ id: 'r1', name: 'אולם', p: [0, 0, 1000, 0, 1000, 800, 0, 800], h: 300 }], walls: [], cols: [], doors: [{ id: 'd1', x: 500, y: 800, w: 180, a: 0, k: 'ent' }],
  fx: [{ id: 'f1', k: 'gon', x: 500, y: 400, w: 200, d: 90, h: 180, a: 0, sides: 2, bays: 2, lvl: 5, hi: false, room: 'r1', num: 1 }], syms: [] });
const S = { map: mkMap(), none: false, calls: [], reads: [], fnFail: '', runs: [{ runId: 'r_1', st: 'open', openAt: Date.UTC(2026, 10, 7), dueAt: Date.UTC(2026, 10, 8), map: 's-main', mapV: 3, n: { n: 12, d: 5 } }] };
const ALL = { store3d: true };
async function server(ctx) {
  const doc = (name, o) => ({ name: DOCS + name, fields: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, enc(v)])), createTime: '2026-11-03T09:00:00Z', updateTime: '2026-11-03T09:00:00Z' });
  await ctx.route((u) => u.port === '8080' && /\/documents\/b\/biz-s\/(smap|s3br|s3sum|sround)/.test(u.pathname), (route) => {
    const p = new URL(route.request().url()).pathname.replace(/^.*\/documents\/b\/biz-s\//, ''); S.reads.push(p);
    const j = (st, b) => route.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(b) });
    if (p === 'smap/s-main') return S.none ? j(404, { error: { code: 404, status: 'NOT_FOUND' } }) : j(200, doc(p, S.map));
    if (p === 'smap/s-main/ver') return j(200, { documents: [3, 2].map((v) => doc('smap/s-main/ver/00000' + v, { v, at: 1763000000000 + v * 1e6, by: 'm', why: v === 3 ? 'עריכה' : 'שחזור' })) });
    if (/^smap\/s-main\/ver\/00000[0-9]$/.test(p)) { const m = mkMap(); m.fx = []; m.v = 2; return j(200, doc(p, { v: 2, m, at: 1, by: 'm' })); }
    if (p === 'sround') return j(200, { documents: [doc('sround/q1', { br: 'main', map: 's-main', name: 'שבועי', on: true, next: Date.UTC(2026, 10, 16, 4), f: { k: 'week', dow: 1 } })] });
    return j(404, { error: { code: 404, status: 'NOT_FOUND' } });
  });
  await ctx.route('**/s3SaveMap', async (route) => {
    let b = {}; try { b = JSON.parse(route.request().postData()).data || {}; } catch (e) { /* */ }
    S.calls.push({ fn: 's3SaveMap', b });
    if (S.fnFail) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { status: 'NOT_FOUND', message: 'not found' } }) });
    S.none = false; S.map = Object.assign({}, b.map, { v: (b.baseV || 0) + 1, upd: 1763200000000, by: 'm' });
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { ok: true } }) });
  });
  await ctx.route('**/s3View', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { runs: S.runs } }) }));
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
const noOverflow = (page) => page.evaluate(() => { const W = document.documentElement.clientWidth; const bad = [...document.querySelectorAll('#main *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > W + 1 || r.left < -1) && !e.closest('.scroll-x,.s3tabs'); }).slice(0, 5).map((e) => e.tagName + '.' + e.className); return { sw: document.documentElement.scrollWidth, W, bad }; });
const txt = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.innerText.replace(/\s+/g, ' ').trim() : null; }, sel);
const cbox = async (page, x, y) => { const b = await page.evaluate(() => { const r = document.getElementById('s3pl').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, vx: E_().vx, vy: E_().vy, vw: E_().vw }; function E_() { return S3UI.E; } }); return [b.x + (x - b.vx) * b.w / b.vw, b.y + (y - b.vy) * b.w / b.vw]; };
const tap = async (page, x, y) => { const [cx, cy] = await cbox(page, x, y); await page.mouse.click(cx, cy); await sleep(120); };
const tool = async (page, k) => { await page.click('[data-a=s3eTool][data-k=' + k + ']'); await sleep(120); };

(async () => {
  const [www, out, shot] = process.argv.slice(2);
  const browser = await H.launch();
  const cM = (feat) => ({ mode: 'new', users: { m: 'biz-s', w: 'biz-s', w0: 'biz-s' }, biz: { 'biz-s': { dataRoot: 'b', features: feat || ALL, name: 'עסק בדיקה' } }, admins: { 'b/biz-s/|m': 1 }, staff: { 'b/biz-s/|w': 1, 'b/biz-s/|w0': 1 } });

  // ---- 1. בית המנהל, יש מפה ----
  let A = await open(browser, www, cM(), 'm@x.co');
  await A.page.evaluate(() => rerender()); await sleep(1500);
  const h1 = await A.page.evaluate(() => { const m = document.getElementById('main').innerHTML; const c = document.querySelector('#main .s3c'); return { hero: m.indexOf('id="hmain"'), card: m.indexOf('s3c"'), hacts: m.indexOf('class="chips hacts"'), txt: c ? c.innerText.replace(/\s+/g, ' ') : '', mini: !!document.getElementById('s3mini'), canvas: !!document.querySelector('#s3mini canvas'), msg: (document.querySelector('#s3mini .s3d-msg') || {}).innerText || '' }; });
  check('1 בית מנהל עם מפה: החלון מופיע אחרי כרטיס ההכנסות ולפני הכפתורים, עם שם המפה, ציון "עוד אין" וסבב הבא', h1.card > h1.hero && h1.hero >= 0 && h1.card < h1.hacts && /חנות הבדיקה/.test(h1.txt) && /עוד אין/.test(h1.txt) && /הסבב הבא/.test(h1.txt) && h1.mini, h1);
  check('1א המפה המיני נטענת (קנבס) או הודעה בעברית כשאין WebGL; אין "דוגמה" בחלון האמיתי', (h1.canvas || /WebGL|תלת מימד/.test(h1.msg)) && !/דוגמה/.test(h1.txt), h1);
  let o = await noOverflow(A.page); check('1ב בלי גלישה ב-360px', o.sw <= o.W && !o.bad.length, o);
  if (shot) { fs.mkdirSync(path.dirname(shot), { recursive: true }); await A.page.screenshot({ path: shot + '-home.png' }); }

  // ---- 2. המסך הראשי של המנהל ----
  await A.page.click('#main .s3c'); await sleep(1800);
  const t2 = await A.page.evaluate(() => ({ v: cur().v, tabs: [...document.querySelectorAll('.s3tabs button')].map((b) => b.innerText.trim()), main: !!document.getElementById('s3main'), info: (document.getElementById('s3info') || {}).innerText }));
  check('2 מסך ראשי למנהל: מפה במרכז ולשוניות מפה/סבבים/דוחות/המלצות/הגדרות', t2.v === 'st3' && t2.main && t2.tabs.join(',') === 'מפה,סבבים,דוחות,המלצות,הגדרות', t2);
  if (shot) await A.page.screenshot({ path: shot + '-main.png' });
  await A.page.click('[data-a=st3Tab][data-k=rep]'); await sleep(200);
  check('2א לשונית עתידית מציגה הודעה ולא נתונים', /ייפתח בשלב הבא/.test(await txt(A.page, '.s3s') || ''), await txt(A.page, '.s3s'));

  // ---- 3. עורך: חדר לא חוקי נחסם, חדר חוקי, גוף, שמירה ----
  S.none = true; await A.page.evaluate(() => { S3UI.drop(); S3UI.openEditor('s'); }); await sleep(1500);
  const e0 = await A.page.evaluate(() => ({ v: cur().v, pl: !!document.getElementById('s3pl'), svg: !!document.querySelector('#s3pl svg') }));
  check('3 עורך נפתח למפה חדשה (בלי מפה קיימת)', e0.v === 'st3e' && e0.pl && e0.svg, e0);
  await tool(A.page, 'room');
  for (const [x, y] of [[0, 0], [1000, 1000], [1000, 0], [0, 1000]]) await tap(A.page, x, y); // מצולע חוצה את עצמו
  await A.page.click('[data-a=s3eClose]'); await sleep(200);
  const bad = await txt(A.page, '[role=alert]');
  check('3א חדר שהקירות שלו חוצים זה את זה נחסם בהודעה בעברית', /חוצים זה את זה/.test(bad || ''), bad);
  await A.page.click('[data-a=s3ePtClr]'); await sleep(100);
  for (const [x, y] of [[0, 0], [1000, 0], [1000, 800], [0, 800]]) await tap(A.page, x, y);
  await A.page.click('[data-a=s3eClose]'); await sleep(250);
  let st = await A.page.evaluate(() => ({ rooms: S3UI.E.map.rooms.length, sel: S3UI.E.sel }));
  check('3ב חדר מלבני חוקי נוסף ונבחר', st.rooms === 1 && st.sel && st.sel.t === 'rooms', st);
  await tool(A.page, 'fx'); await tap(A.page, 500, 400); await tool(A.page, 'door'); await tap(A.page, 500, 800);
  st = await A.page.evaluate(() => ({ fx: S3UI.E.map.fx.map((f) => [f.id, f.num, f.room]), doors: S3UI.E.map.doors.length, ent: S3UI.E.map.ent }));
  check('3ג גוף נוסף בתוך החדר עם מספר אוטומטי 1; דלת כניסה נקבעה כנקודת המספור', st.fx.length === 1 && st.fx[0][1] === 1 && st.fx[0][2] === 'r1' && st.doors === 1 && st.ent === 'd1', st);
  await tool(A.page, 'fx'); await tap(A.page, 1030, 300);
  check('3ד גוף מחוץ לחדר נחסם בהודעה בעברית', /בתוך חדר/.test(await txt(A.page, '[role=alert]') || ''), await txt(A.page, '[role=alert]'));
  await A.page.click('[data-a=s3eSave]'); await sleep(800);
  const sc = S.calls.find((c) => c.fn === 's3SaveMap');
  check('3ה שמירה: s3SaveMap נקראה עם mapId, baseV=0 (מפה חדשה), חדר וגוף, בלי v/upd/by', sc && sc.b.mapId === 's-main' && sc.b.baseV === 0 && sc.b.map.rooms.length === 1 && sc.b.map.fx.length === 1 && !('v' in sc.b.map) && !('upd' in sc.b.map) && sc.b.why === 'עריכה', sc && { mapId: sc.b.mapId, baseV: sc.b.baseV, keys: Object.keys(sc.b.map) });
  const back = await A.page.evaluate(() => ({ v: cur().v, rooms: (S3UI.data() || {}).maps ? 1 : 0 })); await sleep(800);
  // ---- 4. שמירה/טעינה זהות ----
  await A.page.evaluate(() => { S3UI.drop(); S3UI.openEditor('s'); if (cur().v !== 'st3e') go('st3e'); }); await sleep(1500);
  const same = await A.page.evaluate(() => { const m = JSON.parse(JSON.stringify(S3UI.E.map)); return m; });
  const strip = (m) => { const c = JSON.parse(JSON.stringify(m)); delete c.v; delete c.upd; delete c.by; return c; };
  check('4 שמירה וטעינה זהות: המפה שנטענה שווה לזו שנשלחה (לפי כל השדות)', sc && JSON.stringify(strip(same)) === JSON.stringify(strip(sc.b.map)) && S.map.v === 1, { v: S.map.v });
  // ---- 5. מחיקה = del:1, אישור כפול, מנהל בלבד ----
  await A.page.evaluate(() => { S3UI.E.sel = { t: 'fx', id: S3UI.E.map.fx[0].id }; rerender(); }); await sleep(300);
  check('5 למנהל יש כפתור מחיקה לפריט שנשמר', !!(await A.page.$('[data-a=s3eDel]')), null);
  await A.page.click('[data-a=s3eDel]'); await sleep(200);
  const d1 = await A.page.evaluate(() => ({ open: document.getElementById('dlg').open, t: document.getElementById('dlg').innerText.replace(/\s+/g, ' ') }));
  await A.page.click('#dlg [data-a=closeDlg]'); await sleep(150);
  const still = await A.page.evaluate(() => S3UI.E.map.fx.length + ':' + S3UI.E.map.fx[0].del);
  check('5א אישור ראשון שבוטל – לא נמחק', d1.open && /לסל המחזור/.test(d1.t) && still === '1:undefined', { d1, still });
  await A.page.click('[data-a=s3eDel]'); await sleep(150); await A.page.click('#dlg [data-a=yes]'); await sleep(250);
  const d2 = await A.page.evaluate(() => ({ t: document.getElementById('dlg').innerText.replace(/\s+/g, ' '), del: S3UI.E.map.fx[0].del }));
  check('5ב אחרי אישור ראשון מופיע אישור שני, ועדיין לא נמחק', /פעם נוספת/.test(d2.t) && d2.del === undefined, d2);
  await A.page.click('#dlg [data-a=yes]'); await sleep(250);
  const d3 = await A.page.evaluate(() => { const f = S3UI.E.map.fx[0]; return { n: S3UI.E.map.fx.length, del: f.del, at: typeof f.delAt, by: f.delBy }; });
  check('5ג אחרי אישור שני: הגוף נשאר ברשימה עם del:1, delAt, delBy (סל מחזור, לא מחיקה)', d3.n === 1 && d3.del === 1 && d3.at === 'number' && d3.by === 'm', d3);
  await A.page.click('[data-a=s3eSec][data-k=bin]'); await sleep(200);
  check('5ד הגוף שנמחק מופיע בסל המחזור עם שחזור', !!(await A.page.$('[data-a=s3eRestore]')), null);
  await A.page.click('[data-a=s3eRestore]'); await sleep(200);
  check('5ה שחזור מהסל מחזיר את הגוף (del:0)', await A.page.evaluate(() => S3UI.E.map.fx[0].del === 0 && S3UI.E.map.fx.length === 1), null);
  // ---- 6. גרסאות קודמות ----
  await A.page.click('[data-a=s3eSec][data-k=ver]'); await sleep(700);
  const vv = await A.page.evaluate(() => [...document.querySelectorAll('[data-a=s3eVer]')].length);
  check('6 גרסאות קודמות מוצגות (2)', vv === 2, vv);
  S.calls.length = 0; await A.page.click('[data-a=s3eVer][data-v="2"]'); await sleep(250); await A.page.click('#dlg [data-a=yes]'); await sleep(900);
  const rs = S.calls.find((c) => c.fn === 's3SaveMap');
  check('6א שחזור גרסה = שמירה חדשה (why "שחזור", baseV נוכחי) עם תוכן הגרסה הישנה (בלי הגוף)', rs && rs.b.why === 'שחזור' && rs.b.baseV === 1 && rs.b.map.fx.length === 0, rs && { why: rs.b.why, baseV: rs.b.baseV, fx: rs.b.map.fx.length });
  // ---- 7. שרת לא זמין: הודעה בעברית והטיוטה נשמרת בטלפון ----
  S.fnFail = '1'; await A.page.evaluate(() => { S3UI.drop(); S3UI.openEditor('s'); if (cur().v !== 'st3e') go('st3e'); }); await sleep(1200);
  await tool(A.page, 'col'); await tap(A.page, 100, 100); await A.page.click('[data-a=s3eSave]'); await sleep(700);
  const em = await txt(A.page, '[role=alert]'); const dr = await A.page.evaluate(() => !!localStorage.getItem(LK('lp-s3e:s-main')));
  check('7 כשהשרת לא מכיר את הפונקציה: הודעה בעברית, והטיוטה נשמרת בטלפון', /שמורים בטלפון/.test(em || '') && dr, { em, dr });
  check('7א אין שגיאות JavaScript (מנהל)', !A.page.__errors.length, A.page.__errors);
  S.fnFail = ''; await A.ctx.close();

  // ---- 8. אין מפה: הזמנה, הסתרה ----
  S.none = true; A = await open(browser, www, cM(), 'm@x.co'); await A.page.evaluate(() => rerender()); await sleep(1200);
  const i1 = await txt(A.page, '#main .s3c');
  check('8 אין מפה: חלון הזמנה "בנו את החנות שלכם בתלת מימד" עם כפתור התחלה, ובלי תצוגת דוגמה', /בנו את החנות שלכם בתלת מימד/.test(i1 || '') && !(await A.page.$('#s3mini')) && !/דוגמה/.test(i1 || ''), i1);
  await A.page.click('[data-a=st3Hide]'); await sleep(250);
  const i2 = await A.page.evaluate(() => ({ card: !!document.querySelector('#main .s3c'), slim: !!document.querySelector('#main [data-a=st3Open]') }));
  check('8א "הסתר" מסתיר את ההזמנה ומשאיר שורת קישור קטנה', !i2.card && i2.slim, i2);
  await A.ctx.close();

  // ---- 9. תוסף כבוי ----
  S.none = false; S.reads.length = 0; A = await open(browser, www, cM({ scan: true }), 'm@x.co'); await A.page.evaluate(() => rerender()); await sleep(800);
  check('9 תלת מימד כבוי בעסק: אין חלון בבית ואין קריאות לנתוני המפה', !(await A.page.$('#main .s3c')) && S.reads.length === 0, { reads: S.reads.length });
  await A.ctx.close();

  // ---- 10. עובדים: בלי הרשאה, ועם s3m ----
  const showWk = async (page) => { await page.evaluate(() => { WS = 'home'; NAV = [{ v: 'wk' }]; render(0); }); await sleep(1500); await page.evaluate(() => rerender()); await sleep(300); };
  let W = await open(browser, www, cM(), 'w@x.co', { sup: true }); await showWk(W.page);
  const w1 = await W.page.evaluate(() => { const c = document.querySelector('#main .s3c'); return { txt: c ? c.innerText.replace(/\s+/g, ' ') : '' }; });
  check('10 עובד בלי s3m: רואה את המשימה שלו (סבב בדיקת מדפים וכמה צולמו, לפי תשובת s3View האמיתית), בלי כפתורי עריכה', /סבב בדיקת מדפים/.test(w1.txt) && /5 מתוך 12/.test(w1.txt), w1);
  await W.page.evaluate(() => go('st3')); await sleep(1500);
  const w2 = await W.page.evaluate(() => ({ v: cur().v, tabs: [...document.querySelectorAll('.s3tabs button')].length, edit: !!document.querySelector('[data-a=st3Edit]'), task: (document.querySelector('.s3s') || {}).innerText }));
  check('10א עובד בלי s3m: רק לשונית "הדוח שלי" (בלי לשוניות מנהל) ואין "עריכת המפה"; המשימה מוצגת', w2.v === 'st3' && w2.tabs === 2 && /הדוח שלי/.test(w2.task || "") && !w2.edit && /סבב בדיקת מדפים/.test(w2.task || ''), w2);
  check('10ב אין שגיאות JavaScript (עובד)', !W.page.__errors.length, W.page.__errors);
  await W.ctx.close();
  S.runs = [];
  W = await open(browser, www, cM(), 'w@x.co', { s3m: true }); await showWk(W.page);
  await W.page.click('#main .s3c'); await sleep(1500);
  const w3 = await W.page.evaluate(() => ({ tabs: [...document.querySelectorAll('.s3tabs button')].length, edit: !!document.querySelector('[data-a=st3Edit]'), none: (document.querySelector('.s3s') || {}).innerText }));
  check('10ג עובד עם s3m: רואה "עריכת המפה", בלי לשוניות מנהל; בלי משימה – "אין לך משימה פתוחה"', w3.edit && w3.tabs === 2 && /אין לך משימה פתוחה/.test(w3.none || ''), w3);
  await W.page.click('[data-a=st3Edit]'); await sleep(1500);
  await W.page.evaluate(() => { S3UI.E.sel = { t: 'rooms', id: S3UI.E.map.rooms[0].id }; rerender(); }); await sleep(300);
  check('10ד עובד עם s3m: בעורך אין מחיקה לפריט שנשמר (מותרת למנהל בלבד), אין סל מחזור ואין סניף', !(await W.page.$('[data-a=s3eDel]')) && !(await W.page.$('[data-a=s3eSec][data-k=bin]')) && !(await W.page.$('[data-a=s3eSec][data-k=br]')), null);
  await tool(W.page, 'col'); await tap(W.page, 100, 100); await W.page.evaluate(() => { S3UI.E.sel = { t: 'cols', id: S3UI.E.map.cols[0].id }; rerender(); }); await sleep(250);
  check('10ה עובד עם s3m: פריט חדש שעוד לא נשמר אפשר להסיר', !!(await W.page.$('[data-a=s3eRemove]')), null);
  if (shot) await W.page.screenshot({ path: shot + '-editor.png' });
  o = await noOverflow(W.page); check('10ו עורך ב-360px בלי גלישה', o.sw <= o.W && !o.bad.length, o);
  check('10ז אין שגיאות JavaScript (עובד עם s3m)', !W.page.__errors.length, W.page.__errors);
  const pm = await W.page.evaluate(() => PMK.find((x) => x[0] === 's3m'));
  check('11 מתג s3m ("שרטוט מפה") ברשימת ההרשאות PMK', pm && /שרטוט מפה/.test(pm[1]), pm);
  await W.ctx.close();

  await browser.close();
  if (out) fs.writeFileSync(out, JSON.stringify({ fail, res }, null, 1));
  console.log(fail ? `נכשלו ${fail}` : 'הכול עבר');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
