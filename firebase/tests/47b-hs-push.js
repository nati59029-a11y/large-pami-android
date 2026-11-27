'use strict';
// אישור חוסרים (27.11.2026): התראה על חוסר חדש שממתין לאישור – hsPush / hsPushB (hs-push.js).
// הליבה נבדקת ישירות מול האמולטור, עם שליחה מדומה (כמו 46-tasks-push.js).
const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const K = require('../functions/lib/tk-time.js');

const z = (y, m, d, hh, mm) => K.zoned(y, m - 1, d, hh, mm || 0); // שעון ישראל
const WED = z(2026, 11, 18, 10); // יום רביעי רגיל – לא שקט

describe('hsPush – התראה על חוסר שממתין לאישור (שרת, שליחה מדומה)', { skip: !process.env.FIRESTORE_EMULATOR_HOST && 'אמולטור Firestore לא רץ' }, () => {
  let env, G;
  const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
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
    G = require('../functions/hs-push.js')._core;
  });
  beforeEach(async () => {
    await env.clearFirestore();
    await prep(async (d) => {
      const b = d.batch();
      b.set(d.doc('b/hpz'), { name: 'hpz', status: 'active', dataRoot: 'b', features: { suppliers: true } });
      b.set(d.doc('b/hnz'), { name: 'hnz', status: 'active', dataRoot: 'b', features: { suppliers: false } });
      for (const biz of ['hpz', 'hnz']) {
        const P = 'b/' + biz + '/';
        for (const m of ['m1', 'm2']) b.set(d.doc(P + 'admins/' + m), { email: m + '@x.invalid' });
        b.set(d.doc(P + 'staff/m1'), { name: 'המנהל', active: true, pushTokens: [tok(biz, 'm1')] });
        b.set(d.doc(P + 'push_tokens/m2'), { pushTokens: [tok(biz, 'm2')] });
        for (const [u, act, perms] of [['e1', true, null], ['e2', true, { prc: true }], ['ea', true, { hsA: true }], ['ed', true, { hsD: true }], ['eaoff', false, { hsA: true }]]) {
          b.set(d.doc(P + 'staff/' + u), Object.assign({ name: 'עובד ' + u, active: act, pushTokens: [tok(biz, u)] }, perms ? { perms } : {}));
        }
      }
      b.set(d.doc('admins/m1'), { email: 'm1@x.invalid' });
      b.set(d.doc('staff/m1'), { name: 'המנהל', active: true, pushTokens: [tok('root', 'm1')] });
      b.set(d.doc('staff/e1'), { name: 'דנה', active: true, pushTokens: [tok('root', 'e1')] });
      b.set(d.doc('staff/ea'), { name: 'רון', active: true, perms: { hsA: true }, pushTokens: [tok('root', 'ea')] });
      await b.commit();
    });
  });

  const item = (o) => Object.assign({ n: 'ניילון נצמד', nk: 'ניילון נצמד', gen: true, sups: [], supN: [], why: 'store', np: 0, st: 'pend', by: 'e1', byN: 'e1x', t: WED - 60000 }, o);
  const run = async (biz, d, now) => {
    const calls = [];
    const send = async (toks, msg, tag) => { calls.push({ toks, msg, tag }); return toks.map((t) => ({ token: t, ok: true })); };
    const id = 'h' + (++seq);
    const out = await G.onHs(biz, id, d, { send, now: now || WED });
    return { id, out, calls, to: who(calls, biz) };
  };

  it('חוסר ממתין של עובד – לכל המנהלים ולעובד פעיל עם hsA; לא ליוצר, לא ל-hsD / prc / מושבת; כותרת וגוף; tag hs_<id>', async () => {
    const r = await run('hpz', item());
    assert.equal(r.out.k, 'hs');
    assert.deepEqual(r.to, ['ea', 'm1', 'm2']);
    assert.deepEqual(r.calls[0].msg, { id: r.id, title: 'חוסר חדש לאישור', body: 'ניילון נצמד · עובד e1' });
    assert.equal(r.calls[0].tag, 'hs_' + r.id);
  });

  it('היוצר הוא מאשר (hsA) – לא מקבל על עצמו; שם המוסיף מ-byN כשאין staff', async () => {
    assert.deepEqual((await run('hpz', item({ by: 'ea' }))).to, ['m1', 'm2']);
    const r = await run('hpz', item({ by: 'ghost', byN: 'רוח' }));
    assert.equal(r.calls[0].msg.body, 'ניילון נצמד · רוח');
  });

  it('בלי התראה: חוסר open, נדחה, ישן (t לפני יותר מ-10 דקות), בלי by; תוספת כבויה; שבת', async () => {
    for (const d of [item({ st: 'open' }), item({ st: 'rej' }), item({ t: WED - 11 * 60000 }), item({ by: '' }), null]) {
      const r = await run('hpz', d);
      assert.equal(r.out.r, 'skip');
      assert.equal(r.calls.length, 0);
    }
    assert.equal((await run('hnz', item())).out.r, 'feature-off');
    const sh = await run('hpz', item({ t: z(2026, 11, 20, 18) }), z(2026, 11, 20, 18));
    assert.equal(sh.out.r, 'quiet');
    assert.equal(sh.calls.length, 0);
  });

  it('שורש (legacy): מנהל + עובד עם hsA; אחרי המעבר (dataRoot b) – לא', async () => {
    const r = await run(null, item());
    assert.deepEqual(r.to, ['ea', 'm1']);
    await prep((d) => d.doc('b/largpeami').set({ name: 'x', status: 'active', dataRoot: 'b', features: { suppliers: true } }));
    const r2 = await run(null, item());
    assert.equal(r2.out.r, 'not-legacy');
    assert.equal(r2.calls.length, 0);
  });

  it('runHs: אירוע יצירה; שגיאה לא יוצאת החוצה', async () => {
    const calls = [];
    const opts = { now: WED, send: async (toks, msg, tag) => { calls.push({ toks, msg, tag }); return toks.map((t) => ({ token: t, ok: true })); } };
    const out = await G.runHs('hpz', { params: { id: 'x' + (++seq) }, data: { data: () => item() } }, opts);
    assert.equal(out.k, 'hs');
    assert.deepEqual(who(calls, 'hpz'), ['ea', 'm1', 'm2']);
    assert.equal(await G.runHs('hpz', { params: { id: 'x2' }, data: { data: () => { throw new Error('boom'); } } }, opts), undefined);
    assert.equal(await G.runHs('hpz', {}, opts), undefined, 'אירוע בלי params');
    const thr = Object.assign({}, opts, { send: async () => { throw new Error('fcm'); } });
    assert.equal((await G.runHs('hpz', { params: { id: 'x3' }, data: { data: () => item() } }, thr)).sent, 0, 'כשל בשליחה – נרשם, לא נזרק');
  });
});
