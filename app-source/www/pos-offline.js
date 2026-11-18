/* POS:M3 – קופה, גל 2 (ש3): עבודה בלי רשת. תור מקומי, סל שנשמר, נורית רשת וסימן ✓. בלי Firestore – השליחה עצמה מוזרקת (send).
   אותו קובץ בדפדפן (window.PosOffline) ובבדיקות Node (module.exports) – firebase/tests/pos-offline.unit.test.js.

   PosOffline.queue({ store, key, send, online?, now?, timer?, onConflict? }) → תור
     store: { get(k) → מחרוזת|null, set(k, מחרוזת), del(k) } – סינכרוני (localStorage). כל שינוי נכתב מיד, לפני שהפעולה חוזרת.
     send(item) → Promise<תשובת השרת>. שגיאה עם offline / קוד רשת / unavailable / internal / unauthenticated = "אין רשת, ננסה שוב".
     q.add({ reqId, fn, payload, kind? }, { seq: true }) → הפריט שנשמר. seq:true – מקבל את המספר הבא של הקופה (payload.seq),
       באותה כתיבה עם המונה, כך שאין שני פריטים עם אותו מספר גם אם האפליקציה נסגרת באמצע.
     q.flush() → Promise<{ sent, left }>. שולח לפי הסדר, אחד אחד. אותו reqId נשלח שוב עד שיש תשובה – השרת (posreq) מחזיר את
       המכירה הקיימת (dup), ולכן אין כפילות. אין רשת – עוצר ומנסה שוב אחרי 2/5/10/30/60 שניות, וגם מיד כשהרשת חוזרת.
       שגיאה קבועה (קלט, הרשאה, קופה מושבתת) – הפריט מסומן err והתור נעצר (המספור של הקופה חייב להישאר רציף); הנורית אדומה.
       seq-used / seq-gap – onConflict(q, item, err) (ב-pos-data: מספור מחדש מהמונה בשרת), ואז ניסיון נוסף.
     q.status() → { net: 'on'|'off'|'sync'|'err', pending, err, lastOk, seq }
     q.mark(reqId) → '✓' (נשמר בשרת) | '⏳' (ממתין) | '!' (שגיאה) | ''
     q.on(fn) → ביטול. fn(status) בכל שינוי.
     q.syncSeq(n) – המונה המקומי לא יורד מתחת למונה בשרת (posdev.lastSeq).
   PosOffline.cart({ store, key }) → { load() → [], save(lines), clear() } – הסל הפתוח נשמר בכל שינוי ונטען בפתיחה (גם אחרי סגירת האפליקציה).
   PosOffline.light(status) → HTML של הנורית (נקודה + מילה). PosOffline.paint(status) – מעדכן כל [data-pos-net] בדף.
   צבעים: רק משתני הערכה של האפליקציה (var(--ok/--warn/--bad/--mut) עם ברירת מחדל). */
(function (root) {
'use strict';
const BACK = [2000, 5000, 10000, 30000, 60000];
const KEEP_OK = 3 * 24 * 3600 * 1000; // פריט שנשלח נשאר 3 ימים (לסימן ✓ ולבדיקה), ואז נמחק מהתור
const NET_RE = /offline|network|failed to fetch|load failed|timeout|timed out|ECONN|ENOTFOUND|EAI_AGAIN|socket/i;
const RETRY_CODES = new Set(['unavailable', 'internal', 'deadline-exceeded', 'resource-exhausted', 'aborted', 'unauthenticated', 'UNAVAILABLE', 'INTERNAL', 'DEADLINE_EXCEEDED', 'RESOURCE_EXHAUSTED', 'ABORTED', 'UNAUTHENTICATED']);
// שגיאה זמנית (לנסות שוב אחר כך) או קבועה
function transient(e) {
  if (!e) return true;
  if (e.offline) return true;
  const st = +e.httpStatus || +e.statusCode || 0;
  if (st === 0 && !e.code && !e.status && !(e.details && e.details.reason)) return true; // שגיאת fetch בלי תשובה
  if (st >= 500 || st === 401 || st === 408 || st === 429) return true;
  if (RETRY_CODES.has(e.code) || RETRY_CODES.has(e.status)) return true;
  if (e.details && e.details.reason === 'internal') return true;
  return NET_RE.test(String(e.message || ''));
}
const reasonOf = (e) => (e && ((e.details && e.details.reason) || e.reason)) || '';

function queue(o) {
  if (!o || !o.store || typeof o.send !== 'function') throw new Error('PosOffline.queue: store ו-send חובה');
  const store = o.store, K = (o.key || 'lp-pos') + ':q';
  const now = o.now || (() => Date.now());
  const online = o.online || (() => true);
  const timer = o.timer || { set: (f, ms) => setTimeout(f, ms), clear: (t) => clearTimeout(t) };
  const subs = new Set();
  let S = load(), busy = null, tm = null, fails = 0, lastNet = null;

  function load() {
    try { const x = JSON.parse(store.get(K) || 'null'); if (x && Array.isArray(x.items)) return { items: x.items, seq: Number.isInteger(x.seq) ? x.seq : 0, lastOk: x.lastOk || 0 }; } catch (e) { /* פגום – מתחילים ריק, לא מוחקים את המקור */ try { store.set(K + ':bad' + now(), store.get(K)); } catch (e2) { /* */ } }
    return { items: [], seq: 0, lastOk: 0 };
  }
  function save() {
    const t = now();
    S.items = S.items.filter((it) => it.st !== 'ok' || t - (it.okAt || 0) < KEEP_OK);
    store.set(K, JSON.stringify(S));
  }
  const waiting = () => S.items.filter((it) => it.st !== 'ok');
  function status() {
    const w = waiting(), err = w.find((it) => it.st === 'err');
    const net = err ? 'err' : (lastNet === false || !online()) ? 'off' : w.length ? 'sync' : 'on';
    return { net, pending: w.length, err: err ? { reqId: err.reqId, msg: err.err, reason: err.reason } : null, lastOk: S.lastOk, seq: S.seq };
  }
  function emit() { const s = status(); for (const f of subs) { try { f(s); } catch (e) { /* */ } } }
  function later() {
    if (tm != null) return;
    const ms = BACK[Math.min(fails, BACK.length - 1)];
    tm = timer.set(() => { tm = null; flush(); }, ms);
  }

  function add(item, opt) {
    if (!item || typeof item.reqId !== 'string' || !item.reqId || !item.fn || !item.payload) throw new Error('PosOffline: פריט לא תקין');
    const ex = S.items.find((it) => it.reqId === item.reqId);
    if (ex) return ex; // אותו reqId פעמיים (לחיצה כפולה) – אותו פריט
    const it = { reqId: item.reqId, fn: item.fn, kind: item.kind || 'sale', payload: JSON.parse(JSON.stringify(item.payload)), st: 'wait', tries: 0, at: now() };
    if (opt && opt.seq) { S.seq += 1; it.payload.seq = S.seq; it.seq = S.seq; }
    S.items.push(it);
    save(); // נכתב לפני שחוזרים לקופה – מכירה שאושרה לא הולכת לאיבוד גם אם האפליקציה נסגרת עכשיו
    emit();
    Promise.resolve().then(flush);
    return JSON.parse(JSON.stringify(it));
  }

  async function run() {
    let sent = 0;
    for (;;) {
      const it = S.items.find((x) => x.st !== 'ok');
      if (!it) break;
      if (it.st === 'err') break; // שגיאה קבועה – עוצרים עד טיפול (retryErr)
      if (!online()) { lastNet = false; break; }
      it.tries += 1; it.last = now();
      let r;
      try { r = await o.send(it); } catch (e) {
        const rs = reasonOf(e);
        if ((rs === 'seq-used' || rs === 'seq-gap') && typeof o.onConflict === 'function' && (it.fix || 0) < 3) {
          it.fix = (it.fix || 0) + 1; save();
          try { await o.onConflict(api, it, e); continue; } catch (e2) { /* נופל לשגיאה */ }
        }
        if (transient(e)) {
          // אין תשובה מהשרת = אין רשת (נורית אפורה); השרת ענה בשגיאה זמנית = יש רשת, ממתינים (נורית כתומה)
          lastNet = !(e && (e.offline || NET_RE.test(String(e.message || ''))));
          fails += 1; save(); emit(); later();
          return { sent, left: waiting().length };
        }
        it.st = 'err'; it.err = String(e && e.message || 'שגיאה').slice(0, 200); it.reason = rs; save(); emit();
        break;
      }
      it.st = 'ok'; it.okAt = now(); it.res = r && typeof r === 'object' ? { id: r.id, seq: r.seq, gross: r.gross, dup: !!r.dup } : r;
      delete it.err; delete it.reason;
      S.lastOk = it.okAt; fails = 0; lastNet = true; sent += 1;
      save(); emit();
    }
    emit();
    return { sent, left: waiting().length };
  }
  // רק שליחה אחת בכל רגע (גם אם flush נקרא מכמה מקומות) – אחרת אותו פריט יישלח פעמיים במקביל
  function flush() {
    if (busy) return busy;
    if (tm != null) { timer.clear(tm); tm = null; }
    busy = run().finally(() => { busy = null; });
    return busy;
  }
  const api = {
    add, flush, status,
    on: (f) => { subs.add(f); return () => subs.delete(f); },
    mark: (reqId) => { const it = S.items.find((x) => x.reqId === reqId); return !it ? '' : it.st === 'ok' ? '✓' : it.st === 'err' ? '!' : '⏳'; },
    item: (reqId) => { const it = S.items.find((x) => x.reqId === reqId); return it ? JSON.parse(JSON.stringify(it)) : null; },
    items: () => JSON.parse(JSON.stringify(S.items)),
    pending: () => waiting().length,
    seq: () => S.seq,
    syncSeq: (n) => { if (Number.isInteger(n) && n > S.seq) { S.seq = n; save(); emit(); } return S.seq; },
    // מספור מחדש של כל מה שעוד לא נשלח, החל מ-from (אחרי התנגשות מספרים מול השרת). המספר הקודם נשמר ב-seq0
    renumber: (from) => {
      let n = from - 1;
      for (const it of S.items) if (it.st !== 'ok' && it.payload && it.payload.seq != null) { n += 1; if (it.seq0 == null) it.seq0 = it.seq; it.seq = n; it.payload.seq = n; }
      S.seq = Math.max(n, from - 1); save(); emit(); return S.seq;
    },
    // שגיאה קבועה שטופלה (למשל הקופה הופעלה מחדש) – ניסיון נוסף
    retryErr: () => { for (const it of S.items) if (it.st === 'err') it.st = 'wait'; save(); emit(); return flush(); },
    netChanged: (up) => { lastNet = up ? null : false; emit(); if (up) { fails = 0; flush(); } },
    _state: () => S,
  };
  return api;
}

function cart(o) {
  const K = (o && o.key || 'lp-pos') + ':cart', store = o && o.store;
  return {
    load: () => { try { const x = JSON.parse(store.get(K) || 'null'); return x && Array.isArray(x.lines) ? x.lines : []; } catch (e) { return []; } },
    save: (lines) => { try { if (!lines || !lines.length) store.del(K); else store.set(K, JSON.stringify({ lines, at: Date.now() })); } catch (e) { /* מקום מלא – הסל נשאר בזיכרון */ } },
    clear: () => { try { store.del(K); } catch (e) { /* */ } },
  };
}

const TXT = { on: 'מחובר', off: 'אין רשת', sync: 'שולח', err: 'בעיה בשליחה' };
const CLR = { on: 'var(--ok,#2e7d32)', off: 'var(--mut,#888)', sync: 'var(--warn,#c77700)', err: 'var(--bad,#c62828)' };
function light(s) {
  s = s || { net: 'on', pending: 0 };
  const n = s.pending > 0 && s.net !== 'on' ? ` (${s.pending})` : '';
  return `<span class="pos-net pos-net-${s.net}" role="status" aria-live="polite" title="${TXT[s.net]}${n}"><i style="display:inline-block;width:.6em;height:.6em;border-radius:50%;background:${CLR[s.net]};margin-inline-end:.3em;vertical-align:middle"></i>${TXT[s.net]}${n}</span>`;
}
function paint(s) {
  if (typeof document === 'undefined') return;
  const h = light(s);
  document.querySelectorAll('[data-pos-net]').forEach((el) => { if (el.innerHTML !== h) el.innerHTML = h; });
}
// אחסון בדפדפן (localStorage) – כתיבה סינכרונית. מקום מלא – שגיאה עולה למעלה (המכירה לא "נשמרה" בשקט)
const lsStore = {
  get: (k) => { try { return root && root.localStorage ? root.localStorage.getItem(k) : null; } catch (e) { return null; } },
  set: (k, v) => { root.localStorage.setItem(k, v); },
  del: (k) => { try { root.localStorage.removeItem(k); } catch (e) { /* */ } },
};
// זיכרון בלבד (בדיקות)
function memStore() { const m = new Map(); return { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => { m.set(k, String(v)); }, del: (k) => { m.delete(k); }, _m: m }; }

const api = { queue, cart, light, paint, transient, lsStore, memStore, TXT };
if (typeof module === 'object' && module.exports) module.exports = api;
if (root) root.PosOffline = api;
})(typeof window !== 'undefined' ? window : null);
/* /POS:M3 */
