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
  const j = await yemotCall(ctx, 'GetIVR2Dir', { path: String(path) });
  return (Array.isArray(j.files) ? j.files : []).map((f) => String((f && f.name) || '')).filter(Boolean);
}

// קובץ טקסט (למשל tts). דורס קובץ קיים באותו שם (post/32056).
async function uploadText(ctx, what, contents) {
  await yemotCall(ctx, 'UploadTextFile', { what, contents: String(contents) });
}

// קובץ שמע. (לא מאומת – לבדיקה ראשונה בקו): הפקודה UploadFile, השדות path / convertAudio / qqfile.
async function uploadBinary(ctx, path, buf, mime) {
  const form = new FormData();
  form.append('path', path);
  form.append('convertAudio', '1');
  form.append('qqfile', new Blob([buf], { type: mime }), String(path).split('/').pop());
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

// הוספת מספר אחד לרשימת צינתוקים (שלוחה 5, tzintukJoin). רק הוספה – אין כאן מחיקה או איפוס של רשימה.
// (לא מאומת – לבדוק בתיעוד api-55 לפני פרסום): שם הפקודה, ערך action ושמות השדות.
const TZ_ADD = { command: 'TzintukimListManagement', params: (list, phone) => ({ action: 'add', list, phone }) };
async function addToTzintukList(ctx, list, phone) {
  await yemotCall(ctx, TZ_ADD.command, TZ_ADD.params(list, phone));
}

module.exports = { YemotError, apiBase, yemotCall, listDir, uploadText, uploadBinary, deleteFiles, addToTzintukList, TZ_ADD };
