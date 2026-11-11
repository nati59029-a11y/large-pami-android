'use strict';
// שרת דמה מקומי שמחליף את ה-Graph API של Meta (ווצאפ) בבדיקות (127.0.0.1:9795). אין שום פנייה ל-Meta.
// הפונקציות באמולטור פונות אליו, כי functions/.env.demo-largpeami מגדיר WA_GRAPH_BASE=http://127.0.0.1:9795.
// רושם כל בקשה (נתיב, כותרת Authorization, גוף). שליחה: POST /<ver>/<pnid>/messages. קובץ: GET /<ver>/<mediaId> ואז GET /file/<mediaId>.
const http = require('node:http');

const PORT = 9795;
const state = { requests: [], mode: 'ok', n: 0, files: {} };
function reset() { state.requests = []; state.mode = 'ok'; state.n = 0; state.files = {}; }
const sends = () => state.requests.filter((r) => r.method === 'POST' && /\/messages$/.test(r.path));

let server = null;
function start() {
  if (server) return Promise.resolve();
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = null; try { body = raw ? JSON.parse(raw) : null; } catch (e) { body = raw; }
      const path = req.url.split('?')[0];
      state.requests.push({ method: req.method, path, auth: req.headers.authorization || '', body, at: Date.now() });
      const json = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.method === 'POST' && /^\/v\d+\.\d+\/\d+\/messages$/.test(path)) {
        if (state.mode === 'fail') return json(500, { error: { message: 'mock failure', token: req.headers.authorization } });
        state.n++;
        return json(200, { messaging_product: 'whatsapp', contacts: [{ wa_id: body && body.to }], messages: [{ id: 'wamid.OUT' + state.n }] });
      }
      let m = /^\/v\d+\.\d+\/([A-Za-z0-9_-]+)$/.exec(path);
      if (req.method === 'GET' && m && state.files[m[1]]) {
        const f = state.files[m[1]];
        return json(200, { url: f.url || `http://127.0.0.1:${PORT}/file/${m[1]}`, mime_type: f.mime || 'audio/ogg; codecs=opus', file_size: f.size || f.data.length, id: m[1] });
      }
      m = /^\/file\/([A-Za-z0-9_-]+)$/.exec(path);
      if (req.method === 'GET' && m && state.files[m[1]]) { res.writeHead(200, { 'Content-Type': 'audio/ogg' }); return res.end(state.files[m[1]].data); }
      return json(404, { error: { message: 'not found' } });
    });
  });
  return new Promise((ok, no) => { server.once('error', no); server.listen(PORT, '127.0.0.1', ok); });
}
function stop() { if (!server) return Promise.resolve(); const s = server; server = null; return new Promise((ok) => s.close(ok)); }

module.exports = { start, stop, reset, state, sends, PORT };
