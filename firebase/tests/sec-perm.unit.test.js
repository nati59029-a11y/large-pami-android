'use strict';
// גיטי – הרשאות לפי סוג פעולה, לכל מנהל בנפרד (firebase/functions/lib/sec-perm.js, סבב 4 חלק א, 24.11.2026). בדיקות יחידה, בלי אמולטור ובלי רשת.
// deny / approve / auto / תקרת סכום / "עצור הכל" / רק המנהל עצמו משנה (מנהל א' לא משנה את של ב'; ההגדרה של אחד לא חלה על אחר) /
// הזמנה מספק תמיד באישור / שאלה בפעם הראשונה (למנהל עצמו, פעם אחת) / OTP (שרת ומכשיר – אותו כלל).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../functions/lib/sec-perm');
const NF = require('../../app-source/www/sec-notif.js');

const A = 'mgrA', B = 'mgrB';
const doc = (permA, permB) => ({ mgr: { [A]: { cv: 'v', perm: permA || {} }, [B]: { cv: 'v', perm: permB || {} } } });

describe('sec-perm: ההחלטה', () => {
  it('בלי הגדרה = לשאול (ask), ולא לבד', () => {
    const r = P.decide(doc(), A, 'mail');
    assert.equal(r.d, 'ask'); assert.equal(r.why, 'pmAsk');
    assert.equal(P.isAuto(doc(), A, 'mail'), false);
  });
  it('deny חוסם', () => assert.deepEqual(P.decide(doc({ wa: { m: 'deny' } }), A, 'wa'), { d: 'deny', why: 'pmDeny' }));
  it('approve = לאישור', () => assert.deepEqual(P.decide(doc({ mail: { m: 'approve' } }), A, 'mail'), { d: 'approve', why: 'pmApr' }));
  it('auto = לבד', () => assert.deepEqual(P.decide(doc({ mail: { m: 'auto' } }), A, 'mail'), { d: 'auto', why: '' }));
  it('"עצור הכל" גובר על לבד', () => assert.deepEqual(P.decide(doc({ mail: { m: 'auto' } }), A, 'mail', { stop: true }), { d: 'approve', why: 'pmStop' }));
  it('תקרת סכום: עד התקרה – לבד; מעליה, בלי סכום או בלי תקרה – לאישור', () => {
    const d = doc({ fin: { m: 'auto', cap: 500 } });
    assert.equal(P.decide(d, A, 'fin', { amount: 500 }).d, 'auto');
    assert.equal(P.decide(d, A, 'fin', { amount: 120.5 }).d, 'auto');
    assert.deepEqual(P.decide(d, A, 'fin', { amount: 500.01 }), { d: 'approve', why: 'pmCap' });
    assert.equal(P.decide(d, A, 'fin', { amount: -900 }).d, 'approve'); // לפי ערך מוחלט
    assert.equal(P.decide(d, A, 'fin', {}).d, 'approve');
    assert.equal(P.decide(d, A, 'fin', { amount: NaN }).d, 'approve');
    assert.equal(P.decide(doc({ fin: { m: 'auto' } }), A, 'fin', { amount: 1 }).d, 'approve'); // לבד בלי תקרה שמורה
  });
  it('הזמנה מספק תמיד באישור – גם אם נשמר "לבד"; deny עדיין חוסם', () => {
    assert.equal(P.decide(doc({ ord: { m: 'auto', cap: 1e6 } }), A, 'ord', { amount: 1 }).d, 'approve');
    assert.equal(P.decide(doc({ ord: { m: 'deny' } }), A, 'ord').d, 'deny');
  });
  it('סוג שאין לו ביצוע לבד (משימה, תזכורת, התחייבות) – לבד שנשמר בטעות = לאישור', () => {
    for (const k of ['task', 'rem', 'cmt']) assert.equal(P.decide(doc({ [k]: { m: 'auto' } }), A, k).d, 'approve');
  });
  it('ההגדרה של מנהל אחד לא חלה על מנהל אחר', () => {
    const d = doc({ mail: { m: 'auto' }, wa: { m: 'deny' } }, { mail: { m: 'deny' } });
    assert.equal(P.decide(d, A, 'mail').d, 'auto');
    assert.equal(P.decide(d, B, 'mail').d, 'deny');
    assert.equal(P.decide(d, B, 'wa').d, 'ask'); // אצל ב' עדיין לא הוגדר
    assert.equal(P.decide(d, 'mgrC', 'mail').d, 'ask');
  });
  it('אין בעלים ידוע / סוג לא מוכר / רשומה פגומה', () => {
    assert.deepEqual(P.decide(doc({ mail: { m: 'auto' } }), '', 'mail'), { d: 'approve', why: 'pmOwner' });
    assert.equal(P.decide(doc(), A, 'pay').d, 'deny');
    assert.equal(P.decide(doc({ mail: { m: 'yes' } }), A, 'mail').d, 'ask');
    assert.equal(P.decide({ mgr: { [A]: 'x' } }, A, 'mail').d, 'ask');
    assert.equal(P.decide(null, A, 'mail').d, 'ask');
  });
});

describe('sec-perm: שינוי הרשאות – רק המנהל עצמו', () => {
  it('המנהל משנה את שלו – תמיד כך נשמר', () => {
    const s = P.parseSet({ type: 'fin', m: 'auto', cap: 750, scope: 'always' }, A);
    assert.deepEqual(s, { uid: A, type: 'fin', m: 'auto', scope: 'always', save: true, cap: 750 });
    const del = { del: 1 };
    const up = P.updOf(s, 99, del);
    assert.deepEqual(up, { ['mgr.' + A + '.pq.fin']: del, ['mgr.' + A + '.perm.fin']: { m: 'auto', t: 99, cap: 750 } });
    assert.ok(Object.keys(up).every((k) => k.startsWith('mgr.' + A + '.'))); // נוגע רק ברשומה של המנהל עצמו
  });
  it('מנהל א\' לא משנה את של מנהל ב\'', () => {
    assert.throws(() => P.parseSet({ uid: B, type: 'mail', m: 'auto' }, A), (e) => e.code === 'not-yours');
    assert.throws(() => P.parseSet({ type: 'mail', m: 'auto' }, ''), (e) => e.code === 'not-allowed');
  });
  it('רק הפעם / לשאול שוב – לא נשמר, רק סוגר את השאלה', () => {
    for (const scope of ['once', 'again']) {
      const s = P.parseSet({ type: 'mail', m: 'auto', scope }, A);
      assert.equal(s.save, false);
      assert.deepEqual(Object.keys(P.updOf(s, 1, null)), ['mgr.' + A + '.pq.mail']);
    }
  });
  it('unset – חזרה ל"טרם הוגדר"', () => {
    const s = P.parseSet({ type: 'wa', m: 'unset' }, A);
    assert.deepEqual(Object.keys(P.updOf(s, 1, null)).sort(), ['mgr.' + A + '.perm.wa', 'mgr.' + A + '.pq.wa']);
  });
  it('לבד בסוג כספי – חובה תקרה; הזמנה מספק ומשימה – לא לבד; ערכים לא תקינים', () => {
    assert.throws(() => P.parseSet({ type: 'fin', m: 'auto' }, A), (e) => e.code === 'bad-cap');
    assert.throws(() => P.parseSet({ type: 'fin', m: 'auto', cap: -1 }, A), (e) => e.code === 'bad-cap');
    assert.throws(() => P.parseSet({ type: 'ord', m: 'auto', cap: 10 }, A), (e) => e.code === 'no-auto');
    assert.throws(() => P.parseSet({ type: 'task', m: 'auto' }, A), (e) => e.code === 'no-auto');
    assert.throws(() => P.parseSet({ type: '__proto__', m: 'deny' }, A), (e) => e.code === 'bad-input');
    assert.throws(() => P.parseSet({ type: 'mail', m: 'maybe' }, A), (e) => e.code === 'bad-input');
    assert.equal(P.parseSet({ type: 'ord', m: 'deny' }, A).m, 'deny');
    assert.equal(P.parseSet({ type: 'fin', m: 'approve' }, A).cap, undefined);
  });
  it('stateOf – רק ההגדרות והשאלות של המנהל המחובר', () => {
    const d = doc({ mail: { m: 'auto' } }, { wa: { m: 'deny' } });
    d.mgr[A].pq = { wa: { t: 5, n: 2, note: 'x' }, mail: { t: 6 } }; // mail כבר הוגדר – השאלה לא מוצגת
    const st = P.stateOf(d, A);
    assert.deepEqual(st.m, { mail: { m: 'auto' } });
    assert.deepEqual(Object.keys(st.q), ['wa']);
    assert.equal(st.types.find((t) => t.k === 'ord').auto, false);
    assert.equal(st.types.length, 8);
  });
});

// מסד מדומה מינימלי: מסמך אחד sec_cfg/main + יומן
function fakeDb(data) {
  const state = { main: data, log: [] };
  const setPath = (o, path, v) => { const ks = path.split('.'); let c = o; for (let i = 0; i < ks.length - 1; i++) c = c[ks[i]] = c[ks[i]] && typeof c[ks[i]] === 'object' ? c[ks[i]] : {}; c[ks[ks.length - 1]] = v; };
  const db = {
    doc: (p) => ({ p }),
    collection: () => ({ doc: () => ({ log: true }) }),
    runTransaction: async (fn) => fn({
      get: async () => ({ exists: !!state.main, data: () => state.main }),
      update: (ref, up) => { for (const [k, v] of Object.entries(up)) setPath(state.main, k, v); },
      set: (ref, v) => { if (ref.log) state.log.push(v); },
    }),
  };
  return { db, state };
}
describe('sec-perm: שאלה בפעם הראשונה', () => {
  it('נרשמת אצל המנהל עצמו, פעם אחת (מונה), ושורה אחת ביומן', async () => {
    const { db, state } = fakeDb(doc());
    assert.equal(await P.ask(db, A, 'mail', 'תשובה במייל'), true);
    assert.equal(await P.ask(db, A, 'mail', 'תשובה במייל'), false);
    assert.equal(state.main.mgr[A].pq.mail.n, 2);
    assert.equal(state.main.mgr[B].pq, undefined); // לא אצל מנהל אחר
    assert.equal(state.log.length, 1);
    assert.equal(state.log[0].act, 'permAsk'); assert.equal(state.log[0].by, A); assert.equal(state.log[0].tgt, 'mail');
  });
  it('לא נשאלת כשכבר הוגדר, לסוג לא מוכר, או למי שאינו מנהל שאישר תנאים', async () => {
    const { db, state } = fakeDb(doc({ mail: { m: 'deny' } }));
    assert.equal(await P.ask(db, A, 'mail'), false);
    assert.equal(await P.ask(db, A, 'pay'), false);
    assert.equal(await P.ask(db, 'stranger', 'mail'), false);
    assert.equal(state.log.length, 0);
  });
  it('blockWhy: לבד – ריק; בלי הגדרה – סיבה + שאלה', async () => {
    const { db, state } = fakeDb(doc({ wa: { m: 'auto' } }));
    assert.equal(await P.blockWhy(db, state.main, A, 'wa', {}), '');
    assert.equal(await P.blockWhy(db, state.main, A, 'mail', {}, 'x'), 'pmAsk');
    assert.ok(state.main.mgr[A].pq.mail);
    assert.equal(await P.blockWhy(db, state.main, B, 'wa', {}), 'pmAsk'); // ההגדרה של א' לא חלה על ב'
  });
});

describe('OTP – קודי אימות וסיסמאות לא נשמרים ולא נשלחים ל-AI', () => {
  const yes = [['Google', 'G-482913 is your Google verification code'], ['בנק הפועלים', 'קוד האימות שלך: 5521. אין למסור אותו'], ['', 'Your OTP is 778899'],
    ['Wolt', 'Your login code: 4471'], ['', 'הסיסמה החד פעמית שלך היא 99812'], ['PayBox', 'הקוד שלך הוא 123456'], ['', 'Your password was reset']];
  const no = [['רונית', 'אחזור אליך מחר לגבי ההזמנה 12345'], ['ספק', 'החשבונית 2024-118 בסך 4500 ₪'], ['דני', 'מה הקוד של הדלת? אני ליד'], ['', 'שלום, מתי אתם פתוחים?']];
  it('שרת: מזהה קודים', () => { for (const [s, x] of yes) assert.equal(P.isOtp(x, s), true, x); });
  it('שרת: לא חוסם הודעות רגילות', () => { for (const [s, x] of no) assert.equal(P.isOtp(x, s), false, x); });
  it('מכשיר (sec-notif.js): אותו כלל בדיוק', () => { for (const [s, x] of yes.concat(no)) assert.equal(NF.isOtp(x, s), P.isOtp(x, s), x); });
  it('מכשיר: התראה עם קוד לא נכנסת לרשימה', () => {
    const r = NF.merge([], [{ k: 'a', p: 'com.google.android.apps.messaging', s: 'Google', x: 'G-482913 is your Google verification code', t: 1 }, { k: 'b', p: 'com.whatsapp', s: 'דני', x: 'אחזור אליך מחר', t: 2 }], []);
    assert.deepEqual(r.list.map((x) => x.k), ['b']);
  });
  it('מכשיר: כלל "לבד" רץ רק עם הרשאת app=לבד ו"עצור הכל" כבוי', () => {
    assert.equal(NF.appPerm({ perm: { m: { app: { m: 'auto' } } }, stop: false }), 'auto');
    assert.equal(NF.appPerm({ perm: { m: { app: { m: 'auto' } } }, stop: true }), 'approve');
    assert.equal(NF.appPerm({ perm: { m: { app: { m: 'approve' } } } }), 'approve');
    assert.equal(NF.appPerm({ perm: { m: { app: { m: 'deny' } } } }), 'deny');
    assert.equal(NF.appPerm({ perm: { m: {} } }), 'ask');
    assert.equal(NF.appPerm(null), 'approve'); // בלי מידע מהשרת – לא לבד
  });
});
