'use strict';
// המזכירה העסקית – שלב 3 (2026-11-11): לשוניות "מידע על העסק", "יומן", "תשובות מוכנות" וכרטיסי אישור בצ'אט. רשת מדומה (בלי שרת ובלי AI).
// ב-320 וב-360: הכול מוצג, בלי גלילה לרוחב, בלי שגיאות JS; כל פעולה נשלחת לשרת בפורמט הנכון: אישור הצעה (עובדה/אירוע),
// סתירה – שואלת איזו נכונה, שישי/שבת/חג – מציעה יום אחר, מחירון מקובץ, מידע רגיש נטען רק בלחיצה (ולא מוצג בלי הרשאה),
// תשובה מוכנה, ייבוא עם תצוגה מקדימה, והגדרת פגישות בשישי/שבת/חג.
// שימוש: node ui-sec-3.js <www-dir> [shots-dir]
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
const SATD = addD(SAT), SUND = addD(SAT + 1), TUE = addD(SAT + 3);

async function open(browser, www, o) {
  const who = 'm';
  const cfg = { mode: 'new', users: { [who]: BIZ }, sa: {}, biz: { [BIZ]: { dataRoot: 'b', features: FEAT, name: 'עסק בדיקה' } },
    admins: { [`b/${BIZ}/|${who}`]: 1 }, staff: { [`b/${BIZ}/|${who}`]: 1 }, ctx: { hasTouch: true, isMobile: true, viewport: { width: o.w || 360, height: o.h || 740 } } };
  const bodies = [];
  const st = Object.assign({ ok: true, consented: true, setupDone: true, name: 'רותי', addr: 'f', call: 'נתי', rows: [], mode: 'all', pay: true, emp: true, sens: o.sens !== false, we: 'warn', mirror: true, mirrorAt: null, cfTh: null, pct: 10, saving: '' }, o.state || {});
  const facts = [
    { id: 'p1', topic: 'sup', text: 'ספק החלב מספק רק בימי שני', st: 'prop', src: 'chat', t: Date.now() },
    { id: 'f1', topic: 'general', text: 'מבצע חנוכה 1+1', st: 'ok', src: 'mgr', t: Date.now(), exp: addD(5) },
    { id: 'fx_hours', topic: 'general', fx: 'hours', text: 'א–ה 7:00–19:00', st: 'ok', t: 1 },
  ];
  const { ctx, page } = await H.newPage(browser, www, cfg, [], who);
  let addN = 0, evN = 0;
  await ctx.route(/:5001\/.*/, async (route) => {
    const n = new URL(route.request().url()).pathname.split('/').pop();
    let body = {}; try { body = JSON.parse(route.request().postData() || '{}').data || {}; } catch (e) { /* */ }
    bodies.push([n, body]);
    const ok = (r) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: r }) });
    if (n === 'secState') return ok(st);
    if (n === 'secChatLoad') return ok({ ok: true, msgs: [] });
    if (n === 'secChat') return ok({ ok: true, reply: 'לשמור את זה? ולקבוע את הפגישה?', mode: 'ok', src: [], pct: 11, saving: false,
      cards: [{ k: 'fact', id: 'c1', topic: 'sup', text: 'ספק הקמח נותן 7% הנחה במזומן' }, { k: 'cal', id: 'c2', title: 'פגישה עם ספק', d: SATD, tm: '10:00', to: 'me', warn: { kind: 'שבת', next: SUND } }] });
    if (n === 'secFacts') {
      if (body.op === 'list') return ok({ ok: true, facts, price: null, sens: st.sens, topics: { general: 'כללי', sup: 'ספקים', emp: 'עובדים', goal: 'מטרות', reply: 'כללי תשובה' }, fixed: { sells: 'מה העסק מוכר', hours: 'שעות פתיחה', addr: 'כתובות', branches: 'סניפים', audience: 'קהל יעד', seasons: 'עונות חזקות וחלשות' } });
      if (body.op === 'add' && !body.force && ++addN === 1) return ok({ ok: false, conflict: [{ id: 'f1', text: 'מבצע חנוכה 1+1' }], fact: { topic: body.topic, text: body.text } });
      return ok({ ok: true, id: 'x' });
    }
    if (n === 'secSens') return ok(body.op === 'list' ? { ok: true, items: [{ id: 's1', emp: 'דנה', text: 'חוזרת מחופשה במרץ', t: Date.now() }] } : { ok: true, id: 's2' });
    if (n === 'secCal') {
      if (body.op === 'list') return ok({ ok: true, today: addD(0), we: st.we, events: [{ id: 'e1', title: 'ספירת מלאי', d: TUE, tm: '08:00', st: 'ok', biz: true, src: 'mgr' }, { id: 'e2', title: 'פגישה בשבת', d: SATD, st: 'ok', biz: false, src: 'import', off: 'שבת' }, { id: 'e3', title: 'הצעה מהמזכירה', d: TUE, st: 'prop', to: 'biz', src: 'sec' }] });
      if (body.op === 'add' && !body.force && body.d === SATD && ++evN === 1) return ok({ ok: false, warn: { kind: 'שבת', d: SATD, next: SUND } });
      return ok({ ok: true, id: 'y' });
    }
    if (n === 'secRules') return ok(body.op === 'list' ? { ok: true, rules: [{ id: 'r1', q: ['שעות פתיחה'], a: 'א–ה 7–19', cond: '', on: true, src: 'mgr', t: 1 }] } : { ok: true, id: 'r2' });
    if (n === 'secImport') return ok(body.dry ? { ok: true, dry: true, rules: 2, ruleDup: 1, events: 1, evDup: 0, past: 3, bad: { rules: 0, events: 1 }, over: { rules: 0, events: 0 } } : { ok: true, dry: false, written: { rules: 2, events: 1 } });
    if (n === 'secPrefs') return ok(Object.assign({ ok: true }, body));
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

(async () => {
  const [www, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const browser = await H.launch();
  const csv = { name: 'מחירון.csv', mimeType: 'text/csv', buffer: Buffer.from('פריט,מחיר,יחידה\nעוגת גבינה,89.90,יח\'\nחלה,14.5\n', 'utf8') };
  const imp = { name: 'old.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ rules: [{ q: 'משלוחים', a: 'כן' }], events: [{ title: 'x', date: TUE }] }), 'utf8') };

  for (const [w, h] of [[320, 640], [360, 740]]) {
    const { ctx, page, bodies } = await open(browser, www, { w, h });
    await page.evaluate(() => { NAV = [{ v: 'home' }]; go('sec'); }); await H.settle(page, 600);
    const t0 = await txt(page);
    check(`${w}: לשוניות – שיחה, מידע על העסק, יומן, תשובות מוכנות`, /מידע על העסק/.test(t0) && /יומן/.test(t0) && /תשובות מוכנות/.test(t0) && !!(await page.$('#secForm textarea')));

    // --- צ'אט: כרטיסי אישור ---
    await page.fill('#secForm textarea', 'ספק הקמח נותן 7% הנחה במזומן, ותקבעי פגישה איתו בשבת');
    await page.click('#secForm button[value=n]'); await H.settle(page, 600);
    const tc = await page.evaluate(() => document.getElementById('secChat').innerText);
    check(`${w}: צ'אט – כרטיס "לשמור במידע על העסק?" וכרטיס "לקבוע ביומן?" עם אזהרת שבת`, /לשמור במידע על העסק\?/.test(tc) && /לקבוע ביומן\?/.test(tc) && /נופל בשבת/.test(tc), tc.slice(0, 300));
    await page.click('#secChat [data-a=secFOk][data-id=c1]'); await H.settle(page, 400);
    const fa = last(bodies, 'secFacts', (b) => b.op === 'approve');
    check(`${w}: "אשר ושמור" – נשלח אישור להצעה (רק עכשיו נשמר)`, fa && fa[1].id === 'c1' && !fa[1].force, fa && fa[1]);
    await page.click('#secChat [data-a=secCOk][data-id=c2][data-d]'); await H.settle(page, 400);
    const ca = last(bodies, 'secCal', (b) => b.op === 'approve');
    check(`${w}: "להעביר ל-יום ראשון" – אישור האירוע ביום העסקים החלופי`, ca && ca[1].id === 'c2' && ca[1].d === SUND, ca && ca[1]);
    const tc2 = await page.evaluate(() => document.getElementById('secChat').innerText);
    check(`${w}: אחרי האישור – הכרטיסים מראים "נשמר" ו"נקבע"`, /נשמר במידע על העסק/.test(tc2) && /נקבע ביומן/.test(tc2));
    if (shots) await page.screenshot({ path: path.join(shots, `sec3-chat-${w}.png`), fullPage: true });

    // --- מידע על העסק ---
    await tab(page, 'facts');
    const tf = await txt(page);
    check(`${w}: מידע על העסק – הסבר, "המזכירה הציעה לשמור (1)", נושאים, מחירון, מידע רגיש`, /המזכירה הציעה לשמור \(1\)/.test(tf) && /ספקים/.test(tf) && /מטרות/.test(tf) && /מחירון/.test(tf) && /מידע רגיש על עובדים/.test(tf) && /בתוקף עד/.test(tf), tf.slice(0, 300));
    check(`${w}: מידע רגיש לא נטען בלי לחיצה`, !bodies.some((b) => b[0] === 'secSens'));
    await page.click('#secPend [data-a=secFOk][data-id=p1]'); await H.settle(page, 500);
    check(`${w}: אישור הצעה מהמסך`, !!last(bodies, 'secFacts', (b) => b.op === 'approve' && b.id === 'p1'));
    // עובדה חדשה – סתירה: שואלת איזו נכונה
    await page.fill('form[data-f=secFAddF] textarea[name=text]', 'מבצע חנוכה 2+1'); await page.click('form[data-f=secFAddF] button'); await H.settle(page, 500);
    const dlgT = await page.evaluate(() => document.getElementById('dlg').open ? document.getElementById('dlg').innerText : '');
    check(`${w}: סתירה – מציגה את שתיהן ושואלת איזו נכונה`, /סותר/.test(dlgT) && /מבצע חנוכה 1\+1/.test(dlgT) && /מבצע חנוכה 2\+1/.test(dlgT) && /איזו נכונה/.test(dlgT), dlgT.slice(0, 200));
    await page.click('#dlg [data-a=secFC][data-m=new]'); await H.settle(page, 500);
    const fr = last(bodies, 'secFacts', (b) => b.op === 'add' && b.force);
    check(`${w}: "החדשה" – נשמרת עם החלפה של הישנה`, fr && fr[1].replace && fr[1].replace[0] === 'f1', fr && fr[1]);
    // מחירון מקובץ
    await page.setInputFiles('input[data-c=secPriceF]', csv); await H.settle(page, 500);
    const pd = await page.evaluate(() => document.getElementById('dlg').innerText);
    check(`${w}: מחירון – ספירה לפני שמירה (שורת הכותרת מדולגת)`, /נמצאו 2 פריטים/.test(pd), pd.slice(0, 120));
    await page.click('#dlg [data-a=yes]'); await H.settle(page, 500);
    const pr = last(bodies, 'secFacts', (b) => b.op === 'price');
    check(`${w}: מחירון נשלח: פריט, מחיר, יחידה`, pr && pr[1].rows.length === 2 && pr[1].rows[0].n === 'עוגת גבינה' && pr[1].rows[0].p === 89.9 && pr[1].rows[0].u === 'יח\'' && pr[1].rows[1].p === 14.5, pr && pr[1]);
    // מידע רגיש – רק בלחיצה
    await page.click('[data-a=secSShow]'); await H.settle(page, 500);
    check(`${w}: מידע רגיש – נטען בלחיצה ומוצג`, !!last(bodies, 'secSens', (b) => b.op === 'list') && /חוזרת מחופשה במרץ/.test(await txt(page)));
    await page.fill('form[data-f=secSAddF] input[name=emp]', 'משה'); await page.fill('form[data-f=secSAddF] textarea[name=text]', 'מטפל באמו'); await page.click('form[data-f=secSAddF] button'); await H.settle(page, 500);
    check(`${w}: מידע רגיש – שמירה`, !!last(bodies, 'secSens', (b) => b.op === 'add' && b.emp === 'משה'));
    check(`${w}: מידע על העסק – בלי גלילה לרוחב`, (await sx(page)) <= 0, await sx(page));
    if (shots) await page.screenshot({ path: path.join(shots, `sec3-facts-${w}.png`), fullPage: true });

    // --- יומן ---
    await tab(page, 'cal');
    const tl = await txt(page);
    check(`${w}: יומן – רשימה, "קרוב", אישי/של העסק, מקור, תאריך עברי, יום לא עסקים, הצעה לאישור`, /קרוב/.test(tl) && /ספירת מלאי/.test(tl) && /של העסק/.test(tl) && /ייבוא/.test(tl) && /יום לא עסקים/.test(tl) && /המזכירה הציעה \(1\)/.test(tl) && /[א-ת]+ב?\s?[א-ת]*/.test(tl) && !!(await page.$('.secoff')), tl.slice(0, 300));
    const heb = await page.evaluate(() => [...document.querySelectorAll('.secday small')].map((x) => x.innerText).join('|'));
    check(`${w}: תאריך עברי ליד התאריך`, /(תשרי|חשוון|חשון|כסלו|טבת|שבט|אדר|ניסן|אייר|סיוון|סיון|תמוז|אב|אלול)/.test(heb), heb.slice(0, 120));
    await page.click('[data-a=secEvAdd]'); await H.settle(page, 300);
    await page.fill('#dlg input[name=title]', 'פגישה עם רו"ח'); await page.fill('#dlg input[name=d]', SATD); await page.fill('#dlg input[name=tm]', '11:00');
    await page.click('#dlg form[data-f=secEvF] button'); await H.settle(page, 500);
    const wd = await page.evaluate(() => document.getElementById('dlg').innerText);
    check(`${w}: אירוע בשבת – שואלת "להשאיר או להעביר"`, /נופל בשבת/.test(wd) && /להעביר/.test(wd), wd.slice(0, 160));
    await page.click('#dlg [data-a=secEvW][data-m=keep]'); await H.settle(page, 500);
    const ev = last(bodies, 'secCal', (b) => b.op === 'add' && b.force);
    check(`${w}: "להשאיר" – נשמר בתאריך המקורי עם אישור מפורש`, ev && ev[1].d === SATD && ev[1].tm === '11:00' && ev[1].title === 'פגישה עם רו"ח' && ev[1].biz === false, ev && ev[1]);
    await page.click('[data-a=secCv][data-v=week]'); await H.settle(page, 300);
    check(`${w}: תצוגת שבוע – 7 ימים`, (await page.$$('.secday')).length === 7);
    check(`${w}: יומן – בלי גלילה לרוחב`, (await sx(page)) <= 0, await sx(page));
    if (shots) await page.screenshot({ path: path.join(shots, `sec3-cal-${w}.png`), fullPage: true });

    // --- תשובות מוכנות + ייבוא ---
    await tab(page, 'bank');
    check(`${w}: תשובות מוכנות – רשימה והסבר`, /שעות פתיחה/.test(await txt(page)) && /בלי עלות/.test(await txt(page)));
    await page.click('[data-a=secRAdd]'); await H.settle(page, 300);
    await page.fill('#dlg textarea[name=q]', 'כתובת\nאיפה אתם'); await page.fill('#dlg textarea[name=a]', 'יהודה הנשיא 5'); await page.fill('#dlg input[name=cond]', '');
    await page.click('#dlg form[data-f=secRF] button'); await H.settle(page, 500);
    const ra = last(bodies, 'secRules', (b) => b.op === 'add');
    check(`${w}: תשובה מוכנה חדשה – ניסוחים, תשובה, פעילה`, ra && ra[1].q.join('|') === 'כתובת|איפה אתם' && ra[1].a === 'יהודה הנשיא 5' && ra[1].on === true, ra && ra[1]);
    await page.setInputFiles('input[data-c=secImpF]', imp); await H.settle(page, 600);
    const id = await page.evaluate(() => document.getElementById('dlg').innerText);
    check(`${w}: ייבוא – תצוגה מקדימה (חדשות, קיימות שלא ישתנו, עברו, פגומים) לפני כתיבה`, /תשובות מוכנות חדשות: 2/.test(id) && /כבר קיימות – לא ישתנו/.test(id) && /3 אירועים שכבר עברו/.test(id) && /לא יימחק ולא יוחלף/.test(id) && !bodies.some((b) => b[0] === 'secImport' && !b[1].dry), id.slice(0, 300));
    await page.click('#dlg [data-a=secImpGo]'); await H.settle(page, 500);
    const im = last(bodies, 'secImport', (b) => !b.dry);
    check(`${w}: ייבוא נשלח רק אחרי אישור, עם תוכן הקובץ`, im && /משלוחים/.test(im[1].raw), im && Object.keys(im[1]));
    check(`${w}: תשובות מוכנות – בלי גלילה לרוחב`, (await sx(page)) <= 0, await sx(page));
    if (shots) await page.screenshot({ path: path.join(shots, `sec3-bank-${w}.png`), fullPage: true });

    // --- הגדרות: פגישות בשישי/שבת/חג (72) ---
    await tab(page, 'chat'); await page.click('[data-a=secSet]'); await H.settle(page, 300);
    await page.click('input[data-c=secWe][value=accept]'); await H.settle(page, 400);
    const we = last(bodies, 'secPrefs', (b) => b.op === 'calWe');
    check(`${w}: הגדרה "לקבל בלי הערה" נשלחת לשרת`, we && we[1].v === 'accept', we && we[1]);
    check(`${w}: בלי שגיאות JS`, page.__errors.length === 0, page.__errors);
    await ctx.close();
  }

  // מנהל בלי הרשאה למידע רגיש – החלק לא מוצג, ושום קריאה ל-secSens
  {
    const { ctx, page, bodies } = await open(browser, www, { w: 360, sens: false });
    await page.evaluate(() => { NAV = [{ v: 'home' }]; go('sec'); }); await H.settle(page, 500);
    await tab(page, 'facts');
    check('בלי הרשאה: אין חלק "מידע רגיש" ואין קריאה ל-secSens', !/מידע רגיש על עובדים/.test(await txt(page)) && !bodies.some((b) => b[0] === 'secSens'));
    check('בלי הרשאה: בלי שגיאות JS', page.__errors.length === 0, page.__errors);
    await ctx.close();
  }
  await browser.close();
  console.log(fail ? `נכשלו ${fail}` : 'הכול עבר'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
