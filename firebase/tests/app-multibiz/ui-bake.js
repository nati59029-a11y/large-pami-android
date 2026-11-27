'use strict';
// עלות מוצרי אפייה, שלב ב' (26.11.2026): www/bake-calc.js + www/bake-cost.js. רשת מדומה (בלי אמולטור), מסך 360px.
// האוסף b/{bizId}/bake מדומה כאן בזיכרון משותף לכל ההקשרים, עם updateTime ותנאים (exists=false / updateTime) כמו Firestore.
// בודק: כניסה ב"עוד" (מנהל, עובד עם bake; לא עובד בלי bake; לא כשהתוספת כבויה); סימון חד־פעמי של ספקי e_bak; סוג ספק בכרטיס;
// pubCfg (bt, prOff); פריט קנייה 50 ₪ / 800 גרם = 0.0625; רכיב; מוצר עם רווח ושולי רווח; עדכון מחיר + היסטוריה; קבע ספק;
// עובד רואה ושומר; התנגשות (מיזוג מחירים, עריכה ישנה מפסידה + הודעה); בלי חיבור (תור ושליחה); גיבוי bkx ושחזור רק חסרים; בלי גלישה.
// שימוש: node ui-bake.js <www-dir> [out.json] [shot.png]
const fs = require('fs'); const H = require('./harness');
let fail = 0; const res = []; const check = (n, ok, info) => { if (!ok) fail++; res.push({ n, ok: !!ok, info }); console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 600) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'orders'].map((k) => [k, true]));
const BIZ = 'biz-k';
const ST = { docs: {}, n: 0, cfg: null, writes: [], off: {} };
const ut = () => '2026-11-03T09:' + String(10 + Math.floor(ST.n / 60)).padStart(2, '0') + ':' + String(ST.n++ % 60).padStart(2, '0') + '.000000Z';
const PFX = 'projects/demo-largpeami/databases/(default)/documents/b/' + BIZ + '/bake/';
const J = (route, st, o) => route.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(o) });
const docOf = (id) => ({ name: PFX + id, fields: ST.docs[id].f, createTime: ST.docs[id].u, updateTime: ST.docs[id].u });
async function server(ctx, who) {
  await ctx.route((u) => u.port === '8080' && /\/documents\/b\/[^/]+:runQuery$/.test(u.pathname), async (route) => {
    let q = {}; try { q = JSON.parse(route.request().postData()).structuredQuery; } catch (e) { /* */ }
    if (!q.from || q.from[0].collectionId !== 'bake') return route.fallback();
    if (ST.off[who]) return route.abort('internetdisconnected');
    if (ST.deny && ST.deny[who]) return J(route, 403, { error: { code: 403, message: 'PERMISSION_DENIED' } });
    const L = Object.keys(ST.docs).map((id) => ({ document: docOf(id), readTime: '2026-11-03T09:00:00Z' }));
    return J(route, 200, L.length ? L : [{ readTime: '2026-11-03T09:00:00Z' }]);
  });
  await ctx.route((u) => u.port === '8080' && /\/documents\/b\/[^/]+\/bake\/[^/]+$/.test(u.pathname), async (route) => {
    if (ST.off[who]) return route.abort('internetdisconnected'); // "בלי חיבור": הנתיבים המדומים לא עוברים דרך הרשת, לכן מנתקים כאן
    const r = route.request(); const u = new URL(r.url()); const id = decodeURIComponent(u.pathname.split('/').pop()); const m = r.method(); const d = ST.docs[id];
    if (m === 'GET') return d ? J(route, 200, docOf(id)) : J(route, 404, { error: { code: 404, message: 'NOT_FOUND' } });
    if (m === 'DELETE') { delete ST.docs[id]; return J(route, 200, {}); }
    const ex = u.searchParams.get('currentDocument.exists'); const bu = u.searchParams.get('currentDocument.updateTime');
    if (ex === 'false' && d) return J(route, 409, { error: { code: 409, message: 'ALREADY_EXISTS: Document already exists', status: 'ALREADY_EXISTS' } });
    if (bu && (!d || d.u !== bu)) return J(route, d ? 400 : 404, { error: { code: d ? 400 : 404, message: d ? 'FAILED_PRECONDITION: the stored version does not match the required base version' : 'NOT_FOUND' } });
    let f = {}; try { f = JSON.parse(r.postData()).fields || {}; } catch (e) { /* */ }
    ST.docs[id] = { f, u: ut() }; ST.writes.push({ who, id, ex, bu: !!bu });
    return J(route, 200, docOf(id));
  });
  // cfg/main: המנהל מפרסם (pubCfg), העובד קורא (getCfg)
  await ctx.route((u) => u.port === '8080' && /\/documents\/b\/[^/]+\/cfg\/main$/.test(u.pathname), async (route) => {
    const r = route.request();
    if (r.method() === 'PATCH') { let f = {}; try { f = JSON.parse(r.postData()).fields || {}; } catch (e) { /* */ } ST.cfg = f; return J(route, 200, { name: 'x', fields: f, updateTime: ut() }); }
    return ST.cfg ? J(route, 200, { name: 'x', fields: ST.cfg }) : J(route, 404, { error: { code: 404, message: 'NOT_FOUND' } });
  });
}
async function open(browser, www, cfg, email) {
  const { ctx, page } = await H.newPage(browser, www, cfg, [], email); await page.setViewportSize({ width: 360, height: 760 });
  await server(ctx, email.split('@')[0]);
  await page.addInitScript(() => { window.__toasts = []; const o = new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.classList && n.classList.contains('toast')) window.__toasts.push(n.textContent); }))); document.addEventListener('DOMContentLoaded', () => o.observe(document.body, { childList: true })); });
  await H.login(page, email);
  await page.evaluate(() => { const sh = document.getElementById('sheet'); if (sh && !sh.hidden && typeof ACT.startBlank === 'function') ACT.startBlank(); });
  await H.settle(page, 300);
  return { ctx, page };
}
const noOverflow = (page) => page.evaluate(() => { const W = document.documentElement.clientWidth; const bad = [...document.querySelectorAll('#main *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > W + 1 || r.left < -1) && !e.closest('.scroll-x'); }).slice(0, 5).map((e) => e.tagName + '.' + e.className + ' ' + (e.textContent || '').slice(0, 30)); return { W, sw: document.documentElement.scrollWidth, bad }; });
const nav = async (page, v, a) => { await page.evaluate(([v, a]) => go(v, a), [v, a]); await sleep(700); await page.evaluate(() => { if (!document.querySelector('#dlg[open]')) rerender(); }); await sleep(200); };
const main = (page) => page.evaluate(() => document.querySelector('#main').innerText.replace(/\s+/g, ' '));
const waitQ = async (page, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 8000)) { if (await page.evaluate(() => BK.q().length === 0)) return true; await sleep(200); } return false; };
const fill = async (page, f, vals) => { for (const [k, v] of Object.entries(vals)) { const sel = `#dlg form[data-f=${f}] [name=${k}]`; const tag = await page.$eval(sel, (e) => e.tagName); if (tag === 'SELECT') await page.selectOption(sel, v); else await page.fill(sel, String(v)); } };
const submit = async (page, f) => { await page.click(`#dlg form[data-f=${f}] button.btn`); await sleep(600); };
const toasts = (page) => page.evaluate(() => window.__toasts.slice());
const docs = (t) => Object.entries(ST.docs).filter(([, d]) => d.f.t.stringValue === t).map(([id, d]) => Object.assign({ id, at: +d.f.at.integerValue, by: d.f.by.stringValue }, JSON.parse(d.f.j.stringValue)));

(async () => {
  const [www, out, shot] = process.argv.slice(2);
  const browser = await H.launch();
  const cfg = { mode: 'new', users: { m: BIZ, w: BIZ, w0: BIZ }, biz: { [BIZ]: { dataRoot: 'b', features: Object.assign({}, ALL, { bake: true }), name: 'מאפיית בדיקה' } }, admins: { ['b/' + BIZ + '/|m']: 1 }, staff: { ['b/' + BIZ + '/|w']: { perms: { bake: true } }, ['b/' + BIZ + '/|w0']: { perms: { prc: true } } } };

  // ---- 1. מנהל: סימון חד־פעמי, כניסה, סוג ספק, pubCfg ----
  const A = await open(browser, www, cfg, 'm@x.co');
  const s1 = await A.page.evaluate(() => {
    let c = S.cats.find((x) => x.id === 'e_bak'); if (!c) { c = { id: 'e_bak', kind: 'exp', name: 'ספקים אפייה', beh: 'sup' }; S.cats.push(c); } c.hid = false; c.off = false;
    const sc = S.cats.find((x) => x.id !== 'e_bak' && x.kind === 'exp' && x.beh === 'sup' && !x.hid && !x.off);
    S.subs.push({ id: 'sb1', cat: 'e_bak', name: 'מילס קמח' }, { id: 'sb2', cat: 'e_bak', name: 'חלב הצפון', bt: ['reg'] }, { id: 'sp1', cat: sc.id, name: 'אריזות פלוס' }, { id: 'sr1', cat: sc.id, name: 'ספק רגיל' });
    delete S.bkM; save(); return { sc: sc.id };
  });
  await A.page.evaluate(() => tab('home')); await sleep(2500);
  const m1 = await A.page.evaluate(() => ({ b1: subById('sb1').bt, b2: subById('sb2').bt, p1: subById('sp1').bt, bkM: S.bkM, t: window.__toasts.filter((t) => /ספקי אפייה סומנו/.test(t)) }));
  check('1 סימון חד־פעמי: ספק e_bak בלי bt → ["bake"]; ספק עם ["reg"] לא משתנה; ספק בקטגוריה אחרת לא משתנה; S.bkM=1; הודעה', JSON.stringify(m1.b1) === '["bake"]' && JSON.stringify(m1.b2) === '["reg"]' && m1.p1 === undefined && m1.bkM === 1 && m1.t.length === 1 && /^1 /.test(m1.t[0]), m1);
  await A.page.evaluate(() => { delete subById('sb1').bt; tab('home'); }); await sleep(2200);
  check('1א בהפעלה שנייה לא קורה כלום (הדגל S.bkM)', await A.page.evaluate(() => subById('sb1').bt === undefined && window.__toasts.filter((t) => /ספקי אפייה סומנו/.test(t)).length === 1));
  await A.page.evaluate(() => { subById('sb1').bt = ['bake']; save(); });
  const pc1 = JSON.parse(ST.cfg && ST.cfg.data ? ST.cfg.data.stringValue : '{"cats":[]}');
  const subsP = Object.fromEntries(pc1.cats.flatMap((c) => c.subs || []).map((s) => [s.id, s]));
  check('1ב pubCfg (מהסימון): ספק אפייה – bt:["bake"] ו-prOff:1; ספק עם ["reg"] – bt בלי prOff', subsP.sb1 && JSON.stringify(subsP.sb1.bt) === '["bake"]' && subsP.sb1.prOff === 1 && subsP.sb2 && JSON.stringify(subsP.sb2.bt) === '["reg"]' && !subsP.sb2.prOff, { sb1: subsP.sb1, sb2: subsP.sb2 });
  // סוג ספק בכרטיס: "אריזות פלוס" → אריזה + רגיל (ספק מעורב)
  await A.page.evaluate(() => ACT.subMenu({ dataset: { id: 'sp1' } })); await sleep(300);
  const bx = await A.page.evaluate(() => [...document.querySelectorAll('#dlg [data-bkbt] input')].map((i) => i.name + ':' + i.checked));
  check('1ג כרטיס ספק: שלוש תיבות סוג (אפייה/אריזה/רגיל), ברירת מחדל רגיל', JSON.stringify(bx) === JSON.stringify(['bt_bake:false', 'bt_pack:false', 'bt_reg:true']), bx);
  await A.page.check('#dlg [name=bt_pack]'); await A.page.click('#dlg form[data-f=subsave] button.btn'); await sleep(800);
  const sp1 = await A.page.evaluate(() => ({ bt: subById('sp1').bt, np: supNoPr(subById('sp1')), np2: supNoPr(subById('sb1')), np3: supNoPr(subById('sr1')) }));
  const pc2 = JSON.parse(ST.cfg.data.stringValue); const sP = pc2.cats.flatMap((c) => c.subs || []).find((s) => s.id === 'sp1');
  check('1ד שמירה: bt=["pack","reg"] (ספק מעורב נשאר בתמחור), supNoPr: מעורב=false, אפייה בלבד=true, רגיל=false; pubCfg מפרסם', JSON.stringify(sp1.bt) === '["pack","reg"]' && !sp1.np && sp1.np2 && !sp1.np3 && sP && JSON.stringify(sP.bt) === '["pack","reg"]' && !sP.prOff, { sp1, sP });
  await nav(A.page, 'more');
  check('1ה "עוד" של המנהל: כניסה "עלות מוצרי אפייה"', await A.page.evaluate(() => !!document.querySelector('#main [data-v="bake"]')));

  // ---- 2. פריט קנייה, רכיב, מוצר ----
  await nav(A.page, 'bake');
  await A.page.evaluate(() => ACT.bkTab({ dataset: { k: 'i' } })); await sleep(200);
  await A.page.click('#main [data-a=bkNewI]'); await sleep(300);
  const supO = await A.page.evaluate(() => [...document.querySelectorAll('#dlg select[name=sup] option')].map((o) => o.value).filter(Boolean));
  check('2 בחירת ספק לפריט: רק ספקים עם אפייה/אריזה (לא "ספק רגיל" ולא "חלב הצפון")', JSON.stringify(supO.sort()) === JSON.stringify(['sb1', 'sp1']), supO);
  await fill(A.page, 'bkI', { sup: 'sb1' }); await A.page.dispatchEvent('#dlg select[name=sup]', 'change');
  const kd = await A.page.evaluate(() => ({ v: document.querySelector('#dlg select[name=k]').value, dis: [...document.querySelectorAll('#dlg select[name=k] option')].filter((o) => o.disabled).map((o) => o.value) }));
  check('2א ספק אפייה בלבד → סוג "אפייה" אוטומטי (אריזה חסומה)', kd.v === 'bake' && JSON.stringify(kd.dis) === '["pack"]', kd);
  await fill(A.page, 'bkI', { n: 'קמח לבן 800', u: 'g', p: '50', pq: '800', d: '2026-11-01', c: '+new' }); await submit(A.page, 'bkI');
  await waitQ(A.page);
  const I1 = docs('i')[0], C1 = docs('c')[0];
  check('2ב נשמר: פריט (50 ₪, 800 גרם, היסטוריה 1) ורכיב חדש בשם הפריט, מקושרים; by = המשתמש', I1 && C1 && I1.p === 50 && I1.pq === 800 && I1.yq === 800 && I1.h.length === 1 && I1.c === C1.id && C1.u === 'g' && I1.by === 'm' && I1.sup === 'sb1' && I1.sn === 'מילס קמח', { I1, C1 });
  const t2 = await main(A.page);
  check('2ג מסך הפריט: עלות לגרם ₪0.0625', /0\.0625/.test(t2), t2.slice(0, 300));
  // אריזה: פריט מספק מעורב (אריזה+רגיל) – סוג אוטומטי אריזה; רכיב "קופסה" ביחידות
  await nav(A.page, 'bake'); await A.page.click('#main [data-a=bkNewI]'); await sleep(300);
  await fill(A.page, 'bkI', { sup: 'sp1' }); await A.page.dispatchEvent('#dlg select[name=sup]', 'change');
  await fill(A.page, 'bkI', { n: 'קופסה', u: 'u', p: '30', pq: '100', d: '2026-11-01', c: '+new' }); await submit(A.page, 'bkI'); await waitQ(A.page);
  const box = docs('i').find((x) => x.n === 'קופסה');
  check('2ד פריט אריזה: k=pack, יחידות, 0.3 ליחידה', box && box.k === 'pack' && box.u === 'u' && box.p === 30);
  // ספק שני לאותו רכיב (קמח): מחיר זול יותר, תאריך מוקדם יותר
  await nav(A.page, 'bake'); await A.page.click('#main [data-a=bkNewI]'); await sleep(300);
  await fill(A.page, 'bkI', { sup: 'sp1' }); await A.page.dispatchEvent('#dlg select[name=sup]', 'change');
  await fill(A.page, 'bkI', { n: 'קמח זול', u: 'g', p: '4', pq: '1000', d: '2026-10-01', c: C1.id }); await submit(A.page, 'bkI'); await waitQ(A.page);
  // מוצר
  await nav(A.page, 'bake'); await A.page.evaluate(() => ACT.bkTab({ dataset: { k: 'p' } })); await sleep(200);
  await A.page.click('#main [data-a=bkNewP]'); await sleep(300); await fill(A.page, 'bkP', { n: 'עוגיות 100 גרם', sp: '20' }); await submit(A.page, 'bkP'); await waitQ(A.page);
  const P1 = docs('p')[0];
  await A.page.click('#main [data-a=bkLn][data-s=L]'); await sleep(300); await fill(A.page, 'bkL', { c: C1.id, q: '100' }); await submit(A.page, 'bkL');
  const boxC = docs('c').find((x) => x.n === 'קופסה');
  await A.page.click('#main [data-a=bkLn][data-s=K]'); await sleep(300); await fill(A.page, 'bkL', { c: boxC.id, q: '1' }); await submit(A.page, 'bkL'); await waitQ(A.page);
  const sum = () => A.page.evaluate(() => [...document.querySelectorAll('#main .bk-sum > div')].map((d) => d.querySelector('small').innerText.trim() + '=' + d.querySelector('b').innerText.replace(/\s+/g, '').replace(/[‏‎]/g, '')));
  let sm = await sum(); let txt = await main(A.page);
  check('2ה מוצר: עלות 6.25 | אריזה 0.3 | סה"כ 6.55 | מכירה 20 | רווח 13.45 | שולי רווח 67.3% (רכיב לפי הקנייה האחרונה – מילס)', sm.join('|').includes('6.25') && sm.some((x) => /אריזה=.*0\.3/.test(x)) && sm.some((x) => /6\.55/.test(x)) && sm.some((x) => /רווח=.*13\.45/.test(x)) && sm.some((x) => /67\.3%/.test(x)) && /מילס קמח/.test(txt) && /01\/11\/2026/.test(txt), { sm, txt: txt.slice(0, 400) });
  if (shot) { await A.page.screenshot({ path: shot.replace(/\.png$/, '-prod.png'), fullPage: true }); }
  let o = await noOverflow(A.page);
  check('2ו מסך מוצר ב-360px בלי גלישה', o.sw <= o.W && !o.bad.length, o);
  // קבע ספק (רמה 1): הקמח הזול
  const cheap = docs('i').find((x) => x.n === 'קמח זול');
  await A.page.click('#main [data-a=bkLn][data-s=L][data-i="0"]'); await sleep(300);
  const pinO = await A.page.evaluate(() => [...document.querySelectorAll('#dlg select[name=pin] option')].map((x) => x.value));
  await fill(A.page, 'bkL', { pin: cheap.id }); await submit(A.page, 'bkL'); await waitQ(A.page);
  sm = await sum(); txt = await main(A.page);
  check('2ז "קבע ספק": שורה עם הקמח הזול (0.004 × 100 = 0.4), מסומן "נקבע"', pinO.length === 3 && sm[0].includes('0.4') && /נקבע/.test(txt) && docs('p')[0].L[0].pin === cheap.id, { pinO, sm });
  await A.page.click('#main [data-a=bkLn][data-s=L][data-i="0"]'); await sleep(300); await fill(A.page, 'bkL', { pin: '' }); await submit(A.page, 'bkL'); await waitQ(A.page);
  // מוצר שני מאותו רכיב (200 גרם)
  await nav(A.page, 'bake'); await A.page.click('#main [data-a=bkNewP]'); await sleep(300); await fill(A.page, 'bkP', { n: 'עוגיות 200 גרם', sp: '35' }); await submit(A.page, 'bkP');
  await A.page.click('#main [data-a=bkLn][data-s=L]'); await sleep(300); await fill(A.page, 'bkL', { c: C1.id, q: '200' }); await submit(A.page, 'bkL'); await waitQ(A.page);
  // עדכון מחיר → כל המוצרים מתעדכנים
  await nav(A.page, 'bakeI', I1.id); await A.page.click('#main [data-a=bkPrI]'); await sleep(300);
  await fill(A.page, 'bkPr', { p: '64', d: '2026-11-02' }); await submit(A.page, 'bkPr'); await waitQ(A.page);
  const I1b = docs('i').find((x) => x.id === I1.id);
  await nav(A.page, 'bake'); await A.page.evaluate(() => ACT.bkTab({ dataset: { k: 'p' } })); await sleep(300); txt = await main(A.page);
  check('2ח עדכון מחיר 64: היסטוריה 2, המוצרים: 100 גרם עלות 8.30, 200 גרם עלות 16', I1b.p === 64 && I1b.h.length === 2 && /8\.3/.test(txt) && /16/.test(txt), { h: I1b.h, txt: txt.slice(0, 300) });
  if (shot) await A.page.screenshot({ path: shot, fullPage: false });
  o = await noOverflow(A.page);
  check('2ט המסך הראשי ב-360px בלי גלישה', o.sw <= o.W && !o.bad.length, o);
  // הסתרה ומחיקה (מנהל)
  await nav(A.page, 'bakeI', cheap.id); await A.page.click('#main [data-a=bkOff]'); await waitQ(A.page);
  check('2י הסתרה: off:1 נשמר בענן, מופיע כפתור "מחיקה לצמיתות" למנהל', docs('i').find((x) => x.id === cheap.id).off === 1 && await A.page.evaluate(() => !!document.querySelector('#main [data-a=bkDel]')));
  check('2יא אין שגיאות JavaScript (מנהל)', !A.page.__errors.length, A.page.__errors);

  // ---- 3. עובד עם המתג: כניסה ב"עוד", רואה, שומר ----
  const W = await open(browser, www, cfg, 'w@x.co');
  await W.page.evaluate(() => ACT.wtab({ dataset: { w: 'more' } })); await sleep(500);
  check('3 עובד עם bake: כניסה ב"עוד"', await W.page.evaluate(() => !!document.querySelector('#main [data-v="bake"]')));
  await nav(W.page, 'bake'); await sleep(800); await W.page.evaluate(() => rerender()); txt = await main(W.page);
  check('3א העובד רואה את המוצרים של המנהל', /עוגיות 100 גרם/.test(txt) && /עוגיות 200 גרם/.test(txt), txt.slice(0, 200));
  await W.page.evaluate(() => ACT.bkTab({ dataset: { k: 'i' } })); await W.page.click('#main [data-a=bkNewI]'); await sleep(300);
  const wsup = await W.page.evaluate(() => [...document.querySelectorAll('#dlg select[name=sup] option')].map((o) => o.value).filter(Boolean));
  check('3ב העובד: ספקים מ-cfg/main, רק אפייה/אריזה', JSON.stringify(wsup.sort()) === JSON.stringify(['sb1', 'sp1']), wsup);
  await fill(W.page, 'bkI', { sup: 'sb1' }); await W.page.dispatchEvent('#dlg select[name=sup]', 'change');
  await fill(W.page, 'bkI', { n: 'חמאה', u: 'g', p: '12', pq: '200', d: '2026-11-03', c: '+new' }); await submit(W.page, 'bkI'); await waitQ(W.page);
  check('3ג העובד שמר פריט (by=w); המנהל רואה אחרי טעינה מחדש', docs('i').some((x) => x.n === 'חמאה' && x.by === 'w'));
  await A.page.evaluate(() => { BK.st().at = 0; }); await nav(A.page, 'bake'); await A.page.evaluate(() => ACT.bkTab({ dataset: { k: 'i' } })); await sleep(800); await A.page.evaluate(() => rerender());
  check('3ד המנהל רואה את "חמאה"', /חמאה/.test(await main(A.page)));
  check('3ה לעובד אין "מחיקה לצמיתות" גם בפריט מוסתר', await (async () => { await nav(W.page, 'bakeI', cheap.id); return W.page.evaluate(() => !document.querySelector('#main [data-a=bkDel]') && !!document.querySelector('#main [data-a=bkOff]')); })());

  // ---- 4. התנגשות: שני מכשירים על אותו פריט ----
  await nav(W.page, 'bakeI', I1.id); await nav(A.page, 'bakeI', I1.id); // שניהם טענו את אותה גרסה
  await A.page.evaluate(() => { BK.st().at = Date.now(); });
  await W.page.evaluate(() => { BK.st().at = Date.now(); });
  // המנהל מעדכן מחיר (2026-11-10), העובד – מחיר אחר (2026-11-12) על הגרסה הישנה
  await A.page.click('#main [data-a=bkPrI]'); await sleep(300); await fill(A.page, 'bkPr', { p: '66', d: '2026-11-10' }); await submit(A.page, 'bkPr'); await waitQ(A.page);
  await W.page.click('#main [data-a=bkPrI]'); await sleep(300); await fill(W.page, 'bkPr', { p: '70', d: '2026-11-12' }); await submit(W.page, 'bkPr'); await waitQ(W.page);
  let I = docs('i').find((x) => x.id === I1.id);
  check('4 התנגשות מחירים: שתי הרשומות בהיסטוריה (4 סה"כ), המחיר הנוכחי = התאריך המאוחר (70)', I.h.length === 4 && I.p === 70 && I.h.some((e) => e.p === 66) && I.h.some((e) => e.p === 70), I.h);
  // עריכה אחרת: המנהל משנה שם בזמן מאוחר; העובד (זמן מוקדם, גרסה ישנה) משנה שם → העובד מפסיד ומקבל הודעה
  await nav(W.page, 'bakeI', I1.id);
  await A.page.clock.setFixedTime(H.T0 + 120000); await nav(A.page, 'bakeI', I1.id);
  await A.page.evaluate(() => { BK.st().at = Date.now(); });
  await A.page.click('#main [data-a=bkEdI]'); await sleep(300); await fill(A.page, 'bkI', { n: 'קמח לבן (מנהל)' }); await submit(A.page, 'bkI'); await waitQ(A.page);
  const wt0 = (await toasts(W.page)).length;
  await W.page.click('#main [data-a=bkEdI]'); await sleep(300); await fill(W.page, 'bkI', { n: 'קמח (עובד)' }); await submit(W.page, 'bkI'); await waitQ(W.page);
  I = docs('i').find((x) => x.id === I1.id); const wt = (await toasts(W.page)).slice(wt0);
  check('4א עריכה ישנה מול חדשה בענן: השם של המנהל נשאר, ההיסטוריה לא נפגעה, העובד קיבל הודעה', I.n === 'קמח לבן (מנהל)' && I.h.length === 4 && wt.some((t) => /עודכן במכשיר אחר/.test(t)), { n: I.n, h: I.h.length, wt });

  // ---- 5. בלי חיבור: התור במכשיר ושליחה כשהחיבור חוזר ----
  await nav(W.page, 'bakeI', I1.id);
  await W.ctx.setOffline(true); ST.off.w = 1;
  await W.page.click('#main [data-a=bkPrI]'); await sleep(300); await fill(W.page, 'bkPr', { p: '72', d: '2026-11-20' }); await submit(W.page, 'bkPr'); await sleep(800);
  const q5 = await W.page.evaluate(() => ({ q: BK.q().length, key: Object.keys(localStorage).filter((k) => /^lp-bakeq-/.test(k)), c: Object.keys(localStorage).filter((k) => /^lp-bake-/.test(k)) }));
  txt = await main(W.page);
  check('5 בלי חיבור: השינוי בתור (lp-bakeq-biz-k), מוצג במסך ("ממתין לשליחה"), לא נשלח', q5.q === 1 && q5.key[0] === 'lp-bakeq-' + BIZ && q5.c[0] === 'lp-bake-' + BIZ && docs('i').find((x) => x.id === I1.id).p === 70 && /ממתין לשליחה/.test(txt), { q5, txt: txt.slice(0, 200) });
  await W.page.evaluate(() => { BK.st().R = null; BK.st().at = 0; }); await nav(W.page, 'bake'); await W.page.evaluate(() => ACT.bkTab({ dataset: { k: 'i' } })); await sleep(600);
  txt = await main(W.page); check('5א בלי חיבור: המסך נפתח עם הנתונים מהמכשיר', /חמאה/.test(txt), txt.slice(0, 300));
  await W.ctx.setOffline(false); ST.off.w = 0; await W.page.evaluate(() => window.dispatchEvent(new Event('online'))); const back = await waitQ(W.page);
  I = docs('i').find((x) => x.id === I1.id);
  check('5ב החיבור חזר → נשלח, התור ריק, המחיר בענן 72, ההיסטוריה 5', back && I.p === 72 && I.h.length === 5, { back, p: I.p, h: I.h.length });
  check('5ג אין שגיאות JavaScript (עובד)', !W.page.__errors.length, W.page.__errors);
  await W.ctx.close();

  // ---- 6. גיבוי ושחזור ----
  const nDocs = Object.keys(ST.docs).length;
  const bk = await A.page.evaluate(async () => { const c = await bkCollect(); const s = await mkBackup(0, c); const o = JSON.parse(s); return { n: o.bkx && o.bkx.docs.length, pick: !!parseBackup(s).bkx, old: parseBackup(JSON.stringify({ app: 'large-pami', schema: 4, data: S, files: {} })).bkx }; });
  check('6 mkBackup מכיל bkx עם כל הרשומות; parseBackup מחזיר אותו; גיבוי ישן בלי bkx → null בלי שגיאה', bk.n === nDocs && bk.pick && bk.old === null, bk);
  const full = await A.page.evaluate(async () => (await bkCollect()).bkx);
  const keep = Object.keys(ST.docs)[0], gone = Object.keys(ST.docs)[1]; const keepU = ST.docs[keep].u; const goneJ = ST.docs[gone].f.j.stringValue; delete ST.docs[gone];
  await A.page.evaluate((x) => { restoreFlow({ legacy: false, d: S, files: {}, bkx: x }); }, full); await sleep(300);
  const rb = await A.page.evaluate(() => !!document.querySelector('#dlg [data-a=bakeRst]'));
  await A.page.click('#dlg [data-a=bakeRst]'); await sleep(1500);
  const rt = (await toasts(A.page)).filter((t) => /נתוני אפייה: נוצרו/.test(t)).pop();
  check('6א שחזור: כפתור בחלון השחזור; יוצר רק את המסמך שחסר, לא דורס קיים', rb && ST.docs[gone] && ST.docs[gone].f.j.stringValue === goneJ && ST.docs[keep].u === keepU && /נוצרו 1/.test(rt || ''), { rb, rt, has: !!ST.docs[gone] });
  await A.page.evaluate(() => closeDlg());
  check('6ב אין שגיאות JavaScript (מנהל, אחרי גיבוי ושחזור)', !A.page.__errors.length, A.page.__errors);
  await A.ctx.close();

  // ---- 7. עובד בלי המתג; עסק שהתוספת כבויה בו ----
  const W0 = await open(browser, www, cfg, 'w0@x.co');
  await W0.page.evaluate(() => ACT.wtab({ dataset: { w: 'more' } })); await sleep(400);
  const w0 = await W0.page.evaluate(() => ({ e: !!document.querySelector('#main [data-v="bake"]'), on: BK.on() }));
  check('7 עובד בלי bake: אין כניסה', !w0.e && !w0.on, w0);
  await W0.ctx.close();
  const cOff = Object.assign({}, cfg, { biz: { [BIZ]: { dataRoot: 'b', features: ALL, name: 'מאפיית בדיקה' } } });
  const N = await open(browser, www, cOff, 'm@x.co');
  await nav(N.page, 'more');
  const n7 = await N.page.evaluate(() => ({ e: !!document.querySelector('#main [data-v="bake"]'), np: supNoPr({ bt: ['bake'] }) }));
  await N.page.evaluate(() => { const c = S.cats.find((x) => x.beh === 'sup'); S.subs.push({ id: 'zz', cat: c.id, name: 'ז' }); ACT.subMenu({ dataset: { id: 'zz' } }); }); await sleep(300);
  const n7b = await N.page.evaluate(() => !document.querySelector('#dlg [data-bkbt]'));
  check('7א תוספת כבויה: אין כניסה, אין שדה סוג בכרטיס, supNoPr({bt:["bake"]}) = false (התמחור כמו היום)', !n7.e && !n7.np && n7b, { n7, n7b });
  check('7ב אין שגיאות JavaScript (תוספת כבויה)', !N.page.__errors.length, N.page.__errors);
  await N.ctx.close();

  await browser.close();
  if (out) fs.writeFileSync(out, JSON.stringify({ fail, res }, null, 1));
  console.log(fail ? `נכשלו ${fail}` : 'הכול עבר');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
