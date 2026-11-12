'use strict';
// שלב 2 (feature/recurring-private-requests): משימות פרטיות (ptk), משימות קבועות (rtk), בקשות למנהל (rq + c) ו"ממתין לטיפול".
// רשת מדומה עם "ענן" פשוט בזיכרון (tasks, ptk, rtk, rq, תת-אוסף c, רשימת staff); בלי אמולטור.
// שימוש: node ui-rq1.js <www-dir> [shots-dir]
const fs = require('fs'); const path = require('path'); const H = require('./harness');
const BZ0 = ['larg', 'peami'].join('');
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
let fail = 0; const check = (n, ok, info) => { if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 500) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const S = (v) => ({ stringValue: String(v) }), I = (v) => ({ integerValue: String(v) }), A = (a) => ({ arrayValue: { values: a.map(S) } });
const T0 = H.T0, D1 = 864e5;
const DOCS = 'projects/demo-largpeami/databases/(default)/documents/';

// "ענן" משותף: DB[נתיב-אוסף][id] = fields. LOG = כל כתיבה (שיטה, נתיב, שדות)
const DB = { tasks: {}, ptk: {}, rtk: {}, rq: {}, staff: {} }; const LOG = []; const QLOG = [];
const docOf = (col, id) => ({ name: DOCS + col + '/' + id, fields: DB[col][id], createTime: '2026-11-03T09:00:00Z', updateTime: '2026-11-03T09:00:00Z' });
const colOf = (rest) => { const s = rest.split('?')[0].split('/').filter(Boolean); return s.length >= 3 && s[0] === 'rq' && s[2] === 'c' ? { col: 'rq/' + s[1] + '/c', id: s[3] } : { col: s[0], id: s[1] }; };
const MINE = new Set(['tasks', 'ptk', 'rtk', 'rq']);
async function mockCloud(ctx, who) {
  await ctx.route((u) => new URL(u).port === '8080', async (route) => {
    const req = route.request(), u = new URL(req.url()), m = req.method(), p = decodeURIComponent(u.pathname), body = req.postData() || '';
    const i = p.indexOf('/documents'); if (i < 0) return route.fallback(); const rest = p.slice(i + 10);
    const ok = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    const err = (c, s) => route.fulfill({ status: c, contentType: 'application/json', body: JSON.stringify({ error: { code: c, message: s, status: s } }) });
    if (rest === ':runQuery') {
      let q = {}; try { q = JSON.parse(body).structuredQuery; } catch (e) { /* */ }
      const c = q.from && q.from[0].collectionId; if (!MINE.has(c)) return route.fallback();
      QLOG.push({ who, c, where: q.where && q.where.fieldFilter && [q.where.fieldFilter.field.fieldPath, q.where.fieldFilter.op, JSON.stringify(q.where.fieldFilter.value)] });
      let ids = Object.keys(DB[c]); const w = q.where && q.where.fieldFilter;
      if (w) ids = ids.filter((id) => { const v = DB[c][id][w.field.fieldPath]; const sv = v && v.stringValue; return w.op === 'IN' ? w.value.arrayValue.values.some((x) => x.stringValue === sv) : sv === w.value.stringValue; });
      return ok(ids.length ? ids.map((id) => ({ document: docOf(c, id), readTime: 'x' })) : [{ readTime: 'x' }]);
    }
    if (m === 'GET' && rest === '/staff') return ok({ documents: Object.keys(DB.staff).map((id) => docOf('staff', id)) });
    const { col, id } = colOf(rest); const top = col.split('/')[0];
    if (!MINE.has(top)) return route.fallback();
    if (!DB[col]) DB[col] = {};
    if (m === 'GET') { if (id) return DB[col][id] ? ok(docOf(col, id)) : err(404, 'NOT_FOUND'); return ok({ documents: Object.keys(DB[col]).map((k) => docOf(col, k)) }); }
    if (m === 'POST') { const nid = u.searchParams.get('documentId'); if (DB[col][nid]) return err(409, 'ALREADY_EXISTS'); DB[col][nid] = JSON.parse(body).fields; LOG.push({ who, m, col, id: nid, f: DB[col][nid] }); return ok(docOf(col, nid)); }
    if (m === 'PATCH') { const mask = u.searchParams.getAll('updateMask.fieldPaths'); if (!DB[col][id]) return err(404, 'NOT_FOUND'); const f = JSON.parse(body).fields; const ch = {};
      for (const k of mask) { if (k.includes('.')) continue; DB[col][id][k] = f[k]; ch[k] = f[k]; } LOG.push({ who, m, col, id, f: ch, mask }); return ok(docOf(col, id)); }
    if (m === 'DELETE') { delete DB[col][id]; LOG.push({ who, m, col, id }); return ok({}); }
    return route.fallback();
  });
}
const task = (id, o) => { DB.tasks[id] = Object.assign({ owner: S('m'), by: S('m'), role: S('a'), txt: S('משימה ' + id), cr: I(T0 - D1), due: I(T0 + D1), st: S('open'), open: S('1'), pr: S(''), sub: I(0), doneBy: S(''), note: S(''), ok: I(0), late: S(''), to: A(['w1']), toN: A(['עובד א']), ow: S('w1'), owN: S('עובד א'), clt: I(T0 - D1), np: I(0), wp: I(0), mi: I(0) }, o || {}); };
const shot = async (page, dir, name) => { if (!dir) return; fs.mkdirSync(dir, { recursive: true }); await page.waitForTimeout(250); await page.screenshot({ path: path.join(dir, name + '.png') }); };
const txt = (page, sel) => page.evaluate((s) => (document.querySelector(s) || {}).innerText || '', sel);
const waitFor = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 4000)) { if (await fn()) return true; await sleep(60); } return false; };

(async () => {
  const [www, shots] = process.argv.slice(2); const browser = await H.launch();
  const cfg = { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: ALL } }, admins: { '|m': 1 }, staff: { '|w1': 1, '|w2': 1 } };
  DB.staff.w1 = { name: S('עובד א'), email: S('w1@x.co'), active: { booleanValue: true } };
  DB.staff.w2 = { name: S('עובד ב'), email: S('w2@x.co'), active: { booleanValue: true } };

  // ================= מנהל =================
  const { ctx, page } = await H.newPage(browser, www, cfg, [], 'm'); await page.setViewportSize({ width: 360, height: 740 });
  await mockCloud(ctx, 'm');
  // זרעים: פרטית של עובד, משימה מקבוצה "קבועה", משימה לאישור, משימה עם תגובת עובד, בקשה חדשה
  DB.ptk.pw1 = { owner: S('w1'), by: S('w1'), txt: S('תזכורת פרטית של עובד'), cr: I(T0 - D1), due: I(T0 + D1), st: S('open'), sub: I(0), late: S('') };
  task('t-rc', { rc: S('r1'), txt: S('לסגור קופה (קבועה)') });
  task('t-wait', { st: S('wait'), sub: I(T0 - 3600e3), doneBy: S('w1'), np: I(1), wp: I(1), txt: S('משימה שממתינה לאישור') });
  task('t-cm', { cAt: I(T0 - 1800e3), cBy: S('w1'), cT: S('שאלה על המשימה'), cN: S('w1'), txt: S('משימה עם תגובה') });
  DB.rq.r1 = { owner: S('w1'), by: S('w1'), txt: S('אפשר לקחת יום חופש ביום ראשון?'), t: I(T0 - 7200e3), st: S('new'), ans: S('') };
  await H.login(page, 'm@x.co'); if (await page.$('[data-a=startBlank]')) { await page.click('[data-a=startBlank]'); await sleep(300); }
  await page.evaluate(() => { INB.at = -1e9; return inbTick(1); }); await sleep(300);
  const rqn = await page.evaluate(() => RQ.L.length);
  check('1 מנהל: inbTick מושך בקשות חדשות (rq st==new)', rqn === 1 && QLOG.some((q) => q.who === 'm' && q.c === 'rq' && q.where && q.where[0] === 'st'), { rqn });

  // "לטיפול": ממתין לטיפול – בקשות, משימות לאישור, תגובות; המונה
  await page.evaluate(() => { tkLoad(); }); await waitFor(async () => (await page.evaluate(() => (TK.L || []).length)) >= 3);
  await page.evaluate(() => { go('todo'); }); await sleep(400);
  const td = await txt(page, '#main');
  check('2 "לטיפול": סעיף "ממתין לטיפול" עם בקשות, משימות לאישור ותגובות', /ממתין לטיפול/.test(td) && /בקשות מעובדים/.test(td) && /משימות לאישור/.test(td) && /תגובות חדשות במשימות/.test(td), td.slice(0, 300));
  const cnt = await page.evaluate(() => { const c = todoC(); return { rq: c.rq, tw: c.tw, tc: c.tc, n: c.n }; });
  check('3 מונה המסך הראשי כולל בקשה אחת, משימה לאישור אחת ותגובה אחת (ולא את הפרטית של העובד)', cnt.rq === 1 && cnt.tw === 1 && cnt.tc === 1 && cnt.n >= 3, cnt);
  const tile = await page.evaluate(() => adTiles());
  check('3א משבצת "לטיפול" במסך ה-+ מציגה את המונה', /לטיפול<span class="tag t1">\d+<\/span>/.test(tile), tile.slice(0, 200));
  await shot(page, shots, 'm-todo');

  // לשונית "ממתין לטיפול" במשימות
  await page.click('[data-a=tkGoWait]'); await sleep(500);
  const wt = await txt(page, '#main');
  check('4 לחיצה על "משימות לאישור" פותחת את לשונית "ממתין לטיפול" ומציגה את שתי המשימות', /משימה שממתינה לאישור/.test(wt) && /משימה עם תגובה/.test(wt) && !/לסגור קופה/.test(wt), wt.slice(0, 200));
  await shot(page, shots, 'm-tk-wait');

  // תג "קבועה" + פרטית של עובד עם שם
  await page.click('[data-a=tkTab][data-v=open]'); await sleep(300);
  const op = await txt(page, '#main');
  check('5 משימה שנוצרה מכלל מציגה תג "קבועה"', /קבועה/.test(op) && /לסגור קופה/.test(op));
  check('6 מנהל רואה פרטית של עובד, עם תג פרטית ושם העובד', /פרטית/.test(op) && /תזכורת פרטית של עובד/.test(op) && /של w1/.test(op));
  check('6א המנהל שולף את כל ה-ptk (בלי סינון owner)', QLOG.some((q) => q.who === 'm' && q.c === 'ptk' && !q.where));

  // יצירת משימה פרטית
  await page.fill('form[data-f=tkAdd] textarea', 'לבדוק מלאי יין');
  await page.check('form[data-f=tkAdd] input[name=prv]');
  const hid = await page.evaluate(() => document.getElementById('tkx').hidden);
  check('7 סימון "משימה פרטית" מסתיר את בחירת הנמענים', hid === true);
  await page.click('form[data-f=tkAdd] button.btn.w'); await waitFor(async () => Object.keys(DB.ptk).length === 2);
  const pk = Object.entries(DB.ptk).find(([k]) => k !== 'pw1');
  const pf = pk && pk[1];
  check('8 משימה פרטית נשמרת ב-ptk (לא ב-tasks) עם owner/by/txt/st/sub/late/due', !!pf && pf.owner.stringValue === 'm' && pf.by.stringValue === 'm' && pf.txt.stringValue === 'לבדוק מלאי יין' && pf.st.stringValue === 'open' && pf.sub.integerValue === '0' && pf.late.stringValue === '' && +pf.due.integerValue > T0 && +pf.cr.integerValue === T0 && !Object.keys(DB.tasks).some((k) => /יין/.test((DB.tasks[k].txt || {}).stringValue || '')), pf && Object.keys(pf));
  await sleep(500);
  check('8א המשימה הפרטית מוצגת ברשימה עם תג 🔒', /לבדוק מלאי יין/.test(await txt(page, '#main')));
  await shot(page, shots, 'm-tk-open-private');
  const pid = pk[0];
  await page.click(`#ptc-${pid} [data-a=ptDone]`); await sleep(600);
  check('9 "בוצע" מעדכן st=done + sub; עובר ללשונית בוצעו', DB.ptk[pid].st.stringValue === 'done' && +DB.ptk[pid].sub.integerValue === T0 && !/לבדוק מלאי יין/.test(await txt(page, '#main')));
  await page.click('[data-a=tkTab][data-v=done]'); await sleep(300);
  check('9א בלשונית בוצעו מופיעה הפרטית עם "החזר לפתוחה"', /לבדוק מלאי יין/.test(await txt(page, '#main')) && /החזר לפתוחה/.test(await txt(page, '#main')));
  await page.click(`#ptc-${pid} [data-a=ptOpen]`); await sleep(600);
  check('10 "החזר לפתוחה" מחזיר st=open ו-sub=0', DB.ptk[pid].st.stringValue === 'open' && DB.ptk[pid].sub.integerValue === '0');
  await page.click('[data-a=tkTab][data-v=open]'); await sleep(300);
  await page.click(`#ptc-${pid} [data-a=ptDel]`); await page.click('#dlg [data-a=yes]'); await sleep(600);
  check('11 "מחק" מוחק את המסמך מ-ptk', !DB.ptk[pid]);

  // משימות קבועות
  await page.click('[data-a=tkTab][data-v=rc]'); await sleep(500);
  const rc0 = await txt(page, '#main');
  check('12 לשונית "🔁 קבועות" קיימת ופותחת רשימה ריקה עם כפתור הוספה', /משימה קבועה חדשה/.test(rc0) && /עוד אין משימות קבועות/.test(rc0) && QLOG.length > 0 && LOG.length >= 0);
  await page.click('[data-a=rcNew]'); await sleep(300);
  await page.fill('#dlg textarea[name=txt]', 'לסגור קופה');
  await page.click('#dlg [data-a=rcSel][data-v=w1]');
  await page.click('#dlg [data-a=rcNp][data-v="2"]');
  await page.click('#dlg [data-a=rcFq][data-v=w]'); await sleep(150);
  await page.click('#dlg [data-a=rcWd][data-v="2"]');
  await page.selectOption('#dlg select[name=hh]', '7'); await page.selectOption('#dlg select[name=mm]', '0');
  const form = await txt(page, '#dlg');
  check('13 טופס כלל: טקסט, נמענים, תמונות 0–3, תדירות, ימים א׳–ו׳, שעה, דלג על חגים, פעילה', /נמענים/.test(form) && /תמונות נדרשות/.test(form) && /יומי/.test(form) && /שבועי/.test(form) && /חודשי/.test(form) && /יום ו׳/.test(form) && /שעה/.test(form) && /דלג על חגים/.test(form) && /פעילה/.test(form), form.slice(0, 300));
  const mmOpts = await page.evaluate(() => [...document.querySelectorAll('#dlg select[name=mm] option')].map((o) => +o.value));
  check('13א דקות בקפיצות של 5 בלבד (12 אפשרויות)', mmOpts.length === 12 && mmOpts.every((v, i) => v === i * 5), mmOpts);
  await shot(page, shots, 'm-rc-form');
  await page.click('#dlg form button.btn.grow'); await waitFor(async () => Object.keys(DB.rtk).length === 1);
  const rid = Object.keys(DB.rtk)[0], rf = DB.rtk[rid] || {};
  const arr = (k) => ((rf[k] || {}).arrayValue || { values: [] }).values.map((x) => x.stringValue !== undefined ? x.stringValue : +x.integerValue);
  check('14 כלל נשמר ב-rtk עם כל השדות לפי החוזה', rf.txt && rf.txt.stringValue === 'לסגור קופה' && arr('to').join() === 'w1' && arr('toN').join() === 'עובד א' && rf.np.integerValue === '2' && rf.fq.stringValue === 'w' && arr('wd').join() === '2' && rf.md.integerValue === '1' && rf.hh.integerValue === '7' && rf.mm.integerValue === '0' && rf.hol.booleanValue === true && rf.on.booleanValue === true && rf.owner.stringValue === 'm' && rf.by.stringValue === 'm' && +rf.cr.integerValue === T0 && +rf.ed.integerValue === T0 && !('last' in rf) && !('n' in rf) && !('err' in rf), Object.fromEntries(Object.entries(rf).map(([k, v]) => [k, Object.values(v)[0]])));
  await sleep(500);
  const rl = await txt(page, '#main');
  check('15 הכלל ברשימה: תיאור, נמענים, תמונות, "הפעם הבאה" (שלישי 10.11 07:00, שעון ישראל)', /כל יום ג׳ בשעה 07:00/.test(rl) && /עובד א/.test(rl) && /הפעם הבאה: .*10[./]11.*07:00/.test(rl) && /פעילה/.test(rl), rl.slice(0, 400));
  await shot(page, shots, 'm-rc-list');
  // עריכה: ed מתעדכן
  await page.evaluate(() => { RC.L[0].ed = 5; }); // סימון: ערך ישן, כדי לוודא שהעריכה מעדכנת
  await page.click('[data-a=rcEdit]'); await sleep(300);
  await page.fill('#dlg textarea[name=txt]', 'לסגור קופה ולספור');
  await page.click('#dlg [data-a=rcFq][data-v=m]'); await sleep(150);
  await page.selectOption('#dlg select[name=md]', '31');
  await page.click('#dlg form button.btn.grow'); await sleep(700);
  const rf2 = DB.rtk[rid], ed2 = +rf2.ed.integerValue;
  check('16 עריכה מעדכנת את הכלל ואת ed=Date.now()', rf2.txt.stringValue === 'לסגור קופה ולספור' && rf2.fq.stringValue === 'm' && rf2.md.integerValue === '31' && ed2 === T0 && LOG.some((l) => l.m === 'PATCH' && l.col === 'rtk' && l.mask.includes('ed')), { ed2 });
  const nx = await page.evaluate(() => rcDT(rcNext(RC.L[0]).at));
  check('16א חודשי ביום 31: הפעם הבאה היא היום האחרון בחודש קצר (30.11)', /30[./]11/.test(nx), nx);
  await page.click('[data-a=rcTog]'); await sleep(600);
  check('17 השבתה: on=false; "הפעם הבאה" מציגה "מושבתת"', DB.rtk[rid].on.booleanValue === false && /הפעם הבאה: מושבתת/.test(await txt(page, '#main')));
  await page.click('[data-a=rcTog]'); await sleep(600);
  check('17א הפעלה מחדש: on=true ו-ed מתעדכן', DB.rtk[rid].on.booleanValue === true && +DB.rtk[rid].ed.integerValue === T0);
  await page.click('[data-a=rcDel]'); await page.click('#dlg [data-a=yes]'); await sleep(600);
  check('18 מחיקה: הכלל נמחק מ-rtk', !DB.rtk[rid]);

  // חישוב "הפעם הבאה" ובדיקות פונקציות (שעון ישראל, חגים)
  const calc = await page.evaluate(() => {
    const base = { on: true, fq: 'd', wd: [], md: 1, hh: 7, mm: 0, hol: true, ed: 0, last: '' };
    const dt = (r) => { const x = rcNext(Object.assign({}, base, r)); return x ? { at: x.at, soon: !!x.soon } : null; };
    const hol = []; for (let y = 2026; y <= 2027; y++) for (let m = 0; m < 12; m++) for (let d = 1; d <= 31; d++) { const x = new Date(y, m, d); if (x.getMonth() !== m || x.getDay() > 4) continue; if (rcHol(y, m, d) === tkBiz(x)) hol.push([y, m, d]); }
    return { daily: dt({}), dailyDone: dt({ last: '2026-11-03' }), wkTue: dt({ fq: 'w', wd: [2], ed: Date.UTC(2026, 10, 3, 9, 0) }), edLater: dt({ fq: 'w', wd: [2], ed: Date.UTC(2026, 10, 10, 12) }), yk: rcHol(2026, 8, 21), no: rcHol(2026, 10, 3), mismatch: hol.length, winter: tkIL.at(2026, 10, 3, 7, 0) === Date.UTC(2026, 10, 3, 5, 0), summer: tkIL.at(2026, 6, 1, 7, 0) === Date.UTC(2026, 6, 1, 4, 0) };
  });
  check('19 יומי 07:00 כשהשעה עברה והמשימה עוד לא נפתחה היום: "בדקות הקרובות"', calc.daily && calc.daily.soon === true, calc.daily);
  check('19א יומי אחרי שנפתחה היום: מחר (רביעי 4.11) 07:00 שעון ישראל = 05:00 UTC', calc.dailyDone && !calc.dailyDone.soon && calc.dailyDone.at === Date.UTC(2026, 10, 4, 5, 0), calc.dailyDone);
  check('19ב שבועי (שלישי): 10.11 07:00; ואם ed אחרי המועד – דולג לשבוע שאחריו', calc.wkTue.at === Date.UTC(2026, 10, 10, 5, 0) && calc.edLater.at === Date.UTC(2026, 10, 17, 5, 0), [calc.wkTue, calc.edLater]);
  check('19ג rcHol זהה ל-tkBiz בכל ימי א׳–ה׳ ב-2026–2027; יום כיפור 21.9.2026 הוא חג, 3.11.2026 לא', calc.mismatch === 0 && calc.yk === true && calc.no === false, calc);
  check('19ד tkIL.at: קיץ/חורף נכונים (UTC+3 / UTC+2)', calc.winter && calc.summer, calc);

  // בקשות – מסך מנהל
  await page.evaluate(() => { go('rq'); }); await sleep(600);
  const rm = await txt(page, '#main');
  check('20 מסך בקשות מנהל: לשוניות חדשות/טופלו, הבקשה והכפתור "שרשור ותשובה"', /חדשות \(1\)/.test(rm) && /טופלו/.test(rm) && /אפשר לקחת יום חופש/.test(rm) && /שרשור ותשובה/.test(rm), rm.slice(0, 250));
  await shot(page, shots, 'm-rq');
  await page.click('[data-a=rqThread]'); await sleep(500);
  const th0 = await txt(page, '#dlg');
  check('21 שרשור מנהל: טופס תשובה + כפתורי טופל / נדחה / תגובה בלי לסגור', /טופל/.test(th0) && /נדחה/.test(th0) && /שלח תגובה בלי לסגור/.test(th0));
  await page.fill('#dlg textarea[name=txt]', 'כן, אושר'); await page.click('#dlg [data-k=c]'); await sleep(700);
  const cmKeys = Object.keys(DB['rq/r1/c'] || {});
  check('22 תגובת מנהל נכתבה ל-rq/{id}/c ועדכנה cAt/cBy/cT/cN (הבקשה נשארת "חדשה")', cmKeys.length === 1 && DB.rq.r1.cBy.stringValue === 'm' && DB.rq.r1.cT.stringValue === 'כן, אושר' && DB.rq.r1.st.stringValue === 'new' && +DB.rq.r1.cAt.integerValue === T0, Object.keys(DB.rq.r1));
  await page.fill('#dlg textarea[name=txt]', 'אושר, תוריד בלוח'); await page.click('#dlg [data-k=done]'); await sleep(800);
  const r1 = DB.rq.r1;
  check('23 "טופל": st=done, ans, aBy, aAt', r1.st.stringValue === 'done' && r1.ans.stringValue === 'אושר, תוריד בלוח' && r1.aBy.stringValue === 'm' && +r1.aAt.integerValue === T0, { st: r1.st, ans: r1.ans });
  check('23א הבקשה יצאה מ"חדשות" והמונה ירד', (await page.evaluate(() => RQ.L.length)) === 0 && (await page.evaluate(() => todoC().rq)) === 0);
  await page.click('[data-a=rqTab][data-v=done]'); await sleep(700);
  check('23ב לשונית "טופלו" טוענת את הבקשה עם התשובה', /אושר, תוריד בלוח/.test(await txt(page, '#main')) && QLOG.some((q) => q.c === 'rq' && q.where && q.where[1] === 'IN'));
  check('24 אין שגיאות JS (מנהל)', page.__errors.length === 0, page.__errors);
  await ctx.close();

  // ================= עובד =================
  DB.rq.r2 = { owner: S('w1'), by: S('w1'), txt: S('בקשה ישנה שנענתה'), t: I(T0 - 5 * D1), st: S('done'), ans: S('בוצע'), aBy: S('m'), aAt: I(T0 - 3600e3), cAt: I(0), cBy: S(''), cT: S(''), cN: S('') };
  DB.ptk.pw2 = { owner: S('w2'), by: S('w2'), txt: S('פרטית של עובד אחר'), cr: I(T0 - D1), due: I(T0 + D1), st: S('open'), sub: I(0), late: S('') };
  DB.rq.r3 = { owner: S('w2'), by: S('w2'), txt: S('בקשה של עובד אחר'), t: I(T0 - D1), st: S('new'), ans: S('') };
  const w = await H.newPage(browser, www, cfg, [], 'w1'); const wp = w.page; await wp.setViewportSize({ width: 360, height: 740 });
  await mockCloud(w.ctx, 'w1');
  await H.login(wp, 'w1@x.co'); await sleep(1500); if (await wp.evaluate(() => { const d = document.getElementById('dlg'); return d && d.open; })) { await wp.evaluate(() => closeDlg()); await sleep(200); }
  const wh = await txt(wp, '#main');
  check('25 מסך הבית של העובד: כפתור "📝 בקשה למנהל" עם תג "תשובה חדשה"', /בקשה למנהל/.test(wh) && /תשובה חדשה/.test(wh), wh.slice(-300));
  await shot(wp, shots, 'w-home');
  const mineQ = QLOG.find((q) => q.who === 'w1' && q.c === 'rq');
  check('25א העובד שולף רק את שלו: owner == uid', !!mineQ && mineQ.where[0] === 'owner' && /w1/.test(mineQ.where[2]), mineQ);
  await wp.click('[data-a=go][data-v=rq]'); await sleep(700);
  const wr = await txt(wp, '#main');
  check('26 מסך הבקשות של העובד: טופס, רשימה עם מצב ותשובה; לא רואה בקשה של עובד אחר', /הבקשות שלי/.test(wr) && /בקשה ישנה שנענתה/.test(wr) && /טופל/.test(wr) && /תשובת המנהל.*בוצע/.test(wr) && !/עובד אחר/.test(wr), wr.slice(0, 300));
  await shot(wp, shots, 'w-rq');
  await wp.fill('form[data-f=rqNew] textarea', 'צריך עוד שקיות'); await wp.click('form[data-f=rqNew] button.btn.w'); await waitFor(async () => Object.keys(DB.rq).length === 4);
  const nid = Object.keys(DB.rq).find((k) => !['r1', 'r2', 'r3'].includes(k)), nf = DB.rq[nid] || {};
  check('27 בקשה חדשה נשמרת ב-rq: owner/by/txt/t/st=new/ans=""', nf.owner.stringValue === 'w1' && nf.by.stringValue === 'w1' && nf.txt.stringValue === 'צריך עוד שקיות' && +nf.t.integerValue === T0 && nf.st.stringValue === 'new' && nf.ans.stringValue === '', nf && Object.keys(nf));
  await sleep(700);
  check('27א הבקשה מופיעה ברשימה כ"ממתין לטיפול"', /צריך עוד שקיות/.test(await txt(wp, '#main')));
  // תג תשובה חדשה ומעקב נקרא
  const un0 = await wp.evaluate(() => RQ.mine.filter(rqUnread).map((x) => x.id));
  check('28 "תשובה חדשה" רק על הבקשות שהמנהל ענה עליהן (r1, r2) ולא על r3 של עובד אחר או על הבקשה החדשה', un0.slice().sort().join() === 'r1,r2', un0);
  await wp.click('[data-a=rqThread][data-id=r2]'); await sleep(600);
  await wp.click('#dlg [data-a=closeDlg]'); await sleep(300);
  const un1 = await wp.evaluate(() => ({ u: RQ.mine.filter(rqUnread).length, s: JSON.parse(localStorage.getItem(RQSEEN)) }));
  check('28א אחרי פתיחת שרשור r2 התג שלו נעלם ונשאר רק של r1 (מעקב נקרא מקומי נשמר)', un1.u === 1 && !!un1.s.r2 && !un1.s.r1, un1);
  // תגובת עובד: מחזירה ל"חדש"
  await wp.click('[data-a=rqThread][data-id=r2]'); await sleep(500);
  await wp.fill('#dlg textarea[name=txt]', 'תודה, עוד שאלה'); await wp.click('#dlg form button.btn.w'); await sleep(900);
  const r2 = DB.rq.r2;
  check('29 תגובת עובד: נכתבת ל-c ומעדכנת cAt/cBy/cT/cN ו-st:"new" (וללא ans/aAt)', Object.keys(DB['rq/r2/c'] || {}).length === 1 && r2.cBy.stringValue === 'w1' && r2.cT.stringValue === 'תודה, עוד שאלה' && r2.st.stringValue === 'new' && +r2.cAt.integerValue === T0 && LOG.some((l) => l.who === 'w1' && l.m === 'PATCH' && l.col === 'rq' && l.id === 'r2' && l.mask.slice().sort().join() === 'cAt,cBy,cN,cT,st'), LOG.filter((l) => l.col === 'rq').map((l) => l.mask));
  await wp.click('#dlg [data-a=closeDlg]');
  // משימות: כפתור בקשה, פרטית של עובד, לשונית בוצעו
  task('t-w1', { txt: S('משימה רגילה לעובד'), ow: S('w1') }); DB.tasks['t-w1'].txt = S('משימה רגילה לעובד');
  await wp.evaluate(() => { go('tk'); }); await sleep(900);
  const wt1 = await txt(wp, '#main');
  check('30 מסך המשימות של העובד: כפתור "בקשה למנהל", תיבת "משימה פרטית", לשונית בוצעו', /בקשה למנהל/.test(wt1) && /משימה פרטית \(רק אני והמנהל\)/.test(wt1) && /בוצעו/.test(wt1) && !/קבועות/.test(wt1) && !/ממתין לטיפול\s*\(/.test(wt1), wt1.slice(0, 300));
  await wp.fill('form[data-f=tkAdd] textarea', 'להזמין חלב לעצמי'); await wp.check('form[data-f=tkAdd] input[name=prv]');
  await wp.click('form[data-f=tkAdd] button.btn.w'); await waitFor(async () => Object.values(DB.ptk).some((x) => x.owner.stringValue === 'w1' && /חלב/.test(x.txt.stringValue)));
  const wpk = Object.entries(DB.ptk).find(([, x]) => /חלב/.test(x.txt.stringValue));
  check('31 עובד יוצר משימה פרטית: ב-ptk עם owner=uid, by, st=open, sub=0, late=""', !!wpk && wpk[1].owner.stringValue === 'w1' && wpk[1].by.stringValue === 'w1' && wpk[1].st.stringValue === 'open' && wpk[1].sub.integerValue === '0' && wpk[1].late.stringValue === '' && !Object.values(DB.tasks).some((t) => /חלב/.test((t.txt || {}).stringValue || '')));
  await sleep(600);
  const pq = QLOG.filter((q) => q.who === 'w1' && q.c === 'ptk').pop();
  check('31א העובד שולף ptk רק של עצמו (owner == uid)', !!pq && pq.where[0] === 'owner' && /w1/.test(pq.where[2]), pq);
  const wopen = await txt(wp, '#main');
  check('31ב הפרטית של העובד ברשימה עם תג פרטית; הפרטית של w2/המנהל/אחרים לא מופיעה', /להזמין חלב לעצמי/.test(wopen) && /פרטית/.test(wopen) && /תזכורת פרטית של עובד/.test(wopen) && !/פרטית של עובד אחר/.test(wopen));
  await shot(wp, shots, 'w-tk');
  await wp.click(`#ptc-${wpk[0]} [data-a=ptDone]`); await sleep(600);
  await wp.click('[data-a=tkTab][data-v=done]'); await sleep(400);
  const wdn = await txt(wp, '#main');
  check('32 לשונית "בוצעו" לעובד: רק פרטיות שלו שבוצעו (בלי משימות רגילות שבוצעו)', /להזמין חלב לעצמי/.test(wdn) && !/משימה רגילה לעובד/.test(wdn), wdn.slice(0, 200));
  check('33 פרטיות לא נכנסות ל"ממתין לטיפול" ולא ל"באיחור" של העובד', (await wp.evaluate(() => tkOverN())) === 0);
  check('34 אין שגיאות JS (עובד)', wp.__errors.length === 0, wp.__errors);
  await w.ctx.close();
  await browser.close();
  console.log(fail ? `נכשלו ${fail}` : 'כל הבדיקות עברו'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
