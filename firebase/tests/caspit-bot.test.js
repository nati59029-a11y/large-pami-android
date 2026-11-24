'use strict';
// רובוט כספית – צד השרת (functions/caspit-bot.js) מול האמולטור. חלק מ-test:multibiz:3. כל הנתונים מומצאים.
//   - אסימון: רק מנהל יוצר; נשמר רק גיבוב; פורמט שהתוסף מקבל (caspit-extension/src/lib/api.js). שגוי / בוטל / הוחלף / עסק אחר / עסק לא פעיל – נדחה.
//   - רק הפעולות שבחוזה; CORS רק לתוסף; גוף גדול מדי; מגבלת פניות / ריצות ביום; ניסיונות כושלים לכל IP.
//   - קטלוג ראשון → first-manual. אישור אוטומטי: האפליקציה מנצחת. מכירות: העלאה חוזרת לא מורידה פעמיים; "לא בטוח" לא עוצר.
//   - מנעול משותף עם הטלפון. export מעל המגבלה – סירוב לפני סימון pd / קוד חדש. דיווח ריצה → היום האחרון שנקלט (days ב-hello).
//   - cxBotWatch: התראות + פעם ביום לכל סוג + "לא סנכרן" רק אחרי 10:00. דוח היכרות – מנהל־על בלבד.
//   - "סנכרן עכשיו": רק מנהל, pending / running / no-dev, poll פטור מהמונה, hello לוקח בקשה פעם אחת, בלי הגבלה יומית.
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
    biz(A, 'active', { orders: true, cxSales: true }); // cxSales – תוספת נפרדת מ-#140 (כבויה כברירת מחדל); בדיקות מכירות היום קוראות ל-cxSales
    biz(B, 'active', { orders: true }); biz(OFF, 'suspended', { orders: true }); biz(NOORD, 'active', { orders: false });
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
    // תוסף 0.1.4: השורה ב"טעינות קודמות" של כספית – נשמרת בריצה ובכרטיס (li)
    await okb(TOK, { op: 'importResult', run: h.runId, kind: 'new', n: 1, ok: false, text: 'מזהה 25522', hash: 'b'.repeat(64), id: 25522, status: 'בוצע', errors: 1, loaded: 0 });
    const im = (await adm().doc(`b/${A}/cxBotRun/${h.runId}`).get()).get('imp.new');
    assert.deepEqual([im.id, im.status, im.errors, im.loaded], [25522, 'בוצע', 1, 0]);
    assert.equal((await dev()).li.id, 25522);
    assert.equal((await bot(TOK, { op: 'importResult', run: h.runId, kind: 'new', n: 1, ok: true, id: 'x', ver: '0.1.0' })).body.reason, 'bad-import');
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
    assert.equal((await call('cxSetCfg', MGR, { newMax: 100001 })).reason, 'bad-newmax');
    // 24.11.2026 (בעל העסק): "ללא הגבלה" = 100000
    await ok('cxSetCfg', MGR, { newMax: 100000 });
    assert.equal((await okb(TOK, { op: 'hello', mode: 'connect' })).limits.newMax, 100000);
    assert.equal((await bot(TOK, { op: 'export', kind: 'price', max: 501, ver: '0.1.0' })).body.reason, 'bad-max', 'מחירים – עדיין עד 500');
    assert.equal((await bot(TOK, { op: 'export', kind: 'new', max: 100001, ver: '0.1.0' })).body.reason, 'bad-max');
    await ok('cxSetCfg', MGR, { newMax: 5 });
    assert.equal((await okb(TOK, { op: 'hello', mode: 'connect' })).limits.newMax, 5);
    const n2 = await okb(TOK, { op: 'export', kind: 'new', max: 100000 }); // תוסף 0.1.20 שולח עד 100000; השרת חותך לפי newMax (5)
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
  it('0.1.12: info.scr (תמונת מסך הייבוא) בדיווח ריצה שנכשל → נשמר, ובאפליקציה (info.runs[].scr) רק השדות הצפויים, מקוצרים', async () => {
    const h = await cl(TOK).call('hello', { mode: 'sync', manual: true });
    const scr = { v: 1, flow: 'importPrice', op: 'setFile', err: 'no-queue', qhead: 'none', heads: ['טעינות קודמות', 'x'.repeat(200)], wait: [{ tag: 'h4', t: 'קבצים ממתינים', vis: true, zz: 1 }],
      tables: [{ vis: true, rows: 3, th: ['שם', 'סוג קובץ'], cells: ['סודי'] }], btns: ['העלה קבצים והרץ טעינה'], files: [{ css: 'input#a', vis: false, multi: true, accept: '.csv', n: 1, val: true, lbl: 'בחר קובץ', up: [{ tag: 'div', t: 'בחר קובץ', len: 8 }, { tag: 'div', t: '', len: 900 }] }],
      dialogs: [{ tag: 'div', role: 'dialog', t: 'שים לב' }], evil: '<script>' };
    await cl(TOK).call('report', { run: h.runId, kind: 'run', st: 'fail', err: { code: 'selector-miss', msg: 'עדכון מחירים: ...', step: 'exportPrice' }, steps: [], info: { days: h.days, sales: {}, scr } });
    const r = (await ok('cxBotTok', MGR, { op: 'info' })).runs.find((x) => x.id === h.runId);
    assert.ok(r && r.scr, JSON.stringify(r));
    assert.deepEqual(Object.keys(r.scr).sort(), ['btns', 'dialogs', 'err', 'files', 'flow', 'heads', 'op', 'qhead', 'tables', 'wait']);
    assert.equal(r.scr.heads[1].length, 60);
    assert.deepEqual(r.scr.wait, [{ t: 'קבצים ממתינים', vis: true }]);
    assert.deepEqual(r.scr.tables, [{ rows: 3, vis: true, th: ['שם', 'סוג קובץ'] }]);
    assert.deepEqual(r.scr.files, [{ vis: false, multi: true, accept: '.csv', n: 1, val: true, lbl: 'בחר קובץ', up: ['בחר קובץ'] }]);
    assert.deepEqual(r.scr.dialogs, ['שים לב']);
    assert.ok(!JSON.stringify(r.scr).includes('סודי') && !JSON.stringify(r.scr).includes('script'));
    assert.equal(BOT.scrOut(null), null); assert.equal(BOT.scrOut([1]), null);
  });
});

describe('רובוט כספית – "סנכרן עכשיו" מהטלפון (cxBotTok op:now, poll, hello עם req)', () => {
  const U = () => adm().doc(`b/${A}/private/cxbot.use`);
  const runsOf = async (id) => (await adm().collection(`b/${A}/cxBotRun`).where('req', '==', id).get()).size;
  it('רק מנהל; בקשה נכתבת; בקשה שנייה בזמן המתנה → pending (בלי כתיבה); עסק בלי מחשב → no-dev', async () => {
    await adm().doc(`b/${A}/private/cxbot`).set({ req: null, lr: null }, { merge: true });
    assert.equal((await call('cxBotTok', E1, { op: 'now' })).reason, 'manager-only');
    assert.notEqual((await call('cxBotTok', null, { op: 'now' })).status, 'OK');
    assert.equal((await call('cxBotTok', MB, { op: 'now' })).reason, 'no-dev');
    const r = await ok('cxBotTok', MGR, { op: 'now' });
    assert.match(r.req.id, /^q[a-z0-9]{6,30}$/);
    const d = await dev();
    assert.equal(d.req.id, r.req.id); assert.equal(d.req.by, MGR); assert.equal(d.req.took, undefined);
    const r2 = await call('cxBotTok', MGR, { op: 'now' });
    assert.equal(r2.reason, 'pending'); assert.match(r2.text, /[א-ת]/);
    assert.equal((await dev()).req.id, r.req.id, 'הבקשה הקיימת לא נדרסה');
    const i = await ok('cxBotTok', MGR, { op: 'info' });
    assert.equal(i.req.id, r.req.id); assert.equal(i.nowVer, BOT.NOW_VER); assert.ok(i.now > 0);
  });

  it('poll: פטור מהמונה היומי (גם כשהמונה מלא); pl נכתב פעם ב-5 דקות; אסימון שגוי → 401 ונספר במונה ה-IP; שדה לא מוכר נדחה', async () => {
    const day = BOT.ilDay(Date.now());
    await U().set({ day, n: 0, runs: 0 });
    const want = (await dev()).req.id;
    const first = await okb(TOK, { op: 'poll', ver: '0.1.5' });
    assert.equal(first.want, true); assert.equal(first.id, want);
    const pl = (await dev()).pl;
    assert.ok(pl > 0); assert.equal((await dev()).ver, '0.1.5');
    for (let k = 0; k < 40; k += 10) await Promise.all(Array.from({ length: 10 }, () => okb(TOK, { op: 'poll', ver: '0.1.5' })));
    assert.equal((await U().get()).get('n'), 0, 'poll לא נספר');
    assert.equal((await dev()).pl, pl, 'pl לא נכתב שוב בתוך 5 דקות');
    await U().set({ day, n: 600, runs: 0 });
    assert.equal((await bot(TOK, { op: 'cfg', ver: '0.1.5' })).code, 429, 'המונה מלא');
    await okb(TOK, { op: 'poll', ver: '0.1.5' }); // גם אז poll עובד
    await U().set({ day, n: 0, runs: 0 });
    assert.equal((await bot(TOK, { op: 'poll', ver: '0.1.5', x: 1 })).body.reason, 'bad-field');
    // אסימון שגוי: 401, והניסיון נספר במונה של ה-IP (הדלי של הכתובת)
    const ip = '203.0.113.77', bucket = parseInt(crypto.createHash('sha256').update('cxip:' + ip, 'utf8').digest('hex').slice(0, 8), 16) % BOT.FAIL_BUCKETS;
    await adm().doc('cxbot_fail/b' + bucket).set({ day, n: 0 });
    const bad = await bot(A + '.' + 'C'.repeat(43), { op: 'poll', ver: '0.1.5' }, { ip });
    assert.equal(bad.code, 401);
    assert.equal((await adm().doc('cxbot_fail/b' + bucket).get()).get('n'), 1);
  });

  it('hello עם req לוקח את הבקשה פעם אחת; hello שני → req-gone בלי ריצה; בזמן הריצה → running; אחרי הדיווח – בקשה חדשה מותרת', async () => {
    const id = (await dev()).req.id;
    assert.equal((await bot(TOK, { op: 'hello', mode: 'sync', ver: '0.1.5', req: '../x' })).body.reason, 'bad-req');
    const h = await okb(TOK, { op: 'hello', mode: 'sync', manual: true, req: id });
    let d = await dev();
    assert.ok(d.req.took > 0); assert.equal(d.req.run, h.runId);
    const run = (await adm().doc(`b/${A}/cxBotRun/${h.runId}`).get()).data();
    assert.equal(run.manual, true); assert.equal(run.req, id);
    const again = await bot(TOK, { op: 'hello', mode: 'sync', manual: true, ver: '0.1.5', req: id });
    assert.equal(again.code, 409); assert.equal(again.body.reason, 'req-gone');
    assert.equal(await runsOf(id), 1, 'ריצה אחת לבקשה');
    assert.equal((await okb(TOK, { op: 'poll', ver: '0.1.5' })).want, false, 'הבקשה נלקחה');
    assert.equal((await call('cxBotTok', MGR, { op: 'now' })).reason, 'running');
    await okb(TOK, { op: 'report', run: h.runId, kind: 'run', st: 'ok', steps: [], info: { days: h.days, sales: {} } });
    const r = await ok('cxBotTok', MGR, { op: 'now' });
    assert.notEqual(r.req.id, id);
    d = await dev();
    assert.equal(d.req.id, r.req.id);
    assert.ok(!d.req.took && !d.req.run && !d.req.wait, 'בקשה חדשה לא יורשת took/run/wait מהקודמת: ' + JSON.stringify(d.req));
    assert.equal((await okb(TOK, { op: 'poll', ver: '0.1.5' })).want, true, 'הבקשה השנייה פעילה ונלקחת');
    const i = await ok('cxBotTok', MGR, { op: 'info' });
    assert.equal(i.runs.find((x) => x.id === h.runId).req, true);
  });

  it('בלי הגבלה יומית: ריצה מבקשה בטלפון לא נספרת במגבלת 10 הריצות; בקשה שפגה (10 דקות) לא נלקחת ולא חוסמת בקשה חדשה', async () => {
    const day = BOT.ilDay(Date.now());
    await U().set({ day, n: 0, runs: 10 });
    assert.equal((await bot(TOK, { op: 'hello', mode: 'sync', ver: '0.1.5' })).code, 429, 'ריצה רגילה – מעל המגבלה');
    const id = (await dev()).req.id;
    const h = await okb(TOK, { op: 'hello', mode: 'sync', manual: true, req: id });
    assert.equal((await U().get()).get('runs'), 10, 'לא נספרה');
    await okb(TOK, { op: 'report', run: h.runId, kind: 'run', st: 'ok', steps: [], info: { days: h.days, sales: {} } });
    await U().set({ day, n: 0, runs: 0 });
    // בקשה ישנה (11 דקות) – poll לא מחזיר אותה, hello לא לוקח אותה, ובקשה חדשה מותרת
    const old = await ok('cxBotTok', MGR, { op: 'now' });
    await adm().doc(`b/${A}/private/cxbot`).set({ req: { id: old.req.id, at: Date.now() - BOT.REQ_MS - 60e3, by: MGR } }, { merge: true });
    assert.equal((await okb(TOK, { op: 'poll', ver: '0.1.5' })).want, false);
    assert.equal((await bot(TOK, { op: 'hello', mode: 'sync', ver: '0.1.5', req: old.req.id })).body.reason, 'req-gone');
    const nw = await ok('cxBotTok', MGR, { op: 'now' });
    assert.notEqual(nw.req.id, old.req.id);
    await adm().doc(`b/${A}/private/cxbot`).set({ req: null }, { merge: true });
  });

  it('במקביל: שתי בקשות "סנכרן עכשיו" → אחת נכתבת, השנייה pending; שני hello עם אותה בקשה → ריצה אחת בלבד', async () => {
    await adm().doc(`b/${A}/private/cxbot`).set({ req: null, lr: null }, { merge: true });
    const two = await Promise.all([call('cxBotTok', MGR, { op: 'now' }), call('cxBotTok', MGR, { op: 'now' })]);
    assert.equal(two.filter((r) => r.status === 'OK').length, 1, JSON.stringify(two));
    assert.equal(two.filter((r) => r.reason === 'pending').length, 1, JSON.stringify(two));
    const id = (await dev()).req.id;
    assert.equal(two.find((r) => r.status === 'OK').result.req.id, id);
    const day = BOT.ilDay(Date.now());
    await U().set({ day, n: 0, runs: 0 });
    const hs = await Promise.all([1, 2].map(() => bot(TOK, { op: 'hello', mode: 'sync', manual: true, ver: '0.1.5', req: id })));
    assert.equal(hs.filter((r) => r.code === 200).length, 1, JSON.stringify(hs.map((r) => r.body)));
    assert.equal(hs.filter((r) => r.body.reason === 'req-gone').length, 1);
    assert.equal(await runsOf(id), 1, 'ריצה אחת לבקשה');
    const h = hs.find((r) => r.code === 200).body;
    await okb(TOK, { op: 'report', run: h.runId, kind: 'run', st: 'ok', steps: [], info: { days: h.days, sales: {} } });
  });

  it('poll עם wait (ריצה שממתינה לניסיון חוזר) נרשם על הבקשה ומוצג ב-info; wait לא תקין נדחה', async () => {
    await adm().doc(`b/${A}/private/cxbot`).set({ req: null, lr: null }, { merge: true });
    const r = await ok('cxBotTok', MGR, { op: 'now' });
    const w = Date.now() + 240e3;
    assert.equal((await bot(TOK, { op: 'poll', ver: '0.1.5', wait: 'x' })).body.reason, 'bad-field');
    assert.equal((await okb(TOK, { op: 'poll', ver: '0.1.5', wait: w })).want, true);
    assert.equal((await dev()).req.wait, w);
    assert.equal((await dev()).req.id, r.req.id, 'שאר שדות הבקשה נשמרו');
    assert.equal((await ok('cxBotTok', MGR, { op: 'info' })).req.wait, w);
    await adm().doc(`b/${A}/private/cxbot`).set({ req: null }, { merge: true });
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
    // טעינה לכספית עם שגויים – התראה
    await adm().doc(`b/${A}/private/cxbot`).set({ lr: { id: 'r4', at: t11 + 2 * 3600e3, st: 'fail', code: 'import-errors', msg: '', step: 'exportNew' } }, { merge: true });
    PUSH.length = 0;
    assert.deepEqual((await BOT.runWatch({ now: t11 + 2.5 * 3600e3, send }))[A], ['import-errors']);
    assert.match(PUSH[0].body, /שורות שגויות/);
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
  it('עדכון אוטומטי (0.1.7): upd ב-hello נשמר מסונן (לא תקין – מתעלמים); התראות: נכשל פעמיים / לא רץ 48 שעות / הורד ולא נטען; בלי upd – אין התראה', async () => {
    const ref = adm().doc(`b/${A}/private/cxbot`);
    await ref.set({ upd: null }, { merge: true });
    await okb(TOK, { op: 'hello', mode: 'connect', upd: 'x' });
    assert.equal((await ref.get()).get('upd'), null, 'upd לא תקין – מתעלמים, hello עובר');
    const fut = Date.now() + 864e5;
    await okb(TOK, { op: 'hello', mode: 'connect', upd: { at: fut, ok: false, ver: '0.1.7', err: 'bad <hash>', fails: 2, z: 1 } });
    const u = (await ref.get()).get('upd');
    assert.ok(u.at <= Date.now() && u.rx >= u.at, 'at לא בעתיד');
    assert.deepEqual({ ok: u.ok, ver: u.ver, err: u.err, fails: u.fails, z: u.z }, { ok: false, ver: '0.1.7', err: 'bad hash', fails: 2, z: undefined });
    const upd = () => (r) => r[A].filter((x) => x.startsWith('upd'));
    const day = (dd) => at(dd, 11);
    // נכשל ברצף → updfail (פעם ביום). 0.1.10 (בדיקה כל 10 דקות): 2 כישלונות לפני שעתיים – עוד לא (תקלת רשת קצרה); 6 ברצף – כן
    let t = day('2026-12-01');
    await ref.set({ sd: '2026-11-30', lr: null, last: t - 3600e3, ver: '0.1.7', upd: { at: t - 7200e3, ok: false, ver: '0.1.7', err: 'bad-hash', fails: 2, rx: t } }, { merge: true });
    PUSH.length = 0;
    assert.deepEqual(upd()(await BOT.runWatch({ now: t, send })), [], '2 כישלונות, האחרון לפני שעתיים');
    await ref.set({ upd: { at: t - 600e3, ok: false, ver: '0.1.7', err: 'bad-hash', fails: 6, rx: t } }, { merge: true });
    assert.deepEqual(upd()(await BOT.runWatch({ now: t, send })), ['updfail']);
    assert.match(PUSH.find((x) => x.id === 'updfail').body, /נכשל/);
    assert.deepEqual(upd()(await BOT.runWatch({ now: t + 3600e3, send })), [], 'פעם ביום');
    // בדיקה יומית ישנה: 2 כישלונות, האחרון לפני 7 שעות → updfail
    t = day('2026-12-07');
    await ref.set({ sd: '2026-12-06', upd: { at: t - 7 * 3600e3, ok: false, ver: '0.1.7', err: 'x', fails: 2, rx: t } }, { merge: true });
    assert.deepEqual(upd()(await BOT.runWatch({ now: t, send })), ['updfail']);
    // כישלון אחד – עוד לא
    t = day('2026-12-02');
    await ref.set({ sd: '2026-12-01', upd: { at: t - 7200e3, ok: false, ver: '0.1.7', err: 'x', fails: 1, rx: t } }, { merge: true });
    assert.deepEqual(upd()(await BOT.runWatch({ now: t, send })), []);
    // לא רץ 48 שעות, והמחשב פעיל → updstale; המחשב כבוי (לא נראה 24 שעות) → לא (יש "לא סנכרן")
    t = day('2026-12-03');
    await ref.set({ sd: '2026-12-02', last: t - 3600e3, upd: { at: t - 50 * 3600e3, ok: true, ver: '0.1.7', err: '', fails: 0, rx: t } }, { merge: true });
    assert.deepEqual(upd()(await BOT.runWatch({ now: t, send })), ['updstale']);
    t = day('2026-12-04');
    await ref.set({ sd: '2026-12-03', last: t - 30 * 3600e3, pl: null, upd: { at: t - 50 * 3600e3, ok: true, ver: '0.1.7', err: '', fails: 0, rx: t } }, { merge: true });
    assert.deepEqual(upd()(await BOT.runWatch({ now: t, send })), []);
    // הורד 0.1.8 אבל נטען 0.1.7 → updlag
    t = day('2026-12-05');
    await ref.set({ sd: '2026-12-04', last: t - 3600e3, ver: '0.1.7', upd: { at: t - 5 * 3600e3, ok: true, ver: '0.1.8', err: '', fails: 0, rx: t } }, { merge: true });
    PUSH.length = 0;
    assert.deepEqual(upd()(await BOT.runWatch({ now: t, send })), ['updlag']);
    assert.match(PUSH.find((x) => x.id === 'updlag').body, /Chrome/);
    // בלי upd (העדכון האוטומטי לא הותקן) – אין התראת עדכון
    t = day('2026-12-06');
    await ref.set({ sd: '2026-12-05', upd: null }, { merge: true });
    assert.deepEqual(upd()(await BOT.runWatch({ now: t, send })), []);
  });
});

describe('רובוט כספית – מכירות היום (חלקי) ו"עדכון המחשב" (תוסף 0.1.10)', () => {
  const at = (day, hm) => { const [y, m, d] = day.split('-').map(Number); const [H, M] = hm.split(':').map(Number); return TK.zoned(y, m - 1, d, H, M); };
  const DAY = '2026-12-02'; // יום רביעי
  const dmyOf = (day) => day.split('-').reverse().join('/');
  const lines = (day, rows) => CC.parseSales([SHDR, ...rows.map((r) => [dmyOf(day), ...r])]).lines;
  const part = (b, now) => bot(TOK, Object.assign({ op: 'upload', ver: '0.1.10', run: rid('ct'), kind: 'sales', partial: true, part: 0, parts: 1 }, b), { o: { now } });
  const PD = (id) => adm().doc(`b/${A}/cxDayP/${id}`);

  it('upload חלקי: רק cxDayP עם pt (בלי מלאי, בלי cxDay, בלי sd); cxSales רק עם pt:true; העלאה נוספת מחליפה; שעה עתידית – מתוקנת', async () => {
    const t = at(DAY, '10:05');
    const L1 = lines(DAY, [['כוס נייר', '400001', '9101', 'סניף א', '6200', '', '0.0', '24'], ['צלחת', '400002', '9102', 'סניף ב', '7700', '', '0.0', '13'], ['פריט כללי', '1000', '9102', 'סניף ב', '7700', '', '0.0', '5']]);
    const q0 = await q('cx400001'), d0 = await dev();
    const r = await part({ day: DAY, hm: '10:05', lines: L1 }, t);
    assert.equal(r.code, 200, JSON.stringify(r.body)); assert.equal(r.body.partial, true); assert.equal(r.body.n, 3);
    assert.equal(await q('cx400001'), q0, 'המלאי לא השתנה');
    assert.equal((await adm().collection(`b/${A}/cxDay`).where('d', '==', DAY).get()).size, 0, 'בלי סיכום יומי "סופי"');
    assert.equal((await adm().collection(`b/${A}/cxTx`).where('d', '==', DAY).get()).size, 0, 'בלי עסקאות');
    const a = (await PD('6200_20261202').get()).data(), b = (await PD('7700_20261202').get()).data();
    assert.deepEqual(a.pt, { at: t, hm: '10:05' });
    assert.equal(a.gross, 24); assert.equal(a.ntx, 1); assert.equal(a.it['400001'].q, 2, '24 ₪ / 12 ₪ = 2');
    assert.equal(b.gross, 18); assert.equal(b.sp, 5); assert.equal(b.it['1000'].sp, true); assert.equal(b.un, 1, 'צלחת 13 ₪ מול 21 ₪ – לא בטוח');
    const d1 = await dev();
    assert.equal(d1.sd, d0.sd, 'היום האחרון שנקלט לא זז'); assert.deepEqual({ d: d1.tp.d, hm: d1.tp.hm, n: d1.tp.n }, { d: DAY, hm: '10:05', n: 3 });
    // cxSales: אפליקציה ישנה (בלי pt) – לא רואה; חדשה – רואה עם pt
    assert.equal((await ok('cxSales', MGR, { from: DAY, to: DAY })).days.length, 0);
    const s1 = await ok('cxSales', MGR, { from: DAY, to: DAY, pt: true });
    assert.equal(s1.days.length, 2); assert.ok(s1.days.every((x) => x.pt && x.pt.hm === '10:05'));
    assert.equal(CC.aggDays(CC.unpackDays(s1)).net, 42);
    assert.equal((await call('cxSales', MGR, { from: DAY, to: DAY, pt: 1 })).reason, 'bad-field');
    // שעה אחר כך: רק סניף א (סניף ב נעלם → נמחק), סכום חדש
    const L2 = lines(DAY, [['כוס נייר', '400001', '9101', 'סניף א', '6200', '', '0.0', '24'], ['כוס נייר', '400001', '9103', 'סניף א', '6200', '', '0.0', '12']]);
    assert.equal((await part({ day: DAY, hm: '11:05', lines: L2 }, at(DAY, '11:05'))).code, 200);
    assert.equal((await PD('7700_20261202').get()).exists, false);
    const a2 = (await PD('6200_20261202').get()).data();
    assert.equal(a2.gross, 36); assert.equal(a2.ntx, 2); assert.equal(a2.pt.hm, '11:05'); assert.equal(a2.it['400001'].q, 3);
    // שעון מחשב שמקדים – "עד השעה" לא בעתיד
    assert.equal((await part({ day: DAY, hm: '12:30', lines: L2 }, at(DAY, '12:01'))).code, 200);
    assert.equal((await PD('6200_20261202').get()).get('pt.hm'), '12:01');
    // מגבלת קצב: העלאה חלקית אחת ל-20 דקות לעסק
    const rr = await part({ day: DAY, hm: '12:10', lines: L1 }, at(DAY, '12:10'));
    assert.equal(rr.code, 429); assert.equal(rr.body.reason, 'rate');
    assert.equal((await PD('6200_20261202').get()).get('pt.hm'), '12:01', 'לא נשמר');
    assert.equal((await part({ day: DAY, hm: '12:22', lines: L2 }, at(DAY, '12:22'))).code, 200, 'אחרי 20 דקות – מותר');
  });

  it('upload חלקי נדחה: לא היום, לפני 07:00, שישי מ-14:00 / שבת, כמה חלקים, שורות מיום אחר, שעה / שדה לא תקינים', async () => {
    const L = lines(DAY, [['כוס נייר', '400001', '9201', 'סניף א', '6200', '', '0.0', '24']]);
    const t = at(DAY, '15:00');
    assert.equal((await part({ day: BOT.addDays(DAY, -1), hm: '15:00', lines: lines(BOT.addDays(DAY, -1), [['כוס נייר', '400001', '9201', 'סניף א', '6200', '', '0.0', '24']]) }, t)).body.reason, 'bad-day');
    assert.equal((await part({ day: DAY, hm: '06:30', lines: L }, at(DAY, '06:30'))).body.reason, 'today-off');
    assert.equal((await part({ day: DAY, hm: '06:57', lines: L }, at(DAY, '06:57'))).body.reason, 'today-off');
    // סובלנות שעון: 2 דקות לפני תחילת החלון – מתקבל ונשמר (השעה – של השרת)
    assert.equal((await part({ day: DAY, hm: '07:00', lines: L }, at(DAY, '06:58'))).code, 200);
    assert.equal((await PD('6200_20261202').get()).get('pt.hm'), '06:58');
    const FRI = '2026-12-04', SAT = '2026-12-05';
    assert.equal((await part({ day: FRI, hm: '15:00', lines: lines(FRI, [['כוס נייר', '400001', '9201', 'סניף א', '6200', '', '0.0', '24']]) }, at(FRI, '15:00'))).body.reason, 'today-off');
    assert.equal((await part({ day: FRI, hm: '13:00', lines: lines(FRI, [['כוס נייר', '400001', '9201', 'סניף א', '6200', '', '0.0', '24']]) }, at(FRI, '13:00'))).code, 200, 'שישי לפני 14:00 – מותר');
    assert.equal((await part({ day: SAT, hm: '12:00', lines: lines(SAT, [['כוס נייר', '400001', '9201', 'סניף א', '6200', '', '0.0', '24']]) }, at(SAT, '12:00'))).body.reason, 'today-off');
    assert.equal((await part({ day: SAT, hm: '21:00', lines: lines(SAT, [['כוס נייר', '400001', '9201', 'סניף א', '6200', '', '0.0', '24']]) }, at(SAT, '20:57'))).body.reason, 'today-off');
    assert.equal((await part({ day: SAT, hm: '21:00', lines: lines(SAT, [['כוס נייר', '400001', '9201', 'סניף א', '6200', '', '0.0', '24']]) }, at(SAT, '20:58'))).code, 200, 'מוצאי שבת 20:58 – סובלנות שעון');
    assert.equal((await part({ day: DAY, hm: '15:00', lines: L, parts: 2 }, t)).body.reason, 'bad-part');
    assert.equal((await part({ day: DAY, hm: '15:00', lines: lines(BOT.addDays(DAY, -1), [['כוס נייר', '400001', '9201', 'סניף א', '6200', '', '0.0', '24']]) }, t)).body.reason, 'day-mismatch');
    assert.equal((await part({ day: DAY, hm: '25:00', lines: L }, t)).body.reason, 'bad-hm');
    assert.equal((await part({ day: DAY, hm: '15:00', lines: L, partial: 'yes' }, t)).body.reason, 'bad-field');
    assert.equal((await part({ day: DAY, hm: '15:00', lines: L, zz: 1 }, t)).body.reason, 'bad-field');
    // בלי partial – יום לא שלם נדחה כמו קודם
    assert.equal((await bot(TOK, { op: 'upload', ver: '0.1.10', run: rid('cs'), kind: 'sales', day: DAY, part: 0, parts: 1, lines: L }, { o: { now: t } })).body.reason, 'bad-day');
  });

  it('הלילה דורס: יום עם סיכום סופי (cxDay) – cxSales מחזיר רק אותו; דיווח שמקדם את sd מוחק את התמונות החלקיות', async () => {
    assert.ok((await PD('6200_20261202').get()).exists);
    await adm().doc(`b/${A}/cxDay/6200_20261202`).set({ d: DAY, bk: '6200', bn: 'סניף א', gross: 100, ret: 0, disc: 0, ntx: 4, nl: 4, sp: 0, un: 0, it: {} });
    const s = await ok('cxSales', MGR, { from: DAY, to: DAY, pt: true });
    assert.equal(s.days.length, 1); assert.equal(s.days[0].pt, undefined); assert.equal(s.days[0].gross, 100);
    // הסנכרון הלילי של 3.12: מבקש את 2.12 ומדווח שנקלט
    await adm().doc(`b/${A}/private/cxbot`).set({ sd: BOT.addDays(DAY, -1), req: null }, { merge: true });
    const n3 = at(BOT.addDays(DAY, 1), '03:10');
    const h = await okb(TOK, { op: 'hello', mode: 'sync' }, { o: { now: n3 } });
    assert.deepEqual(h.days, [DAY]);
    await okb(TOK, { op: 'report', run: h.runId, kind: 'run', st: 'ok', steps: [], info: { days: [DAY], sales: { [DAY]: { n: 4 } } } }, { o: { now: n3 } });
    assert.equal((await dev()).sd, DAY);
    assert.equal((await adm().collection(`b/${A}/cxDayP`).where('d', '<=', DAY).get()).size, 0, 'התמונות החלקיות נמחקו');
    await adm().doc(`b/${A}/cxDay/6200_20261202`).delete();
  });

  it('"עדכון המחשב": רק מנהל; תוסף ישן → old-ext; בקשה → poll מחזיר uq רק לתוסף 0.1.10+, ו-caps תמיד; ack נשמר פעם אחת; pending; info; upd ב-poll – רק כשהשתנה', async () => {
    const ref = adm().doc(`b/${A}/private/cxbot`);
    await ref.set({ ver: '0.1.9', ureq: null, req: null }, { merge: true });
    assert.equal((await call('cxBotTok', E1, { op: 'upd' })).reason, 'manager-only');
    assert.equal((await call('cxBotTok', MB, { op: 'upd' })).reason, 'no-dev');
    const o1 = await call('cxBotTok', MGR, { op: 'upd' });
    assert.equal(o1.reason, 'old-ext'); assert.match(o1.text, /0\.1\.10/);
    await ref.set({ ver: '0.1.10' }, { merge: true });
    const r = await ok('cxBotTok', MGR, { op: 'upd' });
    assert.match(r.req.id, /^q[a-z0-9]{6,30}$/);
    assert.equal((await call('cxBotTok', MGR, { op: 'upd' })).reason, 'pending');
    assert.equal((await dev()).req, null, 'לא נוגע בבקשת "סנכרן עכשיו"');
    const p9 = await okb(TOK, { op: 'poll', ver: '0.1.9' });
    assert.equal(p9.uq, undefined, 'תוסף ישן לא מקבל את הבקשה'); assert.deepEqual(p9.caps, BOT.CAPS); assert.equal(p9.want, false);
    const p10 = await okb(TOK, { op: 'poll', ver: '0.1.10' });
    assert.equal(p10.uq, r.req.id);
    for (const res of [null, 'x', { st: 'boom' }, { st: 'same', z: 1 }]) assert.equal((await bot(TOK, { op: 'poll', ver: '0.1.10', ack: r.req.id, res })).body.reason, 'bad-field', JSON.stringify(res));
    assert.equal((await bot(TOK, { op: 'poll', ver: '0.1.10', ack: '../x', res: { st: 'same' } })).body.reason, 'bad-field');
    const pa = await okb(TOK, { op: 'poll', ver: '0.1.10', ack: r.req.id, res: { st: 'reload', cur: '0.1.10', disk: '0.1.11<x>' } });
    assert.equal(pa.uq, undefined);
    const u = (await dev()).ureq;
    assert.ok(u.took > 0); assert.deepEqual(u.res, { st: 'reload', cur: '0.1.10', disk: '' });
    await okb(TOK, { op: 'poll', ver: '0.1.10', ack: r.req.id, res: { st: 'same' } });
    assert.equal((await dev()).ureq.res.st, 'reload', 'תשובה שנייה לאותה בקשה – לא נרשמת');
    assert.equal((await okb(TOK, { op: 'poll', ver: '0.1.10' })).uq, undefined, 'הבקשה טופלה');
    const i = await ok('cxBotTok', MGR, { op: 'info' });
    assert.equal(i.ureq.id, r.req.id); assert.equal(i.ureq.res.st, 'reload'); assert.equal(i.updVer, BOT.UPD_VER); assert.equal(i.tp, null, 'העדכון האחרון אינו של היום – לא מוחזר');
    assert.notEqual((await ok('cxBotTok', MGR, { op: 'upd' })).req.id, r.req.id, 'אחרי תשובה – בקשה חדשה מותרת');
    // מצב העדכון האוטומטי ב-poll: נשמר מסונן, ולא נכתב שוב כשלא השתנה
    const U1 = { at: Date.now() - 60e3, ok: true, ver: '0.1.10', err: '', fails: 0 };
    await okb(TOK, { op: 'poll', ver: '0.1.10', upd: U1 });
    const s1 = (await dev()).upd;
    assert.equal(s1.at, U1.at); assert.equal(s1.ok, true);
    await okb(TOK, { op: 'poll', ver: '0.1.10', upd: U1 });
    assert.equal((await dev()).upd.rx, s1.rx, 'לא נכתב שוב');
    assert.equal((await bot(TOK, { op: 'poll', ver: '0.1.10', upd: { at: 'x' } })).body.reason, 'bad-field');
    await ref.set({ ureq: null }, { merge: true });
  });

  // 24.11.2026 (תוסף 0.1.19): העדכון השעתי שנכשל – poll tf → private/cxbot; cxSales (pt) מחזיר bot; info מחזיר tf; botLate
  it('0.1.19 tf: caps כולל tf; נשמר רק כשהשתנה; קלט פגום נדחה; cxSales עם pt מחזיר bot (רק לטווח שכולל את היום); info; botLate', async () => {
    const ref = adm().doc(`b/${A}/private/cxbot`);
    assert.ok((await okb(TOK, { op: 'poll', ver: '0.1.19' })).caps.includes('tf'));
    const S = today + ' 11';
    for (const tf of [null, 'x', [], { s: S }, { c: 'tab' }, { s: today, c: 'tab' }, { s: today + ' 24', c: 'tab' }, { s: S, c: 'Bad!' }, { s: S, c: 'tab', z: 1 }, { s: S, c: 'x'.repeat(31) }])
      assert.equal((await bot(TOK, { op: 'poll', ver: '0.1.19', tf })).body.reason, 'bad-field', JSON.stringify(tf));
    await ref.set({ tf: null, pl: 0, tp: { d: today, hm: '10:00', at: Date.now() - 3 * 3600e3, n: 2 } }, { merge: true });
    await okb(TOK, { op: 'poll', ver: '0.1.19', tf: { s: S, c: 'needs-login' } });
    const t1 = (await dev()).tf;
    assert.equal(t1.s, S); assert.equal(t1.c, 'needs-login'); assert.ok(t1.at > 0);
    await okb(TOK, { op: 'poll', ver: '0.1.19', tf: { s: S, c: 'needs-login' } });
    assert.equal((await dev()).tf.at, t1.at, 'לא השתנה – לא נכתב שוב');
    await okb(TOK, { op: 'poll', ver: '0.1.19', tf: { s: today + ' 12', c: 'stuck' } });
    assert.equal((await dev()).tf.c, 'stuck');
    // cxSales: עם pt ולטווח שכולל את היום – bot; בלי pt / טווח שהסתיים – אין
    const s1 = await ok('cxSales', MGR, { from: yday, to: today, pt: true });
    assert.equal(s1.bot.tf.s, today + ' 12'); assert.equal(s1.bot.tf.c, 'stuck'); assert.equal(s1.bot.tp.hm, '10:00'); assert.ok(s1.bot.pl > 0, 'poll רשם pl');
    assert.equal(typeof s1.bot.late, 'boolean'); assert.ok(Math.abs(s1.bot.now - Date.now()) < 60e3);
    assert.deepEqual(Object.keys(s1.bot).sort(), ['late', 'now', 'pl', 'tf', 'tp'], 'רק זמנים וקוד – בלי פרטי חיבור');
    assert.equal((await ok('cxSales', MGR, { from: yday, to: today })).bot, undefined);
    assert.equal((await ok('cxSales', MGR, { from: yday, to: yday, pt: true })).bot, null);
    // tf / tp מיום אחר – לא מוחזרים
    await ref.set({ tf: { s: yday + ' 12', c: 'tab', at: 1 }, tp: { d: yday, hm: '22:00', at: 1, n: 1 } }, { merge: true });
    const s2 = await ok('cxSales', MGR, { from: today, to: today, pt: true });
    assert.equal(s2.bot.tf, null); assert.equal(s2.bot.tp, null);
    await ref.set({ tf: { s: S, c: 'needs-login', at: Date.now() } }, { merge: true });
    assert.equal((await ok('cxBotTok', MGR, { op: 'info' })).tf.c, 'needs-login');
    // botLate: יום שלישי 24.11.2026 (שעון ישראל)
    const L = require('../functions/caspit.js')._core.botLate, AT = (d, hm) => { const [y, m, dd] = d.split('-').map(Number); const [H, M] = hm.split(':').map(Number); return TK.zoned(y, m - 1, dd, H, M); };
    assert.equal(L(AT('2026-11-24', '16:56'), AT('2026-11-24', '10:00')), true, 'המקרה מ-24.11');
    assert.equal(L(AT('2026-11-24', '16:56'), AT('2026-11-24', '16:00')), false);
    assert.equal(L(AT('2026-11-24', '08:00'), 0), false, 'בבוקר – עוד לא עברו 75 דקות מ-07:00');
    assert.equal(L(AT('2026-11-24', '08:20'), 0), true);
    assert.equal(L(AT('2026-11-27', '16:00'), AT('2026-11-27', '13:00')), false, 'שישי אחרי 14:00');
    assert.equal(L(AT('2026-11-28', '21:30'), 0), false, 'מוצאי שבת – רק מ-22:15');
    assert.equal(L(AT('2026-11-28', '22:20'), 0), true);
    await ref.set({ tf: null, tp: null }, { merge: true });
  });
});

describe('רובוט כספית – שעות העובדים (תוסף 0.1.14, upload kind:hours, cxBotTok op:hours)', () => {
  const at = (day, hm) => { const [y, m, d] = day.split('-').map(Number); const [H, M] = hm.split(':').map(Number); return TK.zoned(y, m - 1, d, H, M); };
  const M = '2026-12', PM = '2026-11';
  let NOW = 0;
  const up = (b, now, tok) => bot(tok || TOK, Object.assign({ op: 'upload', ver: '0.1.14', run: rid('ch'), kind: 'hours', br: 'יהודה הנשיא', m: M }, b), { o: { now: now || NOW } });
  const R1 = [{ d: '2026-12-01', i: '07:41', o: '15:58', b: 30, t: 467 }, { d: '2026-12-02', i: '22:10', o: '06:05', b: 15, t: 460, n: 1 }, { d: '2026-12-03', i: '07:39', o: '', b: 0 }];
  const HD = (biz) => adm().collection(`b/${biz}/cxHrs`);
  let t = 0;
  const next = () => (t += 61e3);
  before(() => { NOW = at('2026-12-03', '08:10'); t = NOW; }); // TK נטען ב-before הכללי

  it('העלאה נשמרת לכל סניף+חודש+עובד; העלאה נוספת מחליפה רק את אותו עובד; caps כולל hours; בלי שמות / שעות ב-private/cxbot', async () => {
    const r = await up({ emps: [{ id: '12', nm: 'מיכל רוזנצוויג', rows: R1 }, { id: '15', nm: 'יואב שטרנברג', rows: [{ d: '2026-12-02', i: '09:00', o: '13:00', b: 0, t: 240 }] }] }, next());
    assert.equal(r.code, 200, JSON.stringify(r.body)); assert.equal(r.body.n, 2); assert.equal(r.body.rows, 4);
    const r2 = await up({ br: 'נחל לכיש', emps: [{ id: '13', nm: 'עומר טננבאום', rows: [{ d: '2026-12-01', i: '10:00', o: '18:00', b: 30 }] }] }, next());
    assert.equal(r2.code, 200, JSON.stringify(r2.body));
    const all = (await HD(A).where('m', '==', M).get()).docs.map((d) => d.data());
    assert.equal(all.length, 3);
    const e12 = all.find((x) => x.e === '12');
    assert.deepEqual(e12.rows, R1); assert.equal(e12.nm, 'מיכל רוזנצוויג'); assert.equal(e12.br, 'יהודה הנשיא'); assert.equal(e12.n, 3);
    assert.notEqual(all.find((x) => x.e === '13').bk, e12.bk, 'מפתח סניף שונה');
    // העלאה חוזרת של עובד 12 בלבד – מחליפה אותו, 15 נשאר
    assert.equal((await up({ emps: [{ id: '12', nm: 'מיכל רוזנצוויג', rows: R1.slice(0, 1) }] }, next())).code, 200);
    const again = (await HD(A).where('m', '==', M).get()).docs.map((d) => d.data());
    assert.equal(again.length, 3); assert.equal(again.find((x) => x.e === '12').rows.length, 1); assert.equal(again.find((x) => x.e === '15').rows.length, 1);
    // החודש הקודם מותר; poll מודיע hours
    assert.equal((await up({ m: PM, emps: [{ id: '12', nm: 'x', rows: [{ d: '2026-11-28', i: '08:00', o: '16:00', b: 30 }] }] }, next())).code, 200);
    assert.ok((await okb(TOK, { op: 'poll' })).caps.includes('hours'));
    const d = JSON.stringify(await dev());
    for (const w of ['רוזנצוויג', 'שטרנברג', '07:41']) assert.ok(!d.includes(w), w);
    assert.equal((await dev()).hrl.n, 1);
  });

  it('אימות קפדני: שדות, טיפוסים, תאריך מחודש אחר, שעה, מזהה כפול, גבולות; חודש עתידי / ישן; סוג לא מוכר', async () => {
    const e = (rows, x) => [Object.assign({ id: '21', nm: 'בדיקה', rows }, x || {})];
    const bad = async (b, reason) => { const r = await up(b, next()); assert.equal(r.code, 400, JSON.stringify(b).slice(0, 120) + ' ' + JSON.stringify(r.body)); assert.equal(r.body.reason, reason, JSON.stringify(r.body)); };
    await bad({ emps: e(R1), x: 1 }, 'bad-field');
    await bad({ emps: e([{ d: '2026-12-01', i: '07:00', o: '', b: 0, z: 1 }]) }, 'bad-field');
    await bad({ emps: e(R1, { phone: '050' }) }, 'bad-field');
    await bad({ m: '2026-13', emps: e(R1) }, 'bad-month');
    await bad({ m: '2027-01', emps: e([{ d: '2027-01-01', i: '07:00', o: '', b: 0 }]) }, 'bad-month');
    await bad({ m: '2026-10', emps: e([{ d: '2026-10-01', i: '07:00', o: '', b: 0 }]) }, 'bad-month');
    await bad({ br: '', emps: e(R1) }, 'bad-br');
    await bad({ br: 'a/b', emps: e(R1) }, 'bad-br');
    await bad({ br: 'x'.repeat(41), emps: e(R1) }, 'bad-br');
    await bad({ emps: [] }, 'bad-emps');
    await bad({ emps: Array.from({ length: 301 }, (_, k) => ({ id: String(k + 1), nm: 'x', rows: R1 })) }, 'bad-emps');
    await bad({ emps: [{ id: 'abc', nm: 'x', rows: R1 }] }, 'bad-emp');
    await bad({ emps: [{ id: '1', nm: 'x', rows: R1 }, { id: '1', nm: 'y', rows: R1 }] }, 'bad-emp');
    await bad({ emps: e(R1, { nm: 'x'.repeat(61) }) }, 'bad-emp');
    await bad({ emps: e(R1, { nm: 'a\nb' }) }, 'bad-emp');
    await bad({ emps: e([]) }, 'bad-rows');
    await bad({ emps: e(Array.from({ length: 201 }, () => R1[0])) }, 'bad-rows');
    await bad({ emps: Array.from({ length: 60 }, (_, k) => ({ id: String(k + 1), nm: 'x', rows: Array.from({ length: 170 }, () => R1[0]) })) }, 'bad-rows');
    await bad({ emps: e([{ d: '2026-11-30', i: '07:00', o: '', b: 0 }]) }, 'bad-row');
    await bad({ emps: e([{ d: '2026-12-32', i: '07:00', o: '', b: 0 }]) }, 'bad-row');
    await bad({ emps: e([{ d: '2026-12-01', i: '7:00', o: '', b: 0 }]) }, 'bad-row');
    await bad({ emps: e([{ d: '2026-12-01', i: '07:00', o: '24:00', b: 0 }]) }, 'bad-row');
    await bad({ emps: e([{ d: '2026-12-01', i: '07:00', o: '', b: -1 }]) }, 'bad-row');
    await bad({ emps: e([{ d: '2026-12-01', i: '07:00', o: '', b: 0, t: 1.5 }]) }, 'bad-row');
    await bad({ emps: e([{ d: '2026-12-01', i: '07:00', o: '', b: 0, n: 1 }]) }, 'bad-row');
    await bad({ emps: e(['x']) }, 'bad-row');
    await bad({ run: 'bad id!', emps: e(R1) }, 'bad-run');
    const r = await bot(TOK, { op: 'upload', ver: '0.1.14', kind: 'shifts', emps: [] }, { o: { now: next() } });
    assert.equal(r.code, 400);
    assert.equal((await HD(A).where('e', '==', '21').get()).size, 0, 'שום דבר לא נשמר');
  });

  it('קצב: אותו סניף+חודש פעם בדקה (סניף אחר – מותר); עד 160 ביום (0.1.15)', async () => {
    const T0 = next() + 120e3;
    const em = [{ id: '31', nm: 'x', rows: R1.slice(0, 1) }];
    assert.equal((await up({ emps: em }, T0)).code, 200);
    const r = await up({ emps: em }, T0 + 30e3);
    assert.equal(r.code, 429); assert.equal(r.body.reason, 'rate');
    assert.equal((await up({ br: 'נחל לכיש', emps: em }, T0 + 30e3)).code, 200, 'סניף אחר');
    assert.equal((await up({ emps: em }, T0 + 61e3)).code, 200, 'אחרי דקה');
    await adm().doc(`b/${A}/private/cxbot`).set({ hr: { d: BOT.ilDay(T0), n: 159, k: {} } }, { merge: true });
    assert.equal((await up({ br: 'סניף ב', emps: em }, T0 + 200e3)).code, 200, '159 → עוד אחת מותרת');
    assert.equal((await up({ br: 'סניף אחר', emps: em }, T0 + 200e3)).body.reason, 'rate', 'מעל 160 ביום');
    await adm().doc(`b/${A}/private/cxbot`).set({ hr: null }, { merge: true });
    t = T0 + 300e3;
  });

  it('קריאה: רק מנהל (עובד / בלי התחברות – לא); עסק אחר לא רואה; חודש לא תקין; האפליקציה לא קוראת ישירות מהמסד', async () => {
    const r = await ok('cxBotTok', MGR, { op: 'hours', m: M });
    assert.equal(r.m, M);
    const e12 = r.list.find((x) => x.e === '12' && x.br === 'יהודה הנשיא');
    assert.ok(e12, JSON.stringify(r.list.map((x) => [x.br, x.e]))); assert.equal(e12.nm, 'מיכל רוזנצוויג'); assert.equal(e12.rows.length, 1);
    assert.ok(r.list.some((x) => x.e === '13' && x.br === 'נחל לכיש'));
    assert.ok(!r.list.some((x) => x.e === '12' && x.rows.some((y) => y.d.startsWith(PM))), 'רק החודש המבוקש');
    assert.equal((await ok('cxBotTok', MGR, { op: 'hours', m: PM })).list.length, 1);
    assert.equal((await call('cxBotTok', E1, { op: 'hours', m: M })).reason, 'manager-only');
    assert.notEqual((await call('cxBotTok', null, { op: 'hours', m: M })).status, 'OK');
    assert.deepEqual((await ok('cxBotTok', MB, { op: 'hours', m: M })).list, [], 'עסק אחר – ריק');
    assert.equal((await call('cxBotTok', MGR, { op: 'hours', m: '2026-1' })).reason, 'bad-month');
    assert.equal((await call('cxBotTok', MGR, { op: 'hours', m: M, x: 1 })).reason, 'bad-field');
    assert.equal((await call('cxBotTok', MGR, { op: 'info', m: M })).reason, 'bad-field', 'm רק ב-op hours');
    const id = (await HD(A).limit(1).get()).docs[0].id;
    const { assertFails } = require('@firebase/rules-unit-testing');
    await assertFails(env.authenticatedContext(MGR).firestore().doc(`b/${A}/cxHrs/${id}`).get());
  });
  it('0.1.15 empty: מוחק רק את סניף+חודש+עובד שברשימה – לא סניף / חודש / עסק אחר, לא עובד שלא הופיע; emps ריק מותר רק עם empty; קלט לא תקין נדחה; החודש הקודם → bad-empty-month; caps כולל hours2', async () => {
    assert.ok((await okb(TOK, { op: 'poll' })).caps.includes('hours2'));
    const em = (id) => ({ id, nm: 'x', rows: R1.slice(0, 1) });
    const pm = (id) => ({ id, nm: 'x', rows: [{ d: '2026-11-28', i: '08:00', o: '16:00', b: 30 }] });
    // הכנה: 41 ו-42 ביהודה הנשיא, 41 גם בנחל לכיש ובחודש הקודם, 41 בעסק B
    assert.equal((await up({ emps: [em('41'), em('42')] }, next())).code, 200);
    assert.equal((await up({ br: 'נחל לכיש', emps: [em('41')] }, next())).code, 200);
    assert.equal((await up({ m: PM, emps: [pm('41')] }, next())).code, 200);
    const TB = (await ok('cxBotTok', MB, { op: 'new' })).token;
    assert.equal((await up({ emps: [em('41')] }, next(), TB)).code, 200);
    const has = async (biz, m, br, id) => (await HD(biz).where('m', '==', m).where('e', '==', id).get()).docs.some((d) => d.get('br') === br);
    // empty עם emps ריק → רק 41 / יהודה הנשיא / החודש הנוכחי / עסק A
    const r = await up({ emps: [], empty: ['41'] }, next());
    assert.equal(r.code, 200, JSON.stringify(r.body)); assert.equal(r.body.n, 0); assert.equal(r.body.del, 1);
    assert.equal(await has(A, M, 'יהודה הנשיא', '41'), false, 'נמחק');
    assert.equal(await has(A, M, 'יהודה הנשיא', '42'), true, 'עובד שלא ברשימה – נשאר');
    assert.equal(await has(A, M, 'נחל לכיש', '41'), true, 'סניף אחר – נשאר');
    assert.equal(await has(A, PM, 'יהודה הנשיא', '41'), true, 'חודש אחר – נשאר');
    assert.equal(await has(B, M, 'יהודה הנשיא', '41'), true, 'עסק אחר – נשאר');
    // יחד עם emps: 42 נמחק, 43 נשמר; מזהה שאין לו מסמך – בלי שגיאה
    const r2 = await up({ emps: [em('43')], empty: ['42', '99'] }, next());
    assert.equal(r2.code, 200, JSON.stringify(r2.body)); assert.equal(r2.body.del, 2);
    assert.equal(await has(A, M, 'יהודה הנשיא', '42'), false); assert.equal(await has(A, M, 'יהודה הנשיא', '43'), true);
    assert.equal((await up({ emps: [em('42')] }, next())).code, 200); // 42 חוזר – לבדיקות הקלט הלא תקין
    // החודש הקודם (מותר ל-emps) – empty נדחה (bad-empty-month), כלום לא נשמר ולא נמחק
    const r3 = await up({ m: PM, emps: [pm('44')], empty: ['41'] }, next());
    assert.equal(r3.code, 400, JSON.stringify(r3.body)); assert.equal(r3.body.reason, 'bad-empty-month');
    assert.equal(await has(A, PM, 'יהודה הנשיא', '41'), true, 'החודש הקודם – לא נמחק'); assert.equal(await has(A, PM, 'יהודה הנשיא', '44'), false);
    assert.equal((await up({ m: PM, emps: [], empty: ['41'] }, next())).body.reason, 'bad-empty-month');
    // קלט לא תקין – שום דבר לא נמחק
    const bad = async (b, reason) => { const x = await up(b, next()); assert.equal(x.code, 400, JSON.stringify(b).slice(0, 100) + ' ' + JSON.stringify(x.body)); assert.equal(x.body.reason, reason); };
    await bad({ emps: [], empty: [] }, 'bad-empty');
    await bad({ emps: [], empty: '42' }, 'bad-empty');
    await bad({ emps: [], empty: [42] }, 'bad-empty');
    await bad({ emps: [], empty: ['4a'] }, 'bad-empty');
    await bad({ emps: [], empty: ['../x'] }, 'bad-empty');
    await bad({ emps: [], empty: ['1234567890123'] }, 'bad-empty');
    await bad({ emps: [], empty: ['42', '42'] }, 'bad-empty');
    await bad({ emps: [em('42')], empty: ['42'] }, 'bad-empty');
    await bad({ emps: [], empty: Array.from({ length: 301 }, (_, k) => String(k + 1)) }, 'bad-empty');
    await bad({ emps: [em('1')], empty: Array.from({ length: 300 }, (_, k) => String(k + 2)) }, 'bad-emps');
    await bad({ m: '2026-10', emps: [], empty: ['42'] }, 'bad-month');
    await bad({ m: PM, emps: [], empty: ['42'] }, 'bad-empty-month');
    await bad({ m: '2027-01', emps: [], empty: ['42'] }, 'bad-month');
    await bad({ emps: [] }, 'bad-emps');
    assert.equal(await has(A, M, 'יהודה הנשיא', '42'), true, 'קלט שנדחה לא מחק');
  });
});

describe('רובוט כספית – סבב 2: התראת איחור משעות כספית, ותקלות שעות בהתראות', () => {
  const at = (day, hm) => { const [y, m, d] = day.split('-').map(Number); const [H, M] = hm.split(':').map(Number); return TK.zoned(y, m - 1, d, H, M); };
  const M = '2026-12';
  let br = 0;
  // כל העלאה – סניף אחר (בלי מגבלת הקצב של סניף+חודש)
  const up = (emps, now, tok) => bot(tok || TOK, { op: 'upload', ver: '0.1.14', run: rid('cl'), kind: 'hours', br: 'סניף ' + (br++), m: M, emps }, { o: { now } });
  const sent = async (biz, day) => { const s = await adm().doc(`b/${biz}/shfsent/${day}`).get(); return (s.exists && s.get('late')) || {}; };
  const late = () => PUSH.filter((x) => /^lt/.test(x.id));
  before(async () => {
    await adm().doc(`b/${A}/private/cxbot`).set({ hr: null }, { merge: true });
    await adm().doc(`b/${A}/shfcfg/map`).set({ m: { 'דנה  כהן': E1 } }); // רווח כפול – ההתאמה מנרמלת
    for (const [id, d] of [['LT1', '2026-12-08'], ['LT2', '2026-12-09'], ['LT3', '2026-12-12']]) await adm().doc(`b/${A}/shf/${id}`).set({ d, s: '08:00', e: '14:00', u: E1, nm: E1, fx: false });
    await adm().doc(`b/${B}/shfcfg/map`).set({ m: { 'יוסי לוי': MB } });
    await adm().doc(`b/${B}/shf/LB1`).set({ d: '2026-12-10', s: '08:00', e: '14:00', u: MB, nm: MB, fx: false });
  });

  it('איחור של 6 דקות → התראה אחת למנהל; העלאה נוספת באותו יום (גם מסניף אחר) → אין התראה נוספת; בלי שם ביומן / ב-private', async () => {
    PUSH.length = 0;
    const D = '2026-12-08';
    let r = await up([{ id: '501', nm: 'דנה כהן', rows: [{ d: D, i: '08:06', o: '', b: 0 }] }], at(D, '09:00'));
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(late().length, 1, JSON.stringify(PUSH));
    assert.equal(late()[0].k, 'sh'); assert.match(late()[0].body, /08:06/); assert.match(late()[0].body, /08:00/); assert.match(late()[0].body, /6 דקות/);
    assert.ok((await sent(A, D))[E1], 'נרשם ב-shfsent.late');
    r = await up([{ id: '501', nm: 'דנה כהן', rows: [{ d: D, i: '08:06', o: '', b: 0 }] }], at(D, '09:30'));
    assert.equal(r.code, 200);
    r = await up([{ id: '777', nm: 'דנה כהן', rows: [{ d: D, i: '08:20', o: '', b: 0 }] }], at(D, '10:00'));
    assert.equal(r.code, 200);
    assert.equal(late().length, 1, 'פעם אחת לעובד ליום');
    assert.ok(!JSON.stringify(await dev()).includes('דנה'));
  });

  it('איחור של 4 דקות → אין; עובד לא ממופה → אין; החודש הקודם / יום בלי משמרת → אין', async () => {
    PUSH.length = 0;
    const D = '2026-12-09';
    assert.equal((await up([{ id: '501', nm: 'דנה כהן', rows: [{ d: D, i: '08:04', o: '', b: 0 }] }], at(D, '09:00'))).code, 200);
    assert.equal((await up([{ id: '502', nm: 'מישהו אחר', rows: [{ d: D, i: '09:30', o: '', b: 0 }] }], at(D, '10:00'))).code, 200);
    assert.equal(late().length, 0);
    assert.deepEqual(await sent(A, D), {});
    // יום בלי משמרת לעובד
    assert.equal((await up([{ id: '501', nm: 'דנה כהן', rows: [{ d: '2026-12-11', i: '10:00', o: '', b: 0 }] }], at('2026-12-11', '10:30'))).code, 200);
    assert.equal(late().length, 0);
  });

  it('עסק אחר מבודד: מיפוי ומשמרת בעסק B לא מתריעים על העלאה של עסק A', async () => {
    PUSH.length = 0;
    const D = '2026-12-10';
    assert.equal((await up([{ id: '601', nm: 'יוסי לוי', rows: [{ d: D, i: '08:30', o: '', b: 0 }] }], at(D, '09:00'))).code, 200);
    assert.equal(late().length, 0);
    assert.deepEqual(await sent(A, D), {}); assert.deepEqual(await sent(B, D), {});
  });

  it('שבת → אין התראה', async () => {
    PUSH.length = 0;
    const D = '2026-12-12';
    assert.equal((await up([{ id: '501', nm: 'דנה כהן', rows: [{ d: D, i: '08:30', o: '', b: 0 }] }], at(D, '09:00'))).code, 200);
    assert.equal(late().length, 0);
    assert.deepEqual(await sent(A, D), {});
  });

  // שעון הקופה (shifts.js posLate, נקרא מ-pos-clock.js אחרי החתמת כניסה) – אותו רישום כפילויות כמו כספית
  const posIn = async (D, hm, prev) => {
    const SH = require('../functions/shifts.js')._core, T = require('../functions/lib/tenant.js');
    const tt = at(D, hm), id = E1 + '_' + tt;
    for (const p of prev || []) await adm().doc(`b/${A}/posclock/${E1}_${at(D, p)}`).set({ who: E1, in: at(D, p), out: at(D, p) + 60e3, day: D.replace(/-/g, '') });
    await adm().doc(`b/${A}/posclock/${id}`).set({ who: E1, in: tt, out: null, day: D.replace(/-/g, '') });
    return T.runInBiz({ bizId: A, prefix: 'b/' + A + '/', biz: { bizId: A, dataRoot: 'b' } }, () => SH.posLate(E1, tt, { send }));
  };
  it('שעון הקופה: איחור 6 דק\' → התראה אחת; 4 → אין; אחרי התראה מכספית באותו יום → אין (ולהפך); שבת / בלי משמרת / כניסה שנייה ביום → אין', async () => {
    for (const [id, d] of [['LP1', '2026-12-15'], ['LP2', '2026-12-16'], ['LP3', '2026-12-17'], ['LP4', '2026-12-19'], ['LP5', '2026-12-21']]) await adm().doc(`b/${A}/shf/${id}`).set({ d, s: '08:00', e: '14:00', u: E1, nm: E1, fx: false });
    PUSH.length = 0;
    assert.equal(await posIn('2026-12-15', '08:06'), 1);
    assert.equal(late().length, 1); assert.match(late()[0].body, /08:06/); assert.match(late()[0].body, /6 דקות/); assert.match(late()[0].body, /שעון הקופה/);
    assert.ok((await sent(A, '2026-12-15'))[E1]);
    assert.equal(await posIn('2026-12-15', '08:20'), 0, 'פעם ביום');
    // אחרי הקופה – כספית לא שולחת שוב
    assert.equal((await up([{ id: '501', nm: 'דנה כהן', rows: [{ d: '2026-12-15', i: '08:07', o: '', b: 0 }] }], at('2026-12-15', '09:00'))).code, 200);
    assert.equal(late().length, 1, 'כספית אחרי הקופה – אין נוספת');
    // 4 דקות → אין
    assert.equal(await posIn('2026-12-16', '08:04'), 0); assert.deepEqual(await sent(A, '2026-12-16'), {});
    // כספית קודם, הקופה אחריה → אין
    PUSH.length = 0;
    assert.equal((await up([{ id: '501', nm: 'דנה כהן', rows: [{ d: '2026-12-17', i: '08:10', o: '', b: 0 }] }], at('2026-12-17', '09:00'))).code, 200);
    assert.equal(late().length, 1);
    assert.equal(await posIn('2026-12-17', '08:11'), 0); assert.equal(late().length, 1, 'הקופה אחרי כספית – אין נוספת');
    // שבת; יום בלי משמרת; כניסה שנייה ביום (הראשונה בזמן)
    PUSH.length = 0;
    assert.equal(await posIn('2026-12-19', '08:30'), 0, 'שבת');
    assert.equal(await posIn('2026-12-18', '10:00'), 0, 'בלי משמרת');
    assert.equal(await posIn('2026-12-21', '13:00', ['07:58']), 0, 'כניסה שנייה ביום');
    assert.equal(late().length, 0);
    assert.ok(!JSON.stringify(await dev()).includes('דנה'));
  });

  it('תקלות שעות (hours-*) בדיווח הריצה → התראה למנהל בעברית, פעם ביום', async () => {
    const T1 = at('2026-12-14', '11:00');
    await adm().doc(`b/${A}/private/cxbot.watch`).delete();
    await adm().doc(`b/${A}/private/cxbot`).set({ sd: '2026-12-13', lr: { id: 'rh', at: T1 - 3600e3, st: 'fail', code: 'hours-branch', msg: '', step: 'hours' } }, { merge: true });
    PUSH.length = 0;
    assert.ok((await BOT.runWatch({ now: T1, send }))[A].includes('hours-branch')); // pd – שארית מבדיקה קודמת, לא רלוונטי
    assert.match(PUSH.find((x) => x.id === 'hours-branch').body, /נחל לכיש/);
    assert.ok(!(await BOT.runWatch({ now: T1 + 3600e3, send }))[A].includes('hours-branch'), 'פעם ביום');
    for (const c of ['hours-format', 'hours-list', 'hours-month', 'hours-branch', 'hours-fail']) assert.ok(typeof BOT.MSG[c] === 'string' && /[א-ת]/.test(BOT.MSG[c]), c);
    await adm().doc(`b/${A}/private/cxbot`).set({ lr: null }, { merge: true });
  });
});
