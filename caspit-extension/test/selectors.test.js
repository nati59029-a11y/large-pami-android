'use strict';
// מריץ צעדי המסך בדפדפן אמיתי (Chromium של Playwright) על דף בדיקה
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const SRC = fs.readFileSync(path.join(__dirname, '../src/lib/selectors.js'), 'utf8');
const SEL = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/selectors.json'), 'utf8'));
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
  const flow = [{ op: 'select', t: { css: '#kind' }, option: 'עדכון מחיר לצרכן ו/או מחיר עלות לפריטים' }].concat(SEL.flows.importPrice.filter((s) => ['setFile', 'click', 'waitFor', 'text'].includes(s.op) && !(s.op === 'waitFor' && s.t.css)));
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
  const r = await page.evaluate(() => [window.CxSel.monthYear('נובמבר 2026'), window.CxSel.monthYear('January 2027'), window.CxSel.monthYear('3/2026'), window.CxSel.monthYear('xx')]);
  assert.deepEqual(r, [{ y: 2026, m: 10 }, { y: 2027, m: 0 }, { y: 2026, m: 2 }, null]);
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
