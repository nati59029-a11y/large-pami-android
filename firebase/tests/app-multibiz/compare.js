'use strict';
// השוואה: main מול הענף במצב legacy, ובדיקת גבולות במצב b.
// node compare.js legacy <main.json> <branch.json>   |   node compare.js b <branch-b.json>
const fs = require('fs');
const [mode, a, b] = process.argv.slice(2);
const load = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const DOCS = '/databases/(default)/documents';
const ident = (r) => r.method === 'GET' && /\/documents\/(users|superadmins|b)\/[^/?]+$/.test(new URL(r.url).pathname);
const key = (r) => [r.who, r.step, r.method, r.url, r.body].join(' | ');
/* שדרוג משימות (feature/tasks-upgrade): שאילתת tasks בענף בוחרת שדות נוספים (to, ow, np, rd...). חריג צר ומכוון:
   ב-runQuery על tasks בלבד – הענף חייב לבחור את כל שדות main (ועוד), וכל שאר הגוף זהה. אחרי ההשוואה הגוף מנורמל לשדות של main */
const tkSel = (r) => { try { const q = JSON.parse(r.body).structuredQuery; return q && q.from && q.from[0] && q.from[0].collectionId === 'tasks' && q.select ? q : null; } catch (e) { return null; } };
const tkNorm = (am, br) => { if (!am || !br || am.url !== br.url || am.method !== br.method) return; const qa = tkSel(am), qb = tkSel(br); if (!qa || !qb) return;
  const fa = qa.select.fields.map((f) => f.fieldPath), fb = qb.select.fields.map((f) => f.fieldPath);
  if (!fa.every((f) => fb.includes(f))) return; const o = JSON.parse(br.body); o.structuredQuery.select.fields = qa.select.fields; const nb = JSON.stringify(o);
  if (nb === am.body) br.body = nb; };
let fail = 0;
if (mode === 'legacy') {
  const A0 = load(a).requests; const B = load(b).requests;
  /* main כבר כולל את קריאות הזיהוי (אחרי המיזוג של ריבוי עסקים), לכן מסננים אותן משני הצדדים */
  const A = A0.filter((r) => !ident(r));
  const idn = B.filter(ident); const B2 = B.filter((r) => !ident(r));
  console.log(`main: ${A0.length} בקשות (${A.length} בלי זיהוי); ענף: ${B.length} (מתוכן ${idn.length} קריאות זיהוי חדשות: ${[...new Set(idn.map((r) => new URL(r.url).pathname.split('/documents/')[1].replace(/\/[^/]+$/, '/{x}')))].join(', ')})`);
  if (idn.some((r) => r.method !== 'GET')) { console.log('נכשל: קריאת זיהוי שאינה GET'); fail++; }
  /* הגעה מיידית (feature/inbox-live, 11.11.2026): אצל מנהל, inbox (status==new) ו-mq (st==new) נמשכים גם 3 שניות אחרי הפתיחה, כל 20 שניות ובחזרה לאפליקציה,
     כך שמספרן ומיקומן ברצף תלויים בזמן. חריג צר ומכוון: רק שתי השאילתות האלה (runQuery, POST, אותו גוף בדיוק) מוצאות משני הצדדים לפני ההשוואה,
     והענף חייב לכלול לפחות כמה שיש ב-main מכל אחת. כל שאר הבקשות – אותו סדר ואותו גוף כמו קודם */
  const lvQ = { inb: '{"structuredQuery":{"from":[{"collectionId":"inbox"}],"where":{"fieldFilter":{"field":{"fieldPath":"status"},"op":"EQUAL","value":{"stringValue":"new"}}},"limit":300}}',
    mq: '{"structuredQuery":{"from":[{"collectionId":"mq"}],"select":{"fields":[{"fieldPath":"uid"},{"fieldPath":"by"},{"fieldPath":"t"},{"fieldPath":"st"},{"fieldPath":"k"},{"fieldPath":"np"},{"fieldPath":"stAt"}]},"where":{"fieldFilter":{"field":{"fieldPath":"st"},"op":"EQUAL","value":{"stringValue":"new"}}},"limit":200}}' };
  const lvK = (r) => (r.method === 'POST' && /:runQuery$/.test(new URL(r.url).pathname) ? Object.keys(lvQ).find((k) => lvQ[k] === r.body) : undefined);
  for (const k of Object.keys(lvQ)) { const na = A.filter((r) => lvK(r) === k).length, nb = B2.filter((r) => lvK(r) === k).length; console.log(`הגעה מיידית – שאילתת ${k}: main ${na}, ענף ${nb}`); if (nb < na) { console.log('נכשל: בענף פחות שאילתות ' + k + ' מאשר ב-main'); fail++; } }
  for (const L of [A, B2]) for (let i = L.length - 1; i >= 0; i--) if (lvK(L[i])) L.splice(i, 1);
  /* משימות פרטיות, בקשות למנהל (feature/recurring-private-requests, 12.11.2026): שאילתות runQuery חדשות על האוספים rq ו-ptk (בקשות עובד/מנהל, משימות פרטיות, נמשכות עם tkLoad ו-inbTick).
     חריג צר ומכוון: רק POST :runQuery שהאוסף שלו rq או ptk, רק בענף (ב-main אין אוספים כאלה). כל שאר הבקשות – אותו סדר ואותו גוף */
  const rpQ = (r) => { try { return r.method === 'POST' && /:runQuery$/.test(new URL(r.url).pathname) && ['rq', 'ptk'].includes(JSON.parse(r.body).structuredQuery.from[0].collectionId); } catch (e) { return false; } };
  let rpN = 0; for (let i = B2.length - 1; i >= 0; i--) if (rpQ(B2[i])) { rpN++; B2.splice(i, 1); }
  console.log(`בקשות/פרטיות – שאילתות חדשות על rq ו-ptk בענף בלבד: ${rpN}`);
  A.forEach((r, i) => tkNorm(r, B2[i]));
  const seqEq = A.length === B2.length && A.every((r, i) => key(r) === key(B2[i]));
  console.log('אותו סדר, אותה שיטה, אותה כתובת ואותו גוף (בלי קריאות הזיהוי):', seqEq ? 'כן' : 'לא');
  if (!seqEq) { fail++; const n = Math.max(A.length, B2.length); for (let i = 0; i < n; i++) if (!A[i] || !B2[i] || key(A[i]) !== key(B2[i])) { console.log('הבדל ראשון', i, '\n main  :', A[i] && key(A[i]).slice(0, 400), '\n branch:', B2[i] && key(B2[i]).slice(0, 400)); break; } }
} else {
  const D = load(a); const R = D.requests;
  const bizOf = (who) => (/acme|^.a@/.test(who) ? 'acme' : 'beta');
  let n = 0;
  for (const r of R) {
    const u = new URL(r.url); const biz = bizOf(r.who); let ok = true; let why = '';
    if (u.port === '8080') {
      n++;
      const p = decodeURIComponent(u.pathname); const i = p.indexOf(DOCS); const rest = p.slice(i + DOCS.length);
      if (rest === ':commit' || rest === ':batchGet') {
        const names = JSON.stringify(JSON.parse(r.body)).match(/projects\/[^"]*?\/documents\/[^"]*/g) || [];
        ok = names.length > 0 && names.every((x) => x.includes(`/documents/b/${biz}/`)); why = 'שם מסמך בגוף מחוץ לעסק';
      } else if (ident(r)) {
        ok = rest === `/b/${biz}` || /^\/(users|superadmins)\/[^/]+$/.test(rest); why = 'קריאת זיהוי לא צפויה';
      } else { ok = rest.startsWith(`/b/${biz}/`) || rest === `/b/${biz}:runQuery`; why = 'נתיב מחוץ ל-b/' + biz; }
    } else if (u.port === '9199') {
      const pre = u.searchParams.get('prefix') || decodeURIComponent(u.pathname.split('/o/')[1] || '');
      ok = pre.startsWith(`b/${biz}/`) || pre.startsWith('app_releases/'); why = 'Storage מחוץ לעסק';
    }
    if (!ok) { fail++; console.log('נכשל:', why, '|', r.who, r.step, r.method, r.url, r.body.slice(0, 200)); }
  }
  console.log(`מצב b: נבדקו ${n} בקשות Firestore ו-${R.filter((r) => new URL(r.url).port === '9199').length} בקשות Storage, בשני עסקים. חריגות: ${fail}`);
  console.log('נתיב הגיבוי:', JSON.stringify(D.abkDir));
}
console.log(fail ? 'תוצאה: נכשל' : 'תוצאה: עבר'); process.exit(fail ? 1 : 0);
