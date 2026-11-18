// תוסף כספית – לקוח קטן לנקודת הקצה cxBot בשרת (חוזה: caspit-extension/README.md).
// POST JSON { op, ...data, ver } עם Authorization: Bearer <token>. רק הפעולות המותרות לרובוט.
// תשובה: { ok:true, ... } או { ok:false, reason, msg }. סיווג שגיאות: network/timeout/server/rate – ניסיון חוזר; השאר – לא.
(function (root) {
'use strict';
const OPS = ['hello', 'cfg', 'upload', 'preview', 'apply', 'export', 'report', 'importResult', 'poll'];
const TOKEN_RE = /^[A-Za-z0-9_-]{4,64}\.[A-Za-z0-9_-]{40,48}$/;
const SLOW = new Set(['upload', 'apply', 'preview']);
function mk(code, msg, extra) { const e = new Error(msg || code); e.code = code; if (extra) Object.assign(e, extra); return e; }
function client(o) {
  const url = o.url, token = o.token, ver = o.ver, f = o.fetch || ((...a) => root.fetch(...a));
  async function call(op, data, opt) {
    if (!OPS.includes(op)) throw mk('bad-op', 'פעולה לא מותרת');
    if (!TOKEN_RE.test(String(token || ''))) throw mk('auth', 'אין חיבור לאפליקציה');
    if (!/^https:\/\/|^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(String(url || ''))) throw mk('auth', 'כתובת שרת לא תקינה');
    const ms = (opt && opt.timeout) || (SLOW.has(op) ? 300e3 : 60e3);
    const ac = new AbortController();
    const tm = setTimeout(() => ac.abort(), ms);
    let res, body;
    try {
      res = await f(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(Object.assign({}, data || {}, { op, ver })), signal: ac.signal, credentials: 'omit', cache: 'no-store' });
      body = await res.json().catch(() => null);
    } catch (e) {
      throw mk(e && e.name === 'AbortError' ? 'timeout' : 'network', e && e.name === 'AbortError' ? 'השרת לא ענה בזמן' : 'אין חיבור לשרת');
    } finally { clearTimeout(tm); }
    const reason = body && typeof body.reason === 'string' ? body.reason : null;
    const msg = body && typeof body.msg === 'string' ? body.msg.slice(0, 300) : '';
    if (res.status === 401 || res.status === 403) throw mk('auth', msg || 'החיבור לאפליקציה לא תקין', { status: res.status, reason });
    if (res.status === 429) throw mk('rate', msg || 'יותר מדי פניות', { status: res.status });
    if (res.status >= 500) throw mk('server', msg || 'תקלה בשרת', { status: res.status });
    if (!res.ok || !body || body.ok === false) throw mk(reason || 'fail', msg || 'השרת סירב', { status: res.status, reason });
    return body;
  }
  return { call };
}
const api = { OPS, TOKEN_RE, client };
if (typeof module === 'object' && module.exports) module.exports = api; else root.CxApi = api;
})(typeof self !== 'undefined' ? self : this);
