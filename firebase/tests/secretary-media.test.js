'use strict';
// קול, תמונה וסרטון למזכירה (15.11.2026; תוכנית סעיף 3, שלבים 1–2): secMedia (stt / see / mark), secMediaClean, sec_cfg/media
// (secAdminSetCfg, secAdminGet, secState), via:'voice' ב-secChat. מול האמולטור, חלק מ-test:multibiz.
// secMedia רץ בתוך תהליך הבדיקה (כמו secretary-learn.test.js), כדי לכוון אותו ל-bucket של אמולטור ה-Storage.
// secState / secAdminSetCfg / secChat – דרך אמולטור הפונקציות (כמו secretary-chat.test.js). Gemini – דמה בלבד (gemini-mock, 127.0.0.1:9799).
process.env.FUNCTIONS_EMULATOR = 'true';
process.env.GEMINI_API_BASE = 'http://127.0.0.1:9799';
process.env.GEMINI_API_KEY = 'dummy-gemini-key-for-emulator';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fsm = require('node:fs');
const path = require('node:path');
const H = require('./helpers');
const GM = require('./gemini-mock');
const F = require('./media-fixtures');

const A = 'biz-md', B = 'biz-me';
const M1 = 'md_m1', M2 = 'md_m2', E1 = 'md_e1', SUPER = 'md_super', MB = 'md_mb';
const BUCKET = H.PROJECT_ID + '.appspot.com';
const FN_EMU = JSON.parse(fsm.readFileSync(path.join(H.ROOT, 'firebase.json'), 'utf8')).emulators.functions;
const fnUrl = (n) => `http://${process.env.FUNCTIONS_EMULATOR_HOST || `${FN_EMU.host}:${FN_EMU.port}`}/${H.PROJECT_ID}/us-central1/${n}`;
async function http(name, uid, data) {
  const headers = { 'Content-Type': 'application/json' };
  if (uid) headers.Authorization = 'Bearer ' + H.mockToken(uid);
  const r = await fetch(fnUrl(name), { method: 'POST', headers, body: JSON.stringify({ data: data || {} }) });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (e) { /* */ }
  return { status: j && j.error ? j.error.status : (r.ok ? 'OK' : 'HTTP_' + r.status), reason: j && j.error && j.error.details && j.error.details.reason, result: j && j.result };
}

let env, MD, SEC, AI, bucket;
const prep = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
async function get(p) { let v = null; await prep(async (d) => { const s = await d.doc(p).get(); v = s.exists ? s.data() : null; }); return v; }
async function coll(p) { let v = []; await prep(async (d) => { v = (await d.collection(p).get()).docs.map((x) => Object.assign({ id: x.id }, x.data())); }); return v; }
async function put(p, data, merge) { await prep((d) => d.doc(p).set(data, merge ? { merge: true } : undefined)); }
const req = (uid, data) => ({ auth: uid ? { uid, token: { email: uid + '@x.invalid' } } : undefined, data: data || {} });
async function call(uid, data) {
  try { return { ok: true, r: await MD.call.secMedia(BUCKET)(req(uid, data)) }; } catch (e) { return { ok: false, code: e.code, reason: e.details && e.details.reason, msg: e.message }; }
}
const b64 = (buf) => buf.toString('base64');
const exists = async (p) => (await bucket.file(p).exists())[0];
const upload = async (p, buf, ct) => { await bucket.file(p).save(buf, { resumable: false, contentType: ct || 'video/webm' }); return p; };
let seq = 0;
const tmp = (uid, biz, ext) => `b/${biz || A}/sec_tmp/${uid}/v${Date.now()}x${++seq}${ext === undefined ? '.webm' : ext}`;
const seeReqs = () => GM.state.requests.filter((r) => r.kind === 'sec');
const useMc = async () => { const u = await get(`b/${A}/sec_cfg/use`); return u ? u.mc || 0 : 0; };

// תשובת המודל לפי סוג הבקשה (STT / SEE). SEE = מה שהבדיקה קבעה
let SEE = { cls: 'other', conf: 0.9, reply: 'רואים מדף.', task: '' };
function mockSec(body) {
  const si = body.systemInstruction.parts[0].text;
  if (si.startsWith('SEC-CHAT-V1 STT')) return { text: 'כמה הכנסות היו היום' };
  if (si.startsWith('SEC-CHAT-V1 SEE')) return { text: JSON.stringify(SEE) };
  return { text: 'תשובה רגילה' };
}

async function seed(o) {
  const opt = Object.assign({ media: null, cap: null }, o);
  await env.clearFirestore();
  GM.reset(); GM.state.sec = mockSec;
  SEE = { cls: 'other', conf: 0.9, reply: 'רואים מדף.', task: '' };
  const ver = SEC.CONSENT_VER;
  await prep(async (d) => {
    const b = d.batch();
    b.set(d.doc('superadmins/' + SUPER), {});
    for (const [id, on] of [[A, true], [B, true]]) b.set(d.doc('b/' + id), { name: id, status: 'active', dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: SUPER, features: { tasks: true, secretary: on } });
    b.set(d.doc(`b/${A}/admins/${M1}`), { email: 'm1@md.example' });
    b.set(d.doc(`b/${A}/admins/${M2}`), { email: 'm2@md.example', br: ['b1'] }); // מנהל עם הגבלת סניפים
    b.set(d.doc(`b/${A}/staff/${E1}`), { name: 'דנה', role: 'employee', active: true });
    b.set(d.doc(`b/${B}/admins/${MB}`), { email: 'mb@me.example' });
    for (const [u, biz, role] of [[M1, A, 'admin'], [M2, A, 'admin'], [E1, A, 'worker'], [SUPER, A, 'admin'], [MB, B, 'admin']]) b.set(d.doc('users/' + u), { bizId: biz, role, active: true, bizStatus: 'active', email: u + '@x.invalid', createdAt: 1 });
    const mgr = {}; for (const u of [M1, M2]) mgr[u] = { cv: ver, ca: 1, nm: 'רותי', ad: 'f', call: 'נתי' };
    b.set(d.doc(`b/${A}/sec_cfg/main`), { mode: 'all', mainUid: '', emp: true, pay: {}, mgr });
    b.set(d.doc(`b/${B}/sec_cfg/main`), { mode: 'all', mainUid: '', emp: true, pay: {}, mgr: { [MB]: { cv: ver, ca: 1, nm: 'דנה', ad: 'm' } } });
    if (opt.media) b.set(d.doc(`b/${A}/sec_cfg/media`), opt.media);
    if (opt.cap !== null) b.set(d.doc(`b/${A}/sec_cfg/cap`), { capCents: opt.cap });
    await b.commit();
  });
}
// אין base64 ואין תוכן קובץ בשום מסמך שנשמר (sec_chat, sec_log)
async function assertNoFileContent() {
  const docs = (await coll(`b/${A}/sec_chat/${M1}/m`)).concat(await coll(`b/${A}/sec_log`));
  const s = JSON.stringify(docs);
  assert.ok(!/[A-Za-z0-9+/]{120,}/.test(s), 'נמצא רצף שנראה כמו base64 במסמך שמור');
  for (const x of await coll(`b/${A}/sec_log`)) if (x.act === 'media') assert.match(x.note, /^k=(aud|img|vid),s=\d+,kb=\d+/);
}

before(async () => {
  env = await H.getEnv(); await GM.start();
  require('../functions/index.js');
  MD = require('../functions/secretary-media.js')._core; SEC = require('../functions/secretary.js')._core; AI = require('../functions/lib/sec-ai.js');
  bucket = require(require.resolve('firebase-admin/storage', { paths: [path.join(H.ROOT, 'functions')] })).getStorage().bucket(BUCKET);
});
after(async () => { await GM.stop(); try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });

// ---------------------------------------------------------------------------------
describe('שלב 1: sec_cfg/media – מנהל־על קובע, secState מחזיר', () => {
  beforeEach(() => seed());
  it('ברירת מחדל ב-secState; מנהל־על משנה; מנהל העסק לא יכול; ערכים מחוץ לגבולות נדחים; null מחזיר לברירת המחדל', async () => {
    let s = await http('secState', M1, {});
    assert.equal(s.status, 'OK'); assert.deepEqual(s.result.media, { aud: 120, img: true, vid: 60 });
    assert.equal((await http('secAdminSetCfg', M1, { media: { aud: 30 } })).reason, 'not-superadmin');
    for (const bad of [{ aud: 301 }, { vid: 61 }, { aud: -1 }, { aud: 1.5 }, { img: 'yes' }, { x: 1 }, {}, [1], 'x']) {
      const r = await http('secAdminSetCfg', SUPER, { bizId: A, media: bad });
      assert.equal(r.reason, 'bad-media', JSON.stringify(bad));
    }
    assert.equal(await get(`b/${A}/sec_cfg/media`), null);
    const main0 = await get(`b/${A}/sec_cfg/main`);
    const r = await http('secAdminSetCfg', SUPER, { bizId: A, media: { aud: 30, vid: 0 } });
    assert.equal(r.status, 'OK'); assert.deepEqual(r.result.media, { aud: 30, img: true, vid: 0 });
    const m = await get(`b/${A}/sec_cfg/media`);
    assert.equal(m.aud, 30); assert.equal(m.vid, 0); assert.equal(m.img, true); assert.equal(m.updBy, SUPER);
    assert.deepEqual(await get(`b/${A}/sec_cfg/main`), main0, 'שינוי media בלבד לא נוגע ב-sec_cfg/main');
    s = await http('secState', M1, {});
    assert.deepEqual(s.result.media, { aud: 30, img: true, vid: 0 });
    assert.ok((await coll(`b/${A}/sec_log`)).some((x) => x.act === 'cfg' && /media=aud:30,img:1,vid:0/.test(x.note)));
    assert.equal((await http('secAdminSetCfg', SUPER, { bizId: A, media: null })).status, 'OK');
    assert.equal(await get(`b/${A}/sec_cfg/media`), null);
    const g = await http('secAdminGet', SUPER, { bizId: A });
    assert.deepEqual(g.result.media, { aud: 120, img: true, vid: 60 }); assert.equal(g.result.mediaSet, false);
  });
  it('secChat: via:"voice" נשמר רק בהודעת המשתמש; ערך אחר נדחה', async () => {
    const r = await http('secChat', M1, { text: 'שלום', via: 'voice' });
    assert.equal(r.status, 'OK');
    const msgs = await coll(`b/${A}/sec_chat/${M1}/m`);
    assert.equal(msgs.find((x) => x.role === 'u').via, 'voice');
    assert.equal(msgs.find((x) => x.role === 'a').via, undefined);
    assert.equal((await http('secChat', M1, { text: 'שלום', via: 'image' })).reason, 'bad-via');
    const l = await http('secChatLoad', M1, {});
    assert.equal(l.result.msgs.find((x) => x.role === 'u').via, 'voice');
  });
});

describe('שלב 1: op:"stt" – תמלול', () => {
  beforeEach(() => seed());
  it('תמלול מוחזר; העלות בתקרה = costMc בפועל; לא נשמרת הודעה; ביומן רק סוג, שניות, גודל ועלות', async () => {
    const r = await call(M1, { op: 'stt', mime: 'audio/wav', b64: b64(F.wav(10)) });
    assert.equal(r.ok, true, r.msg);
    assert.equal(r.r.text, 'כמה הכנסות היו היום'); assert.equal(r.r.sec, 10);
    // מחיר אודיו (לא מאומת): שרת הדמה לא מחזיר פירוט לפי סוג – כל הקלט נספר כאודיו (שמרני)
    assert.equal(await useMc(), AI.costMc('fast', { in: 1000, out: 200, aud: 1000 }));
    assert.equal(seeReqs().length, 1);
    assert.equal(seeReqs()[0].body.tools, undefined, 'בלי כלים');
    assert.deepEqual(await coll(`b/${A}/sec_chat/${M1}/m`), []);
    const lg = (await coll(`b/${A}/sec_log`)).filter((x) => x.act === 'media');
    assert.equal(lg.length, 1); assert.match(lg[0].note, /^k=aud,s=10,kb=\d+,mc=\d+$/);
    await assertNoFileContent();
  });
  it('WAV ארוך מהמגבלה – נדחה בלי AI ובלי שמירה מראש; מגבלה שמנהל־העל קבע נאכפת; כבוי – נדחה', async () => {
    let r = await call(M1, { op: 'stt', b64: b64(F.wav(125)) });
    assert.equal(r.reason, 'too-long');
    assert.equal(seeReqs().length, 0); assert.equal(await useMc(), 0);
    await put(`b/${A}/sec_cfg/media`, { aud: 30, img: true, vid: 60 });
    assert.equal((await call(M1, { op: 'stt', b64: b64(F.wav(35)) })).reason, 'too-long');
    assert.equal((await call(M1, { op: 'stt', b64: b64(F.wav(29)) })).ok, true);
    await put(`b/${A}/sec_cfg/media`, { aud: 0, img: true, vid: 60 });
    r = await call(M1, { op: 'stt', b64: b64(F.wav(5)) });
    assert.equal(r.reason, 'media-off'); assert.equal(r.code, 'failed-precondition');
  });
  it('קובץ שאינו WAV, base64 שבור, גדול מדי, קצר מדי – נדחים בלי AI', async () => {
    assert.equal((await call(M1, { op: 'stt', b64: b64(F.jpg()) })).reason, 'bad-audio');
    assert.equal((await call(M1, { op: 'stt', b64: '!!!' })).reason, 'bad-audio');
    assert.equal((await call(M1, { op: 'stt', b64: 'A'.repeat(MD.AUD_MAX_BYTES * 2) })).reason, 'too-big');
    assert.equal((await call(M1, { op: 'stt', b64: b64(F.wav(0.1)) })).reason, 'too-short');
    assert.equal((await call(M1, { op: 'stt', mime: 'audio/webm', b64: b64(F.wav(3)) })).reason, 'bad-audio');
    assert.equal(seeReqs().length, 0);
  });
  it('Gemini נכשל – השמירה מראש מוחזרת (התקרה לא נפגעת)', async () => {
    GM.state.mode = 'overloaded';
    const r = await call(M1, { op: 'stt', b64: b64(F.wav(4)) });
    assert.equal(r.ok, false);
    assert.equal(await useMc(), 0);
  });
  it('הרשאות: עובד, לא מחובר, עסק בלי התוספת, לפני הסכמה – נחסמים; op לא מוכר נדחה', async () => {
    assert.equal((await call(E1, { op: 'stt', b64: b64(F.wav(2)) })).reason, 'not-manager');
    assert.equal((await call(null, { op: 'stt', b64: b64(F.wav(2)) })).code, 'unauthenticated');
    await put(`b/${A}/sec_cfg/main`, { mgr: { [M1]: { cv: 'old' } } }, true);
    assert.equal((await call(M1, { op: 'stt', b64: b64(F.wav(2)) })).reason, 'no-consent');
    await put('b/' + A, { features: { tasks: true, secretary: false } }, true);
    assert.equal((await call(M2, { op: 'stt', b64: b64(F.wav(2)) })).ok, false);
    assert.equal((await call(M1, { op: 'x' })).reason, 'bad-op');
    assert.equal(seeReqs().length, 0);
  });
});

describe('שלב 2: op:"see" – תמונה', () => {
  beforeEach(() => seed());
  for (const [cls, doc] of [['inv', 'inv'], ['rcpt', 'rcpt'], ['z', 'z'], ['dn', 'dn']]) {
    it(`סיווג ${cls} → כרטיס scan עם doc=${doc}; הודעות נשמרות בלי הקובץ; בלי כלים`, async () => {
      SEE = { cls, conf: 0.92, reply: 'זו ' + cls, task: '' };
      const r = await call(M1, { op: 'see', kind: 'image', b64: b64(F.jpg(3000)), cap: 'מה זה?' });
      assert.equal(r.ok, true, r.msg);
      assert.equal(r.r.cards.length, 1); assert.equal(r.r.cards[0].k, 'scan'); assert.equal(r.r.cards[0].doc, doc);
      assert.match(r.r.cards[0].id, /^sc[0-9a-f]{16}$/); assert.equal(r.r.cards[0].low, undefined);
      const rq = seeReqs()[0];
      assert.equal(rq.body.tools, undefined);
      assert.equal(rq.body.contents[0].parts[0].inlineData.mimeType, 'image/jpeg');
      const msgs = await coll(`b/${A}/sec_chat/${M1}/m`);
      const u = msgs.find((x) => x.role === 'u'), a = msgs.find((x) => x.role === 'a');
      assert.equal(u.via, 'image'); assert.equal(u.text, 'מה זה?'); assert.equal(a.id, r.r.id); assert.equal(u.id, r.r.umid);
      assert.equal(a.cards[0].doc, doc);
      assert.equal(await useMc(), AI.costMc('fast', { in: 1000, out: 200 }));
      await assertNoFileContent();
    });
  }
  it('"אחר" עם הצעה → רק כרטיס task; ביטחון נמוך במסמך → low ושאלה בתשובה', async () => {
    SEE = { cls: 'other', conf: 0.9, reply: 'המדף ריק.', task: 'למלא את המדף של החלב' };
    let r = await call(M1, { op: 'see', kind: 'image', b64: b64(F.png()) });
    assert.deepEqual(r.r.cards.map((c) => c.k), ['task']); assert.equal(r.r.cards[0].txt, 'למלא את המדף של החלב');
    SEE = { cls: 'inv', conf: 0.3, reply: 'אולי חשבונית.', task: '' };
    r = await call(M1, { op: 'see', kind: 'image', b64: b64(F.jpg()) });
    assert.equal(r.r.cards[0].low, true); assert.match(r.r.reply, /לא בטוחה שזו חשבונית/);
  });
  it('תמונה כבויה, סוג לא נתמך, גדולה מדי – נדחים בלי AI', async () => {
    assert.equal((await call(M1, { op: 'see', kind: 'image', b64: b64(Buffer.from('<svg></svg>')) })).reason, 'bad-image');
    assert.equal((await call(M1, { op: 'see', kind: 'image', b64: b64(F.jpg(MD.IMG_MAX_BYTES)) })).reason, 'too-big');
    assert.equal((await call(M1, { op: 'see', kind: 'gif', b64: b64(F.jpg()) })).reason, 'bad-kind');
    await put(`b/${A}/sec_cfg/media`, { aud: 120, img: false, vid: 60 });
    assert.equal((await call(M1, { op: 'see', kind: 'image', b64: b64(F.jpg()) })).reason, 'media-off');
    assert.equal(seeReqs().length, 0);
  });
  it('מצב חיסכון (תקרה 0) – אין קריאה ל-AI; כיתוב רגיש – תשובה קבועה בלי AI', async () => {
    await put(`b/${A}/sec_cfg/cap`, { capCents: 0 });
    let r = await call(M1, { op: 'see', kind: 'image', b64: b64(F.jpg()) });
    assert.equal(r.r.mode, 'saving'); assert.deepEqual(r.r.cards, []);
    assert.equal(seeReqs().length, 0);
    await put(`b/${A}/sec_cfg/cap`, { capCents: 1000 });
    r = await call(M1, { op: 'see', kind: 'image', b64: b64(F.jpg()), cap: 'לפטר את דנה כי היא בהריון?' });
    assert.equal(r.r.mode, 'policy'); assert.equal(seeReqs().length, 0);
  });
  it('מנהל עם הגבלת סניפים – אותם כללים כמו בצ\'אט (מותר, בלי כלים ובלי נתוני עסק), brLimited מוחזר', async () => {
    const r = await call(M2, { op: 'see', kind: 'image', b64: b64(F.jpg()) });
    assert.equal(r.ok, true, r.msg); assert.equal(r.r.brLimited, true);
    assert.equal(seeReqs()[0].body.tools, undefined);
  });
});

describe('שלב 2: op:"see" – סרטון דרך sec_tmp', () => {
  beforeEach(async () => { await seed(); await bucket.deleteFiles({ prefix: `b/${A}/sec_tmp/` }).catch(() => {}); await bucket.deleteFiles({ prefix: `b/${B}/sec_tmp/` }).catch(() => {}); });
  it('הצלחה: תשובה, הקובץ נמחק, רזרבה מוגדלת והחזרה לעלות בפועל, סרטון תמיד other (בלי scan)', async () => {
    SEE = { cls: 'inv', conf: 0.9, reply: 'רואים חנות.', task: 'לסדר את הכניסה' };
    const p = await upload(tmp(M1), F.webm(20));
    const r = await call(M1, { op: 'see', kind: 'video', path: p });
    assert.equal(r.ok, true, r.msg);
    assert.equal(await exists(p), false, 'הקובץ הזמני נמחק');
    assert.deepEqual(r.r.cards.map((c) => c.k), ['task']); assert.equal(r.r.cls, 'other');
    assert.equal(seeReqs()[0].body.contents[0].parts[0].inlineData.mimeType, 'video/webm');
    assert.equal(await useMc(), AI.costMc('fast', { in: 1000, out: 200, aud: 32 * 20 })); // אודיו של סרטון – הערכה 32 טוקנים לשנייה
    assert.equal((await coll(`b/${A}/sec_chat/${M1}/m`)).find((x) => x.role === 'u').via, 'video');
    await assertNoFileContent();
  });
  it('Gemini נכשל – הקובץ נמחק בכל זאת, הרזרבה מוחזרת', async () => {
    GM.state.mode = 'overloaded';
    const p = await upload(tmp(M1), F.mp4(10), 'video/mp4');
    const r = await call(M1, { op: 'see', kind: 'video', path: p });
    assert.equal(r.ok, false);
    assert.equal(await exists(p), false);
    assert.equal(await useMc(), 0);
  });
  it('ארוך מהמגבלה, גדול מ-12MB, לא סרטון, סרטון כבוי – נדחים בלי AI, והקובץ נמחק', async () => {
    const cases = [[F.webm(70), 'too-long'], [F.webm(10, { pad: MD.VID_MAX_BYTES }), 'too-big'], [F.jpg(), 'bad-video']];
    for (const [buf, reason] of cases) {
      const p = await upload(tmp(M1), buf);
      const r = await call(M1, { op: 'see', kind: 'video', path: p });
      assert.equal(r.reason, reason);
      assert.equal(await exists(p), false, reason + ': הקובץ נמחק');
    }
    await put(`b/${A}/sec_cfg/media`, { aud: 120, img: true, vid: 15 });
    let p = await upload(tmp(M1), F.mp4(20), 'video/mp4');
    assert.equal((await call(M1, { op: 'see', kind: 'video', path: p })).reason, 'too-long');
    assert.equal(await exists(p), false);
    await put(`b/${A}/sec_cfg/media`, { aud: 120, img: true, vid: 0 });
    p = await upload(tmp(M1), F.webm(5));
    assert.equal((await call(M1, { op: 'see', kind: 'video', path: p })).reason, 'media-off');
    assert.equal(await exists(p), false, 'סוג כבוי: הקובץ נמחק');
    assert.equal(seeReqs().length, 0);
    assert.equal((await call(M1, { op: 'see', kind: 'video', path: tmp(M1) })).reason, 'no-file');
  });
  it('תיקון סבב 1: סרטון שנדחה בשער (לפני הסכמה, bad-kind, bad-op) – נמחק מיד; WAV/סרטון מזויף נדחה כארוך', async () => {
    let p = await upload(tmp(M1), F.webm(5));
    assert.equal((await call(M1, { op: 'see', kind: 'gif', path: p })).reason, 'bad-kind');
    assert.equal(await exists(p), false);
    p = await upload(tmp(M1), F.webm(5));
    assert.equal((await call(M1, { op: 'zzz', kind: 'video', path: p })).reason, 'bad-op');
    assert.equal(await exists(p), false);
    await put(`b/${A}/sec_cfg/main`, { mgr: { [M1]: { cv: 'old' } } }, true);
    p = await upload(tmp(M1), F.webm(5));
    const pOther = await upload(tmp(M2), F.webm(5));
    assert.equal((await call(M1, { op: 'see', kind: 'video', path: p })).reason, 'no-consent');
    assert.equal(await exists(p), false, 'לפני הסכמה: הקובץ של המשתמש עצמו נמחק');
    assert.equal((await call(M1, { op: 'see', kind: 'video', path: pOther })).reason, 'no-consent');
    assert.equal(await exists(pOther), true, 'קובץ של משתמש אחר – לא נוגעים');
    // זיופים (M2 עדיין אחרי הסכמה)
    assert.equal((await call(M2, { op: 'stt', b64: b64(F.wavFake(300, 'data')) })).reason, 'too-long');
    assert.equal((await call(M2, { op: 'stt', b64: b64(F.wavFake(600, 'rate')) })).reason, 'bad-audio');
    p = await upload(tmp(M2), F.webm(300, { duration: true, claim: 10 }));
    assert.equal((await call(M2, { op: 'see', kind: 'video', path: p })).reason, 'too-long');
    assert.equal(await exists(p), false);
    assert.equal(seeReqs().length, 0);
  });
  it('נתיב של משתמש אחר או של עסק אחר – נדחה, והקובץ שלו לא נגעים בו', async () => {
    await put(`b/${A}/sec_cfg/media`, { aud: 120, img: true, vid: 60 });
    const pOther = await upload(tmp(M2), F.webm(5));
    const pBiz = await upload(tmp(MB, B), F.webm(5));
    for (const p of [pOther, pBiz, `sec_tmp/${M1}/abcdefgh12.webm`, `b/${A}/app_backups/${M1}/abcdefgh12`]) {
      const r = await call(M1, { op: 'see', kind: 'video', path: p });
      assert.equal(r.reason, 'bad-path', p);
    }
    assert.equal(await exists(pOther), true); assert.equal(await exists(pBiz), true);
    assert.equal(seeReqs().length, 0);
  });
});

describe('שלב 2: op:"mark" ו-secMediaClean', () => {
  beforeEach(() => seed());
  it('אישור / ביטול כרטיס scan ו-task; כרטיס שהוכרע – already; כרטיס מסוג אחר או לא קיים – no-card', async () => {
    SEE = { cls: 'inv', conf: 0.9, reply: 'חשבונית.', task: 'לבדוק את הסכום' };
    const r = await call(M1, { op: 'see', kind: 'image', b64: b64(F.jpg()) });
    const [sc, tk] = r.r.cards;
    let m = await call(M1, { op: 'mark', mid: r.r.id, cid: sc.id, st: 'ok' });
    assert.equal(m.r.st, 'ok');
    m = await call(M1, { op: 'mark', mid: r.r.id, cid: sc.id, st: 'no' });
    assert.equal(m.r.already, true); assert.equal(m.r.st, 'ok');
    assert.equal((await call(M1, { op: 'mark', mid: r.r.id, cid: tk.id, st: 'no' })).r.st, 'no');
    const a = (await coll(`b/${A}/sec_chat/${M1}/m`)).find((x) => x.id === r.r.id);
    assert.equal(a.cards[0].st, 'ok'); assert.equal(a.cards[1].st, 'no'); assert.ok(a.cards[0].stAt > 0);
    await put(`b/${A}/sec_chat/${M1}/m/x1`, { t: 1, role: 'a', text: 'x', cards: [{ id: 'sc0123456789abcdef', k: 'route' }] });
    assert.equal((await call(M1, { op: 'mark', mid: 'x1', cid: 'sc0123456789abcdef', st: 'ok' })).reason, 'no-card');
    assert.equal((await call(M1, { op: 'mark', mid: 'nope', cid: 'sc0123456789abcdef', st: 'ok' })).reason, 'no-card');
    assert.equal((await call(M1, { op: 'mark', mid: r.r.id, cid: sc.id, st: 'maybe' })).reason, 'bad-input');
    // מנהל אחר לא מסמן כרטיס בשיחה של M1 (קורא רק את השיחה שלו)
    assert.equal((await call(M2, { op: 'mark', mid: r.r.id, cid: tk.id, st: 'ok' })).reason, 'no-card');
    assert.ok((await coll(`b/${A}/sec_log`)).some((x) => x.act === 'mediaCard' && x.note === 'scan:ok'));
  });
  it('הניקוי: קובץ בן 5 דקות נשאר, בן 21 דקות נמחק (legacy ו-b/<עסק>); קבצים מחוץ ל-sec_tmp לא נמחקים', async () => {
    const pa = await upload(`b/${A}/sec_tmp/${M1}/cleanAAAA01.webm`, F.webm(2));
    const pl = await upload(`sec_tmp/${M1}/cleanLLLL01.webm`, F.webm(2));
    const keep = await upload(`b/${A}/app_backups/${M1}/keep.bin`, Buffer.from([1]), 'application/octet-stream');
    let r = await MD.runMediaClean({ bucket: BUCKET, now: Date.now() + 5 * 60000 });
    assert.equal(await exists(pa), true); assert.equal(await exists(pl), true);
    r = await MD.runMediaClean({ bucket: BUCKET, now: Date.now() + 21 * 60000 });
    assert.equal(await exists(pa), false); assert.equal(await exists(pl), false);
    assert.ok(r.removed.includes(pa) && r.removed.includes(pl));
    assert.equal(await exists(keep), true);
    await bucket.file(keep).delete().catch(() => {});
  });
});
