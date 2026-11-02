'use strict';
// תוכן שלוחות הקו (ימות המשיח) מתוך האפליקציה – חוזה 5.2-5.4, 5.9, 5.12 (משימה 2026-11-02).
//   publishLineItem – העלאת תוכן: recipes (שלוחה 1, עובד ומנהל), updates (שלוחה 3, עובד ומנהל, טקסט או הקלטה),
//                     hours (שלוחה 4, מנהל; קבועה, או זמנית עם until), opening (הודעת הפתיחה ivr2:/M1000.<סיומת>, מנהל).
//   removeLineItem  – הורדת פריט שהשרת העלה (מנהל בלבד), או – בשלוחה 4 בלבד – כל קובץ תוכן לפי שם (כולל הקובץ הוותיק 000).
//   listLineFiles   – רשימת קובצי התוכן בשלוחה 4, כפי שהם בקו (מנהל בלבד).
//   getLineState    – הרשימות, המילון והמגבלות לאפליקציה (עובד ומנהל). בלי פנייה לימות. כולל voice (מנוע, ולמנהל – הגבול החודשי).
//   previewVoice    – "שמע קודם" בקול המשוכפל (עובד ומנהל): מחזיר שמע mp3 (base64). נשמר במטמון לשליחה של אותו נוסח.
//   runLineExpiry   – (לא מ-index.js) נקראת מ-expirePromosOnLine כל לילה: מוחקת הודעות זמניות בשלוחה 4 שפג תוקפן.
// עקרונות:
//   * התפקיד נקבע בשרת (requireStaff: admins/staff במסד), לעולם לא משדה שהטלפון שולח.
//   * כל העלאה עוברת: ניקוי ← מילון הגייה ← lib/voice.js. רק voice.js מכיר את סוג הקובץ.
//   * השרת מוחק או דורס רק נתיב שרשום אצלו ב-yemot_items. קובצי 000.*, M* (חוץ מ-M1000 של הפתיחה), ext.ini וכל קובץ אחר – לא נוגעים.
//   * שלוחות 1 ו-3 (היסטוריה, פ4): כל פריט בקובץ חדש, במספר גבוה מכל מה שבשלוחה, כדי שיושמע ראשון. אין מילוי חורים.
//   * שלוחה 4 והפתיחה (החלפה): מעלים קודם את החדש, ורק אחרי הצלחה מוחקים את הקודם – אין רגע שבו השלוחה ריקה.
//   * המפתח של ימות רק בכספת (YEMOT_API_KEY), נשלח רק בכותרת. לא ביומן, לא ברשומה ולא בהודעה. גם טקסט מימות לא מועבר.
//   * אין ניסיון חוזר אוטומטי. ניסיון חוזר = אותו requestId מהאפליקציה (לא מעלה פעמיים, ומשתמש באותו נתיב).

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret, defineInt, defineString } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const { getFirestore } = require('firebase-admin/firestore');
const { requireStaff, inputObject } = require('./lib/roles');
const { YemotError, apiBase, listDir, deleteFiles } = require('./lib/yemot-client');
const voice = require('./lib/voice');
const { applyLexicon } = require('./lib/lexicon');
const { cleanText, israelDay, addDays, validDay, loadLexicon, ensureLexiconSeed, testFault, LOCK_MS } = require('./yemot').shared;

const YEMOT_API_KEY = defineSecret('YEMOT_API_KEY');
const YEMOT_API_BASE = defineString('YEMOT_API_BASE', { default: 'https://www.call2all.co.il/ym/api/', description: 'כתובת ה-API של ימות המשיח' });
const YEMOT_TIMEOUT_MS = defineInt('YEMOT_TIMEOUT_MS', { default: 15000, description: 'זמן המתנה מרבי לכל קריאה לימות' });
const YEMOT_RECIPE_MAX = defineInt('YEMOT_RECIPE_MAX', { default: 2500, description: 'אורך מרבי למתכון (תווים, הערכה)' });
const YEMOT_TEMP_MAX_DAYS = defineInt('YEMOT_TEMP_MAX_DAYS', { default: 60, description: 'הודעה זמנית בשלוחה 4: עד כמה ימים קדימה' });
const YEMOT_REC_MAX_SEC = defineInt('YEMOT_REC_MAX_SEC', { default: 120, description: 'אורך מרבי להקלטה בשלוחת העדכונים (שניות, הערכה)' });

const ITEMS = 'yemot_items';
const LEXICON_DOC = 'yemot_lexicon/main';
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const REC_MAX_BYTES = 2000000;
const ON_LINE = ['live', 'remove-failed'];

// slot → שלוחה. history = כל פריט נשמר (פ4=היסטוריה בשלוחה 3). replace = פריט פעיל אחד.
// state = מונה המספרים בשלוחה (ונעילת ההחלפה). אין שלוחה 2 כאן: מבצעים עוברים דרך sendPromoToLine.
const SLOTS = Object.freeze({
  recipes: { ext: '1', name: 'המתכונים', mode: 'history', managerOnly: false, max: () => YEMOT_RECIPE_MAX.value(), state: 'yemot_state/ext-1' },
  updates: { ext: '3', name: 'העדכונים', mode: 'history', managerOnly: false, max: () => 800, state: 'yemot_state/ext-3', audio: true },
  // שלוחה 4 (סבב 3): היסטוריה – כל הודעה בקובץ חדש. המנהל מוחק ישנות בעצמו. הודעה זמנית (until) נמחקת בלילה שאחרי.
  hours: { ext: '4', name: 'השעות והכתובת', mode: 'history', managerOnly: true, max: () => 600, state: 'yemot_state/ext-4', temporary: true },
  opening: { ext: '', name: 'הודעת הפתיחה', mode: 'replace', managerOnly: true, max: () => 600, state: 'yemot_state/structure', fixedName: 'M1000' },
});
const SLOT_NAMES = Object.keys(SLOTS);
const isSlot = (s) => typeof s === 'string' && SLOT_NAMES.includes(s) && Object.hasOwn(SLOTS, s);

// נתיב שהשרת רשאי למחוק: קובץ ממוספר 001-999 בשלוחות 1/3, 000-999 בשלוחה 4 (גם הקובץ הוותיק 000), או קובץ הפתיחה M1000 בשורש.
// תמיד קובץ אחד בנתיב מדויק – אף פעם לא תיקייה.
function safePath(p) {
  const m = /^ivr2:([134])\/(\d{3})\.[A-Za-z0-9]+$/.exec(String(p || ''));
  if (m) return m[1] === '4' || Number(m[2]) >= 1;
  return /^ivr2:\/M1000\.[A-Za-z0-9]+$/.test(String(p || ''));
}

const bad = (reason, message, extra) => new HttpsError('invalid-argument', message, Object.assign({ reason }, extra || {}));
const isLocked = (x, nowMs) => !!(x && x.lockAt && nowMs - Date.parse(x.lockAt) < LOCK_MS);
const busy = () => new HttpsError('aborted', 'פעולה אחרת על הקו בטיפול. נסו שוב בעוד רגע.', { reason: 'busy' });
const noKey = () => new HttpsError('failed-precondition', 'הקו הטלפוני עוד לא מחובר בשרת. פנו למנהל.', { reason: 'no-key' });

function israelStamp(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(d || new Date()).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month} ${p.hour}:${p.minute}`;
}

// ---------------- הקלטה: WAV PCM 16 ביט, מונו, 8000Hz (חוזה 5.7) ----------------
// האורך מחושב מגודל הנתונים בקובץ, לא משדה שהטלפון שולח.
function parseWav(buf, maxSec) {
  const badAudio = () => bad('bad-audio', 'ההקלטה לא בפורמט הנכון. הקליטו שוב.');
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
  if (sec > maxSec) throw bad('audio-too-long', `ההקלטה ארוכה מדי (עד ${maxSec} שניות).`, { max: maxSec });
  return Math.round(sec * 10) / 10;
}

function validateItem(input) {
  const { requestId, slot, text, audio, source } = input;
  if (typeof requestId !== 'string' || !ID_RE.test(requestId)) throw bad('bad-request-id', 'הבקשה לא תקינה. נסו שוב.');
  if (!isSlot(slot)) throw bad('bad-slot', 'השלוחה לא מוכרת.');
  const S = SLOTS[slot];
  const hasText = text !== undefined && text !== null, hasAudio = audio !== undefined && audio !== null;
  if (hasText === hasAudio) throw bad('bad-input', 'קלט לא תקין');
  if (hasAudio) {
    if (!S.audio) throw bad('audio-not-allowed', 'אפשר לשלוח הקלטה רק לשלוחת העדכונים.');
    if (source !== 'recording') throw bad('bad-input', 'קלט לא תקין');
    const maxSec = YEMOT_REC_MAX_SEC.value();
    if (typeof audio !== 'object' || Array.isArray(audio) || audio.mimeType !== 'audio/wav' || typeof audio.data !== 'string') throw bad('bad-audio', 'ההקלטה לא בפורמט הנכון. הקליטו שוב.');
    if (audio.data.length > Math.ceil(REC_MAX_BYTES / 3) * 4) throw bad('audio-too-long', `ההקלטה ארוכה מדי (עד ${maxSec} שניות).`, { max: maxSec });
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(audio.data)) throw bad('bad-audio', 'ההקלטה לא בפורמט הנכון. הקליטו שוב.');
    const buf = Buffer.from(audio.data, 'base64');
    const durationSec = parseWav(buf, maxSec);
    return { requestId, slot, S, kind: 'audio', source, buf, durationSec, text: null, title: 'הקלטה ' + israelStamp() };
  }
  if (!['typed', 'scan'].includes(source)) throw bad('bad-input', 'קלט לא תקין');
  let until = null;
  if (input.until !== undefined && input.until !== null) {
    if (!S.temporary) throw bad('bad-input', 'קלט לא תקין');
    const today = israelDay(), maxDays = YEMOT_TEMP_MAX_DAYS.value();
    if (!validDay(input.until)) throw bad('bad-date', 'תאריך ההורדה לא תקין.');
    if (input.until < today) throw bad('date-past', 'תאריך ההורדה כבר עבר.');
    if (input.until > addDays(today, maxDays)) throw bad('date-too-far', `אפשר להשאיר הודעה זמנית עד ${maxDays} ימים.`, { max: maxDays });
    until = input.until;
  }
  if (typeof text !== 'string') throw bad('empty-text', 'הנוסח ריק. כתבו מה יוקרא בקו.');
  const clean = cleanText(text);
  if (!clean) throw bad('empty-text', 'הנוסח ריק. כתבו מה יוקרא בקו.');
  const max = S.max();
  if (clean.length > max) throw bad('text-too-long', `הנוסח ארוך מדי (עד ${max} תווים).`, { max });
  const first = cleanText(text.split(/\r?\n/).find((l) => cleanText(l)) || clean);
  return { requestId, slot, S, kind: 'text', source, text: clean, title: first.slice(0, 60), until };
}

function context(key, base) {
  if (!key) throw noKey();
  try { return { key, base: apiBase(base), timeoutMs: YEMOT_TIMEOUT_MS.value() }; } catch (e) {
    logger.error('yemot-line: bad api base', { reason: e.code });
    throw noKey();
  }
}

// מספר חדש בשלוחה: max(nextNum, 1 + המספר הגבוה בשלוחה), מ-001. אין מילוי חורים. מעל 999: line-full.
// הרשימה נקראת מהקו בכל פעם; המונה בטרנזקציה מונע ששתי בקשות במקביל יקבלו אותו מספר.
async function allocate(db, ctx, S, itemRef, rendered) {
  const names = await listDir(ctx, S.ext);
  let maxOn = 0;
  for (const n of names) { const m = /^(\d{3})\.[A-Za-z0-9]+$/.exec(n); if (m) maxOn = Math.max(maxOn, Number(m[1])); }
  const stateRef = db.doc(S.state);
  return db.runTransaction(async (tx) => {
    const s = await tx.get(stateRef);
    const nextNum = (s.exists && Number(s.get('nextNum'))) || 1;
    const recent = (s.exists && Array.isArray(s.get('recent')) ? s.get('recent') : []).map(Number);
    const n = Math.max(nextNum, maxOn + 1, 1);
    if (n > 999) throw new HttpsError('resource-exhausted', 'אין מקום לעוד קבצים בשלוחה. פנו למנהל.', { reason: 'line-full' });
    const file = voice.fileName(n, rendered);
    const now = new Date().toISOString();
    tx.set(stateRef, { nextNum: n + 1, recent: recent.concat(n).slice(-20), updatedAt: now }, { merge: true });
    tx.update(itemRef, { file, path: voice.pathOf(S.ext, file), updatedAt: now });
    return file;
  });
}

const DONE_MSG = {
  recipes: 'המתכון עלה לקו (שלוחה 1), ויושמע ראשון.',
  updates: 'העדכון עלה לקו (שלוחה 3), ויושמע ראשון.',
  hours: 'ההודעה עלתה לשלוחה 4, ותושמע ראשונה.',
  opening: 'הודעת הפתיחה עודכנה בקו.',
};

// ---------------- publishLineItem ----------------
async function publishItem(request, key, base) {
  const who = await requireStaff(request);
  const input = inputObject(request);
  const v = validateItem(input);
  const S = v.S;
  if (S.managerOnly && who.role !== 'manager') {
    throw new HttpsError('permission-denied', `רק מנהל יכול לשנות את ${S.name}.`, { reason: 'slot-manager-only' });
  }
  // מנוע הקול: בלי engine = המוגדר בשרת (הקול המשוכפל); engine=tts = המשתמש בחר "שלח בקול הממוחשב". הקלטה – תמיד כמו שהיא.
  const engine = voice.pickEngine(input.engine);
  if (!engine) throw bad('bad-input', 'קלט לא תקין');
  const ctx = context(key, base);
  const db = getFirestore();
  // ההקראה עצמה (שעולה כסף בקול המשוכפל) נוצרת רק אחרי בדיקת הכפילות והנעילה – שלב 2 למטה
  let spoken = null, rendered = null;
  if (v.kind === 'text') spoken = applyLexicon(v.text, await loadLexicon(db));
  else rendered = voice.fromRecording(v.buf);
  const ext = rendered ? rendered.ext : voice.extFor(engine);

  const itemRef = db.doc(`${ITEMS}/${v.requestId}`);
  const slotRef = S.mode === 'replace' ? db.doc(S.state) : null; // החלפה אחת בכל רגע בשלוחה
  const reply = (x, extra) => Object.assign({ ok: true, id: v.requestId, slot: v.slot, file: x.file, path: x.path, kind: x.kind, replaced: null, spoken: x.spoken == null ? null : x.spoken, duplicate: false }, extra);

  // 1. טרנזקציה: כפילות, נעילה, ורשומה "uploading"
  const plan = await db.runTransaction(async (tx) => {
    const s = await tx.get(itemRef);
    const l = slotRef ? await tx.get(slotRef) : null;
    const x = s.exists ? s.data() : null;
    const nowMs = Date.now();
    if (x && (x.slot !== v.slot || x.byUid !== who.uid)) throw bad('bad-request-id', 'הבקשה לא תקינה. נסו שוב.');
    if (x && ['live', 'replaced', 'removed', 'remove-failed'].includes(x.status)) return { kind: 'duplicate', x };
    if (isLocked(x, nowMs)) throw busy();
    if (l && l.exists && isLocked(l.data(), nowMs) && l.get('lockReq') !== v.requestId) throw busy();
    const now = new Date(nowMs).toISOString();
    // ניסיון חוזר אחרי כשל: אותו נתיב (גם אם ייתכן שהקובץ כבר עלה), כל עוד הסיומת לא השתנתה
    const keepPath = !!(x && x.path && voice.extOf(x.path) === ext);
    const rec = {
      slot: v.slot, ext: S.ext, kind: v.kind, source: v.source, title: v.title, text: v.text, spoken,
      durationSec: v.kind === 'audio' ? v.durationSec : null, engine: v.kind === 'audio' ? 'recording' : engine, status: 'uploading', error: null,
      until: v.until || null, temporary: !!v.until,
      uncertain: keepPath ? !!x.uncertain : false, byUid: who.uid, byRole: who.role, updatedAt: now, lockAt: now, lockReq: v.requestId,
    };
    if (!keepPath) { rec.file = null; rec.path = null; }
    if (!x) Object.assign(rec, { createdAt: now, replacedBy: null, removedAt: null, removedBy: null });
    tx.set(itemRef, rec, { merge: true });
    if (slotRef) tx.set(slotRef, { lockAt: now, lockReq: v.requestId, updatedAt: now }, { merge: true });
    return { kind: 'work', keepPath, x };
  });
  if (plan.kind === 'duplicate') return reply(plan.x, { duplicate: true, message: 'הפריט הזה כבר נשלח לקו.' });

  const stamp = () => new Date().toISOString();
  const unlockSlot = async () => {
    if (!slotRef) return;
    try {
      await db.runTransaction(async (tx) => { const l = await tx.get(slotRef); if (l.exists && l.get('lockReq') === v.requestId) tx.update(slotRef, { lockAt: null, lockReq: null, updatedAt: stamp() }); });
    } catch (e) { logger.error('yemot-line: unlock failed', { reason: 'unlock-failed' }); }
  };
  const fail = async (code, uncertain) => {
    await itemRef.update({ status: 'failed', uncertain: !!uncertain, error: code, lockAt: null, lockReq: null, updatedAt: stamp() });
    await unlockSlot();
  };

  try {
    // 2א. הפתיחה בקובץ שמע: לא דורסים הקלטת פתיחה ישנה (M1000.wav) שלא הועלתה מהאפליקציה. בודקים לפני ההקראה, כדי לא לשלם לחינם.
    if (S.fixedName && !plan.keepPath && ext === 'wav') {
      const target = voice.fileName(S.fixedName, { ext });
      let names;
      try { names = await listDir(ctx, S.ext); } catch (e) {
        await fail(e instanceof YemotError ? 'dir-' + e.code : 'internal', false);
        logger.warn('yemot-line: dir failed', { reason: 'yemot-upload-failed', code: e.code, requestId: v.requestId });
        throw new HttpsError('unavailable', 'ההעלאה לקו נכשלה. נסו שוב מאוחר יותר.', { reason: 'yemot-upload-failed' });
      }
      if (names.includes(target)) {
        const ours = (await db.collection(ITEMS).where('path', '==', voice.pathOf(S.ext, target)).get()).docs.some((d) => d.id !== v.requestId && ON_LINE.includes(d.get('status')));
        if (!ours) {
          await fail('opening-legacy-file', false);
          throw new HttpsError('failed-precondition', `בקו יש הקלטת פתיחה ישנה (${target}) שלא הועלתה מהאפליקציה. כדי לא למחוק אותה, הפתיחה לא הוחלפה. צריך קודם להעביר אותה לגיבוי (BACKUP_M1000.wav).`, { reason: 'opening-legacy-file' });
        }
      }
    }
    // 2ב. ההקראה (דרך voice.js). כשל או תקרה בקול המשוכפל – שגיאה מסודרת, בלי מעבר אוטומטי לקול הממוחשב.
    if (!rendered) {
      try { rendered = await voice.render(spoken, { engine }); } catch (e) {
        if (!(e instanceof voice.VoiceError)) throw e;
        await fail('voice-' + e.code, false);
        throw voice.toHttps(e, who.role === 'manager');
      }
    }
    // 2ג. נתיב: הפתיחה – שם קבוע. אחרת – הנתיב הקודם (ניסיון חוזר) או מספר חדש.
    let file = plan.keepPath ? plan.x.file : null;
    let path = plan.keepPath ? plan.x.path : null;
    try {
      if (!path && S.fixedName) {
        file = voice.fileName(S.fixedName, rendered); path = voice.pathOf(S.ext, file);
        await itemRef.update({ file, path, updatedAt: stamp() });
      } else if (!path) {
        file = await allocate(db, ctx, S, itemRef, rendered);
        path = voice.pathOf(S.ext, file);
      }
    } catch (e) {
      if (e instanceof HttpsError) { await fail((e.details && e.details.reason) || 'internal', false); throw e; }
      await fail(e instanceof YemotError ? 'dir-' + e.code : 'internal', false);
      logger.warn('yemot-line: dir failed', { reason: 'yemot-upload-failed', code: e.code, requestId: v.requestId });
      throw new HttpsError('unavailable', 'ההעלאה לקו נכשלה. נסו שוב מאוחר יותר.', { reason: 'yemot-upload-failed' });
    }

    // 3. העלאה (דרך voice.js)
    try {
      await voice.upload(ctx, S.ext, file.slice(0, file.lastIndexOf('.')), rendered);
    } catch (e) {
      const uncertain = e instanceof YemotError && e.sent && e.code === 'timeout';
      await fail(e instanceof YemotError ? 'upload-' + e.code : 'internal', uncertain);
      logger.warn('yemot-line: upload failed', { reason: uncertain ? 'yemot-uncertain' : 'yemot-upload-failed', code: e.code, requestId: v.requestId });
      if (uncertain) throw new HttpsError('unavailable', 'לא בטוח שההעלאה הצליחה. בדקו ברשימה בעוד דקה לפני שליחה חוזרת.', { reason: 'yemot-uncertain' });
      throw new HttpsError('unavailable', 'ההעלאה לקו נכשלה. נסו שוב מאוחר יותר.', { reason: 'yemot-upload-failed' });
    }
    await testFault(db, 'line-after-upload');
    await itemRef.update({ status: 'live', uncertain: false, error: null, lockAt: null, lockReq: null, updatedAt: stamp() });

    // 4. החלפה: רק אחרי שהחדש בקו – הקודם יוצא. מחיקה רק של נתיב שרשום אצלנו, ורק אם הוא שונה מהחדש.
    let replaced = null; const warnings = [];
    if (S.mode === 'replace') {
      const prev = (await db.collection(ITEMS).where('slot', '==', v.slot).get()).docs
        .filter((d) => d.id !== v.requestId && ON_LINE.includes(d.get('status')));
      for (const d of prev) {
        const p = d.get('path');
        const now = stamp();
        if (!p || p === path) { await d.ref.update({ status: 'replaced', replacedBy: v.requestId, updatedAt: now }); replaced = replaced || d.get('file'); continue; }
        if (!safePath(p)) { logger.error('yemot-line: unsafe path skipped', { reason: 'unsafe-path', id: d.id }); continue; }
        try {
          await deleteFiles(ctx, [p]);
          await d.ref.update({ status: 'replaced', replacedBy: v.requestId, removedAt: now, updatedAt: now, error: null });
          replaced = replaced || d.get('file');
        } catch (e) {
          await d.ref.update({ status: 'remove-failed', replacedBy: v.requestId, error: 'delete-' + (e.code || 'internal'), uncertain: !!(e instanceof YemotError && e.code === 'timeout'), updatedAt: now });
          if (!warnings.includes('yemot-remove-failed')) warnings.push('yemot-remove-failed');
          logger.warn('yemot-line: previous not removed', { reason: 'yemot-remove-failed', code: e.code, requestId: v.requestId });
        }
      }
      await unlockSlot();
    }
    const message = DONE_MSG[v.slot] + (v.until ? ` היא תרד מהקו אחרי ${v.until.split('-').reverse().join('/')}.` : '') + (warnings.length ? ' התוכן הקודם עוד לא הוסר מהקו – הוא יוסר בעדכון הבא.' : '');
    return reply({ file, path, kind: v.kind, spoken }, { replaced, warnings, message, engine: rendered.engine });
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    // חריגה פנימית: משחררים נעילות ומסמנים "לא ודאי" (ייתכן שהקובץ עלה). ניסיון חוזר ישתמש באותו נתיב.
    try { await fail('internal', true); } catch (e2) { logger.error('yemot-line: cleanup failed', { reason: 'cleanup-failed' }); }
    throw e;
  }
}

// ---------------- removeLineItem (מנהל) ----------------
async function removeItem(request, key, base) {
  const who = await requireStaff(request);
  const input = inputObject(request);
  if (who.role !== 'manager') throw new HttpsError('permission-denied', 'הפעולה הזו מותרת למנהל בלבד.', { reason: 'manager-only' });
  if (typeof input.requestId !== 'string' || !ID_RE.test(input.requestId)) throw bad('bad-request-id', 'הבקשה לא תקינה. נסו שוב.');
  const notFound = () => new HttpsError('not-found', 'הפריט לא נמצא (ייתכן שכבר הוסר).', { reason: 'item-not-found' });
  if (input.file !== undefined) return removeFile(who, input, key, base);
  if (typeof input.id !== 'string' || !ID_RE.test(input.id)) throw notFound();
  const ctx = context(key, base);
  const db = getFirestore();
  const ref = db.doc(`${ITEMS}/${input.id}`);
  const plan = await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) throw notFound();
    const x = s.data();
    if (x.status === 'removed') return { kind: 'done', x };
    if (!ON_LINE.includes(x.status)) throw notFound();
    if (x.slot === 'opening') throw bad('bad-slot', 'את הודעת הפתיחה אי אפשר להסיר, רק להחליף.');
    if (isLocked(x, Date.now())) throw busy();
    if (!safePath(x.path)) { logger.error('yemot-line: unsafe path refused', { reason: 'unsafe-path', id: input.id }); throw notFound(); }
    const now = new Date().toISOString();
    tx.update(ref, { lockAt: now, lockReq: input.requestId, updatedAt: now });
    return { kind: 'work', x };
  });
  const ok = { ok: true, id: input.id, removed: true, message: 'הפריט הוסר מהקו.' };
  if (plan.kind === 'done') return Object.assign(ok, { duplicate: true });
  const x = plan.x;
  const stamp = () => new Date().toISOString();
  const failed = async (e) => {
    await ref.update({ status: 'remove-failed', error: 'delete-' + (e.code || 'internal'), uncertain: !!(e instanceof YemotError && e.code === 'timeout'), lockAt: null, lockReq: null, updatedAt: stamp() });
    logger.warn('yemot-line: remove failed', { reason: 'yemot-remove-failed', code: e.code, id: input.id });
    return new HttpsError('unavailable', 'ההסרה מהקו נכשלה. נסו שוב.', { reason: 'yemot-remove-failed' });
  };
  try {
    let names;
    try { names = await listDir(ctx, x.ext); } catch (e) { throw await failed(e); }
    const file = x.path.split('/').pop();
    if (names.includes(file)) {
      try { await deleteFiles(ctx, [x.path]); } catch (e) { throw await failed(e); }
    }
    await ref.update({ status: 'removed', removedAt: stamp(), removedBy: who.uid, uncertain: false, error: names.includes(file) ? null : 'already-missing', lockAt: null, lockReq: null, updatedAt: stamp() });
    return ok;
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    try { await ref.update({ lockAt: null, lockReq: null, updatedAt: stamp() }); } catch (e2) { /* */ }
    throw e;
  }
}

// ---------------- מחיקה לפי שם קובץ – שלוחה 4 בלבד (סבב 3) ----------------
// קלט: { requestId, ext:'4', file:'NNN.<סיומת>' }. קובץ אחד בנתיב מדויק (FileAction delete), אף פעם לא תיקייה.
// גם הקובץ הוותיק 000. פריט של השרת באותו נתיב מסומן removed. ניסיון חוזר אחרי הצלחה: "כבר לא בקו".
const FILE_RE = /^\d{3}\.[A-Za-z0-9]{1,5}$/;
async function removeFile(who, input, key, base) {
  // FILE_RE – צורת השם; voice.isDeletableContent – רשימה סגורה של סיומות קול (tts/wav). שם אחר (למשל 001.ini) נדחה בלי פנייה לימות.
  if (input.ext !== '4' || typeof input.file !== 'string' || !FILE_RE.test(input.file) || !voice.isDeletableContent(input.file)) throw bad('bad-file', 'אפשר למחוק מהאפליקציה רק קובצי תוכן בשלוחה 4.');
  const path = `ivr2:4/${input.file}`;
  if (!safePath(path)) throw bad('bad-file', 'אפשר למחוק מהאפליקציה רק קובצי תוכן בשלוחה 4.');
  const ctx = context(key, base);
  const db = getFirestore();
  const lockRef = db.doc(SLOTS.hours.state);
  await db.runTransaction(async (tx) => {
    const l = await tx.get(lockRef);
    if (l.exists && isLocked(l.data(), Date.now()) && l.get('lockReq') !== input.requestId) throw busy();
    tx.set(lockRef, { lockAt: new Date().toISOString(), lockReq: input.requestId, updatedAt: new Date().toISOString() }, { merge: true });
  });
  const unlock = () => lockRef.set({ lockAt: null, lockReq: null, updatedAt: new Date().toISOString() }, { merge: true }).catch(() => {});
  try {
    let names;
    try { names = await listDir(ctx, '4'); } catch (e) {
      logger.warn('yemot-line: remove file failed', { reason: 'yemot-remove-failed', code: e.code });
      throw new HttpsError('unavailable', 'ההסרה מהקו נכשלה. נסו שוב.', { reason: 'yemot-remove-failed' });
    }
    const items = (await db.collection(ITEMS).where('path', '==', path).get()).docs.filter((d) => ON_LINE.includes(d.get('status')));
    const mark = (extra) => Promise.all(items.map((d) => d.ref.update(Object.assign({ status: 'removed', removedAt: new Date().toISOString(), removedBy: who.uid, uncertain: false, lockAt: null, lockReq: null, updatedAt: new Date().toISOString() }, extra))));
    if (!names.includes(input.file)) { await mark({ error: 'already-missing' }); return { ok: true, file: input.file, removed: true, duplicate: true, message: 'הקובץ כבר לא בקו.' }; }
    try { await deleteFiles(ctx, [path]); } catch (e) {
      await Promise.all(items.map((d) => d.ref.update({ status: 'remove-failed', error: 'delete-' + (e.code || 'internal'), updatedAt: new Date().toISOString() })));
      logger.warn('yemot-line: remove file failed', { reason: 'yemot-remove-failed', code: e.code });
      throw new HttpsError('unavailable', 'ההסרה מהקו נכשלה. נסו שוב.', { reason: 'yemot-remove-failed' });
    }
    await mark({ error: null });
    return { ok: true, file: input.file, removed: true, duplicate: false, message: 'הקובץ הוסר מהקו.' };
  } finally { await unlock(); }
}

// ---------------- listLineFiles – הקבצים בשלוחה 4 כפי שהם בקו (מנהל, סבב 3) ----------------
// קלט { ext:'4' }. פלט: קובצי תוכן בלבד (NNN.<סיומת>), מהגבוה לנמוך – סדר ההשמעה. ext.ini וקובצי M* לא מוצגים.
async function listFiles(request, key, base) {
  const who = await requireStaff(request);
  const input = inputObject(request);
  if (who.role !== 'manager') throw new HttpsError('permission-denied', 'הפעולה הזו מותרת למנהל בלבד.', { reason: 'manager-only' });
  if (input.ext !== '4') throw bad('bad-slot', 'השלוחה לא מוכרת.');
  const ctx = context(key, base);
  const db = getFirestore();
  let names;
  try { names = await listDir(ctx, '4'); } catch (e) {
    logger.warn('yemot-line: list failed', { reason: 'yemot-list-failed', code: e.code });
    throw new HttpsError('unavailable', 'לא הצלחנו לקרוא את השלוחה מהקו. נסו שוב.', { reason: 'yemot-list-failed' });
  }
  const items = new Map();
  for (const d of (await db.collection(ITEMS).where('slot', '==', 'hours').get()).docs) if (ON_LINE.includes(d.get('status'))) items.set(d.get('file'), d);
  const files = names.filter((n) => FILE_RE.test(n)).sort().reverse().map((name) => {
    const d = items.get(name);
    return { name, legacy: !d, deletable: voice.isDeletableContent(name), item: d ? { id: d.id, title: d.get('title') || '', until: d.get('until') || null, temporary: !!d.get('temporary'), createdAt: d.get('createdAt') || null } : null };
  });
  return { ok: true, ext: '4', files };
}

// ---------------- runLineExpiry – הודעות זמניות בשלוחה 4 (נקראת מ-expirePromosOnLine) ----------------
// until = היום האחרון שבו ההודעה מושמעת (כמו במבצעים). נמחקת בריצה הראשונה שאחריו (00:15 שעון ישראל).
// מוחקת רק פריט זמני של השרת בשלוחה 4, בנתיב ivr2:4/NNN (001-999). קובץ שכבר נעלם – removed. כשל – remove-failed, וניסיון בלילה הבא.
async function runLineExpiry(opts) {
  const o = opts || {};
  const db = getFirestore();
  const today = israelDay(o.now);
  const out = { today, checked: 0, removed: 0, missing: 0, failed: 0, skipped: 0 };
  const key = o.key !== undefined ? o.key : YEMOT_API_KEY.value();
  if (!key) { logger.error('yemot-line: expiry without key', { reason: 'no-key' }); return Object.assign(out, { error: 'no-key' }); }
  const ctx = { key, base: apiBase(o.base !== undefined ? o.base : YEMOT_API_BASE.value()), timeoutMs: o.timeoutMs || YEMOT_TIMEOUT_MS.value() };
  const nowMs = Date.now();
  const holds = (x) => ON_LINE.includes(x.status) || (x.status === 'failed' && x.uncertain) || (x.status === 'uploading' && !isLocked(x, nowMs));
  const all = (await db.collection(ITEMS).where('slot', '==', 'hours').get()).docs;
  const isDue = (x) => x.temporary === true && typeof x.until === 'string' && x.until < today && holds(x) && !isLocked(x, nowMs);
  const due = all.filter((d) => isDue(d.data()));
  // נתיב שרשומה אחרת (שלא יורדת עכשיו) מחזיקה – לא מוחקים, כדי לא למחוק הודעה חדשה שקיבלה את אותו מספר (כמו runExpiry במבצעים)
  const keep = new Set(all.filter((d) => { const x = d.data(); return x.path && !isDue(x) && (holds(x) || isLocked(x, nowMs)); }).map((d) => d.get('path')));
  out.checked = due.length;
  if (!due.length) return out;
  let names;
  try { names = await listDir(ctx, '4'); } catch (e) { logger.error('yemot-line: expiry dir failed', { reason: 'dir-failed', code: e.code }); return Object.assign(out, { error: 'dir-failed' }); }
  for (const d of due) {
    const x = d.data();
    const now = new Date().toISOString();
    const m = /^ivr2:4\/(\d{3})\.[A-Za-z0-9]+$/.exec(String(x.path || ''));
    if (!m || Number(m[1]) < 1) { out.skipped++; continue; } // רק קובץ ממוספר שהשרת העלה, אף פעם לא 000
    if (keep.has(x.path)) { await d.ref.update({ status: x.status === 'failed' || x.status === 'uploading' ? 'failed' : 'removed', removedAt: now, updatedAt: now, uncertain: false, error: 'path-reused' }); out.skipped++; continue; }
    if (!names.includes(x.path.split('/').pop())) {
      await d.ref.update({ status: x.status === 'failed' || x.status === 'uploading' ? 'failed' : 'removed', removedAt: now, updatedAt: now, uncertain: false, error: 'expired-missing' });
      out.missing++; continue;
    }
    try {
      await deleteFiles(ctx, [x.path]);
      await d.ref.update({ status: 'removed', removedAt: now, removedBy: 'expiry', updatedAt: now, uncertain: false, error: null });
      out.removed++;
    } catch (e) {
      await d.ref.update({ status: 'remove-failed', error: 'delete-' + (e.code || 'internal'), updatedAt: now });
      out.failed++;
    }
  }
  logger.info('yemot-line: expiry done', out);
  return out;
}

// ---------------- getLineState (עובד ומנהל, בלי פנייה לימות) ----------------
async function lineState(request) {
  const who = await requireStaff(request);
  const input = inputObject(request);
  const mgr = who.role === 'manager';
  const allowed = mgr ? SLOT_NAMES : ['recipes', 'updates'];
  let want = allowed;
  if (input.slots !== undefined) {
    if (!Array.isArray(input.slots) || input.slots.length > SLOT_NAMES.length || !input.slots.every(isSlot)) throw bad('bad-input', 'קלט לא תקין');
    want = allowed.filter((s) => input.slots.includes(s)); // עובד שמבקש hours/opening – פשוט לא מקבל
  }
  const db = getFirestore();
  const slots = {};
  for (const slot of want) {
    const docs = (await db.collection(ITEMS).where('slot', '==', slot).get()).docs
      .filter((d) => !['removed', 'replaced'].includes(d.get('status')))
      .sort((a, b) => String(b.get('createdAt')).localeCompare(String(a.get('createdAt'))))
      .slice(0, 50);
    const list = docs.map((d) => ({ id: d.id, title: d.get('title') || '', file: d.get('file') || null, status: d.get('status'), createdAt: d.get('createdAt') || null, byRole: d.get('byRole') || null, until: d.get('until') || null }));
    if (slot === 'opening') {
      const cur = docs.find((d) => d.get('status') === 'live');
      slots.opening = { mode: 'file', current: cur ? { id: cur.id, text: cur.get('text') || '', createdAt: cur.get('createdAt') || null } : null, items: list };
    } else slots[slot] = list;
  }
  await ensureLexiconSeed(db);
  const lx = await db.doc(LEXICON_DOC).get();
  // הקול: איזה מנוע מוגדר, ול"שמע קודם" – האם יש קול אמיתי. למנהל גם מצב הגבול החודשי (כדי להתריע לפני שנגמר).
  const engine = voice.configuredEngine();
  const vInfo = { engine, preview: engine === 'elevenlabs' ? 'voice' : 'phone' };
  if (mgr && engine === 'elevenlabs') { try { vInfo.quota = await voice.quotaView(); } catch (e) { vInfo.quota = null; } }
  return {
    voice: vInfo,
    ok: true, role: who.role, slots, lexicon: lx.exists && typeof lx.get('text') === 'string' ? lx.get('text') : '',
    limits: { recipes: YEMOT_RECIPE_MAX.value(), updates: 800, hours: 600, opening: 600, recordSec: YEMOT_REC_MAX_SEC.value(), recordBytes: REC_MAX_BYTES, tempMaxDays: YEMOT_TEMP_MAX_DAYS.value() },
    preview: 'phone', structure: 'off',
  };
}

// ---------------- previewVoice – "שמע קודם" בקול האמיתי (עובד ומנהל) ----------------
// קלט { text }. אותו עיבוד בדיוק כמו בשליחה (ניקוי ← מילון), ולכן אותו hash: שליחה של אותו נוסח משתמשת בשמע מהמטמון
// בלי פנייה נוספת ל-ElevenLabs. מגבלה יומית לכל משתמש (VOICE_PREVIEW_DAILY). כשל = האפליקציה משמיעה בקול הטלפון.
async function previewItem(request) {
  const who = await requireStaff(request);
  const input = inputObject(request);
  if (typeof input.text !== 'string') throw bad('empty-text', 'אין נוסח להשמעה.');
  const clean = cleanText(input.text);
  if (!clean) throw bad('empty-text', 'אין נוסח להשמעה.');
  const max = YEMOT_RECIPE_MAX.value() || 2500;
  if (clean.length > max) throw bad('text-too-long', `הנוסח ארוך מדי (עד ${max} תווים).`, { max });
  const spoken = applyLexicon(clean, await loadLexicon(getFirestore()));
  try {
    const r = await voice.preview(spoken, who.uid);
    return { ok: true, mime: r.mime, data: r.data, cached: r.cached, spoken };
  } catch (e) {
    if (e instanceof voice.VoiceError) throw voice.toHttps(e, who.role === 'manager');
    throw e;
  }
}

// עטיפה: כל שגיאה שאינה HttpsError → "internal" בעברית, בלי פרטים (אולי מכילים טקסט מימות)
const wrap = (name, fn) => async (request) => {
  try { return await fn(request); } catch (e) {
    if (e instanceof HttpsError) throw e;
    logger.error(`yemot-line: ${name} failed`, { reason: 'internal', name: e && e.name });
    throw new HttpsError('internal', 'שגיאה בפעולה מול הקו.', { reason: 'internal' });
  }
};

exports.publishLineItem = onCall({ secrets: [YEMOT_API_KEY, voice.ELEVENLABS_API_KEY], timeoutSeconds: 120 }, wrap('publish', (r) => publishItem(r, YEMOT_API_KEY.value(), YEMOT_API_BASE.value())));
exports.removeLineItem = onCall({ secrets: [YEMOT_API_KEY], timeoutSeconds: 60 }, wrap('remove', (r) => removeItem(r, YEMOT_API_KEY.value(), YEMOT_API_BASE.value())));
exports.getLineState = onCall(wrap('state', (r) => lineState(r)));
exports.previewVoice = onCall({ secrets: [voice.ELEVENLABS_API_KEY], timeoutSeconds: 120 }, wrap('preview', (r) => previewItem(r)));
exports.listLineFiles = onCall({ secrets: [YEMOT_API_KEY], timeoutSeconds: 60 }, wrap('list', (r) => listFiles(r, YEMOT_API_KEY.value(), YEMOT_API_BASE.value())));
// נקראת מ-expirePromosOnLine (yemot.js). לא נספרת כפונקציה.
Object.defineProperty(exports, 'runLineExpiry', { enumerable: false, value: runLineExpiry });

// לבדיקות בלבד (לא נספרים כפונקציות): הליבה, כדי לקרוא לה בתוך תהליך הבדיקה עם voice.js מוחלף או פסק זמן קצר.
Object.defineProperty(exports, '_core', { enumerable: false, value: { publishItem, removeItem, lineState, listFiles, previewItem, runLineExpiry, parseWav, safePath, SLOTS } });
