'use strict';
// "ההודעות שבקו" – משימה 2026-11-04, שלב 5 (חוזה 5.5.3–5.5.8):
//   getLineBoard    – לכל שלוחה: מה שבקו בפועל (קריאת התיקייה), מסומן "מהאפליקציה" או "קובץ ותיק", ומה שירד ב-7 הימים האחרונים (שעון ישראל).
//                     עובד: מתכונים, מבצעים, עדכונים. מנהל: הכול. קריאה בלבד.
//   getLineAudio    – האזנה: שמע שמור (Storage) ← נוסח (הקראה בטלפון, קירוב) ← הורדה מהקו (נספרת במכסה יומית).
//   extendLineItem  – מנהל: שינוי תאריך ההורדה במבצעים ובהודעות זמניות בשלוחה 4. שינוי ברשומה בלבד – בלי שום פנייה לימות.
//   restoreLineItem – מנהל: החזרה לקו של הודעה שירדה בשבוע האחרון. העלאה חדשה (מספר חדש, יושמע ראשון), בלי צינתוק, עם requestId.
//                     הרשומה המקורית לא משתנה; החדשה מציינת restoredFrom. קובץ ותיק חוזר לשמו המקורי רק אם השם פנוי.
//   הורדת מבצע (removePromo) וגיבוי קובץ ותיק (backupLegacy) – נקראים מ-removeLineItem (yemot-line.js).
//   cleanLineAudio  – (לא פונקציה מיוצאת) נקראת מריצת הלילה: מוחקת עותקי שמע ב-line_audio/ 8 ימים אחרי הירידה.
// עקרונות: התפקיד נקבע בשרת (requireStaff), קודם הרשאה ורק אחר כך פנייה לימות/Storage. המפתח רק בכותרת, לא ביומן ולא בתשובה.
// מחיקה מהקו – רק נתיב מדויק אחד (safeFilePath / staleRe), אף פעם לא תיקייה, ext.ini או M*. רק שדות ורשומות חדשים, בלי מיגרציה.

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret, defineString } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const roles = require('./lib/roles');
const T = require('./lib/tenant');
const { inputObject } = roles;
// ריבוי עסקים (שלב 5): פונקציות הקו – רק כשהתוספת yemot מופעלת בעסק, ורק בעסק שמחובר לקו (היום: largpeami בלבד).
// עסק אחר מקבל yemot-not-connected לפני כל פנייה לימות. הנתונים (T.tdb()) בתוך העסק; בשורש ללארג' פעמי במצב legacy.
const requireStaff = (request) => roles.requireStaff(request, { feature: 'yemot', yemotLine: true });
const { YemotError, listDirInfo, downloadFile, readText, deleteFiles } = require('./lib/yemot-client');
const voice = require('./lib/voice');
const { applyLexicon } = require('./lib/lexicon');
const Y = require('./yemot');
const L = require('./yemot-line');

const { cleanText, israelDay, addDays, validDay, loadLexicon, LOCK_MS, staleRe, holdsPath, isLocked, readCfg, heDate } = Y.shared;
const YEMOT_API_KEY = defineSecret('YEMOT_API_KEY');
const YEMOT_API_BASE = defineString('YEMOT_API_BASE', { default: 'https://www.call2all.co.il/ym/api/', description: 'כתובת ה-API של ימות המשיח' });

// חוזה 5.1
const RESTORE_DAYS = 7;         // "השבוע האחרון": יום הירידה ≥ היום פחות 6 (שעון ישראל, ימים קלנדריים)
const AUDIO_KEEP_DAYS = 8;      // עותק שמע נמחק כשהיום ≥ יום הירידה + 8
const ORPHAN_MS = 48 * 3600000; // עותק בלי רשומה מתאימה – נמחק אחרי יומיים
const BOARD_CACHE_MS = 120000;  // מטמון רשימת הקו
const BOARD_REFRESH_MS = 15000; // "רענון": לא יותר מקריאה אחת ב-15 שניות לשלוחה (אם שום דבר לא השתנה)
const LISTEN_LINE_DAILY = 60;   // האזנות מהקו (הורדה/קריאה) לכל משתמש ביום
const LISTEN_MAX_BYTES = 3000000;
const TEXT_BACKUP_MAX = 20000;
const RECENT_MAX = 60;
const TEXT_OUT_MAX = 5000;

const ITEMS = 'yemot_items';
const PROMOS = 'yemot_promos';
const BACKUPS = 'yemot_line_backups';
const ON_LINE = ['live', 'remove-failed'];
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const BACKUP_ID_RE = /^\d{8}-\d{6}-[A-Za-z0-9]{1,6}$/;
const RESTORE_REQ_RE = /^[A-Za-z0-9_-]{8,56}$/;
const SLOT_EXT = { recipes: '1', promos: null, updates: '3', hours: '4', opening: '' }; // promos = YEMOT_EXT (ברירת מחדל '2')
const EMP_SLOTS = ['recipes', 'promos', 'updates'];
const EXT_SLOT = { 1: 'recipes', 2: 'promos', 3: 'updates', 4: 'hours' };
const CONTENT_RE = /^\d{3}\.[A-Za-z0-9]{1,5}$/;
const OPENING_RE = /^M1000\.[A-Za-z0-9]{1,5}$/;

const bad = (reason, message, extra) => new HttpsError('invalid-argument', message, Object.assign({ reason }, extra || {}));
const pre = (reason, message, extra) => new HttpsError('failed-precondition', message, Object.assign({ reason }, extra || {}));
const managerOnly = () => new HttpsError('permission-denied', 'הפעולה הזו מותרת למנהל בלבד.', { reason: 'manager-only' });
const slotManagerOnly = () => new HttpsError('permission-denied', 'רק מנהל יכול לראות את השלוחה הזו.', { reason: 'slot-manager-only' });
const notFound = () => new HttpsError('not-found', 'הפריט לא נמצא (ייתכן שכבר הוסר).', { reason: 'item-not-found' });
const busy = () => new HttpsError('aborted', 'פעולה אחרת על הקו בטיפול. נסו שוב בעוד רגע.', { reason: 'busy' });
const uncertainErr = () => new HttpsError('aborted', 'מצב הפריט בקו עוד לא ברור. רעננו ונסו שוב בעוד דקה.', { reason: 'item-uncertain' });
const removeFailed = () => new HttpsError('unavailable', 'ההסרה מהקו נכשלה. נסו שוב.', { reason: 'yemot-remove-failed' });
const backupFailed = () => new HttpsError('unavailable', 'לא הצלחנו לשמור עותק של מה שבקו, ולכן שום דבר לא נמחק ולא הוחלף. נסו שוב מאוחר יותר.', { reason: 'backup-failed' });
const noBackupConfirm = () => pre('no-backup-confirm', 'אין עותק שמור של ההקלטה הזו. אחרי ההורדה לא יהיה אפשר להחזיר אותה. לאשר?');
const stamp = () => new Date().toISOString();

const isMgr = (who) => who.role === 'manager';
const extOfSlot = (slot) => (slot === 'promos' ? String(readCfg().ext) : SLOT_EXT[slot]);
const hasText = (x) => typeof x.text === 'string' && x.text.trim() !== '';
const savedPath = (x) => (typeof x.audioPath === 'string' && x.audioPath && !x.audioPurgedAt ? x.audioPath : null);
// רשומה ישנה בלי kind = נוסח (הערת הבודק בשלב 4: גם kind:null)
const kindOf = (x) => (x.kind === 'audio' ? 'audio' : 'text');
const dayOf = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? israelDay(new Date(t)) : null; };
const inRestoreWindow = (day, today) => !!day && day >= addDays(today, -(RESTORE_DAYS - 1)) && day <= today;
// המנוע שבו יוקרא נוסח בהחזרה: מקור בקול הממוחשב ← ממוחשב (בלי עלות); אחרת – הבחירה בבקשה או המוגדר בשרת
function textEngine(x, requested) {
  if (x.engine === 'yemot-tts' || voice.isTextFile(x.path || '')) return 'yemot-tts';
  return voice.pickEngine(requested);
}

function ctxOf(key, base) {
  if (!key) throw pre('no-key', 'הקו הטלפוני עוד לא מחובר בשרת. פנו למנהל.');
  return L._core.context(key, base);
}

// ---------------- רשומות של שלוחה ----------------
// מחזיר: online (Map path → {kind, doc, certain}), certain (רשומות "בקו" בוודאות), down (רשומות שירדו), changedAt (העדכון האחרון).
async function loadRecords(db, slot, ext) {
  const cutoff = new Date(Date.now() - (RESTORE_DAYS + 2) * 86400000).toISOString();
  const online = new Map(), certain = [], down = [];
  let changedAt = '';
  const seen = (x) => { for (const f of ['updatedAt', 'removedAt', 'finishedAt', 'createdAt']) if (typeof x[f] === 'string' && x[f] > changedAt) changedAt = x[f]; };
  if (slot === 'promos') {
    const act = (await db.collection(PROMOS).where('status', 'in', ON_LINE.concat('failed', 'uploading')).get()).docs;
    for (const d of act) {
      const x = d.data(); seen(x);
      if (!holdsPath(x)) continue;
      const sure = ON_LINE.includes(x.status) && !x.pending;
      const e = { kind: 'promo', doc: d, certain: sure };
      if (!online.has(x.path) || sure) online.set(x.path, e);
      if (ON_LINE.includes(x.status)) certain.push(e);
    }
    for (const d of (await db.collection(PROMOS).where('removedAt', '>=', cutoff).get()).docs) { const x = d.data(); seen(x); if (x.status === 'removed') down.push({ kind: 'promo', doc: d }); }
    const last = (await db.collection(PROMOS).orderBy('updatedAt', 'desc').limit(1).get()).docs[0];
    if (last) seen(last.data());
  } else {
    for (const d of (await db.collection(ITEMS).where('slot', '==', slot).get()).docs) {
      const x = d.data(); seen(x);
      if (ON_LINE.includes(x.status) || (x.status === 'failed' && x.uncertain) || x.status === 'uploading') {
        if (!x.path) continue;
        const sure = ON_LINE.includes(x.status);
        const e = { kind: 'item', doc: d, certain: sure };
        if (!online.has(x.path) || sure) online.set(x.path, e);
        if (sure) certain.push(e);
      } else if (['removed', 'replaced'].includes(x.status)) down.push({ kind: 'item', doc: d });
    }
  }
  if (ext !== '') {
    for (const d of (await db.collection(BACKUPS).where('ext', '==', ext).get()).docs) { const x = d.data(); seen(x); if (x.status === 'complete' && ['applied', 'uncertain'].includes(x.result)) down.push({ kind: 'backup', doc: d }); }
  }
  return { online, certain, down, changedAt };
}

// ---------------- getLineBoard ----------------
async function board(request, key, base) {
  const who = await requireStaff(request);
  const input = inputObject(request);
  const mgr = isMgr(who);
  const slot = input.slot;
  if (typeof slot !== 'string' || !Object.hasOwn(SLOT_EXT, slot)) throw bad('bad-slot', 'השלוחה לא מוכרת.');
  if (!mgr && !EMP_SLOTS.includes(slot)) throw slotManagerOnly();
  if (input.refresh !== undefined && typeof input.refresh !== 'boolean') throw bad('bad-input', 'קלט לא תקין');
  const db = T.tdb();
  const ext = extOfSlot(slot);
  const recs = await loadRecords(db, slot, ext);

  // 1. התיקייה: מטמון (120 שניות, או 15 ב"רענון"), אלא אם משהו השתנה במסד אחרי הקריאה האחרונה (העלאה/הורדה/החזרה/לילה)
  const cacheRef = db.doc(`yemot_state/board-${slot}`);
  const c = await cacheRef.get();
  const cache = c.exists && Array.isArray(c.get('files')) ? c.data() : null;
  const age = cache ? Date.now() - Date.parse(cache.fetchedAt || '') : Infinity;
  const changed = !!cache && (cache.stale === true || recs.changedAt > cache.fetchedAt);
  let files, fetchedAt, cached = false, stale = false;
  if (cache && !changed && age < (input.refresh === true ? BOARD_REFRESH_MS : BOARD_CACHE_MS)) {
    files = cache.files; fetchedAt = cache.fetchedAt; cached = true;
  } else {
    try {
      const ctx = ctxOf(key, base);
      const all = await listDirInfo(ctx, ext);
      const re = slot === 'opening' ? OPENING_RE : CONTENT_RE;
      files = all.filter((f) => re.test(f.name)).map((f) => ({ name: f.name, size: f.size, duration: f.duration, date: f.date }));
      fetchedAt = stamp();
      await cacheRef.set({ fetchedAt, files, stale: false });
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      logger.warn('yemot-board: list failed', { reason: 'yemot-list-failed', code: e && e.code });
      if (!cache) throw new HttpsError('unavailable', 'לא הצלחנו לקרוא את השלוחה מהקו. נסו שוב.', { reason: 'yemot-list-failed' });
      files = cache.files; fetchedAt = cache.fetchedAt; cached = true; stale = true;
    }
  }

  // 2. "בקו עכשיו": כל קובץ בתיקייה, מהגבוה לנמוך (סדר ההשמעה)
  const restoredLive = new Set();
  for (const e of recs.online.values()) { const r = e.doc.get('restoredFrom'); if (r && r.id) restoredLive.add(`${r.kind}:${r.id}`); }
  const names = new Set(files.map((f) => f.name));
  // קובץ ותיק שהוחזר (yemot_state/restore-*): "כבר הוחזר" רק כל עוד הקובץ שהוחזר עדיין בתיקייה (סבב תיקון 1, הערה 1)
  if (ext !== '') {
    for (const d of (await db.collection('yemot_state').where('restoredFrom.kind', '==', 'backup').get()).docs) {
      if (d.get('status') === 'live' && d.get('ext') === ext && names.has(d.get('file'))) restoredLive.add(`backup:${d.get('restoredFrom.id')}`);
    }
  }
  const onLine = files.slice().sort((a, b) => (a.name < b.name ? 1 : -1)).map((f) => {
    const e = recs.online.get(voice.pathOf(ext, f.name));
    if (!e) {
      const isText = voice.isTextFile(f.name);
      const deletable = slot !== 'opening' && voice.isDeletableContent(f.name);
      return {
        ref: { kind: 'file', ext, file: f.name }, file: f.name, origin: 'legacy', title: 'קובץ ותיק', kind: isText ? 'text' : voice.isAudioFile(f.name) ? 'audio' : 'unknown',
        createdAt: null, byRole: null, until: null, temporary: false, durationSec: f.duration, size: f.size, uncertain: false,
        listen: !voice.isListenable(f.name) ? 'none' : isText ? 'text' : 'line',
        actions: { remove: mgr && deletable, extend: false },
      };
    }
    const x = e.doc.data();
    const unsure = !e.certain || !!x.uncertain;
    const locked = isLocked(x, Date.now());
    const listen = savedPath(x) ? 'saved' : hasText(x) ? 'text' : kindOf(x) === 'audio' && e.certain ? 'line' : 'none';
    const canExtend = mgr && !unsure && x.status === 'live' && (e.kind === 'promo' || (slot === 'hours' && x.temporary === true));
    return {
      ref: { kind: e.kind, id: e.doc.id, ext, file: f.name }, file: f.name, origin: 'app', title: titleOf(e.kind, x), kind: kindOf(x),
      createdAt: x.createdAt || null, byRole: x.byRole || null, until: x.until || null, temporary: e.kind === 'promo' ? true : !!x.temporary,
      durationSec: x.durationSec || f.duration || null, size: f.size, uncertain: unsure, listen,
      actions: { remove: mgr && slot !== 'opening' && !unsure && !locked, extend: canExtend },
    };
  });
  // רשומה "בקו" שהקובץ שלה לא בתיקייה (אולי נמחק ידנית בימות)
  const missing = recs.certain.filter((e) => !names.has(String(e.doc.get('path')).split('/').pop()))
    .map((e) => ({ ref: { kind: e.kind, id: e.doc.id }, title: titleOf(e.kind, e.doc.data()), file: e.doc.get('file') || null }));

  // 3. "ירדו בשבוע האחרון"
  const today = israelDay();
  const recent = [];
  for (const e of recs.down) {
    const x = e.doc.data();
    const downAt = e.kind === 'backup' ? x.finishedAt || x.createdAt : x.removedAt || (x.status === 'replaced' ? x.updatedAt : null);
    if (!inRestoreWindow(dayOf(downAt), today)) continue;
    // גיבוי שהמחיקה שלו לא ודאית: "ירד" רק אם הקובץ באמת לא בתיקייה
    if (e.kind === 'backup' && x.result === 'uncertain' && names.has(x.file)) continue;
    const saved = e.kind === 'backup' ? (x.storagePath && !x.purgedAt ? x.storagePath : null) : savedPath(x);
    const txt = e.kind === 'backup' ? typeof x.text === 'string' && x.text !== '' && !x.purgedAt : hasText(x);
    const downReason = e.kind === 'backup' ? 'legacy-removed' : x.status === 'replaced' ? 'replaced' : (e.kind === 'promo' ? x.removedVia === 'app' : x.removedBy !== 'expiry') ? 'removed' : 'expired';
    const already = restoredLive.has(`${e.kind}:${e.doc.id}`);
    recent.push({
      ref: { kind: e.kind, id: e.doc.id }, title: e.kind === 'backup' ? `קובץ ותיק ${x.file}` : titleOf(e.kind, x), kind: e.kind === 'backup' ? x.kind : kindOf(x),
      file: x.file || null, downAt, downReason, until: x.until || null, hasSavedAudio: !!saved, alreadyRestored: already,
      restore: {
        allowed: mgr && !already && (!!saved || txt),
        needsUntil: e.kind === 'promo' || (slot === 'hours' && x.temporary === true),
        costNote: e.kind !== 'backup' && !saved && txt && textEngine(x) === 'elevenlabs',
      },
    });
  }
  recent.sort((a, b) => (a.downAt < b.downAt ? 1 : -1));
  return { ok: true, slot, ext, fetchedAt, cached, stale, canManage: mgr, onLine, missing, recent: recent.slice(0, RECENT_MAX) };
}
function titleOf(kind, x) {
  if (x.title) return String(x.title);
  if (kind === 'promo') return (x.source && x.source.name) || (hasText(x) ? cleanText(x.text).slice(0, 60) : 'מבצע');
  return hasText(x) ? cleanText(x.text).slice(0, 60) : 'הודעה';
}

// ---------------- getLineAudio ----------------
// מכסה יומית להאזנות מהקו (yemot_state/listen-<uid>, אוסף סגור). שמע שמור ונוסח – בלי הגבלה.
async function takeListen(db, uid) {
  const ref = db.doc(`yemot_state/listen-${uid}`);
  const day = israelDay();
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const used = s.exists && s.get('day') === day ? Number(s.get('count')) || 0 : 0;
    if (used >= LISTEN_LINE_DAILY) throw new HttpsError('resource-exhausted', 'הגעתם למכסת ההאזנות מהקו להיום. נסו שוב מחר.', { reason: 'listen-limit', limit: LISTEN_LINE_DAILY });
    tx.set(ref, { day, count: used + 1, updatedAt: stamp() });
  });
}
async function giveBackListen(db, uid) {
  const ref = db.doc(`yemot_state/listen-${uid}`);
  const day = israelDay();
  try {
    await db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      if (s.exists && s.get('day') === day && Number(s.get('count')) > 0) tx.update(ref, { count: Number(s.get('count')) - 1, updatedAt: stamp() });
    });
  } catch (e) { logger.warn('yemot-board: listen refund failed', { reason: 'listen-refund' }); }
}
const listenUnavailable = () => new HttpsError('unavailable', 'לא הצלחנו להביא את ההקלטה מהקו. נסו שוב.', { reason: 'listen-unavailable' });
const textReply = (t) => ({ ok: true, mode: 'text', text: cleanText(t).slice(0, TEXT_OUT_MAX), approx: true });

async function listen(request, key, base) {
  const who = await requireStaff(request);
  const input = inputObject(request);
  const ref = input.ref;
  if (!ref || typeof ref !== 'object' || Array.isArray(ref)) throw bad('bad-input', 'קלט לא תקין');
  const db = T.tdb();
  const cfg = readCfg();
  const allow = (slot) => { if (!isMgr(who) && !EMP_SLOTS.includes(slot)) throw slotManagerOnly(); };
  let x = null, slot = null, linePath = null, kind = ref.kind;
  if (kind === 'file') {
    const ext = ref.ext, file = ref.file;
    const okFile = voice.isListenable(file) && ((typeof ext === 'string' && ['1', '2', '3', '4'].includes(ext) && /^\d{3}\./.test(file)) || (ext === '' && file.startsWith('M1000.')));
    if (!okFile) throw bad('bad-file', 'אי אפשר להשמיע את הקובץ הזה.');
    slot = ext === '' ? 'opening' : ext === String(cfg.ext) ? 'promos' : EXT_SLOT[ext];
    if (!slot) throw bad('bad-file', 'אי אפשר להשמיע את הקובץ הזה.');
    allow(slot);
    linePath = voice.pathOf(ext, file);
    // לקובץ יש רשומה של האפליקציה? אז משמיעים ממנה (שמע שמור / נוסח)
    const col = slot === 'promos' ? PROMOS : ITEMS;
    const d = (await db.collection(col).where('path', '==', linePath).get()).docs.find((q) => (slot === 'promos' ? ON_LINE.includes(q.get('status')) : ON_LINE.includes(q.get('status'))));
    if (d) { x = d.data(); kind = slot === 'promos' ? 'promo' : 'item'; }
  } else if (kind === 'item' || kind === 'promo') {
    if (typeof ref.id !== 'string' || !ID_RE.test(ref.id)) throw notFound();
    const s = await db.doc(`${kind === 'promo' ? PROMOS : ITEMS}/${ref.id}`).get();
    if (!s.exists) throw notFound();
    x = s.data();
    slot = kind === 'promo' ? 'promos' : x.slot;
    if (!Object.hasOwn(SLOT_EXT, slot || '')) throw notFound();
    allow(slot);
  } else if (kind === 'backup') {
    if (typeof ref.id !== 'string' || !BACKUP_ID_RE.test(ref.id)) throw notFound();
    const s = await db.doc(`${BACKUPS}/${ref.id}`).get();
    if (!s.exists) throw notFound();
    const b = s.data();
    slot = b.ext === String(cfg.ext) ? 'promos' : EXT_SLOT[b.ext];
    if (!slot) throw notFound();
    allow(slot);
    if (b.storagePath && !b.purgedAt) {
      const buf = await safeRead(b.storagePath);
      if (buf) return { ok: true, mode: 'audio', mime: 'audio/wav', data: buf.toString('base64'), durationSec: null, source: 'saved' };
    }
    if (typeof b.text === 'string' && b.text !== '' && !b.purgedAt) return textReply(b.text);
    throw listenUnavailable();
  } else throw bad('bad-input', 'קלט לא תקין');

  if (x) {
    // (1) שמע שמור
    const sp = savedPath(x);
    if (sp) {
      const buf = await safeRead(sp);
      if (buf) {
        if (buf.length > LISTEN_MAX_BYTES) throw pre('audio-too-big', 'הקובץ גדול מדי להשמעה באפליקציה.');
        return { ok: true, mode: 'audio', mime: x.audioMime || 'audio/wav', data: buf.toString('base64'), durationSec: x.durationSec || null, source: 'saved' };
      }
    }
    // (2) נוסח – הקראה בטלפון (קירוב, בלי עלות)
    if (hasText(x)) return textReply(x.text);
    // (3) הקלטה בלי עותק – רק אם הרשומה בקו בוודאות (אחרת הנתיב אולי שייך עכשיו להודעה אחרת)
    if (!ON_LINE.includes(x.status) || !x.path) throw listenUnavailable();
    const safe = kind === 'promo' ? (() => { const m = staleRe(cfg.ext).exec(x.path); return !!m && Number(m[1]) >= 1; })() : L._core.safePath(x.path);
    if (!safe) throw listenUnavailable();
    linePath = x.path;
  }
  // (3/4) מהקו: שמע ← DownloadFile; קובץ טקסט ← GetTextFile
  const ctx = ctxOf(key, base);
  await takeListen(db, who.uid);
  if (voice.isTextFile(linePath)) {
    try { return textReply(await readText(ctx, linePath)); } catch (e) { await giveBackListen(db, who.uid); logger.warn('yemot-board: listen text failed', { reason: 'listen-unavailable', code: e && e.code }); throw listenUnavailable(); }
  }
  try {
    const buf = await downloadFile(ctx, linePath, LISTEN_MAX_BYTES);
    return { ok: true, mode: 'audio', mime: 'audio/wav', data: buf.toString('base64'), durationSec: null, source: 'line' };
  } catch (e) {
    await giveBackListen(db, who.uid); // האזנה שנכשלה לא נספרת (סבב תיקון 1, הערה 4)
    if (e instanceof YemotError && e.code === 'too-big') throw pre('audio-too-big', 'הקובץ גדול מדי להשמעה באפליקציה.');
    logger.warn('yemot-board: listen failed', { reason: 'listen-unavailable', code: e && e.code });
    throw listenUnavailable();
  }
}
async function safeRead(full) {
  try { return await voice.readLineAudio(full); } catch (e) { logger.warn('yemot-board: saved audio not read', { reason: 'saved-read-failed' }); return null; }
}

// ---------------- גיבויים לפני הורדה ----------------
class BackupError extends Error { constructor(code) { super('backup:' + code); this.code = code; } }
// שמע מהקו: לא ריק, מתחיל ב-RIFF, וגודל זהה למה ש-GetIVR2Dir מחזיר (כשחוזר). מעל 3MB – לא מנסים (הערת הבודק, שלב 4).
async function fetchWav(ctx, path, info) {
  if (info && info.size !== null && info.size > LISTEN_MAX_BYTES) throw new BackupError('too-big');
  let buf;
  try { buf = await downloadFile(ctx, path, LISTEN_MAX_BYTES); } catch (e) { throw new BackupError(e instanceof YemotError ? 'download-' + e.code : 'download-internal'); }
  if (buf.length < 44 || buf.toString('latin1', 0, 4) !== 'RIFF') throw new BackupError('not-wav');
  if (info && info.size !== null && info.size !== buf.length) throw new BackupError('size-mismatch');
  return buf;
}
// לפני הורדת פריט של האפליקציה: הקלטה בלי עותק שמור ובלי נוסח ← ניסיון לשמור עותק מהקו. true = יש עותק (או נוסח, או שאין מה לשמור).
async function keepBeforeRemove(ctx, ref, x, rel, info) {
  if (savedPath(x) || hasText(x) || !voice.isAudioFile(x.path || '')) return true;
  try {
    const buf = await fetchWav(ctx, x.path, info);
    await ref.update(Object.assign(await voice.saveLineAudio(rel, buf, 'audio/wav'), { updatedAt: stamp() }));
    return true;
  } catch (e) {
    logger.warn('yemot-board: no copy before remove', { reason: 'no-backup', code: e && e.code });
    return false;
  }
}
// קובץ ותיק (בלי רשומה): גיבוי חובה ב-yemot_line_backups (+ Storage לשמע). מחזיר backupId, או זורק backup-failed.
// אותו requestId שוב (אחרי כשל במחיקה) ← משתמשים בגיבוי שכבר נשמר.
async function backupLegacy(ctx, db, who, requestId, ext, file, info) {
  const path = voice.pathOf(ext, file);
  const prev = (await db.collection(BACKUPS).where('opId', '==', requestId).get()).docs.find((d) => d.get('path') === path && d.get('status') === 'complete');
  if (prev) return prev.id;
  const t = new Date();
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    .formatToParts(t).map((q) => [q.type, q.value]));
  const backupId = `${p.year}${p.month}${p.day}-${p.hour}${p.minute}${p.second}-${requestId.replace(/[^A-Za-z0-9]/g, '').slice(-6) || 'x'}`;
  const ref = db.doc(`${BACKUPS}/${backupId}`);
  const kind = voice.isTextFile(file) ? 'text' : 'audio';
  const base = { reason: 'file', opId: requestId, ext, file, path, kind, lineSize: info ? info.size : null, itemRef: null, byUid: who.uid, createdAt: t.toISOString() };
  try {
    let rec;
    if (kind === 'text') {
      let text = null;
      try { text = await readText(ctx, path); } catch (e) {
        // GetTextFile לא עבד – ניסיון שני: הורדת הקובץ כטקסט
        try { const b = await downloadFile(ctx, path, TEXT_BACKUP_MAX * 4); text = b.toString('utf8'); } catch (e2) { throw new BackupError('text-' + (e.code || 'internal')); }
      }
      if (typeof text !== 'string' || text.trim() === '') throw new BackupError('empty');
      if (text.length > TEXT_BACKUP_MAX) throw new BackupError('too-long');
      rec = { text, bytes: Buffer.byteLength(text), storagePath: null };
    } else {
      const buf = await fetchWav(ctx, path, info);
      let saved;
      try { saved = await voice.saveLineAudio(`backups/${backupId}.wav`, buf, 'audio/wav'); } catch (e) { throw new BackupError('save-failed'); }
      rec = { storagePath: saved.audioPath, bytes: buf.length, text: null };
    }
    await ref.create(Object.assign({}, base, rec, { status: 'complete', result: 'pending', finishedAt: null, error: null }));
    return backupId;
  } catch (e) {
    logger.warn('yemot-board: legacy backup failed', { reason: 'backup-failed', code: e && e.code });
    try { await ref.create(Object.assign({}, base, { status: 'failed', result: 'not-applied', error: String((e && e.code) || 'internal').slice(0, 40), finishedAt: stamp() })); } catch (e2) { /* */ }
    throw backupFailed();
  }
}
// הקובץ כבר לא בקו: גיבוי complete של אותו נתיב (מהחלון האחרון) שהמחיקה שלו לא ודאית / לא הושלמה ← applied. מחזיר את המזהה או null.
async function settleBackup(db, path) {
  const cutoff = new Date(Date.now() - (RESTORE_DAYS + 1) * 86400000).toISOString();
  const ds = (await db.collection(BACKUPS).where('path', '==', path).get()).docs
    .filter((d) => d.get('status') === 'complete' && ['uncertain', 'not-applied', 'pending'].includes(d.get('result')) && String(d.get('createdAt') || '') >= cutoff)
    .sort((a, b) => (String(a.get('createdAt')) < String(b.get('createdAt')) ? 1 : -1));
  if (!ds.length) return null;
  await backupResult(db, ds[0].id, 'applied', null);
  return ds[0].id;
}
async function backupResult(db, backupId, result, error) {
  await db.doc(`${BACKUPS}/${backupId}`).update({ result, error: error || null, finishedAt: stamp() });
  await markStale(db, backupId);
}
async function markStale(db, backupId) {
  const b = await db.doc(`${BACKUPS}/${backupId}`).get();
  const slot = b.exists ? (b.get('ext') === String(readCfg().ext) ? 'promos' : EXT_SLOT[b.get('ext')]) : null;
  if (slot) await db.doc(`yemot_state/board-${slot}`).set({ stale: true }, { merge: true });
}

// מבצע שמחזיק את הנתיב הזה: promoKey, 'uncertain' (ייתכן שבקו, לא ודאי), או null
async function promoAt(db, path) {
  const ds = (await db.collection(PROMOS).where('path', '==', path).get()).docs.filter((d) => holdsPath(d.data()));
  const sure = ds.find((d) => ON_LINE.includes(d.get('status')) && !d.get('pending'));
  if (sure) return sure.id;
  return ds.length ? 'uncertain' : null;
}

// ---------------- removeLineItem { requestId, promoKey } – הורדת מבצע באמצע (מנהל) ----------------
// רק live/remove-failed, לא נעול, בלי pending. מחיקה רק בנתיב ivr2:<YEMOT_EXT>/NNN (001-999), כמו runExpiry. הרשומה לא נמחקת.
async function removePromo(who, input, key, base) {
  if (!isMgr(who)) throw managerOnly();
  if (typeof input.requestId !== 'string' || !ID_RE.test(input.requestId)) throw bad('bad-request-id', 'הבקשה לא תקינה. נסו שוב.');
  if (typeof input.promoKey !== 'string' || !ID_RE.test(input.promoKey)) throw notFound();
  if (input.confirmNoBackup !== undefined && typeof input.confirmNoBackup !== 'boolean') throw bad('bad-input', 'קלט לא תקין');
  const cfg = readCfg();
  const ctx = ctxOf(key, base);
  const db = T.tdb();
  const ref = db.doc(`${PROMOS}/${input.promoKey}`);
  const plan = await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) throw notFound();
    const x = s.data();
    if (x.status === 'removed') return { kind: 'done', x };
    if (!ON_LINE.includes(x.status)) { if (holdsPath(x)) throw uncertainErr(); throw notFound(); }
    if (isLocked(x, Date.now())) throw busy();
    if (x.pending) throw uncertainErr();
    const m = staleRe(cfg.ext).exec(String(x.path || ''));
    if (!m || Number(m[1]) < 1) { logger.error('yemot-board: unsafe promo path refused', { reason: 'unsafe-path', id: input.promoKey }); throw notFound(); }
    const now = stamp();
    tx.update(ref, { lockAt: now, lockReq: input.requestId, updatedAt: now });
    return { kind: 'work', x };
  });
  const ok = { ok: true, id: input.promoKey, promoKey: input.promoKey, removed: true, duplicate: false, message: 'המבצע הוסר מהקו.' };
  if (plan.kind === 'done') return Object.assign(ok, { duplicate: true });
  const x = plan.x;
  const unlock = () => ref.update({ lockAt: null, lockReq: null, updatedAt: stamp() }).catch(() => {});
  const failed = async (e) => {
    await ref.update({ status: 'remove-failed', error: 'delete-' + ((e && e.code) || 'internal'), uncertain: !!(e instanceof YemotError && e.code === 'timeout'), lockAt: null, lockReq: null, updatedAt: stamp() });
    logger.warn('yemot-board: promo remove failed', { reason: 'yemot-remove-failed', code: e && e.code, id: input.promoKey });
    return removeFailed();
  };
  try {
    let infos;
    try { infos = await listDirInfo(ctx, cfg.ext); } catch (e) { throw await failed(e); }
    const file = x.path.split('/').pop();
    const info = infos.find((f) => f.name === file);
    // הגנת path-reused (כמו runExpiry): מבצע אחר שמחזיק את אותו נתיב – לא מוחקים את הקובץ שלו
    const reused = (await db.collection(PROMOS).where('path', '==', x.path).get()).docs.some((d) => d.id !== input.promoKey && holdsPath(d.data()));
    if (info && !reused) {
      if (!(await keepBeforeRemove(ctx, ref, x, `promos/${input.promoKey}.wav`, info)) && input.confirmNoBackup !== true) { await unlock(); throw noBackupConfirm(); }
      try { await deleteFiles(ctx, [x.path]); } catch (e) { throw await failed(e); }
    }
    const now = stamp();
    await ref.update({ status: 'removed', removedAt: now, removedBy: who.uid, removedVia: 'app', uncertain: false, pending: null, error: reused ? 'path-reused' : info ? null : 'already-missing', lockAt: null, lockReq: null, updatedAt: now });
    return ok;
  } catch (e) {
    if (!(e instanceof HttpsError)) await unlock();
    throw e;
  }
}

// ---------------- extendLineItem – הארכה/שינוי של תאריך ההורדה (מנהל). בלי שום פנייה לימות ----------------
async function extend(request) {
  const who = await requireStaff(request);
  const input = inputObject(request);
  if (!isMgr(who)) throw managerOnly();
  if (typeof input.requestId !== 'string' || !ID_RE.test(input.requestId)) throw bad('bad-request-id', 'הבקשה לא תקינה. נסו שוב.');
  if (!['promo', 'item'].includes(input.kind) || typeof input.id !== 'string' || !ID_RE.test(input.id)) throw notFound();
  const cfg = readCfg();
  const db = T.tdb();
  const ref = db.doc(`${input.kind === 'promo' ? PROMOS : ITEMS}/${input.id}`);
  const today = israelDay();
  const r = await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) throw notFound();
    const x = s.data();
    if (x.extendReq === input.requestId) return { duplicate: true, x };
    if (input.kind === 'item' && !(x.slot === 'hours' && x.temporary === true)) throw pre('no-expiry', 'לפריט הזה אין תאריך הורדה. אפשר להאריך רק מבצעים והודעות זמניות בשלוחה 4.');
    if (x.status !== 'live') {
      if (input.kind === 'promo' ? holdsPath(x) && x.status !== 'remove-failed' : x.status === 'uploading' || (x.status === 'failed' && x.uncertain)) throw uncertainErr();
      throw pre('item-not-live', 'הפריט כבר לא בקו.');
    }
    if (isLocked(x, Date.now())) throw busy();
    if (x.pending) throw uncertainErr();
    const maxDays = input.kind === 'promo' ? cfg.maxDays : L._core.YEMOT_TEMP_MAX_DAYS.value();
    if (!validDay(input.until)) throw bad('bad-date', 'תאריך ההורדה לא תקין.');
    if (input.until < today) throw bad('date-past', 'תאריך ההורדה כבר עבר.');
    if (input.until > addDays(today, maxDays)) throw bad('date-too-far', `אפשר להשאיר בקו עד ${maxDays} ימים.`, { max: maxDays });
    const now = stamp();
    const hist = (Array.isArray(x.untilHistory) ? x.untilHistory : []).concat({ until: x.until || null, at: now, by: who.uid }).slice(-10);
    tx.update(ref, { until: input.until, untilHistory: hist, extendedAt: now, extendedBy: who.uid, extendReq: input.requestId, updatedAt: now });
    return { duplicate: false, previousUntil: x.until || null };
  });
  if (r.duplicate) return { ok: true, id: input.id, until: r.x.until, previousUntil: null, duplicate: true, message: `תאריך ההורדה עודכן: יושמע עד ${heDate(r.x.until)}.` };
  return { ok: true, id: input.id, until: input.until, previousUntil: r.previousUntil, duplicate: false, message: `תאריך ההורדה עודכן: יושמע עד ${heDate(input.until)}.` };
}

// ---------------- restoreLineItem – החזרה לקו (מנהל, רק מה שירד ב-7 הימים האחרונים) ----------------
async function restore(request, key, base) {
  const who = await requireStaff(request);
  const input = inputObject(request);
  if (!isMgr(who)) throw managerOnly();
  if (typeof input.requestId !== 'string' || !RESTORE_REQ_RE.test(input.requestId)) throw bad('bad-request-id', 'הבקשה לא תקינה. נסו שוב.');
  if (!['item', 'promo', 'backup'].includes(input.kind) || typeof input.id !== 'string' || !(input.kind === 'backup' ? BACKUP_ID_RE : ID_RE).test(input.id)) throw notFound();
  if (input.engine !== undefined && input.engine !== null && !voice.pickEngine(input.engine)) throw bad('bad-input', 'קלט לא תקין');
  if (input.confirmCost !== undefined && typeof input.confirmCost !== 'boolean') throw bad('bad-input', 'קלט לא תקין');
  const db = T.tdb();
  const cfg = readCfg();
  const col = { item: ITEMS, promo: PROMOS, backup: BACKUPS }[input.kind];
  const s = await db.doc(`${col}/${input.id}`).get();
  if (!s.exists) throw notFound();
  const x = s.data();
  const from = { kind: input.kind, id: input.id };
  const today = israelDay();

  // 1. המקור ירד?
  let downAt, slot;
  if (input.kind === 'item') {
    slot = x.slot;
    if (!Object.hasOwn(SLOT_EXT, slot || '') || slot === 'promos') throw notFound();
    if (['removed', 'replaced'].includes(x.status)) downAt = x.removedAt || (x.status === 'replaced' ? x.updatedAt : null);
    else if (ON_LINE.includes(x.status) || x.status === 'uploading' || (x.status === 'failed' && x.uncertain)) throw pre('restore-not-down', 'ההודעה הזו עדיין בקו.');
    else throw notFound();
  } else if (input.kind === 'promo') {
    slot = 'promos';
    if (x.status === 'removed') downAt = x.removedAt || x.updatedAt;
    else if (holdsPath(x)) throw pre('restore-not-down', 'ההודעה הזו עדיין בקו.');
    else throw notFound();
  } else {
    slot = x.ext === String(cfg.ext) ? 'promos' : EXT_SLOT[x.ext];
    if (!slot || x.status !== 'complete' || !['applied', 'uncertain'].includes(x.result)) throw notFound();
    downAt = x.finishedAt || x.createdAt;
  }
  if (!inRestoreWindow(dayOf(downAt), today)) throw pre('restore-too-old', 'אפשר להחזיר רק הודעות שירדו בשבוע האחרון.');

  // 2. תאריך: חובה במבצע ובשלוחה 4 כשהמקור היה זמני; מותר (רשות) בשלוחה 4; אסור בשאר
  const needsUntil = input.kind !== 'backup' && (slot === 'promos' || (slot === 'hours' && x.temporary === true));
  const hasUntil = input.until !== undefined && input.until !== null && input.until !== '';
  if (needsUntil && !hasUntil) throw bad('date-required', 'חובה לבחור תאריך הורדה.');
  if (hasUntil && !(input.kind !== 'backup' && (slot === 'promos' || slot === 'hours'))) throw bad('bad-input', 'קלט לא תקין');
  if (hasUntil) {
    const maxDays = slot === 'promos' ? cfg.maxDays : L._core.YEMOT_TEMP_MAX_DAYS.value();
    if (!validDay(input.until)) throw bad('bad-date', 'תאריך ההורדה לא תקין.');
    if (input.until < today) throw bad('date-past', 'תאריך ההורדה כבר עבר.');
    if (input.until > addDays(today, maxDays)) throw bad('date-too-far', `אפשר להשאיר בקו עד ${maxDays} ימים.`, { max: maxDays });
  }

  // 3. כבר הוחזר? (העתק "בקו" עם אותו restoredFrom, שאינו הבקשה הזו)
  const targetId = input.kind === 'promo' ? 'rst_' + input.requestId : input.kind === 'item' ? input.requestId : 'restore-' + input.requestId;
  for (const c of input.kind === 'backup' ? [] : [ITEMS, PROMOS]) { // קובץ ותיק – נבדק ב-restoreBackup מול התיקייה
    const ds = (await db.collection(c).where('restoredFrom.id', '==', input.id).get()).docs;
    if (ds.some((d) => d.id !== targetId && d.get('restoredFrom.kind') === input.kind && (c === ITEMS ? ON_LINE.includes(d.get('status')) || d.get('status') === 'uploading' : c === PROMOS ? holdsPath(d.data()) : d.get('status') === 'live'))) {
      throw pre('already-on-line', 'ההודעה הזו כבר הוחזרה לקו.');
    }
  }
  if (input.kind === 'backup') return restoreBackup(who, input, x, from, key, base);

  // 4. התוכן: שמע שמור (כמו שהוא, בלי עלות) ← נוסח (הקראה מחדש; בקול המשוכפל – רק אחרי אישור עלות)
  let rendered = null, engine = null, recEngine = null;
  const sp = savedPath(x);
  const buf = sp ? await safeRead(sp) : null;
  if (buf) {
    if (x.audioMime === 'audio/mpeg') { rendered = { ext: 'wav', kind: 'audio', body: buf, mime: 'audio/mpeg', srcExt: 'mp3', engine: 'elevenlabs' }; recEngine = 'elevenlabs'; }
    else { rendered = voice.fromRecording(buf); recEngine = 'recording'; }
    engine = recEngine === 'recording' ? null : 'elevenlabs';
  } else if (hasText(x)) {
    engine = textEngine(x, input.engine);
    if (!engine) throw bad('bad-input', 'קלט לא תקין');
    const spoken = applyLexicon(cleanText(x.text), await loadLexicon(db));
    if (engine === 'elevenlabs' && input.confirmCost !== true) {
      throw pre('cost-confirm-needed', `אין שמע שמור להודעה הזו. ההחזרה תקריא אותה מחדש בקול האנושי ותנצל בערך ${spoken.length} תווים מהמכסה. לאשר?`, { chars: spoken.length });
    }
  } else throw pre('no-saved-content', 'אין עותק של ההודעה הזו, ולכן אי אפשר להחזיר אותה.');
  const isAudio = !!rendered;
  const usedCost = !isAudio && engine === 'elevenlabs';
  const req = { auth: request.auth, data: {} };

  let r;
  if (input.kind === 'promo') {
    const v = { requestId: input.requestId, promoKey: targetId, text: isAudio && kindOf(x) === 'audio' ? null : cleanText(x.text || ''), until: input.until, withTzintuk: false, source: null, warnings: [],
      kind: kindOf(x) === 'audio' ? 'audio' : 'text', durationSec: x.durationSec || null, title: kindOf(x) === 'audio' ? titleOf('promo', x) : undefined };
    if (v.kind === 'text' && !v.text) throw pre('no-saved-content', 'אין עותק של ההודעה הזו, ולכן אי אפשר להחזיר אותה.');
    r = await Y._core.sendPromo(req, key, base, { v, kind: v.kind, engine: v.kind === 'audio' ? recEngine : engine || 'elevenlabs', rendered, spoken: x.spoken || null, restoredFrom: from, title: titleOf('promo', x) });
    return { ok: true, id: r.promoKey, restoredFrom: from, file: r.file, path: r.file ? voice.pathOf(String(cfg.ext), r.file) : null, until: r.until, usedCost: usedCost && !r.duplicate, duplicate: !!r.duplicate,
      warnings: r.warnings || [], message: r.duplicate ? 'ההודעה הזו כבר הוחזרה.' : `המבצע הוחזר לקו ויושמע עד ${heDate(r.until)}, בלי צינתוק.` };
  }
  const S = L._core.SLOTS[slot];
  const v = { requestId: input.requestId, slot, S, kind: kindOf(x), source: 'restore', durationSec: x.durationSec || null, text: hasText(x) ? cleanText(x.text) : null,
    title: x.title || titleOf('item', x), until: hasUntil ? input.until : null, buf: isAudio && kindOf(x) === 'audio' ? buf : null };
  if (v.kind === 'text' && !v.text) throw pre('no-saved-content', 'אין עותק של ההודעה הזו, ולכן אי אפשר להחזיר אותה.');
  r = await L._core.publishItem(req, key, base, { v, engine: engine || undefined, rendered, recEngine, spoken: x.spoken || null, restoredFrom: from });
  return { ok: true, id: r.id, restoredFrom: from, file: r.file, path: r.path, until: v.until, usedCost: usedCost && !r.duplicate, duplicate: !!r.duplicate, warnings: r.warnings || [],
    message: r.duplicate ? 'ההודעה הזו כבר הוחזרה.' : slot === 'opening' ? 'הודעת הפתיחה הוחזרה לקו.' : 'ההודעה הוחזרה לקו, ותושמע ראשונה.' };
}

// קובץ ותיק שהוחזר: לשמו המקורי, רק אם השם פנוי (לא דורסים). נשאר "קובץ ותיק" בלי רשומת אפליקציה.
// מעקב (כפילות / "כבר הוחזר") במסמך yemot_state/restore-<requestId> (אוסף סגור).
async function restoreBackup(who, input, b, from, key, base) {
  const ext = b.ext, file = b.file;
  const path = voice.pathOf(ext, file);
  if (!L._core.safeFilePath(path) || b.path !== path) throw notFound();
  const ctx = ctxOf(key, base);
  const db = T.tdb();
  const opRef = db.doc(`yemot_state/restore-${input.requestId}`);
  const op = await opRef.get();
  if (op.exists && (op.get('restoredFrom.id') !== from.id || op.get('byUid') !== who.uid)) throw bad('bad-request-id', 'הבקשה לא תקינה. נסו שוב.');
  const reply = (dup) => ({ ok: true, id: null, restoredFrom: from, file, path, until: null, usedCost: false, duplicate: dup, warnings: [], message: dup ? 'ההודעה הזו כבר הוחזרה.' : 'הקובץ הוחזר לקו בשמו המקורי.' });
  if (op.exists && op.get('status') === 'live') return reply(true);
  // התוכן מהגיבוי
  let content = null;
  if (b.kind === 'text') { if (typeof b.text === 'string' && b.text !== '' && !b.purgedAt) content = b.text; }
  else if (b.storagePath && !b.purgedAt) content = await safeRead(b.storagePath);
  if (!content) throw pre('no-saved-content', 'אין עותק של ההודעה הזו, ולכן אי אפשר להחזיר אותה.');
  const lockRef = db.doc(`yemot_state/ext-${ext}`);
  await db.runTransaction(async (tx) => {
    const l = await tx.get(lockRef);
    if (l.exists && isLocked(l.data(), Date.now()) && l.get('lockReq') !== input.requestId) throw busy();
    tx.set(lockRef, { lockAt: stamp(), lockReq: input.requestId, updatedAt: stamp() }, { merge: true });
  });
  const unlock = () => lockRef.set({ lockAt: null, lockReq: null, updatedAt: stamp() }, { merge: true }).catch(() => {});
  try {
    let infos;
    try { infos = await listDirInfo(ctx, ext); } catch (e) {
      logger.warn('yemot-board: restore dir failed', { reason: 'yemot-upload-failed', code: e && e.code });
      throw new HttpsError('unavailable', 'ההעלאה לקו נכשלה. נסו שוב מאוחר יותר.', { reason: 'yemot-upload-failed' });
    }
    if (infos.some((f) => f.name === file)) {
      // ניסיון קודם של אותה בקשה שאולי הצליח (פסק זמן) – הקובץ בשם הזה הוא שלנו
      if (op.exists && op.get('status') === 'uncertain') { await opRef.update({ status: 'live', updatedAt: stamp() }); return reply(false); }
      if (b.result === 'uncertain') throw pre('restore-not-down', 'ההודעה הזו עדיין בקו.'); // המחיקה הלא ודאית לא קרתה בפועל
      const live = (await db.collection('yemot_state').where('restoredFrom.id', '==', from.id).get()).docs
        .some((d) => d.id !== opRef.id && d.get('restoredFrom.kind') === 'backup' && d.get('status') === 'live');
      if (live) throw pre('already-on-line', 'ההודעה הזו כבר הוחזרה לקו.');
      throw pre('name-taken', 'בשלוחה כבר יש קובץ בשם הזה. כדי לא לדרוס אותו, הקובץ לא הוחזר.');
    }
    await opRef.set({ restoredFrom: from, path, ext, file, status: 'uploading', byUid: who.uid, createdAt: stamp(), updatedAt: stamp() });
    try {
      await voice.upload(ctx, ext, file.slice(0, file.lastIndexOf('.')), voice.legacyRendered(file, content));
    } catch (e) {
      const unsure = e instanceof YemotError && e.sent && e.code === 'timeout';
      await opRef.update({ status: unsure ? 'uncertain' : 'failed', error: 'upload-' + ((e && e.code) || 'internal'), updatedAt: stamp() });
      logger.warn('yemot-board: restore upload failed', { reason: unsure ? 'yemot-uncertain' : 'yemot-upload-failed', code: e && e.code });
      if (unsure) throw new HttpsError('unavailable', 'לא בטוח שההעלאה הצליחה. בדקו ברשימה בעוד דקה לפני שליחה חוזרת.', { reason: 'yemot-uncertain' });
      throw new HttpsError('unavailable', 'ההעלאה לקו נכשלה. נסו שוב מאוחר יותר.', { reason: 'yemot-upload-failed' });
    }
    await opRef.update({ status: 'live', error: null, updatedAt: stamp() });
    await markStale(db, input.id);
    return reply(false);
  } finally { await unlock(); }
}

// ---------------- cleanLineAudio – ניקוי לילי של line_audio/ (חוזה 5.5.8) ----------------
// מוחק רק שמות שתואמים voice.PURGE_RE, ורק כש: הרשומה ירדה והיום (שעון ישראל) ≥ יום הירידה + 8; או שאין רשומה שמצביעה על הקובץ והוא בן יותר מיומיים.
// פריט שעדיין בקו (או שמצבו לא ודאי) – לא נמחק לעולם. גיבוי טקסט מתאפס באותו כלל. לא נוגע ב-voice_cache/, app_backups/, app_releases/.
function downAtOf(folder, x) {
  if (folder === 'backups') return x.finishedAt || x.createdAt || null;
  if (folder === 'items' && ['removed', 'replaced'].includes(x.status)) return x.removedAt || x.updatedAt || null;
  if (folder === 'promos' && x.status === 'removed') return x.removedAt || x.updatedAt || null;
  if (x.status === 'failed' && !x.uncertain) return x.updatedAt || null;
  return null; // בקו, בהעלאה, או לא ודאי
}
async function cleanLineAudio(opts) {
  const o = opts || {};
  const now = o.now instanceof Date ? o.now : new Date();
  const today = israelDay(now);
  const db = T.tdb();
  const due = (downAt) => { const d = dayOf(downAt); return !!d && today >= addDays(d, AUDIO_KEEP_DAYS); };
  const out = { checked: 0, removed: 0, kept: 0, skipped: 0, texts: 0, failed: 0 };
  const iso = now.toISOString();
  let files;
  try { files = await voice.listLineAudio(); } catch (e) { logger.warn('yemot-board: line audio list failed', { reason: 'line-audio-list' }); return Object.assign(out, { error: 'list-failed' }); }
  for (const f of files) {
    out.checked++;
    const m = voice.PURGE_RE.exec(f.name) && /^line_audio\/(items|promos|backups)\/([A-Za-z0-9_-]+)\.(wav|mp3)$/.exec(f.name);
    if (!m) { out.skipped++; continue; }
    const folder = m[1];
    const ref = db.doc(`${{ items: ITEMS, promos: PROMOS, backups: BACKUPS }[folder]}/${m[2]}`);
    const s = await ref.get();
    const x = s.exists ? s.data() : null;
    const field = folder === 'backups' ? 'storagePath' : 'audioPath';
    const linked = !!x && x[field] === f.name;
    const at = Date.parse(f.createdAt || '');
    const go = linked ? due(downAtOf(folder, x)) : Number.isFinite(at) && now.getTime() - at > ORPHAN_MS;
    if (!go) { out.kept++; continue; }
    try { await voice.deleteLineAudio(f.name); } catch (e) { out.failed++; continue; }
    out.removed++;
    if (linked) await ref.update(folder === 'backups' ? { storagePath: FieldValue.delete(), purgedAt: iso } : { audioPath: FieldValue.delete(), audioPurgedAt: iso });
  }
  // גיבויי טקסט של קבצים ותיקים
  for (const d of (await db.collection(BACKUPS).get()).docs) {
    const x = d.data();
    if (typeof x.text === 'string' && x.text !== '' && due(downAtOf('backups', x))) { await d.ref.update({ text: FieldValue.delete(), purgedAt: x.purgedAt || iso }); out.texts++; }
  }
  logger.info('yemot-board: line audio clean done', out);
  return out;
}

// עטיפה: כל שגיאה שאינה HttpsError ← "internal" בעברית, בלי פרטים
const wrap = (name, fn) => T.scoped(async (request) => {
  try { return await fn(request); } catch (e) {
    if (e instanceof HttpsError) throw e;
    logger.error(`yemot-board: ${name} failed`, { reason: 'internal', name: e && e.name });
    throw new HttpsError('internal', 'שגיאה בפעולה מול הקו.', { reason: 'internal' });
  }
});

exports.getLineBoard = onCall({ secrets: [YEMOT_API_KEY], timeoutSeconds: 60 }, wrap('board', (r) => board(r, YEMOT_API_KEY.value(), YEMOT_API_BASE.value())));
exports.getLineAudio = onCall({ secrets: [YEMOT_API_KEY], timeoutSeconds: 60 }, wrap('audio', (r) => listen(r, YEMOT_API_KEY.value(), YEMOT_API_BASE.value())));
// בלי סוד: ההארכה לא פונה לימות בכלל
exports.extendLineItem = onCall(wrap('extend', (r) => extend(r)));
exports.restoreLineItem = onCall({ secrets: [YEMOT_API_KEY, voice.ELEVENLABS_API_KEY], timeoutSeconds: 120 }, wrap('restore', (r) => restore(r, YEMOT_API_KEY.value(), YEMOT_API_BASE.value())));
// נקראת מריצת הלילה (yemot.js). לא נספרת כפונקציה.
Object.defineProperty(exports, 'cleanLineAudio', { enumerable: false, value: cleanLineAudio });
Object.defineProperty(exports, '_core', { enumerable: false, value: { board, listen, extend, restore, removePromo, backupLegacy, backupResult, settleBackup, keepBeforeRemove, promoAt, cleanLineAudio, RESTORE_DAYS, AUDIO_KEEP_DAYS, LOCK_MS } });
