'use strict';
// רכיבי שכר גמישים – מסך המנהל (שלב C, 19.11.2026): www/payroll-comp.js + payroll.js. רשת מדומה, בלי אמולטור.
// עורך רכיבים (הוספה/עריכה/השבתה/מחיקה, אימות, נשמר רק ב"שמירה"); מתג "העובד רואה" (רק עם uid); כלל בכתב חופשי עם payRuleAi מדומה
// (תקין – "הבנתי כך" ולא נשמר בלי אישור; תיקון; unparsed – 3 אפשרויות; פונקציה חסרה בשרת); שכר חודשי: 3 רכיבים מחושבים ממשימות ומכירות
// מדומות (כולל לפי שעות, ויום בלי שעות – "לפי יום"), צפוי לא ב"נשאר להעביר", מה אפשר לשפר; "אשר בונוסים" ← bon auto בלי כפילות, עריכה;
// אישור אוטומטי מה-3 בחודש (פעם אחת), לא לפני ה-3; עובד בלי comp – כמו היום; עובד לא רואה כלום; 412 בלי גלילה לרוחב; אין שגיאות JS.
// שימוש: node ui-payroll-comp.js <www-dir> [out.json] [shots-dir]
const fs = require('fs'); const path = require('path'); const H = require('./harness');
const BZ0 = ['larg', 'peami'].join('');
let fail = 0; const res = []; const check = (n, ok, info) => { if (!ok) fail++; res.push({ n, ok: !!ok }); console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined && !ok ? ' | ' + JSON.stringify(info).slice(0, 500) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const toasts = (page) => page.evaluate(() => [...document.querySelectorAll('.toast')].map((x) => x.innerText).join('|'));
const clearT = (page) => page.evaluate(() => document.querySelectorAll('.toast').forEach((x) => x.remove()));
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const dlgTxt = (page) => page.evaluate(() => { const d = document.getElementById('dlg'); return d && d.open ? d.innerText : ''; });
const pay = (page, id) => page.evaluate((i) => { const s = S.subs.find((x) => x.id === i); return s && s.pay ? JSON.parse(JSON.stringify(s.pay)) : null; }, id);
const until = async (page, fn, arg, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 6000)) { if (await page.evaluate(fn, arg).catch(() => false)) return true; await sleep(100); } return false; };

const MS = (y, m, d, h, mi) => Date.UTC(y, m - 1, d, h, mi || 0); // UTC
const iv = (v) => ({ integerValue: String(v) }); const sv = (v) => ({ stringValue: v }); const av = (a) => ({ arrayValue: { values: a.map(sv) } });
const TD = 'projects/demo-largpeami/databases/(default)/documents/b/acme/tasks/';
const task = (id, f) => ({ document: { name: TD + id, fields: Object.assign({ txt: sv('משימה ' + id), late: sv('') }, f), createTime: '2026-11-03T09:00:00Z', updateTime: '2026-11-03T09:00:00Z' }, readTime: '2026-11-03T09:00:00Z' });
// עכשיו (שעון הבדיקה) = 3.11.2026 09:00 UTC
const TASKS = [
  task('n1', { cr: iv(MS(2026, 11, 1, 8)), dl: iv(MS(2026, 11, 2, 8)), st: sv('done'), sub: iv(MS(2026, 11, 1, 10)), to: av(['dana']), ow: sv('dana') }), // בזמן
  task('n2', { cr: iv(MS(2026, 11, 1, 8)), dl: iv(MS(2026, 11, 1, 9)), st: sv('open'), sub: iv(0), to: av(['yossi']) }), // של עובד אחר – לא נספרת
  task('n3', { cr: iv(MS(2026, 11, 2, 8)), dl: iv(MS(2026, 11, 5, 8)), st: sv('open'), sub: iv(0), to: av(['dana', 'yossi']), txt: sv('סידור מדף') }), // ממתינה
  task('o1', { cr: iv(MS(2026, 10, 10, 8)), dl: iv(MS(2026, 10, 11, 8)), st: sv('done'), sub: iv(MS(2026, 10, 12, 8)), to: av(['dana']), ow: sv('dana'), txt: sv('ספירת מלאי') }), // בוצעה באיחור
];
// מכירות כספית (cxSales): 1.11 עם פילוח שעות, 2.11 בלי (יום ישן); 10.10 עם שעות
const DAYS = {
  '2026-10': [{ d: '2026-10-10', bk: '6200', gross: 4000, ret: 0, disc: 0, h: { '09': 1000, 12: 3000 } }],
  '2026-11': [{ d: '2026-11-01', bk: '6200', gross: 2000, ret: 0, disc: 0, h: { '08': 300, '09': 200, 10: 100, 11: 400, 15: 1000 } }, { d: '2026-11-02', bk: '6200', gross: 1500, ret: 0, disc: 0 }],
};
const COMP3 = [{ id: 'k1', k: 'tk', m: 'all', a: 200 }, { id: 'k2', k: 'sl', t: [{ min: 1000, a: 100 }, { min: 3000, a: 300 }], ss: 'hrs' }, { id: 'k3', k: 'pc', p: 10, th: 500, ss: 'day', amt: 1 }];

(async () => {
  const A = process.argv.slice(2), www = A[0], out = A.length > 2 ? A[1] : null, shots = A.length > 2 ? A[2] : A[1];
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const shot = async (pg, n) => { if (shots) { await pg.waitForTimeout(250); await pg.screenshot({ path: path.join(shots, n + '.png'), fullPage: true }); } };
  const browser = await H.launch();
  const AI = { mode: 'ok', calls: [] }; const net = { tasks: 0, sales: 0 };

  // ===== 1. מנהל, עסק במבנה החדש =====
  { const cfg = { mode: 'new', users: { ma: 'acme' }, biz: { acme: { dataRoot: 'b', features: {} } }, admins: { 'b/acme/|ma': 1 } };
    const x = await H.newPage(browser, www, cfg, [], 'm-comp'); const pg = x.page; await pg.setViewportSize({ width: 412, height: 900 });
    const SD = 'projects/demo-largpeami/databases/(default)/documents/b/acme/staff/';
    await x.ctx.route((u) => { const q = new URL(u); return q.port === '8080' && /\/documents\/b\/acme\/staff$/.test(decodeURIComponent(q.pathname)); },
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ documents: [{ name: SD + 'dana', fields: { name: sv('דנה'), email: sv('dana@x.co'), role: sv('staff'), active: { booleanValue: true } }, createTime: '2026-11-03T09:00:00Z', updateTime: '2026-11-03T09:00:00Z' }] }) }));
    await x.ctx.route((u) => { const q = new URL(u); return q.port === '8080' && /:runQuery$/.test(q.pathname); }, (route) => {
      let c = ''; try { c = JSON.parse(route.request().postData()).structuredQuery.from[0].collectionId; } catch (e) { /* */ }
      if (c === 'tasks') { net.tasks++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TASKS) }); }
      return route.fallback(); });
    await x.ctx.route(/:5001\/.*/, async (route) => {
      const n = new URL(route.request().url()).pathname.split('/').pop(); let d = {}; try { d = JSON.parse(route.request().postData()).data; } catch (e) { /* */ }
      if (n === 'cxSales') { net.sales++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { days: DAYS[String(d.from).slice(0, 7)] || [], items: {} } }) }); }
      if (n === 'payRuleAi') { AI.calls.push(d);
        if (AI.mode === 'missing') return route.fulfill({ status: 404, contentType: 'text/html', body: 'Not Found' });
        if (AI.mode === 'unparsed') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { ok: false, unparsed: true, explain: 'הטקסט לא נראה כמו כלל שכר', unsure: '', dropped: 0, errs: [], use: { n: 2, max: 50 } } }) });
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { ok: true, comp: [{ id: 'ai_x1', k: 'pc', n: 'אחוז מהמכירות', on: true, p: 2, ss: 'day', src: d.text, ai: 1 }], base: { rate: 42 }, explain: '<b>2% מכל המכירות</b>, ותעריף 42 לשעה', unsure: '', dropped: 1, errs: ['אחוז לא תקין'], use: { n: 1, max: 50 } } }) }); }
      return route.fallback(); });
    await H.login(pg, 'ma@x.co'); if (await pg.$('[data-a=startBlank]')) { await pg.click('[data-a=startBlank]'); await sleep(300); }
    await sleep(800); await pg.evaluate(() => { const d = document.getElementById('dlg'); if (d && d.open) closeDlg(); });
    await pg.evaluate(() => { const emp = S.cats.find((c) => c.kind === 'exp' && !c.hid && c.beh === 'emp');
      S.subs.push({ id: 'pcA', cat: emp.id, name: 'דנה בדיקה', pay: { mode: 'hr', rate: 40, m: 'מזומן', slip: false, uid: 'dana', from: '2026-09', rules: [], add: [] } });
      S.subs.push({ id: 'pcB', cat: emp.id, name: 'בלי רכיבים', pay: { mode: 'hr', rate: 50, m: 'מזומן', slip: false, uid: '', rules: [], add: [] } });
      S.wh.push({ id: 'w1', sub: 'pcA', d: '2026-11-01', in: '08:00', out: '12:00', brk: 0, src: 'man' }, { id: 'w2', sub: 'pcA', d: '2026-11-02', in: '10:00', out: '14:00', brk: 0, src: 'man' },
        { id: 'w3', sub: 'pcA', d: '2026-10-10', in: '09:00', out: '13:00', brk: 0, src: 'man' }, { id: 'w4', sub: 'pcB', d: '2026-11-01', in: '08:00', out: '12:00', brk: 0, src: 'man' });
      save(); });
    const bSnap = await pg.evaluate(() => { const r = PayCore.monthSum(S.subs.find((s) => s.id === 'pcB'), '2026-11', { wh: S.wh, bon: S.bon, psl: S.psl, tx: [] }); return JSON.stringify(r); });

    // --- עורך רכיבים ---
    await pg.evaluate(() => go('card', 'pcA')); await sleep(250); await pg.click('#main [data-a=payOpen]'); await sleep(400);
    check('1 בהגדרות שכר: "רכיבי שכר נוספים" מתחת לבסיס, כלל חופשי (500 תווים, "בלי שמות"), מתג תצוגה זמין (יש uid)', await pg.evaluate(() => { const t = document.getElementById('main').innerText, ta = document.querySelector('textarea[name=aiT]'), sw = document.querySelector('input[name=show]');
      return t.indexOf('תוספות קבועות') < t.indexOf('רכיבי שכר נוספים') && /אין רכיבים נוספים/.test(t) && ta && ta.maxLength === 500 && /בלי שמות של עובדים/.test(t) && sw && !sw.disabled && !sw.checked; }));
    const edSave = () => pg.click('#dlg form[data-f=payCompF] button[type=submit]');
    await pg.click('#main [data-a=payCompEd]'); await sleep(200);
    await clearT(pg); await edSave(); await sleep(200);
    check('2 רכיב משימות בלי סכום – נדחה, החלון נשאר', /מספר חיובי/.test(await toasts(pg)) && /רכיב שכר חדש/.test(await dlgTxt(pg)), await toasts(pg));
    await pg.fill('#dlg input[name=a]', '150'); await edSave(); await sleep(200);
    // מדרגות מכירות לפי שעות
    await pg.click('#main [data-a=payCompEd]:not([data-i])'); await sleep(200); await pg.click('#dlg [data-a=payCompK][data-v=sl]'); await sleep(150);
    await pg.fill('#dlg input[name=t0x]', '1000'); await pg.fill('#dlg input[name=t0a]', '100'); await pg.click('#dlg [data-a=payCompTA]'); await sleep(150);
    check('3 מדרגה נוספה, מה שהוקלד נשאר', await pg.evaluate(() => document.querySelector('#dlg input[name=t0x]').value === '1000' && !!document.querySelector('#dlg input[name=t1x]')));
    await pg.fill('#dlg input[name=t1x]', '3000'); await pg.fill('#dlg input[name=t1a]', '300'); await pg.selectOption('#dlg select[name=ss]', 'hrs'); await edSave(); await sleep(200);
    // אחוז מעל סף, עם סכומים לעובד
    await pg.click('#main [data-a=payCompEd]:not([data-i])'); await sleep(200); await pg.click('#dlg [data-a=payCompK][data-v=pc]'); await sleep(150);
    await pg.fill('#dlg input[name=p]', '120'); await clearT(pg); await edSave(); await sleep(200);
    check('4 אחוז 120 – נדחה (validComp)', /אחוז לא תקין/.test(await toasts(pg)), await toasts(pg));
    await pg.fill('#dlg input[name=p]', '10'); await pg.fill('#dlg input[name=th]', '500'); await pg.check('#dlg input[name=amt]'); await edSave(); await sleep(250);
    const list = await pg.evaluate(() => [...document.querySelectorAll('#main [data-comp]')].map((c) => c.innerText.replace(/\s+/g, ' ')));
    check('5 שלושה רכיבים ברשימה, עם תיאור במילים (מקור מכירות, מה העובד רואה)', list.length === 3 && /כל המשימות של החודש בזמן ← ₪150/.test(list[0]) && /מ-₪1,000 ← ₪100 · מ-₪3,000 ← ₪300/.test(list[1]) && /בשעות שעבד/.test(list[1]) && /אחוז מהיעד/.test(list[1]) && /10% מהמכירות שמעל ₪500/.test(list[2]) && /רואה סכומים/.test(list[2]), list);
    check('5א עוד לא נשמר (רק טיוטה עד "שמירה")', (await pay(pg, 'pcA')).comp === undefined);
    await pg.click('#main [data-a=payCompOn][data-i="0"]'); await sleep(150);
    check('6 השבתה: תגית "מושבת" וכפתור "הפעלה"', await pg.evaluate(() => /מושבת/.test(document.querySelector('[data-comp="0"]').innerText) && document.querySelector('[data-a=payCompOn][data-i="0"]').innerText === 'הפעלה'));
    await pg.click('#main [data-a=payCompOn][data-i="0"]'); await sleep(150);
    await pg.click('#main [data-a=payCompEd][data-i="0"]'); await sleep(200);
    check('7 עריכה נפתחת עם הערכים', await pg.evaluate(() => document.querySelector('#dlg input[name=a]').value === '150'));
    await pg.fill('#dlg input[name=a]', '200'); await edSave(); await sleep(200);
    await pg.click('#main [data-a=payCompEd]:not([data-i])'); await sleep(200); await pg.click('#dlg [data-a=payCompK][data-v=man]'); await sleep(150); await pg.fill('#dlg input[name=n]', 'בונוס חג'); await edSave(); await sleep(200);
    await pg.click('#main [data-a=payCompDel][data-i="3"]'); await sleep(150); await pg.click('#dlg [data-a=yes]'); await sleep(200);
    check('8 מחיקה (עם אישור) – נשארו 3', await pg.evaluate(() => document.querySelectorAll('#main [data-comp]').length === 3));
    check('8א אין גלילה לרוחב ב-412 (עורך)', await noOverflow(pg));
    await shot(pg, 'comp-1-עורך');
    await clearT(pg); await pg.click('#main form[data-f=payCfgF] button[type=submit]'); await sleep(300);
    let p = await pay(pg, 'pcA');
    const strip = (L) => (L || []).map(({ id, n, on, ...c }) => c);
    check('9 נשמר pay.comp (3 רכיבים מנורמלים, amt:1 נשמר), ab = החודש הקודם, בלי show; שאר pay לא השתנה',
      p && JSON.stringify(strip(p.comp)) === JSON.stringify([{ k: 'tk', m: 'all', a: 200 }, { k: 'sl', t: [{ min: 1000, a: 100 }, { min: 3000, a: 300 }], ss: 'hrs' }, { k: 'pc', p: 10, th: 500, ss: 'day', amt: 1 }]) && p.comp.every((c) => c.on === true && typeof c.id === 'string')
      && p.ab === '2026-10' && !('show' in p) && p.rate === 40 && p.uid === 'dana' && p.from === '2026-09', p);
    check('9א בכרטיס: "3 רכיבי שכר"', /3 רכיבי שכר/.test(await pg.evaluate(() => document.querySelector('#main [data-a=payOpen]').innerText)));
    // השתמש ב-id קבועים לבדיקות החישוב
    await pg.evaluate((C) => { const s = S.subs.find((x) => x.id === 'pcA'); s.pay.comp = C; save(); }, COMP3);

    // --- מתג "העובד רואה" ---
    await pg.click('#main [data-a=payOpen]'); await sleep(300); await pg.check('input[name=show]'); await pg.click('#main form[data-f=payCfgF] button[type=submit]'); await sleep(300);
    check('10 מתג "העובד רואה" נשמר (pay.show=true)', (await pay(pg, 'pcA')).show === true);
    await pg.evaluate(() => go('card', 'pcB')); await sleep(200); await pg.click('#main [data-a=payOpen]'); await sleep(300);
    check('10א עובד בלי קישור למשתמש: המתג חסום עם הסבר', await pg.evaluate(() => document.querySelector('input[name=show]').disabled && /רק אחרי קישור/.test(document.getElementById('main').innerText)));
    const byp = await pg.evaluate(() => { PayUI.PD.p.show = true; return PayComp.buildX(PayUI.PD.p, { uid: '' }); });
    await clearT(pg); await pg.click('#main form[data-f=payCfgF] button[type=submit]'); await sleep(250);
    check('10ב גם בעקיפה – בלי uid: show נדחה באימות, ובשמירה לא נשמר', /קשרו/.test(byp) && !('show' in (await pay(pg, 'pcB'))), byp);
    await pg.evaluate(() => { PayUI.PD.sub = ''; PayUI.PD.p = null; goBack(); }); await sleep(200);

    // --- כלל בכתב חופשי ---
    await pg.evaluate(() => go('card', 'pcA')); await sleep(200); await pg.click('#main [data-a=payOpen]'); await sleep(300);
    const before = JSON.stringify(await pay(pg, 'pcA'));
    await pg.fill('textarea[name=aiT]', '2% מכל המכירות'); await pg.click('#main [data-a=payAi]'); await sleep(200);
    await until(pg, () => /הבנתי כך/.test(document.getElementById('dlg').open ? document.getElementById('dlg').innerText : ''));
    await until(pg, () => !!document.querySelector('#dlg [data-aiex=ok]'), null, 5000);
    let dt = await dlgTxt(pg);
    check('11 payRuleAi תקין: "הבנתי כך:" עם ההסבר (כטקסט, בלי HTML), תיאור הרכיב, שינוי בסיס, מה נזרק ודוגמת חישוב לחודש הנוכחי',
      /הבנתי כך/.test(dt) && dt.includes('<b>2% מכל המכירות</b>') && /2% מהמכירות/.test(dt) && /תעריף לשעה: ₪42/.test(dt) && /1 חלקים לא הובנו/.test(dt) && /דוגמה/.test(dt) && /אחוז מהמכירות[\s\S]*70\.00/.test(dt), dt);
    check('11א נשלח רק הכלל והבסיס המספרי (בלי שם עובד)', AI.calls.length === 1 && JSON.stringify(AI.calls[0]) === JSON.stringify({ text: '2% מכל המכירות', base: { mode: 'hr', rate: 40 } }), AI.calls);
    check('11ב לפני אישור – לא נשמר כלום', JSON.stringify(await pay(pg, 'pcA')) === before);
    await pg.click('#dlg [data-a=payAiNo]'); await sleep(200);
    check('11ג ביטול – לא נשמר, הטיוטה בלי הרכיב', JSON.stringify(await pay(pg, 'pcA')) === before && await pg.evaluate(() => document.querySelectorAll('#main [data-comp]').length === 3));
    await pg.click('#main [data-a=payAi]'); await until(pg, () => /הבנתי כך/.test(document.getElementById('dlg').open ? document.getElementById('dlg').innerText : '')); await sleep(300);
    await pg.click('#dlg [data-a=payAiFix]'); await sleep(300);
    check('12 תיקון: העורך נפתח עם הערכים (2%), התעריף בטופס 42, ולא נשמר', /עריכת רכיב/.test(await dlgTxt(pg)) && await pg.evaluate(() => document.querySelector('#dlg input[name=p]').value === '2' && document.querySelector('#main input[name=rate]').value === '42') && JSON.stringify(await pay(pg, 'pcA')) === before);
    await pg.evaluate(() => closeDlg()); await pg.evaluate(() => { PayUI.PD.sub = ''; PayUI.PD.p = null; goBack(); }); await sleep(200);
    check('12א יציאה בלי שמירה – כלום לא נשמר', JSON.stringify(await pay(pg, 'pcA')) === before);
    await pg.click('#main [data-a=payOpen]'); await sleep(300);
    await pg.fill('#main input[name=tz]', '123456789'); // שינוי אחר בטופס, לא שמור – לא אמור להישמר באישור הכלל
    await pg.fill('textarea[name=aiT]', '2% מכל המכירות'); await pg.click('#main [data-a=payAi]'); await until(pg, () => /הבנתי כך/.test(document.getElementById('dlg').open ? document.getElementById('dlg').innerText : '')); await sleep(300);
    await clearT(pg); await pg.click('#dlg [data-a=payAiOk]'); await sleep(300);
    p = await pay(pg, 'pcA');
    check('13ב אישור הכלל שומר רק את מה שהוצג בחלון: ת״ז שהוקלדה ולא נשמרה – לא נשמרה, נשארת בטופס, והודעה על שינויים שלא נשמרו',
      !p.tz && await pg.evaluate(() => document.querySelector('#main input[name=tz]').value === '123456789') && /שינויים אחרים בטופס עוד לא נשמרו/.test(await toasts(pg)), { tz: p.tz, t: await toasts(pg) });
    await pg.fill('#main input[name=tz]', ''); await pg.evaluate(() => PayUI.pull());
    check('13 אישור: נשמר רכיב ה-AI (src, ai:1) והבסיס (rate 42); נשארים במסך', p.comp.length === 4 && p.comp[3].id === 'ai_x1' && p.comp[3].ai === 1 && p.comp[3].src === '2% מכל המכירות' && p.rate === 42 && await pg.evaluate(() => cur().v === 'payCfg' && document.querySelectorAll('#main [data-comp]').length === 4), p);
    AI.mode = 'unparsed'; await pg.fill('textarea[name=aiT]', 'שלום מה נשמע'); await pg.click('#main [data-a=payAi]'); await until(pg, () => /לא הצלחתי/.test(document.getElementById('dlg').open ? document.getElementById('dlg').innerText : ''));
    dt = await dlgTxt(pg);
    check('14 unparsed: הודעה ושלוש אפשרויות (לנסח מחדש / לבחור סוג ידנית / לשמור כבונוס ידני), לא נשמר', /הטקסט לא נראה כמו כלל שכר/.test(dt) && /לנסח מחדש/.test(dt) && /לבחור סוג ידנית/.test(dt) && /לשמור כבונוס ידני/.test(dt) && (await pay(pg, 'pcA')).comp.length === 4, dt);
    await pg.click('#dlg [data-a=payAiAsMan]'); await sleep(300); p = await pay(pg, 'pcA');
    check('14א "לשמור כבונוס ידני" – רכיב man עם src', p.comp.length === 5 && p.comp[4].k === 'man' && p.comp[4].src === 'שלום מה נשמע', p.comp[4]);
    AI.mode = 'missing'; await pg.fill('textarea[name=aiT]', 'בונוס 100'); await pg.click('#main [data-a=payAi]'); await until(pg, () => /לא הצלחתי/.test(document.getElementById('dlg').open ? document.getElementById('dlg').innerText : ''));
    check('15 הפונקציה חסרה בשרת: "הפענוח עוד לא זמין, אפשר להגדיר ידנית"', /הפענוח עוד לא זמין, אפשר להגדיר ידנית/.test(await dlgTxt(pg)), await dlgTxt(pg));
    await pg.click('#dlg [data-a=payAiMan]'); await sleep(250);
    check('15א "לבחור סוג ידנית" – נפתח עורך רכיב חדש', /רכיב שכר חדש/.test(await dlgTxt(pg)) && (await pay(pg, 'pcA')).comp.length === 5);
    await pg.evaluate(() => closeDlg());
    // חזרה ל-3 הרכיבים הקבועים
    await pg.evaluate((C) => { const s = S.subs.find((x) => x.id === 'pcA'); s.pay.comp = C; s.pay.rate = 40; save(); PayUI.PD.sub = ''; PayUI.PD.p = null; goBack(); }, COMP3); await sleep(200);

    // --- שכר חודשי, החודש הנוכחי ---
    const t0 = net.tasks, s0 = net.sales;
    await pg.evaluate(() => go('card', 'pcA')); await sleep(200);
    check('16 בכרטיס העובד – בלי טעינת משימות/מכירות', net.tasks === t0 && net.sales === s0);
    await pg.click('#main [data-a=payMonOpen]'); await sleep(200);
    await until(pg, () => !!document.querySelector('#main [data-comp-tbl]'));
    const rows = await pg.evaluate(() => [...document.querySelectorAll('#main [data-a=payCompBrk]')].map((b) => b.innerText.replace(/\s+/g, ' ')));
    const I = (n) => pg.evaluate((v) => ils(v), n); const N = (t) => t.replace(/\s+/g, ' '); const IN = async (n) => N(await I(n));
    check('17 3 רכיבים מחושבים: משימות 200 (1 בזמן, 1 ממתינה, של עובד אחר לא נספרת), מדרגות לפי שעות 100 (1,000 בשעות + 1,500 "לפי יום (אין שעות)"), אחוז 300 (3,500−500)×10%',
      rows.length === 3 && rows[0].includes(await IN(200)) && rows[1].includes(await IN(100)) && /לפי יום \(אין שעות\)/.test(rows[1]) && rows[2].includes(await IN(300)) && rows.every((r) => /צפוי/.test(r)), rows);
    const m1 = await pg.evaluate(() => ({ exp: document.querySelector('#main [data-exp]').innerText, left: document.querySelector('#main [data-a=payBrk][data-k=left] b').innerText, bon: document.querySelector('#main [data-a=payBrk][data-k=bon] b').innerText, hints: (document.querySelector('#main [data-hints]') || {}).innerText || '' }));
    check('18 צפוי 600 בנפרד; "נשאר להעביר" = רק שעות (8 × 40 = 320), בונוס 0', m1.exp === await I(600) && m1.left === await I(320) && m1.bon === await I(0), m1);
    check('18א "מה אפשר לשפר": משימה ממתינה, כמה חסר למדרגה הבאה', /סיים בזמן את 1/.test(m1.hints) && /חסרים 500 ₪ במכירות/.test(m1.hints), m1.hints);
    await pg.click('#main [data-a=payCompBrk][data-cid=k2]'); await sleep(200); dt = await dlgTxt(pg);
    check('18ב פירוט רכיב: det (בשעות המשמרות, לפי יום ב-1 ימים) ומה לשפר', /בשעות המשמרות/.test(dt) && /לפי יום \(אין שעות\): 1 ימים/.test(dt) && /מה אפשר לשפר/.test(dt), dt);
    await pg.evaluate(() => closeDlg());
    check('18ג החודש הנוכחי: אין כפתור "אשר בונוסים"; 412 בלי גלילה לרוחב', await pg.evaluate(() => !document.querySelector('#main [data-a=payAppr]')) && await noOverflow(pg));
    await shot(pg, 'comp-2-שכר-חודשי');

    // --- חודש קודם: אישור בונוסים ---
    await pg.evaluate(() => { const i = document.querySelector('#main input[data-c=payMonM]'); i.value = '2026-10'; i.dispatchEvent(new Event('change', { bubbles: true })); }); await sleep(200);
    await until(pg, () => !!document.querySelector('#main [data-a=payAppr]'));
    const r10 = await pg.evaluate(() => [...document.querySelectorAll('#main [data-a=payCompBrk]')].map((b) => b.innerText.replace(/\s+/g, ' ')));
    check('19 אוקטובר: משימה שבוצעה אחרי היעד = באיחור ← 0; מכירות בשעות 4,000 ← 300; אחוז 350; "ממתין לאישור"', r10[0].includes(await IN(0)) && r10[1].includes(await IN(300)) && r10[2].includes(await IN(350)) && r10.every((r) => /ממתין לאישור/.test(r)), r10);
    const leftBefore = await pg.evaluate(() => document.querySelector('#main [data-a=payBrk][data-k=left] b').innerText);
    await pg.click('#main [data-a=payAppr]'); await sleep(200);
    check('19א אישור מבקש אישור נוסף – עוד לא נוצר bon', /לאשר 3 בונוסים/.test(await dlgTxt(pg)) && await pg.evaluate(() => S.bon.length === 0));
    await pg.click('#dlg [data-a=yes]'); await sleep(300);
    const B = await pg.evaluate(() => S.bon.map(({ id, ...b }) => Object.assign(b, { hasId: typeof id === 'string' && id.length > 0 })));
    check('20 נוצרו 3 רשומות bon (src:auto, cid, calc, det, id חדש)', B.length === 3 && B.every((b) => b.src === 'auto' && b.mon === '2026-10' && b.sub === 'pcA' && b.hasId && typeof b.det === 'string') && JSON.stringify(B.map((b) => [b.cid, b.a])) === JSON.stringify([['k1', 0], ['k2', 300], ['k3', 350]]), B);
    const m2 = await pg.evaluate(() => ({ exp: document.querySelector('#main [data-exp]').innerText, left: document.querySelector('#main [data-a=payBrk][data-k=left] b').innerText, appr: !!document.querySelector('#main [data-a=payAppr]'), tags: [...document.querySelectorAll('#main [data-a=payCompBrk]')].map((b) => /אושר/.test(b.innerText)) }));
    check('20א אחרי אישור: הרכיבים "אושר", צפוי 0, "נשאר להעביר" עלה ב-650, אין כפתור אישור', m2.exp === await I(0) && m2.tags.every(Boolean) && !m2.appr && m2.left === await I(160 + 650) && leftBefore === await I(160), m2);
    const again = await pg.evaluate(() => { const s = S.subs.find((x) => x.id === 'pcA'); return PayCore.autoBon(s, '2026-10', { wh: S.wh, bon: S.bon, tasks: [], salesByDay: {} }).length; });
    check('20ב אין כפילות: אחרי אישור autoBon לא מציע שוב', again === 0);
    const bk2 = await pg.evaluate(() => S.bon.find((b) => b.cid === 'k2').id);
    await pg.click(`#main [data-a=payBonEd][data-id="${bk2}"]`); await sleep(200); await pg.fill('#dlg input[name=a]', '250'); await pg.click('#dlg form[data-f=payBonF] button[type=submit]'); await sleep(250);
    check('21 בונוס מאושר ניתן לעריכה כמו בונוס רגיל; הרכיב מציג את הסכום המאושר', await pg.evaluate(() => S.bon.find((b) => b.cid === 'k2').a === 250) && (await pg.evaluate(() => document.querySelector('#main [data-a=payCompBrk][data-cid=k2]').innerText)).includes(await I(250)));
    const bk1 = await pg.evaluate(() => S.bon.find((b) => b.cid === 'k1').id);
    await pg.click(`#main [data-a=payBonEd][data-id="${bk1}"]`); await sleep(200); await pg.fill('#dlg input[name=n]', 'משימות – נבדק'); await pg.click('#dlg form[data-f=payBonF] button[type=submit]'); await sleep(250);
    check('21א בונוס מאושר בסכום 0 – אפשר לשמור עריכה', await pg.evaluate(() => S.bon.find((b) => b.cid === 'k1').n === 'משימות – נבדק'));
    await pg.evaluate((id) => { ACT.payBonDel({ dataset: { id } }); }, bk1); await sleep(150); await pg.click('#dlg [data-a=yes]'); await sleep(250);
    const bk3 = await pg.evaluate(() => S.bon.find((b) => b.cid === 'k3').id);
    await pg.click(`#main [data-a=payBonEd][data-id="${bk3}"]`); await sleep(200);
    check('21ב בעריכת בונוס מרכיב – הכפתור "בטל בונוס"', /בטל בונוס/.test(await dlgTxt(pg)));
    await pg.click('#dlg [data-a=payBonDel]'); await sleep(150);
    check('21ג ביטול מבקש אישור ומסביר שהרכיב לא יחושב שוב', /לבטל את הבונוס\? הרכיב לא יחושב שוב/.test(await dlgTxt(pg)), await dlgTxt(pg));
    await pg.click('#dlg [data-a=yes]'); await sleep(250);
    const m3 = await pg.evaluate(() => { const b = S.bon.find((x) => x.cid === 'k3'); return { n: S.bon.length, a: b && b.a, del: b && b.del, tag: document.querySelector('#main [data-a=payCompBrk][data-cid=k3]').innerText, appr: !!document.querySelector('#main [data-a=payAppr]'), exp: document.querySelector('#main [data-exp]').innerText, left: document.querySelector('#main [data-a=payBrk][data-k=left] b').innerText, lst: !!document.querySelector('#main [data-bdel]'),
      again: PayCore.autoBon(S.subs.find((x) => x.id === 'pcA'), '2026-10', { wh: S.wh, bon: S.bon, tasks: [], salesByDay: {} }).length }; });
    check('21ד ביטול בונוס מאושר: הרשומה נשארת (a:0, del:1), הרכיב "בוטל" ולא "ממתין לאישור", אין כפתור אישור, צפוי 0, "נשאר להעביר" ירד ב-350, autoBon לא מציע שוב',
      m3.n === 3 && m3.a === 0 && m3.del === 1 && /בוטל/.test(m3.tag) && !/ממתין לאישור/.test(m3.tag) && !m3.appr && m3.exp === await I(0) && m3.left === await I(160 + 250) && m3.lst && m3.again === 0, m3);
    await pg.click(`#main [data-a=payBonEd][data-id="${bk3}"]`); await sleep(200); await pg.fill('#dlg input[name=a]', '350'); await pg.click('#dlg form[data-f=payBonF] button[type=submit]'); await sleep(250);
    check('21ה שחזור: עריכת הסכום מחזירה את הבונוס (del נמחק) והרכיב "אושר"', await pg.evaluate(() => { const b = S.bon.find((x) => x.cid === 'k3'); return b.a === 350 && !('del' in b) && /אושר/.test(document.querySelector('#main [data-a=payCompBrk][data-cid=k3]').innerText); }));
    await pg.evaluate((id) => { ACT.payBonDel({ dataset: { id } }); }, bk1); await sleep(150); await pg.click('#dlg [data-a=yes]'); await sleep(250);
    check('21ו ביטול בונוס מאושר בסכום 0 – נשאר "טופל" (לא חוזר לחישוב חי)', await pg.evaluate(() => S.bon.length === 3 && !/ממתין לאישור/.test(document.querySelector('#main [data-a=payCompBrk][data-cid=k1]').innerText)));
    const mb = await pg.evaluate(() => { const L = S.bon; L.push({ id: 'bm1', sub: 'pcA', mon: '2026-10', a: 40, n: 'ידני' }); save(); ACT.payBonDel({ dataset: { id: 'bm1' } }); return document.getElementById('dlg').innerText; });
    await pg.click('#dlg [data-a=yes]'); await sleep(200);
    check('21ז בונוס ידני – נמחק כמו קודם', /למחוק את הבונוס/.test(mb) && await pg.evaluate(() => !S.bon.some((b) => b.id === 'bm1') && S.bon.length === 3));

    // --- עובד בלי comp – כמו היום ---
    await pg.evaluate(() => { PayUI.PM.sub = 'pcB'; PayUI.PM.mon = '2026-11'; go('payMon', 'pcB'); }); await sleep(300);
    const bNow = await pg.evaluate(() => JSON.stringify(PayUI.monSum(S.subs.find((s) => s.id === 'pcB'), '2026-11')));
    check('22 עובד בלי comp: החישוב זהה למנוע בלי רכיבים, אין טבלת רכיבים, אין טעינה', bNow === bSnap && await pg.evaluate(() => !document.querySelector('#main [data-comp-tbl]') && !/רכיבי שכר/.test(document.getElementById('main').innerText)), { bNow, bSnap });

    // --- אישור אוטומטי מה-3 בחודש ---
    await pg.evaluate(() => { const emp = S.cats.find((c) => c.kind === 'exp' && !c.hid && c.beh === 'emp');
      S.subs.push({ id: 'pcC', cat: emp.id, name: 'אוטומטי', pay: { mode: 'hr', rate: 30, m: 'מזומן', slip: false, uid: 'dana', from: '2026-09', rules: [], add: [], comp: [{ id: 'q1', k: 'pc', p: 5, ss: 'hrs' }, { id: 'q2', k: 'man', n: 'חג' }] } });
      S.wh.push({ id: 'w5', sub: 'pcC', d: '2026-10-10', in: '11:00', out: '13:00', brk: 0, src: 'man' });
      // pcD: יום עבודה 11.10 בלי נתוני מכירות מכספית – אסור לאשר אוטומטית
      S.subs.push({ id: 'pcD', cat: emp.id, name: 'חסר', pay: { mode: 'hr', rate: 30, m: 'מזומן', slip: false, uid: 'dana', from: '2026-09', rules: [], add: [], comp: [{ id: 'd1', k: 'pc', p: 5, ss: 'day' }] } });
      S.wh.push({ id: 'w6', sub: 'pcD', d: '2026-10-10', in: '11:00', out: '13:00', brk: 0, src: 'man' }, { id: 'w7', sub: 'pcD', d: '2026-10-11', in: '11:00', out: '13:00', brk: 0, src: 'man' }); save(); });
    await pg.clock.setFixedTime(new Date(Date.UTC(2026, 10, 2, 9)));
    const early = await pg.evaluate(async () => { PayComp._reset(); const n = await payAutoAppr(); return { n, bon: S.bon.filter((b) => b.sub === 'pcC').length }; });
    check('23 לפני ה-3 בחודש – אין אישור אוטומטי', early.n === 0 && early.bon === 0, early);
    await pg.clock.setFixedTime(new Date(H.T0));
    await pg.reload(); await pg.waitForLoadState('load');
    await until(pg, () => typeof S !== 'undefined' && S.bon.some((b) => b.sub === 'pcC'), null, 15000);
    const C1 = await pg.evaluate(() => ({ L: S.bon.filter((b) => b.sub === 'pcC').map((b) => [b.cid, b.a, b.mon, b.src]), ab: S.subs.find((s) => s.id === 'pcC').pay.ab, a: S.bon.filter((b) => b.sub === 'pcA').length }));
    // 11:00–13:00 בשעות 11, 12: רק 12 = 3,000 × 5% = 150; man לא נרשם
    check('24 פתיחת מכשיר המנהל ב-3 בחודש: bon אוטומטי לחודש הקודם (מכירות בשעות 11–13 = 3,000 × 5% = 150), ab=2026-10; לעובד שכבר אושר – בלי שינוי', JSON.stringify(C1.L) === JSON.stringify([['q1', 150, '2026-10', 'auto']]) && C1.ab === '2026-10' && C1.a === 3, C1);
    const D1 = await pg.evaluate(() => ({ n: S.bon.filter((b) => b.sub === 'pcD').length, ab: S.subs.find((s) => s.id === 'pcD').pay.ab }));
    check('24ב עובד עם יום עבודה בלי נתוני מכירות – לא אושר אוטומטית (אין bon, ab לא התקדם)', D1.n === 0 && D1.ab === undefined, D1);
    await pg.reload(); await pg.waitForLoadState('load'); await sleep(8000);
    const C2 = await pg.evaluate(() => S.bon.filter((b) => b.sub === 'pcC').length);
    check('24א פתיחה נוספת – בלי כפילות', C2 === 1, C2);
    await pg.evaluate(() => { const d = document.getElementById('dlg'); if (d && d.open) closeDlg(); PayUI.PM.sub = 'pcD'; PayUI.PM.mon = '2026-10'; go('payMon', 'pcD'); }); await sleep(300);
    await until(pg, () => !!document.querySelector('#main [data-gaps]'));
    const gT = await pg.evaluate(() => ({ g: (document.querySelector('#main [data-gaps]') || {}).innerText || '', p: /ממתין לאישור/.test((document.querySelector('#main [data-a=payCompBrk][data-cid=d1]') || {}).innerText || '') }));
    check('24ג במסך המנהל: "ממתין לאישור" + "לא אושר אוטומטית – חסרים נתונים" עם הסיבה (ימי עבודה בלי מכירות)', gT.p && /לא אושר אוטומטית/.test(gT.g) && /חסרים נתוני מכירות ל-1 ימי עבודה/.test(gT.g), gT);
    await shot(pg, 'comp-3-חסרים-נתונים');
    await pg.click('#main [data-a=payAppr]'); await sleep(200);
    const gA = await dlgTxt(pg);
    check('24ד אישור ידני עם אזהרה ברורה על הנתונים החסרים', /שימו לב – חסרים נתונים/.test(gA) && /לאשר 1 בונוסים/.test(gA), gA);
    await pg.click('#dlg [data-a=yes]'); await sleep(250);
    check('24ה אחרי אישור ידני – נרשם bon (4,000 × 5% = 200) ו-ab', await pg.evaluate(() => { const L = S.bon.filter((b) => b.sub === 'pcD'); return L.length === 1 && L[0].a === 200 && S.subs.find((s) => s.id === 'pcD').pay.ab === '2026-10'; }));
    check('25 אין שגיאות JS (מנהל)', pg.__errors.length === 0, pg.__errors);
    await x.ctx.close(); }

  // ===== 2. עובד: לא רואה כלום =====
  { const cfg = { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: {} } }, staff: { '|w1': 1 } };
    const x = await H.newPage(browser, www, cfg, [], 'w-comp'); const pg = x.page; await pg.setViewportSize({ width: 412, height: 900 });
    await H.login(pg, 'w1@x.co'); await sleep(800);
    const r = await pg.evaluate(async () => { const s = { id: 'pcA', name: 'x', pay: { mode: 'hr', rate: 40, uid: 'w1', comp: [{ id: 'k', k: 'tk', m: 'all', a: 1 }] } };
      return { w: isW(), h: window.payCardH(s), v: V.payCfg('pcA').h, m: V.payMon('pcA').h, a: await window.payAutoAppr(), ed: (ACT.payCompEd({ dataset: {} }), !!(document.getElementById('dlg') || {}).open) }; });
    check('26 עובד: אין שורות שכר, המסכים חסומים, אישור אוטומטי לא רץ, העורך לא נפתח', r.w && r.h === '' && /למנהל בלבד/.test(r.v) && /למנהל בלבד/.test(r.m) && r.a === 0 && !r.ed, r);
    check('26א אין שגיאות JS (עובד)', pg.__errors.length === 0, pg.__errors);
    await x.ctx.close(); }

  await browser.close();
  if (out) fs.writeFileSync(out, JSON.stringify({ fail, res }, null, 1));
  console.log(fail ? 'נכשלו ' + fail + ' בדיקות' : 'כל הבדיקות עברו');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
