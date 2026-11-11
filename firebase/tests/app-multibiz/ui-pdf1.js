'use strict';
// עובד שולח PDF ששותף לאפליקציה: חתימת %PDF, גבול 6MB, אותו מסלול (outbox → chunks → inbox, סניף), תמונה לא נשברה, מנהל פותח PDF.
// שימוש: NODE_PATH=... node ui-pdf1.js <www-dir>
const H = require('./harness');
const BZ0 = ['larg', 'peami'].join('');
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
let fail = 0; const check = (n, ok, info) => { if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const ORG = { branches: [{ id: 'bra', name: 'נחל לכיש', on: true, sig: [] }, { id: 'brb', name: 'יהודה הנשיא', on: true, sig: [] }] };
(async () => {
  const [www] = process.argv.slice(2); const browser = await H.launch();
  const cfg = { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: ALL } }, admins: { '|m': 1 }, staff: { '|w': 1 } };
  const w = await H.newPage(browser, www, cfg, [], 'w'); const wp = w.page; await wp.setViewportSize({ width: 360, height: 740 }); await H.login(wp, 'w@x.co');
  // 1. קליטה: PDF אמיתי, PDF מזויף (בלי חתימה), PDF גדול מ-6MB, ותמונה
  const t1 = await wp.evaluate(async (org) => {
    localStorage.setItem(CK, JSON.stringify({ cats: [{ id: 'e_sup', name: 'ספקים', beh: 'sup', subs: [{ id: 's1', name: 'ספק' }] }], org })); SY.br = ['bra', 'brb'];
    const b64 = (s) => btoa(s); const real = 'data:application/pdf;base64,' + b64('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
    const fake = 'data:application/pdf;base64,' + b64('<html><script>alert(1)</script>');
    const bigBody = '%PDF-1.4\n' + 'A'.repeat(6400000); const big = 'data:application/pdf;base64,' + btoa(bigBody);
    const c = document.createElement('canvas'); c.width = 60; c.height = 40; c.getContext('2d').fillRect(0, 0, 10, 10); const img = c.toDataURL('image/png');
    window.toast = () => {}; await siIn([{ name: 'real.pdf', du: real }, { name: 'fake.pdf', du: fake }, { name: 'big.pdf', du: big }, { name: 'pic.png', du: img }]); closeDlg && closeDlg();
    const L = siL(); WS = 'home'; rerender(); await new Promise((r) => setTimeout(r, 200));
    const row = (n) => { const x = L.find((y) => y.name === n); const el = x && document.querySelector(`[data-si="${x.id}"]`); return { has: !!x, send: !!(el && el.querySelector('[data-a=siWk]')), txt: el ? el.textContent : '' }; };
    return { real: row('real.pdf'), fake: row('fake.pdf'), big: row('big.pdf'), pic: row('pic.png'), old: /בינתיים עובד שולח רק תמונה/.test(document.body.textContent) };
  }, ORG);
  check('1 PDF אמיתי מוצג עם כפתור שליחה; ההודעה הישנה נעלמה', t1.real.has && t1.real.send && !t1.old, t1.real);
  check('1א PDF מזויף (בלי %PDF) לא נקלט', !t1.fake.has, t1.fake);
  check('1ב PDF גדול מ-6MB: בלי כפתור שליחה, עם הסבר', t1.big.has && !t1.big.send && /6MB/.test(t1.big.txt), t1.big);
  check('1ג תמונה: עדיין עם כפתור שליחה', t1.pic.has && t1.pic.send, t1.pic);
  // 2. שליחה: siWk → מסך ידני, בלי כפתורי צילום/זיהוי; wkSubmit עם סניף → outbox; pushItem → chunks שמתחברים בדיוק ל-PDF, inbox עם br
  const t2 = await wp.evaluate(async () => {
    const x = siL().find((y) => y.name === 'real.pdf'); await ACT.siWk({ dataset: { id: x.id } }); await new Promise((r) => setTimeout(r, 150));
    const scr = { ws: WS, pdf: wkPdf(), pick: !!document.querySelector('[data-c=wkpick]'), go: !!document.querySelector('[data-a=wkGo],[data-a=wkCoScan]'), lbl: /קובץ PDF מצורף/.test(document.body.textContent) };
    const src = WK.pages[0]; localStorage.removeItem(OB); const of = window.flush, ol = window.wkLoad; window.flush = async () => {}; window.wkLoad = async () => {};
    await wkSubmit({ cat: 'e_sup', sub: 's1', amt: '50', date: '2026-11-02', inv: 'P1', note: '', br: 'brb' }); window.flush = of; window.wkLoad = ol;
    const it = obGet().pop(); const reqs = []; const ofs = window.fsx; window.fsx = async (p, o) => { reqs.push({ p, b: o && o.body ? JSON.parse(o.body) : null }); return {}; };
    try { await pushItem(it); } finally { window.fsx = ofs; }
    const ch = reqs.filter((r) => r.p.startsWith('/chunks')); const inb = reqs.find((r) => r.p.startsWith('/inbox'));
    const joined = ch.map((r) => r.b.fields.data.stringValue).join('');
    return { scr, same: joined === src, n: ch.length, parts: inb && inb.b.fields.parts.stringValue, br: inb && inb.b.fields.br && inb.b.fields.br.stringValue, owner: ch.every((r) => r.b.fields.owner.stringValue === SY.uid), dropped: !siL().some((y) => y.name === 'real.pdf') };
  });
  check('2 לחיצה על שליחה: מסך הכנסה ידנית עם ה-PDF, בלי צילום/זיהוי', t2.scr.ws === 'manual' && t2.scr.pdf && !t2.scr.pick && !t2.scr.go && t2.scr.lbl, t2.scr);
  check('2א נשלח באותו מסלול: chunks מתחברים בדיוק ל-PDF, inbox עם סניף ו-owner', t2.same && t2.n >= 1 && String(t2.parts) === String(t2.n) && t2.br === 'brb' && t2.owner, t2);
  check('2ב המסמך יצא מרשימת "מסמכים שהתקבלו"', t2.dropped, t2);
  // 3. גבול 6MB: PDF של 6MB בדיוק עובר ב-12 חלקים (≤12, ≤700000 תווים לחלק = חוקי Firestore)
  const t3 = await wp.evaluate(() => { const du = 'data:application/pdf;base64,JVBERi0' + 'A'.repeat(Math.ceil(WK_PDF * 4 / 3) - 7); return { b: pdfB(du) <= WK_PDF + 2, n: Math.ceil(du.length / CH) }; });
  check('3 PDF בגודל המקסימלי נכנס ב-12 חלקים לכל היותר', t3.b && t3.n <= 12, t3);
  check('3א אין שגיאות JS (עובד)', wp.__errors.length === 0, wp.__errors);
  // 4. מנהל: viewImg פותח PDF אמיתי כ-application/pdf; PDF מזויף לא נפתח כ-PDF
  const m = await H.newPage(browser, www, cfg, [], 'm'); const mp = m.page; await H.login(mp, 'm@x.co');
  const t4 = await mp.evaluate(async () => {
    const opened = []; window.open = (u) => { opened.push(u); return {}; }; const ocu = URL.createObjectURL; const types = []; URL.createObjectURL = (b) => { types.push(b.type); return ocu(b); };
    const real = 'data:application/pdf;base64,' + btoa('%PDF-1.4\n%%EOF'), fake = 'data:application/pdf;base64,' + btoa('<html>x</html>');
    await fput('iP1', real); await fput('iP2', fake); await viewImg('iP1', 'a'); await viewImg('iP2', 'b');
    S.inbox.push({ id: 'P1', by: 'w', ow: 'u', at: '', d: { amt: 50, date: '2026-11-02', cat: '', sub: '' }, file: 'iP1', np: 1 }); IE = { id: 'P1' };
    document.body.insertAdjacentHTML('beforeend', '<div id="inbDoc"></div>'); await inbDoc(S.inbox[S.inbox.length - 1]);
    return { types, opened: opened.length, btn: !!document.querySelector('#inbDoc [data-a=inbView]') };
  });
  check('4 מנהל: PDF אמיתי נפתח כ-PDF; מזויף רק כהורדה (octet-stream)', t4.types[0] === 'application/pdf' && t4.types[1] === 'application/octet-stream' && t4.opened === 1, t4);
  check('4א מנהל: במסך הבדיקה מופיע כפתור "פתיחת המסמך"', t4.btn, t4);
  check('4ב אין שגיאות JS (מנהל)', mp.__errors.length === 0, mp.__errors);
  await w.ctx.close(); await m.ctx.close(); await browser.close(); console.log(fail ? 'נכשלו ' + fail : 'כל הבדיקות עברו'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
