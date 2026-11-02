'use strict';
// שרת דמה מקומי שמחליף את ה-API של ימות המשיח בבדיקות. אין שום פנייה החוצה.
// הפונקציות באמולטור פונות אליו לפי YEMOT_API_BASE (functions/.env.demo-largpeami, או functions/.env.local אם קיים).
// השרת רושם כל בקשה (פקודה, כותרת authorization, גוף), ומחזיק "שלוחה" בזיכרון: שם קובץ → תוכן.

const http = require('node:http');

// dirs: תיקייה → (שם קובץ → תוכן). state.files = שלוחה 2 (כמו קודם). '' = השורש.
const state = { requests: [], files: new Map(), dirs: {}, modes: {} };
const DEFAULT_DIRS = { '1': { '000.tts': 'מתכון ותיק' }, '3': { '000.tts': 'עדכון ותיק' }, '4': { '000.tts': 'שעות ותיקות' }, '': { 'M1000.wav': 'פתיחה מוקלטת', 'ext.ini': 'type=menu' } };
function reset(files, dirs) {
  state.requests = [];
  state.modes = { dir: 'ok', upload: 'ok', tzintuk: 'ok', delete: 'ok' };
  state.files = new Map(Object.entries(files || { '000.tts': 'פתיח' }));
  state.dirs = { '2': state.files };
  for (const [d, f] of Object.entries(Object.assign({}, DEFAULT_DIRS, dirs || {}))) state.dirs[d] = new Map(Object.entries(f));
}
// 'ivr2:1/004.tts' → { dir:'1', name:'004.tts' }; 'ivr2:/M1000.tts' → { dir:'', name:'M1000.tts' }
function parseWhat(w) { const m = /^ivr2:(\d*)\/([^/]+)$/.exec(String(w || '')); return m && state.dirs[m[1]] ? { dir: m[1], name: m[2] } : null; }
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
    const chunks = [];
    req.on('data', (c) => { chunks.push(c); });
    req.on('end', async () => {
      const buf = Buffer.concat(chunks);
      const m = /^\/ym\/api\/([A-Za-z0-9]+)$/.exec(req.url.split('?')[0]);
      const cmd = m ? m[1] : '?';
      let body = {}, upload = null;
      if (cmd === 'UploadFile') {
        // multipart: path, convertAudio, qqfile (נרשם בלי התוכן הבינארי)
        try {
          const fd = await new Response(buf, { headers: { 'content-type': req.headers['content-type'] || '' } }).formData();
          const f = fd.get('qqfile');
          upload = f && typeof f.arrayBuffer === 'function' ? Buffer.from(await f.arrayBuffer()) : null;
          body = { path: fd.get('path'), convertAudio: fd.get('convertAudio'), fileName: f && f.name, size: upload ? upload.length : 0, type: f && f.type };
        } catch (e) { body = { bad: true }; }
      } else { try { body = JSON.parse(buf.toString('utf8') || '{}'); } catch (e) { /* */ } }
      const auth = req.headers.authorization || '';
      state.requests.push({ cmd, auth, url: req.url, body, at: Date.now() });
      const key = { GetIVR2Dir: 'dir', UploadTextFile: 'upload', UploadFile: 'upload', RunTzintuk: 'tzintuk', FileAction: 'delete' }[cmd];
      if (!key) return reply(res, 404, { responseStatus: 'ERROR', message: 'unknown command' });
      const mode = state.modes[key];
      if (mode === 'hang') return; // לא עונה אף פעם (לבדיקת פסק זמן)
      if (mode === 'http500') return reply(res, 500, { responseStatus: 'EXCEPTION' });
      if (mode === 'exception') return reply(res, 200, { responseStatus: 'EXCEPTION', exceptionClass: 'IllegalArgumentException', exceptionMessage: 'bad token ' + auth });
      if (mode === 'error') return reply(res, 200, { yemotAPIVersion: 7, responseStatus: 'ERROR', message: 'token ' + auth + ' is incorrect', messageCode: 1 });
      if (cmd === 'GetIVR2Dir') {
        const dir = state.dirs[String(body.path)];
        if (!dir) return reply(res, 200, { responseStatus: 'ERROR', message: 'no dir' });
        const files = [...dir.keys()].sort().map((name) => ({ exists: true, name, what: `ivr2:${body.path}/${name}`, fileType: 'tts', size: 10 }));
        return reply(res, 200, OK({ thisPath: String(body.path), files, ini: [], dirs: [] }));
      }
      if (cmd === 'UploadTextFile') {
        const w = parseWhat(body.what);
        if (!w) return reply(res, 200, { responseStatus: 'ERROR', message: 'bad what' });
        state.dirs[w.dir].set(w.name, String(body.contents || ''));
        return reply(res, 200, OK());
      }
      if (cmd === 'UploadFile') {
        const w = parseWhat(body.path);
        if (!w || !upload) return reply(res, 200, { responseStatus: 'ERROR', message: 'bad upload' });
        state.dirs[w.dir].set(w.name, upload);
        return reply(res, 200, OK({ path: body.path }));
      }
      if (cmd === 'FileAction') {
        const w = parseWhat(body.what);
        const ok = body.action === 'delete' && w && state.dirs[w.dir].delete(w.name);
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
