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
  const err = new YemotError(timeout ? 'timeout' : 'network', timeout);
  // קוד הרשת (למשל ECONNREFUSED) – רק למי שצריך להבחין "לא נוצר חיבור" מ"החיבור נותק" (צינתוק משוב בקבוצות). לא משנה את sent.
  const c = e && e.cause;
  err.netCode = c ? String(c.code || (Array.isArray(c.errors) && c.errors[0] && c.errors[0].code) || '') : '';
  return err;
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
  // קריאה בחלקים: עוצרים ברגע שעוברים את maxBytes (גם כשאין content-length)
  const parts = []; let total = 0;
  try {
    const reader = r.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) { try { await reader.cancel(); } catch (e) { /* */ } throw new YemotError('too-big', false); }
      parts.push(Buffer.from(value));
    }
  } catch (e) { if (e instanceof YemotError) throw e; throw new YemotError(netError(e).code, false); }
  const buf = Buffer.concat(parts);
  if (!buf.length) throw new YemotError('empty', false);
  if (buf[0] === 0x7b) { try { if (JSON.parse(buf.toString('utf8')).responseStatus) throw new YemotError('bad-reply', false); } catch (e) { if (e instanceof YemotError) throw e; } }
  return buf;
}

// תוכן קובץ טקסט מהקו (GetTextFile, post/32055): { what } ← contents. (לא מאומת על קובצי tts – הדוגמה בתיעוד היא ext.ini.)
// משימה 2026-11-04, חוזה 5.4: לגיבוי ולהאזנה של קובץ tts ותיק. חסר contents ← no-contents.
async function readText(ctx, what) {
  const j = await yemotCall(ctx, 'GetTextFile', { what });
  if (typeof j.contents !== 'string') throw new YemotError('no-contents', true);
  return j.contents;
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

// ---------------- רשימות תפוצה וצינתוק (משימה 2026-11-17, לקוחות משוב) ----------------
// מתועד ב-api-55 (post/32033, 32037, 32039, 32043, 64941, 65034). אין כאן פקודות מחיקה של רשימה או של מספרים:
// לא DeleteTemplate, לא ClearTemplateEntries, לא UpdateTemplateEntries, ולא updateType NEW/REMOVE – בכוונה.
// (משימה 2026-11-19) UpdateTemplateEntry – רק לחסימה/ביטול חסימה של מספר קיים לפי rowid (setEntryBlocked). לא מוסיף ולא מוחק.
const PHONE_RE = /^0\d{8,9}$/;

// כל התבניות: [{ templateId, description }]
async function getTemplates(ctx) {
  const j = await yemotCall(ctx, 'GetTemplates', {});
  return (Array.isArray(j.templates) ? j.templates : []).map((t) => ({ templateId: Number(t && t.templateId), description: t && typeof t.description === 'string' ? t.description : null }))
    .filter((t) => Number.isInteger(t.templateId) && t.templateId > 0);
}

// תבנית חדשה (ההגדרות מועתקות מקמפיין ברירת המחדל). מחזיר templateId. תשובה בלי מזהה ← no-template-id (לא ודאי: ייתכן שנוצרה).
async function createTemplate(ctx, description) {
  const j = await yemotCall(ctx, 'CreateTemplate', { description: String(description) });
  const id = Number(j.templateId);
  if (!Number.isInteger(id) || id <= 0) throw new YemotError('no-template-id', true);
  return id;
}

// המספרים ברשימת התפוצה: [{ phone, blocked, rowid, name, moreinfo }] (rowid/name/moreinfo – לחסימה, בלי למחוק שם ומידע נוסף)
// חסום = כל ערך שאינו false/0/'0'/'false'/ריק (true, 1, '1' וכו') – בספק לא שולחים צינתוק בתשלום
const isBlocked = (b) => !(b === false || b === 0 || b == null || b === '' || b === '0' || b === 'false');
async function getTemplateEntries(ctx, templateId) {
  const j = await yemotCall(ctx, 'GetTemplateEntries', { templateId });
  const str = (v) => (typeof v === 'string' ? v : null);
  return (Array.isArray(j.entries) ? j.entries : []).map((e) => ({ phone: String((e && e.phone) || ''), blocked: isBlocked(e && e.blocked),
    rowid: Number.isInteger(Number(e && e.rowid)) && Number(e.rowid) > 0 ? Number(e.rowid) : null, name: str(e && e.name), moreinfo: str(e && e.moreinfo) })).filter((e) => e.phone);
}

// חסימה / ביטול חסימה של מספר אחד שכבר ברשימה (UpdateTemplateEntry, מתועד ב-api-55). entry = שורה מ-getTemplateEntries.
// rowid חובה (בלעדיו ימות עלול ליצור שורה חדשה או למחוק שם ומידע נוסף). השם והמידע הנוסף נשלחים כמו שהם, כדי שלא יימחקו (לא מאומת אם נדרש).
async function setEntryBlocked(ctx, templateId, entry, blocked) {
  if (!entry || !Number.isInteger(entry.rowid) || entry.rowid <= 0 || !entry.phone || typeof blocked !== 'boolean') throw new YemotError('bad-entry', false);
  const p = { templateId, rowid: entry.rowid, phone: String(entry.phone), blocked: blocked ? 1 : 0 };
  if (typeof entry.name === 'string') p.name = entry.name;
  if (typeof entry.moreinfo === 'string') p.moreinfo = entry.moreinfo;
  await yemotCall(ctx, 'UpdateTemplateEntry', p);
}

// הוספה/עדכון של מספרים ברשימת תפוצה. updateType קבוע: UPDATE (מוסיף חדשים ומעדכן קיימים, לא מסיר אף מספר).
// rows: [{ phone, name }] – phone כבר מנורמל, name בלי פסיקים ושורות (המתקשר מנקה). בלי שורת כותרת (לא מאומת אם ימות מצפה לה).
// מחזיר { parsed, inserted, updated, rejected: [{ phone, errorState }] }. message שאינו ok ← bad-format (ימות דחה את כל הקובץ).
async function uploadPhoneList(ctx, templateId, rows) {
  if (!Array.isArray(rows) || !rows.length) throw new YemotError('empty-list', false);
  for (const r of rows) if (!PHONE_RE.test(String(r && r.phone)) || /[,\r\n]/.test(String((r && r.name) || ''))) throw new YemotError('bad-row', false);
  const data = rows.map((r) => r.phone + ',' + String(r.name || '')).join('\n');
  const j = await yemotCall(ctx, 'UploadPhoneList', { templateId, data, nameColumns: 1, delimiter: ',', updateType: 'UPDATE', blocked: 0 });
  if (j.message !== undefined && String(j.message).toLowerCase() !== 'ok') throw new YemotError('bad-format', false);
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const rejected = (Array.isArray(j.rejectedRecords) ? j.rejectedRecords : []).map((x) => ({ phone: String((x && x.phone) || ''), errorState: String((x && x.errorState) || '').slice(0, 20) }));
  return { parsed: num(j.totalParsed), inserted: num(j.totalInserted), updated: num(j.totalUpdated), rejected };
}

// המנויים לרשימת צינתוקים חינמית (TzintukimListManagement, getlistEnteres בלבד – קריאה, בלי שינוי). מחזיר מערך טלפונים.
async function tzlEntries(ctx, list) {
  const j = await yemotCall(ctx, 'TzintukimListManagement', { action: 'getlistEnteres', TzintukimList: String(list) });
  return (Array.isArray(j.enteres) ? j.enteres : []).map((e) => String((e && e.phone) || '')).filter(Boolean);
}

// (משימה 2026-11-23) יומן הרשימה החינמית (getLogList, post/65034 – קריאה בלבד): מערך האירועים כמו שימות מחזיר ({ Phone, PhoneAction, Date, Time, TypeOperation, ... }).
async function tzlLog(ctx, list) {
  const j = await yemotCall(ctx, 'TzintukimListManagement', { action: 'getLogList', TzintukimList: String(list) });
  if (!Array.isArray(j.events)) throw new YemotError('no-events', true);
  return j.events;
}

// (משימה 2026-11-23) קובץ ymgr של הקו כטבלה (RenderYMGRFile, post/84092 – קריאה בלבד). בתיעוד שם הפרמטר הוא wath (כך במקור).
// מחזיר את data כמו שימות מחזיר (מערך אובייקטים). בלי data ← no-data. timeoutMs (רשות) – לקובץ גדול.
async function renderYmgr(ctx, path, timeoutMs) {
  const c = timeoutMs ? Object.assign({}, ctx, { timeoutMs }) : ctx;
  const j = await yemotCall(c, 'RenderYMGRFile', { wath: path, convertType: 'json', notLoadLang: 1 });
  if (!Array.isArray(j.data)) throw new YemotError('no-data', true);
  return j.data;
}

// צינתוק למערך מפורש של מספרים (בתשלום: 0.1 יחידה למספר, לפי התיעוד). לא מקבל tpl:/tzl: – רק מספרים תקינים, עד 500 בקריאה.
async function runTzintukPhones(ctx, phones) {
  if (!Array.isArray(phones) || !phones.length || phones.length > 500 || !phones.every((p) => PHONE_RE.test(String(p)))) throw new YemotError('bad-phones', false);
  const j = await yemotCall(ctx, 'RunTzintuk', { phones: phones.map(String) });
  return { callsCount: Number.isFinite(Number(j.callsCount)) ? Number(j.callsCount) : null, errors: j.errors && typeof j.errors === 'object' ? Object.keys(j.errors).length : 0 };
}

module.exports = { YemotError, apiBase, yemotCall, listDir, listDirInfo, downloadFile, readText, uploadText, uploadBinary, deleteFiles,
  getTemplates, createTemplate, getTemplateEntries, setEntryBlocked, uploadPhoneList, tzlEntries, tzlLog, renderYmgr, runTzintukPhones };
