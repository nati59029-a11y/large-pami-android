'use strict';
// מסמכים ללקוח (14.11.2026, שלב 3 חלק א'): arFile (קישור עם אסימון לקובץ PDF) ו-ar-send.sendMail (מייל עם קובץ מצורף).
// arFile נקראת בכתובת האמולטור (הפונקציה האמיתית). הקישורים והקבצים נוצרים בתהליך הבדיקה דרך ar-file._core (Admin).
// מייל – transport מדומה בלבד (אין שום חיבור SMTP).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fsm = require('node:fs');
const path = require('node:path');
const H = require('./helpers');

const FN_EMU = JSON.parse(fsm.readFileSync(path.join(H.ROOT, 'firebase.json'), 'utf8')).emulators.functions;
const HOST = process.env.FUNCTIONS_EMULATOR_HOST || `${FN_EMU.host}:${FN_EMU.port}`;
const URL0 = `http://${HOST}/${H.PROJECT_ID}/us-central1/arFile`;
const BIZ = 'biz-arf';
const DAY = 864e5;

let env, F, S, P, BUCKET, PDF;
const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
async function get(p) { let v = null; await prep(async (d) => { const s = await d.doc(p).get(); v = s.exists ? s.data() : null; }); return v; }
const fetchT = (t, m) => fetch(URL0 + (t == null ? '' : '?t=' + encodeURIComponent(t)), { method: m || 'GET' });
const store = () => require(require.resolve('firebase-admin/storage', { paths: [path.join(H.ROOT, 'functions')] })).getStorage();

before(async () => {
  env = await H.getEnv();
  require('../functions/index.js');
  F = require('../functions/ar-file.js')._core;
  S = require('../functions/lib/ar-send.js');
  P = require('../functions/lib/ar-pdf.js');
  // הדלי שהפונקציה באמולטור קוראת ממנו כברירת מחדל (FIREBASE_CONFIG של האמולטור)
  BUCKET = (JSON.parse(process.env.FIREBASE_CONFIG || '{}').storageBucket) || `${H.PROJECT_ID}.appspot.com`;
  PDF = await P.render({ t: 'oc', no: 1, d: '2026-11-14', biz: { name: 'עסק' }, cust: { name: 'יוסי כהן' }, vm: 'inc', rate: 18, lines: [{ n: 'מוצר', q: 1, p: 10 }] });
});
after(async () => { try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });

describe('arFile: קישור עם אסימון (32 בתים, נשמר כגיבוב, 180 יום)', () => {
  it('קישור תקין – הקובץ (application/pdf), בלי מטמון; האסימון לא נשמר במסד – רק הגיבוב', async () => {
    const p = await F.put(BIZ, 'doc1', PDF, { bucket: BUCKET });
    assert.equal(p, `ar/${BIZ}/doc1.pdf`);
    const l = await F.mkLink({ biz: BIZ, id: 'doc1', n: 'אישור הזמנה 1.pdf' });
    assert.match(l.token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(Buffer.from(l.token, 'base64url').length, 32);
    assert.ok(/us-central1.*\/arFile\?t=/.test(l.url) && l.url.endsWith('?t=' + l.token), l.url);
    assert.equal(F.urlOf('T', { project: 'p1' }), process.env.FUNCTIONS_EMULATOR === 'true' ? F.urlOf('T', { project: 'p1' }) : 'https://us-central1-p1.cloudfunctions.net/arFile?t=T');
    const d = await get(`arlink/${l.h}`);
    assert.equal(d.biz, BIZ); assert.equal(d.p, p); assert.equal(d.doc, 'doc1');
    assert.ok(Math.abs(d.exp - (d.at + 180 * DAY)) < 1000, '180 יום');
    assert.ok(!JSON.stringify(d).includes(l.token), 'האסימון עצמו לא נשמר');
    assert.equal(l.h, require('node:crypto').createHash('sha256').update(l.token).digest('hex'));
    const r = await fetchT(l.token);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/pdf');
    assert.match(r.headers.get('cache-control'), /no-store/);
    assert.match(r.headers.get('content-disposition'), /filename\*=UTF-8''/);
    const b = Buffer.from(await r.arrayBuffer());
    assert.ok(b.equals(PDF));
  });
  it('אסימון שגוי / חסר / בפורמט לא תקין / שפג תוקפו / שבוטל / שמצביע לעסק אחר / קובץ חסר – 404 אחיד', async () => {
    await F.put(BIZ, 'doc2', PDF, { bucket: BUCKET });
    const old = await F.mkLink({ biz: BIZ, id: 'doc2', now: Date.now() - 181 * DAY });
    const gone = await F.mkLink({ biz: BIZ, id: 'doc2' });
    assert.equal(await F.revoke(gone.h), true);
    const miss = await F.mkLink({ biz: BIZ, id: 'nofile' });
    // רשומה שזויפה כך שתצביע לקובץ של עסק אחר – נדחית לפי הנתיב
    const crypto = require('node:crypto');
    const tok = crypto.randomBytes(32).toString('base64url');
    await prep((d) => d.doc('arlink/' + F.hashOf(tok)).set({ biz: 'biz-other', p: `ar/${BIZ}/doc2.pdf`, doc: 'doc2', n: 'x.pdf', exp: Date.now() + DAY, at: Date.now() }));
    const wrong = crypto.randomBytes(32).toString('base64url');
    const bodies = new Set();
    for (const t of [wrong, null, '', 'short', 'a'.repeat(44), '../../etc/passwd', old.token, gone.token, miss.token, tok]) {
      const r = await fetchT(t);
      assert.equal(r.status, 404, String(t));
      bodies.add(await r.text());
    }
    assert.equal(bodies.size, 1, 'אותה תשובה לכל סוג כשל – בלי רמז מה נכשל');
    const ok = await F.mkLink({ biz: BIZ, id: 'doc2' });
    assert.equal((await fetchT(ok.token)).status, 200, 'אותו קובץ עם קישור תקין – עובד');
    assert.equal((await fetchT(ok.token, 'POST')).status, 405);
  });
  it('שמירת קובץ: רק PDF, נתיב תקין בלבד', async () => {
    await assert.rejects(F.put(BIZ, 'x', Buffer.from('<html>'), { bucket: BUCKET }));
    await assert.rejects(F.put('../x', 'x', PDF, { bucket: BUCKET }));
    await assert.rejects(F.put(BIZ, '../../x', PDF, { bucket: BUCKET }));
    const [m] = await store().bucket(BUCKET).file(`ar/${BIZ}/doc1.pdf`).getMetadata();
    assert.equal(m.contentType, 'application/pdf');
  });
});

describe('ar-send.sendMail: מייל עם קובץ מצורף, מונה נפרד מ-mailRate (transport מדומה)', () => {
  const sent = [];
  const deps = {
    secrets: () => ({ user: 'sender@example.invalid', pass: 'app-password-123' }),
    smtp: () => ({ host: 'smtp.example.invalid', port: '465', from: '' }),
    transport: () => ({ sendMail: async (m) => { sent.push(m); return { messageId: 'x' }; }, close() {} }),
  };
  const base = { to: 'Customer@Example.invalid', subject: 'אישור הזמנה 1042', text: 'שלום,\nמצורף אישור ההזמנה. <b>תודה</b>', replyTo: 'office@biz.invalid', fromName: 'לארג׳ פעמי', fileName: 'אישור-הזמנה-1042.pdf' };
  it('נשלח עם PDF מצורף, Reply-To של העסק, HTML מוגן, ונרשם במונה arMailRate (לא ב-mailRate)', async () => {
    const r = await S.sendMail(BIZ, Object.assign({ pdf: PDF }, base), deps);
    assert.deepEqual([r.ok, r.ch, r.to], [true, 'mail', 'customer@example.invalid']);
    const m = sent[0];
    assert.equal(m.to, 'customer@example.invalid'); assert.equal(m.replyTo, 'office@biz.invalid');
    assert.deepEqual(m.from, { name: 'לארג׳ פעמי', address: 'sender@example.invalid' });
    assert.equal(m.attachments.length, 1); assert.equal(m.attachments[0].contentType, 'application/pdf'); assert.ok(m.attachments[0].content.equals(PDF));
    assert.ok(m.html.includes('&lt;b&gt;') && !m.html.includes('<b>'), 'HTML מוגן');
    assert.equal((await get(`arMailRate/b-${BIZ}`)).h.n, 1);
    assert.equal(await get(`mailRate/b-${BIZ}`), null, 'המונה של מייל ההזמנה לא נגע');
  });
  it('כתובת לא תקינה / בלי PDF / בלי סודות / מעל המכסה / כשל שליחה – לא נשלח, עם סיבה', async () => {
    const n0 = sent.length;
    assert.equal((await S.sendMail(BIZ, Object.assign({}, base, { to: 'a@b', pdf: PDF }), deps)).why, 'bad-to');
    assert.equal((await S.sendMail(BIZ, Object.assign({}, base, { to: 'x@y.com\r\nBcc: z@z.com', pdf: PDF }), deps)).why, 'bad-to');
    assert.equal((await S.sendMail(BIZ, Object.assign({}, base), deps)).why, 'bad-pdf');
    assert.equal((await S.sendMail(BIZ, Object.assign({ pdf: PDF }, base), Object.assign({}, deps, { secrets: () => null }))).why, 'no-secrets');
    await prep((d) => d.doc(`arMailRate/b-${BIZ}`).set({ h: { t: Date.now(), n: 30 }, d: { t: Date.now(), n: 30 } }));
    assert.equal((await S.sendMail(BIZ, Object.assign({ pdf: PDF }, base), deps)).why, 'rate');
    assert.equal(sent.length, n0);
    await prep((d) => d.doc(`arMailRate/b-${BIZ}`).delete());
    const f = await S.sendMail(BIZ, Object.assign({ pdf: PDF }, base), Object.assign({}, deps, { transport: () => ({ sendMail: async () => { throw Object.assign(new Error('535 auth sender@example.invalid'), { code: 'EAUTH' }); } }) }));
    assert.deepEqual([f.ok, f.why], [false, 'send']);
  });
});
