'use strict';
// דף הפתיחה (2026-11-08): publicBrand מחזיר רק name/logo/colors/apkTag; עסק מושהה/חסר = 404; הגבלת קצב 429; bizId לא תקין = 400.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
let env, PB;
const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
function call(biz, ip, method) {
  return new Promise((done) => {
    const res = { h: {}, code: 0, set(k, v) { this.h[k] = v; return this; }, status(c) { this.code = c; return this; },
      json(b) { done({ code: this.code, body: b, h: this.h }); }, send(b) { done({ code: this.code, body: b, h: this.h }); } };
    PB.handle({ method: method || 'GET', ip: ip || '1.1.1.1', headers: {}, query: { biz } }, res, Date.now()).catch((e) => done({ code: -1, e }));
  });
}
before(async () => {
  env = await H.getEnv(); require('../functions/index.js'); PB = require('../functions/public-brand')._core;
  await env.clearFirestore();
  await prep(async (db) => {
    await db.doc('b/pb-a').set({ name: 'עסק א', status: 'active', dataRoot: 'b', apkTag: 'biz-pb-a', features: {},
      brand: { name: 'המותג א', logoPath: '', colors: { acc: '#AABBCC', bg: 'red', evil: '#000000' }, base: 'dark-gold' } });
    await db.doc('b/pb-a/private/info').set({ ownerEmail: 'secret@example.invalid', ownerPhone: '0500000000' });
    await db.doc('b/pb-s').set({ name: 'מושהה', status: 'suspended', dataRoot: 'b', brand: { name: 'ס' } });
    await db.doc('b/pb-x').set({ name: 'זר', status: 'active', dataRoot: 'b', apkTag: 'biz-other', brand: {} });
  });
});
after(async () => { try { env.cleanup(); } catch (e) { /* */ } });

describe('publicBrand – קריאה ציבורית מינימלית', () => {
  it('מחזיר רק name/logo/colors/apkTag, צבעים מסוננים, בלי שדות פרטיים', async () => {
    const r = await call('pb-a', '9.9.9.1');
    assert.equal(r.code, 200);
    assert.deepEqual(Object.keys(r.body).sort(), ['apkTag', 'colors', 'logo', 'name']);
    assert.equal(r.body.name, 'המותג א');
    assert.deepEqual(r.body.colors, { acc: '#aabbcc' });
    assert.equal(r.body.apkTag, 'biz-pb-a');
    assert.ok(!JSON.stringify(r.body).includes('secret@'));
  });
  it('apkTag של עסק אחר לא יוצא – latest', async () => { assert.equal((await call('pb-x', '9.9.9.2')).body.apkTag, 'latest'); });
  it('עסק מושהה או חסר – 404 אחיד; מזהה לא תקין – 400; POST – 405', async () => {
    assert.equal((await call('pb-s', '9.9.9.3')).code, 404);
    assert.equal((await call('pb-none', '9.9.9.3')).code, 404);
    assert.equal((await call('../x', '9.9.9.3')).code, 400);
    assert.equal((await call('pb-a', '9.9.9.3', 'POST')).code, 405);
  });
  it('הגבלת קצב: יותר מ-30 בקשות בדקה מאותה כתובת – 429', async () => {
    let last; for (let i = 0; i < 31; i++) last = await call('pb-a', '7.7.7.7');
    assert.equal(last.code, 429);
    assert.equal((await call('pb-a', '7.7.7.8')).code, 200);
  });
});
