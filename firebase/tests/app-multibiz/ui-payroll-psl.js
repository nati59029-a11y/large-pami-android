'use strict';
// שכר, שלב ה' (19.11.2026): www/payroll-psl.js – תלושים. רשת מדומה, נתונים סינתטיים בלבד (בלי תלוש אמיתי).
// קובצי ה-PDF נוצרים בבדיקה (Chromium page.pdf, טקסט עברי אמיתי): תלוש של עובדת אחת, וקובץ מרוכז של 3 עמודים (דנה / יוסי / עמוד בלי שם).
// לכל עובד צבע פס עליון משלו – כך בודקים שהקובץ שנשמר לכל עובד כולל רק את העמוד שלו. תמונה נוצרת ב-canvas.
// שימוש: node ui-payroll-psl.js <www-dir> [out.json] [shots-dir]   (NODE_PATH=$(npm root -g))
const fs = require('fs'); const path = require('path'); const H = require('./harness');
let fail = 0; const R = []; const check = (n, ok, info) => { if (!ok) fail++; R.push({ n, ok: !!ok }); console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined && !ok ? ' | ' + JSON.stringify(info).slice(0, 600) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BZ0 = 'acme';
const closeD = async (page) => { if (await page.evaluate(() => { const d = document.getElementById('dlg'); return !!(d && d.open); })) { await page.evaluate(() => closeDlg()); await sleep(150); } };
const toasts = (page) => page.evaluate(() => [...document.querySelectorAll('.toast')].map((x) => x.innerText).join('|'));
const clearT = (page) => page.evaluate(() => document.querySelectorAll('.toast').forEach((x) => x.remove()));

const RED = '#d00000', BLUE = '#0000d0', GREEN = '#00a000';
const pageH = (color, lines) => `<section style="page-break-after:always;height:280mm;overflow:hidden"><div style="background:${color};height:35mm"></div><div style="font:15px 'DejaVu Sans',sans-serif;direction:rtl;padding:8mm 12mm">${lines.map((l) => `<p style="margin:3mm 0">${l}</p>`).join('')}</div></section>`;
const DANA = (net) => pageH(RED, ['תלוש שכר לחודש אוקטובר 2026', 'שם העובד: דנה כהן', 'שכר בסיס 8,000.00', 'סה"כ ברוטו 9,250.50', 'ביטוח לאומי מעביד 420.75', 'פנסיה מעביד 601.28', 'פיצויים 555.03', 'נטו לתשלום ' + net]);
const YOSSI = pageH(BLUE, ['תלוש שכר לחודש אוקטובר 2026', 'מספר זהות 023456789', 'סה"כ ברוטו 6,000.00', 'ביטוח לאומי מעביד 250.00', 'נטו לתשלום 5,100.00']);
const NONAME = pageH(GREEN, ['דף הסבר כללי', 'אין כאן פרטי עובד']);

(async () => {
  const A = process.argv.slice(2), www = A[0], out = A.length > 2 ? A[1] : null, shots = A.length > 2 ? A[2] : A[1];
  const browser = await H.launch();
  const mkPdf = async (pages) => { const p = await browser.newPage(); await p.setContent(`<html dir="rtl"><body style="margin:0">${pages.join('')}</body></html>`); const b = await p.pdf({ format: 'A4', printBackground: true, margin: { top: 0, bottom: 0, left: 0, right: 0 } }); await p.close(); return b; };
  const PDF1 = await mkPdf([DANA('7,412.30')]), PDFC = await mkPdf([DANA('7,500.00'), YOSSI, NONAME]);

  // ===== מנהל =====
  { const cfg = { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: {} } }, admins: { '|m': 1 } };
    const x = await H.newPage(browser, www, cfg, [], 'm-psl'); const pg = x.page; await pg.setViewportSize({ width: 412, height: 900 });
    await H.login(pg, 'm@x.co'); if (await pg.$('[data-a=startBlank]')) { await pg.click('[data-a=startBlank]'); await sleep(300); }
    await sleep(1000); await closeD(pg);
    if (!(await pg.evaluate(() => !!window.PayPsl))) await pg.addScriptTag({ path: path.join(www, 'payroll-psl.js') });
    check('0 PayPsl נטען', await pg.evaluate(() => typeof PayPsl === 'object' && typeof PayPsl.parseSlip === 'function' && typeof V.pslList === 'function'));
    await pg.evaluate(() => { const emp = S.cats.find((c) => c.kind === 'exp' && !c.hid && c.beh === 'emp');
      S.subs.push({ id: 'psA', cat: emp.id, name: 'דנה כהן', pay: { mode: 'mo', mo: 9000, m: 'העברה', slip: true, rules: [], add: [] } });
      S.subs.push({ id: 'psB', cat: emp.id, name: 'יוסי לוי', pay: { mode: 'mo', mo: 6000, m: 'העברה', slip: true, tz: '23456789', rules: [], add: [] } });
      S.subs.push({ id: 'psC', cat: emp.id, name: 'רון אבן', pay: { mode: 'hr', rate: 40, m: 'מזומן', slip: true, rules: [], add: [] } });
      S.tx.push({ id: 'psPay1', t: 'exp', cat: emp.id, sub: 'psA', date: '2026-10-31', amt: 3000, plan: '2026-10', pays: [{ id: 'pp1', d: '2026-10-31', a: 3000, m: 'העברה' }] });
      window.__log = []; ['log', 'info', 'warn', 'error', 'debug'].forEach((k) => { const o = console[k]; console[k] = (...a) => { try { window.__log.push(a.map(String).join(' ')); } catch (e) { /* */ } return o.apply(console, a); }; });
      save(); window.__w = []; window.__s = [];
      window.Capacitor = { isNativePlatform: () => true, Plugins: { Filesystem: { writeFile: async (o) => { window.__w.push({ path: o.path, n: o.data.length, head: atob(o.data.slice(0, 12)) }); return { uri: 'file:///cache/' + o.path }; } }, Share: { share: async (o) => { window.__s.push(o); } } } }; });
    const waitOk = async (n) => { for (let i = 0; i < 120; i++) { const t = await pg.evaluate(() => { const f = document.getElementById('dlg').open && document.querySelector('#dlg form[data-f=pslOkF]'); return f ? document.querySelector('#dlg h3').innerText : ''; }); if (t && (!n || t.includes(n))) return t; await sleep(200); } return ''; };
    const vals = () => pg.evaluate(() => { const f = document.querySelector('#dlg form[data-f=pslOkF]'); const o = {}; ['sub', 'mon', 'gross', 'net', 'ec_bl', 'ec_pen', 'ec_sev', 'ec_kh', 'ec_mt'].forEach((k) => { o[k] = f.elements[k].value; }); o.notes = [...document.querySelectorAll('#dlg .note')].map((e) => e.innerText).join(' | '); o.img = !!document.querySelector('#dlg img[src^="data:image/jpeg"]'); return o; });
    const setF = (o) => pg.evaluate((o) => { const f = document.querySelector('#dlg form[data-f=pslOkF]'); Object.keys(o).forEach((k) => { f.elements[k].value = o[k]; }); }, o);
    const submit = () => pg.click('#dlg form[data-f=pslOkF] button[type=submit]');
    const psl = () => pg.evaluate(() => JSON.parse(JSON.stringify(S.psl)));
    const ecs = (sub) => pg.evaluate((s) => S.tx.filter((t) => t.ec && (!s || t.sub === s)).map((t) => ({ id: t.id, sub: t.sub, amt: t.amt, plan: t.plan, psl: t.psl, eck: t.eck, pays: t.pays, date: t.date })), sub);
    const pagesOf = (fid) => pg.evaluate(async (fid) => { const du = await fget(fid); if (typeof du !== 'string') return null; const L = await pdfLoad(); const d = await L.getDocument({ data: new Uint8Array(await du2b(du).arrayBuffer()) }).promise; const o = [];
      for (let i = 1; i <= d.numPages; i++) { const p = await d.getPage(i), v = p.getViewport({ scale: 0.3 }), c = document.createElement('canvas'); c.width = Math.ceil(v.width); c.height = Math.ceil(v.height); await p.render({ canvasContext: c.getContext('2d'), viewport: v }).promise;
        const [r, g, b] = c.getContext('2d').getImageData(Math.floor(c.width / 2), 8, 1, 1).data; o.push(r > 150 && g < 90 && b < 90 ? 'red' : b > 150 && r < 90 && g < 90 ? 'blue' : g > 110 && r < 90 && b < 90 ? 'green' : 'other:' + [r, g, b]); }
      return { n: d.numPages, col: o, size: Math.floor(du.length * 3 / 4) }; }, fid);

    // 1. כרטיס העובד ומסך התלושים
    await pg.evaluate(() => go('card', 'psA')); await sleep(300);
    check('1 כרטיס עובד בתלוש: שורת "תלושים"', await pg.evaluate(() => !!document.querySelector('#main [data-a=pslOpen][data-id=psA]')));
    await pg.click('#main [data-a=pslOpen]'); await sleep(300);
    check('1א מסך תלושים: העלאה (PDF/תמונה) + קובץ מרוכז', await pg.evaluate(() => !!document.querySelector('#main input[data-c=pslFile][data-m=one][data-sub=psA]') && !!document.querySelector('#main input[data-c=pslFile][data-m=all]')));

    // 2. PDF של עובדת אחת: קריאה נכונה
    await pg.setInputFiles('#main input[data-c=pslFile][data-m=one]', { name: 'dana.pdf', mimeType: 'application/pdf', buffer: PDF1 });
    check('2 חלון אישור נפתח', !!(await waitOk()));
    let v = await vals();
    check('2א נקרא: עובדת, חודש, ברוטו, נטו, ב"ל/פנסיה/פיצויים מעביד; מה שלא קיים – ריק', v.sub === 'psA' && v.mon === '2026-10' && +v.gross === 9250.5 && +v.net === 7412.3 && +v.ec_bl === 420.75 && +v.ec_pen === 601.28 && +v.ec_sev === 555.03 && v.ec_kh === '' && v.ec_mt === '', v);
    check('2ב תצוגת העמוד בחלון', v.img, v);
    if (shots) { fs.mkdirSync(shots, { recursive: true }); await sleep(300); await pg.screenshot({ path: path.join(shots, 'psl-חלון-אישור.png'), fullPage: false }); }
    await setF({ ec_kh: '100' }); await submit(); await sleep(600);
    let P = await psl(); let E = await ecs('psA');
    const p1 = P.find((p) => p.sub === 'psA');
    check('2ג נשמר תלוש (ok:1) עם קובץ ps…', P.length === 1 && p1 && p1.ok === 1 && /^ps/.test(p1.f) && p1.net === 7412.3 && p1.gross === 9250.5 && p1.mon === '2026-10' && p1.src === 'pdf', P);
    check('2ד 4 רשומות ec (כולל קרן השתלמות שנערכה ידנית) עם pays:[] ותאריך סוף החודש', E.length === 4 && E.every((t) => t.psl === p1.id && t.plan === '2026-10' && Array.isArray(t.pays) && !t.pays.length && t.date === '2026-10-31') && E.map((t) => t.amt).sort((a, b) => a - b).join() === '100,420.75,555.03,601.28', E);
    const pg1 = await pagesOf(p1.f);
    check('2ה הקובץ המקורי (PDF, עמוד אחד, עד 3MB)', pg1 && pg1.n === 1 && pg1.col[0] === 'red' && pg1.size <= 3 * 1048576, pg1);
    check('2ו הקובץ ב-bkFileIds (נכנס לגיבוי)', await pg.evaluate((f) => bkFileIds().includes(f), p1.f));
    const ms = await pg.evaluate(() => { const s = S.subs.find((x) => x.id === 'psA'); const r = PayCore.monthSum(s, '2026-10', { wh: S.wh, bon: S.bon, psl: S.psl, tx: S.tx.filter((t) => (cat(t.cat) || {}).beh === 'emp'), pmon }); return { due: r.due, paid: r.paid, left: r.left }; });
    check('2ז "שולם לעובד" לא כולל ec: לתשלום = נטו 7412.30, שולם 3000', ms.due === 741230 && ms.paid === 300000 && ms.left === 441230, ms);
    check('2ח ec נספרות כהוצאה (live, בלי x)', await pg.evaluate(() => live().filter((t) => t.ec && t.sub === 'psA').reduce((a, t) => a + t.amt, 0)) === 1677.06);
    check('2ט ec לא נכנסות למראה לעובדים (wv)', await pg.evaluate(() => { const o = wvWant(); return !Object.values(o).some((j) => /420\.75|601\.28|555\.03/.test(j)) && S.tx.some((t) => t.ec); }));

    // 3. שיוך חיוב אשראי לעלויות מעביד
    const cc = await pg.evaluate(() => { const c = S.cats.find((k) => k.beh === 'cc'); const h = detHtml(c, null); return { id: c.id, all: h.includes('value="ec:2026-10:*"'), bl: h.includes('value="ec:2026-10:bl"'), inv: h.includes('name="link"') }; });
    check('3 טופס חיוב אשראי חדש: קבוצות עלויות מעביד בבחירת השיוך', cc.all && cc.bl && cc.inv, cc);
    const big = await pg.evaluate((cid) => { const r = readTx({ amt: '999', date: '2026-11-10', link: 'ec:2026-10:bl', note: '' }, cat(cid), null, null); return r.errs || null; }, cc.id);
    check('3א חיוב גדול מסכום עלויות המעביד שנבחרו ← נחסם', big && /גדול מסכום/.test(big[0]), big);
    const lk = await pg.evaluate((cid) => { const r = readTx({ amt: '420.75', date: '2026-11-10', link: 'ec:2026-10:bl', note: '' }, cat(cid), null, null); if (r.errs) return r; r.t.id = 'ccL1'; S.tx.push(r.t); save(); return { x: r.t.x, ecl: r.t.ecl }; }, cc.id);
    check('3ב חיוב משויך: x=1 (לא נספר פעמיים) + ecl', lk.x === 1 && Array.isArray(lk.ecl) && lk.ecl.length === 1, lk);
    check('3ג אחרי השיוך הקבוצה לא מוצעת שוב; חיוב רגיל בלי שיוך – לא נגוע', await pg.evaluate((cid) => { const h = detHtml(cat(cid), null); const r = readTx({ amt: '50', date: '2026-11-10', link: '', note: '' }, cat(cid), null, null); return !h.includes('value="ec:2026-10:bl"') && !r.errs && !r.t.x && !r.t.ecl; }, cc.id));

    // 4. מחיקה חסומה כשמשויך
    await pg.evaluate(() => rerender()); await sleep(200); await clearT(pg);
    await pg.click(`#main [data-a=pslDel][data-id="${p1.id}"]`); await sleep(250);
    check('4 מחיקת תלוש משויך ← חסימה עם הודעה, כלום לא נמחק', /שויכו לחיוב/.test(await toasts(pg)) && (await psl()).length === 1 && (await ecs('psA')).length === 4, await toasts(pg));

    // 5. קובץ מרוכז: פיצול לפי עמוד, בלי לערבב עובדים
    await clearT(pg);
    await pg.setInputFiles('#main input[data-c=pslFile][data-m=all]', { name: 'all.pdf', mimeType: 'application/pdf', buffer: PDFC });
    let t = await waitOk('1 מתוך 3'); v = await vals();
    check('5 3 עמודים ← 3 חלונות; הראשון דנה (שם), אוקטובר, נטו 7500', !!t && v.sub === 'psA' && v.mon === '2026-10' && +v.net === 7500 && +v.ec_bl === 420.75, [t, v]);
    check('5א מודיע שהתלוש הקיים יוחלף', /יוחלף/.test(v.notes), v.notes);
    await submit(); await sleep(500);
    check('5ב החלפה כשהתלוש הקודם משויך ← חסימה, נשאר באותו חלון', /שויכו לחיוב/.test(await toasts(pg)) && !!(await waitOk('1 מתוך 3')) && (await psl()).length === 1, await toasts(pg));
    await pg.evaluate(() => { S.tx = S.tx.filter((t) => t.id !== 'ccL1'); save(); }); // ביטול השיוך (מחיקת החיוב)
    await clearT(pg); await submit();
    t = await waitOk('2 מתוך 3'); v = await vals();
    P = await psl(); E = await ecs('psA'); const p2 = P.find((p) => p.sub === 'psA');
    check('5ג אחרי ביטול השיוך: התלוש הוחלף (אחד לחודש), ec הישנות נמחקו והחדשות נוצרו', P.filter((p) => p.sub === 'psA').length === 1 && p2.id !== p1.id && p2.net === 7500 && E.length === 3 && E.every((e) => e.psl === p2.id), [P, E]);
    check('5ד הקובץ הישן נמחק מהמכשיר ומ-bkFileIds', await pg.evaluate(async (f) => { await new Promise((r) => setTimeout(r, 200)); return (await fget(f)) === undefined && !bkFileIds().includes(f); }, p1.f));
    const pg2 = await pagesOf(p2.f);
    check('5ה הקובץ של דנה: עמוד אחד, רק העמוד שלה (אדום)', pg2 && pg2.n === 1 && pg2.col.join() === 'red', pg2);
    check('5ו חלון 2: יוסי לפי ת"ז, נטו 5100, ב"ל 250', !!t && v.sub === 'psB' && v.mon === '2026-10' && +v.net === 5100 && +v.gross === 6000 && +v.ec_bl === 250, [t, v]);
    await submit();
    t = await waitOk('3 מתוך 3'); v = await vals();
    const pB = (await psl()).find((p) => p.sub === 'psB'), pgB = await pagesOf(pB.f);
    check('5ז הקובץ של יוסי: עמוד אחד, רק שלו (כחול)', pgB && pgB.n === 1 && pgB.col.join() === 'blue', pgB);
    check('5ח עמוד בלי שם: לא משויך, שדות ריקים, הסבר לשיוך ידני', v.sub === '' && v.net === '' && v.gross === '' && /לא זוהה עובד/.test(v.notes), v);
    await clearT(pg); await submit(); await sleep(250);
    check('5ט בלי בחירת עובד ← לא נשמר', /בחרו עובד/.test(await toasts(pg)) && (await psl()).length === 2);
    await setF({ sub: 'psC', net: '3000', gross: '3500', ec_mt: '80' }); await submit(); await sleep(600);
    P = await psl(); const pC = P.find((p) => p.sub === 'psC'), pgC = await pagesOf(pC.f);
    check('5י שיוך ידני: נשמר לרון, עמוד אחד (ירוק), ec מס מעסיקים 80', P.length === 3 && pC.net === 3000 && pgC.n === 1 && pgC.col.join() === 'green' && (await ecs('psC')).map((e) => e.amt + e.eck).join() === '80mt', [pC, pgC]);
    check('5כ אף עובד לא קיבל עמוד של עובד אחר', [pg2, pgB, pgC].every((q) => q.n === 1) && new Set([pg2.col[0], pgB.col[0], pgC.col[0]]).size === 3);
    check('5ל החלון נסגר בסוף התור', await pg.evaluate(() => !document.querySelector('#dlg form[data-f=pslOkF]') || !document.getElementById('dlg').open));

    // 6. תמונה: הזנה ידנית עם תצוגה; גם דילוג/כשל
    const png = await pg.evaluate(() => { const c = document.createElement('canvas'); c.width = 600; c.height = 800; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 600, 800); x.fillStyle = '#000'; x.font = '30px sans-serif'; x.fillText('Payslip 09/2026', 50, 100); return c.toDataURL('image/png').split(',')[1]; });
    await pg.evaluate(() => go('pslList', 'psB')); await sleep(250);
    await pg.setInputFiles('#main input[data-c=pslFile][data-m=one]', { name: 'b.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await waitOk(); v = await vals();
    check('6 תמונה: חלון ידני עם תצוגת התמונה, כל השדות ריקים, עובד = הכרטיס', v.img && v.sub === 'psB' && v.net === '' && v.gross === '' && v.ec_bl === '' && /תמונה/.test(v.notes), v);
    await clearT(pg); await submit(); await sleep(200);
    check('6א בלי נטו ← לא נשמר (נטו חובה)', /נטו/.test(await toasts(pg)) && (await psl()).length === 3);
    await setF({ mon: '2026-09', gross: '5000', net: '6000' }); await clearT(pg); await submit(); await sleep(200);
    check('6ב נטו גדול מברוטו ← לא נשמר', /גדול מהברוטו/.test(await toasts(pg)) && (await psl()).length === 3);
    await setF({ net: '4000', ec_bl: '100' }); await submit(); await sleep(500);
    P = await psl(); const pI = P.find((p) => p.sub === 'psB' && p.mon === '2026-09');
    check('6ג תמונה נשמרה (jpeg, עד 3MB) עם ec', pI && pI.src === 'img' && await pg.evaluate(async (f) => { const d = await fget(f); return /^data:image\/jpeg;base64,/.test(d) && d.length * 3 / 4 <= 3 * 1048576; }, pI.f) && (await ecs('psB')).length === 2, pI);
    // PDF בלי שום טקסט שמזוהה ← ידני
    await pg.setInputFiles('#main input[data-c=pslFile][data-m=one]', { name: 'x.pdf', mimeType: 'application/pdf', buffer: await mkPdf([pageH(BLUE, ['מסמך בלי נתונים'])]) });
    await waitOk(); v = await vals();
    check('6ד PDF שהקריאה בו נכשלה ← שדות ריקים והזנה ידנית', v.sub === 'psB' && v.net === '' && v.gross === '' && /הזינו ידנית/.test(v.notes), v);
    await pg.click('#dlg [data-a=pslCancel]'); await sleep(250);
    check('6ה ביטול – לא נשמר כלום', (await psl()).length === 4);

    // 7. מסך התלושים: רשימה לפי חודש, צפייה, שיתוף 1 / נבחרים / הכול
    await pg.evaluate(() => rerender()); await sleep(250);
    check('7 רשימה לפי חודש (אוקטובר לפני ספטמבר)', await pg.evaluate(() => [...document.querySelectorAll('#main [data-psl]')].map((e) => e.querySelector('b').innerText).join('|')) === 'אוקטובר 2026|ספטמבר 2026');
    const share = async (fn) => { await pg.evaluate(() => { window.__w = []; window.__s = []; }); await fn(); await sleep(500); return pg.evaluate(() => ({ w: window.__w.map((f) => f.path + ':' + f.head.slice(0, 4)), s: window.__s.map((s) => s.files.length) })); };
    let S1 = await share(() => pg.click(`#main [data-a=pslSh1][data-id="${pB.id}"]`));
    check('7א שיתוף תלוש אחד: קובץ PDF אחד, שיתוף אחד', S1.s.join() === '1' && S1.w.length === 1 && /^psl_Payslip_יוסי_לוי_2026-10\.pdf:%PDF$/.test(S1.w[0]), S1);
    check('7ב כפתור "נבחרים" כבוי עד בחירה', await pg.evaluate(() => document.querySelector('[data-a=pslShSel]').disabled));
    await pg.check(`#main input[data-c=pslSel][value="${pB.id}"]`); await pg.check(`#main input[data-c=pslSel][value="${pI.id}"]`);
    S1 = await share(() => pg.click('#main [data-a=pslShSel]'));
    check('7ג שיתוף 2 חודשים שנבחרו: 2 קבצים (PDF + JPG) בשיתוף אחד', S1.s.join() === '2' && S1.w.some((w) => /2026-09\.jpg:/.test(w)) && S1.w.some((w) => /2026-10\.pdf:/.test(w)), S1);
    S1 = await share(() => pg.click('#main [data-a=pslShAll]'));
    check('7ד שיתוף הכול', S1.s.join() === '2', S1);
    // מעל 24 ← בחלקים
    await pg.evaluate(async () => { const du = await fget(S.psl.find((p) => p.sub === 'psB' && p.mon === '2026-10').f); for (let i = 0; i < 25; i++) { const f = 'psT' + i; await fput(f, du); S.psl.push({ id: 'pT' + i, sub: 'psB', mon: '2024-' + String(1 + (i % 12)).padStart(2, '0') + (i >= 12 ? '' : ''), f, name: 'x', gross: null, net: 100, ec: [], src: 'pdf', ok: 1, at: '2026-01-01T00:00:' + String(i).padStart(2, '0') }); } save(); rerender(); });
    await sleep(250);
    S1 = await share(() => pg.click('#main [data-a=pslShAll]'));
    const partDlg = await pg.evaluate(() => (document.querySelector('#dlg [data-a=pslShPart]') || {}).innerText || '');
    check('7ה 27 תלושים ← דיאלוג חלקים (1 מתוך 2, 24 קבצים)', S1.s.length === 0 && /1 מתוך 2/.test(partDlg) && /24/.test(partDlg), [S1, partDlg]);
    S1 = await share(() => pg.click('#dlg [data-a=pslShPart]'));
    const S2 = await share(() => pg.click('#dlg [data-a=pslShPart]'));
    check('7ו חלק 1 = 24 קבצים, חלק 2 = 3', S1.s.join() === '24' && S2.s.join() === '3', [S1.s, S2.s]);
    await closeD(pg);
    await pg.evaluate(() => { S.psl = S.psl.filter((p) => !/^pT/.test(p.id)); save(); rerender(); });
    const vw = await pg.evaluate(() => { const o = window.viewImg; let got = null; window.viewImg = (f, n) => { got = [f, n]; }; viewImg = window.viewImg; document.querySelector('#main [data-a=pslView]').click(); viewImg = o; window.viewImg = o; return got; });
    check('7ז צפייה פותחת את הקובץ השמור', vw && /^ps/.test(vw[0]) && /Payslip_/.test(vw[1]), vw);

    // 8. מחיקה (לא משויך): התלוש, ה-ec והקובץ
    await clearT(pg);
    await pg.click(`#main [data-a=pslDel][data-id="${pI.id}"]`); await sleep(200); await pg.click('#dlg [data-a=yes]'); await sleep(400);
    check('8 מחיקה: התלוש וה-ec שלו נמחקו, הקובץ נמחק, תלוש אוקטובר נשאר', !(await psl()).some((p) => p.id === pI.id) && (await ecs('psB')).length === 1 && (await ecs('psB'))[0].psl === pB.id && await pg.evaluate(async (f) => { await new Promise((r) => setTimeout(r, 200)); return (await fget(f)) === undefined && !bkFileIds().includes(f); }, pI.f));

    // 9. שחזור מגיבוי: הקבצים בגיבוי וחוזרים
    const bk = await pg.evaluate(async () => { const c = await bkCollect(null, false); return { ids: Object.keys(c.files).filter((k) => /^ps/.test(k)), psl: c.data.psl.map((p) => p.f) }; });
    check('9 bkCollect כולל את קובצי כל התלושים', bk.psl.length === 3 && bk.psl.every((f) => bk.ids.includes(f)), bk);
    // מסך שכר חודשי של עובד בתלוש – שורת התלוש
    await pg.evaluate(() => { go('payMon', 'psA'); }); await sleep(250);
    await pg.evaluate(() => { const i = document.querySelector('#main input[data-c=payMonM]'); i.value = '2026-10'; i.dispatchEvent(new Event('change', { bubbles: true })); }); await sleep(250);
    check('9א "שכר חודשי": שורת תלוש לחודש עם הנטו', await pg.evaluate(() => { const b = document.querySelector('#main [data-a=pslOpen]'); return !!b && /7,500|7500/.test(b.innerText); }));
    // ת"ז במסך התלושים
    await pg.evaluate(() => go('pslList', 'psC')); await sleep(200);
    await pg.fill('#main form[data-f=pslTzF] input[name=tz]', '12-34'); await clearT(pg); await pg.click('#main form[data-f=pslTzF] button'); await sleep(150);
    check('9ב ת"ז לא תקינה ← לא נשמרת', /5–9/.test(await toasts(pg)) && await pg.evaluate(() => !S.subs.find((s) => s.id === 'psC').pay.tz));
    await pg.fill('#main form[data-f=pslTzF] input[name=tz]', '123456782'); await pg.click('#main form[data-f=pslTzF] button'); await sleep(150);
    check('9ג ת"ז נשמרת ב-pay.tz בלי לגעת בשאר ההגדרות', await pg.evaluate(() => { const p = S.subs.find((s) => s.id === 'psC').pay; return p.tz === '123456782' && p.rate === 40 && p.slip === true; }));
    const lg = await pg.evaluate(() => window.__log.filter((l) => /7,?412|9,?250|420\.75|601\.28|5,?100|023456789/.test(l)));
    check('9ד אין נתוני תלוש ביומן (console)', lg.length === 0, lg);
    check('10 אין שגיאות JS', pg.__errors.length === 0, pg.__errors);
    await x.ctx.close(); }

  // ===== עובד: לא רואה כלום =====
  { const cfg = { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: {} } }, staff: { '|w1': 1 } };
    const x = await H.newPage(browser, www, cfg, [], 'w-psl'); const pg = x.page; await pg.setViewportSize({ width: 412, height: 900 });
    await H.login(pg, 'w1@x.co'); await sleep(800); await closeD(pg);
    const r = await pg.evaluate(() => ({ w: isW(), row: window.pslRowH({ id: 'x', name: 'x', pay: { slip: true } }), mon: window.pslMonH({ id: 'x', pay: { slip: true } }, '2026-10'), v: V.pslList('x').h }));
    check('11 עובד: אין שורת תלושים, ומסך התלושים חסום', r.w && r.row === '' && r.mon === '' && /למנהל בלבד/.test(r.v), r);
    check('11א אין שגיאות JS', pg.__errors.length === 0, pg.__errors);
    await x.ctx.close(); }

  await browser.close();
  if (out) { try { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify({ fail, R }, null, 1)); } catch (e) { /* */ } }
  console.log(fail ? `נכשלו ${fail} בדיקות` : 'כל הבדיקות עברו');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
