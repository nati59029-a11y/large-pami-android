'use strict';
// המזכירה העסקית – שלב 1 "שלד ותוספת" (משימה 2026-11-10_מזכירה-עסקית-באפליקציה, אפיון סעיפים 2, 8, 9.4–9.6, 10.6–10.8).
// כל הנתונים בתוך העסק (b/{bizId}/..., ובלארג' פעמי במצב legacy – בשורש; T.tdb()). כל כתיבה – רק כאן (השרת).
//
//   sec_cfg/main   { mode: 'all'|'main', mainUid, emp (ניתוח עובדים ומידע רגיש), pay: { <uid>: bool } (מתג שכר לכל מנהל, 7),
//                    mgr: { <uid>: { cv (מזהה נוסח ההסכמה), ca (מתי אושר, ms), nm (שם המזכירה), ad ('m'|'f' – פנייה), call } },
//                    upd, updBy }                                       – מנהלי העסק קוראים (חוקים); כתיבה רק כאן
//   sec_cfg/cap    { capCents, upd, updBy }                             – תקרה חודשית (82). מנהל־על בלבד (83: מנהל העסק רואה רק אחוז)
//   sec_log/{id}   { t, by, who: 'mgr'|'sa'|'sec'|'auto', act, ch, tgt?, note? } – הוספה בלבד (10.7)
//   sec_chat/{uid}/m/{id} { t, role: 'u'|'a', text, src?, asOf?, mode?, deep? } – שלב 2: נכתב רק כאן (secChat); נקרא דרך secChatLoad / secAdminReadChat
//   sec_cfg/main   + שלב 2: mirror (מתג המראה, 45; ברירת מחדל פעיל), cfTh (סף תזרים שהמנהל אישר, 51), nr { <מפתח רעיון>: עד מתי לא להציע (56) }
//   sec_cfg/use    { m, mc, d, dmc, w80, w100, r: { <uid>: { h, n, d, dn } }, mp: { h, n } } – מונה עלות במילי־סנט + קצב. מנהל־על בלבד (83)
//   sec_usage/{YYYY-MM} { msgs, deep, pct, saving, upd }               – מספרים בלבד; מנהל העסק רואה אחוז ניצול
//   sec_mirror/fin { v, fin, at, devAt, by } ; sec_mirror/pay { pay, at, by } – מראה הכספים (5.2, 41–45). השרת בלבד
//
// פונקציות:
//   מנהל העסק:  secState, secConsent, secSetup; שלב 2: secChat, secChatLoad, secMirrorPut, secPrefs
//   מנהל־על:    secAdminGet, secAdminSetCfg, secAdminReadChat
//   מתוזמנת:    secBackupDaily – גיבוי כל אוספי sec_* לכל עסק ל-Storage (sec_backups/...). שחזור: _core.restoreSecBackup
//
// הרשאה (10.6): requireStaff + תוספת 'secretary' + מנהל אמיתי של העסק (admins/{uid}; מנהל־על שאינו מנהל העסק – לא) +
// עסק פעיל (גם למנהל־על) + מצב "מנהל ראשי בלבד" (6) + הסכמה (98) לכל פעולה חוץ מ-secState/secConsent.

const zlib = require('node:zlib');
const { HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineString } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const { getFirestore, Timestamp, GeoPoint, FieldPath, FieldValue } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const { onCall, LEGACY_REGION } = require('./lib/region');
const T = require('./lib/tenant');
const { requireStaff, inputObject } = require('./lib/roles');
const AI = require('./lib/sec-ai');
const ST = require('./lib/sec-tools');
const SK = require('./lib/sec-know');   // שלב 3: בנק תשובות
const SENS = require('./lib/sec-sens'); // שלב 3: מידע רגיש (מוצפן)
const RM = require('./lib/sec-remind'); // שלב 4: הגדרות התראות ודוחות

const bad = (reason, message) => new HttpsError('invalid-argument', message, { reason });
const deny = (reason, message) => new HttpsError('permission-denied', message, { reason });
const pre = (reason, message) => new HttpsError('failed-precondition', message, { reason });

const UID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_CAP_CENTS = 1000000; // 10,000$ לחודש – גבול עליון סביר להקלדה שגויה
const TZ = 'Asia/Jerusalem';
const BACKUP_KEEP_DAYS = 35; // מדיניות שמירה של עותקי הגיבוי (הנחת המתאם, תיקון סבב 1) – מופיעה גם בנוסח ההסכמה

// ---------- נוסח מסך ההסכמה (98). מקור אחד: השרת. שינוי בנוסח = מזהה חדש, וכל מנהל מתבקש לאשר שוב ----------
// v2 (תיקון סבב 1): נוסף משך השמירה של עותקי הגיבוי. חובה להחליף גם את הקבוע SEC_CONSENT_VER בחוקים (firestore.rules) – בדיקה ב-secretary.test.js
const CONSENT_VER = 'sec-terms-2026-11-v2';
const CONSENT = Object.freeze({
  ver: CONSENT_VER,
  title: 'לפני שמתחילים לעבוד עם המזכירה',
  items: Object.freeze([
    'המזכירה היא עוזרת ממוחשבת. היא מכינה הצעות, טיוטות ותזכורות – ושום דבר לא נשלח, לא משולם ולא נמחק בלי אישור שלך.',
    'כדי לענות, המזכירה שולחת את השאלה ואת הנתונים הנדרשים לה לשירות בינה מלאכותית חיצוני (ספק AI מחוץ לאפליקציה, ייתכן שבחו"ל). נשלח רק מה שנחוץ לשאלה.',
    'מנהל המערכת (בעל האפליקציה) רשאי לקרוא את השיחות שלך עם המזכירה. כל צפייה כזו נרשמת ביומן הפעולות, ואפשר לראות אותה במסך המזכירה.',
    'השיחות נשמרות עד 12 חודשים, ויומן הפעולות עד 24 חודשים. אפשר לבקש מחיקה של ההיסטוריה. בנוסף נשמר עותק גיבוי יומי בשרת, וכל עותק גיבוי נמחק אוטומטית אחרי 35 יום.',
    'המזכירה עלולה לטעות. לפני החלטה כספית, משפטית או החלטה לגבי עובד – יש לבדוק את הנתונים ולהתייעץ עם איש מקצוע.',
  ]),
  ok: 'קראתי ואני מסכים/ה',
});

const SEC_COLLS = Object.freeze(['sec_cfg', 'sec_chat', 'sec_in', 'sec_draft', 'sec_inv', 'sec_facts', 'sec_rules', 'sec_cal', 'sec_mirror', 'sec_rep', 'sec_log', 'sec_usage', 'sec_facts_sensitive', 'sec_note', 'sec_snd']); // sec_note – שלב 4; sec_snd (כרטיס שולח בווצאפ) – שלב 5
const SEC_ROOT_COLLS = Object.freeze(['sec_route', 'sec_mailroute']); // טבלאות ניתוב בשורש (שרת בלבד, משותפות לכל העסקים)

function cleanText(v, max) {
  return typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim().slice(0, max + 1) : '';
}

// ---------- הגדרות ----------
// ברירת מחדל (אין מסמך): כל המנהלים; ניתוח עובדים ומידע רגיש – פעיל רק בעסק הפיילוט (לארג' פעמי, פ4), כבוי בכל עסק אחר (10.8)
function cfgOf(snap, bizId) {
  const d = snap && snap.exists ? snap.data() || {} : {};
  const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
  return {
    exists: !!(snap && snap.exists),
    mode: d.mode === 'main' ? 'main' : 'all',
    mainUid: typeof d.mainUid === 'string' ? d.mainUid : '',
    emp: typeof d.emp === 'boolean' ? d.emp : bizId === T.BIZ0,
    pay: obj(d.pay),
    sens: obj(d.sens), // שלב 3: הרשאה אישית למידע רגיש על עובדים (10.8 המלצה 2), לכל מנהל – מנהל־על קובע
    mgr: obj(d.mgr),
    mirror: d.mirror !== false,
    cfTh: typeof d.cfTh === 'number' && Number.isFinite(d.cfTh) ? d.cfTh : null,
    nr: obj(d.nr),
    // קצב הודעות לכל מנהל (10.3, 89): מנהל־על קובע לכל עסק; בלי הגדרה – ברירת המחדל
    rate: { hour: Number.isInteger(d.rate && d.rate.hour) ? d.rate.hour : RATE_HOUR, day: Number.isInteger(d.rate && d.rate.day) ? d.rate.day : RATE_DAY },
  };
}
const empDefault = (bizId) => bizId === T.BIZ0;

function logData(by, who, act, extra) {
  const o = { t: Date.now(), by: String(by || ''), who, act: String(act).slice(0, 40), ch: 'app' };
  if (extra && extra.tgt) o.tgt = String(extra.tgt).slice(0, 128);
  if (extra && extra.note) o.note = String(extra.note).slice(0, 300);
  return o;
}

// ---------- שער ההרשאה של מנהל העסק (10.6) ----------
async function gate(request, opts) {
  const o = opts || {};
  const who = await requireStaff(request, { feature: 'secretary' });
  if (who.role !== 'manager') throw deny('not-manager', 'המזכירה זמינה למנהלי העסק בלבד');
  // requireStaff נותן למנהל־על גישה גם לעסק מושהה – כאן חוסמים גם אותו (2.2)
  if (who.biz.status !== 'active') throw deny('biz-suspended', 'החשבון מושהה – פנה לספק');
  const db = T.tdb();
  const [adm, cs] = await Promise.all([db.doc('admins/' + who.uid).get(), db.doc('sec_cfg/main').get()]);
  // מנהל־על שאינו מנהל של העסק – לא משתמש במזכירה של העסק (הוא קורא שיחות רק דרך secAdminReadChat, עם רישום)
  if (!adm.exists) throw deny('not-biz-admin', 'המזכירה זמינה למנהלי העסק בלבד');
  const cfg = cfgOf(cs, who.bizId);
  if (cfg.mode === 'main' && cfg.mainUid !== who.uid) throw deny('not-main-manager', 'בעסק הזה המזכירה זמינה רק למנהל הראשי');
  const me = cfg.mgr[who.uid] && typeof cfg.mgr[who.uid] === 'object' ? cfg.mgr[who.uid] : {};
  const consented = me.cv === CONSENT_VER;
  if (o.consent && !consented) throw pre('no-consent', 'צריך לאשר את תנאי השימוש במזכירה לפני שמתחילים');
  // מנהל עם הגבלת סניפים (admins/{uid}.br): נתוני כל העסק (המראה, נתוני ענן) לא נמסרים לו בצ'אט (החלטת המתאם, סבב 1)
  const brLimited = !who.superadmin && Array.isArray(adm.get('br'));
  // מידע רגיש (10.8): המתג העסקי (ניתוח עובדים ומידע רגיש) + הרשאה אישית של המנהל + בלי הגבלת סניפים
  const sensOn = cfg.emp === true && cfg.sens[who.uid] === true && !brLimited;
  return { who, cfg, me, consented, db, brLimited, sensOn };
}

// secState: מה האפליקציה צריכה כדי להציג כפתור, כרטיס, הסכמה ואשף. לא דורש הסכמה (כדי להציג את מסך ההסכמה).
async function secState(request) {
  inputObject(request);
  const { who, cfg, me, consented, sensOn } = await gate(request);
  const out = {
    ok: true, bizId: who.bizId, mode: cfg.mode, isMain: cfg.mode === 'main',
    consented, consentAt: consented && Number.isFinite(me.ca) ? me.ca : null, consentVer: CONSENT_VER,
    name: typeof me.nm === 'string' ? me.nm : '', addr: me.ad === 'f' ? 'f' : me.ad === 'm' ? 'm' : '', call: typeof me.call === 'string' ? me.call : '',
    pay: cfg.pay[who.uid] === true, emp: cfg.emp === true,
    sens: sensOn, we: me.we === 'accept' ? 'accept' : 'warn', // שלב 3: מידע רגיש; פגישה בשישי/שבת/חג (72)
    rows: [], // כרטיס הבית מתמלא בהדרגה (11): ממתינים / חשבוניות / תזכורות – נוספים רק בשלבים שבונים אותם
  };
  out.setupDone = !!(out.name && out.addr);
  if (!consented) out.consent = CONSENT;
  // שלב 2: מתג המראה (45), סף התזרים שאושר (51), אחוז ניצול בלבד (83) ומצב חיסכון (84). בלי סכומי עלות ובלי התקרה עצמה
  const db = T.tdb();
  const [use, cap, mir, un] = await Promise.all([db.doc('sec_cfg/use').get(), db.doc('sec_cfg/cap').get(), cfg.mirror ? db.doc('sec_mirror/fin').get() : null,
    consented ? db.collection(`sec_note/${who.uid}/n`).where('seen', '==', false).count().get() : null]);
  const u = usageOf(use, capOf(cap), Date.now());
  // שלב 4: הגדרות ההתראות האישיות + מספר התראות שלא נקראו (שורה בכרטיס הבית – 11)
  out.nt = RM.ntOf(me); out.types = Object.fromEntries(Object.entries(RM.TYPES).map(([k, v]) => [k, v.l]));
  out.unseen = un ? un.data().count : 0;
  if (out.unseen) out.rows.push({ k: 'notes', t: out.unseen === 1 ? 'התראה חדשה אחת' : out.unseen + ' התראות חדשות' });
  // שלב 5: טיוטות ווצאפ שממתינות לאישור (שורה בכרטיס הבית – 11)
  const wp = consented ? (await db.collection('sec_draft').where('st', '==', 'pend').count().get()).data().count : 0;
  if (wp) out.rows.unshift({ k: 'wa', t: wp === 1 ? 'הודעת ווצאפ אחת ממתינה לתשובה' : wp + ' הודעות ווצאפ ממתינות לתשובה' });
  Object.assign(out, { mirror: cfg.mirror, mirrorAt: mir && mir.exists && Number.isInteger(mir.get('at')) ? mir.get('at') : null, cfTh: cfg.cfTh, pct: u.pct, saving: u.saving });
  return out;
}

async function secConsent(request) {
  const input = inputObject(request);
  const { who, consented, db } = await gate(request);
  if (input.ver !== CONSENT_VER) throw bad('bad-consent-ver', 'נוסח התנאים התעדכן. פתחו את המסך מחדש ואשרו שוב.');
  if (input.ok !== true) throw bad('bad-consent', 'צריך לסמן אישור');
  if (consented) return { ok: true, ver: CONSENT_VER, already: true };
  const t = Date.now();
  const b = db.batch();
  b.set(db.doc('sec_cfg/main'), { mgr: { [who.uid]: { cv: CONSENT_VER, ca: t } }, upd: t }, { merge: true });
  b.set(db.collection('sec_log').doc(), logData(who.uid, 'mgr', 'consent', { note: CONSENT_VER }));
  await b.commit();
  return { ok: true, ver: CONSENT_VER, at: t };
}

// secSetup – אשף ההקמה הקצר של המנהל (107): 1. שם המזכירה, 2. אופן פנייה. אישי לכל מנהל (שיחה אישית – 2.3).
async function secSetup(request) {
  const input = inputObject(request);
  const { who, db } = await gate(request, { consent: true });
  const nm = cleanText(input.name, 30);
  if (!nm || nm.length > 30) throw bad('bad-name', 'שם המזכירה: עד 30 תווים');
  if (!['m', 'f'].includes(input.addr)) throw bad('bad-addr', 'בחרו אופן פנייה');
  const call = cleanText(input.call, 30);
  if (call.length > 30) throw bad('bad-call', 'איך לפנות אליך: עד 30 תווים');
  const t = Date.now();
  const b = db.batch();
  b.set(db.doc('sec_cfg/main'), { mgr: { [who.uid]: { nm, ad: input.addr, call } }, upd: t }, { merge: true });
  b.set(db.collection('sec_log').doc(), logData(who.uid, 'mgr', 'setup'));
  await b.commit();
  return { ok: true, name: nm, addr: input.addr, call };
}

// =====================================================================================
// שלב 2: מראה הכספים, צ'אט עם כלים, ייעוץ (אפיון 5.2–5.5, 6.1–6.3, 9.3, 10.1, 10.3, 11.3)
// =====================================================================================
const DEFAULT_CAP_CENTS = 1000;   // בלי תקרה שנקבעה – 10$ לחודש כרשת ביטחון (הנחה; מנהל־על קובע – 82)
const DAY_CAP_DIV = 10;           // תקרה יומית = עשירית מהחודשית (11.3)
const CHAT_MAX = 2000;            // תווים בשאלה (10.3)
const FIN_MAX = 400000;           // גודל נתוני הכספים שמגיעים מהמכשיר (JSON)
const RATE_HOUR = 40, RATE_DAY = 200; // הודעות לכל מנהל (10.3; הנחה)
const MIRROR_HOUR = 40;           // עדכוני מראה לעסק בשעה (האפליקציה שולחת לכל היותר פעם ב-3 דקות)
// שמירה מראש במונה לפני הקריאה למודל (11.3), מילי־סנט: העלות המרבית האפשרית – MAX_ROUNDS סבבים, כל אחד עד 20,000 טוקנים נכנסים
// ועד מגבלת הפלט של המודל (2,048 מהיר / 8,192 איכותי). מחושב לפי המחירים שבהגדרות (sec-ai.js)
const MAX_IN_ROUND = 20000;
const reserveOf = (tier) => AI.costMc(tier, { in: 5 * MAX_IN_ROUND, out: 5 * (tier === 'deep' ? 8192 : 2048) });
const STALE_MS = 3 * 864e5;       // מראה ישן מ-3 ימים – אומרים ומתריעים (44)
const HIST = 10;                  // הודעות קודמות שנשלחות למודל
const MAX_ROUNDS = 5, MAX_CALLS = 4;

const monthKey = (ms) => dayKey(ms).slice(0, 7);
const hourKey = (ms) => new Date(ms).toLocaleString('sv-SE', { timeZone: TZ }).slice(0, 13);
const capOf = (snap) => (snap && snap.exists && Number.isInteger(snap.get('capCents')) ? snap.get('capCents') : DEFAULT_CAP_CENTS);
function usageOf(snap, capCents, now) {
  const d = snap && snap.exists ? snap.data() || {} : {};
  const m = monthKey(now), day = dayKey(now);
  const mc = d.m === m && Number.isFinite(d.mc) ? d.mc : 0, dmc = d.d === day && Number.isFinite(d.dmc) ? d.dmc : 0;
  const capMc = capCents * 1000;
  const saving = capMc <= 0 || mc >= capMc ? 'month' : dmc >= capMc / DAY_CAP_DIV ? 'day' : '';
  return { m, day, mc, dmc, capMc, pct: capMc > 0 ? Math.min(100, Math.floor((mc / capMc) * 100)) : 100, saving };
}

// מונה: קצב לכל מנהל + עלות (שמירה מראש). reserve=false – רק קצב (תשובה שלא עולה כסף)
async function meter(db, uid, tier, reserve, rate) {
  const RL = rate || { hour: RATE_HOUR, day: RATE_DAY };
  const now = Date.now();
  const useRef = db.doc('sec_cfg/use');
  return db.runTransaction(async (tx) => {
    const [us, cs] = await Promise.all([tx.get(useRef), tx.get(db.doc('sec_cfg/cap'))]);
    const u = usageOf(us, capOf(cs), now);
    const d = us.exists ? us.data() || {} : {};
    const r0 = d.r && typeof d.r === 'object' && d.r[uid] && typeof d.r[uid] === 'object' ? d.r[uid] : {};
    const h = hourKey(now);
    const r = { h, n: r0.h === h ? (r0.n || 0) : 0, d: u.day, dn: r0.d === u.day ? (r0.dn || 0) : 0 };
    if (r.n >= RL.hour || r.dn >= RL.day) throw new HttpsError('resource-exhausted', 'יותר מדי הודעות בזמן קצר. נסו שוב מאוחר יותר.', { reason: 'rate-limit' });
    r.n++; r.dn++;
    const upd = { m: u.m, mc: u.mc, d: u.day, dmc: u.dmc, r: Object.assign({}, d.r && typeof d.r === 'object' ? d.r : {}, { [uid]: r }) };
    let reserved = 0;
    if (reserve && !u.saving) {
      // מה שנשאר מהתקרה (החודשית והיומית). "חשבי לעומק" רק כשנשאר מספיק לעלות המרבית; מהיר – עד מה שנשאר
      const left = Math.min(u.capMc - u.mc, u.capMc / DAY_CAP_DIV - u.dmc);
      const max = reserveOf(tier);
      if (tier === 'deep' && left < max) throw new HttpsError('resource-exhausted', 'לא נשאר מספיק מתקרת השימוש ל"חשבי לעומק". אפשר לשאול שאלה רגילה.', { reason: 'deep-over-cap' });
      reserved = Math.max(1, Math.min(max, Math.floor(left)));
      upd.mc += reserved; upd.dmc += reserved;
    }
    tx.set(useRef, upd, { merge: true });
    return { saving: reserve ? u.saving : '', reserved, m: u.m, day: u.day, capMc: u.capMc };
  });
}
// אחרי הקריאה: מעדכנים לעלות בפועל (delta יכול להיות שלילי). התראה ב-80% וב-100% – פעם בחודש, ביומן (התראת push – שלב 4)
async function settle(db, uid, mt, delta, deep) {
  const useRef = db.doc('sec_cfg/use');
  const res = await db.runTransaction(async (tx) => {
    const us = await tx.get(useRef);
    const d = us.exists ? us.data() || {} : {};
    const upd = {};
    let mc = d.mc || 0;
    if (d.m === mt.m) { mc = Math.max(0, mc + delta); upd.mc = mc; }
    if (d.d === mt.day) upd.dmc = Math.max(0, (d.dmc || 0) + delta);
    const pct = mt.capMc > 0 ? Math.min(100, Math.floor((mc / mt.capMc) * 100)) : 100;
    const ev = [];
    if (pct >= 80 && d.w80 !== mt.m) { upd.w80 = mt.m; ev.push('cap80'); }
    if (pct >= 100 && d.w100 !== mt.m) { upd.w100 = mt.m; ev.push('cap100'); }
    if (Object.keys(upd).length) tx.update(useRef, upd);
    tx.set(db.doc('sec_usage/' + mt.m), { msgs: FieldValue.increment(1), deep: FieldValue.increment(deep ? 1 : 0), pct, saving: pct >= 100, upd: Date.now() }, { merge: true });
    for (const e of ev) tx.set(db.collection('sec_log').doc(), logData(uid, 'auto', e, { note: pct + '%' }));
    return { pct, saving: pct >= 100 };
  });
  return res;
}

function parseJ(s) { try { return typeof s === 'string' && s.length <= FIN_MAX ? JSON.parse(s) : null; } catch (e) { return null; } }
function finSize(x) { try { return Buffer.byteLength(JSON.stringify(x), 'utf8'); } catch (e) { return Infinity; } }
function readFin(x) {
  if (finSize(x) > FIN_MAX) throw bad('fin-too-big', 'נתוני הכספים גדולים מדי');
  const f = ST.cleanFin(x);
  if (!f) throw bad('bad-fin', 'נתוני הכספים לא תקינים');
  if (f.at > Date.now() + 10 * 60000) f.at = Date.now(); // שעון מכשיר שקדים – לא "נכון ל" עתידי
  return f;
}

// secMirrorPut({ fin }) – האפליקציה של המנהל אחרי שמירה (43). מראה כבוי (45) = נדחה. עובד/עסק אחר – נחסמים ב-gate
async function secMirrorPut(request) {
  const input = inputObject(request);
  const { who, cfg, db, brLimited } = await gate(request, { consent: true });
  if (!cfg.mirror) throw pre('mirror-off', 'מראה הכספים כבוי בהגדרות');
  if (brLimited) throw deny('branch-limited', 'מנהל עם הגבלת סניפים לא מעדכן את מראה הכספים (הנתונים במכשיר שלו חלקיים)');
  const fin = readFin(input.fin);
  const now = Date.now();
  const useRef = db.doc('sec_cfg/use');
  await db.runTransaction(async (tx) => {
    const us = await tx.get(useRef);
    const mp = us.exists && us.get('mp') && typeof us.get('mp') === 'object' ? us.get('mp') : {};
    const h = hourKey(now), n = mp.h === h ? (mp.n || 0) : 0;
    if (n >= MIRROR_HOUR) throw new HttpsError('resource-exhausted', 'יותר מדי עדכונים בשעה', { reason: 'rate-limit' });
    tx.set(useRef, { mp: { h, n: n + 1 } }, { merge: true });
    const pay = fin.pay; delete fin.pay;
    // נשמר כמחרוזת JSON (ב-Firestore אין מערך בתוך מערך), כמו התצוגות לעובדים (wv)
    tx.set(db.doc('sec_mirror/fin'), { v: 1, data: JSON.stringify(fin), at: now, devAt: fin.at, by: who.uid });
    if (pay) tx.set(db.doc('sec_mirror/pay'), { data: JSON.stringify(pay), at: now, by: who.uid });
  });
  return { ok: true, at: now };
}

// secPrefs – הגדרות של מנהל העסק: מתג המראה (45), אישור סף התזרים (51), "לא רלוונטי" לרעיון (56)
const NR_DAYS = 90, NR_MAX = 200, PREFS_HOUR = 30;
async function secPrefs(request) {
  const input = inputObject(request);
  const { who, cfg, me, db } = await gate(request, { consent: true });
  const t = Date.now();
  // קצב (10.3): כל שינוי נרשם ביומן שאי אפשר למחוק – עד PREFS_HOUR שינויים בשעה לכל מנהל
  await db.runTransaction(async (tx) => {
    const ref = db.doc('sec_cfg/use');
    const us = await tx.get(ref);
    const pp = us.exists && us.get('pp') && typeof us.get('pp') === 'object' && us.get('pp')[who.uid] ? us.get('pp')[who.uid] : {};
    const h = hourKey(t), n = pp.h === h ? (pp.n || 0) : 0;
    if (n >= PREFS_HOUR) throw new HttpsError('resource-exhausted', 'יותר מדי שינויים בזמן קצר. נסו שוב בעוד שעה.', { reason: 'rate-limit' });
    tx.set(ref, { pp: { [who.uid]: { h, n: n + 1 } } }, { merge: true });
  });
  const b = db.batch();
  const main = db.doc('sec_cfg/main');
  let out;
  if (input.op === 'mirror') {
    if (typeof input.on !== 'boolean') throw bad('bad-input', 'ערך לא תקין');
    b.set(main, { mirror: input.on, upd: t }, { merge: true });
    b.set(db.collection('sec_log').doc(), logData(who.uid, 'mgr', 'mirror', { note: input.on ? 'on' : 'off' }));
    out = { mirror: input.on };
  } else if (input.op === 'threshold') {
    const a = input.amount;
    if (a !== null && !(typeof a === 'number' && Number.isFinite(a) && a >= 0 && a <= 1e8)) throw bad('bad-amount', 'סף לא תקין');
    b.set(main, { cfTh: a === null ? FieldValue.delete() : Math.round(a), upd: t }, { merge: true });
    b.set(db.collection('sec_log').doc(), logData(who.uid, 'mgr', 'threshold', { note: a === null ? 'none' : String(Math.round(a)) }));
    out = { cfTh: a === null ? null : Math.round(a) };
  } else if (input.op === 'notRelevant') {
    const k = typeof input.key === 'string' ? input.key : '';
    // שם שדה ב-Firestore: בלי תווי בקרה, בלי "__x__" (שמור), בלי נקודה/לוכסן/סוגריים (נתיב)
    if (!k || k.length > 120 || /[\u0000-\u001f.\/\[\]`*~]/.test(k) || /^__.*__$/.test(k)) throw bad('bad-key', 'מפתח לא תקין');
    const nr = {};
    for (const [x, v] of Object.entries(cfg.nr)) if (Number.isInteger(v) && v > t) nr[x] = v; // ניקוי פגי תוקף
    nr[k] = t + NR_DAYS * 864e5;
    const keep = Object.entries(nr).sort((x, y) => y[1] - x[1]).slice(0, NR_MAX);
    b.update(main, { nr: Object.fromEntries(keep), upd: t });
    b.set(db.collection('sec_log').doc(), logData(who.uid, 'mgr', 'notRelevant', { note: k }));
    out = { key: k, until: nr[k] };
  } else if (input.op === 'calWe') {
    // פגישה בשישי, בשבת או בחג (72): 'warn' – להזהיר ולהציע יום אחר (ברירת מחדל), 'accept' – לקבל בלי הערה. אישי לכל מנהל
    if (!['warn', 'accept'].includes(input.v)) throw bad('bad-input', 'ערך לא תקין');
    b.set(main, { mgr: { [who.uid]: { we: input.v } }, upd: t }, { merge: true });
    b.set(db.collection('sec_log').doc(), logData(who.uid, 'mgr', 'calWe', { note: input.v }));
    out = { we: input.v };
  } else if (input.op === 'notify') {
    // שלב 4: דוח שבועי/חודשי – יום ושעה (67), תקציר יומי (69, כבוי), שעות שקטות (74), חזרות (76), מתג לכל סוג תזכורת (77). אישי לכל מנהל
    let nt;
    try { nt = RM.readNt(input.nt && typeof input.nt === 'object' && !Array.isArray(input.nt) ? input.nt : {}, RM.ntOf(me)); } catch (e) { if (e && e.badNt) throw bad('bad-input', 'הגדרה לא תקינה'); throw e; }
    b.set(main, { mgr: { [who.uid]: { nt } }, upd: t }, { merge: true });
    b.set(db.collection('sec_log').doc(), logData(who.uid, 'mgr', 'notify', { note: 'wd=' + nt.wd + ',wh=' + nt.wh + ',mh=' + nt.mh + ',dg=' + (nt.dg ? 1 : 0) + ',q=' + (nt.q.on ? nt.q.f + '-' + nt.q.t : 'off') + ',reps=' + nt.reps }));
    out = { nt, warn: RM.wkWarn(nt.wd) };
  } else throw bad('bad-op', 'פעולה לא מוכרת');
  await b.commit();
  return Object.assign({ ok: true }, out);
}

// secChatLoad({ limit? }) – השיחה של המנהל עצמו, דרך השרת (גם למנהל־על שהוא מנהל של העסק – החוקים חוסמים אותו מקריאה ישירה)
async function secChatLoad(request) {
  const input = inputObject(request);
  const { who, db, sensOn } = await gate(request, { consent: true });
  const lim = input.limit === undefined ? 50 : input.limit;
  if (!Number.isInteger(lim) || lim < 1 || lim > 200) throw bad('bad-limit', 'מספר הודעות: 1 עד 200');
  const s = await db.collection(`sec_chat/${who.uid}/m`).orderBy('t', 'desc').limit(lim).get();
  return { ok: true, msgs: s.docs.map((d) => msgOut(d.id, d.data(), msgText(d, who, sensOn))).reverse() };
}
// טקסט של הודעה: הודעה עם מידע רגיש – מפוענחת רק כש-sensOn (מתג עסקי + הרשאה אישית); אחרת hidden (ברירת מחדל: הנוסח הכללי; null = לא נשלחת)
function msgText(d, who, sensOn, hidden) {
  const x = d.data ? d.data() : d;
  if (x.sens !== true) return typeof x.text === 'string' ? x.text : '';
  const hid = hidden === undefined ? SENS.HIDDEN : hidden;
  if (!sensOn) return hid;
  const rel = d.ref.path.replace(/^b\/[^/]+\//, '');
  const o = SENS.open(SENS.SEC_SENS_KEY.value(), who.bizId, rel, x.box);
  return o && typeof o.text === 'string' ? o.text : hid;
}
function msgOut(id, x, text) {
  const o = { id, t: x.t || null, role: x.role === 'a' ? 'a' : 'u', text: text !== undefined ? text : typeof x.text === 'string' ? x.text : '' };
  if (x.sens === true) o.sens = true;
  if (Array.isArray(x.src)) o.src = x.src.slice(0, 12);
  for (const k of ['asOf', 'mode', 'deep', 'stale', 'ideas', 'th', 'cards']) if (x[k] !== undefined && x[k] !== null) o[k] = x[k];
  return o;
}

const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/g;
// secChat({ text, deep?, fin? }) – צ'אט עם כלים. הכלים נקבעים כאן לפי ערוץ (app) והרשאות – לא לפי בקשת המודל (5.5)
async function secChat(request) {
  const input = inputObject(request);
  const { who, cfg, me, db, brLimited, sensOn } = await gate(request, { consent: true });
  if (typeof input.text !== 'string') throw bad('bad-text', 'כתבו שאלה');
  if (input.text.length > CHAT_MAX) throw bad('too-long', 'השאלה ארוכה מדי (עד ' + CHAT_MAX + ' תווים)');
  const text = input.text.replace(CTRL, '').trim();
  if (!text) throw bad('bad-text', 'כתבו שאלה');
  const deep = input.deep === true;
  const tier = deep ? 'deep' : 'fast';
  const now = Date.now();
  const payOn = cfg.pay[who.uid] === true && !brLimited;
  // נתוני הכספים: קודם מהמכשיר (87 – רק לשיחה הזו, לא נשמרים), אחרת מהמראה (אם המתג פעיל)
  let fin = null, finFrom = '', mirrorAt = 0, pay = null;
  if (brLimited) { /* מנהל עם הגבלת סניפים: לא נתוני מכשיר, לא מראה */ }
  else if (input.fin !== undefined && input.fin !== null) { fin = readFin(input.fin); finFrom = 'device'; pay = fin.pay || null; delete fin.pay; }
  else if (cfg.mirror) {
    const ms = await db.doc('sec_mirror/fin').get();
    if (ms.exists) { fin = ST.cleanFin(parseJ(ms.get('data'))); if (fin) { finFrom = 'mirror'; mirrorAt = ms.get('at') || fin.at; } }
  }
  if (!payOn) pay = null; // מתג השכר כבוי – שום נתון שכר לא נכנס לשיחה
  else if (!pay && cfg.mirror) { const ps = await db.doc('sec_mirror/pay').get(); if (ps.exists) pay = (ST.cleanFin({ v: 1, at: 1, pay: parseJ(ps.get('data')) }) || {}).pay || null; }
  const asOf = finFrom === 'mirror' ? mirrorAt : fin ? fin.at : null;
  const stale = finFrom === 'mirror' && now - mirrorAt > STALE_MS;

  const pol = ST.policyOf(text);
  const logs = [];
  const results = [];
  let sensUsed = false; // תיקון סבב 1: התור הזה הפעיל את getSensitiveInfo
  let sensHist = false; // שלב 4: ההיסטוריה שנשלחה למודל כללה הודעה רגישה (מפוענחת)
  const cards = []; // שלב 3: כרטיסי אישור (עובדה / אירוע) שהכלים propose* יצרו
  let reply = null, mode = 'ok', mt = null, usage = { in: 0, out: 0 }, sent = 0, denied = [], offered = [];
  let bank = null, bankCond = [];
  if (!pol.sensitive && !deep) {
    // בנק תשובות (3.5): לפני כל פנייה למודל. התאמה בלי תנאים = התשובה השמורה, בלי AI ובלי עלות (נספר ב-sec_usage.bank).
    // "חשבי לעומק" – תמיד למודל. כלל עם תנאים – עובר למודל כמידע (עד 40)
    const rs = await db.collection('sec_rules').limit(SK.RULES_MAX).get();
    const m = SK.bankMatch(text, rs.docs.map((d) => Object.assign({ id: d.id }, d.data())));
    bank = m.hit; bankCond = m.cond;
  }
  if (pol.sensitive) {
    // שאלה שמבקשת מסקנה לפי מצב בריאותי/משפחתי (6.3 כלל 3): תשובה קבועה, בלי מודל ובלי עלות
    await meter(db, who.uid, tier, false, cfg.rate);
    reply = ST.TXT.sensitive; mode = 'policy';
    logs.push(['policy', 'sensitive']);
  } else if (bank) {
    await meter(db, who.uid, tier, false, cfg.rate); // קצב בלבד – אין עלות
    reply = bank.rule.a; mode = 'bank';
    logs.push(['bank', '', bank.rule.id]);
  } else {
    mt = await meter(db, who.uid, tier, true, cfg.rate);
    if (mt.saving) { reply = mt.saving === 'day' ? ST.TXT.savingDay : ST.TXT.saving; mode = 'saving'; }
  }
  if (reply === null) {
    offered = ST.toolsFor('app', { pay: payOn, emp: cfg.emp === true, brLimited, sens: sensOn });
    const ctx = { now, fin, finFrom, mirrorAt, finOff: !cfg.mirror, pay, threshold: cfg.cfTh, nr: cfg.nr, uid: who.uid, we: me.we === 'accept' ? 'accept' : 'warn', cards };
    // מידע רגיש (10.8): נמסר למודל רק דרך הכלי, רק כשהוא הוצע (מתג עסקי + הרשאה אישית), ורק הרשומות של העובד שנשאל עליו (מזעור, עד 5)
    if (sensOn && offered.includes('getSensitiveInfo')) ctx.sensRead = async (emp) => {
      const pk = SENS.pickEmp(await SENS.readAll(db, SENS.SEC_SENS_KEY.value(), who.bizId), emp);
      const items = pk.items;
      logs.push(['sensTool', pk.ambiguous ? 'ambiguous' : 'n=' + items.length, items.map((x) => x.id).join(',').slice(0, 120)]);
      sensUsed = true; // תיקון סבב 1: כל התור (שאלה ותשובה) נשמר מוצפן ומסומן
      if (pk.ambiguous) return { ambiguous: true, names: pk.names, note: 'יש כמה עובדים בשם הזה. שאלי את המנהל לאיזה מהם הכוונה (שם מלא). לא נמסר שום מידע.' };
      if (!items.length) return { employee: SENS.clean(emp, SENS.NAME_MAX), count: 0, note: 'אין מידע רגיש שמור על העובד הזה.' };
      return { employee: items[0].emp, count: items.length, items: items.map((x) => ({ text: x.text, saved: SK.dayOf(x.t || now) })), _at: items.reduce((m, x) => Math.max(m, x.t || 0), 0) };
    };
    let turns;
    try {
      const hs = await db.collection(`sec_chat/${who.uid}/m`).orderBy('t', 'desc').limit(HIST).get();
      // תיקון סבב 1: הודעה שמבוססת על מידע רגיש (sens) – נשלחת למודל רק כשהמתג וההרשאה פעילים (מפוענחת), אחרת לא נשלחת בכלל
      turns = hs.docs.reverse().map((d) => ({ role: d.get('role') === 'a' ? 'a' : 'u', text: String(msgText(d, who, sensOn, null) || '').slice(0, 1500) })).filter((x) => x.text);
      // שלב 4 (תיקון משלב 3): היסטוריה מפוענחת עם מידע רגיש נשלחה למודל – בתור הזה אין proposeFact (שלא יוצע לשמור מידע רגיש כעובדה גלויה)
      sensHist = sensOn && hs.docs.some((d) => d.get('sens') === true);
    } catch (e) { await settle(db, who.uid, mt, -mt.reserved, deep).catch(() => {}); throw e; } // לא משאירים את השמירה מראש במונה
    turns.push({ role: 'u', text });
    const finNote = brLimited ? 'למנהל הזה יש הגבלת סניפים, ולכן אין לו בצ\'אט נתוני כספים ונתוני העסק. אם שואלים על כספים, משימות, קופה או הזמנות – עני בנימוס: "' + ST.TXT.brLimited + '"' : fin ? (finFrom === 'device' ? 'מהמכשיר של המנהל, נכון ל-' + ST.fmtAt(fin.at) : 'מהמראה בענן, נכון ל-' + ST.fmtAt(mirrorAt) + (stale ? ' (ישן מ-3 ימים – אמרי זאת)' : '')) : (!cfg.mirror ? 'המראה כבוי ואין נתונים מהמכשיר' : 'אין נתוני כספים');
    const bankNote = bankCond.length ? JSON.stringify(bankCond.map((r) => ({ q: r.q, a: r.a, cond: r.cond }))).slice(0, 12000) : '';
    const system = ST.systemPrompt({ name: me.nm, addr: me.ad, call: me.call, today: dayKey(now), q: text, pol, finNote, bankNote });
    let final = null, refused = false;
    try {
      for (let round = 0; round < MAX_ROUNDS && final === null && !refused; round++) {
        const r = await AI.chat({ tier, system, turns, tools: ST.declsOf(offered), timeoutMs: 45000 });
        sent += r.sent || 0; usage.in += r.usage.in; usage.out += r.usage.out;
        if (!r.calls.length) { final = r.text; break; }
        const calls = r.calls.slice(0, MAX_CALLS);
        turns.push({ role: 'call', calls });
        const res = [];
        for (const c of calls) {
          // כלי שלא הוצע בערוץ/בהרשאה הזו – לא מופעל, גם אם המודל ביקש (נרשם ביומן)
          if (!offered.includes(c.name)) { denied.push(String(c.name).slice(0, 40)); logs.push(['toolDenied', String(c.name).slice(0, 40)]); res.push({ name: c.name, data: { error: 'not-available', note: 'הכלי לא זמין' } }); continue; }
          if (c.name === 'refuseOffTopic') { refused = true; break; }
          // שלב 4 (תיקון משלב 3): בתור שבו המודל ראה מידע רגיש (הכלי הופעל, או היסטוריה רגישה) – אין הצעת עובדה. הכרטיס נשמר גלוי, והעובדה נמסרת אחר כך למודל בלי הגנה
          if (c.name === 'proposeFact' && (sensUsed || sensHist)) { denied.push('proposeFact'); logs.push(['toolDenied', 'proposeFact', '', 'sens']); res.push({ name: c.name, data: { error: 'not-available', note: 'אחרי שימוש במידע רגיש אי אפשר להציע לשמור עובדה בשיחה הזו. אפשר לשמור במסך "מידע על העסק".' } }); continue; }
          const data = await ST.runTool(c.name, c.args, ctx);
          const tgt = data._tgt, at0 = data._at; delete data._tgt; delete data._at;
          results.push({ name: c.name, data, src: ST.sourceOf(c.name, c.args, ctx, at0) });
          res.push({ name: c.name, data });
          logs.push(['tool', c.name, tgt, argNote(c.args, c.name)]);
        }
        if (!refused) turns.push({ role: 'res', results: res });
      }
    } catch (e) {
      const realSent = sent + (e && e.sent ? 1 : 0);
      await settle(db, who.uid, mt, realSent ? AI.costMc(tier, usage) - mt.reserved : -mt.reserved, deep).catch(() => {});
      if (logs.length) await writeLogs(db, who.uid, logs).catch(() => {});
      throw e;
    }
    if (refused) { reply = ST.TXT.offTopic; mode = 'offTopic'; logs.push(['offTopic']); }
    else if (final === null || !String(final).trim()) { reply = 'לא הצלחתי להשלים את התשובה. נסו לשאול שוב, בקצרה.'; mode = 'empty'; }
    else reply = final;
  }

  // אחרי המודל: כללי ניסוח מחייבים, בדיקת מספרים ומקורות (80, 5.4), רעננות (44)
  let srcs = [], nums = [], unverified = [];
  if (mode === 'ok') {
    const pp = ST.applyPolicy(reply, pol, results);
    const v = ST.verify(pp.text, results, text);
    srcs = v.srcs; nums = v.nums; unverified = v.unverified;
    // שלב 3: תשובה מתוך "מידע על העסק", מידע רגיש או יומן – המקור מוצג גם כשאין בה מספרים
    for (const r of results) if (['getBusinessFacts', 'getSensitiveInfo', 'getCalendar'].includes(r.name) && !r.data.error && !srcs.some((x) => x.k === r.src.k && x.l === r.src.l)) srcs.push(r.src);
    reply = v.text + (pp.notes.length ? '\n\n' + pp.notes.join('\n') : '');
    const usedFin = results.some((r) => ST.FIN_TOOLS.includes(r.name) || r.name === 'getPayroll');
    if (stale && usedFin) reply += '\n\nשימו לב: נתוני הכספים נכונים ל-' + ST.fmtAt(mirrorAt) + ' – לפני יותר מ-3 ימים. כדאי לפתוח את האפליקציה במכשיר שבו נשמרים הנתונים כדי לעדכן.';
    if (unverified.length) logs.push(['unverified', '', '', String(unverified.length)]);
  }
  const ideas = results.filter((r) => r.name === 'getImprovementIdeas').flatMap((r) => (r.data.ideas || []).map((x) => ({ key: x.key, seen: x.seen }))).slice(0, 5);
  const th = results.filter((r) => (r.name === 'getCashflowForecast' || r.name === 'simulateScenario')).map((r) => r.data.withScenario || r.data).find((d) => d && d.suggestedThreshold > 0);
  let u = { pct: null, saving: mode === 'saving' };
  if (mt && mode !== 'saving') u = await settle(db, who.uid, mt, (sent ? AI.costMc(tier, usage) : 0) - mt.reserved, deep);
  else { const [us, cs] = await Promise.all([db.doc('sec_cfg/use').get(), db.doc('sec_cfg/cap').get()]); const x = usageOf(us, capOf(cs), Date.now()); u = { pct: x.pct, saving: !!x.saving }; }

  // שמירת השיחה (רק השרת כותב) + יומן לכל כלי (10.7; שאלה על עובד – עם tgt, 6.3 כלל 7)
  const b = db.batch();
  const col = db.collection(`sec_chat/${who.uid}/m`);
  const ua = col.doc(), aa = col.doc();
  const am = { t: now + 1, role: 'a', text: reply, mode, deep, src: srcs.map((x) => ({ k: x.k, l: x.l, at: x.at, s: x.s })) };
  if (sensUsed) {
    // תיקון סבב 1: תור שהשתמש במידע רגיש – שאלה ותשובה נשמרות מוצפנות (sec-sens, AAD = נתיב ההודעה), בלי טקסט קריא במסד ובגיבוי
    const key = SENS.SEC_SENS_KEY.value();
    b.set(ua, { t: now, role: 'u', text: '', sens: true, box: SENS.seal(key, who.bizId, ua.path.replace(/^b\/[^/]+\//, ''), { text }), deep });
    am.sealed = { text: '', sens: true, box: SENS.seal(key, who.bizId, aa.path.replace(/^b\/[^/]+\//, ''), { text: reply }) };
  } else b.set(ua, { t: now, role: 'u', text, deep });
  if (asOf && srcs.some((x) => x.at === asOf)) am.asOf = asOf;
  if (stale) am.stale = true;
  if (ideas.length) am.ideas = ideas;
  if (th) am.th = th.suggestedThreshold;
  if (cards.length) am.cards = cards.slice(0, 8);
  if (mode === 'bank') {
    am.src = [{ k: 'bank', l: 'בנק התשובות – "' + String(bank.q).slice(0, 60) + '"', at: bank.rule.upd || bank.rule.t || now, s: 'bank' }];
    b.set(db.doc('sec_usage/' + monthKey(now)), { bank: FieldValue.increment(1), upd: now }, { merge: true }); // המונה שמוכיח "בלי AI"
  }
  { const sealed = am.sealed; delete am.sealed; b.set(aa, sealed ? Object.assign({}, am, sealed) : am); } // התשובה עכשיו (למנהל עם הרשאה) – בטקסט; במסד – מוצפנת
  for (const l of logs) b.set(db.collection('sec_log').doc(), logData(who.uid, l[0] === 'tool' || l[0] === 'toolDenied' || l[0] === 'sensTool' ? 'sec' : 'auto', l[0], { tgt: l[2], note: [l[1], l[3]].filter(Boolean).join(' ') }));
  await b.commit();
  return { ok: true, id: aa.id, reply, mode, deep, src: am.src, cards: am.cards || [], nums, unverified, asOf: am.asOf || null, asOfText: am.asOf ? ST.fmtAt(am.asOf) : '', finFrom, stale, ideas, th: am.th || null, pct: u.pct, saving: u.saving, tools: results.map((r) => r.name), offered, denied, brLimited };
}
function argNote(a, name) {
  if (name === 'getSensitiveInfo') return ''; // תיקון סבב 1: בלי שם העובד או טקסט מהמודל ביומן – רק שם הכלי
  if (!a || typeof a !== 'object') return '';
  // בלי תוכן רגיש: רק שמות שדות וערכים קצרים (חודש, טווח, שם ספק/עובד)
  return Object.entries(a).slice(0, 4).map(([k, v]) => String(k).slice(0, 16) + '=' + String(v).replace(CTRL, '').slice(0, 30)).join(',');
}
async function writeLogs(db, uid, logs) {
  const b = db.batch();
  for (const l of logs) b.set(db.collection('sec_log').doc(), logData(uid, 'sec', l[0], { tgt: l[2], note: [l[1], l[3]].filter(Boolean).join(' ') }));
  await b.commit();
}

// ---------- מנהל־על ----------
async function superIn(request, feature) {
  const who = await requireStaff(request, feature ? { feature: 'secretary' } : undefined);
  if (!who.superadmin) throw deny('not-superadmin', 'הפעולה מותרת למנהל המערכת בלבד');
  return who;
}
function auditRef(bizId) { return getFirestore().collection(`b/${bizId}/audit`).doc(); }

async function adminsOf(db) {
  const s = await db.collection('admins').get();
  return s.docs.map((d) => ({ uid: d.id, email: typeof d.get('email') === 'string' ? d.get('email') : '' }));
}

// secAdminGet({bizId}) – למסך מנהל־על (גם כשהתוספת כבויה, כדי להכין לפני הפעלה)
async function secAdminGet(request) {
  inputObject(request);
  const who = await superIn(request);
  const db = T.tdb();
  const [cs, cap, admins] = await Promise.all([db.doc('sec_cfg/main').get(), db.doc('sec_cfg/cap').get(), adminsOf(db)]);
  const cfg = cfgOf(cs, who.bizId);
  const consent = {};
  for (const [u, m] of Object.entries(cfg.mgr)) if (m && typeof m === 'object' && m.cv) consent[u] = { ver: m.cv, at: m.ca || null, cur: m.cv === CONSENT_VER };
  return {
    bizId: who.bizId, on: who.biz.features.secretary === true,
    mode: cfg.mode, mainUid: cfg.mainUid, emp: cfg.emp, empDefault: empDefault(who.bizId),
    pay: Object.fromEntries(admins.map((a) => [a.uid, cfg.pay[a.uid] === true])),
    sens: Object.fromEntries(admins.map((a) => [a.uid, cfg.sens[a.uid] === true])),
    capCents: cap.exists && Number.isInteger(cap.get('capCents')) ? cap.get('capCents') : null,
    rate: cfg.rate, rateDefault: { hour: RATE_HOUR, day: RATE_DAY },
    admins, consent, consentVer: CONSENT_VER,
  };
}

// secAdminSetCfg({bizId, mode?, mainUid?, emp?, pay?: {uid: bool}, capCents?}) – רק שדות שנשלחו משתנים
async function secAdminSetCfg(request) {
  const input = inputObject(request);
  const who = await superIn(request);
  const known = ['mode', 'mainUid', 'emp', 'pay', 'sens', 'capCents', 'rate'];
  for (const k of Object.keys(input)) if (!known.includes(k)) throw bad('bad-input', 'שדה לא מוכר: ' + String(k).slice(0, 30));
  const db = T.tdb();
  const [cs, admins] = await Promise.all([db.doc('sec_cfg/main').get(), adminsOf(db)]);
  const cur = cfgOf(cs, who.bizId);
  const isAdmin = (u) => admins.some((a) => a.uid === u);
  const upd = {}; const notes = [];
  if (input.mode !== undefined) {
    if (!['all', 'main'].includes(input.mode)) throw bad('bad-mode', 'מצב מנהלים לא תקין');
    upd.mode = input.mode; notes.push('mode=' + input.mode);
  }
  if (input.mainUid !== undefined) {
    if (input.mainUid !== '' && (typeof input.mainUid !== 'string' || !UID_RE.test(input.mainUid) || !isAdmin(input.mainUid))) throw bad('bad-main', 'המנהל הראשי חייב להיות מנהל של העסק');
    upd.mainUid = input.mainUid; notes.push('main=' + (input.mainUid ? 'set' : 'none'));
  }
  const mode = upd.mode || cur.mode, mainUid = upd.mainUid !== undefined ? upd.mainUid : cur.mainUid;
  if (mode === 'main' && (!mainUid || !isAdmin(mainUid))) throw bad('need-main', 'במצב "מנהל ראשי בלבד" צריך לבחור מנהל ראשי');
  if (input.emp !== undefined) {
    if (typeof input.emp !== 'boolean') throw bad('bad-emp', 'ערך לא תקין');
    upd.emp = input.emp; notes.push('emp=' + (input.emp ? 'on' : 'off'));
  }
  if (input.pay !== undefined) {
    const p = input.pay;
    if (!p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).length > 50) throw bad('bad-pay', 'מתגי שכר לא תקינים');
    for (const [u, v] of Object.entries(p)) {
      if (!UID_RE.test(u) || !isAdmin(u) || typeof v !== 'boolean') throw bad('bad-pay', 'מתג שכר – רק למנהל של העסק, כן/לא');
      upd['pay.' + u] = v; notes.push('pay:' + u + '=' + (v ? 'on' : 'off'));
    }
  }
  if (input.sens !== undefined) {
    // שלב 3: הרשאה אישית למידע רגיש על עובדים (10.8 המלצה 2) – כמו מתג השכר
    const p = input.sens;
    if (!p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).length > 50) throw bad('bad-sens', 'הרשאות מידע רגיש לא תקינות');
    for (const [u, v] of Object.entries(p)) {
      if (!UID_RE.test(u) || !isAdmin(u) || typeof v !== 'boolean') throw bad('bad-sens', 'הרשאת מידע רגיש – רק למנהל של העסק, כן/לא');
      upd['sens.' + u] = v; notes.push('sens:' + u + '=' + (v ? 'on' : 'off'));
    }
  }
  let cap; // undefined = בלי שינוי; null = ניקוי התקרה; מספר = תקרה בסנטים
  if (input.capCents !== undefined) {
    if (input.capCents !== null && (!Number.isInteger(input.capCents) || input.capCents < 0 || input.capCents > MAX_CAP_CENTS)) throw bad('bad-cap', 'תקרה: מספר שלם של דולרים, בין 0 ל-' + (MAX_CAP_CENTS / 100).toLocaleString('en-US') + '$');
    cap = input.capCents; notes.push('cap=' + (cap === null ? 'none' : cap));
  }
  if (input.rate !== undefined) {
    // קצב הודעות לכל מנהל בעסק (89): { hour: 1–500, day: 1–5000 }, או null = ברירת המחדל
    const r = input.rate;
    if (r === null) { upd.rate = FieldValue.delete(); notes.push('rate=default'); }
    else {
      if (!r || typeof r !== 'object' || Array.isArray(r) || !Number.isInteger(r.hour) || r.hour < 1 || r.hour > 500 || !Number.isInteger(r.day) || r.day < 1 || r.day > 5000 || r.day < r.hour) throw bad('bad-rate', 'קצב: הודעות לשעה 1–500, ליום 1–5,000 (ליום לא פחות מלשעה)');
      upd.rate = { hour: r.hour, day: r.day }; notes.push('rate=' + r.hour + '/' + r.day);
    }
  }
  if (!notes.length) throw bad('bad-input', 'לא נשלח שום שינוי');
  const t = Date.now();
  const b = getFirestore().batch();
  const main = db.doc('sec_cfg/main');
  const fields = Object.assign({}, upd, { upd: t, updBy: who.uid });
  // update עם נתיבי שדות (pay.<uid>) כשהמסמך קיים; יצירה ראשונה – set עם מפה מקוננת
  if (cs.exists) b.update(main, fields);
  else {
    const first = { mode, mainUid, emp: upd.emp !== undefined ? upd.emp : empDefault(who.bizId), pay: {}, mgr: {}, upd: t, updBy: who.uid };
    for (const [k, v] of Object.entries(upd)) if (k.startsWith('pay.')) first.pay[k.slice(4)] = v;
    for (const [k, v] of Object.entries(upd)) if (k.startsWith('sens.')) { first.sens = first.sens || {}; first.sens[k.slice(5)] = v; }
    if (upd.rate && Number.isInteger(upd.rate.hour)) first.rate = upd.rate;
    b.set(main, first);
  }
  if (cap === null) b.delete(db.doc('sec_cfg/cap'));
  else if (cap !== undefined) b.set(db.doc('sec_cfg/cap'), { capCents: cap, upd: t, updBy: who.uid });
  b.set(db.collection('sec_log').doc(), logData(who.uid, 'sa', 'cfg', { note: notes.join(',') }));
  b.set(auditRef(who.bizId), { by: who.uid, t, act: 'secAdminSetCfg', note: notes.join(',').slice(0, 500) });
  await b.commit();
  return Object.assign({ ok: true }, await secAdminGet({ auth: request.auth, data: { bizId: who.bizId } }));
}

// secAdminReadChat({bizId, uid, limit?}) – מנהל־על קורא שיחה (8). הצפייה נרשמת ב-sec_log לפני שהשיחה מוחזרת. קריאה בלבד.
async function secAdminReadChat(request) {
  const input = inputObject(request);
  const who = await superIn(request, true);
  const uid = input.uid;
  if (typeof uid !== 'string' || !UID_RE.test(uid)) throw bad('bad-uid', 'מזהה מנהל לא תקין');
  const lim = input.limit === undefined ? 100 : input.limit;
  if (!Number.isInteger(lim) || lim < 1 || lim > 200) throw bad('bad-limit', 'מספר הודעות: 1 עד 200');
  const db = T.tdb();
  // קודם הרישום. אם הרישום נכשל – לא מחזירים כלום
  await db.collection('sec_log').doc().set(logData(who.uid, 'sa', 'readChat', { tgt: uid }));
  await auditRef(who.bizId).set({ by: who.uid, t: Date.now(), act: 'secAdminReadChat', note: uid });
  const s = await db.collection(`sec_chat/${uid}/m`).orderBy('t', 'desc').limit(lim).get();
  // תיקון סבב 1: הודעות עם מידע רגיש לא נחשפות למנהל־על (אין לו הרשאת מידע רגיש בעסק) – רק נוסח כללי
  const msgs = s.docs.map((d) => ({ id: d.id, t: d.get('t') || null, role: d.get('role') === 'a' ? 'a' : 'u', text: d.get('sens') === true ? SENS.HIDDEN : typeof d.get('text') === 'string' ? d.get('text') : '' })).reverse();
  return { ok: true, uid, msgs, readOnly: true };
}

// ---------- גיבוי אוטומטי (94, 9.6) ----------
// קידוד ערכי Firestore ל-JSON בלי לאבד סוג (חותמת זמן, בתים, נקודה גאוגרפית, הפניה)
function enc(v) {
  if (v === null || typeof v !== 'object') return v;
  if (v instanceof Timestamp) return { __t: [v.seconds, v.nanoseconds] };
  if (v instanceof GeoPoint) return { __g: [v.latitude, v.longitude] };
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return { __b: Buffer.from(v).toString('base64') };
  if (v && typeof v.path === 'string' && typeof v.collection === 'function' && v.firestore) return { __r: v.path };
  if (Array.isArray(v)) return v.map(enc);
  const o = {};
  for (const [k, x] of Object.entries(v)) o[k] = enc(x);
  return o;
}
function dec(v, db) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => dec(x, db));
  const ks = Object.keys(v);
  if (ks.length === 1) {
    if (ks[0] === '__t') return new Timestamp(v.__t[0], v.__t[1]);
    if (ks[0] === '__g') return new GeoPoint(v.__g[0], v.__g[1]);
    if (ks[0] === '__b') return Buffer.from(v.__b, 'base64');
    if (ks[0] === '__r') return db.doc(v.__r);
  }
  const o = {};
  for (const [k, x] of Object.entries(v)) o[k] = dec(x, db);
  return o;
}

// קריאה לפי אוסף, בעמודים של 500 (שאילתה אחת לכל עמוד, לא מסמך־מסמך). תת־אוספים ידועים (SEC_SUBS):
// sec_chat/{uid}/m ו-sec_inv/{id}/p. מסמך אב "חסר" (רק תת־אוסף, כמו sec_chat/{uid}) נמצא ב-listDocuments (רשימת מזהים בלבד, בלי קריאת תוכן).
// path – יחסי לתחילית העסק (prefix), כדי שאפשר לשחזר לעסק/סביבה אחרים. תת־אוסף חדש בשלבים הבאים – להוסיף ל-SEC_SUBS (בדיקה ב-secretary.test.js).
const SEC_SUBS = Object.freeze({ sec_chat: ['m'], sec_inv: ['p'], sec_note: ['n'] });
const PAGE = 500;
async function pagedColl(db, prefix, rel, out) {
  let last = null;
  for (;;) {
    let q = db.collection(prefix + rel).orderBy(FieldPath.documentId()).limit(PAGE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    for (const d of snap.docs) out.push({ p: rel + '/' + d.id, d: enc(d.data()) });
    if (snap.size < PAGE) return;
    last = snap.docs[snap.docs.length - 1];
  }
}
async function dumpColl(db, prefix, rel, out) {
  await pagedColl(db, prefix, rel, out);
  const subs = SEC_SUBS[rel];
  if (!subs) return;
  const parents = await db.collection(prefix + rel).listDocuments();
  for (const ref of parents) for (const sub of subs) await pagedColl(db, prefix, rel + '/' + ref.id + '/' + sub, out);
}

// עסקים לגיבוי: כל עסק שהתוספת פעילה אצלו, וגם עסק שהתוספת כובתה אבל יש לו הגדרות מזכירה (ניתוק לא מוחק נתונים – 9.5)
async function bizzesForBackup() {
  const db = getFirestore();
  const out = [];
  const seen = new Set();
  const all = (await db.collection('b').select().get()).docs.map((d) => d.id);
  if (!all.includes(T.BIZ0)) all.push(T.BIZ0);
  for (const id of all) {
    const biz = await T.loadBiz(id);
    if (!biz || seen.has(id)) continue;
    seen.add(id);
    const pfx = T.bizPrefix(biz);
    const has = biz.features.secretary === true || !(await db.collection(pfx + 'sec_cfg').limit(1).get()).empty;
    if (has) out.push(biz);
  }
  return out;
}

const dayKey = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD לפי שעון ישראל

// runSecBackup({ bucket, now }) – כותב קובץ דחוס לכל עסק: sec_backups/<bizId>/<יום>.json.gz, וקובץ לטבלאות השורש: sec_backups/_root/<יום>.json.gz
// מחזיר { day, files: [{ bizId, path, docs }], errors: [{ bizId, reason }], removed: [נתיבים שנמחקו] }.
// שגיאה בעסק אחד נרשמת וממשיכים לעסק הבא. בסוף: מחיקת עותקים בני יותר מ-BACKUP_KEEP_DAYS ימים (מדיניות השמירה).
async function runSecBackup(opts) {
  const o = opts || {};
  const db = getFirestore();
  const bucket = o.bucket ? getStorage().bucket(o.bucket) : getStorage().bucket();
  const now = o.now || Date.now();
  const day = dayKey(now);
  const files = [];
  const write = async (name, payload) => {
    const path = `sec_backups/${name}/${day}.json.gz`;
    const buf = zlib.gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'));
    await bucket.file(path).save(buf, { resumable: false, contentType: 'application/gzip', metadata: { metadata: { docs: String(payload.docs.length), at: new Date(now).toISOString() } } });
    return path;
  };
  const errors = [];
  const fail = (bizId, e) => {
    errors.push({ bizId, reason: String(e && (e.code || e.name) || 'error').slice(0, 60) });
    logger.error('secretary: backup failed for business', { bizId, name: e && e.name, code: e && e.code });
  };
  const bizzes = o.bizzes || await bizzesForBackup();
  for (const biz of bizzes) {
    try {
      const prefix = T.bizPrefix(biz);
      const docs = [];
      for (const c of SEC_COLLS) await dumpColl(db, prefix, c, docs);
      const path = await write(biz.bizId, { v: 1, kind: 'sec', bizId: biz.bizId, dataRoot: biz.dataRoot, at: now, colls: SEC_COLLS, docs });
      files.push({ bizId: biz.bizId, path, docs: docs.length });
    } catch (e) { fail(biz.bizId, e); }
  }
  try {
    const rootDocs = [];
    for (const c of SEC_ROOT_COLLS) await dumpColl(db, '', c, rootDocs);
    if (rootDocs.length) files.push({ bizId: '_root', path: await write('_root', { v: 1, kind: 'sec-root', at: now, colls: SEC_ROOT_COLLS, docs: rootDocs }), docs: rootDocs.length });
  } catch (e) { fail('_root', e); }
  let removed = [];
  try { removed = await pruneSecBackups(bucket, now); } catch (e) { fail('_prune', e); }
  return { day, files, errors, removed };
}

// מחיקת עותקי גיבוי ישנים: רק קבצים בתבנית sec_backups/<שם>/<YYYY-MM-DD>.json.gz שהתאריך שלהם לפני (היום − BACKUP_KEEP_DAYS).
// קובץ בשם אחר לא נמחק (לא ננחש). התאריך נלקח משם הקובץ (יום הגיבוי לפי שעון ישראל).
const BK_RE = /^sec_backups\/[^/]+\/(\d{4}-\d{2}-\d{2})\.json\.gz$/;
async function pruneSecBackups(bucket, now) {
  const cutoff = dayKey(now - BACKUP_KEEP_DAYS * 86400000);
  const [list] = await bucket.getFiles({ prefix: 'sec_backups/' });
  const removed = [];
  for (const f of list) {
    const m = BK_RE.exec(f.name);
    if (m && m[1] < cutoff) { await f.delete({ ignoreNotFound: true }); removed.push(f.name); }
  }
  return removed;
}

// restoreSecBackup({ bucket, path, prefix, overwrite }) – שחזור קובץ גיבוי לתחילית נתונה ('' = שורש, 'b/<id>/' = עסק).
// ברירת מחדל: לא דורס מסמך קיים (מוסיף רק מה שחסר). לא נחשף כפונקציה לאפליקציה – כלי לשחזור ידני ולבדיקות.
async function restoreSecBackup(opts) {
  const o = opts || {};
  const db = getFirestore();
  const bucket = o.bucket ? getStorage().bucket(o.bucket) : getStorage().bucket();
  const prefix = typeof o.prefix === 'string' ? o.prefix : '';
  if (prefix && !/^b\/[a-z0-9-]{3,30}\/$/.test(prefix)) throw new Error('bad prefix');
  const [buf] = await bucket.file(o.path).download();
  const data = JSON.parse(zlib.gunzipSync(buf).toString('utf8'));
  if (!data || data.v !== 1 || !Array.isArray(data.docs)) throw new Error('bad backup file');
  const allowed = data.kind === 'sec-root' ? SEC_ROOT_COLLS : SEC_COLLS;
  let written = 0, skipped = 0;
  for (const x of data.docs) {
    const top = String(x.p).split('/')[0];
    if (!allowed.includes(top) || String(x.p).split('/').length % 2 !== 0) throw new Error('bad path in backup: ' + String(x.p).slice(0, 80));
    const ref = db.doc(prefix + x.p);
    if (!o.overwrite && (await ref.get()).exists) { skipped++; continue; }
    await ref.set(dec(x.d, db));
    written++;
  }
  return { written, skipped, total: data.docs.length };
}

const BACKUP_BUCKET = defineString('BACKUP_BUCKET', { default: '', description: 'שם ה-bucket של הגיבויים ב-Storage. ריק = ברירת המחדל של הפרויקט' });

const wrap = (name, fn) => T.scoped(async (request) => {
  try { return await fn(request); } catch (e) {
    if (e instanceof HttpsError) throw e;
    logger.error(`secretary: ${name} failed`, { reason: 'internal', name: e && e.name, code: e && e.code });
    throw new HttpsError('internal', 'שגיאה בפעולה. נסו שוב.', { reason: 'internal' });
  }
});

exports.secState = onCall(wrap('secState', secState));
exports.secConsent = onCall(wrap('secConsent', secConsent));
exports.secSetup = onCall(wrap('secSetup', secSetup));
// שלב 2. secChat: מפתח ה-AI מהכספת (אותו סוד של הזיהוי החכם – 9.3), זמן מספיק לכמה סבבי כלים
exports.secChat = onCall({ secrets: [AI.GEMINI_API_KEY, SENS.SEC_SENS_KEY], timeoutSeconds: 180, memory: '512MiB' }, wrap('secChat', secChat));
exports.secChatLoad = onCall({ secrets: [SENS.SEC_SENS_KEY] }, wrap('secChatLoad', secChatLoad));
exports.secMirrorPut = onCall(wrap('secMirrorPut', secMirrorPut));
exports.secPrefs = onCall(wrap('secPrefs', secPrefs));
exports.secAdminGet = onCall(wrap('secAdminGet', secAdminGet));
exports.secAdminSetCfg = onCall(wrap('secAdminSetCfg', secAdminSetCfg));
exports.secAdminReadChat = onCall(wrap('secAdminReadChat', secAdminReadChat));
// מתוזמנת – אזור אחד בלבד (ריצה כפולה = גיבוי כפול), כמו expirePromosOnLine
exports.secBackupDaily = onSchedule({ region: LEGACY_REGION, schedule: 'every day 03:30', timeZone: TZ, timeoutSeconds: 540, memory: '512MiB' }, async () => {
  const r = await runSecBackup({ bucket: BACKUP_BUCKET.value() || undefined });
  logger.info('secretary: backup done', { day: r.day, files: r.files.length, docs: r.files.reduce((s, f) => s + f.docs, 0), removed: r.removed.length, errors: r.errors.length });
  // ריצה עם שגיאה בעסק כלשהו – מסומנת ככישלון (מופיעה כשגיאה בלוח הבקרה), אחרי שכל העסקים האחרים גובו
  if (r.errors.length) throw new Error('secretary backup: ' + r.errors.length + ' errors');
});

Object.defineProperty(exports, '_core', { enumerable: false, value: {
  CONSENT, CONSENT_VER, SEC_COLLS, SEC_ROOT_COLLS, SEC_SUBS, BACKUP_KEEP_DAYS, cfgOf, runSecBackup, restoreSecBackup, pruneSecBackups, enc, dec, dayKey,
  usageOf, DEFAULT_CAP_CENTS, reserveOf, PREFS_HOUR, CHAT_MAX, FIN_MAX, RATE_HOUR, STALE_MS,
  // לשלב 3 (secretary-know.js): אותו שער הרשאה ואותו יומן
  gate, logData, hourKey, bad, deny, pre, wrap,
  // שלב 5 (secretary-wa.js): אותו מונה עלות (11.3) לעיבוד הודעות ווצאפ ולתמלול
  meter, settle,
} });
