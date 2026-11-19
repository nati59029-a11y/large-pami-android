/* סנכרון ספקים (19.11.2026, בקשת בעל העסק: "כל ספק שנרשם באחד המקומות יופיע בכל המקומות").
   הרשימה הראשית = כרטסת הספקים (כרטיסים בקטגוריות הוצאה מסוג ספק, S.subs). מקורות נוספים לשמות ספקים:
     • המלאי – prod.sup בקטלוג (window.__ox.P), • "להזמין מספקים" – supord.sup (window.__so.L), • החוסרים – hsr.supN וסימון "הוזמן" (hs.js קורא ל-supSync).
   אצל המנהל בלבד (רק הוא כותב את הכרטסת): ספק בלי כרטיס (לפי שם מנורמל או כינוי) מקבל כרטיס חדש בקטגוריה "ספקים"
   (החלטת בעל העסק: אוטומטית), ואז הרשימה מתפרסמת לעובדים אוטומטית (pubCfg). לא משנים ולא מוחקים כרטיס קיים; כרטיס מושבת (off) לא נוצר מחדש.
   מזהה הכרטיס החדש = HsCore.nameId(שם) כשהוא פנוי – אותו מזהה שהחוסרים נותנים לספק לפי שם, כך שפריטים שכבר נרשמו מתחברים לכרטיס.
   window.supCatNames() – שמות הספקים מהמלאי (לכל משתמש, לרשימות הבחירה). window.supAll() – כל השמות (כרטסת + מלאי). */
(function(){'use strict';
if(typeof S==='undefined'||typeof isA!=='function'||typeof uid!=='function')return;
const K=v=>String(v||'').replace(/["'׳״`’]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
const nm=v=>String(v||'').replace(/\s+/g,' ').trim().slice(0,60);
const okName=n=>n.length>=2&&/[A-Za-zא-ת]/.test(n);
/* שמות ספקים מהמלאי – נשמר לפי הפניה לרשימת המוצרים (לא סורקים 9,000 מוצרים בכל ציור) */
let cP=null,cN=[];
function supCatNames(){try{const P=window.__ox&&Array.isArray(window.__ox.P)?window.__ox.P:null;if(!P)return cN;if(P!==cP){cP=P;const m=new Map();P.forEach(p=>{const n=nm(p&&p.sup);if(okName(n)&&!m.has(K(n)))m.set(K(n),n)});cN=[...m.values()]}}catch(e){}return cN}
window.supCatNames=supCatNames;
function ledger(){const L=[];try{if(typeof isW==='function'&&isW()){if(typeof wkSubsAll==='function')wkSubsAll().forEach(s=>L.push(s))}
 else{const ids=new Set((S.cats||[]).filter(c=>c.kind==='exp'&&c.beh==='sup').map(c=>c.id));(S.subs||[]).forEach(s=>{if(s&&ids.has(s.cat))L.push(s)})}}catch(e){}return L}
window.supAll=()=>{const m=new Map();ledger().filter(s=>!s.off).concat(supCatNames().map(name=>({name}))).forEach(s=>{const n=nm(s.name);if(n&&!m.has(K(n)))m.set(K(n),n)});return [...m.values()].sort((a,b)=>a.localeCompare(b,'he'))};
/* רשימת בחירה (datalist) לשדה ספק חופשי */
window.supDL=id=>`<datalist id="${esc(id)}">${window.supAll().map(n=>`<option value="${esc(n)}">`).join('')}</datalist>`;
/* קטגוריית היעד: "ספקים" (e_sup) אם פעילה, אחרת קטגוריית ספקים הפעילה הראשונה */
function target(){const C=(S.cats||[]).filter(c=>c.kind==='exp'&&c.beh==='sup'&&!c.hid&&!c.off);return C.find(c=>c.id==='e_sup')||C[0]||null}
const MAXRUN=100;
/* supSync(names) → מספר הכרטיסים שנוצרו. רק מנהל. */
function supSync(names){try{if(!isA()||!Array.isArray(S.subs))return 0;const c=target();if(!c)return 0;
 const have=new Set();ledger().forEach(s=>{have.add(K(s.name));(Array.isArray(s.al)?s.al:[]).forEach(a=>have.add(K(a)))});
 const used=new Set(S.subs.map(s=>s.id)),add=[];
 (Array.isArray(names)?names:[]).forEach(v=>{const n=nm(v),k=K(n);if(!okName(n)||have.has(k)||add.length>=MAXRUN)return;have.add(k);
  let id=window.HsCore&&HsCore.nameId?HsCore.nameId(n):'';if(!id||used.has(id))id=uid();used.add(id);add.push({id,cat:c.id,name:n})});
 if(!add.length)return 0;
 add.forEach(s=>S.subs.push(s));save();
 try{pubCfg().catch(()=>{})}catch(e){}
 toast(add.length===1?'נוסף לכרטסת הספקים: '+add[0].name:'נוספו '+add.length+' ספקים חדשים לכרטסת הספקים');
 return add.length}catch(e){return 0}}
window.supSync=supSync;
/* בדיקה תקופתית אצל המנהל: כשרשימת המוצרים או "להזמין מספקים" נטענה מחדש (הפניה חדשה) – משלימים כרטיסים חסרים */
let pP=null,pS=null;
setInterval(()=>{try{if(!isA())return;const P=window.__ox&&window.__ox.P,O=window.__so&&window.__so.L;
 if(P&&P!==pP&&!(window.__ox&&window.__ox.pMore)){pP=P;supSync(supCatNames())}
 if(Array.isArray(O)&&O!==pS){pS=O;supSync(O.map(x=>x&&x.sup))}}catch(e){}},15000);
})();
