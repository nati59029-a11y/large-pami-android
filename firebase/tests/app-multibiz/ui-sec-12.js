'use strict';
// המזכירה העסקית – קול, תמונה וסרטון בצ'אט (15.11.2026): כפתורים לפי הגבלות, הקלטה ותמלול, תמונה וכרטיסים (סריקה, Z, משימה),
// סרטון (בדיקת אורך, העלאה ל-sec_tmp, הקטנה), 🎤 בחלון "↩ תגובה", והגבלות בחלון מנהל־העל. רשת מדומה (בלי שרת).
// שימוש: node ui-sec-12.js <www-dir> [shots-dir]
const fs = require('fs');
const path = require('path');
const H = require('./harness');
let fail = 0;
const check = (name, ok, info) => { if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const BIZ = 'biz-o';
const FEAT = { scan: true, tasks: true, cashClose: true, suppliers: true, secretary: true };
const NT = { wd: 0, wh: 8, mh: 8, md: 0, dg: false, dh: 8, q: { on: true, f: '22:00', t: '07:00' }, reps: 3, rt: {} };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function open(browser, www, media, opt) {
  opt = opt || {};
  const who = 'm';
  const cfg = { mode: 'new', users: { [who]: BIZ }, sa: {}, biz: { [BIZ]: { dataRoot: 'b', features: FEAT, name: 'עסק בדיקה' } },
    admins: { [`b/${BIZ}/|${who}`]: 1 }, staff: { [`b/${BIZ}/|${who}`]: 1 }, ctx: { hasTouch: true, isMobile: true, viewport: { width: opt.w || 360, height: opt.h || 740 } } };
  const bodies = [], log = [];
  const st = { ok: true, consented: true, setupDone: true, name: 'רותי', addr: 'f', call: 'נתי', rows: [], mode: 'all', pay: true, emp: true, sens: false, we: 'warn', mirror: true, mirrorAt: null, cfTh: null, pct: 10, saving: '', nt: NT, types: {}, unseen: 0, learn: true };
  if (media !== undefined) st.media = media;
  const R = { see: null, stt: 'שלום, כמה הכנסות היום', admin: { bizId: BIZ, on: true, mode: 'all', mainUid: '', emp: false, empDefault: false, pay: { m: false }, sens: {}, capCents: 5000, rate: { hour: 40, day: 200 }, rateDefault: { hour: 40, day: 200 }, media: { aud: 120, img: true, vid: 60 }, mediaSet: false, admins: [{ uid: 'm', email: 'm@x.co' }], consent: {} } };
  const { ctx, page } = await H.newPage(browser, www, cfg, log, who);
  await ctx.route(/:9199\/.*/, async (route) => { log.push({ url: route.request().url(), method: route.request().method(), ct: route.request().headers()['content-type'], size: (route.request().postDataBuffer() || Buffer.alloc(0)).length, st: 1 }); return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); });
  await ctx.route(/:5001\/.*/, async (route) => {
    const n = new URL(route.request().url()).pathname.split('/').pop();
    let body = {}; try { body = JSON.parse(route.request().postData() || '{}').data || {}; } catch (e) { /* */ }
    bodies.push([n, body]);
    const ok = (r) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: r }) });
    if (n === 'secState') return ok(st);
    if (n === 'secChatLoad') return ok({ ok: true, msgs: [] });
    if (n === 'secNotes') return ok({ ok: true, notes: [], unseen: 0, types: {} });
    if (n === 'secWaCfg') return ok({ ok: true, connected: false, num: '', link: '', stop: { on: false }, ack: { on: false, text: '' }, open: { on: false, text: '' }, ackH: { f: '08:00', t: '18:00' }, hour: 30, myNum: '', myReq: '', tpls: [], appr: [] });
    if (n === 'secAdminGet') return ok(R.admin);
    if (n === 'secAdminSetCfg') { if (body.media) { R.admin.media = body.media; R.admin.mediaSet = true; } return ok(R.admin); }
    if (n === 'secMedia') {
      if (body.op === 'stt' && R.sttSave) return ok({ ok: true, text: '', mode: 'saving', reply: 'הגעתם לתקרת השימוש החודשית – המזכירה במצב חיסכון.', pct: 100 });
      if (body.op === 'stt') return R.sttErr ? route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { message: R.sttErr, details: { reason: 'media-off' } } }) }) : ok({ ok: true, text: R.stt });
      if (body.op === 'see') return ok(R.see || { ok: true, id: 'img1', reply: 'זו חשבונית.', cards: [], pct: 12, saving: false });
      if (body.op === 'mark') return R.markFail ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { message: 'x', status: 'INTERNAL' } }) }) : ok({ ok: true });
    }
    if (n === 'secChat') return ok({ ok: true, id: 'a1', reply: 'ענו: ' + body.text, mode: 'ok', src: [], cards: [], pct: 11, saving: false });
    return ok({});
  });
  await H.login(page, who + '@x.co');
  await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden && ACT.startBlank) ACT.startBlank(); });
  await H.settle(page, 800);
  await page.evaluate(() => { window.__toasts = []; const t0 = window.toast; window.toast = (t) => { window.__toasts.push(t); t0(t); }; });
  return { ctx, page, bodies, log, R };
}
const last = (bodies, n, f) => bodies.filter((b) => b[0] === n && (!f || f(b[1]))).pop();
const all = (bodies, n, f) => bodies.filter((b) => b[0] === n && (!f || f(b[1])));
const txt = (page, sel) => page.evaluate((s) => (document.querySelector(s || '#main') || {}).innerText || '', sel);
const sx = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const toasts = (page) => page.evaluate(() => window.__toasts.join(' | '));
const enter = async (page) => { await page.evaluate(() => go('sec')); await H.settle(page, 700); };
// מקליט מדומה: מיקרופון ו-MediaRecorder שמחזירים WAV אמיתי של שנייה (כדי שהפענוח והמרה ירוצו באמת)
const fakeMic = (page, deny, badStart) => page.evaluate(([d, bs]) => {
  const wav = () => { const n = 8000, b = new Uint8Array(44 + n * 2), v = new DataView(b.buffer); const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(Math.sin(i / 8) * 8000), true); return new Blob([b], { type: 'audio/wav' }); };
  window.__tracks = 0;
  navigator.mediaDevices.getUserMedia = async () => { if (d) { const e = new Error('x'); e.name = 'NotAllowedError'; throw e; } window.__tracks++; return { getTracks: () => [{ stop() { window.__tracks--; }, onended: null }] }; };
  window.MediaRecorder = class { constructor() { this.state = 'inactive'; this.mimeType = 'audio/wav'; } start() { if (bs) throw new Error('start'); this.state = 'recording'; } stop() { this.state = 'inactive'; setTimeout(() => { this.ondataavailable({ data: wav() }); this.onstop(); }, 20); } static isTypeSupported() { return true; } };
}, [!!deny, !!badStart]);

(async () => {
  const [www, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const browser = await H.launch();
  {
    // --- הכפתורים לפי הגבלות השרת ---
    let o = await open(browser, www, { aud: 3, img: true, vid: 30 });
    let page = o.page;
    await enter(page);
    const t = await txt(page, '#secChat') + await txt(page, '#secMedia');
    check('הגבלות מלאות: שלושת הכפתורים ושורת הפרטיות', !!(await page.$('#secMedia [data-a=secMic]')) && !!(await page.$('#secMedia [data-c=secImgF]')) && !!(await page.$('#secMedia [data-c=secVidF]')) && /הקובץ נשלח לעיבוד ב-AI ונמחק/.test(await txt(page)), t.slice(-200));
    check('360px: בלי גלישה לרוחב, וכפתורי המדיה בגובה 44px לפחות', (await sx(page)) <= 0 && (await page.evaluate(() => [...document.querySelectorAll('#secMedia .chip')].every((e) => e.getBoundingClientRect().height >= 43))), await sx(page));
    check('הקלדה בשדה הטקסט עדיין אפשרית ומתחת לכפתורים (השדה נראה במסך)', await page.evaluate(() => { const q = document.querySelector('#secForm textarea').getBoundingClientRect(), m = document.querySelector('#secMedia').getBoundingClientRect(); return q.width > 200 && m.top >= q.bottom - 1 && m.right <= window.innerWidth + 1 && m.left >= -1; }));
    if (shots) await page.screenshot({ path: path.join(shots, 'sec12-chat-360.png'), fullPage: true });
    // --- קול: הקלטה ← תמלול ← בועה עם 🎤 ← secChat עם via ---
    await fakeMic(page);
    await page.click('[data-a=secMic]'); await H.settle(page, 500);
    check('בזמן הקלטה: כפתור "עצור ושלח" וביטול, והשדות האחרים כבויים', /עצור ושלח/.test(await txt(page, '#secMedia')) && !!(await page.$('[data-a=secMicX]')) && await page.evaluate(() => document.querySelector('[data-c=secImgF]').disabled));
    await page.click('[data-a=secMic]'); await H.settle(page, 1500);
    const stt = last(o.bodies, 'secMedia', (b) => b.op === 'stt'), ch = last(o.bodies, 'secChat');
    check('תמלול: secMedia stt עם WAV (כותרת RIFF) מונו 16kHz', stt && stt[1].mime === 'audio/wav' && Buffer.from(stt[1].b64, 'base64').slice(0, 4).toString() === 'RIFF' && Buffer.from(stt[1].b64, 'base64').readUInt32LE(24) === 16000, stt && stt[1].b64.slice(0, 20));
    check('התמלול נשלח דרך secChat כרגיל עם via=voice', ch && ch[1].text === 'שלום, כמה הכנסות היום' && ch[1].via === 'voice', ch && ch[1]);
    const ct = await txt(page, '#secChat');
    check('בועת משתמש עם 🎤 והתשובה מוצגת; המיקרופון שוחרר', /🎤 שלום, כמה הכנסות היום/.test(ct) && /ענו: שלום/.test(ct) && (await page.evaluate(() => window.__tracks)) === 0, ct.slice(-120));
    // --- עצירה אוטומטית בגבול ---
    const n0 = all(o.bodies, 'secMedia', (b) => b.op === 'stt').length;
    await page.click('[data-a=secMic]'); await H.settle(page, 4200);
    check('עצירה אוטומטית אחרי 3 שניות (הגבלה), עם הודעה', all(o.bodies, 'secMedia', (b) => b.op === 'stt').length === n0 + 1 && /נעצרה בגבול של 3 שניות/.test(await toasts(page)), await toasts(page));
    // --- ביטול הקלטה ---
    await page.click('[data-a=secMic]'); await H.settle(page, 400); await page.click('[data-a=secMicX]'); await H.settle(page, 500);
    check('ביטול הקלטה: לא נשלח תמלול ונעלם כפתור הביטול', all(o.bodies, 'secMedia', (b) => b.op === 'stt').length === n0 + 1 && !(await page.$('[data-a=secMicX]')) && (await page.evaluate(() => window.__tracks)) === 0);
    // --- סירוב למיקרופון ---
    await fakeMic(page, true); await page.click('[data-a=secMic]'); await H.settle(page, 400);
    check('סירוב למיקרופון: הודעה בעברית ואין הקלטה', /אין הרשאה למיקרופון/.test(await toasts(page)) && !/עצור ושלח/.test(await txt(page, '#secMedia')));
    // --- שגיאת שרת בתמלול ---
    await fakeMic(page); o.R.sttErr = 'הקלטות כבויות בעסק'; await page.click('[data-a=secMic]'); await H.settle(page, 300); await page.click('[data-a=secMic]'); await H.settle(page, 1200);
    check('שגיאת שרת בתמלול: הודעת השרת מוצגת, בלי קריאה ל-secChat נוספת, ואפשר להקליט שוב', /הקלטות כבויות בעסק/.test(await toasts(page)) && all(o.bodies, 'secChat').length === 2 && !!(await page.$('[data-a=secMic]:not([disabled])')));
    o.R.sttErr = '';
    // --- מצב חיסכון בתמלול (ליקוי 2): מוצג ההסבר מהשרת, באנר החיסכון, ובלי secChat ---
    await page.evaluate(() => { window.__toasts.length = 0; });
    o.R.sttSave = true; await page.click('[data-a=secMic]'); await H.settle(page, 300); await page.click('[data-a=secMic]'); await H.settle(page, 1200);
    check('מצב חיסכון בתמלול: הודעת התקרה מהשרת (לא "לא הצלחתי להבין"), באנר חיסכון, ובלי secChat', /תקרת השימוש החודשית/.test(await toasts(page)) && !/לא הצלחתי להבין/.test(await toasts(page)) && !!(await page.$('#secSaving')) && all(o.bodies, 'secChat').length === 2, await toasts(page));
    o.R.sttSave = false; await page.evaluate(() => { window.__sec.st.saving = ''; window.__sec.st.pct = 10; rerender(); });
    // --- כשל בהתחלת ההקלטה (ליקוי 7): המיקרופון משוחרר, הודעה, ואפשר לנסות שוב ---
    await fakeMic(page, false, true); await page.evaluate(() => { window.__toasts.length = 0; });
    await page.click('[data-a=secMic]'); await H.settle(page, 400);
    check('כשל ב-start: הודעה, המיקרופון שוחרר ואין הקלטה תקועה', /לא הצלחנו להתחיל את ההקלטה/.test(await toasts(page)) && (await page.evaluate(() => window.__tracks)) === 0 && !/עצור ושלח/.test(await txt(page, '#secMedia')) && !!(await page.$('[data-a=secMic]:not([disabled])')), await toasts(page));
    await fakeMic(page);
    // --- מעבר ללשונית אחרת באמצע הקלטה מהצ'אט (ליקוי 3): ההקלטה בוטלה ולא נשלח תמלול ---
    const s0 = all(o.bodies, 'secMedia', (b) => b.op === 'stt').length;
    await page.click('[data-a=secMic]'); await H.settle(page, 300);
    await page.click('#secTabs [data-v=notes]'); await H.settle(page, 3600);
    check('מעבר לשונית באמצע הקלטה: המיקרופון שוחרר ולא נשלח תמלול', (await page.evaluate(() => window.__tracks)) === 0 && all(o.bodies, 'secMedia', (b) => b.op === 'stt').length === s0 && all(o.bodies, 'secChat').length === 2);
    await page.click('#secTabs [data-v=chat]'); await H.settle(page, 400);
    // --- 🎤 בחלון "↩ תגובה" ---
    await page.click('#secChat [data-a=secMrReply][data-id=a1]'); await H.settle(page, 400);
    check('חלון "↩ תגובה": כפתור 🎤 ושורת הפרטיות', !!(await page.$('#dlg [data-a=secMrMic]')) && /נשלח לעיבוד ב-AI ונמחק/.test(await txt(page, '#dlg')));
    const c0 = all(o.bodies, 'secChat').length;
    await page.click('#dlg [data-a=secMrMic]'); await H.settle(page, 300); await page.click('#dlg [data-a=secMrMic]'); await H.settle(page, 1400);
    check('התמלול ממלא את שדה התגובה ולא נשלח לצ\'אט', (await page.inputValue('#secMrT')) === 'שלום, כמה הכנסות היום' && all(o.bodies, 'secChat').length === c0);
    if (shots) await page.screenshot({ path: path.join(shots, 'sec12-reply-360.png') });
    await page.click('#dlg [data-a=closeDlg]');
    // --- סגירת חלון "↩ תגובה" באמצע הקלטה (ליקוי 3): בכפתור "ביטול" וב-Esc – המיקרופון נסגר ולא נשלח תמלול ---
    for (const how of ['ביטול', 'Esc']) {
      const s1 = all(o.bodies, 'secMedia', (b) => b.op === 'stt').length;
      await page.click('#secChat [data-a=secMrReply][data-id=a1]'); await H.settle(page, 400);
      await page.click('#dlg [data-a=secMrMic]'); await H.settle(page, 300);
      const rec = (await page.evaluate(() => window.__tracks)) === 1;
      if (how === 'Esc') await page.keyboard.press('Escape'); else await page.click('#dlg [data-a=closeDlg]');
      await H.settle(page, 3600);
      check('סגירת חלון התגובה (' + how + ') באמצע הקלטה: המיקרופון שוחרר (__tracks=0) ולא נשלח תמלול', rec && (await page.evaluate(() => window.__tracks)) === 0 && all(o.bodies, 'secMedia', (b) => b.op === 'stt').length === s1 && !(await page.evaluate(() => document.getElementById('dlg').open)));
    }
    // --- תמונה: חשבונית ---
    o.R.see = { ok: true, id: 'img1', reply: 'זו חשבונית ספק.', cards: [{ id: 'sc1', k: 'scan', doc: 'inv' }], pct: 12, saving: false };
    await page.fill('#secForm textarea', 'חשבונית מהספק'); 
    await page.setInputFiles('[data-c=secImgF]', { name: 'a.png', mimeType: 'image/png', buffer: PNG }); await H.settle(page, 1500);
    let see = last(o.bodies, 'secMedia', (b) => b.op === 'see');
    check('תמונה: see עם JPEG (מוקטן), כיתוב, ובלי נתיב', see && see[1].kind === 'image' && see[1].mime === 'image/jpeg' && see[1].b64.startsWith('/9j/') && see[1].cap === 'חשבונית מהספק' && !see[1].path, see && Object.keys(see[1]));
    check('"↩ תגובה" מוצג על תשובת המזכירה לתמונה (ליקוי 6)', !!(await page.$('#secChat [data-a=secMrReply][data-k=chat][data-id=img1]')));
    check('בועת משתמש עם 📷, תשובה וכרטיס "לסריקה"', /📷 חשבונית מהספק/.test(await txt(page, '#secChat')) && /להעביר לסריקה\?/.test(await txt(page, '#secChat')) && !!(await page.$('[data-a=secScOk][data-id=sc1]')));
    await page.evaluate(() => { window.__sg = 0; ACT.scanGo = () => { window.__sg++; }; });
    await page.click('[data-a=secScOk][data-id=sc1]'); await H.settle(page, 800);
    const mk = last(o.bodies, 'secMedia', (b) => b.op === 'mark');
    check('אישור: mark ok עם mid ו-cid', mk && mk[1].st === 'ok' && mk[1].cid === 'sc1' && mk[1].mid === 'img1', mk && mk[1]);
    const a = await page.evaluate(() => ({ step: A && A.step, pg: A && A.pg && A.pg[0] && A.pg[0].slice(0, 22), hi: A && A.hi && A.hi.length, sg: window.__sg, cat: A && A.cat, done: document.querySelector('[data-card=sc1]') && document.querySelector('[data-card=sc1]').dataset.st }));
    check('נפתח מסך הסריקה הרגיל (openAdd, step=scan, התמונה ב-pg[0], scanGo) והכרטיס "אושר"', a.step === 'scan' && /^data:image\/jpeg/.test(a.pg) && a.hi === 1 && a.sg === 1 && a.done === 'ok', a);
    check('התמונה שוחררה מהזיכרון אחרי האישור', await page.evaluate(() => !window.__sec.media.img1));
    await page.evaluate(() => { if (typeof sheetClose === 'function') sheetClose(); });
    // --- תמונה: דוח Z ---
    o.R.see = { ok: true, id: 'img2', reply: 'זה דוח Z.', cards: [{ id: 'sc2', k: 'scan', doc: 'z' }], pct: 12, saving: false };
    await page.setInputFiles('[data-c=secImgF]', { name: 'z.png', mimeType: 'image/png', buffer: PNG }); await H.settle(page, 1500);
    check('כרטיס דוח Z מציג שיפתח את סגירת הקופה', /סגירת הקופה/.test(await txt(page, '[data-card=sc2]')));
    await page.click('[data-a=secScOk][data-id=sc2]'); await H.settle(page, 900);
    const z = await page.evaluate(() => ({ v: cur().v, z0: ZC && ZC.z[0] && ZC.z[0].slice(0, 22) }));
    check('דוח Z: נפתח מסך סגירת הקופה והתמונה ב-ZC.z[0]', z.v === 'zc' && /^data:image\/jpeg/.test(z.z0), z);
    // --- דוח Z כשבסגירת הקופה כבר יש צילומים אחרים (ליקוי 9): שואלים; ביטול – לא נוגעים; אישור – סגירה חדשה ---
    await enter(page);
    await page.evaluate(() => { ZC = zcNew(); ZC.z = ['data:image/jpeg;base64,AAA', 'data:image/jpeg;base64,BBB', 'data:image/jpeg;base64,CCC']; ZC.o = 'data:image/jpeg;base64,OPEN'; });
    o.R.see = { ok: true, id: 'img2b', reply: 'עוד דוח Z.', cards: [{ id: 'sc2b', k: 'scan', doc: 'z' }], pct: 12, saving: false };
    await page.setInputFiles('[data-c=secImgF]', { name: 'z.png', mimeType: 'image/png', buffer: PNG }); await H.settle(page, 1500);
    const mz0 = all(o.bodies, 'secMedia', (b) => b.op === 'mark').length;
    await page.click('[data-a=secScOk][data-id=sc2b]'); await H.settle(page, 400);
    check('דוח Z עם צילומים קיימים: נשאלת שאלה "להתחיל סגירה חדשה", בלי mark עדיין', /להתחיל סגירה חדשה/.test(await txt(page, '#dlg')) && all(o.bodies, 'secMedia', (b) => b.op === 'mark').length === mz0, await txt(page, '#dlg'));
    await page.click('#dlg [data-a=closeDlg]'); await H.settle(page, 400);
    const zk = await page.evaluate(() => ({ z: ZC.z.join('|'), v: cur().v, open: !!document.querySelector('[data-a=secScOk][data-id=sc2b]'), m: !!window.__sec.media.img2b }));
    check('ביטול: הצילומים הקיימים לא נדרסו, הכרטיס נשאר פתוח והתמונה בזיכרון', zk.z === 'data:image/jpeg;base64,AAA|data:image/jpeg;base64,BBB|data:image/jpeg;base64,CCC' && zk.v === 'sec' && zk.open && zk.m && all(o.bodies, 'secMedia', (b) => b.op === 'mark').length === mz0, zk);
    await page.click('[data-a=secScOk][data-id=sc2b]'); await H.settle(page, 400); await page.click('#dlg [data-a=yes]'); await H.settle(page, 900);
    const zn = await page.evaluate(() => ({ v: cur().v, z0: ZC.z[0] && ZC.z[0].slice(0, 22), zOld: ZC.z[0] === 'data:image/jpeg;base64,AAA', z1: ZC.z[1], z2: ZC.z[2], o: ZC.o }));
    check('אישור: סגירה חדשה – התמונה ב-z[0], שאר החלקים ריקים, צילום הקופה הפותחת נשמר, ו-mark נשלח', zn.v === 'zc' && /^data:image\/jpeg/.test(zn.z0) && !zn.zOld && zn.z0.length > 0 && !zn.z1 && !zn.z2 && zn.o === 'data:image/jpeg;base64,OPEN' && !!last(o.bodies, 'secMedia', (b) => b.op === 'mark' && b.cid === 'sc2b' && b.st === 'ok'), zn);
    // --- תמונה אחרת: משימה (עם התמונה) ו"בטל" ---
    await enter(page); await fakeMic(page);
    o.R.see = { ok: true, id: 'img3', reply: 'מדף ריק.', cards: [{ id: 'tk1', k: 'task', txt: 'למלא את המדף' }], pct: 12, saving: false };
    await page.setInputFiles('[data-c=secImgF]', { name: 'o.png', mimeType: 'image/png', buffer: PNG }); await H.settle(page, 1500);
    check('כרטיס "לפתוח משימה?" עם הטקסט', /לפתוח משימה\?/.test(await txt(page, '#secChat')) && /למלא את המדף/.test(await txt(page, '#secChat')));
    const L0 = o.log.length;
    await page.click('[data-a=secTkOk][data-id=tk1]'); await H.settle(page, 1200);
    const nl = o.log.slice(L0), post = nl.find((r) => r.method === 'POST' && /\/tasks\?documentId=/.test(r.url)), img = nl.find((r) => r.method === 'PATCH' && /\/tasks\/[^/]+\/p\/m1/.test(r.url));
    const pf = post && JSON.parse(post.body).fields;
    check('אישור משימה: POST /tasks עם הטקסט, mi=1, לכל הצוות (בלי רשימת עובדים: בלי to); ואז PATCH p/m1 עם התמונה', pf && pf.txt.stringValue === 'למלא את המדף' && pf.mi.integerValue === '1' && !pf.to && img && /data:image\/jpeg/.test(img.body), pf && Object.keys(pf));
    check('mark ok נשלח אחרי יצירת המשימה, והכרטיס "אושר"', !!last(o.bodies, 'secMedia', (b) => b.op === 'mark' && b.cid === 'tk1' && b.st === 'ok') && (await page.evaluate(() => document.querySelector('[data-card=tk1]').dataset.st)) === 'ok');
    // "בטל"
    o.R.see = { ok: true, id: 'img4', reply: 'עוד תמונה.', cards: [{ id: 'tk2', k: 'task', txt: 'לנקות' }], pct: 12, saving: false };
    await page.setInputFiles('[data-c=secImgF]', { name: 'o.png', mimeType: 'image/png', buffer: PNG }); await H.settle(page, 1500);
    const L1 = o.log.length;
    await page.click('[data-a=secScNo][data-id=tk2]'); await H.settle(page, 700);
    check('"בטל": mark no, בלי יצירת משימה, והתמונה שוחררה', !!last(o.bodies, 'secMedia', (b) => b.op === 'mark' && b.cid === 'tk2' && b.st === 'no') && !o.log.slice(L1).some((r) => /\/tasks/.test(r.url)) && await page.evaluate(() => !window.__sec.media.img4));
    // --- שני כרטיסים באותה הודעה (ליקוי 1): "בטל" על הסריקה ואז "פתח משימה" – התמונה עדיין בזיכרון ומועלית למשימה ---
    o.R.see = { ok: true, id: 'img6', reply: 'אולי חשבונית.', cards: [{ id: 'sc6', k: 'scan', doc: 'inv', low: true }, { id: 'tk6', k: 'task', txt: 'לבדוק את הסכום' }], pct: 12, saving: false };
    await page.setInputFiles('[data-c=secImgF]', { name: 'o.png', mimeType: 'image/png', buffer: PNG }); await H.settle(page, 1500);
    await page.evaluate(() => { window.__toasts.length = 0; });
    await page.click('[data-a=secScNo][data-id=sc6]'); await H.settle(page, 700);
    check('שני כרטיסים: אחרי "בטל" על הסריקה התמונה עדיין בזיכרון (כרטיס המשימה פתוח)', await page.evaluate(() => !!window.__sec.media.img6));
    const L6 = o.log.length;
    await page.click('[data-a=secTkOk][data-id=tk6]'); await H.settle(page, 1200);
    const n6 = o.log.slice(L6), p6 = n6.find((r) => r.method === 'POST' && /\/tasks\?documentId=sectk6/.test(r.url)), i6 = n6.find((r) => r.method === 'PATCH' && /\/tasks\/sectk6\/p\/m1/.test(r.url));
    check('שני כרטיסים: "פתח משימה" אחרי "בטל" – המשימה נוצרה עם התמונה (mi=1, PATCH p/m1), בלי "שלחו שוב", והתמונה שוחררה בסוף', !!p6 && JSON.parse(p6.body).fields.mi.integerValue === '1' && !!i6 && !/שלחו שוב/.test(await toasts(page)) && await page.evaluate(() => !window.__sec.media.img6), await toasts(page));
    // הסדר ההפוך: קודם משימה, אחר כך סריקה
    o.R.see = { ok: true, id: 'img7', reply: 'אולי חשבונית.', cards: [{ id: 'sc7', k: 'scan', doc: 'inv', low: true }, { id: 'tk7b', k: 'task', txt: 'לשלם לספק' }], pct: 12, saving: false };
    await page.setInputFiles('[data-c=secImgF]', { name: 'o.png', mimeType: 'image/png', buffer: PNG }); await H.settle(page, 1500);
    await page.evaluate(() => { window.__toasts.length = 0; window.__sg = 0; });
    await page.click('[data-a=secTkOk][data-id=tk7b]'); await H.settle(page, 1200);
    check('שני כרטיסים (הפוך): אחרי "פתח משימה" התמונה עדיין בזיכרון', await page.evaluate(() => !!window.__sec.media.img7));
    await page.click('[data-a=secScOk][data-id=sc7]'); await H.settle(page, 800);
    const a7 = await page.evaluate(() => ({ step: A && A.step, pg: A && A.pg && A.pg[0] && A.pg[0].slice(0, 22), sg: window.__sg, m: !!window.__sec.media.img7 }));
    check('שני כרטיסים (הפוך): "לסריקה" פותח את הסריקה עם התמונה, בלי "שלחו שוב", והתמונה שוחררה', a7.step === 'scan' && /^data:image\/jpeg/.test(a7.pg) && a7.sg === 1 && !a7.m && !/שלחו שוב/.test(await toasts(page)), a7);
    await page.evaluate(() => { if (typeof sheetClose === 'function') sheetClose(); });
    // התמונה כבר לא בזיכרון
    o.R.see = { ok: true, id: 'img5', reply: 'חשבונית.', cards: [{ id: 'sc5', k: 'scan', doc: 'rcpt' }], pct: 12, saving: false };
    await page.setInputFiles('[data-c=secImgF]', { name: 'o.png', mimeType: 'image/png', buffer: PNG }); await H.settle(page, 1500);
    await page.evaluate(() => { window.__sec.media = {}; window.__toasts.length = 0; });
    const m1 = all(o.bodies, 'secMedia', (b) => b.op === 'mark').length;
    await page.click('[data-a=secScOk][data-id=sc5]'); await H.settle(page, 500);
    check('אישור אחרי שהתמונה לא בזיכרון: "שלחו שוב את התמונה", בלי mark והכרטיס נשאר פתוח', /שלחו שוב את התמונה/.test(await toasts(page)) && all(o.bodies, 'secMedia', (b) => b.op === 'mark').length === m1 && !!(await page.$('[data-a=secScOk][data-id=sc5]')));
    // "מול העיניים": כרטיס פתוח מהשרת
    await page.evaluate(() => { window.__sec.ey = { open: [{ id: 'e1', k: 'appr', title: 'מסמך לסריקה', sub: 'חשבונית', act: { k: 'scan', id: 'sc9', mid: 'img9' } }], did: [], hold: [], since: Date.now() }; rerender(); });
    await H.settle(page, 400);
    check('"מול העיניים": כרטיס scan פתוח עם כפתורי לסריקה/בטל', !!(await page.$('#secEyOpen [data-a=secScOk][data-id=sc9][data-mid=img9]')) && !!(await page.$('#secEyOpen [data-a=secScNo][data-id=sc9]')));
    // "מול העיניים": כרטיס משימה מסרטון (ההודעה לא נטענה בשיחה) – נפתח מהשורה; אישור חוזר אחרי שהסימון נכשל לא משכפל משימה
    const posts = [];
    await o.ctx.route(/:8080\/.*\/tasks\?documentId=/, async (route) => {
      const id = new URL(route.request().url()).searchParams.get('documentId'); const dup = posts.some((x) => x.id === id && x.st === 200);
      posts.push({ id, st: dup ? 409 : 200, body: route.request().postData() || '' });
      if (dup) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 409, message: 'Document already exists', status: 'ALREADY_EXISTS' } }) });
      return route.fallback();
    });
    const eyTk = () => page.evaluate(() => { window.__sec.ey = { open: [{ id: 'md:tk7', k: 'media', title: 'לפתוח משימה? לבדוק את המקרר', act: { k: 'task', id: 'tk7', mid: 'vid7', txt: 'לבדוק את המקרר', via: 'video' }, r: { k: 'chat', id: 'vid7' } }], did: [], hold: [], since: Date.now() }; window.__toasts.length = 0; rerender(); });
    o.R.markFail = true; await eyTk(); await H.settle(page, 300);
    check('"מול העיניים": שורת משימה מהשיחה עם "פתח משימה"', !!(await page.$('#secEyOpen [data-a=secTkOk][data-id=tk7][data-mid=vid7]')) && /מהשיחה/.test(await txt(page, '#secEyOpen')));
    await page.click('#secEyOpen [data-a=secTkOk][data-id=tk7]'); await H.settle(page, 900);
    await eyTk(); await H.settle(page, 300);
    o.R.markFail = false;
    await page.click('#secEyOpen [data-a=secTkOk][data-id=tk7]'); await H.settle(page, 900);
    const p7 = posts.filter((x) => x.id === 'sectk7');
    check('אישור חוזר: אותו מזהה משימה (נגזר מהכרטיס), השני נענה 409 ולא נוצרה משימה שנייה; "המשימה כבר נפתחה" ו-mark ok', p7.length === 2 && p7[0].st === 200 && p7[1].st === 409 && JSON.parse(p7[0].body).fields.txt.stringValue === 'לבדוק את המקרר' && JSON.parse(p7[0].body).fields.mi.integerValue === '0' && /כבר נפתחה/.test(await toasts(page)) && !!last(o.bodies, 'secMedia', (b) => b.op === 'mark' && b.cid === 'tk7' && b.st === 'ok'), posts);
    // --- תמונות כבויות / סרטון כבוי / קול כבוי ---
    await ctxClose(o);
  }
  {
    // --- סרטון ---
    const o = await open(browser, www, { aud: 120, img: true, vid: 30 }); const page = o.page;
    await enter(page);
    await page.evaluate(() => { // וידאו מדומה: אורך לפי window.__dur (בלי פענוח אמיתי)
      window.__dur = 10; const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'duration');
      Object.defineProperty(HTMLMediaElement.prototype, 'duration', { configurable: true, get() { return window.__dur; } });
      Object.defineProperty(HTMLMediaElement.prototype, 'src', { configurable: true, set(v) { this.__s = v; setTimeout(() => this.onloadedmetadata && this.onloadedmetadata(), 10); }, get() { return this.__s || ''; } });
      void d; });
    const mp4 = (n) => ({ name: 'v.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(n, 1) });
    await page.evaluate(() => { window.__dur = 90; });
    await page.setInputFiles('[data-c=secVidF]', mp4(1000)); await H.settle(page, 900);
    check('סרטון ארוך מהמגבלה (90 מול 30): נדחה בהודעה, בלי העלאה ובלי קריאה לשרת', /ארוך מדי \(90 שניות\)\. אפשר עד 30/.test(await toasts(page)) && !o.log.some((r) => r.st && /sec_tmp/.test(r.url)) && !last(o.bodies, 'secMedia', (b) => b.op === 'see'), await toasts(page));
    check('אחרי דחייה: אין בועה ואין "מעבדת", והכפתורים פעילים', !/מעבדת|בודקת/.test(await txt(page, '#secChat')) && !!(await page.$('[data-a=secMic]:not([disabled])')));
    await page.evaluate(() => { window.__dur = 12; });
    o.R.see = { ok: true, id: 'v1', reply: 'רואה מדף עם חלב. אמרת "לבדוק מלאי".', cards: [], pct: 14, saving: false };
    await page.setInputFiles('[data-c=secVidF]', mp4(1200000)); await H.settle(page, 1500);
    const up = o.log.find((r) => r.st && /sec_tmp/.test(r.url)), see = last(o.bodies, 'secMedia', (b) => b.op === 'see');
    check('סרטון תקין: הועלה ל-sec_tmp (POST, video/mp4) ואז see עם הנתיב, בלי base64', up && up.method === 'POST' && up.ct === 'video/mp4' && up.size === 1200000 && /[?&]name=b%2Fbiz-o%2Fsec_tmp%2Fm%2F[0-9a-f]{24}\.mp4/.test(up.url) && see && see[1].kind === 'video' && /^b\/biz-o\/sec_tmp\/m\/[0-9a-f]{24}\.mp4$/.test(see[1].path) && !see[1].b64, see && see[1]);
    check('בועת 🎬 ותשובה; שום קובץ לא נשאר בזיכרון', /🎬 סרטון/.test(await txt(page, '#secChat')) && /רואה מדף/.test(await txt(page, '#secChat')) && await page.evaluate(() => Object.keys(window.__sec.media || {}).length === 0));
    // see נכשל: מנסים למחוק את הקובץ (בנוסף למחיקה בשרת)
    // כבד מדי ואי אפשר להקטין (אין וידאו אמיתי בדפדפן המדומה)
    const n1 = o.log.filter((r) => r.st && /sec_tmp/.test(r.url)).length;
    await page.setInputFiles('[data-c=secVidF]', mp4(13 * 1048576)); await H.settle(page, 1200);
    check('סרטון כבד שאי אפשר להקטין: הודעה ברורה ובלי העלאה', /כבד מדי ואי אפשר להקטין/.test(await toasts(page)) && o.log.filter((r) => r.st && /sec_tmp/.test(r.url)).length === n1, await toasts(page));
    if (shots) await page.screenshot({ path: path.join(shots, 'sec12-video-360.png'), fullPage: true });
    check('בלי שגיאות JS (סרטון)', page.__errors.length === 0, page.__errors);
    await ctxClose(o);
  }
  {
    // --- הקטנה אמיתית במכשיר (canvas + MediaRecorder), בדפדפן אמיתי: מייצרים סרטון קצר ומעבירים אותו כסוג לא נתמך ---
    const o = await open(browser, www, { aud: 120, img: true, vid: 30 }); const page = o.page;
    await enter(page);
    const b64 = await page.evaluate(async () => {
      const cv = document.createElement('canvas'); cv.width = 320; cv.height = 240; const cx = cv.getContext('2d'), s = cv.captureStream(15);
      const mr = new MediaRecorder(s, { mimeType: 'video/webm' }), ch = []; mr.ondataavailable = (e) => ch.push(e.data);
      const done = new Promise((r) => { mr.onstop = r; }); mr.start(200); let i = 0; const iv = setInterval(() => { cx.fillStyle = 'hsl(' + (i * 20) + ',80%,50%)'; cx.fillRect(0, 0, 320, 240); i++; }, 60);
      await new Promise((r) => setTimeout(r, 1800)); clearInterval(iv); mr.stop(); await done;
      const buf = new Uint8Array(await new Blob(ch).arrayBuffer()); let bin = ''; for (let k = 0; k < buf.length; k += 8192) bin += String.fromCharCode.apply(null, buf.subarray(k, k + 8192)); return btoa(bin); });
    const buf = Buffer.from(b64, 'base64');
    o.R.see = { ok: true, id: 'v2', reply: 'סרטון צבעוני.', cards: [], pct: 14, saving: false };
    await page.setInputFiles('[data-c=secVidF]', { name: 'v.mkv', mimeType: 'video/x-matroska', buffer: buf }); await H.settle(page, 6000);
    const up = o.log.find((r) => r.st && /sec_tmp/.test(r.url)), see = last(o.bodies, 'secMedia', (b) => b.op === 'see');
    check('סוג לא נתמך: הוקטן במכשיר (webm) והועלה, ואז see', !!(up && up.ct === 'video/webm' && up.size > 1000 && see && /\.webm$/.test(see[1].path)), { up: up && [up.ct, up.size], t: await toasts(page) });
    await ctxClose(o);
  }
  {
    // --- הגבלות: כל סוג כבוי / אין הגבלות מהשרת ---
    for (const [m, want, label] of [[{ aud: 0, img: true, vid: 60 }, { mic: 0, img: 1, vid: 1 }, 'קול כבוי'], [{ aud: 120, img: false, vid: 60 }, { mic: 1, img: 0, vid: 1 }, 'תמונות כבויות'], [{ aud: 120, img: true, vid: 0 }, { mic: 1, img: 1, vid: 0 }, 'סרטון כבוי'], [{ aud: 0, img: false, vid: 0 }, { mic: 0, img: 0, vid: 0, none: 1 }, 'הכול כבוי'], [undefined, { mic: 0, img: 0, vid: 0, none: 1 }, 'שרת ישן (בלי media)']]) {
      const o = await open(browser, www, m); await enter(o.page);
      const got = await o.page.evaluate(() => ({ mic: !!document.querySelector('[data-a=secMic]'), img: !!document.querySelector('[data-c=secImgF]'), vid: !!document.querySelector('[data-c=secVidF]'), note: /נשלח לעיבוד ב-AI/.test(document.getElementById('main').innerText) }));
      check(label + ': כפתורים לפי ההגבלה' + (want.none ? ', בלי שורת פרטיות' : ''), got.mic === !!want.mic && got.img === !!want.img && got.vid === !!want.vid && got.note === !want.none, got);
      await ctxClose(o);
    }
  }
  {
    // --- חלון מנהל־העל ---
    const o = await open(browser, www, { aud: 120, img: true, vid: 60 }); const page = o.page;
    await page.evaluate(async () => { SY.sa = 1; ADM.sa = 1; ADM.L = ADM.L || []; if (!ADM.L.find((x) => x.id === 'biz-o')) ADM.L.push({ id: 'biz-o', name: 'עסק בדיקה', status: 'active', dataRoot: 'b', features: { secretary: true } }); NAV = [{ v: 'home' }]; go('sab', 'biz-o'); await new Promise((r) => setTimeout(r, 900)); });
    check('מנהל־על: שדות קול, סרטון ותמונות עם ערכי ברירת מחדל', (await page.inputValue('form[data-f=secSaF] [name=ma]')) === '120' && (await page.inputValue('form[data-f=secSaF] [name=mv]')) === '60' && await page.isChecked('form[data-f=secSaF] [name=mi]'));
    check('מנהל־על 360px: בלי גלישה לרוחב', (await sx(page)) <= 0, await sx(page));
    if (shots) await page.screenshot({ path: path.join(shots, 'sec12-sab-360.png'), fullPage: true });
    // ליקוי 5: שמירה בלי שינוי בהגבלות (העסק על ברירת המחדל) – לא נכתב media
    await page.fill('form[data-f=secSaF] [name=rh]', '41'); await page.click('form[data-f=secSaF] button.btn'); await H.settle(page, 500);
    const sv0 = last(o.bodies, 'secAdminSetCfg');
    check('שמירה בלי שינוי בקול/תמונה/סרטון (ברירת מחדל): לא נשלח media', !!sv0 && !('media' in sv0[1]), sv0 && sv0[1]);
    const nsv = all(o.bodies, 'secAdminSetCfg').length;
    await page.fill('form[data-f=secSaF] [name=ma]', '400'); await page.click('form[data-f=secSaF] button.btn'); await H.settle(page, 400);
    check('קול מעל 300: שגיאה ובלי שמירה', /0 עד 300/.test(await toasts(page)) && all(o.bodies, 'secAdminSetCfg').length === nsv);
    await page.fill('form[data-f=secSaF] [name=ma]', '30'); await page.fill('form[data-f=secSaF] [name=mv]', '0'); await page.uncheck('form[data-f=secSaF] [name=mi]');
    await page.click('form[data-f=secSaF] button.btn'); await H.settle(page, 500);
    const sv = last(o.bodies, 'secAdminSetCfg');
    check('שמירה: media {aud:30,img:false,vid:0} עם bizId', sv && sv[1].bizId === 'biz-o' && sv[1].media && sv[1].media.aud === 30 && sv[1].media.img === false && sv[1].media.vid === 0, sv && sv[1].media);
    await page.fill('form[data-f=secSaF] [name=mv]', '61'); await page.click('form[data-f=secSaF] button.btn'); await H.settle(page, 400);
    check('סרטון מעל 60: שגיאה', /0 עד 60/.test(await toasts(page)));
    check('בלי שגיאות JS (מנהל־על)', page.__errors.length === 0, page.__errors);
    await ctxClose(o);
  }
  await browser.close();
  console.log(fail ? `\nנכשלו ${fail}` : '\nהכול עבר');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
async function ctxClose(o) { await o.page.context().close(); }
