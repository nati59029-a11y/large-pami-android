'use strict';
// עיצוב מחדש D4 (כסף): בחירה מרובה, סה"כ בפס, סגירה יחד לספק אחד. רשת מדומה (לא צריך אמולטור).
// שימוש: node ui-ds-multi.js <www-dir> [out.json] [shots-dir]
// MUTATE=bal – באג מכוון: היתרה בפס/בסגירה מחושבת מ-t.amt במקום bal → בדיקות 1/1א נכשלות.
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const out = {}; let fail = 0;
const check = (name, ok, info) => { out[name] = { ok: !!ok, info }; if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 500) : '')); };
const BZ0 = ['larg', 'peami'].join('');
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));

// ספק sA: 100, 250, 80 (שולם 30). ספק sB: 300 + זיכוי 120. ספק sC: 50 + זיכוי 400. ספק sD: 200 + החזר 40 + זיכוי 60
const seed = (p) => p.evaluate(() => {
  S.tx = []; BRSEL = []; MS = { ref: null, on: false, ids: [], open: [], led: '' };
  S.subs = S.subs.filter((s) => !['sA', 'sB', 'sC', 'sD'].includes(s.id));
  S.subs.push({ id: 'sA', cat: 'e_sup', name: 'מאפיית השחר' }, { id: 'sB', cat: 'e_sup', name: 'ספק ב' }, { id: 'sC', cat: 'e_sup', name: 'ספק ג' }, { id: 'sD', cat: 'e_sup', name: 'ספק ד' });
  const mk = (id, sub, date, amt, ex) => S.tx.push(Object.assign({ id, t: 'exp', cat: 'e_sup', sub, date, amt, note: '', kind: 'inv', plan: '2026-11', inv: id.toUpperCase(), pays: [] }, ex || {}));
  mk('a1', 'sA', '2026-10-01', 100); mk('a2', 'sA', '2026-10-02', 250); mk('a3', 'sA', '2026-10-03', 80, { pays: [{ id: 'p0', d: '2026-10-20', a: 30, m: 'מזומן' }] });
  mk('b1', 'sB', '2026-10-04', 300); mk('bc', 'sB', '2026-10-05', -120, { kind: 'credit', pays: undefined });
  mk('c1', 'sC', '2026-10-06', 50); mk('cc', 'sC', '2026-10-07', -400, { kind: 'credit', pays: undefined });
  mk('d1', 'sD', '2026-11-01', 200); mk('dr', 'sD', '2026-11-02', 0, { kind: 'refund', rf: 40, pays: undefined }); mk('dc', 'sD', '2026-11-02', -60, { kind: 'credit', pays: undefined });
  S.tx.forEach((t) => { if (t.pays === undefined) delete t.pays; });
  save();
});
const strip = (o) => JSON.parse(JSON.stringify(o));

(async () => {
  const [www, outFile, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  let src = www;
  if (process.env.MUTATE === 'bal') {
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'dsm-')); fs.cpSync(www, tmp, { recursive: true });
    const f = path.join(tmp, 'index.html'); const s = fs.readFileSync(f, 'utf8'); const t = s.replace('const y=rnd(sum(L,bal))', 'const y=rnd(sum(L,t=>t.amt))').replace('L.map(t=>t.id+\':\'+bal(t))', 'L.map(t=>t.id+\':\'+t.amt)');
    if (s === t) throw new Error('mutation target not found'); fs.writeFileSync(f, t); src = tmp;
  }
  const browser = await H.launch();
  const cfg = { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: ALL } }, admins: { '|m': 1 }, staff: { '|w': 1 }, ctx: { hasTouch: true, isMobile: true } };
  const { page } = await H.newPage(browser, src, cfg, [], 'm');
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  const toasts = []; await page.exposeFunction('__toast', (t) => toasts.push(t));
  await page.setViewportSize({ width: 390, height: 844 });
  await H.login(page, 'm@x.co');
  await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden) ACT.startBlank(); const o = toast; window.toast = toast = (t) => { window.__toast(t); o(t); }; });
  await H.settle(page, 300);
  const shot = async (name) => { if (shots) await page.screenshot({ path: path.join(shots, name + '.png') }); };
  const setDs = (t) => page.evaluate((t) => { SY.biz = Object.assign({}, SY.biz, { brand: { name: 'לארג׳ פעמי', colors: {}, theme: t, base: 'dark-gold' } }); BZK = '~'; bzSkin(); }, t);
  const goV = (v, a) => page.evaluate(([v, a]) => { closeDlg(); NAV = [{ v: 'home' }]; go(v, a); }, [v, a]);
  const tap = (sel) => page.click(sel);
  const pick = async (ids) => { for (const i of ids) await tap(`[data-a=msPick][data-id="${i}"]`); };
  const bar = () => page.evaluate(() => { const b = document.getElementById('msBar'); const C = (x) => String(x).replace(/[‎‏\s₪]/g, '').replace(/\.00(?!\d)/g, ''); return b ? { txt: C(document.getElementById('msTxt').textContent), split: C((document.getElementById('msSplit') || {}).textContent || ''), pay: (() => { const x = b.querySelector('[data-a=msPay]'); return x ? (x.disabled ? 'disabled' : 'on') : 'none'; })(), why: (document.getElementById('msWhy') || {}).textContent || '', ex: (document.getElementById('msEx') || {}).textContent || '', live: b.getAttribute('aria-live') } : null; });
  const num = (s) => Number(String(s).replace(/[^\d.\-‎]/g, '').replace('‎', ''));
  const sx = () => page.evaluate(() => JSON.stringify(S.tx));
  const payM = async (m) => { await page.evaluate((m) => { const r = [...document.querySelectorAll('#dlg input[name=m]')].find((x) => x.value === m); r.checked = true; }, m || 'העברה'); };
  const submit = () => page.evaluate(() => { const f = document.querySelector('#dlg form[data-f=mspay]'); f.requestSubmit(); });

  await seed(page);

  // ===== 0. כפתור "בחירה", תיבת סימון SVG role=checkbox, לחיצה ארוכה =====
  await goV('ledger', 'sA'); await H.settle(page, 200);
  const r0 = await page.evaluate(() => ({ btn: (document.querySelector('[data-a=msMode]') || {}).textContent }));
  await tap('[data-a=msMode]'); await H.settle(page, 100);
  const r0b = await page.evaluate(() => { const b = document.querySelector('[data-a=msPick]'); return { role: b && b.getAttribute('role'), svg: !!(b && b.querySelector('.mscb svg')), aria: b && b.getAttribute('aria-checked'), h: b && Math.round(b.getBoundingClientRect().height) }; });
  check('0 כפתור "בחירה"; שורה role=checkbox עם תיבת SVG, aria-checked, גובה ≥44', r0.btn === 'בחירה' && r0b.role === 'checkbox' && r0b.svg && r0b.aria === 'false' && r0b.h >= 44, [r0, r0b]);
  await tap('[data-a=msMode]'); await H.settle(page, 100);
  // לחיצה ארוכה 500ms
  const box = await page.locator('[data-a=payDlg][data-id=a2]').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.waitForTimeout(650); await page.mouse.up(); await H.settle(page, 150);
  const r0c = await page.evaluate(() => ({ on: MS.on, ids: MS.ids.slice(), dlg: document.getElementById('dlg').open }));
  check('0א לחיצה ארוכה 500ms: מצב בחירה עם המסמך מסומן, בלי לפתוח את הדיאלוג', r0c.on && r0c.ids.join() === 'a2' && !r0c.dlg, r0c);
  await page.evaluate(() => { MS.on = false; MS.ids = []; rerender(); });
  // לחיצה קצרה עדיין פותחת סגירת תשלום
  await tap('[data-a=payDlg][data-id=a2]'); await H.settle(page, 100);
  const r0d = await page.evaluate(() => ({ dlg: document.getElementById('dlg').open && !!document.querySelector('#dlg form[data-f=paysave]'), on: MS.on }));
  check('0ב לחיצה קצרה – כמו היום (סגירת תשלום לחשבונית)', r0d.dlg && !r0d.on, r0d); await page.evaluate(() => closeDlg());

  // ===== 1. 100/250/80(שולם 30) → 100/250/50, כולן סגורות, grp זהה =====
  await goV('ledger', 'sA'); await H.settle(page, 150); await tap('[data-a=msMode]'); await pick(['a1', 'a2', 'a3']);
  const b1 = await bar();
  check('1 פס: "נבחרו 3 · סה״כ ₪430 · יתרה לתשלום ₪400", aria-live, סגירה יחד פעיל', b1 && b1.live === 'polite' && /נבחרו3·סה״כ430·יתרהלתשלום400$/.test(b1.txt) && b1.pay === 'on', b1);
  await tap('[data-a=msPay]'); await H.settle(page, 150);
  const d1 = await page.evaluate(() => ({ def: (document.getElementById('msDef') || {}).textContent, det: !!document.querySelector('#dlg details#msAmtD'), open: document.querySelector('#dlg details#msAmtD') && document.querySelector('#dlg details#msAmtD').open, chk: [...document.querySelectorAll('#dlg input[name=m]')].map((x) => x.value), file: !!document.querySelector('#dlg input[type=file][name=f]'), ref: !!document.querySelector('#dlg [name=ref]'), d: !!document.querySelector('#dlg [name=d]') }));
  check('1א חלון אחד: תאריך, אמצעי (כולל צ׳ק), אסמכתא, קובץ; ברירת מחדל יתרת כל חשבונית; "שינוי סכום" סגור', d1.det && !d1.open && d1.chk.includes('צ׳ק') && d1.file && d1.ref && d1.d && /100/.test(d1.def) && /250/.test(d1.def) && /50/.test(d1.def), d1);
  if (shots) for (const t of ['a', 'b', 'c']) { await setDs(t); await H.settle(page, 80); await shot(`דיאלוג-ספק-אחד-${t}-390`); }
  await setDs('a');
  await payM('העברה'); await page.fill('#dlg [name=ref]', 'R-77');
  // לחיצה כפולה – נרשם פעם אחת
  await page.evaluate(() => { const f = document.querySelector('#dlg form[data-f=mspay]'); FRM.mspay(f); FRM.mspay(f); }); await H.settle(page, 300);
  const r1 = await page.evaluate(() => { const L = ['a1', 'a2', 'a3'].map((i) => S.tx.find((t) => t.id === i)); const np = L.map((t) => t.pays.filter((p) => p.grp)); return { a: np.map((x) => x.map((p) => p.a)), grp: [...new Set(np.flat().map((p) => p.grp))], bal: L.map(bal), ref: np.flat().every((p) => p.ref === 'R-77' && p.m === 'העברה'), old: L[2].pays[0].id === 'p0' && L[2].pays[0].a === 30 }; });
  check('1ב תוצאה: 100/250/50, כולן סגורות, grp זהה, אסמכתא ואמצעי בכל תשלום, תשלום קודם נשמר', JSON.stringify(r1.a) === '[[100],[250],[50]]' && r1.grp.length === 1 && r1.bal.every((b) => b === 0) && r1.ref && r1.old, r1);
  check('1ג לחיצה כפולה – תשלום אחד לכל חשבונית', r1.a.every((x) => x.length === 1), r1.a);

  // ===== 5. ביטול → JSON של S.tx זהה; מחיקת תשלום בודד מקבוצה חסומה =====
  await seed(page); const before5 = await sx();
  await goV('ledger', 'sA'); await H.settle(page, 150); await tap('[data-a=msMode]'); await pick(['a1', 'a2', 'a3']); await tap('[data-a=msPay]'); await H.settle(page, 100); await payM('מזומן'); await submit(); await H.settle(page, 200);
  await page.evaluate(() => txDlg('a2')); await H.settle(page, 100);
  const pid = await page.evaluate(() => S.tx.find((t) => t.id === 'a2').pays[0].id);
  toasts.length = 0; await tap(`#dlg [data-a=delPay][data-p="${pid}"]`); await H.settle(page, 100);
  const r5a = await page.evaluate(() => S.tx.find((t) => t.id === 'a2').pays.length);
  check('5 מחיקת תשלום בודד מסגירה משותפת – חסומה, עם הפניה ל"ביטול הסגירה כולה"', r5a === 1 && toasts.some((t) => /ביטול הסגירה כולה/.test(t)), [r5a, toasts]);
  await page.evaluate(() => txDlg('a2')); await H.settle(page, 100); await tap('#dlg [data-a=grpDel]'); await H.settle(page, 100);
  const askTxt = await page.evaluate(() => document.querySelector('#dlg h3').textContent); await tap('#dlg [data-a=yes]'); await H.settle(page, 150);
  const after5 = await sx();
  const norm = (j) => JSON.stringify(JSON.parse(j).map((t) => { const x = Object.assign({}, t); delete x.ts; return x; }));
  check('5א ביטול הסגירה כולה (ask): JSON של S.tx זהה לפני הסגירה', /לבטל את כל הסגירה/.test(askTxt) && norm(before5) === norm(after5), { askTxt, same: norm(before5) === norm(after5) });
  // תשלום בודד (לא בקבוצה) – נמחק אחרי ask()
  await page.evaluate(() => txDlg('a3')); await H.settle(page, 100); await tap('#dlg [data-a=delPay][data-p=p0]'); await H.settle(page, 100);
  const r5c = await page.evaluate(() => ({ h: document.querySelector('#dlg h3').textContent, n: S.tx.find((t) => t.id === 'a3').pays.length }));
  await tap('#dlg [data-a=yes]'); await H.settle(page, 100);
  const r5d = await page.evaluate(() => S.tx.find((t) => t.id === 'a3').pays.length);
  check('5ב מחיקת תשלום בודד: שואלת קודם (ask), ונמחק רק אחרי אישור', /למחוק את התשלום/.test(r5c.h) && r5c.n === 1 && r5d === 0, [r5c, r5d]);

  // ===== 2. חשבונית + זיכוי 120 – זהה לקוד הישן (קיזוז 120 + 180 בתשלום) =====
  await seed(page); await goV('ledger', 'sB'); await H.settle(page, 150); await tap('[data-a=msMode]'); await pick(['b1', 'bc']);
  const b2 = await bar();
  await tap('[data-a=msPay]'); await H.settle(page, 100); await payM('העברה'); await submit(); await H.settle(page, 200);
  const r2 = await page.evaluate(() => { const t = S.tx.find((x) => x.id === 'b1'), c = S.tx.find((x) => x.id === 'bc'); return { p: t.pays.map((p) => [p.a, p.m, !!p.crof]), g: new Set(t.pays.map((p) => p.grp)).size, used: c.used && c.used.grp === t.pays[0].grp, bal: bal(t) }; });
  check('2 חשבונית 300 + זיכוי 120: פס ‎-120, קיזוז 120 + 180 העברה, זיכוי מסומן used, grp אחד', /180/.test(b2.txt) && JSON.stringify(r2.p) === JSON.stringify([[120, 'קיזוז זיכוי', true], [180, 'העברה', false]]) && r2.g === 1 && r2.used && r2.bal === 0, [b2, r2]);

  // ===== 3. כמה ספקים – סה"כ בלבד, סגירה יחד לא פעיל עם הסבר =====
  await seed(page); await goV('due'); await H.settle(page, 150); await tap('[data-a=msMode]'); await pick(['a1', 'b1']);
  const b3 = await bar();
  check('3 כמה ספקים: סה"כ ₪400, "סגירה יחד" לא פעיל, עם הסבר', /400/.test(b3.txt) && b3.pay === 'disabled' && /כמה ספקים/.test(b3.why), b3);
  if (shots) for (const t of ['a', 'b', 'c']) { await setDs(t); await H.settle(page, 80); await shot(`כמה-ספקים-${t}-390`); }
  await setDs('a');
  // ניסיון עקיף: FRM מזויף עם שני ספקים – נדחה
  const s3 = await sx();
  await page.evaluate(() => { dlg('<form data-f="mspay"><input name="ids" value="a1,b1"><input name="a" value="400"><input name="d" value="2026-11-03"><input name="m" value="העברה"></form>'); FRM.mspay(document.querySelector('#dlg form')); closeDlg(); });
  check('3א FRM מזויף עם שני ספקים – נדחה, S.tx לא השתנה', (await sx()) === s3);

  // ===== 4. זיכוי > יתרה – חסום =====
  await seed(page); await goV('ledger', 'sC'); await H.settle(page, 150); await tap('[data-a=msMode]'); await pick(['c1', 'cc']);
  const b4 = await bar();
  const s4 = await sx();
  await page.evaluate(() => { dlg('<form data-f="mspay"><input name="ids" value="c1"><input name="crs" value="cc"><input name="a" value="0"><input name="d" value="2026-11-03"></form>'); FRM.mspay(document.querySelector('#dlg form')); closeDlg(); });
  check('4 זיכוי 400 > יתרה 50: כפתור לא פעיל, הסבר, ו-FRM נדחה', b4.pay === 'disabled' && /גדולים ממה שנשאר/.test(b4.why) && (await sx()) === s4, b4);

  // ===== 8. סה"כ בפס = חישוב ידני, כולל שלילי (זיכוי, החזר) – בכרטיס הספק =====
  await seed(page); await goV('card', 'sD'); await H.settle(page, 150); await page.evaluate(() => { P.from = '2026-01-01'; P.to = '2026-12-31'; P.k = 'custom'; rerender(); }).catch(() => {});
  await tap('[data-a=msMode]'); const ids8 = await page.evaluate(() => [...document.querySelectorAll('[data-a=msPick]')].map((b) => b.dataset.id)); await pick(ids8);
  const b8 = await bar(); const man8 = await page.evaluate((ids) => rnd(sum(ids.map((i) => S.tx.find((t) => t.id === i)), (t) => (t.kind === 'refund' ? -t.rf : t.kind === 'credit' ? -Math.abs(t.amt) : t.amt))), ids8);
  const tot8 = await page.evaluate(() => document.querySelector('#msTxt b').textContent.replace(/[‎‏\s₪]/g, ''));
  check('8 סה"כ בפס = ידני (200 − 40 − 60 = 100); בכרטיס ספק הזיכוי מקוזז → יתרה לתשלום 140; ההחזר "לא ייכללו (1)"; סגירה יחד פעיל', ids8.length === 3 && man8 === 100 && tot8 === '100.00' && /יתרהלתשלום140$/.test(b8.txt) && /לא ייכללו \(1\)/.test(b8.ex) && b8.pay === 'on', { ids8, man8, tot8, b8 });
  await page.evaluate(() => { MS.ids = ['dr', 'dc']; msPaint(); }); const b8b = await bar(); const tot8b = await page.evaluate(() => document.querySelector('#msTxt b').textContent.replace(/[‎‏\s₪]/g, ''));
  check('8א רק זיכוי + החזר: סה"כ שלילי ‎-₪100, בלי "יתרה לתשלום", הכפתור לא פעיל', tot8b === '-100.00' && !/יתרה/.test(b8b.txt) && b8b.pay === 'disabled', { tot8b, b8b });
  if (shots) { await page.evaluate(() => { MS.ids = ['d1', 'dr', 'dc']; msPaint(); }); for (const t of ['a', 'b', 'c']) { await setDs(t); await H.settle(page, 80); await shot(`הוצאות-בבחירה-${t}-390`); } await setDs('a'); }

  // ===== 8ב. הכנסות והוצאות יחד – שתי שורות נפרדות (קטגוריה חופשית) =====
  await seed(page);
  const fr = await page.evaluate(() => { const s = S.subs.find((x) => x.cat === 'i_yh'); if (!s) return null; S.tx.push({ id: 'i1', t: 'inc', cat: 'i_yh', sub: s.id, date: '2026-11-02', amt: 500, note: '' }, { id: 'i2', t: 'inc', cat: 'i_yh', sub: s.id, date: '2026-11-02', amt: 70, note: '' }); save(); return s.id; });
  if (fr) {
    await goV('card', fr); await H.settle(page, 150); await tap('[data-a=msMode]'); await pick(['i1', 'i2']);
    const b8c = await bar(); await page.evaluate(() => { MS.ids.push('a1'); msPaint(); }); const b8d = await bar();
    check('8ב כרטיס הכנסות (קופה): בחירה וסכום 570; עם הוצאה – שורות "הכנסות" ו"הוצאות" נפרדות', /סה״כ570$/.test(b8c.txt) && /הכנסות570·הוצאות100/.test(b8d.split) && /סה״כ670/.test(b8d.txt), [b8c, b8d]);
  } else check('8ב כרטיס קופה קיים', false);

  // ===== 7. חשבונית שהשתנתה מאז פתיחת החלון – עוצרים =====
  await seed(page); await goV('ledger', 'sA'); await H.settle(page, 150); await tap('[data-a=msMode]'); await pick(['a1', 'a2']); await tap('[data-a=msPay]'); await H.settle(page, 100); await payM('העברה');
  await page.evaluate(() => { S.tx.find((t) => t.id === 'a2').pays.push({ id: 'px', d: '2026-11-01', a: 10, m: 'מזומן' }); }); const s7 = await sx(); toasts.length = 0;
  await submit(); await H.settle(page, 150);
  check('7 חשבונית השתנתה אחרי פתיחת החלון: "אחת החשבוניות השתנתה – פתחו מחדש", בלי רישום', (await sx()) === s7 && toasts.some((t) => /השתנתה – פתחו מחדש/.test(t)), toasts);
  await page.evaluate(() => closeDlg());

  // ===== 7א. סכום חלקי – רק דרך "שינוי סכום", מהישנה לחדשה =====
  await seed(page); await goV('ledger', 'sA'); await H.settle(page, 150); await tap('[data-a=msMode]'); await pick(['a1', 'a2']); await tap('[data-a=msPay]'); await H.settle(page, 100); await payM('העברה');
  await tap('#dlg #msAmtD summary'); await page.fill('#dlg [name=a]', '150'); await submit(); await H.settle(page, 200);
  const r7a = await page.evaluate(() => ['a1', 'a2'].map((i) => bal(S.tx.find((t) => t.id === i))));
  check('7א "שינוי סכום" 150: הישנה נסגרת (0), החדשה חלקית (200)', JSON.stringify(r7a) === '[0,200]', r7a);

  // ===== 6. עובד בלי הרשאה – אין כפתור, FRM מזויף נדחה; expR own – רק מה שרואה =====
  await seed(page);
  const r6 = await page.evaluate(() => {
    const keep = { role: SY.role, refresh: SY.refresh, perms: SY.perms, biz: SY.biz, uid: SY.uid };
    SY.role = 'worker'; SY.refresh = SY.refresh || 'r'; SY.biz = Object.assign({}, SY.biz, { dataRoot: 'b' }); SY.uid = 'w';
    SY.perms = { expW: true, sup: false, expR: true }; NAV = [{ v: 'home' }]; go('ledger', 'sA'); MS.on = true; MS.ids = ['a1', 'a2']; rerender();
    const noBtn = !document.querySelector('[data-a=msPay]'), hasBar = !!document.getElementById('msBar');
    const s0 = JSON.stringify(S.tx); dlg('<form data-f="mspay"><input name="ids" value="a1,a2"><input name="a" value="350"><input name="d" value="2026-11-03"><input name="m" value="העברה"></form>'); FRM.mspay(document.querySelector('#dlg form')); closeDlg();
    const forged = JSON.stringify(S.tx) === s0; ACT.msPay(); const dlgOpen = document.getElementById('dlg').open; closeDlg();
    // expR own: רק מה שהעובד הזין
    SY.perms = { expW: true, sup: true, expR: 'own' }; S.tx.find((t) => t.id === 'a1').eu = 'w'; MS.ids = ['a1', 'a2']; rerender();
    const txt = document.getElementById('msTxt').textContent;
    const s1 = JSON.stringify(S.tx); dlg('<form data-f="mspay"><input name="ids" value="a1,a2"><input name="a" value="350"><input name="d" value="2026-11-03"><input name="m" value="העברה"></form>'); FRM.mspay(document.querySelector('#dlg form')); closeDlg();
    const own = JSON.stringify(S.tx) === s1;
    Object.assign(SY, keep); MS.on = false; MS.ids = []; delete S.tx.find((t) => t.id === 'a1').eu;
    return { noBtn, hasBar, forged, dlgOpen, txt, own };
  });
  check('6 עובד בלי "ספקים": פס עם סה"כ בלי "סגירה יחד"; FRM מזויף ו-ACT.msPay נדחים', r6.noBtn && r6.hasBar && r6.forged && !r6.dlgOpen, r6);
  check('6א עובד expR=own: נספר רק מה שהזין (1 מתוך 2), ו-FRM עם חשבונית שאינה שלו נדחה', /נבחרו 1/.test(r6.txt) && r6.own, r6);

  // ===== 9. מראה: ניגודיות הפס ומגע ב-3 ערכות; אחרי ביטול =====
  await seed(page); await goV('ledger', 'sA'); await H.settle(page, 150); await tap('[data-a=msMode]'); await pick(['a1', 'a2']);
  const BR = `(() => { const P = (s) => { const m = /rgba?\\(([^)]+)\\)/.exec(s); const a = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [a[0], a[1], a[2], a.length > 3 ? a[3] : 1]; };
    const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; const L = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
    const bgOf = (el) => { const ls = []; for (let e = el; e; e = e.parentElement) { const c = P(getComputedStyle(e).backgroundColor); if (c[3] > 0) ls.push(c); if (c[3] >= 1) break; } const d = document.createElement('i'); d.style.color = getComputedStyle(document.documentElement).getPropertyValue('--bg'); document.body.appendChild(d); let acc = P(getComputedStyle(d).color).slice(0, 3); d.remove(); for (let i = ls.length - 1; i >= 0; i--) { const c = ls[i]; acc = [0, 1, 2].map((k) => c[k] * c[3] + acc[k] * (1 - c[3])); } return acc; };
    window.__cr = (el) => { if (!el) return 99; const f = P(getComputedStyle(el).color), b = bgOf(el); const fg = [0, 1, 2].map((k) => f[k] * f[3] + b[k] * (1 - f[3])); const x = L(fg), y = L(b); return Math.round((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) * 100) / 100; }; })()`;
  await page.evaluate(BR);
  const r9 = {};
  for (const t of ['a', 'b', 'c']) { await setDs(t); await H.settle(page, 80); r9[t] = await page.evaluate(() => ({ cr: Math.min(__cr(document.getElementById('msTxt')), __cr(document.querySelector('[data-a=msPay]'))), acc: getComputedStyle(document.documentElement).getPropertyValue('--acc').trim(), sw: document.documentElement.scrollWidth <= innerWidth, small: [...document.querySelectorAll('#msBar button,[data-a=msPick],[data-a=msMode],[data-a=msAll]')].filter((e) => e.getBoundingClientRect().height < 44).map((e) => e.dataset.a) })); await shot(`פס-${t}-390`); }
  check('9 ניגודיות ≥4.5 בפס, מגע ≥44, בלי גלילה אופקית – 3 ערכות; כתום ערכה ג #ab3815', ['a', 'b', 'c'].every((t) => r9[t].cr >= 4.5 && r9[t].sw && !r9[t].small.length) && r9.c.acc === '#ab3815', r9);
  await page.setViewportSize({ width: 320, height: 640 }); await H.settle(page, 80); const hs320 = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth); await page.setViewportSize({ width: 390, height: 844 });
  check('9א בלי גלילה אופקית ב-320 במצב בחירה', hs320);
  if (shots) { await page.evaluate(() => { MS.on = false; MS.ids = []; rerender(); }); for (const t of ['a', 'b', 'c']) { await setDs(t); await H.settle(page, 80); await shot(`אחרי-ביטול-${t}-390`); } }

  check('10 אין שגיאות JS', errs.length === 0, errs);
  await browser.close();
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
  console.log(fail ? `נכשלו ${fail}` : 'כל הבדיקות עברו'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
