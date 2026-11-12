'use strict';
// 2026-11-12: "מצב העסק" לעובד (מתג bal) – טבלת הכנסות, הוצאות ורווח לחודש, בלי פירוט; בעסק עם סניפים – רק הסניפים שאושרו (perms.balB).
// רשת מדומה (לא צריך אמולטור). האכיפה עצמה – בחוקים (perms-6g.test.js); כאן: החישוב במכשיר המנהל, המסמכים שהעובד מבקש, והתצוגה.
// שימוש: node ui-bal.js <www-dir> [out.json] [shots-dir]
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const out = {}; let fail = 0;
const check = (name, ok, info) => { out[name] = { ok: !!ok, info }; if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };

(async () => {
  const [www, outFile, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const shot = async (page, name) => { if (shots) await page.screenshot({ path: path.join(shots, name + '.png'), fullPage: true }); };
  const browser = await H.launch();
  const bcfg = { mode: 'new', users: { ma: 'acme', wa: 'acme' }, biz: { acme: { dataRoot: 'b', features: {} } }, admins: { 'b/acme/|ma': 1 }, staff: { 'b/acme/|wa': 1 } };
  const ORG = { branches: [{ id: 'br_a', name: 'סניף מרכז' }, { id: 'br_b', name: 'סניף צפון' }] };

  // 1. מכשיר המנהל: wvWant מחשב סכומים בלבד, לכל העסק ולכל סניף; משיכת בעלים שאינה הוצאה – לא נספרת; משכורות – כן
  { const { ctx, page } = await H.newPage(browser, www, bcfg, [], 'bm'); await H.login(page, 'ma@x.co');
    const r = await page.evaluate((org) => { orgNow = () => orgClean(org); const m = wvMonths()[0];
      const salCat = (S.cats || []).find((c) => c.beh === 'emp'), expCat = (S.cats || []).find((c) => c.t === 'exp' && c.beh !== 'emp' && c.id !== 'e_own'), incCat = (S.cats || []).find((c) => c.t === 'inc');
      S.ownExp = false;
      S.tx = [
        { id: 't1', t: 'inc', cat: incCat && incCat.id, amt: 1000, date: m + '-02', br: 'br_a' },
        { id: 't2', t: 'inc', cat: incCat && incCat.id, amt: 500, date: m + '-03', br: 'br_b' },
        { id: 't3', t: 'exp', cat: expCat && expCat.id, amt: 300, date: m + '-04', br: 'br_a' },
        { id: 't4', t: 'exp', cat: salCat ? salCat.id : (expCat && expCat.id), amt: 200, date: m + '-05', br: 'br_b' },
        { id: 't5', t: 'exp', cat: 'e_own', amt: 999, date: m + '-06', br: 'br_a' },
        { id: 't6', t: 'inc', cat: incCat && incCat.id, amt: 70, date: m + '-07' },
      ];
      const W = wvWant(), j = (id) => (W[id] ? JSON.parse(W[id]) : null);
      return { m, all: j('bal_' + m), a: j('bal_' + m + '_br_a'), b: j('bal_' + m + '_br_b'), keys: Object.keys(W).filter((k) => k.startsWith('bal_')), hasSal: !!salCat };
    }, ORG);
    check('1 מנהל: bal_ = סך העסק (בלי משיכת בעלים), bal_<סניף> לכל סניף; תנועה בלי סניף = הסניף הראשון',
      r.all && r.all.i === 1570 && r.all.e === 500 && r.a && r.a.i === 1070 && r.a.e === 300 && r.b && r.b.i === 500 && r.b.e === 200 && r.keys.length === 6, r);
    check('1א המסמך מכיל שני מספרים בלבד (בלי שמות, קטגוריות או תנועות)', r.all && Object.keys(r.all).sort().join() === 'e,i', r.all);
    await ctx.close(); }

  // 2. עובד: האריח מופיע רק עם המתג; מוגבל לסניף – מבקש רק את מסמך הסניף שלו
  { const { ctx, page } = await H.newPage(browser, www, bcfg, [], 'bw'); await page.setViewportSize({ width: 360, height: 740 }); await H.login(page, 'wa@x.co');
    await page.evaluate((org) => { orgNow = () => orgClean(org); window.__req = [];
      wvGet = async (id) => { window.__req.push(id); const d = { a: { i: 1070, e: 300 }, b: { i: 500, e: 200 }, all: { i: 1570, e: 500 } }; const k = /_br_a$/.test(id) ? 'a' : /_br_b$/.test(id) ? 'b' : 'all'; return { v: d[k], at: 1731400000000 }; }; }, ORG);
    const t0 = await page.evaluate(() => { SY.perms = { incR: false, incW: true, expR: false, expW: true, sup: false, sal: false, rep: false, ord: false, trf: false }; WS = 'home'; NAV = [{ v: 'wk' }]; render(0); return [...document.querySelectorAll('[data-a=wvGo]')].map((b) => b.dataset.k); });
    check('2 בלי המתג: אין אריח "מצב העסק"', !t0.includes('bal'), t0);
    const t1 = await page.evaluate(() => { SY.perms = { incR: false, incW: true, expR: false, expW: true, sup: false, sal: false, rep: false, ord: false, trf: false, bal: true, balB: ['br_a'] }; render(0); return [...document.querySelectorAll('[data-a=wvGo]')].map((b) => b.dataset.k); });
    check('2א עם המתג: אריח "מצב העסק"', t1.includes('bal'), t1);
    await page.evaluate(() => { window.__req = []; ACT.wvGo({ dataset: { k: 'bal' } }); }); await H.settle(page, 800);
    const v = await page.evaluate(() => ({ req: window.__req, t: document.body.innerText, rows: [...document.querySelectorAll('#balTbl tbody tr')].map((r) => r.innerText), ov: document.documentElement.scrollWidth - innerWidth }));
    await shot(page, '01-עובד-מוגבל-לסניף');
    check('2ב מוגבל לסניף מרכז: מבקש רק bal_<חודש>_br_a (לא את סך העסק ולא סניף אחר)', v.req.length === 1 && /^bal_\d{4}-\d{2}_br_a$/.test(v.req[0]), v.req);
    check('2ג הטבלה: שורת סניף מרכז בלבד, רווח 770, בלי גלילה רוחבית ובלי שגיאות JS',
      v.rows.length === 1 && /סניף מרכז/.test(v.rows[0]) && !/צפון/.test(v.t) && /770/.test(v.t) && /מוצגים רק הסניפים שאושרו לך/.test(v.t) && v.ov <= 1 && page.__errors.length === 0, { rows: v.rows, ov: v.ov, err: page.__errors });
    // 3. בלי הגבלה: סך העסק + שורה לכל סניף
    await page.evaluate(() => { SY.perms = Object.assign({}, SY.perms, { balB: undefined }); delete SY.perms.balB; window.__req = []; WVW.D = null; wvLoad(); }); await H.settle(page, 800);
    const w = await page.evaluate(() => ({ req: window.__req.slice().sort(), rows: [...document.querySelectorAll('#balTbl tbody tr')].map((r) => r.innerText), foot: (document.querySelector('#balTbl tfoot') || {}).innerText || '', ov: document.documentElement.scrollWidth - innerWidth }));
    await shot(page, '02-עובד-כל-הסניפים');
    check('3 בלי הגבלה: סך העסק + שני הסניפים, שורת סה״כ 1,070 רווח', w.req.length === 3 && w.rows.length === 2 && /1,?070/.test(w.foot) && w.ov <= 1 && page.__errors.length === 0, w);
    await ctx.close(); }

  // 4. חלון ההרשאות / דרגה: בחירת סניפים מופיעה רק בעסק עם 2+ סניפים, ונקראת מהטופס
  { const { ctx, page } = await H.newPage(browser, www, bcfg, [], 'bp'); await H.login(page, 'ma@x.co');
    const r = await page.evaluate((org) => { orgNow = () => orgClean(org);
      const f = document.createElement('form'); f.innerHTML = pmBoxes({ bal: true, balB: ['br_b'] }); document.body.appendChild(f);
      const boxes = [...f.querySelectorAll('[name=p_balB]')].map((c) => c.value + ':' + c.checked);
      const p1 = pmRead(fd(f), f); f.querySelector('[name=p_balB][value=br_b]').checked = false; const p2 = pmRead(fd(f), f);
      orgNow = () => orgClean({ branches: [{ id: 'br_a', name: 'יחיד' }] }); const one = /p_balB/.test(pmBoxes({ bal: true }));
      return { boxes, p1, p2, one, label: /רואה מצב העסק/.test(f.innerHTML) }; }, ORG);
    check('4 חלון ההרשאות: מתג "רואה מצב העסק" + סניפים לבחירה; בלי סימון = בלי balB; סניף יחיד – בלי בחירה',
      r.label && r.boxes.join() === 'br_a:false,br_b:true' && r.p1.bal === true && JSON.stringify(r.p1.balB) === '["br_b"]' && r.p2.balB === undefined && !r.one, r);
    await ctx.close(); }

  await browser.close();
  if (outFile) fs.writeFileSync(outFile, JSON.stringify({ out }, null, 1));
  console.log(fail ? `תוצאה: נכשל (${fail})` : 'תוצאה: הכול עבר'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
