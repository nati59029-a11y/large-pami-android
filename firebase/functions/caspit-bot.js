'use strict';
// רובוט כספית – צד השרת (שלב B, 18.11.2026). התוסף ב-Chrome במחשב החנות (caspit-extension/) פונה ל-cxBot; חוזה: caspit-extension/README.md.
//   cxBotTok({ op:'new'|'revoke'|'info'|'now' })  – מנהל. new: אסימון '<bizId>.<32 בתים base64url>' מוצג פעם אחת; נשמר רק sha256
//                                             ב-b/{bizId}/private/cxbot { h, id, by, at, last, ua, ver, sd, lr }. מחשב אחד לעסק (חדש מבטל ישן).
//                                             info: מצב, 14 הריצות האחרונות, newMax. אותו דפוס כמו yemot-hook.js (גיבוב, timingSafeEqual, מונה יומי).
//                                             now ("סנכרן עכשיו", 18.11): בקשה req:{id,at,by} ב-private/cxbot (טרנזקציה). בלי הגבלה יומית (בעל העסק);
//                                             מסרב: no-dev (אין מחשב), pending (בקשה ממתינה < 10 דקות – מחזיר אותה), running (סנכרון רץ).
//                                             התוסף (0.1.5) בודק כל דקה ב-poll; hello עם req לוקח את הבקשה פעם אחת (req.took, req.run).
//   cxBot (HTTP, europe-west1 בלבד, POST JSON, Authorization: Bearer) – העסק נקבע רק מהאסימון. עסק פעיל + תוספת orders.
//          זהות סינתטית { uid:'cxbot:<id>', role:'manager', bot:true }. רק הפעולות שב-README (hello, cfg, upload, preview, apply, export, report, importResult, poll)
//          – אף פעם לא cxSetCfg / cxDnOk / cxFix / אסימונים / לקוחות. מגבלות: 600 פניות ו-10 ריצות ביום לעסק; 30 ניסיונות כושלים ביום לכתובת IP (גיבוב);
//          poll (כל דקה) – פטור מהמונה היומי (600), אבל עובר אימות אסימון ומונה ה-IP; כותב pl לכל היותר פעם ב-5 דקות.
//          ריצה מבקשה בטלפון (hello עם req תקין) לא נספרת במגבלת 10 הריצות – כל בקשה נוצרה בלחיצה של מנהל.
//          גוף עד 10MB (דוח היכרות עד 1MB). CORS רק לתוסף (chrome-extension://mianlmahikfdnffiipdfpojnfjhcipbp). השדה log – לרישום בלבד.
//          קטלוג ראשון → 'first-manual' (רק באפליקציה). אישור קטלוג: take:'app' (האפליקציה מנצחת). מכירות: "לא בטוח" מסומן ולא עוצר.
//          export: מעל המגבלה (≤500 מחיר, ≤ min(50, cxcfg.bot.newMax) פריטים חדשים) → 'limit' לפני שמשהו מסומן pd.
//          מנעול משותף עם הטלפון: b/{bizId}/private/cxbot.lock (30 דקות, caspit.js lockTake). יומן ריצות: cxBotRun/{runId}.
//          דוח היכרות: cxBotDisc/{id} + p/{k} (חלקים) – מנהל־על צופה ומוריד (cxBotDisc).
//   cxBotDisc({ id? }) – מנהל־על: רשימת דוחות / דוח אחד (JSON כטקסט).
//   cxBotWatch – מתוזמנת כל שעה (us-central1 בלבד) → התראה למנהלים (pushMgrs ב-daily-rep.js), פעם ביום לכל סוג:
//          needs-login (גם מיד בדיווח), selector-miss / endpoint-changed, limit, "לא סנכרן הלילה" רק אחרי 10:00 כשהיום האחרון < אתמול (חזק יותר אחרי יומיים),
//          שורות שנשלחו לכספית ועדיין ממתינות (pd) אחרי 2 קטלוגים.
// פרטיות: ביומן השרת רק סיבות וקודים – בלי אסימון, בלי תוכן קבצים.

const crypto = require('node:crypto');
const { onRequest, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { getFirestore } = require('firebase-admin/firestore');
const logger = require('firebase-functions/logger');
const { onCall, NEW_REGION, LEGACY_REGION } = require('./lib/region');
const { inputObject } = require('./lib/roles');
const T = require('./lib/tenant');
const TK = require('./lib/tk-time');
const O = require('./orders')._core;
const CX = require('./caspit')._core;

const EXT_ORIGIN = 'chrome-extension://mianlmahikfdnffiipdfpojnfjhcipbp';
const MIN_VER = '0.1.0';
const OPS = ['hello', 'cfg', 'upload', 'preview', 'apply', 'export', 'report', 'importResult', 'poll'];
const MAX_BODY = 10 * 1024 * 1024;
const DISC_MAX = 1024 * 1024;
const DISC_PART = 300000; // תווים; גם ב-3 בייטים לתו – פחות מ-1MiB למסמך
const CALLS_DAY = 600, RUNS_DAY = 10, FAIL_IP_DAY = 30;
const FAIL_BUCKETS = 64; // מוני כישלונות: מספר קבוע של מסמכים (cxbot_fail/b0..b63) – כתובת מזויפת לא יוצרת מסמכים חדשים
const LIM = { price: 500, newMax: 50 };
const SCHED = { at: '03:00', tz: TK.TZ };
const MAX_DAYS = 14;
const SRUN_RE = /^[A-Za-z0-9_-]{6,40}$/; // מזהה ריצה (runId מ-hello, או מזהה של התוסף אם hello נכשל)
const TOK_RE = /^([a-z0-9-]{3,30})\.([A-Za-z0-9_-]{43})$/;
// "סנכרן עכשיו": בקשה תקפה 10 דקות; סנכרון שהתחיל נחשב רץ עד 30 דקות (או עד הדיווח); pl נכתב לכל היותר פעם ב-5 דקות
const REQ_MS = 10 * 60e3, RUN_MS = 30 * 60e3, PL_MS = 5 * 60e3;
const REQ_RE = /^q[a-z0-9]{6,30}$/;
const NOW_VER = '0.1.5'; // הגרסה הראשונה של התוסף שמגיבה ל"סנכרן עכשיו"
const reqLive = (q, now) => !!(q && typeof q.id === 'string' && !q.took && now - (q.at || 0) < REQ_MS);
const ALERT_CODES = ['needs-login', 'selector-miss', 'endpoint-changed', 'limit', 'wrong-page', 'import-errors', 'import-timeout', 'import-queue-not-empty'];
const deny = (reason, msg) => new HttpsError('permission-denied', msg, { reason });
const pre = (reason, msg) => new HttpsError('failed-precondition', msg, { reason });
const bad = (reason, msg) => new HttpsError('invalid-argument', msg, { reason });
const priv = (bizId, k) => getFirestore().doc(`b/${bizId}/private/${k}`);
const sha = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
const str = (v, n) => (typeof v === 'string' ? v : '').slice(0, n);

// ---------- ימים ושעות בישראל ----------
const ilDay = (t) => TK.dayStr(TK.ymdOf(t));
const ilHour = (t) => TK.wall(t).hh;
const addDays = (day, n) => { const [y, m, d] = day.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
// כמו daysToFetch בתוסף (lib/days.js): מהיום שאחרי היום האחרון שנקלט ועד אתמול; בלי – רק אתמול; לכל היותר 14 ימים אחורה; אף פעם לא היום
function daysFor(sd, today) {
  const min = addDays(today, -MAX_DAYS);
  let d = sd && CX.DATE_RE.test(sd) ? addDays(sd, 1) : addDays(today, -1);
  if (d < min) d = min;
  const out = [];
  for (; d < today; d = addDays(d, 1)) out.push(d);
  return out;
}
function cmpVer(a, b) {
  const p = (v) => String(v || '0').split('.').map((x) => parseInt(x, 10) || 0);
  const x = p(a), y = p(b);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0) ? -1 : 1;
  return 0;
}

// ---------- אסימון ----------
async function verify(tok) {
  const m = TOK_RE.exec(typeof tok === 'string' ? tok : '');
  if (!m) return null;
  const s = await priv(m[1], 'cxbot').get();
  const h = s.exists ? s.get('h') : '';
  const mine = sha(tok);
  if (typeof h !== 'string' || h.length !== mine.length || !crypto.timingSafeEqual(Buffer.from(h), Buffer.from(mine))) return null;
  return { bizId: m[1], dev: s.data() };
}

// cxBotTok({ op }) – מנהל. new → { token, id } (פעם אחת). revoke → { ok }. info → מצב הרובוט
async function cxBotTok(w, input) {
  O.onlyKeys(input, ['op']);
  if (!w.bizId) throw pre('no-biz', 'בחרו עסק');
  const ref = priv(w.bizId, 'cxbot');
  if (input.op === 'new') {
    const token = w.bizId + '.' + crypto.randomBytes(32).toString('base64url');
    const id = crypto.randomBytes(4).toString('hex');
    const old = await ref.get();
    // מחשב אחד לעסק: האסימון הקודם מתבטל. היום האחרון שנקלט (sd) נשמר – כדי לא להביא שוב ימים שכבר נקלטו
    await ref.set({ h: sha(token), id, by: w.uid, at: Date.now(), last: null, ua: '', ver: '', sd: old.exists ? old.get('sd') || null : null, lr: null });
    await CX.lockFree(w.bizId, 'bot:' + (old.exists ? old.get('id') : '')).catch(() => {});
    logger.info('cxBotTok: new', { biz: w.bizId, id });
    return { token, id };
  }
  if (input.op === 'revoke') {
    const old = await ref.get();
    if (old.exists) await ref.set({ h: '', rev: Date.now(), revBy: w.uid }, { merge: true });
    if (old.exists) await CX.lockFree(w.bizId, 'bot:' + old.get('id')).catch(() => {});
    logger.info('cxBotTok: revoke', { biz: w.bizId });
    return { ok: true };
  }
  if (input.op === 'info') {
    const db = T.tdb();
    const [s, c, runs] = await Promise.all([ref.get(), db.doc(CX.CFG).get(), db.collection('cxBotRun').orderBy('at', 'desc').limit(14).get()]);
    const d = s.exists ? s.data() : {};
    const cfg = CX.cfgOf(c);
    const out = {
      dev: d.h ? { id: d.id, at: d.at || null, last: d.last || null, ver: d.ver || '', ua: str(d.ua, 120), upd: d.upd || null } : null,
      sd: d.sd || null, lr: d.lr || null, lok: d.lok || null, li: d.li || null, newMax: cfg.bot.newMax, limits: LIM, schedule: SCHED, first: !cfg.last, sa: !!w.superadmin,
      req: d.h && d.req ? { id: d.req.id, at: d.req.at || 0, took: d.req.took || null, wait: d.req.wait || null } : null, pl: d.h ? d.pl || null : null, nowVer: NOW_VER, now: Date.now(), reqMs: REQ_MS,
      runs: runs.docs.map((x) => { const r = x.data(); return { id: x.id, at: r.at, end: r.end || null, st: r.st, manual: !!r.manual, req: !!r.req, days: r.days || [], err: r.err || null, imp: r.imp || null }; }),
    };
    if (w.superadmin) out.disc = (await db.collection('cxBotDisc').orderBy('at', 'desc').limit(5).get()).docs.map((x) => ({ id: x.id, at: x.get('at'), size: x.get('size') }));
    return out;
  }
  if (input.op === 'now') {
    const now = Date.now(), id = 'q' + now.toString(36) + crypto.randomBytes(3).toString('hex');
    const r = await ref.firestore.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      const d = s.exists ? s.data() : {};
      if (!d.h) return { no: 'no-dev' };
      const q = d.req, lr = d.lr;
      if (reqLive(q, now)) return { no: 'pending', req: { id: q.id, at: q.at } };
      // סנכרון רץ: התחיל מבקשה קודמת ועוד לא דווח, או דיווח "רץ" אחרון – עד 30 דקות
      if ((q && q.took && now - q.took < RUN_MS && !(lr && (lr.at || 0) >= q.took)) || (lr && lr.st === 'run' && now - (lr.at || 0) < RUN_MS)) return { no: 'running' };
      // update מחליף את המפה req כולה (set+merge היה ממזג took/run/wait מהבקשה הקודמת)
      tx.update(ref, { req: { id, at: now, by: w.uid } });
      return { req: { id, at: now } };
    });
    if (r.no === 'no-dev') throw pre('no-dev', 'אין מחשב מחובר. קודם מחברים את מחשב החנות.');
    if (r.no === 'pending') throw new HttpsError('failed-precondition', 'כבר נשלחה בקשה – ממתינים למחשב.', { reason: 'pending', req: r.req });
    if (r.no === 'running') throw pre('running', 'הסנכרון כבר רץ במחשב החנות.');
    logger.info('cxBotTok: now', { biz: w.bizId });
    return { ok: true, req: r.req };
  }
  throw bad('bad-op', 'פעולה לא מוכרת');
}

// cxBotDisc({ id? }) – מנהל־על בלבד: בלי id – 10 הדוחות האחרונים; עם id – הדוח (data: JSON כטקסט)
async function cxBotDisc(w, input) {
  O.onlyKeys(input, ['id']);
  if (!w.superadmin) throw deny('not-superadmin', 'הפעולה זמינה למנהל־על בלבד');
  const db = T.tdb();
  if (input.id === undefined) return { list: (await db.collection('cxBotDisc').orderBy('at', 'desc').limit(10).get()).docs.map((x) => ({ id: x.id, at: x.get('at'), size: x.get('size'), ver: x.get('ver') || '' })) };
  if (typeof input.id !== 'string' || !SRUN_RE.test(input.id)) throw bad('bad-id', 'מזהה לא תקין');
  const ref = db.doc('cxBotDisc/' + input.id);
  const [x, p] = await Promise.all([ref.get(), ref.collection('p').get()]);
  if (!x.exists) throw new HttpsError('not-found', 'הדוח לא נמצא', { reason: 'no-disc' });
  return { id: x.id, at: x.get('at'), size: x.get('size'), data: p.docs.sort((a, b) => +a.id - +b.id).map((d) => d.get('s') || '').join('') };
}

// ---------- מגבלות ----------
// כתובת הלקוח: הערך הימני ביותר ב-X-Forwarded-For – זה שהתשתית של Google (Cloud Run, שעליו רצות פונקציות v2) מוסיפה בסוף;
// הערכים משמאל נשלטים בידי הלקוח. (הנחה לפי מקורות משניים, לא מתיעוד רשמי – לא מאומת.) בלי הכותרת – req.ip.
// גם אם ההנחה שגויה: המונה רק מאט ניסיונות כושלים – בקשה עם אסימון תקין לעולם לא נחסמת בגללו.
function clientIp(req) {
  const xs = String((req.headers || {})['x-forwarded-for'] || '').split(',').map((x) => x.trim()).filter(Boolean);
  return xs.length ? xs[xs.length - 1] : String(req.ip || '');
}
const failRef = (ip) => getFirestore().doc('cxbot_fail/b' + (parseInt(sha('cxip:' + ip).slice(0, 8), 16) % FAIL_BUCKETS));
async function ipBlocked(ip, day) {
  const s = await failRef(ip).get();
  return s.exists && s.get('day') === day && (s.get('n') || 0) >= FAIL_IP_DAY;
}
async function ipFail(ip, day) {
  const ref = failRef(ip);
  await ref.firestore.runTransaction(async (tx) => { const s = await tx.get(ref); const n = s.exists && s.get('day') === day ? s.get('n') || 0 : 0; tx.set(ref, { day, n: n + 1 }); });
}
// מונה יומי לעסק: פניות וריצות (hello במצב sync). מעל המגבלה → false
async function useOk(bizId, day, isRun, lim) {
  const ref = priv(bizId, 'cxbot.use');
  return ref.firestore.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const same = s.exists && s.get('day') === day;
    const n = (same ? s.get('n') || 0 : 0) + 1, runs = (same ? s.get('runs') || 0 : 0) + (isRun ? 1 : 0);
    if (n > lim.calls || runs > lim.runs) return false;
    tx.set(ref, { day, n, runs });
    return true;
  });
}

// ---------- הפעולות של הרובוט ----------
const runRef = (id) => T.tdb().doc('cxBotRun/' + id);
const limitsOf = (cfg) => ({ price: LIM.price, newMax: Math.max(0, Math.min(LIM.newMax, cfg.bot.newMax)) });
async function cfgNow() { return CX.cfgOf(await T.tdb().doc(CX.CFG).get()); }
// מצב העדכון האוטומטי של התוסף (0.1.7, upd.json מהמחשב, ב-hello). לא תקין → מתעלמים (לא מכשילים את הסנכרון).
// { at, ok, ver, err, fails, rx (מתי התקבל) }; at לא בעתיד (שעון מחשב שגוי → rx)
function updOf(u, now) {
  if (!u || typeof u !== 'object' || Array.isArray(u) || typeof u.ok !== 'boolean' || !Number.isFinite(u.at) || u.at <= 0) return null;
  const ver = typeof u.ver === 'string' && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(u.ver) ? u.ver : '';
  return { at: Math.min(Math.round(u.at), now), ok: u.ok, ver, err: str(u.err, 120).replace(/[^\w .:/()-]/g, ''), fails: Number.isInteger(u.fails) && u.fails > 0 ? Math.min(u.fails, 999) : 0, rx: now };
}
function pick(b, keys) { const o = {}; for (const k of keys) if (b[k] !== undefined) o[k] = b[k]; return o; }
async function runKind(run) { const r = await T.tdb().doc('cxRun/' + run).get(); return r.exists ? r.get('kind') || 'cat' : null; }
const runOf = (v) => { if (typeof v !== 'string' || !CX.RUN_RE.test(v)) throw bad('bad-run', 'מזהה סנכרון לא תקין'); return v; };

const OPF = {
  async hello(w, b, x) {
    const mode = b.mode === 'connect' ? 'connect' : 'sync';
    const cfg = await cfgNow();
    const today = ilDay(x.now), sd = x.dev.sd || null;
    const days = mode === 'connect' ? [] : daysFor(sd, today);
    const runId = 'r' + x.now.toString(36) + crypto.randomBytes(5).toString('hex');
    // ריצה מבקשה בטלפון ("סנכרן עכשיו"): לוקחים את הבקשה פעם אחת בלבד. בקשה שכבר נלקחה / פגה / אחרת → req-gone (בלי ריצה)
    let req = null;
    if (b.req !== undefined) {
      if (mode !== 'sync' || typeof b.req !== 'string' || !REQ_RE.test(b.req)) throw bad('bad-req', 'בקשה לא תקינה');
      const ref = priv(w.bizId, 'cxbot');
      req = await ref.firestore.runTransaction(async (tx) => {
        const s = await tx.get(ref), q = s.exists ? s.get('req') : null;
        if (!reqLive(q, x.now) || q.id !== b.req) return null;
        tx.set(ref, { req: Object.assign({}, q, { took: x.now, run: runId }) }, { merge: true });
        return q.id;
      });
      if (!req) throw pre('req-gone', 'הבקשה מהטלפון כבר טופלה או פגה');
    }
    if (mode === 'sync') await runRef(runId).set(Object.assign({ at: x.now, d: today, st: 'run', ver: x.ver, manual: b.manual === true || !!req, days, dev: x.dev.id }, req ? { req } : {}));
    const u = updOf(b.upd, x.now);
    await priv(w.bizId, 'cxbot').set(Object.assign({ last: x.now, ver: x.ver, ua: x.ua }, x.dev.conn ? {} : { conn: x.now }, u ? { upd: u } : {}), { merge: true });
    return { runId, minVer: MIN_VER, enabled: true, biz: { name: (w.biz && w.biz.name) || '' }, days, lastSales: sd, schedule: SCHED, limits: limitsOf(cfg) };
  },
  async cfg(w, b, x) {
    O.onlyKeys(b, []);
    return { schedule: SCHED, lastSales: x.dev.sd || null, limits: limitsOf(await cfgNow()) };
  },
  async upload(w, b, x) {
    const kind = b.kind == null ? 'cat' : b.kind;
    if (kind === 'sales') {
      O.onlyKeys(b, ['run', 'kind', 'day', 'part', 'parts', 'lines']);
      if (typeof b.day !== 'string' || !CX.DATE_RE.test(b.day) || b.day >= ilDay(x.now)) throw bad('bad-day', 'יום מכירות לא תקין (רק ימים שלמים)');
      // כל שורה – מהיום שנשלח (ולכן רק ימים שלמים)
      if (Array.isArray(b.lines) && b.lines.some((l) => !l || typeof l !== 'object' || l.d !== b.day)) throw bad('day-mismatch', 'שורת מכירה מיום אחר מהיום שנשלח');
      return CX.FNS.cxUpload(w, pick(b, ['run', 'kind', 'part', 'parts', 'lines']));
    }
    O.onlyKeys(b, ['run', 'part', 'parts', 'items']);
    return CX.FNS.cxUpload(w, pick(b, ['run', 'part', 'parts', 'items']));
  },
  async preview(w, b) {
    O.onlyKeys(b, ['run']);
    const run = runOf(b.run);
    const kind = await runKind(run);
    // קטלוג ראשון – רק באפליקציה: לא מחשבים תצוגה (חוסך זמן); האישור יסרב ב-first-manual
    if (kind === 'cat' && !(await cfgNow()).last) return { first: true, cnt: null, kind };
    const r = await CX.FNS.cxPreview(w, { run });
    return { cnt: r.cnt, first: !!r.first, kind: r.kind || 'cat' };
  },
  async apply(w, b, x) {
    O.onlyKeys(b, ['run']);
    const run = runOf(b.run);
    const kind = await runKind(run);
    if (kind === 'cat' && !(await cfgNow()).last) throw pre('first-manual', 'את הסנכרון הראשון של הקטלוג עושים באפליקציה (סנכרון כספית). המכירות ממשיכות להיקלט.');
    await CX.lockTake(w.bizId, 'bot:' + x.dev.id);
    const r = await CX.FNS.cxApply(w, kind === 'sales' ? { run } : { run, take: 'app' }); // האפליקציה מנצחת בהתנגשות מחיר/עלות
    return { done: !!r.done, next: r.next, res: r.res || {}, dup: !!r.dup };
  },
  async export(w, b, x) {
    O.onlyKeys(b, ['kind', 'max']);
    if (!['new', 'price'].includes(b.kind)) throw bad('bad-kind', 'סוג קובץ לא תקין');
    if (!Number.isInteger(b.max) || b.max < 0 || b.max > LIM.price) throw bad('bad-max', 'מגבלה לא תקינה');
    const lim = limitsOf(await cfgNow());
    const max = Math.min(b.max, b.kind === 'new' ? lim.newMax : lim.price);
    await CX.lockTake(w.bizId, 'bot:' + x.dev.id);
    const r = await CX.FNS.cxExport(w, { kind: b.kind, max });
    return { n: r.n, csv: r.csv, rows: r.rows, added: r.added || 0 };
  },
  async importResult(w, b, x) {
    O.onlyKeys(b, ['run', 'kind', 'n', 'ok', 'text', 'hash', 'id', 'status', 'errors', 'loaded']);
    // תוסף 0.1.4: השורה בטבלת "טעינות קודמות" של כספית – מזהה, סטטוס, שגויים, נטענו (-1 = לא ידוע)
    const int = (v) => (v === undefined ? undefined : Number.isInteger(v) && v >= -1 && v <= 1e9 ? v : NaN);
    const ex = { id: int(b.id), errors: int(b.errors), loaded: int(b.loaded) };
    if (Object.values(ex).some((v) => Number.isNaN(v)) || (b.status !== undefined && typeof b.status !== 'string')) throw bad('bad-import', 'דיווח טעינה לא תקין');
    if (typeof b.run !== 'string' || !SRUN_RE.test(b.run) || !['new', 'price'].includes(b.kind) || !Number.isInteger(b.n) || b.n < 0 || b.n > 100000) throw bad('bad-import', 'דיווח טעינה לא תקין');
    if (b.hash !== undefined && (typeof b.hash !== 'string' || !/^[0-9a-f]{64}$/.test(b.hash))) throw bad('bad-import', 'דיווח טעינה לא תקין');
    const rec = Object.assign({ n: b.n, ok: b.ok === true, text: str(b.text, 500), hash: b.hash || '', at: x.now }, ex.id !== undefined ? { id: ex.id, status: str(b.status, 40), errors: ex.errors === undefined ? -1 : ex.errors, loaded: ex.loaded === undefined ? -1 : ex.loaded } : {});
    await runRef(b.run).set({ imp: { [b.kind]: rec }, upd: x.now }, { merge: true });
    await priv(w.bizId, 'cxbot').set({ li: Object.assign({ kind: b.kind, run: b.run }, rec) }, { merge: true }); // הטעינה האחרונה לכספית (לכרטיס הרובוט)
    return {};
  },
  async report(w, b, x, o) {
    if (b.kind === 'disc') {
      O.onlyKeys(b, ['kind', 'data']);
      const s = JSON.stringify(b.data === undefined ? null : b.data);
      if (s.length > DISC_MAX) throw bad('too-big', 'דוח ההיכרות גדול מדי (עד 1MB)');
      const db = T.tdb(), id = 'd' + x.now.toString(36) + crypto.randomBytes(3).toString('hex');
      const ref = db.doc('cxBotDisc/' + id), bt = db.batch();
      bt.set(ref, { at: x.now, size: s.length, ver: x.ver, dev: x.dev.id });
      for (let k = 0, i = 0; i < s.length; k++, i += DISC_PART) bt.set(ref.collection('p').doc(String(k)), { s: s.slice(i, i + DISC_PART) });
      await bt.commit();
      return { id };
    }
    if (b.kind !== 'run') throw bad('bad-kind', 'סוג דיווח לא תקין');
    // דיווח ריצה שנכשל (קלט פגום, תקלה) – המנעול של הרובוט משתחרר בכל זאת
    try { return await reportRun(w, b, x, o); } catch (er) { await CX.lockFree(w.bizId, 'bot:' + x.dev.id).catch(() => {}); throw er; }
  },
};
async function reportRun(w, b, x, o) {
  {
    O.onlyKeys(b, ['run', 'kind', 'st', 'err', 'steps', 'info']);
    if (typeof b.run !== 'string' || !SRUN_RE.test(b.run)) throw bad('bad-run', 'מזהה ריצה לא תקין');
    const st = ['ok', 'fail', 'needs-login', 'wait', 'run'].includes(b.st) ? b.st : 'fail';
    const e = b.err && typeof b.err === 'object' ? { code: str(b.err.code, 40), msg: str(b.err.msg, 300), step: str(b.err.step, 20) } : null;
    const steps = (Array.isArray(b.steps) ? b.steps.slice(-60) : []).filter((s) => s && typeof s === 'object').map((s) => {
      const z = { s: str(s.s, 20), ok: s.ok === true, at: typeof s.at === 'number' ? s.at : 0 };
      if (typeof s.d === 'string' && CX.DATE_RE.test(s.d)) z.d = s.d;
      if (s.code) z.code = str(s.code, 40);
      if (s.msg) z.msg = str(s.msg, 300);
      return z;
    });
    const info = b.info && typeof b.info === 'object' && !Array.isArray(b.info) ? b.info : {};
    let lite = JSON.parse(JSON.stringify(info));
    if (JSON.stringify(lite).length > 8000) lite = { days: (Array.isArray(info.days) ? info.days : []).filter((d) => typeof d === 'string' && CX.DATE_RE.test(d)).slice(0, MAX_DAYS) };
    const ref = runRef(b.run), rs = await ref.get();
    const rv = Object.assign({ st, err: e, steps, info: lite, end: x.now, ver: x.ver, dev: x.dev.id }, rs.exists ? {} : { at: x.now, d: ilDay(x.now), days: [] });
    await ref.set(rv, { mergeFields: Object.keys(rv) }); // כל שדה מוחלף במלואו (info בלי שאריות מדיווח קודם)
    // היום האחרון שנקלט (sd): ימים שהשרת ביקש ב-hello, ברצף מההתחלה, שהתוסף דיווח שהושלמו (info.sales[day]) – רק ימים שלמים
    const asked = rs.exists && Array.isArray(rs.get('days')) ? rs.get('days') : [];
    const done = info.sales && typeof info.sales === 'object' ? info.sales : {};
    let last = null;
    for (const d of asked) { if (Object.prototype.hasOwnProperty.call(done, d)) last = d; else break; }
    const sd = x.dev.sd || null;
    const up = { last: x.now, lr: { id: b.run, at: x.now, st, code: e ? e.code : '', msg: e ? e.msg : '', step: e ? e.step : '', manual: rs.exists ? !!rs.get('manual') : false } };
    if (st === 'ok') up.lok = x.now;
    if (last && (!sd || last > sd) && last < ilDay(x.now)) up.sd = last;
    await priv(w.bizId, 'cxbot').set(up, { merge: true });
    if (st !== 'run' && st !== 'wait') await CX.lockFree(w.bizId, 'bot:' + x.dev.id).catch(() => {});
    if (e && e.code === 'needs-login') await alertBiz(w.bizId, ['needs-login'], x.now, o).catch((er) => logger.warn('cxBot: alert failed', { name: er && er.name }));
    return { sd: up.sd || sd };
  }
}

// ---------- נקודת הקצה ----------
const STATUS = { 'invalid-argument': 400, 'failed-precondition': 409, 'not-found': 404, 'resource-exhausted': 429, unauthenticated: 401, 'already-exists': 409, aborted: 409, 'permission-denied': 409 };
// opts (לבדיקות בתוך התהליך): { now, send }
async function handle(req, res, opts) {
  const o = opts || {};
  const h = req.headers || {};
  const send = (code, body) => { res.status(code).set('Cache-Control', 'no-store').json(body); };
  const no = (code, reason, msg) => send(code, { ok: false, reason, msg });
  const origin = typeof h.origin === 'string' ? h.origin : '';
  if (origin && origin !== EXT_ORIGIN) { logger.warn('cxBot: rejected', { reason: 'origin' }); return no(403, 'origin', 'מקור לא מורשה'); }
  if (origin) res.set('Access-Control-Allow-Origin', EXT_ORIGIN).set('Vary', 'Origin');
  if (req.method === 'OPTIONS') { res.set('Access-Control-Allow-Methods', 'POST').set('Access-Control-Allow-Headers', 'authorization,content-type').set('Access-Control-Max-Age', '3600'); return res.status(204).send(''); }
  if (req.method !== 'POST') return no(405, 'method', 'רק POST');
  const size = req.rawBody ? req.rawBody.length : Buffer.byteLength(JSON.stringify(req.body || ''));
  if (size > MAX_BODY) return no(413, 'too-big', 'הבקשה גדולה מדי');
  if (!/^application\/json\b/i.test(String(h['content-type'] || ''))) return no(415, 'bad-type', 'נדרש JSON');
  const now = o.now || Date.now(), day = ilDay(now);
  const m = /^Bearer\s+(\S{1,200})$/.exec(String(h.authorization || ''));
  const v = m ? await verify(m[1]) : null;
  // מגבלת ניסיונות כושלים – רק אחרי שהאימות נכשל (אסימון תקין לא נחסם לעולם בגלל המונה)
  if (!v) {
    const ip = clientIp(req);
    if (await ipBlocked(ip, day)) { logger.warn('cxBot: rejected', { reason: 'ip-limit' }); return no(429, 'rate', 'יותר מדי ניסיונות כושלים. נסו שוב מחר.'); }
    await ipFail(ip, day); logger.warn('cxBot: rejected', { reason: 'bad-token' }); return no(401, 'auth', 'החיבור לאפליקציה בוטל או לא תקין. יש לחבר מחדש עם קוד חדש מהאפליקציה.');
  }
  const biz = await T.loadBiz(v.bizId);
  if (!biz || biz.status !== 'active' || !biz.features.orders) { logger.warn('cxBot: rejected', { reason: 'biz-off', biz: v.bizId }); return no(403, 'biz-off', 'העסק לא פעיל או שתוספת ההזמנות כבויה'); }
  const b = req.body;
  if (!b || typeof b !== 'object' || Array.isArray(b)) return no(400, 'bad-json', 'קלט לא תקין');
  const op = b.op;
  if (typeof op !== 'string' || !OPS.includes(op)) { logger.warn('cxBot: rejected', { reason: 'bad-op', biz: v.bizId }); return no(400, 'bad-op', 'פעולה לא מותרת'); }
  const ver = str(b.ver, 20);
  // poll (כל דקה): פטור מהמונה היומי – אסימון ועסק כבר נבדקו למעלה, ובלי קריאות נוספות למסד (חוץ מכתיבת pl פעם ב-5 דקות)
  if (op === 'poll') {
    if (Object.keys(b).some((k) => !['op', 'ver', 'log', 'wait'].includes(k))) return no(400, 'bad-field', 'שדה לא מוכר');
    if (b.wait !== undefined && !(Number.isInteger(b.wait) && b.wait > 0 && b.wait < now + 24 * 3600e3)) return no(400, 'bad-field', 'שדה לא תקין');
    const q = v.dev.req, pl = v.dev.pl || 0;
    const up = !(pl && now - pl < PL_MS && now >= pl) ? Object.assign({ pl: now }, ver ? { ver } : {}) : {};
    // המחשב באמצע ריצה שממתינה לניסיון חוזר (wait = מתי): נרשם על הבקשה, כדי שהטלפון יציג "ינסה שוב ב-HH:MM" ולא "לא הגיב"
    if (reqLive(q, now) && b.wait && q.wait !== b.wait) up.req = { wait: b.wait };
    if (Object.keys(up).length) await priv(v.bizId, 'cxbot').set(up, { merge: true });
    return send(200, reqLive(q, now) ? { ok: true, want: true, id: q.id } : { ok: true, want: false });
  }
  const lim = { calls: o.calls || CALLS_DAY, runs: o.runs || RUNS_DAY };
  // ריצה מבקשה בטלפון לא נספרת במגבלת הריצות היומית (בעל העסק: "סנכרן עכשיו" בלי הגבלה יומית)
  const fromApp = op === 'hello' && typeof b.req === 'string' && reqLive(v.dev.req, now) && v.dev.req.id === b.req;
  if (!(await useOk(v.bizId, day, op === 'hello' && b.mode !== 'connect' && !fromApp, lim))) { logger.warn('cxBot: rejected', { reason: 'rate', biz: v.bizId, op }); return no(429, 'rate', 'יותר מדי פניות היום'); }
  if (op !== 'hello' && cmpVer(ver, MIN_VER) < 0) return no(409, 'min-ver', 'צריך לעדכן את התוסף לגרסה חדשה');
  const body = Object.assign({}, b);
  delete body.op; delete body.ver;
  const lg = str(body.log, 40); delete body.log; // השדה log (runId) – לרישום בלבד
  const prefix = T.bizPrefix(biz);
  const w = await O.withBr({ uid: 'cxbot:' + v.dev.id, role: 'manager', bot: true, staff: null, bizId: v.bizId, biz, prefix, superadmin: false });
  const x = { now, ver, dev: v.dev, ua: str(h['user-agent'], 120) };
  try {
    const r = await T.runInBiz({ bizId: v.bizId, prefix, biz, uid: w.uid }, () => OPF[op](w, body, x, o));
    logger.info('cxBot', { biz: v.bizId, op, log: lg });
    return send(200, Object.assign({ ok: true }, r));
  } catch (e) {
    if (e instanceof HttpsError) {
      const reason = (e.details && e.details.reason) || e.code;
      logger.info('cxBot: refused', { biz: v.bizId, op, log: lg, reason });
      return no(STATUS[e.code] || 500, reason, e.message);
    }
    logger.error('cxBot: failed', { biz: v.bizId, op, log: lg, name: e && e.name, code: e && e.code, msg: String(e && e.message).slice(0, 200) });
    return no(500, 'internal', 'תקלה בשרת. ננסה שוב.');
  }
}

// ---------- התראות ----------
const MSG = {
  'needs-login': 'צריך להתחבר מחדש לכספית בדפדפן Chrome במחשב החנות. אחרי ההתחברות הסנכרון ימשיך לבד.',
  'selector-miss': 'מסך בכספית השתנה והרובוט לא מצא כפתור או קובץ. הסנכרון נעצר – פרטים באפליקציה, בסנכרון כספית.',
  'import-errors': 'הטעינה לכספית הסתיימה עם שורות שגויות (או נכשלה). המספרים באפליקציה, בסנכרון כספית; הקובץ השגוי – ב"טעינות קודמות" בכספית.',
  'import-timeout': 'כספית לא סיימה את הטעינה בזמן. כדאי לבדוק ב"טעינות קודמות" בכספית אם היא הסתיימה.',
  'import-queue-not-empty': 'במסך הייבוא של כספית ממתינים קבצים שמישהו הוסיף ולא העלה – הרובוט לא העלה כלום. כדאי לנקות את "ממתין לטעינה" בכספית.',
  'wrong-page': 'התוסף הגיע לדף שאינו המשרד האחורי של כספית ועצר (בלי לגעת בקופה). פרטים באפליקציה, בסנכרון כספית.',
  limit: 'יותר מדי שינויים לכספית בריצה אחת – הרובוט עצר לבדיקה. פרטים באפליקציה, בסנכרון כספית.',
  nosync: 'המחשב בחנות לא סנכרן מול כספית הלילה. בדקו שהמחשב דלוק ו-Chrome פתוח.',
  nosync2: 'כבר יומיים ויותר המחשב בחנות לא סנכרן מול כספית! בדקו שהמחשב דלוק, ש-Chrome פתוח ושאתם מחוברים לכספית.',
  updfail: 'העדכון האוטומטי של התוסף במחשב החנות נכשל כמה פעמים ברצף. הסנכרון ממשיך בגרסה הנוכחית – פרטים באפליקציה, בכרטיס "רובוט".',
  updstale: 'העדכון האוטומטי של התוסף במחשב החנות לא רץ כבר יומיים (המשימה המתוזמנת ב-Windows הופסקה או נמחקה?). פרטים באפליקציה, בכרטיס "רובוט".',
  updlag: 'גרסה חדשה של התוסף הורדה למחשב החנות אבל לא נטענה. כדאי לסגור ולפתוח את Chrome במחשב (או ללחוץ ⟳ ב-chrome://extensions).',
  pd: (n) => `${n} שינויים שנשלחו לכספית עדיין לא נקלטו שם, גם אחרי 2 סנכרוני קטלוג. כדאי לבדוק בכספית את ייבוא הקבצים.`,
};
// שולח לכל מנהלי העסק התראה אחת לכל סוג ביום (b/{bizId}/private/cxbot.watch). → הסוגים שנשלחו
async function alertBiz(bizId, list, now, o, extra) {
  const ref = priv(bizId, 'cxbot.watch'), day = ilDay(now);
  const todo = await ref.firestore.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const sent = s.exists && s.get('d') === day ? Object.assign({}, s.get('sent') || {}) : {};
    const t = [...new Set(list)].filter((k) => !sent[k]);
    t.forEach((k) => { sent[k] = now; });
    if (t.length) tx.set(ref, { d: day, sent }, { merge: true });
    return t;
  });
  if (!todo.length) return [];
  const biz = await T.loadBiz(bizId);
  if (!biz) return [];
  const pushMgrs = require('./daily-rep')._core.pushMgrs;
  await T.runInBiz({ bizId, prefix: T.bizPrefix(biz), biz }, async () => {
    const db = T.tdb();
    for (const k of todo) {
      const body = typeof MSG[k] === 'function' ? MSG[k]((extra && extra.n) || 0) : MSG[k];
      await pushMgrs(db, { uid: 'cxbot', bizId }, 'cx' + k, '', Object.assign({}, o, { msg: { k: 'cx', id: k, title: 'רובוט כספית', body } }));
    }
  });
  logger.info('cxBotWatch: alert', { biz: bizId, k: todo });
  return todo;
}

// בדיקה לעסק אחד (בתוך T.runInBiz). → הסוגים שנשלחו
async function watchBiz(biz, dev, now, o) {
  const today = ilDay(now), yday = addDays(today, -1), hh = ilHour(now);
  const list = [];
  const lr = dev.lr;
  if (lr && ALERT_CODES.includes(lr.code) && now - (lr.at || 0) < 24 * 3600e3) list.push(lr.code === 'endpoint-changed' ? 'selector-miss' : lr.code);
  let n = 0;
  if (hh >= 10) {
    // עדכון אוטומטי (רק אם הותקן – יש upd): נכשל פעמיים ברצף / לא רץ 48 שעות כשהמחשב פעיל / גרסה שהורדה ולא נטענה
    const u = dev.upd;
    if (u && typeof u === 'object') {
      const seen = Math.max(dev.last || 0, dev.pl || 0);
      if (u.ok === false && (u.fails || 0) >= 2) list.push('updfail');
      else if (now - (u.at || 0) > 48 * 3600e3 && now - seen < 24 * 3600e3) list.push('updstale');
      else if (u.ok && u.ver && dev.ver && cmpVer(dev.ver, u.ver) < 0 && now - (u.at || 0) > 3600e3) list.push('updlag');
    }
    // "לא סנכרן הלילה": היום האחרון שנקלט (או היום שלפני החיבור) קודם לאתמול
    const last = dev.sd || (dev.at ? addDays(ilDay(dev.at), -1) : yday);
    if (last < yday) list.push(last < addDays(yday, -1) ? 'nosync2' : 'nosync');
    // שורות שנשלחו לכספית וממתינות (pd) גם אחרי 2 קטלוגים – פעם ביום
    const wref = priv(biz.bizId, 'cxbot.watch'), ws = await wref.get();
    if (!(ws.exists && ws.get('pdChk') === today)) {
      const db = T.tdb(), cfg = CX.cfgOf(await db.doc(CX.CFG).get());
      if (cfg.cats.length >= 2) {
        const t2 = cfg.cats[cfg.cats.length - 2];
        const pend = (x) => (x.pr && x.pr.pd != null) || (x.co && x.co.pd != null);
        const [a, nw] = await Promise.all([
          db.collection('cxItem').where('xAt', '<', t2).where('xAt', '>=', t2 - 30 * 864e5).select('pr', 'co').limit(2000).get(),
          db.collection('cxItem').where('nw', '==', true).select('pr', 'co', 'at').limit(500).get(),
        ]);
        n = a.docs.filter((d) => pend(d.data())).length + nw.docs.filter((d) => (d.get('at') || 0) < t2 && pend(d.data())).length;
        if (n) list.push('pd');
      }
      await wref.set({ pdChk: today }, { merge: true });
    }
  }
  return list.length ? alertBiz(biz.bizId, list, now, o, { n }) : [];
}
async function runWatch(opts) {
  const o = opts || {}, now = o.now || Date.now();
  const out = {};
  for (const biz of await T.bizzesWith('orders')) {
    try {
      if (biz.status !== 'active') continue;
      const s = await priv(biz.bizId, 'cxbot').get();
      if (!s.exists || !s.get('h')) continue;
      out[biz.bizId] = await T.runInBiz({ bizId: biz.bizId, prefix: T.bizPrefix(biz), biz }, () => watchBiz(biz, s.data(), now, o));
    } catch (e) {
      logger.error('cxBotWatch: biz failed', { biz: biz.bizId, name: e && e.name, code: e && e.code });
      out[biz.bizId] = { error: true };
    }
  }
  return out;
}

// ---------- ייצוא ----------
const mgr = (fn) => CX.wrap(fn.name, async (request) => fn(await CX.mgrW(request), inputObject(request)));
exports.cxBotTok = onCall(mgr(cxBotTok));
exports.cxBotDisc = onCall(mgr(cxBotDisc));
// HTTP – אזור אחד בלבד (כתובת קבועה בתוסף: build.js)
exports.cxBot = onRequest({ region: NEW_REGION, timeoutSeconds: 300, memory: '1GiB', maxInstances: 5 }, async (req, res) => {
  try { await handle(req, res); } catch (e) {
    logger.error('cxBot: crashed', { name: e && e.name, code: e && e.code });
    if (!res.headersSent) res.status(500).json({ ok: false, reason: 'internal', msg: 'תקלה בשרת. ננסה שוב.' });
  }
});
// מתוזמנת – אזור אחד בלבד (אסור להריץ כפול)
exports.cxBotWatch = onSchedule({ region: LEGACY_REGION, schedule: 'every 60 minutes', timeZone: TK.TZ, timeoutSeconds: 300, memory: '256MiB' }, async () => {
  const r = await runWatch({});
  if (Object.values(r).some((x) => x && (x.length || x.error))) logger.info('cxBotWatch', r);
});

Object.defineProperty(exports, '_core', { enumerable: false, value: { handle, verify, clientIp, FAIL_BUCKETS, REQ_MS, RUN_MS, PL_MS, NOW_VER, cxBotTok, cxBotDisc, runWatch, watchBiz, alertBiz, daysFor, cmpVer, updOf, ilDay, addDays, EXT_ORIGIN, MIN_VER, LIM, OPS, MSG } });
