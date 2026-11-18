'use strict';
// שכר, שלב ב' (18.11.2026): הגדרות שכר בכרטיס עובד (www/payroll.js) ומיגרציית ensure. רשת מדומה, בלי אמולטור.
// מנהל: שורה "הגדרות שכר" בכרטיס עובד; עובד בלי pay – הכרטיס זהה לכרטיס בלי payroll.js (חוץ מהשורה); אימות קלט (מספר חיובי, HH:MM, יום,
// שם תוספת); מעבר בין סוגי שכר לא מוחק מה שהוקלד; שמירה ב-subs[].pay, בלי שינוי ברשומות אחרות; טעינה מחדש – נשמר ומוצג; S.wh/bon/psl נוספו ריקים.
// קישור למשתמש: בעסק legacy – בלי רשימה, עם הסבר; בעסק במבנה החדש – רשימת העובדים (staff) ובחירה. עובד: לא רואה כלום.
// שימוש: node ui-payroll.js <www-dir> [shots-dir]
const fs = require('fs'); const path = require('path'); const H = require('./harness');
const BZ0 = ['larg', 'peami'].join('');
let fail = 0; const check = (n, ok, info) => { if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (page, dir, name) => { if (!dir) return; fs.mkdirSync(dir, { recursive: true }); await page.waitForTimeout(300); await page.screenshot({ path: path.join(dir, name + '.png'), fullPage: true }); };
const closeD = async (page) => { if (await page.evaluate(() => { const d = document.getElementById('dlg'); return !!(d && d.open); })) { await page.evaluate(() => closeDlg()); await sleep(150); } };
const toasts = (page) => page.evaluate(() => [...document.querySelectorAll('.toast')].map((x) => x.innerText).join('|'));
const clearT = (page) => page.evaluate(() => document.querySelectorAll('.toast').forEach((x) => x.remove()));
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const save = (page) => page.click('#main form[data-f=payCfgF] button[type=submit]');
const pay = (page, id) => page.evaluate((i) => { const s = S.subs.find((x) => x.id === i); return s && s.pay ? JSON.parse(JSON.stringify(s.pay)) : null; }, id);
const seedEmp = (page) => page.evaluate(() => { const emp = S.cats.find((c) => c.kind === 'exp' && !c.hid && c.beh === 'emp');
  [['pyE1', 'עובד בלי הגדרות'], ['pyE2', 'עובדת לבדיקה']].forEach(([id, name]) => { if (!S.subs.some((x) => x.id === id)) S.subs.push({ id, cat: emp.id, name, ext: { role: 'מוכרת' } }); });
  if (!S.tx.some((t) => t.id === 'pyT1')) S.tx.push({ id: 'pyT1', t: 'exp', cat: emp.id, sub: 'pyE1', date: '2026-10-31', amt: 4000, plan: '2026-10', pays: [{ id: 'pyP1', d: '2026-11-01', a: 4000, m: 'מזומן' }] });
  save(); return emp.id; });

(async () => {
  const [www, shots] = process.argv.slice(2); const browser = await H.launch();

  // ===== 1. מנהל, עסק legacy =====
  { const cfg = { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: {} } }, admins: { '|m': 1 } };
    const x = await H.newPage(browser, www, cfg, [], 'm-pay'); const pg = x.page; await pg.setViewportSize({ width: 412, height: 900 });
    await H.login(pg, 'm@x.co'); if (await pg.$('[data-a=startBlank]')) { await pg.click('[data-a=startBlank]'); await sleep(300); }
    await sleep(1000); await closeD(pg);
    check('1 מיגרציה: S.wh, S.bon, S.psl קיימים כמערכים ריקים', await pg.evaluate(() => JSON.stringify([S.wh, S.bon, S.psl]) === '[[],[],[]]'));
    await seedEmp(pg);
    const before = await pg.evaluate(() => JSON.stringify({ tx: S.tx, cats: S.cats, subs: S.subs.filter((s) => s.id !== 'pyE2') }));

    // עובד בלי pay: הכרטיס כמו בלי payroll.js, חוץ מהשורה
    await pg.evaluate(() => go('card', 'pyE1')); await sleep(300);
    const row = await pg.evaluate(() => { const b = document.querySelector('#main [data-a=payOpen]'); return b ? b.innerText : null; });
    check('2 בכרטיס עובד (מנהל) יש שורה "הגדרות שכר" – "לא הוגדר"', !!row && /הגדרות שכר/.test(row) && /לא הוגדר/.test(row), row);
    const same = await pg.evaluate(() => { const b = document.querySelector('#main [data-a=payOpen]'); b.remove(); const a = document.getElementById('main').innerHTML;
      const f = window.payCardH; window.payCardH = undefined; rerender(); const z = document.getElementById('main').innerHTML; window.payCardH = f; rerender(); return a === z; });
    check('2א עובד בלי pay: שאר הכרטיס זהה לגמרי לכרטיס בלי payroll.js', same);
    const sup = await pg.evaluate(() => { const c = S.cats.find((k) => k.beh === 'sup'); if (!c) return 'none'; const s = S.subs.find((y) => y.cat === c.id) || (S.subs.push({ id: 'pySup', cat: c.id, name: 'ספק' }), S.subs[S.subs.length - 1]); go('card', s.id); return !document.querySelector('#main [data-a=payOpen]'); });
    check('2ב כרטיס ספק: אין שורת שכר', sup === true, sup); await pg.evaluate(() => { const i = S.subs.findIndex((s) => s.id === 'pySup'); if (i >= 0) S.subs.splice(i, 1); goBack(); });

    // פתיחת ההגדרות
    await pg.evaluate(() => go('card', 'pyE2')); await sleep(250);
    await pg.click('#main [data-a=payOpen]'); await sleep(300);
    check('3 נפתח המסך "הגדרות שכר" עם ברירת מחדל "לפי שעה"', await pg.evaluate(() => cur().v === 'payCfg' && document.querySelector('[data-a=payMode][data-v=hr]').classList.contains('on') && !!document.querySelector('input[name=rate]')));
    check('3א בלי רשימת משתמשים (legacy): שדה ריק עם הסבר', await pg.evaluate(() => { const s = document.querySelector('select[name=uid]'); return s && s.options.length === 1 && s.value === '' && /במבנה החדש/.test(s.closest('.card').innerText); }));
    check('3ב אין גלילה לרוחב ב-412', await noOverflow(pg));
    await shot(pg, shots, 'pay-1-ריק');

    // אימות קלט
    await clearT(pg); await save(pg); await sleep(200);
    check('4 בלי תעריף – לא נשמר, הודעה', /חסר תעריף לשעה/.test(await toasts(pg)) && (await pay(pg, 'pyE2')) === null, await toasts(pg));
    await pg.fill('input[name=rate]', '-5'); await clearT(pg); await save(pg); await sleep(200);
    check('4א תעריף שלילי – נדחה', /מספר חיובי/.test(await toasts(pg)) && (await pay(pg, 'pyE2')) === null, await toasts(pg));
    await pg.fill('input[name=rate]', 'abc'); await clearT(pg); await save(pg); await sleep(200);
    check('4ב תעריף לא מספר – נדחה', /מספר חיובי/.test(await toasts(pg)) && (await pay(pg, 'pyE2')) === null);
    await pg.fill('input[name=rate]', '45,5'); await pg.selectOption('select[name=m]', 'העברה'); await pg.check('input[name=slip]');

    // כלל תעריף
    await pg.click('[data-a=payRuleAdd]'); await sleep(200);
    check('5 נוסף כלל, ומה שהוקלד קודם נשאר', await pg.evaluate(() => document.querySelector('input[name=rate]').value === '45,5' && document.querySelector('select[name=m]').value === 'העברה' && document.querySelector('input[name=slip]').checked && !!document.querySelector('input[name=rs0]')));
    await clearT(pg); await save(pg); await sleep(200);
    check('5א כלל בלי יום – נדחה', /לפחות יום/.test(await toasts(pg)));
    await pg.click('[data-a=payDay][data-i="0"][data-v="5"]'); await sleep(120); await pg.click('[data-a=payDay][data-i="0"][data-v="6"]'); await sleep(120);
    await pg.click('[data-a=payDay][data-i="0"][data-v="0"]'); await sleep(120); await pg.click('[data-a=payDay][data-i="0"][data-v="0"]'); await sleep(120);
    check('5ב בחירת ימים: ו׳ ו-ש׳ מסומנים, א׳ סומן ובוטל', await pg.evaluate(() => [...document.querySelectorAll('[data-a=payDay][data-i="0"].on')].map((b) => b.dataset.v).join() === '5,6'));
    await pg.fill('input[name=rs0]', '22:00'); await clearT(pg); await save(pg); await sleep(200);
    check('5ג שעת סיום חסרה – "HH:MM"', /HH:MM/.test(await toasts(pg)));
    await pg.fill('input[name=re0]', '22:00'); await pg.fill('input[name=rr0]', '55'); await clearT(pg); await save(pg); await sleep(200);
    check('5ד התחלה = סיום – נדחה', /זהות/.test(await toasts(pg)));
    await pg.fill('input[name=re0]', '06:00');

    // תוספות
    await pg.click('[data-a=payAddAdd]'); await sleep(150); await pg.click('[data-a=payAddAdd]'); await sleep(150);
    await pg.fill('input[name=an0]', 'נסיעות'); await pg.selectOption('select[name=ak0]', 'day'); await pg.fill('input[name=aa0]', '22.5');
    await pg.fill('input[name=an1]', 'טלפון'); await pg.fill('input[name=aa1]', '0'); await clearT(pg); await save(pg); await sleep(200);
    check('6 תוספת בסכום 0 – נדחית', /תוספת 2: סכום/.test(await toasts(pg)), await toasts(pg));
    await pg.fill('input[name=an1]', ''); await pg.fill('input[name=aa1]', '50'); await clearT(pg); await save(pg); await sleep(200);
    check('6א תוספת בלי שם – נדחית', /תוספת 2: חסר שם/.test(await toasts(pg)));
    await pg.click('[data-a=payAddDel][data-i="1"]'); await sleep(150);

    // מעבר לחודשי וחזרה – לא נמחק כלום
    await pg.click('[data-a=payMode][data-v=mo]'); await sleep(150);
    check('7 "חודשי קבוע": שדה סכום חודשי, הכללים לא מוצגים (עם הסבר)', await pg.evaluate(() => !!document.querySelector('input[name=mo]') && !document.querySelector('input[name=rate]') && !document.querySelector('input[name=rs0]') && /כללי התעריף לא משמשים/.test(document.getElementById('main').innerText)));
    await pg.fill('input[name=mo]', '7000'); await pg.click('[data-a=payMode][data-v=hr]'); await sleep(150);
    check('7א חזרה ל"לפי שעה": התעריף, הכלל והתוספת נשארו', await pg.evaluate(() => document.querySelector('input[name=rate]').value === '45,5' && document.querySelector('input[name=rs0]').value === '22:00' && document.querySelector('input[name=re0]').value === '06:00' && document.querySelector('input[name=an0]').value === 'נסיעות' && !document.querySelector('input[name=an1]')));
    await shot(pg, shots, 'pay-2-מלא');
    check('7ב אין גלילה לרוחב ב-412 (טופס מלא)', await noOverflow(pg));

    // שמירה
    await clearT(pg); await save(pg); await sleep(300);
    const p = await pay(pg, 'pyE2');
    const exp = { mode: 'hr', rate: 45.5, mo: 7000, m: 'העברה', slip: true, uid: '', rules: [{ d: [5, 6], s: '22:00', e: '06:00', r: 55 }], add: [{ n: 'נסיעות', k: 'day', a: 22.5 }] };
    const strip = (o) => o && Object.assign({}, o, { rules: (o.rules || []).map(({ id, ...r }) => r), add: (o.add || []).map(({ id, ...a }) => a) });
    check('8 נשמר ב-subs[].pay במבנה המוסכם (מספרים, ימים, מזהים)', p && JSON.stringify(strip(p)) === JSON.stringify(exp) && typeof p.rules[0].id === 'string' && typeof p.add[0].id === 'string', p);
    check('8א חזרה לכרטיס, הודעה, ושורה מעודכנת', await pg.evaluate(() => cur().v === 'card') && /נשמרו/.test(await toasts(pg))
      && /לפי שעה.*העברה.*תלוש.*1 כללי תעריף.*1 תוספות/.test(await pg.evaluate(() => document.querySelector('#main [data-a=payOpen]').innerText)));
    check('8ב שאר הנתונים לא השתנו (תנועות, קטגוריות, כרטיסים אחרים)', await pg.evaluate(() => JSON.stringify({ tx: S.tx, cats: S.cats, subs: S.subs.filter((s) => s.id !== 'pyE2') })) === before);
    check('8ג שדות אחרים ב-pay נשמרים בעריכה (תוספת שדה משלב אחר)', await pg.evaluate(() => { const s = S.subs.find((x) => x.id === 'pyE2'); s.pay.zz = 1; save(); return true; }));
    await pg.click('#main [data-a=payOpen]'); await sleep(250); await pg.fill('input[name=rate]', '46'); await save(pg); await sleep(300);
    const p2 = await pay(pg, 'pyE2');
    check('8ד עריכה: התעריף התעדכן, zz נשאר, מזהי הכללים נשמרו', p2 && p2.rate === 46 && p2.zz === 1 && p2.rules[0].id === p.rules[0].id && p2.add[0].id === p.add[0].id, p2);

    // טעינה מחדש
    await pg.reload(); await pg.waitForLoadState('load'); await H.settle(pg, 2000); await closeD(pg);
    const ok = await pg.evaluate(() => isA());
    check('9 אחרי טעינה מחדש: מנהל, ההגדרות נשמרו, S.wh/bon/psl עדיין מערכים', ok && JSON.stringify(await pay(pg, 'pyE2')) === JSON.stringify(p2) && await pg.evaluate(() => [S.wh, S.bon, S.psl].every(Array.isArray)));
    if (ok) {
      await pg.evaluate(() => go('card', 'pyE2')); await sleep(250); await pg.click('#main [data-a=payOpen]'); await sleep(250);
      check('9א המסך נטען עם הערכים השמורים', await pg.evaluate(() => document.querySelector('input[name=rate]').value === '46' && document.querySelector('select[name=m]').value === 'העברה' && document.querySelector('input[name=slip]').checked
        && document.querySelector('input[name=rs0]').value === '22:00' && document.querySelector('input[name=rr0]').value === '55' && [...document.querySelectorAll('[data-a=payDay][data-i="0"].on')].map((b) => b.dataset.v).join() === '5,6'
        && document.querySelector('input[name=an0]').value === 'נסיעות' && document.querySelector('select[name=ak0]').value === 'day'));
      await pg.evaluate(() => goBack()); await sleep(200);
      await pg.evaluate(() => go('card', 'pyE1')); await sleep(250);
      check('9ב עובד בלי pay אחרי טעינה – עדיין "לא הוגדר", בלי pay', /לא הוגדר/.test(await pg.evaluate(() => document.querySelector('#main [data-a=payOpen]').innerText)) && (await pay(pg, 'pyE1')) === null);
    }
    check('10 אין שגיאות JS', pg.__errors.length === 0, pg.__errors);
    await x.ctx.close(); }

  // ===== 2. מנהל, עסק במבנה החדש: רשימת המשתמשים =====
  { const cfg = { mode: 'new', users: { ma: 'acme' }, biz: { acme: { dataRoot: 'b', features: {} } }, admins: { 'b/acme/|ma': 1 } };
    const x = await H.newPage(browser, www, cfg, [], 'mb-pay'); const pg = x.page; await pg.setViewportSize({ width: 412, height: 900 });
    const D = 'projects/demo-largpeami/databases/(default)/documents/b/acme/staff/';
    const sd = (uid, name, active) => ({ name: D + uid, fields: { name: { stringValue: name }, email: { stringValue: uid + '@x.co' }, role: { stringValue: 'staff' }, active: { booleanValue: active } }, createTime: '2026-11-03T09:00:00Z', updateTime: '2026-11-03T09:00:00Z' });
    await x.ctx.route((u) => { const q = new URL(u); return q.port === '8080' && /\/documents\/b\/acme\/staff$/.test(decodeURIComponent(q.pathname)); },
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ documents: [sd('dana', 'דנה כהן', true), sd('yossi', 'יוסי', false)] }) }));
    await H.login(pg, 'ma@x.co'); if (await pg.$('[data-a=startBlank]')) { await pg.click('[data-a=startBlank]'); await sleep(300); }
    await sleep(1000); await closeD(pg); await seedEmp(pg);
    await pg.evaluate(() => go('card', 'pyE2')); await sleep(250); await pg.click('#main [data-a=payOpen]');
    const t0 = Date.now(); while (Date.now() - t0 < 5000 && !(await pg.evaluate(() => { const s = document.querySelector('select[name=uid]'); return s && s.options.length > 1; }))) await sleep(100);
    const opts = await pg.evaluate(() => [...document.querySelector('select[name=uid]').options].map((o) => o.value + '=' + o.text));
    check('11 מבנה חדש: רשימת המשתמשים נטענת לבחירה (כולל מושבת, מסומן)', opts.join('|') === '=בלי קישור|dana=דנה כהן|yossi=יוסי (מושבת)', opts);
    await pg.fill('input[name=rate]', '40'); await pg.selectOption('select[name=uid]', 'dana'); await save(pg); await sleep(300);
    const p = await pay(pg, 'pyE2');
    check('11א נשמר הקישור uid=dana', p && p.uid === 'dana' && p.rate === 40 && p.mode === 'hr', p);
    await pg.evaluate(() => { S.subs.find((x) => x.id === 'pyE2').pay.uid = 'ghost1'; save(); go('card', 'pyE2'); }); await sleep(200); await pg.click('#main [data-a=payOpen]'); await sleep(300);
    check('11ב משתמש שמור שלא ברשימה – נשאר בחור (לא נמחק בשקט)', await pg.evaluate(() => document.querySelector('select[name=uid]').value === 'ghost1'));
    check('11ג אין שגיאות JS', pg.__errors.length === 0, pg.__errors);
    await x.ctx.close(); }

  // ===== 3. עובד: לא רואה כלום =====
  { const cfg = { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: {} } }, staff: { '|w1': 1 } };
    const x = await H.newPage(browser, www, cfg, [], 'w-pay'); const pg = x.page; await pg.setViewportSize({ width: 412, height: 900 });
    await H.login(pg, 'w1@x.co'); await sleep(800); await closeD(pg);
    const r = await pg.evaluate(() => ({ w: isW(), h: window.payCardH({ id: 'pyE1', name: 'x' }), v: V.payCfg('pyE1').h }));
    check('12 עובד: אין שורת שכר, והמסך חסום', r.w && r.h === '' && /למנהל בלבד/.test(r.v), r);
    check('12א אין שגיאות JS', pg.__errors.length === 0, pg.__errors);
    await x.ctx.close(); }

  await browser.close();
  console.log(fail ? `נכשלו ${fail} בדיקות` : 'כל הבדיקות עברו');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
