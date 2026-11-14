'use strict';
// סריקת חנות בתלת מימד, שלב 7 (14.11.2026): מסכי סבב (עובד ומנהל) + התאמת הלקוח לתשובות השרת. רשת מדומה, בלי אמולטור ובלי Gemini.
// בודק (360px): תשובת s3View האמיתית, מסלול ומקטעים (גבוה = עליון/תחתון), צילום (חדה/חשוכה/לא חדה), תור שליחה בלי רשת בלי כפילות (qid),
// הפסקה והמשך, סרטון (תמונות חדות, הסרטון לא נשמר), לקיחת חלק, מבט מנהל (פתיחה/ביטול/העברה), תשובות s3SaveMap (renamed/dropped/שגיאות),
// בלי סיבוב לעמוד, bizId למנהל־על, ובלי אף בקשה כשהתוסף כבוי. שימוש: node ui-st3d-run.js <www-dir> [out.json] [shot-prefix]
const fs = require('fs'); const path = require('path'); const H = require('./harness');
let fail = 0; const res = []; const check = (n, ok, info) => { if (!ok) fail++; res.push({ n, ok: !!ok, info }); console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const enc = (v) => (v == null ? { nullValue: null } : typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }) : typeof v === 'string' ? { stringValue: v } : Array.isArray(v) ? { arrayValue: { values: v.map(enc) } } : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } });
const DOCS = 'projects/demo-largpeami/databases/(default)/documents/b/biz-s/';
const RID = 'rid001_20261114';
const mkMap = () => ({ br: 'main', kind: 's', name: 'חנות הבדיקה', v: 3, seq: 3, grid: 50, numDir: 'rtl', ent: 'd1', src: 'manual', upd: 1763100000000, by: 'm',
  rooms: [{ id: 'r1', name: 'אולם', p: [0, 0, 1000, 0, 1000, 800, 0, 800], h: 300 }], walls: [], cols: [], doors: [{ id: 'd1', x: 500, y: 800, w: 180, a: 0, k: 'ent' }],
  fx: [{ id: 'f1', k: 'gon', x: 300, y: 300, w: 200, d: 90, h: 180, a: 0, sides: 2, bays: 2, lvl: 5, hi: false, room: 'r1', num: 1, name: 'ירקות' },
    { id: 'f2', k: 'fridge', x: 700, y: 300, w: 160, d: 80, h: 200, a: 0, sides: 1, bays: 2, lvl: 5, hi: false, glass: true, room: 'r1', num: 2 },
    { id: 'f3', k: 'gon', x: 500, y: 600, w: 200, d: 90, h: 260, a: 0, sides: 1, bays: 1, lvl: 6, hi: true, room: 'r1', num: 3 }], syms: [] });
const BAYS = ['f1-a-1', 'f1-a-2', 'f1-b-1', 'f1-b-2', 'f2-a-1', 'f2-a-2', 'f3-a-1']; // 8 מקומות צילום (f3 גבוה = עליון + תחתון)
const mkRun = (extra) => Object.assign({ runId: RID, st: 'open', openAt: Date.UTC(2026, 10, 14, 4), dueAt: Date.UTC(2026, 10, 16, 4), map: 's-main', mapV: 3, n: { n: 8, d: 0 } }, extra || {});
const S = { off: false, logMode: 'ok', calls: [], sh: [], logs: [], mode: 'ok', runs: [mkRun()], take: [], mgr: [], ph: [], fail: {}, aborted: 0, reads: [] };
const ALL = { store3d: true };
async function server(ctx, mgr) {
  const doc = (name, o) => ({ name: DOCS + name, fields: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, enc(v)])), createTime: '2026-11-03T09:00:00Z', updateTime: '2026-11-03T09:00:00Z' });
  const j = (route, st, b) => route.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(b) });
  await ctx.route((u) => u.port === '8080' && /\/documents\/b\/biz-s\/(smap|s3br|s3sum|sround|srun|staff$)/.test(u.pathname), (route) => {
    if (S.off) return route.abort();
    const p = new URL(route.request().url()).pathname.replace(/^.*\/documents\/b\/biz-s\//, ''); S.reads.push(p);
    if (p === 'smap/s-main') return j(route, 200, doc(p, mkMap()));
    if (p === 'sround') return j(route, 200, { documents: [doc('sround/q1', { br: 'main', map: 's-main', name: 'שבועי', on: true, next: Date.UTC(2026, 10, 16, 4), f: { k: 'week', dow: 1 } }), doc('sround/q2', { br: 'main', map: 's-main', name: 'ידני', on: true, f: { k: 'manual' }, err: 'staff-disabled' })] });
    if (p === 'staff') return j(route, 200, { documents: [doc('staff/w', { name: 'דנה', active: true }), doc('staff/w2', { name: 'יוסי', active: true })] });
    if (/^srun\/.*\/ph$/.test(p)) return j(route, 200, { documents: S.ph.map((s) => doc('srun/' + RID + '/ph/' + s.id, s)) });
    return j(route, 404, { error: { code: 404, status: 'NOT_FOUND' } });
  });
  const rec = (route, fn) => { if (S.off) return null; let b = {}; try { b = JSON.parse(route.request().postData()).data || {}; } catch (e) { /* */ } S.calls.push({ fn, b, auth: route.request().headers().authorization }); return b; };
  const ok = (route, r) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: r }) });
  const bad = (route, reason, msg) => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { status: 'FAILED_PRECONDITION', message: msg || 'שגיאה', details: { reason } } }) });
  await ctx.route('**/s3View', (route) => {
    if (S.off) return route.abort(); const b = rec(route, 's3View');
    if (b.runId) return ok(route, { run: Object.assign(mkRun(), { bays: BAYS, tlog: [], work: 0, pause: 0, ai: {} }) });
    return ok(route, mgr ? { runs: S.mgr } : { runs: S.runs, fixes: [], take: S.take });
  });
  await ctx.route('**/shelfCheck', (route) => {
    if (S.off) return route.abort(); const b = rec(route, 'shelfCheck'); S.sh.push(b);
    if (S.mode === '404') return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { status: 'NOT_FOUND', message: 'not found' } }) });
    if (S.mode === 'abort1' && !S.aborted) { S.aborted = 1; return route.abort(); }
    if (S.mode === 'closed') return bad(route, 'run-closed', 'הסבב כבר הסתיים');
    return ok(route, { st: 'ok', iss: [], usage: { m: '2026-11', n: 1, cap: 500, w80: false } });
  });
  await ctx.route('**/s3Log', (route) => { if (S.off || S.logMode === 'abort') return route.abort(); const b = rec(route, 's3Log'); S.logs.push(b); ok(route, { ok: true, st: 'open', work: 0, pause: 0 }); });
  await ctx.route('**/s3Move', (route) => { rec(route, 's3Move'); ok(route, { ok: true }); });
  await ctx.route('**/s3Run', (route) => { const b = rec(route, 's3Run'); if (S.fail.run) return bad(route, 'run-open', 'כבר יש סבב פתוח'); ok(route, b.cancel ? { ok: true, st: 'cancel' } : { ok: true, runId: 'x_m1' }); });
  await ctx.route('**/s3SaveMap', (route) => { const b = rec(route, 's3SaveMap'); if (S.fail.save) return bad(route, S.fail.save, 'שגיאת שרת'); ok(route, { ok: true, v: 4, renamed: S.renamed || {}, dropped: S.dropped || [], purged: {} }); });
  await ctx.route('**/s3SetBranch', (route) => { rec(route, 's3SetBranch'); ok(route, { ok: true }); });
}
async function open(browser, www, cfg, email) {
  const log = []; const { ctx, page } = await H.newPage(browser, www, cfg, log, email); await page.setViewportSize({ width: 360, height: 760 });
  await server(ctx, /^m@/.test(email)); await H.login(page, email);
  await page.evaluate(() => { const sh = document.getElementById('sheet'); if (sh && !sh.hidden && typeof ACT.startBlank === 'function') ACT.startBlank(); });
  await H.settle(page, 400);
  return { ctx, page, log };
}
const noOverflow = (page) => page.evaluate(() => { const W = document.documentElement.clientWidth; const bad = [...document.querySelectorAll('#main *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > W + 1 || r.left < -1) && !e.closest('.s3tabs'); }).map((e) => e.tagName + '.' + e.className).slice(0, 5); return { sw: document.documentElement.scrollWidth, W, bad }; });
const txt = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.innerText.replace(/\s+/g, ' ').trim() : null; }, sel);
// תמונות בדיקה: חדה (משבצות אקראיות), חשוכה (אותה תמונה כהה מאוד), לא חדה (מעבר צבע חלק)
const mkImg = (page, kind) => page.evaluate((k) => { const c = document.createElement('canvas'); c.width = 800; c.height = 600; const x = c.getContext('2d');
  if (k === 'blur') { const g = x.createLinearGradient(0, 0, 800, 600); g.addColorStop(0, '#887766'); g.addColorStop(1, '#ccbbaa'); x.fillStyle = g; x.fillRect(0, 0, 800, 600); }
  else { for (let i = 0; i < 100; i++) for (let j = 0; j < 75; j++) { x.fillStyle = `rgb(${(i * 37 + j * 11) % 256},${(i * 17 + j * 53) % 256},${(i * 71 + j * 29) % 256})`; x.fillRect(i * 8, j * 8, 8, 8); } x.fillStyle = 'rgba(0,0,0,.9)'; if (k === 'dark') x.fillRect(0, 0, 800, 600); }
  return c.toDataURL('image/jpeg', .9).split(',')[1]; }, kind).then((b) => ({ name: kind + '.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(b, 'base64') }));
const shot = async (page, file) => { await page.waitForTimeout(250); await page.screenshot({ path: file }); };
const fp = (f, s) => f ? f + '-' + s + '.png' : null;
const pick = async (page, sel, file) => { await page.setInputFiles(sel, file); await sleep(1500); };

(async () => {
  const [www, out, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(path.dirname(shots), { recursive: true });
  const browser = await H.launch();
  const cM = (feat) => ({ mode: 'new', users: { m: 'biz-s', w: 'biz-s', w2: 'biz-s' }, biz: { 'biz-s': { dataRoot: 'b', features: feat || ALL, name: 'עסק בדיקה' } }, admins: { 'b/biz-s/|m': 1 }, staff: { 'b/biz-s/|w': 1, 'b/biz-s/|w2': 1 } });
  const showWk = async (page) => { await page.evaluate(() => { WS = 'home'; NAV = [{ v: 'wk' }]; render(0); }); await sleep(1500); await page.evaluate(() => rerender()); await sleep(300); };

  // ---- עובד: בית, מסך הצילום ----
  let W = await open(browser, www, cM(), 'w@x.co'); await showWk(W.page);
  const h = await W.page.evaluate(() => { const c = document.querySelector('#main .s3c'); return { txt: c ? c.innerText.replace(/\s+/g, ' ') : '', a: c && c.dataset.a }; });
  check('1 בית עובד: "המשימה שלך" עם "צולמו 0 מתוך 8" (תשובת s3View האמיתית: n:{n,d}) ופותח את מסך הצילום', /המשימה שלך/.test(h.txt) && /צולמו 0 מתוך 8/.test(h.txt) && h.a === 's3cOpen', h);
  await W.page.click('#main .s3c'); await sleep(2000);
  const o1 = await W.page.evaluate(() => ({ v: cur().v, groups: [...document.querySelectorAll('.s3g .hd')].map((b) => b.innerText.replace(/\s+/g, ' ')), chips: [...document.querySelectorAll('.s3cc button')].map((b) => b.innerText.trim()), cur: (document.querySelector('.s3info') || {}).innerText }));
  check('2 מסך צילום: מסלול לפי מספור הגופים (ירקות, מקרר, גוף 3), הגוף הראשון פתוח', o1.v === 'st3c' && /גוף 1 \(ירקות\) 0\/4/.test(o1.groups[0]) && /גוף 2.*מקרר 0\/2/.test(o1.groups[1]) && /גוף 3 0\/2/.test(o1.groups[2]), o1);
  check('2א מדף גבוה: גוף 3 נותן תמונה עליונה ותחתונה (2 מקומות)', o1.groups.length === 3 && /0\/2/.test(o1.groups[2]), o1.groups);
  const h2 = await W.page.evaluate(async () => { document.querySelector('[data-a=s3cGrp][data-f=f3]').click(); await new Promise((r) => setTimeout(r, 200)); const a = [...document.querySelectorAll('.s3cc button')].map((b) => b.getAttribute('aria-label')).filter((x) => /גוף 3/.test(x)); document.querySelector('[data-a=s3cGrp][data-f=f2]').click(); await new Promise((r) => setTimeout(r, 200)); document.querySelector('.s3cc button').click(); await new Promise((r) => setTimeout(r, 200)); return { a, info: [...document.querySelectorAll('.s3info')].map((e) => e.innerText.replace(/\s+/g, ' ')).find((t) => /^גוף/.test(t)) }; });
  check('2ב שמות המקטעים הגבוהים: תמונה עליונה ותחתונה', h2.a.some((x) => /עליונה/.test(x)) && h2.a.some((x) => /תחתונה/.test(x)), h2.a);
  check('2ג מקרר: הנחיה מיוחדת (בלי הבזק, השתקפות)', /מקרר.*בלי הבזק/.test(h2.info), h2.info);
  await W.page.evaluate(() => { document.querySelector('[data-a=s3cGrp][data-f=f1]').click(); }); await sleep(200);
  await W.page.evaluate(() => { document.querySelector('.s3cc button').click(); }); await sleep(200);
  let o = await noOverflow(W.page); check('2ד בלי גלישה ב-360px', o.sw <= o.W && !o.bad.length, o);
  if (shots) await shot(W.page, fp(shots, 'capture'));
  const btn = await W.page.evaluate(() => [...document.querySelectorAll('.s3s .s3b, .s3cc button')].filter((b) => b.getBoundingClientRect().height < 43).map((b) => b.innerText));
  check('2ה כל הכפתורים לפחות 44px', !btn.length, btn);

  // ---- צילום: תקינה, חשוכה, לא חדה ----
  S.mode = '404'; S.logMode = 'abort'; // shelfCheck עוד לא קיימת (שלב 8): הפריטים נשארים בתור
  await pick(W.page, 'input[data-c=s3cPick]', await mkImg(W.page, 'sharp'));
  let st = await W.page.evaluate(async () => { const L = await new Promise((r) => { const q = indexedDB.open(LK('lp-s3q'), 1); q.onsuccess = () => { const g = q.result.transaction('q').objectStore('q').getAll(); g.onsuccess = () => r(g.result.map((x) => ({ k: x.k, slot: x.slot, ev: x.ev, src: x.src, rt: x.rt, sz: x.img && x.img.size, tsz: x.th && x.th.size, w: x.w }))); }; }); return { L, chips: [...document.querySelectorAll('.s3cc button')].map((b) => b.className) }; });
  check('3 תמונה חדה: נשמרה בטלפון (תור) עם אירוע התחלה לפניה, JPEG מוקטן, והמקטע מסומן "ממתין"', st.L.length === 2 && st.L[0].k === 'ev' && st.L[0].ev === 's' && st.L[1].slot === 'f1-a-1_a' && st.L[1].src === 'photo' && st.L[1].rt === 0 && st.L[1].w <= 1600 && st.L[1].sz > 1000 && st.L[1].tsz > 500 && /q/.test(st.chips[0]), st);
  const q2 = await W.page.evaluate(() => ({ qn: S3UI.C.qn, qf: S3UI.C.qf, txt: document.querySelector('.s3s').innerText.replace(/\s+/g, ' ').slice(0, 160) }));
  check('3ב הודעה "ממתינים לשליחה" מוצגת, בלי כישלון סופי', q2.qn >= 2 && q2.qf === 0 && /ממתינים לשליחה/.test(q2.txt), q2);
  // מקטע הבא נבחר אוטומטית; חשוכה
  await pick(W.page, 'input[data-c=s3cPick]', await mkImg(W.page, 'dark'));
  const d1 = await W.page.evaluate(() => ({ t: (document.querySelector('.s3warn[role=alert]') || {}).innerText, keep: !!document.querySelector('[data-a=s3cKeep]'), again: !!document.querySelector('label.s3b input[data-c=s3cPick]') }));
  check('3ג תמונה חשוכה: "צלמו שוב" מיידי (חשוכה מדי) ואפשרות "שמרו בכל זאת"', /חשוכה/.test(d1.t || '') && d1.keep && d1.again, d1);
  if (shots) await shot(W.page, fp(shots, 'retake'));
  await pick(W.page, 'input[data-c=s3cPick]', await mkImg(W.page, 'blur'));
  const d2 = await txt(W.page, '.s3warn[role=alert]'); check('3ד תמונה לא חדה: "לא חדה מספיק, צלמו שוב"', /לא חדה/.test(d2 || ''), d2);
  await pick(W.page, 'input[data-c=s3cPick]', await mkImg(W.page, 'sharp'));
  const d3 = await W.page.evaluate(() => ({ warn: !!document.querySelector('.s3warn[role=alert]'), c: S3UI.C.slots.filter((s) => S3UI.C.loc[s.slot] === 'q').map((s) => s.slot) }));
  check('3ה צילום חדש אחרי "צלמו שוב" נשמר למקטע המבוקש (f1-a-2), ההודעה נעלמה', !d3.warn && d3.c.join() === 'f1-a-1_a,f1-a-2_a', d3);
  const rt = await W.page.evaluate(async () => { const L = await new Promise((r) => { const q = indexedDB.open(LK('lp-s3q'), 1); q.onsuccess = () => { const g = q.result.transaction('q').objectStore('q').getAll(); g.onsuccess = () => r(g.result); }; }); return L.filter((x) => x.k === 'ph').map((x) => [x.slot, x.rt]); });
  check('3ו מספר הצילומים החוזרים (rt) נרשם: שני "צלמו שוב" על f1-a-2 = 2', JSON.stringify(rt) === '[["f1-a-1_a",0],["f1-a-2_a",2]]', rt);

  // ---- שליחה: השרת חוזר, אין כפילות (qid) ----
  S.mode = 'abort1'; S.logMode = 'ok'; S.sh.length = 0; S.logs.length = 0;
  await W.page.evaluate(() => S3UI.C.fl = 0); await W.page.evaluate(() => ACT.s3cFlush()); await sleep(2500); await W.page.evaluate(() => ACT.s3cFlush()); await sleep(2500);
  const ids = S.sh.map((b) => b.qid);
  check('4 שליחה אחרי ניתוק באמצע: אותו qid נשלח שוב (מניעת כפילות בשרת), ובסוף כל הפריטים נשלחו והתור ריק', ids.length >= 3 && ids[0] === ids[1] && new Set(ids).size === 2 && S.logs.length === 1 && S.logs[0].ev === 's' && await W.page.evaluate(() => S3UI.C.qn === 0 && S3UI.C.qf === 0), { n: ids.length, uniq: new Set(ids).size, logs: S.logs.length });
  const b0 = S.sh[1]; check('4א מבנה הבקשה ל-shelfCheck: mode run, run, slot, at, src, rt, img+th (base64 JPEG)', b0 && b0.mode === 'run' && b0.run === RID && /^f1-a-1_a$/.test(b0.slot) && Number.isInteger(b0.at) && b0.src === 'photo' && b0.rt === 0 && /^\/9j\//.test(b0.img) && /^\/9j\//.test(b0.th) && /^[A-Za-z0-9-]{16,40}$/.test(b0.qid), b0 && Object.keys(b0));
  check('4ב אחרי שליחה מוצלחת המקטעים מסומנים כנשלחו (ירוק), לא "ממתין"', await W.page.evaluate(() => ['f1-a-1_a', 'f1-a-2_a'].every((s) => S3UI.C.loc[s] === 's')), null);

  // ---- בלי רשת ----
  S.mode = 'ok'; S.sh.length = 0;
  S.off = true; await W.ctx.setOffline(true); await W.page.evaluate(() => window.dispatchEvent(new Event('offline'))); await sleep(400);
  await W.page.evaluate(() => { document.querySelector('[data-a=s3cGrp][data-f=f1]').click(); }); await sleep(200);
  await pick(W.page, 'input[data-c=s3cPick]', await mkImg(W.page, 'sharp'));
  const off = await W.page.evaluate(() => ({ t: document.querySelector('.s3s').innerText.replace(/\s+/g, ' ').slice(0, 220), qn: S3UI.C.qn }));
  check('5 בלי רשת: הודעה בולטת, התמונה נשמרת בטלפון וממתינה (לא נשלחה)', /אין חיבור/.test(off.t) && off.qn === 1 && S.sh.length === 0, off);
  if (shots) await shot(W.page, fp(shots, 'offline'));
  // פתיחה מחדש של המסך בלי רשת: הסבב והמפה מהעותק שבטלפון
  await W.page.evaluate(() => { NAV = [{ v: 'wk' }]; WS = 'home'; render(0); }); await sleep(400);
  const cached = await W.page.evaluate(async () => { ACT.s3cOpen({ dataset: { id: 'rid001_20261114' } }); await new Promise((r) => setTimeout(r, 1500)); return { v: cur().v, n: S3UI.C.slots.length, cache: S3UI.C.cache, err: S3UI.C.err }; });
  check('5א פתיחת הסבב בלי רשת (אחרי שנפתח פעם עם רשת): נטען מהעותק שבטלפון', cached.v === 'st3c' && cached.n === 8 && cached.cache === 1 && !cached.err, cached);
  S.off = false; await W.ctx.setOffline(false); await W.page.evaluate(() => window.dispatchEvent(new Event('online'))); await sleep(2500);
  check('5ב חזרה של הרשת: הפריט נשלח לבד, התור ריק', S.sh.length === 1 && await W.page.evaluate(() => S3UI.C.qn === 0), { n: S.sh.length });

  // ---- הפסקה והמשך ----
  S.logs.length = 0;
  await W.page.evaluate(() => ACT.s3cEv({ dataset: { k: 'p' } })); await sleep(300); await W.page.evaluate(() => ACT.s3cEv({ dataset: { k: 'r' } })); await sleep(2500);
  check('6 הפסקה והמשך: נשלחו s3Log עם p ואז r, עם זמן הטלפון (at שלם)', S.logs.map((l) => l.ev).join() === 'p,r' && S.logs.every((l) => Number.isInteger(l.at) && l.run === RID && /^[A-Za-z0-9-]{16,40}$/.test(l.qid)), S.logs);
  const t6 = await W.page.evaluate(() => document.querySelector('.s3s').innerText.replace(/\s+/g, ' '));
  check('6א בטלפון מוצגים הזמנים: התחלה, הפסקה, המשך', /התחלה/.test(t6) && /הפסקה/.test(t6) && /המשך/.test(t6), t6.slice(0, 200));

  // ---- סרטון ----
  const vid = await W.page.evaluate(async () => { try { const c = document.createElement('canvas'); c.width = 640; c.height = 480; const x = c.getContext('2d'); const ms = c.captureStream(15); const rec = new MediaRecorder(ms, { mimeType: 'video/webm' }); const ch = []; rec.ondataavailable = (e) => ch.push(e.data); rec.start(100); let f = 0; const t0 = performance.now();
    await new Promise((r) => { const draw = () => { f++; for (let i = 0; i < 80; i++) for (let j = 0; j < 60; j++) { x.fillStyle = `rgb(${(i * 37 + j * 11 + f * 9) % 256},${(i * 17 + j * 53) % 256},${(i * 71 + j * 29 + f * 5) % 256})`; x.fillRect(i * 8, j * 8, 8, 8); } if (performance.now() - t0 < 2500) requestAnimationFrame(draw); else r(); }; draw(); });
    rec.stop(); await new Promise((r) => { rec.onstop = r; }); const b = new Blob(ch, { type: 'video/webm' }); const buf = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 8192) s += String.fromCharCode.apply(null, buf.subarray(i, i + 8192)); return btoa(s); } catch (e) { return ''; } });
  if (!vid) check('7 סרטון: לא נבדק – אין MediaRecorder בדפדפן הבדיקה', true, 'skipped');
  else {
    await W.page.evaluate(() => { S3UI.C.cur = 'f1-b-1_a'; S3UI.C.open = 'f1'; rerender(); }); await sleep(300);
    S.sh.length = 0;
    const hasV = await W.page.evaluate(() => !!document.querySelector('input[data-c=s3cVid]')); await W.page.setInputFiles('input[data-c=s3cVid]', { name: 'v.webm', mimeType: 'video/webm', buffer: Buffer.from(vid, 'base64') }); await sleep(9000); await W.page.evaluate(() => ACT.s3cFlush()); await sleep(2500);
    const sl = S.sh.filter((b) => b.src === 'video').map((b) => b.slot); const stv = await W.page.evaluate(async () => { const L = await new Promise((r) => { const q = indexedDB.open(LK('lp-s3q'), 1); q.onsuccess = () => { const g = q.result.transaction('q').objectStore('q').getAll(); g.onsuccess = () => r(g.result); }; }); return { blobs: L.filter((x) => x.k === 'ph' && x.img && x.img.type !== 'image/jpeg').length, msg: S3UI.C.msg }; });
    check('7 סרטון לצד השני של גוף 1: כפתור סרטון מוצג, ונשלחו תמונות עם src=video לכל מקטעי הצד (ללא הסרטון עצמו)', hasV && sl.length >= 1 && sl.every((x) => /^f1-b-[12]_a$/.test(x)) && stv.blobs === 0, { hasV, sl, stv });
  }
  // הצד הראשון של גוף 1 (הסרטון שנבחר על הצד a) – אין כפתור סרטון למדף גבוה
  const hi = await W.page.evaluate(() => { S3UI.C.cur = 'f3-a-1_t'; S3UI.C.open = 'f3'; rerender(); return { vid: !!document.querySelector('input[data-c=s3cVid]'), t: [...document.querySelectorAll('.s3info')].map((e) => e.innerText.replace(/\s+/g, ' ')).find((t) => /^גוף/.test(t)) }; });
  check('7א מדף גבוה: אין סרטון, והנחיה לתמונה עליונה', !hi.vid && /תמונה עליונה/.test(hi.t), hi);
  // סיום
  await W.page.evaluate(() => ACT.s3cEv({ dataset: { k: 'e' } })); await sleep(500);
  const ask1 = await txt(W.page, '#dlg'); check('8 "סיימתי" עם מקטעים חסרים: שואל "יש N מקטעים שלא צולמו"', /יש \d+ מקטעים שלא צולמו/.test(ask1 || ''), ask1);
  await W.page.evaluate(() => closeDlg());
  check('9 אין שגיאות JavaScript (עובד)', !W.page.__errors.length, W.page.__errors);
  await W.ctx.close();

  // ---- עובד: לקיחת חלק ----
  S.take = [{ runId: RID, st: 'open', br: 'main', map: 's-main', dueAt: Date.UTC(2026, 10, 16, 4), parts: [{ h: 'abcdef0123456789', n: 5, d: 1, bays: 5 }] }]; S.runs = []; S.calls.length = 0;
  W = await open(browser, www, cM(), 'w2@x.co'); await showWk(W.page); await W.page.evaluate(() => go('st3')); await sleep(1800);
  const tk = await W.page.evaluate(() => ({ t: document.querySelector('.s3s').innerText.replace(/\s+/g, ' '), b: !!document.querySelector('[data-a=s3cTake]') }));
  check('10 עובד בלי משימה: רואה "אפשר לקחת חלק" (5 מקטעים), בלי מזהי עובדים', tk.b && /אפשר לקחת חלק/.test(tk.t) && /5 מקטעים/.test(tk.t), tk);
  if (shots) await shot(W.page, fp(shots, 'take'));
  await W.page.click('[data-a=s3cTake]'); await sleep(300); await W.page.click('[data-a=yes]'); await sleep(1500);
  const mv = S.calls.find((c) => c.fn === 's3Move'); check('10א לקיחה: s3Move עם runId, fromH, take:true (בלי uid)', mv && mv.b.runId === RID && mv.b.fromH === 'abcdef0123456789' && mv.b.take === true && !('from' in mv.b), mv);
  await W.ctx.close();

  // ---- מנהל: לשונית סבבים ----
  S.runs = [mkRun()]; S.mgr = [Object.assign(mkRun(), { br: 'main', rid: 'q1', k: 'sched', n: 12, nDone: 5, uids: ['w', 'w2'], nUid: { w: { n: 8, d: 5 }, w2: { n: 4, d: 0 } }, work: { w: 42 }, pause: { w: 5 }, tlog: { w: [{ k: 's', t: 1 }, { k: 'p', t: 2 }] } })]; S.calls.length = 0;
  const M = await open(browser, www, cM(), 'm@x.co'); await M.page.evaluate(() => { rerender(); }); await sleep(800);
  await M.page.evaluate(() => go('st3')); await sleep(1800); await M.page.click('[data-a=st3Tab][data-k=rounds]'); await sleep(2000);
  const mg = await M.page.evaluate(() => document.querySelector('.s3s').innerText.replace(/\s+/g, ' '));
  check('11 מבט מנהל: סבב פתוח עם התקדמות כוללת (5/12) ולכל עובד (דנה 5/8, יוסי 4 מקטעים), זמני עבודה והפסקה, ו"בהפסקה"', /פתוח · 5\/12/.test(mg) && /דנה: 5\/8/.test(mg) && /עבודה 42/.test(mg) && /הפסקה 5/.test(mg) && /יוסי: 0\/4/.test(mg) && /בהפסקה/.test(mg), mg.slice(0, 300));
  check('11א כללי סבב: "פתחו סבב עכשיו" לכל כלל, ושגיאת כלל (עובד מושבת) בעברית', /פתיחת סבב עכשיו/.test(mg) && /עובד בכלל הזה מושבת/.test(mg), mg.slice(-250));
  if (shots) await shot(M.page, fp(shots, 'manager-rounds'));
  o = await noOverflow(M.page); check('11ב מבט מנהל בלי גלישה ב-360px', o.sw <= o.W && !o.bad.length, o);
  S.fail.run = 1; await M.page.click('[data-a=s3cNow][data-rid=q1]'); await sleep(300); await M.page.click('[data-a=yes]'); await sleep(1200);
  const tm = await txt(M.page, '.toast'); check('11ג פתיחה כשכבר יש סבב פתוח: הודעה בעברית פשוטה (run-open)', /כבר יש סבב פתוח/.test(tm || ''), tm);
  S.fail.run = 0; await M.page.click('[data-a=s3cNow][data-rid=q1]'); await sleep(300); await M.page.click('[data-a=yes]'); await sleep(1200);
  check('11ד פתיחה ידנית: s3Run עם rid', !!S.calls.find((c) => c.fn === 's3Run' && c.b.rid === 'q1'), S.calls.filter((c) => c.fn === 's3Run').map((c) => c.b));
  await M.page.click('[data-a=s3cCancel]'); await sleep(300); await M.page.click('[data-a=yes]'); await sleep(1200);
  check('11ה ביטול סבב: s3Run עם runId ו-cancel:true', !!S.calls.find((c) => c.fn === 's3Run' && c.b.cancel === true && c.b.runId === RID), null);
  await M.page.click('[data-a=s3cMove][data-from=w]'); await sleep(400); await M.page.selectOption('#s3cto', 'w2'); await M.page.click('[data-a=s3cMoveGo]'); await sleep(1200);
  const mv2 = S.calls.find((c) => c.fn === 's3Move'); check('11ו העברת חלק של עובד: s3Move עם from ו-to', mv2 && mv2.b.from === 'w' && mv2.b.to === 'w2' && !mv2.b.take, mv2);
  check('11ז אין שגיאות JavaScript (מנהל)', !M.page.__errors.length, M.page.__errors);

  // ---- עורך: תשובות s3SaveMap, בלי סיבוב לעמוד, bizId ----
  const ed = async () => { if (await M.page.evaluate(() => cur().v === 'st3e')) { await M.page.evaluate(() => { S3UI.E.dirty = true; }); return; } await M.page.evaluate(() => { S3UI.drop(); S3UI.openEditor('s'); }); await sleep(1500); await M.page.evaluate(() => { S3UI.E.dirty = true; }); };
  await ed(); await M.page.evaluate(() => { const E = S3UI.E; E.map.cols.push({ id: 'c1', x: 100, y: 100, w: 40 }); E.sel = { t: 'cols', id: 'c1' }; E.dirty = true; rerender(); }); await sleep(300);
  check('12 עמוד נבחר: אין כפתור סיבוב (cols[].a לא בחוזה); גוף עדיין מסתובב', !(await M.page.$('[data-a=s3eRot]')) && await M.page.evaluate(() => { S3UI.E.sel = { t: 'fx', id: 'f1' }; rerender(); return !!document.querySelector('[data-a=s3eRot]'); }), null);
  await M.page.evaluate(() => { S3UI.E.map.cols = []; S3UI.E.sel = null; rerender(); });
  S.renamed = { f9: 'f4', f10: 'f5' }; S.dropped = ['cols.a']; S.calls.length = 0; await M.page.click('[data-a=s3eSave]'); await sleep(1500);
  const dl = await txt(M.page, '#dlg'); check('12א s3SaveMap החזיר renamed ו-dropped: הודעה בעברית (2 גופים קיבלו מספר חדש; חלק מהפרטים לא נשמרו)', /2 גופים קיבלו/.test(dl || '') && /לא נשמרו/.test(dl || ''), dl);
  await M.page.evaluate(() => closeDlg());
  for (const [r, re] of [['br-off', /כבוי בסניף/], ['no-wh', /אין מחסן/], ['tex-day', /מכסת תמונות הטקסטורה/]]) {
    S.fail.save = r; await ed(); await M.page.click('[data-a=s3eSave]'); await sleep(1200);
    const em = await txt(M.page, '[role=alert]'); check('12ב שגיאת ' + r + ' בעברית פשוטה, והשינויים נשארים בטלפון', re.test(em || '') && /שמורים בטלפון/.test(em || ''), em);
  }
  S.fail.save = '';
  S.calls.length = 0; await M.page.evaluate(() => { SY.sa = 1; }); await M.page.evaluate(() => S3UI.fn('s3SetBranch', { brId: 'main', wh: false, on: true, cap: 500 })); await sleep(300);
  check('13 מנהל־על: כל קריאת s3 נשלחת עם bizId של העסק שבו הוא עובד; מנהל רגיל – בלי', S.calls[0] && S.calls[0].b.bizId === 'biz-s', S.calls[0]);
  await M.page.evaluate(() => { delete SY.sa; }); S.calls.length = 0; await M.page.evaluate(() => S3UI.fn('s3SetBranch', { brId: 'main' })); await sleep(300);
  check('13א מנהל רגיל: בלי bizId בבקשה', S.calls[0] && !('bizId' in S.calls[0].b), S.calls[0]);
  check('13ב אין שגיאות JavaScript (עורך)', !M.page.__errors.length, M.page.__errors);
  await M.ctx.close();

  // ---- תוסף כבוי: בלי אף בקשה נוספת ----
  S.calls.length = 0; S.reads.length = 0;
  for (const em of ['w@x.co', 'm@x.co']) {
    const X = await open(browser, www, cM({}), em); await X.page.evaluate(() => { WS = 'home'; NAV = [{ v: isW() ? 'wk' : 'home' }]; render(0); }); await sleep(1500);
    await X.page.evaluate(() => { ['s3cOpen', 's3cFlush', 's3cMgr'].forEach((a) => { try { ACT[a]({ dataset: { id: 'rid001_20261114' } }); } catch (e) { /* */ } }); window.dispatchEvent(new Event('online')); }); await sleep(1500);
    const bad = X.log.filter((r) => /s3View|s3Log|s3Move|s3Run|shelfCheck|s3SaveMap|\/(smap|s3br|s3sum|sround)\b|\/srun/.test(r.url));
    check('14 תוסף כבוי (' + em + '): אין שום בקשה של התלת מימד (פונקציות, מפה, סבבים)', !bad.length && !S.calls.length && !S.reads.length, bad.map((r) => r.url).slice(0, 4));
    await X.ctx.close();
  }
  await browser.close();
  if (out) fs.writeFileSync(out, JSON.stringify({ fail, res }, null, 1));
  console.log(fail ? `נכשלו ${fail}` : 'הכול עבר');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
