/* POS:M1 – קופה, חיפוש וצירוף לקוח לעגלה (ש1; אפיון ב ס12, ג 3.1). המועדון והכרטיס המלא – גל 3 (pos-club.js).
   PosCust.pick(ctx) → Promise: לקוח {id,name,phone,biz,limit,bal} או null. רק קריאה דרך PosData.searchCust. */
(function(root){
'use strict';
if(typeof document==='undefined')return;
const U=()=>root.PosUI;
function pick(ctx){const{E,fmt}=U();return new Promise(res=>{
 const R=U().UI.root||document.body,w=document.createElement('div');w.className='pos-modal';w.setAttribute('role','dialog');w.setAttribute('aria-modal','true');w.setAttribute('aria-label','בחירת לקוח');R.append(w);U().UI.stack.push(w);
 const done=v=>{if(!w.isConnected)return;w.remove();U().UI.stack=U().UI.stack.filter(x=>x!==w);res(v)};w._close=()=>done(null);let L=[],tok=0;
 w.innerHTML=`<div class="pos-card"><div class="pos-sh"><h2>לקוח</h2><button class="pos-ib" data-pa="x" aria-label="סגירה">✕</button></div>
  <label class="pos-f"><span>שם או טלפון</span><input id="custQ" data-autof autocomplete="off" aria-label="חיפוש לקוח לפי שם או טלפון"></label>
  <div class="pos-rl" id="custL" aria-live="polite"></div>${ctx&&ctx.cur?'<button class="pos-b g w" data-pa="none">הסרת הלקוח מהעגלה</button>':''}</div>`;
 const list=()=>{w.querySelector('#custL').innerHTML=L.length?L.map((c,i)=>`<button class="pos-kv pos-pick" data-pa="c" data-i="${i}" aria-label="${E(c.name)} ${E(c.phone)}"><span>${E(c.name)} <small dir="ltr">${E(c.phone)}${c.biz?' · עסקי':''}</small></span>${c.limit?`<small>הקפה: פנוי ${fmt(c.limit-(c.bal||0))}</small>`:''}</button>`).join(''):'<div class="pos-empty">הקלידו שם או טלפון</div>'};
 w.addEventListener('input',async ev=>{if(ev.target.id!=='custQ')return;const t=++tok,q=ev.target.value;const r=await root.PosData.searchCust(q);if(t===tok){L=r||[];list()}});
 w.addEventListener('click',ev=>{const b=ev.target.closest('[data-pa]');if(!b||!w.contains(b))return;if(b.dataset.pa==='x')return done(null);if(b.dataset.pa==='none')return done(false);if(b.dataset.pa==='c')done(L[+b.dataset.i])});
 list();const f=w.querySelector('[data-autof]');if(f)try{f.focus({preventScroll:true})}catch(e){}})}
root.PosCust={pick};
})(typeof window!=='undefined'?window:globalThis);
