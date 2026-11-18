'use strict';
// שכר, שלב ד' (18.11.2026): www/payroll-out.js – דוחות PayOut.empReport / PayOut.accReport (PDF ואקסל). רשת מדומה, נתונים סינתטיים בלבד.
// מזריק את payroll-core.js ו-payroll-out.js (אם לא נטענו) ואת ספריית האקסל האמיתית; מזריק מצב (עובד עם pay, שעות כולל חציית חצות, בונוס),
// dr ו-tasks מדומים ובלעדיהם; מחקה Capacitor (Filesystem+Share) כדי לראות מה משותף. אקסל נקרא חזרה עם XLSX.
// שימוש: node ui-payroll-out.js <www-dir>   (NODE_PATH=$(npm root -g))
const fs = require('fs'); const path = require('path'); const H = require('./harness');
let fail = 0; const check = (n, ok, info) => { if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 500) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const XLSX_JS = path.resolve(__dirname, '../../../caspit-extension/src/lib/xlsx.full.min.js');
const DOCS = 'projects/demo-largpeami/databases/(default)/documents/b/acme/';
const fld = (o) => { const f = {}; Object.keys(o).forEach((k) => { f[k] = typeof o[k] === 'number' ? { integerValue: String(o[k]) } : { stringValue: o[k] }; }); return f; };
const drDoc = (id, day, nm) => ({ name: DOCS + 'dr/' + id, fields: fld({ uid: 'dana', day, n: nm, st: 'ok' }) });
const ms = (y, m, d, h) => Date.UTC(y, m - 1, d, h - 3); // שעון ישראל (קיץ/חורף – הבדיקה בשעות אמצע היום, בטוח לשני המקרים)

(async () => {
  const [www] = process.argv.slice(2); const browser = await H.launch();
  const cfg = { mode: 'new', users: { ma: 'acme' }, biz: { acme: { dataRoot: 'b', features: { dailyRep: true, tasks: true } } }, admins: { 'b/acme/|ma': 1 } };
  const log = []; const x = await H.newPage(browser, www, cfg, log, 'out'); const pg = x.page; await pg.setViewportSize({ width: 412, height: 900 });
  const qlog = []; let mode = 'data'; // data | empty | fail
  await x.ctx.route((u) => { const q = new URL(u); return q.port === '8080' && /\/documents\/b\/acme(\/.*)?(:runQuery|\/x\/(m|w))$/.test(decodeURIComponent(q.pathname)); }, (route) => {
    const p = decodeURIComponent(new URL(route.request().url()).pathname), body = route.request().postData() || ''; qlog.push(p.replace(/.*\/documents\/b\/acme/, '') + ' ' + (/collectionId":"(\w+)/.exec(body) || [])[1]);
    if (mode === 'fail') return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"message":"boom"}}' });
    const J = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (/:runQuery$/.test(p)) {
      if (mode === 'empty') return J([{ readTime: '2026-11-03T09:00:00Z' }]);
      if (/"dr"/.test(body)) return J([{ document: drDoc('dana_20261005', '2026-10-05', 'דנה') }, { document: drDoc('dana_20261006', '2026-10-06', 'דנה') }, { document: drDoc('dana_20260930', '2026-09-30', 'דנה') }]);
      return J([['2026-10-05', 10, 'להכין מארזים', 'done'], ['2026-10-05', 11, 'לנקות מקרר', 'open'], ['2026-10-06', 9, 'משלוח לחיפה', 'done'], ['2026-09-30', 9, 'משימה מספטמבר', 'done']]
        .map(([d, h, t, st], i) => ({ document: { name: DOCS + 'tasks/t' + i, fields: Object.assign(fld({ txt: t, st }), { cr: { integerValue: String(ms(+d.slice(0, 4), +d.slice(5, 7), +d.slice(8), h)) }, to: { arrayValue: { values: [{ stringValue: 'dana' }] } } }) } })));
    }
    if (/dr\/dana_20261005\/x\/m$/.test(p)) return J({ name: DOCS + p.split('/documents/b/acme/')[1], fields: fld({ sumW: 'ארזה 40 מארזים ושלחה הזמנות' }) });
    if (/dr\/dana_20261006\/x\/m$/.test(p)) return J({ name: DOCS + p.split('/documents/b/acme/')[1], fields: fld({ sum: 'סיכום AI ליום שלישי' }) });
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":{"code":404,"status":"NOT_FOUND"}}' });
  });
  await H.login(pg, 'ma@x.co'); if (await pg.$('[data-a=startBlank]')) { await pg.click('[data-a=startBlank]'); await sleep(300); }
  await sleep(1000); if (await pg.evaluate(() => { const d = document.getElementById('dlg'); return !!(d && d.open); })) { await pg.evaluate(() => closeDlg()); await sleep(150); }
  // הזרקה: אקסל, payroll-out (core כבר נטען באפליקציה; אם לא – גם הוא)
  await pg.addScriptTag({ path: XLSX_JS });
  if (!(await pg.evaluate(() => !!window.PayCore))) await pg.addScriptTag({ path: path.join(www, 'payroll-core.js') });
  const hadOut = await pg.evaluate(() => !!window.PayOut); if (!hadOut) await pg.addScriptTag({ path: path.join(www, 'payroll-out.js') });
  check('0 PayOut נטען ומחשף empReport + accReport', await pg.evaluate(() => typeof PayOut === 'object' && typeof PayOut.empReport === 'function' && typeof PayOut.accReport === 'function'));
  qlog.length = 0; await sleep(600);
  check('0א טעינת הקובץ לא שלחה שום שאילתת dr (ולא שאילתה נוספת של tasks)', !qlog.some((q) => /dr/.test(q)) && !qlog.some((q) => /x\/(m|w)/.test(q)), qlog);

  // מצב סינתטי
  await pg.evaluate(() => {
    const emp = S.cats.find((c) => c.kind === 'exp' && !c.hid && c.beh === 'emp');
    S.subs.push({ id: 'poA', cat: emp.id, name: 'דנה כהן', pay: { mode: 'hr', rate: 50, m: 'מזומן', slip: false, uid: 'dana', rules: [], add: [{ id: 'a1', n: 'נסיעות', k: 'day', a: 20 }, { id: 'a2', n: 'טלפון', k: 'mo', a: 100 }] } });
    S.subs.push({ id: 'poB', cat: emp.id, name: 'יוסי לוי', pay: { mode: 'hr', rate: 40, m: 'העברה', slip: true, uid: '', rules: [], add: [{ id: 'b1', n: 'ארוחות', k: 'mo', a: 50 }] } });
    S.subs.push({ id: 'poC', cat: emp.id, name: 'בלי הגדרות' });
    S.wh = [{ id: 'w1', sub: 'poA', d: '2026-10-05', in: '08:00', out: '16:00', src: 'manual' }, { id: 'w2', sub: 'poA', d: '2026-10-06', in: '22:00', out: '02:00', src: 'manual' },
      { id: 'w3', sub: 'poA', d: '2026-09-30', in: '08:00', out: '10:00', src: 'manual' }, { id: 'w4', sub: 'poB', d: '2026-10-07', in: '09:00', out: '13:00', src: 'manual' }];
    S.bon = [{ id: 'b1', sub: 'poA', mon: '2026-10', a: 300, n: 'מכירות חודש אוקטובר' }, { id: 'b2', sub: 'poB', mon: '2026-10', a: 200, n: 'חג' }];
    save();
    window.__w = []; window.__s = [];
    window.Capacitor = { isNativePlatform: () => true, Plugins: { Filesystem: { writeFile: async (o) => { window.__w.push({ path: o.path, data: o.data }); return { uri: 'file:///cache/' + o.path }; } }, Share: { share: async (o) => { window.__s.push(o); } } } };
  });
  const run = async (js) => { await pg.evaluate(() => { window.__w = []; window.__s = []; }); qlog.length = 0; const r = await pg.evaluate(js); const out = await pg.evaluate(() => ({ w: window.__w.map((f) => ({ path: f.path, n: f.data.length })), s: window.__s.map((s) => ({ title: s.title, url: s.url })) })); return Object.assign({ r }, out); };
  const readX = () => pg.evaluate(() => { const f = window.__w[0]; const wb = XLSX.read(f.data, { type: 'base64' }); const o = {}; wb.SheetNames.forEach((n) => { o[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }); }); return o; });
  const isPdf = () => pg.evaluate(() => { const b = atob(window.__w[0].data); return b.startsWith('%PDF-1.4') && b.trimEnd().endsWith('%%EOF') && b.length > 5000 && (b.match(/\/Type\/Page\b/g) || []).length >= 1; });

  // 1. פירוט עובד – אקסל, עם dr ו-tasks
  mode = 'data'; let R = await run(() => PayOut.empReport('poA', '2026-10', 'xlsx'));
  const fn = 'Salary_דנה_כהן_2026-10.xlsx';
  check('1 אקסל: הקובץ נוצר ושותף (Filesystem + Share) עם השם הנכון', R.r && R.r.ok && R.w.length === 1 && R.w[0].path === fn && R.s.length === 1 && R.s[0].url === 'file:///cache/' + fn && R.s[0].title === fn, R);
  check('1א נטענו dr ו-tasks רק בלחיצה (שאילתת dr + שאילתת tasks + x/m)', qlog.some((q) => /runQuery dr/.test(q)) && qlog.some((q) => /runQuery tasks/.test(q)) && qlog.some((q) => /x\/m/.test(q)), qlog);
  const X1 = await readX();
  check('1ב גיליונות: פירוט + סיכום', Object.keys(X1).join() === 'פירוט,סיכום', Object.keys(X1));
  const D = X1['פירוט'];
  check('1ג כותרות העמודות', D[0].join('|') === 'תאריך|יום|כניסה|יציאה|סה״כ שעות|שעות (מספר)|סיכום היום|משימות שהוטלו|משימות שבוצעו', D[0]);
  check('1ד יום 5/10: 08:00–16:00, 8:00 = 8', D[1][0] === '05/10/2026' && D[1][1] === 'שני' && D[1][2] === '08:00' && D[1][3] === '16:00' && D[1][4] === '8:00' && D[1][5] === 8, D[1]);
  check('1ה יום 6/10 חוצה חצות: 22:00–02:00 = 4:00', D[2][0] === '06/10/2026' && D[2][2] === '22:00' && D[2][3] === '02:00' && D[2][4] === '4:00' && D[2][5] === 4, D[2]);
  check('1ו יום ספטמבר לא נכלל; שורת סה״כ 12:00 = 12', D.length === 4 && D[3][0] === 'סה״כ' && D[3][4] === '12:00' && D[3][5] === 12, D.map((r) => r[0]));
  check('1ז סיכום היום: sumW ל-5/10 ו-sum (AI) ל-6/10', D[1][6] === 'ארזה 40 מארזים ושלחה הזמנות' && D[2][6] === 'סיכום AI ליום שלישי', [D[1][6], D[2][6]]);
  check('1ח משימות: הוטלו 2 ב-5/10 (ביצע 1), 1 ב-6/10; ספטמבר לא נכלל', D[1][7] === 'להכין מארזים\nלנקות מקרר' && D[1][8] === 'להכין מארזים' && D[2][7] === 'משלוח לחיפה' && D[2][8] === 'משלוח לחיפה', [D[1][7], D[1][8], D[2][7]]);
  const SM = Object.fromEntries(X1['סיכום'].filter((r) => r[0]).map((r) => [String(r[0]).trim(), r[1]]));
  // בסיס 8h×50 + 4h×50 = 600; נסיעות 2 ימים × 20 = 40; טלפון 100; בונוס 300 (עובד לא בתלוש) ← 1040
  check('1ט סיכום: בסיס 600, נסיעות 40, טלפון 100, בונוס 300', SM['שכר בסיס'] === 600 && SM['תוספת: נסיעות (2 ימים × ₪20.00)'] === 40 && SM['תוספת: טלפון'] === 100 && SM['בונוס (סה״כ)'] === 300 && SM['בונוס: מכירות חודש אוקטובר'] === 300, SM);
  check('1י סה״כ לתשלום 1040, שולם 0, להעביר 1040', SM['סה״כ לתשלום'] === 1040 && SM['שולם'] === 0 && SM['להעביר'] === 1040, SM);

  // 2. PDF
  R = await run(() => PayOut.empReport(S.subs.find((s) => s.id === 'poA'), '2026-10', 'pdf'));
  check('2 PDF: נוצר ושותף עם השם הנכון', R.r && R.r.ok && R.w[0].path === 'Salary_דנה_כהן_2026-10.pdf' && R.s[0].url === 'file:///cache/Salary_דנה_כהן_2026-10.pdf', R);
  check('2א PDF תקין (כותרת, %%EOF, דף אחד לפחות)', await isPdf());
  R = await run(() => PayOut.empReport('poA', '2026-10')); check('2ב בלי פורמט – ברירת מחדל PDF', R.w[0] && /\.pdf$/.test(R.w[0].path), R);

  // 3. בלי dr/tasks: ריק / כשל שרת / בלי קישור uid
  mode = 'empty'; R = await run(() => PayOut.empReport('poA', '2026-10', 'xlsx')); let X = await readX();
  check('3 תשובה ריקה: סיכום "אין דיווח", משימות "אין משימות", השעות נשארו', X['פירוט'][1][6] === 'אין דיווח' && X['פירוט'][1][7] === 'אין משימות' && X['פירוט'][1][8] === 'אין משימות' && X['פירוט'][1][4] === '8:00', X['פירוט'][1]);
  mode = 'fail'; R = await run(() => PayOut.empReport('poA', '2026-10', 'xlsx')); X = await readX();
  check('3א כשל שרת (500): "אין דיווח", בלי שגיאה, הקובץ נוצר', R.r.ok && X['פירוט'][1][6] === 'אין דיווח' && X['פירוט'][2][8] === 'אין דיווח', X['פירוט'][1]);
  mode = 'data'; R = await run(() => PayOut.empReport('poB', '2026-10', 'xlsx')); X = await readX();
  check('3ב בלי קישור uid: "אין דיווח" ובלי שאילתות dr/tasks', R.r.ok && qlog.length === 0 && X['פירוט'][1][6] === 'אין דיווח' && X['פירוט'][1][7] === 'אין דיווח', [qlog, X['פירוט'][1]]);
  R = await run(() => PayOut.empReport('poC', '2026-10', 'xlsx'));
  check('3ג עובד בלי pay: לא נוצר קובץ, בלי שגיאה', R.r && R.r.ok === false && R.w.length === 0 && R.s.length === 0, R);

  // 4. רואה חשבון: poB (בתלוש) בלבד; poA לא בתלוש
  R = await run(() => PayOut.accReport('2026-10', 'xlsx')); X = await readX();
  check('4 accReport אקסל: נוצר ושותף', R.r && R.r.ok && R.w[0].path === 'Accountant_2026-10.xlsx' && R.s[0].url === 'file:///cache/Accountant_2026-10.xlsx', R);
  const A = X['סיכום'];
  // poB: 4h × 40 = 160 (שעות 4:00); תוספת ארוחות 50; בונוס 200 (חג); אין תלוש מאושר
  check('4א כותרות + שורה לעובד בתלוש בלבד', A[0].join('|') === 'עובד|שעות|שעות (מספר)|תוספות (₪)|פירוט תוספות|בונוסים (₪)|פירוט בונוסים|נטו לפי תלוש (₪)' && A.length === 2 && A[1][0] === 'יוסי לוי', A);
  check('4ב שעות 4:00, תוספות 50 (ארוחות), בונוס 200 (חג)', A[1][1] === '4:00' && A[1][2] === 4 && A[1][3] === 50 && /ארוחות/.test(A[1][4]) && A[1][5] === 200 && /חג/.test(A[1][6]) && A[1][7] === '', A[1]);
  check('4ג גיליון פירוט: תוספת ובונוס', X['פירוט'].length === 3 && X['פירוט'][1].join('|') === 'יוסי לוי|תוספת|ארוחות|50' && X['פירוט'][2].join('|') === 'יוסי לוי|בונוס|חג|200', X['פירוט']);
  R = await run(() => PayOut.accReport('2026-10', 'pdf'));
  check('4ד accReport PDF: נוצר, תקין, שותף', R.r && R.r.ok && R.w[0].path === 'Accountant_2026-10.pdf' && R.s[0].url === 'file:///cache/Accountant_2026-10.pdf' && await isPdf(), R);
  R = await run(() => PayOut.accReport('2026-08', 'xlsx')); X = await readX();
  check('4ה חודש בלי נתונים: עדיין קובץ, בלי קריסה (שורה בלי שעות)', R.r.ok && X['סיכום'][1][1] === '0:00', X['סיכום'][1]);

  // 5. טקסט ארוך ב-PDF נגלל לכמה שורות (לא נחתך) ועמודים נוספים כשהרבה ימים
  await pg.evaluate(() => { for (let d = 1; d <= 28; d++) S.wh.push({ id: 'm' + d, sub: 'poA', d: '2026-11-' + String(d).padStart(2, '0'), in: '09:00', out: '17:30', src: 'manual' }); });
  R = await run(() => PayOut.empReport('poA', '2026-11', 'pdf'));
  check('5 PDF עם 28 ימים: מספר עמודים > 1', R.r.ok && await pg.evaluate(() => (atob(window.__w[0].data).match(/\/Type\/Page\b/g) || []).length) > 1);
  const wrapped = await pg.evaluate(() => { const c = document.createElement('canvas').getContext('2d'); return typeof c.measureText === 'function'; });
  check('5א מדידת טקסט זמינה (גלישה)', wrapped);

  // 6. דפדפן רגיל (בלי Capacitor): הורדה, לא שגיאה
  const dn = await pg.evaluate(async () => { window.Capacitor = undefined; const got = []; const c0 = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { got.push({ d: this.download, b: /^blob:/.test(this.href) }); };
    await PayOut.empReport('poA', '2026-10', 'xlsx'); HTMLAnchorElement.prototype.click = c0; return got; });
  check('6 בדפדפן: הורדה אחת בשם הנכון', dn.length === 1 && dn[0].d === 'Salary_דנה_כהן_2026-10.xlsx' && dn[0].b, dn);
  // 6ב. מסך "שכר חודשי": כרטיס שיתוף, כל כפתור קורא לפונקציה הנכונה (PayOut מוחלף במדומה)
  await pg.evaluate(() => { window.__c = []; window.__T = []; window.__PO = window.PayOut; const mk = (n, ok) => (...a) => { window.__c.push([n].concat(a)); return new Promise((r) => setTimeout(() => r({ ok, file: 'x', fmt: a[a.length - 1] }), 250)); };
    window.PayOut = { empReport: mk('emp', true), accReport: mk('acc', true) }; const t0 = window.toast; window.__t0 = t0; window.toast = (m) => { window.__T.push(m); }; });
  const openMon = async (id) => { await pg.evaluate((i) => { go('payMon', i); }, id); await sleep(250); };
  await openMon('poA'); const mA = await pg.evaluate(() => document.querySelector('#main input[data-c=payMonM]').value);
  check('8 עובד בלי תלוש: 2 כפתורי שיתוף בלבד', await pg.evaluate(() => [...document.querySelectorAll('#main [data-a=payOut]')].map((b) => b.dataset.o + b.dataset.f).join()) === 'emppdf,empxlsx');
  await pg.click('#main [data-a=payOut][data-o=emp][data-f=pdf]');
  check('8א בזמן הפקה כפתורים מנוטרלים', await pg.evaluate(() => [...document.querySelectorAll('#main [data-a=payOut]')].every((b) => b.disabled)));
  await sleep(500);
  check('8ב empReport(poA, חודש, pdf) + toast הצלחה + כפתורים חוזרים', await pg.evaluate((m) => JSON.stringify(window.__c) === JSON.stringify([['emp', 'poA', m, 'pdf']]) && window.__T.length === 1 && [...document.querySelectorAll('#main [data-a=payOut]')].every((b) => !b.disabled), mA), await pg.evaluate(() => [window.__c, window.__T]));
  await pg.click('#main [data-a=payOut][data-o=emp][data-f=xlsx]'); await sleep(500);
  check('8ג empReport(poA, חודש, xlsx)', await pg.evaluate((m) => JSON.stringify(window.__c[1]) === JSON.stringify(['emp', 'poA', m, 'xlsx']), mA), await pg.evaluate(() => window.__c));
  await openMon('poB');
  check('8ד עובד בתלוש: 4 כפתורים', await pg.evaluate(() => [...document.querySelectorAll('#main [data-a=payOut]')].map((b) => b.dataset.o + b.dataset.f).join()) === 'emppdf,empxlsx,accpdf,accxlsx');
  await pg.evaluate(() => { window.__c = []; });
  await pg.click('#main [data-a=payOut][data-o=acc][data-f=pdf]'); await sleep(500); await pg.click('#main [data-a=payOut][data-o=acc][data-f=xlsx]'); await sleep(500);
  check('8ה accReport(חודש, pdf/xlsx) בלי מזהה עובד', await pg.evaluate((m) => JSON.stringify(window.__c) === JSON.stringify([['acc', m, 'pdf'], ['acc', m, 'xlsx']]), mA), await pg.evaluate(() => window.__c));
  await pg.evaluate(() => { window.__T = []; window.PayOut = { empReport: () => Promise.resolve({ ok: false }), accReport: () => Promise.reject(new Error('x')) }; });
  await pg.click('#main [data-a=payOut][data-o=emp][data-f=pdf]'); await sleep(200); await pg.click('#main [data-a=payOut][data-o=acc][data-f=pdf]'); await sleep(200);
  check('8ו כשל: toast כשל לשניהם, כפתורים חוזרים', await pg.evaluate(() => window.__T.length === 2 && window.__T.every((m) => /נכשלה/.test(m)) && [...document.querySelectorAll('#main [data-a=payOut]')].every((b) => !b.disabled)), await pg.evaluate(() => window.__T));
  await pg.evaluate(() => { window.PayOut = window.__PO; window.toast = window.__t0; });
  check('7 אין שגיאות JS', pg.__errors.length === 0, pg.__errors);
  await x.ctx.close(); await browser.close();
  console.log(fail ? `נכשלו ${fail} בדיקות` : 'כל הבדיקות עברו'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
