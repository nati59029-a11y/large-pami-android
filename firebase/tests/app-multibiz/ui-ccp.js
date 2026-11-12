'use strict';
// חשבונית ספק ששולמה באשראי (12.11.2026): זיהוי בטקסט, שאלה אחרי כפילות ו-awOffer, כרטיס לפי 4 ספרות, תשלומים, סכום חלקי + השלמה במזומן מהקופה,
// "לא" – נשארת פתוחה, בלי כרטיסים, תור חשבוניות, סריקה רגילה, סריקה מאוחדת, דף אשראי מתחבר לתשלום הקיים, ccBills, מסך ccx, נתונים ישנים לא משתנים.
// שימוש: NODE_PATH=... node ui-ccp.js <www-dir> [out.json]
const fs = require('fs'); const H = require('./harness');
const BZ0 = ['larg', 'peami'].join('');
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
let fail = 0; const res = []; const check = (n, ok, info) => { if (!ok) fail++; res.push({ n, ok: !!ok, info }); console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 500) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ORG = { v: 1, branches: [], banks: [{ id: 'bka', name: 'לאומי', last4: '1234', on: true, sig: [] }],
  cards: [{ id: 'cv', name: 'ויזה עסקי', last4: '5678', bank: 'bka', on: true, sig: [] }, { id: 'cm', name: 'מקס', last4: '4321', bank: 'bka', on: true, sig: [] }] };

(async () => {
  const [www, out] = process.argv.slice(2);
  const browser = await H.launch(); const log = [];
  const cfg = { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: ALL } }, admins: { '|m': 1 }, staff: { '|w': 1 } };
  const { ctx, page } = await H.newPage(browser, www, cfg, log, 'm'); await page.setViewportSize({ width: 360, height: 740 });
  await H.login(page, 'm@x.co'); await sleep(600);

  // נתונים: ספקים, כרטיסים, ורשומה ישנה שאסור שתשתנה
  const old = await page.evaluate((ORG) => {
    S.orgC = ORG; S.ccc = []; S.stm = []; S.stl = []; S.ccx = []; S.inbox = [];
    S.subs = S.subs.filter((s) => !/^c[A-Z]/.test(s.id));
    ['cS', 'cA', 'cB', 'cN', 'cW', 'cQ', 'cU'].forEach((id) => S.subs.push({ id, cat: 'e_sup', name: 'ספק ' + id }));
    S.tx = S.tx.filter((t) => !/^c/.test(t.id));
    S.tx.push({ id: 'cOld', t: 'exp', cat: 'e_sup', sub: 'cS', date: '2026-09-01', amt: 250, inv: 'O1', plan: '2026-10', kind: 'inv', pays: [{ id: 'po', d: '2026-09-02', a: 250, m: 'אשראי' }] });
    save(); return JSON.stringify(S.tx.find((t) => t.id === 'cOld'));
  }, ORG);

  // 1. זיהוי בטקסט (גיבוי)
  const r1 = await page.evaluate(() => {
    const p = (t) => { const o = parseInv(t, []); return { ccp: !!o.ccp, cc4: o.cc4 || '', ccn: o.ccn || 0 }; };
    return {
      yes: p('חשבונית מס 55\nשולם באשראי כרטיס ****5678\n3 תשלומים\nסה"כ 100'),
      pm: p('אמצעי תשלום: ויזה\nסה"כ 100'),
      net: p('תנאי תשלום: אשראי 30 יום\nסה"כ 100'),
      plain: p('אשראי\nסה"כ 100'),
      full: p('שולם באשראי 4580123456785678'),
      merge: mergeInv([parseInv('חשבונית 1', []), parseInv('שולם בכרטיס אשראי xxxx4321', [])]),
      dn: mergeInv([parseInv('תעודת משלוח\nשולם באשראי', [])]).ccp || false,
      h: ccpH({ ccp: true, cc4: '4580 1234 5678 9876', ccn: '40', cca: '1,000' }), hNo: ccpH({ ccp: 'false', cc4: '1234' }),
    };
  });
  check('1 זיהוי בטקסט: "שולם באשראי" + 4 ספרות + תשלומים; "אמצעי תשלום: ויזה"; לא "אשראי 30 יום" ולא "אשראי" לבד; מספר מלא לא נשמר',
    r1.yes.ccp && r1.yes.cc4 === '5678' && r1.yes.ccn === 3 && r1.pm.ccp && !r1.net.ccp && !r1.plain.ccp && r1.full.ccp && r1.full.cc4 === '5678' /* תיקון 6: 4 אחרונות של רצף מספר כרטיס; המספר המלא לא נשמר */ && r1.merge.ccp && r1.merge.cc4 === '4321' && !r1.dn, r1);
  check('2 ccpH: רק 4 ספרות אחרונות, תשלומים 2–36 בלבד, ccp לא-בוליאני נדחה', r1.h.cc4 === '9876' && !r1.h.ccn && r1.h.cca === 1000 && !r1.hNo.ccp && !JSON.stringify(r1.h).includes('4580'), r1.h);

  const W = 'var W=(ms)=>new Promise((r)=>setTimeout(r,ms||150));';
  const it = (id, sub, amt, x) => Object.assign({ id, by: 'עובד', at: '2026-11-01T09:00:00Z', d: Object.assign({ cat: 'e_sup', catName: '', sub, subName: '', amt, date: '2026-11-01', inv: 'I' + id, plan: '2026-11' }, x || {}) });

  // 3. תיבת ההוצאות: ccp + 4 ספרות → הכרטיס הנכון, יתרה 0
  const r3 = await page.evaluate(async (a) => {
    eval(a.W); S.inbox.push(a.i); save();
    await ACT.inbOk({ dataset: { id: 'iC1' } }); await W();
    const f = document.querySelector('#dlg[open] form[data-f=ccpok]'); const sel = f && f.elements.card ? f.elements.card.value : 'none'; const txt = f ? document.getElementById('dlg').innerText : '';
    const n0 = S.tx.filter((t) => t.src === 'iC1').length; f.requestSubmit(); await W();
    const t = S.tx.find((x) => x.src === 'iC1'); return { sel, txt: txt.slice(0, 80), n0, pays: t && t.pays, bal: t && bal(t), due: t && t.due, inbox: S.inbox.some((x) => x.id === 'iC1'), dlg: !!document.querySelector('#dlg[open]') };
  }, { W, i: it('iC1', 'cS', 500, { ccp: true, cc4: '4321' }) });
  const p3 = (r3.pays || [])[0] || {};
  check('3 תיבה: שאלה לפני שמירה, ברירת מחדל הכרטיס עם אותן 4 ספרות; "כן" = תשלום {אשראי, card, ivc:1}, יתרה 0, בלי due', r3.sel === 'cm' && r3.n0 === 0 && r3.pays.length === 1 && p3.m === 'אשראי' && p3.card === 'cm' && p3.ivc === 1 && p3.a === 500 && r3.bal === 0 && !r3.due && !r3.inbox && !r3.dlg, r3);

  // 4. תשלומים מהזיהוי
  const r4 = await page.evaluate(async (a) => {
    eval(a.W); S.inbox.push(a.i); save(); await ACT.inbOk({ dataset: { id: 'iC2' } }); await W();
    const f = document.querySelector('#dlg[open] form[data-f=ccpok]'); const ins = f.elements.ins.value, sel = f.elements.card.value; f.requestSubmit(); await W();
    const t = S.tx.find((x) => x.src === 'iC2'); return { ins, sel, p: t.pays[0] };
  }, { W, i: it('iC2', 'cA', 900, { ccp: true, cc4: '5678', ccn: 3 }) });
  check('4 תשלומים: "3 תשלומים" ממולא מראש ונשמר כ-p.ins=3', r4.ins === '3' && r4.sel === 'cv' && r4.p.ins === 3 && r4.p.card === 'cv', r4);

  // 5. סכום חלקי + השלמה במזומן מהקופה
  const r5 = await page.evaluate(async (a) => {
    eval(a.W); S.inbox.push(a.i); save(); await ACT.inbOk({ dataset: { id: 'iC3' } }); await W();
    const f = document.querySelector('#dlg[open] form[data-f=ccpok]'); const a0 = f.elements.a.value; f.requestSubmit(); await W();
    const g = document.querySelector('#dlg[open] form[data-f=ccpco]'); const txt = document.getElementById('dlg').innerText; if (!g) return { a0, nog: 1, txt };
    g.elements.creg.value = 'i_nl'; g.requestSubmit(); await W();
    const t = S.tx.find((x) => x.src === 'iC3'); const cp = t.pays[1] || {}; const cm = coMine().find((x) => x.id === cp.src); const cw = coWant()[cp.src];
    return { a0, txt: txt.slice(0, 120), pays: t.pays, bal: bal(t), cm, cw: cw && { w: cw.w || 0, a: cw.f.a, reg: cw.f.reg } };
  }, { W, i: it('iC3', 'cB', 1000, { ccp: true, cc4: '5678', cca: 600 }) });
  const c5 = (r5.pays || [])[1] || {};
  check('5 סכום חלקי: ברירת מחדל 600 מתוך 1000, שלב השלמה; השלמה במזומן = תשלום {מזומן, creg, cowhy, src} – יתרה 0, נספר ב-coMine ונוצר בענן (בלי w)',
    r5.a0 === '600' && r5.pays && r5.pays[0].a === 600 && r5.pays[0].ivc === 1 && c5.m === 'מזומן' && c5.a === 400 && c5.creg === 'i_nl' && c5.cowhy === 'השלמה לתשלום באשראי' && /^mcp/.test(c5.src) && r5.bal === 0 && r5.cm && r5.cm.a === 400 && r5.cm.reg === 'i_nl' && r5.cw && !r5.cw.w && r5.cw.a === 400, r5);

  // 6. סכום חלקי – להשאיר פתוח; "לא" – נשארת פתוחה; שני כרטיסים בלי 4 ספרות – לא נבחר
  const r6 = await page.evaluate(async (a) => {
    eval(a.W); S.inbox.push(...a.i); save();
    await ACT.inbOk({ dataset: { id: 'iC4' } }); await W(); let f = document.querySelector('#dlg[open] form[data-f=ccpok]'); f.elements.a.value = '300'; f.requestSubmit(); await W();
    document.querySelector('#dlg[open] [data-a=ccpOpen]').click(); await W(); const t4 = S.tx.find((x) => x.src === 'iC4');
    await ACT.inbOk({ dataset: { id: 'iC5' } }); await W(); document.querySelector('#dlg[open] [data-a=ccpNo]').click(); await W(); const t5 = S.tx.find((x) => x.src === 'iC5');
    await ACT.inbOk({ dataset: { id: 'iC6' } }); await W(); f = document.querySelector('#dlg[open] form[data-f=ccpok]'); const sel = f.elements.card.value; f.requestSubmit(); await W(); const t6 = S.tx.find((x) => x.src === 'iC6');
    return { p4: t4.pays, b4: bal(t4), p5: t5.pays, b5: bal(t5), sel, p6: t6.pays[0] };
  }, { W, i: [it('iC4', 'cN', 800, { ccp: true }), it('iC5', 'cN', 700, { ccp: true }), it('iC6', 'cN', 610, { ccp: true })] });
  check('6א סכום חלקי – "להשאיר פתוח": תשלום אשראי 300 בלבד, יתרה 500 אצל הספק', r6.p4.length === 1 && r6.p4[0].a === 300 && r6.b4 === 500, r6);
  check('6ב "לא, רק חשבונית": בלי תשלום, יתרה מלאה', r6.p5.length === 0 && r6.b5 === 700, r6);
  check('6ג שני כרטיסים בלי 4 ספרות: לא נבחר כרטיס, התשלום בלי card', r6.sel === '' && r6.p6 && r6.p6.m === 'אשראי' && !('card' in r6.p6), r6);

  // 7. בלי כרטיסים – בלי בורר, בלי card
  const r7 = await page.evaluate(async (a) => {
    eval(a.W); const o = S.orgC; S.orgC = Object.assign({}, o, { cards: [] }); S.inbox.push(a.i); save();
    await ACT.inbOk({ dataset: { id: 'iC7' } }); await W(); const f = document.querySelector('#dlg[open] form[data-f=ccpok]'); const hasSel = !!(f && f.elements.card); f.requestSubmit(); await W();
    S.orgC = o; save(); const t = S.tx.find((x) => x.src === 'iC7'); return { hasSel, p: t.pays[0] };
  }, { W, i: it('iC7', 'cN', 120, { ccp: true }) });
  check('7 בלי כרטיסים: אין בורר; התשלום נרשם בלי card', !r7.hasSel && r7.p && r7.p.m === 'אשראי' && !('card' in r7.p), r7);

  // 8. סדר: כפילות → awOffer → שאלת אשראי; ובלי ccp – אין שאלה
  const r8 = await page.evaluate(async (a) => {
    eval(a.W); S.tx.push({ id: 'cAw', t: 'exp', cat: 'e_sup', sub: 'cW', date: '2026-10-20', amt: 333, inv: '', plan: '2026-10', kind: 'inv', await: 1, pays: [{ id: 'paw', d: '2026-10-20', a: 333, m: 'העברה' }], note: 'מקדמה' });
    S.tx.push({ id: 'cDp', t: 'exp', cat: 'e_sup', sub: 'cQ', date: '2026-11-01', amt: 444, inv: 'Q1', plan: '2026-11', kind: 'inv', pays: [] });
    S.inbox.push(...a.i); save();
    await ACT.inbOk({ dataset: { id: 'iC8' } }); await W(); const aw = !!document.querySelector('#dlg[open] [data-a=awNew]'); document.querySelector('#dlg[open] [data-a=awNew]').click(); await W();
    const cp8 = !!document.querySelector('#dlg[open] form[data-f=ccpok]'); document.querySelector('#dlg[open] [data-a=ccpNo]').click(); await W();
    await ACT.inbOk({ dataset: { id: 'iC9' } }); await W(); const dup = !!document.querySelector('#dlg[open] [data-a=dupDel]'); document.querySelector('#dlg[open] [data-a=yes]').click(); await W();
    const cp9 = !!document.querySelector('#dlg[open] form[data-f=ccpok]'); if (cp9) document.querySelector('#dlg[open] [data-a=ccpNo]').click(); await W();
    await ACT.inbOk({ dataset: { id: 'iC10' } }); await W(); const cp10 = !!document.querySelector('#dlg[open] form[data-f=ccpok]');
    return { aw, cp8, dup, cp9, cp10, n8: S.tx.filter((t) => t.src === 'iC8').length, n10: S.tx.filter((t) => t.src === 'iC10').length };
  }, { W, i: [it('iC8', 'cW', 333, { ccp: true }), it('iC9', 'cQ', 444, { ccp: true, inv: 'Q1' }), it('iC10', 'cU', 50)] });
  check('8 סדר: awOffer קודם, ואחרי "הוצאה חדשה" – שאלת אשראי; כפילות קודם ואחריה השאלה; בלי ccp – אין שאלה', r8.aw && r8.cp8 && r8.n8 === 1 && r8.dup && r8.cp9 && !r8.cp10 && r8.n10 === 1, r8);

  // 9. מסך הבדיקה: תיבת סימון ידנית d.ccp
  const r9 = await page.evaluate(async (a) => {
    eval(a.W); S.inbox.push(a.i); save(); ACT.inbEdit({ dataset: { id: 'iC11' } }); await W();
    const f = document.querySelector('#dlg[open] form[data-f=inbsave]'); const has = !!(f && f.elements.ccp); const chk0 = has && f.elements.ccp.checked;
    f.elements.ccp.checked = true; f.elements.amt.dispatchEvent(new Event('change', { bubbles: true })); await W();
    const f2 = document.querySelector('#dlg[open] form[data-f=inbsave]'); const kept = f2.elements.ccp.checked; f2.requestSubmit(); await W();
    const d1 = S.inbox.find((x) => x.id === 'iC11').d.ccp;
    ACT.inbEdit({ dataset: { id: 'iC11' } }); await W(); document.querySelector('#dlg[open] [data-a=inbSaveOk]').click(); await W(300);
    const q = !!document.querySelector('#dlg[open] form[data-f=ccpok]'); if (q) document.querySelector('#dlg[open] form[data-f=ccpok]').requestSubmit(); await W();
    const t = S.tx.find((x) => x.src === 'iC11');
    S.inbox.push(Object.assign({}, a.i, { id: 'iC12', d: Object.assign({}, a.i.d, { reg: true, creg: 'i_yh', inv: '' }) })); ACT.inbEdit({ dataset: { id: 'iC12' } }); await W();
    const regBox = !!document.querySelector('#dlg[open] form[data-f=inbsave] [name=ccp]'); closeDlg(); S.inbox = S.inbox.filter((x) => x.id !== 'iC12'); save();
    return { has, chk0, kept, d1, q, p: t && t.pays[0], regBox };
  }, { W, i: it('iC11', 'cU', 70) });
  check('9 מסך הבדיקה: תיבה "בחשבונית כתוב ששולם באשראי" (לא מסומנת), נשמרת ב-d.ccp, "שמור ואשר" שואל ורושם; בהוצאה מקופה אין תיבה', r9.has && !r9.chk0 && r9.kept && r9.d1 === true && r9.q && r9.p && r9.p.ivc === 1 && !r9.regBox, r9);

  // 10. דף אשראי: השורה מתחברת לתשלום הקיים (p.stl) בלי רשומה חדשה; ccBills כולל
  const r10 = await page.evaluate(() => {
    // סכום ייחודי (בנתוני הדמו יש הוצאה אחרת של 500 – היא הייתה מועמד שני ו-stlAuto לא מקשר כשיש שניים)
    const t = ccpApply({ id: 'cStl', t: 'exp', cat: 'e_sup', sub: 'cS', date: '2026-11-01', amt: 517.37, inv: 'L1', plan: '2026-11', kind: 'inv', pays: [] }, { a: 517.37, card: 'cm', ins: 1 }); S.tx.push(t); save();
    const p = t.pays[0], n0 = S.tx.length;
    const st = stmAdd({ kind: 'card', acc: 'cm', src: 'file' }, [{ date: '2026-11-03', desc: 'ספק cS', amt: 517.37, dir: 'out' }]);
    const l = S.stl.find((x) => x.stm === st.id); const C = stlCands(l).map((c) => ({ t: c.t.id, p: c.p && c.p.id, s: c.s }));
    const r = stlAuto(st.id);
    S.ccMeta = Object.assign({}, S.ccMeta || {}, { cm: { day: 10 } });
    const B = ['2026-11', '2026-12'].flatMap((m) => ccBills(m)).filter((b) => b.card === 'cm');
    return { C: C.slice(0, 3), r, st: l.st, lpay: l.pay, pstl: p.stl === l.id, nNew: S.tx.length - n0, bills: B.map((b) => ({ d: b.date, a: b.a })) };
  });
  check('10 דף אשראי: מועמד = התשלום הקיים; stlAuto מקשר (p.stl) בלי רשומה חדשה; ccBills כולל את התשלום', r10.C[0] && r10.C[0].p && r10.st === 'match' && r10.pstl && r10.nNew === 0 && r10.bills.some((b) => b.a >= 1017.37), r10);

  // 11. מסך ccx הישן: חיוב מתחבר לתשלום אשראי קיים (p.cc) במקום תשלום חדש
  const r11 = await page.evaluate(async () => {
    const t = S.tx.find((x) => x.src === 'iC6'), p = t.pays[0], n = t.pays.length;
    S.ccx.push({ id: 'cx9', sub: '', date: '2026-11-05', desc: 'ספק cN', amt: 610, match: '', exp: '' });
    const C = ccCands(S.ccx.find((x) => x.id === 'cx9')); const c = C.find((x) => x.p && x.p.id === p.id);
    ACT.ccMatch({ dataset: { id: 'cx9' } }); const btn = document.querySelector('#dlg[open] [data-a=ccDoMatch][data-p="' + p.id + '"]'); const txt = btn ? btn.innerText : '';
    if (btn) btn.click(); await new Promise((r) => setTimeout(r, 150));
    return { cand: !!c, txt, cc: p.cc, n2: t.pays.length - n, match: S.ccx.find((x) => x.id === 'cx9').match === t.id };
  });
  check('11 מסך ccx: "תשלום אשראי קיים" מוצע; התאמה כותבת p.cc ולא מוסיפה תשלום', r11.cand && /קיים/.test(r11.txt) && r11.cc === 'cx9' && r11.n2 === 0 && r11.match, r11);

  // 12. תור חשבוניות
  const r12 = await page.evaluate(() => {
    const mk = (id, res) => { const it = { id, cat: 'e_sup', pg: ['x'], hi: [], fid: 'f' + id, st: 'ok' }; bqInit(it, res); return it; };
    const base = (sub, a, x) => Object.assign({ sup: { id: sub, cat: 'e_sup' }, inv: 'B' + a, date: '2026-11-02', amt: { v: a, sure: 1 }, dn: false }, x);
    const a = mk('bq1', base('cA', 210, { ccp: true, cc4: '4321' })), b = mk('bq2', base('cA', 220, { ccp: true, cca: 100 })), c = mk('bq3', base('cA', 230, {}));
    const html = bqCard(a);
    const ok1 = bqSaveOne(a), t1 = S.tx.find((t) => t.file === 'fbq1');
    const ok2 = bqSaveOne(b), e2 = b.err, ok2b = bqSaveOne(b), t2 = S.tx.find((t) => t.file === 'fbq2');
    const ok3 = bqSaveOne(c), t3 = S.tx.find((t) => t.file === 'fbq3');
    return { f1: { cp: a.f.cp, card: a.f.card }, box: /שולם באשראי/.test(html), ok1, p1: t1 && t1.pays, ok2, e2, ok2b, p2: t2 && t2.pays, cp3: c.f.cp, ok3, p3: t3 && t3.pays };
  });
  check('12 תור חשבוניות: תיבה + כרטיס ממולאים מראש; אישור רושם תשלום אשראי; סכום חלקי – לא אוטומטי, הודעה "סכום חלקי – פתח לבדיקה", ואישור נוסף שומר בלי תשלום; בלי ccp – בלי תשלום',
    r12.f1.cp === '1' && r12.f1.card === 'cm' && r12.box && r12.ok1 && r12.p1.length === 1 && r12.p1[0].ivc === 1 && r12.p1[0].card === 'cm' && !r12.ok2 && /סכום חלקי/.test(r12.e2) && r12.ok2b && r12.p2.length === 0 && r12.cp3 === '' && r12.ok3 && r12.p3.length === 0, r12);

  // 13. סריקה רגילה (scanok) וסריקה מאוחדת (addsave)
  const r13 = await page.evaluate(async (a) => {
    eval(a.W);
    A = { type: 'exp', cat: 'e_sup', step: 'scan', pg: [], hi: [], fid: 'fsc1' };
    OC = { res: { sup: { id: 'cU', cat: 'e_sup' }, date: '2026-11-04', amt: { v: 321, sure: 1 }, inv: 'S321', ccp: true, cc4: '5678' }, img0: '', npg: 1 };
    scanDlg(); document.querySelector('#dlg form[data-f=scanok]').requestSubmit(); await W();
    const q1 = document.querySelector('#dlg[open] form[data-f=ccpok]'); const s1 = q1 && q1.elements.card.value; if (q1) q1.requestSubmit(); await W();
    const t1 = S.tx.find((t) => t.inv === 'S321'); OC = null;
    A = { type: 'exp', cat: 'e_sup', sub: 'cU', step: 'det', us: 1, usf: 1 }; const U0 = US;
    US = { cls: { ty: 'invoice', docType: 'invoice', f: { total_with_vat: 654, date: '2026-11-04', number: 'U654', paid_by_card: true, card_last4: '4321', installments: 2 } }, unsure: [] };
    sheetDraw(); usFillForm(document.getElementById('sheet')); const f = document.querySelector('#sheet form[data-f=addsave]'); const ccpA = A.ccp;
    FRM.addsave(f, { submitter: { value: 'done' } }); await W();
    const q2 = document.querySelector('#dlg[open] form[data-f=ccpok]'); const s2 = q2 && q2.elements.card.value, i2 = q2 && q2.elements.ins.value; if (q2) q2.requestSubmit(); await W();
    US = U0; const t2 = S.tx.find((t) => t.inv === 'U654'); try { sheetClose(); } catch (e) { /* */ }
    return { s1, p1: t1 && t1.pays, ccpA, s2, i2, p2: t2 && t2.pays };
  }, { W });
  check('13 סריקה רגילה (scanok) ומאוחדת (addsave): שאלה עם הכרטיס לפי 4 ספרות; נרשם תשלום אשראי (כולל תשלומים מהזיהוי)',
    r13.s1 === 'cv' && r13.p1 && r13.p1[0].card === 'cv' && r13.p1[0].ivc === 1 && r13.ccpA && r13.s2 === 'cm' && r13.i2 === '2' && r13.p2 && r13.p2[0].ins === 2, r13);

  // 14. תצוגה + נתונים ישנים
  const r14 = await page.evaluate((old) => {
    const t = S.tx.find((x) => x.src === 'iC1'); txDlg(t.id); const txt = document.getElementById('dlg').innerText; closeDlg();
    return { txt: /לפי החשבונית/.test(txt) && /מקס/.test(txt), same: JSON.stringify(S.tx.find((x) => x.id === 'cOld')) === old, cmine: coMine().filter((c) => /^mcp/.test(c.id)).length };
  }, old);
  check('14 תצוגה: "(לפי החשבונית) · שם הכרטיס"; הרשומה הישנה לא השתנתה', r14.txt && r14.same, r14);

  // 16. (תיקון 1) תור: מספר תשלומים מוצג בכרטיס, ניתן לשינוי – רק הערך המוצג נשמר (גם ב"אישור הכול"); ערך לא תקין – שגיאה
  const r16 = await page.evaluate(async (a) => {
    eval(a.W);
    const mk = (id, res) => { const it = { id, cat: 'e_sup', pg: ['x'], hi: [], fid: 'f' + id, st: 'ok' }; bqInit(it, res); return it; };
    const base = (a, x) => Object.assign({ sup: { id: 'cA', cat: 'e_sup' }, inv: 'N' + a, date: '2026-11-02', amt: { v: a, sure: 1 }, dn: false }, x);
    const i1 = mk('bq16', base(916, { ccp: true, ccn: 3 })), i2 = mk('bq17', base(917, { ccp: true, ccn: 3 }));
    const html = bqCard(i1); const shown = (/data-k="ccn" value="3"/.test(html) && /מספר תשלומים/.test(html));
    i2.f.ccn = '40'; const ok2 = bqSaveOne(i2), e2 = i2.err;
    BQ = [i1]; bqDraw(); await W(); const inp = document.querySelector('#dlg[open] [data-bq="bq16"] [data-k="ccn"]'); const vis = !!(inp && inp.offsetParent);
    inp.value = '4'; ACT.bqAll(); await W(); closeDlg();
    const t = S.tx.find((x) => x.file === 'fbq16'); return { shown, vis, ok2, e2, p: t && t.pays };
  }, { W });
  check('16 תור: "מספר תשלומים" מוצג (3 מהזיהוי), שינוי ל-4 נשמר ב"אישור הכול"; 40 – שגיאה ולא נשמר', r16.shown && r16.vis && !r16.ok2 && /תשלומים/.test(r16.e2) && r16.p && r16.p[0].ins === 4, r16);

  // 17. (תיקון 2) הוצאה מקופה – לא שואלים על אשראי
  const r17 = await page.evaluate(async (a) => {
    eval(a.W);
    const need = ccpNeed({ t: 'exp', cat: 'e_sup', sub: 'cU', amt: 77, kind: 'inv', pays: [], co: { reg: 'i_nl' } }, { ccp: true }) || ccpNeed({ t: 'exp', cat: 'e_sup', sub: 'cU', amt: 77, kind: 'inv', pays: [], creg: 'i_nl' }, { ccp: true });
    A = { type: 'exp', cat: 'e_sup', sub: 'cU', step: 'det', ccp: { ccp: true } }; sheetDraw();
    let f = document.querySelector('#sheet form[data-f=addsave]'); const hasCo = !!f.elements.co;
    if (hasCo) { f.elements.co.checked = true; f.elements.co.dispatchEvent(new Event('change', { bubbles: true })); await W(); f = document.querySelector('#sheet form[data-f=addsave]'); }
    const e = f.elements; e.amt.value = '77'; e.date.value = today(); e.inv.value = 'CO77'; if (e.co) e.co.checked = true; if (e.creg) e.creg.value = 'i_nl'; if (e.cowhy) e.cowhy.value = 'x';
    FRM.addsave(f, { submitter: { value: 'done' } }); await W();
    const asked = !!document.querySelector('#dlg[open] form[data-f=ccpok]'); if (asked) closeDlg();
    const t = S.tx.find((x) => x.inv === 'CO77'); try { sheetClose(); } catch (er) { /* */ }
    return { need, hasCo, asked, co: t && t.co, pays: t && t.pays };
  }, { W });
  check('17 הוצאה מקופה (co/creg): ccpNeed=false, בשמירה אין שאלת אשראי ואין תשלום אשראי', !r17.need && r17.hasCo && !r17.asked && r17.co && r17.co.reg === 'i_nl' && !(r17.pays || []).some((p) => p.m === 'אשראי'), r17);

  // 18. (תיקון 3) חיוב כרטיס ידני (קטגוריית cc) מתחבר לחשבונית ששולמה באשראי – p.cc, בלי תשלום חדש
  const r18 = await page.evaluate(async (a) => {
    eval(a.W); if (!S.cats.some((c) => c.id === 'e_ccT')) S.cats.push({ id: 'e_ccT', kind: 'exp', name: 'חיובי אשראי', beh: 'cc' });
    const inv = ccpApply({ id: 'cLk', t: 'exp', cat: 'e_sup', sub: 'cS', date: '2026-11-01', amt: 431.5, inv: 'LK1', plan: '2026-11', kind: 'inv', pays: [] }, { a: 431.5, card: 'cv', ins: 1 }); S.tx.push(inv); save();
    A = { type: 'exp', cat: 'e_ccT', step: 'det' }; sheetDraw(); const f = document.querySelector('#sheet form[data-f=addsave]');
    const opt = f && f.elements.link ? [...f.elements.link.options].some((o) => o.value === 'cLk') : false;
    f.elements.amt.value = '431.5'; f.elements.date.value = '2026-11-06'; f.elements.link.value = 'cLk';
    const n0 = S.tx.length; FRM.addsave(f, { submitter: { value: 'done' } }); await W();
    let dup = false; if (document.querySelector('#dlg[open] [data-a=yes]')) { dup = true; document.querySelector('#dlg[open] [data-a=yes]').click(); await W(); }
    const ch = S.tx.slice(n0).find((x) => x.cat === 'e_ccT'); try { sheetClose(); } catch (er) { /* */ }
    return { opt, dup, n: S.tx.length - n0, ch: ch && { x: ch.x, link: ch.link, id: ch.id }, pays: inv.pays.map((p) => ({ a: p.a, cc: p.cc, ivc: p.ivc })), bal: bal(inv) };
  }, { W });
  check('18 חיוב ידני בקטגוריית אשראי: החשבונית ששולמה באשראי מוצעת; בחירה כותבת p.cc על התשלום הקיים, החיוב x=1/link, בלי תשלום חדש',
    r18.opt && r18.n === 1 && r18.ch && r18.ch.x === 1 && r18.ch.link === 'cLk' && r18.pays.length === 1 && r18.pays[0].cc === r18.ch.id && r18.bal === 0, r18);

  // 19. (תיקון 4) השלמה במזומן בתקופת קופה סגורה – בתאריך היום; אם גם היום חסום – לא נרשמת, היתרה פתוחה
  const r19 = await page.evaluate(async (a) => {
    eval(a.W); const z0 = S.zc; const out = {};
    const run = async (id, zd, amt) => {
      S.zc = [{ id: 'z' + id, reg: 'i_nl', d: zd, tm: '22:00', tx: [], co: { z: 0, s: 0, ids: [], ok: 1, done: 1 } }]; S.inbox.push(Object.assign({ id, by: 'עובד', at: '2026-11-01T09:00:00Z', d: { cat: 'e_sup', catName: '', sub: 'cB', subName: '', amt, date: '2026-10-25', inv: 'I' + id, plan: '2026-11', ccp: true, cc4: '5678', cca: amt - 400 } })); save();
      await ACT.inbOk({ dataset: { id } }); await W(); const q = document.querySelector('#dlg[open] form[data-f=ccpok]'); if (!q) return { noq: (document.getElementById('dlg').open ? document.getElementById('dlg').innerText : 'closed').slice(0, 200) }; q.requestSubmit(); await W();
      const g = document.querySelector('#dlg[open] form[data-f=ccpco]'); g.elements.creg.value = 'i_nl'; g.requestSubmit(); await W(300);
      const t = S.tx.find((x) => x.src === id); return { pays: t && t.pays.map((p) => ({ a: p.a, m: p.m, d: p.d, creg: p.creg })), bal: t && bal(t), toast: (document.querySelector('#toast') || {}).innerText || '' };
    };
    out.a = await run('iC19', '2026-11-01', 1019); out.b = await run('iC20', '2099-01-01', 1020); out.today = today(); S.zc = z0; save(); return out;
  }, { W });
  const c19 = ((r19.a.pays || [])[1]) || {};
  check('19 השלמה במזומן: תאריך החשבונית בתקופה סגורה – נרשמת בתאריך היום; גם היום חסום – לא נרשמת, יתרה 400 פתוחה',
    c19.m === 'מזומן' && c19.d === r19.today && c19.a === 400 && r19.a.bal === 0 && (r19.b.pays || []).length === 1 && r19.b.pays[0].m === 'אשראי' && r19.b.bal === 400, r19);

  // 20. (תיקון 5) תור: סכום חלקי – הודעה וכפתור לחלון ההשלמה במזומן
  const r20 = await page.evaluate(async (a) => {
    eval(a.W);
    const it = { id: 'bq20', cat: 'e_sup', pg: ['x'], hi: [], fid: 'fbq20', st: 'ok' }; bqInit(it, { sup: { id: 'cA', cat: 'e_sup' }, inv: 'P20', date: today(), amt: { v: 920, sure: 1 }, dn: false, ccp: true, cca: 500 });
    it.f.cp = '1'; BQ = [it]; bqDraw(); await W();
    const txt = document.querySelector('#dlg[open] [data-bq="bq20"]').innerText; document.querySelector('#dlg[open] [data-a=bqCpCo]').click(); await W();
    const g = document.querySelector('#dlg[open] form[data-f=ccpco]'); if (!g) return { txt, nog: 1 }; g.elements.creg.value = 'i_nl'; g.requestSubmit(); await W(300);
    const t = S.tx.find((x) => x.file === 'fbq20'); const back = !!document.querySelector('#dlg[open] [data-bqhead]'); closeDlg();
    return { msg: /להשלמה במזומן פתח את החשבונית/.test(txt), pays: t && t.pays.map((p) => ({ a: p.a, m: p.m, creg: p.creg, ivc: p.ivc })), bal: t && bal(t), q: BQ.length, back };
  }, { W });
  check('20 תור, סכום חלקי: הודעה "להשלמה במזומן פתח את החשבונית" + כפתור; השלמה מהקופה – אשראי 500 + מזומן 420, יתרה 0, הוסר מהתור',
    r20.msg && r20.pays && r20.pays.length === 2 && r20.pays[0].a === 500 && r20.pays[0].ivc === 1 && r20.pays[1].m === 'מזומן' && r20.pays[1].a === 420 && r20.pays[1].creg === 'i_nl' && r20.bal === 0 && r20.q === 0, r20);

  // 21. (תיקון 6) 4 ספרות: מספר כרטיס מלא בקבוצות, סכום עשרוני / ₪ – לא
  const r21 = await page.evaluate(() => {
    const p = (t) => { const o = parseInv(t, []); return o.cc4 || ''; };
    return { grp: p('שולם באשראי\nכרטיס 4580 1234 5678 9012'), dec: p('שולם באשראי: 1250.00'), shk: p('שולם באשראי 1250 ₪'), mask: p('שולם בכרטיס אשראי ****9876 סה"כ 2500.00'), xx: p('שולם באשראי xxxx-xxxx-xxxx-7788'), comma: p('שולם בכרטיס 1234, 3 תשלומים') };
  });
  check('21 4 ספרות: "4580 1234 5678 9012"→9012; "1250.00" / "1250 ₪" – לא; מיסוך ****9876→9876; xxxx-…-7788; "1234," → 1234',
    r21.grp === '9012' && r21.dec === '' && r21.shk === '' && r21.mask === '9876' && r21.xx === '7788' && r21.comma === '1234', r21);

  check('15 אין שגיאות JS', page.__errors.length === 0, page.__errors);
  await ctx.close(); await browser.close();
  if (out) fs.writeFileSync(out, JSON.stringify({ fail, res }, null, 1));
  console.log(fail ? `נכשלו ${fail}` : 'הכול עבר'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
