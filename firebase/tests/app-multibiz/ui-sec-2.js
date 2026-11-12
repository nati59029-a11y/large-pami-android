'use strict';
// המזכירה העסקית – שלב 2 (2026-11-11): נתוני הכספים למזכירה (secFin) ומסך הצ'אט. רשת מדומה (בלי שרת אמיתי ובלי AI).
// חלק א – 20 מקרים: כל מספר ש-secFin שולח (לצ'אט ולמראה) זהה למה שמסכי האפליקציה מחשבים ומציגים – כולל זיכויים, סכומים שליליים,
//          משיכת בעלים, תשלום חלקי, רשומה שנמחקה, חשבונית באיחור, צ'ק עתידי, ספק הוצאות קבועות ושכר; ובלי לשנות את הבחירה במסך (סניף/תקופה).
// חלק ב – מסך הצ'אט ב-320 וב-360: בועות, מקורות עם "נכון ל-", "חשבי לעומק", אחוז ניצול, מצב חיסכון, סף תזרים, "לא רלוונטי",
//          נתוני המכשיר נשלחים עם השאלה; המראה נשלח אחרי שמירה; בלי גלילה לרוחב ובלי שגיאות JS.
// שימוש: node ui-sec-2.js <www-dir> [shots-dir]
const fs = require('fs');
const path = require('path');
const H = require('./harness');
let fail = 0;
const check = (name, ok, info) => { if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const BIZ = 'biz-o';
const FEAT = { scan: true, tasks: true, orders: true, suppliers: true, cashClose: true, secretary: true };

async function open(browser, www, o) {
  const who = 'm';
  const cfg = { mode: 'new', users: { [who]: BIZ }, sa: {}, biz: { [BIZ]: { dataRoot: 'b', features: FEAT, name: 'עסק בדיקה' } },
    admins: { [`b/${BIZ}/|${who}`]: 1 }, staff: { [`b/${BIZ}/|${who}`]: 1 }, ctx: { hasTouch: true, isMobile: true, viewport: { width: o.w || 360, height: o.h || 740 } } };
  const calls = []; const bodies = [];
  const st = Object.assign({ ok: true, consented: true, setupDone: true, name: 'רותי', addr: 'f', call: 'נתי', rows: [], mode: 'all', pay: true, emp: true, mirror: true, mirrorAt: null, cfTh: null, pct: 42, saving: '' }, o.state || {});
  const { ctx, page } = await H.newPage(browser, www, cfg, [], who);
  await ctx.route(/:5001\/.*/, async (route) => {
    const n = new URL(route.request().url()).pathname.split('/').pop(); calls.push(n);
    let body = {}; try { body = JSON.parse(route.request().postData() || '{}').data || {}; } catch (e) { /* */ }
    bodies.push([n, body]);
    const ok = (r) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: r }) });
    if (n === 'secState') return ok(st);
    if (n === 'secChatLoad') return ok({ ok: true, msgs: [] });
    if (n === 'secChat') return ok(o.reply ? o.reply(body) : { ok: true, reply: 'ההכנסות החודש 1,000.50 [1] ₪.', mode: 'ok', src: [{ k: 'getMonthSummary', l: 'סיכום חודש 2026-11 · נתוני המכשיר', at: H.T0, s: 'home' }, { k: 'getOpenInvoices', l: 'חשבוניות לתשלום · נתוני המכשיר', at: H.T0, s: 'due' }], ideas: [{ key: 'catUp:ספקים:2026-10', seen: 'הוצאות ספקים עלו' }], th: 3000, pct: 43, saving: false });
    if (n === 'secPrefs') return ok(Object.assign({ ok: true }, body));
    if (n === 'secMirrorPut') return ok({ ok: true, at: Date.now() });
    return ok(n === 'getBackupKey' ? { key: Buffer.alloc(32, 7).toString('base64') } : {});
  });
  await H.login(page, who + '@x.co');
  await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden && ACT.startBlank) ACT.startBlank(); });
  await H.settle(page, 800);
  return { ctx, page, calls, bodies, st };
}

(async () => {
  const [www, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const browser = await H.launch();

  // ---------- חלק א: 20 מקרים – secFin מול מסכי האפליקציה ----------
  {
    const { ctx, page } = await open(browser, www, { w: 360 });
    const R = await page.evaluate(async () => {
      const out = [];
      const ok = (n, c, info) => out.push([n, !!c, info]);
      const near = (a, b) => Math.abs((+a || 0) - (+b || 0)) < 0.006;
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const txt = () => document.getElementById('main').innerText;
      const m0 = NOWM(), m1 = addMon(m0, -1), py = addMon(m0, -12), td = today();
      const IC = catsOf('inc')[0].id;
      S.tx = []; S.loans = []; delete S.ownExp; BRSEL = [];
      S.subs = S.subs.filter((s) => !/^TS|^TF|^TE/.test(s.id));
      S.subs.push({ id: 'TS1', cat: 'e_sup', name: 'ספק בדיקה' }, { id: 'TF1', cat: 'e_fix', name: 'חשמל בדיקה' }, { id: 'TE1', cat: 'e_sal', name: 'עובד בדיקה' });
      let n = 0;
      const add = (o) => { const t = Object.assign({ id: 'q' + (++n), note: '', pays: [] }, o); S.tx.push(t); return t; };
      const supInv = (o) => add(Object.assign({ t: 'exp', cat: 'e_sup', sub: 'TS1', kind: 'inv', inv: 'I' + n, date: m0 + '-01', plan: m0 }, o));
      const F = () => secFin({ pay: true });
      const cat0 = (f, m, name) => { const c = (f.months[m] || { cats: [] }).cats.find((x) => x[0] === name); return c ? c[2] : 0; };
      const supName = 'ספק בדיקה';
      const supBal = (f, nm) => { const r = f.sups.find((x) => x[0] === nm); return r ? r[1] : 0; };
      const homeTwo = async () => { tab('home'); await wait(150); const e = document.querySelector('#hmain .two'); return e ? e.innerText : ''; };

      // 1
      add({ t: 'inc', cat: IC, amt: 1000.5, date: m0 + '-02' }); supInv({ amt: 400 }); save();
      let f = F();
      ok('1 הכנסה והוצאה פשוטות: סכום ידוע = monthIncome/monthExpense = מה שמוצג בבית', near(f.months[m0].inc, 1000.5) && near(f.months[m0].exp, 400) && near(f.months[m0].inc, monthIncome(m0)) && near(f.months[m0].exp, monthExpense(m0)) && (await homeTwo()).includes(ils(1000.5)) && (await homeTwo()).includes(ils(400)), f.months[m0]);
      // 2
      add({ t: 'exp', cat: 'e_sup', sub: 'TS1', kind: 'credit', amt: -150, date: m0 + '-01', plan: m0, inv: 'CR1' }); save(); f = F();
      ok('2 זיכוי ספק (סכום שלילי): ההוצאות 250, יתרת הספק 250 = bsum', near(f.months[m0].exp, 250) && near(f.months[m0].exp, monthExpense(m0)) && near(supBal(f, supName), 250) && near(supBal(f, supName), bsum('TS1')), { exp: f.months[m0].exp, sup: supBal(f, supName) });
      // 3
      add({ t: 'exp', cat: 'e_sup', sub: 'TS1', kind: 'credit', amt: -50, date: m0 + '-20', plan: m0, inv: 'CR2' }); save(); f = F();
      ok('3 זיכוי בתאריך עתידי: נספר בהוצאות החודש (200) אבל לא מוריד מהחוב לספק (250) – כמו בכרטיס הספק', near(f.months[m0].exp, 200) && near(supBal(f, supName), 250) && near(supBal(f, supName), bsum('TS1')), { exp: f.months[m0].exp, sup: supBal(f, supName) });
      // 4
      add({ t: 'inc', cat: IC, amt: -200.25, date: m0 + '-02' }); save(); f = F();
      ok('4 הכנסה שלילית (החזר ללקוח): 800.25 = monthIncome = הבית', near(f.months[m0].inc, 800.25) && near(f.months[m0].inc, monthIncome(m0)) && (await homeTwo()).includes(ils(800.25)), f.months[m0].inc);
      // 5
      add({ t: 'exp', cat: 'e_own', amt: 3000, date: m0 + '-02' }); save(); f = F();
      ok('5 משכורת בעלים כהוצאה (ברירת מחדל): בהוצאות (3200) ובמשיכות (3000)', near(f.months[m0].exp, 3200) && near(f.months[m0].own, 3000) && near(f.months[m0].exp, monthExpense(m0)), f.months[m0]);
      // 6
      S.ownExp = false; save(); f = F();
      ok('6 משכורת בעלים כמשיכה: לא בהוצאות (200), כן במשיכות (3000) = monthOwner', near(f.months[m0].exp, 200) && near(f.months[m0].own, 3000) && near(f.months[m0].own, monthOwner(m0)) && (await homeTwo()).includes(ils(200)), f.months[m0]);
      delete S.ownExp;
      // 7
      const p7 = supInv({ amt: 400, inv: 'P7' }); p7.pays.push({ id: 'pp7', d: td, a: 100, m: 'מזומן' }); save(); f = F();
      const o7 = f.open.find((r) => r[1] === 'P7');
      ok('7 תשלום חלקי: יתרה 300 = bal (חשבוניות לתשלום)', o7 && near(o7[5], 300) && near(o7[5], bal(p7)) && near(o7[4], 400), o7);
      // 8
      const p8 = supInv({ amt: 500, inv: 'P8' }); p8.pays.push({ id: 'pp8', d: td, a: 500, m: 'העברה' }); save(); f = F();
      ok('8 חשבונית ששולמה במלואה – לא ברשימת הפתוחות', !f.open.some((r) => r[1] === 'P8') && f.open.length === inv().filter((t) => bal(t) > 0.004).length, f.open.length);
      // 9
      add({ t: 'inc', cat: IC, amt: 999, date: m0 + '-02', x: 1 }); save(); f = F();
      ok('9 רשומה שנמחקה (x) – לא נספרת', near(f.months[m0].inc, 800.25), f.months[m0].inc);
      // 10
      add({ t: 'inc', cat: IC, amt: 2000, date: m1 + '-15' }); save(); f = F();
      ok('10 חודש קודם: 2000 = monthIncome(חודש קודם)', near(f.months[m1].inc, 2000) && near(f.months[m1].inc, monthIncome(m1)), f.months[m1]);
      // 11
      add({ t: 'exp', cat: 'e_misc', desc: 'שונות', amt: 700, date: py + '-10' }); save(); f = F();
      ok('11 אותו חודש אשתקד: 700 = monthExpense (להשוואה שנתית)', f.months[py] && near(f.months[py].exp, 700) && near(f.months[py].exp, monthExpense(py)), f.months[py]);
      // 12
      tab('exp'); await wait(200);
      const rows = [...document.querySelectorAll('#main button.li.exp[data-v=cat]')].map((b) => [b.querySelector('.m b').innerText, b.querySelector('.a').innerText]);
      const bad12 = f.months[m0].cats.filter((c) => c[1] === 'e').filter((c) => { const r = rows.find((x) => x[0] === c[0]); return !r || !r[1].includes(ils(c[2])); });
      ok('12 סך לכל קטגוריה = מה שמסך ההוצאות מציג (ספקים 1,100 – אחרי שני זיכויים)', rows.length > 0 && bad12.length === 0 && near(cat0(f, m0, 'ספקים'), 1100), { bad12, rows: rows.slice(0, 5) });
      // 13
      supInv({ amt: 600, inv: 'L13', date: m1 + '-05', plan: m1, due: m1 + '-20' }); save(); f = F();
      const hc = homeCards(m0);
      go('due'); await wait(200);
      const lateK = [...document.querySelectorAll('#main .kg .k')].find((e) => /באיחור/.test(e.innerText));
      ok('13 חשבונית באיחור (600) וזיכוי פתוח (150): המזכירה מקבלת בדיוק את המספר שמסך "חשבוניות לתשלום" מציג (450); לפני זיכויים = כרטיס הבית', near(f.late.sum, 450) && lateK && lateK.innerText.includes(ils(f.late.sum)) && near(f.late.gross, hc.lateSum) && f.late.n === hc.lateN && f.crs.some((c) => c[0] === supName && near(c[1], 150)), { late: f.late, k: lateK && lateK.innerText, crs: f.crs });
      tab('home');
      // 14
      const p14 = supInv({ amt: 900, inv: 'C14' }); const cd = addMon(m0, 0) + '-25'; p14.pays.push({ id: 'pp14', d: td, a: 900, m: 'צ׳ק', chk: { no: '1', bank: '', date: cd, img: '' } }); save(); f = F();
      const wkI = Math.floor((new Date(cd + 'T00:00:00') - new Date(td + 'T00:00:00')) / (7 * 864e5));
      const cf0 = cfDebits(m0, []);
      ok('14 צ\'ק עתידי: ברשימת הצ\'קים, ובשבוע הנכון בצפי; סך הצ\'קים בחודש = cfDebits (מסך התזרים)', f.chk.some((c) => c[0] === cd && near(c[2], 900)) && f.wk.out[wkI] >= 900 && near(f.cf[0][3], cf0.sumChk), { chk: f.chk, wk: f.wk.out, i: wkI });
      // 14א – צפי 13 שבועות: צ'ק שירד בתחילת החודש (לפני היום) לא נספר שוב; חשבונית פתוחה שמועדה עבר – כן, בשבוע הראשון
      const w0 = f.wk.out[0];
      const p14a = supInv({ amt: 300, inv: 'C14A' }); p14a.pays.push({ id: 'pp14a', d: m0 + '-01', a: 300, m: 'צ׳ק', chk: { no: '2', bank: '', date: m0 + '-01', img: '' } });
      save(); const f14a = F();
      ok('14א צ\'ק שתאריכו עבר (תחילת החודש) לא נספר בצפי – כבר ירד ונמצא ביתרה של היום', td > m0 + '-01' && near(f14a.wk.out[0], w0) && !f14a.chk.some((c) => c[0] === m0 + '-01'), { before: w0, after: f14a.wk.out[0] });
      f = f14a;
      // 15
      const ds = dueStats(m0);
      ok('15 "לתשלום החודש" ו"ירידה מהחשבון" = כרטיסי הבית', near(f.due.due, ds.due) && near(f.due.rem, ds.rem) && near(f.due.debit, homeCards(m0).debit), f.due);
      // 16
      BRSEL = ['zz']; const f16 = F();
      ok('16 בחירת סניף במסך לא משנה את המראה (כל העסק), והבחירה נשמרת', near(f16.months[m0].inc, f.months[m0].inc) && BRSEL.length === 1 && BRSEL[0] === 'zz', BRSEL);
      BRSEL = [];
      // 17
      const P0 = JSON.stringify(P); P.mode = 'month'; P.months = [m1]; const Pm = JSON.stringify(P); F();
      ok('17 התקופה שנבחרה במסך ההכנסות/ההוצאות לא משתנה', JSON.stringify(P) === Pm, P.months);
      P.months = JSON.parse(P0).months;
      // 18
      add({ t: 'exp', cat: 'e_sal', sub: 'TE1', amt: 5000, date: m1 + '-28', plan: m1, pays: [{ id: 's1', d: m1 + '-28', a: 5000, m: 'העברה' }] });
      add({ t: 'exp', cat: 'e_sal', sub: 'TE1', amt: 1200.5, date: m0 + '-01', plan: m1, pays: [{ id: 's2', d: m0 + '-01', a: 1200.5, m: 'העברה' }] }); save(); f = F();
      const wv = JSON.parse(wvWant()['sal_' + m1]);
      const pr = (f.pay[m1] || []).find((x) => x[0] === 'עובד בדיקה');
      ok('18 שכר לעובד לחודש (לפי חודש המשכורת) = סכום השורות במסך המשכורות (wv sal_)', pr && near(pr[1], 6200.5) && near(pr[1], wv.filter((x) => x.n === 'עובד בדיקה').reduce((s, x) => s + x.a, 0)), { pr, wv });
      // 19
      add({ t: 'exp', cat: 'e_fix', sub: 'TF1', kind: 'inv', amt: 350, date: m0 + '-01', plan: m0 }); save(); f = F();
      ok('19 ספק הוצאות קבועות: בחשבוניות הפתוחות וביתרות = bsum', f.open.some((r) => r[0] === 'חשמל בדיקה' && near(r[5], 350)) && near(supBal(f, 'חשמל בדיקה'), bsum('TF1')), f.sups);
      // 20
      const br0 = SY.br; SY.br = ['b1']; const f20 = secFin({ pay: true }); SY.br = br0;
      ok('20 מנהל עם הגבלת סניפים – לא שולח נתונים (חלקיים)', f20 === null, f20 && Object.keys(f20));
      // גודל וזמן
      const t0 = performance.now(); const big = F(); const ms = performance.now() - t0;
      ok('המבנה לפי החוזה עם השרת (v=1, 13 שבועות, עד 25 חודשים)', big.v === 1 && big.wk.out.length === 13 && Object.keys(big.months).length <= 25 && JSON.stringify(big).length < 400000, { ms: Math.round(ms) });
      return out;
    });
    for (const [n, c, info] of R) check(n, c, info);
    check('חלק א: 20 מקרים + צפי (14א) + בדיקת מבנה', R.length === 22, R.length);
    check('חלק א: בלי שגיאות JS', page.__errors.length === 0, page.__errors);
    await ctx.close();
  }

  // ---------- חלק ב: מסך הצ'אט ב-320 וב-360 ----------
  for (const [w, h] of [[320, 640], [360, 740]]) {
    const { ctx, page, calls, bodies } = await open(browser, www, { w, h });
    await page.evaluate(() => { S.tx.push({ id: 'z1', t: 'inc', cat: catsOf('inc')[0].id, amt: 1000.5, date: today(), note: '', pays: [] }); save(); NAV = [{ v: 'home' }]; go('sec'); });
    await H.settle(page, 600);
    const s0 = await page.evaluate(() => ({ txt: document.getElementById('main').innerText, fab: !!document.getElementById('secfab'), ta: !!document.querySelector('#secForm textarea') }));
    check(`${w}: מסך הצ'אט – פתיחה, שדה כתיבה, קיצורים, אחוז ניצול`, s0.ta && /שלום נתי/.test(s0.txt) && /42%/.test(s0.txt) && /מה קרה היום\?/.test(s0.txt) && /חשבי לעומק/.test(s0.txt), s0.txt.slice(0, 200));
    check(`${w}: "נכון ל-" בשורת המצב`, /נכונים ל-/.test(s0.txt));
    check(`${w}: בלי כפתור צף בתוך מסך הצ'אט (לא מסתיר את השליחה)`, !s0.fab);
    await page.fill('#secForm textarea', 'כמה הכנסות היו החודש?');
    await page.click('#secForm button[value=n]'); await H.settle(page, 600);
    const b1 = bodies.filter((b) => b[0] === 'secChat').pop();
    check(`${w}: השאלה נשלחת עם נתוני הכספים מהמכשיר (כולל שכר – המתג פעיל)`, b1 && b1[1].text === 'כמה הכנסות היו החודש?' && b1[1].deep === false && b1[1].fin && b1[1].fin.v === 1 && b1[1].fin.months && !!b1[1].fin.pay, b1 && Object.keys(b1[1]));
    const s1 = await page.evaluate(() => ({ sup: document.querySelectorAll('#secChat .secmsg.a sup').length, det: document.querySelector('#secChat details.secsrc summary') && document.querySelector('#secChat details.secsrc summary').innerText, pct: document.getElementById('secPct') && document.getElementById('secPct').innerText }));
    check(`${w}: התשובה – מספר עם סימון מקור, ו"מקורות (2)"`, s1.sup === 1 && /מקורות \(2\)/.test(s1.det || ''), s1);
    await page.click('#secChat details.secsrc summary'); await H.settle(page, 200);
    const src = await page.evaluate(() => document.querySelector('#secChat details.secsrc').innerText);
    check(`${w}: כל מקור – "לפי ..., נכון ל-..."`, /לפי סיכום חודש 2026-11 · נתוני המכשיר, נכון ל-/.test(src) && /לפי חשבוניות לתשלום/.test(src), src.slice(0, 200));
    check(`${w}: אחוז הניצול התעדכן`, /43%/.test(s1.pct || ''), s1.pct);
    if (shots) await page.screenshot({ path: path.join(shots, `sec-chat-${w}.png`), fullPage: true });
    // "חשבי לעומק"
    await page.fill('#secForm textarea', 'תחשבי לעומק על התזרים'); await page.click('#secForm button[value=d]'); await H.settle(page, 600);
    const b2 = bodies.filter((b) => b[0] === 'secChat').pop();
    check(`${w}: "חשבי לעומק" שולח deep=true`, b2 && b2[1].deep === true);
    // סף מוצע ו"לא רלוונטי"
    await page.click('#secChat [data-a=secTh]'); await H.settle(page, 400);
    const th = bodies.filter((b) => b[0] === 'secPrefs').pop();
    check(`${w}: אישור הסף המוצע נשלח לשרת`, th && th[1].op === 'threshold' && th[1].amount === 3000, th && th[1]);
    await page.click('#secChat [data-a=secNr]'); await H.settle(page, 400);
    const nr = bodies.filter((b) => b[0] === 'secPrefs').pop();
    check(`${w}: "לא רלוונטי" נשלח עם מפתח הרעיון, והכרטיס נעלם`, nr && nr[1].op === 'notRelevant' && nr[1].key === 'catUp:ספקים:2026-10' && !(await page.$('#secChat [data-a=secNr]')), nr && nr[1]);
    const sx = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`${w}: בלי גלילה לרוחב`, sx <= 0, sx);
    // כפתור השליחה גלוי וניתן ללחיצה (לא מוסתר ע"י הסרגל)
    const hit = await page.evaluate(() => { const b = document.querySelector('#secForm button[value=n]'); b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!e && (e === b || b.contains(e)); });
    check(`${w}: כפתור השליחה גלוי ולחיץ`, hit);
    // הגדרות: מתג המראה
    await page.click('[data-a=secSet]'); await H.settle(page, 300);
    await page.click('input[data-c=secMir]'); await H.settle(page, 400);
    const mi = bodies.filter((b) => b[0] === 'secPrefs').pop();
    check(`${w}: מתג המראה (כיבוי) נשלח לשרת`, mi && mi[1].op === 'mirror' && mi[1].on === false, mi && mi[1]);
    check(`${w}: בלי שגיאות JS`, page.__errors.length === 0, page.__errors);
    await ctx.close();
  }

  // ---------- המראה נשלח אחרי שמירה; מצב חיסכון מוצג ----------
  {
    const { ctx, page, bodies } = await open(browser, www, { w: 360, state: { saving: 'month', pct: 100 } });
    await page.evaluate(() => { S.tx.push({ id: 'z2', t: 'inc', cat: catsOf('inc')[0].id, amt: 77.7, date: today(), note: '', pays: [] }); save(); });
    await H.settle(page, 6500);
    const mp = bodies.filter((b) => b[0] === 'secMirrorPut');
    check('מראה: נשלח אחרי שמירה, עם נתוני חודש ושכר', mp.length >= 1 && mp[mp.length - 1][1].fin.v === 1 && near2(mp[mp.length - 1][1].fin.months[await page.evaluate(() => NOWM())].inc, 77.7) && !!mp[mp.length - 1][1].fin.pay, mp.length);
    const n1 = mp.length;
    await page.evaluate(() => save()); await H.settle(page, 6500);
    check('מראה: שמירה בלי שינוי ובתוך 3 דקות – לא נשלח שוב', bodies.filter((b) => b[0] === 'secMirrorPut').length === n1);
    await page.evaluate(() => { NAV = [{ v: 'home' }]; go('sec'); }); await H.settle(page, 400);
    check('מצב חיסכון: מוצג למנהל', /מצב חיסכון/.test(await page.evaluate(() => document.getElementById('main').innerText)));
    if (shots) await page.screenshot({ path: path.join(shots, 'sec-chat-saving-360.png') });
    await ctx.close();
  }
  await browser.close();
  console.log(fail ? `נכשלו ${fail}` : 'הכול עבר'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
function near2(a, b) { return Math.abs((+a || 0) - (+b || 0)) < 0.006; }
