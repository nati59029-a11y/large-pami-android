'use strict';
// המזכירה – "התראות מהטלפון" (www/sec-notif.js, 22.11.2026). תוסף מדומה: window.Capacitor.Plugins.LpNotif.
// בדפדפן: הסבר "זמין רק באפליקציה". באפליקציה: הפעלה (בחירת אפליקציות, ברירת מחדל, החרגה, "תן גישה"), קליטה מהתור (pull + אירוע notif),
// מונה בלשונית, "פתח משימה" (פענוח sec-cmd → כרטיס אישור → כתיבה כמו במזכירה, מזהה קבוע), "התעלם", "לא לקלוט מהשולח",
// "שאלי את המזכירה" (רק בלחיצה – secChat), למידה: הצעה אחרי פעמיים, "כן, לבצע לבד" → ביצוע אוטומטי + יומן, עצירה, מחיקת כלל.
// פרטיות: אין טקסט הודעה ב-localStorage (רק מזהים/החלטות), יציאה מהחשבון מכבה ומוחקת, העברה לחשבון אחר מוחקת את המידע הקודם. תקרה לביצוע אוטומטי.
// רשת מדומה (בלי שרת). 360px: בלי גלילה לרוחב, בלי שגיאות JS. שימוש: node ui-notif1.js <www-dir> [shots-dir]
const fs = require('fs');
const path = require('path');
const H = require('./harness');
let fail = 0;
const check = (name, ok, info) => { if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const BIZ = 'biz-o';
const FEAT = { scan: true, tasks: true, orders: true, suppliers: true, cashClose: true, secretary: true };
const S = (v) => ({ stringValue: String(v) });

async function open(browser, www) {
  const who = 'm';
  const cfg = { mode: 'new', users: { [who]: BIZ }, sa: {}, biz: { [BIZ]: { dataRoot: 'b', features: FEAT, name: 'עסק בדיקה' } },
    admins: { [`b/${BIZ}/|${who}`]: 1 }, staff: { [`b/${BIZ}/|${who}`]: 1 }, ctx: { hasTouch: true, isMobile: true, viewport: { width: 360, height: 740 } } };
  const bodies = [], tasks = {};
  const st = { ok: true, consented: true, setupDone: true, name: 'רותי', addr: 'f', call: 'נתי', rows: [], mode: 'all', pay: true, emp: true, sens: false, we: 'warn', mirror: false, mirrorAt: null, cfTh: null, pct: 10, saving: '', nt: {}, types: {}, unseen: 0 };
  const { ctx, page } = await H.newPage(browser, www, cfg, [], who);
  await ctx.route(/:5001\/.*/, async (route) => {
    const n = new URL(route.request().url()).pathname.split('/').pop();
    let body = {}; try { body = JSON.parse(route.request().postData() || '{}').data || {}; } catch (e) { /* */ }
    bodies.push([n, body]);
    const ok = (r) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: r }) });
    if (n === 'secState') return ok(st);
    if (n === 'secChatLoad') return ok({ ok: true, msgs: [] });
    if (n === 'secChat') return ok({ id: 'c1', reply: 'כדאי לאשר לספק את המשלוח.', src: [] });
    if (n === 'secNotes') return ok({ ok: true, notes: [], unseen: 0, types: {} });
    return ok(n === 'getBackupKey' ? { key: Buffer.alloc(32, 7).toString('base64') } : {});
  });
  // עובדים ומשימות (Firestore מדומה): POST tasks?documentId= – קיים = 409 (כמו השרת)
  await ctx.route((u) => new URL(u).port === '8080', async (route) => {
    const req = route.request(), u = new URL(req.url()), p = decodeURIComponent(u.pathname), m = req.method();
    const ok = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (m === 'GET' && /\/b\/biz-o\/staff$/.test(p)) return ok({ documents: [['u1', 'מרים כהן'], ['u2', 'יוסי לוי']].map(([id, nm]) => ({ name: 'projects/demo-largpeami/databases/(default)/documents/b/biz-o/staff/' + id, fields: { name: S(nm), email: S(id + '@x.co'), active: { booleanValue: true } } })) });
    if (m === 'POST' && /\/b\/biz-o\/tasks$/.test(p)) { const id = u.searchParams.get('documentId'); const f = JSON.parse(req.postData() || '{}').fields;
      if (tasks[id]) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 409, message: 'ALREADY_EXISTS', status: 'ALREADY_EXISTS' } }) });
      tasks[id] = f; return ok({ name: 'x/' + id, fields: f }); }
    return route.fallback();
  });
  await H.login(page, who + '@x.co');
  await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden && ACT.startBlank) ACT.startBlank(); });
  await H.settle(page, 800);
  await page.evaluate(() => { window.__toasts = []; const t0 = window.toast; window.toast = (t) => { window.__toasts.push(t); t0(t); }; });
  return { ctx, page, bodies, tasks };
}
const txt = (page, sel) => page.evaluate((s) => (document.querySelector(s || '#main') || {}).innerText || '', sel);
const sx = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const toasts = (page) => page.evaluate(() => window.__toasts.join(' | '));
const dlgText = (page) => page.evaluate(() => document.getElementById('dlg').open ? document.getElementById('dlg').innerText : '');
const dlgOk = async (page) => { await page.click('#dlg .btn:not(.g)'); await H.settle(page, 400); };
const cardBtn = (page, re, a) => page.evaluate(([r, a]) => { const c = [...document.querySelectorAll('#main .card')].find((x) => new RegExp(r).test(x.innerText) && x.querySelector('[data-a=' + a + ']')); if (!c) return false; c.querySelector('[data-a=' + a + ']').click(); return true; }, [re, a]);
const plugin = (page) => page.evaluate(() => {
  const L = {};
  window.__nf = { cfg: { on: false, pkgs: [], skip: [], u: '' }, en: false, q: [], calls: [], fire: (n, d) => (L[n] || []).forEach((f) => f(d || {})) };
  const N = window.__nf;
  const P = {
    isEnabled: async () => ({ on: N.en }), openSettings: async () => { N.calls.push(['openSettings']); },
    getConfig: async () => JSON.parse(JSON.stringify(N.cfg)), setConfig: async (c) => { N.calls.push(['setConfig', c]); N.cfg = JSON.parse(JSON.stringify(c)); },
    getApps: async () => ({ apps: [{ p: 'com.android.calculator2', l: 'מחשבון' }, { p: 'com.google.android.gm', l: 'Gmail' }, { p: 'com.google.android.apps.messaging', l: 'Messages' }, { p: 'com.whatsapp', l: 'WhatsApp' }, { p: 'com.whatsapp.w4b', l: 'WhatsApp Business' }] }),
    pull: async (o) => { N.calls.push(['pull', !!(o && o.all)]); const it = N.q.filter((x) => (o && o.all) || !x.d); N.q.forEach((x) => { x.d = 1; }); return { items: JSON.parse(JSON.stringify(it)), on: N.en }; },
    clear: async () => { N.calls.push(['clear']); N.q = []; },
    addListener: async (n, f) => { (L[n] = L[n] || []).push(f); return { remove: () => {} }; },
  };
  window.Capacitor = Object.assign(window.Capacitor || {}, { isNativePlatform: () => true, Plugins: Object.assign((window.Capacitor && window.Capacitor.Plugins) || {}, { LpNotif: P }) });
});
let seq = 0;
// כל הערכים ב-localStorage – לבדיקה שאין בהם טקסט של הודעה
const lsHas = (page, words) => page.evaluate((w) => { const all = Object.keys(localStorage).map((k) => k + '=' + localStorage.getItem(k)).join('\n'); return w.filter((x) => all.includes(x)); }, words);
const stM = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('lp-ntf-m-m') || '{}'));
const push = (page, o) => page.evaluate((x) => { window.__nf.q.push(x); window.__nf.fire('notif'); }, Object.assign({ k: 'com.whatsapp|k' + (++seq), p: 'com.whatsapp', a: 'WhatsApp', s: 'דני ספק', x: 'הודעה', t: Date.now() - seq * 1000, d: 0 }, o));

(async () => {
  const [www0, shots] = process.argv.slice(2); const www = path.resolve(www0);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const browser = await H.launch();
  const o = await open(browser, www); const page = o.page;
  await page.evaluate(() => go('sec')); await H.settle(page, 700);
  check('יש לשונית "התראות מהטלפון" למנהל', !!(await page.$('#secTabs [data-v=notif]')));
  await page.click('#secTabs [data-v=notif]'); await H.settle(page, 400);
  check('בדפדפן: "זמין רק באפליקציה בטלפון"', /זמין רק באפליקציה בטלפון/.test(await txt(page)));
  check('בדפדפן לא נשלח כלום לשרת על התראות', !o.bodies.some((b) => /notif/i.test(b[0])));

  // --- באפליקציה (תוסף מדומה) ---
  await plugin(page);
  // עותק ישן מגרסה קודמת (עם טקסט) – צריך להימחק בקליטה הראשונה
  await page.evaluate(() => localStorage.setItem('lp-ntf-in-m', JSON.stringify([{ k: 'old|1', s: 'ישן', x: 'סוד ישן', st: 'done', t: 1 }])));
  await page.evaluate(() => rerender()); await H.settle(page, 600);
  const t1 = await txt(page);
  check('הפעלה: הסבר מה נקלט ומה לא', /רק מהאפליקציות שתבחרו/.test(t1) && /לא כל השיחה/.test(t1) && /ההתראות נשמרות רק בטלפון/.test(t1) && /נכנסים למשימה ונראים לעובד שמקבל אותה/.test(t1) && /'שאלי את המזכירה' שולח את הטקסט לבינה המלאכותית/.test(t1) && !/לא נשלח לשרת/.test(t1), t1.slice(0, 300));
  const boxes = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('form[data-f=secNfSave] input[name=p]')].map((i) => [i.value, i.checked])));
  check('ברירת מחדל: WhatsApp, WhatsApp Business ו-SMS מסומנים; Gmail מוצע ולא מסומן; מחשבון רק ב"כל האפליקציות"',
    boxes['com.whatsapp'] && boxes['com.whatsapp.w4b'] && boxes['com.google.android.apps.messaging'] && boxes['com.google.android.gm'] === false && boxes['com.android.calculator2'] === false && !('com.samsung.android.messaging' in boxes), boxes);
  await page.click('[data-a=secNfOpen]'); await H.settle(page, 200);
  check('"תן גישה להתראות" פותח את ההגדרות של אנדרואיד', await page.evaluate(() => window.__nf.calls.some((c) => c[0] === 'openSettings')));
  if (shots) await page.screenshot({ path: path.join(shots, 'notif-setup-360.png'), fullPage: true });
  check('360px: בלי גלילה לרוחב (הפעלה)', (await sx(page)) <= 1, await sx(page));
  await page.fill('form[data-f=secNfSave] textarea[name=skip]', 'ספאם בע"מ\n');
  await page.click('form[data-f=secNfSave] button.btn'); await H.settle(page, 500);
  const sc = await page.evaluate(() => (window.__nf.calls.filter((c) => c[0] === 'setConfig').pop() || [])[1]);
  check('שמירה: setConfig עם האפליקציות שנבחרו, ההחרגה והחשבון', sc && sc.on === true && sc.u === 'm' && JSON.stringify(sc.pkgs.slice().sort()) === JSON.stringify(['com.google.android.apps.messaging', 'com.whatsapp', 'com.whatsapp.w4b']) && JSON.stringify(sc.skip) === JSON.stringify(['ספאם בע"מ']), sc);
  check('אין גישה עדיין: מציעה לפתוח את ההגדרות', /גישה להתראות/.test(await dlgText(page)), await dlgText(page));
  await page.evaluate(() => closeDlg());
  check('אין גישה: אזהרה ברשימה', /אין גישה להתראות/.test(await txt(page)));
  await page.evaluate(() => { window.__nf.en = true; }); await page.click('[data-a=secNfRe]'); await H.settle(page, 400);
  check('אחרי מתן גישה: האזהרה נעלמת', !/אין גישה להתראות/.test(await txt(page)));

  // --- קליטה ---
  await push(page, { s: 'דני ספק', x: 'תני למרים לסדר את המחסן עד מחר' });
  await push(page, { s: 'בנק', a: 'Messages', p: 'com.google.android.apps.messaging', k: 'sms|b1', x: 'קוד אימות 1234' });
  await H.settle(page, 900);
  let t2 = await txt(page);
  check('אירוע notif: ההתראות נמשכו ומוצגות עם שולח, אפליקציה וטקסט', /דני ספק/.test(t2) && /תני למרים לסדר את המחסן/.test(t2) && /Messages/.test(t2) && /קוד אימות 1234/.test(t2), t2.slice(0, 400));
  { const nb = await page.evaluate(() => ['secNfTask', 'secNfRem', 'secNfAsk', 'secNfDone', 'secNfIgn', 'secNfBlock'].map((a) => document.querySelectorAll('#main [data-a=' + a + ']').length));
    check('"מה לעשות?" עם כל ששת הכפתורים בכל כרטיס', /מה לעשות\?/.test(t2) && nb.every((n) => n === 2), nb); }
  check('מונה לא-טופלו על הלשונית (2)', /התראות מהטלפון\s*2/.test(await txt(page, '#secTabs')), await txt(page, '#secTabs'));
  check('שום תוכן התראה לא נשלח לשרת בלי לחיצה', !o.bodies.some((b) => JSON.stringify(b).includes('קוד אימות')));
  { const h = await lsHas(page, ['קוד אימות', 'תני למרים', 'דני ספק', 'סוד ישן']);
    check('פרטיות: אחרי קליטה אין ב-localStorage טקסט הודעה או שולח (גם העותק הישן נמחק)', h.length === 0 && !(await page.evaluate(() => localStorage.getItem('lp-ntf-in-m'))), h); }
  check('קליטה ראשונה: נטען כל התור מהתוסף (pull all)', await page.evaluate(() => window.__nf.calls.some((c) => c[0] === 'pull' && c[1] === true)));
  if (shots) await page.screenshot({ path: path.join(shots, 'notif-list-360.png'), fullPage: true });
  check('360px: בלי גלילה לרוחב (רשימה)', (await sx(page)) <= 1, await sx(page));

  // פתח משימה: sec-cmd מזהה "למרים" → כרטיס אישור
  await cardBtn(page, 'תני למרים', 'secNfTask'); await H.settle(page, 900);
  const t3 = await txt(page);
  check('פתח משימה: כרטיס אישור עם הטקסט שפוענח והעובדת', /לפתוח משימה\?/.test(t3) && /מה: לסדר את המחסן/.test(t3) && /למי: מרים כהן/.test(t3), t3.slice(0, 500));
  await cardBtn(page, 'לפתוח משימה', 'secNfTkOk'); await H.settle(page, 900);
  const ids = Object.keys(o.tasks);
  const f1 = ids.length ? o.tasks[ids[0]] : {};
  check('נפתחה משימה אחת, מזהה קבוע (secn…), למרים, באותם שדות כמו במזכירה', ids.length === 1 && /^secn[0-9a-f]{16}$/.test(ids[0]) && f1.txt.stringValue === 'לסדר את המחסן' && f1.ow.stringValue === 'u1' && f1.role.stringValue === 'a' && f1.st.stringValue === 'open', { ids, f1 });
  check('ההתראה עברה ל"טופלו לאחרונה" והמונה ירד ל-1', /טופלו לאחרונה \(1\)/.test(await txt(page)) && /התראות מהטלפון\s*1/.test(await txt(page, '#secTabs')), await txt(page, '#secTabs'));

  // התעלם ×2 מאותו שולח → הצעה ללמוד
  await cardBtn(page, 'קוד אימות', 'secNfIgn'); await H.settle(page, 300);
  check('אחרי פעם אחת "התעלם" – אין עדיין הצעה', !/ללמוד\?/.test(await txt(page)));
  await push(page, { s: 'בנק', a: 'Messages', p: 'com.google.android.apps.messaging', k: 'sms|b2', x: 'קוד אימות 5678' }); await H.settle(page, 800);
  await cardBtn(page, 'קוד אימות 5678', 'secNfIgn'); await H.settle(page, 300);
  const t4 = await txt(page);
  check('אחרי פעמיים: "ללמוד? מעכשיו כשמגיעה הודעה מבנק – לסמן התעלם"', /ללמוד\?/.test(t4) && /מעכשיו כשמגיעה הודעה מבנק/.test(t4) && /התעלם/.test(t4) && /כן, לבצע לבד/.test(t4) && /תמיד לשאול/.test(t4), t4.slice(0, 400));
  if (shots) await page.screenshot({ path: path.join(shots, 'notif-learn-360.png'), fullPage: true });
  await page.click('[data-a=secNfRuleOk]'); await H.settle(page, 300);
  await push(page, { s: 'בנק (2 הודעות)', a: 'Messages', p: 'com.google.android.apps.messaging', k: 'sms|b3', x: 'קוד אימות 9999' }); await H.settle(page, 900);
  const inb = (await stM(page))['sms|b3'];
  check('כלל שאושר: ההתראה הבאה מהבנק סומנה "התעלם" לבד (המצב נשמר לפי מפתח בלבד)', inb && inb.st === 'ign' && inb.by === 'auto' && !('x' in inb) && !('s' in inb), inb);

  // משימה לאותו עובד פעמיים → כלל → פתיחה אוטומטית (מזהה קבוע, בלי כפילות)
  for (const k of ['s1', 's2']) {
    await push(page, { s: 'ספק ירקות', k: 'wa|' + k, x: 'הסחורה הגיעה ' + k });
    await H.settle(page, 800);
    await cardBtn(page, 'הסחורה הגיעה ' + k, 'secNfTask'); await H.settle(page, 800);
    await page.evaluate(() => { const b = [...document.querySelectorAll('[data-a=secNfWho]')].find((x) => /יוסי/.test(x.innerText)); if (b) b.click(); }); await H.settle(page, 200);
    await cardBtn(page, 'לפתוח משימה', 'secNfTkOk'); await H.settle(page, 800);
  }
  const t5 = await txt(page);
  check('אין זיהוי עובד: כרטיס עם "<שולח>: <טקסט>" ובחירת עובד; אחרי פעמיים ליוסי – הצעה', /ספק ירקות: הסחורה הגיעה s1/.test(JSON.stringify(o.tasks)) && /מעכשיו כשמגיעה הודעה מספק ירקות/.test(t5) && /לפתוח משימה ליוסי לוי/.test(t5), t5.slice(0, 400));
  check('"ללמוד?" למשימה: אזהרה שכל הודעה מהשולח תיפתח כמשימה כולל הטקסט', /כל הודעה מהשולח הזה תיפתח כמשימה לעובד, כולל הטקסט שלה/.test(t5));
  await page.click('[data-a=secNfRuleOk]'); await H.settle(page, 300);
  const n0 = Object.keys(o.tasks).length;
  await push(page, { s: 'ספק ירקות', k: 'wa|s3', x: 'חסרים עגבניות' }); await H.settle(page, 1200);
  const ids2 = Object.keys(o.tasks); const nt = ids2.map((k) => o.tasks[k]).find((f) => /חסרים עגבניות/.test(f.txt.stringValue));
  check('כלל משימה: נפתחה משימה לבד ליוסי, באותם שדות', ids2.length === n0 + 1 && nt && nt.ow.stringValue === 'u2' && nt.txt.stringValue === 'ספק ירקות: חסרים עגבניות', { n: ids2.length, nt });
  // אותה התראה שוב (מפתח זהה) – לא נכנסת שוב ולא נפתחת משימה שנייה
  await page.evaluate(() => { const x = window.__nf.q.find((y) => y.k === 'wa|s3'); x.d = 0; window.__nf.fire('notif'); }); await H.settle(page, 900);
  check('מפתח שכבר נקלט: אין התראה כפולה ואין משימה נוספת', Object.keys(o.tasks).length === n0 + 1 && (await page.evaluate(() => [...document.querySelectorAll('#main .secli')].filter((x) => /חסרים עגבניות/.test(x.textContent)).length)) === 1);

  // תקרה: 12 הודעות בבת אחת מאותו שולח – נפתחות 10, השתיים הנותרות ממתינות להחלטה
  await page.evaluate(() => { for (let i = 1; i <= 12; i++) window.__nf.q.push({ k: 'wa|c' + i, p: 'com.whatsapp', a: 'WhatsApp', s: 'ספק ירקות', x: 'הזמנה מספר ' + i, t: Date.now() - 100000 + i, d: 0 }); window.__nf.fire('notif'); });
  await H.settle(page, 2000);
  const nc = Object.keys(o.tasks).length - (n0 + 1), tc = await txt(page);
  check('תקרה בעיבוד אחד: נפתחו 10 משימות לבד, 2 ממתינות עם הודעה', nc === 10 && (tc.match(/הגעתי לתקרה של 10 משימות אוטומטיות בבת אחת – ממתין לאישורך/g) || []).length === 2, { nc });
  // תקרה יומית: מונה הכלל כבר 30 היום
  await page.evaluate(() => { const k = Object.keys(localStorage).find((x) => /^lp-ntf-biz-o\|m$/.test(x)); const v = JSON.parse(localStorage.getItem(k)); v.C.n['com.whatsapp|ספק ירקות'] = 30; localStorage.setItem(k, JSON.stringify(v)); });
  const n1 = Object.keys(o.tasks).length;
  await push(page, { s: 'ספק ירקות', k: 'wa|d1', x: 'הזמנה אחרי התקרה' }); await H.settle(page, 1000);
  const td = await txt(page);
  check('תקרה יומית לכלל (30): אין משימה, ההתראה ממתינה עם "הגעתי לתקרה היומית של הכלל – ממתין לאישורך"', Object.keys(o.tasks).length === n1 && /הזמנה אחרי התקרה/.test(td) && /הגעתי לתקרה היומית של הכלל – ממתין לאישורך/.test(td));
  { const h = await lsHas(page, ['הזמנה מספר', 'חסרים עגבניות', 'הזמנה אחרי התקרה']); check('פרטיות: גם אחרי ביצוע אוטומטי אין טקסט הודעה ב-localStorage', h.length === 0, h); }

  // הכללים שנלמדו + יומן + עצירה
  await page.click('[data-a=secNfV][data-v=rules]'); await H.settle(page, 300);
  const t6 = await txt(page);
  check('"הכללים שנלמדו": שני הכללים, יומן "מה עשיתי לבד" עם קישור למשימה', /בנק/.test(t6) && /ספק ירקות/.test(t6) && /מה עשיתי לבד/.test(t6) && /נפתחה משימה ליוסי לוי/.test(t6) && /סומן "התעלם"/.test(t6) && !!(await page.$('#main [data-a=secCxGo][data-tid^=secn]')), t6.slice(0, 600));
  if (shots) await page.screenshot({ path: path.join(shots, 'notif-rules-360.png'), fullPage: true });
  check('360px: בלי גלילה לרוחב (כללים)', (await sx(page)) <= 1, await sx(page));
  await page.click('[data-c=secNfStop]'); await H.settle(page, 200);
  await page.click('[data-a=secNfV][data-v=list]'); await H.settle(page, 200);
  const n2 = Object.keys(o.tasks).length;
  await push(page, { s: 'ספק ירקות', k: 'wa|s4', x: 'עוד הזמנה' }); await H.settle(page, 900);
  check('עצירת הביצוע האוטומטי: אין משימה חדשה, ההתראה ממתינה', Object.keys(o.tasks).length === n2 && /עוד הזמנה/.test(await txt(page)));
  await page.click('[data-a=secNfV][data-v=rules]'); await H.settle(page, 200);
  await page.evaluate(() => { const b = [...document.querySelectorAll('[data-a=secNfRuleDel]')].find((x) => /בנק/.test(x.closest('.secli').innerText)); b.click(); }); await H.settle(page, 200);
  await dlgOk(page);
  check('מחיקת כלל', !/הודעה מבנק/.test(await txt(page)) && /ספק ירקות/.test(await txt(page)));
  await page.click('[data-a=secNfV][data-v=list]'); await H.settle(page, 200);

  // לא לקלוט מהשולח
  await push(page, { s: 'פרסומות', k: 'wa|p1', x: 'מבצע!' }); await H.settle(page, 800);
  await cardBtn(page, 'מבצע!', 'secNfBlock'); await H.settle(page, 200); await dlgOk(page);
  const sc2 = await page.evaluate(() => (window.__nf.calls.filter((c) => c[0] === 'setConfig').pop() || [])[1]);
  check('"לא לקלוט מהשולח הזה": נוסף להחרגה בתוסף, וההתראה ירדה מהרשימה', sc2 && sc2.skip.includes('פרסומות') && sc2.skip.includes('ספאם בע"מ') && !/מבצע!/.test(await txt(page)), sc2);

  // שאלי את המזכירה – רק כאן התוכן יוצא
  await cardBtn(page, 'עוד הזמנה', 'secNfAsk'); await H.settle(page, 900);
  const ch = o.bodies.filter((b) => b[0] === 'secChat').pop();
  check('"שאלי את המזכירה": נשלח לצ\'אט בנוסח שנקבע, והמסך עבר לשיחה', ch && ch[1].text === 'התקבלה הודעה בWhatsApp מספק ירקות: «עוד הזמנה». מה מומלץ לעשות?' && (await page.evaluate(() => window.__sec.tab)) === 'chat', ch && ch[1].text);

  // תזכורת – החלון הקיים, ממולא
  await page.click('#secTabs [data-v=notif]'); await H.settle(page, 500);
  await push(page, { s: 'רו"ח', k: 'wa|r1', x: 'לשלוח דוחות' }); await H.settle(page, 800);
  await cardBtn(page, 'לשלוח דוחות', 'secNfRem'); await H.settle(page, 300);
  const rv = await page.evaluate(() => { const i = document.querySelector('#dlg form[data-f=tkwRem] input[name=txt]'); return i ? i.value : null; });
  check('תזכורת: חלון "תזכורת חדשה" הקיים, ממולא בטקסט', rv === 'רו"ח: לשלוח דוחות', rv);
  await page.evaluate(() => { const f = document.querySelector('#dlg form[data-f=tkwRem]'); f.querySelector('[data-a=tkwRQ][data-v=t]').click(); f.requestSubmit(); }); await H.settle(page, 500);
  const rm = await page.evaluate(() => ({ r: JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => /lp-rem/.test(k))) || '[]'), it: JSON.parse(localStorage.getItem('lp-ntf-m-m') || '{}')['wa|r1'] }));
  check('אחרי שמירת התזכורת: נשמרה, וההתראה סומנה "נקבעה תזכורת"', rm.r.some((r) => r.txt === 'רו"ח: לשלוח דוחות') && rm.it && rm.it.st === 'rem', rm);

  // כיבוי
  await page.click('#secTabs [data-v=notif]'); await H.settle(page, 300);
  await page.click('[data-a=secNfV][data-v=set]'); await H.settle(page, 300);
  await page.click('[data-a=secNfOff]'); await H.settle(page, 200); await dlgOk(page);
  check('כיבוי: setConfig on:false', await page.evaluate(() => window.__nf.cfg.on === false));

  // העברת הקליטה לחשבון אחר: המידע המקומי של החשבון הקודם נמחק
  await page.evaluate(() => { window.__nf.cfg = { on: true, pkgs: ['com.whatsapp'], skip: [], u: 'other' }; window.__nf.q = [{ k: 'wa|o1', p: 'com.whatsapp', a: 'WhatsApp', s: 'א', x: 'של אחר', t: Date.now(), d: 0 }];
    localStorage.setItem('lp-ntf-m-other', '{"wa|o1":{"st":"done","at":1}}'); localStorage.setItem('lp-ntf-biz-o|other', '{"R":{}}'); localStorage.setItem('lp-ntf-in-other', '[]'); });
  await page.click('#secTabs [data-v=notif]'); await H.settle(page, 500);
  check('קליטה בחשבון אחר: כפתור "הפעל לחשבון שלי"', !!(await page.$('#main [data-a=secNfTake]')));
  await page.click('#main [data-a=secNfTake]'); await H.settle(page, 200); await dlgOk(page); await H.settle(page, 600);
  const tk = await page.evaluate(() => ({ ks: Object.keys(localStorage).filter((k) => /^lp-ntf-/.test(k) && /other$/.test(k)), cfg: window.__nf.cfg, q: window.__nf.q.length }));
  check('"הפעל לחשבון שלי": התור נמחק, המפתחות המקומיים של החשבון הקודם נמחקו, הקליטה לחשבון שלי', tk.ks.length === 0 && tk.q === 0 && tk.cfg.u === 'm' && tk.cfg.on === true, tk);

  // יציאה מהחשבון: כיבוי הקליטה, מחיקת התור והמפתחות המקומיים
  await page.evaluate(() => { window.__nf.q.push({ k: 'wa|z1', p: 'com.whatsapp', a: 'WhatsApp', s: 'ז', x: 'לפני יציאה', t: Date.now(), d: 0 }); window.__nf.calls = []; TKW.out(SY.uid); });
  await H.settle(page, 500);
  const lo = await page.evaluate(() => ({ ks: Object.keys(localStorage).filter((k) => /^lp-ntf-/.test(k)), cfg: window.__nf.cfg, q: window.__nf.q.length, cl: window.__nf.calls.some((c) => c[0] === 'clear') }));
  check('יציאה מהחשבון: setConfig on:false, clear בתוסף, אין מפתחות lp-ntf-*', lo.cfg.on === false && lo.cfg.u === '' && lo.cfg.pkgs.length === 0 && lo.cl && lo.q === 0 && lo.ks.length === 0, lo);
  check('בלי שגיאות JS', page.__errors.length === 0, page.__errors);
  await browser.close();
  console.log(fail ? `\n${fail} בדיקות נכשלו` : '\nכל הבדיקות עברו');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
