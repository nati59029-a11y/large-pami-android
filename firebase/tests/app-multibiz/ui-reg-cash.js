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
      Object.assign(it('rcS', { cat: 'e_sup', sub: 'rcSup2', amt: 117, inv: '5501' }), { d: { cat: 'e_sup', sub: 'rcSup2', amt: 117, inv: '5501', date: '2026-11-03' } }),
    ];
    S.zc = [{ id: 'rcZ1', reg: 'i_nl', d: '2026-11-01', tm: '22:00', tx: [], co: { z: 50, s: 50, ids: ['rcOldW'], ok: 1, done: 1 } },
      { id: 'rcZ2', reg: 'i_nl', d: '2026-11-03', tm: '22:00', tx: [], co: { z: 125, s: 125, ids: ['rcA', 'rcB'], ok: 1, done: 1 } }];
    save(); try { await coSync(); } catch (e) { /* */ } // המראה של rcA נרשם במטמון (כמו במכשיר אמיתי) – כדי לבדוק שאחרי הייחוד הוא לא נמחק
    NAV = [{ v: 'home' }, { v: 'todo' }]; go('inbox', 'reg');
    const card = (id) => { const b = document.querySelector(`#main [data-id=${id}]`); return b && b.closest('.card'); };
    const btns = (id) => { const c = card(id); return c ? [...c.querySelectorAll('button[data-a]')].map((b) => b.dataset.a + (b.dataset.wi ? ':wi' : '')) : []; };
    const R = ['rcA', 'rcB', 'rcC'].map((id) => [id, btns(id)]);
    NAV.pop(); go('inbox', 'sup'); const sup = btns('rcS');
    return { R, sup, ttl: document.getElementById('ttl').innerText };
  });
  check('3 לכל פריט "הוצאה מקופה" שתי אפשרויות: ייחוד לחשבונית ספק, והוצאה לפי קטגוריה שממתינה לחשבונית (ובלי "אשר" רגיל)', r3.R.every(([, b]) => b.includes('inbInv') && b.includes('inbOk:wi') && !b.includes('inbOk')), r3.R);
  check('4 חשבונית ספק רגילה (לא מקופה) – "אשר" הרגיל לא השתנה, בלי האפשרויות החדשות', r3.sup.includes('inbOk') && !r3.sup.includes('inbInv') && !r3.sup.includes('inbOk:wi'), r3.sup);

  // (א) ייחוד לחשבונית קיימת
  const r5 = await page.evaluate(async () => {
    const tot = () => Math.round(S.tx.filter((t) => t.t === 'exp' && !t.x && (t.date || '').slice(0, 7) === '2026-11').reduce((s, t) => s + t.amt, 0) * 100) / 100;
    const t0 = tot(), n0 = S.tx.length; NAV = [{ v: 'home' }, { v: 'todo' }]; go('inbox', 'reg');
    document.querySelector('#main [data-a=inbInv][data-id=rcA]').click(); await new Promise((r) => setTimeout(r, 100));
    const L = [...document.querySelectorAll('#dlg[open] [data-a=inbInvOk]')].map((b) => b.dataset.t);
    document.querySelector('#dlg[open] [data-a=inbInvOk][data-t=rcInv1]').click(); await new Promise((r) => setTimeout(r, 100));
    const inv = S.tx.find((t) => t.id === 'rcInv1'), p = inv.pays[inv.pays.length - 1];
    return { L, t0, t1: tot(), n: S.tx.length - n0, p, bal: bal(inv), st: stOf(inv), inDue: S.tx.filter((t) => bal(t) > 0.004).some((t) => t.id === 'rcInv1'), gone: !S.inbox.some((x) => x.id === 'rcA'), dlg: !!document.querySelector('#dlg[open]') };
  });
  check('5 ייחוד: רשימת החשבוניות הפתוחות – קודם אותו ספק ואותו סכום, בלי זיכוי ובלי חשבונית שהיתרה בה קטנה מההוצאה', r5.L[0] === 'rcInv1' && r5.L.includes('rcInv2') && !r5.L.includes('rcCr'), r5.L);
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
    await ACT.inbOk(document.querySelector('#main [data-a=inbOk][data-wi][data-id=rcB]')); await new Promise((r) => setTimeout(r, 100));
    await ACT.inbOk(document.querySelector('#main [data-a=inbOk][data-wi][data-id=rcC]')); await new Promise((r) => setTimeout(r, 100));
    const B = S.tx.filter((t) => t.src === 'rcB'), C = S.tx.filter((t) => t.src === 'rcC'), aw = tdnL().aw.map((t) => t.src);
    NAV = [{ v: 'home' }]; go('todo'); const todo = document.getElementById('main').innerText.includes('שולם – ממתין לחשבונית');
    return { t0, t1: tot(), B, C, aw, todo, left: S.inbox.map((x) => x.id), dlg: !!document.querySelector('#dlg[open]') };
  });
  const B = r9.B[0] || {}, C = r9.C[0] || {};
  check('9 הוצאה לפי קטגוריה: נרשמה פעם אחת, עם creg נכון, שולמה במזומן, ומסומנת "ממתין לחשבונית"; הסכום בחודש עלה בדיוק בסכום ההוצאות', r9.B.length === 1 && r9.C.length === 1 && B.creg === 'i_nl' && C.creg === 'i_yh' && B.await === 1 && C.await === 1 && B.pays.length === 1 && B.pays[0].m === 'מזומן' && B.pays[0].a === 45 && r9.t1 === Math.round((r9.t0 + 45 + 30) * 100) / 100 && !r9.dlg, r9);
  check('10 קטגוריית ספק בלי מספר חשבונית – לא נחסמת ("ממתין לחשבונית"), ושתיהן ברשימה הקיימת "שולם – ממתין לחשבונית"', C.sub === 'rcSup1' && !C.dn && r9.aw.includes('rcB') && r9.aw.includes('rcC') && r9.todo && r9.left.join() === 'rcN,rcS', r9);

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

  // הסגירה לא תואמת כשחסרה הוצאה (בדיקה שהסימון באמת משווה)
  const r18 = await page.evaluate(() => { const z = S.zc.find((x) => x.id === 'rcZ2'); z.co.s = 150; z.co.ids = ['rcA', 'rcB', 'rcMissing']; const R = coLastR('i_nl', coMine()); z.co.s = 125; z.co.ids = ['rcA', 'rcB']; return { s: R.s, cs: R.cs, miss: R.miss }; });
  check('18 סגירה עם הוצאה שלא נמצאה במכשיר: סכום המסומנות (125) שונה מהסגירה (150) ומדווח חסר', r18.s === 125 && r18.cs === 150 && r18.miss === 1, r18);
  check('19 אין שגיאות JS', page.__errors.length === 0, page.__errors);
  await ctx.close(); await browser.close();
  if (out) fs.writeFileSync(out, JSON.stringify({ fail, res }, null, 1));
  console.log(fail ? `נכשלו ${fail}` : 'הכול עבר'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
