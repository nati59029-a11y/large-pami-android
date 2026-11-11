'use strict';
// המזכירה – נקודת ההחלפה של ספק ה-AI (אפיון 9.3). זה הקובץ היחיד במזכירה שמכיר את מבנה הבקשה של ספק מסוים.
// ממשק אחיד: chat({ tier: 'fast'|'deep', system, turns, tools, timeoutMs }) → { text, calls: [{ name, args }], usage: { in, out }, model, sent }
//   turns: [{ role: 'u'|'a', text }] | { role: 'call', calls:[{name,args}] } | { role: 'res', results:[{ name, data }] }
//   tools: [{ name, description, parameters (JSON Schema פשוט) }]
// ספק פעיל: SEC_AI_PROVIDER (ברירת מחדל 'gemini' – כבר קיים בפרויקט, אותו מפתח בכספת GEMINI_API_KEY). ספק נוסף = פונקציה נוספת ב-PROVIDERS.
// (דורש החלטה: ספק סופי לכל תפקיד – 9.3. המודלים והמחירים כאן הם ברירות מחדל שאפשר לשנות בלי קוד, ב-functions/.env.)
// באמולטור מותר לפנות רק לשרת דמה מקומי (כמו scan.js) – אף פעם לא לשירות האמיתי.

const { HttpsError } = require('firebase-functions/v2/https');
const { defineSecret, defineString } = require('firebase-functions/params');

const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
const P = {
  provider: defineString('SEC_AI_PROVIDER', { default: 'gemini', description: 'ספק ה-AI של המזכירה (כרגע: gemini)' }),
  base: defineString('GEMINI_API_BASE', { default: 'https://generativelanguage.googleapis.com', description: 'כתובת השירות של Gemini' }),
  fast: defineString('SEC_MODEL_FAST', { default: 'gemini-2.5-flash', description: 'המודל המהיר והזול של המזכירה (תשובה רגילה). (לא מאומת: שם ומחיר)' }),
  deep: defineString('SEC_MODEL_DEEP', { default: 'gemini-2.5-pro', description: 'המודל האיכותי ("חשבי לעומק"). (לא מאומת: שם ומחיר)' }),
  // מחיר משוער בדולרים למיליון טוקנים: "קלט/פלט" לכל מודל. הערכה בלבד (לא מאומת) – משמשת לתקרת העלות
  priceFast: defineString('SEC_PRICE_FAST', { default: '0.30/2.50', description: 'מחיר משוער $ למיליון טוקנים, קלט/פלט – מודל מהיר (לא מאומת)' }),
  priceDeep: defineString('SEC_PRICE_DEEP', { default: '1.25/10', description: 'מחיר משוער $ למיליון טוקנים, קלט/פלט – מודל איכותי (לא מאומת)' }),
};
const str = (p, d) => { try { const v = p.value(); return typeof v === 'string' && v.trim() ? v.trim() : d; } catch (e) { return d; } };

function assertSafeBase(base) {
  if (!/^https?:\/\//.test(base)) throw new HttpsError('internal', 'כתובת שירות לא תקינה', { reason: 'bad-base' });
  if (process.env.FUNCTIONS_EMULATOR === 'true' && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) {
    throw new HttpsError('internal', 'באמולטור מותר לפנות רק לשרת דמה מקומי', { reason: 'emulator-outbound-blocked' });
  }
}

// עלות משוערת במילי־סנט (1/1000 סנט), מספר שלם. usage = { in, out } טוקנים
function costMc(tier, usage) {
  const [pin, pout] = str(tier === 'deep' ? P.priceDeep : P.priceFast, tier === 'deep' ? '1.25/10' : '0.30/2.50').split('/').map(Number);
  const u = usage || {};
  const usd = ((+u.in || 0) * (pin || 0) + (+u.out || 0) * (pout || 0)) / 1e6;
  return Math.ceil(usd * 100 * 1000);
}
const modelOf = (tier) => (tier === 'deep' ? str(P.deep, 'gemini-2.5-pro') : str(P.fast, 'gemini-2.5-flash'));

// ---------- Gemini (REST generateContent עם הצהרות כלים) ----------
function geminiBody(o) {
  const contents = [];
  for (const t of o.turns) {
    if (t.role === 'u') contents.push({ role: 'user', parts: [{ text: t.text }] });
    else if (t.role === 'a') contents.push({ role: 'model', parts: [{ text: t.text }] });
    else if (t.role === 'call') contents.push({ role: 'model', parts: t.calls.map((c) => ({ functionCall: { name: c.name, args: c.args || {} } })) });
    else if (t.role === 'res') contents.push({ role: 'user', parts: t.results.map((r) => ({ functionResponse: { name: r.name, response: { content: r.data } } })) });
  }
  const body = { systemInstruction: { parts: [{ text: o.system }] }, contents, generationConfig: o.tier === 'deep'
    ? { temperature: 0.3, maxOutputTokens: 8192 } // מודל איכותי: "חשיבה" פעילה (נספרת בעלות)
    : { temperature: 0.2, maxOutputTokens: 2048, thinkingConfig: { thinkingBudget: 0 } } }; // מהיר וזול: בלי "חשיבה" (לא מאומת: שם השדה בכל גרסת מודל)
  if (o.tools && o.tools.length) {
    body.tools = [{ functionDeclarations: o.tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }];
    body.toolConfig = { functionCallingConfig: { mode: 'AUTO' } };
  }
  return body;
}

async function gemini(o) {
  const base = str(P.base, 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
  assertSafeBase(base);
  let key = '';
  try { key = GEMINI_API_KEY.value(); } catch (e) { key = ''; }
  if (!key) throw new HttpsError('failed-precondition', 'אין מפתח AI בשרת', { reason: 'no-key' });
  const model = modelOf(o.tier);
  const ctl = new AbortController();
  const tm = setTimeout(() => ctl.abort(), o.timeoutMs || 45000);
  const out = { sent: 0 };
  let r;
  try {
    out.sent = 1;
    r = await fetch(`${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(geminiBody(o)), signal: ctl.signal,
    });
  } catch (e) {
    clearTimeout(tm);
    const codes = [e && e.code, e && e.cause && e.cause.code];
    if (codes.some((c) => ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(c))) out.sent = 0;
    const err = new HttpsError(e && e.name === 'AbortError' ? 'deadline-exceeded' : 'unavailable', 'המזכירה לא זמינה כרגע. נסו שוב בעוד דקה.', { reason: e && e.name === 'AbortError' ? 'ai-timeout' : 'ai-network' });
    err.sent = out.sent;
    throw err;
  }
  try {
    if (!r.ok) {
      const reason = r.status === 429 ? 'ai-quota' : [500, 502, 503, 504].includes(r.status) ? 'ai-overloaded' : (r.status === 400 || r.status === 403) ? 'ai-rejected' : 'ai-error';
      // לא מעבירים את גוף השגיאה הלאה (עלול להכיל פרטים פנימיים)
      const err = new HttpsError(reason === 'ai-quota' ? 'resource-exhausted' : 'unavailable', 'המזכירה לא זמינה כרגע. נסו שוב בעוד דקה.', { reason, status: r.status });
      err.sent = 1;
      throw err;
    }
    const j = await r.json();
    const c = (j.candidates || [])[0] || {};
    const parts = (c.content && c.content.parts) || [];
    const calls = parts.filter((p) => p && p.functionCall && typeof p.functionCall.name === 'string')
      .map((p) => ({ name: p.functionCall.name, args: p.functionCall.args && typeof p.functionCall.args === 'object' ? p.functionCall.args : {} }));
    const text = parts.filter((p) => p && typeof p.text === 'string').map((p) => p.text).join('');
    const um = j.usageMetadata || {};
    return { text, calls, usage: { in: +um.promptTokenCount || 0, out: (+um.candidatesTokenCount || 0) + (+um.thoughtsTokenCount || 0) }, model, sent: 1 };
  } finally { clearTimeout(tm); }
}

const PROVIDERS = { gemini };
async function chat(o) {
  const name = str(P.provider, 'gemini');
  const fn = Object.hasOwn(PROVIDERS, name) ? PROVIDERS[name] : null;
  if (!fn) throw new HttpsError('failed-precondition', 'ספק AI לא מוגדר', { reason: 'no-provider' });
  return fn(o);
}

module.exports = { chat, costMc, modelOf, geminiBody, GEMINI_API_KEY, PROVIDERS };
