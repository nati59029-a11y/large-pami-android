/* AR:INC – הכנסות מחשבוניות (משימה 2026-11-14_הזמנות-לקוח-עסקי-וחשבוניות, שלב 4, החלטות 6 ו-24). קובץ עצמאי, נטען אחרי orders-staff.js.
   היומן נמצא במכשיר המנהל (S), ולכן – רק אצל מנהל, כמו opSync – כל חשבונית מס / חשבונית מס קבלה / זיכוי (ardoc, גם בטיוטה) הופכים לתנועת הכנסה אחת:
   tx.id='ar_'+docId, t:'inc', קטגוריה "הכנסות מהזמנות" (c_ordinc), תת־קטגוריה "חשבוניות", date = תאריך החשבונית, br = סניף ההזמנה. זיכוי = סכום שלילי.
   קבלה לא נרשמת (רק מסמנת תשלום). לא נספר פעמיים:
   - תיקון סבב 1 (ליקוי 3, החלטה 6): הזמנה עם חשבונית נספרת לפי החשבונית (ותאריכה), גם כשהיא שולמה בקישור הספק. תנועת op_<ord> (opSync) נשארת
     כמו שהיא, כי היא גם הזכות אצל הספק (offBal), ולידה נרשמת תנועת קיזוז arop_<ord> בסכום שלילי ובאותו תאריך/סניף, בלי off – כך שההכנסה
     מהקישור מתאפסת והזכות אצל הספק לא משתנה. op_ שבוטל (x) – גם הקיזוז מבוטל. הזמנה בלי חשבונית (ישנה) – נספרת מהקישור, כמו היום.
   - סניף שסומן "מה ששולם בקופה כבר נספר בדוח Z" (arcfg/main.z[br]) – חשבונית מס קבלה ששולמה במזומן / אשראי בקופה לא נרשמת, וגם זיכוי על
     חשבונית מס קבלה באותו סניף (הנחה: ההחזר נעשה בקופה). העברה / צ'ק / אחר – כן נרשמות. תיקון סבב 1 (ליקוי 4): תשלום בקישור או בטלפון
     (pay.via) לא עובר בקופה – נרשם תמיד (הנחה: גם תשלום בטלפון לא מופיע בדוח Z).
   תנועה שכבר לא צריכה להיספר מסומנת t.x=1 (מבוטל, לא נמחקת). בלי "מסמכים פעילים" (arcfg/main.on) – לא נוגעים בכלום. */
(function(){
'use strict';
if(typeof V==='undefined'||!window.__opSync||!window.__arDocs)return;
const AD=window.__arDocs;
const OPC='c_ordinc',SUB='s_ordinv',NB='_';
const TN={inv:'חשבונית מס',ir:'חשבונית מס קבלה',cr:'זיכוי'};
const dec=d=>Object.assign({id:idOf(d)},Object.fromEntries(Object.entries(d.fields||{}).map(([k,v])=>[k,fvj(v)])));
async function runQ(coll,lim,ord){const sq={from:[{collectionId:coll}],limit:lim||500};if(ord)sq.orderBy=[{field:{fieldPath:ord},direction:'DESCENDING'}];
 const r=await fsx(':runQuery',{method:'POST',body:JSON.stringify({structuredQuery:sq})});return(r||[]).filter(x=>x.document).map(x=>dec(x.document))}
// ההגדרות מהמטמון של ar-docs.js (נטענות רק במסכי ההזמנות) – כך שכשהמסמכים כבויים / לא נטענו אין אף בקשה חדשה לשרת
const cfg=()=>AD.R.cfg||{};
function sub(){let c=S.cats.find(x=>x.id===OPC);if(!c){c={id:OPC,kind:'inc',name:'הכנסות מהזמנות',beh:'simple'};S.cats.push(c)}
 let u=S.subs.find(x=>x.id===SUB);if(!u){u={id:SUB,cat:OPC,name:'חשבוניות'};S.subs.push(u)}return u.id}
// הפונקציה הטהורה (גם לבדיקות): האם המסמך נספר כהכנסה, ובאיזה סכום. z = arcfg/main.z. (הפרמטר השני – לא בשימוש מאז תיקון סבב 1; נשאר לתאימות)
// aro = ההזמנה של חשבונית / חשבונית מס קבלה – לפיה מקוזזת ההכנסה מהקישור (arop_)
function incOf(d,op,z){if(!d||!['inv','ir','cr'].includes(d.t)||!Number.isInteger(d.gross))return null;
 const br=d.br||NB,o=(Array.isArray(d.ord)?d.ord:[])[0]||'',zz=z&&z[br]===true,p=d.pay||{};
 if(d.t==='ir'&&zz&&['cash','card'].includes(p.m)&&!p.via)return null;
 // החלטה 31: זיכוי עם החזר כסף – ההחזר עצמו לא נרשם (רק הזיכוי, בסכום שלילי). בסניף "דוח Z": החזר מזומן / אשראי בקופה (בלי via) כבר בדוח Z – לא נרשם;
 // החזר שלא בקופה (העברה, צ׳ק, אחר, או אשראי בקישור / בטלפון) – נרשם. זיכוי בלי החזר – כמו קודם
 if(d.t==='cr'&&zz&&d.rf&&typeof d.rf==='object'){if(['cash','card'].includes(d.rf.m)&&!d.rf.via)return null}
 else if(d.t==='cr'&&zz&&/^ir[DO]/.test(String(d.ref||'')))return null;
 const sn=(d.custSnap&&d.custSnap.name)||'';
 const f={t:'inc',cat:OPC,date:String(d.d||''),amt:Math.round((d.t==='cr'?-d.gross:d.gross))/100,note:`${TN[d.t]} #${d.no}${d.draft?' (טיוטה)':''}${sn?' · '+sn:''}`.slice(0,200),ardoc:d.id};
 if(d.t!=='cr'&&o)f.aro=o;
 if(br!==NB)f.br=br;return f}
// קיזוז ההכנסה מהקישור (טהור, גם לבדיקות): op = תנועת op_<ord> פעילה, inv = תנועת ar_ פעילה של חשבונית ההזמנה → תנועת arop_ (או null)
function offOf(op,inv){if(!op||op.x||!inv||inv.x)return null;
 const f={t:'inc',cat:OPC,date:String(op.date||''),amt:-Math.round((+op.amt||0)*100)/100,note:`${String(op.note||'').slice(0,60)} – נספרה ב${String(inv.note||'').split(' · ')[0]}`.slice(0,200),aro:op.ordp||String(op.id||'').slice(3)};
 if(op.br)f.br=op.br;return f}
let B=0;
async function arInc(){if(B||!isA()||!bzF('orders')||typeof S==='undefined'||!S)return 0;B=1;let n=0;
 try{const c=cfg();if(c.on!==true)return 0;
  try{await window.__opSync()}catch(e){}
  const op=new Set();
  /* 2,000 המסמכים האחרונים (לפי upd) – מסמך ישן יותר כבר נקלט בסנכרון קודם */
  const L=await runQ('ardoc',2000,'upd');
  for(const d of L){const id='ar_'+d.id,t=S.tx.find(x=>x.id===id),f=incOf(d,op,c.z||{});
   if(!f){if(t&&!t.x){t.x=1;n++}continue}
   f.sub=sub();
   if(!t){S.tx.push(Object.assign({id},f));n++}
   else if(t.x||t.amt!==f.amt||t.date!==f.date||t.br!==f.br||t.note!==f.note||t.aro!==f.aro){delete t.x;if(!f.br)delete t.br;Object.assign(t,f);n++}}
  /* קיזוז הקישור – לפי היומן (לא לפי חלון 2,000 המסמכים): לכל op_ פעיל שיש להזמנה שלו חשבונית שנרשמה (ar_ עם aro) */
  const inv=new Map();for(const t of S.tx)if(t&&!t.x&&typeof t.id==='string'&&t.id.indexOf('ar_')===0&&t.aro)inv.set(t.aro,t);
  const AO=new Map(S.tx.filter(t=>t&&typeof t.id==='string'&&t.id.indexOf('arop_')===0).map(t=>[t.id,t]));
  for(const o of S.tx.filter(t=>t&&typeof t.id==='string'&&t.id.indexOf('op_')===0)){const k=o.id.slice(3),id='arop_'+k,t=AO.get(id),f=offOf(o,inv.get(k));
   if(!f){if(t&&!t.x){t.x=1;n++}continue}
   f.sub=sub();
   if(!t){S.tx.push(Object.assign({id},f));n++}
   else if(t.x||t.amt!==f.amt||t.date!==f.date||t.br!==f.br||t.note!==f.note){delete t.x;if(!f.br)delete t.br;Object.assign(t,f);n++}}
  if(n){save();if(typeof typing!=='function'||!typing())rerender()}}catch(e){}finally{B=0}return n}
/* כמו opSync: כשהמנהל בבית או במסכי ההזמנות, פעם בשתי דקות לכל היותר – ורק אחרי שההגדרות נטענו והמסמכים פעילים */
let T=0;const maybe=()=>{if(!(AD.R.cfg&&AD.R.cfg.on===true)||Date.now()-T<120000)return;T=Date.now();arInc()};
for(const k of ['home','ox','oxOrd']){const h=V[k];if(h)V[k]=(...a)=>{const r=h(...a);try{if(AD.R.cfg&&AD.R.cfg.on===true&&isA()&&bzF('orders'))setTimeout(maybe,2500)}catch(e){}return r}}
window.__arInc={arInc,incOf,offOf};
})();
