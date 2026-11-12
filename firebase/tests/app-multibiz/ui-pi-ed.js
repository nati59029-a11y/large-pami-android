'use strict';
// תמחור מחשבונית ספק, שלב 4 (12.11.2026): מסך התמחור – V.pi (רשימה) ו-V.piEd (עריכה), www/pricing.js.
// רשת מדומה (בלי אמולטור): pinv (שאילתה + צילום בחלקים) ו-piClaim/piBeat/piDraft/piRelease/piFinish נענים כאן, עם נעילה כמו בשרת.
// בודק: רשימה + "בטיפול של X" (גם למנהל); כניסה = piClaim; מה שזוהה מימין, מחירים משמאל; חישובי % רווח וסיטונאי = PricingCalc;
// שינוי עלות ↑/↓; תגיות התאמה, ביטול/קישור; טיוטה ב-debounce; piBeat; יציאה = piRelease; משתמש שני; סיום → נעלם; מדף בלבד; 360/412 בלי גלישה.
// שימוש: node ui-pi-ed.js <www-dir> [out.json] [shots-dir]
const fs = require('fs'); const path = require('path'); const H = require('./harness');
let fail = 0; const res = []; const check = (n, ok, info) => { if (!ok) fail++; res.push({ n, ok: !!ok, info }); console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 600) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
const NAMES = { m: 'דני', m2: 'רותי', w: 'עובד', sm: 'מדף' };
const T0 = H.T0;

// ---- "שרת" מדומה ----
const CAT = {
  pA: { pid: 'pA', name: 'במבה', price: 5.9, barcode: '729001', sup: 'אסם', on: true, pk: 1, ct: 24, cto: false, q: {}, cost: 3.54, costx: 3, wp: 4.5 },
  pO: { pid: 'pO', name: 'במבה שטראוס', price: 6, barcode: '729005', sup: 'שטראוס', on: true, cto: false, q: {}, cost: 2.95, costx: 2.5, wp: 4 },
  pM: { pid: 'pM', name: 'מפיות', price: 7.9, barcode: '', sup: 'אסם', on: true, cto: true, q: {}, cost: 3.72, costx: 3.15, wp: null },
};
const sugg = { i1: [{ k: 'bc', pid: 'pA' }, { k: 'otherSup', oth: ['pO'] }, { k: '' }, { k: 'name', pid: 'pM' }], i3: [{ k: '' }] };
function fresh() {
  return {
    i1: { st: 'new', sup: 'אסם בע"מ', inv: '5001', date: '2026-11-01', at: T0 - 5000, by: 'w', byName: 'עובד', np: 1, lines: [
      { n: 'במבה 80 גרם', bc: '729001', qty: 10, unit: 'u', cost: 3.2 },
      { n: 'במבה אדומה', bc: '729005', qty: 6, unit: 'u', cost: 2 },
      { n: 'כוסות חד פעמי ארוז במארזים גדולים', bc: '729099', qty: 24, unit: 'ct', pk: 6, ct: 12, cost: 10, raw: '2 קרטון × 120 = 240', chk: 'סה"כ שורה לא תואם' },
      { n: 'מפיות', sku: 'A12', qty: 10, unit: 'pk', cost: 3.15 }] },
    i2: { st: 'new', sup: 'תנובה', inv: '77', date: '2026-11-02', at: T0 - 3000, by: 'm', byName: 'דני', np: 0, lk: { uid: 'x9', name: 'רותי', t: T0 - 60e3 }, lines: [{ n: 'חלב', qty: 1, unit: 'u', cost: 5 }] },
    i3: { st: 'new', sup: 'שטראוס', inv: '88', date: '2026-11-03', at: T0 - 1000, by: 'm', byName: 'דני', np: 0, lines: [{ n: 'יוגורט', bc: '729777', qty: 12, unit: 'u', cost: 2.4 }] },
  };
}
const S = { inv: fresh(), calls: [], ord: true };
const view = (pid) => { const p = CAT[pid]; return Object.assign({}, p); };
function matches(id, lines) {
  if (!S.ord) return [];
  return lines.map((l, i) => {
    const s = (sugg[id] || [])[i] || { k: '' };
    const oth = (s.oth || []).map((p) => { const v = view(p); return { pid: v.pid, name: v.name, sup: v.sup, price: v.price, costx: v.costx, wp: v.wp }; });
    let m = null, k = '';
    if (l.pid) { m = view(l.pid); k = 'pid'; } else if (l.nw) k = ''; else if (s.pid) { m = view(s.pid); k = s.k; } else if (oth.length) k = 'otherSup';
    return { m, k, nosup: false, oth: oth.filter((o) => !m || o.pid !== m.pid), cch: '' };
  });
}
const DU = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, '..', '..', '..', 'app-source', 'www', 'icon-192.png')).toString('base64');
const err = (route, reason, message) => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { status: 'FAILED_PRECONDITION', message, details: { reason } } }) });
const ok = (route, result) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result }) });
const fresh30 = (lk, now) => lk && now - lk.t < 30 * 60e3;
async function server(ctx, me) {
  const uidOf = (route) => String(route.request().headers().authorization || '').replace(/^Bearer tok-/, '');
  for (const fn of ['piClaim', 'piBeat', 'piRelease', 'piDraft', 'piFinish']) await ctx.route('**/' + fn, async (route) => {
    let b = {}; try { b = JSON.parse(route.request().postData()).data || {}; } catch (e) { /* */ }
    const uid = uidOf(route) || me; const d = S.inv[b.id]; const now = T0;
    S.calls.push({ fn, uid, b });
    if (!d) return err(route, 'no-pinv', 'החשבונית לא נמצאה');
    if (fn === 'piRelease') { if (d.st === 'new' && d.lk && d.lk.uid === uid) { delete d.lk; return ok(route, { ok: true, rel: true }); } return ok(route, { ok: true, rel: false }); }
    if (d.st !== 'new') return err(route, 'closed', 'החשבונית כבר טופלה');
    if (fn === 'piClaim') {
      if (fresh30(d.lk, now) && d.lk.uid !== uid) return err(route, 'locked', 'החשבונית בטיפול של ' + d.lk.name);
      d.lk = { uid, name: NAMES[uid] || uid, t: now };
      return ok(route, { ok: true, id: b.id, inv: { st: d.st, sup: d.sup, inv: d.inv, date: d.date, by: d.by, byName: d.byName, at: d.at, np: d.np, lines: JSON.parse(JSON.stringify(d.lines)) }, lk: d.lk, until: now + 30 * 60e3, vat: 18, ord: S.ord, m: matches(b.id, d.lines) });
    }
    if (!(d.lk && d.lk.uid === uid)) return fresh30(d.lk, now) ? err(route, 'locked', 'החשבונית בטיפול של ' + d.lk.name) : err(route, 'not-locked', 'צריך להיכנס לחשבונית מחדש');
    if (fn === 'piBeat') { d.lk.t = now; return ok(route, { ok: true }); }
    if (fn === 'piDraft') { d.lines = b.lines; return ok(route, { ok: true }); }
    if (fn === 'piFinish') { d.st = 'done'; delete d.lk; d.lines = b.lines; return ok(route, { ok: true, id: b.id, dup: false, added: 1, updated: 3, qty: 38 }); }
  });
  // Firestore: שאילתת pinv (st == 'new') וחלקי הצילום
  const fv = (v) => (v == null ? { nullValue: null } : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }) : typeof v === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fv(x)])) } } : { stringValue: String(v) });
  await ctx.route((u) => u.port === '8080' && /\/documents\/.*:runQuery$/.test(u.pathname), async (route) => {
    let q = {}; try { q = JSON.parse(route.request().postData()).structuredQuery; } catch (e) { /* */ }
    if (!q.from || q.from[0].collectionId !== 'pinv') return route.fallback();
    const base = route.request().url().replace(/^https?:\/\/[^/]+\/v1\//, '').replace(/:runQuery$/, '');
    S.calls.push({ fn: 'list' });
    const docs = Object.entries(S.inv).filter(([, d]) => d.st === 'new').map(([id, d]) => ({ document: { name: base + '/pinv/' + id, fields: Object.fromEntries(['sup', 'inv', 'date', 'at', 'byName', 'lk', 'np'].filter((k) => d[k] != null).map((k) => [k, fv(d[k])]).concat([['n', fv(d.lines.length)]])) }, readTime: '2026-11-03T09:00:00Z' }));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(docs.length ? docs : [{ readTime: '2026-11-03T09:00:00Z' }]) });
  });
  await ctx.route((u) => u.port === '8080' && /\/pinv\/[^/]+\/p\/\d+$/.test(u.pathname), async (route) => {
    S.calls.push({ fn: 'img', url: route.request().url() });
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ name: 'x', fields: { data: { stringValue: DU } } }) });
  });
}
async function open(browser, www, cfg, email, w, perms) {
  const { ctx, page } = await H.newPage(browser, www, cfg, [], email); await page.setViewportSize({ width: w, height: 760 });
  const uid = email.split('@')[0];
  await server(ctx, uid);
  if (perms) await ctx.route((u) => u.port === '8080' && new RegExp('/staff/' + uid + '$').test(u.pathname), (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ name: 'x', fields: { active: { booleanValue: true }, perms: { mapValue: { fields: Object.fromEntries(Object.entries(perms).map(([k, v]) => [k, { booleanValue: v }])) } } } }) }));
  await H.login(page, email);
  await page.evaluate(() => { const sh = document.getElementById('sheet'); if (sh && !sh.hidden && typeof ACT.startBlank === 'function') ACT.startBlank(); if (window.PI) { PI.draftMs = 300; PI.beatMs = 700; } });
  await H.settle(page, 300);
  return { ctx, page };
}
const waitFor = async (page, fn, arg, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 8000)) { if (await page.evaluate(fn, arg).catch(() => false)) return true; await sleep(150); } return false; };
const noOverflow = (page) => page.evaluate(() => { const W = document.documentElement.clientWidth; const bad = [...document.querySelectorAll('#main *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > W + 1 || r.left < -1); }).slice(0, 5).map((e) => e.tagName + '.' + e.className + ' ' + (e.textContent || '').slice(0, 30)); return { W, sw: document.documentElement.scrollWidth, bad }; });
const calls = (fn, uid) => S.calls.filter((c) => c.fn === fn && (!uid || c.uid === uid));
const inp = (i, k) => `#pil${i} input[data-k="${k}"]`;

(async () => {
  const [www, out, shots] = process.argv.slice(2);
  const PC = require(path.join(path.resolve(www), 'pricing-calc.js'));
  const shotDir = shots || null; if (shotDir) fs.mkdirSync(shotDir, { recursive: true });
  const browser = await H.launch();
  const cfg = { mode: 'new', users: { m: 'biz-o', m2: 'biz-o', w: 'biz-o', w0: 'biz-o' }, biz: { 'biz-o': { dataRoot: 'b', features: ALL, name: 'עסק בדיקה' } }, admins: { 'b/biz-o/|m': 1, 'b/biz-o/|m2': 1 }, staff: { 'b/biz-o/|w': 1, 'b/biz-o/|w0': 1 } };

  // ---- 1. רשימה (360px) ----
  const A = await open(browser, www, cfg, 'm@x.co', 360);
  await A.page.evaluate(() => go('pi'));
  await waitFor(A.page, () => document.querySelectorAll('.pi-row').length > 0); await sleep(500);
  const l1 = await A.page.evaluate(() => [...document.querySelectorAll('.pi-row')].map((b) => ({ t: b.innerText.replace(/\s+/g, ' ').trim(), dis: b.disabled, id: b.dataset.id || '' })));
  check('1 רשימה: 3 חשבוניות פתוחות עם ספק, תאריך, מספר ושורות; החדשה למעלה', l1.length === 3 && /שטראוס/.test(l1[0].t) && /אסם/.test(l1[2].t) && /01\/11\/2026/.test(l1[2].t) && /4 שורות/.test(l1[2].t) && /מס׳ 5001/.test(l1[2].t), l1);
  check('1א חשבונית שנעולה אצל אחר: "בטיפול של רותי" ואי אפשר להיכנס (גם מנהל)', l1[1].dis && /בטיפול של רותי/.test(l1[1].t) && !l1[0].dis && !l1[2].dis, l1[1]);
  check('1ב רשימה 360px – בלי גלישה אופקית', await noOverflow(A.page).then((r) => r.sw <= r.W && !r.bad.length), await noOverflow(A.page));
  if (shotDir) await A.page.screenshot({ path: path.join(shotDir, 'שלב4-רשימה-360.png'), fullPage: true });
  await A.page.click('.pi-row[disabled]', { force: true }).catch(() => {}); await sleep(300);
  check('1ג לחיצה על חשבונית נעולה – לא נכנס ולא קורא ל-piClaim', (await A.page.evaluate(() => cur().v)) === 'pi' && calls('piClaim').length === 0);

  // ---- 2. כניסה ועריכה ----
  await A.page.click('.pi-row[data-id="i1"]');
  await waitFor(A.page, () => document.querySelectorAll('.pil').length === 4); await sleep(500);
  check('2 כניסה = piClaim; 4 שורות במסך; החשבונית נעולה אצלי', calls('piClaim', 'm').length === 1 && S.inv.i1.lk && S.inv.i1.lk.uid === 'm' && (await A.page.evaluate(() => document.querySelectorAll('.pil').length)) === 4);
  const hdr = await A.page.evaluate(() => document.querySelector('.pi-hdr').innerText.replace(/\s+/g, ' '));
  check('2א כותרת: ספק, מספר, תאריך, כפתור צילום', /אסם/.test(hdr) && /5001/.test(hdr) && /01\/11\/2026/.test(hdr) && /צילום החשבונית/.test(hdr), hdr);
  const v0 = await A.page.evaluate(() => [0, 1, 2, 3].map((i) => { const q = (k) => { const e = document.querySelector(`#pil${i} input[data-k="${k}"]`); return e ? e.value : null; };
    return { n: q('n'), bc: q('bc'), pk: q('pk'), ct: q('ct'), cost: q('cost'), qty: q('qty'), price: q('price'), wp: q('wp'), mg: (document.getElementById('pim' + i) || {}).textContent, src: (document.getElementById('pis' + i) || {}).textContent,
      cch: (document.querySelector(`#pic${i} .cch`) || {}).className || '', cchT: (document.getElementById('pic' + i) || {}).textContent, hd: document.querySelector(`#pil${i} .hd`).innerText.replace(/\s+/g, ' '), cto: (document.querySelector(`#pil${i} input[data-c=piCto]`) || {}).checked, ck: document.getElementById('pil' + i).innerText.includes('לבדיקה') }; }));
  check('2ב מימין – מה שזוהה ניתן לעריכה: שם, ברקוד, כמות, במארז, בקרטון, עלות', v0[2].n.startsWith('כוסות') && v0[2].bc === '729099' && v0[2].pk === '6' && v0[2].ct === '12' && v0[2].cost === '10' && v0[2].qty === '24', v0[2]);
  check('2ג תגיות: "מוצר קיים" / "קיים אצל ספק אחר: שטראוס" + "מוצר חדש" / "מוצר חדש" / "הותאם לפי שם – לבדוק"', /מוצר קיים/.test(v0[0].hd) && /קיים אצל ספק אחר: שטראוס/.test(v0[1].hd) && /מוצר חדש/.test(v0[1].hd) && /מוצר חדש/.test(v0[2].hd) && /הותאם לפי שם – לבדוק/.test(v0[3].hd), v0.map((x) => x.hd));
  check('2ד מחיר לצרכן מהמלאי (מוצר קיים), ריק במוצר חדש', v0[0].price === '5.9' && v0[3].price === '7.9' && v0[2].price === '' && v0[1].price === '', v0.map((x) => x.price));
  const mg0 = PC.marginInc(5.9, 3.2, 18);
  check('2ה % רווח = PricingCalc.marginInc', v0[0].mg === `רווח: ${mg0}%` && v0[3].mg === `רווח: ${PC.marginInc(7.9, 3.15, 18)}%` && v0[2].mg === 'רווח: —', v0.map((x) => x.mg));
  check('2ו סיטונאי: מהמלאי (4.5, "מהמלאי"); אחרת PricingCalc.wsDefault ("חושב אוטומטית")', v0[0].wp === '4.5' && v0[0].src === 'מהמלאי' && v0[2].wp === String(PC.wsDefault(10)) && /חושב אוטומטית/.test(v0[2].src) && v0[3].wp === String(PC.wsDefault(3.15)) && v0[1].wp === String(PC.wsDefault(2)), v0.map((x) => [x.wp, x.src]));
  check('2ז שינוי עלות מסומן: עלות 3.2 מול 3 קודמת → ↑ עם העלות הקודמת; בלי שינוי – בלי סימון', /up/.test(v0[0].cch) && /↑/.test(v0[0].cchT) && /3/.test(v0[0].cchT) && !v0[3].cch && !v0[2].cch, v0.map((x) => x.cchT));
  check('2ח "לבדיקה" (chk) מסומן; "רק קרטונים סגורים" מהמלאי', v0[2].ck && !v0[0].ck && v0[3].cto === true && v0[0].cto === false, v0.map((x) => [x.ck, x.cto]));
  const o360 = await noOverflow(A.page);
  check('2ט עריכה 360px – בלי גלישה אופקית; השורה = כרטיס (מחירים מתחת למה שזוהה)', o360.sw <= o360.W && !o360.bad.length && await A.page.evaluate(() => { const a = document.querySelector('#pil0 > div').getBoundingClientRect(), b = document.querySelector('#pil0 .pr').getBoundingClientRect(); return b.top >= a.bottom - 1; }), o360);
  if (shotDir) await A.page.screenshot({ path: path.join(shotDir, 'שלב4-עריכה-360.png'), fullPage: true });

  // ---- 3. הקלדה: % רווח, סיטונאי, שינוי עלות, קרטון ----
  const nDraft0 = calls('piDraft').length;
  await A.page.click(inp(0, 'price')); await A.page.fill(inp(0, 'price'), ''); await A.page.type(inp(0, 'price'), '7.5', { delay: 40 });
  const mgT = await A.page.evaluate(() => document.getElementById('pim0').textContent);
  check('3 הקלדת מחיר → % הרווח מתעדכן מיד (= marginInc)', mgT === `רווח: ${PC.marginInc(7.5, 3.2, 18)}%`, mgT);
  await A.page.fill(inp(2, 'ct'), '6');
  const c2 = await A.page.evaluate(() => ({ qty: document.querySelector('#pil2 input[data-k=qty]').value, cost: document.querySelector('#pil2 input[data-k=cost]').value, wp: document.querySelector('#pil2 input[data-k=wp]').value }));
  check('3א שורת קרטונים: מארזים בקרטון 12→6 → כמות 2 קרטונים × 6 = 12, עלות מארז 120 ÷ 6 = 20, סיטונאי מחושב מחדש', c2.qty === '12' && c2.cost === '20' && c2.wp === String(PC.wsDefault(20)), c2);
  await A.page.fill(inp(2, 'cost'), '12');
  const w2 = await A.page.evaluate(() => document.querySelector('#pil2 input[data-k=wp]').value);
  check('3ב שינוי עלות במוצר חדש → סיטונאי אוטומטי = wsDefault(12)', w2 === String(PC.wsDefault(12)), w2);
  await A.page.fill(inp(0, 'cost'), '2.5');
  const cc = await A.page.evaluate(() => ({ c: document.querySelector('#pic0 .cch') && document.querySelector('#pic0 .cch').className, t: document.getElementById('pic0').textContent, wp: document.querySelector('#pil0 input[data-k=wp]').value, mg: document.getElementById('pim0').textContent }));
  check('3ג עלות 2.5 מול 3 → ↓; סיטונאי מהמלאי לא משתנה; % רווח מחושב מחדש', /down/.test(cc.c) && /↓/.test(cc.t) && cc.wp === '4.5' && cc.mg === `רווח: ${PC.marginInc(7.5, 2.5, 18)}%`, cc);
  await A.page.fill(inp(3, 'wp'), '9');
  const s3 = await A.page.evaluate(() => document.getElementById('pis3').textContent);
  check('3ד סיטונאי שהוקלד – "הוזן ידנית"', s3 === 'הוזן ידנית', s3);
  await A.page.fill(inp(0, 'bc'), '72#'); const bad = await A.page.evaluate(() => document.querySelector('#pil0 input[data-k=bc]').classList.contains('bad'));
  await A.page.fill(inp(0, 'bc'), '729001');
  check('3ה ערך לא תקין (ברקוד) מסומן באדום ולא נשמר', bad && await A.page.evaluate(() => PI.ed().L[0].bc === '729001'));
  await A.page.click('#pil0 input[data-c=piCto]');
  await sleep(1200);
  const dr = calls('piDraft', 'm'); const last = dr[dr.length - 1];
  check('3ו טיוטה נשמרת (piDraft) ב-debounce – לא בכל הקשה; כוללת מחיר, סיטונאי, cto, ct, עלות', dr.length - nDraft0 >= 1 && dr.length - nDraft0 <= 4 && last && last.b.lines[0].price === 7.5 && last.b.lines[0].cto === true && last.b.lines[0].pid === 'pA' && last.b.lines[2].ct === 6 && last.b.lines[2].cost === 12 && last.b.lines[2].wpSrc === 'auto' && last.b.lines[3].wp === 9 && last.b.lines[3].wpSrc === 'man', { n: dr.length - nDraft0, l: last && last.b.lines });
  check('3ז piBeat נקרא כל PI.beatMs בזמן שהמסך פתוח', calls('piBeat', 'm').length >= 1, calls('piBeat').length);

  // ---- 4. ביטול התאמה / קישור ----
  await A.page.click('#pil0 [data-a=piUnl]'); await sleep(100);
  const u0 = await A.page.evaluate(() => ({ hd: document.querySelector('#pil0 .hd').innerText, l: PI.ed().L[0] }));
  check('4 "בטל התאמה" → "מוצר חדש" (nw, בלי pid), כפתור "קשר למוצר קיים"', /מוצר חדש/.test(u0.hd) && /קשר למוצר קיים/.test(u0.hd) && u0.l.nw === true && !u0.l.pid, u0);
  await A.page.click('#pil0 [data-a=piLnk]'); await sleep(100);
  check('4א "קשר" מחזיר את ההתאמה (pA, "מוצר קיים")', await A.page.evaluate(() => PI.ed().L[0].pid === 'pA' && !PI.ed().L[0].nw && /מוצר קיים/.test(document.querySelector('#pil0 .hd').innerText)));
  await A.page.click('#pil1 [data-a=piLnk]'); await sleep(100);
  const k1 = await A.page.evaluate(() => ({ l: PI.ed().L[1], hd: document.querySelector('#pil1 .hd').innerText, price: document.querySelector('#pil1 input[data-k=price]').value, wp: document.querySelector('#pil1 input[data-k=wp]').value, src: document.getElementById('pis1').textContent }));
  check('4ב "קיים אצל ספק אחר" → קישור: pid של הספק האחר, מחיר וסיטונאי מהמלאי שלו', k1.l.pid === 'pO' && /שטראוס/.test(k1.hd) && k1.price === '6' && k1.wp === '4' && k1.src === 'מהמלאי', k1);

  // ---- 5. הדפסה (שלב 6), צילום ----
  await A.page.click('#pil0 [data-a=piPrP]'); const t5 = await A.page.evaluate(() => [...document.querySelectorAll('.toast')].map((x) => x.textContent).join('|'));
  await A.page.click('#pil0 [data-a=piPrS]'); const t5b = await A.page.evaluate(() => [...document.querySelectorAll('.toast')].map((x) => x.textContent).join('|'));
  check('5 "הדפס מחיר" / "הדפס מבצע" – כפתורים עם "בקרוב" (החיבור בשלב 6)', /מחיר.*בקרוב/.test(t5) && /מבצע.*בקרוב/.test(t5b), [t5, t5b]);
  await A.page.click('[data-a=piImgV]');
  const vw = await waitFor(A.page, () => !!document.getElementById('viewer') && !document.getElementById('viewer').hidden);
  check('5א צילום החשבונית נטען מהענן (pinv/i1/p/0) ונפתח בלחיצה', vw && calls('img').some((c) => /pinv\/i1\/p\/0/.test(c.url)));
  await A.page.evaluate(() => { try { vwClose(); } catch (e) { goBack(); } }); await sleep(200);

  // ---- 6. משתמש שני (412px) ----
  const B = await open(browser, www, cfg, 'm2@x.co', 412);
  await B.page.evaluate(() => go('pi'));
  await waitFor(B.page, () => document.querySelectorAll('.pi-row').length > 0); await sleep(500);
  const rB = await B.page.evaluate(() => { const b = [...document.querySelectorAll('.pi-row')].find((x) => /אסם/.test(x.innerText)); return { t: b.innerText.replace(/\s+/g, ' '), dis: b.disabled }; });
  check('6 משתמש שני (מנהל) רואה "בטיפול של דני" ולא יכול להיכנס', rB.dis && /בטיפול של דני/.test(rB.t), rB);
  const o412 = await noOverflow(B.page);
  check('6א רשימה 412px – בלי גלישה', o412.sw <= o412.W && !o412.bad.length, o412);
  await B.page.evaluate(() => go('piEd', 'i1'));
  await waitFor(B.page, () => /בטיפול של/.test(document.getElementById('main').innerText));
  const eB = await B.page.evaluate(() => ({ t: document.getElementById('main').innerText, pil: document.querySelectorAll('.pil').length }));
  check('6ב גם כניסה ישירה (go) – נחסמת: "בטיפול של דני", בלי שורות לעריכה', /בטיפול של דני/.test(eB.t) && eB.pil === 0 && S.inv.i1.lk.uid === 'm', eB.t.slice(0, 80));
  await B.page.evaluate(() => goBack()); await sleep(300);
  check('6ג יציאה ממסך שלא נכנסו אליו – לא משחררת את הנעילה של אחר', S.inv.i1.lk && S.inv.i1.lk.uid === 'm' && calls('piRelease', 'm2').length === 0);
  await B.page.evaluate(() => go('piEd', 'i3'));
  await waitFor(B.page, () => document.querySelectorAll('.pil').length === 1); await sleep(500);
  const oE = await noOverflow(B.page);
  check('6ד עריכה 412px – בלי גלישה', oE.sw <= oE.W && !oE.bad.length, oE);
  if (shotDir) await B.page.screenshot({ path: path.join(shotDir, 'שלב4-עריכה-412.png'), fullPage: true });
  await B.page.evaluate(() => goBack()); await sleep(600);
  check('6ה חזרה = piRelease (i3 משוחררת)', calls('piRelease', 'm2').some((c) => c.b.id === 'i3') && !S.inv.i3.lk);

  // ---- 7. הראשון יוצא → השני נכנס ----
  const nd = calls('piDraft', 'm').length;
  await A.page.fill(inp(0, 'price'), '7.9');
  await A.page.evaluate(() => goBack()); await sleep(800);
  check('7 יציאה: טיוטה אחרונה נשמרת ואז piRelease; הנעילה שוחררה', calls('piDraft', 'm').length > nd && calls('piRelease', 'm').some((c) => c.b.id === 'i1') && !S.inv.i1.lk && S.inv.i1.lines[0].price === 7.9, { lk: S.inv.i1.lk });
  await B.page.evaluate(() => ACT.piRe()); await sleep(500);
  const rB2 = await B.page.evaluate(() => { const b = [...document.querySelectorAll('.pi-row')].find((x) => /אסם/.test(x.innerText)); return { t: b.innerText, dis: b.disabled }; });
  await B.page.click('.pi-row[data-id="i1"]');
  await waitFor(B.page, () => document.querySelectorAll('.pil').length === 4);
  const v2 = await B.page.evaluate(() => ({ price: document.querySelector('#pil0 input[data-k=price]').value, cto: document.querySelector('#pil0 input[data-c=piCto]').checked, pid1: PI.ed().L[1].pid }));
  check('7א אחרי שהראשון יצא – השני נכנס וממשיך מהטיוטה (מחיר, cto, קישור)', !rB2.dis && S.inv.i1.lk.uid === 'm2' && v2.price === '7.9' && v2.cto === true && v2.pid1 === 'pO', v2);
  await B.page.evaluate(() => goBack()); await sleep(600);

  // ---- 8. סיום ושמירה ----
  await A.page.click('.pi-row[data-id="i1"]');
  await waitFor(A.page, () => document.querySelectorAll('.pil').length === 4);
  // 8-. "דלג על השורה" (פיקדון / דמי משלוח): מעומעמת עם "החזר", לא נספרת בסיום, נשלחת עם skip
  await A.page.click('#pil1 [data-a=piSkip]'); await sleep(200);
  const sk = await A.page.evaluate(() => { const r = document.getElementById('pil1'); const st = getComputedStyle(r); return { sk: r.classList.contains('sk'), op: +st.opacity, back: !!r.querySelector('[data-a=piSkip][data-v="0"]'), inputs: r.querySelectorAll('input').length, others: document.querySelectorAll('.pil:not(.sk) [data-a=piSkip][data-v="1"]').length, sw: document.documentElement.scrollWidth, W: innerWidth }; });
  check('8- דלג על השורה: השורה מעומעמת, בלי שדות, עם "החזר"; לשאר השורות יש "דלג"; בלי גלישה ב-360', sk.sk && sk.op < 0.7 && sk.back && sk.inputs === 0 && sk.others === 3 && sk.sw <= sk.W, sk);
  await sleep(500); const dSk = calls('piDraft', 'm').pop();
  check('8-א הטיוטה נשמרת עם skip בשורה שדילגו עליה בלבד', dSk && dSk.b.lines[1].skip === true && !dSk.b.lines.some((l, i) => i !== 1 && l.skip), dSk && dSk.b.lines.map((l) => !!l.skip));
  await A.page.fill(inp(2, 'price'), '19.9'); await A.page.click('[data-a=piFin]'); await sleep(200);
  const dk = await A.page.evaluate(() => ({ u: (document.getElementById('piSU') || {}).textContent, n: (document.getElementById('piSN') || {}).textContent, q: (document.getElementById('piSQ') || {}).textContent }));
  check('8-ב בסיום השורה לא נספרת: 2 מוצרים יעודכנו, 1 ייווצר, 32 יחידות (בלי 6 של השורה)', dk.u === '2' && dk.n === '1' && dk.q === '32', dk);
  await A.page.evaluate(() => closeDlg());
  await A.page.click('#pil1 [data-a=piSkip][data-v="0"]'); await sleep(200);
  const rs = await A.page.evaluate(() => ({ sk: document.querySelectorAll('.pil.sk').length, inputs: document.querySelectorAll('#pil1 input').length }));
  check('8-ג "החזר" – השורה חוזרת לרגילה עם השדות', rs.sk === 0 && rs.inputs > 0, rs);
  await A.page.fill(inp(2, 'price'), '');
  await A.page.click('[data-a=piFin]'); await sleep(150);
  const tv = await A.page.evaluate(() => ({ t: [...document.querySelectorAll('.toast')].map((x) => x.textContent).pop(), dlg: document.getElementById('dlg').open }));
  check('8 סיום עם מוצר חדש בלי מחיר לצרכן – נעצר עם הודעה (שורה 3), בלי piFinish', /שורה 3/.test(tv.t) && !tv.dlg && calls('piFinish').length === 0, tv);
  await A.page.fill(inp(2, 'price'), '19.9');
  await A.page.click('[data-a=piFin]'); await sleep(200);
  const dt = await A.page.evaluate(() => ({ t: document.getElementById('dlg').innerText.replace(/\s+/g, ' '), u: document.getElementById('piSU').textContent, n: document.getElementById('piSN').textContent, q: document.getElementById('piSQ').textContent }));
  check('8א אישור קצר: 3 מוצרים יעודכנו, 1 ייווצר, 38 יחידות למלאי (10+6+12+10)', dt.u === '3' && dt.n === '1' && dt.q === '38', dt);
  await A.page.click('#dlg form[data-f=piFinF] button.btn:not([type])'); await sleep(800);
  const fin = calls('piFinish', 'm'); const fb = fin[0] && fin[0].b;
  check('8ב piFinish: מזהה בקשה, השורות עם pid / מחירים / סיטונאי / cto (בלי שדות ריקים)', fin.length === 1 && /^[A-Za-z0-9_-]{8,40}$/.test(fb.reqId) && fb.lines.length === 4 && fb.lines[0].pid === 'pA' && fb.lines[0].price === 7.9 && fb.lines[0].wp === 4.5 && fb.lines[1].pid === 'pO' && !fb.lines[2].pid && fb.lines[2].price === 19.9 && fb.lines[2].wp === PC.wsDefault(12) && fb.lines[3].pid === 'pM' && !Object.values(fb.lines[2]).some((v) => v === null || v === ''), fb);
  const lA = await A.page.evaluate(() => ({ v: cur().v, rows: [...document.querySelectorAll('.pi-row')].map((b) => b.dataset.id || 'x') }));
  check('8ג אחרי הסיום – חוזרים לרשימה והחשבונית נעלמה', lA.v === 'pi' && !lA.rows.includes('i1') && lA.rows.length === 2, lA);
  await B.page.evaluate(() => ACT.piRe()); await sleep(500);
  const lB = await B.page.evaluate(() => [...document.querySelectorAll('.pi-row')].map((b) => b.innerText));
  check('8ד נעלמה גם אצל המשתמש השני', lB.length === 2 && !lB.some((t) => /אסם/.test(t)), lB);
  check('8ה אין שגיאות JavaScript', !A.page.__errors.length && !B.page.__errors.length, [A.page.__errors, B.page.__errors]);
  await A.ctx.close(); await B.ctx.close();

  // ---- 9. עובד: עם prc רואה, בלי prc לא; עסק עם מדף בלבד – בלי סיטונאי וקרטונים ----
  S.inv = fresh();
  const W = await open(browser, www, cfg, 'w@x.co', 360, { prc: true });
  await W.page.evaluate(() => go('pi')); await waitFor(W.page, () => document.querySelectorAll('.pi-row').length > 0);
  check('9 עובד עם מתג prc רואה את הרשימה', (await W.page.evaluate(() => document.querySelectorAll('.pi-row').length)) === 3);
  await W.ctx.close();
  const W0 = await open(browser, www, cfg, 'w0@x.co', 360, { ord: true });
  const nl0 = calls('list').length;
  await W0.page.evaluate(() => go('pi')); await sleep(400);
  const d0 = await W0.page.evaluate(() => document.getElementById('main').innerText);
  check('9א עובד בלי prc – "אין לך הרשאה", בלי שאילתה', /אין לך הרשאה לעדכון מחירים ומלאי/.test(d0) && calls('list').length === nl0, d0.slice(0, 60));
  await W0.ctx.close();
  S.ord = false;
  const cfgS = { mode: 'new', users: { sm: 'biz-s' }, biz: { 'biz-s': { dataRoot: 'b', features: { scan: true, shelf: true }, name: 'מדף בלבד' } }, admins: { 'b/biz-s/|sm': 1 } };
  const C = await open(browser, www, cfgS, 'sm@x.co', 360);
  await C.page.evaluate(() => go('piEd', 'i3')); await waitFor(C.page, () => document.querySelectorAll('.pil').length === 1);
  const sh = await C.page.evaluate(() => ({ wp: !!document.querySelector('#pil0 input[data-k=wp]'), cto: !!document.querySelector('#pil0 input[data-c=piCto]'), price: !!document.querySelector('#pil0 input[data-k=price]'), mg: (document.getElementById('pim0') || {}).textContent, note: document.querySelector('.pi-hdr').innerText }));
  check('9ב עסק עם מדף בלבד: מחיר לצרכן ו-% רווח, בלי סיטונאי ובלי "רק קרטונים סגורים"', !sh.wp && !sh.cto && sh.price && /רווח/.test(sh.mg) && /בלי מחיר סיטונאי/.test(sh.note), sh);
  await C.page.fill(inp(0, 'price'), '4.9'); await C.page.click('[data-a=piFin]'); await sleep(200);
  const dS = await C.page.evaluate(() => document.getElementById('dlg').innerText);
  await C.page.click('#dlg form[data-f=piFinF] button.btn:not([type])'); await sleep(600);
  const fS = calls('piFinish', 'sm')[0];
  check('9ג מדף בלבד – סיום: הודעה בלי מלאי, piFinish בלי wp / cto', /אין מלאי בענן/.test(dS) && fS && !('wp' in fS.b.lines[0]) && !('cto' in fS.b.lines[0]) && fS.b.lines[0].price === 4.9 && !fS.b.br, fS && fS.b);
  check('9ד אין שגיאות JavaScript (מדף בלבד)', !C.page.__errors.length, C.page.__errors);
  await C.ctx.close();

  await browser.close();
  if (out) fs.writeFileSync(out, JSON.stringify({ fail, res }, null, 1));
  console.log(fail ? `נכשלו ${fail}` : 'הכול עבר');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
