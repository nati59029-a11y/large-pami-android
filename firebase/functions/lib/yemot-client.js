'use strict';
// לקוח ה-API של ימות המשיח – משותף ל-yemot.js (מבצעים) ול-yemot-line.js (שלוחות הקו).
// YemotError, apiBase ו-yemotCall הועברו כמו שהם מ-yemot.js. השאר: עטיפות קטנות לפקודות שהשרת משתמש בהן.
// המפתח נשלח רק בכותרת authorization. לא נכתב ליומן, לרשומה או להודעת שגיאה, וטקסט שחוזר מימות לא מועבר הלאה.
// הקובץ הזה (יחד עם voice.js) הוא היחיד שמכיר את שמות פקודות ההעלאה של ימות.

class YemotError extends Error {
  constructor(code, sent) { super('yemot:' + code); this.code = code; this.sent = !!sent; }
}

function apiBase(raw) {
  const base = String(raw || '').replace(/\/+$/, '') + '/';
  let u; try { u = new URL(base); } catch (e) { throw new YemotError('bad-base', false); }
  // הגנה: באמולטור מותר לפנות רק לשרת דמה מקומי, אף פעם לא לימות האמיתי.
  if (process.env.FUNCTIONS_EMULATOR === 'true' && !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) throw new YemotError('emulator-non-local', false);
  if (u.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) throw new YemotError('insecure-base', false);
  return base;
}

// בודק תשובה של ימות. כל responseStatus שאינו OK = כשל. לא מחזירים את טקסט השגיאה של ימות.
async function readReply(r) {
  let j = null;
  try { j = await r.json(); } catch (e) { throw new YemotError('bad-json', true); }
  if (!r.ok) throw new YemotError('http-' + r.status, true);
  if (!j || j.responseStatus !== 'OK') throw new YemotError('status-' + String((j && j.responseStatus) || 'none').slice(0, 20), true);
  return j;
}
function netError(e) {
  const timeout = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
  // בפסק זמן ייתכן שהבקשה כבר הגיעה לימות ובוצעה – "לא ודאי"
  return new YemotError(timeout ? 'timeout' : 'network', timeout);
}

// קריאה אחת ל-API. המפתח רק בכותרת.
async function yemotCall(ctx, command, params) {
  let r;
  try {
    r = await fetch(ctx.base + command, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: ctx.key },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(ctx.timeoutMs),
    });
  } catch (e) { throw netError(e); }
  return readReply(r);
}

// שמות הקבצים בתיקייה (בלי תיקיות משנה). path: '1', '2', '' (השורש).
async function listDir(ctx, path) {
  // השורש: ימות מחזיר EXCEPTION על path ריק (נצפה ביומן 02.11.2026), ולכן שולחים '/'
  const p = String(path);
  const j = await yemotCall(ctx, 'GetIVR2Dir', { path: p === '' ? '/' : p });
  return (Array.isArray(j.files) ? j.files : []).map((f) => String((f && f.name) || '')).filter(Boolean);
}

// כמו listDir, אבל עם פרטי הקובץ (משימה 2026-11-04, חוזה 5.4): { name, size, duration, date }. שדה שחסר = null.
// (לא מאומת) היחידה של size בקו האמיתי – לפי התיעוד (post/32052) מוחזר size; ההנחה: בתים.
async function listDirInfo(ctx, path) {
  const p = String(path);
  const j = await yemotCall(ctx, 'GetIVR2Dir', { path: p === '' ? '/' : p });
  const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);
  return (Array.isArray(j.files) ? j.files : []).map((f) => ({
    name: String((f && f.name) || ''), size: num(f && f.size), duration: num(f && f.duration), date: f && typeof f.date === 'string' ? f.date : null,
  })).filter((f) => f.name);
}

// הורדת קובץ מהקו (DownloadFile, post/32032): התגובה היא תוכן הקובץ (לא JSON). 404 = "לא קיים או שגיאה" – אי אפשר להבחין, ולכן המתקשר עוצר.
// המפתח רק בכותרת. תשובת JSON (שגיאה של ימות) ← bad-reply. מעל maxBytes ← too-big. ריק ← empty. (לא מאומת בקו: POST עם JSON והפורמט שחוזר.)
async function downloadFile(ctx, path, maxBytes) {
  let r;
  try {
    r = await fetch(ctx.base + 'DownloadFile', {
      method: 'POST', headers: { 'Content-Type': 'application/json', authorization: ctx.key }, body: JSON.stringify({ path }), signal: AbortSignal.timeout(ctx.timeoutMs),
    });
  } catch (e) { throw new YemotError(netError(e).code, false); }
  const drop = () => { try { r.body && r.body.cancel(); } catch (e) { /* */ } };
  if (r.status === 404) { drop(); throw new YemotError('not-found-or-error', false); }
  if (!r.ok) { drop(); throw new YemotError('http-' + r.status, false); }
  if (/json/i.test(r.headers.get('content-type') || '')) { drop(); throw new YemotError('bad-reply', false); }
  const len = Number(r.headers.get('content-length'));
  if (Number.isFinite(len) && len > maxBytes) { drop(); throw new YemotError('too-big', false); }
  let buf;
  try { buf = Buffer.from(await r.arrayBuffer()); } catch (e) { throw new YemotError(netError(e).code, false); }
  if (buf.length > maxBytes) throw new YemotError('too-big', false);
  if (!buf.length) throw new YemotError('empty', false);
  if (buf[0] === 0x7b) { try { if (JSON.parse(buf.toString('utf8')).responseStatus) throw new YemotError('bad-reply', false); } catch (e) { if (e instanceof YemotError) throw e; } }
  return buf;
}

// קובץ טקסט (למשל tts). דורס קובץ קיים באותו שם (post/32056).
async function uploadText(ctx, what, contents) {
  await yemotCall(ctx, 'UploadTextFile', { what, contents: String(contents) });
}

// קובץ שמע: UploadFile (multipart). מתועד ב-api-55: convertAudio=1 ממיר לפורמט הטלפוני, ו-path חייב להסתיים ב-.wav.
// (לא מאומת): שם שדה הקובץ בהעלאה רגילה – qqfile מופיע בתיעוד רק בהעלאה בחלקים.
// srcName: שם הקובץ המקורי (למשל 004.mp3 – לפי הפורמט האמיתי). בלי – שם היעד.
async function uploadBinary(ctx, path, buf, mime, srcName) {
  const form = new FormData();
  form.append('path', path);
  form.append('convertAudio', '1');
  form.append('qqfile', new Blob([buf], { type: mime }), srcName || String(path).split('/').pop());
  let r;
  try {
    r = await fetch(ctx.base + 'UploadFile', { method: 'POST', headers: { authorization: ctx.key }, body: form, signal: AbortSignal.timeout(ctx.timeoutMs) });
  } catch (e) { throw netError(e); }
  await readReply(r);
}

// מחיקה, קובץ אחרי קובץ (FileAction action=delete מתועד לקובץ אחד, post/32054). success:false = כשל.
async function deleteFiles(ctx, whats) {
  for (const what of whats) {
    const j = await yemotCall(ctx, 'FileAction', { action: 'delete', what });
    if (j.success === false) throw new YemotError('delete-false', true);
  }
}

module.exports = { YemotError, apiBase, yemotCall, listDir, listDirInfo, downloadFile, uploadText, uploadBinary, deleteFiles };
