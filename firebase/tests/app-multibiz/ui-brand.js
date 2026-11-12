'use strict';
// ריבוי עסקים, שלב 6ב: מיתוג, הסתרת תוספות כבויות, מסך "החשבון מושהה", פריסה למסך רחב והעלאת קובץ במחשב.
// רץ בתוך emulators:exec מול אמולטורים אמיתיים (Auth, Firestore, Storage, Functions) עם החוקים והפונקציות של הענף.
// אין פנייה לאינטרנט ולפרויקט אמיתי. שימוש: node ui-brand.js <www-dir> <out.json> [shots-dir]
// משתני סביבה: FIRESTORE_EMULATOR_HOST, FIREBASE_AUTH_EMULATOR_HOST, FIREBASE_STORAGE_EMULATOR_HOST, FUNCTIONS_EMULATOR_HOST
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const H = require('./harness');
const FS = process.env.FIRESTORE_EMULATOR_HOST, AU = process.env.FIREBASE_AUTH_EMULATOR_HOST, ST = process.env.FIREBASE_STORAGE_EMULATOR_HOST, FN = process.env.FUNCTIONS_EMULATOR_HOST;
const port = (h) => +h.split(':')[1];
const P = 'demo-largpeami';
const sv = (v) => ({ stringValue: v });
const bv = (v) => ({ booleanValue: v });
const out = {}; let fail = 0;
const check = (name, ok, info) => { out[name] = { ok: !!ok, info }; if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 500) : '')); };

const DOCS = `http://${FS}/v1/projects/${P}/databases/(default)/documents/`;
async function put(p, fields) { // כתיבה עוקפת חוקים (owner) – רק להכנת הנתונים
  const r = await fetch(DOCS + p, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) });
  if (!r.ok) throw new Error('seed ' + p + ' ' + r.status + ' ' + await r.text());
}
const flat = (v) => v.stringValue !== undefined ? v.stringValue : v.booleanValue !== undefined ? v.booleanValue : v.integerValue !== undefined ? +v.integerValue : v.mapValue ? Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, flat(x)])) : null;
async function getDoc(p) { const r = await fetch(DOCS + p, { headers: { Authorization: 'Bearer owner' } }); if (r.status === 404) return null; const j = await r.json(); return Object.fromEntries(Object.entries(j.fields || {}).map(([k, v]) => [k, flat(v)])); }
async function signUp(email) {
  const r = await fetch(`http://${AU}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'pw-123456', returnSecureToken: true }) });
  const j = await r.json(); if (!j.localId) throw new Error('signUp ' + JSON.stringify(j)); return j.localId;
}
const ft = (o) => ({ mapValue: { fields: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, bv(v)])) } });
async function seedBiz(id, extra) {
  await put('b/' + id, Object.assign({ name: sv('עסק ' + id), status: sv('active'), dataRoot: sv('b'), schemaVersion: { integerValue: '1' }, features: ft({}), brand: { mapValue: { fields: { name: sv('עסק ' + id), logoPath: sv(''), base: sv('dark-gold'), colors: { mapValue: { fields: {} } } } } } }, extra));
}
async function seedMember(biz, email, role, susp) { // role: admin | worker
  const uid = await signUp(email);
  await put('users/' + uid, { bizId: sv(biz), role: sv(role), active: bv(true), bizStatus: sv(susp ? 'suspended' : 'active'), email: sv(email) });
  if (role === 'admin') await put(`b/${biz}/admins/${uid}`, { email: sv(email) });
  else await put(`b/${biz}/staff/${uid}`, { active: bv(true), email: sv(email), name: sv(email.split('@')[0]), role: sv('employee') });
  return uid;
}
// קובץ PNG אמיתי בלי ספרייה (zlib של node)
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
function png(w, h, fn) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 4 + 1) + 1 + x * 4; const px = fn(x, y); raw[o] = px[0]; raw[o + 1] = px[1]; raw[o + 2] = px[2]; raw[o + 3] = px[3]; }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dataPath = (u) => decodeURIComponent(new URL(u).pathname).replace(/^.*\/documents/, '');

(async () => {
  const [www, outFile, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const cfg = { fwd: { 8080: port(FS), 9099: port(AU), 9199: port(ST), 5001: port(FN) } };
  const browser = await H.launch();
  const shot = async (page, name, full) => { if (shots) await page.screenshot({ path: path.join(shots, name + '.png'), fullPage: !!full }); };
  const open = async (email, log, label, o) => {
    const { ctx, page } = await H.newPage(browser, www, cfg, log, label);
    await page.setViewportSize((o && o.vp) || { width: 360, height: 740 });
    await page.addInitScript(() => { window.__toasts = []; new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.classList && n.classList.contains('toast')) window.__toasts.push(n.textContent); }))).observe(document, { childList: true, subtree: true }); });
    await H.login(page, email);
    if (!(o && o.keepWelcome)) await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden && ACT.startBlank) ACT.startBlank(); });
    return { ctx, page };
  };
  const toasts = (page) => page.evaluate(() => window.__toasts.slice());
  const wait = (page, ms) => H.settle(page, ms || 1500);
  const show = async (page, v) => { await page.evaluate((x) => { NAV = [{ v: x }]; render(0); }, v); await wait(page, 1500); };
  const ok45 = (c) => { const L = (h) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }; const cr = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }; return { inkBg: cr(c.ink, c.bg), inkCard: cr(c.ink, c.card), onaccAcc: cr(c.onacc, c.acc) }; };

  // ---------- הכנת נתונים ----------
  await seedBiz('acme', {});
  const acmeAdmin = await seedMember('acme', 'ma@x.co', 'admin');
  await seedBiz('solo', { features: ft({ tasks: true }) });
  await seedMember('solo', 'ms@x.co', 'admin'); await seedMember('solo', 'ws@x.co', 'worker');
  await seedBiz('susp', { status: sv('suspended') });
  await seedMember('susp', 'mz@x.co', 'admin', true); await seedMember('susp', 'wz@x.co', 'worker', true);
  const sazUid = await seedMember('susp', 'saz@x.co', 'admin'); await put('superadmins/' + sazUid, {}); // מנהל־על שנכנס לעסק מושהה
  await seedBiz('home', {}); const saUid = await seedMember('home', 'sa@x.co', 'admin'); await put('superadmins/' + saUid, {});
  await seedBiz('late', {}); await seedMember('late', 'ml@x.co', 'admin'); // לשלב ההשהיה אחרי שהמנהל כבר מחובר

  // ---------- (א) יחידה: ניגודיות, תיקון אוטומטי והצעות על 3 לוגואים ----------
  {
    const log = []; const { ctx, page } = await open('ma@x.co', log, 'unit');
    const r = await page.evaluate(() => {
      const mk = (fn) => { const a = new Uint8ClampedArray(48 * 48 * 4); for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) { const p = fn(x, y), o = (y * 48 + x) * 4; a[o] = p[0]; a[o + 1] = p[1]; a[o + 2] = p[2]; a[o + 3] = p[3]; } return a; };
      const circ = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 < r * r;
      const logos = {
        'כהה (כחול כהה עם זהב)': mk((x, y) => circ(x, y, 24, 24, 12) ? [230, 180, 40, 255] : circ(x, y, 8, 8, 4) ? [30, 150, 160, 255] : [11, 27, 51, 255]),
        'בהיר (לבן עם צהוב חיוור)': mk((x, y) => circ(x, y, 24, 24, 14) ? [255, 236, 160, 255] : circ(x, y, 40, 8, 4) ? [250, 205, 215, 255] : [250, 250, 250, 255]),
        'צבעוני (ארבעה צבעים)': mk((x, y) => x < 24 ? (y < 24 ? [220, 40, 40, 255] : [40, 80, 220, 255]) : (y < 24 ? [40, 170, 70, 255] : [240, 200, 30, 255])),
        'שקוף עם לוגו כתום': mk((x, y) => circ(x, y, 24, 24, 16) ? [235, 95, 20, 255] : [0, 0, 0, 0]),
        'שחור-לבן בלבד': mk((x, y) => circ(x, y, 24, 24, 16) ? [0, 0, 0, 255] : [255, 255, 255, 255]),
        'כולו שקוף': mk(() => [0, 0, 0, 0]),
      };
      const res = {};
      for (const [n, px] of Object.entries(logos)) { const s = bzSuggest(px); res[n] = s.map((x) => ({ n: x.n, c: x.c, ok: bzOk(x.c), pairs: bzChk(x.c).map((p) => +p.r.toFixed(2)) })); }
      // תיקון אוטומטי: 3,000 סטים אקראיים וקצוות
      let bad = 0; const rn = () => bzHex([0, 0, 0].map(() => Math.random() * 256));
      for (let i = 0; i < 3000; i++) { const f = bzFix({ acc: rn(), acc2: rn(), onacc: rn(), bg: rn(), card: rn(), ink: rn() }); if (!bzOk(f)) bad++; }
      for (const g of [0, 60, 118, 119, 120, 128, 200, 255]) { const h = bzHex([g, g, g]); if (!bzOk(bzFix({ acc: h, acc2: h, onacc: h, bg: h, card: h, ink: h }))) bad++; }
      // WCAG: שחור על לבן = 21, ואפור (#777) על לבן ≈ 4.48
      const wcag = { bw: +bzCR(bzHex([0, 0, 0]), bzHex([255, 255, 255])).toFixed(2), g: +bzCR(bzHex([119, 119, 119]), bzHex([255, 255, 255])).toFixed(2) };
      const fx = bzFix({ acc: bzHex([119, 119, 119]), acc2: bzHex([240, 240, 240]), onacc: bzHex([255, 255, 255]), bg: bzHex([255, 255, 255]), card: bzHex([255, 255, 255]), ink: bzHex([200, 200, 200]) });
      return { res, bad, wcag, fixed: fx, fixedOk: bzOk(fx) };
    });
    const names = Object.keys(r.res);
    const colorful = names.filter((n) => !/שקוף$|כולו|שחור-לבן/.test(n) || /עם לוגו/.test(n));
    check('1 הצעות צבע מ-3 לוגואים (כהה, בהיר, צבעוני) ומעוד 3 מקרי קצה: 3–4 הצעות לכל לוגו, וכל זוג טקסט/רקע בכל הצעה ≥4.5:1',
      names.filter((n) => r.res[n].length).every((n) => r.res[n].length >= 3 && r.res[n].length <= 4 && r.res[n].every((s) => s.ok && s.pairs.every((p) => p >= 4.5))) && ['כהה (כחול כהה עם זהב)', 'בהיר (לבן עם צהוב חיוור)', 'צבעוני (ארבעה צבעים)'].every((n) => r.res[n].length >= 3), Object.fromEntries(names.map((n) => [n, r.res[n].map((s) => s.n + ':' + Math.min(...s.pairs))])));
    check('2 שלושת הזוגות שבחוזה (טקסט על רקע, טקסט על כרטיס, טקסט על הדגשה) ≥4.5 בכל ההצעות (חישוב עצמאי בבדיקה, לא מהקוד)', names.every((n) => r.res[n].every((s) => { const q = ok45(s.c); return q.inkBg >= 4.5 && q.inkCard >= 4.5 && q.onaccAcc >= 4.5; })), r.wcag);
    check('3 תיקון אוטומטי: 3,000 סטים אקראיים + גווני אפור קיצוניים נגמרים כולם ב-≥4.5:1 בכל הזוגות; נוסחת WCAG נכונה (שחור/לבן 21)', r.bad === 0 && r.wcag.bw === 21 && r.wcag.g < 4.5 && r.fixedOk, { bad: r.bad, wcag: r.wcag, fixedSample: r.fixed });
    check('3א לוגו כולו שקוף: אין הצעות (ולא קריסה)', r.res['כולו שקוף'].length === 0, null);
    // נפילה בטוחה של bzF
    const f = await page.evaluate(() => {
      const keep = SY; const t = (s) => { SY = s; return ['shelf', 'tasks'].map((k) => bzF(k)); }; const BZ = 'larg' + 'peami';
      const r = { legNoBiz: t({ bizId: BZ }), legNoId: t({}), legNoFl: t({ bizId: BZ, biz: { features: {}, fl: 0 } }), legFeat: t({ bizId: BZ, biz: { features: { tasks: true }, fl: 1 } }), otherNoBiz: t({ bizId: 'acme' }), otherNoFl: t({ bizId: 'acme', biz: { features: {}, fl: 0 } }), otherOn: t({ bizId: 'acme', biz: { features: { shelf: true }, fl: 1 } }) };
      SY = keep; return r;
    });
    check('4 נפילה בטוחה: לארג\' פעמי בלי מסמך עסק / בלי features – הכול מוצג; עסק אחר בלי features – הכול כבוי; אצל לארג\' פעמי עם features – לפיהם', JSON.stringify(f) === JSON.stringify({ legNoBiz: [true, true], legNoId: [true, true], legNoFl: [true, true], legFeat: [false, true], otherNoBiz: [false, false], otherNoFl: [false, false], otherOn: [true, false] }), f);
    await ctx.close();
  }

  // ---------- (ב) עסק עם תוספת אחת (tasks): מנהל ועובד ----------
  {
    const log = []; const { ctx, page } = await open('ms@x.co', log, 'solo-admin', { keepWelcome: true });
    const wel = await page.evaluate(() => document.getElementById('sheet').innerText);
    await shot(page, '07-ברוך-הבא-עסק-חדש');
    check('5 מסך "ברוך הבא" בעסק חדש (מצב b): אין "נתוני דוגמה"; יש התחלה נקייה והתחברות וגיבוי', !/נתוני דוגמה/.test(wel) && /התחלה נקייה/.test(wel) && /שחזור מקובץ גיבוי/.test(wel), wel.slice(0, 150));
    const sm = await page.evaluate(() => { ACT.startSample(); return { sheetHidden: document.getElementById('sheet').hidden, tx: S.tx.length }; });
    check('5א גם בכוח (ACT.startSample) בעסק חדש לא נוצרים נתוני דוגמה', sm.tx === 0 && sm.sheetHidden === false, sm);
    await page.evaluate(() => ACT.startBlank()); await wait(page, 500);
    const dom = await page.evaluate(() => {
      const txt = () => document.getElementById('main').innerText; const r = {};
      NAV = [{ v: 'more' }]; render(0); r.more = txt();
      NAV = [{ v: 'home' }]; render(0); r.home = txt();
      NAV = [{ v: 'settings' }]; render(0); r.settings = txt();
      openAdd(); r.add = document.getElementById('sheet').innerText; sheetClose();
      return r;
    });
    const must = ['הוצאות קבועות', 'הלוואות', 'כרטיסי אשראי', 'ייבוא מאקסל', 'גיבוי ושחזור', 'השוואות', 'הגדרות']; // 11.11.2026: חשבוניות לתשלום / סריקה / סנכרון / ממתין לסיווג / חשבוניות לטיפול / צילום העברה – למנהל מהבית, מ"לטיפול" ומההגדרות, לא ב"עוד"
    const gone = ['משימות', 'מחירים ומבצעים למדף', 'משוב לקוחות', 'בקשות לעדכון האפליקציה', 'סגירת קופה', 'סיכום סגירות קופה', 'העלאת אישור הפקדה', 'סריקת חשבוניות', 'הזמנות אתר', 'חשבוניות לתשלום', 'סנכרון ועובדים', 'ממתין לסיווג', 'חשבוניות לטיפול', 'צילום העברה'];
    check('6 מנהל בעסק עם תוספת אחת (tasks): מסך "עוד" מציג רק את הבסיס ("משימות" – במסך ה-+); כל שאר התוספות לא ב-DOM', must.every((t) => dom.more.includes(t)) && gone.every((t) => !dom.more.includes(t)), { missing: must.filter((t) => !dom.more.includes(t)), present: gone.filter((t) => dom.more.includes(t)) });
    check('7 בית, הגדרות ותפריט ההוספה: תוספות כבויות לא מוצגות (סריקה, זיהוי חכם, מדף, משוב, קופה); "משימה חדשה" ו"לטיפול" כן', !/סריקה/.test(dom.home) && !/זיהוי חכם/.test(dom.settings) && !/מחירים ומבצעים|משוב לקוחות|סגירת קופה/.test(dom.add) && /משימה חדשה/.test(dom.add) && /לטיפול/.test(dom.add), { home: dom.home.slice(0, 80), add: dom.add.slice(0, 200) });
    await show(page, 'more'); await shot(page, '05-עוד-עסק-עם-תוספת-אחת', true);
    // אין גם בקשות רשת לאוספים של תוספות כבויות
    await page.evaluate(() => { NAV = [{ v: 'home' }]; render(0); openAdd(); sheetClose(); window.dispatchEvent(new Event('online')); }); await wait(page, 2500);
    const bad = log.filter((r) => /\/documents\/b\/solo\/(fb|shelf|appreq|closings|cashout|deposits|supinv|zlast|yemot)/.test(decodeURIComponent(r.url)) || /\/documents\/b\/solo:runQuery/.test(decodeURIComponent(r.url)) && /"collectionId":"(fb|shelf|appreq|closings|cashout|deposits|supinv)"/.test(r.body));
    check('8 אין בקשות רשת לאוספים של תוספות כבויות (משוב, מדף, בקשות, קופה, הפקדות, ספקים)', bad.length === 0, bad.slice(0, 3).map((r) => r.url));
    check('9 אין שגיאות JS (מנהל, עסק עם תוספת אחת)', page.__errors.length === 0, page.__errors);
    // מנהל שאינו בעסק הזה: acme בלי תוספות
    await ctx.close();
    const l2 = []; const { ctx: c2, page: p2 } = await open('ma@x.co', l2, 'acme-admin');
    const m2 = await p2.evaluate(() => { NAV = [{ v: 'more' }]; render(0); return document.getElementById('main').innerText; });
    check('10 עסק בלי אף תוספת: "עוד" בלי משימות, מדף, משוב, בקשות, קופה, סריקה, הזמנות', ['משימות', 'מחירים ומבצעים', 'משוב לקוחות', 'בקשות לעדכון', 'סגירת קופה', 'סריקת חשבוניות', 'הזמנות אתר'].every((t) => !m2.includes(t)) && /הלוואות/.test(m2), m2.slice(0, 120));
    await c2.close();
    // עובד
    const lw = []; const { ctx: c3, page: p3 } = await open('ws@x.co', lw, 'solo-worker');
    await wait(p3, 1500);
    const wk = await p3.evaluate(() => { WS = 'home'; render(0); return { tiles: [...document.querySelectorAll('#main .big2 .tile')].map((t) => t.innerText.trim().replace(/\s+/g, ' ')), sinv: document.getElementById('main').innerText.includes('חשבוניות ספקים'), html: document.getElementById('main').innerText }; });
    check('11 עובד בעסק עם תוספת אחת: במסך הבית רק "סריקה" (במקום "הוצאה", סריקה אחידה שלב 3) ו"משימות", בלי אריחי "בבנייה" ובלי שאר התוספות', wk.tiles.length === 2 && wk.tiles[0].includes('סריקה') && wk.tiles[1].includes('משימות') && !/בבנייה/.test(wk.html), wk.tiles);
    await shot(p3, '04-עובד-עסק-עם-תוספת-אחת');
    const wk2 = await p3.evaluate(() => { WS = 'exp'; render(0); return document.getElementById('main').innerText; });
    check('11א מסך "הוצאה" של העובד: אין כפתור "חשבוניות ספקים" (תוספת suppliers כבויה)', !/חשבוניות ספקים/.test(wk2) && /הכנסה ידנית/.test(wk2), wk2.slice(0, 100));
    // מחשב: "צלם" הופך להעלאת קובץ
    await p3.setViewportSize({ width: 1366, height: 768 }); await wait(p3, 500);
    const cam = await p3.evaluate(async () => { await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); const ins = [...document.querySelectorAll('#main input[type=file]')]; return { n: ins.length, cap: ins.filter((i) => i.hasAttribute('capture')).length, labels: ins.map((i) => i.closest('label').innerText.trim()), desk: document.documentElement.classList.contains('bzd') }; });
    check('12 במחשב (לא באפליקציה, עכבר): אין תכונת צילום בשדות הקובץ, והכיתוב "צלם" הוחלף ב"העלה"', cam.desk && cam.n >= 1 && cam.cap === 0 && cam.labels.every((l) => !/צלם|📷/.test(l)) && cam.labels.some((l) => /העלה/.test(l)), cam);
    const cam2 = await p3.evaluate(async () => { document.body.insertAdjacentHTML('beforeend', '<label id="tcam">📷 צלם חשבונית<input type="file" capture="environment" hidden></label>'); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); const l = document.getElementById('tcam'); const r = { t: l.innerText.trim(), cap: l.querySelector('input').hasAttribute('capture') }; l.remove(); return r; });
    check('12א תוכן שנוצר אחר כך (חלון, גיליון) מומר גם הוא', cam2.t === '📁 העלה חשבונית' && !cam2.cap, cam2);
    check('13 אין שגיאות JS (עובד)', p3.__errors.length === 0, p3.__errors);
    await c3.close();
  }

  // ---------- (ג) עסק מושהה ----------
  {
    const idOnly = (r) => r.method === 'GET' && (/^\/users\/[^/]+$/.test(dataPath(r.url)) || /^\/b\/(susp|late)$/.test(dataPath(r.url)) || /^\/superadmins\/[^/]+$/.test(dataPath(r.url)));
    for (const [em, label, n] of [['mz@x.co', 'מנהל', 14], ['wz@x.co', 'עובד', 15]]) {
      const log = []; const { ctx, page } = await open(em, log, 'susp-' + label, { keepWelcome: true });
      await wait(page, 1500);
      const s = await page.evaluate(() => ({ susp: !!document.getElementById('susp'), txt: document.getElementById('susp') ? document.getElementById('susp').innerText : '', main: document.getElementById('main').innerText.trim(), logout: !!document.querySelector('#susp [data-a=syOut]'), upd: !!document.querySelector('#susp [data-a=suspUpd]'), vis: [...document.body.children].filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.id || e.tagName) }));
      const fsReq = log.filter((r) => /:8080|\/documents/.test(r.url) || new URL(r.url).port === String(port(FS)) || new URL(r.url).port === '8080');
      const nonId = fsReq.filter((r) => !idOnly(r));
      const other = log.filter((r) => ['5001', String(port(FN))].includes(new URL(r.url).port));
      check(`${n} עסק מושהה, ${label}: מסך מלא "החשבון מושהה – פנה לספק" עם התנתקות ובדיקת עדכון; אין תוכן אפליקציה`, s.susp && /החשבון מושהה – פנה לספק/.test(s.txt) && s.logout && s.upd && s.main === '' && s.vis.length === 1 && s.vis[0] === 'susp', s);
      check(`${n}א עסק מושהה, ${label}: אין אף קריאה לנתוני העסק (רק זיהוי: users, מסמך העסק עצמו, superadmins) ואין קריאות לפונקציות`, nonId.length === 0 && other.length === 0, { total: fsReq.length, nonId: nonId.map((r) => r.method + ' ' + dataPath(r.url)), fnCalls: other.length });
      if (label === 'מנהל') await shot(page, '03-עסק-מושהה');
      const m0 = log.length; await page.evaluate(() => { window.dispatchEvent(new Event('online')); document.dispatchEvent(new Event('visibilitychange')); }); await wait(page, 4000);
      const ev = log.slice(m0).filter((r) => new URL(r.url).port === '8080' || new URL(r.url).port === String(port(FS)) || new URL(r.url).port === String(port(ST)));
      check(`${n}ה אירועי "חזרה לרשת" וחזרה לאפליקציה במסך ההשהיה לא יוצרים שום קריאה (${label})`, ev.length === 0, ev.map((r) => r.method + ' ' + r.url));
      // כפתור בדיקת עדכון: בדפדפן אין עדכון, ובכל מקרה אין קריאות נתונים
      const before = log.length; await page.click('[data-a=suspUpd]'); await wait(page, 1200);
      const after = log.slice(before).filter((r) => new URL(r.url).port === String(port(FS)) || new URL(r.url).port === '8080');
      check(`${n}ב כפתור "בדיקת עדכון" לא פונה לנתוני העסק (${label})`, after.length === 0, after.map((r) => r.url));
      // התנתקות
      await page.click('[data-a=syOut]'); await page.waitForSelector('#dlg[open]', { timeout: 3000 }); await Promise.all([page.waitForLoadState('load'), page.click('#dlg [data-a=yes]')]); await wait(page, 1500);
      const lo = await page.evaluate(() => ({ gate: !!document.getElementById('gform'), sy: localStorage.getItem('lp-sync') }));
      check(`${n}ג התנתקות ממסך ההשהיה מחזירה למסך כניסה, בלי נתונים שמורים (${label})`, lo.gate && !lo.sy, lo);
      check(`${n}ד אין שגיאות JS (${label} מושהה)`, page.__errors.length === 0, page.__errors);
      await ctx.close();
    }
    // מנהל שכבר מחובר והעסק מושהה אחר כך: פתיחה מחדש מציגה את מסך ההשהיה, בלי קריאות נתונים אחרי הטעינה האחרונה
    {
      const log = []; const { ctx, page } = await open('ml@x.co', log, 'late'); await wait(page, 1500);
      const okBefore = await page.evaluate(() => !document.getElementById('susp') && document.getElementById('main').innerText.length > 20);
      const lateUid = (await (await fetch(`http://${AU}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'ml@x.co', password: 'pw-123456', returnSecureToken: true }) })).json()).localId;
      await put('b/late', { name: sv('עסק late'), status: sv('suspended'), dataRoot: sv('b'), schemaVersion: { integerValue: '1' }, features: ft({}), brand: { mapValue: { fields: { name: sv('עסק late'), logoPath: sv(''), base: sv('dark-gold'), colors: { mapValue: { fields: {} } } } } } });
      await put('users/' + lateUid, { bizId: sv('late'), role: sv('admin'), active: bv(true), bizStatus: sv('suspended'), email: sv('ml@x.co') });
      page.__step = 'reopen';
      await page.reload(); await wait(page, 3500);
      const s1 = await page.evaluate(() => ({ susp: !!document.getElementById('susp'), main: document.getElementById('main').innerText.trim() }));
      // פתיחה נוספת: עכשיו המצב "מושהה" שמור במכשיר, ולכן הדף הזה לא אמור לקרוא שום דבר מעבר לזיהוי
      const mark = log.length; page.__step = 'reopen2';
      await page.reload(); await wait(page, 10000);
      const gen = page.__gen; const rq = log.slice(mark).filter((r) => new URL(r.url).port === '8080' || new URL(r.url).port === String(port(FS)));
      const s = await page.evaluate(() => ({ susp: !!document.getElementById('susp'), main: document.getElementById('main').innerText.trim() }));
      check('16 מנהל שכבר מחובר, והעסק הושהה: פתיחה מחדש מציגה את מסך ההשהיה; ובפתיחה הבאה (המצב שמור במכשיר) אין קריאות מעבר לזיהוי', okBefore && s1.susp && s1.main === '' && s.susp && s.main === '' && rq.length > 0 && rq.every(idOnly), { okBefore, firstReopenSusp: s1.susp, reqs: rq.map((r) => r.method + ' ' + dataPath(r.url)), gen });
      await ctx.close();
    }
    // מנהל־על בעסק מושהה לא מושפע
    {
      const log = []; const { ctx, page } = await open('saz@x.co', log, 'saz'); await wait(page, 1500);
      const s = await page.evaluate(() => ({ susp: !!document.getElementById('susp'), main: document.getElementById('main').innerText.length, sa: SY.sa }));
      check('17 מנהל־על שנכנס לעסק מושהה לא מושפע: האפליקציה נטענת כרגיל, בלי מסך השהיה', !s.susp && s.main > 20, s);
      await ctx.close();
    }
  }

  // ---------- (ד) מסך מיתוג – מנהל־על בלבד, מכרטיס העסק (עדכון חוזה 14): העלאת לוגו, הצעות, ניגודיות, שמירה דרך setBusinessBrand, איפוס ----------
  {
    const audit = async (biz) => { const r = await fetch(DOCS + `b/${biz}/audit?pageSize=300`, { headers: { Authorization: 'Bearer owner' } }); const j = await r.json(); return (j.documents || []).map((d) => Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, flat(v)]))); };
    const objOf = async (p) => { const r = await fetch(`http://${ST}/v0/b/${P}/o/${encodeURIComponent(p)}`, { headers: { Authorization: 'Bearer owner' } }); return r.status === 404 ? null : r.json(); };
    // מנהל העסק: אין כניסה למסך המיתוג, וגם בכוח – לא שומר
    {
      const lm = []; const { ctx, page } = await open('ma@x.co', lm, 'brand-mgr');
      await show(page, 'settings');
      const menu = await page.evaluate(() => ({ brand: !!document.querySelector('[data-v="brand"]'), staff: !!document.querySelector('[data-v="staff"]') }));
      check('18 מנהל עסק (מצב b): אין "מיתוג" בהגדרות (רק "עובדים")', !menu.brand && menu.staff, menu);
      const forced = await page.evaluate(async () => {
        go('brand', SY.bizId); const h = document.querySelector('#main').innerText;
        const fn = await fnCall('setBusinessBrand', { bizId: SY.bizId, brand: { name: 'שלי' } }).then(() => 'OK', (e) => e.reason || e.message);
        const upl = await brUp(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }), SY.bizId).then(() => 'OK', (e) => e.code || e.message);
        const tok = await tok_(); return { h, fn, upl, direct: tok };
        async function tok_() { try { await fsx('/b/' + SY.bizId + '?updateMask.fieldPaths=brand', { method: 'PATCH', body: JSON.stringify({ fields: { brand: { mapValue: { fields: { name: { stringValue: 'x' } } } } } }) }, 1); return 'OK'; } catch (e) { return e.code || e.message; } }
      });
      const acme0 = await getDoc('b/acme');
      check('18א גם בכוח: מסך המיתוג "למנהל המערכת בלבד"; setBusinessBrand נדחה (not-superadmin); העלאת לוגו ל-Storage נדחית (403); כתיבה ישירה של brand נדחית (403); המסמך והלוגו לא השתנו',
        /למנהל המערכת בלבד/.test(forced.h) && forced.fn === 'not-superadmin' && forced.upl === 403 && forced.direct === 403 && acme0.brand.name === 'עסק acme' && !(await objOf('b/acme/brand/logo')), forced);
      await ctx.close();
    }
    const log = []; const { ctx, page } = await open('sa@x.co', log, 'brand');
    await show(page, 'settings');
    const saMenu = await page.evaluate(() => ({ brand: !!document.querySelector('[data-v="brand"]'), sa: !!document.querySelector('[data-v="sa"]') }));
    check('18ב מנהל־על: אין "מיתוג" בהגדרות של העסק שבו הוא נמצא; המיתוג רק מכרטיס העסק', !saMenu.brand && saMenu.sa, saMenu);
    await page.evaluate(() => go('sa')); await wait(page, 2000);
    await page.evaluate(() => go('sab', 'acme')); await wait(page, 1800);
    await page.click('[data-a=go][data-v=brand][data-arg=acme]'); await wait(page, 1200);
    const scr = await page.evaluate(() => ({ v: cur().v, a: cur().a, form: !!document.querySelector('form[data-f=brSave]'), id: BR && BR.id, sub: document.querySelector('#main').innerText.slice(0, 80) }));
    check('18ג מכרטיס העסק: "מיתוג" פותח את מסך המיתוג של acme (לא של העסק שבו מנהל־העל נמצא)', scr.v === 'brand' && scr.a === 'acme' && scr.form && scr.id === 'acme' && /acme/.test(scr.sub), scr);
    const fileIn = '[data-c=brFile]';
    const bigPng = (() => { const w = 600; const raw = crypto.randomBytes(w * w * 4); return png(w, w, (x, y) => { const o = (y * w + x) * 4; return [raw[o], raw[o + 1], raw[o + 2], 255]; }); })();
    check('19 קובץ הבדיקה הגדול באמת גדול מ-1MB', bigPng.length > 1048576, bigPng.length);
    const stPosts = () => log.filter((r) => r.method === 'POST' && new URL(r.url).port === String(port(ST))).length;
    const s0 = stPosts();
    await page.setInputFiles(fileIn, { name: 'big.png', mimeType: 'image/png', buffer: bigPng }); await wait(page, 800);
    let t = await toasts(page);
    check('20 לוגו גדול מ-1MB נדחה בצד הלקוח (הודעה בעברית), בלי בקשת העלאה', t.some((x) => /גדול מ-1MB/.test(x)) && stPosts() === s0, t.slice(-1));
    await page.setInputFiles(fileIn, { name: 'x.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') }); await wait(page, 600);
    t = await toasts(page);
    check('20א סוג קובץ שאינו png/jpeg/webp נדחה בצד הלקוח', t.some((x) => /סוג הקובץ לא נתמך/.test(x)) && stPosts() === s0, t.slice(-1));
    await page.setInputFiles(fileIn, { name: 'bad.png', mimeType: 'image/png', buffer: Buffer.from('not really a png') }); await wait(page, 800);
    t = await toasts(page);
    check('20ב קובץ שמוצהר כ-png אבל אינו תמונה: "לא ניתן לקרוא את התמונה", בלי העלאה', t.some((x) => /לא ניתן לקרוא את התמונה/.test(x)) && stPosts() === s0, t.slice(-1));
    const good = png(80, 80, (x, y) => (x - 40) ** 2 + (y - 40) ** 2 < 30 * 30 ? [235, 95, 20, 255] : [0, 0, 0, 0]);
    await page.setInputFiles(fileIn, { name: 'logo.png', mimeType: 'image/png', buffer: good }); await wait(page, 1200);
    const sg = await page.evaluate(() => ({ n: document.querySelectorAll('.brsg').length, thumb: !!document.querySelector('#brLg img'), sugg: BR.sugg.map((s) => ({ n: s.n, c: s.c })) }));
    check('21 לוגו תקין: מוצג, ומחושבות 3–4 הצעות צבע בדפדפן (canvas), וכולן ≥4.5:1', sg.thumb && sg.n >= 3 && sg.n <= 4 && sg.sugg.every((s) => { const q = ok45(s.c); return q.inkBg >= 4.5 && q.inkCard >= 4.5 && q.onaccAcc >= 4.5; }), sg.sugg.map((s) => s.n + ' ' + s.c.acc));
    await page.fill('input[name=name]', 'מאפיית אקמי'); await page.click('.brsg >> nth=0'); await wait(page, 3200); // ממתינים שההודעה הקופצת תיעלם
    await shot(page, '01-מסך-מיתוג-מכרטיס-העסק', true);
    const pv = await page.evaluate(() => { const e = document.querySelector('.brpv'); const cs = getComputedStyle(e); return { bg: e.style.getPropertyValue('--bg'), acc: e.style.getPropertyValue('--acc'), name: e.innerText, bgc: cs.backgroundColor, appBg: getComputedStyle(document.body).backgroundColor }; });
    check('22 תצוגה מקדימה חיה: הצעה שנבחרה משנה את התצוגה המקדימה, ולא את שאר האפליקציה', pv.bg && pv.acc && /מאפיית אקמי/.test(pv.name) && pv.bgc !== pv.appBg, pv);
    // עריכה ידנית שלא עוברת
    await page.fill('input[type=text][data-k=ink]', await page.evaluate(() => BR.colors.bg)); await wait(page, 300);
    const w1 = await page.evaluate(() => ({ warn: document.getElementById('brWn').innerText, dis: document.getElementById('brSaveBtn').disabled }));
    check('23 עריכה ידנית שלא עוברת (טקסט בצבע הרקע): מוצגת אזהרה עם היחס, והשמירה חסומה', /4\.5:1/.test(w1.warn) && /1\.0:1/.test(w1.warn) && w1.dis === true, w1);
    page.__step = 'force';
    await page.evaluate(() => document.querySelector('#brSaveBtn').form.requestSubmit()); await wait(page, 600);
    const forcedReq = log.filter((r) => r.step === 'force' && (/setBusinessBrand/.test(r.url) || new URL(r.url).port === String(port(ST))));
    check('24 ניסיון שמירה בכוח עם צבעים שלא עוברים: לא נשלח דבר ולא נשמר דבר', forcedReq.length === 0 && Object.keys((await getDoc('b/acme')).brand.colors).length === 0 && !(await objOf('b/acme/brand/logo')), forcedReq.length);
    await page.click('[data-a=brFix]'); await wait(page, 300);
    const w2 = await page.evaluate(() => ({ warn: document.getElementById('brWn').innerText, dis: document.getElementById('brSaveBtn').disabled, c: BR.colors }));
    check('25 "תיקון אוטומטי" מתקן את הצבעים עד שכולם עוברים; השמירה נפתחת', w2.warn === '' && !w2.dis && (() => { const q = ok45(w2.c); return q.inkBg >= 4.5 && q.inkCard >= 4.5 && q.onaccAcc >= 4.5; })(), w2.c);
    // שמירה
    const docBefore = await getDoc('b/acme'); page.__step = 'save';
    const colorsToSave = w2.c;
    await page.click('#brSaveBtn'); await wait(page, 3000);
    const docAfter = await getDoc('b/acme');
    const objMeta = await objOf('b/acme/brand/logo');
    check('26 שמירה: הלוגו הועלה ל-b/acme/brand/logo (png, גודל תקין), ו-brand נשמר עם שם, נתיב לוגו ושישה צבעים #rrggbb',
      objMeta && objMeta.contentType === 'image/png' && +objMeta.size === good.length && docAfter.brand.name === 'מאפיית אקמי' && docAfter.brand.logoPath === 'b/acme/brand/logo' && Object.keys(docAfter.brand.colors).sort().join() === 'acc,acc2,bg,card,ink,onacc' && Object.values(docAfter.brand.colors).every((v) => /^#[0-9a-f]{6}$/.test(v)) && JSON.stringify(Object.entries(docAfter.brand.colors).sort()) === JSON.stringify(Object.entries(colorsToSave).sort()), { content: objMeta && objMeta.contentType, size: objMeta && objMeta.size, brand: docAfter.brand });
    const q = ok45(docAfter.brand.colors);
    check('26א הצבעים שנשמרו עוברים ניגודיות (חישוב עצמאי); updatedBy = מנהל־העל (נקבע בשרת), updatedAt קרוב לעכשיו', q.inkBg >= 4.5 && q.inkCard >= 4.5 && q.onaccAcc >= 4.5 && docAfter.brand.updatedBy === saUid && Math.abs(docAfter.brand.updatedAt - Date.now()) < 60000, { q, updatedBy: docAfter.brand.updatedBy === saUid });
    const fnReq = log.filter((r) => r.step === 'save' && r.method === 'POST' && /setBusinessBrand/.test(r.url));
    const patch = log.filter((r) => r.step === 'save' && r.method === 'PATCH' && /\/documents\/b\//.test(r.url));
    const aud = (await audit('acme')).filter((a) => a.act === 'setBusinessBrand');
    check('27 השמירה היא קריאה אחת ל-setBusinessBrand (בלי כתיבה ישירה ל-Firestore), נרשמה שורת audit של מנהל־העל, ושאר שדות מסמך העסק לא השתנו',
      fnReq.length === 1 && patch.length === 0 && aud.length === 1 && aud[0].by === saUid && /logo=on/.test(aud[0].note) && docAfter.status === docBefore.status && docAfter.dataRoot === docBefore.dataRoot && JSON.stringify(docAfter.features) === JSON.stringify(docBefore.features) && docAfter.name === docBefore.name, { fn: fnReq.length, patch: patch.length, audit: aud.map((a) => a.act + ':' + a.note) });
    const ap = await page.evaluate(() => ({ acc: document.documentElement.style.getPropertyValue('--acc').trim(), biz: SY.bizId }));
    check('28 המיתוג של acme לא מוחל על האפליקציה של מנהל־העל (הוא נמצא בעסק אחר)', ap.acc === '' && ap.biz === 'home', ap);
    // מנהל העסק: אחרי כניסה – הצבעים והלוגו של העסק מוחלים (קריאה בלבד)
    {
      const lm2 = []; const { ctx: cm, page: pm } = await open('ma@x.co', lm2, 'brand-mgr2'); await wait(pm, 3000);
      const ap2 = await pm.evaluate(() => ({ acc: document.documentElement.style.getPropertyValue('--acc').trim(), bzl: document.documentElement.hasAttribute('data-bzl'), logo: document.getElementById('lglogo').style.backgroundImage.slice(0, 20), disp: getComputedStyle(document.getElementById('lglogo')).display }));
      check('29 מנהל העסק אחרי כניסה: הצבעים מוחלים, ולוגו העסק נטען מ-Storage ומוצג בכותרת', ap2.acc === docAfter.brand.colors.acc && ap2.bzl && /blob:/.test(ap2.logo) && ap2.disp === 'block', ap2);
      await show(pm, 'home'); await shot(pm, '06-בית-אחרי-מיתוג');
      check('29א אין שגיאות JS (מנהל העסק עם מיתוג)', pm.__errors.length === 0, pm.__errors);
      await cm.close();
    }
    // פתיחה מחדש של המסך: הנתונים והלוגו הנוכחי נטענים מהעסק הנבחר
    await page.evaluate(() => { brFree(); go('sab', 'acme'); }); await wait(page, 1200);
    await page.click('[data-a=go][data-v=brand][data-arg=acme]'); await wait(page, 2000);
    const re = await page.evaluate(() => ({ name: document.querySelector('input[name=name]').value, img: !!document.querySelector('#brLg img'), acc: document.querySelector('input[type=text][data-k=acc]').value }));
    check('29ב פתיחה חוזרת מכרטיס העסק: שם, צבעים והלוגו הנוכחי של acme נטענים', re.name === 'מאפיית אקמי' && re.img && re.acc === docAfter.brand.colors.acc, re);
    // שם עד 60
    const long = await page.evaluate(async () => { BR.name = 'א'.repeat(61); await brSave(false); return window.__toasts.slice(-1)[0]; });
    check('30 שם תצוגה מעל 60 תווים נדחה', /עד 60 תווים/.test(long || ''), long);
    // איפוס
    await page.evaluate(() => { brFree(); render(0); }); await wait(page, 500);
    await page.click('[data-a=brReset]'); await page.waitForSelector('#dlg[open]'); await page.click('#dlg [data-a=yes]'); await wait(page, 2500);
    const docReset = await getDoc('b/acme');
    check('31 "חזרה לצבעי ברירת המחדל": colors נשמר ריק ({}), השם והלוגו נשמרים, ונרשם audit נוסף', Object.keys(docReset.brand.colors).length === 0 && docReset.brand.name === 'מאפיית אקמי' && docReset.brand.logoPath === 'b/acme/brand/logo' && (await audit('acme')).filter((a) => a.act === 'setBusinessBrand').length === 2, docReset.brand);
    // לארג' פעמי (legacy) ועסק לא קיים: אין מסך מיתוג
    const lg = await page.evaluate(() => { go('brand', 'larg' + 'peami'); const a = document.querySelector('#main').innerText; go('brand', 'no-such-biz'); return [a, document.querySelector('#main').innerText]; });
    check('31א לארג\' פעמי ועסק שלא ברשימה: "אין מיתוג לעסק הזה" (בלי טופס)', lg.every((x) => /אין מיתוג לעסק הזה/.test(x)), lg.map((x) => x.slice(0, 40)));
    check('32 אין שגיאות JS (מסך מיתוג)', page.__errors.length === 0, page.__errors);
    await ctx.close();
    // עובד לא רואה מיתוג
    const lw = []; const { ctx: c4, page: p4 } = await open('ws@x.co', lw, 'solo-worker2');
    const wb = await p4.evaluate(() => { try { return typeof V.brand === 'function' ? (V.brand('solo').h || '') : ''; } catch (e) { return 'ERR'; } });
    check('33 עובד לא רואה את מסך המיתוג (גם בכוח: "למנהל המערכת בלבד")', /למנהל המערכת בלבד/.test(wb), wb.slice(0, 80));
    await c4.close();
  }

  // ---------- (ו) פריסה לרוחב ----------
  {
    const log = []; const { ctx, page } = await open('ma@x.co', log, 'wide');
    const m = async (w) => { await page.setViewportSize({ width: w, height: 768 }); await wait(page, 300); return page.evaluate(() => { const g = (s, p) => getComputedStyle(document.querySelector(s))[p]; return { main: g('main', 'maxWidth'), bar: g('.bar', 'maxWidth'), topPad: g('.top', 'paddingRight') }; }); };
    const w360 = await m(360), w900 = await m(900), w901 = await m(901), w1366 = await m(1366);
    check('34 פריסה רחבה: עד 900px (טלפון וטאבלט קטן) שום ערך לא משתנה; מ-901px התוכן והסרגל התחתון מוגבלים לרוחב ממורכז', JSON.stringify(w360) === JSON.stringify(w900) && w360.main === '760px' && w360.bar === 'none' && w901.main === '980px' && w1366.main === '980px' && w1366.bar === '980px', { w360, w900, w901, w1366 });
    await show(page, 'home'); await wait(page, 500);
    const rtl = await page.evaluate(() => ({ dir: getComputedStyle(document.documentElement).direction, over: document.documentElement.scrollWidth <= innerWidth }));
    await shot(page, '08-מחשב-1366-בית');
    check('35 במסך רחב: הכיוון נשאר מימין לשמאל, ואין גלילה אופקית', rtl.over, rtl);
    const upd = await page.evaluate(() => { NAV = [{ v: 'settings' }]; render(0); const b = document.querySelector('[data-a=updChk]'); return b ? getComputedStyle(b).display : 'none-in-dom'; });
    check('35א תכונה בלי מקבילה במחשב (עדכון APK) מוסתרת במחשב רחב', upd === 'none', upd);
    await page.setViewportSize({ width: 360, height: 740 }); await wait(page, 300);
    const upd2 = await page.evaluate(() => getComputedStyle(document.querySelector('[data-a=updChk]')).display);
    check('35ב ברוחב טלפון אותו כפתור מוצג (כמו היום)', upd2 !== 'none', upd2);
    await show(page, 'home'); await shot(page, '08א-בית-360-לצד-המחשב');
    await ctx.close();
  }

  await browser.close();
  fs.writeFileSync(outFile, JSON.stringify({ out }, null, 1));
  console.log(fail ? `תוצאה: נכשל (${fail})` : 'תוצאה: הכול עבר'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
