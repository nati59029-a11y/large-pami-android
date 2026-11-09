'use strict';
// סריקה אחידה, שלב 6: תור "נשלח למנהל לטיפול" (mq) + שם עובד ב"מי הכניס". רשת מדומה; האוסף mq מדומה כאן (page.route) מעל ה-harness.
// שימוש: NODE_PATH=... node ui-us6.js <www-dir>
const H = require('./harness');
const BZ0 = ['larg', 'peami'].join('');
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
let fail = 0; const check = (n, ok, info) => { if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const mkImg = (page) => page.evaluate(() => { const c = document.createElement('canvas'); c.width = 400; c.height = 560; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 400, 560); x.fillStyle = '#222'; x.fillRect(20, 40, 300, 20); return c.toDataURL('image/png').split(',')[1]; }).then((b) => Buffer.from(b, 'base64'));
async function mockScan(page) {
  page.__q = []; page.__calls = 0;
  await page.route('**/scanDocument', async (route) => { page.__calls++; const a = page.__q.shift() || { err: 'bad-answer' };
    if (a.err) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { status: 'INTERNAL', message: 'x', details: { reason: a.err } } }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { result: a }, usage: {} }) }); });
}
// "ענן" משותף לשני המכשירים: mq/{id} ו-mq/{id}/p/{k}. כל בקשה נרשמת (כדי לבדוק שאין סכומים ושאין שמירה כפולה)
const CLOUD = { docs: {}, parts: {}, log: [] };
const S = (v) => ({ stringValue: String(v) }), I = (v) => ({ integerValue: String(v) });
const docOf = (id) => ({ name: 'projects/demo-largpeami/databases/(default)/documents/mq/' + id, fields: CLOUD.docs[id], createTime: '2026-11-03T09:00:00Z', updateTime: '2026-11-03T09:00:00Z' });
async function mockMq(page, who) {
  await page.route(/:8080\/.*\/documents(\/mq|:runQuery)/, async (route) => {
    const req = route.request(), u = new URL(req.url()), m = req.method(), p = decodeURIComponent(u.pathname), body = req.postData() || '';
    if (/:runQuery$/.test(p)) { let q = {}; try { q = JSON.parse(body).structuredQuery; } catch (e) { /* */ }
      if (!q.from || q.from[0].collectionId !== 'mq') return route.fallback();
      const w = q.where.fieldFilter, f = w.field.fieldPath, v = w.value.stringValue;
      const L = Object.keys(CLOUD.docs).filter((id) => (CLOUD.docs[id][f] || {}).stringValue === v).map((id) => ({ document: docOf(id), readTime: 'x' }));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(L.length ? L : [{ readTime: 'x' }]) }); }
    const rest = p.split('/documents/')[1]; const seg = rest.split('/');
    CLOUD.log.push({ who, m, rest: rest + u.search, body });
    if (m === 'POST' && seg.length === 1) { const id = u.searchParams.get('documentId'); const f = JSON.parse(body).fields; CLOUD.docs[id] = f; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(docOf(id)) }); }
    if (m === 'POST' && seg[2] === 'p') { const k = u.searchParams.get('documentId'); CLOUD.parts[seg[1] + '/' + k] = JSON.parse(body).fields.data.stringValue; return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); }
    if (m === 'GET' && seg[2] === 'p') { const d = CLOUD.parts[seg[1] + '/' + seg[3]]; return route.fulfill({ status: d ? 200 : 404, contentType: 'application/json', body: JSON.stringify(d ? { name: 'x', fields: { data: S(d) } } : { error: { code: 404 } }) }); }
    if (m === 'DELETE') { delete CLOUD.parts[seg[1] + '/' + seg[3]]; return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); }
    if (m === 'PATCH' && seg.length === 2) { const d = CLOUD.docs[seg[1]]; if (!d || d.st.stringValue !== 'new') return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { code: 403, message: 'PERMISSION_DENIED' } }) });
      Object.assign(d, JSON.parse(body).fields); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(docOf(seg[1])) }); }
    return route.fallback();
  });
}
const BLOCKED = { type: 'transfer', allowed: false, reason: 'no-perm', toManager: true, fields: {}, confidence: {}, uncertain: [] };
(async () => {
  const [www] = process.argv.slice(2); const browser = await H.launch();
  const cfg = { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: ALL } }, admins: { '|m': 1 }, staff: { '|w': 1 } };
  // ---- עובד: סוג חסום → "שלח למנהל לטיפול" ----
  const w = await H.newPage(browser, www, cfg, [], 'w'); const wp = w.page; await wp.setViewportSize({ width: 360, height: 740 }); await mockScan(wp); await mockMq(wp, 'w'); await H.login(wp, 'w@x.co');
  await wp.evaluate(() => usOpen()); await H.settle(wp, 200); wp.__q = [BLOCKED];
  await wp.setInputFiles('#sheet input[accept="image/*"][multiple]', { name: 'd.png', mimeType: 'image/png', buffer: await mkImg(wp) }); await H.settle(wp, 2500);
  const t1 = await wp.evaluate(() => ({ btn: !!document.querySelector('#sheet [data-a=mqSend]'), txt: document.getElementById('sheet').innerText, opts: [...document.querySelectorAll('#sheet [data-a=usPick]')].map((b) => b.dataset.k) }));
  check('1 עובד, סוג חסום: כפתור "שלח למנהל לטיפול", והעברה לא בבורר', t1.btn && /למנהל/.test(t1.txt) && !t1.opts.includes('transfer'), t1);
  const n0 = await wp.evaluate(() => S.tx.length);
  await wp.click('#sheet [data-a=mqSend]'); await H.settle(wp, 1200);
  const ids = Object.keys(CLOUD.docs); const d0 = CLOUD.docs[ids[0]] || {};
  const created = CLOUD.log.filter((r) => r.m === 'POST' && !r.rest.includes('/p'));
  check('2 נוצר פריט אחד בתור: uid/by של העובד, st=new, k=transfer, np≥1, ורק השדות המותרים (בלי סכומים)', ids.length === 1 && created.length === 1 && Object.keys(d0).sort().join() === 'by,k,np,st,t,uid' && d0.uid.stringValue === 'w' && d0.k.stringValue === 'transfer' && d0.st.stringValue === 'new' && +d0.np.integerValue >= 1, d0 && Object.keys(d0));
  check('3 חלקי הצילום נשלחו (כמספר np), ואין רשומה כספית במכשיר העובד', Object.keys(CLOUD.parts).length === +(d0.np || {}).integerValue && (await wp.evaluate(() => S.tx.length)) === n0, Object.keys(CLOUD.parts));
  check('4 הודעת "נשלח למנהל" + סרוק עוד', await wp.evaluate(() => /נשלח למנהל לטיפול/.test(document.getElementById('sheet').innerText) && !!document.querySelector('#sheet [data-a=usAgain]')));
  // ---- מנהל: מונה, מסך "ממתין לטיפול", פתיחה במסך האחיד ושמירה ----
  const m = await H.newPage(browser, www, cfg, [], 'm'); const mp = m.page; await mp.setViewportSize({ width: 360, height: 740 }); await mockScan(mp); await mockMq(mp, 'm'); await H.login(mp, 'm@x.co');
  await mp.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden) ACT.startBlank(); }); await H.settle(mp, 300);
  await mp.evaluate(() => mqLoad()); await H.settle(mp, 500);
  const t5 = await mp.evaluate(() => ({ n: todoC().mq, tiles: [...document.querySelectorAll('[data-v=todo] .tag')].map((e) => e.textContent) }));
  check('5 מנהל: מונה "לטיפול" כולל את הפריט מהתור', t5.n === 1, t5);
  await mp.evaluate(() => go('todo')); await H.settle(mp, 400);
  check('5א במסך "לטיפול": "ממתין לטיפול" עם המונה', await mp.evaluate(() => !!document.querySelector('[data-v=mq]') && /ממתין לטיפול/.test(document.getElementById('main').innerText)));
  await mp.evaluate(() => go('mq')); await H.settle(mp, 400);
  const t6 = await mp.evaluate(() => ({ txt: document.getElementById('main').innerText, open: document.querySelectorAll('[data-a=mqOpen]').length }));
  check('6 מסך "ממתין לטיפול": סוג "העברה", מי שלח, כפתורי פתיחה/טופל/דחה', t6.open === 1 && /העברה/.test(t6.txt) && /נשלח על ידי w/.test(t6.txt) && !/₪/.test(t6.txt), t6.txt.slice(0, 300));
  await mp.click('[data-a=mqOpen]'); await H.settle(mp, 1500);
  const t7 = await mp.evaluate(() => ({ us: !!US, mq: US && US.mq, pg: US && US.pg.length, who: US && US.who, pane: !document.getElementById('uspane').hidden }));
  check('7 פתיחה: המסך האחיד עם הצילום מהתור, "מי הכניס" = העובד', t7.us && t7.pg === 1 && t7.pane && t7.who === 'w', t7);
  // שמירה: מדמים את הטיפול בהעברה – הוספת רשומה ו-usDone (המסלול שכל טופס מסיים בו)
  const before = await mp.evaluate(() => S.tx.length);
  await mp.evaluate(() => { S.tx.push({ id: 'mqT1', t: 'exp', cat: 'x', sub: '', date: '2026-11-03', amt: 10, note: '', pays: [], eu: SY.uid }); save(); usDone(); }); await H.settle(mp, 800);
  const qid = ids[0];
  const t8 = await mp.evaluate((b) => { const t = S.tx[S.tx.length - 1]; return { d: S.tx.length - b, eu: t.eu, who: dxWho(t), left: MQ.L.length }; }, before);
  check('8 שמירה: רשומה אחת, eu = העובד ששלח ("מי הכניס" = w), הפריט סומן "done" ויצא מהתור', t8.d === 1 && t8.eu === 'w' && t8.who === 'w' && CLOUD.docs[qid].st.stringValue === 'done' && CLOUD.docs[qid].stBy.stringValue === 'm' && t8.left === 0, Object.assign(t8, { st: CLOUD.docs[qid].st }));
  check('8א הצילום נמחק מהענן אחרי טיפול', Object.keys(CLOUD.parts).length === 0, Object.keys(CLOUD.parts));
  // לא נספר פעמיים: ניסיון לסמן שוב → 403 מהחוקים → "כבר טופל", אין רשומה נוספת
  const patches0 = CLOUD.log.filter((r) => r.m === 'PATCH').length;
  await mp.evaluate((id) => { MQ.L.push({ id, uid: 'w', by: 'w', t: Date.now(), st: 'new', k: 'transfer', np: 1 }); return mqSet(id, 'rej', 'x'); }, qid); await H.settle(mp, 500);
  check('9 טיפול שני באותו פריט נדחה ("כבר טופל"); הסטטוס נשאר done', CLOUD.docs[qid].st.stringValue === 'done' && CLOUD.log.filter((r) => r.m === 'PATCH').length === patches0 + 1 && (await mp.evaluate(() => MQ.L.length)) === 0);
  // דחייה של פריט שני
  CLOUD.docs.q2 = { uid: S('w'), by: S('w'), t: I(Date.now()), st: S('new'), k: S('zreport'), np: I(1) }; CLOUD.parts['q2/0'] = 'x';
  await mp.evaluate(() => { if (US) usReset(); MQ.at = 0; return mqLoad(); }); await H.settle(mp, 300); await mp.evaluate(() => go('mq')); await H.settle(mp, 300);
  await mp.click('[data-a=mqRej]'); await H.settle(mp, 200); await mp.click('#dlg [data-a=yes]'); await H.settle(mp, 600);
  check('10 דחייה: st=rej, יצא מהרשימה', CLOUD.docs.q2.st.stringValue === 'rej' && (await mp.evaluate(() => MQ.L.length)) === 0, CLOUD.docs.q2.st);
  // סבב 4: נפתח מהתור, יצא מהמסך האחיד ונשמר ממסך אחר → מסומן "טופל" אוטומטית, פעם אחת
  CLOUD.docs.q3 = { uid: S('w'), by: S('w'), t: I(Date.now()), st: S('new'), k: S('transfer'), np: I(1) }; CLOUD.parts['q3/0'] = CLOUD.parts['q3/0'] || (await mp.evaluate(() => 'data:image/png;base64,' + document.createElement('canvas').toDataURL('image/png').split(',')[1]));
  await mp.evaluate(() => { MQ.at = 0; return mqLoad(); }); await H.settle(mp, 300); await mp.evaluate(() => go('mq')); await H.settle(mp, 300);
  await mp.click('[data-a=mqOpen]'); await H.settle(mp, 1200);
  const p10 = CLOUD.log.filter((r) => r.m === 'PATCH').length;
  await mp.evaluate(() => { usReset(); go('todo'); S.tx.push({ id: 'mqT3', t: 'exp', cat: 'x', sub: '', date: '2026-11-03', amt: 20, note: '', pays: [] }); save(); }); await H.settle(mp, 800);
  const t10a = await mp.evaluate(() => ({ eu: S.tx.find((t) => t.id === 'mqT3').eu, left: MQ.L.length, mqp: MQP }));
  check('10א נשמר ממסך אחר: הפריט סומן done אוטומטית, eu = העובד', CLOUD.docs.q3.st.stringValue === 'done' && t10a.eu === 'w' && t10a.left === 0 && t10a.mqp === null && CLOUD.log.filter((r) => r.m === 'PATCH').length === p10 + 1, t10a);
  await mp.evaluate(() => { S.tx.push({ id: 'mqT4', t: 'exp', cat: 'x', sub: '', date: '2026-11-03', amt: 5, note: '', pays: [] }); save(); }); await H.settle(mp, 500);
  check('10ב שמירה נוספת לא מסמנת שוב (אין PATCH נוסף), והרשומה הבאה לא מקבלת eu של העובד', CLOUD.log.filter((r) => r.m === 'PATCH').length === p10 + 1 && (await mp.evaluate(() => S.tx.find((t) => t.id === 'mqT4').eu)) !== 'w');
  delete CLOUD.docs.q3; // לא שייך לבדיקות 12–14 של העובד (שני מסמכים)
  // סבב 4: ח.פ ספק נשלח לעובד (pubCfg) וזיהוי אצל עובד לפי ח.פ קודם
  const t10c = await mp.evaluate(() => { const o = cfgLocal(); localStorage.setItem(CK, JSON.stringify({ cats: [{ id: 'cS', name: 'ספקים', beh: 'sup', subs: [{ id: 's1', name: 'אלפא', hp: '512345678' }, { id: 's2', name: 'בטא' }] }] }));
    const L = wkSubsAll(), a = usSup({ supplier: 'שם אחר לגמרי', supplier_id: '512345678' }, L), b = usSup({ supplier: 'בטא', supplier_id: '' }, L); localStorage.setItem(CK, JSON.stringify(o));
    const src = pubCfg.toString(); return { a: a && a.id, b: b && b.id, hp: L[0].hp, pub: /hp:s\.hp/.test(src) }; });
  check('10ג עובד: ח.פ ב-cfg (pubCfg שולח hp), זיהוי לפי ח.פ גם כשהשם שונה, ובלי ח.פ – לפי שם', t10c.a === 's1' && t10c.b === 's2' && t10c.hp === '512345678' && t10c.pub, t10c);
  check('11 אין שגיאות JS (מנהל)', mp.__errors.length === 0, mp.__errors);
  // ---- עובד: הודעה "טופל"/"נדחה", בלי סכומים; פעם אחת בלבד ----
  const toasts = async () => wp.evaluate(() => [...document.querySelectorAll('.toast,#toast,[class*=toast]')].map((e) => e.textContent).join(' | '));
  await wp.evaluate(() => { MQ.mat = 0; return mqMine(); }); await H.settle(wp, 300);
  const tt = await toasts(); const seen = await wp.evaluate(() => JSON.parse(localStorage.getItem(LK('lp-mq-seen')) || '{}'));
  check('12 עובד: הודעה "טופל" ו"נדחה" על שני המסמכים, בלי סכומים', /טופל/.test(tt) && /נדחה/.test(tt) && !/₪|\d+\.\d\d/.test(tt) && Object.keys(seen).length === 2, tt);
  await wp.evaluate(() => { WS = 'home'; NAV = [{ v: 'wk' }]; render(0); }); await H.settle(wp, 300);
  const t13 = await wp.evaluate(() => document.getElementById('main').innerText);
  check('13 עובד: "מסמכים ששלחתי למנהל" עם הסטטוסים', /מסמכים ששלחתי למנהל/.test(t13) && /טופל/.test(t13) && /נדחה/.test(t13), t13.slice(-200));
  const cnt = await wp.evaluate(async () => { const o = window.toast; let n = 0; window.toast = (t) => { if (/ששלחת למנהל/.test(t)) n++; }; MQ.mat = 0; await mqMine(); window.toast = o; return n; });
  check('14 ההודעה לא חוזרת בפעם השנייה', cnt === 0, cnt);
  check('15 אין שגיאות JS (עובד)', wp.__errors.length === 0, wp.__errors);
  // ---- שם עובד: staff.name מוצג ב"מי הכניס"; בלי שם – קידומת המייל ----
  const t16 = await mp.evaluate(() => { ADM.staff = [{ uid: 'u7', name: 'משה כהן', email: 'moshe@x.co' }, { uid: 'u8', name: '', email: 'dana@x.co' }]; return { a: dxWho({ eu: 'u7' }), b: dxWho({ eu: 'u8' }), c: dxWho({ eu: 'zz' }), d: dxWho({}) }; });
  check('16 "מי הכניס": שם מכרטיס העובד; בלי שם – קידומת המייל; לא מוכר – "משתמש אחר"; ישן – ריק', t16.a === 'משה כהן' && t16.b === 'dana' && t16.c === 'משתמש אחר' && t16.d === '', t16);
  check('17 אין שגיאות JS (סוף)', mp.__errors.length === 0, mp.__errors);
  await m.ctx.close(); await w.ctx.close();
  await browser.close(); console.log(fail ? 'נכשלו ' + fail : 'כל הבדיקות עברו'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
