'use strict';
// המזכירה העסקית – שלב 4 "דוחות ותזכורות + התראות push + שמירת היסטוריה" (אפיון 6.4, 7.2–7.4, 9.5, 10.7; החלטות 55, 61, 66–69, 73–77, 91–95).
//
// אוספים (בתוך העסק, T.tdb(); כתיבה רק כאן):
//   sec_note/{uid}/n/{id} { k: 'rem'|'rep'|'emp'|'dig', typ, key, title, body, t, at (מוצג מ-), pend (התראת טלפון ממתינה), pushAt, pushed,
//                           n (כמה פעמים נשלחה), rep (חזרות שנותרו, 0–3 – 76), nextAt (החזרה הבאה), st: 'open'|'done'|'gone', seen, ref? }
//                           – רשימת ההתראות של המנהל. אין גישה מהאפליקציה (חוקים) – רק דרך secNotes.
//   sec_rep/{id}            { uid, kind: 'w'|'m', key, t, title, secs, ideas, done[], src, why } – הדוחות (באפליקציה בלבד – 68). המנהל קורא רק את שלו.
//   sec_cfg/rem             { empT, scan } – מצב הריצה המתוזמנת (שרת בלבד)
//   sec_cfg/del_<uid>       { h, exp } – אישור שני למחיקת היסטוריה (93), חד־פעמי, 10 דקות (שרת בלבד)
//   push_tokens/{uid}       { pushTokens } – טלפונים של מנהל בלי רשומת עובד (registerPushToken ב-index.js)
//
// פונקציות:
//   מנהל העסק (אותו שער כמו בשלבים 1–3: requireStaff+secretary, מנהל אמיתי, הסכמה, מצב מנהלים): secNotes, secReports, secHistory.
//   הגדרות ההתראות – secPrefs op:'notify' (secretary.js).
//   מתוזמנות (אזור אחד): secRemind – כל 15 דקות: תזכורות, דוחות, התראה על עובד, שליחת התראות; secDaily – שמירה ומחיקה לפי 9.5.
// תוכן התראת הטלפון כללי בלבד (בלי שמות, סכומים או תוכן) – הפרטים רק באפליקציה, אחרי כניסה.
const crypto = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const logger = require('firebase-functions/logger');
const { FieldValue } = require('firebase-admin/firestore');
const { onCall, LEGACY_REGION } = require('./lib/region');
const { inputObject } = require('./lib/roles');
const T = require('./lib/tenant');
const ST = require('./lib/sec-tools');
const K = require('./lib/sec-know');
const R = require('./lib/sec-remind');
const C = require('./secretary')._core;
const { gate, logData, bad, pre, wrap } = C;

const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const hh = (n) => String(n).padStart(2, '0') + ':00';
const nid = (uid, key) => crypto.createHash('sha256').update(uid + '|' + key, 'utf8').digest('hex').slice(0, 32);
const RESOLVE = ['task', 'backup', 'fact']; // נעלם מהנתונים (טופל) – התזכורת נסגרת לבד ולא חוזרת
const FIN_RESOLVE = ['invDue', 'chk']; // תיקון סבב 1: נסגרת רק כשהחשבונית/הצ'ק באמת נעלמו ממראה תקין – לא כשאין מראה ולא בגלל חלון זמן

// ---------- תוכן התראת הטלפון: כללי בלבד ----------
function pushText(notes) {
  if (notes.length > 1) return { title: 'המזכירה', body: 'יש ' + notes.length + ' התראות חדשות. פתחו את האפליקציה כדי לראות.' };
  const x = notes[0];
  const body = x.k === 'rep' ? (x.typ === 'm' ? 'הדוח החודשי מוכן' : 'הדוח השבועי מוכן') : x.k === 'emp' ? 'התראה על עובד – הפרטים באפליקציה'
    : x.k === 'dig' ? 'התקציר היומי מוכן' : x.typ === 'cal' ? 'תזכורת מהיומן' : 'תזכורת: ' + ((R.TYPES[x.typ] || {}).l || 'יש משהו לטפל בו');
  return { title: 'המזכירה', body: (x.n > 1 ? '(שוב) ' : '') + body };
}

// ---------- שליחה (FCM דרך firebase-admin). בבדיקות – opts.send מדומה ----------
const BAD_TOKEN = ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token', 'messaging/invalid-argument'];
async function fcmSend(tokens, msg) {
  const { getMessaging } = require('firebase-admin/messaging');
  const r = await getMessaging().sendEachForMulticast({ tokens, notification: { title: msg.title, body: msg.body }, data: { k: 'sec', v: 'notes' }, android: { priority: 'high' } });
  return r.responses.map((x, i) => ({ token: tokens[i], ok: x.success, code: x.error && x.error.code }));
}
async function tokensOf(db, uid) {
  const [s, p] = await Promise.all([db.doc('staff/' + uid).get(), db.doc('push_tokens/' + uid).get()]);
  const arr = (d) => (d.exists && Array.isArray(d.get('pushTokens')) ? d.get('pushTokens').filter((t) => typeof t === 'string') : []);
  return [...new Set(arr(s).concat(arr(p)))];
}
async function dropTokens(db, uid, bad) {
  if (!bad.length) return;
  for (const p of ['staff/' + uid, 'push_tokens/' + uid]) {
    const ref = db.doc(p);
    if ((await ref.get()).exists) await ref.update({ pushTokens: FieldValue.arrayRemove(...bad) });
  }
}

// ---------- מי מקבל: מנהלים שמשתמשים במזכירה (הסכמה בנוסח הנוכחי, מצב מנהלים) ----------
async function managersOf(db, cfg) {
  const s = await db.collection('admins').get();
  const out = [];
  for (const d of s.docs) {
    const me = cfg.mgr[d.id] && typeof cfg.mgr[d.id] === 'object' ? cfg.mgr[d.id] : {};
    if (me.cv !== C.CONSENT_VER) continue;
    if (cfg.mode === 'main' && cfg.mainUid !== d.id) continue;
    out.push({ uid: d.id, br: Array.isArray(d.get('br')), me, nt: R.ntOf(me) });
  }
  return { list: out, ids: new Set(s.docs.map((d) => d.id)) };
}

async function loadFin(db, cfg) {
  if (!cfg.mirror) return null;
  const s = await db.doc('sec_mirror/fin').get();
  if (!s.exists) return null;
  let j = null; try { j = JSON.parse(s.get('data')); } catch (e) { j = null; }
  const fin = ST.cleanFin(j);
  return fin ? { fin, at: s.get('at') || fin.at } : null;
}

// יצירת התראה – מזהה קבוע (uid+key): ריצה כפולה לא יוצרת כפילות
async function addNote(db, m, n, now, autoDay) {
  const ref = db.doc(`sec_note/${m.uid}/n/${nid(m.uid, n.key)}`);
  const at = n.at || now;
  // תזכורת אוטומטית ביום שאינו יום עסקים – גם התראת הטלפון מחכה ליום העסקים הבא בבוקר (7.4)
  let pushAt = R.pushAtOf(at, m.nt.q);
  if (autoDay && !K.bizDay(R.il(pushAt).day)) pushAt = R.pushAtOf(R.nextBizMorning(pushAt), m.nt.q);
  const rep = n.k === 'rem' && !R.NO_REPEAT.includes(n.typ) ? m.nt.reps : 0;
  const doc = { k: n.k, typ: n.typ || '', key: n.key.slice(0, 300), title: n.title.slice(0, 120), body: String(n.body || '').slice(0, 2000), t: now, at, pend: true, pushAt, n: 1, rep, st: 'open', seen: false };
  if (rep > 0) doc.nextAt = R.nextBizMorning(at);
  if (n.ref) doc.ref = n.ref;
  if (n.item) doc.item = String(n.item).slice(0, 300);
  try { await ref.create(doc); return true; } catch (e) { if (e && (e.code === 6 || /ALREADY_EXISTS/.test(String(e.message)))) return false; throw e; }
}

// =====================================================================================
// ריצה לעסק אחד (בתוך T.runInBiz). opts: { now, send }
// =====================================================================================
async function remindBiz(opts) {
  const db = T.tdb();
  const scope = T.scope();
  const now = opts.now || Date.now();
  const P = R.il(now), today = P.day, biz = K.bizDay(today);
  const [cs, ckS] = await Promise.all([db.doc('sec_cfg/main').get(), db.doc('sec_cfg/rem').get()]);
  const cfg = C.cfgOf(cs, scope.bizId);
  const { list: mgrs, ids: adminIds } = await managersOf(db, cfg);
  const ck = ckS.exists ? ckS.data() : {};
  const upd = {};
  const out = { notes: 0, reports: 0, emp: 0, repeats: 0, pushed: 0, gone: 0 };
  let finP = null, tasksP = null, closP = null;
  const finGet = () => finP || (finP = loadFin(db, cfg));
  const tasksGet = () => tasksP || (tasksP = db.collection('tasks').orderBy('cr', 'desc').limit(400).get().then((s) => s.docs.map((d) => d.data())));
  const closGet = () => closP || (closP = db.collection('closings').orderBy('t', 'desc').limit(300).get().then((s) => s.docs.map((d) => Object.assign({ id: d.id }, d.data()))));
  const logs = [];

  // 1. יומן (sec_cal): תזכורות שהמנהל קבע ואירועים – בכל ריצה. גם אירוע מ-3 הימים האחרונים שנדחה ליום העסקים הבא
  if (mgrs.some((m) => m.nt.rt.cal)) {
    const days = [today, K.addDays(today, -1), K.addDays(today, -2), K.addDays(today, -3)];
    const s = await db.collection('sec_cal').where('d', 'in', days).limit(500).get();
    for (const d of s.docs) {
      const e = d.data();
      if (e.st !== 'ok') continue;
      const w = R.calAt(e);
      if (w.at > now || now - w.at > 2 * 864e5) continue;
      for (const m of mgrs) {
        if (!m.nt.rt.cal || (e.uid && e.uid !== m.uid)) continue;
        const title = (e.rem ? 'תזכורת: ' : 'ביומן: ') + String(e.title || '').slice(0, 100);
        const body = e.d + (e.tm ? ' ' + e.tm : '') + (w.moved ? ' (נפל ביום שאינו יום עסקים – הועבר לבוקר יום העסקים הבא)' : '') + (e.note ? '\n' + e.note : '');
        if (await addNote(db, m, { k: 'rem', typ: 'cal', key: 'cal:' + d.id + ':' + e.d + ':' + (e.tm || ''), title, body, at: w.at, ref: d.id }, now, false)) out.notes++;
      }
    }
  }

  // 2. התראה מיידית על עובד (61) – רק כשמתג ניתוח העובדים פעיל. הפרש מזומן בסגירת קופה של עובד (לא של מנהל)
  if (cfg.emp === true) {
    const since = Number.isFinite(ck.empT) ? ck.empT : now - 2 * 3600e3;
    const s = await db.collection('closings').where('t', '>', since).orderBy('t').limit(100).get();
    let maxT = since;
    const rcpt = mgrs.filter((m) => !m.br && m.nt.rt.emp);
    for (const d of s.docs) {
      const c = d.data();
      if (Number.isFinite(c.t)) maxT = Math.max(maxT, c.t);
      if (!c.uid || adminIds.has(c.uid) || !R.notRej(c)) continue; // תיקון סבב 1: סגירה שנדחתה – לא
      const a = R.cashDiff(c);
      if (a === null || a < R.EMP_MIN) continue;
      const mon = String(c.d || today).slice(0, 7);
      const all = (await db.collection('closings').where('uid', '==', c.uid).limit(300).get()).docs.map((x) => x.data())
        .filter((x) => R.notRej(x) && String(x.d || '').slice(0, 7) === mon).map((x) => ({ d: x.d, a: R.cashDiff(x) })).filter((x) => x.a !== null && x.a >= R.EMP_MIN).sort((p, q) => String(p.d).localeCompare(String(q.d)));
      const name = String(c.by || '').slice(0, 40) || 'עובד';
      const nth = Math.max(1, all.length);
      const title = 'הפרש בקופה – ' + name;
      const body = (nth === 1 ? 'הפרש ראשון החודש' : 'הפרש מספר ' + nth + ' החודש') + ' בקופה של ' + name + ': ' + (all.length ? all.map((x) => R.ils(x.a)).join(', ') : R.ils(a)) + '.\n'
        + 'הסגירה: ' + (c.d || '') + (c.reg ? ', קופה ' + String(c.reg).slice(0, 20) : '') + ', הפרש מזומן ' + R.ils(a) + '.\n'
        + 'מה לא ידוע: טעות ספירה או הקלדה, עודף שניתן בטעות, הוצאה מהקופה שלא נרשמה, החלפת משמרת. הפרש בקופה אינו הוכחה לגניבה.';
      let any = false;
      for (const m of rcpt) if (await addNote(db, m, { k: 'emp', typ: 'emp', key: 'emp:' + d.id, title, body, ref: d.id }, now, true)) { out.emp++; any = true; }
      if (any) logs.push(logData('', 'auto', 'empAlert', { tgt: c.uid, note: 'closing ' + d.id }));
    }
    upd.empT = maxT;
  } else upd.empT = now; // כבוי: כשיודלק – רק סגירות חדשות, בלי מבול של ישנות

  // 3. תזכורות מהנתונים (7.3) – פעם ביום עסקים, מ-08:00 (שישי/שבת/חג – לא; מה שנפל בהם יוצא ביום העסקים הבא בבוקר)
  if (biz && P.hm >= R.MORNING && ck.scan !== today) {
    upd.scan = today;
    const need = (k) => mgrs.some((m) => m.nt.rt[k] && (!m.br || k === 'fact'));
    const F = (need('invDue') || need('chk')) ? await finGet() : null;
    const items = F ? R.finItems(F.fin) : null; // null = אין מראה תקין: לא סוגרים שום תזכורת כספים
    const base = [];
    if (F) base.push(...R.finCands(F.fin, today, { invDue: true, chk: true }));
    if (need('task')) { const [tk, ns] = await Promise.all([tasksGet(), db.collection('staff').limit(300).get()]); const names = {}; ns.docs.forEach((x) => { names[x.id] = String(x.get('name') || '').slice(0, 40); }); base.push(...R.taskCands(tk, names, now, today)); }
    if (need('close')) base.push(...R.closeCands(await closGet(), today));
    if (need('backup')) base.push(...R.backupCands((await db.collection('app_backup_status').limit(100).get()).docs.map((x) => Object.assign({ id: x.id }, x.data())), now, today));
    if (need('fact')) base.push(...R.factCands((await db.collection('sec_facts').limit(K.FACTS_MAX + K.PROP_MAX + 50).get()).docs.map((x) => Object.assign({ id: x.id }, x.data())), today));
    for (const m of mgrs) {
      const mine = base.filter((c) => m.nt.rt[c.typ] && (!m.br || c.typ === 'fact')); // מנהל עם הגבלת סניפים – בלי נתוני כל העסק (כמו בצ'אט)
      for (const c of mine) if (await addNote(db, m, Object.assign({ k: 'rem' }, c), now, true)) out.notes++;
      // מה שנעלם מהנתונים (שולם/נפרע/טופל) – נסגר ולא חוזר
      const keys = new Set(mine.map((c) => c.key));
      const open = await db.collection(`sec_note/${m.uid}/n`).where('st', '==', 'open').limit(500).get();
      const b = db.batch(); let nb = 0;
      for (const d of open.docs) {
        if (d.get('k') !== 'rem') continue;
        const typ = d.get('typ'), item = d.get('item');
        const gone = RESOLVE.includes(typ) ? !keys.has(d.get('key')) : FIN_RESOLVE.includes(typ) ? !!(items && item && !items.has(item)) : false;
        if (gone) { b.update(d.ref, { st: 'gone', nextAt: FieldValue.delete(), pend: false }); nb++; }
      }
      if (nb) { await b.commit(); out.gone += nb; }
    }
  }

  // 4. דוחות שבועי וחודשי (66–68) – ביום ובשעה שהמנהל קבע; באפליקציה בלבד. מנהל עם הגבלת סניפים – אין (נתוני כל העסק)
  for (const m of mgrs) {
    if (m.br || !biz) continue;
    const jobs = [];
    const W = R.weeklyDue(today, m.nt.wd);
    if (today >= W.fire && today <= K.addDays(W.fire, 2) && (today > W.fire || P.hm >= hh(m.nt.wh))) jobs.push({ kind: 'w', key: W.key, why: W.why });
    for (const M of R.monthlyDue(today, m.nt.md)) if (today >= M.fire && today <= K.addDays(M.fire, 3) && (today > M.fire || P.hm >= hh(m.nt.mh))) jobs.push({ kind: 'm', key: M.key, why: M.why });
    for (const j of jobs) {
      const ref = db.doc('sec_rep/' + j.kind + '_' + m.uid + '_' + j.key);
      if ((await ref.get()).exists) continue;
      const F = await finGet();
      const [tk, cl] = await Promise.all([tasksGet(), closGet()]);
      let payTotal = null;
      if (j.kind === 'm' && cfg.pay[m.uid] === true && cfg.mirror) {
        const ps = await db.doc('sec_mirror/pay').get();
        let pj = null; try { pj = ps.exists ? JSON.parse(ps.get('data')) : null; } catch (e) { pj = null; }
        const pay = (ST.cleanFin({ v: 1, at: 1, pay: pj }) || {}).pay || {};
        const pm = R.prevMon(j.key);
        if (pay[pm]) payTotal = Math.round(pay[pm].reduce((s, r) => s + r[1], 0) * 100) / 100;
      }
      const rep = R.buildReport({ kind: j.kind, mon: j.kind === 'm' ? R.prevMon(j.key) : undefined, today, now, fin: F && F.fin, finAt: F && F.at, nr: cfg.nr, tasks: tk, closings: cl, rt: m.nt.rt, payTotal, threshold: cfg.cfTh, why: j.why });
      try { await ref.create(Object.assign({ uid: m.uid, key: j.key, t: now, done: [] }, rep)); } catch (e) { if (e && (e.code === 6 || /ALREADY_EXISTS/.test(String(e.message)))) continue; throw e; }
      out.reports++;
      await addNote(db, m, { k: 'rep', typ: j.kind, key: 'rep:' + j.kind + ':' + j.key, title: rep.title + (j.why ? ' (' + j.why + ')' : ''), body: rep.secs.slice(0, 2).map((x) => x.h + ': ' + x.lines[0]).join('\n'), ref: ref.id }, now, true);
      logs.push(logData('', 'auto', 'report', { tgt: m.uid, note: j.kind + ' ' + j.key }));
    }
    // תקציר יומי (69) – רק אם המנהל הדליק
    if (m.nt.dg && P.hm >= hh(m.nt.dh)) {
      const F = await finGet();
      const dueToday = F ? F.fin.open.filter((r) => r[3] === today && r[5] > 0.004).length : 0;
      const ev = (await db.collection('sec_cal').where('d', '==', today).limit(200).get()).docs.filter((d) => d.get('st') === 'ok' && (!d.get('uid') || d.get('uid') === m.uid)).length;
      const op = (await db.collection(`sec_note/${m.uid}/n`).where('st', '==', 'open').limit(500).get()).docs.filter((d) => d.get('k') === 'rem').length;
      await addNote(db, m, { k: 'dig', typ: 'dig', key: 'dig:' + today, title: 'תקציר יומי', body: 'ביומן היום: ' + ev + '\nתזכורות פתוחות: ' + op + (F ? '\nחשבוניות לתשלום היום: ' + dueToday : '') }, now, true);
    }
  }

  // 5. חזרות (76): עד 3 פעמים, פעם ביום עסקים, רק ביום עסקים
  if (biz) {
    for (const m of mgrs) {
      const s = await db.collection(`sec_note/${m.uid}/n`).where('nextAt', '<=', now).limit(200).get();
      for (const d of s.docs) {
        const x = d.data();
        if (x.st !== 'open' || !(x.rep > 0)) { await d.ref.update({ nextAt: FieldValue.delete() }); continue; }
        if (x.typ === 'cal' && x.ref && !(await db.doc('sec_cal/' + x.ref).get()).exists) { await d.ref.update({ st: 'gone', nextAt: FieldValue.delete() }); continue; }
        const left = x.rep - 1;
        await d.ref.update({ rep: left, n: (x.n || 1) + 1, at: now, seen: false, pend: true, pushAt: R.pushAtOf(now, m.nt.q), nextAt: left > 0 ? R.nextBizMorning(now) : FieldValue.delete() });
        out.repeats++;
      }
    }
  }

  // 6. שליחת התראות שממתינות (שעות שקטות – 74: מחכות לסופן)
  for (const m of mgrs) {
    const s = await db.collection(`sec_note/${m.uid}/n`).where('pend', '==', true).limit(100).get();
    const due = s.docs.filter((d) => (d.get('pushAt') || 0) <= now);
    if (!due.length) continue;
    let sent = 0;
    try {
      const toks = await tokensOf(db, m.uid);
      if (toks.length) {
        const res = await (opts.send || fcmSend)(toks, pushText(due.map((d) => d.data())), { uid: m.uid, bizId: scope.bizId });
        sent = res.filter((x) => x.ok).length;
        await dropTokens(db, m.uid, res.filter((x) => !x.ok && BAD_TOKEN.includes(x.code)).map((x) => x.token));
      }
    } catch (e) {
      // תיקון סבב 1: תקלה בשליחה למנהל אחד לא עוצרת את שאר העסק. ההתראה נשארת ממתינה ותישלח בריצה הבאה
      logger.error('secretary: push failed', { bizId: scope.bizId, name: e && e.name, code: e && e.code });
      out.pushErr = (out.pushErr || 0) + 1;
      continue;
    }
    const b = db.batch();
    for (const d of due) b.update(d.ref, { pend: false, pushed: sent ? now : 0 });
    await b.commit();
    if (sent) out.pushed++;
  }

  const b = db.batch();
  b.set(db.doc('sec_cfg/rem'), Object.assign({ upd: now }, upd), { merge: true });
  for (const l of logs) b.set(db.collection('sec_log').doc(), l);
  await b.commit();
  return out;
}

// כל העסקים שהתוספת פעילה אצלם; תקלה בעסק אחד לא עוצרת את האחרים (כמו בגיבוי)
async function forAll(fn, opts, label) {
  const o = opts || {};
  const res = {}, errors = [];
  // רק עסקים שהתוספת פעילה אצלם בפועל (bizzesWith מוסיף את לארג' פעמי במצב legacy בלי לבדוק את המתג). מנותק – לא נוגעים (95)
  const list = o.bizzes || (await T.bizzesWith('secretary')).filter((b) => b.features && b.features.secretary === true);
  for (const biz of list) {
    if (biz.status !== 'active' && !o.bizzes) { res[biz.bizId] = { skipped: 'suspended' }; continue; }
    try { res[biz.bizId] = await T.runInBiz({ bizId: biz.bizId, prefix: T.bizPrefix(biz), biz }, () => fn(o)); } catch (e) {
      errors.push({ bizId: biz.bizId, reason: String(e && (e.code || e.name) || 'error').slice(0, 60) });
      logger.error('secretary: ' + label + ' failed for business', { bizId: biz.bizId, name: e && e.name, code: e && e.code });
    }
  }
  return { res, errors };
}
const runRemind = (opts) => forAll(remindBiz, opts, 'remind');

// =====================================================================================
// secDaily – שמירה ומחיקה לפי 9.5 (91–95): שיחות הצ'אט – 12 חודשים; רשימת ההתראות – 12 חודשים (הנחה, כמו הצ'אט);
// יומן הפעולות – 24 חודשים, ולא נמחק מוקדם. עסק שהתוספת נותקה בו – לא נוגעים (95: הנתונים נשמרים עד בקשת מחיקה).
// =====================================================================================
const monthsAgo = (ms, k) => { const d = new Date(ms); d.setUTCMonth(d.getUTCMonth() - k); return d.getTime(); };
async function delWhere(db, path, cutoff) {
  let n = 0;
  for (;;) {
    const s = await db.collection(path).where('t', '<', cutoff).limit(400).get();
    if (s.empty) return n;
    const b = db.batch(); s.docs.forEach((d) => b.delete(d.ref)); await b.commit();
    n += s.size;
    if (s.size < 400) return n;
  }
}
async function dailyBiz(opts) {
  const db = T.tdb();
  const now = opts.now || Date.now();
  const c12 = monthsAgo(now, 12), c24 = monthsAgo(now, 24);
  const out = { chat: 0, notes: 0, log: 0 };
  for (const p of await db.collection('sec_chat').listDocuments()) out.chat += await delWhere(db, `sec_chat/${p.id}/m`, c12);
  for (const p of await db.collection('sec_note').listDocuments()) out.notes += await delWhere(db, `sec_note/${p.id}/n`, c12);
  out.log = await delWhere(db, 'sec_log', c24);
  out.inbox = await require('./secretary-wa')._core.shrinkOld(db, c12); // שלב 5: הודעות ווצאפ וטיוטות בנות יותר מ-12 חודשים – רק תקציר (9.5)
  if (out.chat || out.notes || out.log || out.inbox) await db.collection('sec_log').doc().set(logData('', 'auto', 'retention', { note: 'chat=' + out.chat + ',notes=' + out.notes + ',log=' + out.log + ',inbox=' + out.inbox }));
  return out;
}
const runSecDaily = (opts) => forAll(dailyBiz, opts, 'daily');

// =====================================================================================
// secNotes – רשימת ההתראות של המנהל + פעולות על תזכורת (76: לשנות מספר חזרות או לבטל; "טופל")
// =====================================================================================
async function secNotes(request) {
  const input = inputObject(request);
  const op = ['list', 'seen', 'done', 'reps'].includes(input.op) ? input.op : null;
  if (!op) throw bad('bad-op', 'פעולה לא מוכרת');
  const { who, db } = await gate(request, { consent: true });
  const col = db.collection(`sec_note/${who.uid}/n`);
  const now = Date.now();
  if (op === 'list') {
    const s = await col.orderBy('at', 'desc').limit(80).get();
    const L = s.docs.filter((d) => (d.get('at') || 0) <= now).slice(0, 60).map((d) => {
      const x = d.data();
      const o = { id: d.id, k: x.k, typ: x.typ || '', title: x.title || '', body: x.body || '', at: x.at || 0, seen: x.seen === true, st: x.st || 'open', rep: x.rep || 0, n: x.n || 1 };
      if (x.ref && x.k === 'rep') o.ref = x.ref;
      return o;
    });
    return { ok: true, notes: L, unseen: L.filter((x) => !x.seen).length, types: Object.fromEntries(Object.entries(R.TYPES).map(([k, v]) => [k, v.l])) };
  }
  if (op === 'seen') {
    const ids = Array.isArray(input.ids) ? input.ids.filter((x) => typeof x === 'string' && ID_RE.test(x)).slice(0, 100) : [];
    if (!ids.length) throw bad('bad-id', 'מזהה לא תקין');
    const snaps = await db.getAll(...ids.map((i) => col.doc(i)));
    const b = db.batch(); let n = 0;
    for (const s of snaps) if (s.exists && s.get('seen') !== true) { b.update(s.ref, { seen: true }); n++; }
    if (n) await b.commit();
    return { ok: true, n };
  }
  const id = typeof input.id === 'string' && ID_RE.test(input.id) ? input.id : null;
  if (!id) throw bad('bad-id', 'מזהה לא תקין');
  const ref = col.doc(id);
  const s = await ref.get();
  if (!s.exists) throw pre('not-found', 'ההתראה לא נמצאה');
  const b = db.batch();
  if (op === 'done') {
    b.update(ref, { st: 'done', nextAt: FieldValue.delete(), pend: false, seen: true });
    b.set(db.collection('sec_log').doc(), logData(who.uid, 'mgr', 'remDone', { tgt: id }));
  } else {
    if (!Number.isInteger(input.n) || input.n < 0 || input.n > 3) throw bad('bad-reps', 'מספר חזרות: 0 עד 3');
    if (s.get('k') !== 'rem') throw pre('no-repeat', 'אפשר לשנות חזרות רק בתזכורת');
    const open = s.get('st') === 'open' && input.n > 0;
    b.update(ref, { rep: input.n, nextAt: open ? (s.get('nextAt') || R.nextBizMorning(now)) : FieldValue.delete() });
    b.set(db.collection('sec_log').doc(), logData(who.uid, 'mgr', 'remReps', { tgt: id, note: String(input.n) }));
  }
  await b.commit();
  return { ok: true, id };
}

// =====================================================================================
// secReports – "דוחות ותובנות" (8.2 מסך 7): הדוחות של המנהל עצמו; "סמן כטופל" לתובנה. "לא רלוונטי" – secPrefs op:'notRelevant' (56, 90 יום)
// =====================================================================================
async function secReports(request) {
  const input = inputObject(request);
  const op = ['list', 'get', 'done'].includes(input.op) ? input.op : null;
  if (!op) throw bad('bad-op', 'פעולה לא מוכרת');
  const { who, db } = await gate(request, { consent: true });
  if (op === 'list') {
    const s = await db.collection('sec_rep').where('uid', '==', who.uid).limit(300).get();
    const L = s.docs.map((d) => ({ id: d.id, kind: d.get('kind'), title: d.get('title') || '', key: d.get('key') || '', t: d.get('t') || 0, why: d.get('why') || '' })).sort((a, b) => b.t - a.t).slice(0, 100);
    return { ok: true, reports: L };
  }
  const id = typeof input.id === 'string' && ID_RE.test(input.id) ? input.id : null;
  if (!id) throw bad('bad-id', 'מזהה לא תקין');
  const ref = db.doc('sec_rep/' + id);
  const s = await ref.get();
  if (!s.exists || s.get('uid') !== who.uid) throw pre('not-found', 'הדוח לא נמצא'); // דוח של מנהל אחר – כאילו לא קיים
  if (op === 'get') { const x = s.data(); return { ok: true, report: { id, kind: x.kind, title: x.title, key: x.key, t: x.t, secs: x.secs || [], ideas: x.ideas || [], done: x.done || [], src: x.src || '', why: x.why || '' } }; }
  const k = typeof input.key === 'string' ? input.key : '';
  if (!(s.get('ideas') || []).some((x) => x.key === k)) throw bad('bad-key', 'תובנה לא נמצאה');
  const b = db.batch();
  b.update(ref, { done: FieldValue.arrayUnion(k) });
  b.set(db.collection('sec_log').doc(), logData(who.uid, 'mgr', 'insightDone', { tgt: id, note: k.slice(0, 120) }));
  await b.commit();
  return { ok: true, id, key: k };
}

// =====================================================================================
// secHistory – מחיקה יזומה של ההיסטוריה של המנהל (93: אישור כפול; נרשם ביומן). המחיקה רק בשרת.
//   op:'ask' – מחזיר כמה יימחק + קוד אישור חד־פעמי ל-10 דקות. op:'del' – רק עם הקוד ו-sure:true. בלי – נדחה.
//   נמחקים: שיחת הצ'אט של המנהל, רשימת ההתראות שלו והדוחות שלו. יומן הפעולות (sec_log) לא נמחק (10.7).
// =====================================================================================
const DEL_MS = 10 * 60000;
async function secHistory(request) {
  const input = inputObject(request);
  const op = ['ask', 'del'].includes(input.op) ? input.op : null;
  if (!op) throw bad('bad-op', 'פעולה לא מוכרת');
  const { who, db } = await gate(request, { consent: true });
  const tokRef = db.doc('sec_cfg/del_' + who.uid);
  const chat = db.collection(`sec_chat/${who.uid}/m`), notes = db.collection(`sec_note/${who.uid}/n`), reps = db.collection('sec_rep').where('uid', '==', who.uid);
  const now = Date.now();
  if (op === 'ask') {
    const [a, b2, c] = await Promise.all([chat.count().get(), notes.count().get(), reps.count().get()]);
    const tok = crypto.randomBytes(16).toString('hex');
    const b = db.batch();
    b.set(tokRef, { h: crypto.createHash('sha256').update(tok).digest('hex'), exp: now + DEL_MS });
    b.set(db.collection('sec_log').doc(), logData(who.uid, 'mgr', 'histAsk'));
    await b.commit();
    return { ok: true, token: tok, exp: now + DEL_MS, counts: { chat: a.data().count, notes: b2.data().count, reports: c.data().count } };
  }
  if (typeof input.token !== 'string' || !input.token || input.sure !== true) throw pre('need-confirm', 'צריך אישור שני כדי למחוק את ההיסטוריה');
  const h = crypto.createHash('sha256').update(input.token).digest('hex');
  await db.runTransaction(async (tx) => {
    const s = await tx.get(tokRef);
    if (!s.exists || s.get('h') !== h || !(s.get('exp') > now)) throw pre('bad-confirm', 'האישור פג או לא תקין. התחילו שוב.');
    tx.delete(tokRef); // חד־פעמי
  });
  const n = { chat: 0, notes: 0, reports: 0 };
  const drain = async (q, k) => { for (;;) { const s = await q.limit(400).get(); if (s.empty) return; const b = db.batch(); s.docs.forEach((d) => b.delete(d.ref)); await b.commit(); n[k] += s.size; if (s.size < 400) return; } };
  await drain(chat, 'chat'); await drain(notes, 'notes'); await drain(reps, 'reports');
  await db.collection('sec_log').doc().set(logData(who.uid, 'mgr', 'histDel', { note: 'chat=' + n.chat + ',notes=' + n.notes + ',reports=' + n.reports }));
  return { ok: true, deleted: n };
}

exports.secNotes = onCall(wrap('secNotes', secNotes));
exports.secReports = onCall(wrap('secReports', secReports));
exports.secHistory = onCall(wrap('secHistory', secHistory));
// מתוזמנות – אזור אחד בלבד (ריצה כפולה = התראות כפולות), כמו secBackupDaily
exports.secRemind = onSchedule({ region: LEGACY_REGION, schedule: 'every 15 minutes', timeZone: R.TZ, timeoutSeconds: 300, memory: '256MiB' }, async () => {
  const r = await runRemind({});
  logger.info('secretary: remind done', { bizzes: Object.keys(r.res).length, errors: r.errors.length });
  if (r.errors.length) throw new Error('secretary remind: ' + r.errors.length + ' errors');
});
exports.secDaily = onSchedule({ region: LEGACY_REGION, schedule: 'every day 04:15', timeZone: R.TZ, timeoutSeconds: 540, memory: '512MiB' }, async () => {
  const r = await runSecDaily({});
  logger.info('secretary: daily retention done', { bizzes: Object.keys(r.res).length, errors: r.errors.length });
  if (r.errors.length) throw new Error('secretary daily: ' + r.errors.length + ' errors');
});

Object.defineProperty(exports, '_core', { enumerable: false, value: { runRemind, remindBiz, runSecDaily, dailyBiz, pushText, tokensOf, nid, monthsAgo } });
