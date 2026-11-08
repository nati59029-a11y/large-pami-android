'use strict';
// תזרים/צ'קים – חלק ב', ליבה (B1): נתונים ישנים זהים, dueCalc, cfDebits, צ'ק בתשלום, chkMatch, סריקת צ'ק מדומה, brRe בסריקת חשבונית.
// רשת מדומה (harness), זמן קבוע 3.11.2026. שימוש: NODE_PATH=... node ui-cf1.js <www-dir>
const H = require('./harness');
const BZ0 = ['larg', 'peami'].join('');
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
let fail = 0; const check = (n, ok, info) => { if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const ORG2 = { v: 1, branches: [{ id: 'bra', name: 'נחל לכיש', on: true, sig: [{ k: 'sup', v: 'sbra' }] }, { id: 'brb', name: 'יהודה הנשיא', on: true, sig: [] }],
  banks: [{ id: 'bka', name: 'לאומי', last4: '1234', on: true, sig: [] }], cards: [] };
const mkImg = (page, label) => page.evaluate((label) => { const c = document.createElement('canvas'); c.width = 400; c.height = 300; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 400, 300); x.fillStyle = '#222'; x.font = 'bold 40px sans-serif'; x.fillText(label, 30, 90); return c.toDataURL('image/png').split(',')[1]; }, label).then((b) => Buffer.from(b, 'base64'));
async function mockScan(page) {
  page.__q = [];
  await page.route('**/scanDocument', async (route) => {
    const a = page.__q.shift() || { type: 'unknown', allowed: true, fields: {}, confidence: {}, uncertain: [] };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { result: a }, usage: {} }) });
  });
}
// נתונים "ישנים": בלי terms/due/chk. ספק sA (pm=1), ספק sB (בלי pm, ברירת מחדל 2), ספק קיזוז sO
const seed = (p) => p.evaluate(() => {
  S.tx = []; delete S.orgC; delete S.terms; BRSEL = []; S.pmOff = 2;
  S.subs = S.subs.filter((s) => !['sA', 'sB', 'sO', 'sbra'].includes(s.id));
  S.subs.push({ id: 'sA', cat: 'e_sup', name: 'מאפיית השחר', pm: 1 }, { id: 'sB', cat: 'e_sup', name: 'ספק בית' }, { id: 'sO', cat: 'e_sup', name: 'ספק קיזוז', offset: true }, { id: 'sbra', cat: 'e_sup', name: 'ספק לכיש' });
  const mk = (id, sub, date, amt, plan, pays, ex) => S.tx.push(Object.assign({ id, t: 'exp', cat: 'e_sup', sub, date, amt, note: '', kind: 'inv', plan, inv: id.toUpperCase(), pays: pays || [] }, ex || {}));
  mk('a1', 'sA', '2026-09-10', 1000, '2026-10');                       // באיחור (חודש קודם)
  mk('a2', 'sA', '2026-10-05', 500, '2026-11');                        // לתשלום החודש
  mk('a3', 'sA', '2026-10-20', 300, '2026-11', [{ id: 'p1', d: '2026-11-01', a: 100, m: 'העברה' }]); // חלקי
  mk('b1', 'sB', '2026-10-01', 800, '2026-12');                        // חודש הבא
  mk('b2', 'sB', '2026-10-02', 200, '2026-11', [{ id: 'p2', d: '2026-11-02', a: 200, m: 'מזומן' }]);   // שולם במזומן
  mk('o1', 'sO', '2026-10-03', 700, '2026-11');                        // ספק קיזוז
  save();
});
(async () => {
  const [www] = process.argv.slice(2); const browser = await H.launch();
  const cfg = { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: ALL } }, admins: { '|m': 1 }, staff: { '|w': 1 } };
  const m = await H.newPage(browser, www, cfg, [], 'm'); const mp = m.page; await mp.setViewportSize({ width: 360, height: 740 }); await mockScan(mp); await H.login(mp, 'm@x.co');
  await seed(mp);

  // ---- 1. נתונים ישנים: ensure(save(load())) זהה; dueOf = סוף חודש pmon; dueStats כמו בחישוב הישן ----
  const t1 = await mp.evaluate(() => {
    const before = JSON.stringify({ tx: S.tx, subs: S.subs }); const D0 = dueStats('2026-11');
    save(); load(); const after = JSON.stringify({ tx: S.tx, subs: S.subs }); S = ensure(S); const after2 = JSON.stringify({ tx: S.tx, subs: S.subs });
    const old = (m) => { const late = inv().filter((t) => pmon(t) < m && bal(t) > 0.004); return { n: late.length, s: rnd(sum(late, bal)) }; };
    const D = dueStats('2026-11'), O = old('2026-11');
    return { same: before === after && after === after2, dues: S.tx.map((t) => dueOf(t)).join(','), lateN: D.late.length, lateS: D.lateSum, O, due: D.due, due0: D0.due, rem: D.rem, noDue: S.tx.every((t) => !('due' in t)) };
  });
  check('1 נתונים ישנים: שמירה/טעינה/ensure לא משנים tx/subs ולא מוסיפים due', t1.same && t1.noDue, t1);
  check('1א dueOf בלי due = סוף חודש התשלום', t1.dues === '2026-10-31,2026-11-30,2026-11-30,2026-12-31,2026-11-30,2026-11-30', t1.dues);
  check('1ב dueStats: באיחור זהה לחישוב הישן (לפי חודש) על נתונים ישנים', t1.lateN === t1.O.n && t1.lateS === t1.O.s && t1.lateS === 1000, t1);
  const t1c = await mp.evaluate(() => { const b = JSON.parse(JSON.stringify(S)); b.subs[0].terms = { b: 'x', d: 5 }; b.tx[0].due = '2026-13-40'; b.tx[2].pays[0].chk = { no: 1 }; const c = ensure(b); return { t: 'terms' in c.subs[0], d: 'due' in c.tx[0], k: 'chk' in c.tx[2].pays[0] }; });
  check('1ג ensure מוחק רק ערכים פגומים (terms/due/chk)', !t1c.t && !t1c.d && !t1c.k, t1c);

  // ---- 2. dueCalc ----
  const t2 = await mp.evaluate(() => {
    const s = subById('sB'); const r = {};
    s.terms = { b: 'eom', d: 60 }; r.eom60 = dueCalc('sB', '2026-11-15'); r.eom60dec = dueCalc('sB', '2026-12-03'); s.terms = { b: 'eom', d: 45 }; r.eom45 = dueCalc('sB', '2026-11-15');
    s.terms = { b: 'inv', d: 30 }; r.inv30 = dueCalc('sB', '2026-12-20'); r.inv0 = (s.terms = { b: 'inv', d: 0 }, dueCalc('sB', '2026-12-20'));
    delete s.terms; r.pm2 = dueCalc('sB', '2026-11-15'); r.pm2dec = dueCalc('sB', '2026-12-15'); r.pm1 = dueCalc('sA', '2026-12-15');
    S.terms = { b: 'eom', d: 30 }; r.def = dueCalc('sB', '2026-11-15'); r.defPm = dueCalc('sA', '2026-11-15'); r.to = termsOf('sB'); delete S.terms;
    return r;
  });
  check('2 dueCalc: שוטף+60 על 15.11 = 31.1.2027; על דצמבר = 28.2.2027; שוטף+45 = 14.1.2027', t2.eom60 === '2027-01-31' && t2.eom60dec === '2027-02-28' && t2.eom45 === '2027-01-14', t2);
  check('2א dueCalc: 30 יום מחשבונית 20.12 = 19.1.2027 (מעבר שנה); 0 ימים = אותו יום', t2.inv30 === '2027-01-19' && t2.inv0 === '2026-12-20', t2);
  check('2ב dueCalc בלי terms: pm=2 → סוף ינואר / סוף פברואר; pm=1 → סוף ינואר', t2.pm2 === '2027-01-31' && t2.pm2dec === '2027-02-28' && t2.pm1 === '2027-01-31', t2);
  check('2ג ברירת מחדל לעסק (S.terms) חלה על ספק בלי pm; ספק עם pm – לפי pm', t2.def === '2026-12-31' && t2.defPm === '2026-12-31' && t2.to && t2.to.d === 30, t2);

  // ---- 3. isLate לפי תאריך, cfDebits ----
  const t3 = await mp.evaluate(() => {
    const a2 = S.tx.find((t) => t.id === 'a2'); a2.due = '2026-11-02'; const late = isLate(a2), lateBefore = isLate(a2, '2026-11-02');
    delete a2.due;
    const b1 = S.tx.find((t) => t.id === 'b1'); b1.pays.push({ id: 'pc', d: '2026-11-01', a: 300, m: 'צ׳ק', chk: { no: '55', bank: '', date: '2026-12-10', img: '' } });
    b1.pays.push({ id: 'pc2', d: '2026-11-01', a: 100, m: 'צ׳ק' }); // צ'ק ישן בלי chk – לפי p.d
    const a3 = S.tx.find((t) => t.id === 'a3'); a3.pays.push({ id: 'pa', d: '2026-11-02', a: 50, m: 'אשראי' });
    const N = cfDebits('2026-11', []), D = cfDebits('2026-12', []);
    return { late, lateBefore,
      N: { chk: N.chk.map((x) => x.p.id), tr: N.tr.map((x) => x.t.id + ':' + x.a), paid: N.paid.map((x) => x.p.id), sum: N.sum, sumExp: N.sumExp, sumPaid: N.sumPaid },
      D: { chk: D.chk.map((x) => x.p.id + ':' + x.date), tr: D.tr.map((x) => x.t.id + ':' + x.a), sum: D.sum },
      M: cfMonths('2026-11', 3, []).map((x) => x.m + '=' + x.sum).join(',') };
  });
  check('3 isLate: due 2.11 – באיחור ב-3.11, לא ב-2.11', t3.late === true && t3.lateBefore === false, t3);
  check('3א cfDebits נובמבר: העברות פתוחות a2(500)+a3(150), שולם בהעברה p1(100), צ׳ק בלי chk לפי p.d; מזומן/אשראי/קיזוז בחוץ', JSON.stringify(t3.N.tr) === '["a2:500","a3:150"]' && t3.N.paid.join() === 'p1' && t3.N.chk.join() === 'pc2' && t3.N.sum === 850 && t3.N.sumPaid === 100, t3.N);
  check('3ב cfDebits דצמבר: צ׳ק נדחה לפי פירעון 10.12 + יתרת b1 (400) לפי due', t3.D.chk.join() === 'pc:2026-12-10' && t3.D.tr.join() === 'b1:400' && t3.D.sum === 700, t3.D);
  check('3ג cfMonths – 3 חודשים', t3.M === '2026-11=850,2026-12=700,2027-01=0', t3.M);
  const t3d = await mp.evaluate((o) => { S.orgC = o; S.tx.find((t) => t.id === 'a2').br = 'brb'; save(); BRSEL = ['brb']; const r = { sel: cfDebits('2026-11').sumExp, a: cfDebits('2026-11', ['bra']).sumExp, all: cfDebits('2026-11', []).sumExp }; BRSEL = []; delete S.orgC; delete S.tx.find((t) => t.id === 'a2').br; save(); return r; }, ORG2);
  check('3ד סינון סניף: brb = 500 בלבד, bra = 250 (העברה 150 + צ׳ק 100; בלי br = סניף ראשון), הכול = 750', t3d.sel === 500 && t3d.a === 250 && t3d.all === 750, t3d);
  const t3e = await mp.evaluate(() => { const H = homeCards('2026-11'), D = dueStats('2026-11'); return { due: H.due === D.due, lateN: H.lateN, lateSum: H.lateSum, debit: H.debit }; });
  check('3ה homeCards: לתשלום = dueStats, באיחור 1000 (a1), ירידה = cfDebits', t3e.due && t3e.lateN === 1 && t3e.lateSum === 1000 && t3e.debit === 850, t3e);

  // ---- 4. צ'ק בטופס תשלום ----
  await seed(mp);
  const t4 = await mp.evaluate(async () => {
    payDlg('a2'); const d = document.getElementById('dlg'), f = d.querySelector('form[data-f=paysave]'); const r = {};
    const pc = d.querySelector('[data-pmc]'); r.hidden0 = pc && pc.style.display === 'none';
    const rb = [...f.querySelectorAll('input[name=m]')].find((x) => x.value === 'צ׳ק'); rb.checked = true; rb.dispatchEvent(new Event('change', { bubbles: true })); r.shown = pc.style.display !== 'none';
    f.a.value = '200'; f.cno.value = '00777'; await FRM.paysave(f); r.blocked = S.tx.find((t) => t.id === 'a2').pays.length === 0 && d.open;
    f.cdate.value = '2027-01-15'; await FRM.paysave(f); const p = S.tx.find((t) => t.id === 'a2').pays[0];
    r.p = p; return r;
  });
  check('4 צ׳ק בתשלום: שדות מוסתרים עד שבוחרים צ׳ק', t4.hidden0 && t4.shown, t4);
  check('4א בלי תאריך פירעון – נחסם', t4.blocked, t4);
  check('4ב נשמר chk {no,date} ו-m=צ׳ק; תזרים ינואר כולל 200', t4.p && t4.p.m === 'צ׳ק' && t4.p.chk && t4.p.chk.no === '00777' && t4.p.chk.date === '2027-01-15' && await mp.evaluate(() => cfDebits('2027-01', []).sumChk === 200), t4.p);
  const t4c = await mp.evaluate(async () => { payDlg('a1'); const f = document.querySelector('#dlg form[data-f=paysave]'); const rb = [...f.querySelectorAll('input[name=m]')].find((x) => x.value === 'העברה'); rb.checked = true; f.a.value = '100'; f.cdate.value = '2027-01-01'; await FRM.paysave(f); const p = S.tx.find((t) => t.id === 'a1').pays[0]; return p && !('chk' in p); });
  check('4ג העברה – לא נשמר chk גם אם השדה מולא', t4c);

  // ---- 5. chkMatch ----
  await seed(mp);
  const t5 = await mp.evaluate(() => ({ one: chkMatch('sA', 500).map((t) => t.id), combo: chkMatch('sA', 1700).map((t) => t.id).sort(), none: chkMatch('sA', 123).length, big: chkMatch('sA', 99999).length, nosub: chkMatch('', 500).length, tol: chkMatch('sA', 200.01).map((t) => t.id) }));
  check('5 chkMatch: יתרה זהה = חשבונית אחת; ±0.01', t5.one.join() === 'a2' && t5.tol.join() === 'a3', t5);
  check('5א chkMatch: צירוף (1000+500+200=1700)', t5.combo.join() === 'a1,a2,a3', t5);
  check('5ב chkMatch: אין התאמה / גדול מכל היתרות / בלי ספק = []', t5.none === 0 && t5.big === 0 && t5.nosub === 0, t5);

  // ---- 6. סריקת צ'ק מדומה ----
  await seed(mp);
  const scanChk = async (fields) => {
    await mp.evaluate(() => { if (US) usReset(); usOpen(); }); await H.settle(mp, 300);
    mp.__q = [{ type: 'check', allowed: true, typeConfidence: 0.9, fields, confidence: {}, uncertain: [] }];
    await mp.setInputFiles('#sheet input[accept="image/*"][multiple]', { name: 'c.png', mimeType: 'image/png', buffer: await mkImg(mp, 'CHK') }); await H.settle(mp, 2200);
  };
  await scanChk({ number: '000123', bank: 'לאומי', date: '2026-12-15', amount: 500, payee: 'מאפיית השחר בע"מ' });
  const t6 = await mp.evaluate(() => { const d = document.getElementById('dlg'), f = d.querySelector('form[data-f=chkLinkF]'); return f ? { open: d.open, sub: f.sub.value, a: f.a.value, no: f.cno.value, date: f.cdate.value, checked: [...f.querySelectorAll('input[name=ck]:checked')].map((x) => x.value), msg: d.querySelector('#ckMsg').innerText } : null; });
  check('6 סריקת צ׳ק: ספק לפי מוטב, סכום, מספר, פירעון; התאמה יחידה מסומנת ושאלה "לשייך לחשבונית"', t6 && t6.sub === 'sA' && t6.a === '500' && t6.no === '000123' && t6.date === '2026-12-15' && t6.checked.join() === 'a2' && /לשייך לחשבונית/.test(t6.msg), t6);
  await mp.click('#dlg form[data-f=chkLinkF] button.btn:not(.g)'); await H.settle(mp, 500);
  const t6b = await mp.evaluate(() => { const p = S.tx.find((t) => t.id === 'a2').pays[0]; return { p, bal: bal(S.tx.find((t) => t.id === 'a2')), done: US && US.step, dec: cfDebits('2026-12', []).sumChk }; });
  check('6א שמירה: תשלום צ׳ק 500 עם chk (פירעון 15.12, img), החשבונית נסגרה, תזרים דצמבר', t6b.p && t6b.p.m === 'צ׳ק' && t6b.p.a === 500 && t6b.p.chk.date === '2026-12-15' && t6b.p.chk.no === '000123' && !!t6b.p.chk.img && t6b.bal === 0 && t6b.done === 'done' && t6b.dec === 500, t6b);
  await scanChk({ amount: 5000, payee: 'מאפיית השחר', date: '2026-12-20' });
  const t6c = await mp.evaluate(async () => { const d = document.getElementById('dlg'), f = d.querySelector('form[data-f=chkLinkF]'); const msg = d.querySelector('#ckMsg').innerText; f.querySelectorAll('input[name=ck]').forEach((x) => { x.checked = true; }); const n = S.tx.reduce((s, t) => s + (t.pays || []).length, 0); FRM.chkLinkF(f); return { msg, saved: S.tx.reduce((s, t) => s + (t.pays || []).length, 0) - n }; });
  check('6ב סכום מעל היתרה: הודעה וחסימה', /גדול מכל היתרות/.test(t6c.msg) && t6c.saved === 0, t6c);
  await mp.evaluate(() => { closeDlg(); usReset(); });
  await scanChk({ amount: 1, payee: 'מאפיית השחר', date: '2026-12-20' });
  const t6d = await mp.evaluate(() => { const d = document.getElementById('dlg'); return { msg: d.querySelector('#ckMsg').innerText, n: d.querySelectorAll('input[name=ck]').length, chk: d.querySelectorAll('input[name=ck]:checked').length }; });
  check('6ג בלי התאמה: רשימת פתוחות לבחירה מרובה, שום דבר לא מסומן', /לא נמצאה התאמה/.test(t6d.msg) && t6d.n === 2 && t6d.chk === 0, t6d);
  await mp.evaluate(() => { closeDlg(); usReset(); });

  // ---- 7. usFillForm מעדכן סניף לפי הספק שזוהה ----
  await seed(mp);
  await mp.evaluate((o) => { S.orgC = o; save(); }, ORG2);
  await mp.evaluate(() => { if (US) usReset(); usOpen(); }); await H.settle(mp, 300);
  mp.__q = [{ type: 'invoice', docType: 'invoice', typeConfidence: 0.95, allowed: true, fields: { supplier: 'ספק לכיש', number: '9', date: '2026-11-01', total_with_vat: 50 }, confidence: {}, uncertain: [] }];
  await mp.setInputFiles('#sheet input[accept="image/*"][multiple]', { name: 'i.png', mimeType: 'image/png', buffer: await mkImg(mp, 'INV') }); await H.settle(mp, 2200);
  const t7 = await mp.evaluate(() => { const s = document.querySelector('#sheet form[data-f=addsave] select[name=br]'); return s ? { v: s.value, sub: A && A.sub } : { none: true, step: A && A.step }; });
  check('7 סריקת חשבונית: סניף מזוהה לפי הספק (sig) אחרי זיהוי הספק', t7.v === 'bra' && t7.sub === 'sbra', t7);
  await mp.evaluate(() => { usReset(); delete S.orgC; save(); });

  check('8 אין שגיאות JS (מנהל)', !mp.__errors.length, mp.__errors);
  // ---- עובד: אין צ׳ק בבורר, בלי שגיאות ----
  const w = await H.newPage(browser, www, cfg, [], 'w'); const wpg = w.page; await wpg.setViewportSize({ width: 360, height: 740 }); await mockScan(wpg); await H.login(wpg, 'w@x.co');
  const t9 = await wpg.evaluate(() => ({ chk: usAllowed('check'), keys: usKeys() }));
  check('9 עובד: סוג צ׳ק לא זמין (שיוך אצל המנהל)', t9.chk === false && !t9.keys.includes('check'), t9);
  await wpg.evaluate(() => { if (US) usReset(); usOpen(); }); await H.settle(wpg, 300);
  wpg.__q = [{ type: 'check', allowed: true, fields: { amount: 10 }, confidence: {}, uncertain: [] }];
  await wpg.setInputFiles('#sheet input[accept="image/*"][multiple]', { name: 'c.png', mimeType: 'image/png', buffer: await mkImg(wpg, 'CHK') }); await H.settle(wpg, 2200);
  const t9b = await wpg.evaluate(() => document.getElementById('sheet').innerText);
  check('9א עובד שסורק צ׳ק: הודעה שהמסמך עובר למנהל', /למנהל/.test(t9b), t9b.slice(0, 200));
  check('9ב אין שגיאות JS (עובד)', !wpg.__errors.length, wpg.__errors);

  await browser.close();
  console.log(fail ? 'נכשלו ' + fail : 'כל הבדיקות עברו'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
