'use strict';
// תמחור מחשבונית ספק, שלב 7 (12.11.2026): נקודות כניסה למסך התמחור + מתג prc בלארג' פעמי (החלטה 8).
// בודק (360px): מדף בלבד – משבצת במדף בלבד; הזמנות בלבד – כפתור בהזמנות בלבד; שניהם – בשניהם; "לטיפול" של מנהל – סעיף עם מונה
// ו"בטיפול של X"; עובד עם prc – גם בבית העובד; עובד בלי prc – אין כניסה ואין שאילתה; חשבונית שהסתיימה יוצאת מהמונה;
// מטמון קצר (לא שאילתה בכל ציור); בלי גלישה. לארג' פעמי: מסך עובדים עם מתג אחד → setStaffPrc({uid,on}).
// הרשת המדומה – כמו ui-pi-ed.js. שימוש: node ui-pi-entry.js <www-dir> [out.json] [shot.png]
const fs = require('fs'); const path = require('path'); const H = require('./harness');
let fail = 0; const res = []; const check = (n, ok, info) => { if (!ok) fail++; res.push({ n, ok: !!ok, info }); console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 600) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
const T0 = H.T0;
const fresh = () => ({
  i1: { st: 'new', sup: 'אסם', inv: '5001', date: '2026-11-01', at: T0 - 5000, byName: 'עובד', np: 0, n: 4 },
  i2: { st: 'new', sup: 'תנובה', inv: '77', date: '2026-11-02', at: T0 - 3000, byName: 'דני', np: 0, n: 1, lk: { uid: 'x9', name: 'רותי', t: T0 - 60e3 } },
  i3: { st: 'new', sup: 'שטראוס', inv: '88', date: '2026-11-03', at: T0 - 1000, byName: 'דני', np: 0, n: 1 },
});
const S = { inv: fresh(), calls: [], staff: [] };
const fv = (v) => (v == null ? { nullValue: null } : typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }) : typeof v === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fv(x)])) } } : { stringValue: String(v) });
async function server(ctx) {
  await ctx.route((u) => u.port === '8080' && /\/documents\/.*:runQuery$|\/documents:runQuery$/.test(u.pathname), async (route) => {
    let q = {}; try { q = JSON.parse(route.request().postData()).structuredQuery; } catch (e) { /* */ }
    if (!q.from || q.from[0].collectionId !== 'pinv') return route.fallback();
    const base = route.request().url().replace(/^https?:\/\/[^/]+\/v1\//, '').replace(/:runQuery$/, '');
    S.calls.push({ fn: 'list' });
    const docs = Object.entries(S.inv).filter(([, d]) => d.st === 'new').map(([id, d]) => ({ document: { name: base + '/pinv/' + id, fields: Object.fromEntries(['sup', 'inv', 'date', 'at', 'byName', 'lk', 'np', 'n'].filter((k) => d[k] != null).map((k) => [k, fv(d[k])])) }, readTime: '2026-11-03T09:00:00Z' }));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(docs.length ? docs : [{ readTime: '2026-11-03T09:00:00Z' }]) });
  });
  // רשימת העובדים (לארג' פעמי, בשורש) ו-setStaffPrc
  await ctx.route((u) => u.port === '8080' && /\/documents\/staff$/.test(u.pathname), (route) => {
    const base = 'projects/demo-largpeami/databases/(default)/documents/staff/';
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ documents: S.staff.map((s) => ({ name: base + s.uid, fields: Object.fromEntries(Object.entries(s).filter(([k]) => k !== 'uid').map(([k, v]) => [k, fv(v)])) })) }) });
  });
  await ctx.route('**/setStaffPrc', async (route) => {
    let b = {}; try { b = JSON.parse(route.request().postData()).data || {}; } catch (e) { /* */ }
    S.calls.push({ fn: 'setStaffPrc', b });
    if (S.prcFail) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { status: 'PERMISSION_DENIED', message: 'הפעולה מותרת למנהל העסק בלבד', details: { reason: 'manager-only' } } }) });
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { ok: true, uid: b.uid, prc: b.on } }) });
  });
}
async function open(browser, www, cfg, email, perms) {
  const { ctx, page } = await H.newPage(browser, www, cfg, [], email); await page.setViewportSize({ width: 360, height: 760 });
  const uid = email.split('@')[0];
  await server(ctx);
  if (perms) await ctx.route((u) => u.port === '8080' && new RegExp('/staff/' + uid + '$').test(u.pathname), (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ name: 'x', fields: { active: { booleanValue: true }, perms: fv(perms) } }) }));
  await H.login(page, email);
  await page.evaluate(() => { const sh = document.getElementById('sheet'); if (sh && !sh.hidden && typeof ACT.startBlank === 'function') ACT.startBlank(); });
  await H.settle(page, 300);
  return { ctx, page };
}
const noOverflow = (page) => page.evaluate(() => { const W = document.documentElement.clientWidth; const bad = [...document.querySelectorAll('#main *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > W + 1 || r.left < -1); }).slice(0, 5).map((e) => e.tagName + '.' + e.className + ' ' + (e.textContent || '').slice(0, 30)); return { W, sw: document.documentElement.scrollWidth, bad }; });
const lists = () => S.calls.filter((c) => c.fn === 'list').length;
// מה מופיע במסך: כניסה לתמחור (data-v="pi") – הטקסט והמונה
const entry = (page) => page.evaluate(() => { const b = document.querySelector('#main [data-v="pi"]'); if (!b) return null; const t = b.querySelector('.tag'); const r = b.getBoundingClientRect(); return { txt: b.innerText.replace(/\s+/g, ' ').trim(), n: t ? t.innerText.trim() : '', w: r.width, right: r.right }; });
async function show(page, v) { await page.evaluate((v) => { if (v === 'wk') { WS = 'home'; NAV = [{ v: 'wk' }]; render(0); } else go(v); }, v); await sleep(500); await page.evaluate(() => rerender()); await sleep(200); }

(async () => {
  const [www, out, shot] = process.argv.slice(2);
  const browser = await H.launch();

  // ---- 1. מדף בלבד (מנהל) ----
  const cS = { mode: 'new', users: { ms: 'biz-s' }, biz: { 'biz-s': { dataRoot: 'b', features: { scan: true, shelf: true }, name: 'מדף בלבד' } }, admins: { 'b/biz-s/|ms': 1 } };
  let A = await open(browser, www, cS, 'ms@x.co');
  await show(A.page, 'shelf'); let e = await entry(A.page); let o = await noOverflow(A.page);
  check('1 מדף בלבד: במסך המדף – "חשבוניות לתמחור" עם מונה 3 ו"בטיפול של רותי", בלי גלישה', e && e.n === '3' && /חשבוניות לתמחור/.test(e.txt) && /בטיפול של רותי/.test(e.txt) && o.sw <= o.W && !o.bad.length, { e, o });
  await show(A.page, 'ox'); e = await entry(A.page);
  check('1א מדף בלבד: במסך ההזמנות אין כניסה', !e, e);
  await A.ctx.close();

  // ---- 2. הזמנות בלבד (מנהל) ----
  const cO = { mode: 'new', users: { mo: 'biz-x' }, biz: { 'biz-x': { dataRoot: 'b', features: { scan: true, orders: true }, name: 'הזמנות בלבד' } }, admins: { 'b/biz-x/|mo': 1 } };
  A = await open(browser, www, cO, 'mo@x.co');
  await show(A.page, 'ox'); e = await entry(A.page); o = await noOverflow(A.page);
  const pos = await A.page.evaluate(() => { const m = document.getElementById('main').innerHTML; return { pi: m.indexOf('data-v="pi"'), nw: m.indexOf('data-v="oxNew"') }; });
  check('2 הזמנות בלבד: במסך ההזמנות – כפתור עם מונה 3, אחרי "הזמנה חדשה", בלי גלישה', e && e.n === '3' && pos.pi > pos.nw && pos.nw >= 0 && o.sw <= o.W && !o.bad.length, { e, pos, o });
  await show(A.page, 'shelf'); e = await entry(A.page);
  check('2א הזמנות בלבד: במסך המדף (אם נפתח) אין כניסה', !e, e);
  await A.ctx.close();

  // ---- 3. שני המודולים + "לטיפול" של מנהל ----
  const cA = { mode: 'new', users: { m: 'biz-o', w: 'biz-o', w0: 'biz-o' }, biz: { 'biz-o': { dataRoot: 'b', features: ALL, name: 'עסק בדיקה' } }, admins: { 'b/biz-o/|m': 1 }, staff: { 'b/biz-o/|w': 1, 'b/biz-o/|w0': 1 } };
  A = await open(browser, www, cA, 'm@x.co');
  await show(A.page, 'shelf'); const eS = await entry(A.page);
  await show(A.page, 'ox'); const eO = await entry(A.page);
  check('3 שני המודולים: הכניסה מופיעה גם במדף וגם בהזמנות (מונה 3)', eS && eO && eS.n === '3' && eO.n === '3', { eS, eO });
  const l0 = lists();
  for (let i = 0; i < 5; i++) { await A.page.evaluate(() => rerender()); await sleep(50); }
  check('3א מטמון קצר: ציור חוזר של המסך לא שולח שאילתה נוספת', lists() === l0, { before: l0, after: lists() });
  await show(A.page, 'todo');
  const td = await A.page.evaluate(() => { const b = document.querySelector('#main [data-v="pi"]'); const h = [...document.querySelectorAll('#main .sec h3')].map((x) => x.innerText); return { b: b && b.innerText.replace(/\s+/g, ' ').trim(), n: b && b.querySelector('.tag') && b.querySelector('.tag').innerText.trim(), h, c: todoC(), s: (document.querySelector('.sub,#sub,header small') || {}).innerText || '' }; });
  o = await noOverflow(A.page);
  check('3ב "לטיפול": סעיף "חשבוניות לתמחור" עם מונה 3 ו"בטיפול של רותי"; todoC.n כולל אותן', td.b && td.n === '3' && td.h.includes('חשבוניות לתמחור') && /בטיפול של רותי/.test(td.b) && td.c.pi === 3 && td.c.n >= 3 && o.sw <= o.W && !o.bad.length, { td, o });
  if (shot) { fs.mkdirSync(path.dirname(shot), { recursive: true }); await A.page.evaluate(() => window.scrollTo(0, 0)); await A.page.screenshot({ path: shot }); }
  // חשבונית שסיימו לטפל בה נעלמת מהמונים (אחרי שהמטמון פג / כניסה למסך הרשימה)
  S.inv.i1.st = 'done';
  await A.page.evaluate(() => { PI.ls.at = 0; }); await A.page.evaluate(() => go('pi')); await sleep(600); await A.page.evaluate(() => goBack()); await sleep(300); await A.page.evaluate(() => rerender()); await sleep(200);
  const td2 = await A.page.evaluate(() => { const b = document.querySelector('#main [data-v="pi"]'); return { n: b && b.querySelector('.tag') && b.querySelector('.tag').innerText.trim(), pi: todoC().pi, v: cur().v }; });
  check('3ג חשבונית שהסתיימה יוצאת מהמונה (2)', td2.n === '2' && td2.pi === 2 && td2.v === 'todo', td2);
  // כל החשבוניות טופלו → אין סעיף
  for (const k of Object.keys(S.inv)) S.inv[k].st = 'done';
  await A.page.evaluate(() => { PI.ls.at = 0; }); await A.page.evaluate(() => go('pi')); await sleep(600); await A.page.evaluate(() => goBack()); await sleep(300); await A.page.evaluate(() => rerender()); await sleep(200);
  const td3 = await A.page.evaluate(() => ({ b: !!document.querySelector('#main [data-v="pi"]'), pi: todoC().pi }));
  check('3ד אין חשבוניות פתוחות – אין סעיף ב"לטיפול", המונה 0', !td3.b && td3.pi === 0, td3);
  check('3ה אין שגיאות JavaScript (מנהל)', !A.page.__errors.length, A.page.__errors);
  await A.ctx.close();

  // ---- 4. עובד עם prc: בבית העובד, במדף ובהזמנות ----
  S.inv = fresh();
  const W = await open(browser, www, cA, 'w@x.co', { prc: true, ord: true });
  await show(W.page, 'wk'); e = await entry(W.page); o = await noOverflow(W.page);
  check('4 עובד עם prc: בבית העובד – "חשבוניות לתמחור" עם מונה 3, בלי גלישה', e && e.n === '3' && o.sw <= o.W && !o.bad.length, { e, o, v: await W.page.evaluate(() => cur().v) });
  await show(W.page, 'shelf'); const wS = await entry(W.page);
  await show(W.page, 'ox'); const wO = await entry(W.page);
  check('4א עובד עם prc: גם במדף ובהזמנות', !!wS && !!wO, { wS, wO });
  await show(W.page, 'todo'); e = await entry(W.page);
  check('4ב עובד: אין "לטיפול" של מנהל', !e, e);
  check('4ג אין שגיאות JavaScript (עובד עם prc)', !W.page.__errors.length, W.page.__errors);
  await W.ctx.close();

  // ---- 5. עובד בלי prc: שום כניסה, ושום שאילתה ----
  const l5 = lists();
  const W0 = await open(browser, www, cA, 'w0@x.co', { ord: true, expW: true });
  const seen = [];
  for (const v of ['wk', 'shelf', 'ox']) { await show(W0.page, v); seen.push([v, await entry(W0.page)]); }
  check('5 עובד בלי prc: אין כניסה בבית, במדף ובהזמנות, ואין שאילתת pinv', seen.every(([, x]) => !x) && lists() === l5, { seen, q: lists() - l5 });
  check('5א אין שגיאות JavaScript (עובד בלי prc)', !W0.page.__errors.length, W0.page.__errors);
  await W0.ctx.close();

  // ---- 6. לארג' פעמי (legacy): מסך עובדים עם מתג אחד לכל עובד ----
  S.staff = [{ uid: 'm', name: 'המנהל', role: 'manager', active: true }, { uid: 'w', name: 'דני הארוך מאוד שם עובד ארוך', email: 'dani.long.email@example.co.il', role: 'employee', active: true },
    { uid: 'w2', name: 'רותי', email: 'r@x.co', role: 'employee', active: true, perms: { incW: true, expR: true, expW: true, sup: true, ord: true, prc: true } }, { uid: 'w3', name: 'יוסי', role: 'employee', active: false }];
  const cL = { mode: 'new', biz: { largpeami: { dataRoot: 'legacy', features: ALL } }, admins: { '|m': 1 }, staff: { '|w': 1 } };
  const L = await open(browser, www, cL, 'm@x.co');
  await L.page.evaluate(() => go('sync')); await sleep(400);
  const menu = await L.page.evaluate(() => !!document.querySelector('#main [data-a="go"][data-v="piStf"]'));
  await L.page.click('#main [data-v="piStf"]'); await sleep(600);
  const st = await L.page.evaluate(() => [...document.querySelectorAll('#main input[data-c="piPrc"]')].map((c) => ({ uid: c.dataset.uid, on: c.checked })));
  o = await noOverflow(L.page);
  check('6 לארג\' פעמי: כניסה במסך "עובדים ופרסום קטגוריות"; מתג לכל עובד (בלי המנהל); רותי דולק, דני ויוסי כבויים; בלי גלישה', menu && JSON.stringify(st) === JSON.stringify([{ uid: 'w', on: false }, { uid: 'w3', on: false }, { uid: 'w2', on: true }]) && o.sw <= o.W && !o.bad.length, { menu, st, o });
  await L.page.click('#main input[data-c="piPrc"][data-uid="w"]'); await sleep(400);
  const c6 = S.calls.filter((c) => c.fn === 'setStaffPrc');
  check('6א הדלקה → setStaffPrc({uid:"w", on:true}) בלבד (בלי שאר ההרשאות)', c6.length === 1 && JSON.stringify(c6[0].b) === JSON.stringify({ uid: 'w', on: true }), c6);
  S.prcFail = 1;
  await L.page.click('#main input[data-c="piPrc"][data-uid="w2"]'); await sleep(400);
  const back = await L.page.evaluate(() => document.querySelector('#main input[data-c="piPrc"][data-uid="w2"]').checked);
  check('6ב השרת דחה → המתג חוזר למצב הקודם', back === true, back);
  check('6ג אין שגיאות JavaScript (לארג\' פעמי)', !L.page.__errors.length, L.page.__errors);
  await L.ctx.close();
  // עסק במבנה b: המסך הרגיל (בלי המתג החדש)
  const B = await open(browser, www, cA, 'm@x.co');
  await B.page.evaluate(() => go('staff')); await sleep(400);
  const b6 = await B.page.evaluate(() => !!document.querySelector('#main input[data-c="piPrc"]'));
  await B.page.evaluate(() => go('sync')); await sleep(300);
  const b6s = await B.page.evaluate(() => !!document.querySelector('#main [data-v="piStf"]'));
  await B.page.evaluate(() => go('piStf')); await sleep(300);
  const b6f = await B.page.evaluate(() => ({ t: document.getElementById('main').innerText.slice(0, 60), c: !!document.querySelector('#main input[data-c="piPrc"]') }));
  check('6ד עסק במבנה b: מסך העובדים הרגיל ובלי כניסה למתג של לארג\' פעמי; גם בכוח – לא מוצג', !b6 && !b6s && !b6f.c, { b6, b6s, b6f });
  const pm = await B.page.evaluate(() => PMK.map((x) => x[0]));
  check('6ה PMK כולל את prc ("עדכון מחירים ומלאי") – שמירת הרשאות מהמסך לא מכבה אותו', pm.includes('prc') && (await B.page.evaluate(() => PMK.find((x) => x[0] === 'prc')[1])) === 'עדכון מחירים ומלאי', pm);
  await B.ctx.close();

  await browser.close();
  if (out) fs.writeFileSync(out, JSON.stringify({ fail, res }, null, 1));
  console.log(fail ? `נכשלו ${fail}` : 'הכול עבר');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
