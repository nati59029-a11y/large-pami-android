'use strict';
// 19.11.2026: קופות (ZREG) לפי העסק. עסק שאינו לארג' פעמי (BZGEN) – קופה אחת "קופה" (i_nl), בלי שמות ומספרים של לארג' פעמי;
// רשומות ישנות עם i_yh – "קופה 2", בלי קריסה. לארג' פעמי – שתי הקופות כמו קודם. רשת מדומה, בלי אמולטור.
// שימוש: node ui-zreg-gen.js <www-dir>
const H = require('./harness');
const BZ0 = ['larg', 'peami'].join('');
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders', 'groups'].map((k) => [k, true]));
let fail = 0; const check = (n, ok, info) => { if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LP = /יהודה הנשיא|נחל לכיש|6346053|6328947/;
const closeD = (pg) => pg.evaluate(() => { const d = document.getElementById('dlg'); if (d && d.open) closeDlg(); });
const view = async (pg, v) => { await pg.evaluate((x) => { go(x); if (x === 'zc') ACT.zcManual(); }, v); await sleep(500); await closeD(pg);
  return pg.evaluate(() => ({ t: document.getElementById('main').innerText,
    zc: [...document.querySelectorAll('#main select[name=reg] option')].map((o) => o.textContent),
    cm: (s => s ? { opts: [...s.options].map((o) => o.textContent), hid: getComputedStyle(s).display === 'none' } : null)(document.querySelector('#main [data-c=cmgReg]')),
    zs: (s => s ? { opts: [...s.options].map((o) => o.textContent), hid: getComputedStyle(s.closest('label')).display === 'none' } : null)(document.querySelector('#main [data-c=zsReg]')) })); };

(async () => {
  const [www] = process.argv.slice(2); const browser = await H.launch();

  // ---- עסק חדש (BZGEN) ----
  { const cfg = { mode: 'new', users: { ma: 'acme' }, biz: { acme: { dataRoot: 'b', features: ALL } }, admins: { 'b/acme/|ma': 1 } };
    const { ctx, page: pg } = await H.newPage(browser, www, cfg, [], 'g'); await pg.setViewportSize({ width: 412, height: 900 });
    await H.login(pg, 'ma@x.co'); if (await pg.$('[data-a=startBlank]')) { await pg.click('[data-a=startBlank]'); await sleep(300); } await sleep(800); await closeD(pg);
    const r = await pg.evaluate(() => ({ gen: BZGEN, keys: Object.keys(ZREG), forin: (() => { const a = []; for (const k in ZREG) a.push(k); return a; })(), n: ZREG.i_nl.n, yh: ZREG.i_yh && ZREG.i_yh.n,
      one: [zcRegOne('6346053', 'יהודה הנשיא'), zcRegOne('', ''), zcRegOne('123', 'משהו')], of: zcRegOf({ zReg: '6346053', zStore: 'נחל לכיש', oReg: '6328947', oStore: '' }),
      zn: zcNew().reg }));
    check('1 BZGEN: ZREG = קופה אחת i_nl בשם "קופה" (Object.keys וגם for-in)', r.gen === true && r.keys.join() === 'i_nl' && r.forin.join() === 'i_nl' && r.n === 'קופה', r);
    check('1א רשומה ישנה עם i_yh מוצגת "קופה 2" (לא נכשלת)', r.yh === 'קופה 2', r);
    check('1ב זיהוי דוח Z לא חוסם: כל מספר/שם (גם ריק) → i_nl, בלי "שונה"', r.one.every((x) => x === 'i_nl') && r.of.reg === 'i_nl' && !r.of.bad, r);
    check('1ג טופס חדש: הקופה נבחרת מראש', r.zn === 'i_nl', r);
    const c = await pg.evaluate(() => { const had = !!cat('i_nl'); const x = catReg('i_nl'); return { had, name: x && x.name, reg: (cat('i_reg') || {}).name }; });
    check('1ד catReg ב-BZGEN: קטגוריית הקופה "סגירות קופה" (לא מתנגשת ב"קופה" של i_reg)', c.had || c.name === 'סגירות קופה', c);
    const z = await view(pg, 'zc');
    check('2 טופס סגירת קופה: רק "קופה" (ו"בחר קופה"), בלי שמות לארג\' פעמי', z.zc.filter((x) => x !== 'בחר קופה').join() === 'קופה' && !LP.test(z.t), z.zc);
    const m = await view(pg, 'cm');
    check('3 מסך "קופה והפקדות": בורר הקופה מוסתר, בלי שמות לארג\' פעמי', m.cm && m.cm.hid && m.cm.opts.filter((x) => x !== 'שתיהן').join() === 'קופה' && !LP.test(m.t), m.cm);
    const s = await view(pg, 'zs');
    check('4 "סיכום סגירות קופה": בורר מוסתר, בלי "שתי הקופות" בטקסט ובלי שמות לארג\' פעמי', s.zs && s.zs.hid && !/שתי הקופות/.test(s.t) && !LP.test(s.t), s.zs);
    const ca = await view(pg, 'cash'); const dp = await view(pg, 'dp');
    check('5 "סגירת קופה והפקדות" ו"העלאת אישור הפקדה": בלי שמות לארג\' פעמי', !LP.test(ca.t) && !LP.test(dp.t));
    // רשומות ישנות עם i_yh: תווית "קופה 2" בהוצאה מקופה
    const old = await pg.evaluate(() => { const t = { id: 'zo1', t: 'exp', cat: (S.cats.find((x) => x.kind === 'exp') || {}).id, date: '2026-11-01', amt: 10, creg: 'i_yh', src: 'zow1', cowhy: 'ישן', pays: [], kind: 'inv' };
      S.tx.push(t); let ok = true; try { coMine(); coLastH(); } catch (e) { ok = String(e); } S.tx = S.tx.filter((x) => x.id !== 'zo1'); return ok; });
    check('6 הוצאה ישנה עם i_yh: חישובי הוצאה מקופה לא קורסים', old === true, old);
    check('7 בלי שגיאות JavaScript בדף', !pg.__errors.length, pg.__errors);
    await ctx.close(); }

  // ---- לארג' פעמי: ללא שינוי ----
  { const cfg = { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: ALL } }, admins: { '|m': 1 } };
    const { ctx, page: pg } = await H.newPage(browser, www, cfg, [], 'lp'); await pg.setViewportSize({ width: 412, height: 900 });
    await H.login(pg, 'm@x.co'); if (await pg.$('[data-a=startBlank]')) { await pg.click('[data-a=startBlank]'); await sleep(300); } await sleep(800); await closeD(pg);
    const r = await pg.evaluate(() => ({ gen: BZGEN, z: JSON.stringify(Object.keys(ZREG).map((k) => [k, ZREG[k].n, ZREG[k].no, String(ZREG[k].k)])), zn: zcNew().reg,
      one: [zcRegOne('6346053', ''), zcRegOne('', 'נחל לכיש'), zcRegOne('', '')] }));
    check('8 לארג\' פעמי: ZREG כמו קודם (שתי קופות, מספרים ומילות זיהוי)', r.gen === false && r.z === JSON.stringify([['i_yh', 'יהודה הנשיא', '6346053', '/יהודה|הנשיא/'], ['i_nl', 'נחל לכיש', '6328947', '/נחל|לכיש/']]), r);
    check('8א זיהוי דוח Z ובחירה בטופס חדש – כמו קודם', r.one.join() === 'i_yh,i_nl,' && r.zn === '', r);
    const z = await view(pg, 'zc');
    check('9 טופס סגירה: שתי הקופות', z.zc.join() === 'בחר קופה,יהודה הנשיא,נחל לכיש', z.zc);
    const m = await view(pg, 'cm');
    check('10 "קופה והפקדות": בורר גלוי עם "שתיהן" ושתי הקופות', m.cm && !m.cm.hid && m.cm.opts.join() === 'שתיהן,יהודה הנשיא,נחל לכיש', m.cm);
    const s = await view(pg, 'zs');
    check('11 "סיכום סגירות קופה": בורר גלוי עם "שתי הקופות"', s.zs && !s.zs.hid && s.zs.opts.join() === 'שתי הקופות,יהודה הנשיא,נחל לכיש', s.zs);
    check('12 בלי שגיאות JavaScript בדף', !pg.__errors.length, pg.__errors);
    await ctx.close(); }

  await browser.close();
  console.log(fail ? `נכשלו ${fail}` : 'הכל עבר'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
