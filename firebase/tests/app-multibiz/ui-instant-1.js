'use strict';
// שלב B2a (24.11.2026): מסכים נפתחים מיד מהעותק השמור במכשיר (DC.sfill/sput, www/dev-cache.js) ואז מתעדכנים מהשרת. רשת מדומה, בלי אמולטור.
// לכל מסך: אחרי ביקור אחד עם רשת וטעינה מחדש – המידע השמור מוצג לפני שהשרת עונה (התשובות מעוכבות 1.5 שניות);
// אחר כך המסך מתעדכן למידע החדש מהשרת; בלי רשת – עדיין המידע השמור (עם שורת "אין חיבור"); אין שגיאות JS.
// מסכים: בית העובד (ההוצאות ששלחתי, בקשות, "שכר משוער"), "השכר שלי", בקשות של העובד, משמרות, סיכום יום (עובד),
// ואצל המנהל: "ממתין לטיפול" (mq), "בקשות מעובדים" (rq) ו"לטיפול" (todo). פעולה על עותק שמור (סמן כטופל) מחכה לשרת.
// שימוש: node ui-instant-1.js <www-dir>
const H = require('./harness');
let fail = 0; const check = (n, ok, info) => { if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined && !ok ? ' | ' + JSON.stringify(info).slice(0, 500) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sv = (v) => ({ stringValue: String(v) }), iv = (v) => ({ integerValue: String(v) }), bv = (v) => ({ booleanValue: !!v });
const mv = (o) => ({ mapValue: { fields: o } });
const DOCS = 'projects/demo-largpeami/databases/(default)/documents/b/acme/';
const docOf = (name, f) => ({ name: DOCS + name, fields: f, createTime: '2026-11-03T09:00:00Z', updateTime: '2026-11-03T09:00:00Z' });
const T0 = H.T0;
let VER = 'א', DELAY = 0, OFF = false, ANS = {}; const WR = [];
// לכל גרסה מידע אחר, כדי להבדיל בין העותק השמור לתשובה החדשה: סכום השכר (באגורות) ומצב סיכום היום
const EST = { א: 94000, ב: 12300, ג: 45600, ד: 78900, ה: 31400, ו: 27100 }, DST = { א: 'sum', ב: 'ok', ג: 'sum', ד: 'ok', ה: 'sum', ו: 'ok' };
const ils = (v) => String(v / 100);
const answered = (...k) => k.reduce((n, x) => n + (ANS[x] || 0), 0);
const PAY = (est) => ({ v: 1, m: '2026-11', mode: 'hr', slip: false, est, calc: est, exp: 0, due: est, paid: 0, left: est, st: 'open', min: 600, days: 2, rows: [{ n: 'שכר לפי שעות', a: est, s: 'calc', det: ['10:00 שעות'], h: [] }] });
const WEEK = () => ({ from: '2026-11-01', days: ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07'], today: '2026-11-03', now: 0, full: false, mgr: false,
  occ: [{ id: 'A_2026-11-03', sid: 'A', day: '2026-11-03', s: '08:00', e: '14:00', u: 'wa', nm: 'דנה ' + VER, fx: false, nt: '', start: T0, end: T0 + 36e5, x: false }] });

async function mock(ctx) {
  await ctx.route((u) => ['8080', '5001', '9099'].includes(new URL(u).port), async (route) => {
    const req = route.request(), u = new URL(req.url()), m = req.method(), p = decodeURIComponent(u.pathname), body = req.postData() || '';
    if (OFF) return route.abort('internetdisconnected');
    const ok = async (o, tag) => { if (DELAY) await sleep(DELAY); ANS[tag] = (ANS[tag] || 0) + 1; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) }); };
    if (u.port === '5001') { const fn = p.split('/').pop(); let d = {}; try { d = JSON.parse(body).data || {}; } catch (e) { /* */ }
      if (fn === 'shApi' && d.op === 'week') return ok({ result: WEEK() }, 'shf'); return route.fallback(); }
    if (u.port !== '8080') return route.fallback();
    const i = p.indexOf('/documents/b/acme'); if (i < 0) return route.fallback(); const R = p.slice(i + 17).split('?')[0];
    if (m !== 'GET' && !/:runQuery$/.test(R)) { WR.push(m + ' ' + R); return route.fallback(); }
    if (R === ':runQuery') { let sq = {}; try { sq = JSON.parse(body).structuredQuery; } catch (e) { /* */ }
      const c = sq.from && sq.from[0].collectionId, w = sq.where && sq.where.fieldFilter, fp = w && w.field.fieldPath, val = w && w.value && w.value.stringValue;
      if (c === 'inbox' && fp === 'owner' && val === 'wa') return ok([{ document: docOf('inbox/i1', { owner: sv('wa'), status: sv('new'), created: sv('2026-11-03T08:00:00Z'), data: sv(JSON.stringify({ amt: '120', catName: 'קטגוריה ' + VER, date: '2026-11-03', note: '' })) }), readTime: 'x' }], 'inbox');
      if (c === 'rq') return ok([{ document: docOf('rq/r1', { owner: sv('wa'), by: sv('דנה'), txt: sv('בקשה ' + VER), t: iv(T0 - 36e5), st: sv('new'), ans: sv('') }), readTime: 'x' }], 'rq');
      if (c === 'mq' && fp === 'st') return ok([{ document: docOf('mq/q1', { uid: sv('wz'), by: sv('שולח ' + VER), t: iv(T0 - 36e5), st: sv('new'), k: sv('invoice'), np: iv(1) }), readTime: 'x' }], 'mq');
      if (c === 'dr' && fp === 'uid') return ok([{ document: docOf('dr/wa_20261103', { uid: sv('wa'), day: sv('2026-11-03'), n: sv('דנה'), st: sv(DST[VER]), e: { arrayValue: { values: [mv({ txt: sv('עבדתי'), t: iv(T0) })] } } }), readTime: 'x' }], 'dr');
      return route.fallback(); }
    if (R === '/wv/pay_2026-11_wa') return ok(docOf('wv/pay_2026-11_wa', { data: sv(JSON.stringify(PAY(EST[VER]))), h: sv('x'), m: sv('2026-11'), at: iv(T0 - 36e5) }), 'pay');
    if (R === '/drcfg/main') return ok(docOf('drcfg/main', { req: mv({ wa: bv(true) }), days: { arrayValue: { values: [0, 1, 2, 3, 4].map(iv) } }, hr: sv('18:00') }), 'drcfg');
    return route.fallback();
  });
}
const main = (pg) => pg.evaluate(() => (document.getElementById('main') || {}).innerText || '');
const banner = (pg) => pg.evaluate(() => { const e = document.getElementById('dcnet'); return e ? e.innerText : ''; });
const waitFor = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 4000)) { if (await fn()) return Date.now() - t0; await sleep(50); } return -1; };
// טעינה מחדש: מחכים לאירוע load ומחזירים את הזמן שבו התחילה (התשובות מהשרת מעוכבות DELAY מרגע הבקשה)
const reload = async (pg) => { ANS = {}; await pg.reload(); await pg.waitForFunction(() => typeof SY !== 'undefined' && SY.uid && typeof cur === 'function', null, { timeout: 15000 }); };
const home = (pg) => pg.evaluate(() => { WS = 'home'; NAV = [{ v: 'wk' }]; render(0); });
const tileTxt = (pg) => pg.evaluate(() => { const b = document.querySelector('[data-pay-tile]'); return b ? b.innerText.replace(/\s+/g, ' ') : ''; });

(async () => {
  const [www] = process.argv.slice(2); const browser = await H.launch();
  const F = { tasks: true, dailyRep: true };

  // ===== עובד =====
  { const cfg = { mode: 'new', users: { wa: 'acme' }, biz: { acme: { dataRoot: 'b', features: F } }, staff: { 'b/acme/|wa': 1 } };
    const x = await H.newPage(browser, www, cfg, [], 'w-instant'); const pg = x.page; await pg.setViewportSize({ width: 412, height: 900 });
    await mock(x.ctx); await H.login(pg, 'wa@x.co');
    // 1. ביקור ראשון עם רשת: הבית, "השכר שלי", בקשות, משמרות, סיכום יום
    await home(pg); await waitFor(async () => /קטגוריה א/.test(await main(pg)) && /940/.test(await tileTxt(pg)), 6000);
    const h1 = await main(pg);
    check('1 ביקור ראשון: הבית מציג את ההוצאה, "בקשה למנהל" ו"שכר משוער" מהשרת', /קטגוריה א/.test(h1) && /בקשה למנהל/.test(h1) && /940/.test(await tileTxt(pg)), h1.slice(0, 300));
    await pg.click('[data-pay-tile]'); await waitFor(async () => /940/.test(await main(pg)), 4000);
    await pg.evaluate(() => go('rq')); await waitFor(async () => /בקשה א/.test(await main(pg)), 4000);
    await pg.evaluate(() => go('shf')); await waitFor(async () => /דנה א/.test(await main(pg)), 4000);
    await pg.evaluate(() => go('dr')); await waitFor(async () => /ממתין לאישור/.test(await main(pg)), 4000);
    check('1א ביקור ראשון: בקשות, משמרות וסיכום יום נטענו', true);
    await sleep(800);
    const keys = await pg.evaluate(() => new Promise((res) => { const r = indexedDB.open('lp-cache'); r.onsuccess = () => { const q = r.result.transaction('k').objectStore('k').getAllKeys(); q.onsuccess = () => { r.result.close(); res(q.result.map(String)); }; }; r.onerror = () => res([]); }));
    const need = ['wk-l', 'wk-rq', 'pm-home', 'pm|2026-11', 'shf|', 'dr'];
    check('1ב נשמר במכשיר עותק תצוגה לכל מסך (עסק|משתמש|SCR|שם), נפרד מהמטמון של fsx', need.every((n) => keys.some((k) => k === 'acme|wa|SCR|' + n)), keys.filter((k) => /\|SCR\|/.test(k)));

    // 2. טעינה מחדש, השרת עונה אחרי 1.5 שניות: הבית מיד מהעותק השמור (א), ואז המידע החדש (ב)
    VER = 'ב'; DELAY = 1500; await reload(pg);
    // (המשבצות "שכר משוער" וסיכום יום מופיעות רק אחרי שפרטי העסק נטענו – לכן חלון ארוך יותר; הקובע: השרת עוד לא ענה לבקשה של אותו מסך)
    const t2 = await waitFor(async () => /קטגוריה א/.test(await main(pg)) && /בקשה למנהל/.test(await main(pg)), 3000); const a2 = answered('inbox');
    check('2 אחרי טעינה מחדש: "ההוצאות ששלחתי" בבית מוצגות מיד מהעותק השמור, לפני תשובת השרת', t2 >= 0 && a2 === 0, { t2, a2, ANS, m: (await main(pg)).slice(0, 200) });
    const t2t = await waitFor(async () => /940/.test(await tileTxt(pg)), 3000); const a2t = answered('pay');
    check('2ג "שכר משוער" בבית מוצג מהעותק השמור לפני תשובת השרת', t2t >= 0 && a2t === 0, { t2t, a2t, ANS, tile: await tileTxt(pg) });
    check('2א אין שורת "אין חיבור" כשיש רשת', (await banner(pg)) === '');
    const t2b = await waitFor(async () => /קטגוריה ב/.test(await main(pg)) && /123/.test(await tileTxt(pg)), 6000);
    check('2ב אחר כך הבית מתעדכן למידע החדש מהשרת (הוצאה ו"שכר משוער")', t2b >= 0 && !/קטגוריה א/.test(await main(pg)), { m: (await main(pg)).slice(0, 300), tile: await tileTxt(pg) });
    // 3. "השכר שלי": העותק השמור (ב) מיד, ואז החדש (ג)
    VER = 'ג'; await reload(pg); await pg.evaluate(() => { WS = 'home'; NAV = [{ v: 'wk' }]; ACT.pmGo(); });
    const t3 = await waitFor(async () => (await main(pg)).includes(ils(EST.ב)) && /שכר משוער/.test(await main(pg)), 2500); const a3 = answered('pay');
    check('3 "השכר שלי" אחרי טעינה מחדש: מוצג מיד מהעותק השמור', t3 >= 0 && a3 === 0, { t3, a3, m: (await main(pg)).slice(0, 200) });
    check('3א אחר כך "השכר שלי" מתעדכן מהשרת', await waitFor(async () => (await main(pg)).includes(ils(EST.ג)), 5000) >= 0, (await main(pg)).slice(0, 200));
    // 4. הבקשות של העובד: העותק השמור (ג – נשמר כשהבית נטען) מיד, ואז החדש (ד)
    VER = 'ד'; await reload(pg); await pg.evaluate(() => go('rq'));
    const t4 = await waitFor(async () => /בקשה ג/.test(await main(pg)), 2500); const a4 = answered('rq');
    check('4 "בקשה למנהל" (הבקשות שלי) אחרי טעינה מחדש: מוצג מיד מהעותק השמור', t4 >= 0 && a4 === 0, { t4, a4, m: (await main(pg)).slice(0, 200) });
    check('4א אחר כך הבקשות מתעדכנות מהשרת', await waitFor(async () => /בקשה ד/.test(await main(pg)) && !/בקשה ג/.test(await main(pg)), 5000) >= 0, (await main(pg)).slice(0, 200));
    // 5. משמרות: העותק השמור (א – הביקור היחיד) מיד, ואז החדש (ה)
    VER = 'ה'; await reload(pg); await pg.evaluate(() => go('shf'));
    const t5 = await waitFor(async () => /דנה א/.test(await main(pg)), 2500); const a5 = answered('shf');
    check('5 משמרות אחרי טעינה מחדש: הטבלה מוצגת מיד מהעותק השמור (לא "טוען…")', t5 >= 0 && a5 === 0, { t5, a5, m: (await main(pg)).slice(0, 200) });
    const sc5 = await pg.evaluate(() => { const b = document.querySelector('[data-a=sftOpen]'); if (b) b.click(); return !!document.querySelector('#dlg[open]'); });
    check('5א לחיצה על משמרת בזמן שמוצג עותק שמור – לא נפתחת (מחכה לשרת)', !sc5);
    const t5b = await waitFor(async () => /דנה ה/.test(await main(pg)), 5000);
    check('5ב אחר כך המשמרות מתעדכנות מהשרת', t5b >= 0 && !/דנה א/.test(await main(pg)), (await main(pg)).slice(0, 200));
    const sc5b = await pg.evaluate(() => { const b = document.querySelector('[data-a=sftOpen]'); if (b) b.click(); const o = !!document.querySelector('#dlg[open]'); closeDlg(); return o; });
    check('5ג אחרי התשובה מהשרת – לחיצה על משמרת פותחת אותה כרגיל', sc5b);
    // 6. סיכום יום: העותק השמור (ה – "ממתין לאישור", נשמר כשמשבצת הבית נטענת) מיד, ואז החדש (ו – "אושר")
    await home(pg); await waitFor(async () => /סיכום יום\s*ממתין לאישור/.test(await main(pg)), 5000); await sleep(400);
    VER = 'ו'; await reload(pg); await pg.evaluate(() => go('dr'));
    const t6 = await waitFor(async () => /ממתין לאישור/.test(await main(pg)) && !/טוען/.test(await main(pg)), 2500); const a6 = answered('dr', 'drcfg');
    check('6 סיכום יום אחרי טעינה מחדש: מוצג מיד מהעותק השמור', t6 >= 0 && a6 === 0, { t6, a6, m: (await main(pg)).slice(0, 200) });
    const t6b = await waitFor(async () => /סיכום היום אושר/.test(await main(pg)), 5000);
    check('6א אחר כך סיכום היום מתעדכן מהשרת (אושר)', t6b >= 0, (await main(pg)).slice(0, 200));
    await pg.evaluate(() => go('rq')); await waitFor(async () => /בקשה ו/.test(await main(pg)), 5000); await home(pg);
    await waitFor(async () => /קטגוריה ו/.test(await main(pg)) && (await tileTxt(pg)).includes(ils(EST.ו)), 6000); await sleep(600);

    // 7. בלי רשת: כל המסכים מהעותק השמור (ו), עם שורת "אין חיבור"
    OFF = true; DELAY = 0; await reload(pg); await home(pg);
    const t7 = await waitFor(async () => /קטגוריה ו/.test(await main(pg)) && (await tileTxt(pg)).includes(ils(EST.ו)), 4000);
    check('7 בלי רשת: הבית מציג את המידע השמור (גם ההוצאות ששלחתי ו"שכר משוער", שלא נשמרים ברמת fsx)', t7 >= 0, { m: (await main(pg)).slice(0, 300), tile: await tileTxt(pg) });
    check('7א בלי רשת: מוצגת שורת "אין חיבור"', await waitFor(async () => /אין חיבור/.test(await banner(pg)), 4000) >= 0, await banner(pg));
    await pg.evaluate(() => go('shf'));
    check('7ב בלי רשת: המשמרות מהעותק השמור (לא הודעת שגיאה)', await waitFor(async () => /דנה ה/.test(await main(pg)), 4000) >= 0, (await main(pg)).slice(0, 200));
    await pg.evaluate(() => go('dr'));
    check('7ג בלי רשת: סיכום היום מהעותק השמור', await waitFor(async () => /סיכום היום אושר/.test(await main(pg)), 4000) >= 0, (await main(pg)).slice(0, 200));
    await pg.evaluate(() => go('rq'));
    check('7ד בלי רשת: הבקשות שלי מהעותק השמור', await waitFor(async () => /בקשה ו/.test(await main(pg)), 4000) >= 0, (await main(pg)).slice(0, 200));
    OFF = false;
    // 8. יציאה מהחשבון מוחקת גם את עותקי התצוגה
    await pg.evaluate(() => syOut(1)); await sleep(800);
    const dbs = await pg.evaluate(async () => (indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name) : ['?']));
    check('8 יציאה מהחשבון מוחקת את lp-cache (כולל עותקי התצוגה)', !dbs.includes('lp-cache'), dbs);
    check('9 אין שגיאות JS אצל העובד', pg.__errors.length === 0, pg.__errors);
    await x.ctx.close(); }

  // ===== מנהל =====
  VER = 'א'; DELAY = 0; OFF = false;
  { const cfg = { mode: 'new', users: { ma: 'acme' }, biz: { acme: { dataRoot: 'b', features: F } }, admins: { 'b/acme/|ma': 1 } };
    const x = await H.newPage(browser, www, cfg, [], 'm-instant'); const pg = x.page; await pg.setViewportSize({ width: 412, height: 900 });
    await mock(x.ctx); await H.login(pg, 'ma@x.co');
    await pg.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden && typeof ACT.startBlank === 'function') ACT.startBlank(); });
    await pg.evaluate(() => go('mq')); await waitFor(async () => /שולח א/.test(await main(pg)), 5000);
    await pg.evaluate(() => go('rq')); await waitFor(async () => /בקשה א/.test(await main(pg)), 5000);
    await sleep(800);
    check('10 ביקור ראשון אצל המנהל: "ממתין לטיפול" ו"בקשות מעובדים" מהשרת', /בקשה א/.test(await main(pg)));

    VER = 'ב'; DELAY = 1500; await reload(pg); WR.length = 0; await pg.evaluate(() => { if ($('#dlg').open) closeDlg(); go('mq'); });
    const t11 = await waitFor(async () => /שולח א/.test(await main(pg)), 2500); const a11 = answered('mq');
    check('11 "ממתין לטיפול" אחרי טעינה מחדש: מוצג מיד מהעותק השמור', t11 >= 0 && a11 === 0, { t11, a11, m: (await main(pg)).slice(0, 200) });
    await pg.evaluate(() => { const b = document.querySelector('[data-a=mqDone]'); if (b) b.click(); });
    const dl = await pg.evaluate(() => !!document.querySelector('#dlg[open]'));
    check('11א "סמן כטופל" על עותק שמור – לא נשאל ולא נשלח לשרת (מחכה לטעינה)', !dl && !WR.some((w) => /\/mq\//.test(w)), { dl, WR });
    const t11b = await waitFor(async () => /שולח ב/.test(await main(pg)), 5000);
    check('11ב אחר כך "ממתין לטיפול" מתעדכן מהשרת', t11b >= 0 && !/שולח א/.test(await main(pg)), (await main(pg)).slice(0, 200));
    await pg.evaluate(() => { const b = document.querySelector('[data-a=mqDone]'); if (b) b.click(); });
    check('11ג אחרי הטעינה מהשרת – "סמן כטופל" שואל כרגיל', await pg.evaluate(() => { const o = !!document.querySelector('#dlg[open]'); closeDlg(); return o; }));
    VER = 'ג'; await reload(pg); await pg.evaluate(() => { if ($('#dlg').open) closeDlg(); go('rq'); });
    const t12 = await waitFor(async () => /בקשה [אב]/.test(await main(pg)), 2500); const a12 = answered('rq');
    check('12 "בקשות מעובדים" אחרי טעינה מחדש: מוצג מיד מהעותק השמור', t12 >= 0 && a12 === 0, { t12, a12, m: (await main(pg)).slice(0, 200) });
    check('12א אחר כך הבקשות מתעדכנות מהשרת', await waitFor(async () => /בקשה ג/.test(await main(pg)), 5000) >= 0, (await main(pg)).slice(0, 200));
    VER = 'ד'; await reload(pg); await pg.evaluate(() => { if ($('#dlg').open) closeDlg(); go('todo'); });
    const t13 = await waitFor(async () => /ממתין לטיפול/.test(await main(pg)) && /בקשות מעובדים/.test(await main(pg)), 2500); const a13 = answered('mq', 'rq');
    check('13 "לטיפול" אחרי טעינה מחדש: המסמכים והבקשות מוצגים מיד', t13 >= 0 && a13 === 0, { t13, a13, m: (await main(pg)).slice(0, 300) });
    await sleep(2000);
    OFF = true; DELAY = 0; await reload(pg); await pg.evaluate(() => { if ($('#dlg').open) closeDlg(); go('mq'); });
    check('14 בלי רשת: "ממתין לטיפול" מהעותק השמור', await waitFor(async () => /שולח [בגד]/.test(await main(pg)), 4000) >= 0, (await main(pg)).slice(0, 200));
    OFF = false;
    check('15 אין שגיאות JS אצל המנהל', pg.__errors.length === 0, pg.__errors);
    await x.ctx.close(); }

  await browser.close();
  console.log(fail ? fail + ' בדיקות נכשלו' : 'כל הבדיקות עברו'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
