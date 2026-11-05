'use strict';
// מנוע הקול – נקודת ההחלפה היחידה. זה הקובץ היחיד (חוץ מ-yemot-client.js) שמכיר סיומות קבצים ואת סוג ההעלאה.
// שני מנועים:
//   'elevenlabs' (ברירת המחדל, VOICE_ENGINE): הקול המשוכפל של בעל העסק. render מחזיר { ext:'wav', kind:'audio', body:<mp3> },
//                ההעלאה לימות ב-UploadFile עם convertAudio=1 ונתיב שמסתיים ב-.wav (api-55).
//   'yemot-tts': הקול הממוחשב של ימות (קובץ tts). נבחר כשהמשתמש בוחר "שלח בקול הממוחשב" (engine:'tts' בבקשה), או כש-VOICE_ENGINE=yemot-tts.
// אין מעבר אוטומטי בין המנועים: כשל או תקרה ב-ElevenLabs = VoiceError, והמשתמש מחליט (החלטת המשתמש 02.11).
// גבול חודשי: מונה תווים ב-Firestore (voice_usage/m-YYYY-MM, לפי שעון ישראל). חריגה = לא פונים ל-ElevenLabs.
// מטמון: כל שמע שנוצר נשמר ב-Storage (voice_cache/<hash>.mp3) לפי hash של הטקסט המעובד וההגדרות,
//         כדי ש"שמע קודם" ושליחה של אותו נוסח (או ניסיון חוזר) לא ישלמו פעמיים.
// המפתח של ElevenLabs רק בכספת (ELEVENLABS_API_KEY), נשלח רק בכותרת xi-api-key. לא ביומן, לא ברשומה, לא בתשובה.
// המתקשרים תמיד עושים await ל-render.

const crypto = require('node:crypto');
const { defineSecret, defineString, defineInt } = require('firebase-functions/params');
const { HttpsError } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const client = require('./yemot-client');

const ELEVENLABS_API_KEY = defineSecret('ELEVENLABS_API_KEY');
const P = {
  engine: defineString('VOICE_ENGINE', { default: 'elevenlabs', description: 'מנוע הקול להקראות בקו: elevenlabs (הקול המשוכפל) או yemot-tts (הקול הממוחשב של ימות)' }),
  voiceId: defineString('ELEVENLABS_VOICE_ID', { default: 'B0rytFMCoK8EmM1samtX', description: 'מזהה הקול המשוכפל ב-ElevenLabs (לא סוד)' }),
  model: defineString('ELEVENLABS_MODEL', { default: 'eleven_v3', description: 'מודל ההקראה של ElevenLabs' }),
  lang: defineString('ELEVENLABS_LANGUAGE', { default: 'he', description: 'קוד השפה שנשלח ל-ElevenLabs' }),
  speed: defineString('ELEVENLABS_SPEED', { default: '0.9', description: 'מהירות דיבור (1 = רגיל, פחות = איטי יותר). (לא מאומת: שם השדה והטווח)' }),
  base: defineString('ELEVENLABS_API_BASE', { default: 'https://api.elevenlabs.io', description: 'כתובת ה-API של ElevenLabs (בבדיקות: שרת דמה מקומי)' }),
  format: defineString('ELEVENLABS_OUTPUT_FORMAT', { default: 'mp3_44100_64', description: 'פורמט השמע שחוזר מ-ElevenLabs' }),
  monthly: defineInt('ELEVENLABS_MONTHLY_CHARS', { default: 36000, description: 'תקרת תווים חודשית (שעון ישראל). מתחת למכסת המסלול' }),
  timeoutMs: defineInt('ELEVENLABS_TIMEOUT_MS', { default: 45000, description: 'זמן המתנה מרבי לבקשה ל-ElevenLabs' }),
  previewDaily: defineInt('VOICE_PREVIEW_DAILY', { default: 30, description: '"שמע קודם" בקול האמיתי: פניות ל-ElevenLabs ביום לכל משתמש' }),
  previewDailyChars: defineInt('VOICE_PREVIEW_DAILY_CHARS', { default: 3000, description: '"שמע קודם" בקול האמיתי: תווים ביום לכל משתמש' }),
  previewMonthly: defineInt('VOICE_PREVIEW_MONTHLY_CHARS', { default: 10000, description: '"שמע קודם": תקרת תווים חודשית לכל ההשמעות (חלק מהתקרה הכוללת, כדי שההשמעות לא יגמרו את המכסה של השליחות)' }),
  cacheHours: defineInt('VOICE_CACHE_HOURS', { default: 48, description: 'כמה שעות נשמר שמע במטמון (תצוגה מקדימה ← שליחה)' }),
  cacheBucket: defineString('VOICE_CACHE_BUCKET', { default: '', description: 'bucket למטמון השמע. ריק = ברירת המחדל של הפרויקט' }),
};
// ערך הגדרה, עם ברירת מחדל גם כשהסביבה לא הזריקה ערך (למשל בתוך תהליך בדיקה)
const str = (p, d) => { const v = p.value(); return typeof v === 'string' && v.trim() ? v.trim() : d; };
const int = (p, d) => { const v = p.value(); return Number.isInteger(v) && v > 0 ? v : d; };

const VOICE_ENGINE = 'elevenlabs';
const ENGINES = ['elevenlabs', 'yemot-tts'];
let textExt = 'tts';
const USAGE = 'voice_usage';
const CACHE_PREFIX = 'voice_cache/';
const TZ = 'Asia/Jerusalem';

class VoiceError extends Error {
  // code: 'unavailable' | 'quota' | 'preview-limit' | 'off'. detail: סיבה פנימית ליומן (network, timeout, http-401...) – בלי טקסט מהשירות.
  constructor(code, detail, extra) { super('voice:' + code); this.code = code; this.detail = detail || code; Object.assign(this, extra || {}); }
}

function settings() {
  const sp = Number(str(P.speed, '0.9'));
  return {
    voiceId: str(P.voiceId, 'B0rytFMCoK8EmM1samtX'), model: str(P.model, 'eleven_v3'), lang: str(P.lang, 'he'),
    // (לא מאומת) הטווח המותר של speed. ערך מחוץ ל-0.7–1.2 נחתך, כדי שהבקשה לא תידחה.
    speed: Number.isFinite(sp) ? Math.min(1.2, Math.max(0.7, sp)) : 0.9,
    format: str(P.format, 'mp3_44100_64'), timeoutMs: int(P.timeoutMs, 45000), monthly: int(P.monthly, 36000),
    previewDaily: int(P.previewDaily, 30), previewDailyChars: int(P.previewDailyChars, 3000), previewMonthly: int(P.previewMonthly, 10000),
  };
}
// המנוע המוגדר בשרת
function configuredEngine() { const e = str(P.engine, VOICE_ENGINE); return ENGINES.includes(e) ? e : VOICE_ENGINE; }
// המנוע לבקשה: בלי שדה = המוגדר; 'tts' = הקול הממוחשב (בחירה מפורשת של המשתמש). ערך אחר = null (קלט לא תקין).
function pickEngine(requested) {
  if (requested === undefined || requested === null) return configuredEngine();
  return requested === 'tts' ? 'yemot-tts' : null;
}
const extFor = (engine) => (engine === 'yemot-tts' ? textExt : 'wav');

// ---------------- תאריכים (שעון ישראל) ----------------
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d || new Date());
const monthKey = (d) => ymd(d).slice(0, 7);

// ---------------- כתובת השירות ----------------
const LOCAL = ['127.0.0.1', 'localhost', '[::1]'];
function elevenBase(raw) {
  const base = String(raw || '').replace(/\/+$/, '') + '/';
  let u; try { u = new URL(base); } catch (e) { throw new VoiceError('unavailable', 'bad-base'); }
  // באמולטור מותר לפנות רק לשרת דמה מקומי, אף פעם לא ל-ElevenLabs האמיתי
  if (process.env.FUNCTIONS_EMULATOR === 'true' && !LOCAL.includes(u.hostname)) throw new VoiceError('unavailable', 'emulator-non-local');
  if (u.protocol !== 'https:' && !LOCAL.includes(u.hostname)) throw new VoiceError('unavailable', 'insecure-base');
  return base;
}

// ---------------- מטמון השמע (Storage) ----------------
let store = null; // לבדיקות אפשר להחליף (_test.setStore). ברירת מחדל: Storage
function defaultStore() {
  const { getStorage } = require('firebase-admin/storage');
  const bucket = () => { const n = str(P.cacheBucket, ''); return n ? getStorage().bucket(n) : getStorage().bucket(); };
  return {
    async get(name) {
      const f = bucket().file(CACHE_PREFIX + name);
      const [ok] = await f.exists();
      if (!ok) return null;
      const [meta] = await f.getMetadata();
      const at = Date.parse((meta.metadata && meta.metadata.createdAt) || meta.timeCreated || '');
      if (!Number.isFinite(at) || Date.now() - at > int(P.cacheHours, 48) * 3600000) return null;
      const [buf] = await f.download();
      return buf;
    },
    async put(name, buf) {
      await bucket().file(CACHE_PREFIX + name).save(buf, { resumable: false, contentType: 'audio/mpeg', metadata: { metadata: { createdAt: new Date().toISOString() } } });
    },
    async clean(maxAgeMs) {
      const [files] = await bucket().getFiles({ prefix: CACHE_PREFIX });
      let removed = 0;
      for (const f of files) {
        const m = f.metadata || {};
        const at = Date.parse((m.metadata && m.metadata.createdAt) || m.timeCreated || '');
        if (!Number.isFinite(at) || Date.now() - at > maxAgeMs) { await f.delete({ ignoreNotFound: true }); removed++; }
      }
      return removed;
    },
  };
}
const cache = () => store || (store = defaultStore());
// hash של מה שבאמת נשלח לשירות: הטקסט המעובד (אחרי ניקוי ומילון) וכל ההגדרות שמשפיעות על השמע
function cacheKey(text, s) {
  return crypto.createHash('sha256').update(JSON.stringify(['v1', text, s.voiceId, s.model, s.lang, s.speed, s.format])).digest('hex');
}
async function cacheGet(name) {
  try { return await cache().get(name + '.mp3'); } catch (e) { logger.warn('voice: cache read failed', { reason: 'cache-read' }); return null; }
}
async function cachePut(name, buf) {
  try { await cache().put(name + '.mp3', buf); } catch (e) { logger.warn('voice: cache write failed', { reason: 'cache-write' }); }
}
// ניקוי לילי של המטמון (נקרא מ-expirePromosOnLine)
async function cleanCache() {
  try { return { removed: await cache().clean(int(P.cacheHours, 48) * 3600000) }; } catch (e) { logger.warn('voice: cache clean failed', { reason: 'cache-clean' }); return { error: 'cache-clean' }; }
}

// ---------------- הקלטה מהטלפון: WAV PCM 16 ביט, מונו, 8000Hz (משימה 2026-11-02 חוזה 5.7; הועבר לכאן מ-yemot-line.js) ----------------
// משותף להקלטה בשלוחות (publishLineItem) ולמבצע מוקלט (sendPromoToLine). האורך מחושב מגודל הנתונים בקובץ, לא משדה שהטלפון שולח.
const badRec = (reason, message, extra) => new HttpsError('invalid-argument', message, Object.assign({ reason }, extra || {}));
const badAudio = () => badRec('bad-audio', 'ההקלטה לא בפורמט הנכון. הקליטו שוב.');
const tooLong = (maxSec) => badRec('audio-too-long', `ההקלטה ארוכה מדי (עד ${maxSec} שניות).`, { max: maxSec });
function parseWav(buf, maxSec) {
  if (buf.length < 44 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WAVE') throw badAudio();
  let off = 12, fmt = null, dataSize = -1;
  while (off + 8 <= buf.length) {
    const id = buf.toString('latin1', off, off + 4), size = buf.readUInt32LE(off + 4), body = off + 8;
    if (body + size > buf.length) throw badAudio();
    if (id === 'fmt ' && size >= 16) fmt = { format: buf.readUInt16LE(body), channels: buf.readUInt16LE(body + 2), rate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    if (id === 'data') { dataSize = size; break; }
    off = body + size + (size % 2);
  }
  if (!fmt || fmt.format !== 1 || fmt.channels !== 1 || fmt.rate !== 8000 || fmt.bits !== 16 || dataSize <= 0) throw badAudio();
  const sec = dataSize / 16000;
  if (sec > maxSec) throw tooLong(maxSec);
  return Math.round(sec * 10) / 10;
}
// audio = { mimeType:'audio/wav', data:<base64> } מהטלפון. מחזיר { buf, durationSec } או זורק שגיאה בעברית (invalid-argument).
function readRecording(audio, maxSec, maxBytes) {
  if (!audio || typeof audio !== 'object' || Array.isArray(audio) || audio.mimeType !== 'audio/wav' || typeof audio.data !== 'string') throw badAudio();
  if (audio.data.length > Math.ceil(maxBytes / 3) * 4) throw tooLong(maxSec);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(audio.data)) throw badAudio();
  const buf = Buffer.from(audio.data, 'base64');
  return { buf, durationSec: parseWav(buf, maxSec) };
}

// ---------------- שמע שמור של הודעות בקו (Storage: line_audio/, רק השרת) – משימה 2026-11-04, חוזה 5.3 ----------------
// עותק של מה שעלה לקו (הקלטה = ה-WAV; קול משוכפל = ה-mp3), או גיבוי שהורד מהקו לפני החלפה.
// אותו bucket כמו המטמון. כללי Storage לא משתנים (הכלל האחרון סוגר הכול לטלפון). לא נוגע ב-voice_cache/.
const LINE_PREFIX = 'line_audio/';
const LINE_REL_RE = /^(items|promos|backups)\/[A-Za-z0-9_-]{1,80}\.(wav|mp3)$/;
let lineStore = null; // לבדיקות אפשר להחליף (_test.setLineStore)
function defaultLineStore() {
  const { getStorage } = require('firebase-admin/storage');
  const bucket = () => { const n = str(P.cacheBucket, ''); return n ? getStorage().bucket(n) : getStorage().bucket(); };
  return {
    async put(full, buf, mime, meta) { await bucket().file(full).save(buf, { resumable: false, contentType: mime, metadata: { metadata: meta } }); },
    async size(full) {
      const f = bucket().file(full);
      const [ok] = await f.exists();
      if (!ok) return null;
      const [m] = await f.getMetadata();
      return Number(m.size);
    },
    // שלב 5: קריאה (האזנה / החזרה), רשימה ומחיקה (ניקוי לילי) – רק בתוך line_audio/ (הבדיקה בפונקציות שלמטה)
    async get(full) {
      const f = bucket().file(full);
      const [ok] = await f.exists();
      if (!ok) return null;
      return (await f.download())[0];
    },
    async list() {
      const [files] = await bucket().getFiles({ prefix: LINE_PREFIX });
      const out = [];
      for (const f of files) {
        // createdAt שלנו (metadata), ואם הרשימה לא החזירה אותו – קריאה של הפרטים (באמולטור הרשימה לא כוללת metadata)
        let m = f.metadata || {};
        if (!(m.metadata && m.metadata.createdAt)) { try { [m] = await f.getMetadata(); } catch (e) { /* */ } }
        out.push({ name: f.name, createdAt: (m.metadata && m.metadata.createdAt) || m.timeCreated || null });
      }
      return out;
    },
    async del(full) { await bucket().file(full).delete({ ignoreNotFound: true }); },
  };
}
const lineAudio = () => lineStore || (lineStore = defaultLineStore());
// מה נשמר מתוך מה שעלה לקו: הקלטה ← wav; קול משוכפל ← mp3; קול ממוחשב (קובץ טקסט) ← כלום (הטקסט ברשומה).
function savedAudioOf(rendered) {
  if (!rendered || rendered.kind !== 'audio' || !Buffer.isBuffer(rendered.body) || !rendered.body.length) return null;
  return rendered.mime === 'audio/mpeg' ? { ext: 'mp3', mime: 'audio/mpeg', buf: rendered.body } : { ext: 'wav', mime: 'audio/wav', buf: rendered.body };
}
// rel: 'items/<id>.wav' וכו'. מחזיר את השדות לרשומה. כשל = זורק (המתקשר מחליט: אזהרה, או "אין גיבוי – לא מחליפים").
async function saveLineAudio(rel, buf, mime, ref) {
  if (!LINE_REL_RE.test(String(rel)) || !Buffer.isBuffer(buf) || !buf.length) throw new Error('voice: bad line audio');
  const full = LINE_PREFIX + rel;
  const at = new Date().toISOString();
  await lineAudio().put(full, buf, mime, { ref: ref || rel.replace(/\.[a-z0-9]+$/, ''), createdAt: at });
  return { audioPath: full, audioMime: mime, audioBytes: buf.length, audioSavedAt: at, audioError: null };
}
// גודל הקובץ השמור (בתים), או null אם אינו קיים. רק בתוך line_audio/.
async function lineAudioSize(full) {
  if (typeof full !== 'string' || !full.startsWith(LINE_PREFIX) || !LINE_REL_RE.test(full.slice(LINE_PREFIX.length))) return null;
  return lineAudio().size(full);
}
// שלב 5 (חוזה 5.5.4, 5.5.7, 5.5.8): קריאה, רשימה ומחיקה – רק נתיב מלא בתוך line_audio/ שעובר את LINE_REL_RE. אחר ← null / לא נמחק.
const lineOk = (full) => typeof full === 'string' && full.startsWith(LINE_PREFIX) && LINE_REL_RE.test(full.slice(LINE_PREFIX.length));
async function readLineAudio(full) { return lineOk(full) ? lineAudio().get(full) : null; }
async function listLineAudio() { return (await lineAudio().list()).filter((f) => f && typeof f.name === 'string' && f.name.startsWith(LINE_PREFIX)); }
// מחיקה: רק שם שתואם בדיוק את התבנית של הניקוי (חוזה 5.5.8: מזהה של 8-80 תווים). אחר – זורק, ולא נמחק כלום.
const PURGE_RE = /^line_audio\/(items|promos|backups)\/[A-Za-z0-9_-]{8,80}\.(wav|mp3)$/;
async function deleteLineAudio(full) {
  if (!PURGE_RE.test(String(full))) throw new Error('voice: refuse delete outside line_audio');
  await lineAudio().del(full);
}

// קובץ שמע בקו (ולא קובץ טקסט שימות מקריא): לפי הסיומת.
const isAudioFile = (file) => ['wav', 'mp3'].includes(extOf(file).toLowerCase());
// שלב 5: קובץ טקסט שימות מקריא (הסיומת של הקול הממוחשב)
const isTextFile = (file) => extOf(file).toLowerCase() === textExt;
// שלב 5: קובץ תוכן שאפשר להשמיע באפליקציה (שמע, או טקסט להקראה): NNN.<wav|mp3|הטקסט> או M1000.<wav|הטקסט>
function isListenable(file) {
  const f = typeof file === 'string' ? file : '';
  if (!/^(\d{3}|M1000)\.[A-Za-z0-9]{1,5}$/.test(f)) return false;
  const e = extOf(f).toLowerCase();
  return f.startsWith('M1000.') ? ['wav', textExt].includes(e) : ['wav', 'mp3', textExt].includes(e);
}
// שלב 5 (חוזה 5.5.5): הנתיב היחיד שמותר למחוק לפי שם – ivr2:<1-4>/NNN.<סיומת מהרשימה הסגורה> (כולל 000). אף פעם לא תיקייה, ext.ini, M* או שורש.
function isSafeFilePath(p) {
  const m = /^ivr2:([1-4])\/(\d{3}\.[A-Za-z0-9]{1,5})$/.exec(typeof p === 'string' ? p : '');
  return !!m && isDeletableContent(m[2]);
}
// שלב 5: התוכן להחזרת קובץ ותיק לשמו המקורי (voice.upload) – טקסט או שמע, לפי הסיומת המקורית
function legacyRendered(file, content) {
  if (isTextFile(file)) return { ext: extOf(file), kind: 'text', body: String(content) };
  return { ext: extOf(file), kind: 'audio', body: content, mime: 'audio/wav' };
}

// ---------------- גבול חודשי ומגבלה יומית ----------------
// ריבוי עסקים: מוני הקול בתוך העסק (בשורש ללארג' פעמי במצב legacy)
function db() { return require('./tenant').tdb(); }
// שומר מקום ל-n תווים בחודש הנוכחי. חריגה (גם "כמעט": אין מקום לטקסט הזה) = VoiceError('quota'), בלי פנייה לשירות.
// שומר מקום ל-n תווים, בטרנזקציה אחת, לפני הפנייה לשירות:
//   * תקרה כוללת (חודש, שעון ישראל). חריגה ("אין מקום לטקסט הזה") = VoiceError('quota').
//   * "שמע קודם" בלבד: תת-תקרה חודשית להשמעות (previewChars), ומגבלה יומית לכל משתמש – מספר השמעות ותווים.
//     חריגה = VoiceError('preview-limit'). כך ההשמעות לא יכולות לגמור את המכסה של השליחות.
// בקשה שנדחתה – לא נספרת בשום מונה (חוץ מסימון capHitAt).
const num = (d, f) => (d && d.exists && Number(d.get(f))) || 0;
async function reserve(n, s, o) {
  const month = monthKey(), day = ymd();
  const mref = db().doc(`${USAGE}/m-${month}`);
  const pref = o && o.preview ? db().doc(`${USAGE}/p-${o.uid}`) : null;
  const r = await db().runTransaction(async (tx) => {
    const d = await tx.get(mref);
    const p = pref ? await tx.get(pref) : null;
    const used = num(d, 'chars'), pUsed = num(d, 'previewChars');
    const now = new Date().toISOString();
    let cnt = 0, dch = 0;
    if (pref) {
      const sameDay = p.exists && p.get('day') === day;
      cnt = sameDay ? num(p, 'count') : 0; dch = sameDay ? num(p, 'chars') : 0;
      if (cnt >= s.previewDaily || dch + n > s.previewDailyChars) return { fail: 'preview-limit', why: 'preview-daily', limit: s.previewDailyChars };
      if (pUsed + n > s.previewMonthly) return { fail: 'preview-limit', why: 'preview-monthly', limit: s.previewMonthly };
    }
    if (used + n > s.monthly) {
      tx.set(mref, { month, chars: used, limit: s.monthly, capHitAt: now, updatedAt: now }, { merge: true });
      return { fail: 'quota', used, limit: s.monthly };
    }
    const upd = { month, chars: used + n, limit: s.monthly, requests: num(d, 'requests') + 1, updatedAt: now };
    if (pref) upd.previewChars = pUsed + n;
    tx.set(mref, upd, { merge: true });
    if (pref) tx.set(pref, { day, count: cnt + 1, chars: dch + n, updatedAt: now });
    return { ok: true, month, day };
  });
  if (r.fail === 'quota') throw new VoiceError('quota', 'monthly-cap', { used: r.used, limit: r.limit, month });
  if (r.fail) throw new VoiceError('preview-limit', r.why, { limit: r.limit });
  return r;
}
// החזרה – רק כשהבקשה בוודאות לא חויבה (ראו refundable)
async function refund(n, q, o) {
  const mref = db().doc(`${USAGE}/m-${q.month}`);
  const pref = o && o.preview ? db().doc(`${USAGE}/p-${o.uid}`) : null;
  const now = new Date().toISOString();
  try {
    await db().runTransaction(async (tx) => {
      const d = await tx.get(mref);
      const p = pref ? await tx.get(pref) : null;
      if (d.exists) tx.update(mref, Object.assign({ chars: Math.max(0, num(d, 'chars') - n), updatedAt: now }, pref ? { previewChars: Math.max(0, num(d, 'previewChars') - n) } : {}));
      if (p && p.exists && p.get('day') === q.day) tx.update(pref, { count: Math.max(0, num(p, 'count') - 1), chars: Math.max(0, num(p, 'chars') - n), updatedAt: now });
    });
  } catch (e) { logger.error('voice: refund failed', { reason: 'refund-failed' }); }
}
// מצב הגבול החודשי (למנהל, ב-getLineState)
async function quotaView() {
  const s = settings(), month = monthKey();
  const d = await db().doc(`${USAGE}/m-${month}`).get();
  const used = (d.exists && Number(d.get('chars'))) || 0;
  return { month, used, limit: s.monthly, near: used >= s.monthly * 0.9, capHitAt: (d.exists && d.get('capHitAt')) || null,
    previewUsed: num(d, 'previewChars'), previewLimit: s.previewMonthly };
}

// ---------------- ElevenLabs ----------------
const NO_CONNECT = ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH'];
async function callEleven(key, base, s, text) {
  const url = `${base}v1/text-to-speech/${encodeURIComponent(s.voiceId)}?output_format=${encodeURIComponent(s.format)}`;
  let r, buf;
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      // (לא מאומת) language_code ו-voice_settings.speed – לפי דיווחים, לא נבדק מול השירות האמיתי
      body: JSON.stringify({ text, model_id: s.model, language_code: s.lang, voice_settings: { speed: s.speed } }),
      signal: AbortSignal.timeout(s.timeoutMs),
    });
    // 401/403 (מפתח או הרשאה) – השירות דחה לפני ביצוע, ולכן לא חייב. שאר הקודים – לא ודאי, לא מחזירים.
    if (!r.ok) { try { await r.arrayBuffer(); } catch (e) { /* */ } throw new VoiceError('unavailable', 'http-' + r.status, { refundable: r.status === 401 || r.status === 403 }); }
    buf = Buffer.from(await r.arrayBuffer());
  } catch (e) {
    if (e instanceof VoiceError) throw e;
    const timeout = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    if (timeout) throw new VoiceError('unavailable', 'timeout');
    // החיבור לא נוצר בכלל (השרת לא נמצא / סירב) – הבקשה בוודאות לא הגיעה לשירות
    const c = e && e.cause, code = (c && (c.code || (Array.isArray(c.errors) && c.errors[0] && c.errors[0].code))) || '';
    if (NO_CONNECT.includes(code)) throw new VoiceError('unavailable', 'no-connect', { refundable: true });
    throw new VoiceError('unavailable', 'network'); // ייתכן שהבקשה הגיעה (למשל ניתוק באמצע) – לא מחזירים
  }
  const ct = String(r.headers.get('content-type') || '');
  if (buf.length < 64 || !/^audio\//i.test(ct)) throw new VoiceError('unavailable', 'bad-audio');
  return buf;
}

// שמע בקול המשוכפל: מטמון ← מונים (תקרה כוללת; בתצוגה גם תת-תקרה ומגבלה יומית) ← ElevenLabs ← מטמון.
async function synth(text, opts) {
  const o = opts || {};
  const s = settings();
  const name = cacheKey(text, s);
  const hit = await cacheGet(name);
  if (hit) return { buf: hit, cached: true, chars: 0 };
  const key = ELEVENLABS_API_KEY.value();
  if (!key) throw new VoiceError('unavailable', 'no-key');
  const base = elevenBase(P.base.value() || 'https://api.elevenlabs.io');
  const n = text.length;
  const q = await reserve(n, s, o);
  try {
    const buf = await callEleven(key, base, s, text);
    await cachePut(name, buf);
    return { buf, cached: false, chars: n };
  } catch (e) {
    // מחזירים רק כשהבקשה בוודאות לא חויבה: החיבור לא נוצר, או 401/403. פסק זמן, 5xx, תשובה שאינה שמע – ייתכן שחויבה, לא מחזירים.
    if (e instanceof VoiceError && e.refundable) await refund(n, q, o);
    throw e;
  }
}

// ---------------- הממשק לשאר הקוד ----------------
// opts.engine: 'elevenlabs' | 'yemot-tts' (ברירת מחדל: המוגדר בשרת)
async function render(text, opts) {
  const engine = (opts && opts.engine) || configuredEngine();
  if (engine === 'yemot-tts') return { ext: textExt, kind: 'text', body: String(text), engine };
  const r = await synth(String(text), {});
  return { ext: 'wav', kind: 'audio', body: r.buf, mime: 'audio/mpeg', srcExt: 'mp3', engine, cached: r.cached, chars: r.chars };
}
// "שמע קודם" בקול האמיתי. מנוע ממוחשב בשרת = VoiceError('off') – האפליקציה עוברת להקראה בטלפון.
async function preview(text, uid) {
  if (configuredEngine() !== 'elevenlabs') throw new VoiceError('off', 'engine-off');
  const r = await synth(String(text), { preview: true, uid });
  return { mime: 'audio/mpeg', data: r.buf.toString('base64'), cached: r.cached, chars: r.chars };
}
function fromRecording(wavBuf) { return { ext: 'wav', kind: 'audio', body: wavBuf, engine: 'recording' }; }

// שגיאה מסודרת בעברית לאפליקציה. למנהל – גם מצב התקרה.
function toHttps(e, isManager) {
  logger.warn('voice: not available', { reason: 'voice-' + e.code, code: e.detail });
  if (e.code === 'quota') {
    return new HttpsError('resource-exhausted', 'הגענו לתקרת הקול האנושי לחודש הזה. אפשר לשלוח בקול הממוחשב, או לנסות שוב בחודש הבא.'
      + (isManager ? ` (נוצלו ${e.used} מתוך ${e.limit} תווים. התקרה נקבעת בהגדרה ELEVENLABS_MONTHLY_CHARS.)` : ''),
    Object.assign({ reason: 'voice-quota' }, isManager ? { used: e.used, limit: e.limit, month: e.month } : {}));
  }
  if (e.code === 'preview-limit') return new HttpsError('resource-exhausted', 'הגעתם למכסת ההשמעות בקול האמיתי (להיום או לחודש). ההשמעה תהיה בקול של הטלפון.', { reason: 'preview-limit', limit: e.limit });
  if (e.code === 'off') return new HttpsError('failed-precondition', 'הקול האנושי לא מופעל בשרת.', { reason: 'voice-off' });
  return new HttpsError('unavailable', 'הקול האנושי לא זמין כרגע. אפשר לשלוח בקול הממוחשב, או לנסות שוב מאוחר יותר.', { reason: 'voice-unavailable' });
}

function fileName(num, rendered) {
  const base = typeof num === 'number' ? String(num).padStart(3, '0') : String(num);
  return base + '.' + rendered.ext;
}
// dir: '1' → 'ivr2:1/004.tts'; '' (השורש) → 'ivr2:/M1000.tts'
const pathOf = (dir, file) => `ivr2:${dir}/${file}`;
const extOf = (file) => { const m = /\.([A-Za-z0-9]+)$/.exec(String(file || '')); return m ? m[1] : ''; };

// רשימה סגורה של סיומות שמותר למחוק לפי שם קובץ (שלוחה 4): tts ו-wav, ובנוסף הסיומת שמנוע הקול מייצר כרגע
const DELETABLE_EXTS = ['tts', 'wav'];
function isDeletableContent(file) {
  const m = /^\d{3}\.([A-Za-z0-9]{1,5})$/.exec(typeof file === 'string' ? file : '');
  if (!m) return false;
  const e = m[1].toLowerCase();
  return DELETABLE_EXTS.includes(e) || e === textExt;
}

async function upload(ctx, dir, num, rendered) {
  const file = fileName(num, rendered);
  const path = pathOf(dir, file);
  if (rendered.kind === 'text') await client.uploadText(ctx, path, rendered.body);
  // שמע: ההעלאה תמיד לנתיב .wav עם convertAudio=1. שם הקובץ המקורי בהעלאה לפי הפורמט האמיתי (mp3 מ-ElevenLabs)
  else if (rendered.kind === 'audio') await client.uploadBinary(ctx, path, rendered.body, rendered.mime || 'audio/wav', rendered.srcExt ? `${String(num)}.${rendered.srcExt}` : undefined);
  else throw new Error('voice: unknown kind');
  return { file, path };
}

module.exports = {
  VOICE_ENGINE, ELEVENLABS_API_KEY, VoiceError, render, preview, fromRecording, fileName, pathOf, extOf, upload, isDeletableContent, DELETABLE_EXTS,
  pickEngine, extFor, configuredEngine, quotaView, toHttps, cleanCache,
  parseWav, readRecording, savedAudioOf, saveLineAudio, lineAudioSize, isAudioFile, readLineAudio, listLineAudio, deleteLineAudio, PURGE_RE,
  isTextFile, isListenable, isSafeFilePath, legacyRendered,
};
// לבדיקות בלבד
Object.defineProperty(module.exports, '_test', {
  enumerable: false,
  value: { setTextExt(e) { textExt = e; }, setStore(s) { store = s; }, setLineStore(s) { lineStore = s; }, cacheKey, settings, monthKey },
});
