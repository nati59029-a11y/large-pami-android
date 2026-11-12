'use strict';
// זיהוי הוצאות כפולות בכל הקטגוריות (12.11.2026): ספק – כמו קודם (אותן הודעות); משכורת/קבועה – כרטיס+חודש+סכום;
// הוצאה מקופה – קופה+תאריך+סכום (+שעה אם לשתיהן); רגילה/שונות – קטגוריה+כרטיס+תאריך+סכום (שונות – גם תיאור).
// חריגים: מחוקה, ממתינה (לא בקופה), החזר, הרשומה עצמה, זיכוי/סכום<=0 (פרט לספק), שיוך לחשבונית קיימת.
// נקודות חיבור: הוספה ידנית, סריקה (זיהוי ראשון), תיבת ההוצאות (כרטיס, מסך בדיקה עם אזהרה חיה, אישור), תור החשבוניות, סגירת קופה (coAdd).
// שימוש: node ui-dup-all.js <www-dir> [out.json]
const fs = require('fs'); const H = require('./harness');
const BZ0 = ['larg', 'peami'].join('');
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
let fail = 0; const res = []; const check = (n, ok, info) => { if (!ok) fail++; res.push({ n, ok: !!ok, info }); console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 500) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const [www, out] = process.argv.slice(2);
  const browser = await H.launch(); const log = [];
  const cfg = { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: ALL } }, admins: { '|m': 1 }, staff: { '|w': 1 } };
  const { ctx, page } = await H.newPage(browser, www, cfg, log, 'm'); await page.setViewportSize({ width: 360, height: 740 });
  await H.login(page, 'm@x.co'); await sleep(600);

  // נתונים: הוצאה אחת מכל סוג
  const K = await page.evaluate(() => {
    const ex = (b) => S.cats.find((c) => c.kind === 'exp' && !c.hid && c.beh === b);
    if (!S.cats.some((c) => c.id === 'dSim')) S.cats.push({ id: 'dSim', kind: 'exp', name: 'כללי בדיקה', beh: 'simple' }); // בלי כרטיסים – במסך הבדיקה לא נבחר כרטיס אוטומטית
    const EMP = ex('emp').id, FIX = ex('fixed') ? ex('fixed').id : null, SIM = 'dSim', FREE = ex('free').id;
    const sub = (id, cat, name) => { if (!S.subs.some((x) => x.id === id)) S.subs.push({ id, cat, name }); };
    sub('dSup', 'e_sup', 'ספק כפילות'); sub('dEmp', EMP, 'עובד כפילות'); if (FIX) sub('dFix', FIX, 'שכירות כפילות');
    S.tx = S.tx.filter((t) => !/^d/.test(t.id)); S.inbox = [];
    const T = (o) => S.tx.push(Object.assign({ t: 'exp', pays: [], kind: 'inv' }, o));
    T({ id: 'dS', cat: 'e_sup', sub: 'dSup', date: '2026-10-10', amt: 300, inv: '9', plan: '2026-11' });
    T({ id: 'dE', cat: EMP, sub: 'dEmp', date: '2026-10-10', amt: 5000, plan: '2026-10', pays: [{ id: 'p1', d: '2026-10-10', a: 5000, m: 'מזומן' }] });
    if (FIX) T({ id: 'dF', cat: FIX, sub: 'dFix', date: '2026-10-01', amt: 4000, plan: '2026-10' });
    T({ id: 'dM', cat: SIM, sub: null, date: '2026-10-12', amt: 77 });
    T({ id: 'dR', cat: FREE, sub: null, date: '2026-10-12', amt: 55, desc: 'מתנה ללקוח' });
    T({ id: 'dC', cat: SIM, sub: null, date: '2026-10-13', amt: 40, co: { reg: 'i_nl', why: 'חלב', tm: '09:00' } });
    T({ id: 'dW', cat: SIM, sub: null, date: '2026-10-14', amt: 25, creg: 'i_yh', src: 'dWsrc', cowhy: 'קרח', ctm: '', await: 1 });
    T({ id: 'dX', cat: SIM, sub: null, date: '2026-10-15', amt: 33, x: 1 });
    T({ id: 'dA', cat: SIM, sub: null, date: '2026-10-16', amt: 44, await: 1 });
    save();
    return { EMP, FIX, SIM, FREE };
  });

  // 1. טבלת מקרים ישירה מול dupOf / dupMsg
  const r1 = await page.evaluate((K) => {
    const m = (c) => dupMsg(dupOf(c)).join(' | ');
    const C = (o) => Object.assign({ id: '-', sub: '', plan: '', desc: '', inv: '', reg: '', tm: '' }, o);
    return {
      supSame: m({ id: '-', sub: 'dSup', amt: 300, date: '2026-10-10', inv: '' }),
      supInv: m({ id: '-', sub: 'dSup', amt: 1, date: '2026-01-01', inv: '0009' }),
      supBeh: m({ id: '-', beh: 'sup', sub: 'dSup', amt: 300, date: '2026-10-10', inv: '9' }),
      supSelf: m({ id: 'dS', beh: 'sup', sub: 'dSup', amt: 300, date: '2026-10-10', inv: '9' }),
      empSame: m(C({ beh: 'emp', cat: K.EMP, sub: 'dEmp', amt: 5000, date: '2026-10-28', plan: '2026-10' })),
      empOtherM: m(C({ beh: 'emp', cat: K.EMP, sub: 'dEmp', amt: 5000, date: '2026-10-10', plan: '2026-11' })),
      empOtherAmt: m(C({ beh: 'emp', cat: K.EMP, sub: 'dEmp', amt: 5001, date: '2026-10-10', plan: '2026-10' })),
      fixSame: K.FIX ? m(C({ beh: 'fixed', cat: K.FIX, sub: 'dFix', amt: 4000, date: '2026-10-05', plan: '2026-10' })) : 'skip',
      fixOther: K.FIX ? m(C({ beh: 'fixed', cat: K.FIX, sub: 'dFix', amt: 4000, date: '2026-11-01', plan: '2026-11' })) : '',
      simSame: m(C({ beh: 'simple', cat: K.SIM, amt: 77, date: '2026-10-12' })),
      simOtherD: m(C({ beh: 'simple', cat: K.SIM, amt: 77, date: '2026-10-11' })),
      simOtherCat: m(C({ beh: 'simple', cat: 'p_exp', amt: 77, date: '2026-10-12' })),
      freeSame: m(C({ beh: 'free', cat: K.FREE, amt: 55, date: '2026-10-12', desc: '  מתנה   ללקוח ' })),
      freeOther: m(C({ beh: 'free', cat: K.FREE, amt: 55, date: '2026-10-12', desc: 'משהו אחר' })),
      regSame: m(C({ beh: 'simple', cat: 'p_exp', amt: 40, date: '2026-10-13', reg: 'i_nl', tm: '09:00' })),
      regNoTm: m(C({ beh: 'free', cat: K.FREE, amt: 40, date: '2026-10-13', reg: 'i_nl', tm: '' })),
      regOtherTm: m(C({ beh: 'simple', cat: 'p_exp', amt: 40, date: '2026-10-13', reg: 'i_nl', tm: '10:00' })),
      regOtherReg: m(C({ beh: 'simple', cat: 'p_exp', amt: 40, date: '2026-10-13', reg: 'i_yh', tm: '09:00' })),
      regAwait: m(C({ beh: 'simple', cat: 'p_exp', amt: 25, date: '2026-10-14', reg: 'i_yh' })),
      regSrcSelf: m(C({ beh: 'simple', cat: 'p_exp', amt: 25, date: '2026-10-14', reg: 'i_yh', src: 'dWsrc' })),
      deleted: m(C({ beh: 'simple', cat: K.SIM, amt: 33, date: '2026-10-15' })),
      awaitSim: m(C({ beh: 'simple', cat: K.SIM, amt: 44, date: '2026-10-16' })),
      self: m(C({ id: 'dM', beh: 'simple', cat: K.SIM, amt: 77, date: '2026-10-12' })),
      neg: m(C({ beh: 'simple', cat: K.SIM, amt: -77, date: '2026-10-12' })),
      zero: m(C({ beh: 'simple', cat: K.SIM, amt: 0, date: '2026-10-12' })),
      loan: m(C({ beh: 'loan', cat: K.SIM, amt: 77, date: '2026-10-12' })),
    };
  }, K);
  const SUP_SAME = 'הוצאה באותו סכום ובאותו תאריך כבר קיימת אצל הספק', SUP_INV = 'מספר החשבונית כבר קיים אצל הספק';
  check('1 ספק: ההודעות הקיימות לא השתנו (סכום+תאריך, מספר חשבונית), עם beh או בלי, והרשומה עצמה לא כפולה', r1.supSame === SUP_SAME && r1.supInv === SUP_INV && r1.supBeh === SUP_SAME + ' | ' + SUP_INV && r1.supSelf === '', r1);
  check('2 משכורת: אותו עובד+חודש+סכום – אזהרה; חודש אחר או סכום אחר – לא', /משכורת/.test(r1.empSame) && r1.empOtherM === '' && r1.empOtherAmt === '', r1);
  check('3 קבועה: אותו כרטיס+חודש+סכום – אזהרה; חודש אחר – לא', r1.fixSame === 'skip' || (/קבועה/.test(r1.fixSame) && r1.fixOther === ''), r1);
  check('4 רגילה: אותה קטגוריה+תאריך+סכום – אזהרה; תאריך אחר או קטגוריה אחרת – לא', /בקטגוריה/.test(r1.simSame) && r1.simOtherD === '' && r1.simOtherCat === '', r1);
  check('5 שונות: רק עם אותו תיאור (בלי תלות ברווחים)', /תיאור/.test(r1.freeSame) && r1.freeOther === '', r1);
  check('6 הוצאה מקופה: אותה קופה+תאריך+סכום – אזהרה (גם בלי שעה, גם בקטגוריה אחרת, גם מול ממתינה לחשבונית); שעה אחרת / קופה אחרת / אותו מסמך – לא', /מקופה/.test(r1.regSame) && /מקופה/.test(r1.regNoTm) && r1.regOtherTm === '' && r1.regOtherReg === '' && /מקופה/.test(r1.regAwait) && r1.regSrcSelf === '', r1);
  check('7 חריגים: מחוקה, ממתינה (לא קופה), הרשומה עצמה, זיכוי/0, הלוואה – לא כפולים', r1.deleted === '' && r1.awaitSim === '' && r1.self === '' && r1.neg === '' && r1.zero === '' && r1.loan === '', r1);

  // 2. הוספה ידנית: אזהרה חיה בטופס + askDup בשמירה, "שמור בכל זאת" שומר פעם אחת
  const r2 = await page.evaluate(async (K) => {
    const W = (ms) => new Promise((r) => setTimeout(r, ms || 80));
    A = { type: 'exp', cat: K.SIM, step: 'det' }; sheetDraw(); const f = document.querySelector('#sheet form[data-f=addsave]');
    const set = (n, v) => { f.elements[n].value = v; f.elements[n].dispatchEvent(new Event('change', { bubbles: true })); };
    set('amt', '77'); set('date', '2026-10-12'); const live1 = f.querySelector('[data-dupn]').innerText;
    set('amt', '78'); const live2 = f.querySelector('[data-dupn]').innerText; set('amt', '77');
    const same = document.querySelector('#sheet form[data-f=addsave]') === f;
    const n0 = S.tx.length; FRM.addsave(f, { submitter: { value: 'done' } }); await W();
    const dlg = document.querySelector('#dlg[open]') ? document.getElementById('dlg').innerText : ''; const n1 = S.tx.length;
    document.querySelector('#dlg[open] [data-a=yes]').click(); await W();
    const n2 = S.tx.length; sheetClose();
    // משכורת: חודש משכורת זהה
    A = { type: 'exp', cat: K.EMP, sub: 'dEmp', step: 'det' }; sheetDraw(); const g = document.querySelector('#sheet form[data-f=addsave]');
    const sg = (n, v) => { if (!g.elements[n]) return; g.elements[n].value = v; g.elements[n].dispatchEvent(new Event('change', { bubbles: true })); };
    sg('amt', '5000'); sg('date', '2026-10-30'); sg('plan', '2026-10'); const liveE = g.querySelector('[data-dupn]').innerText; sheetClose();
    return { live1, live2, same, dlg, n1: n1 - n0, n2: n2 - n0, liveE };
  }, K);
  check('8 הוספה ידנית: אזהרה מופיעה בטופס מיד כשהסכום והתאריך זהים, ונעלמת כשהסכום משתנה (בלי ציור מחדש)', /בקטגוריה/.test(r2.live1) && r2.live2 === '' && r2.same, r2);
  check('9 הוספה ידנית: בשמירה – חלון "המסמך כבר קיים", לא נשמר עד "שמור בכל זאת", ואז נשמר פעם אחת', /כבר קיים/.test(r2.dlg) && r2.n1 === 0 && r2.n2 === 1, r2);
  // 2ב (תיקון 7). עריכה בטופס addsave (A.edit; עריכה מפרטי תנועה עוברת ב-FRM.tsave, בלי בדיקת כפילות): בלי שינוי בשדות הכפילות – אין חלון; שינוי שיוצר כפילות – חלון עם "בטל את השינוי", והרשומה לא משתנה
  const r2b = await page.evaluate(async (K) => {
    const W = (ms) => new Promise((r) => setTimeout(r, ms || 80));
    const dupT0 = S.tx.filter((t) => t.cat === K.SIM && t.amt === 77 && t.date === '2026-10-12').pop();
    A = { type: 'exp', cat: K.SIM, step: 'det', edit: dupT0.id }; sheetDraw(); await W(); let f = document.querySelector('#sheet form[data-f=addsave]');
    f.elements.note.value = 'הערה חדשה'; FRM.addsave(f, { submitter: { value: 'done' } }); await W();
    const dlg1 = !!document.querySelector('#dlg[open]'); if (dlg1) closeDlg(); try { sheetClose(); } catch (e) { /* */ }
    const note1 = S.tx.find((t) => t.id === dupT0.id).note;
    S.tx.push({ id: 'dEd2', t: 'exp', cat: K.SIM, date: '2026-10-14', amt: 91, note: 'אחרת', pays: [] }); save(); const before = JSON.stringify(S.tx.find((t) => t.id === 'dEd2'));
    A = { type: 'exp', cat: K.SIM, step: 'det', edit: 'dEd2' }; sheetDraw(); await W(); f = document.querySelector('#sheet form[data-f=addsave]');
    f.elements.amt.value = '77'; f.elements.date.value = '2026-10-12'; FRM.addsave(f, { submitter: { value: 'done' } }); await W();
    const d2 = document.querySelector('#dlg[open]') ? document.getElementById('dlg').innerText : ''; const b = document.querySelector('#dlg[open] [data-a=dupDel]'); const btn = b ? b.innerText : '';
    if (b) b.click(); await W(); const same = JSON.stringify(S.tx.find((t) => t.id === 'dEd2')) === before; const sheetOpen = !!document.querySelector('#sheet.open, #sheet[open]');
    S.tx = S.tx.filter((t) => t.id !== 'dEd2'); save();
    return { dlg1, note1, d2: d2.slice(0, 80), btn, same, sheetOpen };
  }, K);
  check('9ב עריכה: שינוי הערה בלבד – אין חלון כפילות ונשמר; שינוי סכום+תאריך שיוצר כפילות – חלון עם "בטל את השינוי", והרשומה לא השתנתה',
    !r2b.dlg1 && r2b.note1 === 'הערה חדשה' && /כבר קיים/.test(r2b.d2) && /בטל את השינוי/.test(r2b.btn) && !/מחק/.test(r2b.btn) && r2b.same, r2b);
  check('10 הוספה ידנית של משכורת: אותו עובד+חודש+סכום – אזהרה בטופס', /משכורת/.test(r2.liveE), r2.liveE);

  // 3. סריקה: זיהוי ראשון – scanDlg (ספק) ו-usFillForm (סורק אחיד)
  const r3 = await page.evaluate(async () => {
    A = { type: 'exp', cat: 'e_sup', step: 'scan', pg: [], hi: [] };
    OC = { res: { sup: { id: 'dSup' }, date: '2026-10-10', amt: { v: 300, sure: 1 }, inv: '9' }, img0: '', npg: 1 };
    scanDlg(); const n1 = document.querySelector('#dlg form[data-f=scanok] [data-dupn]').innerText;
    const f = document.querySelector('#dlg form[data-f=scanok]'); f.elements.inv.value = '10'; f.elements.amt.value = '301'; f.elements.amt.dispatchEvent(new Event('change', { bubbles: true }));
    const n2 = f.querySelector('[data-dupn]').innerText; closeDlg(); OC = null;
    A = { type: 'exp', cat: 'e_sup', sub: 'dSup', step: 'det', us: 1, usf: 1 }; const U0 = US;
    US = { cls: { ty: 'invoice', docType: 'invoice', f: { total_with_vat: 300, date: '2026-10-10', number: '9' } }, unsure: [] };
    sheetDraw(); usFillForm(document.getElementById('sheet')); const n3 = document.querySelector('#sheet form[data-f=addsave] [data-dupn]').innerText;
    US = U0; sheetClose();
    return { n1, n2, n3 };
  });
  check('11 סריקה (scanDlg): אזהרה מוצגת מיד אחרי מילוי הזיהוי (בהודעות הקיימות של הספק), ומתעדכנת כשמשנים שדות', r3.n1.includes(SUP_SAME) && r3.n1.includes(SUP_INV) && r3.n2 === '', r3);
  check('12 סריקה (usFillForm): אזהרה מוצגת בטופס מיד אחרי המילוי', r3.n3.includes(SUP_INV), r3);

  // 4. תיבת ההוצאות: כרטיס, מסך בדיקה עם אזהרה חיה, אישור עם askDup פעם אחת, הוצאה מקופה
  const r4 = await page.evaluate(async (K) => {
    const W = (ms) => new Promise((r) => setTimeout(r, ms || 100));
    const it = (id, d) => ({ id, by: 'עובד בדיקה', at: '2026-10-20T09:00:00Z', d });
    S.inbox = [it('iM', { cat: K.SIM, amt: 77, date: '2026-10-12', note: 'א' }), it('iN', { cat: K.SIM, amt: 70, date: '2026-10-12', note: 'ב' }),
      it('iE', { cat: K.EMP, sub: 'dEmp', amt: 5000, date: '2026-10-30', plan: '2026-10', m: 'מזומן' }),
      it('iR', { reg: true, creg: 'i_nl', cat: K.SIM, amt: 40, date: '2026-10-13', note: 'חלב', ctm: '09:00' }),
      it('iQ1', { reg: true, creg: 'i_yh', cat: K.SIM, amt: 12, date: '2026-10-20', note: 'לחם' }), it('iQ2', { reg: true, creg: 'i_yh', amt: 12, date: '2026-10-20', note: 'לחמניות' })];
    save(); NAV = [{ v: 'home' }, { v: 'todo' }]; go('inbox');
    const cardTxt = (id) => { const b = document.querySelector(`#main [data-id=${id}]`); const c = b && b.closest('.card'); return c ? [...c.querySelectorAll('.scnote.bad')].map((x) => x.innerText).join(' | ') : 'nocard'; };
    const cards = { iM: cardTxt('iM'), iN: cardTxt('iN'), iE: cardTxt('iE'), iQ2: dupMsg(dupInbox(S.inbox.find((x) => x.id === 'iQ2'))).join() };
    // מסך הבדיקה: iN (70) – אין אזהרה; משנים ל-77 – אזהרה חיה, אותו חלון
    ACT.inbEdit({ dataset: { id: 'iN' } }); await W(); const f = document.querySelector('#dlg[open] form[data-f=inbsave]'); const e0 = document.getElementById('inbDup').innerText;
    f.elements.amt.value = '77'; f.elements.amt.dispatchEvent(new Event('change', { bubbles: true })); const e1 = document.getElementById('inbDup').innerText;
    const sameF = document.querySelector('#dlg[open] form[data-f=inbsave]') === f;
    f.elements.amt.value = '70'; f.elements.amt.dispatchEvent(new Event('change', { bubbles: true })); const e2 = document.getElementById('inbDup').innerText; closeDlg();
    // אישור iM: askDup פעם אחת, "אשר בכל זאת" – נוצרת הוצאה אחת
    const n0 = S.tx.length; await ACT.inbOk({ dataset: { id: 'iM' } }); await W(); const a1 = document.querySelector('#dlg[open] [data-a=yes]') ? document.getElementById('dlg').innerText : '';
    document.querySelector('#dlg[open] [data-a=yes]').click(); await W(); const a2 = !!document.querySelector('#dlg[open] [data-a=yes]'); const nM = S.tx.filter((t) => t.src === 'iM').length;
    // פריט מקופה: "שמור ואשר" → inbRegFin → inbOk({co}) → askDup פעם אחת
    ACT.inbEdit({ dataset: { id: 'iR' } }); await W(); const r0 = document.getElementById('inbDup').innerText;
    document.querySelector('#dlg[open] [data-a=inbSaveOk]').click(); await W(200);
    const rD = document.querySelector('#dlg[open] [data-a=yes]') ? document.getElementById('dlg').innerText : ''; document.querySelector('#dlg[open] [data-a=yes]') && document.querySelector('#dlg[open] [data-a=yes]').click(); await W(200);
    const rD2 = !!document.querySelector('#dlg[open] [data-a=yes]'); const R = S.tx.filter((t) => t.src === 'iR');
    // "מחק את המסמך החדש" בפריט משכורת כפול
    await ACT.inbOk({ dataset: { id: 'iE' } }); await W(); const eD = document.querySelector('#dlg[open] [data-a=dupDel]') ? document.getElementById('dlg').innerText : '';
    document.querySelector('#dlg[open] [data-a=dupDel]').click(); await W();
    return { cards, e0, e1, e2, sameF, n: S.tx.length - n0, a1, a2, nM, r0, rD, rD2, R: R.map((t) => ({ creg: t.creg, amt: t.amt })), eD, eGone: !S.inbox.some((x) => x.id === 'iE') && !S.tx.some((t) => t.src === 'iE') };
  }, K);
  check('13 כרטיס בתיבה: אזהרה לכל סוג (רגילה, משכורת), בלי אזהרה כשאין כפילות; פריט מול פריט אחר בתיבה (קופה, בלי קטגוריה)', /בקטגוריה/.test(r4.cards.iM) && r4.cards.iN === '' && /משכורת/.test(r4.cards.iE) && /מקופה/.test(r4.cards.iQ2), r4.cards);
  check('14 מסך הבדיקה: אזהרה חיה (#inbDup) מתעדכנת בשינוי ידני של הסכום, בלי לצייר מחדש את החלון', r4.e0 === '' && /בקטגוריה/.test(r4.e1) && r4.e2 === '' && r4.sameF, r4);
  check('15 אישור מהתיבה (רגילה): חלון כפילות פעם אחת, "אשר בכל זאת" – הוצאה אחת', /כבר קיים/.test(r4.a1) && !r4.a2 && r4.nM === 1, r4);
  check('16 פריט מקופה – "שמור ואשר": אזהרה במסך, חלון כפילות פעם אחת (דרך inbRegFin), ואחרי אישור נרשמה הוצאה אחת עם creg', /מקופה/.test(r4.r0) && /מקופה/.test(r4.rD) && !r4.rD2 && r4.R.length === 1 && r4.R[0].creg === 'i_nl', r4);
  check('17 משכורת כפולה מהתיבה: "מחק את המסמך החדש" – לא נרשם ונמחק מהתיבה', /משכורת/.test(r4.eD) && r4.eGone, r4);

  // 5. שיוך לחשבונית קיימת (inbInvOk) – לא נוצרת הוצאה, בלי חלון כפילות
  const r5 = await page.evaluate(async () => {
    const W = (ms) => new Promise((r) => setTimeout(r, ms || 100));
    S.tx.push({ id: 'dInv', t: 'exp', cat: 'e_sup', sub: 'dSup', date: '2026-10-18', amt: 90, inv: '77', plan: '2026-11', pays: [], kind: 'inv' });
    S.inbox.push({ id: 'iL', by: 'עובד', at: '2026-10-20T09:00:00Z', d: { reg: true, creg: 'i_nl', cat: 'e_sup', sub: 'dSup', amt: 90, date: '2026-10-18', note: 'ספק' } }); save();
    const n0 = S.tx.length; inbRegFin('iL'); await W(); const offer = !!document.querySelector('#dlg[open] [data-a=inbInvOk][data-t=dInv]');
    document.querySelector('#dlg[open] [data-a=inbInvOk][data-t=dInv]').click(); await W();
    return { offer, n: S.tx.length - n0, dlg: !!document.querySelector('#dlg[open]'), pays: S.tx.find((t) => t.id === 'dInv').pays.length };
  });
  check('18 שיוך לחשבונית קיימת: אין חלון כפילות ולא נוצרת הוצאה (רק תשלום)', r5.offer && r5.n === 0 && !r5.dlg && r5.pays === 1, r5);

  // 6. תור החשבוניות (bqSaveOne): כפול לא נשמר אוטומטית
  const r6 = await page.evaluate(() => {
    const it = { id: 'bq1', cat: 'e_sup', f: { sub: 'dSup', inv: '9', date: '2026-10-10', amt: '300', plan: '2026-11', note: '' } };
    const ok = bqSaveOne(it); return { ok, err: it.err, dupok: it.dupok };
  });
  check('19 תור החשבוניות: כפילות לא נשמרת אוטומטית, עם ההודעה הקיימת', r6.ok === false && r6.dupok === 0 && r6.err.includes(SUP_INV), r6);

  // 7. סגירת קופה – הוצאה מקופה של המנהל (coAdd)
  const r7 = await page.evaluate(async () => {
    const W = (ms) => new Promise((r) => setTimeout(r, ms || 150));
    ZC = { id: 'zDup', reg: 'i_nl', f: Object.assign(zcEmpty(), { d: '2026-10-13', tm: '22:00', cout: '0' }) };
    ACT.coAdd(); await W(); const f = document.querySelector('#dlg[open] form[data-f=coAdd]'); if (!f) return { noform: true };
    f.elements.a.value = '40'; f.elements.why.value = 'חלב'; f.elements.d.value = '2026-10-13'; f.elements.tm.value = '';
    const n0 = S.tx.length; await FRM.coAdd(f); await W(); const d1 = document.querySelector('#dlg[open] [data-a=yes]') ? document.getElementById('dlg').innerText : ''; const n1 = S.tx.length;
    if (d1) { document.querySelector('#dlg[open] [data-a=yes]').click(); await W(400); }
    return { d1, n1: n1 - n0, n2: S.tx.length - n0 };
  });
  check('20 סגירת קופה (coAdd): אותה קופה+תאריך+סכום – חלון כפילות, לא נשמר עד אישור, ואז נשמר פעם אחת', /מקופה/.test(r7.d1) && r7.n1 === 0 && r7.n2 === 1, r7);

  check('21 אין שגיאות JS', page.__errors.length === 0, page.__errors);
  // 12.11: שינוי ידני של הוצאה קיימת (פרטי תנועה / ממתין לסיווג) – אזהרה חיה + חלון באישור; "בטל את השינוי" לא משנה
  const rE = await page.evaluate(async () => {
    const W = (ms) => new Promise((r) => setTimeout(r, ms || 120)), ex = S.cats.find((c) => c.kind === 'exp' && c.beh === 'simple');
    S.tx.push({ id: 'eA', t: 'exp', cat: ex.id, date: '2026-10-05', amt: 70, pays: [], kind: 'inv' }, { id: 'eB', t: 'exp', cat: ex.id, date: '2026-10-06', amt: 71, pays: [], kind: 'inv' },
      { id: 'eP1', t: 'exp', cat: 'p_exp', date: '2026-10-07', amt: 33, pays: [], kind: 'inv' }, { id: 'eP2', t: 'exp', cat: 'p_exp', date: '2026-10-07', amt: 34, pays: [], kind: 'inv' }); save();
    const setV = (n, v) => { const f = document.querySelector('#dlg form'); f.elements[n].value = v; f.elements[n].dispatchEvent(new Event('change', { bubbles: true })); };
    ACT.txEdit({ dataset: { id: 'eB' } }); await W(); setV('note', 'רק הערה'); const live0 = document.querySelector('#dlg [data-dupn]').innerText;
    setV('amt', '70'); setV('date', '2026-10-05'); await W(); const live1 = document.querySelector('#dlg [data-dupn]').innerText;
    document.querySelector('#dlg form button:not([type=button])').click(); await W(); const d1 = document.querySelector('#dlg[open]').innerText;
    document.querySelector('#dlg [data-a=dupDel]').click(); await W(); const b0 = S.tx.find((t) => t.id === 'eB');
    ACT.txEdit({ dataset: { id: 'eB' } }); await W(); setV('amt', '70'); setV('date', '2026-10-05'); document.querySelector('#dlg form button:not([type=button])').click(); await W();
    document.querySelector('#dlg [data-a=yes]').click(); await W(300); const b1 = S.tx.find((t) => t.id === 'eB');
    ACT.txEdit({ dataset: { id: 'eP2' } }); await W(); setV('amt', '33'); await W(); const liveP = document.querySelector('#dlg [data-dupn]').innerText;
    document.querySelector('#dlg form button').click(); await W(); const dP = !!document.querySelector('#dlg [data-a=dupDel]'); closeDlg();
    return { live0, live1, d1: d1.slice(0, 200), b0: [b0.amt, b0.date], b1: [b1.amt, b1.date], liveP, dP, p2: S.tx.find((t) => t.id === 'eP2').amt };
  });
  check('22 שינוי ידני בפרטי תנועה: הערה בלבד – אין אזהרה; שינוי סכום+תאריך לכפילות – אזהרה חיה וחלון; "בטל את השינוי" לא משנה; "שמור בכל זאת" שומר',
    !rE.live0 && /כבר קיימת/.test(rE.live1) && /בטל את השינוי/.test(rE.d1) && rE.b0.join() === '71,2026-10-06' && rE.b1.join() === '70,2026-10-05', rE);
  check('23 שינוי ידני ב"ממתין לסיווג": שינוי סכום לכפילות – אזהרה חיה וחלון, והשינוי לא נשמר עד אישור', /כבר קיימת/.test(rE.liveP) && rE.dP && rE.p2 === 34, rE);

  await ctx.close(); await browser.close();
  if (out) fs.writeFileSync(out, JSON.stringify({ fail, res }, null, 1));
  console.log(fail ? `נכשלו ${fail}` : 'הכול עבר'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
