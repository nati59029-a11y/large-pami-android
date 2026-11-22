/* כרטיס משכורת אוטומטי לעובד (21.11.2026, בקשת בעל העסק).
   כשעובד נוסף לאפליקציה (מסך "עובדים") – נפתח לו לבד כרטיס בקטגוריית העובדים (beh='emp'), עם השם והסניף בלבד.
   גם עובדים קיימים עם משתמש באפליקציה ובלי כרטיס מקבלים כרטיס.
   רץ רק במכשיר המנהל (PayUI.on, מבנה חדש, לא מנהל־על) – שם נשמרים נתוני השכר.
   הקישור נשמר ב-ext.suid (שדה חדש, רשות). pay לא נוצר – הגדרות השכר ממולאות ידנית, והמשתמש מוצע מראש במסך "הגדרות שכר".
   לא נוצר כפל: מדלגים אם יש כרטיס (גם מושבת) עם pay.uid / ext.suid של העובד; כרטיס קיים באותו שם בלי קישור – רק מקבל את הקישור.
   עובד שכבר טופל נרשם ב-localStorage, כך שכרטיס שנמחק ביד לא נפתח מחדש. מנהלים ועובדים מושבתים – לא. */
(function(){
'use strict';
if(typeof ACT==='undefined'||typeof S==='undefined')return;
let K='lp-acard';try{K=LK('lp-acard')}catch(e){}
const done=()=>{try{const a=JSON.parse(localStorage.getItem(K)||'[]');return Array.isArray(a)?a:[]}catch(e){return[]}};
const mark=L=>{try{localStorage.setItem(K,JSON.stringify(L.slice(-500)))}catch(e){}};
const ok=()=>{try{return!!window.PayUI&&PayUI.on()&&!SY.sa&&bzB()&&!(typeof bzSus==="function"&&bzSus())&&typeof admStaffOk==='function'&&admStaffOk()}catch(e){return false}};
const nm=u=>String(u.name||String(u.email||'').split('@')[0]||'').trim().slice(0,60);
function run(){if(!ok()||typeof ADM==='undefined'||!Array.isArray(ADM.staff))return;
 const C=(S.cats||[]).filter(c=>c&&c.beh==='emp'&&!c.off);if(!C.length)return;
 const cid=new Set(C.map(c=>c.id)),E=S.subs.filter(s=>s&&cid.has(s.cat)),D=done();let ch=0,n=0;
 ADM.staff.forEach(u=>{if(!u||!u.uid||u.role==='manager'||u.uid===SY.uid||!u.active||D.includes(u.uid))return;
  const name=nm(u);if(!name)return;D.push(u.uid);ch=1;
  if(E.some(s=>(s.pay&&s.pay.uid===u.uid)||(s.ext&&s.ext.suid===u.uid)))return;
  const br=Array.isArray(u.br)&&u.br.length===1?String(u.br[0]):'';
  const same=E.find(s=>!s.off&&String(s.name||'').trim()===name&&!(s.pay&&s.pay.uid)&&!(s.ext&&s.ext.suid));
  if(same){same.ext=Object.assign({},same.ext||{},{suid:u.uid},br&&!(same.ext&&same.ext.br)?{br}:{});return}
  const s={id:uid(),cat:C[0].id,name,ext:Object.assign({suid:u.uid},br?{br}:{})};S.subs.push(s);E.push(s);n++});
 if(!ch)return;mark(D);try{save()}catch(e){}if(n){try{toast(n===1?'נפתח כרטיס משכורת לעובד החדש':'נפתחו '+n+' כרטיסי משכורת לעובדים');rerender()}catch(e){}}}
/* אחרי כל טעינה של רשימת העובדים */
if(typeof window.admStaffLoad==='function'){const L0=window.admStaffLoad;window.admStaffLoad=async function(){const r=await L0.apply(this,arguments);try{run()}catch(e){}return r}}
/* בפתיחת האפליקציה – טעינה שקטה של הרשימה במכשיר המנהל */
setTimeout(()=>{try{if(!ok())return;if(ADM.staff)run();else if(!ADM.sbusy)window.admStaffLoad()}catch(e){}},9000);
window.empAutoCard=run;
})();
