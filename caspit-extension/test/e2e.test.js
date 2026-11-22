'use strict';
// בדיקת קצה-לקצה: התוסף נטען (unpacked) ל-Chromium, כספית מדומה (context.route) ושרת cxBot מדומה (127.0.0.1).
// מכסה: חיבור עם קוד, חיבור שפג בכספית (needs-login) והמשך אחרי התחברות, ריצה מלאה (קטלוג, מכירות לכל יום, קבצים לכספית),
// טריגר כפול, אותו קובץ לא נשלח פעמיים, כפתור שהשתנה (selector-miss), מגבלת 500 מחירים, מצב היכרות + הורדת דוח בלי סודות,
// "סנכרן עכשיו" מהטלפון (poll: ריצה אחת לכל בקשה, לא בזמן ריצה, שרת ישן), והיכרות עם מסך הנוכחות לפי התפריט (בלי לחיצות).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const D = require('../src/lib/days.js');
const X = require('../src/lib/xlsx.full.min.js');
const fx = require('./fixtures/data.js');
const fake = require('./fixtures/fake-cxbot.js');

const EXT_ID = 'mianlmahikfdnffiipdfpojnfjhcipbp';
const TOKEN = 'testbiz1.' + 'Q'.repeat(43);
const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures/caspit/index.html'));
const POS = '<!doctype html><html dir="rtl"><body><h1>טוען תוכנה</h1><button id="x">ייצוא לאקסל</button><a href="#/catalogs">ממשקים</a><select><option>טעינת פריטים חדשים</option></select><input type="file">'
  + '<script>window.posHits=0;document.addEventListener("click",()=>{window.posHits++;localStorage.setItem("posHits",String(+(localStorage.getItem("posHits")||0)+1))},true);'
  + 'document.addEventListener("change",()=>localStorage.setItem("posHits",String(+(localStorage.getItem("posHits")||0)+1)),true)</script></body></html>';
const SECRETS = ['SESSIONabc123def456', 'eyJhbGciOiJIUzI1NiJ9', 'Zx9kQ2mP7vL4nR8sT1wY6bC3', 'owner@example.co.il', '052-1234567', '4580123412341234', 'hunter2pass', 'owner-secret-value'];

let ctx, srv, sw, tmp, ext;
const imports = [];
const salesReq = [];
const nlReq = []; // 0.1.13: דוחות מכירות שהורדו בסניף נחל לכיש
let nlMode = 'rows';
const today = D.dayStr(Date.now(), 'Asia/Jerusalem');
const days = [D.addDays(today, -2), D.addDays(today, -1)];

async function caspitRoute(route) {
  const u = new URL(route.request().url());
  const p = u.pathname;
  // המשרד האחורי של כספית: /bo#/... (כמו באתר האמיתי). כל נתיב אחר – "קופת המכירה" המדומה, שסופרת כל לחיצה (אסור שהתוסף ייגע בה)
  if (p === '/bo' || p === '/bo/') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: FIXTURE });
  const JSONR = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
  if (p === '/api/me') return JSONR({ email: 'owner@example.co.il', phone: '052-1234567', token: 'Zx9kQ2mP7vL4nR8sT1wY6bC3', items: [{ id: 4580123412341234, name: 'x' }] });
  // משימות של כספית (run-as-job) והקובץ שלהן
  if (/^\/bo\/merkaz\/(items\/(full_)?report\.xlsx|reports\/sales_items)$/.test(p)) return JSONR({ job_id: 7, success: true });
  if (p === '/bo/files/get_job_result') {
    const f = u.searchParams.get('filename') || '';
    if (f === 'catalogs_with_barcodes.xlsx') return route.fulfill({ status: 200, headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, body: Buffer.from(fx.catalogXlsx(X)) });
    if (f === 'catalogs.xlsx') return route.fulfill({ status: 200, headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, body: Buffer.from(fx.catalogXlsx(X, true)) });
    const m = /^sales_items_(\d{4})(\d{2})(\d{2})_\d{8}\.csv$/.exec(f);
    // 0.1.13: הדוח לפי הסניף הנבחר בכספית המדומה (store). נחל לכיש: nlMode = rows (סניף ב / 2, ברירת מחדל) · empty (בלי מכירות) · same (אותו סניף כמו יהודה הנשיא)
    if (m) {
      const nl = u.searchParams.get('store') === 'נחל לכיש', day = `${m[1]}-${m[2]}-${m[3]}`;
      (nl ? nlReq : salesReq).push(f);
      const br = !nl ? null : nlMode === 'empty' ? { rows: false } : nlMode === 'same' ? { bn: 'סניף א', bno: '1' } : { bn: 'סניף ב', bno: '2' };
      return route.fulfill({ status: 200, headers: { 'content-type': 'text/csv; charset=windows-1255' }, body: Buffer.from(fx.win1255(fx.salesCsv(day, br))) });
    }
    return route.fulfill({ status: 404, body: '' });
  }
  if (p === '/bo/merkaz/upload_csv_index') return JSONR({ load_catalog_jobs: [], meta: { files_structure: [{ job_type: 'new_items', columns: ['קוד פריט'], not_required_columns: [], skip_unnecessary_columns: true }], total: 1 } });
  if (p === '/bo/merkaz/upload_csv') {
    const b = JSON.parse(route.request().postData() || '{}');
    imports.push(b);
    return JSONR({ n: Math.max(0, String(b.text || '').trim().split('\n').length - 1) });
  }
  if (!p.startsWith('/api/') && !p.startsWith('/bo/')) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: POS });
  return route.fulfill({ status: 404, body: '' });
}
const store = () => sw.evaluate(() => chrome.storage.local.get(null));
async function waitFor(fn, ms, what) {
  const end = Date.now() + (ms || 120e3);
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timeout waiting for ' + (what || 'condition'));
    await new Promise((r) => setTimeout(r, 400));
  }
}
// מחכה שריצה שהתחילה אחרי t0 תסתיים
const waitRun = (t0) => waitFor(async () => { const s = await store(); return s.st && s.st.lastRun && s.st.lastRun.at > t0 ? s : null; }, 240e3, 'run end');
const caspitPage = () => ctx.pages().find((p) => p.url().startsWith('https://caspit.valu.co.il/'));
const posHits = (p) => p.evaluate(() => +(localStorage.getItem('posHits') || 0));

test.before(async () => {
  srv = await fake.start({ token: TOKEN, days: days.concat([today]) });
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cxext-'));
  ext = path.join(tmp, 'ext');
  execFileSync(process.execPath, [path.join(__dirname, '../build.js'), '--backend', 'local', '--api', `http://127.0.0.1:${srv.port}/cxBot`, '--out', ext], { stdio: 'pipe' });
  impOn(ext);
  ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
    channel: 'chromium', headless: true, acceptDownloads: true,
    // כספית האמיתית לא נגישה בבדיקה: בלשונית שהתוסף פותח, הבקשה הראשונה לפעמים יוצאת לפני שה-route מחובר. בסביבת הפיתוח
    // האתר חסום (דף שגיאה → התוסף טוען מחדש → הדמה), אבל ב-GitHub הוא נטען באמת (דף של Cloudflare) והבדיקה נכשלה.
    // מפנים את הכתובת ל-127.0.0.1 (חיבור נדחה) – אותה התנהגות בכל מקום
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP caspit.valu.co.il 127.0.0.1'],
  });
  await ctx.route('https://caspit.valu.co.il/**', caspitRoute);
  sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'));
});
// במוצר העלאה לכספית כבויה (selectors.json importEnabled:false) – כדי לבדוק את זרימת הייבוא על כספית המדומה, מדליקים אותה בעותק של הבדיקה
function impOn(dir) {
  const f = path.join(dir, 'selectors.json'), j = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.equal(j.importEnabled, true, 'במוצר – פעיל (מ-0.1.4)');
  j.importEnabled = true;
  j.branch.switch.ms = 8000; j.branch.switch.settle = 800; // 0.1.13: בבדיקה – המתנה קצרה לבחירת סניף שלא נקלטת
  fs.writeFileSync(f, JSON.stringify(j));
}
test.after(async () => {
  if (ctx) await ctx.close();
  if (srv) await srv.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('התוסף נטען עם המזהה הקבוע (key), הרשאות מינימליות', async () => {
  assert.equal(new URL(sw.url()).host, EXT_ID);
  const m = await sw.evaluate(() => chrome.runtime.getManifest());
  assert.deepEqual(m.permissions.sort(), ['alarms', 'idle', 'scripting', 'storage']);
  assert.deepEqual(m.host_permissions, ['https://caspit.valu.co.il/*', 'http://127.0.0.1/*']);
  const al = await waitFor(async () => { const a = await sw.evaluate(async () => (await chrome.alarms.getAll()).map((x) => x.name)); return a.includes('daily') && a.includes('tick') && a.includes('poll') ? a : null; }, 10e3, 'alarms');
  assert.ok(al.length >= 3);
});

test('חיבור: קוד שגוי נדחה, קוד נכון מתחבר (עמוד ההגדרות)', async () => {
  const pg = await ctx.newPage();
  await pg.goto(`chrome-extension://${EXT_ID}/options.html`);
  await pg.fill('#tok', 'not-a-token');
  await pg.click('#connect');
  await pg.waitForFunction(() => document.getElementById('msg').textContent.includes('לא תקין'));
  await pg.fill('#tok', TOKEN);
  await pg.click('#connect');
  await pg.waitForFunction(() => document.getElementById('msg').textContent.includes('מחובר'));
  assert.equal((await store()).token, TOKEN);
  assert.equal(await pg.textContent('#biz'), 'עסק בדיקה');
  await pg.close();
});

test('חיבור לכספית פג → "צריך התחברות", בלי למלא סיסמה; אחרי התחברות הבדיקה הבאה מריצה הכול', async () => {
  const pop = await ctx.newPage();
  await pop.goto(`chrome-extension://${EXT_ID}/popup.html`);
  let t0 = Date.now();
  await pop.click('#sync');
  let s = await waitRun(t0);
  const diag = async () => { const p = caspitPage(); return p ? { url: p.url(), body: (await p.evaluate(() => document.body && document.body.innerText).catch(() => '?') || '').slice(0, 300) } : { pages: ctx.pages().map((x) => x.url()) }; };
  assert.equal(s.st.lastRun.st, 'needs-login', JSON.stringify(s.st.lastRun) + ' ' + JSON.stringify(await diag()));
  const cp = caspitPage();
  assert.ok(cp, 'extension opened its own Caspit tab');
  assert.equal(await cp.evaluate(() => document.getElementById('p').value + document.getElementById('u').value), '');
  const rep = srv.ops('report').at(-1);
  assert.equal(rep.err.code, 'needs-login');
  await pop.reload();
  await pop.waitForFunction(() => document.getElementById('stT').textContent.includes('צריך להתחבר'));

  // בעל העסק מתחבר בלשונית; הבדיקה של כל 15 דקות מגלה שצריך לרוץ ומתזמנת התחלה בעוד 2 דקות
  await cp.evaluate(() => { localStorage.setItem('auth', '1'); location.hash = '#/catalogs'; });
  assert.equal(await sw.evaluate(() => self.__cxTest.tick()), true);
  assert.ok(await sw.evaluate(async () => !!(await chrome.alarms.get('start'))));
  t0 = Date.now();
  await sw.evaluate(() => self.__cxTest.startAuto()); // כמו ה-alarm 'start' אחרי 2 דקות
  s = await waitRun(t0);
  assert.equal(s.st.lastRun.st, 'ok', JSON.stringify(s.st.lastRun));
  assert.equal(s.st.lastOkDay, D.slotDay(Date.now(), '03:00', 'Asia/Jerusalem'));

  // קטלוג: הועלה ונשמר
  const up = srv.ops('upload');
  const cat = up.filter((c) => c.items);
  assert.equal(cat.length, 1);
  assert.equal(cat[0].items.length, 3);
  assert.ok(cat[0].items.every((x) => x.bc || (x.bcs && x.bcs.length)), 'הקטלוג "כולל ברקודים" (ולא "יצוא לאקסל" בלי ברקודים): ' + JSON.stringify(cat[0].items[0]));
  assert.deepEqual(salesReq.slice(0, 2).map((f) => f.slice(12, 20)), days.map((d) => d.replace(/-/g, '')), 'דוח מכירות לכל יום – התאריך נבחר בלוח השנה');
  // מכירות: כל יום שלם בנפרד, אף פעם לא היום
  const sales = up.filter((c) => c.kind === 'sales');
  assert.deepEqual(sales.map((c) => c.day), days);
  // 0.1.13 (א): שני סניפים → העלאה אחת לכל יום עם שני מספרי סניף (יהודה הנשיא 3 שורות + נחל לכיש 2), וכספית חזרה ליהודה הנשיא
  for (const c of sales) { assert.equal(c.lines.length, 5); assert.ok(c.lines.every((l) => l.d === c.day)); assert.deepEqual([...new Set(c.lines.map((l) => l.bk))].sort(), ['1', '2']); assert.equal(c.parts, 1); }
  assert.deepEqual(nlReq.slice(0, 2).map((f) => f.slice(12, 20)), days.map((d) => d.replace(/-/g, '')), 'אותו דוח לאותו יום גם בנחל לכיש');
  assert.equal(await caspitPage().evaluate(() => localStorage.getItem('store') || 'יהודה הנשיא'), 'יהודה הנשיא');
  assert.deepEqual(s.st.lastRun.sum.sales[days[0]].brs, [['יהודה הנשיא', 3], ['נחל לכיש', 2]]);
  assert.ok(!sales.some((c) => c.day === today));
  assert.ok(srv.ops('apply').length >= 3);
  // קבצים לכספית: פריטים חדשים ואז מחירים, עם האפשרות הנכונה, ודיווח תוצאה
  assert.deepEqual(imports.map((i) => i.type), ['new', 'price']);
  assert.match(imports[0].text, /900001/);
  assert.match(imports[1].text, /101,5\.5/);
  const ir = srv.ops('importResult');
  assert.deepEqual(ir.map((r) => [r.kind, r.n, r.ok]), [['new', 1, true], ['price', 2, true]]);
  assert.deepEqual(ir.map((r) => [r.id, r.status, r.errors, r.loaded]), [[25521, 'בוצע', 0, 1], [25522, 'בוצע', 0, 2]], 'השורה החדשה בטבלת "טעינות קודמות" (מזהה גדול מהקודם, השם שלנו)');
  assert.ok(imports.every((i) => /^lp-(new|price)-[\w-]+\.csv$/.test(i.name)), 'שם ייחודי לריצה: ' + imports.map((i) => i.name));
  { const evs = await caspitPage().evaluate(() => window.ev || []); assert.ok(!evs.includes('cancel') && !evs.includes('histlink'), 'לא נלחץ שום דבר בטבלת "טעינות קודמות"'); }
  assert.equal(srv.ops('export').find((e) => e.kind === 'price').max, 500);
  assert.equal(srv.ops('export').find((e) => e.kind === 'new').max, 50);
  const last = srv.ops('report').at(-1);
  assert.equal(last.st, 'ok');
  // הקובץ לא ירד לתיקיית ההורדות (נתפס), ותצוגת הלשונית לא הוחלפה ללשונית אחרת
  assert.equal(ctx.pages().filter((p) => p.url().startsWith('https://caspit.valu.co.il/')).length, 1);
  await pop.close();
});

test('טריגר כפול אחרי הצלחה – לא רץ שוב; ריצה ידנית נוספת לא שולחת שוב אותם קבצים', async () => {
  assert.equal(await sw.evaluate(() => self.__cxTest.trigger('idle')), false);
  assert.equal(await sw.evaluate(async () => !!(await chrome.alarms.get('start'))), false);
  const nSales = srv.ops('upload').filter((c) => c.kind === 'sales').length, nImp = imports.length;
  const t0 = Date.now();
  await sw.evaluate(() => self.__cxTest.startRun({ manual: true }));
  const s = await waitRun(t0);
  assert.equal(s.st.lastRun.st, 'ok');
  assert.equal(srv.ops('upload').filter((c) => c.kind === 'sales').length, nSales, 'same sales file not uploaded twice');
  assert.equal(imports.length, nImp, 'same CSV not imported twice the same day');
  assert.deepEqual(Object.values(s.st.lastRun.sum.sales).map((x) => x.skip), ['same', 'same']);
});

test('"סנכרן עכשיו" מהטלפון: בקשה → ריצה אחת (manual, req); poll נוסף לא מתחיל שוב; בזמן ריצה – לא; שרת ישן → כל 15 דקות', async () => {
  const pollOnce = () => sw.evaluate(() => self.__cxTest.pollOnce());
  const helloReq = (id) => srv.ops('hello').filter((h) => h.req === id);
  // בלי בקשה – כלום
  assert.equal(await pollOnce(), null);
  srv.req = 'qtest0001aa'; srv.taken = false;
  let t0 = Date.now();
  if (!(await pollOnce())) await pollOnce(); // (ה-alarm של כל דקה יכול להקדים את הבדיקה)
  let s = await waitFor(async () => { const x = await store(); return x.st && x.st.lastRun && x.st.lastRun.at > t0 && x.st.lastRun.req ? x : null; }, 240e3, 'remote run');
  assert.equal(s.st.lastRun.st, 'ok', JSON.stringify(s.st.lastRun));
  assert.equal(s.lastReq, 'qtest0001aa');
  assert.equal(helloReq('qtest0001aa').length, 1, 'hello אחד עם הבקשה');
  assert.equal(helloReq('qtest0001aa')[0].manual, true);
  // שלוש בדיקות נוספות – גם אם השרת עדיין מחזיר את אותה בקשה – לא מתחילות ריצה נוספת
  srv.taken = false;
  const nHello = srv.ops('hello').length;
  for (let i = 0; i < 3; i++) assert.equal(await pollOnce(), null);
  assert.equal(srv.ops('hello').length, nHello);
  srv.taken = true;
  // בזמן ריצה (busy) – לא מתחילים, וגם לא פונים לשרת
  await sw.evaluate(() => { self.__cxTest.startRun({ manual: true }); });
  await waitFor(() => sw.evaluate(() => self.__cxTest.isBusy()), 10e3, 'busy');
  srv.req = 'qtest0002bb'; srv.taken = false;
  const nPoll = srv.ops('poll').length;
  assert.equal(await pollOnce(), null);
  assert.equal(srv.ops('poll').length, nPoll, 'בזמן ריצה – בלי פנייה לשרת');
  await waitFor(() => sw.evaluate(() => !self.__cxTest.isBusy()), 240e3, 'run end');
  t0 = Date.now();
  if (!(await pollOnce())) await pollOnce();
  s = await waitFor(async () => { const x = await store(); return x.st && x.st.lastRun && x.st.lastRun.at > t0 && x.st.lastRun.req ? x : null; }, 240e3, 'remote run 2');
  assert.equal(helloReq('qtest0002bb').length, 1);
  srv.req = null;
  // שרת ישן (bad-op) → הבדיקה מאטה ל-15 דקות, בלי תקלה בחלון; שרת חדש → חזרה לכל דקה
  srv.noPoll = true;
  assert.equal(await pollOnce(), null);
  assert.equal(await sw.evaluate(async () => (await chrome.alarms.get('poll')).periodInMinutes), 15);
  srv.noPoll = false;
  await pollOnce();
  assert.equal(await sw.evaluate(async () => (await chrome.alarms.get('poll')).periodInMinutes), 1);
  // העסק כבוי זמנית (403) → לא מפסיקים לבדוק, רק כל 15 דקות
  srv.bizOff = true;
  assert.equal(await pollOnce(), null);
  assert.equal(await sw.evaluate(async () => (await chrome.alarms.get('poll')).periodInMinutes), 15);
  srv.bizOff = false;
  await pollOnce();
  assert.equal(await sw.evaluate(async () => (await chrome.alarms.get('poll')).periodInMinutes), 1);
  // ריצה שממתינה לניסיון חוזר: הבקשה לא מתחילה ריצה, ו-poll מדווח מתי הניסיון הבא (wait)
  const saved = await sw.evaluate(async () => (await chrome.storage.local.get('run')).run);
  await sw.evaluate(async () => { const { run } = await chrome.storage.local.get('run'); await chrome.storage.local.set({ run: Object.assign({}, run, { st: 'wait', retryAt: Date.now() + 600e3, touchedAt: Date.now() }) }); });
  srv.req = 'qtest0003cc'; srv.taken = false;
  assert.equal(await pollOnce(), null);
  assert.ok(srv.ops('poll').at(-1).wait > Date.now(), JSON.stringify(srv.ops('poll').at(-1)));
  assert.equal(helloReq('qtest0003cc').length, 0);
  assert.notEqual((await store()).lastReq, 'qtest0003cc', 'בקשה שלא התחילה – לא מסומנת');
  await sw.evaluate(async (r) => chrome.storage.local.set({ run: r }), saved);
  srv.req = null;
});

test('כפתור שהשתנה בכספית → selector-miss, דיווח לשרת, בלי ניסיון חוזר', async () => {
  const cp = caspitPage();
  await cp.evaluate(() => { localStorage.setItem('variant', 'new'); location.hash = '#/'; });
  const t0 = Date.now();
  await sw.evaluate(() => self.__cxTest.startRun({ manual: true }));
  const s = await waitRun(t0);
  assert.equal(s.st.lastRun.st, 'fail');
  assert.equal(s.st.lastRun.code, 'selector-miss');
  assert.equal(s.st.lastRun.step, 'catalog');
  assert.equal(srv.ops('report').at(-1).err.code, 'selector-miss');
  assert.equal(await sw.evaluate(async () => !!(await chrome.alarms.get('retry'))), false);
  // גם הבדיקה של כל 15 דקות לא מנסה שוב באותו מועד (גם אם היום עוד לא סונכרן)
  await sw.evaluate(async () => { const { st } = await chrome.storage.local.get('st'); st.lastOkDay = '2000-01-01'; await chrome.storage.local.set({ st }); });
  assert.equal(await sw.evaluate(() => self.__cxTest.trigger('tick')), false);
  await cp.evaluate(() => { localStorage.removeItem('variant'); location.hash = '#/'; });
});

test('יותר מ-500 מחירים → עוצר, לא טוען לכספית', async () => {
  srv.exportN.price = 600;
  const nImp = imports.length;
  const t0 = Date.now();
  await sw.evaluate(() => self.__cxTest.startRun({ manual: true }));
  const s = await waitRun(t0);
  assert.equal(s.st.lastRun.code, 'limit');
  assert.equal(s.st.lastRun.step, 'exportPrice');
  assert.equal(imports.length, nImp);
  srv.exportN.price = 2;
});

test('מצב היכרות: דוח מסונן, עד 1MB, בלי סודות שתולים, ניתן להורדה ולשליחה', async () => {
  const pop = await ctx.newPage();
  await pop.goto(`chrome-extension://${EXT_ID}/popup.html`);
  await caspitPage().evaluate(() => localStorage.removeItem('brPicks')); // 0.1.13: רק הבחירות של ההיכרות
  await pop.click('#disc');
  const s = await waitFor(async () => { const x = await store(); return x.discSt && x.discSt.st !== 'run' && x.disc ? x : null; }, 300e3, 'discovery');
  assert.equal(s.discSt.st, 'ok', JSON.stringify(s.disc.rep.err));
  const rep = s.disc.rep;
  const txt = JSON.stringify(rep);
  for (const x of SECRETS) assert.ok(!txt.includes(x), 'leaked ' + x);
  assert.ok(s.disc.size <= 1024 * 1024);
  const HKP = ['hk-customers', 'hk-reports', 'hk-cust-reports', 'hk-sales-lines', 'hk-sales-total', 'hk-monthly', 'hk-merakez', 'hk-shipments', 'hk-sales-all'];
  const PAY = ['pay-reports', 'pay-hos', 'pay-rikuz', 'pay-cat', 'pay-x'];
  assert.deepEqual(rep.pages.map((p) => p.name), ['catalogs', 'csv-imports', 'sales', 'employees', 'emp-hours', ...HKP, 'imp-screen', 'promos', ...PAY]);
  // 0.1.13 דוחות אמצעי תשלום לפי hash ישיר; רק "יצוא לאקסל" נלחץ (רק ב-payment-reports יש)
  const p1 = rep.pages.find((p) => p.name === 'pay-reports'), p2 = rep.pages.find((p) => p.name === 'pay-x');
  assert.deepEqual(rep.pages.filter((p) => PAY.includes(p.name)).map((p) => p.hash), ['#/payment-reports', '#/payment-report-hos', '#/rikuz-reports', '#/payments-by-categories-reports', '#/xreports']);
  assert.deepEqual(p1.heads, [['תאריך', 'סניף', 'מזומן', 'אשראי', 'הקפה', 'סה"כ']]);
  assert.deepEqual(p1.probe.map((x) => [x.op, x.found, x.done]), [['click', true, true]]);
  assert.equal(p2.probe[0].found, false, 'בלי יצוא – לא לוחצים כלום');
  assert.ok(p1.controls.some((c) => c.id === 'payStore' && c.tag === 'select') && p1.controls.some((c) => c.id === 'payDay'));
  const payF = rep.files.filter((f) => f.flow === 'hkExport' && /^pay-/.test(f.page));
  assert.deepEqual(payF.map((f) => [f.page, !f.none]), [['pay-reports', true], ['pay-hos', false], ['pay-rikuz', false], ['pay-cat', false], ['pay-x', false]]);
  assert.deepEqual(payF[0].hdr, ['תאריך', 'סניף', 'מזומן', 'אשראי', 'הקפה', 'סה"כ']); assert.deepEqual(payF[0].kinds[1], ['date', 'text', 'num', 'num', 'num', 'num']);
  assert.equal(await caspitPage().evaluate(() => localStorage.getItem('payX')), '1');
  // 0.1.13: רשימות בחירה קצרות (בלי לפתוח): סוג דוח / סניף / קופה / אמצעי תשלום – כן; קופאי (שמות) – רק '?'
  const lsOf = (p) => Object.fromEntries((p.lists || []).filter((x) => x.lbl !== '?').map((x) => [x.lbl, x.opts]));
  assert.deepEqual(lsOf(p1), { 'סניף': ['יהודה הנשיא', 'נחל לכיש'], 'סוג דוח': ['מפורט', 'מרוכז'], 'קופה': ['כל הקופות', 'קופה 1', 'קופה 2'], 'אמצעי תשלום': ['מזומן', 'אשראי', 'הקפה'] }, JSON.stringify(p1.lists));
  assert.ok(p1.lists.some((x) => x.lbl === '?' && x.opts === undefined), 'רשימת הקופאים – בלי תווית ובלי אפשרויות');
  assert.ok(!txt.includes('זלמן') && !txt.includes('קופאיסקי'), 'שם קופאי בדוח');
  assert.ok(!rep.pages.some((p) => p.hash === '#/stock-report'), 'דוח שלא קשור לאמצעי תשלום – לא נפתח');
  // תיקון בודק 0.1.12: "הגדרות אשראי", "ייבוא תקבולים", "הוסף אמצעי תשלום" (מילה אסורה / הגדר / ייבוא) ו"דוח תקבולים" שלא תחת "דוחות" – לא נפתחו
  for (const h of ['#/credit-settings', '#/receipts-import', '#/payment-methods/new', '#/receipts-outside']) assert.ok(!rep.pages.some((p) => p.hash === h), 'נפתח: ' + h);
  // 0.1.13: בלי findAll – התפריט "דוחות" כבר לא נפתח במעבר עכבר; קישור עם מילה אסורה שגלוי בדף עדיין מסומן bad
  assert.equal(rep.menu.find((l) => l.h === '#/receipts-outside').u, undefined, 'קישור מחוץ לתפריט – בלי u');
  assert.ok(p1.controls.every((c) => c.options === undefined && c.placeholder === undefined && (c.text === undefined || /^(הצג|יצוא לאקסל)$/.test(c.text))), 'noText: ' + JSON.stringify(p1.controls.filter((c) => c.text || c.options)));
  assert.ok(!JSON.stringify(p1).includes('99887.5'), 'בלי tfoot');
  for (const nm of ['4321.5', '8765.25', '345.75', '13432.5']) assert.ok(!txt.includes(nm), 'סכום מהדוח: ' + nm);
  // 0.1.12 בחירת סניף: מתועד בכל מסך, בלי select / click / פוקוס על הפקד (attHits למטה, branch-*)
  const br = rep.branch.picks.find((b) => /store-switch-field/.test(b.css));
  assert.ok(br, JSON.stringify(rep.branch));
  assert.equal(br.kind, 'dropdown'); assert.deepEqual(br.opts, ['יהודה הנשיא', 'נחל לכיש']); assert.equal(br.t, 'יהודה הנשיא');
  assert.ok(br.on.includes('catalogs') && br.on.includes('hk-customers') && br.on.includes('pay-reports'), JSON.stringify(br.on));
  assert.deepEqual(rep.branch.store, ['יהודה הנשיא'], 'רק שם הסניף, לא הטקסט המלא: ' + JSON.stringify(rep.branch.store));
  // תיקון בודק 0.1.12: "נחל לכיש: ₪12,345.00" → רק "נחל לכיש"; שום טקסט מלא / סכום מהפקדים
  assert.ok(rep.branch.picks.some((b) => b.t === 'נחל לכיש' && b.on.includes('pay-reports')), JSON.stringify(rep.branch.picks));
  const brTxt = JSON.stringify(rep.branch);
  for (const x of ['12,345', '₪', 'לארג', 'חנות']) assert.ok(!brTxt.includes(x), 'טקסט מלא בפקד הסניף: ' + x + ' ' + brTxt);
  const hkB = rep.branch.picks.find((b) => b.css === 'select#hkStore');
  assert.ok(hkB && hkB.opts.every((o) => o === 'נחל לכיש' || o === 'יהודה הנשיא'), 'בדף priv – רק שמות סניפים: ' + JSON.stringify(hkB));
  // 0.1.13: הבחירה הוחלפה רק פעם אחת – לקוחות ההקפה בנחל לכיש (discBranch) – וחזרה ליהודה הנשיא; בשאר ההיכרות (גם דפי pay) – לא
  assert.equal(await caspitPage().evaluate(() => localStorage.getItem('brPicks')), 'נחל לכיש;יהודה הנשיא;');
  assert.equal(await caspitPage().evaluate(() => localStorage.getItem('store')), 'יהודה הנשיא');
  assert.equal(rep.brEnd, 'ok');
  const bd = rep.brDisc;
  assert.equal(bd.ok, true, JSON.stringify(bd)); assert.equal(bd.br, 'נחל לכיש');
  assert.deepEqual(bd.pages.map((x) => [x.name, x.tables[0].rows, x.file.rows]), [['hk-customers', 1, 3], ['hk-reports', 1, 3]], 'בנחל לכיש – רשימה אחרת (שורה אחת)');
  assert.deepEqual(bd.pages[0].file.hdr, ['מספר לקוח', 'שם לקוח', 'ח.פ/ע.מ', 'טלפון', 'כתובת', 'יתרה', '?']);
  assert.deepEqual(bd.pages[0].tables[0].th, ['מספר לקוח', 'שם לקוח', 'ח.פ/ע.מ', 'טלפון', 'כתובת', 'יתרה', 'פעולות']);
  for (const nm of ['גן העיר', '515151515', '6999999', 'הגפן', '77.1']) assert.ok(!txt.includes(nm), 'פרט לקוח של נחל לכיש בדוח: ' + nm);
  // 0.1.12 מבצעים: "כרטיס הטבות" (מעבר עכבר) ← "מבצעים"; הלחיצה היחידה – "יצוא לאקסל"; "הוסף מבצע" / ייבוא – רק מתועדים (בלי לחיצה ובלי ניווט)
  const pr = rep.pages.find((p) => p.name === 'promos');
  assert.equal(pr.ok, true, JSON.stringify(pr)); assert.equal(pr.hash, '#/promotions');
  assert.equal(rep.menu.find((l) => l.t === 'ייבוא מבצעים').bad, true); assert.equal(rep.menu.find((l) => l.t === 'הוספת מבצעים').bad, true);
  assert.deepEqual(pr.probe.map((x) => [x.op, x.found, x.done]), [['click', true, true]]);
  assert.deepEqual(pr.heads, [['מספר מבצע', 'שם מבצע', 'מתאריך', 'עד תאריך', 'סוג מבצע', 'מחיר מבצע', 'סטטוס', 'פעולות']]);
  const mk = pr.scr.marks.map((m) => m.t);
  for (const t of ['ייבוא מבצעים', 'הוסף מבצע', 'ייבוא מבצעים מקובץ']) assert.ok(mk.includes(t), t + ' ' + JSON.stringify(pr.scr.marks));
  assert.equal(pr.scr.marks.find((m) => m.t === 'הוסף מבצע').h, '#/promotions/new', 'hash של "הוסף מבצע" – מתועד בלבד');
  assert.ok(pr.scr.files.some((f) => f.accept === '.xlsx,.csv' && !f.vis), 'שדה הקובץ (מוסתר) של הייבוא – מתועד');
  assert.ok(pr.controls.some((c) => c.text === 'יצוא לאקסל'));
  for (const h of ['#/promotions/new', '#/promotions-import']) assert.ok(rep.menu.some((l) => l.h === h), 'קישורי התת-תפריט של "כרטיס הטבות": ' + h);
  const pf = rep.files.find((f) => f.page === 'promos');
  assert.ok(pf && !pf.none, JSON.stringify(rep.files));
  assert.equal(pf.hi, 1); assert.deepEqual(pf.hdr, ['מספר מבצע', 'שם מבצע', 'מתאריך', 'עד תאריך', 'סוג מבצע', 'מחיר מבצע', 'סטטוס']);
  assert.deepEqual(pf.kinds[2], ['num', 'text', 'date', 'date', 'text', 'num', 'text']);
  assert.equal(await caspitPage().evaluate(() => localStorage.getItem('prmX')), '1', '"יצוא לאקסל" נלחץ פעם אחת');
  for (const nm of ['קוקה קולה', 'במבה', 'X+Y', '30/11/2026']) assert.ok(!txt.includes(nm), 'תוכן מבצע בדוח: ' + nm);
  // 0.1.12: מסך הייבוא – קריאה בלבד: בלי שום לחיצה / פוקוס / שינוי (impClicks של הרינדור האחרון), בלי בחירת סוג ובלי קובץ
  const is = rep.pages.find((p) => p.name === 'imp-screen');
  assert.equal(is.ok, true); assert.equal(is.ro, true); assert.equal(is.hash, '#/csv-imports'); assert.equal(is.probe, undefined);
  assert.equal(await caspitPage().evaluate(() => localStorage.getItem('impClicks')), '0', 'במסך הייבוא לא נלחץ כלום');
  assert.ok(is.controls.some((c) => c.id === 'job_type') && !is.controls.some((c) => c.id === 'positive-file-uploader'), 'הסוג לא נבחר – שדה הקובץ לא נחשף');
  assert.ok(is.scr && is.scr.heads.includes('טעינות קודמות') && is.scr.qhead === 'none', JSON.stringify(is.scr));
  assert.deepEqual(is.scr.files, []);
  assert.ok(is.scr.tables.some((t) => t.th.includes('סוג קובץ') && t.rows >= 2), JSON.stringify(is.scr.tables));
  assert.ok(is.scr.btns.includes('העלה קבצים והרץ טעינה'), JSON.stringify(is.scr.btns));
  assert.ok(!JSON.stringify(is).includes('ישן.csv') && !JSON.stringify(is).includes('בעל העסק'), 'בלי תוכן תאים מהטבלה');
  // עובדים (0.1.9): רשימת העובדים – קריאה בלבד, בכתובת ישירה; כותרות הטבלה בלי השורות, טקסט רק של כפתורי פעולה
  const emp = rep.pages[3];
  assert.equal(emp.ok, true, JSON.stringify(emp));
  assert.equal(emp.ro, true); assert.equal(emp.hash, '#/employees');
  assert.deepEqual(emp.heads, [['שם', 'כרטיס מגנטי', 'טלפון נייד', 'מנהל', 'סטטוס', 'פעולות']]);
  assert.ok(emp.controls.every((c) => (c.text === undefined || c.text === 'יצוא לאקסל') && c.options === undefined && c.aria === undefined), JSON.stringify(emp.controls));
  // שעות לעובד: "הצג רק עובדים פעילים" → "שעות לעובד" של העובד הפעיל הראשון → "יצוא לאקסל" של דף השעות. החודש – ברירת המחדל
  const eh = rep.pages[4];
  assert.equal(eh.ok, true, JSON.stringify(eh.probe));
  assert.deepEqual(eh.probe.map((x) => [x.op, x.found, x.done]), [['nav', true, true], ['waitFor', true, true], ['click', true, true], ['click', true, true], ['waitFor', true, true], ['click', true, true]]);
  assert.equal(eh.hash, '#/employee-time-tracks/{id}', 'מזהה העובד מוחלף כולו');
  assert.equal(eh.title, undefined, 'בדף priv – בלי כותרת הדף');
  assert.ok(eh.controls.every((c) => c.options === undefined && c.aria === undefined && c.placeholder === undefined), JSON.stringify(eh.controls));
  assert.ok(eh.controls.some((c) => c.text === 'יצוא לאקסל') && eh.controls.some((c) => c.id === 'ttAdd'), 'פקדי דף השעות נאספו (בלי טקסט חופשי)');
  const bo0 = caspitPage();
  assert.equal(await bo0.evaluate(() => localStorage.getItem('empVisit')), '12', 'נכנסנו לעובד הפעיל הראשון (התיבה סומנה)');
  const hf = rep.files.find((f) => f.flow === 'empHours');
  assert.ok(hf && !hf.none, 'קובץ השעות נתפס: ' + JSON.stringify(rep.files));
  assert.equal(hf.ext, 'csv'); assert.equal(hf.rows, 4); assert.equal(hf.kind, null);
  // 0.1.10: שורת הכותרות רק דרך רשימה לבנה (שורת הכותרת עם שם העובד – לא נבחרת), ומ-5 השורות הראשונות רק סוג התא
  assert.deepEqual(hf.hdr, ['תאריך', 'כניסה', 'יציאה', 'שעות רגילות', '125%', '150%'], JSON.stringify(hf));
  assert.equal(hf.hi, 1);
  assert.deepEqual(hf.kinds, [['text'], ['text', 'text', 'text', 'text', 'num', 'num'], ['date', 'time', 'time', 'time', 'num', 'num'], ['date', 'time', 'time', 'time', 'num', 'num']]);
  // פרטיות: אין שמות עובדים, טלפונים או שעות מהרשימה / מדף השעות / מהקובץ
  for (const nm of ['שפרינצק', 'רוזנצוויג', 'טננבאום', '7654321', '7654322', '07:41', '15:58', '8:17', '07:39']) assert.ok(!txt.includes(nm), 'שם / טלפון / שעה של עובד בדוח: ' + nm);
  assert.ok(rep.menu.some((l) => l.t === 'רשימת עובדים' && l.h === '#/employees'), JSON.stringify(rep.menu));
  // לא נלחצו: "עריכה", "עובד חדש", "הצג רק מנהלים", "יצוא לאקסל" של הרשימה, "הוספת כניסה ויציאה", ולא "עובדים" בתפריט
  assert.equal(await bo0.evaluate(() => localStorage.getItem('attHits')), null, 'לא נלחץ שום כפתור אסור');
  // לקוחות הקפה (0.1.11): כל 8 המסכים, קריאה בלבד; "יצוא לאקסל" רק בזרימה hkExport; כותרות – רק מהרשימה הלבנה
  const HKH = { 'hk-customers': '#/hakafa-customers', 'hk-reports': '#/hakafa-reports', 'hk-cust-reports': '#/hakafa-customer-reports', 'hk-sales-lines': '#/customer-sales-report', 'hk-sales-total': '#/total-sales-per-customer', 'hk-monthly': '#/hakafa_monthly_charge_customers', 'hk-merakez': '#/merakez_invoices', 'hk-shipments': '#/customer-shipments', 'hk-sales-all': '#/total-sales-all-customers' };
  const DOCP = ['hk-sales-lines', 'hk-sales-total', 'hk-merakez', 'hk-shipments', 'hk-sales-all'];
  for (const n of HKP) {
    const p = rep.pages.find((x) => x.name === n);
    assert.equal(p.hash, HKH[n], n + ' ' + p.hash);
    assert.equal(p.title, undefined, n + ': בלי כותרת הדף');
    assert.ok(p.controls.length > 5 && p.controls.every((c) => c.options === undefined && c.aria === undefined && c.placeholder === undefined && (c.text === undefined || /^(הצג|יצוא לאקסל|לאקסל|הפק דוח)$/.test(c.text))), n + ' ' + JSON.stringify(p.controls.filter((c) => c.text || c.options)));
    assert.ok((DOCP.includes(n) || p.controls.some((c) => c.id === 'hkFrom' && c.type === 'date')) && p.controls.some((c) => c.id === 'hkStore' && c.optN === 3), n + ': פקדי הסינון (תאריך, סניף) נאספו');
    assert.ok(Array.isArray(p.heads) && p.heads.length === 1, n + ' ' + JSON.stringify(p.heads));
  }
  const hp = (n) => rep.pages.find((x) => x.name === n);
  assert.deepEqual(hp('hk-customers').heads, [['מספר לקוח', 'שם לקוח', 'ח.פ/ע.מ', 'טלפון', 'כתובת', 'יתרה', 'פעולות']]);
  assert.deepEqual(hp('hk-cust-reports').heads, [['מספר לקוח', 'שם לקוח', 'יתרה', '?']], 'כותרת עם שם לקוח → ?');
  assert.deepEqual(hp('hk-sales-total').heads, [['שם לקוח', 'ח.פ/ע.מ', 'סה"כ', '?']]);
  assert.equal(hp('hk-monthly').ro, true); assert.equal(hp('hk-monthly').flow, undefined, 'הפקת חשבוניות מרכזות – בלי זרימה');
  assert.deepEqual(hp('hk-customers').probe.map((x) => [x.op, x.found, x.done]), [['click', true, true]]);
  assert.deepEqual(hp('hk-sales-total').probe.map((x) => [x.op, x.found, x.done]), [['setDate', true, true], ['setDate', true, true], ['click', true, true], ['click', false, false]], 'אין יצוא – לא לוחצים');
  const tr = hp('hk-shipments').probe[3];
  assert.equal(tr.err, 'denied', '"שמירה ויצוא לאקסל" – נחסם: ' + JSON.stringify(tr)); assert.equal(tr.done, false);
  const hf2 = rep.files.filter((f) => /^hk-/.test(f.page)); // 0.1.12: גם מבצעים / אמצעי תשלום משתמשים ב-hkExport; 0.1.13: מסמכי ההקפה – hkDocs
  assert.deepEqual(hf2.map((f) => [f.page, !f.none]), [['hk-customers', true], ['hk-reports', true], ['hk-cust-reports', true], ['hk-sales-lines', true], ['hk-sales-total', false], ['hk-merakez', true], ['hk-shipments', false], ['hk-sales-all', false]], JSON.stringify(hf2));
  // 0.1.13 מסמכי הקפה (hkDocs): חלון השגיאה נסגר ב"אישור" (הטקסט מתועד), טווח החודש הקודם, "הצג" בלי לבחור לקוח, כותרות ומספר שורות
  { const yd = D.addDays(today, -1), [yy, mm] = yd.split('-').map(Number), pf0 = (mm === 1 ? yy - 1 : yy) + '-' + String(mm === 1 ? 12 : mm - 1).padStart(2, '0') + '-01', pt0 = D.addDays(yd.slice(0, 8) + '01', -1);
    assert.equal(await bo0.evaluate(() => localStorage.getItem('dlgOk')), 'merakez_invoices;total-sales-all-customers;');
    assert.equal(await bo0.evaluate(() => localStorage.getItem('hkShow')), ['customer-sales-report', 'total-sales-per-customer', 'total-sales-all-customers'].map((k) => [k, pf0, pt0, 'כל הלקוחות'].join('|') + ';').join(''));
    for (const n of DOCP) { const d0 = hp(n).docs; assert.ok(d0 && d0.month === pt0.slice(5, 7) + '/' + pt0.slice(0, 4) && d0.d1 === 1 && d0.d2 === +pt0.slice(8), n + ' ' + JSON.stringify(d0)); }
    const mz = hp('hk-merakez').docs;
    // תיקון בודק: בדף priv – רק סיווג החלון / ההודעה, בלי הטקסט
    assert.deepEqual(mz.dlg, [{ k: 'err', closed: true }]);
    assert.ok(!txt.includes('חלה שגיאה') && !txt.includes('צור קשר עם התמיכה'), 'טקסט חלון השגיאה בדוח');
    assert.ok(DOCP.every((n) => hp(n).docs.msgs.every((m) => m === 'err' || m === 'nodata')));
    assert.equal(rep.brStart, 'ok', 'בתחילת ההיכרות – וידוא יהודה הנשיא');
    // צילום מסך 21.11: בלי "הצג"; "יצוא לאקסל" נחשף רק אחרי סגירת החלון – ונלחץ
    assert.equal(mz.show.found, false);
    assert.deepEqual(mz.tables[0].th, ['מספר פתקית', 'תאריך הפקה', 'חשבונית', 'פעולות']); assert.equal(mz.tables[0].rows, 2);
    assert.equal(hp('hk-merakez').probe[3].done, true, JSON.stringify(hp('hk-merakez').probe));
    assert.deepEqual(mz.tables[0].hrefs, ['#/invoice/{id}']); assert.deepEqual(mz.tables[0].bw, ['עריכה']);
    assert.equal(hp('hk-shipments').docs.show.found, false, 'בלי "הצג" מפורש ("הפק דוח" אסור) – לא לוחצים');
    assert.equal(hp('hk-sales-lines').docs.dlg.length, 0); }
  for (const f of hf2.filter((x) => !x.none)) {
    assert.equal(f.ext, 'csv'); assert.equal(f.rows, 4); assert.equal(f.hi, 1);
    assert.deepEqual(f.hdr, ['מספר לקוח', 'שם לקוח', 'ח.פ/ע.מ', 'טלפון', 'כתובת', 'יתרה', '?'], JSON.stringify(f));
    assert.deepEqual(f.kinds[2], ['num', 'text', 'num', 'text', 'text', 'num', 'date']);
  }
  assert.equal(await bo0.evaluate(() => localStorage.getItem('hkX')), 'hakafa-customers;hakafa-reports;hakafa-customer-reports;customer-sales-report;merakez_invoices;hakafa-customers;hakafa-reports;', 'יצוא לאקסל – רק במסכים שמותר (ושוב hk-customers / hk-reports בנחל לכיש)');
  // פרטיות: אין שמות לקוחות, טלפונים, ע.מ, כתובות או סכומים מהמסכים / מהקבצים
  for (const nm of ['שלומציון', 'ברקוביץ', 'פנינת', 'מרכולית', '514789632', '036547891', '9876543', '6712345', 'הדקל', 'אשקלון', 'שדרות', '1234.5', '88.2', 'סיווג פנימי', 'כהן', 'משה', 'כרטסת', 'c-4521', 'pick-c1001', 'cust_1001', 'cust_']) assert.ok(!txt.includes(nm), 'פרט לקוח בדוח: ' + nm);
  // תיקוני בודק 0.1.11: מהרכיב שנלחץ / נחסם – רק tag ו-css; פקד בתוך טבלה – בלי id/name; יומן הרשת – מקטע עם ספרה → '?'
  for (const n of HKP) for (const x of hp(n).probe || []) assert.ok(!x.el || (x.el.text === undefined && Object.keys(x.el).every((k) => k === 'tag' || k === 'css')), n + ' ' + JSON.stringify(x.el));
  assert.equal(hp('hk-cust-reports').probe[0].done, true, 'יצוא עם שם על הכפתור – נלחץ (יצוא מותר), אבל השם לא נשלח');
  assert.ok(hp('hk-customers').controls.some((c) => c.inData && c.type === 'checkbox' && c.id === undefined && c.name === undefined), JSON.stringify(hp('hk-customers').controls.filter((c) => c.inData)));
  assert.ok(rep.net.some((e) => e.pv && e.p === '/bo/api/customers/?/docs'), JSON.stringify(rep.net.filter((e) => e.pv).map((e) => e.p)));
  assert.ok(rep.net.some((e) => !e.pv && /^\/bo\//.test(e.p)), 'בקשות לפני הדף הפרטי הראשון – כמו קודם');
  assert.ok(rep.menu.some((l) => l.t === 'לקוחות הקפה' && l.h === '#/hakafa-customers'), JSON.stringify(rep.menu));
  const imp = rep.pages[1];
  assert.ok(!imp.controls.some((c) => c.type === 'password'));
  assert.ok(imp.probe.every((p) => !p.done || ['nav', 'waitFor', 'text', 'select', 'histMark'].includes(p.op)), 'no change made on csv-imports: ' + JSON.stringify(imp.probe));
  // היכרות v2: אפשרויות רשימת סוג הקובץ, ואחרי בחירה (רק לחשיפה) – שדה הקובץ וכפתור הטעינה; אף קובץ לא הועלה
  assert.deepEqual(imp.peek[0].items, ['טעינת פריטים חדשים', 'טעינת מועדון לקוחות', 'טעינת לקוחות הקפה', 'עדכון מחיר לצרכן ו/או מחיר עלות לפריטים', 'עדכון מחיר בחנות', 'עדכון פריטים', 'טעינת פריטים חדשים מנטפוס']);
  assert.ok(imp.controls.some((c) => c.id === 'positive-file-uploader' && c.type === 'file') && imp.controls.some((c) => c.text === 'הורד קובץ דוגמה'), 'שדה הקובץ נחשף אחרי בחירת הסוג');
  assert.ok(!imp.controls.some((c) => c.text === 'טען קובץ'), 'בלי קובץ – אין כפתור טעינה (לא נבחר קובץ)');
  assert.ok(!imp.probe.some((p) => (p.op === 'setFile' || p.op === 'click') && p.done), 'בלי קובץ ובלי לחיצה על טעינה');
  const sp = rep.pages[2];
  assert.equal(sp.peek[0].found, true); assert.ok(sp.peek[0].struct && /vdp-datepicker__calendar/.test(sp.peek[0].struct.cls), JSON.stringify(sp.peek[0]));
  assert.ok(sp.probe.filter((p) => p.op === 'setDate').every((p) => p.done), 'בחירת תאריך בלוח השנה: ' + JSON.stringify(sp.probe));
  const fs1 = rep.net.find((n) => n.p === '/bo/merkaz/upload_csv_index');
  assert.deepEqual(Object.keys(fs1.keys.meta.files_structure[0]).sort(), ['columns', 'job_type', 'not_required_columns', 'skip_unnecessary_columns']);
  const catFile = rep.files.find((f) => f.flow === 'catalog');
  assert.equal(catFile.kind, 'cat');
  assert.ok(catFile.hdr.includes('מחיר לצרכן'));
  assert.equal(rep.files.find((f) => f.flow === 'sales').kind, 'sales');
  const net = rep.net.find((n) => /full_report/.test(n.p));
  assert.ok(net && net.q.includes('token={s}') && net.rh.includes('authorization'), JSON.stringify(rep.net));
  const me = rep.net.find((n) => n.p === '/api/me');
  assert.equal(me.keys.email, 'string');
  assert.equal(imports.filter((i) => i.type === 'cust').length, 0);
  await pop.reload();
  await pop.waitForSelector('#dl:not(.hide)');
  const [dl] = await Promise.all([pop.waitForEvent('download'), pop.click('#dl')]);
  const file = path.join(tmp, 'disc.json');
  await dl.saveAs(file);
  const got = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(got.kind, 'disc');
  await pop.click('#send');
  await pop.waitForFunction(() => document.getElementById('msg').textContent.includes('נשלח'));
  const sent = srv.ops('report').at(-1);
  assert.equal(sent.kind, 'disc');
  for (const x of SECRETS) assert.ok(!JSON.stringify(sent).includes(x), 'leaked to server ' + x);
  await pop.close();
});

test('שמירה: כספית מעבירה לקופה (לא /bo) → wrong-page מיד, בלי שום לחיצה בקופה; דיווח לשרת; בלי ניסיון חוזר', async () => {
  const cp = caspitPage();
  assert.match(cp.url(), /^https:\/\/caspit\.valu\.co\.il\/bo#\//, 'הלשונית של התוסף במשרד האחורי');
  await cp.evaluate(() => localStorage.setItem('posHits', '0'));
  // כמו התקלה האמיתית: מסך הייבוא מעביר ל-/csv-imports#/csv-imports (לא במשרד האחורי)
  await cp.evaluate(() => localStorage.setItem('redir', '#/csv-imports'));
  srv.exportN.new = 1;
  await sw.evaluate(async () => { const { impHash } = await chrome.storage.local.get('impHash'); await chrome.storage.local.set({ impHash: {} }); void impHash; });
  let t0 = Date.now();
  await sw.evaluate(() => self.__cxTest.startRun({ manual: true }));
  let s = await waitRun(t0);
  assert.equal(s.st.lastRun.code, 'wrong-page', JSON.stringify(s.st.lastRun));
  assert.equal(s.st.lastRun.st, 'fail');
  assert.equal(srv.ops('report').at(-1).err.code, 'wrong-page');
  assert.equal(await sw.evaluate(async () => !!(await chrome.alarms.get('retry'))), false);
  let pos = ctx.pages().find((p) => /caspit\.valu\.co\.il\/(?!bo)/.test(p.url()));
  assert.ok(pos, 'הלשונית הגיעה לקופה המדומה');
  assert.equal(await posHits(pos), 0, 'אף לחיצה / שינוי בקופה');
  // לשונית שכבר בקופה (שורש האתר): התוסף לא משתמש בה – פותח לשונית חדשה במשרד האחורי; ואם גם היא עוברת לקופה – עוצר מיד
  await pos.evaluate(() => { localStorage.removeItem('redir'); localStorage.setItem('redirLoad', '1'); });
  await pos.goto('https://caspit.valu.co.il/');
  t0 = Date.now();
  await sw.evaluate(() => self.__cxTest.startRun({ manual: true }));
  s = await waitRun(t0);
  assert.equal(s.st.lastRun.code, 'wrong-page', JSON.stringify(s.st.lastRun));
  assert.equal(s.st.lastRun.step, 'login');
  for (const p of ctx.pages().filter((x) => /caspit\.valu\.co\.il\/(?!bo)/.test(x.url()))) assert.equal(await posHits(p), 0);
  await pos.evaluate(() => localStorage.removeItem('redirLoad'));
  srv.exportN.new = 1;
});

test('היכרות לא יוצאת מהמשרד האחורי: מסך שמעביר לקופה → wrong-page, בלי לחיצות', async () => {
  const anyPage = ctx.pages().find((p) => p.url().startsWith('https://caspit.valu.co.il/'));
  await anyPage.evaluate(() => { localStorage.setItem('redir', '#/csv-imports'); localStorage.setItem('posHits', '0'); });
  await sw.evaluate(() => chrome.storage.local.remove(['disc', 'discSt']));
  const pop = await ctx.newPage();
  await pop.goto(`chrome-extension://${EXT_ID}/popup.html`);
  await pop.click('#disc');
  const s = await waitFor(async () => { const x = await store(); return x.discSt && x.discSt.st !== 'run' && x.disc ? x : null; }, 180e3, 'discovery');
  assert.equal(s.discSt.st, 'fail');
  assert.equal(s.disc.rep.err.code, 'wrong-page');
  assert.deepEqual(s.disc.rep.pages.map((p) => p.name), ['catalogs'], 'עצר לפני שאסף משהו מהקופה');
  for (const p of ctx.pages().filter((x) => /caspit\.valu\.co\.il\/(?!bo)/.test(x.url()))) assert.equal(await posHits(p), 0);
  await anyPage.evaluate(() => localStorage.removeItem('redir')).catch(() => {});
  await pop.close();
});

test('היכרות עובדים: המסך מוביל אל מחוץ למשרד האחורי → wrong-page, בלי לאסוף מהקופה ובלי לחיצות', async () => {
  const cp = caspitPage() || ctx.pages().find((p) => p.url().startsWith('https://caspit.valu.co.il/'));
  await cp.evaluate(() => { localStorage.setItem('redir', '#/employees'); localStorage.setItem('posHits', '0'); localStorage.removeItem('attHits'); });
  await sw.evaluate(() => chrome.storage.local.remove(['disc', 'discSt']));
  const pop = await ctx.newPage();
  await pop.goto(`chrome-extension://${EXT_ID}/popup.html`);
  await pop.click('#disc');
  const s = await waitFor(async () => { const x = await store(); return x.discSt && x.discSt.st !== 'run' && x.disc ? x : null; }, 240e3, 'discovery');
  assert.equal(s.discSt.st, 'fail');
  assert.equal(s.disc.rep.err.code, 'wrong-page');
  assert.deepEqual(s.disc.rep.pages.map((p) => p.name), ['catalogs', 'csv-imports', 'sales'], 'עצר לפני שאסף משהו מהקופה');
  assert.ok(s.disc.rep.menu.some((l) => l.h === '#/employees'), 'רשימת הקישורים נשמרה גם כשהניווט נכשל');
  for (const p of ctx.pages().filter((x) => /caspit\.valu\.co\.il\/(?!bo)/.test(x.url()))) assert.equal(await posHits(p), 0);
  const bo = ctx.pages().find((p) => /caspit\.valu\.co\.il\/bo/.test(p.url()));
  if (bo) assert.equal(await bo.evaluate(() => localStorage.getItem('attHits')), null);
  await cp.evaluate(() => localStorage.removeItem('redir')).catch(() => {});
  await pop.close();
});

test('ייבוא: בתור "ממתין לטעינה" כבר יש קובץ של מישהו אחר → import-queue-not-empty; לא מעלים, לא מסירים', async () => {
  const cp = caspitPage();
  await cp.evaluate(() => { localStorage.removeItem('redir'); localStorage.removeItem('redirLoad'); localStorage.setItem('preq', 'someone-else.csv'); });
  await sw.evaluate(async () => { (await self.__cxTest.sel()).importEnabled = true; await chrome.storage.local.set({ impHash: {} }); });
  srv.exportN.new = 1;
  const nImp = imports.length, t0 = Date.now();
  await sw.evaluate(() => self.__cxTest.startRun({ manual: true }));
  const s = await waitRun(t0);
  assert.equal(s.st.lastRun.code, 'import-queue-not-empty', JSON.stringify(s.st.lastRun));
  assert.equal(s.st.lastRun.step, 'exportNew');
  assert.equal(imports.length, nImp, 'שום קובץ לא הועלה');
  const tabs = ctx.pages().filter((p) => /caspit\.valu\.co\.il\/bo/.test(p.url()));
  const evs = (await Promise.all(tabs.map((p) => p.evaluate(() => window.ev || []).catch(() => [])))).flat();
  assert.ok(!evs.includes('run') && !evs.includes('rm'), 'לא נלחץ "העלה קבצים והרץ טעינה" ולא "הסר": ' + evs.join('|'));
  assert.equal(srv.ops('report').at(-1).err.code, 'import-queue-not-empty');
  await cp.evaluate(() => localStorage.removeItem('preq'));
});

test('ניסיון חוזר: הקובץ של הריצה כבר ב"טעינות קודמות" → לא מעלים שוב, התוצאה נקראת מהשורה הקיימת', async () => {
  const cp = caspitPage();
  srv.runId = 'retryrun1';
  await cp.evaluate(() => { localStorage.removeItem('preq'); localStorage.removeItem('imperr'); localStorage.removeItem('imphang'); const L = JSON.parse(localStorage.getItem('hist') || '[]'); const mx = Math.max(25520, ...L.map((x) => x.id)); L.push({ id: mx + 1, name: 'lp-new-retryrun1.csv', tn: 'טעינת פריטים חדשים', st: 'בוצע', c: 'שגויים: 0, נטענו: 1' }); localStorage.setItem('hist', JSON.stringify(L)); window.ev = []; });
  await sw.evaluate(async () => { (await self.__cxTest.sel()).importEnabled = true; await chrome.storage.local.set({ impHash: {} }); });
  srv.exportN.new = 1; srv.exportN.price = 0;
  const nImp = imports.length, t0 = Date.now();
  await sw.evaluate(() => self.__cxTest.startRun({ manual: true }));
  const s = await waitRun(t0);
  assert.equal(s.st.lastRun.st, 'ok', JSON.stringify(s.st.lastRun));
  assert.equal(imports.length, nImp, 'לא הועלה קובץ נוסף');
  const ir = srv.ops('importResult').at(-1);
  assert.equal(ir.kind, 'new'); assert.equal(ir.ok, true); assert.equal(ir.loaded, 1);
  const tabs = ctx.pages().filter((p) => /caspit\.valu\.co\.il\/bo/.test(p.url()));
  const evs = (await Promise.all(tabs.map((p) => p.evaluate(() => window.ev || []).catch(() => [])))).flat();
  assert.ok(!evs.includes('run'), 'לא נלחץ "העלה קבצים והרץ טעינה": ' + evs.join('|'));
  delete srv.runId; srv.exportN.price = 2;
});

test('"טעינות קודמות" נטענת באיחור → מחכים לה ומעלים פעם אחת; לא מופיעה בכלל → selector-miss בלי העלאה ובלי קובץ בתור', async () => {
  const cp = caspitPage();
  await cp.evaluate(() => { localStorage.setItem('histlate', '1'); });
  await sw.evaluate(async () => { (await self.__cxTest.sel()).importEnabled = true; await chrome.storage.local.set({ impHash: {} }); });
  srv.exportN.new = 1; srv.exportN.price = 0;
  let nImp = imports.length, t0 = Date.now();
  await sw.evaluate(() => self.__cxTest.startRun({ manual: true }));
  let s = await waitRun(t0);
  assert.equal(s.st.lastRun.st, 'ok', JSON.stringify(s.st.lastRun));
  assert.equal(imports.length, nImp + 1, 'הועלה בדיוק קובץ אחד');
  await cp.evaluate(() => { localStorage.removeItem('histlate'); localStorage.setItem('histnone', '1'); });
  await sw.evaluate(async () => { await chrome.storage.local.set({ impHash: {} }); });
  nImp = imports.length; t0 = Date.now();
  await sw.evaluate(() => self.__cxTest.startRun({ manual: true }));
  s = await waitRun(t0);
  assert.equal(s.st.lastRun.code, 'selector-miss', JSON.stringify(s.st.lastRun));
  assert.equal(imports.length, nImp, 'לא הועלה כלום');
  const tabs = ctx.pages().filter((p) => /caspit\.valu\.co\.il\/bo/.test(p.url()));
  const q = (await Promise.all(tabs.map((p) => p.evaluate(() => document.querySelectorAll('#queue tr').length).catch(() => 0)))).reduce((a, b) => a + b, 0);
  assert.equal(q, 0, 'הקובץ שלנו לא נוסף לתור');
  await cp.evaluate(() => localStorage.removeItem('histnone'));
  srv.exportN.price = 2;
});

// 0.1.6 – התקלה של 19.11: הקובץ לא נכנס ל"ממתין לטעינה" בבחירה הרגילה. ניסיונות חלופיים: גרירה, ואז סוג קובץ של Excel
// 0.1.13 – האבחון מ-22.11: hidvis – הקובץ חייב להיכנס לשדה הגלוי שליד "בחר קובץ" (לא ל-#positive-file-uploader המוסתר); hidlast – רק המוסתר עובד (חלופה אחרונה)
for (const [mode, evx] of [['drop', 'drop'], ['xls', 'add:application/vnd.ms-excel'], ['hidvis', 'vis-change'], ['hidlast', 'hidden-change']]) {
  test(`העלאה: בחירה רגילה לא נקלטת (${mode}) → ניסיון חלופי, קובץ אחד בדיוק בתור ומועלה פעם אחת`, async () => {
    const cp = caspitPage();
    await cp.evaluate((m) => { localStorage.removeItem('preq'); localStorage.removeItem('imperr'); localStorage.removeItem('imphang'); localStorage.setItem('upmode', m); }, mode);
    await Promise.all(ctx.pages().filter((p) => /caspit\.valu\.co\.il\/bo/.test(p.url())).map((p) => p.evaluate(() => { window.ev = []; }).catch(() => {})));
    await sw.evaluate(async () => { (await self.__cxTest.sel()).importEnabled = true; await chrome.storage.local.set({ impHash: {} }); });
    srv.exportN.new = 0; srv.exportN.price = 2;
    const nImp = imports.length, t0 = Date.now();
    await sw.evaluate(() => self.__cxTest.startRun({ manual: true }));
    const s = await waitRun(t0);
    assert.equal(s.st.lastRun.st, 'ok', JSON.stringify(s.st.lastRun));
    assert.equal(imports.length, nImp + 1, 'הועלה בדיוק קובץ אחד');
    assert.equal(imports.at(-1).type, 'price');
    const tabs = ctx.pages().filter((p) => /caspit\.valu\.co\.il\/bo/.test(p.url()));
    const evs = (await Promise.all(tabs.map((p) => p.evaluate(() => window.ev || []).catch(() => [])))).flat();
    assert.ok(evs.includes(evx), evs.join('|'));
    assert.equal(evs.filter((e) => e.startsWith('add:')).length, 1, 'נוסף לתור פעם אחת בלבד: ' + evs.join('|'));
    if (mode === 'hidvis') assert.ok(!evs.includes('hidden-change'), 'השדה המוסתר לא נוגע כשהגלוי עובד: ' + evs.join('|'));
    if (mode === 'hidlast') assert.ok(evs.indexOf('vis-change') >= 0 && evs.indexOf('vis-change') < evs.indexOf('hidden-change'), 'קודם הגלוי, המוסתר רק בסוף: ' + evs.join('|'));
    await cp.evaluate(() => localStorage.removeItem('upmode'));
  });
}

test('העלאה: הקובץ לא נקלט בשום דרך → selector-miss עם אבחון (מסונן), בלי לחיצה על "העלה קבצים והרץ טעינה"', async () => {
  const cp = caspitPage();
  await cp.evaluate(() => { localStorage.setItem('upmode', 'none'); window.ev = []; });
  await Promise.all(ctx.pages().filter((p) => /caspit\.valu\.co\.il\/bo/.test(p.url())).map((p) => p.evaluate(() => { window.ev = []; }).catch(() => {})));
  await sw.evaluate(async () => { (await self.__cxTest.sel()).importEnabled = true; await chrome.storage.local.set({ impHash: {} }); });
  srv.exportN.new = 0; srv.exportN.price = 2;
  const nImp = imports.length, t0 = Date.now();
  await sw.evaluate(() => self.__cxTest.startRun({ manual: true }));
  const s = await waitRun(t0);
  assert.equal(s.st.lastRun.code, 'selector-miss', JSON.stringify(s.st.lastRun));
  assert.equal(s.st.lastRun.step, 'exportPrice');
  const msg = s.st.lastRun.msg;
  assert.match(msg, /לא נכנס ל"ממתין לטעינה" אחרי 3 ניסיונות/, msg);
  assert.match(msg, /שדות קובץ: 1/, msg);
  assert.match(msg, /הקובץ לא נקלט/, 'ההודעה הגלויה בדף: ' + msg);
  assert.match(msg, /יש לבחור קובץ מסוג CSV/, 'ההודעה לא נחתכה גם עם accept ארוך: ' + msg);
  assert.ok(!msg.includes('0521234567'), 'מספר טלפון סונן: ' + msg);
  assert.equal(srv.ops('report').at(-1).err.code, 'selector-miss');
  assert.equal(imports.length, nImp, 'לא הועלה כלום');
  const tabs = ctx.pages().filter((p) => /caspit\.valu\.co\.il\/bo/.test(p.url()));
  const evs = (await Promise.all(tabs.map((p) => p.evaluate(() => window.ev || []).catch(() => [])))).flat();
  assert.ok(!evs.includes('run'), 'לא נלחץ "העלה קבצים והרץ טעינה": ' + evs.join('|'));
  await cp.evaluate(() => localStorage.removeItem('upmode'));
});

// 0.1.12 – האבחון מ-20.11: הקובץ נבחר, אבל הכותרת "ממתין לטעינה" לא נמצאה. האבחון המורחב (info.scr) מראה מה כן יש במסך
test('העלאה: אין כותרת "ממתין לטעינה" → selector-miss כמו קודם + תמונת מסך מסוננת (info.scr) בדיווח, בלי תוכן תאים ובלי לחיצה על "העלה"', async () => {
  const cp = caspitPage();
  await cp.evaluate(() => { localStorage.removeItem('upmode'); localStorage.setItem('qhead', 'קבצים ממתינים'); });
  await Promise.all(ctx.pages().filter((p) => /caspit\.valu\.co\.il\/bo/.test(p.url())).map((p) => p.evaluate(() => { window.ev = []; }).catch(() => {})));
  await sw.evaluate(async () => { (await self.__cxTest.sel()).importEnabled = true; await chrome.storage.local.set({ impHash: {} }); });
  srv.exportN.new = 0; srv.exportN.price = 2;
  const nImp = imports.length, t0 = Date.now();
  await sw.evaluate(() => self.__cxTest.startRun({ manual: true }));
  const s = await waitRun(t0);
  try {
    assert.equal(s.st.lastRun.code, 'selector-miss', JSON.stringify(s.st.lastRun));
    assert.equal(s.st.lastRun.step, 'exportPrice');
    assert.match(s.st.lastRun.msg, /אין כותרת ממתין/, s.st.lastRun.msg);
    const rp = srv.ops('report').at(-1);
    assert.equal(rp.err.code, 'selector-miss');
    const sc = rp.info && rp.info.scr;
    assert.ok(sc, 'info.scr נשלח: ' + JSON.stringify(rp.info));
    assert.equal(sc.flow, 'importPrice'); assert.equal(sc.op, 'setFile'); assert.equal(sc.err, 'no-queue');
    assert.equal(sc.qhead, 'none');
    for (const h of ['קבצים ממתינים', 'טעינות קודמות', 'שים לב']) assert.ok(sc.heads.includes(h), h + ' ' + JSON.stringify(sc.heads));
    assert.ok(sc.wait.some((w) => w.t === 'קבצים ממתינים'), JSON.stringify(sc.wait));
    assert.ok(sc.tables.some((t) => t.th.join('|') === 'שם|סוג קובץ|פעולות' && t.rows >= 1), JSON.stringify(sc.tables));
    assert.ok(sc.btns.includes('העלה קבצים והרץ טעינה'), JSON.stringify(sc.btns));
    assert.equal(sc.files.length, 1); assert.equal(sc.files[0].lbl, 'בחר קובץ'); assert.equal(sc.files[0].css, 'input#positive-file-uploader');
    assert.deepEqual(sc.dialogs.map((d) => d.t), ['שים לב']);
    const txt = JSON.stringify(sc);
    for (const x of ['lp-price-', 'ישן.csv', 'עדכון מחיר (1).csv', 'בעל העסק', '0521234567', 'הודעה בתוך החלון']) assert.ok(!txt.includes(x), 'בלי תוכן תאים / טקסט חופשי: ' + x);
    assert.ok(txt.length <= 4000, 'קטן: ' + txt.length);
    assert.equal(imports.length, nImp, 'לא הועלה כלום');
    const tabs = ctx.pages().filter((p) => /caspit\.valu\.co\.il\/bo/.test(p.url()));
    const evs = (await Promise.all(tabs.map((p) => p.evaluate(() => window.ev || []).catch(() => [])))).flat();
    assert.ok(!evs.includes('run'), 'לא נלחץ "העלה קבצים והרץ טעינה": ' + evs.join('|'));
  } finally { await cp.evaluate(() => localStorage.removeItem('qhead')); }
});

test('ייבוא עם שגויים בכספית → import-errors (עם המספרים), בלי ניסיון חוזר; זמן קצוב → import-timeout', async () => {
  const cp = caspitPage();
  await cp.evaluate(() => { localStorage.removeItem('preq'); localStorage.setItem('imperr', '1'); });
  await sw.evaluate(async () => { (await self.__cxTest.sel()).importEnabled = true; await chrome.storage.local.set({ impHash: {} }); });
  srv.exportN.new = 1;
  let t0 = Date.now();
  await sw.evaluate(() => self.__cxTest.startRun({ manual: true }));
  let s = await waitRun(t0);
  assert.equal(s.st.lastRun.code, 'import-errors', JSON.stringify(s.st.lastRun));
  assert.match(s.st.lastRun.msg, /שגויים 1/);
  const ir = srv.ops('importResult').at(-1);
  assert.equal(ir.errors, 1); assert.equal(ir.ok, false); assert.ok(ir.id > 25521);
  assert.equal(await sw.evaluate(async () => !!(await chrome.alarms.get('retry'))), false);
  await cp.evaluate(() => { localStorage.removeItem('imperr'); localStorage.setItem('imphang', '1'); });
  await sw.evaluate(async () => { const S = await self.__cxTest.sel(); S.importWaitMs = 8000; await chrome.storage.local.set({ impHash: {} }); });
  t0 = Date.now();
  await sw.evaluate(() => self.__cxTest.startRun({ manual: true }));
  s = await waitRun(t0);
  assert.equal(s.st.lastRun.code, 'import-timeout', JSON.stringify(s.st.lastRun));
  assert.match(s.st.lastRun.msg, /בתהליך/);
  await cp.evaluate(() => localStorage.removeItem('imphang'));
  await sw.evaluate(async () => { (await self.__cxTest.sel()).importWaitMs = 600000; });
});

test('העלאה לכספית כבויה (importEnabled:false): קטלוג ומכירות בלבד – בלי export לשרת ובלי ייבוא; הריצה "הצליחה" עם imp:off; הודעה בחלון', async () => {
  const cp = caspitPage();
  await cp.evaluate(() => { localStorage.removeItem('redir'); localStorage.removeItem('redirLoad'); });
  await sw.evaluate(async () => { (await self.__cxTest.sel()).importEnabled = false; await chrome.storage.local.set({ impHash: {}, salesHash: {} }); });
  const nExp = srv.ops('export').length, nImp = imports.length, nUp = srv.ops('upload').length;
  const t0 = Date.now();
  await sw.evaluate(() => self.__cxTest.startRun({ manual: true }));
  const s = await waitRun(t0);
  assert.equal(s.st.lastRun.st, 'ok', JSON.stringify(s.st.lastRun));
  assert.equal(s.st.lastRun.sum.imp, 'off');
  assert.equal(srv.ops('export').length, nExp, 'בלי export – שום שורה לא מסומנת pd');
  assert.equal(imports.length, nImp, 'בלי ייבוא לכספית');
  assert.ok(srv.ops('upload').length > nUp, 'קטלוג ומכירות כן נשלחו');
  const rep = srv.ops('report').at(-1);
  assert.equal(rep.st, 'ok'); assert.equal(rep.info.imp, 'off');
  assert.ok(!rep.steps.some((x) => x.s === 'exportNew' || x.s === 'exportPrice'));
  const pop = await ctx.newPage();
  await pop.goto(`chrome-extension://${EXT_ID}/popup.html`);
  await pop.waitForFunction(() => !document.getElementById('impN').classList.contains('hide'));
  assert.match(await pop.textContent('#impN'), /ידנית בינתיים/);
  await pop.close();
  await sw.evaluate(async () => { (await self.__cxTest.sel()).importEnabled = true; });
});

test('עדכון אוטומטי (0.1.7): upd.json נקרא מהדיסק ונשלח ב-hello; גרסה חדשה בדיסק → רענון רק כשהסקריפט סיים, לא בזמן ריצה, פעם אחת לשעה', async () => {
  const mf = path.join(ext, 'manifest.json'), uf = path.join(ext, 'upd.json'), orig = fs.readFileSync(mf, 'utf8');
  const VER = JSON.parse(orig).version;
  await sw.evaluate(() => { self.__rl = 0; self.__cxTest.reload = () => { self.__rl++; }; return chrome.storage.local.remove(['updReload', 'upd']); });
  try {
    // בלי upd.json: "לא מותקן", בלי רענון
    assert.deepEqual(await sw.evaluate(() => self.__cxTest.updInfo()), { disk: VER, upd: null });
    assert.equal(await sw.evaluate(() => self.__cxTest.updTick()), false);
    // הסקריפט רץ ולא היה מה לעדכן → נשלח ב-hello
    fs.writeFileSync(uf, JSON.stringify({ v: 1, at: 1763500000000, ok: true, ver: VER, err: '', fails: 0 }));
    srv.exportN.new = 0; srv.exportN.price = 0;
    const t0 = Date.now();
    await sw.evaluate(() => self.__cxTest.startRun({ manual: true }));
    await waitRun(t0);
    const h = srv.ops('hello').at(-1);
    assert.deepEqual(h.upd, { at: 1763500000000, ok: true, ver: VER, err: '', fails: 0 }, JSON.stringify(h));
    // גרסה חדשה בדיסק, אבל upd.json עוד מהגרסה הקודמת (הסקריפט באמצע) → לא מרעננים
    fs.writeFileSync(mf, orig.replace(`"version": "${VER}"`, '"version": "9.9.9"'));
    assert.equal(await sw.evaluate(() => self.__cxTest.updTick()), false);
    // הסקריפט סיים (ok + אותה גרסה) → רענון אחד; ניסיון נוסף לאותה גרסה תוך שעה – לא
    fs.writeFileSync(uf, JSON.stringify({ v: 1, at: Date.now(), ok: true, ver: '9.9.9', err: '', fails: 0 }));
    assert.equal(await sw.evaluate(() => self.__cxTest.updTick()), true);
    assert.equal(await sw.evaluate(() => self.__cxTest.updTick()), false);
    assert.equal(await sw.evaluate(() => self.__rl), 1);
    // כישלון של הסקריפט (גרסה בדיסק שלא אושרה) → לא מרעננים, והמצב מוצג בחלון
    await sw.evaluate(() => chrome.storage.local.remove('updReload'));
    fs.writeFileSync(uf, JSON.stringify({ v: 1, at: Date.now(), ok: false, ver: VER, err: 'bad-hash <x>', fails: 2 }));
    assert.equal(await sw.evaluate(() => self.__cxTest.updTick()), false);
    const pop = await ctx.newPage();
    await pop.goto(`chrome-extension://${EXT_ID}/popup.html`);
    await pop.waitForFunction(() => /העדכון נכשל/.test(document.getElementById('upd').textContent));
    assert.match(await pop.textContent('#upd'), /bad-hash x/);
    await pop.close();
  } finally {
    fs.writeFileSync(mf, orig);
    fs.rmSync(uf, { force: true });
    await sw.evaluate(() => { self.__cxTest.reload = null; return chrome.storage.local.remove(['updReload', 'upd']); });
    srv.exportN.price = 2;
  }
});

test('מכירות היום כל שעה (0.1.10): רק דוח המכירות של היום, upload חלקי עם השעה; בלי hello / report / קטלוג; פעם אחת בשעה; לא בשבת; שרת ישן – לא', async () => {
  const TZ = 'Asia/Jerusalem', W = D.zonedToUtc('2026-11-18', '10:05', TZ); // יום רביעי
  const tt = (now) => sw.evaluate((n) => self.__cxTest.todayTick({ now: n }), now);
  const cnt = () => ({ hello: srv.ops('hello').length, report: srv.ops('report').length, cat: srv.ops('upload').filter((c) => c.items).length, part: srv.ops('upload').filter((c) => c.partial).length, exp: srv.ops('export').length });
  // בזמן הבדיקה – בלי ה-alarms שמפעילים ריצה שעתית "אמיתית" (לפי השעון של עכשיו) במקביל
  await sw.evaluate(async () => { await chrome.alarms.clear('tick'); await chrome.alarms.clear('hour'); return chrome.storage.local.remove(['caps', 'todaySt']); });
  srv.caps = null;
  // שרת ישן (בלי caps) – לא רץ
  assert.equal(await tt(W), null);
  srv.caps = ['today', 'uq'];
  await sw.evaluate(() => self.__cxTest.pollOnce());
  assert.deepEqual((await store()).caps, { today: true, uq: true, hours: false, hours2: false });
  const c0 = cnt(), H0 = (await store()).salesHash || {};
  const r = await tt(W);
  assert.equal(r && r.st, 'ok', JSON.stringify(r));
  assert.equal(r.n, 5); assert.equal(r.hm, '10:05'); assert.equal(r.day, '2026-11-18');
  assert.deepEqual(r.brs, [['יהודה הנשיא', 3], ['נחל לכיש', 2]], '(ה) ריצה שעתית לשני הסניפים');
  const up = srv.ops('upload').filter((c) => c.partial).at(-1);
  assert.equal(up.partial, true); assert.equal(up.kind, 'sales'); assert.equal(up.day, '2026-11-18'); assert.equal(up.hm, '10:05');
  assert.equal(up.part, 0); assert.equal(up.parts, 1); assert.equal(up.lines.length, 5); assert.ok(up.lines.every((l) => l.d === '2026-11-18'));
  assert.deepEqual([...new Set(up.lines.map((l) => l.bk))].sort(), ['1', '2'], 'העלאה חלקית אחת עם שני הסניפים');
  assert.equal(await caspitPage().evaluate(() => localStorage.getItem('store') || 'יהודה הנשיא'), 'יהודה הנשיא');
  assert.ok(salesReq.at(-1).includes('20261118'), 'דוח המכירות של היום: ' + salesReq.at(-1));
  const c1 = cnt();
  assert.deepEqual({ ...c1, part: 0 }, { ...c0, part: 0 }, 'בלי hello, report, קטלוג או קבצים לכספית');
  assert.equal(c1.part, c0.part + 1);
  assert.deepEqual((await store()).salesHash || {}, H0, 'לא נרשם כיום שנקלט');
  // אותה שעה – לא שוב; השעה הבאה – כן
  assert.equal(await tt(W + 20 * 60e3), null);
  assert.equal(cnt().part, c1.part);
  assert.equal((await tt(W + 60 * 60e3)).hm, '11:05');
  // לפני 07:00, שבת, ערב שבת מ-14:00 – לא
  assert.equal(await tt(D.zonedToUtc('2026-11-18', '06:30', TZ)), null);
  assert.equal(await tt(D.zonedToUtc('2026-11-21', '12:00', TZ)), null);
  assert.equal(await tt(D.zonedToUtc('2026-11-20', '15:00', TZ)), null);
  // ריצה פעילה עכשיו – לא; סנכרון לילי שממתין לניסיון חוזר / שעוד לא הצליח – לא עוצר
  const saved = await sw.evaluate(async () => (await chrome.storage.local.get(['run', 'st'])));
  await sw.evaluate(async () => { const { run } = await chrome.storage.local.get('run'); await chrome.storage.local.set({ run: Object.assign({}, run, { st: 'run', touchedAt: Date.now() }) }); });
  assert.equal(await tt(W + 2 * 3600e3), null, 'ריצה פעילה');
  await sw.evaluate(async () => { const { run, st } = await chrome.storage.local.get(['run', 'st']); await chrome.storage.local.set({ run: Object.assign({}, run, { st: 'wait', retryAt: Date.now() + 600e3, touchedAt: Date.now() }), st: Object.assign({}, st, { lastOkDay: '2000-01-01' }) }); });
  assert.equal((await tt(W + 2 * 3600e3)).st, 'ok', 'סנכרון לילי ממתין / לא הצליח – מכירות היום רצות בכל זאת');
  await sw.evaluate(async (x) => chrome.storage.local.set(x), saved);
  // השרת דוחה today-off (שעון) → השעה לא נלקחת
  srv.todayOff = true;
  const off = await tt(W + 3 * 3600e3);
  assert.equal(off.code, 'today-off'); assert.equal(off.slot, null);
  srv.todayOff = false;
  assert.equal((await tt(W + 3.1 * 3600e3)).st, 'ok', 'אותה שעה – ניסיון חוזר מותר');
  // שרת שלא מכיר partial (bad-field) → נכשל בשקט, ומפסיקים עד שהשרת יודיע אחרת
  srv.noPartial = true;
  const f = await tt(W + 4 * 3600e3);
  assert.equal(f.st, 'fail'); assert.equal(f.code, 'bad-field');
  assert.equal((await store()).caps.today, false);
  assert.equal(cnt().report, c0.report, 'בלי דיווח לשרת');
  srv.noPartial = false; srv.caps = null;
  await sw.evaluate(async () => { await chrome.storage.local.remove(['caps', 'todaySt']); await self.__cxTest.setupAlarms(); });
});

// ---------- 0.1.13: סניפים ----------
const store0 = () => caspitPage().evaluate(() => localStorage.getItem('store') || 'יהודה הנשיא');
const picks = () => caspitPage().evaluate(() => localStorage.getItem('brPicks') || '');
const ls = (o) => caspitPage().evaluate((x) => { for (const [k, v] of Object.entries(x)) { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } }, o);
async function syncOneDay() {
  srv.days = [days[1]];
  const n0 = srv.calls.length, t0 = Date.now();
  await sw.evaluate(() => self.__cxTest.startRun({ manual: true }));
  const s = await waitRun(t0);
  const calls = srv.calls.slice(n0);
  return { s, sales: calls.filter((c) => c.op === 'upload' && c.kind === 'sales'), rep: calls.filter((c) => c.op === 'report').at(-1) };
}
test('0.1.13 (ב) branch-same: נחל לכיש מחזיר את אותו סניף → רק יהודה הנשיא נשלח, הריצה "נכשלה" עם הערכים, חזרה ליהודה הנשיא', async () => {
  nlMode = 'same';
  try {
    const { s, sales, rep } = await syncOneDay();
    assert.equal(s.st.lastRun.st, 'fail', JSON.stringify(s.st.lastRun)); assert.equal(s.st.lastRun.code, 'branch-same');
    assert.equal(sales.length, 1); assert.equal(sales[0].lines.length, 3); assert.ok(sales[0].lines.every((l) => l.bk === '1'), 'רק יהודה הנשיא');
    assert.equal(rep.st, 'fail'); assert.equal(rep.err.code, 'branch-same');
    assert.match(rep.err.msg, /סניף א/); assert.match(rep.err.msg, /מספר: 1/);
    assert.ok(rep.info.sales[days[1]], 'היום נחשב שנקלט (יהודה הנשיא)'); assert.equal(rep.info.flags.br.code, 'branch-same');
    assert.equal(await store0(), 'יהודה הנשיא');
  } finally { nlMode = 'rows'; }
});
test('0.1.13 (ג) כישלון באמצע נחל לכיש (אין "צור קובץ") → יהודה הנשיא נשלח, חזרה ליהודה הנשיא, branch-sales', async () => {
  await ls({ nlNoBtn: '1', brPicks: null });
  try {
    const { s, sales, rep } = await syncOneDay();
    assert.equal(s.st.lastRun.code, 'branch-sales', JSON.stringify(s.st.lastRun));
    assert.equal(sales.length, 1); assert.ok(sales[0].lines.every((l) => l.bk === '1'));
    assert.match(rep.err.msg, /^נחל לכיש: /);
    assert.equal(await picks(), 'נחל לכיש;יהודה הנשיא;');
    assert.equal(await store0(), 'יהודה הנשיא');
  } finally { await ls({ nlNoBtn: null }); }
});
test('0.1.13 (ד) מעבר לנחל לכיש לא נקלט → branch-switch (יהודה הנשיא נשלח); החזרה ליהודה הנשיא נכשלת → branch-restore, הריצה נעצרת', async () => {
  await ls({ brFail: 'switch', brPicks: null });
  let r = await syncOneDay();
  assert.equal(r.s.st.lastRun.code, 'branch-switch', JSON.stringify(r.s.st.lastRun));
  assert.equal(r.sales.length, 1); assert.ok(r.sales[0].lines.every((l) => l.bk === '1'));
  assert.equal(await store0(), 'יהודה הנשיא');
  await ls({ brFail: 'restore', brPicks: null });
  try {
    r = await syncOneDay();
    assert.equal(r.s.st.lastRun.st, 'fail'); assert.equal(r.s.st.lastRun.code, 'branch-restore', JSON.stringify(r.s.st.lastRun));
    assert.equal(r.rep.err.code, 'branch-restore'); assert.equal(r.rep.st, 'fail');
    assert.equal(r.sales.length, 0, 'החזרה נכשלה – לא שולחים את היום');
    assert.ok(!r.s.st.lastRun.sum.sales[days[1]]);
    assert.equal(await store0(), 'נחל לכיש', 'כספית נשארה בנחל לכיש (הבחירה ביהודה הנשיא לא נקלטה)');
    // תחילת הריצה הבאה: הנבחר אינו יהודה הנשיא → מחזירים קודם (עכשיו מצליח), ואז הכול כרגיל
    await ls({ brFail: null, brPicks: null });
    r = await syncOneDay();
    assert.equal(r.s.st.lastRun.st, 'ok', JSON.stringify(r.s.st.lastRun));
    assert.ok((await picks()).startsWith('יהודה הנשיא;'), 'קודם חזרה ליהודה הנשיא: ' + (await picks()));
    assert.equal(await store0(), 'יהודה הנשיא');
  } finally { await ls({ brFail: null, store: 'יהודה הנשיא' }); }
});
test('0.1.13 היכרות לקוחות בנחל לכיש: כישלון באמצע (אין טבלה) → חזרה ליהודה הנשיא; החזרה נכשלת → branch-restore', async () => {
  await ls({ nlHkEmpty: '1', brPicks: null });
  try {
    let r = await sw.evaluate(() => self.__cxTest.discBr());
    assert.equal(r.out.err.code, 'selector-miss', JSON.stringify(r.out)); assert.equal(r.cur, 'יהודה הנשיא');
    assert.equal(await picks(), 'נחל לכיש;יהודה הנשיא;');
    await ls({ nlHkEmpty: null, brFail: 'restore' });
    r = await sw.evaluate(() => self.__cxTest.discBr());
    assert.equal(r.out.err.code, 'branch-restore', JSON.stringify(r.out)); assert.equal(r.cur, 'נחל לכיש');
  } finally { await ls({ nlHkEmpty: null, brFail: null, store: 'יהודה הנשיא' }); }
});

test('0.1.13 (תיקון בודק) שעתי: נחל לכיש נכשל → בלי העלאה חלקית בכלל (התמונה הקודמת של נחל לכיש לא נמחקת), רישום ב-todaySt', async () => {
  const TZ = 'Asia/Jerusalem', W = D.zonedToUtc('2026-11-18', '16:05', TZ);
  await sw.evaluate(async () => { await chrome.alarms.clear('tick'); await chrome.alarms.clear('hour'); await chrome.storage.local.set({ caps: { today: true, uq: false } }); return chrome.storage.local.remove('todaySt'); });
  nlMode = 'same';
  try {
    const n0 = srv.ops('upload').filter((c) => c.partial).length;
    const r = await sw.evaluate((n) => self.__cxTest.todayTick({ now: n }), W);
    assert.equal(r.st, 'fail', JSON.stringify(r)); assert.equal(r.code, 'branch-same'); assert.equal(r.br.code, 'branch-same');
    assert.equal(srv.ops('upload').filter((c) => c.partial).length, n0, 'לא הועלה כלום');
    assert.equal(await store0(), 'יהודה הנשיא');
  } finally { nlMode = 'rows'; await sw.evaluate(async () => { await chrome.storage.local.remove(['caps', 'todaySt']); await self.__cxTest.setupAlarms(); }); }
});
test('0.1.13 (תיקון בודק) היכרות שמתחילה כשכספית בנחל לכיש: קודם חזרה ליהודה הנשיא; לא מצליח → branch-restore, בלי לקרוא אף מסך', async () => {
  await ls({ store: 'נחל לכיש', brFail: 'restore', brPicks: null });
  // הלשונית של התוסף (/bo) – לא caspitPage(), שבסוויטה המלאה עלול להיות דף הקופה מבדיקה קודמת
  for (const p of ctx.pages().filter((x) => /caspit\.valu\.co\.il\/bo/.test(x.url()))) { await p.reload(); await p.waitForLoadState('load'); }
  assert.ok(ctx.pages().some((x) => /caspit\.valu\.co\.il\/bo/.test(x.url())), 'יש לשונית /bo');
  try {
    await sw.evaluate(() => chrome.storage.local.remove(['disc', 'discSt']));
    const pop = await ctx.newPage();
    await pop.goto(`chrome-extension://${EXT_ID}/popup.html`);
    await pop.click('#disc');
    const s = await waitFor(async () => { const x = await store(); return x.discSt && x.discSt.st !== 'run' && x.disc ? x : null; }, 120e3, 'discovery');
    await pop.close();
    assert.equal(s.discSt.st, 'fail'); assert.equal(s.disc.rep.err.code, 'branch-restore', JSON.stringify(s.disc.rep.err));
    assert.deepEqual(s.disc.rep.pages, [], 'לא נקרא אף מסך');
    assert.ok((await picks()).startsWith('יהודה הנשיא;'), await picks());
  } finally {
    await ls({ brFail: null, store: 'יהודה הנשיא' });
    await waitFor(async () => !(await sw.evaluate(() => self.__cxTest.isBusy())), 300e3, 'disc end'); // שהבדיקה הבאה לא תתחיל באמצע היכרות
  }
});

test('"עדכון המחשב" (0.1.10): בקשה מהטלפון (poll uq) → בדיקת הדיסק, תשובה לשרת (ack) פעם אחת, וטעינה מחדש רק כשיש גרסה חדשה שהועתקה; upd נשלח ב-poll רק כשהשתנה', async () => {
  const mf = path.join(ext, 'manifest.json'), uf = path.join(ext, 'upd.json'), orig = fs.readFileSync(mf, 'utf8');
  const VER = JSON.parse(orig).version;
  const pollOnce = () => sw.evaluate(() => self.__cxTest.pollOnce());
  await sw.evaluate(async () => { self.__rl = 0; self.__cxTest.reload = () => { self.__rl++; }; await chrome.alarms.clear('tick'); await chrome.alarms.clear('hour'); return chrome.storage.local.remove(['updReload', 'upd', 'updSent', 'lastUq', 'caps']); });
  try {
    srv.caps = ['today', 'uq'];
    fs.writeFileSync(uf, JSON.stringify({ v: 1, at: 1763500000000, ok: true, ver: VER, err: '', fails: 0 }));
    await pollOnce(); // לומדים את היכולות
    await pollOnce(); // עכשיו נשלח upd (השתנה)
    const withUpd = srv.ops('poll').filter((p) => p.upd);
    assert.deepEqual(withUpd.at(-1).upd, { at: 1763500000000, ok: true, ver: VER, err: '', fails: 0 });
    const n0 = withUpd.length;
    await pollOnce();
    assert.equal(srv.ops('poll').filter((p) => p.upd).length, n0, 'upd לא נשלח שוב כשלא השתנה');
    // בקשה: אין גרסה חדשה בדיסק → same, בלי טעינה
    srv.uq = 'qupd0001aa'; srv.uqTook = false;
    await pollOnce();
    let ack = srv.ops('poll').filter((p) => p.ack).at(-1);
    assert.deepEqual(ack && { ack: ack.ack, res: ack.res }, { ack: 'qupd0001aa', res: { st: 'same', cur: VER, disk: VER } });
    assert.equal(await sw.evaluate(() => self.__rl), 0);
    const nAck = srv.ops('poll').filter((p) => p.ack).length;
    srv.uqTook = false; // גם אם השרת עדיין מחזיר אותה – לא עונים שוב
    await pollOnce();
    assert.equal(srv.ops('poll').filter((p) => p.ack).length, nAck);
    // גרסה חדשה בדיסק שהמשימה סיימה להעתיק → reload (updReload: הבדיקה האוטומטית של כל דקה לא מקדימה את הבקשה)
    await sw.evaluate(() => chrome.storage.local.set({ updReload: { to: '9.9.9', at: Date.now() } }));
    fs.writeFileSync(mf, orig.replace(`"version": "${VER}"`, '"version": "9.9.9"'));
    fs.writeFileSync(uf, JSON.stringify({ v: 1, at: Date.now(), ok: true, ver: '9.9.9', err: '', fails: 0 }));
    srv.uq = 'qupd0002bb'; srv.uqTook = false;
    await pollOnce();
    ack = srv.ops('poll').filter((p) => p.ack).at(-1);
    assert.equal(ack.ack, 'qupd0002bb'); assert.equal(ack.res.st, 'reload'); assert.equal(ack.res.disk, '9.9.9');
    assert.equal(await sw.evaluate(() => self.__rl), 1);
    // ההעתקה עוד לא אושרה (upd.json "copying") → copying, בלי טעינה
    fs.writeFileSync(uf, JSON.stringify({ v: 1, at: Date.now(), ok: false, ver: '', err: 'copying', fails: 0 }));
    srv.uq = 'qupd0003cc'; srv.uqTook = false;
    await pollOnce();
    assert.equal(srv.ops('poll').filter((p) => p.ack).at(-1).res.st, 'copying');
    assert.equal(await sw.evaluate(() => self.__rl), 1);
  } finally {
    fs.writeFileSync(mf, orig);
    fs.rmSync(uf, { force: true });
    srv.uq = null; srv.caps = null;
    await sw.evaluate(async () => { self.__cxTest.reload = null; await chrome.storage.local.remove(['updReload', 'upd', 'updSent', 'lastUq', 'caps']); await self.__cxTest.setupAlarms(); });
  }
});

// ---------- 0.1.14: שעות העובדים ----------
// כספית המדומה (hrsMode=grid): 5 עובדים ברשימת ag-grid וירטואלית (2 שורות בתצוגה) – 11 לא פעיל, 12 ו-15 עם שעות ביהודה הנשיא (15 רק אחרי גלילה),
// 13 עם שעות רק בנחל לכיש, 14 בלי שעות. מזהה + חודש + סניף של כל יצוא נרשמים ב-hrsX; לחיצה אסורה – ב-attHits
const HRS_NAMES = ['שפרינצק', 'רוזנצוויג', 'טננבאום', 'פרלמוטר', 'שטרנברג', '07:41', '15:58', '22:10', '06:05'];
const hrsUps = (n0) => srv.calls.slice(n0).filter((c) => c.op === 'upload' && c.kind === 'hours');
const curYm = () => { const p = D.parts(Date.now(), 'Asia/Jerusalem'); return p.y + '-' + String(p.m).padStart(2, '0'); };
// יום חול בחודש הנוכחי (הנתונים בכספית המדומה לפי החודש של עכשיו) בשעה hm
const curDay = (hm, from) => { for (let d = from || 1; d <= 28; d++) { const day = curYm() + '-' + String(d).padStart(2, '0'); if (!D.restDay(day) && !D.restDay(D.addDays(day, 1))) return D.zonedToUtc(day, hm, 'Asia/Jerusalem'); } return null; };
async function hrsOn(o) {
  srv.caps = ['hours'];
  await sw.evaluate(async () => { await chrome.alarms.clear('tick'); await chrome.alarms.clear('hour'); await chrome.alarms.clear('hrs'); await chrome.storage.local.set({ caps: { today: false, uq: false, hours: true } }); return chrome.storage.local.remove('hrsSt'); });
  if (!caspitPage()) { const pg = await ctx.newPage(); await pg.goto('https://caspit.valu.co.il/bo#/'); await pg.evaluate(() => localStorage.setItem('auth', '1')); } // הרצה חלקית של הבדיקות (בלי הבדיקות הקודמות)
  await ls(Object.assign({ auth: '1', hrsMode: 'grid', hrsX: null, attHits: null, brPicks: null }, o || {}));
}
async function hrsOff() {
  srv.caps = null;
  await ls({ hrsMode: null, hrsLink: null, hrsFmt: null, hrsFmtOne: null, hrsGone: null, hrsBackStuck: null, hrsMonthStuck: null, brFail: null, store: 'יהודה הנשיא' });
  await sw.evaluate(async () => { await chrome.storage.local.remove(['caps', 'hrsSt']); await self.__cxTest.setupAlarms(); });
}
const byId = (up) => Object.fromEntries(up.emps.map((e) => [e.id, e]));
test('0.1.14 שעות בסנכרון הלילי: אחרי המכירות ולפני ההעלאות לכספית, שני סניפים, רק עובדים עם שעות; גלילה ברשימה; בלי לחיצות אסורות; בלי שמות בדיווח', async () => {
  await hrsOn();
  try {
    const n0 = srv.calls.length;
    const { s, rep } = await syncOneDay();
    assert.equal(s.st.lastRun.st, 'ok', JSON.stringify(s.st.lastRun));
    const calls = srv.calls.slice(n0), ix = (f) => calls.findIndex(f);
    const up = hrsUps(n0);
    assert.equal(up.length, 2, JSON.stringify(up.map((u) => [u.br, u.m])));
    const iH = ix((c) => c.kind === 'hours'), iS = calls.map((c, i) => (c.op === 'upload' && c.kind === 'sales' ? i : -1)).filter((i) => i >= 0).pop(), iE = ix((c) => c.op === 'export');
    assert.ok((iS === undefined || iS < iH) && iH < iE, `סדר: מכירות ${iS} → שעות ${iH} → העלאות לכספית ${iE}`);
    const sl = rep.steps.map((x) => x.s); // גם כשהמכירות של היום כבר נשלחו בריצה קודמת (אותו קובץ)
    assert.ok(sl.lastIndexOf('sales') < sl.indexOf('hours') && sl.indexOf('hours') < sl.indexOf('exportNew'), sl.join(','));
    const [yh, nl] = up;
    assert.equal(yh.br, 'יהודה הנשיא'); assert.equal(nl.br, 'נחל לכיש'); assert.equal(yh.m, curYm()); assert.equal(nl.m, curYm());
    assert.deepEqual(yh.emps.map((e) => e.id).sort(), ['12', '15'], 'רק עובדים עם שעות; 15 – אחרי גלילה; 11 (לא פעיל) ו-14 (בלי שעות) – לא');
    assert.deepEqual(nl.emps.map((e) => e.id), ['13']);
    assert.ok(up.every((u) => !('empty' in u)), 'שרת בלי caps.hours2 – בלי empty');
    const e12 = byId(yh)['12'], m = curYm();
    assert.equal(e12.nm, 'מיכל רוזנצוויג');
    assert.deepEqual(e12.rows, [{ d: m + '-01', i: '07:41', o: '15:58', b: 30, t: 467 }, { d: m + '-02', i: '22:10', o: '06:05', b: 15, t: 460, n: 1 }, { d: m + '-03', i: '07:39', o: '', b: 0 }]);
    assert.equal(typeof yh.run, 'string'); assert.equal(yh.log, rep.run, 'log = מזהה הריצה בשרת');
    const X = await caspitPage().evaluate(() => localStorage.getItem('hrsX') || '');
    for (const id of ['12', '13', '14', '15']) assert.ok(X.includes(id + '|' + m + '|יהודה הנשיא;'), 'יהודה הנשיא ' + id + ': ' + X);
    assert.ok(!/(^|;)11\|/.test(X), 'עובד לא פעיל לא נפתח: ' + X);
    assert.equal((X.match(/\|נחל לכיש;/g) || []).length, 4);
    assert.equal(await caspitPage().evaluate(() => localStorage.getItem('attHits')), null, 'לא נלחצו "עריכה" / "עובד חדש" / "הוספת כניסה ויציאה" / "הצג רק מנהלים" / יצוא הרשימה');
    assert.equal(await store0(), 'יהודה הנשיא');
    assert.deepEqual(rep.info.hrs.brs, [['יהודה הנשיא', 4, 2, 4], ['נחל לכיש', 4, 1, 1]]);
    const txt = JSON.stringify(rep) + JSON.stringify(s.st.lastRun);
    for (const w of HRS_NAMES) assert.ok(!txt.includes(w), 'שם / שעה בדיווח: ' + w);
  } finally { await hrsOff(); }
});
test('0.1.14 שעות כל 30 דקות (0.1.15: עד 23:00): רק החודש הנוכחי, בלי hello / report; פעם אחת בחצי שעה; לא לפני 07:00 / אחרי 23:00 / בשבת; שרת בלי caps.hours – לא; קישורים ברשימה', async () => {
  await hrsOn({ hrsLink: '1' });
  try {
    const W = curDay('08:10');
    const ht = (now) => sw.evaluate((n) => self.__cxTest.hoursTick({ now: n }), now);
    const c0 = { hello: srv.ops('hello').length, report: srv.ops('report').length, sales: srv.ops('upload').filter((c) => c.kind === 'sales').length }, n0 = srv.calls.length;
    const r = await ht(W);
    assert.equal(r && r.st, 'ok', JSON.stringify(r));
    assert.deepEqual(r.m, [curYm()]); assert.deepEqual(r.brs, [['יהודה הנשיא', 4, 2, 4], ['נחל לכיש', 4, 1, 1]]);
    assert.equal(hrsUps(n0).length, 2);
    assert.deepEqual({ hello: srv.ops('hello').length, report: srv.ops('report').length, sales: srv.ops('upload').filter((c) => c.kind === 'sales').length }, c0, 'בלי hello / report / מכירות');
    assert.equal(await ht(W + 10 * 60e3), null, 'אותה חצי שעה');
    assert.equal(await ht(W - 80 * 60e3), null, '06:50');
    assert.equal(await ht(W + 920 * 60e3), null, '23:30');
    const sat = (() => { for (let d = 1; d <= 28; d++) { const day = curYm() + '-' + String(d).padStart(2, '0'); if (new Date(day + 'T12:00:00Z').getUTCDay() === 6) return D.zonedToUtc(day, '09:00', 'Asia/Jerusalem'); } return null; })();
    assert.equal(await ht(sat), null, 'שבת');
    await sw.evaluate(async () => { const { run } = await chrome.storage.local.get('run'); await chrome.storage.local.set({ runSaved: run, run: Object.assign({}, run, { st: 'run', touchedAt: Date.now() }) }); });
    assert.equal(await ht(W + 30 * 60e3), null, 'ריצה אחרת פעילה');
    await sw.evaluate(async () => { const { runSaved } = await chrome.storage.local.get('runSaved'); await chrome.storage.local.set({ run: runSaved }); await chrome.storage.local.remove('runSaved'); });
    const n1 = srv.calls.length;
    const r2 = await ht(W + 30 * 60e3);
    assert.equal(r2 && r2.st, 'ok', JSON.stringify(r2)); assert.equal(hrsUps(n1).length, 2, 'חצי השעה הבאה');
    await sw.evaluate(() => chrome.storage.local.set({ caps: { today: false, uq: false, hours: false } }));
    assert.equal(await ht(W + 60 * 60e3), null, 'שרת בלי caps.hours');
    assert.equal(await caspitPage().evaluate(() => localStorage.getItem('attHits')), null);
    const st = await sw.evaluate(() => chrome.storage.local.get('hrsSt'));
    for (const w of HRS_NAMES) assert.ok(!JSON.stringify(st).includes(w), 'שם / שעה בחלון התוסף: ' + w);
  } finally { await hrsOff(); }
});
test('0.1.14 שעות: כישלון בנחל לכיש → יהודה הנשיא נשלח, חזרה ליהודה הנשיא, hours-branch; החזרה נכשלת → branch-restore ודיווח', async () => {
  await hrsOn({ hrsLink: '1', brFail: 'switch' });
  try {
    let n0 = srv.calls.length;
    let r = await sw.evaluate(() => self.__cxTest.hrsRun());
    assert.equal(r.st, 'fail', JSON.stringify(r)); assert.equal(r.code, 'hours-branch'); assert.match(r.msg, /^נחל לכיש: /);
    const up = hrsUps(n0);
    assert.equal(up.length, 1); assert.equal(up[0].br, 'יהודה הנשיא'); assert.deepEqual(up[0].emps.map((e) => e.id).sort(), ['12', '15']);
    assert.equal(await store0(), 'יהודה הנשיא');
    await ls({ brFail: 'restore', brPicks: null });
    n0 = srv.calls.length;
    r = await sw.evaluate(() => self.__cxTest.hrsRun());
    assert.equal(r.code, 'branch-restore', JSON.stringify(r));
    assert.equal(hrsUps(n0).length, 0, 'החזרה נכשלה – לא שולחים');
    const rp = srv.calls.slice(n0).filter((c) => c.op === 'report').at(-1);
    assert.equal(rp && rp.err.code, 'branch-restore'); assert.equal(rp.err.step, 'hours');
  } finally { await hrsOff(); }
});
test('0.1.14 שעות: קובץ במבנה לא מוכר → hours-format (כותרות דרך הרשימה הלבנה, בלי שמות), בלי העלאת שעות; המכירות וההעלאות לכספית נשלחו', async () => {
  await hrsOn({ hrsLink: '1', hrsFmt: 'bad' });
  try {
    const n0 = srv.calls.length;
    const { s, sales, rep } = await syncOneDay();
    assert.equal(s.st.lastRun.st, 'fail'); assert.equal(s.st.lastRun.code, 'hours-format', JSON.stringify(s.st.lastRun));
    assert.equal(hrsUps(n0).length, 0);
    assert.ok(rep.info.sales[days[1]], 'המכירות נקלטו (או שאותו קובץ כבר נשלח)'); assert.ok(Array.isArray(sales)); assert.ok(srv.calls.slice(n0).some((c) => c.op === 'export'), 'ההעלאות לכספית רצו');
    assert.equal(rep.err.code, 'hours-format');
    const f = rep.info.flags.hrs.fmt;
    assert.deepEqual(f.hdr, ['מספר', 'שם', 'ערך'], JSON.stringify(f)); assert.equal(f.hi, 1); assert.equal(f.rows, 3);
    const txt = JSON.stringify(rep);
    for (const w of HRS_NAMES) assert.ok(!txt.includes(w), 'שם / שעה בדיווח: ' + w);
    assert.equal(await store0(), 'יהודה הנשיא');
  } finally { await hrsOff(); }
});
test('0.1.14 שעות בימים 1–5: גם החודש הקודם (בחירה ב"בחר חודש"); בחירה שלא נקלטת → בלי החודש הקודם, pm.bad', async () => {
  await hrsOn({ hrsLink: '1' });
  try {
    const W = curDay('09:00'), p = D.parts(Date.now(), 'Asia/Jerusalem'), prev = p.m === 1 ? (p.y - 1) + '-12' : p.y + '-' + String(p.m - 1).padStart(2, '0');
    const W3 = D.zonedToUtc(curYm() + '-03', '09:00', 'Asia/Jerusalem');
    let n0 = srv.calls.length;
    let r = await sw.evaluate((n) => self.__cxTest.hrsRun({ now: n, full: true }), W3);
    assert.equal(r.st, 'ok', JSON.stringify(r)); assert.deepEqual(r.m, [prev, curYm()]); assert.deepEqual(r.pm, { ok: 1, bad: 0, none: 0, why: '' });
    let up = hrsUps(n0);
    assert.deepEqual(up.map((u) => [u.br, u.m]), [['יהודה הנשיא', prev], ['יהודה הנשיא', curYm()], ['נחל לכיש', curYm()]]);
    assert.deepEqual(up[0].emps.map((e) => [e.id, e.rows]), [['12', [{ d: prev + '-28', i: '08:00', o: '16:00', b: 30, t: 450 }]]]);
    await ls({ hrsMonthStuck: '1' });
    n0 = srv.calls.length;
    r = await sw.evaluate((n) => self.__cxTest.hrsRun({ now: n, full: true }), W3);
    assert.equal(r.pm.ok, 0); assert.ok(r.pm.bad >= 1, JSON.stringify(r));
    up = hrsUps(n0);
    assert.ok(!up.some((u) => u.m === prev), 'החודש הקודם לא נשלח');
    assert.ok(W > 0);
  } finally { await hrsOff(); }
});
test('0.1.15 שעות: עובד שכל השורות שלו נמחקו בכספית → empty (רק עם caps.hours2, רק מי שנשלח בעבר עם שורות, רק החודש הנוכחי); כל העובדים ריקים → בלי empty + אזהרה; מבנה לא מוכר בסניף → בלי העלאה ובלי empty; חזרה לחודש הנוכחי לא אושרה → בלי empty', async () => {
  await hrsOn({ hrsLink: '1' });
  try {
    srv.caps = ['hours', 'hours2'];
    await sw.evaluate(async () => { await chrome.storage.local.remove('hrsSeen'); return chrome.storage.local.set({ caps: { today: false, uq: false, hours: true, hours2: true } }); });
    const run = async (n) => { const n0 = srv.calls.length; const r = await sw.evaluate((x) => self.__cxTest.hrsRun(x ? { now: x, full: true } : undefined), n || 0); return { r, up: hrsUps(n0) }; };
    // ריצה ראשונה – 12 ו-15 נשלחים עם שורות (hrsSeen); 13 / 14 בלי שורות ביהודה הנשיא – אף פעם לא נשלחו, אין מה למחוק
    let { r, up } = await run();
    assert.equal(r.st, 'ok', JSON.stringify(r));
    assert.ok(up.every((u) => !('empty' in u)), JSON.stringify(up.map((u) => [u.br, u.empty])));
    // 12 נמחק בכספית → empty ['12'] ביהודה הנשיא בלבד
    await ls({ hrsGone: '12' });
    ({ r, up } = await run());
    assert.equal(r.st, 'ok', JSON.stringify(r)); assert.equal(r.warn, undefined);
    assert.deepEqual(up.map((u) => [u.br, u.m]), [['יהודה הנשיא', curYm()], ['נחל לכיש', curYm()]]);
    assert.deepEqual(up[0].emps.map((e) => e.id), ['15']); assert.deepEqual(up[0].empty, ['12']);
    assert.equal(up[1].empty, undefined, 'נחל לכיש – 12 לא נשלח שם עם שורות');
    // שוב – 12 כבר נמחק (לא ב-hrsSeen) → בלי empty
    ({ r, up } = await run());
    assert.equal(up[0].empty, undefined);
    // מעצור: כל העובדים ביהודה הנשיא ריקים (12 חזר, נשלח, ואז 12 ו-15 נמחקו) → בלי empty, אזהרה
    await ls({ hrsGone: null }); await run();
    await ls({ hrsGone: '12,15' });
    ({ r, up } = await run());
    assert.equal(r.warn, 'hours-empty-many', JSON.stringify(r));
    assert.ok(up.every((u) => !('empty' in u)), JSON.stringify(up.map((u) => [u.br, u.empty])));
    // יצוא במבנה לא מוכר בנחל לכיש → לנחל לכיש לא נשלח כלום
    await ls({ hrsGone: '12', hrsFmtOne: 'נחל לכיש|15' });
    ({ r, up } = await run());
    assert.equal(r.code, 'hours-format', JSON.stringify(r));
    assert.deepEqual(up.map((u) => u.br), ['יהודה הנשיא']); assert.deepEqual(up[0].empty, ['12']);
    // ימים 1–5: המעבר לחודש הקודם נקלט, החזרה לחודש הנוכחי לא (הפקד "בחר חודש" נשאר בחודש הקודם) → בלי empty לסניף, אזהרה
    await ls({ hrsFmtOne: null, hrsGone: null }); await run();
    await ls({ hrsGone: '12', hrsBackStuck: '1' });
    ({ r, up } = await run(D.zonedToUtc(curYm() + '-03', '09:00', 'Asia/Jerusalem')));
    assert.ok(up.every((u) => !('empty' in u)), 'החזרה לחודש הנוכחי לא אושרה – בלי empty: ' + JSON.stringify(up.map((u) => [u.br, u.m, u.empty])));
    assert.equal(r.warn, 'hours-empty-month', JSON.stringify(r));
    const st = JSON.stringify(await sw.evaluate(() => chrome.storage.local.get(['hrsSt', 'hrsSeen'])));
    for (const w of HRS_NAMES) assert.ok(!st.includes(w), 'שם / שעה באחסון: ' + w);
  } finally { await sw.evaluate(() => chrome.storage.local.remove('hrsSeen')); await hrsOff(); }
});

test('ניתוק: הקוד נמחק', async () => {
  const pg = await ctx.newPage();
  await pg.goto(`chrome-extension://${EXT_ID}/options.html`);
  pg.on('dialog', (d) => d.accept());
  await pg.click('#disconnect');
  await pg.waitForFunction(() => document.getElementById('msg').textContent.includes('נותק'));
  assert.equal((await store()).token, undefined);
  await pg.close();
});
