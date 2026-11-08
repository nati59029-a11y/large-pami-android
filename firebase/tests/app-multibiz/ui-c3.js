'use strict';
// C3 – ייבוא אשראי/בנק משודרג: זיהוי עמודות (כותרות/תוכן/מיפוי שנשמר), PDF (pdf.js), כרטיס לפי 4 ספרות (כרטיס חדש נוצר לבד, כמה כרטיסים בדף),
// הצעת שיוך לפי בית עסק + למידה, "אין חשבונית" → ממתינות לחשבונית, יום חיוב → ירידה מהחשבון ותזרים, אין מספר כרטיס מלא, תאימות לגיבוי ישן.
// שימוש: NODE_PATH=... node ui-c3.js <www-dir>
const H = require('./harness');
const BZ0 = ['larg', 'peami'].join('');
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
const rnd2 = (x) => Math.round(x * 100) / 100;
let fail = 0; const check = (n, ok, info) => { if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 500) : '')); };
const ORG = { v: 1, branches: [{ id: 'bra', name: 'נחל לכיש', on: true, sig: [] }], banks: [{ id: 'bka', name: 'לאומי', last4: '1234', on: true, sig: [] }],
  cards: [{ id: 'cv', name: 'ויזה עסקי', last4: '5678', bank: 'bka', on: true, sig: [] }] };
// PDF מינימלי (Helvetica, טקסט לטיני) – שורות [x, y, טקסט]
function mkPdf(items) {
  const esc = (s) => s.replace(/[\\()]/g, (c) => '\\' + c);
  const content = items.map(([x, y, t]) => `BT /F1 10 Tf ${x} ${y} Td (${esc(t)}) Tj ET`).join('\n');
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let out = '%PDF-1.4\n'; const off = [];
  objs.forEach((o, i) => { off.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = Buffer.byteLength(out); out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + off.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}
const seed = (p) => p.evaluate((org) => {
  S.tx = []; S.stm = []; S.stl = []; BRSEL = []; S.pmOff = 2; delete S.ccc; delete S.ccMeta; delete S.impMap; delete S.mLearn;
  S.ccx = [{ id: 'cx1', sub: '', date: '2026-10-01', desc: 'ישן 4580123412345678', amt: 10, match: '', exp: '' }]; S.orgC = org;
  S.subs = S.subs.filter((s) => !['sA', 'sF'].includes(s.id)); S.subs.push({ id: 'sA', cat: 'e_sup', name: 'מאפיית השחר' });
  const fc = catsOf('exp').find((c) => c.beh === 'simple' || c.beh === 'free'); S.subs.push({ id: 'sF', cat: fc.id, name: 'דלק' });
  S.tx.push({ id: 'old1', t: 'exp', cat: fc.id, sub: 'sF', date: '2026-09-10', amt: 200, note: 'פז אילת' });
  save();
}, ORG);
(async () => {
  const [www] = process.argv.slice(2); const browser = await H.launch();
  const cfg = { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: ALL } }, admins: { '|m': 1 }, staff: {} };
  const m = await H.newPage(browser, www, cfg, [], 'm'); const mp = m.page; await mp.setViewportSize({ width: 360, height: 740 }); await H.login(mp, 'm@x.co');
  await seed(mp); await mp.evaluate(() => { try { sheetClose(); } catch (e) {} });
  mp.click = (sel) => mp.evaluate((q) => { const e = document.querySelector(q); if (!e) throw new Error('no ' + q); e.click(); }, sel);
  const toast = () => mp.evaluate(() => ([...document.querySelectorAll('.toast')].pop() || {}).innerText || '');
  const up = async (sel, name, buf, mime) => { await mp.setInputFiles(sel, { name, mimeType: mime || 'text/csv', buffer: buf }); await H.settle(mp, 900); };

  // ---- 0. תאימות: גיבוי ישן נטען בלי שינוי ----
  const t0 = await mp.evaluate(() => { const a = JSON.stringify({ tx: S.tx, subs: S.subs, ccx: S.ccx }); const d = ensure(JSON.parse(JSON.stringify(S))); return { same: JSON.stringify({ tx: d.tx, subs: d.subs, ccx: d.ccx }) === a, ccc: d.ccc === undefined, meta: d.ccMeta === undefined }; });
  check('0 ensure על גיבוי ישן: tx/subs/ccx זהים, בלי שדות חדשים', t0.same && t0.ccc && t0.meta, t0);
  const t0b = await mp.evaluate(() => { const d = ensure({ ccc: [{ id: 'lc_abc', name: 'x', last4: '4580123412345678' }, { id: 'bad id' }], ccMeta: { lc_abc: { day: 40 }, cv: { day: '10', bank: 'bka' } }, impMap: [], mLearn: 'x' }); return { ccc: d.ccc, meta: d.ccMeta, im: d.impMap, ml: d.mLearn }; });
  check('0א ensure מנקה ערכים פגומים: 4 ספרות בלבד, יום חיוב 1–31', t0b.ccc.length === 1 && t0b.ccc[0].last4 === '' && t0b.meta.cv.day === 10 && t0b.meta.lc_abc.day === undefined && t0b.im === undefined && t0b.ml === undefined, t0b);

  // ---- 1. ייבוא דף אשראי בלי כרטיס מוגדר: שני כרטיסים בדף, אחד קיים (5678) ואחד חדש (9012). עמודת כרטיס במספר מלא ----
  await mp.evaluate(() => go('rec')); await H.settle(mp, 300);
  const CSV1 = '﻿פירוט עסקאות\nתאריך עסקה,שם בית העסק,סכום עסקה,סכום חיוב,מספר כרטיס\n' +
    '01/11/2026,פז אילת,150.00,150.00,4580-1111-2222-5678\n' + '02/11/2026,מאפיית השחר,1000.00,1000.00,4580111122225678\n' +
    '02/11/2026,סופר יודה,80.00,80.00,••••9012\n' + '03/11/2026,זיכוי סופר יודה,-20.00,-20.00,9012\n';
  await up('[data-c=recfileK]', 'cards.csv', Buffer.from(CSV1, 'utf8'));
  const s1 = await mp.evaluate(() => ({ stl: S.stl.map((l) => ({ acc: l.acc, d: l.desc, a: l.amt, dir: l.dir })), ccc: S.ccc, json: JSON.stringify(S) }));
  const tt1 = await toast();
  check('1 פיצול לפי כרטיס: 2 שורות לכרטיס הקיים (cv ····5678), 2 לכרטיס חדש ····9012 שנוצר לבד', s1.stl.filter((l) => l.acc === 'cv').length === 2 && s1.ccc && s1.ccc.length === 1 && s1.ccc[0].last4 === '9012' && s1.ccc[0].name === 'כרטיס חדש' && s1.stl.filter((l) => l.acc === s1.ccc[0].id).length === 2, s1.stl);
  check('1א "סכום חיוב" נבחר על פני "סכום עסקה"; זיכוי = in', s1.stl.some((l) => l.dir === 'in' && l.a === 20), s1.stl);
  check('1ב הודעה: 2 כרטיסים, נוצר כרטיס חדש ····9012', /2 כרטיסים/.test(tt1) && /····9012/.test(tt1), tt1);
  check('1ג אין מספר כרטיס מלא בנתונים שנשמרו (מלבד ccx ישן שלא נוגע)', !/4580-?1111/.test(s1.json) && /4580123412345678/.test(s1.json), '');
  const a1 = await mp.evaluate(() => bal(S.tx.find((t) => t.id === 'old1')) );
  void a1;
  // ---- 2. כרטיס חדש: מופיע ב-V.rec עם "תן כינוי"; הגדרות: כינוי + יום חיוב ----
  await mp.evaluate(() => go('rec')); await H.settle(mp, 300);
  const r2 = await mp.evaluate(() => document.querySelector('main').innerText);
  check('2 V.rec: הכרטיס החדש ····9012 מופיע עם "תן כינוי" ו"הגדרות כרטיס"', /כרטיס חדש/.test(r2) && /····9012/.test(r2) && /תן כינוי/.test(r2) && /הגדרות כרטיס/.test(r2), r2.slice(0, 400));
  const nid = await mp.evaluate(() => S.ccc[0].id);
  await mp.click(`[data-a=ccSet][data-acc=${nid}]`); await H.settle(mp, 200);
  await mp.evaluate(() => { const f = document.querySelector('#dlg form[data-f=ccSetF]'); f.elements.name.value = 'כרטיס של דוד'; f.elements.day.value = '10'; f.elements.bank.value = 'bka'; });
  await mp.click('#dlg form[data-f=ccSetF] button:not([type=button])'); await H.settle(mp, 300);
  await mp.evaluate((id) => ACT.ccSet({ dataset: { acc: 'cv' } }), nid); await H.settle(mp, 200);
  const cvHasName = await mp.evaluate(() => !!document.querySelector('#dlg form[data-f=ccSetF] [name=name]'));
  await mp.evaluate(() => { document.querySelector('#dlg form[data-f=ccSetF] [name=day]').value = '2'; }); await mp.click('#dlg form[data-f=ccSetF] button:not([type=button])'); await H.settle(mp, 300);
  const s2 = await mp.evaluate((id) => ({ c: S.ccc.find((x) => x.id === id), meta: S.ccMeta, txt: document.querySelector('main').innerText }), nid);
  check('2א הגדרות כרטיס: כינוי ויום חיוב נשמרו; כרטיס מהארגון – בלי שינוי שם (רק יום חיוב)', s2.c.name === 'כרטיס של דוד' && s2.meta[nid].day === 10 && s2.meta[nid].bank === 'bka' && s2.meta.cv.day === 2 && !cvHasName && /יום חיוב: 10 לחודש/.test(s2.txt), s2);
  // ---- 3. יום חיוב: חישוב תאריך החיוב ותזרים ----
  const s3 = await mp.evaluate((id) => ({ a: ccBillDate(id, '2026-11-02'), b: ccBillDate(id, '2026-11-10'), c: ccBillDate(id, '2026-11-25'), d8: ccBillDate(id, '2026-11-08'), d9: ccBillDate(id, '2026-11-09'), feb: (S.ccMeta.x = { day: 31 }, ccBillDate('x', '2027-02-05')), feb27: ccBillDate('x', '2027-02-27'), feb26: ccBillDate('x', '2027-02-26'), cv: ccBillDate('cv', '2026-11-01'), cv0: ccBillDate('cv', '2026-10-31'),
    nov: cfDebits('2026-11', []), dec: cfDebits('2026-12', []), home: homeCards('2026-11').debit, homeD: homeCards('2026-12').debit }), nid);
  check('3 תאריך חיוב (החלטה 16:18): לפני יום החיוב−1 → אותו חודש; מיום החיוב−1 → הבא; 31 בפברואר → 28 והסף 27', s3.a === '2026-11-10' && s3.d8 === '2026-11-10' && s3.d9 === '2026-12-10' && s3.b === '2026-12-10' && s3.c === '2026-12-10' && s3.feb === '2027-02-28' && s3.feb26 === '2027-02-28' && s3.feb27 === '2027-03-31' && s3.cv === '2026-12-02' && s3.cv0 === '2026-11-02', s3);
  // דוד: 80 (2.11) - 20 (3.11) → חיוב 10.11 = 60. ויזה: 150 (1.11) → 2.11 (נובמבר); 1000 (2.11) → 2.12 (דצמבר) – אם לא הותאם... השורות פתוחות או מותאמות, תמיד נספרות
  check('3א ירידה מהחשבון ותזרים: נובמבר 60 (דוד); דצמבר 150+1000 (ויזה, מ-1.11 = יום לפני יום החיוב 2)', s3.nov.sumCc === 60 && s3.dec.sumCc === 1150 && s3.home === s3.nov.sum && s3.homeD === s3.dec.sum, { nov: s3.nov.sumCc, dec: s3.dec.sumCc, cc: s3.nov.cc });
  await mp.evaluate(() => { delete S.ccMeta.x; save(); go('cf', '2026-11'); }); await H.settle(mp, 300);
  const cf = await mp.evaluate(() => document.querySelector('main').innerText);
  check('3ב מסך תזרים: "אשראי ₪…" בשורת החודש ו"חיוב אשראי צפוי" בפירוט', /אשראי/.test(cf) && /חיוב אשראי צפוי/.test(cf) && /כרטיס של דוד/.test(cf), cf.slice(0, 500));
  const bf = await mp.evaluate(() => { S.orgC.branches.push({ id: 'brb', name: 'ב', on: true, sig: [] }); const r = cfDebits('2026-11', ['bra']).sumCc; S.orgC.branches.pop(); return r; });
  check('3ג בסינון סניף – חיובי אשראי לא נספרים (הכרטיס לא שייך לסניף)', bf === 0, bf);

  // ---- 3ד–3ז תיקוני סבב 1 ----
  const f3 = await mp.evaluate((id) => {
    const base = cfDebits('2026-11', []).sumCc;
    // תשלום אשראי באפליקציה (80, 2.11) לכרטיס של דוד – הדף מכסה 2.11–3.11 → לא נספר שוב
    S.tx.push({ id: 'pz', t: 'exp', cat: 'e_sup', sub: 'sA', date: '2026-11-02', amt: 80, kind: 'inv', plan: '2026-11', inv: 'Z1', pays: [{ id: 'pp', d: '2026-11-02', a: 80, m: 'אשראי', card: id }] });
    const dup = cfDebits('2026-11', []).sumCc;
    // תשלום מחוץ לטווח הדף (5.11) → נספר
    S.tx.find((t) => t.id === 'pz').pays[0].d = '2026-11-05'; const out = cfDebits('2026-11', []).sumCc;
    S.tx = S.tx.filter((t) => t.id !== 'pz');
    // התעלם: שורת 80 → לא נספרת
    const l = S.stl.find((x) => x.acc === id && x.amt === 80); l.st = 'skip'; const sk = cfDebits('2026-11', []); l.st = 'open';
    // זיכוי גדול מהחיובים → a=0, cr בנפרד, לא מקטין
    const z = { id: 'zz', stm: l.stm, acc: id, date: '2026-11-03', desc: 'זיכוי גדול', amt: 500, dir: 'in', st: 'open' }; S.stl.push(z); const neg = cfDebits('2026-11', []); S.stl = S.stl.filter((x) => x.id !== 'zz');
    save(); return { base, dup, out, sk: sk.sumCc, skCr: sk.sumCcCr, neg: { a: neg.sumCc, cr: neg.sumCcCr, sum: neg.sum } };
  }, nid);
  check('3ד אין ספירה כפולה: תשלום אשראי באפליקציה בתוך טווח הדף לא נספר שוב; מחוץ לטווח – נספר', f3.dup === f3.base && f3.out === rnd2(f3.base + 80), f3);
  check('3ה שורת "התעלם" לא נספרת בחיוב הצפוי', f3.sk === 0 && f3.skCr === 20, f3);
  check('3ו זיכוי גדול מהחיובים: הירידה לא יורדת מתחת ל-0, הזיכוי מוצג בנפרד', f3.neg.a === 0 && f3.neg.cr === 440 && f3.neg.sum >= 0, f3);
  // ---- 4. הצעת שיוך לפי בית עסק + למידה + ממתינות לחשבונית ----
  const ms = await mp.evaluate(() => { const L = S.stl.filter((l) => l.st === 'open'); return L.map((l) => ({ d: l.desc, g: mSuggest(l) })); });
  const paz = ms.find((x) => x.d === 'פז אילת');
  check('4 הצעה לפי הוצאה קודמת עם אותו תיאור (פז אילת → דלק)', paz && paz.g && paz.g.sub === 'sF' && /אותו תיאור/.test(paz.g.why), ms);
  const pazId = await mp.evaluate(() => S.stl.find((l) => l.desc === 'פז אילת').id);
  const stmId = await mp.evaluate((id) => S.stl.find((l) => l.id === id).stm, pazId);
  await mp.evaluate((s) => { RECT = 'n'; go('recStm', s); }, stmId); await H.settle(mp, 300);
  const rw = await mp.evaluate((id) => document.querySelector(`[data-lid="${id}"]`).innerText, pazId);
  check('4א בשורה הפתוחה: "הצעה: הוצאה לדלק" וכפתור "שייך"', /הצעה: הוצאה ל/.test(rw) && /דלק/.test(rw) && /שייך/.test(rw), rw);
  await mp.click(`[data-lid="${pazId}"] [data-a=recQuick]`); await H.settle(mp, 300);
  const s4 = await mp.evaluate((id) => { const l = S.stl.find((x) => x.id === id), t = S.tx.find((x) => x.id === l.tx); return { st: l.st, t: t && { sub: t.sub, amt: t.amt, aw: t.await }, learn: S.mLearn, aw: tdnL().aw.map((x) => x.id) }; }, pazId);
  check('4ב "שייך": הוקמה הוצאה (דלק, 150), ממתינה לחשבונית, ונלמד', s4.st === 'exp' && s4.t.sub === 'sF' && s4.t.amt === 150 && s4.t.aw === 1 && s4.learn['פז אילת'] && s4.learn['פז אילת'].sub === 'sF', s4);
  // הקם הוצאה עם קטגוריה + תת־קטגוריה חדשה; בלי חשבונית
  const yid = await mp.evaluate(() => S.stl.find((l) => l.desc === 'סופר יודה').id);
  const ystm = await mp.evaluate((id) => S.stl.find((l) => l.id === id).stm, yid);
  await mp.evaluate((s) => { RECT = 'n'; go('recStm', s); }, ystm); await H.settle(mp, 300);
  await mp.click(`[data-lid="${yid}"] [data-a=recNew]`); await H.settle(mp, 300);
  const dl = await mp.evaluate(() => ({ nw: !!document.querySelector('#dlg option[value=__new]'), ni: !!document.querySelector('#dlg [name=noinv]:checked'), cats: document.querySelector('#dlg select[name=cat]').options.length }));
  check('4ג חלון "הקם הוצאה": קטגוריה, תת־קטגוריה (כולל "＋ חדש"), "אין חשבונית" מסומן', dl.nw && dl.ni && dl.cats > 2, dl);
  await mp.evaluate(() => { const f = document.querySelector('#dlg form[data-f=recNew]'), c = f.elements.cat; c.value = catsOf('exp').find((x) => x.beh === 'simple' || x.beh === 'free').id; c.dispatchEvent(new Event('change', { bubbles: true })); const s = f.elements.sub; s.value = '__new'; s.dispatchEvent(new Event('change', { bubbles: true })); f.elements.newsub.value = 'סופרמרקט'; });
  await mp.click('#dlg form[data-f=recNew] button:not([type=button])'); await H.settle(mp, 300);
  const s4b = await mp.evaluate((id) => { const l = S.stl.find((x) => x.id === id), t = S.tx.find((x) => x.id === l.tx), s = t && subById(t.sub); return { st: l.st, sub: s && s.name, aw: t && t.await, learn: S.mLearn['סופר יודה'] }; }, yid);
  check('4ד הוקמה הוצאה עם תת־קטגוריה חדשה "סופרמרקט", ממתינה לחשבונית, נלמד', s4b.st === 'exp' && s4b.sub === 'סופרמרקט' && s4b.aw === 1 && s4b.learn, s4b);
  await mp.evaluate(() => go('tdn')); await H.settle(mp, 300);
  const td = await mp.evaluate(() => document.querySelector('main').innerText);
  check('4ה "תשלומים שממתינים לחשבונית" מציג את שתי ההוצאות', /דלק/.test(td) && /סופרמרקט/.test(td), td.slice(0, 300));
  // למידה בפעם הבאה: דף חדש עם "סופר יודה" → הצעה מהלמידה
  const CSV2 = '﻿תאריך עסקה,שם בית העסק,סכום חיוב\n15/11/2026,סופר יודה 12,55.00\n';
  await mp.evaluate(() => go('rec')); await H.settle(mp, 200);
  await up(`[data-c=recfile][data-acc=${nid}]`, 'x.csv', Buffer.from(CSV2, 'utf8'));
  const s4c = await mp.evaluate(() => { const l = S.stl.find((x) => x.amt === 55); return { acc: l.acc, g: mSuggest(l) }; });
  check('4ו בפעם הבאה: הצעה "נלמד מבחירה קודמת" (סופרמרקט); שורות בלי 4 ספרות → הכרטיס שנבחר', s4c.acc === nid && s4c.g && /נלמד/.test(s4c.g.why) && s4c.g.sub, s4c);
  const s4d = await mp.evaluate(() => mSuggest({ desc: 'מאפיית השחר בעמ', dir: 'out' }));
  check('4ז הצעה לפי שם ספק קיים (מאפיית השחר)', s4d && s4d.sub === 'sA' && /שם/.test(s4d.why), s4d);

  // ---- 5. זיהוי עמודות לפי תוכן (בלי כותרות) + מסך מיפוי שנשמר ----
  const s5 = await mp.evaluate(() => { const c = impContent([['05/11/2026', 'דלק פז', '1234', '120.50'], ['06/11/2026', 'קפה', '1234', '18.00']]); return c; });
  check('5 זיהוי לפי תוכן: תאריך/תיאור/סכום; עמודת 4 ספרות = כרטיס; בטוח', s5 && s5.ix.date === 0 && s5.ix.desc === 1 && s5.ix.amt === 3 && s5.ix.card === 2 && s5.sure, s5);
  const CSV3 = '﻿יום,פרטים,א,ב\n05/11/2026,חנות כלבו,100.00,99.00\n06/11/2026,חנות ב,50.00,49.00\n';
  await mp.evaluate(() => go('rec')); await H.settle(mp, 200);
  await up('[data-c=recfile][data-acc=bka]', 'b.csv', Buffer.from(CSV3, 'utf8'));
  const d5 = await mp.evaluate(() => ({ f: !!document.querySelector('#dlg form[data-f=impMap]'), n: document.querySelectorAll('#dlg form[data-f=impMap] select').length }));
  check('5א שתי עמודות סכום בלי כותרת מוכרת → מסך "איזו עמודה היא מה?"', d5.f && d5.n === 7, d5);
  await mp.evaluate(() => { const f = document.querySelector('#dlg form[data-f=impMap]'); f.elements.date.value = '0'; f.elements.desc.value = '1'; f.elements.amt.value = ''; f.elements.dr.value = '2'; });
  await mp.click('#dlg form[data-f=impMap] button:not([type=button])'); await H.settle(mp, 600);
  const s5b = await mp.evaluate(() => ({ L: S.stl.filter((l) => l.acc === 'bka').map((l) => l.amt + l.dir), map: Object.keys(S.impMap || {}) }));
  check('5ב המיפוי הוחל (חובה = עמודה 3) ונשמר לכותרת ולחשבון', s5b.L.includes('100out') && s5b.L.includes('50out') && s5b.map.some((k) => k.startsWith('h:')) && s5b.map.includes('a:bka'), s5b);
  const CSV3b = '﻿יום,פרטים,א,ב\n07/11/2026,חנות ג,70.00,69.00\n';
  await mp.evaluate(() => go('rec')); await H.settle(mp, 200);
  await up('[data-c=recfile][data-acc=bka]', 'b2.csv', Buffer.from(CSV3b, 'utf8'));
  const s5c = await mp.evaluate(() => ({ dlg: document.getElementById('dlg').open && !!document.querySelector('#dlg form[data-f=impMap]'), has: S.stl.some((l) => l.amt === 70 && l.acc === 'bka') }));
  check('5ג קובץ שני באותו מבנה: בלי מסך מיפוי, המיפוי השמור הוחל', !s5c.dlg && s5c.has, s5c);
  await mp.evaluate(() => closeDlg());

  // ---- 6. PDF: שני כרטיסים בדף (כותרת "Card ····1111" ו-"Card ····5678"), עמודות לפי מיקום ----
  const pdf = mkPdf([[40, 760, 'Monthly statement'], [40, 740, 'Card ending 1111'], [450, 720, 'Date'], [250, 720, 'Merchant'], [60, 720, 'Amount'],
    [450, 700, '04/11/2026'], [250, 700, 'SHUFERSAL'], [60, 700, '210.40'], [450, 680, '05/11/2026'], [250, 680, 'GOOGLE 4580123412341111'], [60, 680, '12.00'],
    [40, 650, 'Card ending 5678'], [450, 630, '06/11/2026'], [250, 630, 'IKEA'], [60, 630, '999.90']]);
  await mp.evaluate(() => go('rec')); await H.settle(mp, 200);
  await up('[data-c=recfileK]', 'statement.pdf', pdf, 'application/pdf'); await H.settle(mp, 1500);
  const s6 = await mp.evaluate(() => ({ L: S.stl.filter((l) => /SHUFERSAL|GOOGLE|IKEA/.test(l.desc)).map((l) => ({ acc: l.acc, d: l.desc, a: l.amt, dt: l.date })), ccc: (S.ccc || []).map((c) => c.last4) }));
  const t6 = await toast();
  const L1111 = s6.L.filter((l) => /SHUFERSAL|GOOGLE/.test(l.d)), Lik = s6.L.find((l) => /IKEA/.test(l.d));
  check('6 PDF: 3 שורות; 2 לכרטיס חדש ····1111 ו-1 לכרטיס הקיים 5678; סכומים ותאריכים נכונים', s6.L.length === 3 && s6.ccc.includes('1111') && L1111.length === 2 && L1111.every((l) => l.acc !== 'cv') && Lik && Lik.acc === 'cv' && Lik.a === 999.9 && L1111.some((l) => l.a === 210.4 && l.dt === '2026-11-04'), { s6, t6 });
  check('6א PDF: מספר כרטיס מלא בתיאור צונזר', s6.L.some((l) => /••••1111/.test(l.d)) && !s6.L.some((l) => /4580/.test(l.d)), s6.L);
  // ---- 7. בלי 4 ספרות בכלל ויותר מכרטיס אחד → שאלה + כרטיס חדש (כינוי + 4 ספרות) ----
  const CSV7 = '﻿תאריך עסקה,שם בית העסק,סכום חיוב\n08/11/2026,מסעדה,90.00\n';
  await mp.evaluate(() => go('cc')); await H.settle(mp, 200);
  await up('[data-c=ccfile]', 'noid.csv', Buffer.from(CSV7, 'utf8'));
  const d7 = await mp.evaluate(() => ({ t: document.querySelector('#dlg') && document.querySelector('#dlg').innerText, f: !!document.querySelector('#dlg form[data-f=ccaNew]') }));
  check('7 בלי 4 ספרות: חלון "לאיזה כרטיס" עם הכרטיסים ו"＋ כרטיס חדש"', d7.f && /לאיזה כרטיס/.test(d7.t) && /ויזה עסקי/.test(d7.t), d7);
  await mp.evaluate(() => { const f = document.querySelector('#dlg form[data-f=ccaNew]'); f.elements.name.value = 'אמקס'; f.elements.last4.value = '3333'; });
  await mp.click('#dlg form[data-f=ccaNew] button'); await H.settle(mp, 400);
  const s7 = await mp.evaluate(() => { const c = S.ccc.find((x) => x.last4 === '3333'); return { c, l: c && S.stl.filter((l) => l.acc === c.id).length }; });
  check('7א כרטיס חדש "אמקס ····3333" נוצר והשורה יובאה אליו', s7.c && s7.c.name === 'אמקס' && s7.l === 1, s7);
  // כרטיס מקומי זמין באמצעי תשלום
  const pm = await mp.evaluate(() => pmX(METHODS, METHODS[3], {}));
  void pm;
  check('7ב כרטיס שנוצר בייבוא מופיע בבחירת כרטיס בטופס תשלום', /אמקס/.test(pm) && /3333/.test(pm), '');
  // ---- 7ג–7ה תיקוני סבב 1: cardL4 ושורת סיכום; כרטיס ישן מקטגוריית אשראי ----
  const l4 = await mp.evaluate(() => ({ y: cardL4('פירוט עסקאות כרטיס ויזה לחודש נובמבר 2026'), f: fileL4('cal_2026_11.xlsx'), sum: cardL4('סה"כ לחיוב בכרטיס 2345.00'), sum2: cardL4('סה"כ לחיוב בכרטיס 2,345'),
    ok1: cardL4('כרטיס ויזה ····4321'), ok2: cardL4('כרטיס המסתיים ב-8765'), ok3: cardL4('Card ending 1111'), ok4: cardL4('ויזה 5566 לחודש נובמבר 2026'), ok5: fileL4('max_8765.xlsx'),
    p: impParse([['פירוט עסקאות כרטיס ויזה לחודש נובמבר 2026'], ['תאריך', 'בית עסק', 'סכום חיוב'], ['01/11/2026', 'א', '10'], ['סה"כ לחיוב בכרטיס 2345.00', '', ''], ['02/11/2026', 'ב', '20']], 'card', impHead([['פירוט עסקאות כרטיס ויזה לחודש נובמבר 2026'], ['תאריך', 'בית עסק', 'סכום חיוב']]), 'cal_2026_11.xlsx').ok.map((x) => x.l4) }));
  check('7ג שנה (2026) בכותרת/שם קובץ ושורת סיכום (2345.00) לא נחשבות 4 ספרות של כרטיס', l4.y === '' && l4.f === '' && l4.sum === '' && l4.sum2 === '' && l4.p.join() === ',', l4);
  check('7ד 4 ספרות בהקשר כרטיס כן מזוהות (····, "המסתיים ב", ending, שם כרטיס, שם קובץ)', l4.ok1 === '4321' && l4.ok2 === '8765' && l4.ok3 === '1111' && l4.ok4 === '5566' && l4.ok5 === '8765', l4);
  const oc = await mp.evaluate(async () => { S.subs.push({ id: 'oldcc', cat: 'e_cc', name: 'ישראכרט ישן', ext: { last4: '7777' } }); save(); const n0 = (S.ccc || []).length;
    const rows = [['תאריך', 'בית עסק', 'סכום חיוב', 'כרטיס'], ['09/11/2026', 'חנות', '30', '7777'], ['10/11/2026', 'חנות2', '40', '7777']];
    impGo({ rows, kind: 'card', acc: '', fname: 'x.csv' }); await new Promise((r) => setTimeout(r, 200));
    impGo({ rows: [['תאריך', 'בית עסק', 'סכום חיוב', 'כרטיס'], ['11/11/2026', 'חנות3', '50', '7777']], kind: 'card', acc: '', fname: 'y.csv' }); await new Promise((r) => setTimeout(r, 200));
    const L = (S.ccc || []).filter((c) => c.last4 === '7777'); return { n: (S.ccc || []).length - n0, L, lines: L[0] ? S.stl.filter((l) => l.acc === L[0].id).length : 0, g: L[0] ? cardGuess({ sub: 'oldcc' }, {}).id === L[0].id : false }; });
  check('7ה כרטיס ישן (קטגוריית אשראי, 7777): נוצר כרטיס אחד בשמו ומקושר; ייבוא שני לא יוצר כפול', oc.n === 1 && oc.L.length === 1 && oc.L[0].name === 'ישראכרט ישן' && oc.L[0].sub === 'oldcc' && oc.lines === 3 && oc.g, oc);
  // ---- 9. עסקאות בתשלומים (תשובות 17:37) ----
  const i9 = await mp.evaluate(() => ({ a: insOf('תשלום 2 מתוך 3'), b: insOf('3 מתוך 12'), c: insOf('סכום 100'), d: insOf('5 מתוך 3'), sp: insSplit(100, 3), sp2: insSplit(1000, 36).slice(0, 2) }));
  check('9 זיהוי "X מתוך Y"; חלוקה שווה, אגורות לראשון', JSON.stringify(i9.a) === '{"n":2,"of":3}' && i9.b.of === 12 && i9.c === null && i9.d === null && i9.sp.join() === '33.34,33.33,33.33' && i9.sp2.join() === '28.05,27.77', i9);
  const cid = await mp.evaluate(() => { const c = ccNewLocal('2468', 'תשלומים'); S.ccMeta[c.id] = { day: 10 }; save(); return c.id; });
  await mp.evaluate(() => go('rec')); await H.settle(mp, 200);
  const CSV9 = '﻿תאריך עסקה,שם בית העסק,סכום עסקה,סכום חיוב,פירוט\n01/11/2026,רהיטי כתר,300.00,100.00,תשלום 1 מתוך 3\n';
  await up(`[data-c=recfile][data-acc=${cid}]`, 'ins.csv', Buffer.from(CSV9, 'utf8'));
  const s9 = await mp.evaluate((cid) => { const l = S.stl.find((x) => x.acc === cid && x.desc === 'רהיטי כתר'); return { ins: l && l.ins, tot: l && l.tot, nov: (cfDebits('2026-11', []).cc.find((c) => c.card === cid) || {}).a, dec: (cfDebits('2026-12', []).cc.find((c) => c.card === cid) || {}).a, jan: (cfDebits('2027-01', []).cc.find((c) => c.card === cid) || {}).a, feb: (cfDebits('2027-02', []).cc.find((c) => c.card === cid) || {}).a }; }, cid);
  check('9א שורת תשלום מהדף: ins 1/3, סכום עסקה 300; תזרים: 100 בנובמבר (מהדף), 100 צפוי בדצמבר ובינואר, כלום בפברואר', s9.ins && s9.ins.n === 1 && s9.ins.of === 3 && s9.tot === 300 && s9.nov === 100 && s9.dec === 100 && s9.jan === 100 && !s9.feb, s9);
  // הוצאה אחת
  const lid9 = await mp.evaluate((cid) => S.stl.find((x) => x.acc === cid && x.desc === 'רהיטי כתר').id, cid);
  const e9 = await mp.evaluate((lid) => { const t = stlNewExp(lid, { cat: 'e_sup', sub: 'sA' }); return { amt: t.amt, n: S.tx.filter((x) => x.note === 'רהיטי כתר').length, ins: t.ins }; }, lid9);
  check('9ב הוצאה אחת בסכום העסקה (300), לא הוצאה לכל תשלום', e9.amt === 300 && e9.n === 1 && e9.ins === 3, e9);
  // הדף הבא: תשלום 2 מתוך 3 בסכום חיוב בפועל 101 → גובר; משויך לאותה הוצאה; בלי כפילות
  const CSV9b = '﻿תאריך עסקה,שם בית העסק,סכום עסקה,סכום חיוב,פירוט\n01/11/2026,רהיטי כתר,300.00,101.00,תשלום 2 מתוך 3\n';
  await mp.evaluate(() => go('rec')); await H.settle(mp, 200);
  await up(`[data-c=recfile][data-acc=${cid}]`, 'ins2.csv', Buffer.from(CSV9b, 'utf8'));
  const s9b = await mp.evaluate((cid) => { const L = S.stl.filter((x) => x.acc === cid && x.desc === 'רהיטי כתר'); const l2 = L.find((x) => x.ins.n === 2); const t1 = S.tx.find((x) => x.id === L.find((x) => x.ins.n === 1).tx); return { n: L.length, st: l2.st, same: l2.tx === t1.id, auto: l2.auto, exps: S.tx.filter((x) => x.note === 'רהיטי כתר').length, dec: (cfDebits('2026-12', []).cc.find((c) => c.card === cid) || {}).a, jan: (cfDebits('2027-01', []).cc.find((c) => c.card === cid) || {}).a }; }, cid);
  check('9ג דף הבא: תשלום 2 משויך אוטומטית לאותה הוצאה ("לבדוק"), סכום בפועל 101 גובר בדצמבר, ינואר נשאר צפוי 100, בלי כפילות', s9b.n === 2 && s9b.st === 'match' && s9b.same && s9b.auto === 1 && s9b.exps === 1 && s9b.dec === 101 && s9b.jan === 100, s9b);
  await mp.evaluate(() => go('rec')); await H.settle(mp, 200);
  await up(`[data-c=recfile][data-acc=${cid}]`, 'ins2.csv', Buffer.from(CSV9b, 'utf8'));
  check('9ד ייבוא חוזר של אותו דף: אין שורה כפולה', (await mp.evaluate((cid) => S.stl.filter((x) => x.acc === cid && x.desc === 'רהיטי כתר').length, cid)) === 2);
  // ביטול: זיכוי באותו בית עסק → הצעה ושאלה, בלי מחיקה לבד
  const CSV9c = '﻿תאריך עסקה,שם בית העסק,סכום חיוב\n05/11/2026,ביטול רהיטי כתר,-200.00\n';
  await mp.evaluate(() => go('rec')); await H.settle(mp, 200);
  await up(`[data-c=recfile][data-acc=${cid}]`, 'cx.csv', Buffer.from(CSV9c, 'utf8'));
  const c9 = await mp.evaluate((cid) => { const l = S.stl.find((x) => x.acc === cid && x.dir === 'in'); RECT = 'n'; go('recStm', l.stm); const el = document.querySelector(`[data-lid="${l.id}"]`); return { txt: el && el.innerText, btn: !!(el && el.querySelector('[data-a=insX]')), jan: (cfDebits('2027-01', []).cc.find((c) => c.card === cid) || {}).a, x: S.insX }; }, cid);
  check('9ה זיכוי/ביטול: מוצע "לבטל את התשלומים הצפויים?" – ושום דבר לא בוטל לבד', c9.btn && /בוטלה/.test(c9.txt) && c9.jan === 100 && !c9.x, c9);
  await mp.click('[data-insc] [data-a=insX]'); await H.settle(mp, 200);
  const askd = await mp.evaluate(() => ({ open: document.getElementById('dlg').open, t: document.getElementById('dlg').innerText }));
  check('9ו לחיצה → שאלה לפני ביטול', askd.open && /לבטל את התשלומים הצפויים/.test(askd.t), askd);
  await mp.click('#dlg [data-a=yes]'); await H.settle(mp, 300);
  const c9b = await mp.evaluate((cid) => ({ jan: (cfDebits('2027-01', []).cc.find((c) => c.card === cid) || {}).a || 0, dec: (cfDebits('2026-12', []).cc.find((c) => c.card === cid) || {}).a }), cid);
  check('9ז אחרי אישור: הצפוי בינואר בוטל; מה שכבר ירד לפי הדף (דצמבר 101) נשאר', c9b.jan === 0 && c9b.dec === 101, c9b);
  // הזנה ידנית: שדה מספר תשלומים, פיצול
  const m9 = await mp.evaluate((cid) => { const h = pmX(METHODS, METHODS[3], {}); const p = pyX({ id: 'q', d: '2026-11-01', a: 100, m: METHODS[3] }, { card: cid, ins: '3' }); const p1 = pyX({ id: 'q1', d: '2026-11-01', a: 50, m: METHODS[3] }, { card: cid, ins: '40' }); const pb = pyX({ id: 'q2', d: '2026-11-01', a: 50, m: METHODS[0] }, { ins: '3' });
    S.tx.push({ id: 'mi', t: 'exp', cat: 'e_sup', sub: 'sA', date: '2026-11-01', amt: 100, kind: 'inv', plan: '2026-11', inv: 'MI', pays: [Object.assign(p, { d: '2027-03-01' })] }); save();
    const v = (m) => (cfDebits(m, []).cc.find((c) => c.card === cid) || {}).a || 0; const r = { field: /name="ins"/.test(h) && /max="36"/.test(h), ins: p.ins, bad: p1.ins, bank: pb.ins, mar: v('2027-03'), apr: v('2027-04'), may: v('2027-05'), jun: v('2027-06'), exps: S.tx.filter((x) => x.id === 'mi').length };
    S.tx = S.tx.filter((x) => x.id !== 'mi'); save(); return r; }, cid);
  check('9ח הזנה ידנית: שדה "מספר תשלומים" 1–36 באשראי בלבד; 3 תשלומים → 33.34/33.33/33.33 בחודשי החיוב; הוצאה אחת', m9.field && m9.ins === 3 && m9.bad === undefined && m9.bank === undefined && m9.mar === 33.34 && m9.apr === 33.33 && m9.may === 33.33 && m9.jun === 0 && m9.exps === 1, m9);
  // ---- 8. אין מספר מלא בשום מקום חדש ----
  const s8 = await mp.evaluate(() => JSON.stringify({ stl: S.stl, ccc: S.ccc, impMap: S.impMap, mLearn: S.mLearn, ccMeta: S.ccMeta }));
  check('8 אין רצף של 8+ ספרות בנתונים החדשים', !/\d{8,}/.test(s8.replace(/\d{4}-\d{2}-\d{2}/g, '')), '');
  check('אין שגיאות JS', !mp.__errors.length, mp.__errors);
  await browser.close();
  console.log(fail ? 'נכשלו ' + fail : 'כל הבדיקות עברו'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
