'use strict';
// שרת דמה מקומי שמחליף את Google (OAuth, Gmail API, Calendar API) בבדיקות המזכירה – שלב 6 (127.0.0.1:9794). אין שום פנייה ל-Google.
// הפונקציות פונות אליו כי GOOGLE_API_BASE=http://127.0.0.1:9794 (functions/.env.demo-largpeami, ובבדיקות שבתוך התהליך – process.env).
// מבנה הנתיבים והתשובות לפי התיעוד הציבורי של Google – (לא מאומת מול השירות האמיתי).
//   OAuth:   POST /token (authorization_code עם PKCE, refresh_token), POST /revoke
//   Gmail:   /gmail/v1/users/me/{profile,watch,stop,history,messages,messages/{id},messages/send,messages/{id}/trash}
//   יומן:    /calendar/v3/calendars/primary[/events[/{id}]]
// רושם כל בקשה. מחיקה לצמיתות של מייל (DELETE / batchDelete) נרשמת ב-state.deleted – הבדיקות מוודאות שהיא לא קרתה אף פעם.
const http = require('node:http');
const crypto = require('node:crypto');

const PORT = 9794;
let state;
function reset() {
  state = { requests: [], codes: {}, rts: {}, ats: {}, revoked: [], boxes: {}, cals: {}, sent: [], trashed: [], deleted: [], n: 0, clock: Date.now(), mode: {} };
}
reset();
const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const tick = () => { state.clock = Math.max(Date.now(), state.clock + 1); return state.clock; };

// ---------- עזרי בדיקה ----------
// קוד הרשאה שהדמה "תחזיר" אחרי ההסכמה. challenge – מה-URL שהשרת יצר (PKCE). scope – מה ש"המשתמש אישר"
function code(o) {
  const c = 'code_' + (++state.n) + '_' + crypto.randomBytes(4).toString('hex');
  state.codes[c] = { challenge: o.challenge, scope: o.scope, email: o.email, noRefresh: !!o.noRefresh };
  return c;
}
function box(email) {
  if (!state.boxes[email]) state.boxes[email] = { hist: 1000, msgs: {}, history: [] };
  return state.boxes[email];
}
// מייל חדש בתיבה (כמו שהגיע מבחוץ). o: { from, subject, text, html, labels, size, date, unsub, files }
function addMail(email, o) {
  const b = box(email);
  const id = 'm' + (++state.n).toString(16).padStart(6, '0');
  const headers = [{ name: 'From', value: o.from || 'Someone <someone@example.invalid>' }, { name: 'Subject', value: o.subject || '' }, { name: 'Message-ID', value: '<' + id + '@mail.example.invalid>' }];
  if (o.unsub) headers.push({ name: 'List-Unsubscribe', value: '<mailto:u@example.invalid>' });
  if (o.replyTo) headers.push({ name: 'Reply-To', value: o.replyTo });
  const parts = [];
  if (o.text != null) parts.push({ mimeType: 'text/plain', body: { data: b64u(Buffer.from(o.text, 'utf8')) } });
  if (o.html != null) parts.push({ mimeType: 'text/html', body: { data: b64u(Buffer.from(o.html, 'utf8')) } });
  for (const f of o.files || []) parts.push({ mimeType: 'application/pdf', filename: f, body: { attachmentId: 'a' + id } });
  const labels = o.labels || ['INBOX', 'UNREAD'];
  b.msgs[id] = { id, threadId: 't' + id, labelIds: labels, snippet: String(o.text || '').slice(0, 100), sizeEstimate: o.size || 2000, internalDate: String(o.date || Date.now()), payload: { mimeType: 'multipart/alternative', headers, parts } };
  b.hist++;
  b.history.push({ id: String(b.hist), messagesAdded: [{ message: { id, threadId: 't' + id, labelIds: labels } }] });
  return id;
}
// התראת Pub/Sub כמו ש-Gmail שולחת (base64 של JSON)
const note = (email) => Buffer.from(JSON.stringify({ emailAddress: email, historyId: box(email).hist })).toString('base64');
function cal(email) { if (!state.cals[email]) state.cals[email] = { seq: 0, ev: {} }; return state.cals[email]; }
function calSet(email, id, ev) {
  const c = cal(email);
  c.seq++;
  c.ev[id] = Object.assign({ id, status: 'confirmed' }, c.ev[id] || {}, ev, { updated: new Date(tick()).toISOString(), _seq: c.seq });
  return c.ev[id];
}
// אירוע שנוצר / שונה / בוטל ישירות ב-Google (כמו שהמנהל עשה בטלפון)
const calAdd = (email, ev) => calSet(email, 'gev' + (++state.n), ev).id;
const calEdit = (email, id, patch) => calSet(email, id, patch);
const calCancel = (email, id) => calSet(email, id, { status: 'cancelled' });

// ---------- השרת ----------
function who(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  const a = m && state.ats[m[1]];
  return a && !state.revoked.includes(a.rt) ? a : null;
}
function qmatch(m, q, now) {
  for (const t of String(q || '').split(/\s+/).filter(Boolean)) {
    const neg = t.startsWith('-'), x = neg ? t.slice(1) : t;
    let ok = true;
    if (x === 'in:trash') ok = m.labelIds.includes('TRASH');
    else if (x === 'in:spam') ok = m.labelIds.includes('SPAM');
    else if (x === 'category:promotions') ok = m.labelIds.includes('CATEGORY_PROMOTIONS');
    else if (/^larger:(\d+)M$/.test(x)) ok = m.sizeEstimate >= Number(/^larger:(\d+)M$/.exec(x)[1]) * 1048576;
    else if (/^older_than:(\d+)y$/.test(x)) ok = Number(m.internalDate) < now - Number(/^older_than:(\d+)y$/.exec(x)[1]) * 365 * 864e5;
    else if (/^after:(\d{4})\/(\d{2})\/(\d{2})$/.test(x)) { const [, y, mo, d] = /^after:(\d{4})\/(\d{2})\/(\d{2})$/.exec(x); ok = Number(m.internalDate) >= Date.UTC(+y, +mo - 1, +d); }
    if (neg ? ok : !ok) return false;
  }
  return true;
}
function handle(req, res, raw) {
  const url = new URL(req.url, 'http://x');
  const path = url.pathname, q = url.searchParams;
  let body = null;
  const ct = String(req.headers['content-type'] || '');
  if (ct.includes('application/x-www-form-urlencoded')) body = Object.fromEntries(new URLSearchParams(raw));
  else { try { body = raw ? JSON.parse(raw) : null; } catch (e) { body = raw; } }
  state.requests.push({ method: req.method, path, query: Object.fromEntries(q), auth: req.headers.authorization || '', body, at: Date.now() });
  const json = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (state.mode[path] === 'fail') return json(500, { error: { message: 'mock failure', echo: req.headers.authorization } });
  // ----- OAuth -----
  if (req.method === 'POST' && path === '/token') {
    if (body.grant_type === 'authorization_code') {
      const c = state.codes[body.code];
      delete state.codes[body.code];
      const pk = c && b64u(crypto.createHash('sha256').update(String(body.code_verifier || '')).digest());
      if (!c || pk !== c.challenge || !body.client_secret) return json(400, { error: 'invalid_grant' });
      const rt = c.noRefresh ? '' : 'rt_' + crypto.randomBytes(8).toString('hex');
      const at = 'at_' + crypto.randomBytes(8).toString('hex');
      if (rt) state.rts[rt] = { email: c.email, scope: c.scope };
      state.ats[at] = { email: c.email, scope: c.scope, rt: rt || at };
      return json(200, Object.assign({ access_token: at, expires_in: 3599, scope: c.scope, token_type: 'Bearer' }, rt ? { refresh_token: rt } : {}));
    }
    if (body.grant_type === 'refresh_token') {
      const r = state.rts[body.refresh_token];
      if (!r || state.revoked.includes(body.refresh_token) || state.mode.expired) return json(400, { error: 'invalid_grant' });
      const at = 'at_' + crypto.randomBytes(8).toString('hex');
      state.ats[at] = { email: r.email, scope: r.scope, rt: body.refresh_token };
      return json(200, { access_token: at, expires_in: 3599, scope: r.scope, token_type: 'Bearer' });
    }
    return json(400, { error: 'unsupported_grant_type' });
  }
  if (req.method === 'POST' && path === '/revoke') {
    const t = body && body.token;
    const a = state.ats[t];
    state.revoked.push(a ? a.rt : t);
    return json(200, {});
  }
  // ----- Gmail -----
  let m = /^\/gmail\/v1\/users\/me\/(.*)$/.exec(path);
  if (m) {
    const a = who(req);
    if (!a) return json(401, { error: { code: 401 } });
    const has = (s) => a.scope.split(' ').includes('https://www.googleapis.com/auth/gmail.' + s);
    const b = box(a.email), rest = m[1];
    if (req.method === 'GET' && rest === 'profile') return json(200, { emailAddress: a.email, historyId: String(b.hist), messagesTotal: Object.keys(b.msgs).length });
    if (req.method === 'POST' && rest === 'watch') return json(200, { historyId: String(b.hist), expiration: String(Date.now() + 7 * 864e5) });
    if (req.method === 'POST' && rest === 'stop') return json(204, {});
    if (req.method === 'GET' && rest === 'history') {
      const start = Number(q.get('startHistoryId'));
      if (start < 500) return json(404, { error: { code: 404 } });
      return json(200, { history: b.history.filter((h) => Number(h.id) > start), historyId: String(b.hist) });
    }
    if (req.method === 'GET' && rest === 'messages') {
      const all = Object.values(b.msgs).filter((x) => qmatch(x, q.get('q'), Date.now()) && (q.get('includeSpamTrash') === 'true' || !x.labelIds.some((l) => l === 'SPAM' || l === 'TRASH')));
      const max = Number(q.get('maxResults')) || 100, off = Number(q.get('pageToken') || 0);
      const page = all.slice(off, off + max);
      return json(200, Object.assign({ messages: page.map((x) => ({ id: x.id, threadId: x.threadId })), resultSizeEstimate: all.length }, off + max < all.length ? { nextPageToken: String(off + max) } : {}));
    }
    if (req.method === 'POST' && rest === 'messages/send') {
      if (!has('send') && !has('modify')) return json(403, { error: { code: 403 } });
      const id = 'sent' + (++state.n);
      state.sent.push({ email: a.email, raw: Buffer.from(String(body.raw || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'), threadId: body.threadId || '', id });
      return json(200, { id, threadId: body.threadId || 't' + id, labelIds: ['SENT'] });
    }
    if (rest === 'messages/batchDelete' || (req.method === 'DELETE' && /^messages\//.test(rest))) { state.deleted.push({ email: a.email, rest }); return json(204, {}); }
    let mm = /^messages\/([A-Za-z0-9_-]+)\/trash$/.exec(rest);
    if (req.method === 'POST' && mm) {
      if (!has('modify')) return json(403, { error: { code: 403 } });
      const x = b.msgs[mm[1]];
      if (!x) return json(404, { error: { code: 404 } });
      x.labelIds = x.labelIds.filter((l) => l !== 'INBOX').concat(['TRASH']);
      state.trashed.push({ email: a.email, id: mm[1] });
      return json(200, { id: x.id, labelIds: x.labelIds });
    }
    mm = /^messages\/([A-Za-z0-9_-]+)$/.exec(rest);
    if (req.method === 'GET' && mm) {
      const x = b.msgs[mm[1]];
      if (!x) return json(404, { error: { code: 404 } });
      if (q.get('format') === 'metadata') return json(200, Object.assign({}, x, { payload: { mimeType: x.payload.mimeType, headers: x.payload.headers } }));
      return json(200, x);
    }
    return json(404, { error: { code: 404 } });
  }
  // ----- Calendar -----
  m = /^\/calendar\/v3\/calendars\/primary(\/events)?(?:\/([A-Za-z0-9_-]+))?$/.exec(path);
  if (m) {
    const a = who(req);
    if (!a) return json(401, { error: { code: 401 } });
    if (!a.scope.split(' ').includes('https://www.googleapis.com/auth/calendar.events')) return json(403, { error: { code: 403 } });
    const c = cal(a.email);
    if (!m[1]) return json(200, { id: a.email, timeZone: 'Asia/Jerusalem' });
    const clean = (e) => { const o = Object.assign({}, e); delete o._seq; return o; };
    if (req.method === 'GET' && !m[2]) {
      const st = q.get('syncToken');
      let items;
      if (st) {
        const s = /^st_(\d+)$/.exec(st);
        if (!s || Number(s[1]) > c.seq) return json(410, { error: { code: 410 } });
        items = Object.values(c.ev).filter((e) => e._seq > Number(s[1]));
      } else items = Object.values(c.ev).filter((e) => e.status !== 'cancelled');
      return json(200, { items: items.map(clean), nextSyncToken: 'st_' + c.seq });
    }
    if (req.method === 'POST' && !m[2]) return json(200, clean(calSet(a.email, 'app' + (++state.n), body)));
    const ev = m[2] && c.ev[m[2]];
    if (!ev) return json(404, { error: { code: 404 } });
    if (req.method === 'PATCH') { if (ev.status === 'cancelled') return json(410, { error: { code: 410 } }); return json(200, clean(calSet(a.email, m[2], body))); }
    if (req.method === 'DELETE') { calSet(a.email, m[2], { status: 'cancelled' }); return json(204, {}); }
    return json(404, { error: { code: 404 } });
  }
  return json(404, { error: { message: 'not found' } });
}

let server = null;
function start() {
  if (server) return Promise.resolve();
  server = http.createServer((req, res) => { let raw = ''; req.on('data', (c) => { raw += c; }); req.on('end', () => handle(req, res, raw)); });
  return new Promise((ok, no) => { server.once('error', no); server.listen(PORT, '127.0.0.1', ok); });
}
function stop() { if (!server) return Promise.resolve(); const s = server; server = null; return new Promise((ok) => s.close(ok)); }

module.exports = { start, stop, reset, get state() { return state; }, code, addMail, note, box, cal, calAdd, calEdit, calCancel, PORT };
