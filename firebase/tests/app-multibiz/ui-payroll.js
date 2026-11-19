'use strict';
// שכר, שלב ב' (18.11.2026): הגדרות שכר בכרטיס עובד (www/payroll.js) ומיגרציית ensure. רשת מדומה, בלי אמולטור.
// מנהל: שורה "הגדרות שכר" בכרטיס עובד; עובד בלי pay – הכרטיס זהה לכרטיס בלי payroll.js (חוץ מהשורה); אימות קלט (מספר חיובי, HH:MM, יום,
// שם תוספת); מעבר בין סוגי שכר לא מוחק מה שהוקלד; שמירה ב-subs[].pay, בלי שינוי ברשומות אחרות; טעינה מחדש – נשמר ומוצג; S.wh/bon/psl נוספו ריקים.
// קישור למשתמש: בעסק legacy – בלי רשימה, עם הסבר; בעסק במבנה החדש – רשימת העובדים (staff) ובחירה. עובד: לא רואה כלום.
// שלב ג': שכר חודשי – שעות ובונוס (הזנה, עריכה, מחיקה, אימות), "נשאר להעביר", תשלום מהקופה (inbOk) והעברה (tgrp) מורידים,
// כיסוי מלא ← נסגר, ביטול העברה ← נפתח, ec/x/כרטיס אחר לא נספרים, ביתר, עובד בתלוש (רו"ח), עובד בלי pay, פרטיות (wv) וגיבוי.
// שימוש: node ui-payroll.js <www-dir> [out.json] [shots-dir]
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
  // ב-CI: <www> <out.json> <shots>; מקומית אפשר גם <www> <shots>
  const A = process.argv.slice(2), www = A[0], shots = A.length > 2 ? A[2] : A[1]; const browser = await H.launch();

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
    const strip = (o) => o && Object.assign({}, o, { from: undefined, rules: (o.rules || []).map(({ id, ...r }) => r), add: (o.add || []).map(({ id, ...a }) => a) });
    check('8 נשמר ב-subs[].pay במבנה המוסכם (מספרים, ימים, מזהים; from = החודש הנוכחי)', p && JSON.stringify(strip(p)) === JSON.stringify(exp) && p.from === await pg.evaluate(() => NOWM()) && typeof p.rules[0].id === 'string' && typeof p.add[0].id === 'string', p);
    check('8א חזרה לכרטיס, הודעה, ושורה מעודכנת', await pg.evaluate(() => cur().v === 'card') && /נשמרו/.test(await toasts(pg))
      && /לפי שעה.*העברה.*תלוש.*1 כללי תעריף.*1 תוספות/.test(await pg.evaluate(() => document.querySelector('#main [data-a=payOpen]').innerText)));
    check('8ב שאר הנתונים לא השתנו (תנועות, קטגוריות, כרטיסים אחרים)', await pg.evaluate(() => JSON.stringify({ tx: S.tx, cats: S.cats, subs: S.subs.filter((s) => s.id !== 'pyE2') })) === before);
    check('8ג שדות אחרים ב-pay נשמרים בעריכה (תוספת שדה משלב אחר)', await pg.evaluate(() => { const s = S.subs.find((x) => x.id === 'pyE2'); s.pay.zz = 1; save(); return true; }));
    await pg.click('#main [data-a=payOpen]'); await sleep(250); await pg.fill('input[name=rate]', '46'); await save(pg); await sleep(300);
    const p2 = await pay(pg, 'pyE2');
    check('8ד עריכה: התעריף התעדכן, zz נשאר, מזהי הכללים נשמרו', p2 && p2.rate === 46 && p2.zz === 1 && p2.from === p.from && p2.rules[0].id === p.rules[0].id && p2.add[0].id === p.add[0].id, p2);

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
    const r = await pg.evaluate(() => ({ w: isW(), h: window.payCardH({ id: 'pyE1', name: 'x', pay: { mode: 'hr', rate: 40 } }), v: V.payCfg('pyE1').h, m: V.payMon('pyE1').h }));
    check('12 עובד: אין שורת שכר, ומסכי ההגדרות והשכר החודשי חסומים', r.w && r.h === '' && /למנהל בלבד/.test(r.v) && /למנהל בלבד/.test(r.m), r);
    check('12א אין שגיאות JS', pg.__errors.length === 0, pg.__errors);
    await x.ctx.close(); }

  // ===== 4. שלב ג': שכר חודשי =====
  { const cfg = { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: {} } }, admins: { '|m': 1 } };
    const x = await H.newPage(browser, www, cfg, [], 'm-pmon'); const pg = x.page; await pg.setViewportSize({ width: 412, height: 900 });
    await H.login(pg, 'm@x.co'); if (await pg.$('[data-a=startBlank]')) { await pg.click('[data-a=startBlank]'); await sleep(300); }
    await sleep(1000); await closeD(pg); await seedEmp(pg);
    const M = await pg.evaluate(() => { const emp = S.cats.find((c) => c.kind === 'exp' && !c.hid && c.beh === 'emp');
      S.subs.push({ id: 'pyH1', cat: emp.id, name: 'עובד שעתי', pay: { mode: 'hr', rate: 50, m: 'מזומן', slip: false, uid: '', rules: [], add: [{ id: 'a1', n: 'נסיעות', k: 'day', a: 10 }] } });
      S.subs.push({ id: 'pyH2', cat: emp.id, name: 'עובדת בתלוש', pay: { mode: 'mo', mo: 6000, m: 'העברה', slip: true, uid: '', rules: [], add: [] } });
      save(); return NOWM(); });
    const D2 = M + '-02', D3 = M + '-03';
    const st = () => pg.evaluate(() => { const b = document.querySelector('#main .hero [data-st]'); const k = (n) => { const e = document.querySelector(`#main [data-a=payBrk][data-k=${n}] b`); return e ? e.innerText : null; };
      return { st: b && b.dataset.st, lbl: b && b.innerText, left: k('left'), paid: k('paid'), calc: k('calc') }; });
    const I = (n) => pg.evaluate((v) => ils(v), n);
    const dlgOpen = () => pg.evaluate(() => { const d = document.getElementById('dlg'); return !!(d && d.open); });

    await pg.evaluate(() => go('card', 'pyH1')); await sleep(250);
    const rows = await pg.evaluate(() => [...document.querySelectorAll('#main [data-a=payOpen],#main [data-a=payMonOpen]')].map((b) => b.dataset.a));
    check('20 כרטיס עובד עם הגדרות: שורות "הגדרות שכר" + "שכר חודשי"', rows.join() === 'payOpen,payMonOpen', rows);
    await pg.click('#main [data-a=payMonOpen]'); await sleep(300);
    check('20א נפתח "שכר חודשי" עם החודש הנוכחי כברירת מחדל, בלי שעות – "אין סכום לחודש"', await pg.evaluate((m) => cur().v === 'payMon' && document.querySelector('#main input[data-c=payMonM]').value === m, M) && /אין סכום/.test((await st()).lbl), await st());

    // הזנת שעות
    const addWh = async (d, a, b, brk, n) => { await pg.click('#main [data-a=payWhEd]:not([data-id])'); await sleep(200);
      await pg.fill('#dlg input[name=d]', d); await pg.fill('#dlg input[name=in]', a); await pg.fill('#dlg input[name=out]', b); await pg.fill('#dlg input[name=brk]', brk); await pg.fill('#dlg input[name=n]', n || '');
      await clearT(pg); await pg.click('#dlg form[data-f=payWhF] button[type=submit]'); await sleep(250); };
    await addWh(D2, '08:00', '08:00', '', ''); check('21 כניסה = יציאה – נדחה', /זהות/.test(await toasts(pg)) && await dlgOpen() && await pg.evaluate(() => S.wh.length === 0));
    await pg.fill('#dlg input[name=out]', '16:30'); await pg.fill('#dlg input[name=brk]', 'abc'); await clearT(pg); await pg.click('#dlg form[data-f=payWhF] button[type=submit]'); await sleep(200);
    check('21א הפסקה לא מספר – נדחה', /מספר דקות/.test(await toasts(pg)) && await pg.evaluate(() => S.wh.length === 0));
    await pg.fill('#dlg input[name=brk]', '600'); await clearT(pg); await pg.click('#dlg form[data-f=payWhF] button[type=submit]'); await sleep(200);
    check('21ב הפסקה ארוכה מהמשמרת – נדחה', /ארוכה/.test(await toasts(pg)) && await pg.evaluate(() => S.wh.length === 0));
    await pg.evaluate(() => closeDlg());
    await addWh(D2, '08:00', '16:30', '30', 'קופה');
    await addWh(D3, '22:00', '02:00', '', 'לילה');
    const wh = await pg.evaluate(() => S.wh.map(({ id, ...r }) => r));
    check('22 שעות נשמרו ב-S.wh (src:man, sub, הפסקה כמספר)', JSON.stringify(wh) === JSON.stringify([{ sub: 'pyH1', d: D2, in: '08:00', out: '16:30', brk: 30, src: 'man', n: 'קופה' }, { sub: 'pyH1', d: D3, in: '22:00', out: '02:00', brk: 0, src: 'man', n: 'לילה' }]), wh);
    // 8 ש' + 4 ש' (חצות) = 12 ש' × 50 = 600, נסיעות 10 × 2 ימים = 20 → 620
    let r = await st();
    check('22א "נשאר להעביר" = 620 (12 שעות × 50 + 2 ימים × 10), פתוח', r.st === 'open' && r.left === await I(620) && r.calc === await I(620) && /פתוח/.test(r.lbl), r);
    check('22ב אין גלילה לרוחב ב-412', await noOverflow(pg));

    // מספר לחיץ ← השורות
    await pg.click('#main [data-a=payBrk][data-k=base]'); await sleep(200);
    const bt = await pg.evaluate(() => document.getElementById('dlg').innerText);
    check('23 לחיצה על "בסיס" – השורות שמרכיבות אותו (2 ימים, סה"כ)', await dlgOpen() && /8:00/.test(bt) && /4:00/.test(bt) && /סה״כ/.test(bt), bt); await closeD(pg);

    // בונוס
    await pg.click('#main [data-a=payBonEd]:not([data-id])'); await sleep(200); await pg.fill('#dlg input[name=a]', '100'); await clearT(pg); await pg.click('#dlg form[data-f=payBonF] button[type=submit]'); await sleep(200);
    check('24 בונוס בלי פירוט – נדחה', /חסר פירוט/.test(await toasts(pg)) && await pg.evaluate(() => S.bon.length === 0));
    await pg.fill('#dlg input[name=n]', 'עמידה ביעד'); await pg.click('#dlg form[data-f=payBonF] button[type=submit]'); await sleep(250);
    r = await st();
    check('24א בונוס נשמר ב-S.bon לחודש, ונוסף ל"להעביר" (720)', await pg.evaluate((m) => S.bon.length === 1 && S.bon[0].sub === 'pyH1' && S.bon[0].mon === m && S.bon[0].a === 100 && S.bon[0].n === 'עמידה ביעד', M) && r.left === await I(720), r);
    await pg.click('#main [data-a=payBonEd][data-id]'); await sleep(200); await pg.fill('#dlg input[name=a]', '150'); await pg.click('#dlg form[data-f=payBonF] button[type=submit]'); await sleep(250);
    check('24ב עריכת בונוס – 770', (await st()).left === await I(770) && await pg.evaluate(() => S.bon.length === 1 && S.bon[0].a === 150));

    // עריכת שעות: 16:30 ← 17:00 (+0.5 ש' = 25)
    await pg.click('#main [data-a=payWhEd][data-id]'); await sleep(200); await pg.fill('#dlg input[name=out]', '17:00'); await pg.click('#dlg form[data-f=payWhF] button[type=submit]'); await sleep(250);
    check('25 עריכת שורת שעות – 795, והמזהה נשמר', (await st()).left === await I(795) && await pg.evaluate(() => S.wh.length === 2 && S.wh[0].out === '17:00' && S.wh[0].src === 'man'));
    // שורה מכספית (עתידי): עריכה שומרת את המקור ב-cx
    await pg.evaluate((d) => { S.wh.push({ id: 'pyCX', sub: 'pyH1', d, in: '10:00', out: '11:00', brk: 0, src: 'cx', n: '' }); save(); rerender(); }, M + '-04'); await sleep(150);
    await pg.click('#main [data-a=payWhEd][data-id=pyCX]'); await sleep(200); await pg.fill('#dlg input[name=out]', '12:00'); await pg.click('#dlg form[data-f=payWhF] button[type=submit]'); await sleep(250);
    const cx = await pg.evaluate(() => S.wh.find((w) => w.id === 'pyCX'));
    check('25א שורה מכספית: עריכה שומרת src=cx והמקור ב-cx', cx.src === 'cx' && cx.out === '12:00' && JSON.stringify(cx.cx) === JSON.stringify({ d: M + '-04', in: '10:00', out: '11:00', brk: 0 }), cx);
    await pg.click('#main [data-a=payWhEd][data-id=pyCX]'); await sleep(200); await pg.click('#dlg [data-a=payWhDel]'); await sleep(150); await pg.click('#dlg [data-a=yes]'); await sleep(250);
    check('25ב מחיקת שורת שעות – חוזר ל-795', !(await pg.evaluate(() => S.wh.some((w) => w.id === 'pyCX'))) && (await st()).left === await I(795));
    await pg.evaluate((d) => { S.wh.push({ id: 'pyBad', sub: 'pyH1', d, in: '9', out: '10:00', src: 'man' }); save(); rerender(); }, M + '-05'); await sleep(150);
    check('25ג שורה פגומה: אזהרה מ-PayCore מוצגת, הסכום לא השתנה', /לא תקינה/.test(await pg.evaluate(() => document.querySelector('#main .card .tag.t1').closest('.card').innerText)) && (await st()).left === await I(795));
    await pg.evaluate(() => { S.wh = S.wh.filter((w) => w.id !== 'pyBad'); save(); rerender(); }); await sleep(150);

    // תשלום מהקופה (מקדמה) – הזרימה הקיימת: הוצאה מקופה ← "אשר"
    const ok1 = await pg.evaluate(async () => { const emp = S.cats.find((c) => c.beh === 'emp' && !c.hid);
      S.inbox.push({ id: 'pyI1', by: 'עובד בדיקה', at: new Date().toISOString(), d: { date: today(), reg: true, cat: emp.id, sub: 'pyH1', amt: 300, note: 'מקדמה' } }); save();
      await ACT.inbOk({ dataset: { id: 'pyI1', co: '1', ok: '1' } }); await new Promise((r) => setTimeout(r, 150));
      const t = S.tx.find((y) => y.src === 'pyI1'); return t ? { sub: t.sub, amt: t.amt, plan: t.plan, m: (t.pays || []).map((p) => p.m + p.a).join() } : null; });
    await pg.evaluate(() => { while (NAV.length > 1 && cur().v !== 'payMon') NAV.pop(); if (cur().v !== 'payMon') go('payMon', 'pyH1'); else rerender(); }); await closeD(pg); await sleep(200);
    r = await st();
    check('26 הוצאה מקופה (מקדמה 300) נרשמה כמשכורת במזומן ומורידה: נשאר 495, פתוח', ok1 && ok1.m === 'מזומן300' && ok1.plan === M && r.left === await I(495) && r.paid === await I(300) && r.st === 'open', { ok1, r });
    // רשומות שלא נספרות
    await pg.evaluate((m) => { const emp = S.cats.find((c) => c.beh === 'emp' && !c.hid);
      S.tx.push({ id: 'pyEC', t: 'exp', cat: emp.id, sub: 'pyH1', date: m + '-10', amt: 999, plan: m, ec: 1, psl: 'x', pays: [] });
      S.tx.push({ id: 'pyX', t: 'exp', cat: emp.id, sub: 'pyH1', date: m + '-10', amt: 50, plan: m, x: 1, pays: [] });
      S.tx.push({ id: 'pyO', t: 'exp', cat: emp.id, sub: 'pyE1', date: m + '-10', amt: 70, plan: m, pays: [{ id: 'q', d: m + '-10', a: 70, m: 'מזומן' }] });
      save(); rerender(); }, M); await sleep(150);
    check('26א עלות מעביד (ec), רשומה מבוטלת (x) ועובד אחר – לא נספרים', (await st()).left === await I(495));
    // יתרה בהעברה (צילום העברה – רשומה עם tgrp)
    await pg.evaluate((m) => { const emp = S.cats.find((c) => c.beh === 'emp' && !c.hid);
      S.tx.push({ id: 'pyTR', t: 'exp', cat: emp.id, sub: 'pyH1', date: m + '-11', amt: 495, plan: m, note: '', pays: [{ id: 'pyTRp', d: m + '-11', a: 495, m: 'העברה', grp: 'pyG1' }], tgrp: 'pyG1' }); save(); rerender(); }, M); await sleep(150);
    r = await st();
    check('27 יתרה בהעברה (495) – נשאר 0, "נסגר"', r.st === 'closed' && /נסגר/.test(r.lbl) && r.left === await I(0) && r.paid === await I(795), r);
    await pg.click('#main [data-a=payBrk][data-k=paid]'); await sleep(200);
    const pd = await pg.evaluate(() => [...document.querySelectorAll('#dlg [data-a=tx]')].map((b) => b.dataset.id).sort().join());
    check('27א לחיצה על "שולם" – בדיוק 2 התשלומים (בלי ec/x/עובד אחר)', pd.split(',').length === 2 && pd.includes('pyTR') && !/pyEC|pyX|pyO/.test(pd), pd); await closeD(pg);
    await shot(pg, shots, 'pay-3-שכר-חודשי');
    check('27ב אין גלילה לרוחב ב-412 (מסך מלא)', await noOverflow(pg));
    // ביטול ההעברה (הזרימה הקיימת) ← נפתח שוב
    await pg.evaluate(() => { ACT.grpDel({ dataset: { g: 'pyG1' } }); ACT.yes(); }); await sleep(150);
    await pg.evaluate(() => { if (cur().v !== 'payMon') go('payMon', 'pyH1'); else rerender(); }); await sleep(150);
    r = await st();
    check('28 ביטול צילום העברה מוחק את הרשומה – החודש נפתח שוב (495)', !(await pg.evaluate(() => S.tx.some((t) => t.id === 'pyTR'))) && r.st === 'open' && r.left === await I(495), r);
    // שולם ביתר
    await pg.evaluate((m) => { const emp = S.cats.find((c) => c.beh === 'emp' && !c.hid); S.tx.push({ id: 'pyOV', t: 'exp', cat: emp.id, sub: 'pyH1', date: m + '-12', amt: 500, plan: m, pays: [{ id: 'v', d: m + '-12', a: 500, m: 'מזומן' }] }); save(); rerender(); }, M); await sleep(150);
    r = await st();
    check('29 תשלום גדול מהיתרה – "שולם ביתר" 5', r.st === 'over' && /ביתר/.test(r.lbl) && r.left === await I(5), r);
    await pg.evaluate(() => { S.tx = S.tx.filter((t) => t.id !== 'pyOV'); save(); rerender(); }); await sleep(100);
    // חודש אחר
    await pg.evaluate((m) => { const e = document.querySelector('#main input[data-c=payMonM]'); e.value = addMon(m, -1); e.dispatchEvent(new Event('change', { bubbles: true })); }, M); await sleep(200);
    check('30 מעבר לחודש קודם – אין שעות ואין סכום', /אין סכום/.test((await st()).lbl) && /אין שעות/.test(await pg.evaluate(() => document.getElementById('main').innerText)));

    // עובד בתלוש: בונוס ← לרואה החשבון, לא בחישוב
    await pg.evaluate(() => go('card', 'pyH2')); await sleep(200); await pg.click('#main [data-a=payMonOpen]'); await sleep(250);
    await pg.click('#main [data-a=payBonEd]:not([data-id])'); await sleep(200); await pg.fill('#dlg input[name=a]', '400'); await pg.fill('#dlg input[name=n]', 'חג'); await pg.click('#dlg form[data-f=payBonF] button[type=submit]'); await sleep(250);
    r = await st(); const acc = await pg.evaluate(() => { const h = [...document.querySelectorAll('#main .sec h3')].find((e) => /רואה החשבון/.test(e.innerText)); return h ? h.closest('.sec').nextElementSibling.innerText : null; });
    check('31 עובד בתלוש (חודשי 6000): בונוס לא בחישוב, מופיע ב"להעביר לרואה החשבון"', r.left === await I(6000) && !!acc && /בונוס: חג/.test(acc) && acc.includes(await I(400)), { r, acc });
    // עובד בלי pay – כמו היום
    await pg.evaluate(() => go('card', 'pyE1')); await sleep(200);
    check('32 עובד בלי pay: אין "שכר חודשי", והמסך עצמו לא מחשב', !(await pg.$('#main [data-a=payMonOpen]')) && /אין הגדרות שכר/.test(await pg.evaluate(() => V.payMon('pyE1').h)));
    // פרטיות וגיבוי
    const pv = await pg.evaluate(async () => { const w = JSON.stringify(wvWant()); const b = JSON.parse(await mkBackup(null, { data: S, files: {} })); const back = parseBackup(JSON.stringify(b));
      return { wv: /עמידה ביעד|קופה|לילה|pyH1|חג/.test(w), bk: b.data.wh.length === 2 && b.data.bon.length === 2, rs: back.d.wh.length === 2 && back.d.bon.length === 2 && back.d.wh[0].src === 'man' }; });
    check('33 שעות ובונוסים לא נכנסים למראה לעובדים (wvWant)', pv.wv === false, pv);
    check('33א גיבוי כולל S.wh/S.bon, ושחזור (parseBackup/ensure) מחזיר אותם', pv.bk && pv.rs, pv);
    await pg.reload(); await pg.waitForLoadState('load'); await H.settle(pg, 2000); await closeD(pg);
    check('34 אחרי טעינה מחדש: שעות ובונוסים נשמרו', await pg.evaluate(() => isA() && S.wh.length === 2 && S.bon.length === 2));
    // 19.11 (בעל העסק): הוצאה מקופה לעובד עם הגדרות שכר – מוצע החודש הפתוח הוותיק (מ-3 החודשים הקודמים) כ"חודש משכורת"
    { await pg.evaluate(() => { const emp = S.cats.find((c) => c.beh === 'emp' && !c.hid);
        S.subs.push({ id: 'pyOM', cat: emp.id, name: 'עובד חודש פתוח', pay: { mode: 'mo', mo: 3000, m: 'מזומן', slip: false, uid: '', rules: [], add: [] } });
        ['08', '09'].forEach((m) => S.tx.push({ id: 'pyOM' + m, t: 'exp', cat: emp.id, sub: 'pyOM', date: '2026-' + m + '-28', amt: 3000, plan: '2026-' + m, pays: [{ id: 'p' + m, d: '2026-' + m + '-28', a: 3000, m: 'מזומן' }] }));
        const it = (id, sub, amt, d) => ({ id, by: 'עובד בדיקה', at: d + 'T09:00:00Z', d: { date: d, reg: true, creg: 'i_nl', cat: emp.id, sub, amt, note: 'משכורת ' + id } });
        S.inbox.push(it('pyQ1', 'pyOM', 100, '2026-11-05'), it('pyQ2', 'pyOM', 50, '2026-11-06'), it('pyQ3', 'pyOM', 2950, '2026-11-07'), it('pyQ4', 'pyE1', 70, '2026-11-08'), it('pyQ5', 'pyE1', 80, '2026-11-09'));
        save(); });
      const st = (m) => pg.evaluate((k) => { const s = S.subs.find((x) => x.id === 'pyOM'); const r = PayCore.monthSum(s, k, { wh: S.wh, bon: S.bon, psl: S.psl, tx: S.tx.filter((t) => (cat(t.cat) || {}).beh === 'emp'), pmon }); return r && r.status; }, m);
      const txOf = (src) => pg.evaluate((i) => { const t = S.tx.find((x) => x.src === i); return t ? t.plan : null; }, src);
      check('36 payOpenMon: אוגוסט וספטמבר נסגרו – אוקטובר הוא החודש הפתוח הוותיק; עובד בלי pay – ריק', await pg.evaluate(() => window.payOpenMon('pyOM', '2026-11') === '2026-10' && window.payOpenMon('pyE1', '2026-11') === ''));
      // אישור מהיר (בחירת קטגוריה ועובד): מוצע אוקטובר, שינוי ידני לנובמבר נשמר
      await pg.evaluate(() => ACT.inbOk({ dataset: { id: 'pyQ1', pick: '1' } })); await sleep(200);
      const q1 = await pg.evaluate(() => { const i = document.querySelector('#dlg form[data-f=inbRegF] input[name=pl]'); return { v: i && i.value, n: !!document.querySelector('#dlg [data-plopen]') }; });
      check('37 אישור מהיר: "חודש משכורת" = אוקטובר (החודש הפתוח) עם הסבר', q1.v === '2026-10' && q1.n, q1);
      await pg.fill('#dlg form[data-f=inbRegF] input[name=pl]', '2026-11'); await pg.click('#dlg form[data-f=inbRegF] button:not([type=button])'); await sleep(250);
      check('37א שינוי ידני לנובמבר – נרשם לנובמבר, אוקטובר עדיין פתוח', (await txOf('pyQ1')) === '2026-11' && (await st('2026-10')) === 'open', await txOf('pyQ1'));
      // טופס "בדיקה ושינוי" ← "שמור ואשר": מוצע אוקטובר ונרשם אליו
      await pg.evaluate(() => ACT.inbEdit({ dataset: { id: 'pyQ2' } })); await sleep(200);
      check('38 טופס הבדיקה: "חודש משכורת" = אוקטובר', await pg.evaluate(() => { const i = document.querySelector('#dlg form[data-f=inbsave] input[name=plan]'); return i && i.value; }) === '2026-10');
      await pg.click('#dlg [data-a=inbSaveOk]'); await sleep(300); await closeD(pg);
      check('38א "שמור ואשר" – נרשם לאוקטובר', (await txOf('pyQ2')) === '2026-10', await txOf('pyQ2'));
      // אישור מהיר בלי שינוי – יתרת אוקטובר (2950) ← אוקטובר נסגר
      await pg.evaluate(() => ACT.inbOk({ dataset: { id: 'pyQ3', pick: '1' } })); await sleep(200);
      check('39 אישור מהיר בלי שינוי: מוצע אוקטובר', await pg.evaluate(() => document.querySelector('#dlg input[name=pl]').value) === '2026-10');
      await pg.click('#dlg form[data-f=inbRegF] button:not([type=button])'); await sleep(250);
      check('39א נרשם לאוקטובר, ואוקטובר נסגר; עכשיו אין חודש פתוח', (await txOf('pyQ3')) === '2026-10' && (await st('2026-10')) === 'closed' && await pg.evaluate(() => window.payOpenMon('pyOM', '2026-11') === ''), await st('2026-10'));
      // עובד בלי pay – חודש התשלום, כמו היום
      await pg.evaluate(() => ACT.inbOk({ dataset: { id: 'pyQ4', pick: '1' } })); await sleep(200);
      await pg.evaluate(() => { const s = document.querySelector('#dlg select[name=sub]'); s.value = 'pyE1'; s.dispatchEvent(new Event('change', { bubbles: true })); }); await sleep(200);
      const q4 = await pg.evaluate(() => ({ v: document.querySelector('#dlg input[name=pl]').value, n: !!document.querySelector('#dlg [data-plopen]') }));
      check('40 עובד בלי pay, אישור מהיר: חודש התשלום (נובמבר), בלי הסבר', q4.v === '2026-11' && !q4.n, q4);
      await pg.click('#dlg form[data-f=inbRegF] button:not([type=button])'); await sleep(250);
      check('40א עובד בלי pay – נרשם לחודש התשלום', (await txOf('pyQ4')) === '2026-11');
      await pg.evaluate(() => ACT.inbEdit({ dataset: { id: 'pyQ5' } })); await sleep(200);
      check('40ב עובד בלי pay, טופס הבדיקה: חודש התשלום', await pg.evaluate(() => document.querySelector('#dlg form[data-f=inbsave] input[name=plan]').value) === '2026-11');
      await pg.click('#dlg [data-a=inbSaveOk]'); await sleep(300); await closeD(pg);
      check('40ג "שמור ואשר" – נרשם לחודש התשלום', (await txOf('pyQ5')) === '2026-11');
      await shot(pg, shots, 'pay-4-חודש-פתוח');
      // עובד חודשי חדש (הגדרות נשמרו עכשיו): from = החודש הנוכחי ← החודשים שלפני לא מוצעים, תשלום מקופה = חודש התשלום
      await pg.evaluate(() => { const emp = S.cats.find((c) => c.beh === 'emp' && !c.hid); S.subs.push({ id: 'pyNM', cat: emp.id, name: 'עובד חודשי חדש' }); save(); go('card', 'pyNM'); }); await sleep(250);
      await pg.click('#main [data-a=payOpen]'); await sleep(250); await pg.click('[data-a=payMode][data-v=mo]'); await sleep(150);
      check('41 בהגדרות יש שדה "שכר החל מחודש" (ריק לעובד חדש)', await pg.evaluate(() => { const i = document.querySelector('#main input[name=from]'); return !!i && i.value === ''; }));
      await pg.fill('input[name=mo]', '3000'); await save(pg); await sleep(300);
      const nm = await pg.evaluate(() => { const s = S.subs.find((x) => x.id === 'pyNM'), M = NOWM(); return { from: s.pay.from, M, open: window.payOpenMon('pyNM', M) }; });
      check('41א עובד חודשי חדש: from = החודש הנוכחי, ואין חודש קודם פתוח', nm.from === nm.M && nm.open === '', nm);
      await pg.evaluate(() => { const emp = S.cats.find((c) => c.beh === 'emp' && !c.hid); S.inbox.push({ id: 'pyQ6', by: 'עובד בדיקה', at: new Date().toISOString(), d: { date: today(), reg: true, creg: 'i_nl', cat: emp.id, sub: 'pyNM', amt: 500, note: 'מקדמה' } }); save(); ACT.inbOk({ dataset: { id: 'pyQ6', pick: '1' } }); }); await sleep(200);
      check('41ב תשלום מקופה: מוצע חודש התשלום (לא 3 חודשים אחורה), בלי הסבר', await pg.evaluate(() => document.querySelector('#dlg input[name=pl]').value === NOWM() && !document.querySelector('#dlg [data-plopen]')));
      await pg.click('#dlg form[data-f=inbRegF] button:not([type=button])'); await sleep(250);
      check('41ג נרשם לחודש התשלום', (await txOf('pyQ6')) === await pg.evaluate(() => NOWM()));
      await pg.evaluate(() => { go('payMon', 'pyNM'); const e = document.querySelector('#main input[data-c=payMonM]'); e.value = addMon(NOWM(), -1); e.dispatchEvent(new Event('change', { bubbles: true })); }); await sleep(200);
      check('41ד במסך השכר החודשי, חודש לפני from: הערה "לפני תחילת השכר"', await pg.evaluate(() => /לפני תחילת השכר/.test((document.querySelector('#main [data-prefrom]') || {}).innerText || '')));
      await pg.evaluate(() => { const e = document.querySelector('#main input[data-c=payMonM]'); e.value = NOWM(); e.dispatchEvent(new Event('change', { bubbles: true })); }); await sleep(200);
      check('41ה בחודש from עצמו – בלי ההערה', await pg.evaluate(() => !document.querySelector('#main [data-prefrom]')));
    }
    check('35 אין שגיאות JS', pg.__errors.length === 0, pg.__errors);
    await x.ctx.close(); }

  await browser.close();
  console.log(fail ? `נכשלו ${fail} בדיקות` : 'כל הבדיקות עברו');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
