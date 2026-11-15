'use strict';
// צ'אט נקי ו"מול העיניים" (15.11.2026, סעיף 6): המסכים במכשיר. רשת מדומה (בלי שרת), כמו ui-sec-9.js. נבדק ברוחב 360px:
//  - כניסה לצ'אט: המסך נקי (בלי טעינת השיחה הקודמת), "מול העיניים" עם כל מה שפתוח ו"מה עשיתי מאז הכניסה הקודמת" (secLearn eyes, visit:true).
//  - אישור במקום מ"מול העיניים" (secCal approve) → רענון ברקע; לחיצה על התראה → לשונית ההתראות; "עוד".
//  - "↩ תגובה" על כל שורה ב"מול העיניים", על כל תשובה בשיחה ובכל הודעה של המזכירה ב"צ'אט קודם".
//  - כרטיס "לקבוע תזכורת?" → אשר → "אושר ✓" בלי כפתורים; יציאה וחזרה לצ'אט – המסך שוב נקי; ב"צ'אט קודם" – מצב הכרטיסים מהשרת
//    ("אושר ✓" / "בוטל" בלי כפתורים, ממתין – עם כפתורים), "הודעות קודמות" (before), כרטיס ניתוב → secLearn route.
//  - כלל ניתוב: לשונית "בטיפול" עם הפריטים שנותבו; במסך "הכללים שלי" – כלל ניתוב עם מחיקה.
//  - תכונת הכללים כבויה: "מול העיניים" כן, "תגובה" לא.
//  - בלי גלילה לרוחב, מטרות לחיצה 44px, תוכן זדוני מוצג כטקסט, בלי שגיאות JS. צילום אחד לכל מסך (רק אם ניתנה תיקייה).
// שימוש: node ui-sec-10.js <www-dir> [shots-dir]
const fs = require('fs');
const path = require('path');
const H = require('./harness');
let fail = 0;
const check = (name, ok, info) => { if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const BIZ = 'biz-o';
const FEAT = { scan: true, tasks: true, orders: true, suppliers: true, cashClose: true, secretary: true };
const TYPES = { invDue: 'חשבונית לתשלום', win: 'הודעה שלא נענתה' };
const XSS = '<img src=x onerror="window.__xss=1">';
const NT = { wd: 0, wh: 8, md: 0, mh: 8, dg: false, dh: 8, q: { on: false, f: '22:00', t: '07:00' }, reps: 3, rt: {} };

async function open(browser, www, o) {
  const who = 'm';
  const cfg = { mode: 'new', users: { [who]: BIZ }, sa: {}, biz: { [BIZ]: { dataRoot: 'b', features: FEAT, name: 'עסק בדיקה' } },
    admins: { [`b/${BIZ}/|${who}`]: 1 }, staff: { [`b/${BIZ}/|${who}`]: 1 }, ctx: { hasTouch: true, isMobile: true, viewport: { width: 360, height: 740 } } };
  const now = H.T0, bodies = [];
  const st = { ok: true, consented: true, setupDone: true, name: 'רותי', addr: 'f', call: 'נתי', rows: [], mode: 'all', pay: true, emp: true, sens: false, we: 'warn', mirror: true, mirrorAt: null, cfTh: null, pct: 10, saving: '', nt: NT, types: TYPES, unseen: 0,
    learn: o.learn !== false, brLimited: false };
  const DAY = '2026-11-04';
  // הצ'אט הקודם: שני דפים. בדף האחרון: כרטיס שאושר, כרטיס שבוטל, כרטיס ממתין, כרטיס ניתוב ממתין
  const page2 = [{ id: 'o1', role: 'u', text: 'שאלה ישנה', t: now - 9e6 }, { id: 'o2', role: 'a', text: 'תשובה ישנה ' + XSS, t: now - 9e6 + 1, src: [] }];
  const page1 = [
    { id: 'p1', role: 'u', text: 'תזכירי לי מחר להתקשר לספק', t: now - 5e6 },
    { id: 'p2', role: 'a', text: 'לקבוע?', t: now - 5e6 + 1, src: [], cards: [{ k: 'cal', id: 'k1', title: 'להתקשר לספק', d: DAY, tm: '09:00', to: 'me', rem: true, st: 'ok' }, { k: 'fact', id: 'k2', topic: 'sup', text: 'ספק הקמח – 7%', st: 'no' }] },
    { id: 'p3', role: 'a', text: 'עוד הצעה', t: now - 4e6, src: [], cards: [{ k: 'cal', id: 'k3', title: 'פגישה', d: DAY, to: 'me' }] },
    { id: 'p4', role: 'u', text: 'חשבוניות מהיום – לבטיפול', t: now - 3e6 },
    { id: 'p5', role: 'a', text: 'להעביר?', t: now - 3e6 + 1, mode: 'route', src: [], cards: [{ k: 'route', id: 'rt0123456789abcdef', kind: 'inv', dest: 'hold', instr: 'חשבוניות מהיום – לבטיפול' }] },
    { id: 'p6', role: 'a', text: 'תשובת מדיניות', t: now - 2e6, mode: 'policy', src: [] },
  ];
  const ey = (hold) => ({ ok: true, since: now - 86400e3, now, today: '2026-11-03',
    open: [
      { k: 'appr', id: 'c:k9', t: now - 600e3, title: 'לקבוע תזכורת? להתקשר לרואה החשבון – מחר 08:00', go: { tab: 'cal' }, act: { k: 'cal', id: 'k9' }, r: { k: 'feed', id: 'appr' } },
      { k: 'draft', id: 'd:i1', t: now - 500e3, title: 'טיוטת תשובה בווצאפ מחכה לך', sub: 'שלום ' + XSS, go: { tab: 'wa', wa: '972541112233' }, r: { k: 'wa', id: 'i1' } },
      { k: 'note', id: 'n:n1', t: now - 400e3, title: 'תזכורת: לשלם לספק החלב', sub: 'היום', go: { tab: 'notes', id: 'n1' }, act: { k: 'note', id: 'n1' }, r: { k: 'note', id: 'n1' } },
      { k: 'inv', id: 'i:v1', t: now - 300e3, title: 'חשבונית מחכה לאישור – טרה', sub: '1,200 ₪', go: { tab: 'inv' }, r: { k: 'feed', id: 'inv' } },
      { k: 'rem', id: 'e:e1', t: now + 86400e3, soon: true, title: 'תזכורת: להתקשר לספק – מחר 09:00', go: { tab: 'cal' }, r: { k: 'feed', id: 'rem' } },
    ], openN: 5,
    did: [
      { k: 'rem', id: 'e:e1', t: now - 200e3, title: 'קבעתי – תזכורת: להתקשר לספק – מחר 09:00', go: { tab: 'cal' }, r: { k: 'feed', id: 'rem' } },
      { k: 'draft', id: 'm:l1', t: now - 150e3, title: 'נשלח לבד בווצאפ אל ***2233', go: { tab: 'set', mr: 1 }, r: { k: 'feed', id: 'act' } },
      { k: 'note', id: 'n:n2', t: now - 100e3, title: 'התראה: סגירת קופה חסרה', go: { tab: 'notes', id: 'n2' }, r: { k: 'note', id: 'n2' } },
      { k: 'inv', id: 'i:v2', t: now - 50e3, title: 'התקבלה חשבונית – תנובה', go: { tab: 'inv' }, r: { k: 'feed', id: 'inv' } },
    ], didN: 4,
    hold: hold ? [{ k: 'inv', id: 'i:v3', t: now - 20e3, title: 'חשבונית מחכה לאישור – שטראוס', go: { tab: 'inv' }, r: { k: 'feed', id: 'inv' } }] : [], holdOn: !!hold, routes: hold ? { inv: 'hold' } : {} });
  const notes = [{ id: 'n1', k: 'rem', typ: 'invDue', title: 'תזכורת: לשלם לספק החלב', body: 'היום', at: now - 400e3, t: now - 400e3, seen: true, st: 'open', rep: 1, n: 1 }];
  const rules = [{ id: 'r9', ch: 'route', act: 'route', instr: 'חשבוניות מהיום – לבטיפול', scopeL: 'חשבוניות ← בטיפול', on: true, auto: false, safe: '', safeL: '', canAuto: false, appr: 0, hits: 0, fails: 0, offWhy: '', lastAt: 0, t: now - 3e6 }];
  const S = { hold: !!o.hold };
  const { ctx, page } = await H.newPage(browser, www, cfg, [], who);
  await ctx.route(/:5001\/.*/, async (route) => {
    const n = new URL(route.request().url()).pathname.split('/').pop();
    let body = {}; try { body = JSON.parse(route.request().postData() || '{}').data || {}; } catch (e) { /* */ }
    bodies.push([n, body]);
    const ok = (r) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: r }) });
    if (n === 'secState') return ok(st);
    if (n === 'secChatLoad') return ok(body.before ? { ok: true, msgs: page2, more: false } : { ok: true, msgs: page1, more: true });
    if (n === 'secChat') return ok({ ok: true, id: 'a9', reply: 'לקבוע תזכורת?', mode: 'ok', src: [], cards: [{ k: 'cal', id: 'k7', title: 'להתקשר לספק', d: DAY, tm: '09:00', to: 'me', rem: true }], pct: 11, saving: false });
    if (n === 'secCal') return ok(body.op === 'list' ? { ok: true, events: [], we: 'warn', today: '2026-11-03' } : { ok: true, id: body.id });
    if (n === 'secNotes') return ok(body.op === 'list' ? { ok: true, notes, unseen: 0, types: TYPES } : { ok: true });
    if (n === 'secLearn') {
      if (body.op === 'eyes') return ok(ey(S.hold));
      if (body.op === 'route') return ok({ ok: true, st: body.no ? 'no' : 'ok', id: 'r9' });
      if (body.op === 'list') return ok({ ok: true, rules, max: 50, brLimited: false, stop: false });
      if (body.op === 'log') return ok({ ok: true, items: [] });
      return ok({ ok: true, rule: {} });
    }
    return ok(n === 'getBackupKey' ? { key: Buffer.alloc(32, 7).toString('base64') } : {});
  });
  await H.login(page, who + '@x.co');
  await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden && ACT.startBlank) ACT.startBlank(); });
  await H.settle(page, 500);
  return { ctx, page, bodies, S };
}
const all = (bodies, n, f) => bodies.filter((b) => b[0] === n && (!f || f(b[1])));
const last = (bodies, n, f) => all(bodies, n, f).pop();
const tab = async (page, v) => { await page.evaluate((x) => { if (document.getElementById('dlg').open) closeDlg(); if (cur().v !== 'sec') go('sec'); if (ACT.secSetX) ACT.secSetX(); window.__sec.mrv = 0; const b = document.querySelector('#secTabs [data-v=' + x + ']'); if (b) b.click(); }, v); await H.settle(page, 900); };
const enter = async (page) => { await page.evaluate(() => { if (document.getElementById('dlg').open) closeDlg(); go('home'); }); await H.settle(page, 300); await page.evaluate(() => go('sec')); await H.settle(page, 900); };
const txt = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.innerText : ''; }, sel);
const shot = async (page, dir, name) => { if (dir) await page.screenshot({ path: path.join(dir, 'sec10-' + name + '-360.png'), fullPage: true }); };
const small = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((e) => e.offsetParent).map((e) => Math.round(e.getBoundingClientRect().height)).filter((h) => h < 44), sel);
const noHs = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth <= 1);

(async () => {
  const [www, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const browser = await H.launch();
  {
    const { ctx, page, bodies, S } = await open(browser, www, {});
    await enter(page);
    // ---- כניסה: מסך נקי + מול העיניים ----
    check('כניסה לצ\'אט: השיחה הקודמת לא נטענת ולא מוצגת', !all(bodies, 'secChatLoad').length && (await page.$$('#secChat .secmsg.u')).length === 0 && /אני רותי/.test(await txt(page, '#secChat')));
    const e1 = last(bodies, 'secLearn', (b) => b.op === 'eyes');
    check('כניסה: secLearn eyes עם visit:true (נרשמת כניסה)', e1 && e1[1].visit === true, e1 && e1[1]);
    const et = await txt(page, '#secEyes');
    check('"מול העיניים": 4 שורות פתוחות + "עוד (1)", ו"מה עשיתי מאז הכניסה הקודמת" עם 3 + "עוד"', (await page.$$('#secEyOpen .secli')).length === 4 && /עוד \(1\)/.test(et) && /מה עשיתי מאז הכניסה הקודמת/.test(et) && (await page.$$('#secEyDid .secli')).length === 3, et.slice(0, 300));
    check('"↩ תגובה" על כל שורה ב"מול העיניים"', await page.evaluate(() => [...document.querySelectorAll('#secEyes .secli')].every((r) => !!r.querySelector('[data-a=secMrReply]'))));
    check('אישור במקום: "אשר"/"בטל" להצעה, "טופל" לתזכורת', !!(await page.$('#secEyOpen [data-a=secCOk][data-id=k9]')) && !!(await page.$('#secEyOpen [data-a=secNDone][data-id=n1]')));
    check('מטרות לחיצה ב"מול העיניים" – 44px לפחות', (await small(page, '#secEyes .secrow .chip, #secEyes > .chip')).length === 0, await small(page, '#secEyes .secrow .chip'));
    await shot(page, shots, 'eyes');
    await page.click('#secEyes [data-a=secEyMore][data-v=o]'); await H.settle(page, 300);
    await page.click('#secEyes [data-a=secEyMore][data-v=d]'); await H.settle(page, 300);
    check('"עוד": כל הפתוחים (5) וכל מה שעשתה (4)', (await page.$$('#secEyOpen .secli')).length === 5 && (await page.$$('#secEyDid .secli')).length === 4);
    const n0 = all(bodies, 'secLearn', (b) => b.op === 'eyes').length;
    await page.click('#secEyOpen [data-a=secCOk][data-id=k9]'); await H.settle(page, 700);
    const ca = last(bodies, 'secCal', (b) => b.op === 'approve');
    check('"אשר" מ"מול העיניים": secCal approve, ו"מול העיניים" מתרענן (בלי visit)', ca && ca[1].id === 'k9' && all(bodies, 'secLearn', (b) => b.op === 'eyes').length > n0 && last(bodies, 'secLearn', (b) => b.op === 'eyes')[1].visit === false, ca && ca[1]);
    // ---- שאלה → כרטיס תזכורת → אישור ----
    await page.fill('#secForm textarea', 'תזכירי לי מחר ב-9 להתקשר לספק'); await page.click('#secForm button[value=n]'); await H.settle(page, 800);
    check('כרטיס "לקבוע תזכורת?" עם אשר/בטל, ו"↩ תגובה" על התשובה', /לקבוע תזכורת\?/.test(await txt(page, '#secChat')) && !!(await page.$('#secChat [data-a=secCOk][data-id=k7]')) && !!(await page.$('#secChat [data-a=secMrReply][data-id=a9]')));
    await page.click('#secChat [data-a=secCOk][data-id=k7]'); await H.settle(page, 700);
    const k7 = await page.evaluate(() => { const c = document.querySelector('#secChat [data-card=k7]'); return c ? { st: c.dataset.st, t: c.innerText, btn: c.querySelectorAll('button').length } : null; });
    check('אחרי אישור: "אושר ✓" בלי כפתורים', k7 && k7.st === 'ok' && /אושר ✓/.test(k7.t) && k7.btn === 0, k7);
    // ---- לחיצה על שורה → המקום שלה ----
    await page.click('#secEyOpen .secli[data-ey="n:n1"] .secrow [data-a=secEyGo]'); await H.settle(page, 1500);
    check('לחיצה על התראה ב"מול העיניים" → לשונית ההתראות ופרטי ההתראה', await page.evaluate(() => window.__sec.tab === 'notes') && /לשלם לספק החלב/.test(await page.evaluate(() => (document.getElementById('dlg').open ? document.getElementById('dlg').innerText : ''))));
    // ---- חזרה לצ'אט – שוב נקי ----
    await tab(page, 'chat');
    check('חזרה ללשונית "שיחה": המסך שוב נקי (בלי השאלה והכרטיס הקודמים)', (await page.$$('#secChat .secmsg.u')).length === 0 && !(await page.$('#secChat [data-card=k7]')));
    check('חזרה לצ\'אט: "מול העיניים" נטען שוב עם visit:true', last(bodies, 'secLearn', (b) => b.op === 'eyes')[1].visit === true);
    // ---- צ'אט קודם ----
    await tab(page, 'prev');
    const pv = await page.evaluate(() => { const q = (id) => document.querySelector('#secPrev [data-card=' + id + ']'); const f = (id) => { const c = q(id); return c ? { st: c.dataset.st || '', t: c.innerText, btn: c.querySelectorAll('button').length } : null; }; return { k1: f('k1'), k2: f('k2'), k3: f('k3'), rt: f('rt0123456789abcdef'), form: !!document.getElementById('secForm') }; });
    check('"צ\'אט קודם": נטען דרך secChatLoad (limit 30), קריאה בלבד (בלי תיבת שאלה)', (last(bodies, 'secChatLoad') || [0, {}])[1].limit === 30 && !pv.form);
    check('"צ\'אט קודם": כרטיס שאושר – "אושר ✓" בלי כפתורים; שבוטל – "בוטל" בלי כפתורים', pv.k1 && pv.k1.st === 'ok' && /אושר ✓/.test(pv.k1.t) && pv.k1.btn === 0 && pv.k2 && pv.k2.st === 'no' && /בוטל/.test(pv.k2.t) && pv.k2.btn === 0, pv);
    check('"צ\'אט קודם": כרטיס ממתין – עם אשר/בטל; כרטיס ניתוב – עם אשר/בטל', pv.k3 && pv.k3.btn === 2 && pv.rt && pv.rt.btn === 2, pv);
    check('"↩ תגובה" על כל הודעה של המזכירה (גם תשובת מדיניות)', await page.evaluate(() => { const a = [...document.querySelectorAll('#secPrev .secmsg.a')]; return a.length === 4 && a.every((m) => !!m.querySelector('[data-a=secMrReply][data-k=chat]')); }));
    await shot(page, shots, 'prev');
    await page.click('#secPrev [data-a=secRtOk]'); await H.settle(page, 700);
    const rq = last(bodies, 'secLearn', (b) => b.op === 'route');
    check('כרטיס ניתוב: "אשר" → secLearn route עם ההודעה והכרטיס; הכרטיס "אושר ✓"', rq && rq[1].mid === 'p5' && rq[1].cid === 'rt0123456789abcdef' && !rq[1].no && /אושר ✓/.test(await txt(page, '#secPrev [data-card=rt0123456789abcdef]')), rq && rq[1]);
    await page.click('[data-a=secPcMore]'); await H.settle(page, 700);
    const mo = last(bodies, 'secChatLoad');
    check('"הודעות קודמות": secChatLoad עם before = ההודעה הוותיקה; ההודעות נוספו למעלה', mo && mo[1].before === H.T0 - 5e6 && /תשובה ישנה/.test(await txt(page, '#secPrev')) && !(await page.$('[data-a=secPcMore]')), mo && mo[1]);
    // ---- בטיפול ----
    check('בלי כלל ניתוב – אין לשונית "בטיפול"', !(await page.$('#secTabs [data-v=hold]')));
    S.hold = true;
    await tab(page, 'chat'); // כניסה ללשונית השיחה – "מול העיניים" נטען מחדש (עכשיו עם כלל ניתוב)
    await page.waitForSelector('#secTabs [data-v=hold]', { timeout: 3000 }).catch(() => {});
    await tab(page, 'hold');
    check('כלל ניתוב: לשונית "בטיפול" עם הפריט שנותב ו"↩ תגובה"', /שטראוס/.test(await txt(page, '#secHold')) && !!(await page.$('#secHold [data-a=secMrReply]')));
    await shot(page, shots, 'hold');
    // ---- הכללים שלי: כלל ניתוב ----
    await page.evaluate(() => ACT.secMrOpen()); await H.settle(page, 900);
    const mr = await txt(page, '#secMr');
    check('"הכללים שלי": כלל ניתוב (ניתוב, חשבוניות ← בטיפול) עם מחיקה', /ניתוב/.test(mr) && /חשבוניות ← בטיפול/.test(mr) && !!(await page.$('#secMr [data-id=r9] [data-a=secMrDel]')), mr.slice(0, 200));
    check('בלי גלילה לרוחב (360px)', await noHs(page));
    check('תוכן זדוני מוצג כטקסט', !(await page.evaluate(() => window.__xss === 1 || !!document.querySelector('img[src="x"]'))));
    check('בלי שגיאות JS', page.__errors.length === 0, page.__errors.slice(0, 3));
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, www, { learn: false });
    await enter(page);
    check('כללים כבויים: "מול העיניים" מוצג, בלי "תגובה"', !!(await page.$('#secEyes #secEyOpen .secli')) && (await page.$$('[data-a=secMrReply]')).length === 0);
    check('כללים כבויים: בלי שגיאות JS', page.__errors.length === 0, page.__errors.slice(0, 3));
    await ctx.close();
  }
  await browser.close();
  console.log(fail ? `נכשלו ${fail}` : 'הכול עבר');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
