'use strict';
// קופה גל 3 (19.11.2026): אשראי במסוף מחובר – כל המסלול דרך השרת. הספק מופשט (lib/pos-card-prov.js): מסוף מדומה (mock) עכשיו,
// CardCom – אחרי שיגיע תיעוד (היום כל פעולה שלו זורקת "ממתין לתיעוד").
//
// כללי ברזל:
//   • האפליקציה והשרת לא רואים מספר כרטיס לעולם. נשמרים רק: סכום, מצב, מספר אישור, 4 ספרות אחרונות, סוג כרטיס, מספר תשלומים.
//   • פרטי החיבור לספק (מספר מסוף, שם משתמש, סיסמה) – מוצפנים ב-private/posCard (CARD.seal עם CARD_ENC_KEY, AAD 'private/posCard',
//     מפתח נפרד לכל עסק). ב-poscfg/card רק { on, mode }. הערכים לא מוחזרים לאפליקציה ולא מופיעים בשום שגיאה או יומן.
//   • כל עסקה – poscard/{dev}_{ref}. ref ייחודי לכל ניסיון חיוב, ולכן קריאה חוזרת עם אותו ref מחזירה את אותה עסקה (אין חיוב כפול).
//   • חיוב שאושר נקשר למכירה רק בתוך posSale (pos-sale.js: תשלום card עם cardTx) – בטרנזקציה של המכירה, פעם אחת (poscard.sale).
//     חיוב מאושר בלי מכירה (sale: null) מופיע למנהל ב"ניהול מכירה ← דוחות" (pos-admin-sale.js).
//
// פונקציות (onCall):
//   posCardCfg({ op:'get' })                                  – מנהל־על: { mode, on, saved, at }
//   posCardCfg({ op:'set', mode:'off'|'mock'|'cardcom', cred? }) – מנהל־על. cred: undefined = בלי שינוי, null = מחיקה,
//                                                                { term?, user?, pass? } = שמירה (משולב עם הקיים)
//   posCardStart({ dev, inst, amt, n?, ref })   – קופאי במכשיר מאושר. inst = מזהה ההתקנה (כמו בכל פונקציות הקופה), n = מספר תשלומים (1 = רגילה)
//   posCardStatus({ id })                        – מצב העסקה (הקופה שואלת כל 1–2 שניות)
//   posCardCancel({ id })                        – ממתינה → ביטול. מאושרת שעוד לא שייכת למכירה → ביטול החיוב אצל הספק (void):
//                                                  רק מי שהתחיל אותה, או אחראי משמרת / מנהל.
// st: 'wait' | 'ok' | 'no' (נדחה) | 'err' | 'cancel' | 'void'

const { HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { onCall } = require('./lib/region');
const { inputObject } = require('./lib/roles');
const G = require('./lib/pos-gate');
const K = require('./lib/pos-core');
const CARD = require('./lib/card');
const PV = require('./lib/pos-card-prov');

const CARD_ENC_KEY = defineSecret('CARD_ENC_KEY');
const CRED = 'private/posCard';
const CFG = 'poscfg/card';
const AMT_MAX = 5000000; // 50,000 ₪ – תקרה לעסקה אחת במסוף
const ID_RE = /^K[1-9][0-9]{0,3}_[A-Za-z0-9_-]{6,64}$/;
const CTRL = /[\u0000-\u001f\u007f]/;
const { bad, pre, deny, nf } = G;
const keysOk = (o, ks) => { for (const k of Object.keys(o)) if (!ks.includes(k)) throw bad('bad-input', 'קלט לא תקין: ' + String(k).slice(0, 20)); };

// ---------- ולידציה (טהורה; נבדקת ב-tests/pos-card.unit.test.js) ----------
function amtOf(v) {
  if (!Number.isInteger(v) || v <= 0 || v > AMT_MAX) throw bad('bad-amt', `סכום לא תקין לאשראי במסוף (עד ${AMT_MAX / 100} ₪)`);
  return v;
}
// מספר תשלומים: 1 = רגילה. 2..instMax רק אם 'inst' מותר בעסק ומעל instMinAmt (כמו posSale)
function instOf(n, amt, cfg) {
  if (n == null || n === 1) return { n: 1, tx: 'reg' };
  const types = Array.isArray(cfg.txTypes) ? cfg.txTypes : ['reg'];
  if (!types.includes('inst')) throw pre('bad-tx', 'עסקת תשלומים לא מותרת בעסק');
  if (!Number.isInteger(n) || n < 2 || n > (cfg.instMax || 1)) throw pre('bad-inst', 'מספר תשלומים לא מותר');
  if (Number.isInteger(cfg.instMinAmt) && amt < cfg.instMinAmt) throw pre('bad-inst', 'הסכום נמוך מהמינימום לתשלומים');
  return { n, tx: 'inst' };
}
function modeOf(v) {
  if (!PV.MODES.includes(v)) throw bad('bad-mode', 'מצב: כבוי, מסוף מדומה או CardCom');
  return v;
}
// פרטי חיבור: undefined = בלי שינוי, null = מחיקה, אובייקט = שמירה. ההודעות בלי הערכים
function credOf(v) {
  if (v === undefined || v === null) return v;
  const e = () => bad('bad-cred', 'פרטי חיבור לא תקינים: מספר מסוף – ספרות בלבד (עד 20), שם משתמש עד 120 תווים, סיסמה עד 200 תווים, בלי תווים מיוחדים');
  if (typeof v !== 'object' || Array.isArray(v)) throw e();
  const o = {};
  for (const [k, x] of Object.entries(v)) {
    if (!['term', 'user', 'pass'].includes(k)) throw e();
    if (x == null || x === '') continue;
    if (typeof x !== 'string' || CTRL.test(x)) throw e();
    if (k === 'term') { const t = x.trim(); if (!/^[0-9]{1,20}$/.test(t)) throw e(); o.term = t; }
    if (k === 'user') { const t = x.trim(); if (!t || t.length > 120) throw e(); o.user = t; }
    if (k === 'pass') { if (x.length > 200) throw e(); o.pass = x; }
  }
  if (!Object.keys(o).length) return undefined; // טופס ריק = בלי שינוי
  return o;
}
const credFull = (c) => !!(c && c.term && c.user && c.pass);
// מה שהקופה רואה – בלי pid ובלי שום פרט של הספק
function pub(id, r) {
  const o = { id, st: r.st, amt: r.amt, n: r.n || 1, tx: r.tx || 'reg' };
  for (const k of ['appr', 'last4', 'brand', 'msg', 'sale']) if (r[k] != null) o[k] = r[k];
  return o;
}

// ---------- מכשיר והגדרות ----------
async function devChk(db, dev, inst) {
  const SC = require('./pos-sale')._core;
  const [s, cfg] = await Promise.all([db.doc('posdev/' + dev).get(), SC.cfgOf(db)]);
  if (!s.exists) throw nf('no-dev', 'הקופה לא נמצאה');
  const d = s.data();
  if (d.st === 'retired') throw pre('retired', 'הקופה הוצאה משימוש');
  if (d.on !== true) throw pre('dev-off', 'הקופה מושבתת');
  if (!d.inst || d.inst !== inst) throw pre('dev-taken', 'המכשיר לא רשום על הקופה הזו');
  if (cfg.devApprove !== false && !d.appr) throw pre('dev-unapproved', 'המכשיר מחכה לאישור מנהל');
  if (Array.isArray(cfg.payOn) && !cfg.payOn.includes('card')) throw pre('pay-off', 'אשראי לא פעיל בעסק');
  return { d, cfg };
}
async function modeNow(db) {
  const s = await db.doc(CFG).get();
  const m = s.exists && s.get('on') === true ? s.get('mode') : 'off';
  return PV.MODES.includes(m) ? m : 'off';
}
// פרטי החיבור – רק כשהספק באמת צריך אותם (mock לא קורא לזה)
const credLoader = (db, bizId) => async () => {
  const s = await db.doc(CRED).get();
  if (!s.exists || !s.get('box')) throw pre('no-cred', 'פרטי החיבור לספק הסליקה חסרים. פנו למנהל המערכת.');
  return CARD.open(CARD_ENC_KEY.value(), bizId, CRED, s.get('box'));
};
const idIn = (v) => { if (typeof v !== 'string' || !ID_RE.test(v)) throw bad('bad-id', 'מזהה עסקה לא תקין'); return v; };

// מעדכן רשומה ממתינה לפי תוצאת הספק – רק אם היא עדיין במצב 'wait' (אין דריסה של תוצאה סופית)
async function settle(db, ref, r, now) {
  return G.runTx(db, async (tx) => {
    const s = await tx.get(ref);
    const cur = s.data();
    if (cur.st !== 'wait' || r.st === 'wait') return cur;
    const upd = Object.assign({ st: r.st, upd: now, doneAt: now }, r.appr ? { appr: r.appr, last4: r.last4 } : {}, r.brand ? { brand: r.brand } : {}, r.msg ? { msg: r.msg } : {});
    tx.update(ref, upd);
    return Object.assign({}, cur, upd);
  });
}
const provErr = (e) => (e instanceof HttpsError ? (e.message || '').slice(0, 120) : 'אין חיבור לספק הסליקה');

// ---------- posCardCfg (מנהל־על) ----------
async function cfgIn(request) {
  const { who, db } = await G.gate(request);
  if (!who.superadmin) throw deny('not-superadmin', 'הפעולה מותרת למנהל המערכת בלבד');
  const input = inputObject(request);
  keysOk(input, ['op', 'mode', 'cred']);
  const [c, k] = await Promise.all([db.doc(CFG).get(), db.doc(CRED).get()]);
  if (input.op === 'get' || (input.op == null && input.mode === undefined)) {
    return { mode: c.exists && PV.MODES.includes(c.get('mode')) ? c.get('mode') : 'off', on: c.exists && c.get('on') === true, saved: k.exists && !!k.get('box'), at: (k.exists && k.get('at')) || null };
  }
  if (input.op != null && input.op !== 'set') throw bad('bad-op', 'פעולה לא מוכרת');
  const mode = modeOf(input.mode);
  const cred = credOf(input.cred);
  let box = null, del = false, full = k.exists && !!k.get('box');
  if (cred === null) { del = k.exists; full = false; } else if (cred) {
    let old = {};
    if (k.exists && k.get('box')) { try { old = CARD.open(CARD_ENC_KEY.value(), who.bizId, CRED, k.get('box')) || {}; } catch (e) { if (e && e.details && e.details.reason === 'no-card-key') throw e; old = {}; } }
    const v = Object.assign({}, old, cred);
    const o = { term: v.term || '', user: v.user || '', pass: v.pass || '' };
    box = CARD.seal(CARD_ENC_KEY.value(), who.bizId, CRED, o); // לפני הכתיבה: מפתח חסר → שום דבר לא נשמר
    full = credFull(o);
  }
  if (mode === 'cardcom' && !full) throw bad('need-cred', 'למצב CardCom צריך מספר מסוף, שם משתמש וסיסמה');
  const now = Date.now();
  const b = db.batch();
  if (box) b.set(db.doc(CRED), { box, at: now, by: who.uid });
  else if (del) b.delete(db.doc(CRED));
  b.set(db.doc(CFG), { on: mode !== 'off', mode, upd: now });
  b.set(db.collection('poslog').doc(), { k: 'cardCfg', by: who.uid, at: now, note: mode + (box ? ' cred:set' : del ? ' cred:del' : '') });
  await b.commit();
  return { ok: true, mode, on: mode !== 'off', saved: !!box || (full && !del) };
}

// ---------- posCardStart ----------
async function startIn(request) {
  const input = inputObject(request);
  const { who, db } = await G.gate(request, { sell: true });
  keysOk(input, ['dev', 'inst', 'amt', 'n', 'ref']);
  if (K.isPractice(input.dev) || K.isPractice(input.ref)) throw bad('practice', 'מצב תרגול – אשראי במסוף לא זמין');
  if (!K.isDev(input.dev)) throw bad('bad-dev', 'קוד קופה לא תקין');
  if (!K.isInst(input.inst)) throw bad('bad-inst', 'מזהה מכשיר לא תקין');
  if (!K.isReq(input.ref)) throw bad('bad-ref', 'מזהה ניסיון לא תקין');
  const amt = amtOf(input.amt);
  const mode = await modeNow(db);
  const P = PV.prov(mode); // כבוי → card-off
  const { d, cfg } = await devChk(db, input.dev, input.inst);
  const ins = instOf(input.n, amt, cfg);
  const id = input.dev + '_' + input.ref, ref = db.doc('poscard/' + id);
  const now = Date.now();
  let made = false, rec;
  await G.runTx(db, async (tx) => {
    made = false;
    const s = await tx.get(ref);
    if (s.exists) {
      rec = s.data();
      if (rec.amt !== amt || (rec.n || 1) !== ins.n) throw pre('ref-used', 'מזהה הניסיון כבר שימש לחיוב אחר');
      return;
    }
    rec = { id, st: 'wait', amt, n: ins.n, tx: ins.tx, ref: input.ref, dev: input.dev, br: d.br || '_', by: who.uid, at: now, upd: now, mode, sale: null };
    tx.create(ref, rec);
    made = true;
  });
  if (!made) return Object.assign(pub(id, rec), { dup: true });
  let r;
  try { r = PV.clean(await P.start(rec, credLoader(db, who.bizId))); } catch (e) {
    r = { st: 'err', msg: provErr(e) };
  }
  const upd = Object.assign({ upd: Date.now() }, r.pid ? { pid: r.pid } : {});
  await ref.update(upd);
  rec = Object.assign(rec, upd);
  if (r.st !== 'wait') rec = await settle(db, ref, r, Date.now());
  return pub(id, rec);
}

// ---------- posCardStatus ----------
async function statusIn(request) {
  const input = inputObject(request);
  const { who, db } = await G.gate(request, { sell: true });
  keysOk(input, ['id']);
  const id = idIn(input.id), ref = db.doc('poscard/' + id);
  const s = await ref.get();
  if (!s.exists) throw nf('no-card-tx', 'העסקה לא נמצאה');
  let rec = s.data();
  if (rec.st !== 'wait') return pub(id, rec);
  let r;
  try { r = PV.clean(await PV.prov(rec.mode).status(rec, credLoader(db, who.bizId), Date.now())); } catch (e) {
    return Object.assign(pub(id, rec), { msg: provErr(e) }); // הספק לא ענה – נשארת ממתינה (הקופה מחליטה מתי לבטל)
  }
  if (r.st !== 'wait') rec = await settle(db, ref, r, Date.now());
  return pub(id, rec);
}

// ---------- posCardCancel ----------
async function cancelIn(request) {
  const input = inputObject(request);
  const { who, role, db } = await G.gate(request, { sell: true });
  keysOk(input, ['id']);
  const id = idIn(input.id), ref = db.doc('poscard/' + id);
  const s = await ref.get();
  if (!s.exists) throw nf('no-card-tx', 'העסקה לא נמצאה');
  let rec = s.data();
  const P = PV.prov(rec.mode);
  const cred = credLoader(db, who.bizId);
  const now = Date.now();
  if (rec.st === 'wait') {
    const r = PV.clean(await P.cancel(rec, cred, now)); // שגיאת ספק → השגיאה לקופה, העסקה נשארת ממתינה
    rec = await settle(db, ref, r.st === 'wait' ? { st: 'cancel' } : r, now);
    if (rec.st !== 'ok') { await logIt(db, who, 'cardCancel', rec); return pub(id, rec); }
  }
  if (rec.st === 'ok') {
    if (rec.sale) throw pre('card-in-sale', 'החיוב כבר שייך למכירה ' + rec.sale + ' – ביטול דרך החזרה');
    if (rec.by !== who.uid && role !== 'manager' && role !== 'lead') throw deny('not-lead', 'ביטול חיוב שאושר – רק מי שחייב, אחראי משמרת או מנהל');
    const r = PV.clean(await P.refund(rec, cred));
    if (r.st !== 'void') throw pre('void-fail', 'ביטול החיוב נכשל. בטלו במסוף.');
    rec = await G.runTx(db, async (tx) => {
      const x = (await tx.get(ref)).data();
      if (x.st !== 'ok') return x;
      if (x.sale) throw pre('card-in-sale', 'החיוב כבר שייך למכירה ' + x.sale + ' – ביטול דרך החזרה');
      const upd = { st: 'void', upd: Date.now(), voidAt: Date.now(), voidBy: who.uid };
      tx.update(ref, upd);
      return Object.assign({}, x, upd);
    });
    await logIt(db, who, 'cardVoid', rec);
    return pub(id, rec);
  }
  return pub(id, rec); // כבר סופית (נדחתה / בוטלה) – אין מה לבטל
}
async function logIt(db, who, k, rec) {
  try { await db.collection('poslog').add({ k, by: who.uid, dev: rec.dev, at: Date.now(), amt: rec.amt, card: rec.id, note: rec.st }); } catch (e) { /* יומן בלבד */ }
}

const FNS = { posCardCfg: cfgIn, posCardStart: startIn, posCardStatus: statusIn, posCardCancel: cancelIn };
for (const [n, f] of Object.entries(FNS)) exports[n] = onCall({ secrets: [CARD_ENC_KEY] }, G.wrap(n, f));
Object.defineProperty(exports, '_core', { enumerable: false, value: {
  AMT_MAX, ID_RE, amtOf, instOf, modeOf, credOf, credFull, pub, PV,
  call: Object.fromEntries(Object.entries(FNS).map(([n, f]) => [n, () => G.wrap(n, f)])),
} });
