'use strict';
// מדבקות שלב 2 (24.11.2026, lbl-tpl.js + lbl-print.js) – מול רשת מדומה. נתונים מומצאים (דוגמה).
// z: זהות בייטים – PDF מ-6 סלים קבועים × 3 מצבי לוגו (בלי / פס עליון / פינות), הקוד הנוכחי מול עותק קפוא של שלב 1
//    (fixtures/lbl-print-stage1.js), באותו דפדפן. בנוסף: SHA-256 מול fixtures/lbl-baseline.json כשגרסת הדפדפן וטביעת סביבת הציור זהות (אחרת – מידע בלבד).
// שימוש: node ui-lbl-tpl.js <www-dir> [out.json] [shots-dir]   (LBL_BASELINE_WRITE=1 – כתיבת קובץ הבסיס מחדש)
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const out = {}; let fail = 0;
const check = (name, ok, info) => { out[name] = { ok: !!ok, info }; if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const F = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
const S = (v) => ({ stringValue: v }), N = (v) => (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }), M = (o) => ({ mapValue: { fields: o } }), B = (v) => ({ booleanValue: v });
const FROZEN = fs.readFileSync(path.join(__dirname, 'fixtures', 'lbl-print-stage1.js'), 'utf8');
// 25.11.2026: בפריסת "פינות" הקופסאות רחבות יותר (124×64 במקום 64×64) – לוגו וחותמת גדולים יותר. הזהות בבייטים נבדקת מול שלב 1 עם השינוי הזה בלבד
const FROZEN_Z = (() => { const a = 'const BH=64,BX=64;', b = " if(lay==='bot')return{lay,t:null,logo:[W-6-BX,H-6-BX,BX,BX],stamp:[6,H-6-BX,BX,BX],ib:6+BX+6-14};return null}";
  if (!FROZEN.includes(a) || !FROZEN.includes(b)) throw new Error('העותק הקפוא השתנה');
  return FROZEN.replace(a, 'const BH=64,BX=64,BW=124;').replace(b, " if(lay==='bot')return{lay,t:null,logo:[W-6-BW,H-6-BX,BW,BX],stamp:[6,H-6-BX,BW,BX],ib:6+BW+6-14};return null}"); })();
const BASE_F = path.join(__dirname, 'fixtures', 'lbl-baseline.json');

// 6 סלים קבועים: כל התבניות, עם/בלי ברקוד, EAN-13 / EAN-8 / Code128 / ברקוד לא תקין, שם ארוך, מילה מודגשת, מבצע, אריזה, כמויות
const it = (o) => Object.assign({ name: 'מוצר (דוגמה)', price: '12.9', code: '', fs: 100, hl: '', pp: '', pack: '' }, o);
const BASKETS = [
  [{ tpl: 1, n: 1, it: it({ name: 'צלחות חד פעמיות 20 יח׳', code: '5901234123457' }) }, { tpl: 1, n: 2, it: it({ name: 'כוסות', price: '7' }) }, { tpl: 1, n: 1, it: it({ name: 'מפיות', code: 'ABC-123', hl: 'חדש!' }) }],
  [{ tpl: 2, n: 1, it: it({ name: 'עוגת שמרים שוקולד גדולה במיוחד עם אגוזים ופקאן', price: '34.5' }) }, { tpl: 2, n: 1, it: it({ name: 'לחם', hl: 'טרי', price: '6' }) }, { tpl: 2, n: 3, it: it({ name: 'שם', price: '99999.99', fs: 140 }) }],
  [{ tpl: 3, n: 1, it: it({ code: '5901234123457' }) }, { tpl: 3, n: 1, it: it({ name: 'בלי ברקוד ארוך מאוד מאוד מאוד מאוד', price: '0.5' }) }, { tpl: 3, n: 1, it: it({ code: 'קוד', hl: 'מבצע' }) }],
  [{ tpl: 4, n: 1, it: it({ pp: '9.9', code: '96385074' }) }, { tpl: 4, n: 2, it: it({ name: 'בלי מחיר מבצע' }) }, { tpl: 4, n: 1, it: it({ name: 'שם ארוך מאוד למבצע של סוף השבוע בחנות', pp: '100', price: '1234.56', fs: 140 }) }],
  [{ tpl: 5, n: 1, it: it({ pack: '500 גרם', code: '5901234123457' }) }, { tpl: 5, n: 1, it: it({ name: 'בלי אריזה' }) }, { tpl: 5, n: 1, it: it({ pack: '1.5 ליטר', code: '96385074', hl: 'חדש', fs: 70 }) }],
  [1, 2, 3, 4, 5].map((t, i) => ({ tpl: t, n: [1, 3, 200, 2, 1][i], it: it({ name: 'מעורב ' + t, code: t % 2 ? '7290000000017' : '', pp: t === 4 ? '5' : '', pack: t === 5 ? '1 ק"ג' : '', hl: t === 3 ? 'חם' : '', fs: 80 + t * 10 }) })),
];

// מטריצת מדבקות לבדיקת השוויון drawT ↔ draw: שמות, מחירים, ברקודים (EAN-13/8, Code128, לא תקין, בלי), מילה מודגשת, מבצע, אריזה, גודל שם
const NM = ['לחם', 'צלחות חד פעמיות 20 יח׳', 'עוגת שמרים שוקולד גדולה במיוחד עם אגוזים ופקאן וקינמון', '', 'מילהאחתארוכהמאודמאודמאודמאודמאודמאוד', 'Coca Cola 1.5L'];
const PR = ['12.9', '0', '7', '99999.99', '', '1234.5'], CD = ['5901234123457', '96385074', 'ABC-123', '', 'קוד', '7290000000017'];
const HL = ['', 'חדש!', 'מבצע ענק בחנות'], PP = ['', '9.9', '100'], PK = ['', '500 גרם', '1.5 ליטר', 'xyz'], FSZ = [100, 70, 140, 120];
const ITEMS = Array.from({ length: 24 }, (_, i) => it({ name: NM[i % 6], price: PR[(i * 5 + 1) % 6], code: CD[(i * 7 + 2) % 6], hl: HL[i % 3], pp: PP[(i >> 1) % 3], pack: PK[i % 4], fs: FSZ[(i >> 2) % 4] }));

// תבניות בענן (מומצאות): "שלי" 40×30 עם "בתוקף עד" ומבצע כמות, תבנית 3 ערוכה (base 3), אחת מחוקה (רכה), אחת עם v לא מוכר
const J1 = (els, o) => Object.assign({ grid: 12, brand: 'lay', els }, o || {});
const MINE = J1([{ id: 'n', t: 'name', x: 14, y: 14, w: 444, h: 60, fs: 54, min: 20 }, { id: 'p', t: 'price', x: 14, y: 80, w: 444, h: 100, fs: 100 }, { id: 'e', t: 'exp', x: 14, y: 190, w: 444, h: 40, fs: 34 },
  { id: 'm', t: 'multi', x: 14, y: 235, w: 444, h: 40, fs: 34 }, { id: 'b', t: 'bc', x: 40, y: 280, w: 392, h: 50, dg: 0 }]);
const TDOC = (id, f) => ({ document: { name: 'projects/demo-largpeami/databases/(default)/documents/b/biz-o/lblt/' + id, fields: f } });
const TF = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'string' ? S(v) : typeof v === 'boolean' ? B(v) : N(v)]));
const PRODS = [{ document: { name: 'projects/demo-largpeami/databases/(default)/documents/b/biz-o/prod/p1', fields: { name: S('צלחות 20 יח׳ (דוגמה)'), price: N(12.9), barcode: S('5901234123457'), on: B(true), q: M({ _: N(5) }) } } }];
async function open(browser, www, who, opt) {
  opt = opt || {};
  const biz = opt.biz || 'biz-o', pre = biz === 'biz-o' ? 'b/biz-o/' : '';
  const cfg = { mode: 'new', users: { m: biz, w: biz }, biz: { [biz]: { dataRoot: biz === 'biz-o' ? 'b' : 'legacy', features: F, name: 'עסק בדיקה' } }, admins: { [pre + '|m']: 1 }, staff: { [pre + '|w']: { perms: { lbl: true } } }, ctx: { deviceScaleFactor: 1 } };
  const log = [], ST = opt.st || { tpl: [], lbls: null, cfg: null, deny: 0, patches: [] };
  const { ctx, page } = await H.newPage(browser, www, cfg, log, 'lblt' + who);
  page.on('pageerror', (e) => log.push('pageerror: ' + e.message));
  await ctx.route(/:8080\/.*/, async (route) => {
    const req = route.request(), u = new URL(req.url()), m = req.method();
    const J = (b, st) => route.fulfill({ status: st || 200, contentType: 'application/json', body: JSON.stringify(b) });
    const NF = () => J({ error: { code: 404, message: 'NOT_FOUND' } }, 404);
    if (/:runQuery$/.test(u.pathname)) { let c = ''; try { c = JSON.parse(req.postData()).structuredQuery.from[0].collectionId; } catch (e) { /* */ }
      return J(c === 'lblt' ? ST.tpl : c === 'prod' ? PRODS : []); }
    if (/\/ordcfg\/main$/.test(u.pathname)) return NF();
    if (/\/cfg\/lbl$/.test(u.pathname) && m === 'GET') return ST.cfg ? J({ name: 'x/cfg/lbl', fields: ST.cfg }) : NF();
    if (/\/(lblt\/[^/]+|lbls\/main)$/.test(u.pathname)) {
      if (m === 'GET') return ST.lbls ? J({ name: 'x/lbls/main', fields: ST.lbls }) : NF();
      if (m === 'PATCH') { ST.patches.push({ url: u.href, path: u.pathname, f: JSON.parse(req.postData()).fields, deny: ST.deny });
        return ST.deny ? J({ error: { code: ST.deny, message: 'PERMISSION_DENIED' } }, ST.deny) : J({ name: u.pathname, fields: JSON.parse(req.postData()).fields }); }
    }
    return route.fallback();
  });
  await H.login(page, who + '@x.co');
  await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden && ACT.startBlank) ACT.startBlank(); });
  await page.setViewportSize({ width: 360, height: 740 });
  return { ctx, page, log };
}

// בדף: לוגו/חותמת דוגמה (צורות בלבד – דטרמיניסטי), טעינת העותק הקפוא בארגז חול, SHA-256
const PAGE_LIB = () => {
  const mk = (w, h, f) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.fillStyle = '#000'; f(g); return c.toDataURL('image/png'); };
  const logo = mk(240, 80, (g) => { g.fillRect(10, 10, 220, 14); g.fillRect(10, 34, 60, 40); g.fillRect(90, 34, 140, 10); g.fillRect(90, 60, 100, 10); });
  const stamp = mk(120, 120, (g) => { g.lineWidth = 10; g.strokeStyle = '#000'; g.beginPath(); g.arc(60, 60, 50, 0, 7); g.stroke(); g.fillRect(40, 40, 40, 40); });
  window.__lbt = {
    brands: { none: null, top: { lay: 'top', logo, stamp }, bot: { lay: 'bot', logo, stamp } },
    frozen(src) { const fw = { PosBarcode: window.PosBarcode }; new Function('window', 'ACT', 'V', 'INP', 'CHG', 'FRM', 'module', src)(fw, {}, {}, {}, {}, {}, undefined); return fw.LblPrint; },
    // טביעת סביבת הציור: אותו טקסט (בגופן של המדבקות) וקשת – אותה גרסת Chrome על מערכת אחרת (גופנים, החלקת קצוות) מציירת פיקסלים אחרים
    async env() { await document.fonts.ready; const c = document.createElement('canvas'); c.width = 600; c.height = 120; const g = c.getContext('2d', { willReadFrequently: true });
      g.fillStyle = '#fff'; g.fillRect(0, 0, 600, 120); g.fillStyle = '#000'; g.direction = 'rtl'; g.textAlign = 'right';
      for (const [w, s, y] of [[700, 40, 45], [400, 22, 80]]) { g.font = w + ' ' + s + 'px Rubik,"IBM Plex Sans Hebrew",Assistant,Arial,sans-serif'; g.fillText('צלחות 12.90 ש"ח Aa', 590, y); }
      g.lineWidth = 3; g.beginPath(); g.arc(60, 90, 22, 0, 7); g.stroke();
      return navigator.platform + ':' + (await window.__lbt.sha(new Uint8Array(g.getImageData(0, 0, 600, 120).data.buffer))).slice(0, 16); },
    async sha(u8) { const d = new Uint8Array(await crypto.subtle.digest('SHA-256', u8)); return [...d].map((x) => x.toString(16).padStart(2, '0')).join(''); },
  };
};

(async () => {
  const [www, outFile, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const browser = await H.launch();
  const ver = browser.version();
  const mainT = (page) => page.evaluate(() => document.getElementById('main').innerText);
  const goLbl = async (page) => { await page.evaluate(() => go('lbl')); await H.settle(page, 1500); };
  const search = async (page, q) => { await page.fill('#main [data-i=lblQ]', q); await page.press('#main [data-i=lblQ]', 'Enter'); await H.settle(page, 500); };
  const toasts = (page) => page.evaluate(() => [...document.querySelectorAll('.toast')].map((e) => e.textContent).join(' | '));
  const printed = async (page, sel) => { await page.evaluate(() => { window.__opened = []; }); await page.click(sel); await H.settle(page, 600);
    const ask = await page.evaluate(() => { const d = document.querySelector('#dlg'); return d && d.open && d.querySelector('[data-a=yes]') ? d.innerText : ''; });
    if (ask) { await page.click('#dlg [data-a=yes]'); await H.settle(page, 600); }
    await H.settle(page, 1500);
    const r = await page.evaluate(async () => { const u = window.__opened.pop(); if (!u) return null; const a = new Uint8Array(await (await fetch(u)).arrayBuffer()); const s = new TextDecoder('latin1').decode(a);
      return { a: [...a], count: +(s.match(/\/Type \/Pages \/Count (\d+)/) || [])[1], boxes: [...new Set([...s.matchAll(/\/MediaBox \[([^\]]+)\]/g)].map((m) => m[1]))], dlg: document.getElementById('dlg').innerText }; });
    await page.evaluate(() => { try { closeDlg(); } catch (e) { /* */ } }); await H.settle(page, 200);
    return Object.assign({ ask }, r || {}); };
  { const { ctx, page, log } = await open(browser, www, 'm');
    await page.evaluate(PAGE_LIB);
    // ---------- z: זהות בייטים ----------
    const z = await page.evaluate(async ([src, BK]) => {
      const T = window.__lbt, OLD = T.frozen(src), r = {};
      for (const [bm, br] of Object.entries(T.brands)) for (let i = 0; i < BK.length; i++) {
        const a = await LblPrint.build(BK[i], br), b = await OLD.build(BK[i], br);
        r[bm + (i + 1)] = { now: await T.sha(a), old: await T.sha(b), len: a.length };
      }
      return r; }, [FROZEN_Z, BASKETS]);
    const zEq = Object.values(z).every((x) => x.now === x.old), zDiff = new Set(Object.values(z).map((x) => x.now)).size;
    check('z 1 PDF זהה בבייטים לשלב 1 (עם קופסאות הפינות הרחבות): 6 סלים × 3 מצבי לוגו (18 קבצים, כולם שונים זה מזה)', zEq && zDiff === 18, Object.fromEntries(Object.entries(z).map(([k, x]) => [k, x.now === x.old ? x.len : 'שונה'])));
    const H0 = Object.fromEntries(Object.entries(z).map(([k, x]) => [k, x.now]));
    const env = await page.evaluate(() => window.__lbt.env());
    if (process.env.LBL_BASELINE_WRITE) fs.writeFileSync(BASE_F, JSON.stringify({ about: 'SHA-256 של PDF מ-6 סלים קבועים × 3 מצבי לוגו (ui-lbl-tpl.js, z). נבדק רק כשגרסת הדפדפן וטביעת סביבת הציור (env) זהות.', chrome: ver, env, h: H0 }, null, 1) + '\n');
    let base = null; try { base = JSON.parse(fs.readFileSync(BASE_F, 'utf8')); } catch (e) { /* */ }
    if (base && base.chrome === ver && base.env === env) check('z 2 SHA-256 זהה לקובץ הבסיס (lbl-baseline.json)', Object.keys(base.h).every((k) => base.h[k] === H0[k]), { chrome: ver, env, diff: Object.keys(base.h).filter((k) => base.h[k] !== H0[k]) });
    else console.log('מידע  z 2 קובץ הבסיס נוצר בדפדפן או בסביבת ציור אחרת (' + (base && base.chrome) + ' ' + (base && base.env) + ' / ' + ver + ' ' + env + ') – ההשוואה מול העותק הקפוא (z 1) היא הקובעת');
    // ---------- d: drawT(BUILTIN[1..5]) מול draw() – שוויון פיקסלים (RGBA), סיביות (toBits) ומלבני ברקוד ----------
    const d = await page.evaluate(async (IT) => {
      const T = window.__lbt, LP = LblPrint, LT = LblTpl, W = LP.W, H = LP.H;
      await Promise.all(Object.values(T.brands).filter(Boolean).map((b) => LP.ensureImgs(b)));
      const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c.getContext('2d', { willReadFrequently: true }); };
      const ga = mk(), gb = mk(), bad = []; let n = 0;
      for (let t = 1; t <= 5; t++) { const B = LT.builtin(t);
        for (const [bm, br] of Object.entries(T.brands)) for (let i = 0; i < IT.length; i++) for (const prev of [0, 1]) {
          const o = (x) => Object.assign({ rects: [] }, br ? { brand: br } : {}, prev ? { prev: 1 } : {}, x || {});
          const ra = LP.draw(ga, t, IT[i], o()), rb = LP.drawT(gb, B, IT[i], o());
          const a = ga.getImageData(0, 0, W, H).data, b = gb.getImageData(0, 0, W, H).data; let px = 0;
          for (let j = 0; j < a.length; j++) if (a[j] !== b[j]) px++;
          const ba = LP.toBits(a, W, H), bb = LP.toBits(b, W, H); let bits = 0; for (let j = 0; j < ba.length; j++) if (ba[j] !== bb[j]) bits++;
          const rr = JSON.stringify(ra) === JSON.stringify(rb); n++;
          if (px || bits || !rr) bad.push({ t, bm, i, prev, px, bits, rr, na: ra.length, nb: rb.length });
        } }
      // render: מספר → draw (כמו היום), אובייקט → drawT
      const rr = JSON.stringify(LP.render(ga, 3, IT[0], { rects: [] })) === JSON.stringify(LP.draw(gb, 3, IT[0], { rects: [] })) && JSON.stringify(LP.render(ga, LT.builtin(3), IT[0], { rects: [] })) === JSON.stringify(LP.draw(gb, 3, IT[0], { rects: [] }));
      // ביקורת: הזזה של פיקסל אחד בשם – הבדיקה מזהה
      const C = LT.builtin(1); C.els[0].y += 1; LP.draw(ga, 1, IT[0], {}); LP.drawT(gb, C, IT[0], {});
      const ca = ga.getImageData(0, 0, W, H).data, cb = gb.getImageData(0, 0, W, H).data; let ctl = 0; for (let j = 0; j < ca.length; j++) if (ca[j] !== cb[j]) ctl++;
      return { n, bad: bad.slice(0, 20), nb: bad.length, rr, ctl }; }, ITEMS);
    check('d 1 drawT(BUILTIN 1..5) זהה לגמרי ל-draw(): פיקסלים, סיביות ומלבני ברקוד – ' + ITEMS.length + ' מדבקות × 5 תבניות × 3 מצבי לוגו × תצוגה/הדפסה', d.nb === 0 && d.n === ITEMS.length * 30, d);
    check('d 2 render: מספר → draw(), תבנית → drawT; ביקורת – הזזת השם בפיקסל אחד מתגלה', d.rr && d.ctl > 0, { ctl: d.ctl });
    const errs = log.filter((x) => /pageerror|TypeError|ReferenceError/.test(x));
    check('m 99 בלי שגיאות JS', errs.length === 0, errs.slice(0, 3));
    await ctx.close(); }

  // ---------- r: תבניות במסך ההדפסה, כמויות, הדפסה לפי גודל, שמירה ל-lblt / lbls ----------
  { const ST = { tpl: [], lbls: { sz: { arrayValue: { values: [] } }, def: S('mine'), at: N(1), by: S('m') }, cfg: null, deny: 0, patches: [] };
    const b3 = await (async () => { const T = require(path.resolve(www, 'lbl-tpl.js')).builtin(3); T.els.find((e) => e.id === 'p').fs = 90; return T; })();
    ST.tpl = [TDOC('mine', TF({ v: 1, name: 'שלי 40×30', w: 40, h: 30, j: JSON.stringify(MINE), at: 5, by: 'w' })), TDOC('b3', TF({ v: 1, name: 'מחיר גדול שלי', w: 50, h: 25, base: 3, j: JSON.stringify(J1(b3.els)), at: 5, by: 'm' })),
      TDOC('gone', TF({ v: 1, name: 'מחוקה', w: 50, h: 25, j: JSON.stringify(MINE), del: true, at: 5, by: 'm' })), TDOC('future', TF({ v: 2, name: 'גרסה עתידית', w: 50, h: 25, j: JSON.stringify(MINE), at: 5, by: 'm' }))];
    const { ctx, page, log } = await open(browser, www, 'm', { st: ST });
    await page.addInitScript(() => { window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; }; });
    await page.reload(); await H.settle(page, 2500);
    await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden && ACT.startBlank) ACT.startBlank(); });
    await page.evaluate(PAGE_LIB);
    await goLbl(page);
    const r0 = await page.evaluate(() => ({ br: LblPrint.brand(), row: !!document.querySelector('#main [data-c=lblBOn]') }));
    check('r 0 עסק אחר (לא לארג\' פעמי): אין לוגו/חותמת ברירת מחדל', r0.br === null && !r0.row, r0);
    await search(page, '5901234123457');
    const r1 = await page.evaluate(() => { const L = LblPrint.tList(), c = document.querySelector('#main canvas[data-lbl-t]');
      return { n: document.querySelectorAll('#main canvas[data-lbl-t]').length, v: L.map((x) => String(x.r)), on: c && c.dataset.lblT, t3: !!(L.find((x) => x.r === 3) || {}).T, cw: c && c.width, ch: c && c.height, mine: document.getElementById('lblTN').innerText }; });
    check('r 1 שקופיות: 5 המקוריות + "שלי" (40×30, קנבס 472×354); תבנית 3 ערוכה; מחוקה ו-v לא מוכר – לא מוצגות; ברירת המחדל של העסק (lbls.def) מוצגת לבד',
      r1.n === 1 && JSON.stringify(r1.v) === JSON.stringify(['1', '2', '3', '4', '5', 'c:mine']) && r1.on === 'c:mine' && r1.t3 && r1.cw === 472 && r1.ch === 354 && /40×30/.test(r1.mine), r1);
    const flds = () => page.evaluate(() => ['ex', 'mq', 'mp'].filter((k) => document.querySelector('#main #lblEd [data-k=' + k + ']')));
    const f1 = await flds();
    await page.evaluate(() => ACT.lblTpl({ dataset: { v: '1' } })); await H.settle(page, 300);
    const f2 = await flds();
    check('r 2 שדות "בתוקף עד" ומבצע כמות – רק בתבנית שצריכה אותם', JSON.stringify(f1) === '["ex","mq","mp"]' && f2.length === 0, { f1, f2 });
    await page.evaluate(() => ACT.lblTpl({ dataset: { v: 'c:mine' } })); await H.settle(page, 300);
    await page.fill('#main #lblEd [data-k=ex]', '31.12.26'); await page.fill('#main #lblEd [data-k=mq]', '2'); await page.fill('#main #lblEd [data-k=mp]', '20');
    await page.click('#main [data-a=lblQn][data-v="100"]'); await H.settle(page, 200);
    const q100 = await page.evaluate(() => ({ v: document.querySelector('#main [data-i=lblQty]').value, on: document.querySelector('#main [data-a=lblQn][aria-pressed=true]').dataset.v, chips: [...document.querySelectorAll('#main [data-a=lblQn]')].map((b) => b.dataset.v).join(',') }));
    // "הדפס" מדפיס ישר (בלי סל). כאן – מסלול ה-PDF (טלפון/דפדפן נייד), כדי להשוות בבייטים; מסלול המחשב – ui-lbl.js (m 10b)
    await page.evaluate(() => Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Linux; Android 13) Mobile', configurable: true }));
    const p100 = await printed(page, '#main [data-a=lblAdd]');
    const row = (await page.evaluate(() => LblPrint.last && LblPrint.last[0])) || {};
    check('r 3 כפתורי כמות 1/10/20/50/100; "הדפס" (100, בלי אישור): עותק התבנית T בשורה, tpl "c:mine", בתוקף עד ומבצע כמות – PDF של 100 עמודים בגודל 113.39×85.04 נק\'',
      q100.v === '100' && q100.on === '100' && q100.chips === '1,10,20,50,100' && !p100.ask && p100.count === 100 && JSON.stringify(p100.boxes) === '["0 0 113.39 85.04"]' && row.tpl === 'c:mine' && row.n === 100 && row.T && row.T.id === 'mine' && row.T.w === 40 && row.T.els.length === 5 && row.it.ex === '31.12.26' && row.it.mq === '2' && row.it.mp === '20', { q100, ask: p100.ask, count: p100.count, boxes: p100.boxes, row: Object.assign({}, row, { T: row.T && row.T.id }) });
    await search(page, '5901234123457'); await page.evaluate(() => ACT.lblTpl({ dataset: { v: '1' } })); await H.settle(page, 200);
    await page.evaluate(() => { window.__opened = []; LblPrint.last = null; });
    await page.fill('#main [data-i=lblQty]', '1000'); await page.click('#main [data-a=lblAdd]'); await H.settle(page, 300);
    const t1000 = await toasts(page), n1000 = await page.evaluate(() => window.__opened.length + (LblPrint.last ? 1 : 0));
    await page.fill('#main [data-i=lblQty]', '999');
    const p0 = await printed(page, '#main [data-a=lblAdd]');
    const eq0 = await page.evaluate(async ([src, a]) => { const L = LblPrint.last, OLD = window.__lbt.frozen(src), c = await LblPrint.build(L);
      // שלב 1 הגביל ל-200 בשורה: אותה שורה עם 200 – זהה בבייטים לעותק הקפוא
      const L2 = L.map((r) => Object.assign({}, r, { n: 200 })), b = await OLD.build(L2, LblPrint.brand()), b2 = await LblPrint.build(L2);
      const eq = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]); return { old: eq([...b2], [...b]), now: eq(a, [...c]), T: !!L[0].T, tpl: L[0].tpl, n: L[0].n }; }, [FROZEN, p0.a || []]);
    check('r 4 כמות: 1000 נדחית ("1 עד 999") בלי הדפסה; 999 > 300: חלון אישור, ואחריו PDF של 999 עמודים 50×25 (זהה ל-build); תבנית מקורית – בלי T; ב-200 – זהה בבייטים לשלב 1',
      /1 עד 999/.test(t1000) && n1000 === 0 && /להדפיס 999 מדבקות/.test(p0.ask) && p0.count === 999 && JSON.stringify(p0.boxes) === '["0 0 141.73 70.87"]' && eq0.old && eq0.now && !eq0.T && eq0.tpl === 1 && eq0.n === 999, { t1000, n1000, ask: p0.ask, count: p0.count, boxes: p0.boxes, eq0 });
    await page.evaluate(() => { delete navigator.userAgent; });
    const nb = await page.evaluate(() => ({ bk: /סל ההדפסה|הוסף לסל/.test(document.getElementById('main').innerText), pr: !!document.querySelector('#main [data-a=lblPrint]') }));
    check('r 5 אין סל במסך: אין "סל ההדפסה", אין "הוסף לסל" ואין כפתורי הדפסת סל', !nb.bk && !nb.pr, nb);
    if (shots) await page.screenshot({ path: path.join(shots, 'r-print.png'), fullPage: true });
    // שמירה: PATCH עם updateMask; 403 → במכשיר בלבד ונשלח שוב בכניסה הבאה
    const T1 = { id: 'new1', name: 'חדשה', w: 50, h: 25, grid: 12, brand: 'lay', els: MINE.els.slice(0, 2) };
    const s1 = await page.evaluate((T) => LblPrint.tSave(T), T1);
    const pt = ST.patches[ST.patches.length - 1] || {};
    const mask = pt.url ? new URL(pt.url).searchParams.getAll('updateMask.fieldPaths').sort() : [];
    check('r 9 שמירת תבנית: PATCH ל-lblt/new1 עם updateMask לכל 9 השדות (base/del לא קיימים – נמחקים), v=1, j תקין, by = המשתמש',
      s1 === 'ok' && /\/b\/biz-o\/lblt\/new1$/.test(pt.path) && JSON.stringify(mask) === JSON.stringify(['at', 'base', 'by', 'del', 'h', 'j', 'name', 'v', 'w']) && pt.f.v.integerValue === '1' && !pt.f.base && !pt.f.del && pt.f.by.stringValue === 'm' && JSON.parse(pt.f.j.stringValue).els.length === 2, { s1, mask, path: pt.path });
    ST.deny = 403;
    const s2 = await page.evaluate((T) => LblPrint.tSave(Object.assign({}, T, { id: 'new2', name: 'בלי הרשאה' })), T1);
    const loc = await page.evaluate(() => JSON.parse(localStorage.getItem('lp-lbl-tpl-biz-o') || 'null'));
    check('r 10 403: נשמר במכשיר בלבד ("dev"), בתור לשליחה חוזרת; העותק במכשיר לפי העסק', s2 === 'dev' && loc && loc.q.length === 1 && loc.q[0].T.id === 'new2' && loc.L.some((t) => t.id === 'new2') && loc.L.some((t) => t.id === 'mine'), { s2, q: loc && loc.q.length });
    ST.deny = 0; const n0 = ST.patches.length;
    await page.evaluate(() => go('home')); await H.settle(page, 1200); await goLbl(page);
    const loc2 = await page.evaluate(() => JSON.parse(localStorage.getItem('lp-lbl-tpl-biz-o') || 'null'));
    const re = ST.patches.slice(n0).find((x) => /lblt\/new2$/.test(x.path));
    check('r 11 כניסה הבאה למסך: השמירה נשלחת שוב, והתור מתרוקן', re && !re.deny && loc2.q.length === 0, { re: !!re, q: loc2 && loc2.q.length });
    const s3 = await page.evaluate(() => LblPrint.sSave({ sz: [{ w: 40, h: 30 }, { w: 40, h: 30 }, { w: 200, h: 1 }], def: 'mine' }));
    const ps = ST.patches[ST.patches.length - 1] || {}, mk2 = ps.url ? new URL(ps.url).searchParams.getAll('updateMask.fieldPaths').sort() : [];
    check('r 12 שמירת הגדרות: PATCH ל-lbls/main עם updateMask (sz, def, at, by), גדלים תקינים בלבד', s3 === 'ok' && /\/lbls\/main$/.test(ps.path) && JSON.stringify(mk2) === '["at","by","def","sz"]' && ps.f.sz.arrayValue.values.length === 1 && ps.f.def.stringValue === 'mine', { s3, mk2, n: ps.f && ps.f.sz.arrayValue.values.length });
    const errs = log.filter((x) => /pageerror|TypeError|ReferenceError/.test(x));
    check('r 99 בלי שגיאות JS', errs.length === 0, errs.slice(0, 3));
    await ctx.close(); }

  // ---------- l: לארג' פעמי – לוגו וחותמת ברירת מחדל (lbl-def/), פריסת "פס עליון" ----------
  for (const [nm, cfgF] of [['בלי cfg/lbl', null], ['לוגו נמחק בהגדרות (logo ריק, בלי stamp)', { logo: S(''), lay: S('bot'), on: B(true), at: N(1), by: S('m') }]]) {
    const ST = { tpl: [], lbls: null, cfg: cfgF, deny: 0, patches: [] };
    for (const who of ['m', 'w']) {
      const { ctx, page, log } = await open(browser, www, who, { biz: 'largpeami', st: ST });
      await goLbl(page);
      const r = await page.evaluate(() => { const b = LblPrint.brand(); return { lay: b && b.lay, logo: b ? (b.logo ? b.logo.slice(0, 22) : '') : null, stamp: b && b.stamp ? b.stamp.slice(0, 22) : '', row: !document.querySelector('#main [data-c=lblBOn]') && (go('lblS'), /לוגו וכשרות/.test(document.getElementById('main').innerText)) }; });
      const ok = cfgF ? r.logo === '' && r.stamp === 'data:image/png;base64,' && r.lay === 'bot' && r.row : r.logo === 'data:image/png;base64,' && r.stamp === 'data:image/png;base64,' && r.lay === 'top' && r.row;
      check(`l ${nm} (${who === 'm' ? 'מנהל' : 'עובד'}): ` + (cfgF ? 'הלוגו לא חוזר, החותמת – ברירת המחדל' : 'לוגו לארג\' פעמי וחותמת הבד"ץ מופיעים לבד, פס עליון'), ok, r);
      if (shots && !cfgF && who === 'm') { await search(page, '5901234123457'); await H.settle(page, 800); await page.locator('#lblEd').screenshot({ path: path.join(shots, 'l-default.png') }); }
      const errs = log.filter((x) => /pageerror|TypeError|ReferenceError/.test(x));
      if (errs.length) check('l בלי שגיאות JS', false, errs.slice(0, 3));
      await ctx.close();
    }
  }

  await browser.close();
  if (outFile) fs.writeFileSync(outFile, JSON.stringify({ out }, null, 1));
  console.log(fail ? `תוצאה: נכשל (${fail})` : 'תוצאה: הכול עבר'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
