'use strict';
// חוסרים, שלב 1 (www/hs.js + hs-core.js). רשת מדומה, בלי אמולטור.
// משבצת ומונה (מנהל ב-+, עובד בבית וב-+), הוספה (שדות החוזה בדיוק), זיהוי ספק מחשבוניות, פריט כללי, לפי ספק ("מופיע לכל הספקים"; "להזמין מספקים" כבר לא מוצג אוטומטית),
// חלון "להוסיף גם לרשימת החוסרים?" אחרי סימון "להזמין מספק" בליקוט (window.hsAskSo – הוסף / לא עכשיו / בלי כפילות / 403 / תוספת כבויה),
// וואטסאפ לספק (טלפון נשמר בפעם הראשונה), הגיע / החזר / מחיקה רכה / שחזור, הודעה ללקוח, תמונה, 403 ← "יופעלו בקרוב", תוספת כבויה = אין משבצת ואין בקשות.
// שימוש: node ui-hs.js <www-dir> [shots-dir]      בדיקה הפוכה: MUTATE=gen (פריט כללי לא מופיע אצל הספק) – הבדיקה חייבת להיכשל.
const fs = require('fs'); const path = require('path'); const H = require('./harness');
const BZ0 = ['larg', 'peami'].join('');
const FT = (o) => Object.assign(Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders', 'groups'].map((k) => [k, true])), o || {});
let fail = 0; const check = (n, ok, info) => { if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const S = (v) => ({ stringValue: String(v) }), I = (v) => ({ integerValue: String(v) }), B = (v) => ({ booleanValue: !!v }), A = (a) => ({ arrayValue: { values: a.map(S) } });
const M = (o) => ({ mapValue: { fields: o } });
const T0 = H.T0;
const DOCS = 'projects/demo-largpeami/databases/(default)/documents/';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const SUPS = [{ id: 's1', name: 'תנובה' }, { id: 's2', name: 'שטראוס' }, { id: 's3', name: 'אסם' }];
let DB, LOG, F403, UT, STALE, REJ, VER = 0;
const item = (o) => Object.assign({ n: S('מוצר'), nk: S('מוצר'), gen: B(false), sups: A([]), supN: A([]), why: S('store'), np: I(0), st: S('open'), by: S('m'), byN: S('m'), t: I(T0 - 36e5) }, o);
const seed = () => {
  DB = { hsr: {}, p: {}, hsx: {}, hsph: {}, supord: [], pinv: [] }; LOG = []; F403 = false; UT = {}; STALE = new Set(); REJ = new Set();
  DB.hsr.a1 = item({ n: S('קוטג 5%'), nk: S('קוטג 5'), sups: A(['s1']), supN: A(['תנובה']), q: I(4), byN: S('w1'), by: S('w1') });
  DB.hsr.g1 = item({ n: S('שקיות גדולות'), nk: S('שקיות גדולות'), gen: B(true), why: S('both') });
  DB.hsr.r1 = item({ n: S('במבה'), nk: S('במבה'), sups: A(['s3']), supN: A(['אסם']), st: S('arr'), ub: S('m'), ut: I(T0 - 6e4), h: { arrayValue: { values: [M({ k: S('man'), t: I(T0 - 6e4), byN: S('m') })] } } });
  DB.hsx.s1 = { n: S('תנובה'), it: A(['חלב תנובה 3 1 ליטר', 'קוטג 5']), t: I(T0 - 864e5) };
  DB.pinv.push({ supId: S('s2'), sup: S('שטראוס'), at: I(T0 - 1000), lines: { arrayValue: { values: [M({ n: S('שוקו בקבוק 1 ליטר') })] } } });
  DB.supord.push({ n: S('יוגורט פרי'), qty: I(2), sup: S('שטראוס'), st: S('ord'), ord: S('o9'), no: I(41), br: S('_'), at: I(T0 - 5000) });
};
const docOf = (name, f) => ({ name: DOCS + name, fields: f, createTime: '2026-11-03T09:00:00Z', updateTime: '2026-11-03T09:00:00Z' });
// שלב 2: גרסה לכל פריט (updateTime) – PATCH עם currentDocument.updateTime שלא תואם נדחה (400), כמו ב-Firestore. STALE – השאילתה מחזירה גרסה ישנה (עדכון מקביל)
const hdoc = (id, stale) => Object.assign(docOf('hsr/' + id, DB.hsr[id]), { updateTime: stale ? '2026-11-03T08:00:00Z' : UT[id] || '2026-11-03T09:00:00Z' });
async function mockCloud(ctx, who) {
  await ctx.route((u) => new URL(u).port === '8080', async (route) => {
    const req = route.request(), u = new URL(req.url()), m = req.method(), p = decodeURIComponent(u.pathname), body = req.postData() || '';
    const i = p.indexOf('/documents'); if (i < 0) return route.fallback(); const R = p.slice(i + 10).split('?')[0];
    const ok = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    const err = (c, s) => route.fulfill({ status: c, contentType: 'application/json', body: JSON.stringify({ error: { code: c, message: s, status: s } }) });
    let coll = ''; if (R === ':runQuery') { try { coll = JSON.parse(body).structuredQuery.from[0].collectionId; } catch (e) { /* */ } }
    if (!/^\/(hsr|hsx|hsph)(\/|$)/.test(R) && !['hsr', 'pinv', 'supord'].includes(coll)) return route.fallback();
    LOG.push({ who, m, R, coll, body: body ? JSON.parse(body) : null, q: u.search });
    if (F403 && (coll === 'hsr' || /^\/hs/.test(R))) return err(403, 'PERMISSION_DENIED');
    if (coll) { const sq = JSON.parse(body).structuredQuery, w = sq.where && sq.where.fieldFilter; let rows = [];
      if (coll === 'hsr') rows = Object.keys(DB.hsr).filter((id) => !w || DB.hsr[id].st.stringValue === w.value.stringValue).map((id) => { const st = STALE.has(id); STALE.delete(id); return hdoc(id, st); });
      if (coll === 'pinv') rows = DB.pinv.filter((d) => +d.at.integerValue > +w.value.integerValue).map((d, k) => docOf('pinv/i' + k, d));
      if (coll === 'supord') rows = DB.supord.map((d, k) => docOf('supord/so' + k, d));
      return ok(rows.length ? rows.map((d) => ({ document: d, readTime: 'x' })) : [{ readTime: 'x' }]); }
    const s = R.split('/').filter(Boolean);
    if (s[0] === 'hsx') { if (s.length === 1) return ok({ documents: Object.keys(DB.hsx).map((id) => docOf('hsx/' + id, DB.hsx[id])) });
      if (m === 'PATCH') { DB.hsx[s[1]] = JSON.parse(body).fields; return ok(docOf('hsx/' + s[1], DB.hsx[s[1]])); } }
    if (s[0] === 'hsph') { if (m === 'GET') return DB.hsph[s[1]] ? ok(docOf('hsph/' + s[1], DB.hsph[s[1]])) : err(404, 'NOT_FOUND');
      if (m === 'PATCH') { DB.hsph[s[1]] = JSON.parse(body).fields; return ok({}); } }
    if (s[0] === 'hsr') {
      if (s.length === 1 && m === 'POST') { const id = u.searchParams.get('documentId'); DB.hsr[id] = JSON.parse(body).fields; return ok(docOf('hsr/' + id, DB.hsr[id])); }
      if (s.length === 2 && m === 'GET') return DB.hsr[s[1]] ? ok(hdoc(s[1])) : err(404, 'NOT_FOUND');
      if (s.length === 2 && m === 'PATCH') { const f = JSON.parse(body).fields, d = DB.hsr[s[1]]; if (!d) return err(404, 'NOT_FOUND'); const pc = u.searchParams.get('currentDocument.updateTime'); if (pc && pc !== hdoc(s[1]).updateTime) return err(400, 'FAILED_PRECONDITION'); if (REJ.has(s[1])) { REJ.delete(s[1]); return err(403, 'PERMISSION_DENIED'); } for (const k of u.searchParams.getAll('updateMask.fieldPaths')) { if (f[k]) d[k] = f[k]; else delete d[k]; } UT[s[1]] = new Date(T0 + (++VER) * 1000).toISOString(); return ok(hdoc(s[1])); }
      if (s[2] === 'p') { if (m === 'GET') return DB.p[s[1]] ? ok(docOf('hsr/' + s[1] + '/p/1', DB.p[s[1]])) : err(404, 'NOT_FOUND');
        if (m === 'PATCH') { DB.p[s[1]] = JSON.parse(body).fields; return ok({}); } if (m === 'DELETE') { delete DB.p[s[1]]; return ok({}); } }
    }
    return err(404, 'NOT_FOUND');
  });
}
const shot = async (page, dir, name) => { if (!dir) return; fs.mkdirSync(dir, { recursive: true }); await page.waitForTimeout(300); await page.screenshot({ path: path.join(dir, name + '.png'), fullPage: true }); };
const waitFor = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 4000)) { if (await fn()) return true; await sleep(80); } return false; };
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const toasts = (page) => page.evaluate(() => [...document.querySelectorAll('.toast')].map((x) => x.innerText).join('|'));
const mainT = (page) => page.evaluate(() => document.getElementById('main').innerText);
const posts = () => LOG.filter((l) => l.m === 'POST' && l.R === '/hsr');
const u2m = (q) => new URLSearchParams(q).getAll('updateMask.fieldPaths').sort().join();

(async () => {
  const [www, shots] = process.argv.slice(2); const browser = await H.launch();
  const open = async (label, email, ft, w) => { const cfg = { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: ft || FT() } }, admins: { '|m': 1 }, staff: { '|w1': 1 } };
    const x = await H.newPage(browser, www, cfg, [], label); await x.page.setViewportSize({ width: w || 360, height: 760 });
    await mockCloud(x.ctx, email.split('@')[0]); await H.login(x.page, email); if (await x.page.$('[data-a=startBlank]')) { await x.page.click('[data-a=startBlank]'); await sleep(300); }
    await sleep(800); await x.page.evaluate(() => { try { closeDlg(); } catch (e) { /* */ } window.__wa = []; window.open = (u) => { window.__wa.push(String(u)); return null; }; });
    if (process.env.MUTATE === 'gen') await x.page.evaluate(() => { const g = HsCore.groups; HsCore.groups = (...a) => g(...a).map((x) => Object.assign(x, { L: x.L.filter((r) => !r.all) })); });
    return x; };
  const sheetTile = (pg) => pg.evaluate(() => { openAdd(); const t = document.querySelector('#sheet .tile[data-v=hs]'); return t ? { a: t.dataset.a, txt: t.innerText.replace(/\s+/g, ' ').trim(), n: (t.querySelector('[data-hsn] .tag') || {}).innerText || '' } : null; });

  // ================= מנהל =================
  seed(); let x = await open('m-hs', 'm@x.co'); let mp = x.page;
  await mp.evaluate((L) => { S.subs = S.subs.filter((s) => !/^s\d$/.test(s.id)); L.forEach((s) => S.subs.push({ id: s.id, cat: 'e_sup', name: s.name })); save(); }, SUPS);
  let t = await sheetTile(mp); await waitFor(async () => (await sheetTile(mp) || {}).n === '2');
  t = await sheetTile(mp);
  check('1 מנהל: משבצת "חוסרים" במסך ה-+ עם מונה פתוחים (2)', t && t.a === 'addGo' && /חוסרים/.test(t.txt) && t.n === '2', t);
  const q1 = LOG.filter((l) => l.coll === 'hsr');
  check('1א המונה – שאילתה אחת על hsr עם st == open ו-limit', q1.length === 1 && q1[0].body.structuredQuery.where.fieldFilter.value.stringValue === 'open' && q1[0].body.structuredQuery.limit <= 500, q1.length);
  await mp.click('#sheet .tile[data-v=hs]'); await waitFor(() => mp.evaluate(() => document.querySelectorAll('.hs-it').length === 2));
  let mt = await mainT(mp);
  check('2 רשימה: 2 פתוחים, תווית "כללי – מופיע לכל הספקים", מי הוסיף ומתי, כמות', /קוטג 5%/.test(mt) && /שקיות גדולות/.test(mt) && /כללי – מופיע לכל הספקים/.test(mt) && /נוסף ע"י w1/.test(mt) && /כמות 4/.test(mt) && !/במבה/.test(mt), mt.slice(0, 300));
  await waitFor(async () => !!DB.hsx.s2, 4000);
  check('3 המנהל בנה את hsx מחשבוניות (pinv חדשות): s2 עם שם המוצר, בלי מחירים', DB.hsx.s2 && DB.hsx.s2.it.arrayValue.values.some((v) => v.stringValue === 'שוקו בקבוק 1 ליטר') && Object.keys(DB.hsx.s2).sort().join() === 'it,n,t', DB.hsx.s2 && Object.keys(DB.hsx.s2));
  check('3א שאילתת pinv: רק אחרי הזמן האחרון, ממוינת, עם select', LOG.some((l) => l.coll === 'pinv' && l.body.structuredQuery.where.fieldFilter.op === 'GREATER_THAN' && l.body.structuredQuery.select));
  await shot(mp, shots, 'hs-1-רשימה');
  // הוספה: מוצר מוכר ← הספק מוצע ונבחר אוטומטית
  await mp.click('[data-a=hsNew]'); await waitFor(() => mp.evaluate(() => cur().v === 'hsEd'));
  await mp.fill('input[data-i=hsN]', 'חלב 3% ליטר'); await waitFor(() => mp.evaluate(() => !!document.querySelector('#hsSups [data-a=hsSupRm][data-id=s1]')), 3000);
  check('4 זיהוי: "חלב 3% ליטר" ← הספק תנובה נבחר אוטומטית (מחשבונית קודמת)', await mp.evaluate(() => !!document.querySelector('#hsSups [data-a=hsSupRm][data-id=s1]') && /זוהה אוטומטית/.test(document.getElementById('hsSups').innerText)));
  await mp.selectOption('select[data-c=hsSupPick]', 's2'); await sleep(200);
  await mp.click('[data-a=hsWhy][data-v=both]'); await sleep(200);
  await mp.fill('input[data-i=hsQ]', '3'); await mp.check('input[data-c=hsCustOn]'); await sleep(200);
  await mp.fill('input[data-i=hsCN]', 'דני'); await mp.fill('input[data-i=hsCP]', '050-765-4321');
  await shot(mp, shots, 'hs-2-הוספה');
  check('4א טופס בלי גלילה לרוחב (360px)', await noOverflow(mp));
  LOG.length = 0; await mp.click('form[data-f=hsSave] button:not([type])'); await waitFor(async () => posts().length >= 1);
  const P1 = posts()[0], f1 = P1 && P1.body.fields;
  check('5 שמירה: בדיוק שדות החוזה (n,nk,gen,sups,supN,why,q,cust,np,st,by,byN,t)', f1 && Object.keys(f1).sort().join() === 'by,byN,cust,gen,n,nk,np,q,st,sups,supN,t,why'.split(',').sort().join(), f1 && Object.keys(f1));
  check('5א ערכים: 2 ספקים, why=both, q=3, לקוח עם טלפון ספרות, st=open, by/byN של המנהל', f1 && f1.sups.arrayValue.values.map((v) => v.stringValue).join() === 's1,s2' && f1.why.stringValue === 'both' && f1.q.integerValue === '3' && f1.cust.mapValue.fields.ph.stringValue === '0507654321' && f1.cust.mapValue.fields.nm.stringValue === 'דני' && f1.st.stringValue === 'open' && f1.by.stringValue === 'm' && f1.byN.stringValue === 'm' && f1.gen.booleanValue === false && P1.q.includes('documentId='), f1);
  await waitFor(() => mp.evaluate(() => cur().v === 'hs'));
  check('5ב חזרה לרשימה: 3 פתוחים', await mp.evaluate(() => document.querySelectorAll('.hs-it').length === 3));
  // מוצר לא מוכר ← פריט כללי
  await mp.click('[data-a=hsNew]'); await waitFor(() => mp.evaluate(() => cur().v === 'hsEd'));
  await mp.fill('input[data-i=hsN]', 'מברג חשמלי'); await sleep(600);
  check('6 מוצר לא מוכר: "לא זוהה ספק" ו"יישמר כפריט כללי"', /לא זוהה ספק/.test(await mainT(mp)) && /יישמר כפריט כללי/.test(await mainT(mp)));
  LOG.length = 0; await mp.click('form[data-f=hsSave] button:not([type])'); await waitFor(async () => posts().length >= 1);
  const f2 = posts()[0] && posts()[0].body.fields;
  check('6א נשמר כפריט כללי: gen=true, בלי ספקים, why=store, בלי q/cust', f2 && f2.gen.booleanValue === true && !(f2.sups.arrayValue.values || []).length && f2.why.stringValue === 'store' && !f2.q && !f2.cust, f2);
  await waitFor(() => mp.evaluate(() => cur().v === 'hs'));
  // שם ריק נדחה
  await mp.click('[data-a=hsNew]'); await waitFor(() => mp.evaluate(() => cur().v === 'hsEd'));
  await mp.fill('input[data-i=hsQ]', '-2'); await mp.fill('input[data-i=hsN]', 'משהו'); LOG.length = 0;
  await mp.click('form[data-f=hsSave] button:not([type])'); await sleep(400);
  check('7 כמות שלילית נדחית בלי שליחה', !posts().length && /כמות לא תקינה/.test(await toasts(mp)), await toasts(mp));
  await mp.evaluate(() => goBack()); await sleep(300);
  // לפי ספק
  await mp.click('[data-a=hsTab][data-v=sup]'); await waitFor(() => mp.evaluate(() => !!document.querySelector('[data-hsg=s2]')), 4000); await sleep(600);
  const g = await mp.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-hsg]')].map((e) => [e.dataset.hsg, e.innerText])));
  check('8 לפי ספק: תנובה – קוטג, חלב והפריטים הכלליים עם "מופיע לכל הספקים"', g.s1 && /קוטג 5%/.test(g.s1) && /חלב 3% ליטר/.test(g.s1) && /שקיות גדולות[\s\S]*מופיע לכל הספקים/.test(g.s1) && /מברג חשמלי/.test(g.s1), g.s1);
  check('8א הפריט עם 2 ספקים מופיע גם אצל שטראוס, וגם הכלליים', g.s2 && /חלב 3% ליטר/.test(g.s2) && /שקיות גדולות/.test(g.s2) && !/קוטג/.test(g.s2), g.s2);
  check('8ב "להזמין מספקים" לא נכנס לבד: יוגורט פרי (supord) לא מוצג, ואין שאילתה ל-supord', !Object.values(g).some((t) => /יוגורט פרי|מהזמנת לקוח/.test(t)) && !LOG.some((l) => l.coll === 'supord'), { g, so: LOG.filter((l) => l.coll === 'supord').length });
  check('8ג אסם (רק פריט שהגיע) – לא מוצג', !g.s3, Object.keys(g));
  await shot(mp, shots, 'hs-3-לפי-ספק');
  // וואטסאפ: פעם ראשונה מבקש טלפון ושומר
  LOG.length = 0; await mp.click('[data-a=hsWa][data-id=s1]'); await waitFor(() => mp.evaluate(() => !!document.querySelector('#dlg[open] #hsPh')));
  check('9 וואטסאפ לספק בלי טלפון: חלון בקשת טלפון', await mp.evaluate(() => !!document.querySelector('#dlg[open] #hsPh')));
  await mp.fill('#hsPh', '05O'); await mp.click('#dlg [data-a=hsPhSave]'); await sleep(200);
  check('9א טלפון לא תקין נדחה', /לא תקין/.test(await toasts(mp)) && !DB.hsph.s1);
  await mp.fill('#hsPh', '050-1234567'); await mp.click('#dlg [data-a=hsPhSave]'); await waitFor(() => mp.evaluate(() => window.__wa.length >= 1 && !document.querySelector('#dlg[open]')));
  const wa = await mp.evaluate(() => window.__wa.slice());
  check('9ב הטלפון נשמר ב-hsph/s1 (ph בינלאומי, n, byN, t)', DB.hsph.s1 && DB.hsph.s1.ph.stringValue === '972501234567' && DB.hsph.s1.byN.stringValue === 'm' && Object.keys(DB.hsph.s1).sort().join() === 'byN,n,ph,t', DB.hsph.s1);
  const wt = wa[0] ? decodeURIComponent(wa[0].split('?text=')[1] || '') : '';
  check('9ג נפתח wa.me/972501234567 עם רשימה: קוטג – כמות 4, חלב – כמות 3, הכלליים; בלי פרטי לקוח', /^https:\/\/wa\.me\/972501234567\?text=/.test(wa[0] || '') && /שלום תנובה/.test(wt) && /• קוטג 5% – כמות 4/.test(wt) && /• חלב 3% ליטר – כמות 3/.test(wt) && /• שקיות גדולות/.test(wt) && !/דני|0507654321/.test(wt), wa);
  await mp.evaluate(() => { window.__wa = []; }); await mp.click('[data-a=hsWa][data-id=s1]'); await sleep(400);
  check('9ד פעם שנייה – בלי לשאול טלפון, ישר לוואטסאפ', await mp.evaluate(() => window.__wa.length === 1 && !document.querySelector('#dlg[open] #hsPh')));
  // קובץ להדפסה ושיתוף
  const dl = mp.waitForEvent('download', { timeout: 5000 }).catch(() => null);
  await mp.click('[data-a=hsPdf][data-k=share][data-id=s2]'); const d = await dl;
  check('10 "קובץ לשיתוף": נוצר PDF', !!d && /\.pdf$/.test(d.suggestedFilename()), d && d.suggestedFilename());
  // הגיע ← הודעה ללקוח
  await mp.click('[data-a=hsTab][data-v=open]'); await sleep(300);
  const nid = Object.keys(DB.hsr).find((k) => DB.hsr[k].n.stringValue === 'חלב 3% ליטר');
  LOG.length = 0; await mp.click(`[data-a=hsArr][data-id=${nid}]`); await waitFor(() => mp.evaluate(() => !!document.querySelector('#dlg[open] [data-a=hsCustWa]')));
  const pa = LOG.find((l) => l.m === 'PATCH' && l.R === '/hsr/' + nid);
  check('11 "הגיע": PATCH רק st, h, ub, ut; st=arr, ub=m, h עם k=man, u=m ו-t=ut', pa && pa.q.split('&').map((s) => s.split('=')[1]).sort().join() === 'h,st,ub,ut' && pa.body.fields.st.stringValue === 'arr' && pa.body.fields.ub.stringValue === 'm' && pa.body.fields.h.arrayValue.values.slice(-1)[0].mapValue.fields.k.stringValue === 'man' && pa.body.fields.h.arrayValue.values.slice(-1)[0].mapValue.fields.u.stringValue === 'm' && pa.body.fields.h.arrayValue.values.slice(-1)[0].mapValue.fields.t.integerValue === pa.body.fields.ut.integerValue, pa && pa.q);
  await mp.evaluate(() => { window.__wa = []; }); await mp.click('#dlg [data-a=hsCustWa]'); await waitFor(() => mp.evaluate(() => window.__wa.length >= 1));
  const cw = await mp.evaluate(() => window.__wa[0] || '');
  check('11א הודעה ללקוח: wa.me/972507654321 עם "שלום דני" ושם המוצר', /^https:\/\/wa\.me\/972507654321\?text=/.test(cw) && /שלום דני/.test(decodeURIComponent(cw)) && /חלב 3% ליטר/.test(decodeURIComponent(cw)), cw);
  await mp.click('[data-a=hsTab][data-v=arr]'); await waitFor(() => mp.evaluate(() => document.querySelectorAll('.hs-it').length === 2));
  mt = await mainT(mp);
  check('12 "הגיעו": במבה וחלב, עם "הגיע · ..." וכפתור הודעה ללקוח', /במבה/.test(mt) && /חלב 3% ליטר/.test(mt) && /הגיע ·/.test(mt) && await mp.evaluate((id) => !!document.querySelector(`[data-a=hsCustWa][data-id=${id}]`), nid), mt.slice(0, 200));
  await mp.click(`[data-a=hsUndo][data-id=${nid}]`); await sleep(400);
  check('12א "החזר לחוסרים": st=open וחזר לפתוחים', DB.hsr[nid].st.stringValue === 'open' && DB.hsr[nid].h.arrayValue.values.slice(-1)[0].mapValue.fields.k.stringValue === 'undo');
  // מחיקה רכה ושחזור
  await mp.click('[data-a=hsTab][data-v=open]'); await sleep(300);
  await mp.click('[data-a=hsDel][data-id=g1]'); await sleep(200); await mp.click('#dlg [data-a=yes]'); await sleep(400);
  check('13 מחיקה: st=del (המסמך לא נמחק)', DB.hsr.g1 && DB.hsr.g1.st.stringValue === 'del' && !LOG.some((l) => l.m === 'DELETE' && l.R === '/hsr/g1'));
  await mp.click('[data-a=hsTab][data-v=del]'); await waitFor(() => mp.evaluate(() => !!document.querySelector('[data-a=hsRes][data-id=g1]')));
  await mp.click('[data-a=hsRes][data-id=g1]'); await sleep(400);
  check('13א שחזור: st=open', DB.hsr.g1.st.stringValue === 'open');
  // עריכה
  await mp.click('[data-a=hsTab][data-v=open]'); await sleep(300); await mp.click('[data-a=hsEdit][data-id=a1]'); await waitFor(() => mp.evaluate(() => cur().v === 'hsEd'));
  await mp.fill('input[data-i=hsQ]', ''); LOG.length = 0; await mp.click('form[data-f=hsSave] button:not([type])'); await waitFor(async () => LOG.some((l) => l.m === 'PATCH' && l.R === '/hsr/a1'));
  const pe = LOG.find((l) => l.m === 'PATCH' && l.R === '/hsr/a1');
  check('14 עריכה: by/byN/t לא נשלחים, ub/ut כן; כמות שנמחקה יורדת (במסכה, בלי ערך)', pe && !pe.body.fields.by && !pe.body.fields.byN && !pe.body.fields.t && pe.body.fields.ub.stringValue === 'm' && /updateMask.fieldPaths=q/.test(pe.q) && !pe.body.fields.q && DB.hsr.a1.by.stringValue === 'w1', pe && Object.keys(pe.body.fields));
  await waitFor(() => mp.evaluate(() => cur().v === 'hs')); await sleep(700); // אחרי אנימציית המעבר (main.sw)
  check('15 מנהל: אין גלילה לרוחב ואין שגיאות JS', await noOverflow(mp) && mp.__errors.length === 0, mp.__errors);
  await x.ctx.close();

  // ================= עובד =================
  x = await open('w-hs', 'w1@x.co'); let wp = x.page;
  await wp.evaluate((L) => { localStorage.setItem(CK, JSON.stringify(Object.assign(cfgLocal(), { cats: [{ id: 'e_sup', name: 'ספקים', beh: 'sup', subs: L }] }))); try { NAV = [{ v: 'wk' }]; render(0); } catch (e) { /* */ } }, SUPS);
  await waitFor(() => wp.evaluate(() => { const t = document.querySelector('#main .tile[data-v=hs] [data-hsn] .tag'); return !!t; }), 5000);
  const wt1 = await wp.evaluate(() => { const t = document.querySelector('#main .tile[data-v=hs]'); return t && { a: t.dataset.a, n: (t.querySelector('[data-hsn] .tag') || {}).innerText }; });
  check('16 עובד: משבצת "חוסרים" במסך הבית עם מונה', wt1 && wt1.a === 'go' && +wt1.n >= 3, wt1);
  const ws = await sheetTile(wp);
  check('16א עובד: גם במסך ה-+', ws && ws.a === 'addGo', ws);
  await wp.evaluate(() => sheetClose()); await wp.click('#main .tile[data-v=hs]'); await waitFor(() => wp.evaluate(() => cur().v === 'hs' && document.querySelectorAll('.hs-it').length > 0));
  await wp.click('[data-a=hsNew]'); await waitFor(() => wp.evaluate(() => cur().v === 'hsEd'));
  await wp.fill('input[data-i=hsN]', 'שוקו בקבוק'); await waitFor(() => wp.evaluate(() => !!document.querySelector('#hsSups [data-a=hsSupRm][data-id=s2]')), 3000);
  check('17 עובד: הצעת ספק מ-hsx (שנבנה אצל המנהל) – שטראוס', await wp.evaluate(() => !!document.querySelector('#hsSups [data-a=hsSupRm][data-id=s2]')));
  await wp.setInputFiles('input[data-c=hsFile]:not([capture])', { name: 'a.png', mimeType: 'image/png', buffer: Buffer.from(PNG.split(',')[1], 'base64') });
  await waitFor(() => wp.evaluate(() => !!document.querySelector('#hsImgP img')), 4000);
  check('17א תמונה מהגלריה: תצוגה מקדימה מוקטנת', await wp.evaluate(() => !!document.querySelector('#hsImgP img.hs-th')));
  await shot(wp, shots, 'hs-4-עובד-הוספה');
  LOG.length = 0; await wp.click('form[data-f=hsSave] button:not([type])'); await waitFor(async () => LOG.some((l) => l.m === 'PATCH' && /\/p\/1$/.test(l.R)), 5000);
  const wf = posts()[0] && posts()[0].body.fields, wpi = LOG.find((l) => l.m === 'PATCH' && /\/p\/1$/.test(l.R));
  check('18 עובד שמר: by=w1, byN=w1, np=1, ואז p/1 עם img (jpeg), t, uid=w1', wf && wf.by.stringValue === 'w1' && wf.byN.stringValue === 'w1' && wf.np.integerValue === '1' && wpi && /^data:image\/jpeg;base64,/.test(wpi.body.fields.img.stringValue) && wpi.body.fields.uid.stringValue === 'w1' && Object.keys(wpi.body.fields).sort().join() === 'img,t,uid' && wpi.R === '/hsr/' + posts()[0].q.split('documentId=')[1] + '/p/1', wpi && wpi.R);
  await waitFor(() => wp.evaluate(() => cur().v === 'hs'));
  const nw = posts()[0].q.split('documentId=')[1];
  await wp.click(`[data-a=hsImg][data-id=${nw}]`); await waitFor(() => wp.evaluate(() => !!document.querySelector('#dlg[open] img')));
  check('18א "תמונה": תצוגה מלאה עם כפתור שיתוף', await wp.evaluate(() => !!document.querySelector('#dlg[open] img') && !!document.querySelector('#dlg [data-a=hsImgShare]')));
  await wp.evaluate(() => closeDlg());
  check('19 עובד: אין גלילה לרוחב ואין שגיאות JS', await noOverflow(wp) && wp.__errors.length === 0, wp.__errors);
  await x.ctx.close();

  // ================= שלב 2: הורדה אוטומטית בקליטת חשבונית ספק =================
  const hv = (id) => { const h = DB.hsr[id].h; return h ? h.arrayValue.values.map((v) => Object.fromEntries(Object.entries(v.mapValue.fields).map(([k, x]) => [k, x.stringValue !== undefined ? x.stringValue : +(x.integerValue || x.doubleValue)]))) : []; };
  const stOf = (id) => DB.hsr[id].st.stringValue, qOf = (id) => DB.hsr[id].q ? +(DB.hsr[id].q.integerValue || DB.hsr[id].q.doubleValue) : null;
  const seed2 = () => { seed();
    DB.hsr.b1 = item({ n: S('חלב 3%'), nk: S('חלב 3'), sups: A(['s1']), supN: A(['תנובה']) });
    DB.hsr.d1 = item({ n: S('חלב'), nk: S('חלב'), sups: A(['s1']), supN: A(['תנובה']), t: I(T0 - 50 * 864e5) });
    DB.hsr.c1 = item({ n: S('יוגורט'), nk: S('יוגורט'), sups: A(['s2']), supN: A(['שטראוס']) });
    DB.hsr.e1 = item({ n: S('חלבה'), nk: S('חלבה'), sups: A(['s1']), supN: A(['תנובה']) }); };
  const INV1 = { id: 'iRQ1', sup: 'תנובה', supId: 's1', inv: '5001', date: '2026-11-01', lines: [{ n: "קוטג' 5% 250 גרם", qty: 2 }, { n: 'חלב 3% ליטר', qty: 6 }, { n: 'יוגורט פרי', qty: 3 }, { n: 'שקיות גדולות 50 יח', qty: 1 }] };
  seed2(); x = await open('m-hs2', 'm@x.co'); mp = x.page;
  await mp.evaluate((L) => { S.subs = S.subs.filter((s) => !/^s\d$/.test(s.id)); L.forEach((s) => S.subs.push({ id: s.id, cat: 'e_sup', name: s.name })); save(); }, SUPS);
  await mp.evaluate(() => go('hs')); await waitFor(() => mp.evaluate(() => document.querySelectorAll('.hs-it').length >= 5));
  STALE.add('b1'); LOG.length = 0;
  await mp.evaluate((d) => window.hsOnInv(d), INV1);
  await waitFor(() => mp.evaluate(() => !!document.getElementById('hsBn')), 5000);
  const pt = (id) => LOG.filter((l) => l.m === 'PATCH' && l.R === '/hsr/' + id);
  const ha = hv('a1').slice(-1)[0] || {}, hb = hv('b1').slice(-1)[0] || {};
  check('22 חשבונית: קוטג (נדרשו 4, הגיעו 2) – נשאר פתוח עם 2; רשומת part עם q0=4, q=2, מספר החשבונית והספק', stOf('a1') === 'open' && qOf('a1') === 2 && ha.k === 'part' && ha.q0 === 4 && ha.q === 2 && ha.pinv === 'iRQ1' && ha.inv === '5001' && ha.sup === 'תנובה' && ha.byN === 'm' && ha.u === 'm', { st: stOf('a1'), q: qOf('a1'), ha });
  check('22א חלב 3% (בלי כמות) – עבר ל"הגיע" עם רשומת inv; הפריט "חלב" הכללי יותר לא ירד', stOf('b1') === 'arr' && hb.k === 'inv' && hb.pinv === 'iRQ1' && hb.inv === '5001' && hb.t === +DB.hsr.b1.ut.integerValue && stOf('d1') === 'open' && !pt('d1').length, { b1: stOf('b1'), hb, d1: stOf('d1') });
  check('22ב פריט כללי (שקיות) ירד; יוגורט של ספק אחר ו"חלבה" (שם דומה) – לא', stOf('g1') === 'arr' && hv('g1').slice(-1)[0].k === 'inv' && stOf('c1') === 'open' && !pt('c1').length && stOf('e1') === 'open' && !pt('e1').length);
  const pa1 = pt('a1')[0], pb = pt('b1');
  check('22ג PATCH עם תנאי גרסה: part – רק q,h,ub,ut; inv – רק st,h,ub,ut', pa1 && /currentDocument\.updateTime=/.test(pa1.q) && u2m(pa1.q) === 'h,q,ub,ut' && pb.length && u2m(pb[pb.length - 1].q) === 'h,st,ub,ut', pa1 && pa1.q);
  check('22ד עדכון מקביל (גרסה ישנה) – נדחה, נקרא מחדש ונשמר פעם אחת בלבד', pb.length === 2 && hv('b1').filter((e) => e.pinv === 'iRQ1').length === 1 && LOG.some((l) => l.m === 'GET' && l.R === '/hsr/b1'), pb.length);
  const bn = await mp.evaluate(() => document.getElementById('hsBn').innerText);
  check('23 הודעה: "ירדו מהחוסרים (חשבונית 5001)" עם הפריטים, "נשארו 2" ו"בטל"', /ירדו מהחוסרים \(חשבונית 5001\)/.test(bn) && /חלב 3%/.test(bn) && /שקיות גדולות/.test(bn) && /קוטג 5% – הגיע חלקית, נשארו 2/.test(bn) && /בטל/.test(bn), bn);
  await shot(mp, shots, 'hs-5-ירד-מחשבונית');
  check('23א ההודעה בלי גלילה לרוחב (360px)', await noOverflow(mp));
  const n0 = LOG.filter((l) => l.m === 'PATCH').length;
  await mp.evaluate((d) => window.hsOnInv(d), INV1); await sleep(800);
  check('24 אותה חשבונית שוב – אין שום עדכון נוסף', LOG.filter((l) => l.m === 'PATCH').length === n0, LOG.filter((l) => l.m === 'PATCH').length - n0);
  mt = await mainT(mp);
  check('24א רשימת הפתוחים מתעדכנת: קוטג עם "הגיע חלקית בחשבונית #5001 … נשארו 2 מתוך 4" וכפתור ביטול', /הגיע חלקית בחשבונית #5001 · [^\n]* · m · נשארו 2 מתוך 4/.test(mt) && await mp.evaluate(() => !!document.querySelector('[data-a=hsUnp][data-id=a1]') && !document.querySelector('[data-hs=b1]')), mt.slice(0, 400));
  await mp.click('[data-a=hsTab][data-v=arr]'); await waitFor(() => mp.evaluate(() => /ירד אוטומטית/.test(document.getElementById('main').innerText)), 4000);
  mt = await mainT(mp);
  check('24ב "הגיעו": "ירד אוטומטית מחשבונית #5001 של תנובה" עם "החזר לחוסרים"', /ירד אוטומטית מחשבונית #5001 של תנובה · [^\n]* · m/.test(mt) && await mp.evaluate(() => !!document.querySelector('[data-a=hsUndo][data-id=b1]')), mt.slice(0, 300));
  // "בטל" בהודעה: הכול חוזר בדיוק למצב הקודם (הכמות 4, open), עם רשומות undo / unp
  LOG.length = 0; await mp.click('#hsBn [data-a=hsInvUndo]'); await waitFor(async () => stOf('b1') === 'open' && stOf('g1') === 'open' && qOf('a1') === 4, 4000);
  check('25 "בטל": חלב ושקיות חזרו לפתוחים (undo), קוטג חזר לכמות 4 (unp); ההודעה נסגרה', stOf('b1') === 'open' && hv('b1').slice(-1)[0].k === 'undo' && stOf('g1') === 'open' && qOf('a1') === 4 && hv('a1').slice(-1)[0].k === 'unp' && u2m(pt('a1')[0].q) === 'h,q,ub,ut' && await mp.evaluate(() => !document.getElementById('hsBn')), { b1: stOf('b1'), a1: qOf('a1'), h: hv('a1').slice(-1) });
  LOG.length = 0; await mp.evaluate((d) => window.hsOnInv(d), INV1); await sleep(800);
  check('25א אחרי ביטול – אותה חשבונית לא מורידה שוב', !LOG.some((l) => l.m === 'PATCH'));
  // חשבונית אחרת: חלקית ואז ביטול מהרשימה ("בטל הגעה חלקית")
  await mp.clock.setFixedTime(T0 + 600000); // אחרי ה"בטל" (חשבונית שנקלטה אחרי ההחזרה)
  await mp.evaluate((d) => window.hsOnInv(d), Object.assign({}, INV1, { id: 'iRQ2', inv: '5002', lines: [{ n: 'קוטג 5%', qty: 1 }] }));
  await waitFor(async () => qOf('a1') === 3, 4000); await mp.click('[data-a=hsTab][data-v=open]'); await sleep(300);
  await mp.click('[data-a=hsUnp][data-id=a1]'); await waitFor(async () => qOf('a1') === 4, 4000);
  check('26 "בטל הגעה חלקית" ברשימה – הכמות חוזרת ל-4', qOf('a1') === 4 && hv('a1').slice(-1)[0].k === 'unp');
  // הכללים דוחים (403) כי מישהו אחר שינה את הפריט במקביל: בהורדה האוטומטית – קריאה מחדש וניסיון אחד נוסף; במסך – רענון והודעה במקום שגיאה
  await mp.evaluate(() => ACT.hsBnX()); REJ.add('d1'); LOG.length = 0;
  await mp.evaluate((d) => window.hsOnInv(d), Object.assign({}, INV1, { id: 'iRQ4', inv: '5004', lines: [{ n: 'חלב', qty: 1 }] }));
  await waitFor(async () => stOf('d1') === 'arr', 4000);
  check('26א הורדה אוטומטית שנדחתה (403) – נקרא מחדש ונשמר בניסיון השני, פעם אחת', stOf('d1') === 'arr' && pt('d1').length === 2 && LOG.some((l) => l.m === 'GET' && l.R === '/hsr/d1') && hv('d1').filter((e) => e.pinv === 'iRQ4').length === 1, pt('d1').length);
  await mp.evaluate(() => { ACT.hsBnX(); go('hs'); }); await mp.click('[data-a=hsTab][data-v=open]'); await sleep(300);
  REJ.add('c1'); LOG.length = 0; await mp.click('[data-a=hsArr][data-id=c1]'); await sleep(600);
  check('26ב "הגיע" ידני שנדחה (403) – הודעה "עודכן במכשיר אחר" והרשימה נטענת מחדש, לא "יופעלו בקרוב"', /עודכן במכשיר אחר/.test(await toasts(mp)) && !/יופעלו בקרוב/.test(await toasts(mp)) && LOG.some((l) => l.coll === 'hsr') && stOf('c1') === 'open', await toasts(mp));
  // 403 בזמן ההורדה – בלי קריסה ובלי הודעה
  await mp.evaluate(() => ACT.hsBnX()); F403 = true;
  await mp.evaluate((d) => window.hsOnInv(d), Object.assign({}, INV1, { id: 'iRQ3' })); await sleep(800); F403 = false;
  check('27 403 בזמן ההורדה – שום דבר לא נשבר, אין הודעה, אין שגיאות JS', await mp.evaluate(() => !document.getElementById('hsBn')) && mp.__errors.length === 0, mp.__errors);
  check('27א קלט פגום ל-hsOnInv (מזהה עם נתיב / null) – בלי בקשות ובלי שגיאות', await mp.evaluate(() => { window.hsOnInv(null); window.hsOnInv({ id: '../x', lines: [] }); return true; }) && mp.__errors.length === 0);
  await x.ctx.close();

  // ---- השלמה אצל המנהל: חשבוניות (pinv) שנקלטו ולא טופלו ----
  seed2();
  DB.pinv.push({ supId: S('s1'), sup: S('תנובה'), inv: S('6001'), st: S('new'), at: I(T0 - 2000), lines: { arrayValue: { values: [M({ n: S('חלב 3% ליטר'), qty: I(1) })] } } });
  DB.pinv.push({ supId: S('s1'), sup: S('תנובה'), inv: S('6002'), st: S('void'), at: I(T0 - 2000), lines: { arrayValue: { values: [M({ n: S('קוטג 5%'), qty: I(9) })] } } });
  DB.pinv.push({ supId: S('s1'), sup: S('תנובה'), inv: S('6003'), st: S('new'), at: I(T0 - 40 * 864e5), lines: { arrayValue: { values: [M({ n: S('חלב'), qty: I(1) })] } } });
  x = await open('m-hs3', 'm@x.co'); mp = x.page;
  await mp.evaluate((L) => { S.subs = S.subs.filter((s) => !/^s\d$/.test(s.id)); L.forEach((s) => S.subs.push({ id: s.id, cat: 'e_sup', name: s.name })); save(); }, SUPS);
  await mp.evaluate(() => go('hs')); await waitFor(async () => stOf('b1') === 'arr', 6000);
  const pq = LOG.find((l) => l.coll === 'pinv');
  check('28 השלמה: חשבונית שנקלטה ולא טופלה – חלב 3% ירד (pinv = מזהה החשבונית, מספר 6001)', stOf('b1') === 'arr' && hv('b1').slice(-1)[0].inv === '6001' && /^i\d$/.test(hv('b1').slice(-1)[0].pinv) && pq && pq.body.structuredQuery.select.fields.map((f) => f.fieldPath).sort().join() === 'at,inv,lines,st,sup,supId', hv('b1'));
  check('28א חשבונית מבוטלת (void) וחשבונית מלפני 30 יום – לא מורידות', stOf('a1') === 'open' && qOf('a1') === 4 && stOf('d1') === 'open');
  check('28ב אין שגיאות JS', mp.__errors.length === 0, mp.__errors);
  await x.ctx.close();

  // ================= חלון "להוסיף גם לרשימת החוסרים?" אחרי "להזמין מספק" בליקוט (window.hsAskSo) =================
  seed(); x = await open('m-hsask', 'm@x.co'); mp = x.page;
  await mp.evaluate((L) => { S.subs = S.subs.filter((s) => !/^s\d$/.test(s.id)); L.forEach((s) => S.subs.push({ id: s.id, cat: 'e_sup', name: s.name })); save(); }, SUPS);
  const O5 = { id: 'o5', no: 5, cust: { name: 'רותי', phone: '052-1112233' }, custId: 'c7' };
  const R5 = [{ n: 'שמנת 15%', qty: 2, sup: 'תנובה' }, { n: 'מלח ים', qty: 1, sup: 'ספק לא מוכר' }, { n: 'סוכר', qty: 3, sup: 'שטראוס' }];
  const dlgRows = () => mp.evaluate(() => [...document.querySelectorAll('#dlg[open] input[data-hso]')].map((i) => ({ c: i.checked, t: i.closest('label').innerText.replace(/\s+/g, ' ').trim() })));
  LOG.length = 0; await mp.evaluate((a) => { window.hsAskSo(a[0], a[1]); }, [O5, R5]);
  await waitFor(async () => (await dlgRows()).length === 3);
  let dr = await dlgRows();
  check('28 אחרי סימון "להזמין מספק": חלון "להוסיף גם לרשימת החוסרים?" עם 3 המוצרים, כולם מסומנים, ספק לכל מוצר (לא מוכר = כללי)', dr.length === 3 && dr.every((r) => r.c) && /להוסיף גם לרשימת החוסרים/.test(await mp.evaluate(() => document.getElementById('dlg').innerText)) && /שמנת 15% · כמות 2 ספק: תנובה/.test(dr[0].t) && /מלח ים[\s\S]*פריט כללי/.test(dr[1].t) && await mp.evaluate(() => !!document.querySelector('#dlg [data-a=hsSoAdd]') && !!document.querySelector('#dlg [data-a=hsSoNo]')), dr);
  check('28א עד הלחיצה – שום דבר לא נשמר', !posts().length);
  await shot(mp, shots, 'hs-6-חלון-אחרי-ליקוט');
  check('28ב החלון בלי גלילה לרוחב (360px)', await noOverflow(mp));
  await mp.uncheck('#dlg input[data-hso="2"]'); await mp.click('#dlg [data-a=hsSoAdd]'); await waitFor(async () => posts().length >= 2 && await mp.evaluate(() => !document.querySelector('#dlg[open]')));
  const pf = posts().map((l) => l.body.fields), fsh = pf.find((f) => f.n.stringValue === 'שמנת 15%'), fml = pf.find((f) => f.n.stringValue === 'מלח ים');
  check('29 "הוסף": נוצרו רק 2 המסומנים (סוכר לא), בשדות החוזה בלבד + ord', pf.length === 2 && fsh && fml && !pf.some((f) => f.n.stringValue === 'סוכר') && Object.keys(fsh).sort().join() === 'by,byN,cust,gen,n,nk,np,ord,q,st,sups,supN,t,why'.split(',').sort().join(), pf.map((f) => Object.keys(f).sort().join()));
  check('29א שמנת: ספק תנובה (s1), why=order, כמות 2, מקושר להזמנה #5 (o5), פרטי הלקוח (טלפון ספרות, cid)', fsh && fsh.sups.arrayValue.values.map((v) => v.stringValue).join() === 's1' && fsh.supN.arrayValue.values[0].stringValue === 'תנובה' && fsh.gen.booleanValue === false && fsh.why.stringValue === 'order' && fsh.q.integerValue === '2'
    && fsh.ord.mapValue.fields.id.stringValue === 'o5' && fsh.ord.mapValue.fields.no.integerValue === '5' && fsh.cust.mapValue.fields.nm.stringValue === 'רותי' && fsh.cust.mapValue.fields.ph.stringValue === '0521112233' && fsh.cust.mapValue.fields.cid.stringValue === 'c7' && fsh.st.stringValue === 'open' && fsh.by.stringValue === 'm', fsh);
  check('29ב מלח ים (ספק לא מוכר) – פריט כללי, בלי ספקים, מקושר להזמנה', fml && fml.gen.booleanValue === true && !(fml.sups.arrayValue.values || []).length && fml.ord.mapValue.fields.id.stringValue === 'o5', fml);
  check('29ג הודעה "נוספו 2 פריטים לחוסרים" והמונה מתעדכן (4)', /נוספו 2 פריטים לחוסרים/.test(await toasts(mp)) && (await sheetTile(mp) || {}).n === '4', await toasts(mp));
  await mp.evaluate(() => sheetClose());
  // שוב אותה הזמנה: רק סוכר מוצע (שמנת ומלח כבר פתוחים ומקושרים); "לא עכשיו" – לא נוצר כלום
  LOG.length = 0; await mp.evaluate((a) => { window.hsAskSo(a[0], a[1]); }, [O5, R5]);
  await waitFor(async () => (await dlgRows()).length > 0); dr = await dlgRows();
  check('30 בלי כפילות: פריט פתוח שמקושר לאותה הזמנה ולאותו מוצר – לא מוצע שוב (רק סוכר)', dr.length === 1 && /סוכר/.test(dr[0].t), dr);
  await mp.click('#dlg [data-a=hsSoNo]'); await sleep(500);
  check('30א "לא עכשיו": החלון נסגר ולא נוצר שום פריט', !posts().length && await mp.evaluate(() => !document.querySelector('#dlg[open]')));
  LOG.length = 0; await mp.evaluate((a) => { window.hsAskSo(a[0], a[1].slice(0, 2)); }, [O5, R5]); await sleep(800);
  check('30ב כל המוצרים כבר בחוסרים – אין חלון ואין יצירה', !posts().length && await mp.evaluate(() => !document.querySelector('#dlg[open]')));
  // הכללים לא פורסמו (403) – אין חלון, בלי שגיאות
  F403 = true; LOG.length = 0; await mp.evaluate((a) => { window.hsAskSo(a[0], a[1]); }, [Object.assign({}, O5, { id: 'o6' }), R5]); await sleep(800); F403 = false;
  check('31 403 (הכללים לא פורסמו) – אין חלון ואין יצירה, בלי שגיאות JS', !posts().length && await mp.evaluate(() => !document.querySelector('#dlg[open]')) && mp.__errors.length === 0, mp.__errors);
  await x.ctx.close();

  // ================= כללים שלא פורסמו (403) =================
  seed(); F403 = true; x = await open('m-hs403', 'm@x.co'); mp = x.page;
  t = await sheetTile(mp); await sleep(800); t = await sheetTile(mp);
  check('20 403: המשבצת מוצגת בלי מונה ובלי קריסה', t && t.n === '', t);
  await mp.click('#sheet .tile[data-v=hs]'); await sleep(800);
  check('20א 403: "החוסרים יופעלו בקרוב", בלי שגיאות JS', /החוסרים יופעלו בקרוב/.test(await mainT(mp)) && mp.__errors.length === 0, mp.__errors);
  await x.ctx.close();

  // ================= תוספת "ספקים" כבויה =================
  seed(); x = await open('m-hsoff', 'm@x.co', FT({ suppliers: false })); mp = x.page;
  t = await sheetTile(mp); await sleep(600);
  check('21 תוספת כבויה: אין משבצת ואין שום בקשה ל-hsr/hsx/hsph', !t && !LOG.length, { t, n: LOG.length });
  LOG.length = 0; await mp.evaluate(() => { window.hsAskSo({ id: 'o5', no: 5 }, [{ n: 'שמנת', qty: 1, sup: 'תנובה' }]); }); await sleep(600);
  check('21ב תוספת כבויה: אחרי ליקוט אין חלון "להוסיף לחוסרים" ואין בקשות', !LOG.length && await mp.evaluate(() => !document.querySelector('#dlg[open]')), LOG.length);
  check('21א ניווט ישיר: "המסך הזה לא זמין", בלי שגיאות JS', await mp.evaluate(() => { go('hs'); return /לא זמין/.test(document.getElementById('main').innerText); }) && mp.__errors.length === 0, mp.__errors);
  await x.ctx.close();

  await browser.close();
  console.log(fail ? 'תוצאה: ' + fail + ' נכשלו' : 'כל הבדיקות עברו'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
