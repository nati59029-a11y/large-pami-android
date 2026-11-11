'use strict';
// הגעה מיידית (11.11.2026, החלטה 1): אצל מנהל, כשהאפליקציה גלויה – משיכה של inbox ו-mq כל 20 שניות, מיד בחזרה לאפליקציה,
// טיימר אחד בלבד, מנעול משותף עם pullInbox, בלי כפילויות, בלי הודעות שגיאה חוזרות בלי רשת, ובלי משיכות כבדות (מכירות אתר/סגירות/הפקדות).
// רשת מדומה (בלי אמולטור). בבדיקה הקצב מוקטן: 300ms במקום 20 שניות (אותו קוד, INB.ms), כך ש-900ms = "60 שניות".
// שימוש: node ui-inb-live.js <www-dir> [out.json]
const fs = require('fs'); const H = require('./harness');
const BZ0 = ['larg', 'peami'].join('');
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
let fail = 0; const res = []; const check = (n, ok, info) => { if (!ok) fail++; res.push({ n, ok: !!ok, info }); console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DOCS = 'projects/demo-largpeami/databases/(default)/documents/';
const S = (v) => ({ stringValue: v });

// מסלול runQuery מדומה: inbox (status=new) ו-mq (st=new). שאר השאילתות – לטיפול הרגיל של harness
async function mockQ(ctx) {
  const M = { inb: 0, mq: 0, inbox: [], mqL: [], fail: '', delay: 0 };
  await ctx.route((u) => /:runQuery$/.test(new URL(u).pathname), async (route) => {
    let q = {}; try { q = JSON.parse(route.request().postData()).structuredQuery || {}; } catch (e) { /* */ }
    const col = q.from && q.from[0] && q.from[0].collectionId; const f = q.where && q.where.fieldFilter;
    const isInb = col === 'inbox' && f && f.field.fieldPath === 'status' && f.value.stringValue === 'new';
    const isMq = col === 'mq' && f && f.field.fieldPath === 'st' && f.value.stringValue === 'new';
    if (!isInb && !isMq) return route.fallback();
    if (isInb) M.inb++; else M.mq++;
    if (M.delay) await sleep(M.delay);
    if (M.fail === 'abort') return route.abort('internetdisconnected');
    const L = isInb ? M.inbox.map((x) => ({ document: { name: DOCS + 'inbox/' + x.id, fields: { status: S('new'), by: S('עובד בדיקה'), owner: S('w'), created: S('2026-11-03T09:00:00Z'), data: S(JSON.stringify(x.data)) } } }))
      : M.mqL.map((x) => ({ document: { name: DOCS + 'mq/' + x.id, fields: { uid: S('w'), by: S('עובד בדיקה'), t: { integerValue: '1793700000000' }, st: S('new'), k: S('invoice'), np: { integerValue: '0' } } } }));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(L.length ? L : [{ readTime: '2026-11-03T09:00:00Z' }]) });
  });
  return M;
}
// מוני הודעות (toast) ושל המשיכות הכבדות
const spy = (page) => page.evaluate(() => {
  window.__T = []; new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.classList && n.classList.contains('toast')) window.__T.push(n.textContent); }))).observe(document.body, { childList: true });
  window.__H = { site: 0, zc: 0, dq: 0 };
  const w = (name, k) => { const o = window[name]; window[name] = async function () { window.__H[k]++; return o.apply(this, arguments); }; };
  w('pullSiteInc', 'site'); w('zcPull', 'zc'); w('dqPull', 'dq');
});
const fast = (page, ms) => page.evaluate((x) => { INB.ms = x; for (let i = 0; i < 5; i++) inbStart(); for (let i = 0; i < 3; i++) rerender(); }, ms);
const setHidden = (page, h) => page.evaluate((x) => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => x }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (x ? 'hidden' : 'visible') }); document.dispatchEvent(new Event('visibilitychange')); }, h);
const waitFor = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Date.now() - t0; await sleep(50); } return -1; };

(async () => {
  const [www, out] = process.argv.slice(2);
  const browser = await H.launch();
  const cfg = { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: ALL } }, admins: { '|m': 1 }, staff: { '|w': 1 } };

  // ---------- מנהל ----------
  const { ctx, page } = await H.newPage(browser, www, cfg, [], 'm'); await page.setViewportSize({ width: 360, height: 740 });
  const M = await mockQ(ctx);
  await H.login(page, 'm@x.co');
  const t0 = await waitFor(async () => M.inb > 0, 6000);
  check('1 מנהל: משיכה ראשונה מיד אחרי כניסה עם סיסמה', t0 >= 0, { t0, inb: M.inb });
  // פתיחה מחדש עם חיבור שמור (בלי סיסמה) – היום לא הייתה משיכה בכלל עד "בדוק עכשיו"
  M.inb = 0; await page.reload(); const t1 = await waitFor(async () => M.inb > 0, 6000);
  check('1ב פתיחה מחדש עם חיבור שמור: משיכה מעצמה תוך כמה שניות (בקוד: 3 שניות)', t1 >= 0 && t1 <= 5000 && M.inb === 1, { t1, inb: M.inb });
  const d0 = await page.evaluate(() => ({ ms: INB.ms }));
  check('1א בקוד (מה שירוץ בטלפון): כל 20 שניות', d0.ms === 20000, d0);
  await spy(page);

  // 2. טיימר אחד בלבד: 5 קריאות ל-inbStart + 3 ציורים, ואז "60 שניות" (900ms) – 3 משיכות, לא יותר מ-4
  await fast(page, 300); await sleep(100); M.inb = 0; M.mq = 0;
  await sleep(900);
  const c2 = { inb: M.inb, mq: M.mq };
  check('2 טיימר אחד: ב-"60 שניות" מדומות (900ms, קצב 300ms) – 3 משיכות בערך, לא יותר מ-4, גם אחרי 5 הפעלות ו-3 ציורים', c2.inb >= 2 && c2.inb <= 4 && c2.mq >= 2 && c2.mq <= 4, c2);
  const h2 = await page.evaluate(() => window.__H);
  check('3 pullSiteInc / zcPull / dqPull לא נקראות בקצב המהיר', h2.site === 0 && h2.zc === 0 && h2.dq === 0, h2);

  // 4. מוסתר – אין משיכה; חזרה – משיכה תוך 2 שניות
  await setHidden(page, true); await sleep(50); M.inb = 0; M.mq = 0;
  await sleep(3200);
  check('4 כשהאפליקציה מוסתרת (document.hidden) – אין משיכה', M.inb === 0 && M.mq === 0, { inb: M.inb, mq: M.mq });
  await page.evaluate(() => { INB.ms = 60000; inbStart(); }); // הטיימר לא יפריע למדידה
  await setHidden(page, false);
  const t4 = await waitFor(async () => M.inb > 0, 2500);
  check('5 חזרה לאפליקציה (visibilitychange) – משיכה תוך 2 שניות', t4 >= 0 && t4 <= 2000, { ms: t4 });

  // 6. מנעול: שתי קריאות בו־זמנית = משיכה אחת; גם מול pullInbox המלא
  M.delay = 300; M.inb = 0;
  await page.evaluate(() => Promise.all([inbTick(0), inbTick(0), inbTick(0)]));
  const c6a = M.inb; M.inb = 0;
  await page.evaluate(() => Promise.all([inbTick(0), pullInbox()]));
  const c6b = M.inb; M.delay = 0;
  check('6 מנעול: 3 קריאות בו־זמנית – משיכה אחת; משיכה מהירה + pullInbox המלא בו־זמנית – משיכה אחת', c6a === 1 && c6b === 1, { c6a, c6b });

  // 7. מסמך חדש: נכנס פעם אחת, המסך "לטיפול" מצטייר מחדש; אותו מסמך שוב – לא נכנס פעמיים ולא מצייר בלי צורך
  await page.evaluate(() => { go('todo'); });
  await sleep(200);
  M.inbox = [{ id: 'inbLive1', data: { type: 'exp', amt: 42, date: '2026-11-03', cat: '', note: 'בדיקת הגעה' } }];
  await page.evaluate(() => { const s = document.createElement('i'); s.id = 'sentinel'; document.getElementById('main').append(s); });
  const n7 = await page.evaluate(() => inbTick(0));
  const r7 = await page.evaluate(() => ({ cnt: S.inbox.filter((x) => x.id === 'inbLive1').length, redrawn: !document.getElementById('sentinel'), v: cur().v, txt: document.getElementById('main').innerText.includes('42') }));
  await page.evaluate(() => { const s = document.createElement('i'); s.id = 'sentinel'; document.getElementById('main').append(s); });
  const n7b = await page.evaluate(() => Promise.all([inbTick(0), inbTick(0)]).then(() => inbTick(0)));
  const r7b = await page.evaluate(() => ({ cnt: S.inbox.filter((x) => x.id === 'inbLive1').length, kept: !!document.getElementById('sentinel') }));
  check('7 מסמך חדש מעובד: נכנס ל-S.inbox פעם אחת, ו"לטיפול" מצטייר מחדש מעצמו', n7 === 1 && r7.cnt === 1 && r7.redrawn && r7.v === 'todo', { n7, r7 });
  check('7א אותו מסמך שוב (3 משיכות, 2 מהן בו־זמנית) – לא נכנס פעמיים, ואין ציור מחדש בלי שינוי', n7b === 0 && r7b.cnt === 1 && r7b.kept, { n7b, r7b });

  // 8. mq: פריט חדש נטען, ונכנס פעם אחת
  M.mqL = [{ id: 'mqLive1' }];
  await page.evaluate(() => inbTick(0)); await page.evaluate(() => inbTick(0));
  const r8 = await page.evaluate(() => MQ.L.filter((x) => x.id === 'mqLive1').length);
  check('8 mq: מסמך "ממתין לטיפול" חדש נטען במשיכה המהירה, פעם אחת', r8 === 1, { r8 });

  // 9. בלי רשת: אין ניסיון ואין הודעה; חזרת הרשת – משיכה מיד
  await page.evaluate(() => { INB.ms = 300; inbStart(); window.__T = []; });
  await ctx.setOffline(true); await sleep(50); M.inb = 0;
  await sleep(3200);
  const c9 = { inb: M.inb, toasts: await page.evaluate(() => window.__T.slice()) };
  check('9 בלי רשת (navigator.onLine=false): אין משיכה ואין הודעת שגיאה', c9.inb === 0 && c9.toasts.length === 0, c9);
  await page.evaluate(() => { INB.ms = 60000; inbStart(); });
  await ctx.setOffline(false);
  const t9 = await waitFor(async () => M.inb > 0, 2500);
  check('9א חזרת הרשת – משיכה תוך 2 שניות', t9 >= 0 && t9 <= 2000, { ms: t9 });

  // 10. שגיאת רשת כשהמכשיר "חושב" שיש רשת: בלי הודעות, ומרווח שגדל (פחות משיכות)
  await page.evaluate(() => { INB.ms = 300; inbStart(); window.__T = []; INB.f = 0; INB.sk = 0; });
  M.fail = 'abort'; M.inb = 0;
  await sleep(300 * 12 + 100);
  const c10 = { inb: M.inb, toasts: await page.evaluate(() => window.__T.slice()), f: await page.evaluate(() => INB.f) };
  check('10 שגיאה חוזרת: אין אף הודעת שגיאה, ומשיכות מתרווחות (פחות מ-6 ב-12 סבבים)', c10.toasts.length === 0 && c10.inb >= 2 && c10.inb < 6 && c10.f >= 2, c10);
  M.fail = '';
  await page.evaluate(() => { INB.at = -1e9; });
  const n10 = await page.evaluate(() => inbTick(1));
  const f10 = await page.evaluate(() => ({ f: INB.f, sk: INB.sk }));
  check('10א אחרי שהרשת חוזרת: חזרה מיד לקצב הרגיל', n10 === 0 && f10.f === 0 && f10.sk === 0, f10);
  await page.evaluate(() => { INB.ms = 60000; inbStart(); });

  // 11. "בדוק עכשיו" במסך סנכרון עדיין עובד (pullInbox המלא, כולל המשיכות הכבדות)
  const hb = await page.evaluate(() => Object.assign({}, window.__H));
  await page.evaluate(() => ACT.syPull()); await sleep(200);
  const ha = await page.evaluate(() => window.__H);
  check('11 "בדוק עכשיו" (pullInbox המלא) עדיין מושך גם מכירות אתר/סגירות/הפקדות', ha.site === hb.site + 1 && ha.zc === hb.zc + 1 && ha.dq === hb.dq + 1, { hb, ha });
  check('12 אין שגיאות JS (מנהל)', page.__errors.length === 0, page.__errors);
  await ctx.close();

  // ---------- עובד: אין משיכה בכלל ----------
  {
    const w = await H.newPage(browser, www, cfg, [], 'w'); const wp = w.page; await wp.setViewportSize({ width: 360, height: 740 });
    const MW = await mockQ(w.ctx);
    await H.login(wp, 'w@x.co'); await sleep(3500);
    const before = { inb: MW.inb, mq: MW.mq };
    await wp.evaluate(() => { INB.ms = 300; inbStart(); });
    await sleep(1000);
    await setHidden(wp, true); await sleep(100); await setHidden(wp, false); await sleep(800);
    const r = await wp.evaluate(() => inbTick(1));
    check('13 עובד: אין משיכה בכלל (לא בפתיחה, לא בטיימר, לא בחזרה לאפליקציה)', before.inb === 0 && MW.inb === 0 && MW.mq === 0 && r === 0, { before, inb: MW.inb, mq: MW.mq });
    check('14 אין שגיאות JS (עובד)', wp.__errors.length === 0, wp.__errors);
    await w.ctx.close();
  }

  await browser.close();
  if (out) fs.writeFileSync(out, JSON.stringify(res, null, 1));
  console.log(fail ? `נכשלו ${fail} מתוך ${res.length}` : `כל ${res.length} הבדיקות עברו`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
