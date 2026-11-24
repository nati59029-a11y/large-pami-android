'use strict';
// גיטי – סבב 4 חלק ב (24.11.2026): כרטיס "מגמות וחריגות" במרכז השליטה וטיוטת הזמנה מספק במרכז האישורים (sec-an.js). רשת מדומה, בלי שרת.
//  - מרכז שליטה: "מגמות וחריגות" עם "עודכן לאחרונה" ומקור, החריגה (קטגוריה, אחוז, ממוצע), הכנסות/הוצאות מול הקודם ואשתקד, החודש הנוכחי "חלקי";
//    "קטגוריות וספקים" פותח את הפירוט; "לשאול את גיטי" עובר לשיחה ושולח secChat. מראה ישנה (sups:null) – הערה במקום ספקים.
//  - מרכז אישורים: טיוטה לכל ספק עם כמויות לעריכה; "אישור" שולח secPrefs op:'od' עם הכמויות שנערכו (0 = בלי המוצר) → "אושר ✓";
//    "דחייה" שולח st:'no'. "אסור" (od:null) – אין טיוטות.
//  - רוחב 360px: בלי גלילה לרוחב, מטרות לחיצה 44px, בלי שגיאות JS. צילום אחד (אם ניתנה תיקייה).
// שימוש: node ui-sec-16.js <www-dir> [shots-dir]
const fs = require('fs');
const path = require('path');
const H = require('./harness');
let fail = 0;
const check = (name, ok, info) => { if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const BIZ = 'biz-o';
const FEAT = { scan: true, tasks: true, orders: true, suppliers: true, cashClose: true, secretary: true };
const TYPES = { invDue: 'חשבונית לתשלום' };
const c = (v, prev, py, dPrev, dPy) => ({ v, prev, py, dPrev, dPy });
function anOf(o) {
  return { ok: true, at: H.T0 - 3600e3, P: { anPct: 30, anMin: 200 }, cur: '2026-11', last: '2026-10', prev: '2026-09', py: '2025-10', has: true, hist: true, supOk: !o.old,
    inc: c(12100, 11000, 9000, 10, 34), exp: c(7000, 6200, 5000, 13, 40),
    cats: [Object.assign({ n: 'חומרי גלם' }, c(1600, 1000, 2000, 60, -20)), Object.assign({ n: 'חשמל' }, c(600, 520, 0, 15, null))],
    sups: o.old ? null : [Object.assign({ n: 'תנובה' }, c(1700, 1000, 1500, 70, 13))],
    part: { m: '2026-11', to: '2026-11-15', inc: 5000, exp: 3000 },
    anoms: [{ k: 'cat', n: 'חומרי גלם', m: '2026-10', v: 1600, avg: 1000, diff: 600, pct: 60 }], notes: [] };
}
const OD = [{ id: 'od0123456789ab_20261201', sup: 'תנובה', day: '2026-12-01', t: H.T0 - 600e3, amt: 95, amtPart: true,
  lines: [{ pid: 'p2', n: 'גבינה', qty: 11, m: 's', why: 'נמכרו 14 ב-28 ימים; במלאי 0 (מספיק לכ-0 ימים). הכמות – ל-21 ימים', cost: null },
    { pid: 'p1', n: 'חלב', qty: 19, m: 's', why: 'נמכרו 28 ב-28 ימים; במלאי 2 (מספיק לכ-2 ימים). הכמות – ל-21 ימים', cost: 5 }] },
{ id: 'od0123456789ac_20261201', sup: 'אנג\'ל', day: '2026-12-01', t: H.T0 - 500e3, amt: null, amtPart: false,
  lines: [{ pid: 'p3', n: 'לחם', qty: 6, m: 'h', why: 'לפי היסטוריית ההזמנות: 3 הזמנות, בממוצע כל 7 ימים; האחרונה לפני 8 ימים', cost: null }] }];

async function open(browser, www, o) {
  const who = 'm';
  const cfg = { mode: 'new', users: { [who]: BIZ }, sa: {}, biz: { [BIZ]: { dataRoot: 'b', features: FEAT, name: 'עסק בדיקה' } },
    admins: { [`b/${BIZ}/|${who}`]: 1 }, staff: { [`b/${BIZ}/|${who}`]: 1 }, ctx: { hasTouch: true, isMobile: true, viewport: { width: 360, height: 740 } } };
  const now = H.T0, bodies = [];
  const st = { ok: true, consented: true, setupDone: true, name: 'גיטי', addr: 'f', call: 'נתי', rows: [], mode: 'all', pay: true, emp: true, sens: false, we: 'warn', mirror: true, mirrorAt: now - 3600e3, cfTh: null, pct: 10, saving: '', nt: {}, types: TYPES, unseen: 0, learn: true, brLimited: false };
  const { ctx, page } = await H.newPage(browser, www, cfg, [], who);
  await ctx.route(/:5001\/.*/, async (route) => {
    const n = new URL(route.request().url()).pathname.split('/').pop();
    let body = {}; try { body = JSON.parse(route.request().postData() || '{}').data || {}; } catch (e) { /* */ }
    bodies.push([n, body]);
    const ok = (r) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: r }) });
    if (n === 'secState') return ok(st);
    if (n === 'secChatLoad') return ok({ ok: true, msgs: [] });
    if (n === 'secChat') return ok({ ok: true, id: 'a1', reply: 'בחודש האחרון ההוצאה על חומרי גלם חריגה.', mode: 'ok', src: [], pct: 11, saving: false });
    if (n === 'secNotes') return ok({ ok: true, notes: [], unseen: 0, types: TYPES });
    if (n === 'secReports' && body.op === 'an') return ok({ ok: true, an: anOf(o), at: now - 3600e3, src: 'מראה הכספים בענן', odLv: o.no ? 'no' : 'ask', od: o.no ? null : OD });
    if (n === 'secPrefs' && body.op === 'od') return ok({ ok: true, st: body.st, n: (body.lines || []).length });
    if (n === 'secLearn') return ok(body.op === 'eyes' ? { ok: true, since: now - 86400e3, now, today: '2026-11-03', open: [], did: [], hold: [] } : { ok: true, items: [] });
    if (n === 'secGoogle') return ok({ ok: true, configured: false });
    if (n === 'secWaCfg') return ok({ ok: true, connected: false });
    if (n === 'secComm') return ok({ ok: true, items: [] });
    return ok(n === 'getBackupKey' ? { key: Buffer.alloc(32, 7).toString('base64') } : {});
  });
  await ctx.route(/:runQuery$/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ readTime: '2026-11-03T09:00:00Z' }]) }));
  await H.login(page, who + '@x.co');
  await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden && ACT.startBlank) ACT.startBlank(); });
  await H.settle(page, 500);
  await page.evaluate(() => go('sec')); await H.settle(page, 1000);
  return { ctx, page, bodies };
}
const last = (bodies, n, f) => bodies.filter((b) => b[0] === n && (!f || f(b[1]))).pop();
const txt = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.innerText : ''; }, sel);
const tab = async (page, v) => { await page.evaluate((x) => { if (ACT.secSetX) ACT.secSetX(); const b = document.querySelector('#secTabs [data-v=' + x + ']'); if (b) b.click(); else ACT.secTab({ dataset: { v: x } }); }, v); await H.settle(page, 900); };
const small = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((e) => e.offsetParent).map((e) => Math.round(e.getBoundingClientRect().height)).filter((h) => h < 44), sel);
const noHs = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth <= 1);

(async () => {
  const [www, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const browser = await H.launch();
  {
    const { ctx, page, bodies } = await open(browser, www, {});
    await tab(page, 'eyes');
    const t = await txt(page, '#secAn');
    check('מרכז שליטה: כרטיס "מגמות וחריגות" עם "עודכן לאחרונה" ומקור', /מגמות וחריגות/.test(t) && /עודכן לאחרונה: .+ · מקור: מראה הכספים בענן/.test(t), t.slice(0, 300));
    check('החריגה: "חומרי גלם", +60%, ממוצע 3 חודשים 1,000 ₪, והספים', /"חומרי גלם"[\s\S]*1,600 ₪[\s\S]*ממוצע 3 החודשים הקודמים 1,000 ₪ · \+60%/.test(t) && /30% ומעלה מעל ממוצע 3 חודשים, ולפחות 200 ₪/.test(t), t);
    check('הכנסות / הוצאות 10/2026 מול 9/2026 ומול 10/2025, עם אחוזים', /10\/2026 מול 9\/2026 ומול 10\/2025/.test(t) && /הכנסות[\s\S]*12,100 ₪[\s\S]*\+10%[\s\S]*\+34%/.test(t) && /הוצאות[\s\S]*7,000 ₪/.test(t), t);
    check('החודש הנוכחי מסומן "חלקי"', /החודש עד היום \(חלקי, עד 15\.11\): הכנסות 5,000 ₪ · הוצאות 3,000 ₪/.test(t));
    await page.click('#secAn [data-a=anMore]'); await H.settle(page, 300);
    const t2 = await txt(page, '#secAn');
    check('"קטגוריות וספקים" פותח פירוט – קטגוריות וספקים, "אין נתון" כשאין בסיס', /הוצאות לפי קטגוריה[\s\S]*חשמל[\s\S]*אין נתון/.test(t2) && /ספקים[\s\S]*תנובה[\s\S]*1,700 ₪/.test(t2), t2.slice(-400));
    check('מטרות לחיצה בכרטיס – 44px, בלי גלילה לרוחב', (await small(page, '#secAn .chip')).length === 0 && await noHs(page), await small(page, '#secAn .chip'));
    if (shots) { await page.evaluate(() => { const e = document.getElementById('secAn'); window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - 60); }); await H.settle(page, 300); await page.screenshot({ path: path.join(shots, 'sec16-trends-360.png') }); } // צילום אחד, מסך טלפון 360×740
    await page.click('#secAn [data-a=anAsk]'); await H.settle(page, 1200);
    const ask = last(bodies, 'secChat');
    check('"לשאול את גיטי" – עובר לשיחה ושולח שאלה על המגמות', !!ask && /מגמות/.test(ask[1].text || ''), ask);
    // מרכז אישורים
    await tab(page, 'appr');
    const a = await txt(page, '#secOd');
    check('מרכז אישורים: "טיוטות הזמנה מספקים (2)" – תנובה ואנג\'ל, עם הסבר ושום דבר לא נשלח לספק', /טיוטות הזמנה מספקים \(2\)/.test(await page.evaluate(() => document.body.innerText)) && /תנובה/.test(a) && /אנג'ל/.test(a) && /שום דבר לא נשלח לספק/.test(a), a.slice(0, 300));
    check('לכל מוצר שדה כמות וסיבה; סכום משוער (חלקי)', await page.evaluate(() => document.querySelectorAll('#secOd input[data-c=odQ]').length) === 3 && /נמכרו 28 ב-28 ימים/.test(a) && /לפי היסטוריית ההזמנות/.test(a) && /סכום משוער לפי העלות במלאי: 95 ₪ \(לחלק מהמוצרים אין עלות\)/.test(a), a);
    await page.fill('#secOd input[data-p=p1]', '25'); await page.fill('#secOd input[data-p=p2]', '0');
    await page.click('#secOd [data-od="od0123456789ab_20261201"] [data-a=odOk]'); await H.settle(page, 700);
    const b1 = last(bodies, 'secPrefs', (b) => b.op === 'od' && b.st === 'ok');
    check('"אישור" שולח secPrefs op:od st:ok עם הכמויות שנערכו (0 = בלי המוצר)', b1 && b1[1].id === 'od0123456789ab_20261201' && JSON.stringify(b1[1].lines) === JSON.stringify([{ pid: 'p1', qty: 25 }]), b1);
    const a2 = await txt(page, '[data-od="od0123456789ab_20261201"]');
    check('אחרי האישור: "אושר ✓", נוסף ל"להזמין מספקים", בלי כפתורי אישור/דחייה', /אושר ✓/.test(a2) && /נוסף לרשימה "להזמין מספקים"/.test(a2) && !(await page.$('[data-od="od0123456789ab_20261201"] [data-a=odOk]')), a2);
    await page.click('#secOd [data-od="od0123456789ac_20261201"] [data-a=odNo]'); await H.settle(page, 600);
    const b2 = last(bodies, 'secPrefs', (b) => b.op === 'od' && b.st === 'no');
    check('"דחייה" שולח st:no ומסמן "נדחה"', b2 && b2[1].id === 'od0123456789ac_20261201' && /נדחה/.test(await txt(page, '[data-od="od0123456789ac_20261201"]')), b2);
    check('מרכז אישורים: מטרות לחיצה 44px, בלי גלילה לרוחב, בלי שגיאות JS', (await small(page, '#secOd .chip, #secOd input')).length === 0 && await noHs(page) && page.__errors.length === 0, { s: await small(page, '#secOd .chip, #secOd input'), e: page.__errors });
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, www, { no: true, old: true });
    await tab(page, 'eyes');
    await page.click('#secAn [data-a=anMore]'); await H.settle(page, 300);
    check('מראה ישנה בלי ספקים – הערה במקום השוואת ספקים', /השוואה לספקים תופיע אחרי עדכון האפליקציה/.test(await txt(page, '#secAn')));
    await tab(page, 'appr');
    check('"טיוטת הזמנה מספק: אסור" (od:null) – אין טיוטות במרכז האישורים', !(await page.$('#secOd')) && page.__errors.length === 0, page.__errors);
    await ctx.close();
  }
  await browser.close();
  console.log(fail ? `נכשלו ${fail}` : 'הכול עבר');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
