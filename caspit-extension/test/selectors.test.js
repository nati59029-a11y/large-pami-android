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
  assert.equal(SEL.v, 10); // 0.1.21: hkSnap
});

test('selectors.json v9 (0.1.14): זרימות השעות – רק קריאה; לא לוחצים "עריכה" / "עובד חדש" / "הוספת כניסה ויציאה" / "הצג רק מנהלים" / יצוא של הרשימה', () => {
  const L = SEL.flows.hrsList, G = SEL.flows.hrsPage, X = SEL.flows.hrsExport;
  assert.deepEqual(L.map((x) => x.op), ['nav', 'waitFor', 'click']); assert.equal(L[0].hash, '#/employees');
  assert.equal(L[2].check, true); assert.match(JSON.stringify(L[2].t), /הצג רק עובדים פעילים/);
  const all = [...L, ...G, ...X];
  const words = JSON.stringify(all.filter((x) => x.op === 'click').map((x) => x.t));
  for (const w of ['עריכה', 'עובד חדש', 'הוספת כניסה ויציאה', 'הצג רק מנהלים']) assert.ok(!words.includes(w), w);
  assert.ok(all.every((x) => x.op !== 'click' || (x.safe && !x.submit)), 'כל לחיצה safe (רצות במצב probe – denied)');
  assert.ok(G.every((x) => x.op === 'waitFor' && x.stop && x.at === '#/employee-time-tracks/'));
  assert.deepEqual(X.map((x) => [x.op, x.at, !!x.capture, !!x.stop]), [['click', '#/employee-time-tracks/', true, true]], '"יצוא לאקסל" רק בדף השעות');
  assert.ok(!JSON.stringify(all).includes('דוח שעות עובד'));
  assert.ok(SEL.hours.max > 0 && SEL.hours.max <= 500);
  // denied לא חוסם את מה שצריך ללחוץ
  const S = require('../src/lib/selectors.js');
  const fake = (t) => ({ innerText: t, textContent: t, getAttribute: () => null });
  for (const t of ['שעות לעובד', 'יצוא לאקסל', 'הצג רק עובדים פעילים']) assert.equal(S.denied(fake(t)), false, t);
  for (const t of ['עריכה', 'עובד חדש', 'הוספת כניסה ויציאה']) assert.equal(S.denied(fake(t)), true, t);
});

test('selectors.json v6: לקוחות הקפה – 8 מסכים priv בכתובת ישירה; hkExport לוחץ רק "יצוא לאקסל"; הפקת חשבוניות מרכזות – בלי זרימה', () => {
  const H = ['#/hakafa-customers', '#/hakafa-reports', '#/hakafa-customer-reports', '#/customer-sales-report', '#/total-sales-per-customer', '#/hakafa_monthly_charge_customers', '#/merakez_invoices', '#/customer-shipments', '#/total-sales-all-customers'];
  const P = SEL.disc.filter((p) => /^hk-/.test(p.name));
  assert.deepEqual(P.map((p) => p.hash), H);
  assert.ok(P.every((p) => p.priv === true && !p.peek && (!p.flow || p.flow === 'hkExport' || (p.flow === 'hkDocs' && p.docs === true))));
  // 0.1.13: מסמכי ההקפה – hkDocs (טווח תאריכים ב-vdp-datepicker, "הצג" / "חפש" בלבד, יצוא אם יש); בלי בחירת לקוח
  assert.deepEqual(P.filter((p) => p.flow === 'hkDocs').map((p) => p.hash), ['#/customer-sales-report', '#/total-sales-per-customer', '#/merakez_invoices', '#/customer-shipments', '#/total-sales-all-customers']);
  const K = SEL.flows.hkDocs;
  assert.deepEqual(K.map((x) => x.op), ['setDate', 'setDate', 'click', 'click']);
  assert.ok(K.every((x) => x.safe && !x.submit));
  assert.ok(K.filter((x) => x.op === 'setDate').every((x) => x.t.css === '.vdp-datepicker input' && !x.t.alt), 'תאריכים רק דרך vdp-datepicker');
  assert.deepEqual(K[2].t.textAny, ['הצג', 'חפש', 'חיפוש']); assert.ok(K[2].optional && !K[2].capture);
  assert.ok(K[3].capture && K[3].at === '{hash}');
  assert.ok(!JSON.stringify(K).includes('לקוח'), 'לא בוחרים לקוח');
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

test('selectors.json v7 (0.1.12): מסך הייבוא בהיכרות – קריאה בלבד (בלי זרימה, בלי peek), זרימות הייבוא לא השתנו', () => {
  const p = SEL.disc.find((x) => x.name === 'imp-screen');
  assert.ok(p);
  assert.equal(p.hash, '#/csv-imports'); assert.equal(p.imp, true);
  assert.equal(p.flow, undefined); assert.equal(p.peek, undefined); assert.equal(p.find, undefined);
  assert.equal(SEL.flows.importNew.find((x) => x.op === 'nav').hash, p.hash, 'אותו מסך כמו importNew');
  assert.equal(SEL.flows.importPrice.find((x) => x.op === 'nav').hash, p.hash, 'אותו מסך כמו importPrice');
  assert.equal(SEL.importEnabled, true, 'ההעלאה האוטומטית נשארת פועלת');
  // מבצעים: "כרטיס הטבות" ← "מבצעים" (רק טקסט מלא – לא "הוסף מבצע"), הזרימה היחידה – hkExport ("יצוא לאקסל" בלבד), לא priv
  const pr = SEL.disc.find((x) => x.name === 'promos');
  assert.deepEqual(pr.menu, ['כרטיס הטבות']); assert.deepEqual(pr.find, ['מבצעים']);
  assert.equal(pr.flow, 'hkExport'); assert.equal(pr.promo, true); assert.equal(pr.priv, undefined); assert.equal(pr.hash, undefined);
  // 0.1.13: אמצעי תשלום לפי hash ישיר (בלי findAll), רק hkExport
  assert.ok(!SEL.disc.some((x) => x.findAll), 'בלי findAll');
  const py = SEL.disc.filter((x) => x.pay);
  assert.deepEqual(py.map((x) => x.hash), ['#/payment-reports', '#/payment-report-hos', '#/rikuz-reports', '#/payments-by-categories-reports', '#/xreports']);
  assert.ok(py.every((x) => x.flow === 'hkExport' && !x.priv && /^pay-/.test(x.name)));
  assert.deepEqual(SEL.branch.names, ['יהודה הנשיא', 'נחל לכיש']);
  assert.ok(!JSON.stringify(SEL.flows).includes('יהודה הנשיא') && !JSON.stringify(SEL.flows).includes('נחל לכיש'), 'אף זרימה לא נוגעת בבחירת הסניף');
  // 0.1.13: החלפת סניף – רק דרך branch.switch (home / also), ובהיכרות רק discBranch (לקוחות)
  assert.equal(SEL.branch.home, 'יהודה הנשיא'); assert.deepEqual(SEL.branch.also, ['נחל לכיש']);
  assert.equal(SEL.branch.switch.field, '#store-switch-field');
  assert.deepEqual(SEL.discBranch, { br: 'נחל לכיש', pages: ['hk-customers', 'hk-reports'] });
});

const BR = { names: ['יהודה הנשיא', 'נחל לכיש'], field: '#store-switch-field', cur: '.multiselect__single', box: '.multiselect', opt: '.multiselect__option' };
const BR_HTML = '<div id="store-switch-field"><div class="multiselect" tabindex="0"><div class="multiselect__tags"><span class="multiselect__single"><div class="selected-store">לארג\' פעמי-יהודה הנשיא</div></span></div>'
  + '<div class="multiselect__content-wrapper" style="display:none"><ul><li><span class="multiselect__option"><span>יהודה הנשיא</span></span></li><li><span class="multiselect__option"><span>נחל לכיש</span></span></li></ul></div></div></div>';
test('branchCur / branchPick (0.1.13): הסניף הנבחר מהטקסט, פתיחה בפוקוס ולחיצה על האפשרות; אפשרות חסרה – no-opt', async () => {
  await page.evaluate((h) => {
    const d = document.createElement('div'); d.innerHTML = h; document.body.appendChild(d);
    const ms = d.querySelector('.multiselect'), w = d.querySelector('.multiselect__content-wrapper');
    ms.addEventListener('focus', () => { w.style.display = 'block'; window.ev.push('focus'); });
    d.querySelectorAll('.multiselect__option').forEach((o) => o.addEventListener('click', () => { d.querySelector('.selected-store').textContent = "לארג' פעמי-" + o.textContent; w.style.display = 'none'; window.ev.push('pick:' + o.textContent); }));
  }, BR_HTML);
  const cur = () => page.evaluate((c) => window.CxSel.branchCur(document, c), BR);
  assert.deepEqual(await cur(), { found: true, cur: 'יהודה הנשיא', opts: ['יהודה הנשיא', 'נחל לכיש'] });
  const r = await page.evaluate((c) => window.CxSel.branchPick(document, c, 'נחל לכיש', { win: window, sleep: (ms) => new Promise((x) => setTimeout(x, ms)) }), BR);
  assert.deepEqual(r, { ok: true });
  assert.equal((await cur()).cur, 'נחל לכיש');
  assert.deepEqual([...new Set(await ev())], ['focus', 'pick:נחל לכיש']);
  assert.equal((await page.evaluate((c) => window.CxSel.branchPick(document, c, 'סניף אחר', { win: window, sleep: (ms) => new Promise((x) => setTimeout(x, ms)) }), BR)).why, 'no-opt');
  await page.evaluate(() => { document.getElementById('store-switch-field').remove(); });
  assert.deepEqual(await cur(), { found: false });
});

test('lists / errDialogs / rowScan (0.1.13, היכרות): רשימות קצרות בלי פקד הסניף; חלון שגיאה נסגר רק ב"אישור"; שורות בלי טקסט תאים', async () => {
  await page.evaluate((h) => {
    const d = document.createElement('div');
    d.innerHTML = h + '<label for="rt">סוג דוח</label><select id="rt"><option>מפורט</option><option>מרוכז</option></select>'
      + '<div class="form-group"><label>אמצעי תשלום</label><div class="multiselect"><input id="pm"><span class="multiselect__option">מזומן</span><span class="multiselect__option">אשראי</span></div></div>'
      + '<div class="modal show" role="dialog" style="display:block"><h5>שגיאה</h5><p>חלה שגיאה בייבוא המידע. אנא צור קשר עם התמיכה</p><button id="ok">אישור</button><button id="del">מחק הכל</button></div>'
      + '<div class="modal show" role="dialog" style="display:block" id="info"><p>שים לב</p><button id="ok2">אישור</button></div>'
      + '<table><thead><tr><th>מספר מסמך</th><th>שם לקוח</th></tr></thead><tbody><tr><td>5</td><td>ישראל ישראלי</td><td><a href="#/invoice/123">ישראל</a><button>הצגה</button></td></tr></tbody></table>';
    document.body.appendChild(d);
    for (const id of ['ok', 'del', 'ok2']) document.getElementById(id).addEventListener('click', () => window.ev.push(id));
  }, BR_HTML);
  const L = await page.evaluate(() => window.CxSel.lists(document));
  assert.deepEqual(L.filter((x) => x.lbl).map((x) => [x.kind, x.lbl, x.opts]), [['select', 'סוג דוח', ['מפורט', 'מרוכז']], ['multiselect', 'אמצעי תשלום', ['מזומן', 'אשראי']]]);
  assert.ok(!JSON.stringify(L).includes('נחל לכיש'), 'פקד הסניף לא ברשימות');
  const D0 = await page.evaluate(() => window.CxSel.errDialogs(document, false));
  assert.equal(D0.length, 1); assert.equal(D0[0].closed, false); assert.deepEqual(await ev(), []);
  const D1 = await page.evaluate(() => window.CxSel.errDialogs(document, true));
  assert.equal(D1[0].closed, true); assert.deepEqual(await ev(), ['ok'], 'רק "אישור" של חלון השגיאה');
  const R = await page.evaluate(() => window.CxSel.rowScan(document));
  const t = R.tables.find((x) => x.th.includes('מספר מסמך'));
  assert.equal(t.rows, 1); assert.equal(t.links, 1); assert.deepEqual(t.hrefs, ['#/invoice/{id}']); assert.deepEqual(t.bw, ['הצגה']);
  assert.ok(!JSON.stringify(R).includes('ישראל'), 'בלי טקסט תאים');
});

test('screen (0.1.12): בלי כותרת "ממתין לטעינה" – כותרות אחרות, כותרות טבלה ומספר שורות, מה שמסביב לשדה הקובץ, דיאלוג; בלי תוכן תאים', async () => {
  await page.setContent(`<!doctype html><html dir="rtl"><body>
<h2>טעינת קבצים</h2><ul class="nav nav-tabs"><li><a class="nav-link" href="#/a">טעינה מקובץ</a></li><li><a class="nav-link" href="#/b">היסטוריה</a></li></ul>
<div class="card"><div class="card-header">בחירת קובץ</div><div class="form-group"><label for="up">בחר קובץ</label><input type="file" id="up" accept=".csv,.xlsx" multiple></div>
<input type="file" id="hid" style="display:none"></div>
<h4>קבצים בהמתנה (1)</h4><table><thead><tr><th>שם</th><th>סוג קובץ</th><th>פעולות</th></tr></thead><tbody><tr><td>לקוח-סודי-0521234567.csv</td><td>עדכון</td><td><button>הסר</button></td></tr></tbody></table>
<h4>טעינות קודמות</h4><table><thead><tr><th>מזהה</th><th>שם</th></tr></thead><tbody><tr><td>25520</td><td>ישראל ישראלי.csv</td></tr><tr><td>25521</td><td>פרטי.csv</td></tr></tbody><tfoot><tr><th>סה"כ 777123</th></tr></tfoot></table>
<div class="up-box"><span>נבחר: lp-price-abc123XYZ.csv</span><input type="file" id="up2"></div>
<button>העלה קבצים והרץ טעינה</button><button>משה כהן</button><a href="#/promotions/77/new">הוסף מבצע</a>
<div role="dialog" aria-modal="true"><h5 class="modal-title">אישור טעינה</h5><p>טקסט ארוך בתוך החלון</p></div>
</body></html>`);
  await page.addScriptTag({ content: SRC });
  const r = await page.evaluate(() => { window.ev = []; document.addEventListener('click', () => window.ev.push('click'), true); document.addEventListener('change', () => window.ev.push('change'), true); return window.CxSel.screen(document, { head: 'ממתין לטעינה', marks: true }); });
  assert.deepEqual(r.marks.map((m) => [m.t, m.h]), [['טעינה מקובץ', '#/a'], ['בחר קובץ', undefined], ['העלה קבצים והרץ טעינה', undefined], ['הוסף מבצע', '#/promotions/{n}/new']], JSON.stringify(r.marks));
  assert.ok(!/promotions/.test(await page.evaluate(() => location.hash)), 'לא ניווטנו');
  assert.equal(r.qhead, 'none');
  for (const h of ['טעינת קבצים', 'טעינה מקובץ', 'היסטוריה', 'בחירת קובץ', 'קבצים בהמתנה (1)', 'טעינות קודמות', 'אישור טעינה']) assert.ok(r.heads.includes(h), h + ' ' + JSON.stringify(r.heads));
  assert.ok(r.wait.some((w) => w.t === 'קבצים בהמתנה (1)' && w.vis), JSON.stringify(r.wait));
  assert.deepEqual(r.tables.map((t) => [t.rows, t.th]), [[1, ['שם', 'סוג קובץ', 'פעולות']], [2, ['מזהה', 'שם']]]);
  assert.deepEqual(r.btns, ['העלה קבצים והרץ טעינה'], 'רק מילות פעולה, לא כפתור עם שם ולא כפתור בתוך טבלה');
  assert.equal(r.files.length, 3);
  assert.deepEqual([r.files[0].vis, r.files[0].multi, r.files[0].accept, r.files[0].lbl, r.files[1].vis], [true, true, '.csv,.xlsx', 'בחר קובץ', false]);
  assert.ok(r.files[0].up[0].t === 'בחר קובץ' && /form-group/.test(r.files[0].up[0].tag), JSON.stringify(r.files[0].up));
  assert.deepEqual(r.dialogs.map((d) => d.t), ['אישור טעינה']);
  const s = JSON.stringify(r);
  for (const x of ['לקוח-סודי', '0521234567', 'ישראל ישראלי', 'פרטי.csv', '25521', 'משה', 'טקסט ארוך', '777123', 'lp-price']) assert.ok(!s.includes(x), x + ' ' + s);
  assert.ok(r.files.some((f) => f.up.some((u) => u.t === 'נבחר: {file}')), 'שם הקובץ שלנו מוחלף ב-{file}: ' + JSON.stringify(r.files.map((f) => f.up)));
  assert.deepEqual(await page.evaluate(() => window.ev), [], 'קריאה בלבד – בלי לחיצה ובלי שינוי');
  // הכותרת המקורית קיימת → exact; קיימת רק בתוך טקסט ארוך יותר → part
  await page.evaluate(() => { document.querySelector('h4').textContent = 'ממתין לטעינה'; });
  assert.equal(await page.evaluate(() => window.CxSel.screen(document, {}).qhead), 'exact');
  await page.evaluate(() => { document.querySelector('h4').textContent = 'ממתין לטעינה (1)'; });
  assert.equal(await page.evaluate(() => window.CxSel.screen(document, {}).qhead), 'part');
});

test('queueRows (0.1.17): "טעינות קודמות" לעולם לא נקראת כתור; כותרת מוסתרת = אין תור; קובץ זר בתור – נספר', async () => {
  const HIST = '<h4>טעינות קודמות</h4><table><thead><tr><th>מזהה</th><th>שם</th><th>סוג קובץ</th><th>סטטוס</th></tr></thead><tbody><tr><td>25520</td><td>a.csv</td><td>עדכון</td><td>בוצע</td></tr></tbody></table>';
  const PICK = '<span><input type="file" id="positive-file-uploader" style="display:none"></span><div><label for="v">בחר קובץ</label><input type="file" id="v"></div>';
  const QT = (rows) => '<table><thead><tr><th>שם</th><th>סוג קובץ</th><th>פעולות</th></tr></thead><tbody>' + rows + '</tbody></table>';
  const C = [
    ['כמו במסך האמיתי: בלי כותרת, רק "טעינות קודמות"', `${PICK}<div>${HIST}</div>`, null, true],
    ['כותרת גלויה בלי טבלה משלה – הטבלה הבאה היא ההיסטוריה', `${PICK}<h4>ממתין לטעינה</h4><button>העלה קבצים והרץ טעינה</button><div>${HIST}</div>`, [], true],
    ['כותרת ב-visibility:hidden', `${PICK}<div style="visibility:hidden"><h4>ממתין לטעינה</h4></div><div>${HIST}</div>`, null, true],
    ['כותרת באזור בגובה 0', `${PICK}<div style="height:0;overflow:hidden"><h4>ממתין לטעינה</h4></div><div>${HIST}</div>`, null, true],
    ['כותרת ב-opacity:0', `${PICK}<div style="opacity:0"><h4>ממתין לטעינה</h4></div><div>${HIST}</div>`, null, true],
    ['כותרת אחרי ההיסטוריה, בתוך אותו div', `<div>${PICK}<div>${HIST}</div><h4>ממתין לטעינה</h4></div>`, [], true],
    ['כותרת שקופה בלי שורות בתור (רק היסטוריה) – עובר', `${PICK}<h4 style="opacity:0">ממתין לטעינה</h4>${QT('')}<div>${HIST}</div>`, null, true],
    // תרחישי הבודק (סבב 1) – כולם חייבים לעצור כשבתור קובץ זר
    ['A: לשונית / קישור "טעינות קודמות" בראש הדף, תור עם קובץ זר', `<ul class="nav nav-tabs"><li><a href="#/x">טעינות קודמות</a></li></ul><div role="tablist"><span role="tab">טעינות קודמות</span></div>${PICK}<h4>ממתין לטעינה</h4>${QT('<tr><td>someone-else.csv</td><td>עדכון פריטים</td><td><button>הסר</button></td></tr>')}`, [['someone-else.csv', 'עדכון פריטים', 'הסר']], false],
    ['C: כותרת "טעינות קודמות" (בלי טבלה עדיין) מעל התור, תור עם קובץ זר', `<h4>טעינות קודמות</h4><p>טוען...</p>${PICK}<h4>ממתין לטעינה</h4>${QT('<tr><td>someone-else.csv</td><td>עדכון פריטים</td><td><button>הסר</button></td></tr>')}`, [['someone-else.csv', 'עדכון פריטים', 'הסר']], false],
    ['F: תור עם עמודות "מזהה" ו"סטטוס", קובץ זר', `${PICK}<h4>ממתין לטעינה</h4><table><thead><tr><th>מזהה</th><th>שם</th><th>סטטוס</th></tr></thead><tbody><tr><td>1</td><td>someone-else.csv</td><td>ממתין</td></tr></tbody></table><div>${HIST}</div>`, [['1', 'someone-else.csv', 'ממתין']], false],
    ['E: כותרת "ממתין לטעינה" שקופה (opacity:0), תור גלוי עם קובץ זר', `${PICK}<h4 style="opacity:0">ממתין לטעינה</h4>${QT('<tr><td>someone-else.csv</td><td>עדכון פריטים</td><td><button>הסר</button></td></tr>')}<div>${HIST}</div>`, [['someone-else.csv', 'עדכון פריטים', 'הסר']], false],
    ['E2: כותרת ב-visibility:hidden, תור גלוי עם קובץ זר', `${PICK}<div><h4 style="visibility:hidden">ממתין לטעינה</h4></div>${QT('<tr><td>someone-else.csv</td><td>עדכון פריטים</td><td><button>הסר</button></td></tr>')}<div>${HIST}</div>`, [['someone-else.csv', 'עדכון פריטים', 'הסר']], false],
    ['טבלת תור ריקה', `${PICK}<h4>ממתין לטעינה</h4>${QT('')}<div>${HIST}</div>`, [], true],
    ['קובץ זר בתור', `${PICK}<h4>ממתין לטעינה</h4>${QT('<tr><td>someone-else.csv</td><td>עדכון פריטים</td><td><button>הסר</button></td></tr>')}<div>${HIST}</div>`, [['someone-else.csv', 'עדכון פריטים', 'הסר']], false],
    // 0.1.18 – כמו בכספית האמיתית (23.11): שם וסוג בתאי th, פעולות ב-td
    ['קובץ זר בתור, שם וסוג ב-th', `${PICK}<h4>ממתין לטעינה</h4>${QT('<tr><th>someone-else.csv</th><th>עדכון פריטים</th><td><button>הסר</button></td></tr>')}<div>${HIST}</div>`, [['someone-else.csv', 'עדכון פריטים', 'הסר']], false],
    ['כותרת ב-th בתוך tbody (בלי thead), שורה עם th – נספרת', `${PICK}<h4>ממתין לטעינה</h4><table><tbody><tr><th>שם</th><th>סוג קובץ</th><th>פעולות</th></tr><tr><th>x.csv</th><th>עדכון</th><td>הסר</td></tr></tbody></table><div>${HIST}</div>`, [['x.csv', 'עדכון', 'הסר']], false],
    ['כותרת th+td בתוך tbody לא נספרת', `${PICK}<h4>ממתין לטעינה</h4><table><tbody><tr><th>שם</th><th>סוג קובץ</th><td>פעולות</td></tr></tbody></table><div>${HIST}</div>`, [], true],
    ['קובץ זר בתור, כותרת td', `${PICK}<h4>ממתין לטעינה</h4><table><tbody><tr><td>שם</td><td>סוג קובץ</td><td>פעולות</td></tr><tr><td>x.csv</td><td>עדכון</td><td>הסר</td></tr></tbody></table><div>${HIST}</div>`, [['x.csv', 'עדכון', 'הסר']], false],
  ];
  for (const [name, body, rows, empty] of C) {
    await page.setContent('<!doctype html><html dir="rtl"><body>' + body + '</body></html>');
    await page.addScriptTag({ content: SRC });
    const r = await page.evaluate(async () => {
      const S = window.CxSel;
      return { R: S.queueRows(document, { head: 'ממתין לטעינה' }), q: await S.runSteps([{ op: 'queueEmpty', head: 'ממתין לטעינה', ms: 300 }], { doc: document, win: window, sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 30))) }) };
    });
    const q = r.q;
    assert.deepEqual(r.R, rows, name);
    assert.equal(q.ok, empty, name + ' ' + JSON.stringify(q));
    if (!empty) assert.equal(q.code, 'import-queue-not-empty', name);
  }
  // כותרת שקופה עם קובץ בתור: מחכים (לא עוצרים מיד); הקובץ הוסר בזמן ההמתנה → עובר
  await page.setContent(`<!doctype html><html dir="rtl"><body>${PICK}<h4 style="opacity:0">ממתין לטעינה</h4>${QT('<tr><td>x.csv</td><td>עדכון</td><td>הסר</td></tr>')}<div>${HIST}</div></body></html>`);
  await page.addScriptTag({ content: SRC });
  const w = await page.evaluate(async () => {
    setTimeout(() => document.querySelector('tbody tr').remove(), 150);
    return window.CxSel.runSteps([{ op: 'queueEmpty', head: 'ממתין לטעינה', ms: 3000 }], { doc: document, win: window, sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 30))) });
  });
  assert.equal(w.ok, true, 'כותרת שקופה: חיכה עד שהתור התרוקן ' + JSON.stringify(w));
});

test('deniedLink (0.1.12): "מבצעים" מותר (למרות "בצע"), "הוספת מבצעים" / "ייבוא מבצעים" / "ביצוע" / "הגדרות"? – לפי DENY', () => {
  const X = require('../src/lib/selectors.js');
  for (const t of ['מבצעים', 'מבצע', 'רשימת מבצעים', 'דוח אמצעי תשלום', 'סיכום קופה יומי']) assert.equal(X.deniedLink(t), false, t);
  for (const t of ['הוספת מבצעים', 'ייבוא מבצעים', 'הוסף מבצע', 'ביצוע חיוב', 'מחיקת מבצע', 'הוסף אמצעי תשלום', 'ייבוא תקבולים']) assert.equal(X.deniedLink(t), true, t);
});

test('selectors.json v10 (0.1.21): hkSnap – רק #/hakafa-customers, לוחץ רק "יצוא לאקסל" (at), דגל hkSync פועל', () => {
  assert.equal(SEL.hkSync, true);
  const F = SEL.flows.hkSnap;
  assert.deepEqual(F.map((x) => x.op), ['nav', 'waitFor', 'click']);
  assert.equal(F[0].hash, '#/hakafa-customers');
  assert.ok(F.slice(1).every((x) => x.at === '#/hakafa-customers' && x.stop));
  const c = F[2];
  assert.ok(c.capture && c.safe && !c.submit);
  assert.ok(c.t.textAny.every((x) => /^(ייצוא|יצוא) לאקסל$/.test(x)), JSON.stringify(c.t));
  for (const t of c.t.textAny) assert.ok(!SEL_DENY.some((w) => t.includes(w)), t);
});
