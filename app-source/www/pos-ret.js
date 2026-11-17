/* POS:M1 – קופה, החזרה בסיסית (ש1, צד הממשק; אפיון ב 1.5, ב 3 מסך 4). השרת (ש2, posReturn) בודק שוב את כל התקרות בטרנזקציה.
   RetCalc – חישובים טהורים (נבדקים ב-pos-sale-calc.unit.test.js):
     lineAmt  – החזר לשורה לפי מה ששולם בפועל (fin = אחרי מבצע והחלק היחסי מהנחת החשבון). מצטבר; ביחידה האחרונה – בדיוק היתרה.
     split    – קיזוז הקפה קודם (ה15-ד), והשאר באמצעי שנבחר, עד מה ששולם בו (ה15-ג). פתק זיכוי – מול סך ההחזר בלבד.
     options  – אמצעי ההחזר לפי retRefundPolicy (אשראי ← רק לכרטיס).
   PosRet.open(ctx) – החלון: סריקת קבלה / מספר מסמך / טלפון, שורות וכמה הוחזר, כמות, סיבה, מצב, "יש תג ואריזה", אמצעי החזר, אישור אחראי/מנהל. */
(function(root){
'use strict';
const RetCalc=(function(){
 const cum=(fin,qty,k)=>k>=qty?fin:Math.round(fin*k/qty);
 /* sl={qty,fin}; prevQty/prevAmt = מה שכבר הוחזר מהשורה; q = כמות עכשיו */
 function lineAmt(sl,prevQty,prevAmt,q){prevQty=prevQty||0;prevAmt=prevAmt||0;if(!(q>0))return 0;if(prevQty+q>sl.qty)return NaN;return Math.max(0,cum(sl.fin,sl.qty,prevQty+q)-prevAmt)}
 const paidBy=(s,m)=>{const a=(s.pays||[]).filter(p=>p.m===m).reduce((x,p)=>x+p.amt,0);return m==='cash'?a-(s.chg||0):a};
 function options(s,policy){policy=policy||{'*':['cash','voucher','same']};const out=[];const ms=[...new Set((s.pays||[]).map(p=>p.m))];
  if(!ms.length&&s.debt)ms.push('*');
  ms.forEach(m=>{(policy[m]||policy['*']||[]).forEach(o=>{const v=o==='same'?m:o;if(v!=='*'&&!out.includes(v))out.push(v)})});return out}
 /* total – סך ההחזר; m – האמצעי שנבחר לחלק הכספי */
 function split(s,total,m){const by=s.retByM||{};const debtLeft=Math.max(0,(s.debt||0)-(by.debt||0)),debtOff=Math.min(total,debtLeft),rest=total-debtOff;
  if(rest>0&&m!=='voucher'){const cap=paidBy(s,m)-(by[m]||0);if(rest>cap)return{ok:false,err:'החזר ב'+m+' גבוה ממה ששולם באמצעי הזה',cap}}
  const byM={};if(debtOff)byM.debt=debtOff;if(rest)byM[m]=rest;return{ok:true,debtOff,rest,byM}}
 const inDays=(at,now,days)=>days==null||(now-at)<=days*86400000;
 return{lineAmt,paidBy,options,split,inDays};
})();
root.RetCalc=RetCalc;
if(typeof module!=='undefined'&&module.exports){module.exports={RetCalc};}
if(typeof document==='undefined')return;

const U=()=>root.PosUI,D=()=>root.PosData;
/* ctx: {role, me, prefill (מספר מסמך מסריקה)} → Promise: {ret, r} או null */
function open(ctx){const{E,fmt,cfg,M_NAME,hm,dmy}=U();return new Promise(res=>{
 const S={step:1,list:[],sale:null,q:{},why:'',cond:'',tag:false,dmg:false,m:'',busy:0,err:''};
 const R=U().UI.root||document.body,w=document.createElement('div');w.className='pos-modal';w.setAttribute('role','dialog');w.setAttribute('aria-modal','true');w.setAttribute('aria-label','החזרה');R.append(w);U().UI.stack.push(w);
 const done=v=>{if(!w.isConnected)return;w.remove();U().UI.stack=U().UI.stack.filter(x=>x!==w);res(v)};w._close=()=>{if(S.step===2){S.step=1;draw();return}done(null)};
 const lines=()=>S.sale?S.sale.lines.map((l,i)=>{const pq=(S.sale.retQty||{})[i]||0,pa=(S.sale.retAmt||{})[i]||0,q=S.q[i]||0;return{i,l,max:l.qty-pq,q,amt:RetCalc.lineAmt(l,pq,pa,q)}}):[];
 const total=()=>lines().reduce((s,x)=>s+(x.amt||0),0);
 function draw(){if(S.step===1){w.innerHTML=`<div class="pos-card pos-ret"><div class="pos-sh"><h2>החזרה</h2><button class="pos-ib" data-pa="x" aria-label="סגירה">✕</button></div>
  <p class="pos-note">סורקים את הברקוד שעל הקבלה, או מקלידים מספר קבלה או טלפון של הלקוח.</p>
  <form class="pos-row2" data-pf="find"><label class="pos-f grow"><span>מספר קבלה או טלפון</span><input id="retQ" data-autof inputmode="numeric" autocomplete="off" dir="ltr" aria-label="מספר קבלה או טלפון"></label><button class="pos-b" aria-label="חיפוש מכירה">חיפוש</button></form>
  ${S.err?`<p class="pos-err" role="alert">${E(S.err)}</p>`:''}
  <h3>מכירות היום</h3><div class="pos-rl">${S.list.length?S.list.slice(0,60).map(s=>`<button class="pos-kv pos-pick" data-pa="pick" data-no="${s.no}" aria-label="קבלה ${s.no}, ${fmt(s.gross)}"><span>קבלה ${s.no} <small>${hm(s.at)} · ${s.lines.length} שורות</small></span><b>${fmt(s.gross)}</b></button>`).join(''):'<div class="pos-empty">אין מכירות היום</div>'}</div></div>`}
 else{const L=lines(),t=total(),opts=RetCalc.options(S.sale,cfg('retRefundPolicy')),why=cfg('retWhy')||[];if(!S.m||!opts.includes(S.m))S.m=opts[0]||'voucher';
  w.innerHTML=`<div class="pos-card pos-ret"><div class="pos-sh"><h2>החזרה – קבלה ${S.sale.no}</h2><button class="pos-ib" data-pa="x" aria-label="חזרה לחיפוש">✕</button></div>
  <p class="pos-note">${dmy(S.sale.at)} ${hm(S.sale.at)} · שולם ${fmt(S.sale.gross)}${S.sale.debt?' · מתוכו הקפה '+fmt(S.sale.debt):''}</p>
  <div class="pos-rl">${L.map(x=>`<div class="pos-line"><div class="n"><b>${E(x.l.name)}</b><small>נמכרו ${x.l.qty} · הוחזרו ${x.l.qty-x.max} · שולם ${fmt(x.l.fin)}</small></div>
   <div class="q"><button class="pos-ib" data-pa="rq" data-i="${x.i}" data-d="-1" ${x.q>0?'':'disabled'} aria-label="פחות ${E(x.l.name)}">−</button><span class="pos-qn" aria-label="כמות להחזרה">${x.q}</span><button class="pos-ib" data-pa="rq" data-i="${x.i}" data-d="1" ${x.q<x.max?'':'disabled'} aria-label="עוד ${E(x.l.name)}">+</button></div>
   <b class="t">${fmt(x.amt||0)}</b></div>`).join('')}</div>
  <label class="pos-f"><span>סיבה</span><select id="retWhy" aria-label="סיבת החזרה"><option value="">בחרו סיבה</option>${why.map(x=>`<option${x===S.why?' selected':''}>${E(x)}</option>`).join('')}</select></label>
  <label class="pos-f"><span>מצב המוצר</span><input id="retCond" value="${E(S.cond)}" maxlength="80" aria-label="מצב המוצר"></label>
  ${cfg('retNeedTag')?`<label class="pos-chk"><input type="checkbox" id="retTag"${S.tag?' checked':''}> יש תג ואריזה</label>`:''}
  <label class="pos-chk"><input type="checkbox" id="retDmg"${S.dmg?' checked':''}> המוצר פגום</label>
  <div class="pos-seg" role="radiogroup" aria-label="אמצעי ההחזר">${opts.map(m=>`<button role="radio" aria-checked="${S.m===m}" data-pa="rm" data-v="${m}">${E(M_NAME[m]||m)}</button>`).join('')}</div>
  ${S.err?`<p class="pos-err" role="alert">${E(S.err)}</p>`:''}
  <div class="pos-kv big"><span>להחזרה</span><b id="retTotal">${fmt(t)}</b></div>
  <button class="pos-b big w" data-pa="do" ${t>0&&!S.busy?'':'disabled'} aria-label="אישור החזרה">אישור החזרה</button></div>`}
  const f=w.querySelector('[data-autof]');if(f)try{f.focus({preventScroll:true})}catch(e){}}
 const sync=()=>{const g=id=>w.querySelector('#'+id);if(g('retWhy'))S.why=g('retWhy').value;if(g('retCond'))S.cond=g('retCond').value;if(g('retTag'))S.tag=g('retTag').checked;if(g('retDmg'))S.dmg=g('retDmg').checked};
 async function pick(no){const s=await D().getSale(no);if(!s){S.err='לא נמצאה קבלה '+no;draw();return}
  if(!RetCalc.inDays(s.at,Date.now(),cfg('retDays'))){S.err='עברו יותר מ-'+cfg('retDays')+' ימים מהמכירה. החזרה בלי קבלה – באישור אחראי (בהמשך).';draw();return}
  Object.assign(S,{sale:s,step:2,q:{},err:'',m:''});draw()}
 async function find(q){q=String(q||'').replace(/\D/g,'');if(!q)return;const pre=(cfg('bc.prefixes')||{}).rcpt;if(pre&&q.startsWith(pre)&&q.length>pre.length+2)q=String(+q.slice(pre.length));
  if(q.length>=9){const L=await D().findSales({phone:q});if(!L.length){S.err='לא נמצאו מכירות לטלפון הזה';draw();return}S.list=L;S.err='';draw();return}return pick(+q)}
 async function doRet(){sync();const L=lines().filter(x=>x.q>0),t=total();if(!L.length||S.busy)return;
  if(!S.why){S.err='בחרו סיבת החזרה';draw();return}if(cfg('retNeedTag')&&!S.tag&&!S.dmg){S.err='מוצר בלי תג ואריזה לא מתקבל';draw();return}
  if(S.dmg&&cfg('retDefective')==='exchange'){S.err='מוצר פגום – החלפה בלבד. החלפה בתוך מכירה חדשה תגיע בשלב הבא.';draw();return}
  const sp=RetCalc.split(S.sale,t,S.m);if(!sp.ok){S.err=sp.err.replace(S.m,M_NAME[S.m]||S.m);draw();return}
  const need=t>cfg('retMgrAbove')?'mgr':'lead';const ap=await U().approve({role:ctx.role,need,text:'החזרה של '+fmt(t)});if(!ap.ok)return;
  S.busy=1;draw();const ret={reqId:U().reqId(),src:'sale',saleNo:S.sale.no,lines:L.map(x=>({i:x.i,pid:x.l.pid,name:x.l.name,unit:x.l.unit,qty:x.q,amt:x.amt,back:!S.dmg})),total:t,vat:Math.round(t*18/118),
   byM:sp.byM,debtOff:sp.debtOff,method:S.m,why:S.why,cond:S.cond,tag:S.tag,dmg:S.dmg,by:ap.by};
  try{const r=await D().saveReturn(ret);done({ret,r})}catch(e){S.busy=0;S.err='ההחזרה נכשלה: '+(e&&e.message||'נסו שוב');draw()}}
 w.addEventListener('click',ev=>{const b=ev.target.closest('[data-pa]');if(!b||!w.contains(b)||b.disabled)return;const a=b.dataset.pa;
  if(a==='x')return w._close();if(a==='pick')return pick(+b.dataset.no);
  if(a==='rq'){sync();const i=+b.dataset.i,x=lines()[i];S.q[i]=Math.max(0,Math.min(x.max,x.q+ +b.dataset.d));draw();return}
  if(a==='rm'){sync();S.m=b.dataset.v;draw();return}if(a==='do')return doRet()});
 w.addEventListener('submit',ev=>{ev.preventDefault();find((w.querySelector('#retQ')||{}).value)});
 w._scan=code=>{if(S.step===1)find(code)};
 (async()=>{try{const t=new Date(),d=t.getFullYear()+'-'+String(t.getMonth()+1).padStart(2,'0')+'-'+String(t.getDate()).padStart(2,'0');S.list=await D().findSales({day:d});if(S.step===1)draw()}catch(e){}})();
 draw();if(ctx.prefill)find(ctx.prefill)})}
root.PosRet={open,RetCalc};
})(typeof window!=='undefined'?window:globalThis);
