/* POS:M1 – קופה, מסך המכירה (ש1; אפיון ב 1.1, ב 3 מסך 1–2, ד U1–U17, א 5.7–5.9). נטען אחרי pos-calc.js ו-pos-base.js (שלב 0).
   כל החישובים – PosCalc של שלב 0 (pos-calc.js): שורה = unit×qty פחות הנחה, הנחת חשבון מתחלקת יחסית, מע"מ 18% כלול. אגורות בלבד.
   מבנה: פס עליון (קופאי, משמרת, תפריט מכירה/החזרה/השהיות, המכירות שלי ויעד, מכירה אחרונה, יציאה) · חיפוש קבוע ·
   לשוניות קטגוריה + אריחים (רשימה וירטואלית – אלפי מוצרים בלי האטה) · עגלה (שם, כמות, מחיר, הנחה, מלאי, X) · לקוח, הערה, הנחה (אחראי ומעלה),
   השהיה, ביטול עגלה, כפתור תשלום עם הסכום. במאוזן – עגלה ואריחים זה לצד זה; במאונך – עגלה למעלה ואריחים למטה (U12).
   במסך הקופה אין שום הגדרה (ה 5.10): ההגדרות נקראות רק דרך PosUI.cfg (PosCfg של ש4). הנתונים – רק דרך PosData. */
(function(root){
'use strict';
if(typeof document==='undefined')return;
const UI=()=>root.PosUI,D=()=>root.PosData,PC=()=>root.PosCalc;
const ROW=60;
const S={open:false,sess:null,cats:[],cat:'fav',q:'',res:[],tok:0,cart:[],sel:'',cust:null,note:'',manDisc:null,last:null,chg:null,mine:null,undo:null,busy:0,parkN:0};
let R=null,VL=null,scan=null,undoT=0,seq=0;
const role=()=>(S.sess&&S.sess.cashier&&S.sess.cashier.role)||'cashier';
const can=need=>UI().atLeast(role(),need);
const view=k=>(UI().cfg('cashierView')||[]).includes(k);

/* ---------- חישוב העגלה (PosCalc + מבצעים של ש2) ---------- */
function calc(){const lines=UI().Promo.apply(S.cart.map(l=>Object.assign({},l)),{cust:S.cust});
 if(!lines.length)return{lines:[],items:0,sub:0,disc:0,gross:0,vat:0,net:0};
 const inp=lines.map(l=>({unit:l.unit,qty:l.qty,disc:Math.min(l.unit*l.qty,(l.pdisc||0)+(l.mdisc?l.mdisc.amt:0))}));
 let o={};if(S.manDisc)o.disc=S.manDisc.amt;let r;
 try{r=PC().sale(inp,o)}catch(e){S.manDisc=null;r=PC().sale(inp,{})}
 return{lines:lines.map((l,i)=>Object.assign(l,r.lines[i])),items:lines.reduce((s,l)=>s+l.qty,0),sub:r.sub,disc:r.disc,sdisc:r.sdisc,gross:r.gross,vat:r.vat,net:r.net}}

/* ---------- פתיחה וסגירה ---------- */
async function open(){if(S.open)return;if(!D()||!PC()||!UI()){if(typeof root.toast==='function')root.toast('רכיבי הקופה לא נטענו');return}
 S.open=true;R=document.createElement('div');R.className='pos-app';R.id='pos';R.setAttribute('dir','rtl');R.setAttribute('role','application');R.setAttribute('aria-label','קופה');
 document.body.append(R);document.body.classList.add('pos-on');UI().setRoot(R);scan=root.PosScan.ScanDetector();
 R.addEventListener('click',onClick);R.addEventListener('input',onInput);R.addEventListener('change',onChange);
 document.addEventListener('keydown',onKey,true);root.addEventListener('resize',drawVL);
 try{S.sess=await D().getSession()}catch(e){S.sess=null}try{S.cats=await D().getCategories()}catch(e){S.cats=[]}
 frame();await refresh();await showCat('fav');try{root.PosCustomer&&root.PosCustomer.mount(R.querySelector('#posCust'))}catch(e){}cust();focusQ()}
async function close(){if(!S.open)return;if(S.cart.length){if(!(await UI().confirmBox('לצאת מהקופה? העגלה הפתוחה תבוטל. אפשר להשהות אותה קודם.','צא ובטל עגלה',{bad:1})))return;D().log('cartClear',{n:S.cart.length,why:'exit'});S.cart=[]}
 S.open=false;document.removeEventListener('keydown',onKey,true);root.removeEventListener('resize',drawVL);R.remove();R=null;VL=null;UI().setRoot(null);document.body.classList.remove('pos-on');try{root.PosCustomer&&root.PosCustomer.unmount()}catch(e){}}
function back(){if(!S.open)return false;if(UI().closeTop())return true;if(S.q){setQ('');return true}close();return true}

/* ---------- שלד ---------- */
function frame(){const{E}=UI();R.innerHTML=`<header class="pos-top" id="posTop"></header>
<div class="pos-main">
 <section class="pos-cart" id="posCart" aria-label="עגלה"></section>
 <section class="pos-prod" aria-label="מוצרים">
  <div class="pos-search"><input id="posQ" type="search" inputmode="search" autocomplete="off" enterkeyhint="search" placeholder="חיפוש מוצר, מק&quot;ט או ברקוד" aria-label="חיפוש מוצר, מק&quot;ט או ברקוד"><span class="pos-cnt" id="posCnt" aria-live="polite"></span></div>
  <nav class="pos-cats" id="posCats" aria-label="קטגוריות"><button data-pa="cat" data-v="fav" aria-label="מועדפים ושירותים">מועדפים</button>${S.cats.map((c,i)=>`<button data-pa="cat" data-v="${E(c.id)}" class="c${i%8}" aria-label="${E(c.name)}">${E(c.name)}</button>`).join('')}</nav>
  <div class="pos-vl" id="posVl" role="listbox" aria-label="מוצרים"><div class="pos-vl-in" id="posVlIn"></div></div>
 </section>
 <aside class="pos-cust" id="posCust" hidden aria-label="מסך לקוח"></aside>
</div>`;
 VL=R.querySelector('#posVl');VL.addEventListener('scroll',()=>requestAnimationFrame(drawVL),{passive:true});top();cart()}

/* ---------- פס עליון ---------- */
function top(){const el=R&&R.querySelector('#posTop');if(!el)return;const{E,fmt,hm,cfg}=UI();const s=S.sess||{},c=s.cashier||{},sh=s.shift||{},m=S.mine||{sales:0,total:0},goal=cfg('dailyGoal');
 const pct=goal?Math.max(0,Math.min(100,Math.round(m.total*100/goal))):0;
 el.innerHTML=`<div class="pos-who"><b>קופאי ${E(c.no||'')}</b><small>משמרת ${E(sh.no||'–')}${sh.openedAt?' · מ-'+hm(sh.openedAt):''}${s.dev?' · '+E(s.dev):''}</small></div>
 <nav class="pos-menu" aria-label="תפריט"><button class="on" data-pa="nav" data-v="sale" aria-current="page">מכירה</button><button data-pa="nav" data-v="ret">החזרה</button><button data-pa="nav" data-v="park">השהיות${S.parkN?` <b class="pos-bdg">${S.parkN}</b>`:''}</button></nav>
 ${view('myRep')?`<div class="pos-mine" aria-label="המכירות שלי היום"><small>המכירות שלי</small><b>${fmt(m.total)}</b><small>${m.sales} מכירות</small>${goal?`<span class="pos-goal" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="יעד יומי ${pct}%"><i style="width:${pct}%"></i></span>`:''}</div>`:''}
 <div class="pos-acts"><button class="pos-b g" data-pa="last" ${S.last?'':'disabled'} aria-label="מכירה אחרונה – עותק, קבלת מתנה ושליחה">מכירה אחרונה</button><button class="pos-b g" data-pa="custT" aria-label="מסך לקוח" aria-pressed="${!!(root.PosCustomer&&root.PosCustomer.shown())}">מסך לקוח</button><button class="pos-b g" data-pa="exit" aria-label="יציאה מהקופה">יציאה</button></div>`}
async function refresh(){try{S.mine=await D().myStats((S.sess&&S.sess.cashier||{}).id)}catch(e){}try{S.parkN=(await D().parked()).length}catch(e){}top()}

/* ---------- אריחים, קטגוריות וחיפוש ---------- */
async function showCat(cat){S.cat=cat;S.q='';const q=R.querySelector('#posQ');if(q)q.value='';R.querySelectorAll('#posCats button').forEach(b=>{const on=b.dataset.v===cat;b.classList.toggle('on',on);b.setAttribute('aria-pressed',String(on))});
 let L=[];if(cat==='fav'){const{cfg}=UI();const fixed=[{id:'_free',name:'סכום חופשי',free:true}];for(const pid of cfg('svcPids')||[]){const p=await D().getProduct(pid);if(p)fixed.push(p)}
  L=fixed.concat(await D().favorites(cfg('cat.favMax')||24))}
 else L=await D().byCat(cat);S.res=L;R.querySelector('#posCnt').textContent='';list()}
function setQ(v){const q=R.querySelector('#posQ');if(q)q.value=v;doSearch(v)}
async function doSearch(q){q=String(q||'').trim();S.q=q;if(!q)return showCat(S.cat==='fav'||!S.cat?'fav':S.cat);const t=++S.tok;let r=[];try{r=await D().search(q,UI().cfg('searchMax')||10)}catch(e){}if(t!==S.tok||!R)return;
 S.res=r;R.querySelector('#posCnt').textContent=r.length?r.length+' תוצאות':'לא נמצא';R.querySelectorAll('#posCats button').forEach(b=>b.classList.remove('on'));list()}
function list(){const inn=R.querySelector('#posVlIn');inn.style.height=(S.res.length*ROW)+'px';VL.scrollTop=0;drawVL()}
function drawVL(){if(!VL||!R)return;const{E,fmt}=UI();const inn=R.querySelector('#posVlIn'),h=VL.clientHeight||400,n=S.res.length;
 if(!n){inn.innerHTML=`<div class="pos-empty">${S.q?'לא נמצאו מוצרים':'אין מוצרים'}</div>`;return}
 const s=Math.max(0,Math.floor(VL.scrollTop/ROW)-6),e=Math.min(n,s+Math.ceil(h/ROW)+12);let html='';const st=view('stock');
 for(let i=s;i<e;i++){const p=S.res[i];const ci=Math.max(0,S.cats.findIndex(c=>c.id===p.cat))%8;
  html+=`<button class="pos-row c${ci}" role="option" data-pa="add" data-i="${i}" style="transform:translateY(${i*ROW}px)" aria-label="${E(p.name)}${p.free?'':', '+fmt(p.price)}"><span class="n">${E(p.name)}<small>${p.free?'מוצר כללי – מקלידים מחיר':p.gen?'מחיר ידני':E(p.barcode||p.sku||'')}${st&&!p.free&&!p.svc&&!p.gen?` · מלאי ${p.stock}`:''}</small></span><b class="p">${p.free||p.gen?'₪ ?':fmt(p.price)}</b></button>`}
 inn.innerHTML=html}
function focusQ(){const q=R&&R.querySelector('#posQ');if(q&&!UI().UI.stack.length)try{q.focus({preventScroll:true})}catch(e){}}

/* ---------- הוספה לעגלה ---------- */
async function addP(p,qty){const{E,fmt,cfg,modal,parseAmt}=UI();qty=qty||1;
 if(p.variants){const v=await modal(`<div class="pos-sh"><h2>${E(p.name)} – בחירה</h2></div><div class="pos-rl">${p.variants.filter(Boolean).map(x=>`<button class="pos-kv pos-pick" data-v="${E(x.id)}" aria-label="${E(x.name)}"><span>${E(x.name)}${view('stock')?` <small>מלאי ${x.stock}</small>`:''}</span><b>${fmt(x.price)}</b></button>`).join('')}</div><button class="pos-b g w" data-v="no">ביטול</button>`,{label:'בחירת וריאציה'});
  if(!v||v==='no')return;p=p.variants.find(x=>x&&x.id===v);if(!p)return}
 if(p.free||p.gen){if(!cfg('freeAmt'))return;const v=await modal(`<div class="pos-sh"><h2>סכום חופשי</h2></div><label class="pos-f"><span>שם (לא חובה)</span><input id="fName" maxlength="40" aria-label="שם הפריט"></label><label class="pos-f"><span>מחיר (₪)</span><input id="fAmt" data-autof inputmode="decimal" dir="ltr" aria-label="מחיר"></label><div class="pos-row2"><button class="pos-b g" data-v="no">ביטול</button><button class="pos-b" data-v="ok" data-def>הוספה</button></div>`,
   {label:'סכום חופשי',read:(w,v)=>v==='ok'?{n:w.querySelector('#fName').value.trim(),a:parseAmt(w.querySelector('#fAmt').value)}:null,check:(w)=>{const a=parseAmt(w.querySelector('#fAmt').value);if(!(a>0)){UI().toast('מחיר לא תקין','bad');return false}}});
  if(!v)return;const g=await D().getProduct('gen');return push({id:'gen',name:v.n||'פריט כללי',unit:v.a,gen:true,stock:null,barcode:'',min:0,base:g},qty)}
 return push({id:p.id,name:p.name,unit:p.price,stock:p.stock,barcode:p.barcode,min:p.min||0,fromPos:p.fromPos},qty)}
function push(p,qty){const{cfg,toast,fmt}=UI();
 if(view('stock')&&p.stock!=null&&p.stock-qty-inCart(p.id)<0&&cfg('inv.zero')==='warn')toast('אין במלאי ('+(p.stock-inCart(p.id))+') – המכירה ממשיכה','warn');
 const i=p.gen?-1:S.cart.findIndex(l=>l.pid===p.id&&!l.mdisc);let key;
 if(i>=0){S.cart[i]=Object.assign({},S.cart[i],{qty:S.cart[i].qty+qty});key=S.cart[i].key}else{key='l'+(++seq);S.cart.push({key,pid:p.id,name:p.name,unit:p.unit,qty,stock:p.stock,barcode:p.barcode,min:p.min,gen:!!p.gen})}
 S.sel=key;S.chg=null;if(cfg('bc.beep'))UI().Dev.beep('ok');
 const sec=cfg('uiUndoSec')||0;if(sec){S.undo={key,qty,name:p.name,until:Date.now()+sec*1000};clearTimeout(undoT);undoT=setTimeout(()=>{S.undo=null;cart()},sec*1000)}
 cart();cust();UI().say('נוסף '+p.name+'. סה"כ '+fmt(calc().gross));
 const el=R.querySelector('.pos-line[data-k="'+key+'"]');if(el)el.scrollIntoView({block:'nearest'})}
const inCart=pid=>S.cart.filter(l=>l.pid===pid).reduce((s,l)=>s+l.qty,0);
function undo(){const u=S.undo;if(!u||Date.now()>u.until)return;const i=S.cart.findIndex(l=>l.key===u.key);if(i>=0){const l=S.cart[i];if(l.qty>u.qty)S.cart[i]=Object.assign({},l,{qty:l.qty-u.qty});else S.cart.splice(i,1)}
 S.undo=null;clearTimeout(undoT);D().log('undoAdd',{pid:u.key});cart();cust();UI().say('ההוספה בוטלה')}

/* ---------- עגלה ---------- */
function cart(){const el=R&&R.querySelector('#posCart');if(!el)return;const{E,fmt}=UI();const t=calc(),st=view('stock'),disc=can(UI().cfg('discRoles')||'lead');
 el.innerHTML=`<div class="pos-cbar"><button class="pos-b g" data-pa="cust" aria-label="${S.cust?'לקוח: '+E(S.cust.name):'בחירת לקוח'}">${S.cust?'👤 '+E(S.cust.name):'לקוח'}</button><button class="pos-b g" data-pa="note" aria-label="הערה למכירה">${S.note?'הערה ✓':'הערה'}</button>${disc?`<button class="pos-b g" data-pa="disc" ${S.cart.length?'':'disabled'} aria-label="הנחה">הנחה</button>`:''}<button class="pos-b g" data-pa="park" ${S.cart.length?'':'disabled'} aria-label="השהיית העגלה">השהיה</button></div>
 <div class="pos-lines" id="posLines">${t.lines.length?t.lines.map(l=>`<div class="pos-line${l.key===S.sel?' sel':''}" data-k="${l.key}">
  <div class="n"><b>${E(l.name)}</b><small>${fmt(l.unit)}${l.gen?` <button class="pos-lnk" data-pa="price" data-k="${l.key}" aria-label="שינוי מחיר ${E(l.name)}">שינוי מחיר</button>`:''}${st&&l.stock!=null?` · מלאי ${l.stock-inCart(l.pid)}`:''}${l.pdisc?` · <span class="pos-promo">מבצע −${fmt(l.pdisc)}</span>`:''}${l.mdisc?` · <span class="pos-promo">הנחה −${fmt(l.mdisc.amt)}</span>`:''}</small></div>
  <div class="q"><button class="pos-ib" data-pa="qty" data-k="${l.key}" data-d="-1" aria-label="הפחתת כמות ${E(l.name)}">−</button><input class="pos-qn" inputmode="numeric" data-pq="${l.key}" value="${l.qty}" aria-label="כמות ${E(l.name)}"><button class="pos-ib" data-pa="qty" data-k="${l.key}" data-d="1" aria-label="הוספת כמות ${E(l.name)}">+</button></div>
  <b class="t">${fmt(l.tot)}</b><button class="pos-ib x" data-pa="del" data-k="${l.key}" aria-label="מחיקת ${E(l.name)}">✕</button></div>`).join(''):
  S.chg!=null?`<div class="pos-chg" role="status"><small>עודף ללקוח</small><b id="posChg">${fmt(S.chg)}</b><small>אפשר לסרוק את המכירה הבאה</small></div>`:'<div class="pos-empty">העגלה ריקה. סורקים ברקוד או בוחרים מוצר.</div>'}</div>
 ${S.undo?`<div class="pos-undo" role="status"><span>נוסף: ${E(S.undo.name)}</span><button class="pos-b g" data-pa="undo" aria-label="ביטול ההוספה האחרונה">בטל</button></div>`:''}
 <div class="pos-sum">${t.disc?`<div class="pos-kv"><span>לפני הנחות</span><b>${fmt(t.sub)}</b></div><div class="pos-kv"><span>הנחות${S.manDisc?` <button class="pos-lnk" data-pa="undisc" aria-label="ביטול הנחת החשבון">ביטול הנחת חשבון</button>`:''}</span><b>−${fmt(t.disc)}</b></div>`:''}
  <div class="pos-tot"><span>לתשלום <small>${t.items} פריטים · מתוכו מע"מ ${fmt(t.vat)}${S.note?' · יש הערה':''}</small></span><b id="posTotal">${fmt(t.gross)}</b></div>
  <div class="pos-row2"><button class="pos-b g" data-pa="clear" ${S.cart.length?'':'disabled'} aria-label="ביטול כל העגלה">בטל עגלה</button><button class="pos-b big" id="posPay" data-pa="pay" ${t.gross>0?'':'disabled'} aria-label="תשלום ${fmt(t.gross)}">תשלום ${fmt(t.gross)}</button></div></div>`}
function cust(){try{if(!root.PosCustomer)return;const t=calc();root.PosCustomer.update(S.chg!=null&&!S.cart.length?{scr:'done',total:S.last?S.last.gross:0,change:S.chg}:{scr:S.cart.length?'sale':'idle',lines:t.lines.map(l=>({name:l.name,qty:l.qty,price:l.unit,tot:l.tot})),total:t.gross,items:t.items})}catch(e){}}
async function delLine(key){const l=S.cart.find(x=>x.key===key);if(!l)return;if(UI().cfg('uiConfirmDel')&&!(await UI().confirmBox('למחוק את '+l.name+' מהעגלה?','מחיקה',{bad:1})))return;
 S.cart=S.cart.filter(x=>x.key!==key);D().log('lineDel',{pid:l.pid,qty:l.qty,unit:l.unit});cart();cust()}
async function clearCart(){if(!S.cart.length)return;if(UI().cfg('confirmClearCart')&&!(await UI().confirmBox('לבטל את כל העגלה?','בטל עגלה',{bad:1})))return;
 D().log('cartClear',{n:S.cart.length,gross:calc().gross});S.cart=[];S.cust=null;S.note='';S.manDisc=null;S.undo=null;cart();cust();UI().say('העגלה בוטלה')}
function setQty(key,q){q=Math.floor(+q);const i=S.cart.findIndex(l=>l.key===key);if(i<0)return;if(!(q>0)){delLine(key);return}S.cart[i]=Object.assign({},S.cart[i],{qty:Math.min(q,99999)});S.sel=key;cart();cust()}

/* ---------- הנחה ידנית (ס7, נ7–נ8): רק אחראי ומעלה. אחראי עד discMax.lead; מעבר – מנהל. מתחת למחיר מינימום – מנהל בלבד ---------- */
async function discount(){const{E,fmt,cfg,modal,parseAmt}=UI();if(!can(cfg('discRoles')||'lead')||!S.cart.length)return;const sel=S.cart.find(l=>l.key===S.sel)||S.cart[S.cart.length-1];
 const v=await modal(`<div class="pos-sh"><h2>הנחה</h2></div>
  <div class="pos-seg" role="radiogroup" aria-label="על מה ההנחה"><button type="button" role="radio" aria-checked="true" data-sc="line">שורה: ${E(sel.name)}</button><button type="button" role="radio" aria-checked="false" data-sc="all">כל העגלה</button></div>
  <div class="pos-grid2"><label class="pos-f"><span>אחוז</span><input id="dPct" inputmode="decimal" dir="ltr" data-autof aria-label="הנחה באחוזים"></label><label class="pos-f"><span>או סכום (₪)</span><input id="dAmt" inputmode="decimal" dir="ltr" aria-label="הנחה בשקלים"></label></div>
  <label class="pos-f"><span>סיבה</span><select id="dWhy" aria-label="סיבת ההנחה">${(cfg('discWhy')||['אחר']).map(x=>`<option>${E(x)}</option>`).join('')}</select></label>
  <div class="pos-row2"><button class="pos-b g" data-v="no">ביטול</button><button class="pos-b" data-v="ok" data-def>אישור הנחה</button></div>`,
  {label:'הנחה',init:w=>w.addEventListener('click',ev=>{const b=ev.target.closest('[data-sc]');if(b)w.querySelectorAll('[data-sc]').forEach(x=>x.setAttribute('aria-checked',String(x===b)))}),
   read:(w,v)=>v==='ok'?{sc:w.querySelector('[data-sc][aria-checked=true]').dataset.sc,pct:w.querySelector('#dPct').value.trim(),amt:w.querySelector('#dAmt').value.trim(),why:w.querySelector('#dWhy').value}:null});
 if(!v)return;const t=calc();const line=t.lines.find(l=>l.key===sel.key);const base=v.sc==='line'?line.unit*line.qty-(line.pdisc||0):t.lines.reduce((s,l)=>s+l.tot,0);
 let amt,pct=null;if(v.pct){pct=Number(v.pct.replace(',','.'));if(!(pct>0&&pct<=100)){UI().toast('אחוז לא תקין','bad');return}amt=PC().pctOf(base,pct)}else{amt=parseAmt(v.amt);if(!(amt>0)){UI().toast('סכום לא תקין','bad');return}}
 if(amt>base){UI().toast('ההנחה גדולה מהסכום','bad');return}
 const eff=base?amt*100/base:0,max=(cfg('discMax')||{}).lead||0;let need=eff>max+1e-9?'mgr':'lead';
 const minOk=v.sc==='line'?(line.unit*line.qty-(line.pdisc||0)-amt)>=(sel.min||0)*line.qty:true;if(!minOk)need='mgr';
 const ap=await UI().approve({role:role(),need,text:'הנחה של '+fmt(amt)+(eff?' ('+Math.round(eff*10)/10+'%)':'')});if(!ap.ok)return;
 const rec={amt,why:v.why,by:ap.by};if(pct!=null)rec.pct=pct;
 if(v.sc==='line'){const i=S.cart.findIndex(l=>l.key===sel.key);S.cart[i]=Object.assign({},S.cart[i],{mdisc:rec})}else S.manDisc=rec;
 D().log(minOk?'disc':'discOvr',Object.assign({sc:v.sc},rec));cart();cust()}
async function linePrice(key){const{modal,parseAmt}=UI();const l=S.cart.find(x=>x.key===key);if(!l||!l.gen)return;/* א 5.8: שינוי מחיר רק בשורת מוצר כללי */
 const v=await modal(`<div class="pos-sh"><h2>מחיר – ${UI().E(l.name)}</h2></div><label class="pos-f"><span>מחיר (₪)</span><input id="pAmt" data-autof inputmode="decimal" dir="ltr" aria-label="מחיר"></label><div class="pos-row2"><button class="pos-b g" data-v="no">ביטול</button><button class="pos-b" data-v="ok" data-def>שמירה</button></div>`,{label:'שינוי מחיר',read:(w,v)=>v==='ok'?parseAmt(w.querySelector('#pAmt').value):null});
 if(!(v>0))return;const i=S.cart.findIndex(x=>x.key===key);S.cart[i]=Object.assign({},l,{unit:v});cart();cust()}

/* ---------- לקוח, הערה, השהיות ---------- */
async function pickCust(){const c=await root.PosCust.pick({cur:S.cust});if(c===null)return;S.cust=c||null;cart();cust()}
async function note(){const{modal,E}=UI();const v=await modal(`<div class="pos-sh"><h2>הערה למכירה</h2></div><label class="pos-f"><span>מודפסת בקבלה</span><input id="nTxt" data-autof maxlength="120" value="${E(S.note)}" aria-label="הערה"></label><div class="pos-row2"><button class="pos-b g" data-v="no">ביטול</button><button class="pos-b" data-v="ok" data-def>שמירה</button></div>`,{label:'הערה',read:(w,v)=>v==='ok'?w.querySelector('#nTxt').value.trim():null});
 if(v!=null){S.note=v;cart()}}
async function park(){const{modal}=UI();if(!S.cart.length)return;const v=await modal(`<div class="pos-sh"><h2>השהיית עגלה</h2></div><label class="pos-f"><span>שם (לא חובה)</span><input id="kName" data-autof maxlength="30" aria-label="שם לעגלה המושהית"></label><div class="pos-row2"><button class="pos-b g" data-v="no">ביטול</button><button class="pos-b" data-v="ok" data-def>השהיה</button></div>`,{label:'השהיה',read:(w,v)=>v==='ok'?w.querySelector('#kName').value.trim():null});
 if(v==null)return;const s=S.sess||{};await D().park({name:v,lines:S.cart,cust:S.cust,note:S.note,manDisc:S.manDisc,gross:calc().gross,dev:s.dev,shift:(s.shift||{}).id,cashier:(s.cashier||{}).id});
 S.cart=[];S.cust=null;S.note='';S.manDisc=null;S.undo=null;cart();cust();refresh();UI().toast('העגלה הושהתה')}
async function parks(){const{modal,E,fmt,hm}=UI();const L=await D().parked();
 const v=await modal(`<div class="pos-sh"><h2>עגלות מושהות</h2></div><div class="pos-rl">${L.length?L.map(k=>`<button class="pos-kv pos-pick" data-v="${E(k.id)}" aria-label="${E(k.name||'ללא שם')} ${fmt(k.gross)}"><span>${E(k.name||'ללא שם')} <small>${hm(k.at)} · ${k.lines.length} שורות${k.st==='flag'?' · <b class="pos-flag">לטיפול</b>':''}</small></span><b>${fmt(k.gross)}</b></button>`).join(''):'<div class="pos-empty">אין עגלות מושהות</div>'}</div><button class="pos-b g w" data-v="no">סגירה</button>`,{label:'עגלות מושהות'});
 if(!v||v==='no')return;if(S.cart.length){UI().toast('יש עגלה פתוחה – השהו או סיימו אותה קודם','bad');return}const k=await D().unpark(v);if(!k)return;
 S.cart=k.lines.map(l=>Object.assign({},l,{key:'l'+(++seq)}));S.cust=k.cust||null;S.note=k.note||'';S.manDisc=k.manDisc||null;S.chg=null;cart();cust();refresh()}

/* ---------- תשלום וסיום ---------- */
async function pay(){const t=calc();if(!(t.gross>0)||S.busy)return;/* ס18: אין תשלום בעגלה ריקה */
 /* POS:W2 (איחוד): קופה שנותקה מרחוק / מושבתת / מחכה לאישור מכשיר (ש7) – לא מתחילים תשלום */
 try{const DV=root.Devices;if(DV&&typeof DV.blocked==='function'&&DV.blocked()){UI().toast((DV.msg&&DV.msg('BLOCKED'))||'הקופה חסומה למכירה. פנו למנהל','bad');return}}catch(e){}
 const r=await root.PosPay.open({gross:t.gross,cust:S.cust,role:role()});if(!r)return;await finish(t,r)}
async function finish(t,r){const{cfg,toast,fmt}=UI();S.busy=1;const s=S.sess||{};
 const sale={reqId:UI().reqId(),dev:s.dev,shift:(s.shift||{}).id,cashier:(s.cashier||{}).id,cust:S.cust?S.cust.id:null,note:S.note||'',
  lines:t.lines.map(l=>{const o={pid:l.pid,name:l.name,unit:l.unit,qty:l.qty,disc:l.disc,tot:l.tot,sd:l.sd,fin:l.fin};if(l.pdisc){o.pdisc=l.pdisc;o.promo=l.promo}if(l.mdisc)o.mdisc=l.mdisc;if(l.stock!=null)o.stk=l.stock;if(l.gen)o.gen=true;return o}),
  sub:t.sub,sdisc:t.sdisc||0,gross:t.gross,net:t.net,vat:t.vat,pays:r.pays,chg:r.chg,debt:r.debt};if(S.manDisc)sale.manDisc=S.manDisc;
 let res;try{res=await D().saveSale(sale)}catch(e){S.busy=0;toast('המכירה לא נשמרה: '+(e&&e.message||'נסו שוב'),'bad');return}
 const doc=Object.assign({},sale,res,{cashierNo:(s.cashier||{}).no,custObj:S.cust,fmt:S.cust&&S.cust.biz?cfg('rcptBizFmt'):'r'+(cfg('rcptWidth')||80)});
 S.last=doc;if(cfg('rcptPrint')==='always')UI().Dev.print({kind:'sale',doc});if(r.pays.some(p=>p.m==='cash'))UI().Dev.openDrawer('cash');
 S.cart=[];S.cust=null;S.note='';S.manDisc=null;S.undo=null;S.chg=r.chg||0;S.busy=0;cart();cust();refresh();focusQ();
 UI().say('המכירה נשמרה. '+(r.chg?'עודף '+fmt(r.chg):''))}
/* מכירה אחרונה (ס17): עותק, קבלת מתנה, שליחה */
function rcptHtml(d,gift){const{E,fmt,hm,dmy,M_NAME}=UI();return`<div class="pos-rcpt${gift?' gift':''}" aria-label="${gift?'קבלת מתנה':'קבלה'}"><p class="pos-note">${d.doc==='inv+rc'?'חשבונית מס + קבלה':'חשבונית מס קבלה'} מס' ${E(d.no)} · ${dmy(d.at)} ${hm(d.at)} · קופאי ${E(d.cashierNo||'')}</p>
 ${d.lines.map(l=>`<div class="pos-kv"><span>${E(l.name)}${l.qty!==1?` <small>${l.qty}${gift?'':' × '+fmt(l.unit)}</small>`:''}</span>${gift?'':`<b>${fmt(l.tot)}</b>`}</div>${!gift&&l.disc?`<div class="pos-kv sm"><span>הנחה</span><b>−${fmt(l.disc)}</b></div>`:''}`).join('')}
 ${gift?'<p class="pos-note">קבלת מתנה – בלי מחירים</p>':`${d.sdisc?`<div class="pos-kv"><span>הנחת חשבון</span><b>−${fmt(d.sdisc)}</b></div>`:''}<div class="pos-kv big"><span>סה"כ</span><b id="rcptTotal">${fmt(d.gross)}</b></div><div class="pos-kv"><span>מתוכו מע"מ 18%</span><b>${fmt(d.vat)}</b></div>
 ${d.pays.map(p=>`<div class="pos-kv"><span>${E(M_NAME[p.m])}</span><b>${fmt(p.amt)}</b></div>`).join('')}${d.debt?`<div class="pos-kv"><span>הקפה</span><b>${fmt(d.debt)}</b></div>`:''}${d.chg?`<div class="pos-kv"><span>עודף</span><b>${fmt(d.chg)}</b></div>`:''}`}
 ${d.note?`<p class="pos-note">${E(d.note)}</p>`:''}<p class="pos-note">${UI().cfg('rcptQr')?'[QR להורדת הקבלה] ':''}${UI().cfg('rcptBarcode')?'[ברקוד מסמך '+E(((UI().cfg('bc.prefixes')||{}).rcpt||'')+d.no)+']':''}</p></div>`}
async function last(){const{modal}=UI();const d=S.last;if(!d)return;
 const v=await modal(`<div class="pos-sh"><h2>מכירה אחרונה</h2></div>${rcptHtml(d,false)}<div class="pos-grid2"><button class="pos-b g" data-v="copy">הדפסת עותק</button>${UI().cfg('giftRcpt')?'<button class="pos-b g" data-v="gift">קבלת מתנה</button>':''}<button class="pos-b g" data-v="send">שליחה ללקוח</button><button class="pos-b" data-v="no" data-def>סגירה</button></div>`,{label:'מכירה אחרונה',cls:'wide'});
 if(v==='copy'){UI().Dev.print({kind:'sale',doc:d,copy:true});D().log('reprint',{no:d.no});UI().toast('נשלח להדפסה')}
 if(v==='gift'){UI().Dev.print({kind:'gift',doc:d});D().log('giftRcpt',{no:d.no});await modal(`<div class="pos-sh"><h2>קבלת מתנה</h2></div>${rcptHtml(d,true)}<button class="pos-b w" data-v="no" data-def>סגירה</button>`,{label:'קבלת מתנה'})}
 if(v==='send'){D().log('send',{no:d.no});UI().toast('השליחה הדיגיטלית תגיע עם מודול הקבלות')}}
async function ret(prefill){const r=await root.PosRet.open({role:role(),prefill});if(!r)return;UI().Dev.print({kind:'ret',doc:Object.assign({},r.ret,r.r)});
 if(r.ret.byM.cash)UI().Dev.openDrawer('refund');UI().toast('ההחזרה נשמרה: '+UI().fmt(r.ret.total));refresh()}

/* ברקוד לא מוכר (א 5.7): הוספה מהירה – המוצר נוצר, נמכר באותה מכירה, מסומן fromPos והמנהל מקבל התראה */
async function unknown(code){const{cfg,modal,E,parseAmt,toast}=UI();if(cfg('bc.unknown')!=='quickAdd'||cfg('bc.cashierCreate')==='never'){toast('ברקוד לא מוכר: '+code,'bad');return}
 const v=await modal(`<div class="pos-sh"><h2>ברקוד לא מוכר</h2></div><p class="pos-note" dir="ltr">${E(code)}</p><label class="pos-f"><span>שם המוצר</span><input id="uName" data-autof maxlength="40" aria-label="שם המוצר"></label><label class="pos-f"><span>מחיר (₪)</span><input id="uAmt" inputmode="decimal" dir="ltr" aria-label="מחיר"></label><div class="pos-row2"><button class="pos-b g" data-v="no">ביטול</button><button class="pos-b" data-v="ok" data-def>הוספה ומכירה</button></div>`,
  {label:'הוספה מהירה',check:w=>{if(!w.querySelector('#uName').value.trim()||!(parseAmt(w.querySelector('#uAmt').value)>0)){toast('חסר שם או מחיר','bad');return false}},read:(w,v)=>v==='ok'?{name:w.querySelector('#uName').value.trim(),price:parseAmt(w.querySelector('#uAmt').value)}:null});
 if(!v)return;try{const p=await D().quickAdd({barcode:code,name:v.name,price:v.price});addP(p)}catch(e){toast(e&&e.message||'ההוספה נכשלה','bad')}}

/* ---------- אירועים ---------- */
function onClick(ev){const b=ev.target.closest('[data-pa]');if(!b||!R||!R.contains(b)||b.disabled||b.closest('.pos-modal'))return;const a=b.dataset.pa,k=b.dataset.k;
 switch(a){
  case'add':{const p=S.res[+b.dataset.i];if(p)addP(p);break}
  case'cat':showCat(b.dataset.v);break;
  case'qty':{const l=S.cart.find(x=>x.key===k);if(l)setQty(k,l.qty+ +b.dataset.d);break}
  case'del':delLine(k);break;
  case'clear':clearCart();break;
  case'undo':undo();break;
  case'price':linePrice(k);break;
  case'pay':pay();break;
  case'cust':pickCust();break;
  case'note':note();break;
  case'disc':discount();break;
  case'undisc':S.manDisc=null;D().log('discOff',{});cart();cust();break;
  case'park':park();break;
  case'nav':if(b.dataset.v==='ret')ret();else if(b.dataset.v==='park')parks();break;
  case'last':last();break;
  case'custT':if(root.PosCustomer){root.PosCustomer.toggle();cust();top()}break;
  case'exit':close();break;
 }}
function onInput(ev){const t=ev.target;if(t.id==='posQ'){const q=t.value;requestAnimationFrame(()=>{if(S.open&&q===t.value)doSearch(q)})}}
function onChange(ev){const t=ev.target;if(t.dataset&&t.dataset.pq!=null)setQty(t.dataset.pq,t.value)}
/* מקלדת (שלב הלכידה): סורק → הוספה (או לחלון ההחזרה); Enter בחיפוש → הוספה; F2 חיפוש, F9 השהיה, F12 תשלום; Esc – חזרה */
function onKey(ev){if(!S.open)return;const now=ev.timeStamp||performance.now(),t=ev.target,{cfg}=UI();
 const code=scan.feed(ev.key,now);
 if(code&&!(t&&t.id==='payCode')){ev.preventDefault();ev.stopPropagation();if(t&&t.tagName==='INPUT'&&typeof t.value==='string'){t.value=root.PosScan.unscan(t.value,code);if(t.id==='posQ')doSearch(t.value)}onScan(code);return}
 if(ev.key==='Escape'){ev.preventDefault();back();return}
 if(cfg('kbdKeys')&&!UI().UI.stack.length){if(ev.key==='F2'){ev.preventDefault();focusQ();return}if(ev.key==='F9'){ev.preventDefault();park();return}if(ev.key==='F12'){ev.preventDefault();pay();return}}
 if(ev.key==='Enter'&&t&&t.id==='posQ'){ev.preventDefault();enterQ(t);return}
 if(ev.key==='Enter'&&t&&t.dataset&&t.dataset.pq!=null){ev.preventDefault();setQty(t.dataset.pq,t.value);focusQ();return}
 if(!UI().UI.stack.length&&ev.key.length===1&&!ev.ctrlKey&&!ev.metaKey&&!ev.altKey&&!(t&&/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))focusQ()}
async function enterQ(t){const q=t.value.trim();if(!q)return;let p=await D().byBarcode(q);if(!p&&S.res.length===1)p=S.res[0];if(p){addP(p);t.value='';doSearch('');return}
 if(/^\d{8,14}$/.test(q)){t.value='';doSearch('');return unknown(q)}UI().toast(S.res.length?'בחרו מוצר מהרשימה':'לא נמצא: '+q)}
async function onScan(code){const top=UI().UI.stack[UI().UI.stack.length-1];if(top){if(typeof top._scan==='function')top._scan(code);else UI().toast('סיימו את החלון הפתוח לפני סריקה');return}
 const pre=(UI().cfg('bc.prefixes')||{}).rcpt;if(pre&&code.startsWith(pre)&&!(await D().byBarcode(code))){if(!S.cart.length)return ret(code);UI().toast('סריקת קבלה – סיימו קודם את העגלה');return}
 const p=await D().byBarcode(code);if(!p){if(UI().cfg('bc.beep'))UI().Dev.beep('bad');return unknown(code)}addP(p)}

/* ---------- חיבור לאפליקציה ---------- */
root.posOpen=open;root.posClose=()=>close();root.POS_DEBUG={S,calc};
if(typeof ACT!=='undefined')ACT.posOpen=()=>open();
/* כפתור חזרה / החלקה: בזמן שהקופה פתוחה – מטופלים בתוך הקופה */
if(typeof root.goBack==='function'){const g0=root.goBack;root.goBack=function(){if(S.open)return back();return g0.apply(this,arguments)}}
/* מסך "קופה" של שלב 0 (pos-base.js): כשהמכשיר רשום כקופה פעילה – כפתור פתיחה. בנתונים מדומים – כפתור תצוגה מקדימה גם בלי רישום */
if(typeof V!=='undefined'&&typeof V.pos==='function'){const p0=V.pos;V.pos=function(){const r=p0.apply(this,arguments);try{if(r&&typeof r.h==='string'&&!r.h.includes('התכונה לא פעילה')){
 const btn=`<button class="btn w" data-a="posOpen" style="margin-top:10px">פתיחת הקופה</button>`;
 if(r.h.includes('מסך המכירה ייפתח כאן בשלב הבא'))r.h=r.h.replace(/<p class="note" style="margin:0">מסך המכירה ייפתח כאן בשלב הבא\.<\/p>/,btn);
 else if(root.PosData&&root.PosData.isMock&&!r.h.includes('טוען'))r.h+=`<div class="card"><p class="note" style="margin:0">תצוגה מקדימה – נתונים מדומים בלבד, שום דבר לא נשמר בעסק.</p>${btn}</div>`}}catch(e){}return r}}
})(typeof window!=='undefined'?window:globalThis);
