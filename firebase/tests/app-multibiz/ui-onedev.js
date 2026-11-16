'use strict';
// מכשיר אחד למשתמש (16.11.2026): בדיקת הקוד של האפליקציה בדפדפן – devClaim בכניסה ובפתיחה, ניתוק רק על cur:false מפורש,
// טלפון מול מחשב (kind), מנהל־על לא נבדק, שליחת התור / גיבוי לפני הניתוק, כניסה ישנה בלי SY.ds (legacy:1), ובלי לולאה.
// 16.11.2026 (תיקון): ניתוק אוטומטי לא מוחק נתונים (גם במחשב) – רק פרטי החיבור; lp-trust נשאר; משתמש אחר באותו מחשב – הנתונים הקודמים נמחקים
// לפני הכניסה; לא מתנתקים באמצע עבודה (עד 2 דחיות); כניסה שה-claim שלה נכשל – בפתיחה הבאה legacy:1.
// רשת מדומה (harness), בלי אמולטור ובלי השרת האמיתי: devClaim מדומה כאן. שימוש: node ui-onedev.js <www-dir> [out.json]
const fs = require('fs');
const H = require('./harness');
const out = {}; let fail = 0;
const check = (name, ok, info) => { out[name] = { ok: !!ok, info }; if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const MSG = 'התחברת ממכשיר אחר';
const S_RE = /^[A-Za-z0-9_-]{16,64}$/;
const UA_MOBILE = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

function fakeNative() {
  window.Capacitor = { isNativePlatform: () => true, Plugins: { App: { addListener: () => Promise.resolve({ remove() {} }), exitApp() {} } } };
}

// st.mode: cur (ברירת מחדל) | kick | exempt | abort | 404 | 500 | nocur
async function open(browser, www, who, o) {
  o = o || {};
  const cfg = o.sa
    ? { mode: 'new', users: { sa: 'acme' }, sa: { sa: 1 }, biz: { acme: { dataRoot: 'b' } }, admins: { 'b/acme/|sa': 1 } }
    : { mode: 'old', admins: { '|m': 1 }, staff: { '|w': 1 } };
  if (o.ctx) cfg.ctx = o.ctx;
  const log = []; const st = { mode: o.mode || 'cur' }; const calls = [];
  const { ctx, page } = await H.newPage(browser, www, cfg, log, who);
  if (o.nat) await page.addInitScript(fakeNative);
  await ctx.route(/:5001\/.*/, async (route) => {
    const u = new URL(route.request().url()); const n = u.pathname.split('/').pop();
    let data = {}; try { data = JSON.parse(route.request().postData() || '{}').data || {}; } catch (e) { /* */ }
    log.push({ who, gen: page.__gen, method: 'POST', url: u.href, fn: n, data, at: Date.now() });
    const ok = (r) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: r }) });
    if (n === 'devClaim') {
      calls.push(Object.assign({ gen: page.__gen }, data));
      const m = st.mode;
      if (m === 'abort') return route.abort('internetdisconnected');
      if (m === '404') return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { status: 'NOT_FOUND', message: 'not found' } }) });
      if (m === '500') return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { status: 'INTERNAL', message: 'INTERNAL' } }) });
      if (m === 'kick') return ok({ ok: true, cur: false });
      if (m === 'exempt') return ok({ ok: true, exempt: true });
      if (m === 'nocur') return ok({ ok: true });
      return ok({ ok: true, cur: true });
    }
    if (n === 'getBackupKey') return ok({ key: Buffer.alloc(32, 7).toString('base64') });
    return ok({});
  });
  if (o.slowOb) await ctx.route(/:8080\/.*\/(chunks|inbox)\?documentId=/, async (route) => { await new Promise((r) => setTimeout(r, 30000)); try { await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); } catch (e) { /* הדף כבר נטען מחדש */ } });
  return { ctx, page, log, st, calls };
}
const state = (page) => page.evaluate(() => { let y = null; try { y = JSON.parse(localStorage.getItem('lp-sync')); } catch (e) { /* */ }
  return { sync: y && (y.refresh || y.role) ? { ds: y.ds, dsc: y.dsc, dsl: y.dsl, role: y.role } : null, // בלי refresh/role = מנותק ("{}" אפשרי: שליחה שבוטלה בטעינה כותבת SY ריק)
    gate: !!document.getElementById('gform'), gerr: (document.getElementById('gerr') || {}).textContent || '', kick: localStorage.getItem('lp-kick') }; }).catch((e) => ({ err: String(e) }));
// מה נשאר במחשב: התור של העובד, הספרים של המנהל, קובץ ב-lp-files (IndexedDB), lp-trust, lp-kick
const kept = (page) => page.evaluate(async () => { const g = (k) => localStorage.getItem(k) || '';
  let f = null; try { f = await new Promise((res) => { const q = indexedDB.open('lp-files'); q.onsuccess = () => { const d = q.result; try { const t = d.transaction(d.objectStoreNames[0], 'readonly'); const r = t.objectStore(d.objectStoreNames[0]).get('ftest1'); r.onsuccess = () => { res(r.result || null); d.close(); }; r.onerror = () => { res(null); d.close(); }; } catch (e) { res(null); d.close(); } }; q.onerror = () => res(null); }); } catch (e) { /* */ }
  let y = null; try { y = JSON.parse(g('lp-sync')); } catch (e) { /* */ }
  let ob = []; try { ob = (JSON.parse(g('lp-outbox') || '[]') || []).map((x) => x.id); } catch (e) { /* */ }
  return { ob, books: g('large-pami-v2').includes('tx1'), file: f, trust: g('lp-trust'), kick: g('lp-kick'), cred: !!(y && (y.refresh || y.idToken)) }; }).catch((e) => ({ err: String(e) }));
const putFile = (page) => page.evaluate(() => fput('ftest1', 'data:text/plain,keep')).catch((e) => String(e));
const login = async (A, email) => { await H.login(A.page, email); await A.page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden && ACT.startBlank) ACT.startBlank(); }).catch(() => {}); await H.settle(A.page, 500); };
// הפעלת בדיקה, והמתנה לטעינה מחדש (אם יש) עד ms
async function trigger(A, ms, fn) {
  const g = A.page.__gen; const t0 = Date.now();
  await A.page.evaluate(fn || (() => { dvCur(1); })).catch(() => {});
  for (let i = 0; i < ms / 100 && A.page.__gen === g; i++) await A.page.waitForTimeout(100);
  const navMs = A.page.__gen !== g ? Date.now() - t0 : null;
  if (navMs !== null) { await A.page.waitForLoadState('load').catch(() => {}); await H.settle(A.page, 1500); }
  return { g, navMs };
}

(async () => {
  const [www, outFile] = process.argv.slice(2);
  const browser = await H.launch();
  let A, s, r;

  // ---------- 1. עובד במחשב: claim בכניסה (web), ואז cur:false → שליחת התור, ניתוק, הודעה ----------
  A = await open(browser, www, 'w');
  await login(A, 'w@x.co');
  s = await state(A.page);
  const c0 = A.calls[0] || {};
  check('1 כניסה (עובד, מחשב): devClaim claim עם kind=web ו-s תקין, בלי legacy; השרת אישר → SY.dsc', A.calls.length >= 1 && c0.op === 'claim' && c0.kind === 'web' && S_RE.test(c0.s || '') && !c0.legacy && s.sync && s.sync.ds === c0.s && s.sync.dsc === 1, { calls: A.calls, s });
  // דחיפת התראות: s נשלח רק אחרי אישור
  r = await A.page.evaluate(() => {
    const L = {}; window.Capacitor = window.Capacitor || {};
    window.Capacitor.Plugins = Object.assign({}, window.Capacitor.Plugins || {}, { PushGate: { state: async () => ({ ready: true }) }, PushNotifications: {
      removeAllListeners: async () => {}, unregister: async () => {}, addListener: async (e, f) => { L[e] = f; return { remove() {} }; },
      checkPermissions: async () => ({ receive: 'granted' }), requestPermissions: async () => ({ receive: 'granted' }),
      register: async () => { setTimeout(() => L.registration && L.registration({ value: 'fcm_' + 'z'.repeat(30) }), 10); } } });
    window.secPushOff(); window.secPushBoot(); return SY.ds; });
  await H.settle(A.page, 600);
  const rp = A.log.filter((x) => x.fn === 'registerPushToken').pop();
  check('2 registerPushToken אחרי אישור הכניסה: נשלח גם s = SY.ds', rp && rp.data.s === r && rp.data.token === 'fcm_' + 'z'.repeat(30), rp && rp.data);
  await A.page.evaluate(() => { obSet([{ id: 'ob1', created: '2026-11-03T09:00:00.000Z', nopic: 1, data: { amt: 5, date: '2026-11-03', note: 'בדיקה' } }]); });
  A.st.mode = 'kick';
  r = await trigger(A, 15000);
  s = await state(A.page);
  const iOb = A.log.findIndex((x) => x.gen === r.g && x.method === 'POST' && /\/inbox\?documentId=ob1/.test(x.url));
  const iNext = A.log.findIndex((x) => x.gen > r.g);
  check('3 cur:false: התור של העובד נשלח (inbox/ob1) לפני הטעינה מחדש', iOb >= 0 && (iNext < 0 || iOb < iNext), { iOb, iNext });
  check('4 cur:false: ניתוק (lp-sync נמחק) ומסך הכניסה עם "' + MSG + '"; lp-kick שומר רק את מי שנותק', r.navMs !== null && s.gate && s.gerr === MSG && !s.sync && s.kick === JSON.stringify({ u: 'w' }), { r, s });
  const nAfter = A.calls.length; await A.page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); }); await H.settle(A.page, 2500);
  check('5 אחרי הניתוק: אין עוד קריאות devClaim (אין לולאה)', A.calls.length === nAfter && A.page.__errors.length === 0, { n: A.calls.length - nAfter, err: A.page.__errors });
  await A.page.reload(); await H.settle(A.page, 1200); s = await state(A.page);
  check('6 טעינה נוספת: מסך כניסה רגיל, ההודעה לא חוזרת', s.gate && s.gerr === '', s);
  await A.ctx.close();

  // ---------- 2. שגיאות רשת / שרת לא מעודכן: לא מתנתקים ----------
  A = await open(browser, www, 'w', { mode: 'abort' });
  await login(A, 'w@x.co');
  s = await state(A.page);
  check('7 כניסה כשהשרת לא זמין (רשת): הכניסה מצליחה, יש SY.ds בלי dsc', s.sync && s.sync.role === 'worker' && S_RE.test(s.sync.ds || '') && !s.sync.dsc && !s.gate, s);
  const bad = {};
  for (const m of ['abort', '404', '500', 'nocur']) { A.st.mode = m; r = await trigger(A, 2500); s = await state(A.page); bad[m] = { nav: r.navMs, sync: !!s.sync, gate: s.gate }; }
  check('8 שגיאת רשת / not-found / internal / תשובה בלי cur: אין ניתוק ואין טעינה מחדש', Object.values(bad).every((x) => x.nav === null && x.sync && !x.gate), bad);
  const cl = A.calls.slice(-1)[0] || {};
  check('9 כניסה שה-claim שלה נכשל: בבדיקה הבאה claim עם legacy:1 (לא דורס כניסה חדשה יותר ממכשיר אחר), אותו s', cl.op === 'claim' && cl.legacy === 1 && cl.s === s.sync.ds && s.sync.dsl === 1, { cl, s });
  A.st.mode = 'cur'; await trigger(A, 1500); s = await state(A.page);
  check('10 אחרי שהשרת חזר: claim מאושר → dsc (ו-dsl נמחק), והבדיקה הבאה היא check', s.sync && s.sync.dsc === 1 && !s.sync.dsl, s);
  await trigger(A, 1500);
  check('11 בדיקה אחרי אישור: op=check', (A.calls.slice(-1)[0] || {}).op === 'check', A.calls.slice(-1)[0]);
  check('12 אין שגיאות JS (שגיאות רשת)', A.page.__errors.length === 0, A.page.__errors);
  await A.ctx.close();

  // ---------- 3. כניסה ישנה (לפני העדכון) בלי SY.ds → claim עם legacy:1 ----------
  A = await open(browser, www, 'w');
  await login(A, 'w@x.co');
  const ds0 = (await state(A.page)).sync.ds;
  await A.page.evaluate(() => { const y = JSON.parse(localStorage.getItem('lp-sync')); delete y.ds; delete y.dsc; delete y.dsl; localStorage.setItem('lp-sync', JSON.stringify(y)); });
  const n0 = A.calls.length;
  await A.page.reload(); await H.settle(A.page, 2500); s = await state(A.page);
  const lc = A.calls[n0] || {};
  check('13 פתיחה של כניסה בלי SY.ds: claim עם legacy:1 ו-s חדש, שנשמר', lc.op === 'claim' && lc.legacy === 1 && S_RE.test(lc.s || '') && lc.s !== ds0 && s.sync.ds === lc.s && s.sync.dsc === 1 && !s.sync.dsl, { lc, s });
  await trigger(A, 1500);
  const lc2 = A.calls.slice(-1)[0] || {};
  check('14 אחרי אישור: check בלי legacy', lc2.op === 'check' && !lc2.legacy, lc2);
  // legacy ותשובת cur:false (יש כבר מכשיר רשום) → ניתוק
  await A.page.evaluate(() => { const y = JSON.parse(localStorage.getItem('lp-sync')); delete y.ds; delete y.dsc; delete y.dsl; localStorage.setItem('lp-sync', JSON.stringify(y)); });
  A.st.mode = 'kick';
  const g0 = A.page.__gen; await A.page.reload(); for (let i = 0; i < 150 && A.page.__gen <= g0 + 1; i++) await A.page.waitForTimeout(100);
  await H.settle(A.page, 1500); s = await state(A.page);
  check('15 כניסה ישנה ש-legacy שלה נדחה (cur:false): ניתוק עם ההודעה', s.gate && s.gerr === MSG && !s.sync, s);
  await A.ctx.close();

  // ---------- 4. טלפון מול מחשב ----------
  A = await open(browser, www, 'w', { ctx: { userAgent: UA_MOBILE, isMobile: true, hasTouch: true, viewport: { width: 360, height: 740 } } });
  await login(A, 'w@x.co');
  check('16 דפדפן בטלפון (user agent של Android): kind=phone', (A.calls[0] || {}).kind === 'phone', A.calls[0]);
  await A.ctx.close();
  A = await open(browser, www, 'w', { nat: true, ctx: { viewport: { width: 360, height: 740 } } });
  await login(A, 'w@x.co');
  check('17 אפליקציה (isNat, גם בלי user agent של טלפון): kind=phone', (A.calls[0] || {}).kind === 'phone', A.calls[0]);
  await A.page.evaluate(() => localStorage.setItem('lp-test-keep', '1'));
  A.st.mode = 'kick';
  r = await trigger(A, 15000); s = await state(A.page);
  const keep = await A.page.evaluate(() => Object.keys(localStorage).sort()).catch(() => []);
  check('18 אפליקציה, cur:false: ניתוק + הודעה; בטלפון האחסון לא נמחק כולו (כמו התנתקות רגילה)', r.navMs !== null && s.gate && s.gerr === MSG && !s.sync && keep.includes('lp-test-keep'), { r, s, keep });
  check('19 אין שגיאות JS (טלפון)', A.page.__errors.length === 0, A.page.__errors);
  await A.ctx.close();

  // ---------- 5. מנהל במחשב: גיבוי לענן לפני הניתוק ----------
  A = await open(browser, www, 'm');
  await login(A, 'm@x.co');
  check('20 מנהל במחשב: kind=web', (A.calls[0] || {}).kind === 'web', A.calls[0]);
  await A.page.evaluate(() => { S.tx.push({ id: 'tx1', date: today(), amt: 100, cat: (S.cats.find((c) => c.kind === 'exp') || S.cats[0] || {}).id, note: 'בדיקה' }); save(); });
  await putFile(A.page);
  A.st.mode = 'kick';
  r = await trigger(A, 15000); s = await state(A.page);
  const bk = A.log.filter((x) => x.gen === r.g && (x.fn === 'getBackupKey' || /uploadType=media/.test(x.url)));
  check('21 מנהל במחשב, cur:false: ניסיון גיבוי לענן (getBackupKey / העלאה) לפני הניתוק, ואז הודעה', bk.length > 0 && r.navMs !== null && s.gate && s.gerr === MSG && !s.sync, { bk: bk.map((x) => x.fn || x.url.slice(0, 80)), r, s });
  let k = await kept(A.page);
  check('21א מנהל במחשב אחרי ניתוק: הספרים וקובץ ב-lp-files נשארו, lp-trust נשאר, אין פרטי חיבור', k.books && k.file && /"uid":"m"/.test(k.trust) && !k.cred && k.kick === JSON.stringify({ u: 'm' }), k);
  // אותו מנהל חוזר: בלי קישור במייל (lp-trust), והנתונים במקומם
  A.st.mode = 'cur';
  await H.login(A.page, 'm@x.co', { trust: false }); await H.settle(A.page, 800);
  s = await state(A.page); k = await kept(A.page);
  check('21ב אותו מנהל נכנס שוב באותו מחשב: בלי קישור במייל, הספרים והקבצים במקומם, lp-kick נמחק', s.sync && s.sync.role === 'admin' && !s.gate && k.books && k.file && !k.kick && (await A.page.evaluate(() => S.tx.some((t) => t.id === 'tx1')).catch(() => false)), { s, k });
  // ניתוק שוב, ואז משתמש אחר נכנס באותו מחשב – הנתונים של המנהל נמחקים לפני הכניסה
  A.st.mode = 'kick'; r = await trigger(A, 15000);
  A.st.mode = 'cur';
  await login(A, 'w@x.co'); await H.settle(A.page, 1500);
  s = await state(A.page); k = await kept(A.page);
  const mem = await A.page.evaluate(() => (S && S.tx || []).some((t) => t.id === 'tx1')).catch(() => true);
  check('21ג משתמש אחר (עובד) נכנס אחרי ניתוק של המנהל: הספרים, הקבצים ו-lp-trust של המנהל נמחקו (גם מהזיכרון), והוא מחובר', r.navMs !== null && s.sync && s.sync.role === 'worker' && !k.books && !k.file && !/"uid":"m"/.test(k.trust) && !k.kick && !mem && A.page.__errors.length === 0, { r, s, k, mem, err: A.page.__errors });
  await A.ctx.close();

  // ---------- 6. תקרת 10 שניות: תור שלא נשלח לא מעכב את הניתוק לתמיד ----------
  A = await open(browser, www, 'w', { slowOb: true });
  await login(A, 'w@x.co');
  await A.page.evaluate(() => { obSet([{ id: 'ob2', created: '2026-11-03T09:00:00.000Z', nopic: 1, data: { amt: 5, date: '2026-11-03', note: 'איטי' } }]); });
  await putFile(A.page);
  A.st.mode = 'kick';
  r = await trigger(A, 20000); s = await state(A.page);
  check('22 שליחה תקועה: הניתוק קורה אחרי כ-10 שניות (לא לפני 9.5, לא אחרי 13)', r.navMs !== null && r.navMs >= 9500 && r.navMs <= 13000 && s.gate && s.gerr === MSG && !s.sync, { r, s });
  k = await kept(A.page);
  check('22א שליחה תקועה: התור שלא נשלח (ob2) וקובץ ב-lp-files לא נמחקו; ב-lp-sync אין פרטי חיבור', k.ob.includes('ob2') && k.file && !k.cred && k.kick === JSON.stringify({ u: 'w' }), k);
  // אותו עובד נכנס שוב: התור עדיין שלו (נשלח או ממתין), הקובץ במקומו
  const gw = A.page.__gen; A.st.mode = 'cur';
  await login(A, 'w@x.co'); await H.settle(A.page, 1500);
  s = await state(A.page); k = await kept(A.page);
  const sent = A.log.some((x) => x.gen > gw && x.method === 'POST' && /\/inbox\?documentId=ob2/.test(x.url));
  check('22ב אותו עובד נכנס שוב באותו מחשב: התור (ob2) שלו – במקומו או נשלח, והקובץ במקומו', s.sync && s.sync.role === 'worker' && (k.ob.includes('ob2') || sent) && k.file && !k.kick && s.sync.dsc === 1 && A.page.__errors.length === 0, { s, k, sent, err: A.page.__errors });
  await A.ctx.close();

  // ---------- 6א. לא באמצע עבודה: שדה בפוקוס / חלון עם שינוי – עד 2 דחיות, ואז ניתוק ----------
  A = await open(browser, www, 'w');
  await login(A, 'w@x.co');
  A.st.mode = 'kick';
  await A.page.evaluate(() => { dlg('<h3>טופס</h3><textarea id="tq"></textarea><button class="btn" data-a="closeDlg">סגור</button>'); });
  await A.page.fill('#tq', 'טקסט שעוד לא נשמר');
  r = await trigger(A, 2500); s = await state(A.page);
  const p1 = await A.page.evaluate(() => ({ p: DV1.p, k: DV1.k, toast: [...document.querySelectorAll('.toast')].map((e) => e.textContent).join('|'), v: document.getElementById('tq').value })).catch((e) => ({ err: String(e) }));
  check('26 שדה בפוקוס עם טקסט: הניתוק נדחה (בלי טעינה), הטקסט נשאר, והודעה קצרה "' + MSG + '"', r.navMs === null && s.sync && p1.p === 1 && !p1.k && p1.v === 'טקסט שעוד לא נשמר' && p1.toast.includes(MSG), { r, p1 });
  await A.page.evaluate(() => { document.activeElement.blur(); });
  r = await trigger(A, 2500); s = await state(A.page);
  check('27 בלי פוקוס, אבל חלון פתוח עם שדה שהשתנה: דחייה שנייה', r.navMs === null && s.sync && (await A.page.evaluate(() => DV1.p)) === 2, { r });
  r = await trigger(A, 15000); s = await state(A.page);
  check('28 אחרי 2 דחיות: ניתוק בכל זאת, עם ההודעה', r.navMs !== null && s.gate && s.gerr === MSG && !s.sync, { r, s });
  await A.ctx.close();
  A = await open(browser, www, 'w');
  await login(A, 'w@x.co');
  A.st.mode = 'kick';
  await A.page.evaluate(() => { dlg('<h3>טופס</h3><input id="tq2" value="ברירת מחדל"><button class="btn" data-a="closeDlg">סגור</button>'); document.activeElement && document.activeElement.blur && document.activeElement.blur(); });
  r = await trigger(A, 15000); s = await state(A.page);
  check('29 חלון פתוח בלי שינוי ובלי פוקוס על שדה: ניתוק מיד (בלי דחייה)', r.navMs !== null && s.gate && s.gerr === MSG, { r, s });
  await A.ctx.close();

  // ---------- 7. אין ניתוק כפול: כמה הפעלות במקביל → טעינה אחת ----------
  A = await open(browser, www, 'w');
  await login(A, 'w@x.co');
  A.st.mode = 'kick';
  const gBefore = A.page.__gen;
  r = await trigger(A, 15000, () => { dvCur(1); dvCur(1); dvCur(0); document.dispatchEvent(new Event('visibilitychange')); setTimeout(() => dvCur(1), 300); });
  await H.settle(A.page, 3000); s = await state(A.page);
  check('23 כמה בדיקות במקביל: טעינה מחדש אחת בלבד, devClaim אחד לפני הניתוק, ואף אחד אחריו', A.page.__gen === gBefore + 1 && A.calls.filter((c) => c.gen === gBefore).length === 2 && A.calls.filter((c) => c.gen > gBefore).length === 0 && s.gerr === MSG, { gen: A.page.__gen - gBefore, calls: A.calls.map((c) => c.op + '@' + c.gen) });
  await A.ctx.close();

  // ---------- 8. מנהל־על: אין קריאות devClaim בכלל ----------
  A = await open(browser, www, 'sa', { sa: true, mode: 'kick' });
  await login(A, 'sa@x.co');
  await A.page.evaluate(() => { dvCur(1); document.dispatchEvent(new Event('visibilitychange')); }); await H.settle(A.page, 2500);
  s = await state(A.page);
  check('24 מנהל־על (גם במסך הניהול וגם בתוך עסק): אף קריאת devClaim, ונשאר מחובר', A.calls.length === 0 && s.sync && !s.gate && A.page.__errors.length === 0, { calls: A.calls, s, err: A.page.__errors });
  await A.ctx.close();

  // ---------- 9. exempt מהשרת: מפסיקים לבדוק ----------
  A = await open(browser, www, 'w', { mode: 'exempt' });
  await login(A, 'w@x.co');
  const ne = A.calls.length; await trigger(A, 1500);
  check('25 תשובת exempt: אין ניתוק ואין בדיקות נוספות', A.calls.length === ne && (await state(A.page)).sync, { ne, n: A.calls.length });
  await A.ctx.close();

  await browser.close();
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
  console.log(fail ? `נכשלו ${fail} בדיקות` : 'כל הבדיקות עברו');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
