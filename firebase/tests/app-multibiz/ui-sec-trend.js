// גיטי – לשונית "ניתוחים" במסך המזכירה (24.11.2026, סבב 4 חלק ב, sec-trend-ui.js + sec-trend.js). רשת מדומה, בלי שרת. נבדק ברוחב 360px:
//  - בלי נתונים: "אין מספיק נתונים" (בלי נתוני דוגמה).
//  - עם נתונים: הוצאה חריגה (ספק), כרטיס עובד (שכר) לא מופיע כספק, הצעת הזמנה (כל 7 ימים) בלי כפתור שליחה, מגמות לפי קטגוריה וספק, בחירת חודש.
//  - החישוב פעם אחת (לא בכל רינדור) ושוב אחרי שמירה; בלי קריאה לשרת מהלשונית; בלי גלילה לרוחב; מטרות לחיצה 44px; בלי שגיאות JS.
// שימוש: node ui-sec-trend.js <www-dir> [shots-dir]
'use strict';
const fs = require('fs');
const path = require('path');
const H = require('./harness');
let fail = 0;
const check = (name, ok, info) => { if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const BIZ = 'biz-o';
const FEAT = { scan: true, tasks: true, orders: true, suppliers: true, cashClose: true, secretary: true };

(async () => {
  const www = path.resolve(process.argv[2] || '../../../app-source/www');
  const shots = process.argv[3] ? path.resolve(process.argv[3]) : null;
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const browser = await H.launch();
  try {
    const who = 'm';
    const cfg = { mode: 'new', users: { [who]: BIZ }, sa: {}, biz: { [BIZ]: { dataRoot: 'b', features: FEAT, name: 'עסק בדיקה' } },
      admins: { [`b/${BIZ}/|${who}`]: 1 }, staff: { [`b/${BIZ}/|${who}`]: 1 }, ctx: { hasTouch: true, isMobile: true, viewport: { width: 360, height: 740 } } };
    const st = { ok: true, consented: true, setupDone: true, name: 'רותי', addr: 'f', call: 'נתי', rows: [], mode: 'all', pay: true, emp: true, mirror: false, mirrorAt: null, cfTh: null, pct: 10, saving: '', brLimited: false, stop: false };
    const calls = [], bodies = [];
    const CID = 'cm0123456789abcdef';
    const ORD = { cid: CID, ch: 'ord', t: H.T0, from: 'ספק הקמח', who: 'me', what: 'להזמין מספק ספק הקמח', d: '', prev: 'שלום, נבקש להזמין כרגיל (כמו בהזמנה הקודמת מ-27.10). נא לאשר מועד אספקה. תודה', st: 'pend', ref: {} };
    let drafted = false;
    const { ctx, page } = await H.newPage(browser, www, cfg, [], who);
    await ctx.route(/:5001\/.*/, async (route) => {
      const n = new URL(route.request().url()).pathname.split('/').pop(); calls.push(n);
      let body = {}; try { body = JSON.parse(route.request().postData() || '{}').data || {}; } catch (e) { /* */ }
      bodies.push([n, body]);
      const ok = (r) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: r }) });
      if (n === 'secState') return ok(st);
      if (n === 'secChatLoad') return ok({ ok: true, msgs: [] });
      if (n === 'secPrefs' && body.op === 'ordDraft') { const dup = drafted; drafted = true; return ok({ ok: true, cid: CID, st: 'pend', ...(dup ? { dup: true } : {}) }); }
      if (n === 'secPrefs' && body.op === 'cmt') return ok({ ok: true, st: body.st === 'claim' ? 'act' : body.st, ref: 'sec' + CID });
      if (n === 'secComm' && body.op === 'cmts') return ok({ ok: true, items: drafted ? [ORD] : [], n: drafted ? 1 : 0 });
      if (n === 'secLearn') return ok({ ok: true, open: [], did: [], hold: [], items: [], rules: [] });
      return ok(n === 'getBackupKey' ? { key: Buffer.alloc(32, 7).toString('base64') } : {});
    });
    const errs = []; page.on('pageerror', (e) => errs.push(String(e && e.message || e)));
    await H.login(page, who + '@x.co');
    await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden && ACT.startBlank) ACT.startBlank(); });
    await H.settle(page, 600);
    // בלי נתונים
    await page.evaluate(() => { S.tx = []; save(); go('sec'); }); await H.settle(page, 700);
    const hasTab = await page.$('#secTabs [data-v=trend]');
    check('יש לשונית "ניתוחים"', !!hasTab);
    await page.evaluate(() => { const b = document.querySelector('#secTabs [data-v=trend]'); if (b) b.click(); }); await H.settle(page, 500);
    const t0 = await page.$eval('#secTr', (e) => e.innerText).catch(() => '');
    check('בלי נתונים: "אין מספיק נתונים"', /אין מספיק נתונים/.test(t0), t0.slice(0, 120));
    // נתונים: ספק סחורה כל 7 ימים (500 ₪) ב-4 החודשים הקודמים, ועוד 4 חשבוניות של 800 עד לפני 7 ימים (לפי שעון הבדיקה – בחודש הקודם: חריגה); חשמל קבוע; עובד בשכר (לא ספק בניתוח)
    const info = await page.evaluate(() => {
      const m0 = NOWM(), td = today(), dn = (d) => Math.round(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 864e5), ds = (n) => new Date(n * 864e5).toISOString().slice(0, 10);
      S.subs = S.subs.filter((s) => !/^TS|^TF|^TE/.test(s.id));
      S.subs.push({ id: 'TS1', cat: 'e_sup', name: 'ספק הקמח' }, { id: 'TF1', cat: 'e_fix', name: 'חשמל בדיקה' }, { id: 'TE1', cat: 'e_sal', name: 'עובד בדיקה' });
      let n = 0; const add = (o) => S.tx.push(Object.assign({ id: 'q' + (++n), note: '', pays: [] }, o));
      S.tx = [];
      for (let k = 1; k <= 4; k++) { const m = addMon(m0, -k); for (const d of ['03', '10', '17', '24']) add({ t: 'exp', cat: 'e_sup', sub: 'TS1', kind: 'inv', inv: 'I' + n, amt: 500, date: m + '-' + d, plan: m }); add({ t: 'exp', cat: 'e_fix', sub: 'TF1', kind: 'inv', amt: 300, date: m + '-05', plan: m }); add({ t: 'exp', cat: 'e_sal', sub: 'TE1', amt: 5000, date: m + '-09' }); }
      add({ t: 'exp', cat: 'e_fix', sub: 'TF1', kind: 'inv', amt: 310, date: m0 + '-01', plan: m0 });
      const last = dn(td) - 7;
      for (let k = 3; k >= 0; k--) { const d = ds(last - k * 7); add({ t: 'exp', cat: 'e_sup', sub: 'TS1', kind: 'inv', inv: 'N' + k, amt: 800, date: d, plan: d.slice(0, 7) }); }
      BRSEL = []; save();
      return { m0, last: ds(last) };
    });
    await H.settle(page, 400);
    const cnt0 = await page.evaluate(() => { let c = 0; const o = window.secFin; window.secFin = function () { c++; return o.apply(this, arguments); }; window.__trCnt = () => c; return 0; });
    await page.evaluate(() => rerender()); await H.settle(page, 400);
    const t1 = await page.$eval('#secTr', (e) => e.innerText).catch(() => '');
    const an = await page.$eval('#secTrAn', (e) => e.innerText).catch(() => '');
    check('הוצאה חריגה: ספק הקמח', /ספק הקמח/.test(an) && /\+\d+%/.test(an), an.slice(0, 200));
    check('עובד בשכר לא מופיע בניתוחים', !/עובד בדיקה/.test(t1));
    const ord = await page.$eval('#secTrOrd', (e) => e.innerText).catch(() => '');
    check('הצעת הזמנה: כל 7 ימים, האחרונה לפני 7 ימים', /כדאי להזמין מספק הקמח/.test(ord) && /כל 7 ימים/.test(ord) && /לפני 7 ימים/.test(ord), ord.slice(0, 200));
    const ob = await page.$$eval('#secTrOrd button', (L) => L.map((b) => b.innerText));
    check('ליד ההצעה: כפתור "הכן הזמנה" אחד בלבד (אין כפתור שליחה)', ob.length === 1 && /הכן הזמנה/.test(ob[0]) && !ob.some((t) => /שלח/.test(t)), ob);
    await page.evaluate(() => document.querySelector('#secTrOrd [data-a=trOrd]').click()); await H.settle(page, 500);
    const od = bodies.filter((b) => b[0] === 'secPrefs' && b[1].op === 'ordDraft');
    check('"הכן הזמנה" → secPrefs op:ordDraft עם הספק, התאריך והקצב', od.length === 1 && od[0][1].sup === 'ספק הקמח' && od[0][1].every === 7 && /^\d{4}-\d{2}-\d{2}$/.test(od[0][1].last), od.map((b) => b[1]));
    check('אחרי הלחיצה: "טיוטה במרכז האישורים", בלי כפתור נוסף', /טיוטה במרכז האישורים/.test(await page.$eval('#secTrOrd', (e) => e.innerText)) && (await page.$$('#secTrOrd [data-a=trOrd]')).length === 0);
    const tr = await page.$eval('#secTrT', (e) => e.innerText).catch(() => '');
    check('מגמות לפי קטגוריה: ספקים, חודש קודם ואשתקד', /ספקים/.test(tr) && /חודש קודם/.test(tr) && /אשתקד/.test(tr), tr.slice(0, 200));
    await page.evaluate(() => document.querySelector('#secTrT [data-a=trBy][data-v=sup]').click()); await H.settle(page, 300);
    const tr2 = await page.$eval('#secTrT', (e) => e.innerText).catch(() => '');
    check('מגמות לפי ספק: ספק הקמח וחשמל', /ספק הקמח/.test(tr2) && /חשמל בדיקה/.test(tr2), tr2.slice(0, 200));
    await page.evaluate((m) => { const s = document.querySelector('#secTrT select[data-c=trMon]'); s.value = addMon(m, -1); s.dispatchEvent(new Event('change', { bubbles: true })); }, info.m0); await H.settle(page, 300);
    const sel = await page.$eval('#secTrT select[data-c=trMon]', (e) => e.value);
    check('בחירת חודש קודם', sel !== info.m0, sel);
    check('חישוב פעם אחת: 4 רינדורים (כולל החלפת תצוגה) – חישוב אחד', await page.evaluate(() => window.__trCnt()) === 1, await page.evaluate(() => window.__trCnt()));
    await page.evaluate(() => { save(); rerender(); }); await H.settle(page, 300);
    check('אחרי שמירה – חישוב מחדש (פעם אחת)', await page.evaluate(() => window.__trCnt()) === 2, await page.evaluate(() => window.__trCnt()));
    check('בלי גלילה לרוחב', await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth <= 1));
    const small = await page.$$eval('#secTr button, #secTr select', (L) => L.filter((b) => b.getBoundingClientRect().height < 43).length);
    check('מטרות לחיצה 44px', small === 0, small);
    check('הלשונית לא קוראת לשרת (חישוב במכשיר)', !calls.some((c) => /secTrend|secMirrorPut/.test(c)), [...new Set(calls)]);
    check('כיוון RTL', await page.evaluate(() => getComputedStyle(document.getElementById('secTr')).direction === 'rtl'));
    if (shots) { const el = await page.$('#secTr'); await el.screenshot({ path: path.join(shots, 'trend-360.png') }); }
    // מרכז האישורים: כרטיס טיוטת ההזמנה – בלי "ההודעה המקורית" ובלי בחירת תזכורת; אישור = תפיסה, משימה עם נוסח להעתקה, ok (משימה)
    await page.evaluate(() => { const b = document.querySelector('#secTabs [data-v=appr]'); if (b) b.click(); }); await H.settle(page, 900);
    const card = await page.$('[data-cmt=' + CID + ']');
    const ct = card ? await card.innerText() : await page.evaluate(() => document.getElementById('main').innerText.slice(0, 300) + ' TAB=' + window.__sec.tab);
    check('מרכז האישורים: כרטיס "טיוטת הזמנה מספק ספק הקמח" עם נוסח להעתקה', /טיוטת הזמנה מספק ספק הקמח/.test(ct) && /נוסח להעתקה/.test(ct), ct.slice(0, 200));
    if (card) {
      check('בכרטיס: בלי "ההודעה המקורית" ובלי "תזכורת לי"', !(await card.$('[data-a=cmtSrc]')) && !(await card.$('select[data-f=kind]')));
      if (shots) await card.screenshot({ path: path.join(shots, 'ord-card-360.png') });
      // סבב 4ג: "לעצמי" – משימת ההזמנה למנהל המאשר (to = המשתמש עצמו)
      check('בכרטיס: אפשרות "לעצמי"', /לעצמי/.test(await card.innerText()) && !!(await card.$('[data-f=me]')));
      if (shots) await card.screenshot({ path: path.join(shots, 'ord-card-me-360.png') });
      await page.evaluate((id) => { const c = document.querySelector('[data-cmt=' + id + '] [data-f=me]'); if (c) { c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); } }, CID); await H.settle(page, 300);
      const tasks = [];
      await ctx.route(/\/tasks\?documentId=/, async (route) => { try { tasks.push(JSON.parse(route.request().postData() || '{}')); } catch (e) { /* */ } return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); });
      const n0 = bodies.length;
      await page.evaluate((id) => document.querySelector('[data-cmt=' + id + '] [data-a=cmtOk]').click(), CID); await H.settle(page, 1500);
      const after = bodies.slice(n0).filter((b) => b[0] === 'secPrefs').map((b) => b[1]);
      check('אישור: claim ואז ok כמשימה', after.length >= 2 && after[0].st === 'claim' && after[after.length - 1].st === 'ok' && after[after.length - 1].kind === 'task', after);
      const me = await page.evaluate(() => SY.uid), tf = tasks[0] && tasks[0].fields || {};
      const to = ((tf.to || {}).arrayValue || {}).values || [];
      check('"לעצמי": המשימה נפתחה למנהל עצמו (to, ow)', to.length === 1 && to[0].stringValue === me && (tf.ow || {}).stringValue === me, { to, ow: tf.ow, me, n: tasks.length });
    }
    check('בלי שגיאות JS', errs.length === 0, errs);
    void cnt0;
  } finally { await browser.close(); }
  console.log(fail ? 'נכשלו ' + fail : 'הכול עבר');
  process.exit(fail ? 1 : 0);
})();
