'use strict';
// 12.11.2026 (תמחור חשבונית, שלב 5א): "רק קרטונים סגורים" (cto) בטופס ההזמנה (orders-staff.js). לקוח סיטונאי: 1 = קרטון, תגית "קרטון (N מארזים)",
// "מחיר למארז", הסכום = קרטונים × ct × מחיר, ונשלח לשרת במארזים. לקוח רגיל – בלי שינוי. כרטיס הזמנה ועריכה בקרטונים. 360px.
// רשת מדומה. שימוש: node ui-ord-cto.js <www-dir> [out.json] [shots-dir]
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const out = {}; let fail = 0;
const check = (name, ok, info) => { out[name] = { ok: !!ok, info }; if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
const S = (v) => ({ stringValue: v }), N = (v) => (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }), M = (o) => ({ mapValue: { fields: o } }), A = (a) => ({ arrayValue: { values: a } }), B = (v) => ({ booleanValue: v });
const doc = (p, f) => ({ document: { name: 'projects/demo-largpeami/databases/(default)/documents/b/biz-o/' + p, fields: f } });
const ORD = [doc('ord/o2', { no: N(2), br: S('br1'), status: S('new'), total: N(70), at: N(Date.UTC(2026, 10, 12, 8)), custId: S('cW'), cust: M({ name: S('סיטונאי בע"מ'), phone: S('0501111111') }),
  items: A([M({ pid: S('pC'), n: S('חטיף'), qty: N(12), price: N(5), ct: N(6) }), M({ pid: S('pR'), n: S('לחם'), qty: N(1), price: N(10) })]) })];
const PROD = [doc('prod/pC', { name: S('חטיף'), price: N(6), on: B(true), ct: N(6), cto: B(true), q: M({ br1: N(30) }) }),
  doc('prod/pR', { name: S('לחם'), price: N(10), on: B(true), ct: N(6), q: M({ br1: N(5) }) })];

async function open(browser, www, calls) {
  const cfg = { mode: 'new', users: { m: 'biz-o' }, biz: { 'biz-o': { dataRoot: 'b', features: ALL, name: 'עסק בדיקה' } }, admins: { 'b/biz-o/|m': 1 }, staff: {} };
  const { ctx, page } = await H.newPage(browser, www, cfg, [], 'cto');
  await ctx.route(/:8080\/.*/, async (route) => {
    const req = route.request(); const u = new URL(req.url()); const body = req.postData() || '';
    if (/:runQuery$/.test(u.pathname)) { let c = ''; try { c = JSON.parse(body).structuredQuery.from[0].collectionId; } catch (e) { /* */ }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(c === 'ord' ? ORD : c === 'prod' ? PROD : [{ readTime: '2026-11-12T09:00:00Z' }]) }); }
    if (/\/ordcfg\/main$/.test(u.pathname)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ name: 'x', fields: {} }) });
    if (/\/ord\/o2\/log/.test(u.pathname)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ documents: [] }) });
    return route.fallback();
  });
  await ctx.route(/:5001\/.*/, async (route) => {
    const n = new URL(route.request().url()).pathname.split('/').pop(); let d = {}; try { d = JSON.parse(route.request().postData()).data; } catch (e) { /* */ }
    calls.push({ n, d });
    const R = { createOrder: { id: 'o2', no: 2, total: 82, warn: [] }, updateOrder: { ok: true, total: 100, warn: [] }, saveCust: { id: 'cW' }, getCosts: { cost: {} }, getBackupKey: { key: Buffer.alloc(32, 7).toString('base64') } };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: R[n] || { ok: true } }) });
  });
  await H.login(page, 'm@x.co');
  await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden && ACT.startBlank) ACT.startBlank(); });
  await page.setViewportSize({ width: 360, height: 740 });
  return { ctx, page };
}

(async () => {
  const [www, outFile, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const shot = async (page, n) => { if (shots) await page.screenshot({ path: path.join(shots, n + '.png'), fullPage: true }); };
  const browser = await H.launch();
  const ov = (page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  const calls = []; const { ctx, page } = await open(browser, www, calls);
  await page.evaluate(() => go('ox')); await H.settle(page, 1500);
  await page.evaluate(() => go('oxNew')); await H.settle(page, 800);
  const lines = () => page.evaluate(() => [...document.querySelectorAll('#oxlines .card')].map((c) => c.innerText.replace(/\s+/g, ' ')));
  const tot = () => page.evaluate(() => (document.getElementById('oxtot') || {}).textContent || '');
  // לקוח רגיל: בלי שינוי
  await page.evaluate(() => { const D = __ox.draft; Object.assign(D, { fn: 'דנה', ln: 'כהן', phone: '0502222222' }); ACT.oxAdd({ dataset: { id: 'pC' } }); ACT.oxAdd({ dataset: { id: 'pR' } }); });
  await H.settle(page, 500);
  const r0 = await lines(), t0 = await tot();
  check('1 לקוח רגיל: בלי תגית קרטון, "מחיר ליחידה", סכום 6 + 10 = 16', !r0.some((t) => /קרטון/.test(t)) && /מחיר ליחידה/.test(r0[0]) && /16\.00/.test(t0), { r0, t0 });
  // לקוח סיטונאי: 1 = קרטון
  await page.evaluate(() => { const D = __ox.draft; Object.assign(D, { custId: 'cW', wholesale: true, cName: 'סיטונאי בע"מ', cSt: 'found' }); window.__oxRedraw(); });
  await H.settle(page, 300);
  const r1 = await lines(), t1 = await tot();
  check('2 סיטונאי: בשורת המוצר cto – "קרטון (6 מארזים)" ו"מחיר למארז"; בשורה הרגילה לא; סכום 1×6×6 + 10 = 46', /קרטון \(6 מארזים\)/.test(r1[0]) && /מחיר למארז/.test(r1[0]) && !/קרטון/.test(r1[1]) && /46\.00/.test(t1), { r1, t1 });
  await page.fill('#oxlines input[data-k=qty][data-n="0"]', '2'); await H.settle(page, 300);
  const t2 = await tot();
  check('3 2 קרטונים: סכום 2×6×6 + 10 = 82', /82\.00/.test(t2), t2);
  await shot(page, '01-טופס-סיטונאי'); if (shots) await page.locator('#oxlines').screenshot({ path: path.join(shots, '01א-שורות.png') });
  const o1 = await ov(page);
  check('4 טופס ב-360px: בלי גלילה רוחבית', o1 <= 1, o1);
  await page.fill('#oxlines input[data-k=qty][data-n="0"]', '1.5'); await H.settle(page, 200);
  calls.length = 0; await page.evaluate(() => ACT.oxSave({ disabled: false })); await H.settle(page, 600);
  check('5 חצי קרטון – נעצר בטופס, לא נשלח לשרת', !calls.some((x) => x.n === 'createOrder'), calls.map((x) => x.n));
  await page.fill('#oxlines input[data-k=qty][data-n="0"]', '2'); await H.settle(page, 200);
  // מ-main (12.11.2026): לפני השמירה נפתח מסך "כרטיס אשראי (לא חובה)"; cdOk = כמו "סיום הזמנה" במסך הזה, כדי לבדוק את השליחה לשרת
  calls.length = 0; await page.evaluate(() => { __ox.draft.cdOk = true; return ACT.oxSave({ disabled: false }); }); await H.settle(page, 1500);
  const cr = calls.find((x) => x.n === 'createOrder');
  check('6 שמירה: נשלח במארזים – חטיף 12 × 6 (מחיר מארז), לחם 1', cr && cr.d.items[0].pid === 'pC' && cr.d.items[0].qty === 12 && cr.d.items[0].price === 6 && cr.d.items[1].qty === 1 && cr.d.custId === 'cW', cr && cr.d);
  // כרטיס הזמנה ועריכה
  await page.evaluate(() => go('oxOrd', 'o2')); await H.settle(page, 800);
  const card = await page.evaluate(() => document.getElementById('main').innerText.replace(/\s+/g, ' '));
  check('7 כרטיס הזמנה: "2 × קרטון (6 מארזים) · ₪5.00 למארז", סה"כ שורה 60', /2 × קרטון \(6 מארזים\)/.test(card) && /למארז/.test(card) && /60\.00/.test(card), card.slice(0, 400));
  await shot(page, '02-כרטיס-הזמנה');
  await page.evaluate(() => ACT.oxEdit({ dataset: { id: 'o2' } })); await H.settle(page, 400);
  const ed = await page.evaluate(() => ({ t: document.getElementById('dlg').innerText.replace(/\s+/g, ' '), q: document.querySelector('#dlg input[name=q0]').value }));
  check('8 עריכה: כמות בקרטונים (2) עם תגית', ed.q === '2' && /קרטון \(6 מארזים\)/.test(ed.t) && /מחיר למארז/.test(ed.t), ed);
  await shot(page, '03-עריכה');
  await page.fill('#dlg input[name=q0]', '3');
  calls.length = 0; await page.click('#dlg form[data-f=oxEdF] button:not([type=button])'); await H.settle(page, 1200);
  const up = calls.find((x) => x.n === 'updateOrder');
  check('9 עריכה ל-3 קרטונים → updateOrder עם 18 מארזים; הלחם נשאר 1', up && up.d.items[0].qty === 18 && up.d.items[1].qty === 1, up && up.d);
  // חזרה ללקוח רגיל – השורות חוזרות לרגילות
  await page.evaluate(() => { go('oxNew'); }); await H.settle(page, 500);
  await page.evaluate(() => { const D = __ox.draft; if (!D.items.length) { ACT.oxAdd({ dataset: { id: 'pC' } }); } Object.assign(D, { custId: 'cW', wholesale: true }); window.__oxRedraw(); D.wholesale = false; window.__oxRedraw(); });
  await H.settle(page, 300);
  const r3 = await lines();
  check('10 הלקוח כבר לא סיטונאי – בלי תגית קרטון', r3.length > 0 && !r3.some((t) => /קרטון/.test(t)), r3);
  // החלפת מצב סיטונאי אחרי שהוקלדו כמויות: הודעה + סימון, בלי שינוי כמות
  await page.evaluate(() => { const D = __ox.draft; D.items.length = 0; ACT.oxAdd({ dataset: { id: 'pC' } }); ACT.oxAdd({ dataset: { id: 'pR' } }); D.items[0].qty = '6'; D.items[1].qty = '3'; D.custId = 'cW'; D.wholesale = false; window.__oxRedraw(); document.getElementById('toast') && (document.getElementById('toast').textContent = ''); D.wholesale = true; window.__oxWsChg(D, false); });
  await H.settle(page, 300);
  const w1 = await page.evaluate(() => ({ q: __ox.draft.items.map((i) => i.qty), chk: __ox.draft.items.map((i) => !!i.chk), marks: document.querySelectorAll('#oxlines [data-oxchkn]').length, body: document.body.innerText.replace(/\s+/g, ' ') }));
  check('12 רגיל→סיטונאי: הודעה "נספרת עכשיו בקרטונים", רק שורת cto מסומנת, הכמויות לא השתנו', /נספרת עכשיו ב\s*קרטונים/.test(w1.body) && w1.chk[0] && !w1.chk[1] && w1.marks === 1 && w1.q[0] === '6' && w1.q[1] === '3', w1);
  await shot(page, '04-סימון-לבדיקה');
  await page.fill('#oxlines input[data-k=qty][data-n="0"]', '6'); await H.settle(page, 200);
  const w2 = await page.evaluate(() => ({ chk: !!__ox.draft.items[0].chk, marks: document.querySelectorAll('#oxlines [data-oxchkn]').length }));
  check('13 עריכת הכמות מנקה את הסימון', !w2.chk && w2.marks === 0, w2);
  await page.evaluate(() => { const D = __ox.draft; D.wholesale = false; window.__oxWsChg(D, true); }); await H.settle(page, 300);
  const w3 = await page.evaluate(() => ({ chk: __ox.draft.items.map((i) => !!i.chk), body: document.body.innerText.replace(/\s+/g, ' ') }));
  check('14 סיטונאי→רגיל: הודעה "נספרת עכשיו במארזים"', /נספרת עכשיו ב\s*מארזים/.test(w3.body) && w3.chk[0] && !w3.chk[1], w3);
  await page.evaluate(() => { const D = __ox.draft; D.items.forEach((i) => { delete i.chk; }); D.items[0].qty = '0'; D.wholesale = true; window.__oxWsChg(D, false); }); await H.settle(page, 300);
  const w4 = await page.evaluate(() => __ox.draft.items.map((i) => !!i.chk));
  check('15 כמות 0 בשורת cto – לא מסומנת', !w4[0], w4);
  // החלטה 9 (12.11): שורת מתנה ממבצע (gk) במוצר cto ללקוח סיטונאי = מארז אחד, לא קרטון. ההנחה המוצעת במסך – לפי מארזים, כמו בשרת
  await page.evaluate(() => { const D = __ox.draft; D.items.length = 0; Object.assign(D, { fn: 'דנה', ln: 'כהן', phone: '0502222222', custId: 'cW', wholesale: true }); ACT.oxAdd({ dataset: { id: 'pC' } }); D.items[0].price = '5';
    D.items.push({ pid: 'pC', qty: '1', price: '6', auto: 1, from: '', gk: 'k1' }); window.__oxRedraw(); });
  await H.settle(page, 300);
  const g1 = await lines(), gt = await tot();
  const gc = await page.evaluate(() => { const D = __ox.draft, ol = window.__ol; if (!ol || !ol.calcOf) return null;
    const keep = [ol.L.P, D.cell]; ol.L.P = [{ id: 'lpG', name: 'מבצע', monthly: 39, on: true, promos: [{ gifts: [{ pid: 'pC', price: 0 }] }] }];
    const S = ol.CS(D); Object.assign(S, { on: true, lines: [{ k: 'k1', plan: 'lpG', gift: 'pC' }] });
    const a = ol.calcOf(D); D.items.reverse(); const b = ol.calcOf(D); D.items.reverse();
    ol.L.P = keep[0]; D.cell = keep[1]; if (!keep[1]) delete D.cell; return a && b && { gift: [a.gift, b.gift], sug: [a.sug, b.sug] }; });
  check('16 מתנה (gk) ללקוח סיטונאי: בלי תגית קרטון בשורת המתנה, סכום 1×6×5 + 1×6 = 36; קרטון ב-5 ומתנה ב-6 → הנחה מוצעת 6 (המתנה חינם) בשני סדרי השורות, כמו בשרת', /קרטון \(6 מארזים\)/.test(g1[0]) && !/קרטון/.test(g1[1]) && /36\.00/.test(gt) && gc && gc.gift.join() === '6,6' && gc.sug.join() === '6,6', { g1, gt, gc });
  calls.length = 0; await page.evaluate(() => { __ox.draft.cdOk = true; return ACT.oxSave({ disabled: false }); }); await H.settle(page, 1500);
  const gs = calls.find((x) => x.n === 'createOrder');
  check('17 שמירה עם מתנה: קרטון נשלח כ-6 מארזים, המתנה כמארז 1', gs && gs.d.items.length === 2 && gs.d.items[0].qty === 6 && gs.d.items[1].qty === 1, gs && gs.d.items);
  check('11 בלי שגיאות JS', page.__errors.length === 0, page.__errors);
  await ctx.close(); await browser.close();
  if (outFile) fs.writeFileSync(outFile, JSON.stringify({ out }, null, 1));
  console.log(fail ? `תוצאה: נכשל (${fail})` : 'תוצאה: הכול עבר'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
