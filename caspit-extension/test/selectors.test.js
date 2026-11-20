'use strict';
// מריץ צעדי המסך בדפדפן אמיתי (Chromium של Playwright) על דף בדיקה
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const SRC = fs.readFileSync(path.join(__dirname, '../src/lib/selectors.js'), 'utf8');
const SEL = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/selectors.json'), 'utf8'));
const SEL_DENY = require('../src/lib/selectors.js').DENY_HE;
const HTML = `<!doctype html><html dir="rtl"><body>
<nav><span>ממשקים</span><div id="sub" hidden><a href="#/rep">דוח מכירות לפריטים</a></div></nav>
<div class="menu"><div><button id="exp1">ייצוא לאקסל</button></div><button style="display:none">ייצוא לאקסל נסתר</button></div>
<button aria-label="סגור חלון">x</button>
<select id="kind"><option value="">בחר</option><option value="1">טעינת פריטים חדשים</option><option value="2">עדכון מחיר לצרכן ו/או מחיר עלות לפריטים</option></select>
<div id="dd" role="combobox">בחר סוג</div><ul id="opts" hidden><li role="option">אפשרות א</li><li role="option">אפשרות ב</li></ul>
<table><tr><td><a href="#/cust/7">ישראל ישראלי</a></td></tr></table>
<input type="date" id="from"><input type="text" id="to" placeholder="עד תאריך">
<input type="file" id="f"><button id="go">טען קובץ</button><div id="res" role="alert"></div>
<form><input name="user" value="owner1"><input type="password" name="pw" value="secret1"></form>
<script>
window.ev=[];
document.querySelector('nav span').onclick=()=>{document.getElementById('sub').hidden=false};
document.getElementById('exp1').onclick=()=>ev.push('exp');
document.getElementById('dd').onclick=()=>{document.getElementById('opts').hidden=false};
document.querySelectorAll('#opts li').forEach(li=>li.onclick=()=>ev.push('opt:'+li.textContent));
document.getElementById('kind').addEventListener('change',e=>ev.push('kind:'+e.target.value));
['from','to'].forEach(id=>document.getElementById(id).addEventListener('change',e=>ev.push(id+':'+e.target.value)));
document.getElementById('f').addEventListener('change',async e=>{const f=e.target.files[0];ev.push('file:'+f.name+':'+(await f.text()))});
document.getElementById('go').onclick=()=>{ev.push('go');setTimeout(()=>{document.getElementById('res').textContent='הטעינה הסתיימה: 2 פריטים נטענו'},200)};
</script></body></html>`;

let browser, page;
test.before(async () => {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
});
test.after(async () => { await browser.close(); });
test.beforeEach(async () => { await page.setContent(HTML); await page.addScriptTag({ content: SRC }); });
const run = (steps, extra) => page.evaluate(([s, x]) => window.CxSel.runSteps(s, Object.assign({ doc: document, win: window, sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 30))) }, x)), [steps, extra || {}]);
const ev = () => page.evaluate(() => window.ev);

test('find: טקסט מדויק, הרכיב הקטן ביותר, בלי רכיבים נסתרים, aria', async () => {
  const r = await page.evaluate(() => {
    const S = window.CxSel;
    return [S.find(document, { text: 'ייצוא לאקסל' }).id, S.find(document, { textAny: ['לא קיים', 'ייצוא'] }).id, S.find(document, { text: 'ייצוא לאקסל נסתר' }), S.find(document, { aria: 'סגור' }).tagName, S.find(document, { css: 'input', nth: 1 }).id];
  });
  assert.deepEqual(r, ['exp1', 'exp1', null, 'BUTTON', 'to']);
});

test('ייבוא: בחירת אפשרות לפי הטקסט, קובץ דרך DataTransfer, לחיצה, קריאת התוצאה', async () => {
  // הזרימה האמיתית (#job_type) נבדקת ב-e2e; כאן – אותם סוגי צעדים על <select> רגיל
  const flow = [{ op: 'select', t: { css: '#kind' }, option: 'עדכון מחיר לצרכן ו/או מחיר עלות לפריטים' }, { op: 'setFile', t: { css: 'input[type=file]' }, file: 'csv' },
    { op: 'click', t: { text: 'טען קובץ' }, submit: true, wait: 300 }, { op: 'waitFor', t: { textAny: ['הסתיימה'] }, ms: 5000 }, { op: 'text', t: { css: '[role=alert]' }, optional: true }];
  const r = await run(flow, { files: { csv: { name: 'p.csv', mime: 'text/csv', b64: Buffer.from('קוד,מחיר\n1,2\n').toString('base64') } } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.text, /הסתיימה/);
  const e = await ev();
  assert.ok(e.includes('kind:2'), e.join('|'));
  assert.ok(e.includes('go'));
  assert.ok(e.some((x) => x === 'file:p.csv:קוד,מחיר\n1,2\n'), e.join('|'));
  const r2 = await run([{ op: 'select', t: { css: '#kind' }, option: 'טעינת פריטים חדשים' }]);
  assert.equal(r2.ok, true);
  assert.ok((await ev()).includes('kind:1'));
});

test('רשימה נפתחת שאינה select, תפריט ממשקים, תאריכים', async () => {
  const r = await run([
    { op: 'select', t: { css: '#dd' }, option: 'אפשרות ב' },
    { op: 'click', t: { text: 'ממשקים' } },
    { op: 'waitFor', t: { text: 'דוח מכירות לפריטים' }, ms: 2000 },
    { op: 'setDate', t: { css: '#from' }, value: '{day}' },
    { op: 'setDate', t: { css: '#to' }, value: '{day}' },
  ], { vars: { day: '2026-11-17' } });
  assert.equal(r.ok, true, JSON.stringify(r));
  const e = await ev();
  assert.ok(e.includes('opt:אפשרות ב'));
  assert.ok(e.includes('from:2026-11-17'));
  assert.ok(e.includes('to:17/11/2026'));
});

test('רכיב חסר → miss עם מספר הצעד; nav משנה את ה-hash; צעד לא מוכר נדחה', async () => {
  const r = await run([{ op: 'nav', hash: '#/catalogs', ms: 10 }, { op: 'click', t: { text: 'כפתור שלא קיים' }, ms: 300 }, { op: 'click', t: { text: 'ממשקים' } }]);
  assert.equal(r.ok, false);
  assert.equal(r.miss, 1);
  assert.equal(await page.evaluate(() => location.hash), '#/catalogs');
  assert.ok(!(await ev()).length);
  const bad = await run([{ op: 'eval', code: 'alert(1)' }]);
  assert.equal(bad.ok, false);
  assert.equal(bad.steps[0].err, 'bad-op');
  const badHash = await run([{ op: 'nav', hash: 'javascript:alert(1)' }]);
  assert.equal(badHash.steps[0].err, 'bad-hash');
});

test('מצב היכרות (probe): לא לוחץ על submit ולא משנה שדות; לוחץ רק על safe; מדווח מה נמצא', async () => {
  const r = await run([
    { op: 'click', t: { text: 'ממשקים' }, safe: true },
    { op: 'select', t: { css: '#kind' }, option: 'טעינת פריטים חדשים' },
    { op: 'setDate', t: { css: '#from' }, value: '2026-11-17' },
    { op: 'click', t: { text: 'טען קובץ' }, submit: true, safe: true },
    { op: 'click', t: { text: 'לא קיים' }, ms: 200 },
    { op: 'click', t: { text: 'ייצוא לאקסל' }, safe: true },
  ], { probe: true });
  assert.deepEqual(r.steps.map((s) => s.found), [true, true, true, true, false, true]);
  assert.deepEqual(r.steps.map((s) => s.done), [true, false, false, false, false, true]);
  assert.equal(r.miss, 4);
  assert.deepEqual(await ev(), ['exp']);
  assert.equal(await page.evaluate(() => document.getElementById('kind').value), '');
});

test('לעולם לא נוגע בשדה סיסמה', async () => {
  const r = await run([{ op: 'setDate', t: { css: 'input[type=password]' }, value: '2026-11-17' }]);
  assert.equal(r.ok, false);
  assert.equal(r.steps[0].err, 'password-field');
  assert.equal(await page.evaluate(() => document.querySelector('[name=pw]').value), 'secret1');
});

test('guard: דף שאינו המשרד האחורי (/bo) – אף צעד לא מבוצע, wrong', async () => {
  const r = await page.evaluate(async () => { window.ev.length = 0; return window.CxSel.runSteps([{ op: 'click', t: { text: 'ייצוא לאקסל' }, safe: true }], { doc: document, win: window, guard: { origin: 'https://caspit.valu.co.il', path: '/bo' }, sleep: () => Promise.resolve() }); });
  assert.equal(r.ok, false); assert.equal(r.wrong, true); assert.equal(r.steps[0].err, 'wrong-page');
  assert.deepEqual(await page.evaluate(() => window.ev), [], 'לא נלחץ כלום');
  assert.equal(await page.evaluate(() => window.CxSel.onPath({ location: { origin: 'https://caspit.valu.co.il', pathname: '/bo' } }, { origin: 'https://caspit.valu.co.il', path: '/bo' })), true);
  assert.equal(await page.evaluate(() => window.CxSel.onPath({ location: { origin: 'https://caspit.valu.co.il', pathname: '/csv-imports' } }, { origin: 'https://caspit.valu.co.il', path: '/bo' })), false);
  assert.equal(await page.evaluate(() => window.CxSel.onPath({ location: { origin: 'https://caspit.valu.co.il', pathname: '/bogus' } }, { origin: 'https://caspit.valu.co.il', path: '/bo' })), false);
});

test('monthYear: עברית, אנגלית, מספרים', async () => {
  const r = await page.evaluate(() => [window.CxSel.monthYear('נובמבר 2026'), window.CxSel.monthYear('January 2027'), window.CxSel.monthYear('3/2026'), window.CxSel.monthYear('xx'), window.CxSel.monthYear('נוב 2026'), window.CxSel.monthYear('דצמ׳ 2026'), window.CxSel.monthYear('\u200fינו 2027'), window.CxSel.monthYear('מאי 2026'), window.CxSel.monthYear('Nov 2026')]);
  assert.deepEqual(r, [{ y: 2026, m: 10 }, { y: 2027, m: 0 }, { y: 2026, m: 2 }, null, { y: 2026, m: 10 }, { y: 2026, m: 11 }, { y: 2027, m: 0 }, { y: 2026, m: 4 }, { y: 2026, m: 10 }]);
});

test('controls: בלי ערכים ובלי שדות סיסמה; isLogin מזהה שדה סיסמה', async () => {
  const c = await page.evaluate(() => window.CxSel.controls(document));
  const s = JSON.stringify(c);
  assert.ok(!s.includes('owner1') && !s.includes('secret1'));
  assert.ok(!c.some((x) => x.type === 'password'));
  assert.ok(c.find((x) => x.tag === 'select').options.includes('טעינת פריטים חדשים'));
  assert.ok(c.find((x) => x.text === 'ייצוא לאקסל'));
  assert.ok(!s.includes('ישראל ישראלי') && c.some((x) => x.inData), 'טקסט בתוך טבלה (שמות) לא נאסף');
  assert.equal(await page.evaluate(() => window.CxSel.isLogin(document, window, {})), true);
  // שדה סיסמה בתוך המערכת המחוברת (יש תפריט "ממשקים") – לא דף התחברות
  assert.equal(await page.evaluate(() => window.CxSel.isLogin(document, window, { shell: { text: 'ממשקים' } })), false);
  assert.equal(await page.evaluate(() => { location.hash = '#/login'; return window.CxSel.isLogin(document, window, { hash: ['#/login'], shell: { text: 'ממשקים' } }); }), true);
  await page.evaluate(() => { location.hash = ''; });
  await page.evaluate(() => document.querySelector('form').remove());
  assert.equal(await page.evaluate(() => window.CxSel.isLogin(document, window, { hash: ['#/login'] })), false);
});

test('selectors.json: דפי ההיכרות – זרימות קיימות; עובדים לקריאה בלבד; שעות לעובד – זרימה בטוחה שרצה רק בהיכרות', () => {
  for (const pg of SEL.disc) if (pg.flow) assert.ok(Array.isArray(SEL.flows[pg.flow]), pg.name);
  const emp = SEL.disc.find((p) => p.name === 'employees');
  assert.ok(emp);
  assert.equal(emp.flow, undefined); assert.equal(emp.peek, undefined); assert.equal(emp.hash, '#/employees'); assert.equal(emp.btn, true);
  for (const n of ['hours', 'on-shift', 'attendance']) assert.ok(!SEL.disc.some((p) => p.name === n), n);
  const eh = SEL.disc.find((p) => p.name === 'emp-hours');
  assert.equal(eh.flow, 'empHours'); assert.equal(eh.priv, true);
  const F = SEL.flows.empHours;
  assert.equal(F[0].op, 'nav'); assert.equal(F[0].hash, '#/employees');
  // אסור ללחוץ: עריכה, עובד חדש, הוספת כניסה ויציאה; "יצוא לאקסל" רק בדף השעות (at) ורק אחרי שהגענו אליו (stop)
  const words = JSON.stringify(F.filter((x) => x.op === 'click').map((x) => x.t));
  for (const w of ['עריכה', 'עובד חדש', 'הוספת כניסה ויציאה', 'הצג רק מנהלים']) assert.ok(!words.includes(w), w);
  assert.ok(F.every((x) => x.op !== 'click' || (x.safe && !x.submit)));
  const xl = F.find((x) => x.capture);
  assert.equal(xl.at, '#/employee-time-tracks/'); assert.equal(xl, F[F.length - 1]);
  assert.ok(F.find((x) => x.op === 'waitFor' && JSON.stringify(x.t).includes('הוספת כניסה ויציאה')).stop);
  // פרטיות: לא מחכים על הכותרת עם שם העובד
  assert.ok(!JSON.stringify(F).includes('דוח שעות עובד'));
  assert.equal(SEL.v, 6);
});

test('selectors.json v6: לקוחות הקפה – 8 מסכים priv בכתובת ישירה; hkExport לוחץ רק "יצוא לאקסל"; הפקת חשבוניות מרכזות – בלי זרימה', () => {
  const H = ['#/hakafa-customers', '#/hakafa-reports', '#/hakafa-customer-reports', '#/customer-sales-report', '#/total-sales-per-customer', '#/hakafa_monthly_charge_customers', '#/merakez_invoices', '#/customer-shipments'];
  const P = SEL.disc.filter((p) => /^hk-/.test(p.name));
  assert.deepEqual(P.map((p) => p.hash), H);
  assert.ok(P.every((p) => p.priv === true && !p.peek && (!p.flow || p.flow === 'hkExport')));
  assert.equal(P.find((p) => p.hash === '#/hakafa_monthly_charge_customers').flow, undefined);
  const F = SEL.flows.hkExport;
  assert.equal(F.length, 1); assert.equal(F[0].op, 'click'); assert.equal(F[0].at, '{hash}'); assert.ok(F[0].capture && F[0].safe && F[0].stop && !F[0].submit);
  assert.ok(F[0].t.textAny.every((x) => /^(ייצוא|יצוא) ל-?(אקסל|Excel)$/.test(x)), JSON.stringify(F[0].t));
  // כל צעד click בכל הזרימות לא מכוון לכפתור עם מילה אסורה (אחרת denied היה חוסם אותו בהיכרות)
  for (const [n, fl] of Object.entries(SEL.flows)) for (const x of fl) if (x.op === 'click' && x.safe) for (const t of x.t.textAny || [x.t.text || '']) assert.ok(!SEL_DENY.some((w) => t.includes(w)), n + ': ' + t);
});

test('denied (0.1.11): בהיכרות לא לוחצים על שמירה / מחיקה / הפקה / טעינה – גם בצעד safe; מחוץ להיכרות – בלי שינוי', async () => {
  await page.evaluate(() => {
    const d = document.createElement('div'); d.id = 'dn';
    d.innerHTML = ['שמירה ויצוא לאקסל', 'מחיקה', 'הפקת חשבוניות מרכזות', 'טעינת לקוחות', 'ייצוא לאקסל של לקוחות', 'Save', 'יצוא לאקסל ושליחה במייל', 'הנפקת חשבונית', 'ביצוע חיוב', 'שלח ב-Email'].map((x, k) => '<button id="dn' + k + '">' + x + '</button>').join('');
    document.body.appendChild(d);
    d.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => window.ev.push('dn:' + b.id)));
  });
  for (const [k, txt] of [[0, 'שמירה ויצוא לאקסל'], [1, 'מחיקה'], [2, 'הפקת חשבוניות מרכזות'], [3, 'טעינת לקוחות'], [5, 'Save'], [6, 'יצוא לאקסל ושליחה במייל'], [7, 'הנפקת חשבונית'], [8, 'ביצוע חיוב'], [9, 'שלח ב-Email']]) {
    const r = await run([{ op: 'click', t: { text: txt, tag: 'button' }, safe: true }, { op: 'click', t: { text: 'ייצוא לאקסל של לקוחות', tag: 'button' }, safe: true }], { probe: true });
    assert.equal(r.steps[0].err, 'denied', txt); assert.equal(r.ok, false); assert.equal(r.steps.length, 1, 'הזרימה נעצרה – ' + k);
  }
  assert.deepEqual((await ev()).filter((x) => x.startsWith('dn:')), [], 'שום כפתור לא נלחץ');
  const r = await run([{ op: 'click', t: { text: 'ייצוא לאקסל של לקוחות', tag: 'button' }, safe: true }], { probe: true });
  assert.equal(r.ok, true);
  assert.deepEqual((await ev()).filter((x) => x.startsWith('dn:')), ['dn:dn4']);
  // "יצוא לאקסל" שמוכל ב"יצוא לאקסל ושליחה במייל" (התאמה חלקית, כמו hkExport) – נחסם
  const r2 = await run([{ op: 'click', t: { textAny: ['יצוא לאקסל'], tag: 'button#dn6' }, safe: true }], { probe: true });
  assert.equal(r2.steps[0].err, 'denied', JSON.stringify(r2.steps[0]));
  assert.deepEqual((await ev()).filter((x) => x.startsWith('dn:')), ['dn:dn4'], 'השליחה במייל לא נלחצה');
  // at "{hash}" (hkExport): לא במסך שההיכרות עברה אליו (המעבר נכשל) / בלי המשתנה – לא לוחצים
  for (const vars of [{ hash: '#/hakafa-customers' }, {}]) {
    const r3 = await run([{ op: 'click', at: '{hash}', t: { text: 'ייצוא לאקסל של לקוחות', tag: 'button' }, safe: true }], { probe: true, vars });
    assert.equal(r3.steps[0].err, 'wrong-hash', JSON.stringify(vars));
  }
  await page.evaluate(() => { location.hash = '#/hakafa-customers'; });
  const r4 = await run([{ op: 'click', at: '{hash}', t: { text: 'ייצוא לאקסל של לקוחות', tag: 'button' }, safe: true }], { probe: true, vars: { hash: '#/hakafa-customers' } });
  assert.equal(r4.ok, true);
  assert.deepEqual((await ev()).filter((x) => x.startsWith('dn:')), ['dn:dn4', 'dn:dn4']);
  await page.evaluate(() => document.getElementById('dn').remove());
});

test('click עם check: תיבת סימון דרך התווית – מסמנים רק אם לא מסומנת; at/stop עוצרים גם בהיכרות', async () => {
  await page.evaluate(() => {
    const d = document.createElement('div');
    d.innerHTML = '<div class="custom-control"><input type="checkbox" id="cb1" class="custom-control-input"><label class="custom-control-label" for="cb1">הצג רק עובדים פעילים</label></div><span id="s2"><input type="checkbox" id="cb2"><span>תיבה ב</span></span>';
    document.body.appendChild(d);
    document.getElementById('cb1').addEventListener('change', () => window.ev.push('cb1'));
  });
  const T = { op: 'click', t: { textAny: ['הצג רק עובדים פעילים'], tag: 'label,span,div' }, check: true, safe: true };
  let r = await run([T], { probe: true });
  assert.equal(r.ok, true); assert.equal(await page.evaluate(() => document.getElementById('cb1').checked), true);
  r = await run([T], { probe: true });
  assert.equal(r.steps[0].already, true);
  assert.equal(await page.evaluate(() => document.getElementById('cb1').checked), true, 'לחיצה שנייה לא מבטלת את הסימון');
  assert.deepEqual(await ev(), ['cb1']);
  await run([{ op: 'click', t: { text: 'תיבה ב', tag: 'span' }, check: true, safe: true }], { probe: true });
  assert.equal(await page.evaluate(() => document.getElementById('cb2').checked), true, 'תיבה ליד טקסט (בלי label)');
  // stop: רכיב חסר עוצר; הצעד שאחריו (ייצוא) לא רץ
  r = await run([{ op: 'waitFor', t: { text: 'הוספת כניסה ויציאה' }, ms: 100, stop: true }, { op: 'click', t: { text: 'ייצוא לאקסל' }, safe: true }], { probe: true });
  assert.equal(r.ok, false); assert.equal(r.steps.length, 1);
  // at: לא בדף הנכון – לא לוחצים
  r = await run([{ op: 'click', at: '#/employee-time-tracks/', t: { text: 'ייצוא לאקסל' }, safe: true }], { probe: true });
  assert.equal(r.steps[0].err, 'wrong-hash');
  assert.deepEqual(await ev(), ['cb1'], 'הייצוא לא נלחץ');
});

test('controls במצב noText (דף לקריאה בלבד): בלי טקסט, בלי aria ובלי אפשרויות – רק מספרן', async () => {
  const c = await page.evaluate(() => window.CxSel.controls(document, 400, { noText: true }));
  const s = JSON.stringify(c);
  assert.ok(!s.includes('טעינת פריטים חדשים') && !s.includes('ייצוא לאקסל') && !s.includes('סגור חלון'), s);
  assert.equal(c.find((x) => x.tag === 'select').optN, 3);
  assert.ok(c.filter((x) => x.href).every((x) => x.href === '(int)' || x.href === '(ext)'));
  // btn: רק כפתורים עם מילת פעולה, מחוץ לטבלאות
  const b = await page.evaluate(() => window.CxSel.controls(document, 400, { noText: true, btn: true }));
  assert.ok(b.every((x) => x.text === undefined || /יצוא|ייצוא|הצג|קובץ|דוח|סנן/.test(x.text)), JSON.stringify(b.filter((x) => x.text)));
  assert.ok(!JSON.stringify(b).includes('סגור חלון'));
  // שמות ושעות על כפתורים: נשמרות רק מילות הפעולה עצמן (התאמה מלאה של מילה)
  const t = await page.evaluate(() => {
    const box = document.createElement('div'); box.id = 'btnt';
    box.innerHTML = ['אבי צור', 'משה בן צור', 'רונית נבחרה', 'דני כהן הצג פרטים', 'הצג 08:02-16:00', 'ייצוא לאקסל'].map((x, k) => '<button id="bt' + k + '">' + x + '</button>').join('');
    document.body.appendChild(box);
    const r = window.CxSel.controls(document, 400, { noText: true, btn: true }).filter((x) => /^button#bt\d$/.test(x.css)).map((x) => [x.css, x.text]);
    box.remove(); return r;
  });
  const T = JSON.stringify(t);
  for (const nm of ['אבי', 'משה', 'רונית', 'נבחרה', 'דני', 'כהן', 'פרטים', '08', '16']) assert.ok(!T.includes(nm), nm + ' ' + T);
  assert.deepEqual(Object.fromEntries(t), { 'button#bt0': 'צור', 'button#bt1': 'צור', 'button#bt2': undefined, 'button#bt3': 'הצג', 'button#bt4': 'הצג', 'button#bt5': 'ייצוא לאקסל' });
});
