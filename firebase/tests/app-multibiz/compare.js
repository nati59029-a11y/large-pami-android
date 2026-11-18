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
  /* cfg/zc (סף פער מזומן, #117–#118): אחרי שנכנס ל-main גם main קורא אותו – מסננים משני הצדדים (17.11.2026) */
  const zcT = (r) => r.method === 'GET' && /\/documents\/cfg\/zc$/.test(new URL(r.url).pathname);
  /* סבב 4 (18.11.2026): תבניות משימה בענן – המנהל קורא את רשימת tkt בכניסה לטופס "משימה חדשה" (GET של האוסף, עד 5 דקות). אחרי שנכנס ל-main גם main קורא אותו – מסננים משני הצדדים */
  const tkT = (r) => r.method === 'GET' && /\/documents\/(b\/[^/]+\/)?tkt$/.test(new URL(r.url).pathname);
  /* סבב 3 (קבוצות, #122): אחרי שנכנס ל-main גם main שולח את שאילתת grp של העובד – מסננים משני הצדדים (18.11.2026); בענף נבדקת בחריג הצר למטה */
  const grT = (r) => r.method === 'POST' && /:runQuery$/.test(new URL(r.url).pathname) && /"collectionId":"grp"/.test(r.body || '');
  const A = A0.filter((r) => !ident(r) && !zcT(r) && !tkT(r) && !grT(r));
  const idn = B.filter(ident); let B2 = B.filter((r) => !ident(r));
  /* סבב 2 (17.11.2026): סף פער מזומן משותף – המנהל קורא את cfg/zc (GET בלבד). חריג צר: רק GET של המסמך הזה, לכל היותר פעם אחת למשתמש, ורק אצל מנהל */
  const zcR = B2.filter(zcT); B2 = B2.filter((r) => !zcT(r));
  if (zcR.some((r) => r.who !== 'm@x.co') || new Set(zcR.map((r) => r.who + '|' + r.step)).size !== zcR.length) { console.log('נכשל: קריאת cfg/zc לא צפויה', zcR.map((r) => r.who + '|' + r.step)); fail++; }
  /* סבב 4: חריג צר – רק GET של רשימת tkt (בלי מסמך מסוים), רק אצל מנהל, לכל היותר פעם אחת למשתמש בכל שלב */
  const tkR = B2.filter(tkT); B2 = B2.filter((r) => !tkT(r));
  if (tkR.some((r) => r.who !== 'm@x.co') || new Set(tkR.map((r) => r.who + '|' + r.step)).size !== tkR.length) { console.log('נכשל: קריאת רשימת tkt לא צפויה', tkR.map((r) => r.who + '|' + r.step)); fail++; }
  /* סבב 3 (17.11.2026): קבוצות התכתבות – העובד מושך את רשימת הקבוצות שהוא חבר בהן (runQuery על grp, mem ARRAY_CONTAINS ה-uid שלו). חריג צר: רק השאילתה הזו, רק עם ה-uid של המשתמש עצמו, לכל היותר פעם אחת לשלב */
  const grR = B2.filter(grT); B2 = B2.filter((r) => !grT(r));
  const grOk = (r) => { try { const q = JSON.parse(r.body).structuredQuery; const f = q.where.fieldFilter; return f.field.fieldPath === 'mem' && f.op === 'ARRAY_CONTAINS' && f.value.stringValue === r.who.split('@')[0]; } catch (e) { return false; } };
  if (grR.some((r) => !grOk(r)) || new Set(grR.map((r) => r.who + '|' + r.step)).size !== grR.length) { console.log('נכשל: שאילתת grp לא צפויה', grR.map((r) => r.who + '|' + r.step + '|' + r.body)); fail++; }
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
  /* 12.11 (אחרי המיזוג של #37 ל-main): השאילתות האלה קיימות עכשיו גם ב-main – מוציאים אותן משני הצדדים (מספרן תלוי בזמן) */
  let rpN = 0, rpA = 0; for (let i = B2.length - 1; i >= 0; i--) if (rpQ(B2[i])) { rpN++; B2.splice(i, 1); }
  for (let i = A.length - 1; i >= 0; i--) if (rpQ(A[i])) { rpA++; A.splice(i, 1); }
  console.log(`בקשות/פרטיות – שאילתות על rq ו-ptk: main ${rpA}, ענף ${rpN}`);
  /* תלוי בזמן (14.11.2026, נקודת שמירה 1 של store3d): שאילתת site_income_daily (נשלחת רק אם המנהל כבר מזוהה ברגע הקריאה) ושאילתת fb (מיקומה ברצף משתנה
     לפי תזמון המשיכות ברקע) מופיעות או חסרות, ובסדר שונה, גם בין שתי ריצות של main מול main (הוכח בהרצה כפולה). חריג צר: רק POST :runQuery על שני האוספים האלה,
     מוצאים משני הצדדים (הספירה מודפסת). כל שאר הבקשות – אותו סדר ואותו גוף כמו קודם */
  const tdQ = (r) => { try { return r.method === 'POST' && /:runQuery$/.test(new URL(r.url).pathname) && ['site_income_daily', 'fb'].includes(JSON.parse(r.body).structuredQuery.from[0].collectionId); } catch (e) { return false; } };
  let tdA = 0, tdB = 0; for (let i = B2.length - 1; i >= 0; i--) if (tdQ(B2[i])) { tdB++; B2.splice(i, 1); }
  for (let i = A.length - 1; i >= 0; i--) if (tdQ(A[i])) { tdA++; A.splice(i, 1); }
  console.log(`תלוי בזמן – שאילתות על site_income_daily ו-fb: main ${tdA}, ענף ${tdB}`);
  /* מכשיר אחד (16.11.2026): קריאות devClaim (בכניסה, בפתיחה, בחזרה לאפליקציה) – רק בענף, ומיקומן תלוי בזמן. חריג צר: רק POST לפונקציה devClaim, מוצאות משני הצדדים (הספירה מודפסת) */
  const dcQ = (r) => r.method === 'POST' && /\/devClaim$/.test(new URL(r.url).pathname);
  let dcA = 0, dcB = 0; for (let i = B2.length - 1; i >= 0; i--) if (dcQ(B2[i])) { dcB++; B2.splice(i, 1); }
  for (let i = A.length - 1; i >= 0; i--) if (dcQ(A[i])) { dcA++; A.splice(i, 1); }
  console.log(`מכשיר אחד – קריאות devClaim: main ${dcA}, ענף ${dcB}`);
  /* סנכרון כספית A1 (17.11.2026): המוצרים נטענים בעמודים (orderBy __name__, startAt בעמוד הבא). חריג צר: רק runQuery על prod –
     עמוד ראשון (בלי startAt) שאחרי הסרת orderBy זהה בדיוק לגוף של main מנורמל לגוף של main; עמודי המשך (startAt) – רק בענף, מוצאים */
  const pdQ = (r) => { try { const q = JSON.parse(r.body).structuredQuery; return r.method === 'POST' && /:runQuery$/.test(new URL(r.url).pathname) && q.from[0].collectionId === 'prod' ? q : null; } catch (e) { return null; } };
  let pdN = 0; for (let i = B2.length - 1; i >= 0; i--) { const q = pdQ(B2[i]); if (q && q.startAt) { pdN++; B2.splice(i, 1); } }
  A.forEach((r, i) => { const b = B2[i], qb = b && pdQ(b); if (!qb || !pdQ(r) || r.url !== b.url) return; const o = JSON.parse(b.body); delete o.structuredQuery.orderBy;
    const nb = JSON.stringify({ structuredQuery: { from: o.structuredQuery.from, limit: o.structuredQuery.limit } }); if (nb === r.body) b.body = nb; });
  console.log(`כספית – עמודי המשך של prod: ענף ${pdN}`);
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
