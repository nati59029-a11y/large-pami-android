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

// ---------------- גבול חודשי ומגבלה יומית ----------------
function db() { return require('firebase-admin/firestore').getFirestore(); }
// שומר מקום ל-n תווים בחודש הנוכחי. חריגה (גם "כמעט": אין מקום לטקסט הזה) = VoiceError('quota'), בלי פנייה לשירות.
async function reserve(n, s) {
  const month = monthKey();
  const ref = db().doc(`${USAGE}/m-${month}`);
  return db().runTransaction(async (tx) => {
    const d = await tx.get(ref);
    const used = (d.exists && Number(d.get('chars'))) || 0;
    const now = new Date().toISOString();
    if (used + n > s.monthly) {
      tx.set(ref, { month, chars: used, limit: s.monthly, capHitAt: now, updatedAt: now }, { merge: true });
      return { ok: false, used, limit: s.monthly, month };
    }
    tx.set(ref, { month, chars: used + n, limit: s.monthly, requests: ((d.exists && Number(d.get('requests'))) || 0) + 1, updatedAt: now }, { merge: true });
    return { ok: true, used: used + n, limit: s.monthly, month };
  }).then((r) => { if (!r.ok) throw new VoiceError('quota', 'monthly-cap', { used: r.used, limit: r.limit, month: r.month }); return r; });
}
async function refund(n, month) {
  const ref = db().doc(`${USAGE}/m-${month}`);
  try {
    await db().runTransaction(async (tx) => {
      const d = await tx.get(ref);
      if (d.exists) tx.update(ref, { chars: Math.max(0, (Number(d.get('chars')) || 0) - n), updatedAt: new Date().toISOString() });
    });
  } catch (e) { logger.error('voice: refund failed', { reason: 'refund-failed' }); }
}
async function previewSlot(uid) {
  const day = ymd();
  const limit = int(P.previewDaily, 30);
  const ref = db().doc(`${USAGE}/p-${uid}`);
  const ok = await db().runTransaction(async (tx) => {
    const d = await tx.get(ref);
    const used = d.exists && d.get('day') === day ? (Number(d.get('count')) || 0) : 0;
    if (used >= limit) return false;
    tx.set(ref, { day, count: used + 1, updatedAt: new Date().toISOString() });
    return true;
  });
  if (!ok) throw new VoiceError('preview-limit', 'preview-daily', { limit });
}
// מצב הגבול החודשי (למנהל, ב-getLineState)
async function quotaView() {
  const s = settings(), month = monthKey();
  const d = await db().doc(`${USAGE}/m-${month}`).get();
  const used = (d.exists && Number(d.get('chars'))) || 0;
  return { month, used, limit: s.monthly, near: used >= s.monthly * 0.9, capHitAt: (d.exists && d.get('capHitAt')) || null };
}

// ---------------- ElevenLabs ----------------
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
    if (!r.ok) { try { await r.arrayBuffer(); } catch (e) { /* */ } throw new VoiceError('unavailable', 'http-' + r.status); }
    buf = Buffer.from(await r.arrayBuffer());
  } catch (e) {
    if (e instanceof VoiceError) throw e;
    const timeout = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    throw new VoiceError('unavailable', timeout ? 'timeout' : 'network');
  }
  const ct = String(r.headers.get('content-type') || '');
  if (buf.length < 64 || !/^audio\//i.test(ct)) throw new VoiceError('unavailable', 'bad-audio');
  return buf;
}

// שמע בקול המשוכפל: מטמון ← (תצוגה: מגבלה יומית) ← גבול חודשי ← ElevenLabs ← מטמון.
async function synth(text, opts) {
  const o = opts || {};
  const s = settings();
  const name = cacheKey(text, s);
  const hit = await cacheGet(name);
  if (hit) return { buf: hit, cached: true, chars: 0 };
  const key = ELEVENLABS_API_KEY.value();
  if (!key) throw new VoiceError('unavailable', 'no-key');
  const base = elevenBase(P.base.value() || 'https://api.elevenlabs.io');
  if (o.preview) await previewSlot(o.uid);
  const n = text.length;
  const q = await reserve(n, s);
  try {
    const buf = await callEleven(key, base, s, text);
    await cachePut(name, buf);
    return { buf, cached: false, chars: n };
  } catch (e) {
    // פסק זמן: ייתכן שהשירות כבר חייב – לא מחזירים את התווים למונה (שמרני)
    if (!(e instanceof VoiceError && e.detail === 'timeout')) await refund(n, q.month);
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
  if (e.code === 'preview-limit') return new HttpsError('resource-exhausted', 'הגעתם למספר ההשמעות בקול האמיתי להיום. ההשמעה תהיה בקול של הטלפון.', { reason: 'preview-limit', limit: e.limit });
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
};
// לבדיקות בלבד
Object.defineProperty(module.exports, '_test', {
  enumerable: false,
  value: { setTextExt(e) { textExt = e; }, setStore(s) { store = s; }, cacheKey, settings, monthKey },
});
