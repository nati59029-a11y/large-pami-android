'use strict';
// requestBizApk (12.11.2026): רק מנהל־על, עסק במבנה החדש, לוגו או noLogo מפורש, בנייה אחת בכל פעם, בלי מפתח – לא קורה כלום.
// הפנייה ל-GitHub מדומה (fetch מוזרק) – אין פנייה אמיתית.
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
let env, M;
const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
const TOKEN = 'github_pat_' + 'A'.repeat(40);
const req = (uid, data) => ({ auth: uid ? { uid } : null, data });
async function code(p) { try { await p; return 'OK'; } catch (e) { return (e.details && e.details.reason) || e.code || String(e); } }
function fake(o) {
  const calls = [];
  return { calls, deps: Object.assign({ token: () => TOKEN, now: () => 1e12, fetch: async (u, opt) => { calls.push({ u, opt }); return { status: (o && o.status) || 204 }; } }, (o && o.deps) || {}) };
}
async function docOf(p) { let d; await prep(async (db) => { d = (await db.doc(p).get()).data(); }); return d; }

before(async () => { env = await H.getEnv(); require('../functions/index.js'); M = require('../functions/biz-apk')._core; });
after(async () => { try { env.cleanup(); } catch (e) { /* */ } });
beforeEach(async () => {
  await env.clearFirestore();
  await prep(async (db) => {
    await db.doc('superadmins/u_super').set({});
    await db.doc('b/withlogo').set({ name: 'א', status: 'active', dataRoot: 'b', brand: { name: 'עסק א', logoPath: 'b/withlogo/brand/logo' } });
    await db.doc('b/nologo').set({ name: 'ב', status: 'active', dataRoot: 'b', brand: { name: 'עסק ב', logoPath: '' } });
    await db.doc('b/withlogo/admins/a_mgr').set({ email: 'm@example.invalid' });
    await db.doc('users/a_mgr').set({ bizId: 'withlogo', role: 'admin', active: true, bizStatus: 'active' });
  });
});

describe('requestBizApk', () => {
  it('מנהל־על, עסק עם לוגו: מסמן building ומפעיל את build-biz-apks מ-main עם only=<עסק> ו-publish', async () => {
    const f = fake();
    assert.deepEqual(await M.requestBizApk(req('u_super', { bizId: 'withlogo' }), f.deps), { ok: true, status: 'building' });
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].u, 'https://api.github.com/repos/nati59029-a11y/large-pami-android/actions/workflows/build-biz-apks.yml/dispatches');
    assert.deepEqual(JSON.parse(f.calls[0].opt.body), { ref: 'main', inputs: { publish: 'true', only: 'withlogo' } });
    assert.equal(f.calls[0].opt.headers.Authorization, 'Bearer ' + TOKEN);
    const d = await docOf('b/withlogo');
    assert.equal(d.apkState.st, 'building'); assert.equal(d.apkState.noLogo, false); assert.equal(d.apkState.rebuild, false); assert.equal(d.apkState.by, 'u_super');
  });
  it('לא מנהל־על (מנהל עסק / לא מחובר) – נדחה, בלי פנייה ל-GitHub ובלי שינוי', async () => {
    const f = fake();
    assert.equal(await code(M.requestBizApk(req('a_mgr', { bizId: 'withlogo' }), f.deps)), 'not-superadmin');
    assert.equal(await code(M.requestBizApk(req(null, { bizId: 'withlogo' }), f.deps)), 'not-signed-in');
    assert.equal(f.calls.length, 0);
    assert.equal((await docOf('b/withlogo')).apkState, undefined);
  });
  it('בלי לוגו: נדחה (no-logo) עד שמנהל־העל בוחר noLogo; אז נבנה עם noLogo=true', async () => {
    const f = fake();
    assert.equal(await code(M.requestBizApk(req('u_super', { bizId: 'nologo' }), f.deps)), 'no-logo');
    assert.equal(f.calls.length, 0);
    assert.equal((await M.requestBizApk(req('u_super', { bizId: 'nologo', noLogo: true }), f.deps)).status, 'building');
    assert.equal((await docOf('b/nologo')).apkState.noLogo, true);
  });
  it('מזהה לא תקין, לארג\' פעמי, business ועסק שלא קיים – נדחים', async () => {
    const f = fake();
    for (const b of ['', 'A B', 'largpeami', 'business']) assert.equal(await code(M.requestBizApk(req('u_super', { bizId: b }), f.deps)), 'bad-biz', b);
    assert.equal(await code(M.requestBizApk(req('u_super', { bizId: 'nosuch' }), f.deps)), 'no-biz');
    assert.equal(f.calls.length, 0);
  });
  it('בנייה שכבר רצה (פחות מ-20 דקות) – לא מופעלת שוב; אחרי 20 דקות – כן', async () => {
    const f = fake();
    await M.requestBizApk(req('u_super', { bizId: 'withlogo' }), f.deps);
    assert.equal((await M.requestBizApk(req('u_super', { bizId: 'withlogo' }), f.deps)).status, 'already');
    assert.equal(f.calls.length, 1);
    const g = fake({ deps: { now: () => 1e12 + M.BUSY_MS + 1 } });
    assert.equal((await M.requestBizApk(req('u_super', { bizId: 'withlogo' }), g.deps)).status, 'building');
  });
  it('שתי בקשות באותו רגע – בנייה אחת בלבד (עסקה)', async () => {
    const f = fake();
    const r = await Promise.all([M.requestBizApk(req('u_super', { bizId: 'withlogo' }), f.deps), M.requestBizApk(req('u_super', { bizId: 'withlogo' }), f.deps)]);
    assert.deepEqual(r.map((x) => x.status).sort(), ['already', 'building']);
    assert.equal(f.calls.length, 1);
  });
  it('בנייה מחדש לעסק שכבר יש לו APK: rebuild=true', async () => {
    await prep((db) => db.doc('b/withlogo').update({ apkTag: 'biz-withlogo' }));
    await M.requestBizApk(req('u_super', { bizId: 'withlogo' }), fake().deps);
    assert.equal((await docOf('b/withlogo')).apkState.rebuild, true);
  });
  it('בלי מפתח תקין – no-token, בלי שינוי ובלי פנייה', async () => {
    for (const t of ['', 'unset', 'abc']) {
      const f = fake({ deps: { token: () => t } });
      assert.equal((await M.requestBizApk(req('u_super', { bizId: 'withlogo' }), f.deps)).status, 'no-token');
      assert.equal(f.calls.length, 0);
    }
    assert.equal((await docOf('b/withlogo')).apkState, undefined);
  });
  it('GitHub החזיר שגיאה – failed, והמפתח לא בתשובה', async () => {
    const r = await M.requestBizApk(req('u_super', { bizId: 'withlogo' }), fake({ status: 401 }).deps);
    assert.deepEqual(r, { ok: true, status: 'failed' });
    assert.ok(!JSON.stringify(r).includes('github_pat'));
    const d = await docOf('b/withlogo');
    assert.equal(d.apkState.st, 'failed'); assert.equal(d.apkState.why, 'http-401');
  });
  it('לקוח לא יכול לכתוב apkState בעצמו (חוקי Firestore)', async () => {
    const db = env.authenticatedContext('u_super').firestore();
    const { updateDoc, doc } = require('firebase/firestore');
    let denied = false; try { await updateDoc(doc(db, 'b/withlogo'), { apkState: { st: 'ready' } }); } catch (e) { denied = /permission/i.test(String(e.code || e.message)); }
    assert.ok(denied, 'כתיבה ישירה ל-b/{id} נחסמת');
  });
});
