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
  // סגירת קופה – הערכים מדוח Z של יהודה הנשיא ומהצהרת הפתיחה של נחל לכיש (הצילומים לדוגמה מ-20.10.2026)
  zreport: { register: '6346053', store: 'לארג\' פעמי-יהודה הנשיא', date: '2026-10-20', time: '09:02', report_no: '777', credit: 4313.95, cash: 3260, checks: null, voucher_buy: null, voucher_credit: null, voucher_issue: -169.8, house: null, rounding: -0.02, total: 7404.15, open_float: 8919, cash_sales: 3260, cash_out: -10615, cash_in_drawer: 1564 },
  opening: { register: '6328947', store: 'לארג\' פעמי-נחל לכיש', date: '2026-10-20', time: '09:11', total: 970.3 },
  // אישור הפקדה מהבנק (הצילום לדוגמה מ-17.10.2026)
  deposit: { date: '2026-10-17', time: '22:26', amount: 25000, bank: 'דיסקונט', account: '611131' },
  // פתק "הוצאת מזומן מהקופה" (הצילום לדוגמה מ-20.10.2026, יהודה הנשיא)
  transfer: { document_type: 'bank_transfer', transfers: [{ amount: 1234.56, date: '2026-11-02', payee_name: 'ספק דמה בע"מ', payee_account: { bank: '12', branch: '345', account: '67890' }, reference: 'R-1001' }] },
  cashout: { register: '6346053', store: 'לארג\' פעמי-יהודה הנשיא', date: '2026-10-20', time: '09:02', amount: 4650 },
  recipe: { title: 'עוגת שמרים', text: 'עוגת שמרים. המצרכים: שתי כוסות קמח. אופן ההכנה: לערבב ולאפות.' },
  feedback: { invoice_number: '8247460', purchase_amount: '58.86', liked: 'שירות מעולה', improve: 'עוד קופות', name: 'כהן', phone: '0541234567', address: 'הרצל 12/3', ratings: { availability: 9, service: 10, cleanliness: 8, prices: 7, bakery: null, overall: 9 }, uncertain: ['phone'] },
};

// delayMs: כמה זמן שרת הדמה "חושב" לפני שהוא עונה לבקשת זיהוי (לבדיקת תקציב הזמן)
// סריקה אחידה: תשובות classify לדוגמה, לכל סוג
const CLASSIFY = {
  invoice: { type: 'invoice', type_confidence: 0.95, z_part: null, page_number: 1, page_count: 2, fields: { supplier: 'ספק דמה בע"מ', supplier_id: '512345678', number: '123456', date: '2026-10-28', total_before_vat: 100, vat_amount: 18, total_with_vat: 118 }, confidence: { supplier: 0.9, supplier_id: 0.95, number: 0.99, date: 0.5, total_before_vat: 0.9, vat_amount: 0.9, total_with_vat: 0.95 } },
  delivery_note: { type: 'delivery_note', type_confidence: 0.9, fields: { supplier: 'ספק', number: '77', date: null, total_with_vat: 50 }, confidence: { number: 0.9 } },
  receipt: { type: 'receipt', type_confidence: 0.9, fields: { supplier: 'ספק', number: '9', date: '2026-11-01', total_with_vat: 118, related_invoice: '123456' }, confidence: {} },
  credit_note: { type: 'credit_note', type_confidence: 0.9, fields: { supplier: 'ספק', number: '5', date: '2026-11-01', total_before_vat: 50, vat_amount: '9', total_with_vat: '59.00' }, confidence: {} },
  cashout: { type: 'cashout', type_confidence: 0.9, fields: { register: '6346053', store: 'יהודה הנשיא', date: '2026-10-20', time: '09:02', amount: 4650 }, confidence: { amount: 0.99 } },
  deposit: { type: 'deposit', type_confidence: 0.9, fields: { date: '2026-10-17', time: '22:26', amount: 25000, bank: 'דיסקונט', account: '611131' }, confidence: {} },
  transfer: { type: 'transfer', type_confidence: 0.9, fields: { transfers: [{ amount: 1234.56, date: '2026-11-02', payee_name: 'ספק', payee_account: { bank: '12', branch: '345', account: '67890' }, reference: 'R-1' }] }, confidence: {} },
  zreport: { type: 'zreport', type_confidence: 0.9, z_part: 'middle', fields: { open_float: 8919, cash_sales: 3260, cash_out: -10615, cash_in_drawer: 1564 }, confidence: {} },
  opening: { type: 'opening', type_confidence: 0.9, fields: { register: '6328947', store: 'נחל לכיש', date: '2026-10-20', time: '09:11', total: 970.3 }, confidence: {} },
  unknown: { type: 'unknown', type_confidence: 0.3, fields: {}, confidence: {} },
};
const state = { mode: 'ok', requests: [], listCalls: 0, split: false, fenced: false, delayMs: 0, listDelayMs: 0, classify: null };
function reset() { state.classify = null; state.mode = 'ok'; state.requests = []; state.listCalls = 0; state.split = false; state.fenced = false; state.delayMs = 0; state.listDelayMs = 0; }

function kindOf(body) {
  const t = (((body.contents || [])[0] || {}).parts || [])[0];
  const s = (t && t.text) || '';
  if (s.startsWith('סווג את המסמך')) return 'classify'; // סריקה אחידה – לפני כל השאר, כי ההנחיה מזכירה את כל הסוגים
  if (s.includes('אישור על העברה בנקאית')) return 'transfer';
  if (s.includes('אישור הפקדת מזומן')) return 'deposit';
  if (s.includes('פתק "הוצאת מזומן מהקופה"')) return 'cashout';
  if (s.includes('דוח Z')) return 'zreport';
  if (s.includes('הצהרת פתיחת קופה')) return 'opening';
  if (s.includes('חשבונית מס')) return 'invoice';
  if (s.includes('טופס משוב לקוחות')) return 'feedback';
  if (s.includes('בתמונה מוצר')) return 'product';
  if (s.includes('בתמונה מתכון')) return 'recipe';
  return 'unknown';
}

// התשובה הגולמית שהשרת מחזיר לבקשה – נחשפת לבדיקה, כדי להשוות לתוצאה של הפונקציה
// classify: התשובה נקבעת בבדיקה (state.classify), ובלי – חשבונית רגילה
function rawAnswer(kind) {
  if (state.mode === 'garbage') return { candidates: [{ content: { parts: [{ text: 'not json' }], role: 'model' }, finishReason: 'STOP' }] };
  let text = JSON.stringify(kind === 'classify' ? (state.classify || CLASSIFY.invoice) : (ANSWERS[kind] || { ok: true }));
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
      // השרת קיבל את כל הבקשה – ואז מנתק את החיבור בלי לענות
      if (state.mode === 'hangup') { req.socket.destroy(); return; }
      // שגיאה 400 שהכותרות שלה מגיעות מיד, אבל הגוף שלה מגיע לאט (delayMs)
      if (state.mode === 'slowErrorBody') {
        res.writeHead(400, { 'Content-Type': 'application/json' }); res.write('{"error":');
        setTimeout(() => { if (!res.destroyed && !res.writableEnded) res.end('{"message":"bad request"}}'); }, state.delayMs);
        return;
      }
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

module.exports = { start, stop, reset, state, rawAnswer, ANSWERS, CLASSIFY, MODELS, PORT };
