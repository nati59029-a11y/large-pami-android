'use strict';
// חלוקה ב"לטיפול" (11.11.2026, שלב 2): כל מסמך שעובד שלח מופיע בקבוצה אחת בלבד –
// הוצאה מקופה (data.reg) רק ב"הוצאה מקופה", חשבונית ספק (קטגוריה מסוג ספק, בלי reg) רק ב"חשבוניות ספקים", והשאר ב"הוצאות מעובדים".
// המונה = מספר המסמכים בפועל, הקבוצות האחרות לא נעלמו, ואישור/שינוי עובדים מתוך קבוצת החשבוניות.
// רשת מדומה (בלי אמולטור). שימוש: node ui-todo-split.js <www-dir> [out.json]
const fs = require('fs'); const H = require('./harness');
const BZ0 = ['larg', 'peami'].join('');
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
let fail = 0; const res = []; const check = (n, ok, info) => { if (!ok) fail++; res.push({ n, ok: !!ok, info }); console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const [www, out] = process.argv.slice(2);
  const browser = await H.launch();
  const cfg = { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: ALL } }, admins: { '|m': 1 }, staff: { '|w': 1 } };
  const { ctx, page } = await H.newPage(browser, www, cfg, [], 'm'); await page.setViewportSize({ width: 360, height: 740 });
  await H.login(page, 'm@x.co'); await sleep(600);
  await page.evaluate(() => { INB.ms = 3600000; inbStart(); });

  // 3 מסמכים: הוצאה מקופה, חשבונית ספק, הוצאה רגילה (+ הוצאה מקופה שסווגה לקטגוריית ספק – עדיין הוצאה מקופה)
  const r1 = await page.evaluate(() => {
    const ex = S.cats.find((c) => c.kind === 'exp' && c.beh !== 'sup' && !SUPC[c.id]);
    const sub = { id: 'tsSup1', cat: 'e_sup', name: 'ספק בדיקה' }; if (!S.subs.some((x) => x.id === sub.id)) S.subs.push(sub);
    const it = (id, d) => ({ id, by: 'עובד בדיקה', at: '2026-11-03T09:00:00Z', d: Object.assign({ date: '2026-11-03', note: '' }, d) });
    S.inbox = [
      it('tsReg', { reg: true, amt: 30, creg: '', note: 'חלב' }),
      it('tsSup', { cat: 'e_sup', sub: 'tsSup1', amt: 117, inv: '5501' }),
      it('tsExp', { cat: ex.id, amt: 25 }),
      it('tsRegSup', { reg: true, cat: 'e_sup', sub: 'tsSup1', amt: 12, note: 'ספק מזומן' }),
    ]; S.tx = S.tx.filter((t) => !/^ts/.test(t.src || '')); save();
    NAV = [{ v: 'home' }]; go('todo');
    const opts = [...document.querySelectorAll('#main [data-v=inbox]')].map((b) => ({ k: b.dataset.arg, n: (b.querySelector('.tag') || {}).textContent || '', t: b.innerText }));
    const c = todoC();
    const ids = (k) => { NAV.push({ v: 'inbox', a: k }); render(1); const r = [...document.querySelectorAll('#main [data-a=inbEdit]')].map((b) => b.dataset.id); NAV.pop(); return r; };
    const g = { reg: ids('reg'), sup: ids('sup'), exp: ids('exp'), all: ids(undefined) };
    render(1);
    const tile = (() => { const d = document.createElement('div'); d.innerHTML = adTiles(); return [...d.querySelectorAll('[data-v=todo] .tag')].map((e) => +e.textContent); })();
    return { opts, c, g, tile };
  });
  const k = (x) => r1.opts.map((o) => o.k).sort().join(',') === 'exp,reg,sup' && r1.opts.find((o) => o.k === x);
  check('1 "לטיפול": שלוש קבוצות נפרדות – הוצאה מקופה, חשבוניות ספקים, הוצאות מעובדים (כל אחת פעם אחת)', k('reg') && k('sup') && k('exp') && r1.opts.length === 3, r1.opts);
  check('2 הוצאה מקופה רק בקבוצה "הוצאה מקופה" (גם אם סווגה לקטגוריית ספק)', r1.g.reg.sort().join() === 'tsReg,tsRegSup' && !r1.g.sup.includes('tsReg') && !r1.g.sup.includes('tsRegSup') && !r1.g.exp.includes('tsReg'), r1.g);
  check('3 חשבונית ספק רק בקבוצת החשבוניות', r1.g.sup.join() === 'tsSup' && !r1.g.reg.includes('tsSup') && !r1.g.exp.includes('tsSup'), r1.g);
  check('4 הוצאה רגילה רק ב"הוצאות מעובדים"', r1.g.exp.join() === 'tsExp', r1.g);
  check('5 כל מסמך בדיוק בקבוצה אחת (סכום הקבוצות = כל המסמכים, בלי כפילות); בלי פרמטר – הכול כמו קודם', r1.g.reg.length + r1.g.sup.length + r1.g.exp.length === 4 && r1.g.all.length === 4 && new Set([...r1.g.reg, ...r1.g.sup, ...r1.g.exp]).size === 4, r1.g);
  check('6 המונים: 2/1/1, והמונה הכולל במשבצת "לטיפול" סופר כל מסמך פעם אחת', r1.c.reg === 2 && r1.c.sup === 1 && r1.c.exp === 1 && r1.opts.find((o) => o.k === 'reg').n === '2' && r1.c.n === r1.c.si + 4 + r1.c.ar + r1.c.dn + r1.c.no + r1.c.aw + (r1.c.mq || 0) && r1.tile.includes(r1.c.n), { c: r1.c, tile: r1.tile });

  // 7. קבוצת החשבוניות: יש "בדיקה ושינוי" ו"אשר", והאישור מכניס הוצאה ומוציא מהרשימה
  const r7 = await page.evaluate(async () => {
    NAV = [{ v: 'home' }, { v: 'todo' }]; go('inbox', 'sup'); await new Promise((r) => setTimeout(r, 50));
    const ttl = document.getElementById('ttl').innerText, edit = !!document.querySelector('#main [data-a=inbEdit][data-id=tsSup]') && document.querySelectorAll('#main .card button[data-a]').length === 1; ACT.inbEdit({ dataset: { id: 'tsSup' } }); const hasOk = !!document.querySelector('#dlg[open] [data-a=inbSaveOk]') && !!document.querySelector('#dlg[open] [data-a=inbNo][data-id=tsSup]'); closeDlg(); const ok = { dataset: { id: 'tsSup' } };
    const n0 = S.tx.length; await ACT.inbOk(ok); await new Promise((r) => setTimeout(r, 300));
    const dlgOpen = !!document.querySelector('#dlg[open]'); let btn = document.querySelector('#dlg[open] [data-a=closeDlg]');
    return { ttl, edit, hasOk, added: S.tx.length - n0, gone: !S.inbox.some((x) => x.id === 'tsSup'), stay: cur().v === 'inbox' && cur().a === 'sup', dlgOpen, dlgTxt: dlgOpen ? document.querySelector('#dlg').innerText.slice(0, 200) : '', btn: !!btn };
  });
  check('7 קבוצת החשבוניות: כותרת נכונה, בכרטיס רק "בדיקה", ובמסך הבדיקה "שמור ואשר" ו"דחה"; אישור מכניס הוצאה אחת ומוציא את החשבונית מהרשימה', /חשבוניות ספקים/.test(r7.ttl) && r7.edit && r7.hasOk && r7.added === 1 && r7.gone && r7.stay, r7);

  // 8. קבוצות אחרות לא נעלמו: שולם-ממתין לחשבונית, חשבוניות לטיפול, ממתין לטיפול (mq)
  const r8 = await page.evaluate(() => {
    S.tx.push({ id: 'tsAw', t: 'exp', cat: 'e_sup', sub: 'tsSup1', date: '2026-11-02', amt: 50, await: 1, pays: [] });
    S.tx.push({ id: 'tsDn', t: 'exp', cat: 'e_sup', sub: 'tsSup1', date: '2026-11-02', amt: 40, dn: 1, pays: [] });
    MQ.L = MQ.L || []; MQ.L.push({ id: 'tsMq', st: 'new', by: 'עובד', t: Date.now(), k: 'invoice', np: 0 });
    NAV = [{ v: 'home' }]; go('todo'); const t = document.getElementById('main').innerText;
    return { aw: t.includes('שולם – ממתין לחשבונית'), dn: t.includes('חשבוניות לטיפול'), mq: t.includes('ממתין לטיפול') || t.includes('נשלח למנהל לטיפול'), tr: !!document.querySelector('#main [data-a]') };
  });
  check('8 שאר הקבוצות ב"לטיפול" נשארו (שולם-ממתין לחשבונית, חשבוניות לטיפול, נשלח למנהל לטיפול)', r8.aw && r8.dn && r8.mq, r8);
  check('9 אין שגיאות JS', page.__errors.length === 0, page.__errors);
  await ctx.close(); await browser.close();
  if (out) fs.writeFileSync(out, JSON.stringify({ fail, res }, null, 1));
  console.log(fail ? `נכשלו ${fail}` : 'הכול עבר'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
