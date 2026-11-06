'use strict';
// ריבוי עסקים, שלב 6ג-2: תרחיש מקצה לקצה מול אמולטורים אמיתיים (Auth, Firestore, Storage, Functions) עם החוקים והפונקציות של הענף.
// מנהל־על פותח עסק ← מייל "קבע סיסמה" (קוד ה-oob נלקח מנקודת הקצה של אמולטור ה-Auth) ← המנהל קובע סיסמה ← מנהל־על מפעיל תוספת אחת
// ← המנהל נכנס ממחשב חדש (קישור כניסה במייל) ורואה רק את הבסיס ואת התוספת. בנוסף: עובד (בלי שלב נוסף), התנתקות בדפדפן מוחקת הכול,
// מחשב לא מוכר / תוקף שפג / אחרי התנתקות – שוב קישור, קישור בדפדפן אחר נדחה, והמתג של טביעת האצבע לא קיים בדפדפן.
// רץ בתוך emulators:exec. אין פנייה לאינטרנט, לא נשלח מייל אמיתי (אמולטור ה-Auth רק רושם את הקישורים).
// שימוש: node ui-e2e.js <www-dir> <out.json> [shots-dir]
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const FS = process.env.FIRESTORE_EMULATOR_HOST, AU = process.env.FIREBASE_AUTH_EMULATOR_HOST, ST = process.env.FIREBASE_STORAGE_EMULATOR_HOST, FN = process.env.FUNCTIONS_EMULATOR_HOST;
const port = (h) => +h.split(':')[1];
const P = 'demo-largpeami';
const sv = (v) => ({ stringValue: v });
const bv = (v) => ({ booleanValue: v });
const out = {}; let fail = 0;
const check = (name, ok, info) => { out[name] = { ok: !!ok, info }; if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 500) : '')); };
const DOCS = `http://${FS}/v1/projects/${P}/databases/(default)/documents/`;
async function put(p, fields) { const r = await fetch(DOCS + p, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) }); if (!r.ok) throw new Error('seed ' + p + ' ' + r.status); }
async function getDoc(p) { const r = await fetch(DOCS + p, { headers: { Authorization: 'Bearer owner' } }); if (r.status === 404) return null; return r.json(); }
async function signUp(email, pw) { const r = await fetch(`http://${AU}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pw || 'pw-123456', returnSecureToken: true }) }); const j = await r.json(); if (!j.localId) throw new Error('signUp ' + JSON.stringify(j)); return j.localId; }
async function signIn(email, pw) { const r = await fetch(`http://${AU}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pw, returnSecureToken: true }) }); const j = await r.json(); return { status: r.status, uid: j.localId || '', err: j.error && j.error.message }; }
async function oobCodes() { const r = await fetch(`http://${AU}/emulator/v1/projects/${P}/oobCodes`); return (await r.json()).oobCodes || []; }
const lastCode = async (email, type) => (await oobCodes()).filter((c) => c.email === email && c.requestType === type).pop();
async function resetPw(code, pw) { const r = await fetch(`http://${AU}/identitytoolkit.googleapis.com/v1/accounts:resetPassword?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ oobCode: code, newPassword: pw }) }); return r.status; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms) { const t = Date.now(); let v; while (Date.now() - t < (ms || 20000)) { v = await fn(); if (v) return v; await sleep(300); } return v; }
const oobReqs = (log, type) => log.filter((r) => /accounts:sendOobCode/.test(r.url) && JSON.parse(r.body || '{}').requestType === type).map((r) => JSON.parse(r.body));

(async () => {
  const [www, outFile, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const cfg = { fwd: { 8080: port(FS), 9099: port(AU), 9199: port(ST), 5001: port(FN) } };
  const browser = await H.launch();
  const shot = async (page, name, full) => { if (shots) await page.screenshot({ path: path.join(shots, name + '.png'), fullPage: !!full }); };
  const ctxOpen = async (log, label) => {
    const { ctx, page } = await H.newPage(browser, www, cfg, log, label);
    await page.setViewportSize({ width: 360, height: 740 });
    return { ctx, page };
  };
  const wait = (page, ms) => H.settle(page, ms || 1500);
  const dlgText = (page) => page.evaluate(() => { const d = document.getElementById('dlg'); return d && d.open ? d.innerText : ''; });
  const state = (page) => page.evaluate(() => ({ gate: !!document.getElementById('gate'), gerr: (document.getElementById('gerr') || {}).textContent || '', bizId: (typeof SY === 'object' && SY.bizId) || '', role: (typeof SY === 'object' && SY.role) || '', search: location.search, sync: (() => { try { return JSON.parse(localStorage.getItem('lp-sync')) || {}; } catch (e) { return {}; } })(), trust: localStorage.getItem('lp-trust'), elink: localStorage.getItem('lp-elink'), keys: Object.keys(localStorage).sort() }));
  const blank = (page) => page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden && ACT.startBlank) ACT.startBlank(); });

  // ---------- הכנת נתונים: מנהל־על (מנהל של עסק home) ----------
  await put('b/home', { name: sv('בית'), status: sv('active'), dataRoot: sv('b'), schemaVersion: { integerValue: '1' }, features: { mapValue: { fields: {} } } });
  const saUid = await signUp('sa@x.co');
  await put('users/' + saUid, { bizId: sv('home'), role: sv('admin'), active: bv(true), bizStatus: sv('active'), email: sv('sa@x.co') });
  await put('b/home/admins/' + saUid, { email: sv('sa@x.co') });
  await put('superadmins/' + saUid, {});
  const OWNER = 'owner-new@x.co', NEWPW = 'New-pass-789', WORKER = 'worker-new@x.co', WPW = 'Worker-pass-456';

  // ---------- 1. מנהל־על פותח עסק: מייל "קבע סיסמה" לכתובת שהשרת החזיר ----------
  const logSa = []; let { ctx, page } = await ctxOpen(logSa, 'sa');
  const createResp = [];
  page.on('response', async (r) => { if (/\/createBusiness$/.test(r.url())) { try { createResp.push(await r.json()); } catch (e) { /* */ } } });
  await H.login(page, 'sa@x.co'); await blank(page);
  await page.evaluate(() => { NAV = [{ v: 'settings' }]; render(0); }); await until(() => page.evaluate(() => ADM.sa === 1), 15000); // הכפתור מוצג אחרי בדיקה מול superadmins
  await page.evaluate(() => { NAV = [{ v: 'home' }, { v: 'sa' }]; render(0); }); await wait(page, 2000);
  await page.evaluate(() => ACT.admNew()); await wait(page, 400);
  await page.fill('#dlg input[name=id]', 'newco'); await page.fill('#dlg input[name=name]', 'עסק חדש'); await page.fill('#dlg input[name=email]', 'Owner-New@X.co'); await page.fill('#dlg input[name=phone]', '0501234567');
  page.__step = 'create';
  await page.click('#dlg form button:not([type=button])');
  const d1 = await until(async () => { const t = await dlgText(page); return /נשלח מייל|לא נשלח/.test(t) ? t : ''; }, 30000);
  await shot(page, '01-פתיחת-עסק-מייל-נשלח');
  const res1 = createResp[0] && createResp[0].result || {};
  const pr1 = oobReqs(logSa, 'PASSWORD_RESET');
  check('1 פתיחת עסק: תשובת השרת {ok,bizId,uid,email} בלבד, בלי קוד', JSON.stringify(Object.keys(res1).sort()) === JSON.stringify(['bizId', 'email', 'ok', 'uid']) && !/\b\d{6,8}\b/.test(JSON.stringify(res1).replace(res1.uid || '#', '')), res1);
  check('2 מייל "קבע סיסמה" (PASSWORD_RESET) נשלח מהאפליקציה לכתובת שהשרת החזיר (אותיות קטנות), לא לכתובת שהוקלדה', pr1.length === 1 && pr1[0].email === OWNER && res1.email === OWNER && /נשלח מייל לקביעת סיסמה ל-\s*owner-new@x\.co/.test(d1), { sent: pr1, dialog: d1 });
  const code1 = await lastCode(OWNER, 'PASSWORD_RESET');
  const before = await signIn(OWNER, 'pw-123456');
  check('3 לפני קביעת הסיסמה המנהל לא יכול להיכנס; באמולטור נרשם קישור "קבע סיסמה" אחד', !!code1 && before.status === 400 && (await oobCodes()).filter((c) => c.email === OWNER && c.requestType === 'PASSWORD_RESET').length === 1, { before, link: code1 && code1.oobLink && code1.oobLink.replace(/oobCode=[^&]+/, 'oobCode=…') });
  const st3 = await resetPw(code1.oobCode, NEWPW);
  const after = await signIn(OWNER, NEWPW);
  check('4 המנהל קובע סיסמה דרך הקישור (resetPassword) ואז הסיסמה עובדת', st3 === 200 && after.status === 200 && after.uid === res1.uid, { reset: st3, after });

  // ---------- 2. כרטיס העסק: "שלח מייל כניסה" לכתובת שבשרת, והפעלת תוספת אחת ----------
  await page.evaluate(() => closeDlg());
  await page.evaluate(() => { ADM.L = null; NAV = [{ v: 'home' }, { v: 'sa' }]; go('sab', 'newco'); });
  await until(() => page.evaluate(() => !!document.querySelector('[data-a=admMail]')), 15000);
  page.__step = 'card-mail';
  await page.click('[data-a=admMail]');
  const d2 = await until(async () => { const t = await dlgText(page); return /נשלח מייל/.test(t) ? t : ''; }, 15000);
  const pr2 = oobReqs(logSa.filter((r) => r.step === 'card-mail'), 'PASSWORD_RESET');
  check('5 "שלח מייל כניסה" בכרטיס העסק: נשלח למייל המנהל שנשמר בשרת', pr2.length === 1 && pr2[0].email === OWNER && /owner-new@x\.co/.test(d2), { sent: pr2, dialog: d2 });
  await page.evaluate(() => closeDlg()); await wait(page, 300);
  await shot(page, '02-כרטיס-עסק-שלח-מייל', true);
  page.__step = 'feat';
  await page.click('[data-a=admFeat][data-k=tasks]');
  const feat = await until(async () => { const d = await getDoc('b/newco'); const f = d && d.fields.features && d.fields.features.mapValue.fields || {}; return f.tasks && f.tasks.booleanValue === true ? Object.keys(f).filter((k) => f[k].booleanValue === true) : null; }, 15000);
  check('6 מנהל־על מפעיל תוספת אחת (tasks) דרך setBusinessFeatures', JSON.stringify(feat) === JSON.stringify(['tasks']), feat);
  const saErr = page.__errors.slice(); await ctx.close();

  // ---------- 3. המנהל נכנס ממחשב חדש: קישור כניסה במייל ----------
  const logM = []; ({ ctx, page } = await ctxOpen(logM, 'owner'));
  page.__step = 'login-new-pc';
  await H.login(page, OWNER, { trust: false, pw: NEWPW });
  let s = await state(page);
  const el1 = oobReqs(logM, 'EMAIL_SIGNIN');
  await shot(page, '03-מחשב-חדש-קישור-נשלח');
  check('7 מחשב חדש: אחרי סיסמה נכונה החיבור לא נשמר, ונשלח קישור כניסה (EMAIL_SIGNIN) למייל של החשבון', s.gate && /שלחנו קישור אישור/.test(s.gerr) && !s.sync.refresh && !s.sync.idToken && el1.length === 1 && el1[0].email === OWNER && el1[0].canHandleCodeInApp === true && /^http:\/\/127\.0\.0\.1:\d+\/(index\.html)?\?emu=1$/.test(el1[0].continueUrl) && JSON.parse(s.elink || '{}').uid === res1.uid, { gerr: s.gerr, sync: s.sync, sent: el1, elink: s.elink });
  const link1 = await lastCode(OWNER, 'EMAIL_SIGNIN');
  // קישור שנפתח בדפדפן אחר (אין lp-elink): לא נכנסים, והקישור לא נצרך
  {
    const lg = []; const o = await ctxOpen(lg, 'other-browser');
    await o.page.goto(H.ORIGIN + '/?emu=1&mode=signIn&oobCode=' + encodeURIComponent(link1.oobCode) + '&apiKey=fake&lang=he'); await wait(o.page, 2500);
    const so = await state(o.page);
    check('8 הקישור בדפדפן אחר: "פתחו את הקישור באותו מחשב", אין חיבור, הקוד נמחק משורת הכתובת, ולא נשלחה בקשת כניסה', so.gate && /באותו מחשב/.test(so.gerr) && !so.sync.refresh && so.search === '?emu=1' && !lg.some((r) => /signInWithEmailLink/.test(r.url)), { gerr: so.gerr, search: so.search });
    await o.ctx.close();
  }
  page.__step = 'link';
  await page.goto(H.ORIGIN + '/?emu=1&mode=signIn&oobCode=' + encodeURIComponent(link1.oobCode) + '&apiKey=fake&lang=he');
  await until(() => page.evaluate(() => !document.getElementById('gate') && typeof SY === 'object' && SY.bizId === 'newco').catch(() => false), 20000);
  await wait(page, 2500);
  s = await state(page);
  const tr = JSON.parse(s.trust || '{}');
  check('9 פתיחת הקישור באותו דפדפן: המנהל נכנס לעסק שלו, המחשב נרשם כמוכר ל-30 יום, והקוד לא נשאר בשורת הכתובת', !s.gate && s.bizId === 'newco' && s.role === 'admin' && !!s.sync.refresh && tr.uid === res1.uid && Math.abs(tr.exp - Date.now() - 30 * 864e5) < 120e3 && !s.elink && !/oobCode/.test(s.search), { bizId: s.bizId, role: s.role, trustDays: tr.exp && ((tr.exp - Date.now()) / 864e5).toFixed(2), search: s.search, elink: s.elink });
  await blank(page); await wait(page, 500);
  const dom = await page.evaluate(() => { const txt = () => document.getElementById('main').innerText; const r = {}; NAV = [{ v: 'more' }]; render(0); r.more = txt(); NAV = [{ v: 'home' }]; render(0); r.home = txt(); NAV = [{ v: 'settings' }]; render(0); r.settings = txt(); r.bio = !!document.querySelector('[data-a=bioTog]'); openAdd(); r.add = document.getElementById('sheet').innerText; sheetClose(); return r; });
  const must = ['משימות', 'הוצאות קבועות', 'הלוואות', 'כרטיסי אשראי', 'ייבוא מאקסל', 'גיבוי ושחזור', 'חשבוניות לתשלום', 'השוואות', 'הגדרות'];
  const gone = ['מחירים ומבצעים למדף', 'משוב לקוחות', 'בקשות לעדכון האפליקציה', 'סגירת קופה', 'סיכום סגירות קופה', 'העלאת אישור הפקדה', 'סריקת חשבוניות', 'הזמנות אתר'];
  check('10 המנהל החדש רואה רק את הבסיס ואת התוספת שהופעלה (משימות)', must.every((t) => dom.more.includes(t)) && gone.every((t) => !dom.more.includes(t)) && !/זיהוי חכם/.test(dom.settings) && /משימה חדשה/.test(dom.add) && !/מחירים ומבצעים|משוב לקוחות|סגירת קופה/.test(dom.add), { missing: must.filter((t) => !dom.more.includes(t)), present: gone.filter((t) => dom.more.includes(t)) });
  check('11 בדפדפן אין מתג "כניסה בטביעת אצבע" (אין תוסף ואין חומרה)', dom.bio === false && !/טביעת אצבע/.test(dom.settings), { bio: dom.bio });
  await page.evaluate(() => { NAV = [{ v: 'more' }]; render(0); }); await wait(page, 300);
  await shot(page, '04-מנהל-חדש-בסיס-ומשימות', true);

  // ---------- 4. עובד חדש: מייל "קבע סיסמה", ואז כניסה בלי שלב נוסף ----------
  page.__step = 'staff';
  await page.evaluate(() => go('staff')); await wait(page, 1500);
  await page.fill('form[data-f=admStaffAdd] input[name=name]', 'עובד חדש'); await page.fill('form[data-f=admStaffAdd] input[name=email]', WORKER);
  await page.evaluate(() => { window.__toasts = []; new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.classList && n.classList.contains('toast')) window.__toasts.push(n.textContent); }))).observe(document.body, { childList: true }); });
  await page.click('form[data-f=admStaffAdd] button');
  const d3 = await until(async () => { const t = (await page.evaluate(() => window.__toasts.join(' | '))) + (await dlgText(page)); return /נשלח מייל|לא נשלח/.test(t) ? t : ''; }, 30000);
  const pr3 = oobReqs(logM.filter((r) => r.step === 'staff'), 'PASSWORD_RESET');
  check('12 הוספת עובד: נשלח מייל "קבע סיסמה" לכתובת שהשרת החזיר, והודעה קצרה (שלא חוסמת את הרשימה) מציגה אותה', pr3.length === 1 && pr3[0].email === WORKER && /נשלח מייל לקביעת סיסמה ל-\s*worker-new@x\.co/.test(d3) && /^העובד נוסף\./.test(d3), { sent: pr3, toast: d3 });
  await shot(page, '05-עובד-נוסף-מייל-נשלח');
  const wcode = await lastCode(WORKER, 'PASSWORD_RESET');
  const wst = await resetPw(wcode.oobCode, WPW);
  {
    const lw = []; const o = await ctxOpen(lw, 'worker');
    await H.login(o.page, WORKER, { trust: false, pw: WPW }); await wait(o.page, 1500);
    const sw = await state(o.page);
    const bioW = await o.page.evaluate(() => !!document.querySelector('[data-a=bioTog]'));
    check('13 עובד חדש קובע סיסמה ונכנס ממחשב חדש בלי שלב נוסף (אין EMAIL_SIGNIN), ואין לו מתג טביעת אצבע', wst === 200 && !sw.gate && sw.role === 'worker' && sw.bizId === 'newco' && oobReqs(lw, 'EMAIL_SIGNIN').length === 0 && !sw.trust && !bioW, { role: sw.role, bizId: sw.bizId, gerr: sw.gerr, elinkReq: oobReqs(lw, 'EMAIL_SIGNIN').length });
    check('13א אין שגיאות JS אצל העובד', o.page.__errors.length === 0, o.page.__errors);
    await o.ctx.close();
  }

  // ---------- 5. התנתקות בדפדפן: גיבוי לפני, ומחיקת כל האחסון ----------
  await page.evaluate(() => { NAV = [{ v: 'home' }]; render(0); });
  await page.evaluate(async () => { const sb = S.subs.find((x) => (S.cats.find((c) => c.id === x.cat) || {}).kind === 'exp'); S.tx.push({ id: 'e2e1', t: 'exp', cat: sb.cat, sub: sb.id, date: today(), amt: 42, note: 'בדיקה', pays: [] }); save(); await fput('e2eFile', 'data:image/jpeg;base64,AAAA'); sessionStorage.setItem('e2e', '1'); });
  const keysBefore = await page.evaluate(async () => ({ ls: Object.keys(localStorage).sort(), ss: Object.keys(sessionStorage), idb: (await indexedDB.databases()).map((d) => d.name).sort() }));
  page.__step = 'logout';
  await page.evaluate(() => { NAV = [{ v: 'settings' }]; render(0); }); await wait(page, 500);
  await page.click('#main [data-a=syOut]'); await wait(page, 300);
  const askTxt = await dlgText(page);
  await Promise.all([page.waitForEvent('framenavigated', { timeout: 30000 }), page.click('#dlg [data-a=yes]')]);
  await wait(page, 3000);
  const keysAfter = await page.evaluate(async () => ({ ls: Object.keys(localStorage).sort(), ss: Object.keys(sessionStorage), idb: (await indexedDB.databases()).map((d) => d.name).sort(), gate: !!document.getElementById('gform') }));
  const bk = await (await fetch(`http://${ST}/v0/b/${P}/o?prefix=${encodeURIComponent('b/newco/app_backups/' + res1.uid + '/')}`, { headers: { Authorization: 'Bearer owner' } })).json().catch(() => ({}));
  check('14 התנתקות בדפדפן: הודעת אישור שמסבירה שהנתונים יימחקו מהמחשב', /יימחקו מהמחשב/.test(askTxt), askTxt);
  check('15 לפני המחיקה נשמר גיבוי מוצפן בענן (היו שינויים שלא גובו)', (bk.items || []).length >= 1 && logM.some((r) => r.step === 'logout' && /getBackupKey/.test(r.url)), { items: (bk.items || []).map((x) => x.name), bucketQueryError: bk.error && bk.error.message });
  check('16 אחרי ההתנתקות לא נשאר כלום במחשב: localStorage, sessionStorage ו-IndexedDB של האפליקציה (רשימה לפני ואחרי)', keysBefore.ls.length > 3 && keysBefore.ls.includes('lp-trust') && keysBefore.ls.includes('newco:large-pami-v2') && keysBefore.idb.some((n) => /^lp-files/.test(n)) && keysAfter.ls.length === 0 && keysAfter.ss.length === 0 && !keysAfter.idb.some((n) => /^lp-files|firebaseLocalStorageDb/.test(n)) && keysAfter.gate, { before: keysBefore, after: keysAfter });
  await shot(page, '06-אחרי-התנתקות');

  // ---------- 6. אחרי התנתקות, ובתוקף שפג: שוב נדרש קישור ----------
  const nEl = oobReqs(logM, 'EMAIL_SIGNIN').length;
  await H.login(page, OWNER, { trust: false, pw: NEWPW });
  s = await state(page);
  check('17 אחרי התנתקות: כניסה עם סיסמה דורשת שוב קישור במייל', s.gate && /שלחנו קישור אישור/.test(s.gerr) && !s.sync.refresh && oobReqs(logM, 'EMAIL_SIGNIN').length === nEl + 1, { gerr: s.gerr });
  {
    const lg = []; const o = await ctxOpen(lg, 'expired');
    await o.page.goto(H.ORIGIN + '/?emu=1'); await o.page.waitForSelector('#gform');
    await o.page.evaluate((u) => localStorage.setItem('lp-trust', JSON.stringify({ uid: u, exp: Date.now() - 1000 })), res1.uid);
    await H.login(o.page, OWNER, { trust: false, pw: NEWPW });
    const se = await state(o.page);
    check('18 מחשב שהיה מוכר ותוקפו (30 יום) פג: שוב נדרש קישור', se.gate && /שלחנו קישור אישור/.test(se.gerr) && !se.sync.refresh && oobReqs(lg, 'EMAIL_SIGNIN').length === 1, { gerr: se.gerr });
    await o.ctx.close();
  }
  {
    const lg = []; const o = await ctxOpen(lg, 'sa-new-pc');
    await H.login(o.page, 'sa@x.co', { trust: false });
    const ss = await state(o.page);
    check('19 גם מנהל־על במחשב חדש צריך קישור במייל', ss.gate && /שלחנו קישור אישור/.test(ss.gerr) && oobReqs(lg, 'EMAIL_SIGNIN').length === 1 && oobReqs(lg, 'EMAIL_SIGNIN')[0].email === 'sa@x.co', { gerr: ss.gerr });
    await o.ctx.close();
  }
  // "שכחתי סיסמה": הודעה אחידה למייל קיים ולמייל שלא קיים
  {
    const lg = []; const o = await ctxOpen(lg, 'forgot');
    await o.page.goto(H.ORIGIN + '/?emu=1'); await o.page.waitForSelector('#gform');
    const msgs = [];
    for (const em of [OWNER, 'nobody@x.co']) { await o.page.fill('#gform input[name=email]', em); await o.page.evaluate(() => { document.getElementById('gfgt').disabled = false; }); await o.page.click('#gfgt'); await wait(o.page, 1500); msgs.push(await o.page.evaluate(() => document.getElementById('gerr').textContent)); }
    await shot(o.page, '07-מסך-כניסה-שכחתי-סיסמה');
    check('20 "שכחתי סיסמה / קביעת סיסמה" במסך הכניסה: אותה הודעה למייל קיים ולמייל שלא קיים (לא חושף חשבונות)', msgs.length === 2 && msgs[0] === msgs[1] && /אם המייל רשום/.test(msgs[0]) && oobReqs(lg, 'PASSWORD_RESET').length === 2, msgs);
    check('20א אין שגיאות JS במסך הכניסה', o.page.__errors.length === 0, o.page.__errors);
    await o.ctx.close();
  }
  check('21 אין שגיאות JS אצל מנהל־על ואצל המנהל החדש', saErr.length === 0 && page.__errors.length === 0, { sa: saErr, owner: page.__errors });
  await ctx.close();
  await browser.close();
  fs.writeFileSync(outFile, JSON.stringify({ out, requests: { sa: logSa.length, owner: logM.length } }, null, 1));
  console.log(fail ? `תוצאה: נכשל (${fail})` : 'תוצאה: הכול עבר'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
