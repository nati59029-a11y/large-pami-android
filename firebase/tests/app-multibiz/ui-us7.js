'use strict';
// סריקה אחידה, שלב 7 (+ "מי הכניס", תצוגת PDF, מסך מכסה למנהל־על): בדיקת דפדפן ברוחב 360px, רשת מדומה (בלי אמולטור).
// מנהל ועובד מחוברים, ערכות "לוגו" וכהה-זהב ("מאפייה כהה"). pdf.js נטען מהקובץ המקומי (www/pdfjs).
// שימוש: NODE_PATH=/opt/npm-tools/node_modules node ui-us7.js <www-dir> [shots-dir]
const fs = require('fs'); const path = require('path'); const H = require('./harness');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const BZ0 = ['larg', 'peami'].join('');
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
let fail = 0; const check = (n, ok, info) => { if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 300) : '')); };
const mkImg = (page, w, h, label) => page.evaluate(([w, h, label]) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.fillStyle = '#222'; x.font = 'bold 60px sans-serif'; x.fillText(label, 40, 120); x.strokeRect(20, 20, w - 40, h - 40); return c.toDataURL('image/png'); }, [w, h, label]);
async function mkPdf(pages) { const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica); for (let i = 1; i <= pages; i++) { const p = d.addPage([400, 560]); p.drawText('PDF PAGE ' + i, { x: 40, y: 480, size: 36, font: f, color: rgb(0, 0, 0) }); p.drawRectangle({ x: 30, y: 30, width: 340, height: 500, borderWidth: 2, borderColor: rgb(0, 0, 0) }); } return Buffer.from(await d.save()); }
const rect = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height), y: Math.round(r.y) }; }, sel);
const dl = async (page, fn) => { const p = page.waitForEvent('download', { timeout: 8000 }).catch(() => null); await fn(); const d = await p; return d ? d.suggestedFilename() : null; };

(async () => {
  const [www, shots] = process.argv.slice(2); if (shots) fs.mkdirSync(shots, { recursive: true });
  const pdf3 = await mkPdf(3), pdf1 = await mkPdf(1);
  const browser = await H.launch();
  const cfg = { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: ALL } }, admins: { '|m': 1 }, staff: { '|w': 1 } };
  const THEMES = [['logo', 'logo'], ['kahe-zahav', 'baked']];
  for (const [tn, tv] of THEMES) {
    const { ctx, page } = await H.newPage(browser, www, cfg, [], 'm'); await page.setViewportSize({ width: 360, height: 740 }); await H.login(page, 'm@x.co');
    await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden) ACT.startBlank(); }); await H.settle(page, 500);
    await page.evaluate((v) => { S.theme = v; render(0); }, tv);
    const shot = async (n) => { if (shots) await page.screenshot({ path: path.join(shots, tn + '-' + n + '.png') }); };
    const T = tn + ' ';
    const img = await mkImg(page, 600, 800, 'DOC IMG');
    const pdfDU = 'data:application/pdf;base64,' + pdf3.toString('base64');
    // ---- נתונים: חשבונית עם תמונה, עם PDF, בלי קובץ, הכנסה עם קובץ (בלי eu), הוצאה מקופה שאושרה מעובד, חשבונית עם תשלום בהעברה ----
    await page.evaluate(async ([img, pdfDU]) => {
      for (const id of ['fImg', 'fPdf', 'fInc', 'fCo', 'fPay']) await fput(id, id === 'fPdf' ? pdfDU : img);
      S.subs.push({ id: 's1', cat: 'e_sup', name: 'ספק בדיקה' });
      const inc = S.cats.find((c) => c.kind === 'inc'), d = today(), ex = (id, o) => Object.assign({ id, t: 'exp', cat: 'e_sup', sub: 's1', date: d, amt: 100, plan: d.slice(0, 7), inv: 'N' + id, note: '', desc: '', kind: 'inv', pays: [] }, o);
      S.tx.push(ex('t1', { file: 'fImg', eu: SY.uid }), ex('t2', { file: 'fPdf', eu: SY.uid, inv: 'PDF1' }), ex('t3', { inv: 'NOFILE', eu: SY.uid }),
        { id: 't4', t: 'inc', cat: inc.id, sub: '', date: d, amt: 55, note: 'מכירה', desc: 'מכירה', kind: 'inv', pays: [], file: 'fInc', eu: '' },
        ex('t5', { file: 'fCo', eu: 'w1', note: 'הוכנס על ידי דנה · קניתי חלב', inv: 'DANA' }),
        ex('t6', { date: '2020-01-05', plan: '2020-01', inv: 'PAYT', amt: 200, pays: [{ id: 'p1', d: '2020-01-06', a: 200, m: 'העברה', grp: 'g1', ref: 'R1', file: 'fPay' }], tgrp: undefined }));
      save(); NAV = [{ v: 'home' }]; render(0);
    }, [img, pdfDU]);
    await H.settle(page, 600);
    // 1. שורות הרשימה: סימן קובץ (צפייה+שיתוף) רק בשורות עם קובץ; מי הכניס
    const t1 = await page.evaluate(() => [...document.querySelectorAll('#main [data-a=tx]')].map((b) => { const lw = b.closest('.lw'); return { id: b.dataset.id, inv: b.textContent, fa: lw ? lw.querySelectorAll('.dxa button').length : 0, who: (b.querySelector('.who') || {}).textContent || '' }; }));
    const by = (k) => t1.find((r) => r.id === k) || {};
    check(T + '1 שורות עם קובץ (תמונה, PDF, הכנסה, הוצאה מקופה): צפייה ושיתוף', t1.filter((r) => r.fa === 2).length >= 4, t1);
    check(T + '1א שורה בלי קובץ: בלי כפתור וללא שגיאה', by('t3').fa === 0, t1.map((r) => r.fa));
    check(T + '1ב מי הכניס בשורה: המשתמש הנוכחי, ועובד לפי ההערה', /הוכנס על ידי m$/.test(by('t1').who) && /הוכנס על ידי דנה/.test(by('t5').who), t1.map((r) => r.who));
    check(T + '1ג רשומה ישנה בלי eu: בלי שורת "מי הכניס" ובלי שגיאה', by('t4').who === '' && page.__errors.length === 0, { who: by('t4').who, e: page.__errors });
    await shot('01-שורות-מסמך');
    // 2. צפייה בתמונה מהשורה, וחזרה
    const rowBtn = (inv, a) => `#main .lw:has([data-a=tx]):has(:text("${inv}")) [data-a=${a}]`;
    await page.click(`#main .lw:has([data-id=t1]) [data-a=dxView]`); await H.settle(page, 500);
    const v2 = await page.evaluate(() => ({ v: !!document.querySelector('#viewer img'), src: (document.querySelector('#viewer img') || {}).src || '' }));
    check(T + '2 צפייה בתמונה מהשורה', v2.v && /^data:image\//.test(v2.src), { v: v2.v });
    await page.click('#viewer [data-a=vwClose]'); await H.settle(page, 200);
    // 3. שיתוף מהשורה (בדפדפן: הורדה של JPG)
    const f3 = await dl(page, () => page.click(`#main .lw:has([data-id=t1]) [data-a=dxShare]`));
    check(T + '3 שיתוף מהשורה: קובץ JPG', /\.jpg$/.test(f3 || ''), f3);
    // 4. PDF: תצוגה באפליקציה (pdf.js) – עמודים, גלילה, הגדלה
    await page.click(`#main .lw:has([data-id=t2]) [data-a=dxView]`); await page.waitForSelector('#viewer .pdfs canvas', { timeout: 15000 }); await H.settle(page, 600);
    const p4 = await page.evaluate(() => { const c = document.querySelector('#viewer .pdfs canvas'), x = c.getContext('2d'), d = x.getImageData(0, 0, c.width, c.height).data; let dark = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 100) dark++; return { w: c.width, h: c.height, dark, boxes: document.querySelectorAll('#viewer .pdfp').length, lbl: document.getElementById('pdfpg').textContent, z: document.getElementById('pdfz').textContent, boxW: Math.round(document.querySelector('#viewer .pdfp').getBoundingClientRect().width), noOpen: true }; });
    check(T + '4 PDF נפתח באפליקציה: עמוד מצויר עם תוכן, 3 עמודים, מונה עמודים', p4.dark > 200 && p4.boxes === 3 && /עמוד 1 מתוך 3/.test(p4.lbl), p4); await shot('02-תצוגת-PDF');
    await page.click('#viewer [data-a=pdfZoom][data-d="1"]'); await page.click('#viewer [data-a=pdfZoom][data-d="1"]'); await H.settle(page, 700);
    const p4b = await page.evaluate(() => ({ z: document.getElementById('pdfz').textContent, boxW: Math.round(document.querySelector('#viewer .pdfp').getBoundingClientRect().width), scrollW: document.getElementById('pdfs').scrollWidth, cw: document.getElementById('pdfs').clientWidth }));
    check(T + '4א הגדלה: הרוחב גדל והמסמך ניתן לגלילה', p4b.z === '156%' && p4b.boxW > p4.boxW * 1.4, { p4b, b0: p4.boxW });
    await page.evaluate(() => { const s = document.getElementById('pdfs'); s.scrollTop = s.scrollHeight; }); await H.settle(page, 900);
    const p4c = await page.evaluate(() => ({ lbl: document.getElementById('pdfpg').textContent, c3: !!document.querySelectorAll('#viewer .pdfp')[2].querySelector('canvas') }));
    check(T + '4ב גלילה לעמוד האחרון: מצויר ומונה מתעדכן', /עמוד 3 מתוך 3/.test(p4c.lbl) && p4c.c3, p4c);
    const f4 = await dl(page, () => page.click('#viewer [data-a=vwShare]')); check(T + '4ג שיתוף מתצוגת ה-PDF: קובץ PDF', /\.pdf$/.test(f4 || ''), f4);
    await page.click('#viewer [data-a=vwClose]'); await H.settle(page, 200);
    check(T + '4ד סגירה מנקה את התצוגה', await page.evaluate(() => !document.getElementById('viewer')));
    const f4b = await dl(page, () => page.click(`#main .lw:has([data-id=t2]) [data-a=dxShare]`)); check(T + '4ה שיתוף PDF ישירות מהשורה', /\.pdf$/.test(f4b || ''), f4b);
    // 5. פרטי הרשומה: מי הכניס (גם "לא ידוע"), ותשלום בהעברה עם אסמכתא
    await page.click(`#main [data-a=tx][data-id=t1]`); await H.settle(page, 300);
    const d5 = await page.evaluate(() => ({ who: (document.querySelector('#dlg .who') || {}).textContent || '', fileBtns: document.querySelectorAll('#dlg [data-a=fileView],#dlg [data-a=fileShare]').length }));
    check(T + '5 פרטי רשומה: "הוכנס על ידי"', /הוכנס על ידי: m/.test(d5.who) && d5.fileBtns === 2, d5); await shot('03-פרטי-רשומה');
    await page.click('#dlg [data-a=closeDlg]'); await H.settle(page, 200);
    await page.click(`#main [data-a=tx][data-id=t4]`); await H.settle(page, 300);
    check(T + '5א רשומה ישנה בלי eu: "לא ידוע"', await page.evaluate(() => /לא ידוע/.test((document.querySelector('#dlg .who') || {}).textContent || '')));
    await page.click('#dlg [data-a=closeDlg]'); await H.settle(page, 200);
    await page.evaluate(() => { NAV = [{ v: 'home' }]; go('ledger', 's1'); }); await H.settle(page, 400);
    await page.evaluate(() => { const b = document.querySelector('#main [data-a=tx][data-id=t6]'); if (b) b.click(); }); await H.settle(page, 300);
    const d5b = await page.evaluate(() => ({ pay: document.querySelectorAll('#dlg .dxa [data-a=dxView]').length, grp: !!document.querySelector('#dlg [data-a=grpFile]'), grpShare: !!document.querySelector('#dlg [data-a=dxShare][data-n=pay]') }));
    check(T + '5ב תשלום בהעברה: צפייה ושיתוף של האסמכתא (בשורת התשלום ובכרטיס ההעברה)', d5b.pay === 1 && d5b.grp && d5b.grpShare, d5b);
    const f5 = await dl(page, () => page.click('#dlg [data-a=dxShare][data-n=pay]')); check(T + '5ג שיתוף אסמכתא', /\.jpg$/.test(f5 || ''), f5);
    await page.click('#dlg [data-a=closeDlg]'); await H.settle(page, 200);
    // 6. סיכום סגירות קופה: סגירה (Z+פתיחה), הפקדה, פתק הוצאה מקופה – ענן מדומה
    await page.evaluate(async (img) => {
      const doc = (n, f) => ({ name: 'projects/x/databases/(default)/documents/' + n, fields: f }), sv = (v) => ({ stringValue: v }), iv = (v) => ({ integerValue: String(v) }), dv = (v) => ({ doubleValue: v });
      const m = NOWM(), d = m + '-05';
      window.__fs = [];
      window.fsx = async (p, o) => { window.__fs.push(p);
        const b = o && o.body ? JSON.parse(o.body) : null;
        if (p === ':runQuery') { const c = b.structuredQuery.from[0].collectionId;
          if (c === 'closings') return [{ document: doc('closings/z1', { uid: sv('w1'), by: sv('dana'), t: iv(Date.now()), st: sv('ok'), np: iv(1), reg: sv('i_yh'), d: sv(d), tm: sv('21:05'), no: sv('777'), data: sv('{"v":1,"f":{}}') }) }];
          if (c === 'cashout') return [{ document: doc('cashout/c1', { uid: sv('w1'), by: sv('dana'), t: iv(Date.now()), reg: sv('i_yh'), d: sv(d), a: dv(50), why: sv('חלב'), dep: sv('1'), src: sv('s1'), zc: sv('z1'), dp: sv('dp1') }) }];
          return []; }
        if (p === ':batchGet') return [{ found: doc('deposits/dp1', { uid: sv('w1'), by: sv('dana'), t: iv(Date.now()), d: sv(d), items: { arrayValue: { values: [sv('c1')] } }, a: dv(50), st: sv('ok'), why: sv(''), np: iv(1), data: sv('{"v":1,"rows":[]}') }) }];
        let mm = /^\/(closings|deposits)\/([A-Za-z0-9_-]+)\/p\/(\d+)/.exec(p); if (mm) return { name: 'x/' + mm[3], fields: { data: sv('PAGES:' + JSON.stringify([img, img])) } };
        return {}; };
      S.inbox = S.inbox || []; ZS.D = {}; ZS.open = ''; NAV = [{ v: 'home' }]; go('zs');
    }, img);
    await H.settle(page, 1200);
    const z6 = await page.evaluate(() => ({ via: document.querySelectorAll('#main .dxa [data-via=zsImg][data-k=z]').length, who: (document.querySelector('#main .card small.note') || {}).textContent || '' }));
    check(T + '6 סגירת קופה: צפייה ושיתוף של צילומי הסגירה מהשורה, ו"הוכנס על ידי"', z6.via === 2 && /הוכנס על ידי dana/.test(z6.who), z6);
    await shot('04-סגירות-קופה');
    await page.click('#main .dxa [data-a=dxView][data-via=zsImg]'); await H.settle(page, 600);
    const v6 = await page.evaluate(() => ({ imgs: document.querySelectorAll('#viewer img').length }));
    check(T + '6א צפייה בצילומי הסגירה מהשורה (2 עמודים)', v6.imgs === 2, v6); await page.click('#viewer [data-a=vwClose]');
    const f6 = await dl(page, () => page.click('#main .dxa [data-a=dxShare][data-via=zsImg]')); check(T + '6ב שיתוף צילומי הסגירה: PDF אחד', /\.pdf$/.test(f6 || ''), f6);
    await page.click('#main [data-a=zsOpen]'); await H.settle(page, 500);
    const o6 = await page.evaluate(() => ({ dep: document.querySelectorAll('#main [data-a=dxShare][data-via=zsImg][data-k=d]').length, depWho: /הוכנס על ידי dana/.test(document.querySelector('#main').innerText) }));
    check(T + '6ג הפקדה בפירוט הסגירה: שיתוף ו"הוכנס על ידי"', o6.dep === 1 && o6.depWho, o6);
    const f6c = await dl(page, () => page.click('#main [data-a=dxShare][data-via=zsImg][data-k=d]')); check(T + '6ד שיתוף צילומי ההפקדה', /\.pdf$/.test(f6c || ''), f6c);
    // 7. תיבת הוצאות מעובדים: צפייה ושיתוף + מי הכניס
    await page.evaluate(() => { S.inbox = [{ id: 'ib1', by: 'דנה', ow: 'w1', at: new Date().toISOString(), d: { cat: 'e_sup', catName: 'ספקים', sub: 's1', subName: 'ספק בדיקה', amt: '50', date: today(), inv: 'IB-1' }, file: 'fImg', np: 1 }]; NAV = [{ v: 'home' }]; go('inbox'); }); await H.settle(page, 400);
    const i7 = await page.evaluate(() => ({ v: !!document.querySelector('#main [data-a=inbView]'), s: !!document.querySelector('#main [data-a=dxShare][data-f=fImg]'), who: /הוכנס על ידי דנה/.test(document.querySelector('#main').innerText) }));
    check(T + '7 הוצאות מעובדים: צפייה ושיתוף ו"הוכנס על ידי"', i7.v && i7.s && i7.who, i7); await shot('05-הוצאות-מעובדים');
    const f7 = await dl(page, () => page.click('#main [data-a=dxShare][data-f=fImg]')); check(T + '7א שיתוף מהתיבה', /\.jpg$/.test(f7 || ''), f7);
    // 8. המסך האחיד: "הוכנס על ידי" בחלונית, ו-PDF מוצג בחלונית
    await page.evaluate(() => { S.inbox = []; usReset(); NAV = [{ v: 'home' }]; render(0); }); await H.settle(page, 300);
    await page.evaluate(() => { window.USCLS = async () => ({ kind: 'unknown' }); usOpen(); });
    await page.setInputFiles('#sheet input[accept="application/pdf"]', { name: 'doc.pdf', mimeType: 'application/pdf', buffer: pdf3 }); await page.waitForSelector('#uspane img#usimg', { timeout: 15000 }); await H.settle(page, 500);
    const u8 = await page.evaluate(() => ({ who: (document.querySelector('#uspane .usw') || {}).textContent || '', nw: document.getElementById('usimg').naturalWidth, nav: (document.querySelector('#uspane .uspn span') || {}).textContent || '', pane: Math.round(document.getElementById('uspane').getBoundingClientRect().width) }));
    check(T + '8 מסך אחיד: "הוכנס על ידי" בחלונית, PDF מוצג בחלונית (3 עמודים)', /הוכנס על ידי: m/.test(u8.who) && u8.nw > 100 && u8.nav === '1/3' && Math.abs(u8.pane - 180) <= 2, u8); await shot('06-מסך-אחיד-PDF');
    await page.click('#uspane [data-a=usPg][data-d="1"]'); await H.settle(page, 300);
    check(T + '8א מעבר לעמוד הבא של ה-PDF בחלונית', await page.evaluate(() => document.querySelector('#uspane .uspn span').textContent === '2/3'));
    await page.click('#uspane [data-a=usPdf]').catch(() => {}); await H.settle(page, 100);
    await page.evaluate(() => usReset());
    // 9. מסך מנהל־על: סוג מכסה (setScanQuota)
    await page.evaluate(() => {
      window.__calls = []; window.fnCall = async (name, data) => { if (/^sec/.test(name)) return { err: 1 }; /* כרטיס המזכירה (משימה 2026-11-10) קורא secAdminGet בכרטיס העסק – לא חלק מהבדיקה הזו */ window.__calls.push({ name, data }); if (data.mode === 'limit') return { ok: true, scanQuota: { period: data.period, n: data.n } }; if (data.mode === 'release') return { ok: true, scanQuota: { release: { until: data.for === 'forever' ? null : Date.now() + 86400000 } } }; return { ok: true, scanQuota: null }; };
      SY.sa = true; ADM.sa = 1; ADM.L = [{ id: 'acme', name: 'Acme', dataRoot: 'b', status: 'active', features: { scan: true }, missing: false }]; ADM.info.acme = { email: 'a@x.co', phone: '', adv: { limits: {} }, sq: null };
      NAV = [{ v: 'home' }]; go('sab', 'acme');
    }); await H.settle(page, 400);
    const s9 = await page.evaluate(() => ({ box: !!document.getElementById('sqbox'), now: (document.getElementById('sqnow') || {}).textContent || '', hint: (document.querySelector('input[name=scanDaily]') || {}).placeholder || '', forms: document.querySelectorAll('form[data-f=admSqL],form[data-f=admSqR]').length }));
    check(T + '9 כרטיס עסק: סוג מכסה (הגבלה/שחרור/ברירת מחדל) ומצב נוכחי, והטקסט "ברירת מחדל" עודכן', s9.box && s9.forms === 2 && /אין הגדרה/.test(s9.now) && /50/.test(s9.hint) && /20/.test(s9.hint), s9);
    await page.evaluate(() => document.getElementById('sqbox').scrollIntoView()); await shot('07-מנהל-על-מכסה');
    await page.selectOption('form[data-f=admSqL] select[name=period]', 'week'); await page.fill('form[data-f=admSqL] input[name=n]', '40'); await page.click('form[data-f=admSqL] button'); await H.settle(page, 300);
    await page.click('#dlg [data-a=yes]'); await H.settle(page, 500);
    const c9 = await page.evaluate(() => ({ calls: window.__calls, now: document.getElementById('sqnow').textContent }));
    check(T + '9א הגבלה שבועית: קריאה אחת ל-setScanQuota עם הערכים, והמצב מתעדכן', c9.calls.length === 1 && JSON.stringify(c9.calls[0]) === JSON.stringify({ name: 'setScanQuota', data: { bizId: 'acme', mode: 'limit', period: 'week', n: 40 } }) && /40 דפים/.test(c9.now), c9);
    await page.fill('form[data-f=admSqL] input[name=n]', '-3'); await page.click('form[data-f=admSqL] button'); await H.settle(page, 300);
    check(T + '9ב מספר לא תקין לא נשלח', await page.evaluate(() => window.__calls.length === 1 && !document.querySelector('#dlg[open] [data-a=yes]')));
    await page.selectOption('form[data-f=admSqR] select[name=for]', 'month'); await page.click('form[data-f=admSqR] button'); await H.settle(page, 300); await page.click('#dlg [data-a=yes]'); await H.settle(page, 500);
    const r9 = await page.evaluate(() => ({ last: window.__calls[window.__calls.length - 1], now: document.getElementById('sqnow').textContent }));
    check(T + '9ג שחרור לחודש', JSON.stringify(r9.last.data) === JSON.stringify({ bizId: 'acme', mode: 'release', for: 'month' }) && /שחרור עד/.test(r9.now), r9);
    await page.click('[data-a=admSqD]'); await H.settle(page, 300); await page.click('#dlg [data-a=yes]'); await H.settle(page, 500);
    const d9 = await page.evaluate(() => ({ last: window.__calls[window.__calls.length - 1], now: document.getElementById('sqnow').textContent, n: window.__calls.length }));
    check(T + '9ד חזרה לברירת מחדל', JSON.stringify(d9.last.data) === JSON.stringify({ bizId: 'acme', mode: 'default' }) && /אין הגדרה/.test(d9.now) && d9.n === 3, d9);
    check(T + '10 אין שגיאות JS (מנהל)', page.__errors.length === 0, page.__errors); await ctx.close();

    // עובד: שורות ההוצאות ששלח – צפייה ושיתוף מהקובץ שבמכשיר, ואין מסכי ניהול
    const w = await H.newPage(browser, www, cfg, [], 'w'); const wp = w.page; await wp.setViewportSize({ width: 360, height: 740 }); await H.login(wp, 'w@x.co');
    await wp.evaluate((v) => { const c = cfgLocal(); c.th = v; localStorage.setItem(CK, JSON.stringify(c)); render(0); }, tv);
    const wimg = await mkImg(wp, 600, 800, 'WORKER IMG');
    await wp.evaluate(async (img) => { await fput('owA', img); WKL = [{ id: 'wA', st: 'new', at: new Date().toISOString(), d: { amt: '30', date: today(), catName: 'ספקים', subName: 'ספק' } }, { id: 'wB', st: 'new', at: new Date(Date.now() - 1000).toISOString(), d: { amt: '12', date: today(), catName: 'ספקים', subName: 'ספק' } }]; WS = 'home'; render(0); }, wimg); await H.settle(wp, 700);
    const w20 = await wp.evaluate(() => ({ rows: [...document.querySelectorAll('#main .li')].filter((l) => /₪|30|12/.test(l.textContent) && l.querySelector('.m')).map((l) => ({ t: l.textContent.slice(0, 20), fa: l.querySelectorAll('.dxa button').length })) }));
    check(T + '20 עובד: שורה עם קובץ במכשיר – צפייה ושיתוף; שורה בלי קובץ – בלי כפתור', w20.rows.filter((r) => r.fa === 2).length === 1 && w20.rows.some((r) => r.fa === 0), w20);
    await wp.screenshot({ path: shots ? path.join(shots, tn + '-20-עובד-ההוצאות-ששלחתי.png') : undefined }).catch(() => {});
    await wp.click('#main .li .dxa [data-a=dxView]'); await H.settle(wp, 400);
    check(T + '20א עובד: צפייה בצילום ששלח', await wp.evaluate(() => !!document.querySelector('#viewer img')));
    await wp.click('#viewer [data-a=vwClose]');
    const wf = await dl(wp, () => wp.click('#main .li .dxa [data-a=dxShare]')); check(T + '20ב עובד: שיתוף הצילום ששלח', /\.jpg$/.test(wf || ''), wf);
    check(T + '21 עובד: אין כפתורי הכנסה/ניהול ואין שגיאות JS', wp.__errors.length === 0 && await wp.evaluate(() => !document.querySelector('[data-a=admSqD]')), wp.__errors); await w.ctx.close();
  }
  await browser.close(); console.log(fail ? 'נכשלו ' + fail : 'כל הבדיקות עברו'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
