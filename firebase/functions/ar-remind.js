'use strict';
// שלב 5 (משימה 2026-11-14_הזמנות-לקוח-עסקי-וחשבוניות, 15.11.2026): תזכורות תשלום ללקוחות (86–94) וסיכום חודשי אוטומטי (74, החלטה 23).
// arRemind – פונקציה מתוזמנת, כל 15 דקות, שעון ישראל, אזור אחד בלבד (LEGACY_REGION – מתוזמנת לא רצה כפול; lib/region.js).
//
// מתי שולחים: רק כש"מסמכים פעילים" (arcfg/main.on) **וגם** "תזכורות" (arcfg/rem.on) דולקים; רק ביום עסקים (tkBiz – לא שישי, שבת, חג) ומהשעה
// שבהגדרות (hour, ברירת מחדל 9:00). השלבים לכל חשבונית (AC.remStages): b ימים לפני המועד (3), ביום המועד, אחרי 3 / 7 / 30 ימים, ואחר כך כל 30 יום
// עד התשלום. שלב שנופל ביום שאינו יום עסקים – ביום העסקים הבא. נשלח רק השלב האחרון שהגיע זמנו (שלב שהוחמץ לא נשלח באיחור בנוסף לו).
// הודעה אחת ללקוח ביום, עם כל החשבוניות הפתוחות שלו (הנחה). לקוח עם cust.rem.on === false – לא מקבל. cust.rem.b – ימים לפני, ללקוח.
//
// מניעת כפילות: בטרנזקציה אחת, לפני השליחה, נוצרים arrem/c_{לקוח}_{יום} (נעילה – הודעה אחת ללקוח ביום) ו-arrem/{חשבונית}_{שלב} (כל שלב פעם אחת).
// create נכשל אם המסמך קיים, כך שריצה כפולה / במקביל לא שולחת פעמיים. באותה טרנזקציה נבדק שוב שהחשבונית עדיין פתוחה (תשלום שנכנס בין הריצות עוצר).
// תקרה יומית לעסק: arrem/n_{יום}.n עד arcfg/rem.cap (ברירת מחדל 200, הנחה). מעבר לתקרה – ממשיכים מחר.
// אחרי ריצה מלאה (בלי עצירה בגלל תקרה / מכסת מייל) – arrem/n_{יום}.done, והריצות הבאות באותו יום לא סורקות שוב.
// מייל בלבד (ar-send הקיים, עם PDF "פירוט יתרה"), כי אין עדיין תבנית ווטסאפ מאושרת לתזכורות. בלי מייל ללקוח – נרשם no-to (המנהל משתף מהאפליקציה).
// מכסת המייל של העסק לשעה (ar-send: 30 לשעה) מלאה – הנעילה מבוטלת ומנסים שוב בריצה הבאה (לא נשלח כלום, ולכן אין כפילות).
// סיכום יומי למנהל (92, sum !== false): אחרי שכל ההודעות של היום יצאו – arrem/sum_{יום} (פעם אחת), ומייל ל-arcfg/main.mail עם PDF: למי נשלח ומי עדיין חייב.
// קישור תשלום (94): כשלעסק מוגדר קישור (private/pay, mode 'link') – נכנס להודעה במקום {קישור}.
//
// סיכום חודשי אוטומטי: ביום העסקים הראשון בחודש (ועד ה-7 לחודש, אם הוחמץ), ללקוח עם cust.invM === true – מסמך הסיכום של החודש הקודם
// (ar.js monBuild – לא חשבונית מס), ושליחה לפי cust.snd (ברירת מחדל מייל). arrem/st_{לקוח}_{YYYY-MM} – פעם אחת. תלוי רק ב"מסמכים פעילים".
//
// arcfg/rem { on, hour, b, steps[], mon, cap, txt, sum, upd, by } – setRemCfg (ar.js, מנהל). אוסף arrem – שרת בלבד (אין כלל קריאה באפליקציה).

const { onSchedule } = require('firebase-functions/v2/scheduler');
const logger = require('firebase-functions/logger');
const { getApps, initializeApp } = require('firebase-admin/app');
const { FieldValue } = require('firebase-admin/firestore');
const { LEGACY_REGION } = require('./lib/region');
const T = require('./lib/tenant');
const TK = require('./lib/tk-time');
const AC = require('./lib/ar-calc');
const ARD = require('./lib/ar-doc');
const PDF = require('./lib/ar-pdf');
const S = require('./lib/ar-send');

if (!getApps().length) initializeApp();

const HOUR0 = 9, CAP0 = 200, MAX_INV = 5000;
const TXT0 = 'שלום {שם},\nתזכורת ידידותית: לפי הרישומים שלנו יתרה פתוחה לתשלום בסך {סכום}.\n{פירוט}\nאם התשלום כבר בוצע – תודה, ואפשר להתעלם מההודעה.\n{קישור}\n{עסק}';
const WHO = 'arRemind';
const isBizS = (s) => { const [y, m, d] = s.split('-').map(Number); return TK.tkBiz({ y, m: m - 1, d }); };
const dd = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
const daysBetween = (a, b) => Math.round((Date.UTC(...b.split('-').map((v, i) => (i === 1 ? v - 1 : +v))) - Date.UTC(...a.split('-').map((v, i) => (i === 1 ? v - 1 : +v)))) / 864e5);
const exists = (e) => e && (e.code === 6 || /ALREADY_EXISTS|already exists/i.test(String(e.message)));
const dueOf = (x) => x.dueX || x.due || '';

// נוסח ההודעה: {שם} {סכום} {פירוט} {עסק} {קישור}. שורות ריקות כפולות (בלי קישור) מצטמצמות
function msgOf(txt, v) {
  const t = String(txt || '').trim() || TXT0;
  return t.replace(/\{(שם|סכום|פירוט|עסק|קישור)\}/g, (_, k) => v[k] || '').replace(/\n{3,}/g, '\n\n').trim();
}
function detailOf(list, today) {
  return list.slice(0, 30).map((x) => {
    const due = dueOf(x), late = daysBetween(due, today);
    return `• חשבונית ${x.no} מיום ${dd(x.d)}: ${PDF.moneyAg(x.open)}, לתשלום עד ${dd(due)}${late > 0 ? ` (באיחור ${late} ימים)` : late === 0 ? ' (היום)' : ''}`;
  }).join('\n') + (list.length > 30 ? `\nועוד ${list.length - 30} חשבוניות – בפירוט המצורף` : '');
}

// ---------- תזכורות של עסק אחד ----------
async function remind(db, w, cfg, rc, now, today, deps, res) {
  const AR = require('./ar')._core;
  const send = deps.mail || S.sendMail;
  const cap = Number.isInteger(rc.cap) && rc.cap > 0 ? rc.cap : CAP0;
  // ריצה מלאה של היום כבר הסתיימה (done) – לא עוברים שוב על כל החשבוניות כל 15 דקות. מועד שמנהל שינה היום – התזכורת תצא מחר
  const day0 = await db.doc(`arrem/n_${today}`).get();
  if (day0.exists && day0.get('d') === today && day0.get('done') === true) { res.rem = 'done'; return; }
  const q = await db.collection('ardoc').where('open', '>', 0).limit(MAX_INV).get();
  const by = new Map();
  for (const s of q.docs) {
    const x = Object.assign({ id: s.id }, s.data());
    if (x.t !== 'inv' || x.void || typeof x.cust !== 'string' || !x.cust || !AC.ymdOk(dueOf(x))) continue;
    if (!by.has(x.cust)) by.set(x.cust, []);
    by.get(x.cust).push(x);
  }
  const cids = [...by.keys()].sort();
  const custs = new Map();
  for (let i = 0; i < cids.length; i += 100) {
    const ss = await db.getAll(...cids.slice(i, i + 100).map((c) => db.doc('cust/' + c)));
    ss.forEach((s) => custs.set(s.id, s.exists ? s.data() || {} : null));
  }
  let link = '';
  try { const p = await db.doc('private/pay').get(); if (p.exists && p.get('mode') === 'link' && typeof p.get('link') === 'string') link = p.get('link'); } catch (e) { /* בלי קישור */ }
  const owe = [];
  for (const cid of cids) {
    const list = by.get(cid).sort((a, b) => dueOf(a).localeCompare(dueOf(b)) || a.no - b.no);
    const c = custs.get(cid);
    owe.push({ cust: cid, name: (list[0].custSnap && list[0].custSnap.name) || (c && (c.bn || c.name)) || '', open: list.reduce((s, x) => s + x.open, 0), n: list.length, late: Math.max(0, daysBetween(dueOf(list[0]), today)) });
    if (res.stop) continue;
    if (!c || c.mv) { res.noCust = (res.noCust || 0) + 1; continue; }
    if (c.rem && c.rem.on === false) { res.custOff = (res.custOff || 0) + 1; continue; }
    const rcC = Object.assign({}, rc, c.rem && Number.isInteger(c.rem.b) ? { b: c.rem.b } : {});
    const want = [];
    for (const x of list) { const st = AC.remStages(dueOf(x), x.d, today, rcC, isBizS); if (st.length) want.push({ x, k: st[st.length - 1].k }); }
    if (!want.length) continue;
    const lock = db.doc(`arrem/c_${cid}_${today}`), cnt = db.doc(`arrem/n_${today}`);
    const sRefs = want.map((v) => db.doc(`arrem/${v.x.id}_${v.k}`)), iRefs = want.map((v) => db.doc('ardoc/' + v.x.id));
    let cl;
    try {
      cl = await db.runTransaction(async (tx) => {
        const all = await tx.getAll(lock, cnt, ...sRefs, ...iRefs);
        const [ls, ns] = all, ex = all.slice(2, 2 + sRefs.length), iv = all.slice(2 + sRefs.length);
        if (ls.exists) return { why: 'dup' };
        const n = ns.exists && ns.get('d') === today ? ns.get('n') || 0 : 0;
        if (n >= cap) return { why: 'cap' };
        const go = want.filter((v, i) => !ex[i].exists && iv[i].exists && iv[i].get('open') > 0 && !iv[i].get('void'));
        if (!go.length) return { why: 'none' };
        tx.create(lock, { cust: cid, d: today, at: now, st: go.map((v) => v.x.id + '_' + v.k) });
        for (const v of go) tx.create(db.doc(`arrem/${v.x.id}_${v.k}`), { inv: v.x.id, no: v.x.no, k: v.k, cust: cid, d: today, at: now, open: v.x.open });
        tx.set(cnt, { d: today, n: n + 1 }, { merge: true });
        return { go };
      });
    } catch (e) { if (exists(e)) { res.dup = (res.dup || 0) + 1; continue; } throw e; }
    if (!cl.go) { res[cl.why] = (res[cl.why] || 0) + 1; if (cl.why === 'cap') res.stop = 'cap'; continue; }
    // כל החשבוניות הפתוחות של הלקוח – אחרי בדיקה חוזרת (מה שנסגר בינתיים לא נכנס)
    const live = (await db.getAll(...list.map((x) => db.doc('ardoc/' + x.id)))).filter((s) => s.exists && s.get('open') > 0 && !s.get('void')).map((s) => Object.assign({ id: s.id }, s.data()));
    if (!live.length) { await lock.update({ r: { ok: false, why: 'paid', to: '', n: 0, amt: 0 } }); res.paid = (res.paid || 0) + 1; continue; } // הכול שולם בינתיים – לא שולחים
    const sum = live.reduce((s, x) => s + x.open, 0);
    const name = (live[0] && live[0].custSnap && live[0].custSnap.name) || c.bn || c.name || '';
    const to = String(c.mail || (live[0] && live[0].custSnap && live[0].custSnap.mail) || '').trim();
    let r;
    if (!to) r = { ch: 'mail', to: '', at: now, ok: false, why: 'no-to' };
    else {
      const st = await AR.stmtBuild(db, w, cfg, c, live, { open: true });
      const text = msgOf(rc.txt, { 'שם': name, 'סכום': PDF.moneyAg(sum), 'פירוט': detailOf(live, today), 'עסק': cfg.name || '', 'קישור': link ? 'לתשלום: ' + link : '' });
      r = await send(w.bizId, { to, subject: `תזכורת תשלום${cfg.name ? ' – ' + cfg.name : ''}`, text, replyTo: cfg.mail, fromName: cfg.name || '', pdf: st.buf, fileName: st.name, by: WHO, now });
    }
    if (r && r.why === 'rate') { // מכסת המייל לשעה – מבטלים את הנעילה ומנסים בריצה הבאה
      const b = db.batch();
      b.delete(lock); for (const v of cl.go) b.delete(db.doc(`arrem/${v.x.id}_${v.k}`)); b.update(cnt, { n: FieldValue.increment(-1) });
      await b.commit();
      res.stop = 'rate';
      continue;
    }
    await lock.update({ r: { ok: !!(r && r.ok), why: (r && r.why) || '', to: (r && r.to) || to, n: live.length, amt: sum }, name });
    if (r && r.ok) res.sent = (res.sent || 0) + 1; else res.fail = (res.fail || 0) + 1;
  }
  // סיכום יומי למנהל – פעם אחת ביום, רק אחרי שכל ההודעות של היום יצאו (לא כשנעצרנו בגלל מכסת המייל)
  if (rc.sum !== false && res.stop !== 'rate') await daily(db, w, cfg, now, today, owe, send, res);
  if (!res.stop) await db.doc(`arrem/n_${today}`).set({ d: today, done: true }, { merge: true });
}

async function daily(db, w, cfg, now, today, owe, send, res) {
  const q = await db.collection('arrem').where('d', '==', today).get();
  const sent = q.docs.filter((s) => s.id.startsWith('c_') && s.get('r')).map((s) => ({ cust: s.get('cust'), name: s.get('name') || '', ok: s.get('r').ok, why: s.get('r').why || '', to: s.get('r').to || '', n: s.get('r').n || 0, amt: s.get('r').amt || 0 }));
  if (!sent.length) return;
  const ref = db.doc('arrem/sum_' + today);
  try { await ref.create({ d: today, at: now, sent: sent.slice(0, 300), owe: owe.slice(0, 300), nOwe: owe.length, tot: owe.reduce((s, o) => s + o.open, 0) }); } catch (e) { if (exists(e)) return; throw e; }
  res.sum = true;
  const to = String(cfg.mail || '').trim();
  if (!to) { await ref.update({ mail: { ok: false, why: 'no-to' } }); return; }
  const sm = new Map(sent.map((s) => [s.cust, s]));
  const rows = owe.map((o) => { const s = sm.get(o.cust); return [o.name, s ? (s.ok ? 'נשלח' : 'לא נשלח (' + (s.why || '') + ')') : '', String(o.n), PDF.moneyAg(o.open), o.late > 0 ? String(o.late) : '']; });
  const tot = owe.reduce((s, o) => s + o.open, 0);
  const AR = require('./ar')._core;
  const doc = { t: 'st', d: today, draft: false, title: `סיכום תזכורות – ${dd(today)}`, biz: await AR.bizOf(db, w, cfg), cust: { name: cfg.name || '' },
    table: { head: ['לקוח', 'תזכורת היום', 'חשבוניות', 'יתרה פתוחה', 'באיחור (ימים)'], rows: rows.slice(0, 300), num: [2, 3, 4] },
    sums: [['נשלחו היום', sent.filter((s) => s.ok).length], ['לקוחות עם יתרה', owe.length], ['סה״כ יתרה פתוחה', tot / 100]], note: 'מסמך פנימי למנהל.' };
  const buf = await PDF.render(doc);
  const text = `סיכום תזכורות התשלום של היום (${dd(today)}):\nנשלחו ${sent.filter((s) => s.ok).length} תזכורות${sent.some((s) => !s.ok) ? `, ${sent.filter((s) => !s.ok).length} לא נשלחו` : ''}.\nלקוחות עם יתרה פתוחה: ${owe.length}, בסך ${PDF.moneyAg(tot)}.\nהפירוט המלא מצורף, וגם באפליקציה (הגדרות ← תזכורות תשלום).`;
  const r = await send(w.bizId, { to, subject: `סיכום תזכורות תשלום – ${dd(today)}`, text, fromName: cfg.name || '', pdf: buf, fileName: 'סיכום תזכורות.pdf', by: WHO, now });
  await ref.update({ mail: { ok: !!(r && r.ok), why: (r && r.why) || '' } });
}

// ---------- סיכום חודשי אוטומטי (invM) ----------
async function monthly(db, w, cfg, now, today, deps, res) {
  const AR = require('./ar')._core;
  const [y, m] = today.split('-').map(Number);
  if (+today.slice(8) > 7) return; // יום העסקים הראשון בחודש (הריצה הראשונה ביום עסקים); אם הוחמץ – עד ה-7 לחודש. arrem/st_* – פעם אחת
  const ym = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  const q = await db.collection('cust').where('invM', '==', true).get();
  for (const s of q.docs) {
    const c = s.data() || {};
    if (c.mv) continue;
    const ref = db.doc(`arrem/st_${s.id}_${ym}`);
    try { await ref.create({ cust: s.id, ym, d: today, at: now }); } catch (e) { if (exists(e)) continue; throw e; }
    let mb;
    try { mb = await AR.monBuild(db, w, cfg, c, s.id, ym); } catch (e) {
      if (e && e.details && e.details.reason === 'no-docs') { await ref.update({ why: 'no-docs' }); res.stNone = (res.stNone || 0) + 1; continue; }
      throw e;
    }
    const snd = c.snd && typeof c.snd === 'object' && ['wa', 'mail', 'both'].includes(c.snd.ch) ? c.snd : { ch: 'mail' };
    const list = AR.targets(snd, { cust: mb.doc.cust }, c);
    let sent;
    if (deps.mail) { // בדיקות: שליחת מייל מדומה
      sent = [];
      for (const [ch, t] of list) sent.push(ch === 'mail' && t ? await deps.mail(w.bizId, { to: t, subject: mb.doc.title, text: '', pdf: mb.buf, fileName: mb.name, by: WHO, now }) : { ch, to: t || '', at: now, ok: false, why: t ? 'no-tpl' : 'no-to' });
      await mb.sref.update({ sent });
    } else sent = await AR.monSend(db, w, cfg, c, mb, list, true);
    await ref.update({ sent: sent.map((r) => ({ ch: r.ch, ok: !!r.ok, why: r.why || '' })) });
    res.st = (res.st || 0) + 1;
  }
}

// ---------- כל העסקים ----------
async function runBiz(biz, now, deps) {
  const res = {};
  const prefix = T.bizPrefix(biz);
  await T.runInBiz({ prefix, bizId: biz.bizId }, async () => {
    const db = T.tdb();
    const [ms, rs] = await db.getAll(db.doc('arcfg/main'), db.doc('arcfg/rem'));
    const cfg = ms.exists ? ms.data() || {} : {};
    if (cfg.on !== true) { res.skipped = 'ar-off'; return; }
    const rc = rs.exists ? rs.data() || {} : {};
    const wl = TK.wall(now);
    const today = TK.dayStr({ y: wl.y, m: wl.m, d: wl.d });
    const hour = Number.isInteger(rc.hour) ? rc.hour : HOUR0;
    if (!isBizS(today)) { res.skipped = 'not-biz-day'; return; }
    if (wl.hh < hour) { res.skipped = 'early'; return; }
    const w = { uid: WHO, bizId: biz.bizId, role: 'manager', mine: null };
    await monthly(db, w, cfg, now, today, deps, res);
    if (rc.on !== true) { res.rem = 'off'; return; }
    await remind(db, w, cfg, rc, now, today, deps, res);
  });
  return res;
}
async function runAll(opts) {
  const o = opts || {};
  const now = o.now || Date.now();
  const out = {};
  for (const biz of await T.bizzesWith('orders')) {
    if (o.only && biz.bizId !== o.only) continue;
    if (biz.status !== 'active' || !biz.features.orders) { out[biz.bizId] = { skipped: 'inactive' }; continue; }
    try { out[biz.bizId] = await runBiz(biz, now, o); } catch (e) {
      logger.error('arRemind: biz failed', { biz: biz.bizId, name: e && e.name, code: e && e.code, reason: e && e.details && e.details.reason });
      out[biz.bizId] = { error: 1 };
    }
  }
  return out;
}

exports.arRemind = onSchedule({ region: LEGACY_REGION, schedule: 'every 15 minutes', timeZone: TK.TZ, timeoutSeconds: 540, memory: '512MiB',
  secrets: [require('./ar')._core.WA_ACCESS_TOKEN].concat(S.MAIL_SECRETS) }, async () => {
  const out = await runAll();
  if (Object.values(out).some((r) => r.sent || r.fail || r.error || r.st || r.sum)) logger.info('arRemind', out);
});

// לבדיקות בלבד (לא נספר כפונקציה)
Object.defineProperty(exports, '_core', { enumerable: false, value: { runAll, runBiz, msgOf, detailOf, TXT0, HOUR0, CAP0 } });
