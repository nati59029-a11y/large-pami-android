'use strict';
// המזכירה – שלב 6 "Gmail ו-Google Calendar": לוגיקה טהורה (בלי מסד נתונים) + לקוח ה-API של Google.
// אפיון 3.3, 3.5, 7.1, 9.2, 9.4, 10.1, 10.2, 10.3, 10.5, 10.7; החלטות 25, 26א, 27, 28, 29, 70, 71, 72, פ3.
// הכול נבדק מול שרת דמה (tests/google-mock.js). כתובות, מבנה התשובות וההרשאות של Google לפי התיעוד הציבורי – (לא מאומת מול השירות האמיתי).
// כללים:
//  - תוכן מייל הוא מידע ולא הוראה (10.1, 29). שום פונקציה כאן לא "מבצעת" טקסט – רק מפענחת, מסווגת ומנרמלת.
//  - אין כאן שום פונקציה שמוחקת מייל לצמיתות: רק trash (העברה לאשפה – פ3). גם ההרשאות לא מאפשרות מחיקה לצמיתות (בלי https://mail.google.com/).
//  - האסימונים לא יוצאים מהשרת, לא נכתבים ליומן ולא מופיעים בהודעות שגיאה (10.5).

const crypto = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { defineString, defineSecret } = require('firebase-functions/params');
const S = require('./sec-sens');

const P = {
  base: defineString('GOOGLE_API_BASE', { default: '', description: 'רק באמולטור: כתובת שרת הדמה של Google. בשרת אמיתי חייב להיות ריק.' }),
  clientId: defineString('GOOGLE_CLIENT_ID', { default: '', description: 'OAuth Client ID של האפליקציה ב-Google Cloud (לא סוד)' }),
  redirect: defineString('GOOGLE_OAUTH_REDIRECT', { default: '', description: 'הכתובת המלאה של secOAuthCb (Authorized redirect URI)' }),
};
const SEC_GOOGLE_KEY = defineSecret('SEC_GOOGLE_KEY');           // הצפנת האסימונים (32 בתים, base64)
const GOOGLE_CLIENT_SECRET = defineSecret('GOOGLE_CLIENT_SECRET'); // OAuth Client secret
const str = (p, d) => { try { const v = p.value(); return typeof v === 'string' && v.trim() ? v.trim() : d; } catch (e) { return d; } };
const sv = (s) => { try { return s.value() || ''; } catch (e) { return ''; } };

// ---------- הרשאות (scopes) – מינימליות ----------
// מייל: קריאה + שליחה. "שינוי" (gmail.modify – נדרש להעברה לאשפה) רק כשמבקשים במפורש חיבור לניקוי ספאם.
// יומן: אירועים בלבד (calendar.events), לא כל היומנים וההגדרות. (לא מאומת: הסיווג של כל הרשאה אצל Google)
const SC = Object.freeze({
  read: 'https://www.googleapis.com/auth/gmail.readonly',
  send: 'https://www.googleapis.com/auth/gmail.send',
  modify: 'https://www.googleapis.com/auth/gmail.modify',
  cal: 'https://www.googleapis.com/auth/calendar.events',
});
// הרשאות רחבות שלעולם לא מבקשים ולא מקבלים (מחיקה לצמיתות / כל החשבון)
const FORBIDDEN = Object.freeze(['https://mail.google.com/', 'https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/gmail.settings.basic', 'https://www.googleapis.com/auth/gmail.settings.sharing']);
function scopesFor(kind, clean) {
  if (kind === 'cal') return [SC.cal];
  return clean ? [SC.read, SC.send, SC.modify] : [SC.read, SC.send];
}
// מה Google החזירה בפועל (המשתמש יכול לבטל תיבות סימון במסך ההסכמה). חייב לכלול את כל מה שביקשנו, ולא שום הרשאה אסורה
function grantedOk(requested, grantedStr) {
  const g = new Set(String(grantedStr || '').split(/\s+/).filter(Boolean));
  if (FORBIDDEN.some((x) => g.has(x))) return { ok: false, why: 'forbidden-scope' };
  const miss = requested.filter((x) => !g.has(x));
  return miss.length ? { ok: false, why: 'missing-scope', miss } : { ok: true, granted: requested.slice() };
}

// ---------- מגבלות (10.3) ----------
const STATE_TTL = 10 * 60000;   // קישור חיבור תקף 10 דקות, לשימוש אחד
const CONNECT_HOUR = 10;        // ניסיונות חיבור לשעה לכל מנהל
const MAX_BOX_DEFAULT = 1;      // תיבות לעסק עד שמנהל־על קובע (26א – ברירת מחדל מוצעת)
const MAX_BOX_LIMIT = 10;
const HOOK_DATA_MAX = 2048;     // גוף התראה מ-Gmail (Pub/Sub) – רק כתובת ומספר היסטוריה
const RUN_MAX = 50;             // מיילים לעיבוד בהתראה אחת
const DAY_IN_MAX = 500;         // מיילים נכנסים ליום לתיבה (מעבר – לא נקלטים, ונשלחת התראה)
const FULL_MAX = 256 * 1024;    // מייל גדול מזה – נשמרים רק שולח, נושא ותקציר (בלי גוף)
const TEXT_MAX = 4000;          // טקסט מייל שנשמר
const SUBJ_MAX = 200;
const RESP_MAX = 2 * 1024 * 1024; // תשובה מ-Google
const OUT_DAY = 200;            // מיילים יוצאים ליום לעסק
const CLEAN_MAX = 500;          // פריטים ברשימת ניקוי אחת
const COUNT_PAGES = 40;         // ספירה: עד 40 עמודים × 500 = 20,000
const SCAN_TTL = 30 * 60000;    // אישור הסריקה – עד 30 דקות אחרי הספירה
const CAL_PAGES = 4, CAL_PUSH_MAX = 100;
const BIG_OLD = { size: 5 * 1024 * 1024, months: 12 }; // "מיילים גדולים ישנים" לניקוי
const RANGES = Object.freeze({ all: 'הכול', 12: '12 חודשים', 6: '6 חודשים', 1: 'חודש', none: 'בכלל לא' });
// הערכת עלות לכל מייל אם יסוכם במודל המהיר (הנחה: ~700 טוקנים פנימה, ~60 החוצה). המיון בשלב הזה – בלי מודל
const AI_PER_MAIL = { in: 700, out: 60 };

// ---------- state ו-PKCE (נגד CSRF ויירוט הקוד) ----------
const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sha = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
const STATE_RE = /^[A-Za-z0-9_-]{43}$/;
function newState() { const state = b64u(crypto.randomBytes(32)); return { state, hash: sha(state) }; }
function pkce() { const verifier = b64u(crypto.randomBytes(32)); return { verifier, challenge: b64u(crypto.createHash('sha256').update(verifier).digest()) }; }
function authUrl(u, o) {
  const q = new URLSearchParams({ client_id: o.clientId, redirect_uri: o.redirect, response_type: 'code', scope: o.scopes.join(' '), state: o.state,
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false', code_challenge: o.challenge, code_challenge_method: 'S256' });
  return u.auth + '?' + q.toString();
}

// ---------- הצפנת אסימונים (AES-256-GCM, מפתח נפרד לכל עסק, AAD = נתיב המסמך) – אותו מנגנון כמו המידע הרגיש (sec-sens) עם סוד נפרד ----------
function seal(secret, bizId, path, obj) {
  try { return S.seal(secret, bizId, path, obj); } catch (e) { throw noKey(e); }
}
function open(secret, bizId, path, box) {
  try { return S.open(secret, bizId, path, box); } catch (e) { throw noKey(e); }
}
function noKey(e) {
  if (e instanceof HttpsError && e.details && e.details.reason === 'no-sens-key') return new HttpsError('failed-precondition', 'מפתח ההצפנה של חיבורי Google לא מוגדר בשרת. פנו למנהל המערכת.', { reason: 'no-google-key' });
  return e;
}
const tokPath = (kind, id) => 'private/sec_g' + (kind === 'cal' ? 'c_' : 'm_') + id;
const boxIdOf = (addr) => 'gm' + sha(String(addr).toLowerCase()).slice(0, 16);

// ---------- כתובות ----------
const EMAIL_RE = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;
function addrOf(v) {
  const s = String(v == null ? '' : v).replace(/[\r\n]/g, ' ').trim();
  const m = /<([^<>\s]+)>\s*$/.exec(s);
  const a = (m ? m[1] : s).trim().toLowerCase();
  return EMAIL_RE.test(a) && !a.includes('..') ? a : '';
}
function nameOf(v) {
  const s = String(v == null ? '' : v).replace(/[\r\n]/g, ' ').trim();
  const m = /^\s*"?([^"<]*?)"?\s*<[^<>]+>\s*$/.exec(s);
  return clean(m ? m[1] : '', 60);
}
const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/g;
const clean = (v, n) => (typeof v === 'string' ? v.replace(CTRL, '').replace(/\r\n?/g, '\n').trim().slice(0, n) : '');

// ---------- פענוח מייל (Gmail API, format=full / metadata) ----------
function b64uDecode(s) { return Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64'); }
function headersOf(payload) {
  const h = {};
  for (const x of (payload && Array.isArray(payload.headers) ? payload.headers : []).slice(0, 200)) {
    if (x && typeof x.name === 'string' && typeof x.value === 'string') { const k = x.name.toLowerCase(); if (!(k in h)) h[k] = x.value.slice(0, 2000); }
  }
  return h;
}
function htmlText(s) {
  return String(s).replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n');
}
// גוף המייל: text/plain אם יש, אחרת text/html בלי תגיות. קבצים מצורפים – רק שמות (קליטת חשבוניות – שלב 7)
function bodyOf(payload) {
  let plain = '', html = '';
  const files = [];
  const att = []; // שלב 7: קבצים מצורפים להורדה (קליטת חשבוניות) – מזהה, שם, סוג וגודל מוצהרים
  const walk = (p, depth) => {
    if (!p || depth > 8) return;
    const mt = String(p.mimeType || '').toLowerCase();
    if (p.filename) {
      files.push(clean(p.filename, 120));
      if (p.body && typeof p.body.attachmentId === 'string' && /^[A-Za-z0-9_-]{1,1000}$/.test(p.body.attachmentId) && att.length < 20) att.push({ id: p.body.attachmentId, fn: clean(p.filename, 120), mime: clean(mt, 80), size: Number(p.body.size) || 0 });
      return;
    }
    if (mt === 'text/plain' && !plain && p.body && p.body.data) plain = b64uDecode(p.body.data).toString('utf8');
    else if (mt === 'text/html' && !html && p.body && p.body.data) html = b64uDecode(p.body.data).toString('utf8');
    for (const c of Array.isArray(p.parts) ? p.parts.slice(0, 50) : []) walk(c, depth + 1);
  };
  walk(payload, 0);
  const raw = plain || (html ? htmlText(html) : '');
  const text = clean(raw, TEXT_MAX + 1);
  return { text: text.slice(0, TEXT_MAX), cut: text.length > TEXT_MAX, files: files.slice(0, 20), att };
}
// שלב 7: מבנה המייל בלי התוכן (מייל גדול) – רק רשימת הקבצים המצורפים
function attOf(m) { return m && m.payload ? bodyOf(m.payload).att : []; }
// שלב 7, תיקון 1 (ליקוי 2): האם כתובת השולח מאומתת. קובעים רק לפי כותרת Authentication-Results הראשונה (העליונה), שהוסיף שרת
// הקליטה של Google (mx.google.com) – כותרת כזו שהשולח עצמו הכניס למייל נמצאת מתחתיה ולא נקראת. מאומת = dmarc=pass לדומיין שב-From,
// או dkim=pass של אותו דומיין (או דומיין־אם/תת־דומיין שלו). SPF לבד – לא מספיק. כל דבר אחר (חסר, לא ברור, נכשל) – לא מאומת.
function authOf(ar, from) {
  const dom = String(from || '').toLowerCase().split('@')[1] || '';
  const v = String(ar || '').replace(/\([^()]*\)/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!dom || !/^mx\.google\.com\s*;/.test(v)) return false;
  const al = (d) => { d = String(d || '').replace(/^@/, '').replace(/[.>"';,]+$/, ''); const at = d.lastIndexOf('@'); if (at >= 0) d = d.slice(at + 1); return d.includes('.') && (d === dom || dom.endsWith('.' + d) || d.endsWith('.' + dom)); };
  for (const c of v.split(';').slice(1)) {
    const m = /^\s*(dmarc|dkim)\s*=\s*([a-z]+)/.exec(c);
    if (!m || m[2] !== 'pass') continue;
    if (m[1] === 'dmarc') { const h = /header\.from\s*=\s*([^\s;]+)/.exec(c); if (h && h[1].replace(/[.>"']+$/, '') === dom) return true; }
    else { const h = /header\.(?:i|d)\s*=\s*([^\s;]+)/.exec(c); if (h && al(h[1])) return true; }
  }
  return false;
}
// הודעת Gmail → שדות לכרטיס (בלי מסד נתונים)
function parseMsg(m) {
  if (!m || typeof m !== 'object' || typeof m.id !== 'string') return null;
  const h = headersOf(m.payload);
  const labels = Array.isArray(m.labelIds) ? m.labelIds.filter((x) => typeof x === 'string').slice(0, 30) : [];
  const b = m.payload && (m.payload.parts || (m.payload.body && m.payload.body.data)) ? bodyOf(m.payload) : { text: '', cut: false, files: [], att: [] };
  const t = Number(m.internalDate);
  return {
    gid: m.id.slice(0, 64), thr: typeof m.threadId === 'string' ? m.threadId.slice(0, 64) : '', from: addrOf(h.from), name: nameOf(h.from), replyTo: addrOf(h['reply-to']),
    subj: clean(decodeWords(h.subject || ''), SUBJ_MAX), mid: clean(h['message-id'] || '', 300).replace(/[\r\n\s]/g, ''), t: Number.isFinite(t) && t > 0 ? t : 0,
    labels, unsub: !!h['list-unsubscribe'], size: Number(m.sizeEstimate) || 0, snippet: clean(m.snippet || '', 300), text: b.text, cut: b.cut, files: b.files,
    att: b.att || [], ctype: clean(h['content-type'] || '', 100).toLowerCase(), auth: authOf(h['authentication-results'], addrOf(h.from)),
  };
}
// כותרת בקידוד =?UTF-8?B?...?= / =?UTF-8?Q?...?=
function decodeWords(s) {
  return String(s).replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (all, cs, enc, txt) => {
    if (!/^utf-?8$/i.test(cs)) return all;
    try { return enc.toUpperCase() === 'B' ? Buffer.from(txt, 'base64').toString('utf8') : Buffer.from(txt.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (x, hh) => String.fromCharCode(parseInt(hh, 16))), 'latin1').toString('utf8'); } catch (e) { return all; }
  });
}

// ---------- סיווג (בלי מודל AI – חיסכון, 3.3) ----------
function kindOf(p) {
  if (p.labels.includes('SPAM')) return 'spam';
  if (p.labels.includes('CATEGORY_PROMOTIONS') || p.unsub) return 'promo';
  return '';
}
// "הוראה" במייל (29): פועל ציווי / פנייה למזכירה. במייל מכתובת של מנהל – חשוד ולא מבוצע (אין הבחנה בכתובות: מייל הוא מידע)
const INSTR_RE = /(^|[\s,.:;!?"'(])(ה?מזכיר[הת]|שלח[יו]?|תשלח[יו]?|העבר[יו]?|תעביר[יו]?|מחק[יו]?|תמחק[יו]?|שלמ[יו]?|תשלמ[יו]?|תזכיר[יו]?|הזכיר[יו]?|תקבע[יו]?|קבע[יו]?|אשר[יו]?|תאשר[יו]?|בטל[יו]?|תבטל[יו]?|תכניס[יו]?|הכניס[יו]?|תעננ?[יו]?|ענ[יו]|תרשמ[יו]?|רשמ[יו]?|תוסיפ[יו]?|הוסיפ[יו]?|forward|send|delete|pay|remind|schedule|approve|transfer|reply)(?=$|[\s,.:;!?"')])/i;
const isInstr = (s) => INSTR_RE.test(String(s || ''));

// ---------- מייל יוצא (RFC 2822) – כותרות בלי שורות חדשות (נגד הזרקת כותרות) ----------
const hdr = (v) => String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').trim();
const encWord = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : '=?UTF-8?B?' + Buffer.from(s, 'utf8').toString('base64') + '?=');
function mime(o) {
  const to = addrOf(o.to);
  if (!to) throw new HttpsError('invalid-argument', 'כתובת הנמען לא תקינה', { reason: 'bad-to' });
  const subj = hdr(o.subj).slice(0, SUBJ_MAX);
  const lines = ['To: ' + to, 'Subject: ' + encWord(subj), 'MIME-Version: 1.0', 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64'];
  const mid = hdr(o.inReplyTo).replace(/\s/g, '');
  if (/^<[^<>\s]{3,300}>$/.test(mid)) lines.push('In-Reply-To: ' + mid, 'References: ' + mid);
  const body = Buffer.from(String(o.text || '').replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
  return b64u(Buffer.from(lines.join('\r\n') + '\r\n\r\n' + body, 'utf8'));
}
const reSubj = (s) => { const x = hdr(s).slice(0, SUBJ_MAX - 4); return /^(re|תשובה)\s*:/i.test(x) ? x : 'Re: ' + x; };

// ---------- טווח סריקה (28) ----------
const dayIL = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
function rangeQ(range, now) {
  if (range === 'none') return null;
  if (range === 'all') return '';
  const m = Number(range);
  if (![12, 6, 1].includes(m)) return null;
  const d = new Date(now); d.setUTCMonth(d.getUTCMonth() - m);
  return 'after:' + dayIL(d.getTime()).replace(/-/g, '/');
}
const costEstimate = (n, costMc) => ({ n, aiPerMailMc: costMc('fast', AI_PER_MAIL), aiIfSummarizedMc: n * costMc('fast', AI_PER_MAIL), nowMc: 0 });

// ---------- יומן: Google ↔ האפליקציה ----------
const TZ = 'Asia/Jerusalem';
function localOf(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const s = new Date(t).toLocaleString('sv-SE', { timeZone: TZ }); // "YYYY-MM-DD HH:MM:SS"
  return { d: s.slice(0, 10), tm: s.slice(11, 16) };
}
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
function gToCal(ev) {
  if (!ev || typeof ev !== 'object' || typeof ev.id !== 'string') return null;
  const st = ev.start || {};
  let d = '', tm = '';
  if (typeof st.date === 'string' && DAY_RE.test(st.date)) d = st.date;
  else if (typeof st.dateTime === 'string') { const l = localOf(st.dateTime); if (!l) return null; d = l.d; tm = l.tm; } else return null;
  const title = clean(String(ev.summary || '').replace(/\s+/g, ' '), 120) || '(בלי כותרת)';
  return { title, d, tm, gid: ev.id.slice(0, 200), gup: Date.parse(ev.updated) || 0, lp: ev.extendedProperties && ev.extendedProperties.private && typeof ev.extendedProperties.private.lp === 'string' ? ev.extendedProperties.private.lp.slice(0, 80) : '', cancelled: ev.status === 'cancelled' };
}
const addDay = (d, k) => { const [y, m, x] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, x + k)).toISOString().slice(0, 10); };
function calToG(id, e) {
  const o = { summary: String(e.title || '').slice(0, 120), extendedProperties: { private: { lp: id } } };
  if (e.note) o.description = String(e.note).slice(0, 500);
  if (e.tm) {
    const [h, mi] = e.tm.split(':').map(Number);
    const endM = h * 60 + mi + 60, endD = endM >= 1440 ? addDay(e.d, 1) : e.d, em = endM % 1440;
    o.start = { dateTime: e.d + 'T' + e.tm + ':00', timeZone: TZ };
    o.end = { dateTime: endD + 'T' + String(Math.floor(em / 60)).padStart(2, '0') + ':' + String(em % 60).padStart(2, '0') + ':00', timeZone: TZ };
  } else { o.start = { date: e.d }; o.end = { date: addDay(e.d, 1) }; }
  return o;
}
const sameEv = (a, b) => a.title === b.title && a.d === b.d && (a.tm || '') === (b.tm || '');

// ---------- כתובות השירות. בשרת אמיתי – רק Google; באמולטור – רק שרת דמה מקומי ----------
const PROD = Object.freeze({ auth: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', revoke: 'https://oauth2.googleapis.com/revoke',
  gmail: 'https://gmail.googleapis.com/gmail/v1', cal: 'https://www.googleapis.com/calendar/v3' });
function urls() {
  const b = str(P.base, '').replace(/\/+$/, '');
  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(b)) throw new HttpsError('internal', 'באמולטור מותר לפנות רק לשרת דמה מקומי', { reason: 'emulator-outbound-blocked' });
    return { auth: b + '/o/oauth2/v2/auth', token: b + '/token', revoke: b + '/revoke', gmail: b + '/gmail/v1', cal: b + '/calendar/v3' };
  }
  if (b) throw new HttpsError('internal', 'כתובת שירות Google לא תקינה', { reason: 'bad-base' });
  return PROD;
}
function oauthCfg() {
  const clientId = str(P.clientId, ''), redirect = str(P.redirect, ''), secret = sv(GOOGLE_CLIENT_SECRET);
  if (!clientId || !secret || !/^https?:\/\//.test(redirect)) throw new HttpsError('failed-precondition', 'החיבור ל-Google עוד לא הוגדר בשרת. פנו למנהל המערכת.', { reason: 'google-not-configured' });
  if (process.env.FUNCTIONS_EMULATOR !== 'true' && !/^https:\/\//.test(redirect)) throw new HttpsError('failed-precondition', 'כתובת החזרה חייבת להיות https', { reason: 'google-not-configured' });
  return { clientId, redirect, secret };
}
const TOPIC = 'sec-gmail'; // נושא ה-Pub/Sub שאליו Gmail שולח התראות (secMailHook מאזינה לו). קבוע – אותו שם בהגדרה אצל Google
const topicName = () => 'projects/' + (process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'demo') + '/topics/' + TOPIC;

// ---------- קריאות ל-Google. בלי גוף השגיאה, בלי האסימון ----------
function gErr(reason, status) { return new HttpsError('unavailable', 'הפנייה ל-Google נכשלה. נסו שוב בעוד דקה.', { reason, status: status || 0 }); }
async function gfetch(url, opt, timeoutMs) {
  const ctl = new AbortController();
  const tm = setTimeout(() => ctl.abort(), timeoutMs || 15000);
  let r;
  try { r = await fetch(url, Object.assign({}, opt, { signal: ctl.signal, redirect: 'error' })); } catch (e) { clearTimeout(tm); throw gErr(e && e.name === 'AbortError' ? 'google-timeout' : 'google-network'); }
  try {
    const len = Number(r.headers.get('content-length'));
    if (Number.isFinite(len) && len > RESP_MAX) throw gErr('google-big', r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > RESP_MAX) throw gErr('google-big', r.status);
    let j = null; try { j = buf.length ? JSON.parse(buf.toString('utf8')) : {}; } catch (e) { j = null; }
    return { status: r.status, ok: r.ok, j };
  } finally { clearTimeout(tm); }
}
const form = (o) => new URLSearchParams(o).toString();
async function exchange(u, cfg, code, verifier) {
  const r = await gfetch(u.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: cfg.clientId, client_secret: cfg.secret, redirect_uri: cfg.redirect }) });
  if (!r.ok || !r.j || typeof r.j.access_token !== 'string') throw gErr('google-exchange', r.status);
  return { at: r.j.access_token, rt: typeof r.j.refresh_token === 'string' ? r.j.refresh_token : '', scope: typeof r.j.scope === 'string' ? r.j.scope : '' };
}
async function refresh(u, cfg, rt) {
  if (!rt) throw new HttpsError('failed-precondition', 'החיבור ל-Google פג. צריך לחבר מחדש.', { reason: 'google-expired' });
  const r = await gfetch(u.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ grant_type: 'refresh_token', refresh_token: rt, client_id: cfg.clientId, client_secret: cfg.secret }) });
  if (r.status === 400 || r.status === 401) throw new HttpsError('failed-precondition', 'החיבור ל-Google פג או בוטל. צריך לחבר מחדש.', { reason: 'google-expired' });
  if (!r.ok || !r.j || typeof r.j.access_token !== 'string') throw gErr('google-refresh', r.status);
  return r.j.access_token;
}
async function revoke(u, token) {
  if (!token) return false;
  const r = await gfetch(u.revoke, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ token }) }).catch(() => ({ ok: false }));
  return !!r.ok;
}
// לקוח עם אסימון גישה. רק הפעולות שהמזכירה צריכה – בלי מחיקה לצמיתות של מייל
function client(u, at) {
  const H = { Authorization: 'Bearer ' + at };
  const J = Object.assign({ 'Content-Type': 'application/json' }, H);
  const call = async (method, url, body, okCodes) => {
    const r = await gfetch(url, Object.assign({ method, headers: body ? J : H }, body ? { body: JSON.stringify(body) } : {}));
    if (r.status === 401) throw new HttpsError('failed-precondition', 'החיבור ל-Google פג או בוטל. צריך לחבר מחדש.', { reason: 'google-expired' });
    if (r.status === 403) throw new HttpsError('permission-denied', 'אין ל-Google הרשאה לפעולה הזו. צריך לחבר מחדש עם ההרשאה המתאימה.', { reason: 'google-scope' });
    if (!r.ok && !(okCodes || []).includes(r.status)) throw gErr(r.status === 429 ? 'google-quota' : 'google-rejected', r.status);
    return r;
  };
  const gm = u.gmail + '/users/me';
  const enc = encodeURIComponent;
  const cal = u.cal + '/calendars/primary';
  return {
    profile: async () => (await call('GET', gm + '/profile')).j || {},
    watch: async (topic) => (await call('POST', gm + '/watch', { topicName: topic, labelIds: ['INBOX'], labelFilterBehavior: 'include' })).j || {},
    stop: async () => { await call('POST', gm + '/stop', {}); return true; },
    history: async (start, pageToken) => (await call('GET', gm + '/history?' + form(Object.assign({ startHistoryId: String(start), historyTypes: 'messageAdded', labelId: 'INBOX', maxResults: '100' }, pageToken ? { pageToken } : {})), null, [404])),
    meta: async (id) => (await call('GET', gm + '/messages/' + enc(id) + '?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Message-ID&metadataHeaders=Reply-To&metadataHeaders=List-Unsubscribe&metadataHeaders=Content-Type&metadataHeaders=Authentication-Results')).j || {},
    // שלב 7: מבנה המייל בלבד (שמות ומזהי הקבצים, בלי תוכן) – למייל גדול שיש בו קבצים מצורפים; והורדת קובץ מצורף אחד
    struct: async (id) => (await call('GET', gm + '/messages/' + enc(id) + '?format=full&fields=' + enc('id,payload(mimeType,filename,body(attachmentId,size),parts(mimeType,filename,body(attachmentId,size),parts(mimeType,filename,body(attachmentId,size),parts(mimeType,filename,body(attachmentId,size)))))'))).j || {},
    att: async (id, attId) => (await call('GET', gm + '/messages/' + enc(id) + '/attachments/' + enc(attId))).j || {},
    full: async (id) => (await call('GET', gm + '/messages/' + enc(id) + '?format=full')).j || {},
    list: async (q, pageToken, max) => (await call('GET', gm + '/messages?' + form(Object.assign({ maxResults: String(max || 500), includeSpamTrash: 'true', q: (q ? q + ' ' : '') + '-in:trash' }, pageToken ? { pageToken } : {})))).j || {},
    send: async (raw, threadId) => (await call('POST', gm + '/messages/send', Object.assign({ raw }, threadId ? { threadId } : {}))).j || {},
    trash: async (id) => (await call('POST', gm + '/messages/' + enc(id) + '/trash', {})).j || {},
    calPrimary: async () => (await call('GET', cal)).j || {},
    calList: async (o) => call('GET', cal + '/events?' + form(Object.assign({ singleEvents: 'true', showDeleted: 'true', maxResults: '250' }, o.sync ? { syncToken: o.sync } : { timeMin: new Date(o.from).toISOString() }, o.page ? { pageToken: o.page } : {})), null, [410]),
    calInsert: async (ev) => (await call('POST', cal + '/events', ev)).j || {},
    calPatch: async (gid, ev) => call('PATCH', cal + '/events/' + enc(gid), ev, [404, 410]),
    calDel: async (gid) => call('DELETE', cal + '/events/' + enc(gid), null, [404, 410]),
  };
}

module.exports = {
  SC, FORBIDDEN, scopesFor, grantedOk, STATE_TTL, CONNECT_HOUR, MAX_BOX_DEFAULT, MAX_BOX_LIMIT, HOOK_DATA_MAX, RUN_MAX, DAY_IN_MAX, FULL_MAX, TEXT_MAX, SUBJ_MAX, OUT_DAY, CLEAN_MAX,
  COUNT_PAGES, SCAN_TTL, CAL_PAGES, CAL_PUSH_MAX, BIG_OLD, RANGES, AI_PER_MAIL, STATE_RE,
  newState, pkce, authUrl, sha, b64u, seal, open, tokPath, boxIdOf, addrOf, nameOf, clean, parseMsg, authOf, bodyOf, attOf, decodeWords, kindOf, isInstr, mime, reSubj, rangeQ, costEstimate,
  gToCal, calToG, sameEv, localOf, dayIL, urls, oauthCfg, topicName, TOPIC, exchange, refresh, revoke, client, SEC_GOOGLE_KEY, GOOGLE_CLIENT_SECRET, sv, EMAIL_RE,
};
