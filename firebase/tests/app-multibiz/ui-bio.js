'use strict';
// ריבוי עסקים, שלב 6ג-2: נעילה בטביעת אצבע – בדיקת הקוד של האפליקציה בדפדפן, עם תוסף מדומה (window.Capacitor.Plugins.BiometricLock ו-App).
// לא בודק את התוסף האמיתי ולא טלפון: זה נבדק רק בבניית ה-CI ובטלפון של המשתמש. לא צריך אמולטור (רשת מדומה של harness).
// שימוש: node ui-bio.js <www-dir> <out.json> [shots-dir]
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const out = {}; let fail = 0;
const check = (name, ok, info) => { out[name] = { ok: !!ok, info }; if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const cfg = { mode: 'old', admins: { '|m': 1 }, staff: { '|w': 1 } }; // לארג' פעמי, חוקים ישנים

// תוסף מדומה: authenticate מחזיר את התשובות שבתור (ברירת מחדל ok), וכל קריאה נרשמת
function fakeNative(o) {
  const L = {}; const st = JSON.parse(sessionStorage.getItem('__bioQ') || 'null') || { results: o.results || [] };
  window.__bio = { calls: [], secure: [], first: null };
  window.Capacitor = { isNativePlatform: () => true, Plugins: {
    App: { addListener: (e, f) => { (L[e] = L[e] || []).push(f); return Promise.resolve({ remove() {} }); }, exitApp() {} },
    BiometricLock: {
      isAvailable: async () => ({ available: o.avail, biometric: o.avail, deviceCredential: o.avail, api: 34 }),
      authenticate: async (a) => { window.__bio.calls.push(a.reason); await new Promise((r) => setTimeout(r, 200)); const q = JSON.parse(sessionStorage.getItem('__bioQ') || 'null') || st; const r = q.results.length ? q.results.shift() : { ok: true }; sessionStorage.setItem('__bioQ', JSON.stringify(q)); return r; },
      setSecureWindow: async (a) => { window.__bio.secure.push(a.on); return { on: a.on }; },
    } } };
  window.__appEv = (e) => (L[e] || []).forEach((f) => f());
  // הרגע שבו נוסף לדף התוכן הראשון של body: האם הכיסוי כבר היה במקום?
  new MutationObserver((ms, obs) => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && n.parentNode === document.body && n.id !== 'bzlk' && n.tagName !== 'SCRIPT') { if (!window.__bio.first) window.__bio.first = { tag: n.tagName, cls: document.documentElement.classList.contains('bzlk') }; obs.disconnect(); return; } }).observe(document, { childList: true, subtree: true });
}

(async () => {
  const [www, outFile, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const browser = await H.launch();
  const open = async (who, o) => {
    const { ctx, page } = await H.newPage(browser, www, cfg, [], who);
    await page.setViewportSize({ width: 360, height: 740 });
    await page.addInitScript(fakeNative, o);
    return { ctx, page };
  };
  const wait = (page, ms) => H.settle(page, ms || 800);
  const settings = async (page) => { await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden && ACT.startBlank) ACT.startBlank(); NAV = [{ v: 'settings' }]; render(0); }); await wait(page, 600); };
  const vis = (page) => page.evaluate(() => ({ cls: document.documentElement.classList.contains('bzlk'), lock: !!document.getElementById('bzlk'), lockVis: (() => { const e = document.getElementById('bzlk'); return e ? getComputedStyle(e).visibility : ''; })(), mainVis: getComputedStyle(document.getElementById('main')).visibility, msg: (document.getElementById('bzlkM') || {}).textContent || '', calls: window.__bio.calls.slice(), secure: window.__bio.secure.slice(), key: localStorage.getItem('lp-bio') }));

  // ---------- מנהל, יש חומרה ----------
  let { ctx, page } = await open('m', { avail: true });
  await H.login(page, 'm@x.co'); await settings(page);
  let s = await page.evaluate(() => { const b = document.querySelector('[data-a=bioTog]'); return { btn: !!b, txt: b && b.textContent, key: localStorage.getItem('lp-bio') }; });
  check('1 מנהל במכשיר עם נעילת מסך: המתג "כניסה בטביעת אצבע" מוצג בהגדרות, כבוי', s.btn && s.txt === 'כבוי' && !s.key, s);
  await page.click('[data-a=bioTog]'); await wait(page, 900);
  s = await vis(page);
  check('2 הפעלה: קודם אימות מוצלח, אחר כך נשמר lp-bio ומופעל FLAG_SECURE (setSecureWindow true)', s.calls.length === 1 && s.key === '1' && s.secure[s.secure.length - 1] === true && !s.cls, s);
  await shot(page, '08-הגדרות-מתג-טביעת-אצבע', true);
  // פתיחה מחדש של האפליקציה: מכסה לפני תוכן; ביטול באימות → נסה שוב / התנתק
  await page.evaluate(() => sessionStorage.setItem('__bioQ', JSON.stringify({ results: [{ ok: false, reason: 'cancelled' }] })));
  await page.reload(); await wait(page, 1200);
  s = await vis(page); const first = await page.evaluate(() => window.__bio.first);
  check('3 בפתיחה: הכיסוי היה במקום לפני שנוסף ל-body תוכן כלשהו, והתוכן מוסתר עד אימות', first && first.cls === true && s.lock && s.mainVis === 'hidden' && s.lockVis === 'visible' && s.secure[0] === true, { first, s });
  check('4 ביטול באימות: מוצגת הודעה עם "פתיחה" ו"התנתק" (אין נעילה לתמיד), ואין לולאת אימות', s.calls.length === 1 && /אפשר לנסות שוב או להתנתק/.test(s.msg) && await page.evaluate(() => !!document.querySelector('#bzlk [data-a=bioTry]') && !!document.querySelector('#bzlk [data-a=bioLkOut]')), s);
  await shot(page, '09-מסך-נעילה');
  await page.click('#bzlk [data-a=bioTry]'); await wait(page, 700);
  s = await vis(page);
  check('5 "פתיחה" ← אימות מוצלח ← התוכן נחשף', !s.cls && !s.lock && s.mainVis === 'visible' && s.calls.length === 2, s);
  // יציאה וחזרה
  await page.evaluate(() => window.__appEv('pause')); s = await vis(page);
  const pauseCover = s.cls && s.lock;
  await page.evaluate(() => { BIO.t = 0; window.__appEv('resume'); }); await wait(page, 500); s = await vis(page);
  check('6 יציאה מהאפליקציה מכסה מיד; חזרה מהירה (פחות מ-30 שניות, למשל מהמצלמה) לא מבקשת אימות', pauseCover && !s.cls && s.calls.length === 2, { pauseCover, s });
  await page.evaluate(() => { window.__appEv('pause'); BIO.bg = Date.now() - 31000; BIO.t = 0; window.__appEv('resume'); }); await wait(page, 100);
  const during = await vis(page);
  await page.evaluate(() => { window.__appEv('pause'); window.__appEv('resume'); window.__appEv('resume'); }); await wait(page, 700); s = await vis(page);
  check('7 חזרה אחרי יותר מ-30 שניות: נעילה ואימות; אירועי יציאה/חזרה בזמן האימות לא פותחים אימות נוסף', during.cls && during.lock && s.calls.length === 3 && !s.cls, { during: during.calls.length, after: s.calls.length });
  // not-available (נעילת המסך הוסרה)
  await page.evaluate(() => sessionStorage.setItem('__bioQ', JSON.stringify({ results: [{ ok: false, reason: 'not-available' }] })));
  await page.evaluate(() => { BIO.t = 0; BIO.bg = 0; window.__appEv('pause'); BIO.bg = 0; window.__appEv('resume'); }); await wait(page, 600); s = await vis(page);
  check('8 נעילת המסך במכשיר הוסרה: הסבר להתנתק ולהתחבר שוב עם סיסמה', s.lock && /נעילת המסך במכשיר בוטלה/.test(s.msg), s.msg);
  // מנהל־על שעובר לעסק אחר: הבחירה עוברת איתו (התחילית של העסק החדש)
  const carry = await page.evaluate(() => { bioCarry('acme'); const k = localStorage.getItem('acme:lp-bio'); localStorage.removeItem('acme:lp-bio'); return k; });
  check('9 מעבר מנהל־על לעסק אחר: הנעילה ממשיכה (lp-bio נכתב גם עם תחילית העסק החדש)', carry === '1', carry);
  // התנתקות ממסך הנעילה: ביטול טביעת האצבע; בטלפון שאר הנתונים נשמרים כמו היום
  const before = await page.evaluate(() => Object.keys(localStorage).sort());
  await Promise.all([page.waitForEvent('framenavigated'), page.click('#bzlk [data-a=bioLkOut]')]); await wait(page, 1200);
  s = await vis(page); const after = await page.evaluate(() => ({ keys: Object.keys(localStorage).sort(), gate: !!document.getElementById('gform') }));
  check('10 "התנתק" ממסך הנעילה: חוזרים למסך הכניסה, lp-bio נמחק ו-FLAG_SECURE כבוי; בטלפון הנתונים השמורים (large-pami-v2) נשארים כמו היום', after.gate && !s.key && !s.cls && s.secure.includes(false) && after.keys.includes('large-pami-v2') && !after.keys.includes('lp-sync'), { before, after, secure: s.secure });
  check('11 אין שגיאות JS (מנהל)', page.__errors.length === 0, page.__errors);
  await ctx.close();

  // ---------- התנתקות רגילה מההגדרות מבטלת את הבחירה ----------
  ({ ctx, page } = await open('m', { avail: true }));
  await H.login(page, 'm@x.co'); await settings(page);
  await page.click('[data-a=bioTog]'); await wait(page, 900);
  await page.click('#main [data-a=syOut]'); await wait(page, 300);
  const askTxt = await page.evaluate(() => document.getElementById('dlg').innerText);
  await Promise.all([page.waitForEvent('framenavigated'), page.click('#dlg [data-a=yes]')]); await wait(page, 1200);
  s = await vis(page);
  check('12 בטלפון: התנתקות מההגדרות – אותה שאלה כמו היום, ו-lp-bio נמחק', /^להתנתק מהחשבון במכשיר הזה\?/.test(askTxt) && !s.key && s.secure.includes(false), { askTxt, key: s.key });
  await ctx.close();

  // ---------- מפתח בלי חיבור: לא ננעלים ----------
  ({ ctx, page } = await open('m', { avail: true }));
  await page.addInitScript(() => { if (!sessionStorage.getItem('__k')) { sessionStorage.setItem('__k', '1'); localStorage.setItem('lp-bio', '1'); } });
  await page.goto(H.ORIGIN + '/?emu=1'); await wait(page, 1000); s = await vis(page);
  check('13 lp-bio בלי חיבור שמור: אין נעילה, המפתח נמחק, ומסך הכניסה גלוי', !s.cls && !s.lock && !s.key && await page.evaluate(() => !!document.getElementById('gform')), s);
  await ctx.close();

  // ---------- אין חומרה / עובד: אין מתג ----------
  ({ ctx, page } = await open('m', { avail: false }));
  await H.login(page, 'm@x.co'); await settings(page);
  check('14 מכשיר בלי נעילת מסך מאובטחת: המתג לא ב-DOM', await page.evaluate(() => !document.querySelector('[data-a=bioTog]') && !/טביעת אצבע/.test(document.getElementById('main').innerText)), null);
  await ctx.close();
  ({ ctx, page } = await open('w', { avail: true }));
  await H.login(page, 'w@x.co'); await wait(page, 600);
  const wk = await page.evaluate(() => ({ role: SY.role, bio: !!document.querySelector('[data-a=bioTog]'), txt: /טביעת אצבע/.test(document.body.innerText), avail: BIO.av }));
  check('15 עובד: אין מתג טביעת אצבע (וגם לא נבדקת חומרה)', wk.role === 'worker' && !wk.bio && !wk.txt && wk.avail === 0, wk);
  await ctx.close();

  await browser.close();
  fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
  console.log(fail ? `תוצאה: נכשל (${fail})` : 'תוצאה: הכול עבר'); process.exit(fail ? 1 : 0);
  async function shot(p, name, full) { if (shots) await p.screenshot({ path: path.join(shots, name + '.png'), fullPage: !!full }); }
})().catch((e) => { console.error(e); process.exit(1); });
