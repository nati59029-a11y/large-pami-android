'use strict';
// מצב b מול האמולטור עם החוקים של שלב 2, בשני עסקים (acme, beta). רץ בתוך emulators:exec.
// משתני סביבה: FIRESTORE_EMULATOR_HOST, FIREBASE_AUTH_EMULATOR_HOST, FIREBASE_STORAGE_EMULATOR_HOST. פלט: node b-emulator.js <www> <out.json>
const fs = require('fs');
const H = require('./harness');
const [www, out] = process.argv.slice(2);
const FS = process.env.FIRESTORE_EMULATOR_HOST, AU = process.env.FIREBASE_AUTH_EMULATOR_HOST, ST = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
const port = (h) => +h.split(':')[1];
const P = 'demo-largpeami';
const sv = (v) => ({ stringValue: v });
const BIZ = ['acme', 'beta'];
const FEAT = { tasks: true, cashClose: true, feedback: true, shelf: true, suppliers: true, requests: true };
async function put(path, fields) { // כתיבה עוקפת חוקים (owner) – רק להכנת הנתונים
  const r = await fetch(`http://${FS}/v1/projects/${P}/databases/(default)/documents/${path}`, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) });
  if (!r.ok) throw new Error('seed ' + path + ' ' + r.status + ' ' + await r.text());
}
async function signUp(email) {
  const r = await fetch(`http://${AU}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'pw-123456', returnSecureToken: true }) });
  const j = await r.json(); if (!j.localId) throw new Error('signUp ' + JSON.stringify(j)); return j.localId;
}
const fmap = (o) => ({ mapValue: { fields: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { booleanValue: v }])) } });
async function step(page, name, fn, arg) { page.__step = name; const r = await page.evaluate(fn, arg); await H.settle(page, 1500); return r; }

(async () => {
  const U = {};
  for (const b of BIZ) {
    await put('b/' + b, { name: sv(b), status: sv('active'), dataRoot: sv('b'), schemaVersion: { integerValue: '1' }, features: fmap(FEAT) });
    const m = await signUp(`m-${b}@x.co`), w = await signUp(`w-${b}@x.co`); U[b] = { m, w };
    await put('users/' + m, { bizId: sv(b), role: sv('admin'), email: sv(`m-${b}@x.co`) });
    await put('users/' + w, { bizId: sv(b), role: sv('worker'), email: sv(`w-${b}@x.co`) });
    await put(`b/${b}/admins/${m}`, { email: sv(`m-${b}@x.co`) });
    await put(`b/${b}/staff/${w}`, { active: { booleanValue: true }, email: sv(`w-${b}@x.co`) });
  }
  const cfg = { fwd: { 8080: port(FS), 9099: port(AU), 9199: port(ST) } };
  const log = []; const errors = {}; const res = {};
  const browser = await H.launch();
  for (const b of BIZ) {
    // מנהל: כניסה, משיכה, ושאילתת batchGet (zsLoad)
    let { ctx, page } = await H.newPage(browser, www, cfg, log, 'm-' + b);
    await H.login(page, `m-${b}@x.co`);
    await step(page, 'pull', async () => { try { await pullInbox(); } catch (e) { return e.message; } });
    res['batchGet-' + b] = await step(page, 'batchGet', async () => { try { const q = await fsx(':batchGet', { method: 'POST', body: JSON.stringify({ documents: [docName('deposits/d1')] }) }); return 'ok ' + JSON.stringify(q).slice(0, 80); } catch (e) { return 'ERR ' + e.code + ' ' + e.message; } });
    res['state-m-' + b] = await page.evaluate(() => ({ bizId: SY.bizId, role: SY.role, BZP, gate: !!document.getElementById('gate') }));
    errors['m-' + b] = page.__errors; await ctx.close();
    // עובד: הוצאה מקופה, מסמך עם צילום, משימה, סגירת קופה
    ({ ctx, page } = await H.newPage(browser, www, cfg, log, 'w-' + b));
    await H.login(page, `w-${b}@x.co`);
    res['state-w-' + b] = await page.evaluate(() => ({ bizId: SY.bizId, role: SY.role, BZP, gate: !!document.getElementById('gate') }));
    res['expense-' + b] = await step(page, 'expense', async () => { try { await pushItem({ id: 'wexp' + Date.now(), created: new Date().toISOString(), nopic: 1, data: { amt: '120', cat: 'c1', note: 'קניתי חלב', reg: 1, creg: 'i_yh', date: new Date().toISOString().slice(0, 10), ctm: '08:55' } }); return 'ok'; } catch (e) { return 'ERR ' + e.code + ' ' + e.message; } });
    res['document-' + b] = await step(page, 'document', async () => { try { await fput('fdoc1', 'data:image/jpeg;base64,AAAA'); await pushItem({ id: 'wdoc' + Date.now(), created: new Date().toISOString(), fileId: 'fdoc1', data: { amt: '50', cat: 'c1' } }); return 'ok'; } catch (e) { return 'ERR ' + e.code + ' ' + e.message; } });
    res['task-' + b] = await step(page, 'task', async () => { const f = document.createElement('form'); f.innerHTML = '<input name="txt" value="לנקות את המדף"><button>שלח</button>'; document.body.append(f); let m = ''; const t0 = window.toast; window.toast = (x) => { m = x; }; await FRM.tkAdd(f); window.toast = t0; f.remove(); return m; });
    res['closing-' + b] = await step(page, 'closing', async () => {
      const iv = (v) => ({ integerValue: String(v) }); const d = new Date().toISOString().slice(0, 10);
      const fields = { uid: sv(SY.uid), by: sv((SY.email || '').split('@')[0]), t: iv(Date.now()), st: sv('new'), np: iv(1), reg: sv('i_yh'), d: sv(d), no: sv('777'), tm: sv('09:02'), data: sv(JSON.stringify({ v: 1, f: { d, tm: '09:02', no: '777', credit: '10', cash: '10', total: '20', drawer: '0' }, rs: 'auto', ack: 1, why: '', ai: {} })) };
      try { await zcCommit('zc' + Date.now(), fields, 'i_yh', d, '09:02'); return 'ok'; } catch (e) { return 'ERR ' + e.code + ' ' + e.message; } });
    errors['w-' + b] = page.__errors; await ctx.close();
  }
  await browser.close();
  // אימות בצד השרת: המסמכים נכתבו בתוך העסק, ולא בשורש
  const count = async (path) => { const r = await fetch(`http://${FS}/v1/projects/${P}/databases/(default)/documents/${path}?pageSize=300`, { headers: { Authorization: 'Bearer owner' } }); const j = await r.json(); return (j.documents || []).length; };
  const where = {};
  for (const c of ['inbox', 'chunks', 'cashout', 'tasks', 'closings']) { where[c] = { root: await count(c) }; for (const b of BIZ) where[c][b] = await count(`b/${b}/${c}`); }
  fs.writeFileSync(out, JSON.stringify({ res, errors, where, requests: log }, null, 1));
  console.log(JSON.stringify({ res, errors, where }, null, 1));
  const bad = log.filter((r) => typeof r.status !== 'number' || (r.status >= 400 && !(r.status === 404 && r.method === 'GET')));
  console.log('בקשות שנכשלו (חוץ מ-404 בקריאה):', bad.length); bad.forEach((r) => console.log(' ', r.status, r.who, r.step, r.method, decodeURIComponent(r.url).replace(/^.*documents/, ''), r.body.slice(0, 160)));
})().catch((e) => { console.error(e); process.exit(1); });
