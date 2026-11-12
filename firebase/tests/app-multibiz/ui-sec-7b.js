'use strict';
// המזכירה העסקית – שלב 7, תיקון 1 (2026-11-12): התנהגות המכשיר בלשונית "חשבוניות" אחרי הבדיקה העצמאית ואחרי החלטות בעל הפרויקט.
// רשת מדומה (בלי שרת), כמו ui-sec-7.js. נבדק:
//  - ליקוי 1: דיווח "done" שנדחה (not-mine) על חשבונית שכבר נרשמה במכשיר – לא נמחק בשקט: התראה "ייתכן שנרשמה פעמיים" עד "בדקתי".
//  - ליקוי 4: "ביטול ההכנסה" במכשיר שבו ההוצאה לא קיימת – אין כפתור, ובקריאה ישירה – הודעה ובלי בקשת undo לשרת.
//  - ליקוי 7: "נכנס ישר" לא נכנס כשבתיבה המקומית יש כבר פריט אחר מהמזכירה של אותה חשבונית – מעכב (hold:dup).
//  - ליקויים 2, 1, 5: תגיות "שולח לא מאומת", "נלקחה במכשיר אחר", "תקלה בהורדת הקובץ".
//  - החלטה 1: ברירת המחדל של התקרה במסך – 20,000. החלטה 4: החלפת תעודת משלוח בחשבונית מעדכנת גם את הסכום.
// שימוש: node ui-sec-7b.js <www-dir>
const H = require('./harness');
let fail = 0;
const check = (name, ok, info) => { if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const BIZ = 'biz-o';
const FEAT = { scan: true, tasks: true, orders: true, suppliers: true, cashClose: true, secretary: true };
const TYPES = { invDue: 'חשבונית לתשלום' };
const hx = (c) => 'f' + c.repeat(40);
const ID = { D1: hx('1'), OK: hx('2'), CF: hx('3'), E1: hx('4'), UA: hx('5'), RL: hx('6'), DL: 'x' + 'd'.repeat(40) };
const BR = [{ id: 'br1', name: 'סניף צפון', on: true, sig: [{ k: 'sup', v: 's1' }] }, { id: 'br2', name: 'סניף דרום', on: true, sig: [] }];

function items(now) {
  const b = (id, o) => Object.assign({ id, st: 'new', t: now - 3600e3, fn: 'inv.pdf', mime: 'application/pdf', size: 1000, np: 1, pages: 1, src: [{ ch: 'wa', from: '972521234567', name: 'ספק', t: now - 3600e3 }], unsure: [], sub: 's1', subN: 'ספק דמה בע"מ', match: 'hp', br: 'br1', brOk: true, ns: '', nsShow: '', dup: '', el: false, why: [], hold: '', err: '', t0: 'invoice' }, o);
  const f = (o) => Object.assign({ supplier: 'ספק דמה בע"מ', hp: '512345678', num: 'INV-1', date: '2026-11-01', total: 118 }, o);
  return [
    b(ID.D1, { k: 'inv', f: f({ supplier: 'מאפיית כהן', hp: '511111111', num: 'B-99', total: 300 }), sub: 's2', subN: 'מאפיית כהן', br: '', brOk: false, why: ['br'] }),
    b(ID.OK, { k: 'inv', st: 'ok', auto: true, mineOk: true, okDev: 'dOtherDevice01', okAt: now - 600e3, f: f({ num: 'INV-OK', total: 66 }) }),
    b(ID.E1, { k: 'inv', f: f({ num: 'INV-42', total: 42 }), el: true }),
    b(ID.UA, { k: 'inv', f: f({ num: 'INV-UA', total: 1900, hp: '' }), match: '', sub: '', ua: true, why: ['sup', 'auth'], src: [{ ch: 'mail', from: 'billing@supplier.example', name: 'ספק', t: now }] }),
    b(ID.RL, { k: 'inv', f: f({ num: 'INV-RL', total: 33 }), hold: 'rel', why: ['hold'] }),
    b(ID.DL, { k: 'bad', f: {}, np: 0, why: ['dl'], fn: 'inv.pdf', sub: '', match: '', br: '' }),
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
  const Q = { L: items(now), cfg: { auto: true, off: [] }, notMine: { [ID.CF]: 1 }, ready: false };
  const { ctx, page } = await H.newPage(browser, www, cfg, [], who);
  await ctx.route(/:5001\/.*/, async (route) => {
    const n = new URL(route.request().url()).pathname.split('/').pop();
    let body = {}; try { body = JSON.parse(route.request().postData() || '{}').data || {}; } catch (e) { /* */ }
    bodies.push([n, body]);
    const ok = (r) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: r }) });
    const no = (reason, msg) => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { status: 'FAILED_PRECONDITION', message: msg || reason, details: { reason } } }) });
    if (n === 'secState') return ok(st);
    if (n === 'secChatLoad') return ok({ ok: true, msgs: [] });
    if (n === 'secNotes') return ok({ ok: true, notes: [], unseen: 0, types: TYPES });
    if (n === 'secWaCfg') return ok(wc);
    if (n === 'secInv') {
      if (body.op === 'list') return ok({ ok: true, items: !Q.ready ? [] : Q.L.filter((i) => i.st !== 'rej'), cfg: Q.cfg, stop: false, br: null });
      if (body.op === 'file') return ok({ ok: true, id: body.id, k: 0, np: 1, mime: 'application/pdf', d: Buffer.from('%PDF-1.4\n%%EOF').toString('base64') });
      if (body.op === 'sups') return ok({ ok: true, n: (body.sups || []).length });
    }
    if (n === 'secDecide') {
      if (body.op === 'done' && Q.notMine[body.id]) return no('not-mine', 'החשבונית לא נתפסה במכשיר הזה');
      const x = Q.L.find((i) => i.id === body.id);
      if (!x) return no('not-found');
      if (body.op === 'claim') { if (body.mode === 'auto' && !x.el) return no('not-eligible'); Object.assign(x, { st: 'cl', mine: true, dev: body.dev, mode: body.mode }); return ok({ ok: true, id: x.id, item: x }); }
      if (body.op === 'done') { Object.assign(x, { st: 'ok', auto: x.mode === 'auto', mineOk: true }); return ok({ ok: true }); }
      if (body.op === 'hold') { Object.assign(x, { el: false, hold: body.why, why: ['hold'] }); if (x.st === 'cl') x.st = 'new'; return ok({ ok: true }); }
      if (body.op === 'undo') { Object.assign(x, { st: 'new', el: false, hold: 'undo' }); return ok({ ok: true }); }
      return ok({ ok: true });
    }
    return ok(n === 'getBackupKey' ? { key: Buffer.alloc(32, 7).toString('base64') } : {});
  });
  await H.login(page, who + '@x.co');
  await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden && ACT.startBlank) ACT.startBlank(); });
  await H.settle(page, 500);
  return { ctx, page, bodies, Q };
}
async function seedData(page, ID) {
  await page.evaluate(({ BR, ID }) => {
    let c = S.cats.find((x) => x.kind === 'exp' && !x.hid && x.beh === 'sup');
    if (!c) { c = { id: 'c_sup7', kind: 'exp', name: 'ספקים', beh: 'sup' }; S.cats.push(c); }
    S.subs.push({ id: 's1', cat: c.id, name: 'ספק דמה בע"מ', hp: '512345678', pm: 0 }, { id: 's2', cat: c.id, name: 'מאפיית כהן', hp: '511111111', pm: 0 });
    // תעודת משלוח פתוחה – סכום קצת שונה מהחשבונית (300)
    S.tx.push({ id: 'tDn', t: 'exp', cat: c.id, sub: 's2', date: '2026-10-25', amt: 299.7, plan: '2026-11', inv: '', dn: true, note: '', kind: 'inv', pays: [], br: 'br2' });
    // ליקוי 1: חשבונית שנרשמה כאן, והדיווח עוד לא יצא (בשרת – כבר לא שלי)
    S.tx.push({ id: 'tCf', t: 'exp', cat: c.id, sub: 's1', subName: 'ספק דמה בע"מ', date: '2026-11-01', amt: 250, plan: '2026-12', inv: 'INV-CF', note: '', kind: 'inv', pays: [], br: 'br1', src: 's' + ID.CF });
    S.secL = { [ID.CF]: { s: 'in' } };
    // ליקוי 7: פריט אחר מהמזכירה (קובץ אחר של אותה חשבונית) שמחכה בתיבה המקומית
    S.inbox.push({ id: 'sOther', by: 'המזכירה', ow: '', at: new Date().toISOString(), d: { cat: c.id, sub: 's1', subName: 'ספק דמה בע"מ', amt: '42', date: '2026-11-01', inv: 'INV-42', dn: false, note: '' }, file: '', np: 0, sec: 'f' + '9'.repeat(40), secK: 'inv' });
    S.orgC = { branches: BR, banks: [], cards: [] }; if (SY.biz) SY.biz.org = S.orgC;
    save();
  }, { BR, ID });
}
const last = (bodies, n, f) => bodies.filter((b) => b[0] === n && (!f || f(b[1]))).pop();
const card = (id) => `#secIv_${id}`;
const lastToast = (page) => page.evaluate(() => { const t = document.getElementById('toast') || document.querySelector('.toast'); return t ? t.innerText : ''; });

(async () => {
  const [www] = process.argv.slice(2);
  const browser = await H.launch();
  const w = 360;
  const { ctx, page, bodies, Q } = await open(browser, www, { w, h: 740 });
  await seedData(page, ID);
  Q.ready = true;
  await page.evaluate(() => { window.__secInv.at = 0; go('sec'); }); await H.settle(page, 1500);
  await page.evaluate(() => { const b = document.querySelector('#secTabs [data-v=inv]'); if (b) b.click(); }); await H.settle(page, 1200);
  // ליקוי 1
  const cf = await page.evaluate((id) => ({ cf: !!(S.secCf && S.secCf[id]), led: !!(S.secL && S.secL[id]), tx: S.tx.filter((t) => t.id === 'tCf').length }), ID.CF);
  check(`${w}: ליקוי 1 – done נדחה (not-mine) על חשבונית שנרשמה כאן: נשמרה התראה, ההוצאה לא נמחקה`, cf.cf && !cf.led && cf.tx === 1 && !!last(bodies, 'secDecide', (b) => b.op === 'done' && b.id === ID.CF), cf);
  check(`${w}: ליקוי 1 – כרטיס "ייתכן שנרשמה פעמיים" במסך`, !!(await page.$('#secIvCf')) && /נרשמה פעמיים/.test(await page.evaluate(() => document.getElementById('secIvCf').innerText)));
  await page.click('#secIvCf [data-a=secIvCfOk]'); await H.settle(page, 400);
  check(`${w}: ליקוי 1 – "בדקתי" מסיר את ההתראה`, !(await page.$('#secIvCf')) && (await page.evaluate((id) => !(S.secCf && S.secCf[id]), ID.CF)));
  // ליקוי 7
  check(`${w}: ליקוי 7 – פריט מהמזכירה עם אותה חשבונית בתיבה המקומית: לא נתפס אוטומטית, עוכב hold:dup`, !last(bodies, 'secDecide', (b) => b.op === 'claim' && b.id === ID.E1) && !!last(bodies, 'secDecide', (b) => b.op === 'hold' && b.id === ID.E1 && b.why === 'dup'));
  // ליקוי 4
  check(`${w}: ליקוי 4 – נכנסה במכשיר אחר: אין כפתור ביטול, יש הסבר`, !(await page.$(card(ID.OK) + ' [data-a=secIvUndo]')) && /אפשר לבטל רק שם/.test(await page.evaluate((s) => document.querySelector(s).innerText, card(ID.OK))));
  await page.evaluate((id) => ACT.secIvUndo({ dataset: { id } }), ID.OK); await H.settle(page, 400);
  check(`${w}: ליקוי 4 – קריאה ישירה לביטול: לא נשלח undo לשרת`, !last(bodies, 'secDecide', (b) => b.op === 'undo') && !(await page.evaluate(() => document.getElementById('dlg').open)));
  // תגיות
  const tUA = await page.evaluate((s) => document.querySelector(s).innerText, card(ID.UA));
  check(`${w}: ליקוי 2 – "שולח לא מאומת" על חשבונית ממייל לא מאומת`, /שולח לא מאומת/.test(tUA), tUA.slice(0, 200));
  check(`${w}: ליקוי 1 – תגית "נלקחה במכשיר אחר" על חשבונית ששוחררה`, /נלקחה במכשיר אחר/.test(await page.evaluate((s) => document.querySelector(s).innerText, card(ID.RL))));
  check(`${w}: ליקוי 5 – כרטיס "תקלה בהורדת הקובץ"`, /תקלה בהורדת הקובץ/.test(await page.evaluate((s) => document.querySelector(s).innerText, card(ID.DL))));
  // החלטה 1
  const cap = await page.evaluate(() => { const i = document.querySelector('form[data-f=secIvCap] input[name=cap]'); return i ? i.value : null; });
  check(`${w}: החלטה 1 – ברירת המחדל של התקרה במסך: 20000`, cap === '20000', cap);
  // החלטה 4
  check(`${w}: החלטה 4 – הצעה להחליף את תעודת המשלוח`, !!(await page.$(card(ID.D1) + ' [data-a=secIvDn]')));
  await page.click(card(ID.D1) + ' [data-a=secIvDn]'); await H.settle(page, 400);
  const dq = await page.evaluate(() => document.getElementById('dlg').open ? document.getElementById('dlg').innerText : '');
  check(`${w}: החלטה 4 – השאלה מציינת את הסכום החדש`, /הסכום יעודכן לסכום שבחשבונית/.test(dq), dq.slice(0, 200));
  await page.click('#dlg [data-a=yes]'); await H.settle(page, 900);
  const dn = await page.evaluate(() => { const t = S.tx.find((x) => x.id === 'tDn'); return { inv: t.inv, dn: !!t.dn, amt: t.amt, n: S.tx.filter((x) => x.sub === 's2').length }; });
  check(`${w}: החלטה 4 – התעודה הוחלפה בחשבונית, והסכום עודכן ל-300`, dn.inv === 'B-99' && !dn.dn && dn.amt === 300 && dn.n === 1, dn);
  check(`${w}: בלי גלילה לרוחב`, (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1);
  check(`${w}: בלי שגיאות JS`, page.__errors.length === 0, page.__errors);
  await ctx.close();
  await browser.close();
  console.log(fail ? `נכשלו ${fail}` : 'הכול עבר');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
