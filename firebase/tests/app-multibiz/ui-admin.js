'use strict';
// ריבוי עסקים, שלב 6א: מסכי ניהול (מנהל־על ועובדים) מול אמולטורים אמיתיים (Auth, Firestore, Storage, Functions) עם החוקים והפונקציות של הענף.
// רץ בתוך emulators:exec. האפליקציה רצה בדפדפן (www/), וכל בקשה שלה מועברת לאמולטור. אין פנייה לאינטרנט ולפרויקט אמיתי.
// שימוש: node ui-admin.js <www-dir> <out.json> [shots-dir]
// משתני סביבה: FIRESTORE_EMULATOR_HOST, FIREBASE_AUTH_EMULATOR_HOST, FIREBASE_STORAGE_EMULATOR_HOST, FUNCTIONS_EMULATOR_HOST
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
async function put(p, fields) { // כתיבה עוקפת חוקים (owner) – רק להכנת הנתונים
  const r = await fetch(DOCS + p, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) });
  if (!r.ok) throw new Error('seed ' + p + ' ' + r.status + ' ' + await r.text());
}
async function getDoc(p) { // קריאה עוקפת חוקים, מוחזר אובייקט שטוח (שדות פשוטים בלבד) או null
  const r = await fetch(DOCS + p, { headers: { Authorization: 'Bearer owner' } }); if (r.status === 404) return null; const j = await r.json();
  const flat = (v) => v.stringValue !== undefined ? v.stringValue : v.booleanValue !== undefined ? v.booleanValue : v.integerValue !== undefined ? +v.integerValue : v.mapValue ? Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, flat(x)])) : null;
  return Object.fromEntries(Object.entries(j.fields || {}).map(([k, v]) => [k, flat(v)]));
}
async function listIds(p) { const r = await fetch(DOCS + p + '?pageSize=300', { headers: { Authorization: 'Bearer owner' } }); const j = await r.json(); return (j.documents || []).map((d) => d.name.split('/').pop()); }
async function audit(biz) { const out = []; for (const id of await listIds(`b/${biz}/audit`)) { const d = await getDoc(`b/${biz}/audit/${id}`); out.push(d); } return out.sort((a, b) => a.t - b.t); }
async function signUp(email) {
  const r = await fetch(`http://${AU}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'pw-123456', returnSecureToken: true }) });
  const j = await r.json(); if (!j.localId) throw new Error('signUp ' + JSON.stringify(j)); return j.localId;
}
const ft = (o) => ({ mapValue: { fields: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, bv(v)])) } });
async function seedBiz(id, extra) {
  await put('b/' + id, Object.assign({ name: sv('עסק ' + id), status: sv('active'), dataRoot: sv('b'), schemaVersion: { integerValue: '1' }, features: ft({}), brand: { mapValue: { fields: { name: sv('עסק ' + id), logoPath: sv(''), base: sv('dark-gold'), colors: { mapValue: { fields: {} } } } } } }, extra));
}
async function seedMember(biz, email, role) { // role: admin | worker
  const uid = await signUp(email);
  await put('users/' + uid, { bizId: sv(biz), role: sv(role), active: bv(true), bizStatus: sv('active'), email: sv(email) });
  if (role === 'admin') await put(`b/${biz}/admins/${uid}`, { email: sv(email) });
  else await put(`b/${biz}/staff/${uid}`, { active: bv(true), email: sv(email), name: sv(email.split('@')[0]), role: sv('employee') });
  return uid;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const [www, outFile, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const cfg = { fwd: { 8080: port(FS), 9099: port(AU), 9199: port(ST), 5001: port(FN) } };
  const browser = await H.launch();
  const shot = async (page, name, full) => { if (shots) await page.screenshot({ path: path.join(shots, name + '.png'), fullPage: !!full }); };
  const open = async (email, log, label) => {
    const { ctx, page } = await H.newPage(browser, www, cfg, log, label);
    await page.setViewportSize({ width: 360, height: 740 });
    await page.addInitScript(() => { window.__toasts = []; new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.classList && n.classList.contains('toast')) window.__toasts.push(n.textContent); }))).observe(document, { childList: true, subtree: true }); });
    await H.login(page, email);
    await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden && ACT.startBlank) ACT.startBlank(); }); // מסך "ברוך הבא" של מכשיר חדש
    return { ctx, page };
  };
  const toasts = (page) => page.evaluate(() => window.__toasts.slice());
  const wait = (page, ms) => H.settle(page, ms || 1500);
  const settingsOf = async (page) => { await page.evaluate(() => { NAV = [{ v: 'settings' }]; render(0); }); await wait(page, 1800); };

  // ---------- הכנת נתונים ----------
  await seedBiz('home', {});
  const saUid = await seedMember('home', 'sa@x.co', 'admin');
  await put('superadmins/' + saUid, {});
  await seedBiz('acme', {});
  await seedMember('acme', 'ma@x.co', 'admin');
  await seedBiz(BZ0, { dataRoot: sv('legacy'), name: sv('לארג׳ פעמי'), features: ft({ scan: true, shelf: true, feedback: true, tasks: true, suppliers: true, requests: true, cashClose: true, yemot: true, orders: true }) });
  const mUid = await signUp('mroot@x.co'); await put('admins/' + mUid, { email: sv('mroot@x.co') }); // מנהל לארג' פעמי בשורש (legacy), בלי מסמך users

  // ---------- מנהל־על ----------
  const log = []; let { ctx, page } = await open('sa@x.co', log, 'sa');
  await shot(page, '00-כניסה-מנהל-על');
  await settingsOf(page);
  let st = await page.evaluate(() => ({ btn: !!document.querySelector('[data-v="sa"]'), staffBtn: !!document.querySelector('[data-v="staff"]'), sa: SY.sa }));
  check('1 מנהל־על: כפתור "עסקים (מנהל־על)" מוצג בהגדרות אחרי בדיקה מול superadmins', st.btn && st.sa === 1, st);
  await shot(page, '01-הגדרות-מנהל-על', true);

  // רשימת עסקים
  page.__step = 'list';
  await page.evaluate(() => go('sa')); await wait(page, 2000);
  let rows = await page.evaluate(() => [...document.querySelectorAll('#admL .li')].map((r) => r.querySelector('b').textContent + ' | ' + r.querySelector('small').textContent));
  const listReq = log.filter((r) => r.step === 'list' && r.method === 'GET' && /\/documents\/b\?/.test(r.url));
  check('2 רשימת העסקים נקראת מהשורש b/ ולא מתוך העסק הנוכחי', listReq.length >= 1 && listReq.every((r) => r.status === 200) && !log.some((r) => r.step === 'list' && /\/documents\/b\/home\/(?!private)/.test(r.url) && /pageSize=100/.test(r.url)), { url: decodeURIComponent(listReq[0] && listReq[0].url).replace(/^.*\/documents/, '/documents'), status: listReq[0] && listReq[0].status, rows });
  check('3 לכל עסק ברשימה: שם, מזהה, סטטוס ומספר תוספות', rows.length === 3 && rows.some((r) => r.startsWith('עסק acme | acme · 0 תוספות מופעלות')) && rows.some((r) => r.includes(BZ0 + ' · מצב קיים')), rows);
  await shot(page, '02-רשימת-עסקים');
  await page.fill('[data-i=admQ]', 'acm');
  const vis = await page.evaluate(() => [...document.querySelectorAll('#admL .li')].filter((r) => !r.hidden).length);
  check('4 חיפוש לפי שם מסנן את הרשימה', vis === 1, { visible: vis });

  // פתיחת עסק
  await page.evaluate(() => ACT.admNew()); await wait(page, 500);
  await shot(page, '03-פתיחת-עסק');
  await page.fill('#dlg input[name=id]', 'Bad_ID');
  await page.fill('#dlg input[name=name]', 'חנות הדגל'); await page.fill('#dlg input[name=email]', 'owner-flag@x.co'); await page.fill('#dlg input[name=phone]', '0501234567');
  const patOk = await page.evaluate(() => document.querySelector('#dlg input[name=id]').checkValidity());
  await page.fill('#dlg input[name=id]', 'flagship');
  page.__step = 'create';
  await page.click('#dlg form button:not([type=button])'); await wait(page, 2500);
  // מייל עצמי: לפני מייל Firebase יש קריאה ל-sendInviteMail (באמולטור – fallback, לפעמים עם הפעלה ראשונה איטית). ממתינים לחלון התוצאה, לא לזמן קבוע
  await page.waitForFunction(() => { const d = document.querySelector('#dlg'); return d && d.open && /טרם נשלח|נשלח מייל|לא נשלח|לא התקבלה/.test(d.innerText); }, null, { timeout: 15000 }).catch(() => {});
  const flag = await getDoc('b/flagship'), flagInfo = await getDoc('b/flagship/private/info');
  const ca = (await audit('flagship')).map((a) => a.act);
  const t1 = await toasts(page);
  check('5 פתיחת עסק: createBusiness נקרא, העסק נוצר (פעיל, בלי תוספות) ויש audit', patOk === false && flag && flag.status === 'active' && flag.name === 'חנות הדגל' && flagInfo.ownerEmail === 'owner-flag@x.co' && ca.includes('createBusiness') && t1.includes('העסק נפתח'), { pattern: patOk, flag: flag && { status: flag.status, name: flag.name }, ownerEmail: flagInfo && flagInfo.ownerEmail, audit: ca, toasts: t1 });
  const body5 = log.filter((r) => r.step === 'create' && /createBusiness/.test(r.url)); const resp5 = await page.evaluate(() => document.body.innerText);
  check('6 אחרי פתיחה לא מוצגים devCode, mail או expiresInMin', body5.length === 1 && !/devCode|expiresInMin|\bmail\b/.test(resp5) && !/devCode|expiresInMin/.test(fs.readFileSync(www + '/index.html', 'utf8').split('/* ===== ריבוי עסקים, שלב 6א')[1] || ''), { requests: body5.length });
  // עדכון חוזה 14: מיד אחרי הפתיחה מוצע מסך המיתוג (לפני שהמנהל נכנס)
  const offer = await page.evaluate(() => { const b = document.querySelector('#dlg[open] [data-a=admBrNow]'); return b ? b.dataset.id : null; });
  if (offer) await page.click('#dlg [data-a=admBrNow]'); await wait(page, 2000);
  const brNow = await page.evaluate(() => ({ v: cur().v, a: cur().a, dlg: document.querySelector('#dlg').open, form: !!document.querySelector('form[data-f=brSave]'), sub: document.querySelector('#main').innerText.slice(0, 120) }));
  check('6א אחרי "פתיחת עסק" מוצע מיד "למיתוג העסק"; הלחיצה פותחת את מסך המיתוג של העסק החדש', offer === 'flagship' && brNow.v === 'brand' && brNow.a === 'flagship' && !brNow.dlg && brNow.form, { offer, brNow });
  // שגיאה בעברית: מזהה קיים
  await page.evaluate(() => ACT.admNew()); await wait(page, 300);
  await page.fill('#dlg input[name=id]', 'flagship'); await page.fill('#dlg input[name=name]', 'כפול'); await page.fill('#dlg input[name=email]', 'dup@x.co'); await page.fill('#dlg input[name=phone]', '0501234567');
  await page.click('#dlg form button:not([type=button])'); await wait(page, 1500);
  const t2 = await toasts(page);
  check('7 פתיחת עסק עם מזהה קיים: הודעה בעברית, בלי קוד שגיאה גולמי', t2.includes('כבר יש עסק עם המזהה הזה'), t2.slice(-2));
  await page.evaluate(() => closeDlg());

  // כרטיס עסק
  await page.evaluate(() => { NAV = [{ v: 'home' }, { v: 'sa' }]; go('sab', 'flagship'); }); await wait(page, 2200);
  await shot(page, '04-כרטיס-עסק', true);
  const card = await page.evaluate(() => document.body.innerText);
  const brBtn = await page.evaluate(() => { const b = document.querySelector('[data-a=go][data-v=brand]'); return b ? b.dataset.arg : null; });
  check('8א כרטיס עסק (מנהל־על): כפתור "מיתוג" שפותח את המיתוג של העסק הזה', brBtn === 'flagship', brBtn);
  check('8 כרטיס עסק: פרטי קשר (קריאה בלבד) מתוך private/info', /owner-flag@x\.co/.test(card) && /0501234567|\+972501234567|972501234567/.test(card.replace(/[-\s]/g, '')) , { card: card.slice(0, 200) });

  // תוספת
  page.__step = 'feat';
  await page.click('[data-a=admFeat][data-k=tasks]'); await wait(page, 2000);
  const f1 = await getDoc('b/flagship');
  const chip = await page.evaluate(() => document.querySelector('[data-a=admFeat][data-k=tasks]').textContent);
  const aud2 = (await audit('flagship')).filter((a) => a.act === 'setBusinessFeatures');
  check('9 הפעלת תוספת אחת (tasks) דרך setBusinessFeatures: המסך מתעדכן אחרי ok, ויש audit', f1.features.tasks === true && chip === 'פעיל' && aud2.length === 1 && aud2[0].note === 'tasks=on', { features: f1.features, chip, audit: aud2.map((a) => a.act + ':' + a.note) });
  // סריקה אחידה, שלב 2: עסק חדש נוצר עם scan דלוק – ולכן scan נשאר true
  check('10 תוספות אחרות לא השתנו', Object.entries(f1.features).every(([k, v]) => k === 'tasks' || k === 'scan' ? v === true : v !== true), f1.features);
  const featReq = log.filter((r) => r.step === 'feat' && /setBusinessFeatures/.test(r.url) && r.method === 'POST');
  check('11 לחיצה אחת = בקשה אחת (הכפתור נוטרל עד תשובה)', featReq.length === 1, { requests: featReq.length });
  await shot(page, '05-תוספות-מופעלות', true);

  // השהיה ושחרור
  page.__step = 'suspend';
  await page.click('[data-a=admSus]'); await wait(page, 400);
  const confirmTxt = await page.evaluate(() => document.querySelector('#dlg').innerText);
  await shot(page, '06-אישור-השהיה');
  const preSus = await getDoc('b/flagship');
  await page.click('#dlg [data-a=yes]'); await wait(page, 2500);
  const sus = await getDoc('b/flagship');
  check('12 השהיה: חלון אישור מסביר, ורק אחריו setBusinessStatus (suspended) + audit', /העובדים והמנהל לא ייגשו לנתונים/.test(confirmTxt) && /שום דבר לא נמחק/.test(confirmTxt) && preSus.status === 'active' && sus.status === 'suspended' && (await audit('flagship')).some((a) => a.act === 'setBusinessStatus' && a.note === 'suspended'), { confirmTxt, before: preSus.status, after: sus.status });
  await page.click('[data-a=admSus]'); await wait(page, 300); await page.click('#dlg [data-a=yes]'); await wait(page, 2500);
  const act = await getDoc('b/flagship'); const au3 = (await audit('flagship')).filter((a) => a.act === 'setBusinessStatus').map((a) => a.note);
  check('13 שחרור מהשהיה: הסטטוס חוזר ל-active ויש audit', act.status === 'active' && au3.join() === 'suspended,active', { status: act.status, audit: au3 });

  // הגדרות מתקדמות
  page.__step = 'adv';
  await page.fill('form[data-f=admAdv] input[name=scanDaily]', '7'); await page.fill('form[data-f=admAdv] input[name=scanPerUserDaily]', '3'); await page.fill('form[data-f=admAdv] input[name=yphone]', '035551234'); await page.fill('form[data-f=admAdv] input[name=ylabel]', 'קו בדיקה');
  await page.click('form[data-f=admAdv] button'); await wait(page, 2000);
  const info = await getDoc('b/flagship/private/info');
  check('14 שינוי adv דרך setBusinessAdv: מכסות ושדות ימות נשמרו, ויש audit', info.adv && info.adv.limits.scanDaily === 7 && info.adv.limits.scanPerUserDaily === 3 && info.adv.yemot.label === 'קו בדיקה' && (await audit('flagship')).some((a) => a.act === 'setBusinessAdv'), info.adv);
  const nAdv = () => log.filter((r) => r.step === 'adv' && /setBusinessAdv/.test(r.url)).length, n0 = nAdv();
  await page.fill('form[data-f=admAdv] input[name=scanDaily]', '20000'); await page.click('form[data-f=admAdv] button'); await wait(page, 600);
  const t3 = await toasts(page);
  await page.fill('form[data-f=admAdv] input[name=scanDaily]', '-5'); await page.click('form[data-f=admAdv] button'); await wait(page, 600);
  check('15 מכסה לא חוקית (מעל התקרה או שלילית) נחסמת בלקוח: הודעה בעברית או חסימת הטופס, בלי בקשה לשרת, והערך בשרת לא השתנה', t3.includes('מכסה: מספר שלם בין 0 ל-10000') && nAdv() === n0 && (await getDoc('b/flagship/private/info')).adv.limits.scanDaily === 7, { toast: t3.slice(-1), newRequests: nAdv() - n0 });
  await page.fill('form[data-f=admAdv] input[name=scanDaily]', '7');
  await shot(page, '07-הגדרות-מתקדמות', true);

  // אסימון ימות
  page.__step = 'token';
  await page.click('[data-a=admTok]'); await wait(page, 300); await page.click('#dlg [data-a=yes]'); await wait(page, 2000);
  const tokTxt = await page.evaluate(() => (document.getElementById('admTok') || {}).textContent || '');
  const dlgTxt = await page.evaluate(() => document.querySelector('#dlg').innerText);
  await shot(page, '08-אסימון-ימות');
  const inStore = await page.evaluate((t) => Object.keys(localStorage).some((k) => (localStorage.getItem(k) || '').includes(t)), tokTxt);
  const yInfo = await getDoc('b/flagship/private/yemot');
  await page.click('#dlg [data-a=admTokDone]'); await wait(page, 300);
  const afterClose = await page.evaluate(() => ({ html: document.querySelector('#dlg').innerHTML, body: document.body.innerText.includes('flagship.') }));
  check('16 אסימון ימות: מוצג פעם אחת עם אזהרה, לא נשמר במכשיר, נמחק מהמסך בסגירה, נשמר בשרת רק כגיבוב', tokTxt.startsWith('flagship.') && /פעם אחת בלבד/.test(dlgTxt) && !inStore && afterClose.html === '' && !afterClose.body && yInfo && yInfo.tokenHash && !JSON.stringify(yInfo).includes(tokTxt) && (await audit('flagship')).some((a) => a.act === 'setYemotToken'), { len: tokTxt.length, inStore, afterClose: afterClose.html.length, hasHash: !!(yInfo && yInfo.tokenHash) });

  // כניסה כמנהל – כשהרישום נכשל לא נכנסים
  page.__step = 'enter-fail';
  const before = (await audit('flagship')).filter((a) => a.act === 'superadminEnter').length;
  await ctx.route('**/logBusinessEntry', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { status: 'UNAVAILABLE', message: 'x' } }) }));
  await page.click('[data-a=admEnter]'); await wait(page, 2000);
  const t4 = await toasts(page);
  const stF = await page.evaluate(() => ({ bizId: SY.bizId, sync: JSON.parse(localStorage.getItem('lp-sync')).bizId, gen: 0 }));
  check('17 "כניסה כמנהל": אם הרישום ביומן נכשל – לא נכנסים (העסק לא השתנה, יש הודעה)', stF.bizId === 'home' && stF.sync === 'home' && t4.some((x) => /לא נרשמה ולכן לא נכנסנו/.test(x)) && (await audit('flagship')).filter((a) => a.act === 'superadminEnter').length === before, { st: stF, toast: t4.slice(-1) });
  await ctx.unroute('**/logBusinessEntry');
  // והצלחה: audit לפני המעבר
  page.__step = 'enter';
  const gen0 = page.__gen;
  await page.click('[data-a=admEnter]'); await page.waitForFunction((g) => true, gen0); await wait(page, 4000);
  const audE = (await audit('flagship')).filter((a) => a.act === 'superadminEnter');
  const iLog = log.findIndex((r) => r.step === 'enter' && /logBusinessEntry/.test(r.url)), iAfter = log.findIndex((r, i) => i > iLog && r.step === 'enter' && /\/documents\/b\/flagship/.test(r.url));
  const stE = await page.evaluate(() => ({ bizId: SY.bizId, role: SY.role, sa: SY.sa, BZP }));
  check('18 "כניסה כמנהל": נרשם audit superadminEnter לפני המעבר, ואז המסך נטען בתוך העסק כמנהל', audE.length === before + 1 && audE[audE.length - 1].by === saUid && iLog >= 0 && (iAfter < 0 || iLog < iAfter) && stE.bizId === 'flagship' && stE.role === 'admin' && stE.BZP === 'flagship:', { audit: audE.length, order: { logBusinessEntry: iLog, firstAccessInBiz: iAfter }, state: stE });

  // מסך עובדים (מנהל־על בתוך העסק)
  await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden && ACT.startBlank) ACT.startBlank(); }); // עסק חדש = מכשיר בלי נתונים: מסך "ברוך הבא" הקיים
  await settingsOf(page);
  st = await page.evaluate(() => ({ sa: !!document.querySelector('[data-v="sa"]'), staff: !!document.querySelector('[data-v="staff"]') }));
  check('19 בתוך עסק b: כפתור "עובדים" מוצג (וגם כפתור מנהל־על, כי זה מנהל־על)', st.sa && st.staff, st);
  page.__step = 'staff';
  await page.evaluate(() => go('staff')); await wait(page, 1800);
  await page.fill('form[data-f=admStaffAdd] input[name=name]', 'דנה עובדת'); await page.fill('form[data-f=admStaffAdd] input[name=email]', 'dana@x.co');
  await page.click('form[data-f=admStaffAdd] button'); await wait(page, 2500);
  const sids = await listIds('b/flagship/staff'); let dana = null, danaUid = '';
  for (const id of sids) { const d = await getDoc('b/flagship/staff/' + id); if (d && d.email === 'dana@x.co') { dana = d; danaUid = id; } }
  const lst = await page.evaluate(() => [...document.querySelectorAll('#main .li')].map((r) => r.innerText.replace(/\s+/g, ' ')));
  check('20 הוספת עובד דרך addStaff: נוצר staff פעיל בעסק, מופיע ברשימה, ויש audit', dana && dana.active === true && lst.some((x) => x.includes('דנה עובדת') && x.includes('פעיל')) && (await audit('flagship')).some((a) => a.act === 'addStaff'), { dana, list: lst });
  await shot(page, '09-עובדים', true);
  page.__step = 'staff-off';
  await page.click(`[data-a=admStf][data-uid="${danaUid}"]`); await wait(page, 300); await page.click('#dlg [data-a=yes]'); await wait(page, 2200);
  const dana2 = await getDoc('b/flagship/staff/' + danaUid), du = await getDoc('users/' + danaUid);
  const lst2 = await page.evaluate(() => [...document.querySelectorAll('#main .li')].map((r) => r.innerText.replace(/\s+/g, ' ')));
  check('21 השבתת עובד דרך setStaffActive: staff.active=false, users.active=false, המסך מתעדכן', dana2.active === false && du.active === false && lst2.some((x) => x.includes('דנה עובדת') && x.includes('מושבת')), { staff: dana2.active, users: du.active, list: lst2 });
  await page.click(`[data-a=admStf][data-uid="${danaUid}"]`); await wait(page, 300); await page.click('#dlg [data-a=yes]'); await wait(page, 2200);
  check('22 החזרת עובד', (await getDoc('b/flagship/staff/' + danaUid)).active === true, null);
  // 7: דרגות ומתגים (מנהל־על בלבד) – דרך המסך
  page.__step = 'ranks';
  await page.click('[data-a=admRank][data-id=""]'); await wait(page, 400);
  await page.fill('#dlg form[data-f=admRankSave] input[name=name]', 'קופאית');
  await page.evaluate(() => { const f = document.querySelector('#dlg form[data-f=admRankSave]'); PMK.forEach(([k]) => { const c = f.querySelector('[name=p_' + k + ']'); if (k === 'expR') c.value = 'all'; else c.checked = k === 'incW'; }); }); // 6ו: expR = בחירה משלוש
  await page.click('#dlg form[data-f=admRankSave] button:not([type=button])'); await wait(page, 2500);
  const rInfo = await getDoc('b/flagship/private/info');
  const rkAud = (await audit('flagship')).filter((a) => a.act === 'setBusinessRanks');
  const rkUi = await page.evaluate(() => document.querySelector('#main').innerText.includes('קופאית'));
  check('22א דרגה חדשה מהמסך: נשמרה ב-private/info דרך setBusinessRanks, עם audit, ומוצגת ברשימת הדרגות', rkUi && rkAud.length === 1 && rkAud[0].by === saUid && log.some((r) => r.step === 'ranks' && /setBusinessRanks/.test(r.url)), { rInfo, audit: rkAud.length, ui: rkUi });
  page.__step = 'perms';
  await page.click(`[data-a=admPerm][data-uid="${danaUid}"]`); await wait(page, 400);
  const dlg0 = await page.evaluate(() => ({ boxes: document.querySelectorAll('#dlg form[data-f=admPermSave] input[type=checkbox]').length, note: /עוד לא נקבעו מתגים/.test(document.getElementById('dlg').innerText), exp: (document.querySelector('#dlg select[name=p_expR]') || {}).value, on: [...document.querySelectorAll('#dlg input[type=checkbox]:checked')].map((c) => c.name).sort() }));
  check('22ב חלון "הרשאות" לעובד בלי מתגים: 11 מתגים (כולל "רואה מצב העסק", "רווחיות הזמנות" ו"עדכון מחירים ומלאי" – כבוי) ובחירת "רואה הוצאות" (6ו), מסומנת ברירת המחדל של היום (incW, expR=הכול, expW, sup, ord) והערה', dlg0.boxes === 11 && dlg0.exp === 'all' && dlg0.note && dlg0.on.join() === 'p_expW,p_incW,p_ord,p_sup', dlg0);
  const rid = await page.evaluate(() => ADM.ranks[0].id);
  await page.selectOption('#dlg select[name=rank]', rid); await wait(page, 200);
  await page.evaluate(() => { document.querySelector('#dlg [name=p_trf]').checked = true; });
  const dlg1 = await page.evaluate(() => [...document.querySelectorAll('#dlg input[type=checkbox]:checked')].map((c) => c.name).concat(document.querySelector('#dlg select[name=p_expR]').value === 'all' ? ['p_expR'] : []).sort());
  await page.click('#dlg form[data-f=admPermSave] button:not([type=button])'); await wait(page, 2500);
  const danaP = await getDoc('b/flagship/staff/' + danaUid);
  const pAud = (await audit('flagship')).filter((a) => a.act === 'setStaffPerms');
  check('22ג בחירת דרגה ממלאת את המתגים, ושינוי מתג נוסף (trf) נשמר לעובד דרך setStaffPerms עם audit', dlg1.join() === 'p_expR,p_incW,p_trf' && danaP.rank === rid && danaP.perms && danaP.perms.trf === true && danaP.perms.incW === true && danaP.perms.expW === false && pAud.length === 1, { checked: dlg1, rank: danaP.rank, perms: danaP.perms, audit: pAud.length });
  await shot(page, '09א-הרשאות-עובד', true);
  check('23 לא נכתבה בקשה ישירה ל-Firestore למסמך העסק, ל-users, ל-staff או ל-admins (הכול דרך פונקציות)', !log.some((r) => r.method !== 'GET' && /\/documents\/(users\/|b\/[^/:?]+(\?|$)|b\/[^/]+\/(staff|admins|private)\/)/.test(r.url)), { writes: log.filter((r) => r.method !== 'GET' && r.url.includes(':8080')).map((r) => r.method + ' ' + decodeURIComponent(r.url).replace(/^.*documents/, '')).slice(0, 6) });
  check('24 אין שגיאות JS אצל מנהל־על', page.__errors.length === 0, page.__errors);
  const sErr = page.__errors.slice();
  await ctx.close();

  // ---------- מנהל עסק רגיל (לא מנהל־על) ----------
  const log2 = []; ({ ctx, page } = await open('ma@x.co', log2, 'ma'));
  await settingsOf(page);
  st = await page.evaluate(() => ({ sa: !!document.querySelector('[data-v="sa"]'), saText: document.body.innerText.includes('מנהל־על'), staff: !!document.querySelector('[data-v="staff"]'), SYsa: SY.sa, html: document.documentElement.outerHTML.includes('data-v="sa"') }));
  check('25 מנהל עסק רגיל: כפתור "מנהל־על" לא קיים ב-DOM (לא רק מוסתר); כפתור "עובדים" כן', !st.sa && !st.saText && !st.html && st.staff && !st.SYsa, st);
  await shot(page, '10-הגדרות-מנהל-עסק');
  // כופים את הכפתור להופיע – השרת והחוקים דוחים
  page.__step = 'forced';
  const forced = await page.evaluate(async () => {
    const r = {}; ADM.sa = 1; ADM.L = null; go('sa'); await new Promise((x) => setTimeout(x, 2000)); r.listErr = ADM.err; r.rows = (ADM.L || []).length;
    for (const [n, d] of [['createBusiness', { bizId: 'evil', name: 'x', ownerEmail: 'e@x.co', ownerPhone: '0501234567' }], ['setBusinessStatus', { bizId: 'acme', status: 'suspended' }], ['setBusinessFeatures', { bizId: 'acme', features: { scan: true } }], ['setBusinessAdv', { bizId: 'acme', adv: {} }], ['setYemotToken', { bizId: 'acme' }], ['logBusinessEntry', { bizId: 'flagship' }]]) { try { await fnCall(n, d); r[n] = 'OK!'; } catch (e) { r[n] = e.reason || e.message; } }
    try { await fsx('/b/acme?updateMask.fieldPaths=status', { method: 'PATCH', body: JSON.stringify({ fields: { status: { stringValue: 'suspended' } } }) }, 1); r.patch = 'OK!'; } catch (e) { r.patch = e.code; }
    try { await bzSwitch('flagship'); r.switch = 'OK!'; } catch (e) { r.switch = e.message; }
    return r;
  });
  const acme = await getDoc('b/acme');
  check('26 כשמכריחים את הכפתור להופיע אצל מנהל רגיל: רשימת העסקים נחסמת בחוקים, וכל פונקציית מנהל־על נדחית בשרת', forced.listErr && forced.rows === 0 && Object.entries(forced).filter(([k]) => /^(createBusiness|setBusiness|setYemot|logBusiness)/.test(k)).every(([, v]) => v === 'not-superadmin' || /אין לך הרשאת מנהל־על/.test(v)) && forced.patch === 403 && acme.status === 'active' && !(await getDoc('b/evil')), { forced, acmeStatus: acme.status });
  const listR = log2.find((r) => r.step === 'forced' && /\/documents\/b\?/.test(r.url));
  // 7: מנהל עסק לא מוסיף עובדים ולא משנה דרגות/מתגים (6ה) – לא בממשק ולא בכוח
  page.__step = 'staff-ma';
  await page.evaluate(() => { ADM.sa = 0; go('staff'); }); await wait(page, 1800);
  const ma = await page.evaluate(async () => { const r = { form: !!document.querySelector('form[data-f=admStaffAdd]'), perm: !!document.querySelector('[data-a=admPerm]'), rank: !!document.querySelector('[data-a=admRank]'), txt: /דרך מנהל המערכת/.test(document.getElementById('main').innerText) };
    for (const [n, d] of [['addStaff', { email: 'sneak@x.co', name: 'x' }], ['addStaff', { bizId: 'acme', email: 'sneak2@x.co', name: 'x' }], ['setBusinessRanks', { bizId: 'acme', ranks: [] }], ['setStaffPerms', { bizId: 'acme', uid: 'abcdefgh', perms: {} }]]) { try { await fnCall(n, d); r[n + JSON.stringify(d).length] = 'OK!'; } catch (e) { r[n + JSON.stringify(d).length] = e.reason || e.message; } }
    return r; });
  const sneak = (await listIds('b/acme/staff')).length;
  check('26א מנהל עסק: אין טופס "הוספת עובד", אין "הרשאות" ואין דרגות; בכוח – addStaff, setBusinessRanks ו-setStaffPerms נדחים (not-superadmin), ולא נוסף עובד', !ma.form && !ma.perm && !ma.rank && ma.txt && Object.entries(ma).filter(([k]) => /^(add|set)/.test(k)).every(([, v]) => v === 'not-superadmin') && sneak === 0, { ma, staffInAcme: sneak });
  check('27 בקשת הרשימה של מנהל רגיל נדחתה בחוקים (403)', listR && listR.status === 403, listR && { status: listR.status, url: decodeURIComponent(listR.url).replace(/^.*\/documents/, '/documents') });
  check('28 אין שגיאות JS אצל מנהל רגיל', log2.length > 0 && page.__errors.length === 0, page.__errors);
  await ctx.close();

  // ---------- לארג' פעמי (legacy) ----------
  const log3 = []; ({ ctx, page } = await open('mroot@x.co', log3, 'root'));
  await settingsOf(page);
  st = await page.evaluate(() => ({ sa: !!document.querySelector('[data-v="sa"]'), staff: !!document.querySelector('[data-v="staff"]'), mode: bzB(), biz: SY.bizId, root: SY.biz && SY.biz.dataRoot, secName: [...document.querySelectorAll('.sec h3')].map((h) => h.textContent) }));
  check('29 לארג\' פעמי במצב legacy: אין כפתור "עובדים" ואין כפתור מנהל־על; ההגדרות כמו היום (אין סעיף "ניהול")', !st.sa && !st.staff && !st.mode && st.biz === BZ0 && st.root === 'legacy' && !st.secName.includes('ניהול'), st);
  await shot(page, '11-הגדרות-לארג-פעמי');
  const forced3 = await page.evaluate(() => { go('staff'); return document.querySelector('#main').innerText; });
  check('30 גם בכוח: מסך עובדים לא מציג כלום אצל לארג\' פעמי (legacy)', /בעסקים במבנה החדש בלבד/.test(forced3) && !/הוסף עובד/.test(forced3), forced3.slice(0, 80));
  await ctx.close();

  // ---------- כרטיס לארג' פעמי אצל מנהל־על ----------
  const log4 = []; ({ ctx, page } = await open('sa@x.co', log4, 'sa2'));
  await settingsOf(page); await page.evaluate(() => go('sa')); await wait(page, 2000);
  await page.evaluate((b) => go('sab', b), BZ0); await wait(page, 1800);
  const lgc = await page.evaluate(() => ({ brand: !!document.querySelector('[data-v=brand]'), enter: !!document.querySelector('[data-a=admEnter]'), sus: !!document.querySelector('[data-a=admSus]'), feat: !!document.querySelector('[data-a=admFeat]'), adv: !!document.querySelector('form[data-f=admAdv]'), tok: !!document.querySelector('[data-a=admTok]'), txt: document.querySelector('#main').innerText.slice(0, 160) }));
  await shot(page, '12-כרטיס-לארג-פעמי', true);
  check('31 כרטיס לארג\' פעמי (legacy): מוצג עם "כניסה כמנהל" בלבד, בלי פעולות שהשרת דוחה (השהיה, תוספות, adv, אסימון)', lgc.enter && !lgc.sus && !lgc.feat && !lgc.adv && !lgc.tok && !lgc.brand, lgc);
  check('32 אין שגיאות JS (כרטיס לארג\' פעמי)', page.__errors.length === 0, page.__errors);
  await ctx.close();
  await browser.close();
  fs.writeFileSync(outFile, JSON.stringify({ out, jsErrors: sErr }, null, 1));
  console.log(fail ? `תוצאה: נכשל (${fail})` : 'תוצאה: הכול עבר'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
