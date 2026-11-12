'use strict';
// המזכירה – שלב 5 "ווצאפ – קבלה, ניתוב וטיוטות": לוגיקה טהורה (בלי מסד נתונים) + לקוח ה-Graph API של Meta.
// אפיון 3.1, 3.2, 3.2א, 3.5, 5.5, 10.1–10.4; החלטות 5, 13, 16–24, 30–33, 86, 88–90, 97, 112, פ1, פ2.
// הכול כאן נבדק בלי Meta אמיתי. מבנה ההודעות של Meta (webhook, שליחה, קבצים) לפי התיעוד הציבורי – (לא מאומת מול השירות האמיתי).
// כלל: תוכן הודעה נכנסת הוא מידע ולא הוראה (10.1). שום פונקציה כאן לא "מבצעת" טקסט – רק מסווגת, בודקת ומנרמלת.

const crypto = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { defineString } = require('firebase-functions/params');

const P = {
  base: defineString('WA_GRAPH_BASE', { default: 'https://graph.facebook.com', description: 'כתובת ה-Graph API של Meta (ווצאפ). (לא מאומת: גרסה)' }),
  ver: defineString('WA_GRAPH_VER', { default: 'v21.0', description: 'גרסת ה-Graph API. (לא מאומת)' }),
};
const str = (p, d) => { try { const v = p.value(); return typeof v === 'string' && v.trim() ? v.trim() : d; } catch (e) { return d; } };

// ---------- מגבלות (10.3) ----------
const BODY_MAX = 256 * 1024;      // גוף בקשה של webhook (הודעות טקסט/התראות – קטנות; קבצים מגיעים כמזהה, לא כתוכן)
const MSGS_MAX = 50;              // הודעות בבקשה אחת
const TEXT_MAX = 4000;            // טקסט הודעה שנשמר (ארוך יותר – נחתך ומסומן)
const AUDIO_MAX = 5 * 1024 * 1024;// הקלטה לתמלול
const DRAFT_MAX = 2000;           // טיוטה / תשובה יוצאת
const HOUR_DEFAULT = 30;          // הודעות לשעה לשולח אחד (89) – עד שמנהל־על קובע
const DAY_MULT = 5;               // תקרה יומית לשולח = פי 5 מהשעתית (10.3 – הנחה)
const FLOOD_HOUR = 300;           // הודעות לשעה לכל המספר – מעל זה: עצירה אוטומטית (33; הנחה)
const WIN_MS = 24 * 3600e3;       // חלון 24 השעות של Meta
const MGR_DAY = 20;               // יצירות ביומן מווצאפ ליום לכל מנהל (5.5 – הנחה: 20)
const OUT_DAY = 500;              // הודעות יוצאות ליום לעסק (רשת ביטחון)
const ORD_TTL = 2 * 3600e3;       // שיחת הזמנה פתוחה – שעתיים בלי פעילות (3.2א)
const NEVER_AUTO = Object.freeze(['price', 'debt', 'pay', 'refund', 'complaint', 'other']); // 3.5: לעולם לא אוטומטי
const CLS = Object.freeze({ inv: 'חשבונית', cust: 'שאלת לקוח', sup: 'ספק', price: 'מחיר', debt: 'חוב או תשלום', pay: 'תשלום', refund: 'החזר', complaint: 'תלונה', hours: 'שעות וכתובת', order: 'הזמנה', other: 'אחר' });

// ---------- מספרי טלפון ----------
// מזהה ווצאפ = ספרות בלבד, בפורמט בינלאומי (972501234567). מספר ישראלי מקומי (050…) מומר.
function waNum(raw) {
  let p = String(raw == null ? '' : raw).trim().replace(/[\s\-().]/g, '');
  if (p.startsWith('+')) p = p.slice(1);
  if (/^0(5\d{8}|7\d{8}|[23489]\d{7})$/.test(p)) p = '972' + p.slice(1);
  return /^[1-9]\d{7,14}$/.test(p) ? p : null;
}
// להצגה: 972501234567 → 050-1234567
function waShow(n) {
  const s = String(n || '');
  if (/^9725\d{8}$/.test(s)) return '0' + s.slice(3, 5) + '-' + s.slice(5);
  if (/^972\d{8,9}$/.test(s)) return '0' + s.slice(3);
  return s ? '+' + s : '';
}
const localOf = (n) => (/^972\d{8,9}$/.test(String(n || '')) ? '0' + String(n).slice(3) : '');

// ---------- חתימה (X-Hub-Signature-256) ----------
// HMAC-SHA256 של הגוף הגולמי עם ה-App Secret, בקידוד hex, אחרי "sha256=". השוואה בזמן קבוע. בלי סוד – תמיד נדחה.
function sigOk(raw, header, secret) {
  if (!Buffer.isBuffer(raw) || typeof secret !== 'string' || !secret) return false;
  const m = /^sha256=([0-9a-f]{64})$/.exec(typeof header === 'string' ? header.trim().toLowerCase() : '');
  if (!m) return false;
  const mine = crypto.createHmac('sha256', secret).update(raw).digest();
  return crypto.timingSafeEqual(mine, Buffer.from(m[1], 'hex'));
}
function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const h = (s) => crypto.createHash('sha256').update(s, 'utf8').digest();
  return crypto.timingSafeEqual(h(a), h(b));
}
const msgId = (wamid) => 'm' + crypto.createHash('sha256').update(String(wamid), 'utf8').digest('hex').slice(0, 40);

// ---------- פענוח גוף ה-webhook ----------
// מחזיר רשימה שטוחה של הודעות נכנסות. התראות מצב (statuses) – מחזיר בנפרד (רק מזהה ומצב).
const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/g;
const cleanIn = (v, n) => (typeof v === 'string' ? v.replace(CTRL, '').replace(/\r\n?/g, '\n').trim().slice(0, n) : '');
function parseHook(body) {
  const out = { msgs: [], statuses: [] };
  if (!body || typeof body !== 'object' || body.object !== 'whatsapp_business_account' || !Array.isArray(body.entry)) return out;
  for (const e of body.entry.slice(0, 20)) {
    for (const c of (e && Array.isArray(e.changes) ? e.changes : []).slice(0, 20)) {
      const v = c && c.field === 'messages' && c.value && typeof c.value === 'object' ? c.value : null;
      if (!v) continue;
      const pnid = v.metadata && typeof v.metadata.phone_number_id === 'string' && /^\d{5,25}$/.test(v.metadata.phone_number_id) ? v.metadata.phone_number_id : null;
      if (!pnid) continue;
      const names = {};
      for (const k of Array.isArray(v.contacts) ? v.contacts.slice(0, 20) : []) if (k && typeof k.wa_id === 'string') names[k.wa_id] = cleanIn(k.profile && k.profile.name, 60);
      for (const m of Array.isArray(v.messages) ? v.messages : []) {
        if (out.msgs.length >= MSGS_MAX) break;
        if (!m || typeof m.id !== 'string' || !m.id || m.id.length > 300) continue;
        const from = waNum(m.from);
        if (!from) continue;
        const ts = Number(m.timestamp);
        const x = { pnid, wamid: m.id, from, name: names[m.from] || '', ts: Number.isFinite(ts) && ts > 0 ? ts * 1000 : 0, type: 'other', text: '' };
        if (m.type === 'text' && m.text) x.type = 'text', x.text = cleanIn(m.text.body, TEXT_MAX), x.cut = typeof m.text.body === 'string' && m.text.body.length > TEXT_MAX;
        else if (m.type === 'audio' && m.audio && typeof m.audio.id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(m.audio.id)) x.type = 'audio', x.media = { id: m.audio.id, mime: cleanIn(m.audio.mime_type, 80), voice: m.audio.voice === true };
        else if (m.type === 'button' && m.button) x.type = 'text', x.text = cleanIn(m.button.text, 200), x.btn = cleanIn(m.button.payload, 60);
        else if (m.type === 'interactive' && m.interactive) {
          const r = m.interactive.button_reply || m.interactive.list_reply || {};
          x.type = 'text'; x.text = cleanIn(r.title, 200); x.btn = cleanIn(r.id, 60);
        } else {
          x.sub = cleanIn(String(m.type || ''), 20); // תמונה/מסמך/מיקום… – נשמר כ"קובץ"
          // שלב 7: תמונה או מסמך – מזהה הקובץ אצל Meta (ההורדה רק בעיבוד, עם בדיקת גודל), לקליטת חשבוניות
          const md = (m.type === 'image' || m.type === 'document') && m[m.type] && typeof m[m.type].id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(m[m.type].id) ? m[m.type] : null;
          if (md) x.media = { id: md.id, mime: cleanIn(md.mime_type, 80), fn: cleanIn(md.filename, 120) };
        }
        out.msgs.push(x);
      }
      for (const s of Array.isArray(v.statuses) ? v.statuses.slice(0, 50) : []) if (s && typeof s.id === 'string' && typeof s.status === 'string') out.statuses.push({ pnid, wamid: s.id, st: cleanIn(s.status, 20) });
    }
  }
  return out;
}

// ---------- ניתוב (3.2א) – בקוד, לפי כללים קבועים. התוכן לא יכול לנתב את עצמו מעבר לכללים האלה ----------
// 1. מספר המנהל → 'mgr'. 2. שיחת הזמנה פתוחה → 'ord'. 3. פתיחת הזמנה (כפתור / מילת מפתח) → 'ord'. 4. כל השאר → 'sec'.
// כללים 2–3 פעילים רק כשבוט ההזמנות מחובר (ordOn) – היום הוא לא קיים, ולכן הכול הולך למזכירה.
const ORD_BTN = 'ORDER';
const ORD_KW = /^\s*(הזמנה|להזמין|הזמנה חדשה|order)\s*[.!?]?\s*$/i;
function routeOf(o) {
  if (o.mgrUid) return 'mgr';
  if (o.ordOn) {
    const s = o.snd || {};
    if (s.own === 'ord' && Number(s.ownExp) > o.now) return 'ord';
    if (o.btn === ORD_BTN || ORD_KW.test(o.text || '')) return 'ord';
  }
  return 'sec';
}

// ---------- "תוכן חשוד" (10.1 סעיף 5, 88): ניסיון גלוי לתת הוראות למזכירה / למודל ----------
const SUS = [
  /התעלמ[יו]?\s*(מ|מכל\s*)?(ה)?(הוראות|הנחיות|כללים)/, /(הוראות|הנחיות)\s*(קודמות|המערכת)/, /(את|אתה|לך)\s*(ה)?מזכיר(ה|ת)\s*[,:]?\s*(שלח|תשלח|תעביר|העביר|תני|תן|תגל)/,
  /(שלח|תשלח|תשלחי|העבר|תעביר|תעבירי)\s*(לי|אלי)\s*(את\s*)?(רשימת|כל|ה?נתונים|ה?סיסמ|פרטי)/, /(מצב|הרשאות)\s*(מנהל|אדמין|מפתח)/, /system\s*prompt/i,
  /ignore\s+(all\s+|the\s+)?(previous|prior|above)\s+(instructions|rules)/i, /you\s+are\s+now\s+/i, /disregard\s+(your|all)\s+/i, /\b(jailbreak|developer\s+mode)\b/i,
  /(ספקים|לקוחות|עובדים)\s*(ו|וה)?(חובות|יתרות|משכורות|טלפונים)/, /(סיסמה|סיסמא|קוד\s*אימות|password)/i,
];
const susOf = (text) => SUS.some((r) => r.test(String(text || '')));

// ---------- שפה (5): לפי סוג האותיות ----------
function langOf(text) {
  const s = String(text || '');
  const c = (re) => (s.match(re) || []).length;
  const he = c(/[֐-׿]/g), ar = c(/[؀-ۿ]/g), ru = c(/[Ѐ-ӿ]/g), la = c(/[A-Za-z]/g);
  const max = Math.max(he, ar, ru, la);
  if (!max) return 'he';
  return max === he ? 'he' : max === ar ? 'ar' : max === ru ? 'ru' : 'en';
}
const LANGS = Object.freeze({ he: 'עברית', ar: 'ערבית', ru: 'רוסית', en: 'אנגלית' });

// ---------- "מספר המנהל" (112, פ1, 86): מה מותר ----------
// יומן ותזכורות בלבד. רשימה סגורה: רק הודעה שמתחילה במפורש בבקשת יומן/תזכורת היא 'cal'. כל השאר (גם שפה אחרת, "תכיני דוח",
// "אשר את ההזמנה") – תשובה קבועה, בלי שום כלי ובלי פנייה למודל (ליקוי 1, סבב 1 של שלב 5).
// יצירה ("תזכירי לי לשלם לספק") – 'cal' גם עם מילת כספים, אלא אם זו שאלה ("כמה", "מה ה…"). קריאה ("מה יש לי היום…") עם מילת כספים – 'fin'.
const CAL_NEW_RE = /^\s*(תזכיר[יו]?|תזכורת|הזכיר[יו]|תקבע[יו]?|קבע[יו]?|תרשמ[יו]?\s*ביומן|רשמ[יו]?\s*ביומן)(?![֐-׿])/;
const CAL_READ_RE = /^\s*(מה\s*יש\s*(לי\s*)?(ב?יומן|היום|מחר|השבוע)|מתי\s*(יש\s*לי|ה?פגישה)|יומן|פגישה)(?![֐-׿])/;
const FIN_RE = /(כסף|כספ|הכנס|הוצא|רווח|הפסד|שכר|משכור|תלוש|יתר[הת]|חוב|תזרים|מחזור|קופה|בנק|מע"?מ|חשבוני|מכירות|עלויות|תקציב|הלווא|מס\s|מיסים|₪|שקל|revenue|income|salar|payroll|profit|bank|balance|money|cash)/i;
const FIN_Q_RE = /(כמה|מה\s*(ה|זה|היה|היו|יש|המצב)|מהו|מהי|האם|how\s*much|what|\?)/i;
const ACT_RE = /(שלח|תשלח|תשלחי|תעני|לענות|תעננ|תכניס|להכניס|תשלמ|לשלם|תמחק|למחוק|תעביר|להעביר|תזמינ|להזמין|ספק|עובד|לקוח|תתקשר|תודיע|תפרסמ|תאשר|לאשר|אשר|תבטל|לבטל|תשנ|לשנות|דוח|משימ|הזמנ)/;
function mgrIntent(text) {
  const s = String(text || '');
  const fin = FIN_RE.test(s);
  if (CAL_NEW_RE.test(s)) return fin && FIN_Q_RE.test(s) ? 'fin' : 'cal';
  if (CAL_READ_RE.test(s)) return fin ? 'fin' : ACT_RE.test(s.replace(CAL_READ_RE, '')) ? 'act' : 'cal';
  return fin ? 'fin' : 'act';
}
const MGR_FIXED = Object.freeze({
  fin: 'נתוני כספים – רק באפליקציה. בווצאפ אפשר לשאול על היומן והתזכורות, ולבקש תזכורת או אירוע ביומן.',
  act: 'לביצוע – בצ\'אט באפליקציה. בווצאפ אפשר רק לשאול על היומן והתזכורות, ולבקש תזכורת או אירוע ביומן.',
  off: 'כרגע לא ניתן לטפל בבקשה. אפשר להמשיך בצ\'אט באפליקציה.',
  inv: 'הקובץ התקבל ונשלח לתור החשבוניות. אפשר לראות אותו באפליקציה, במסך "חשבוניות שהתקבלו".',
  invErr: 'הקובץ לא נקלט בגלל תקלה. אפשר לשלוח אותו שוב או להעלות אותו באפליקציה.',
});

// ---------- בדיקת טיוטה לפונה מבחוץ (10.1 סעיף 4, 90): נתון פנימי → "לבדוק" ----------
// מספר בטיוטה שלא הופיע במקורות המותרים (ההודעה עצמה, מידע לפונים מבחוץ, מחירון) → לבדוק. שם עובד בטיוטה → לבדוק.
const numsOf = (s) => (String(s || '').match(/\d[\d,.]*\d|\d/g) || []).map((x) => x.replace(/,/g, '').replace(/\.$/, ''));
function draftCheck(draft, allowedText, staffNames) {
  const allow = new Set(numsOf(allowedText));
  const why = [];
  for (const n of numsOf(draft)) if (!allow.has(n) && !(n.length <= 1)) { why.push('מספר שלא מופיע במידע לפונים מבחוץ: ' + n); break; }
  const d = ' ' + String(draft || '').replace(/[^֐-׿A-Za-z0-9 ]+/g, ' ') + ' ';
  for (const nm of staffNames || []) {
    const w = String(nm || '').trim();
    if (w.length >= 2 && d.includes(' ' + w + ' ')) { why.push('שם של עובד'); break; }
  }
  return why;
}

// ---------- חלון 24 השעות ----------
const inWindow = (lastIn, now) => Number.isFinite(lastIn) && lastIn > 0 && now - lastIn < WIN_MS;
const winLeft = (lastIn, now) => (inWindow(lastIn, now) ? WIN_MS - (now - lastIn) : 0);

// ---------- שעות "קיבלנו" (22): ביום עסקים בלבד, מחוץ לשעות העבודה ----------
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
function hmOf(ms, tz) { return new Date(ms).toLocaleTimeString('en-GB', { timeZone: tz || 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false }); }
function outsideHours(now, hours, bizDayFn, dayOf) {
  const h = hours && TIME_RE.test(hours.f) && TIME_RE.test(hours.t) ? hours : { f: '08:00', t: '18:00' };
  if (!bizDayFn(dayOf(now))) return { ok: false, why: 'off-day' }; // שישי/שבת/חג – לא שולחים (22)
  const x = hmOf(now);
  const inside = h.f < h.t ? x >= h.f && x < h.t : x >= h.f || x < h.t;
  return { ok: !inside, why: inside ? 'in-hours' : '' };
}

// ---------- לקוח Graph API (שליחה, קבצים). המפתח לא יוצא לשום מקום מלבד Meta, ולא מופיע בשגיאות ----------
function baseOf() {
  const base = str(P.base, 'https://graph.facebook.com').replace(/\/+$/, '');
  const emu = process.env.FUNCTIONS_EMULATOR === 'true';
  if (emu ? !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base) : base !== 'https://graph.facebook.com') {
    throw new HttpsError('internal', 'כתובת שירות ווצאפ לא תקינה', { reason: emu ? 'emulator-outbound-blocked' : 'bad-base' });
  }
  return base;
}
const verOf = () => { const v = str(P.ver, 'v21.0'); return /^v\d{1,3}\.\d{1,2}$/.test(v) ? v : 'v21.0'; };
// קבצים – רק משרתי Meta (10.3: רשימה סגורה), כדי שהמפתח לא יישלח לכתובת זרה. (לא מאומת: רשימת השרתים המלאה)
const MEDIA_HOSTS = ['lookaside.fbsbx.com'];
function mediaUrlOk(u) {
  let x; try { x = new URL(u); } catch (e) { return false; }
  if (process.env.FUNCTIONS_EMULATOR === 'true') return x.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(x.hostname);
  return x.protocol === 'https:' && MEDIA_HOSTS.includes(x.hostname) && !x.username && !x.password;
}
function waErr(reason, status) { const e = new HttpsError('unavailable', 'השליחה לווצאפ נכשלה. נסו שוב בעוד דקה.', { reason, status: status || 0 }); return e; }
async function gfetch(url, opt, timeoutMs) {
  const ctl = new AbortController();
  const tm = setTimeout(() => ctl.abort(), timeoutMs || 15000);
  try { return await fetch(url, Object.assign({}, opt, { signal: ctl.signal, redirect: 'error' })); } catch (e) { throw waErr(e && e.name === 'AbortError' ? 'wa-timeout' : 'wa-network'); } finally { clearTimeout(tm); }
}
// payload: { text } או { tpl: { name, lang } }. מחזיר { wamid }
async function send(token, pnid, to, payload) {
  if (!token) throw new HttpsError('failed-precondition', 'ווצאפ לא מחובר בשרת', { reason: 'no-wa-token' });
  if (!/^\d{5,25}$/.test(String(pnid)) || !waNum(to)) throw new HttpsError('invalid-argument', 'נמען לא תקין', { reason: 'bad-to' });
  const body = { messaging_product: 'whatsapp', recipient_type: 'individual', to: String(to) };
  if (payload.tpl) Object.assign(body, { type: 'template', template: { name: payload.tpl.name, language: { code: payload.tpl.lang || 'he' } } });
  else Object.assign(body, { type: 'text', text: { body: String(payload.text).slice(0, DRAFT_MAX), preview_url: false } });
  const r = await gfetch(`${baseOf()}/${verOf()}/${pnid}/messages`, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) { try { await r.arrayBuffer(); } catch (e) { /* */ } throw waErr(r.status === 429 ? 'wa-quota' : 'wa-rejected', r.status); } // בלי גוף השגיאה (עלול להכיל פרטים)
  let j = null; try { j = await r.json(); } catch (e) { j = null; }
  const id = j && Array.isArray(j.messages) && j.messages[0] && typeof j.messages[0].id === 'string' ? j.messages[0].id.slice(0, 300) : '';
  return { wamid: id };
}
// הורדת קובץ (הודעה קולית): קודם הכתובת מ-Meta, ואז הקובץ – רק אם הכתובת בשרתי Meta ובגודל מותר
async function media(token, mediaId, max) {
  if (!token) throw new HttpsError('failed-precondition', 'ווצאפ לא מחובר בשרת', { reason: 'no-wa-token' });
  const lim = max || AUDIO_MAX;
  const r = await gfetch(`${baseOf()}/${verOf()}/${encodeURIComponent(mediaId)}`, { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) throw waErr('wa-media', r.status);
  const j = await r.json().catch(() => null);
  if (!j || typeof j.url !== 'string' || !mediaUrlOk(j.url)) throw waErr('wa-media-host');
  if (Number(j.file_size) > lim) throw waErr('wa-media-big');
  const f = await gfetch(j.url, { headers: { Authorization: 'Bearer ' + token } }, 20000);
  if (!f.ok) throw waErr('wa-media', f.status);
  const len = Number(f.headers.get('content-length'));
  if (Number.isFinite(len) && len > lim) throw waErr('wa-media-big');
  const buf = Buffer.from(await f.arrayBuffer());
  if (buf.length > lim || !buf.length) throw waErr('wa-media-big');
  const mime = String(j.mime_type || f.headers.get('content-type') || 'audio/ogg').split(';')[0].trim().slice(0, 60);
  return { buf, mime: /^audio\/[a-z0-9.+-]+$/i.test(mime) ? mime : 'audio/ogg' };
}

module.exports = {
  BODY_MAX, MSGS_MAX, TEXT_MAX, AUDIO_MAX, DRAFT_MAX, HOUR_DEFAULT, DAY_MULT, FLOOD_HOUR, WIN_MS, MGR_DAY, OUT_DAY, ORD_TTL, ORD_BTN, NEVER_AUTO, CLS, LANGS, MGR_FIXED, TIME_RE,
  waNum, waShow, localOf, sigOk, sameSecret, msgId, parseHook, routeOf, susOf, langOf, mgrIntent, FIN_RE, draftCheck, numsOf, inWindow, winLeft, outsideHours, hmOf,
  send, media, mediaUrlOk, baseOf,
};
