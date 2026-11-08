'use strict';
// התאמות – חלק ג', ליבה (C1): גיבוי ישן זהה, צנזור מספרים, זיהוי חשבון לפי 4 ספרות, ייבוא CSV/XLSX, כפולים, stlAuto, stlLink/Unlink,
// stmGaps, ספק קיזוז, תיקונים 1+6, statement חסום לעובד, צ'ק שעובד סורק → תור המנהל (גם בלי חיבור). רשת מדומה, זמן קבוע 3.11.2026.
// שימוש: NODE_PATH=... node ui-rec1.js <www-dir>
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
  mk('o1', 'sO', '2026-10-09', 900, '2026-11');
  S.tx.push({ id: 'i1', t: 'inc', cat: 'i_yh', sub: null, date: '2026-11-01', amt: 2500, note: 'קופה' });
  save();
}, org || null);
const CSV_BANK = '﻿תאריך,תיאור פעולה,אסמכתא,חובה,זכות,יתרה\n' +
  '01/11/2026,"העברה מאפיית השחר בע""מ",111,500.00,,10000\n' +   // a2 – חשבונית פתוחה + שם ספק → אוטומטי
  '01/11/2026,העברה ספק בית,112,800.00,,9200\n' +              // pb1 – תשלום קיים → אוטומטי
  '04/11/2026,צ\'ק 7,113,260.00,,8940\n' +                     // pb4 – צ'ק לפי פירעון → אוטומטי
  '02/11/2026,העברה חלבי הגליל,114,700.00,,8240\n' +           // c1/c2 – דו-משמעי → פתוחה
  '01/11/2026,הפקדה קופה,115,,2500.00,10740\n' +               // i1 – הכנסה → אוטומטי
  '03/11/2026,ויזה עסקי חיוב חודשי 4580123412345678,116,1200.00,,9540\n' + // חיוב כרטיס → skip, מספר מצונזר
  '05/11/2026,עמלת ניהול חשבון,117,25.00,,9515\n';              // לא באפליקציה → פתוחה
(async () => {
  const [www] = process.argv.slice(2); const browser = await H.launch();
  const cfg = { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: ALL } }, admins: { '|m': 1 }, staff: { '|w': 1 } };
  const m = await H.newPage(browser, www, cfg, [], 'm'); const mp = m.page; await mp.setViewportSize({ width: 360, height: 740 }); await mockScan(mp); await H.login(mp, 'm@x.co');
  await seed(mp);

  // ---- 2. גיבוי ישן: ensure(save(load())) – tx/subs/ccx זהים; מספרי בית ותזרים זהים ----
  const t2 = await mp.evaluate(() => { const k = () => JSON.stringify({ tx: S.tx, subs: S.subs, ccx: S.ccx }); const b = k(), h0 = JSON.stringify(homeCards('2026-11')), c0 = JSON.stringify(cfMonths('2026-11', 3, []).map((x) => x.sum));
    save(); load(); S = ensure(JSON.parse(JSON.stringify(S))); return { same: b === k(), home: h0 === JSON.stringify(homeCards('2026-11')), cf: c0 === JSON.stringify(cfMonths('2026-11', 3, []).map((x) => x.sum)), noNew: S.tx.every((t) => !('off' in t) && !('stl' in t)) }; });
  check('2 גיבוי ישן: tx/subs/ccx זהים אחרי ensure(save(load())); בית ותזרים זהים', t2.same && t2.home && t2.cf && t2.noNew, t2);
  const t2b = await mp.evaluate(() => { const b = JSON.parse(JSON.stringify(S)); b.stl = [{ id: 'x', st: 'zz', desc: 'כרטיס 4580 1234 1234 5678' }, 5]; b.stm = 'bad'; b.subs[0].offset = 'yes'; b.tx[0].off = 3; const c = ensure(b); return { st: c.stl[0].st, n: c.stl.length, desc: c.stl[0].desc, stm: c.stm === undefined, off: 'offset' in c.subs[0], toff: 'off' in c.tx[0] }; });
  check('2א ensure מנקה רק ערכים פגומים ומצנזר מספר מלא בשורה ישנה', t2b.st === 'open' && t2b.n === 1 && t2b.desc === 'כרטיס ••••5678' && t2b.stm && !t2b.off && !t2b.toff, t2b);

  // ---- 3. צנזור ----
  const t3 = await mp.evaluate(() => ({ a: stlScrub('4580123412341234'), b: stlScrub('כרטיס 4580-1234-1234-1234 חיוב'), c: stlScrub('חשבון 12-345-678901'), d: stlScrub('סכום 1,234.50 ביום 2026-11-03'), e: stlScrub('אסמכתא 1234567') }));
  check('3 stlScrub: 16 ספרות → ••••1234; עם מקפים/רווחים; תאריך, סכום ו-7 ספרות לא משתנים', t3.a === '••••1234' && t3.b === 'כרטיס ••••1234 חיוב' && t3.c === 'חשבון ••••8901' && t3.d === 'סכום 1,234.50 ביום 2026-11-03' && t3.e === 'אסמכתא 1234567', t3);

  // ---- 3ב. צנזור: כל העקיפות (נקודות, לוכסנים, רווחים כפולים, " - ", nbsp, U+200E, 20+ ספרות) – בלקוח ----
  const tScrA = await mp.evaluate(() => { const N = '4580', cases = ['4580.1234.1234.1234', '4580/1234/1234/1234', '4580  1234  1234  1234', '4580 - 1234 - 1234 - 1234', '4580 1234 1234 1234', '4580‎1234‎1234‎1234', '4580‪ 1234‬ 1234 1234', '458012341234123456789012', '4580_1234_1234_1234', 'כרטיס 4580.1234 .1234-1234 חיוב', '4580 – 1234 — 1234\u200b1234', '4580\u200d1234\u2066 1234\u2069 1234'];
    return { out: cases.map((c) => stlScrub(c)), keep: [stlScrub('15.01.2024'), stlScrub('15/01/2024 ביום'), stlScrub('2026-11-03'), stlScrub('סכום 1,234.50'), stlScrub('אסמכתא 1234567'), stlScrub('15/01/2024 10:30'), stlScrub('01/11/2026-30/11/2026'), stlScrub('01/11/2026 – 30/11/2026'), stlScrub('חיוב 4580/1234/1234/1234 ב-15/01/2024 10:30')] }; });
  check('3ב צנזור בלקוח: כל העקיפות → ••••+4 אחרונות, בלי אף ספרה מהמספר המלא', tScrA.out.every((o) => /^(כרטיס )?••••\d{4}( חיוב)?$/.test(o) && !/4580/.test(o)) && tScrA.out[7] === '••••9012', tScrA);
  check('3ג צנזור: תאריכים, סכומים ומספר של 7 ספרות לא משתנים', tScrA.keep[0] === '15.01.2024' && tScrA.keep[1] === '15/01/2024 ביום' && tScrA.keep[2] === '2026-11-03' && tScrA.keep[3] === 'סכום 1,234.50' && tScrA.keep[4] === 'אסמכתא 1234567' && tScrA.keep[5] === '15/01/2024 10:30' && tScrA.keep[6] === '01/11/2026-30/11/2026' && tScrA.keep[7] === '01/11/2026 – 30/11/2026' && tScrA.keep[8] === 'חיוב ••••1234 ב-15/01/2024 10:30', tScrA.keep);
  const tScrB = await mp.evaluate((ORG) => { S.orgC = ORG; S.stl = []; S.stm = []; const r = stmParse([['תאריך', 'תיאור', 'סכום'], ['01/11/2026', 'חיוב 4580.1234.1234.9876 בית עסק', '-50']], 'bank'); stmAdd({ kind: 'bank', acc: 'bka', src: 'manual' }, r.ok); return { desc: S.stl.map((l) => l.desc), big: /4580|1234\D*1234/.test(JSON.stringify(S.stl)) }; }, ORG);
  check('3ד ייבוא שורה עם מספר כרטיס בנקודות: נשמר ••••9876 בלבד', tScrB.desc.length === 1 && /••••9876/.test(tScrB.desc[0]) && !tScrB.big, tScrB);

  // ---- 4. זיהוי חשבון לפי 4 ספרות ----
  await seed(mp, ORG);
  const t4 = await mp.evaluate((ORG) => { const r = { c: stmAcc('card', 'כרטיס ····5678'), b: stmAcc('bank', 'חשבון 12-345-1234 לאומי'), none: stmAcc('card', 'בלי מספר'), x: stmAcc('bank', '0000') };
    const o2 = JSON.parse(JSON.stringify(ORG)); o2.cards.forEach((c) => { delete c.last4; }); S.orgC = o2; r.nol4 = stmAcc('card', '····5678'); o2.cards = [o2.cards[0]]; S.orgC = o2; r.one = stmAcc('card', 'כלום'); S.orgC = ORG; return r; }, ORG);
  check('4 "····5678" → כרטיס cv (בטוח); "1234" → בנק bka', t4.c.id === 'cv' && t4.c.sure && t4.b.id === 'bka' && t4.b.sure, t4);
  check('4א שני כרטיסים בלי 4 ספרות – אין שיוך; בלי מספר – אין; כרטיס יחיד – הצעה לא בטוחה', !t4.nol4.id && !t4.none.id && !t4.x.id && t4.one.id === 'cv' && !t4.one.sure, t4);

  // ---- 5+6. ייבוא CSV עברי חובה/זכות, stlAuto, חיוב כרטיס → skip, כפולים ----
  const imp = (csv, name, kind) => mp.evaluate(async ([csv, name, kind]) => { const f = new File([csv], name, { type: 'text/csv' }); const r = await stmFile(f, kind); return { n: r.lines.length, bad: r.bad, acc: r.acc, lines: r.lines }; }, [csv, name, kind]);
  const p1 = await imp(CSV_BANK, 'leumi-1234.csv', 'bank');
  check('5 CSV חובה/זכות: 7 שורות, כיוון וסכום; זיהוי חשבון מהשם (1234)', p1.n === 7 && p1.bad === 0 && p1.acc.id === 'bka' && p1.acc.sure && p1.lines[0].dir === 'out' && p1.lines[0].amt === 500 && p1.lines[4].dir === 'in' && p1.lines[0].ref === '111', p1.lines.slice(0, 2));
  const t5 = await mp.evaluate((lines) => { const st = stmAdd({ kind: 'bank', acc: 'bka', src: 'file' }, lines); const r = stlAuto(st.id); const L = S.stl.filter((l) => l.stm === st.id);
    const by = (d) => L.find((l) => l.desc.includes(d)); const a2 = S.tx.find((t) => t.id === 'a2');
    return { r, n: st.n, from: st.from, to: st.to, a2: by('מאפיית'), a2bal: bal(a2), a2pay: a2.pays[0], pb1: by('ספק בית'), chk: by('צ\'ק 7'), milk: by('חלבי'), inc: by('הפקדה'), cc: by('ויזה'), fee: by('עמלת'), wrong: L.filter((l) => l.st === 'match' && l.auto).length };
  }, p1.lines);
  check('5א stlAuto: 4 אוטומטיות (חשבונית, תשלום קיים, צ׳ק לפי פירעון, הכנסה); הדו-משמעית + העמלה פתוחות', t5.r.match === 4 && t5.r.open === 2 && t5.a2.st === 'match' && t5.a2.auto && t5.pb1.st === 'match' && t5.pb1.pay === 'pb1' && t5.chk.st === 'match' && t5.inc.st === 'match' && t5.milk.st === 'open' && t5.fee.st === 'open', t5);
  check('5ב חשבונית a2 נסגרה בתשלום חדש (auto, stl, bank)', t5.a2bal === 0 && t5.a2pay && t5.a2pay.auto === 1 && t5.a2pay.stl === t5.a2.id && t5.a2pay.bank === 'bka' && t5.a2pay.m === 'העברה', t5.a2pay);
  check('5ג חיוב כרטיס בדף הבנק → skip ("ההתאמה בדף הכרטיס"); המספר המלא מצונזר', t5.cc.st === 'skip' && t5.cc.why === 'cc' && /••••5678/.test(t5.cc.desc) && !/4580/.test(t5.cc.desc), t5.cc);
  const t5d = await mp.evaluate(() => { const C = stlCands(S.stl.find((l) => l.desc.includes('חלבי'))); return C.filter((c) => c.s >= 5).map((c) => c.t.id); });
  check('5ד הדו-משמעית: שני מועמדים חזקים (c1, c2) – לא הותאמה, 0 שגויות', t5d.length === 2 && t5.wrong === 4, t5d);
  const t3b = await mp.evaluate(() => { const j = JSON.stringify(S); return { long: (j.match(/\d{8,}/g) || []).filter((x) => !/^\d{10,13}$/.test(x) || true).filter((x) => x.length >= 8 && !/^1[78]\d{11}$/.test(x)), has: j.includes('4580123412345678') }; });
  check('3א אחרי ייבוא עם מספר מלא: אין ב-JSON.stringify(S) רצף 8+ ספרות', !t3b.has && t3b.long.length === 0, t3b);
  const t6 = await mp.evaluate((lines) => { const n0 = S.stl.length; const st = stmAdd({ kind: 'bank', acc: 'bka', src: 'file' }, lines); return { add: S.stl.length - n0, dup: st.dup, stm: S.stm.length }; }, p1.lines);
  check('6 ייבוא חוזר: 0 שורות נוספו, 7 כפולות, לא נוצר דף', t6.add === 0 && t6.dup === 7 && t6.stm === 1, t6);
  const t6b = await mp.evaluate((lines) => { const n0 = S.stl.length; const r = stmAdd({ kind: 'bank', acc: '', src: 'file' }, lines); const r2 = stmAdd({ kind: 'card', acc: 'bka' }, lines); return { r, r2, add: S.stl.length - n0 }; }, p1.lines);
  check('6א בלי acc / acc מסוג אחר – לא נשמר', t6b.r === null && t6b.r2 === null && t6b.add === 0, t6b);

  // ---- XLSX (כרטיס, סכום חתום) דרך CHG.ccfile ----
  // xlsx.full.min.js מועתק רק בבנייה (prepare.js). כאן: ספרייה מדומה שמחזירה את מה ש-sheet_to_json({header:1,raw:true}) מחזיר (תאריך כמספר סדרתי של Excel, סכומים כמספרים)
  const hasX = true;
  if (hasX) {
    const t5x = await mp.evaluate(async () => { const AOA = [['פירוט חיובים לכרטיס 5678'], ['תאריך עסקה', 'שם בית עסק', 'סכום חיוב'], [46328, 'מאפיית השחר', 1000], ['03/11/2026', 'זיכוי חנות', -50]];
      const had = typeof XLSX !== 'undefined'; if (!had) window.XLSX = { read: () => ({ SheetNames: ['a'], Sheets: { a: 1 } }), utils: { sheet_to_json: () => AOA } };
      const f = new File(['x'], 'card.xlsx'); const n0 = S.stl.length; await CHG.ccfile({ files: [f], value: '' }); await new Promise((r) => setTimeout(r, 200));
      const L = S.stl.slice(n0); const o = { n: L.length, acc: L.map((l) => l.acc), dir: L.map((l) => l.dir), d0: L[0] && L[0].date, ccx: S.ccx.length, a1: bal(S.tx.find((t) => t.id === 'a1')) }; if (!had) delete window.XLSX; return o; });
    check('5ה XLSX כרטיס דרך ccfile: זוהה כרטיס 5678 (לא cards[0]), חיוב = out, זיכוי = in; ccx הישן לא נגע', t5x.n === 2 && t5x.acc.every((a) => a === 'cv') && t5x.dir.join() === 'out,in' && t5x.d0 === '2026-11-02' && t5x.ccx === 1, t5x);
    check('5ו בכרטיס: חשבונית a1 (1000, מאפיית השחר) הותאמה אוטומטית', t5x.a1 === 0, t5x);
  }

  // ---- 7. stlLink לקיים לא משנה bal; חדש מוריד בדיוק; stlUnlink מחזיר בדיוק ----
  await seed(mp, ORG);
  const t7 = await mp.evaluate(() => { const st = stmAdd({ kind: 'bank', acc: 'bka' }, [{ date: '2026-11-01', desc: 'x1', amt: 800, dir: 'out' }, { date: '2026-11-02', desc: 'x2', amt: 300, dir: 'out' }, { date: '2026-11-03', desc: 'x3', amt: 1500, dir: 'out' }, { date: '2026-11-03', desc: 'x4', amt: 99, dir: 'out' }]);
    const L = S.stl.filter((l) => l.stm === st.id), b1 = S.tx.find((t) => t.id === 'b1'), a1 = S.tx.find((t) => t.id === 'a1'), a2 = S.tx.find((t) => t.id === 'a2');
    const r = {}; r.b0 = bal(b1); r.l1 = stlLink(L[0].id, 'b1', { pay: 'pb1' }); r.b1 = bal(b1); r.np1 = b1.pays.length;
    r.a0 = bal(a1); r.l2 = stlLink(L[1].id, 'a1'); r.a1 = bal(a1);
    stlUnlink(L[1].id); r.a1x = bal(a1); r.l3 = stlLink(L[2].id, 'a1', { ids: ['a1', 'a2'] }); r.a1c = bal(a1); r.a2c = bal(a2);
    r.big = stlLink(L[3].id, 'b2');
    stlUnlink(L[0].id); r.b1u = bal(b1); r.np1u = b1.pays.length; r.pb1stl = 'stl' in b1.pays[0];
    stlUnlink(L[2].id); r.a1u = bal(a1); r.a2u = bal(a2); r.open = L.map((l) => S.stl.find((x) => x.id === l.id).st).join();
    const e = stlNewExp(L[3].id, { sub: 'sB', cat: 'e_sup', br: 'bra' }); r.e = e && { amt: e.amt, bal: bal(e), br: e.br, m: e.pays[0].m }; stlUnlink(L[3].id); r.eGone = !S.tx.some((t) => t.id === (e && e.id));
    return r; });
  check('7 stlLink לתשלום קיים: bal לא משתנה, לא נוסף תשלום', t7.l1 === true && t7.b0 === t7.b1 && t7.np1 === 1, t7);
  check('7א stlLink לחשבונית: יורד בדיוק 300; צירוף a1+a2 (1500)', t7.l2 === true && t7.a0 - t7.a1 === 300 && t7.a1x === 1000 && t7.l3 === true && t7.a1c === 0 && t7.a2c === 0, t7);
  check('7ב stlUnlink: תשלום קיים נשאר (רק הסימון יורד); תשלומים חדשים נמחקים – bal חוזר בדיוק', t7.b1u === 0 && t7.np1u === 1 && !t7.pb1stl && t7.a1u === 1000 && t7.a2u === 500 && t7.open === 'open,open,open,open', t7);
  check('7ג stlNewExp: חשבונית ששולמה (bal 0, סניף), וביטול מוחק אותה; סכום לא תואם נחסם', t7.e && t7.e.bal === 0 && t7.e.br === 'bra' && t7.e.m === 'העברה' && t7.eGone && typeof t7.big === 'string', t7);

  // ---- 8. stmGaps ----
  const t8 = await mp.evaluate(() => { const st = stmAdd({ kind: 'bank', acc: 'bka' }, [{ date: '2026-11-05', desc: 'עמלה', amt: 25, dir: 'out' }]); S.stl.filter((l) => /^x\d$/.test(l.desc)).forEach((l) => stlSkip(l.id, 'test')); const G = stmGaps('bka', '2026-11-01', '2026-11-05');
    return { app: G.notInApp.map((l) => l.desc), stm: G.notInStm.map((x) => x.p.id) }; });
  check('8 stmGaps: notInStm = העברה+צ׳ק מ-bka (pb1, pb4 לפי פירעון); מזומן ובנק אחר לא; notInApp = השורה הפתוחה', t8.stm.sort().join() === 'pb1,pb4' && t8.app.join() === 'עמלה', t8);

  // ---- 9. ספק קיזוז ----
  const t9 = await mp.evaluate(() => { const s = subById('sO'); s.offset = true; s.offBal0 = 1000; S.tx.push({ id: 'oi', t: 'inc', cat: 'i_yh', sub: null, date: '2026-11-02', amt: 500, note: 'דרך ספק', off: { sub: 'sO' } }); save();
    const cf0 = JSON.stringify(cfMonths('2026-11', 2, []).map((x) => x.sum)); const r = {}; r.p1 = offPay('o1', 900, '2026-11-03'); S.tx.push({ id: 'o2', t: 'exp', cat: 'e_sup', sub: 'sO', date: '2026-10-10', amt: 800, note: '', kind: 'inv', plan: '2026-11', inv: 'O2', pays: [] });
    r.p2 = offPay('o2', 300, '2026-11-03'); r.B = offBal('sO'); r.p3 = offPay('o2', 301, '2026-11-03'); r.cf = cf0 === JSON.stringify(cfMonths('2026-11', 2, []).map((x) => x.sum)); r.notOff = offPay('a1', 10, '2026-11-03');
    const G = stmGaps('bka', '2026-10-01', '2026-11-30'); r.gap = G.notInStm.some((x) => x.t.sub === 'sO'); return r; });
  check('9 offBal: 1000+500−1200=300', t9.p1 === true && t9.p2 === true && t9.B.cred === 1500 && t9.B.used === 1200 && t9.B.bal === 300, t9);
  check('9א offPay מעל היתרה נחסם; ספק רגיל נחסם; תזרים לא משתנה; לא ב-notInStm', typeof t9.p3 === 'string' && typeof t9.notOff === 'string' && t9.cf && !t9.gap, t9);
  const t9b = await mp.evaluate(async () => { const o2 = S.tx.find((t) => t.id === 'o2'); payDlg('o2'); const f = document.querySelector('#dlg form[data-f=paysave]'); const def = (f.querySelector('input[name=m]:checked') || {}).value; const note = !!document.querySelector('#dlg [data-offh]');
    f.a.value = '400'; await FRM.paysave(f); const blocked = bal(o2) === 500; f.a.value = '200'; await FRM.paysave(f); return { def, note, blocked, bal: bal(o2), last: o2.pays[o2.pays.length - 1].m }; });
  check('9ב טופס תשלום לספק קיזוז: ברירת מחדל קיזוז + יתרה; מעל היתרה נחסם; באישור נרשם קיזוז', t9b.def === 'קיזוז' && t9b.note && t9b.blocked && t9b.bal === 300 && t9b.last === 'קיזוז', t9b);
  await mp.evaluate(() => closeDlg());

  // ---- 10. תיקון 6: chkMatch {one,combo} + חלון; תיקון 1: CHG.inbf ----
  await seed(mp);
  const t10 = await mp.evaluate(() => { const r = chkMatch('sC', 700), c = chkMatch('sA', 1500); CKS = { sub: 'sC', a: '700', no: '', date: '2026-12-01', bank: '', img: '', payee: '', ids: null }; chkLinkDlg();
    const d = document.getElementById('dlg'); const o = { one: r.one.map((t) => t.id), combo: c.combo.map((t) => t.id).sort(), msg: d.querySelector('#ckMsg').innerText, chk: d.querySelectorAll('input[name=ck]:checked').length }; closeDlg(); CKS = null; return o; });
  check('10 תיקון 6: שתי חשבוניות באותו סכום – one=2, בלי סימון, "נמצאו 2 חשבוניות באותו סכום – בחר אחת"; צירוף ב-combo', t10.one.join() === 'c1,c2' && t10.chk === 0 && /נמצאו 2 חשבוניות באותו סכום/.test(t10.msg) && t10.combo.join() === 'a1,a2', t10);
  const t10b = await mp.evaluate(() => { const s = subById('sB'); s.terms = { b: 'inv', d: 30 }; S.inbox = [{ id: 'ib1', by: 'w', ow: 'w', at: '2026-11-03', d: { cat: 'e_sup', sub: 'sB', amt: 100, date: '2026-11-01', inv: '9' }, file: '', np: 0 }]; save();
    ACT.inbEdit({ dataset: { id: 'ib1' } }); const f = () => document.querySelector('#dlg form[data-f=inbsave]'); const r = { d0: f().due.value };
    f().date.value = '2026-11-10'; CHG.inbf(f().date); r.d1 = f().due.value;
    f().due.value = '2026-12-31'; CHG.dueC(f().due); f().date.value = '2026-11-20'; CHG.inbf(f().date); r.d2 = f().due.value; closeDlg(); delete s.terms; S.inbox = []; save(); return r; });
  check('10א תיקון 1: שינוי תאריך מחשב מחדש את תאריך התשלום; אחרי עריכה ידנית – נשמר', t10b.d0 === '2026-12-01' && t10b.d1 === '2026-12-10' && t10b.d2 === '2026-12-31', t10b);

  // ---- 11א. מנהל: סריקת statement מדומה ----
  await seed(mp, ORG);
  await mp.evaluate(() => { if (US) usReset(); usOpen(); }); await H.settle(mp, 300);
  mp.__q = [{ type: 'statement', allowed: true, typeConfidence: 0.9, fields: { kind: 'bank', last4: '1234', from: '2026-11-01', to: '2026-11-30', lines: [{ date: '2026-11-01', desc: 'העברה מאפיית השחר', amt: 500, dir: 'out' }, { date: '2026-11-05', desc: 'עמלה', amt: 25, dir: 'out' }] }, confidence: {}, uncertain: [] }];
  await mp.setInputFiles('#sheet input[accept="image/*"][multiple]', { name: 's.png', mimeType: 'image/png', buffer: await mkImg(mp, 'STM') }); await H.settle(mp, 2500);
  const t11a = await mp.evaluate(() => ({ stm: S.stm.map((x) => ({ acc: x.acc, src: x.src, n: x.n, fid: !!x.fid })), match: S.stl.filter((l) => l.st === 'match').length, step: US && US.step }));
  check('11א מנהל סורק דף: נשמר לחשבון 1234 (src=scan, צילום), התאמה אוטומטית אחת', t11a.stm.length === 1 && t11a.stm[0].acc === 'bka' && t11a.stm[0].src === 'scan' && t11a.stm[0].fid && t11a.stm[0].n === 2 && t11a.match === 1 && t11a.step === 'done', t11a);
  await mp.evaluate(() => usReset());
  check('11ב אין שגיאות JS (מנהל)', !mp.__errors.length, mp.__errors);

  // ---- 11. עובד: statement חסום; צ'ק → תור המנהל (0 לחיצות, בלי tx/תשלום, בלי כפילות, גם בלי חיבור) ----
  const scanW = async (p, a) => { await p.evaluate(() => { if (US) usReset(); usOpen(); }); await H.settle(p, 300); p.__q = [a]; await p.setInputFiles('#sheet input[accept="image/*"][multiple]', { name: 'c.png', mimeType: 'image/png', buffer: await mkImg(p, 'CHK1') }); await H.settle(p, 2500); };
  const CHK = { type: 'check', allowed: true, route: 'mgr', typeConfidence: 0.9, fields: { number: '000123', bank: 'לאומי', account: '5678', date: '2026-12-15', amount: 2360, payee: 'מאפיית השחר' }, confidence: {}, uncertain: [] };
  const runW = async (label, c, setup) => {
    const w = await H.newPage(browser, www, c, [], 'w'); const p = w.page; await p.setViewportSize({ width: 360, height: 740 }); await mockScan(p); await H.login(p, 'w@x.co'); if (setup) await p.evaluate(setup);
    const posts = []; p.on('request', (r) => { if (r.method() === 'POST' && /\/inbox\?documentId=/.test(r.url())) posts.push(r.postData()); });
    const s0 = await p.evaluate(() => ({ st: usAllowed('statement'), keys: usKeys() }));
    check(label + ' statement חסום בלקוח', s0.st === false && !s0.keys.includes('statement'), s0);
    // בלי חיבור: הפריט נשאר בתור במכשיר
    await p.route('**/chunks**', (r) => r.abort()); await scanW(p, CHK);
    const o1 = await p.evaluate(() => ({ txt: document.getElementById('sheet').innerText, ob: obGet().map((x) => ({ id: x.id, k: x.data.kind, amt: x.data.amt, fid: x.data.fid })), tx: (S && S.tx || []).length }));
    check(label + ' בלי חיבור: "זוהה צ׳ק – נשלח למנהל", פריט אחד בתור במכשיר (kind:check, amt, fid), 0 לחיצות', /זוהה צ׳ק – נשלח למנהל/.test(o1.txt) && o1.ob.length === 1 && o1.ob[0].k === 'check' && o1.ob[0].amt === 2360 && !!o1.ob[0].fid, o1);
    await p.unroute('**/chunks**'); await p.evaluate(() => flush()); await H.settle(p, 800);
    await scanW(p, CHK); await p.evaluate(() => flush()); await H.settle(p, 800);
    const o2 = await p.evaluate(() => ({ ob: obGet().length }));
    const bodies = posts.map((b) => { try { const j = JSON.parse(b).fields; return { k: j.k && j.k.stringValue, d: JSON.parse(j.data.stringValue) }; } catch (e) { return null; } }).filter(Boolean);
    check(label + ' אחרי חיבור: בדיוק פריט אחד נשלח לתור המנהל (k=check, kind, fid, amt); סריקה חוזרת לא שולחת שני', o2.ob === 0 && bodies.length === 1 && bodies[0].k === 'check' && bodies[0].d.kind === 'check' && bodies[0].d.amt === 2360 && !!bodies[0].d.fid && !bodies[0].d.cat, bodies);
    check(label + ' אין שגיאות JS', !p.__errors.length, p.__errors);
    await w.ctx.close();
  };
  await runW('11 עובד (legacy, עם expW):', cfg);
  const cb = { mode: 'new', users: { m: 'acme', w: 'acme' }, biz: { acme: { dataRoot: 'b', features: { scan: true } } }, admins: { 'b/acme/|m': 1 }, staff: { 'b/acme/|w': 1 } };
  await runW('11ג עובד בלי expW (עסק b):', cb, () => { SY.perms = { incW: true, expW: false }; });

  // ---- pullInbox2: פריט k=='check' תמיד צ'ק בלבד (גם אם data.kind='exp'); אישור לא יוצר הוצאה ----
  await seed(mp);
  const pi = await mp.evaluate(async () => { S.inbox = []; save(); const f = (v) => ({ stringValue: v });
    const doc = (id, k, data) => ({ name: 'p/d/inbox/' + id, fields: Object.assign({ data: f(JSON.stringify(data)), by: f('w'), owner: f('w'), created: f('2026-11-03'), status: f('new') }, k ? { k: f(k) } : {}) });
    const o = runQ; runQ = async () => [doc('kevil1', 'check', { kind: 'exp', cat: 'e_sup', sub: 'sA', amt: 900, date: '2026-11-03', inv: 'X1', evil: 1, payee: 'מוטב 4580.1234.1234.1234', no: '000123' }), doc('nok1', '', { kind: 'check', amt: 5, date: '2026-11-03', cat: 'e_sup', sub: 'sA' })];
    try { await pullInbox2(); } finally { runQ = o; }
    const a = S.inbox.find((x) => x.id === 'kevil1'), b = S.inbox.find((x) => x.id === 'nok1'), n0 = S.tx.length; let thrown = '';
    try { await ACT.inbOk({ dataset: { id: 'kevil1' } }); } catch (e) { thrown = e.message; }
    return { d: a && a.d, chk: a && inbChk(a), b: b && b.d.kind, dlg: !!document.querySelector('#dlg form[data-f=chkLinkF]'), tx: S.tx.length - n0, thrown }; });
  check('2 pullInbox2: k:"check" עם data.kind="exp" → kind=check בלבד, בלי cat/sub/inv/שדות זרים, מוטב מצונזר; "אשר" פותח שיוך ולא יוצר הוצאה; בלי k – kind:check נמחק',
    pi.chk && pi.d.kind === 'check' && pi.d.amt === 900 && !pi.d.sub && !pi.d.cat && !pi.d.inv && !('evil' in pi.d) && /••••1234/.test(pi.d.payee) && !/4580/.test(pi.d.payee) && pi.dlg && pi.tx === 0 && pi.b === undefined, pi);
  await mp.evaluate(() => { closeDlg(); S.inbox = []; save(); });

  // ---- מנהל: הצ'ק בתיבה – "אשר" פותח שיוך, לא יוצר הוצאה; אחרי שיוך יוצא מהתיבה ----
  await seed(mp);
  const t11d = await mp.evaluate(async () => { S.inbox = [{ id: 'kabc', by: 'w', ow: 'w', at: '2026-11-03', d: { kind: 'check', amt: 500, date: '2026-12-15', cdate: '2026-12-15', no: '123', payee: 'מאפיית השחר', fid: 'abc', cat: '' }, file: '', np: 0 }]; save(); const n0 = S.tx.length;
    await ACT.inbOk({ dataset: { id: 'kabc' } }); const f = document.querySelector('#dlg form[data-f=chkLinkF]'); const r = { dlg: !!f, sub: f && f.sub.value, chk: f && [...f.querySelectorAll('input[name=ck]:checked')].map((x) => x.value).join(), tx: S.tx.length - n0 };
    FRM.chkLinkF(f); const p = S.tx.find((t) => t.id === 'a2').pays[0]; r.p = p && { m: p.m, a: p.a, date: p.chk && p.chk.date }; r.inbox = S.inbox.length; return r; });
  check('11ד מנהל: צ׳ק מעובד → חלון שיוך ממולא (ספק, חשבונית); שמירה = תשלום צ׳ק; יוצא מהתיבה; לא נוצרה הוצאה', t11d.dlg && t11d.sub === 'sA' && t11d.chk === 'a2' && t11d.tx === 0 && t11d.p && t11d.p.m === 'צ׳ק' && t11d.p.a === 500 && t11d.p.date === '2026-12-15' && t11d.inbox === 0, t11d);
  check('11ה אין שגיאות JS (מנהל, סוף)', !mp.__errors.length, mp.__errors);

  await browser.close();
  console.log(fail ? 'נכשלו ' + fail : 'כל הבדיקות עברו'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
