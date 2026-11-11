'use strict';
// המזכירה העסקית – שלב 4 (2026-11-11): לשוניות "התראות" ו"דוחות", הגדרות התראות ודוחות, מחיקת היסטוריה באישור כפול, תזכורת ביומן (75),
// שורת התראות בכרטיס הבית ורישום הטלפון להתראות. רשת מדומה (בלי שרת, בלי FCM). ב-320 וב-360: בלי גלילה לרוחב, בלי שגיאות JS,
// וכל פעולה נשלחת לשרת בפורמט הנכון.
// שימוש: node ui-sec-4.js <www-dir> [shots-dir]
const fs = require('fs');
const path = require('path');
const H = require('./harness');
let fail = 0;
const check = (name, ok, info) => { if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const BIZ = 'biz-o';
const FEAT = { scan: true, tasks: true, orders: true, suppliers: true, cashClose: true, secretary: true };
const dk = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const addD = (k) => { const d = new Date(); d.setDate(d.getDate() + k); return dk(d); };
let SAT = 1; while (new Date(Date.now() + SAT * 864e5).getDay() !== 6) SAT++;
const SATD = addD(SAT), SUND = addD(SAT + 1);
const TYPES = { invDue: 'חשבונית לתשלום', invLate: 'חשבוניות באיחור (בדוח השבועי)', chk: 'צ\'ק שעומד להיפרע', task: 'משימות שעברו את הזמן', close: 'סגירת קופה חסרה או עם הפרש', backup: 'גיבוי ישן', fact: 'עובדה במידע על העסק שפגה', cal: 'אירועים ותזכורות מהיומן', emp: 'התראה מיידית על עובד' };
const NT = { wd: 0, wh: 8, mh: 8, dg: false, dh: 8, q: { on: true, f: '22:00', t: '07:00' }, reps: 3, rt: { invDue: true, invLate: true, chk: true, task: false, close: false, backup: false, fact: false, cal: true, emp: true } };

async function open(browser, www, o) {
  const who = 'm';
  const cfg = { mode: 'new', users: { [who]: BIZ }, sa: {}, biz: { [BIZ]: { dataRoot: 'b', features: FEAT, name: 'עסק בדיקה' } },
    admins: { [`b/${BIZ}/|${who}`]: 1 }, staff: { [`b/${BIZ}/|${who}`]: 1 }, ctx: { hasTouch: true, isMobile: true, viewport: { width: o.w || 360, height: o.h || 740 } } };
  const bodies = [];
  const st = { ok: true, consented: true, setupDone: true, name: 'רותי', addr: 'f', call: 'נתי', rows: [{ k: 'notes', t: '2 התראות חדשות' }], mode: 'all', pay: true, emp: true, sens: false, we: 'warn', mirror: true, mirrorAt: null, cfTh: null, pct: 10, saving: '', nt: NT, types: TYPES, unseen: 2 };
  const now = Date.now();
  const notes = [
    { id: 'n1', k: 'rem', typ: 'invDue', title: 'חשבונית לתשלום היום', body: 'חשבונית 501 של ספק החלב – יתרה 1,200 ₪', at: now - 60000, seen: false, st: 'open', rep: 3, n: 1 },
    { id: 'n2', k: 'emp', typ: 'emp', title: 'הפרש בקופה – דוד כהן', body: 'הפרש מספר 2 החודש בקופה של דוד כהן: 120 ₪, 80 ₪.\nמה לא ידוע: טעות ספירה. הפרש בקופה אינו הוכחה לגניבה.', at: now - 120000, seen: false, st: 'open', rep: 0, n: 1 },
    { id: 'n3', k: 'rep', typ: 'w', title: 'הדוח השבועי', body: 'חשבוניות לתשלום השבוע: 2 חשבוניות', at: now - 3600e3, seen: true, st: 'open', rep: 0, n: 1, ref: 'w_m_1' },
  ];
  const report = { id: 'w_m_1', kind: 'w', title: 'הדוח השבועי', key: addD(-1), t: now - 3600e3, why: '', src: 'נתוני הכספים מהמראה בענן, נכון ל-11.11 20:00',
    secs: [{ h: 'חשבוניות לתשלום השבוע', lines: ['2 חשבוניות, סך 1,500 ₪', '• ספק החלב – 1,200 ₪ עד ' + addD(2)] }, { h: 'משימות פתוחות', lines: ['5 פתוחות, מהן 1 באיחור'] }],
    ideas: [{ key: 'loss:2026-10', seen: 'ב-2026-10 ההוצאות (61000) גבוהות מההכנסות (50000).', why: 'חודש הפסדי חוזר פוגע בתזרים.', options: ['לבדוק אילו קטגוריות גדלו'], unknown: 'ייתכן שחלק מההכנסות עוד לא נרשמו.' }], done: [] };
  const { ctx, page } = await H.newPage(browser, www, cfg, [], who);
  await ctx.route(/:5001\/.*/, async (route) => {
    const n = new URL(route.request().url()).pathname.split('/').pop();
    let body = {}; try { body = JSON.parse(route.request().postData() || '{}').data || {}; } catch (e) { /* */ }
    bodies.push([n, body]);
    const ok = (r) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: r }) });
    if (n === 'secState') return ok(st);
    if (n === 'secChatLoad') return ok({ ok: true, msgs: [] });
    if (n === 'secNotes') return ok(body.op === 'list' ? { ok: true, notes, unseen: 2, types: TYPES } : { ok: true, id: body.id, n: 2 });
    if (n === 'secReports') return ok(body.op === 'list' ? { ok: true, reports: [{ id: 'w_m_1', kind: 'w', title: 'הדוח השבועי', key: report.key, t: report.t, why: '' }] } : body.op === 'get' ? { ok: true, report } : { ok: true, id: body.id, key: body.key });
    if (n === 'secPrefs') return ok(body.op === 'notify' ? { ok: true, nt: Object.assign({}, NT, body.nt), warn: body.nt.wd === 5 || body.nt.wd === 6 ? 'הדוח יופיע ביום העסקים הבא' : '' } : Object.assign({ ok: true }, body));
    if (n === 'secHistory') return ok(body.op === 'ask' ? { ok: true, token: 'tok123', exp: now + 600000, counts: { chat: 12, notes: 3, reports: 1 } } : { ok: true, deleted: { chat: 12, notes: 3, reports: 1 } });
    if (n === 'secCal') {
      if (body.op === 'list') return ok({ ok: true, today: addD(0), we: 'accept', events: [] });
      if (body.op === 'add' && body.rem && !body.force && body.d === SATD) return ok({ ok: false, warn: { kind: 'שבת', d: SATD, next: SUND, rem: true } });
      return ok({ ok: true, id: 'y' });
    }
    if (n === 'registerPushToken') return ok({ ok: true, count: 1, removed: 0 });
    return ok(n === 'getBackupKey' ? { key: Buffer.alloc(32, 7).toString('base64') } : {});
  });
  await H.login(page, who + '@x.co');
  await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden && ACT.startBlank) ACT.startBlank(); });
  await H.settle(page, 800);
  return { ctx, page, bodies, st };
}
const last = (bodies, n, f) => bodies.filter((b) => b[0] === n && (!f || f(b[1]))).pop();
const txt = (page) => page.evaluate(() => document.getElementById('main').innerText);
const sx = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const tab = async (page, v) => { await page.click(`#secTabs [data-v=${v}]`); await H.settle(page, 500); };
const dlgText = (page) => page.evaluate(() => document.getElementById('dlg').open ? document.getElementById('dlg').innerText : '');

(async () => {
  const [www, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const browser = await H.launch();
  for (const [w, h] of [[320, 640], [360, 740]]) {
    const { ctx, page, bodies } = await open(browser, www, { w, h });
    // רכיב התראות מדומה (Capacitor PushNotifications) – כדי לבדוק שהטלפון נרשם דרך השרת
    await page.evaluate(() => {
      const L = {}; window.__pn = [];
      window.Capacitor = window.Capacitor || {}; window.Capacitor.Plugins = Object.assign({}, window.Capacitor.Plugins || {}, { PushNotifications: {
        addListener: async (e, f) => { L[e] = f; window.__pn.push('on:' + e); return { remove() {} }; },
        checkPermissions: async () => ({ receive: 'prompt' }), requestPermissions: async () => { window.__pn.push('ask'); return { receive: 'granted' }; },
        register: async () => { window.__pn.push('register'); setTimeout(() => L.registration && L.registration({ value: 'fcm_token_' + 'x'.repeat(30) }), 10); },
      } });
    });
    await page.evaluate(() => { NAV = [{ v: 'home' }]; go('home'); }); await H.settle(page, 600);
    const th = await txt(page);
    check(`${w}: כרטיס הבית – שורת "2 התראות חדשות"`, /2 התראות חדשות/.test(th), th.slice(0, 200));
    await page.evaluate(() => go('sec')); await H.settle(page, 700);
    const t0 = await txt(page);
    check(`${w}: לשוניות – שיחה, התראות (עם מונה), דוחות, מידע על העסק, יומן, תשובות מוכנות`, /התראות/.test(t0) && /דוחות/.test(t0) && /תשובות מוכנות/.test(t0) && !!(await page.$('#secTabs .secbadge')));
    const pn = await page.evaluate(() => window.__pn);
    const reg = last(bodies, 'registerPushToken');
    check(`${w}: רישום הטלפון להתראות – בקשת הרשאה, רישום, ושליחת המזהה לשרת`, pn.includes('ask') && pn.includes('register') && reg && /^fcm_token_/.test(reg[1].token), { pn, reg: reg && reg[1] });

    // --- התראות ---
    await tab(page, 'notes');
    const tn = await txt(page);
    check(`${w}: התראות – תזכורת, התראה על עובד עם שם ופירוט, דוח; "טופל" ו"חזרות"`, /חשבונית לתשלום היום/.test(tn) && /דוד כהן/.test(tn) && /אינו הוכחה לגניבה/.test(tn) && /פתיחת הדוח/.test(tn) && !!(await page.$('[data-a=secNDone][data-id=n1]')) && !!(await page.$('select[data-c=secNReps][data-id=n1]')), tn.slice(0, 300));
    const seen = last(bodies, 'secNotes', (b) => b.op === 'seen');
    check(`${w}: פתיחת הרשימה מסמנת כנקראו (רק את החדשות)`, seen && seen[1].ids.join(',') === 'n1,n2', seen && seen[1]);
    await page.selectOption('select[data-c=secNReps][data-id=n1]', '1'); await H.settle(page, 400);
    const rp = last(bodies, 'secNotes', (b) => b.op === 'reps');
    check(`${w}: שינוי מספר החזרות בתוך התזכורת (76)`, rp && rp[1].id === 'n1' && rp[1].n === 1, rp && rp[1]);
    await page.click('[data-a=secNDone][data-id=n1]'); await H.settle(page, 500);
    check(`${w}: "טופל" נשלח לשרת`, !!last(bodies, 'secNotes', (b) => b.op === 'done' && b.id === 'n1'));
    check(`${w}: התראות – בלי גלילה לרוחב`, (await sx(page)) <= 0, await sx(page));
    if (shots) await page.screenshot({ path: path.join(shots, `sec4-notes-${w}.png`), fullPage: true });

    // --- דוחות ---
    await tab(page, 'reps');
    check(`${w}: דוחות – רשימה`, /הדוח השבועי/.test(await txt(page)));
    await page.click('[data-a=secRpOpen][data-id=w_m_1]'); await H.settle(page, 500);
    const tr = await txt(page);
    check(`${w}: דוח – סעיפים, רעיון לשיפור עם "למה" ו"מה לא ידוע", מקור`, /חשבוניות לתשלום השבוע/.test(tr) && /רעיונות לשיפור/.test(tr) && /למה זה חשוב/.test(tr) && /מה לא ידוע/.test(tr) && /נכון ל-/.test(tr), tr.slice(0, 300));
    await page.click('[data-a=secRpDone]'); await H.settle(page, 400);
    const dn = last(bodies, 'secReports', (b) => b.op === 'done');
    check(`${w}: "סמן כטופל"`, dn && dn[1].id === 'w_m_1' && dn[1].key === 'loss:2026-10', dn && dn[1]);
    await page.click('#secRep [data-a=secNr]'); await H.settle(page, 400);
    const nr = last(bodies, 'secPrefs', (b) => b.op === 'notRelevant');
    check(`${w}: "לא רלוונטי" – לא יוצע 90 יום (56)`, nr && nr[1].key === 'loss:2026-10' && /90 יום/.test(await txt(page)), nr && nr[1]);
    check(`${w}: דוח – בלי גלילה לרוחב`, (await sx(page)) <= 0, await sx(page));
    if (shots) await page.screenshot({ path: path.join(shots, `sec4-report-${w}.png`), fullPage: true });

    // --- יומן: תזכורת בשבת נשאלת ביצירה (75) ---
    await tab(page, 'cal');
    await page.click('[data-a=secEvAdd]'); await H.settle(page, 300);
    await page.fill('#dlg input[name=title]', 'להתקשר לרו"ח'); await page.fill('#dlg input[name=d]', SATD); await page.fill('#dlg input[name=tm]', '11:00');
    await page.check('#dlg input[name=rem]');
    await page.click('#dlg form[data-f=secEvF] button'); await H.settle(page, 500);
    const wd = await dlgText(page);
    check(`${w}: תזכורת בשבת – "להשאיר בזמנה או להעביר"`, /התזכורת נופלת בשבת/.test(wd) && /להשאיר בזמנה/.test(wd), wd.slice(0, 160));
    await page.click('#dlg [data-a=secEvW][data-m=move]'); await H.settle(page, 500);
    const ev = last(bodies, 'secCal', (b) => b.op === 'add' && b.d === SUND);
    check(`${w}: "להעביר" – נשמרת ביום ראשון, כתזכורת`, ev && ev[1].rem === true && ev[1].tm === '11:00', ev && ev[1]);

    // --- הגדרות ---
    await tab(page, 'chat'); await page.click('[data-a=secSet]'); await H.settle(page, 400);
    const ts = await txt(page);
    check(`${w}: הגדרות – דוח שבועי/חודשי, תקציר יומי (כבוי), שעות שקטות, מתג לכל תזכורת, חזרות, מחיקת היסטוריה`, /דוח שבועי/.test(ts) && /דוח חודשי/.test(ts) && /תקציר יומי/.test(ts) && /שעות שקטות/.test(ts) && /גיבוי ישן/.test(ts) && /חזרות לתזכורת/.test(ts) && /מחיקת היסטוריה/.test(ts) && !(await page.isChecked('form[data-f=secNtF] input[name=dg]')), ts.slice(0, 200));
    await page.selectOption('form[data-f=secNtF] select[name=wd]', '5'); await H.settle(page, 200);
    check(`${w}: בחירת שישי – אזהרה "הדוח יופיע ביום העסקים הבא"`, /הדוח יופיע ביום העסקים הבא/.test(await page.evaluate(() => document.getElementById('secWdWarn').innerText)));
    await page.selectOption('form[data-f=secNtF] select[name=wh]', '9');
    await page.check('form[data-f=secNtF] input[name=rt_backup]');
    await page.fill('form[data-f=secNtF] input[name=qf]', '21:30');
    await page.selectOption('form[data-f=secNtF] select[name=reps]', '2');
    await page.click('form[data-f=secNtF] button.btn'); await H.settle(page, 500);
    const nt = last(bodies, 'secPrefs', (b) => b.op === 'notify');
    check(`${w}: שמירת ההגדרות – יום, שעה, שעות שקטות, מתג, חזרות`, nt && nt[1].nt.wd === 5 && nt[1].nt.wh === 9 && nt[1].nt.q.f === '21:30' && nt[1].nt.q.on === true && nt[1].nt.rt.backup === true && nt[1].nt.rt.task === false && nt[1].nt.reps === 2 && nt[1].nt.dg === false, nt && nt[1]);
    check(`${w}: הגדרות – בלי גלילה לרוחב`, (await sx(page)) <= 0, await sx(page));
    if (shots) await page.screenshot({ path: path.join(shots, `sec4-settings-${w}.png`), fullPage: true });
    // מחיקת היסטוריה: אישור כפול
    await page.click('[data-a=secHistDel]'); await H.settle(page, 300);
    check(`${w}: מחיקה – אישור ראשון, בלי קריאה לשרת עדיין`, /למחוק את כל ההיסטוריה/.test(await dlgText(page)) && !bodies.some((b) => b[0] === 'secHistory'));
    await page.click('#dlg [data-a=yes]'); await H.settle(page, 500);
    const d2 = await dlgText(page);
    check(`${w}: מחיקה – אישור שני עם מה יימחק; עוד לא נמחק`, /אישור שני/.test(d2) && /12 הודעות/.test(d2) && !bodies.some((b) => b[0] === 'secHistory' && b[1].op === 'del'), d2.slice(0, 160));
    await page.click('#dlg [data-a=secHistOk]'); await H.settle(page, 500);
    const hd = last(bodies, 'secHistory', (b) => b.op === 'del');
    check(`${w}: מחיקה – רק אחרי האישור השני, עם קוד האישור`, hd && hd[1].token === 'tok123' && hd[1].sure === true, hd && hd[1]);
    check(`${w}: בלי שגיאות JS`, page.__errors.length === 0, page.__errors);
    await ctx.close();
  }
  await browser.close();
  console.log(fail ? `נכשלו ${fail}` : 'הכול עבר'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
