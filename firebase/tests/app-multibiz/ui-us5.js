'use strict';
// סריקה אחידה, שלב 5: חיבור דפים (רשת מדומה; scanDocument מדומה – תשובה לכל דף לפי הטקסט שבתמונה).
// Z ב-3 חלקים בסדר אקראי, 2+1 דפי חשבונית → 2 חשבוניות (סכום ההוצאות = שתיהן), 12 דפים → רשומה אחת, Z+חשבונית מעורבבים, דף כפול,
// תיקון ידני לפני שמירה, תור ב-IndexedDB אחרי טעינה מחדש, ח.פ בכרטיס ספק, קבלה לחשבונית עם קובץ (שני הקבצים), ייצוא PDF של דוח וכרטסת.
// שימוש: NODE_PATH=... node ui-us5.js <www-dir>
const H = require('./harness');
const BZ0 = ['larg', 'peami'].join('');
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
let fail = 0; const check = (n, ok, info) => { if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 300) : '')); };
// כל דף = תמונה שונה (צבע לפי מספר), כדי שהדף הכפול יזוהה רק כשהוא באמת אותו צילום
const mkImg = (page, n) => page.evaluate((n) => { const c = document.createElement('canvas'); c.width = 300; c.height = 420; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 300, 420); x.fillStyle = 'rgb(' + (n * 37 % 255) + ',' + (n * 91 % 255) + ',' + (n * 13 % 255) + ')'; x.fillRect(10, 10 + n * 7, 200, 40); return c.toDataURL('image/png').split(',')[1]; }, n).then((b) => Buffer.from(b, 'base64'));
// התשובות לפי סדר הקריאות (דף אחר דף, בסדר שבו נבחרו)
async function mockScan(page) {
  page.__q = []; page.__calls = 0;
  await page.route('**/scanDocument', async (route) => {
    page.__calls++; const a = page.__q.shift() || { type: 'unknown', fields: {} };
    if (a.err) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { status: 'INTERNAL', message: 'x', details: { reason: a.err } } }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { result: Object.assign({ allowed: true, confidence: {}, uncertain: [] }, a) }, usage: {} }) });
  });
}
const INV = (num, tot, o) => Object.assign({ type: 'invoice', docType: 'invoice', typeConfidence: 0.95, fields: { supplier: 'ספק אלפא', supplier_id: '514000001', number: num, date: '2026-11-01', total_with_vat: tot } }, o || {});
const ZP = (part, f) => ({ type: 'zreport', zPart: part, fields: Object.assign({ date: '2026-11-02', report_no: '321' }, f || {}) });
async function pick(page, ns, sel) { const files = []; for (const n of ns) files.push({ name: 'p' + n + '.png', mimeType: 'image/png', buffer: await mkImg(page, n) }); await page.setInputFiles(sel || '#sheet input[accept="image/*"][multiple]', files); await H.settle(page, 1500 + ns.length * 500); }
const groups = (page) => page.evaluate(() => US && US.M ? US.M.g.map((G) => ({ n: G.p.length, k: usGI(G).k, w: usGI(G).w, done: G.done })) : null);
(async () => {
  const [www] = process.argv.slice(2); const browser = await H.launch();
  const cfg = { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: ALL } }, admins: { '|m': 1 }, staff: { '|w': 1 } };
  const { ctx, page } = await H.newPage(browser, www, cfg, [], 'm'); await page.setViewportSize({ width: 360, height: 740 }); await mockScan(page); await H.login(page, 'm@x.co');
  await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden) ACT.startBlank(); }); await H.settle(page, 400);
  await page.evaluate(() => { const c = S.cats.find((x) => x.beh === 'sup'); S.subs.push({ id: 'sAlpha', cat: c.id, name: 'ספק אלפא' }, { id: 'sBeta', cat: c.id, name: 'ספק בטא בע"מ' }); save(); });
  const open = async () => { await page.evaluate(() => { if (US) usReset(); usOpen(); }); await H.settle(page, 300); };
  const go = async (gi) => { await page.click(`#sheet [data-a=usGo][data-g="${gi}"]`); await H.settle(page, 900); const y = await page.$('#dlg[open] [data-a=yes]'); if (y) { await y.click(); await H.settle(page, 900); } };

  // 0. ח.פ בכרטיס ספק: שדה חדש, נשמר, רשומה ישנה בלי השדה – בלי שגיאה
  await page.evaluate(() => ACT.subMenu({ dataset: { id: 'sBeta' } })); await H.settle(page, 300);
  const hpF = await page.$('#dlg form[data-f=subsave] input[name=hp]');
  await page.fill('#dlg form[data-f=subsave] input[name=hp]', '51-400000-2'); await page.click('#dlg form[data-f=subsave] button'); await H.settle(page, 300);
  const hp0 = await page.evaluate(() => ({ b: S.subs.find((s) => s.id === 'sBeta').hp, a: 'hp' in S.subs.find((s) => s.id === 'sAlpha') }));
  check('0 כרטיס ספק: שדה ח.פ נשמר (ספרות בלבד), לספק ישן אין שדה', !!hpF && hp0.b === '514000002' && hp0.a === false, hp0);
  // 0א. זיהוי לפי ח.פ גובר על שם: השם בחשבונית "אלפא" אבל הח.פ של בטא → בטא
  await open(); page.__q = [INV('B-1', 80, { fields: { supplier: 'ספק אלפא', supplier_id: '514000002', number: 'B-1', date: '2026-11-01', total_with_vat: 80 } })]; await pick(page, [1]);
  const s0 = await page.evaluate(() => A && A.sub);
  check('0א ספק לפי ח.פ (גובר על השם)', s0 === 'sBeta', s0);
  // 0ב. ח.פ לא מוכר → לפי שם
  await open(); page.__q = [INV('A-1', 50, { fields: { supplier: 'ספק אלפא', supplier_id: '599999999', number: 'A-1', date: '2026-11-01', total_with_vat: 50 } })]; await pick(page, [2]);
  check('0ב ח.פ לא מוכר → ספק לפי שם', (await page.evaluate(() => A && A.sub)) === 'sAlpha');

  // 1. Z ב-3 חלקים בסדר אקראי (תחתון, עליון, אמצעי) → מסמך אחד, בסדר הנכון, 3 קריאות
  await open(); page.__calls = 0; page.__q = [ZP('bottom', { total: 1000 }), ZP('top', { cash: 400 }), ZP('middle', { cash_in_drawer: 300 })]; await pick(page, [11, 12, 13]);
  const g1 = await groups(page);
  check('1 Z ב-3 חלקים מעורבבים → מסמך אחד, בלי התראה, 3 קריאות (דף = 1)', g1 && g1.length === 1 && g1[0].k === 'z' && g1[0].n === 3 && !g1[0].w.length && page.__calls === 3, { g1, calls: page.__calls });
  const ord = await page.evaluate(() => US.M.g[0].p.map((g) => g.c.part)); check('1א הסדר: עליון, אמצעי, תחתון', ord.join() === '0,1,2', ord);
  await go(0);
  const z1 = await page.evaluate(() => ({ v: cur().v, z: ZC.z.map((d, i) => d ? i : -1), tot: ZC.f && ZC.f.total, cash: ZC.f && ZC.f.cash, drw: ZC.f && ZC.f.drawer, no: ZC.f && ZC.f.no }));
  check('1ב טופס הסגירה: 3 הצילומים במקומם וכל השדות מכל החלקים', z1.v === 'zc' && z1.z.join() === '0,1,2' && z1.tot === '1000' && z1.cash === '400' && z1.drw === '300' && z1.no === '321', z1);
  await page.evaluate(() => ACT.usExit()); await H.settle(page, 200); await page.click('#dlg [data-a=yes]'); await H.settle(page, 400);
  check('1ג סגירה באמצע מסמך → חזרה לרשימה', await page.evaluate(() => US && US.step === 'review' && !!document.querySelector('#sheet [data-a=usGo]')));
  // 2. Z עם 2 חלקים → התראה על החלק החסר + שאלה לפני פתיחה; ＋ דף משלים
  await open(); page.__q = [ZP('top'), ZP('bottom')]; await pick(page, [14, 15]);
  const g2 = await groups(page);
  check('2 Z עם 2 חלקים → התראה "חסר החלק האמצעי"', g2 && g2.length === 1 && g2[0].w.some((x) => /חסר החלק האמצעי/.test(x)), g2);
  page.__q = [ZP('middle')]; await page.setInputFiles('#sheet input[data-c=usRevAdd]', { name: 'm.png', mimeType: 'image/png', buffer: await mkImg(page, 16) }); await H.settle(page, 1500);
  const g2b = await groups(page); const o2 = await page.evaluate(() => US.M.g[0].p.map((g) => g.c.part).join());
  check('2א "＋ דף" משלים את החלק החסר – בלי התראה, בסדר הנכון', g2b[0].n === 3 && !g2b[0].w.length && o2 === '0,1,2', { g2b, o2 });

  // 3. 2 דפים של חשבונית אחת + דף של חשבונית אחרת → 2 חשבוניות; סכום ההוצאות = שתיהן
  await open(); page.__q = [INV('A-100', null, { pages: 2, page: 1 }), INV('A-100', 300, { page: 2, pages: 2 }), INV('A-200', 200)]; await pick(page, [21, 22, 23]);
  const g3 = await groups(page);
  check('3 2+1 דפים → 2 חשבוניות (2 דפים + דף אחד)', g3 && g3.length === 2 && g3[0].n === 2 && g3[1].n === 1, g3);
  const sum0 = await page.evaluate(() => ({ n: S.tx.length, s: S.tx.filter((t) => t.t === 'exp').reduce((a, t) => a + (+t.amt || 0), 0) }));
  await go(0); const f3 = await page.evaluate(() => { const f = document.querySelector('#sheet form[data-f=addsave]'); return f && { amt: f.amt.value, inv: f.inv.value }; });
  await page.click('#sheet form[data-f=addsave] button[value=done]'); await H.settle(page, 800);
  const mid = await page.evaluate(() => ({ rev: US && US.step === 'review', left: US && US.M && US.M.g.filter((G) => !G.done).length }));
  await go(1); await page.click('#sheet form[data-f=addsave] button[value=done]'); await H.settle(page, 800);
  const sum1 = await page.evaluate(() => ({ n: S.tx.length, s: S.tx.filter((t) => t.t === 'exp').reduce((a, t) => a + (+t.amt || 0), 0), files: S.tx.slice(-2).map((t) => !!t.file), again: !!document.querySelector('[data-a=usAgain]') }));
  check('3א חשבונית 1: הסכום מהדף האחרון (300), מספר A-100', f3 && f3.amt === '300' && f3.inv === 'A-100', f3);
  check('3ב אחרי השמירה הראשונה – חזרה לרשימה, נשאר מסמך אחד', mid.rev && mid.left === 1, mid);
  check('3ג 2 רשומות בדיוק, סכום ההוצאות גדל ב-500 (300+200, לא נספר פעמיים), לכל אחת קובץ, ובסוף "נשמר"', sum1.n - sum0.n === 2 && Math.abs(sum1.s - sum0.s - 500) < 0.01 && sum1.files.every(Boolean) && sum1.again, { sum0, sum1 });
  const pk = await page.evaluate(async () => { const t = S.tx.find((x) => x.inv === 'A-100'); const d = await fget(t.file); return typeof d === 'string' && d.startsWith('PAGES:') ? JSON.parse(d.slice(6)).length : 1; });
  check('3ד לחשבונית של 2 הדפים נשמר קובץ עם 2 עמודים', pk === 2, pk);

  // 4. 12 דפים של חשבונית אחת → רשומה אחת
  await open(); page.__q = Array.from({ length: 12 }, (_, i) => INV('A-300', i === 11 ? 1200 : null, { page: i + 1, pages: 12 })); page.__calls = 0;
  await pick(page, [31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42]);
  const g4 = await groups(page); const n4 = await page.evaluate(() => S.tx.length);
  await go(0); await page.click('#sheet form[data-f=addsave] button[value=done]'); await H.settle(page, 900);
  const t4 = await page.evaluate((n) => ({ d: S.tx.length - n, amt: S.tx[S.tx.length - 1].amt }), n4);
  const pk4 = await page.evaluate(async () => { const d = await fget(S.tx[S.tx.length - 1].file); return d.startsWith('PAGES:') ? JSON.parse(d.slice(6)).length : 1; });
  check('4 12 דפים של חשבונית אחת → מסמך אחד → רשומה אחת עם 12 עמודים', g4 && g4.length === 1 && g4[0].n === 12 && t4.d === 1 && t4.amt === 1200 && pk4 === 12 && page.__calls === 12, { g4: g4 && g4.length, t4, pk4, calls: page.__calls });

  // 5. Z + חשבונית מעורבבים → שני מסמכים נפרדים
  await open(); page.__q = [ZP('top'), INV('A-400', 90), ZP('middle'), ZP('bottom')]; await pick(page, [51, 52, 53, 54]);
  const g5 = await groups(page);
  check('5 Z+חשבונית מעורבבים → 2 מסמכים: Z (3 דפים) וחשבונית (1)', g5 && g5.length === 2 && g5.find((g) => g.k === 'z').n === 3 && g5.find((g) => g.k === 'exp').n === 1, g5);

  // 6. דף כפול → התראה, שני הדפים זה ליד זה, מחיקה
  await open(); page.__q = [INV('A-500', 10), INV('A-500', 10)];
  { const b = await mkImg(page, 61); await page.setInputFiles('#sheet input[accept="image/*"][multiple]', [{ name: 'a.png', mimeType: 'image/png', buffer: b }, { name: 'b.png', mimeType: 'image/png', buffer: b }]); await H.settle(page, 2500); }
  const d6 = await page.evaluate(() => ({ warn: /דף כפול/.test(document.getElementById('sheet').innerText), del: document.querySelectorAll('#sheet .card [data-a=usPgDel].r').length }));
  check('6 דף כפול: התראה ושני הדפים עם כפתור מחיקה', d6.warn && d6.del === 2, d6);
  await page.click('#sheet .card [data-a=usPgDel].r'); await H.settle(page, 400);
  const d6b = await page.evaluate(() => ({ warn: /דף כפול/.test(document.getElementById('sheet').innerText), n: US.pg.length }));
  check('6א אחרי מחיקה: דף אחד, בלי התראה', !d6b.warn && d6b.n === 1, d6b);

  // 7. תיקון ידני: 2 חשבוניות שאוחדו בטעות (דף בלי מספר – לפי הרצף) → פיצול; ואיחוד; וסדר
  await open(); page.__q = [INV('A-600', 70), INV('', 30, { fields: { supplier: 'ספק אלפא', date: '2026-11-01', total_with_vat: 30 } })]; await pick(page, [71, 72]);
  const g7 = await groups(page);
  check('7 דף בלי מספר מחובר לפי הרצף, עם התראה לבדוק', g7 && g7.length === 1 && g7[0].n === 2 && g7[0].w.some((x) => /לפי הרצף/.test(x)), g7);
  await page.click('#sheet [data-a=usSplit]'); await H.settle(page, 300); const g7b = await groups(page);
  check('7א פיצול ידני → 2 מסמכים', g7b.length === 2 && g7b[0].n === 1 && g7b[1].n === 1 && !g7b[1].w.some((x) => /לפי הרצף/.test(x)), g7b);
  await page.click('#sheet [data-a=usJoin]'); await H.settle(page, 300); const g7c = await groups(page);
  check('7ב איחוד ידני → מסמך אחד', g7c.length === 1 && g7c[0].n === 2, g7c);
  const o7 = await page.evaluate(() => US.M.g[0].p.map((g) => g.c.f.total_with_vat).join()); await page.click('#sheet [data-a=usPgMv][data-d="1"]'); await H.settle(page, 300);
  const o7b = await page.evaluate(() => US.M.g[0].p.map((g) => g.c.f.total_with_vat).join());
  check('7ג שינוי סדר ידני', o7 === '70,30' && o7b === '30,70', { o7, o7b });

  // 8. סגירת האפליקציה באמצע: דפים שצולמו נשארים (IndexedDB), ואפשר להמשיך
  await page.evaluate(async () => { if (US) usReset(); const d = await idb(); const ks = await new Promise((r) => { const q = d.transaction('f').objectStore('f').getAllKeys(); q.onsuccess = () => r(q.result); }); for (const k of ks) if (/^usq_/.test(k)) await fdelK(k); }); // תורים של הבדיקות הקודמות (נשארו בכוונה: יציאה בלי "סגור" לא מוחקת)
  await open(); page.__q = [INV('A-700', 40), INV('A-800', 60)]; await pick(page, [81, 82]);
  await H.settle(page, 500); await page.reload(); await H.settle(page, 3000);
  await page.evaluate(() => usOpen()); await H.settle(page, 1200);
  const q8 = await page.evaluate(() => ({ box: !!document.getElementById('usqbox'), txt: (document.getElementById('usqbox') || {}).innerText || '' }));
  check('8 אחרי טעינה מחדש: הצעה להמשיך עם 2 הדפים', q8.box && /2 דפים/.test(q8.txt), q8);
  await page.click('#usqbox [data-a=usqRes]'); await H.settle(page, 600); const g8 = await groups(page);
  check('8א המשך: 2 המסמכים חזרו (בלי זיהוי נוסף)', g8 && g8.length === 2 && page.__q.length === 0, g8);
  await go(0); await page.click('#sheet form[data-f=addsave] button[value=done]'); await H.settle(page, 800);
  await page.reload(); await H.settle(page, 3000); await page.evaluate(() => usOpen()); await H.settle(page, 1200);
  const q8b = await page.evaluate(() => (document.getElementById('usqbox') || {}).innerText || '');
  check('8ב אחרי שמירת מסמך אחד וטעינה מחדש: נשאר רק הדף שלא נשמר', /דף שצולם/.test(q8b) && !/2 דפים/.test(q8b), q8b);
  await page.click('#usqbox [data-a=usqRes]'); await H.settle(page, 600); const g8c = await groups(page);
  check('8ג המשך: רק המסמך שלא נשמר (בלי לשמור שוב את הראשון)', g8c && g8c.length === 1 && !g8c[0].done, g8c);
  await page.evaluate(() => ACT.usExit()); await H.settle(page, 200); await page.click('#dlg [data-a=yes]'); await H.settle(page, 600);
  await page.evaluate(() => usOpen()); await H.settle(page, 1200);
  check('8ד "סגור ומחק" מוחק את התור', !(await page.$('#usqbox')));
  await page.evaluate(() => usReset());

  // 9. קבלה לחשבונית שכבר יש לה קובץ: שני הקבצים נשמרים, שניהם נצפים מהשורה
  const before9 = await page.evaluate(() => { const t = S.tx.find((x) => x.inv === 'A-200'); return { file: t.file, n: S.tx.length }; });
  await open(); page.__q = [INV('R-9', 200, { docType: 'receipt', fields: { supplier: 'ספק אלפא', number: 'R-9', related_invoice: 'A-200', date: '2026-11-05', total_with_vat: 200 } })]; await pick(page, [91]);
  await page.click('#sheet form[data-f=addsave] button[value=done]'); await H.settle(page, 400); await page.click('#dlg [data-a=yes]'); await H.settle(page, 600);
  const t9 = await page.evaluate((b) => { const t = S.tx.find((x) => x.inv === 'A-200'); return { same: t.file === b.file, rcpt: !!t.rcpt && t.rcpt !== t.file, d: S.tx.length - b.n, kept: S.tx.some(() => true) }; }, before9);
  const k9 = await page.evaluate(async () => { const t = S.tx.find((x) => x.inv === 'A-200'); return { a: !!(await fget(t.file)), b: !!(await fget(t.rcpt)), inBk: bkFileIds().includes(t.rcpt) }; });
  check('9 קבלה לחשבונית עם קובץ: הקובץ הישן נשאר, הקבלה ב-rcpt, אין הוצאה נוספת, שניהם במכשיר ובגיבוי', t9.same && t9.rcpt && t9.d === 0 && k9.a && k9.b && k9.inBk, { t9, k9 });
  await page.evaluate(() => { usReset(); const t = S.tx.find((x) => x.inv === 'A-200'); NAV = [{ v: 'home' }]; go('card', t.sub); }); await H.settle(page, 2500);
  const r9 = await page.evaluate(() => { const t = S.tx.find((x) => x.inv === 'A-200'); return { f: document.querySelectorAll(`#main .dxa [data-a=dxView][data-f="${t.file}"]`).length, r: document.querySelectorAll(`#main .dxa [data-a=dxView][data-f="${t.rcpt}"]`).length }; });
  check('9א בשורה: צפייה בחשבונית וצפייה בקבלה', r9.f >= 1 && r9.r >= 1, r9);

  // 10. ייצוא PDF: דוח וכרטסת – הורדה עם שם משמעותי (גם לספק בשם עברי)
  const dl = async (fn) => { const p = page.waitForEvent('download', { timeout: 8000 }).catch(() => null); await page.evaluate(fn); const d = await p; if (!d) return null; const b = await d.createReadStream().then((s) => new Promise((r) => { const a = []; s.on('data', (c) => a.push(c)); s.on('end', () => r(Buffer.concat(a))); })); return { n: d.suggestedFilename(), pdf: b.slice(0, 5).toString() === '%PDF-', kb: Math.round(b.length / 1024) }; };
  await page.evaluate(() => { NAV = [{ v: 'home' }]; RS = { cats: S.cats.filter((c) => c.kind === 'exp').map((c) => c.id), subs: null }; go('rep'); }); await H.settle(page, 600);
  const r10 = await dl(() => ACT.repPdf()); if (!r10) console.log('dbg:', await page.evaluate(() => { try { const [a, b] = repSpecs(); return [pdfPages(a).length, pdfPages(b).length, typeof mkPdf]; } catch (e) { return String(e && e.stack); } })); const l10 = await dl(() => ACT.ledPdf({ dataset: { id: 'sAlpha' } }));
  check('10 ייצוא PDF של דוח: קובץ PDF תקין', r10 && r10.pdf && /^LargePami_Report_.+\.pdf$/.test(r10.n), r10);
  check('10א ייצוא PDF של כרטסת (ספק בשם עברי): PDF תקין ושם קובץ משמעותי (לא "download")', l10 && l10.pdf && /^LargePami_Ledger_supplier_.+\.pdf$/.test(l10.n), l10);
  check('11 אין שגיאות JS (מנהל)', page.__errors.length === 0, page.__errors); await ctx.close();

  // 20. עובד: 2 חשבוניות ברצף → רשימה; פתיחה = טופס העובד עם הדפים של המסמך הראשון בלבד
  const w = await H.newPage(browser, www, cfg, [], 'w'); const wp = w.page; await wp.setViewportSize({ width: 360, height: 740 }); await mockScan(wp); await H.login(wp, 'w@x.co');
  await wp.evaluate(() => usOpen()); await H.settle(wp, 300); wp.__q = [INV('W-1', 11), INV('W-1', 22), INV('W-2', 33)]; await pick(wp, [201, 202, 203]);
  const g20 = await groups(wp); await wp.click('#sheet [data-a=usGo][data-g="0"]'); await H.settle(wp, 900);
  const t20 = await wp.evaluate(() => ({ pages: WK.pages.length, amt: WK.amt, inv: WK.inv }));
  check('20 עובד: 3 דפים → 2 מסמכים; הראשון נפתח בטופס העובד עם 2 הדפים שלו', g20 && g20.length === 2 && t20.pages === 2 && t20.amt === '22' && t20.inv === 'W-1', { g20, t20 });
  check('21 אין שגיאות JS (עובד)', wp.__errors.length === 0, wp.__errors); await w.ctx.close();
  await browser.close(); console.log(fail ? 'נכשלו ' + fail : 'כל הבדיקות עברו'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
