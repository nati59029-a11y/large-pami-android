'use strict';
// גיטי – טיוטות הזמנה מספקים (24.11.2026, "גיטי מנהלת עסק", סבב 4 חלק ב, החלטה 9). החישוב עצמו – lib/sec-an.js ordSuggest (טהור, בלי AI).
//
//   sec_an/{id}  id = od<12 תווי hash של שם הספק>_<YYYYMMDD>
//     { k:'od', st:'pend'|'ok'|'no'|'old', sup, sk, day, t, n, lines:[{ pid, n, qty, m:'s'|'h', why, cost? }], amt?, stBy?, stAt?, fin?:[{pid,qty}], so?:[מזהי supord] }
//     השרת בלבד (בחוקים: הכול false). האפליקציה קוראת דרך secReports op:'an' ומכריעה דרך secPrefs op:'od'.
//
//   daily(db, now) – פעם ביום מתוך secRemind (secretary-remind.js), לא פונקציה חדשה:
//     • "טיוטת הזמנה מספק: אסור" (sec_cfg/perm) – לא נוצר כלום.
//     • ספק שיש לו טיוטה ממתינה, או שטיוטה שלו נדחתה ב-7 הימים האחרונים – לא מקבל טיוטה חדשה. טיוטה ממתינה מעל 7 ימים – 'old' (לא נמחקת).
//     • מזהה קבוע לספק וליום (create): ריצה כפולה לא יוצרת כפילות.
//     • תקרות: עד 5,000 מוצרים, 8,000 תנועות מלאי (28 יום), 3,000 שורות "להזמין מספקים", 20 ספקים × 30 שורות; תקרת זמן 20 שניות לפני הכתיבה.
//   decide(db, uid, input, t, logData) – אישור / דחייה (secPrefs op:'od'):
//     • אישור – השורות שנשארו (כמויות אחרי עריכה; כמות 0 / שורה שהוסרה – לא נכנסת) נכנסות לרשימה הקיימת "להזמין מספקים"
//       (supord/sg<id>_p_<pid>, st:'open', src:'sec', br:'_'), טרנזקציה אחת עם סימון הטיוטה ורישום ביומן (odOk).
//       שום דבר לא נשלח לספק ולא משנה מלאי – בדיוק כמו "להזמין מספקים" מהליקוט (ord-pick.js).
//     • דחייה – סימון ורישום (odNo). טיוטה שכבר הוכרעה – already, בלי כתיבה.
//     • "אסור" שהוגדר אחרי יצירת הטיוטה – האישור נחסם (perm-no).

const crypto = require('node:crypto');
const AN = require('./sec-an');
const PERM = require('./sec-perm');

const ID_RE = /^od[0-9a-f]{12}_\d{8}$/;
const PID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const OLD_MS = 7 * 864e5, NO_MS = 7 * 864e5, TIME_MAX = 20000;
const LIM = Object.freeze({ prods: 5000, moves: 8000, so: 3000 });
const NB = '_'; // כמו orders.js: עסק בלי סניפים / שורה של כל העסק
const skOf = (k) => crypto.createHash('sha1').update(String(k), 'utf8').digest('hex').slice(0, 12);
const idOf = (sk, day) => 'od' + skOf(sk) + '_' + day.replace(/-/g, '');
const soIdOf = (id, pid) => 'sg' + id + '_p_' + pid;
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const exists = (e) => !!(e && (e.code === 6 || /ALREADY_EXISTS/.test(String(e.message))));

async function daily(db, now) {
  const t0 = Date.now();
  const p = await PERM.readPerm(db);
  if (!PERM.canPropose(p, 'ord')) return { perm: 'no', made: 0 };
  const day = PERM.dayKey(now);
  const [pend, recent] = await Promise.all([
    db.collection('sec_an').where('st', '==', 'pend').limit(300).get(),
    db.collection('sec_an').where('t', '>=', now - Math.max(OLD_MS, NO_MS) - 864e5).limit(500).get()]);
  const out = { made: 0, kept: 0, old: 0, skip: 0 };
  const busy = new Set();
  const b0 = db.batch();
  for (const d of pend.docs) {
    if (d.get('k') !== 'od') continue;
    if (!((d.get('t') || 0) >= now - OLD_MS)) { b0.update(d.ref, { st: 'old', stAt: now }); out.old++; } else busy.add(d.get('sk'));
  }
  for (const d of recent.docs) if (d.get('k') === 'od' && d.get('st') === 'no' && (d.get('stAt') || 0) >= now - NO_MS) busy.add(d.get('sk'));
  if (out.old) await b0.commit();
  const [ps, ms, ss] = await Promise.all([
    db.collection('prod').select('name', 'sup', 'q', 'on', 'nc').limit(LIM.prods).get(),
    db.collection('stockLog').where('at', '>=', now - AN.OD.WIN * 864e5).orderBy('at', 'desc').select('prod', 'delta', 'why', 'at').limit(LIM.moves).get(),
    db.collection('supord').select('pid', 'n', 'sup', 'qty', 'st', 'at').limit(LIM.so).get()]);
  if (ps.empty) return Object.assign(out, { noProd: true });
  const moves = ms.docs.map((d) => d.data());
  // התנועות קוצרו – הקצב מחושב רק מהתקופה שנקראה במלואה (מהישנה שנקראה ועד עכשיו)
  const movesFrom = ms.size >= LIM.moves && moves.length ? moves[moves.length - 1].at : undefined;
  const R = AN.ordSuggest({ now, prods: ps.docs.map((d) => Object.assign({ id: d.id }, d.data())), moves, movesFrom, so: ss.docs.map((d) => d.data()) });
  out.stat = R.stat;
  const todo = R.drafts.filter((g) => { if (busy.has(g.sk)) { out.skip++; return false; } return true; });
  if (!todo.length) return out;
  if (Date.now() - t0 > TIME_MAX) return Object.assign(out, { timeout: true });
  // עלות (prod/{id}/p/cost) – רק למוצרים שהוצעו; להצגת סכום משוער בלבד
  const pids = [...new Set(todo.flatMap((g) => g.lines.map((l) => l.pid)))];
  const cost = new Map();
  for (let i = 0; i < pids.length; i += 100) {
    const s = await db.getAll(...pids.slice(i, i + 100).map((id) => db.doc('prod/' + id + '/p/cost')));
    s.forEach((x, j) => { const c = x.exists ? x.get('cost') : null; if (num(c) && c >= 0) cost.set(pids[i + j], c); });
  }
  if (Date.now() - t0 > TIME_MAX) return Object.assign(out, { timeout: true });
  for (const g of todo) {
    const lines = g.lines.map((l) => Object.assign({ pid: l.pid, n: l.n, qty: l.qty, m: l.m, why: l.why.slice(0, 200) }, cost.has(l.pid) ? { cost: cost.get(l.pid) } : {}));
    const priced = lines.filter((l) => num(l.cost));
    const doc = { k: 'od', st: 'pend', sup: g.sup, sk: g.sk, day, t: now, n: lines.length, lines };
    if (priced.length) doc.amt = Math.round(priced.reduce((s, l) => s + l.cost * l.qty, 0) * 100) / 100;
    if (priced.length && priced.length < lines.length) doc.amtPart = true; // לחלק מהמוצרים אין עלות – הסכום חלקי
    try { await db.doc('sec_an/' + idOf(g.sk, day)).create(doc); out.made++; } catch (e) { if (exists(e)) out.kept++; else throw e; }
  }
  return out;
}

// לאפליקציה: הטיוטות הממתינות (עד 30, מהחדשה)
async function list(db, now) {
  const s = await db.collection('sec_an').where('st', '==', 'pend').limit(100).get();
  return s.docs.filter((d) => d.get('k') === 'od' && (d.get('t') || 0) >= now - OLD_MS).map((d) => {
    const x = d.data();
    return { id: d.id, sup: x.sup || '', day: x.day || '', t: x.t || 0, amt: num(x.amt) ? x.amt : null, amtPart: x.amtPart === true,
      lines: (Array.isArray(x.lines) ? x.lines : []).map((l) => ({ pid: l.pid, n: l.n, qty: l.qty, m: l.m, why: l.why || '', cost: num(l.cost) ? l.cost : null })) };
  }).sort((a, b) => b.t - a.t).slice(0, 30);
}
const pendN = async (db) => (await db.collection('sec_an').where('st', '==', 'pend').limit(100).get()).docs.filter((d) => d.get('k') === 'od').length;

function bad(code, msg) { const e = new Error(msg); e.odBad = code; return e; }
// input: { id, st:'ok'|'no', lines?:[{ pid, qty }] } → { st, n?, so?, already? }. שגיאה – זורק { odBad | odPre | odDeny }
async function decide(db, uid, input, t, logData) {
  const id = typeof input.id === 'string' && ID_RE.test(input.id) ? input.id : null;
  if (!id || !['ok', 'no'].includes(input.st)) throw bad('bad-input', 'ערך לא תקין');
  let want = null;
  if (input.st === 'ok') {
    if (!Array.isArray(input.lines) || input.lines.length > AN.OD.MAX_LINES) throw bad('bad-input', 'שורות לא תקינות');
    want = new Map();
    for (const l of input.lines) {
      if (!l || typeof l !== 'object' || typeof l.pid !== 'string' || !PID_RE.test(l.pid) || want.has(l.pid)) throw bad('bad-input', 'שורה לא תקינה');
      if (!num(l.qty) || l.qty < 0 || l.qty > AN.OD.MAX_QTY) throw bad('bad-qty', 'כמות לא תקינה');
      if (l.qty > 0) want.set(l.pid, Math.round(l.qty * 1000) / 1000);
    }
    if (!want.size) throw bad('no-lines', 'לא נשארו מוצרים בטיוטה. כדי לוותר עליה – "דחייה"');
  }
  const ref = db.doc('sec_an/' + id);
  return db.runTransaction(async (tx) => {
    const [ds, pm] = await Promise.all([tx.get(ref), tx.get(db.doc('sec_cfg/perm'))]);
    if (!ds.exists || ds.get('k') !== 'od') { const e = new Error('הטיוטה לא נמצאה'); e.odPre = 'not-found'; throw e; }
    if (ds.get('st') !== 'pend') return { st: ds.get('st'), already: true };
    if (input.st === 'no') {
      tx.update(ref, { st: 'no', stBy: uid, stAt: t });
      tx.set(db.collection('sec_log').doc(), logData(uid, 'mgr', 'odNo', { tgt: id, note: String(ds.get('sup') || '').slice(0, 60) }));
      return { st: 'no' };
    }
    if (!PERM.canPropose(PERM.permOf(pm.exists ? pm.data() : null), 'ord')) { const e = new Error('מנהל־העל הגדיר: טיוטת הזמנה מספק – אסור'); e.odDeny = 'perm-no'; throw e; }
    const L = (ds.get('lines') || []).filter((l) => l && want.has(l.pid));
    if (L.length !== want.size) throw bad('bad-input', 'מוצר שלא בטיוטה');
    const refs = L.map((l) => db.doc('supord/' + soIdOf(id, l.pid)));
    const cur = await tx.getAll(...refs);
    const so = [];
    L.forEach((l, i) => {
      so.push(refs[i].id);
      if (cur[i].exists) return; // כבר נכנס (לא אמור לקרות – הטיוטה עדיין ממתינה); לא דורסים
      tx.set(refs[i], { pid: l.pid, n: String(l.n || '').slice(0, 80), qty: want.get(l.pid), sup: String(ds.get('sup') || '').slice(0, 60), br: NB, st: 'open', src: 'sec', od: id, by: uid, at: t, upd: t });
    });
    tx.update(ref, { st: 'ok', stBy: uid, stAt: t, fin: L.map((l) => ({ pid: l.pid, qty: want.get(l.pid) })), so });
    tx.set(db.collection('sec_log').doc(), logData(uid, 'mgr', 'odOk', { tgt: id, note: String(ds.get('sup') || '').slice(0, 60) + ': ' + L.length + ' מוצרים' }));
    return { st: 'ok', n: L.length, so };
  });
}

module.exports = { daily, list, pendN, decide, idOf, soIdOf, ID_RE, LIM };
