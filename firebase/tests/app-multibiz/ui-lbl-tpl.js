'use strict';
// מדבקות שלב 2 (24.11.2026, lbl-tpl.js + lbl-print.js) – מול רשת מדומה. נתונים מומצאים (דוגמה).
// z: זהות בייטים – PDF מ-6 סלים קבועים × 3 מצבי לוגו (בלי / פס עליון / פינות), הקוד הנוכחי מול עותק קפוא של שלב 1
//    (fixtures/lbl-print-stage1.js), באותו דפדפן. בנוסף: SHA-256 מול fixtures/lbl-baseline.json כשגרסת הדפדפן זהה (אחרת – מידע בלבד).
// שימוש: node ui-lbl-tpl.js <www-dir> [out.json] [shots-dir]   (LBL_BASELINE_WRITE=1 – כתיבת קובץ הבסיס מחדש)
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const out = {}; let fail = 0;
const check = (name, ok, info) => { out[name] = { ok: !!ok, info }; if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const F = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
const S = (v) => ({ stringValue: v }), N = (v) => (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }), M = (o) => ({ mapValue: { fields: o } }), B = (v) => ({ booleanValue: v });
const FROZEN = fs.readFileSync(path.join(__dirname, 'fixtures', 'lbl-print-stage1.js'), 'utf8');
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

async function open(browser, www, who) {
  const cfg = { mode: 'new', users: { m: 'biz-o', w: 'biz-o' }, biz: { 'biz-o': { dataRoot: 'b', features: F, name: 'עסק בדיקה' } }, admins: { 'b/biz-o/|m': 1 }, staff: { 'b/biz-o/|w': { perms: { lbl: true } } }, ctx: { deviceScaleFactor: 1 } };
  const log = [];
  const { ctx, page } = await H.newPage(browser, www, cfg, log, 'lblt' + who);
  page.on('pageerror', (e) => log.push('pageerror: ' + e.message));
  await ctx.route(/:8080\/.*/, async (route) => {
    const req = route.request(), u = new URL(req.url());
    const J = (b, st) => route.fulfill({ status: st || 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (/:runQuery$/.test(u.pathname)) return J([]);
    if (/\/(ordcfg\/main|cfg\/lbl|lbls\/main)$/.test(u.pathname)) return J({ error: { code: 404, message: 'NOT_FOUND' } }, 404);
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
    async sha(u8) { const d = new Uint8Array(await crypto.subtle.digest('SHA-256', u8)); return [...d].map((x) => x.toString(16).padStart(2, '0')).join(''); },
  };
};

(async () => {
  const [www, outFile, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const browser = await H.launch();
  const ver = browser.version();
  { const { ctx, page, log } = await open(browser, www, 'm');
    await page.evaluate(PAGE_LIB);
    // ---------- z: זהות בייטים ----------
    const z = await page.evaluate(async ([src, BK]) => {
      const T = window.__lbt, OLD = T.frozen(src), r = {};
      for (const [bm, br] of Object.entries(T.brands)) for (let i = 0; i < BK.length; i++) {
        const a = await LblPrint.build(BK[i], br), b = await OLD.build(BK[i], br);
        r[bm + (i + 1)] = { now: await T.sha(a), old: await T.sha(b), len: a.length };
      }
      return r; }, [FROZEN, BASKETS]);
    const zEq = Object.values(z).every((x) => x.now === x.old), zDiff = new Set(Object.values(z).map((x) => x.now)).size;
    check('z 1 PDF זהה בבייטים לשלב 1: 6 סלים × 3 מצבי לוגו (18 קבצים, כולם שונים זה מזה)', zEq && zDiff === 18, Object.fromEntries(Object.entries(z).map(([k, x]) => [k, x.now === x.old ? x.len : 'שונה'])));
    const H0 = Object.fromEntries(Object.entries(z).map(([k, x]) => [k, x.now]));
    if (process.env.LBL_BASELINE_WRITE) fs.writeFileSync(BASE_F, JSON.stringify({ about: 'SHA-256 של PDF מ-6 סלים קבועים × 3 מצבי לוגו (ui-lbl-tpl.js, z). נבדק רק כשגרסת הדפדפן זהה.', chrome: ver, h: H0 }, null, 1) + '\n');
    let base = null; try { base = JSON.parse(fs.readFileSync(BASE_F, 'utf8')); } catch (e) { /* */ }
    if (base && base.chrome === ver) check('z 2 SHA-256 זהה לקובץ הבסיס (lbl-baseline.json)', Object.keys(base.h).every((k) => base.h[k] === H0[k]), { chrome: ver });
    else console.log('מידע  z 2 קובץ הבסיס נוצר בדפדפן אחר (' + (base && base.chrome) + ' / ' + ver + ') – ההשוואה מול העותק הקפוא (z 1) היא הקובעת');
    const errs = log.filter((x) => /pageerror|TypeError|ReferenceError/.test(x));
    check('m 99 בלי שגיאות JS', errs.length === 0, errs.slice(0, 3));
    await ctx.close(); }

  await browser.close();
  if (outFile) fs.writeFileSync(outFile, JSON.stringify({ out }, null, 1));
  console.log(fail ? `תוצאה: נכשל (${fail})` : 'תוצאה: הכול עבר'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
