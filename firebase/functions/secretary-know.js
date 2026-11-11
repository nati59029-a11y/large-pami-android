'use strict';
// המזכירה העסקית – שלב 3 (2026-11-11): "מידע על העסק", מידע רגיש על עובדים, בנק תשובות, יומן, ייבוא מהמזכירה הקודמת.
// אפיון 5.3, 3.5, 7.1, 8.2 (מסכים 4–6), 9.4, 10.8; החלטות 23, 46–49, 63, 71, 72, 99, 100, פ4.
// כל פונקציה כאן עוברת באותו שער של שלבים 1–2 (gate): requireStaff עם feature 'secretary', מנהל אמיתי של העסק, עסק פעיל,
// מצב מנהלים ("מנהל ראשי בלבד"), הסכמה בנוסח הנוכחי, ומנהל עם הגבלת סניפים מזוהה. כל כתיבה – רק כאן (החוקים חוסמים כתיבה מהאפליקציה).
// מגבלות: גודל לכל שדה ולכל אוסף, וקצב כתיבה לכל מנהל (KN_HOUR בשעה; ייבוא – IMP_HOUR). כל שינוי נרשם ב-sec_log (בלי תוכן רגיש).
// תוכן מקובץ, מהמשתמש או מהמודל = מידע בלבד: נשמר כטקסט, לא מפעיל שום פעולה.

const crypto = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { FieldValue } = require('firebase-admin/firestore');
const { onCall } = require('./lib/region');
const { inputObject } = require('./lib/roles');
const K = require('./lib/sec-know');
const SENS = require('./lib/sec-sens');
const C = require('./secretary')._core;
const { gate, logData, hourKey, bad, deny, pre, wrap } = C;

const KN_HOUR = 120;   // שינויים בשעה לכל מנהל (עובדות, תשובות, יומן, מידע רגיש)
const IMP_HOUR = 5;    // ייבואים בשעה לכל מנהל
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

async function rate(db, uid, bucket, max) {
  const t = Date.now(), h = hourKey(t);
  await db.runTransaction(async (tx) => {
    const ref = db.doc('sec_cfg/use');
    const us = await tx.get(ref);
    const kn = us.exists && us.get('kn') && typeof us.get('kn') === 'object' ? us.get('kn') : {};
    const cur = kn[bucket] && kn[bucket][uid] ? kn[bucket][uid] : {};
    const n = cur.h === h ? (cur.n || 0) : 0;
    if (n >= max) throw new HttpsError('resource-exhausted', 'יותר מדי שינויים בזמן קצר. נסו שוב בעוד שעה.', { reason: 'rate-limit' });
    tx.set(ref, { kn: { [bucket]: { [uid]: { h, n: n + 1 } } } }, { merge: true });
  });
}
const idOf = (v) => { if (typeof v !== 'string' || !ID_RE.test(v)) throw bad('bad-id', 'מזהה לא תקין'); return v; };
const log = (b, db, uid, act, extra) => b.set(db.collection('sec_log').doc(), logData(uid, 'mgr', act, extra));
const OPS = (input, list) => { if (!list.includes(input.op)) throw bad('bad-op', 'פעולה לא מוכרת'); return input.op; };
const isWrite = (op) => op !== 'list';

// ===================================================================================
// secFacts – מידע על העסק (5.3). עובדה נכנסת לשימוש רק כשהמנהל שומר אותה בעצמו (add/fixed/price) או מאשר הצעה (approve).
// ===================================================================================
function readExp(v, today) {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v !== 'string' || !K.validDay(v)) throw bad('bad-exp', 'תאריך תפוגה לא תקין');
  if (v < today) throw bad('bad-exp', 'תאריך התפוגה כבר עבר');
  return v;
}
function readFact(input) {
  const topic = typeof input.topic === 'string' && K.TOPICS[input.topic] ? input.topic : null;
  if (!topic) throw bad('bad-topic', 'בחרו נושא');
  if (typeof input.text !== 'string') throw bad('bad-text', 'כתבו את העובדה');
  const text = K.clean(input.text, K.FACT_MAX);
  if (!text) throw bad('bad-text', 'כתבו את העובדה');
  if (text.length > K.FACT_MAX) throw bad('too-long', 'עובדה: עד ' + K.FACT_MAX + ' תווים');
  return { topic, text };
}
// סתירה (49): בלי force – מחזירים את העובדות הסותרות ולא שומרים. replace – העובדות הישנות מסומנות "הוחלפה" (לא נמחקות)
function readReplace(input, conflict) {
  if (input.replace === undefined) return [];
  if (!Array.isArray(input.replace) || input.replace.length > 3) throw bad('bad-replace', 'בחירה לא תקינה');
  const ids = input.replace.map(idOf);
  if (!ids.every((id) => conflict.some((c) => c.id === id))) throw bad('bad-replace', 'אפשר להחליף רק עובדה שהוצגה כסותרת');
  return ids;
}
async function secFacts(request) {
  const input = inputObject(request);
  const op = OPS(input, ['list', 'add', 'edit', 'del', 'approve', 'reject', 'fixed', 'price', 'priceDel']);
  const { who, db, sensOn } = await gate(request, { consent: true });
  const now = Date.now(), today = K.dayOf(now);
  if (isWrite(op)) await rate(db, who.uid, 'kn', KN_HOUR);
  const col = db.collection('sec_facts');
  const all = async () => (await col.limit(K.FACTS_MAX + K.PROP_MAX + 10).get()).docs.filter((d) => d.id !== 'price').map((d) => K.factOut(d.id, d.data()));
  if (op === 'list') {
    const [L, ps] = await Promise.all([all(), col.doc('price').get()]);
    const price = ps.exists ? { name: ps.get('name') || '', at: ps.get('at') || 0, rows: Array.isArray(ps.get('rows')) ? ps.get('rows') : [] } : null;
    return { ok: true, facts: L.filter((f) => f.st !== 'old').map((f) => Object.assign(f, { expired: K.expired(f, today) })), price, topics: K.TOPICS, fixed: K.FIXED, sens: sensOn };
  }
  const b = db.batch();
  let out = {};
  if (op === 'add' || op === 'approve') {
    const L = await all();
    let id, f;
    if (op === 'add') {
      f = readFact(input);
      if (L.filter((x) => x.st === 'ok').length >= K.FACTS_MAX) throw pre('too-many', 'הגעתם למספר העובדות המרבי (' + K.FACTS_MAX + ')');
      id = col.doc().id;
    } else {
      id = idOf(input.id);
      const p = L.find((x) => x.id === id);
      if (!p || p.st !== 'prop') throw pre('not-pending', 'ההצעה כבר טופלה או לא קיימת');
      f = { topic: p.topic, text: p.text };
      if (input.exp === undefined && p.exp) input.exp = p.exp >= today ? p.exp : '';
    }
    const exp = readExp(input.exp, today);
    const conflict = K.conflictsOf({ id, topic: f.topic, text: f.text }, L);
    if (conflict.length && input.force !== true) return { ok: false, conflict, fact: f }; // מציגה את שתיהן ושואלת (49)
    const rp = readReplace(input, conflict);
    const doc = { topic: f.topic, text: f.text, st: 'ok', by: who.uid, t: now, upd: now, src: op === 'add' ? 'mgr' : 'chat' };
    if (exp) doc.exp = exp;
    if (input.pub === true) doc.pub = true;
    if (op === 'add') b.set(col.doc(id), doc); else b.update(col.doc(id), Object.assign(doc, { okBy: who.uid, exp: exp || FieldValue.delete() }));
    for (const r of rp) b.update(col.doc(r), { st: 'old', oldBy: id, upd: now });
    log(b, db, who.uid, op === 'add' ? 'factAdd' : 'factOk', { tgt: id, note: rp.length ? 'replaced ' + rp.length : '' });
    out = { id, replaced: rp };
  } else if (op === 'edit') {
    const id = idOf(input.id);
    const s = await col.doc(id).get();
    if (!s.exists || s.get('st') !== 'ok' || s.get('fx') || id === 'price') throw pre('not-found', 'העובדה לא נמצאה');
    const f = readFact(input);
    const exp = readExp(input.exp, today);
    b.update(col.doc(id), { topic: f.topic, text: f.text, exp: exp || FieldValue.delete(), pub: input.pub === true ? true : FieldValue.delete(), upd: now, t: now, by: who.uid });
    log(b, db, who.uid, 'factEdit', { tgt: id });
    out = { id };
  } else if (op === 'del' || op === 'reject') {
    const id = idOf(input.id);
    if (id === 'price') throw bad('bad-id', 'מזהה לא תקין');
    const s = await col.doc(id).get();
    if (!s.exists) throw pre('not-found', 'העובדה לא נמצאה');
    if (op === 'reject' && s.get('st') !== 'prop') throw pre('not-pending', 'ההצעה כבר טופלה');
    b.delete(col.doc(id)); // מחיקה בלחיצה מפורשת של המנהל במסך (8.2: "ערוך"/"מחק"); הצעה שבוטלה – נמחקת
    log(b, db, who.uid, op === 'del' ? 'factDel' : 'factNo', { tgt: id });
    out = { id };
  } else if (op === 'fixed') {
    // שדות קבועים (46): fx_<key>. טקסט ריק = מחיקת השדה
    const key = typeof input.key === 'string' && K.FIXED[input.key] ? input.key : null;
    if (!key) throw bad('bad-key', 'שדה לא מוכר');
    const text = typeof input.text === 'string' ? K.clean(input.text, K.FACT_MAX) : null;
    if (text === null || text.length > K.FACT_MAX) throw bad('too-long', 'עד ' + K.FACT_MAX + ' תווים');
    const ref = col.doc('fx_' + key);
    if (!text) b.delete(ref); else b.set(ref, { topic: 'general', fx: key, text, st: 'ok', by: who.uid, t: now, upd: now, src: 'mgr', pub: ['hours', 'addr', 'branches'].includes(key) });
    log(b, db, who.uid, 'fixed', { note: key });
    out = { key };
  } else if (op === 'price') {
    // מחירון (23): שם + שורות {n: פריט, p: מחיר, u: יחידה}. מחליף את המחירון הקודם (המנהל מעלה גרסה חדשה), עם תאריך עדכון
    const name = K.line(input.name || 'מחירון', 60);
    const rows = K.cleanPrice(input.rows);
    if (!rows) throw bad('bad-price', 'המחירון לא תקין: עד ' + K.PRICE_ROWS + ' שורות, בכל שורה פריט ומחיר (מספר)');
    b.set(col.doc('price'), { kind: 'price', name, rows, at: now, by: who.uid, pub: true });
    log(b, db, who.uid, 'price', { note: rows.length + ' rows' });
    out = { rows: rows.length, at: now };
  } else if (op === 'priceDel') {
    b.delete(col.doc('price'));
    log(b, db, who.uid, 'priceDel');
  }
  await b.commit();
  return Object.assign({ ok: true }, out);
}

// ===================================================================================
// secSens – מידע רגיש על עובדים (10.8, 63). מוצפן בשרת (lib/sec-sens.js), נקרא רק כאן ובכלי הצ'אט.
// רק מנהל שיש לו הרשאה אישית (sec_cfg/main.sens.<uid>, מנהל־על קובע) וכשהמתג העסקי (ניתוח עובדים ומידע רגיש) פעיל.
// כל קריאה וכל שינוי נרשמים ב-sec_log, בלי תוכן ובלי שם העובד (רק מזהי רשומות ומספרים).
// ===================================================================================
function readSensInput(input) {
  if (typeof input.emp !== 'string' || typeof input.text !== 'string') throw bad('bad-input', 'שם העובד והמידע – חובה');
  const emp = SENS.clean(input.emp, SENS.NAME_MAX), text = SENS.clean(input.text, SENS.TEXT_MAX);
  if (!emp || emp.length > SENS.NAME_MAX) throw bad('bad-emp', 'שם העובד: עד ' + SENS.NAME_MAX + ' תווים');
  if (!text || text.length > SENS.TEXT_MAX) throw bad('bad-text', 'המידע: עד ' + SENS.TEXT_MAX + ' תווים');
  return { emp, text };
}
async function secSens(request) {
  const input = inputObject(request);
  const op = OPS(input, ['list', 'add', 'edit', 'del']);
  const { who, cfg, db, brLimited, sensOn } = await gate(request, { consent: true });
  if (cfg.emp !== true) throw deny('sens-off', 'ניתוח העובדים והמידע הרגיש כבויים בעסק הזה');
  if (brLimited) throw deny('branch-limited', 'מידע רגיש על עובדים זמין רק למנהל בלי הגבלת סניפים');
  if (!sensOn) throw deny('no-sens-perm', 'אין לך הרשאה למידע רגיש על עובדים. מנהל המערכת יכול להפעיל אותה.');
  const key = SENS.SEC_SENS_KEY.value();
  const now = Date.now();
  const col = db.collection(SENS.COLL);
  if (op === 'list') {
    // קודם הרישום, ורק אחר כך הפענוח: אם הרישום נכשל – לא מחזירים כלום
    await db.collection('sec_log').doc().set(logData(who.uid, 'mgr', 'sensRead'));
    const L = await SENS.readAll(db, key, who.bizId);
    return { ok: true, items: L.map((x) => (x.bad ? { id: x.id, bad: true, t: x.t } : { id: x.id, emp: x.emp, text: x.text, t: x.t })) };
  }
  await rate(db, who.uid, 'kn', KN_HOUR);
  const b = db.batch();
  let id;
  if (op === 'add') {
    const v = readSensInput(input);
    const n = (await col.select().limit(SENS.MAX_DOCS).get()).size;
    if (n >= SENS.MAX_DOCS) throw pre('too-many', 'הגעתם למספר הרשומות המרבי (' + SENS.MAX_DOCS + ')');
    id = col.doc().id;
    b.set(col.doc(id), { v: SENS.VER, box: SENS.seal(key, who.bizId, id, v), by: who.uid, t: now });
    log(b, db, who.uid, 'sensAdd', { tgt: id });
  } else {
    id = idOf(input.id);
    const s = await col.doc(id).get();
    if (!s.exists) throw pre('not-found', 'הרשומה לא נמצאה');
    if (op === 'edit') {
      const v = readSensInput(input);
      b.set(col.doc(id), { v: SENS.VER, box: SENS.seal(key, who.bizId, id, v), by: who.uid, t: now });
      log(b, db, who.uid, 'sensEdit', { tgt: id });
    } else {
      b.delete(col.doc(id));
      log(b, db, who.uid, 'sensDel', { tgt: id });
    }
  }
  await b.commit();
  return { ok: true, id };
}

// ===================================================================================
// secRules – בנק תשובות (3.5): ניסוחים, תשובה, תנאים, פעיל/כבוי. התאמה בלי תנאים = תשובה בלי AI (secChat)
// ===================================================================================
async function secRules(request) {
  const input = inputObject(request);
  const op = OPS(input, ['list', 'add', 'edit', 'del']);
  const { who, db } = await gate(request, { consent: true });
  const col = db.collection('sec_rules');
  if (op === 'list') {
    const s = await col.limit(K.RULES_MAX).get();
    return { ok: true, rules: s.docs.map((d) => ({ id: d.id, q: d.get('q') || [], a: d.get('a') || '', cond: d.get('cond') || '', on: d.get('on') !== false, src: d.get('src') || 'mgr', t: d.get('t') || 0 })).sort((x, y) => y.t - x.t) };
  }
  await rate(db, who.uid, 'kn', KN_HOUR);
  const now = Date.now(), b = db.batch();
  let id;
  if (op === 'add' || op === 'edit') {
    const r = K.cleanRule({ q: input.q, a: input.a, cond: input.cond || '', on: input.on });
    if (!r) throw bad('bad-rule', 'תשובה מוכנה: 1–10 ניסוחים (עד ' + K.RULE_Q_MAX + ' תווים), תשובה (עד ' + K.RULE_A_MAX + '), תנאים (עד ' + K.RULE_COND_MAX + ')');
    if (op === 'add') {
      if ((await col.select().limit(K.RULES_MAX).get()).size >= K.RULES_MAX) throw pre('too-many', 'הגעתם למספר התשובות המרבי (' + K.RULES_MAX + ')');
      id = col.doc().id;
      b.set(col.doc(id), Object.assign(r, { src: 'mgr', by: who.uid, t: now, upd: now }));
    } else {
      id = idOf(input.id);
      if (!(await col.doc(id).get()).exists) throw pre('not-found', 'התשובה לא נמצאה');
      b.update(col.doc(id), Object.assign(r, { by: who.uid, upd: now }));
    }
    log(b, db, who.uid, op === 'add' ? 'ruleAdd' : 'ruleEdit', { tgt: id });
  } else {
    id = idOf(input.id);
    if (!(await col.doc(id).get()).exists) throw pre('not-found', 'התשובה לא נמצאה');
    b.delete(col.doc(id));
    log(b, db, who.uid, 'ruleDel', { tgt: id });
  }
  await b.commit();
  return { ok: true, id };
}

// ===================================================================================
// secCal – יומן (7.1, 71, 72): אישי (uid = המנהל) + אירועי עסק משותפים (uid = ''). הצעה מהמזכירה (st: 'prop') נוצרת רק באישור.
// שישי/שבת/חג: לפי הגדרת המנהל (we) – 'warn' מחזיר אזהרה עם יום עסקים חלופי, והאירוע נשמר רק עם force (או בתאריך אחר)
// ===================================================================================
async function secCal(request) {
  const input = inputObject(request);
  const op = OPS(input, ['list', 'add', 'edit', 'del', 'approve', 'reject']);
  const { who, me, db } = await gate(request, { consent: true });
  const now = Date.now(), today = K.dayOf(now);
  const col = db.collection('sec_cal');
  const we = me.we === 'accept' ? 'accept' : 'warn';
  if (op === 'list') {
    const s = await col.where('uid', 'in', ['', who.uid]).limit(K.CAL_MAX + K.CAL_PROP_MAX).get();
    const from = typeof input.from === 'string' && K.validDay(input.from) ? input.from : K.addDays(today, -7);
    const L = s.docs.map((d) => K.calOut(d.id, d.data(), who.uid)).filter((e) => e.st === 'prop' || e.d >= from)
      .sort((x, y) => (x.d + (x.tm || '')).localeCompare(y.d + (y.tm || ''))).slice(0, 500);
    for (const e of L) { const k = K.offKind(e.d); if (k) e.off = k; }
    return { ok: true, events: L, we, today };
  }
  await rate(db, who.uid, 'kn', KN_HOUR);
  const b = db.batch();
  // אזהרת שישי/שבת/חג – לפני כל שמירה של תאריך חדש
  // שלב 4 (75): תזכורת (rem) שנופלת בשישי/שבת/חג – תמיד נשאלת ביצירה ("להשאיר בזמנה או להעביר?"), בלי קשר להגדרת הפגישות (72)
  const rem = input.rem === true;
  const offCheck = (d, isRem) => {
    const k = K.offKind(d);
    if (k && (we === 'warn' || isRem) && input.force !== true) return { ok: false, warn: { kind: k, d, next: K.nextBizDay(d), rem: !!isRem } };
    return k ? { keepOff: true } : {};
  };
  let id;
  if (op === 'add') {
    const ev = K.cleanEvent(input);
    if (!ev) throw bad('bad-event', 'כותרת (עד ' + K.CAL_TITLE + ' תווים), תאריך ושעה תקינים');
    if (ev.d < today) throw bad('past', 'התאריך כבר עבר');
    const w = offCheck(ev.d, rem); if (w.ok === false) return w;
    if ((await col.select().limit(K.CAL_MAX).get()).size >= K.CAL_MAX) throw pre('too-many', 'היומן מלא (' + K.CAL_MAX + ' אירועים)');
    id = col.doc().id;
    b.set(col.doc(id), Object.assign({ uid: input.biz === true ? '' : who.uid, st: 'ok', src: 'mgr', by: who.uid, t: now }, ev, w.keepOff ? { keepOff: true } : {}, rem ? { rem: true } : {}));
    log(b, db, who.uid, 'calAdd', { tgt: id, note: input.biz === true ? 'biz' : 'me' });
  } else {
    id = idOf(input.id);
    const s = await col.doc(id).get();
    const x = s.exists ? s.data() : null;
    // אירוע אישי של מנהל אחר – כאילו לא קיים (בלי לחשוף שיש כזה)
    if (!x || (x.uid !== '' && x.uid !== who.uid)) throw pre('not-found', 'האירוע לא נמצא');
    if (op === 'approve' || op === 'reject') {
      if (x.st !== 'prop') throw pre('not-pending', 'ההצעה כבר טופלה');
      if (op === 'reject') { b.delete(col.doc(id)); log(b, db, who.uid, 'calNo', { tgt: id }); }
      else {
        // אפשר לאשר בתאריך אחר (היום החלופי שהוצע)
        const d = input.d !== undefined ? input.d : x.d;
        if (typeof d !== 'string' || !K.validDay(d) || d < today) throw bad('bad-date', 'תאריך לא תקין או שעבר');
        const w = offCheck(d); if (w.ok === false) return w;
        b.update(col.doc(id), { st: 'ok', d, uid: x.to === 'biz' ? '' : who.uid, to: FieldValue.delete(), okBy: who.uid, okAt: now, keepOff: w.keepOff ? true : FieldValue.delete() });
        log(b, db, who.uid, 'calOk', { tgt: id, note: x.to === 'biz' ? 'biz' : 'me' });
      }
    } else if (op === 'edit') {
      if (x.st !== 'ok') throw pre('not-found', 'האירוע לא נמצא');
      const ev = K.cleanEvent(input);
      if (!ev) throw bad('bad-event', 'כותרת, תאריך ושעה תקינים');
      let w = {};
      if (ev.d !== x.d) { w = offCheck(ev.d, x.rem === true); if (w.ok === false) return w; } else if (x.keepOff) w = { keepOff: true };
      b.update(col.doc(id), { title: ev.title, d: ev.d, tm: ev.tm || FieldValue.delete(), note: ev.note || FieldValue.delete(), keepOff: w.keepOff ? true : FieldValue.delete(), upd: now, updBy: who.uid });
      log(b, db, who.uid, 'calEdit', { tgt: id });
    } else {
      b.delete(col.doc(id));
      log(b, db, who.uid, 'calDel', { tgt: id });
    }
  }
  await b.commit();
  return { ok: true, id };
}

// ===================================================================================
// secImport – ייבוא בנק התשובות והאירועים העתידיים מהמזכירה הקודמת (99, 100), מקובץ JSON שהמנהל מעלה.
// dry: true – רק ספירה (מה ייכנס, מה כבר קיים, מה עבר, מה פגום). הייבוא עצמו לא דורס שום דבר: מזהה קבוע לכל פריט (imp_<hash>),
// כתיבה ב-create (נכשלת אם קיים), ודילוג על תשובה שכבר קיימת בבנק (אותו ניסוח) או אירוע שכבר קיים (אותה כותרת, תאריך ושעה).
// האירועים נכנסים ליומן האישי של המנהל שייבא. הכול טקסט בלבד.
// ===================================================================================
const hid = (p, s) => 'imp_' + p + '_' + crypto.createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 24);
async function secImport(request) {
  const input = inputObject(request);
  const { who, db } = await gate(request, { consent: true });
  if (typeof input.raw !== 'string') throw bad('bad-file', 'בחרו קובץ');
  if (input.raw.length > K.IMPORT_MAX) throw bad('too-big', 'הקובץ גדול מדי (עד 1MB)');
  const now = Date.now(), today = K.dayOf(now);
  const P = K.parseImport(input.raw, today);
  const MSG = { empty: 'הקובץ ריק', 'too-big': 'הקובץ גדול מדי (עד 1MB)', 'not-json': 'זה לא קובץ JSON תקין', 'bad-shape': 'מבנה הקובץ לא מוכר: צריך rules (תשובות) ו/או events (אירועים)', 'too-many': 'יותר מדי פריטים בקובץ (עד ' + K.IMPORT_ITEMS + ' מכל סוג)' };
  if (P.error) throw bad('bad-file-' + P.error, MSG[P.error] || 'הקובץ לא תקין');
  if (input.dry !== true) await rate(db, who.uid, 'imp', IMP_HOUR);
  const [rs, cs] = await Promise.all([db.collection('sec_rules').limit(K.RULES_MAX).get(), db.collection('sec_cal').where('uid', 'in', ['', who.uid]).limit(K.CAL_MAX).get()]);
  const haveQ = new Set();
  rs.docs.forEach((d) => (d.get('q') || []).forEach((q) => haveQ.add(K.normHe(q))));
  const evKey = (e) => K.normHe(e.title) + '|' + e.d + '|' + (e.tm || '');
  const haveE = new Set(cs.docs.map((d) => evKey(d.data())));
  const rules = [], events = [];
  let ruleDup = 0, evDup = 0;
  for (const r of P.rules) { if (r.q.some((q) => haveQ.has(K.normHe(q)))) { ruleDup++; continue; } r.q.forEach((q) => haveQ.add(K.normHe(q))); rules.push(r); }
  for (const e of P.events) { if (haveE.has(evKey(e))) { evDup++; continue; } haveE.add(evKey(e)); events.push(e); }
  let ruleRoom = Math.max(0, K.RULES_MAX - rs.size), evRoom = Math.max(0, K.CAL_MAX - cs.size);
  const over = { rules: Math.max(0, rules.length - ruleRoom), events: Math.max(0, events.length - evRoom) };
  rules.splice(ruleRoom); events.splice(evRoom);
  const sum = { rules: rules.length, ruleDup, events: events.length, evDup, past: P.past, bad: P.bad, over };
  if (input.dry === true) return Object.assign({ ok: true, dry: true }, sum);
  // כתיבה: create בלבד (לא דורס), באצוות של 400
  let written = { rules: 0, events: 0 }, exists = 0;
  const items = rules.map((r) => ['r', hid('r', JSON.stringify(r.q)), Object.assign(r, { src: 'import', by: who.uid, t: now, upd: now })])
    .concat(events.map((e) => ['e', hid('e', who.uid + '|' + evKey(e)), Object.assign({ uid: who.uid, st: 'ok', src: 'import', by: who.uid, t: now }, e)]));
  for (let i = 0; i < items.length; i += 400) {
    const chunk = items.slice(i, i + 400);
    // בדיקה מראש (create באצווה נכשל כולו אם מסמך אחד קיים) – מסמך שקיים מדולג
    const snaps = chunk.length ? await db.getAll(...chunk.map(([k, id]) => db.collection(k === 'r' ? 'sec_rules' : 'sec_cal').doc(id))) : [];
    const b = db.batch();
    chunk.forEach(([k, id, doc], j) => {
      if (snaps[j].exists) { exists++; return; }
      b.create(db.collection(k === 'r' ? 'sec_rules' : 'sec_cal').doc(id), doc);
      written[k === 'r' ? 'rules' : 'events']++;
    });
    await b.commit();
  }
  await db.collection('sec_log').doc().set(logData(who.uid, 'mgr', 'import', { note: 'rules=' + written.rules + ' events=' + written.events + ' dup=' + (ruleDup + evDup + exists) + ' past=' + P.past }));
  return Object.assign({ ok: true, dry: false, written }, sum, { ruleDup: ruleDup, evDup: evDup + exists });
}

exports.secFacts = onCall(wrap('secFacts', secFacts));
exports.secSens = onCall({ secrets: [SENS.SEC_SENS_KEY] }, wrap('secSens', secSens));
exports.secRules = onCall(wrap('secRules', secRules));
exports.secCal = onCall(wrap('secCal', secCal));
exports.secImport = onCall({ timeoutSeconds: 120, memory: '512MiB' }, wrap('secImport', secImport));
