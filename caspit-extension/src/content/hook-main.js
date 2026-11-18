// תוסף כספית – רץ בתוך הדף של כספית (MAIN world, מיד בטעינה). בלי הרשאת downloads:
// כשהתוסף "דורך" (arm עם nonce), קובץ שכספית מורידה (blob / קישור הורדה / תשובת fetch או XHR עם קובץ) נתפס,
// לא נשמר בתיקיית ההורדות, ונשלח ל-bridge.js עם ה-nonce. כשלא דרוך – הדף עובד רגיל לגמרי.
// מצב היכרות (discover): רושם מבנה של בקשות רשת בלבד – שיטה, נתיב עם מצייני מקום, סטטוס, סוג תוכן, גודל, מפתחות JSON (בלי ערכים),
// ושמות כותרות הבקשה (בלי ערכים). כותרת הרשאה של הדף נשמרת רק בזיכרון של הדף, לקריאה לנקודות קצה של כספית מתוך הדף (call) – לא יוצאת החוצה.
(() => {
  'use strict';
  if (window.__cxHook) return;
  const MAX_FILE = 30 * 1024 * 1024, LOG_MAX = 300;
  let armed = null, disc = false, sent = 0;
  const log = [], blobs = new Map(), auth = new Map();
  const FILE_CT = /spreadsheet|excel|ms-excel|csv|octet-stream|vnd\.openxmlformats/i;
  const AUTH_H = /^(authorization|x-[\w-]*token[\w-]*|x-csrf-token|x-xsrf-token)$/i;
  const origin = location.origin;

  const tmplPath = (u) => {
    try {
      const x = new URL(u, location.href);
      const p = x.pathname.split('/').map((s) => (/^\d+$/.test(s) ? '{n}' : /^\d{4}-\d{2}-\d{2}/.test(s) ? '{date}' : /^[0-9a-f-]{16,}$/i.test(s) ? '{id}' : s.length > 40 ? '{s}' : s)).join('/');
      const q = [...x.searchParams.keys()].slice(0, 30).map((k) => {
        const v = x.searchParams.get(k) || '';
        const t = v === '' ? 'empty' : /^\d+$/.test(v) ? 'n' : /^\d{4}-\d{2}-\d{2}|^\d{1,2}[/.]\d{1,2}[/.]\d{2,4}/.test(v) ? 'date' : /^(true|false)$/i.test(v) ? 'bool' : 's';
        return k.slice(0, 40) + '={' + t + '}';
      });
      return { o: x.origin === origin ? 'same' : 'other', p, q };
    } catch (e) { return { o: '?', p: '?', q: [] }; }
  };
  const shape = (v, d) => {
    if (d > 3) return '…';
    if (Array.isArray(v)) return v.length ? [shape(v[0], d + 1)] : [];
    if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v).slice(0, 40)) o[k.slice(0, 40)] = shape(v[k], d + 1); return o; }
    return v === null ? 'null' : typeof v;
  };
  const rec = (e) => { if (!disc) return; log.push(e); if (log.length > LOG_MAX) log.shift(); };
  const fileName = (cd, url) => {
    const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd || '');
    if (m) { try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; } }
    try { return decodeURIComponent(new URL(url, location.href).pathname.split('/').pop() || 'file'); } catch (e) { return 'file'; }
  };
  const b64 = (buf) => {
    const u = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  };
  async function send(blobOrBuf, name, mime, via) {
    const n = armed;
    if (!n) return false;
    const buf = blobOrBuf instanceof Blob ? await blobOrBuf.arrayBuffer() : blobOrBuf;
    if (!buf || buf.byteLength > MAX_FILE) return false;
    sent++;
    window.postMessage({ __cx: 'hook', nonce: n, kind: 'file', name: String(name || 'file').slice(0, 120), mime: String(mime || '').slice(0, 100), size: buf.byteLength, via, b64: b64(buf) }, origin);
    return true;
  }

  // 1) blob URLs – זוכרים את ה-Blob כדי שנוכל לקרוא אותו כשהדף "מוריד" אותו
  const oCreate = URL.createObjectURL;
  URL.createObjectURL = function (o) {
    const u = oCreate.apply(this, arguments);
    if (o instanceof Blob) { blobs.set(u, o); if (blobs.size > 20) blobs.delete(blobs.keys().next().value); }
    return u;
  };
  async function grab(a) {
    const href = a.href || '';
    const name = a.getAttribute('download') || fileName('', href);
    if (href.startsWith('blob:')) { const b = blobs.get(href); if (b) return send(b, name, b.type, 'blob'); return false; }
    if (href.startsWith('data:')) { const r = await fetch(href); return send(await r.arrayBuffer(), name, r.headers.get('content-type'), 'data'); }
    if (new URL(href, location.href).origin === origin) { const r = await oFetch(href, { credentials: 'include' }); return send(await r.arrayBuffer(), fileName(r.headers.get('content-disposition'), href) || name, r.headers.get('content-type'), 'link'); }
    return false;
  }
  const isDl = (a) => a && a.tagName === 'A' && (a.hasAttribute('download') || /^blob:|^data:/.test(a.href || ''));
  // 2) קישור הורדה – גם a.click() וגם לחיצה שנשלחת כאירוע
  const oClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (armed && isDl(this)) { grab(this); return; }
    return oClick.apply(this, arguments);
  };
  window.addEventListener('click', (e) => {
    if (!armed) return;
    const a = e.target && e.target.closest ? e.target.closest('a') : null;
    if (isDl(a)) { e.preventDefault(); e.stopImmediatePropagation(); grab(a); }
  }, true);
  // 3) window.open של קובץ
  const oOpen = window.open;
  window.open = function (u) {
    if (armed && typeof u === 'string' && /^blob:/.test(u) && blobs.has(u)) { send(blobs.get(u), 'file', blobs.get(u).type, 'open'); return null; }
    return oOpen.apply(this, arguments);
  };
  // 4) fetch
  const oFetch = window.fetch;
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : input && input.url;
    const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    const hn = [];
    try {
      const h = new Headers((init && init.headers) || (input && input.headers) || {});
      h.forEach((v, k) => { hn.push(k); if (AUTH_H.test(k) && new URL(url, location.href).origin === origin) auth.set(k, v); });
    } catch (e) { /* כותרות לא תקינות – הדף יקבל את אותה שגיאה */ }
    const t0 = Date.now();
    const res = await oFetch.apply(this, arguments);
    try { inspect(res.clone(), url, method, hn, t0, 'fetch'); } catch (e) { /* לא מפריעים לדף */ }
    return res;
  };
  async function inspect(res, url, method, hn, t0, via) {
    const ct = res.headers.get('content-type') || '', cd = res.headers.get('content-disposition') || '';
    const isFile = /attachment/i.test(cd) || FILE_CT.test(ct);
    let sz = +res.headers.get('content-length') || null, keys;
    if (armed && isFile && res.ok) { const buf = await res.arrayBuffer(); sz = buf.byteLength; await send(buf, fileName(cd, url), ct, via); }
    else if (disc && /json/i.test(ct)) { try { const j = await res.json(); keys = shape(j, 0); } catch (e) { /* לא JSON */ } }
    rec(Object.assign({ m: method, st: res.status, ct: ct.split(';')[0].slice(0, 60), sz, ms: Date.now() - t0, file: isFile || undefined, rh: hn.slice(0, 20), keys, via }, tmplPath(url)));
  }
  // 5) XHR
  const X = XMLHttpRequest.prototype, oOpenX = X.open, oSend = X.send, oSet = X.setRequestHeader;
  X.open = function (m, u) { this.__cx = { m: String(m || 'GET').toUpperCase(), u: String(u), hn: [] }; return oOpenX.apply(this, arguments); };
  X.setRequestHeader = function (k, v) {
    if (this.__cx) { this.__cx.hn.push(String(k).toLowerCase()); try { if (AUTH_H.test(k) && new URL(this.__cx.u, location.href).origin === origin) auth.set(String(k).toLowerCase(), v); } catch (e) { /* */ } }
    return oSet.apply(this, arguments);
  };
  X.send = function () {
    const x = this, c = x.__cx, t0 = Date.now();
    if (c) x.addEventListener('loadend', () => {
      try {
        const ct = x.getResponseHeader('content-type') || '', cd = x.getResponseHeader('content-disposition') || '';
        const isFile = /attachment/i.test(cd) || FILE_CT.test(ct);
        let keys, sz = null;
        if (armed && isFile && x.status >= 200 && x.status < 300) {
          const r = x.response;
          if (r instanceof Blob || r instanceof ArrayBuffer) { sz = r.byteLength || r.size; send(r, fileName(cd, c.u), ct, 'xhr'); }
          else if (typeof r === 'string') { const b = new TextEncoder().encode(r); sz = b.byteLength; send(b.buffer, fileName(cd, c.u), ct, 'xhr'); }
        } else if (disc && /json/i.test(ct)) {
          try { keys = shape(x.responseType === 'json' ? x.response : JSON.parse(x.responseText), 0); } catch (e) { /* */ }
        }
        rec(Object.assign({ m: c.m, st: x.status, ct: ct.split(';')[0].slice(0, 60), sz, ms: Date.now() - t0, file: isFile || undefined, rh: c.hn.slice(0, 20), keys, via: 'xhr' }, tmplPath(c.u)));
      } catch (e) { /* */ }
    });
    return oSend.apply(this, arguments);
  };
  // נקודת קצה של כספית מתוך הדף (selectors.json → endpoints). רק אותו מקור, רק GET/POST, עם כותרת ההרשאה שהדף עצמו שלח
  async function call(ep, vars) {
    const fill = (s) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? encodeURIComponent(vars[k]) : m));
    const u = new URL(fill(ep.pathTemplate), location.href);
    if (u.origin !== origin) return { st: 0, err: 'origin' };
    for (const [k, v] of Object.entries(ep.params || {})) u.searchParams.set(k, fill(v));
    const m = ep.method === 'POST' ? 'POST' : 'GET';
    const h = new Headers(); auth.forEach((v, k) => h.set(k, v));
    if (m === 'POST') h.set('Content-Type', 'application/json');
    const r = await oFetch(u.href, { method: m, credentials: 'include', headers: h, body: m === 'POST' ? JSON.stringify(JSON.parse(fill(JSON.stringify(ep.body || {})))) : undefined });
    const ct = r.headers.get('content-type') || '';
    if (!r.ok) return { st: r.status, ct };
    const buf = await r.arrayBuffer();
    if (buf.byteLength > MAX_FILE) return { st: r.status, err: 'size' };
    return { st: r.status, ct, name: fileName(r.headers.get('content-disposition'), u.href), b64: b64(buf) };
  }
  const api = Object.freeze({
    arm(n) { armed = typeof n === 'string' && n.length >= 16 ? n : null; sent = 0; return !!armed; },
    disarm() { armed = null; },
    discover(on) { disc = !!on; if (!disc) log.length = 0; return disc; },
    netLog() { return log.slice(); },
    sent() { return sent; },
    call,
  });
  Object.defineProperty(window, '__cxHook', { value: api, writable: false, configurable: false, enumerable: false });
})();
