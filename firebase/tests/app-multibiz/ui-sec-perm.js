// גיטי – מסך "הרשאות" ושאלה בפעם הראשונה (24.11.2026, סבב 4 חלק א, sec-perm.js). רשת מדומה, בלי שרת. נבדק ברוחב 360px:
//  - הגדרות המזכירה: 8 סוגי פעולה, מצב נוכחי ("טרם הוגדר" / לבד / אסור), "לבד" לא זמין במשימה ובהזמנה מספק, שמירה עם תקרת סכום → secPrefs op:'perm' scope:'always'.
//  - מרכז האישורים: כרטיס "גיטי שואלת" (לבד / מכינה ואני מאשר / אסור; תמיד כך / רק הפעם / לשאול שוב; עד איזה סכום) → secPrefs, והכרטיס נעלם.
//  - בלי גלילה לרוחב, מטרות לחיצה 44px, בלי שגיאות JS.
// שימוש: node ui-sec-perm.js <www-dir> [shots-dir]
'use strict';
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
    learn: o.learn !== false, brLimited: false, stop: false,
    perm: { edit: true, m: { mail: { m: 'auto' }, wa: { m: 'deny' } }, q: { fin: { t: now - 6e5, n: 2, note: 'חשבונית ספק – הכנסה אוטומטית' } },
      types: [['task', 'יצירת משימה', 0, 0, ''], ['rem', 'תזכורת', 0, 0, ''], ['mail', 'שליחת מייל', 1, 0, ''], ['wa', 'הודעת ווצאפ', 1, 0, ''], ['fin', 'רישום הוצאה / הכנסה', 1, 1, ''], ['cmt', 'אישור התחייבות', 0, 0, ''], ['ord', 'הזמנה מספק', 0, 1, 'approve'], ['app', 'פעולה על הודעה מאפליקציה / SMS', 1, 0, '']].map(([k, l, a, m, f]) => ({ k, l, auto: !!a, money: !!m, fixed: f })) } };
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
    if (n === 'secPrefs' && body.op === 'perm') { if (body.m === 'auto' && body.type === 'fin' && !(body.cap >= 0)) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { status: 'INVALID_ARGUMENT', message: 'צריך תקרה' } }) }); return ok({ ok: true, type: body.type, m: body.m, scope: body.scope, saved: body.scope === 'always' && body.m !== 'unset', ...(body.cap !== undefined ? { cap: body.cap } : {}) }); }
    if (n === 'secGoogle') return ok({ ok: true, configured: true, max: 3, boxes: [{ id: 'b1', addr: 'a@b.co', st: 'ok', clean: false }], cal: { connected: false } });
    if (n === 'secWaCfg') return ok({ ok: true, connected: false });
    if (n === 'cxBotTok') return ok({ dev: { id: 'd1', at: now - 600e3 }, lr: { st: 'needs-login', at: now - 3600e3 }, runs: [] }); // 23.11.2026 (סבב 2): מצב כספית
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
  const LOGN = 120; const logDoc = (i) => ({ name: 'projects/demo-largpeami/databases/(default)/documents/b/biz-o/sec_log/L' + i, fields: { t: { integerValue: String(now - i * 60000) }, by: { stringValue: 'm' }, who: { stringValue: i % 10 === 0 ? 'sa' : 'mgr' }, act: { stringValue: i % 3 === 0 ? 'factOk' : i % 3 === 1 ? 'calAdd' : 'report' }, ch: { stringValue: 'app' }, note: { stringValue: i === 7 ? 'סימון-חיפוש' : '' }, ...(i === 7 ? { res: { stringValue: 'fail' }, why: { stringValue: 'retries' } } : i === 8 ? { res: { stringValue: 'ok' } } : {}) } });
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

(async () => {
  const www = path.resolve(process.argv[2] || '../../../app-source/www');
  const shots = process.argv[3] ? path.resolve(process.argv[3]) : null;
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const browser = await H.launch();
  try {
    const { page, bodies } = await open(browser, www, {});
    const errs = []; page.on('pageerror', (e) => errs.push(String(e && e.message || e)));
    await page.evaluate(() => { go('sec'); }); await H.settle(page, 900);
    await page.evaluate(() => { window.__sec.tab = 'chat'; ACT.secSet(); }); await H.settle(page, 600);
    const rows = await page.$$eval('#secPermSet form[data-f=permSet]', (L) => L.map((f) => ({ k: f.dataset.k, t: f.innerText, autoDis: !!f.querySelector('option[value=auto][disabled]'), cap: !!f.querySelector('input[name=cap]') })));
    check('מסך הרשאות: 8 סוגי פעולה', rows.length === 8, rows.map((r) => r.k));
    const R = Object.fromEntries(rows.map((r) => [r.k, r]));
    check('מצב נוכחי: מייל "לבד", ווצאפ "אסור", משימה "טרם הוגדר"', /לבד/.test(R.mail.t) && /אסור/.test(R.wa.t) && /טרם הוגדר/.test(R.task.t), [R.mail.t.slice(0, 40), R.wa.t.slice(0, 40)]);
    check('"לבד" לא זמין במשימה ובהזמנה מספק; זמין במייל', R.task.autoDis && R.ord.autoDis && !R.mail.autoDis);
    check('תקרת סכום רק בסוג כספי שאפשר לבד (רישום הוצאה; לא בהזמנה מספק)', R.fin.cap && !R.ord.cap && !R.mail.cap);
    check('ההסבר: הגדרות אישיות לכל מנהל', /ההגדרות שלך בלבד/.test(await page.$eval('#secPermSet', (e) => e.innerText)));
    check('בלי גלילה לרוחב (הגדרות)', await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth <= 1));
    const small = await page.$$eval('#secPermSet button, #secPermSet select', (L) => L.filter((b) => b.getBoundingClientRect().height < 43).length);
    check('מטרות לחיצה 44px (הגדרות)', small === 0, small);
    if (shots) { const el = await page.$('#secPermSet'); await el.screenshot({ path: path.join(shots, 'perm-set-360.png') }); }
    await page.evaluate(() => { const f = document.querySelector('#secPermSet form[data-k=fin]'); f.querySelector('select').value = 'auto'; f.querySelector('input[name=cap]').value = '750'; f.querySelector('button').click(); }); await H.settle(page, 600);
    const b1 = bodies.filter((b) => b[0] === 'secPrefs').pop();
    check('שמירה: secPrefs op:perm, תמיד כך, עם תקרה', b1 && b1[1].op === 'perm' && b1[1].type === 'fin' && b1[1].m === 'auto' && b1[1].scope === 'always' && b1[1].cap === 750, b1 && b1[1]);
    check('אחרי השמירה: "עד 750 ₪"', /750/.test(await page.$eval('#secPermSet form[data-k=fin]', (e) => e.innerText)));
    // שאלה בפעם הראשונה – במרכז האישורים (סוג אחר: מצב מדומה חדש)
    await page.evaluate(() => { window.__sec.st.perm.q = { app: { t: Date.now(), n: 1, note: 'כלל אוטומטי על התראה מהטלפון' } }; ACT.secSetX && ACT.secSetX(); const b = document.querySelector('#secTabs [data-v=appr]'); if (b) b.click(); }); await H.settle(page, 900);
    const q = await page.$('form[data-f=permQ][data-k=app]');
    check('מרכז האישורים: כרטיס "גיטי שואלת"', !!q);
    if (q) {
      const t = await q.innerText();
      check('בכרטיס: לבד / מכינה ואני מאשר / אסור, תמיד כך / רק הפעם / לשאול שוב', ['לבד', 'מכינה ואני מאשר', 'אסור', 'תמיד כך', 'רק הפעם', 'לשאול שוב בפעם הבאה'].every((w) => t.includes(w)));
      check('בלי גלילה לרוחב (מרכז אישורים)', await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth <= 1));
      if (shots) await q.screenshot({ path: path.join(shots, 'perm-ask-360.png') });
      await page.evaluate(() => { const f = document.querySelector('form[data-f=permQ][data-k=app]'); f.querySelector('input[name=m][value=auto]').checked = true; f.querySelector('input[name=sc][value=once]').checked = true; f.querySelector('button').click(); }); await H.settle(page, 700);
      const b2 = bodies.filter((b) => b[0] === 'secPrefs').pop();
      check('תשובה: secPrefs op:perm app לבד רק הפעם', b2 && b2[1].type === 'app' && b2[1].m === 'auto' && b2[1].scope === 'once', b2 && b2[1]);
      check('הכרטיס נעלם אחרי התשובה', !(await page.$('form[data-f=permQ][data-k=app]')));
    }
    check('בלי שגיאות JS', errs.length === 0, errs);
    check('תוכן זדוני לא הורץ', !(await page.evaluate(() => window.__xss)));
  } finally { await browser.close(); }
  console.log(fail ? 'נכשלו ' + fail : 'הכול עבר');
  process.exit(fail ? 1 : 0);
})();
