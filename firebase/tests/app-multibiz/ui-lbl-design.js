'use strict';
// מדבקות שלב 2, סבבים 4–5 (24.11.2026, lbl-design.js) – עורך התבניות מול רשת מדומה. נתונים מומצאים (דוגמה).
// שימוש: node ui-lbl-design.js <www-dir> [out.json] [shots-dir]
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const out = {}; let fail = 0;
const check = (name, ok, info) => { out[name] = { ok: !!ok, info }; if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const F = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
const S = (v) => ({ stringValue: v }), N = (v) => (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }), M = (o) => ({ mapValue: { fields: o } }), B = (v) => ({ booleanValue: v });
const PFX = 'projects/demo-largpeami/databases/(default)/documents/b/biz-o/';
const P = (id, name, price, bc) => ({ document: { name: PFX + 'prod/' + id, fields: { name: S(name), price: N(price), barcode: S(bc || ''), on: B(true), q: M({ _: N(5) }) } } });
const PRODS = [P('p1', 'לחם (דוגמה)', 6.5, '7290000000015'), P('p2', 'עוגת שמרים שוקולד גדולה במיוחד עם אגוזים ופקאן (דוגמה)', 34.9, '5901234123457'), P('p3', 'מארז כוסות (דוגמה)', 129.9, ''), P('p4', 'מפיות (דוגמה)', 9.9, '96385074')];
const PX = 300 / 25.4;

async function open(browser, www, who, opt) {
  opt = opt || {};
  const biz = opt.biz || 'biz-o', pre = biz === 'biz-o' ? 'b/biz-o/' : '';
  const cfg = { mode: 'new', users: { m: biz, w: biz }, biz: { [biz]: { dataRoot: biz === 'biz-o' ? 'b' : 'legacy', features: F, name: 'עסק בדיקה' } }, admins: { [pre + '|m']: 1 }, staff: { [pre + '|w']: { perms: { lbl: true } } }, ctx: { deviceScaleFactor: 1 } };
  const log = [], ST = opt.st;
  const { ctx, page } = await H.newPage(browser, www, cfg, log, 'lbld' + who + biz);
  page.on('pageerror', (e) => log.push('pageerror: ' + e.message));
  await ctx.route(/:8080\/.*/, async (route) => {
    const req = route.request(), u = new URL(req.url()), m = req.method();
    const J = (b, st) => route.fulfill({ status: st || 200, contentType: 'application/json', body: JSON.stringify(b) });
    const NF = () => J({ error: { code: 404, message: 'NOT_FOUND' } }, 404);
    if (/:runQuery$/.test(u.pathname)) { let c = ''; try { c = JSON.parse(req.postData()).structuredQuery.from[0].collectionId; } catch (e) { /* */ }
      return J(c === 'lblt' ? Object.entries(ST.docs).map(([id, f]) => ({ document: { name: PFX + 'lblt/' + id, fields: f } })) : c === 'prod' ? ST.prods : []); }
    if (/\/ordcfg\/main$/.test(u.pathname)) return NF();
    if (/\/cfg\/lbl$/.test(u.pathname) && m === 'GET') return NF();
    let x = /\/lblt\/([^/]+)$/.exec(u.pathname);
    if (x) { const id = x[1];
      if (m === 'GET') return ST.docs[id] ? J({ name: PFX + 'lblt/' + id, fields: ST.docs[id] }) : NF();
      if (m === 'PATCH') { const f = JSON.parse(req.postData()).fields; ST.patches.push({ url: u.href, id, f, deny: ST.deny }); if (ST.deny) return J({ error: { code: ST.deny, message: 'PERMISSION_DENIED' } }, ST.deny);
        ST.docs[id] = f; return J({ name: PFX + 'lblt/' + id, fields: f }); } }
    if (/\/lbls\/main$/.test(u.pathname)) {
      if (m === 'GET') return ST.lbls ? J({ name: PFX + 'lbls/main', fields: ST.lbls }) : NF();
      if (m === 'PATCH') { const f = JSON.parse(req.postData()).fields; ST.patches.push({ url: u.href, id: 'lbls', f }); ST.lbls = f; return J({ name: PFX + 'lbls/main', fields: f }); } }
    return route.fallback();
  });
  await page.addInitScript(() => { window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; }; });
  await H.login(page, who + '@x.co');
  await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden && ACT.startBlank) ACT.startBlank(); });
  await page.setViewportSize({ width: 360, height: 740 });
  return { ctx, page, log };
}
const mask = (p) => (p && p.url ? new URL(p.url).searchParams.getAll('updateMask.fieldPaths').sort() : []);

(async () => {
  const [www, outFile, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const browser = await H.launch();
  const mainT = (page) => page.evaluate(() => document.getElementById('main').innerText);
  const dlgT = (page) => page.evaluate(() => { const d = document.getElementById('dlg'); return d && d.open ? d.innerText : ''; });
  const toasts = (page) => page.evaluate(() => [...document.querySelectorAll('.toast')].map((e) => e.textContent).join(' | '));
  const yes = async (page) => { await page.click('#dlg [data-a=yes]'); await H.settle(page, 700); };
  const D = (page) => page.evaluate(() => JSON.parse(JSON.stringify(LblDesign.E.D)));
  const el = async (page, id) => (await D(page)).T.els.find((e) => e.id === id);
  // מרכז / פינה של רכיב בפיקסלים של המסך (לפי גודל הקנבס המוצג)
  const scr = (page, id, corner) => page.evaluate(([id, corner]) => { const c = document.getElementById('lblDC'), r = c.getBoundingClientRect(), k = r.width / c.width, e = LblDesign.E.D.T.els.find((x) => x.id === id);
    const x = corner ? e.x + e.w : e.x + e.w / 2, y = corner ? e.y + e.h : e.y + e.h / 2; return { x: r.left + x * k, y: r.top + y * k, k }; }, [id, corner]);
  const drag = async (page, a, dx, dy) => { await page.mouse.move(a.x, a.y); await page.mouse.down(); for (let i = 1; i <= 5; i++) await page.mouse.move(a.x + dx * i / 5, a.y + dy * i / 5); await page.mouse.up(); await H.settle(page, 400); };

  // ---------- e: עובד עם הרשאת מדבקות – עורך, גרירה, שמירה ----------
  { const ST = { docs: {}, prods: PRODS, lbls: null, deny: 0, patches: [] };
    const { ctx, page, log } = await open(browser, www, 'w', { st: ST });
    // 25.11.2026 (PR #231): "עיצוב תבניות" עבר ממסך ההדפסה למסך "הגדרות" של המדבקות (lblS) – נכנסים דרך כפתור "הגדרות"
    await page.evaluate(() => go('lbl')); await H.settle(page, 1500); await page.click('#main [data-a=go][data-v=lblS]'); await H.settle(page, 800);
    const b0 = await page.evaluate(() => !!document.querySelector('#main [data-a=go][data-v=lblD]'));
    await page.click('#main [data-a=go][data-v=lblD]'); await H.settle(page, 1200);
    const l0 = await page.evaluate(() => ({ v: cur().v, ed: document.querySelectorAll('#main [data-a=lblDEd]').length, t: document.getElementById('main').innerText }));
    check('e 1 עובד עם הרשאת מדבקות: כפתור "עיצוב תבניות" במסך ההגדרות של המדבקות, רשימה עם 5 התבניות המקוריות', b0 && l0.v === 'lblD' && l0.ed === 5 && /ברקוד ומחיר/.test(l0.t) && /מחיר ליחידה/.test(l0.t), { b0, v: l0.v, ed: l0.ed });
    await page.click('#main [data-a=lblDNew]'); await H.settle(page, 300);
    const nd = await page.evaluate(() => [...document.querySelectorAll('#dlg select[name=from] option')].map((o) => o.value));
    await page.fill('#dlg [name=name]', 'מבצע שבועי'); await page.selectOption('#dlg [name=from]', '0'); await page.click('#dlg button:not([type=button])'); await H.settle(page, 800);
    check('e 2 תבנית חדשה (ריקה) נפתחת בעורך; בעסק שאינו לארג\' פעמי – אין "חותמת גדולה"', (await page.evaluate(() => cur().v)) === 'lblDE' && !nd.includes('lp') && nd.length === 6 && (await D(page)).T.els.length === 0, nd);
    await page.selectOption('#main [data-c=lblDAdd]', 'name'); await H.settle(page, 400);
    await page.selectOption('#main [data-c=lblDAdd]', 'bc'); await H.settle(page, 400);
    const d1 = await D(page);
    check('e 3 הוספת רכיבים (שם, ברקוד): נוספו, האחרון נבחר, חלונית מאפיינים מתאימה', d1.T.els.length === 2 && d1.sel === 'bc1' && /ספרות מתחת לברקוד/.test(await page.evaluate(() => document.getElementById('lblDProps').innerText)), { n: d1.T.els.length, sel: d1.sel });
    // גרירה עם רשת 1 מ"מ
    await page.selectOption('#main [data-c=lblDSnap]', '1');
    const n0 = await el(page, 'name1'), a = await scr(page, 'name1');
    await drag(page, a, -37, 23);
    const n1 = await el(page, 'name1'), d2 = await D(page);
    const onGrid = (v) => Math.abs(v / PX - Math.round(v / PX)) < 0.02;
    check('e 4 גרירה באצבע (pointer events) עם הצמדה לרשת 1 מ"מ: הרכיב זז ונבחר, X/Y על הרשת', d2.sel === 'name1' && n1.x < n0.x - 30 && n1.y > n0.y + 20 && onGrid(n1.x) && onGrid(n1.y) && n1.w === n0.w, { n0: [n0.x, n0.y], n1: [n1.x, n1.y], k: a.k });
    const c0 = await scr(page, 'name1', 1);
    await drag(page, c0, -40, 12);
    const n2 = await el(page, 'name1');
    check('e 5 שינוי גודל מהידית בפינה: רוחב קטן, גובה גדל, הקצה על הרשת', n2.w < n1.w - 30 && n2.h > n1.h + 5 && n2.x === n1.x && onGrid(n2.x + n2.w) && onGrid(n2.y + n2.h), { n1: [n1.w, n1.h], n2: [n2.w, n2.h] });
    await page.click('#main [data-a=lblDUndo]'); await H.settle(page, 300);
    const u1 = await el(page, 'name1');
    await page.click('#main [data-a=lblDUndo]'); await H.settle(page, 300);
    const u2 = await el(page, 'name1');
    await page.click('#main [data-a=lblDRedo]'); await H.settle(page, 300); await page.click('#main [data-a=lblDRedo]'); await H.settle(page, 300);
    const u3 = await el(page, 'name1');
    check('e 6 ביטול/חזרה: ביטול שינוי הגודל, ביטול הגרירה, ושתי חזרות מחזירות למצב האחרון', u1.w === n1.w && u1.x === n1.x && u2.x === n0.x && u2.y === n0.y && u3.w === n2.w && u3.x === n2.x, { u1: [u1.x, u1.w], u2: [u2.x, u2.y], u3: [u3.x, u3.w] });
    // חצים: מקלדת וכפתורים
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press('ArrowRight'); await H.settle(page, 200);
    await page.click('#main [data-a=lblDNudge][data-d=d]'); await H.settle(page, 200);
    const nn = await el(page, 'name1');
    check('e 7 הזזה בחצים (מקלדת + כפתור) בצעד של הרשת', Math.abs(nn.x - (u3.x + PX)) < 0.6 && Math.abs(nn.y - (u3.y + PX)) < 0.6, { from: [u3.x, u3.y], to: [nn.x, nn.y] });
    // מאפיינים: עובי מודגש מאוד, מטבע, שם ארוך
    await page.click('#main [data-a=lblDSel][data-id=name1]'); await H.settle(page, 300);
    await page.selectOption('#lblDProps [data-k=fw]', '800'); await H.settle(page, 300);
    await page.selectOption('#lblDProps [data-k=fit]', 'wrap2'); await H.settle(page, 300);
    await page.selectOption('#main [data-c=lblDAdd]', 'price'); await H.settle(page, 400);
    await page.selectOption('#lblDProps [data-k=cur]', 'ils'); await H.settle(page, 300);
    await page.selectOption('#lblDProps [data-k=if]', 'bc'); await H.settle(page, 300);
    const pp = await D(page), nm1 = pp.T.els.find((e) => e.id === 'name1'), pr1 = pp.T.els.find((e) => e.id === 'price1');
    check('e 8 חלונית מאפיינים: מודגש מאוד (800), 2 שורות, מטבע ₪, תנאי הצגה "רק כשיש ברקוד"', nm1.fw === 800 && nm1.fit === 'wrap2' && pr1.cur === 'ils' && pr1.if === 'bc', { nm1, pr1 });
    // תצוגה מדויקת + 3 מוצרים + אזהרות
    await page.click('#main [data-a=lblDSel][data-id=bc1]'); await H.settle(page, 300);
    await page.fill('#lblDProps [data-k=h][data-mm]', '3'); await page.dispatchEvent('#lblDProps [data-k=h][data-mm]', 'change'); await H.settle(page, 500);
    const pv = await page.evaluate(() => { const C = [...document.querySelectorAll('#main canvas[data-lbld-p]')]; let bad = 0, blk = 0;
      for (const c of C) { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 0; i < d.length; i += 4) { if (d[i] !== d[i + 1] || d[i] !== d[i + 2] || (d[i] !== 0 && d[i] !== 255)) bad++; if (d[i] === 0) blk++; } }
      return { n: C.length, bad, blk, cap: [...document.querySelectorAll('#main canvas[data-lbld-p]')].map((c) => c.previousElementSibling.innerText), w: document.getElementById('lblDWarn').innerText, t: document.getElementById('main').innerText }; });
    check('e 9 תצוגה עם 3 מוצרים אמיתיים: השם הקצר, הארוך והמחיר הגבוה; שחור-לבן בלבד (בלי גווני אפור); בלי "(דוגמה)" כשיש מלאי',
      pv.n === 3 && /הקצר.*לחם/.test(pv.cap[0]) && /הארוך.*עוגת שמרים/.test(pv.cap[1]) && /הגבוה.*מארז כוסות/.test(pv.cap[2]) && pv.bad === 0 && pv.blk > 500 && !/אין מוצרים במלאי/.test(pv.t), { cap: pv.cap, bad: pv.bad, blk: pv.blk });
    check('e 10 אזהרה ליד הקנבס: ברקוד נמוך מ-5 מ"מ (לא חוסם)', /הברקוד נמוך מדי/.test(pv.w) && /אזהרות בלבד/.test(pv.w), pv.w);
    // שמירה
    const tid = (await D(page)).T.id; const k0 = ST.patches.length;
    await page.click('#main [data-a=lblDSave]'); await H.settle(page, 800);
    const sp = ST.patches.slice(k0).find((x) => x.id === tid), sv = await D(page);
    const J0 = sp && JSON.parse(sp.f.j.stringValue);
    check('e 11 שמירה: PATCH ל-lblt/<id> עם 9 השדות ב-updateMask, v=1, שם, 50×25, j עם 3 רכיבים, by = העובד; "נשמר"',
      sp && JSON.stringify(mask(sp)) === '["at","base","by","del","h","j","name","v","w"]' && sp.f.v.integerValue === '1' && sp.f.name.stringValue === 'מבצע שבועי' && sp.f.w.doubleValue === 50 && sp.f.h.doubleValue === 25 && J0.els.length === 3 && sp.f.by.stringValue === 'w' && !sv.dirty && sv.st === 'ok' && /נשמר/.test(await mainT(page)),
      sp ? { mask: mask(sp), name: sp.f.name, els: J0.els.length, by: sp.f.by } : null);
    // גרסה חדשה יותר בענן → שאלה לפני דריסה
    ST.docs[tid] = Object.assign({}, ST.docs[tid], { at: N(Date.now() + 60000), name: S('שונה בטלפון אחר') });
    await page.click('#main [data-a=lblDNudge][data-d=r]'); await H.settle(page, 200);
    const k1 = ST.patches.length; await page.click('#main [data-a=lblDSave]'); await H.settle(page, 600);
    const askT = await dlgT(page), k2 = ST.patches.length;
    await yes(page);
    check('e 12 בענן גרסה חדשה יותר (at): שאלה לפני דריסה; אחרי אישור – נשמר', /עודכנה במכשיר אחר/.test(askT) && k2 === k1 && ST.patches.length === k1 + 1, askT);
    // 403 → במכשיר בלבד
    ST.deny = 403; await page.click('#main [data-a=lblDNudge][data-d=r]'); await H.settle(page, 200);
    await page.click('#main [data-a=lblDSave]'); await H.settle(page, 800);
    const t403 = await mainT(page), q = await page.evaluate(() => (JSON.parse(localStorage.getItem('lp-lbl-tpl-biz-o') || '{}').q || []).length);
    check('e 13 403: "נשמר במכשיר בלבד", התבנית בתור לשליחה חוזרת', /נשמר במכשיר בלבד/.test(t403) && q === 1 && (await D(page)).st === 'dev', { q });
    ST.deny = 0;
    // הדפסת ניסיון
    await page.evaluate(() => { window.__opened = []; }); await page.click('#main [data-a=lblDTest]'); await H.settle(page, 2000);
    const tp = await page.evaluate(async () => { const u = window.__opened.pop(); if (!u) return null; const s = new TextDecoder('latin1').decode(new Uint8Array(await (await fetch(u)).arrayBuffer())); return { n: +(s.match(/\/Type \/Pages \/Count (\d+)/) || [])[1], box: (s.match(/\/MediaBox \[([^\]]+)\]/) || [])[1] }; });
    check('e 14 הדפסת ניסיון: PDF של עמוד אחד, 50×25 מ"מ', tp && tp.n === 1 && tp.box === '0 0 141.73 70.87', tp);
    // הגדלה ×2 עם גלילה
    await page.click('#main [data-a=lblDZoom]'); await H.settle(page, 400);
    const zm = await page.evaluate(() => { const w = document.getElementById('lblDW'), c = document.getElementById('lblDC'); return { cw: c.getBoundingClientRect().width, ww: w.clientWidth, sc: w.scrollWidth > w.clientWidth }; });
    check('e 15 הגדלה ×2: הקנבס כפול מהמסגרת, עם גלילה', Math.abs(zm.cw - 2 * zm.ww) < 4 && zm.sc, zm);
    await page.click('#main [data-a=lblDZoom]'); await H.settle(page, 300);
    // רשימה: שכפול, מחיקה רכה, שחזור; תבנית מקורית ערוכה + "שחזר למקור"
    await page.evaluate(() => goBack()); await H.settle(page, 800);
    const k3 = ST.patches.length;
    await page.click(`#main [data-a=lblDDup][data-k="${tid}"]`); await H.settle(page, 800);
    const dp = ST.patches.slice(k3).find((x) => x.id !== tid);
    check('e 16 שכפול: תבנית חדשה (מזהה אחר) "עותק של …" עם אותם רכיבים, מופיעה ברשימה', dp && /^u[a-z0-9]{10}$/.test(dp.id) && dp.f.name.stringValue === 'עותק של מבצע שבועי' && JSON.parse(dp.f.j.stringValue).els.length === 3 && !dp.f.base && /עותק של מבצע שבועי/.test(await mainT(page)), dp && { id: dp.id, name: dp.f.name });
    await page.click(`#main [data-a=lblDDel][data-k="${dp.id}"]`); await H.settle(page, 300); await yes(page);
    const dl = ST.patches[ST.patches.length - 1], ldel = await page.evaluate(() => { const d = document.querySelector('#main details'); return d ? d.innerText : ''; });
    check('e 17 מחיקה רכה: PATCH עם del:true (לא DELETE), התבנית ב"תבניות שנמחקו"', dl.id === dp.id && dl.f.del && dl.f.del.booleanValue === true && /שנמחקו \(1\)/.test(ldel), { del: dl.f.del, ldel: ldel.slice(0, 60) });
    await page.evaluate(() => { document.querySelector('#main details').open = true; }); await page.click(`#main [data-a=lblDUndel][data-k="${dp.id}"]`); await H.settle(page, 800);
    const ud = ST.patches[ST.patches.length - 1];
    check('e 18 שחזור תבנית שנמחקה: נשמרת בלי del', ud.id === dp.id && !ud.f.del && JSON.stringify(mask(ud)).includes('"del"') && !(await page.evaluate(() => !!document.querySelector('#main details'))), { del: ud.f.del });
    await page.click('#main [data-a=lblDEd][data-k=b3]'); await H.settle(page, 800);
    const b3 = await D(page); const pid = b3.T.els.find((e) => e.t === 'price').id;
    await page.click(`#main [data-a=lblDSel][data-id=${pid}]`); await H.settle(page, 300);
    await page.click('#main [data-a=lblDNudge][data-d=u]'); await H.settle(page, 200);
    await page.click('#main [data-a=lblDSave]'); await H.settle(page, 800);
    const s3 = ST.patches[ST.patches.length - 1];
    await page.evaluate(() => goBack()); await H.settle(page, 800);
    const l3 = await page.evaluate(() => ({ t: document.getElementById('main').innerText, o: !!document.querySelector('#main [data-a=lblDOrig][data-k=b3]') }));
    check('e 19 עריכת תבנית 3 המקורית: נשמרת כ-lblt/b3 עם base 3, מסומנת "ערוכה" ויש "שחזר למקור"', s3.id === 'b3' && s3.f.base && s3.f.base.integerValue === '3' && l3.o && /ערוכה/.test(l3.t), { id: s3.id, base: s3.f.base });
    const tl = await page.evaluate(() => LblPrint.tList().find((x) => x.r === 3).T);
    await page.click('#main [data-a=lblDOrig][data-k=b3]'); await H.settle(page, 300); await yes(page);
    const o3 = ST.patches[ST.patches.length - 1], tl2 = await page.evaluate(() => LblPrint.tList().find((x) => x.r === 3).T);
    check('e 20 "שחזר למקור": lblt/b3 מסומנת del:true, ובמסך ההדפסה תבנית 3 חוזרת למקורית (draw)', o3.id === 'b3' && o3.f.del && o3.f.del.booleanValue && tl && tl2 === null && !(await page.evaluate(() => !!document.querySelector('#main [data-a=lblDOrig]'))), { o3: o3.id });
    // מסך גדלים וברירת מחדל (עובד)
    await page.click('#main [data-a=go][data-v=lblDS]'); await H.settle(page, 800);
    await page.fill('#main [data-f=lblDSz] [name=w]', '40'); await page.fill('#main [data-f=lblDSz] [name=h]', '30'); await page.click('#main [data-f=lblDSz] button'); await H.settle(page, 300);
    await page.selectOption('#main [data-c=lblDDef]', tid); await page.click('#main [data-a=lblDSSave]'); await H.settle(page, 800);
    const ls = ST.patches[ST.patches.length - 1];
    check('e 21 גדלים וברירת מחדל (עובד): PATCH ל-lbls/main עם sz [40×30] ו-def', ls.id === 'lbls' && JSON.stringify(mask(ls)) === '["at","by","def","sz"]' && ls.f.sz.arrayValue.values.length === 1 && ls.f.sz.arrayValue.values[0].mapValue.fields.w.doubleValue === 40 && ls.f.def.stringValue === tid, ls.f);
    await page.click('#main [data-a=lblDNew]'); await H.settle(page, 300);
    const so = await page.evaluate(() => [...document.querySelectorAll('#dlg select[name=sz] option')].map((o) => o.innerText));
    await page.evaluate(() => closeDlg());
    check('e 22 הגודל החדש מוצג ביצירת תבנית, ברוחב×גובה (40×30)', so.length === 2 && /50×25/.test(so[0]) && /40×30/.test(so[1]), so);
    await page.evaluate(() => go('lbl')); await H.settle(page, 1500);
    const hint = await page.evaluate(() => { document.querySelector('#main [data-a=lblX]'); return LblPrint.tList().length; });
    const errs = log.filter((x) => /pageerror|TypeError|ReferenceError/.test(x));
    check('e 99 בלי שגיאות JS', errs.length === 0 && hint >= 6, errs.slice(0, 3));
    await ctx.close(); }

  // ---------- n: בלי מלאי – מוצרי דוגמה מסומנים ----------
  { const ST = { docs: {}, prods: [], lbls: null, deny: 0, patches: [] };
    const { ctx, page, log } = await open(browser, www, 'w', { st: ST });
    await page.evaluate(() => go('lblD')); await H.settle(page, 1500);
    await page.click('#main [data-a=lblDEd][data-k=b1]'); await H.settle(page, 1000);
    const t = await page.evaluate(() => ({ t: document.getElementById('main').innerText, n: document.querySelectorAll('#main canvas[data-lbld-p]').length }));
    check('n 1 אין מוצרים במלאי: 3 מוצרי דוגמה, מסומנים "(דוגמה)"', t.n === 3 && /\(דוגמה\) – אין מוצרים במלאי/.test(t.t), t.t.slice(0, 200));
    const errs = log.filter((x) => /pageerror|TypeError|ReferenceError/.test(x));
    check('n 99 בלי שגיאות JS', errs.length === 0, errs.slice(0, 3));
    await ctx.close(); }

  // ---------- p: לארג' פעמי – "חותמת גדולה" ----------
  { const ST = { docs: {}, prods: PRODS, lbls: null, deny: 0, patches: [] };
    const { ctx, page, log } = await open(browser, www, 'w', { biz: 'largpeami', st: ST });
    await page.evaluate(() => go('lbl')); await H.settle(page, 1500);
    await page.evaluate(() => go('lblD')); await H.settle(page, 1000);
    await page.click('#main [data-a=lblDNew]'); await H.settle(page, 300);
    const nd = await page.evaluate(() => ({ v: [...document.querySelectorAll('#dlg select[name=from] option')].map((o) => o.value), s: document.querySelector('#dlg select[name=from]').value }));
    await page.fill('#dlg [name=name]', 'חותמת גדולה'); await page.click('#dlg button:not([type=button])'); await H.settle(page, 1500);
    const d = await D(page), st = d.T.els.find((e) => e.t === 'stamp'), nm = d.T.els.find((e) => e.t === 'name');
    const br = await page.evaluate(() => { const b = LblPrint.brand(); return b && b.stamp ? b.stamp.slice(0, 22) : ''; });
    check('p 1 לארג\' פעמי: "חותמת גדולה" מוצעת (ונבחרת) ביצירת תבנית; 50×25, חותמת ~146 פיקסלים (בערך כפולה) לצד השם, לוגו וחותמת כרכיבים',
      nd.v[0] === 'lp' && nd.s === 'lp' && d.T.w === 50 && d.T.h === 25 && d.T.brand === 'el' && st && st.h >= 120 && st.x + st.w < nm.x && br === 'data:image/png;base64,', { nd, st, br });
    await page.click('#main [data-a=lblDSave]'); await H.settle(page, 800);
    const ws = await page.evaluate(() => document.getElementById('lblDWarn').innerText);
    check('p 2 התבנית נשמרת, בלי אזהרות', ST.patches.length === 1 && /אין אזהרות/.test(ws), ws);
    if (shots) { await page.click('#main [data-a=lblDSel][data-id=n]'); await H.settle(page, 600); await page.evaluate(() => window.scrollTo(0, 0)); await H.settle(page, 300); await page.screenshot({ path: path.join(shots, 'editor-360.png') }); }
    if (shots) { const c = page.locator('#main canvas[data-lbld-p="0"]'); await c.scrollIntoViewIfNeeded(); await H.settle(page, 300);
      // תמונת המדבקה עצמה (591×295, שחור-לבן) – מהקנבס של התצוגה המדויקת
      const u = await page.evaluate(() => document.querySelector('#main canvas[data-lbld-p="1"]').toDataURL('image/png'));
      fs.writeFileSync(path.join(shots, 'big-stamp-bw.png'), Buffer.from(u.split(',')[1], 'base64')); }
    const errs = log.filter((x) => /pageerror|TypeError|ReferenceError/.test(x));
    check('p 99 בלי שגיאות JS', errs.length === 0, errs.slice(0, 3));
    await ctx.close(); }

  await browser.close();
  if (outFile) fs.writeFileSync(outFile, JSON.stringify({ out }, null, 1));
  console.log(fail ? `תוצאה: נכשל (${fail})` : 'תוצאה: הכול עבר'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
