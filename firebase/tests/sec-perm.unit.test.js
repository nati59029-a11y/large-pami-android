'use strict';
// גיטי – הרשאות לפי סוג פעולה, לכל מנהל בנפרד (firebase/functions/lib/sec-perm.js, סבב 4 חלק א, 24.11.2026). בדיקות יחידה, בלי אמולטור ובלי רשת.
// deny / approve / auto / תקרת סכום / "עצור הכל" / רק המנהל עצמו משנה (מנהל א' לא משנה את של ב'; ההגדרה של אחד לא חלה על אחר) /
// הזמנה מספק תמיד באישור / שאלה בפעם הראשונה (למנהל עצמו, פעם אחת) / OTP (שרת ומכשיר – אותו כלל).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../functions/lib/sec-perm');
const NF = require('../../app-source/www/sec-notif.js');

const A = 'mgrA', B = 'mgrB';
const rec = (perm) => ({ perm: perm || {}, pq: {} });

describe('sec-perm: ההחלטה', () => {
  it('בלי הגדרה = לשאול (ask), ולא לבד', () => {
    const r = P.decide(rec(), 'mail');
    assert.equal(r.d, 'ask'); assert.equal(r.why, 'pmAsk');
    assert.equal(P.isAuto(rec(), 'mail'), false);
  });
  it('deny חוסם', () => assert.deepEqual(P.decide(rec({ wa: { m: 'deny' } }), 'wa'), { d: 'deny', why: 'pmDeny' }));
  it('approve = לאישור', () => assert.deepEqual(P.decide(rec({ mail: { m: 'approve' } }), 'mail'), { d: 'approve', why: 'pmApr' }));
  it('auto = לבד', () => assert.deepEqual(P.decide(rec({ mail: { m: 'auto' } }), 'mail'), { d: 'auto', why: '' }));
  it('"עצור הכל" גובר על לבד', () => assert.deepEqual(P.decide(rec({ mail: { m: 'auto' } }), 'mail', { stop: true }), { d: 'approve', why: 'pmStop' }));
  it('תקרת סכום: עד התקרה – לבד; מעליה, בלי סכום או בלי תקרה – לאישור', () => {
    const d = rec({ fin: { m: 'auto', cap: 500 } });
    assert.equal(P.decide(d, 'fin', { amount: 500 }).d, 'auto');
    assert.equal(P.decide(d, 'fin', { amount: 120.5 }).d, 'auto');
    assert.deepEqual(P.decide(d, 'fin', { amount: 500.01 }), { d: 'approve', why: 'pmCap' });
    assert.equal(P.decide(d, 'fin', { amount: -900 }).d, 'approve'); // לפי ערך מוחלט
    assert.equal(P.decide(d, 'fin', {}).d, 'approve');
    assert.equal(P.decide(d, 'fin', { amount: NaN }).d, 'approve');
    assert.equal(P.decide(rec({ fin: { m: 'auto' } }), 'fin', { amount: 1 }).d, 'approve'); // לבד בלי תקרה שמורה
  });
  it('הזמנה מספק תמיד באישור – גם אם נשמר "לבד"; deny עדיין חוסם', () => {
    assert.equal(P.decide(rec({ ord: { m: 'auto', cap: 1e6 } }), 'ord', { amount: 1 }).d, 'approve');
    assert.equal(P.decide(rec({ ord: { m: 'deny' } }), 'ord').d, 'deny');
  });
  it('החלטה 2: "לבד" גם למשימה, תזכורת והתחייבות – כפוף ל"עצור הכל"', () => {
    for (const k of ['task', 'rem', 'cmt']) {
      assert.equal(P.decide(rec({ [k]: { m: 'auto' } }), k).d, 'auto', k);
      assert.equal(P.decide(rec({ [k]: { m: 'auto' } }), k, { stop: true }).d, 'approve', k);
      assert.equal(P.parseSet({ type: k, m: 'auto' }, A).m, 'auto');
      assert.equal(P.decide(rec(), k).d, 'ask', 'בפעם הראשונה – שאלה');
    }
    assert.equal(P.stateOf(rec()).types.filter((t) => t.auto).map((t) => t.k).join(','), 'task,rem,mail,wa,fin,cmt,app');
  });
  it('סוג לא מוכר / רשומה פגומה', () => {
    assert.equal(P.decide(rec(), 'pay').d, 'deny');
    assert.equal(P.decide(rec({ mail: { m: 'yes' } }), 'mail').d, 'ask');
    assert.equal(P.decide({ perm: 'x' }, 'mail').d, 'ask');
    assert.equal(P.decide(null, 'mail').d, 'ask');
  });
});

describe('sec-perm: שינוי הרשאות – רק המנהל עצמו', () => {
  it('המנהל משנה את שלו – תמיד כך נשמר, והשאלה על הסוג נסגרת', () => {
    const s = P.parseSet({ type: 'fin', m: 'auto', cap: 750, scope: 'always' }, A);
    assert.deepEqual(s, { uid: A, type: 'fin', m: 'auto', scope: 'always', save: true, cap: 750 });
    const r = P.nextRec({ perm: { mail: { m: 'deny' } }, pq: { fin: { t: 1 }, wa: { t: 2 } } }, s, 99);
    assert.deepEqual(r, { perm: { mail: { m: 'deny' }, fin: { m: 'auto', t: 99, cap: 750 } }, pq: { wa: { t: 2 } } });
  });
  it('"תמיד כך" מחליף את כל הרשומה של הסוג (לא נשארת תקרה ישנה)', () => {
    const r = P.nextRec({ perm: { fin: { m: 'auto', cap: 500, t: 1 } } }, P.parseSet({ type: 'fin', m: 'approve' }, A), 5);
    assert.deepEqual(r.perm.fin, { m: 'approve', t: 5 });
  });
  it('מנהל א\' לא משנה את של מנהל ב\'', () => {
    assert.throws(() => P.parseSet({ uid: B, type: 'mail', m: 'auto' }, A), (e) => e.code === 'not-yours');
    assert.throws(() => P.parseSet({ type: 'mail', m: 'auto' }, ''), (e) => e.code === 'not-allowed');
  });
  it('רק הפעם / לשאול שוב – לא נשמר, רק סוגר את השאלה', () => {
    for (const scope of ['once', 'again']) {
      const s = P.parseSet({ type: 'mail', m: 'auto', scope }, A);
      assert.equal(s.save, false);
      assert.deepEqual(P.nextRec({ perm: {}, pq: { mail: { t: 1 } } }, s, 1), { perm: {}, pq: {} });
    }
  });
  it('unset – חזרה ל"טרם הוגדר"', () => {
    assert.deepEqual(P.nextRec({ perm: { wa: { m: 'deny' } } }, P.parseSet({ type: 'wa', m: 'unset' }, A), 1), { perm: {}, pq: {} });
  });
  it('לבד בסוג כספי – חובה תקרה; הזמנה מספק ומשימה – לא לבד; ערכים לא תקינים', () => {
    assert.throws(() => P.parseSet({ type: 'fin', m: 'auto' }, A), (e) => e.code === 'bad-cap');
    assert.throws(() => P.parseSet({ type: 'fin', m: 'auto', cap: -1 }, A), (e) => e.code === 'bad-cap');
    assert.throws(() => P.parseSet({ type: 'ord', m: 'auto', cap: 10 }, A), (e) => e.code === 'no-auto');
    assert.throws(() => P.parseSet({ type: '__proto__', m: 'deny' }, A), (e) => e.code === 'bad-input');
    assert.throws(() => P.parseSet({ type: 'mail', m: 'maybe' }, A), (e) => e.code === 'bad-input');
    assert.equal(P.parseSet({ type: 'ord', m: 'deny' }, A).m, 'deny');
    assert.equal(P.parseSet({ type: 'fin', m: 'approve' }, A).cap, undefined);
  });
  it('stateOf – רק ההגדרות והשאלות שברשומה (של המנהל המחובר)', () => {
    const st = P.stateOf({ perm: { mail: { m: 'auto' } }, pq: { wa: { t: 5, n: 2, note: 'x' }, mail: { t: 6 } } }); // mail כבר הוגדר – השאלה לא מוצגת
    assert.deepEqual(st.m, { mail: { m: 'auto' } });
    assert.deepEqual(Object.keys(st.q), ['wa']);
    assert.equal(st.types.find((t) => t.k === 'ord').auto, false);
    assert.equal(st.types.length, 8);
  });
});

// מסד מדומה: מסמכים לפי נתיב (sec_perm/<uid>, sec_cfg/main) + יומן. FieldValue.delete() – מוחק
function fakeDb(docs) {
  const state = { docs: JSON.parse(JSON.stringify(docs || {})), log: [] };
  const isDel = (v) => v && typeof v === 'object' && /FieldValue|Delete/i.test((v.constructor && v.constructor.name) || '');
  const snap = (p) => ({ exists: !!state.docs[p], data: () => state.docs[p], get: (k) => (state.docs[p] || {})[k] });
  const upd = (p, up) => { const o = state.docs[p]; for (const [k, v] of Object.entries(up)) { const ks = k.split('.'); let c = o; for (let i = 0; i < ks.length - 1; i++) c = c[ks[i]] = c[ks[i]] && typeof c[ks[i]] === 'object' ? c[ks[i]] : {}; if (isDel(v)) delete c[ks[ks.length - 1]]; else c[ks[ks.length - 1]] = v; } };
  const db = {
    doc: (p) => ({ p, get: async () => snap(p), set: async (v) => { state.docs[p] = Object.assign(state.docs[p] || {}, JSON.parse(JSON.stringify(v))); } }),
    collection: () => ({ doc: () => ({ log: true }) }),
    runTransaction: async (fn) => fn({
      get: async (ref) => snap(ref.p),
      update: (ref, up) => upd(ref.p, up),
      set: (ref, v) => { if (ref.log) state.log.push(v); else state.docs[ref.p] = JSON.parse(JSON.stringify(v)); },
    }),
  };
  return { db, state };
}
const main = (old) => ({ 'sec_cfg/main': { mgr: { [A]: Object.assign({ cv: 'v' }, old || {}), [B]: { cv: 'v' } } } });
describe('sec-perm: אחסון נפרד לכל מנהל (sec_perm/{uid}) ושאלה בפעם הראשונה', () => {
  it('השאלה נרשמת במסמך של המנהל עצמו, פעם אחת (מונה), ושורה אחת ביומן', async () => {
    const { db, state } = fakeDb(main());
    assert.equal(await P.ask(db, A, 'mail', 'תשובה במייל'), true);
    assert.equal(await P.ask(db, A, 'mail', 'תשובה במייל'), false);
    assert.equal(state.docs['sec_perm/' + A].pq.mail.n, 2);
    assert.equal(state.docs['sec_perm/' + B], undefined); // לא אצל מנהל אחר
    assert.equal(state.docs['sec_cfg/main'].mgr[A].pq, undefined, 'לא נכתב למסמך המשותף');
    assert.equal(state.log.length, 1);
    assert.equal(state.log[0].act, 'permAsk'); assert.equal(state.log[0].by, A); assert.equal(state.log[0].tgt, 'mail');
  });
  it('לא נשאלת כשכבר הוגדר, לסוג לא מוכר, או למי שאינו מנהל שאישר תנאים', async () => {
    const d = main(); d['sec_perm/' + A] = { perm: { mail: { m: 'deny' } }, pq: {} };
    const { db, state } = fakeDb(d);
    assert.equal(await P.ask(db, A, 'mail'), false);
    assert.equal(await P.ask(db, A, 'pay'), false);
    assert.equal(await P.ask(db, 'stranger', 'mail'), false);
    assert.equal(state.log.length, 0);
  });
  it('blockWhy: לבד – ריק; בלי הגדרה – סיבה + שאלה; ההגדרה של א\' לא חלה על ב\'; אין בעלים – לאישור בלי שאלה', async () => {
    const d = main(); d['sec_perm/' + A] = { perm: { wa: { m: 'auto' } }, pq: {} };
    const { db, state } = fakeDb(d);
    assert.equal(await P.blockWhy(db, A, 'wa', {}), '');
    assert.equal(await P.blockWhy(db, A, 'mail', {}, 'x'), 'pmAsk');
    assert.ok(state.docs['sec_perm/' + A].pq.mail);
    assert.equal(await P.blockWhy(db, B, 'wa', {}), 'pmAsk');
    assert.equal(await P.blockWhy(db, '', 'wa', {}), 'pmOwner');
    assert.equal(state.log.filter((x) => x.by === '').length, 0);
  });
  it('גיבוי מהמיקום הישן (mgr.<uid>.perm): נקרא כשאין מסמך חדש, ובכתיבה הראשונה מועבר ונמחק מהמסמך המשותף', async () => {
    const { db, state } = fakeDb(main({ perm: { mail: { m: 'auto' }, fin: { m: 'auto', cap: 300 } }, pq: { wa: { t: 7 } } }));
    assert.equal(P.decide(await P.readRec(db, A), 'mail').d, 'auto', 'נקרא מהמיקום הישן');
    assert.equal(P.decide(await P.readRec(db, B), 'mail').d, 'ask', 'לא של מנהל אחר');
    const s = P.parseSet({ type: 'wa', m: 'deny' }, A);
    await P.writeRec(db, A, (r) => P.nextRec(r, s, 9), { act: 'permSet' });
    const nw = state.docs['sec_perm/' + A];
    assert.deepEqual(nw.perm, { mail: { m: 'auto' }, fin: { m: 'auto', cap: 300 }, wa: { m: 'deny', t: 9 } }, 'ההגדרות הישנות נשמרו');
    assert.deepEqual(nw.pq, {});
    assert.equal(state.docs['sec_cfg/main'].mgr[A].perm, undefined, 'נמחק מהמסמך המשותף');
    assert.equal(state.docs['sec_cfg/main'].mgr[A].cv, 'v', 'שאר הרשומה של המנהל נשארה');
    assert.equal(state.log.length, 1);
  });
});

describe('החלטה 1: התשובה הראשונה חלה מיד על הפריט שעורר את השאלה', () => {
  it('ask שומר את הפריט (ref) ו-pqOf מחזיר אותו; ref לא תקין לא נשמר', async () => {
    const { db, state } = fakeDb(main());
    await P.ask(db, A, 'task', 'הצעה בשיחה', { k: 'tkp', cid: 'tp0123456789abcdef', evil: '<x>' });
    assert.deepEqual(P.pqOf(state.docs['sec_perm/' + A]).task.ref, { k: 'tkp', cid: 'tp0123456789abcdef' });
    await P.ask(db, A, 'cmt', '', { k: 'zzz' });
    assert.equal(P.pqOf(state.docs['sec_perm/' + A]).cmt.ref, undefined);
    assert.equal(P.refOf({ k: 'tkp', cid: '../x' }).cid, undefined);
  });
  it('בתשובה (writeRec + nextRec) – ה-ref נקרא לפני שהשאלה נסגרת, והשאלה נמחקת', async () => {
    const { db, state } = fakeDb(main());
    await P.ask(db, A, 'rem', 'x', { k: 'tkp', cid: 'tpaaaa' });
    let ref = null;
    const s = P.parseSet({ type: 'rem', m: 'deny', scope: 'once' }, A);
    await P.writeRec(db, A, (r) => { ref = P.refOf(((r.pq || {})[s.type] || {}).ref); return P.nextRec(r, s, 5); }, { act: 'permOnce' });
    assert.deepEqual(ref, { k: 'tkp', cid: 'tpaaaa' });
    assert.deepEqual(state.docs['sec_perm/' + A].pq, {});
    assert.deepEqual(state.docs['sec_perm/' + A].perm, {}, '"רק הפעם" – לא נשמר');
  });
});

describe('החלטה 3: כלל "לבד" קיים – מיגרציה עצלה ל"לבד, תמיד" לסוג שלו בלבד', () => {
  it('בעל כלל בלי הגדרה: blockWhy עם legacy → לבד, נשמר עם mig, שורה אחת ביומן', async () => {
    const { db, state } = fakeDb(main());
    assert.equal(await P.blockWhy(db, A, 'mail', {}, 'כלל', { legacy: true, at: 1000 }), '');
    assert.equal(await P.blockWhy(db, A, 'mail', {}, 'כלל', { legacy: true, at: 1000 }), '');
    assert.ok(Number.isFinite(state.docs['sec_cfg/main'].permAt), 'מועד הפעלת מסך ההרשאות נשמר');
    assert.deepEqual(P.permOf(state.docs['sec_perm/' + A]).mail.mig, 1);
    assert.equal(state.log.filter((l) => l.act === 'permMig').length, 1);
    assert.equal(P.permOf(state.docs['sec_perm/' + A]).wa, undefined, 'לא מפעיל סוגים אחרים');
    assert.equal(state.docs['sec_perm/' + B], undefined, 'לא אצל מנהל אחר');
  });
  it('לא דורס הגדרה קיימת ("אסור" נשאר אסור), ובלי legacy – שאלה רגילה', async () => {
    const d = main(); d['sec_perm/' + A] = { perm: { mail: { m: 'deny' } }, pq: {} };
    const { db, state } = fakeDb(d);
    assert.equal(await P.blockWhy(db, A, 'mail', {}, 'כלל', { legacy: true, at: 1000 }), 'pmDeny');
    assert.equal(await P.blockWhy(db, A, 'wa', {}, 'x'), 'pmAsk');
    assert.equal(state.log.filter((l) => l.act === 'permMig').length, 0);
  });
  it('סוג כספי: רק עם תקרה ("נכנס ישר" של העסק), והתקרה נאכפת', async () => {
    const { db, state } = fakeDb(main());
    assert.equal(await P.legacyAuto(db, A, 'fin', {}), false, 'בלי תקרה – לא');
    assert.equal(await P.legacyAuto(db, A, 'fin', { cap: 5000 }), true);
    assert.equal(P.decide(state.docs['sec_perm/' + A], 'fin', { amount: 4000 }).d, 'auto');
    assert.equal(P.decide(state.docs['sec_perm/' + A], 'fin', { amount: 6000 }).d, 'approve');
    assert.equal(await P.legacyAuto(db, A, 'ord', { cap: 1 }), false, 'הזמנה מספק – לעולם לא');
    assert.equal(await P.legacyAuto(db, 'stranger', 'mail'), false, 'רק מנהל שאישר תנאים');
  });
  it('מכשיר: כלל פעיל שאושר לפני הפריסה (בלי v) = legacy; כלל חדש (v:2) או "תמיד לשאול" – לא', () => {
    assert.equal(NF.legacyRules({ a: { on: true, act: 'ign' } }), true);
    assert.equal(NF.legacyRules({ a: { on: true, act: 'task', v: 2 } }), false);
    assert.equal(NF.legacyRules({ a: { on: false, act: 'ign' } }), false);
    assert.equal(NF.legacyRules(null), false);
  });
});

describe('תיקון בדיקה (סבב 4 החלטות, סבב 1)', () => {
  it('ליקוי 1: "עצור הכל" עוצר אישור "לבד" (auto:true) בשרת; לחיצה ידנית – לא', () => {
    const ws = (on) => ({ exists: true, get: (k) => (k === 'stop' ? { on } : undefined) });
    assert.equal(P.stopBlocks({ auto: true }, ws(true)), true);
    assert.equal(P.stopBlocks({ auto: true }, ws(false)), false);
    assert.equal(P.stopBlocks({}, ws(true)), false, 'לחיצה ידנית');
    assert.equal(P.stopBlocks({ auto: 'true' }, ws(true)), false);
    assert.equal(P.stopBlocks({ auto: true }, { exists: false }), false);
  });
  it('ליקוי 2: "נכנס ישר" (ברירת מחדל דולקת) לא מעניק "לבד" ל"רישום הוצאה" – secretary-inv לא קורא ל-legacyAuto', () => {
    const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../functions/secretary-inv.js'), 'utf8');
    assert.ok(!/legacyAuto|legacy:\s*true/.test(src));
  });
  it('ליקוי 3: כלל מענה במייל מעניק "לבד" רק כשהוא פעיל כאוטומטי והמענה האוטומטי במייל דולק', () => {
    const r = { auto: true, on: true };
    assert.equal(P.mailRuleLegacy(r, []), true);
    assert.equal(P.mailRuleLegacy(Object.assign({}, r, { autoOff: true }), []), false, 'כלל שכובה');
    assert.equal(P.mailRuleLegacy(Object.assign({}, r, { on: false }), []), false);
    assert.equal(P.mailRuleLegacy(r, ['off']), false, 'מענה אוטומטי כבוי בעסק');
    assert.equal(P.mailRuleLegacy(r, ['ruleOff']), false);
    assert.equal(P.mailRuleLegacy(r, ['held', 'thread']), true, 'חסימה זמנית אחרת – הכלל עדיין "לבד"');
  });
  it('הערה: "לבד" מכלל קיים רק לכלל שאושר לפני הפעלת מסך ההרשאות (permAt); כלל חדש – שאלה ראשונה', async () => {
    const d = main(); d['sec_cfg/main'].permAt = 5000;
    const { db, state } = fakeDb(d);
    assert.equal(await P.legacyOk(db, { legacy: true, at: 4000 }), true);
    assert.equal(await P.legacyOk(db, { legacy: true, at: 6000 }), false);
    assert.equal(await P.legacyOk(db, { legacy: true }), false, 'בלי מועד אישור – לא');
    assert.equal(await P.legacyOk(db, { legacy: false, at: 1 }), false);
    assert.equal(await P.blockWhy(db, A, 'wa', {}, 'כלל חדש', { legacy: true, at: 6000 }), 'pmAsk');
    assert.equal(state.log.filter((l) => l.act === 'permMig').length, 0);
  });
});

describe('החלטה 4: הודעות פתיחה / "קיבלנו" בווצאפ – מחוץ להרשאות, אבל "עצור הכל" עוצר אותן', () => {
  it('sendAuto: "עצור הכל" פעיל – לא נשלח, ונרשם autoStopped', async () => {
    const WA = require('../functions/secretary-wa')._core;
    const logs = []; let sent = 0;
    const db = { doc: (p) => ({ get: async () => ({ exists: p === 'sec_cfg/wa', data: () => ({ stop: { on: true } }), get: (k) => ({ stop: { on: true } })[k] }) }), collection: () => ({ doc: () => ({ set: async (v) => { logs.push(v); } }) }) };
    for (const kind of ['open', 'ack']) {
      const r = await WA.sendAuto(db, { pnid: 'p1', in: 'i1' }, '972500000001', 'שלום', kind, { now: 1, send: async () => { sent++; return {}; } });
      assert.deepEqual(r, { stopped: true });
    }
    assert.equal(sent, 0);
    assert.deepEqual(logs.map((l) => l.act), ['autoStopped', 'autoStopped']);
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
  it('מכשיר: כלל שפותח משימה – "יצירת משימה" אסורה חוסמת גם כשההתראות "לבד" (תיקון סבב 1, ליקוי 2)', () => {
    const st = { perm: { m: { app: { m: 'auto' }, task: { m: 'deny' } } }, stop: false };
    assert.equal(NF.appPerm(st, 'task'), 'deny');
    assert.equal(NF.appPerm(st, 'ign'), 'auto');
    assert.equal(NF.appPerm({ perm: { m: { app: { m: 'auto' }, task: { m: 'approve' } } } }, 'task'), 'auto');
  });
});

// 24.11.2026 (סבב 4ג): תזכורת "לבד" בשבת / יום טוב – עוברת למוצאי שבת/חג 21:00 (השרת: secCal op:'add' עם auto:true, lib/sec-know.js restMove)
describe('תזכורת "לבד" בשבת/חג – למוצאי שבת/חג', () => {
  const K = require('../functions/lib/sec-know');
  it('שבת (בלי שעה / בבוקר) – מוצאי שבת 21:00; כבר במוצאי שבת – לא זז', () => {
    assert.deepEqual(K.restMove('2026-11-28', ''), { d: '2026-11-28', tm: '21:00' });
    assert.deepEqual(K.restMove('2026-11-28', '10:00'), { d: '2026-11-28', tm: '21:00' });
    assert.equal(K.restMove('2026-11-28', '22:00'), null);
  });
  it('ערב שבת: מ-16:00 – למוצאי שבת; בבוקר או בלי שעה – לא זז; יום חול – לא זז', () => {
    assert.deepEqual(K.restMove('2026-11-27', '17:00'), { d: '2026-11-28', tm: '21:00' });
    assert.equal(K.restMove('2026-11-27', '10:00'), null);
    assert.equal(K.restMove('2026-11-27', ''), null);
    assert.equal(K.restMove('2026-11-29', '10:00'), null);
    assert.equal(K.restMove('2026-11-24', '23:00'), null);
  });
  it('יום טוב: פסח (ט"ו ניסן, חמישי), ראש השנה שמתחיל בשבת – ליום המנוחה האחרון ברצף; חול המועד – לא זז', () => {
    assert.deepEqual(K.restMove('2027-04-22', '09:00'), { d: '2027-04-22', tm: '21:00' });
    assert.deepEqual(K.restMove('2027-04-21', '18:00'), { d: '2027-04-22', tm: '21:00' }, 'ערב פסח בערב');
    assert.deepEqual(K.restMove('2027-10-02', '09:00'), { d: '2027-10-03', tm: '21:00' }, 'שבת + ב׳ דראש השנה');
    assert.deepEqual(K.restMove('2027-06-11', ''), { d: '2027-06-12', tm: '21:00' }, 'שבועות בשישי + שבת');
    assert.equal(K.restMove('2027-04-23', '10:00'), null, 'חול המועד בבוקר');
  });
  it('קלט לא תקין – null', () => {
    assert.equal(K.restMove('28/11/2026', ''), null);
    assert.equal(K.restMove('2026-02-30', ''), null);
  });
});
