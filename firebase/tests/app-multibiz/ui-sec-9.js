'use strict';
// "תגובה למזכירה" (15.11.2026): המסכים במכשיר. רשת מדומה (בלי שרת), כמו ui-sec-7b.js. נבדק ברוחב 360px:
//  - כפתור "↩ תגובה" על תשובה בשיחה, על התראה ועל טיוטת ווצאפ; חלון התגובה → secLearn reply → הצעה לכלל → "שמירה ככלל" (save עם התחום שנבחר).
//  - הוראה רגישה (תשלום) – בהצעה מופיע "תמיד באישור".
//  - בטיוטה: "לפי ההנחיה שלך", "לעשות את זה מעכשיו לבד?" (רק לבעל הכלל) → אישור → secLearn auto; "למה לא נשלח לבד".
//  - מסך "הכללים שלי": פעיל / לבד / מחיקה, כלל בטיחות בלי "לבד", "לבד" נעול לפני אישור ראשון, יומן "נשלח לבד", "עצור הכל".
//  - מנהל עם הגבלת סניפים – בלי "תגובה" על ווצאפ; תכונה כבויה – בלי "תגובה" בכלל.
//  - בלי גלילה לרוחב, מטרות לחיצה 44px, תוכן זדוני מוצג כטקסט, בלי שגיאות JS. צילום אחד לכל מסך (רק אם ניתנה תיקייה).
// שימוש: node ui-sec-9.js <www-dir> [shots-dir]
const fs = require('fs');
const path = require('path');
const H = require('./harness');
let fail = 0;
const check = (name, ok, info) => { if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const BIZ = 'biz-o';
const FEAT = { scan: true, tasks: true, orders: true, suppliers: true, cashClose: true, secretary: true };
const TYPES = { invDue: 'חשבונית לתשלום', win: 'הודעה שלא נענתה' };
const XSS = '<img src=x onerror="window.__xss=1">';
const NT = { wd: 0, wh: 8, md: 0, mh: 8, dg: false, dh: 8, q: { on: false, f: '22:00', t: '07:00' }, reps: 3, rt: {} };

async function open(browser, www, o) {
  const who = 'm';
  const cfg = { mode: 'new', users: { [who]: BIZ }, sa: {}, biz: { [BIZ]: { dataRoot: 'b', features: FEAT, name: 'עסק בדיקה' } },
    admins: { [`b/${BIZ}/|${who}`]: 1 }, staff: { [`b/${BIZ}/|${who}`]: 1 }, ctx: { hasTouch: true, isMobile: true, viewport: { width: 360, height: 740 } } };
  const now = H.T0, bodies = [];
  const st = { ok: true, consented: true, setupDone: true, name: 'רותי', addr: 'f', call: 'נתי', rows: [], mode: 'all', pay: true, emp: true, sens: false, we: 'warn', mirror: true, mirrorAt: null, cfTh: null, pct: 10, saving: '', nt: NT, types: TYPES, unseen: 0,
    learn: o.learn !== false, brLimited: !!o.br };
  const wc = { ok: true, connected: true, num: '03-0000000', link: '', stop: { on: false, auto: false, why: '', at: 0, by: '' }, ack: { on: false, text: '' }, open: { on: false, text: '' }, ackH: { f: '08:00', t: '18:00' }, hour: 30, myNum: '', myReq: '', tpls: [], appr: [] };
  const S = { uid: '' };
  const chat = [{ id: 'c1', role: 'u', text: 'כמה חשבוניות פתוחות?', t: now - 120000 }, { id: 'c2', role: 'a', text: 'יש 3 חשבוניות פתוחות.', t: now - 110000, src: [] }];
  const notes = [{ id: 'n1', k: 'wa', typ: 'wa', title: 'המזכירה לא בטוחה בטיוטה', body: 'הודעה מ-054-1112233 מחכה לבדיקה שלך.', at: now - 60000, t: now - 60000, seen: true, st: 'open', rep: 0, n: 1 }];
  const card = { wa: '972541112233', show: '054-1112233', name: 'יוסי ' + XSS, link: null, lang: 'he', langL: 'עברית', lastIn: now - 3600e3, n: 2, winLeft: 20 * 3600e3, isNew: false };
  const drafts = () => [{ id: 'i1', in: 'i1', text: 'שלום, אנחנו פתוחים א׳–ה׳ 08:00–18:00.', st: 'pend', flags: [], why: [], src: 'ai', t: now, mr: 'r1', mrBy: S.uid, mrI: 'כששואלים על שעות – לענות קצר ' + XSS, mrAsk: true, mrNoL: ['הכלל לא מוגדר "לבד"'] }];
  const rules = [
    { id: 'r1', ch: 'wa', act: 'reply', instr: 'כששואלים על שעות – לענות קצר', scopeL: 'פניות מסוג "שעות וכתובת"', on: true, auto: false, safe: '', safeL: '', canAuto: true, appr: 1, hits: 0, fails: 0, offWhy: '', lastAt: 0, t: 3 },
    { id: 'r2', ch: 'mail', act: 'reply', instr: 'תשלמי לספק כשמגיעה חשבונית', scopeL: 'כל ההודעות במייל', on: true, auto: false, safe: 'pay', safeL: 'תשלום או העברת כסף', canAuto: false, appr: 0, hits: 0, fails: 0, offWhy: '', lastAt: 0, t: 2 },
    { id: 'r3', ch: 'wa', act: 'reply', instr: 'הזמנות – לאשר שקיבלנו ' + XSS, scopeL: 'רק מהשולח הזה', on: true, auto: false, safe: '', safeL: '', canAuto: false, appr: 0, hits: 0, fails: 0, offWhy: '', lastAt: 0, t: 1 },
  ];
  const log = [{ id: 'l1', t: now - 30000, ch: 'wa', st: 'sent', to: '***2233', ri: 'כששואלים על שעות', by: 'אני', mine: true, whyL: [] }];
  const { ctx, page } = await H.newPage(browser, www, cfg, [], who);
  await ctx.route(/:5001\/.*/, async (route) => {
    const n = new URL(route.request().url()).pathname.split('/').pop();
    let body = {}; try { body = JSON.parse(route.request().postData() || '{}').data || {}; } catch (e) { /* */ }
    bodies.push([n, body]);
    const ok = (r) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: r }) });
    if (n === 'secState') return ok(st);
    if (n === 'secChatLoad') return ok({ ok: true, msgs: chat });
    if (n === 'secNotes') return ok(body.op === 'list' ? { ok: true, notes, unseen: 0, types: TYPES } : { ok: true });
    if (n === 'secWaCfg') return ok(wc);
    if (n === 'secInbox') return ok(body.op === 'get' ? { ok: true, card, msgs: [{ id: 'i1', t: now - 3600e3, type: 'text', text: 'מתי אתם פתוחים?', draft: 'i1', flags: [] }], drafts: drafts(), tpls: [] }
      : { ok: true, cards: [Object.assign({}, card, { pend: 1, flags: [], last: { id: 'i1', type: 'text', text: 'מתי אתם פתוחים?' } })], stop: wc.stop, connected: true });
    if (n === 'secLearn') {
      if (body.op === 'reply') {
        const safe = /תשלמי/.test(body.text);
        const opts = body.k === 'wa' ? [{ v: 'cls', l: 'פניות מסוג "שעות וכתובת"' }, { v: 'from', l: 'רק מהשולח הזה' }, { v: 'all', l: 'כל ההודעות בווצאפ' }] : body.k === 'note' ? [{ v: 'fam', l: 'התראות דומות לזו' }, { v: 'typ', l: 'כל ההתראות מהסוג הזה' }] : [];
        return ok({ ok: true, prop: { ch: body.k, act: body.k === 'note' ? 'mute' : body.k === 'chat' ? 'style' : 'reply', instr: body.text, safe: safe ? 'pay' : '', safeL: safe ? 'תשלום או העברת כסף' : '', opts, canAuto: body.k === 'wa' && !safe },
          draft: body.k === 'wa' ? Object.assign(drafts()[0], { text: 'טיוטה חדשה לפי ההוראה', mrAsk: false }) : null });
      }
      if (body.op === 'save') return ok({ ok: true, id: 'rNew' });
      if (body.op === 'list') return ok({ ok: true, rules, max: 50, brLimited: false, stop: false });
      if (body.op === 'log') return ok({ ok: true, items: log });
      return ok({ ok: true, rule: {} });
    }
    return ok(n === 'getBackupKey' ? { key: Buffer.alloc(32, 7).toString('base64') } : {});
  });
  await H.login(page, who + '@x.co');
  await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden && ACT.startBlank) ACT.startBlank(); });
  await H.settle(page, 500);
  S.uid = await page.evaluate(() => SY.uid || '');
  return { ctx, page, bodies };
}
const last = (bodies, n, f) => bodies.filter((b) => b[0] === n && (!f || f(b[1]))).pop();
const tab = async (page, v) => { await page.evaluate((x) => { if (document.getElementById('dlg').open) closeDlg(); go('sec'); if (ACT.secSetX) ACT.secSetX(); window.__sec.mrv = 0; const b = document.querySelector('#secTabs [data-v=' + x + ']'); if (b) b.click(); }, v); await H.settle(page, 900); };
const dlgText = (page) => page.evaluate(() => (document.getElementById('dlg').open ? document.getElementById('dlg').innerText : ''));
const shot = async (page, dir, name) => { if (dir) await page.screenshot({ path: path.join(dir, 'sec9-' + name + '-360.png'), fullPage: true }); };
const small = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((e) => e.offsetParent).map((e) => Math.round(e.getBoundingClientRect().height)).filter((h) => h < 44), sel);
const noHs = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth <= 1);

(async () => {
  const [www, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const browser = await H.launch();
  {
    const { ctx, page, bodies } = await open(browser, www, {});
    // ---- שיחה ----
    await tab(page, 'chat');
    check('שיחה: כפתור "תגובה" על תשובת המזכירה (ולא על השאלה)', (await page.$$('#secChat [data-a=secMrReply][data-k=chat]')).length === 1 && !!(await page.$('#secChat [data-a=secMrReply][data-id=c2]')));
    await page.click('#secChat [data-a=secMrReply]'); await H.settle(page, 400);
    check('חלון התגובה: תיבת טקסט, דוגמאות, והערת כללי הבטיחות', /תגובה למזכירה/.test(await dlgText(page)) && /תמיד באישור שלך/.test(await dlgText(page)) && !!(await page.$('#dlg #secMrT')));
    await shot(page, shots, 'reply');
    await page.click('#dlg [data-a=secMrEx]'); await page.click('#secMrGo'); await H.settle(page, 600);
    const rq = last(bodies, 'secLearn', (b) => b.op === 'reply');
    check('שליחה: secLearn reply עם הסוג, המזהה וההוראה', rq && rq[1].k === 'chat' && rq[1].id === 'c2' && rq[1].text === 'מעכשיו תעני לי בקצרה', rq && rq[1]);
    check('הצעה: "לשמור ככלל קבוע?" עם "שמירה ככלל" ו"רק הפעם"', /לשמור ככלל קבוע/.test(await dlgText(page)) && /רק הפעם/.test(await dlgText(page)));
    await page.click('#dlg [data-a=secMrSave]'); await H.settle(page, 600);
    const sv = last(bodies, 'secLearn', (b) => b.op === 'save');
    check('שמירה: secLearn save (k/id/text), החלון נסגר', sv && sv[1].k === 'chat' && sv[1].id === 'c2' && sv[1].text === 'מעכשיו תעני לי בקצרה' && !(await page.evaluate(() => document.getElementById('dlg').open)), sv && sv[1]);
    // ---- התראות ----
    await tab(page, 'notes');
    check('התראות: כפתור "תגובה" בכל התראה', !!(await page.$('#secNotes [data-a=secMrReply][data-k=note][data-id=n1]')));
    await page.click('#secNotes [data-a=secMrReply]'); await H.settle(page, 400);
    await page.fill('#secMrT', 'אל תתריעי לי על התראות כאלה'); await page.click('#secMrGo'); await H.settle(page, 600);
    check('התראה: הצעה עם בחירת תחום (דומות / כל הסוג)', (await page.$$('#secMrSc input[type=radio]')).length === 2 && /לא אתריע/.test(await dlgText(page)));
    await page.click('#secMrSc label:nth-child(2) input'); await page.click('#dlg [data-a=secMrSave]'); await H.settle(page, 600);
    check('התראה: save עם התחום שנבחר (typ)', last(bodies, 'secLearn', (b) => b.op === 'save')[1].sc === 'typ');
    // ---- ווצאפ ----
    await tab(page, 'wa');
    await page.click('#secWaList [data-a=secWaOpen]'); await H.settle(page, 900);
    const wtxt = await page.evaluate(() => document.getElementById('main').innerText);
    check('טיוטת ווצאפ: "לפי ההנחיה שלך" + השאלה "לעשות את זה מעכשיו לבד?" + "למה לא נשלח לבד"', /לפי ההנחיה שלך/.test(wtxt) && !!(await page.$('#secMrAsk')) && /למה לא נשלח לבד/.test(wtxt), wtxt.slice(0, 300));
    check('טיוטת ווצאפ: כפתור "תגובה"', !!(await page.$('.secdr [data-a=secMrReply][data-k=wa][data-id=i1]')));
    check('מטרות לחיצה בשאלה "לבד?" – 44px לפחות', (await small(page, '#secMrAsk button')).length === 0, await small(page, '#secMrAsk button'));
    await shot(page, shots, 'ask');
    await page.click('#secMrAsk [data-a=secMrAuto][data-on="1"]'); await H.settle(page, 400);
    check('"כן, מעכשיו לבד" – קודם שאלת אישור', /ייענו לבד/.test(await dlgText(page)));
    await page.click('#dlg [data-a=yes]'); await H.settle(page, 700);
    const au = last(bodies, 'secLearn', (b) => b.op === 'auto');
    check('אישור: secLearn auto on=true עם הכלל והטיוטה; השאלה נעלמת', au && au[1].id === 'r1' && au[1].on === true && au[1].d === 'i1' && !(await page.$('#secMrAsk')), au && au[1]);
    // הוראה רגישה
    await page.click('.secdr [data-a=secMrReply]'); await H.settle(page, 400);
    await page.fill('#secMrT', 'תשלמי לו את ההחזר'); await page.click('#secMrGo'); await H.settle(page, 700);
    check('הוראה רגישה: "תמיד באישור" בהצעה', !!(await page.$('#secMrSafe')) && /תמיד באישור/.test(await dlgText(page)));
    check('הטיוטה עודכנה לטיוטה החדשה (לא נשלחה)', await page.evaluate(() => { const t = document.querySelector('textarea[id^=secDr_]'); return !!t && t.value === 'טיוטה חדשה לפי ההוראה'; }));
    await shot(page, shots, 'safe');
    // ---- הכללים שלי ----
    await page.evaluate(() => { closeDlg(); ACT.secSet(); }); await H.settle(page, 700);
    check('הגדרות: כרטיס "הכללים שלי"', !!(await page.$('#secMrSet [data-a=secMrOpen]')));
    await page.click('#secMrSet [data-a=secMrOpen]'); await H.settle(page, 1000);
    const m = await page.evaluate(() => { const r = (id) => document.querySelector('#secMr [data-id=' + id + ']'); return {
      n: document.querySelectorAll('#secMr .secli').length, stop: !!document.getElementById('secStopBar'),
      r1au: !!r('r1').querySelector('[data-c=secMrAu]:not([disabled])'), r2au: !!r('r2').querySelector('[data-c=secMrAu]'), r2safe: /תמיד באישור/.test(r('r2').innerText),
      r3lock: !!r('r3').querySelector('[data-c=secMrAu][disabled]'), log: document.getElementById('secMrLog').innerText }; });
    check('מסך הכללים: 3 כללים, "עצור הכל", יומן "נשלח לבד"', m.n === 3 && m.stop && /נשלח ✓/.test(m.log) && /\*\*\*2233/.test(m.log), m);
    check('כלל בטיחות – בלי "לבד" ועם "תמיד באישור"; "לבד" נעול לפני אישור ראשון; פתוח אחרי אישור', !m.r2au && m.r2safe && m.r3lock && m.r1au, m);
    check('מטרות לחיצה במסך הכללים – 44px לפחות', (await small(page, '#secMr .secrow .chip')).length === 0, await small(page, '#secMr .secrow .chip'));
    await shot(page, shots, 'rules');
    await page.click('#secMr [data-id=r1] [data-c=secMrOn]'); await H.settle(page, 600);
    check('כיבוי כלל: secLearn set on=false', (last(bodies, 'secLearn', (b) => b.op === 'set') || [0, {}])[1].on === false);
    await page.click('#secMr [data-id=r3] [data-a=secMrDel]'); await H.settle(page, 400);
    check('מחיקה – קודם שאלת אישור', /למחוק את הכלל/.test(await dlgText(page)));
    await page.click('#dlg [data-a=yes]'); await H.settle(page, 600);
    check('מחיקה: secLearn del', (last(bodies, 'secLearn', (b) => b.op === 'del') || [0, {}])[1].id === 'r3');
    check('בלי גלילה לרוחב (360px)', await noHs(page));
    check('תוכן זדוני מוצג כטקסט', !(await page.evaluate(() => window.__xss === 1 || !!document.querySelector('img[src="x"]'))));
    check('בלי שגיאות JS', page.__errors.length === 0, page.__errors.slice(0, 3));
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, www, { br: true });
    await tab(page, 'chat');
    const c = !!(await page.$('#secChat [data-a=secMrReply]'));
    await tab(page, 'wa'); await page.click('#secWaList [data-a=secWaOpen]'); await H.settle(page, 900);
    check('מנהל עם הגבלת סניפים: "תגובה" בשיחה כן, בטיוטת ווצאפ לא', c && !(await page.$('.secdr [data-a=secMrReply]')));
    check('הגבלת סניפים: בלי שגיאות JS', page.__errors.length === 0, page.__errors.slice(0, 3));
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, www, { learn: false });
    await tab(page, 'chat'); const a = (await page.$$('[data-a=secMrReply]')).length;
    await tab(page, 'notes'); const b = (await page.$$('[data-a=secMrReply]')).length;
    await page.evaluate(() => ACT.secSet()); await H.settle(page, 600);
    check('תכונה כבויה: בלי "תגובה" ובלי כרטיס "הכללים שלי"', a === 0 && b === 0 && !(await page.$('#secMrSet')));
    check('תכונה כבויה: בלי שגיאות JS', page.__errors.length === 0, page.__errors.slice(0, 3));
    await ctx.close();
  }
  await browser.close();
  console.log(fail ? `נכשלו ${fail}` : 'הכול עבר');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
