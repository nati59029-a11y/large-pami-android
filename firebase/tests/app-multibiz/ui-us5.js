'use strict';
// סריקה אחידה, שלב 5: חיבור דפים (Z בשלושה חלקים, חשבונית עד 12 דפים, הפרדת רצף, דף כפול, תיקון ידני, תור ב-IndexedDB),
// ח.פ בכרטיס ספק, קבלה לחשבונית שכבר יש לה קובץ, וייצוא PDF של דוח וכרטסת. רשת מדומה; scanDocument מדומה (תור תשובות).
// שימוש: NODE_PATH=... node ui-us5.js <www-dir>
const H = require('./harness');
const BZ0 = ['larg', 'peami'].join('');
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
let fail = 0; const check = (n, ok, info) => { if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 300) : '')); };
const mkImg = (page, label) => page.evaluate((label) => { const c = document.createElement('canvas'); c.width = 400; c.height = 560; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 400, 560); x.fillStyle = '#222'; x.font = 'bold 48px sans-serif'; x.fillText(label, 30, 90); for (let i = 0; i < label.length; i++) x.fillRect(30 + i * 20, 200, 12, 40 + i * 9); return c.toDataURL('image/png').split(',')[1]; }, label).then((b) => Buffer.from(b, 'base64'));
async function mockScan(page) {
  page.__q = []; page.__calls = 0;
  await page.route('**/scanDocument', async (route) => {
    page.__calls++; const a = page.__q.shift() || { type: 'unknown', allowed: true, fields: {}, confidence: {}, uncertain: [] };
    if (a.err) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { status: 'INTERNAL', message: 'x', details: { reason: a.err } } }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { result: a }, usage: {} }) });
  });
}
const INV = (num, sup, total, o) => Object.assign({ type: 'invoice', docType: 'invoice', typeConfidence: 0.95, allowed: true, fields: { supplier: sup, number: num, date: '2026-11-01', total_with_vat: total }, confidence: {}, uncertain: [] }, o || {});
const Z = (part, f) => ({ type: 'zreport', zPart: part, allowed: true, fields: f || {}, confidence: {}, uncertain: [] });
// צילום ברצף: כל הדפים בבת אחת מהגלריה, ואז "סיום וזיהוי"
async function batch(page, labels, answers) {
  await page.evaluate(() => { if (US) usReset(); usOpen(); }); await H.settle(page, 300);
  await page.click('#sheet [data-a=usBatch]'); await H.settle(page, 200);
  const files = []; for (const l of labels) files.push({ name: l + '.png', mimeType: 'image/png', buffer: await mkImg(page, l) });
  await page.setInputFiles('#sheet input[accept="image/*"][multiple]', files); await H.settle(page, 600 + 250 * labels.length);
  page.__q = answers.slice(); page.__calls = 0;
  await page.click('#sheet [data-a=usBatchGo]'); await H.settle(page, 900 + 300 * labels.length);
}
const groups = (page) => page.evaluate(() => US && US.grp ? US.grp.map((g) => ({ k: g.k, ix: g.ix.slice(), ask: g.ask.map((a) => a.t), done: g.done })) : null);
const saveExp = async (page) => { await page.click('#sheet form[data-f=addsave] button[value=done]'); await H.settle(page, 700); };

(async () => {
  const [www] = process.argv.slice(2); const browser = await H.launch();
  const cfg = { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: ALL } }, admins: { '|m': 1 }, staff: { '|w': 1 } };
  const { ctx, page } = await H.newPage(browser, www, cfg, [], 'm'); await page.setViewportSize({ width: 360, height: 740 }); await mockScan(page); await H.login(page, 'm@x.co');
  await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden) ACT.startBlank(); }); await H.settle(page, 400);
  await page.evaluate(() => { const c = S.cats.find((x) => x.beh === 'sup'); S.subs.push({ id: 'sA', cat: c.id, name: 'ספק אלפא' }, { id: 'sB', cat: c.id, name: 'ספק בטא' }); save(); });

  // 1. Z: שלושה חלקים בסדר אקראי → מסמך אחד בסדר עליון/אמצעי/תחתון; כל צילום במקום שלו בטופס הסגירה
  await batch(page, ['Z-BOT', 'Z-TOP', 'Z-MID'], [Z('bottom', { total: 900 }), Z('top', { report_no: '55', date: '2026-11-02' }), Z('middle', { cash: 300 })]);
  let g = await groups(page);
  check('1 Z בסדר אקראי: מסמך אחד, סדר עליון-אמצעי-תחתון, 3 קריאות (דף = 1)', g && g.length === 1 && g[0].k === 'z' && g[0].ix.join() === '1,2,0' && page.__calls === 3, { g, calls: page.__calls });
  const zImgs = await page.evaluate(() => US.all.map((x) => x.u));
  await page.click('#sheet [data-a=usGo]'); await H.settle(page, 1500);
  const t1 = await page.evaluate((u) => ({ v: cur().v, ok: !!(ZC && ZC.z.every(Boolean)), no: ZC && ZC.f && ZC.f.no, tot: ZC && ZC.f && ZC.f.total, cash: ZC && ZC.f && ZC.f.cash }), zImgs);
  check('1א Z בטופס הסגירה: 3 צילומים, שדות מכל החלקים', t1.v === 'zc' && t1.ok && t1.no === '55' && t1.tot === '900' && t1.cash === '300', t1);
  await page.click('#bk'); await H.settle(page, 400); await page.evaluate(() => { if (US) { US.quit = 1; usReset(); } usqDel(); ZC = null; }); await H.settle(page, 200);

  // 2. Z עם 2 חלקים → התראה על החלק החסר + כפתור להוספה
  await batch(page, ['Z2-TOP', 'Z2-BOT'], [Z('top'), Z('bottom')]);
  const t2 = await page.evaluate(() => ({ txt: document.getElementById('sheet').innerText, add: !!document.querySelector('#sheet [data-c=usRvAdd]') }));
  check('2 Z עם 2 חלקים: "חסר בדוח Z: אמצעי" + הוספת החלק החסר', /חסר בדוח Z/.test(t2.txt) && /אמצעי/.test(t2.txt) && t2.add, t2.txt.slice(0, 200));
  page.__q = [Z('middle', { cash: 10 })]; await page.setInputFiles('#sheet [data-c=usRvAdd]', { name: 'm.png', mimeType: 'image/png', buffer: await mkImg(page, 'Z2-MID') }); await H.settle(page, 1800);
  g = await groups(page);
  check('2א החלק החסר נוסף ומסודר במקום (עליון-אמצעי-תחתון), בלי התראה', g && g.length === 1 && g[0].ix.join() === '0,2,1' && !(await page.evaluate(() => /חסר בדוח Z/.test(document.getElementById('sheet').innerText))), g);
  await page.evaluate(() => { US.quit = 1; usReset(); usqDel(); });

  // 3. 2 דפים של חשבונית A + חשבונית B → 2 מסמכים; שמירת שניהם = 2 רשומות, סכום ההוצאות = A + B (לא נספר פעמיים)
  await batch(page, ['A-p1', 'A-p2', 'B-1'], [INV('A-1', 'ספק אלפא', null, { page: 1, pages: 2 }), INV('A-1', 'ספק אלפא', 500, { page: 2, pages: 2 }), INV('B-9', 'ספק בטא', 80)]);
  g = await groups(page);
  check('3 שתי חשבוניות: [A: 2 דפים], [B: דף אחד]', g && g.length === 2 && g[0].ix.join() === '0,1' && g[1].ix.join() === '2', g);
  let n0 = await page.evaluate(() => ({ n: S.tx.length, s: S.tx.filter((t) => t.t === 'exp').reduce((a, t) => a + t.amt, 0) }));
  await page.click('#sheet [data-a=usGo]'); await H.settle(page, 1200);
  const fA = await page.evaluate(() => { const f = document.querySelector('#sheet form[data-f=addsave]'); return f && { amt: f.amt.value, inv: f.inv.value, sub: A.sub, pages: US.pg.length }; });
  await saveExp(page);
  const mid = await page.evaluate(() => ({ step: US && US.step, nx: !!document.querySelector('#sheet [data-a=usGo]') }));
  await page.click('#sheet [data-a=usGo]'); await H.settle(page, 1200); await saveExp(page);
  const t3 = await page.evaluate((n0) => { const L = S.tx.slice(n0.n); return { d: L.length, s: S.tx.filter((t) => t.t === 'exp').reduce((a, t) => a + t.amt, 0) - n0.s, pg: L.map((t) => t.file), again: !!document.querySelector('[data-a=usAgain]') }; }, n0);
  const pA = await page.evaluate(async (f) => { const v = await fget(f); return typeof v === 'string' && v.startsWith('PAGES:') ? JSON.parse(v.slice(6)).length : 1; }, t3.pg[0]);
  check('3א חשבונית A: סכום מהדף האחרון, 2 דפים, ספק אלפא', fA && fA.amt === '500' && fA.inv === 'A-1' && fA.sub === 'sA' && fA.pages === 2, fA);
  check('3ב אחרי A חוזרים למסך חיבור הדפים, ממשיכים ל-B', mid.step === 'review' && mid.nx, mid);
  check('3ג 2 רשומות בדיוק, סכום ההוצאות = 580, קובץ A עם 2 עמודים, "סרוק עוד" בסוף', t3.d === 2 && Math.abs(t3.s - 580) < 0.001 && pA === 2 && t3.again, { t3, pA });
  check('3ד התור נמחק מהמכשיר אחרי האחרון', !(await page.evaluate(async () => await fget(usqK()))));

  // 4. תיקון ידני: איחוד שגוי (B נכנס ל-A בגלל מספר זהה) → פיצול; פיצול שגוי → צירוף; שינוי סדר
  await page.evaluate(() => { if (US) usReset(); });
  await batch(page, ['X-1', 'X-2', 'Y-1'], [INV('X-5', 'ספק אלפא', 10), INV('X-5', 'ספק אלפא', 20), INV('Y-7', 'ספק בטא', 30)]);
  g = await groups(page); const g4a = g;
  await page.click('#sheet [data-a=usRvSplit][data-g="0"][data-p="1"]'); await H.settle(page, 300); g = await groups(page); const g4b = g;
  await page.click('#sheet [data-a=usRvJoin][data-g="2"][data-p="0"]'); await H.settle(page, 300); g = await groups(page); const g4c = g;
  await page.click('#sheet [data-a=usRvMv][data-g="1"][data-p="1"][data-d="-1"]'); await H.settle(page, 300); g = await groups(page);
  check('4 תיקון ידני: פיצול, צירוף למסמך הקודם, שינוי סדר', g4a.length === 2 && g4a[0].ix.join() === '0,1' && g4b.length === 3 && g4c.length === 2 && g4c[1].ix.join() === '1,2' && g[1].ix.join() === '2,1', { g4a, g4b, g4c, g });
  await page.evaluate(() => { US.quit = 1; usReset(); usqDel(); });

  // 5. 12 דפים של חשבונית אחת → רשומה אחת
  const L12 = Array.from({ length: 12 }, (_, i) => 'L' + (i + 1)); const A12 = L12.map((_, i) => INV('L-12', 'ספק אלפא', i === 11 ? 1200 : null, { page: i + 1, pages: 12 }));
  await batch(page, L12, A12); g = await groups(page);
  n0 = await page.evaluate(() => S.tx.length);
  await page.click('#sheet [data-a=usGo]'); await H.settle(page, 1200); await saveExp(page);
  const t5 = await page.evaluate((n0) => ({ d: S.tx.length - n0, amt: S.tx[S.tx.length - 1].amt, f: S.tx[S.tx.length - 1].file }), n0);
  const p12 = await page.evaluate(async (f) => { const v = await fget(f); return typeof v === 'string' && v.startsWith('PAGES:') ? JSON.parse(v.slice(6)).length : 1; }, t5.f);
  check('5 12 דפים של חשבונית אחת → מסמך אחד → רשומה אחת, קובץ עם 12 עמודים', g && g.length === 1 && g[0].ix.length === 12 && t5.d === 1 && t5.amt === 1200 && p12 === 12 && page.__calls === 12, { g: g && g.length, t5, p12 });

  // 6. Z + חשבונית מעורבבים → שני מסמכים נפרדים
  await page.evaluate(() => { if (US) usReset(); });
  await batch(page, ['M-Z1', 'M-INV', 'M-Z2', 'M-Z3'], [Z('top'), INV('Q-1', 'ספק בטא', 40), Z('middle'), Z('bottom')]);
  g = await groups(page);
  check('6 Z + חשבונית מעורבבים → 2 מסמכים (Z בסדר, חשבונית לבד)', g && g.length === 2 && g[0].k === 'z' && g[0].ix.join() === '0,2,3' && g[1].k === 'exp' && g[1].ix.join() === '1', g);
  await page.evaluate(() => { US.quit = 1; usReset(); usqDel(); });

  // 7. דף כפול (אותו עמוד פעמיים) → התראה, שני הדפים זה ליד זה, מחיקת הכפול
  await batch(page, ['D-1', 'D-1b', 'D-2'], [INV('D-3', 'ספק אלפא', null, { page: 1, pages: 2 }), INV('D-3', 'ספק אלפא', null, { page: 1, pages: 2 }), INV('D-3', 'ספק אלפא', 70, { page: 2, pages: 2 })]);
  const t7 = await page.evaluate(() => ({ dup: /דף כפול/.test(document.getElementById('sheet').innerText), imgs: document.querySelectorAll('#sheet .usrd img').length, go: document.querySelector('#sheet [data-a=usGo]').disabled }));
  await page.click('#sheet [data-a=usRvAsk][data-v=del]'); await H.settle(page, 300); g = await groups(page);
  check('7 דף כפול: התראה + שני הדפים זה ליד זה, "המשך" חסום עד החלטה; מחיקה משאירה 2 דפים', t7.dup && t7.imgs === 2 && t7.go && g[0].ix.join() === '0,2' && !g[0].ask.length, { t7, g });
  await page.evaluate(() => { US.quit = 1; usReset(); usqDel(); });

  // 8. דף המשך בלי מספר → שאלה; דף המשך מיום אחר → שאלה
  await batch(page, ['N-1', 'N-2', 'N-3'], [INV('N-4', 'ספק אלפא', null), INV('', 'ספק אלפא', 50, { fields: { supplier: 'ספק אלפא', number: null, date: null, total_with_vat: 50 } }), INV('N-4', 'ספק אלפא', null, { fields: { supplier: 'ספק אלפא', number: 'N-4', date: '2026-11-05', total_with_vat: null } })]);
  g = await groups(page);
  check('8 דף בלי מספר ודף מיום אחר: מחוברים עם שאלה', g && g.length === 1 && g[0].ix.length === 3 && g[0].ask.includes('nonum') && g[0].ask.includes('date'), g);
  await page.click('#sheet [data-a=usRvAsk][data-v=sep]'); await H.settle(page, 300); g = await groups(page);
  check('8א "מסמך נפרד" מוציא את הדף לקבוצה משלו', g.length === 2, g);

  // 9. סגירת האפליקציה באמצע: הדפים והחלוקה נשמרים במכשיר (IndexedDB); בפתיחה – "המשך", בלי זיהוי נוסף
  const before = await groups(page);
  await page.reload(); await page.waitForLoadState('load'); await H.settle(page, 2500); await mockScan(page).catch(() => {}); page.__calls = 0;
  await page.evaluate(() => usOpen()); await H.settle(page, 800);
  const card = await page.evaluate(() => document.querySelector('#sheet .usqc') && document.querySelector('#sheet .usqc').innerText);
  await page.click('#sheet [data-a=usqGo]'); await H.settle(page, 800); g = await groups(page);
  check('9 אחרי טעינה מחדש: "יש 3 דפים שצולמו", המשך מחזיר את אותה חלוקה, 0 קריאות זיהוי', card && /3 דפים/.test(card) && JSON.stringify(g) === JSON.stringify(before) && page.__calls === 0, { card, g, before });
  await page.evaluate(() => { US.quit = 1; usReset(); }); await page.evaluate(() => usOpen()); await H.settle(page, 800);
  await page.click('#sheet [data-a=usqDrop]'); await H.settle(page, 200); await page.click('#dlg [data-a=yes]'); await H.settle(page, 400);
  check('9א "מחיקה" מוחקת את התור מהמכשיר', !(await page.evaluate(async () => await fget(usqK()))) && !(await page.evaluate(() => !!document.querySelector('#sheet .usqc'))));
  await page.evaluate(() => usReset());
  // 9ב. צילום ברצף בלי זיהוי עדיין: כל דף שצולם נשמר מיד
  await page.evaluate(() => usOpen()); await H.settle(page, 300); await page.click('#sheet [data-a=usBatch]'); await H.settle(page, 200);
  await page.setInputFiles('#sheet input[accept="image/*"][multiple]', [{ name: 'a.png', mimeType: 'image/png', buffer: await mkImg(page, 'R-1') }, { name: 'b.png', mimeType: 'image/png', buffer: await mkImg(page, 'R-2') }]); await H.settle(page, 1200);
  const q9 = await page.evaluate(async () => { const s = await fget(usqK()); return s && JSON.parse(s).all.length; });
  check('9ב צילום ברצף: הדפים נשמרים במכשיר כבר לפני הזיהוי', q9 === 2, q9);
  await page.evaluate(() => { usReset(); usqDel(); });

  // 10. ח.פ בכרטיס ספק: שדה בהגדרות הכרטיס, נשמר; זיהוי לפי ח.פ גם כשהשם שונה
  await page.evaluate(() => ACT.subMenu({ dataset: { id: 'sB' } })); await H.settle(page, 200);
  const hasHp = await page.evaluate(() => !!document.querySelector('#dlg form[data-f=subsave] input[name=hp]'));
  await page.fill('#dlg input[name=hp]', '51-234567-8'); await page.click('#dlg form[data-f=subsave] button.btn'); await H.settle(page, 300);
  const hp = await page.evaluate(() => S.subs.find((s) => s.id === 'sB').hp);
  await page.evaluate(() => ACT.subMenu({ dataset: { id: 'sA' } })); await H.settle(page, 200); await page.fill('#dlg input[name=hp]', '512345678'); await page.click('#dlg form[data-f=subsave] button.btn'); await H.settle(page, 300);
  const dupHp = await page.evaluate(() => S.subs.find((s) => s.id === 'sA').hp || ''); await page.evaluate(() => closeDlg());
  check('10 ח.פ בכרטיס ספק: נשמר כספרות; אותו ח.פ לשני ספקים נחסם', hasHp && hp === '512345678' && dupHp === '', { hasHp, hp, dupHp });
  await page.evaluate(() => usOpen()); await H.settle(page, 200);
  page.__q = [INV('H-1', 'חברת בטא בע"מ - סניף מרכז', 33, { fields: { supplier: 'שם אחר לגמרי', supplier_id: '512345678', number: 'H-1', date: '2026-11-01', total_with_vat: 33 } })];
  await page.setInputFiles('#sheet input[accept="image/*"][multiple]', { name: 'h.png', mimeType: 'image/png', buffer: await mkImg(page, 'HP') }); await H.settle(page, 2500);
  const t10 = await page.evaluate(() => A && { sub: A.sub, step: A.step });
  check('10א זיהוי ספק לפי ח.פ (השם לא תואם)', t10 && t10.sub === 'sB' && t10.step === 'det', t10);
  await page.evaluate(() => usReset());
  await page.evaluate(() => usOpen()); await H.settle(page, 200);
  page.__q = [INV('H-2', 'ספק אלפא', 12, { fields: { supplier: 'ספק אלפא', supplier_id: '599999999', number: 'H-2', date: '2026-11-01', total_with_vat: 12 } })];
  await page.setInputFiles('#sheet input[accept="image/*"][multiple]', { name: 'h2.png', mimeType: 'image/png', buffer: await mkImg(page, 'HP2') }); await H.settle(page, 2500);
  check('10ב ח.פ לא מוכר → לפי השם', await page.evaluate(() => A && A.sub === 'sA'));
  await page.evaluate(() => usReset());

  // 11. קבלה לחשבונית שכבר יש לה קובץ → שני הקבצים נשמרים, ושניהם נצפים מהשורה; בלי הוצאה נוספת
  const inv = await page.evaluate(async (img) => { await fput('fInvOld', 'data:image/png;base64,' + img); const t = { id: 'tInv', t: 'exp', cat: S.subs.find((s) => s.id === 'sA').cat, sub: 'sA', date: '2026-11-01', amt: 99, kind: 'inv', plan: '2026-11', inv: 'K-1', note: '', desc: '', pays: [], file: 'fInvOld' }; S.tx.push(t); save(); return S.tx.length; }, (await mkImg(page, 'OLD')).toString('base64'));
  await page.evaluate(() => usOpen()); await H.settle(page, 200);
  page.__q = [INV('R-5', 'ספק אלפא', 99, { docType: 'receipt', fields: { supplier: 'ספק אלפא', number: 'R-5', related_invoice: 'K-1', date: '2026-11-03', total_with_vat: 99 } })];
  await page.setInputFiles('#sheet input[accept="image/*"][multiple]', { name: 'r.png', mimeType: 'image/png', buffer: await mkImg(page, 'RCPT') }); await H.settle(page, 2500);
  await saveExp(page); const rq = await page.evaluate(() => !!document.querySelector('#dlg [data-a=yes]')); if (rq) { await page.click('#dlg [data-a=yes]'); await H.settle(page, 500); }
  const t11 = await page.evaluate(async (n) => { const t = S.tx.find((x) => x.id === 'tInv'); return { d: S.tx.length - n, file: t.file, rcf: t.rcf || '', has: !!(t.rcf && await fget(t.rcf)), inBk: bkFileIds().includes(t.rcf) }; }, inv);
  await page.evaluate(() => { NAV = [{ v: 'home' }]; render(0); }); await H.settle(page, 500);
  const row = await page.evaluate(() => { const b = document.querySelector('#main [data-a=tx][data-id=tInv]'); const w = b && b.closest('.lw'); return w ? [...w.querySelectorAll('.dxa [data-a=dxView]')].map((x) => x.dataset.f) : null; });
  await page.evaluate(() => txDlg('tInv')); await H.settle(page, 300);
  const det = await page.evaluate(() => [...document.querySelectorAll('#dlg [data-a=dxView]')].map((x) => x.dataset.f));
  await page.evaluate(() => closeDlg());
  check('11 קבלה לחשבונית עם קובץ: אין הוצאה נוספת, הקובץ הישן נשאר, הקבלה ב-rcf ובגיבוי', rq && t11.d === 0 && t11.file === 'fInvOld' && t11.rcf && t11.has && t11.inBk, t11);
  check('11א שני הקבצים נצפים מהשורה ומפרטי הרשומה', row && row.includes('fInvOld') && row.includes(t11.rcf) && det.includes(t11.rcf), { row, det });

  // 12. ייצוא PDF: דוח וכרטסת – הורדה עם שם נכון ותוכן PDF
  const dl = async (fn) => { const p = page.waitForEvent('download', { timeout: 8000 }).catch(() => null); await page.evaluate(fn); const d = await p; if (!d) return null; const fs = require('fs'); const pth = await d.path(); const head = pth ? fs.readFileSync(pth).slice(0, 5).toString() : ''; return { n: d.suggestedFilename(), head }; };
  await page.evaluate(() => { NAV = [{ v: 'home' }]; render(0); });
  await page.evaluate(() => { closeDlg(); ACT.rep({ dataset: { s: 'sub:sA' } }); }); await H.settle(page, 400);
  const rep = await dl(() => ACT.repPdf());
  const led = await dl(() => ACT.ledPdf({ dataset: { id: 'sA' } }));
  check('12 ייצוא PDF של דוח: LargePami_Report_….pdf, תוכן %PDF-', rep && /^LargePami_Report_.+\.pdf$/.test(rep.n) && rep.head === '%PDF-', rep);
  check('12א ייצוא PDF של כרטסת: Ledger_….pdf (לא "download"), תוכן %PDF-', led && /^Ledger_.+\.pdf$/.test(led.n) && led.head === '%PDF-', led);

  check('13 אין שגיאות JS (מנהל)', page.__errors.length === 0, page.__errors); await ctx.close();

  // עובד: חשבונית של 2 דפים → טופס העובד עם שני הדפים והסכום מהדף האחרון
  const w = await H.newPage(browser, www, cfg, [], 'w'); const wp = w.page; await wp.setViewportSize({ width: 360, height: 740 }); await mockScan(wp); await H.login(wp, 'w@x.co');
  await batch(wp, ['W-1', 'W-2'], [INV('W-1', 'ספק', null, { page: 1, pages: 2 }), INV('W-1', 'ספק', 77, { page: 2, pages: 2 })]);
  await wp.click('#sheet [data-a=usGo]'); await H.settle(wp, 1200);
  const t20 = await wp.evaluate(() => ({ amt: WK.amt, inv: WK.inv, pages: WK.pages.length }));
  check('20 עובד: חשבונית 2 דפים → טופס אחד עם 2 דפים, סכום מהדף האחרון', t20.amt === '77' && t20.inv === 'W-1' && t20.pages === 2, t20);
  check('21 אין שגיאות JS (עובד)', wp.__errors.length === 0, wp.__errors); await w.ctx.close();
  await browser.close(); console.log(fail ? 'נכשלו ' + fail : 'כל הבדיקות עברו'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
