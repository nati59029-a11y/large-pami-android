/* POS:M3 – קופה, גל 2 (ש3): שכבת הנתונים האמיתית. מחליפה את pos-data-mock.js (ענף feature/pos-sale-ui) באותו ממשק בדיוק:
     getSession()            → {cashier:{id,name}, shift:{id,no,openedAt}}
     getProducts()           → [{id,name,barcode,sku,price,al}]   (price באגורות, כולל מע"מ; al – כינויים)
     search(q,limit)         → [מוצר]   (pos-catalog: ברקוד/מק"ט מדויק, ברקוד חלקי, שם/כינוי – סלחני לשגיאות)
     searchSync(q,limit)     → [מוצר]   (אותו דבר, סינכרוני – אחרי שהמוצרים נטענו)
     byBarcode(code)         → מוצר או null
     saveSale(sale)          → {id,no,at,reqId,sync}   sale={lines:[{pid,name,barcode,price,qty,total}],total,vat,payments:[{m,a}],change}
     getSales({day})         → [מכירה שמורה]   (החדשה קודם; לכל מכירה sync: '✓' נשמרה בשרת | '⏳' ממתינה | '!' שגיאה | 'T' תרגול)
     getSale(no)             → מכירה שמורה או null
     returnedQty(saleNo)     → {pid: כמות שהוחזרה}
     saveReturn(ret)         → {id,no,at}   ret={saleNo,lines:[{pid,qty,price,total}],total,vat,method}
     dayStats()              → {sales,total,returns,returnsTotal,pending}
   נוסף (לא שובר את הממשק): normalize, isMock:false, net() – מצב הנורית, onNet(fn), mark(reqId), flush(), cart() – הסל השמור, practice().
   כל הפונקציות מחזירות Promise. כל הסכומים באגורות.

   מכירה: נשמרת קודם במכשיר (pos-offline, לפני שהקופה ממשיכה), ואז נשלחת ל-posSale (החוזה של שלב 0 / אפיון ב'):
     { reqId, dev, inst, lines:[{pid,n,bc,qty,unit}], soldAt, seq, gross, off }
   reqId נוצר פעם אחת ברגע התשלום ונשלח שוב ושוב עם אותו ערך עד שהשרת עונה – השרת מחזיר את המכירה הקיימת (dup), ולכן אין כפילות.
   seq – המספר הבא של הקופה, מהמונה המקומי (כמו בלי רשת), כך שמספר הקבלה ידוע מיד ושווה למספר בשרת (K1-000124).
   אם השרת דוחה את המספר (seq-used / seq-gap – למשל אחרי ניקוי המכשיר) – כל מה שממתין ממוספר מחדש מהמונה בשרת, והמספר הישן נשמר (no0).
   מכשיר שלא רשום כקופה (pos-base: "רישום המכשיר הזה") – מצב תרגול: מספרים T000001, לא נשלח לשרת לעולם.
   החזרות: saveReturn – במכשיר בלבד (srv:false; מצב תרגול). POS:W2: returnSrv – ל-posReturn של ש2 דרך תור נפרד עם reqId (ראו rq).
   PosDataCore.create(deps) – הליבה בלי דפדפן (לבדיקות). בדפדפן deps מחוברים ל-fnCall / fsx / SY / localStorage. */
(function (root) {
'use strict';
const OFF = root && root.PosOffline || (typeof require === 'function' ? require('./pos-offline.js') : null);
const CAT = root && root.PosCatalog || (typeof require === 'function' ? require('./pos-catalog.js') : null);
const pad = (n) => String(n).padStart(6, '0');
const dayOf = (t) => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const clone = (o) => JSON.parse(JSON.stringify(o));
// POS:W2 (סבב 2): מכירה שהשרת דחה בגלל אישור (פג תוקף, של משתמש אחר, חורג ממה שאושר) – יוצאת מהתור ל"מכירות שנדחו" (lp-pos-err),
// הנורית אדומה, הקופאי והמנהל מקבלים הודעה, והתור ממשיך (המכירות הבאות ממוספרות מחדש מהמונה בשרת – seq-gap → onConflict)
const SALE_REJ = new Set(['ap-bad', 'ap-used', 'ap-old', 'ap-scope', 'bad-ap', 'disc-role', 'disc-over', 'below-min']);
const reasonOf = (e) => (e && ((e.details && e.details.reason) || e.reason)) || '';
const perm = (reason, msg) => { const e = new Error(msg); e.code = 'failed-precondition'; e.details = { reason }; return e; };
function rid(rand) { const a = rand(9); return 'r' + Date.now().toString(36) + Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(''); }
const defRand = (n) => { const a = new Uint8Array(n); if (root && root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(a); else for (let i = 0; i < n; i++) a[i] = Math.floor(Math.random() * 256); return a; };
// מוצר מ-Firestore (prod) → מוצר קופה. price בשקלים → אגורות; מחיר סניף (bp) קודם. מוצר כבוי (on:false) – לא נכנס
function toProd(d, br) {
  if (!d || !d.id || !d.name || d.on === false) return null;
  const sh = d.bp && typeof d.bp === 'object' && typeof d.bp[br] === 'number' ? d.bp[br] : +d.price;
  if (!Number.isFinite(sh) || sh < 0) return null;
  // POS:W2: cat – הקטגוריה של המוצר (prod.cat, כמו בשרת): אריחים לפי קטגוריה, ומבצע על קטגוריה מחושב במכשיר כמו ב-posSale
  return { id: String(d.id), name: String(d.name), barcode: d.barcode ? String(d.barcode) : '', sku: d.sku ? String(d.sku) : '', price: Math.round(Math.round(sh * 10000) / 100), al: Array.isArray(d.al) ? d.al.filter((x) => typeof x === 'string') : [], cat: typeof d.cat === 'string' ? d.cat : '' };
}

/* deps: { store, key, dev()→'K1'|'', inst()→string, br()→'_', cashier()→{id,name}, call(fn,data)→Promise, devSeq()→Promise<lastSeq>,
           loadProducts()→Promise<[prod מ-Firestore]>, online()→bool, now?, rand?, timer? } */
function create(deps) {
  const store = deps.store, now = deps.now || (() => Date.now()), rand = deps.rand || defRand;
  const dev = () => deps.dev() || '';
  const base = () => (deps.key || 'lp-pos') + ':' + (dev() || 'T');
  let Q = null, QK = '', L = null, LK = '', P = null, C = null, pAt = 0, pLoading = null;
  const netSubs = new Set();
  function q() {
    const k = base();
    if (Q && QK === k) return Q;
    QK = k;
    Q = OFF.queue({
      store, key: k, now, timer: deps.timer, online: deps.online,
      send: (it) => deps.call(it.fn, it.payload),
      asideKey: (deps.key || 'lp-pos').replace(/^lp-pos/, 'lp-pos-err') + ':' + (dev() || 'T'),
      aside: (it, e) => {
        const rs = reasonOf(e);
        if (it.kind !== 'sale' || !SALE_REJ.has(rs)) return false;
        const led = ledger(), sl = led.sales.find((x) => x.reqId === it.reqId);
        if (sl) { sl.rej = { reason: rs, msg: String(e && e.message || '').slice(0, 200), at: now() }; if (sl.no0 == null) sl.no0 = sl.no; sl.no = null; sl.id0 = sl.id; sl.id = ''; ledSave(); }
        try { if (deps.onReject) deps.onReject({ reqId: it.reqId, seq: it.seq, reason: rs, msg: String(e && e.message || ''), gross: it.payload && it.payload.gross }); } catch (x) { /* */ }
        return true;
      },
      onConflict: async (qq, it) => {
        const last = await deps.devSeq();
        if (!Number.isInteger(last)) throw new Error('אין מונה מהשרת');
        const before = qq.items().filter((x) => x.st !== 'ok').map((x) => [x.reqId, x.seq]);
        qq.renumber(last + 1);
        const after = new Map(qq.items().map((x) => [x.reqId, x.seq]));
        const led = ledger();
        for (const [r, old] of before) { const s = led.sales.find((x) => x.reqId === r); const n = after.get(r); if (s && n !== old) { if (s.no0 == null) s.no0 = s.no; s.no = n; s.id = dev() + '-' + pad(n); } }
        ledSave();
      },
    });
    Q.on((s) => {
      for (const f of netSubs) { try { f(s); } catch (e) { /* */ } }
      // POS:W2: מכירה נשלחה – החזרות שחיכו לה יוצאות עכשיו
      if (RQ && RQK === base() + ':ret' && RQ.pending()) Promise.resolve().then(() => RQ.flush());
    });
    return Q;
  }
  // POS:W2 – החזרות לשרת (posReturn): תור נפרד בלי מספור (השרת ממספר R לכל קופה). אותו reqId נשלח שוב עד תשובה – השרת מחזיר את
  // ההחזרה הקיימת (dup), ולכן אין החזרה כפולה. החזרה שנדחתה (למשל אין יתרה להחזרה) לא עוצרת את שאר התור (skipErr).
  // החזרה על מכירה שעוד בתור המכירות – מחכה לה (שגיאה זמנית), ומספר המכירה נקבע ברגע השליחה (_sr = reqId של המכירה, אחרי מספור מחדש).
  let RQ = null, RQK = '';
  function rq() {
    const k = base() + ':ret';
    if (RQ && RQK === k) return RQ;
    RQK = k;
    RQ = OFF.queue({
      store, key: k, now, timer: deps.timer, online: deps.online, skipErr: true,
      send: (it) => {
        const p = Object.assign({}, it.payload), sr = p._sr;
        delete p._sr; delete p._m;
        if (sr) {
          const s = ledger().sales.find((x) => x.reqId === sr), w = q().item(sr);
          if (s && s.rej) return Promise.reject(perm('sale-rej', 'המכירה המקורית נדחתה בשרת – אי אפשר להחזיר עליה'));
          if (w && w.st === 'err') return Promise.reject(perm('sale-err', 'המכירה המקורית תקועה בשליחה – פנו למנהל'));
          // המכירה עוד בתור – מדלגים על ההחזרה הזו (החזרות אחרות ממשיכות) ומנסים שוב אחרי שהמכירה נשלחת
          if (w && w.st !== 'ok') { const e = new Error('המכירה המקורית עוד לא נשלחה לשרת'); e.skip = true; return Promise.reject(e); }
          if (s && s.id) p.sale = s.id;
        }
        return deps.call(it.fn, p);
      },
    });
    RQ.on(() => { const s = q().status(); for (const f of netSubs) { try { f(s); } catch (e) { /* */ } } retWatch(); });
    return RQ;
  }
  // POS:W2 (סבב 2): החזרה נרשמת במכשיר (דוח היום, מונים) רק אחרי שהשרת אישר. תשובה שהגיעה ברקע (לא מול המסך) – deps.onRet:
  //   { st:'ok', res } – אפשר להחזיר כסף לפי מה שהשרת אישר; { st:'err', reason, msg } – ההחזרה בוטלה במכשיר.
  const fg = new Set();
  let rwBusy = false;
  function retRecord(it) {
    const led = ledger();
    if (led.rets.some((r) => r.reqId === it.reqId)) return false;
    const m = (it.payload && it.payload._m) || {}, at = now(), res = it.res || {};
    led.rets.push({ id: res.id || '', reqId: it.reqId, saleId: it.payload.sale, saleNo: m.saleNo, lines: m.lines || [], total: res.amt != null ? res.amt : (m.total || 0), at, day: dayOf(at), dev: dev(), cashier: deps.cashier().id, shift: shiftOf().id, srv: true });
    ledSave();
    return true;
  }
  function retWatch() {
    if (rwBusy || !RQ) return;
    rwBusy = true;
    try {
      for (const it of RQ.items()) {
        if (fg.has(it.reqId)) continue;
        if (it.st === 'ok' && retRecord(it)) { try { if (deps.onRet) deps.onRet({ st: 'ok', reqId: it.reqId, res: it.res, m: it.payload._m || {} }); } catch (e) { /* */ } }
        if (it.st === 'err') { RQ.drop(it.reqId); try { if (deps.onRet) deps.onRet({ st: 'err', reqId: it.reqId, reason: it.reason, msg: it.err, m: it.payload._m || {} }); } catch (e) { /* */ } }
      }
    } finally { rwBusy = false; }
  }
  const sleep = (ms) => new Promise((r) => { const t = setTimeout(r, ms); if (t && t.unref) t.unref(); });
  function ledger() {
    const k = base() + ':led';
    if (L && LK === k) return L;
    LK = k;
    try { L = JSON.parse(store.get(k) || 'null'); } catch (e) { L = null; }
    if (!L || !Array.isArray(L.sales)) L = { sales: [], rets: [], tseq: 0, rseq: 0 };
    return L;
  }
  function ledSave() {
    const l = ledger(), lim = now() - 14 * 24 * 3600 * 1000;
    // שומרים במכשיר 14 יום (קבלות והחזרות מהמכשיר); מכירה שעוד לא נשלחה – לא נמחקת לעולם
    l.sales = l.sales.filter((s) => s.at >= lim || (Q && Q.mark(s.reqId) && Q.mark(s.reqId) !== '✓'));
    l.rets = l.rets.filter((r) => r.at >= lim);
    store.set(base() + ':led', JSON.stringify(l));
  }
  // ---------- מוצרים ----------
  function setProducts(list) { P = list; C = CAT.build(P); }
  function cacheLoad() { if (P) return true; try { const x = JSON.parse(store.get((deps.key || 'lp-pos') + ':prod') || 'null'); if (x && Array.isArray(x.p)) { setProducts(x.p); pAt = x.at || 0; return true; } } catch (e) { /* */ } return false; }
  async function fetchProducts() {
    if (pLoading) return pLoading;
    pLoading = (async () => {
      const raw = await deps.loadProducts(), br = deps.br ? deps.br() : '_';
      const list = raw.map((d) => toProd(d, br)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, 'he'));
      setProducts(list); pAt = now();
      try { store.set((deps.key || 'lp-pos') + ':prod', JSON.stringify({ at: pAt, p: list })); } catch (e) { /* מקום מלא – נשאר בזיכרון */ }
      return P;
    })().finally(() => { pLoading = null; });
    return pLoading;
  }
  async function ensure() {
    if (cacheLoad()) {
      // ברקע: רענון כל 10 דקות כשיש רשת
      if (now() - pAt > 10 * 60 * 1000 && deps.online()) fetchProducts().catch(() => {});
      return;
    }
    await fetchProducts();
  }
  // ---------- מכירות ----------
  let seqSynced = false;
  async function syncSeq() {
    if (seqSynced || !dev() || !deps.online()) return;
    try { const n = await deps.devSeq(); if (Number.isInteger(n)) { q().syncSeq(n); seqSynced = true; } } catch (e) { /* בלי רשת – המונה המקומי */ }
  }
  function decorate(s) { const o = clone(s); o.sync = s.practice ? 'T' : s.rej ? '!' : q().mark(s.reqId) || '✓'; const it = q().item(s.reqId); if (it && it.res && it.res.id) o.srvId = it.res.id; if (it && it.res && Array.isArray(it.res.docs)) o.docs = it.res.docs; return o; }
  const shiftOf = () => { const t = now(); return { id: (dev() || 'T') + '-' + dayOf(t).replace(/-/g, ''), no: 1, openedAt: new Date(dayOf(t) + 'T00:00:00').getTime() }; };
  const API = {
    isMock: false,
    normalize: CAT.norm,
    getSession: async () => { syncSeq(); return { cashier: deps.cashier(), shift: shiftOf(), dev: dev(), practice: !dev() }; },
    getProducts: async () => { await ensure(); return P; },
    refreshProducts: () => fetchProducts(),
    search: async (s, limit) => { await ensure(); return C.search(s, limit || 200); },
    searchSync: (s, limit) => { cacheLoad(); return C ? C.search(s, limit || 200) : []; },
    explain: (s, limit) => { cacheLoad(); return C ? C.explain(s, limit) : []; },
    byBarcode: async (code) => { await ensure(); return C.byCode(code); },
    saveSale: async (sale) => {
      if (!sale || !Array.isArray(sale.lines) || !sale.lines.length) throw new Error('אין שורות במכירה');
      await syncSeq();
      const at = now(), d = dev(), led = ledger(), reqId = rid(rand), who = deps.cashier();
      let no, id, practice = false;
      if (!d) { practice = true; led.tseq += 1; no = led.tseq; id = 'T' + pad(no); } else {
        const payload = {
          reqId, dev: d, inst: deps.inst(), soldAt: at, gross: sale.total, off: !deps.online(),
          lines: sale.lines.map((l) => Object.assign({ pid: String(l.pid || ''), n: String(l.name || '').slice(0, 120), qty: l.qty, unit: l.price }, l.barcode ? { bc: String(l.barcode).slice(0, 40) } : {})),
        };
        // POS:W2 (איחוד גל 2): התשלומים, העודף, ההקפה, הלקוח וההנחות של מסך המכירה (ש1) – ל-posSale של ש2 (כלל הסגירה נבדק בשרת)
        if (Array.isArray(sale.pays)) {
          payload.pays = sale.pays;
          if (sale.chg) payload.chg = sale.chg;
          if (sale.debt) payload.debt = sale.debt;
          if (sale.cust) payload.cust = String(sale.cust);
          if (sale.note) payload.note = String(sale.note).slice(0, 300);
          if (sale.manDisc) payload.manDisc = { amt: sale.manDisc.amt, why: String(sale.manDisc.why || '').slice(0, 80) }; // הסכום שהקופאי ראה (לא האחוז – בלי הפרשי עיגול)
          // POS:W2: אישור ההנחה (ש5, posAuth) לכל הנחה – השרת מאמת מי אישר, תפקיד, האחוז שאושר והשורה, ומסמן את האישור כמנוצל
          if (sale.manDisc && typeof sale.manDisc.ap === 'string' && sale.manDisc.ap) payload.manDisc.ap = sale.manDisc.ap;
          payload.lines = sale.lines.map((l, i) => {
            const o = payload.lines[i];
            if (l.gen || !o.pid || o.pid === 'gen') { delete o.pid; o.free = true; }
            if (l.mdisc) o.mdisc = Object.assign({ amt: l.mdisc.amt, why: String(l.mdisc.why || '').slice(0, 80) }, typeof l.mdisc.ap === 'string' && l.mdisc.ap ? { ap: l.mdisc.ap } : {});
            return o;
          });
        }
        const it = q().add({ reqId, fn: 'posSale', kind: 'sale', payload }, { seq: true }); // נכתב למכשיר כאן, לפני הקבלה
        no = it.seq; id = d + '-' + pad(no);
      }
      led.sales.push(Object.assign(clone(sale), { id, no, at, day: dayOf(at), reqId, dev: d, cashier: who.id, shift: shiftOf().id }, practice ? { practice: true } : {}));
      ledSave();
      return { id, no, at, reqId, sync: practice ? 'T' : q().mark(reqId) };
    },
    getSales: async (o) => { const d = o && o.day || dayOf(now()); return ledger().sales.filter((s) => s.day === d).reverse().map(decorate); },
    getSale: async (no) => { const L = ledger().sales; const s = L.find((x) => x.no === +no || (x.id && x.id === no)) || L.find((x) => !x.rej && x.no0 === +no); return s ? decorate(s) : null; },
    returnedQty: async (saleNo) => { const m = {}; ledger().rets.filter((r) => r.saleNo === +saleNo).forEach((r) => r.lines.forEach((l) => { m[l.pid] = (m[l.pid] || 0) + l.qty; })); return m; },
    saveReturn: async (ret) => {
      const at = now(), led = ledger(); led.rseq += 1; const no = led.rseq, id = 'R' + (dev() || 'T') + '-' + pad(no);
      led.rets.push(Object.assign(clone(ret), { id, no, at, day: dayOf(at), dev: dev(), cashier: deps.cashier().id, shift: shiftOf().id, srv: false }));
      ledSave();
      return { id, no, at };
    },
    // POS:W2 – החזרה בשרת. o = { reqId?, sale (מזהה K1-000001), saleReq?, saleNo?, items:[{i,qty}], why, cond?, tag, dmg?, refunds?, debtTo?, aps?, lines?, total? }
    //   → { reqId, res } (השרת אישר: res = { id, amt, debtOff, refunds, vouchers, docs }) | { reqId, pend:true } (בתור – יישלח כשהרשת חוזרת, עם אותו reqId).
    //   השרת דחה – שגיאה עם reason (ret-qty, ret-over-method, ap-bad …), וההחזרה לא נשמרת.
    returnSrv: async (o) => {
      const d = dev();
      if (!d) { const e = new Error('מצב תרגול – החזרה לא נשלחת לשרת'); e.reason = 'practice'; throw e; }
      const reqId = o.reqId || rid(rand);
      const payload = { op: 'do', reqId, dev: d, inst: deps.inst(), sale: o.sale, items: o.items, why: String(o.why || '').slice(0, 80), tag: o.tag === true };
      if (o.cond) payload.cond = String(o.cond).slice(0, 120);
      if (o.dmg === true) payload.dmg = true;
      if (Array.isArray(o.refunds) && o.refunds.length) payload.refunds = o.refunds;
      if (o.debtTo) payload.debtTo = o.debtTo;
      if (Array.isArray(o.aps) && o.aps.length) payload.aps = o.aps.slice(0, 5);
      if (o.saleReq) payload._sr = o.saleReq;
      payload._m = Object.assign({ saleNo: o.saleNo, lines: (o.lines || []).map((l) => ({ pid: l.pid, qty: l.qty })), total: o.total || 0 }, o.meta ? { meta: o.meta } : {}); // נשאר במכשיר (לא נשלח)
      fg.add(reqId);
      let it;
      try {
        rq().add({ reqId, fn: 'posReturn', kind: 'ret', payload });
        if (deps.online()) await Promise.race([rq().flush(), sleep(o.wait || 8000)]);
        it = rq().item(reqId);
      } finally { fg.delete(reqId); }
      if (it && it.st === 'ok') { retRecord(it); return { reqId, res: it.res }; }
      if (it && it.st === 'err') { rq().drop(reqId); const e = new Error(it.err || 'ההחזרה נדחתה'); e.reason = it.reason; throw e; }
      return { reqId, pend: true };
    },
    retPending: () => rq().pending(),
    rejected: () => q().rejected(),
    ackRejected: () => q().ackRejected(),
    retItem: (reqId) => rq().item(reqId),
    dayStats: async () => {
      const d = dayOf(now()), l = ledger(), S = l.sales.filter((s) => s.day === d && !s.rej), R = l.rets.filter((r) => r.day === d);
      return { sales: S.length, total: S.reduce((a, s) => a + s.total, 0), returns: R.length, returnsTotal: R.reduce((a, r) => a + r.total, 0), pending: q().pending() };
    },
    net: () => q().status(),
    // POS:W2: מצב התור לש7 (Devices → posOps op:'hw') – כמה ממתינים, ומתי נכנס הוותיק שבהם
    stats: () => { const w = q().items().filter((x) => x.st !== 'ok'); return { n: w.length, oldest: w.length ? Math.min(...w.map((x) => x.at || 0)) : 0 }; },
    onNet: (f) => { netSubs.add(f); return () => netSubs.delete(f); },
    mark: (reqId) => q().mark(reqId),
    flush: () => { if (dev()) rq().flush(); return q().flush(); },
    retry: () => q().retryErr(),
    netChanged: (up) => { if (up) seqSynced = false; q().netChanged(up); if (dev()) rq().netChanged(up); },
    cart: () => OFF.cart({ store, key: base() }),
    practice: () => !dev(),
    _q: () => q(),
    _reset: () => { store.del(base() + ':q'); store.del(base() + ':led'); store.del(base() + ':cart'); store.del(base() + ':ret:q'); Q = null; L = null; RQ = null; },
  };
  return API;
}

const core = { create, toProd, dayOf };
if (typeof module === 'object' && module.exports) module.exports = core;
if (!root || typeof root.document === 'undefined') return;
root.PosDataCore = core;

/* ---------- חיבור לאפליקציה ---------- */
const ls = (k) => { try { return root.localStorage.getItem(k); } catch (e) { return null; } };
const bizId = () => { try { return (typeof SY !== 'undefined' && SY && SY.bizId) || ''; } catch (e) { return ''; } };
function myDev() { try { const o = JSON.parse(ls('lp-pos-dev') || 'null'); return o && o.bizId === bizId() && /^K[1-9][0-9]{0,3}$/.test(o.dev || '') ? o.dev : ''; } catch (e) { return ''; } }
const fn = (n, d) => { d = d && typeof d === 'object' ? d : {}; try { if (SY && SY.sa && SY.bizId && !('bizId' in d)) d = Object.assign({ bizId: SY.bizId }, d); } catch (e) { /* */ } return root.fnCall(n, d); };
const decDoc = (d) => Object.assign({ id: idOf(d) }, fvj({ mapValue: d }));
async function loadProducts() {
  const out = []; let tok = '';
  for (let i = 0; i < 50; i++) {
    const j = await fsx('/prod?pageSize=1000' + (tok ? '&pageToken=' + encodeURIComponent(tok) : ''));
    for (const d of (j && j.documents) || []) out.push(decDoc(d));
    tok = j && j.nextPageToken; if (!tok) break;
  }
  return out;
}
let DATA = null, DK = '';
function data() {
  const k = bizId();
  if (DATA && DK === k) return DATA;
  DK = k;
  DATA = create({
    store: root.PosOffline.lsStore, key: 'lp-pos:' + (k || '_'),
    dev: myDev,
    inst: () => ls('lp-pos-inst') || '',
    br: () => { try { const d = myDev(); return (d && root.__posBr && root.__posBr[d]) || '_'; } catch (e) { return '_'; } },
    cashier: () => { try { return { id: SY.uid || '', name: (SY.name || String(SY.email || '').split('@')[0] || 'קופאי') }; } catch (e) { return { id: '', name: 'קופאי' }; } },
    call: fn,
    devSeq: async () => { const d = myDev(); if (!d) return null; const j = await fsx('/posdev/' + d); const o = decDoc(j); return Number.isInteger(o.lastSeq) ? o.lastSeq : 0; },
    loadProducts,
    online: () => root.navigator.onLine !== false,
    // POS:W2 (סבב 2): אירועים לממשק – מכירה שנדחתה, החזרה שהשרת ענה עליה ברקע
    onReject: (x) => { try { root.dispatchEvent(new CustomEvent('lp-pos-rej', { detail: x })); } catch (e) { /* */ } },
    onRet: (x) => { try { root.dispatchEvent(new CustomEvent('lp-pos-ret', { detail: x })); } catch (e) { /* */ } },
  });
  DATA.onNet((s) => { root.PosOffline.paint(s); try { root.dispatchEvent(new CustomEvent('lp-pos-net', { detail: s })); } catch (e) { /* */ } });
  return DATA;
}
// ממשק קבוע (window.PosData) שמפנה לעסק / לקופה הנוכחיים
const PD = {};
['getSession', 'getProducts', 'refreshProducts', 'search', 'searchSync', 'explain', 'byBarcode', 'saveSale', 'getSales', 'getSale', 'returnedQty', 'saveReturn', 'returnSrv', 'retPending', 'retItem', 'rejected', 'ackRejected', 'dayStats',
  'net', 'stats', 'onNet', 'mark', 'flush', 'retry', 'netChanged', 'cart', 'practice', '_reset'].forEach((k) => { PD[k] = function () { return data()[k].apply(null, arguments); }; });
PD.isMock = false;
PD.normalize = root.PosCatalog.norm;
PD.light = () => root.PosOffline.light(data().net());
root.PosData = PD; // מחליף את pos-data-mock.js גם אם נטען לפניו
root.addEventListener('online', () => { try { data().netChanged(true); } catch (e) { /* */ } });
root.addEventListener('offline', () => { try { data().netChanged(false); } catch (e) { /* */ } });
root.addEventListener('lp-biz-change', () => { DATA = null; });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { try { if (bizId()) data().flush(); } catch (e) { /* */ } } });
// כל 20 שניות, אם יש משהו בתור – ניסיון שליחה (בנוסף לניסיונות של התור עצמו)
setInterval(() => { try { if (bizId() && data().net().pending) data().flush(); } catch (e) { /* */ } }, 20000);
})(typeof window !== 'undefined' ? window : null);
/* /POS:M3 */
