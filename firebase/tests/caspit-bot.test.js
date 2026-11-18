'use strict';
// רובוט כספית – צד השרת (functions/caspit-bot.js) מול האמולטור. חלק מ-test:multibiz:3. כל הנתונים מומצאים.
//   - אסימון: רק מנהל יוצר; נשמר רק גיבוב; פורמט שהתוסף מקבל (caspit-extension/src/lib/api.js). שגוי / בוטל / הוחלף / עסק אחר / עסק לא פעיל – נדחה.
//   - רק הפעולות שבחוזה; CORS רק לתוסף; גוף גדול מדי; מגבלת פניות / ריצות ביום; ניסיונות כושלים לכל IP.
//   - קטלוג ראשון → first-manual. אישור אוטומטי: האפליקציה מנצחת. מכירות: העלאה חוזרת לא מורידה פעמיים; "לא בטוח" לא עוצר.
//   - מנעול משותף עם הטלפון. export מעל המגבלה – סירוב לפני סימון pd / קוד חדש. דיווח ריצה → היום האחרון שנקלט (days ב-hello).
//   - cxBotWatch: התראות + פעם ביום לכל סוג + "לא סנכרן" רק אחרי 10:00. דוח היכרות – מנהל־על בלבד.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const H = require('./helpers');

const A = 'biz-cb', B = 'biz-cc', OFF = 'biz-cd', NOORD = 'biz-ce';
const MGR = 'b_mgr', E1 = 'b_e1', SA = 'b_sa', MB = 'b_mb';
const FN = path.join(H.ROOT, 'functions');
const EXT = require('../../caspit-extension/src/lib/api.js');
let FX, BOT, TK, CC, adm, env;
async function call(name, uid, data) {
  FX = FX || require('../functions/index.js');
  try { return { status: 'OK', result: await FX[name].run({ auth: uid ? { uid, token: { uid } } : null, data: data || {}, rawRequest: { headers: {} } }) }; } catch (e) {
    return { status: (e && e.code) || 'ERR', reason: e && e.details && e.details.reason, text: String(e && e.message).slice(0, 300) };
  }
}
const ok = async (name, uid, data) => { const r = await call(name, uid, data); assert.equal(r.status, 'OK', name + ': ' + r.text); return r.result; };
const PUSH = [];
const send = async (tokens, msg) => { PUSH.push(msg); return tokens.map((t) => ({ token: t, ok: true })); };
// קריאה ל-cxBot (בתוך התהליך, כמו yemot-hook בבדיקות) – בקשה ותשובה מדומות
async function bot(tok, body, o) {
  const opt = o || {};
  const raw = Buffer.from(JSON.stringify(body || {}));
  const headers = Object.assign({ 'content-type': 'application/json', 'x-forwarded-for': opt.ip || '10.0.0.1', origin: 'chrome-extension://mianlmahikfdnffiipdfpojnfjhcipbp' }, tok ? { authorization: 'Bearer ' + tok } : {}, opt.headers || {});
  for (const k of Object.keys(headers)) if (headers[k] === null) delete headers[k];
  const req = { method: opt.method || 'POST', headers, body: body === undefined ? {} : body, rawBody: opt.raw || raw };
  const res = { code: 0, body: null, h: {}, headersSent: false, status(c) { this.code = c; return this; }, set(k, v) { this.h[k] = v; return this; }, json(b) { this.body = b; this.headersSent = true; return this; }, send(b) { this.body = b; this.headersSent = true; return this; } };
  await BOT.handle(req, res, Object.assign({ send }, opt.o || {}));
  return res;
}
const okb = async (tok, body, o) => { const r = await bot(tok, Object.assign({ ver: '0.1.0' }, body), o); assert.equal(r.code, 200, body.op + ': ' + JSON.stringify(r.body)); assert.equal(r.body.ok, true); return r.body; };
let n = 0;
const rid = (p) => (p || 'bt') + Date.now().toString(36) + (n++) + 'zzzz';
const HDR = ['קוד פריט', 'שם פריט', 'ברקוד', 'ספק', 'קטגוריה ראשית', 'קטגוריה משנית', 'מחיר עלות', 'מחיר לצרכן', 'פריט ללא מעמ'];
const cr = (c, nm, p, cost) => [c, nm, '', 'ללא ספק', '', '', cost || 0, p, 'לא'];
const SHDR = ['תאריך מכירה', 'שם פריט', 'מספר ברקוד', 'מספר עסקה', 'שם סניף', 'מספר סניף', 'משקל', 'הנחה', 'פדיון'];
const P = (biz, id) => adm().doc(`b/${biz}/prod/${id}`);
const q = async (id) => ((await P(A, id).get()).get('q') || {})._ || 0;
const dev = async (biz) => (await adm().doc(`b/${biz || A}/private/cxbot`).get()).data();
let TOK;
let today, yday;

before(async () => {
  env = await H.getEnv();
  process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || H.PROJECT_ID;
  FX = require('../functions/index.js');
  BOT = require('../functions/caspit-bot.js')._core;
  TK = require('../functions/lib/tk-time.js');
  CC = require('../functions/lib/caspit-core.js');
  adm = () => require(require.resolve('firebase-admin/firestore', { paths: [FN] })).getFirestore();
  today = BOT.ilDay(Date.now()); yday = BOT.addDays(today, -1);
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const d = c.firestore(); const b = d.batch();
    const biz = (id, st, f) => b.set(d.doc('b/' + id), { name: 'עסק ' + id, status: st, dataRoot: 'b', schemaVersion: 1, createdAt: 1, createdBy: 'x', features: f, org: { v: 1, branches: [], banks: [], cards: [] } });
    biz(A, 'active', { orders: true }); biz(B, 'active', { orders: true }); biz(OFF, 'suspended', { orders: true }); biz(NOORD, 'active', { orders: false });
    for (const [bz, m] of [[A, MGR], [A, SA], [B, MB]]) {
      b.set(d.doc(`b/${bz}/admins/${m}`), { email: m + '@x.invalid' });
      b.set(d.doc(`b/${bz}/staff/${m}`), { name: m, role: 'manager', active: true });
      b.set(d.doc('users/' + m), { bizId: bz, role: 'admin', active: true, bizStatus: 'active', email: m + '@x.invalid', createdAt: 1 });
    }
    b.set(d.doc('superadmins/' + SA), { email: SA + '@x.invalid' });
    b.set(d.doc(`b/${A}/staff/${E1}`), { name: E1, role: 'employee', active: true });
    b.set(d.doc('users/' + E1), { bizId: A, role: 'worker', active: true, bizStatus: 'active', email: E1 + '@x.invalid', createdAt: 1 });
    b.set(d.doc(`b/${A}/push_tokens/${MGR}`), { pushTokens: ['tokM'] });
    await b.commit();
  });
});
after(async () => { try { (await H.getEnv()).cleanup(); } catch (e) { /* */ } });

describe('רובוט כספית – cxBotTok ו-cxBot', () => {
  it('cxBotTok: עובד ובלי התחברות נחסמים; מנהל מקבל אסימון בפורמט של התוסף, ובמסד רק גיבוב', async () => {
    assert.equal((await call('cxBotTok', E1, { op: 'new' })).reason, 'manager-only');
    assert.notEqual((await call('cxBotTok', null, { op: 'new' })).status, 'OK');
    assert.equal((await call('cxBotTok', MGR, { op: 'zz' })).reason, 'bad-op');
    const r = await ok('cxBotTok', MGR, { op: 'new' });
    assert.ok(EXT.TOKEN_RE.test(r.token), r.token);
    assert.ok(r.token.startsWith(A + '.'));
    TOK = r.token;
    const d = await dev();
    assert.equal(d.h, crypto.createHash('sha256').update(TOK).digest('hex'));
    assert.ok(!JSON.stringify(d).includes(TOK.split('.')[1]), 'האסימון עצמו לא נשמר');
    const i = await ok('cxBotTok', MGR, { op: 'info' });
    assert.equal(i.dev.id, r.id); assert.equal(i.newMax, 1); assert.equal(i.first, true); assert.deepEqual(i.runs, []);
    assert.equal(i.disc, undefined, 'דוח היכרות – רק למנהל־על');
  });

  it('אסימון שגוי / חסר / של עסק אחר → 401; CORS רק לתוסף; רק POST JSON; גוף גדול מדי → 413', async () => {
    assert.equal((await bot(null, { op: 'hello' })).code, 401);
    assert.equal((await bot(TOK.slice(0, -2) + 'AA', { op: 'hello' })).code, 401);
    assert.equal((await bot(B + '.' + TOK.split('.')[1], { op: 'hello' })).code, 401, 'אותו סוד עם עסק אחר');
    const r401 = await bot('zz', { op: 'hello' });
    assert.equal(r401.body.reason, 'auth'); assert.match(r401.body.msg, /[א-ת]/);
    assert.equal((await bot(TOK, { op: 'hello' }, { headers: { origin: 'https://evil.example' } })).code, 403);
    const pf = await bot(TOK, undefined, { method: 'OPTIONS' });
    assert.equal(pf.code, 204); assert.equal(pf.h['Access-Control-Allow-Origin'], BOT.EXT_ORIGIN);
    assert.equal((await bot(TOK, { op: 'hello' }, { method: 'GET' })).code, 405);
    assert.equal((await bot(TOK, { op: 'hello' }, { headers: { 'content-type': 'text/plain' } })).code, 415);
    assert.equal((await bot(TOK, { op: 'hello' }, { raw: Buffer.alloc(10 * 1024 * 1024 + 1) })).code, 413);
    const ok1 = await bot(TOK, { op: 'hello', mode: 'connect', ver: '0.1.0' }, { headers: { origin: null } });
    assert.equal(ok1.code, 200, 'בלי Origin (לא דפדפן) – מותר'); assert.equal(ok1.h['Access-Control-Allow-Origin'], undefined);
  });

  it('רק הפעולות שבחוזה; שדה לא מוכר נדחה; log מתעלמים', async () => {
    for (const op of ['cxSetCfg', 'cxFix', 'cxDnOk', 'cxBotTok', 'saveCust', 'setCfg', '__proto__', '']) {
      const r = await bot(TOK, { op, ver: '0.1.0' });
      assert.equal(r.code, 400, op); assert.equal(r.body.reason, 'bad-op', op);
    }
    assert.equal((await bot(TOK, { op: 'cfg', ver: '0.1.0', newMax: 50 })).body.reason, 'bad-field');
    const c = await okb(TOK, { op: 'cfg', log: 'whatever' });
    assert.deepEqual(c.schedule, { at: '03:00', tz: 'Asia/Jerusalem' });
    assert.equal((await bot(TOK, { op: 'cfg', ver: '0.0.1' })).body.reason, 'min-ver');
  });

  it('hello: ימים = אתמול (אין עדיין יום שנקלט), מגבלות (newMax=1), runId בפורמט של התוסף, יומן ריצה', async () => {
    const h = await okb(TOK, { op: 'hello', mode: 'sync', manual: true });
    assert.deepEqual(h.days, [yday]);
    assert.equal(h.lastSales, null);
    assert.deepEqual(h.limits, { price: 500, newMax: 1 });
    assert.equal(h.minVer, BOT.MIN_VER); assert.equal(h.enabled, true); assert.equal(h.biz.name, 'עסק ' + A);
    assert.match(h.runId, /^[A-Za-z0-9_-]{6,40}$/);
    const r = (await adm().doc(`b/${A}/cxBotRun/${h.runId}`).get()).data();
    assert.equal(r.st, 'run'); assert.equal(r.manual, true); assert.deepEqual(r.days, [yday]);
    assert.ok((await dev()).last > 0, 'heartbeat');
    assert.deepEqual(BOT.daysFor(BOT.addDays(today, -30), today).length, 14, 'לכל היותר 14 ימים');
    assert.deepEqual(BOT.daysFor(yday, today), []);
  });

  it('קטלוג ראשון – רק באפליקציה: preview בלי חישוב, apply → first-manual; שום מוצר לא נוצר', async () => {
    const g = CC.groupCat([HDR, cr('400001', 'כוס נייר', 10, 6), cr('400002', 'צלחת', 20, 12)]);
    const run = rid();
    await okb(TOK, { op: 'upload', run, log: 'x', part: 0, parts: 1, items: g.items });
    const pv = await okb(TOK, { op: 'preview', run, log: 'x' });
    assert.equal(pv.first, true); assert.equal(pv.cnt, null);
    const ap = await bot(TOK, { op: 'apply', run, ver: '0.1.0' });
    assert.equal(ap.code, 409); assert.equal(ap.body.reason, 'first-manual');
    assert.equal((await adm().collection(`b/${A}/prod`).get()).size, 0);
  });

  it('אחרי קטלוג ראשון בטלפון: אישור אוטומטי – האפליקציה מנצחת בהתנגשות מחיר', async () => {
    const g = CC.groupCat([HDR, cr('400001', 'כוס נייר', 10, 6), cr('400002', 'צלחת', 20, 12)]);
    const run = rid('ph');
    await ok('cxUpload', MGR, { run, part: 0, parts: 1, items: g.items });
    await ok('cxPreview', MGR, { run });
    assert.equal((await ok('cxApply', MGR, { run })).done, true);
    await P(A, 'cx400001').update({ price: 12 }); // שינוי באפליקציה
    const g2 = CC.groupCat([HDR, cr('400001', 'כוס נייר', 11, 6), cr('400002', 'צלחת', 21, 12)]);
    const r2 = rid();
    await okb(TOK, { op: 'upload', run: r2, part: 0, parts: 1, items: g2.items });
    const pv = await okb(TOK, { op: 'preview', run: r2 });
    assert.equal(pv.first, false); assert.ok(pv.cnt && pv.cnt.link === 2);
    const ap = await okb(TOK, { op: 'apply', run: r2 });
    assert.equal(ap.done, true);
    assert.equal((await P(A, 'cx400001').get()).get('price'), 12, 'קונפליקט – האפליקציה קובעת');
    assert.equal((await P(A, 'cx400002').get()).get('price'), 21, 'שינוי מכספית בלבד – נקלט');
    assert.equal((await okb(TOK, { op: 'apply', run: r2 })).dup, true, 'אישור חוזר לא מכפיל');
  });

  it('מנעול משותף: טלפון באמצע אישור → הרובוט מחכה (busy); הרובוט באמצע → הטלפון מקבל busy', async () => {
    const L = adm().doc(`b/${A}/private/cxbot.lock`);
    await L.set({ o: 'u:' + MGR, exp: Date.now() + 600e3, at: Date.now() });
    const r = await bot(TOK, { op: 'export', kind: 'price', max: 500, ver: '0.1.0' });
    assert.equal(r.code, 409); assert.equal(r.body.reason, 'busy');
    await L.set({ o: 'bot:' + (await dev()).id, exp: Date.now() + 600e3, at: Date.now() });
    const p = await call('cxExport', MGR, { kind: 'new' });
    assert.equal(p.reason, 'busy'); assert.match(p.text, /הרובוט/);
    await L.set({ o: 'bot:x', exp: Date.now() - 1, at: 1 }); // פג תוקף – מותר
    await ok('cxExport', MGR, { kind: 'new' });
    assert.equal((await L.get()).exists, false, 'הטלפון משחרר אחרי היצוא');
  });

  it('מכירות: העלאה חוזרת לא מורידה פעמיים; "לא בטוח" נקלט ומסומן בלי לעצור', async () => {
    const [y, m, d] = yday.split('-');
    const dmy = `${d}/${m}/${y}`;
    const rows = [SHDR, [dmy, 'כוס נייר', '400001', '8001', 'סניף א', '6200', '', '0.0', '24'], [dmy, 'צלחת', '400002', '8002', 'סניף א', '6200', '', '0.0', '13']];
    const lines = CC.parseSales(rows).lines;
    const q0 = await q('cx400001');
    const up = async () => {
      const run = rid('cs');
      await okb(TOK, { op: 'upload', run, kind: 'sales', day: yday, part: 0, parts: 1, lines });
      await okb(TOK, { op: 'preview', run });
      return okb(TOK, { op: 'apply', run });
    };
    const a1 = await up();
    assert.equal(a1.done, true);
    assert.equal(await q('cx400001'), q0 - 2, '24 ₪ / 12 ₪ = 2');
    assert.ok(a1.res.unsure >= 1, 'צלחת 13 ₪ מול 21 ₪ – לא בטוח, נקלט');
    const a2 = await up();
    assert.equal(a2.res.lines || 0, 0); assert.equal(await q('cx400001'), q0 - 2, 'אין הורדה כפולה');
    const bd = await bot(TOK, { op: 'upload', run: rid('cs'), kind: 'sales', day: today, part: 0, parts: 1, lines, ver: '0.1.0' });
    assert.equal(bd.body.reason, 'bad-day', 'היום (לא שלם) – לא');
    const mm = await bot(TOK, { op: 'upload', run: rid('cs'), kind: 'sales', day: BOT.addDays(yday, -1), part: 0, parts: 1, lines, ver: '0.1.0' });
    assert.equal(mm.body.reason, 'day-mismatch', 'שורות מיום אחר מהיום שנשלח – נדחות');
  });

  it('דיווח ריצה: היום האחרון שנקלט מתקדם רק לפי הימים שהשרת ביקש; המנעול משתחרר; hello הבא – בלי ימים', async () => {
    const h = await okb(TOK, { op: 'hello', mode: 'sync' });
    assert.deepEqual(h.days, [yday]);
    await adm().doc(`b/${A}/private/cxbot.lock`).set({ o: 'bot:' + (await dev()).id, exp: Date.now() + 600e3, at: 1 });
    await okb(TOK, { op: 'report', run: h.runId, kind: 'run', st: 'ok', steps: [{ s: 'hello', ok: true, at: 1, junk: 'x'.repeat(5000) }], info: { days: [yday], sales: { [yday]: { n: 2 } } } });
    const d = await dev();
    assert.equal(d.sd, yday); assert.equal(d.lr.st, 'ok'); assert.ok(d.lok);
    assert.equal((await adm().doc(`b/${A}/private/cxbot.lock`).get()).exists, false);
    const run = (await adm().doc(`b/${A}/cxBotRun/${h.runId}`).get()).data();
    assert.equal(run.st, 'ok'); assert.equal(run.steps[0].junk, undefined);
    assert.deepEqual((await okb(TOK, { op: 'hello', mode: 'sync' })).days, []);
    await okb(TOK, { op: 'importResult', run: h.runId, kind: 'price', n: 2, ok: true, text: 'נטענו 2 פריטים', hash: 'a'.repeat(64) });
    assert.equal((await adm().doc(`b/${A}/cxBotRun/${h.runId}`).get()).get('imp.price.n'), 2);
    const i = await ok('cxBotTok', MGR, { op: 'info' });
    assert.ok(i.runs.length >= 2); assert.equal(i.sd, yday);
    // info גדול: נשמרים רק ימים תקינים; דיווח פגום – המנעול משתחרר בכל זאת
    await okb(TOK, { op: 'report', run: h.runId, kind: 'run', st: 'ok', steps: [], info: { days: ['x'.repeat(9000), yday, 5], big: 'y'.repeat(9000) } });
    assert.deepEqual((await adm().doc(`b/${A}/cxBotRun/${h.runId}`).get()).get('info'), { days: [yday] });
    const L = adm().doc(`b/${A}/private/cxbot.lock`);
    await L.set({ o: 'bot:' + (await dev()).id, exp: Date.now() + 600e3, at: 1 });
    const br = await bot(TOK, { op: 'report', run: h.runId, kind: 'run', st: 'ok', zz: 1, ver: '0.1.0' });
    assert.equal(br.body.reason, 'bad-field');
    assert.equal((await L.get()).exists, false, 'המנעול שוחרר גם בדיווח שנדחה');
  });

  it('export מעל המגבלה – סירוב לפני סימון pd / קוד חדש; newMax מהאפליקציה', async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      const d = c.firestore();
      for (const id of ['app1', 'app2']) await d.doc(`b/${A}/prod/${id}`).set({ name: 'מוצר ' + id, price: 5, barcode: '', on: true, q: {}, at: 1 });
    });
    await P(A, 'cx400001').update({ price: 13 }); await P(A, 'cx400002').update({ price: 22 });
    const pdOf = async (c) => ((await adm().doc(`b/${A}/cxItem/${c}`).get()).get('pr') || {}).pd;
    const pd0 = [await pdOf('400001'), await pdOf('400002')]; // 400001: 12 מהקונפליקט (האפליקציה ניצחה – ממתין לכספית)
    const pr = await bot(TOK, { op: 'export', kind: 'price', max: 1, ver: '0.1.0' });
    assert.equal(pr.code, 409); assert.equal(pr.body.reason, 'limit');
    assert.deepEqual([await pdOf('400001'), await pdOf('400002')], pd0, 'לא סומן pd חדש');
    const nw = await bot(TOK, { op: 'export', kind: 'new', max: 50, ver: '0.1.0' });
    assert.equal(nw.body.reason, 'limit', 'newMax=1 ויש 2 מוצרים חדשים');
    assert.equal((await P(A, 'app1').get()).get('cx'), undefined, 'לא ניתן קוד חדש');
    assert.equal((await call('cxSetCfg', E1, { newMax: 5 })).reason, 'manager-only');
    assert.equal((await call('cxSetCfg', MGR, { newMax: 51 })).reason, 'bad-newmax');
    await ok('cxSetCfg', MGR, { newMax: 5 });
    assert.equal((await okb(TOK, { op: 'hello', mode: 'connect' })).limits.newMax, 5);
    const n2 = await okb(TOK, { op: 'export', kind: 'new', max: 50 });
    assert.equal(n2.n, 2); assert.match(n2.csv, /מוצר app1/);
    const p2 = await okb(TOK, { op: 'export', kind: 'price', max: 500 });
    assert.equal(p2.n, 2);
    assert.equal((await adm().doc(`b/${A}/cxItem/400001`).get()).get('pr.pd'), 13);
  });

  it('אסימון שהוחלף / בוטל → 401; עסק מושהה / בלי הזמנות → 403', async () => {
    const r2 = await ok('cxBotTok', MGR, { op: 'new' });
    assert.equal((await bot(TOK, { op: 'cfg', ver: '0.1.0' })).code, 401, 'הקודם בוטל');
    assert.equal((await dev()).sd, yday, 'היום האחרון נשמר בהחלפה');
    await okb(r2.token, { op: 'cfg' });
    await ok('cxBotTok', MGR, { op: 'revoke' });
    assert.equal((await bot(r2.token, { op: 'cfg', ver: '0.1.0' })).code, 401);
    assert.equal((await ok('cxBotTok', MGR, { op: 'info' })).dev, null);
    TOK = (await ok('cxBotTok', MGR, { op: 'new' })).token;
    for (const bz of [OFF, NOORD]) {
      const t = bz + '.' + crypto.randomBytes(32).toString('base64url');
      await adm().doc(`b/${bz}/private/cxbot`).set({ h: crypto.createHash('sha256').update(t).digest('hex'), id: 'zz' });
      const r = await bot(t, { op: 'cfg', ver: '0.1.0' });
      assert.equal(r.code, 403, bz); assert.equal(r.body.reason, 'biz-off');
    }
  });

  it('מגבלות: 600 פניות / 10 ריצות ביום לעסק; 30 ניסיונות כושלים ביום מאותה כתובת', async () => {
    const U = adm().doc(`b/${A}/private/cxbot.use`);
    const day = (await U.get()).get('day');
    await U.set({ day, n: 5, runs: 10 });
    assert.equal((await bot(TOK, { op: 'hello', mode: 'sync', ver: '0.1.0' })).code, 429, '11 ריצות');
    await okb(TOK, { op: 'hello', mode: 'connect' });
    await U.set({ day, n: 600, runs: 0 });
    const r = await bot(TOK, { op: 'cfg', ver: '0.1.0' });
    assert.equal(r.code, 429); assert.equal(r.body.reason, 'rate');
    await U.set({ day, n: 0, runs: 0 });
    // התוקף מחליף את הערך השמאלי ב-X-Forwarded-For בכל בקשה; הערך הימני (שהתשתית מוסיפה) – אותו
    for (let i = 0; i < 30; i++) await bot('nope', { op: 'cfg' }, { ip: `1.2.3.${i}, 10.9.9.9` });
    const blocked = await bot('nope2', { op: 'cfg' }, { ip: '8.8.8.8, 10.9.9.9' });
    assert.equal(blocked.code, 429, 'זיוף הערך השמאלי לא עוקף את המגבלה');
    assert.equal(blocked.body.reason, 'rate');
    // אסימון תקין לא נחסם לעולם בגלל המונה – גם מאותה כתובת, וגם כשמישהו "מתחזה" לכתובת של החנות
    await okb(TOK, { op: 'cfg' }, { ip: '10.9.9.9' });
    await okb(TOK, { op: 'cfg' }, { ip: '6.6.6.6, 10.9.9.9' });
    assert.equal(BOT.clientIp({ headers: { 'x-forwarded-for': 'evil, 1.1.1.1 , 10.9.9.9' } }), '10.9.9.9');
    assert.equal(BOT.clientIp({ headers: {}, ip: '5.5.5.5' }), '5.5.5.5');
  });

  it('מוני הכישלונות: מספר מסמכים קבוע גם עם אלפי כתובות מזויפות', async () => {
    for (let i = 0; i < 300; i += 30) await Promise.all(Array.from({ length: 30 }, (_, k) => bot('zz', { op: 'cfg' }, { ip: `9.${i}.${k}.1` })));
    const ids = (await adm().collection('cxbot_fail').get()).docs.map((d) => d.id);
    assert.ok(ids.length <= BOT.FAIL_BUCKETS, String(ids.length));
    assert.ok(ids.every((x) => /^b\d{1,2}$/.test(x)), ids.join(','));
  });

  it('דוח היכרות: נשמר בחלקים; רק מנהל־על צופה ומוריד; גדול מ-1MB נדחה', async () => {
    const data = { pages: [{ p: '#/catalogs', x: 'א'.repeat(500000) }], ok: true };
    const r = await okb(TOK, { op: 'report', kind: 'disc', data });
    assert.equal((await call('cxBotDisc', MGR, {})).reason, 'not-superadmin');
    const l = await ok('cxBotDisc', SA, { bizId: A });
    assert.equal(l.list[0].id, r.id);
    const g = await ok('cxBotDisc', SA, { bizId: A, id: r.id });
    assert.deepEqual(JSON.parse(g.data), data);
    assert.equal((await ok('cxBotTok', SA, { bizId: A, op: 'info' })).disc[0].id, r.id);
    const big = await bot(TOK, { op: 'report', kind: 'disc', data: 'x'.repeat(1024 * 1024 + 10), ver: '0.1.0' });
    assert.equal(big.body.reason, 'too-big');
  });
});

describe('רובוט כספית – החוקים', () => {
  it('יומן הריצות, דוח ההיכרות, האסימון, המנעול והמונים – סגורים לקריאה ולכתיבה מהאפליקציה (גם למנהל)', async () => {
    const { assertFails } = require('@firebase/rules-unit-testing');
    const c = env.authenticatedContext(MGR, { email: MGR + '@example.invalid' }).firestore();
    for (const p of [`b/${A}/cxBotRun/x`, `b/${A}/cxBotDisc/x`, `b/${A}/private/cxbot`, `b/${A}/private/cxbot.lock`, `b/${A}/private/cxbot.use`, 'cxbot_fail/x']) {
      await assertFails(c.doc(p).get()); await assertFails(c.doc(p).set({ x: 1 }));
    }
    await assertFails(c.collection(`b/${A}/cxBotRun`).get());
  });
});

describe('רובוט כספית – חוזה מול הלקוח של התוסף (caspit-extension/src/lib/api.js)', () => {
  // fetch מדומה שמעביר את הבקשה של הלקוח האמיתי של התוסף ל-cxBot (בתוך התהליך) – אותו סיווג שגיאות שהתוסף מקבל בפועל
  const shim = async (url, init) => {
    const body = JSON.parse(init.body);
    const r = await bot(init.headers.Authorization.replace(/^Bearer /, ''), body, { headers: { 'content-type': init.headers['Content-Type'] } });
    return { status: r.code, ok: r.code >= 200 && r.code < 300, json: async () => r.body };
  };
  const cl = (tok) => EXT.client({ url: 'http://127.0.0.1:1/cxBot', token: tok, ver: '0.1.0', fetch: shim });
  const code = async (p) => { try { await p; return 'ok'; } catch (e) { return e.code; } };
  it('hello / cfg עובדים; אסימון שבוטל → auth; מנעול → busy (ניסיון חוזר); מעל המגבלה → limit', async () => {
    const h = await cl(TOK).call('hello', { mode: 'sync', manual: true });
    assert.ok(Array.isArray(h.days) && h.runId && h.schedule.at === '03:00');
    assert.ok((await cl(TOK).call('cfg', {})).limits);
    assert.equal(await code(cl(A + '.' + 'B'.repeat(43)).call('cfg', {})), 'auth');
    await adm().doc(`b/${A}/private/cxbot.lock`).set({ o: 'u:' + MGR, exp: Date.now() + 600e3, at: 1 });
    assert.equal(await code(cl(TOK).call('export', { kind: 'price', max: 500, log: h.runId })), 'busy');
    await adm().doc(`b/${A}/private/cxbot.lock`).delete();
    await ok('cxSetCfg', MGR, { newMax: 1 });
    assert.equal(await code(cl(TOK).call('export', { kind: 'new', max: 1, log: h.runId })), 'limit', '2 פריטים חדשים ממתינים, מגבלה 1');
    await cl(TOK).call('report', { run: h.runId, kind: 'run', st: 'fail', err: { code: 'limit', msg: 'x', step: 'exportNew' }, steps: [], info: { days: h.days, sales: {} } });
  });
});

describe('רובוט כספית – cxBotWatch', () => {
  const at = (day, hh) => { const [y, m, d] = day.split('-').map(Number); return TK.zoned(y, m - 1, d, hh, 5); };
  it('needs-login – התראה מיד בדיווח, פעם אחת ביום', async () => {
    PUSH.length = 0;
    const h = await okb(TOK, { op: 'hello', mode: 'sync' });
    await okb(TOK, { op: 'report', run: h.runId, kind: 'run', st: 'needs-login', err: { code: 'needs-login', msg: 'x', step: 'login' }, steps: [], info: {} });
    assert.equal(PUSH.length, 1); assert.equal(PUSH[0].k, 'cx'); assert.match(PUSH[0].body, /להתחבר מחדש לכספית/);
    await okb(TOK, { op: 'report', run: h.runId, kind: 'run', st: 'needs-login', err: { code: 'needs-login', msg: 'x', step: 'login' }, steps: [], info: {} });
    assert.equal(PUSH.length, 1, 'פעם ביום');
  });
  it('לפני 10:00 – רק תקלה (מסך השתנה); אחרי 10:00 – "לא סנכרן" (חזק יותר אחרי יומיים) ו-pd אחרי 2 קטלוגים; בלי כפילות באותו יום', async () => {
    const D = '2026-11-20';
    const t9 = at(D, 9), t11 = at(D, 11);
    await adm().doc(`b/${A}/private/cxbot.watch`).delete();
    await adm().doc(`b/${A}/private/cxbot`).set({ lr: { id: 'r1', at: t9 - 3600e3, st: 'fail', code: 'endpoint-changed', msg: '', step: 'catalog' }, sd: '2026-11-17' }, { merge: true });
    // pd: שני קטלוגים; פריט שיצא לפני הקטלוג הלפני-אחרון ועדיין ממתין
    await adm().doc(`b/${A}/cxcfg/main`).set({ cats: [t9 - 5 * 864e5, t9 - 2 * 864e5] }, { merge: true });
    await adm().doc(`b/${A}/cxItem/400001`).set({ xAt: t9 - 6 * 864e5, pr: { fb: 10, ab: 13, pd: 13 } }, { merge: true });
    PUSH.length = 0;
    let r = await BOT.runWatch({ now: t9, send });
    assert.deepEqual(r[A], ['selector-miss']);
    r = await BOT.runWatch({ now: t11, send });
    assert.deepEqual(r[A].sort(), ['nosync2', 'pd']);
    assert.match(PUSH.find((x) => x.id === 'nosync2').body, /יומיים/);
    assert.match(PUSH.find((x) => x.id === 'pd').body, /^\d+ שינויים/);
    r = await BOT.runWatch({ now: t11 + 3600e3, send });
    assert.deepEqual(r[A], [], 'פעם ביום');
    assert.equal(r[B], undefined, 'עסק בלי מחשב מחובר – לא נבדק');
    // התוסף עצר בדף שאינו המשרד האחורי (wrong-page) – התראה, פעם ביום
    await adm().doc(`b/${A}/private/cxbot`).set({ lr: { id: 'r3', at: t11 + 2 * 3600e3, st: 'fail', code: 'wrong-page', msg: '', step: 'exportNew' } }, { merge: true });
    PUSH.length = 0;
    assert.deepEqual((await BOT.runWatch({ now: t11 + 3 * 3600e3, send }))[A], ['wrong-page']);
    assert.match(PUSH[0].body, /התוסף הגיע לדף שאינו המשרד האחורי של כספית ועצר/);
    assert.deepEqual((await BOT.runWatch({ now: t11 + 4 * 3600e3, send }))[A], [], 'פעם ביום');
    // יום אחרי: סנכרן עד אתמול – אין "לא סנכרן"; היום האחרון שלשום → "לא סנכרן הלילה" (הרגיל)
    await adm().doc(`b/${A}/private/cxbot`).set({ sd: '2026-11-20', lr: null }, { merge: true });
    assert.deepEqual((await BOT.runWatch({ now: at('2026-11-21', 11), send }))[A].filter((k) => k.startsWith('nosync')), []);
    await adm().doc(`b/${A}/private/cxbot`).set({ sd: '2026-11-20' }, { merge: true });
    assert.deepEqual((await BOT.runWatch({ now: at('2026-11-22', 11), send }))[A].filter((k) => k.startsWith('nosync')), ['nosync']);
  });
});
