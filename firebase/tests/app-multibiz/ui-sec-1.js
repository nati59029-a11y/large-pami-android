'use strict';
// המזכירה העסקית – שלב 1 (2026-11-11): כפתור צף, כרטיס בבית, מסך הסכמה, אשף, וכרטיס מנהל־על. רשת מדומה (בלי שרת אמיתי).
// בודק: (1) ברוחב 320 ו-360 הכפתור הצף לא מסתיר שום כפתור/שדה קיים – לא בסרגל התחתון, ולא בתוכן אחרי גלילה לסוף, ואין גלילה לרוחב;
// (2) תוספת כבויה / עובד – אין כפתור, אין כרטיס, ואין שום קריאה לפונקציות המזכירה; (3) לפני הסכמה – אין כפתור צף, יש מסך הסכמה;
// (4) אשף שם + פנייה; (5) מנהל־על רואה את ההגדרות בכרטיס העסק.
// שימוש: node ui-sec-1.js <www-dir> [shots-dir]
const fs = require('fs');
const path = require('path');
const H = require('./harness');
let fail = 0;
const check = (name, ok, info) => { if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const BIZ = 'biz-o';
const FEAT = (sec) => ({ scan: true, tasks: true, orders: true, suppliers: true, cashClose: true, secretary: sec });
const VER = 'sec-terms-2026-11-v2';
const CONSENT = { ver: VER, title: 'לפני שמתחילים', items: ['סעיף 1', 'מנהל המערכת רשאי לקרוא את השיחות', 'שירות בינה מלאכותית חיצוני'], ok: 'קראתי ואני מסכים/ה' };

async function open(browser, www, o) {
  const who = o.who || 'm';
  const cfg = { mode: 'new', users: { [who]: BIZ }, sa: o.sa ? { [who]: 1 } : {}, biz: { [BIZ]: { dataRoot: 'b', features: FEAT(o.sec), name: 'עסק בדיקה' } },
    admins: who === 'w' ? {} : { [`b/${BIZ}/|${who}`]: 1 }, staff: { [`b/${BIZ}/|${who}`]: 1 }, ctx: { hasTouch: true, isMobile: true, viewport: { width: o.w || 360, height: o.h || 740 } } };
  const log = []; const calls = []; const bodies = []; const st = Object.assign({ ok: true, consented: true, setupDone: true, name: 'רותי', addr: 'f', call: '', rows: [], mode: 'all' }, o.state || {});
  if (!st.consented) st.consent = CONSENT;
  const { ctx, page } = await H.newPage(browser, www, cfg, log, who);
  await ctx.route(/:5001\/.*/, async (route) => {
    const n = new URL(route.request().url()).pathname.split('/').pop(); calls.push(n);
    let body = {};
    try { body = JSON.parse(route.request().postData() || '{}').data || {}; } catch (e) { /* */ }
    bodies.push([n, body]);
    if (n === 'secState') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: st }) });
    if (n === 'secConsent') { Object.assign(st, { consented: true, setupDone: false, name: '' }); delete st.consent; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { ok: true, ver: body.ver } }) }); }
    if (n === 'secSetup') { Object.assign(st, { setupDone: true, name: body.name, addr: body.addr, call: body.call }); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { ok: true } }) }); }
    if (n === 'secAdminSetCfg') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { bizId: BIZ, on: o.sec, mode: 'all', mainUid: '', emp: false, empDefault: false, pay: { m: false }, capCents: body.capCents === undefined ? 5000 : body.capCents, admins: [{ uid: 'm', email: 'm@x.co' }], consent: {}, consentVer: VER } }) });
    if (n === 'secAdminGet') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { bizId: BIZ, on: o.sec, mode: 'all', mainUid: '', emp: false, empDefault: false, pay: { m: false }, capCents: 5000, admins: [{ uid: 'm', email: 'm@x.co' }], consent: {}, consentVer: VER } }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: n === 'getBackupKey' ? { key: Buffer.alloc(32, 7).toString('base64') } : {} }) });
  });
  await H.login(page, who + '@x.co');
  await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden && ACT.startBlank) ACT.startBlank(); });
  await H.settle(page, 800);
  return { ctx, page, calls, st, bodies };
}
const secCalls = (calls) => calls.filter((n) => /^sec/.test(n));
const goTab = (page, v) => page.evaluate((v) => { tab(v); }, v);
// מלבנים חופפים: הכפתור הצף מול כל רכיב לחיץ/שדה גלוי בעמוד (בלי הכפתור עצמו ובלי מה שבתוך דיאלוג סגור)
async function overlaps(page) {
  return page.evaluate(() => {
    const f = document.getElementById('secfab'); if (!f || getComputedStyle(f).display === 'none') return { fab: false, hits: [] };
    const R = f.getBoundingClientRect(); const hits = [];
    for (const el of document.querySelectorAll('button, a[href], input, select, textarea, [data-a], .chip, label')) {
      if (el === f || f.contains(el) || el.closest('dialog:not([open])') || el.closest('[hidden]')) continue;
      const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      if (!r.width || !r.height || cs.visibility === 'hidden' || cs.display === 'none') continue;
      if (r.right <= R.left || r.left >= R.right || r.bottom <= R.top || r.top >= R.bottom) continue;
      hits.push((el.dataset.a || el.tagName) + ':' + (el.textContent || '').trim().slice(0, 20));
    }
    return { fab: true, hits, rect: [Math.round(R.left), Math.round(R.top), Math.round(R.width)] };
  });
}

(async () => {
  const [www, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const browser = await H.launch();

  // 1. כפתור צף ב-320 וב-360: לא מסתיר כפתור קיים
  for (const [w, h] of [[320, 640], [360, 740]]) {
    const { ctx, page, calls } = await open(browser, www, { sec: true, w, h });
    check(`${w}: מנהל שאישר – כפתור צף מופיע`, await page.evaluate(() => !!document.getElementById('secfab')), secCalls(calls));
    check(`${w}: כרטיס המזכירה בבית`, await page.evaluate(() => !!document.getElementById('secHome')));
    for (const v of ['home', 'inc', 'exp', 'more']) {
      await goTab(page, v); await H.settle(page, 400);
      const top = await overlaps(page);
      // סוף העמוד: התוכן חייב להיות נגיש מעל הכפתור (ריווח תחתון)
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await H.settle(page, 200);
      const end = await overlaps(page);
      const barHits = top.hits.filter((x) => /^tab|^add/.test(x));
      check(`${w}/${v}: לא מסתיר כפתורי סרגל, ובסוף העמוד – אף כפתור/שדה`, top.fab && barHits.length === 0 && end.hits.length === 0, { barHits, end: end.hits, rect: top.rect });
      const sx = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(`${w}/${v}: בלי גלילה לרוחב`, sx <= 0, sx);
      if (shots && v === 'home') { await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: path.join(shots, `sec-home-${w}.png`) }); }
    }
    // מקלדת פתוחה (שדה בפוקוס) – הכפתור מוסתר
    await goTab(page, 'home'); await page.evaluate(() => { const i = document.createElement('input'); i.id = 'tmpi'; document.getElementById('main').appendChild(i); i.focus(); });
    check(`${w}: שדה בפוקוס (מקלדת) – הכפתור מוסתר`, await page.evaluate(() => getComputedStyle(document.getElementById('secfab')).display === 'none'));
    await page.evaluate(() => { document.getElementById('tmpi').remove(); document.body.focus(); }); await H.settle(page, 100);
    check(`${w}: אחרי יציאה מהשדה – הכפתור חוזר`, await page.evaluate(() => getComputedStyle(document.getElementById('secfab')).display !== 'none'));
    // סרגל בחירה מרובה / מסך הוספה פתוחים – הכפתור מוסתר (מחלקה ב-JS, בלי :has)
    await page.evaluate(() => { const m = document.createElement('div'); m.className = 'msbar'; m.id = 'tmpms'; document.body.appendChild(m); }); await H.settle(page, 150);
    const ms = await page.evaluate(() => getComputedStyle(document.getElementById('secfab')).display);
    await page.evaluate(() => { document.getElementById('tmpms').remove(); ACT.add(); }); await H.settle(page, 150);
    const sh = await page.evaluate(() => getComputedStyle(document.getElementById('secfab')).display);
    await page.evaluate(() => { ACT.sheetClose(); }); await H.settle(page, 150);
    const back = await page.evaluate(() => getComputedStyle(document.getElementById('secfab')).display);
    check(`${w}: סרגל בחירה מרובה ומסך הוספה מסתירים את הכפתור, ואחרי סגירה הוא חוזר`, ms === 'none' && sh === 'none' && back !== 'none', { ms, sh, back });
    // לחיצה – פותח את מסך המזכירה ("בקרוב")
    await page.click('#secfab'); await H.settle(page, 500);
    const t = await page.evaluate(() => ({ v: cur().v, txt: document.getElementById('main').innerText }));
    check(`${w}: לחיצה פותחת את מסך המזכירה`, t.v === 'sec' && /בקרוב/.test(t.txt) && /רותי/.test(t.txt), t.txt.slice(0, 80));
    if (shots) await page.screenshot({ path: path.join(shots, `sec-screen-${w}.png`) });
    check(`${w}: בלי שגיאות JS`, page.__errors.length === 0, page.__errors);
    await ctx.close();
  }

  // 2. תוספת כבויה – אין כלום, ואין קריאות
  {
    const { ctx, page, calls } = await open(browser, www, { sec: false, w: 320, h: 640 });
    for (const v of ['home', 'more']) { await goTab(page, v); await H.settle(page, 300); }
    const r = await page.evaluate(() => ({ fab: !!document.getElementById('secfab'), card: !!document.getElementById('secHome'), txt: document.body.innerText.includes('המזכירה') }));
    check('כבוי: אין כפתור צף, אין כרטיס, אין אזכור', !r.fab && !r.card && !r.txt, r);
    check('כבוי: אין שום קריאה לפונקציות המזכירה', secCalls(calls).length === 0, secCalls(calls));
    await page.evaluate(() => { NAV = [{ v: 'home' }]; go('sec'); }); await H.settle(page, 300);
    check('כבוי: מסך המזכירה (כניסה ישירה) – "לא מופעלת"', /לא מופעלת/.test(await page.evaluate(() => document.getElementById('main').innerText)));
    check('כבוי: בלי שגיאות JS', page.__errors.length === 0, page.__errors);
    await ctx.close();
  }
  // 2ב. עובד – אין כלום, ואין קריאות
  {
    const { ctx, page, calls } = await open(browser, www, { sec: true, who: 'w', w: 320, h: 640 });
    const r = await page.evaluate(() => ({ w: typeof isW === 'function' && isW(), fab: !!document.getElementById('secfab'), card: !!document.getElementById('secHome') }));
    check('עובד: אין כפתור צף ואין כרטיס', r.w && !r.fab && !r.card, r);
    check('עובד: אין שום קריאה לפונקציות המזכירה', secCalls(calls).length === 0, secCalls(calls));
    await ctx.close();
  }

  // 3. לפני הסכמה: אין כפתור צף; הכרטיס מוביל למסך ההסכמה; אחרי אישור – אשף בשני שלבים, ואז הכפתור מופיע
  {
    const { ctx, page, calls } = await open(browser, www, { sec: true, w: 320, h: 640, state: { consented: false, setupDone: false, name: '' } });
    const r = await page.evaluate(() => ({ fab: !!document.getElementById('secfab'), card: !!document.getElementById('secHome') }));
    check('לפני הסכמה: אין כפתור צף, יש כרטיס בבית', !r.fab && r.card, r);
    await page.click('#secHome'); await H.settle(page, 400);
    const txt = await page.evaluate(() => document.getElementById('main').innerText);
    check('מסך הסכמה: כולל קריאת שיחות ושירות AI חיצוני', /מנהל המערכת רשאי לקרוא/.test(txt) && /בינה מלאכותית חיצוני/.test(txt), txt.slice(0, 120));
    await page.click('form[data-f=secConsF] button'); await H.settle(page, 300);
    check('בלי סימון – לא נשלח אישור', !calls.includes('secConsent'));
    if (shots) await page.screenshot({ path: path.join(shots, 'sec-consent-320.png'), fullPage: true });
    await page.check('form[data-f=secConsF] input[name=ok]'); await page.click('form[data-f=secConsF] button'); await H.settle(page, 800);
    check('אישור נשלח עם מזהה הנוסח', calls.includes('secConsent'));
    await page.fill('form[data-f=secWz1] input[name=name]', 'דנה'); await page.click('form[data-f=secWz1] button'); await H.settle(page, 300);
    check('אשף שלב 2: אופן פנייה', await page.evaluate(() => !!document.querySelector('form[data-f=secWz2]')));
    await page.check('form[data-f=secWz2] input[value=m]'); await page.click('form[data-f=secWz2] button.grow'); await H.settle(page, 800);
    const r2 = await page.evaluate(() => ({ fab: !!document.getElementById('secfab'), txt: document.getElementById('main').innerText }));
    check('אחרי האשף: מסך "בקרוב" עם השם, והכפתור הצף מופיע', r2.fab && /דנה/.test(r2.txt), r2.txt.slice(0, 80));
    check('הסכמה: בלי שגיאות JS', page.__errors.length === 0, page.__errors);
    await ctx.close();
  }
  // 3ב. מצב "מנהל ראשי בלבד" – מנהל אחר: אין כפתור ואין כרטיס
  {
    const { ctx, page } = await open(browser, www, { sec: true, w: 320, h: 640, state: { ok: false } });
    await ctx.route(/:5001\/.*secState$/, (route) => route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { status: 'PERMISSION_DENIED', message: 'x', details: { reason: 'not-main-manager' } } }) }));
    await page.evaluate(() => { window.__sec.st = null; window.__sec.key = ''; tab('home'); }); await H.settle(page, 800);
    const r = await page.evaluate(() => ({ fab: !!document.getElementById('secfab'), card: !!document.getElementById('secHome') }));
    check('מנהל שאינו הראשי: אין כפתור ואין כרטיס', !r.fab && !r.card, r);
    await ctx.close();
  }
  // 4. מנהל־על: הגדרות המזכירה בכרטיס העסק
  {
    const { ctx, page, bodies } = await open(browser, www, { sec: true, sa: true, w: 360, h: 740 });
    const ok = await page.evaluate(async () => { SY.sa = 1; ADM.sa = 1; /* רשת מדומה: סימון מנהל־על בדפדפן; ההרשאה האמיתית – בשרת (secretary.test.js) */ ADM.L = ADM.L || []; if (!ADM.L.find((x) => x.id === 'biz-o')) ADM.L.push({ id: 'biz-o', name: 'עסק בדיקה', status: 'active', dataRoot: 'b', features: { secretary: true } }); NAV = [{ v: 'home' }]; go('sab', 'biz-o'); await new Promise((r) => setTimeout(r, 800)); return document.getElementById('main').innerText; });
    check('מנהל־על: בכרטיס העסק – מצב מנהלים, תקרה, שכר, ניתוח עובדים, צפייה בשיחה', /המזכירה העסקית/.test(ok) && /מנהל ראשי בלבד/.test(ok) && /תקרת עלות/.test(ok) && /שאלות שכר/.test(ok) && /ניתוח עובדים/.test(ok) && /צפייה בשיחה/.test(ok), String(ok).slice(0, 200));
    if (shots) await page.screenshot({ path: path.join(shots, 'sec-sab-360.png'), fullPage: true });
    // תקרה: מעל 10,000 – הודעה בעברית ואין שליחה; ריק אחרי שהייתה תקרה – ניקוי (capCents: null)
    const n0 = bodies.filter((b) => b[0] === 'secAdminSetCfg').length;
    await page.fill('form[data-f=secSaF] input[name=cap]', '20000'); await page.click('form[data-f=secSaF] button.btn'); await H.settle(page, 300);
    check('תקרה מעל 10,000 – לא נשלחה', bodies.filter((b) => b[0] === 'secAdminSetCfg').length === n0);
    await page.fill('form[data-f=secSaF] input[name=cap]', '10,000'); await page.click('form[data-f=secSaF] button.btn'); await H.settle(page, 500);
    const b1 = bodies.filter((b) => b[0] === 'secAdminSetCfg').pop();
    check('תקרה 10,000 – נשלחת בסנטים', b1 && b1[1].capCents === 1000000, b1 && b1[1]);
    await page.fill('form[data-f=secSaF] input[name=cap]', ''); await page.click('form[data-f=secSaF] button.btn'); await H.settle(page, 500);
    const b2 = bodies.filter((b) => b[0] === 'secAdminSetCfg').pop();
    check('שדה ריק אחרי שהייתה תקרה – ניקוי (capCents: null)', b2 && b2[1].capCents === null, b2 && b2[1]);
    check('מנהל־על: בלי שגיאות JS', page.__errors.length === 0, page.__errors);
    await ctx.close();
  }
  check('בלי :has() בקובץ המזכירה (WebView ישן)', !/:has\(/.test(fs.readFileSync(path.join(www, 'secretary.js'), 'utf8')));
  await browser.close();
  console.log(fail ? `נכשלו ${fail}` : 'הכול עבר'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
