'use strict';
// שלב B2b (24.11.2026): מסכי ההזמנות והקופה נפתחים מיד מהעותק השמור במכשיר (DC.sfill/sput, www/dev-cache.js) ואז מתעדכנים מהשרת. רשת מדומה, בלי אמולטור.
// לכל מסך: אחרי ביקור אחד עם רשת וטעינה מחדש – המידע השמור מוצג לפני שהשרת עונה (התשובות מעוכבות 1.5 שניות); בזמן הזה פעולות של הזמנות/כסף
// לא מבוצעות ("מעדכן מהשרת…", בלי קריאה לשרת); אחר כך המסך מתעדכן למידע החדש והפעולות עובדות; בלי רשת – המידע השמור (עם שורת "אין חיבור");
// 403 מהשרת מוריד את העותק מהמסך; אין שגיאות JS.
// מסכים: הזמנות (ox, oxOrd, oxNew), לקוחות (ocList), להזמין מספקים (oxSup), סגירת קופה (zc), הפקדות (dp), סיכום סגירות (zs), קופה והפקדות (cm), קופה (cash).
// שימוש: node ui-instant-2.js <www-dir>
const H = require('./harness');
let fail = 0; const check = (n, ok, info) => { if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined && !ok ? ' | ' + JSON.stringify(info).slice(0, 500) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const S = (v) => ({ stringValue: String(v) }), I = (v) => ({ integerValue: String(v) }), N = (v) => (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v });
const M = (o) => ({ mapValue: { fields: o } }), A = (a) => ({ arrayValue: { values: a } }), B = (v) => ({ booleanValue: !!v });
const DOCS = 'projects/demo-largpeami/databases/(default)/documents/b/acme/';
const docOf = (name, f) => ({ name: DOCS + name, fields: f, createTime: '2026-11-03T09:00:00Z', updateTime: '2026-11-03T09:00:00Z' });
const T0 = H.T0, D1 = 864e5;
let VER = 'א', DELAY = 0, OFF = false, ERR = '', ANS = {}; const WR = [];
// טופס סגירה תקין (כמו ui-cash-mgr.js): קרן 1500 + 2350 − 1400 = 2450
const F = (o) => Object.assign({ d: '', no: '12', credit: '5820', cash: '2350', total: '8170', float: '1500', csales: '2350', cout: '1400', drawer: '2450', oTot: '2450' }, o);
// המידע בכל גרסה (VER) שונה, כדי להבדיל בין העותק השמור לתשובה החדשה
const DB = () => {
  const zc = (d, reg, by, st) => ({ uid: S('w1'), by: S(by), t: I(T0 - D1), st: S(st), np: I(1), reg: S(reg), d: S(d), tm: S('21:00'), no: S('7'), data: S(JSON.stringify({ v: 1, f: F({ d, oD: d }) })) });
  const co = (o) => Object.assign({ uid: S('w1'), by: S('dana'), t: I(T0 - D1), reg: S('i_yh'), d: S('2026-11-02'), tm: S('10:00'), a: N(100), why: S('—'), dep: S(''), src: S(''), zc: S(''), dp: S('') }, o);
  return {
    ord: { o1: { no: N(12), status: S('new'), total: N(24), at: N(T0 - 36e5), byName: S('דנה'), cust: M({ name: S('לקוח ' + VER), phone: S('0501234567') }), items: A([M({ pid: S('pA'), n: S('מוצר ' + VER), qty: N(2), price: N(12) })]) } },
    prod: { pA: { name: S('מוצר ' + VER), price: N(12), on: B(true), q: M({ _: N(5) }) } },
    cust: { c1: { name: S('לקוחה ' + VER), phone: S('0529876543') } },
    supord: { s1: { n: S('פריט ' + VER), sup: S('ספק'), qty: N(1), no: N(12), ord: S('o1'), st: S('open'), at: N(T0 - 36e5) } },
    closings: { z1: zc('2026-11-02', 'i_yh', 'חודשי ' + VER, 'ok'), z2: zc('2026-11-03', 'i_nl', 'סוגר ' + VER, 'new') },
    cashout: { c1: co({ zc: S('z1'), a: N(300), why: S('ספק ירקות') }), c3: co({ reg: S('i_nl'), a: N(600), why: S('הפקדה ' + VER), dep: S('1') }), c4: co({ a: N(250), why: S('בתוך אישור'), dep: S('1'), dp: S('p9') }) },
    deposits: { p9: { uid: S('w1'), by: S('מפקיד ' + VER), t: I(T0 - D1), d: S('2026-11-02'), items: A([S('c4')]), a: N(250), st: S('new'), why: S(''), np: I(1), data: S('{}') } },
  };
};
// פונקציות שרת לקריאה בלבד (לא נספרות כפעולה)
const RD = ['ordProfit', 'tkStaffNames', 'secState', 'secChatLoad', 'cxHist', 'cxCfg', 'arImpList'];
const val = (v) => (v.stringValue !== undefined ? v.stringValue : v.integerValue !== undefined ? +v.integerValue : v.doubleValue);
function match(w, f) {
  if (!w) return true;
  if (w.compositeFilter) return w.compositeFilter.filters.every((x) => match(x, f));
  if (!w.fieldFilter) return true;
  const ff = w.fieldFilter, x = f[ff.field.fieldPath] ? val(f[ff.field.fieldPath]) : '';
  if (ff.op === 'EQUAL') return x === val(ff.value);
  if (ff.op === 'IN') return ff.value.arrayValue.values.map(val).includes(x);
  if (ff.op === 'GREATER_THAN_OR_EQUAL') return x >= val(ff.value);
  if (ff.op === 'LESS_THAN_OR_EQUAL') return x <= val(ff.value);
  return true;
}
// תג לכל תשובה (כדי לדעת אם השרת כבר ענה למסך): ord, cust, supord, zq (סגירות לאישור), zs (סגירות החודש), dq (הפקדות לאישור), dpq (הוצאות להפקדה)
const tagOf = (c, w) => { const fp = w && w.fieldFilter && w.fieldFilter.field.fieldPath;
  if (c === 'closings') return fp === 'st' ? 'zq' : 'zs'; if (c === 'deposits') return 'dq';
  if (c === 'cashout') return JSON.stringify(w || {}).includes('"dep"') ? 'dpq' : 'co'; return c; };
async function mock(ctx) {
  await ctx.route((u) => ['8080', '5001', '9099'].includes(new URL(u).port), async (route) => {
    const req = route.request(), u = new URL(req.url()), m = req.method(), p = decodeURIComponent(u.pathname), body = req.postData() || '';
    if (OFF) return route.abort('internetdisconnected');
    const ok = async (o, tag) => { if (DELAY) await sleep(DELAY); ANS[tag] = (ANS[tag] || 0) + 1; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) }); };
    const deny = async (tag) => { if (DELAY) await sleep(DELAY); ANS[tag] = (ANS[tag] || 0) + 1; return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { code: 403, message: 'PERMISSION_DENIED', status: 'PERMISSION_DENIED' } }) }); };
    if (u.port === '5001') { const fn = p.split('/').pop();
      if (fn === 'getCosts') return ok({ result: { cost: { pA: 5 } } }, 'cost');
      if (fn === 'getWsPrices') return ok({ result: { wp: {} } }, 'wsp');
      if (!RD.includes(fn)) WR.push('fn ' + fn); return route.fallback(); }
    if (u.port !== '8080') return route.fallback();
    const i = p.indexOf('/documents/b/acme'); if (i < 0) return route.fallback(); const R = p.slice(i + 17).split('?')[0];
    let js = null; try { js = body ? JSON.parse(body) : null; } catch (e) { /* */ }
    if (R === ':runQuery') { const sq = js.structuredQuery, c = sq.from[0].collectionId, D = DB(); if (!D[c]) return route.fallback();
      const tag = tagOf(c, sq.where); if (ERR && ERR.split(',').includes(tag)) return deny(tag);
      const rows = Object.keys(D[c]).filter((id) => match(sq.where, D[c][id])).map((id) => ({ document: docOf(c + '/' + id, D[c][id]), readTime: 'x' }));
      return ok(rows.length ? rows : [{ readTime: 'x' }], tag); }
    if (R === ':batchGet') { const D = DB(); return ok(js.documents.map((n) => { const id = n.split('/').pop(); return D.deposits[id] ? { found: docOf('deposits/' + id, D.deposits[id]) } : { missing: n }; }), 'bg'); }
    if (R === '/ordcfg/main') return ok(docOf('ordcfg/main', { vat: N(18) }), 'ordcfg');
    if (m !== 'GET' && !/^\/pres\//.test(R)) { WR.push(m + ' ' + R); return route.fallback(); } // pres – נוכחות (קבוצות), לא קשור
    return route.fallback();
  });
}
const main = (pg) => pg.evaluate(() => (document.getElementById('main') || {}).innerText || '');
const banner = (pg) => pg.evaluate(() => { const e = document.getElementById('dcnet'); return e ? e.innerText : ''; });
const toasts = (pg) => pg.evaluate(() => [...document.querySelectorAll('.toast')].map((x) => x.innerText).join('|'));
const dlgOpen = (pg) => pg.evaluate(() => { const d = document.getElementById('dlg'); const o = !!(d && d.open); if (o) closeDlg(); return o; });
const waitFor = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 4000)) { if (await fn()) return Date.now() - t0; await sleep(50); } return -1; };
const has = async (pg, re) => re.test(await main(pg));
const reload = async (pg) => { ANS = {}; await pg.reload(); await pg.waitForFunction(() => typeof SY !== 'undefined' && SY.uid && typeof cur === 'function', null, { timeout: 15000 });
  await pg.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden && typeof ACT.startBlank === 'function') ACT.startBlank(); if ($('#dlg').open) closeDlg(); }); };
const goV = (pg, v, a) => pg.evaluate(([v, a]) => { NAV = [{ v: 'home' }]; go(v, a); }, [v, a]);
const click = (pg, sel) => pg.evaluate((s) => { const b = document.querySelector(s); if (b) b.click(); return !!b; }, sel);
// פעולה ישירה (כמו לחיצה) עם אלמנט מדומה – בודקים שלא נקראה פונקציה בשרת ולא נשלחה כתיבה
const act = (pg, name, ds, frm) => pg.evaluate(([n, ds, frm]) => { const el = document.createElement(frm ? 'form' : 'button'); Object.assign(el.dataset, ds || {}); try { const r = (frm ? FRM : ACT)[n](el); if (r && r.catch) r.catch(() => {}); return true; } catch (e) { return String(e); } }, [name, ds, frm]);
const WAIT = /מעדכן מהשרת/;
const scKeys = (pg) => pg.evaluate(() => new Promise((res) => { const r = indexedDB.open('lp-cache'); r.onsuccess = () => { try { const q = r.result.transaction('k').objectStore('k').getAllKeys(); q.onsuccess = () => { r.result.close(); res(q.result.map(String).filter((k) => /\|SCR\|/.test(k))); }; } catch (e) { res([]); } }; r.onerror = () => res([]); }));

(async () => {
  const [www] = process.argv.slice(2); const browser = await H.launch();
  const cfg = { mode: 'new', users: { ma: 'acme' }, biz: { acme: { dataRoot: 'b', features: { orders: true, cashClose: true } } }, admins: { 'b/acme/|ma': 1 } };
  const x = await H.newPage(browser, www, cfg, [], 'm-instant2'); const pg = x.page; await pg.setViewportSize({ width: 412, height: 900 });
  await mock(x.ctx); await H.login(pg, 'ma@x.co');
  await pg.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden && typeof ACT.startBlank === 'function') ACT.startBlank(); });

  // 1. ביקור ראשון עם רשת: הזמנות, לקוחות, להזמין מספקים, סגירת קופה, הפקדות, סיכום סגירות, קופה והפקדות
  await goV(pg, 'ox'); const t1 = await waitFor(() => has(pg, /#12/), 6000);
  await goV(pg, 'oxOrd', 'o1'); await waitFor(() => has(pg, /לקוח א/), 4000);
  await goV(pg, 'ocList'); await waitFor(() => has(pg, /לקוחה א/), 4000);
  await goV(pg, 'oxSup'); await waitFor(() => has(pg, /פריט א/), 4000);
  await goV(pg, 'zc'); await waitFor(() => has(pg, /סוגר א/), 6000);
  await goV(pg, 'dp'); await waitFor(() => has(pg, /מפקיד א/) && has(pg, /הפקדה א/), 6000);
  await goV(pg, 'zs'); await waitFor(() => has(pg, /21:00/), 6000);
  const zs1 = await main(pg);
  await goV(pg, 'cm'); await waitFor(() => pg.evaluate(() => document.querySelectorAll('#main .cmg-list > .cmg-li').length > 0), 6000);
  check('1 ביקור ראשון: הזמנות, לקוחות, ספקים, סגירות, הפקדות וסיכום סגירות נטענו מהשרת', t1 >= 0 && /21:00/.test(zs1), { t1, zs1: zs1.slice(0, 200) });
  await sleep(900);
  const keys = await pg.evaluate(() => new Promise((res) => { const r = indexedDB.open('lp-cache'); r.onsuccess = () => { const q = r.result.transaction('k').objectStore('k').getAllKeys(); q.onsuccess = () => { r.result.close(); res(q.result.map(String)); }; }; r.onerror = () => res([]); }));
  const need = ['ox', 'oxc', 'oc', 'so', 'zq', 'dq', 'dpq', 'zs|2026-11'];
  check('1א נשמר במכשיר עותק תצוגה לכל מסך (עסק|משתמש|SCR|שם)', need.every((n) => keys.some((k) => k === 'acme|ma|SCR|' + n)), keys.filter((k) => /\|SCR\|/.test(k)));
  check('1ב מחירי לקוח עסקי (getWsPrices) לא נשמרים במכשיר', !keys.some((k) => /getWsPrices/.test(k)), keys.filter((k) => /Ws/.test(k)));

  // 2. הזמנות: טעינה מחדש, השרת עונה אחרי 1.5 שניות – מיד מהעותק השמור (א), פעולות מחכות, ואז החדש (ב)
  VER = 'ב'; DELAY = 1500; await reload(pg); WR.length = 0;
  await goV(pg, 'ox');
  const t2 = await waitFor(() => has(pg, /#12/), 2500); const a2 = ANS.ord || 0;
  check('2 רשימת ההזמנות אחרי טעינה מחדש: מוצגת מיד מהעותק השמור, לפני תשובת השרת', t2 >= 0 && a2 === 0, { t2, a2, ANS, m: (await main(pg)).slice(0, 200) });
  check('2א אין שורת "אין חיבור" כשיש רשת', (await banner(pg)) === '');
  await goV(pg, 'oxOrd', 'o1');
  check('2ב כרטיס ההזמנה מוצג מיד מהעותק השמור', (await has(pg, /לקוח א/)) && !(ANS.ord), (await main(pg)).slice(0, 200));
  const sc2 = await pg.evaluate(() => !!(window.__ox && window.__ox.sc));
  // תיקון בדיקה 1: פעולות אחרות באפליקציה (ייבוא CSV של הוצאות, בקשות לעדכון) לא נחסמות כשמוצג עותק של ההזמנות
  const un = await pg.evaluate(() => { const A = ['impNo', 'impTpl', 'impCancel', 'impGo', 'impUndo', 'arF', 'arRefresh', 'arSt', 'arDel', 'arImg', 'arPicDel'], Fm = ['impMap', 'arAdd', 'arSt'];
    return { have: A.filter((k) => typeof ACT[k] === 'function').length + Fm.filter((k) => typeof FRM[k] === 'function').length, wrapped: A.filter((k) => ACT[k] && ACT[k].scg).concat(Fm.filter((k) => FRM[k] && FRM[k].scg).map((k) => 'FRM.' + k)),
      ord: ['oxStat', 'oxSave', 'ocNew', 'arIss', 'hsOrdSel'].filter((k) => !(ACT[k] && ACT[k].scg)).concat(['oxPaidF', 'arPaidF'].filter((k) => !(FRM[k] && FRM[k].scg))), chg: !!(CHG.oxNc && CHG.oxNc.scg) }; });
  check('2-1 בזמן עותק שמור של ההזמנות: ייבוא הוצאות (impGo, impMap…) ובקשות לעדכון (arAdd, arF…) לא נחסמים; פעולות ההזמנות כן', sc2 && un.have >= 10 && un.wrapped.length === 0 && un.ord.length === 0 && un.chg, un);
  const ar0 = await pg.evaluate(() => { const t0 = document.querySelectorAll('.toast').length; try { ACT.arF({ dataset: { v: 'all' } }); } catch (e) { /* */ } const T = [...document.querySelectorAll('.toast')].slice(t0).map((x) => x.innerText).join('|'); return T; });
  check('2-2 לחיצה על סינון בקשות לעדכון (arF) בזמן עותק שמור – בלי "מעדכן מהשרת"', !WAIT.test(ar0), ar0);
  await pg.evaluate(() => { const s = document.createElement('select'); s.innerHTML = '<option value="zero">z</option>'; s.value = 'zero'; CHG.oxNc(s); });
  await sleep(150);
  check('2-3 שינוי "מוצר שנגמר" (CHG.oxNc) על עותק שמור – לא נשלח לשרת', !WR.includes('fn setOrderCfg'), WR);
  await act(pg, 'oxStat', { id: 'o1', s: 'work' }); await act(pg, 'oxPaid', { id: 'o1' }); await act(pg, 'oxSave', {}); await act(pg, 'oxCancel', { id: 'o1' }); await act(pg, 'oxWs', {});
  await act(pg, 'oxPaidF', { id: 'o1' }, 1); await act(pg, 'oxEdit', { id: 'o1' });
  await sleep(150); const tt2 = await toasts(pg); const dl2 = await dlgOpen(pg);
  check('2ג על עותק שמור: שינוי סטטוס, תשלום, שמירה, ביטול, עריכה ומחירי לקוח עסקי לא מבוצעים ("מעדכן מהשרת…", בלי קריאה לשרת)', sc2 && WAIT.test(tt2) && !dl2 && WR.length === 0 && !ANS.wsp, { sc2, tt2, dl2, WR, ANS });
  await goV(pg, 'oxNew'); const nw2 = await main(pg);
  check('2ד "הזמנה חדשה" לא נפתחת מהעותק השמור (מחכה לשרת)', WAIT.test(nw2) && !/מוצרים/.test(nw2), nw2.slice(0, 200));
  await goV(pg, 'oxOrd', 'o1');
  const t2b = await waitFor(() => has(pg, /לקוח ב/), 5000);
  check('2ה אחר כך ההזמנה מתעדכנת מהשרת', t2b >= 0 && !(await has(pg, /לקוח א/)), (await main(pg)).slice(0, 200));
  await waitFor(() => pg.evaluate(() => !!(window.__ox && window.__ox.cost && !window.__ox.csc)), 5000);
  WR.length = 0; await act(pg, 'oxStat', { id: 'o1', s: 'work' }); await waitFor(async () => WR.length > 0, 4000);
  check('2ו אחרי התשובה מהשרת – שינוי סטטוס נשלח כרגיל', WR.includes('fn setOrderStatus'), WR);
  await goV(pg, 'oxNew'); const nw2b = await main(pg);
  check('2ז אחרי התשובה מהשרת – "הזמנה חדשה" נפתחת כרגיל', !WAIT.test(nw2b) && /מוצרים/.test(nw2b), nw2b.slice(0, 200));
  await pg.evaluate(() => { window.__ox.draft = null; }); await sleep(1600);

  // 3. לקוחות ולהזמין מספקים: העותק השמור (א) מיד, פעולות מחכות, ואז החדש (ג)
  VER = 'ג'; await reload(pg); WR.length = 0;
  await goV(pg, 'ocList');
  const t3 = await waitFor(() => has(pg, /לקוחה א/), 2500); const a3 = ANS.cust || 0;
  check('3 רשימת הלקוחות אחרי טעינה מחדש: מוצגת מיד מהעותק השמור', t3 >= 0 && a3 === 0, { t3, a3, m: (await main(pg)).slice(0, 200) });
  await act(pg, 'ocNew'); await act(pg, 'ocWs', { id: 'c1' });
  const hc = await pg.evaluate(() => { const sc = !!(window.__oc && window.__oc.sc); if (typeof HS !== 'undefined') HS.f = HS.f || null; const t0 = document.querySelectorAll('.toast').length; ACT.hsCustSel({ dataset: { id: 'c1' } }); return { sc, t: [...document.querySelectorAll('.toast')].slice(t0).map((x) => x.innerText).join('|') }; });
  check('3-1 חוסרים: בחירת לקוח מרשימה שהיא עותק שמור (hsCustSel) מחכה לשרת', hc.sc && WAIT.test(hc.t), hc);
  await sleep(150);
  const dl3 = await dlgOpen(pg);
  check('3א על עותק שמור: לקוח חדש וסימון לקוח עסקי לא נפתחים ולא נשלחים', !dl3 && WR.length === 0 && WAIT.test(await toasts(pg)), { dl3, WR });
  check('3ב אחר כך הלקוחות מתעדכנים מהשרת', await waitFor(() => has(pg, /לקוחה ג/), 5000) >= 0 && !(await has(pg, /לקוחה א/)), (await main(pg)).slice(0, 200));
  await goV(pg, 'oxSup');
  const t3c = await waitFor(() => has(pg, /פריט [אב]/), 2500); const a3c = ANS.supord || 0;
  check('3ג "להזמין מספקים": מוצג מיד מהעותק השמור', t3c >= 0 && a3c === 0, { t3c, a3c, m: (await main(pg)).slice(0, 200) });
  WR.length = 0; await click(pg, '[data-a=oxSoSt][data-s=ord]'); await sleep(150);
  check('3ד על עותק שמור: "הוזמן" לא נשלח לשרת', WR.length === 0, WR);
  check('3ה אחר כך "להזמין מספקים" מתעדכן מהשרת', await waitFor(() => has(pg, /פריט ג/), 5000) >= 0, (await main(pg)).slice(0, 200));
  await sleep(1600);

  // 4. קופה: סגירות לאישור, הפקדות, סיכום סגירות, קופה והפקדות – העותק השמור (א) מיד, אישור/דחייה/בחירה מחכים, ואז החדש (ד)
  VER = 'ד'; await reload(pg); WR.length = 0;
  await goV(pg, 'cash');
  const t4c = await waitFor(() => pg.evaluate(() => /סגירת קופה\s*1/.test((document.getElementById('main') || {}).innerText || '') || [...document.querySelectorAll('#main .tag')].some((t) => t.innerText.trim() === '1')), 2500);
  check('4 "סגירת קופה והפקדות": מספר הממתינים מוצג מיד מהעותק השמור', t4c >= 0 && !ANS.zq, { t4c, ANS, m: (await main(pg)).slice(0, 300) });
  await goV(pg, 'zc');
  const t4 = await waitFor(() => has(pg, /סוגר [אבג]/), 2500); const a4 = ANS.zq || 0;
  check('4א "סגירות לאישור" אחרי טעינה מחדש: מוצגות מיד מהעותק השמור', t4 >= 0 && a4 === 0, { t4, a4, m: (await main(pg)).slice(0, 300) });
  await click(pg, '[data-a=zcOk]'); await click(pg, '[data-a=zcNo]'); await sleep(150);
  const dl4 = await dlgOpen(pg), tx4 = await pg.evaluate(() => S.tx.filter((t) => /^zc:/.test(t.src || '')).length);
  check('4ב על עותק שמור: "אשר והכנס" ו"דחה" לא מבוצעים (לא נרשמת הכנסה, לא נשלח לשרת)', !dl4 && tx4 === 0 && WR.length === 0 && WAIT.test(await toasts(pg)), { dl4, tx4, WR });
  check('4ג אחר כך הסגירות מתעדכנות מהשרת', await waitFor(() => has(pg, /סוגר ד/), 6000) >= 0 && !(await has(pg, /סוגר [אבג]/)), (await main(pg)).slice(0, 300));
  await reload(pg); WR.length = 0; await goV(pg, 'dp'); // טעינה מחדש נפרדת: ההפקדות נטענות מהשרת רק מהמסך הזה
  const t4d = await waitFor(() => has(pg, /מפקיד [א-ד]/) && has(pg, /הפקדה [א-ד]/), 2500);
  check('4ד "העלאת אישור הפקדה": ההפקדות לאישור וההוצאות להפקדה מוצגות מיד', t4d >= 0, { t4d, ANS, m: (await main(pg)).slice(0, 300) });
  WR.length = 0; await click(pg, '[data-a=dqOk]'); await click(pg, '[data-a=dqDel]');
  const ck = await pg.evaluate(() => { const c = document.querySelector('input[data-c=dpSel]'); if (!c) return 'none'; c.click(); return c.checked; });
  await act(pg, 'dpSend', {}, 1); await sleep(150);
  const dl4d = await dlgOpen(pg), sel4 = await pg.evaluate(() => Object.values((DP && DP.sel) || {}).filter(Boolean).length);
  check('4ה על עותק שמור: אישור/מחיקת הפקדה, בחירת הוצאה ושליחת הפקדה לא מבוצעים', !ANS.dq && !ANS.dpq && !dl4d && ck === false && sel4 === 0 && WR.length === 0, { dl4d, ck, sel4, WR, ANS });
  check('4ו אחר כך ההפקדות מתעדכנות מהשרת', await waitFor(async () => (await pg.evaluate(() => !!(DQ.L && DPQ.L && !DQ.sL && !DPQ.sL))) && (await has(pg, /מפקיד ד/)) && (await has(pg, /הפקדה ד/)), 6000) >= 0, (await main(pg)).slice(0, 300));
  const ck2 = await pg.evaluate(() => { const c = document.querySelector('input[data-c=dpSel]'); if (!c) return 'none'; const b0 = c.checked; c.click(); return [b0, c.checked, !!DP.sel[c.dataset.id]]; });
  check('4ו1 אחרי התשובה מהשרת – בחירת הוצאה להפקדה עובדת כרגיל (הסימון מתחלף ונשמר)', Array.isArray(ck2) && ck2[1] === !ck2[0] && ck2[2] === ck2[1], ck2);
  await goV(pg, 'zs');
  const t4z = await waitFor(() => has(pg, /21:00/), 2500); const a4z = ANS.zs || 0;
  check('4ז "סיכום סגירות קופה": החודש מוצג מיד מהעותק השמור (לא "טוען סגירות…")', t4z >= 0 && a4z === 0, { t4z, a4z, m: (await main(pg)).slice(0, 300) });
  check('4ח אחר כך סיכום הסגירות מתעדכן מהשרת', await waitFor(() => pg.evaluate(() => { const D = ZS.D[ZS.m]; return !!(D && D.L && !D.sc); }), 8000) >= 0);
  VER = 'ה'; await reload(pg);
  await goV(pg, 'cm');
  const t4m = await waitFor(() => pg.evaluate(() => document.querySelectorAll('#main .cmg-list > .cmg-li').length > 0), 2500); const a4m = ANS.zs || 0;
  check('4ט "קופה והפקדות": הסגירות מוצגות מיד מהעותק השמור', t4m >= 0 && a4m === 0, { t4m, a4m, m: (await main(pg)).slice(0, 300) });
  await waitFor(async () => (ANS.zs || 0) > 0, 6000); await sleep(400);
  await goV(pg, 'ox'); await waitFor(() => has(pg, /#12/), 5000); await goV(pg, 'zc'); await waitFor(() => has(pg, /סוגר ה/), 6000); await goV(pg, 'zs'); await sleep(2500);

  // 5. בלי רשת: המסכים מהעותק השמור, עם שורת "אין חיבור"
  OFF = true; DELAY = 0; await reload(pg);
  await goV(pg, 'ox');
  check('5 בלי רשת: ההזמנות מהעותק השמור', await waitFor(() => has(pg, /#12/), 4000) >= 0, (await main(pg)).slice(0, 200));
  check('5א בלי רשת: מוצגת שורת "אין חיבור"', await waitFor(async () => /אין חיבור/.test(await banner(pg)), 4000) >= 0, await banner(pg));
  await goV(pg, 'zc');
  check('5ב בלי רשת: הסגירות לאישור מהעותק השמור', await waitFor(() => has(pg, /סוגר ה/), 4000) >= 0, (await main(pg)).slice(0, 300));
  await goV(pg, 'dp');
  check('5ג בלי רשת: ההפקדות מהעותק השמור', await waitFor(() => has(pg, /מפקיד [דה]/) && has(pg, /הפקדה [דה]/), 4000) >= 0, (await main(pg)).slice(-400));
  await goV(pg, 'zs');
  check('5ד בלי רשת: סיכום הסגירות מהעותק השמור (לא הודעת שגיאה)', await waitFor(() => has(pg, /21:00/), 4000) >= 0 && !(await has(pg, /אין חיבור לאינטרנט/)), (await main(pg)).slice(0, 300));
  await click(pg, '[data-a=zsRefresh]'); await sleep(100);
  OFF = false;

  // 6. 403 מהשרת: העותק יורד מהמסך
  ERR = 'ord,zq'; DELAY = 1200; await reload(pg);
  await goV(pg, 'ox'); const s6 = await waitFor(() => has(pg, /#12/), 2000);
  const e6 = await waitFor(async () => !(await has(pg, /#12/)), 5000);
  await sleep(1500);
  check('6 403 על ההזמנות: העותק השמור מוצג ואז יורד מהמסך (כמו היום, בלי העותק)', s6 >= 0 && e6 >= 0 && !(await has(pg, /#12|לקוח/)) && !(await pg.evaluate(() => !!window.__ox.sc)), { s6, e6, m: (await main(pg)).slice(0, 200) });
  await goV(pg, 'zc'); await waitFor(async () => (ANS.zq || 0) > 0, 6000); await sleep(300);
  check('6א 403 על הסגירות לאישור: העותק השמור יורד מהמסך', !(await has(pg, /סוגר ה/)) && (await has(pg, /אין הרשאה/)), (await main(pg)).slice(0, 300));
  await sleep(300); const k6 = await scKeys(pg);
  check('6ב 403: העותק נמחק גם מהמכשיר (ox, zq), לא רק מהמסך', !k6.includes('acme|ma|SCR|ox') && !k6.includes('acme|ma|SCR|zq') && k6.includes('acme|ma|SCR|oc'), k6);
  ERR = ''; DELAY = 0;

  // 7. יציאה מהחשבון מוחקת את עותקי התצוגה
  await pg.evaluate(() => syOut(1)); await sleep(800);
  const dbs = await pg.evaluate(async () => (indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name) : ['?']));
  check('7 יציאה מהחשבון מוחקת את lp-cache', !dbs.includes('lp-cache'), dbs);
  check('8 אין שגיאות JS', pg.__errors.length === 0, pg.__errors);
  await x.ctx.close();
  await browser.close();
  console.log(fail ? fail + ' בדיקות נכשלו' : 'כל הבדיקות עברו'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
