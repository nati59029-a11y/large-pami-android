'use strict';
// סריקת חנות בתלת מימד – שלב 14 (15.11.2026): נתוני הסריקה בגיבוי הקיים (שדה רשות st3), ושחזור שלא נוגע בהם.
// 1. מנהל, תוספת פעילה: mkBackup כולל st3 עם כל האוספים שבחוזה (סעיף 7), בלי s3sum/s3use/s3qid/s3ntf/s3draft ובלי תמונות; srun רק 12 חודשים.
// 2. גיבוי ישן (בלי st3) – parseBackup + חלון שחזור + doRestore בלי שגיאה, הנתונים חוזרים, אין שורת סריקה.
// 3. גיבוי חדש (עם st3) – שחזור לא כותב ולא מוחק שום מסמך סריקה (אין PATCH/POST/DELETE/commit לאוספי s3*), ומוצגת שורת הסבר.
// 4. st3 פגום – מתעלמים בלי שגיאה.  5. גיבוי יומי לענן (bk) כולל st3, וטעינה ממנו מחזירה אותו.
// 6. תוספת כבויה / עובד – אין st3 ואין קריאה לאוספי הסריקה.  7. ADM_FT כולל מתג store3d.
// 8. (תיקון סבב 1) תקרת גודל ותקרת זמן ל-st3; גיבוי מוצפן שחורג מ-ABK.max בגלל st3 נוצר שוב בלעדיו – התנועות נשמרות.
// רשת מדומה (בלי אמולטור). שימוש: node ui-st3d-bk.js <www-dir>
const H = require('./harness');
let fail = 0;
const check = (n, ok, info) => { if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 500) : '')); };
const BIZ = 'biz-k';
const enc = (v) => (v == null ? { nullValue: null } : typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }) : typeof v === 'string' ? { stringValue: v } : Array.isArray(v) ? { arrayValue: { values: v.map(enc) } } : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } });
const DOCS = `projects/demo-largpeami/databases/(default)/documents/b/${BIZ}/`;
const NOW = H.T0;
const TH = `b/${BIZ}/store3d/main/run/r1_20261101/f1-a-1_a_1_t.jpg`;
const FIX = {
  's3br/main': { wh: true, cap: 500, upd: NOW, by: 'sa' },
  's3set/main': { w: { hole: 30, price: 30, order: 20, clean: 20 }, recN: 3, upd: NOW, by: 'm' },
  'smap/s-main': { br: 'main', kind: 's', v: 2, seq: 3, rooms: [{ id: 'r1', p: [0, 0, 700, 0, 700, 1400, 0, 1400], h: 300 }], fx: [{ id: 'f1', x: 350, y: 700, w: 400, d: 90 }], conf: 0.5, upd: NOW, by: 'm' },
  'smap/s-main/ver/000001': { v: 1, at: NOW - 5 * 86400000, by: 'm', why: 'עריכה', m: { rooms: [] } },
  'smap/s-main/ver/000002': { v: 2, at: NOW - 4 * 86400000, by: 'm', why: 'עריכה', m: { rooms: [] } },
  'smap/s-main/ver/000003': { v: 3, at: NOW - 3 * 86400000, by: 'm', why: 'עריכה', m: { rooms: [] } },
  'smap/s-main/ver/000004': { v: 4, at: NOW - 2 * 86400000, by: 'm', why: 'עריכה', m: { rooms: [] } },
  'smap/s-main/ver/000005': { v: 5, at: NOW - 1 * 86400000, by: 'm', why: 'עריכה', m: { rooms: [] } },
  'smap/s-main/bay/f1-a-1': { cat: 'משקאות', exp: 'בקבוקים', notes: [{ t: 'לא לספור את הקרטון', at: NOW, by: 'm' }], upd: NOW, by: 'm' },
  'sround/rule01': { br: 'main', map: 's-main', name: 'שבועי', f: { k: 'week', d: [0] }, asg: [{ u: 'w', z: [] }], uids: ['w'], on: true, upd: NOW, by: 'm' },
  'srun/r1_20261101': { br: 'main', map: 's-main', st: 'done', openAt: NOW - 2 * 86400000, dueAt: NOW, doneAt: NOW - 86400000, uids: ['w'], asg: { w: ['f1-a-1'] }, sc: 88 },
  'srun/r1_20261101/ph/f1-a-1_a': { p: TH.replace('_t.jpg', '.jpg'), th: TH, w: 1600, h: 1200, at: NOW - 86400000, by: 'w' },
  'srun/r1_20261101/ai/f1-a-1_a': { st: 'issue', conf: 0.8, iss: [{ k: 'hole', sev: 2, t: 'חור במדף' }], at: NOW - 86400000 },
  's3fix/r1_20261101__f1-a-1_a': { u: 'w', st: 'open', at: NOW, dueAt: NOW + 86400000 },
  's3appeal/r1_20261101__f1-a-1_a__0': { run: 'r1_20261101', slot: 'f1-a-1_a', ik: 0, by: 'w', txt: 'אין חור', at: NOW, st: 'open' },
  's3short/r1_20261101': { st: 'draft', it: [{ t: 'קולה', n: 3 }] },
  's3perf/w/m/2026-11': { runs: 1, sc: 88, upd: NOW },
  // לא נכנסים לגיבוי
  's3sum/s-main': { b: { 'f1-a-1': { s: 'iss', th: TH } }, upd: NOW },
  's3use/main_2026-11': { n: 3 }, 's3qid/q1': { at: NOW }, 's3ntf/k1': { at: NOW }, 's3draft/d1': { at: NOW, by: 'm' },
};
const S3RE = new RegExp(`/documents/b/${BIZ}/(s3br|s3set|smap|sround|srun|s3fix|s3appeal|s3short|s3perf|s3sum|s3use|s3qid|s3ntf|s3draft)(/|$|\\?)`);
const doc = (rel) => ({ name: DOCS + rel, fields: enc(FIX[rel]).mapValue.fields, createTime: '2026-11-03T09:00:00Z', updateTime: '2026-11-03T09:00:00Z' });

async function open(browser, www, who, feat, o) {
  const cfg = { mode: 'new', users: { [who]: BIZ }, biz: { [BIZ]: { dataRoot: 'b', features: feat, name: 'עסק בדיקה' } },
    admins: o && o.mgr ? { [`b/${BIZ}/|${who}`]: 1 } : {}, staff: { [`b/${BIZ}/|${who}`]: 1 } };
  const log = [], R = { s3: [], q: [], bk: {} };
  const { ctx, page } = await H.newPage(browser, www, cfg, log, who);
  const j = (route, st, b) => route.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(b) });
  // אוספי הסריקה: קריאה (GET מסמך / רשימה) מתוך FIX. כל בקשה נרשמת
  await ctx.route((u) => u.port === '8080' && S3RE.test(u.pathname), (route) => {
    const rq = route.request(), u = new URL(rq.url()), rel = decodeURIComponent(u.pathname.split(`/documents/b/${BIZ}/`)[1]);
    R.s3.push(rq.method() + ' ' + rel);
    if (R.hang && rel === 's3br') return; // קריאה שלא נענית לעולם (8ה)
    if (rq.method() !== 'GET') return j(route, 200, { name: DOCS + rel, fields: {} });
    if (FIX[rel]) return j(route, 200, doc(rel));
    const kids = Object.keys(FIX).filter((k) => k.startsWith(rel + '/') && k.slice(rel.length + 1).split('/').length === 1);
    if (rel.split('/').length % 2 === 1) { let L = kids.sort(); if (/__name__ desc/.test(u.searchParams.get('orderBy') || '')) L = L.reverse(); L = L.slice(0, +u.searchParams.get('pageSize') || 300); return j(route, 200, L.length ? { documents: L.map(doc) } : {}); }
    return j(route, 404, { error: { code: 404, status: 'NOT_FOUND' } });
  });
  // שאילתות: srun (עם סינון openAt), bk (רשימת שמות) – השאר לרשת המדומה הכללית
  await ctx.route((u) => u.port === '8080' && /:runQuery$/.test(u.pathname), (route) => {
    let b = {}; try { b = JSON.parse(route.request().postData()); } catch (e) { /* */ }
    const c = b.structuredQuery && b.structuredQuery.from && b.structuredQuery.from[0].collectionId;
    R.q.push(b.structuredQuery);
    if (c === 'srun') { const cut = +(((b.structuredQuery.where || {}).fieldFilter || {}).value || {}).integerValue || 0; R.s3.push('QUERY srun');
      return j(route, 200, Object.keys(FIX).filter((k) => /^srun\/[^/]+$/.test(k) && FIX[k].openAt >= cut).map((k) => ({ document: doc(k), readTime: 'x' }))); }
    if (c === 'ver') { const par = decodeURIComponent(new URL(route.request().url()).pathname.split(`/documents/b/${BIZ}/`)[1].replace(/:runQuery$/, '')); R.s3.push('QUERY ' + par + '/ver');
      const L = Object.keys(FIX).filter((k) => k.startsWith(par + '/ver/')).sort((x, y) => FIX[y].at - FIX[x].at).slice(0, b.structuredQuery.limit || 300);
      return j(route, 200, L.map((k) => ({ document: doc(k), readTime: 'x' }))); }
    if (c === 'bk') return j(route, 200, Object.keys(R.bk).map((k) => ({ document: { name: DOCS + 'bk/' + k }, readTime: 'x' })));
    return route.fallback();
  });
  // אוסף הגיבוי לענן bk: שומרים את מה שנכתב, ומחזירים אותו בקריאה
  await ctx.route((u) => u.port === '8080' && new RegExp(`/documents/b/${BIZ}/bk/`).test(u.pathname), (route) => {
    const rq = route.request(), id = decodeURIComponent(new URL(rq.url()).pathname.split('/bk/')[1]);
    if (rq.method() === 'PATCH') { try { R.bk[id] = JSON.parse(rq.postData()).fields; } catch (e) { /* */ } return j(route, 200, { name: DOCS + 'bk/' + id, fields: R.bk[id] }); }
    if (rq.method() === 'DELETE') { delete R.bk[id]; return j(route, 200, {}); }
    return R.bk[id] ? j(route, 200, { name: DOCS + 'bk/' + id, fields: R.bk[id] }) : j(route, 404, { error: { code: 404, status: 'NOT_FOUND' } });
  });
  // Storage (גיבוי מוצפן app_backups): שומרים את הקובץ שהועלה
  R.up = [];
  await ctx.route((u) => u.port === '9199', async (route) => {
    const rq = route.request(), u = new URL(rq.url());
    if (rq.method() === 'POST') { R.up.push(rq.postDataBuffer()); return j(route, 200, { name: u.searchParams.get('name') }); }
    if (rq.method() === 'DELETE') return j(route, 200, {});
    return j(route, 200, { items: [], prefixes: [] });
  });
  await H.login(page, who + '@x.co');
  await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden && ACT.startBlank) ACT.startBlank(); });
  await H.settle(page, 600);
  return { ctx, page, R, log };
}
const writesS3 = (R) => R.s3.filter((x) => !/^(GET|QUERY) /.test(x));

(async () => {
  const [www] = process.argv.slice(2);
  const browser = await H.launch();

  // ---------- 1. מנהל, תוספת פעילה ----------
  const A = await open(browser, www, 'm', { scan: true, store3d: true }, { mgr: true });
  A.R.s3.length = 0; // רק הקריאות של הגיבוי עצמו (מסך הבית קורא s3sum למיני)
  const b1 = await A.page.evaluate(async () => { const t = await mkBackup(); return t; });
  const o1 = JSON.parse(b1), st = o1.st3 || {};
  const paths = (st.docs || []).map((d) => d.p).sort();
  const want = ['s3appeal/r1_20261101__f1-a-1_a__0', 's3br/main', 's3fix/r1_20261101__f1-a-1_a', 's3perf/w/m/2026-11', 's3set/main', 's3short/r1_20261101', 'smap/s-main', 'smap/s-main/bay/f1-a-1', 'smap/s-main/ver/000003', 'smap/s-main/ver/000004', 'smap/s-main/ver/000005', 'sround/rule01', 'srun/r1_20261101', 'srun/r1_20261101/ai/f1-a-1_a', 'srun/r1_20261101/ph/f1-a-1_a'];
  check('1א גיבוי חדש: st3 קיים, v=1, כולל בדיוק את המסמכים שבחוזה (15; מהגרסאות – רק 3 האחרונות) (מפה, גרסאות, מקטעים, סבבים, תמונות-נתיבים, תוצאות AI, תיקונים, ערעורים, חוסרים, ביצועים)', st.v === 1 && JSON.stringify(paths) === JSON.stringify(want), paths);
  check('1ב לא נכנסים: s3sum, s3use, s3qid, s3ntf, s3draft – וגם לא נקראו בזמן הגיבוי', !paths.some((p) => /^(s3sum|s3use|s3qid|s3ntf|s3draft)\//.test(p)) && !A.R.s3.some((x) => /(s3sum|s3use|s3qid|s3ntf|s3draft)/.test(x)), A.R.s3.filter((x) => /(s3sum|s3use|s3qid|s3ntf|s3draft)/.test(x)));
  const s3txt = JSON.stringify(st);
  check('1ג בלי תמונות: אין data:image / base64 ב-st3; ב-ph נשמר רק הנתיב', !/data:image|;base64,/.test(s3txt) && s3txt.includes(TH), s3txt.length);
  const run = (st.docs || []).find((d) => d.p === 'srun/r1_20261101');
  check('1ד המסמך נשמר בפורמט המקורי (int נשאר integerValue, double נשאר doubleValue)', run && run.f.sc && run.f.sc.integerValue === '88' && (st.docs.find((d) => d.p === 'smap/s-main').f.conf || {}).doubleValue === 0.5, run && run.f.sc);
  const q = A.R.q.find((x) => x && x.from && x.from[0].collectionId === 'srun');
  const cut = q && +q.where.fieldFilter.value.integerValue;
  check('1ה סבבים: שאילתה אחת על openAt (שדה אחד – בלי אינדקס חדש), 12 חודשים אחורה, מהחדש לישן', q && q.orderBy && q.orderBy[0].direction === 'DESCENDING' && q.where.fieldFilter.field.fieldPath === 'openAt' && q.where.fieldFilter.op === 'GREATER_THAN_OR_EQUAL' && Math.abs((NOW - cut) / 864e5 - 372) < 2, q && q.where);
  check('1ו שאר קובץ הגיבוי לא השתנה: app, schema 4, data, files, fb, shelf', o1.app === 'large-pami' && o1.schema === 4 && Array.isArray(o1.data.tx) && o1.files && o1.fb && o1.shelf, Object.keys(o1));
  check('1ז הגיבוי לא כתב שום דבר באוספי הסריקה', writesS3(A.R).length === 0, writesS3(A.R));
  check('1ח מסך גיבוי ושחזור מציין שנתוני הסריקה בגיבוי', await A.page.evaluate(() => { go('data'); return /נתוני סריקת החנות \(בלי תמונות\)/.test(document.querySelector('#main').innerText); }));
  check('7 ADM_FT: מתג store3d בכרטיס העסק, ובעסק legacy גם הוא מוצג', await A.page.evaluate(() => ADM_FT.some((x) => x[0] === 'store3d')));

  // ---------- 2. גיבוי ישן (בלי st3) ----------
  const old = Object.assign({}, o1); delete old.st3;
  A.R.s3.length = 0;
  const r2 = await A.page.evaluate(async (t) => {
    const n0 = S.tx.length; const r = parseBackup(t); restoreFlow(r);
    const dl = (document.querySelector('#dlg') || document.body).innerText;
    S.tx = []; await ACT.doRestore();
    return { st3: r.st3, dl: /סריקת חנות/.test(dl), back: S.tx.length === n0, ok: !!document.querySelector('#main') };
  }, JSON.stringify(old));
  check('2א גיבוי ישן: parseBackup מחזיר st3=null, בלי שגיאה', r2.st3 === null, r2);
  check('2ב גיבוי ישן: חלון השחזור בלי שורת סריקה; השחזור הושלם והתנועות חזרו', !r2.dl && r2.back && r2.ok, r2);
  // גיבוי ישן מאוד (schema 3, בלי fb/shelf/st3)
  const r2b = await A.page.evaluate((t) => { const r = parseBackup(t); return { st3: r.st3, legacy: r.legacy, schema: r.schema }; }, JSON.stringify({ app: 'large-pami', schema: 3, date: '2025-06-01T00:00:00Z', data: o1.data }));
  check('2ג גיבוי schema 3 בלי השדות החדשים – נטען בלי שגיאה', r2b.st3 === null && r2b.legacy === false && r2b.schema === 3, r2b);
  check('2ד שחזור גיבוי ישן לא נגע באוספי הסריקה', writesS3(A.R).length === 0, writesS3(A.R));

  // ---------- 3. גיבוי חדש (עם st3) ----------
  A.R.s3.length = 0;
  const r3 = await A.page.evaluate(async (t) => {
    const n0 = S.tx.length; const r = parseBackup(t); restoreFlow(r);
    const dl = (document.querySelector('#dlg') || document.body).innerText;
    await ACT.doRestore();
    return { n: r.st3 && r.st3.docs.length, dl: (dl.match(/הגיבוי כולל גם נתוני סריקת חנות[^\n]*/) || [''])[0], back: S.tx.length === n0, inS: 'st3' in S };
  }, b1);
  check('3א גיבוי חדש: parseBackup מחזיר את st3; חלון השחזור מסביר שנתוני הסריקה בשרת לא משתנים', r3.n === 15 && /1 מפות, 1 סבבים/.test(r3.dl) && /לא משנה ולא מוחק/.test(r3.dl), r3);
  check('3ב השחזור הושלם; st3 לא נכנס לנתוני הטלפון (S)', r3.back && !r3.inS, r3);
  const commits = A.log.filter((x) => /:commit$/.test(x.url) && /\/(s3br|s3set|smap|sround|srun|s3fix|s3appeal|s3short|s3perf)\//.test(x.body));
  check('3ג השחזור לא כתב ולא מחק שום מסמך סריקה (אין PATCH/POST/DELETE/commit)', writesS3(A.R).length === 0 && commits.length === 0, { w: writesS3(A.R), c: commits.length });

  // ---------- 4. st3 פגום ----------
  const r4 = await A.page.evaluate((t) => { const o = JSON.parse(t); o.st3 = 'x'; const r = parseBackup(JSON.stringify(o)); o.st3 = { docs: 5 }; const r2 = parseBackup(JSON.stringify(o)); return [r.st3, r2.st3, S3BK.note(r), S3BK.note({ st3: { docs: 5 } })]; }, b1);
  check('4 st3 פגום (מחרוזת / docs לא רשימה) – מתעלמים, בלי שגיאה ובלי שורה', r4[0] === null && r4[1] === null && r4[2] === '' && r4[3] === '', r4);

  // ---------- 5. גיבוי יומי לענן (bk) ----------
  const r5 = await A.page.evaluate(async () => { S3BK.reset(); const ok = await bkCloud(true); const r = await bkCloudGet(); return { ok, n: r.st3 && r.st3.docs.length, tx: Array.isArray(r.d.tx) }; });
  check('5 גיבוי לענן (bk): נשמר עם st3, וטעינה ממנו מחזירה אותו', r5.ok === true && r5.n === 15 && r5.tx, r5);
  // ---------- 8. תקרות (תיקון סבב 1): נתוני הסריקה לא מפילים את הגיבוי ----------
  const r8 = await A.page.evaluate(async () => { S3BK.reset(); const M = S3BK.L.MAX; S3BK.L.MAX = 3000; let o; try { o = JSON.parse(await mkBackup()); } finally { S3BK.L.MAX = M; S3BK.reset(); }
    go('data'); const w = document.querySelector('#main').innerText;
    return { part: o.st3.part, miss: o.st3.miss, len: JSON.stringify(o.st3.docs).length, first: o.st3.docs.map((d) => d.p.split('/')[0]).slice(0, 2), tx: o.data.tx.length === S.tx.length, files: !!o.files, w: /גדולים מהתקרה/.test(w) }; });
  check('8א תקרת גודל: st3 נחתך (part=1, miss=size), מתחת לתקרה, הנתונים החשובים קודם (s3br, s3set); שאר הגיבוי שלם; הערה בעברית במסך הגיבוי', r8.part === 1 && r8.miss[0] === 'size' && r8.len < 3000 && r8.first.join() === 's3br,s3set' && r8.tx && r8.files && r8.w, r8);
  const r9 = await A.page.evaluate(async () => { S3BK.reset(); const T = S3BK.L.TIME; S3BK.L.TIME = -1; let o; try { o = JSON.parse(await mkBackup()); } finally { S3BK.L.TIME = T; S3BK.reset(); } return { part: o.st3.part, miss: o.st3.miss, tx: o.data.tx.length === S.tx.length }; });
  check('8ב תקרת זמן: האיסוף נעצר (part=1, miss=time), הגיבוי נוצר כרגיל', r9.part === 1 && r9.miss[0] === 'time' && r9.tx, r9);
  A.R.up.length = 0;
  const r10 = await A.page.evaluate(async () => {
    // תנועה עם קובץ מצורף במכשיר, ומונים: כמה פעמים נקרא הקובץ (fget) וכמה פעמים הוצפן (abkEnc)
    if (!S.tx.some((t) => t.file === 'fbk1')) { await fput('fbk1', 'data:image/png;base64,iVBORw0KGgo='); S.tx.push({ id: 'tbk1', t: 'inc', cat: (S.cats[0] || {}).id || 'x', date: '2026-11-01', amt: 100, note: '', file: 'fbk1' }); save(); }
    window.__fg = 0; window.__en = 0; const f0 = fget, e0 = abkEnc; fget = async (...a) => { if (a[0] === 'fbk1') window.__fg++; return f0(...a); }; abkEnc = async (...a) => { window.__en++; return e0(...a); };
    S3BK.reset(); const c = await bkCollect(undefined, true); const full = (await e0(await mkBackup(0, c))).length, bare = (await e0(await mkBackup(0, c, { v: 1, at: 1, months: 12, n: {}, docs: [], part: 1, miss: ['big'] }))).length;
    window.__fg = 0; window.__en = 0;
    const M = ABK.max; ABK.max = Math.floor((full + bare) / 2); let ok; try { ok = await abkRun('test'); } finally { ABK.max = M; }
    const fg = window.__fg, en = window.__en; go('data'); const w = /הגיבוי המוצפן נשמר בלעדיהם/.test(document.querySelector('#main').innerText);
    // 8ד: חריגה שלא בגלל st3 (st3 ריק – תקרת גודל 0): בלי ניסיון שני, אותה שגיאה כמו קודם
    S3BK.reset(); const MX = S3BK.L.MAX; S3BK.L.MAX = 0; window.__fg = 0; window.__en = 0; ABK.run = 0; ABK.max = 10; let ok2; try { ok2 = await abkRun('test'); } finally { ABK.max = M; S3BK.L.MAX = MX; S3BK.reset(); }
    const d2 = { ok: ok2, fg: window.__fg, en: window.__en, err: abkGet().err || '' };
    fget = f0; abkEnc = e0;
    go('data'); return { full, bare, ok, fg, en, d2, skip: 'skip' in S3BK, w }; });
  let r10b = null;
  if (A.R.up.length) r10b = await A.page.evaluate(async (b64) => { const u = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); const o = parseBackup(await abkDec(u.buffer)); return { tx: o.d.tx.length === S.tx.length, st3: o.st3 && { miss: o.st3.miss, n: o.st3.docs.length } }; }, A.R.up[0].toString('base64'));
  check('8ג גיבוי מוצפן שחורג מהתקרה בגלל st3: נוצר שוב בלי נתוני הסריקה, הועלה עם התנועות, בלי שגיאה, והערה בעברית', r10.ok === true && r10.skip === false && r10.w && A.R.up.length === 1 && r10b && r10b.tx && r10b.st3 && r10b.st3.miss[0] === 'big' && r10b.st3.n === 0, { r10, r10b });
  check('8ג2 (סבב 2) בלי קריאה כפולה: הקובץ המצורף נקרא פעם אחת (fget=1), שתי הצפנות (מלא ← בלי st3), ואין דגל משותף S3BK.skip', r10.fg === 1 && r10.en === 2 && r10.skip === false, r10);
  check('8ד (סבב 2) חריגה שלא בגלל st3: אין ניסיון שני (הצפנה אחת, קובץ נקרא פעם אחת), אותה שגיאה "גדול מדי" כמו קודם', r10.d2.ok === false && r10.d2.en === 1 && r10.d2.fg === 1 && /גדול מדי/.test(r10.d2.err), r10.d2);
  // 8ה (סבב 2, הערה): קריאה שנתקעת בלי תשובה – העצירה הכפויה (TIME + 5 שניות) משחררת את הגיבוי
  A.R.hang = true;
  const r11 = await A.page.evaluate(async () => { S3BK.reset(); const T = S3BK.L.TIME; S3BK.L.TIME = 300; const t0 = performance.now(); let o; try { o = JSON.parse(await mkBackup()); } finally { S3BK.L.TIME = T; S3BK.reset(); } return { ms: Math.round(performance.now() - t0), miss: o.st3.miss, part: o.st3.part, tx: o.data.tx.length === S.tx.length }; });
  A.R.hang = false;
  check('8ה קריאה תקועה: הגיבוי הסתיים תוך פחות מ-10 שניות עם miss=time, והתנועות בגיבוי', r11.ms < 10000 && r11.miss[0] === 'time' && r11.part === 1 && r11.tx, r11);
  check('6א אין שגיאות JS (מנהל)', A.page.__errors.length === 0, A.page.__errors);
  await A.ctx.close();

  // ---------- 6. תוספת כבויה / עובד ----------
  const B = await open(browser, www, 'm', { scan: true }, { mgr: true });
  const b6 = JSON.parse(await B.page.evaluate(() => mkBackup()));
  check('6ב תוספת כבויה: אין st3, ואין אף קריאה לאוספי הסריקה', !('st3' in b6) && B.R.s3.length === 0, B.R.s3);
  check('6ג תוספת כבויה: ADM_FT עדיין מציג את המתג (רק מנהל־על משנה)', await B.page.evaluate(() => ADM_FT.filter((x) => x[0] === 'store3d').length === 1));
  check('6ד אין שגיאות JS (תוספת כבויה)', B.page.__errors.length === 0, B.page.__errors);
  await B.ctx.close();
  const W = await open(browser, www, 'w', { scan: true, store3d: true });
  const b7 = JSON.parse(await W.page.evaluate(() => mkBackup()));
  check('6ה עובד (תוספת פעילה): אין st3 ואין קריאה ל-srun/ai/ver', !('st3' in b7) && !W.R.s3.some((x) => /srun|\/ver|s3perf/.test(x)), W.R.s3);
  check('6ו אין שגיאות JS (עובד)', W.page.__errors.length === 0, W.page.__errors);
  await W.ctx.close();

  await browser.close();
  console.log(fail ? `נכשלו ${fail}` : 'כל הבדיקות עברו');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
