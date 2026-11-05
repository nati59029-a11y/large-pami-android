'use strict';
// בדיקות (ג) עשן כמשתמש שכבר מחובר, (ד) מעבר מנהל־על בין עסקים, (ה) משתמש בלי עסק, (ו) עסק מושהה.
// node extra.js <www-dir> <out.json>
const fs = require('fs');
const H = require('./harness');
const BZ0 = ['larg', 'peami'].join('');
const out = {}; let fail = 0;
const check = (name, ok, info) => { out[name] = { ok: !!ok, info }; if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info ? ' | ' + JSON.stringify(info).slice(0, 300) : '')); };

(async () => {
  const [www, outFile] = process.argv.slice(2);
  const browser = await H.launch();
  const legacyCfg = { mode: 'old', admins: { '|m': 1 }, staff: { '|w': 1 } };

  // (ג) עשן: lp-sync שמור של עובד ושל מנהל, בלי bizId
  for (const [who, role] of [['w', 'worker'], ['m', 'admin']]) {
    for (const cfg of [legacyCfg, { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy' } }, admins: { '|m': 1 }, staff: { '|w': 1 } }]) {
      const log = []; const { ctx, page } = await H.newPage(browser, www, cfg, log, who);
      await page.addInitScript(([u, r, t]) => { if (!localStorage.getItem('lp-sync')) { localStorage.setItem('lp-sync', JSON.stringify({ idToken: 'tok-' + u, refresh: 'r-' + u, exp: t + 3600e3, uid: u, email: u + '@x.co', role: r })); if (r === 'admin') localStorage.setItem('large-pami-v2', JSON.stringify({ v: 2 })); } }, [who, role, H.T0]);
      await page.goto(H.ORIGIN + '/?emu=1'); await H.settle(page, 3000);
      const st = await page.evaluate(() => ({ gate: !!document.getElementById('gate'), text: document.body.innerText.length, sy: JSON.parse(localStorage.getItem('lp-sync')), keys: Object.keys(localStorage).sort() }));
      check(`ג עשן ${role} (${cfg.mode === 'old' ? 'חוקים ישנים' : 'מסמך עסק legacy'})`, page.__errors.length === 0 && !st.gate && st.text > 50 && st.sy.bizId === BZ0 && st.sy.biz.dataRoot === 'legacy' && st.keys.every((k) => !k.includes(':')),
        { errors: page.__errors, textLen: st.text, bizId: st.sy.bizId, dataRoot: st.sy.biz && st.sy.biz.dataRoot, keys: st.keys, firestore: log.filter((r) => r.url.includes(':8080')).map((r) => r.method + ' ' + r.url.split('/documents')[1]) });
      await ctx.close();
    }
  }

  // SMOKE_ONLY=1: רק בדיקות העשן (להשוואה מול main, שאין בו ריבוי עסקים)
  if (process.env.SMOKE_ONLY) { await browser.close(); fs.writeFileSync(outFile, JSON.stringify(out, null, 1)); return; }
  // (ד) מנהל־על: עסק א' (acme) → עסק ב' (beta) באותו דפדפן
  {
    const cfg = { mode: 'new', users: { sa: 'acme' }, sa: { sa: 1 }, biz: { acme: { dataRoot: 'b' }, beta: { dataRoot: 'b' } }, admins: { 'b/acme/|sa': 1, 'b/beta/|sa': 1 } };
    const log = []; const { ctx, page } = await H.newPage(browser, www, cfg, log, 'sa');
    await H.login(page, 'sa@x.co');
    const MK = 'סוד-של-אקמה-777';
    await page.evaluate((mk) => { if (!S.cats.length) S = ensure(defaults()); const sb = S.subs.find((x) => (S.cats.find((c) => c.id === x.cat) || {}).kind === 'exp'); S.tx.push({ id: 'mk1', t: 'exp', cat: sb.cat, sub: sb.id, date: '2026-11-02', amt: 777, note: mk, pays: [] }); S.cats.push({ id: 'mkc', kind: 'exp', name: mk, beh: 'simple' }); save(); try { localStorage.setItem(LK('lp-tasks'), JSON.stringify({ L: [{ id: 't1', txt: mk }] })); TK = { L: [{ id: 't1', txt: mk }] }; } catch (e) {} try { sheetClose(); } catch (e) {} NAV = [{ v: 'cat', a: 'mkc' }]; render(0); }, MK);
    await H.settle(page, 800);
    const a = await page.evaluate((mk) => ({ screen: document.body.innerText.includes(mk), bizId: SY.bizId, BZP }), MK);
    page.__step = 'switch';
    await page.evaluate(() => { bzSwitch('beta').catch((e) => { window.__swErr = e.message; }); });
    await H.settle(page, 3000);
    const b = await page.evaluate((mk) => {
      const own = Object.keys(localStorage).filter((k) => !k.startsWith('acme:') && k !== 'lp-sync');
      return { bizId: SY.bizId, role: SY.role, refresh: !!SY.refresh, BZP, err: window.__swErr || '',
        screen: document.body.innerText.includes(mk), mem: JSON.stringify([S, TK]).includes(mk),
        storage: own.filter((k) => (localStorage.getItem(k) || '').includes(mk)), acmeKept: (localStorage.getItem('acme:large-pami-v2') || '').includes(mk), keys: Object.keys(localStorage).sort() };
    }, MK);
    await page.evaluate(() => { NAV = [{ v: 'cat', a: 'mkc' }]; render(0); }); await H.settle(page, 500);
    const b2 = await page.evaluate((mk) => document.body.innerText.includes(mk), MK);
    const fsAfter = log.filter((r) => r.step === 'switch' && r.url.includes(':8080')).map((r) => r.method + ' ' + decodeURIComponent(r.url.split('/documents')[1]));
    check('ד מנהל־על בעסק א\' רואה את הנתון שלו (בקרה)', a.screen && a.bizId === 'acme' && a.BZP === 'acme:', a);
    check('ד אחרי מעבר לעסק ב\': אין נתון של א\' במסך, בזיכרון או במפתחות של ב\', בלי התנתקות', !b.err && b.bizId === 'beta' && b.BZP === 'beta:' && b.refresh && b.role === 'admin' && !b.screen && !b2 && !b.mem && b.storage.length === 0, b);
    check('ד הנתונים של א\' לא נמחקו (נשמרים במפתחות acme:)', b.acmeKept, { keys: b.keys });
    check('ד אחרי המעבר כל בקשה היא לעסק ב\' (או קריאת זיהוי)', fsAfter.length > 0 && fsAfter.map((x) => x.split(' ')[1]).every((p) => p.startsWith('/b/beta') || /^\/(users|superadmins)\//.test(p) || /^:(commit|batchGet)/.test(p)), fsAfter);
    const idbs = await page.evaluate(async () => { await fput('probe', 'x'); return (await indexedDB.databases()).map((d) => d.name).sort(); });
    check('ד IndexedDB נפרד לעסק (lp-files:beta), ולא lp-files של לארג\' פעמי', idbs.includes('lp-files:beta') && !idbs.includes('lp-files'), idbs);
    check('ד אין שגיאות JS', page.__errors.length === 0, page.__errors);
    // משתמש שאינו מנהל־על לא יכול לעבור
    await ctx.close();
    const log2 = []; const p2 = await H.newPage(browser, www, { mode: 'new', users: { ma: 'acme' }, biz: { acme: { dataRoot: 'b' }, beta: { dataRoot: 'b' } }, admins: { 'b/acme/|ma': 1 } }, log2, 'ma');
    await H.login(p2.page, 'ma@x.co');
    const r2 = await p2.page.evaluate(async () => { try { await bzSwitch('beta'); return 'עבר'; } catch (e) { return e.message + '|' + SY.bizId; } });
    check('ד מנהל רגיל לא יכול לעבור עסק', r2 === 'רק מנהל־על יכול לעבור בין עסקים|acme', r2);
    await p2.ctx.close();
  }

  // (ד-מרוץ) מעבר עסק כשמסמך העסק החדש מתעכב 4 שניות, ובזמן הזה רץ גיבוי ענן / משיכות רקע (ליקוי מסבב בדיקה 1)
  for (const kind of ['backup', 'online']) {
    const cfg = { mode: 'new', users: { sa: 'acme' }, sa: { sa: 1 }, biz: { acme: { dataRoot: 'b' }, beta: { dataRoot: 'b' } }, admins: { 'b/acme/|sa': 1, 'b/beta/|sa': 1 },
      delay: /\/documents\/b\/beta$/, delayMs: 4000, keyDelay: 1000, betaDocs: 1 };
    const log = []; const { ctx, page } = await H.newPage(browser, www, cfg, log, 'sa');
    await H.login(page, 'sa@x.co');
    const MK = 'MARKER-ACME-777';
    await page.evaluate((mk) => { if (!S.cats.length) S = ensure(defaults()); const sb = S.subs.find((x) => (S.cats.find((c) => c.id === x.cat) || {}).kind === 'exp'); S.tx.push({ id: 'mk1', t: 'exp', cat: sb.cat, sub: sb.id, date: '2026-11-02', amt: 777, note: mk, pays: [] }); save(); }, MK);
    await H.settle(page, 500);
    page.__step = 'race'; const G = page.__gen;
    await page.evaluate((k) => { if (k === 'backup') abkRun('test'); bzSwitch('beta').catch((e) => { window.__swErr = e.message; }); if (k === 'online') setTimeout(() => window.dispatchEvent(new Event('online')), 300); }, kind);
    await H.settle(page, 9000);
    const old = log.filter((r) => r.step === 'race' && r.gen === G);
    const leak = old.filter((r) => /b(\/|%2F)beta/.test(r.url) || /b\/beta\//.test(r.body || ''));
    const upBeta = log.filter((r) => r.url.includes(':9199') && r.method === 'POST' && /b%2Fbeta%2Fapp_backups/.test(r.url));
    const st = await page.evaluate(() => ({ bizId: SY.bizId, dataRoot: SY.biz && SY.biz.dataRoot, BZP, acmeMix: Object.keys(localStorage).filter((k) => k.startsWith('acme:') && (localStorage.getItem(k) || '').includes('MARKER-BETA')), betaHasAcme: Object.keys(localStorage).filter((k) => k.startsWith('beta:') && (localStorage.getItem(k) || '').includes('MARKER-ACME')) }));
    check(`ד-מרוץ (${kind === 'backup' ? 'גיבוי ענן רץ בזמן המעבר' : 'משיכות רקע בזמן המעבר'}, עיכוב 4 שניות): הדף הישן לא פונה לעסק ב', אין גיבוי של א' בעסק ב', ואין נתון של ב' במפתחות של א'`,
      leak.length === 0 && upBeta.length === 0 && st.acmeMix.length === 0 && st.betaHasAcme.length === 0 && st.bizId === 'beta' && st.dataRoot === 'b' && st.BZP === 'beta:' && page.__errors.length === 0,
      { oldPageRequests: old.length, leak: leak.map((r) => r.method + ' ' + r.url.slice(0, 120)), upBeta: upBeta.length, st, errors: page.__errors });
    await ctx.close();
  }
  // (ד-כניסה) כניסה של מנהל עסק אחר במכשיר שיש בו נתוני לארג' פעמי, כשמסמך העסק מתעכב: נתוני לארג' פעמי לא משתנים
  {
    const cfg = { mode: 'new', users: { ma: 'acme' }, biz: { acme: { dataRoot: 'b' } }, admins: { 'b/acme/|ma': 1 }, delay: /\/documents\/b\/acme$/, delayMs: 4000 };
    const log = []; const { ctx, page } = await H.newPage(browser, www, cfg, log, 'ma');
    await page.addInitScript(() => { if (!localStorage.getItem('large-pami-v2')) { localStorage.setItem('large-pami-v2', JSON.stringify({ v: 2, mark: 'LP-DATA' })); localStorage.setItem('lp-tasks', JSON.stringify({ L: [{ id: 't0', txt: 'LP-TASK' }] })); } });
    await page.goto(H.ORIGIN + '/?emu=1'); await H.settle(page, 1000);
    const before = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((k) => !k.includes(':') && k !== 'lp-sync').sort().map((k) => [k, localStorage.getItem(k)])));
    await H.login(page, 'ma@x.co'); await H.settle(page, 5000);
    const after = await page.evaluate(() => ({ un: Object.fromEntries(Object.keys(localStorage).filter((k) => !k.includes(':') && k !== 'lp-sync').sort().map((k) => [k, localStorage.getItem(k)])), bizId: SY.bizId, BZP, gate: !!document.getElementById('gate') }));
    check('ד-כניסה: מפתחות לארג\' פעמי לא השתנו בכניסה של מנהל עסק אחר (עיכוב 4 שניות), והדף עבר לתחילית העסק', JSON.stringify(before) === JSON.stringify(after.un) && after.bizId === 'acme' && after.BZP === 'acme:' && !after.gate && page.__errors.length === 0,
      { beforeKeys: Object.keys(before), afterKeys: Object.keys(after.un), bizId: after.bizId, BZP: after.BZP, gate: after.gate, errors: page.__errors });
    await ctx.close();
  }

  // (ה) משתמש בלי עסק ובלי מסמכים בשורש: "אין לך הרשאה", בחוקים ישנים ובחדשים
  for (const cfg of [legacyCfg, { mode: 'new', biz: {} }]) {
    const log = []; const { ctx, page } = await H.newPage(browser, www, cfg, log, 'n');
    await H.login(page, 'n@x.co');
    const st = await page.evaluate(() => ({ gate: !!document.getElementById('gate'), err: (document.getElementById('gerr') || {}).textContent || '', sy: localStorage.getItem('lp-sync') }));
    check(`ה בלי עסק (${cfg.mode === 'old' ? 'חוקים ישנים' : 'חוקים חדשים'}): "אין לך הרשאה"`, st.gate && st.err === 'אין לך הרשאה לאפליקציה. פנה למנהל העסק.' && page.__errors.length === 0, st);
    await ctx.close();
  }

  // (ו) עסק מושהה (עדכון חוזה 2; מסך מלא #susp משלב 6ב): עובד/מנהל רואה "החשבון מושהה – פנה לספק"; מנהל־על נכנס
  {
    const cfg = { mode: 'new', users: { ma: 'acme', sa: 'acme' }, sa: { sa: 1 }, biz: { acme: { dataRoot: 'b', status: 'suspended' } }, admins: { 'b/acme/|ma': 1, 'b/acme/|sa': 1 } };
    let log = []; let p = await H.newPage(browser, www, cfg, log, 'ma');
    await H.login(p.page, 'ma@x.co');
    let st = await p.page.evaluate(() => ({ gate: !!document.getElementById('gate'), susp: !!document.getElementById('susp'), err: ((document.getElementById('susp') || {}).innerText || '') }));
    const data = log.filter((r) => r.url.includes(':8080') && !/\/documents\/(users|b|superadmins)\/[^/]+$/.test(r.url.split('?')[0]));
    check('ו מנהל בעסק מושהה: הודעת השהיה, בלי טעינת נתונים', !st.gate && st.susp && st.err.includes('החשבון מושהה – פנה לספק') && data.length === 0, { st, data: data.map((r) => r.url) });
    await p.ctx.close();
    // משתמש שכבר מחובר (lp-sync שמור) והעסק הושהה
    log = []; p = await H.newPage(browser, www, cfg, log, 'ma');
    await p.page.addInitScript((t) => { if (!localStorage.getItem('lp-sync')) localStorage.setItem('lp-sync', JSON.stringify({ idToken: 'tok-ma', refresh: 'r-ma', exp: t + 3600e3, uid: 'ma', email: 'ma@x.co', role: 'admin', bizId: 'acme', biz: { dataRoot: 'b', status: 'active' } })); }, H.T0);
    await p.page.goto(H.ORIGIN + '/?emu=1'); await H.settle(p.page, 4000);
    st = await p.page.evaluate(() => ({ gate: !!document.getElementById('gate'), susp: !!document.getElementById('susp'), err: ((document.getElementById('susp') || {}).innerText || '') }));
    check('ו מנהל שכבר מחובר, העסק הושהה: אחרי רענון מסמך העסק מוצגת הודעת השהיה', !st.gate && st.susp && st.err.includes('החשבון מושהה – פנה לספק') && p.page.__errors.length === 0, st);
    await p.ctx.close();
    log = []; p = await H.newPage(browser, www, cfg, log, 'sa');
    await H.login(p.page, 'sa@x.co');
    st = await p.page.evaluate(() => ({ gate: !!document.getElementById('gate'), sa: SY.sa, bizId: SY.bizId }));
    check('ו מנהל־על נכנס לעסק מושהה', !st.gate && st.sa === 1 && st.bizId === 'acme' && p.page.__errors.length === 0, st);
    await p.ctx.close();
  }
  await browser.close();
  fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
  console.log(fail ? `תוצאה: נכשל (${fail})` : 'תוצאה: הכול עבר'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
