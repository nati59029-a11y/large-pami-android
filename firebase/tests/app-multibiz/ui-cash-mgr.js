'use strict';
// סבב 4, חבילה א': מסך המנהל "קופה והפקדות" (www/cash-mgr.js) וספירת שטרות ומטבעות בטופס סגירת הקופה. רשת מדומה, בלי אמולטור.
// לשוניות, בורר תקופה (השבוע / החודש / טווח) וקופה, כרטיס סיכום, רשימת סגירות ומעבר לפירוט הקיים, פתקי הוצאה מקופה,
// היסטוריית פערים לפי עובד, מטמון החודשים (בלי קריאות כפולות), בלי כתיבה לשרת; בטופס: 10 שדות ספירה, סכום, כמות שלילית, "חובה", cnt בסגירה שנשלחת.
// שימוש: node ui-cash-mgr.js <www-dir> [shots-dir]
const fs = require('fs'); const path = require('path'); const H = require('./harness');
const BZ0 = ['larg', 'peami'].join('');
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders', 'groups'].map((k) => [k, true]));
let fail = 0; const check = (n, ok, info) => { if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const S = (v) => ({ stringValue: String(v) }), I = (v) => ({ integerValue: String(v) }), N = (v) => ({ doubleValue: v }), A = (a) => ({ arrayValue: { values: a.map(S) } });
const T0 = H.T0, D1 = 864e5;
const DOCS = 'projects/demo-largpeami/databases/(default)/documents/';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
// טופס תקין: קרן 1500 + 2350 − 1400 = 2450
const F = (o) => Object.assign({ d: '', no: '12', credit: '5820', cash: '2350', total: '8170', float: '1500', csales: '2350', cout: '1400', drawer: '2450', oTot: '2450' }, o);
let DB, LOG;
const zc = (id, d, reg, by, uid, st, f, extra) => { DB.closings[id] = { uid: S(uid), by: S(by), t: I(T0 - D1), st: S(st), np: I(1), reg: S(reg), d: S(d), tm: S('21:00'), no: S(id), data: S(JSON.stringify(Object.assign({ v: 1, f: F(Object.assign({ d, oD: d }, f)) }, extra || {}))) }; };
const co = (id, o) => { DB.cashout[id] = Object.assign({ uid: S('w1'), by: S('dana'), t: I(T0 - D1), reg: S('i_yh'), d: S('2026-11-03'), tm: S('10:00'), a: N(100), why: S('—'), dep: S(''), src: S(''), zc: S(''), dp: S('') }, o); };
const seed = () => {
  DB = { closings: {}, cashout: {}, deposits: {} }; LOG = [];
  zc('z1', '2026-11-03', 'i_yh', 'dana', 'w1', 'ok', { drawer: '2405', oTot: '2405' });                      // חוסר 45
  zc('z2', '2026-11-02', 'i_nl', 'moshe', 'w2', 'new', {}, { cnt: { 200: 12, 20: 2, 5: 2 } });                // מאוזן, ממתין, עם ספירה
  zc('z3', '2026-11-02', 'i_yh', 'moshe', 'w2', 'ok', { oTot: '2460' });                                      // עודף 10
  zc('z4', '2026-10-20', 'i_nl', 'dana', 'w1', 'ok', { drawer: '2430', oTot: '2430' }, { cnt: { 200: 12, 10: 2, 0.5: 1 } }); // חוסר 20 (וספירה 2420.50 – חוסר 9.50; הגדול: 20)
  zc('z5', '2026-10-15', 'i_yh', 'dana', 'w1', 'rej', { drawer: '1000', oTot: '1000' });                      // נדחתה – לא נספרת
  zc('z6', '2026-10-10', 'i_nl', 'yossi', 'w3', 'ok', { float: '', drawer: '', oTot: '' });                  // לא ניתן לבדוק
  co('c1', { zc: S('z1'), a: N(500), why: S('ספק ירקות') });
  co('c2', { zc: S('z1'), d: S('2026-11-02'), a: N(300), why: S('הפקדה לבנק'), dep: S('1'), dp: S('p1') });
  co('c3', { reg: S('i_nl'), a: N(600), why: S('הפקדה לבנק – נחל לכיש'), dep: S('1') });
  co('c4', { zc: S('z4'), reg: S('i_nl'), d: S('2026-10-19'), a: N(200), why: S('משלוח') });
  DB.deposits.p1 = { uid: S('w1'), by: S('dana'), t: I(T0 - D1), d: S('2026-11-02'), items: A(['c2']), a: N(300), st: S('ok'), why: S(''), np: I(1), data: S('{}') };
};
const docOf = (name, f) => ({ name: DOCS + name, fields: f, createTime: '2026-11-03T09:00:00Z', updateTime: '2026-11-03T09:00:00Z' });
const val = (v) => (v.stringValue !== undefined ? v.stringValue : v.integerValue !== undefined ? +v.integerValue : v.doubleValue);
function match(w, f) {
  if (!w) return true;
  if (w.compositeFilter) return w.compositeFilter.filters.every((x) => match(x, f));
  const ff = w.fieldFilter, x = f[ff.field.fieldPath] ? val(f[ff.field.fieldPath]) : '';
  if (ff.op === 'EQUAL') return x === val(ff.value);
  if (ff.op === 'IN') return ff.value.arrayValue.values.map(val).includes(x);
  if (ff.op === 'GREATER_THAN_OR_EQUAL') return x >= val(ff.value);
  if (ff.op === 'LESS_THAN_OR_EQUAL') return x <= val(ff.value);
  return false;
}
async function mockCloud(ctx) {
  await ctx.route((u) => new URL(u).port === '8080', async (route) => {
    const req = route.request(), u = new URL(req.url()), m = req.method(), p = decodeURIComponent(u.pathname), body = req.postData() || '';
    const i = p.indexOf('/documents'); if (i < 0) return route.fallback(); const R = p.slice(i + 10).split('?')[0];
    const ok = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    let js = null; try { js = body ? JSON.parse(body) : null; } catch (e) { /* */ }
    if (R === ':runQuery') { const sq = js.structuredQuery, c = sq.from[0].collectionId; if (!DB[c]) return route.fallback();
      LOG.push({ m, R, c, sq });
      const rows = Object.keys(DB[c]).filter((id) => match(sq.where, DB[c][id])).slice(0, sq.limit || 1000).map((id) => ({ document: docOf(c + '/' + id, DB[c][id]), readTime: 'x' }));
      return ok(rows.length ? rows : [{ readTime: 'x' }]); }
    if (R === ':batchGet') { LOG.push({ m, R, docs: js.documents });
      return ok(js.documents.map((n) => { const id = n.split('/').pop(); return DB.deposits[id] ? { found: docOf('deposits/' + id, DB.deposits[id]) } : { missing: n }; })); }
    LOG.push({ m, R, body: js });
    return route.fallback();
  });
}
const shot = async (page, dir, name, sel) => { if (!dir) return; fs.mkdirSync(dir, { recursive: true }); await page.waitForTimeout(300);
  if (sel) { await page.evaluate((s) => { const e = document.querySelector(s); if (e) { e.scrollIntoView({ block: 'start' }); window.scrollBy(0, -150); } }, sel); await page.waitForTimeout(200); }
  await page.screenshot({ path: path.join(dir, name + '.png'), fullPage: false }); };
const waitFor = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 5000)) { if (await fn()) return true; await sleep(60); } return false; };
const closeD = async (page) => { if (await page.evaluate(() => { const d = document.getElementById('dlg'); return !!(d && d.open); })) { await page.evaluate(() => closeDlg()); await sleep(150); } };
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const toasts = (page) => page.evaluate(() => [...document.querySelectorAll('.toast')].map((x) => x.innerText).join('|'));
const txt = (s) => String(s || '').replace(/[‎‏]/g, '').replace(/ /g, ' ').replace(/\s*₪/g, '').replace(/(\d),(\d{3})/g, '$1$2').replace(/\s+/g, ' ').trim();
const state = (page) => page.evaluate(() => ({ rows: [...document.querySelectorAll('#main .cmg-list > .cmg-li')].map((e) => ({ id: e.dataset.id, t: e.innerText, dot: (e.querySelector('.cmg-dot') || {}).style ? e.querySelector('.cmg-dot').style.background : '' })),
  sums: [...document.querySelectorAll('#main .cmg-sums b')].map((b) => b.innerText), emp: [...document.querySelectorAll('#main .cmg-emp tbody tr')].map((r) => [...r.cells].map((c) => c.innerText)),
  tab: (document.querySelector('.cmg-tabs .a') || {}).innerText, note: (document.querySelector('#main .cmg-sel + p.note, #main .cmg-sel + .cmg-sel + p.note') || {}).innerText }));
const closingsQ = () => LOG.filter((l) => l.c === 'closings');

(async () => {
  const [www, shots] = process.argv.slice(2); const browser = await H.launch();
  const cfg = { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: ALL } }, admins: { '|m': 1 }, staff: { '|w1': 1 } };
  seed();
  const x = await H.newPage(browser, www, cfg, [], 'm-cm'); const pg = x.page; await pg.setViewportSize({ width: 412, height: 900 });
  await mockCloud(x.ctx); await H.login(pg, 'm@x.co'); if (await pg.$('[data-a=startBlank]')) { await pg.click('[data-a=startBlank]'); await sleep(300); }
  await sleep(1200); await closeD(pg);

  // ---- כניסה מהמסך "סגירת קופה והפקדות" ----
  await pg.evaluate(() => go('cash')); await sleep(300);
  check('1 במסך "סגירת קופה והפקדות" יש כניסה "קופה והפקדות"', await pg.evaluate(() => !!document.querySelector('#main [data-a=go][data-v=cm]')));
  LOG.length = 0; await pg.click('#main [data-a=go][data-v=cm]');
  await waitFor(() => pg.evaluate(() => document.querySelectorAll('#main .cmg-list > .cmg-li').length >= 3)); await sleep(400);
  let s = await state(pg);
  check('2 ברירת מחדל: לשונית "סגירות", השבוע (01/11–03/11), 3 סגירות מהחדשה לישנה', s.tab === 'סגירות' && /01\/11\/2026 – 03\/11\/2026/.test(txt(s.note)) && s.rows[0].id === 'z1' && s.rows.map((r) => r.id).sort().join() === 'z1,z2,z3', s);
  check('2א שורה: נקודה בצבע הפער, תאריך, קופה · עובד, פער עם כיוון; ממתין מסומן', /var\(--bad\)/.test(s.rows[0].dot) && /03\.11/.test(s.rows[0].t) && /יהודה הנשיא · dana/.test(s.rows[0].t) && /חוסר\s*45/.test(txt(s.rows[0].t))
    && (r3 => /עודף 10\.00/.test(txt(r3.t)) && /var\(--warn\)/.test(r3.dot))(s.rows.find((r) => r.id === 'z3')) && (r2 => /מאוזן/.test(r2.t) && /ממתין/.test(r2.t) && /var\(--inc\)/.test(r2.dot))(s.rows.find((r) => r.id === 'z2')), s.rows);
  check('2ב כרטיס סיכום: סך פערים −35 (חוסר 45, עודף 10), ממתין להפקדה 600, ממתין לאישור 1', txt(s.sums[0]) === '−35.00' && txt(s.sums[1]) === '600.00' && txt(s.sums[2]) === '1', s.sums);
  const q1 = closingsQ();
  check('2ג טעינה: שאילתת closings אחת לחודש 11 (עם select ובטווח החודש), בלי כתיבה לשרת', q1.length === 1 && JSON.stringify(q1[0].sq.where).includes('2026-11-01') && !!q1[0].sq.select
    && !LOG.some((l) => ['PATCH', 'DELETE'].includes(l.m) || (l.m === 'POST' && !/:runQuery|:batchGet/.test(l.R))), LOG.map((l) => l.m + ' ' + l.R + ' ' + (l.c || '')));
  check('2ד אין גלילה לרוחב ב-412', await noOverflow(pg));
  await shot(pg, shots, 'r4-א-מנהל');

  // ---- החודש: מהמטמון, בלי שאילתה נוספת ----
  await pg.selectOption('[data-c=cmgPer]', 'm'); await sleep(400); s = await state(pg);
  check('3 "החודש": אותן 3 סגירות, בלי שאילתה נוספת (מטמון ZS.D)', s.rows.length === 3 && closingsQ().length === 1, { n: s.rows.length, q: closingsQ().length });
  // ---- קופה ----
  await pg.selectOption('[data-c=cmgReg]', 'i_nl'); await sleep(300); s = await state(pg);
  check('4 בורר קופה "נחל לכיש": רק z2, סך פערים 0, ממתין להפקדה 600 (פתק של נחל לכיש)', s.rows.map((r) => r.id).join() === 'z2' && txt(s.sums[0]) === '0' && txt(s.sums[1]) === '600.00', s);
  await pg.selectOption('[data-c=cmgReg]', 'i_yh'); await sleep(300); s = await state(pg);
  check('4א "יהודה הנשיא": z1, z3; ממתין להפקדה 0; ממתין לאישור 0', s.rows.map((r) => r.id).join() === 'z1,z3' && txt(s.sums[0]) === '−35.00' && txt(s.sums[1]) === '0.00' && txt(s.sums[2]) === '0', s);
  await pg.selectOption('[data-c=cmgReg]', ''); await sleep(200);

  // ---- טווח: אוקטובר–נובמבר ----
  await pg.selectOption('[data-c=cmgPer]', 'r'); await sleep(300);
  check('5 "טווח תאריכים": שני שדות תאריך, ברירת מחדל מתחילת החודש', await pg.evaluate(() => document.querySelector('[data-c=cmgA]').value === '2026-11-01' && document.querySelector('[data-c=cmgB]').value === '2026-11-03'));
  await pg.fill('[data-c=cmgA]', '2026-10-01'); await pg.dispatchEvent('[data-c=cmgA]', 'change');
  await waitFor(() => pg.evaluate(() => document.querySelectorAll('#main .cmg-list > .cmg-li').length >= 6)); await sleep(300); s = await state(pg);
  check('5א טווח 01/10–03/11: 6 סגירות (כולל שנדחתה, מסומנת), חודש 10 נטען פעם אחת', s.rows.map((r) => r.id).slice(3).join() === 'z4,z5,z6' && /נדחה/.test(s.rows[4].t) && /לא ניתן לבדוק/.test(s.rows[5].t)
    && closingsQ().length === 2 && JSON.stringify(closingsQ()[1].sq.where).includes('2026-10-01'), { ids: s.rows.map((r) => r.id), q: closingsQ().length });
  check('5ב סך פערים בטווח −55 (שנדחתה לא נספרת); ממתין לאישור 1', txt(s.sums[0]) === '−55.00' && txt(s.sums[2]) === '1', s.sums);
  // ---- היסטוריה לפי עובד ----
  const E = s.emp.map((r) => r.map(txt));
  check('6 פערים לפי עובד: dana – 2 סגירות, 2 חוסרים 65, ממוצע −32.5 (בלי הסגירה שנדחתה)', E[0] && E[0][0] === 'dana' && E[0][1] === '2' && E[0][2] === '2 65.00' && E[0][3] === '0' && E[0][4] === '−32.50', E);
  check('6א moshe – 2 סגירות, עודף אחד 10, ממוצע +5; yossi – סגירה אחת, אין ממוצע (—)', E[1] && E[1][0] === 'moshe' && E[1][1] === '2' && E[1][2] === '0' && E[1][3] === '1 10.00' && E[1][4] === '+5.00'
    && E[2] && E[2][0] === 'yossi' && E[2][1] === '1' && E[2][4] === '—', E);
  check('6ב חישוב ישיר (CMG.emp) תואם: סכומים באגורות', await pg.evaluate(() => { const e = CMG.emp(CMG.rows().Z); return e[0].sa === 65 && e[0].avg === -32.5 && e[1].oa === 10 && e[1].avg === 5 && e[2].avg === null; }));
  check('6ג אין גלילה לרוחב (טבלה)', await noOverflow(pg));
  await shot(pg, shots, 'r4-א-עובדים', '#main .cmg-emp');
  // ---- מעבר לפירוט הקיים ----
  await pg.click('#main .cmg-li[data-id=z4]'); await sleep(400);
  const det = await pg.evaluate(() => ({ m: ZS.m, open: ZS.open, t: document.getElementById('main').innerText }));
  check('7 לחיצה על סגירה פותחת את הפירוט הקיים (zsRowH/zsDetH) – ZS.m = חודש הסגירה', det.open === 'z4' && det.m === '2026-10' && /סגור פירוט/.test(det.t) && /הוצאות מקופה ששויכו \(1\)/.test(det.t) && /משלוח/.test(det.t), { m: det.m, open: det.open });
  check('7א בפירוט: שורת "ספירת שטרות ומטבעות" ופירוט הספירה (200 ₪ × 12 · 10 ₪ × 2 · 50 אג׳ × 1)', /ספירת שטרות ומטבעות 2420\.50 מול הדוח 2430\.00 · חוסר 9\.50/.test(txt(det.t)) && /פירוט הספירה: 200 × 12 · 10 × 2 · 50 אג׳ × 1/.test(txt(det.t)), txt(det.t).slice(txt(det.t).indexOf('20/10'), txt(det.t).indexOf('20/10') + 700));
  await pg.click('#main [data-a=zsOpen][data-id=z4]'); await sleep(300);
  check('7ב לחיצה על "סגור פירוט" מחזירה לשורה המקוצרת', await pg.evaluate(() => !!document.querySelector('#main .cmg-li[data-id=z4]') && !ZS.open));

  // ---- הוצאות מקופה ----
  await pg.selectOption('[data-c=cmgPer]', 'w'); await sleep(200);
  await pg.click('.cmg-tabs [data-k=c]'); await waitFor(() => pg.evaluate(() => document.querySelectorAll('#main .cmg-list > .cmg-li').length >= 3)); await sleep(200);
  const C = await pg.evaluate(() => [...document.querySelectorAll('#main .cmg-list > .cmg-li')].map((e) => e.innerText));
  check('8 לשונית "הוצאות מקופה" (השבוע): 3 פתקים – סיבה, סכום, תאריך; הופקד / ממתין להפקדה', C.length === 3 && C.some((t) => /ספק ירקות/.test(t) && /500/.test(t) && !/הופקד|ממתין/.test(t))
    && C.some((t) => /הפקדה לבנק\n/.test(t + '\n') && /300/.test(t) && /הופקד/.test(t)) && C.some((t) => /נחל לכיש/.test(t) && /600/.test(t) && /ממתין להפקדה/.test(t)) && /03\.11/.test(C[0]), C);
  await pg.selectOption('[data-c=cmgPer]', 'r'); await sleep(400);
  check('8א בטווח: גם "משלוח" מ-19.10 (הוצאה של סגירה מאושרת מחודש 10)', await pg.evaluate(() => [...document.querySelectorAll('#main .cmg-list > .cmg-li')].some((e) => /משלוח/.test(e.innerText) && /19\.10/.test(e.innerText))));
  check('8ב אין שגיאות JS במסך המנהל', pg.__errors.length === 0, pg.__errors);

  // ---- טופס סגירה: ספירת שטרות ומטבעות (חובה) ----
  await pg.evaluate(() => { ZC = null; go('zc'); }); await sleep(400); await pg.evaluate(() => ACT.zcManual()); await sleep(300);
  check('9 בטופס: כותרת "ספירת שטרות ומטבעות (חובה)" ו-10 שדות (200 עד 10 אג׳)', await pg.evaluate(() => /ספירת שטרות ומטבעות \(חובה\)/.test(document.getElementById('main').innerText)
    && [...document.querySelectorAll('[data-i=zcCnt]')].map((e) => e.dataset.k).join() === '200,100,50,20,10,5,2,1,0.5,0.1'));
  const fill = async (k, v) => { await pg.fill(`[data-i=zcF][name=${k}]`, v); };
  for (const [k, v] of Object.entries({ no: '77', credit: '5820', cash: '2350', total: '8170', float: '1500', csales: '2350', cout: '1400', drawer: '2450', oTot: '2450' })) await fill(k, v);
  await pg.selectOption('[data-c=zcReg]', 'i_yh'); await sleep(200);
  const cnt = async (k, v) => { await pg.fill(`[data-i=zcCnt][data-k="${k}"]`, v); await sleep(80); };
  await cnt('200', '12'); await cnt('20', '2'); await cnt('5', '1'); await cnt('0.5', '1'); await cnt('0.1', '3'); await sleep(200);
  let ft = await pg.evaluate(() => ({ t: document.getElementById('zcCntT').innerText, chk: document.getElementById('zcChk').innerText }));
  check('9א סכום הספירה באגורות: 2,445.80; בשרשרת "5. ספירת השטרות והמטבעות" – חוסר 4.20, ושורת התוצאה "חוסר"', /2445\.80/.test(txt(ft.t)) && /5\. ספירת השטרות והמטבעות/.test(ft.chk) && /חוסר 4\.20/.test(txt(ft.chk)) && /סיבת הפער \(חובה\)/.test(ft.chk), { t: ft.t, chk: txt(ft.chk).slice(0, 300) });
  await shot(pg, shots, 'r4-א-ספירה', '#zcCnt');
  await cnt('100', '-1'); ft = await pg.evaluate(() => ({ t: document.getElementById('zcCntT').innerText, chk: document.getElementById('zcChk').innerText }));
  check('9ב כמות שלילית: הודעה "כמות לא תקינה (100 ₪)" גם בשרשרת', /כמות לא תקינה \(100 ₪\)/.test(ft.t) && /כמות לא תקינה בספירה/.test(ft.chk), ft.t);
  await pg.evaluate((png) => { ZC.z = [png, png, png]; ZC.o = png; }, PNG);
  await pg.evaluate(() => document.querySelector('form[data-f=zcSend]').requestSubmit()); await sleep(300);
  check('9ג שליחה עם כמות שלילית – נחסמת', /כמות לא תקינה בספירת השטרות/.test(await toasts(pg)), await toasts(pg));
  for (const k of ['200', '20', '5', '0.5', '0.1', '100']) await cnt(k, '');
  await pg.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  await pg.evaluate(() => document.querySelector('form[data-f=zcSend]').requestSubmit()); await sleep(300);
  check('9ד בלי ספירה – "ספור את השטרות והמטבעות בקופה (חובה)", ושום דבר לא נשלח', /ספור את השטרות והמטבעות בקופה \(חובה\)/.test(await toasts(pg)) && !LOG.some((l) => l.R === ':commit'), await toasts(pg));
  check('9ה בשרשרת: "עוד לא נספר – הספירה חובה"', await pg.evaluate(() => /עוד לא נספר – הספירה חובה/.test(document.getElementById('zcChk').innerText)));
  // ספירה תואמת ← נשלח, ו-data.cnt נשמר כמספרים שלמים. בלי הוצאת מזומן (אין פתקים בחלון): 1500 + 2350 = 3850 = 200×19 + 20×2 + 5×2 + 1×0
  await fill('cout', '0'); await fill('drawer', '3850'); await fill('oTot', '3850');
  await cnt('200', '19'); await cnt('20', '2'); await cnt('5', '2'); await cnt('1', '0');
  LOG.length = 0; let seen = ''; await pg.evaluate(() => document.querySelector('form[data-f=zcSend]').requestSubmit());
  await waitFor(async () => { seen = (await toasts(pg)) || seen; return LOG.some((l) => l.R === ':commit'); }, 6000); await sleep(400);
  const cm = LOG.find((l) => l.R === ':commit'); let data = null; if (!cm) console.log('debug', seen, JSON.stringify(LOG.map((l) => l.m + ' ' + l.R)).slice(0, 600));
  try { const w = cm.body.writes.find((w) => w.update && /closings\//.test(w.update.name)); data = JSON.parse(w.update.fields.data.stringValue); } catch (e) { /* */ }
  check('10 שליחה עם ספירה: data.cnt = {200:19, 20:2, 5:2, 1:0} (מספרים שלמים), בלי שדות חדשים במסמך', data && JSON.stringify(data.cnt) === JSON.stringify({ 1: 0, 5: 2, 20: 2, 200: 19 })
    && Object.keys(cm.body.writes.find((w) => w.update && /closings\//.test(w.update.name)).update.fields).sort().join() === 'by,d,data,no,np,od,otm,reg,st,t,tm,uid', data && data.cnt);
  check('10א אין שגיאות JS (טופס)', pg.__errors.length === 0, pg.__errors);
  await x.ctx.close();
  await browser.close();
  console.log(fail ? 'תוצאה: ' + fail + ' נכשלו' : 'כל הבדיקות עברו'); process.exit(fail ? 1 : 0);
})();
