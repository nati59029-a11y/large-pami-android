'use strict';
// המזכירה העסקית – שלב 1 (2026-11-11): functions/secretary.js + חוקי sec_* (בשורש ובתוך b/{bizId}). רץ מול האמולטור, חלק מ-test:multibiz.
// קריטריון השלב (אפיון סעיף 12, שלב 1): עובד ועסק אחר נחסמים בכל פונקציה ובכל אוסף; מנהל־על נחסם בקריאה ישירה של sec_chat,
// וקריאה דרך secAdminReadChat נרשמת ב-sec_log; "מנהל ראשי בלבד" נאכף בשרת; תוספת כבויה = הפונקציות נדחות; אין שימוש לפני הסכמה;
// גיבוי מתוזמן מגבה את כל sec_* ושחזור מחזיר אותם.
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fsm = require('node:fs');
const path = require('node:path');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const H = require('./helpers');

const A = 'biz-s', B = 'biz-t', BZ0 = 'largpeami';
const M1 = 's_m1', M2 = 's_m2', E1 = 's_e1', SUPER = 's_super', SUPADM = 's_supadm', MB = 's_mb', LM = 's_lm', LE = 's_le';
const FN_EMU = JSON.parse(fsm.readFileSync(path.join(H.ROOT, 'firebase.json'), 'utf8')).emulators.functions;
const fnUrl = (n) => `http://${process.env.FUNCTIONS_EMULATOR_HOST || `${FN_EMU.host}:${FN_EMU.port}`}/${H.PROJECT_ID}/us-central1/${n}`;
async function call(name, uid, data) {
  const headers = { 'Content-Type': 'application/json' };
  if (uid) headers.Authorization = 'Bearer ' + H.mockToken(uid);
  const r = await fetch(fnUrl(name), { method: 'POST', headers, body: JSON.stringify({ data: data || {} }) });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (e) { /* */ }
  return { status: j && j.error ? j.error.status : (r.ok ? 'OK' : 'HTTP_' + r.status), reason: j && j.error && j.error.details && j.error.details.reason, result: j && j.result, text };
}
let env, SEC;
const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
const db = (u) => env.authenticatedContext(u, { email: u + '@example.invalid' }).firestore();
async function get(p) { let v = null; await prep(async (d) => { const s = await d.doc(p).get(); v = s.exists ? s.data() : null; }); return v; }
async function coll(p) { let v = []; await prep(async (d) => { v = (await d.collection(p).get()).docs.map((x) => Object.assign({ id: x.id }, x.data())); }); return v; }
async function setDoc(p, data) { await prep((d) => d.doc(p).set(data)); }
const MGR_FNS = ['secState', 'secConsent', 'secSetup'];
const SA_FNS = ['secAdminGet', 'secAdminSetCfg', 'secAdminReadChat'];
const ALL_FNS = MGR_FNS.concat(SA_FNS);
// כל אוספי sec_* (מסמך לדוגמה בכל אחד) – לבדיקת חסימה ברמת החוקים
const SAMPLE = ['sec_cfg/main', 'sec_cfg/cap', 'sec_chat/' + M1 + '/m/x1', 'sec_in/i1', 'sec_draft/d1', 'sec_inv/v1', 'sec_inv/v1/p/0', 'sec_facts/f1', 'sec_rules/r1', 'sec_cal/c1', 'sec_mirror/m', 'sec_rep/r1', 'sec_log/l1', 'sec_usage/2026-11', 'sec_facts_sensitive/s1', 'sec_note/' + M1 + '/n/x1', 'sec_snd/972500000001']; // sec_snd – שלב 5 (כרטיס שולח בווצאפ; שרת בלבד)
const CONSENTED = (ver) => ({ cv: ver, ca: 1 });

async function seed(o) {
  const opt = Object.assign({ featA: true, featB: true, consent: [], cfg: null }, o);
  await env.clearFirestore();
  const ver = SEC.CONSENT_VER;
  await prep(async (d) => {
    const b = d.batch();
    b.set(d.doc('superadmins/' + SUPER), {});
    b.set(d.doc('superadmins/' + SUPADM), {});
    for (const [id, f] of [[A, opt.featA], [B, opt.featB]]) {
      b.set(d.doc('b/' + id), { name: id, status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: SUPER, features: { tasks: true, secretary: f } });
    }
    for (const u of [M1, M2, SUPADM]) { b.set(d.doc(`b/${A}/admins/${u}`), { email: u + '@x.invalid' }); b.set(d.doc(`b/${A}/staff/${u}`), { name: u, role: 'manager', active: true }); }
    b.set(d.doc(`b/${A}/staff/${E1}`), { name: E1, role: 'employee', active: true });
    b.set(d.doc(`b/${B}/admins/${MB}`), { email: 'mb@x.invalid' });
    for (const [u, biz, role] of [[M1, A, 'admin'], [M2, A, 'admin'], [E1, A, 'worker'], [MB, B, 'admin']]) b.set(d.doc('users/' + u), { bizId: biz, role, active: true, bizStatus: 'active', email: u + '@x.invalid', createdAt: 1 });
    // נתוני מזכירה לדוגמה בעסק A (השרת היה כותב אותם)
    const mgr = {}; for (const u of opt.consent) mgr[u] = CONSENTED(ver);
    b.set(d.doc(`b/${A}/sec_cfg/main`), Object.assign({ mode: 'all', mainUid: '', emp: false, pay: {}, mgr }, opt.cfg || {}));
    b.set(d.doc(`b/${A}/sec_cfg/cap`), { capCents: 5000 });
    for (const p of SAMPLE.filter((x) => !x.startsWith('sec_cfg/'))) b.set(d.doc(`b/${A}/${p}`), p.startsWith('sec_cal') ? { t: 1, text: 'דוגמה', uid: '' } : { t: 1, text: 'דוגמה' });
    b.set(d.doc(`b/${A}/sec_chat/${SUPADM}/m/y1`), { t: 2, role: 'u', text: 'שיחה של מנהל־על שהוא גם מנהל' });
    await b.commit();
  });
}
const clean = (o) => JSON.parse(JSON.stringify(o));

before(async () => { env = await H.getEnv(); require('../functions/index.js'); SEC = require('../functions/secretary.js')._core; });
after(async () => { try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });

describe('תוספת secretary', () => {
  beforeEach(() => seed());
  it('ברשימת התוספות, כבויה ב-ALL_ON (גם בעסק הישן), ולארג\' פעמי בלי מסמך – כבויה', async () => {
    const T = require('../functions/lib/tenant');
    assert.ok(T.FEATURES.includes('secretary'));
    assert.equal(T.ALL_ON.secretary, false);
    assert.equal(T.ALL_ON.cellular, false);
    assert.equal(T.ALL_ON.orders, true);
    const b0 = await T.loadBiz(BZ0);
    assert.equal(b0.features.secretary, false);
  });
  it('עסק חדש (createBusiness) – התוספת כבויה; מנהל־על מפעיל ומכבה ב-setBusinessFeatures', async () => {
    const r = await call('createBusiness', SUPER, { bizId: 'biz-new', name: 'חדש', ownerEmail: 'own-sec@x.invalid', ownerPhone: '0501234567' });
    assert.equal(r.status, 'OK', r.text);
    assert.equal(((await get('b/biz-new')).features || {}).secretary, undefined);
    const on = await call('setBusinessFeatures', SUPER, { bizId: 'biz-new', features: { secretary: true } });
    assert.equal(on.status, 'OK', on.text); assert.equal(on.result.features.secretary, true);
    const g = await call('secAdminGet', SUPER, { bizId: 'biz-new' });
    assert.equal(g.status, 'OK', g.text);
    assert.equal(g.result.emp, false, 'עסק חדש: ניתוח עובדים ומידע רגיש כבוי כברירת מחדל');
    assert.equal(g.result.empDefault, false);
    const off = await call('setBusinessFeatures', SUPER, { bizId: 'biz-new', features: { secretary: false } });
    assert.equal(off.result.features.secretary, false);
    assert.equal((await call('setBusinessFeatures', M1, { bizId: A, features: { secretary: false } })).reason, 'not-superadmin');
  });
  it('עסק הפיילוט (largpeami): ניתוח עובדים ומידע רגיש פעיל כברירת מחדל (פ4)', () => {
    assert.equal(SEC.cfgOf(null, BZ0).emp, true);
    assert.equal(SEC.cfgOf(null, A).emp, false);
    assert.equal(SEC.cfgOf({ exists: true, data: () => ({ emp: false }) }, BZ0).emp, false, 'מנהל־על כיבה – כבוי');
  });
});

describe('תוספת כבויה – כל הפונקציות נדחות (חוץ מהכנת ההגדרות אצל מנהל־על), והאוספים חסומים', () => {
  beforeEach(() => seed({ featA: false, consent: [M1] }));
  it('פונקציות', async () => {
    for (const fn of MGR_FNS) assert.equal((await call(fn, M1, { ver: SEC.CONSENT_VER, ok: true, name: 'רותי', addr: 'f' })).reason, 'feature-off', fn);
    assert.equal((await call('secAdminReadChat', SUPER, { bizId: A, uid: M1 })).reason, 'feature-off');
    const g = await call('secAdminGet', SUPER, { bizId: A });
    assert.equal(g.status, 'OK', g.text); assert.equal(g.result.on, false);
    assert.equal((await coll(`b/${A}/sec_log`)).filter((x) => x.act === 'readChat').length, 0);
  });
  it('אוספים: גם מנהל שאישר – חסום', async () => {
    for (const p of SAMPLE) await assertFails(db(M1).doc(`b/${A}/${p}`).get());
    await assertFails(db(M1).collection(`b/${A}/sec_log`).get());
  });
});

describe('עובד ועסק אחר – נחסמים בכל פונקציה ובכל אוסף', () => {
  beforeEach(() => seed({ consent: [M1, M2] }));
  it('עובד: כל פונקציה נדחית', async () => {
    for (const fn of MGR_FNS) assert.equal((await call(fn, E1, { ver: SEC.CONSENT_VER, ok: true, name: 'x', addr: 'm' })).reason, 'not-manager', fn);
    for (const fn of SA_FNS) assert.equal((await call(fn, E1, { uid: M1 })).reason, 'not-superadmin', fn);
    for (const fn of SA_FNS) assert.equal((await call(fn, E1, { bizId: A, uid: M1 })).reason, 'not-superadmin', fn);
  });
  it('לא מחובר: כל פונקציה נדחית', async () => {
    for (const fn of ALL_FNS) assert.equal((await call(fn, null, {})).status, 'UNAUTHENTICATED', fn);
  });
  it('עובד: כל אוסף חסום לקריאה ולכתיבה', async () => {
    for (const p of SAMPLE) {
      await assertFails(db(E1).doc(`b/${A}/${p}`).get());
      await assertFails(db(E1).doc(`b/${A}/${p}`).set({ t: 1 }));
    }
    await assertFails(db(E1).collection(`b/${A}/sec_log`).get());
  });
  it('מנהל עסק אחר: כל פונקציה עם bizId של עסק A נדחית, ובלי bizId – פועלת רק על העסק שלו', async () => {
    for (const fn of ALL_FNS) assert.equal((await call(fn, MB, { bizId: A, uid: M1, ver: SEC.CONSENT_VER, ok: true })).reason, 'foreign-biz', fn);
    const c = await call('secConsent', MB, { ver: SEC.CONSENT_VER, ok: true });
    assert.equal(c.status, 'OK', c.text);
    assert.ok((await get(`b/${B}/sec_cfg/main`)).mgr[MB].cv);
    assert.equal((await get(`b/${A}/sec_cfg/main`)).mgr[MB], undefined, 'לא נגע בעסק A');
  });
  it('מנהל עסק אחר: כל אוסף של עסק A חסום (גם אחרי שאישר בעסק שלו)', async () => {
    await setDoc(`b/${B}/sec_cfg/main`, { mode: 'all', mgr: { [MB]: CONSENTED(SEC.CONSENT_VER) } });
    for (const p of SAMPLE) await assertFails(db(MB).doc(`b/${A}/${p}`).get());
    await assertFails(db(MB).collection(`b/${A}/sec_log`).get());
    await assertSucceeds(db(MB).collection(`b/${B}/sec_log`).get());
  });
  it('אף אחד לא כותב לאוספי sec_* מהאפליקציה – גם מנהל ומנהל־על', async () => {
    for (const u of [M1, SUPER, SUPADM]) for (const p of SAMPLE) {
      await assertFails(db(u).doc(`b/${A}/${p}`).set({ t: 2 }));
      await assertFails(db(u).doc(`b/${A}/${p}`).delete());
    }
  });
  it('מנהל: קורא את האוספים המשותפים; sec_mirror, sec_facts_sensitive ו-sec_cfg/cap – לא', async () => {
    for (const p of ['sec_cfg/main', 'sec_in/i1', 'sec_draft/d1', 'sec_inv/v1', 'sec_inv/v1/p/0', 'sec_facts/f1', 'sec_rules/r1', 'sec_cal/c1', 'sec_rep/r1', 'sec_log/l1', 'sec_usage/2026-11']) await assertSucceeds(db(M1).doc(`b/${A}/${p}`).get());
    for (const p of ['sec_mirror/m', 'sec_facts_sensitive/s1', 'sec_cfg/cap']) await assertFails(db(M1).doc(`b/${A}/${p}`).get());
    await assertSucceeds(db(SUPER).doc(`b/${A}/sec_cfg/cap`).get());
  });
  it('יומן אישי: אירוע של מנהל אחר – חסום', async () => {
    await setDoc(`b/${A}/sec_cal/c2`, { uid: M2, t: 1 });
    await assertFails(db(M1).doc(`b/${A}/sec_cal/c2`).get());
    await assertSucceeds(db(M2).doc(`b/${A}/sec_cal/c2`).get());
  });
});

describe('sec_chat: קריאה ישירה – רק המנהל עצמו; מנהל־על חסום; secAdminReadChat נרשמת ב-sec_log', () => {
  beforeEach(() => seed({ consent: [M1, M2, SUPADM] }));
  it('חוקים', async () => {
    await assertSucceeds(db(M1).doc(`b/${A}/sec_chat/${M1}/m/x1`).get());
    await assertSucceeds(db(M1).collection(`b/${A}/sec_chat/${M1}/m`).get());
    await assertFails(db(M2).doc(`b/${A}/sec_chat/${M1}/m/x1`).get());
    await assertFails(db(SUPER).doc(`b/${A}/sec_chat/${M1}/m/x1`).get());
    await assertFails(db(SUPER).collection(`b/${A}/sec_chat/${M1}/m`).get());
    // מנהל־על שהוא גם מנהל של העסק לפי admins – חסום גם בשיחה שלו (החלטה 8, אפיון 2.3)
    await assertFails(db(SUPADM).doc(`b/${A}/sec_chat/${SUPADM}/m/y1`).get());
    await assertFails(db(SUPADM).doc(`b/${A}/sec_chat/${M1}/m/x1`).get());
  });
  it('secAdminReadChat: מחזירה את השיחה לקריאה בלבד, ורושמת צפייה ב-sec_log וב-audit', async () => {
    await setDoc(`b/${A}/sec_chat/${M1}/m/x2`, { t: 5, role: 'a', text: 'תשובה' });
    const r = await call('secAdminReadChat', SUPER, { bizId: A, uid: M1 });
    assert.equal(r.status, 'OK', r.text);
    assert.equal(r.result.readOnly, true);
    assert.deepEqual(r.result.msgs.map((m) => m.text), ['דוגמה', 'תשובה']);
    const log = (await coll(`b/${A}/sec_log`)).filter((x) => x.act === 'readChat');
    assert.equal(log.length, 1);
    assert.equal(log[0].by, SUPER); assert.equal(log[0].who, 'sa'); assert.equal(log[0].tgt, M1); assert.ok(log[0].t > 0);
    assert.equal((await coll(`b/${A}/audit`)).filter((x) => x.act === 'secAdminReadChat').length, 1);
    // מנהל העסק רואה את רשומת הצפייה (המלצה 1 בסעיף 2.3)
    await assertSucceeds(db(M1).collection(`b/${A}/sec_log`).get());
  });
  it('secAdminReadChat: מנהל (לא מנהל־על) נדחה ולא נרשם כלום; קלט לא תקין נדחה', async () => {
    assert.equal((await call('secAdminReadChat', M1, { bizId: A, uid: M2 })).reason, 'not-superadmin');
    assert.equal((await call('secAdminReadChat', M1, { uid: M2 })).reason, 'not-superadmin');
    assert.equal((await call('secAdminReadChat', SUPER, { bizId: A, uid: '../x' })).reason, 'bad-uid');
    assert.equal((await call('secAdminReadChat', SUPER, { bizId: A, uid: M1, limit: 5000 })).reason, 'bad-limit');
    assert.equal((await coll(`b/${A}/sec_log`)).filter((x) => x.act === 'readChat').length, 0);
  });
});

describe('הסכמה (98): אין שימוש לפני אישור; האישור נשמר עם תאריך ונוסח', () => {
  beforeEach(() => seed());
  it('לפני אישור: secState מחזיר את הנוסח, secSetup נדחה, והאוספים חסומים', async () => {
    const s = await call('secState', M1);
    assert.equal(s.status, 'OK', s.text);
    assert.equal(s.result.consented, false);
    assert.equal(s.result.consent.ver, SEC.CONSENT_VER);
    const all = s.result.consent.items.join(' ');
    assert.match(all, /מנהל המערכת.*רשאי לקרוא את השיחות/, 'כולל קריאת שיחות על ידי מנהל־על (8)');
    assert.match(all, /שירות בינה מלאכותית חיצוני/, 'כולל שימוש בשירות AI חיצוני (81)');
    assert.equal((await call('secSetup', M1, { name: 'רותי', addr: 'f' })).reason, 'no-consent');
    await assertFails(db(M1).doc(`b/${A}/sec_log/l1`).get());
    await assertFails(db(M1).doc(`b/${A}/sec_chat/${M1}/m/x1`).get());
  });
  it('אישור: נוסח ישן או בלי סימון נדחה; אישור תקין נשמר עם תאריך ומזהה נוסח ונרשם ביומן', async () => {
    assert.equal((await call('secConsent', M1, { ver: 'old', ok: true })).reason, 'bad-consent-ver');
    assert.equal((await call('secConsent', M1, { ver: SEC.CONSENT_VER })).reason, 'bad-consent');
    const t0 = Date.now();
    const c = await call('secConsent', M1, { ver: SEC.CONSENT_VER, ok: true });
    assert.equal(c.status, 'OK', c.text);
    const m = (await get(`b/${A}/sec_cfg/main`)).mgr[M1];
    assert.equal(m.cv, SEC.CONSENT_VER); assert.ok(m.ca >= t0 - 5000 && m.ca <= Date.now() + 5000);
    assert.equal((await coll(`b/${A}/sec_log`)).filter((x) => x.act === 'consent' && x.by === M1 && x.note === SEC.CONSENT_VER).length, 1);
    const s = await call('secState', M1);
    assert.equal(s.result.consented, true); assert.equal(s.result.consent, undefined); assert.equal(s.result.setupDone, false);
    // אשף: שם + פנייה
    assert.equal((await call('secSetup', M1, { name: '', addr: 'f' })).reason, 'bad-name');
    assert.equal((await call('secSetup', M1, { name: 'רותי', addr: 'x' })).reason, 'bad-addr');
    const w = await call('secSetup', M1, { name: ' רותי ', addr: 'f', call: 'נתי' });
    assert.equal(w.status, 'OK', w.text);
    const s2 = await call('secState', M1);
    assert.equal(s2.result.name, 'רותי'); assert.equal(s2.result.addr, 'f'); assert.equal(s2.result.setupDone, true);
    assert.deepEqual(s2.result.rows, [], 'כרטיס הבית: בשלב 1 אין שורות של שלבים עתידיים');
    // מנהל אחר עדיין לא אישר – חסום
    assert.equal((await call('secSetup', M2, { name: 'x', addr: 'm' })).reason, 'no-consent');
    await assertSucceeds(db(M1).doc(`b/${A}/sec_log/l1`).get());
  });
  it('מזהה נוסח שהשתנה = צריך לאשר שוב', async () => {
    await setDoc(`b/${A}/sec_cfg/main`, { mode: 'all', mgr: { [M1]: { cv: 'sec-terms-old', ca: 1 } } });
    assert.equal((await call('secSetup', M1, { name: 'x', addr: 'm' })).reason, 'no-consent');
    assert.equal((await call('secState', M1)).result.consented, false);
    // גם בחוקים: הסכמה לנוסח קודם לא פותחת את האוספים (תיקון סבב 1)
    await assertFails(db(M1).doc(`b/${A}/sec_log/l1`).get());
    await assertFails(db(M1).doc(`b/${A}/sec_chat/${M1}/m/x1`).get());
  });
  it('מזהה הנוסח בחוקים זהה למזהה בשרת (בשורש ובעסק), והנוסח מציין את משך שמירת הגיבויים', () => {
    const rules = fsm.readFileSync(path.join(H.ROOT, 'firestore.rules'), 'utf8');
    assert.equal(rules.split(`get('cv', '') == '${SEC.CONSENT_VER}'`).length - 1, 2);
    assert.ok(!/get\('cv', ''\) != ''/.test(rules), 'אין "הסכמה כלשהי" בחוקים');
    assert.match(SEC.CONSENT.items.join(' '), new RegExp('גיבוי.*נמחק אוטומטית אחרי ' + SEC.BACKUP_KEEP_DAYS + ' יום'));
  });
});

describe('מצב "מנהל ראשי בלבד" (6) – נאכף בשרת ובחוקים', () => {
  beforeEach(() => seed({ consent: [M1, M2] }));
  it('מנהל־על קובע מצב; בלי מנהל ראשי – נדחה; מנהל אחר נחסם בכל פונקציה ובכל אוסף', async () => {
    assert.equal((await call('secAdminSetCfg', SUPER, { bizId: A, mode: 'main' })).reason, 'need-main');
    assert.equal((await call('secAdminSetCfg', SUPER, { bizId: A, mode: 'main', mainUid: E1 })).reason, 'bad-main');
    const r = await call('secAdminSetCfg', SUPER, { bizId: A, mode: 'main', mainUid: M1 });
    assert.equal(r.status, 'OK', r.text); assert.equal(r.result.mode, 'main'); assert.equal(r.result.mainUid, M1);
    for (const fn of MGR_FNS) assert.equal((await call(fn, M2, { ver: SEC.CONSENT_VER, ok: true, name: 'x', addr: 'm' })).reason, 'not-main-manager', fn);
    assert.equal((await call('secState', M1)).status, 'OK');
    await assertFails(db(M2).doc(`b/${A}/sec_log/l1`).get());
    await assertFails(db(M2).doc(`b/${A}/sec_in/i1`).get());
    await assertSucceeds(db(M1).doc(`b/${A}/sec_log/l1`).get());
    // חזרה ל"כל המנהלים"
    assert.equal((await call('secAdminSetCfg', SUPER, { bizId: A, mode: 'all' })).status, 'OK');
    assert.equal((await call('secState', M2)).status, 'OK');
  });
});

describe('הגדרות מנהל־על: תקרה, מתג שכר, ניתוח עובדים; רישום ב-audit וב-sec_log', () => {
  beforeEach(() => seed({ consent: [M1] }));
  it('שמירה ובדיקות קלט', async () => {
    assert.equal((await call('secAdminSetCfg', M1, { bizId: A, capCents: 1 })).reason, 'not-superadmin');
    assert.equal((await call('secAdminSetCfg', SUPADM, { bizId: A, capCents: 1.5 })).reason, 'bad-cap');
    assert.equal((await call('secAdminSetCfg', SUPER, { bizId: A, capCents: -1 })).reason, 'bad-cap');
    assert.equal((await call('secAdminSetCfg', SUPER, { bizId: A, pay: { [E1]: true } })).reason, 'bad-pay');
    assert.equal((await call('secAdminSetCfg', SUPER, { bizId: A, foo: 1 })).reason, 'bad-input');
    assert.equal((await call('secAdminSetCfg', SUPER, { bizId: A })).reason, 'bad-input');
    const r = await call('secAdminSetCfg', SUPER, { bizId: A, capCents: 2500, pay: { [M1]: true, [M2]: false }, emp: true });
    assert.equal(r.status, 'OK', r.text);
    assert.equal(r.result.capCents, 2500); assert.equal(r.result.pay[M1], true); assert.equal(r.result.pay[M2], false); assert.equal(r.result.emp, true);
    assert.equal((await get(`b/${A}/sec_cfg/cap`)).capCents, 2500);
    const st = await call('secState', M1);
    assert.equal(st.result.pay, true); assert.equal(st.result.capCents, undefined, 'מנהל העסק לא מקבל את סכום התקרה (83)');
    assert.equal((await coll(`b/${A}/audit`)).filter((x) => x.act === 'secAdminSetCfg' && x.by === SUPER).length, 1);
    assert.equal((await coll(`b/${A}/sec_log`)).filter((x) => x.act === 'cfg' && x.who === 'sa').length, 1);
    // תקרה: מעל 10,000$ נדחה בהודעה בדולרים; null = ניקוי
    const big = await call('secAdminSetCfg', SUPER, { bizId: A, capCents: 1000100 });
    assert.equal(big.reason, 'bad-cap'); assert.match(big.text, /10,000\$/);
    const clr = await call('secAdminSetCfg', SUPER, { bizId: A, capCents: null });
    assert.equal(clr.status, 'OK', clr.text); assert.equal(clr.result.capCents, null);
    assert.equal(await get(`b/${A}/sec_cfg/cap`), null);
  });
  it('עסק בלי מסמך הגדרות: יצירה ראשונה שומרת ברירות מחדל ומתג שכר', async () => {
    await prep((d) => d.doc(`b/${A}/sec_cfg/main`).delete());
    const r = await call('secAdminSetCfg', SUPER, { bizId: A, pay: { [M2]: true } });
    assert.equal(r.status, 'OK', r.text);
    const c = await get(`b/${A}/sec_cfg/main`);
    assert.equal(c.mode, 'all'); assert.equal(c.emp, false); assert.deepEqual(c.pay, { [M2]: true });
  });
});

describe('מנהל־על כמשתמש במזכירה, ועסק מושהה', () => {
  beforeEach(() => seed({ consent: [M1, SUPADM] }));
  it('מנהל־על שאינו מנהל של העסק – לא משתמש במזכירה של העסק', async () => {
    assert.equal((await call('secState', SUPER, { bizId: A })).reason, 'not-biz-admin');
    assert.equal((await call('secConsent', SUPER, { bizId: A, ver: SEC.CONSENT_VER, ok: true })).reason, 'not-biz-admin');
  });
  it('עסק מושהה: המזכירה עוצרת – גם למנהל־על שהוא מנהל העסק', async () => {
    await prep((d) => d.doc('b/' + A).update({ status: 'suspended' }));
    assert.equal((await call('secState', M1)).reason, 'biz-suspended');
    assert.equal((await call('secState', SUPADM, { bizId: A })).reason, 'biz-suspended');
    await assertFails(db(M1).doc(`b/${A}/sec_log/l1`).get());
  });
});

describe('לארג\' פעמי במצב legacy: אוספי sec_* בשורש', () => {
  async function seedLegacy(feat) {
    await env.clearFirestore();
    await prep(async (d) => {
      const b = d.batch();
      b.set(d.doc('b/' + BZ0), { name: 'לארג', status: 'active', dataRoot: 'legacy', schemaVersion: 1, features: { tasks: true, secretary: feat } });
      b.set(d.doc('superadmins/' + SUPER), {});
      b.set(d.doc('admins/' + LM), { email: 'lm@x.invalid' });
      b.set(d.doc('staff/' + LE), { name: LE, role: 'employee', active: true });
      b.set(d.doc('sec_cfg/main'), { mode: 'all', mgr: { [LM]: CONSENTED(SEC.CONSENT_VER) } });
      b.set(d.doc('sec_log/l1'), { t: 1, act: 'x' });
      b.set(d.doc(`sec_chat/${LM}/m/x1`), { t: 1, role: 'u', text: 'שלום' });
      await b.commit();
    });
  }
  it('פעיל: המנהל קורא; עובד ומנהל־על (בשיחה) חסומים; secAdminReadChat נרשמת בשורש', async () => {
    await seedLegacy(true);
    await assertSucceeds(db(LM).doc('sec_log/l1').get());
    await assertSucceeds(db(LM).doc(`sec_chat/${LM}/m/x1`).get());
    await assertFails(db(LE).doc('sec_log/l1').get());
    await assertFails(db(SUPER).doc(`sec_chat/${LM}/m/x1`).get());
    await assertFails(db(LM).doc('sec_log/l2').set({ t: 1 }));
    const r = await call('secAdminReadChat', SUPER, { bizId: BZ0, uid: LM });
    assert.equal(r.status, 'OK', r.text); assert.equal(r.result.msgs.length, 1);
    assert.equal((await coll('sec_log')).filter((x) => x.act === 'readChat' && x.tgt === LM).length, 1);
    assert.equal((await call('secState', LM)).status, 'OK');
    assert.equal((await call('secState', LE)).reason, 'not-manager');
  });
  it('כבוי: הכול חסום', async () => {
    await seedLegacy(false);
    await assertFails(db(LM).doc('sec_log/l1').get());
    await assertFails(db(LM).doc(`sec_chat/${LM}/m/x1`).get());
    assert.equal((await call('secState', LM)).reason, 'feature-off');
  });
});

describe('גיבוי אוטומטי בשרת (94, 9.6): כל אוספי sec_*, ושחזור מחזיר אותם', () => {
  const BUCKET = H.PROJECT_ID;
  const bucket = () => require(require.resolve('firebase-admin/storage', { paths: [path.join(H.ROOT, 'functions')] })).getStorage().bucket(BUCKET);
  // קריאה עם Admin SDK (listDocuments מוצא גם מסמך אב "חסר" כמו sec_chat/{uid})
  async function dumpAll(prefix) {
    const adb = require(require.resolve('firebase-admin/firestore', { paths: [path.join(H.ROOT, 'functions')] })).getFirestore();
    const out = {};
    const walk = async (ref, rel) => {
      for (const x of await ref.listDocuments()) {
        const s = await x.get(); const r = rel + '/' + x.id;
        if (s.exists) out[r] = s.data();
        for (const c of await x.listCollections()) await walk(c, r + '/' + c.id);
      }
    };
    for (const c of SEC.SEC_COLLS) await walk(adb.collection(prefix + c), c);
    return out;
  }
  it('הגיבוי כולל את כל האוספים (גם תת־אוספים, חותמת זמן), עסק כבוי בלי נתונים לא מגובה, ושחזור לסביבה אחרת מחזיר הכול', async () => {
    await seed({ featB: false, consent: [M1] });
    const { Timestamp } = require(require.resolve('firebase-admin/firestore', { paths: [path.join(H.ROOT, 'functions')] }));
    await prep(async (d) => {
      await d.doc(`b/${A}/sec_log/ts`).set({ t: 3, at: new Date('2026-11-11T08:00:00Z'), nested: { a: [1, 'ב', { c: true }] } });
      await d.doc('sec_route/972500000000').set({ biz: A });
    });
    await bucket().deleteFiles({ prefix: 'sec_backups/' }).catch(() => {});
    const before = await dumpAll(`b/${A}/`);
    assert.equal(Object.keys(before).length, SAMPLE.length + 2, 'כל מסמכי הדוגמה + שיחה של SUPADM + ts');
    for (const c of SEC.SEC_COLLS) assert.ok(Object.keys(before).some((k) => k.startsWith(c + '/')), 'חסר אוסף לדוגמה: ' + c);
    const r = await SEC.runSecBackup({ bucket: BUCKET, now: Date.parse('2026-11-11T01:30:00Z') });
    assert.equal(r.day, '2026-11-11');
    const fa = r.files.find((f) => f.bizId === A);
    assert.ok(fa, 'עסק A גובה'); assert.equal(fa.docs, Object.keys(before).length); assert.equal(fa.path, `sec_backups/${A}/2026-11-11.json.gz`);
    assert.ok(!r.files.find((f) => f.bizId === B), 'עסק B (תוספת כבויה, בלי נתונים) לא גובה');
    assert.ok(r.files.find((f) => f.bizId === '_root' && f.docs === 1), 'טבלאות הניתוב בשורש גובו');
    const [exists] = await bucket().file(fa.path).exists();
    assert.ok(exists);
    // שחזור לסביבת בדיקה (עסק אחר, ריק)
    const rr = await SEC.restoreSecBackup({ bucket: BUCKET, path: fa.path, prefix: 'b/biz-restore/' });
    assert.equal(rr.written, fa.docs); assert.equal(rr.skipped, 0);
    const after = await dumpAll('b/biz-restore/');
    assert.deepEqual(clean(after), clean(before));
    const ts = after['sec_log/ts'].at;
    assert.ok(ts instanceof Timestamp || (ts && typeof ts.toMillis === 'function'), 'חותמת זמן נשמרה כחותמת זמן');
    assert.equal(ts.toMillis(), Date.parse('2026-11-11T08:00:00Z'));
    // שחזור אחרי מחיקה באותו עסק – מחזיר הכול; ושחזור שני לא דורס (מדלג על קיים)
    await prep(async (d) => { for (const k of Object.keys(before)) await d.doc(`b/${A}/${k}`).delete(); });
    assert.equal(Object.keys(await dumpAll(`b/${A}/`)).length, 0);
    await SEC.restoreSecBackup({ bucket: BUCKET, path: fa.path, prefix: `b/${A}/` });
    assert.deepEqual(clean(await dumpAll(`b/${A}/`)), clean(before));
    const again = await SEC.restoreSecBackup({ bucket: BUCKET, path: fa.path, prefix: `b/${A}/` });
    assert.equal(again.written, 0); assert.equal(again.skipped, fa.docs);
  });
  it('עסק שהתוספת כובתה אבל יש לו נתוני מזכירה – עדיין מגובה (ניתוק לא מוחק, 9.5); קובץ עם נתיב זר נדחה בשחזור', async () => {
    await seed({ featA: false });
    const r = await SEC.runSecBackup({ bucket: BUCKET, now: Date.parse('2026-11-12T01:30:00Z') });
    assert.ok(r.files.find((f) => f.bizId === A && f.docs > 0));
    const zlib = require('node:zlib');
    await bucket().file('sec_backups/x/bad.json.gz').save(zlib.gzipSync(JSON.stringify({ v: 1, kind: 'sec', docs: [{ p: 'admins/evil', d: {} }] })));
    await assert.rejects(SEC.restoreSecBackup({ bucket: BUCKET, path: 'sec_backups/x/bad.json.gz', prefix: 'b/biz-restore/' }), /bad path/);
    assert.equal(await get('b/biz-restore/admins/evil'), null);
    await assert.rejects(SEC.restoreSecBackup({ bucket: BUCKET, path: 'sec_backups/x/bad.json.gz', prefix: '../' }), /bad prefix/);
  });
  it('מדיניות שמירה: עותק בן יותר מ-35 יום נמחק בריצת הגיבוי; צעיר יותר וקובץ בשם אחר – נשארים', async () => {
    await seed({ consent: [M1] });
    await bucket().deleteFiles({ prefix: 'sec_backups/' }).catch(() => {});
    const put = (p) => bucket().file(p).save(Buffer.from('x'));
    await put(`sec_backups/${A}/2026-10-07.json.gz`); // 36 ימים לפני 12.11 – נמחק
    await put(`sec_backups/${A}/2026-10-08.json.gz`); // 35 ימים – נשאר
    await put('sec_backups/_root/2025-01-01.json.gz'); // ישן מאוד – נמחק
    await put(`sec_backups/${A}/note.txt`); // לא בתבנית – לא נוגעים
    const r = await SEC.runSecBackup({ bucket: BUCKET, now: Date.parse('2026-11-12T01:30:00Z') });
    assert.deepEqual(r.removed.sort(), [`sec_backups/${A}/2026-10-07.json.gz`, 'sec_backups/_root/2025-01-01.json.gz'].sort());
    const [left] = await bucket().getFiles({ prefix: 'sec_backups/' });
    const names = left.map((f) => f.name).sort();
    assert.ok(names.includes(`sec_backups/${A}/2026-10-08.json.gz`));
    assert.ok(names.includes(`sec_backups/${A}/note.txt`));
    assert.ok(names.includes(`sec_backups/${A}/2026-11-12.json.gz`));
    assert.ok(!names.includes(`sec_backups/${A}/2026-10-07.json.gz`));
    assert.equal(SEC.BACKUP_KEEP_DAYS, 35);
  });
  it('עמידות: שגיאה בעסק אחד נרשמת, ושאר העסקים מגובים; קריאה בעמודים (מעל 500 מסמכים באוסף)', async () => {
    await seed({ consent: [M1] });
    await prep(async (d) => { for (let k = 0; k < 2; k++) { const b = d.batch(); for (let i = 0; i < 300; i++) b.set(d.doc(`b/${A}/sec_log/p${k}_${String(i).padStart(3, '0')}`), { t: i }); await b.commit(); } });
    const T = require('../functions/lib/tenant');
    const good = await T.loadBiz(A);
    const broken = { bizId: 'bad/x', dataRoot: 'b', features: { secretary: true } }; // נתיב לא תקין – הקריאה של העסק הזה נכשלת
    const r = await SEC.runSecBackup({ bucket: BUCKET, now: Date.parse('2026-11-13T01:30:00Z'), bizzes: [broken, good] }).catch((e) => ({ thrown: e }));
    assert.equal(r.thrown, undefined, 'הריצה לא נעצרה');
    assert.equal(r.errors.length, 1); assert.equal(r.errors[0].bizId, 'bad/x');
    const fa = r.files.find((f) => f.bizId === A);
    assert.ok(fa, 'עסק A גובה למרות השגיאה בעסק הקודם');
    assert.equal(fa.docs, SAMPLE.length + 1 + 600, 'כל 600 המסמכים הנוספים ב-sec_log (שני עמודים)');
  });
  it('תת־אוספים בגיבוי (SEC_SUBS) = כל התת־אוספים של sec_* בחוקים', () => {
    const rules = fsm.readFileSync(path.join(H.ROOT, 'firestore.rules'), 'utf8');
    const nested = new Set([...rules.matchAll(/match \/(sec_[a-z_]+)\/\{[a-z]+\} \{\s*(?:allow[^\n]*\n\s*)+match \/([a-z]+)\//g)].map((m) => m[1] + '/' + m[2]));
    const subs = new Set(Object.entries(SEC.SEC_SUBS).flatMap(([c, l]) => l.map((x) => c + '/' + x)));
    assert.deepEqual([...nested].sort(), [...subs].sort());
  });
  it('גיבויים ב-Storage – אף אחד לא קורא מהאפליקציה', async () => {
    const st = env.authenticatedContext(M1, { email: M1 + '@example.invalid' }).storage();
    await assertFails(st.ref(`sec_backups/${A}/2026-11-11.json.gz`).getDownloadURL());
    const sa = env.authenticatedContext(SUPER, { email: SUPER + '@example.invalid' }).storage();
    await assertFails(sa.ref(`sec_backups/${A}/2026-11-11.json.gz`).getDownloadURL());
  });
});
