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
//   posCardList({})                              – סבב 2: חיובים בלי מכירה (מנהל / אחראי), מהחדש לישן, + canVoid
// st: 'wait' | 'ok' | 'no' (נדחה) | 'err' (בטוח שלא נשלח) | 'cancel' | 'void' | 'unk' (לא ודאי – ממשיך להיבדק, אצל המנהל) | 'voiding' (ביטול בתהליך)
// מסוף מדומה (mode 'mock') – רק באמולטור או בפרויקט הבדיקה (PV.mockOk). כל חיוב מדומה – mock:true, והמכירה שנקשרה אליו – test:true.

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
  for (const k of ['appr', 'last4', 'brand', 'msg', 'sale', 'mock']) if (r[k] != null) o[k] = r[k];
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

// סבב 2 (ליקוי 3): מצב סופי רק לפי תשובה מפורשת של הספק (FINAL). תקלה, timeout, תשובה לא מוכרת או ביטול שהספק לא אישר → 'unk' (לא ודאי):
// ממשיך להיבדק (posCardStatus), לא נקשר למכירה, ומופיע למנהל עד הכרעה. 'err' – רק כשבטוח שהבקשה לא נשלחה (NOT_SENT).
const FINAL = ['ok', 'no', 'cancel', 'void'];
const OPEN = ['wait', 'unk']; // ממתין להכרעה מהספק
// שגיאה שבה ידוע שלא נשלח כלום לספק: הספק לא מוגדר / ממתין לתיעוד, אין פרטי חיבור, אין מפתח הצפנה
const NOT_SENT = (e) => e instanceof HttpsError && e.code === 'failed-precondition';
// מעדכן רשומה פתוחה (wait / unk) לפי תוצאת הספק. לא דורס מצב סופי. r.st 'wait' – בלי שינוי; 'unk' – מסמן לא ודאי
async function settle(db, ref, r, now) {
  return G.runTx(db, async (tx) => {
    const s = await tx.get(ref);
    const cur = s.data();
    if (!OPEN.includes(cur.st) || r.st === 'wait' || (r.st === 'unk' && cur.st === 'unk')) return cur;
    const fin = FINAL.includes(r.st) || r.st === 'err';
    const upd = Object.assign({ st: r.st, upd: now }, fin ? { doneAt: now } : {}, r.appr ? { appr: r.appr, last4: r.last4 } : {}, r.brand ? { brand: r.brand } : {}, r.msg ? { msg: r.msg } : {});
    tx.update(ref, upd);
    return Object.assign({}, cur, upd);
  });
}
const provErr = (e) => (e instanceof HttpsError ? (e.message || '').slice(0, 120) : 'אין חיבור לספק הסליקה');
// תוצאת ספק → מצב לרשומה: סופי כמו שהוא; 'err' / לא מוכר → 'unk'
const asOpen = (r) => (FINAL.includes(r.st) || r.st === 'wait' ? r : Object.assign({}, r, { st: 'unk', msg: r.msg || 'אין תשובה ודאית מהמסוף' }));

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
  if (mode === 'mock' && !PV.mockOk()) throw bad('mock-prod', 'מסוף מדומה זמין רק בסביבת בדיקה'); // סבב 2 (ליקוי 5)
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
  if (mode === 'mock' && !PV.mockOk()) throw pre('mock-prod', 'מסוף מדומה זמין רק בסביבת בדיקה. פנו למנהל המערכת.'); // סבב 2 (ליקוי 5)
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
    rec = Object.assign({ id, st: 'wait', amt, n: ins.n, tx: ins.tx, ref: input.ref, dev: input.dev, br: d.br || '_', by: who.uid, at: now, upd: now, mode, sale: null }, mode === 'mock' ? { mock: true } : {});
    tx.create(ref, rec);
    made = true;
  });
  if (!made) return Object.assign(pub(id, rec), { dup: true });
  let r;
  try { r = asOpen(PV.clean(await P.start(rec, credLoader(db, who.bizId)))); } catch (e) {
    r = { st: NOT_SENT(e) ? 'err' : 'unk', msg: provErr(e) }; // ליקוי 3: אולי נשלח – לא ודאי
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
  if (!OPEN.includes(rec.st)) return pub(id, rec);
  let r;
  try { r = asOpen(PV.clean(await PV.prov(rec.mode).status(rec, credLoader(db, who.bizId), Date.now()))); } catch (e) {
    return Object.assign(pub(id, rec), { msg: provErr(e) }); // הספק לא ענה – המצב לא משתנה (הקופה מחליטה מתי לבטל)
  }
  if (r.st !== 'wait') rec = await settle(db, ref, r, Date.now());
  return pub(id, rec);
}

// ---------- posCardCancel ----------
// סבב 2 (ליקוי 4, הכרעת המתאם): ביטול – מי שבקופה (pos / posMgr), וגם כל מנהל עסק (role manager) בלי מתג קופה, כמו פעולות הניהול
// בקופה (o.mgr ב-lib/pos-gate.js: "כל מנהל, גם בלי מתג קופה") – כדי שמנהל יוכל לבטל חיוב יתום מ"ניהול מכירה". חיוב שאושר –
// רק מי שחייב, אחראי משמרת או מנהל (canVoid).
const canVoid = (who, role, rec) => who.role === 'manager' || role === 'manager' || role === 'lead' || (!!rec && rec.by === who.uid);
async function cancelIn(request) {
  const input = inputObject(request);
  const { who, role, db } = await G.gate(request);
  if (!role && who.role !== 'manager') throw deny('not-pos', 'אין לך הרשאת קופה');
  keysOk(input, ['id']);
  const id = idIn(input.id), ref = db.doc('poscard/' + id);
  const s = await ref.get();
  if (!s.exists) throw nf('no-card-tx', 'העסקה לא נמצאה');
  let rec = s.data();
  const P = PV.prov(rec.mode);
  const cred = credLoader(db, who.bizId);
  const now = Date.now();
  if (OPEN.includes(rec.st)) {
    // ליקוי 3: רק "בוטל" מפורש מהספק = cancel. תשובה אחרת / תקלה → 'unk' (נשאר אצל המנהל)
    let r;
    try { r = asOpen(PV.clean(await P.cancel(rec, cred, now))); } catch (e) { r = { st: 'unk', msg: provErr(e) }; }
    if (r.st === 'wait') r = { st: 'unk', msg: 'הביטול לא אושר במסוף' };
    rec = await settle(db, ref, r, now);
    if (rec.st !== 'ok') { await logIt(db, who, 'cardCancel', rec); return pub(id, rec); }
  }
  if (rec.st === 'ok') {
    if (rec.sale) throw pre('card-in-sale', 'החיוב כבר שייך למכירה ' + rec.sale + ' – ביטול דרך החזרה');
    if (!canVoid(who, role, rec)) throw deny('not-lead', 'ביטול חיוב שאושר – רק מי שחייב, אחראי משמרת או מנהל');
    // ליקוי 1: קודם 'voiding' בטרנזקציה (posSale מקבל רק 'ok' בדיוק, וביטול מקביל לא מבצע החזר שני), ורק אחר כך ההחזר אצל הספק
    const claimed = await G.runTx(db, async (tx) => {
      const x = (await tx.get(ref)).data();
      if (x.sale) throw pre('card-in-sale', 'החיוב כבר שייך למכירה ' + x.sale + ' – ביטול דרך החזרה');
      if (x.st !== 'ok') return null;
      tx.update(ref, { st: 'voiding', upd: Date.now(), voidBy: who.uid });
      return true;
    });
    if (!claimed) return pub(id, (await ref.get()).data()); // מישהו אחר כבר מבטל / ביטל
    let r, sent = true;
    try { r = PV.clean(await P.refund(rec, cred)); } catch (e) { sent = !NOT_SENT(e); r = { st: 'err', msg: provErr(e) }; }
    // הצלחה → void. כשל ודאי (לא נשלח / הספק ענה שלא) → חזרה ל-'ok'. תקלה באמצע → 'unk' (לא ידוע אם הוחזר)
    const nx = r.st === 'void' ? { st: 'void', voidAt: Date.now() } : (!sent || (r.st !== 'err' && r.st !== 'wait')) ? { st: 'ok' } : { st: 'unk', msg: 'לא ידוע אם הביטול בוצע – בדקו במסוף' };
    rec = await G.runTx(db, async (tx) => {
      const x = (await tx.get(ref)).data();
      if (x.st !== 'voiding') return x;
      const upd = Object.assign({ upd: Date.now() }, nx);
      tx.update(ref, upd);
      return Object.assign({}, x, upd);
    });
    await logIt(db, who, rec.st === 'void' ? 'cardVoid' : 'cardVoidFail', rec);
    if (rec.st === 'ok') throw pre('void-fail', 'ביטול החיוב נכשל' + (r.msg ? ' (' + r.msg + ')' : '') + '. בטלו במסוף.');
    return pub(id, rec);
  }
  return pub(id, rec); // כבר סופית (נדחתה / בוטלה) או בתהליך ביטול – אין מה לבטל
}

// ---------- posCardList (סבב 2, ליקוי 2) – חיובים בלי מכירה, למנהל / אחראי ----------
// שאילתה מסוננת בשרת: sale == null ו-st באחד המצבים הפתוחים, מהחדש לישן (אינדקס ב-firestore.indexes.json). חיוב 'ok' או ממתין
// מוצג רק אחרי AGE_MS (כדי לא לבטל חיוב של מכירה שבדרך); 'unk' ו-'voiding' – מיד.
const LIST_ST = ['ok', 'wait', 'unk', 'voiding'];
const AGE_MS = 120000;
async function listIn(request) {
  const input = inputObject(request);
  const { who, role, db } = await G.gate(request);
  if (who.role !== 'manager' && role !== 'lead') throw deny('not-lead', 'הרשימה זמינה לאחראי משמרת או למנהל');
  keysOk(input, []);
  const q = await db.collection('poscard').where('sale', '==', null).where('st', 'in', LIST_ST).orderBy('at', 'desc').limit(200).get();
  const now = Date.now();
  const list = q.docs.map((d) => d.data()).filter((x) => x.st === 'unk' || x.st === 'voiding' || (x.at || 0) <= now - AGE_MS)
    .map((x) => Object.assign(pub(x.id, x), { dev: x.dev, at: x.at, by: x.by }, x.mock ? { mock: true } : {}));
  return { list, canVoid: canVoid(who, role, null), more: q.size >= 200 };
}
async function logIt(db, who, k, rec) {
  try { await db.collection('poslog').add({ k, by: who.uid, dev: rec.dev, at: Date.now(), amt: rec.amt, card: rec.id, note: rec.st }); } catch (e) { /* יומן בלבד */ }
}

const FNS = { posCardCfg: cfgIn, posCardStart: startIn, posCardStatus: statusIn, posCardCancel: cancelIn, posCardList: listIn };
for (const [n, f] of Object.entries(FNS)) exports[n] = onCall({ secrets: [CARD_ENC_KEY] }, G.wrap(n, f));
Object.defineProperty(exports, '_core', { enumerable: false, value: {
  AMT_MAX, ID_RE, FINAL, OPEN, asOpen, amtOf, instOf, modeOf, credOf, credFull, pub, PV,
  call: Object.fromEntries(Object.entries(FNS).map(([n, f]) => [n, () => G.wrap(n, f)])),
} });
