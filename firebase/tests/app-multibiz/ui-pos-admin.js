'use strict';
// POS:M4 (ש4): pos-cfg-schema / pos-cfg / pos-admin / pos-sa / pos-status בדפדפן, רשת מדומה.
//   מתג כבוי (עסק b) ועסק legacy: אין שום בקשה ל-poscfg / poscfglog / posSa / posBug, כל המסכים החדשים – "לא פעילה",
//     PosCfg.open() = false ו-PosCfg.get מחזיר את ברירת המחדל של הסכמה בלי לקרוא כלום.
//   דלוק: PosCfg קורא saPub + main ומחשב (מודול כבוי = undefined); בעל העסק – הגדרה רגישה מבקשת אישור ונשלחת עם appr:'self';
//     יומן שינויים ו"בטל" (posCfgUndo); מנהל – אין יומן; מנהל־על – מסך הקופה למנהל־על (posSa get / tplDiff); מצב המערכת + דיווח בעיה.
//   במסך הקופה (V.pos) אין שום הגדרה. אין גלישה ב-360px, אין שגיאות JS. שימוש: node ui-pos-admin.js <www-dir> [out.json]
const fs = require('fs'); const H = require('./harness');
const SC = require('../../functions/lib/pos-cfg-schema');
let fail = 0; const res = [];
const check = (n, ok, info) => { if (!ok) fail++; res.push({ n, ok: !!ok, info }); console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fv = (v) => (v === null ? { nullValue: null } : typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
  : typeof v === 'string' ? { stringValue: v } : Array.isArray(v) ? { arrayValue: { values: v.map(fv) } } : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fv(x)])) } });
const fdoc = (name, o) => ({ name, fields: fv(o).mapValue.fields });

async function open(browser, www, cfg, email, role, sa) {
  const log = [];
  const { ctx, page } = await H.newPage(browser, www, cfg, log, email);
  const errs = []; page.on('pageerror', (e) => errs.push(String(e && e.message || e)));
  await page.setViewportSize({ width: 360, height: 760 });
  const calls = [];
  const E = SC.eff({ sa: { on: true, st: 'trial', type: 'bakeryDisposable' }, main: { retDays: 21 } });
  const CFG = { ok: true, role, ver: 3, cfg: E.cfg, src: E.src, off: E.off, mods: E.mods, on: true, st: 'trial', type: 'bakeryDisposable', upd: 1, sa: { lock: [], who: {}, opened: true } };
  await ctx.route('**/pos*', (route) => { const u = new URL(route.request().url()); if (u.port !== '5001') return route.fallback();
    let b = {}; try { b = JSON.parse(route.request().postData()).data || {}; } catch (e) { /* */ }
    const fn = u.pathname.split('/').pop(); calls.push({ fn, b });
    let r = { ok: true };
    if (fn === 'posCfg') r = CFG;
    if (fn === 'posCfgSet') { if (SC.BY[Object.keys(b.set || {})[0]] && SC.BY[Object.keys(b.set)[0]].sens && role === 'own' && b.appr !== 'self') return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { status: 'FAILED_PRECONDITION', message: 'הגדרה רגישה – נדרש אישור נוסף', details: { reason: 'appr-needed' } } }) }); r = { ok: true, ver: 4, cfg: E.cfg, src: {}, off: {}, changes: Object.keys(b.set || {}) }; }
    if (fn === 'posSa') r = b.op === 'get' ? { ok: true, sa: { on: true, st: 'trial', type: 'bakeryDisposable', openedAt: 1, tpl: 'bakeryDisposable', tplVer: 1, lock: [], who: {} }, pub: null, tpls: [{ type: 'grocery', name: 'מכולת / מינימרקט', ver: 1, vals: { retDays: 7 }, mods: {} }] }
      : b.op === 'tplDiff' ? { ok: true, type: 'bakeryDisposable', ver: 1, diff: [], mods: [] } : { ok: true };
    if (fn === 'posBug') r = { ok: true, id: 'b1' };
    if (fn === 'posDev') r = { ok: true, dev: 'K1' };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: r }) }); });
  await ctx.route((u) => u.port === '8080' && /\/documents\/b\/biz-p\/posdev$/.test(u.pathname), (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ documents: [fdoc('projects/x/databases/(default)/documents/b/biz-p/posdev/K1', { name: 'קופה 1', on: true, st: 'active', lastSync: 1700000000000 })] }) }));
  await ctx.route((u) => u.port === '8080' && /\/documents\/b\/biz-p\/poscfg\/saPub$/.test(u.pathname), (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fdoc('x/saPub', { on: true, st: 'trial', type: 'bakeryDisposable', mods: { weight: false, club: true }, ver: 2 })) }));
  await ctx.route((u) => u.port === '8080' && /\/documents\/b\/biz-p\/poscfg\/main$/.test(u.pathname), (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fdoc('x/main', { retDays: 21, cat: { nameMax: 30 }, ver: 3 })) }));
  await ctx.route((u) => u.port === '8080' && /\/documents\/b\/biz-p\/poscfglog$/.test(u.pathname), (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ documents: [
    fdoc('projects/x/databases/(default)/documents/b/biz-p/poscfglog/L2', { key: 'retDays', old: 14, new: 21, scope: 'main', by: 'm', role: 'mgr', src: 'ui', at: 1700000000000 }),
    fdoc('projects/x/databases/(default)/documents/b/biz-p/poscfglog/L1', { key: 'retDays', old: null, new: 14, scope: 'main', by: 'm', role: 'mgr', src: 'ui', at: 1690000000000 })] }) }));
  await H.login(page, email);
  if (sa) await page.evaluate(() => { SY.sa = 1; });
  await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden && ACT.startBlank) ACT.startBlank(); });
  await H.settle(page, 600);
  return { ctx, page, log, errs, calls };
}
const posReq = (A) => A.log.filter((r) => /\/pos[A-Za-z_]*($|[/?])|\/documents\/b\/[^/]+\/pos/.test(new URL(r.url).pathname));
const txt = (page) => page.evaluate(() => document.getElementById('main').innerText.replace(/\s+/g, ' '));
const wide = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

(async () => {
  const [www, out] = process.argv.slice(2);
  const browser = await H.launch();
  const cB = (feat, own) => ({ mode: 'new', users: { m: 'biz-p', o: 'biz-p' }, biz: { 'biz-p': { dataRoot: 'b', features: feat, name: 'עסק קופה' } }, admins: { 'b/biz-p/|m': 1, 'b/biz-p/|o': 1 }, staff: {} });
  const BZ0 = ['larg', 'peami'].join('');

  // ---- 1. מתג כבוי ----
  let A = await open(browser, www, cB({ tasks: true, orders: true }), 'm@x.co', 'mgr');
  let v = await A.page.evaluate(async () => { await PosCfg.ready(); return { open: PosCfg.open(), ret: PosCfg.get('retDays'), views: ['posCfgSec', 'posCfgLog', 'posStatus', 'posSa'].map((x) => V[x]().h) }; });
  check('1 מתג כבוי: המסכים החדשים לא נפתחים, PosCfg סגור ומחזיר את ברירת המחדל של הסכמה', !v.open && v.ret === 14 && v.views.every((h) => /לא פעילה|מנהל־על בלבד/.test(h)), v);
  check('1א מתג כבוי: אין שום בקשה ל-poscfg / poscfglog / posSa / posBug / posCfg', !posReq(A).length && !A.calls.length, posReq(A).map((r) => r.url));
  check('1ב מתג כבוי: אין שגיאות JS', !A.errs.length, A.errs);
  await A.ctx.close();

  // ---- 2. legacy ----
  A = await open(browser, www, { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: { tasks: true, pos: true } } }, admins: { '|m': 1 }, staff: {} }, 'm@x.co', 'mgr');
  v = await A.page.evaluate(async () => { await PosCfg.ready(); return { open: PosCfg.open(), h: V.posAdm().h }; });
  check('2 עסק legacy: הכול סגור, בלי בקשות', !v.open && /לא פעילה/.test(v.h) && !posReq(A).length && !A.calls.length, posReq(A).map((r) => r.url));
  await A.ctx.close();

  // ---- 3. דלוק, בעל העסק ----
  A = await open(browser, www, cB({ tasks: true, orders: true, pos: true }), 'o@x.co', 'own');
  v = await A.page.evaluate(async () => { await PosCfg.ready(); return { open: PosCfg.open(), ret: PosCfg.get('retDays'), nm: PosCfg.get('cat.nameMax'), wbc: PosCfg.get('wbc'), wbcRaw: !!PosCfg.raw('wbc'), club: PosCfg.mod('club'), ver: PosCfg.ver }; });
  check('3 PosCfg: saPub + main ← ערכים בפועל; מודול כבוי (weight) – wbc לא חל', v.open && v.ret === 21 && v.nm === 30 && v.wbc === undefined && v.wbcRaw && v.club && v.ver === '3.2', v);
  await A.page.evaluate(() => go('posAdm')); await sleep(1200);
  let t = await txt(A.page);
  check('3א בית הניהול לבעל העסק: קופות, חיפוש, מדורים, יומן שינויים ומצב המערכת (בלי מנהל־על)', /קופה 1/.test(t) && /חיפוש בהגדרות/.test(t) && /יומן שינויים/.test(t) && /מצב המערכת/.test(t) && !/פתיחה, השעיה/.test(t), t.slice(0, 300));
  await A.page.fill('#posAdmQ', 'מע"מ'); await sleep(900);
  t = await txt(A.page);
  check('3ב חיפוש "מע"מ" מוצא את שיעור המע"מ', /שיעור מע"מ/.test(t), t.slice(0, 200));
  await A.page.evaluate(() => go('posCfgSec', 'pay')); await sleep(400);
  await A.page.evaluate(() => { const b = document.querySelector('[name=pa_payOn][value=transfer]'); b.checked = !b.checked; });
  await A.page.click('[data-f=posCfgSecF] button'); await sleep(700);
  const dlgOpen = await A.page.evaluate(() => !!document.querySelector('#dlg[open] #posApprTxt'));
  await A.page.fill('#posApprTxt', 'מאשר'); await A.page.click('[data-a=posApprOk]'); await sleep(700);
  const sets = A.calls.filter((c) => c.fn === 'posCfgSet');
  check('3ג הגדרה רגישה (payOn): השרת מבקש אישור ← חלון אישור ← נשלח שוב עם appr:self', dlgOpen && sets.length === 2 && !sets[0].b.appr && sets[1].b.appr === 'self' && Array.isArray(sets[1].b.set.payOn), sets);
  check('3ד בלי גלישה ב-360px במדור הגדרות', await wide(A.page));
  await A.page.evaluate(() => go('posCfgLog')); await sleep(1200);
  t = await txt(A.page);
  const undoBtns = await A.page.evaluate(() => document.querySelectorAll('[data-a=posCfgUndo]').length);
  check('3ה יומן שינויים: השורות מוצגות, "בטל" רק על השינוי האחרון של המפתח', /ימים להחזרה/.test(t) && /14 ← 21/.test(t) && undoBtns === 1, { undoBtns, t: t.slice(0, 200) });
  await A.page.click('[data-a=posCfgUndo]'); await sleep(700);
  const und = A.calls.filter((c) => c.fn === 'posCfgUndo');
  check('3ו "בטל" שולח posCfgUndo עם מזהה השורה', und.length === 1 && und[0].b.logId === 'L2', und);
  await A.page.evaluate(() => go('posStatus')); await sleep(1200);
  t = await txt(A.page);
  check('3ז מצב המערכת: גרסה, מצב הקופה, קופות עם סנכרון אחרון', /גרסת האפליקציה/.test(t) && /פתוחה \(ניסיון\)/.test(t) && /קופה 1/.test(t) && /סנכרון אחרון/.test(t), t.slice(0, 300));
  await A.page.fill('[data-f=posBugF] [name=txt]', 'המדפסת לא מדפיסה'); await A.page.click('[data-f=posBugF] button'); await sleep(700);
  const bug = A.calls.filter((c) => c.fn === 'posBug');
  check('3ח דווח על בעיה – posBug עם הטקסט והגרסה', bug.length === 1 && bug[0].b.txt === 'המדפסת לא מדפיסה' && !!bug[0].b.ver, bug);
  await A.page.evaluate(() => go('pos')); await sleep(800);
  t = await txt(A.page);
  check('3ט מסך הקופה: אין שום הגדרה (אין טופס, אין posCfgSet)', !/הגדרות/.test(t) && !(await A.page.evaluate(() => !!document.querySelector('#main form,#main [data-f^=posCfg]'))), t.slice(0, 200));
  check('3י אין שגיאות JS', !A.errs.length, A.errs);
  await A.ctx.close();

  // ---- 4. מנהל: אין יומן ----
  A = await open(browser, www, cB({ tasks: true, orders: true, pos: true }), 'm@x.co', 'mgr');
  await A.page.evaluate(() => go('posAdm')); await sleep(1200);
  t = await txt(A.page);
  const lg = await A.page.evaluate(() => V.posCfgLog().h);
  check('4 מנהל: אין כניסה ליומן השינויים, והיומן לא נקרא', !/יומן שינויים/.test(t) && /לבעל העסק בלבד/.test(lg) && !A.log.some((r) => /poscfglog/.test(r.url)), lg);
  await A.ctx.close();

  // ---- 5. מנהל־על ----
  A = await open(browser, www, cB({ tasks: true, orders: true, pos: true }), 'm@x.co', 'sa', true);
  await A.page.evaluate(() => go('posAdm')); await sleep(1200);
  t = await txt(A.page);
  check('5 מנהל־על: "משנה כמנהל־על" וכניסה למסך מנהל־על', /משנה כמנהל־על/.test(t) && /פתיחה, השעיה/.test(t), t.slice(0, 200));
  await A.page.evaluate(() => go('posSa')); await sleep(1200);
  t = await txt(A.page);
  check('5א מסך מנהל־על: מצב, סוג עסק, מודולים, נעילות, החל תבנית מחדש, תבניות, דיווחי בעיה', /מצב/.test(t) && /מודולים/.test(t) && /הגדרות נעולות/.test(t) && /החל תבנית מחדש/.test(t) && /תבניות \(לכל העסקים\)/.test(t) && /דיווחי בעיה/.test(t), t.slice(0, 300));
  await A.page.click('[data-a=posSaDiff]'); await sleep(700);
  t = await txt(A.page);
  check('5ב "הצג הבדלים" – posSa tplDiff', A.calls.some((c) => c.fn === 'posSa' && c.b.op === 'tplDiff') && /אין הבדלים/.test(t));
  await A.page.evaluate(() => { document.querySelector('[data-f=posSaSet] [name=st]').value = 'susp'; });
  await A.page.click('[data-f=posSaSet] button'); await sleep(700);
  const ss = A.calls.filter((c) => c.fn === 'posCfgSet');
  check('5ג השעיה – posCfgSet עם sa.st בלבד (נשלח bizId של העסק)', ss.length === 1 && JSON.stringify(ss[0].b.set) === JSON.stringify({ 'sa.st': 'susp' }) && ss[0].b.bizId === 'biz-p', ss);
  check('5ד בלי גלישה ב-360px, אין שגיאות JS', (await wide(A.page)) && !A.errs.length, A.errs);
  await A.ctx.close();

  await browser.close();
  if (out) fs.writeFileSync(out, JSON.stringify(res, null, 1));
  console.log(fail ? `נכשלו ${fail} מתוך ${res.length}` : `כל ${res.length} הבדיקות עברו`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
