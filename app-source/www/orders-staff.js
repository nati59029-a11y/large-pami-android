/* ORD:1 – מערכת הזמנות, שלב 1: עובד מכניס הזמנות, מלאי לכל סניף, כרטיס הזמנה ותשלום ידני. קובץ עצמאי, נטען אחרי index.html.
   מסכים: V.ox (רשימה), V.oxNew (הזמנה חדשה), V.oxOrd (כרטיס הזמנה), V.oxStock (מלאי), V.oxCfg (מקור מלאי לכל סניף, מנהל),
   ובכרטיס העסק של מנהל־על – "תשלום בהזמנות" (קישור סליקה / תשלום בטלפון).
   כל כתיבה – רק דרך פונקציות השרת (functions/orders.js). קריאה – Firestore לפי החוקים (ord, prod, stockLog, ordcfg).
   ההרשאות נאכפות בשרת ובחוקים; כאן רק מה מוצג למי. קישור הסליקה לא מוצג לעולם – getPayLink מחזיר אותו ונפתח מיד.
   רכיבי D1 בלבד (.li .card .btn .chip .f .tag .sec .empty .note), בלי צבע קבוע. משתמש ב: V, ACT, FRM, INP, fsx, fnCall, fvj, idOf,
   esc, ils, dlg, closeDlg, ask, toast, go, cur, rerender, isA, isW, wp, bzF, brAll, brList, brMineIds, brNm, SY, ADM. */
(function(){
'use strict';
if(typeof ACT==='undefined'||typeof V==='undefined')return;
const NB='_';
const ST={new:'חדשה',work:'בטיפול',wait_pay:'ממתין לתשלום',paid:'שולם',out:'יצא למשלוח',done:'הושלם',cancel:'בוטלה'};
const NEXT={new:['work','wait_pay'],work:['wait_pay','new'],wait_pay:['work'],paid:['out','done'],out:['done'],done:[],cancel:[]};
const PM=[['link','אשראי בקישור'],['phone','אשראי בטלפון'],['cash','מזומן'],['transfer','העברה'],['other','אחר']];
const WHY={in:'הכנסת מלאי',set:'תיקון כמות',zero:'נגמר במלאי',order:'הזמנה',xout:'הועבר לסניף אחר',xin:'העברה נכנסת',cancel:'ביטול הזמנה',edit:'עריכת הזמנה'};
const O={L:null,P:null,cfg:null,err:'',busy:0,at:0,st:'open',log:{},sl:null,draft:null};
const on=()=>(isA()||isW()||!!(SY&&SY.sa))&&bzF('orders')&&wp('ord');
const mgr=()=>isA()||!!(SY&&SY.sa);
const brs=()=>brAll().filter(b=>b.on);
const hasBr=()=>brs().length>0;
const mine=()=>brMineIds();
const myBr=()=>hasBr()?brList():[];
const bn=id=>id===NB||!id?'':brNm(id);
const rid=()=>{const a=new Uint8Array(12);crypto.getRandomValues(a);return 'r'+[...a].map(x=>x.toString(36).padStart(2,'0')).join('').slice(0,22)};
const dec=d=>Object.assign({id:idOf(d)},Object.fromEntries(Object.entries(d.fields||{}).map(([k,v])=>[k,fvj(v)])));
const tm=t=>{if(!t)return '';const d=new Date(t);return d.toLocaleDateString('he-IL',{day:'numeric',month:'numeric'})+' '+d.toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'})};
const q=(p,br)=>{const v=p&&p.q&&typeof p.q==='object'?p.q[br]:0;return typeof v==='number'?v:0};
const qAll=p=>Object.values(p&&p.q||{}).reduce((s,v)=>s+(typeof v==='number'?v:0),0);
const n3=x=>Math.round(x*1000)/1000;
const err=e=>toast(e&&e.message||'הפעולה נכשלה');

/* ---------- קריאה ---------- */
async function runQ(coll,where,lim){const sq={from:[{collectionId:coll}],limit:lim||500};if(where)sq.where=where;
 const r=await fsx(':runQuery',{method:'POST',body:JSON.stringify({structuredQuery:sq})});return(r||[]).filter(x=>x.document).map(x=>dec(x.document))}
const brWhere=()=>{const m=mine();return m&&hasBr()?{fieldFilter:{field:{fieldPath:'br'},op:'IN',value:{arrayValue:{values:m.slice(0,30).map(s=>({stringValue:s}))}}}}:null};
let load=async function(force){if(O.busy||(!force&&O.L&&Date.now()-O.at<20000))return;O.busy=1;O.err='';
 try{const[L,P,c]=await Promise.all([runQ('ord',brWhere(),500),runQ('prod',null,2000),fsx('/ordcfg/main').catch(e=>{if(e.code===404)return null;throw e})]);
  O.L=L.sort((a,b)=>(b.no||0)-(a.no||0));O.P=P.sort((a,b)=>String(a.name).localeCompare(String(b.name),'he'));O.cfg=c?dec(c):{};O.at=Date.now()}
 catch(e){O.err=e.message||'הטעינה נכשלה'}finally{O.busy=0;if(/^ox/.test(cur().v)&&!typing())rerender()}}
// בכל מסך עם הקלדה – רענון לא בונה מחדש כשיש טקסט בתיבה (לקח)
const typing=()=>{const a=document.activeElement;return !!(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)&&a.closest('#main'))};
const prod=id=>(O.P||[]).find(p=>p.id===id);
const srcOf=br=>{const s=O.cfg&&O.cfg.src&&O.cfg.src[br];return s&&s!=='stock'&&brs().some(b=>b.id===s)?s:'stock'};
const payMode=()=>{const p=O.cfg&&O.cfg.pay;return p&&p.mode==='link'&&p.has?'link':'phone'};
const loading=t=>({t,h:O.err?`<div class="card"><p class="note">${esc(O.err)}</p><button class="btn g w" data-a="oxRe">נסה שוב</button></div>`:'<div class="empty">טוען…</div>'});
const deny=t=>({t,h:'<div class="empty">אין לך הרשאה להזמנות</div>'});
ACT.oxRe=()=>load(true);

/* ---------- כניסה: אריח לעובד, שורה ב"עוד" למנהל, באנר בבית ---------- */
window.oxTile=()=>on()?`<button class="tile" data-a="go" data-v="ox" style="font-size:1.15rem;text-align:center;border-color:var(--acc);color:var(--acc)">${ico('doc')}הזמנות</button>`:'';
{const m=V.more;if(m)V.more=()=>{const r=m();if(on()&&r&&r.h)r.h=r.h.replace('<div class="mlist">',`<div class="mlist"><button class="opt" data-a="go" data-v="ox"><span>הזמנות<small>הזמנות לקוחות, מלאי ותשלום</small></span>${openN()?`<span class="tag t1">${openN()}</span>`:''}${ico('chev')}</button>`);return r}}
{const h=V.home;if(h)V.home=()=>{const r=h();if(on()&&r&&r.h){if(!O.L)load();const n=openN(),s=sumMonth();if(O.L&&(n||s))r.h=r.h.replace(/(<div class="chips hacts")/,`<button class="ban" style="margin-top:12px" data-a="go" data-v="ox"><span class="tag t1">הזמנות</span><span style="flex:1"><b>${n}</b> פתוחות · החודש שולם <b>${ils(s)}</b></span>${ico('chev')}</button>$1`)}return r}}
const openN=()=>(O.L||[]).filter(o=>!['done','cancel'].includes(o.status)).length;
const sumMonth=()=>{const d=new Date(),m0=new Date(d.getFullYear(),d.getMonth(),1).getTime();return(O.L||[]).filter(o=>o.paid&&o.paid.at>=m0&&o.status!=='cancel').reduce((s,o)=>s+(o.total||0),0)};

/* ---------- רשימת הזמנות ---------- */
const FL=[['open','פתוחות'],['new','חדשה'],['work','בטיפול'],['wait_pay','ממתין לתשלום'],['paid','שולם'],['out','יצא למשלוח'],['done','הושלם'],['cancel','בוטלה'],['all','הכול']];
let OBR='';
V.ox=()=>{const T='הזמנות';if(!on())return deny(T);if(!O.L){load();return loading(T)}
 const L0=O.L.filter(o=>!OBR||o.br===OBR),cnt=k=>k==='all'?L0.length:k==='open'?L0.filter(o=>!['done','cancel'].includes(o.status)).length:L0.filter(o=>o.status===k).length;
 const L=L0.filter(o=>O.st==='all'||(O.st==='open'?!['done','cancel'].includes(o.status):o.status===O.st));
 const B=myBr(),bc=B.length>1?`<div class="chips scroll-x" role="group" aria-label="סינון לפי סניף" style="margin:8px 0"><button class="chip ${OBR?'':'on'}" data-a="oxBr" data-id="" aria-pressed="${!OBR}">כל הסניפים</button>${B.map(b=>`<button class="chip ${OBR===b.id?'on':''}" data-a="oxBr" data-id="${esc(b.id)}" aria-pressed="${OBR===b.id}">${esc(b.name)}</button>`).join('')}</div>`:'';
 const sc=`<div class="chips scroll-x" role="group" aria-label="סינון לפי סטטוס" style="margin:8px 0">${FL.map(([k,l])=>`<button class="chip ${O.st===k?'on':''}" data-a="oxSt" data-k="${k}" aria-pressed="${O.st===k}">${l} ${cnt(k)}</button>`).join('')}</div>`;
 const top=`<div class="row" style="margin-bottom:8px"><button class="btn grow" data-a="go" data-v="oxNew">${ico('plus')}הזמנה חדשה</button><button class="btn g grow" data-a="go" data-v="oxStock">מלאי</button></div>${mgr()&&hasBr()?'<button class="btn g s w" data-a="go" data-v="oxCfg">מאיזה סניף יורד המלאי</button>':''}`;
 const kp=mgr()?`<div class="card" style="margin:8px 0"><div class="row" style="justify-content:space-between"><span><small class="note">פתוחות</small><br><b class="amt">${cnt('open')}</b></span><span><small class="note">ממתין לתשלום</small><br><b class="amt">${cnt('wait_pay')}</b></span><span><small class="note">שולם החודש</small><br><b class="amt">${ils(sumMonth())}</b></span></div></div>`:'';
 return{t:T,s:hasBr()&&mine()?mine().map(bn).join(', '):'הזמנות לקוחות',h:top+kp+bc+sc+(L.length?L.map(row).join(''):`<div class="empty">אין הזמנות${O.st==='open'?' פתוחות':''}</div>`)+`<button class="btn g s w" style="margin-top:8px" data-a="oxRe">רענן</button>`}};
const row=o=>`<button class="li" data-a="go" data-v="oxOrd" data-arg="${esc(o.id)}"><div class="m"><b>#${o.no} · ${esc(o.cust&&o.cust.name||'')}</b><small>${tm(o.at)}${hasBr()&&o.br!==NB?' · '+esc(bn(o.br)):''} · ${(o.items||[]).length} פריטים</small></div><span class="tag">${ST[o.status]||o.status}</span><b class="a">${ils(o.total)}</b></button>`;
ACT.oxSt=el=>{O.st=el.dataset.k;rerender()};
ACT.oxBr=el=>{OBR=el.dataset.id;rerender()};

/* ---------- הזמנה חדשה ---------- */
function draft(){if(!O.draft){const B=myBr();O.draft={br:B.length===1?B[0].id:'',name:'',phone:'',tz:'',addr:'',mail:'',note:'',items:[],q:'',req:rid()}}return O.draft}
const lineH=(it,i,br)=>{const p=it.pid?prod(it.pid):null,src=hasBr()&&br?srcOf(br):null;
 let stock='';if(p){const from=it.from||br||NB;stock=`<small class="note">במלאי${hasBr()?' ב'+esc(bn(from)):''}: <b>${n3(q(p,from))}</b>${q(p,from)<it.qty?' – אין מספיק, ההזמנה תישמר והמלאי ירד למינוס':''}</small>`;}
 const sel=p&&hasBr()&&br&&src==='stock'?`<label class="f"><span>הסחורה מסניף</span><select data-i="oxLn" data-k="from" data-n="${i}">${brs().map(b=>`<option value="${esc(b.id)}"${(it.from||br)===b.id?' selected':''}>${esc(b.name)} (${n3(q(p,b.id))})</option>`).join('')}</select></label>`:p&&hasBr()&&br&&src!=='stock'?`<small class="note">יורד ממלאי ${esc(bn(src))} (הגדרת המנהל)</small>`:'';
 return `<div class="card" style="margin:6px 0">${p?`<b>${esc(p.name)}</b>`:`<label class="f"><span>פריט</span><input data-i="oxLn" data-k="n" data-n="${i}" value="${esc(it.n||'')}" maxlength="80"></label>`}
 <div class="row"><label class="f grow"><span>כמות</span><input data-i="oxLn" data-k="qty" data-n="${i}" inputmode="decimal" value="${esc(it.qty)}"></label><label class="f grow"><span>מחיר ליחידה ₪</span><input data-i="oxLn" data-k="price" data-n="${i}" inputmode="decimal" value="${esc(it.price)}"></label></div>
 ${stock}${sel}<button type="button" class="btn g s" data-a="oxLnDel" data-n="${i}">הסר שורה</button></div>`};
// "לפי המלאי": מוצע הסניף שיש בו מספיק (קודם הסניף של ההזמנה) – כמו בשרת
function suggest(p,br,qty){if(!hasBr()||!br||srcOf(br)!=='stock')return '';if(q(p,br)>=qty)return '';const c=brs().map(b=>b.id).filter(b=>q(p,b)>=qty);return c.length?c[0]:''}
V.oxNew=()=>{const T='הזמנה חדשה';if(!on())return deny(T);if(!O.P){load();return loading(T)}const D=draft(),B=myBr();
 const brH=B.length>1?`<label class="f"><span>סניף ההזמנה</span><select data-i="oxD" data-k="br" required><option value="">בחר סניף</option>${B.map(b=>`<option value="${esc(b.id)}"${D.br===b.id?' selected':''}>${esc(b.name)}</option>`).join('')}</select></label>`:B.length===1?`<p class="note">סניף: ${esc(B[0].name)}</p>`:'';
 const f=(l,k,t,x)=>`<label class="f"><span>${l}</span><input data-i="oxD" data-k="${k}" type="${t||'text'}" value="${esc(D[k])}" ${x||''}></label>`;
 const hits=D.q?(O.P||[]).filter(p=>p.on!==false&&(String(p.name).includes(D.q)||(p.barcode&&String(p.barcode)===D.q.trim()))).slice(0,8):[];
 const tot=D.items.reduce((s,it)=>s+Math.round((+it.qty||0)*(+it.price||0)*100),0)/100;
 return{t:T,s:'פרטי לקוח ומוצרים',h:`<div class="card">${brH}${f('שם הלקוח','name','text','maxlength="60" autocomplete="off"')}${f('טלפון','phone','tel','inputmode="tel" autocomplete="off"')}
 <details><summary class="note" style="min-height:44px;display:flex;align-items:center">ת.ז, כתובת ומייל (רשות)</summary>${f('ת.ז','tz','text','inputmode="numeric" maxlength="9"')}${f('כתובת','addr','text','maxlength="150"')}${f('מייל','mail','email','dir="ltr"')}</details></div>
 <div class="sec"><h3>מוצרים</h3></div>
 <label class="f"><span>חיפוש מוצר (שם או ברקוד)</span><input data-i="oxQ" value="${esc(D.q)}" autocomplete="off" id="oxq"></label>
 <div id="oxhits">${hitsH(hits,D)}</div>
 <button type="button" class="btn g s w" data-a="oxFree">＋ שורה חופשית (לא מהמלאי)</button>
 <div id="oxlines">${D.items.map((it,i)=>lineH(it,i,D.br)).join('')}</div>
 ${f('הערה (לא להקליד פרטי אשראי)','note','text','maxlength="300"')}
 <div class="card" style="margin:10px 0"><div class="row" style="justify-content:space-between"><b>סה״כ</b><b class="amt" id="oxtot">${ils(tot)}</b></div><p class="note" style="margin:4px 0 0">הסכום הסופי מחושב בשרת.</p></div>
 <button class="btn w" data-a="oxSave">שמור הזמנה</button><button class="btn g w" style="margin-top:8px" data-a="oxDrop">נקה טופס</button>`}};
const hitsH=(hits,D)=>hits.map(p=>`<button type="button" class="li" data-a="oxAdd" data-id="${esc(p.id)}"><div class="m"><b>${esc(p.name)}</b><small>${hasBr()&&D.br?'במלאי ב'+esc(bn(D.br))+': '+n3(q(p,D.br))+' · ':''}סה״כ במלאי: ${n3(hasBr()?qAll(p):q(p,NB))}</small></div><b class="a">${ils(p.price)}</b></button>`).join('')||(D.q?'<p class="note">לא נמצא מוצר. אפשר להוסיף שורה חופשית או מוצר חדש במסך המלאי.</p>':'');
INP.oxD=el=>{const D=draft();D[el.dataset.k]=el.value;if(el.dataset.k==='br'){D.items.forEach(it=>{if(it.pid)it.from=suggest(prod(it.pid),D.br,+it.qty||0)||''});redrawLines()}};
INP.oxQ=el=>{const D=draft();D.q=el.value;const hits=D.q?(O.P||[]).filter(p=>p.on!==false&&(String(p.name).includes(D.q)||(p.barcode&&String(p.barcode)===D.q.trim()))).slice(0,8):[];const h=document.getElementById('oxhits');if(h)h.innerHTML=hitsH(hits,D)};
INP.oxLn=el=>{const D=draft(),it=D.items[+el.dataset.n];if(!it)return;it[el.dataset.k]=el.value;if(el.dataset.k==='from'||el.tagName==='SELECT')redrawLines();else totRedraw()};
function totRedraw(){const D=draft(),t=document.getElementById('oxtot');if(t)t.textContent=ils(D.items.reduce((s,it)=>s+Math.round((+it.qty||0)*(+it.price||0)*100),0)/100)}
function redrawLines(){const D=draft(),l=document.getElementById('oxlines');if(l)l.innerHTML=D.items.map((it,i)=>lineH(it,i,D.br)).join('');totRedraw()}
ACT.oxAdd=el=>{const D=draft(),p=prod(el.dataset.id);if(!p)return;const ex=D.items.find(it=>it.pid===p.id);if(ex)ex.qty=String((+ex.qty||0)+1);else D.items.push({pid:p.id,qty:'1',price:String(p.price),from:suggest(p,D.br,1)});D.q='';rerender()};
ACT.oxFree=()=>{draft().items.push({n:'',qty:'1',price:''});rerender()};
ACT.oxLnDel=el=>{draft().items.splice(+el.dataset.n,1);rerender()};
ACT.oxDrop=()=>ask('לנקות את הטופס?',()=>{O.draft=null;rerender()},'כן, נקה');
const num=v=>{const x=+String(v).replace(',','.');return isFinite(x)?x:NaN};
function itemsOut(items){const out=[];for(const it of items){const qty=num(it.qty),price=num(it.price);if(!(qty>0))throw new Error('כמות לא תקינה');if(!(price>=0))throw new Error('מחיר לא תקין');
 const o={qty,price};if(it.pid){o.pid=it.pid;if(it.from)o.from=it.from}else{if(!String(it.n||'').trim())throw new Error('חסר שם לשורה חופשית');o.n=String(it.n).trim()}out.push(o)}return out}
ACT.oxSave=async el=>{const D=draft();let items;try{if(hasBr()&&!D.br)throw new Error('בחר סניף');if(!D.name.trim())throw new Error('חסר שם לקוח');if(!D.phone.trim())throw new Error('חסר טלפון');if(!D.items.length)throw new Error('הוסף לפחות פריט אחד');items=itemsOut(D.items)}catch(e){return toast(e.message)}
 const cust={name:D.name,phone:D.phone};if(D.tz)cust.tz=D.tz;if(D.addr)cust.addr=D.addr;if(D.mail)cust.mail=D.mail;
 el.disabled=true;try{const r=await fnCall('createOrder',{reqId:D.req,br:hasBr()?D.br:undefined,cust,items,note:D.note||undefined});O.draft=null;
  toast(`הזמנה #${r.no} נשמרה · ${ils(r.total)}`);if(r.warn&&r.warn.length)setTimeout(()=>toast('שים לב: אין מספיק במלאי – '+r.warn.map(w=>w.n+(hasBr()?' ב'+bn(w.br):'')).join(', ')),2700);
  await load(true);NAV.pop();go('oxOrd',r.id)}catch(e){el.disabled=false;err(e)}};

/* ---------- כרטיס הזמנה ---------- */
V.oxOrd=id=>{const T='הזמנה';if(!on())return deny(T);if(!O.L){load();return loading(T)}const o=O.L.find(x=>x.id===id);if(!o)return{t:T,h:'<div class="empty">ההזמנה לא נמצאה</div>'};
 const c=o.cust||{},open=['new','work','wait_pay'].includes(o.status);
 const items=(o.items||[]).map(it=>`<div class="li" style="cursor:default"><div class="m"><b>${esc(it.n)}</b><small>${n3(it.qty)} × ${ils(it.price)}${it.from&&hasBr()?' · מסניף '+esc(bn(it.from)):''}</small></div><b class="a">${ils(Math.round(it.qty*it.price*100)/100)}</b></div>`).join('');
 const nx=(NEXT[o.status]||[]).map(s=>`<button class="btn g grow" data-a="oxStat" data-id="${esc(o.id)}" data-s="${s}">${ST[s]}</button>`).join('');
 const pay=open?(payMode()==='link'?`<button class="btn w" data-a="oxPay" data-id="${esc(o.id)}">לתשלום</button><p class="note">נפתח דף הסליקה של העסק. מקלידים שם את פרטי האשראי של הלקוח – הם לא נשמרים באפליקציה.</p>`:`<a class="btn w" href="tel:${esc(c.phone)}" data-a="oxCall" data-id="${esc(o.id)}" style="display:flex;align-items:center;justify-content:center;text-decoration:none">תשלום בטלפון</a><p class="note">התקשר ללקוח וגבה בטלפון. אחר כך סמן "שולם".</p>`)+`<button class="btn g w" data-a="oxPaid" data-id="${esc(o.id)}">סמן שולם</button>`:'';
 const paid=o.paid?`<div class="card"><b>שולם ${ils(o.paid.amt!=null?o.paid.amt:o.total)}</b><p class="note" style="margin:4px 0 0">${(PM.find(x=>x[0]===o.paid.method)||[0,o.paid.method])[1]}${o.paid.last4?' · ****'+esc(o.paid.last4):''}${o.paid.conf?' · אישור '+esc(o.paid.conf):''} · ${tm(o.paid.at)}${o.paid.sup?' · זיכוי אצל '+esc(o.paid.sup.name):''}</p>${mgr()&&o.status==='paid'?`<button class="btn g s" data-a="oxUnpay" data-id="${esc(o.id)}">ביטול "שולם"</button>`:''}</div>`:'';
 const lg=O.log[id];if(lg===undefined){O.log[id]=null;logLoad(id)}
 return{t:'הזמנה #'+o.no,s:ST[o.status],h:`<div class="card"><div class="row" style="justify-content:space-between"><b>${esc(c.name||'')}</b><span class="tag">${ST[o.status]}</span></div>
 <p style="margin:6px 0"><a href="tel:${esc(c.phone)}" dir="ltr" data-a="oxCall" data-id="${esc(o.id)}" style="color:var(--acc);display:inline-flex;min-height:44px;align-items:center">${esc(c.phone||'')}</a>${o.calledAt?` <small class="note">· חייגת ${tm(o.calledAt)}</small>`:''}</p>
 ${c.addr?`<p class="note" style="margin:0">${esc(c.addr)}</p>`:''}${c.mail?`<p class="note" style="margin:0" dir="ltr">${esc(c.mail)}</p>`:''}${c.tz?`<p class="note" style="margin:0">ת.ז ${esc(c.tz)}</p>`:''}
 <p class="note" style="margin:6px 0 0">${tm(o.at)}${hasBr()&&o.br!==NB?' · סניף '+esc(bn(o.br)):''}${o.byName?' · הזין '+esc(o.byName):''}</p>${o.note?`<p style="margin:6px 0 0">${esc(o.note)}</p>`:''}</div>
 <div class="sec"><h3>פריטים</h3>${open?`<button class="btn s g" data-a="oxEdit" data-id="${esc(o.id)}">עריכה</button>`:''}</div>${items}
 <div class="card"><div class="row" style="justify-content:space-between"><b>סה״כ</b><b class="amt">${ils(o.total)}</b></div>${open?'':'<p class="note" style="margin:4px 0 0">הסכום נעול.</p>'}</div>
 ${o.status==='cancel'?`<div class="card"><b>בוטלה</b><p class="note" style="margin:4px 0 0">${esc(o.cancel&&o.cancel.reason||'')}</p></div>`:''}
 ${paid}${pay?`<div class="sec"><h3>תשלום</h3></div>${pay}`:''}
 ${nx?`<div class="sec"><h3>שינוי סטטוס</h3></div><div class="row">${nx}</div>`:''}
 ${o.status!=='done'&&o.status!=='cancel'&&(open||mgr())?`<button class="btn g w" style="margin-top:14px" data-a="oxCancel" data-id="${esc(o.id)}">ביטול הזמנה</button>`:''}
 <div class="sec"><h3>היסטוריה</h3></div>${lg?lg.map(x=>`<div class="note" style="padding:6px 0;border-bottom:1px solid var(--line)">${tm(x.t)} · ${esc(LOGW[x.act]||x.act)}${x.note?' · '+esc(x.note):''}</div>`).join('')||'<p class="note">אין</p>':'<p class="note">טוען…</p>'}`}};
const LOGW={create:'נוצרה',edit:'נערכה',status:'סטטוס',paid:'סומן שולם',unpay:'בוטל "שולם"',cancel:'בוטלה',called:'חייגו ללקוח',payOpen:'נפתח דף התשלום'};
async function logLoad(id){try{const r=await fsx('/ord/'+id+'/log?pageSize=100');O.log[id]=((r&&r.documents)||[]).map(dec).sort((a,b)=>b.t-a.t)}catch(e){O.log[id]=[]}if(cur().v==='oxOrd'&&!typing())rerender()}
async function after(id){O.log[id]=undefined;await load(true)}
ACT.oxStat=async el=>{el.disabled=true;try{await fnCall('setOrderStatus',{id:el.dataset.id,status:el.dataset.s});toast('הסטטוס עודכן');await after(el.dataset.id)}catch(e){el.disabled=false;err(e)}};
ACT.oxCall=el=>{fnCall('markOrderCalled',{id:el.dataset.id}).then(()=>after(el.dataset.id)).catch(()=>{})/* החיוג עצמו – הקישור tel: */};
ACT.oxPay=async el=>{el.disabled=true;try{const r=await fnCall('getPayLink',{id:el.dataset.id});const u=String(r&&r.link||'');if(!/^https:\/\//.test(u))throw new Error('קישור התשלום לא תקין');window.open(u,'_system');O.log[el.dataset.id]=undefined;setTimeout(rerender,600)}catch(e){err(e)}finally{el.disabled=false}};
ACT.oxPaid=el=>{const id=el.dataset.id,o=(O.L||[]).find(x=>x.id===id);if(!o)return;
 dlg(`<h3>סימון שולם · ${ils(o.total)}</h3><form data-f="oxPaidF"><input type="hidden" name="id" value="${esc(id)}"><label class="f"><span>אמצעי תשלום</span><select name="method" required>${PM.map(([k,l])=>`<option value="${k}"${k===(payMode()==='link'?'link':'phone')?' selected':''}>${l}</option>`).join('')}</select></label>
 <label class="f"><span>4 ספרות אחרונות של הכרטיס (רשות)</span><input name="last4" inputmode="numeric" maxlength="4" pattern="\\d{4}" autocomplete="off"></label><label class="f"><span>מספר אישור (רשות)</span><input name="conf" maxlength="20" autocomplete="off" dir="ltr"></label>
 <p class="note">לא מקלידים כאן מספר כרטיס מלא, תוקף או קוד – זה נדחה.</p><div class="row"><button class="btn grow">שולם</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`)};
FRM.oxPaidF=async f=>{const x=fd(f),b=f.querySelector('button');if(x.last4&&!/^\d{4}$/.test(x.last4))return toast('4 ספרות בדיוק');b.disabled=true;
 try{await fnCall('markOrderPaid',{id:x.id,method:x.method,last4:x.last4||undefined,conf:x.conf||undefined});closeDlg();toast('סומן שולם');await after(x.id)}catch(e){b.disabled=false;err(e)}};
const reasonDlg=(ttl,fn,ok)=>{dlg(`<h3>${esc(ttl)}</h3><form data-f="oxWhy"><label class="f"><span>סיבה (חובה)</span><input name="r" required maxlength="200"></label><div class="row"><button class="btn r grow">${ok}</button><button type="button" class="btn g grow" data-a="closeDlg">חזרה</button></div></form>`);O.why=fn};
FRM.oxWhy=async f=>{const r=fd(f).r.trim();if(!r)return;const b=f.querySelector('button');b.disabled=true;try{await O.why(r);closeDlg()}catch(e){b.disabled=false;err(e)}};
ACT.oxCancel=el=>{const id=el.dataset.id;reasonDlg('לבטל את ההזמנה? המלאי יחזור.',async r=>{await fnCall('cancelOrder',{id,reason:r});toast('ההזמנה בוטלה');await after(id)},'בטל הזמנה')};
ACT.oxUnpay=el=>{const id=el.dataset.id;reasonDlg('לבטל את סימון "שולם"? ההזמנה תחזור ל"ממתין לתשלום".',async r=>{await fnCall('unpayOrder',{id,reason:r});toast('"שולם" בוטל');await after(id)},'בטל "שולם"')};
ACT.oxEdit=el=>{const o=(O.L||[]).find(x=>x.id===el.dataset.id);if(!o)return;O.ed={id:o.id,items:(o.items||[]).map(it=>({pid:it.pid,n:it.n,qty:String(it.qty),price:String(it.price),from:it.from||''}))};
 dlg(edH());};
const edH=()=>`<h3>עריכת פריטים</h3><form data-f="oxEdF">${O.ed.items.map((it,i)=>`<div class="card" style="margin:6px 0"><b>${esc(it.n||'פריט')}</b><div class="row"><label class="f grow"><span>כמות</span><input name="q${i}" inputmode="decimal" value="${esc(it.qty)}"></label><label class="f grow"><span>מחיר ₪</span><input name="p${i}" inputmode="decimal" value="${esc(it.price)}"></label></div><label class="cb" style="min-height:44px;display:flex;align-items:center;gap:6px"><input type="checkbox" name="d${i}"> הסר</label></div>`).join('')}<p class="note">שינוי מחיר נרשם בהיסטוריה. המלאי מתעדכן לפי ההפרש.</p><div class="row"><button class="btn grow">שמור</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`;
FRM.oxEdF=async f=>{const x=fd(f),E=O.ed;const L=E.items.map((it,i)=>Object.assign({},it,{qty:x['q'+i],price:x['p'+i]})).filter((it,i)=>!x['d'+i]);let items;try{if(!L.length)throw new Error('צריך לפחות פריט אחד. לביטול – "ביטול הזמנה".');items=itemsOut(L)}catch(e){return toast(e.message)}
 const b=f.querySelector('button');b.disabled=true;try{const r=await fnCall('updateOrder',{id:E.id,items});closeDlg();toast('נשמר · '+ils(r.total));if(r.warn&&r.warn.length)setTimeout(()=>toast('אין מספיק במלאי: '+r.warn.map(w=>w.n).join(', ')),2700);await after(E.id)}catch(e){b.disabled=false;err(e)}};

/* ---------- מלאי ---------- */
let SBR='';
V.oxStock=()=>{const T='מלאי';if(!on())return deny(T);if(!O.P){load();return loading(T)}const B=myBr();if(hasBr()&&!SBR&&B.length)SBR=B[0].id;const br=hasBr()?SBR:NB;
 const bc=B.length>1?`<div class="chips scroll-x" role="group" aria-label="סניף" style="margin:8px 0">${B.map(b=>`<button class="chip ${SBR===b.id?'on':''}" data-a="oxSBr" data-id="${esc(b.id)}" aria-pressed="${SBR===b.id}">${esc(b.name)}</button>`).join('')}</div>`:B.length===1?`<p class="note">סניף: ${esc(B[0].name)}</p>`:'';
 const L=(O.P||[]).filter(p=>!O.sq||String(p.name).includes(O.sq)||String(p.barcode||'')===O.sq.trim());
 return{t:T,s:hasBr()?bn(br):'כמויות במלאי',h:`<div class="row" style="margin-bottom:8px"><button class="btn grow" data-a="oxIn">הכנסת מלאי</button><button class="btn g grow" data-a="oxNewP">מוצר חדש</button></div>${bc}
 <label class="f"><span>חיפוש (שם או ברקוד)</span><input data-i="oxSQ" value="${esc(O.sq||'')}" autocomplete="off"></label>
 <div id="oxpl">${plH(L,br)}</div><button class="btn g s w" style="margin-top:8px" data-a="oxHist">היסטוריית תנועות</button>`}};
const plH=(L,br)=>L.map(p=>`<div class="li" style="cursor:default;flex-wrap:wrap"><div class="m"><b>${esc(p.name)}${p.on===false?' <span class="tag">לא זמין</span>':''}</b><small>${ils(p.price)}${p.barcode?' · '+esc(p.barcode):''}${hasBr()&&brs().length>1?' · '+brs().map(b=>esc(b.name)+': '+n3(q(p,b.id))).join(' · '):''}</small></div><b class="a${q(p,br)<0?' neg':''}">${n3(q(p,br))}</b>
 <div class="row" style="width:100%"><button class="btn g s grow" data-a="oxZero" data-id="${esc(p.id)}">נגמר במלאי</button>${mgr()?`<button class="btn g s grow" data-a="oxFix" data-id="${esc(p.id)}">תיקון כמות</button><button class="btn g s grow" data-a="oxEditP" data-id="${esc(p.id)}">עריכה</button>`:''}</div></div>`).join('')||'<div class="empty">אין מוצרים. הוסף מוצר חדש.</div>';
INP.oxSQ=el=>{O.sq=el.value;const br=hasBr()?SBR:NB,L=(O.P||[]).filter(p=>!O.sq||String(p.name).includes(O.sq)||String(p.barcode||'')===O.sq.trim());const x=document.getElementById('oxpl');if(x)x.innerHTML=plH(L,br)};
ACT.oxSBr=el=>{SBR=el.dataset.id;rerender()};
const sbr=()=>hasBr()?SBR:undefined;
ACT.oxZero=el=>{const p=prod(el.dataset.id);if(!p)return;ask(`לסמן "${p.name}" כנגמר במלאי${hasBr()?' ב'+bn(SBR):''}? הכמות תתאפס.`,async()=>{try{await fnCall('stockSet',{reqId:rid(),pid:p.id,br:sbr(),qty:0});toast('עודכן');await load(true)}catch(e){err(e)}},'כן, נגמר')};
ACT.oxFix=el=>{const p=prod(el.dataset.id);if(!p)return;dlg(`<h3>תיקון כמות · ${esc(p.name)}</h3><form data-f="oxFixF"><input type="hidden" name="id" value="${esc(p.id)}"><label class="f"><span>הכמות הנכונה${hasBr()?' ב'+esc(bn(SBR)):''}</span><input name="q" inputmode="decimal" value="${n3(q(p,hasBr()?SBR:NB))}" required></label><div class="row"><button class="btn grow">שמור</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`)};
FRM.oxFixF=async f=>{const x=fd(f),v=num(x.q);if(!isFinite(v))return toast('כמות לא תקינה');const b=f.querySelector('button');b.disabled=true;try{await fnCall('stockSet',{reqId:rid(),pid:x.id,br:sbr(),qty:v});closeDlg();toast('עודכן');await load(true)}catch(e){b.disabled=false;err(e)}};
const pForm=(p)=>`<h3>${p?'עריכת מוצר':'מוצר חדש'}</h3><form data-f="oxPF">${p?`<input type="hidden" name="id" value="${esc(p.id)}">`:`<input type="hidden" name="req" value="${rid()}">`}${fld('שם המוצר','name',p?p.name:'','text','required maxlength="60"')}${fld('מחיר מכירה ₪','price',p?p.price:'','text','required inputmode="decimal"')}${fld('ברקוד (רשות)','barcode',p?p.barcode||'':'','text','inputmode="numeric" maxlength="30" dir="ltr"')}
 ${p?'':fld('כמות פתיחה'+(hasBr()?' ב'+esc(bn(SBR)):'')+' (רשות)','qty','','text','inputmode="decimal"')}${mgr()?fld('עלות ₪ (רק מנהל רואה)','cost','','text','inputmode="decimal"'):''}${p?`<label class="cb" style="min-height:44px;display:flex;align-items:center;gap:6px"><input type="checkbox" name="off"${p.on===false?' checked':''}> לא זמין להזמנה</label>`:''}
 <div class="row"><button class="btn grow">שמור</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`;
ACT.oxNewP=()=>dlg(pForm(null));
ACT.oxEditP=el=>{const p=prod(el.dataset.id);if(p)dlg(pForm(p))};
FRM.oxPF=async f=>{const x=fd(f),price=num(x.price);if(!x.name.trim())return toast('חסר שם');if(!(price>=0))return toast('מחיר לא תקין');const d={name:x.name.trim(),price,barcode:x.barcode.trim()};
 if(x.cost&&x.cost.trim()){const c=num(x.cost);if(!(c>=0))return toast('עלות לא תקינה');d.cost=c}
 if(x.id){d.id=x.id;d.on=!x.off}else{d.reqId=x.req;if(x.qty&&x.qty.trim()){const v=num(x.qty);if(!(v>=0))return toast('כמות לא תקינה');d.qty=v;d.br=sbr()}else if(hasBr())d.br=SBR}
 const b=f.querySelector('button');b.disabled=true;try{await fnCall('saveProduct',d);closeDlg();toast('המוצר נשמר');await load(true)}catch(e){b.disabled=false;err(e)}};
// הכנסת מלאי – כמה שורות בבת אחת
ACT.oxIn=()=>{O.inL=[{pid:'',qty:''}];O.inReq=rid();dlg(inH())};
const inH=()=>`<h3>הכנסת מלאי${hasBr()?' · '+esc(bn(SBR)):''}</h3><form data-f="oxInF">${O.inL.map((l,i)=>`<div class="row"><label class="f grow"><span>מוצר</span><select name="p${i}"><option value="">בחר</option>${(O.P||[]).map(p=>`<option value="${esc(p.id)}"${l.pid===p.id?' selected':''}>${esc(p.name)}${p.barcode?' · '+esc(p.barcode):''}</option>`).join('')}</select></label><label class="f" style="width:96px"><span>כמות</span><input name="q${i}" inputmode="decimal" value="${esc(l.qty)}"></label></div>`).join('')}
 <button type="button" class="btn g s w" data-a="oxInAdd">＋ שורה</button><div class="row" style="margin-top:8px"><button class="btn grow">הוסף למלאי</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`;
const inRead=()=>{const f=document.querySelector('#dlg form');if(!f)return;const x=fd(f);O.inL=O.inL.map((l,i)=>({pid:x['p'+i]||'',qty:x['q'+i]||''}))};
ACT.oxInAdd=()=>{inRead();O.inL.push({pid:'',qty:''});dlg(inH())};
FRM.oxInF=async f=>{inRead();const lines=[];for(const l of O.inL){if(!l.pid&&!l.qty)continue;const v=num(l.qty);if(!l.pid)return toast('בחר מוצר בכל שורה');if(!(v>0))return toast('כמות לא תקינה');lines.push({pid:l.pid,qty:v})}if(!lines.length)return toast('אין שורות');
 const b=f.querySelector('button.grow:not(.g)');b.disabled=true;try{await fnCall('stockIn',{reqId:O.inReq,br:sbr(),lines});closeDlg();toast('המלאי עודכן');await load(true)}catch(e){b.disabled=false;err(e)}};
ACT.oxHist=async()=>{dlg('<h3>היסטוריית תנועות</h3><p class="note">טוען…</p>');try{const L=(await runQ('stockLog',brWhere(),300)).sort((a,b)=>b.at-a.at).slice(0,150);
 dlg(`<h3>היסטוריית תנועות</h3><div style="max-height:60vh;overflow:auto">${L.map(x=>`<div class="note" style="padding:6px 0;border-bottom:1px solid var(--line)">${tm(x.at)} · <b>${esc(x.name)}</b>${hasBr()?' · '+esc(bn(x.br)):''} · ${WHY[x.why]||x.why} · <bdi dir="ltr">${x.delta>0?'+':''}${n3(x.delta)}</bdi>${x.no?' · הזמנה #'+x.no:''}</div>`).join('')||'<p class="note">אין תנועות</p>'}</div><button class="btn g w" data-a="closeDlg">סגור</button>`)}catch(e){dlg(`<h3>היסטוריית תנועות</h3><p class="note">${esc(e.message)}</p><button class="btn g w" data-a="closeDlg">סגור</button>`)}};

/* ---------- מקור המלאי לכל סניף (מנהל) ---------- */
V.oxCfg=()=>{const T='מאיזה סניף יורד המלאי';if(!on()||!mgr())return deny(T);if(!O.cfg){load();return loading(T)}const B=brs();
 return{t:T,s:'לכל סניף בנפרד',h:`<p class="note">"לפי המלאי" – בכל שורה מוצע הסניף שיש בו מספיק, והעובד יכול לשנות. סניף קבוע – כל ההזמנות של הסניף יורדות ממלאי של הסניף שנבחר; הסחורה מועברת לסניף ההזמנה.</p>
 <form class="card" data-f="oxCfgF">${B.map(b=>`<label class="f"><span>הזמנות של ${esc(b.name)}</span><select name="${esc(b.id)}"><option value="stock">לפי המלאי</option>${B.map(x=>`<option value="${esc(x.id)}"${srcOf(b.id)===x.id?' selected':''}>תמיד מ${esc(x.name)}</option>`).join('')}</select></label>`).join('')}<button class="btn w">שמור</button></form>`}};
FRM.oxCfgF=async f=>{const src=fd(f),b=f.querySelector('button');b.disabled=true;try{await fnCall('setOrderCfg',{src});toast('נשמר');await load(true)}catch(e){err(e)}finally{b.disabled=false}};

/* ---------- מנהל־על: תשלום בהזמנות, בכרטיס העסק ---------- */
const PAYC={};
{const s=V.sab;if(s)V.sab=id=>{const r=s(id);try{const b=(ADM.L||[]).find(x=>x.id===id);if(!SY.sa||!b||b.missing||b.dataRoot==='legacy'||!r||!r.h)return r;
 const c=PAYC[id];if(c===undefined){PAYC[id]=null;Promise.all([fsx('/b/'+id+'/ordcfg/main',{},true).then(d=>dec(d).pay||{}).catch(()=>({})),fsx('/b/'+id+'/cfg/main',{},true).then(d=>{const j=JSON.parse(fvj(d.fields&&d.fields.data)||'{}');return(j.cats||[]).filter(c=>c.beh==='sup').flatMap(c=>(c.subs||[]).map(x=>({id:x.id,name:x.name})))}).catch(()=>[])]).then(([p,sups])=>{PAYC[id]=Object.assign({},p,{sups})}).finally(()=>{if(cur().v==='sab')rerender()})}
 const p=c||{},mode=p.mode==='link'?'link':'phone';
 r.h+=`<div class="sec"><h3>תשלום בהזמנות</h3></div><form class="card" data-f="oxPayF" data-id="${esc(id)}"><p class="note" style="margin-top:0">${c===null?'טוען…':p.mode==='link'&&p.has?'מוגדר קישור סליקה. מטעמי אבטחה הקישור לא מוצג – אפשר להחליף אותו.':p.mode==='phone'?'מוגדר: תשלום בטלפון.':'עדיין לא הוגדר. ברירת המחדל: תשלום בטלפון.'} העובדים לא רואים את הקישור, רק כפתור "לתשלום".</p>
 <div class="chips" role="radiogroup"><label class="chip" style="min-height:44px"><input type="radio" name="mode" value="link"${mode==='link'?' checked':''}> קישור סליקה</label><label class="chip" style="min-height:44px"><input type="radio" name="mode" value="phone"${mode==='phone'?' checked':''}> תשלום בטלפון</label></div>
 <label class="f"><span>הקישור שייך לספק (זיכוי אצלו על כל הזמנה ששולמה בקישור)</span><select name="sup"><option value="">בלי ספק</option>${(p.sups||[]).map(x=>`<option value="${esc(x.id)}"${p.sup&&p.sup.id===x.id?' selected':''}>${esc(x.name)}</option>`).join('')}</select></label>
 <label class="f"><span>קישור לדף הסליקה (https)</span><input name="link" type="url" dir="ltr" maxlength="500" placeholder="https://" autocomplete="off"></label><button class="btn w">שמור</button></form>`}catch(e){}return r}}
FRM.oxPayF=async f=>{const id=f.dataset.id,x=fd(f);if(x.mode==='link'&&!/^https:\/\/[^\s]+\.[^\s]+/.test(x.link||''))return toast('קישור חייב להתחיל ב-https://');const b=f.querySelector('button');b.disabled=true;
 try{const P0=PAYC[id]||{},su=x.sup?(P0.sups||[]).find(s=>s.id===x.sup):null;const r=await fnCall('setBusinessPayLink',{bizId:id,mode:x.mode,link:x.mode==='link'?x.link.trim():undefined,sup:x.mode==='link'&&su?{id:su.id,name:su.name}:undefined});PAYC[id]=Object.assign({},P0,{mode:r.mode,has:r.has,sup:r.sup||null});toast('נשמר');rerender()}catch(e){err(e)}finally{b.disabled=false}};

/* ---------- 17:47–17:59: הזמנה ששולמה דרך קישור הספק → הכנסה בסניף ההזמנה + זיכוי אצל הספק ----------
   השרת כותב ordpay/{ordId} (st paid/void). היומן נמצא במכשיר המנהל (S), ולכן כאן – רק אצל מנהל – כל רשומה הופכת לתנועת הכנסה אחת:
   tx.id='op_'+ordId, t:'inc', קטגוריה "הכנסות מהזמנות", br = סניף ההזמנה, off:{sub:ספק} = זכות אצל הספק לקיזוז (המנגנון הקיים offBal/offPay).
   הזכות עצמה לא נספרת שוב: offBal סופר את ההכנסה הזו כזכות, וחשבונית הספק נרשמת כהוצאה רגילה ומשולמת ב'קיזוז'. void → t.x=1 (מבוטל, לא נמחק). */
const OPC='c_ordinc';
function opCat(){let c=S.cats.find(x=>x.id===OPC);if(!c){c={id:OPC,kind:'inc',name:'הכנסות מהזמנות',beh:'simple'};S.cats.push(c)}let u=S.subs.find(x=>x.cat===OPC&&x.name==='תשלום בקישור');if(!u){u={id:'s_ordlink',cat:OPC,name:'תשלום בקישור'};S.subs.push(u)}return u.id}
const ymd2=t=>{const d=new Date(t);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
let OPB=0;
async function opSync(){if(OPB||!isA()||!bzF('orders')||typeof S==='undefined'||!S)return 0;OPB=1;let n=0;
 try{const L=await runQ('ordpay',null,2000);for(const r of L){if(!r.ord||!(r.amt>=0)||!r.sup||!r.sup.id)continue;const id='op_'+r.ord;let t=S.tx.find(x=>x.id===id);
   if(r.st==='paid'){const f={t:'inc',cat:OPC,sub:opCat(),date:ymd2(r.at),amt:Math.round(r.amt*100)/100,note:'הזמנה #'+r.no,off:{sub:r.sup.id},ordp:r.ord};if(r.br&&r.br!==NB)f.br=r.br;
    if(!t){S.tx.push(Object.assign({id},f));n++}else if(t.x||t.amt!==f.amt||t.date!==f.date||t.br!==f.br||!t.off||t.off.sub!==f.off.sub){delete t.x;Object.assign(t,f);n++}}
   else if(r.st==='void'&&t&&!t.x){t.x=1;n++}}
  if(n){save();if(!typing())rerender()}}catch(e){}finally{OPB=0}return n}
{const L0=load;load=async f=>{await L0(f);opSync()}}
setTimeout(()=>{try{opSync()}catch(e){}},8000);setInterval(()=>{if(!document.hidden)opSync()},120000);

/* 17:51: שיוך ספק לסניף (subs[].br, רשות). בכרטיס הספק – בחירת סניף; חשבונית חדשה של הספק מקבלת אותו כסניף ברירת מחדל (brGuess).
   חשבוניות קיימות לא משתנות. עסק עם פחות מ-2 סניפים – שום שינוי. */
{const c0=V.card;if(c0)V.card=id=>{const r=c0(id);try{const u=subById(id),c=u&&cat(u.cat);if(!isA()||!u||!c||c.beh!=='sup'||!r||!r.h||brs().length<2)return r;
 r.h+=`<div class="sec"><h3>סניף הספק</h3></div><div class="card"><label class="f"><span>חשבוניות של הספק נרשמות כהוצאה בסניף</span><select data-c="oxSupBr" data-id="${esc(u.id)}"><option value="">לא משויך (לפי זיהוי)</option>${brs().map(b=>`<option value="${esc(b.id)}"${u.br===b.id?' selected':''}>${esc(b.name)}</option>`).join('')}</select></label>${u.offset?'<p class="note" style="margin:0">הזיכויים מהזמנות ששולמו בקישור של הספק מצטברים בכרטיס הקיזוז שלו.</p>':''}</div>`}catch(e){}return r}}
CHG.oxSupBr=el=>{const u=subById(el.dataset.id);if(!u)return;if(el.value&&brs().some(b=>b.id===el.value))u.br=el.value;else delete u.br;save();toast('נשמר')};
if(typeof brGuess==='function'){const g0=brGuess;brGuess=function(t){try{const u=t&&t.sub?subById(t.sub):null;if(u&&u.br&&!(t&&t.br)&&brList().some(b=>b.id===u.br))return{id:u.br,sure:true}}catch(e){}return g0(t)}}

window.__ox=O;window.__opSync=opSync;
})();
