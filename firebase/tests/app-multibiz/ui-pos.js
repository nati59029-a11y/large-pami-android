'use strict';
// קופה שלב 0 (17.11.2026): pos-base.js בדפדפן, רשת מדומה. בדיקה 6 בתוכנית – מתג כבוי = אין שינוי במסכים קיימים:
//   כבוי (עסק b) ועסק legacy (לארג' פעמי בשורש, גם כשהמתג "דלוק" במסמך): אין אריח, מסך "הוספה" זהה לגמרי למסך בלי pos-base.js,
//   V.pos / V.posAdm לא נפתחים, אין שום קריאה לפונקציות pos* ולאוספי pos*.
//   דלוק: מנהל עם pos (מנהל־על הדליק, 18.11.2026) – "קופה" + "ניהול קופה"; מנהל בלי pos – "ניהול קופה" בלבד; עובד עם pos – "קופה" בלבד;
//   עובד בלי pos – כלום. מסך הניהול מציג הגדרות לפי posCfg.
//   מתגי pos / posMgr ב-PMK ו-pos ב-ADM_FT. אין שגיאות JS. שימוש: node ui-pos.js <www-dir> [out.json]
const fs = require('fs'); const H = require('./harness');
let fail = 0; const res = [];
const check = (n, ok, info) => { if (!ok) fail++; res.push({ n, ok: !!ok, info }); console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W0 = { incR: false, incW: true, expR: true, expW: true, sup: true, sal: false, rep: false, ord: true, trf: false, bal: false, ordP: false, prc: false, s3m: false, pos: false, posMgr: false };
// POS:M4 (ש4): posCfg מחזיר את ההגדרות בפועל לפי pos-cfg-schema.js (313 מפתחות), עם התפקיד והנעילות
const SC = require('../../functions/lib/pos-cfg-schema');
const E0 = SC.eff({ sa: { on: true, st: 'trial', type: 'bakeryDisposable' } });
const CFG = { ok: true, role: 'mgr', ver: 1, cfg: E0.cfg, src: E0.src, off: E0.off, mods: E0.mods, on: true, st: 'trial', type: 'bakeryDisposable', upd: null, sa: { lock: [], who: {}, opened: true } };

async function open(browser, www, cfg, email, perms) {
  const log = [];
  const { ctx, page } = await H.newPage(browser, www, cfg, log, email);
  const errs = []; page.on('pageerror', (e) => errs.push(String(e && e.message || e)));
  await page.setViewportSize({ width: 360, height: 760 });
  const calls = [];
  await ctx.route('**/pos*', (route) => { const u = new URL(route.request().url()); if (u.port === '5001') { let b = {}; try { b = JSON.parse(route.request().postData()).data || {}; } catch (e) { /* */ } calls.push({ fn: u.pathname.split('/').pop(), b });
    const r = /posCfgSet$/.test(u.pathname) ? { ok: true, ver: 2, cfg: Object.assign({}, CFG.cfg, b.set), src: {}, off: {}, changes: Object.keys(b.set || {}) } : /posCfg$/.test(u.pathname) ? CFG : { ok: true, dev: 'K1' };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: r }) }); } return route.fallback(); });
  await ctx.route((u) => u.port === '8080' && /\/documents\/b\/biz-p\/posdev$/.test(u.pathname), (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })); // אוסף ריק
  const uid = email.split('@')[0];
  if (perms) await ctx.route((u) => u.port === '8080' && new RegExp('/staff/' + uid + '$').test(u.pathname), (route) => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ name: 'x', fields: { active: { booleanValue: true }, perms: { mapValue: { fields: Object.fromEntries(Object.entries(perms).map(([k, v]) => [k, { booleanValue: v }])) } } } }) }));
  await H.login(page, email);
  await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden && ACT.startBlank) ACT.startBlank(); });
  await H.settle(page, 600);
  return { ctx, page, log, errs, calls };
}
// מסך "הוספה" – ה-HTML שלו, עם ובלי posTile (כמו בלי הקובץ)
const sheetHtml = (page) => page.evaluate(() => { const S = () => { openAdd(); return document.getElementById("sheet").innerHTML; }; const a = S(); const t = window.posTile; window.posTile = undefined; const b = S(); window.posTile = t; sheetClose(); return { a, b, tile: typeof t === 'function' ? t() : null, hasPos: /data-v="pos/.test(a) }; });

(async () => {
  const [www, out] = process.argv.slice(2);
  const browser = await H.launch();
  const cB = (feat, adm) => ({ mode: 'new', users: { m: 'biz-p', w: 'biz-p', wn: 'biz-p' }, biz: { 'biz-p': { dataRoot: 'b', features: feat, name: 'עסק קופה' } }, admins: { 'b/biz-p/|m': adm || { perms: { pos: true, posMgr: true } } }, staff: { 'b/biz-p/|w': 1, 'b/biz-p/|wn': 1 } });
  const BZ0 = ['larg', 'peami'].join('');

  // ---- 1. מתג כבוי, עסק b, מנהל ----
  let A = await open(browser, www, cB({ tasks: true, orders: true }), 'm@x.co');
  let s = await sheetHtml(A.page);
  check('1 מתג כבוי: אין אריח קופה, ומסך "הוספה" זהה לגמרי למסך בלי pos-base.js', s.tile === '' && !s.hasPos && s.a === s.b, { tile: s.tile, hasPos: s.hasPos, same: s.a === s.b });
  let v = await A.page.evaluate(() => [V.pos().h, V.posAdm().h]);
  check('1א מתג כבוי: V.pos / V.posAdm – "התכונה לא פעילה"', v.every((h) => /לא פעילה/.test(h)), v);
  let reqs = A.log.filter((r) => /\/pos[A-Za-z_]*($|[/?])|\/documents\/b\/biz-p\/pos/.test(new URL(r.url).pathname));
  check('1ב מתג כבוי: אין שום בקשה לפונקציות או לאוספי הקופה', !reqs.length && !A.calls.length, reqs.map((r) => r.url));
  const pmk = await A.page.evaluate(() => ({ pmk: PMK.filter(([k]) => k === 'pos' || k === 'posMgr').map(([k, t]) => k + ':' + t), ft: ADM_FT.filter(([k]) => k === 'pos').length, pmd: !!PMD.pos }));
  check('1ג מתגי pos ו-posMgr ב-PMK (לא בברירת המחדל), pos ב-ADM_FT', pmk.pmk.length === 2 && pmk.ft === 1 && !pmk.pmd, pmk);
  check('1ד אין שגיאות JS', !A.errs.length, A.errs);
  await A.ctx.close();

  // ---- 2. לארג' פעמי במצב legacy (השורש), גם כשהמתג במסמך – כבוי ----
  A = await open(browser, www, { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: { tasks: true, pos: true } } }, admins: { '|m': 1 }, staff: { '|w': 1 } }, 'm@x.co');
  s = await sheetHtml(A.page);
  check('2 עסק legacy: אין אריח קופה, מסך "הוספה" זהה', s.tile === '' && !s.hasPos && s.a === s.b, { tile: s.tile, same: s.a === s.b });
  check('2א עסק legacy: אין קריאות pos*', !A.calls.length, A.calls);
  await A.ctx.close();

  // ---- 3. מתג דלוק: מנהל ----
  A = await open(browser, www, cB({ tasks: true, orders: true, pos: true }), 'm@x.co');
  s = await sheetHtml(A.page);
  let t; v = await A.page.evaluate(() => V.posHub().h);
  check('3 מתג דלוק, מנהל: במסך "הוספה" אריח אחד "קופה" (posHub); בתוכו "מכירה" ו"ניהול קופה"', /data-v="posHub"/.test(s.a) && !/data-v="posAdm"/.test(s.a) && (s.a.match(/data-v="pos[A-Za-z]*"/g) || []).length === 1 && /קופה/.test(s.tile) && /data-a="go" data-v="pos"/.test(v) && /data-v="posAdm"/.test(v) && /מכירה/.test(v), { tile: s.tile, hub: v });
  await A.page.evaluate(() => go('posHub')); await sleep(400);
  t = await A.page.evaluate(() => ({ v: cur().v, sw: document.documentElement.scrollWidth, W: document.documentElement.clientWidth }));
  check('3-hub מסך "קופה" נפתח, בלי גלישה ב-360px', t.v === 'posHub' && t.sw <= t.W, t);
  if (process.argv[4]) { fs.mkdirSync(process.argv[4], { recursive: true }); await A.page.screenshot({ path: process.argv[4] + '/pos-hub.png' }); }
  await A.page.evaluate(() => go('posAdm')); await sleep(1500);
  t = await A.page.evaluate(() => ({ v: cur().v, h: document.getElementById('main').innerText.replace(/\s+/g, ' ') }));
  check('3א ניהול קופה (ש4): קופות, הוספת קופה, חיפוש ומדורי ההגדרות לפי הסכמה, בלי טופס ההגדרות הישן', t.v === 'posAdm' && /אין קופות עדיין/.test(t.h) && /הוספת קופה/.test(t.h) && /חיפוש בהגדרות/.test(t.h) && /החזרות/.test(t.h) && /מס ומסמכים/.test(t.h) && !/pc_vatRate/.test(await A.page.content()), t.h.slice(0, 300));
  await A.page.evaluate(() => go('posCfgSec', 'tax')); await sleep(400);
  let dis = await A.page.evaluate(() => ({ vat: document.querySelector('[name=pa_vatRate]').disabled, lock: /רק בעל העסק/.test(document.getElementById('main').innerText) }));
  check('3ב מדור מס: מע"מ (בעל העסק) – נעול למנהל עם "רק בעל העסק"', dis.vat && dis.lock, dis);
  await A.page.evaluate(() => go('posCfgSec', 'ret')); await sleep(400);
  dis = await A.page.evaluate(() => ({ ret: document.querySelector('[name=pa_retDays]').disabled }));
  await A.page.fill('[name=pa_retDays]', '30');
  await A.page.click('[data-f=posCfgSecF] button'); await sleep(800);
  const set = A.calls.filter((c) => c.fn === 'posCfgSet');
  check('3ג מדור החזרות: retDays פתוח למנהל, ושמירה שולחת רק את מה שהשתנה (posCfgSet, set.retDays=30)', !dis.ret && set.length === 1 && JSON.stringify(set[0].b) === JSON.stringify({ set: { retDays: 30 } }), set);
  await A.page.evaluate(() => go('posAdm')); await sleep(600);
  await A.page.fill('[data-f=posDevAdd] [name=name]', 'קופה 1');
  await A.page.click('[data-f=posDevAdd] button'); await sleep(800);
  const add = A.calls.filter((c) => c.fn === 'posDev');
  check('3ד הוספת קופה – posDev op:add', add.length === 1 && add[0].b.op === 'add' && add[0].b.name === 'קופה 1', add);
  await A.page.evaluate(() => go('pos')); await sleep(1200);
  t = await A.page.evaluate(() => document.getElementById('main').innerText.replace(/\s+/g, ' '));
  check('3ה מסך הקופה: בלי הגדרות; מכשיר לא רשום – הודעה בעברית', /עוד לא רשום כקופה/.test(t) && !/הגדרות/.test(t), t.slice(0, 200));
  const o = await A.page.evaluate(() => { const W = document.documentElement.clientWidth; return { sw: document.documentElement.scrollWidth, W }; });
  check('3ו בלי גלישה ב-360px', o.sw <= o.W, o);
  check('3ז אין שגיאות JS', !A.errs.length, A.errs);
  await A.ctx.close();

  // ---- 3ח. 18.11.2026 (הכרעת בעל העסק): מנהל בלי מתג קופה – "ניהול קופה" כמו היום, בלי "קופה" ובלי מסך המכירה ----
  for (const [nm, adm] of [['בלי perms', 1], ['pos כבוי', { perms: { pos: false, posMgr: false } }]]) {
    A = await open(browser, www, cB({ tasks: true, orders: true, pos: true }, adm), 'm@x.co');
    s = await sheetHtml(A.page);
    v = await A.page.evaluate(() => ({ hub: V.posHub().h, pos: V.pos().h, adm: V.posAdm().h, wp: [wp('pos'), wp('posMgr'), wp('sal'), wp('rep')], more: V.more().h }));
    check('3ח מנהל ' + nm + ': "ניהול קופה" בלי "קופה"; מסך הקופה לא נפתח; שאר ההרשאות – כן', /data-v="posHub"/.test(s.a) && /data-v="posAdm"/.test(v.hub) && !/data-v="pos"/.test(v.hub) && !/data-v="pos"/.test(s.a) && /לא פעילה/.test(v.pos) && !/לא פעילה/.test(v.adm) && !/data-v="pos"/.test(v.more) && JSON.stringify(v.wp) === '[false,false,true,true]', { tile: s.tile, wp: v.wp });
    check('3ט מנהל ' + nm + ': אין שגיאות JS', !A.errs.length, A.errs);
    await A.ctx.close();
  }

  // ---- 4. עובד עם pos / בלי ----
  A = await open(browser, www, cB({ tasks: true, orders: true, pos: true }), 'w@x.co', Object.assign({}, W0, { pos: true }));
  s = await sheetHtml(A.page);
  let mo = await A.page.evaluate(() => V.more().h);
  let hb = await A.page.evaluate(() => V.posHub().h);
  check('4 עובד עם pos: "קופה" בראש מסך "עוד" פותח את מסך "קופה" (posHub), ובו "מכירה" בלי "ניהול קופה" (גם לא במסך "הוספה")', /data-a="go" data-v="posHub"/.test(mo) && !/posAdm/.test(mo) && !/data-v="posAdm"/.test(s.a) && /data-v="pos"/.test(hb) && !/posAdm/.test(hb), { tile: s.tile, mo: mo.slice(0, 200), hb });
  v = await A.page.evaluate(() => V.posAdm().h);
  check('4א עובד: ניהול קופה לא נפתח', /לא פעילה/.test(v), v);
  await A.ctx.close();
  A = await open(browser, www, cB({ tasks: true, orders: true, pos: true }), 'wn@x.co', W0);
  s = await sheetHtml(A.page);
  mo = await A.page.evaluate(() => V.more().h);
  check('4ב עובד בלי pos: אין כניסה לקופה – לא במסך "הוספה" ולא ב"עוד"', s.tile === '' && s.a === s.b && !/data-v="pos"/.test(mo) && !/posHub/.test(mo), s.tile);
  check('4ג אין שגיאות JS', !A.errs.length, A.errs);
  await A.ctx.close();

  await browser.close();
  if (out) fs.writeFileSync(out, JSON.stringify(res, null, 1));
  console.log(fail ? `נכשלו ${fail} מתוך ${res.length}` : `כל ${res.length} הבדיקות עברו`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
