'use strict';
// כפתור צף למנהל־על (12.11.2026) מול אמולטורים אמיתיים (Auth, Firestore, Storage, Functions) עם החוקים והפונקציות של הענף.
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
  const shot = async (page, name) => { if (shots) await page.screenshot({ path: path.join(shots, name + '.png') }); };
  const open = async (email, log, label, w) => {
    const { ctx, page } = await H.newPage(browser, www, cfg, log, label);
    await page.setViewportSize({ width: w || 360, height: 740 });
    await page.addInitScript(() => { window.__toasts = []; new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.classList && n.classList.contains('toast')) window.__toasts.push(n.textContent); }))).observe(document, { childList: true, subtree: true }); });
    await H.login(page, email);
    await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden && ACT.startBlank) ACT.startBlank(); });
    return { ctx, page };
  };
  const wait = (page, ms) => H.settle(page, ms || 1500);
  const until = async (fn, ms) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 250)); } return false; };
  const fab = (page) => page.evaluate(() => { const b = document.getElementById('safab'); if (!b) return null; const r = b.getBoundingClientRect(), cs = getComputedStyle(b), bar = document.querySelector('.bar .fab').getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { vis: cs.display !== 'none' && r.width > 0, x: r.left, y: r.top, w: r.width, right: r.right, bottom: r.bottom, vw: innerWidth, vh: innerHeight, onTop: top === b || b.contains(top), overPlus: !(r.right < bar.left || r.left > bar.right || r.bottom < bar.top || r.top > bar.bottom) }; });

  await seedBiz('home', {});
  const saUid = await signUp('sa@x.co');
  await put('users/' + saUid, { bizId: sv('home'), role: sv('admin'), active: bv(true), bizStatus: sv('active'), email: sv('sa@x.co') });
  await put('b/home/admins/' + saUid, { email: sv('sa@x.co') });
  await put('superadmins/' + saUid, {});
  await seedBiz('acme', {});
  await seedMember('acme', 'ma@x.co', 'admin');
  await seedMember('acme', 'wk@x.co', 'worker');
  await seedBiz(BZ0, { dataRoot: sv('legacy'), name: sv('לארג׳ פעמי') });

  // ---------- מנהל־על ----------
  const log = []; let { ctx, page } = await open('sa@x.co', log, 'sa');
  await page.evaluate(() => { NAV = [{ v: 'home' }]; render(0); });
  const okFab = await until(() => page.evaluate(() => !!document.getElementById('safab')), 15000);
  let f = await fab(page);
  check('1 מנהל־על: הכפתור הצף מופיע במסך הבית (בלי להיכנס להגדרות), גלוי, לא מוסתר ולא מסתיר את ה-"+"', okFab && f && f.vis && f.onTop && !f.overPlus && f.x >= 0 && f.right <= f.vw && f.bottom <= f.vh, f);
  await shot(page, '01-בית-מנהל-על-360');
  const views = [];
  for (const v of ['inc', 'exp', 'more', 'settings']) { await page.evaluate((x) => { NAV = [{ v: x }]; render(0); }, v); await wait(page, 500); const g = await fab(page); views.push([v, !!(g && g.vis && g.onTop)]); }
  check('2 הכפתור מופיע בכל המסכים הראשיים (הכנסות, הוצאות, עוד, הגדרות)', views.every((x) => x[1]), views);
  const old = await page.evaluate(() => !!document.querySelector('[data-v="sa"]'));
  check('3 הכניסה הישנה מההגדרות ("עסקים (מנהל־על)") נשארה', old, old);
  await page.click('#safab'); await until(() => page.evaluate(() => !!document.querySelector('#safabd #saL')), 15000);
  let d = await page.evaluate(() => ({ open: document.getElementById('dlg').open, here: document.querySelector('#safabd').innerText.includes('עסק home'), rows: [...document.querySelectorAll('#saL .li')].map((r) => r.innerText.replace(/\s+/g, ' ')), go: [...document.querySelectorAll('#saL [data-a=admEnter]')].map((b) => b.dataset.id).sort(), nav: [...document.querySelectorAll('#safabd [data-a=saNav]')].map((b) => b.dataset.v) }));
  check('4 לחיצה פותחת חלון: העסק הנוכחי, רשימת העסקים עם "עבור לעסק" (לכל עסק חוץ מהנוכחי), וקישור לכל הגדרות מנהל־על', d.open && d.here && d.rows.length === 3 && d.go.join() === ['acme', BZ0].sort().join() && d.nav.includes('sa') && d.nav.includes('sab'), d);
  await shot(page, '02-חלון-מנהל-על-360');
  await page.click('#safabd [data-a=saNav][data-v=sa]'); await wait(page, 1200);
  check('5 "כל העסקים והגדרות מנהל־על" פותח את מסך מנהל־על והחלון נסגר', await page.evaluate(() => cur().v === 'sa' && !document.getElementById('dlg').open && !!document.getElementById('safab')), null);
  // מעבר לעסק acme דרך הכפתור הצף
  page.__step = 'switch';
  await page.click('#safab'); await until(() => page.evaluate(() => !!document.querySelector('#saL [data-a=admEnter][data-id=acme]')), 15000);
  const gen0 = page.__gen;
  await page.click('#saL [data-a=admEnter][data-id=acme]');
  await until(() => page.__gen > gen0, 20000); await wait(page, 3000);
  await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden && ACT.startBlank) ACT.startBlank(); });
  const st = await page.evaluate(() => ({ biz: SY.bizId, role: SY.role }));
  const logged = log.some((r) => r.step === 'switch' && /logBusinessEntry/.test(r.url));
  check('6 מעבר לעסק דרך הכפתור הצף: נרשם ביומן (logBusinessEntry) והאפליקציה נטענה בתוך acme כמנהל', st.biz === 'acme' && st.role === 'admin' && logged, { st, logged });
  await page.evaluate(() => { NAV = [{ v: 'home' }]; render(0); });
  const okFab2 = await until(() => page.evaluate(() => !!document.getElementById('safab')), 15000);
  check('7 בתוך העסק האחר הכפתור הצף עדיין מופיע', okFab2, null);
  await page.click('#safab'); await until(() => page.evaluate(() => !!document.querySelector('#saL [data-a=admEnter]')), 15000);
  d = await page.evaluate(() => ({ here: document.querySelector('#safabd').innerText.includes('עסק acme'), go: [...document.querySelectorAll('#saL [data-a=admEnter]')].map((b) => b.dataset.id).sort() }));
  check('8 בתוך acme: מוצג "acme" כעסק הנוכחי, ואפשר לחזור ל-home או ללארג\' פעמי', d.here && d.go.join() === [BZ0, 'home'].sort().join(), d);
  const gen1 = page.__gen;
  await page.click(`#saL [data-a=admEnter][data-id=${BZ0}]`); await until(() => page.__gen > gen1, 20000); await wait(page, 3000);
  check('9 מעבר חזרה ללארג\' פעמי דרך הכפתור הצף', await page.evaluate((b) => SY.bizId === b, BZ0), null);
  check('10 אין שגיאות JS אצל מנהל־על', page.__errors.length === 0, page.__errors);
  await ctx.close();

  // ---------- מסך צר מאוד (320) ----------
  ({ ctx, page } = await open('sa@x.co', [], 'sa320', 320));
  await page.evaluate(() => { NAV = [{ v: 'home' }]; render(0); });
  await until(() => page.evaluate(() => !!document.getElementById('safab')), 15000);
  f = await fab(page);
  check('11 מסך צר (320px): הכפתור כולו בתוך המסך, לחיץ, ולא על ה-"+"', f && f.vis && f.onTop && !f.overPlus && f.x >= 0 && f.right <= f.vw, f);
  const hs = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  check('12 מסך צר: אין גלילה לרוחב', hs, null);
  await page.click('#safab'); await wait(page, 2500);
  const dl = await page.evaluate(() => { const r = document.getElementById('dlg').getBoundingClientRect(); return { l: r.left, r: r.right, vw: innerWidth }; });
  check('13 מסך צר: החלון נכנס ברוחב המסך', dl.l >= 0 && dl.r <= dl.vw, dl);
  await shot(page, '03-חלון-320');
  check('14 אין שגיאות JS (מסך צר)', page.__errors.length === 0, page.__errors);
  await ctx.close();

  // ---------- מנהל רגיל ----------
  const logM = []; ({ ctx, page } = await open('ma@x.co', logM, 'ma'));
  await page.evaluate(() => { NAV = [{ v: 'settings' }]; render(0); }); await wait(page, 3000);
  for (const v of ['home', 'exp']) { await page.evaluate((x) => { NAV = [{ v: x }]; render(0); }, v); await wait(page, 400); }
  const m1 = await page.evaluate(() => ({ fab: !!document.getElementById('safab'), sa: ADM.sa, old: !!document.querySelector('[data-v="sa"]') }));
  check('15 מנהל רגיל: הכפתור הצף לא קיים ב-DOM (וגם לא הכניסה מההגדרות)', !m1.fab && !m1.sa && !m1.old, m1);
  await shot(page, '04-מנהל-רגיל');
  // בכוח: מכריחים את הכפתור והחלון להופיע
  page.__step = 'force';
  const forced = await page.evaluate(async () => {
    ADM.sa = 1; saFab(); const b = !!document.getElementById('safab');
    await ACT.saFab(); await new Promise((r) => setTimeout(r, 3000));
    const txt = (document.getElementById('dlg').innerText || '').replace(/\s+/g, ' ');
    let sw = ''; try { await bzSwitch('home'); sw = 'switched'; } catch (e) { sw = e.message; }
    let lg = ''; try { await fnCall('logBusinessEntry', { bizId: 'home' }); lg = 'ok'; } catch (e) { lg = e.reason || e.message; }
    let ls = ''; try { await fsx('/b?pageSize=100', 0, 1); ls = 'ok'; } catch (e) { ls = String(e.code || e.message); }
    return { b, txt: txt.slice(0, 200), err: ADM.err, list: !!ADM.L, sw, lg, ls, biz: SY.bizId };
  });
  check('16 מנהל רגיל, בכוח: השרת חוסם – רשימת העסקים לא נטענת, logBusinessEntry נדחה (not-superadmin), המעבר נחסם והעסק לא השתנה', forced.b && !forced.list && forced.lg === 'not-superadmin' && forced.ls !== 'ok' && /רק מנהל־על/.test(forced.sw) && forced.biz === 'acme', forced);
  check('17 אין שגיאות JS (מנהל רגיל)', page.__errors.length === 0, page.__errors);
  await ctx.close();

  // ---------- עובד ----------
  ({ ctx, page } = await open('wk@x.co', [], 'wk'));
  await wait(page, 3000);
  const w1 = await page.evaluate(() => ({ fab: !!document.getElementById('safab'), role: SY.role }));
  check('18 עובד: הכפתור הצף לא קיים ב-DOM', !w1.fab && w1.role === 'worker', w1);
  const w2 = await page.evaluate(async () => { ADM.sa = 1; ADM.chk = 1; saFab(); return !!document.getElementById('safab'); });
  check('19 עובד, גם כש-ADM.sa מוכרח: הכפתור לא נוצר (רק למנהל)', !w2, w2);
  check('20 אין שגיאות JS (עובד)', page.__errors.length === 0, page.__errors);
  await ctx.close();

  await browser.close();
  fs.writeFileSync(outFile, JSON.stringify({ out }, null, 1));
  console.log(fail ? `תוצאה: נכשל (${fail})` : 'תוצאה: הכול עבר'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
