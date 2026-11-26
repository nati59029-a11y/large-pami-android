'use strict';
// הוראות קבועות למזכירה במסך "חשבוניות שהתקבלו" (26.11.2026). רשת מדומה (בלי שרת), כמו ui-sec-7b.js. נבדק:
//  - המקום ברשימה נשמר אחרי דחייה (לא קופץ לראש התור).
//  - אישור מסמך משולח לא מזוהה → "לזכור?" → ההוראה נשמרת, ומה שבתור מאותו שולח נכנס; מסמך שחסר בו מספר חשבונית נשאר לבדיקה עם הספק ממולא.
//  - מסמך חדש מאותו שולח נכנס לבד, עם "ביטול ההכנסה"; אחרי ביטול – לא נכנס שוב לבד.
//  - שולח לא מאומת – לא לפי ההוראה.
//  - "הוראה למזכירה" לספק של הוצאה קבועה: החשבונית נכנסת ומאשרת את החודש במסך ההוצאות הקבועות.
// שימוש: node ui-sec-rules.js <www-dir>
const H = require('./harness');
let fail = 0;
const check = (name, ok, info) => { if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const BIZ = 'biz-o';
const FEAT = { scan: true, tasks: true, orders: true, suppliers: true, cashClose: true, secretary: true };
const hx = (c) => 'f' + c.repeat(40);
const ID = { U1: hx('1'), U2: hx('2'), U3: hx('3'), U4: hx('4'), UA: hx('5'), P1: hx('6'), U5: hx('7') };
const NEW = 'office@new.example';

function items(now) {
  const b = (id, o) => Object.assign({ id, st: 'new', t: now - 3600e3, fn: 'inv.pdf', mime: 'application/pdf', size: 1000, np: 1, pages: 1, src: [{ ch: 'mail', from: NEW, name: 'משרד', t: now - 3600e3 }], unsure: [], sub: '', subN: '', match: '', br: '', brOk: true, ns: '', nsShow: '', dup: '', el: false, why: ['sup'], hold: '', err: '', k: 'inv' }, o);
  const f = (o) => Object.assign({ supplier: 'משרד חדש', hp: '', num: 'A-1', date: '2026-11-01', total: 100 }, o);
  const L = [
    b(ID.U1, { f: f({}) }),
    b(ID.U2, { f: f({ num: 'A-2', total: 200 }) }),
    b(ID.U3, { f: f({ num: '', total: 300 }) }),
    b(ID.UA, { f: f({ num: 'A-9', total: 90 }), ua: true }),
    b(ID.P1, { f: f({ supplier: 'פרטנר', num: 'P-11', total: 155, date: '2026-11-05' }), src: [{ ch: 'mail', from: 'thankyou@partner.example', name: 'פרטנר', t: now }] }),
  ];
  // כרטיסים נוספים לבדיקת הגלילה
  for (let i = 0; i < 8; i++) L.push(b('x' + String(i).repeat(40), { src: [{ ch: 'wa', from: '97250000000' + i, name: 'ש' + i, t: now }], f: f({ num: 'Z-' + i, total: 10 + i }) }));
  return L;
}

async function open(browser, www, o) {
  const who = 'm';
  const cfg = { mode: 'new', users: { [who]: BIZ }, sa: {}, biz: { [BIZ]: { dataRoot: 'b', features: FEAT, name: 'עסק בדיקה' } },
    admins: { [`b/${BIZ}/|${who}`]: 1 }, staff: { [`b/${BIZ}/|${who}`]: 1 }, ctx: { hasTouch: true, isMobile: true, viewport: { width: o.w, height: o.h } } };
  const bodies = [];
  const now = H.T0;
  const st = { ok: true, consented: true, setupDone: true, name: 'רותי', addr: 'f', call: 'נתי', rows: [], mode: 'all', pay: true, emp: true, sens: false, we: 'warn', mirror: true, mirrorAt: null, cfTh: null, pct: 10, saving: '', nt: {}, types: {}, unseen: 0 };
  const wc = { ok: true, connected: false, num: '', link: '', stop: { on: false, auto: false, why: '', at: 0, by: '' }, ack: { on: false, text: '' }, open: { on: false, text: '' }, ackH: { f: '08:00', t: '18:00' }, hour: 30, myNum: '', myReq: '', tpls: [], appr: [] };
  const Q = { L: items(now), cfg: { auto: true, off: [] }, ready: false };
  const { ctx, page } = await H.newPage(browser, www, cfg, [], who);
  await ctx.route(/:5001\/.*/, async (route) => {
    const n = new URL(route.request().url()).pathname.split('/').pop();
    let body = {}; try { body = JSON.parse(route.request().postData() || '{}').data || {}; } catch (e) { /* */ }
    bodies.push([n, body]);
    const ok = (r) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: r }) });
    const no = (reason, msg) => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { status: 'FAILED_PRECONDITION', message: msg || reason, details: { reason } } }) });
    if (n === 'secState') return ok(st);
    if (n === 'secChatLoad') return ok({ ok: true, msgs: [] });
    if (n === 'secNotes') return ok({ ok: true, notes: [], unseen: 0, types: {} });
    if (n === 'secWaCfg') return ok(wc);
    if (n === 'secInv') {
      if (body.op === 'list') return ok({ ok: true, items: !Q.ready ? [] : Q.L.filter((i) => i.st !== 'rej'), cfg: Q.cfg, stop: false, br: null });
      if (body.op === 'file') return ok({ ok: true, id: body.id, k: 0, np: 1, mime: 'application/pdf', d: Buffer.from('%PDF-1.4\n%%EOF').toString('base64') });
      if (body.op === 'sups') return ok({ ok: true, n: (body.sups || []).length });
    }
    if (n === 'secDecide') {
      const x = Q.L.find((i) => i.id === body.id);
      if (!x) return no('not-found');
      if (body.op === 'claim') { if (body.mode === 'auto' && !x.el) return no('not-eligible'); if (x.st !== 'new') return no('already'); Object.assign(x, { st: 'cl', mine: true, dev: body.dev, mode: body.mode }); return ok({ ok: true, id: x.id, item: x }); }
      if (body.op === 'done') { Object.assign(x, { st: 'ok', auto: x.mode === 'auto', mineOk: true }); return ok({ ok: true }); }
      if (body.op === 'rej') { x.st = 'rej'; return ok({ ok: true }); }
      if (body.op === 'undo') { Object.assign(x, { st: 'new', el: false, hold: 'undo', mineOk: false }); return ok({ ok: true }); }
      return ok({ ok: true });
    }
    return ok(n === 'getBackupKey' ? { key: Buffer.alloc(32, 7).toString('base64') } : {});
  });
  await H.login(page, who + '@x.co');
  await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden && ACT.startBlank) ACT.startBlank(); });
  await H.settle(page, 500);
  return { ctx, page, bodies, Q };
}
const last = (bodies, n, f) => bodies.filter((b) => b[0] === n && (!f || f(b[1]))).pop();
const card = (id) => `#secIv_${id}`;
const reload = async (page) => { await page.evaluate(() => { window.__secInv.at = 0; rerender(); }); await H.settle(page, 1200); };
const txOf = (page, id) => page.evaluate((id) => { const t = S.tx.find((z) => z.src === 's' + id); return t ? { sub: t.sub, amt: t.amt, inv: t.inv, id: t.id, fx: t.fx || '' } : null; }, id);

(async () => {
  const [www] = process.argv.slice(2);
  const browser = await H.launch();
  const w = 360;
  const { ctx, page, bodies, Q } = await open(browser, www, { w, h: 740 });
  await page.evaluate(() => {
    let c = S.cats.find((x) => x.kind === 'exp' && !x.hid && x.beh === 'sup');
    if (!c) { c = { id: 'c_sup7', kind: 'exp', name: 'ספקים', beh: 'sup' }; S.cats.push(c); }
    let fc = S.cats.find((x) => x.kind === 'exp' && !x.hid && x.beh === 'fixed');
    if (!fc) { fc = { id: 'c_fix7', kind: 'exp', name: 'הוצאות קבועות', beh: 'fixed' }; S.cats.push(fc); }
    S.subs.push({ id: 's1', cat: c.id, name: 'משרד חדש בע"מ', hp: '', pm: 0 }, { id: 'sf', cat: fc.id, name: 'פרטנר', hp: '', pm: 0 });
    S.fixTpl.push({ id: 'tpf', sub: 'sf', cat: fc.id, name: 'פרטנר', amt: 150, day: 5, start: '', end: '', act: true });
    save();
  });
  Q.ready = true;
  await page.evaluate(() => { window.__secInv.at = 0; go('sec'); }); await H.settle(page, 1500);
  await page.evaluate(() => { const b = document.querySelector('#secTabs [data-v=inv]'); if (b) b.click(); }); await H.settle(page, 1500);

  // 1. המקום נשמר אחרי דחייה
  const X3 = 'x' + '3'.repeat(40), X4 = 'x' + '4'.repeat(40);
  await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'center' }), card(X3)); await H.settle(page, 300);
  const before = await page.evaluate((s) => ({ y: window.scrollY, top: document.querySelector(s).getBoundingClientRect().top }), card(X3));
  await page.click(card(X3) + ' [data-a=secIvNo]'); await H.settle(page, 300);
  await page.click('#dlg [data-a=yes]'); await H.settle(page, 1800);
  const after = await page.evaluate(([a, b]) => ({ y: window.scrollY, gone: !document.querySelector(a), top: document.querySelector(b) ? document.querySelector(b).getBoundingClientRect().top : null }), [card(X3), card(X4)]);
  check(`${w}: דחייה – הרשימה לא קפצה לראש, הכרטיס הבא במקום של זה שנדחה`, before.y > 200 && after.gone && after.y > 200 && after.top !== null && Math.abs(after.top - before.top) < 30, { before, after });

  // 2. אישור משולח לא מזוהה → "לזכור?" → השאר בתור נכנס
  check(`${w}: יש כפתור "הוראה למזכירה" בכרטיס`, !!(await page.$(card(ID.U1) + ' [data-a=secIvRule]')));
  check(`${w}: אין כפתור "הוראה למזכירה" לשולח לא מאומת`, !(await page.$(card(ID.UA) + ' [data-a=secIvRule]')));
  await page.evaluate(async (id) => { await ACT.secIvEd({ dataset: { id }, disabled: false }); }, ID.U1); await H.settle(page, 800);
  await page.evaluate((id) => { closeDlg(); const it = S.inbox.find((i) => i.sec === id); const s = S.subs.find((z) => z.id === 's1'); Object.assign(it.d, { cat: s.cat, sub: 's1', subName: s.name }); return ACT.inbOk({ dataset: { id: it.id } }); }, ID.U1); await H.settle(page, 900);
  const q = await page.evaluate(() => document.getElementById('dlg').open ? document.getElementById('dlg').innerText : '');
  check(`${w}: אחרי אישור – שאלה "לזכור?" עם 2 נוספים בתור`, /לזכור/.test(q) && /עוד 2/.test(q), q.slice(0, 300));
  await page.click('#dlg [data-a=yes]'); await H.settle(page, 2500);
  const t1 = await txOf(page, ID.U1), t2 = await txOf(page, ID.U2), t3 = await txOf(page, ID.U3);
  const rule = await page.evaluate((k) => S.ivR && S.ivR[k], 'm:' + NEW);
  check(`${w}: ההוראה נשמרה (שולח ← ספק)`, !!rule && rule.sub === 's1' && rule.auto === true, rule);
  check(`${w}: מסמך נוסף מאותו שולח נכנס לספק`, t1 && t1.sub === 's1' && t2 && t2.sub === 's1' && t2.amt === 200 && t2.inv === 'A-2', { t1, t2 });
  check(`${w}: מסמך בלי מספר חשבונית לא נכנס`, !t3, t3);
  await reload(page);
  const c3 = await page.evaluate((s) => document.querySelector(s) ? document.querySelector(s).innerText : '', card(ID.U3));
  check(`${w}: מסמך שנשאר – מסומן "לפי ההוראה שלך"`, /לפי ההוראה שלך: משרד חדש/.test(c3), c3.slice(0, 200));
  const ua = await txOf(page, ID.UA);
  check(`${w}: שולח לא מאומת – לא נכנס לפי ההוראה`, !ua);

  // 3. מסמך חדש מאותו שולח – נכנס לבד, עם ביטול; אחרי ביטול לא נכנס שוב
  Q.L.push(Object.assign({}, Q.L.find((i) => i.id === ID.U2), { id: ID.U4, st: 'new', mine: false, mineOk: false, mode: '', f: { supplier: 'משרד חדש', hp: '', num: 'A-4', date: '2026-11-10', total: 400 } }));
  await reload(page); await H.settle(page, 1500);
  const t4 = await txOf(page, ID.U4);
  check(`${w}: מסמך חדש מהשולח נכנס לבד`, t4 && t4.sub === 's1' && t4.amt === 400, t4);
  await reload(page);
  check(`${w}: יש "ביטול ההכנסה" למה שנכנס לפי ההוראה`, !!(await page.$(card(ID.U4) + ' [data-a=secIvUndo]')));
  await page.click(card(ID.U4) + ' [data-a=secIvUndo]'); await H.settle(page, 300);
  await page.click('#dlg [data-a=yes]'); await H.settle(page, 1500);
  await reload(page); await H.settle(page, 800);
  const t4b = await txOf(page, ID.U4);
  check(`${w}: אחרי ביטול – ההוצאה הוסרה ולא נכנסה שוב לבד`, !t4b && Q.L.find((i) => i.id === ID.U4).st === 'new', t4b);

  // 4. הוראה לספק של הוצאה קבועה
  await page.click(card(ID.P1) + ' [data-a=secIvRule]'); await H.settle(page, 400);
  await page.selectOption('#dlg select[name=sub]', 'sf');
  await page.click('#dlg form[data-f=secIvRule] button.grow:not([type])'); await H.settle(page, 2500);
  const tp = await txOf(page, ID.P1);
  const fx = await page.evaluate(() => S.fixOk['2026-11|tpf']);
  check(`${w}: הוצאה קבועה – החשבונית נכנסה ואישרה את החודש`, tp && tp.sub === 'sf' && tp.amt === 155 && fx && fx.e === tp.id && tp.fx === 'tpf', { tp, fx });
  const rl = await page.evaluate(() => { const d = document.getElementById('secIvRl'); return d ? d.textContent : ''; });
  check(`${w}: רשימת "ההוראות שלי למסמכים" מציגה 2 הוראות`, /\(2\)/.test(rl) && /פרטנר/.test(rl), rl.slice(0, 200));
  check(`${w}: לא נשלחה תפיסה במצב אוטומטי (רק ידני, כמו "בדיקה ואישור")`, !last(bodies, 'secDecide', (b) => b.op === 'claim' && b.mode === 'auto'));
  check(`${w}: בלי גלילה לרוחב`, (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1);
  check(`${w}: בלי שגיאות JS`, page.__errors.length === 0, page.__errors);
  await page.screenshot({ path: process.argv[3] || '/tmp/ui-sec-rules.png' }).catch(() => {});
  await ctx.close();
  await browser.close();
  console.log(fail ? `נכשלו ${fail}` : 'הכול עבר');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
