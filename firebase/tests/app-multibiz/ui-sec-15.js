'use strict';
// גיטי – סבב 4 חלק א (24.11.2026): מסך "הרשאות של גיטי" בהגדרות המזכירה וכרטיס שינוי הרשאה בשיחה (sec-perm.js). רשת מדומה, בלי שרת.
//  - מנהל־העל (perm.edit=true): מתגי רמה פעילים לכל 5 הסוגים, שינוי שולח secPrefs op:'perm' {type,lvl}; תקרה – {num,v}; ערך מחוץ לגבולות – לא נשלח.
//  - מנהל רגיל (perm.edit=false): אותו מסך נעול (כל המתגים והשדות disabled, בלי כפתורי שמירה) והסבר "רק מנהל־העל".
//  - אין סוג תשלום במסך. כרטיס בשיחה (k:'perm'): "אשר" → secPrefs op:'permCard' st:'ok' → "אושר ✓" בלי כפתורים.
//  - רוחב 360px: בלי גלילה לרוחב, מטרות לחיצה 44px, בלי שגיאות JS. צילום אחד (אם ניתנה תיקייה).
// שימוש: node ui-sec-15.js <www-dir> [shots-dir]
const fs = require('fs');
const path = require('path');
const H = require('./harness');
let fail = 0;
const check = (name, ok, info) => { if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const BIZ = 'biz-o';
const FEAT = { scan: true, tasks: true, orders: true, suppliers: true, cashClose: true, secretary: true };
const TYPES = { invDue: 'חשבונית לתשלום' };
const PTYPES = [['task', 'משימה'], ['rem', 'תזכורת'], ['msg', 'שליחת הודעה (ווצאפ / מייל)'], ['ord', 'טיוטת הזמנה מספק'], ['tag', 'תיוג / סיווג הוצאה']];
const permOf = (edit) => ({ t: { task: 'ask', rem: 'ask', msg: 'ask', ord: 'ask', tag: 'ask' }, cap1: 500, capD: 2000, anPct: 30, anMin: 200, edit,
  types: PTYPES.map(([k, l]) => ({ k, l })), lv: [{ k: 'no', l: 'אסור' }, { k: 'ask', l: 'רק אחרי אישור' }, { k: 'auto', l: 'לבד' }],
  lim: { cap1: [0, 100000], capD: [0, 1000000], anPct: [1, 500], anMin: [0, 1000000] } });

async function open(browser, www, edit) {
  const who = 'm';
  const cfg = { mode: 'new', users: { [who]: BIZ }, sa: {}, biz: { [BIZ]: { dataRoot: 'b', features: FEAT, name: 'עסק בדיקה' } },
    admins: { [`b/${BIZ}/|${who}`]: 1 }, staff: { [`b/${BIZ}/|${who}`]: 1 }, ctx: { hasTouch: true, isMobile: true, viewport: { width: 360, height: 740 } } };
  const bodies = [];
  const P = permOf(edit);
  const st = { ok: true, consented: true, setupDone: true, name: 'גיטי', addr: 'f', call: 'נתי', rows: [], mode: 'all', pay: true, emp: true, sens: false, we: 'warn', mirror: true, mirrorAt: null, cfTh: null, pct: 10, saving: '', nt: {}, types: TYPES, unseen: 0, learn: true, brLimited: false, perm: P };
  const msgs = [{ id: 'u1', role: 'u', text: 'תני לעצמך לשלוח הודעות לבד', t: H.T0 - 5000 }, { id: 'a1', role: 'a', text: 'הכנתי כרטיס לשינוי ההרשאה. שום דבר לא ישתנה לפני אישור בכרטיס.', t: H.T0 - 4999, mode: 'perm', src: [],
    cards: [{ k: 'perm', id: 'pm0123456789abcdef', ch: { type: 'msg', lvl: 'auto' }, txt: 'שליחת הודעה (ווצאפ / מייל): רק אחרי אישור ← לבד' }] }];
  const { ctx, page } = await H.newPage(browser, www, cfg, [], who);
  await ctx.route(/:5001\/.*/, async (route) => {
    const n = new URL(route.request().url()).pathname.split('/').pop();
    let body = {}; try { body = JSON.parse(route.request().postData() || '{}').data || {}; } catch (e) { /* */ }
    bodies.push([n, body]);
    const ok = (r) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: r }) });
    if (n === 'secState') return ok(st);
    if (n === 'secChatLoad') return ok({ ok: true, msgs: msgs.slice().reverse() });
    if (n === 'secNotes') return ok({ ok: true, notes: [], unseen: 0, types: TYPES });
    if (n === 'secPrefs' && body.op === 'perm') {
      if (body.type) P.t[body.type] = body.lvl; else P[body.num] = body.v;
      return ok({ ok: true, perm: Object.assign({}, P, { t: Object.assign({}, P.t) }) });
    }
    if (n === 'secPrefs' && body.op === 'permCard') { if (body.st === 'ok') P.t.msg = 'auto'; return ok({ ok: true, st: body.st, perm: Object.assign({}, P, { t: Object.assign({}, P.t) }) }); }
    return ok(n === 'getBackupKey' ? { key: Buffer.alloc(32, 7).toString('base64') } : {});
  });
  await H.login(page, who + '@x.co');
  await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden && ACT.startBlank) ACT.startBlank(); });
  await H.settle(page, 500);
  await page.evaluate(() => go('sec')); await H.settle(page, 1200);
  return { ctx, page, bodies };
}
const last = (bodies, n, f) => bodies.filter((b) => b[0] === n && (!f || f(b[1]))).pop();
const txt = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.innerText : ''; }, sel);
const toSet = async (page) => { await page.evaluate(() => ACT.secSet()); await H.settle(page, 600); };
const small = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((e) => e.offsetParent).map((e) => Math.round(e.getBoundingClientRect().height)).filter((h) => h < 44), sel);
const noHs = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth <= 1);

(async () => {
  const [www, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const browser = await H.launch();
  // ---------- מנהל־העל ----------
  {
    const { ctx, page, bodies } = await open(browser, www, true);
    await toSet(page);
    const t = await txt(page, '#secPermSet');
    check('מנהל־העל: הכרטיס "הרשאות של גיטי" בהגדרות, עם 5 הסוגים', /הרשאות של גיטי/.test(t) && PTYPES.every(([, l]) => t.includes(l)), t.slice(0, 300));
    check('אין סוג תשלום / העברת כסף במסך', !/תשלום|העברת כסף|העברות/.test(t));
    const r = await page.evaluate(() => { const L = [...document.querySelectorAll('#secPermSet input[data-c=permLv]')]; return { n: L.length, dis: L.filter((i) => i.disabled).length, ask: L.filter((i) => i.checked && i.value === 'ask').length }; });
    check('מנהל־העל: 15 מתגי רמה פעילים, ברירת מחדל "רק אחרי אישור" בכולם', r.n === 15 && r.dis === 0 && r.ask === 5, r);
    check('מנהל־העל: שדות התקרה פעילים עם 500 / 2000 וכפתורי שמירה', await page.evaluate(() => { const f = [...document.querySelectorAll('#secPermSet form[data-f=permNumF]')]; const v = f.map((x) => x.v.value); return f.length === 4 && v[0] === '500' && v[1] === '2000' && f.every((x) => !x.v.disabled && x.querySelector('button')); }));
    await page.click('#secPermSet input[data-c=permLv][data-t=msg][value=auto]'); await H.settle(page, 600);
    const b1 = last(bodies, 'secPrefs', (b) => b.op === 'perm' && b.type);
    check('שינוי רמה שולח secPrefs op:perm {type:msg, lvl:auto} והמסך מתעדכן', b1 && b1[1].type === 'msg' && b1[1].lvl === 'auto' && await page.evaluate(() => document.querySelector('#secPermSet input[data-c=permLv][data-t=msg][value=auto]').checked), b1);
    await page.evaluate(() => { const f = document.querySelector('#secPermSet form[data-f=permNumF][data-k=cap1]'); f.v.value = '999999'; });
    await page.click('#secPermSet form[data-f=permNumF][data-k=cap1] button'); await H.settle(page, 400);
    check('תקרה מחוץ לגבולות – לא נשלחת לשרת', !last(bodies, 'secPrefs', (b) => b.op === 'perm' && b.num));
    await page.evaluate(() => { const f = document.querySelector('#secPermSet form[data-f=permNumF][data-k=cap1]'); f.v.value = '1,000'; });
    await page.click('#secPermSet form[data-f=permNumF][data-k=cap1] button'); await H.settle(page, 600);
    const b2 = last(bodies, 'secPrefs', (b) => b.op === 'perm' && b.num);
    check('שמירת תקרה שולחת {num:cap1, v:1000}', b2 && b2[1].num === 'cap1' && b2[1].v === 1000, b2);
    check('מטרות לחיצה במסך ההרשאות – 44px לפחות, בלי גלילה לרוחב', (await small(page, '#secPermSet .chip')).length === 0 && await noHs(page), await small(page, '#secPermSet .chip'));
    if (shots) { await H.settle(page, 3000); await page.evaluate(() => { const e = document.getElementById('secPermSet'); window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - 70); }); await H.settle(page, 300); await page.screenshot({ path: path.join(shots, 'sec15-perm-super-360.png') }); } // צילום אחד, מסך טלפון 360×740
    // כרטיס בשיחה
    await page.evaluate(() => ACT.secSetX()); await H.settle(page, 400);
    // הצ'אט נפתח נקי (15.11.2026) – ההודעה עם הכרטיס מוזרקת כמו תשובה שהגיעה עכשיו מ-secChat
    { await page.evaluate(() => { const X = window.__sec; X.msgs = [{ id: 'a1', role: 'a', text: 'הכנתי כרטיס לשינוי ההרשאה.', t: Date.now(), src: [], cards: [{ k: 'perm', id: 'pm0123456789abcdef', ch: { type: 'msg', lvl: 'auto' }, txt: 'שליחת הודעה (ווצאפ / מייל): רק אחרי אישור ← לבד' }] }]; X.tab = 'chat'; rerender(); }); await H.settle(page, 300); }
    const has = !!(await page.$('[data-card=pm0123456789abcdef] [data-a=permCOk]'));
    check('כרטיס "שינוי הרשאה של גיטי" בשיחה עם אשר / בטל', has && /שינוי הרשאה של גיטי[\s\S]*רק אחרי אישור ← לבד/.test(await txt(page, '[data-card=pm0123456789abcdef]')));
    await page.click('[data-card=pm0123456789abcdef] [data-a=permCOk]'); await H.settle(page, 600);
    const b3 = last(bodies, 'secPrefs', (b) => b.op === 'permCard');
    check('"אשר" שולח secPrefs op:permCard st:ok עם mid ו-cid', b3 && b3[1].st === 'ok' && b3[1].cid === 'pm0123456789abcdef' && !!b3[1].mid, b3);
    check('אחרי האישור: "אושר ✓" בלי כפתורים', /אושר ✓/.test(await txt(page, '[data-card=pm0123456789abcdef]')) && !(await page.$('[data-card=pm0123456789abcdef] button')));
    check('מנהל־העל: בלי שגיאות JS', page.__errors.length === 0, page.__errors);
    await ctx.close();
  }
  // ---------- מנהל רגיל ----------
  {
    const { ctx, page, bodies } = await open(browser, www, false);
    await toSet(page);
    const t = await txt(page, '#secPermSet');
    const r = await page.evaluate(() => { const L = [...document.querySelectorAll('#secPermSet input')]; return { n: L.length, en: L.filter((i) => !i.disabled).length, btn: document.querySelectorAll('#secPermSet form button').length }; });
    check('מנהל רגיל: אותו מסך נעול – כל המתגים והשדות disabled, בלי כפתורי שמירה', r.n === 19 && r.en === 0 && r.btn === 0, r);
    check('מנהל רגיל: הסבר "רק מנהל־העל יכול לשנות"', /רק מנהל־העל יכול לשנות/.test(t));
    await page.evaluate(() => { const i = document.querySelector('#secPermSet input[data-c=permLv][data-t=msg][value=auto]'); i.disabled = false; i.click(); }); await H.settle(page, 400);
    check('מנהל רגיל: גם בעקיפת הנעילה במסך – לא נשלחת בקשה (והשרת דוחה בכל מקרה)', !last(bodies, 'secPrefs', (b) => b.op === 'perm'));
    check('מנהל רגיל: בלי גלילה לרוחב, בלי שגיאות JS', await noHs(page) && page.__errors.length === 0, page.__errors);
    await ctx.close();
  }
  await browser.close();
  console.log(fail ? `נכשלו ${fail}` : 'הכול עבר');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
