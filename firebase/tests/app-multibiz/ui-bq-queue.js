'use strict';
// תור הזיהוי בטלפון (11.11.2026, החלטה 5 – בלי שרת): תור החשבוניות (BQ) נשמר במכשיר וחוזר אחרי סגירה,
// ניסיונות חוזרים בלי הגבלה עם המתנה עד 30 שניות, שגיאה קבועה בלי ניסיון נוסף, המתנה לרשת, מספר זיהויים במקביל,
// ו"לא נספר פעמיים" בכל נקודת אישור (גם כשרשימת התור השמורה לא הספיקה להתעדכן לפני הסגירה).
// רשת מדומה (בלי אמולטור): scanDocument נענה כאן, עם כשלים מתוכננים.
// שימוש: node ui-bq-queue.js <www-dir> [out.json]
const fs = require('fs'); const crypto = require('crypto'); const H = require('./harness');
const BZ0 = ['larg', 'peami'].join('');
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
let fail = 0; const res = []; const check = (n, ok, info) => { if (!ok) fail++; res.push({ n, ok: !!ok, info }); console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const [www, out] = process.argv.slice(2);
  const browser = await H.launch();
  const cfg = { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: ALL } }, admins: { '|m': 1 }, staff: { '|w': 1 } };
  const { ctx, page } = await H.newPage(browser, www, cfg, [], 'm'); await page.setViewportSize({ width: 360, height: 740 });

  // ---- scanDocument מדומה: מסמך מזוהה לפי התוכן; plan(d, kind) מחליט מה לענות בכל ניסיון ----
  const M = { docs: new Map(), plan: () => 'ok', delay: 0, inflight: 0, max: 0, inK: {}, maxK: {} };
  const resetMax = () => { M.max = 0; M.maxK = {}; };
  await ctx.route('**/scanDocument', async (route) => {
    let b = {}; try { b = JSON.parse(route.request().postData()).data || {}; } catch (e) { /* */ }
    const key = crypto.createHash('md5').update((b.files || []).map((f) => f.data).join('|')).digest('hex');
    let d = M.docs.get(key); if (!d) { d = { key, idx: M.docs.size + 1, att: 0, t: [], kind: b.kind }; M.docs.set(key, d); }
    d.att++; d.t.push(Date.now()); M.inflight++; M.inK[b.kind] = (M.inK[b.kind] || 0) + 1; M.max = Math.max(M.max, M.inflight); M.maxK[b.kind] = Math.max(M.maxK[b.kind] || 0, M.inK[b.kind]);
    try {
      if (M.delay) await sleep(M.delay);
      const p = M.plan(d, b.kind); const J = (st, o) => route.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(o) });
      if (p === 'busy') return await J(503, { error: { status: 'UNAVAILABLE', message: 'הזיהוי עמוס כרגע, נסו שוב בעוד דקה', details: { reason: 'overloaded' } } });
      if (p === 'raw503') return await route.fulfill({ status: 503, contentType: 'text/html', body: 'Service Unavailable' }); // תקלה לפני הפונקציה (לא נספר במכסה)
      if (p === 'p413') return await route.fulfill({ status: 413, contentType: 'text/html', body: 'Payload Too Large' });
      if (p === 'raw429') return await route.fulfill({ status: 429, contentType: 'text/html', body: 'Rate exceeded.' }); // אין מופע פנוי (לא מכסה)
      if (p === 'quota') return await J(429, { error: { status: 'RESOURCE_EXHAUSTED', message: 'עברת את מגבלת השימוש היומית: 30 זיהויים ביום למשתמש. אפשר למלא ידנית, או לנסות שוב מחר.', details: { reason: 'daily-limit' } } });
      if (p === 'badfile') return await J(400, { error: { status: 'INVALID_ARGUMENT', message: 'הקובץ לא תקין', details: { reason: 'bad-file' } } });
      if (p === 'garbage') return await J(200, { result: { text: 'זו לא תשובת JSON' } }); // תשובה שלא נקראה
      const sup = p === 'newsup' ? 'ספק שלא קיים' : 'ספק בדיקה';
      const o = b.kind === 'transfer' ? { document_type: 'invoice' } : { document_type: 'invoice', supplier: sup, number: String(5000 + d.idx), date: '2026-11-01', total_with_vat: 100 + d.idx };
      return await J(200, { result: { text: JSON.stringify(o) } });
    } finally { M.inflight--; M.inK[b.kind]--; }
  });

  await H.login(page, 'm@x.co');
  const prep = async () => page.evaluate(() => { let s = Math.floor(performance.now() * 1000) % 2147483647 || 7; Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x80000000; }; const sh = document.getElementById('sheet'); if (sh && !sh.hidden && typeof ACT.startBlank === 'function') ACT.startBlank(); });
  await prep(); await H.settle(page, 400);
  const errs0 = () => page.__errors.slice();

  // 0. ערכי ברירת המחדל בקוד (מה שירוץ בטלפון)
  const d0 = await page.evaluate(() => { const mx = []; for (let k = 0; k < 40; k++) { let m = 0, lo = 1e9; for (let i = 0; i < 300; i++) { const v = scqDelay(k); m = Math.max(m, v); lo = Math.min(lo, v); } mx.push([lo, m]); } return { par: SCQ.par, all: SCQ.all, base: SCQ.base, cap: SCQ.cap, mx }; });
  check('0 ברירת מחדל: עד 3 במקביל בתור, עד 4 בסך הכול, המתנה 2→4→8→16→30 שניות עם פיזור, תקרה 30 שניות',
    d0.par === 3 && d0.all === 4 && d0.base === 2000 && d0.cap === 30000 && d0.mx.every(([, m]) => m <= 30000) && d0.mx[0][1] <= 2000 && d0.mx[0][0] >= 1500 && d0.mx[1][1] <= 4000 && d0.mx[4][1] <= 30000 && d0.mx[4][0] >= 22500 && d0.mx[39][0] >= 22500,
    { par: d0.par, all: d0.all, first: d0.mx.slice(0, 6), last: d0.mx[39] });

  // בבדיקה: המתנות קצרות (אותה נוסחה, יחידות קטנות), כדי ש-15 כשלים לא ייקחו דקות
  const fast = () => page.evaluate(() => { SCQ.base = 40; SCQ.cap = 250; });
  await fast();
  await page.evaluate(() => { const c = S.cats.find((x) => x.beh === 'sup' && !x.hid && !x.off); if (!S.subs.some((s) => s.id === 's1')) S.subs.push({ id: 's1', cat: c.id, name: 'ספק בדיקה' }); save(); });
  let seq = 0;
  const addImgs = (n, tag) => { const L = []; for (let i = 0; i < n; i++) L.push((tag || 'DOC') + ' ' + (++seq)); return page.evaluate(async (labels) => {
    const c = S.cats.find((x) => x.beh === 'sup' && !x.hid && !x.off); const fids = [];
    for (const L of labels) { if (!A || A.step !== 'scan') { openAdd({ type: 'exp', cat: c.id, pre: false }); ACT.pick({ dataset: { k: 'cat', v: c.id } }); }
      const cv = document.createElement('canvas'); cv.width = 500; cv.height = 700; const x = cv.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 500, 700); x.fillStyle = '#000'; x.font = 'bold 48px sans-serif'; x.fillText(L, 30, 120); x.strokeRect(10, 10, 480, 680);
      const u = cv.toDataURL('image/jpeg', 0.9); A.pg = [u]; A.hi = [u]; await ACT.scanQ(); fids.push(BQ[BQ.length - 1].fid); }
    return fids; }, L); };
  const addPdf = (tag) => page.evaluate(async (label) => { const c = S.cats.find((x) => x.beh === 'sup' && !x.hid && !x.off); if (!A || A.step !== 'scan') { openAdd({ type: 'exp', cat: c.id, pre: false }); ACT.pick({ dataset: { k: 'cat', v: c.id } }); }
    const f = new File(['%PDF-1.4\n% ' + label + '\n%%EOF\n'], label + '.pdf', { type: 'application/pdf' }); await CHG.scanmulti({ files: [f], value: '' }); return BQ[BQ.length - 1].fid; }, (tag || 'PDF') + ' ' + (++seq));
  const st = (fids) => page.evaluate((f) => f.map((id) => { const it = BQ.find((b) => b.fid === id); return it ? it.st : null; }), fids);
  const waitSt = async (fids, ok, ms) => { const t0 = Date.now(); let s; while (Date.now() - t0 < (ms || 20000)) { s = await st(fids); if (s.every(ok)) return s; await sleep(150); } return s; };
  const clearQ = () => page.evaluate(() => { BQ = []; bqSave(); if (A) sheetClose(); });
  const docOf = (label) => [...M.docs.values()].sort((a, b) => b.idx - a.idx);

  // 1. כשל בשני הניסיונות הראשונים – מצליח בשלישי; הזמן בין ניסיונות ≤ התקרה
  M.plan = (d) => (d.att <= 2 ? 'busy' : 'ok');
  let f1 = await addImgs(1); let s1 = await waitSt(f1, (x) => x === 'ok');
  let D = docOf()[0]; const gaps = D.t.slice(1).map((t, i) => t - D.t[i]);
  check('1 כשל מדומה ב-2 הניסיונות הראשונים – הזיהוי מצליח בניסיון ה-3', s1[0] === 'ok' && D.att === 3, { s1, att: D.att });
  check('1א הזמן בין ניסיונות ≤ התקרה (בבדיקה 250ms; בקוד 30 שניות) וגדל בהדרגה', gaps.length === 2 && gaps.every((g) => g <= 250 + 400) && gaps[0] >= 8, gaps);
  await clearQ();

  // 2. כשל ממושך שלא נספר במכסה (15 כשלים: 503/429 בלי תשובת הפונקציה) – ממשיך לנסות במהירות ומצליח בניסיון 16
  M.plan = (d) => (d.att <= 15 ? (d.att % 2 ? 'raw503' : 'raw429') : 'ok');
  f1 = await addImgs(1); s1 = await waitSt(f1, (x) => x === 'ok', 30000);
  D = docOf()[0]; const g2 = D.t.slice(1).map((t, i) => t - D.t[i]);
  check('2 כשל ממושך שלא נספר במכסה (15 כשלים: 503/429 בלי תשובת הפונקציה) – לא עוצר, מצליח בניסיון 16', s1[0] === 'ok' && D.att === 16, { s1, att: D.att });
  check('2א כל ההמתנות ≤ התקרה', g2.every((g) => g <= 250 + 400), { max: Math.max(...g2) });
  await clearQ();

  // 2ב. סבב 2 (החלטת המשתמש): שגיאה שנספרת במכסה (overloaded מהשרת) – אחרי 3 לפריט, ניסיון כל 5 דקות; "נסה עכשיו" – ניסיון מיידי
  M.plan = () => 'busy';
  const [fs2] = await addImgs(1, 'SLOW'); await waitSt([fs2], (x) => x === 'q', 10000); await sleep(1500); D = docOf()[0];
  const sl = await page.evaluate((fid) => { const it = BQ.find((b) => b.fid === fid); return { st: it.st, qf: it.qf, wait: it.nx - Date.now(), tm: !!bqTm.t, slow: SCQ.slow }; }, fs2);
  check('2ב 3 כשלים שנספרים במכסה – עובר להמתנה של 5 דקות (בלי ניסיונות נוספים), מפנה את מקומו בתור', D.att === 3 && sl.st === 'q' && sl.qf === 3 && sl.slow === 300000 && sl.wait > 290000 && sl.wait <= 300000 && sl.tm, { att: D.att, sl });
  await page.reload(); await page.waitForLoadState('load'); await prep(); await fast(); await H.settle(page, 1500); D = docOf()[0];
  const sl2 = await page.evaluate((fid) => { const it = BQ.find((b) => b.fid === fid); ACT.bqReview(); const c = document.querySelector('#dlg [data-bq="' + it.id + '"]'); return { st: it.st, qf: it.qf, wait: it.nx - Date.now(), t: c ? c.innerText : '', btn: !!(c && c.querySelector('[data-a=bqNow]')) }; }, fs2);
  check('2ג אחרי טעינה מחדש: ההמתנה נשמרת (בלי ניסיון מיידי), בכרטיס "ניסיון חוזר בעוד 5 דקות" וכפתור "נסה עכשיו"', D.att === 3 && sl2.st === 'q' && sl2.qf === 3 && sl2.wait > 280000 && /ניסיון חוזר בעוד 5 דקות/.test(sl2.t) && sl2.btn, { att: D.att, sl2 });
  await page.click('#dlg [data-a=bqNow]'); await sleep(1200); D = docOf()[0];
  const sl3 = await page.evaluate((fid) => { const it = BQ.find((b) => b.fid === fid); return { st: it.st, qf: it.qf, wait: it.nx - Date.now() }; }, fs2);
  check('2ד "נסה עכשיו": ניסיון אחד מיד; נכשל שוב – חוזר להמתנה של 5 דקות', D.att === 4 && sl3.st === 'q' && sl3.qf === 4 && sl3.wait > 290000, { att: D.att, sl3 });
  M.plan = () => 'ok'; const tnow = await page.evaluate(() => Date.now()); await page.clock.setFixedTime(tnow + 301000); await page.evaluate(() => bqPump());
  const sl4 = await waitSt([fs2], (x) => x === 'ok', 10000); D = docOf()[0];
  check('2ה כעבור 5 דקות – ניסיון נוסף ומצליח', sl4[0] === 'ok' && D.att === 5 && await page.evaluate((fid) => !BQ.find((b) => b.fid === fid).qf, fs2), { sl4, att: D.att });
  await page.evaluate(() => closeDlg()); await clearQ();
  // מסמך שהתקבל (SI): אותו כלל
  M.plan = () => 'busy';
  const siS = await page.evaluate(async () => { siLoad(); const cv = document.createElement('canvas'); cv.width = 300; cv.height = 300; const x = cv.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 300, 300); x.fillStyle = '#000'; x.fillText('SI SLOW', 20, 50); const u = cv.toDataURL('image/jpeg', 0.9); const h = trHash(u); await fput('shin:' + h, u); const it = { id: uid(), h, name: 'slow.jpg', mime: 'image/jpeg', size: 1000, at: Date.now(), st: 'q', type: null, man: 0, err: '' }; SI.L.push(it); siSave(); siPump(); return it.id; });
  await sleep(2000); D = docOf()[0]; const a2v = D.att;
  const ss = await page.evaluate((id) => { const x = SI.L.find((y) => y.id === id); NAV = [{ v: 'home' }]; go('todo'); const c = document.querySelector('[data-si="' + id + '"]'); return { st: x.st, qf: x.qf, wait: x.nx - Date.now(), btn: !!(c && c.querySelector('[data-a=siNow]')), t: c ? c.innerText : '' }; }, siS);
  await page.evaluate((id) => ACT.siNow({ dataset: { id } }), siS); await sleep(1000); const D2 = docOf()[0];
  check('2ו מסמך שהתקבל: 3 כשלים שנספרים – המתנה של 5 דקות עם "נסה עכשיו"; לחיצה = ניסיון אחד', a2v === 3 && ss.st === 'q' && ss.qf === 3 && ss.wait > 290000 && ss.btn && /ניסיון חוזר/.test(ss.t) && D2.att === 4, { att: a2v, ss: { st: ss.st, qf: ss.qf, wait: ss.wait, btn: ss.btn }, att2: D2.att });
  await page.evaluate((id) => { siDrop(id); NAV = [{ v: 'home' }]; render(0); }, siS);

  // 3. שגיאה קבועה – בלי ניסיון נוסף, מסומנת לפריט
  M.plan = () => 'quota'; // כל ניסיון = מכסה נגמרה
  const fq = await addPdf('QUOTA');
  let s3 = await waitSt([fq], (x) => x === 'fail' || x === 'ok', 10000); await sleep(900);
  D = docOf()[0];
  const c3 = await page.evaluate((fid) => { const it = BQ.find((b) => b.fid === fid); ACT.bqReview(); const card = document.querySelector('#dlg [data-bq="' + it.id + '"]'); const t = card ? card.innerText : ''; closeDlg(); return { aiErr: it.aiErr, t }; }, fq);
  check('3 מכסה נגמרה – ניסיון אחד בלבד, הפריט "למילוי ידני" עם הסבר', s3[0] === 'fail' && D.att === 1 && /מגבלת/.test(c3.aiErr || '') && /הזיהוי החכם לא עבד/.test(c3.t) && /למילוי ידני/.test(c3.t), { s3, att: D.att, c3 });
  M.plan = () => 'p413'; const n3 = M.docs.size;
  const f413 = await addPdf('P413'); const s413 = await waitSt([f413], (x) => x === 'fail' || x === 'ok', 10000); await sleep(900); D = docOf()[0];
  check('3ד 413 (קובץ גדול מדי לשרת) – שגיאה קבועה, ניסיון אחד', s413[0] === 'fail' && D.att === 1 && M.docs.size === n3 + 1, { s413, att: D.att });
  M.plan = () => 'ok'; const n3b = M.docs.size;
  const fBig = await page.evaluate(async () => { const c = S.cats.find((x) => x.beh === 'sup' && !x.hid && !x.off); if (!A || A.step !== 'scan') { openAdd({ type: 'exp', cat: c.id, pre: false }); ACT.pick({ dataset: { k: 'cat', v: c.id } }); }
    const f = new File(['%PDF-1.4\n%', new Uint8Array(11 * 1048576)], 'big.pdf', { type: 'application/pdf' }); await CHG.scanmulti({ files: [f], value: '' }); return BQ[BQ.length - 1].fid; });
  const sBig = await waitSt([fBig], (x) => x === 'fail' || x === 'ok', 10000); await sleep(600);
  const aBig = await page.evaluate((fid) => BQ.find((b) => b.fid === fid).aiErr, fBig);
  check('3ה PDF מעל 10MB – נכנס לתור "למילוי ידני" בלי שליחה לשרת', sBig[0] === 'fail' && M.docs.size === n3b && /10MB/.test(aBig || ''), { sBig, aBig, req: M.docs.size - n3b });
  M.plan = () => 'badfile';
  const fb = await addPdf('BAD'); let s3b = await waitSt([fb], (x) => x === 'fail' || x === 'ok', 10000); await sleep(900); D = docOf()[0];
  check('3א קובץ לא מתאים (INVALID_ARGUMENT) – ניסיון אחד בלבד, מסומן', s3b[0] === 'fail' && D.att === 1, { s3b, att: D.att });
  M.plan = () => 'garbage';
  const fg = await addPdf('GARBAGE'); const s3g = await waitSt([fg], (x) => x === 'fail' || x === 'ok', 10000); await sleep(900); D = docOf()[0];
  check('3ג תשובה שלא נקראה (כל ניסיון נספר במכסה) – עד 3 ניסיונות ואז למילוי ידני', s3g[0] === 'fail' && D.att === 3, { s3g, att: D.att });
  // SI (מסמכים שהתקבלו): מכסה נגמרה – ניסיון אחד, הפריט מסומן "הזיהוי לא עבד"
  M.plan = () => 'quota';
  const si3 = await page.evaluate(async () => { siLoad(); const cv = document.createElement('canvas'); cv.width = 300; cv.height = 300; const x = cv.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 300, 300); x.fillStyle = '#000'; x.fillText('SI QUOTA', 20, 50); const u = cv.toDataURL('image/jpeg', 0.9); const h = trHash(u); await fput('shin:' + h, u); const it = { id: uid(), h, name: 'q.jpg', mime: 'image/jpeg', size: 1000, at: Date.now(), st: 'q', type: null, man: 0, err: '' }; SI.L.push(it); siSave(); siPump(); return it.id; });
  await sleep(1500); D = docOf()[0];
  const si3r = await page.evaluate((id) => { const x = SI.L.find((y) => y.id === id); return { st: x.st, err: x.err }; }, si3);
  check('3ב מסמך שהתקבל: מכסה נגמרה – ניסיון אחד, מסומן כשגיאה לפריט', si3r.st === 'fail' && /מגבלת/.test(si3r.err) && D.att === 1 && D.kind === 'transfer', { si3r, att: D.att });
  await page.evaluate((id) => { siDrop(id); }, si3);
  await clearQ();

  // 4. אין רשת – הפריטים נכנסים לתור כמו היום, לא נשלחת בקשה ולא "נשרף" ניסיון; כשהרשת חוזרת – מזוהים
  M.plan = () => 'ok'; const n4 = M.docs.size;
  await ctx.setOffline(true);
  const f4 = await addImgs(2, 'OFF'); await sleep(1500);
  const o4 = await page.evaluate((f) => ({ n: BQ.length, wn: f.map((id) => { const it = BQ.find((b) => b.fid === id); return [it.st, !!it.wnet]; }), saved: !!localStorage.getItem(BQK()) }), f4);
  check('4 אין רשת: 2 מסמכים בתור (נשמרו במכשיר), "ממתין לחיבור", בלי בקשות לשרת', o4.n === 2 && o4.wn.every(([s, w]) => (s === 'run' && w) || s === 'q') && M.docs.size === n4 && o4.saved, { o4, req: M.docs.size - n4 });
  await ctx.setOffline(false);
  const s4 = await waitSt(f4, (x) => x === 'ok', 15000);
  check('4א הרשת חזרה – שניהם זוהו, ניסיון אחד לכל אחד', s4.every((x) => x === 'ok') && [...M.docs.values()].filter((d) => d.idx > n4).every((d) => d.att === 1) && M.docs.size === n4 + 2, { s4 });
  await clearQ();

  // 5. מספר זיהויים במקביל: BQ עד 3; BQ+SI עד 4
  M.plan = () => 'ok'; M.delay = 500; resetMax();
  const f5 = await addImgs(8, 'PAR'); await waitSt(f5, (x) => x === 'ok', 30000);
  check('5 תור החשבוניות: עד 3 זיהויים במקביל (ובפועל 3)', M.maxK.invoice === 3 && M.max === 3, { max: M.max, maxK: M.maxK });
  await clearQ(); resetMax();
  const si5 = await page.evaluate(async () => { siLoad(); const ids = []; for (let i = 0; i < 4; i++) { const cv = document.createElement('canvas'); cv.width = 300; cv.height = 300; const x = cv.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 300, 300); x.fillStyle = '#000'; x.fillText('SI PAR ' + i, 20, 50); const u = cv.toDataURL('image/jpeg', 0.9); const h = trHash(u); await fput('shin:' + h, u); const it = { id: uid(), h, name: 's' + i + '.jpg', mime: 'image/jpeg', size: 1000, at: Date.now(), st: 'q', type: null, man: 0, err: '' }; SI.L.push(it); ids.push(it.id); } siSave(); siPump(); return ids; });
  const f5b = await addImgs(6, 'PAR2'); await waitSt(f5b, (x) => x === 'ok', 30000);
  { const t0 = Date.now(); while (Date.now() - t0 < 15000) { if (await page.evaluate((ids) => ids.every((id) => (SI.L.find((y) => y.id === id) || {}).st === 'ok'), si5)) break; await sleep(150); } }
  const si5ok = await page.evaluate((ids) => ids.every((id) => (SI.L.find((y) => y.id === id) || {}).st === 'ok'), si5);
  check('5א תור החשבוניות + מסמכים שהתקבלו: עד 4 יחד, כל תור עד 3', M.max <= 4 && M.max >= 3 && (M.maxK.invoice || 0) <= 3 && (M.maxK.transfer || 0) <= 3 && si5ok, { max: M.max, maxK: M.maxK, si5ok });
  await page.evaluate((ids) => ids.forEach((id) => siDrop(id)), si5);
  await clearQ(); M.delay = 0;

  // 6. 10 מסמכים בתור, סגירת האפליקציה באמצע (טעינה מחדש מלאה) – בפתיחה הבאה התור חוזר וכל ה-10 מזוהים וממתינים לאישור
  M.plan = () => 'ok'; M.delay = 1200; const n6 = M.docs.size;
  const f6 = await addImgs(10, 'TEN');
  { const t0 = Date.now(); while (Date.now() - t0 < 15000) { const s = await st(f6); if (s.filter((x) => x === 'ok').length >= 2) break; await sleep(100); } }
  const pre6 = await st(f6); const okBefore = f6.filter((_, i) => pre6[i] === 'ok');
  await page.reload(); await page.waitForLoadState('load'); await prep(); await fast(); await H.settle(page, 300);
  M.delay = 300;
  const s6 = await waitSt(f6, (x) => x === 'ok', 30000);
  const r6 = await page.evaluate((f) => ({ n: BQ.length, fids: BQ.map((b) => b.fid), pg: BQ.every((b) => b.pg.length === 1 && b.hi.length === 1), sub: BQ.every((b) => b.f && b.f.sub === 's1' && b.f.inv && b.f.amt) }), f6);
  const req6 = [...M.docs.values()].filter((d) => d.idx > n6);
  check('6 10 מסמכים, טעינה מחדש באמצע (' + okBefore.length + ' זוהו לפני) – אחרי הפתיחה כל ה-10 בתור ומזוהים',
    pre6.some((x) => x !== 'ok') && r6.n === 10 && s6.every((x) => x === 'ok') && f6.every((f) => r6.fids.includes(f)) && new Set(r6.fids).size === 10 && r6.pg && r6.sub, { pre6, s6, r6: { n: r6.n, pg: r6.pg, sub: r6.sub } });
  check('6א מסמך שזוהה לפני הסגירה לא זוהה שוב (חיסכון במכסה); סך הבקשות ≤ 10 + 3 שהיו באמצע', req6.length === 10 && req6.reduce((a, d) => a + d.att, 0) <= 13, { att: req6.map((d) => d.att) });
  await page.evaluate(() => ACT.bqReview()); await H.settle(page, 200);
  check('6ב מסך "בדיקת חשבוניות" מציג 10 כרטיסים מזוהים, בלי שגיאות JS', await page.evaluate(() => document.querySelectorAll('#dlg [data-bq]').length === 10 && /10 חשבוניות · 10 זוהו/.test(document.querySelector('#dlg [data-bqhead]').textContent)) && page.__errors.length === 0, page.__errors);

  // 6ג. קריאת קובץ שנכשלה רגע בזמן השחזור – הפריט לא נמחק מהרשימה השמורה, וחוזר בפעם הבאה
  const r6c = await page.evaluate(async (bad) => { closeDlg(); const K = BQK(), og = fget; fget = async (id) => { if (id === bad) throw new Error('busy'); return og(id); };
    BQ = []; BQR.u = ''; await bqRestore(); const a = { n: BQ.length, saved: JSON.parse(localStorage.getItem(K)).L.length };
    fget = og; BQ = []; BQR.u = ''; await bqRestore(); return { a, n2: BQ.length, saved2: JSON.parse(localStorage.getItem(K)).L.length }; }, f6[0]);
  check('6ג כשל רגעי בקריאת קובץ בשחזור: 9 חזרו, 10 נשארו שמורים; בפעם הבאה – 10', r6c.a.n === 9 && r6c.a.saved === 10 && r6c.n2 === 10 && r6c.saved2 === 10, r6c);

  // 7. "אישור הכול": כל מסמך נשמר פעם אחת; גם אם רשימת התור השמורה לא הספיקה להתעדכן (סגירה מיד אחרי האישור) – לא חוזר ולא נשמר שוב
  const K = await page.evaluate(() => BQK());
  const cnt = (fids) => page.evaluate((f) => ({ tx: S.tx.length, per: f.map((id) => S.tx.filter((t) => t.file === id || (t.pays || []).some((p) => p && p.file === id)).length), bq: BQ.length, inBQ: f.filter((id) => BQ.some((b) => b.fid === id)).length }), fids);
  const stale7 = await page.evaluate((k) => localStorage.getItem(k), K); const b7 = await cnt(f6);
  await page.evaluate(() => ACT.bqAll()); await H.settle(page, 200);
  const a7 = await cnt(f6);
  check('7 אישור הכול: 10 נשמרו, כל אחד פעם אחת, התור התרוקן', a7.tx === b7.tx + 10 && a7.per.every((n) => n === 1) && a7.bq === 0 && !(await page.evaluate((k) => localStorage.getItem(k), K)), { b7: b7.tx, a7 });
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [K, stale7]); // סגירה לפני שהרשימה השמורה התעדכנה
  await page.reload(); await page.waitForLoadState('load'); await prep(); await fast(); await H.settle(page, 1500);
  const r7 = await cnt(f6);
  check('7א אחרי טעינה מחדש עם רשימה ישנה: אף מסמך לא חזר לתור, וכל אחד עדיין נשמר פעם אחת', r7.tx === a7.tx && r7.inBQ === 0 && r7.per.every((n) => n === 1) && !(await page.evaluate((k) => localStorage.getItem(k), K)), r7);

  // 8. נקודות כניסה נוספות: ספק חדש, כפילות ("שמור בכל זאת"), תשלום שממתין לחשבונית (הוצאה חדשה / חיבור)
  M.delay = 0;
  const entry = async (name, plan, act) => {
    M.plan = plan; const [fid] = await addImgs(1, name); await waitSt([fid], (x) => x === 'ok' || x === 'fail', 15000);
    const stale = await page.evaluate((k) => localStorage.getItem(k), K); const b = await cnt([fid]);
    const info = await page.evaluate(act, fid); await H.settle(page, 200);
    const a = await cnt([fid]);
    await page.evaluate(([k, v]) => { if (v) localStorage.setItem(k, v); }, [K, stale]);
    await page.reload(); await page.waitForLoadState('load'); await prep(); await fast(); await H.settle(page, 1500);
    const r = await cnt([fid]);
    return { b, a, r, info, stale: !!stale };
  };
  const e1 = await entry('NEWSUP', () => 'newsup', (fid) => { const it = BQ.find((b) => b.fid === fid); it.f.sub = '__new'; it.f.newname = 'ספק חדש בדיקה'; const n0 = S.subs.length; ACT.bqReview(); ACT.bqAll(); closeDlg(); return { subs: S.subs.length - n0 }; });
  check('8 ספק חדש: נשמר פעם אחת (וספק אחד נוסף), ולא חוזר אחרי טעינה עם רשימה ישנה', e1.stale && e1.a.tx === e1.b.tx + 1 && e1.a.per[0] === 1 && e1.info.subs === 1 && e1.r.inBQ === 0 && e1.r.per[0] === 1 && e1.r.tx === e1.a.tx, e1);
  const e2 = await entry('DUP', () => 'ok', (fid) => { const it = BQ.find((b) => b.fid === fid); const t = S.tx.find((x) => x.sub === 's1' && x.file && x.t === 'exp' && !x.await); it.f.inv = t.inv; it.f.amt = String(t.amt); it.f.date = t.date; ACT.bqReview(); ACT.bqAll(); const err = it.err, dupok = it.dupok; ACT.bqDup({ dataset: { id: it.id } }); closeDlg(); return { err, dupok }; });
  check('8א כפילות: נעצר עם הודעה, "זה מסמך אחר – שמור בכל זאת" שומר פעם אחת, ולא חוזר', /כבר קיימת/.test(e2.info.err || '') && e2.info.dupok === 0 && e2.a.tx === e2.b.tx + 1 && e2.a.per[0] === 1 && e2.r.inBQ === 0 && e2.r.per[0] === 1 && e2.r.tx === e2.a.tx, e2);
  await page.evaluate(() => { const c = S.cats.find((x) => x.beh === 'sup' && !x.hid && !x.off); const d = today(); S.tx.push({ id: 'aw1', t: 'exp', cat: c.id, sub: 's1', date: d, amt: 999, plan: d.slice(0, 7), inv: '', note: '', desc: '', kind: 'inv', await: 1, pays: [{ id: 'pw1', d, a: 999, m: 'העברה' }] }, { id: 'aw2', t: 'exp', cat: c.id, sub: 's1', date: d, amt: 888, plan: d.slice(0, 7), inv: '', note: '', desc: '', kind: 'inv', await: 1, pays: [{ id: 'pw2', d, a: 888, m: 'העברה' }] }); save(); });
  const e3 = await entry('AWNO', () => 'ok', (fid) => { const it = BQ.find((b) => b.fid === fid); ACT.bqReview(); ACT.bqAll(); const awq = it.awq; ACT.bqAwNo({ dataset: { id: it.id } }); closeDlg(); return { awq }; });
  check('8ב תשלום שממתין – "הוצאה חדשה בכל זאת": נשמר פעם אחת, ולא חוזר', e3.info.awq === 1 && e3.a.tx === e3.b.tx + 1 && e3.a.per[0] === 1 && e3.r.inBQ === 0 && e3.r.per[0] === 1 && e3.r.tx === e3.a.tx, e3);
  const e4 = await entry('AWJOIN', () => 'ok', (fid) => { const it = BQ.find((b) => b.fid === fid); const aw = S.tx.find((t) => t.await && t.sub === 's1'); it.f.amt = String(aw.amt); ACT.bqReview(); /* אותו סכום – בלי זיכוי עודף (התנהגות קיימת של awJoin) */ ACT.bqAll(); ACT.bqAw({ dataset: { id: it.id } }); const e = S.tx.find((t) => t.await && t.sub === 's1'); const eid = e && e.id; ACT.awJoin({ dataset: { e: eid } }); return { eid, file: (S.tx.find((t) => t.id === eid) || {}).file === fid, inBQ: BQ.some((b) => b.fid === fid) }; });
  check('8ג תשלום שממתין – "לחבר לתשלום": הקובץ חובר לתשלום הקיים (בלי הוצאה חדשה), ולא חוזר לתור', e4.info.file && !e4.info.inBQ && e4.a.tx === e4.b.tx && e4.a.per[0] === 1 && e4.r.inBQ === 0 && e4.r.per[0] === 1 && e4.r.tx === e4.a.tx, e4);

  // 9. הסרה מהתור באמצע ניסיונות חוזרים – מפסיק לנסות (לא מבזבז מכסה), והפריט לא חוזר אחרי טעינה
  M.plan = () => 'busy'; const [f9] = await addImgs(1, 'DEL'); await sleep(500);
  await page.evaluate((fid) => { const it = BQ.find((b) => b.fid === fid); ACT.bqReview(); ACT.bqDel({ dataset: { id: it.id } }); closeDlg(); }, f9);
  D = docOf()[0]; const a9 = D.att; await sleep(1200); D = docOf()[0];
  await page.reload(); await page.waitForLoadState('load'); await prep(); await H.settle(page, 1500);
  const r9 = await page.evaluate((fid) => BQ.some((b) => b.fid === fid), f9);
  check('9 הסרה באמצע ניסיונות: הניסיונות נפסקו, ולא חזר אחרי טעינה', D.att <= a9 + 1 && !r9, { a9, after: D.att, r9 });

  // 10. בדיקת עשן: פתיחה כמשתמש שכבר מחובר (מנהל עם תור שמור, ועובד) – בלי שגיאות JS ועם תוכן
  M.plan = () => 'ok'; await addImgs(2, 'SMOKE'); await sleep(300);
  await page.reload(); await page.waitForLoadState('load'); await H.settle(page, 2500);
  const sm = await page.evaluate(() => ({ main: (document.getElementById('main') || {}).innerText || '', bq: BQ.length }));
  check('10 עשן מנהל מחובר עם תור שמור: יש תוכן, התור חזר, בלי שגיאות JS', sm.main.length > 20 && sm.bq === 2 && page.__errors.length === 0, { bq: sm.bq, e: page.__errors });
  // 11. התנתקות: רשימת התור השמורה (פרטי חשבוניות) נמחקת מהטלפון
  const r11 = await page.evaluate(() => { const k = BQK(), had = !!localStorage.getItem(k); dvWipe = () => {}; /* כמו בטלפון (באפליקציה dvWipe לא רץ) */ syOut(); return { had, left: localStorage.getItem(k), other: Object.keys(localStorage).length }; });
  check('11 התנתקות: lp-bq של המשתמש נמחק (בלי למחוק הכול)', r11.had && r11.left === null && r11.other > 0, r11);
  const w = await H.newPage(browser, www, cfg, [], 'w'); await H.login(w.page, 'w@x.co'); await w.page.reload(); await w.page.waitForLoadState('load'); await H.settle(w.page, 2500);
  const wm = await w.page.evaluate(() => ({ t: (document.body.innerText || '').length, k: Object.keys(localStorage).filter((k) => /lp-bq/.test(k)) }));
  check('10א עשן עובד מחובר: יש תוכן, בלי שגיאות JS, בלי תור חשבוניות שמור', wm.t > 20 && w.page.__errors.length === 0 && wm.k.length === 0, { wm, e: w.page.__errors });
  void errs0;

  await browser.close();
  if (out) fs.writeFileSync(out, JSON.stringify({ fail, res }, null, 1));
  console.log(fail ? `נכשלו ${fail}` : 'כל הבדיקות עברו'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
