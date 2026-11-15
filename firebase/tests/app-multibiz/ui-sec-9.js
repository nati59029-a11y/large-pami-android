'use strict';
// המזכירה העסקית – שלב ג/8: טיוטת הזמנה בכרטיס המייל, תשובת לקוח (oRe), חלון "שליחה לבד", ותווית "מהמייל" בהזמנות.
// רשת מדומה (בלי שרת). שימוש: node ui-sec-9.js <www-dir> [shots-dir]
const fs = require('fs');
const path = require('path');
const H = require('./harness');
let fail = 0;
const check = (name, ok, info) => { if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const BIZ = 'biz-o';
const FEAT = { scan: true, tasks: true, orders: true, suppliers: true, cashClose: true, secretary: true };
const NT = { wd: 0, wh: 8, mh: 8, md: 0, dg: false, dh: 8, q: { on: true, f: '22:00', t: '07:00' }, reps: 3, rt: {} };
const ID1 = 'g' + '1'.repeat(40), ID2 = 'g' + '2'.repeat(40), ID3 = 'g' + '3'.repeat(40);
const XSS = '<img src=x onerror="window.__xss=1">';

async function open(browser, www, w, h) {
  const who = 'm';
  const cfg = { mode: 'new', users: { [who]: BIZ }, sa: {}, biz: { [BIZ]: { dataRoot: 'b', features: FEAT, name: 'עסק בדיקה' } },
    admins: { [`b/${BIZ}/|${who}`]: 1 }, staff: { [`b/${BIZ}/|${who}`]: 1 }, ctx: { hasTouch: true, isMobile: true, viewport: { width: w, height: h } } };
  const bodies = [];
  const now = Date.now();
  const st = { ok: true, consented: true, setupDone: true, name: 'רותי', addr: 'f', call: 'נתי', rows: [], mode: 'all', pay: true, emp: true, sens: false, we: 'warn', mirror: true, mirrorAt: null, cfTh: null, pct: 10, saving: '', nt: NT, types: {}, unseen: 0 };
  const wc = { ok: true, connected: false, num: '', link: '', stop: { on: false, auto: false, why: '', at: 0, by: '' }, ack: { on: false, text: '' }, open: { on: false, text: '' }, ackH: { f: '08:00', t: '18:00' }, hour: 30, myNum: '', myReq: '', tpls: [], appr: [] };
  const boxes = [{ id: 'gm0123456789abcdef', addr: 'office@a-business.example', st: 'ok', clean: false, at: now }];
  const mails = [
    { id: ID1, from: 'yossi@client.example', name: 'יוסי', subj: 'הזמנה', snip: 'צריך 10 קרטוני חלב', t: now - 3600e3, st: 'new', flags: [], box: boxes[0].id, draft: { st: 'pend', src: 'ai' } },
    { id: ID2, from: 'yossi@client.example', name: 'יוסי', subj: 'Re: טיוטת הזמנה', snip: 'מאשר', t: now - 600e3, st: 'new', flags: [], box: boxes[0].id, draft: { st: 'pend', src: 'ai' } },
    { id: ID3, from: 'dan@client.example', name: 'דן', subj: 'שאלה על שעות', snip: 'מתי פתוח?', t: now - 7200e3, st: 'new', flags: [], box: boxes[0].id, draft: { st: 'pend', src: 'ai' } },
  ];
  const ord = { id: ID1, to: 'yossi@client.example', st: 'mgr', ver: 3, t: now, custId: '', custName: '', cands: [{ id: 'c1', name: 'יוסי כהן', bn: 'כהן שיווק' }, { id: 'c2', name: 'יוסי לוי', bn: '' }], idBy: 'mail', custNew: { name: 'יוסי ' + XSS, phone: '0501234567' },
    phone: '', phoneHint: '0501234567', br: '', brDef: false, catCut: false, brs: [{ id: 'b1', name: 'צפון' }, { id: 'b2', name: 'דרום' }], lines: [
      { st: 'ok', name: 'חלב 3%', txt: 'חלב', qty: 10, unit: 'קרטון', pr: 5000, sum: 50000 },
      { st: 'pick', txt: 'גבינה', qty: 2, unit: 'יח', opts: [{ id: 'p1', name: 'גבינה לבנה 5%', pr: 800 }, { id: 'p2', name: 'גבינה צהובה', pr: 1500 }] },
      { st: 'ok', name: 'שוקו', txt: 'שוקו', qty: 5, out: true },
      { st: 'nomatch', txt: 'משהו לא ברור ' + XSS, qty: 1 }], total: 50000, nBlock: 3, blk: ['cust', 'br'], sentAt: 0, stuck: false, text: 'שלום,\n\nלהלן טיוטת ההזמנה שלך לבדיקה:\n1. חלב 3%\nסה"כ: 500.00 ₪' };
  const oa = { on: [{ custId: 'c9', name: 'מכולת הים', at: now }], ask: [{ custId: 'c8', name: 'סופר השכונה', at: now }] };
  const { ctx, page } = await H.newPage(browser, www, cfg, [], who);
  await ctx.route(/:5001\/.*/, async (route) => {
    const n = new URL(route.request().url()).pathname.split('/').pop();
    let body = {}; try { body = JSON.parse(route.request().postData() || '{}').data || {}; } catch (e) { /* */ }
    bodies.push([n, body]);
    const ok = (r) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: r }) });
    if (n === 'secState') return ok(st);
    if (n === 'secChatLoad') return ok({ ok: true, msgs: [] });
    if (n === 'secNotes') return ok({ ok: true, notes: [], unseen: 0, types: {} });
    if (n === 'secWaCfg') return ok(wc);
    if (n === 'secMail') {
      if (body.op === 'list') return ok({ ok: true, mails, boxes, max: 2, cleanN: 0 });
      if (body.op === 'repGet') return ok({ ok: true, auto: true, cap: 100, drafts: 0, sent: 0, autoDay: 100, held: null });
      if (body.op === 'get') {
        const m = mails.find((x) => x.id === body.id);
        const d = m.id === ID3 ? { id: ID3, to: m.from, subj: 'Re', text: 'פתוחים 8–18', src: 'ai', st: 'pend', flags: [], why: [], an: [], anL: [], t: now } : m.id === ID1 ? { id: ID1, to: m.from, subj: 'Re: הזמנה', text: 'טיוטה', src: 'ai', st: 'pend', flags: [], why: [], an: ['order'], anL: [], t: now, oRe: '' }
          : { id: ID2, to: m.from, subj: 'Re: Re: הזמנה', text: 'תשובה', src: 'ai', st: 'pend', flags: [], why: [], an: ['order'], anL: [], t: now, oRe: ID1 };
        return ok({ ok: true, mail: Object.assign({}, m, { text: m.snip, files: [], rto: '' }), draft: d });
      }
      if (body.op === 'autoList') return ok({ ok: true, rules: [{ id: 'r1', q: ['שעות פתיחה'], a: 'פתוחים 8–18', on: true, n: 3, ch: 'mail', facts: ['hours'] }], items: [] });
      if (body.op === 'ordGet') return ok({ ok: true, ord });
      if (body.op === 'ordEdit') {
        for (const p of body.ops) {
          if (p.k === 'cust') { ord.custId = p.cid; ord.custName = 'יוסי כהן'; ord.cands = []; ord.blk = ord.blk.filter((x) => x !== 'cust'); }
          if (p.k === 'br') { ord.br = p.br; ord.blk = ord.blk.filter((x) => x !== 'br'); }
          if (p.k === 'phone') { ord.phone = ord.phoneHint; ord.phoneHint = ''; }
          if (p.k === 'pick') { const l = ord.lines[p.i]; const o = l.opts.find((q) => q.id === p.pid); Object.assign(l, { st: 'ok', name: o.name, pr: o.pr, sum: o.pr * l.qty }); delete l.opts; }
        }
        ord.ver++; return ok({ ok: true, ord });
      }
      if (body.op === 'ordCust') { ord.custId = 'p0501234567'; ord.custName = body.card.name; ord.ver++; return ok({ ok: true, created: true, custId: ord.custId, ord }); }
      if (body.op === 'ordSend') { if (body.mark) { ord.st = 'sent'; return ok({ ok: true, marked: true }); } ord.st = 'sent'; return ok({ ok: true, id: body.id }); }
      if (body.op === 'ordAuto') {
        if (body.act === 'list') return ok({ ok: true, on: oa.on, ask: oa.ask });
        const k = oa.ask.find((x) => x.custId === body.custId) || oa.on.find((x) => x.custId === body.custId);
        oa.ask = oa.ask.filter((x) => x !== k); oa.on = oa.on.filter((x) => x !== k); if (body.act === 'on') oa.on.push(k);
        return ok({ ok: true, custId: body.custId, on: body.act === 'on' });
      }
    }
    return ok({});
  });
  await H.login(page, who + '@x.co');
  await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden && ACT.startBlank) ACT.startBlank(); });
  await H.settle(page, 800);
  return { ctx, page, bodies, ord };
}
const last = (bodies, n, f) => bodies.filter((b) => b[0] === n && (!f || f(b[1]))).pop();
const txt = (page) => page.evaluate(() => document.getElementById('main').innerText);
const sx = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const dlgText = (page) => page.evaluate(() => document.getElementById('dlg').open ? document.getElementById('dlg').innerText : '');
const small = (page) => page.evaluate(() => [...document.querySelectorAll('#secOrd button:not([disabled]), #secOrd select, #secOrd input:not([type=checkbox])')].filter((e) => e.offsetParent && e.getBoundingClientRect().height < 43).map((e) => e.outerHTML.slice(0, 80)));

(async () => {
  const [www, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const browser = await H.launch();
  for (const [w, h] of [[360, 740]]) {
    const { ctx, page, bodies, ord } = await open(browser, www, w, h);
    await page.evaluate(() => go('sec')); await H.settle(page, 700);
    await page.click('#secTabs [data-v=mail]'); await H.settle(page, 600);
    await page.click(`[data-a=secMlOpen][data-id=${ID1}]`); await H.settle(page, 500);
    check('כרטיס מייל עם סיבת order – כפתור "פתיחת טיוטת ההזמנה", ועדיין בלי קריאה לשרת', !!(await page.$('[data-a=secOrdOpen]')) && !last(bodies, 'secMail', (b) => b.op === 'ordGet'));
    check('החלטת המשתמש: במייל הזמנה – אין כפתור שליחה רגיל (רק דרך טיוטת ההזמנה), ויש "לא לענות"', !(await page.$('[data-a=secMlSend]')) && !(await page.$('#secMlTx')) && !!(await page.$('[data-a=secMlDone]')));
    await page.click('[data-a=secOrdOpen]'); await H.settle(page, 600);
    const g = last(bodies, 'secMail', (b) => b.op === 'ordGet');
    let t = await txt(page);
    check('טעינה: ordGet עם מזהה בלבד', g && g[1].id === ID1, g && g[1]);
    check('מוצגים: מועמדים, כרטיס חדש, טלפון לאישור, שורות, אזל, לבירור, לבחירה, סה"כ, טקסט שיישלח, חסימות', /יוסי כהן/.test(t) && /יוסי לוי/.test(t) && /0501234567/.test(t) && /חלב 3%/.test(t) && /אזל/.test(t) && /לבירור/.test(t) && /לבחירה/.test(t) && /500\.00 ₪/.test(t) && /הטקסט שיישלח/.test(t) && /צריך לבחור לקוח/.test(t) && /צריך לבחור סניף/.test(t), t.slice(0, 300));
    check('תוכן מהלקוח מוצג כטקסט (אין הרצה)', !(await page.evaluate(() => window.__xss)) && !(await page.$('#secOrd img')));
    check('שליחה חסומה כל עוד אין לקוח וסניף', await page.evaluate(() => document.querySelector('[data-a=secOrdSend]').disabled));
    check('אין מזהי מוצר בטקסט הנראה', !/\bp1\b|\bp2\b/.test(t));
    check('בלי גלילה לרוחב', (await sx(page)) <= 0, await sx(page));
    check('כפתורים ושדות בגובה 44px לפחות', (await small(page)).length === 0, await small(page));
    if (shots) await page.screenshot({ path: path.join(shots, 'sec9-order-360.png'), fullPage: true });
    await page.click('[data-a=secOrdOp][data-k=cust][data-cid=c1]'); await H.settle(page, 400);
    let e = last(bodies, 'secMail', (b) => b.op === 'ordEdit');
    check('בחירת לקוח מהמועמדים: ordEdit עם ver ו-cid', e && e[1].ver === 3 && e[1].ops[0].k === 'cust' && e[1].ops[0].cid === 'c1', e && e[1]);
    await page.selectOption('[data-c=secOrdBr]', 'b1'); await H.settle(page, 400);
    e = last(bodies, 'secMail', (b) => b.op === 'ordEdit' && b.ops[0].k === 'br');
    check('בחירת סניף', e && e[1].ops[0].br === 'b1' && e[1].ver === 4, e && e[1]);
    await page.click('[data-a=secOrdOp][data-k=phone]'); await H.settle(page, 400);
    check('אישור טלפון', !!last(bodies, 'secMail', (b) => b.op === 'ordEdit' && b.ops[0].k === 'phone'));
    await page.click('[data-a=secOrdOp][data-k=pick][data-i="1"][data-pid=p2]'); await H.settle(page, 400);
    e = last(bodies, 'secMail', (b) => b.op === 'ordEdit' && b.ops[0].k === 'pick');
    check('בחירת מוצר מאפשרות: i ו-pid', e && e[1].ops[0].i === 1 && e[1].ops[0].pid === 'p2', e && e[1]);
    await page.fill('[data-c=secOrdQty][data-i="0"]', '12'); await page.dispatchEvent('[data-c=secOrdQty][data-i="0"]', 'change'); await H.settle(page, 400);
    e = last(bodies, 'secMail', (b) => b.op === 'ordEdit' && b.ops[0].k === 'qty');
    check('שינוי כמות', e && e[1].ops[0].i === 0 && e[1].ops[0].qty === 12, e && e[1]);
    await page.click('[data-a=secOrdOp][data-k=del][data-i="3"]'); await H.settle(page, 300);
    check('מחיקת שורה – שואל קודם', /למחוק את השורה/.test(await dlgText(page)) && !last(bodies, 'secMail', (b) => b.op === 'ordEdit' && b.ops[0].k === 'del'));
    await page.click('#dlg [data-a=yes]'); await H.settle(page, 400);
    check('מחיקה נשלחת אחרי אישור', !!last(bodies, 'secMail', (b) => b.op === 'ordEdit' && b.ops[0].k === 'del' && b.ops[0].i === 3));
    check('אחרי בחירת לקוח וסניף – אין חסימה והשליחה פעילה', !(await page.evaluate(() => document.querySelector('[data-a=secOrdSend]').disabled)));
    check('שליחה: לא נשלחה לפני אישור', !last(bodies, 'secMail', (b) => b.op === 'ordSend'));
    await page.click('[data-a=secOrdSend]'); await H.settle(page, 300);
    check('שליחה – שואל קודם עם הנמען', /yossi@client\.example/.test(await dlgText(page)) && !last(bodies, 'secMail', (b) => b.op === 'ordSend'));
    await page.click('#dlg [data-a=yes]'); await H.settle(page, 600);
    const s = last(bodies, 'secMail', (b) => b.op === 'ordSend');
    t = await txt(page);
    check('ordSend עם id ו-ver; אחרי שליחה – תווית "ממתין לתשובה" בלי כפתור שליחה', s && s[1].id === ID1 && s[1].ver === ord.ver && /ממתין לתשובה/.test(t) && !(await page.$('[data-a=secOrdSend]')), s && s[1]);
    // מצב "ייתכן שנשלח"
    ord.st = 'sending'; ord.stuck = true;
    await page.click('[data-a=secOrdRe]'); await H.settle(page, 500);
    t = await txt(page);
    check('stuck: "ייתכן שנשלח" + סמן נשלח (ללא כפתור שליחה)', /ייתכן שנשלח/.test(t) && !!(await page.$('[data-a=secOrdMark]')) && !(await page.$('[data-a=secOrdSend]')));
    await page.click('[data-a=secOrdMark]'); await H.settle(page, 300);
    await page.click('#dlg [data-a=yes]'); await H.settle(page, 500);
    check('סמן נשלח: ordSend mark:true', !!last(bodies, 'secMail', (b) => b.op === 'ordSend' && b.mark === true));
    for (const [st, re] of [['ordered', /הלקוח אישר – נוצרה הזמנה/], ['cancel', /הלקוח ביטל/]]) {
      ord.st = st; ord.stuck = false; await page.click('[data-a=secOrdRe]'); await H.settle(page, 500);
      check(`מצב ${st} – קריאה בלבד עם תווית`, re.test(await txt(page)) && !(await page.$('#secOrd [data-a=secOrdSend], #secOrd [data-k=del]')));
    }
    // כרטיס לקוח חדש
    ord.st = 'mgr'; ord.custId = ''; ord.cands = []; ord.ver = 9; await page.click('[data-a=secOrdRe]'); await H.settle(page, 500);
    check('בלי מועמדים: טופס כרטיס לקוח חדש עם שדות עסקיים', !!(await page.$('#secOrdCustF [name=bn]')) && !!(await page.$('#secOrdCustF [name=ws]')));
    await page.fill('#secOrdCustF [name=name]', 'דנה'); await page.check('#secOrdCustF [name=ws]'); await page.fill('#secOrdCustF [name=bn]', 'דנה בע"מ'); await page.fill('#secOrdCustF [name=vat]', '123456789');
    await page.click('#secOrdCustF button'); await H.settle(page, 500);
    const c = last(bodies, 'secMail', (b) => b.op === 'ordCust');
    check('ordCust: card + ws:true, בלי שדות שלא מולאו', c && c[1].ws === true && c[1].card.bn === 'דנה בע"מ' && c[1].card.vat === '123456789' && c[1].card.name === 'דנה' && c[1].card.pay === undefined, c && c[1]);
    check('בלי שגיאות JS (כרטיס הזמנה)', page.__errors.length === 0, page.__errors);
    // תשובת לקוח (oRe)
    await page.click('[data-a=secMlBack]'); await H.settle(page, 400);
    await page.click(`[data-a=secMlOpen][data-id=${ID2}]`); await H.settle(page, 500);
    t = await txt(page);
    check('תשובת לקוח: תווית "תשובה לטיוטת הזמנה", בלי טעינת ordGet', /תשובה לטיוטת הזמנה/.test(t) && !!(await page.$('[data-a=secOrdOrig]')) && !last(bodies, 'secMail', (b) => b.op === 'ordGet' && b.id === ID2));
    if (shots) await page.screenshot({ path: path.join(shots, 'sec9-reply-360.png'), fullPage: true });
    await page.click('[data-a=secOrdOrig]'); await H.settle(page, 500);
    check('"פתיחת המייל המקורי" פותח את כרטיס המייל של ההזמנה', (await page.evaluate(() => window.__sec.ml.cur)) === ID1);
    // צילומי השוואה: מסכים קיימים
    await page.click('[data-a=secMlBack]'); await H.settle(page, 300);
    await page.click(`[data-a=secMlOpen][data-id=${ID3}]`); await H.settle(page, 500);
    if (shots) await page.screenshot({ path: path.join(shots, 'sec9-existing-draft-card-360.png'), fullPage: true });
    await page.click('[data-a=secMlBack]'); await H.settle(page, 300);
    await page.click('[data-a=secMlAu]'); await H.settle(page, 600);
    if (shots) await page.screenshot({ path: path.join(shots, 'sec9-existing-autoH-360.png'), fullPage: true });
    await page.click('[data-a=secMlBack]'); await H.settle(page, 300);
    await page.click(`[data-a=secMlOpen][data-id=${ID2}]`); await H.settle(page, 400);
    // שליחה לבד
    await page.click('[data-a=secMlBack]'); await H.settle(page, 400);
    check('כפתור "שליחה לבד של הזמנות" ברשימת המייל', !!(await page.$('[data-a=secOaOpen]')));
    await page.click('[data-a=secOaOpen]'); await H.settle(page, 600);
    t = await txt(page);
    check('חלון שליחה לבד: ממתינים לאישורך + נשלח לבד + הסבר', /ממתינים לאישורך/.test(t) && /סופר השכונה/.test(t) && /מכולת הים/.test(t) && /ללקוח מאומת|הלקוח מאומת/.test(t) && !!(await page.$('[data-a=secOaAct][data-act=on]')) && !!(await page.$('[data-a=secOaAct][data-act=off]')), t.slice(0, 300));
    check('חלון שליחה לבד: בלי גלילה לרוחב', (await sx(page)) <= 0, await sx(page));
    if (shots) await page.screenshot({ path: path.join(shots, 'sec9-auto-360.png'), fullPage: true });
    await page.click('[data-a=secOaAct][data-act=on]'); await H.settle(page, 600);
    check('אישור שליחה לבד: ordAuto act:on + custId', !!last(bodies, 'secMail', (b) => b.op === 'ordAuto' && b.act === 'on' && b.custId === 'c8') && /סופר השכונה/.test(await page.evaluate(() => document.getElementById('secOaOn').innerText)));
    await page.click('#secOaOn [data-act=off][data-id=c9]'); await H.settle(page, 600);
    check('כיבוי: ordAuto act:off', !!last(bodies, 'secMail', (b) => b.op === 'ordAuto' && b.act === 'off' && b.custId === 'c9'));
    // הגדרות: כפתור
    await page.click('[data-a=secMlBack]'); await H.settle(page, 300);
    await page.click('#secTabs [data-v=chat]'); await H.settle(page, 400); await page.click('[data-a=secSet]'); await H.settle(page, 700);
    check('בהגדרות: כפתור שליחה לבד של הזמנות', !!(await page.$('[data-a=secOaOpen]')));
    await page.click('[data-a=secOaOpen]'); await H.settle(page, 600);
    check('מהגדרות נפתח חלון שליחה לבד', /ממתינים לאישורך/.test(await txt(page)));
    check('בלי שגיאות JS (כל הבדיקה)', page.__errors.length === 0, page.__errors);
    await ctx.close();
  }
  await browser.close();
  console.log(fail ? `\nנכשלו ${fail}` : '\nהכול עבר');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
