/* POS:M1 – קופה, מסך לקוח. מציג ללקוח את הפריטים האחרונים, הסכום לתשלום, היתרה והעודף.
   pos-sale.js קורא ל-PosCustomer.update(state) אחרי כל שינוי. התצוגה:
   - בתוך הקופה: פאנל (#posCust) – במסך רחב עמודה שלישית, בטלפון מסך מלא שאפשר להפנות ללקוח (נגיעה סוגרת).
   - מסך שני (בעתיד): כל מצב נשלח גם ב-BroadcastChannel('lp-pos-customer'), כך שחלון/מכשיר תצוגה יוכל להאזין בלי שינוי בקופה.
   state: {scr:'idle'|'sale'|'pay'|'done', lines:[{name,qty,price}], total, items, paid, remaining, change, kind}. סכומים באגורות.
   צבעים – רק משתני הערכה (pos.css). */
(function(root){
'use strict';
let el=null,shown=false,last={scr:'idle'},bc=null;
try{if(typeof document!=='undefined'&&typeof BroadcastChannel!=='undefined')bc=new BroadcastChannel('lp-pos-customer')}catch(e){bc=null}
const F=a=>root.PosUI?root.PosUI.fmt(a):'₪'+(a/100).toFixed(2);
const E=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function html(s){
 if(s.scr==='done')return`<div class="pc-big pc-ok"><small>${s.kind==='ret'?'ההחזרה בוצעה':'תודה רבה!'}</small>${s.change?`<span>עודף</span><b>${F(s.change)}</b>`:`<b>${F(s.total)}</b>`}</div>`;
 if(s.scr==='idle')return`<div class="pc-big"><small>ברוכים הבאים</small><b class="pc-w">לארג' פעמי</b></div>`;
 const L=(s.lines||[]).slice(-6);
 return`<div class="pc-lines">${L.map(l=>`<div class="pc-l"><span>${E(l.name)}${l.qty!==1?` <small>× ${l.qty}</small>`:''}</span><b>${F(l.tot!=null?l.tot:Math.round(l.price*l.qty))}</b></div>`).join('')}</div>
 <div class="pc-big"><small>${s.scr==='pay'?'לתשלום':'סה"כ'}</small><b id="pcTotal">${F(s.total)}</b></div>
 ${s.scr==='pay'&&s.paid?`<div class="pc-kv"><span>שולם</span><b>${F(s.paid)}</b></div>${s.remaining?`<div class="pc-kv"><span>נותר</span><b>${F(s.remaining)}</b></div>`:''}${s.change?`<div class="pc-kv pc-ok"><span>עודף</span><b>${F(s.change)}</b></div>`:''}`:''}`}
function paint(){if(el&&shown)el.innerHTML=`<div class="pc">${html(last)}</div>`}
const API={
 mount(node){el=node||null;if(el){el.hidden=!shown;el.onclick=()=>{if(!(root.matchMedia&&root.matchMedia('(min-width: 1100px)').matches))API.toggle(false)}}paint()},
 unmount(){el=null},
 update(s){last=s||{scr:'idle'};paint();try{bc&&bc.postMessage(last)}catch(e){}},
 toggle(v){shown=typeof v==='boolean'?v:!shown;if(el){el.hidden=!shown;const r=el.closest('.pos-app');if(r)r.classList.toggle('pc-on',shown)}paint();
  try{const b=document.querySelector('#pos [data-pa=custT]');if(b)b.setAttribute('aria-pressed',String(shown))}catch(e){}},
 shown:()=>shown,
 state:()=>last,
 html
};
root.PosCustomer=API;
if(typeof module!=='undefined'&&module.exports)module.exports=API;
})(typeof window!=='undefined'?window:globalThis);
