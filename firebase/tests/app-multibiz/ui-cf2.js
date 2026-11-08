'use strict';
// תזרים/צ'קים – חלק ב', ממשק (B2): תנאי תשלום, תאריך תשלום בחשבונית, 3 כרטיסי בית, V.cf, inbDlg (סניף/בנק/due), תגית סניף.
// רשת מדומה (harness), זמן קבוע 3.11.2026. שימוש: NODE_PATH=... node ui-cf2.js <www-dir>
const H = require('./harness');
const BZ0 = ['larg', 'peami'].join('');
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
let fail = 0; const check = (n, ok, info) => { if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const ORG2 = { v: 1, branches: [{ id: 'bra', name: 'נחל לכיש', on: true, sig: [{ k: 'sup', v: 'sA' }] }, { id: 'brb', name: 'יהודה הנשיא', on: true, sig: [] }],
  banks: [{ id: 'bka', name: 'לאומי', last4: '1234', on: true, sig: [] }], cards: [] };
const seed = (p) => p.evaluate(() => {
  S.tx = []; S.inbox = []; delete S.orgC; delete S.terms; BRSEL = []; S.pmOff = 2; HM = NOWM(); CFM = '';
  S.subs = S.subs.filter((s) => !['sA', 'sB'].includes(s.id));
  S.subs.push({ id: 'sA', cat: 'e_sup', name: 'מאפיית השחר', pm: 1 }, { id: 'sB', cat: 'e_sup', name: 'ספק בית' });
  const mk = (id, sub, date, amt, plan, pays) => S.tx.push({ id, t: 'exp', cat: 'e_sup', sub, date, amt, note: '', kind: 'inv', plan, inv: id.toUpperCase(), pays: pays || [] });
  mk('a1', 'sA', '2026-09-10', 1000, '2026-10');
  mk('a2', 'sA', '2026-10-05', 500, '2026-11');
  mk('b1', 'sB', '2026-10-01', 800, '2026-12', [{ id: 'pc', d: '2026-11-01', a: 300, m: 'צ׳ק', chk: { no: '5', bank: '', date: '2026-12-10', img: '' } }]);
  save(); NAV = [{ v: 'home' }]; render(0);
});
const openAdd = (p, sub) => p.evaluate((sub) => { A = { step: 'det', type: 'exp', cat: 'e_sup', sub }; sheetDraw(); const f = document.querySelector('#sheet form[data-f=addsave]'); return { due: f.elements.due ? f.elements.due.value : null, plan: f.elements.plan ? f.elements.plan.value : null, hint: (f.querySelector('input[name=due]') || { parentElement: { innerText: '' } }).parentElement.innerText }; }, sub);
(async () => {
  const [www] = process.argv.slice(2); const browser = await H.launch();
  const cfg = { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: ALL } }, admins: { '|m': 1 }, staff: { '|w': 1 } };
  const m = await H.newPage(browser, www, cfg, [], 'm'); const mp = m.page; await mp.setViewportSize({ width: 360, height: 740 }); await H.login(mp, 'm@x.co');
  await seed(mp);

  // ---- 1. ספק בלי terms: טופס כמו היום ----
  const t1 = await openAdd(mp, 'sA');
  check('1 ספק בלי terms: "חודש לתשלום" כמו היום, בלי תאריך תשלום', t1.due === null && t1.plan === '2026-12', t1);
  await mp.evaluate(() => sheetClose());

  // ---- 2. terms בכרטיס ספק ----
  const t2 = await mp.evaluate(() => { ACT.subMenu({ dataset: { id: 'sB' } }); const f = document.querySelector('#dlg form[data-f=subsave]'); const r0 = [...f.querySelectorAll('input[name=tmode]')].find((x) => x.checked).value;
    const rb = [...f.querySelectorAll('input[name=tmode]')].find((x) => x.value === 'eom'); rb.checked = true; rb.dispatchEvent(new Event('change', { bubbles: true })); f.td.value = '60'; FRM.subsave(f); return { r0, terms: subById('sB').terms }; });
  check('2 כרטיס ספק: ברירת מחדל "מספר חודשים"; שוטף+60 נשמר', t2.r0 === 'pm' && t2.terms && t2.terms.b === 'eom' && t2.terms.d === 60, t2);
  const t2b = await mp.evaluate(() => { ACT.subMenu({ dataset: { id: 'sB' } }); const f = document.querySelector('#dlg form[data-f=subsave]'); const rb = [...f.querySelectorAll('input[name=tmode]')].find((x) => x.value === 'inv'); rb.checked = true; f.td.value = '999'; FRM.subsave(f); const bad = subById('sB').terms.b; closeDlg(); return bad; });
  check('2א ימים לא תקינים – לא נשמר', t2b === 'eom', t2b);

  // ---- 3. due מחושב / עריך / plan מתעדכן ----
  const t3 = await openAdd(mp, 'sB');
  check('3 ספק עם שוטף+60: תאריך תשלום מחושב 31.1.2027 + טקסט', t3.due === '2027-01-31' && /שוטף\+60 → 31\.1\.2027/.test(t3.hint), t3);
  const t3b = await mp.evaluate(() => { const f = document.querySelector('#sheet form[data-f=addsave]'); f.date.value = '2026-12-05'; f.date.dispatchEvent(new Event('change', { bubbles: true })); const r = { d1: f.due.value };
    f.due.value = '2027-03-10'; f.due.dispatchEvent(new Event('change', { bubbles: true })); f.date.value = '2026-11-05'; f.date.dispatchEvent(new Event('change', { bubbles: true })); r.d2 = f.due.value;
    f.amt.value = '700'; f.inv.value = 'X9'; const br = f.querySelector('select[name=br]'); if (br) br.value = br.options[1] ? br.options[1].value : '';
    FRM.addsave(f, { submitter: null }); const t = S.tx.find((x) => x.inv === 'X9'); r.t = t && { due: t.due, plan: t.plan }; return r; });
  check('3א שינוי תאריך חשבונית מחשב מחדש; תאריך שהמשתמש שינה נשמר', t3b.d1 === '2027-02-28' && t3b.d2 === '2027-03-10', t3b);
  check('3ב נשמר due + plan=חודש ה-due', t3b.t && t3b.t.due === '2027-03-10' && t3b.t.plan === '2027-03', t3b.t);
  // עריכה בלי שינוי של חשבונית ישנה (בלי due) לא כותבת due – גם כשלספק יש terms עכשיו
  const t3c = await mp.evaluate(() => { const t0 = S.tx.find((x) => x.id === 'b1'); A = { step: 'det', type: 'exp', cat: 'e_sup', sub: 'sB', edit: 'b1' }; sheetDraw(); const f = document.querySelector('#sheet form[data-f=addsave]'); const shown = !!f.elements.due; FRM.addsave(f, { submitter: null }); const t = S.tx.find((x) => x.id === 'b1'); return { shown, due: 'due' in t, plan: t.plan }; });
  check('3ג עריכה בלי שינוי: לא נכתב due, plan נשאר', t3c.due === false && t3c.plan === '2026-12', t3c);

  // ---- 4. כרטיסי בית ----
  await seed(mp);
  const t4 = await mp.evaluate(() => { const g = (a) => document.querySelector('#hcards [data-a=' + a + '] b').innerText; return { due: g('hcDue'), cf: g('hcCf'), late: g('hcLate'), H: homeCards(NOWM()), banner: /מחודשים קודמים/.test(document.body.innerText) }; });
  check('4 כרטיסי בית: לתשלום 500, ירידה 500 (העברה פתוחה a2), באיחור 1000', t4.H.due === 500 && t4.H.debit === 500 && t4.H.lateSum === 1000 && /500/.test(t4.due) && /1,000/.test(t4.late), t4);
  const t4b = await mp.evaluate(() => { const r = {}; document.querySelector('#hcards [data-a=hcDue]').click(); r.v1 = cur().v; NAV.pop(); render(0); document.querySelector('#hcards [data-a=hcCf]').click(); r.v2 = cur().v; r.cfTot = document.querySelector('[data-a=cfM]').innerText; NAV.pop(); render(0); document.querySelector('#hcards [data-a=hcLate]').click(); r.v3 = cur().v; r.lateSec = !!document.querySelector('#dueLate .li, #dueLate button'); NAV.pop(); render(0); return r; });
  check('4א הכרטיסים פותחים: חשבוניות לתשלום / תזרים / קטע באיחור', t4b.v1 === 'due' && t4b.v2 === 'cf' && t4b.v3 === 'due' && t4b.lateSec, t4b);
  check('4ב סכום ירידה בבית = סכום החודש בתזרים', /500/.test(t4b.cfTot), t4b.cfTot);
  const t4c = await mp.evaluate(() => { ACT.hm({ dataset: { d: '1' } }); const H = homeCards(HM); const r = { m: HM, due: H.due, debit: H.debit, late: H.lateSum, card: document.querySelector('#hcards [data-a=hcCf] b').innerText }; ACT.hm({ dataset: { d: '-1' } }); return r; });
  check('4ג חודש הבא: לתשלום 800, ירידה 800 (צ׳ק 300 + יתרה 500), באיחור לא משתנה', t4c.m === '2026-12' && t4c.due === 800 && t4c.debit === 800 && t4c.late === 1000, t4c);

  // ---- 4ד. מסך הבית: כרטיס ראשי (רווח, הכנסות, הוצאות), בלי כפילויות, הרשאות ----
  const t4d = await mp.evaluate(() => { const ic = S.cats.find((c) => c.kind === 'inc'); S.tx.push({ id: 'in1', t: 'inc', cat: ic.id, date: '2026-11-01', amt: 1000, note: '', pays: [] }); S.tx.push({ id: 'ex9', t: 'exp', cat: S.cats.find((c) => c.kind === 'exp' && c.beh === 'free').id, date: '2026-11-02', amt: 400, note: '', pays: [] }); save(); render(0);
    const q = (s) => document.querySelector(s), tx = document.body.innerText, r = {};
    r.hero = q('#hmain') ? q('#hmain').innerText.replace(/\s+/g, ' ') : ''; r.cnt = (tx.match(/לתשלום החודש/g) || []).length; r.old = /צריך לשלם החודש|נשאר לשלם החודש|שולם מתוכו|רווחיות החודש|הכנסות החודש|הוצאות החודש/.test(tx);
    r.inHero = !!q('#hmain [data-a=tab][data-v=inc]') && !!q('#hmain [data-a=tab][data-v=exp]'); r.cards = document.querySelectorAll('#hcards > button').length; return r; });
  check('4ד כרטיס ראשי: רווח 600 (60%), הכנסות/הוצאות בתוכו', /רווח החודש/.test(t4d.hero) && /600/.test(t4d.hero) && /60%/.test(t4d.hero) && /1,000/.test(t4d.hero) && /400/.test(t4d.hero) && t4d.inHero, t4d);
  check('4ה "לתשלום החודש" פעם אחת, בלי כותרות ישנות כפולות, 3 כרטיסים קטנים', t4d.cnt === 1 && !t4d.old && t4d.cards === 3, t4d);
  const t4e = await mp.evaluate(() => { const o = { role: SY.role, refresh: SY.refresh, perms: SY.perms, biz: SY.biz }, res = {}; const txt = () => document.querySelector('#hmain').innerText.replace(/\s+/g, ' ');
    SY.biz = Object.assign({}, SY.biz, { dataRoot: 'b' }); SY.role = 'worker'; SY.refresh = 'x'; res.isW = isW(); res.bzB = bzB();
    SY.perms = { incR: false, expR: false }; render(0); res.none = { t: txt(), tabs: document.querySelectorAll('#hmain [data-a=tab]').length, has1000: /1,000/.test(document.body.innerText.split('לתשלום החודש')[0]) };
    SY.perms = { incR: true, expR: 'own' }; render(0); res.inc = { t: txt(), has400: /400/.test(txt()), has1000: /1,000/.test(txt()), profit: /רווח החודש|הפסד החודש/.test(txt()) };
    SY.perms = { incR: false, expR: true }; render(0); res.exp = { t: txt(), has400: /400/.test(txt()), has1000: /1,000/.test(txt()), profit: /רווח החודש|הפסד החודש/.test(txt()) };
    SY.perms = { incR: true, expR: true }; render(0); res.both = /רווח החודש/.test(txt());
    Object.assign(SY, o); render(0); return res; });
  if (t4e.isW && t4e.bzB) {
    check('4ו הרשאות: בלי הכנסות והוצאות – אין סכומים ואין קישורים', t4e.none.tabs === 0 && !/17|1,000|400|רווח|הפסד/.test(t4e.none.t.replace(/[א-ת]+ \d{4}/g, '')), t4e.none);
    check('4ז הרשאות: הוצאות "own" מוסתרות (רק הכנסות, בלי רווח)', t4e.inc.has400 === false && t4e.inc.has1000 && !t4e.inc.profit, t4e.inc);
    check('4ח הרשאות: רק הוצאות – בלי הכנסות ובלי רווח; הכול – עם רווח', t4e.exp.has400 && !t4e.exp.has1000 && !t4e.exp.profit && t4e.both, t4e);
  } else check('4ו-ח הרשאות: לא ניתן לדמות עובד בסביבת הבדיקה', false, t4e);
  await seed(mp);

  // ---- 5. V.cf ----
  const t5 = await mp.evaluate(() => { go('cf'); const rows = [...document.querySelectorAll('[data-a=cfM]')]; const r = { n: rows.length, note: !!document.getElementById('cfNote') }; rows[1].click(); r.det = document.querySelector('[data-cfd="2026-12"]').innerText; NAV = [{ v: 'home' }]; render(0); return r; });
  check('5 תזרים: 6 חודשים, הערת מזומן/אשראי, פירוט חודש עם צ׳ק', t5.n === 6 && t5.note && /צ׳ק 5/.test(t5.det) && /10\/12\/2026/.test(t5.det), t5);

  // ---- 6. תגית סניף + inbDlg ----
  const t6 = await mp.evaluate(() => { const one = !!document.querySelector('[data-brtag]'); return one; });
  check('6 סניף יחיד: אין תגית סניף ברשימה', t6 === false);
  const t6b = await mp.evaluate((o) => { S.orgC = o; save(); render(0); const tags = [...document.querySelectorAll('[data-brtag]')].map((x) => x.innerText); return tags; }, ORG2);
  check('6א 2 סניפים: תגית סניף בתנועות', t6b.length > 0 && t6b.includes('נחל לכיש'), t6b);
  const t6c = await mp.evaluate(() => { subById('sB').terms = { b: 'eom', d: 60 }; S.inbox.push({ id: 'i1', by: 'עובד', ow: 'w', d: { cat: 'e_sup', sub: 'sB', amt: 300, date: '2026-11-02', inv: 'Q1' } }); save();
    ACT.inbEdit({ dataset: { id: 'i1' } }); const f = document.querySelector('#dlg form[data-f=inbsave]'); const r = { hasBr: !!f.elements.br, due: f.elements.due && f.elements.due.value };
    f.elements.br.value = 'brb'; FRM.inbsave(f); const d = S.inbox.find((x) => x.id === 'i1').d; r.d = { br: d.br, due: d.due, plan: d.plan }; ACT.inbOk({ dataset: { id: 'i1', ok: '1', aw: '1' } }); const t = S.tx.find((x) => x.src === 'i1'); r.t = t && { br: t.br, due: t.due, plan: t.plan }; return r; });
  check('6ב inbDlg: שדה סניף + תאריך תשלום; נשמרים ב-it.d ובאישור לתנועה', t6c.hasBr && t6c.due === '2027-01-31' && t6c.d.br === 'brb' && t6c.d.due === '2027-01-31' && t6c.t && t6c.t.br === 'brb' && t6c.t.due === '2027-01-31' && t6c.t.plan === '2027-01', t6c);
  const t6d = await mp.evaluate(() => { const ex = S.cats.find((c) => c.beh === 'emp' && !c.hid); if (!ex) return { skip: true }; const sb = S.subs.find((s) => s.cat === ex.id) || (S.subs.push({ id: 'se', cat: ex.id, name: 'עובדת' }), S.subs.find((s) => s.id === 'se'));
    S.inbox.push({ id: 'i2', by: 'עובד', ow: 'w', d: { cat: ex.id, sub: sb.id, amt: 100, date: '2026-11-02', m: 'העברה', plan: '2026-11', br: 'bra' } }); save(); ACT.inbEdit({ dataset: { id: 'i2' } }); const f = document.querySelector('#dlg form[data-f=inbsave]');
    const k = f.querySelector('select[name=bank]'); if (!k) return { nobank: true }; k.value = 'bka'; FRM.inbsave(f); const d = S.inbox.find((x) => x.id === 'i2').d; ACT.inbOk({ dataset: { id: 'i2', ok: '1' } }); const t = S.tx.find((x) => x.src === 'i2'); return { dbank: d.bank, br: d.br, pbank: t && t.pays[0].bank }; });
  check('6ג inbDlg משכורת בהעברה: בנק נשמר ועובר לתשלום', t6d.skip || (t6d.dbank === 'bka' && t6d.br === 'bra' && t6d.pbank === 'bka'), t6d);

  // ---- 7. הגדרות: ברירת מחדל לעסק ----
  const t7 = await mp.evaluate(() => { delete S.orgC; save(); go('settings'); const f = document.querySelector('form[data-f=pmoff]'); const rb = [...f.querySelectorAll('input[name=tmode]')].find((x) => x.value === 'inv'); rb.checked = true; f.td.value = '30'; FRM.pmoff(f); const r = { t: S.terms, pm: S.pmOff }; delete S.terms; save(); NAV = [{ v: 'home' }]; render(0); return r; });
  check('7 הגדרות: "30 ימים מהחשבונית" נשמר כברירת מחדל, pmOff נשאר', t7.t && t7.t.b === 'inv' && t7.t.d === 30 && t7.pm === 2, t7);

  check('8 אין שגיאות JS (מנהל)', !mp.__errors.length, mp.__errors);
  await browser.close();
  console.log(fail ? 'נכשלו ' + fail : 'כל הבדיקות עברו'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
