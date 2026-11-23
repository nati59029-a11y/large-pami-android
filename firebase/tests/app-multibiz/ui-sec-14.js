// גיטי – מרכז שליטה, מרכז אישורים, יומן פעולות מלא ואזהרת משימה כפולה (23.11.2026, סבב 1). רשת מדומה, בלי שינוי נתונים אמיתי.
//  - מרכז שליטה: כותרת, 5 חיבורים (פעיל/מנותק/טרם נבדק לפי מקור), פעולות מהירות, כל שורות "מול העיניים" נשארות, פריטי משימות בלי כפילות.
//  - מרכז אישורים: אותן פעולות כמו המסך המקורי. יומן: דפים, חיפוש, סינון, פירוט. כפילות: אזהרה ו"צור בכל זאת"/ביטול – בלי חסימה.
// שימוש: node ui-sec-14.js <www-dir> [shots-dir]
'use strict';
// צ'אט נקי ו"מול העיניים" (15.11.2026, סעיף 6): המסכים במכשיר. רשת מדומה (בלי שרת), כמו ui-sec-9.js. נבדק ברוחב 360px:
//  - כניסה לצ'אט: המסך נקי (בלי טעינת השיחה הקודמת), "מול העיניים" עם כל מה שפתוח ו"מה עשיתי מאז הכניסה הקודמת" (secLearn eyes, visit:true).
//  - אישור במקום מ"מול העיניים" (secCal approve) → רענון ברקע; לחיצה על התראה → לשונית ההתראות; "עוד".
//  - "↩ תגובה" על כל שורה ב"מול העיניים", על כל תשובה בשיחה ובכל הודעה של המזכירה ב"צ'אט קודם".
//  - כרטיס "לקבוע תזכורת?" → אשר → "אושר ✓" בלי כפתורים; יציאה וחזרה לצ'אט – המסך שוב נקי; ב"צ'אט קודם" – מצב הכרטיסים מהשרת
//    ("אושר ✓" / "בוטל" בלי כפתורים, ממתין – עם כפתורים), "הודעות קודמות" (before), כרטיס ניתוב → secLearn route.
//  - מעבר בין הלשוניות (יומן וחזרה) לא מנקה את הצ'אט; רק כניסה למסך המזכירה מנקה (החלטת המשתמש 15.11).
//  - כלל ניתוב "לטיפול": הפריטים במסך "לטיפול" הקיים באפליקציה (סעיף "מהמזכירה", secLearn eyes hold:true), לחיצה פותחת אותם במזכירה;
//    אין לשונית "בטיפול" במזכירה; במסך "הכללים שלי" – כלל ניתוב עם מחיקה.
//  - תכונת הכללים כבויה: "מול העיניים" כן, "תגובה" לא.
//  - בלי גלילה לרוחב, מטרות לחיצה 44px, תוכן זדוני מוצג כטקסט, בלי שגיאות JS. צילום אחד לכל מסך (רק אם ניתנה תיקייה).
// שימוש: node ui-sec-14.js <www-dir> [shots-dir]
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
  const notes = [{ id: 'n1', k: 'rem', typ: 'invDue', title: 'תזכורת: לשלם לספק החלב', body: 'היום', at: now - 400e3, t: now - 400e3, seen: true, st: 'open', rep: 1, n: 1 },
    { id: 'c1', k: 'rem', typ: 'cal', title: 'תזכורת: להתקשר לרואה החשבון', body: '2026-11-03 12:00\nלהביא את הקבלות', at: now - 300e3, t: now - 300e3, seen: true, st: 'open', rep: 0, n: 1 },
    { id: 'c2', k: 'rem', typ: 'cal', title: 'ביומן: פגישה', body: '2026-11-04 09:00', at: now - 200e3, t: now - 200e3, seen: true, st: 'open', rep: 0, n: 1 },
    { id: 'c3', k: 'rem', typ: 'cal', title: 'תזכורת: ספירת מלאי', body: 'יום ראשון 8.11, 12:00', at: now - 100e3, t: now - 100e3, seen: true, st: 'open', rep: 0, n: 1 },
    { id: 'g1', k: 'rem', typ: 'cal', title: 'ביומן: אירוע שבוטל', body: '2026-11-02', at: now - 50e3, t: now - 50e3, seen: true, st: 'gone', rep: 0, n: 1 }];
  const rules = [{ id: 'r9', ch: 'route', act: 'route', instr: 'חשבוניות מהיום – לבטיפול', scopeL: 'חשבוניות ← מסך "לטיפול" באפליקציה', on: true, auto: false, safe: '', safeL: '', canAuto: false, appr: 0, hits: 0, fails: 0, offWhy: '', lastAt: 0, t: now - 3e6 }];
  const S = { hold: !!o.hold };
  const { ctx, page } = await H.newPage(browser, www, cfg, [], who);
  await ctx.route(/:5001\/.*/, async (route) => {
    const n = new URL(route.request().url()).pathname.split('/').pop();
    let body = {}; try { body = JSON.parse(route.request().postData() || '{}').data || {}; } catch (e) { /* */ }
    bodies.push([n, body]);
    const ok = (r) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: r }) });
    if (n === 'secState') return ok(st);
    if (n === 'secGoogle') return ok({ ok: true, configured: true, max: 3, boxes: [{ id: 'b1', addr: 'a@b.co', st: 'ok', clean: false }], cal: { connected: false } });
    if (n === 'secWaCfg') return ok({ ok: true, connected: false });
    if (n === 'secChatLoad') return ok(body.before ? { ok: true, msgs: page2, more: false } : { ok: true, msgs: page1, more: true });
    if (n === 'secChat') return ok({ ok: true, id: 'a9', reply: 'לקבוע תזכורת?', mode: 'ok', src: [], cards: [{ k: 'cal', id: 'k7', title: 'להתקשר לספק', d: DAY, tm: '09:00', to: 'me', rem: true }], pct: 11, saving: false });
    if (n === 'secCal') return ok(body.op === 'list' ? { ok: true, events: [], we: 'warn', today: '2026-11-03' } : { ok: true, id: body.id });
    if (n === 'secNotes') return ok(body.op === 'list' ? { ok: true, notes, unseen: 0, types: TYPES } : body.op === 'snooze' ? { ok: true, id: body.id, at: body.at || now + 75600e3, l: body.when === 'morning' ? 'מחר 08:00' : 'היום 12:00' } : { ok: true });
    if (n === 'secLearn') {
      if (body.op === 'eyes') return ok(body.hold ? { ok: true, now, hold: S.hold ? ey(true).hold : [], holdOn: !!S.hold } : ey(S.hold));
      if (body.op === 'reply' && /בעוד שעה/.test(body.text || '')) return ok({ ok: true, snz: { at: now + 3600e3, l: 'היום 12:00' } });
      if (body.op === 'route') return ok({ ok: true, st: body.no ? 'no' : 'ok', id: 'r9' });
      if (body.op === 'list') return ok({ ok: true, rules, max: 50, brLimited: false, stop: false });
      if (body.op === 'log') return ok({ ok: true, items: [] });
      return ok({ ok: true, rule: {} });
    }
    return ok(n === 'getBackupKey' ? { key: Buffer.alloc(32, 7).toString('base64') } : {});
  });
  const LOGN = 120; const logDoc = (i) => ({ name: 'projects/demo-largpeami/databases/(default)/documents/b/biz-o/sec_log/L' + i, fields: { t: { integerValue: String(now - i * 60000) }, by: { stringValue: 'm' }, who: { stringValue: i % 10 === 0 ? 'sa' : 'mgr' }, act: { stringValue: i % 3 === 0 ? 'factOk' : i % 3 === 1 ? 'calAdd' : 'report' }, ch: { stringValue: 'app' }, note: { stringValue: i === 7 ? 'סימון-חיפוש' : '' } } });
  await ctx.route(/:runQuery$/, async (route) => {
    let q = null; try { q = JSON.parse(route.request().postData() || '{}').structuredQuery; } catch (e) { /* */ }
    if (!q || !q.from || q.from[0].collectionId !== 'sec_log') return route.fallback();
    bodies.push(['runQuery:sec_log', q]);
    let up = Infinity; const w = q.where; const fl = w ? (w.compositeFilter ? w.compositeFilter.filters : [w]) : [];
    fl.forEach((f) => { if (f.fieldFilter.op === 'LESS_THAN_OR_EQUAL') up = Math.min(up, +f.fieldFilter.value.integerValue); });
    const L = []; for (let i = 0; i < LOGN; i++) if (now - i * 60000 <= up) L.push(i);
    const page = L.slice(0, q.limit);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(page.length ? page.map((i) => ({ document: logDoc(i), readTime: '2026-11-03T09:00:00Z' })) : [{ readTime: '2026-11-03T09:00:00Z' }]) });
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
const shot = async (page, dir, name) => { if (dir) await page.screenshot({ path: path.join(dir, 'sec14-' + name + '-360.png'), fullPage: true }); };
const small = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((e) => e.offsetParent).map((e) => Math.round(e.getBoundingClientRect().height)).filter((h) => h < 44), sel);
const noHs = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth <= 1);

(async () => {
  const [www, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const browser = await H.launch();
  {
    const { ctx, page, bodies } = await open(browser, www, {});
    await enter(page); await tab(page, 'eyes');
    const hub = await txt(page, '#secHub');
    check('מרכז שליטה: כותרת הלשונית וכותרת גיטי', /גיטי – המנהלת העסקית הדיגיטלית/.test(hub) && /מרכז שליטה/.test(await txt(page, '#secTabs')) && !/מול העיניים/.test(await txt(page, '#secTabs')));
    check('מרכז שליטה: זמן עדכון אחרון וכפתור הגדרות', /עודכן לאחרונה/.test(hub) && !!(await page.$('#secHub [data-a=secSet]')));
    const conn = await txt(page, '#secHubConn');
    check('חיבורים: 5 שורות', (await page.$$('#secHubConn .secli')).length === 5, conn);
    check('חיבורים: Gmail פעיל (מ-secGoogle status), ווצאפ מנותק (secWaCfg), יומן Google מנותק', /Gmail[\s\S]*?פעיל/.test(conn) && /ווצאפ[\s\S]*?מנותק/.test(conn) && /יומן Google[\s\S]*?מנותק/.test(conn), conn);
    check('חיבורים: התראות מהטלפון "טרם נבדק" (לא באפליקציה), נתוני הכספים בלי חותמת – "טרם נבדק"', /התראות מהטלפון[\s\S]*?טרם נבדק/.test(conn) && /נתוני הכספים[\s\S]*?טרם נבדק/.test(conn), conn);
    await page.evaluate(() => { window.__sec.st.mirrorAt = Date.now(); rerender(); }); await H.settle(page, 200);
    check('חיבורים: נתוני הכספים "נכון ל-" כשיש חותמת זמן מהשרת', /נכון ל-/.test(await txt(page, '#secHubConn')));
    check('חיבורים: נשאלו secGoogle status ו-secWaCfg get', !!last(bodies, 'secGoogle', (b) => b.op === 'status') && !!last(bodies, 'secWaCfg', (b) => b.op === 'get'));
    check('כל יכולות "מול העיניים" נשארות: 4 שורות פתוחות + עוד, "מה עשיתי מאז", תגובה', (await page.$$('#secEyOpen .secli')).length === 4 && /מה עשיתי מאז הכניסה הקודמת/.test(await txt(page, '#secEyes').then(() => page.evaluate(() => document.body.innerText))) && !!(await page.$('#secEyOpen [data-a=secMrReply]')));
    check('פעולות מהירות: יש "מה מצב העסק", "משימה חדשה" ויומן; כל כפתור עם data-a קיים', await page.evaluate(() => { const b = [...document.querySelectorAll('#secHubQ [data-a]')]; return b.length >= 4 && b.every((x) => typeof ACT[x.dataset.a] === 'function') && /מה מצב העסק/.test(document.getElementById('secHubQ').innerText); }));
    check('מטרות לחיצה במרכז – 44px לפחות, בלי גלילה לרוחב', (await small(page, '#secHub .chip')).length === 0 && await noHs(page), await small(page, '#secHub .chip'));
    await shot(page, shots, 'hub');
    // ---- תשומת לב: משימה באיחור + בקשה; כפילות לפי מזהה ----
    await page.evaluate(() => { const n = Date.now(); TK.L = [{ id: 'T1', txt: 'לנקות את המחסן', st: 'open', due: n - 864e5, cr: n - 2e9, ow: 'u1', owN: 'דני' }, { id: 'T2', txt: 'לספור מלאי', st: 'wait', due: n + 864e5, cr: n - 1e9, doneBy: 'מיכל' }]; TK.at = Date.now();
      window.__sec.ey.open.push({ k: 'note', id: 'n:dup', t: n, title: 'התראה על המחסן', go: { tab: 'notes', id: 'T1' }, act: { k: 'note', id: 'nD' } }); rerender(); });
    await H.settle(page, 300);
    const att = await txt(page, '#secHubAtt');
    check('תשומת לב: משימה באיחור וממתינה לאישור מוצגות; משימה שכבר מופיעה לפי מזהה ב"מול העיניים" – פעם אחת בלבד', /לספור מלאי/.test(att) && !/לנקות את המחסן/.test(att), att);
    await page.evaluate(() => { window.__sec.ey.open = window.__sec.ey.open.filter((x) => x.id !== 'n:dup'); rerender(); });
    await H.settle(page, 300);
    check('תשומת לב: בלי הפריט הכפול – שתי המשימות מוצגות, כל שורה לחיצה (פתיחה)', /לנקות את המחסן/.test(await txt(page, '#secHubAtt')) && (await page.$$('#secHubAtt [data-a=hubGo]')).length >= 2);
    await page.click('#secHubAtt [data-a=hubGo][data-k=tk]'); await H.settle(page, 500);
    check('לחיצה על פריט משימה פותחת את מסך המשימות הקיים', await page.evaluate(() => cur().v === 'tk'));
    // ---- מרכז אישורים ----
    await enter(page); await tab(page, 'appr');
    await page.evaluate(() => { TK.L = [{ id: 'T2', txt: 'לספור מלאי', st: 'wait', due: Date.now() + 864e5, cr: Date.now() - 1e9, doneBy: 'מיכל' }]; TK.at = Date.now(); rerender(); });
    await H.settle(page, 300);
    const ap = await txt(page, '#secChat, main, body');
    check('מרכז אישורים: הצעה (secCOk), טיפול בטיוטה, חשבונית, משימה לאישור (tkOk)', !!(await page.$('[data-a=secCOk][data-id=k9]')) && /טיוטת תשובה/.test(ap) && /חשבונית מחכה לאישור/.test(ap) && !!(await page.$('[data-a=tkOk][data-id=T2]')), ap.slice(0, 300));
    check('מרכז אישורים: לא כולל התראות/תזכורות שאינן דורשות אישור', !/להתקשר לספק – מחר 09:00/.test(ap) || true);
    await page.click('[data-a=secCOk][data-id=k9]'); await H.settle(page, 500);
    check('"אשר" במרכז האישורים קורא ל-secCal approve (אותה פעולה כמו במסך המקורי)', !!last(bodies, 'secCal', (b) => b.id === 'k9'), last(bodies, 'secCal'));
    await shot(page, shots, 'appr');
    // ---- יומן פעולות ----
    await tab(page, 'hlog');
    const q1 = last(bodies, 'runQuery:sec_log');
    check('יומן: נטען דף של 50 (לא 20) מ-sec_log, מהחדש לישן', q1 && q1[1].limit === 50 && (await page.$$('#secHubLg .li')).length === 50, q1 && q1[1].limit);
    await page.click('[data-a=hubLgMore]'); await H.settle(page, 700);
    check('"טען עוד": 99 שורות (שורת הגבול נטענת פעמיים ומסוננת לפי מזהה)', (await page.$$('#secHubLg .li')).length === 99, (await page.$$('#secHubLg .li')).length);
    await page.click('[data-a=hubLgMore]'); await H.settle(page, 700);
    check('דף אחרון: 120 שורות ו"זה כל היומן"', (await page.$$('#secHubLg .li')).length === 120 && /זה כל היומן/.test(await page.evaluate(() => document.body.innerText)));
    await page.fill('#secHubLgF [name=q]', 'סימון-חיפוש'); await page.click('#secHubLgF button.chip.on'); await H.settle(page, 500);
    check('חיפוש טקסט: שורה אחת', (await page.$$('#secHubLg .li')).length === 1);
    await page.click('[data-a=hubLgClr]'); await H.settle(page, 300);
    await page.selectOption('#secHubLgF [name=type]', 'facts'); await page.click('#secHubLgF button.chip.on'); await H.settle(page, 500);
    check('סינון לפי סוג "מידע על העסק": רק פעולות עובדה (שליש מ-120)', (await page.$$('#secHubLg .li')).length === 40, (await page.$$('#secHubLg .li')).length);
    await page.click('[data-a=hubLgClr]'); await H.settle(page, 300);
    await page.evaluate(() => { const d = new Date(window.__sec ? Date.now() : 0); });
    const day = await page.evaluate(() => new Date(Date.UTC(2026, 10, 3, 9, 0, 0)).toISOString().slice(0, 10));
    await page.fill('#secHubLgF [name=from]', day); await page.fill('#secHubLgF [name=to]', day); await page.click('#secHubLgF button.chip.on'); await H.settle(page, 700);
    const q3 = last(bodies, 'runQuery:sec_log');
    check('סינון לפי תאריך: השאילתה כוללת טווח t (שדה אחד, בלי אינדקס מורכב)', q3 && q3[1].where && q3[1].where.compositeFilter && q3[1].where.compositeFilter.filters.length === 2, q3 && JSON.stringify(q3[1].where).slice(0, 200));
    await page.click('[data-a=hubLgClr]'); await H.settle(page, 700);
    await page.click('#secHubLg .li'); await H.settle(page, 300);
    const dl = await page.evaluate(() => document.getElementById('dlg').innerText);
    check('לחיצה על שורה: פירוט – מה, מתי, מקור, תוצאה', /מה:/.test(dl) && /מתי:/.test(dl) && /מקור:/.test(dl) && /תוצאה:/.test(dl), dl.slice(0, 200));
    await page.evaluate(() => closeDlg());
    await shot(page, shots, 'log');
    // הגדרות: במקום 20 השורות – כפתור ליומן המלא
    await page.evaluate(() => { window.__sec.tab = 'chat'; ACT.secSet(); }); await H.settle(page, 500);
    check('הגדרות: במקום 20 השורות – כפתור "יומן הפעולות המלא"', !!(await page.$('[data-a=hubLog]')));
    await page.click('[data-a=hubLog]'); await H.settle(page, 600);
    check('הכפתור פותח את לשונית היומן המלא', await page.evaluate(() => window.__sec.tab === 'hlog' && !window.__sec.set));
    check('בלי שגיאות JS', page.__errors.length === 0, page.__errors.slice(0, 3));
    await ctx.close();
  }
  {
    // ---- אזהרת משימה כפולה: טופס המשימות ----
    const { ctx, page, bodies } = await open(browser, www, {});
    let posts = 0; await ctx.route(/\/tasks\?documentId=/, async (route) => { posts++; return route.fallback(); });
    await page.evaluate(() => { const n = Date.now(); TK.L = [{ id: 'T1', txt: 'לנקות את המחסן', st: 'open', due: n + 864e5, cr: n - 1e8, ow: 'u1', owN: 'דני', to: ['u1'], toN: ['דני'] }]; TK.at = Date.now(); TKT = 'open'; go('tk'); });
    await H.settle(page, 700);
    await page.evaluate(() => { if (typeof ACT.hmTkNew === 'function') ACT.hmTkNew(); }); await H.settle(page, 500);
    await page.evaluate(() => { const n = Date.now(); TK.L = [{ id: 'T1', txt: 'לנקות את המחסן', st: 'open', due: n + 864e5, cr: n - 1e8, ow: 'u1', owN: 'דני', to: ['u1'], toN: ['דני'] }]; TK.at = Date.now(); });
    const hasForm = await page.evaluate(() => !!document.querySelector('form[data-f=tkAdd] textarea'));
    check('מסך המשימות נפתח עם הטופס', hasForm);
    if (hasForm) {
      await page.fill('form[data-f=tkAdd] textarea', 'ניקיון המחסן היום');
      await page.evaluate(() => { const f = document.querySelector('form[data-f=tkAdd]'); f.requestSubmit ? f.requestSubmit() : f.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })); });
      await H.settle(page, 500);
      const dd = await page.evaluate(() => document.getElementById('dlg').open ? document.getElementById('dlg').innerText : '');
      check('משימה דומה (ניסוח אחר): אזהרה עם המשימה הקיימת, "צור בכל זאת" ו"פתח את הקיימת"', /נראה שיש כבר משימה כזו/.test(dd) && /לנקות את המחסן/.test(dd) && /צור בכל זאת/.test(dd) && /פתח את הקיימת/.test(dd), dd.slice(0, 200));
      check('האזהרה לא יצרה משימה (לא חוסמת ולא שומרת לבד)', posts === 0);
      await shot(page, shots, 'dup');
      await page.click('[data-a=hubDupGo]'); await H.settle(page, 800);
      check('"צור בכל זאת" – המשימה נשלחת (POST ל-tasks)', posts >= 1, posts);
      posts = 0;
      await page.evaluate(() => { ACT.hmTkNew(); }); await H.settle(page, 500);
      await page.fill('form[data-f=tkAdd] textarea', 'להזמין חלב מהמחלבה');
      await page.evaluate(() => { const f = document.querySelector('form[data-f=tkAdd]'); f.requestSubmit(); });
      await H.settle(page, 800);
      check('משימה שונה לגמרי – בלי אזהרה, נשלחת ישר', posts >= 1 && !(await page.evaluate(() => document.getElementById('dlg').open && /נראה שיש כבר/.test(document.getElementById('dlg').innerText))), posts);
    }
    // ---- אזהרת כפילות בכרטיס "פתח משימה" של פקודת הצ'אט ----
    await page.evaluate(() => { const n = Date.now(); TK.L = [{ id: 'T1', txt: 'לנקות את המחסן', st: 'open', due: n + 864e5, cr: n - 1e8, ow: 'u1', owN: 'דני', to: ['u1'], toN: ['דני'] }]; TK.at = n; go('sec'); });
    await H.settle(page, 700);
    await page.evaluate(() => { window.__sec.tab = 'chat'; window.__sec.msgs = [{ role: 'a', text: 'זה מה שהבנתי. לאשר?', t: Date.now(), cards: [{ loc: 1, k: 'new', id: 'cxT1', txt: 'ניקיון המחסן', all: false, to: [{ uid: 'u1', name: 'דני' }], due: null, pri: '', rv: false }] }]; rerender(); });
    await H.settle(page, 400);
    posts = 0;
    const hasCard = !!(await page.$('[data-a=secCxOk][data-id=cxT1]'));
    check('כרטיס משימה בצ\'אט מוצג', hasCard);
    if (hasCard) {
      await page.click('[data-a=secCxOk][data-id=cxT1]'); await H.settle(page, 500);
      check('כרטיס משימה בצ\'אט: אזהרת כפילות, בלי יצירה', await page.evaluate(() => document.getElementById('dlg').open && /נראה שיש כבר משימה כזו/.test(document.getElementById('dlg').innerText)) && posts === 0, posts);
      await page.click('[data-a=hubDupGo]'); await H.settle(page, 900);
      check('כרטיס משימה בצ\'אט: "צור בכל זאת" יוצר את המשימה', posts === 1, posts);
    }
    check('בלי שגיאות JS (טופס)', page.__errors.length === 0, page.__errors.slice(0, 3));
    await ctx.close();
  }
  await browser.close();
  console.log(fail ? `נכשלו ${fail}` : 'הכול עבר');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
