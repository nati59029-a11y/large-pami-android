'use strict';
// בדיקת קצה-לקצה: התוסף נטען (unpacked) ל-Chromium, כספית מדומה (context.route) ושרת cxBot מדומה (127.0.0.1).
// מכסה: חיבור עם קוד, חיבור שפג בכספית (needs-login) והמשך אחרי התחברות, ריצה מלאה (קטלוג, מכירות לכל יום, קבצים לכספית),
// טריגר כפול, אותו קובץ לא נשלח פעמיים, כפתור שהשתנה (selector-miss), מגבלת 500 מחירים, מצב היכרות + הורדת דוח בלי סודות.
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
    if (m) { salesReq.push(f); return route.fulfill({ status: 200, headers: { 'content-type': 'text/csv; charset=windows-1255' }, body: Buffer.from(fx.win1255(fx.salesCsv(`${m[1]}-${m[2]}-${m[3]}`))) }); }
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
  const al = await waitFor(async () => { const a = await sw.evaluate(async () => (await chrome.alarms.getAll()).map((x) => x.name)); return a.includes('daily') && a.includes('tick') ? a : null; }, 10e3, 'alarms');
  assert.ok(al.length >= 2);
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
  for (const c of sales) { assert.equal(c.lines.length, 3); assert.ok(c.lines.every((l) => l.d === c.day)); }
  assert.ok(!sales.some((c) => c.day === today));
  assert.ok(srv.ops('apply').length >= 3);
  // קבצים לכספית: פריטים חדשים ואז מחירים, עם האפשרות הנכונה, ודיווח תוצאה
  assert.deepEqual(imports.map((i) => i.type), ['new', 'price']);
  assert.match(imports[0].text, /900001/);
  assert.match(imports[1].text, /101,5\.5/);
  const ir = srv.ops('importResult');
  assert.deepEqual(ir.map((r) => [r.kind, r.n, r.ok]), [['new', 1, true], ['price', 2, true]]);
  assert.match(ir[0].text, /הסתיימה/);
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
  await pop.click('#disc');
  const s = await waitFor(async () => { const x = await store(); return x.discSt && x.discSt.st !== 'run' && x.disc ? x : null; }, 180e3, 'discovery');
  assert.equal(s.discSt.st, 'ok', JSON.stringify(s.disc.rep.err));
  const rep = s.disc.rep;
  const txt = JSON.stringify(rep);
  for (const x of SECRETS) assert.ok(!txt.includes(x), 'leaked ' + x);
  assert.ok(s.disc.size <= 1024 * 1024);
  assert.deepEqual(rep.pages.map((p) => p.name), ['catalogs', 'csv-imports', 'sales']);
  const imp = rep.pages[1];
  assert.ok(!imp.controls.some((c) => c.type === 'password'));
  assert.ok(imp.probe.every((p) => !p.done || ['nav', 'waitFor', 'text', 'select'].includes(p.op)), 'no change made on csv-imports: ' + JSON.stringify(imp.probe));
  // היכרות v2: אפשרויות רשימת סוג הקובץ, ואחרי בחירה (רק לחשיפה) – שדה הקובץ וכפתור הטעינה; אף קובץ לא הועלה
  assert.deepEqual(imp.peek[0].items, ['טעינת פריטים חדשים', 'טעינת מועדון לקוחות', 'טעינת לקוחות הקפה', 'עדכון מחיר לצרכן ו/או מחיר עלות לפריטים', 'עדכון מחיר בחנות', 'עדכון פריטים', 'טעינת פריטים חדשים מנטפוס']);
  assert.ok(imp.controls.some((c) => c.text === 'טען קובץ'), 'כפתור הטעינה נחשף');
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

test('ניתוק: הקוד נמחק', async () => {
  const pg = await ctx.newPage();
  await pg.goto(`chrome-extension://${EXT_ID}/options.html`);
  pg.on('dialog', (d) => d.accept());
  await pg.click('#disconnect');
  await pg.waitForFunction(() => document.getElementById('msg').textContent.includes('נותק'));
  assert.equal((await store()).token, undefined);
  await pg.close();
});
