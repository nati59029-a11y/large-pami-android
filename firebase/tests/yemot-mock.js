'use strict';
// שרת דמה מקומי שמחליף את ה-API של ימות המשיח בבדיקות. אין שום פנייה החוצה.
// הפונקציות באמולטור פונות אליו לפי YEMOT_API_BASE (functions/.env.demo-largpeami, או functions/.env.local אם קיים).
// השרת רושם כל בקשה (פקודה, כותרת authorization, גוף), ומחזיק "שלוחה" בזיכרון: שם קובץ → תוכן.

const http = require('node:http');

const state = { requests: [], files: new Map(), modes: {} };
function reset(files) {
  state.requests = [];
  state.modes = { dir: 'ok', upload: 'ok', tzintuk: 'ok', delete: 'ok' };
  state.files = new Map(Object.entries(files || { '000.tts': 'פתיח' }));
}
reset();
// mode: 'ok' | 'error' (ERROR + הודעה שמכילה את המפתח שהתקבל – כדי לבדוק שהוא לא דולף) | 'exception' | 'http500' | 'hang'
function setMode(cmd, mode) { state.modes[cmd] = mode; }
const calls = (cmd) => state.requests.filter((r) => r.cmd === cmd);

function reply(res, code, obj) { if (res.writableEnded) return; res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }
const OK = (extra) => Object.assign({ yemotAPIVersion: 7, responseStatus: 'OK' }, extra || {});

let server = null;
function start(port) {
  if (server) return Promise.resolve();
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const m = /^\/ym\/api\/([A-Za-z0-9]+)$/.exec(req.url.split('?')[0]);
      let body = {}; try { body = JSON.parse(raw || '{}'); } catch (e) { /* */ }
      const cmd = m ? m[1] : '?';
      const auth = req.headers.authorization || '';
      state.requests.push({ cmd, auth, url: req.url, body, at: Date.now() });
      const key = { GetIVR2Dir: 'dir', UploadTextFile: 'upload', RunTzintuk: 'tzintuk', FileAction: 'delete' }[cmd];
      if (!key) return reply(res, 404, { responseStatus: 'ERROR', message: 'unknown command' });
      const mode = state.modes[key];
      if (mode === 'hang') return; // לא עונה אף פעם (לבדיקת פסק זמן)
      if (mode === 'http500') return reply(res, 500, { responseStatus: 'EXCEPTION' });
      if (mode === 'exception') return reply(res, 200, { responseStatus: 'EXCEPTION', exceptionClass: 'IllegalArgumentException', exceptionMessage: 'bad token ' + auth });
      if (mode === 'error') return reply(res, 200, { yemotAPIVersion: 7, responseStatus: 'ERROR', message: 'token ' + auth + ' is incorrect', messageCode: 1 });
      if (cmd === 'GetIVR2Dir') {
        const files = [...state.files.keys()].sort().map((name) => ({ exists: true, name, what: `ivr2:${body.path}/${name}`, fileType: 'tts', size: 10 }));
        return reply(res, 200, OK({ thisPath: String(body.path), files, ini: [], dirs: [] }));
      }
      if (cmd === 'UploadTextFile') {
        const fm = /^ivr2:2\/(.+)$/.exec(String(body.what || ''));
        if (!fm) return reply(res, 200, { responseStatus: 'ERROR', message: 'bad what' });
        state.files.set(fm[1], String(body.contents || ''));
        return reply(res, 200, OK());
      }
      if (cmd === 'FileAction') {
        const fm = /^ivr2:2\/(.+)$/.exec(String(body.what || ''));
        const ok = body.action === 'delete' && fm && state.files.delete(fm[1]);
        return reply(res, 200, OK({ success: !!ok, action: body.action, reports: [{ what: body.what, success: !!ok }] }));
      }
      // RunTzintuk
      return reply(res, 200, OK({ callerId: '0000000000', callsCount: 3, bilingPerCall: 0, biling: 0, errors: {}, verifyCode: '' }));
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
}
function stop() { return new Promise((r) => { if (!server) return r(); server.close(() => { server = null; r(); }); server.closeAllConnections && server.closeAllConnections(); }); }

module.exports = { start, stop, reset, setMode, calls, state };
