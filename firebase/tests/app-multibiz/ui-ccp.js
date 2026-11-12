'use strict';
// חשבונית ספק ששולמה באשראי (12.11.2026): זיהוי בטקסט, שאלה אחרי כפילות ו-awOffer, כרטיס לפי 4 ספרות, תשלומים, סכום חלקי + השלמה במזומן מהקופה,
// דף הוצאה מקופה להשלמה במזומן (22–27), "לא" – נשארת פתוחה, בלי כרטיסים, תור חשבוניות, סריקה רגילה, סריקה מאוחדת, דף אשראי מתחבר לתשלום הקיים, ccBills, מסך ccx, נתונים ישנים לא משתנים.
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

  // 22–27. דף הוצאה מקופה להשלמה במזומן (12.11): צירוף בחלון ההשלמה; בלי דף – סימון בסגירה, עובד חייב הסבר או צילום, המנהל רואה ב"דורש אישור" ויכול לאשר; צירוף מהסגירה; הוצאות אחרות לא מושפעות
  const JPG = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 40; c.height = 60; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 40, 60); g.fillStyle = '#000'; g.fillRect(5, 5, 20, 10); return c.toDataURL('image/jpeg').split(',')[1]; });
  const FILE = { name: 'slip.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(JPG, 'base64') };
  const SETUP = `var W=(ms)=>new Promise((r)=>setTimeout(r,ms||150));
    var NS='חסר דף הוצאה מקופה';
    var part=async(id,amt)=>{S.inbox.push({id,by:'עובד',at:'2026-11-01T09:00:00Z',d:{cat:'e_sup',catName:'',sub:'cB',subName:'',amt,date:'2026-11-01',inv:'I'+id,plan:'2026-11',ccp:true,cc4:'5678',cca:amt-400}});save();
      await ACT.inbOk({dataset:{id}});await W();document.querySelector('#dlg[open] form[data-f=ccpok]').requestSubmit();await W();};
    var mir=(src)=>{const w=coWant()[src];return w&&Object.assign({id:src,uid:'m',by:'מנהל',t:1,dep:'',zc:'',dp:''},w.f)};
    var payOf=(id)=>{const t=S.tx.find((x)=>x.src===id);return t&&t.pays.find((p)=>/^mcp/.test(p.src||''))};
    var zcSet=(cout)=>{ZC=zcNew();ZC.reg='i_nl';ZC.z=[window.DU,window.DU,window.DU];ZC.o=window.DU;ZC.f=zcClean({d:'2026-11-20',tm:'22:00',no:'77',cash:'1000',total:'1000',cout:String(cout),drawer:'500',oTot:'500',oD:'2026-11-20',oTm:'07:00'});};
    var stub=()=>{const L={calls:[],pages:{}};window.__fsx0=window.__fsx0||fsx;window.fsx=async(p,o)=>{L.calls.push([p,o&&o.body]);if(/^\\/zlast\\//.test(p)&&!(o&&o.method))throw Object.assign(new Error('nf'),{code:404});
      const m=p.match(/^\\/closings\\/([^/]+)\\/p\\?documentId=(\\d+)/);if(m){L.pages[m[2]]=JSON.parse(o.body).fields.data.stringValue}const g=p.match(/^\\/closings\\/([^/?]+)\\/p\\/(\\d+)$/);if(g&&window.__pg)return{fields:{data:{stringValue:window.__pg[g[2]]}}};return{}};return L};
    var unstub=()=>{if(window.__fsx0)window.fsx=window.__fsx0};
    var commitOf=(L)=>{const c=L.calls.find((x)=>x[0]===':commit');return c&&JSON.parse(c[1]).writes[0].update.fields};
    var toastT=()=>[...document.querySelectorAll('.toast')].map((e)=>e.textContent).join(' | ');`;
  const z0 = await page.evaluate((J) => { window.DU = 'data:image/jpeg;base64,' + J; const z = JSON.stringify(S.zc || []); window.__z0 = z; S.zc = []; ZL.i_nl = null; return 1; }, JPG);

  // 22. צירוף בחלון ההשלמה (מצלמה / גלריה)
  await page.evaluate(async (a) => { eval(a.S); await part('iC22', 1022); }, { S: SETUP });
  await page.setInputFiles('#dlg[open] form[data-f=ccpco] input[data-c=ccpPic]:not([capture])', FILE); await sleep(500);
  const r22 = await page.evaluate(async (a) => {
    eval(a.S); const prev = !!document.querySelector('#ccpPic img'); const g = document.querySelector('#dlg[open] form[data-f=ccpco]'); g.elements.creg.value = 'i_nl'; g.requestSubmit(); await W(400);
    const p = payOf('iC22') || {}; const du = p.file ? await fget(p.file) : ''; const m = mir(p.src) || {}; const cm = coMine().find((x) => x.id === p.src);
    return { prev, file: p.file || '', img: imgOk(du), why: m.why, lf: cm ? coLFile(cm) : '', zs: zsCoFile({ id: p.src, src: p.src }), ver: coVer(m), miss: coSlipMiss(m) };
  }, { S: SETUP });
  check('22 צירוף דף בחלון ההשלמה: תצוגה מקדימה, p.file נשמר במכשיר, הסיבה בענן בלי סימון, coLFile/zsCoFile מציגים אותו, coVer סופר, לא "חסר דף"',
    r22.prev && /^z/.test(r22.file) && r22.img && r22.why === 'השלמה לתשלום באשראי' && r22.lf === r22.file && r22.zs === r22.file && r22.ver && !r22.miss, r22);

  // 23. בלי דף – מנהל: תג + כפתור בסגירה, zcNeed; (בעל העסק 12.11) לא נשמרת בשקט – רק אחרי "המשך ללא התאמה" (אישור), ואז self + nsx + תג בסיכום
  const r23 = await page.evaluate(async (a) => {
    eval(a.S); await part('iC23', 1023); const g = document.querySelector('#dlg[open] form[data-f=ccpco]'); g.elements.creg.value = 'i_nl'; g.requestSubmit(); await W(400); const t0 = toastT();
    const p = payOf('iC23'); const m = mir(p.src); COQ.L = [m]; zcSet(400);
    const co = coChk('i_nl', ZC.f.d, ZC.f.tm, ZC.f.cout, { id: '' }); const h = zcCoH();
    const it = { reg: 'i_nl', f: ZC.f, c: zcCalc(ZC.f, 'i_nl'), co, nsp: [], nw: '' }; const need = zcNeed(it);
    const L = stub(); const n0 = S.zc.length; let blk, tb, ask = '', h2 = '', zs = '', zsd = ''; try { await FRM.zcSend({}); await W(); blk = S.zc.length === n0; tb = toastT();
      ACT.zcNsx(); await W(); ask = document.getElementById('dlg').innerText; document.querySelector('#dlg[open] [data-a=yes]').click(); await W(800); h2 = zcCoH(); } finally { unstub(); } await W();
    const z = S.zc[S.zc.length - 1] || {};
    window.fsx = async (q) => (/runQuery|batchGet/.test(q) ? [] : {}); try { ZS.D = {}; await zsLoad('2026-11'); const D = ZS.D['2026-11']; const row = D.L.find((x) => x.id === z.id); ZS.open = z.id; zs = row ? zsRowH(row, D) : 'none'; } finally { unstub(); ZS.open = ''; ZS.D = {}; }
    const out = { file: p.file || '', why: m.why, t0, ns: co.ns.length, ok: co.ok, tag: h.includes(NS) && h.includes('data-a="coSlip"') && h.includes('data-a="zcNsx"'), need: need.filter((x) => x.startsWith(NS)), blk, tb, ask: ask.slice(0, 200), saved: S.zc.length === n0 + 1, ap: z.ap, ids: (z.co && z.co.ids) || [], src: p.src, nsx: z.nsx,
      zsTag: zs.includes('נסגר ללא דף הוצאה מקופה (המשך ללא התאמה) · ' + ils(400)), zsBtn: zs.includes('data-a="coSlip"') };
    S.tx = S.tx.filter((t) => t.src !== 'zc:' + z.id); S.zc = []; save(); return out;
  }, { S: SETUP });
  check('23 בלי דף: הסיבה בענן "… · חסר דף הוצאה מקופה", הודעה; מנהל בסגירה – תג + "צלם / צרף דף" + "המשך ללא התאמה", zcNeed מציין; בלי צירוף לא נשמרת; אחרי "המשך ללא התאמה" (אישור) – נשמרת (self), nsx, משייכת, ובסיכום תג "נסגר ללא דף…" + כפתור צירוף',
    !r23.file && /· חסר דף הוצאה מקופה$/.test(r23.why) && /בלי דף/.test(r23.t0) && r23.ns === 1 && r23.ok && r23.tag && r23.need.length === 1 && r23.blk && /המשך ללא התאמה/.test(r23.tb) && /להמשיך ללא התאמה\? חסר דף/.test(r23.ask) && r23.saved && r23.ap === 'self' && r23.ids.includes(r23.src)
    && r23.nsx && r23.nsx.ids.length === 1 && r23.nsx.ids[0] === r23.src && r23.nsx.a === 400 && r23.nsx.by && r23.nsx.at > 0 && r23.zsTag && r23.zsBtn, r23);

  // 24. עובד: רואה את הסימון (מהסיבה בענן) + כפתור; בלי צילום ובלי הסבר – לא נשלחת; עם הסבר – נשלחת (nw)
  const r24 = await page.evaluate(async (a) => {
    eval(a.S); const p = payOf('iC23'); COQ.L = [mir(p.src)]; const role = SY.role; SY.role = 'worker'; const out = {};
    try { zcSet(400); const h = zcCoH(); out.tag = h.includes(NS) && h.includes('data-a="coSlipW"') && h.includes('data-i="zcNw"') && !h.includes('zcNsx') && !h.includes('המשך ללא התאמה');
      let L = stub(); try { await FRM.zcSend({}); } finally { unstub(); } out.t1 = toastT(); out.c1 = !!commitOf(L);
      zcSet(400); ZC.nw = 'הדף נשאר בקופה'; L = stub(); try { await FRM.zcSend({}); } finally { unstub(); } const f = commitOf(L); out.d2 = f && JSON.parse(f.data.stringValue); out.st = f && f.st.stringValue;
    } finally { SY.role = role; } return out;
  }, { S: SETUP });
  check('24 עובד: תג "חסר דף" + כפתור + תיבת הסבר; בלי צילום ובלי הסבר – לא נשלחת (הודעה); עם הסבר – נשלחת לאישור (st=new) עם nw',
    r24.tag && /חסר דף הוצאה מקופה/.test(r24.t1) && !r24.c1 && r24.d2 && r24.d2.nw === 'הדף נשאר בקופה' && r24.st === 'new', r24);

  // 25. עובד מצרף צילום מהסגירה → נשלחת בלי הסבר, הצילום בתמונות הסגירה; מנהל: zcNeed מציין, ובאישור הצילום נכתב על התשלום ושניהם מאושרים
  await page.evaluate(async (a) => { eval(a.S); const p = payOf('iC23'); COQ.L = [mir(p.src)]; window.__role = SY.role; SY.role = 'worker'; zcSet(400); ACT.coSlipW({ dataset: { src: p.src } }); await W(); }, { S: SETUP });
  await page.setInputFiles('#dlg[open] input[data-c=coSlipWF]:not([capture])', FILE); await sleep(500);
  const r25 = await page.evaluate(async (a) => {
    eval(a.S); const p = payOf('iC23'); const out = {};
    try { out.nsp = !!(ZC.nsp && ZC.nsp[p.src]); const h = zcCoH(); out.h = h.includes('הדף צורף לסגירה') && !h.includes('data-i="zcNw"');
      const L = stub(); try { await FRM.zcSend({}); } finally { unstub(); } const f = commitOf(L); out.d = f && JSON.parse(f.data.stringValue); out.np = f && +f.np.integerValue;
      const all = Object.keys(L.pages).sort().map((k) => L.pages[k]).join(''); out.pics = JSON.parse(all.slice(6)).length; window.__pg = L.pages; window.__doc = { fields: f }; out.id = L.calls.find((x) => x[0] === ':commit') && JSON.parse(L.calls.find((x) => x[0] === ':commit')[1]).writes[0].update.name.split('/').pop();
    } finally { SY.role = window.__role; }
    const it = zcParse(window.__doc, out.id); it.co = coChk(it.reg, it.f.d, it.f.tm, it.f.cout, { id: it.id, inc: it.inc, od: it.f.oD, otm: it.f.oTm }); it.need.push(...zcNsNeed(it));
    out.need = it.need.filter((x) => x.startsWith(NS)); out.itNsp = it.nsp; ZQ.L = [it]; ZQP = [];
    const L2 = stub(); try { await ACT.zcOk({ dataset: { id: it.id } }); await W(); const y = document.querySelector('#dlg[open] [data-a=yes]'); out.ask = y ? document.getElementById('dlg').innerText.slice(0, 400) : ''; if (y) { y.click(); await W(800); } } finally { unstub(); }
    const z = S.zc.find((x) => x.id === it.id) || {}; out.file = p.file || ''; out.img = p.file ? imgOk(await fget(p.file)) : false; out.ids = (z.co && z.co.ids) || []; out.src = p.src; out.why = (mir(p.src) || {}).why;
    S.tx = S.tx.filter((t) => t.src !== 'zc:' + it.id); S.zc = []; ZQ.L = []; save(); return out;
  }, { S: SETUP });
  check('25 עובד צירף צילום: נשלחת בלי הסבר, nsp + 5 תמונות; מנהל: "חסר דף · העובד צירף צילום"; אישור – הצילום נכתב על התשלום, הסגירה נרשמת ומשייכת את ההשלמה, הסימון בענן יורד',
    r25.nsp && r25.h && r25.d && (r25.d.nsp || []).length === 1 && !r25.d.nw && r25.pics === 5 && r25.need.length === 1 && /העובד צירף צילום/.test(r25.need[0]) && /חסר דף/.test(r25.ask) && /^z/.test(r25.file) && r25.img && r25.ids.includes(r25.src) && r25.why === 'השלמה לתשלום באשראי', r25);

  // 29. (בעל העסק 12.11) אישור סגירה של עובד שעדיין חסר בה דף (רק הסבר): לא מאשרים ישר – חלון "צרף / המשך ללא התאמה"; המשך – נרשמת עם nsx; צירוף מאוחר – הסיכום מציג "צורף"
  const r29 = await page.evaluate(async (a) => {
    eval(a.S); await part('iC29', 1029); const g = document.querySelector('#dlg[open] form[data-f=ccpco]'); g.elements.creg.value = 'i_nl'; g.requestSubmit(); await W(400); closeDlg();
    const p = payOf('iC29'); COQ.L = [mir(p.src)]; const out = {}; const role = SY.role; SY.role = 'worker'; let doc, id;
    try { zcSet(400); ZC.nw = 'אין דף'; const L = stub(); try { await FRM.zcSend({}); } finally { unstub(); } const f = commitOf(L); doc = { fields: f }; id = JSON.parse(L.calls.find((x) => x[0] === ':commit')[1]).writes[0].update.name.split('/').pop(); } finally { SY.role = role; }
    const it = zcParse(doc, id); it.co = coChk(it.reg, it.f.d, it.f.tm, it.f.cout, { id: it.id, inc: it.inc, od: it.f.oD, otm: it.f.oTm }); it.need.push(...zcNsNeed(it)); ZQ.L = [it]; ZQP = [];
    const L2 = stub(); try {
      await ACT.zcOk({ dataset: { id } }); await W(); const d1 = document.getElementById('dlg'); out.d1 = !document.querySelector('#dlg[open] [data-a=yes]') && !!d1.querySelector('[data-a=coSlip]') && !!d1.querySelector('[data-a=zcNsxQ]'); out.n1 = S.zc.filter((x) => x.id === id).length;
      d1.querySelector('[data-a=zcNsxQ]').click(); await W(); out.q = document.getElementById('dlg').innerText.slice(0, 200); document.querySelector('#dlg[open] [data-a=yes]').click(); await W(400);
      out.ask = document.getElementById('dlg').innerText.slice(0, 200); document.querySelector('#dlg[open] [data-a=yes]').click(); await W(800);
    } finally { unstub(); }
    const z = S.zc.find((x) => x.id === id) || {}; out.saved = !!z.id; out.ap = z.ap; out.nsx = z.nsx; out.src = p.src;
    const zs = () => { const nx = zsNsx(z); return nx ? (nx.miss.length ? 'M' : 'A') : ''; };
    const row = { id, reg: 'i_nl', by: '', t: 0, np: 0, f: Object.assign(zcEmpty(), { d: z.d, no: z.no }), c: { tot: null, inc: 0, lvl: null, sumOk: true, dateWarn: false }, st: 'ok', tm: '', cz: null, cs: null, self: 0, why: '', dw: '', cw: '', stBy: '', stAt: 0, note: '' }, D = { C: [], P: {}, DC: [] };
    out.s1 = zs(); out.h1 = zsRowH(row, D).includes('נסגר ללא דף הוצאה מקופה (המשך ללא התאמה) · ' + ils(400));
    window.fsx = async () => ({}); try { out.put = await coSlipPut(p.src, window.DU); } finally { unstub(); }
    out.s2 = zs(); const h2 = zsRowH(row, D); out.h2 = h2.includes('דף הוצאה מקופה צורף אחר כך') && !h2.includes('(המשך ללא התאמה) ·'); out.keep = !!(S.zc.find((x) => x.id === id) || {}).nsx;
    S.tx = S.tx.filter((t) => t.src !== 'zc:' + id); S.zc = []; ZQ.L = []; COQ.L = null; ZC = null; save(); return out;
  }, { S: SETUP });
  check('29 אישור סגירה של עובד בלי דף (רק הסבר): חלון "צרף / המשך ללא התאמה" במקום אישור ישיר; "המשך" + אישור – נרשמת עם nsx; בסיכום "נסגר ללא דף…"; צירוף מאוחר – "צורף אחר כך", nsx נשאר',
    r29.d1 && r29.n1 === 0 && /להמשיך ללא התאמה/.test(r29.q) && /לאשר ולהכניס/.test(r29.ask) && r29.saved && r29.ap === 'm' && r29.nsx && r29.nsx.ids[0] === r29.src && r29.nsx.a === 400 && r29.s1 === 'M' && r29.h1 && r29.put && r29.s2 === 'A' && r29.h2 && r29.keep, r29);

  // 30. (בעל העסק 12.11) הוצאת מזומן לא תואמת (בלי חסר דף): מנהל – לא נשמרת בלי "המשך ללא התאמה"; אחרי המשך – nsx עם z/s/diff ותג בסיכום. אישור סגירה של עובד לא תואמת – חלון + המשך. עובד – בלי הכפתור
  const r30 = await page.evaluate(async (a) => {
    eval(a.S); COQ.L = []; ZL.i_nl = null; S.zc = []; const out = {}; zcSet(300); const h = zcCoH(); out.btn = h.includes('data-a="zcNsx"') && !h.includes(NS);
    let L = stub(); const n0 = S.zc.length; try { await FRM.zcSend({}); await W(); out.blk = S.zc.length === n0; out.tb = toastT();
      ACT.zcNsx(); await W(); out.q = document.getElementById('dlg').innerText.slice(0, 250); document.querySelector('#dlg[open] [data-a=yes]').click(); await W(800); } finally { unstub(); }
    let z = S.zc[S.zc.length - 1] || {}; out.saved = S.zc.length === n0 + 1; out.ap = z.ap; out.nsx = z.nsx;
    const row = (z, self) => ({ id: z.id, reg: 'i_nl', by: '', t: 0, np: 0, f: Object.assign(zcEmpty(), { d: z.d, no: z.no }), c: { tot: null, inc: 0, lvl: null, sumOk: true, dateWarn: false }, st: 'ok', tm: '', cz: 300, cs: 0, self, why: '', dw: '', cw: '', stBy: '', stAt: 0, note: '' }), D = { C: [], P: {}, DC: [] };
    out.zs = zsRowH(row(z, 1), D).includes('נסגר ללא התאמה: בדוח Z ' + ils(300) + ', הוצאות מקופה ' + ils(0) + ', הפרש ' + ils(300));
    S.tx = S.tx.filter((t) => t.src !== 'zc:' + z.id); S.zc = []; save();
    const role = SY.role; SY.role = 'worker'; let doc, id;
    try { zcSet(250); const hw = zcCoH(); out.wNo = !hw.includes('zcNsx') && !hw.includes('המשך ללא התאמה'); ZC.cw = 'לא מצאתי פתק'; L = stub(); try { await FRM.zcSend({}); } finally { unstub(); } const f = commitOf(L); doc = { fields: f }; id = JSON.parse(L.calls.find((x) => x[0] === ':commit')[1]).writes[0].update.name.split('/').pop(); out.wst = f.st.stringValue; } finally { SY.role = role; }
    const it = zcParse(doc, id); ZQ.L = [it]; ZQP = [];
    L = stub(); try {
      await ACT.zcOk({ dataset: { id } }); await W(); const d1 = document.getElementById('dlg'); out.d1 = !document.querySelector('#dlg[open] [data-a=yes]') && /לא תואמת/.test(d1.innerText) && !!d1.querySelector('[data-a=zcNsxQ]') && !d1.querySelector('[data-a=coSlip]'); out.n1 = S.zc.filter((x) => x.id === id).length;
      d1.querySelector('[data-a=zcNsxQ]').click(); await W(); document.querySelector('#dlg[open] [data-a=yes]').click(); await W(400);
      out.ask = document.getElementById('dlg').innerText.slice(0, 120); document.querySelector('#dlg[open] [data-a=yes]').click(); await W(800);
    } finally { unstub(); }
    z = S.zc.find((x) => x.id === id) || {}; out.saved2 = !!z.id; out.ap2 = z.ap; out.nsx2 = z.nsx; out.zs2 = zsRowH(row(z, 0), D).includes('נסגר ללא התאמה: בדוח Z ' + ils(250));
    S.tx = S.tx.filter((t) => t.src !== 'zc:' + id); S.zc = []; ZQ.L = []; COQ.L = null; ZC = null; save(); return out;
  }, { S: SETUP });
  check('30 הוצאת מזומן לא תואמת: מנהל – כפתור "המשך ללא התאמה", בלי לחיצה לא נשמרת; המשך (אישור) – נשמרת עם nsx {k:diff,z,s,diff} ותג "נסגר ללא התאמה: בדוח Z…" בסיכום; עובד – בלי הכפתור (הסבר → אישור מנהל); אישור המנהל – חלון + המשך, nsx נשמר',
    r30.btn && r30.blk && /לא תואמת.*המשך ללא התאמה/.test(r30.tb) && /להמשיך ללא התאמה/.test(r30.q) && r30.saved && r30.ap === 'self' && r30.nsx && r30.nsx.k === 'diff' && r30.nsx.z === 300 && r30.nsx.s === 0 && r30.nsx.diff === 300 && r30.nsx.ids.length === 0 && r30.zs
    && r30.wNo && r30.wst === 'new' && r30.d1 && r30.n1 === 0 && /לאשר ולהכניס/.test(r30.ask) && r30.saved2 && r30.ap2 === 'm' && r30.nsx2 && r30.nsx2.k === 'diff' && r30.nsx2.diff === 250 && r30.zs2, r30);

  // 26. מנהל מצרף דף מתוך הסגירה (כפתור "צלם / צרף דף") → לא חסר עוד, zcNeed נקי
  await page.evaluate(async (a) => { eval(a.S); await part('iC26', 1026); const g = document.querySelector('#dlg[open] form[data-f=ccpco]'); g.elements.creg.value = 'i_nl'; g.requestSubmit(); await W(400);
    const p = payOf('iC26'); COQ.L = [mir(p.src)]; zcSet(400); const box = document.createElement('div'); box.id = 'tst26'; box.innerHTML = zcCoH(); document.body.appendChild(box); box.querySelector('[data-a=coSlip]').click(); await W(); }, { S: SETUP });
  await page.setInputFiles('#dlg[open] input[data-c=coSlipF]:not([capture])', FILE); await sleep(500);
  const r26 = await page.evaluate(async (a) => { eval(a.S); const p = payOf('iC26'); const co = coChk('i_nl', ZC.f.d, ZC.f.tm, ZC.f.cout, { id: '' }); const need = zcNeed({ reg: 'i_nl', f: ZC.f, c: zcCalc(ZC.f, 'i_nl'), co, nsp: [], nw: '' });
    document.getElementById('tst26').remove(); const h = zcCoH(); ZC = null; return { file: p.file || '', ns: co.ns.length, need: need.filter((x) => x.startsWith(NS)).length, h: h.includes(NS), why: (mir(p.src) || {}).why }; }, { S: SETUP });
  check('26 מנהל מצרף מהסגירה: p.file נשמר, אין "חסר דף" בסגירה וב-zcNeed, הסיבה בענן בלי סימון',
    /^z/.test(r26.file) && r26.ns === 0 && r26.need === 0 && !r26.h && r26.why === 'השלמה לתשלום באשראי', r26);

  // 27. הוצאות מקופה אחרות בלי צילום – בלי שינוי (לא "חסר דף")
  const r27 = await page.evaluate(async (a) => {
    eval(a.S); const EX = S.cats.find((c) => c.kind === 'exp' && c.beh === 'simple').id;
    S.tx.push({ id: 'cM27', t: 'exp', cat: EX, date: '2026-11-02', amt: 30, co: { reg: 'i_nl', why: 'מונית', tm: '' }, pays: [], kind: 'inv' });
    S.tx.push({ id: 'cW27', t: 'exp', cat: EX, date: '2026-11-02', amt: 20, creg: 'i_nl', src: 'w27', cowhy: 'חלב', pays: [], kind: 'inv' }); save();
    const W2 = coWant(); COQ.L = [Object.assign({ id: 'mcM27', uid: 'm', by: 'מנהל', t: 1, dep: '', zc: '', dp: '' }, W2.mcM27.f), Object.assign({ id: 'w27', uid: 'u', by: 'עובד', t: 1, dep: '', zc: '', dp: '' }, W2.w27.f)];
    zcSet(50); const co = coChk('i_nl', ZC.f.d, ZC.f.tm, ZC.f.cout, { id: '' }); const h = zcCoH(); const role = SY.role; SY.role = 'worker'; let hw = ''; try { hw = zcCoH(); } finally { SY.role = role; }
    const out = { ns: co.ns.length, ok: co.ok, L: co.L.length, h: h.includes(NS) || hw.includes(NS), why: [W2.mcM27.f.why, W2.w27.f.why] };
    S.tx = S.tx.filter((t) => !['cM27', 'cW27'].includes(t.id)); ZC = null; COQ.L = null; S.zc = JSON.parse(window.__z0); save(); return out;
  }, { S: SETUP });
  check('27 הוצאה מקופה של המנהל ושל עובד בלי צילום – לא מסומנות "חסר דף", הסגירה תואמת, הסיבה בענן בלי שינוי',
    r27.ns === 0 && r27.ok && r27.L === 2 && !r27.h && r27.why[0] === 'מונית' && r27.why[1] === 'חלב', r27);

  // 28. (בעל העסק 12.11) עובד – הוצאה מקופה רק עם צילום הדף: הוספה מחלון הסגירה (FRM.coAdd) ושליחת "דף הוצאה מקופה" (wkSubmit / סריקה). מנהל – בלי צילום כמו היום
  const r28 = await page.evaluate(async (a) => {
    eval(a.S); const out = {}; const role = SY.role; const q0 = JSON.stringify(obGet()); window.__fsx0 = window.__fsx0 || fsx; window.fsx = async () => { throw Object.assign(new Error('offline'), { offline: true }); };
    const coAddRun = async (pic) => { zcSet(0); ACT.coAdd(); await W(); const f = document.querySelector('#dlg[open] form[data-f=coAdd]'); f.elements.a.value = '35'; f.elements.why.value = 'חלב לעובדים'; f.elements.d.value = today(); if (pic) CO1.pic = window.DU; const lab = document.getElementById('dlg').innerHTML; await FRM.coAdd(f); await W(300); closeDlg(); return lab; };
    try {
      SY.role = 'worker'; COQ.L = []; ZL.i_nl = null; let n = obGet().length;
      out.lab = /(צילום|העלאת) הפתק \(חובה\)/.test(await coAddRun(0)); /* בדפדפן בלי מצלמה הכפתור נקרא "העלאת" */ out.t1 = toastT(); out.q1 = obGet().length - n;
      n = obGet().length; await coAddRun(1); const it = obGet().find((x) => x.data && x.data.reg && x.data.note === 'חלב לעובדים'); out.q2 = obGet().length - n; out.fid = !!(it && it.fileId) && !(it && it.nopic);
      WK = { cat: '', sub: '', amt: '50', date: today(), note: 'קפה', pages: [], inv: '', dn: false }; n = obGet().length;
      await wkSubmit({ reg: true, creg: 'i_nl', amt: '50', date: today(), note: 'קפה', ctm: '' }); out.t3 = toastT(); out.q3 = obGet().length - n;
      WK.pages = [window.DU]; n = obGet().length; await wkSubmit({ reg: true, creg: 'i_nl', amt: '50', date: today(), note: 'קפה', ctm: '' }); await W(300);
      const w = obGet().find((x) => x.data && x.data.reg && x.data.note === 'קפה'); out.q4 = obGet().length - n; out.wf = !!(w && w.fileId);
    } finally { SY.role = role; }
    obSet(JSON.parse(q0));
    const t0 = S.tx.length; await coAddRun(0); const mt = S.tx.find((t) => t.co && t.co.why === 'חלב לעובדים'); out.m = !!mt && !mt.file && S.tx.length === t0 + 1;
    window.fsx = window.__fsx0; S.tx = S.tx.filter((t) => t !== mt); ZC = null; COQ.L = null; save(); return out;
  }, { S: SETUP });
  check('28 עובד: בלי צילום – הוצאה מקופה לא נשמרת (חלון הסגירה ו"דף הוצאה מקופה"), הודעה "חובה לצרף צילום של דף ההוצאה מקופה"; עם צילום – נשמרת עם fileId; מנהל בלי צילום – נרשמת כמו היום',
    r28.lab && /חובה לצרף צילום של דף ההוצאה מקופה/.test(r28.t1) && r28.q1 === 0 && r28.q2 === 1 && r28.fid && /חובה לצרף צילום של דף ההוצאה מקופה/.test(r28.t3) && r28.q3 === 0 && r28.q4 === 1 && r28.wf && r28.m, r28);

  check('15 אין שגיאות JS', page.__errors.length === 0, page.__errors);
  await ctx.close(); await browser.close();
  if (out) fs.writeFileSync(out, JSON.stringify({ fail, res }, null, 1));
  console.log(fail ? `נכשלו ${fail}` : 'הכול עבר'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
