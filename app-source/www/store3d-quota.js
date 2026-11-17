/* הקמת חנות – שלב 8 (משימה 2026-11-17_תהליך-הקמת-חנות): באנר מכסה אחד משותף. נטען מיד אחרי store3d.js.
   U.qtBanner() מחזיר HTML של באנר (או ''), ומוצג במסכי ההקמה (אשף, צילום החנות, חיתוך, "המערכת מציעה") ובמסך הצילום של סבב.
   שתי מכסות: חודשית לסניף (shelfCheck / mapDraft: usage {n,cap,w80}) והקמה חד-פעמית למפה (s3CapCheck: usage {n,lim,w80}).
   המצב נלמד מתשובות השרת (usage) ומשגיאות מכסה (s3-month-limit / s3-setup-limit); אין קריאה נוספת לשרת. הסף: 80% אזהרה, 100% חסום.
   שמות פעולות חדשים – תחילית s3qt (אין כרגע). */
(function(){
'use strict';
const U=window.S3UI;if(!U||typeof U.fn!=='function')return;
const esc2=U.esc2||(s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
const mo=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')};
const Q={m:null,s:null};
const int=v=>Number.isInteger(v)&&v>=0;
/* חישוב טהור (נבדק): kind 'm' חודשי / 's' הקמה. מחזיר null | {lvl:'warn'|'full', n, lim, txt} */
function calc(kind,st){
 if(!st)return null;
 const n=int(st.n)?st.n:null,lim=int(st.lim)?st.lim:null;
 if(kind==='m'&&st.mo&&st.mo!==mo())return null;       /* חודש חדש = מתאפס */
 const w=kind==='m'?'החודש':'בהקמה';
 if(st.blocked||(n!=null&&lim!=null&&lim>0&&n>=lim)||(lim===0))
  return{lvl:'full',n,lim,txt:`${kind==='m'?'מכסת הבדיקות החכמות של החודש נגמרה':'מכסת הבדיקות החכמות של ההקמה נגמרה'}${n!=null&&lim!=null?` (נוצלו ${n} מתוך ${lim} ${w})`:''}. ${kind==='m'?'התמונות נשמרות בטלפון. פנו למנהל המערכת, או נסו בחודש הבא.':'מנהל המערכת יכול להגדיל את המכסה.'}`};
 if(n!=null&&lim!=null&&lim>0&&n>=0.8*lim)
  return{lvl:'warn',n,lim,txt:`נוצלו ${n} מתוך ${lim} ${w} (80% ומעלה). ${kind==='m'?'':'מנהל המערכת יכול להגדיל את המכסה.'}`.trim()};
 return null}
function learn(r){
 const u=r&&typeof r==='object'?r.usage:null;if(!u||typeof u!=='object')return;
 if(int(u.cap)&&int(u.n))Q.m={n:u.n,lim:u.cap,mo:typeof u.m==='string'&&u.m?u.m:mo(),blocked:false};
 else if(int(u.lim)&&int(u.n))Q.s={n:u.n,lim:u.lim,blocked:false}}
function learnErr(e){
 const c=e&&e.reason;
 if(c==='s3-month-limit')Q.m=Object.assign({},Q.m,{blocked:true,mo:mo()});
 else if(c==='s3-setup-limit')Q.s=Object.assign({},Q.s,{blocked:true})}
const fn0=U.fn;
U.fn=function(){const p=fn0.apply(this,arguments);
 if(p&&typeof p.then==='function')p.then(learn,learnErr).catch(()=>{});return p};
const one=(kind)=>{const c=calc(kind,Q[kind]);if(!c)return '';
 return `<div class="ban s3warn s3qt" role="${c.lvl==='full'?'alert':'status'}" data-q="${kind}${c.lvl}">${c.lvl==='full'?'<b>נחסם: </b>':''}${esc2(c.txt)}</div>`};
/* kind: 'm' | 's' | undefined (שניהם) */
U.qtBanner=kind=>kind?one(kind):one('s')+one('m');
U.qtCalc=calc;U.qtLearn=learn;U.qtLearnErr=learnErr;U.qtReset=()=>{Q.m=null;Q.s=null};U.qtState=()=>Q;
const CSS=document.createElement('style');CSS.textContent='.s3qt{overflow-wrap:anywhere;margin:6px 0}';document.head.appendChild(CSS);
})();
