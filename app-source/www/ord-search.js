/* ORD:SEARCH – חיפוש מוצר חכם, רשימה חופשית וכינויים (משימה 2026-11-14_הזמנות-לקוח-עסקי-וחשבוניות, שלב 2 חלק ב'). קובץ עצמאי, נטען אחרי orders-staff.js, ord-biz.js ו-prod-match.js.
   - חיפוש מוצר בהזמנה תוך כדי הקלדה (40–45): ProdMatch – גם עם שגיאת כתיב, חלק מהשם, שם קודם/כינוי, ברקוד וקוד פריט. עד 8 הצעות, קודם מה שהלקוח קנה בעבר.
     בכל הצעה (43): שם, מחיר (מחיר הלקוח – ord-biz), קטגוריה, כמות במארז, כמות בקרטון אם נמכר בקרטון, מלאי. (אין היום שדה תמונה למוצר – לא מוצג)
     האינדקס המנורמל נבנה פעם אחת לכל טעינה של O.P (לא בכל הקלדה).
   - רשימה חופשית (30–39): הדבקת טקסט / הודעת ווטסאפ, או צילום רשימה (scanDocument ordlist). ordParse בשרת: קודם התאמה רגילה (חינם),
     ורק בלחיצה – AI לשורות שלא זוהו, עם עלות משוערת לפני (113, הערכה בלבד). מסך אישור: שורה שלא זוהתה מסומנת בצבע עם חלופות;
     מוצר שלא קיים – שורה חופשית עם אזהרה בולטת. רק אחרי "הוסף להזמנה" השורות נכנסות לטופס.
   - כינויים (46–54): בעריכת מוצר – רשימת השמות הקודמים ומחיקה (delAlias). הכנסת מלאי – "שם חדש" (stockIn nm). מוצר חדש בשם שכבר שייך למוצר – אזהרה.
   כל כתיבה – דרך השרת (orders.js). */
(function(){
'use strict';
if(typeof ACT==='undefined'||typeof V==='undefined'||!window.__ox||!window.ProdMatch)return;
const O=window.__ox,PMx=window.ProdMatch;
const fnCall=(n,d)=>{d=d&&typeof d==='object'?d:{};if(SY&&SY.sa&&SY.bizId&&!('bizId'in d))d=Object.assign({bizId:SY.bizId},d);return window.fnCall(n,d)};
const on=()=>(isA()||isW()||!!(SY&&SY.sa))&&bzF('orders')&&wp('ord');
const err=e=>toast(e&&e.message||'הפעולה נכשלה');
const NB='_';
const num=v=>{const x=+String(v==null?'':v).replace(',','.').replace(/[₪\s]/g,'');return String(v==null?'':v).trim()!==''&&isFinite(x)?x:NaN};
const n3=x=>Math.round(x*1000)/1000;
const prod=id=>(O.P||[]).find(p=>p.id===id);
const brs=()=>brAll().filter(b=>b.on);
const hasBr=()=>brs().length>0;
const q=(p,br)=>{const v=p&&p.q&&typeof p.q==='object'?p.q[br]:0;return typeof v==='number'?v:0};
const qAll=p=>Object.values(p&&p.q||{}).reduce((s,v)=>s+(typeof v==='number'?v:0),0);
const unitP=(p,br)=>{const v=p&&p.bp&&typeof p.bp==='object'?p.bp[br]:undefined;return typeof v==='number'?v:(+(p&&p.price)||0)};
const ctoOf=p=>p&&p.cto===true&&Number.isInteger(p.ct)&&p.ct>=2?p.ct:0;
const wsOf=D=>!!(D&&D.custId&&D.wholesale===true);
const priceOf=(D,p)=>{try{const b=window.__obBiz;if(b&&b.defOf&&D)return b.defOf(D,p.id)}catch(e){}return unitP(p,D&&D.br)};
const catNm=id=>{const c=(O.C||[]).find(x=>x.id===id);return c?c.name:''};

/* ---------- אינדקס וחיפוש ---------- */
const IX={src:null,idx:null},BT={k:null,s:null};
const ix=()=>{if(IX.src!==O.P){IX.src=O.P;IX.idx=PMx.index((O.P||[]).filter(p=>p.on!==false))}return IX.idx};
// מה שהלקוח הזה קנה בעבר – מההזמנות שכבר נטענו (O.L, עד 500 האחרונות)
const boughtOf=D=>{const id=D&&D.custId||'';if(!id)return new Set();if(BT.k===id&&BT.L===O.L)return BT.s;const s=new Set();(O.L||[]).forEach(o=>{if(o.custId===id)(o.items||[]).forEach(it=>{if(it&&it.pid)s.add(it.pid)})});BT.k=id;BT.L=O.L;BT.s=s;return s};
const stockTxt=(p,D)=>hasBr()?(D&&D.br?'במלאי ב'+esc(brNm(D.br))+': '+n3(q(p,D.br))+' · ':'')+'סה״כ '+n3(qAll(p)):'במלאי: '+n3(q(p,NB));
const hitH=(r,D)=>{const p=r.p,ct=ctoOf(p);
 const info=[r.k==='al'?'שם קודם: '+esc(r.n):r.k==='bc'?'לפי ברקוד':r.k==='sku'?'לפי קוד פריט':'',p.cat?esc(catNm(p.cat))+(p.sub?' / '+esc(catNm(p.sub)):''):'',p.pk?'במארז '+p.pk:'',ct?'בקרטון '+ct+' מארזים':'',stockTxt(p,D)].filter(Boolean).join(' · ');
 return `<button type="button" class="li" data-a="oxAdd" data-id="${esc(p.id)}"><div class="m"><b>${esc(p.name)}</b>${r.b?' <span class="tag t1">קנה בעבר</span>':''}${ct?' <span class="tag">נמכר בקרטון</span>':''}<small>${info}</small></div><b class="a">${ils(priceOf(D,p))}</b></button>`};
const hitsH=D=>{const t=String(D&&D.q||'').trim();if(!t)return '';const R=PMx.search(ix(),t,{limit:8,bought:boughtOf(D)});return R.length?R.map(r=>hitH(r,D)).join(''):'<p class="note">לא נמצא מוצר. אפשר להדביק רשימה, להוסיף שורה חופשית או מוצר חדש במסך המלאי.</p>'};
window.__osHits=(D,t)=>PMx.search(ix(),t,{limit:8,bought:boughtOf(D)}); // לבדיקות
const LBTN='<button type="button" class="btn g s w" data-a="osOpen">＋ רשימה חופשית (הדבקה / ווטסאפ / צילום)</button>';
{const nw=V.oxNew;if(nw)V.oxNew=()=>{const r=nw();try{const D=O.draft;if(!r||!r.h||!D||!on())return r;
 const a=r.h.indexOf('<div id="oxhits">'),b=r.h.indexOf('<button type="button" class="btn g s w" data-a="oxFree">');
 if(a>=0&&b>a)r.h=r.h.slice(0,a)+`<div id="oxhits">${hitsH(D)}</div>\n `+LBTN+r.h.slice(b);
 r.h=r.h.replace('<span>חיפוש מוצר (שם או ברקוד)</span>','<span>חיפוש מוצר (שם, שם קודם, ברקוד או קוד פריט)</span>')}catch(e){}return r}}
{const f=INP.oxQ;INP.oxQ=el=>{const D=O.draft;if(!D||!O.P)return f&&f(el);D.q=el.value;const h=document.getElementById('oxhits');if(h)h.innerHTML=hitsH(D)}}

/* ---------- רשימה חופשית ---------- */
const S={t:'',in:null,L:null,r:null,busy:0};
const opQ=(l,p,ws)=>{const n=l.qty0==null?1:l.qty0,ct=p&&Number.isInteger(p.ct)&&p.ct>=2?p.ct:0;if(p&&ws&&p.cto===true&&ct)return{q:n,cto:true};if(l.unit==='ct')return ct?{q:n3(n*ct),conv:ct}:{q:n,noCt:true};return{q:n}};
const lineOf=x=>Object.assign({raw:x.raw,name:x.name,qty0:x.qty,unit:x.unit,pid:x.pid,by:x.by,alts:x.alts||[]},{q:String(x.q==null?(x.qty==null?1:x.qty):x.q),cto:!!x.cto,conv:x.conv||0,noCt:!!x.noCt});
ACT.osOpen=()=>{if(!O.draft)return;if(!S.L)S.t=S.t||'';go('osList')};
V.osList=()=>{const T='רשימה חופשית';if(!on())return{t:T,h:'<div class="empty">אין לך הרשאה להזמנות</div>'};const D=O.draft;if(!D)return{t:T,h:'<div class="empty">אין הזמנה פתוחה. פתחו הזמנה חדשה.</div>'};
 const top=`<div class="card"><label class="f"><span>הדביקו רשימה או הודעת ווטסאפ – שורה לכל מוצר, עם כמות</span><textarea data-i="osT" rows="6" maxlength="4000" style="width:100%;box-sizing:border-box" placeholder="5 קרטונים כוסות&#10;צלחות עמוקות 3&#10;מפיות">${esc(S.t)}</textarea></label>
 <div class="row"><button type="button" class="btn grow" data-a="osRun"${S.busy?' disabled':''}>זהה מוצרים</button><label class="btn g grow" style="text-align:center">צילום רשימה<input type="file" accept="image/*" data-c="osImg" style="display:none"></label></div>
 <p class="note" style="margin:6px 0 0">הזיהוי הרגיל חינמי. זיהוי חכם (AI) – רק לשורות שלא זוהו, ורק אחרי שתאשרו.${wsOf(D)?' <b>לקוח עסקי:</b> במוצר "נמכר בקרטון" הכמות היא בקרטונים.':''}</p></div>`;
 if(S.busy)return{t:T,s:'מזהה…',h:top+'<div class="empty">מזהה…</div>'};
 if(!S.L)return{t:T,s:'זיהוי מוצרים מרשימה',h:top};
 return{t:T,s:'בדקו, תקנו ואשרו',h:top+resH(D)}};
const BAD='var(--bad)',CHK='#e0a800';
function resH(D){const L=S.L,r=S.r||{},ws=wsOf(D);
 const need=L.filter(l=>!l.del&&!l.pid&&!l.free&&l.alts.length).length;
 const rows=L.map((l,i)=>{if(l.del)return '';const p=l.pid?prod(l.pid):null,bad=!p&&!l.free,ai=p&&l.by==='ai';
  const tag=p?(ai?'<span class="tag" style="color:'+CHK+';border-color:'+CHK+'">זוהה ב-AI – לבדוק</span>':l.by==='user'?'<span class="tag">נבחר ידנית</span>':'<span class="tag t1">זוהה</span>'):l.free?'':'<span class="tag" style="color:'+BAD+';border-color:'+BAD+'">לא זוהה – בחרו מוצר</span>';
  const alts=l.alts.filter(a=>prod(a.id)).slice(0,5).map(a=>`<button type="button" class="chip${l.pid===a.id?' on':''}" data-a="osPick" data-n="${i}" data-id="${esc(a.id)}" aria-pressed="${l.pid===a.id}">${esc(prod(a.id).name)}${a.k==='al'&&a.al?' <small>(שם קודם: '+esc(a.al)+')</small>':''}</button>`).join('');
  const cto=p&&ws&&ctoOf(p);
  return `<div class="card" style="margin:6px 0${bad?';border:2px solid '+BAD:ai?';border:2px solid '+CHK:l.free?';border:2px solid '+BAD:''}">
  <small class="note">כתוב: "${esc(l.raw)}"</small><div style="margin:2px 0"><b>${p?esc(p.name):l.free?esc(l.name):'—'}</b> ${tag}${cto?' <span class="tag">נמכר בקרטון ('+cto+' מארזים)</span>':''}</div>
  ${l.free?`<p style="color:${BAD};font-weight:700;margin:4px 0">אזהרה: המוצר לא קיים במלאי. ייכנס כשורה חופשית – בלי מלאי, ומחיר ממלאים ידנית.</p>`:''}
  ${alts||!p?`<div class="chips scroll-x" role="group" aria-label="בחירת מוצר" style="margin:4px 0">${alts}${p?'':`<button type="button" class="chip${l.free?' on':''}" data-a="osFree" data-n="${i}" aria-pressed="${!!l.free}">מוצר לא קיים – שורה חופשית</button>`}</div>`:''}
  <div class="row" style="align-items:flex-end"><label class="f grow"><span>כמות${cto?' (קרטונים)':''}</span><input data-i="osQ" data-n="${i}" inputmode="decimal" value="${esc(l.q)}"></label><button type="button" class="btn g s" data-a="osDel" data-n="${i}">הסר</button></div>
  ${l.conv&&p?`<small class="note">${esc(String(l.qty0==null?1:l.qty0))} קרטונים × ${l.conv} בקרטון</small>`:l.noCt&&p?'<small class="note" style="color:'+CHK+'">נכתב "קרטון" אבל למוצר לא מוגדרת כמות בקרטון – בדקו את הכמות</small>':''}</div>`}).join('');
 const est=r.est&&need?r.est.usd:0,usdTx=u=>u<0.01?'פחות מסנט':'כ-$'+u.toFixed(3);
 const aiB=need&&bzF('scan')&&!S.aiDone?`<button type="button" class="btn g w" data-a="osAi" style="margin:8px 0">זיהוי חכם (AI) ל-${need===1?'שורה אחת':need+' שורות'} שלא זוהו · עלות משוערת ${usdTx(est)} (הערכה, לא מאומת)</button>`:'';
 const aiN=S.aiDone&&r.ai?`<p class="note">הזיהוי החכם בדק ${r.ai.sent} שורות ומצא ${r.ai.got}. עלות משוערת ${usdTx(r.ai.usd||0)} (הערכה).</p>`:'';
 const n=L.filter(l=>!l.del&&(l.pid||l.free)).length;
 return `<div class="sec"><h3>בדיקה ואישור (${L.filter(l=>!l.del).length} שורות)</h3></div>${rows}${aiN}${aiB}<button type="button" class="btn w" data-a="osAdd"${n?'':' disabled'}>הוסף להזמנה (${n})</button><button type="button" class="btn g w" style="margin-top:8px" data-a="osClr">נקה</button>`}
INP.osT=el=>{S.t=el.value};
INP.osQ=el=>{const l=S.L&&S.L[+el.dataset.n];if(l)l.q=el.value};
async function parse(inp,ai){const D=O.draft;if(!D)return;S.busy=1;rerender();
 try{const r=await fnCall('ordParse',Object.assign({},inp,D.custId?{custId:D.custId}:{},ai?{ai:true}:{}));
  if(!ai){S.in=inp;S.r=r;S.L=(r&&r.lines||[]).map(lineOf);S.aiDone=0}
  else{S.r=Object.assign({},S.r,{ai:r.ai});S.aiDone=1;(r.lines||[]).forEach((x,i)=>{const l=S.L[i];if(l&&!l.del&&!l.pid&&!l.free&&x.pid&&x.by==='ai'){Object.assign(l,lineOf(x))}})}
  if(ai&&r&&r.ai)toast('זוהו עוד '+r.ai.got+' שורות');}
 catch(e){err(e)}finally{S.busy=0;if(cur().v==='osList')rerender()}}
ACT.osRun=()=>{const t=String(S.t||'').trim();if(!t)return toast('הדביקו רשימה');parse({text:t.slice(0,4000)},false)};
ACT.osAi=()=>{if(!S.in)return;parse(S.in,true)};
CHG.osImg=async el=>{const f=el.files&&el.files[0];el.value='';if(!f)return;if(!/^image\//.test(f.type))return toast('רק תמונה');S.busy=1;rerender();
 try{const du=await shrinkDU(f),m=/^data:([^;]+);base64,(.*)$/.exec(du);if(!m)throw new Error('התמונה לא נקראה');
  const t=await shAIcall({contents:[{parts:[{text:''},{inline_data:{mime_type:m[1],data:m[2]}}]}]},'srv',120000,false,'ordlist');
  let o=null;try{o=JSON.parse(String(t).replace(/```json|```/g,'').trim())}catch(e){}
  const L=(o&&Array.isArray(o.lines)?o.lines:[]).filter(x=>x&&typeof x.name==='string'&&x.name.trim()).slice(0,60).map(x=>({name:x.name.trim().slice(0,120),qty:typeof x.qty==='number'&&x.qty>0?x.qty:null,unit:['u','pk','ct'].includes(x.unit)?x.unit:null}));
  if(!L.length)throw new Error('לא נמצאו שורות בצילום');S.t=L.map(x=>(x.qty!=null?x.qty+' ':'')+(x.unit==='ct'?'קרטון ':'')+x.name).join('\n');S.busy=0;await parse({lines:L},false)}
 catch(e){S.busy=0;err(e);if(cur().v==='osList')rerender()}};
ACT.osPick=el=>{const l=S.L&&S.L[+el.dataset.n],p=prod(el.dataset.id);if(!l||!p)return;l.pid=p.id;l.by='user';l.free=0;Object.assign(l,{cto:0,conv:0,noCt:false},opQ(l,p,wsOf(O.draft)));l.q=String(l.q);rerender()};
ACT.osFree=el=>{const l=S.L&&S.L[+el.dataset.n];if(!l)return;l.free=l.free?0:1;l.pid=null;rerender()};
ACT.osDel=el=>{const l=S.L&&S.L[+el.dataset.n];if(l){l.del=1;rerender()}};
ACT.osClr=()=>{S.t='';S.in=null;S.L=null;S.r=null;S.aiDone=0;rerender()};
ACT.osAdd=()=>{const D=O.draft;if(!D||!S.L)return;const add=S.L.filter(l=>!l.del&&(l.pid&&prod(l.pid)||l.free)),skip=S.L.filter(l=>!l.del&&!l.pid&&!l.free).length;
 const doIt=()=>{for(const l of add){const v=num(l.q),qn=String(v>0?n3(v):1);
   if(l.pid){const p=prod(l.pid),ex=D.items.find(it=>it.pid===p.id&&!it.gk);if(ex)ex.qty=String(n3((num(ex.qty)||0)+num(qn)));else D.items.push({pid:p.id,qty:qn,price:String(priceOf(D,p)),auto:1})}
   else D.items.push({n:String(l.name||l.raw).slice(0,80),qty:qn,price:''})}
  ACT.osClr();if(cur().v==='osList')NAV.pop();rerender();toast('נוספו '+add.length+' שורות להזמנה');
  if(window.__oxWsChg)window.__oxWsChg(D,D.wholesale===true)}; // ord-biz: מחירי הלקוח (קבוע ← סיטונאי ← רגיל) על השורות החדשות
 if(skip)return ask(`${skip===1?'שורה אחת':skip+' שורות'} בלי מוצר לא ייכנסו להזמנה. להמשיך?`,doIt,'כן, הוסף את השאר');doIt()};

/* ---------- כינויים בכרטיס המוצר (עריכת מוצר) ---------- */
const alH=p=>{const A=Array.isArray(p.al)?p.al.filter(a=>typeof a==='string'):[];return `<div class="card" id="osal" style="margin:8px 0"><b>שמות קודמים / כינויים</b><p class="note" style="margin:4px 0">החיפוש בהזמנה ובחשבונית מוצא את המוצר גם לפיהם. שינוי השם כאן שומר את השם הקודם ככינוי.</p>${A.length?A.map(a=>`<div class="row" style="justify-content:space-between;align-items:center"><span>${esc(a)}</span><button type="button" class="btn g s" data-a="osAlDel" data-id="${esc(p.id)}" data-al="${esc(a)}">מחק</button></div>`).join(''):'<p class="note" style="margin:0">אין כינויים.</p>'}</div>`};
{const f=ACT.oxEditP;if(f)ACT.oxEditP=el=>{f(el);try{const p=prod(el.dataset.id),F=document.querySelector('#dlg form[data-f="oxPF"]');if(!p||!F||!on())return;const last=F.lastElementChild;if(last)last.insertAdjacentHTML('beforebegin',alH(p))}catch(e){}}}
ACT.osAlDel=async el=>{const id=el.dataset.id,a=el.dataset.al;el.disabled=true;try{const r=await fnCall('delAlias',{pid:id,al:a});const p=prod(id);if(p&&Array.isArray(p.al)){const k=PMx.key(a);p.al=p.al.filter(x=>PMx.key(x)!==k);O.P=O.P.slice()}const box=document.getElementById('osal');if(box&&p)box.outerHTML=alH(p);toast(r&&r.removed?'הכינוי נמחק':'הכינוי כבר לא קיים')}catch(e){el.disabled=false;err(e)}};
/* מוצר חדש בשם (או כינוי) של מוצר קיים – אזהרה בטופס; שמירה שנייה ממשיכה */
{const f=FRM.oxPF;if(f)FRM.oxPF=frm=>{try{const x=fd(frm);if(!x.id&&!frm.dataset.osok&&String(x.name||'').trim()){const k=PMx.key(x.name),hit=(O.P||[]).find(p=>PMx.key(p.name)===k||(Array.isArray(p.al)&&p.al.some(a=>PMx.key(a)===k)));
  if(hit){frm.dataset.osok='1';const w=`<p class="note" id="osdup" style="color:var(--bad);font-weight:700">כבר יש מוצר בשם הזה${PMx.key(hit.name)===k?'':' (שם קודם)'}: "${esc(hit.name)}". אם זה אותו מוצר – אל תקימו חדש. לחצו "שמור" שוב כדי להקים בכל זאת.</p>`;const last=frm.lastElementChild;if(last&&!document.getElementById('osdup'))last.insertAdjacentHTML('beforebegin',w);return}}}catch(e){}return f(frm)}}
/* הכנסת מלאי: "שם חדש" לכל שורה (רשות) – נשלח כ-nm ב-stockIn; השם הקודם נשמר ככינוי בשרת */
const NM={};
function nmInject(){const F=document.querySelector('#dlg form[data-f="oxInF"]');if(!F||!on())return;F.querySelectorAll('select[name^="p"]').forEach(sel=>{const i=+sel.name.slice(1),row=sel.closest('.row');if(!row||!(i>=0))return;
 row.insertAdjacentHTML('afterend',`<details${NM[i]?' open':''}><summary class="note" style="min-height:36px;display:flex;align-items:center">שינוי שם המוצר (רשות)</summary><label class="f"><span>שם חדש – השם הקודם יישמר ככינוי</span><input data-i="osNm" data-n="${i}" maxlength="60" value="${esc(NM[i]||'')}" autocomplete="off"></label></details>`)})}
INP.osNm=el=>{NM[+el.dataset.n]=el.value};
{const f=ACT.oxIn;if(f)ACT.oxIn=el=>{Object.keys(NM).forEach(k=>delete NM[k]);f(el);nmInject()}}
{const f=ACT.oxInAdd;if(f)ACT.oxInAdd=el=>{f(el);nmInject()}}
{const f=window.fnCall;if(typeof f==='function')window.fnCall=function(n,d){if(n==='stockIn'&&d&&Array.isArray(d.lines)&&d.reqId===O.inReq&&Object.values(NM).some(v=>String(v||'').trim())){
  const m={};(O.inL||[]).forEach((l,i)=>{const v=String(NM[i]||'').trim();if(l.pid&&v)m[l.pid]=v.slice(0,60)});d=Object.assign({},d,{lines:d.lines.map(l=>m[l.pid]?Object.assign({},l,{nm:m[l.pid]}):l)})}
 return f.apply(this,[n,d].concat([].slice.call(arguments,2)))}}
window.__osS=S;
})();
