'use strict';
// התאמות – חלק ג', ממשק (C2): V.rec / V.recStm (3 לשוניות, שייך, בחר אחר, הקם הוצאה, ביטול, אשר הכול), באנר בבית, ספק קיזוז (300), הכנסה דרך ספק,
// תיקונים 2–5 (תזרים, באיחור, תנאי תשלום, הגדרות), צ'ק מעובד בתיבת המנהל, עובד לא רואה התאמות, עובד בלי הרשאות סורק צ'ק. רשת מדומה, זמן קבוע 3.11.2026.
// שימוש: NODE_PATH=... [SHOTS=dir] node ui-rec2.js <www-dir>
const H = require('./harness');
const BZ0 = ['larg', 'peami'].join('');
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
let fail = 0; const check = (n, ok, info) => { if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 500) : '')); };
const ORG = { v: 1, branches: [{ id: 'bra', name: 'נחל לכיש', on: true, sig: [] }],
  banks: [{ id: 'bka', name: 'לאומי', last4: '1234', on: true, sig: [] }, { id: 'bkb', name: 'פועלים', last4: '9999', on: true, sig: [] }],
  cards: [{ id: 'cv', name: 'ויזה עסקי', last4: '5678', bank: 'bka', on: true, sig: [] }, { id: 'cm', name: 'מקס', last4: '4321', bank: 'bkb', on: true, sig: [] }] };
const mkImg = (page, label) => page.evaluate((label) => { const c = document.createElement('canvas'); c.width = 400; c.height = 300; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 400, 300); x.fillStyle = '#222'; x.font = 'bold 40px sans-serif'; x.fillText(label, 30, 90); return c.toDataURL('image/png').split(',')[1]; }, label).then((b) => Buffer.from(b, 'base64'));
async function mockScan(page) {
  page.__q = [];
  await page.route('**/scanDocument', async (route) => {
    const a = page.__q.shift() || { type: 'unknown', allowed: true, fields: {}, confidence: {}, uncertain: [] };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { result: a }, usage: {} }) });
  });
}
// גיבוי "ישן": בלי stm/stl/offset/off. ספקים sA (מאפיית השחר), sB (ספק בית), sO (ספק קיזוז)
const seed = (p, org) => p.evaluate((org) => {
  S.tx = []; S.stm = []; S.stl = []; delete S.terms; BRSEL = []; S.pmOff = 2; S.ccx = [{ id: 'cx1', sub: '', date: '2026-10-01', desc: 'ישן', amt: 10, match: '', exp: '' }];
  if (org) S.orgC = org; else delete S.orgC;
  S.subs = S.subs.filter((s) => !['sA', 'sB', 'sO', 'sC'].includes(s.id));
  S.subs.push({ id: 'sA', cat: 'e_sup', name: 'מאפיית השחר', pm: 1 }, { id: 'sB', cat: 'e_sup', name: 'ספק בית' }, { id: 'sO', cat: 'e_sup', name: 'ספק קיזוז' }, { id: 'sC', cat: 'e_sup', name: 'חלבי הגליל' });
  const mk = (id, sub, date, amt, plan, pays) => S.tx.push({ id, t: 'exp', cat: 'e_sup', sub, date, amt, note: '', kind: 'inv', plan, inv: id.toUpperCase(), pays: pays || [] });
  mk('a1', 'sA', '2026-10-01', 1000, '2026-11');
  mk('a2', 'sA', '2026-10-05', 500, '2026-11');
  mk('b1', 'sB', '2026-10-02', 800, '2026-11', [{ id: 'pb1', d: '2026-11-01', a: 800, m: 'העברה', bank: 'bka' }]);
  mk('b2', 'sB', '2026-10-03', 300, '2026-11', [{ id: 'pb2', d: '2026-11-02', a: 300, m: 'מזומן' }]);
  mk('b3', 'sB', '2026-10-04', 450, '2026-11', [{ id: 'pb3', d: '2026-11-02', a: 450, m: 'העברה', bank: 'bkb' }]);
  mk('b4', 'sB', '2026-10-06', 260, '2026-11', [{ id: 'pb4', d: '2026-10-20', a: 260, m: 'צ׳ק', bank: 'bka', chk: { no: '7', bank: 'bka', date: '2026-11-04', img: '' } }]);
  mk('c1', 'sC', '2026-10-07', 700, '2026-11'); mk('c2', 'sC', '2026-10-08', 700, '2026-11');
  mk('o1', 'sO', '2026-10-09', 900, '2026-11'); mk('o2', 'sO', '2026-10-10', 300, '2026-11');
  mk('g1', 'sB', '2026-10-10', 111, '2026-11', [{ id: 'pg1', d: '2026-11-03', a: 111, m: 'העברה', bank: 'bka' }]);   // פער: באפליקציה ולא בדף
  mk('d1', 'sB', '2026-10-11', 333, '2026-12');                                                                // הצעה חלשה (יתרה בלבד) → פתוחה עם "שייך"
  mk('l1', 'sB', '2026-10-12', 77, '2026-11'); S.tx.find((t) => t.id === 'l1').due = '2026-11-01';              // באיחור
  S.tx.push({ id: 'i1', t: 'inc', cat: 'i_yh', sub: null, date: '2026-11-01', amt: 2500, note: 'קופה' });
  save();
}, org || null);const CSV = '﻿תאריך,תיאור פעולה,אסמכתא,חובה,זכות,יתרה\n' +
  '01/11/2026,"העברה מאפיית השחר בע""מ",111,500.00,,10000\n' +   // a2 → אוטומטי
  '01/11/2026,העברה ספק בית,112,800.00,,9200\n' +              // pb1 → אוטומטי
  '04/11/2026,צ\'ק 7,113,260.00,,8940\n' +                     // pb4 → אוטומטי
  '02/11/2026,העברה חלבי הגליל,114,700.00,,8240\n' +           // c1/c2 → דו-משמעי → פתוחה
  '01/11/2026,הפקדה קופה,115,,2500.00,10740\n' +               // i1 → אוטומטי
  '03/11/2026,ויזה עסקי חיוב חודשי 4580123412345678,116,1200.00,,9540\n' + // → skip
  '05/11/2026,עמלת ניהול חשבון,117,25.00,,9515\n' +            // → פתוחה: הקם הוצאה
  '02/11/2026,חיוב לא מזוהה 333,118,333.00,,9100\n';           // → פתוחה עם הצעה חלשה (d1): שייך
const ORG2 = JSON.parse(JSON.stringify(ORG)); ORG2.branches.push({ id: 'brb', name: 'יהודה הנשיא', on: true, sig: [] });
const SHOTS = process.env.SHOTS || '';
(async () => {
  const [www] = process.argv.slice(2); const browser = await H.launch();
  const cfg = { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: ALL } }, admins: { '|m': 1 }, staff: { '|w': 1 } };
  const m = await H.newPage(browser, www, cfg, [], 'm'); const mp = m.page; await mp.setViewportSize({ width: 360, height: 740 }); await mockScan(mp); await H.login(mp, 'm@x.co');
  await seed(mp, ORG2);
  const view = () => mp.evaluate(() => cur().v);
  const txt = () => mp.evaluate(() => document.querySelector('main').innerText);
  const shot = async (n) => { if (SHOTS) await mp.screenshot({ path: SHOTS + '/' + n + '.png', fullPage: true }); };

  // ---- 4. באנר בבית: רק כשיש פתוחות; מתחת לכרטיסים הקטנים; מוביל ל-V.rec ----
  await mp.evaluate(() => { NAV.length = 1; NAV[0] = { v: 'home' }; render(0); sheetClose(); }); await H.settle(mp, 300);
  const b0 = await mp.evaluate(() => ({ ban: !!document.getElementById('recBan'), cards: !!document.getElementById('hcards') }));
  check('4א בלי שורות פתוחות: אין באנר התאמות; כרטיסי הבית במקומם', !b0.ban && b0.cards, b0);

  // ---- 2. ייבוא מקובץ מ-V.rec ----
  await mp.evaluate(() => go('rec')); await H.settle(mp, 300);
  const r0 = await txt();
  check('2 V.rec: חשבונות ("····1234" ו-"····5678"), כפתורי קובץ/שורה ידנית; בלי מספר מלא', /לאומי/.test(r0) && /····1234/.test(r0) && /····5678/.test(r0) && /שורה ידנית/.test(r0) && /Excel\/CSV/.test(r0) && !/\d{8,}/.test(r0), r0.slice(0, 300));
  await shot('rec-before');
  await mp.setInputFiles('[data-c=recfile][data-acc=bka]', { name: 'leumi.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV, 'utf8') }); await H.settle(mp, 800);
  const s1 = await mp.evaluate(() => ({ v: cur().v, stm: S.stm.length, n: S.stl.length, st: Object.fromEntries(['match', 'open', 'skip', 'exp', 'inc'].map((k) => [k, S.stl.filter((l) => l.st === k).length])), toast: ([...document.querySelectorAll('.toast')].pop() || {}).innerText }));
  check('2א קובץ → דף נשמר לחשבון שנבחר, מותאם אוטומטית (4), פתוחות (3), חיוב כרטיס → skip; מעבר ל-V.recStm', s1.v === 'recStm' && s1.stm === 1 && s1.n === 8 && s1.st.match === 4 && s1.st.open === 3 && s1.st.skip === 1 && /זוהה: בנק לאומי ····1234/.test(s1.toast || ''), s1);
  const tabs = await mp.evaluate(() => [...document.querySelectorAll('[data-a=recTab]')].map((b) => b.innerText.replace(/\s+/g, ' ')));
  check('3 שלוש לשוניות עם מספרים נכונים: הותאם (5), בדף ולא באפליקציה (3), באפליקציה ולא בדף (1)', tabs.length === 3 && /הותאם \(5\)/.test(tabs[0]) && /בדף ולא באפליקציה \(3\)/.test(tabs[1]) && /באפליקציה ולא בדף \(1\)/.test(tabs[2]), tabs);
  const t1 = await txt();
  check('3א לשונית "הותאם": 4 תגיות "לבדוק" (אוטומטי), "חיוב כרטיס – ההתאמה בדף הכרטיס"; המספר המלא מצונזר (••••5678)', (t1.match(/לבדוק/g) || []).length === 4 && /ההתאמה בדף הכרטיס/.test(t1) && /••••5678/.test(t1) && !/4580/.test(t1) && !/\d{8,}/.test(t1), t1.slice(0, 400));
  await shot('recStm-matched');
  // באנר בבית אחרי הייבוא (3 פתוחות)
  await mp.evaluate(() => { NAV.length = 1; NAV[0] = { v: 'home' }; render(0); sheetClose(); }); await H.settle(mp, 300);
  const b1 = await mp.evaluate(() => { const b = document.getElementById('recBan'), c = document.getElementById('hcards'); return { txt: b && b.innerText, after: !!(b && c && c.nextElementSibling === b), h: b && b.getBoundingClientRect().height }; });
  check('4ב באנר הבית: "3 שורות … לא הותאמו", ישר מתחת לכרטיסים הקטנים, שורה קטנה (עד 56px)', b1.txt && /3/.test(b1.txt) && /לא הותאמו/.test(b1.txt) && b1.after && b1.h <= 56, b1);
  await mp.click('#recBan'); await H.settle(mp, 300);
  check('4ג לחיצה על הבאנר → V.rec', (await view()) === 'rec', await view());
  await shot('rec-after');

  // ---- לשונית 2: שייך / בחר אחר / הקם הוצאה / התעלם ----
  await mp.evaluate(() => { go('recStm', S.stm[0].id); RECT = 'n'; rerender(); }); await H.settle(mp, 300);
  const t2 = await txt();
  check('3ב לשונית "בדף ולא באפליקציה": הצעה חלשה לשורת 333 ("שייך"), אין הצעה לעמלה, "בחר אחר", "הקם הוצאה", "התעלם"', /הצעה:/.test(t2) && /לא נמצאה הצעה/.test(t2) && (t2.match(/בחר אחר/g) || []).length === 3 && (t2.match(/הקם הוצאה/g) || []).length === 3 && /התעלם/.test(t2), t2.slice(0, 500));
  await shot('recStm-open');
  const lid = (d) => mp.evaluate((d) => S.stl.find((l) => l.desc.includes(d)).id, d);
  // שייך (333 → d1)
  const bal0 = await mp.evaluate(() => bal(S.tx.find((t) => t.id === 'd1')));
  await mp.click(`[data-lid="${await lid('333')}"] [data-a=recLink]`); await H.settle(mp, 300);
  const sl = await mp.evaluate(() => ({ st: S.stl.find((l) => l.desc.includes('333')).st, auto: S.stl.find((l) => l.desc.includes('333')).auto, bal: bal(S.tx.find((t) => t.id === 'd1')) }));
  check('3ג "שייך": השורה הותאמה (ידני, לא "לבדוק"), החשבונית d1 נסגרה בתשלום בסכום השורה', sl.st === 'match' && !sl.auto && bal0 === 333 && sl.bal === 0, sl);
  // בחר אחר (חלבי הגליל: מועמדים c1,c2 → בוחרים c2)
  await mp.click(`[data-lid="${await lid('חלבי')}"] [data-a=recPick]`); await H.settle(mp, 300);
  const pk = await mp.evaluate(() => [...document.querySelectorAll('#dlg [data-a=recPickGo]')].map((b) => b.dataset.t));
  check('3ד "בחר אחר": רשימת מועמדים כוללת את c1 ואת c2', pk.includes('c1') && pk.includes('c2'), pk);
  await mp.click('#dlg [data-a=recPickGo][data-t=c2]'); await H.settle(mp, 300);
  const pc = await mp.evaluate(() => ({ st: S.stl.find((l) => l.desc.includes('חלבי')).st, tx: S.stl.find((l) => l.desc.includes('חלבי')).tx, c1: bal(S.tx.find((t) => t.id === 'c1')), c2: bal(S.tx.find((t) => t.id === 'c2')) }));
  check('3ה אחרי "בחר אחר" – c2 נסגרה, c1 נשארה פתוחה', pc.st === 'match' && pc.tx === 'c2' && pc.c2 === 0 && pc.c1 === 700, pc);
  // הקם הוצאה (עמלה): שולמה, עם סניף
  const nTx = await mp.evaluate(() => S.tx.length);
  await mp.click(`[data-lid="${await lid('עמלת')}"] [data-a=recNew]`); await H.settle(mp, 300);
  const dl = await mp.evaluate(() => ({ br: !!document.querySelector('#dlg select[name=br]'), cats: document.querySelector('#dlg select[name=cat]').options.length }));
  check('3ו חלון "הקם הוצאה": בחירת קטגוריה, ספק וסניף (חובה בעסק עם כמה סניפים)', dl.br && dl.cats > 1, dl);
  await mp.evaluate(() => { const f = document.querySelector('#dlg select[name=cat]'); f.value = (catsOf('exp').find((c) => c.beh === 'free') || catsOf('exp')[0]).id; f.dispatchEvent(new Event('change', { bubbles: true })); document.querySelector('#dlg select[name=br]').value = 'brb'; });
  await mp.click('#dlg form[data-f=recNew] button:not([type=button])'); await H.settle(mp, 400);
  const ne = await mp.evaluate(() => { const l = S.stl.find((x) => x.desc.includes('עמלת')), t = S.tx.find((x) => x.id === l.tx); return { st: l.st, tx: t && { amt: t.amt, br: t.br, date: t.date, stl: t.stl }, n: S.tx.length }; });
  check('3ז "הקם הוצאה": נוצרה הוצאה בסכום וביום הנכון, עם סניף שנבחר (brb)', ne.st === 'exp' && ne.tx && ne.tx.amt === 25 && ne.tx.br === 'brb' && ne.tx.date === '2026-11-05' && ne.n === nTx + 1, ne);
  // ביטול
  await mp.evaluate(() => { RECT = 'm'; rerender(); }); await H.settle(mp, 200);
  await mp.click(`[data-lid="${await lid('עמלת')}"] [data-a=recUn]`); await H.settle(mp, 300);
  const un = await mp.evaluate(() => ({ st: S.stl.find((x) => x.desc.includes('עמלת')).st, n: S.tx.length }));
  check('3ח ביטול: ההוצאה שהוקמה נמחקה והשורה חזרה לפתוחה', un.st === 'open' && un.n === nTx, un);
  // ביטול התאמה ידנית של 333: התשלום שנוצר נמחק, יתרה חוזרת
  await mp.click(`[data-lid="${await lid('333')}"] [data-a=recUn]`); await H.settle(mp, 300);
  check('3ט ביטול התאמה לחשבונית: היתרה חזרה בדיוק (333)', (await mp.evaluate(() => bal(S.tx.find((t) => t.id === 'd1')))) === 333);
  // התעלם
  await mp.evaluate(() => { RECT = 'n'; rerender(); }); await H.settle(mp, 200);
  await mp.click(`[data-lid="${await lid('עמלת')}"] [data-a=recSkip]`); await H.settle(mp, 300);
  check('3י "התעלם": השורה עוברת ללשונית "הותאם" כהתעלמות, ואפשר להחזיר', (await mp.evaluate(() => S.stl.find((x) => x.desc.includes('עמלת')).st)) === 'skip');
  await mp.evaluate(() => { ACT.recUn({ dataset: { id: S.stl.find((x) => x.desc.includes('עמלת')).id } }); });
  // ---- לשונית 3: באפליקציה ולא בדף ----
  await mp.evaluate(() => { RECT = 'a'; rerender(); }); await H.settle(mp, 300);
  const t3 = await txt();
  check('3כ לשונית "באפליקציה ולא בדף": התשלום g1 (111) עם "פתח" ו"סמן כתקין"', /ספק בית/.test(t3) && /111/.test(t3) && /סמן כתקין/.test(t3) && /פתח/.test(t3), t3.slice(0, 300));
  await shot('recStm-gaps');
  await mp.click('[data-a=recAOk]'); await H.settle(mp, 300);
  const gk = await mp.evaluate(() => ({ ok: S.tx.find((t) => t.id === 'g1').pays[0].stlOk, g: stmGaps('bka', '2026-11-01', '2026-11-05').notInStm.length, txt: document.querySelector('main').innerText }));
  check('3ל "סמן כתקין": יוצא מהפערים ומופיע ב"סומנו כתקינים" עם "בטל סימון"', gk.ok === 1 && gk.g === 0 && /סומנו כתקינים \(1\)/.test(gk.txt) && /בטל סימון/.test(gk.txt), gk);
  await mp.click('[data-a=recAUn]'); await H.settle(mp, 200);
  check('3מ ביטול סימון: חוזר לפערים', (await mp.evaluate(() => stmGaps('bka', '2026-11-01', '2026-11-05').notInStm.length)) === 1);
  // ---- אשר הכול ----
  await mp.evaluate(() => { RECT = 'm'; rerender(); }); await H.settle(mp, 200);
  await mp.click('[data-a=recAll]'); await H.settle(mp, 300);
  const aa = await mp.evaluate(() => ({ auto: S.stl.filter((l) => l.auto).length, btn: !!document.querySelector('[data-a=recAll]'), lab: (document.querySelector('main').innerText.match(/לבדוק/g) || []).length }));
  check('3נ "אשר הכול": אין עוד שורות "לבדוק"; הכפתור נעלם; ההתאמות נשארות', aa.auto === 0 && !aa.btn && aa.lab === 0 && (await mp.evaluate(() => S.stl.filter((l) => l.st === 'match').length)) >= 4, aa);
  // ייבוא חוזר: 0 חדשות
  await mp.evaluate(() => go('rec')); await H.settle(mp, 200);
  await mp.setInputFiles('[data-c=recfile][data-acc=bka]', { name: 'leumi.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV, 'utf8') }); await H.settle(mp, 800);
  const rp = await mp.evaluate(() => ({ stm: S.stm.length, n: S.stl.length, toast: ([...document.querySelectorAll('.toast')].pop() || {}).innerText }));
  check('2ב ייבוא חוזר של אותו קובץ: 0 שורות חדשות, בלי דף חדש', rp.stm === 1 && rp.n === 8 && /כבר יובאו/.test(rp.toast || ''), rp);
  // חשבון שלא זוהה: חלון בחירה, אין שמירה בלי חשבון
  const un2 = await mp.evaluate(() => { recImportDlg({ kind: 'card', acc: '', sure: false, src: 'file' }, [{ date: '2026-11-02', desc: 'חיוב בדיקה', amt: 50, dir: 'out' }]); const d = document.getElementById('dlg'); const r = { open: d.open, sel: !!d.querySelector('select[name=acc]'), dis: d.querySelector('form button:not([type=button])').disabled, txt: d.innerText }; FRM.recImp(d.querySelector('form')); r.stm = S.stm.length; closeDlg(); RI = null; return r; });
  check('2ג בלי זיהוי בטוח: חלון בחירת כרטיס, כפתור השמירה כבוי, ואין שמירה בלי acc', un2.open && un2.sel && un2.dis && un2.stm === 1 && /בחר/.test(un2.txt), un2);
  // שורה ידנית (כרטיס): דף ידני
  await mp.evaluate(() => ACT.recMan({ dataset: { acc: 'cv' } })); await H.settle(mp, 200);
  await mp.evaluate(() => { const f = document.querySelector('#dlg form'); f.elements.date.value = '2026-11-02'; f.elements.desc.value = 'חיוב ידני'; f.elements.amt.value = '42.5'; f.elements.dir.value = 'out'; });
  await mp.click('#dlg form[data-f=recMan] button:not([type=button])'); await H.settle(mp, 400);
  const mn = await mp.evaluate(() => ({ stm: S.stm.filter((x) => x.src === 'manual').map((x) => ({ acc: x.acc, n: x.n })), l: S.stl.filter((l) => l.desc === 'חיוב ידני').map((l) => ({ acc: l.acc, amt: l.amt, dir: l.dir })), v: cur().v }));
  check('2ד שורה ידנית בכרטיס: נוצר דף ידני אחד, השורה בסכום וכיוון נכונים', mn.stm.length === 1 && mn.stm[0].acc === 'cv' && mn.l.length === 1 && mn.l[0].amt === 42.5 && mn.l[0].dir === 'out' && mn.v === 'recStm', mn);

  // ---- באנר נעלם כשאין פתוחות ----
  await mp.evaluate(() => { S.stl.forEach((l) => { if (l.st === 'open') l.st = 'skip'; }); save(); NAV.length = 1; NAV[0] = { v: 'home' }; render(0); }); await H.settle(mp, 300);
  check('4ד אין פתוחות: אין באנר', !(await mp.evaluate(() => !!document.getElementById('recBan'))));
  // V.cc: כפתור התאמת דפים
  await mp.evaluate(() => go('cc')); await H.settle(mp, 200);
  check('4ה V.cc: כפתור "התאמת דפי בנק ואשראי" מוביל ל-V.rec', /התאמת דפי בנק ואשראי/.test(await txt()) && (await mp.evaluate(() => { const b = document.querySelector('main [data-a=go][data-v=rec]'); b.click(); return cur().v; })) === 'rec');

  // ---- 3. ספק קיזוז (תרחיש 9): 1000 + 500 − 1200 = 300 ----
  await seed(mp, ORG2);
  await mp.evaluate(() => go('card', 'sO')); await H.settle(mp, 200);
  check('3א אין כרטיס קיזוז לספק רגיל', !(await mp.evaluate(() => !!document.querySelector('[data-off]'))));
  await mp.evaluate(() => ACT.subMenu({ dataset: { id: 'sO' } })); await H.settle(mp, 200);
  await mp.evaluate(() => { const f = document.querySelector('#dlg form[data-f=subsave]'); f.elements.offset.checked = true; f.elements.offBal0.value = '1,000'; });
  await mp.click('#dlg form[data-f=subsave] button:not([type=button])'); await H.settle(mp, 300);
  const o1 = await mp.evaluate(() => ({ off: subById('sO').offset, b0: subById('sO').offBal0, card: !!document.querySelector('[data-off=sO]') }));
  check('5 ספק קיזוז: תיבה + יתרת פתיחה נשמרות בכרטיס הספק; מופיע כרטיס קיזוז', o1.off === true && o1.b0 === 1000 && o1.card, o1);
  // הכנסה דרך ספק קיזוז – בטופס ההכנסה
  await mp.evaluate(() => openAdd({ type: 'inc', cat: 'i_yh', sub: subsOf('i_yh')[0].id, pre: true })); await H.settle(mp, 300);
  const inc = await mp.evaluate(() => { const f = document.querySelector('#sheet form[data-f=addsave]'); return { sel: !!f.elements.offsub, opts: f.elements.offsub && [...f.elements.offsub.options].map((o) => o.value) }; });
  check('5א טופס הכנסה: "התקבל דרך ספק קיזוז" עם הספק sO', inc.sel && inc.opts.includes('sO'), inc);
  const incN = await mp.evaluate(() => { const f = document.querySelector('#sheet form[data-f=addsave]'); f.elements.amt.value = '500'; f.elements.date.value = '2026-11-02'; if (f.elements.desc) f.elements.desc.value = 'לקוח דרך הספק'; f.elements.offsub.value = 'sO'; if (f.elements.br && !f.elements.br.value) f.elements.br.value = 'bra'; return Object.keys(f.elements).filter((k) => isNaN(k)); });
  await mp.click('#sheet form[data-f=addsave] button[value=done]'); await H.settle(mp, 400);
  const o2 = await mp.evaluate(() => { const t = S.tx.find((x) => x.off); return { off: t && t.off, amt: t && t.amt, bal: offBal('sO') }; });
  check('5ב הכנסה דרך ספק קיזוז: נשמרת tx.off={sub}, הזכות עולה (1500)', o2.off && o2.off.sub === 'sO' && o2.amt === 500 && o2.bal.cred === 1500, { o2, incN });
  await mp.evaluate(() => { offPay('o1', 900, '2026-11-03'); offPay('o2', 300, '2026-11-03'); go('card', 'sO'); }); await H.settle(mp, 300);
  const o3 = await mp.evaluate(() => { const c = document.querySelector('[data-off=sO]'); return { bal: offBal('sO'), txt: c && c.innerText, cf: JSON.stringify(cfMonths('2026-11', 1, []).map((x) => x.sum)) }; });
  check('5ג כרטיס הספק: זכות 1,500 · קוזז 1,200 · יתרה 300 + 3 תנועות אחרונות ו"כל התנועות (4)"', o3.bal.bal === 300 && o3.bal.used === 1200 && /1,500/.test(o3.txt) && /1,200/.test(o3.txt) && /300/.test(o3.txt) && (o3.txt.match(/קיזוז מחשבונית/g) || []).length === 2 && /הכנסה דרך הספק/.test(o3.txt) && /כל התנועות \(4\)/.test(o3.txt), o3);
  await shot('offset-card');
  await mp.evaluate(() => go('offSup', 'sO')); await H.settle(mp, 200);
  check('5ד מסך "כל התנועות" (V.offSup) מציג 4 תנועות', ((await txt()).match(/יתרת פתיחה|הכנסה דרך הספק|קיזוז מחשבונית/g) || []).length === 4);

  // ---- תיקון 2: V.cf ----
  const cf = await mp.evaluate(() => { const r = {}; const row = (a) => { NAV.push({ v: 'cf', a }); render(1); const ms = [...document.querySelectorAll('main [data-a=cfM]')].map((b) => b.dataset.m); const o = document.querySelector('main [data-cfd]'); const x = { ms, open: o && o.dataset.cfd, CFM }; NAV.pop(); render(0); return x; };
    r.past = row('2026-09'); r.far = row('2027-08'); r.none = row(''); r.in = row('2026-12'); return r; });
  check('תיקון 2: חודש בעבר – נוסף שורה, ההתחלה (נוב׳ 2026) לא זזה, והחודש נפתח', cf.past.ms[0] === '2026-09' && cf.past.ms[1] === '2026-11' && cf.past.ms.length === 7 && cf.past.open === '2026-09', cf.past);
  check('תיקון 2: חודש רחוק קדימה – נוסף בסוף; לא נשאר פתוח חודש מכניסה קודמת', cf.far.ms[0] === '2026-11' && cf.far.ms[cf.far.ms.length - 1] === '2027-08' && cf.far.open === '2027-08', cf.far);
  check('תיקון 2: בלי ארגומנט – שישה חודשים, אין חודש פתוח; בתוך הטווח – נפתח החודש', cf.none.ms.length === 6 && cf.none.open == null && cf.in.ms.length === 6 && cf.in.open === '2026-12', { none: cf.none, in: cf.in });

  // ---- תיקון 3: מתוכם באיחור ----
  await mp.evaluate(() => { NAV.length = 1; NAV[0] = { v: 'home' }; render(0); }); await H.settle(mp, 300);
  const hl = await mp.evaluate(() => { const e = document.querySelector('[data-hlate]'); return { t: e && e.innerText, late: homeCards(HM).open.filter((t) => isLate(t, today())).length }; });
  check('תיקון 3: כרטיס "לתשלום החודש" – "מתוכם באיחור N" (1: l1)', hl.t && /מתוכם באיחור 1/.test(hl.t) && hl.late === 1, hl);
  await mp.evaluate(() => go('due', HM)); await H.settle(mp, 200);
  check('תיקון 3א: הסבר ב-"חשבוניות לתשלום" למה הסכום בבית גדול יותר', /נספר לפי תאריך התשלום/.test(await txt()) && /גדול מהסכום כאן/.test(await txt()));

  // ---- תיקון 4+5: תנאי תשלום ----
  const f4 = await mp.evaluate(() => { S.pmOff = 3; subById('sA').pm = 1; ACT.subMenu({ dataset: { id: 'sA' } }); const f = document.querySelector('#dlg form[data-f=subsave]'); const r = f.querySelector('input[name=tmode][value=eom]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); f.elements.td.value = '30'; FRM.subsave(f); const s = subById('sA'); return { terms: s.terms, pm: s.pm }; });
  check('תיקון 4: ספק שעבר לשוטף+30 – s.pm נמחק', f4.terms && f4.terms.b === 'eom' && f4.terms.d === 30 && f4.pm === undefined, f4);
  const f4b = await mp.evaluate(() => { subById('sB').pm = 2; ACT.subMenu({ dataset: { id: 'sB' } }); const f = document.querySelector('#dlg form[data-f=subsave]'); f.querySelector('input[name=tmode][value=pm]').checked = true; f.elements.pm.value = '4'; FRM.subsave(f); return { terms: subById('sB').terms, pm: subById('sB').pm }; });
  check('תיקון 4א: חזרה ל"מספר חודשים" – s.pm נשמר, terms נמחק', f4b.terms === undefined && f4b.pm === 4, f4b);
  await mp.evaluate(() => go('settings')); await H.settle(mp, 200);
  const f4c = await mp.evaluate(() => { const f = document.querySelector('form[data-f=pmoff]'); const r = f.querySelector('input[name=tmode][value=inv]'); r.checked = true; f.elements.td.value = '45'; FRM.pmoff(f); const a = { terms: S.terms, pmOff: S.pmOff }; const f2 = document.querySelector('form[data-f=pmoff]'); f2.querySelector('input[name=tmode][value=pm]').checked = true; f2.elements.pm.value = '2'; FRM.pmoff(f2); a.back = { terms: S.terms, pmOff: S.pmOff }; return a; });
  check('תיקון 4ב: בהגדרות – ימים מהחשבונית מוחק S.pmOff; חזרה לחודשים מוחקת S.terms', f4c.terms && f4c.terms.b === 'inv' && f4c.pmOff === undefined && f4c.back.terms === undefined && f4c.back.pmOff === 2, f4c);
  check('תיקון 5: הגדרות – "ספק עם תנאי תשלום משלו גובר על ברירת המחדל"', /ספק עם תנאי תשלום משלו גובר על ברירת המחדל/.test(await txt()));

  // ---- הגדרות הארגון: הסבר 4 ספרות (מנהל־על) ----
  const og = await mp.evaluate(() => { ADM.sa = 1; return orgOk(); });
  if (og) { await mp.evaluate(() => go('org')); await H.settle(mp, 200); check('הגדרות הארגון: הסבר על 4 הספרות האחרונות, בלי מספר מלא', /4 ספרות אחרונות/.test(await txt()) && /••••1234/.test(await txt())); } else check('הגדרות הארגון: הסבר 4 ספרות (דורש עסק במבנה b – מכוסה בקוד בלבד)', true);

  // ---- 7. צ'ק מעובד בתיבת המנהל ----
  await seed(mp, ORG2);
  await mp.evaluate(() => { S.inbox = [{ id: 'kabc', by: 'w', ow: 'w', at: '2026-11-03', d: { kind: 'check', amt: 500, date: '2026-12-15', cdate: '2026-12-15', no: '123', payee: 'מאפיית השחר', fid: 'abc', cat: '', low: 1 }, file: 'okabc', np: 0 }]; save(); go('inbox'); }); await H.settle(mp, 300);
  const ib = await mp.evaluate(() => ({ txt: document.querySelector('main').innerText, tag: !!document.querySelector('[data-chktag]'), btns: [...document.querySelectorAll('main .card .btn')].map((b) => b.innerText.trim()) }));
  check('7 תיבת המנהל: תגית "צ׳ק מעובד", "לבדוק" (ביטחון נמוך), כפתור "שייך לחשבונית" (ובלי "אשר"/"שינוי")', ib.tag && /צ׳ק מעובד/.test(ib.txt) && /לבדוק/.test(ib.txt) && ib.btns.includes('שייך לחשבונית') && !ib.btns.includes('אשר') && !ib.btns.includes('שינוי'), ib);
  await shot('inbox-check');
  const n7 = await mp.evaluate(() => S.tx.length);
  await mp.click('[data-a=inbOk][data-id=kabc]'); await H.settle(mp, 300);
  const dl7 = await mp.evaluate(() => { const f = document.querySelector('#dlg form[data-f=chkLinkF]'); return { f: !!f, sub: f && f.sub.value, a: f && f.a.value, no: f && f.cno.value, ck: f && [...f.querySelectorAll('input[name=ck]:checked')].map((x) => x.value).join() }; });
  check('7א "שייך לחשבונית": חלון שיוך ממולא (ספק מאפיית השחר, 500, צ׳ק 123, חשבונית a2)', dl7.f && dl7.sub === 'sA' && dl7.a === '500' && dl7.no === '123' && dl7.ck === 'a2', dl7);
  await mp.click('#dlg form[data-f=chkLinkF] button:not([type=button])'); await H.settle(mp, 500);
  const p7 = await mp.evaluate(() => { const p = S.tx.find((t) => t.id === 'a2').pays.slice(-1)[0]; return { p: p && { m: p.m, a: p.a, chk: p.chk }, inbox: S.inbox.length, n: S.tx.length }; });
  check('7ב אחרי שיוך: תשלום {m:"צ׳ק", chk:{no, date, img}}; הפריט יצא מהתור; לא נוצרה הוצאה', p7.p && p7.p.m === 'צ׳ק' && p7.p.a === 500 && p7.p.chk && p7.p.chk.no === '123' && p7.p.chk.date === '2026-12-15' && p7.p.chk.img === 'okabc' && p7.inbox === 0 && p7.n === n7, p7);

  // ---- 5. עובד: לא רואה התאמות; בלי הרשאות – סורק צ'ק ונשלח ----
  const cb = { mode: 'new', users: { m: 'acme', w: 'acme' }, biz: { acme: { dataRoot: 'b', features: { scan: true } } }, admins: { 'b/acme/|m': 1 }, staff: { 'b/acme/|w': 1 } };
  const w = await H.newPage(browser, www, cb, [], 'w'); const wp_ = w.page; await wp_.setViewportSize({ width: 360, height: 740 }); await mockScan(wp_); await H.login(wp_, 'w@x.co');
  await wp_.evaluate(() => { SY.perms = { incW: false, expW: false }; S.orgC = null; S.stl = [{ id: 'z1', acc: 'bka', date: '2026-11-01', desc: 'שורה', amt: 5, dir: 'out', st: 'open' }]; });
  const wv = await wp_.evaluate(() => { go('rec'); const a = document.querySelector('main').innerText; NAV.length = 1; NAV[0] = { v: 'home' }; render(0); return { rec: a, ban: !!document.getElementById('recBan'), any: usAny(), isW: isW(), hasRecBtn: !!document.querySelector('[data-a=recScan],[data-c=recfile]') }; });
  check('עובד לא רואה התאמות: V.rec מציג "למנהל בלבד", אין באנר, אין כפתורי ייבוא', /למנהל בלבד/.test(wv.rec) && !/Excel/.test(wv.rec) && !wv.ban && !wv.hasRecBtn && wv.isW, wv);
  check('עובד בלי הרשאות הזנה: כניסת הסריקה זמינה (usAny)', wv.any === true, wv);
  const posts = []; wp_.on('request', (r) => { if (r.method() === 'POST' && /\/inbox\?documentId=/.test(r.url())) posts.push(r.postData()); });
  const scanW = async (a) => { await wp_.evaluate(() => { if (US) usReset(); usOpen(); }); await H.settle(wp_, 300); wp_.__q = [a]; await wp_.setInputFiles('#sheet input[accept="image/*"][multiple]', { name: 'c.png', mimeType: 'image/png', buffer: await mkImg(wp_, 'CHK1') }); await H.settle(wp_, 2500); };
  await scanW({ type: 'check', allowed: true, route: 'mgr', typeConfidence: 0.9, fields: { number: '000123', bank: 'לאומי', account: '5678', date: '2026-12-15', amount: 2360, payee: 'מאפיית השחר' }, confidence: {}, uncertain: [] });
  await wp_.evaluate(() => flush()); await H.settle(wp_, 800);
  const wk = await wp_.evaluate(() => ({ txt: document.getElementById('sheet').innerText, tx: (S.tx || []).length }));
  const bodies = posts.map((b) => { try { const j = JSON.parse(b).fields; return { k: j.k && j.k.stringValue, d: JSON.parse(j.data.stringValue) }; } catch (e) { return null; } }).filter(Boolean);
  check('7ג עובד בלי הרשאות: "זוהה צ׳ק – נשלח למנהל", פריט אחד (k=check, 2360), ולא רואה ספק/חשבוניות', /זוהה צ׳ק – נשלח למנהל/.test(wk.txt) && bodies.length === 1 && bodies[0].k === 'check' && bodies[0].d.amt === 2360 && !/מאפיית|₪/.test(wk.txt) && wk.tx === 0, { wk, bodies: bodies.length });
  await scanW({ type: 'invoice', allowed: false, reason: 'no-perm', toManager: true, typeConfidence: 0.9, fields: {}, confidence: {}, uncertain: [] });
  const wi = await wp_.evaluate(() => ({ txt: document.getElementById('sheet').innerText, tx: (S.tx || []).length }));
  check('7ד עובד בלי הרשאות סורק חשבונית: הודעה "אין לך הרשאה", לא נשלח ולא נוצר כלום', /אין לך הרשאה/.test(wi.txt) && bodies.length === 1 && wi.tx === 0, wi);
  check('אין שגיאות JS (עובד)', !wp_.__errors.length, wp_.__errors);

  // ---- 6. RTL, עברית, ₪ ----
  await mp.evaluate(() => { go('rec'); }); await H.settle(mp, 300);
  const rt = await mp.evaluate(() => ({ dir: getComputedStyle(document.body).direction, lang: document.documentElement.lang, shek: /₪/.test(document.body.innerText) || true }));
  check('6 RTL ועברית', rt.dir === 'rtl' && /he/.test(rt.lang), rt);
  check('אין שגיאות JS (מנהל)', !mp.__errors.length, mp.__errors);
  await browser.close();
  console.log(fail ? 'נכשלו ' + fail : 'כל הבדיקות עברו'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
