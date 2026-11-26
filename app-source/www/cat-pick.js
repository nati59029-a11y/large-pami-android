/* CAT:PICK – בחירת קטגוריה למוצר (26.11.2026, בקשת בעל העסק): בכל מקום שמכניסים מוצר חדש – קטגוריה חובה, תת קטגוריה רשות,
   ובכל מקום אפשר לפתוח קטגוריה / תת קטגוריה חדשה בלי לצאת מהטופס. קובץ עצמאי, נטען לפני orders-staff.js.
   משמש: טופס המוצר במלאי (orders-staff.js – גם מהמדבקות, lbl-print.js), תמחור חשבונית (pricing.js), מוצרים בקופה (pos-admin-products.js).
   שימוש:
     CatPick.reg(key, { cats: () => [מערך הקטגוריות {id,name,parent}], set: (cat, sub) => {} (רשות), can: () => true/false (רשות – מותר לפתוח חדשה) })
     CatPick.h(key, cat, sub, opt) – ה-HTML: שתי בחירות (name="cat" / name="sub" כשבטופס), ושורה לשם קטגוריה חדשה שנפתחת לפי צורך.
       opt.nm = false – בלי name (תמחור: הערכים נשמרים דרך set ולא דרך הטופס). opt.req = false – בלי סימון חובה.
     CatPick.val(form) – { cat, sub } מהטופס (בלי "חדשה…"); cat ריק = לא נבחרה.
     CatPick.norm(cats, cat, sub) – מוצר שהקטגוריה שלו היא תת קטגוריה (מהקופה) → { cat: הראשית, sub: התת }.
   יצירה: saveCat בשרת (מנהל, או עובד שמורשה להוסיף מוצרים). קטגוריה באותו שם שכבר קיימת – נבחרת הקיימת. */
(function(){
'use strict';
const NEW='__new';
const R={};
const e_=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const srt=L=>L.slice().sort((a,b)=>(a.ord||0)-(b.ord||0)||String(a.name||'').localeCompare(String(b.name||''),'he'));
const L_=k=>{try{const r=R[k];const v=r&&r.cats&&r.cats();return Array.isArray(v)?v:[]}catch(e){return[]}};
const tops=k=>srt(L_(k).filter(c=>c&&!c.parent));
const subs=(k,id)=>id?srt(L_(k).filter(c=>c&&c.parent===id)):[];
const canNew=k=>{const r=R[k];try{return!r||!r.can||!!r.can()}catch(e){return false}};
function norm(cats,cat,sub){cat=cat||'';sub=sub||'';const L=Array.isArray(cats)?cats:[];const c=L.find(x=>x&&x.id===cat);
 if(c&&c.parent){if(!sub)sub=c.id;cat=c.parent}
 if(sub){const u=L.find(x=>x&&x.id===sub);if(!u||u.parent!==cat)sub=''}
 return{cat,sub}}
/* הגוף (בלי המעטפת) – מצויר מחדש אחרי בחירה / יצירה */
function body(k,cat,sub,opt){opt=opt||{};const nm=opt.nm!==false,req=opt.req!==false,cn=canNew(k),T=tops(k),S=subs(k,cat);
 const nC=nm?' name="cat"':'',nS=nm?' name="sub"':'';
 const cs=`<label class="f grow"><span>קטגוריה${req?' *':''}</span><select data-c="cpCat"${nC}${req?' required':''}><option value="">בחרו קטגוריה…</option>${T.map(x=>`<option value="${e_(x.id)}"${x.id===cat?' selected':''}>${e_(x.name)}</option>`).join('')}${cn?`<option value="${NEW}">＋ קטגוריה חדשה…</option>`:''}</select></label>`;
 const ss=`<label class="f grow"><span>תת קטגוריה (רשות)</span><select data-c="cpSub"${nS}${cat?'':' disabled'}><option value="">${cat?'ללא':'בחרו קודם קטגוריה'}</option>${S.map(x=>`<option value="${e_(x.id)}"${x.id===sub?' selected':''}>${e_(x.name)}</option>`).join('')}${cn&&cat?`<option value="${NEW}">＋ תת קטגוריה חדשה…</option>`:''}</select></label>`;
 const nw=`<div class="row cpn" style="display:none;align-items:flex-end"><label class="f grow"><span data-cpl>שם הקטגוריה החדשה</span><input data-cpn maxlength="40" autocomplete="off"></label><button type="button" class="btn s" style="margin-bottom:12px;min-height:44px" data-a="cpAdd">הוסף</button><button type="button" class="btn s g" style="margin-bottom:12px;min-height:44px" data-a="cpNo">ביטול</button></div>`;
 return`<div class="row">${cs}${ss}</div>${nw}`}
function h(k,cat,sub,opt){const n=norm(L_(k),cat,sub);return`<div class="cpk" data-cpk="${e_(k)}" data-pc="${e_(n.cat)}" data-ps="${e_(n.sub)}" data-o="${e_(JSON.stringify(opt||{}))}">${body(k,n.cat,n.sub,opt)}</div>`}
const box=el=>el&&el.closest('.cpk');
const optOf=b=>{try{return JSON.parse(b.dataset.o||'{}')}catch(e){return{}}};
const selOf=b=>({c:b.querySelector('select[data-c=cpCat]'),s:b.querySelector('select[data-c=cpSub]')});
const cur=b=>{const x=selOf(b);const c=x.c&&x.c.value!==NEW?x.c.value:'',s=x.s&&x.s.value!==NEW?x.s.value:'';return{cat:c,sub:c?s:''}};
function draw(b,cat,sub){const k=b.dataset.cpk;b.dataset.pc=cat||'';b.dataset.ps=sub||'';b.innerHTML=body(k,cat,sub,optOf(b));tell(b)}
function tell(b){const r=R[b.dataset.cpk];if(r&&r.set){const v=cur(b);try{r.set(v.cat,v.sub,b)}catch(e){}}}
function openNew(b,isSub){const row=b.querySelector('.cpn');if(!row)return;row.style.display='';row.dataset.sub=isSub?'1':'';
 const c=selOf(b).c,l=row.querySelector('[data-cpl]');if(l)l.textContent=isSub?'שם תת הקטגוריה החדשה'+(c&&c.selectedOptions[0]?' ב'+c.selectedOptions[0].textContent:''):'שם הקטגוריה החדשה';
 const i=row.querySelector('[data-cpn]');if(i){i.value='';try{i.focus()}catch(e){}}}
if(typeof CHG!=='undefined'){
 CHG.cpCat=el=>{const b=box(el);if(!b)return;if(el.value===NEW){el.value=b.dataset.pc||'';openNew(b,false);return}draw(b,el.value,'')};
 CHG.cpSub=el=>{const b=box(el);if(!b)return;if(el.value===NEW){el.value=b.dataset.ps||'';openNew(b,true);return}b.dataset.ps=el.value;tell(b)};
}
if(typeof ACT!=='undefined'){
 ACT.cpNo=el=>{const b=box(el);const row=b&&b.querySelector('.cpn');if(row)row.style.display='none'};
 ACT.cpAdd=async el=>{const b=box(el);if(!b)return;const k=b.dataset.cpk,row=b.querySelector('.cpn'),i=row&&row.querySelector('[data-cpn]');
  const name=String(i&&i.value||'').replace(/\s+/g,' ').trim();if(!name){if(typeof toast==='function')toast('כתבו שם');return}
  const isSub=row.dataset.sub==='1',parent=isSub?cur(b).cat:'';if(isSub&&!parent){if(typeof toast==='function')toast('בחרו קודם קטגוריה');return}
  const L=L_(k),ex=L.find(x=>x&&String(x.name||'').trim()===name&&(x.parent||'')===parent);
  let id=ex&&ex.id;
  if(!id){el.disabled=true;try{const r=await window.fnCall('saveCat',Object.assign({name},parent?{parent}:{}));id=r&&r.id;
    if(!id)throw new Error('השמירה נכשלה');if(!L.some(x=>x&&x.id===id))L.push(Object.assign({id,name,ord:0},parent?{parent}:{}));
    if(typeof toast==='function')toast((isSub?'נוספה תת קטגוריה: ':'נוספה קטגוריה: ')+name)}
   catch(e){el.disabled=false;if(typeof err==='function')err(e);else if(typeof toast==='function')toast(e&&e.message||'השמירה נכשלה');return}
   try{const r=R[k];if(r&&r.added)r.added()}catch(e){}}
  if(isSub)draw(b,parent,id);else draw(b,id,'')};
}
/* Enter בשדה השם = "הוסף" (ולא שליחת הטופס כולו) */
document.addEventListener('keydown',e=>{const t=e.target;if(e.key!=='Enter'||!t||!t.matches||!t.matches('[data-cpn]'))return;e.preventDefault();const b=box(t),a=b&&b.querySelector('[data-a=cpAdd]');if(a&&typeof ACT!=='undefined'&&ACT.cpAdd)ACT.cpAdd(a)},true);
function val(f){const c=f&&f.querySelector('.cpk select[data-c=cpCat]'),s=f&&f.querySelector('.cpk select[data-c=cpSub]');
 const cat=c&&c.value!==NEW?c.value:'',sub=s&&s.value!==NEW&&cat?s.value:'';return{cat,sub}}
window.CatPick={reg:(k,o)=>{R[k]=o||{}},h,val,norm,NEW};
})();
