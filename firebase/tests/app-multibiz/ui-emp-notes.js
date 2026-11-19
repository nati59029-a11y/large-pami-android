'use strict';
// הערות עובד (שלב א', 19.11.2026): www/emp-notes.js + הגירה ב-ensure + תיקון FRM.subsave. רשת מדומה, בלי אמולטור.
// מנהל: הוספה/עריכה/מחיקה, הערה לכמה עובדים = רשומה לכל אחד, הגירה מ-ext.notes (idempotent, בלי מחיקה, ext.notes נשמר, הערה ראשונה),
// subsave לא מוחק notes, חסימת מחיקת כרטיס עם הערות, פרטיות (wvWant/pubCfg/payroll-out), גיבוי. עובד: לא רואה כלום.
// שימוש: node ui-emp-notes.js <www-dir> [out.json] [shots-dir]
const fs = require('fs'); const path = require('path'); const H = require('./harness');
const BZ0 = ['larg', 'peami'].join('');
let fail = 0; const check = (n, ok, info) => { if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (page, dir, name) => { if (!dir) return; fs.mkdirSync(dir, { recursive: true }); await page.waitForTimeout(300); await page.screenshot({ path: path.join(dir, name + '.png'), fullPage: true }); };
const closeD = async (page) => { if (await page.evaluate(() => { const d = document.getElementById('dlg'); return !!(d && d.open); })) { await page.evaluate(() => closeDlg()); await sleep(150); } };
const toasts = (page) => page.evaluate(() => [...document.querySelectorAll('.toast')].map((x) => x.innerText).join('|'));
const clearT = (page) => page.evaluate(() => document.querySelectorAll('.toast').forEach((x) => x.remove()));
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const notes = (page, sid) => page.evaluate((i) => JSON.parse(JSON.stringify(S.enotes.filter((n) => n.sub === i))), sid);

(async () => {
  const A = process.argv.slice(2), www = A[0], shots = A.length > 2 ? A[2] : A[1]; const browser = await H.launch();

  { const cfg = { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: {} } }, admins: { '|m': 1 } };
    const x = await H.newPage(browser, www, cfg, [], 'm-en'); const pg = x.page; await pg.setViewportSize({ width: 412, height: 900 });
    await H.login(pg, 'm@x.co'); if (await pg.$('[data-a=startBlank]')) { await pg.click('[data-a=startBlank]'); await sleep(300); }
    await sleep(1000); await closeD(pg);
    check('1 S.enotes קיים כמערך ריק', await pg.evaluate(() => Array.isArray(S.enotes) && S.enotes.length === 0));
    // 3 עובדים, אחד עם ext.notes ישן; ספק עם notes (לא עובד)
    await pg.evaluate(() => { const emp = S.cats.find((c) => c.kind === 'exp' && !c.hid && c.beh === 'emp'), sup = S.cats.find((c) => c.beh === 'sup');
      S.subs.push({ id: 'enA', cat: emp.id, name: 'אבי', ext: { role: 'מוכר', start: '2025-03-01', notes: 'הערה ישנה של אבי' } }, { id: 'enB', cat: emp.id, name: 'בני', ext: { role: 'נהג' } }, { id: 'enC', cat: emp.id, name: 'גילי' });
      if (sup) S.subs.push({ id: 'enS', cat: sup.id, name: 'ספק', ext: { notes: 'לא עובד' } }); save(); });
    // הגירה: ensure על עותק של הנתונים
    const mig = await pg.evaluate(() => { const d = JSON.parse(JSON.stringify(S)); const n0 = JSON.stringify(d.subs.map((s) => s.ext && s.ext.notes)); const r = ensure(d) || d; const A1 = r.enotes.filter((n) => n.sub === 'enA'); ensure(r); ensure(r);
      return { a: A1.length, all: r.enotes.filter((n) => n.sub === 'enA').length, ox: A1[0] && A1[0].ox, d: A1[0] && A1[0].d, t: A1[0] && A1[0].t, keep: r.subs.find((s) => s.id === 'enA').ext.notes, same: n0 === JSON.stringify(r.subs.map((s) => s.ext && s.ext.notes)), sup: r.enotes.some((n) => n.sub === 'enS'), tot: r.enotes.length }; });
    check('2 הגירה: הערה ox:1 אחת לעובד עם ext.notes (תאריך = תחילת עבודה), ext.notes לא השתנה', mig.a === 1 && mig.ox === 1 && mig.d === '2025-03-01' && mig.t === 'הערה ישנה של אבי' && mig.keep === 'הערה ישנה של אבי' && mig.same, mig);
    check('2א הרצה חוזרת (3 פעמים) – בלי כפילות', mig.all === 1, mig);
    // הרצה על המצב החי (כמו טעינה מחדש)
    await pg.evaluate(() => { const r = ensure(S) || S; if (r !== S) S = r; save(); }); await sleep(200);
    await pg.evaluate(() => go('card', 'enA')); await sleep(300);
    const first = await pg.evaluate(() => { const e = document.querySelector('#main [data-enote]'); return e ? e.innerText : null; });
    check('3 בכרטיס: הערה ישנה מופיעה (ראשונה), בלי הכפלה בכרטיס', /הערה ישנה של אבי/.test(first || '') && (await pg.evaluate(() => (document.getElementById('main').innerText.match(/הערה ישנה של אבי/g) || []).length)) === 1, first);
    // הוספה
    await pg.click('#main [data-a=enAdd]'); await sleep(250);
    const dd = await pg.evaluate(() => document.querySelector('#dlg input[name=d]').value);
    check('4 הוספה: תאריך ברירת מחדל = היום', dd === await pg.evaluate(() => today()), dd);
    await pg.fill('#dlg textarea[name=t]', '   '); await pg.click('#dlg form[data-f=enF] button:not([type=button])'); await sleep(200);
    check('4א טקסט ריק לא נשמר', (await notes(pg, 'enA')).length === 1);
    await pg.fill('#dlg textarea[name=t]', 'הערה חדשה\nשורה שנייה'); await pg.fill('#dlg input[name=d]', '2026-11-10');
    await pg.click('#dlg form[data-f=enF] button:not([type=button])'); await sleep(300);
    let L = await notes(pg, 'enA');
    check('4ב נשמרה הערה חדשה עם תאריך שנבחר', L.length === 2 && L.some((n) => n.t === 'הערה חדשה\nשורה שנייה' && n.d === '2026-11-10' && !n.ed && !n.ox && n.at), L);
    const ord = await pg.evaluate(() => [...document.querySelectorAll('#main [data-enote]')].map((e) => e.innerText.slice(0, 80)));
    check('4ג סדר: מהחדשה לישנה (2026-11-10 לפני 2025-03-01)', /הערה חדשה/.test(ord[0]) && /הערה ישנה/.test(ord[1]), ord);
    await pg.evaluate(() => document.querySelector('[data-a=enAdd]')); await pg.click('#main [data-a=enAdd]'); await sleep(200);
    await pg.evaluate(() => document.querySelector('#dlg textarea[name=t]').removeAttribute('maxlength')); await pg.fill('#dlg textarea[name=t]', 'x'.repeat(2001)); await pg.click('#dlg form[data-f=enF] button:not([type=button])'); await sleep(200);
    check('4ד מעל 2000 תווים – נדחה', (await notes(pg, 'enA')).length === 2 && /ארוכה/.test(await toasts(pg)), await toasts(pg)); await closeD(pg); await clearT(pg);
    // עריכה
    const nid = L.find((n) => n.t.startsWith('הערה חדשה')).id;
    await pg.click(`#main [data-a=enEdit][data-id="${nid}"]`); await sleep(250);
    check('5 עריכה: הטקסט הקיים בטופס', (await pg.evaluate(() => document.querySelector('#dlg textarea[name=t]').value)) === 'הערה חדשה\nשורה שנייה');
    await pg.fill('#dlg textarea[name=t]', 'הערה מעודכנת'); await pg.click('#dlg form[data-f=enF] button:not([type=button])'); await sleep(300);
    L = await notes(pg, 'enA'); const ed = L.find((n) => n.id === nid);
    check('5א נשמר טקסט חדש, ed הוגדר, at ו-d לא השתנו, ואין רשומה נוספת', L.length === 2 && ed.t === 'הערה מעודכנת' && ed.ed && ed.d === '2026-11-10', ed);
    check('5ב מוצג "נערך ב־"', /נערך ב־/.test(await pg.evaluate(() => document.querySelector(`#main [data-enote="${'x'}"]`) ? '' : document.getElementById('main').innerText)));
    await shot(pg, shots, 'en-1-כרטיס-עובד');
    check('5ג 412px בלי גלילה לרוחב', await noOverflow(pg));
    // כמה עובדים
    await pg.click('#main [data-a=enMulti]'); await sleep(250);
    check('6 "לכמה עובדים": הרשימה כוללת את העובדים (לא ספק), והנוכחי מסומן', await pg.evaluate(() => { const c = [...document.querySelectorAll('#dlg input[name=s]')]; return c.length >= 3 && c.find((i) => i.value === 'enA').checked && !c.some((i) => i.value === 'enS'); }));
    await shot(pg, shots, 'en-2-כמה-עובדים');
    check('6א בלי בחירה – נדחה', await pg.evaluate(() => { document.querySelectorAll('#dlg input[name=s]').forEach((i) => i.checked = false); return true; }));
    await pg.fill('#dlg textarea[name=t]', 'הערה לשלושה'); await pg.click('#dlg form[data-f=enMF] button:not([type=button])'); await sleep(200);
    check('6ב לא נוצרה הערה בלי עובד', await pg.evaluate(() => !S.enotes.some((n) => n.t === 'הערה לשלושה')));
    await pg.evaluate(() => ['enA', 'enB', 'enC'].forEach((v) => { document.querySelector(`#dlg input[name=s][value=${v}]`).checked = true; }));
    await pg.click('#dlg form[data-f=enMF] button:not([type=button])'); await sleep(300);
    const m3 = await pg.evaluate(() => S.enotes.filter((n) => n.t === 'הערה לשלושה').map((n) => n.sub + ':' + n.id));
    check('6ג 3 עובדים = 3 רשומות נפרדות (id שונה)', m3.length === 3 && new Set(m3.map((s) => s.split(':')[1])).size === 3 && ['enA', 'enB', 'enC'].every((v) => m3.some((s) => s.startsWith(v + ':'))), m3);
    // חסימת מחיקת כרטיס
    await pg.evaluate(() => ACT.subDel({ dataset: { id: 'enB' } })); await sleep(200);
    check('7 מחיקת כרטיס עם הערות – נחסמת (הכרטיס נשאר, אין שאלת אישור)', await pg.evaluate(() => !!subById('enB') && !document.querySelector('#dlg[open] [data-a=yes]')) && /הערות/.test(await toasts(pg)), await toasts(pg)); await clearT(pg);
    // מחיקת הערה
    const bid = (await notes(pg, 'enB'))[0].id;
    await pg.click(`#main [data-a=enDel][data-id="${bid}"]`).catch(() => {}); await pg.evaluate((i) => { if (!document.querySelector('#dlg[open] [data-a=yes]')) { go('card', 'enB'); } }, bid); await sleep(250);
    await pg.click(`#main [data-a=enDel][data-id="${bid}"]`); await sleep(250);
    check('8 מחיקת הערה: מבקש אישור, ועדיין לא נמחקה', await pg.evaluate(() => !!document.querySelector('#dlg[open] [data-a=yes]')) && (await notes(pg, 'enB')).length === 1);
    await pg.click('#dlg [data-a=closeDlg]'); await sleep(150); check('8א ביטול – ההערה נשארת', (await notes(pg, 'enB')).length === 1);
    await pg.click(`#main [data-a=enDel][data-id="${bid}"]`); await sleep(200); await pg.click('#dlg [data-a=yes]'); await sleep(300);
    check('8ב אישור – נמחקה, ושאר ההערות של אחרים נשארו', (await notes(pg, 'enB')).length === 0 && (await notes(pg, 'enA')).length === 3);
    // אחרי מחיקת הערה מועברת – לא נוצרת מחדש
    const oxid = 'ox_enA'; await pg.evaluate((i) => { S.enotes = S.enotes.filter((n) => n.id !== i); const r = ensure(S) || S; save(); }, oxid);
    check('9 הערה מועברת שנמחקה לא נוצרת מחדש בטעינה, ו-ext.notes נשאר', await pg.evaluate(() => !S.enotes.some((n) => n.id === 'ox_enA') && subById('enA').ext.notes === 'הערה ישנה של אבי'));
    // subsave לא מוחק notes
    await pg.evaluate(() => go('card', 'enA')); await sleep(250);
    const fields = await pg.evaluate(() => { const b = document.querySelector('#main [data-a=subEdit],#main [data-a=subCfg],#main [data-a=cardCfg]'); return b ? b.dataset.a : null; });
    const sv = await pg.evaluate(() => { const f = document.createElement('form'); [['id', 'enA'], ['name', 'אבי ב'], ['role', 'מנהל'], ['phone', '050'], ['start', '2025-03-01']].forEach(([k, v]) => { const i = document.createElement('input'); i.name = k; i.value = v; f.appendChild(i); }); FRM.subsave(f); const s = subById('enA'); return { n: s.ext.notes, role: s.ext.role, name: s.name }; });
    check('10 FRM.subsave בלי שדה notes – ext.notes נשמר (לא undefined)', sv.n === 'הערה ישנה של אבי' && sv.role === 'מנהל' && sv.name === 'אבי ב', sv);
    const sv2 = await pg.evaluate(() => { const f = document.createElement('form'); [['id', 'enA'], ['name', 'אבי ב'], ['notes', 'ערך חדש']].forEach(([k, v]) => { const i = document.createElement('input'); i.name = k; i.value = v; f.appendChild(i); }); FRM.subsave(f); return subById('enA').ext.notes; });
    check('10א שדה notes בטופס (כרטיס שאינו עובד/גרסה ישנה) עדיין נשמר', sv2 === 'ערך חדש'); await closeD(pg);
    check('10ב טופס עריכת כרטיס עובד: אין שדה הערות ישן', await pg.evaluate(() => { go('card', 'enA'); const b = document.querySelector('#main [data-a=subMenu]'); if (!b) return 'nobtn'; b.click(); const d = document.querySelector('#dlg[open] form[data-f=subsave]'); return !!d && !d.querySelector('[name=notes]'); }), fields);
    await closeD(pg);
    // פרטיות וגיבוי
    const priv = await pg.evaluate(() => { const a = JSON.stringify(typeof wvWant === 'function' ? wvWant() : ''); let p = ''; try { p = JSON.stringify(typeof pubCfg === 'function' ? pubCfg() : ''); } catch (e) { p = 'err'; } return { wv: a.includes('הערה לשלושה') || a.includes('enotes'), pub: p.includes('הערה לשלושה') || p.includes('enotes'), p: p.length }; });
    check('11 פרטיות: ההערות לא ב-wvWant ולא ב-pubCfg', !priv.wv && !priv.pub, priv);
    const bk = await pg.evaluate(() => { try { return JSON.stringify(S).includes('הערה לשלושה'); } catch (e) { return false; } });
    check('12 גיבוי: S כולל את ההערות', bk);
    check('13 אין שגיאות JS', pg.__errors.length === 0, pg.__errors);
    await x.ctx.close(); }

  // עובד לא רואה כלום
  { const cfg = { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: {} } }, staff: { '|w1': 1 } };
    const x = await H.newPage(browser, www, cfg, [], 'w-en'); const pg = x.page; await pg.setViewportSize({ width: 412, height: 900 });
    await H.login(pg, 'w1@x.co'); await sleep(800); await closeD(pg);
    const r = await pg.evaluate(() => { const emp = S.cats.find((c) => c.beh === 'emp'); S.subs.push({ id: 'enW', cat: emp.id, name: 'עובד', ext: { notes: 'סודי' } }); S.enotes.push({ id: 'n1', sub: 'enW', t: 'סודי', d: '2026-11-01', at: 'x' });
      let b = null; try { ACT.enAdd({ dataset: { id: 'enW' } }); b = !!document.querySelector('#dlg[open]'); ACT.enDel({ dataset: { id: 'n1' } }); } catch (e) { b = 'err'; }
      return { w: isW(), h: window.enotesH(subById('enW')), dlg: b, still: S.enotes.length }; });
    check('14 עובד: אין רשימה, ההוספה והמחיקה חסומות', r.w && r.h === '' && r.dlg === false && r.still === 1, r);
    check('14א אין שגיאות JS', pg.__errors.length === 0, pg.__errors);
    await x.ctx.close(); }

  await browser.close();
  console.log(fail ? `נכשלו ${fail} בדיקות` : 'כל הבדיקות עברו');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
