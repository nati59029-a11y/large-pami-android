'use strict';
// קופה (POS), ש5 – עובדים ו-PIN, ואישור אחראי. posAuth({ op, … }). אוסף pospin/{uid} = { h, s, fails, lockUntil, upd, setAt, setBy } – אף אחד לא קורא מהאפליקציה.
//
//   op 'list'                       → { staff: [{ uid, name, role, hasPin, locked, wait }] } – מנהל: עובדי הקופה ומצב הקוד.
//   op 'leads'                      → { staff: [{ uid, name, role, locked }] } – POS:W2, כל מי שבקופה: מי יכול לאשר (אחראי / מנהל עם קוד).
//   op 'set',    { pin, old? }      → { ok } – העובד קובע את הקוד שלו. כבר יש קוד – חייב old (ניסיון שגוי נספר לנעילה).
//   op 'reset',  { uid }            → { ok } – איפוס קוד (ושחרור נעילה) – רק לבעלים (מנהל העסק / מנהל־על). נרשם ב-poslog.
//   op 'verify', { uid?, pin, dev? } → { ok, uid, name, role } – כניסה / החלפת קופאי במסך הקופה. ברירת מחדל: הקוד של המתחבר.
//   op 'approve',{ by, pin, act, pct?, amt?, ref?, dev?, need? }   (need:'manager' – POS:W2: הקופה דורשת מנהל; רק מעלה)
//                                   → { ok, ap, by, name, role, need } – אישור אחראי. by = מי שמאשר (ה-PIN שלו).
//     act 'disc' – הנחה באחוזים (pct): עד discMax.cashier – בלי אישור; אחראי משמרת – עד 10% (ולא יותר מ-discMax.lead); מעל זה – מנהל.
//     act 'void' | 'ret' | 'price' | 'drawer' – אחראי משמרת או מנהל.
//     האישור נרשם ב-poslog/{ap} (k:'appr'); ש2 מצרף את ap למכירה.
// אחרי 5 קודים שגויים ברצף – נעילה ל-30 שניות והתראה למנהל (poslog k:'pin-lock' + הודעה לטלפון).
// שגיאות (details.reason): bad-op, bad-input, bad-pin, weak-pin, no-pin, pin-locked, not-owner, not-manager, not-pos, no-user, bad-act,
//   bad-disc, need-manager, need-lead, legacy, feature-off.

const { onCall } = require('./lib/region');
const { inputObject } = require('./lib/roles');
const CF = require('./lib/pos-cfg');
const AG = require('./lib/pos-agg');
const G = require('./lib/pos-gate');

const ACTS = ['disc', 'void', 'ret', 'price', 'drawer'];

async function auth(request) {
  const input = inputObject(request);
  const op = input.op;
  if (!['list', 'leads', 'set', 'reset', 'verify', 'approve'].includes(op)) throw G.bad('bad-op', 'פעולה לא מוכרת');
  if (op === 'list') return list(request);
  if (op === 'leads') return leads(request);
  if (op === 'reset') return reset(request, input);
  if (op === 'set') return setPin(request, input);
  if (op === 'verify') return verify(request, input);
  return approve(request, input);
}

async function list(request) {
  const { db } = await G.gate(request, { mgr: true });
  return { ok: true, staff: await staffOf(db) };
}
// POS:W2 – חלון האישור בקופה: מי יכול לאשר (אחראי משמרת / מנהל עם קוד). כל מי שבקופה – בלי פרטי הקוד, רק שם ותפקיד
async function leads(request) {
  const { db } = await G.gate(request, { sell: true });
  const all = await staffOf(db);
  return { ok: true, staff: all.filter((x) => (x.role === 'manager' || x.role === 'lead') && x.hasPin).map((x) => ({ uid: x.uid, name: x.name, role: x.role, locked: x.locked })) };
}
async function staffOf(db) {
  const [st, ad, pins] = await Promise.all([db.collection('staff').limit(500).get(), db.collection('admins').limit(100).get(), db.collection('pospin').limit(600).get()]);
  const pm = new Map(pins.docs.map((d) => [d.id, d.data()]));
  const now = Date.now();
  const adm = new Map(ad.docs.map((d) => [d.id, d])); // 18.11.2026: מנהל בקופה רק לפי admins/{uid}.perms (pos / posMgr, מנהל־על מדליק)
  const out = [];
  for (const d of st.docs) {
    if (d.get('active') !== true) continue;
    const role = adm.has(d.id) ? G.roleOf({ role: 'manager', admin: adm.get(d.id) }) : G.roleOf({ role: 'employee', staff: d });
    if (!role) continue;
    const p = pm.get(d.id), ls = AG.lockState(p, now);
    out.push({ uid: d.id, name: d.get('name') || '', role, hasPin: !!(p && p.h), locked: ls.locked, wait: ls.wait });
  }
  for (const [u, a] of adm) {
    if (out.some((x) => x.uid === u)) continue;
    const role = G.roleOf({ role: 'manager', admin: a });
    if (!role) continue;
    const p = pm.get(u), ls = AG.lockState(p, now);
    out.push({ uid: u, name: '', role, hasPin: !!(p && p.h), locked: ls.locked, wait: ls.wait });
  }
  out.sort((a, b) => String(a.name).localeCompare(String(b.name), 'he'));
  return out;
}

async function setPin(request, input) {
  // 18.11.2026: כל מנהל קובע לעצמו קוד גם בלי מתג קופה (קוד הבעלים משמש גם לאישור שינויי הגדרות – pos-pin.verifyOwner); עובד – רק עם pos / posMgr
  const { who, db, role } = await G.gate(request, {});
  if (!role && who.role !== 'manager') throw G.deny('not-pos', 'אין לך הרשאת קופה');
  try { AG.pinCheckNew(input.pin); } catch (e) { throw G.aggErr(e); }
  const now = Date.now();
  let r = null;
  await G.runTx(db, async (tx) => {
    r = null;
    const s = await tx.get(db.doc('pospin/' + who.uid));
    if (s.exists && s.get('h')) {
      if (typeof input.old !== 'string') throw G.bad('bad-input', 'כתבו את הקוד הנוכחי');
      r = await G.pinTx(tx, db, who.uid, input.old, now);
      G.pinWrite(tx, db, r, who, who.uid, now);
      if (!r.ok) return;
    }
    const h = AG.pinHash(input.pin);
    tx.set(db.doc('pospin/' + who.uid), { h: h.h, s: h.s, fails: 0, lockUntil: 0, upd: now, setAt: now, setBy: who.uid });
  });
  if (r && !r.ok) { await G.pinAlert(db, who, who.uid, r); G.pinThrow(r); }
  return { ok: true };
}

// איפוס – רק לבעלים: מנהל העסק (admins) או מנהל־על. אחראי משמרת – לא.
async function reset(request, input) {
  const { who, db } = await G.gate(request, {});
  if (who.role !== 'manager') throw G.deny('not-owner', 'איפוס קוד – רק לבעלים');
  if (typeof input.uid !== 'string' || !G.UID_RE.test(input.uid)) throw G.bad('bad-input', 'עובד לא תקין');
  const now = Date.now();
  await G.runTx(db, async (tx) => {
    tx.set(db.doc('pospin/' + input.uid), { h: null, s: null, fails: 0, lockUntil: 0, upd: now, resetAt: now, resetBy: who.uid });
    tx.set(db.collection('poslog').doc(), { k: 'pin-reset', uid: input.uid, by: who.uid, at: now });
  });
  return { ok: true };
}

async function verify(request, input) {
  const { who, db } = await G.gate(request, { sell: true });
  const uid = input.uid == null ? who.uid : input.uid;
  if (typeof uid !== 'string' || !G.UID_RE.test(uid)) throw G.bad('bad-input', 'עובד לא תקין');
  if (typeof input.pin !== 'string') throw G.bad('bad-pin', 'כתבו קוד');
  const x = await G.roleOfUid(db, uid);
  if (!x.role) throw G.nf('no-user', 'העובד לא נמצא או שאין לו הרשאת קופה');
  const dev = G.K.isDev(input.dev) ? input.dev : null;
  const now = Date.now();
  let r;
  await G.runTx(db, async (tx) => { r = await G.pinTx(tx, db, uid, input.pin, now); G.pinWrite(tx, db, r, who, uid, now, dev); });
  await G.pinAlert(db, who, uid, r);
  G.pinThrow(r);
  return { ok: true, uid, name: x.name, role: x.role };
}

async function approve(request, input) {
  const { who, db } = await G.gate(request, { sell: true });
  if (!ACTS.includes(input.act)) throw G.bad('bad-act', 'סוג אישור לא מוכר');
  if (typeof input.by !== 'string' || !G.UID_RE.test(input.by)) throw G.bad('bad-input', 'בחרו מי מאשר');
  if (typeof input.pin !== 'string') throw G.bad('bad-pin', 'כתבו קוד');
  let need = 'lead';
  if (input.act === 'disc') {
    const cfg = await require('./lib/pos-cfg-read').cfgOf(db); // POS:W2: לפי הסכמה של ש4
    try { need = AG.discNeed(input.pct, cfg); } catch (e) { throw G.aggErr(e); }
    if (need === null && input.need !== 'manager') return { ok: true, ap: null, need: null };
  }
  // POS:W2: הקופה מבקשת אישור מנהל במפורש (מתחת למחיר מינימום, החזרה מעל retMgrAbove) – רק מעלה את הדרישה, אף פעם לא מורידה
  if (input.need === 'manager') need = 'manager';
  const x = await G.roleOfUid(db, input.by);
  if (!x.role) throw G.nf('no-user', 'העובד המאשר לא נמצא');
  if (!AG.canApprove(x.role, need)) throw G.deny(need === 'manager' ? 'need-manager' : 'need-lead', need === 'manager' ? 'נדרש אישור מנהל' : 'נדרש אישור אחראי משמרת');
  const dev = G.K.isDev(input.dev) ? input.dev : null;
  const now = Date.now();
  let r, ap = null;
  await G.runTx(db, async (tx) => {
    r = await G.pinTx(tx, db, input.by, input.pin, now);
    G.pinWrite(tx, db, r, who, input.by, now, dev);
    if (!r.ok) return;
    const ref = db.collection('poslog').doc();
    ap = ref.id;
    // POS:W2 (סבב 2): האישור קשור למה שאושר – pct (הנחה), amt (סכום החזרה באגורות) ו-ref (השורה / העגלה / המכירה). posSale / posReturn דוחים חריגה
    const amt = input.act === 'ret' && Number.isInteger(input.amt) && input.amt >= 0 && input.amt <= 1e9 ? input.amt : null;
    tx.set(ref, { k: 'appr', act: input.act, pct: input.act === 'disc' ? input.pct : null, amt, ref: G.str(input.ref, 80) || null, by: input.by, role: x.role, need, for: who.uid, dev, at: now, used: false });
  });
  await G.pinAlert(db, who, input.by, r);
  G.pinThrow(r);
  return { ok: true, ap, by: input.by, name: x.name, role: x.role, need };
}

exports.posAuth = onCall(G.wrap('posAuth', auth));
Object.defineProperty(exports, '_core', { enumerable: false, value: { auth, call: () => G.wrap('posAuth', auth) } });
