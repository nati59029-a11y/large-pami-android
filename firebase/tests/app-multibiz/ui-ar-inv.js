'use strict';
// 15.11.2026 (שלב 4 – חשבוניות, קבלות וזיכויים): www/ar-inv.js + ar-inc.js מול רשת מדומה. כרטיס הזמנה (חשבונית / הפק חשבונית), "סמן שולם" עם אסמכתא (עובד),
// כרטיס לקוח (יתרה, מסמכים, קבלה עם בחירת חשבוניות), זיכוי לפי שורות ("החזרה למלאי" כבויה), הגדרות (מנהל), קבלות שהופקו, וסנכרון ההכנסות (incOf).
// ובלי "מסמכים פעילים" – אין שום שינוי. שימוש: node ui-ar-inv.js <www-dir> [out.json] [shots-dir]
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const out = {}; let fail = 0;
const check = (name, ok, info) => { out[name] = { ok: !!ok, info }; if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 500) : '')); };
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
const S = (v) => ({ stringValue: v }), N = (v) => (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }), M = (o) => ({ mapValue: { fields: o } }), A = (a) => ({ arrayValue: { values: a } }), B = (v) => ({ booleanValue: v });
const doc = (p, f) => ({ document: { name: 'projects/demo-largpeami/databases/(default)/documents/b/biz-o/' + p, fields: f } });
const T1 = Date.UTC(2026, 10, 3, 8, 0, 0), T2 = Date.UTC(2026, 10, 12, 9, 0, 0);
const CUST = [doc('cust/cT', { name: S('חברת שוטף'), bn: S('חברת שוטף בע"מ'), phone: S('0541111111'), wholesale: B(true), terms: M({ b: S('eom'), d: N(30) }), ar: M({ bal: N(12500), open: N(12500), cr: N(0), at: N(T2) }) }),
  doc('cust/cP', { name: S('פרטי'), phone: S('0541111115'), pay: S('cash') })];
const it2 = () => A([M({ pid: S('pA'), n: S('עוגה'), qty: N(1), price: N(12) }), M({ pid: S('pB'), n: S('כוס'), qty: N(10), price: N(5) })]);
const o = (id, no, st, custId, x) => doc('ord/' + id, Object.assign({ no: N(no), br: S('br1'), status: S(st), total: N(62), vm: S('ex'), vr: N(18), gross: N(73.16), at: N(T1), custId: S(custId), cust: M({ name: S('לקוח ' + no), phone: S('0541111111') }), items: it2() }, x || {}));
const SHP = { shp: M({ at: N(T2), by: S('w') }) };
const ORD = [o('o1', 1, 'work', 'cT'), o('o8', 8, 'wait_pay', 'cT', Object.assign({ inv: M({ id: S('invD1'), no: N(1), t: S('inv'), draft: B(true) }) }, SHP)),
  o('o9', 9, 'paid', 'cP', { vm: S('inc'), paid: M({ method: S('cash'), amt: N(62), at: N(T2), by: S('w') }) })];
const LINES = A([M({ n: S('עוגה'), q: N(1), p: N(12), pid: S('pA') }), M({ n: S('כוס'), q: N(10), p: N(5), pid: S('pB') })]);
const SNAP = M({ name: S('חברת שוטף בע"מ'), phone: S('0541111111'), mail: S('t@x.co') });
const ARDOC = [doc('ardoc/invD1', { t: S('inv'), ser: S('D'), no: N(1), d: S('2026-11-12'), due: S('2026-12-31'), cust: S('cT'), custSnap: SNAP, lines: LINES, vm: S('ex'), rate: N(18), net: N(6200), vat: N(1116), gross: N(7316), open: N(7316), st: S('open'), draft: B(true), br: S('br1'), ord: A([S('o8')]), at: N(T2), upd: N(T2) }),
  doc('ardoc/invD2', { t: S('inv'), ser: S('D'), no: N(2), d: S('2026-11-13'), due: S('2026-12-31'), cust: S('cT'), custSnap: SNAP, lines: LINES, vm: S('ex'), rate: N(18), net: N(6200), vat: N(1116), gross: N(7316), open: N(5184), st: S('part'), draft: B(true), br: S('br1'), ord: A([]), at: N(T2 + 1), upd: N(T2) }),
  doc('ardoc/rcD1', { t: S('rc'), ser: S('D'), no: N(1), d: S('2026-11-13'), cust: S('cT'), custSnap: SNAP, lines: A([]), vm: S('inc'), rate: N(0), net: N(2132), vat: N(0), gross: N(2132), open: N(0), st: S('ok'), draft: B(true), br: S('_'), ord: A([]), pay: M({ m: S('transfer') }), proof: S('pAAAAAAAAAA'), at: N(T2 + 2), upd: N(T2) })];
const PROD = [doc('prod/pA', { name: S('עוגה'), price: N(12), on: B(true), q: M({ br1: N(5) }) }), doc('prod/pB', { name: S('כוס'), price: N(5), on: B(true), q: M({ br1: N(50) }) })];
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 9)]);

async function open(browser, www, who, calls, arOn) {
  const cfg = { mode: 'new', users: { m: 'biz-o', w: 'biz-o' }, biz: { 'biz-o': { dataRoot: 'b', features: ALL, name: 'עסק בדיקה' } }, admins: { 'b/biz-o/|m': 1 }, staff: { 'b/biz-o/|w': 1 } };
  const log = [];
  const { ctx, page } = await H.newPage(browser, www, cfg, log, 'ai' + who + (arOn ? 1 : 0));
  page.on('pageerror', (e) => log.push('pageerror: ' + e.message));
  await ctx.route(/:8080\/.*/, async (route) => {
    const req = route.request(); const u = new URL(req.url()); const body = req.postData() || '';
    const J = (st, b) => route.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(b) });
    if (/:runQuery$/.test(u.pathname)) { let c = '', w = null; try { const q = JSON.parse(body).structuredQuery; c = q.from[0].collectionId; w = q.where; } catch (e) { /* */ }
      if (c === 'ardoc') { let L = ARDOC; const f = w && w.fieldFilter; if (f) L = L.filter((d) => { const v = d.document.fields[f.field.fieldPath]; return v && v.stringValue === f.value.stringValue; }); calls.push({ n: 'q:ardoc', d: f ? f.field.fieldPath : '' }); return J(200, L); }
      return J(200, c === 'ord' ? ORD : c === 'prod' ? PROD : c === 'cust' ? CUST : [{ readTime: '2026-11-03T09:00:00Z' }]); }
    if (/\/arcfg\/main$/.test(u.pathname)) return arOn ? J(200, { name: 'x', fields: { on: B(true), name: S('עסק'), wt: M({ oc: S('order_doc') }), z: M({ br2: B(true) }) } }) : J(404, { error: { code: 404 } });
    if (/\/arcfg\/off$/.test(u.pathname)) return J(404, { error: { code: 404 } });
    const dm = /\/ardoc\/([^/]+)$/.exec(u.pathname); if (dm) { const d = ARDOC.find((x) => x.document.name.endsWith('/' + dm[1])); return d ? J(200, d.document) : J(404, { error: { code: 404 } }); }
    const cm = /\/cust\/([^/]+)$/.exec(u.pathname); if (cm) { const d = CUST.find((x) => x.document.name.endsWith('/' + cm[1])); return d ? J(200, d.document) : J(404, { error: { code: 404 } }); }
    if (/\/ordcfg\/main$/.test(u.pathname)) return J(200, { name: 'x', fields: { pay: M({ mode: S('phone') }), src: M({ br1: S('stock') }) } });
    if (/\/ord\/o\d\/log/.test(u.pathname)) return J(200, { documents: [] });
    if (/\/documents\/b\/biz-o$/.test(u.pathname) && req.method() === 'GET') return J(200, { name: 'x', fields: { dataRoot: S('b'), status: S('active'), name: S('עסק בדיקה'), features: M(Object.fromEntries(Object.keys(ALL).map((k) => [k, B(true)]))), org: M({ v: N(1), branches: A([M({ id: S('br1'), name: S('נחל לכיש'), on: B(true) }), M({ id: S('br2'), name: S('יהודה הנשיא'), on: B(true) })]) }) } });
    return route.fallback();
  });
  await ctx.route(/:5001\/.*/, async (route) => {
    const n = new URL(route.request().url()).pathname.split('/').pop(); let d = {}; try { d = JSON.parse(route.request().postData()).data; } catch (e) { /* */ }
    calls.push({ n, d });
    const R = { getCosts: { cost: {} }, ordProfit: { n: 0, total: 0, paid: 0, paidN: 0 }, arProof: { ok: true, id: 'pTESTPROOF01', done: true }, arReceipt: { id: 'rcD2', no: 2, draft: true, gross: 5000, left: 0 },
      arCredit: { id: 'crD1', no: 1, draft: true, gross: 1180, left: 0 }, markOrderPaid: { ok: true, dup: false, ar: { t: 'rc', id: 'rcD3', no: 3 } }, arIssue: { t: 'ir', id: 'irD1', no: 1, draft: true, gross: 6200 }, arDoc: { b64: 'JVBERi0xLjQ=', name: 'x.pdf' } };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: R[n] || { ok: true } }) });
  });
  await H.login(page, who + '@x.co');
  await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden && ACT.startBlank) ACT.startBlank(); });
  await page.setViewportSize({ width: 360, height: 740 });
  return { ctx, page, log };
}

(async () => {
  const [www, outFile, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const shot = async (page, n) => { if (shots) await page.screenshot({ path: path.join(shots, n + '.png'), fullPage: true }); };
  const browser = await H.launch();
  const view = async (page, v, id) => { await page.evaluate(([a, b]) => go(a, b), [v, id]); await H.settle(page, 1200); await page.evaluate(([a, b]) => go(a, b), [v, id]); await H.settle(page, 500);
    return page.evaluate(() => { const m = document.getElementById('main'); return { t: m.innerText, inv: !!m.querySelector('#arinv'), iss: !!m.querySelector('[data-a=arIss]'), cr: !!m.querySelector('[data-a=arCr]'), share: !!m.querySelector('[data-a=arDShare]'), ov: document.documentElement.scrollWidth - innerWidth }; }); };

  // בלי "מסמכים פעילים": אין שום תוספת
  { const calls = []; const { ctx, page, log } = await open(browser, www, 'm', calls, false);
    await page.evaluate(() => go('ox')); await H.settle(page, 1200);
    const a = await view(page, 'oxOrd', 'o8'), c = await view(page, 'ocCard', 'cT');
    check('0 מתג כבוי: בכרטיס ההזמנה ובכרטיס הלקוח – בלי "חשבונית" ובלי "חשבוניות וקבלות", בלי שאילתת ardoc', !a.inv && !/חשבוניות וקבלות/.test(c.t) && !calls.some((x) => x.n === 'q:ardoc'), { a: a.inv, calls: calls.map((x) => x.n) });
    check('0א בלי שגיאות JS', !log.some((x) => /pageerror|TypeError|ReferenceError/.test(x)), log.filter((x) => /pageerror/.test(x)).slice(0, 3));
    await ctx.close(); }

  for (const who of ['w', 'm']) {
    const calls = []; const { ctx, page, log } = await open(browser, www, who, calls, true);
    await page.evaluate(() => go('ox')); await H.settle(page, 1500);
    const a = await view(page, 'oxOrd', 'o8'); await shot(page, who + '-01-חשבונית-בהזמנה');
    check(who + ' 1 הזמנה שנשלחה עם חשבונית: "חשבונית מס #1", טיוטה, שיתוף / ווטסאפ / מייל / זיכוי, בלי גלילה לרוחב', a.inv && /חשבונית מס #1/.test(a.t) && /טיוטה – לא מסמך רשמי/.test(a.t) && a.share && a.cr && a.ov <= 0, a);
    const b = await view(page, 'oxOrd', 'o9'), c1 = await view(page, 'oxOrd', 'o1');
    check(who + ' 2 הזמנה ששולמה בלי חשבונית – "הפק חשבונית"; הזמנה בטיפול – בלי סעיף חשבונית', b.iss && !c1.inv, { b: b.iss, c1: c1.inv });
    // "סמן שולם" בהזמנה עם חשבונית פתוחה
    await view(page, 'oxOrd', 'o8'); await page.click('[data-a=oxPaid]'); await H.settle(page, 300);
    const dl = await page.evaluate(() => { const d = document.querySelector('#dlg'); return { pf: !!d.querySelector('input[name=pf][required]'), f: (d.querySelector('form') || {}).dataset ? d.querySelector('form').dataset.f : '' }; });
    if (who === 'w') {
      check('w 3 עובד: "סמן שולם" על חשבונית פתוחה – חובה צילום אסמכתא (החלטה 25)', dl.pf && dl.f === 'arPaidF', dl);
      await page.setInputFiles('#dlg input[name=pf]', { name: 'p.jpg', mimeType: 'image/jpeg', buffer: JPG });
      const n0 = calls.length; await page.click('#dlg form[data-f=arPaidF] button:not([type=button])'); await H.settle(page, 1500);
      const cs = calls.slice(n0); const mp = cs.find((x) => x.n === 'markOrderPaid');
      check('w 3א העלאה (arProof) ואז markOrderPaid עם proofId', cs.some((x) => x.n === 'arProof') && mp && mp.d.proofId === 'pTESTPROOF01' && mp.d.id === 'o8', cs.map((x) => x.n));
    } else {
      check('m 3 מנהל: "סמן שולם" – החלון הרגיל (בלי חובת אסמכתא)', !dl.pf && dl.f === 'oxPaidF', dl);
      await page.evaluate(() => closeDlg());
    }
    // כרטיס הלקוח
    const cc = await view(page, 'ocCard', 'cT'); await shot(page, who + '-02-כרטיס-לקוח');
    check(who + ' 4 כרטיס לקוח: "חשבוניות וקבלות", יתרה ₪125, 3 מסמכים, רישום תשלום וסיכום חודשי, בלי גלילה לרוחב', /חשבוניות וקבלות/.test(cc.t) && /125/.test(cc.t) && /קבלה #1/.test(cc.t) && /חשבונית מס #2/.test(cc.t) && /שולמה חלקית/.test(cc.t) && cc.ov <= 0, cc.t.slice(cc.t.indexOf('חשבוניות וקבלות'), cc.t.indexOf('חשבוניות וקבלות') + 300));
    // קבלה: בחירת חשבונית 2 בסכום 50
    await page.click('[data-a=arRc]'); await H.settle(page, 600); await shot(page, who + '-03-קבלה');
    await page.fill('#dlg input[name=amt]', '50'); await page.check('#dlg input[name=i_invD2]'); await page.fill('#dlg input[name=a_invD2]', '50');
    let n0 = calls.length; await page.click('#dlg form[data-f=arRcF] button:not([type])'); await H.settle(page, 800);
    if (who === 'w') {
      check('w 5 עובד בלי צילום – לא נשלח לשרת', !calls.slice(n0).some((x) => x.n === 'arReceipt'), calls.slice(n0).map((x) => x.n));
      await page.setInputFiles('#dlg input[name=pf]', { name: 'p.jpg', mimeType: 'image/jpeg', buffer: JPG });
      n0 = calls.length; await page.click('#dlg form[data-f=arRcF] button:not([type])'); await H.settle(page, 1200);
    }
    const rc = calls.slice(n0).find((x) => x.n === 'arReceipt');
    check(who + ' 5א קבלה: arReceipt עם סכום, אמצעי, בחירת חשבונית' + (who === 'w' ? ' ו-proofId' : ''), rc && rc.d.amt === 50 && rc.d.cust === 'cT' && rc.d.method === 'cash' && JSON.stringify(rc.d.alloc) === JSON.stringify([{ inv: 'invD2', amt: 50 }]) && (who === 'm' || rc.d.proofId === 'pTESTPROOF01') && /^r/.test(rc.d.reqId), rc && rc.d);
    // זיכוי לפי שורות מהמסמך
    await view(page, 'ocCard', 'cT'); await page.click('[data-a=arDocV][data-id=invD1]'); await H.settle(page, 300);
    const dv = await page.evaluate(() => { const d = document.querySelector('#dlg'); return { cr: !!d.querySelector('[data-a=arCr]'), due: !!d.querySelector('form[data-f=arDueF]') }; });
    check(who + ' 6 מסמך: זיכוי זמין; שינוי מועד תשלום – ' + (who === 'm' ? 'מנהל רואה' : 'עובד לא רואה'), dv.cr && dv.due === (who === 'm'), dv);
    await page.click('#dlg [data-a=arCr]'); await H.settle(page, 500); await shot(page, who + '-04-זיכוי');
    const rsOff = await page.evaluate(() => !document.querySelector('#dlg input[name=rs]').checked);
    await page.check('#dlg input[name=mode][value=lines]'); await page.fill('#dlg input[name=l_1]', '2'); await page.fill('#dlg input[name=why]', 'שבורות');
    n0 = calls.length; await page.click('#dlg form[data-f=arCrF] button:not([type])'); await H.settle(page, 800);
    const crc = calls.slice(n0).find((x) => x.n === 'arCredit');
    check(who + ' 7 זיכוי לפי שורות: "החזרה למלאי" כבויה; arCredit {mode:lines, lines:[{i:1,q:2}]} בלי restock', rsOff && crc && crc.d.mode === 'lines' && JSON.stringify(crc.d.lines) === JSON.stringify([{ i: 1, q: 2 }]) && crc.d.restock === undefined && crc.d.reason === 'שבורות' && crc.d.inv === 'invD1', { rsOff, d: crc && crc.d });
    if (who === 'm') {
      const g = await view(page, 'arCfg'); await shot(page, 'm-05-הגדרות');
      check('m 8 הגדרות: "חשבוניות וקבלות" – תבניות ווטסאפ ו"דוח Z" לכל סניף (יהודה הנשיא מסומן)', /חשבוניות וקבלות/.test(g.t) && /דוח Z/.test(g.t) && await page.evaluate(() => document.querySelector('input[name=z_br2]').checked && !document.querySelector('input[name=z_br1]').checked), g.ov);
      await page.fill('input[name=wt_inv]', 'invoice_doc'); await page.check('input[name=z_br1]');
      n0 = calls.length; await page.click('form[data-f=arInvCfgF] button'); await H.settle(page, 800);
      const sc = calls.slice(n0).find((x) => x.n === 'setArCfg');
      check('m 8א שמירה: setArCfg {wt:{oc נשמר, inv}, z:{br1,br2}}', sc && sc.d.wt.oc === 'order_doc' && sc.d.wt.inv === 'invoice_doc' && sc.d.z.br1 === true && sc.d.z.br2 === true, sc && sc.d);
      const rl = await view(page, 'arRcList');
      check('m 9 "קבלות שהופקו": קבלה #1 ברשימה', /קבלה #1/.test(rl.t), rl.t.slice(0, 200));
      await page.click('[data-a=arDocV][data-id=rcD1]'); await H.settle(page, 300);
      check('m 9א קבלה: "אסמכתא" ו"ביטול קבלה" למנהל', await page.evaluate(() => !!document.querySelector('#dlg [data-a=arPfV]') && !!document.querySelector('#dlg [data-a=arVoid]')));
      await page.click('#dlg [data-a=arVoid]'); await H.settle(page, 300); await page.fill('#dlg input[name=why]', 'הצ׳ק חזר');
      n0 = calls.length; await page.click('#dlg form[data-f=arVoidF] button'); await H.settle(page, 800);
      const vc = calls.slice(n0).find((x) => x.n === 'arVoidRc');
      check('m 9ב ביטול קבלה → arVoidRc עם סיבה', vc && vc.d.id === 'rcD1' && vc.d.reason === 'הצ׳ק חזר', vc && vc.d);
      // סנכרון הכנסות – הפונקציה הטהורה
      const inc = await page.evaluate(() => { const f = window.__arInc.incOf, op = new Set(['oLink']);
        const d = (x) => Object.assign({ id: 'x', t: 'inv', no: 1, d: '2026-11-12', gross: 11800, br: 'br1', ord: ['o1'], custSnap: { name: 'ל' }, draft: true }, x);
        return { inv: f(d({}), op, {}), cr: f(d({ t: 'cr', gross: 1180 }), op, {}), irZ: f(d({ t: 'ir', br: 'br2', pay: { m: 'cash' } }), op, { br2: true }), irNoZ: f(d({ t: 'ir', pay: { m: 'cash' } }), op, { br2: true }), irZtr: f(d({ t: 'ir', br: 'br2', pay: { m: 'transfer' } }), op, { br2: true }), crIrZ: f(d({ t: 'cr', br: 'br2', ref: 'irD3' }), op, { br2: true }),
          link: f(d({ ord: ['oLink'] }), op, {}), crLink: f(d({ t: 'cr', ord: ['oLink'] }), op, {}), rc: f(d({ t: 'rc' }), op, {}), nb: f(d({ br: '_' }), op, {}),
          irZcard: f(d({ t: 'ir', br: 'br2', pay: { m: 'card' } }), op, { br2: true }), irZlink: f(d({ t: 'ir', br: 'br2', pay: { m: 'card', via: 'link' } }), op, { br2: true }), irZphone: f(d({ t: 'ir', br: 'br2', pay: { m: 'card', via: 'phone' } }), op, { br2: true }) }; });
      // תיקון סבב 1: קישור ספק – החשבונית נספרת (החלטה 6; הקישור מקוזז ב-arop_, ראו 10ב); דוח Z – רק מזומן / אשראי בקופה, לא קישור / טלפון (via)
      check('m 10 הכנסות (incOf): חשבונית = +118 בתאריך החשבונית ובסניף; זיכוי = −11.80; חשבונית מס קבלה במזומן / אשראי בקופה בסניף עם דוח Z – לא (בהעברה, בקישור ובטלפון – כן); הזמנה מקישור ספק – החשבונית כן (aro); קבלה – לא',
        inc.inv && inc.inv.amt === 118 && inc.inv.date === '2026-11-12' && inc.inv.br === 'br1' && inc.inv.cat === 'c_ordinc' && /טיוטה/.test(inc.inv.note) && inc.inv.aro === 'o1' && inc.cr.amt === -11.8 && inc.cr.aro === undefined && inc.irZ === null && inc.irNoZ && inc.irNoZ.amt === 118 && inc.irZtr && inc.irZtr.amt === 118 && inc.crIrZ === null && inc.link && inc.link.amt === 118 && inc.link.aro === 'oLink' && inc.crLink && inc.rc === null && inc.nb.br === undefined
        && inc.irZcard === null && inc.irZlink && inc.irZlink.amt === 118 && inc.irZphone && inc.irZphone.amt === 118, inc);
      // סנכרון בפועל ביומן המנהל (S.tx): חשבונית = תנועת הכנסה אחת; קבלה – לא; הרצה שנייה – בלי שינוי
      const sy = await page.evaluate(async () => { const a = await window.__arInc.arInc(); const b = await window.__arInc.arInc();
        return { a, b, tx: S.tx.filter((t) => String(t.id).indexOf('ar_') === 0).map((t) => [t.id, t.amt, t.date, t.br || '', t.cat, !!t.x]).sort() }; });
      // (הסנכרון כבר רץ לבד במעבר בין מסכי ההזמנות – לכן a יכול להיות 0)
      check('m 10א arInc (רץ לבד במסכי ההזמנות): ar_invD1 ו-ar_invD2 (₪73.16, בתאריך החשבונית, br1, הכנסות מהזמנות), בלי הקבלה; הרצה חוזרת – 0 שינויים',
        [0, 2].includes(sy.a) && sy.b === 0 && JSON.stringify(sy.tx) === JSON.stringify([['ar_invD1', 73.16, '2026-11-12', 'br1', 'c_ordinc', false], ['ar_invD2', 73.16, '2026-11-13', 'br1', 'c_ordinc', false]]), sy);
      // תיקון סבב 1 (ליקוי 3): הזמנה o8 (של invD1) שולמה גם בקישור הספק – op_o8 נשאר (הזכות אצל הספק), ונוצר קיזוז arop_o8 = −73.16 בתאריך התשלום
      const ko = await page.evaluate(async () => { S.tx.push({ id: 'op_o8', t: 'inc', cat: 'c_ordinc', sub: 's_ordlink', date: '2026-11-10', amt: 73.16, note: 'הזמנה #8', off: { sub: 'sSUP' }, ordp: 'o8', br: 'br1' });
        const a = await window.__arInc.arInc(); const b = await window.__arInc.arInc();
        const op = S.tx.find((t) => t.id === 'op_o8'), k = S.tx.find((t) => t.id === 'arop_o8');
        const r1 = { a, b, op: [op.amt, !!op.x, op.off && op.off.sub], k: k && [k.amt, k.date, k.br, k.cat, !!k.off, !!k.x], net: S.tx.filter((t) => !t.x && t.t === 'inc' && /^(op|arop|ar)_/.test(t.id)).reduce((s, t) => s + t.amt, 0) };
        op.x = 1; const c = await window.__arInc.arInc(); return Object.assign(r1, { c, kx: !!k.x }); });
      check('m 10ב הזמנה עם חשבונית ששולמה בקישור: arop_o8 −73.16 (2026-11-10, br1, בלי off), op_o8 לא השתנה (הזכות אצל הספק נשארת), ההכנסה = רק החשבוניות; op בוטל → גם הקיזוז מבוטל; הרצה חוזרת – 0',
        [0, 1].includes(ko.a) && ko.b === 0 && JSON.stringify(ko.op) === JSON.stringify([73.16, false, 'sSUP']) && JSON.stringify(ko.k) === JSON.stringify([-73.16, '2026-11-10', 'br1', 'c_ordinc', false, false]) && Math.abs(ko.net - 146.32) < 0.001 && ko.kx === true, ko);
    }
    const errs = log.filter((x) => /pageerror|TypeError|ReferenceError/.test(x));
    check(who + ' 11 בלי שגיאות JS', errs.length === 0, errs.slice(0, 3));
    await ctx.close();
  }
  await browser.close();
  if (outFile) fs.writeFileSync(outFile, JSON.stringify({ out }, null, 1));
  console.log(fail ? `תוצאה: נכשל (${fail})` : 'תוצאה: הכול עבר'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
