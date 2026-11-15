'use strict';
// סריקת חנות בתלת מימד – שלב 12 (2026-11-15): התראות לטלפון.
// 1. עובד: בפתיחה לא מתבקשת הרשאה (כמו קודם); בכניסה למסך התלת מימד (התוספת פעילה) – בקשת הרשאה פעם אחת, רישום, והמזהה נשלח לשרת.
// 2. תוספת כבויה – כניסה למסך לא מבקשת הרשאה.  3. לחיצה על התראה של סריקת החנות (k:'s3') פותחת את מסך התלת מימד.
// 4. מנהל־על שעובד בעסק: הרישום נשלח עם העסק הנוכחי (bizId), כדי שהטלפון יירשם בעסק הנכון.
// רשת מדומה (בלי שרת, בלי FCM). שימוש: node ui-push-s3.js <www-dir>
const H = require('./harness');
let fail = 0;
const check = (name, ok, info) => { if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const BIZ = 'biz-p';
const ON = { scan: true, tasks: true, store3d: true };
const OFF = { scan: true, tasks: true };

async function open(browser, www, who, feat, o) {
  const cfg = { mode: 'new', users: { [who]: BIZ }, sa: o && o.sa ? { [who]: 1 } : {}, biz: { [BIZ]: { dataRoot: 'b', features: feat, name: 'עסק בדיקה' } },
    admins: o && o.mgr ? { [`b/${BIZ}/|${who}`]: 1 } : {}, staff: { [`b/${BIZ}/|${who}`]: 1 }, ctx: { hasTouch: true, isMobile: true, viewport: { width: 360, height: 740 } } };
  const bodies = [];
  const { ctx, page } = await H.newPage(browser, www, cfg, [], who);
  await ctx.route(/:5001\/.*/, async (route) => {
    const n = new URL(route.request().url()).pathname.split('/').pop();
    let body = {}; try { body = JSON.parse(route.request().postData() || '{}').data || {}; } catch (e) { /* */ }
    bodies.push([n, body]);
    const ok = (r) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: r }) });
    if (n === 'registerPushToken') return ok({ ok: true, count: 1, removed: 0, moved: 0 });
    if (n === 's3View') return ok({ runs: [] });
    return ok(n === 'getBackupKey' ? { key: Buffer.alloc(32, 7).toString('base64') } : {});
  });
  await H.login(page, who + '@x.co');
  await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden && ACT.startBlank) ACT.startBlank(); });
  await H.settle(page, 600);
  // רכיב התראות מדומה (Android 13+: ההרשאה עוד לא נשאלה), ואז "פתיחת האפליקציה" – secPushBoot כמו ב-enterApp
  await page.evaluate(() => {
    const L = {}; window.__pn = []; window.__pnL = L; window.__perm = 'prompt';
    try { localStorage.removeItem('lp-push-asked'); } catch (e) { /* */ }
    window.Capacitor = window.Capacitor || {}; window.Capacitor.Plugins = Object.assign({}, window.Capacitor.Plugins || {}, { PushGate: { state: async () => ({ ready: true }) }, PushNotifications: {
      removeAllListeners: async () => { window.__pn.push('off'); }, unregister: async () => { window.__pn.push('unregister'); },
      addListener: async (e, f) => { L[e] = f; window.__pn.push('on:' + e); return { remove() {} }; },
      checkPermissions: async () => ({ receive: window.__perm }), requestPermissions: async () => { window.__pn.push('ask'); window.__perm = 'granted'; return { receive: 'granted' }; },
      register: async () => { window.__pn.push('register'); setTimeout(() => L.registration && L.registration({ value: 'fcm_token_' + 'y'.repeat(30) }), 10); },
    } });
    window.secPushOff(); window.secPushBoot();
  });
  await H.settle(page, 400);
  return { ctx, page, bodies };
}
const pn = (page) => page.evaluate(() => window.__pn.slice());
const reg = (bodies) => bodies.filter((b) => b[0] === 'registerPushToken').pop();

(async () => {
  const [www] = process.argv.slice(2);
  const browser = await H.launch();

  // 1. עובד, התוספת פעילה
  let A = await open(browser, www, 'w', ON);
  let p = await pn(A.page);
  check('עובד: בפתיחה – מאזינים נרשמו, בלי בקשת הרשאה ובלי רישום (כמו קודם)', p.includes('on:registration') && !p.includes('ask') && !p.includes('register'), p);
  await A.page.evaluate(() => go('st3')); await H.settle(A.page, 700);
  p = await pn(A.page); let r = reg(A.bodies);
  check('עובד: כניסה למסך התלת מימד – בקשת הרשאה, רישום, והמזהה נשלח לשרת', p.filter((x) => x === 'ask').length === 1 && p.includes('register') && r && /^fcm_token_/.test(r[1].token), { p, r: r && r[1] });
  await A.page.evaluate(() => { NAV = [{ v: 'wk' }]; go('wk'); }); await H.settle(A.page, 300);
  await A.page.evaluate(() => go('st3')); await H.settle(A.page, 500);
  p = await pn(A.page);
  check('עובד: כניסה חוזרת – לא מבקשים הרשאה שוב', p.filter((x) => x === 'ask').length === 1, p);
  await A.page.evaluate(() => { NAV = [{ v: 'wk' }]; go('wk'); }); await H.settle(A.page, 300);
  await A.page.evaluate(() => window.__pnL.pushNotificationActionPerformed({ actionId: 'tap', notification: { data: { k: 's3', v: 'new' } } })); await H.settle(A.page, 600);
  const v = await A.page.evaluate(() => NAV[NAV.length - 1].v);
  check('עובד: לחיצה על התראת סבב – מסך התלת מימד', v === 'st3', v);
  check('עובד: בלי שגיאות JS', A.page.__errors.length === 0, A.page.__errors);
  await A.ctx.close();

  // 2. עובד, התוספת כבויה
  A = await open(browser, www, 'w', OFF);
  await A.page.evaluate(() => go('st3')); await H.settle(A.page, 500);
  p = await pn(A.page);
  check('תוספת כבויה: כניסה למסך לא מבקשת הרשאה', !p.includes('ask') && !reg(A.bodies), p);
  check('תוספת כבויה: בלי שגיאות JS', A.page.__errors.length === 0, A.page.__errors);
  await A.ctx.close();

  // 3. מנהל־על שהוא מנהל בעסק: הרישום עם bizId
  A = await open(browser, www, 'm', ON, { mgr: 1, sa: 1 });
  r = reg(A.bodies);
  check('מנהל־על: הרישום נשלח עם העסק הנוכחי', r && r[1].bizId === BIZ && /^fcm_token_/.test(r[1].token), r && r[1]);
  check('מנהל־על: בלי שגיאות JS', A.page.__errors.length === 0, A.page.__errors);
  await A.ctx.close();

  await browser.close();
  console.log(fail ? `נכשלו ${fail}` : 'הכל עבר');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
