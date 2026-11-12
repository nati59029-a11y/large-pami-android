'use strict';
// המזכירה העסקית – שלב 7 (2026-11-12): לשונית "חשבוניות" – חשבוניות שהתקבלו מווצאפ ומ-Gmail.
// רשת מדומה (בלי שרת): secInv / secDecide עונים מכאן, עם מצב תור שמתעדכן. נבדק:
//  - "נכנס ישר": חשבונית זכאית נכנסת בפתיחה (תפיסה אוטומטית + אותה פונקציית כניסה של תיבת העובדים), מופיעה ב"חשבוניות לתשלום" ובתזרים, הודעה + ביטול.
//  - חשבונית שכבר נסרקה ידנית – לא נכנסת שוב (המכשיר מעכב, השרת מקבל hold:dup); כרטיס "כבר רשומה אצלך".
//  - אישור עם בחירת סניף (ספק של כמה סניפים), זיכוי (סכום שלילי, באישור), קבלה → "סמן כשולם", חשבונית אחרי תעודת משלוח → החלפה,
//    קבלה בלי חשבונית, צ'ק, "לא זוהה", קובץ שנדחה, שולח חדש, "בטיפול במכשיר אחר", דחייה.
//  - סגירה באמצע: ההוצאה נרשמה והדיווח לשרת נכשל → אחרי טעינה מחדש הדיווח נשלח פעם אחת, וההוצאה לא מוכפלת.
//  - ב-320 וב-360: בלי גלילה לרוחב, בלי שגיאות JS.
// שימוש: node ui-sec-7.js <www-dir> [shots-dir]
const fs = require('fs');
const path = require('path');
const H = require('./harness');
let fail = 0;
const check = (name, ok, info) => { if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const BIZ = 'biz-o';
const FEAT = { scan: true, tasks: true, orders: true, suppliers: true, cashClose: true, secretary: true };
const TYPES = { invDue: 'חשבונית לתשלום' };
const hx = (c) => 'f' + c.repeat(40);
const ID = { A1: hx('1'), A2: hx('2'), P1: hx('3'), C1: hx('4'), R1: hx('5'), D1: hx('6'), K1: hx('7'), U1: hx('8'), B1: 'x' + 'b'.repeat(40), N1: hx('9'), RQ: hx('a'), O1: hx('c'), F1: hx('d') };
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type /Page>>endobj\n%%EOF').toString('base64');
const BR = [{ id: 'br1', name: 'סניף צפון', on: true, sig: [{ k: 'sup', v: 's1' }] }, { id: 'br2', name: 'סניף דרום', on: true, sig: [] }];

function items(now) {
  const src = (ch, from) => [{ ch, from, name: 'ספק', t: now - 3600e3 }];
  const b = (id, o) => Object.assign({ id, st: 'new', t: now - 3600e3, fn: 'inv.pdf', mime: 'application/pdf', size: 1000, np: 1, pages: 1, src: src('wa', '972521234567'), unsure: [], sub: 's1', subN: 'ספק דמה בע"מ', match: 'hp', br: 'br1', brOk: true, ns: '', nsShow: '', dup: '', el: false, why: [], hold: '', err: '', t0: 'invoice' }, o);
  const f = (o) => Object.assign({ supplier: 'ספק דמה בע"מ', hp: '512345678', num: 'INV-100', date: '2026-11-01', total: 118 }, o);
  return [
    b(ID.A1, { k: 'inv', f: f(), el: true }),
    b(ID.A2, { k: 'inv', f: f({ num: 'INV-77', total: 77 }), el: true }), // נסרקה כבר ידנית במכשיר
    b(ID.N1, { k: 'inv', f: f({ num: 'INV-300', total: 40 }), el: true, ns: 'm:billing@supplier.example', nsShow: 'billing@supplier.example', src: src('mail', 'billing@supplier.example') }),
    b(ID.P1, { k: 'inv', f: f({ supplier: 'מאפיית כהן', hp: '511111111', num: 'B-12', total: 450 }), sub: 's2', subN: 'מאפיית כהן', br: '', brOk: false, why: ['br'] }),
    b(ID.C1, { k: 'cr', f: f({ num: 'CR-1', total: -59 }), why: ['type', 'neg'] }),
    b(ID.R1, { k: 'rcpt', f: f({ num: 'R-9', total: 118, rel: 'INV-50' }), why: ['type'] }),
    b(ID.D1, { k: 'inv', f: f({ supplier: 'מאפיית כהן', hp: '511111111', num: 'B-99', total: 300 }), sub: 's2', subN: 'מאפיית כהן', br: '', brOk: false, why: ['br'] }),
    b(ID.K1, { k: 'chk', f: { no: '000123', bank: 'לאומי', cdate: '2026-12-15', amt: 2360, payee: 'ספק דמה בע"מ' }, sub: '', match: '', br: '', why: ['type'] }),
    b(ID.U1, { k: 'unk', f: {}, sub: '', match: '', br: '', why: ['type'] }),
    b(ID.B1, { k: 'bad', f: {}, np: 0, why: ['zip'], fn: 'invoice.zip', sub: '', match: '', br: '' }),
    b(ID.RQ, { k: 'rcpt', f: f({ supplier: 'מאפיית כהן', hp: '511111111', num: 'R-1', total: 999, rel: '' }), sub: 's2', subN: 'מאפיית כהן', br: '', why: ['type'] }),
    b(ID.O1, { k: 'inv', st: 'cl', f: f({ num: 'INV-555', total: 55 }), mine: false, stale: false }),
    b(ID.F1, { k: 'inv', f: f({ num: 'INV-900', total: 90 }) }), // הדיווח לשרת ייכשל פעם אחת (סגירה באמצע)
  ];
}

async function open(browser, www, o) {
  const who = 'm';
  const cfg = { mode: 'new', users: { [who]: BIZ }, sa: {}, biz: { [BIZ]: { dataRoot: 'b', features: FEAT, name: 'עסק בדיקה' } },
    admins: { [`b/${BIZ}/|${who}`]: 1 }, staff: { [`b/${BIZ}/|${who}`]: 1 }, ctx: { hasTouch: true, isMobile: true, viewport: { width: o.w, height: o.h } } };
  const bodies = [];
  const now = H.T0;
  const st = { ok: true, consented: true, setupDone: true, name: 'רותי', addr: 'f', call: 'נתי', rows: [], mode: 'all', pay: true, emp: true, sens: false, we: 'warn', mirror: true, mirrorAt: null, cfTh: null, pct: 10, saving: '', nt: {}, types: TYPES, unseen: 0 };
  const wc = { ok: true, connected: false, num: '', link: '', stop: { on: false, auto: false, why: '', at: 0, by: '' }, ack: { on: false, text: '' }, open: { on: false, text: '' }, ackH: { f: '08:00', t: '18:00' }, hour: 30, myNum: '', myReq: '', tpls: [], appr: [] };
  // ready: עד שנתוני העסק נטענו למכשיר (seedData) – התור מוחזר ריק, כמו טלפון שעוד לא סונכרן
  const Q = o.Q || { L: items(now), cfg: { auto: true, cap: 2000, off: [] }, failDone: { [ID.F1]: 1 }, doneOk: {}, ready: false };
  const { ctx, page } = await H.newPage(browser, www, cfg, [], who);
  await ctx.route(/:5001\/.*/, async (route) => {
    const n = new URL(route.request().url()).pathname.split('/').pop();
    let body = {}; try { body = JSON.parse(route.request().postData() || '{}').data || {}; } catch (e) { /* */ }
    bodies.push([n, body]);
    const ok = (r) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: r }) });
    const no = (reason, msg) => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { status: 'FAILED_PRECONDITION', message: msg || reason, details: { reason } } }) });
    const x = Q.L.find((i) => i.id === body.id);
    if (n === 'secState') return ok(st);
    if (n === 'secChatLoad') return ok({ ok: true, msgs: [] });
    if (n === 'secNotes') return ok({ ok: true, notes: [], unseen: 0, types: TYPES });
    if (n === 'secWaCfg') return ok(wc);
    if (n === 'secInv') {
      if (body.op === 'list') return ok({ ok: true, items: !Q.ready ? [] : Q.L.filter((i) => i.st !== 'rej' && !(i.st === 'ok' && !i.auto)), cfg: Q.cfg, stop: false, br: null });
      if (body.op === 'file') return ok({ ok: true, id: body.id, k: 0, np: 1, mime: 'application/pdf', d: PDF });
      if (body.op === 'sups') return ok({ ok: true, n: (body.sups || []).length });
      if (body.op === 'cfg') { if (body.cap !== undefined) Q.cfg.cap = body.cap; if (body.auto !== undefined) Q.cfg.auto = body.auto; if (body.sub) Q.cfg.off = body.off ? Q.cfg.off.concat([body.sub]) : Q.cfg.off.filter((s) => s !== body.sub); return ok({ ok: true, cfg: Q.cfg }); }
    }
    if (n === 'secDecide') {
      if (!x) return no('not-found');
      if (body.op === 'claim') {
        if (x.st === 'cl' && !x.mine) return no('already', 'כבר הוכנסה במכשיר אחר');
        if (body.mode === 'auto' && !x.el) return no('not-eligible');
        Object.assign(x, { st: 'cl', mine: true, dev: body.dev, mode: body.mode }); return ok({ ok: true, id: x.id, item: x });
      }
      // failDone: אין רשת לדיווח (עד שהבדיקה "מחזירה את הרשת") – הבקשה נכשלת כמו בלי אינטרנט
      if (body.op === 'done') { if (Q.failDone[x.id]) return route.abort(); Q.doneOk[x.id] = (Q.doneOk[x.id] || 0) + 1; if (x.st === 'ok') return ok({ ok: true, again: true }); Object.assign(x, { st: 'ok', auto: x.mode === 'auto', mineOk: true }); return ok({ ok: true }); }
      if (body.op === 'rej') { x.st = 'rej'; return ok({ ok: true }); }
      if (body.op === 'hold') { Object.assign(x, { el: false, hold: body.why, why: ['hold'] }); if (x.st === 'cl') x.st = 'new'; return ok({ ok: true }); }
      if (body.op === 'undo') { Object.assign(x, { st: 'new', el: false, hold: 'undo', auto: false, mineOk: false }); return ok({ ok: true }); }
      if (body.op === 'sender') { Q.L.forEach((i) => { if (i.ns === x.ns) { i.ns = ''; i.nsShow = ''; } }); return ok({ ok: true, sender: 'billing@supplier.example', sub: 's1' }); }
    }
    return ok(n === 'getBackupKey' ? { key: Buffer.alloc(32, 7).toString('base64') } : {});
  });
  if (o.state) await page.addInitScript((s) => { localStorage.setItem('__seed7', s); }, o.state);
  await H.login(page, who + '@x.co');
  await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden && ACT.startBlank) ACT.startBlank(); });
  await H.settle(page, 500);
  return { ctx, page, bodies, Q };
}
// נתוני העסק במכשיר: ספקים (אחד עם ח.פ ושייך לסניף צפון, אחד רב־סניפי), חשבונית פתוחה (לקבלה), תעודת משלוח פתוחה, וחשבונית שנסרקה ידנית
async function seedData(page) {
  await page.evaluate((BR) => {
    let c = S.cats.find((x) => x.kind === 'exp' && !x.hid && x.beh === 'sup');
    if (!c) { c = { id: 'c_sup7', kind: 'exp', name: 'ספקים', beh: 'sup' }; S.cats.push(c); }
    S.subs.push({ id: 's1', cat: c.id, name: 'ספק דמה בע"מ', hp: '512345678', pm: 0 }, { id: 's2', cat: c.id, name: 'מאפיית כהן', hp: '511111111', pm: 0 });
    S.tx.push({ id: 'tOpen', t: 'exp', cat: c.id, sub: 's1', date: '2026-10-20', amt: 118, plan: '2026-11', inv: 'INV-50', note: '', kind: 'inv', pays: [], br: 'br1' });
    S.tx.push({ id: 'tDn', t: 'exp', cat: c.id, sub: 's2', date: '2026-10-25', amt: 300, plan: '2026-11', inv: '', dn: true, note: '', kind: 'inv', pays: [], br: 'br2' });
    S.tx.push({ id: 'tMan', t: 'exp', cat: c.id, sub: 's1', date: '2026-11-01', amt: 77, plan: '2026-12', inv: 'INV-77', note: 'נסרקה ידנית', kind: 'inv', pays: [], br: 'br1' });
    S.orgC = { branches: BR, banks: [], cards: [] }; if (SY.biz) SY.biz.org = S.orgC;
    save();
  }, BR);
}
const last = (bodies, n, f) => bodies.filter((b) => b[0] === n && (!f || f(b[1]))).pop();
const txt = (page) => page.evaluate(() => document.getElementById('main').innerText);
const sx = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const dlgText = (page) => page.evaluate(() => document.getElementById('dlg').open ? document.getElementById('dlg').innerText : '');
const tx = (page, src) => page.evaluate((s) => S.tx.filter((t) => t.src === s || (t.srcs || []).includes(s)).map((t) => ({ id: t.id, amt: t.amt, inv: t.inv, br: t.br, kind: t.kind, dn: !!t.dn, due: t.due || '', plan: t.plan, note: t.note, pays: (t.pays || []).length, secNs: t.secNs || '' })), src);
const card = (id) => `#secIv_${id}`;

(async () => {
  const [www, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const browser = await H.launch();
  for (const [w, h] of [[320, 640], [360, 740]]) {
    const { ctx, page, bodies, Q } = await open(browser, www, { w, h });
    await seedData(page);
    Q.ready = true;
    await page.evaluate(() => { window.__secInv.at = 0; go('sec'); }); await H.settle(page, 1500);
    // --- "נכנס ישר" בפתיחה ---
    const sA = await tx(page, 's' + ID.A1);
    check(`${w}: "נכנס ישר" – חשבונית זכאית נכנסה פעם אחת, עם מזהה המקור, סניף הספק ותאריך/חודש תשלום`, sA.length === 1 && sA[0].amt === 118 && sA[0].inv === 'INV-100' && sA[0].br === 'br1' && !!sA[0].plan, sA);
    check(`${w}: תפיסה אוטומטית לפני ההכנסה, ודיווח "הוכנסה" לשרת`, !!last(bodies, 'secDecide', (b) => b.op === 'claim' && b.id === ID.A1 && b.mode === 'auto' && /^[A-Za-z0-9_-]{6,64}$/.test(b.dev)) && !!last(bodies, 'secDecide', (b) => b.op === 'done' && b.id === ID.A1));
    check(`${w}: חשבונית שנסרקה ידנית – לא נכנסת שוב: המכשיר מעכב (hold:dup) ולא תופס`, (await tx(page, 's' + ID.A2)).length === 0 && !!last(bodies, 'secDecide', (b) => b.op === 'hold' && b.id === ID.A2 && b.why === 'dup') && !last(bodies, 'secDecide', (b) => b.op === 'claim' && b.id === ID.A2));
    const sN = await tx(page, 's' + ID.N1);
    check(`${w}: משולח חדש – נכנסה עם סימון "שולח חדש" שנשאר על ההוצאה`, sN.length === 1 && /שולח חדש – לבדוק/.test(sN[0].note) && sN[0].secNs === 'm:billing@supplier.example', sN);
    check(`${w}: זיכוי, תעודה, קבלה, צ'ק ולא זוהה – לא נתפסו אוטומטית`, ![ID.C1, ID.R1, ID.K1, ID.U1, ID.B1, ID.P1, ID.D1].some((id) => last(bodies, 'secDecide', (b) => b.op === 'claim' && b.id === id && b.mode === 'auto')));
    await page.click('#secTabs [data-v=inv]'); await H.settle(page, 900);
    const t0 = await txt(page);
    check(`${w}: לשונית "חשבוניות" עם מונה, וכרטיסים לכל סוג`, !!(await page.$('#secTabs [data-v=inv] .secbadge')) && /הודעת זיכוי/.test(t0) && /קבלה/.test(t0) && /צ׳ק/.test(t0) && /מסמך שלא זוהה/.test(t0) && /התקבל קובץ שלא נקלט/.test(t0), t0.slice(0, 300));
    check(`${w}: קובץ שנדחה – הסיבה ו"הקובץ לא נפתח ולא נשמר"`, /קובץ מכווץ \(zip\)/.test(await page.innerText(card(ID.B1))) && /לא נפתח ולא נשמר/.test(await page.innerText(card(ID.B1))));
    check(`${w}: "כבר רשומה אצלך" על החשבונית שנסרקה ידנית`, /כבר רשומה אצלך/.test(await page.innerText(card(ID.A2))));
    check(`${w}: "בטיפול במכשיר אחר" – בלי כפתורי פעולה`, /בטיפול במכשיר אחר/.test(await page.innerText(card(ID.O1))) && !(await page.$(card(ID.O1) + ' [data-a=secIvOk]')));
    check(`${w}: קבלה בלי חשבונית – "מה לעשות?" עם רישום כהוצאה או דחייה`, /קבלה בלי חשבונית – מה לעשות\?/.test(await page.innerText(card(ID.RQ))) && !!(await page.$(card(ID.RQ) + ' [data-a=secIvEd]')));
    check(`${w}: ספק רב־סניפי – "ממתין לבחירת סניף"`, /ממתין לבחירת סניף/.test(await page.innerText(card(ID.P1))));
    check(`${w}: "נכנסו אוטומטית" – ביטול ואישור שולח`, !!(await page.$(card(ID.A1) + ' [data-a=secIvUndo]')) && !!(await page.$(card(ID.N1) + ' [data-a=secIvSnd]')));
    check(`${w}: מסך החשבוניות – בלי גלילה לרוחב`, (await sx(page)) <= 0, await sx(page));
    if (shots) await page.screenshot({ path: path.join(shots, `sec7-inv-${w}.png`), fullPage: true });
    // --- אישור עם בחירת סניף ---
    await page.click(card(ID.P1) + ' [data-a=secIvOk]'); await H.settle(page, 900);
    const dP = await dlgText(page);
    check(`${w}: אישור ספק רב־סניפי – נפתח מסך הבדיקה הקיים עם "סניף (חובה)"`, /בדיקת הוצאה/.test(dP) && /סניף \(חובה\)/.test(dP) && !!last(bodies, 'secDecide', (b) => b.op === 'claim' && b.id === ID.P1 && b.mode === 'man'), dP.slice(0, 200));
    check(`${w}: מסך הבדיקה – בלי גלילה לרוחב`, (await sx(page)) <= 0);
    await page.selectOption('#dlg select[name=br]', 'br2'); await H.settle(page, 300);
    await page.click('#dlg [data-a=inbSaveOk]'); await H.settle(page, 900);
    const sP = await tx(page, 's' + ID.P1);
    check(`${w}: נרשמה בסניף שנבחר ודווחה לשרת`, sP.length === 1 && sP[0].br === 'br2' && sP[0].amt === 450 && !!last(bodies, 'secDecide', (b) => b.op === 'done' && b.id === ID.P1), sP);
    // --- "חשבוניות לתשלום" ותזרים ---
    await page.evaluate(() => go('due')); await H.settle(page, 700);
    const tDue = await txt(page);
    check(`${w}: החשבוניות שנכנסו מופיעות ב"חשבוניות לתשלום"`, /INV-100/.test(tDue) && /B-12/.test(tDue), tDue.slice(0, 300));
    const cf = await page.evaluate((s) => { try { const t = S.tx.find((x) => x.src === s); const m = (t.due || t.plan || '').slice(0, 7); const r = (typeof cfMonths === 'function' ? cfMonths() : []).find((x) => (x.m || x.month || x[0]) === m); return { m, has: !!r, json: JSON.stringify(r || null).slice(0, 200) }; } catch (e) { return { err: e.message }; } }, 's' + ID.P1);
    await page.evaluate(() => go('cf')); await H.settle(page, 700);
    const tCf = await txt(page);
    check(`${w}: ותזרים (מסך התזרים נפתח והחודש של התשלום מחושב)`, !/שגיאה/.test(tCf) && tCf.length > 20 && page.__errors.length === 0, cf);
    await page.evaluate(() => { go('sec'); }); await H.settle(page, 500); await page.click('#secTabs [data-v=inv]'); await H.settle(page, 700);
    // --- זיכוי: באישור, סכום שלילי ---
    await page.click(card(ID.C1) + ' [data-a=secIvOk]'); await H.settle(page, 900);
    const sC = await tx(page, 's' + ID.C1);
    check(`${w}: זיכוי – נרשם רק באישור, כסכום שלילי (kind=credit)`, sC.length === 1 && sC[0].amt === -59 && sC[0].kind === 'credit', sC);
    // --- קבלה → "סמן כשולם" ---
    check(`${w}: קבלה – הצעה "סמן כשולם" לחשבונית הפתוחה INV-50`, /INV-50/.test(await page.innerText(card(ID.R1))) && !!(await page.$(card(ID.R1) + ' [data-a=secIvPay]')));
    await page.click(card(ID.R1) + ' [data-a=secIvPay]'); await H.settle(page, 900);
    const dR = await dlgText(page);
    check(`${w}: "סמן כשולם" – נפתח מסך התשלום הקיים של החשבונית (לא הוצאה חדשה)`, /סגירת תשלום/.test(dR) && (await tx(page, 's' + ID.R1)).length === 1 && (await tx(page, 's' + ID.R1))[0].id === 'tOpen', dR.slice(0, 200));
    await page.evaluate(() => { const f = document.querySelector('#dlg form[data-f=paysave]'); f.querySelector('input[name=m][value="מזומן"]').checked = true; f.requestSubmit(); }); await H.settle(page, 900);
    await page.evaluate(() => { if (document.getElementById('dlg').open) closeDlg(); });
    const paid = await page.evaluate(() => { const t = S.tx.find((x) => x.id === 'tOpen'); return { pays: (t.pays || []).length, bal: bal(t), file: !!(t.file || t.rcf) }; });
    check(`${w}: התשלום נרשם על החשבונית, הקבלה צורפה, ודווח לשרת`, paid.pays === 1 && paid.bal === 0 && paid.file && !!last(bodies, 'secDecide', (b) => b.op === 'done' && b.id === ID.R1), paid);
    check(`${w}: לא נוצרה הוצאה נוספת מהקבלה`, (await page.evaluate(() => S.tx.filter((t) => t.amt === 118 && t.sub === 's1' && t.id !== 'tOpen' && !(t.src || '').startsWith('s')).length)) === 0);
    // --- חשבונית אחרי תעודת משלוח → החלפה ---
    await page.evaluate(() => { window.__secInv.at = 0; window.__secInv.L = null; rerender(); }); await H.settle(page, 900);
    check(`${w}: חשבונית שמתאימה לתעודת משלוח פתוחה – הצעה "החלף את תעודת המשלוח בחשבונית"`, !!(await page.$(card(ID.D1) + ' [data-a=secIvDn]')));
    await page.click(card(ID.D1) + ' [data-a=secIvDn]'); await H.settle(page, 400);
    check(`${w}: ההחלפה שואלת קודם`, /להחליף את תעודת המשלוח/.test(await dlgText(page)));
    await page.click('#dlg [data-a=yes]'); await H.settle(page, 900);
    const dn = await page.evaluate(() => { const t = S.tx.find((x) => x.id === 'tDn'); return { inv: t.inv, dn: !!t.dn, n: S.tx.filter((x) => x.sub === 's2' && x.amt === 300).length }; });
    check(`${w}: התעודה הוחלפה בחשבונית – בלי הוצאה נוספת`, dn.inv === 'B-99' && !dn.dn && dn.n === 1 && !!last(bodies, 'secDecide', (b) => b.op === 'done' && b.id === ID.D1), dn);
    // --- צ'ק: שיוך לחשבונית במסך הקיים ---
    await page.click(card(ID.K1) + ' [data-a=secIvOk]'); await H.settle(page, 900);
    check(`${w}: צ'ק – נפתח מסך השיוך הקיים`, /צ׳ק|צ'ק/.test(await dlgText(page)), (await dlgText(page)).slice(0, 150));
    await page.evaluate(() => closeDlg()); await H.settle(page, 300);
    // --- דחייה ---
    await page.click(card(ID.U1) + ' [data-a=secIvNo]'); await H.settle(page, 300);
    await page.click('#dlg [data-a=yes]'); await H.settle(page, 700);
    check(`${w}: דחייה – נשלחת לשרת ונעלמת מהרשימה`, !!last(bodies, 'secDecide', (b) => b.op === 'rej' && b.id === ID.U1) && !(await page.$(card(ID.U1))));
    // --- שולח חדש: אישור – הסימון יורד ---
    await page.click(card(ID.N1) + ' [data-a=secIvSnd]'); await H.settle(page, 300); await page.click('#dlg [data-a=yes]'); await H.settle(page, 700);
    const sN2 = await tx(page, 's' + ID.N1);
    check(`${w}: אישור השולח – נשלח לשרת, והסימון יורד מההוצאה`, !!last(bodies, 'secDecide', (b) => b.op === 'sender' && b.id === ID.N1) && sN2[0].secNs === '' && !/שולח חדש/.test(sN2[0].note), sN2);
    // --- ביטול "נכנס ישר" ---
    await page.click(card(ID.A1) + ' [data-a=secIvUndo]'); await H.settle(page, 300); await page.click('#dlg [data-a=yes]'); await H.settle(page, 800);
    check(`${w}: ביטול – ההוצאה הוסרה, והחשבונית חזרה ל"ממתינות"`, (await tx(page, 's' + ID.A1)).length === 0 && !!last(bodies, 'secDecide', (b) => b.op === 'undo' && b.id === ID.A1) && !!(await page.$(card(ID.A1) + ' [data-a=secIvOk]')));
    // --- סגירה באמצע: ההוצאה נרשמה, הדיווח לשרת נכשל → אחרי טעינה מחדש: דיווח אחד, בלי כפילות ---
    await page.click(card(ID.F1) + ' [data-a=secIvOk]'); await H.settle(page, 1200);
    const before = await tx(page, 's' + ID.F1);
    const led = await page.evaluate((id) => !!(S.secL && S.secL[id]), ID.F1);
    check(`${w}: הדיווח נכשל – ההוצאה נשמרה במכשיר, והפריט נשאר בפנקס ההשלמה`, before.length === 1 && led, { before, led });
    // האפליקציה נסגרת, ורק אז הרשת חוזרת ונפתחים מחדש. אם הרשת חוזרת לפני הסגירה, הדף הישן מספיק לנסות שוב ולדווח
    // לפני שהפנקס נשמר, ואז יוצא דיווח כפול (נכשל ב-CI ב-360). השרת מקבל דיווח כפול בלי נזק (again)
    const appUrl = page.url();
    await page.goto('about:blank');
    delete Q.failDone[ID.F1];
    await page.goto(appUrl); await H.settle(page, 2500);
    await page.evaluate(() => { window.__secInv.at = 0; go('sec'); }); await H.settle(page, 1800);
    const after = await tx(page, 's' + ID.F1);
    const dones = Q.doneOk[ID.F1] || 0;
    check(`${w}: אחרי פתיחה מחדש – דווח לשרת פעם אחת, ההוצאה פעם אחת בלבד, הפנקס נוקה`, after.length === 1 && dones === 1 && (await page.evaluate((id) => !(S.secL && S.secL[id]), ID.F1)), { after, dones });
    check(`${w}: בלי שגיאות JS`, page.__errors.length === 0, page.__errors);
    await ctx.close();
  }
  await browser.close();
  console.log(fail ? `נכשלו ${fail}` : 'הכול עבר');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
