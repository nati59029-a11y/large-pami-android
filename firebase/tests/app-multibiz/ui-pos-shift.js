'use strict';
// קופה ש5 (17.11.2026): pos-shift.js בדפדפן, רשת מדומה (posAuth / posCash / posZ / posClock / posCfg מוחזרים מכאן). Devices.openDrawer מדומה.
//   כבוי: אין אריחים ואין קריאות. דלוק: מנהל – "משמרת ומזומן" ו"עובדים וקוד"; עובד בלי pos – כלום.
//   משמרת: פתיחה (posCash open, סכום באגורות, המגירה נפתחת), הוצאה בלי הערה – נחסמת במסך, הפקדה, אזהרת תקרה + אישור, דוח Z עם ספירה.
//   עובדים וקוד: רשימה, איפוס קוד, קביעת קוד. בלי גלישה ב-360px, בלי שגיאות JS. שימוש: node ui-pos-shift.js <www-dir> [out.json]
const fs = require('fs'); const H = require('./harness');
let fail = 0; const res = [];
const check = (n, ok, info) => { if (!ok) fail++; res.push({ n, ok: !!ok, info }); console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W0 = { incR: false, incW: true, expR: true, expW: true, sup: true, sal: false, rep: false, ord: true, trf: false, bal: false, ordP: false, prc: false, s3m: false, pos: false, posMgr: false };
const CASH = { open: 50000, in: 0, out: 0, drop: 0, sales: 70000, refunds: 0 };
const exp = () => CASH.open + CASH.in + CASH.sales - CASH.refunds - CASH.out - CASH.drop;
const CAP = 100000;

function answer(fn, b, st) {
  if (fn === 'posCfg') return { ok: true, cfg: { openCashDef: 50000, cashMax: CAP }, defs: {}, types: [], who: 'mgr' };
  if (fn === 'posClock') return b.op === 'status' ? { ok: true, open: st.clk } : b.op === 'in' ? (st.clk = { id: 'x_1', in: Date.now() }, { ok: true, id: 'x_1', in: Date.now() })
    : b.op === 'list' ? { ok: true, recs: [{ id: 'w_1', who: 'w', name: 'קופאית', in: Date.now() - 7200000, out: Date.now() - 3600000, min: 60 }], sum: { w: { min: 60, n: 1, open: false, long: 0 } } } : { ok: true };
  if (fn === 'posAuth') return b.op === 'list' ? { ok: true, staff: [{ uid: 'w', name: 'קופאית', role: 'cashier', hasPin: true, locked: true, wait: 12 }, { uid: 'm', name: 'מנהל', role: 'manager', hasPin: false }] } : { ok: true };
  if (fn === 'posCash') {
    const cash = Object.assign({}, CASH, { expected: exp() });
    const cap = { over: exp() > CAP, warn: exp() > CAP && st.ack < exp(), by: Math.max(0, exp() - CAP) };
    if (b.op === 'open') { st.shift = true; CASH.open = b.open; return { ok: true, shift: 'K1-S000001', no: 1, open: b.open }; }
    if (b.op === 'list') return { ok: true, shifts: st.shift ? [{ id: 'K1-S000001', st: 'open', openAt: Date.now() }] : [] };
    if (b.op === 'mv') { CASH[b.k] += b.a; return { ok: true, mv: b, cash: Object.assign({}, CASH, { expected: exp() }), cap }; }
    if (b.op === 'ack') { st.ack = exp(); return { ok: true, acked: exp() }; }
    return { ok: true, shift: 'K1-S000001', st: st.closed ? 'closed' : 'open', cash, cap, cashMax: CAP };
  }
  if (fn === 'posZ') { const rep = { z: 69000, n: 3, sales: 70000, rets: 1000, nRet: 1, voids: 0, pay: { cash: 70000 }, retBy: { cash: 1000 }, bad: 0, cash: Object.assign({}, CASH, { expected: exp() }) };
    if (b.op === 'close') { st.closed = true; return { ok: true, id: 'K1-Z000001', no: 1, rep: Object.assign({ id: 'K1-Z000001', counted: b.counted, diff: b.counted - exp() }, rep) }; }
    return { ok: true, rep }; }
  return { ok: true };
}
async function open(browser, www, cfg, email, perms) {
  const log = [];
  const { ctx, page } = await H.newPage(browser, www, cfg, log, email);
  const errs = []; page.on('pageerror', (e) => errs.push(String(e && e.message || e)));
  await page.setViewportSize({ width: 360, height: 760 });
  const calls = [], st = { shift: false, ack: 0, clk: null, closed: false };
  await ctx.route('**/pos*', (route) => { const u = new URL(route.request().url()); if (u.port === '5001') { let b = {}; try { b = JSON.parse(route.request().postData()).data || {}; } catch (e) { /* */ }
    const fn = u.pathname.split('/').pop(); calls.push({ fn, b });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: answer(fn, b, st) }) }); } return route.fallback(); });
  await ctx.route((u) => u.port === '8080' && /\/documents\/b\/biz-p\/posdev$/.test(u.pathname), (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  // POS:W2 (איחוד גל 2): אחרי המיזוג עם ש4 ההגדרות נקראות ב-PosCfg מהמסמך poscfg/main (לא מ-posCfg) – אותם ערכים כאן
  await ctx.route((u) => u.port === '8080' && /\/documents\/b\/biz-p\/poscfg\/main$/.test(u.pathname), (route) => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ name: 'projects/x/databases/(default)/documents/b/biz-p/poscfg/main', fields: { openCashDef: { integerValue: '50000' }, cashMax: { integerValue: String(CAP) } } }) }));
  const uid = email.split('@')[0];
  if (perms) await ctx.route((u) => u.port === '8080' && new RegExp('/staff/' + uid + '$').test(u.pathname), (route) => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ name: 'x', fields: { active: { booleanValue: true }, perms: { mapValue: { fields: Object.fromEntries(Object.entries(perms).map(([k, v]) => [k, { booleanValue: v }])) } } } }) }));
  await H.login(page, email);
  await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden && ACT.startBlank) ACT.startBlank(); });
  await H.settle(page, 600);
  return { ctx, page, log, errs, calls };
}
const tile = (page) => page.evaluate(() => (typeof window.posTile === 'function' ? window.posTile() : null));
const text = (page) => page.evaluate(() => document.getElementById('main').innerText.replace(/\s+/g, ' '));

(async () => {
  const [www, out] = process.argv.slice(2);
  const browser = await H.launch();
  const cB = (feat) => ({ mode: 'new', users: { m: 'biz-p', w: 'biz-p', wn: 'biz-p' }, biz: { 'biz-p': { dataRoot: 'b', features: feat, name: 'עסק קופה' } }, admins: { 'b/biz-p/|m': 1 }, staff: { 'b/biz-p/|w': 1, 'b/biz-p/|wn': 1 } });

  // ---- 1. כבוי ----
  let A = await open(browser, www, cB({ tasks: true }), 'm@x.co');
  let t = await tile(A.page);
  let v = await A.page.evaluate(() => [V.posShift().h, V.posStaff().h]);
  check('1 מתג כבוי: אין אריחים, המסכים "לא פעילה", אין קריאות', t === '' && v.every((h) => /לא פעילה/.test(h)) && !A.calls.length, { t, calls: A.calls.length });
  check('1א PosShift קיים כממשק', await A.page.evaluate(() => typeof PosShift === 'object' && typeof PosShift.approve === 'function' && typeof PosShift.z === 'function'));
  await A.ctx.close();

  // ---- 2. מנהל, מכשיר רשום ----
  A = await open(browser, www, cB({ tasks: true, pos: true }), 'm@x.co');
  t = await tile(A.page);
  check('2 מתג דלוק, מנהל: אריחים "משמרת ומזומן" ו"עובדים וקוד"', /data-v="posShift"/.test(t) && /data-v="posStaff"/.test(t), t);
  await A.page.evaluate(() => { localStorage.setItem('lp-pos-dev', JSON.stringify({ bizId: SY.bizId, dev: 'K1' })); localStorage.setItem('lp-pos-inst', 'i' + 'a'.repeat(20));
    window.__dr = 0; window.Devices = { openDrawer: async () => { window.__dr++; return { ok: true }; } }; });
  await A.page.evaluate(() => go('posShift')); await sleep(1500);
  let h = await text(A.page);
  check('2א משמרת סגורה: טופס פתיחה עם ברירת המחדל מההגדרות (500.00)', /פתיחת משמרת/.test(h) && (await A.page.inputValue('[data-f=pshOpen] [name=a]')) === '500.00', h.slice(0, 200));
  await A.page.fill('[data-f=pshOpen] [name=a]', '300.5');
  await A.page.click('[data-f=pshOpen] button'); await sleep(1500);
  let c = A.calls.filter((x) => x.fn === 'posCash' && x.b.op === 'open');
  check('2ב פתיחה: posCash open עם 30050 אגורות, קופה K1, והמגירה נפתחה', c.length === 1 && c[0].b.open === 30050 && c[0].b.dev === 'K1' && (await A.page.evaluate(() => window.__dr)) === 1, c);
  h = await text(A.page);
  check('2ג אחרי פתיחה: מזומן צפוי ואזהרת תקרה (מעל 1,000 ₪) עם כפתור אישור', /K1-S000001/.test(h) && /יותר מתקרת המזומן/.test(h) && /ראיתי/.test(h), h.slice(0, 300));
  await A.page.click('[data-a=pshAck]'); await sleep(1200);
  h = await text(A.page);
  check('2ד אחרי אישור: posCash ack, והאזהרה מסומנת כמאושרת', A.calls.some((x) => x.fn === 'posCash' && x.b.op === 'ack') && /האזהרה אושרה/.test(h), h.slice(0, 200));
  await A.page.selectOption('[data-f=pshMv] [name=k]', 'out');
  await A.page.fill('[data-f=pshMv] [name=a]', '12');
  await A.page.click('[data-f=pshMv] button'); await sleep(500);
  check('2ה הוצאה בלי הערה – נחסמת במסך, בלי קריאה', !A.calls.some((x) => x.fn === 'posCash' && x.b.op === 'mv'));
  await A.page.selectOption('[data-f=pshMv] [name=k]', 'drop');
  await A.page.fill('[data-f=pshMv] [name=a]', '400');
  await A.page.click('[data-f=pshMv] button'); await sleep(1500);
  c = A.calls.filter((x) => x.fn === 'posCash' && x.b.op === 'mv');
  check('2ו הפקדה: posCash mv drop 40000, המגירה נפתחה', c.length === 1 && c[0].b.k === 'drop' && c[0].b.a === 40000 && (await A.page.evaluate(() => window.__dr)) === 2, c);
  await A.page.click('[data-a=pshX]'); await sleep(1200);
  h = await text(A.page);
  check('2ז דוח X: Z = מכירות פחות החזרות', /Z – מכירות פחות החזרות ₪690.00/.test(h), h.slice(0, 400));
  await A.page.evaluate(() => { window.ask = async () => true; });
  await A.page.fill('[data-f=pshZ] [name=a]', '595.00');
  await A.page.click('[data-f=pshZ] button'); await sleep(1500);
  c = A.calls.filter((x) => x.fn === 'posZ' && x.b.op === 'close');
  const dlg = await A.page.evaluate(() => { const d = document.getElementById('dlg'); return d && d.open ? d.innerText.replace(/\s+/g, ' ') : ''; });
  check('2ח דוח Z: posZ close עם 59500 אגורות, חלון הדוח עם ההפרש', c.length === 1 && c[0].b.counted === 59500 && c[0].b.shift === 'K1-S000001' && /K1-Z000001/.test(dlg) && /הפרש/.test(dlg), { c, dlg: dlg.slice(0, 200) });
  check('2ט המשמרת נשכחה במכשיר אחרי Z', await A.page.evaluate(() => PosShift.shift() === ''));
  const o = await A.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, W: document.documentElement.clientWidth }));
  check('2י בלי גלישה ב-360px', o.sw <= o.W, o);

  // ---- עובדים וקוד ----
  await A.page.evaluate(() => { const d = document.getElementById('dlg'); if (d && d.open) d.close(); go('posStaff'); }); await sleep(1500);
  h = await text(A.page);
  check('2כ עובדים וקוד: רשימה עם מצב הקוד והנעילה, ודוח נוכחות', /קופאית/.test(h) && /נעול \(12 שניות\)/.test(h) && /אין קוד/.test(h) && /1:00 שעות/.test(h), h.slice(0, 400));
  await A.page.click('[data-a=pshReset][data-uid=w]'); await sleep(1000);
  check('2ל איפוס קוד – posAuth reset', A.calls.some((x) => x.fn === 'posAuth' && x.b.op === 'reset' && x.b.uid === 'w'));
  await A.page.fill('[data-f=pshPin] [name=pin]', '2580');
  await A.page.click('[data-f=pshPin] button'); await sleep(1000);
  check('2מ קביעת קוד – posAuth set (בלי old כשהשדה ריק)', A.calls.some((x) => x.fn === 'posAuth' && x.b.op === 'set' && x.b.pin === '2580' && !('old' in x.b)));
  check('2נ אין שגיאות JS', !A.errs.length, A.errs);
  await A.ctx.close();

  // ---- 3. עובד בלי pos / עם pos ----
  A = await open(browser, www, cB({ tasks: true, pos: true }), 'wn@x.co', W0);
  t = await tile(A.page);
  check('3 עובד בלי pos: אין אריחים', t === '', t);
  await A.ctx.close();
  A = await open(browser, www, cB({ tasks: true, pos: true }), 'w@x.co', Object.assign({}, W0, { pos: true }));
  await A.page.evaluate(() => go('posStaff')); await sleep(1200);
  h = await text(A.page);
  check('3א קופאי: רק "הקוד שלי", בלי רשימת עובדים ובלי קריאה ל-list', /הקוד שלי/.test(h) && !/עובדי הקופה/.test(h) && !A.calls.some((x) => x.b.op === 'list'), h.slice(0, 200));
  check('3ב אין שגיאות JS', !A.errs.length, A.errs);
  await A.ctx.close();

  await browser.close();
  if (out) fs.writeFileSync(out, JSON.stringify(res, null, 1));
  console.log(fail ? `נכשלו ${fail} מתוך ${res.length}` : `כל ${res.length} הבדיקות עברו`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
