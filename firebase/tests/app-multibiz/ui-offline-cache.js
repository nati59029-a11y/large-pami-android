'use strict';
// שלב B1 (24.11.2026): מטמון מכשיר משותף (www/dev-cache.js, DC) והחזרת מידע שמור כשאין אינטרנט. רשת מדומה, בלי אמולטור.
// קריאה עם רשת נשמרת; אותה קריאה בלי רשת מחזירה את המידע השמור ומציגה שורת "אין חיבור"; כתיבה בלי רשת נכשלת כמו היום;
// 403/500 לא מוחלפים במידע שמור; תורי קליטה (inbox) לא נשמרים; פונקציות שרת – רק מהרשימה הסגורה; יציאה מהחשבון מוחקת את lp-cache.
// שימוש: node ui-offline-cache.js <www-dir>
const H = require('./harness');
const BZ0 = ['larg', 'peami'].join('');
const ALL = Object.fromEntries(['tasks', 'requests', 'groups'].map((k) => [k, true]));
let fail = 0; const check = (n, ok, info) => { if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const S = (v) => ({ stringValue: String(v) });
const DOCS = 'projects/demo-largpeami/databases/(default)/documents/';
const docOf = (name, f) => ({ name: DOCS + name, fields: f, createTime: '2026-11-03T09:00:00Z', updateTime: '2026-11-03T09:00:00Z' });
let OFF = false, FORB = 0, VER = 'א'; const HITS = [];
async function mockCloud(ctx) {
  await ctx.route((u) => ['8080', '5001', '9099'].includes(new URL(u).port), async (route) => {
    const req = route.request(), u = new URL(req.url()), m = req.method(), p = decodeURIComponent(u.pathname), body = req.postData() || '';
    const ok = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    const err = (c, s) => route.fulfill({ status: c, contentType: 'application/json', body: JSON.stringify({ error: { code: c, message: s, status: s } }) });
    if (OFF) return route.abort('internetdisconnected');
    if (u.port === '5001') { const fn = p.split('/').pop(); if (fn === 'tkStaffNames') { HITS.push('fn:' + fn); return ok({ result: { L: [{ uid: 'w2', name: 'עובד ' + VER }] } }); } return route.fallback(); }
    if (u.port !== '8080') return route.fallback();
    const i = p.indexOf('/documents'); if (i < 0) return route.fallback(); const R = p.slice(i + 10).split('?')[0];
    let qc = ''; if (R === ':runQuery') { try { qc = JSON.parse(body).structuredQuery.from[0].collectionId; } catch (e) { /* */ } }
    if (!/^\/(zz|inbox)(\/|$)/.test(R) && qc !== 'zz') return route.fallback();
    HITS.push(m + ' ' + R);
    if (FORB) return err(FORB, FORB === 403 ? 'PERMISSION_DENIED' : 'INTERNAL');
    if (R === ':runQuery') return ok([{ document: docOf('zz/q1', { t: S('שורה ' + VER) }), readTime: 'x' }]);
    if (R === '/zz/d1' && m === 'GET') return ok(docOf('zz/d1', { t: S('מסמך ' + VER) }));
    if (R === '/inbox/i1' && m === 'GET') return ok(docOf('inbox/i1', { status: S('new') }));
    if (m === 'GET') return err(404, 'NOT_FOUND');
    return ok(docOf(R.slice(1), {}));
  });
}
const idbKeys = (page) => page.evaluate(() => new Promise((res) => { const r = indexedDB.open('lp-cache', 1); r.onupgradeneeded = () => { const s = r.result.createObjectStore('k'); s.createIndex('a', 'a'); }; r.onsuccess = () => { const d = r.result, q = d.transaction('k').objectStore('k').getAllKeys(); q.onsuccess = () => { d.close(); res(q.result.map(String)); }; q.onerror = () => { d.close(); res([]); }; }; r.onerror = () => res(['ERR']); }));
const banner = (page) => page.evaluate(() => { const e = document.getElementById('dcnet'); return e ? e.innerText : ''; });
// מריץ קריאה בדף ומחזיר { v } או { e: { offline, code, msg } }
const run = (page, code) => page.evaluate(async (c) => { try { const v = await (0, eval)('(async()=>' + c + ')()'); return { v }; } catch (e) { return { e: { offline: !!e.offline, code: e.code || 0, msg: String(e.message || '') } }; } }, code);
const QB = JSON.stringify({ structuredQuery: { from: [{ collectionId: 'zz' }], limit: 5 } });

(async () => {
  const [www] = process.argv.slice(2); const browser = await H.launch();
  const cfg = { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: ALL } }, admins: { '|m': 1 }, staff: { '|w1': 1 } };
  const x = await H.newPage(browser, www, cfg, [], 'w-offline-cache'); const wp = x.page; await wp.setViewportSize({ width: 412, height: 900 });
  await mockCloud(x.ctx); await H.login(wp, 'w1@x.co'); await sleep(800);
  check('0 DC נטען לפני הסקריפט הראשי', await wp.evaluate(() => !!(window.DC && DC.get && DC.put && DC.del && DC.out)));

  // 1. עם רשת: קריאות נשמרות; כתיבה ותור קליטה לא נשמרים
  const r1 = await run(wp, "fsx('/zz/d1')"), r1q = await run(wp, `fsx(':runQuery',{method:'POST',body:${JSON.stringify(QB)}})`), r1f = await run(wp, "fnCall('tkStaffNames',{})");
  await run(wp, "fsx('/zz/d2?updateMask.fieldPaths=t',{method:'PATCH',body:JSON.stringify({fields:{t:{stringValue:'x'}}})})"); await run(wp, "fsx('/inbox/i1')");
  await sleep(600); const k1 = await idbKeys(wp);
  check('1 קריאה עם רשת חוזרת כרגיל', r1.v && r1.v.fields.t.stringValue === 'מסמך א' && r1q.v && r1q.v[0].document && r1f.v && r1f.v.L[0].name === 'עובד א', [r1, r1q, r1f]);
  check('1א נשמרו במכשיר: GET מסמך, runQuery ופונקציית קריאה (מפתח עסק|משתמש|...)', k1.some((k) => k.startsWith(BZ0 + '|w1|GET|') && k.endsWith('/zz/d1')) && k1.some((k) => /\|w1\|POST\|.*:runQuery\|/.test(k)) && k1.some((k) => /\|w1\|FN\|.*\/tkStaffNames\|/.test(k)), k1);
  check('1ב כתיבה (PATCH) ותור קליטה (inbox) לא נשמרו', !k1.some((k) => /PATCH|\/zz\/d2|\/inbox\//.test(k)), k1);
  check('1ג אין שורת "אין חיבור" כשיש רשת', (await banner(wp)) === '' && await wp.evaluate(() => !DC.stale));

  // 2. בלי רשת (גם אחרי טעינה מחדש): המידע השמור + שורת "אין חיבור"
  VER = 'ב'; OFF = true; await wp.reload(); await sleep(1500);
  const r2 = await run(wp, "fsx('/zz/d1')"), r2q = await run(wp, `fsx(':runQuery',{method:'POST',body:${JSON.stringify(QB)}})`), r2f = await run(wp, "fnCall('tkStaffNames',{})");
  check('2 בלי רשת: אותה קריאה מחזירה את המידע השמור (מסמך, שאילתה, פונקציה)', r2.v && r2.v.fields.t.stringValue === 'מסמך א' && r2q.v && r2q.v[0].document.fields.t.stringValue === 'שורה א' && r2f.v && r2f.v.L[0].name === 'עובד א', [r2, r2q, r2f]);
  const b2 = await banner(wp);
  check('2א מוצגת שורה "📴 אין חיבור – מוצג מידע שמור מ-HH:MM"', /^📴 אין חיבור – מוצג מידע שמור מ-(\d\d\/\d\d )?\d\d:\d\d$/.test(b2) && await wp.evaluate(() => DC.stale > 0), b2);
  const st2 = await wp.evaluate(() => { const e = document.getElementById('dcnet'), c = getComputedStyle(e), r = e.getBoundingClientRect(); return { pos: c.position, pe: c.pointerEvents, dir: e.dir, w: r.width, l: r.left, rt: r.right, vw: innerWidth }; });
  check('2ב השורה קטנה, לא חוסמת לחיצות ובתוך המסך (412px)', st2.pos === 'fixed' && st2.pe === 'none' && st2.dir === 'rtl' && st2.l >= 0 && st2.rt <= st2.vw && st2.w < st2.vw, st2);
  const r2n = await run(wp, "fsx('/zz/none')"), r2i = await run(wp, "fsx('/inbox/i1')"), r2g = await run(wp, "fnCall('tkStaffNames',{x:1})");
  check('2ג בלי רשת וקריאה שלא נשמרה (גם תור קליטה, גם גוף אחר לפונקציה) – שגיאת "אין חיבור" כמו היום', r2n.e && r2n.e.offline && r2i.e && r2i.e.offline && r2g.e && r2g.e.offline, [r2n, r2i, r2g]);

  // 3. כתיבה בלי רשת – נכשלת כמו היום, ולא נשמרת
  const w1 = await run(wp, "fsx('/zz/d1?updateMask.fieldPaths=t',{method:'PATCH',body:JSON.stringify({fields:{t:{stringValue:'y'}}})})");
  const w2 = await run(wp, "fsx('/zz?documentId=n1',{method:'POST',body:JSON.stringify({fields:{}})})");
  const w3 = await run(wp, "fsx(':commit',{method:'POST',body:JSON.stringify({writes:[]})})");
  const w4 = await run(wp, "fsx('/zz/d1',{method:'DELETE'})");
  const w5 = await run(wp, "fnCall('setStaffName',{uid:'w2',name:'x'})");
  check('3 כתיבה בלי רשת (PATCH, POST, :commit, DELETE, פונקציית כתיבה) נכשלת עם "אין חיבור"', [w1, w2, w3, w4, w5].every((r) => r.e && r.e.offline), [w1, w2, w3, w4, w5]);
  const k3 = await idbKeys(wp);
  check('3א שום כתיבה לא נשמרה במכשיר', !k3.some((k) => /\|(PATCH|DELETE)\||documentId|:commit|setStaffName/.test(k)), k3);

  // 4. טוקן שפג בלי רשת: עדיין המידע השמור
  const r4 = await run(wp, "(SY.exp=0, fsx('/zz/d1'))"), r4f = await run(wp, "fnCall('tkStaffNames',{})");
  check('4 טוקן שפג תוקפו ואין רשת – עדיין המידע השמור', r4.v && r4.v.fields.t.stringValue === 'מסמך א' && r4f.v && r4f.v.L[0].name === 'עובד א', [r4, r4f]);

  // 5. השרת ענה 403 / 500 – השגיאה נשארת (לא מוחלפת במידע השמור)
  OFF = false; FORB = 403; const r5 = await run(wp, "fsx('/zz/d1')"); FORB = 500; const r5b = await run(wp, "fsx('/zz/d1')"); FORB = 0;
  check('5 תשובת 403 ו-500 מהשרת לא מוחלפות במידע השמור', r5.e && r5.e.code === 403 && !r5.e.offline && r5b.e && r5b.e.code === 500, [r5, r5b]);

  // 6. קריאה מוצלחת מהשרת – השורה נעלמת, והמידע החדש נשמר
  const r6 = await run(wp, "fsx('/zz/d1')"); await sleep(400);
  check('6 קריאה מוצלחת: מידע חדש מהשרת והשורה נעלמה', r6.v && r6.v.fields.t.stringValue === 'מסמך ב' && (await banner(wp)) === '' && await wp.evaluate(() => !DC.stale), [r6, await banner(wp)]);
  OFF = true; const r6b = await run(wp, "fsx('/zz/d1')"); OFF = false;
  check('6א בלי רשת שוב: מוחזר המידע העדכני ששמור עכשיו', r6b.v && r6b.v.fields.t.stringValue === 'מסמך ב', r6b);
  await run(wp, "fsx('/zz/d1')");

  // 7. מגבלות: ערך מעל 3MB לא נשמר; עד 400 ערכים (הישן בשימוש נמחק)
  const lim = await wp.evaluate(async () => { const K = (s) => DC.key('GET', 'http://t/' + s); await DC.put(K('big'), 'x'.repeat(3 * 1024 * 1024 + 10)); const big = await DC.get(K('big'));
    for (let i = 0; i < 410; i++) await DC.put(K('n' + i), '{"i":' + i + '}');
    const first = await DC.get(K('n0')), last = await DC.get(K('n409'));
    return { big: big === null, first: first === null, last: !!last && JSON.parse(last.v).i === 409 }; });
  const k7 = await idbKeys(wp);
  check('7 מעל 3MB לא נשמר; יותר מ-400 ערכים – הישן ביותר נמחק', lim.big && lim.first && lim.last && k7.length <= 400, { lim, n: k7.length });
  const bad = await wp.evaluate(async () => { const a = await DC.get(''), b = await DC.get('אחר|x|GET|y'); await DC.put('', 'x'); return a === null && b === null; });
  check('7א מפתח ריק או של משתמש אחר – "אין מטמון", בלי שגיאה', bad);

  // 8. יציאה מהחשבון: lp-cache נמחק והשורה יורדת
  OFF = true; await run(wp, "fsx('/zz/d1')"); OFF = false;
  await wp.evaluate(() => syOut(1)); await sleep(800);
  const dbs = await wp.evaluate(async () => (indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name) : ['?']));
  check('8 יציאה מהחשבון (syOut → DC.out) מוחקת את lp-cache ומורידה את השורה', !dbs.includes('lp-cache') && (await banner(wp)) === '', dbs);
  check('9 אין שגיאות JS', wp.__errors.length === 0, wp.__errors);
  await x.ctx.close(); await browser.close();
  console.log(fail ? fail + ' בדיקות נכשלו' : 'כל הבדיקות עברו'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
