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
   החזרות: אין עדיין פונקציית שרת – נשמרות במכשיר בלבד (srv:false) עד שלב 1.
   PosDataCore.create(deps) – הליבה בלי דפדפן (לבדיקות). בדפדפן deps מחוברים ל-fnCall / fsx / SY / localStorage. */
(function (root) {
'use strict';
const OFF = root && root.PosOffline || (typeof require === 'function' ? require('./pos-offline.js') : null);
const CAT = root && root.PosCatalog || (typeof require === 'function' ? require('./pos-catalog.js') : null);
const pad = (n) => String(n).padStart(6, '0');
const dayOf = (t) => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const clone = (o) => JSON.parse(JSON.stringify(o));
function rid(rand) { const a = rand(9); return 'r' + Date.now().toString(36) + Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(''); }
const defRand = (n) => { const a = new Uint8Array(n); if (root && root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(a); else for (let i = 0; i < n; i++) a[i] = Math.floor(Math.random() * 256); return a; };
// מוצר מ-Firestore (prod) → מוצר קופה. price בשקלים → אגורות; מחיר סניף (bp) קודם. מוצר כבוי (on:false) – לא נכנס
function toProd(d, br) {
  if (!d || !d.id || !d.name || d.on === false) return null;
  const sh = d.bp && typeof d.bp === 'object' && typeof d.bp[br] === 'number' ? d.bp[br] : +d.price;
  if (!Number.isFinite(sh) || sh < 0) return null;
  return { id: String(d.id), name: String(d.name), barcode: d.barcode ? String(d.barcode) : '', sku: d.sku ? String(d.sku) : '', price: Math.round(Math.round(sh * 10000) / 100), al: Array.isArray(d.al) ? d.al.filter((x) => typeof x === 'string') : [] };
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
    Q.on((s) => { for (const f of netSubs) { try { f(s); } catch (e) { /* */ } } });
    return Q;
  }
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
  function decorate(s) { const o = clone(s); o.sync = s.practice ? 'T' : q().mark(s.reqId) || '✓'; const it = q().item(s.reqId); if (it && it.res && it.res.id) o.srvId = it.res.id; return o; }
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
        const it = q().add({ reqId, fn: 'posSale', kind: 'sale', payload }, { seq: true }); // נכתב למכשיר כאן, לפני הקבלה
        no = it.seq; id = d + '-' + pad(no);
      }
      led.sales.push(Object.assign(clone(sale), { id, no, at, day: dayOf(at), reqId, dev: d, cashier: who.id, shift: shiftOf().id }, practice ? { practice: true } : {}));
      ledSave();
      return { id, no, at, reqId, sync: practice ? 'T' : q().mark(reqId) };
    },
    getSales: async (o) => { const d = o && o.day || dayOf(now()); return ledger().sales.filter((s) => s.day === d).reverse().map(decorate); },
    getSale: async (no) => { const s = ledger().sales.find((x) => x.no === +no || x.id === no || x.no0 === +no); return s ? decorate(s) : null; },
    returnedQty: async (saleNo) => { const m = {}; ledger().rets.filter((r) => r.saleNo === +saleNo).forEach((r) => r.lines.forEach((l) => { m[l.pid] = (m[l.pid] || 0) + l.qty; })); return m; },
    saveReturn: async (ret) => {
      const at = now(), led = ledger(); led.rseq += 1; const no = led.rseq, id = 'R' + (dev() || 'T') + '-' + pad(no);
      led.rets.push(Object.assign(clone(ret), { id, no, at, day: dayOf(at), dev: dev(), cashier: deps.cashier().id, shift: shiftOf().id, srv: false }));
      ledSave();
      return { id, no, at };
    },
    dayStats: async () => {
      const d = dayOf(now()), l = ledger(), S = l.sales.filter((s) => s.day === d), R = l.rets.filter((r) => r.day === d);
      return { sales: S.length, total: S.reduce((a, s) => a + s.total, 0), returns: R.length, returnsTotal: R.reduce((a, r) => a + r.total, 0), pending: q().pending() };
    },
    net: () => q().status(),
    onNet: (f) => { netSubs.add(f); return () => netSubs.delete(f); },
    mark: (reqId) => q().mark(reqId),
    flush: () => q().flush(),
    retry: () => q().retryErr(),
    netChanged: (up) => { if (up) seqSynced = false; q().netChanged(up); },
    cart: () => OFF.cart({ store, key: base() }),
    practice: () => !dev(),
    _q: () => q(),
    _reset: () => { store.del(base() + ':q'); store.del(base() + ':led'); store.del(base() + ':cart'); Q = null; L = null; },
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
  });
  DATA.onNet((s) => { root.PosOffline.paint(s); try { root.dispatchEvent(new CustomEvent('lp-pos-net', { detail: s })); } catch (e) { /* */ } });
  return DATA;
}
// ממשק קבוע (window.PosData) שמפנה לעסק / לקופה הנוכחיים
const PD = {};
['getSession', 'getProducts', 'refreshProducts', 'search', 'searchSync', 'explain', 'byBarcode', 'saveSale', 'getSales', 'getSale', 'returnedQty', 'saveReturn', 'dayStats',
  'net', 'onNet', 'mark', 'flush', 'retry', 'netChanged', 'cart', 'practice', '_reset'].forEach((k) => { PD[k] = function () { return data()[k].apply(null, arguments); }; });
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
