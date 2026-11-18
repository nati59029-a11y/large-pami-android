'use strict';
// קופה ש6 (POS:M6) – קריאת מחירון מצילום (ו A5, ו 5.15; תוכנית 9.3). מנהל בלבד, תוספת 'pos', מבנה חדש.
// **לא יוצר שום מוצר.** מחזיר שורות { name, price, bc } לתצוגה המקדימה של אשף הייבוא (www/pos-import.js), ומשם – רק אחרי "אשר".
//   posOcr({ mime, b64 }) → { rows:[{ name, price|null, bc }], n }
// התמונה לא נשמרת בשרת ולא ביומן. AI דרך lib/sec-ai.js (אותו מפתח GEMINI_API_KEY של האפליקציה).

const { HttpsError } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const { onCall } = require('./lib/region');
const { requireStaff, inputObject } = require('./lib/roles');
const T = require('./lib/tenant');
const AI = require('./lib/sec-ai');
const BC = require('./lib/pos-barcode');

const bad = (reason, msg) => new HttpsError('invalid-argument', msg, { reason });
const deny = (reason, msg) => new HttpsError('permission-denied', msg, { reason });
const pre = (reason, msg) => new HttpsError('failed-precondition', msg, { reason });
const MAX_B64 = 6 * 1024 * 1024; // ~4.5MB תמונה
const ROWS_MAX = 200;
const SYS = 'POS-OCR-V1\nאתה קורא מחירון של חנות מתוך תמונה (דף מודפס, שלט או צילום מסך). החזר JSON בלבד: {"rows":[{"name":"","price":0,"bc":""}]}.\n' +
  'שורה לכל מוצר שמופיע בתמונה, לפי הסדר. name – שם המוצר כפי שכתוב (עברית). price – המחיר בשקלים כמספר (12.9), או null אם לא ברור. ' +
  'bc – ברקוד אם כתוב ליד המוצר (ספרות בלבד), אחרת "". אל תמציא מוצרים, מחירים או ברקודים שלא כתובים. בלי טקסט נוסף.';

function parseRows(text) {
  let j;
  try { j = JSON.parse(String(text || '').replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch (e) { return null; }
  const rows = Array.isArray(j) ? j : j && Array.isArray(j.rows) ? j.rows : null;
  if (!rows) return null;
  return rows.slice(0, ROWS_MAX).map((r) => {
    const name = String(r && r.name || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
    const p = r && (typeof r.price === 'number' ? r.price : typeof r.price === 'string' ? Number(r.price.replace(/[^\d.]/g, '')) : NaN);
    const bc = BC.clean(r && r.bc).replace(/\D/g, '');
    return { name, price: Number.isFinite(p) && p > 0 && p < 1000000 ? Math.round(p * 100) / 100 : null, bc: bc.length >= 3 && bc.length <= 30 ? bc : '' };
  }).filter((r) => r.name);
}

async function ocr(request) {
  const input = inputObject(request);
  const who = await requireStaff(request);
  if (!who.prefix) throw pre('legacy', 'הקופה זמינה רק אחרי מעבר העסק למבנה החדש');
  if (!who.superadmin) T.requireFeature(who.biz, 'pos');
  if (who.role !== 'manager') throw deny('not-manager', 'קריאת מחירון – מנהל בלבד');
  for (const k of Object.keys(input)) if (!['mime', 'b64'].includes(k)) throw bad('bad-field', 'שדה לא מוכר');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(input.mime)) throw bad('bad-mime', 'רק תמונה (JPG / PNG)');
  if (typeof input.b64 !== 'string' || input.b64.length < 100 || input.b64.length > MAX_B64 || !/^[A-Za-z0-9+/=]+$/.test(input.b64)) throw bad('bad-img', 'התמונה לא תקינה או גדולה מדי');
  const r = await AI.see({ system: SYS, mime: input.mime, b64: input.b64, text: 'קרא את המחירון שבתמונה.', timeoutMs: 90000 });
  const rows = parseRows(r.text);
  if (!rows) { logger.warn('posOcr: bad answer', { len: String(r.text || '').length }); throw new HttpsError('unavailable', 'לא הצלחתי לקרוא את המחירון. נסו צילום ברור יותר.', { reason: 'bad-answer' }); }
  return { ok: true, rows, n: rows.length };
}

exports.posOcr = onCall({ secrets: [AI.GEMINI_API_KEY], timeoutSeconds: 120, memory: '512MiB' }, T.scoped(async (request) => {
  try { return await ocr(request); } catch (e) {
    if (e instanceof HttpsError) throw e;
    logger.error('posOcr failed', { name: e && e.name, code: e && e.code });
    throw new HttpsError('internal', 'שגיאה בפעולה. נסו שוב.', { reason: 'internal' });
  }
}));
Object.defineProperty(exports, '_core', { enumerable: false, value: { parseRows, SYS } });
