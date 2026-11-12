'use strict';
// אפליקציה עם סמל העסק – מצב הבנייה בכרטיס העסק (12.11.2026) מול אמולטורים אמיתיים (Auth, Firestore, Storage, Functions) עם החוקים והפונקציות של הענף.
// בודק: מנהל־על רואה את הכפתור בכל מסך ובכל עסק ועובר בין עסקים דרכו; מנהל רגיל ועובד לא רואים אותו;
// גם כשמכריחים את הכפתור/החלון להופיע אצל מנהל רגיל – השרת חוסם (רשימת עסקים, logBusinessEntry, superadmins); אין שגיאות JS; מסך צר.
// שימוש: node ui-safab.js <www-dir> <out.json> [shots-dir]
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const FS = process.env.FIRESTORE_EMULATOR_HOST, AU = process.env.FIREBASE_AUTH_EMULATOR_HOST, ST = process.env.FIREBASE_STORAGE_EMULATOR_HOST, FN = process.env.FUNCTIONS_EMULATOR_HOST;
const port = (h) => +h.split(':')[1];
const P = 'demo-largpeami';
const BZ0 = ['larg', 'peami'].join('');
const sv = (v) => ({ stringValue: v });
const bv = (v) => ({ booleanValue: v });
const out = {}; let fail = 0;
const check = (name, ok, info) => { out[name] = { ok: !!ok, info }; if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const DOCS = `http://${FS}/v1/projects/${P}/databases/(default)/documents/`;
async function put(p, fields) {
  const r = await fetch(DOCS + p, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) });
  if (!r.ok) throw new Error('seed ' + p + ' ' + r.status + ' ' + await r.text());
}
async function signUp(email) {
  const r = await fetch(`http://${AU}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'pw-123456', returnSecureToken: true }) });
  const j = await r.json(); if (!j.localId) throw new Error('signUp ' + JSON.stringify(j)); return j.localId;
}
const ft = (o) => ({ mapValue: { fields: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, bv(v)])) } });
async function seedBiz(id, extra) {
  await put('b/' + id, Object.assign({ name: sv('עסק ' + id), status: sv('active'), dataRoot: sv('b'), schemaVersion: { integerValue: '1' }, features: ft({}), brand: { mapValue: { fields: { name: sv('עסק ' + id), logoPath: sv(''), base: sv('dark-gold'), colors: { mapValue: { fields: {} } } } } } }, extra || {}));
  await put(`b/${id}/private/info`, { ownerEmail: sv('owner@' + id + '.co'), ownerPhone: sv('0500000000') });
}
async function seedMember(biz, email, role) {
  const uid = await signUp(email);
  await put('users/' + uid, { bizId: sv(biz), role: sv(role), active: bv(true), bizStatus: sv('active'), email: sv(email) });
  if (role === 'admin') await put(`b/${biz}/admins/${uid}`, { email: sv(email) });
  else await put(`b/${biz}/staff/${uid}`, { active: bv(true), email: sv(email), name: sv(email.split('@')[0]), role: sv('employee') });
  return uid;
}

(async () => {
  const [www, outFile, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const cfg = { fwd: { 8080: port(FS), 9099: port(AU), 9199: port(ST), 5001: port(FN) } };
  const browser = await H.launch();
  const shot = async (page, name) => { if (shots) await page.screenshot({ path: path.join(shots, name + '.png'), fullPage: true }); };
  const open = async (email, log, label) => {
    const { ctx, page } = await H.newPage(browser, www, cfg, log, label);
    await page.setViewportSize({ width: 360, height: 740 });
    await page.addInitScript(() => { window.__toasts = []; new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.classList && n.classList.contains('toast')) window.__toasts.push(n.textContent); }))).observe(document, { childList: true, subtree: true }); });
    await H.login(page, email);
    await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden && ACT.startBlank) ACT.startBlank(); });
    return { ctx, page };
  };
  const wait = (page, ms) => H.settle(page, ms || 1500);
  const until = async (fn, ms) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 250)); } return false; };
  const card = (page, id) => page.evaluate(async (b) => { ADM.L = null; ADM.err = ''; await admLoad(); go('sab', b); await new Promise((r) => setTimeout(r, 1500));
    const c = document.getElementById('apkC'); return { apk: c ? c.innerText.replace(/\s+/g, ' ') : '', invite: !!document.querySelector('[data-a=admMail]'), btns: c ? [...c.querySelectorAll('[data-a]')].map((e) => e.dataset.a + (e.dataset.nologo ? '(nl)' : '')) : [] }; }, id);

  await seedBiz('home', {});
  const saUid = await signUp('sa@x.co');
  await put('users/' + saUid, { bizId: sv('home'), role: sv('admin'), active: bv(true), bizStatus: sv('active'), email: sv('sa@x.co') });
  await put('b/home/admins/' + saUid, { email: sv('sa@x.co') });
  await put('superadmins/' + saUid, {});
  await seedBiz('nolo', {});
  await seedBiz('bld', { brand: { mapValue: { fields: { name: sv('בונה'), logoPath: sv('b/bld/brand/logo') } } }, apkState: { mapValue: { fields: { st: sv('building'), t: { integerValue: String(Date.now()) } } } } });
  await seedBiz('rdy', { brand: { mapValue: { fields: { name: sv('מוכן'), logoPath: sv('b/rdy/brand/logo') } } }, apkTag: sv('biz-rdy'), apkState: { mapValue: { fields: { st: sv('ready'), t: { integerValue: '5' }, rebuild: bv(true) } } } });
  await seedMember('rdy', 'ma@x.co', 'admin');

  const log = []; let { ctx, page } = await open('sa@x.co', log, 'sa');
  await page.evaluate(() => { NAV = [{ v: 'settings' }]; render(0); }); await until(() => page.evaluate(() => ADM.sa === 1), 15000);
  let c = await card(page, 'nolo');
  check('1 עסק בלי לוגו: "לעסק אין לוגו", שאלה אם להמשיך בלי לוגו, ואין "שלח הזמנה"', /לעסק אין לוגו/.test(c.apk) && c.btns.includes('apkBuild(nl)') && c.btns.includes('go') && !c.invite, c);
  await shot(page, '01-בלי-לוגו');
  page.__step = 'req';
  await page.click('#apkC [data-a=apkBuild]'); await wait(page, 3000);
  const called = log.some((r) => r.step === 'req' && /requestBizApk/.test(r.url));
  c = await page.evaluate(() => ({ apk: document.getElementById('apkC').innerText.replace(/\s+/g, ' '), invite: !!document.querySelector('[data-a=admMail]'), t: window.__toasts.slice(-1)[0] || '' }));
  check('2 "המשך בלי לוגו" קורא ל-requestBizApk; באמולטור אין מפתח GitHub – הודעה מתאימה, וההזמנה לאפליקציה הכללית זמינה', called && /לא הוגדרה/.test(c.t) && /לא הוגדרה/.test(c.apk) && c.invite, { called, c });
  c = await card(page, 'bld');
  check('3 בנייה רצה: "בונה את האפליקציה…", ואין "שלח הזמנה" (גם אחרי no-token במכשיר הזה – רק במצב בנייה)', /בונה את האפליקציה/.test(c.apk) && c.btns.length === 0 && !c.invite, c);
  await shot(page, '02-בונה');
  c = await card(page, 'rdy');
  check('4 מוכנה: "האפליקציה של העסק מוכנה", "שלח הזמנה" מוצג, ושאלה אם לשלוח קישור מעודכן', /מוכנה/.test(c.apk) && c.invite && c.btns.includes('apkSend') && c.btns.includes('apkNo'), c);
  await shot(page, '03-מוכנה');
  await page.click('#apkC [data-a=apkNo]'); await wait(page, 600);
  c = await page.evaluate(() => ({ btns: [...document.querySelectorAll('#apkC [data-a]')].map((e) => e.dataset.a), invite: !!document.querySelector('[data-a=admMail]') }));
  check('5 "לא עכשיו": השאלה נעלמת ו"שלח הזמנה" נשאר', !c.btns.includes('apkSend') && c.invite, c);
  check('6 אין שגיאות JS (מנהל־על)', page.__errors.length === 0, page.__errors);
  await ctx.close();

  // מנהל רגיל: בכוח – השרת חוסם
  ({ ctx, page } = await open('ma@x.co', [], 'ma'));
  const f = await page.evaluate(async () => { try { await fnCall('requestBizApk', { bizId: 'rdy' }); return 'ok'; } catch (e) { return e.reason || e.message; } });
  check('7 מנהל רגיל: requestBizApk בכוח – נדחה (not-superadmin)', f === 'not-superadmin', f);
  check('8 אין שגיאות JS (מנהל רגיל)', page.__errors.length === 0, page.__errors);
  await ctx.close();
  await browser.close();
  fs.writeFileSync(outFile, JSON.stringify({ out }, null, 1));
  console.log(fail ? `תוצאה: נכשל (${fail})` : 'תוצאה: הכול עבר'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
