'use strict';
// תמחור מחשבונית ספק, שלב 3 (12.11.2026): www/pricing.js – חשבונית ספק שנשמרת עם צילום נכנסת ל"חשבוניות לתמחור" (piCreate) ברקע.
// רשת מדומה (בלי אמולטור): scanDocument (invoice / invlines), piCreate ו-piVoid נענים כאן. מסך 360px.
// בודק: שמירה (גם לחיצה כפולה) = בקשה אחת; S.tx זהה למצב בלי pricing.js; עסק בלי מדף ובלי הזמנות – כלום; בלי רשת – ההוצאה נשמרת
// והבקשה נשלחת כשהרשת חוזרת (בלי זיהוי נוסף); תור הסריקה המרובה; עובד ששולח הוצאה → piCreate, מנהל שדוחה → piVoid.
// שימוש: node ui-pi-hook.js <www-dir> [out.json]
const fs = require('fs'); const H = require('./harness');
const BZ0 = ['larg', 'peami'].join('');
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
let fail = 0; const res = []; const check = (n, ok, info) => { if (!ok) fail++; res.push({ n, ok: !!ok, info }); console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 500) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LINES = { supplier: 'ספק בדיקה בע"מ', number: '5001', date: '2026-11-01', prices_include_vat: false, lines: [
  { name: 'כוסות קרטון', barcode: '7290000000011', sku: null, qty: 2, unit: 'ct', pack_qty: 50, carton_qty: 20, price: 100, discount: null, total: 200 },
  { name: 'מפיות', barcode: null, sku: 'A12', qty: 10, unit: 'pk', pack_qty: null, carton_qty: null, price: 3.5, discount: 10, total: 31.5 }] };

// רשת מדומה לכל הקשר: M.fail = { invlines|piCreate|piVoid: true } → ניתוק
async function mock(ctx) {
  const M = { inv: 0, lines: 0, create: [], vd: [], img: [], fail: {} };
  const J = (route, o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
  await ctx.route('**/scanDocument', async (route) => {
    let b = {}; try { b = JSON.parse(route.request().postData()).data || {}; } catch (e) { /* */ }
    if (b.kind === 'invlines') { if (M.fail.invlines) return route.abort('internetdisconnected'); M.lines++; return J(route, { result: { text: JSON.stringify(LINES) } }); }
    M.inv++; return J(route, { result: { text: JSON.stringify({ document_type: 'invoice', supplier: 'ספק בדיקה', number: String(5000 + M.inv), date: '2026-11-01', total_with_vat: 100 + M.inv }) } });
  });
  for (const fn of ['piCreate', 'piVoid', 'piImg']) await ctx.route('**/' + fn, async (route) => {
    if (M.fail[fn]) return route.abort('internetdisconnected');
    let b = {}; try { b = JSON.parse(route.request().postData()).data || {}; } catch (e) { /* */ }
    if (fn === 'piImg') { M.img.push(b); return J(route, { result: { ok: true, k: b.k, np: b.np } }); } // שלב 4: צילום לענן
    (fn === 'piCreate' ? M.create : M.vd).push(b); return J(route, { result: { ok: true, id: 'i' + b.reqId, dup: false } });
  });
  return M;
}
async function open(browser, www, cfg, email, noPi) {
  const { ctx, page } = await H.newPage(browser, www, cfg, [], email[0]); await page.setViewportSize({ width: 360, height: 740 });
  if (noPi) await ctx.route('**/pricing.js', (r) => r.fulfill({ status: 404, body: '' })); // המצב "לפני השינוי"
  const M = await mock(ctx);
  await H.login(page, email);
  await page.evaluate(() => { const sh = document.getElementById('sheet'); if (sh && !sh.hidden && typeof ACT.startBlank === 'function') ACT.startBlank(); if (window.PI) { PI.wait = 0; PI.dl = [0]; } });
  await H.settle(page, 400);
  return { ctx, page, M };
}
// סריקת חשבונית אחת (הזרימה הרגילה: scanGo → בדוק את החשבונית → "אישור ושמירה"), עם לחיצה כפולה
async function scanSave(page, label, before) {
  await page.evaluate(async (L) => {
    const c = S.cats.find((x) => x.beh === 'sup' && !x.hid && !x.off); if (!S.subs.some((s) => s.id === 's1')) { S.subs.push({ id: 's1', cat: c.id, name: 'ספק בדיקה' }); save(); }
    openAdd({ type: 'exp', cat: c.id, pre: false }); ACT.pick({ dataset: { k: 'cat', v: c.id } });
    const cv = document.createElement('canvas'); cv.width = 500; cv.height = 700; const x = cv.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 500, 700); x.fillStyle = '#000'; x.font = 'bold 48px sans-serif'; x.fillText(L, 30, 120);
    const u = cv.toDataURL('image/jpeg', 0.9); A.pg = [u]; A.hi = [u]; ACT.scanGo();
  }, label);
  await page.waitForSelector('#dlg form[data-f=scanok]', { timeout: 20000 });
  if (before) await before();
  await page.evaluate(() => { const b = document.querySelector('#dlg form[data-f=scanok] button.btn:not([type])'); b.click(); b.click(); });
  await H.settle(page, 600);
}
const txOf = (page) => page.evaluate(() => JSON.parse(JSON.stringify(S.tx)));
const waitQ = async (page, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 15000)) { if (await page.evaluate(() => !PI.busy && PI.q().length === 0)) return true; await sleep(200); } return false; };

(async () => {
  const [www, out] = process.argv.slice(2);
  const browser = await H.launch();
  const cfgL = { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: ALL } }, admins: { '|m': 1 }, staff: { '|w': 1 } };

  // ---- 1. לפני השינוי (בלי pricing.js) מול אחרי: אותה סריקה, אותה רשומה ----
  const base = await open(browser, www, cfgL, 'm@x.co', true);
  const n0b = (await txOf(base.page)).length; await scanSave(base.page, 'DOC A');
  const txB = await txOf(base.page); const errB = base.page.__errors.slice();
  check('1 בסיס (בלי pricing.js): ההוצאה נשמרה, אין PI, אין piCreate', txB.length === n0b + 1 && !(await base.page.evaluate(() => !!window.PI)) && base.M.create.length === 0 && base.M.lines === 0, { n: txB.length - n0b, errB });
  await base.ctx.close();

  const P = await open(browser, www, cfgL, 'm@x.co');
  const { page, M } = P;
  const n0 = (await txOf(page)).length; await scanSave(page, 'DOC A');
  const txA = await txOf(page);
  check('1א S.tx אחרי השמירה זהה בדיוק למצב בלי pricing.js (אותה רשומה, אותם שדות)', JSON.stringify(txA) === JSON.stringify(txB) && txA.length === n0 + 1, { a: txA.slice(-1), b: txB.slice(-1) });
  check('1ב אותן שגיאות דף כמו בבסיס (הלחיצה השנייה) – pricing.js לא מוסיף שגיאה', JSON.stringify(page.__errors) === JSON.stringify(errB), { now: page.__errors, base: errB });
  const q1 = await waitQ(page);
  const t1 = txA[txA.length - 1];
  const rq1 = await page.evaluate((f) => PI.rqOf(f), t1.file);
  check('2 שמירת חשבונית (גם בלחיצה כפולה) → זיהוי שורות אחד ו-piCreate אחד, עם מזהה בקשה לפי הקובץ', q1 && M.lines === 1 && M.create.length === 1 && M.create[0].reqId === rq1 && /^[A-Za-z0-9_-]{8,40}$/.test(rq1), { lines: M.lines, create: M.create.map((x) => x.reqId), rq1 });
  const c1 = M.create[0] || {};
  check('2א תוכן הבקשה: ספק/מספר/תאריך מההוצאה, 2 שורות לפי PricingLines (קרטונים → מארזים), בלי מחירים', c1.sup === 'ספק בדיקה' && c1.inv === t1.inv && c1.date === t1.date && c1.supId === 's1' && Array.isArray(c1.lines) && c1.lines.length === 2 && c1.lines[0].qty === 40 && c1.lines[0].cost === 5 && c1.lines[0].bc === '7290000000011' && !c1.lines.some((l) => 'price' in l || 'wp' in l || 'pid' in l), c1);
  const im1 = M.img.filter((x) => x.id === 'i' + rq1);
  check('2ג (שלב 4) אחרי piCreate הצילום עולה לענן (piImg): חלקים 0..np-1 לאותה חשבונית, תמונה מוקטנת, עד 700,000 תווים לחלק', im1.length >= 1 && im1.length === im1[0].np && im1.every((x, k) => x.k === k && typeof x.data === 'string' && x.data.length <= 700000) && /^data:image\/jpeg;base64,/.test(im1[0].data), im1.map((x) => ({ k: x.k, np: x.np, len: (x.data || '').length })));
  await page.evaluate((x) => { PI.add({ t: 'c', rq: x.rq, fid: x.f }); }, { rq: rq1, f: t1.file }); await sleep(800); await waitQ(page);
  check('2ב אותו קובץ שוב (ניסיון חוזר) – לא נשלח שוב ולא מזוהה שוב', M.create.length === 1 && M.lines === 1, { create: M.create.length, lines: M.lines });

  // ---- 3. בלי רשת: ההוצאה נשמרת כרגיל; הבקשה ממתינה ונשלחת כשהרשת חוזרת ----
  const n3 = (await txOf(page)).length;
  await scanSave(page, 'DOC OFF', () => P.ctx.setOffline(true));
  await sleep(1500);
  const s3 = await page.evaluate(() => ({ q: PI.q().map((j) => ({ t: j.t, r: !!j.r })), tx: S.tx.length, on: navigator.onLine }));
  check('3 בלי רשת: ההוצאה נשמרה, הבקשה בתור (לא נשלחה)', s3.tx === n3 + 1 && s3.q.length === 1 && M.create.length === 1 && s3.on === false, s3);
  await P.ctx.setOffline(false); const back = await waitQ(page, 15000);
  check('3א הרשת חזרה → נשלחה בקשה אחת (piCreate), התור ריק', back && M.create.length === 2 && M.lines === 2, { create: M.create.length, lines: M.lines });
  // כשל ב-piCreate אחרי זיהוי: הניסיון החוזר לא מזהה שוב (מכסה)
  M.fail.piCreate = true; await scanSave(page, 'DOC FAIL'); await sleep(1500);
  const s3b = await page.evaluate(() => PI.q().map((j) => ({ r: !!j.r, n: j.n })));
  check('3ב piCreate נכשל (ניתוק) – ההוצאה נשמרה, הבקשה נשארת בתור עם תוצאת הזיהוי', s3b.length === 1 && s3b[0].r && M.lines === 3, { s3b, lines: M.lines });
  M.fail.piCreate = false; await page.evaluate(() => PI.pump()); await waitQ(page);
  check('3ג ניסיון חוזר מצליח בלי זיהוי נוסף', M.create.length === 3 && M.lines === 3, { create: M.create.length, lines: M.lines });
  // שלב 4: כשל בהעלאת הצילום – החשבונית כבר נוצרה; הניסיון החוזר מעלה רק את הצילום (בלי piCreate ובלי זיהוי נוסף)
  M.fail.piImg = true; await scanSave(page, 'DOC IMG'); await sleep(1500);
  const s3c = await page.evaluate(() => PI.q().map((j) => ({ cr: !!j.cr, r: !!j.r })));
  check('3ד (שלב 4) piImg נכשל – piCreate כבר נשלח, הבקשה נשארת בתור עם סימון שנוצרה', s3c.length === 1 && s3c[0].cr && M.create.length === 4 && M.lines === 4, { s3c, create: M.create.length });
  const nImg = M.img.length; M.fail.piImg = false; await page.evaluate(() => PI.pump()); await waitQ(page);
  const rqI = M.create[3] && M.create[3].reqId;
  check('3ה (שלב 4) ניסיון חוזר – רק הצילום עולה (בלי piCreate נוסף ובלי זיהוי)', M.create.length === 4 && M.lines === 4 && M.img.length > nImg && M.img.slice(nImg).every((x) => x.id === 'i' + rqI), { create: M.create.length, img: M.img.slice(nImg).map((x) => x.id) });

  // ---- 4. תור הסריקה המרובה (bqSaveOne) ----
  const fq = await page.evaluate(async () => { const c = S.cats.find((x) => x.beh === 'sup' && !x.hid && !x.off); openAdd({ type: 'exp', cat: c.id, pre: false }); ACT.pick({ dataset: { k: 'cat', v: c.id } });
    const cv = document.createElement('canvas'); cv.width = 500; cv.height = 700; const x = cv.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 500, 700); x.fillStyle = '#000'; x.font = 'bold 48px sans-serif'; x.fillText('BQ 1', 30, 120);
    const u = cv.toDataURL('image/jpeg', 0.9); A.pg = [u]; A.hi = [u]; await ACT.scanQ(); return BQ[BQ.length - 1].fid; });
  for (let i = 0; i < 50 && (await page.evaluate((f) => (BQ.find((b) => b.fid === f) || {}).st, fq)) !== 'ok'; i++) await sleep(200);
  await page.evaluate(() => { ACT.bqAll(); ACT.bqAll(); }); await sleep(500); await waitQ(page);
  const rq4 = await page.evaluate((f) => PI.rqOf(f), fq);
  check('4 תור הסריקה המרובה: "אישור הכול" (פעמיים) → piCreate אחד לקובץ', M.create.filter((x) => x.reqId === rq4).length === 1 && await page.evaluate((f) => S.tx.some((t) => t.file === f), fq), { rq4, create: M.create.map((x) => x.reqId) });

  // ---- 5. עובד שולח הוצאה → piCreate; מנהל דוחה → piVoid ----
  const W = await open(browser, www, cfgL, 'w@x.co');
  const wid = 'w1abcdefgh';
  await W.page.evaluate(async (id) => {
    localStorage.setItem(LK('lp-cfg'), JSON.stringify({ cats: [{ id: 'e_sup', name: 'ספקים', beh: 'sup', subs: [{ id: 's1', name: 'ספק בדיקה' }] }, { id: 'e_x', name: 'שונות', beh: 'free', subs: [] }] }));
    const cv = document.createElement('canvas'); cv.width = 300; cv.height = 300; cv.getContext('2d').fillRect(0, 0, 10, 10); await fput('o' + id, cv.toDataURL('image/jpeg', 0.9));
    await fput('o' + id + 'x', cv.toDataURL('image/jpeg', 0.9));
    await pushItem({ id, created: new Date().toISOString(), data: { cat: 'e_sup', catName: 'ספקים', sub: 's1', subName: 'ספק בדיקה', amt: 100, date: '2026-11-01', note: '', inv: '777', dn: false }, fileId: 'o' + id });
    await pushItem({ id: id + 'x', created: new Date().toISOString(), data: { cat: 'e_x', catName: 'שונות', sub: '', subName: '', amt: 50, date: '2026-11-01', note: 'x', inv: '', dn: false }, fileId: 'o' + id + 'x' });
  }, wid);
  await sleep(500); await waitQ(W.page);
  check('5 עובד שלח חשבונית ספק → piCreate אחד (מזהה = הקובץ של העובד); הוצאה שאינה ספק – לא', W.M.create.length === 1 && W.M.create[0].reqId === 'piow1abcdefgh' && W.M.create[0].inv === '777' && W.M.create[0].sup === 'ספק בדיקה', W.M.create.map((x) => ({ rq: x.reqId, inv: x.inv })));
  await W.ctx.close();
  await page.evaluate((id) => { const c = S.cats.find((x) => x.beh === 'sup' && !x.hid && !x.off); S.inbox.push({ id, d: { cat: c.id, sub: 's1', amt: 100, date: '2026-11-01', inv: '777' } }); save(); inbDrop(id); }, wid);
  await sleep(500); await waitQ(page);
  check('5א מנהל דחה את ההוצאה → piVoid לאותה חשבונית', M.vd.length === 1 && M.vd[0].id === 'ipiow1abcdefgh', M.vd);
  await P.ctx.close();

  // ---- 6. עסק בלי מדף ובלי הזמנות: לא נוצר כלום ----
  const F = Object.assign({}, ALL, { shelf: false, orders: false });
  const cfgN = { mode: 'new', users: { m: 'biz-n' }, biz: { 'biz-n': { dataRoot: 'b', features: F, name: 'עסק בלי מדף' } }, admins: { 'b/biz-n/|m': 1 } };
  const N = await open(browser, www, cfgN, 'm@x.co');
  const nn = (await txOf(N.page)).length; await scanSave(N.page, 'DOC N'); await sleep(1500);
  const sN = await N.page.evaluate(() => ({ on: PI.on(), q: PI.q().length, tx: S.tx.length }));
  check('6 עסק בלי מדף ובלי הזמנות: ההוצאה נשמרה, אין זיהוי שורות ואין piCreate', sN.tx === nn + 1 && !sN.on && sN.q === 0 && N.M.lines === 0 && N.M.create.length === 0, { sN, lines: N.M.lines, create: N.M.create.length });
  check('7 אין שגיאות JavaScript בדף (חוץ מאלה שבבסיס)', N.page.__errors.every((e) => errB.includes(e)), N.page.__errors);
  await N.ctx.close();

  await browser.close();
  if (out) fs.writeFileSync(out, JSON.stringify({ fail, res }, null, 1));
  console.log(fail ? `נכשלו ${fail}` : 'הכול עבר');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
