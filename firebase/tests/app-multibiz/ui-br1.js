'use strict';
// סניפים, בנקים וכרטיסים – חלק א', ממשק (A2): מסך ראשי (כרטיסים לחיצים, רווחיות, צ'יפים וטבלה), סינון לפי סניף, שדה סניף באשף/עריכה/עובד, שדה בנק/כרטיס בתשלום.
// רשת מדומה (harness). שימוש: NODE_PATH=... node ui-br1.js <www-dir>
const H = require('./harness');
const BZ0 = ['larg', 'peami'].join('');
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
let fail = 0; const check = (n, ok, info) => { if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const ORG2 = { v: 1, branches: [{ id: 'bra', name: 'נחל לכיש', on: true, sig: [{ k: 'sup', v: 'sbra' }] }, { id: 'brb', name: 'יהודה הנשיא', on: true, sig: [] }],
  banks: [{ id: 'bka', name: 'לאומי', last4: '1234', on: true, sig: [] }, { id: 'bkb', name: 'פועלים', last4: '9999', on: true, sig: [] }], cards: [{ id: 'cca', name: 'ויזה עסקי', last4: '5678', on: true }] };
const ORG1 = { v: 1, branches: [{ id: 'bra', name: 'נחל לכיש', on: true, sig: [] }], banks: [], cards: [] };
const home = (p) => p.evaluate(() => { NAV = [{ v: 'home' }]; render(0); return document.getElementById('main').innerText; });
const seed = (p, org) => p.evaluate((o) => {
  S.tx = []; S.orgC = o; delete SY.br; BRSEL = [];
  const inc = S.subs.find((s) => s.cat === 'i_yh').id; const supC = 'e_sup';
  S.subs.push({ id: 'sbra', cat: supC, name: 'ספק לכיש' }, { id: 'sother', cat: supC, name: 'ספק כללי' });
  const mk = (id, t, cat, sub, amt, br, extra) => { const x = Object.assign({ id, t, cat, sub, date: '2026-11-02', amt, note: '', pays: [] }, extra || {}); if (br) x.br = br; S.tx.push(x); };
  mk('i1', 'inc', 'i_yh', inc, 1000, 'bra'); mk('i2', 'inc', 'i_yh', inc, 500, ''); mk('i3', 'inc', 'i_yh', inc, 300, 'brb');
  mk('e1', 'exp', 'e_misc', null, 200, 'bra', { desc: 'שונות א' }); mk('e2', 'exp', 'e_misc', null, 700, 'brb', { desc: 'שונות ב' });
  mk('v1', 'exp', supC, 'sbra', 400, 'bra', { kind: 'inv', plan: '2026-11', inv: 'A1' }); mk('v2', 'exp', supC, 'sother', 250, 'brb', { kind: 'inv', plan: '2026-11', inv: 'B1' });
  save();
}, org);
(async () => {
  const [www] = process.argv.slice(2); const browser = await H.launch();
  const cfg = { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: ALL } }, admins: { '|m': 1 }, staff: { '|w': 1 } };
  const m = await H.newPage(browser, www, cfg, [], 'm'); const mp = m.page; await mp.setViewportSize({ width: 360, height: 740 }); await H.login(mp, 'm@x.co');
  // ---- 1. סניף יחיד: אין שינוי נראה ----
  await seed(mp, ORG1); let tx = await home(mp);
  const s1 = await mp.evaluate(() => ({ chips: document.querySelectorAll('[data-a=brSel]').length, tbl: !!document.getElementById('brTbl'), brf: (openAdd({ type: 'exp', cat: 'e_misc', pre: false }), document.querySelectorAll('#sheet [data-brf],#sheet [name=br]').length), bank: 0 }));
  check('1 סניף יחיד: אין צ׳יפים, אין טבלה, אין שדה סניף בטופס', s1.chips === 0 && !s1.tbl && s1.brf === 0, s1);
  await mp.evaluate(() => sheetClose());
  const s1b = await mp.evaluate(() => { const f = { amt: '10', date: '2026-11-02', desc: 'x', note: '' }; const r = readTx(f, cat('e_misc'), null, null); return { br: r.t && r.t.br, err: r.errs }; });
  check('1א סניף יחיד: תנועה חדשה נשמרת בלי שדה br', s1b.br === undefined && !s1b.err, s1b);
  await mp.evaluate(() => { delete S.orgC; save(); }); tx = await home(mp);
  check('1ב בלי org בכלל: אין צ׳יפים/טבלה', await mp.evaluate(() => !document.querySelector('[data-a=brSel]') && !document.getElementById('brTbl')));
  // ---- 2. שני סניפים: צ׳יפים, טבלה, סכומים ----
  await seed(mp, ORG2); tx = await home(mp);
  const t2 = await mp.evaluate(() => ({ chips: [...document.querySelectorAll('[data-a=brSel]')].map((b) => b.textContent), rows: [...document.querySelectorAll('#brTbl tbody tr')].map((r) => [...r.cells].map((c) => c.textContent.replace(/\s|₪|,/g, ''))), foot: [...document.querySelectorAll('#brTbl tfoot th')].map((c) => c.textContent.replace(/\s|₪|,/g, '')) }));
  check('2 שני סניפים: צ׳יפים "הכול" + שני הסניפים', t2.chips.join('|') === 'הכול|נחל לכיש|יהודה הנשיא', t2.chips);
  const n = (s) => String(parseFloat(String(s).replace(/[^\d.-]/g, '')));
  check('2א טבלה: לכיש הכנסה 1500 הוצאה 600 הפרש 900 (ללא br = סניף ראשון); הנשיא 300/950/-650; סה״כ 1800/1550/250',
    t2.rows.length === 2 && n(t2.rows[0][1]) === '1500' && n(t2.rows[0][2]) === '600' && n(t2.rows[0][3]) === '900' && n(t2.rows[1][1]) === '300' && n(t2.rows[1][2]) === '950' && n(t2.rows[1][3]) === '-650' && n(t2.foot[1]) === '1800' && n(t2.foot[2]) === '1550' && n(t2.foot[3]) === '250', t2);
  check('2ב רווח החודש מוצג עם אחוז רווחיות (250 מתוך 1800 = 14%)', /רווח החודש/.test(tx) && /רווחיות/.test(tx) && /14%/.test(tx), tx.slice(0, 400));
  // ---- 3. כרטיסי הכנסות/הוצאות לחיצים ----
  await mp.click('[data-a=tab][data-v=inc]'); await H.settle(mp, 300);
  check('3 לחיצה על הכנסות פותחת את מסך ההכנסות', await mp.evaluate(() => cur().v === 'inc' && /סך ההכנסות/.test(document.getElementById('main').innerText)));
  await home(mp); await mp.click('[data-a=tab][data-v=exp]'); await H.settle(mp, 300);
  check('3א לחיצה על הוצאות פותחת את מסך ההוצאות', await mp.evaluate(() => cur().v === 'exp' && /סך ההוצאות/.test(document.getElementById('main').innerText)));
  // ---- 4. סינון לפי סניף (בחירה אחת / כמה / הכול) ----
  await home(mp); await mp.click('[data-a=brSel][data-id=brb]'); await H.settle(mp, 200);
  const t4 = await mp.evaluate(() => ({ rows: document.querySelectorAll('#brTbl tbody tr').length, txt: document.getElementById('main').innerText.replace(/[\s₪,\u200e\u200f]/g, '') }));
  check('4 בחירת סניף אחד: בטבלה שורה אחת, והכנסות = 300 (בכרטיס הראשי)', t4.rows === 1 && /הכנסות300/.test(t4.txt), t4.txt.slice(0, 200));
  await mp.click('[data-a=brSel][data-id=bra]'); await H.settle(mp, 200);
  const t4b = await mp.evaluate(() => ({ sel: BRSEL.slice(), on: document.querySelectorAll('[data-a=brSel].on').length }));
  check('4א בחירת שני הסניפים = הכול (BRSEL ריק, "הכול" מסומן)', t4b.sel.length === 0 && t4b.on === 1, t4b);
  await mp.click('[data-a=brSel][data-id=brb]'); await mp.evaluate(() => go('exp')); await H.settle(mp, 300);
  const t4c = await mp.evaluate(() => ({ chips: document.querySelectorAll('#main [data-a=brSel]').length, txt: document.getElementById('main').innerText.replace(/[\s₪,\u200e\u200f]/g, '') }));
  check('4ב מסך הוצאות: צ׳יפים בסרגל התקופה, ובבחירת "יהודה הנשיא" הסך = 950', t4c.chips === 3 && /סךההוצאות/.test(t4c.txt) && /סךההוצאות·נובמבר2026950/.test(t4c.txt), t4c.txt.slice(0, 160));
  await mp.evaluate(() => go('cat', 'e_misc')); await H.settle(mp, 300);
  check('4ג מסך קטגוריה: מסונן לסניף (700)', await mp.evaluate(() => /700/.test(document.querySelector('.hero').innerText) && !/900/.test(document.querySelector('.hero').innerText)));
  await mp.evaluate(() => go('due')); await H.settle(mp, 300);
  const t4d = await mp.evaluate(() => ({ chips: document.querySelectorAll('#main [data-a=brSel]').length, txt: document.getElementById('main').innerText }));
  check('4ד חשבוניות לתשלום: צ׳יפים ומסונן (רק ספק כללי 250, בלי ספק לכיש)', t4d.chips === 3 && /ספק כללי/.test(t4d.txt) && !/ספק לכיש/.test(t4d.txt), t4d.txt.slice(0, 200));
  await mp.evaluate(() => { BRSEL = []; });
  // ---- 5. אשף הוספה: ספק משויך = בחירה אוטומטית עם "שנה" ----
  const t5 = await mp.evaluate(() => { openAdd({ type: 'exp', cat: 'e_sup', sub: 'sbra', pre: true }); const f = document.querySelector('#sheet form'); const s = f.querySelector('[name=br]'); return { val: s.value, hidden: s.hidden, req: s.required, chg: !!f.querySelector('[data-a=brChg]'), name: f.querySelector('[data-brn]').textContent }; });
  check('5 ספק משויך לסניף: נבחר מראש (נחל לכיש), עם "שנה", בלי חובה', t5.val === 'bra' && t5.hidden && !t5.req && t5.chg && t5.name === 'נחל לכיש', t5);
  // sheetDraw ממקד את שדה הסכום אחרי 60ms (setTimeout) – מחכים לו לפני מילוי, אחרת המיקוד המאוחר "גונב" הקלדה לשדה אחר
  await mp.waitForFunction(() => document.activeElement && document.activeElement.name === 'amt' && document.activeElement.closest('#sheet'), null, { timeout: 3000 }).catch(() => {}); await mp.click('#sheet [data-a=brChg]'); await mp.selectOption('#sheet select[name=br]', 'brb');
  await mp.fill('#sheet input[name=amt]', '120'); await mp.fill('#sheet input[name=inv]', 'Z9'); await mp.click('#sheet button[name=go][value=done]'); await H.settle(mp, 400);
  check('5א "שנה" → בחירת סניף אחר נשמרת על התנועה', await mp.evaluate(() => { const t = S.tx.find((x) => x.inv === 'Z9'); return !!t && t.br === 'brb'; }));
  // ---- 6. אין התאמה: שדה חובה ----
  const t6 = await mp.evaluate(() => { openAdd({ type: 'exp', cat: 'e_sup', sub: 'sother', pre: true }); const s = document.querySelector('#sheet [name=br]'); return { val: s.value, hidden: s.hidden, req: s.required, chg: !!document.querySelector('#sheet [data-a=brChg]') }; });
  check('6 אין התאמה: שדה סניף גלוי וחובה, בלי ברירת מחדל', t6.val === '' && !t6.hidden && t6.req && !t6.chg, t6);
  await mp.waitForFunction(() => document.activeElement && document.activeElement.name === 'amt' && document.activeElement.closest('#sheet'), null, { timeout: 3000 }).catch(() => {}); await mp.fill('#sheet input[name=amt]', '80'); await mp.fill('#sheet input[name=inv]', 'Z10'); await mp.click('#sheet button[name=go][value=done]'); await H.settle(mp, 300);
  check('6א שמירה בלי בחירת סניף נחסמת', await mp.evaluate(() => !S.tx.some((x) => x.inv === 'Z10') && !document.getElementById('sheet').hidden));
  await mp.selectOption('#sheet select[name=br]', 'bra'); await mp.click('#sheet button[name=go][value=done]'); await H.settle(mp, 400); await mp.waitForFunction(() => S.tx.some((x) => x.inv === 'Z10'), null, { timeout: 5000 }).catch(() => {});
  { const r6b = await mp.evaluate(() => { const t = S.tx.find((x) => x.inv === 'Z10'); const F = document.querySelector('#sheet form'), inv = F ? [...F.elements].filter((e) => e.willValidate && !e.checkValidity()).map((e) => e.name + ':' + e.validationMessage) : 'noform'; return { ok: !!t && t.br === 'bra', br: t && t.br, sel: F && F.elements.br && F.elements.br.value, inv, busy: F && F.dataset.busy, btn: F && [...F.querySelectorAll('button[name=go]')].map((x) => x.value + (x.disabled ? ':dis' : '')), errs: (window.__e || []).slice(0, 3), sheet: !document.getElementById('sheet').hidden, dlg: document.getElementById('dlg').open ? document.getElementById('dlg').innerText.slice(0, 200) : '', toast: ([...document.querySelectorAll('.toast')].pop() || {}).innerText || '' }; }); check('6ב אחרי בחירה – נשמר עם הסניף', r6b.ok, r6b); }
  // ---- 7. עריכה: הסניף הנוכחי מוצג ושמירה בלי שינוי לא כותבת br לרשומה ישנה ----
  const t7 = await mp.evaluate(() => { txDlg('i2'); ACT.txEdit({ dataset: { id: 'i2' } }); const s = document.querySelector('#dlg [name=br]'); return { val: s && s.value, hidden: s && s.hidden }; });
  check('7 עריכת תנועה ישנה בלי br: מוצג הסניף הראשון', t7.val === 'bra' && t7.hidden, t7);
  await mp.evaluate(() => { const f = document.querySelector('#dlg form[data-f=tsave]'); f.requestSubmit(); }); await H.settle(mp, 300);
  check('7א שמירה בלי שינוי סניף: לא נכתב br לרשומה הישנה', await mp.evaluate(() => S.tx.find((x) => x.id === 'i2').br === undefined));
  // ---- 8. עובד/מנהל מוגבל לסניף אחד: לא נשאל, br אוטומטי; מוגבל רואה רק את שלו ----
  const t8 = await mp.evaluate(() => { SY.br = ['brb']; openAdd({ type: 'exp', cat: 'e_misc' }); A.step = 'det'; sheetDraw(); const f = document.querySelector('#sheet form'); const h = f.querySelector('input[type=hidden][name=br]'); const sel = f.querySelector('select[name=br]'); const r = readTx({ amt: '5', date: '2026-11-02', desc: 'q', note: '', br: h && h.value }, cat('e_misc'), null, null); const chips = brChips(); const eff = brFil().join(); sheetClose(); return { hid: h && h.value, sel: !!sel, br: r.t && r.t.br, chips, eff }; });
  check('8 מוגבל לסניף אחד: שדה מוסתר עם הסניף, אין צ׳יפים, התנועה נשמרת עליו, והתצוגה מסוננת אליו', t8.hid === 'brb' && !t8.sel && t8.br === 'brb' && t8.chips === '' && t8.eff === 'brb', t8);
  await mp.evaluate(() => { delete SY.br; });
  // ---- 9. בנק / כרטיס בתשלום ----
  const t9 = await mp.evaluate(() => { payDlg('v1'); const d = document.getElementById('dlg'); const vis = (k) => { const e = d.querySelector('[data-pmx=' + k + ']'); return !!e && e.style.display !== 'none'; };
    const o = { initBank: vis('bank'), initCard: vis('card') };
    const r = (v) => { const i = [...d.querySelectorAll('input[name=m]')].find((x) => x.value === v); i.checked = true; i.dispatchEvent(new Event('change', { bubbles: true })); };
    r('העברה'); o.tBank = vis('bank'); o.tCard = vis('card'); r('אשראי'); o.cBank = vis('bank'); o.cCard = vis('card'); r('מזומן'); o.mBank = vis('bank'); o.mCard = vis('card');
    o.banks = [...d.querySelectorAll('select[name=bank] option')].map((x) => x.textContent); return o; });
  check('9 העברה → שדה בנק (לא כרטיס); אשראי → שדה כרטיס (לא בנק); מזומן → אף אחד; רשימת בנקים מההגדרות', !t9.initBank && !t9.initCard && t9.tBank && !t9.tCard && !t9.cBank && t9.cCard && !t9.mBank && !t9.mCard && t9.banks.length === 3, t9);
  await mp.evaluate(() => { const d = document.getElementById('dlg'); const i = [...d.querySelectorAll('input[name=m]')].find((x) => x.value === 'העברה'); i.checked = true; d.querySelector('select[name=bank]').value = 'bkb'; d.querySelector('form').requestSubmit(); }); await H.settle(mp, 300);
  check('9א תשלום בהעברה נשמר עם הבנק שנבחר (pays[].bank)', await mp.evaluate(() => { const p = S.tx.find((x) => x.id === 'v1').pays[0]; return p && p.m === 'העברה' && p.bank === 'bkb' && p.card === undefined; }));
  await mp.evaluate(() => { payDlg('v2'); const d = document.getElementById('dlg'); const i = [...d.querySelectorAll('input[name=m]')].find((x) => x.value === 'אשראי'); i.checked = true; i.dispatchEvent(new Event('change', { bubbles: true })); const c = d.querySelector('select[name=card]'); window.__cg = c.value; d.querySelector('form').requestSubmit(); }); await H.settle(mp, 300);
  check('9ב אשראי: הכרטיס היחיד מוצע מראש (cardGuess) ונשמר pays[].card', await mp.evaluate(() => { const p = S.tx.find((x) => x.id === 'v2').pays[0]; return window.__cg === 'cca' && p && p.card === 'cca' && p.bank === undefined; }));
  // ---- 10. בלי בנקים/כרטיסים מוגדרים: אין שדות ----
  await mp.evaluate((o) => { S.orgC = Object.assign({}, o, { banks: [], cards: [] }); save(); S.tx.push({ id: 'v3', t: 'exp', cat: 'e_sup', sub: 'sother', date: '2026-11-02', amt: 50, note: '', pays: [], kind: 'inv', plan: '2026-11', inv: 'C1' }); payDlg('v3'); }, ORG2);
  check('10 בלי בנקים/כרטיסים בהגדרות: אין שדות בנק/כרטיס בסגירת תשלום', await mp.evaluate(() => !document.querySelector('#dlg [data-pmx]')));
  await mp.evaluate(() => closeDlg());
  // ---- 11. מסך הגדרות הסניפים: מנהל שאינו־על לא רואה ----
  const t11 = await mp.evaluate(() => { const r = V.org(); return { t: r.t, h: r.h }; });
  check('11 מנהל שאינו מנהל־על: מסך סניפים/בנקים חסום', /למנהל המערכת בלבד/.test(t11.h) && !/data-a="orgEd"/.test(t11.h), t11.h.slice(0, 120));
  // ---- 12. עובד: ברירת מחדל לפי ספק, הסניף נשלח ב-data; סניף יחיד אוטומטי ----
  const t12 = await mp.evaluate(() => { SY.br = ['bra']; const a = wkBrF('', '', 'wkf'); const B = brMulti() ? brList() : []; SY.br = ['bra', 'brb']; const b = wkBrF('', 'sbra', 'wkf'); delete SY.br; return { aNone: a === '', aAuto: B.length === 1 && B[0].id === 'bra', bSel: /<option value="bra" selected>/.test(b), bReq: /required/.test(b) }; });
  check('12 עובד: סניף אחד – לא נשאל (נשלח אוטומטי); כמה סניפים – שדה חובה עם ברירת מחדל לפי ספק', t12.aNone && t12.aAuto && t12.bSel && t12.bReq, t12);
  // עובד אמיתי (דף נפרד): cfg עם סניפים; סניף אחד מותר → br נשלח אוטומטית; שני סניפים → חובה לבחור
  const w = await H.newPage(browser, www, cfg, [], 'w'); const wp = w.page; await wp.setViewportSize({ width: 360, height: 740 }); await H.login(wp, 'w@x.co');
  const wk = (brs, pick) => wp.evaluate(async ([brs, pick, org]) => { localStorage.setItem(CK, JSON.stringify({ cats: [{ id: 'e_sup', name: 'ספקים', beh: 'sup', subs: [{ id: 'sbra', name: 'ספק לכיש' }] }], org })); SY.br = brs; let msg = ''; localStorage.removeItem(OB);
    const of = window.flush, ol = window.wkLoad, ot = window.toast; window.flush = async () => {}; window.wkLoad = async () => {}; window.toast = (m) => { msg = m; };
    WK = { cat: '', sub: '', amt: '', date: '2026-11-02', note: '', pages: ['data:image/png;base64,iVBORw0KGgo='], inv: '', dn: false };
    await wkSubmit({ cat: 'e_sup', sub: 'sbra', amt: '9', date: '2026-11-02', inv: 'W1', note: '', br: pick }); window.flush = of; window.wkLoad = ol; window.toast = ot; const q = obGet(), d = q.length ? q[q.length - 1].data : null; return { br: d && d.br, sent: !!d, msg }; }, [brs, pick, { branches: ORG2.branches.map((b) => ({ id: b.id, name: b.name, on: true, sig: b.sig })) }]);
  const w1 = await wk(['bra'], ''); const w2 = await wk(['bra', 'brb'], ''); const w3 = await wk(['bra', 'brb'], 'brb');
  check('12ג עובד חד־סניפי: נשלח בלי שאלה עם br של הסניף שלו', w1.sent && w1.br === 'bra', w1);
  check('12ד עובד עם שני סניפים: בלי בחירה לא נשלח; עם בחירה נשלח עם br', !w2.sent && /סניף/.test(w2.msg) && w3.sent && w3.br === 'brb', [w2, w3]);
  check('12ב אין שגיאות JS (מנהל)', mp.__errors.length === 0, mp.__errors);
  check('12ה אין שגיאות JS (עובד)', wp.__errors.length === 0, wp.__errors);
  await m.ctx.close(); await w.ctx.close(); await browser.close(); console.log(fail ? 'נכשלו ' + fail : 'כל הבדיקות עברו'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
