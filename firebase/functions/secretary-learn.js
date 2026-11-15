'use strict';
// "תגובה למזכירה" (15.11.2026; תוכנית: משימות/2026-11-15_התראות-ותגובה-למזכירה/01-תוכנית.md, סעיף 4, עם ההחלטות ב-00-בקשה.md):
// על כל הודעה של המזכירה (התראה, תשובה בשיחה, טיוטת מייל, טיוטת ווצאפ) המנהל כותב הוראה ("תעני לו בקצרה", "אל תתריעי לי על זה").
// המזכירה מבצעת אותה על ההודעה הזו (מייל/ווצאפ – טיוטה חדשה לפי ההוראה), ומציעה לשמור אותה ככלל אישי של המנהל (sec_mrule).
// אחרי שהמנהל אישר פעולה לפי כלל (שלח טיוטה שנכתבה לפיו), בפעם הבאה שמתאים היא שואלת "לעשות את זה מעכשיו לבד?" → auto.
// כלל "לבד" במייל/ווצאפ: המזכירה כותבת תשובה חדשה בכל פעם לפי ההוראה, והיא נשלחת לבד רק אם עברה את כל הבדיקות בקוד
// (secretary-google.js tryMrAuto, secretary-wa.js tryMrAutoWa): "עצור הכל", בעל הכלל עדיין מורשה, כללי הבטיחות הקבועים, התאמה ≥ 0.85, חלון 24 שעות בווצאפ ועוד.
// כל הכתיבה – רק כאן ובשרת (החוקים חוסמים את sec_mrule ו-sec_mlog מהאפליקציה). כל פעולה נרשמת ב-sec_log.

const { HttpsError } = require('firebase-functions/v2/https');
const { FieldValue } = require('firebase-admin/firestore');
const logger = require('firebase-functions/logger');
const { onCall } = require('./lib/region');
const { inputObject } = require('./lib/roles');
const L = require('./lib/sec-learn');
const AI = require('./lib/sec-ai');
const C = require('./secretary')._core;
const { gate, logData, hourKey, bad, deny, pre, wrap } = C;

const MR_HOUR = 60;                         // פעולות כתיבה בשעה לכל מנהל
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const MAIL_ID_RE = /^g[0-9a-f]{40}$/;
const CLS_L = () => require('./lib/sec-wa').CLS;
const idOf = (v) => { if (typeof v !== 'string' || !ID_RE.test(v)) throw bad('bad-id', 'מזהה לא תקין'); return v; };
const log = (b, db, uid, act, extra) => b.set(db.collection('sec_log').doc(), logData(uid, 'mgr', act, extra));

async function rate(db, uid) {
  const h = hourKey(Date.now());
  await db.runTransaction(async (tx) => {
    const ref = db.doc('sec_cfg/use');
    const us = await tx.get(ref);
    const mr = us.exists && us.get('mr') && typeof us.get('mr') === 'object' ? us.get('mr') : {};
    const cur = mr[uid] && typeof mr[uid] === 'object' ? mr[uid] : {};
    const n = cur.h === h ? (cur.n || 0) : 0;
    if (n >= MR_HOUR) throw new HttpsError('resource-exhausted', 'יותר מדי שינויים בזמן קצר. נסו שוב בעוד שעה.', { reason: 'rate-limit' });
    tx.set(ref, { mr: { [uid]: { h, n: n + 1 } } }, { merge: true });
  });
}

// ---------- בעל הכלל עדיין מורשה (נבדק בכל שימוש בכלל, ובכל שליחה לבד) ----------
// מנהל של העסק (admins), אישר את התנאים בנוסח הנוכחי, עומד במצב "מנהל ראשי בלבד", והתכונה פעילה. ch מייל/ווצאפ – גם בלי הגבלת סניפים
async function ownerOk(db, uid, ch, cache) {
  const k = uid + '|' + (L.OUT_CHS.includes(ch) ? 'out' : 'in');
  if (cache && Object.hasOwn(cache, k)) return cache[k];
  let ok = false;
  if (typeof uid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(uid)) {
    const [adm, cs] = await Promise.all([db.doc('admins/' + uid).get(), cache && cache._cs ? cache._cs : db.doc('sec_cfg/main').get()]);
    if (cache) cache._cs = cs;
    const cfg = C.cfgOf(cs, '');
    const me = cfg.mgr[uid] && typeof cfg.mgr[uid] === 'object' ? cfg.mgr[uid] : {};
    ok = adm.exists && cfg.learn && me.cv === C.CONSENT_VER && !(cfg.mode === 'main' && cfg.mainUid !== uid)
      && !(L.OUT_CHS.includes(ch) && Array.isArray(adm.get('br')));
  }
  if (cache) cache[k] = ok;
  return ok;
}
const ruleOf = (d) => Object.assign({ id: d.id }, d.data());
// הכללים הפעילים בערוץ (של כל המנהלים – מייל/ווצאפ הם ערוצים של העסק), רק של בעלים מורשים, אחרי הסינון המוקדם. עד PROMPT_MAX
async function candRules(db, ch, item) {
  const s = await db.collection('sec_mrule').where('ch', '==', ch).limit(300).get();
  const pre0 = L.prefilter(s.docs.map(ruleOf), Object.assign({ ch }, item || {}));
  const cache = {}, out = [];
  for (const r of pre0) { if (out.length >= L.PROMPT_MAX) break; if (await ownerOk(db, r.uid, ch, cache)) out.push(r); }
  return out;
}
// השיחה: רק הכללים של המנהל עצמו, פעילים, בלי כלל בטיחות. גם הנחיות שנכתבו על התראה (act 'info', סבב 2 ליקוי 3) – כדי שהמזכירה תזכור אותן בשיחה
async function chatRules(db, uid) {
  const s = await db.collection('sec_mrule').where('uid', '==', uid).limit(L.MAX_RULES + 5).get();
  return s.docs.map(ruleOf).filter((r) => (r.ch === 'chat' || (r.ch === 'note' && r.act === 'info')) && r.on !== false && !r.safe)
    .sort((a, b) => (a.t || 0) - (b.t || 0)).slice(0, L.PROMPT_MAX).map((r) => (r.ch === 'note' ? 'לגבי התראות: ' : '') + r.instr);
}
// התראות: כלל השתקה של המנהל שמתאים להתראה (בקוד, בלי AI). התראות בטיחות – לעולם לא. cache – לכל ריצה
async function muteRule(db, uid, note, cache) {
  if (!L.noteMutable(note)) return null;
  const k = 'm|' + uid;
  if (!cache || !Object.hasOwn(cache, k)) {
    const s = await db.collection('sec_mrule').where('uid', '==', uid).limit(L.MAX_RULES + 5).get();
    const list = s.docs.map(ruleOf).filter((r) => r.ch === 'note' && r.act === 'mute' && r.on !== false && !r.safe);
    if (cache) cache[k] = list; else return pickMute(list, note);
  }
  return pickMute(cache[k], note);
}
function pickMute(list, note) {
  if (!list.length) return null;
  const m = L.prefilter(list, { ch: 'note', typ: note.typ || '', key: note.key || '' })[0];
  return m || null;
}
async function muted(db, rule, note, now) {
  const b = db.batch();
  b.update(db.doc('sec_mrule/' + rule.id), { hits: FieldValue.increment(1), lastAt: now });
  b.set(db.collection('sec_log').doc(), logData(rule.uid, 'auto', 'mrMute', { tgt: rule.id, note: L.keyFam(note.key) }));
  await b.commit().catch((e) => logger.warn('secretary-learn: mute log failed', { code: e && e.code }));
}

// ---------- אחרי שליחה לבד / כשלון (נקרא מ-secretary-google.js ו-secretary-wa.js) ----------
// סבב 2 (ליקוי 5): המונים (fails, hits) מתעדכנים בטרנזקציה – קריאה טרייה של הכלל, כך שכשלונות במקביל לא "מאבדים" עדכון והכיבוי אחרי 3 מובטח
async function afterSend(db, rule, o) {
  const now = o.now || Date.now();
  const ref = db.doc('sec_mrule/' + rule.id);
  const hits = await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const h = s.exists ? (Number(s.get('hits')) || 0) : (Number(rule.hits) || 0);
    if (s.exists) tx.update(ref, { hits: h + 1, fails: 0, lastAt: now });
    tx.set(db.collection('sec_mlog').doc(), { t: now, by: rule.uid, rule: rule.id, ri: String(rule.instr || '').slice(0, 120), ch: o.ch, tgt: o.tgt || '', to: L.maskTo(o.to), st: 'sent', why: [] });
    tx.set(db.collection('sec_log').doc(), Object.assign(logData(rule.uid, 'auto', 'mrSend', { tgt: o.tgt, note: rule.id }), { ch: o.ch }));
    return h;
  });
  // שלוש השליחות הראשונות של כל כלל – התראה לבעל הכלל (החלטה 5)
  if (hits < L.NOTIFY_FIRST) {
    await require('./secretary-wa')._core.notifyMgrs(db, 'mrsent|' + rule.id + '|' + now, 'נשלח לבד לפי הכלל שלך', 'לפי הכלל "' + String(rule.instr || '').slice(0, 120) + '" נשלחה לבד תשובה ב' + (o.ch === 'mail' ? 'מייל' : 'ווצאפ') + ' אל ' + L.maskTo(o.to) + '. אפשר לראות את היומן ולכבות את הכלל במסך "הכללים שלי".', now, rule.uid).catch(() => {});
  }
}
async function afterFail(db, rule, o) {
  const now = o.now || Date.now();
  const ref = db.doc('sec_mrule/' + rule.id);
  const nx = await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const n = L.failNext(s.exists ? s.data() : rule);
    const off = n.off && s.exists && s.get('auto') === true; // כובים פעם אחת (מי שהגיע ל-3 ראשון); אחרי כן רק נרשם הכשלון
    if (s.exists) tx.update(ref, Object.assign({ fails: n.fails, lastAt: now }, off ? { auto: false, offWhy: 'fail', autoOffAt: now } : {}));
    tx.set(db.collection('sec_mlog').doc(), { t: now, by: rule.uid, rule: rule.id, ri: String(rule.instr || '').slice(0, 120), ch: o.ch, tgt: o.tgt || '', to: L.maskTo(o.to), st: 'fail', why: ['fail'] });
    tx.set(db.collection('sec_log').doc(), Object.assign(logData(rule.uid, 'auto', off ? 'mrOff' : 'mrFail', { tgt: o.tgt, note: rule.id }), { ch: o.ch }));
    return { fails: n.fails, off };
  });
  await require('./secretary-wa')._core.notifyMgrs(db, (nx.off ? 'mroff|' : 'mrfail|') + rule.id + '|' + now, nx.off ? 'כלל הפסיק לשלוח לבד' : 'שליחה לבד נכשלה',
    (nx.off ? 'אחרי ' + L.FAIL_MAX + ' כשלונות ברצף הכלל "' + String(rule.instr || '').slice(0, 120) + '" חזר לשאול לפני כל שליחה. אפשר להפעיל "לבד" מחדש במסך "הכללים שלי".' : 'השליחה לבד לפי הכלל "' + String(rule.instr || '').slice(0, 120) + '" נכשלה. התשובה נשארה טיוטה ומחכה לך.'), now, rule.uid).catch(() => {});
}
// "לעשות את זה מעכשיו לבד?" – התראה לבעל הכלל (פעם אחת לכל כלל, עד שיענה)
async function askNote(db, rule, now) {
  await require('./secretary-wa')._core.notifyMgrs(db, 'mrask|' + rule.id, 'לעשות את זה מעכשיו לבד?', 'הגיעה עוד פנייה שמתאימה לכלל שלך "' + String(rule.instr || '').slice(0, 120) + '". הכנתי טיוטה לפיו. בטיוטה אפשר לבחור: מעכשיו לשלוח לבד, או להמשיך לשאול.', now, rule.uid).catch(() => {});
}
// אחרי שליחה ידנית של טיוטה שנכתבה לפי כלל: אם מי ששלח הוא בעל הכלל ולא שינה את הטקסט – זה אישור (appr++)
async function approved(db, dr, uid, edited) {
  if (!dr || typeof dr.mr !== 'string' || !dr.mr || dr.mrBy !== uid || edited) return false;
  const ref = db.doc('sec_mrule/' + dr.mr);
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists || s.get('uid') !== uid) return false;
    tx.update(ref, { appr: (Number(s.get('appr')) || 0) + 1, apprAt: Date.now() });
    return true;
  });
}

// ---------- הפריט שהמנהל הגיב עליו (שייך למנהל, מהשרת – לא מהאפליקציה) ----------
async function itemOf(db, who, k, id) {
  if (k === 'chat') {
    const s = await db.doc(`sec_chat/${who.uid}/m/${idOf(id)}`).get();
    if (!s.exists || s.get('role') !== 'a') throw pre('not-found', 'ההודעה לא נמצאה');
    return { ch: 'chat', item: {} };
  }
  if (k === 'note') {
    const s = await db.doc(`sec_note/${who.uid}/n/${idOf(id)}`).get();
    if (!s.exists) throw pre('not-found', 'ההתראה לא נמצאה');
    return { ch: 'note', item: { typ: s.get('typ') || '', key: s.get('key') || '' }, ref: s.ref };
  }
  if (k === 'mail') {
    if (typeof id !== 'string' || !MAIL_ID_RE.test(id)) throw bad('bad-id', 'מזהה לא תקין');
    const [ds, is] = await Promise.all([db.doc('sec_draft/' + id).get(), db.doc('sec_in/' + id).get()]);
    if (!ds.exists || ds.get('ch') !== 'mail' || !is.exists) throw pre('no-draft', 'אין טיוטה למייל הזה');
    return { ch: 'mail', item: { cls: ds.get('cls') || '', from: is.get('rto') || is.get('from') || '' }, ds, x: is.data() };
  }
  if (k === 'wa') {
    const ds = await db.doc('sec_draft/' + idOf(id)).get();
    if (!ds.exists || ds.get('ch') === 'mail' || ds.get('auto') === true || !ds.get('wa')) throw pre('no-draft', 'הטיוטה לא נמצאה');
    return { ch: 'wa', item: { cls: ds.get('cls') || '', from: ds.get('wa') }, ds };
  }
  if (k === 'feed') {
    // 15.11.2026: פריט ב"מול העיניים" שאין לו הודעה משלו (חשבונית, תזכורת ביומן, הצעה, פעולה של המזכירה) – ההוראה היא הנחיה כללית או הוראת ניתוב
    if (typeof id !== 'string' || !(Object.hasOwn(L.RK, id) || id === 'act')) throw bad('bad-id', 'מזהה לא תקין');
    return { ch: 'chat', item: {}, feed: id };
  }
  throw bad('bad-k', 'סוג הודעה לא מוכר');
}
const SC_OK = ['cls', 'from', 'all', 'fam', 'typ'];
const scOf = (v) => (SC_OK.includes(v) ? v : '');
function readInstr(v) {
  if (typeof v !== 'string') throw bad('bad-text', 'כתבו מה לעשות');
  const t = L.clean(v, L.INSTR_MAX);
  if (!t) throw bad('bad-text', 'כתבו מה לעשות');
  if (t.length > L.INSTR_MAX) throw bad('too-long', 'עד ' + L.INSTR_MAX + ' תווים');
  return t;
}
function propOut(r, item) {
  if (r.ch === 'route') return { ch: 'route', act: 'route', instr: r.instr, kind: r.scope.kind, dest: r.dest, routeL: L.scopeL(r), safe: '', safeL: '', opts: [], canAuto: false };
  const clsL = CLS_L();
  const opts = r.ch === 'mail' || r.ch === 'wa'
    ? [['cls', item.cls && item.cls !== 'other' ? 'פניות מסוג "' + (clsL[item.cls] || item.cls) + '"' : ''], ['from', item.from ? 'רק מהשולח הזה' : ''], ['all', 'כל ההודעות ב' + (r.ch === 'mail' ? 'מייל' : 'ווצאפ')]].filter((x) => x[1])
    : r.ch === 'note' && r.act === 'mute' ? [['fam', 'התראות דומות לזו'], ['typ', item.typ && !L.SHARED_TYP.includes(String(item.typ)) ? 'כל ההתראות מהסוג הזה' : '']].filter((x) => x[1]) : [];
  return { ch: r.ch, act: r.act, instr: r.instr, safe: r.safe || '', safeL: r.safe ? L.SAFE_L[r.safe] : '', opts: opts.map(([v, l]) => ({ v, l })), canAuto: L.OUT_CHS.includes(r.ch) && !r.safe };
}
function ruleOut(r, now) {
  const clsL = CLS_L();
  return { id: r.id, ch: r.ch, act: r.act, instr: r.instr || '', scopeL: L.scopeL(r, clsL), on: r.on !== false, auto: r.auto === true, safe: r.safe || '', safeL: r.safe ? L.SAFE_L[r.safe] : '',
    canAuto: L.OUT_CHS.includes(r.ch) && !r.safe && (Number(r.appr) || 0) >= 1, appr: Number(r.appr) || 0, hits: Number(r.hits) || 0, fails: Number(r.fails) || 0, offWhy: r.offWhy || '', lastAt: Number(r.lastAt) || 0, t: r.t || 0,
    asked: !!(r.ask && r.ask.st === 'no' && now - (Number(r.ask.at) || 0) < L.ASK_AGAIN_MS) };
}

// כלל ניתוב חדש: עד MAX_RULES; כלל ניתוב קודם לאותו סוג – מכובה (לא נמחק), כדי שהאחרון יגבר. מוסיף ל-batch
// rid (מכרטיס בשיחה): מזהה קבוע לכלל + create – לחיצה כפולה במקביל נכשלת ב-commit ולא יוצרת כלל שני
async function saveRoute(db, b, uid, r, src, now, rid) {
  const col = db.collection('sec_mrule');
  const mine = await col.where('uid', '==', uid).limit(L.MAX_RULES + 5).get();
  if (mine.size >= L.MAX_RULES) throw pre('too-many', 'הגעתם למספר הכללים המרבי (' + L.MAX_RULES + '). אפשר למחוק כלל ישן במסך "הכללים שלי".');
  for (const d of mine.docs) if (d.get('ch') === 'route' && d.get('on') !== false && (d.get('scope') || {}).kind === r.scope.kind) b.update(d.ref, { on: false, offWhy: 'replaced', upd: now });
  const id = rid || col.doc().id;
  const doc = Object.assign({ uid }, r, { on: true, auto: false, appr: 0, fails: 0, hits: 0, ask: { st: 'none', at: 0 }, src, t: now, upd: now, v: 1 });
  if (rid) b.create(col.doc(id), doc); else b.set(col.doc(id), doc);
  log(b, db, uid, 'mrRoute', { tgt: id, note: r.scope.kind + ':' + r.dest });
  return { id, rule: ruleOut(Object.assign({ id }, doc), now) };
}

// ===================================================================================
// "מול העיניים" (15.11.2026, סעיף 6): קריאה אחת בכניסה לצ'אט – כל מה שפתוח (הצעות לאישור, טיוטות, התראות שלא טופלו, חשבוניות שהתקבלו,
// תזכורות ואירועים קרובים שהמזכירה קבעה) + מה שהיא עשתה מאז הכניסה הקודמת. visit:true – נרשמת כניסה (sec_cfg/visit, שרת בלבד).
// ניתוב לפי כללי המנהל (ch:'route'): "לטיפול" → hold (מוצג במסך "לטיפול" הקיים באפליקציה); רק בלשונית → לא מוצג כאן. שום נתון קיים לא משתנה (חוץ מרשומת הכניסה)
// hold:true – בקשה של מסך "לטיפול": קודם רק הכללים; אין כלל "לטיפול" → תשובה מיידית בלי שאר השאילתות. לא נרשמת כניסה
// ===================================================================================
const EY_OPEN = 30, EY_DID = 30, EY_DAYS = 7;
const DRAFT_KIND = { open: 'הודעת פתיחה', ack: '"קיבלנו"' };
async function eyes(g, input, now) {
  const { who, db, brLimited, brs, cfg } = g;
  const RM = require('./lib/sec-remind');
  const K = require('./lib/sec-know');
  const today = RM.il(now).day;
  const vref = db.doc('sec_cfg/visit');
  const vs = await vref.get();
  const rec = vs.exists && vs.get(who.uid) && typeof vs.get(who.uid) === 'object' ? vs.get(who.uid) : {};
  const holdOnly = input.hold === true;
  if (holdOnly) {
    const rs0 = cfg.learn ? await db.collection('sec_mrule').where('uid', '==', who.uid).limit(L.MAX_RULES + 5).get().catch(() => ({ docs: [] })) : { docs: [] };
    if (!Object.values(L.routesOf(rs0.docs.map((d) => d.data()))).includes('hold')) return { ok: true, now, hold: [], holdOn: false };
  }
  const visit = input.visit === true && !holdOnly;
  const since = L.sinceOf(rec, now, visit);
  const brOk = (x) => !brs || (typeof x.br === 'string' && brs.includes(x.br));
  const out3 = !brLimited; // טיוטות מייל/ווצאפ – ערוצים של כל העסק; מנהל עם הגבלת סניפים לא רואה אותן כאן
  const empty = { docs: [] };
  const q = (p) => p.get().catch((e) => { logger.warn('secLearn eyes: query failed', { code: e && e.code }); return empty; });
  const [fp, cp, cu, no, dp, ip, ns, ml, cs, ds, is, rs, mm] = await Promise.all([
    q(db.collection('sec_facts').where('st', '==', 'prop').limit(20)),
    q(db.collection('sec_cal').where('uid', '==', who.uid).where('st', '==', 'prop').limit(20)),
    q(db.collection('sec_cal').where('d', '>=', today).where('d', '<=', K.addDays(today, EY_DAYS)).limit(300)),
    q(db.collection(`sec_note/${who.uid}/n`).where('st', '==', 'open').limit(60)),
    out3 ? q(db.collection('sec_draft').where('st', '==', 'pend').limit(20)) : empty,
    q(db.collection('sec_inv').where('st', '==', 'new').limit(40)),
    q(db.collection(`sec_note/${who.uid}/n`).where('t', '>', since).limit(20)),
    q(db.collection('sec_mlog').where('t', '>', since).limit(20)),
    q(db.collection('sec_cal').where('t', '>', since).limit(40)),
    out3 ? q(db.collection('sec_draft').where('t', '>', since).limit(40)) : empty,
    q(db.collection('sec_inv').where('t', '>', since).limit(40)),
    cfg.learn ? q(db.collection('sec_mrule').where('uid', '==', who.uid).limit(L.MAX_RULES + 5)) : empty,
    // 15.11.2026 (קול, תמונה וסרטון): הודעות עם כרטיס מדיה פתוח (mc – שדה אחד, בלי אינדקס מורכב). מוצגות רק מ-24 השעות האחרונות (התמונה נשמרת רק בזיכרון המכשיר)
    q(db.collection(`sec_chat/${who.uid}/m`).where('mc', '==', true).limit(20)),
  ]);
  const MORN = RM.MORNING;
  const IVK = { inv: 'חשבונית', cr: 'הודעת זיכוי', rcpt: 'קבלה', dn: 'תעודת משלוח', chk: 'צ׳ק', unk: 'מסמך', bad: 'קובץ שלא נקלט', long: 'קובץ ארוך' };
  const supOf = (x) => String((x.f && (x.f.supplier || x.f.payee)) || x.subN || '').slice(0, 60);
  const cut = (v, n) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);
  const open = [];
  for (const d of fp.docs) open.push({ k: 'appr', id: 'f:' + d.id, t: d.get('t') || 0, title: 'לשמור במידע על העסק? ' + cut(d.get('text'), 120), go: { tab: 'facts' }, act: { k: 'fact', id: d.id }, r: { k: 'feed', id: 'appr' } });
  for (const d of cp.docs) { const e = d.data(); open.push({ k: 'appr', id: 'c:' + d.id, t: e.t || 0, title: (e.rem ? 'לקבוע תזכורת? ' : 'לקבוע ביומן? ') + L.remLine(Object.assign({}, e, { rem: e.rem === true }), today, MORN).replace(/^(תזכורת|ביומן): /, ''), go: { tab: 'cal' }, act: { k: 'cal', id: d.id }, r: { k: 'feed', id: 'appr' } }); }
  for (const d of dp.docs) { const x = d.data(); if (x.auto === true) continue; const mail = x.ch === 'mail'; open.push({ k: 'draft', id: 'd:' + d.id, t: x.t || 0, title: 'טיוטת תשובה ב' + (mail ? 'מייל' : 'ווצאפ') + ' מחכה לך', sub: cut(x.sum || x.text, 90), go: mail ? { tab: 'mail', id: d.id } : { tab: 'wa', wa: String(x.wa || '') }, r: { k: mail ? 'mail' : 'wa', id: d.id } }); }
  for (const d of no.docs) { const x = d.data(); if ((x.at || 0) > now || !(x.k === 'rem' || x.seen !== true)) continue; open.push({ k: 'note', id: 'n:' + d.id, t: x.at || x.t || 0, title: cut(x.title, 120), sub: cut(x.body, 90), go: { tab: 'notes', id: d.id }, act: x.k === 'rem' ? { k: 'note', id: d.id } : null, r: { k: 'note', id: d.id } }); }
  for (const d of ip.docs) { const x = d.data(); if (!brOk(x)) continue; const a = x.k === 'chk' ? x.f && x.f.amt : x.f && x.f.total; open.push({ k: 'inv', id: 'i:' + d.id, t: x.t || 0, title: (IVK[x.k] || 'מסמך') + ' מחכה לאישור' + (supOf(x) ? ' – ' + supOf(x) : ''), sub: typeof a === 'number' ? a.toLocaleString('he-IL') + ' ₪' : '', go: { tab: 'inv' }, r: { k: 'feed', id: 'inv' } }); }
  const calMine = (e) => e && e.st === 'ok' && (e.uid === '' || e.uid === who.uid);
  for (const d of cu.docs) { const e = d.data(); if (!calMine(e) || !(e.rem === true || e.src === 'sec' || e.src === 'wa')) continue; open.push({ k: 'rem', id: 'e:' + d.id, t: Date.parse(e.d + 'T' + (e.tm || MORN) + ':00Z') || 0, title: L.remLine(e, today, MORN), go: { tab: 'cal' }, r: { k: 'feed', id: 'rem' }, soon: true }); }
  const MDOC = { inv: 'חשבונית', rcpt: 'קבלה', dn: 'תעודת משלוח', z: 'דוח Z' };
  for (const d of mm.docs) {
    const x = d.data(); const t = x.t || 0;
    if (now - t > 864e5 || !Array.isArray(x.cards)) continue;
    const via = x.mvia === 'video' ? 'video' : 'image';
    for (const c of x.cards) {
      if (!c || c.st || typeof c.id !== 'string' || (c.k !== 'scan' && c.k !== 'task')) continue;
      if (c.k === 'scan') open.push({ k: 'media', id: 'md:' + c.id, t, title: (MDOC[c.doc] || 'מסמך') + ' מחכה לסריקה', sub: 'מהתמונה ששלחת בשיחה', go: { tab: 'chat' }, act: { k: 'scan', id: c.id, mid: d.id, doc: MDOC[c.doc] ? c.doc : 'inv', via }, r: { k: 'chat', id: d.id } });
      else open.push({ k: 'media', id: 'md:' + c.id, t, title: 'לפתוח משימה? ' + cut(c.txt, 110), go: { tab: 'chat' }, act: { k: 'task', id: c.id, mid: d.id, txt: cut(c.txt, 300), via }, r: { k: 'chat', id: d.id } });
    }
  }
  const ord = { appr: 0, media: 1, draft: 2, note: 3, inv: 4, rem: 5 };
  open.sort((a, b) => (ord[a.k] - ord[b.k]) || (a.soon ? a.t - b.t : b.t - a.t));
  // מה עשיתי מאז הכניסה הקודמת
  const did = [];
  for (const d of ns.docs) { const x = d.data(); if ((x.at || 0) > now) continue; did.push({ k: 'note', id: 'n:' + d.id, t: x.t || 0, title: 'התראה: ' + cut(x.title, 110), go: { tab: 'notes', id: d.id }, r: { k: 'note', id: d.id } }); }
  for (const d of ml.docs) { const x = d.data(); did.push({ k: 'draft', id: 'm:' + d.id, t: x.t || 0, title: (x.st === 'sent' ? 'נשלח לבד ב' : 'שליחה לבד נכשלה ב') + (x.ch === 'mail' ? 'מייל' : 'ווצאפ') + ' אל ' + cut(x.to, 30) + (x.ri ? ' – לפי "' + cut(x.ri, 60) + '"' : ''), go: { tab: 'set', mr: 1 }, r: { k: 'feed', id: 'act' } }); }
  for (const d of cs.docs) { const e = d.data(); if (!(e.uid === '' || e.uid === who.uid) || !(e.src === 'sec' || e.src === 'wa')) continue; const line = L.remLine(Object.assign({}, e, { rem: e.rem === true }), today, MORN); did.push({ k: e.st === 'prop' ? 'appr' : 'rem', id: 'e:' + d.id, t: e.t || 0, title: (e.st === 'prop' ? 'הצעתי – ' : 'קבעתי – ') + line, go: { tab: 'cal' }, r: { k: 'feed', id: e.st === 'prop' ? 'appr' : 'rem' } }); }
  for (const d of ds.docs) { const x = d.data(); if (x.auto === true) { did.push({ k: 'draft', id: 'd:' + d.id, t: x.t || 0, title: 'נשלח אוטומטית בווצאפ: ' + (String(x.kind || '').split(/[+,]/).map((z) => DRAFT_KIND[z]).filter(Boolean).join(' + ') || 'הודעה'), sub: cut(x.text, 80), go: { tab: 'wa', wa: String(x.wa || '') }, r: { k: 'feed', id: 'act' } }); continue; }
    if (x.st === 'pend' || x.st === 'fail') did.push({ k: 'draft', id: 'd:' + d.id, t: x.t || 0, title: 'הכנתי טיוטת תשובה ב' + (x.ch === 'mail' ? 'מייל' : 'ווצאפ'), sub: cut(x.sum || x.text, 80), go: x.ch === 'mail' ? { tab: 'mail', id: d.id } : { tab: 'wa', wa: String(x.wa || '') }, r: { k: x.ch === 'mail' ? 'mail' : 'wa', id: d.id } }); }
  for (const d of is.docs) { const x = d.data(); if (!brOk(x)) continue; did.push({ k: 'inv', id: 'i:' + d.id, t: x.t || 0, title: 'התקבלה ' + (IVK[x.k] || 'מסמך') + (supOf(x) ? ' – ' + supOf(x) : '') + (x.st === 'ok' ? ' (נכנסה)' : ''), go: { tab: 'inv' }, r: { k: 'feed', id: 'inv' } }); }
  for (const d of fp.docs) if ((d.get('t') || 0) > since) did.push({ k: 'appr', id: 'f:' + d.id, t: d.get('t') || 0, title: 'הצעתי לשמור עובדה: ' + cut(d.get('text'), 100), go: { tab: 'facts' }, r: { k: 'feed', id: 'appr' } });
  did.sort((a, b) => b.t - a.t);
  const routes = L.routesOf(rs.docs.map((d) => Object.assign({ id: d.id }, d.data())));
  const o = L.applyRoutes(open, routes), dd = L.applyRoutes(did, routes);
  const hold = o.hold.concat(dd.hold.filter((x) => !o.hold.some((y) => y.id === x.id))).slice(0, EY_OPEN);
  if (visit) await vref.set({ [who.uid]: { chat: now, prev: since } }, { merge: true });
  if (holdOnly) return { ok: true, now, hold, holdOn: true };
  return { ok: true, since, now, today, open: o.feed.slice(0, EY_OPEN), openN: o.feed.length, did: dd.feed.slice(0, EY_DID), didN: dd.feed.length, hold, holdOn: Object.values(routes).includes('hold'), routes };
}

// ===================================================================================
// secLearn { op: reply | save | list | set | del | auto | log | eyes | route }
// ===================================================================================
const OPS = ['reply', 'save', 'list', 'set', 'del', 'auto', 'log', 'eyes', 'route'];
const K_OK = L.CHS.concat(['feed']);
async function secLearn(request) {
  const input = inputObject(request);
  const op = OPS.includes(input.op) ? input.op : null;
  if (!op) throw bad('bad-op', 'פעולה לא מוכרת');
  const g = await gate(request, { consent: true });
  const { who, cfg, db, brLimited } = g;
  // מנהל־על עם הגבלת סניפים: בשיחה הוא לא "מוגבל" (gate), אבל כלל מייל/ווצאפ שלו לא יפעל (ownerOk) – לכן גם לא נוצר (הערה 3 בסבב 1)
  const outLimited = brLimited || g.hasBr === true;
  const now = Date.now();
  const col = db.collection('sec_mrule');
  // "מול העיניים" – פועל גם כשהכללים האישיים כבויים (אז בלי ניתוב)
  if (op === 'eyes') return eyes(g, input, now);
  if (!cfg.learn) throw deny('learn-off', 'הכללים האישיים כבויים בעסק הזה');

  if (op === 'list') {
    const [s, ws] = await Promise.all([col.where('uid', '==', who.uid).limit(L.MAX_RULES + 5).get(), db.doc('sec_cfg/wa').get()]);
    const st = ws.exists && ws.get('stop') && typeof ws.get('stop') === 'object' ? ws.get('stop') : {};
    return { ok: true, rules: s.docs.map((d) => ruleOut(ruleOf(d), now)).sort((a, b) => b.t - a.t), max: L.MAX_RULES, brLimited: outLimited, stop: st.on === true };
  }
  if (op === 'log') {
    // כל מנהלי העסק רואים את כל מה שנשלח לבד (החלטה 4) – קריאה בלבד, עם שם בעל הכלל
    const s = await db.collection('sec_mlog').orderBy('t', 'desc').limit(100).get();
    const nm = (u) => { const m = cfg.mgr[u] && typeof cfg.mgr[u] === 'object' ? cfg.mgr[u] : {}; return u === who.uid ? 'אני' : String(m.call || 'מנהל אחר').slice(0, 40); };
    return { ok: true, items: s.docs.map((d) => { const x = d.data(); return { id: d.id, t: x.t || 0, ch: x.ch || '', st: x.st || '', to: x.to || '', ri: x.ri || '', by: nm(x.by), mine: x.by === who.uid, whyL: L.noL(x.why) }; }) };
  }

  await rate(db, who.uid);

  if (op === 'route') {
    // כרטיס "להעביר מעכשיו…?" מהשיחה: אישור יוצר כלל ניתוב (מהכרטיס שהשרת כתב בהודעה – לא מהאפליקציה); ביטול – רק מסמן את הכרטיס
    const mid = idOf(input.mid), cid = typeof input.cid === 'string' && /^rt[0-9a-f]{16}$/.test(input.cid) ? input.cid : null;
    if (!cid) throw bad('bad-id', 'מזהה לא תקין');
    const ms = await db.doc(`sec_chat/${who.uid}/m/${mid}`).get();
    const c = ms.exists && Array.isArray(ms.get('cards')) ? ms.get('cards').find((x) => x && x.k === 'route' && x.id === cid) : null;
    if (!c) throw pre('not-found', 'ההצעה לא נמצאה');
    if (c.st) throw pre('not-pending', 'ההצעה כבר טופלה');
    const b = db.batch();
    if (input.no === true) {
      await C.cardMark(db, b, who.uid, mid, cid, { st: 'no' });
      log(b, db, who.uid, 'mrRouteNo', { note: c.kind + ':' + c.dest });
      await b.commit();
      return { ok: true, st: 'no' };
    }
    const r = L.routeRule(c.instr || '', { kind: c.kind, dest: c.dest });
    if (!r) throw bad('bad-text', 'ההוראה לא תקינה');
    const out = await saveRoute(db, b, who.uid, r, { k: 'chat', id: mid }, now, cid);
    await C.cardMark(db, b, who.uid, mid, cid, { st: 'ok', rid: out.id });
    try { await b.commit(); } catch (e) {
      if (e && (e.code === 6 || /ALREADY_EXISTS|already exists/i.test(String(e.message)))) throw pre('not-pending', 'ההצעה כבר טופלה');
      throw e;
    }
    return { ok: true, st: 'ok', id: out.id, rule: out.rule };
  }

  if (op === 'reply' || op === 'save') {
    const k = input.k;
    if (!K_OK.includes(k)) throw bad('bad-k', 'סוג הודעה לא מוכר');
    // מנהל עם הגבלת סניפים – לא יוצר כללים על מייל וווצאפ (ערוצים של כל העסק; החלטה 3)
    if (outLimited && L.OUT_CHS.includes(k)) throw deny('branch-limited', 'כללים על מייל וווצאפ זמינים רק למנהל בלי הגבלת סניפים');
    const instr = readInstr(input.text);
    const it = await itemOf(db, who, k, input.id);
    // 15.11.2026 (סעיף 7): "תשלחי שוב בעוד שעה" בתגובה על התראה – קובעת מיד (בלי מודל, בלי כלל). גם ב"שמירה" – לא נשמר ככלל
    if (k === 'note') {
      const RM = require('./lib/sec-remind');
      const sz = RM.snoozeOf(instr, now);
      if (sz) {
        const out = await require('./secretary-remind')._core.snooze(db, who.uid, it.ref.id, sz.at, now, 'reply');
        return { ok: true, snz: { at: out.at, l: out.l } };
      }
    }
    // 15.11.2026: הוראת ניתוב ("חשבוניות מהיום – לבטיפול") בתגובה על שיחה, התראה או פריט ב"מול העיניים" – כלל ניתוב
    const rt = ['chat', 'note', 'feed'].includes(k) ? L.routeOf(instr) : null;
    const r = rt ? L.routeRule(instr, rt) : L.cleanRule({ ch: it.ch, instr, sc: scOf(input.sc), item: it.item });
    if (!r) throw bad('bad-text', 'ההוראה לא תקינה');
    if (op === 'reply') {
      // ביצוע על ההודעה הזו: מייל/ווצאפ – טיוטה חדשה לפי ההוראה (לא נשלחת – רק בלחיצה). שאר הסוגים – אין שינוי עד "שמירה"
      let draft = null;
      if (it.ch === 'mail') {
        if (!['pend', 'fail'].includes(it.ds.get('st'))) throw pre('not-pending', 'התשובה כבר נשלחה או טופלה');
        draft = await require('./secretary-google')._core.refineOp(who, db, input.id, instr, now);
      } else if (it.ch === 'wa') {
        if (!['pend', 'fail'].includes(it.ds.get('st'))) throw pre('not-pending', 'התשובה כבר נשלחה או טופלה');
        draft = await require('./secretary-wa')._core.redraft(db, it.ds.id, instr, { now, by: who.uid });
      }
      await db.collection('sec_log').doc().set(logData(who.uid, 'mgr', 'mrReply', { tgt: String(input.id).slice(0, 80), note: it.ch + (r.safe ? ':safe-' + r.safe : '') }));
      return { ok: true, prop: propOut(r, it.item), draft };
    }
    // save: הכלל נשמר רק בלחיצה של המנהל. ההוראה והתחום נקבעים כאן מחדש (לא סומכים על האפליקציה)
    if (r.ch === 'route') {
      const b = db.batch();
      const out = await saveRoute(db, b, who.uid, r, { k, id: String(input.id).slice(0, 80) }, now);
      await b.commit();
      return { ok: true, id: out.id, rule: out.rule };
    }
    const mine = await col.where('uid', '==', who.uid).limit(L.MAX_RULES + 5).get();
    if (mine.size >= L.MAX_RULES) throw pre('too-many', 'הגעתם למספר הכללים המרבי (' + L.MAX_RULES + '). אפשר למחוק כלל ישן במסך "הכללים שלי".');
    const id = col.doc().id;
    const doc = Object.assign({ uid: who.uid }, r, { on: true, auto: false, appr: 0, fails: 0, hits: 0, ask: { st: 'none', at: 0 }, src: { k, id: String(input.id).slice(0, 80) }, t: now, upd: now, v: 1 });
    const b = db.batch();
    b.set(col.doc(id), doc);
    // הטיוטה שהמנהל הגיב עליה נכתבה לפי ההוראה – שליחה שלה (בלי שינוי) תיחשב אישור ראשון
    if ((it.ch === 'mail' || it.ch === 'wa') && ['pend', 'fail'].includes(it.ds.get('st'))) b.update(it.ds.ref, { mr: id, mrBy: who.uid, mrI: instr.slice(0, 120), mrAsk: false });
    // השתקה: ההתראה הזו עצמה מסומנת כטופלה
    if (it.ch === 'note' && r.act === 'mute') b.update(it.ref, { st: 'done', seen: true, pend: false, nextAt: FieldValue.delete() });
    log(b, db, who.uid, 'mrSave', { tgt: id, note: it.ch + ':' + r.act + (r.safe ? ':safe-' + r.safe : '') });
    await b.commit();
    return { ok: true, id, rule: ruleOut(Object.assign({ id }, doc), now) };
  }

  // set / del / auto – רק על כלל של המנהל עצמו (כלל של מנהל אחר – כאילו לא קיים)
  const id = idOf(input.id);
  const ref = col.doc(id);
  const s = await ref.get();
  if (!s.exists || s.get('uid') !== who.uid) throw pre('not-found', 'הכלל לא נמצא');
  const rule = ruleOf(s);
  const b = db.batch();
  if (op === 'del') {
    b.delete(ref); // מחיקה בלחיצה מפורשת של בעל הכלל
    log(b, db, who.uid, 'mrDel', { tgt: id });
    await b.commit();
    return { ok: true, id };
  }
  if (op === 'set') {
    if (typeof input.on !== 'boolean') throw bad('bad-on', 'ערך לא תקין');
    b.update(ref, Object.assign({ on: input.on, upd: now }, input.on ? {} : { auto: false, offWhy: 'mgr' }));
    log(b, db, who.uid, input.on ? 'mrOn' : 'mrOffMgr', { tgt: id });
    await b.commit();
    return { ok: true, rule: ruleOut(Object.assign(rule, { on: input.on }, input.on ? {} : { auto: false, offWhy: 'mgr' }), now) };
  }
  // auto: on=true – "כן, מעכשיו לבד"; on=false – לשאול לפני כל שליחה (never:true – "לא, תמיד לשאול": לא שואלים שוב 30 יום)
  if (typeof input.on !== 'boolean') throw bad('bad-on', 'ערך לא תקין');
  let up;
  if (input.on) {
    if (!L.OUT_CHS.includes(rule.ch)) throw pre('no-auto', 'רק כלל של מייל או ווצאפ יכול לשלוח לבד');
    if (rule.safe) throw pre('safe-rule', 'כלל בטיחות (' + L.SAFE_L[rule.safe] + ') – תמיד באישור שלך');
    if (rule.on === false) throw pre('rule-off', 'הכלל כבוי. הפעילו אותו קודם.');
    if (!((Number(rule.appr) || 0) >= 1)) throw pre('need-approval', 'קודם צריך לאשר פעם אחת תשובה לפי הכלל הזה');
    if (!(await ownerOk(db, who.uid, rule.ch))) throw deny('not-allowed', 'אין לך הרשאה לשליחה לבד');
    up = { auto: true, autoAt: now, fails: 0, offWhy: FieldValue.delete(), ask: { st: 'yes', at: now }, upd: now };
  } else up = Object.assign({ auto: false, offWhy: 'mgr', upd: now }, input.never === true ? { ask: { st: 'no', at: now } } : {});
  b.update(ref, up);
  // השאלה בטיוטה נענתה – לא מציגים אותה שוב
  if (typeof input.d === 'string' && ID_RE.test(input.d)) {
    const ds = await db.doc('sec_draft/' + input.d).get();
    if (ds.exists && ds.get('mr') === id) b.update(ds.ref, { mrAsk: false });
  }
  log(b, db, who.uid, input.on ? 'mrAuto' : (input.never === true ? 'mrNever' : 'mrManual'), { tgt: id, note: rule.ch });
  await b.commit();
  return { ok: true, rule: ruleOut(Object.assign(rule, input.on ? { auto: true, fails: 0, offWhy: '' } : { auto: false, offWhy: 'mgr' }, { ask: input.on ? { st: 'yes', at: now } : input.never === true ? { st: 'no', at: now } : rule.ask }), now) };
}

exports.secLearn = onCall({ secrets: [AI.GEMINI_API_KEY], timeoutSeconds: 120 }, wrap('secLearn', secLearn));

Object.defineProperty(exports, '_core', { enumerable: false, value: {
  ownerOk, candRules, chatRules, muteRule, muted, afterSend, afterFail, askNote, approved,
  call: { secLearn: wrap('secLearn', secLearn) },
} });
