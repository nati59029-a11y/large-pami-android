'use strict';
// ניקוי "עוד" והעברת "סנכרון ועובדים" להגדרות (11.11.2026, שלב 4).
// מנהל: ב"עוד" אין חשבוניות לטיפול / סנכרון ועובדים / סריקת חשבוניות / ממתין לסיווג / חשבוניות לתשלום / צילום העברה,
// ולכל אחד יש דרך חלופית שנבדקת כאן בלחיצה. בהגדרות שורה "עובדים ופרסום קטגוריות" שפותחת את מסך הסנכרון (כולל פרסום).
// עובד: לא רואה את השורה בהגדרות. רשת מדומה (בלי אמולטור). שימוש: node ui-more-clean.js <www-dir> [out.json]
const fs = require('fs'); const H = require('./harness');
const BZ0 = ['larg', 'peami'].join('');
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
let fail = 0; const res = []; const check = (n, ok, info) => { if (!ok) fail++; res.push({ n, ok: !!ok, info }); console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GONE = ['חשבוניות לטיפול', 'סנכרון ועובדים', 'סריקת חשבוניות', 'ממתין לסיווג', 'חשבוניות לתשלום', 'צילום העברה'];

(async () => {
  const [www, out] = process.argv.slice(2);
  const browser = await H.launch();
  const cfg = { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: ALL } }, admins: { '|m': 1 }, staff: { '|w': 1 } };
  const { ctx, page } = await H.newPage(browser, www, cfg, [], 'm'); await page.setViewportSize({ width: 360, height: 740 });
  await H.login(page, 'm@x.co'); await sleep(600);
  await page.evaluate(() => { if (typeof INB !== 'undefined') { INB.ms = 3600000; inbStart(); } });
  // נתונים שמפעילים את כל הדרכים החלופיות: תשלום שממתין לחשבונית, תעודת משלוח, תנועה לסיווג
  await page.evaluate(() => {
    S.tx.push({ id: 'mcAw', t: 'exp', cat: 'e_sup', sub: '', date: '2026-11-02', amt: 50, await: 1, pays: [] });
    S.tx.push({ id: 'mcDn', t: 'exp', cat: 'e_sup', sub: '', date: '2026-11-02', amt: 40, dn: 1, pays: [] });
    S.tx.push({ id: 'mcP', t: 'exp', cat: 'p_exp', sub: '', date: '2026-11-02', amt: 10, pays: [] }); save();
  });

  // 1. "עוד" של המנהל
  const m1 = await page.evaluate(() => { NAV = [{ v: 'more' }]; render(0); const t = document.getElementById('main').innerText; return { t, n: document.querySelectorAll('.mlist .opt').length, sync: !!document.querySelector('#main [data-v=sync]'), tr: !!document.querySelector('#main [data-a=trGo]') }; });
  check('1 מנהל – ב"עוד" לא מופיע אף אחד מששת הפריטים', GONE.every((x) => !m1.t.includes(x)) && !m1.sync && !m1.tr, { present: GONE.filter((x) => m1.t.includes(x)) });
  check('2 מנהל – שאר הפריטים ב"עוד" נשארו (הוצאות קבועות, הלוואות, כרטיסי אשראי, השוואות, ייבוא, גיבוי, הגדרות, ייצוא חשבוניות)', ['הוצאות קבועות', 'הלוואות', 'כרטיסי אשראי', 'השוואות', 'ייבוא מאקסל', 'גיבוי ושחזור', 'הגדרות', 'ייצוא חשבוניות'].every((x) => m1.t.includes(x)), { n: m1.n });

  // 3. הגדרות ← עובדים ופרסום קטגוריות ← מסך הסנכרון עם פרסום ו"בדוק עכשיו"
  const m3 = await page.evaluate(async () => {
    NAV = [{ v: 'home' }]; go('settings'); const b = document.querySelector('#main [data-a=go][data-v=sync]'); const txt = b ? b.innerText : '';
    if (b) b.click(); await new Promise((r) => setTimeout(r, 100));
    return { txt, v: cur().v, pub: !!document.querySelector('#main [data-a=syPub]'), pull: !!document.querySelector('#main [data-a=syPull]'), act: typeof ACT.syPub === 'function' };
  });
  check('3 הגדרות: שורה "עובדים ופרסום קטגוריות" פותחת את מסך הסנכרון, עם "פרסם קטגוריות וספקים לעובדים" ו"בדוק עכשיו"', /עובדים ופרסום קטגוריות/.test(m3.txt) && m3.v === 'sync' && m3.pub && m3.pull && m3.act, m3);
  // 3א. כפתור הפרסום עובד משם (קריאה בפועל ל-ACT.syPub עם רשת מדומה – בודקים שלא נזרקת שגיאה ושמתקבלת הודעה)
  const m3a = await page.evaluate(async () => { const T = []; const mo = new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.classList && n.classList.contains('toast')) T.push(n.textContent); }))); mo.observe(document.body, { childList: true }); let err = ''; try { await ACT.syPub(document.querySelector('#main [data-a=syPub]')); } catch (e) { err = String(e); } await new Promise((r) => setTimeout(r, 600)); mo.disconnect(); return { err, T }; });
  check('3א "פרסם קטגוריות וספקים לעובדים" רץ מהמסך שנפתח מההגדרות (בלי שגיאה, עם הודעה)', !m3a.err && m3a.T.length > 0, m3a);

  // 4. דרכים חלופיות – לחיצה שמגיעה למסך
  const click = (sel, setup) => page.evaluate(async ({ sel, setup }) => { NAV = [{ v: setup }]; render(0); const b = document.querySelector(sel); if (!b) return { found: false }; b.click(); await new Promise((r) => setTimeout(r, 150)); const r = { found: true, v: cur().v, us: !!document.querySelector('#sheet [data-c=uspick]') }; try { if (typeof usReset === 'function') usReset(); } catch (e) { /* */ } return r; }, { sel, setup });
  const a1 = await click('#main [data-a=go][data-v=tdn]', 'home');
  const a1b = await click('#main [data-a=go][data-v=tdn]', 'todo');
  check('4 חשבוניות לטיפול: מהבית ("ממתין לחשבונית") ומ"לטיפול"', a1.v === 'tdn' && a1b.v === 'tdn', { a1, a1b });
  const a2 = await click('#main [data-a=go][data-v=scan]', 'home');
  check('5 סריקת חשבוניות: הכפתור "סריקה" בבית פותח את מסך ההכנסה האחיד', a2.found && (a2.us || a2.v === 'scan'), a2);
  const a3 = await click('#main [data-a=go][data-v=pend]', 'home');
  check('6 ממתין לסיווג: מהבית (באנר "לסיווג" כשיש תנועות)', a3.v === 'pend', a3);
  const a4 = await click('#main [data-a=go][data-v=due]', 'home');
  check('7 חשבוניות לתשלום: מהבית (כפתור "הכול" ליד "לסגור ב...")', a4.v === 'due', a4);
  const a5 = await page.evaluate(() => { NAV = [{ v: 'todo' }]; render(0); return !!document.querySelector('#main [data-a=trGo]') || !trOk(); });
  const a5b = await click('#main [data-a=trGo]', 'todo');
  check('8 צילום העברה: הכפתור ב"לטיפול" פותח את המסך האחיד', a5 && (a5b.found ? a5b.us : true), { a5, a5b });
  const a6 = await page.evaluate(() => { const r = {}; for (const v of ['sync', 'tdn', 'scan', 'pend', 'due']) { NAV = [{ v: 'home' }]; go(v); r[v] = cur().v === v && document.getElementById('main').innerHTML.length > 50; } try { if (typeof usReset === 'function') usReset(); } catch (e) { /* */ } return r; });
  check('9 קישורים פנימיים go(...) למסכים שהוסרו מ"עוד" עדיין עובדים', Object.values(a6).every(Boolean), a6);
  check('10 אין שגיאות JS (מנהל)', page.__errors.length === 0, page.__errors);
  await ctx.close();

  // ---------- עובד ----------
  {
    const w = await H.newPage(browser, www, cfg, [], 'w'); const wp = w.page; await wp.setViewportSize({ width: 360, height: 740 });
    await H.login(wp, 'w@x.co'); await sleep(600);
    const r = await wp.evaluate(() => { NAV = [{ v: 'settings' }]; render(0); return { row: /עובדים ופרסום קטגוריות/.test(document.getElementById('main').innerText), sync: !!document.querySelector('#main [data-v=sync]'), isA: isA() }; });
    check('11 עובד: אין שורה "עובדים ופרסום קטגוריות" בהגדרות', !r.isA && !r.row && !r.sync, r);
    check('12 אין שגיאות JS (עובד)', wp.__errors.length === 0, wp.__errors);
    await w.ctx.close();
  }
  await browser.close();
  if (out) fs.writeFileSync(out, JSON.stringify({ fail, res }, null, 1));
  console.log(fail ? `נכשלו ${fail}` : 'הכול עבר'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
