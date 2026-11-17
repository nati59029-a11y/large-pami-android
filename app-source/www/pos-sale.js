/* קופה (POS) – מסך המכירה. קובץ עצמאי, נטען אחרי index.html. כבוי = לא מוסיף כלום לשום מסך.
   מסכים: מכירה (חיפוש + רשימה וירטואלית + סל), תשלום (מזומן עם עודף, אשראי, פיצול), קבלה, החזרה בסיסית.
   פס עליון: קופאי, משמרת ונתוני היום. אין במסך הקופה הגדרות.
   כל הנתונים – רק דרך window.PosData (pos-data-mock.js עכשיו; התשתית תחליף בגל 2). כל הסכומים באגורות, המחירים כוללים מע"מ 18%.
   סורק ברקוד = מקלדת: תווים מהירים ואחריהם Enter (ScanDetector), עובד גם בלי שדה בפוקוס.
   מתג: window.posOn() – תוספת 'pos' פעילה בעסק (features.pos===true), או תצוגה מוקדמת במכשיר (lp-pos=1, בהגדרות האפליקציה למנהל).
   צבעים: רק משתני הערכה של האפליקציה (pos.css). */
(function(root){
'use strict';

/* ===================== חישובים (טהורים, נבדקים ב-firebase/tests/pos-calc.unit.test.js) ===================== */
const PosCalc=(function(){
 const VAT=18;
 const isAg=a=>Number.isInteger(a)&&a>=0;
 /* "12" / "12.5" / "₪1,234.50" → אגורות (שלם). קלט לא תקין → NaN */
 function parseAmt(s){s=String(s==null?'':s).replace(/[₪\s,]/g,'');if(!/^\d+(\.\d{0,2})?$/.test(s)&&!/^\.\d{1,2}$/.test(s))return NaN;const[i,f='']=s.split('.');return(+(i||0))*100+ +(f+'00').slice(0,2)}
 function fmt(a){a=Math.round(+a||0);const neg=a<0;a=Math.abs(a);const sh=String(Math.floor(a/100)).replace(/\B(?=(\d{3})+(?!\d))/g,','),ag=String(a%100).padStart(2,'0');return(neg?'-':'')+'₪'+sh+'.'+ag}
 const lineTotal=(price,qty)=>Math.round(price*qty);
 const vatOf=total=>Math.round(total*VAT/(100+VAT));
 function totals(lines){let total=0,items=0;(lines||[]).forEach(l=>{total+=lineTotal(l.price,l.qty);items+=l.qty});const vat=vatOf(total);return{items,total,vat,net:total-vat}}
 const paid=pays=>(pays||[]).reduce((s,p)=>s+p.a,0);
 const remaining=(total,pays)=>Math.max(0,total-paid(pays));
 const change=(total,pays)=>Math.max(0,paid(pays)-total);
 const isPaid=(total,pays)=>total>0&&paid(pays)>=total;
 /* הוספת תשלום: מזומן יכול לעבור את היתרה (עודף), אשראי – לא. מחזיר {ok,pays} או {ok:false,err} */
 function addPayment(total,pays,m,a){pays=(pays||[]).slice();if(m!=='cash'&&m!=='credit')return{ok:false,err:'אמצעי תשלום לא מוכר'};
  if(!isAg(a)||a===0)return{ok:false,err:'סכום לא תקין'};const rem=remaining(total,pays);if(rem<=0)return{ok:false,err:'המכירה כבר שולמה'};
  if(m==='credit'&&a>rem)return{ok:false,err:'באשראי אי אפשר לשלם יותר מהיתרה'};pays.push({m,a});return{ok:true,pays}}
 /* כמה אפשר עוד להחזיר משורה (נמכר פחות מה שכבר הוחזר) */
 const maxReturn=(sold,already)=>Math.max(0,(sold||0)-(already||0));
 function refund(lines){let total=0;(lines||[]).forEach(l=>{if(l.qty>0)total+=lineTotal(l.price,l.qty)});return{total,vat:vatOf(total)}}
 /* הוספה לסל: אותו מוצר = הגדלת כמות */
 function addToCart(cart,p,qty){qty=qty||1;cart=(cart||[]).slice();const i=cart.findIndex(l=>l.pid===p.id);if(i>=0)cart[i]=Object.assign({},cart[i],{qty:cart[i].qty+qty});else cart.push({pid:p.id,name:p.name,barcode:p.barcode,price:p.price,qty});return cart}
 function setQty(cart,pid,qty){cart=(cart||[]).slice();const i=cart.findIndex(l=>l.pid===pid);if(i<0)return cart;if(!(qty>0))cart.splice(i,1);else cart[i]=Object.assign({},cart[i],{qty});return cart}
 return{VAT,parseAmt,fmt,lineTotal,vatOf,totals,paid,remaining,change,isPaid,addPayment,maxReturn,refund,addToCart,setQty};
})();

/* ===================== סורק ברקוד כמקלדת ===================== */
/* תווים שמגיעים ברצף מהיר (רווח של עד maxGap מ"ש) ואחריהם Enter, באורך minLen ומעלה = סריקה. הקלדה של אדם – איטית יותר, לא נתפסת */
function ScanDetector(o){o=o||{};const minLen=o.minLen||4,maxGap=o.maxGap||50,enterGap=o.enterGap||150;let buf='',last=-1e9,first=0;
 return{feed(key,t){if(key==='Enter'){const ok=buf.length>=minLen&&t-last<=enterGap?buf:null;buf='';last=-1e9;return ok}
   if(typeof key!=='string'||key.length!==1)return null;if(t-last>maxGap){buf='';first=t}buf+=key;last=t;return null},
  reset(){buf='';last=-1e9},get buf(){return buf}}}

if(typeof module!=='undefined'&&module.exports){module.exports={PosCalc,ScanDetector};}
root.PosCalc=PosCalc;root.PosScan=ScanDetector;
if(typeof document==='undefined')return;

/* ===================== ממשק ===================== */
const D=()=>root.PosData;
const C=PosCalc,F=C.fmt;
const E=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const hm=t=>{const d=new Date(t);return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')};
const dmy=t=>{const d=new Date(t);return d.getDate()+'.'+(d.getMonth()+1)+'.'+d.getFullYear()};
const ROW=60;
const U={open:false,sheet:'',cart:[],q:'',res:[],qTok:0,sess:null,stats:null,tab:'prod',sel:'',
 pay:{list:[],m:'cash',inp:''},rcpt:null,ret:{step:1,list:[],sale:null,done:{},qty:{},m:'cash',inp:''},ask:null,busy:0};
let R=null,VL=null,scan=ScanDetector();

function posOn(){try{if(typeof SY!=='undefined'&&SY){if(SY.mg)return false;const b=SY.biz;if(b&&b.status==='suspended'&&!SY.sa)return false;if(b&&b.features&&b.features.pos===true)return true}}catch(e){}try{return localStorage.getItem('lp-pos')==='1'}catch(e){return false}}
/* הודעה בתוך הקופה (ה-toast של האפליקציה נמצא מתחת לשכבת הקופה) */
const msg=t=>{if(!R){if(typeof root.toast==='function')root.toast(t);return}R.querySelectorAll('.pos-toast').forEach(x=>x.remove());const e=document.createElement('div');e.className='pos-toast';e.setAttribute('role','status');e.textContent=t;R.append(e);setTimeout(()=>e.remove(),2400)};
const cust=()=>{try{root.PosCustomer&&root.PosCustomer.update(custState())}catch(e){}};
function custState(){const t=C.totals(U.cart);if(U.sheet==='rcpt'&&U.rcpt)return{scr:'done',total:U.rcpt.total,change:U.rcpt.change||0,kind:U.rcpt.kind};
 if(U.sheet==='pay')return{scr:'pay',lines:U.cart,total:t.total,paid:C.paid(U.pay.list),remaining:C.remaining(t.total,U.pay.list),change:C.change(t.total,U.pay.list)};
 return{scr:U.cart.length?'sale':'idle',lines:U.cart,total:t.total,items:t.items}}

/* ---------- פתיחה וסגירה ---------- */
async function open(){if(U.open)return;if(!D()){msg('שכבת הנתונים של הקופה לא נטענה');return}U.open=true;
 R=document.createElement('div');R.className='pos-app';R.id='pos';R.setAttribute('dir','rtl');R.setAttribute('role','application');R.setAttribute('aria-label','קופה');
 document.body.append(R);document.body.classList.add('pos-on');
 R.addEventListener('click',onClick);R.addEventListener('input',onInput);R.addEventListener('keydown',onFieldKey);R.addEventListener('submit',onSubmit);
 document.addEventListener('keydown',onKey,true);
 frame();
 try{U.sess=await D().getSession()}catch(e){U.sess=null}
 await refreshStats();await doSearch('');top();
 if(root.PosCustomer)root.PosCustomer.mount(R.querySelector('#posCust'));cust();
 focusSearch()}
function close(){if(!U.open)return;U.open=false;document.removeEventListener('keydown',onKey,true);if(R)R.remove();R=null;VL=null;document.body.classList.remove('pos-on');U.sheet='';scan.reset();
 try{root.PosCustomer&&root.PosCustomer.unmount()}catch(e){}}
function askExit(){if(!U.cart.length){close();return}confirmBox('לצאת מהקופה? הסל הפתוח יימחק.','צא ומחק את הסל',()=>{U.cart=[];close()})}
/* חזרה (כפתור אנדרואיד / החלקה): גיליון פתוח → סגירתו, אחרת יציאה מהקופה */
function back(){if(!U.open)return false;if(U.ask){U.ask=null;sheet();return true}if(U.sheet==='rcpt'){newSale();return true}if(U.sheet==='ret'&&U.ret.step===2){U.ret.step=1;sheet();return true}if(U.sheet){U.sheet='';sheet();cust();focusSearch();return true}askExit();return true}

/* ---------- שלד ---------- */
function frame(){R.innerHTML=`<header class="pos-top" id="posTop"></header>
<div class="pos-main">
 <section class="pos-prod" id="posProd" aria-label="מוצרים">
  <div class="pos-search"><input id="posQ" type="search" inputmode="search" autocomplete="off" enterkeyhint="search" placeholder="חיפוש מוצר או ברקוד" aria-label="חיפוש מוצר או ברקוד"><span class="pos-cnt" id="posCnt"></span></div>
  <div class="pos-vl" id="posVl" role="listbox" aria-label="תוצאות חיפוש"><div class="pos-vl-in" id="posVlIn"></div></div>
 </section>
 <section class="pos-cart" id="posCart" aria-label="סל"></section>
 <aside class="pos-cust" id="posCust" hidden aria-label="מסך לקוח"></aside>
</div>
<nav class="pos-tabs" id="posTabs"><button data-pa="tab" data-v="prod">מוצרים</button><button data-pa="tab" data-v="cart">סל <b id="posTabN"></b></button></nav>
<div class="pos-sheet" id="posSheet" hidden></div>`;
 VL=R.querySelector('#posVl');VL.addEventListener('scroll',()=>requestAnimationFrame(drawVL),{passive:true});
 root.addEventListener('resize',onResize);
 cart();tabs()}
function onResize(){if(!U.open)return;drawVL()}
function tabs(){if(!R)return;R.dataset.tab=U.tab;R.querySelectorAll('#posTabs button').forEach(b=>b.classList.toggle('on',b.dataset.v===U.tab));const n=R.querySelector('#posTabN');if(n)n.textContent=U.cart.length?'('+C.totals(U.cart).items+')':''}

/* ---------- פס עליון ---------- */
function top(){const el=R&&R.querySelector('#posTop');if(!el)return;const s=U.sess||{},c=s.cashier||{},sh=s.shift||{},st=U.stats||{sales:0,total:0};
 el.innerHTML=`<div class="pos-who"><b>${E(c.name||'קופאי')}</b><small>משמרת ${E(sh.no||'–')}${sh.openedAt?' · מ-'+hm(sh.openedAt):''}</small></div>
 <div class="pos-day" aria-label="נתוני היום"><span><small>מכירות היום</small><b>${st.sales||0}</b></span><span><small>סה"כ היום</small><b>${F((st.total||0)-(st.returnsTotal||0))}</b></span></div>
 <div class="pos-acts"><button class="pos-b g" data-pa="retOpen">החזרה</button><button class="pos-b g" data-pa="custT" aria-pressed="${!!(root.PosCustomer&&root.PosCustomer.shown())}">מסך לקוח</button><button class="pos-b g" data-pa="exit" aria-label="יציאה מהקופה">יציאה</button></div>`}
async function refreshStats(){try{U.stats=await D().dayStats()}catch(e){}top()}

/* ---------- חיפוש ורשימה וירטואלית ---------- */
async function doSearch(q){U.q=q;const tok=++U.qTok;let r=[];try{r=await D().search(q,q?500:300)}catch(e){r=[]}if(tok!==U.qTok||!R)return;U.res=r||[];
 const c=R.querySelector('#posCnt');if(c)c.textContent=q?(U.res.length>=500?'500+':U.res.length)+' תוצאות':'';
 const inn=R.querySelector('#posVlIn');if(inn)inn.style.height=(U.res.length*ROW)+'px';if(VL)VL.scrollTop=0;drawVL()}
function drawVL(){if(!VL||!R)return;const inn=R.querySelector('#posVlIn'),h=VL.clientHeight||400,n=U.res.length;
 if(!n){inn.innerHTML=`<div class="pos-empty">${U.q?'לא נמצאו מוצרים':'אין מוצרים'}</div>`;return}
 const s=Math.max(0,Math.floor(VL.scrollTop/ROW)-6),e=Math.min(n,s+Math.ceil(h/ROW)+12);let html='';
 for(let i=s;i<e;i++){const p=U.res[i];html+=`<button class="pos-row" role="option" data-pa="add" data-i="${i}" style="transform:translateY(${i*ROW}px)"><span class="n">${E(p.name)}<small>${E(p.barcode)}</small></span><b class="p">${F(p.price)}</b></button>`}
 inn.innerHTML=html}
function focusSearch(){const q=R&&R.querySelector('#posQ');if(q&&!U.sheet&&(U.tab==='prod'||wide()))try{q.focus({preventScroll:true})}catch(e){}}
const wide=()=>root.matchMedia&&root.matchMedia('(min-width: 760px)').matches;

/* ---------- סל ---------- */
function add(p,qty){U.cart=C.addToCart(U.cart,p,qty);U.sel=p.id;cart();tabs();cust();
 const el=R&&R.querySelector('.pos-line[data-pid="'+CSS.escape(p.id)+'"]');if(el)el.scrollIntoView({block:'nearest'})}
function cart(){const el=R&&R.querySelector('#posCart');if(!el)return;const t=C.totals(U.cart);
 el.innerHTML=`<div class="pos-lines" id="posLines">${U.cart.length?U.cart.map(l=>`<div class="pos-line${l.pid===U.sel?' sel':''}" data-pid="${E(l.pid)}">
  <div class="n"><b>${E(l.name)}</b><small>${F(l.price)} ליחידה</small></div>
  <div class="q"><button class="pos-ib" data-pa="qty" data-pid="${E(l.pid)}" data-d="-1" aria-label="הפחת כמות">−</button><input class="pos-qn" inputmode="numeric" data-pq="${E(l.pid)}" value="${l.qty}" aria-label="כמות"><button class="pos-ib" data-pa="qty" data-pid="${E(l.pid)}" data-d="1" aria-label="הוסף כמות">+</button></div>
  <b class="t">${F(C.lineTotal(l.price,l.qty))}</b><button class="pos-ib x" data-pa="del" data-pid="${E(l.pid)}" aria-label="הסר שורה">✕</button></div>`).join(''):'<div class="pos-empty">הסל ריק. סרקו ברקוד או בחרו מוצר.</div>'}</div>
 <div class="pos-sum"><div class="pos-tot"><span>לתשלום <small>${t.items} פריטים · כולל מע"מ ${C.VAT}%: ${F(t.vat)}</small></span><b id="posTotal">${F(t.total)}</b></div>
 <div class="pos-row2"><button class="pos-b g" data-pa="clear" ${U.cart.length?'':'disabled'}>ניקוי סל</button><button class="pos-b big" data-pa="payOpen" ${t.total>0?'':'disabled'}>תשלום</button></div></div>`}

/* ---------- גיליונות: תשלום / קבלה / החזרה / אישור ---------- */
function sheet(){const el=R&&R.querySelector('#posSheet');if(!el)return;if(U.ask){el.hidden=false;el.innerHTML=askH();return}
 if(!U.sheet){el.hidden=true;el.innerHTML='';return}el.hidden=false;el.innerHTML=U.sheet==='pay'?payH():U.sheet==='rcpt'?rcptH():U.sheet==='ret'?retH():'';
 const f=el.querySelector('[data-autof]');if(f)try{f.focus({preventScroll:true});f.select&&f.select()}catch(e){}}
function confirmBox(text,ok,fn){U.ask={text,ok,fn};sheet()}
const askH=()=>`<div class="pos-card pos-ask" role="alertdialog" aria-label="${E(U.ask.text)}"><p>${E(U.ask.text)}</p><div class="pos-row2"><button class="pos-b g" data-pa="askNo">ביטול</button><button class="pos-b bad" data-pa="askYes">${E(U.ask.ok)}</button></div></div>`;

function payOpen(){const t=C.totals(U.cart);if(!(t.total>0))return;U.pay={list:[],m:'cash',inp:''};U.sheet='pay';sheet();cust()}
function payH(){const t=C.totals(U.cart),P=U.pay,rem=C.remaining(t.total,P.list),chg=C.change(t.total,P.list),done=C.isPaid(t.total,P.list);
 const quick=P.m==='cash'?[rem,...[2000,5000,10000,20000].filter(v=>v>rem)].slice(0,4):[rem];
 return`<div class="pos-card pos-pay" role="dialog" aria-label="תשלום">
 <div class="pos-sh"><h2>תשלום</h2><button class="pos-ib" data-pa="sheetX" aria-label="חזרה לסל">✕</button></div>
 <div class="pos-kv big"><span>לתשלום</span><b id="payTotal">${F(t.total)}</b></div>
 ${P.list.length?`<div class="pos-pays">${P.list.map((p,i)=>`<div class="pos-kv"><span>${p.m==='cash'?'מזומן':'אשראי'}</span><b>${F(p.a)}</b>${done?'':`<button class="pos-ib x" data-pa="payDel" data-i="${i}" aria-label="בטל תשלום">✕</button>`}</div>`).join('')}</div>`:''}
 ${done?`<div class="pos-kv big ok"><span>עודף</span><b id="payChange">${F(chg)}</b></div><button class="pos-b big w" data-pa="payDone" ${U.busy?'disabled':''}>סיום וקבלה</button>`:
 `<div class="pos-kv big"><span>${P.list.length?'נותר לתשלום':'יתרה'}</span><b id="payRem">${F(rem)}</b></div>
 <div class="pos-seg" role="radiogroup" aria-label="אמצעי תשלום"><button role="radio" aria-checked="${P.m==='cash'}" data-pa="payM" data-v="cash">מזומן</button><button role="radio" aria-checked="${P.m==='credit'}" data-pa="payM" data-v="credit">אשראי</button></div>
 <label class="pos-f"><span>${P.m==='cash'?'התקבל מהלקוח':'סכום באשראי'} (₪)</span><input id="payInp" data-autof inputmode="decimal" autocomplete="off" dir="ltr" value="${E(P.inp)}" placeholder="${(rem/100).toFixed(2)}"></label>
 <div class="pos-quick">${quick.map(v=>`<button class="pos-b g" data-pa="payQ" data-v="${v}">${v===rem?'מדויק '+F(v):F(v)}</button>`).join('')}</div>
 <button class="pos-b big w" data-pa="payAdd">${P.m==='cash'?'קבל מזומן':'חיוב אשראי'}</button>
 <p class="pos-note">פיצול: אפשר לשלם חלק במזומן וחלק באשראי – מוסיפים תשלום אחרי תשלום עד שהיתרה מתאפסת.</p>`}
 </div>`}
function payAdd(a){const t=C.totals(U.cart);if(a==null){const s=(R.querySelector('#payInp')||{}).value;a=s&&s.trim()?C.parseAmt(s):C.remaining(t.total,U.pay.list)}
 const r=C.addPayment(t.total,U.pay.list,U.pay.m,a);if(!r.ok){msg(r.err);return}U.pay.list=r.pays;U.pay.inp='';sheet();cust()}
async function payDone(){const t=C.totals(U.cart);if(!C.isPaid(t.total,U.pay.list)||U.busy)return;U.busy=1;sheet();
 const sale={lines:U.cart.map(l=>({pid:l.pid,name:l.name,barcode:l.barcode,price:l.price,qty:l.qty,total:C.lineTotal(l.price,l.qty)})),total:t.total,vat:t.vat,items:t.items,payments:U.pay.list.slice(),change:C.change(t.total,U.pay.list)};
 try{const r=await D().saveSale(sale);U.rcpt=Object.assign({kind:'sale'},sale,r,{cashier:(U.sess&&U.sess.cashier||{}).name||''});U.cart=[];U.sheet='rcpt';U.busy=0;cart();tabs();sheet();cust();refreshStats()}
 catch(e){U.busy=0;sheet();msg('השמירה נכשלה: '+(e&&e.message||'נסו שוב'))}}
function rcptH(){const r=U.rcpt,ret=r.kind==='ret';return`<div class="pos-card pos-rcpt" role="dialog" aria-label="${ret?'אישור החזרה':'קבלה'}">
 <div class="pos-sh"><h2>${ret?'החזרה':'קבלה'} מס' ${E(r.no)}</h2></div>
 <p class="pos-note">${dmy(r.at)} ${hm(r.at)}${r.cashier?' · '+E(r.cashier):''}${ret?' · למכירה מס\' '+E(r.saleNo):''}</p>
 <div class="pos-rl">${r.lines.map(l=>`<div class="pos-kv"><span>${E(l.name)}${l.qty!==1?` <small>${l.qty} × ${F(l.price)}</small>`:''}</span><b>${F(l.total)}</b></div>`).join('')}</div>
 <div class="pos-kv big"><span>${ret?'סה"כ הוחזר':'סה"כ'}</span><b id="rcptTotal">${F(r.total)}</b></div>
 <div class="pos-kv"><span>מתוכו מע"מ ${C.VAT}%</span><b>${F(r.vat)}</b></div>
 ${ret?`<div class="pos-kv"><span>הוחזר ב${r.method==='cash'?'מזומן':'אשראי'}</span><b>${F(r.total)}</b></div>`:r.payments.map(p=>`<div class="pos-kv"><span>${p.m==='cash'?'מזומן':'אשראי'}</span><b>${F(p.a)}</b></div>`).join('')+(r.change?`<div class="pos-kv big ok"><span>עודף</span><b>${F(r.change)}</b></div>`:'')}
 <button class="pos-b big w" data-pa="newSale" data-autof>מכירה חדשה</button></div>`}
function newSale(){U.sheet='';U.rcpt=null;U.tab='prod';sheet();tabs();cust();focusSearch()}

/* החזרה בסיסית: בחירת מכירה מהיום (או לפי מספר קבלה) → כמויות להחזרה → מזומן/אשראי */
async function retOpen(){if(U.cart.length){msg('יש פריטים בסל. סיימו או נקו את הסל לפני החזרה.');return}U.ret={step:1,list:[],sale:null,done:{},qty:{},m:'cash',inp:''};U.sheet='ret';sheet();
 try{U.ret.list=await D().getSales({})}catch(e){U.ret.list=[]}if(U.sheet==='ret')sheet()}
async function retPick(no){const s=await D().getSale(no);if(!s){msg('לא נמצאה מכירה מס\' '+no);return}let done={};try{done=await D().returnedQty(s.no)||{}}catch(e){}
 U.ret.sale=s;U.ret.done=done;U.ret.qty={};U.ret.m=(s.payments||[]).some(p=>p.m==='credit')&&!(s.payments||[]).some(p=>p.m==='cash')?'credit':'cash';U.ret.step=2;sheet()}
function retLines(){const s=U.ret.sale;return s?s.lines.map(l=>({pid:l.pid,name:l.name,price:l.price,qty:U.ret.qty[l.pid]||0,max:C.maxReturn(l.qty,U.ret.done[l.pid])})):[]}
function retH(){const T=U.ret;if(T.step===1)return`<div class="pos-card pos-ret" role="dialog" aria-label="החזרה">
 <div class="pos-sh"><h2>החזרה</h2><button class="pos-ib" data-pa="sheetX" aria-label="סגירה">✕</button></div>
 <form class="pos-row2" data-pf="retNo"><label class="pos-f grow"><span>מספר קבלה</span><input id="retNo" data-autof inputmode="numeric" autocomplete="off" dir="ltr"></label><button class="pos-b">חיפוש</button></form>
 <h3>מכירות היום</h3><div class="pos-rl">${T.list.length?T.list.slice(0,100).map(s=>`<button class="pos-kv pos-pick" data-pa="retPick" data-no="${s.no}"><span>קבלה ${s.no} <small>${hm(s.at)} · ${s.items||s.lines.length} פריטים</small></span><b>${F(s.total)}</b></button>`).join(''):'<div class="pos-empty">אין מכירות היום</div>'}</div></div>`;
 const L=retLines(),rf=C.refund(L);return`<div class="pos-card pos-ret" role="dialog" aria-label="החזרה ממכירה ${T.sale.no}">
 <div class="pos-sh"><h2>החזרה – קבלה ${T.sale.no}</h2><button class="pos-ib" data-pa="retBack" aria-label="חזרה לרשימה">✕</button></div>
 <div class="pos-rl">${L.map(l=>`<div class="pos-line"><div class="n"><b>${E(l.name)}</b><small>${F(l.price)} · ניתן להחזיר ${l.max}</small></div>
  <div class="q"><button class="pos-ib" data-pa="retQ" data-pid="${E(l.pid)}" data-d="-1" ${l.qty>0?'':'disabled'} aria-label="פחות">−</button><span class="pos-qn">${l.qty}</span><button class="pos-ib" data-pa="retQ" data-pid="${E(l.pid)}" data-d="1" ${l.qty<l.max?'':'disabled'} aria-label="עוד">+</button></div>
  <b class="t">${F(C.lineTotal(l.price,l.qty))}</b></div>`).join('')}</div>
 <div class="pos-seg" role="radiogroup" aria-label="החזר כספי"><button role="radio" aria-checked="${T.m==='cash'}" data-pa="retM" data-v="cash">החזר במזומן</button><button role="radio" aria-checked="${T.m==='credit'}" data-pa="retM" data-v="credit">זיכוי אשראי</button></div>
 <div class="pos-kv big"><span>להחזרה <small>כולל מע"מ ${F(rf.vat)}</small></span><b id="retTotal">${F(rf.total)}</b></div>
 <button class="pos-b big w" data-pa="retDo" ${rf.total>0&&!U.busy?'':'disabled'}>אישור החזרה</button></div>`}
async function retDo(){const T=U.ret,L=retLines().filter(l=>l.qty>0);if(!L.length||U.busy)return;const rf=C.refund(L);U.busy=1;sheet();
 const ret={saleNo:T.sale.no,lines:L.map(l=>({pid:l.pid,name:l.name,price:l.price,qty:l.qty,total:C.lineTotal(l.price,l.qty)})),total:rf.total,vat:rf.vat,method:T.m};
 try{const r=await D().saveReturn(ret);U.rcpt=Object.assign({kind:'ret'},ret,r,{cashier:(U.sess&&U.sess.cashier||{}).name||''});U.busy=0;U.sheet='rcpt';sheet();cust();refreshStats()}
 catch(e){U.busy=0;sheet();msg('השמירה נכשלה: '+(e&&e.message||'נסו שוב'))}}

/* ---------- אירועים ---------- */
function onClick(ev){const b=ev.target.closest('[data-pa]');if(!b||!R.contains(b)||b.disabled)return;const a=b.dataset.pa,pid=b.dataset.pid;
 switch(a){
  case'add':{const p=U.res[+b.dataset.i];if(p){add(p);if(!wide())msg('נוסף: '+p.name)}break}
  case'qty':{const l=U.cart.find(x=>x.pid===pid);if(l){U.cart=C.setQty(U.cart,pid,l.qty+ +b.dataset.d);U.sel=pid;cart();tabs();cust()}break}
  case'del':U.cart=C.setQty(U.cart,pid,0);cart();tabs();cust();break;
  case'clear':confirmBox('לנקות את כל הסל?','נקה סל',()=>{U.cart=[];cart();tabs();cust()});break;
  case'tab':U.tab=b.dataset.v;tabs();if(U.tab==='prod'){drawVL();focusSearch()}break;
  case'payOpen':payOpen();break;
  case'payM':U.pay.m=b.dataset.v;U.pay.inp='';sheet();break;
  case'payQ':payAdd(+b.dataset.v);break;
  case'payAdd':payAdd();break;
  case'payDel':U.pay.list.splice(+b.dataset.i,1);sheet();cust();break;
  case'payDone':payDone();break;
  case'sheetX':U.sheet='';sheet();cust();focusSearch();break;
  case'newSale':newSale();break;
  case'retOpen':retOpen();break;
  case'retPick':retPick(+b.dataset.no);break;
  case'retBack':U.ret.step=1;sheet();break;
  case'retQ':{const l=retLines().find(x=>x.pid===pid);if(l){U.ret.qty[pid]=Math.max(0,Math.min(l.max,l.qty+ +b.dataset.d));sheet()}break}
  case'retM':U.ret.m=b.dataset.v;sheet();break;
  case'retDo':retDo();break;
  case'custT':if(root.PosCustomer){root.PosCustomer.toggle();cust();top()}break;
  case'exit':askExit();break;
  case'askNo':U.ask=null;sheet();break;
  case'askYes':{const f=U.ask&&U.ask.fn;U.ask=null;sheet();if(f)f();break}
 }}
function onInput(ev){const t=ev.target;if(t.id==='posQ'){const q=t.value;requestAnimationFrame(()=>{if(U.open&&q===t.value)doSearch(q.trim())})}
 else if(t.id==='payInp')U.pay.inp=t.value}
function onFieldKey(ev){const t=ev.target;if(ev.key!=='Enter')return;
 if(t.dataset&&t.dataset.pq!=null){ev.preventDefault();const v=Math.floor(+t.value);U.cart=C.setQty(U.cart,t.dataset.pq,v>0?v:0);cart();tabs();cust();focusSearch();return}
 if(t.id==='payInp'){ev.preventDefault();payAdd();return}}
function onSubmit(ev){const f=ev.target;ev.preventDefault();if(f.dataset.pf==='retNo'){const n=+((f.querySelector('#retNo')||{}).value||0);if(n>0)retPick(n)}}
/* מקלדת כללית (שלב הלכידה): סורק → הוספה; Enter בחיפוש → מוצר יחיד/ברקוד מדויק; הקלדה בלי פוקוס → לחיפוש */
function onKey(ev){if(!U.open)return;const now=ev.timeStamp||performance.now(),t=ev.target;
 const code=scan.feed(ev.key,now);
 if(code){ev.preventDefault();ev.stopPropagation();if(t&&t.tagName==='INPUT'&&typeof t.value==='string')unscan(t,code);onScan(code);return}
 if(ev.key==='Escape'){ev.preventDefault();back();return}
 if(ev.key==='Enter'&&t&&t.id==='posQ'){ev.preventDefault();enterSearch(t);return}
 if(!U.sheet&&!U.ask&&ev.key.length===1&&!ev.ctrlKey&&!ev.metaKey&&!ev.altKey&&!(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'))){const q=R.querySelector('#posQ');if(q){if(!wide()&&U.tab!=='prod'){U.tab='prod';tabs()}q.focus({preventScroll:true})}}}
/* תווי הסריקה שנכנסו לשדה (כולם או רק סופם, אם הפוקוס עבר אליו באמצע) – יוצאים ממנו */
function unscan(t,code){const v=t.value;let k=Math.min(v.length,code.length);while(k>0&&!v.endsWith(code.slice(code.length-k)))k--;if(k>0)t.value=v.slice(0,v.length-k);
 if(t.id==='payInp')U.pay.inp=t.value;if(t.id==='posQ')doSearch(t.value.trim())}
async function enterSearch(t){const q=t.value.trim();if(!q)return;let p=await D().byBarcode(q);if(!p&&U.res.length===1)p=U.res[0];if(p){add(p);t.value='';doSearch('')}else msg(U.res.length?'בחרו מוצר מהרשימה':'לא נמצא: '+q)}
async function onScan(code){if(U.ask)return;if(U.sheet==='ret'&&U.ret.step===1){const n=+code;if(n>0&&!(await D().byBarcode(code)))return retPick(n)}
 if(U.sheet&&U.sheet!=='rcpt'){msg('סיימו את המסך הפתוח לפני סריקה');return}
 const p=await D().byBarcode(code);if(!p){msg('ברקוד לא נמצא: '+code);return}if(U.sheet==='rcpt')newSale();add(p)}

/* ---------- חיבור לאפליקציה (אחרי index.html) ---------- */
root.posOn=posOn;root.posOpen=open;root.posClose=close;
root.posTile=()=>posOn()?`<button class="tile" data-a="posOpen" style="font-size:1.15rem;text-align:center;border-color:var(--acc);color:var(--acc)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="width:34px;height:34px;display:block;margin:0 auto 6px"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M7 20h10M12 16v4M7 8h4M7 12h2"/></svg>קופה</button>`:'';
root.POS_DEBUG={U,add:p=>add(p)};
if(typeof ACT!=='undefined'){
 ACT.posOpen=()=>open();
 ACT.posDev=()=>{try{if(localStorage.getItem('lp-pos')==='1')localStorage.removeItem('lp-pos');else localStorage.setItem('lp-pos','1')}catch(e){}if(typeof rerender==='function')rerender()};
}
/* כפתור חזרה / החלקה: בזמן שהקופה פתוחה – מטופלים בתוך הקופה */
if(typeof root.goBack==='function'){const g0=root.goBack;root.goBack=function(){if(U.open)return back();return g0.apply(this,arguments)}}
/* תצוגה מוקדמת במכשיר – בהגדרות האפליקציה (לא במסך הקופה), למנהל בלבד, כשהתוספת לא הופעלה לעסק */
if(typeof V!=='undefined'&&typeof V.settings==='function'){const s0=V.settings;V.settings=function(){const x=s0.apply(this,arguments);try{
 const adm=typeof isA==='function'&&isA(),biz=typeof SY!=='undefined'&&SY&&SY.biz&&SY.biz.features&&SY.biz.features.pos===true;
 if(x&&typeof x.h==='string'&&(adm||!(typeof isW==='function'&&isW()))&&!biz){let on=false;try{on=localStorage.getItem('lp-pos')==='1'}catch(e){}
  x.h+=`<div class="sec"><h3>קופה (בבנייה)</h3></div><div class="card"><div class="li" style="cursor:default"><div class="m"><b>תצוגה מוקדמת של הקופה במכשיר הזה</b><small>נתונים מדומים בלבד. מוסיף משבצת "קופה" במסך הבית.</small></div><button class="chip ${on?'on':''}" data-a="posDev" aria-pressed="${on}">${on?'פעיל':'כבוי'}</button></div></div>`}}catch(e){}return x}}
})(typeof window!=='undefined'?window:globalThis);
