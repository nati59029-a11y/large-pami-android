'use strict';
// התראות משימות (18.11.2026): tkPush / tkPushB / ptkPush / ptkPushB (tasks-push.js), ושעות השקט של שבת וחג (tk-time.js).
// הליבה נבדקת ישירות מול האמולטור, עם שליחה מדומה (כמו grpMsg ב-44-groups.js).
const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const K = require('../functions/lib/tk-time.js');

const z = (y, m, d, hh, mm) => K.zoned(y, m - 1, d, hh, mm || 0); // שעון ישראל
const WED = z(2026, 11, 18, 10); // יום רביעי רגיל – לא שקט

describe('שעות שקט בשבת ובחג (tk-time: isRest / quietAt)', () => {
  it('הקבועים: מ-13:00 בערב שבת/חג ועד 21:00 במוצאי', () => {
    assert.equal(K.QUIET_FROM_H, 13);
    assert.equal(K.QUIET_TO_H, 21);
  });
  it('שבת: שישי 13:30 ו-18:00, שבת 10:00 ו-20:59 – שקט; שישי 12:30, מוצ"ש 21:30 וראשון 10:00 – לא', () => {
    for (const t of [z(2026, 11, 20, 13, 30), z(2026, 11, 20, 18), z(2026, 11, 21, 10), z(2026, 11, 21, 20, 59)]) assert.equal(K.quietAt(t), true, new Date(t).toISOString());
    for (const t of [z(2026, 11, 20, 12, 30), z(2026, 11, 21, 21, 30), z(2026, 11, 22, 10), WED]) assert.equal(K.quietAt(t), false, new Date(t).toISOString());
  });
  it('ראש השנה תשפ"ו: ערב החג אחרי 13:00 ושני הימים – שקט; ערב החג בבוקר ומוצאי החג 21:30 – לא', () => {
    for (const t of [z(2025, 9, 22, 18), z(2025, 9, 23, 10), z(2025, 9, 23, 22), z(2025, 9, 24, 10), z(2025, 9, 24, 20)]) assert.equal(K.quietAt(t), true, new Date(t).toISOString());
    for (const t of [z(2025, 9, 22, 10), z(2025, 9, 24, 21, 30)]) assert.equal(K.quietAt(t), false, new Date(t).toISOString());
    assert.equal(K.isRest({ y: 2025, m: 8, d: 23 }), true);
    assert.equal(K.isRest({ y: 2025, m: 8, d: 22 }), false);
  });
  it('חול המועד ופורים – לא שקט; ערב פסח ושביעי של פסח – כן', () => {
    for (const t of [z(2027, 4, 25, 10), z(2027, 4, 25, 18), z(2027, 3, 23, 10), z(2027, 3, 23, 18)]) assert.equal(K.quietAt(t), false, new Date(t).toISOString());
    for (const t of [z(2027, 4, 21, 17), z(2027, 4, 28, 10)]) assert.equal(K.quietAt(t), true, new Date(t).toISOString());
  });
  it('יום טוב ביום שישי (שבועות תשפ"ו, 22.5.2026): מחמישי 13:00 ועד מוצ"ש 21:00 – שקט ברצף', () => {
    assert.equal(K.isRest({ y: 2026, m: 4, d: 22 }), true);
    for (const t of [z(2026, 5, 21, 13, 30), z(2026, 5, 22, 10), z(2026, 5, 22, 21, 30), z(2026, 5, 23, 20, 59)]) assert.equal(K.quietAt(t), true, new Date(t).toISOString());
    for (const t of [z(2026, 5, 21, 12, 30), z(2026, 5, 23, 21, 30)]) assert.equal(K.quietAt(t), false, new Date(t).toISOString());
  });
  it('יום טוב ביום ראשון (ב\' ראש השנה תשפ"ז, 13.9.2026): משישי 13:00 ועד ראשון 21:00 – שקט ברצף', () => {
    assert.equal(K.isRest({ y: 2026, m: 8, d: 13 }), true);
    for (const t of [z(2026, 9, 11, 13, 30), z(2026, 9, 12, 21, 30), z(2026, 9, 13, 10), z(2026, 9, 13, 20, 59)]) assert.equal(K.quietAt(t), true, new Date(t).toISOString());
    for (const t of [z(2026, 9, 11, 12, 30), z(2026, 9, 13, 21, 30), z(2026, 9, 14, 10)]) assert.equal(K.quietAt(t), false, new Date(t).toISOString());
  });
  it('סוף שבוע של שינוי שעון (מעבר לשעון קיץ 27.3.2026, לשעון חורף 25.10.2026) – הגבולות לפי שעון ישראל', () => {
    for (const t of [z(2026, 3, 27, 13, 30), z(2026, 3, 28, 20, 59), z(2026, 10, 23, 13, 30), z(2026, 10, 24, 20, 59)]) assert.equal(K.quietAt(t), true, new Date(t).toISOString());
    for (const t of [z(2026, 3, 27, 12, 30), z(2026, 3, 28, 21, 30), z(2026, 10, 23, 12, 30), z(2026, 10, 24, 21, 30)]) assert.equal(K.quietAt(t), false, new Date(t).toISOString());
    assert.equal(new Date(z(2026, 3, 27, 12, 30)).toISOString(), '2026-03-27T09:30:00.000Z', 'שישי אחרי המעבר – UTC+3');
    assert.equal(new Date(z(2026, 10, 24, 21, 30)).toISOString(), '2026-10-24T18:30:00.000Z', 'מוצ"ש לפני המעבר – UTC+3');
  });
});

describe('tkPush – התראות משימות (שרת, שליחה מדומה)', { skip: !process.env.FIRESTORE_EMULATOR_HOST && 'אמולטור Firestore לא רץ' }, () => {
  let env, G;
  const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
  // טלפון שונה לכל עסק: fcm_<עסק>_<משתמש>___ (בשורש: root)
  const tok = (biz, u) => 'fcm_' + biz + '_' + u + '_'.repeat(30);
  const who = (calls, biz) => {
    const all = calls.flatMap((c) => c.toks);
    for (const t of all) assert.ok(t.startsWith('fcm_' + (biz || 'root') + '_'), 'טלפון של עסק אחר: ' + t);
    return all.map((t) => t.replace(/^fcm_[a-z0-9]+_|_+$/g, '')).sort();
  };
  let seq = 0;

  before(async () => {
    env = await H.getEnv();
    require('../functions/index.js');
    G = require('../functions/tasks-push.js')._core;
  });
  beforeEach(async () => {
    await env.clearFirestore();
    await prep(async (d) => {
      const b = d.batch();
      b.set(d.doc('b/tpz'), { name: 'tpz', status: 'active', dataRoot: 'b', features: { tasks: true } });
      b.set(d.doc('b/tnz'), { name: 'tnz', status: 'active', dataRoot: 'b', features: { tasks: false } });
      for (const biz of ['tpz', 'tnz']) {
        const P = 'b/' + biz + '/';
        for (const m of ['m1', 'm2']) b.set(d.doc(P + 'admins/' + m), { email: m + '@x.invalid' });
        b.set(d.doc(P + 'staff/m1'), { name: 'המנהל', active: true, pushTokens: [tok(biz, 'm1')] });
        b.set(d.doc(P + 'push_tokens/m2'), { pushTokens: [tok(biz, 'm2')] });
        for (const [u, act] of [['e1', true], ['e2', true], ['eoff', false], ['sa', true]]) b.set(d.doc(P + 'staff/' + u), { name: 'עובד ' + u, active: act, pushTokens: [tok(biz, u)] });
      }
      b.set(d.doc('superadmins/sa'), { email: 'sa@x.invalid' }); // מנהל־על – לא ב-admins של העסק
      b.set(d.doc('admins/m1'), { email: 'm1@x.invalid' });
      b.set(d.doc('staff/m1'), { name: 'המנהל', active: true, pushTokens: [tok('root', 'm1')] });
      b.set(d.doc('staff/e1'), { name: 'דנה', active: true, pushTokens: [tok('root', 'e1')] });
      await b.commit();
    });
  });

  const base = (o) => Object.assign({ owner: 'm1', by: 'm1', role: 'a', txt: 'לסדר את המדף', cr: WED - 60000, due: WED + 3600000, st: 'open', open: '1', pr: '', img: '', sub: 0, doneBy: '', note: '', ok: 0, late: '' }, o);
  const run = async (biz, b, a, actor, now) => {
    const calls = [];
    const send = async (toks, msg, tag) => { calls.push({ toks, msg, tag }); return toks.map((t) => ({ token: t, ok: true })); };
    const id = 't' + (++seq);
    const out = await G.onTask(biz, id, b, a, actor || '', { send, now: now || WED });
    return { id, out, calls, to: who(calls, biz) };
  };
  const runP = async (biz, d, now) => {
    const calls = [];
    const send = async (toks, msg, tag) => { calls.push({ toks, msg, tag }); return toks.map((t) => ({ token: t, ok: true })); };
    const out = await G.onPtk(biz, 'p' + (++seq), Object.assign({ st: 'open', cr: WED - 60000 }, d), { send, now: now || WED });
    return { out, calls, to: who(calls, biz) };
  };

  it('משימה חדשה של מנהל – לנמענים (לא ליוצר, לא למושבת); כותרת "משימה חדשה" וגוף = הטקסט; tag tkn_<id>', async () => {
    const r = await run('tpz', null, base({ to: ['e1', 'e2', 'eoff', 'm1'], toN: ['a', 'b', 'c', 'd'], ow: '' }), 'm1');
    assert.equal(r.out.k, 'new');
    assert.deepEqual(r.to, ['e1', 'e2']);
    assert.deepEqual(r.calls[0].msg, { id: r.id, title: 'משימה חדשה', body: 'לסדר את המדף' });
    assert.equal(r.calls[0].tag, 'tkn_' + r.id);
  });

  it('"עותק לכל נבחר" (3 משימות, נמען אחד בכל אחת) = 3 שליחות', async () => {
    let n = 0;
    for (const u of ['e1', 'e2', 'e1']) n += (await run('tpz', null, base({ to: [u], toN: ['x'], ow: u }), 'm1')).calls.length;
    assert.equal(n, 3);
  });

  it('משימה קבועה (rc), משימה ישנה בלי to, מחיקה – בלי התראה', async () => {
    for (const [b, a] of [[null, base({ to: ['e1'], toN: ['x'], ow: 'e1', rc: 'r1' })], [null, base({})], [base({ to: ['e1'], ow: 'e1' }), null]]) {
      const r = await run('tpz', b, a, 'm1');
      assert.equal(r.calls.length, 0);
    }
  });

  it('משימה שעובד יצר – לכל המנהלים; כותרת עם שם העובד מ-staff', async () => {
    const r = await run('tpz', null, base({ owner: 'e1', by: 'e1x', role: 'w' }), 'e1');
    assert.equal(r.out.k, 'newW');
    assert.deepEqual(r.to, ['m1', 'm2']);
    assert.equal(r.calls[0].msg.title, 'משימה חדשה מעובד e1');
  });

  it('משימה פרטית של עובד – לכל המנהלים, tag ptk_<id>; של מנהל / קבועה – בלי', async () => {
    const r = await runP('tpz', { owner: 'e2', by: 'e2', txt: 'להתקשר לספק', st: 'open' });
    assert.deepEqual(r.to, ['m1', 'm2']);
    assert.equal(r.calls[0].msg.title, 'משימה פרטית חדשה של עובד e2');
    assert.ok(/^ptk_p\d+$/.test(r.calls[0].tag));
    assert.equal((await runP('tpz', { owner: 'm1', by: 'm1', txt: 'x' })).calls.length, 0);
    assert.equal((await runP('tpz', { owner: 'e2', by: 'e2', txt: 'x', rc: 'r' })).calls.length, 0);
  });

  it('ממתינה לאישור – למנהלים; בוצעה על ידי עובד – למנהלים; כתיבת שרת (pushAct) – העובד לפי ow', async () => {
    const o = base({ to: ['e1'], ow: 'e1' });
    let r = await run('tpz', o, Object.assign({}, o, { st: 'wait', doneBy: 'e1' }), 'e1');
    assert.equal(r.out.k, 'wait');
    assert.deepEqual(r.to, ['m1', 'm2']);
    assert.equal(r.calls[0].msg.title, 'ממתינה לאישור: עובד e1');
    r = await run('tpz', o, Object.assign({}, o, { st: 'done', open: '', doneBy: 'e1' }), '');
    assert.equal(r.out.k, 'done');
    assert.deepEqual(r.to, ['m1', 'm2']);
    assert.equal(r.calls[0].msg.title, 'בוצעה: עובד e1');
  });

  it('מנהל שסגר משימה (open → done) או אישר (wait → done) – בלי התראה', async () => {
    const o = base({ to: ['e1'], ow: 'e1' });
    assert.equal((await run('tpz', o, Object.assign({}, o, { st: 'done', open: '' }), 'm2')).calls.length, 0);
    const w = Object.assign({}, o, { st: 'wait' });
    assert.equal((await run('tpz', w, Object.assign({}, w, { st: 'done', open: '' }), 'm1')).calls.length, 0);
  });

  it('החזרה לעובד עם תגובה (st + cAt באותה כתיבה) = התראה אחת למטפל, גוף = התגובה', async () => {
    const o = base({ to: ['e1'], ow: 'e1', st: 'done', open: '', cAt: 5 });
    const r = await run('tpz', o, Object.assign({}, o, { st: 'open', open: '1', cAt: 10, cBy: 'm1', cN: 'm1', cT: 'חסר צילום', note: 'חסר צילום', rt: '1' }), 'm1');
    assert.equal(r.out.k, 'back');
    assert.deepEqual(r.to, ['e1']);
    assert.deepEqual(r.calls.map((c) => c.msg.title), ['המשימה הוחזרה אליך']);
    assert.equal(r.calls[0].msg.body, 'חסר צילום');
    // משימת עובד (role 'w', בלי to) – ליוצר
    const w = base({ owner: 'e2', by: 'e2', role: 'w', st: 'wait' });
    assert.deepEqual((await run('tpz', w, Object.assign({}, w, { st: 'open', note: 'שוב' }), 'm1')).to, ['e2']);
  });

  it('תגובת מנהל – למטפל ("<שם>: <תגובה>"); תגובת עובד – למנהלים', async () => {
    const o = base({ to: ['e1', 'e2'], ow: '' });
    let r = await run('tpz', o, Object.assign({}, o, { cAt: 9, cBy: 'm1', cN: 'משה', cT: 'מה המצב?' }), 'm1');
    assert.equal(r.out.k, 'cm');
    assert.deepEqual(r.to, ['e1', 'e2']);
    assert.deepEqual(r.calls[0].msg, { id: r.id, title: 'תגובה חדשה מהמנהל', body: 'משה: מה המצב?' });
    const c = base({ to: ['e1'], ow: 'e1' });
    r = await run('tpz', c, Object.assign({}, c, { cAt: 9, cBy: 'e1', cN: 'e1x', cT: 'אין מלאי' }), 'e1');
    assert.deepEqual(r.to, ['m1', 'm2']);
    assert.deepEqual(r.calls[0].msg, { id: r.id, title: 'תגובה חדשה מעובד e1', body: 'אין מלאי' });
  });

  it('תגובת עובד = 3 כתיבות (nc, תגובה, cAt) – התראה אחת לכל מנהל', async () => {
    const o = base({ to: ['e1'], ow: 'e1' });
    const s1 = Object.assign({}, o, { nc: '1' });
    const s2 = Object.assign({}, s1, { cAt: 9, cBy: 'e1', cT: 'הערה', cN: 'e1' });
    assert.equal((await run('tpz', o, s1, 'e1')).calls.length, 0, 'סימון nc – בלי התראה');
    const r = await run('tpz', s1, s2, 'e1');
    assert.equal(r.out.k, 'cm');
    assert.deepEqual(r.to, ['m1', 'm2'], 'התראה אחת לכל מנהל');
  });

  it('בלי התראה: נקרא (rd), תפיסה, סימון רשימה (ckd), nc, תגובה בלי cAt חדש', async () => {
    const o = base({ to: ['e1', 'e2'], ow: '', cAt: 5, cBy: 'e1' });
    for (const p of [{ rd: { e1: 3 } }, { ow: 'e1', owN: 'x', clt: 3 }, { ckd: [0] }, { nc: '1' }, { cAt: 5, cBy: 'e2' }, { cAt: 4, cBy: 'm1' }]) {
      const a = Object.assign({}, o, p);
      assert.equal(G.trig(o, a), false, JSON.stringify(p));
      assert.equal((await run('tpz', o, a, 'e1')).calls.length, 0, JSON.stringify(p));
    }
  });

  it('מסננים: לא למי שעשה, לא לעובד מושבת; תוספת כבויה; שורש רק ב-legacy; שבת', async () => {
    const r = await run('tpz', null, base({ owner: 'm1', to: ['m1'], toN: ['x'], ow: 'm1' }), 'm1');
    assert.equal(r.calls.length, 0, 'רק היוצר');
    assert.equal((await run('tpz', null, base({ to: ['eoff'], toN: ['x'], ow: 'eoff' }), 'm1')).calls.length, 0, 'מושבת');
    const nw = base({ to: ['e1'], toN: ['x'], ow: 'e1' });
    assert.equal((await run('tnz', null, nw, 'm1')).out.r, 'feature-off');
    const sh = await run('tpz', null, Object.assign({}, nw, { cr: z(2026, 11, 20, 18) }), 'm1', z(2026, 11, 20, 18));
    assert.equal(sh.out.r, 'quiet');
    assert.equal(sh.calls.length, 0);
    // שורש (legacy) – עובד; אחרי המעבר (dataRoot 'b') – לא
    const root = await run(null, null, nw, 'm1');
    assert.deepEqual(root.to, ['e1']);
    await prep((d) => d.doc('b/largpeami').set({ name: 'x', status: 'active', dataRoot: 'b', features: { tasks: true } }));
    const r2 = await run(null, null, nw, 'm1');
    assert.equal(r2.out.r, 'not-legacy');
    assert.equal(r2.calls.length, 0);
  });

  it('evOf – הטבלה (פונקציה טהורה)', () => {
    const A = new Set(['m1']);
    const o = base({ to: ['e1'], ow: 'e1' });
    assert.equal(G.evOf(null, base({ to: ['e1'], rc: 'r' }), 'm1', A), null);
    assert.equal(G.evOf(o, null, 'm1', A), null);
    assert.equal(G.evOf(o, Object.assign({}, o, { st: 'done' }), '', A).actor, 'e1');
    assert.equal(G.evOf(o, Object.assign({}, o, { st: 'done' }), 'm1', A), null);
    assert.equal(G.evOf(null, base({}), 'm1', A), null, 'משימה ישנה בלי to');
    const old = base({ st: 'done' });
    assert.deepEqual(G.evOf(old, Object.assign({}, old, { st: 'open' }), 'm1', A).to, [], 'ישנה בלי to ובלי ow – אין למי');
  });

  it('הפרדה בין עסקים: אירוע ב-tpz לא מגיע לטלפון של tnz (גם כשבשניהם התוספת פעילה)', async () => {
    await prep((d) => d.doc('b/tnz').set({ features: { tasks: true } }, { merge: true }));
    const r = await run('tpz', null, base({ to: ['e1', 'e2'], toN: ['a', 'b'], ow: '' }), 'm1');
    assert.deepEqual(r.to, ['e1', 'e2']);
    assert.ok(r.calls.every((c) => c.toks.every((t) => t.startsWith('fcm_tpz_'))));
    const w = await run('tnz', null, base({ owner: 'e1', by: 'e1', role: 'w' }), 'e1');
    assert.deepEqual(w.to, ['m1', 'm2']); // who() כבר וידא שכל הטלפונים של tnz
  });

  it('טקסט ישן לא מוצג: דחייה (רק note) – גוף = ההערה החדשה ולא התגובה הקודמת; בלי note/cT חדשים – טקסט המשימה', async () => {
    const o = base({ to: ['e1'], ow: 'e1', st: 'wait', cAt: 5, cBy: 'm1', cN: 'משה', cT: 'תגובה ישנה', note: '' });
    let r = await run('tpz', o, Object.assign({}, o, { st: 'open', img: '', sub: 0, doneBy: '', note: 'התמונה מטושטשת', rt: '' }), 'm1');
    assert.equal(r.out.k, 'back');
    assert.equal(r.calls[0].msg.body, 'התמונה מטושטשת');
    const n = Object.assign({}, o, { note: 'הערה ישנה' });
    r = await run('tpz', n, Object.assign({}, n, { st: 'open' }), 'm1');
    assert.equal(r.calls[0].msg.body, 'לסדר את המדף', 'note ו-cT לא השתנו');
  });

  it('טקסט ישן לא מוצג בתגובה: כתיבה של cAt/cBy בלבד – גוף כללי; שם המנהל מ-staff כש-cN לא השתנה', async () => {
    const o = base({ to: ['e1'], ow: 'e1', cAt: 5, cBy: 'e1', cN: 'ישן', cT: 'תגובה ישנה' });
    let r = await run('tpz', o, Object.assign({}, o, { cAt: 9, cBy: 'm1' }), 'm1');
    assert.deepEqual(r.calls[0].msg, { id: r.id, title: 'תגובה חדשה מהמנהל', body: 'לסדר את המדף' });
    r = await run('tpz', o, Object.assign({}, o, { cAt: 9, cBy: 'e1' }), 'e1');
    assert.deepEqual(r.calls[0].msg, { id: r.id, title: 'תגובה חדשה מעובד e1', body: 'לסדר את המדף' });
    const m = base({ to: ['e1'], ow: 'e1', cAt: 5, cBy: 'm1', cN: 'משה', cT: 'ישן' });
    r = await run('tpz', m, Object.assign({}, m, { cAt: 9, cBy: 'm1', cT: 'חדש' }), 'm1');
    assert.equal(r.calls[0].msg.body, 'המנהל: חדש', 'cN זהה לקודם – השם מ-staff/m1');
  });

  it('משימת מייל של המזכירה (ml, owner ריק, נמענים = מנהלים) – בלי התראה; משימה חדשה – רק לעובדים', async () => {
    const mail = base({ owner: '', by: 'המזכירה', to: ['m1', 'm2'], toN: ['a', 'b'], ow: '', ml: 'msg1', np: 0, wp: 0, mi: 0 });
    let r = await run('tpz', null, mail, '');
    assert.equal(r.calls.length, 0);
    assert.equal(r.out.r, 'none');
    assert.equal((await run('tpz', null, Object.assign({}, mail, { to: ['e1'], ml: '' }), '')).calls.length, 0, 'owner ריק');
    assert.equal((await run('tpz', null, Object.assign({}, mail, { owner: 'm1', to: ['e1'] }), 'm1')).calls.length, 0, 'ml');
    r = await run('tpz', null, base({ to: ['e1', 'm2', 'sa'], toN: ['a', 'b', 'c'], ow: '' }), 'm1');
    assert.deepEqual(r.to, ['e1'], 'מנהל ומנהל־על ברשימת הנמענים – לא מקבלים');
  });

  it('יצירה: רק פתוחה ורק עם cr בטווח 10 דקות (מסמך ישן שהועתק / migrate – בלי התראה)', async () => {
    const t = (o) => base(Object.assign({ to: ['e1'], toN: ['x'], ow: 'e1' }, o));
    assert.equal((await run('tpz', null, t({ cr: WED - 9 * 60000 }), 'm1')).calls.length, 1, '9 דקות');
    assert.equal((await run('tpz', null, t({ cr: WED - 11 * 60000 }), 'm1')).out.r, 'skip', '11 דקות');
    assert.equal((await run('tpz', null, t({ cr: WED + 11 * 60000 }), 'm1')).calls.length, 0, 'בעתיד');
    assert.equal((await run('tpz', null, t({ cr: 0 }), 'm1')).calls.length, 0, 'בלי cr');
    assert.equal((await run('tpz', null, t({ st: 'done' }), 'm1')).calls.length, 0, 'לא פתוחה');
    assert.equal((await run('tpz', null, base({ owner: 'e1', role: 'w', cr: WED - 3600000 }), 'e1')).calls.length, 0, 'משימת עובד ישנה');
    assert.equal((await runP('tpz', { owner: 'e2', by: 'e2', txt: 'x', cr: WED - 3600000 })).calls.length, 0, 'פרטית ישנה');
    assert.equal((await runP('tpz', { owner: 'e2', by: 'e2', txt: 'x', st: 'done' })).calls.length, 0, 'פרטית לא פתוחה');
  });

  it('מנהל־על = מנהל: סגירה / תגובה שלו לא נשלחות למנהלים כאילו עובד; לא מקבל התראה כעובד', async () => {
    const o = base({ to: ['e1'], ow: 'e1' });
    assert.equal((await run('tpz', o, Object.assign({}, o, { st: 'done', open: '' }), 'sa')).calls.length, 0, 'סגירה');
    const r = await run('tpz', o, Object.assign({}, o, { cAt: 9, cBy: 'sa', cN: 'ספק', cT: 'בדיקה' }), 'sa');
    assert.equal(r.out.k, 'cm');
    assert.deepEqual(r.to, ['e1'], 'תגובה של מנהל־על – לעובד, לא למנהלים');
    const s = base({ to: ['sa'], ow: 'sa', st: 'done' });
    assert.equal((await run('tpz', s, Object.assign({}, s, { st: 'open', note: 'שוב' }), 'm1')).calls.length, 0, 'הוחזרה למנהל־על');
    assert.equal((await run('tpz', s, Object.assign({}, s, { st: 'open', cAt: 9, cBy: 'm1', cT: 'x' }), 'm1')).calls.length, 0);
    assert.equal((await runP('tpz', { owner: 'sa', by: 'sa', txt: 'x' })).calls.length, 0, 'פרטית של מנהל־על');
    assert.equal((await run('tpz', null, base({ owner: 'sa', by: 'sa', role: 'w' }), 'sa')).calls.length, 0, 'משימת "עובד" של מנהל־על');
  });

  it('runTk / runPtk: המבצע לפי authType/authId; שגיאה לא יוצאת החוצה', async () => {
    const calls = [];
    const opts = { now: WED, send: async (toks, msg, tag) => { calls.push({ toks, msg, tag }); return toks.map((t) => ({ token: t, ok: true })); } };
    const sn = (d) => ({ exists: true, data: () => d });
    const o = base({ to: ['e1'], ow: 'e1' }), dn = Object.assign({}, o, { st: 'done', open: '' });
    const ev = (authType, authId) => ({ params: { id: 'w' + (++seq) }, authType, authId, data: { before: sn(o), after: sn(dn) } });
    let out = await G.runTk('tpz', ev('app_user', 'm2'), opts);
    assert.equal(out.r, 'none', 'מנהל סגר – app_user');
    assert.equal(calls.length, 0);
    out = await G.runTk('tpz', ev('service_account', 'm2'), opts);
    assert.equal(out.k, 'done', 'כתיבת שרת – המבצע = ow, לא authId');
    assert.deepEqual(who(calls, 'tpz'), ['m1', 'm2']);
    out = await G.runTk('tpz', ev('app_user', 'bad id!'), opts);
    assert.equal(out.k, 'done', 'authId לא תקין = שרת');
    calls.length = 0;
    out = await G.runPtk('tpz', { params: { id: 'p' + (++seq) }, data: sn({ owner: 'e2', by: 'e2', txt: 'x', st: 'open', cr: WED }) }, opts);
    assert.equal(out.k, 'ptk');
    assert.deepEqual(who(calls, 'tpz'), ['m1', 'm2']);
    const boom = { exists: true, data: () => { throw new Error('boom'); } };
    assert.equal(await G.runTk('tpz', { params: { id: 'x1' }, authType: 'app_user', authId: 'e1', data: { before: null, after: boom } }, opts), undefined);
    assert.equal(await G.runTk('tpz', {}, opts), undefined, 'אירוע בלי params');
    assert.equal(await G.runPtk('tpz', { params: { id: 'x2' }, data: boom }, opts), undefined);
    const thr = Object.assign({}, opts, { send: async () => { throw new Error('fcm'); } });
    out = await G.runTk('tpz', ev('app_user', 'e1'), thr);
    assert.equal(out.sent, 0, 'כשל בשליחה – נרשם, לא נזרק');
  });
});
