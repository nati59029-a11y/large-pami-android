'use strict';
// שרת דמה מקומי שמחליף את Gemini בבדיקות (127.0.0.1:9799). אין שום פנייה החוצה.
// הפונקציות באמולטור פונות אליו, כי functions/.env.demo-largpeami מגדיר GEMINI_API_BASE=http://127.0.0.1:9799.
// השרת רושם כל בקשה (מודל, מפתח, גוף), ומחזיר תשובה במבנה של Gemini (candidates[0].content.parts[]).

const http = require('node:http');

const PORT = 9799;
const MODELS = [
  { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-2.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
];

// תשובות דמה – באותו מבנה JSON שההנחיות של האפליקציה מבקשות
const ANSWERS = {
  invoice: { document_type: 'invoice', supplier: 'ספק דמה בע"מ', number: '123456', date: '2026-10-28', total_before_vat: 100, vat_amount: 18, total_with_vat: 118 },
  product: { name: 'כוסות קרטון', details: 'תבניכל, 50 יחידות' },
  feedback: { invoice_number: '8247460', purchase_amount: '58.86', liked: 'שירות מעולה', improve: 'עוד קופות', name: 'כהן', phone: '0541234567', address: 'הרצל 12/3', ratings: { availability: 9, service: 10, cleanliness: 8, prices: 7, bakery: null, overall: 9 }, uncertain: ['phone'] },
};

// delayMs: כמה זמן שרת הדמה "חושב" לפני שהוא עונה לבקשת זיהוי (לבדיקת תקציב הזמן)
const state = { mode: 'ok', requests: [], listCalls: 0, split: false, fenced: false, delayMs: 0, listDelayMs: 0 };
function reset() { state.mode = 'ok'; state.requests = []; state.listCalls = 0; state.split = false; state.fenced = false; state.delayMs = 0; state.listDelayMs = 0; }

function kindOf(body) {
  const t = (((body.contents || [])[0] || {}).parts || [])[0];
  const s = (t && t.text) || '';
  if (s.includes('חשבונית מס')) return 'invoice';
  if (s.includes('טופס משוב לקוחות')) return 'feedback';
  if (s.includes('בתמונה מוצר')) return 'product';
  return 'unknown';
}

// התשובה הגולמית שהשרת מחזיר לבקשה – נחשפת לבדיקה, כדי להשוות לתוצאה של הפונקציה
function rawAnswer(kind) {
  let text = JSON.stringify(ANSWERS[kind] || { ok: true });
  if (state.fenced) text = '```json\n' + text + '\n```';
  const parts = state.split ? [{ text: text.slice(0, 10) }, { text: text.slice(10) }] : [{ text }];
  return { candidates: [{ content: { parts, role: 'model' }, finishReason: 'STOP' }] };
}

let server = null;
function start() {
  if (server) return Promise.resolve();
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const key = req.headers['x-goog-api-key'] || '';
      res.on('error', () => { /* הלקוח ויתר וסגר את החיבור */ });
      const send0 = (code, obj) => { if (res.destroyed || res.writableEnded) return; res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      let send = send0;
      if (req.method === 'GET' && req.url.startsWith('/v1beta/models')) { state.listCalls++; return state.listDelayMs ? setTimeout(() => send0(200, { models: MODELS }), state.listDelayMs) : send(200, { models: MODELS }); }
      const m = /^\/v1beta\/models\/([^:]+):generateContent$/.exec(req.url);
      if (req.method !== 'POST' || !m) return send(404, { error: { message: 'not found' } });
      let body = {};
      try { body = JSON.parse(raw); } catch (e) { /* */ }
      const kind = kindOf(body);
      state.requests.push({ model: m[1], key, body, kind, at: Date.now() });
      if (state.delayMs) { const d = state.delayMs; send = (code, obj) => setTimeout(() => send0(code, obj), d); }
      if (state.mode === 'badkey') return send(400, { error: { message: 'API key not valid. Please pass a valid API key.' } });
      if (state.mode === 'quota') return send(429, { error: { message: 'quota' } });
      if (state.mode === 'overloaded') return send(503, { error: { message: 'overloaded' } });
      return send(200, rawAnswer(kind));
    });
  });
  return new Promise((ok, no) => { server.once('error', no); server.listen(PORT, '127.0.0.1', ok); });
}
function stop() { if (!server) return Promise.resolve(); const s = server; server = null; return new Promise((ok) => s.close(ok)); }

module.exports = { start, stop, reset, state, rawAnswer, ANSWERS, MODELS, PORT };
