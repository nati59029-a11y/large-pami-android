'use strict';
// שרת cxBot מדומה לבדיקות: מממש את החוזה (README) ורושם כל קריאה
const http = require('http');

function start(o) {
  const S = { calls: [], token: o.token, days: o.days || [], mode: {}, exportN: { new: 1, price: 2 } };
  const csvNew = '﻿קוד פריט,ברקוד,שם פריט\n900001,7290000009001,פריט חדש\n';
  const csvPrice = '﻿קוד פריט,מחיר לצרכן כולל מעמ\n101,5.5\n102,10.9\n';
  const srv = http.createServer((req, res) => {
    const send = (st, body) => {
      res.writeHead(st, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,content-type' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'OPTIONS') return send(204, {});
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url !== '/cxBot' || req.method !== 'POST') return send(404, { ok: false, reason: 'not-found' });
      if (req.headers.authorization !== 'Bearer ' + S.token) { S.calls.push({ op: 'unauth' }); return send(401, { ok: false, reason: 'auth' }); }
      let b;
      try { b = JSON.parse(raw); } catch (e) { return send(400, { ok: false, reason: 'bad-json' }); }
      S.calls.push(b);
      const op = b.op;
      // "סנכרן עכשיו": S.req = מזהה בקשה מהטלפון; poll מחזיר אותה עד ש-hello לוקח אותה (S.taken). S.noPoll – שרת ישן בלי poll
      // 0.1.10: S.caps – יכולות השרת (today / uq); S.uq – בקשת "עדכון המחשב" עד שהתוסף עונה (ack)
      if (op === 'poll') {
        if (S.bizOff) return send(403, { ok: false, reason: 'biz-off' }); if (S.noPoll) return send(400, { ok: false, reason: 'bad-op' });
        if (b.ack !== undefined && b.ack === S.uq) S.uqTook = true;
        const out = S.req && !S.taken ? { ok: true, want: true, id: S.req } : { ok: true, want: false };
        if (S.caps) out.caps = S.caps;
        if (S.uq && !S.uqTook && b.ack === undefined) out.uq = S.uq;
        return send(200, out);
      }
      if (op === 'upload' && b.partial !== undefined && S.todayOff) return send(409, { ok: false, reason: 'today-off', msg: 'לא בשעות' });
      if (op === 'upload' && b.partial !== undefined && S.noPartial) return send(400, { ok: false, reason: 'bad-field', msg: 'שדה לא מוכר' });
      if (op === 'hello' && b.req !== undefined) { if (b.req !== S.req || S.taken) return send(409, { ok: false, reason: 'req-gone', msg: 'הבקשה כבר טופלה' }); S.taken = true; }
      if (op === 'hello') return send(200, { ok: true, runId: S.runId || 'srvrun' + S.calls.length, minVer: '0.0.1', biz: { name: 'עסק בדיקה' }, days: S.days, schedule: { at: '03:00', tz: 'Asia/Jerusalem' }, limits: { price: 500, newMax: 50 } });
      if (op === 'upload' || op === 'hkSnap') return send(200, { ok: true });
      if (op === 'preview') return send(200, { ok: true, cnt: { nw: 1, in: 2 } });
      if (op === 'apply') return send(200, { ok: true, done: true, res: { nw: 1 } });
      if (op === 'export') {
        const n = S.exportN[b.kind] || 0;
        if (!n) return send(200, { ok: true, n: 0, csv: '', rows: [] });
        return send(200, { ok: true, n, csv: b.kind === 'new' ? csvNew : csvPrice, rows: Array.from({ length: Math.min(n, 5) }, (_, i) => ({ c: String(100 + i) })) });
      }
      if (op === 'importResult' || op === 'report') return send(200, { ok: true });
      return send(400, { ok: false, reason: 'bad-op' });
    });
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(Object.assign(S, { port: srv.address().port, close: () => new Promise((r) => srv.close(r)), ops: (op) => S.calls.filter((c) => c.op === op) }))));
}
module.exports = { start };
