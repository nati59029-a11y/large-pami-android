'use strict';
// הצעת מחיר (ord-quote.js, שלב 5): כפתור בטופס ← חלון תוקף 14 ← qtSave; רשימה עם 4 סטטוסים ("פג תוקף" לפי תאריך ישראל); כרטיס:
// עובד – "בקש אישור מנהל", מנהל – "אשר" והמרה עם אזהרה; המרה עוברת לכרטיס ההזמנה; שיתוף / ווטסאפ (no-tpl ← שיתוף) / מייל עם reqId חדש בכל פתיחה;
// תווית "הצעת מחיר" ביומן ההזמנה; שרת ישן ← הודעה בלי שגיאת JS. רשת מדומה. שימוש: node ui-ord-quote.js <www-dir> [out.json] [shots-dir]
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const out = {}; let fail = 0;
const check = (name, ok, info) => { out[name] = { ok: !!ok, info }; if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
const enc = (v) => { if (v === null || v === undefined) return { nullValue: null }; if (typeof v === 'string') return { stringValue: v }; if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }; if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } }; };
const doc = (p, o) => ({ document: { name: 'projects/demo-largpeami/databases/(default)/documents/b/biz-o/' + p, fields: Object.fromEntries(Object.entries(o).map(([k, x]) => [k, enc(x)])) } });
const AT = Date.UTC(2026, 10, 1, 8);
const Qd = (id, no, st, vu, x) => Object.assign({ id, no, br: 'br1', st, vu, vm: 'inc', vr: 18, total: 16, net: 13.56, vat: 2.44, gross: 16, cvReq: 'cv' + no, by: 'm', byName: 'מנהל', at: AT, upd: AT, custId: 'cW',
  cust: { name: 'דנה כהן', phone: '0502222222', mail: 'dana@example.com' }, items: [{ pid: 'pR', n: 'לחם', qty: 2, price: 5 }, { pid: 'pC', n: 'חטיף', qty: 1, price: 6 }] }, x || {});
const PROD = [doc('prod/pR', { name: 'לחם', price: 5, on: true, q: { br1: 5 } }), doc('prod/pC', { name: 'חטיף', price: 6, on: true, q: { br1: 0 } })];

async function open(browser, www, who, calls, S) {
  const cfg = { mode: 'new', users: { m: 'biz-o', w: 'biz-o' }, biz: { 'biz-o': { dataRoot: 'b', features: ALL, name: 'עסק בדיקה' } }, admins: { 'b/biz-o/|m': 1 }, staff: { 'b/biz-o/|w': 1 } };
  const { ctx, page } = await H.newPage(browser, www, cfg, [], 'qt' + who);
  const J = (route, st, b) => route.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(b) });
  await ctx.route(/:8080\/.*/, async (route) => {
    const req = route.request(); const u = new URL(req.url()); const body = req.postData() || '';
    if (/:runQuery$/.test(u.pathname)) { let c = ''; try { c = JSON.parse(body).structuredQuery.from[0].collectionId; } catch (e) { /* */ }
      if (c === 'qt' && S.oldRules) return J(route, 403, { error: { code: 403, message: 'PERMISSION_DENIED', status: 'PERMISSION_DENIED' } });
      return J(route, 200, c === 'qt' ? Object.values(S.qt).map((q) => doc('qt/' + q.id, q)) : c === 'ord' ? S.ord.map((o) => doc('ord/' + o.id, o)) : c === 'prod' ? PROD : [{ readTime: '2026-11-03T09:00:00Z' }]); }
    const m = /\/qt\/([^/?]+)$/.exec(u.pathname); if (m && req.method() === 'GET') return S.qt[m[1]] ? J(route, 200, doc('qt/' + m[1], S.qt[m[1]]).document) : J(route, 404, { error: { code: 404 } });
    if (/\/cust\//.test(u.pathname)) return J(route, 404, { error: { code: 404 } });
    if (/\/ordcfg\/main$/.test(u.pathname)) return J(route, 200, { name: 'x', fields: {} });
    if (/\/ord\/o9\/log/.test(u.pathname)) return J(route, 200, { documents: [] });
    if (/\/documents\/b\/biz-o$/.test(u.pathname) && req.method() === 'GET') return J(route, 200, { name: 'x', fields: { dataRoot: enc('b'), status: enc('active'), name: enc('עסק בדיקה'), features: enc(ALL) } });
    return route.fallback();
  });
  await ctx.route(/:5001\/.*/, async (route) => {
    const n = new URL(route.request().url()).pathname.split('/').pop(); let d = {}; try { d = JSON.parse(route.request().postData()).data; } catch (e) { /* */ }
    calls.push({ n, d });
    if (S.old && /^qt/.test(n)) return route.fulfill({ status: 404, contentType: 'text/html', body: '<html>Not Found</html>' });
    const fail = (st, status, reason, message) => J(route, st, { error: { status, message, details: { reason } } });
    const R = { createOrder: { id: 'o1', no: 1, total: 16, warn: [] }, saveCust: { id: 'cN' }, getCosts: { cost: {} }, getBackupKey: { key: Buffer.alloc(32, 7).toString('base64') } };
    if (n === 'qtSave') { S.qt.q5 = Qd('q5', 5, 'open', '2026-11-17', { cust: d.cust, items: d.items }); return J(route, 200, { result: { id: 'q5', no: 5, vu: '2026-11-17', gross: 16, total: 16, dup: false } }); }
    if (n === 'qtConvert') { if (S.convFail === 'vm') return fail(400, 'FAILED_PRECONDITION', 'quote-vm', 'x'); if (S.convFail && who === 'w') return fail(400, 'FAILED_PRECONDITION', 'quote-approval', 'ההצעה דורשת אישור מנהל: פג תוקף ב-2026-10-30');
      S.qt[d.id].st = 'conv'; S.qt[d.id].ord = { id: 'o9', no: 9 }; return J(route, 200, { result: { id: d.id, st: 'conv', ord: { id: 'o9', no: 9 }, dup: false, why: [{ t: 'exp', vu: '2026-10-30' }] } }); }
    if (n === 'qtSet') { if (d.act === 'req') S.qt[d.id].apr = { st: 'req', by: 'w', byName: 'עובד' }; if (d.act === 'ok') S.qt[d.id].apr = { st: 'ok', by: 'm', byName: 'מנהל' }; if (d.act === 'cancel') S.qt[d.id].st = 'cancel'; return J(route, 200, { result: { id: d.id, st: S.qt[d.id].st, apr: S.qt[d.id].apr } }); }
    if (n === 'qtPdf') return J(route, 200, { result: { no: 1, name: 'x.pdf', b64: 'JVBERi0=', vu: '2026-11-17' } });
    if (n === 'qtSend') return J(route, 200, { result: { no: 1, sent: [d.ch === 'wa' ? { ch: 'wa', to: d.to, ok: false, why: 'no-tpl', at: Date.now() } : { ch: 'mail', to: d.to, ok: true, at: Date.now() }] } });
    return J(route, 200, { result: R[n] || { ok: true } });
  });
  await H.login(page, who + '@x.co');
  await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden && ACT.startBlank) ACT.startBlank(); window.__shared = []; window.dxShareDU = async (du, b) => { window.__shared.push([du.slice(0, 30), b]); }; });
  await page.setViewportSize({ width: 360, height: 740 });
  return { ctx, page };
}
const mkS = () => ({ qt: { q1: Qd('q1', 1, 'open', '2026-11-17', { apr: { st: 'req', by: 'w', byName: 'עובד' } }), q2: Qd('q2', 2, 'open', '2026-10-30'), q3: Qd('q3', 3, 'conv', '2026-11-20', { ord: { id: 'o9', no: 9 } }), q4: Qd('q4', 4, 'cancel', '2026-11-20') },
  ord: [{ id: 'o9', no: 9, br: 'br1', status: 'new', total: 16, at: AT, cust: { name: 'דנה כהן', phone: '0502222222' }, items: [{ pid: 'pR', n: 'לחם', qty: 2, price: 5 }] }] });

(async () => {
  const [www, outFile, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const shot = async (page, n) => { if (shots) await page.screenshot({ path: path.join(shots, n + '.png'), fullPage: true }); };
  const browser = await H.launch();
  const ov = (page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  const txt = (page) => page.evaluate(() => document.getElementById('main').innerText.replace(/\s+/g, ' '));
  const toasts = (page) => page.evaluate(() => [...document.querySelectorAll('.toast')].map((x) => x.textContent));
  const go = async (page, v, a) => { await page.evaluate(([v, a]) => go(v, a), [v, a]); await H.settle(page, 700); };
  const click = async (page, sel) => { await page.click(sel); await H.settle(page, 600); };
  const viewOf = (page) => page.evaluate(() => cur().v);

  // ---------- מנהל ----------
  let S = mkS(), calls = []; let { ctx, page } = await open(browser, www, 'm', calls, S);
  await go(page, 'ox'); await H.settle(page, 1500);
  check('1 כפתור "הצעות מחיר" ברשימת ההזמנות', /הצעות מחיר/.test(await txt(page)));
  await go(page, 'oxNew');
  check('2 בטופס: כפתור "שמור כהצעת מחיר" ליד "שמור הזמנה"', await page.evaluate(() => !!document.querySelector('[data-a=oxQtAsk]') && !!document.querySelector('[data-a=oxSave]')));
  await click(page, '[data-a=oxQtAsk]');
  check('3 טופס ריק: הודעת שגיאה, אין חלון תוקף ואין קריאה', !(await page.evaluate(() => document.querySelector('#dlg[open]'))) && calls.filter((c) => /qt|createOrder/.test(c.n)).length === 0 && (await toasts(page)).length > 0, await toasts(page));
  await page.evaluate(() => { const D = __ox.draft; Object.assign(D, { fn: 'דנה', ln: 'כהן', phone: '0502222222' }); ACT.oxAdd({ dataset: { id: 'pR' } }); ACT.oxAdd({ dataset: { id: 'pC' } }); });
  await H.settle(page, 400); await shot(page, 'form-m360');
  await click(page, '[data-a=oxQtAsk]');
  const dv = await page.evaluate(() => { const i = document.querySelector('#dlg[open] input[name=days]'); return i && i.value; });
  check('4 חלון תוקף: ברירת מחדל 14', dv === '14', dv);
  await shot(page, 'dialog-m360');
  await page.fill('#dlg input[name=days]', '0'); await page.click('#dlg form button:not([type=button])'); await H.settle(page, 400);
  check('5 תוקף 0 נדחה בלי קריאה', calls.filter((c) => c.n === 'qtSave').length === 0);
  await page.fill('#dlg input[name=days]', '14'); await page.click('#dlg form button:not([type=button])'); await H.settle(page, 1200);
  const sv = calls.find((c) => c.n === 'qtSave');
  check('6 qtSave עם הפריטים, days 14, reqId, לקוח', sv && sv.d.days === 14 && sv.d.items.length === 2 && sv.d.items[0].pid === 'pR' && sv.d.items[0].qty === 1 && /^r/.test(sv.d.reqId) && sv.d.cust.phone && !('cell' in sv.d) && !('total' in sv.d), sv && sv.d);
  check('7 לא נוצרה הזמנה (אין createOrder)', !calls.some((c) => c.n === 'createOrder'));
  check('8 עברנו לכרטיס ההצעה, "בתוקף עד 17/11/2026", הטיוטה נוקתה', (await viewOf(page)) === 'oxQtCard' && /בתוקף עד 17\/11\/2026/.test(await txt(page)) && (await page.evaluate(() => __ox.draft === null)), await txt(page));
  await shot(page, 'card-new-m360');
  // רשימה
  await go(page, 'oxQt'); await page.evaluate(() => { __oxQt.Q.L = null; rerender(); }); await H.settle(page, 800);
  const t1 = await txt(page);
  check('9 רשימה: 4 סטטוסים עם מונים (פתוחות 2 – כולל החדשה, פג תוקף 1, הפכו 1, בוטלו 1)', /פתוחה 2/.test(t1) && /פג תוקף 1/.test(t1) && /הפכה להזמנה 1/.test(t1) && /בוטלה 1/.test(t1), t1);
  await shot(page, 'list-open-m360');
  await click(page, '[data-k=exp]');
  check('10 "פג תוקף" לפי תאריך: q2 (30/10/2026) מופיעה, q1 לא', /#2/.test(await txt(page)) && !/#1 /.test(await txt(page)) && /פג תוקף ב-30\/10\/2026/.test(await txt(page)), await txt(page));
  await click(page, '[data-k=conv]'); check('11 "הפכו להזמנה": #3', /#3/.test(await txt(page)));
  await click(page, '[data-k=cancel]'); check('12 "בוטלו": #4', /#4/.test(await txt(page)));
  check('13 אין גלישה אופקית ב-360', (await ov(page)) <= 0, await ov(page));
  // כרטיס מנהל: בקשה ממתינה → "אשר"
  await go(page, 'oxQtCard', 'q1');
  check('14 מנהל, בקשת עובד ממתינה: "אשר" ו"הפוך להזמנה"', await page.evaluate(() => !!document.querySelector('[data-a=oxQtOk]') && !!document.querySelector('[data-a=oxQtConv]')) && /ממתין לאישור מנהל/.test(await txt(page)));
  await click(page, '[data-a=oxQtOk]');
  check('15 אישור: qtSet ok, והכרטיס מעודכן', calls.some((c) => c.n === 'qtSet' && c.d.act === 'ok' && c.d.id === 'q1') && /מנהל אישר/.test(await txt(page)), await txt(page));
  await shot(page, 'card-open-m360');
  // המרה של הצעה שפגה – אזהרה ברורה
  await go(page, 'oxQtCard', 'q2');
  check('16 פג תוקף: תגית אדומה "פג תוקף ב-30/10/2026"', /פג תוקף ב-30\/10\/2026/.test(await txt(page)));
  await click(page, '[data-a=oxQtConv]');
  const wd = await page.evaluate(() => (document.querySelector('#dlg[open]') || {}).innerText || '');
  check('17 מנהל: אזהרה לפני "הפוך בכל זאת", עדיין בלי קריאה', /אזהרה: ההצעה פגה ב-30\/10\/2026/.test(wd) && /הפוך בכל זאת/.test(wd) && !calls.some((c) => c.n === 'qtConvert'), wd);
  await shot(page, 'convwarn-m360');
  await page.click('[data-a=oxQtConvGo]'); await H.settle(page, 2500);
  check('18 המרה: qtConvert {id}, מעבר לכרטיס ההזמנה', calls.filter((c) => c.n === 'qtConvert').length === 1 && (await viewOf(page)) === 'oxOrd' && /#9/.test(await page.evaluate(() => document.body.innerText)), await viewOf(page));
  // תווית יומן
  const lg = await page.evaluate(() => { __ox.log.o9 = [{ t: Date.now(), act: 'quote', note: 'נוצרה מהצעת מחיר #2' }]; rerender(); return document.getElementById('main').innerText.replace(/\s+/g, ' '); });
  check('19 יומן ההזמנה: "הצעת מחיר" ולא "quote"', /הצעת מחיר/.test(lg) && !/ quote/.test(lg), lg.slice(-200));
  // כרטיס אחרי המרה + ביטול
  await go(page, 'oxQtCard', 'q3');
  check('20 הצעה שהומרה: "הפכה להזמנה #9" וכפתור לפתיחת ההזמנה, בלי "הפוך להזמנה"', /הפכה להזמנה #9/.test(await txt(page)) && await page.evaluate(() => !!document.querySelector('[data-a=oxQtOrd]') && !document.querySelector('[data-a=oxQtConv]')));
  await shot(page, 'card-conv-m360');
  // שליחה
  await go(page, 'oxQtCard', 'q1');
  await click(page, '[data-a=oxQtSendD][data-ch=mail]');
  const mv = await page.evaluate(() => [document.querySelector('#dlg input[name=to]').value, document.querySelector('#dlg input[name=q]').value]);
  check('21 מייל: כתובת הלקוח ממולאת מראש', mv[0] === 'dana@example.com', mv);
  await page.click('#dlg form button:not([type=button])'); await H.settle(page, 800);
  const s1 = calls.find((c) => c.n === 'qtSend');
  check('22 qtSend מייל עם id, reqId, ch, to', s1 && s1.d.id === 'q1' && s1.d.ch === 'mail' && s1.d.to === 'dana@example.com' && s1.d.reqId === mv[1], s1 && s1.d);
  await click(page, '[data-a=oxQtSendD][data-ch=mail]');
  const mv2 = await page.evaluate(() => document.querySelector('#dlg input[name=q]').value);
  check('23 reqId חדש בכל פתיחת חלון שליחה', mv2 !== mv[1], [mv[1], mv2]); await click(page, '[data-a=closeDlg]');
  await click(page, '[data-a=oxQtSendD][data-ch=wa]');
  check('24 ווטסאפ: טלפון הלקוח ממולא', await page.evaluate(() => document.querySelector('#dlg input[name=to]').value) === '0502222222');
  await page.click('#dlg form button:not([type=button])'); await H.settle(page, 800);
  check('25 no-tpl מהשרת ← הצעת שיתוף מהטלפון', /אין תבנית ווטסאפ מאושרת/.test(await page.evaluate(() => (document.querySelector('#dlg[open]') || {}).innerText || '')) && await page.evaluate(() => !!document.querySelector('#dlg [data-a=oxQtShare]')));
  await shot(page, 'notpl-m360');
  await click(page, '#dlg [data-a=oxQtShare]');
  check('26 שיתוף: qtPdf ואז dxShareDU עם הקובץ', calls.some((c) => c.n === 'qtPdf') && (await page.evaluate(() => window.__shared)).length === 1, await page.evaluate(() => window.__shared));
  // ביטול
  await go(page, 'oxQtCard', 'q5'); await click(page, '[data-a=oxQtCancel]'); await click(page, '[data-a=yes]');
  check('27 ביטול: qtSet cancel והכרטיס "בוטלה"', calls.some((c) => c.n === 'qtSet' && c.d.act === 'cancel' && c.d.id === 'q5') && /בוטלה/.test(await txt(page)));
  // 412
  await page.setViewportSize({ width: 412, height: 800 });
  await go(page, 'oxQtCard', 'q1'); await shot(page, 'card-open-m412'); await go(page, 'oxQt'); await shot(page, 'list-open-m412');
  check('28 אין גלישה אופקית ב-412', (await ov(page)) <= 0);
  await go(page, 'oxNew'); await page.evaluate(() => { const D = __ox.draft; Object.assign(D, { fn: 'דנה', ln: 'כהן', phone: '0502222222' }); ACT.oxAdd({ dataset: { id: 'pR' } }); }); await H.settle(page, 300); await shot(page, 'form-m412');
  check('29 בלי שגיאות JS (מנהל)', page.__errors.length === 0, page.__errors);
  await ctx.close();

  // ---------- עובד ----------
  S = mkS(); calls = []; S.convFail = true; ({ ctx, page } = await open(browser, www, 'w', calls, S));
  await go(page, 'oxQtCard', 'q2');
  check('30 עובד, הצעה שפגה: "בקש אישור מנהל" ובלי "הפוך להזמנה" ובלי "אשר"', await page.evaluate(() => !!document.querySelector('[data-a=oxQtReq]') && !document.querySelector('[data-a=oxQtConv]') && !document.querySelector('[data-a=oxQtOk]')));
  await shot(page, 'card-exp-w360');
  await click(page, '[data-a=oxQtReq]');
  check('31 בקשה: qtSet req והכרטיס "ממתין לאישור מנהל"', calls.some((c) => c.n === 'qtSet' && c.d.act === 'req' && c.d.id === 'q2') && /ממתין לאישור מנהל/.test(await txt(page)), await txt(page));
  await go(page, 'oxQtCard', 'q1'); S.qt.q1.apr = null; await page.evaluate(() => { __oxQt.Q.c.q1.apr = null; rerender(); }); await H.settle(page, 400);
  await click(page, '[data-a=oxQtConv]');
  const ad = await page.evaluate(() => (document.querySelector('#dlg[open]') || {}).innerText || '');
  check('32 עובד, השרת דורש אישור (quote-approval): חלון עם הסיבה וכפתור "בקש אישור מנהל"', /נדרש אישור מנהל/.test(ad) && /פג תוקף/.test(ad) && /בקש אישור מנהל/.test(ad), ad);
  await shot(page, 'approval-w360');
  S.convFail = 'vm'; await click(page, '#dlg [data-a=closeDlg]'); S.qt.q1.apr = { st: 'ok', by: 'm' }; await page.evaluate(() => { __oxQt.Q.c.q1.apr = { st: 'ok' }; rerender(); }); await H.settle(page, 300);
  await click(page, '[data-a=oxQtConv]');
  check('33 quote-vm: הודעה בעברית', (await toasts(page)).some((t) => /סוג הלקוח השתנה/.test(t)), await toasts(page));
  check('34 בלי שגיאות JS (עובד)', page.__errors.length === 0, page.__errors);
  await ctx.close();

  // ---------- שרת ישן ----------
  S = mkS(); S.old = true; calls = []; ({ ctx, page } = await open(browser, www, 'm', calls, S));
  await go(page, 'oxNew'); await page.evaluate(() => { const D = __ox.draft; Object.assign(D, { fn: 'דנה', ln: 'כהן', phone: '0502222222' }); ACT.oxAdd({ dataset: { id: 'pR' } }); }); await H.settle(page, 300);
  await click(page, '[data-a=oxQtAsk]'); await page.click('#dlg form button:not([type=button])'); await H.settle(page, 1200);
  check('35 שרת ישן (404 בשמירה): "התכונה תפעל אחרי עדכון השרת", נשארים בטופס והטיוטה נשמרת', (await toasts(page)).some((t) => /התכונה תפעל אחרי עדכון השרת/.test(t)) && (await viewOf(page)) === 'oxNew' && await page.evaluate(() => !!__ox.draft), await toasts(page));
  S.oldRules = true; await go(page, 'oxQt'); await page.evaluate(() => { __oxQt.Q.L = null; rerender(); }); await H.settle(page, 800);
  check('36 חוקים ישנים (403 בקריאה): רשימה ריקה והודעה, בלי קריסה', /התכונה תפעל אחרי עדכון השרת/.test(await txt(page)), await txt(page)); await shot(page, 'list-old-m360');
  check('37 בלי שגיאות JS (שרת ישן)', page.__errors.length === 0, page.__errors);
  await ctx.close();
  await browser.close();
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
  console.log(fail ? 'נכשלו: ' + fail : 'הכול עבר');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
