'use strict';
// המזכירה העסקית – התראות, שלב 1 ושלב 2 (19.11.2026).
// שלב 1: "טופל" מסתיר מיד (בלי טעינה מחדש ובלי קפיצת גלילה), "טופלו לאחרונה", כשל חיבור – ניסיונות חוזרים ואז ההתראה חוזרת עם הודעה, "לא נמצאה" = הצלחה.
// שלב 2: כפתור פעולה ראשי בחלון הפרטים ושבב בשורה – סגירת קופה (ממולא מראש בסניף ובתאריך; כמה סניפים – בחירה; סגירה שנשמרה מסמנת את ההתראה),
// חשבונית לתשלום ("סמן כשולם" דרך חלון סגירת התשלום של האפליקציה, ונפילה לכרטיס הספק / לחשבוניות לתשלום), משימות, יומן, גיבוי, מידע על העסק.
// רשת מדומה (בלי שרת). 360px: בלי גלילה לרוחב, בלי שגיאות JS.
// שימוש: node ui-sec-13.js <www-dir> [shots-dir]
const fs = require('fs');
const path = require('path');
const H = require('./harness');
let fail = 0;
const check = (name, ok, info) => { if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const BIZ = 'biz-o';
const FEAT = { scan: true, tasks: true, orders: true, suppliers: true, cashClose: true, secretary: true };
const TYPES = { invDue: 'חשבונית לתשלום', invLate: 'חשבוניות באיחור (בדוח השבועי)', chk: 'צ\'ק שעומד להיפרע', task: 'משימות שעברו את הזמן', close: 'סגירת קופה חסרה או עם הפרש', backup: 'גיבוי ישן', fact: 'עובדה במידע על העסק שפגה', cal: 'אירועים ותזכורות מהיומן', emp: 'התראה מיידית על עובד', inv: 'חשבוניות שהתקבלו ומחכות', win: 'הודעה שלא נענתה – חלון 24 השעות נסגר' };
const NT = { wd: 0, wh: 8, md: 0, mh: 8, dg: false, dh: 8, q: { on: true, f: '22:00', t: '07:00' }, reps: 3, rt: {} };
const WDN = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const dk = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const addD = (k) => { const d = new Date(); d.setDate(d.getDate() + k); return dk(d); };
const dm = (d) => +d.slice(8, 10) + '.' + +d.slice(5, 7);
const dayL = (d) => 'יום ' + WDN[new Date(d + 'T12:00:00Z').getUTCDay()] + ' ' + dm(d);
const P = addD(-1), CALD = addD(1);

function mkNotes(now) {
  const L = [
    // סגירת קופה – בנוסח החדש (15.11.2026): כותרת עם d.m, שורה לכל סניף
    { id: 'c1', k: 'rem', typ: 'close', title: 'לא נשלחה סגירת קופה ל-' + dm(P), body: '• סניף יהודה הנשיא: לא נשלחה סגירת קופה ל' + dayL(P) + '.\nמה לעשות:\n• לסגירה שלא נשלחה: לבקש מהעובד בסניף לשלוח סגירת קופה, או לפתוח את מסך סגירת הקופה ולהכניס אותה בעצמך.' },
    { id: 'c2', k: 'rem', typ: 'close', title: 'לא נשלחה סגירת קופה ל-' + dm(P), body: '• סניף יהודה הנשיא: לא נשלחה סגירת קופה ל' + dayL(P) + '.\n• סניף נחל לכיש: לא נשלחה סגירת קופה ל' + dayL(P) + '.\nמה לעשות:\n• לסגירה שלא נשלחה: לבקש מהעובד בסניף.' },
    { id: 'i1', k: 'rem', typ: 'invDue', title: 'חשבונית לתשלום היום', body: 'חשבונית INV77 של ספק בדיקה – יתרה 500 ₪, מועד התשלום ' + addD(0) + '.' },
    { id: 'i2', k: 'rem', typ: 'invDue', title: 'חשבונית לתשלום מחר', body: 'חשבונית 999 של ספק לא קיים – יתרה 80 ₪, לתשלום עד ' + addD(1) + '.' },
    { id: 'i3', k: 'rem', typ: 'invDue', title: 'חשבונית לתשלום מחר', body: 'חשבונית 12 של ספק בדיקה – יתרה 80 ₪, לתשלום עד ' + addD(1) + '.' },
    { id: 't1', k: 'rem', typ: 'task', title: '2 משימות פתוחות עברו את הזמן', body: '• לנקות מקרר (דני)\n• להזמין סחורה' },
    { id: 'k1', k: 'rem', typ: 'cal', title: 'תזכורת: להתקשר לרו"ח', body: dayL(CALD) + ', 10:00' },
    { id: 'b1', k: 'rem', typ: 'backup', title: 'גיבוי ישן', body: 'הגיבוי האחרון נעשה ב-' + addD(-5) + ' – לפני יותר מ-3 ימים.' },
    { id: 'f1', k: 'rem', typ: 'fact', title: 'עובדה במידע על העסק פגה', body: '"מבצע חנוכה" – בתוקף עד ' + addD(-1) + '. כדאי לעדכן או למחוק.' },
    { id: 'off1', k: 'rem', typ: 'chk', title: 'צ\'ק שעומד להיפרע', body: 'צ\'ק לספק בדיקה על 300 ₪ ייפרע ב-' + addD(2) + '.' },
    { id: 'nf1', k: 'rem', typ: 'invDue', title: 'חשבונית לתשלום (נמחקה בשרת)', body: 'חשבונית 5 של ספק אחר – יתרה 10 ₪.' },
    { id: 'd1', k: 'dig', typ: 'dig', title: 'תקציר יומי', body: 'ביומן היום: אין\nתזכורות פתוחות: 3' },
    { id: 'x1', k: 'rem', typ: 'invDue', title: 'חשבונית שטופלה', body: 'חשבונית 1 של ספק ישן – יתרה 1 ₪.', st: 'done' },
  ];
  return L.map((n, i) => Object.assign({ at: now - (i + 1) * 60000, t: now - (i + 1) * 60000, seen: true, st: 'open', rep: 2, n: 1 }, n));
}

async function open(browser, www) {
  const who = 'm';
  const cfg = { mode: 'new', users: { [who]: BIZ }, sa: {}, biz: { [BIZ]: { dataRoot: 'b', features: FEAT, name: 'עסק בדיקה' } },
    admins: { [`b/${BIZ}/|${who}`]: 1 }, staff: { [`b/${BIZ}/|${who}`]: 1 }, ctx: { hasTouch: true, isMobile: true, viewport: { width: 360, height: 740 } } };
  const bodies = [];
  const st = { ok: true, consented: true, setupDone: true, name: 'רותי', addr: 'f', call: 'נתי', rows: [], mode: 'all', pay: true, emp: true, sens: false, we: 'warn', mirror: false, mirrorAt: null, cfTh: null, pct: 10, saving: '', nt: NT, types: TYPES, unseen: 0 };
  const now = Date.now();
  const R = { notes: mkNotes(now) };
  const { ctx, page } = await H.newPage(browser, www, cfg, [], who);
  await ctx.route(/:5001\/.*/, async (route) => {
    const n = new URL(route.request().url()).pathname.split('/').pop();
    let body = {}; try { body = JSON.parse(route.request().postData() || '{}').data || {}; } catch (e) { /* */ }
    bodies.push([n, body]);
    const ok = (r) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: r }) });
    if (n === 'secState') return ok(st);
    if (n === 'secChatLoad') return ok({ ok: true, msgs: [] });
    if (n === 'secNotes') {
      if (body.op === 'list') return ok({ ok: true, notes: R.notes, unseen: 0, types: TYPES });
      if (body.op === 'done' && body.id === 'off1') return route.abort('internetdisconnected');
      if (body.op === 'done' && body.id === 'nf1') return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { message: 'ההתראה לא נמצאה', status: 'NOT_FOUND', details: { reason: 'not-found' } } }) });
      return ok({ ok: true });
    }
    if (n === 'secCal') return ok({ ok: true, today: addD(0), we: 'accept', events: [{ id: 'e1', d: CALD, tm: '10:00', title: 'להתקשר לרו"ח', rem: true, st: 'ok' }] });
    if (n === 'secFacts') return ok({ ok: true, facts: [{ id: 'fa1', text: 'מבצע חנוכה', st: 'ok', topic: 'gen', exp: addD(-1), expired: true, t: now }], topics: { gen: 'כללי' }, fixed: {}, max: 200 });
    if (n === 'registerPushToken') return ok({ ok: true, count: 1, removed: 0 });
    return ok(n === 'getBackupKey' ? { key: Buffer.alloc(32, 7).toString('base64') } : {});
  });
  await H.login(page, who + '@x.co');
  await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden && ACT.startBlank) ACT.startBlank(); });
  await H.settle(page, 800);
  await page.evaluate(() => { window.__toasts = []; const t0 = window.toast; window.toast = (t) => { window.__toasts.push(t); t0(t); }; });
  // נתונים מקומיים: ספק בדיקה עם חשבונית פתוחה INV77 (500 ₪)
  await page.evaluate(() => {
    S.subs = S.subs.filter((s) => !/^TS/.test(s.id)); S.subs.push({ id: 'TS1', cat: 'e_sup', name: 'ספק בדיקה' });
    S.tx = S.tx.filter((t) => t.id !== 'q77'); S.tx.push({ id: 'q77', t: 'exp', cat: 'e_sup', sub: 'TS1', kind: 'inv', inv: 'INV77', amt: 500, date: today(), plan: NOWM(), note: '', pays: [] }); save();
  });
  return { ctx, page, bodies, R };
}
const all = (bodies, n, f) => bodies.filter((b) => b[0] === n && (!f || f(b[1])));
const txt = (page, sel) => page.evaluate((s) => (document.querySelector(s || '#main') || {}).innerText || '', sel);
const sx = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const toasts = (page) => page.evaluate(() => window.__toasts.join(' | '));
const view = (page) => page.evaluate(() => NAV[NAV.length - 1].v);
const dlgText = (page) => page.evaluate(() => document.getElementById('dlg').open ? document.getElementById('dlg').innerText : '');
const notesTab = async (page) => { await page.evaluate(() => { NAV = [{ v: 'home' }]; window.__sec.tab = 'notes'; window.__sec.nl = null; go('sec'); }); await H.settle(page, 900); };
const ids = (page) => page.evaluate(() => [...document.querySelectorAll('#secNotes .secnb')].map((b) => b.dataset.id));
const openDlg = async (page, id) => { await page.click(`.secnb[data-id=${id}]`); await H.settle(page, 400); };
const small = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((e) => e.getBoundingClientRect().height < 43.5).map((e) => e.innerText), sel);

(async () => {
  const [www, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const browser = await H.launch();
  const { ctx, page, bodies } = await open(browser, www);
  await notesTab(page);

  // ===================== שלב 1 =====================
  const L0 = await ids(page);
  check('רשימה: רק התראות פתוחות (מה שטופל – מוסתר)', L0.length === 12 && !L0.includes('x1'), L0);
  check('"טופלו לאחרונה (1)" מתחת לרשימה', /טופלו לאחרונה \(1\)/.test(await txt(page)));
  // "טופל" באמצע הרשימה אחרי גלילה – יוצאת מיד, בלי טעינה מחדש ובלי קפיצה למעלה
  const lists0 = all(bodies, 'secNotes', (b) => b.op === 'list').length;
  await page.evaluate(() => { const e = document.querySelector('.secnb[data-id=t1]'); e.scrollIntoView({ block: 'center' }); });
  await H.settle(page, 200);
  const y0 = await page.evaluate(() => (document.scrollingElement || document.documentElement).scrollTop);
  await page.click('#secNotes [data-a=secNDone][data-id=t1]'); await H.settle(page, 150);
  const gone = !(await page.$('#secNotes .secnb[data-id=t1]'));
  const y1 = await page.evaluate(() => (document.scrollingElement || document.documentElement).scrollTop);
  await H.settle(page, 600);
  check('"טופל": ההתראה יוצאת מהרשימה מיד (לפני תשובת השרת)', gone);
  check('"טופל": בלי טעינה מחדש של הרשימה', all(bodies, 'secNotes', (b) => b.op === 'list').length === lists0, { lists0, now: all(bodies, 'secNotes', (b) => b.op === 'list').length });
  check('"טופל": בלי קפיצת גלילה למעלה', y0 > 100 && Math.abs(y1 - y0) < 260, { y0, y1 });
  check('"טופל" נשמר בשרת', all(bodies, 'secNotes', (b) => b.op === 'done' && b.id === 't1').length === 1);
  check('"טופלו לאחרונה (2)" אחרי הסימון', /טופלו לאחרונה \(2\)/.test(await txt(page)));
  await page.click('[data-a=secNHist]'); await H.settle(page, 300);
  const hist = await txt(page, '#secNDoneL');
  check('"טופלו לאחרונה" – לחיצה מציגה את מה שטופל, עם התג "טופל"', /2 משימות פתוחות עברו את הזמן/.test(hist) && /חשבונית שטופלה/.test(hist) && /טופל/.test(hist), hist.slice(0, 200));
  await page.click('[data-a=secNHist]'); await H.settle(page, 300);
  check('"טופלו לאחרונה" – לחיצה שנייה מסתירה', !(await page.$('#secNDoneL')));
  // "לא נמצאה" בשרת = הצלחה
  await page.click('#secNotes [data-a=secNDone][data-id=nf1]'); await H.settle(page, 1200);
  check('"לא נמצאה" מהשרת נחשבת הצלחה – ההתראה לא חוזרת ואין הודעת שגיאה', !(await page.$('#secNotes .secnb[data-id=nf1]')) && !/לא נשמר/.test(await toasts(page)), await toasts(page));
  // אין חיבור: 3 ניסיונות נוספים (2, 5, 12 שניות), ורק אז ההתראה חוזרת עם הודעה
  await page.click('#secNotes [data-a=secNDone][data-id=off1]'); await H.settle(page, 300);
  const offGone = !(await page.$('#secNotes .secnb[data-id=off1]'));
  await H.settle(page, 4000);
  const mid = all(bodies, 'secNotes', (b) => b.op === 'done' && b.id === 'off1').length, midGone = !(await page.$('#secNotes .secnb[data-id=off1]'));
  await H.settle(page, 17000);
  const tries = all(bodies, 'secNotes', (b) => b.op === 'done' && b.id === 'off1').length;
  check('אין חיבור: ההתראה יוצאת מיד, ובזמן הניסיונות החוזרים נשארת מוסתרת', offGone && midGone && mid >= 2 && mid < 4, { offGone, midGone, mid });
  check('אין חיבור: אחרי 4 ניסיונות (1 + 3 חוזרים) ההתראה חוזרת לרשימה עם הודעה', tries === 4 && !!(await page.$('#secNotes .secnb[data-id=off1]')) && /אין חיבור לשרת. ההתראה חזרה לרשימה/.test(await toasts(page)), { tries, t: await toasts(page) });

  // ===================== שלב 2 =====================
  await notesTab(page);
  check('שבב פעולה ראשי בשורה (זהב) – סגירת קופה, חשבונית, יומן, גיבוי, מידע על העסק', await page.evaluate(() => ['c1', 'i1', 'i2', 'k1', 'b1', 'f1', 'off1'].every((id) => !!document.querySelector(`#secNotes .secli .chip.secpa[data-id="${id}"]`))));
  check('תקציר יומי – בלי כפתור פעולה (רק פרטים)', !(await page.$('#secNotes .chip.secpa[data-id=d1]')));
  check('שבבי הפעולה בגובה 44px לפחות', (await small(page, '#secNotes .chip.secpa')).length === 0, await small(page, '#secNotes .chip.secpa'));
  check('360px: רשימת ההתראות בלי גלילה לרוחב', (await sx(page)) <= 0, await sx(page));
  if (shots) await page.screenshot({ path: path.join(shots, 'sec13-notes-360.png'), fullPage: true });

  // --- סגירת קופה, סניף אחד: ממולא מראש בסניף ובתאריך ---
  await page.evaluate(() => { ZC = null; });
  await openDlg(page, 'c1');
  const c1d = await page.evaluate(() => { const d = document.getElementById('dlg'), a = d.querySelector('#secNAct'), h = d.querySelector('h3'); return { first: !!a && h.nextElementSibling === a, b: a ? a.querySelector('.btn').innerText : '', keep: !!d.querySelector('[data-a=secNDoneD]') && !!d.querySelector('[data-a=secSnz]') }; });
  check('סגירת קופה: בחלון הפרטים כפתור ראשי בראש החלון, ו"סמן כטופל" ו"תזכירי לי שוב" נשארו', c1d.first && /הכנסת סגירת קופה – יהודה הנשיא/.test(c1d.b) && c1d.keep, c1d);
  check('חלון הפרטים: כפתור ראשי בגובה 44px לפחות, בלי גלילה לרוחב', (await small(page, '#secNAct .btn')).length === 0 && (await sx(page)) <= 0);
  if (shots) await page.screenshot({ path: path.join(shots, 'sec13-dlg-close-360.png') });
  await page.click('#secNAct [data-a=secNZc]'); await H.settle(page, 600);
  const zc1 = await page.evaluate(() => ({ v: NAV[NAV.length - 1].v, reg: (document.querySelector('form[data-f=zcSend] select[name=reg]') || {}).value, d: (document.querySelector('form[data-f=zcSend] input[name=d]') || {}).value }));
  check('סגירת קופה: נפתח מסך סגירת הקופה עם הסניף והתאריך מההתראה', zc1.v === 'zc' && zc1.reg === 'i_yh' && zc1.d === P, Object.assign(zc1, { P }));
  check('מסך סגירת הקופה: בלי גלילה לרוחב', (await sx(page)) <= 0);
  // סגירה שנשמרה לאותו סניף ותאריך – ההתראה מסומנת כטופלה (שמירה אמיתית ב-FRM.zcSend, הענן מדומה)
  const sv = await page.evaluate(async () => {
    const W = (ms) => new Promise((r) => setTimeout(r, ms || 150));
    const c = document.createElement('canvas'); c.width = 40; c.height = 60; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 40, 60); const DU = c.toDataURL('image/jpeg');
    ZC.z = [DU, DU, DU]; ZC.o = DU; Object.assign(ZC.f, { tm: '22:00', no: '77', cash: '500', total: '500', drawer: '500', oTot: '500', oD: ZC.f.d, oTm: '07:00' }); ZC.cnt = { 100: '5' }; ZC.ack = 1;
    COQ.L = []; COQ.at = Date.now();
    const f0 = window.fsx; window.fsx = async (p, o) => { if (/^\/zlast\//.test(p) && !(o && o.method)) throw Object.assign(new Error('nf'), { code: 404 }); return {}; };
    const n0 = (S.zc || []).length;
    try { await FRM.zcSend(document.querySelector('form[data-f=zcSend]')); await W(400); } finally { window.fsx = f0; }
    return { saved: (S.zc || []).length === n0 + 1, reset: !ZC.f, t: window.__toasts.slice(-3).join(' | ') };
  });
  await H.settle(page, 2600);
  check('סגירה שנשמרה לסניף ולתאריך שבהתראה – ההתראה מסומנת כטופלה (נשלח done)', sv.saved && sv.reset && all(bodies, 'secNotes', (b) => b.op === 'done' && b.id === 'c1').length === 1 && /ההתראה על סגירת הקופה סומנה כטופלה/.test(await toasts(page)), sv);
  // --- סגירת קופה, שני סניפים: בחירה ---
  await notesTab(page);
  await page.evaluate(() => { ZC = null; });
  await openDlg(page, 'c2');
  await page.click('#secNAct [data-a=secNZc]'); await H.settle(page, 400);
  const pk = await dlgText(page);
  check('שני סניפים: חלון "איזה סניף?" עם שני הסניפים', /איזה סניף/.test(pk) && /יהודה הנשיא/.test(pk) && /נחל לכיש/.test(pk), pk.slice(0, 200));
  await page.click('#dlg [data-a=secNZc][data-g=i_nl]'); await H.settle(page, 600);
  const zc2 = await page.evaluate(() => ({ v: NAV[NAV.length - 1].v, reg: (document.querySelector('form[data-f=zcSend] select[name=reg]') || {}).value, d: (document.querySelector('form[data-f=zcSend] input[name=d]') || {}).value }));
  check('שני סניפים: אחרי הבחירה – מסך הסגירה עם הסניף שנבחר והתאריך', zc2.v === 'zc' && zc2.reg === 'i_nl' && zc2.d === P, zc2);
  // סגירה שהתחלת למלא לא נדרסת
  await page.evaluate(() => { ZC.f.no = '555'; });
  await notesTab(page); await openDlg(page, 'c2'); await page.click('#secNAct [data-a=secNZc]'); await H.settle(page, 400); await page.click('#dlg [data-a=secNZc][data-g=i_yh]'); await H.settle(page, 500);
  check('סגירה שהתחלת למלא לא נדרסת (עם הודעה)', (await page.evaluate(() => ZC.f.no === '555' && ZC.reg === 'i_nl')) && /יש סגירה שהתחלת למלא/.test(await toasts(page)));
  await page.evaluate(() => { ZC = null; });

  // --- חשבונית לתשלום: התאמה אחת – "סמן כשולם" דרך חלון סגירת התשלום של האפליקציה ---
  await notesTab(page);
  await openDlg(page, 'i1');
  const i1d = await dlgText(page);
  check('חשבונית עם התאמה אחת: כפתור ראשי "סמן כשולם" + "כרטיס הספק"', /סמן כשולם/.test(await txt(page, '#secNAct')) && !!(await page.$('#secNAct [data-k=card]')), i1d.slice(0, 200));
  await page.click('#secNAct [data-k=pay]'); await H.settle(page, 400);
  const pd = await dlgText(page);
  check('"סמן כשולם": חלון אישור עם הספק, מספר החשבונית והסכום (חלון סגירת התשלום של האפליקציה)', !!(await page.$('#dlg form[data-f=paysave]')) && /ספק בדיקה/.test(pd) && /INV77/.test(pd) && /500/.test(pd), pd.slice(0, 200));
  const noPayYet = await page.evaluate(() => S.tx.find((t) => t.id === 'q77').pays.length === 0);
  await page.click('#dlg form[data-f=paysave] label.chip:has-text("מזומן")'); await page.click('#dlg form[data-f=paysave] button.btn:not([type=button])'); await H.settle(page, 2500);
  const paid = await page.evaluate(() => { const t = S.tx.find((x) => x.id === 'q77'); return { bal: bal(t), m: (t.pays[0] || {}).m, n: t.pays.length }; });
  check('"סמן כשולם": לא נרשם תשלום לפני האישור; אחרי האישור – נרשם תשלום מלא באותו מבנה של האפליקציה', noPayYet && paid.bal < 0.005 && paid.m === 'מזומן' && paid.n === 1, paid);
  check('"סמן כשולם": אחרי ההצלחה ההתראה מסומנת כטופלה ויוצאת מהרשימה', all(bodies, 'secNotes', (b) => b.op === 'done' && b.id === 'i1').length === 1 && !(await page.$('#secNotes .secnb[data-id=i1]')) && /החשבונית סומנה כשולמה/.test(await toasts(page)), await toasts(page));
  // --- חשבונית בלי התאמה: ספק מוכר → כרטיס הספק; ספק לא מוכר → חשבוניות לתשלום ---
  await openDlg(page, 'i3');
  check('חשבונית שלא נמצאה אצל ספק מוכר: "פתיחת כרטיס הספק"', /פתיחת כרטיס הספק/.test(await txt(page, '#secNAct')) && !(await page.$('#secNAct [data-k=pay]')));
  await page.click('#secNAct .btn'); await H.settle(page, 500);
  check('כרטיס הספק נפתח', (await page.evaluate(() => NAV[NAV.length - 1].v === 'card' && NAV[NAV.length - 1].a === 'TS1')));
  await notesTab(page); await openDlg(page, 'i2');
  check('חשבונית של ספק לא מוכר: "פתיחת החשבוניות לתשלום"', /פתיחת החשבוניות לתשלום/.test(await txt(page, '#secNAct')));
  await page.click('#secNAct .btn'); await H.settle(page, 500);
  check('מסך "חשבוניות לתשלום" נפתח', (await view(page)) === 'due');

  // --- משימות ---
  await notesTab(page);
  await page.evaluate(() => { window.__sec.nl.notes.find((n) => n.id === 't1').st = 'open'; rerender(); }); await H.settle(page, 200);
  await page.click('#secNotes .chip.secpa[data-id=t1]'); await H.settle(page, 600);
  check('משימות: השבב בשורה פותח את המשימות בלשונית "באיחור"', (await view(page)) === 'tk' && (await page.evaluate(() => TKT)) === 'late');
  // --- יומן ---
  await notesTab(page); await openDlg(page, 'k1');
  check('יומן: "פתח ביומן" + "סמן כטופל" + "תזכירי לי שוב"', /פתח ביומן/.test(await txt(page, '#secNAct')) && !!(await page.$('#dlg [data-a=secNDoneD]')) && !!(await page.$('#dlg [data-a=secSnz]')));
  await page.click('#secNAct .btn'); await H.settle(page, 700);
  const cal = await page.evaluate(() => ({ tab: window.__sec.tab, cd: window.__sec.cd, v: NAV[NAV.length - 1].v }));
  check('יומן: נפתחת לשונית היומן על היום של האירוע', cal.v === 'sec' && cal.tab === 'cal' && cal.cd === CALD && /להתקשר לרו"ח/.test(await txt(page)), cal);
  // --- מידע על העסק ---
  await notesTab(page); await openDlg(page, 'f1');
  await page.click('#secNAct .btn'); await H.settle(page, 700);
  check('מידע על העסק: נפתחת לשונית "מידע על העסק"', (await page.evaluate(() => window.__sec.tab)) === 'facts' && (await view(page)) === 'sec' && /מבצע חנוכה/.test(await txt(page)));
  // --- גיבוי ---
  await notesTab(page); await openDlg(page, 'b1');
  check('גיבוי: כפתור "גבה עכשיו"', /גבה עכשיו/.test(await txt(page, '#secNAct')));
  await page.evaluate(() => { window.__bk = 0; window.bkCloud = async (m) => { window.__bk++; return m === true; }; });
  // bkCloud הוא פונקציה גלובלית – הקריאה מההתראה הולכת לפונקציה הקיימת. כאן היא מוחלפת במדומה, כדי לא לגבות באמת לענן בבדיקה
  await page.click('#secNAct [data-k=bk]'); await H.settle(page, 2600);
  check('גיבוי: "גבה עכשיו" מפעיל את פונקציית הגיבוי הקיימת (bkCloud ידני), ואחרי הצלחה ההתראה מסומנת כטופלה', (await page.evaluate(() => window.__bk)) === 1 && all(bodies, 'secNotes', (b) => b.op === 'done' && b.id === 'b1').length === 1 && /הגיבוי הושלם/.test(await toasts(page)));

  check('בלי שגיאות JS', page.__errors.length === 0, page.__errors);
  await ctx.close();
  await browser.close();
  console.log(fail ? `נכשלו ${fail}` : 'הכול עבר'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
