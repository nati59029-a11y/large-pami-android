'use strict';
// סבב 4, חבילה ב' (18.11.2026): (1) לעובד תמיד משימה אחת במסך, "הבאה ›" אחרי סיום, "כל המשימות (N)", הכרטיס הנעוץ נשאר בראש, מסך "אין משימות כרגע ✓";
// (2) "עבור ואשר (N)" למנהל: מעבר ברצף, החזרת משימה אחת, "אשר את כל השאר (M)"; (3) תבניות בענן (tkt): שמירה עם תמונה, בחירה, "העבר לענן", ושרת ישן (403).
// רשת מדומה, בלי אמולטור. שימוש: node ui-r4b.js <www-dir> [shots-dir]
const fs = require('fs'); const path = require('path'); const H = require('./harness');
const BZ0 = ['larg', 'peami'].join('');
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
let fail = 0; const check = (n, ok, info) => { if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// "הגדרות נוספות" בטופס המשימה (1f7a255) – התבניות בפנים; פותחים דרך הכפתור אם סגור
const advOpen = async (pg) => { if (await pg.evaluate(() => !window.TKADV && !!document.querySelector('[data-a=tkAdv]'))) { await pg.click('[data-a=tkAdv]'); await sleep(300); } };
const S = (v) => ({ stringValue: String(v) }), I = (v) => ({ integerValue: String(v) }), A = (a) => ({ arrayValue: { values: a.map(S) } });
const T0 = H.T0, D1 = 864e5, H1 = 36e5;
const DOCS = 'projects/demo-largpeami/databases/(default)/documents/';
const IMG = 'data:image/jpeg;base64,' + 'QUJD'.repeat(120);
let DB, LOG, K403 = false, HOLD = null;
const reset = () => { DB = { tasks: {}, ptk: {}, rtk: {}, rq: {}, staff: {}, tkt: {} }; LOG = []; };
const docOf = (col, id) => ({ name: DOCS + col + '/' + id, fields: DB[col][id], createTime: '2026-11-03T09:00:00Z', updateTime: '2026-11-03T09:00:00Z' });
const MINE = new Set(['tasks', 'ptk', 'rtk', 'rq']);
async function mockCloud(ctx, who) {
  await ctx.route((u) => new URL(u).port === '8080', async (route) => {
    const req = route.request(), u = new URL(req.url()), m = req.method(), p = decodeURIComponent(u.pathname), body = req.postData() || '';
    const i = p.indexOf('/documents'); if (i < 0) return route.fallback(); const rest = p.slice(i + 10);
    const ok = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    const err = (c, s) => route.fulfill({ status: c, contentType: 'application/json', body: JSON.stringify({ error: { code: c, message: s, status: s } }) });
    if (rest === '/rv/tk2') return err(404, 'NOT_FOUND');
    if (rest === ':runQuery') {
      let q = {}; try { q = JSON.parse(body).structuredQuery; } catch (e) { /* */ }
      const c = q.from && q.from[0].collectionId; if (!MINE.has(c)) return route.fallback();
      let ids = Object.keys(DB[c]); const w = q.where && q.where.fieldFilter;
      if (w) ids = ids.filter((id) => { const v = DB[c][id][w.field.fieldPath]; const sv = v && v.stringValue; return w.op === 'IN' ? w.value.arrayValue.values.some((x) => x.stringValue === sv) : sv === w.value.stringValue; });
      return ok(ids.length ? ids.map((id) => ({ document: docOf(c, id), readTime: 'x' })) : [{ readTime: 'x' }]);
    }
    if (m === 'GET' && rest.split('?')[0] === '/staff') return ok({ documents: Object.keys(DB.staff).map((id) => docOf('staff', id)) });
    const s = rest.split('?')[0].split('/').filter(Boolean);
    // תבניות בענן (tkt) ותמונת הדוגמה (tkt/{id}/p/1); K403 = שרת ישן
    if (s[0] === 'tkt') {
      if (K403) { LOG.push({ who, m, col: 'tkt', st: 403 }); return err(403, 'PERMISSION_DENIED'); }
      if (s.length === 1) { if (m === 'GET') { LOG.push({ who, m, col: 'tkt', list: 1 }); return ok({ documents: Object.keys(DB.tkt).map((k) => docOf('tkt', k)) }); }
        if (m === 'POST') { const nid = u.searchParams.get('documentId'); DB.tkt[nid] = JSON.parse(body).fields; LOG.push({ who, m, col: 'tkt', id: nid, f: DB.tkt[nid] }); return ok(docOf('tkt', nid)); } }
      if (s.length === 2) { const id = s[1];
        if (m === 'GET') return DB.tkt[id] ? ok(docOf('tkt', id)) : err(404, 'NOT_FOUND');
        if (m === 'DELETE') { delete DB.tkt[id]; LOG.push({ who, m, col: 'tkt', id, del: 1 }); return ok({}); }
        if (m === 'PATCH') { if (!DB.tkt[id]) return err(404, 'NOT_FOUND'); const f = JSON.parse(body).fields; const mask = u.searchParams.getAll('updateMask.fieldPaths'); for (const k of mask) DB.tkt[id][k] = f[k]; LOG.push({ who, m, col: 'tkt', id, mask, f }); return ok(docOf('tkt', id)); } }
      if (s.length === 4 && s[2] === 'p') { const col = 'tkt/' + s[1] + '/p'; DB[col] = DB[col] || {};
        if (m === 'GET') return DB[col][s[3]] ? ok(docOf(col, s[3])) : err(404, 'NOT_FOUND');
        if (m === 'PATCH') { if (DB[col][s[3]]) return err(403, 'PERMISSION_DENIED'); DB[col][s[3]] = JSON.parse(body).fields; LOG.push({ who, m, col, id: s[3], f: DB[col][s[3]] }); return ok(docOf(col, s[3])); }
        if (m === 'DELETE') { delete DB[col][s[3]]; LOG.push({ who, m, col, id: s[3], del: 1 }); return ok({}); } }
      return route.fallback();
    }
    // תמונות משימה (tasks/{id}/p)
    if (s[0] === 'tasks' && s[2] === 'p' && s.length === 3 && m === 'GET') { if (HOLD && s[1] === 'a3') await HOLD; const col = 'tasks/' + s[1] + '/p'; DB[col] = DB[col] || {}; return ok({ documents: Object.keys(DB[col]).map((k) => docOf(col, k)) }); }
    const col = s[0], id = s[1];
    if (!MINE.has(col) || s.length > 2) return route.fallback();
    if (m === 'GET') return id ? (DB[col][id] ? ok(docOf(col, id)) : err(404, 'NOT_FOUND')) : ok({ documents: Object.keys(DB[col]).map((k) => docOf(col, k)) });
    if (m === 'POST') { const nid = u.searchParams.get('documentId'); DB[col][nid] = JSON.parse(body).fields; LOG.push({ who, m, col, id: nid, f: DB[col][nid] }); return ok(docOf(col, nid)); }
    if (m === 'PATCH') { const mask = u.searchParams.getAll('updateMask.fieldPaths'); if (!DB[col][id]) return err(404, 'NOT_FOUND'); const f = JSON.parse(body).fields; const ch = {};
      for (const k of mask) { if (k.includes('.')) continue; DB[col][id][k] = f[k]; ch[k] = f[k]; } LOG.push({ who, m, col, id, f: ch, mask }); return ok(docOf(col, id)); }
    return route.fallback();
  });
}
const task = (id, o) => { DB.tasks[id] = Object.assign({ owner: S('m'), by: S('m'), role: S('a'), txt: S('משימה ' + id), cr: I(T0 - D1), due: I(T0 + D1), st: S('open'), open: S('1'), pr: S(''), sub: I(0), doneBy: S(''), note: S(''), ok: I(0), late: S(''), to: A(['w1']), toN: A(['עובד א']), ow: S('w1'), owN: S('עובד א'), clt: I(T0 - D1), np: I(0), wp: I(0), mi: I(0) }, o || {}); };
const shot = async (page, dir, name) => { if (!dir) return; fs.mkdirSync(dir, { recursive: true }); await page.waitForTimeout(250); await page.screenshot({ path: path.join(dir, name + '.png'), fullPage: false }); };
const txt = (page, sel) => page.evaluate((s) => (document.querySelector(s) || {}).innerText || '', sel);
const waitFor = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 4000)) { if (await fn()) return true; await sleep(60); } return false; };
const dlgOpen = (page) => page.evaluate(() => { const d = document.getElementById('dlg'); return !!(d && d.open); });
const dtxt = (page) => page.evaluate(() => (document.getElementById('dlg') || {}).innerText || '');
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const yes = async (page) => { await waitFor(() => dlgOpen(page)); await page.click('#dlg [data-a=yes]'); await sleep(300); };

(async () => {
  const [www, shots] = process.argv.slice(2); const browser = await H.launch();
  const cfg = { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: ALL } }, admins: { '|m': 1 }, staff: { '|w1': 1, '|w2': 1 } };
  const open = async (label, email) => { const x = await H.newPage(browser, www, cfg, [], label); await x.page.setViewportSize({ width: 412, height: 900 });
    await mockCloud(x.ctx, email.split('@')[0]); await H.login(x.page, email); if (await x.page.$('[data-a=startBlank]')) { await x.page.click('[data-a=startBlank]'); await sleep(300); }
    await sleep(1200); if (await dlgOpen(x.page)) { await x.page.evaluate(() => closeDlg()); await sleep(150); } return x; };
  const seedBase = () => { reset(); DB.staff.w1 = { name: S('עובד א'), email: S('w1@x.co'), active: { booleanValue: true } }; DB.staff.w2 = { name: S('עובד ב'), email: S('w2@x.co'), active: { booleanValue: true } }; };

  // ================= עובד: משימה אחת =================
  seedBase();
  task('t1', { txt: S('לסדר את המדף'), due: I(T0 + H1) });
  task('t2', { txt: S('לנקות את הדלפק'), due: I(T0 + 2 * D1) });
  task('t3', { txt: S('משימה שנדחתה'), due: I(T0 + 3 * D1) });
  let w = await open('w-r4b', 'w1@x.co'); let wp = w.page;
  await wp.evaluate(() => { localStorage.setItem(LK('lp-snz-' + SY.uid), JSON.stringify({ 't:t3': Date.now() + 36e5 })); window.drPin = () => '<div class="card" id="pin-x">דיווח יומי – נעוץ</div>'; go('tk'); }); await sleep(1100);
  let t = await txt(wp, '#main');
  const one = await wp.evaluate(() => ({ cards: document.querySelectorAll('#main [id^=tkc-]').length, first: (document.querySelector('#main [id^=tkc-]') || {}).id, pinFirst: !!document.querySelector('#pin-x') && !!(document.querySelector('#pin-x').compareDocumentPosition(document.querySelector('#main [id^=tkc-]')) & Node.DOCUMENT_POSITION_FOLLOWING), btn: (document.querySelector('[data-a=tkwAll]') || {}).innerText || '' }));
  check('1 לעובד משימה אחת במסך (הדחופה ביותר), בלי רשימת "אחר כך" (הבאות בתור – שורות)', one.cards === 1 && one.first === 'tkc-t1' && /לסדר את המדף/.test(t) && !/אחר כך/.test(t), one); // סבב 5: השנייה מופיעה ב"הבאות בתור" (שורה, לא כרטיס)
  check('1א הכרטיס הנעוץ של הדיווח היומי נשאר בראש המסך (לפני המשימה)', one.pinFirst, one);
  check('1ב כפתור "כל המשימות (2)"', /כל המשימות \(2\)/.test(one.btn), one.btn);
  await shot(wp, shots, 'r4-ב-מסך-עובד');
  await wp.click('[data-a=tkwAll]'); await sleep(400);
  t = await txt(wp, '#main');
  check('2 "כל המשימות" פותח את הרשימה הקיימת: עכשיו + אחר כך, וכפתור חזרה', /אחר כך/.test(t) && /לנקות את הדלפק/.test(t) && /חזרה למשימה הנוכחית/.test(t));
  await wp.click('[data-a=tkwOne]'); await sleep(300);
  check('2א "חזרה למשימה הנוכחית" מחזירה למסך המשימה האחת', (await wp.evaluate(() => document.querySelectorAll('#main [id^=tkc-]').length)) === 1 && !/אחר כך/.test(await txt(wp, '#main')));
  // סיום משימה ← "בוצע" + "הבאה ›"
  LOG.length = 0;
  await wp.click('#tkc-t1 [data-a=tkDone]'); await yes(wp);
  await waitFor(() => wp.evaluate(() => !!document.getElementById('tkw-fin')));
  t = await txt(wp, '#main');
  check('3 אחרי סיום: מסך "בוצע" עם "הבאה ›" (ללא המשימה הבאה לפני הלחיצה)', /בוצע/.test(t) && /הבאה ›/.test(t) && /לסדר את המדף/.test(t) && !(await wp.$('#tkc-t2')), t.slice(0, 200));
  check('3א נכתב PATCH למשימה t1 (st=done)', LOG.some((l) => l.m === 'PATCH' && l.col === 'tasks' && l.id === 't1' && l.f.st && l.f.st.stringValue === 'done'));
  await shot(wp, shots, 'r4-ב-מסך-עובד-בוצע');
  await wp.click('[data-a=tkwNext]'); await sleep(400);
  check('4ב נשארה משימה פעילה אחת ויש משימה שנדחתה: "כל המשימות" מוצג ופותח אותה', /כל המשימות \(1\)/.test(await txt(wp, '#main')));
  check('4 "הבאה ›": המשימה הבאה במסך מלא', (await wp.evaluate(() => (document.querySelector('#main [id^=tkc-]') || {}).id)) === 'tkc-t2' && !(await wp.$('#tkw-fin')));
  await wp.click('#tkc-t2 [data-a=tkDone]'); await yes(wp);
  await waitFor(() => wp.evaluate(() => !!document.getElementById('tkw-empty')));
  t = await txt(wp, '#main');
  check('5 כשאין משימות פתוחות: "אין משימות כרגע ✓"', /אין משימות כרגע ✓/.test(t) && !(await wp.$('[data-a=tkwAll]')) && !(await wp.$('#tkw-fin')), t.slice(0, 200));
  await shot(wp, shots, 'r4-ב-מסך-עובד-ריק');
  check('5א 412px: אין גלילה אופקית; אין שגיאות JS (עובד)', (await noOverflow(wp)) && wp.__errors.length === 0, wp.__errors);
  await w.ctx.close();

  // ================= מנהל: עבור ואשר =================
  seedBase();
  [['a1', 3], ['a2', 2], ['a3', 1]].forEach(([id, h]) => task(id, { txt: S('משימה לאישור ' + id), st: S('wait'), sub: I(T0 - h * H1), doneBy: S('עובד א'), np: I(1), wp: I(1) }));
  task('o1', { txt: S('משימה פתוחה') });
  DB['tasks/a1/p'] = { w1: { img: S(IMG), t: I(T0), uid: S('w1') } }; DB['tasks/a2/p'] = { w1: { img: S(IMG), t: I(T0), uid: S('w1') } }; DB['tasks/a3/p'] = { w1: { img: S(IMG), t: I(T0), uid: S('w1') }, w2: { img: S(IMG), t: I(T0), uid: S('w1') } };
  let m = await open('m-r4b', 'm@x.co'); let mp = m.page;
  await mp.evaluate(() => { go('tk'); TKT = 'team'; rerender(); }); await sleep(900); await mp.evaluate(() => tkLoad().then(() => rerender())); await sleep(800);
  const ab = await mp.evaluate(() => (document.querySelector('[data-a=tkwApGo]') || {}).innerText || '');
  check('6 למנהל: כפתור "עבור ואשר (3)" כשיש משימות שממתינות לאישור', /עבור ואשר \(3\)/.test(ab), ab);
  await shot(mp, shots, 'r4-ב-מנהל-עבור-ואשר-כפתור');
  await mp.click('[data-a=tkwApGo]'); await waitFor(() => mp.evaluate(() => document.querySelectorAll('#dlg img').length >= 1));
  let d = await dtxt(mp);
  const im1 = await mp.evaluate(() => document.querySelectorAll('#dlg img').length);
  check('7 מעבר ברצף: משימה 1 מתוך 3 עם התמונה בגדול (הוותיקה ביותר קודם)', /משימה 1 מתוך 3/.test(d) && /a1/.test(d) && im1 === 1, d.slice(0, 120));
  await shot(mp, shots, 'r4-ב-מנהל-עבור-ואשר');
  check('7א אין כפתור "אשר את כל השאר" לפני שעברו על כולן', !/אשר את כל השאר/.test(d));
  let rel; HOLD = new Promise((r) => { rel = r; });
  await mp.click('#dlg [data-a=tkwApNext]'); await waitFor(async () => /משימה 2 מתוך 3/.test(await dtxt(mp)));
  LOG.length = 0;
  await mp.click('#dlg [data-a=tkwApRj]'); await sleep(200);
  await mp.fill('#dlg textarea[name=note]', 'התמונה מטושטשת');
  rel(); HOLD = null; await sleep(900);
  check('7ב טעינת תמונות מסתיימת בזמן שהמנהל מקליד הערה ב"החזר לעובד": ההערה נשמרת והטופס נשאר פתוח', (await mp.evaluate(() => (document.querySelector('#dlg textarea[name=note]') || {}).value)) === 'התמונה מטושטשת'); await mp.click('#dlg form[data-f=tkApRej] button.r');
  await waitFor(async () => /משימה 3 מתוך 3/.test(await dtxt(mp)) && LOG.some((l) => l.m === 'PATCH' && l.col === 'tasks' && l.id === 'a2'));
  const rj = LOG.find((l) => l.m === 'PATCH' && l.col === 'tasks' && l.id === 'a2');
  check('8 "החזר לעובד" למשימה אחת: אותה כתיבה כמו ההחזרה הקיימת (st=open, note, rt=1, wp=0, בלי אישור)', !!rj && rj.f.st.stringValue === 'open' && rj.f.note.stringValue === 'התמונה מטושטשת' && rj.f.rt.stringValue === '1' && rj.f.wp.integerValue === '0' && rj.f.sub.integerValue === '0', rj && rj.f);
  check('8א אחרי ההחזרה עוברים למשימה הבאה (3 מתוך 3)', /משימה 3 מתוך 3/.test(await dtxt(mp)) && (await mp.evaluate(() => document.querySelectorAll('#dlg img').length)) === 2);
  await mp.click('#dlg [data-a=tkwApNext]'); await waitFor(async () => /אשר את כל השאר/.test(await dtxt(mp)));
  d = await dtxt(mp);
  check('9 בסוף: "אשר את כל השאר (2)" והחזרה אחת מדווחת', /אשר את כל השאר \(2\)/.test(d) && /הוחזרו לעובד: 1/.test(d), d.slice(0, 200));
  await shot(mp, shots, 'r4-ב-מנהל-עבור-ואשר-סיום');
  LOG.length = 0; await mp.click('#dlg [data-a=tkwApAll]'); await waitFor(async () => LOG.filter((l) => l.m === 'PATCH' && l.col === 'tasks' && l.f.st && l.f.st.stringValue === 'done').length >= 2, 6000); await sleep(500);
  const oks = LOG.filter((l) => l.m === 'PATCH' && l.col === 'tasks' && l.f.st && l.f.st.stringValue === 'done').map((l) => l.id).sort();
  check('9א אושרו בדיוק a1 ו-a3 (אותה כתיבה כמו "אשר": st=done, ok, note ריק); a2 (הוחזרה) לא אושרה', oks.join() === 'a1,a3' && DB.tasks.a2.st.stringValue === 'open' && LOG.filter((l) => l.id === 'a1')[0].f.note.stringValue === '', oks);
  check('9ב אחרי האישור אין "עבור ואשר" (אין משימות שממתינות)', !(await mp.$('[data-a=tkwApGo]')));
  // מנהל – ללא שינוי: מסך "היום שלי" של מנהל לא עבר למשימה אחת
  await mp.evaluate(() => { TKT = 'my'; rerender(); }); await sleep(400);
  check('10 מנהל: אין "כל המשימות" / "הבאה ›" (מסך המנהל ללא שינוי)', !(await mp.$('[data-a=tkwAll]')) && !(await mp.$('[data-a=tkwNext]')));
  check('10א אין שגיאות JS (מנהל)', mp.__errors.length === 0, mp.__errors);
  await m.ctx.close();

  // ================= מנהל: תבניות בענן =================
  seedBase(); K403 = false;
  let tm = await open('m2-r4b', 'm@x.co'); let tp = tm.page;
  await tp.evaluate(() => { TKT = 'my'; go('tk'); }); await sleep(900);
  await tp.evaluate(() => { const f = document.querySelector('[data-a=tkwFold]'); if (f) f.click(); }); await sleep(400);
  // מאז 1f7a255 התבניות נמצאות בתוך "הגדרות נוספות" (tkAdv, סגור כברירת מחדל) – פותחים אותו קודם דרך הכפתור
  const openTpl = async () => { await advOpen(tp); return openTpl0(); };
  const openTpl0 = () => tp.evaluate(() => { const d = [...document.querySelectorAll('details')].find((x) => /תבניות/.test((x.querySelector('summary') || {}).innerText || '')); if (d) d.open = true; return !!d; });
  check('11 מנהל: ההגדרות נטענות מהענן (GET של tkt) והסעיף "תבניות" קיים', (await openTpl()) && LOG.some((l) => l.col === 'tkt' && l.list), LOG.filter((l) => l.col === 'tkt'));
  await tp.fill('form[data-f=tkAdd] textarea', 'לנקות את המקרר היטב');
  await tp.evaluate(() => { TKN.imgs = ['IMGX']; }); await tp.evaluate((i) => { TKN.imgs = [i]; }, IMG);
  await openTpl(); LOG.length = 0;
  await tp.click('[data-a=tkwTplSave]'); await waitFor(() => LOG.filter((l) => l.col === 'tkt' || /tkt/.test(l.col || '')).length >= 3, 5000); await sleep(400);
  const tk0 = Object.keys(DB.tkt)[0], tf = DB.tkt[tk0] || {};
  const OKF = ['txt', 't', 'to', 'np', 'dk', 'pri', 'cat', 'est', 'ck', 'im', 'by'];
  check('12 שמירה כתבנית: מסמך tkt עם הטקסט, שדות מותרים בלבד, ותמונה ב-tkt/{id}/p/1 ואז im=1', Object.keys(DB.tkt).length === 1 && tf.txt.stringValue === 'לנקות את המקרר היטב' && Object.keys(tf).every((k) => OKF.includes(k)) && tf.im.integerValue === '1' && !!(DB['tkt/' + tk0 + '/p'] || {})[1] && DB['tkt/' + tk0 + '/p'][1].img.stringValue === IMG, { tf: Object.keys(tf), p: Object.keys(DB['tkt/' + tk0 + '/p'] || {}) });
  check('12א סדר הכתיבה: יצירת המסמך, אחר כך התמונה, ובסוף im=1', (() => { const k = LOG.filter((l) => /tkt/.test(l.col || '')); return k.length >= 3 && k[0].m === 'POST' && k[1].m === 'PATCH' && /\/p$/.test(k[1].col) && k[2].m === 'PATCH' && k[2].mask[0] === 'im'; })(), LOG.map((l) => l.m + ' ' + l.col));
  await openTpl(); await tp.evaluate(() => { const d = [...document.querySelectorAll('details')].find((x) => /תבניות/.test((x.querySelector('summary') || {}).innerText || '')); if (d) d.scrollIntoView({ block: 'start' }); window.scrollBy(0, -70); }); await sleep(2500); await shot(tp, shots, 'r4-ב-תבניות');
  // בחירה: מנקים את הטופס ובוחרים את התבנית
  await tp.fill('form[data-f=tkAdd] textarea', ''); await tp.evaluate(() => { TKN.imgs = []; tkRe(); }); await sleep(300); await openTpl();
  await tp.click('[data-a=tkwTcFill]'); await waitFor(() => tp.evaluate(() => TKN.imgs.length === 1), 4000); await sleep(300);
  const fl = await tp.evaluate(() => ({ v: document.querySelector('form[data-f=tkAdd] textarea').value, n: TKN.imgs.length, th: document.querySelectorAll('#tkmi img').length }));
  check('13 בחירה מתבנית: הטקסט מוזן בטופס, וגם תמונת הדוגמה (נטענת מהענן)', fl.v === 'לנקות את המקרר היטב' && fl.n === 1 && fl.th === 1, fl);
  await openTpl(); await tp.click('[data-a=tkwTcFill]'); await sleep(500);
  check('13א בחירה חוזרת לא מכפילה את התמונה', (await tp.evaluate(() => TKN.imgs.length)) === 1);
  // העבר לענן
  await tp.evaluate((k) => { localStorage.setItem(LK('lp-tk-tpl'), JSON.stringify([{ txt: 'תבנית ישנה א', to: [], np: 1 }, { txt: 'תבנית ישנה ב', to: [], np: 0, pri: 'h', ck: ['x'] }])); tkRe(); }, 0); await sleep(500); await openTpl();
  check('14 תבניות שבמכשיר מוצגות עם "העבר לענן (2)"', /העבר לענן \(2\)/.test(await tp.evaluate(() => document.body.innerText)));
  LOG.length = 0; await tp.click('[data-a=tkwTplUp]'); await waitFor(() => Object.keys(DB.tkt).length >= 3, 5000); await sleep(400);
  const loc = await tp.evaluate(() => JSON.parse(localStorage.getItem(LK('lp-tk-tpl'))));
  check('14א "העבר לענן": 2 תבניות נוספו בענן, והעותקים במכשיר לא נמחקו (מסומנות up)', Object.keys(DB.tkt).length === 3 && loc.length === 2 && loc.every((x) => !!x.up) && Object.values(DB.tkt).some((x) => x.txt.stringValue === 'תבנית ישנה ב' && x.pri.stringValue === 'h'), loc);
  await openTpl(); const t14 = await tp.evaluate(() => ({ btn: /העבר לענן \(/.test(document.body.innerText), n: [...document.querySelectorAll('details')].map((d) => d.innerText).join('\n').split('תבנית ישנה א').length - 1 }));
  check('14ב אין כפילות: אחרי ההעברה הלחצן נעלם והתבנית מוצגת פעם אחת', !t14.btn && t14.n === 1, t14);
  // מחיקת תבנית בענן
  LOG.length = 0; await openTpl(); await tp.evaluate(() => document.querySelector('[data-a=tkwTcDel]').click()); await yes(tp); await waitFor(() => LOG.some((l) => l.del && l.col === 'tkt'), 3000);
  check('15 מחיקת תבנית בענן: קודם התמונה (אם יש) ואז המסמך', Object.keys(DB.tkt).length === 2, LOG.map((l) => l.m + ' ' + l.col));
  check('15א אין שגיאות JS (תבניות)', tp.__errors.length === 0, tp.__errors);
  await tm.ctx.close();

  // ================= שרת ישן (403) =================
  seedBase(); K403 = true;
  let om = await open('m3-r4b', 'm@x.co'); let op = om.page;
  await op.evaluate(() => { TKT = 'my'; go('tk'); }); await sleep(1000);
  await op.evaluate(() => { const f = document.querySelector('[data-a=tkwFold]'); if (f) f.click(); }); await sleep(400);
  await op.evaluate(() => { TKN.imgs = []; localStorage.setItem(LK('lp-tk-tpl'), JSON.stringify([{ txt: 'ישנה', to: [], np: 0 }])); tkRe(); }); await sleep(600);
  await advOpen(op);
  await op.evaluate(() => { const d = [...document.querySelectorAll('details')].find((x) => /תבניות/.test((x.querySelector('summary') || {}).innerText || '')); if (d) d.open = true; });
  let bt = await op.evaluate(() => document.body.innerText);
  check('16 שרת ישן (403 בטעינה): הודעה ברורה, בלי קריסה, בלי "העבר לענן"', /השרת עוד לא עודכן לתבניות בענן/.test(bt) && !/העבר לענן \(/.test(bt) && op.__errors.length === 0, op.__errors);
  await op.fill('form[data-f=tkAdd] textarea', 'תבנית חדשה בשרת ישן'); await op.click('[data-a=tkwTplSave]'); await sleep(700);
  const ol = await op.evaluate(() => JSON.parse(localStorage.getItem(LK('lp-tk-tpl'))));
  check('16א שמירה בשרת ישן: נשמרת במכשיר בלבד (התנהגות קודמת), בלי קריסה', ol.length === 2 && ol[0].txt === 'תבנית חדשה בשרת ישן' && op.__errors.length === 0, ol);
  // 403 דווקא בשמירה (הטעינה הצליחה)
  K403 = false; let om2 = await open('m4-r4b', 'm@x.co'); let op2 = om2.page;
  await op2.evaluate(() => { TKT = 'my'; go('tk'); }); await sleep(1000);
  await op2.evaluate(() => { const f = document.querySelector('[data-a=tkwFold]'); if (f) f.click(); }); await sleep(300);
  await advOpen(op2);
  K403 = true; await op2.fill('form[data-f=tkAdd] textarea', 'שמירה מול 403'); await op2.evaluate(() => { const d = [...document.querySelectorAll('details')].find((x) => /תבניות/.test((x.querySelector('summary') || {}).innerText || '')); if (d) d.open = true; });
  await op2.click('[data-a=tkwTplSave]'); await sleep(800);
  const tt = await op2.evaluate(() => (document.getElementById('toast') || document.querySelector('.toast') || {}).innerText || '');
  const ol2 = await op2.evaluate(() => JSON.parse(localStorage.getItem(LK('lp-tk-tpl')) || '[]'));
  check('17 403 בשמירה: הודעה "השרת עוד לא עודכן", התבנית נשמרת במכשיר, בלי קריסה', ol2.some((x) => x.txt === 'שמירה מול 403') && op2.__errors.length === 0, { tt, err: op2.__errors });
  await om.ctx.close(); await om2.ctx.close();
  await browser.close();
  console.log(fail ? 'תוצאה: ' + fail + ' נכשלו' : 'כל הבדיקות עברו'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
