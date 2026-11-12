'use strict';
// הוצאה מקופה (11.11.2026, שלב 3): בקבוצה "הוצאה מקופה" לכל פריט שתי אפשרויות –
// (א) ייחוד לחשבונית ספק קיימת: לא נוצרת הוצאה, נרשם תשלום במזומן מהקופה על החשבונית (creg/src), והחשבונית נסגרת;
// (ב) הוצאה לפי קטגוריה שממתינה לחשבונית: דרך ACT.inbOk, עם await ותשלום מזומן (רשימת "שולם – ממתין לחשבונית", awAtt/awOffer).
// אחרי אישור: ההוצאה במשבצת "סגירת קופה והפקדות" תחת "הוצאה מקופה", לכל קופה בנפרד, מסומנות אלו של הסגירה האחרונה, וסכום המסומנות מול סכום הסגירה.
// וגם: חישובי הסגירה הקיימים (coWant/coVer/coChk/zsCoFile) מחזירים על נתונים ישנים בדיוק את מה שהחזירו לפני השינוי (GOLD – נמדד על הקוד שלפני השינוי).
// רשת מדומה (בלי אמולטור). שימוש: node ui-reg-cash.js <www-dir> [out.json]   (GOLDEN=1 – רק מדפיס את טביעת החישובים הישנים)
const fs = require('fs'); const H = require('./harness');
const BZ0 = ['larg', 'peami'].join('');
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
let fail = 0; const res = []; const check = (n, ok, info) => { if (!ok) fail++; res.push({ n, ok: !!ok, info }); console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 500) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// טביעת החישובים הקיימים על נתונים ישנים (בלי שדות חדשים): זיכוי עם creg, רשומה בלי creg, הוצאה של המנהל (t.co), פריט ממתין, סגירה קודמת
const OLD = () => {
  const EX = S.cats.find((c) => c.kind === 'exp' && c.beh === 'simple').id;
  if (!S.subs.some((x) => x.id === 'rcSup1')) S.subs.push({ id: 'rcSup1', cat: 'e_sup', name: 'ספק בדיקה' });
  S.tx = S.tx.filter((t) => !/^g/.test(t.id)); S.inbox = S.inbox.filter((x) => !/^g/.test(x.id));
  S.tx.push({ id: 'g1', t: 'exp', cat: EX, date: '2026-10-20', amt: 40, creg: 'i_nl', src: 'gw1', cowhy: 'חלב', ctm: '09:00', pays: [], kind: 'inv', file: 'fg1' });
  S.tx.push({ id: 'g2', t: 'exp', cat: EX, date: '2026-10-21', amt: 25, co: { reg: 'i_nl', why: 'מונית', tm: '' }, pays: [], kind: 'inv' });
  S.tx.push({ id: 'g3', t: 'exp', cat: EX, date: '2026-10-22', amt: -15, creg: 'i_nl', src: 'gw3', cowhy: 'החזר', pays: [], kind: 'credit' });
  S.tx.push({ id: 'g4', t: 'exp', cat: EX, date: '2026-10-22', amt: 60, src: 'gw4', pays: [], kind: 'inv' });
  S.tx.push({ id: 'g5', t: 'exp', cat: 'e_sup', sub: 'rcSup1', date: '2026-10-10', amt: 300, inv: '9', pays: [{ id: 'gp', d: '2026-10-11', a: 100, m: 'מזומן' }], kind: 'inv' });
  S.inbox.push({ id: 'gw5', by: 'עובד', at: '2026-10-23T08:00:00Z', file: 'fg5', d: { reg: true, creg: 'i_nl', amt: 12, date: '2026-10-23', note: 'סבון' } });
  S.zc = [{ id: 'gz1', reg: 'i_nl', d: '2026-10-21', tm: '22:00', co: { z: 65, s: 65, ids: ['gw1', 'mg2'], ok: 1, done: 1 } }];
  const X = (id, d, a, o) => Object.assign({ id, uid: 'u', by: 'עובד', t: 1, reg: 'i_nl', d, tm: '', a, why: 'w', dep: '', src: id, zc: '', dp: '' }, o);
  COQ.L = [X('gw1', '2026-10-20', 40, { zc: 'gz1', tm: '09:00' }), X('mg2', '2026-10-21', 25, { zc: 'gz1', src: 'g2', uid: 'm' }), X('gw3', '2026-10-22', 15), X('gw4', '2026-10-22', 60), X('gw5', '2026-10-23', 12), X('gw9', '2026-10-24', 33)];
  const W = coWant(), w = Object.keys(W).sort().map((k) => [k, W[k].f, W[k].h, !!W[k].w]);
  const c = coChk('i_nl', '2026-10-25', '22:00', '27', { id: 'gnew' });
  return { w, v: COQ.L.map((x) => [x.id, coVer(x)]), c: { s: c.s, ok: c.ok, diff: c.diff, L: c.L.map((x) => x.id), bad: c.bad.map((x) => x.id), prev: c.prev && c.prev.id }, f: COQ.L.map((x) => zsCoFile(x)) };
};
// נמדד על הקוד שלפני השינוי (feature/todo-split, 73220be) עם GOLDEN=1
const GOLD = {"w":[["gw1",{"reg":"i_nl","d":"2026-10-20","tm":"09:00","a":40,"why":"חלב","src":"gw1"},"1occk44",true],["gw3",{"reg":"i_nl","d":"2026-10-22","tm":"","a":15,"why":"החזר","src":"gw3"},"1nktiww",true],["gw5",{"reg":"i_nl","d":"2026-10-23","tm":"","a":12,"why":"סבון","src":"gw5"},"k3zobh",true],["mg2",{"reg":"i_nl","d":"2026-10-21","tm":"","a":25,"why":"מונית","src":"g2"},"1j3iy7p",false]],"v":[["gw1",true],["mg2",true],["gw3",true],["gw4",false],["gw5",true],["gw9",false]],"c":{"s":27,"ok":false,"diff":0,"L":["gw3","gw5"],"bad":["gw4","gw9"],"prev":"gz1"},"f":["fg1","","","","fg5",""]};

(async () => {
  const [www, out] = process.argv.slice(2);
  const browser = await H.launch(); const log = [];
  const cfg = { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: ALL } }, admins: { '|m': 1 }, staff: { '|w': 1 } };
  const { ctx, page } = await H.newPage(browser, www, cfg, log, 'm'); await page.setViewportSize({ width: 360, height: 740 });
  await H.login(page, 'm@x.co'); await sleep(600);
  await page.evaluate(() => { if (typeof INB !== 'undefined') { INB.ms = 3600000; inbStart(); } });

  const fp = await page.evaluate(`(${OLD.toString()})()`);
  if (process.env.GOLDEN) { console.log(JSON.stringify(fp)); await browser.close(); return; }
  check('1 נתונים ישנים: coWant / coVer / coChk / zsCoFile מחזירים בדיוק את מה שהחזירו לפני השינוי (זיכוי, רשומה בלי creg, סגירה קודמת)', GOLD && JSON.stringify(fp) === JSON.stringify(GOLD), { fp, GOLD });
  check('2 נתונים ישנים: הזיכוי (סכום שלילי) והרשומה בלי creg לא נספרים פעמיים ולא שוברים (gw4 בלי creg – לא נספר; gw9 בלי הוצאה – לא נספר)', fp.c.L.join() === 'gw3,gw5' && fp.c.bad.join() === 'gw4,gw9' && fp.c.s === 27 && fp.c.prev === 'gz1', fp.c);

  // נתוני המשימה: 2 חשבוניות ספק פתוחות + זיכוי, 3 הוצאות מקופה שעובדים שלחו, הוצאה מקופה שכבר נקלטה, ושתי סגירות
  const r3 = await page.evaluate(async () => {
    const EX = S.cats.find((c) => c.kind === 'exp' && c.beh === 'simple').id;
    S.tx = S.tx.filter((t) => !/^(g|rc)/.test(t.id) && !/^(g|rc)/.test(t.src || '')); S.inbox = []; COQ.L = null;
    if (!S.subs.some((x) => x.id === 'rcSup2')) S.subs.push({ id: 'rcSup2', cat: 'e_sup', name: 'ספק אחר' });
    S.tx.push({ id: 'rcInv1', t: 'exp', cat: 'e_sup', sub: 'rcSup1', date: '2026-11-01', amt: 80, inv: '7001', plan: '2026-11', pays: [], kind: 'inv' });
    S.tx.push({ id: 'rcInv2', t: 'exp', cat: 'e_sup', sub: 'rcSup2', date: '2026-11-02', amt: 200, inv: '8001', plan: '2026-11', pays: [], kind: 'inv' });
    S.tx.push({ id: 'rcCr', t: 'exp', cat: 'e_sup', sub: 'rcSup1', date: '2026-11-02', amt: -500, inv: 'ז1', plan: '2026-11', pays: [], kind: 'credit' });
    S.tx.push({ id: 'rcLeg', t: 'exp', cat: EX, date: '2026-11-02', amt: 60, src: 'rcLegW', pays: [], kind: 'inv' }); // ישן, בלי creg
    S.tx.push({ id: 'rcOld', t: 'exp', cat: EX, date: '2026-11-01', amt: 50, creg: 'i_nl', src: 'rcOldW', cowhy: 'ישן', pays: [], kind: 'inv' }); // שייך לסגירה הקודמת
    S.tx.push({ id: 'rcD', t: 'exp', cat: EX, date: '2026-11-04', amt: 20, creg: 'i_nl', src: 'rcDW', cowhy: 'קרח', pays: [], kind: 'inv' }); // אחרי הסגירה האחרונה
    const it = (id, d, o) => Object.assign({ id, by: 'עובד בדיקה', at: '2026-11-03T09:00:00Z', d: Object.assign({ date: '2026-11-03', reg: true }, d) }, o || {});
    S.inbox = [
      it('rcA', { creg: 'i_nl', amt: 80, note: 'שילמתי לספק', sub: 'rcSup1', ctm: '10:00' }, { file: 'fA' }),
      it('rcB', { creg: 'i_nl', cat: EX, amt: 45, note: 'ניקיון' }),
      it('rcC', { creg: 'i_yh', cat: 'e_sup', sub: 'rcSup1', amt: 30, note: 'ספק במזומן' }),
      it('rcN', { creg: 'i_nl', cat: EX, amt: -10, note: 'החזר' }),
      it('rcP', { creg: 'i_nl', cat: EX, amt: 15, note: 'לחם' }),
      it('rcE', { creg: 'i_nl', cat: EX, amt: 80, note: 'גז' }, { file: 'fE' }),
      it('rcF', { creg: 'i_nl', cat: EX, amt: 80, note: 'חשמלאי' }, { file: 'fF' }),
      Object.assign(it('rcS', { cat: 'e_sup', sub: 'rcSup2', amt: 117, inv: '5501' }), { d: { cat: 'e_sup', sub: 'rcSup2', amt: 117, inv: '5501', date: '2026-11-03' } }),
    ];
    S.zc = [{ id: 'rcZ1', reg: 'i_nl', d: '2026-11-01', tm: '22:00', tx: [], co: { z: 50, s: 50, ids: ['rcOldW'], ok: 1, done: 1 } },
      { id: 'rcZ2', reg: 'i_nl', d: '2026-11-03', tm: '22:00', tx: [], co: { z: 125, s: 125, ids: ['rcA', 'rcB'], ok: 1, done: 1 } }];
    save(); try { await coSync(); } catch (e) { /* */ } // המראה של rcA נרשם במטמון (כמו במכשיר אמיתי) – כדי לבדוק שאחרי הייחוד הוא לא נמחק
    NAV = [{ v: 'home' }, { v: 'todo' }]; go('inbox', 'reg');
    const card = (id) => { const b = document.querySelector(`#main [data-id=${id}]`); return b && b.closest('.card'); };
    const btns = (id) => { const c = card(id); const cb = c ? [...c.querySelectorAll('button[data-a]')].map((b) => b.dataset.a) : []; if (cb.join() !== 'inbEdit') return ['card:' + cb.join()]; ACT.inbEdit({ dataset: { id } }); const r = [...document.querySelectorAll('#dlg[open] button[data-a]')].map((b) => b.dataset.a === 'inbSaveOk' ? 'inbOk' : b.dataset.a); closeDlg(); return r; };
    const R = ['rcA', 'rcB', 'rcC'].map((id) => [id, btns(id)]);
    NAV.pop(); go('inbox', 'sup'); const sup = btns('rcS');
    return { R, sup, ttl: document.getElementById('ttl').innerText };
  });
  check('3 לכל פריט "הוצאה מקופה" בכרטיס רק "בדיקה", ובמסך הבדיקה כפתור אישור אחד ("שמור ואשר") בלי כפתורי שיוך נוספים', r3.R.every(([, b]) => b.filter((x) => x === 'inbOk').length === 1 && !b.some((x) => /^inb(Inv|Aw|RegTo|SaveGo)$/.test(x))), r3.R);
  check('4 חשבונית ספק רגילה (לא מקופה) – "אשר" הרגיל לא השתנה, בלי האפשרויות החדשות', r3.sup.includes('inbOk') && !r3.sup.includes('inbInv') && !r3.sup.includes('inbAw'), r3.sup);

  // (א) ייחוד לחשבונית קיימת
  const r5 = await page.evaluate(async () => {
    const tot = () => Math.round(S.tx.filter((t) => t.t === 'exp' && !t.x && (t.date || '').slice(0, 7) === '2026-11').reduce((s, t) => s + t.amt, 0) * 100) / 100;
    const t0 = tot(), n0 = S.tx.length; NAV = [{ v: 'home' }, { v: 'todo' }]; go('inbox', 'reg');
    const W = (ms) => new Promise((r) => setTimeout(r, ms || 150)), setF = async (n, v) => { const e = document.querySelector('#dlg[open] form[data-f=inbsave]').elements[n]; e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); await W(); }; ACT.inbEdit({ dataset: { id: 'rcA' } }); await setF('cat', 'e_sup'); await setF('sub', 'rcSup1'); document.querySelector('#dlg[open] [data-a=inbSaveOk]').click(); await W(300);
    const L = [...document.querySelectorAll('#dlg[open] [data-a=inbInvOk]')].map((b) => b.dataset.t);
    document.querySelector('#dlg[open] [data-a=inbInvOk][data-t=rcInv1]').click(); await new Promise((r) => setTimeout(r, 100));
    const inv = S.tx.find((t) => t.id === 'rcInv1'), p = inv.pays[inv.pays.length - 1];
    return { L, t0, t1: tot(), n: S.tx.length - n0, p, bal: bal(inv), st: stOf(inv), inDue: S.tx.filter((t) => bal(t) > 0.004).some((t) => t.id === 'rcInv1'), gone: !S.inbox.some((x) => x.id === 'rcA'), dlg: !!document.querySelector('#dlg[open]') };
  });
  check('5 שמור ואשר בקטגוריית ספק: מוצעות רק החשבוניות הפתוחות של אותו ספק (בלי זיכוי)', r5.L.join() === 'rcInv1', r5.L);
  check('6 ייחוד לא יוצר הוצאה כפולה: אין תנועה חדשה, וסך ההוצאות בחודש לפני ואחרי זהה', r5.n === 0 && r5.t0 === r5.t1, { t0: r5.t0, t1: r5.t1, n: r5.n });
  check('7 החשבונית נסגרה כשולמה במזומן מהקופה (תשלום 80 במזומן, קופה i_nl, קישור למסמך העובד), ולא נשארה ב"לתשלום"; הפריט יצא מהרשימה', r5.p.m === 'מזומן' && r5.p.a === 80 && r5.p.creg === 'i_nl' && r5.p.src === 'rcA' && r5.p.file === 'fA' && r5.bal === 0 && r5.st === 3 && !r5.inDue && r5.gone && !r5.dlg, r5);

  // הקישור לקופה ולסגירה אחרי הייחוד: coWant משאיר את המראה בענן (לא נמחק), coVer סופר אותו, וגם בבדיקת סגירה חדשה
  const r8 = await page.evaluate(async () => {
    const W = coWant(), x = { id: 'rcA', uid: 'w', by: 'עובד בדיקה', t: 1, reg: 'i_nl', d: '2026-11-03', tm: '10:00', a: 80, why: 'שילמתי לספק', dep: '', src: 'rcA', zc: '', dp: '' };
    try { await coSync(); } catch (e) { /* */ }
    COQ.L = [x]; const c = coChk('i_nl', '2026-11-03', '22:00', '80', { id: 'rcZ2' }); // אותה סגירה – החלון מהסגירה הקודמת (rcZ1) COQ.L = null;
    return { w: W.rcA && W.rcA.f, v: coVer(x), v2: coVer(Object.assign({}, x, { a: 81 })), v3: coVer(Object.assign({}, x, { reg: 'i_yh' })), cL: c.L.map((y) => y.id), file: zsCoFile(x) };
  });
  const del = log.filter((r) => r.method === 'DELETE' && /cashout\/rcA/.test(r.url));
  const cached = await page.evaluate(() => { try { return !!(JSON.parse(localStorage.getItem(COK)) || {}).rcA; } catch (e) { return false; } });
  check('8 אחרי ייחוד: ההוצאה מקופה נשארת בבדיקת הסגירה עם הקופה הנכונה (coWant/coVer/coChk), והמראה שלה בענן לא נמחק', r8.w && r8.w.reg === 'i_nl' && r8.w.a === 80 && r8.w.src === 'rcA' && r8.v && !r8.v2 && !r8.v3 && r8.cL.join() === 'rcA' && r8.file === 'fA' && del.length === 0 && cached, { r8, del: del.length, cached });

  // (ב) הוצאה לפי קטגוריה שממתינה לחשבונית
  const r9 = await page.evaluate(async () => {
    const tot = () => Math.round(S.tx.filter((t) => t.t === 'exp' && !t.x && (t.date || '').slice(0, 7) === '2026-11').reduce((s, t) => s + t.amt, 0) * 100) / 100;
    const t0 = tot(); NAV = [{ v: 'home' }, { v: 'todo' }]; go('inbox', 'reg');
    const W = (ms) => new Promise((r) => setTimeout(r, ms || 150)), setF = async (n, v) => { const e = document.querySelector('#dlg[open] form[data-f=inbsave]').elements[n]; e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); await W(); }; ACT.inbEdit({ dataset: { id: 'rcB' } }); await setF('cat', 'e_sup'); await setF('sub', 'rcSup2'); document.querySelector('#dlg[open] [data-a=inbSaveOk]').click(); await W(300); const offB = [...document.querySelectorAll('#dlg[open] [data-a=inbInvOk]')].map((b) => b.dataset.t).join(); document.querySelector('#dlg[open] [data-a=inbRegNoInv]').click(); await W(); document.querySelector('#dlg[open] [data-a=inbRegAw][data-w]').click(); await W(300);
    ACT.inbEdit({ dataset: { id: 'rcC' } }); document.querySelector('#dlg[open] [data-a=inbSaveOk]').click(); await W(300); const askC = !!document.querySelector('#dlg[open] [data-a=inbRegAw][data-w]') && !document.querySelector('#dlg[open] [data-a=inbInvOk]'); document.querySelector('#dlg[open] [data-a=inbRegAw][data-w]').click(); await W(300);
    const B = S.tx.filter((t) => t.src === 'rcB'), C = S.tx.filter((t) => t.src === 'rcC'), aw = tdnL().aw.map((t) => t.src);
    NAV = [{ v: 'home' }]; go('todo'); const todo = document.getElementById('main').innerText.includes('שולם – ממתין לחשבונית');
    return { t0, t1: tot(), B, C, aw, todo, offB, askC, left: S.inbox.map((x) => x.id), dlg: !!document.querySelector('#dlg[open]') };
  });
  const B = r9.B[0] || {}, C = r9.C[0] || {};
  check('9 ספק: עם חשבונית פתוחה – מוצעת לשיוך, ו"לא לשייך" עובר לשאלה; בלי חשבונית פתוחה – ישר לשאלה. "כן – ממתינה לחשבונית": נרשמה פעם אחת, עם creg נכון, שולמה במזומן, ומסומנת "ממתין לחשבונית"; הסכום בחודש עלה בדיוק בסכום ההוצאות', r9.B.length === 1 && r9.C.length === 1 && B.creg === 'i_nl' && C.creg === 'i_yh' && B.await === 1 && C.await === 1 && B.pays.length === 1 && B.pays[0].m === 'מזומן' && B.pays[0].a === 45 && r9.t1 === Math.round((r9.t0 + 45 + 30) * 100) / 100 && !r9.dlg && r9.offB === 'rcInv2' && r9.askC && B.sub === 'rcSup2', r9);
  check('10 קטגוריית ספק בלי מספר חשבונית – לא נחסמת ("ממתין לחשבונית"), ושתיהן ברשימה הקיימת "שולם – ממתין לחשבונית"', C.sub === 'rcSup1' && !C.dn && r9.aw.includes('rcB') && r9.aw.includes('rcC') && r9.todo && r9.left.join() === 'rcN,rcP,rcE,rcF,rcS', r9);

  // כשחשבונית מגיעה: (1) חיבור ישיר מפרטי התנועה (awAtt), (2) חשבונית ספק מעובד → awOffer מציע לחבר
  const r11 = await page.evaluate(async () => {
    const tot = () => Math.round(S.tx.filter((t) => t.t === 'exp' && !t.x && (t.date || '').slice(0, 7) === '2026-11').reduce((s, t) => s + t.amt, 0) * 100) / 100;
    const b = S.tx.find((t) => t.src === 'rcB'), c = S.tx.find((t) => t.src === 'rcC'), t0 = tot(), n0 = S.tx.length;
    ACT.awAtt({ dataset: { id: b.id } }); await new Promise((r) => setTimeout(r, 50)); const f = document.querySelector('#dlg[open] form[data-f=awatt]');
    f.elements.inv.value = 'קב-12'; await FRM.awatt(f); await new Promise((r) => setTimeout(r, 100));
    const nS = S.tx.length; NAV = [{ v: 'home' }, { v: 'todo' }]; go('inbox', 'sup');
    await ACT.inbOk({ dataset: { id: 'rcS' } }); await new Promise((r) => setTimeout(r, 100)); // ספק אחר – בלי הצעה, נרשמת רגיל
    const nS2 = S.tx.length;
    S.inbox.push({ id: 'rcS2', by: 'עובד', at: '2026-11-04T09:00:00Z', d: { cat: 'e_sup', sub: 'rcSup1', amt: 30, inv: '7002', date: '2026-11-04' } }); render(1);
    await ACT.inbOk({ dataset: { id: 'rcS2' } }); await new Promise((r) => setTimeout(r, 100));
    const offer = [...document.querySelectorAll('#dlg[open] [data-a=awJoin]')].map((x) => x.dataset.e);
    if (offer.includes(c.id)) document.querySelector(`#dlg[open] [data-a=awJoin][data-e="${c.id}"]`).click(); await new Promise((r) => setTimeout(r, 100));
    return { b: { aw: !!b.await, inv: b.inv, creg: b.creg, amt: b.amt }, c: { aw: !!c.await, inv: c.inv, creg: c.creg, amt: c.amt }, offer, cid: c.id, addAtt: nS - n0, addS: nS2 - nS, addS2: S.tx.length - nS2, t0, t1: tot(), aw: tdnL().aw.map((t) => t.src) };
  });
  check('11 הגיעה חשבונית (חיבור ישיר): ההוצאה נסגרה בלי הוצאה חדשה, עם מספר החשבונית, ו-creg נשמר', !r11.b.aw && r11.b.inv === 'קב-12' && r11.b.creg === 'i_nl' && r11.addAtt === 0, r11);
  check('12 חשבונית ספק שהגיעה מעובד: awOffer מציע לחבר להוצאה מקופה שממתינה, והחיבור לא יוצר הוצאה נוספת', r11.offer.includes(r11.cid) && !r11.c.aw && r11.c.inv === '7002' && r11.c.creg === 'i_yh' && r11.addS === 1 && r11.addS2 === 0 && !r11.aw.includes('rcC'), r11);

  // זיכוי (סכום שלילי) בפריט מקופה: ייחוד לחשבונית נחסם; הוצאה לפי קטגוריה – נרשמת כזיכוי רגיל, בלי await ובלי תשלום
  const r13 = await page.evaluate(async () => {
    const n0 = S.tx.length; ACT.inbInv({ dataset: { id: 'rcN' } }); await new Promise((r) => setTimeout(r, 50)); const d1 = !!document.querySelector('#dlg[open] [data-a=inbInvOk]'), n1 = S.tx.length;
    await ACT.inbOk({ dataset: { id: 'rcN', wi: '1' } }); await new Promise((r) => setTimeout(r, 50)); const t = S.tx.filter((x) => x.src === 'rcN');
    return { d1, n1: n1 - n0, t: t.map((x) => ({ amt: x.amt, kind: x.kind, aw: !!x.await, pays: x.pays.length, creg: x.creg })) };
  });
  check('13 זיכוי (סכום שלילי): ייחוד לחשבונית לא נפתח; כהוצאה לפי קטגוריה – זיכוי אחד, בלי "ממתין" ובלי תשלום', !r13.d1 && r13.n1 === 0 && r13.t.length === 1 && r13.t[0].amt === -10 && r13.t[0].kind === 'credit' && !r13.t[0].aw && r13.t[0].pays === 0, r13);

  // "אשר" בפריט מקופה (סבב 3, החלטת המשתמש): חלון בחירת קטגוריה (+ ספק/עובד), ונרשם כשולם במזומן מהקופה – בלי חשבונית, בלי "ממתין", בלי "לתשלום"
  const r20 = await page.evaluate(async () => {
    const W8 = (ms) => new Promise((r) => setTimeout(r, ms || 80));
    const emp = S.cats.find((c) => c.kind === 'exp' && !c.hid && c.beh === 'emp'); if (!S.subs.some((x) => x.id === 'rcEmp1')) S.subs.push({ id: 'rcEmp1', cat: emp.id, name: 'עובד א' });
    S.inbox.push({ id: 'rcQ', by: 'עובד בדיקה', at: '2026-11-03T09:00:00Z', file: 'fQ', d: { reg: true, creg: 'i_yh', cat: 'e_sup', sub: 'rcSup2', amt: 70, date: '2026-11-03', note: 'ירקות', ctm: '11:00' } }); save();
    const tot = () => Math.round(S.tx.filter((t) => t.t === 'exp' && !t.x && (t.date || '').slice(0, 7) === '2026-11').reduce((s, t) => s + t.amt, 0) * 100) / 100;
    NAV = [{ v: 'home' }, { v: 'todo' }]; go('inbox', 'reg');
    const one = async (id, cid, sid) => { const t0 = tot(), n0 = S.tx.length; ACT.inbOk({ dataset: { id, pick: '1' } }); await W8();
      const f = document.querySelector('#dlg[open] form[data-f=inbRegF]'); if (!f) return { nodlg: true }; const pre = { cat: f.elements.cat.value, sub: f.elements.sub ? f.elements.sub.value : '' };
      if (cid && f.elements.cat.value !== cid) { f.elements.cat.value = cid; f.elements.cat.dispatchEvent(new Event('change', { bubbles: true })); await W8(); }
      const f2 = document.querySelector('#dlg[open] form[data-f=inbRegF]'), subOpts = f2.elements.sub ? [...f2.elements.sub.options].map((o) => o.value) : [];
      if (sid) f2.elements.sub.value = sid; f2.querySelector('button:not([type=button])').click(); await W8(200);
      const askM = !!document.querySelector('#dlg[open]'), T = S.tx.filter((t) => t.src === id);
      return { pre, subOpts, askM, n: S.tx.length - n0, d: Math.round((tot() - t0) * 100) / 100, gone: !S.inbox.some((x) => x.id === id), t: T[0] && { cat: T[0].cat, sub: T[0].sub, creg: T[0].creg, aw: !!T[0].await, dn: !!T[0].dn, due: T[0].due || '', plan: T[0].plan, hc: ['2026-11', '2026-12', '2027-01', '2027-02'].map((m) => homeCards(m).due), inv: T[0].inv, pays: T[0].pays.map((p) => ({ m: p.m, a: p.a, d: p.d })), coa: T[0].coa, cod: T[0].cod, cof: T[0].cof, bal: bal(T[0]), owe: S.tx.filter((x) => bal(x) > 0.004).some((x) => x.id === T[0].id), awL: tdnL().aw.some((x) => x.id === T[0].id), no: tdnL().no.some((x) => x.id === T[0].id) } };
    };
    const hc0 = ['2026-11', '2026-12', '2027-01', '2027-02'].map((m) => homeCards(m).due);
    const P = await one('rcP', emp.id, 'rcEmp1'); const Q = await one('rcQ', '', '');
    const W = coWant(), M = coMine(), X = (id, reg, a) => ({ id, uid: 'w', by: 'עובד בדיקה', t: 1, reg, d: '2026-11-03', tm: '', a, why: 'w', dep: '', src: id, zc: '', dp: '' });
    return { hc0, emp: emp.id, P, Q, wP: W.rcP && W.rcP.f, wQ: W.rcQ && W.rcQ.f, vP: coVer(X('rcP', 'i_nl', 15)), vQ: coVer(X('rcQ', 'i_yh', 70)), mP: M.find((x) => x.id === 'rcP'), mQ: M.find((x) => x.id === 'rcQ'), err: document.querySelector('#dlg[open]') ? document.querySelector('#dlg').innerText.slice(0, 100) : '' };
  });
  const P = r20.P, Q = r20.Q; const Q0hc = r20.hc0;
  check('20 "אשר" פותח חלון קטגוריה: הקטגוריה שבפריט מסומנת מראש, והחלפת קטגוריה מחליפה את רשימת הכרטיסים (עובדים)', P.pre && P.pre.cat !== r20.emp && P.subOpts.includes('rcEmp1') && Q.pre.cat === 'e_sup' && Q.pre.sub === 'rcSup2', { P: P.pre, subOpts: P.subOpts, Q: Q.pre });
  check('21 משכורת לעובד במזומן: הוצאה אחת בקטגוריית משכורת, תשלום במזומן בסכום ובתאריך שלה, בלי שאלת מזומן/העברה, ונשמרו creg והסכום/התאריך/הצילום של הקופה', P.n === 1 && P.d === 15 && !P.askM && P.gone && P.t.cat === r20.emp && P.t.sub === 'rcEmp1' && P.t.creg === 'i_nl' && P.t.pays.length === 1 && P.t.pays[0].m === 'מזומן' && P.t.pays[0].a === 15 && P.t.pays[0].d === '2026-11-03' && !P.t.aw && P.t.coa === 15 && P.t.cod === '2026-11-03', P);
  check('22 ספק בלי חשבונית: נשמר (הוצאה אחת), שולם במזומן, יתרה 0, חודש התשלום = חודש ההוצאה (homeCards של החודשים הבאים לא השתנו) – לא ב"לתשלום"/"באיחור", לא "ממתין לחשבונית" ולא "בלי מספר חשבונית"', Q.n === 1 && Q.d === 70 && Q.gone && Q.t.cat === 'e_sup' && Q.t.sub === 'rcSup2' && Q.t.creg === 'i_yh' && !Q.t.inv && !Q.t.aw && !Q.t.dn && !Q.t.due && Q.t.bal === 0 && !Q.t.owe && !Q.t.awL && Q.t.plan === '2026-11' && Q.t.hc[1] === Q0hc[1] && Q.t.hc[2] === Q0hc[2] && Q.t.hc[3] === Q0hc[3] && Q.t.pays.length === 1 && Q.t.pays[0].m === 'מזומן' && Q.t.pays[0].a === 70 && Q.t.cof === 'fQ' && !r20.err, Q);
  check('23 שתי ההוצאות בסגירת הקופה עם creg וסכום נכונים (coWant/coVer/"הוצאה מקופה")', r20.wP && r20.wP.reg === 'i_nl' && r20.wP.a === 15 && r20.wQ && r20.wQ.reg === 'i_yh' && r20.wQ.a === 70 && r20.wQ.tm === '11:00' && r20.vP && r20.vQ && r20.mP && r20.mP.a === 15 && r20.mQ && r20.mQ.reg === 'i_yh' && r20.mQ.a === 70, r20);

  // חשבונית בסכום ובתאריך אחרים מתחברת להוצאה מקופה שממתינה: הסכום, התאריך והצילום של הקופה לא משתנים
  const r21 = await page.evaluate(async () => {
    NAV = [{ v: 'home' }, { v: 'todo' }]; go('inbox', 'reg');
    // 12.11: rcE ו-rcF – אותה קופה, תאריך וסכום – מקבלים אזהרת כפילות; כאן "זה מסמך אחר – שמור בכל זאת"
    const yes = async () => { const y = document.querySelector('#dlg[open] [data-a=yes]'); if (y) { y.click(); await new Promise((r) => setTimeout(r, 80)); } return !!y; };
    await ACT.inbAw({ dataset: { id: 'rcE' } }); await new Promise((r) => setTimeout(r, 50)); await yes(); await ACT.inbAw({ dataset: { id: 'rcF' } }); await new Promise((r) => setTimeout(r, 50)); await yes();
    const e = S.tx.find((t) => t.src === 'rcE'), f = S.tx.find((t) => t.src === 'rcF'), X = (id) => ({ id, uid: 'w', by: 'עובד בדיקה', t: 1, reg: 'i_nl', d: '2026-11-03', tm: '', a: 80, why: 'w', dep: '', src: id, zc: '', dp: '' });
    const W0 = coWant(), h0 = [W0.rcE.h, W0.rcF.h], n0 = S.tx.length;
    awJoin(e, { inv: 'גז-100', date: '2026-11-09', amt: 100, plan: '' }, 'fInvE'); // חשבונית גדולה (100 על 80)
    ACT.awAtt({ dataset: { id: f.id } }); await new Promise((r) => setTimeout(r, 50)); const fm = document.querySelector('#dlg[open] form[data-f=awatt]');
    fm.elements.date.value = '2026-11-09'; fm.elements.a.value = '60'; await FRM.awatt(fm); await new Promise((r) => setTimeout(r, 100)); // חשבונית קטנה (60 על 80)
    const W = coWant(), M = coMine(), rest = S.tx.slice(n0);
    return { e: { amt: e.amt, date: e.date, aw: !!e.await, file: e.file }, f: { amt: f.amt, date: f.date, aw: !!f.await }, wE: W.rcE.f, wF: W.rcF.f, same: W.rcE.h === h0[0] && W.rcF.h === h0[1],
      vE: coVer(X('rcE')), vF: coVer(X('rcF')), fileE: zsCoFile(X('rcE')), mE: M.find((x) => x.id === 'rcE'), mF: M.find((x) => x.id === 'rcF'),
      rest: rest.map((t) => ({ amt: t.amt, aw: !!t.await, creg: t.creg || '' })), restMine: M.filter((x) => rest.some((t) => t.src && t.src === x.id)).length,
      cash: Math.round((rest.reduce((s, t) => s + cashPaid(t), 0) + cashPaid(f)) * 100) / 100 };
  });
  check('24 חשבונית גדולה (100 על 80, תאריך אחר): בחשבונית הסכום 100 והתאריך שלה, אבל בקופה נשארים 80 ו-03/11 (coWant/coVer/סימון), והצילום של הפתק נשמר לסיכום הסגירות', r21.e.amt === 100 && r21.e.date === '2026-11-09' && !r21.e.aw && r21.e.file === 'fInvE' && r21.wE.a === 80 && r21.wE.d === '2026-11-03' && r21.vE && r21.fileE === 'fE' && r21.mE.a === 80 && r21.mE.d === '2026-11-03', r21);
  check('25 חשבונית קטנה (60 על 80, תאריך אחר): בקופה נשארים 80 ו-03/11; היתרה (20) נשארת "ממתין" בלי creg – לא נספרת פעמיים, וסך המזומן ששולם נשאר 80', r21.f.amt === 60 && !r21.f.aw && r21.wF.a === 80 && r21.wF.d === '2026-11-03' && r21.vF && r21.mF.a === 80 && r21.rest.length === 1 && r21.rest[0].amt === 20 && r21.rest[0].aw && !r21.rest[0].creg && r21.restMine === 0 && r21.cash === 80 && r21.same, r21);

  // משיכה חוזרת: מסמך העובד שיוחד לחשבונית (rcA) חוזר מהענן כ-new – לא נכנס שוב ל"לטיפול"; מסמך חדש כן נכנס
  const r23 = await page.evaluate(async () => {
    const D = (id, d) => ({ name: 'projects/p/databases/(default)/documents/inbox/' + id, fields: { status: { stringValue: 'new' }, owner: { stringValue: 'w' }, by: { stringValue: 'עובד בדיקה' }, created: { stringValue: '2026-11-03T09:00:00Z' }, data: { stringValue: JSON.stringify(d) } } });
    const rq = runQ; runQ = async () => [D('rcA', { reg: true, creg: 'i_nl', amt: 80, date: '2026-11-03', note: 'שילמתי לספק' }), D('rcNew9', { reg: true, creg: 'i_nl', amt: 9, date: '2026-11-05', note: 'חדש' })];
    try { await pullInbox2(); } catch (e) { /* */ } finally { runQ = rq; }
    return { ids: S.inbox.map((x) => x.id), reg: todoC().reg };
  });
  check('26 משיכה חוזרת: מסמך שיוחד לחשבונית לא נקלט שוב (אין כפילות), ומסמך חדש כן נקלט', !r23.ids.includes('rcA') && r23.ids.includes('rcNew9'), r23);
  await page.evaluate(() => { S.inbox = S.inbox.filter((x) => x.id !== 'rcNew9'); save(); });

  // ביטול באמצע לא משנה את הפריט; "שמור ואשר" (בדיקה ושינוי) בפריט מקופה – גם הוא נרשם כשולם במזומן מהקופה
  const r27 = await page.evaluate(async () => {
    const W8 = (ms) => new Promise((r) => setTimeout(r, ms || 80)), emp = S.cats.find((c) => c.kind === 'exp' && !c.hid && c.beh === 'emp');
    S.inbox.push({ id: 'rcV', by: 'עובד בדיקה', at: '2026-11-03T09:00:00Z', rq: { n: 'צלם שוב', at: '2026-11-03T10:00:00Z' }, d: { reg: true, creg: 'i_nl', cat: 'e_sup', sub: 'rcSup2', amt: 64, date: '2026-11-03', note: 'ספק' } }); save();
    NAV = [{ v: 'home' }, { v: 'todo' }]; go('inbox', 'reg'); const d0 = JSON.stringify(S.inbox.find((x) => x.id === 'rcV').d), n0 = S.tx.length;
    ACT.inbOk({ dataset: { id: 'rcV', pick: '1' } }); await W8(); const f = document.querySelector('#dlg[open] form[data-f=inbRegF]');
    const cats = [...f.elements.cat.options].map((o) => o.value), bad = S.cats.filter((c) => c.kind === 'exp' && (c.off || c.beh === 'loan')).map((c) => c.id);
    f.elements.cat.value = emp.id; f.elements.cat.dispatchEvent(new Event('change', { bubbles: true })); await W8();
    document.querySelector('#dlg[open] form[data-f=inbRegF] button:not([type=button])').click(); await W8(150);
    const askRq = !!document.querySelector('#dlg[open]'); closeDlg(); await W8(); // ביטול בשאלת "צילום חדש"
    const same = JSON.stringify(S.inbox.find((x) => x.id === 'rcV').d) === d0, n1 = S.tx.length - n0;
    delete S.inbox.find((x) => x.id === 'rcV').rq; save(); render(1);
    const hc0 = ['2026-12', '2027-01', '2027-02'].map((m) => homeCards(m).due);
    ACT.inbEdit({ dataset: { id: 'rcV' } }); await W8(); const g = document.querySelector('#dlg[open] form[data-f=inbsave]'); g.elements.inv.value = '123';
    ACT.inbSaveOk(); await W8(300);
    const T = S.tx.filter((t) => t.src === 'rcV'), t = T[0] || {};
    return { cats, bad, hasBad: cats.some((c) => bad.includes(c)), askRq, same, n1, n: T.length, inv: t.inv, creg: t.creg, pays: (t.pays || []).map((p) => [p.m, p.a]), bal: T[0] ? bal(t) : null, plan: t.plan, aw: !!t.await,
      owe: S.tx.filter((x) => bal(x) > 0.004).some((x) => x.id === t.id), hc: ['2026-12', '2027-01', '2027-02'].map((m) => homeCards(m).due), hc0, coa: t.coa, gone: !S.inbox.some((x) => x.id === 'rcV') };
  });
  check('27 החלון מציג רק קטגוריות פעילות (בלי מוסתרות ובלי הלוואות); ביטול באמצע (שאלת צילום חדש) לא משנה את הפריט ולא רושם הוצאה', !r27.hasBad && r27.askRq && r27.same && r27.n1 === 0, r27);
  check('28 "שמור ואשר" בפריט מקופה (ספק, עם מספר חשבונית): הוצאה אחת, תשלום במזומן 64, יתרה 0, חודש התשלום 11/2026, לא ב"לתשלום" ולא בחודשים הבאים', r27.n === 1 && r27.inv === '123' && r27.creg === 'i_nl' && JSON.stringify(r27.pays) === JSON.stringify([['מזומן', 64]]) && r27.bal === 0 && r27.plan === '2026-11' && !r27.aw && !r27.owe && JSON.stringify(r27.hc) === JSON.stringify(r27.hc0) && r27.coa === 64 && r27.gone, r27);

  // 12.11: מסך הבדיקה – משכורת (אף פעם בלי חשבונית) וספק "לא – בלי חשבונית"
  const r29 = await page.evaluate(async () => {
    const W = (ms) => new Promise((r) => setTimeout(r, ms || 150)), setF = async (n, v) => { const e = document.querySelector('#dlg[open] form[data-f=inbsave]').elements[n]; e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); await W(); };
    const emp = S.cats.find((c) => c.kind === 'exp' && !c.hid && !c.off && c.beh === 'emp'), ex = S.cats.find((c) => c.kind === 'exp' && c.beh === 'simple');
    if (!S.subs.some((x) => x.id === 'rcEmp9')) S.subs.push({ id: 'rcEmp9', cat: emp.id, name: 'עובד ט' });
    S.inbox.push({ id: 'rcSal', by: 'עובד בדיקה', at: '2026-11-03T09:00:00Z', d: { reg: true, creg: 'i_nl', cat: ex.id, amt: 300, date: '2026-11-03', note: 'משכורת' } },
      { id: 'rcSp', by: 'עובד בדיקה', at: '2026-11-03T09:00:00Z', d: { reg: true, creg: 'i_nl', cat: ex.id, amt: 40, date: '2026-11-03', note: 'ירקן' } }); save();
    NAV = [{ v: 'home' }, { v: 'todo' }]; go('inbox', 'reg'); const one = document.querySelector('#main [data-id=rcSal]').closest('.card').querySelectorAll('button[data-a]').length;
    ACT.inbEdit({ dataset: { id: 'rcSal' } }); await setF('cat', emp.id); await setF('sub', 'rcEmp9'); const m1 = document.querySelector('#dlg[open] form[data-f=inbsave]').elements.m.value;
    document.querySelector('#dlg[open] [data-a=inbSaveOk]').click(); await W(400); const dlgSal = !!document.querySelector('#dlg[open]');
    const s = S.tx.filter((t) => t.src === 'rcSal');
    ACT.inbEdit({ dataset: { id: 'rcSp' } }); await setF('cat', 'e_sup'); await setF('sub', 'rcSup1'); document.querySelector('#dlg[open] [data-a=inbSaveOk]').click(); await W(300);
    const ask = !!document.querySelector('#dlg[open] [data-a=inbRegAw]'); document.querySelector('#dlg[open] [data-a=inbRegAw]:not([data-w])').click(); await W(400);
    const p = S.tx.filter((t) => t.src === 'rcSp');
    return { one, m1, dlgSal, s: s.map((t) => ({ sub: t.sub, amt: t.amt, creg: t.creg, pays: (t.pays || []).map((x) => x.m + ':' + x.a), aw: !!t.await })), ask, p: p.map((t) => ({ beh: (cat(t.cat) || {}).beh, aw: !!t.await, creg: t.creg, bal: bal(t), pays: (t.pays || []).map((x) => x.m + ':' + x.a) })), left: S.inbox.filter((x) => x.id === 'rcSal' || x.id === 'rcSp').length };
  });
  check('29 משכורת מקופה: כרטיס עם כפתור אחד, ברירת מחדל מזומן, "שמור ואשר" רושם משכורת אחת ששולמה במזומן מהקופה – בלי שאלה על חשבונית', r29.one === 1 && r29.m1 === 'מזומן' && !r29.dlgSal && r29.s.length === 1 && r29.s[0].sub === 'rcEmp9' && r29.s[0].amt === 300 && r29.s[0].creg === 'i_nl' && r29.s[0].pays.join() === 'מזומן:300' && !r29.s[0].aw, r29);
  check('30 ספק בלי חשבונית פתוחה, "לא – בלי חשבונית": הוצאה אחת ששולמה במזומן מהקופה (לא ממתינה, יתרה 0); שני הפריטים יצאו מהרשימה', r29.ask && r29.p.length === 1 && r29.p[0].beh === 'sup' && !r29.p[0].aw && r29.p[0].creg === 'i_nl' && r29.p[0].bal === 0 && r29.p[0].pays.join() === 'מזומן:40' && r29.left === 0, r29);

  // סגירת קופה: "הוצאה מקופה" לכל קופה, מסומנות אלו של הסגירה האחרונה (2 סגירות, הוצאות בסגירה האחרונה / בקודמת / אחריה), סכום המסומנות מול הסגירה
  const r14 = await page.evaluate(async () => {
    NAV = [{ v: 'home' }]; go('cash'); await new Promise((r) => setTimeout(r, 50));
    const card = (reg) => { const c = document.querySelector(`#main [data-colast=${reg}]`); if (!c) return null; const rows = [...c.querySelectorAll('[data-coid]')].map((r) => [r.dataset.coid, r.dataset.m]);
      return { rows, cs: (c.querySelector('[data-cs]') || {}).textContent, ms: (c.querySelector('[data-ms]') || {}).textContent, ok: (c.querySelector('[data-cok]') || {}).dataset ? c.querySelector('[data-cok]').dataset.cok : null, txt: c.innerText }; };
    const R = coLastR('i_nl', coMine()), ids = coMine().map((x) => x.id);
    return { sec: document.getElementById('main').innerText.includes('הוצאה מקופה'), nl: card('i_nl'), yh: card('i_yh'), s: R.s, cs: R.cs, mk: R.mk.map((x) => x.id).sort(), ids, uniq: new Set(ids).size === ids.length };
  });
  const m = (r, id) => (r14.nl && r14.nl.rows.find((x) => x[0] === id) || [])[1];
  check('14 במשבצת "סגירת קופה והפקדות" יש "הוצאה מקופה" לכל קופה: ההוצאה שיוחדה לחשבונית וזו שנפתחה לפי קטגוריה מופיעות תחת הקופה שלהן (creg)', r14.sec && r14.nl && r14.yh && m(r14, 'rcA') && m(r14, 'rcB') && r14.yh.rows.some((x) => x[0] === 'rcC') && !r14.nl.rows.some((x) => x[0] === 'rcC'), { nl: r14.nl && r14.nl.rows, yh: r14.yh && r14.yh.rows });
  check('15 מסומנות רק ההוצאות של הסגירה האחרונה של אותה קופה (rcA, rcB); של הסגירה הקודמת לא מוצגת, ושאחרי הסגירה – לא מסומנת', m(r14, 'rcA') === '1' && m(r14, 'rcB') === '1' && m(r14, 'rcDW') === '0' && !m(r14, 'rcOldW') && r14.mk.join() === 'rcA,rcB', r14.nl && r14.nl.rows);
  check('16 סכום המסומנות (125) שווה לסכום ההוצאות מקופה בסגירה האחרונה (125), ומוצג "תואם"; לקופה בלי סגירה – אין סימון', r14.s === 125 && r14.cs === 125 && r14.nl.ok === '1' && /125/.test(r14.nl.ms) && /125/.test(r14.nl.cs) && r14.yh.rows.every((x) => x[1] === '0') && /עוד אין סגירה/.test(r14.yh.txt), r14);
  check('17 רשומה ישנה בלי creg וזיכוי של ספק לא מופיעים ולא נספרים, וכל הוצאה מופיעה פעם אחת', !r14.ids.includes('rcLegW') && r14.uniq, r14.ids);

  // 17א. פתק הקופה מוצג גם במשבצת "סגירת קופה והפקדות" (שאלת המשתמש 11.11): בכל מסלול – יוחדה לחשבונית, ממתינה לחשבונית (גם אחרי שהחשבונית חוברה), "אשר"
  const r17a = await page.evaluate(() => { const L = coMine(), f = (id) => { const x = L.find((c) => c.id === id); return x ? coLFile(x) : null; }; NAV = [{ v: 'home' }]; go('cash'); const btn = [...document.querySelectorAll('#main [data-a=coLPic]')].map((b) => b.dataset.id); const withF = L.filter((x) => coLFile(x)).map((x) => x.id); return { A: f('rcA'), E: f('rcE'), Q: f('rcQ'), btn, withF }; });
  check('17א פתק הקופה גם ב"סגירת קופה והפקדות": יוחדה לחשבונית (fA), ממתינה לחשבונית אחרי חיבור חשבונית (fE – הפתק, לא החשבונית), "אשר" (fQ); כפתור "פתק" לכל הוצאה שיש לה צילום', r17a.A === 'fA' && r17a.E === 'fE' && r17a.Q === 'fQ' && r17a.btn.length > 0 && r17a.btn.every((id) => r17a.withF.includes(id)), r17a);

  // הסגירה לא תואמת כשחסרה הוצאה (בדיקה שהסימון באמת משווה)
  const r18 = await page.evaluate(() => { const z = S.zc.find((x) => x.id === 'rcZ2'); z.co.s = 150; z.co.ids = ['rcA', 'rcB', 'rcMissing']; const R = coLastR('i_nl', coMine()); z.co.s = 125; z.co.ids = ['rcA', 'rcB']; return { s: R.s, cs: R.cs, miss: R.miss }; });
  check('18 סגירה עם הוצאה שלא נמצאה במכשיר: סכום המסומנות (125) שונה מהסגירה (150) ומדווח חסר', r18.s === 125 && r18.cs === 150 && r18.miss === 1, r18);
  // 31. פתק "הוצאת מזומן מהקופה" בקטגוריית ספק (12.11): תשלום מהקופה, לא חשבונית – "תאריך התשלום", בלי חודש תשלום לפי תנאי הספק, מספר חשבונית לא חובה;
  // תאריך שזוהה רחוק מסגירת הקופה (2024 במקום 2026) – אזהרה והצעה לתאריך הסגירה; "שמור ואשר" שואל "תגיע חשבונית מהספק בהמשך?"
  const r31 = await page.evaluate(async () => {
    const W = (ms) => new Promise((r) => setTimeout(r, ms || 150)), F = () => document.querySelector('#dlg[open] form[data-f=inbsave]');
    S.zc.push({ id: 'rcZ9', reg: 'i_nl', d: '2026-11-10', tm: '22:00' });
    S.inbox.push({ id: 'rcSlip', by: 'עובד בדיקה', at: '2026-11-10T09:00:00Z', file: 'fSlip', d: { reg: true, creg: 'i_nl', cat: 'e_sup', sub: 'rcSup2', amt: 55, date: '2024-11-10', ctm: '09:02', note: 'אפייה' } },
      { id: 'rcRealInv', by: 'עובד בדיקה', at: '2026-11-10T09:00:00Z', d: { cat: 'e_sup', sub: 'rcSup2', amt: 30, date: '2024-11-10' } }); save();
    NAV = [{ v: 'home' }, { v: 'todo' }]; go('inbox', 'reg'); const cardW = !!document.querySelector('#main [data-datewarn]');
    ACT.inbEdit({ dataset: { id: 'rcSlip' } }); await W(); let f = F();
    const lbl = f.elements.date.closest('label').querySelector('span').textContent, warn = (f.querySelector('[data-datewarn]') || {}).textContent || '', use = f.querySelector('[data-a=inbUseRef]');
    const o1 = { lbl, warn, useD: use && use.dataset.d, plan: !!f.elements.plan, due: !!f.elements.due, invReq: f.elements.inv ? f.elements.inv.required : null, note: !!f.querySelector('[data-regpay]'), dn: !!f.elements.dn };
    use.click(); await W(); f = F(); const o2 = { date: f.elements.date.value, warn: !!f.querySelector('[data-datewarn]') };
    ACT.inbSaveOk(); await W(300);
    if (document.querySelector('#dlg[open] [data-a=inbRegNoInv]')) { document.querySelector('#dlg[open] [data-a=inbRegNoInv]').click(); await W(); }
    const q = (document.querySelector('#dlg[open]') || {}).innerText || ''; const yes = document.querySelector('#dlg[open] [data-a=inbRegAw][data-w]'); if (yes) { yes.click(); await W(300); }
    const t = S.tx.find((x) => x.src === 'rcSlip') || {};
    ACT.inbEdit({ dataset: { id: 'rcRealInv' } }); await W(); const g = F();
    const o3 = { lbl: g.elements.date.closest('label').querySelector('span').textContent, invReq: g.elements.inv && g.elements.inv.required, warn: !!g.querySelector('[data-datewarn]'), plan: !!(g.elements.plan || g.elements.due) };
    closeDlg(); S.inbox = S.inbox.filter((x) => x.id !== 'rcRealInv'); save();
    return { cardW, o1, o2, q: q.slice(0, 300), t: { date: t.date, plan: t.plan, due: t.due || '', aw: !!t.await, inv: t.inv, creg: t.creg, pays: (t.pays || []).map((p) => p.m + ':' + p.a + ':' + p.d) }, o3 };
  });
  check('31א פתק מקופה בקטגוריית ספק: "תאריך התשלום", בלי חודש/תאריך תשלום לפי תנאי הספק, מספר חשבונית לא חובה, בלי "תעודת משלוח"', r31.o1.lbl === 'תאריך התשלום' && !r31.o1.plan && !r31.o1.due && r31.o1.invReq === false && r31.o1.note && !r31.o1.dn, r31.o1);
  check('31ב תאריך שזוהה רחוק מסגירת הקופה (10/11/2024 מול 10/11/2026): אזהרה בכרטיס ובטופס, והצעה לתאריך הסגירה שמחליפה את התאריך ומעלימה את האזהרה', r31.cardW && /סגירת הקופה/.test(r31.o1.warn) && r31.o1.useD === '2026-11-10' && r31.o2.date === '2026-11-10' && !r31.o2.warn, { o1: r31.o1, o2: r31.o2 });
  check('31ג "שמור ואשר" שואל "תגיע חשבונית מהספק בהמשך?"; "כן" – תשלום במזומן מהקופה בתאריך הפתק שממתין לחשבונית, חודש התשלום = חודש הפתק, בלי תאריך תשלום לפי תנאים', /תגיע חשבונית מהספק בהמשך/.test(r31.q) && r31.t.aw && r31.t.date === '2026-11-10' && r31.t.plan === '2026-11' && !r31.t.due && r31.t.creg === 'i_nl' && r31.t.pays.join() === 'מזומן:55:2026-11-10', r31);
  check('31ד חשבונית ספק אמיתית (לא מקופה) בלי שינוי: "תאריך החשבונית", מספר חשבונית חובה, בלי אזהרת תאריך', r31.o3.lbl === 'תאריך החשבונית' && r31.o3.invReq === true && !r31.o3.warn, r31.o3);
  // 32. בודק עצמאי סבב 1: זיכוי ספק בפריט מקופה – השדות הקודמים; תאריך ריק נחסם; משכורת מקופה – "לתשלום" נשאר בכרטיס
  const r32 = await page.evaluate(async () => {
    const W = (ms) => new Promise((r) => setTimeout(r, ms || 150)), F = () => document.querySelector('#dlg[open] form[data-f=inbsave]');
    const emp = S.cats.find((c) => c.kind === 'exp' && !c.hid && !c.off && c.beh === 'emp');
    S.inbox.push({ id: 'rcCrS', by: 'עובד בדיקה', at: '2026-11-10T09:00:00Z', d: { reg: true, creg: 'i_nl', cat: 'e_sup', sub: 'rcSup2', amt: -20, date: '2026-11-10', note: 'החזר' } },
      { id: 'rcNoD', by: 'עובד בדיקה', at: '2026-11-10T09:00:00Z', d: { reg: true, creg: 'i_nl', cat: 'e_sup', sub: 'rcSup2', amt: 12, date: '2026-11-10', note: 'בלי תאריך' } },
      { id: 'rcSalP', by: 'עובד בדיקה', at: '2026-11-10T09:00:00Z', d: { reg: true, creg: 'i_nl', cat: emp.id, sub: 'rcEmp9', amt: 100, date: '2026-11-10', plan: '2026-11', m: 'מזומן', note: 'משכורת' } }); save();
    NAV = [{ v: 'home' }, { v: 'todo' }]; go('inbox', 'reg');
    const salCard = document.querySelector('#main [data-id=rcSalP]').closest('.card').innerText;
    ACT.inbEdit({ dataset: { id: 'rcCrS' } }); await W(); let f = F();
    const cr = { lbl: f.elements.date.closest('label').querySelector('span').textContent, inv: f.elements.inv && f.elements.inv.required, regpay: !!f.querySelector('[data-regpay]'), plan: !!(f.elements.plan || f.elements.due) }; closeDlg();
    ACT.inbEdit({ dataset: { id: 'rcNoD' } }); await W(); f = F(); f.elements.date.value = ''; const n0 = S.tx.length; ACT.inbSaveOk(); await W(300);
    const nd = { n: S.tx.length - n0, still: S.inbox.some((x) => x.id === 'rcNoD'), date: S.inbox.find((x) => x.id === 'rcNoD').d.date }; closeDlg();
    ACT.inbEdit({ dataset: { id: 'rcCrS' } }); await W(); const c0 = S.tx.length; ACT.inbSaveOk(); await W(300); const crN = S.tx.length - c0, crLeft = S.inbox.some((x) => x.id === 'rcCrS'); closeDlg();
    S.inbox = S.inbox.filter((x) => !['rcCrS', 'rcNoD', 'rcSalP'].includes(x.id)); save();
    return { sal: /לתשלום/.test(salCard), cr, nd, crN, crLeft };
  });
  check('32א זיכוי ספק בפריט מקופה (סכום שלילי) – בלי שינוי: "תאריך החשבונית", מספר חשבונית חובה, חודש/תאריך תשלום', r32.cr.lbl === 'תאריך החשבונית' && r32.cr.inv === true && !r32.cr.regpay && r32.cr.plan, r32.cr);
  check('32ב פריט מקופה בלי תאריך: השמירה נחסמת ("חסר תאריך התשלום"), לא נרשם תשלום והפריט לא השתנה', r32.nd.n === 0 && r32.nd.still && r32.nd.date === '2026-11-10', r32.nd);
  check('32ד זיכוי ספק מקופה בלי מספר חשבונית: "שמור ואשר" לא רושם זיכוי והפריט נשאר בתור (כמו ב-main)', r32.crN === 0 && r32.crLeft, r32);
  check('32ג משכורת מקופה: "לתשלום" נשאר בכרטיס כמו קודם', r32.sal, r32);
  // 33. מסך הבדיקה: מסמך עם כמה עמודים – כל העמודים מוצגים (לא רק הראשון)
  const r33 = await page.evaluate(async () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const fg = fget; fget = async (id) => id === 'fMulti' ? 'PAGES:' + JSON.stringify([png, png, png]) : id === 'fOne' ? png : fg(id);
    const one = async (file) => { document.querySelectorAll('#inbDoc').forEach((e) => e.remove()); document.body.insertAdjacentHTML('beforeend', '<div id="inbDoc"></div>'); IE = { id: 'x' + file }; await inbDoc({ id: 'x' + file, file }); const el = document.getElementById('inbDoc'); const r = { imgs: el.querySelectorAll('.zb img').length, txt: el.innerText }; el.remove(); return r; };
    try { return { m: await one('fMulti'), o: await one('fOne') }; } finally { fget = fg; IE = null; }
  });
  check('33 מסמך של 3 עמודים במסך הבדיקה: 3 תמונות עם "עמוד X מתוך 3"; מסמך של עמוד אחד – תמונה אחת בלי מספור', r33.m.imgs === 3 && /עמוד 3 מתוך 3/.test(r33.m.txt) && r33.o.imgs === 1 && !/מתוך/.test(r33.o.txt), r33);
  check('19 אין שגיאות JS', page.__errors.length === 0, page.__errors);
  await ctx.close(); await browser.close();
  if (out) fs.writeFileSync(out, JSON.stringify({ fail, res }, null, 1));
  console.log(fail ? `נכשלו ${fail}` : 'הכול עבר'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
