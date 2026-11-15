'use strict';
// מסך ניהול העסקים של מנהל־על (15.11.2026), ברשת מדומה (harness): מנהל־על לא "הוא" לארג' פעמי.
// בודק: מנהל־על בלי users – רק רשימת העסקים ("ניהול עסקים"), בלי בקשה לנתוני עסק; מנהל־על עם users/admins של לארג' פעמי – גם כן מסך ניהול;
// כניסה ללארג' פעמי כשאין מסמך b/largpeami (logBusinessEntry מחזיר no-biz) – נכנסים ורואים נתונים; פתיחה מחדש – העסק האחרון;
// "חזרה לניהול" בכפתור הצף; מפתחות לארג' פעמי במכשיר לא משתנים; עובד/מנהל של לארג' פעמי נכנסים ישר; אין בניית אפליקציה ממותגת ללארג' פעמי.
// שימוש: node ui-mgmt.js <www-dir> <out.json> [shots-dir]
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const BZ0 = ['larg', 'peami'].join('');
const out = {}; let fail = 0;
const check = (name, ok, info) => { out[name] = { ok: !!ok, info }; if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const S = (v) => ({ stringValue: v });
const NAME = 'projects/demo-largpeami/databases/(default)/documents/';
// בקשה שמותרת במסך הניהול: קריאות זיהוי, רשימת העסקים ו-private/info (השורש). כל השאר = נתוני עסק
const okMg = (r) => { if (!r.url.includes(':8080')) return !/:(5001|9199)\//.test(r.url); const p = decodeURIComponent(new URL(r.url).pathname.split('/documents')[1] || ''); return r.method === 'GET' && (/^\/(users|superadmins)\/[^/]+$/.test(p) || /^\/b$/.test(p) || /^\/b\/[^/]+$/.test(p) || /^\/b\/[^/]+\/private\/info$/.test(p)); };

(async () => {
  const [www, outFile, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const browser = await H.launch();
  const shot = async (page, name) => { if (shots) await page.screenshot({ path: path.join(shots, name + '.png') }); };
  const until = async (fn, ms) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn().catch(() => false)) return true; await new Promise((r) => setTimeout(r, 250)); } return false; };
  // רשימת העסקים (GET /b?pageSize) ו-logBusinessEntry: תשובות מדומות בדף (קודמות לניתוב של harness). noBiz: לארג' פעמי בלי מסמך – השרת מחזיר no-biz
  const routes = async (page, cfg, log, noBiz) => {
    await page.route((u) => u.port === '8080' && /\/documents\/b$/.test(u.pathname), (route) => {
      log.push({ who: 'list', step: page.__step, gen: page.__gen, method: route.request().method(), url: route.request().url(), body: '' });
      const docs = Object.entries(cfg.biz || {}).map(([id, d]) => ({ name: NAME + 'b/' + id, fields: { name: S(d.name || id), status: S('active'), dataRoot: S(d.dataRoot), features: { mapValue: { fields: {} } } } }));
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ documents: docs }) });
    });
    await page.route((u) => u.port === '5001' && /logBusinessEntry/.test(u.pathname), (route) => {
      log.push({ who: 'fn', step: page.__step, gen: page.__gen, method: 'POST', url: route.request().url(), body: route.request().postData() || '' });
      let id = ''; try { id = JSON.parse(route.request().postData()).data.bizId; } catch (e) { /* */ }
      if (noBiz && id === BZ0) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { status: 'NOT_FOUND', message: 'העסק לא נמצא', details: { reason: 'no-biz' } } }) });
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { ok: true, bizId: id } }) });
    });
  };
  const open = async (cfg, email, label, noBiz) => {
    const log = []; const { ctx, page } = await H.newPage(browser, www, cfg, log, label);
    await page.setViewportSize({ width: 360, height: 740 });
    await routes(page, cfg, log, noBiz);
    await H.login(page, email, { mg: true });
    return { ctx, page, log };
  };
  const mgState = (page) => page.evaluate(() => ({ mg: SY.mg, bizId: SY.bizId || '', BZP, v: cur().v, ttl: document.getElementById('ttl').innerText, bar: getComputedStyle(document.querySelector('.bar')).display, set: getComputedStyle(document.querySelector('header [aria-label="הגדרות"]')).display, fab: !!document.getElementById('safab'), rows: [...document.querySelectorAll('#admL .li')].map((r) => r.dataset.arg), sheet: !document.getElementById('sheet').hidden, gate: !!document.getElementById('gate'), out: !!document.querySelector('#main [data-a=syOut]') }));
  const lpKeys = (page) => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((k) => !k.includes(':') && !['lp-sync', 'lp-trust'].includes(k)).sort().map((k) => [k, localStorage.getItem(k)])));

  // ---------- 1. מנהל־על בלי users, בלי מסמך b/largpeami ----------
  {
    const cfg = { mode: 'new', sa: { sa: 1 }, biz: { acme: { dataRoot: 'b', name: 'אקמה' } } };
    const { ctx, page, log } = await open(cfg, 'sa@x.co', 'sa', true);
    await until(() => page.evaluate(() => document.querySelectorAll('#admL .li').length >= 2), 10000);
    let st = await mgState(page);
    check('1 מנהל־על בלי users: מסך "ניהול עסקים" בלבד (רשימת העסקים, כולל לארג\' פעמי), בלי סרגל תחתון, בלי הגדרות עסק ובלי כפתור צף, עם התנתקות',
      st.mg === 1 && !st.bizId && st.BZP === '_sa:' && st.v === 'sa' && st.ttl.includes('ניהול עסקים') && st.bar === 'none' && st.set === 'none' && !st.fab && st.rows.includes('acme') && st.rows.includes(BZ0) && !st.sheet && !st.gate && st.out, st);
    await shot(page, '01-ניהול-עסקים-360');
    const dr = await page.evaluate(() => [...document.querySelectorAll('#admL .li')].map((r) => { const b = r.querySelector('[data-a=admEnter]'); const R = b && b.getBoundingClientRect(); return { id: r.dataset.arg, btn: !!b, ok: !!R && R.right <= innerWidth && R.left >= 0 }; }));
    check('1א כפתור "כניסה" ישיר בכל שורה ברשימת העסקים (גם ללארג\' פעמי בלי מסמך), בתוך רוחב 360', dr.length >= 2 && dr.every((x) => x.btn && x.ok), dr);
    // אירועי רקע של מנהל (חזרה לאפליקציה, חיבור, גיבוי אוטומטי, משיכת הודעות) – במסך הניהול לא יוצאת מהם שום בקשה
    page.__step = 'bg';
    await page.evaluate(async () => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('online')); try { abkTick(); } catch (e) { /* */ } try { bkAuto(); } catch (e) { /* */ } try { await inbTick(1); } catch (e) { /* */ } try { await bkCloud(false); } catch (e) { /* */ } });
    await H.settle(page, 7000);
    const bad = log.filter((r) => !okMg(r));
    check('2 במסך הניהול אין אף בקשה לנתוני עסק, לגיבוי (Storage) או לפונקציות שרת – רק זיהוי ורשימת העסקים, גם אחרי אירועי רקע', bad.length === 0 && log.some((r) => r.who === 'list'), bad.map((r) => r.method + ' ' + r.url.slice(0, 140)));
    const blk = await page.evaluate(async () => { const r = []; for (const [p, o] of [['/inbox', 0], [':commit', { method: 'POST', body: '{}' }], ['/admins/x', 0]]) { try { await fsx(p, o); r.push('עבר'); } catch (e) { r.push(e.mg ? 'נחסם' : String(e.message)); } } return r; });
    check('3 fsx לנתוני עסק במסך הניהול נחסם בקוד (inbox, :commit, admins)', blk.every((x) => x === 'נחסם'), blk);
    const k0 = await page.evaluate(() => Object.keys(localStorage).filter((k) => !k.startsWith('_sa:') && !['lp-sync', 'lp-trust'].includes(k)));
    check('4 במסך הניהול לא נוצרו מפתחות במכשיר מחוץ לתחילית _sa:', k0.length === 0, k0);
    // כניסה ללארג' פעמי (אין מסמך – no-biz) מכרטיס העסק
    page.__step = 'enter';
    await page.click(`#admL [data-arg=${BZ0}]`);
    await until(() => page.evaluate(() => !!document.querySelector('#main [data-a=admEnter]')), 8000);
    const g = page.__gen;
    await page.click('#main [data-a=admEnter]');
    await until(async () => page.__gen > g, 15000); await H.settle(page, 3000);
    await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden && ACT.startBlank) ACT.startBlank(); });
    st = await page.evaluate(() => ({ mg: !!SY.mg, bizId: SY.bizId, BZP, role: SY.role, bar: getComputedStyle(document.querySelector('.bar')).display }));
    const data = log.filter((r) => r.step === 'enter' && r.gen > g && r.url.includes(':8080') && !okMg(r));
    check('5 כניסה ללארג\' פעמי כשמסמך העסק חסר (logBusinessEntry: no-biz): נכנסים כמנהל, בלי תחילית, ונטענים נתונים', !st.mg && st.bizId === BZ0 && st.BZP === '' && st.role === 'admin' && st.bar !== 'none' && data.length > 0 && log.some((r) => r.who === 'fn' && r.step === 'enter'), { st, data: data.length });
    const MK = 'LP-MARK-515';
    await page.evaluate((mk) => { const sb = S.subs.find((x) => (S.cats.find((c) => c.id === x.cat) || {}).kind === 'exp'); S.tx.push({ id: 'mk1', t: 'exp', cat: sb.cat, sub: sb.id, date: '2026-11-02', amt: 515, note: mk, pays: [] }); save(); }, MK);
    const fabOk = await until(() => page.evaluate(() => !!document.getElementById('safab')), 10000);
    check('6 בתוך לארג\' פעמי הכפתור הצף של מנהל־על מופיע', fabOk, null);
    // פתיחה מחדש: העסק האחרון
    page.__step = 'reopen';
    await page.goto(H.ORIGIN + '/?emu=1'); await H.settle(page, 3500);
    st = await page.evaluate((mk) => ({ mg: !!SY.mg, bizId: SY.bizId, BZP, v: cur().v, mark: JSON.stringify(S).includes(mk) }), MK);
    check('7 סגירה ופתיחה מחדש: נפתח העסק האחרון (לארג\' פעמי) עם הנתונים, לא מסך הניהול', !st.mg && st.bizId === BZ0 && st.BZP === '' && st.mark, st);
    // חזרה לניהול
    page.__step = 'back';
    await until(() => page.evaluate(() => !!document.getElementById('safab')), 10000);
    await page.click('#safab'); await until(() => page.evaluate(() => !!document.querySelector('#safabd [data-a=saMg]')), 8000);
    await shot(page, '02-כפתור-צף-חזרה-לניהול');
    const fabTxt = await page.evaluate(() => (document.querySelector('#safabd [data-a=saMg]') || {}).innerText || '');
    const keys1 = await lpKeys(page);
    const g2 = page.__gen;
    await page.click('#safabd [data-a=saMg]');
    await until(async () => page.__gen > g2, 15000); await H.settle(page, 2500);
    st = await mgState(page);
    const keys2 = await lpKeys(page);
    const bad2 = log.filter((r) => r.step === 'back' && r.gen > g2 && !okMg(r));
    check('8 "חזרה לניהול" בכפתור הצף: חוזרים למסך ניהול העסקים, בלי בקשות לנתוני עסק', fabTxt.includes('חזרה לניהול') && st.mg === 1 && st.BZP === '_sa:' && st.v === 'sa' && st.ttl.includes('ניהול עסקים') && !st.fab && bad2.length === 0, { fabTxt, st, bad: bad2.map((r) => r.url.slice(0, 120)) });
    check('9 מפתחות לארג\' פעמי במכשיר לא השתנו במעבר למסך הניהול (אותה תחילית ריקה)', JSON.stringify(keys1) === JSON.stringify(keys2) && (keys2['large-pami-v2'] || '').includes(MK), Object.keys(keys2).filter((k) => keys1[k] !== keys2[k]).concat(Object.keys(keys2)));
    page.__step = 'reopen2';
    await page.goto(H.ORIGIN + '/?emu=1'); await H.settle(page, 2500);
    st = await mgState(page);
    check('10 פתיחה מחדש אחרי "חזרה לניהול": מסך הניהול', st.mg === 1 && st.v === 'sa', st);
    check('11 אין שגיאות JS', page.__errors.length === 0, page.__errors);
    await ctx.close();
  }

  // ---------- 2. מנהל־על שיש לו גם users/admins של לארג' פעמי (מסמך b/largpeami במצב b) ----------
  {
    const cfg = { mode: 'new', sa: { sb: 1 }, users: { sb: BZ0 }, admins: { '|sb': 1, ['b/' + BZ0 + '/|sb']: 1 }, biz: { [BZ0]: { dataRoot: 'b', name: 'לארג׳ פעמי' }, acme: { dataRoot: 'b' } } };
    const { ctx, page, log } = await open(cfg, 'sb@x.co', 'sb');
    await until(() => page.evaluate(() => document.querySelectorAll('#admL .li').length >= 2), 10000);
    const st = await mgState(page);
    check('12 מנהל־על עם users של לארג\' פעמי: בכניסה הראשונה – מסך הניהול, לא לארג\' פעמי', st.mg === 1 && !st.bizId && st.v === 'sa' && st.BZP === '_sa:', st);
    const bad = log.filter((r) => !okMg(r));
    check('13 גם כאן אין בקשה לנתוני עסק', bad.length === 0, bad.map((r) => r.method + ' ' + r.url.slice(0, 140)));
    // כרטיס לארג' פעמי: אין בניית אפליקציה ממותגת; לעסק אחר יש
    await page.evaluate((b) => go('sab', b), BZ0); await H.settle(page, 800);
    const c0 = await page.evaluate(() => ({ build: !!document.querySelector('[data-a=apkBuild]'), enter: !!document.querySelector('#main [data-a=admEnter]'), txt: document.getElementById('main').innerText.includes('אין בנייה של אפליקציה נפרדת') }));
    page.__step = 'apk';
    await page.evaluate((b) => apkReq(b, true, true), BZ0); await H.settle(page, 500);
    const apkCalls = log.filter((r) => r.step === 'apk' && /requestBizApk/.test(r.url)).length;
    await page.evaluate(() => { NAV = [{ v: 'sa' }]; go('sab', 'acme'); }); await H.settle(page, 800);
    const c1 = await page.evaluate(() => !!document.querySelector('[data-a=apkBuild]'));
    check('14 לארג\' פעמי: אין כפתור בניית אפליקציה ממותגת ואין קריאה ל-requestBizApk; "כניסה כמנהל" קיים. בעסק אחר הכפתור נשאר', !c0.build && c0.enter && c0.txt && apkCalls === 0 && c1, { c0, apkCalls, c1 });
    check('15 אין שגיאות JS', page.__errors.length === 0, page.__errors);
    await ctx.close();
  }

  // ---------- 3. עובדים ומנהלים של לארג' פעמי נכנסים ישר ----------
  for (const [name, cfg, email, role, dr] of [
    ['מנהל legacy בלי users (חוקים ישנים)', { mode: 'old', admins: { '|m': 1 } }, 'm@x.co', 'admin', 'legacy'],
    ['מנהל legacy בלי users (חוקים חדשים)', { mode: 'new', admins: { '|m': 1 } }, 'm@x.co', 'admin', 'legacy'],
    ['עובד עם users של לארג\' פעמי (legacy)', { mode: 'new', users: { w: BZ0 }, staff: { '|w': 1 }, biz: { [BZ0]: { dataRoot: 'legacy' } } }, 'w@x.co', 'worker', 'legacy'],
    ['מנהל אחרי המעבר (dataRoot b)', { mode: 'new', users: { m: BZ0 }, admins: { ['b/' + BZ0 + '/|m']: 1 }, biz: { [BZ0]: { dataRoot: 'b' } } }, 'm@x.co', 'admin', 'b'],
    ['עובד אחרי המעבר (dataRoot b)', { mode: 'new', users: { w: BZ0 }, staff: { ['b/' + BZ0 + '/|w']: 1 }, biz: { [BZ0]: { dataRoot: 'b' } } }, 'w@x.co', 'worker', 'b'],
  ]) {
    const log = []; const { ctx, page } = await H.newPage(browser, www, cfg, log, email[0]);
    await H.login(page, email, { mg: true });
    const st = await page.evaluate(() => ({ mg: !!SY.mg, bizId: SY.bizId, role: SY.role, dr: SY.biz && SY.biz.dataRoot, BZP, gate: !!document.getElementById('gate') }));
    check('16 ' + name + ': נכנס ישר ללארג\' פעמי', !st.mg && st.bizId === BZ0 && st.role === role && st.dr === dr && st.BZP === '' && !st.gate && page.__errors.length === 0, Object.assign(st, { errors: page.__errors }));
    await ctx.close();
  }

  await browser.close();
  fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
  console.log(fail ? `תוצאה: נכשל (${fail})` : 'תוצאה: הכול עבר'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
