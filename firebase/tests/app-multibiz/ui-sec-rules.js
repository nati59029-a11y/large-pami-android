'use strict';
// הוראות קבועות למזכירה במסך "חשבוניות שהתקבלו" (26.11.2026). רשת מדומה (בלי שרת), כמו ui-sec-7b.js. נבדק:
//  - המקום ברשימה נשמר אחרי דחייה (לא קופץ לראש התור).
//  - אישור מסמך משולח לא מזוהה → "לזכור?" → ההוראה נשמרת, ומה שבתור מאותו שולח נכנס; מסמך שחסר בו מספר חשבונית נשאר לבדיקה עם הספק ממולא.
//  - מסמך חדש מאותו שולח נכנס לבד, עם "ביטול ההכנסה"; אחרי ביטול – לא נכנס שוב לבד.
//  - שולח לא מאומת – לא לפי ההוראה.
//  - "הוראה למזכירה" לספק של הוצאה קבועה: החשבונית נכנסת ומאשרת את החודש במסך ההוצאות הקבועות.
//  שלב 2 (26.11.2026): הוראה בכתיבה חופשית (פירוש → החלון עם הבחירה; שאלה עם כפתורי בחירה), "לדחות תמיד" באישור כפול + שחזור,
//  כרטיס "תלושי שכר" (פיצול במודול התלושים, "לזכור?"), "נכנס לבד" אחרי אישור ראשון, מה שלא זוהה – נשאר, וביטול הקליטה.
// שימוש: node ui-sec-rules.js <www-dir>
const H = require('./harness');
let fail = 0;
const check = (name, ok, info) => { if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const BIZ = 'biz-o';
const FEAT = { scan: true, tasks: true, orders: true, suppliers: true, cashClose: true, secretary: true };
const hx = (c) => 'f' + c.repeat(40);
const ID = { U1: hx('1'), U2: hx('2'), U3: hx('3'), U4: hx('4'), UA: hx('5'), P1: hx('6'), U5: hx('7'), PS1: hx('a'), PS2: hx('b'), PS3: hx('c') };
const ACC = 'payroll@acc.example';
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
  L.push(b(ID.PS1, { k: 'psl', pslBy: 'name', fn: 'תלושי שכר 10-2026.pdf', pages: 3, why: ['type'], f: {}, src: [{ ch: 'mail', from: ACC, name: 'רו"ח', t: now }] }));
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
      if (body.op === 'rule') return ok(Object.assign({ ok: true }, Q.rule || {}));
      if (body.op === 'cfg') return ok({ ok: true, cfg: Q.cfg });
    }
    if (n === 'secDecide') {
      const x = Q.L.find((i) => i.id === body.id);
      if (!x) return no('not-found');
      if (body.op === 'claim') { if (body.mode === 'auto' && !x.el) return no('not-eligible'); if (x.st !== 'new') return no('already'); Object.assign(x, { st: 'cl', mine: true, dev: body.dev, mode: body.mode }); return ok({ ok: true, id: x.id, item: x }); }
      if (body.op === 'done') { Object.assign(x, { st: 'ok', auto: x.mode === 'auto', mineOk: true }); return ok({ ok: true }); }
      if (body.op === 'rej') { x.st = 'rej'; return ok({ ok: true }); }
      if (body.op === 'unrej') { Object.assign(x, { st: 'new', hold: 'undo' }); return ok({ ok: true }); }
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
  check(`${w}: "הוראה למזכירה" – כתיבה חופשית קודם, ובחירה מהרשימה`, !!(await page.$('#dlg form[data-f=secIvAi] textarea')) && !!(await page.$('#dlg [data-a=secIvRuleL]')));
  await page.click('#dlg [data-a=secIvRuleL]'); await H.settle(page, 400);
  await page.selectOption('#dlg select[name=sub]', 'sf');
  await page.click('#dlg form[data-f=secIvRule] button.grow:not([type])'); await H.settle(page, 2500);
  const tp = await txOf(page, ID.P1);
  const fx = await page.evaluate(() => S.fixOk['2026-11|tpf']);
  check(`${w}: הוצאה קבועה – החשבונית נכנסה ואישרה את החודש`, tp && tp.sub === 'sf' && tp.amt === 155 && fx && fx.e === tp.id && tp.fx === 'tpf', { tp, fx });
  const rl = await page.evaluate(() => { const d = document.getElementById('secIvRl'); return d ? d.textContent : ''; });
  check(`${w}: רשימת "ההוראות שלי למסמכים" מציגה 2 הוראות`, /\(2\)/.test(rl) && /פרטנר/.test(rl), rl.slice(0, 200));
  // 5. שלב 2: כתיבה חופשית – הוצאה קבועה → החלון של שלב 1 עם הבחירה (לא נשמר עד "שמירה")
  const X0 = 'x' + '0'.repeat(40), X1 = 'x' + '1'.repeat(40);
  Q.rule = { act: 'fix', sub: 'sf' };
  await page.click(card(X0) + ' [data-a=secIvRule]'); await H.settle(page, 300);
  await page.fill('#dlg textarea[name=t]', 'תמיד לפרטנר'); await page.click('#dlg form[data-f=secIvAi] button:not([type])'); await H.settle(page, 900);
  const rb = last(bodies, 'secInv', (b) => b.op === 'rule');
  const f5 = await page.evaluate(() => ({ sel: (document.querySelector('#dlg select[name=sub]') || {}).value, t: document.getElementById('dlg').innerText }));
  check(`${w}: כתיבה חופשית – נשלחו ההוראה והרשימה (ספק / הוצאה קבועה)`, rb && rb[1].text === 'תמיד לפרטנר' && rb[1].subs.some((x) => x.id === 'sf' && x.k === 'fixed') && rb[1].subs.some((x) => x.id === 's1' && x.k === 'sup'), rb && rb[1]);
  check(`${w}: כתיבה חופשית – נפתח החלון עם מה שהמזכירה הבינה`, f5.sel === 'sf' && /המזכירה הבינה/.test(f5.t), f5);
  check(`${w}: כתיבה חופשית – לא נשמר לפני "שמירה"`, !(await page.evaluate(() => S.ivR['w:972500000000'])));
  await page.evaluate(() => closeDlg());
  // 6. שאלה אחת עם כפתורי בחירה
  Q.rule = { q: 'לאיזה ספק להכניס?', opts: ['s1', 'sf'] };
  await page.click(card(X0) + ' [data-a=secIvRule]'); await H.settle(page, 300);
  await page.fill('#dlg textarea[name=t]', 'לספק ההוא'); await page.click('#dlg form[data-f=secIvAi] button:not([type])'); await H.settle(page, 900);
  const f6 = await page.evaluate(() => ({ t: document.getElementById('dlg').innerText, n: document.querySelectorAll('#dlg [data-a=secIvAiPick]').length }));
  check(`${w}: לא ברור – המזכירה שואלת שאלה אחת עם כפתורי בחירה`, /לאיזה ספק להכניס/.test(f6.t) && f6.n === 2, f6);
  await page.click('#dlg [data-a=secIvAiPick][data-s=s1]'); await H.settle(page, 400);
  check(`${w}: בחירה בתשובה – החלון עם הספק שנבחר`, (await page.evaluate(() => (document.querySelector('#dlg select[name=sub]') || {}).value)) === 's1');
  await page.evaluate(() => closeDlg());
  // 7. "לדחות תמיד" – אישור כפול, נדחה, רשימת "נדחו" ושחזור
  Q.rule = { act: 'rej' };
  await page.click(card(X1) + ' [data-a=secIvRule]'); await H.settle(page, 300);
  await page.fill('#dlg textarea[name=t]', 'תמיד לדחות'); await page.click('#dlg form[data-f=secIvAi] button:not([type])'); await H.settle(page, 900);
  const a1 = await page.evaluate(() => document.getElementById('dlg').innerText);
  await page.click('#dlg [data-a=yes]'); await H.settle(page, 400);
  const a2 = await page.evaluate(() => document.getElementById('dlg').innerText);
  check(`${w}: "לדחות תמיד" – אישור כפול`, /לדחות תמיד/.test(a1) && /אישור שני/.test(a2), [a1.slice(0, 120), a2.slice(0, 160)]);
  await page.click('#dlg [data-a=yes]'); await H.settle(page, 1800);
  const r7 = await page.evaluate((id) => ({ R: S.ivR['w:972500000001'], J: S.ivRj && S.ivRj[id] }), X1);
  check(`${w}: "לדחות תמיד" – ההוראה נשמרה והמסמך נדחה`, r7.R && r7.R.rej === 1 && r7.J && Q.L.find((i) => i.id === X1).st === 'rej' && !!last(bodies, 'secDecide', (b) => b.op === 'rej' && b.id === X1), r7);
  await reload(page);
  check(`${w}: רשימת "נדחו לפי ההוראה" עם שחזור`, !!(await page.$('#secIvRj [data-a=secIvUnrej][data-id="' + X1 + '"]')));
  await page.evaluate(() => { document.getElementById('secIvRj').open = true; });
  await page.click('#secIvRj [data-a=secIvUnrej]'); await H.settle(page, 1500);
  await reload(page); await H.settle(page, 800);
  check(`${w}: שחזור – המסמך חזר ולא נדחה שוב לבד`, Q.L.find((i) => i.id === X1).st === 'new' && !!(await page.$(card(X1))) && !!last(bodies, 'secDecide', (b) => b.op === 'unrej'), Q.L.find((i) => i.id === X1).st);
  // 8. תלושי שכר: כרטיס, פיצול במודול התלושים, "לזכור?"
  const c8 = await page.evaluate((s) => { const c = document.querySelector(s); return c ? { t: c.innerText, psl: !!c.querySelector('[data-a=secIvPsl]'), scan: !!c.querySelector('[data-a=secIvScan]'), ed: !!c.querySelector('[data-a=secIvEd]') } : null; }, card(ID.PS1));
  check(`${w}: כרטיס "תלושי שכר" – פיצול ושיוך, "זה לא תלוש", בלי "פתיחה והזנה"`, c8 && /תלושי שכר/.test(c8.t) && c8.psl && c8.scan && !c8.ed, c8);
  await page.evaluate(() => { window.__pf = []; window.pslFromSec = async (f, o) => { window.__pf.push([f.name, f.type, f.size]); await o.done(['pslA', 'pslB']); }; });
  await page.click(card(ID.PS1) + ' [data-a=secIvPsl]'); await H.settle(page, 1500);
  const p8 = await page.evaluate((id) => ({ pf: window.__pf, P: S.ivPs && S.ivPs[id], q: document.getElementById('dlg').open ? document.getElementById('dlg').innerText : '' }), ID.PS1);
  check(`${w}: תלושים – הקובץ הועבר למודול התלושים, והמסמך סומן כטופל`, p8.pf.length === 1 && p8.pf[0][1] === 'application/pdf' && p8.P && p8.P.ids.length === 2 && Q.L.find((i) => i.id === ID.PS1).st === 'ok', p8);
  check(`${w}: תלושים – "לזכור?" אחרי הפעם הראשונה`, /לזכור/.test(p8.q) && /תלושי שכר/.test(p8.q), p8.q.slice(0, 200));
  await page.click('#dlg [data-a=yes]'); await H.settle(page, 800);
  const r8 = await page.evaluate((k) => S.ivR[k], 'm:' + ACC);
  check(`${w}: תלושים – ההוראה נשמרה (אחרי אישור ראשון) ונשלחה לשרת`, r8 && r8.psl === 1 && r8.ok === 1 && !!last(bodies, 'secInv', (b) => b.op === 'cfg' && b.psl === 'm:' + ACC && b.on === true), r8);
  // 9. תלוש נוסף מאותו שולח – נכנס לבד כשהכול מזוהה; כשלא – נשאר לבדיקה
  const base = Q.L.find((i) => i.id === ID.PS1);
  Q.L.push(Object.assign({}, base, { id: ID.PS2, st: 'new', mine: false, mineOk: false, mode: '', pslBy: 'snd', fn: 'slips-11.pdf' }), Object.assign({}, base, { id: ID.PS3, st: 'new', mine: false, mineOk: false, mode: '', pslBy: 'snd', fn: 'slips-12.pdf' }));
  await page.evaluate((ids) => { window.__pa = []; window.pslAutoSec = async (f) => { window.__pa.push(f.name); return f.name === 'slips-11.pdf' ? ['pslC'] : null; }; }, null);
  await reload(page); await H.settle(page, 1800);
  const p9 = await page.evaluate((a) => ({ pa: window.__pa, P2: S.ivPs && S.ivPs[a[0]], P3: S.ivPs && S.ivPs[a[1]] }), [ID.PS2, ID.PS3]);
  check(`${w}: תלוש מזוהה מהשולח – נכנס לבד`, p9.P2 && p9.P2.auto === 1 && Q.L.find((i) => i.id === ID.PS2).st === 'ok', p9);
  check(`${w}: תלוש שלא זוהה בוודאות – נשאר לבדיקה`, !p9.P3 && Q.L.find((i) => i.id === ID.PS3).st === 'new', p9);
  await reload(page);
  const c9 = await page.evaluate((s) => (document.querySelector(s) || {}).innerText || '', card(ID.PS3));
  check(`${w}: התלוש שנשאר מסומן "לא כל התלושים זוהו"`, /לא כל התלושים זוהו/.test(c9), c9.slice(0, 200));
  check(`${w}: יש "ביטול קליטת התלושים" למה שנכנס לבד`, !!(await page.$(card(ID.PS2) + ' [data-a=secIvPslUndo]')));
  await page.evaluate(() => { window.__pu = []; window.pslUndoSec = (ids) => { window.__pu.push(ids); return { ok: true, n: ids.length }; }; });
  await page.click(card(ID.PS2) + ' [data-a=secIvPslUndo]'); await H.settle(page, 300);
  await page.click('#dlg [data-a=yes]'); await H.settle(page, 1500);
  const u9 = await page.evaluate((id) => ({ pu: window.__pu, P: S.ivPs && S.ivPs[id], no: !!(S.ivRno && S.ivRno[id]) }), ID.PS2);
  check(`${w}: ביטול – התלושים נמחקו, המסמך חזר לבדיקה ולא ייכנס שוב לבד`, u9.pu.length === 1 && u9.pu[0][0] === 'pslC' && !u9.P && u9.no && Q.L.find((i) => i.id === ID.PS2).st === 'new', u9);
  check(`${w}: לא נשלחה תפיסה במצב אוטומטי (רק ידני, כמו "בדיקה ואישור")`, !last(bodies, 'secDecide', (b) => b.op === 'claim' && b.mode === 'auto'));
  check(`${w}: בלי גלילה לרוחב`, (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1);
  check(`${w}: בלי שגיאות JS`, page.__errors.length === 0, page.__errors);
  await page.screenshot({ path: process.argv[3] || '/tmp/ui-sec-rules.png' }).catch(() => {});
  await ctx.close();
  await browser.close();
  console.log(fail ? `נכשלו ${fail}` : 'הכול עבר');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
