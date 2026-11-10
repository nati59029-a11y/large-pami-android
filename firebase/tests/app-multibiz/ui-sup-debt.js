'use strict';
// כרטיס ספק: לחיצה על "חוב פתוח" / "באיחור" פותחת את רשימת החשבוניות (V.subOpen), עם בחירה וסגירה יחד;
// חלון החשבונית: כפתור "עריכה" בראש החלון, ועריכת תאריך/סכום/מספר חשבונית נשמרת.
// שימוש: NODE_PATH=... node ui-sup-debt.js <www-dir> [shots-dir]
const H = require('./harness');
const BZ0 = ['larg', 'peami'].join('');
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
let fail = 0; const check = (n, ok, info) => { if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
(async () => {
  const [www, shots] = process.argv.slice(2); const browser = await H.launch();
  const cfg = { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: ALL } }, admins: { '|m': 1 }, staff: {} };
  const m = await H.newPage(browser, www, cfg, [], 'm'); const p = m.page; await p.setViewportSize({ width: 360, height: 740 }); await H.login(p, 'm@x.co');
  await p.evaluate(() => { try { sheetClose(); } catch (e) {} });
  const info = await p.evaluate(() => {
    const now = NOWM(), prev = ym(new Date(new Date().getFullYear(), new Date().getMonth() - 2, 5)), next = ym(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 5));
    S.subs = S.subs.filter((s) => s.id !== 'sD'); S.subs.push({ id: 'sD', cat: 'e_sup', name: 'ספק בדיקה' });
    S.tx = S.tx.filter((t) => t.sub !== 'sD');
    const T = (id, plan, amt, pays, o) => Object.assign({ id, t: 'exp', cat: 'e_sup', sub: 'sD', date: plan + '-03', amt, kind: 'inv', plan, inv: id.toUpperCase(), note: '', pays: pays || [] }, o);
    S.tx.push(T('l1', prev, 100), T('l2', prev, 50, [{ id: 'pp', d: prev + '-10', a: 20, m: 'מזומן' }]), T('n1', now, 70), T('f1', next, 30), T('d1', prev, 40, [{ id: 'pq', d: prev + '-11', a: 40, m: 'מזומן' }]),
      { id: 'c1', t: 'exp', cat: 'e_sup', sub: 'sD', date: prev + '-04', amt: -15, kind: 'credit', inv: 'CR1', note: '', pays: [] });
    save(); return { now, prev, next };
  });
  // 1. כרטיס: המשבצות הן כפתורים
  await p.evaluate(() => go('card', 'sD')); await H.settle(p, 400);
  const c = await p.evaluate(() => [...document.querySelectorAll('button.k[data-v=subOpen]')].map((b) => ({ arg: b.dataset.arg, t: b.innerText.replace(/\s+/g, ' ') })));
  check('1 בכרטיס הספק שתי משבצות לחיצות: חוב פתוח ובאיחור', c.length === 2 && c[0].arg === 'sD|all' && c[1].arg === 'sD|late', c);
  if (shots) await p.screenshot({ path: shots + '/sup-card.png' });
  // 2. לחיצה על "חוב פתוח": l1, l2, n1, f1 (לא d1 שנסגר), וזיכוי פתוח
  await p.evaluate(() => document.querySelector('button.k[data-arg="sD|all"]').click()); await H.settle(p, 400);
  const a = await p.evaluate(() => ({ v: cur().v, ids: [...document.querySelectorAll('#main [data-a=tx]')].map((b) => b.dataset.id), txt: document.querySelector('#main').innerText }));
  check('2 "חוב פתוח": כל החשבוניות עם יתרה (l1,l2,n1,f1) + הזיכוי הפתוח, בלי החשבונית שנסגרה', a.v === 'subOpen' && ['l1', 'l2', 'n1', 'f1', 'c1'].every((i) => a.ids.includes(i)) && !a.ids.includes('d1'), a.ids);
  check('2א הסכום בראש המסך = החוב הפתוח בכרטיס (100+30+70+30 = 230)', /230/.test(a.txt), a.txt.slice(0, 160));
  if (shots) await p.screenshot({ path: shots + '/sup-open.png', fullPage: true });
  // 3. בחירה וסגירה יחד זמינה
  await p.evaluate(() => document.querySelector('[data-a=msMode]').click()); await H.settle(p, 300);
  const sel = await p.evaluate(() => document.querySelectorAll('#main [data-a=msPick]').length);
  check('3 "בחירה" מציג תיבות סימון לחשבוניות ולזיכוי', sel === 5, sel);
  // 4. "באיחור": רק l1 ו-l2
  await p.evaluate(() => { NAV.pop(); render(0); }); await H.settle(p, 300);
  await p.evaluate(() => document.querySelector('button.k[data-arg="sD|late"]').click()); await H.settle(p, 400);
  const l = await p.evaluate(() => ({ ids: [...document.querySelectorAll('#main [data-a=tx]')].map((b) => b.dataset.id), txt: document.querySelector('#main').innerText }));
  check('4 "באיחור": רק l1 ו-l2 (130), בלי זיכויים', l.ids.length === 2 && l.ids.includes('l1') && l.ids.includes('l2') && /130/.test(l.txt), l.ids);
  // 5. חלון החשבונית: כפתור עריכה בראש החלון, ועריכה נשמרת
  await p.evaluate(() => document.querySelector('#main [data-a=tx][data-id=l1]').click()); await H.settle(p, 300);
  const d = await p.evaluate(() => { const b = [...document.querySelectorAll('#dlg [data-a=txEdit]')]; return { n: b.length, t: b[0] && b[0].innerText }; });
  check('5 בחלון החשבונית כפתור עריכה אחד, בולט, עם "תאריך, סכום, מספר חשבונית"', d.n === 1 && /תאריך, סכום, מספר חשבונית/.test(d.t), d);
  if (shots) await p.screenshot({ path: shots + '/sup-dlg.png' });
  await p.evaluate(() => document.querySelector('#dlg [data-a=txEdit]').click()); await H.settle(p, 300);
  const e = await p.evaluate((pr) => { const f = document.querySelector('#dlg form[data-f=tsave]'); if (!f) return { err: 'no form' }; const set = (n, v) => { const x = f.querySelector('[name=' + n + ']'); if (x) { x.value = v; return 1; } return 0; };
    const r = { amt: set('amt', '120'), inv: set('inv', 'NEW-9'), date: set('date', pr + '-07') }; f.requestSubmit(); return r; }, info.prev);
  await H.settle(p, 300);
  const t = await p.evaluate(() => { const x = S.tx.find((y) => y.id === 'l1'); return { amt: x.amt, inv: x.inv, date: x.date }; });
  check('6 עריכה אחרי קליטה: סכום, מספר חשבונית ותאריך נשמרו', e.amt && e.inv && t.amt === 120 && t.inv === 'NEW-9' && t.date === info.prev + '-07', { e, t });
  const errs = (p.__errors || []).filter((x) => !/favicon/.test(x));
  check('7 בלי שגיאות JS', errs.length === 0, errs);
  await browser.close(); console.log(fail ? 'תוצאה: נכשל' : 'תוצאה: הכול עבר'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
