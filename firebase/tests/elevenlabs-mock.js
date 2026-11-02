'use strict';
// שרת דמה מקומי שמחליף את ElevenLabs בבדיקות. אין שום פנייה החוצה.
// רושם כל בקשה (נתיב, שאילתה, כותרת xi-api-key, גוף), ומחזיר "שמע" מזויף: כותרת ID3 + hash של הטקסט (כדי לזהות מה נשלח).
// mode: 'ok' | 'network' (ניתוק החיבור) | 'http401' | 'http429' | 'http500' | 'hang' (לא עונה) | 'json' (תשובה לא שמע) | 'leak' (401 עם המפתח בגוף)

const http = require('node:http');
const crypto = require('node:crypto');

const state = { requests: [], mode: 'ok' };
function reset() { state.requests = []; state.mode = 'ok'; }
function setMode(m) { state.mode = m; }
// השמע המזויף לטקסט מסוים (לבדיקה שמה שעלה לימות הוא בדיוק מה שהשירות החזיר)
function fakeAudio(text) { return Buffer.concat([Buffer.from('ID3\x04\x00\x00\x00\x00\x00\x00', 'latin1'), crypto.createHash('sha256').update(String(text)).digest(), Buffer.alloc(200, 7)]); }

let server = null;
function start(port) {
  if (server) return Promise.resolve();
  server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (e) { /* */ }
      const u = new URL(req.url, 'http://x');
      state.requests.push({ method: req.method, path: u.pathname, query: Object.fromEntries(u.searchParams), key: req.headers['xi-api-key'] || '', accept: req.headers.accept || '', body, at: Date.now() });
      const m = state.mode;
      if (m === 'hang') return;
      if (m === 'network') { req.socket.destroy(); return; }
      const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (m === 'http401') return json(401, { detail: { status: 'invalid_api_key', message: 'Invalid API key' } });
      if (m === 'leak') return json(401, { detail: { status: 'invalid_api_key', message: 'key ' + (req.headers['xi-api-key'] || '') + ' is invalid' } });
      if (m === 'http429') return json(429, { detail: { status: 'too_many_concurrent_requests' } });
      if (m === 'http500') return json(500, { detail: 'error' });
      if (m === 'json') return json(200, { ok: true });
      if (req.method !== 'POST' || !/^\/v1\/text-to-speech\/[^/]+$/.test(u.pathname)) return json(404, { detail: 'not found' });
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
      res.end(fakeAudio(body.text));
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
}
function stop() { return new Promise((r) => { if (!server) return r(); server.close(() => { server = null; r(); }); server.closeAllConnections && server.closeAllConnections(); }); }

module.exports = { start, stop, reset, setMode, state, fakeAudio };
