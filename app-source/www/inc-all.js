/* "כל ההכנסות" (20.11.2026) – כל ההכנסות של העסק במקום אחד. קריאה בלבד: לא כותב הכנסות, לא משנה סגירות ולא נוגע במבנה הנתונים.
   החלטות בעל העסק (20.11): סך ההכנסות = סגירות הקופה + הקופה החדשה (מכירות פחות החזרות) + הכנסות אחרות שנרשמו באפליקציה.
     מכירות כספית – בנפרד, להשוואה בלבד, לא בסך (אותו כסף כמו הסגירה). ההפרש בין כספית לסגירה – כמו במסך ההתאמה (CaspitCore.recon).
   מקורות: השרת (functions/inc-all.js, incAll) – סגירות שהוכנסו (closings st:'ok'), הקופה החדשה (possale/posret), כספית (cxDay/cxDayP).
     במכשיר המנהל: הסגירות וה"אחר" מספר ההכנסות במכשיר (S.tx, כמו כל הדוחות) – סגירה = תנועות עם src 'zc:<id>', אחר = שאר ההכנסות.
     סגירה שהוכנסה בענן ולא נמצאת במכשיר בכלל – נוספת מהשרת, עם תווית. עובד – הסגירות מהשרת, וה"אחר" לא זמין לו (נשמר רק במכשיר המנהל).
   הרשאה: מנהל, או עובד שהמנהל סימן ("רואה את כל ההכנסות" – staff/{uid}.incA, נכתב רק בשרת). השרת אוכף; כאן רק מה מוצג.
   כל משבצת לחיצה: לפי יום, ומשם הרשומות של היום (החלטה 7). הסכומים מחושבים באגורות שלמות.
   משתמש ב: V, ACT, CHG, FRM, fnCall, esc, ils, toast, dlg, closeDlg, rerender, go, cur, fd, SY, S, ZREG, zcThr, dfmt, subName, cat, live, fsx, fvj, idOf, isA, isW, WS, CaspitCore. */
(function(){
'use strict';
if(typeof ACT==='undefined'||typeof V==='undefined')return;
const fnCall=(n,d)=>{d=d&&typeof d==='object'?d:{};if(SY&&SY.sa&&SY.bizId&&!('bizId'in d))d=Object.assign({bizId:SY.bizId},d);return window.fnCall(n,d)};
const mgr=()=>{try{return isA()||!!(SY&&SY.sa)}catch(e){return false}};
const view=()=>{try{return mgr()||(isW()&&SY.incA===true)}catch(e){return false}};
window.incAllView=view;
const err=e=>toast(e&&e.message||'הפעולה נכשלה');
const df=d=>typeof dfmt==='function'?dfmt(d):d;
const A=v=>Math.round((+v||0)*100),M2=a=>a/100;
const money=(a,k,d,v,ex)=>`<button type="button" class="btn g s" data-a="${a}" data-k="${k}" data-d="${esc(d||'')}" style="min-height:44px;min-width:0${ex?';'+ex:''}"><bdi dir="ltr">${ils(v)}</bdi></button>`;
const tile=(l,v,cls,k,sub)=>`<button type="button" class="k${cls?' '+cls:''}" data-a="incDl" data-k="${k}" style="width:100%;min-height:64px;text-align:start;color:inherit;font:inherit;cursor:pointer"><small>${l}</small><b dir="ltr">${ils(v)}</b>${sub?`<small>${sub}</small>`:''}</button>`;
const regNm=r=>(typeof ZREG!=='undefined'&&ZREG[r]&&ZREG[r].n)||r||'קופה';
const closeBtn='<button class="btn g w" style="min-height:44px;margin-top:8px" data-a="closeDlg">סגור</button>';
const row=(l,v,ex)=>`<div class="row" style="justify-content:space-between;gap:8px;margin-top:6px"><span>${l}</span><b dir="ltr"${ex?' style="'+ex+'"':''}>${ils(v)}</b></div>`;

/* ---------- תקופה (כמו "מכירות כספית") ---------- */
const Q={per:'today',from:'',to:'',D:null,load:0,err:'',PD:{}};
const ymd=t=>{try{return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit'}).format(t)}catch(e){return new Date(t).toISOString().slice(0,10)}};
const addD=(d,n)=>new Date(Date.parse(d+'T12:00:00Z')+n*864e5).toISOString().slice(0,10);
function range(p){const t=ymd(new Date());if(p==='yday'){const y=addD(t,-1);return[y,y]}if(p==='week')return[addD(t,-6),t];if(p==='month')return[t.slice(0,8)+'01',t];if(p==='custom'&&Q.from&&Q.to)return[Q.from,Q.to];return[t,t]}
const PER=[['today','היום'],['yday','אתמול'],['week','שבוע'],['month','חודש'],['custom','טווח']];
/* השרת מחזיר עד 92 ימים בבקשה – טווח ארוך נשלח בחלקים */
function chunks(f,t){const o=[];for(let a=f;a<=t;a=addD(a,92)){const b=addD(a,91);o.push([a,b<t?b:t])}return o}
async function load(){const [f,t]=range(Q.per);Q.load=1;Q.err='';
 try{const R={zc:{on:false,list:[],more:false},pos:{on:false,days:{},docs:[],more:false},cx:{on:false,days:[],reg:{}}};
  for(const [a,b] of chunks(f,t)){const x=await fnCall('incAll',{op:'get',from:a,to:b})||{};
   if(x.zc&&x.zc.on){R.zc.on=true;R.zc.list=R.zc.list.concat(Array.isArray(x.zc.list)?x.zc.list:[]);if(x.zc.more)R.zc.more=true}
   if(x.pos&&x.pos.on){R.pos.on=true;Object.assign(R.pos.days,x.pos.days||{});if(Array.isArray(x.pos.docs))R.pos.docs=R.pos.docs.concat(x.pos.docs);if(x.pos.more)R.pos.more=true}
   if(x.cx&&x.cx.on){R.cx.on=true;R.cx.days=R.cx.days.concat(Array.isArray(x.cx.days)?x.cx.days:[]);R.cx.reg=x.cx.reg||{}}}
  Q.D=Object.assign(R,{f,t});Q.PD={}}catch(e){Q.err=e&&e.message||'הטעינה נכשלה';Q.D=null}
 Q.load=0;try{if(cur().v==='incAll')rerender()}catch(e){}}

/* ---------- המקורות ---------- */
const dev=()=>mgr()&&typeof S!=='undefined'&&S&&Array.isArray(S.tx)&&typeof live==='function';
const isZc=x=>typeof x.src==='string'&&x.src.slice(0,3)==='zc:';
/* סגירות במכשיר המנהל: ההכנסות שנכנסו מכל סגירה (כמו בהתאמה לסגירת קופה), לפי הסגירה */
function devZc(f,t){const Z=new Map(((S&&S.zc)||[]).map(z=>[z&&z.id,z])),by=new Map();
 for(const x of live()){if(!x||x.t!=='inc'||!isZc(x)||!x.date||x.date<f||x.date>t)continue;const id=x.src.slice(3);let r=by.get(id);
  if(!r){const z=Z.get(id)||{};r={id,reg:z.reg||x.cat||'',d:x.date,od:z.od||'',tm:z.tm||'',no:z.no||'',by:z.by||'',ag:0,rows:[]};by.set(id,r)}
  const sn=subName(x);r.rows.push([sn&&sn!=='—'?sn:x.note||'הכנסה',x.amt]);r.ag+=A(x.amt)}
 return[...by.values()].map(r=>Object.assign(r,{amt:M2(r.ag)}))}
/* סגירות שהמכשיר כבר מכיר (גם אם ההכנסה שלהן נמחקה) – לא מוסיפים אותן מהשרת */
function known(){const k=new Set(((S&&S.zc)||[]).map(z=>z&&z.id));for(const x of S.tx)if(x&&isZc(x))k.add(x.src.slice(3));return k}
/* תיקון בדיקה עצמאית (סבב 1): מסמך שהקופה החדשה הוציאה (חשבונית מס קבלה / חשבונית / זיכוי) הופך ב-ar-inc.js גם לתנועה ar_<מזהה המסמך>.
   המכירה כבר נספרת ב"קופה חדשה" (possale), ולכן התנועה הזו לא נספרת ב"אחר". זיהוי: possale.docs / posret.docs מהשרת (מקור ראשי),
   וגם מזהה בסדרת מסמכים של קופה (<סוג><D|O>-K<מספר קופה>-<מספר> – רק Book עם dev, כלומר pos-doc.js) – למקרה של מסמך שתאריכו ביום אחר מהמכירה */
const POSDOC=/^(inv|ir|rc|cr)[DO]-K[1-9][0-9]{0,3}-[0-9]+$/;
const arDoc=x=>typeof x.ardoc==='string'&&x.ardoc?x.ardoc:typeof x.id==='string'&&x.id.indexOf('ar_')===0?x.id.slice(3):'';
function isPos(x,P){const d=arDoc(x);return !!d&&(P.has(d)||POSDOC.test(d))}
function othList(f,t){const P=new Set((Q.D&&Q.D.pos&&Q.D.pos.docs)||[]);return live().filter(x=>x&&x.t==='inc'&&!isZc(x)&&!isPos(x,P)&&x.date&&x.date>=f&&x.date<=t).map(x=>({id:x.id,d:x.date,c:(typeof cat==='function'&&(cat(x.cat)||{}).name)||'',s:subName(x),note:x.note||'',amt:x.amt}))}
/* ההפרש כספית מול סגירה – בדיוק כמו במסך ההתאמה (caspit-sales.js recH): CaspitCore.recon עם חיבור הקופות, הסף וקופות הסגירה. בלי חיבור – אין הפרש */
function recMap(zc,cx){const C=window.CaspitCore;if(!cx.on||!C||typeof C.recon!=='function')return{};
 const pt=new Set(cx.days.filter(x=>x.pt).map(x=>x.d));const reg=Object.assign({},cx.reg||{}),regs=typeof ZREG!=='undefined'?Object.keys(ZREG):[];
 const Z=zc.filter(z=>!pt.has(z.d)).map(z=>({id:z.id,reg:z.reg,d:z.d,od:z.od||'',amt:z.amt})),days=cx.days.filter(x=>!x.pt);
 const th=typeof zcThr==='function'?zcThr()||0:0,o={};try{for(const r of C.recon(days,reg,Z,th,regs))o[r.d]=r.tot}catch(e){}return o}
function model(){const D=Q.D,f=D.f,t=D.t,M=dev(),m=new Map();
 const dd=d=>{let x=m.get(d);if(!x){x={d,zc:0,zn:0,ps:0,pr:0,pn:0,rn:0,debt:0,oth:0,on:0,cx:0,hasCx:false,pt:''};m.set(d,x)}return x};
 let zc;if(M){zc=devZc(f,t);const kn=known();for(const z of D.zc.list)if(!kn.has(z.id))zc.push(Object.assign({cl:1},z))}else zc=D.zc.list.slice();
 zc.sort((a,b)=>a.d<b.d?-1:a.d>b.d?1:String(a.tm)<String(b.tm)?-1:1);
 for(const z of zc){const x=dd(z.d);x.zc+=A(z.amt);x.zn++}
 for(const [d,o] of Object.entries(D.pos.days||{})){if(d<f||d>t||!o)continue;const x=dd(d);x.ps+=A(o.s);x.pr+=A(o.r);x.pn+=o.n|0;x.rn+=o.rn|0;x.debt+=A(o.debt)}
 const oth=M?othList(f,t):[];for(const o of oth){const x=dd(o.d);x.oth+=A(o.amt);x.on++}
 for(const c of D.cx.days){const x=dd(c.d);x.cx+=A(c.gross)-A(c.ret)-A(c.disc);x.hasCx=true;if(c.pt&&c.pt.hm&&(!x.pt||c.pt.hm>x.pt))x.pt=String(c.pt.hm)}
 const days=[...m.values()].sort((a,b)=>a.d<b.d?1:-1),rec=recMap(zc,D.cx);
 const s=k=>days.reduce((a,x)=>a+x[k],0),T={zc:s('zc'),ps:s('ps'),pr:s('pr'),debt:s('debt'),oth:s('oth'),cx:s('cx')};T.pos=T.ps-T.pr;T.all=T.zc+T.pos+(M?T.oth:0);
 let gap=0,gn=0;for(const r of Object.values(rec))if(r&&['ok','gap','over'].includes(r.st)){gap+=A(r.gap);gn++}
 return{days,zc,oth,rec,T,M,gap,gn,zcOn:M||D.zc.on,posOn:D.pos.on,cxOn:D.cx.on}}
const RCLS={ok:'t3',gap:'t1',over:'t4'};
const rTag=r=>{if(!r||r.st==='none')return '';const C=window.CaspitCore||{},st=r.st;return `<span class="tag ${RCLS[st]||''}">${st==='ok'?'✓ תואם':st==='gap'||st==='over'?'פער <bdi dir="ltr">'+ils(r.gap)+'</bdi>'+(st==='over'?' – מעל הסף':''):esc((C.RST&&C.RST[st])||st)}</span>`};
const ptTag=h=>h?` <span class="tag t1">חלקי – עד השעה ${esc(h)}</span>`:'';
const SRC={zc:'סגירות קופה',pos:'קופה חדשה',oth:'הכנסות אחרות',cx:'כספית – להשוואה',all:'סך ההכנסות'};
const dayAmt=(x,k)=>k==='pos'?x.ps-x.pr:k==='all'?x.zc+x.ps-x.pr+(Q.M&&Q.M.M?x.oth:0):x[k];
const hasK=(x,k)=>k==='zc'?x.zn>0:k==='pos'?(x.pn+x.rn)>0:k==='oth'?x.on>0:k==='cx'?x.hasCx:(x.zn+x.pn+x.rn+x.on)>0;

V.incAll=()=>{const T='כל ההכנסות';if(!view())return{t:T,h:'<div class="empty">אין לך הרשאה למסך הזה</div>'};
 const per=`<div class="chips scroll-x nw" role="group" style="margin-bottom:8px">${PER.map(([k,l])=>`<button class="chip${Q.per===k?' on':''}" data-a="incPer" data-k="${k}" aria-pressed="${Q.per===k}" style="min-height:44px">${l}</button>`).join('')}</div>
 ${Q.per==='custom'?`<form class="card" data-f="incRange"><div class="row"><label class="f grow"><span>מתאריך</span><input type="date" name="from" value="${esc(Q.from)}" required style="min-height:44px"></label><label class="f grow"><span>עד תאריך</span><input type="date" name="to" value="${esc(Q.to)}" required style="min-height:44px"></label></div><button class="btn w" style="min-height:48px">הצג</button></form>`:''}`;
 if(!Q.D&&!Q.load&&!Q.err&&(Q.per!=='custom'||(Q.from&&Q.to)))load();
 if(Q.err)return{t:T,h:per+`<div class="card"><p>${esc(Q.err)}</p><button class="btn w" style="min-height:48px" data-a="incRe">נסה שוב</button></div>`};
 if(!Q.D)return{t:T,s:Q.per==='custom'&&!(Q.from&&Q.to)?'בחרו טווח תאריכים':'טוען…',h:per};
 const X=Q.M=model(),D=Q.D,t=X.T;
 const tiles=`<div class="kg">${tile('סך ההכנסות',M2(t.all),'pos','all',X.M?'סגירות + קופה חדשה + אחר':'סגירות + קופה חדשה')}${X.zcOn?tile('סגירות קופה',M2(t.zc),'','zc'):''}${X.posOn?tile('קופה חדשה',M2(t.pos),'','pos',t.pr?'אחרי החזרות <bdi dir="ltr">'+ils(M2(t.pr))+'</bdi>':''):''}${X.M?tile('הכנסות אחרות',M2(t.oth),'','oth'):''}</div>`;
 const notes=[X.M?'':'הכנסות אחרות (שנרשמו ידנית באפליקציה) נשמרות רק במכשיר המנהל ולא מוצגות כאן. הסגירות מוצגות כפי שנשלחו ואושרו, בלי תיקונים שהמנהל עשה אחר כך בספר ההכנסות.',
  D.zc.more?'⚠ יש יותר מ-2,000 סגירות בטווח הזה – חלק לא נספרו. בחרו טווח קצר יותר.':'',
  X.zc.some(z=>z.cl)?'סגירה שהוכנסה בענן ולא נמצאה בהכנסות במכשיר נוספה מהענן (מסומנת "מהענן").':'',
  D.pos.more?'יש יותר מדי מכירות בקופה החדשה בטווח הזה – בחרו טווח קצר יותר.':'',t.debt?'מתוך הקופה החדשה, בהקפה: <bdi dir="ltr">'+ils(M2(t.debt))+'</bdi>.':''].filter(Boolean);
 const cxC=X.cxOn?`<div class="card"><h3 style="margin-top:0">כספית – להשוואה בלבד</h3><div class="kg">${tile('מכירות כספית (נטו)',M2(t.cx),'','cx','לא נכלל בסך')}${X.zcOn&&X.gn?tile('הפרש כספית מול סגירות',M2(X.gap),X.gap?'neg':'','gap',X.gn+' ימים שאפשר להשוות'):''}</div>${X.zcOn&&!Object.keys(D.cx.reg||{}).length?'<p class="note">כדי לראות הפרש, מחברים פעם אחת את קופות כספית לקופות של סגירת הקופה – במסך "מכירות כספית", לשונית "התאמה לסגירת קופה".</p>':''}<p class="note" style="margin-bottom:0">מכירות כספית והסגירה של אותה קופה הן אותו כסף, ולכן כספית לא נספרת בסך. ההפרש = כספית פחות הסגירה, לכל יום שאפשר להשוות (יום חלקי מהרובוט לא נכלל).</p></div>`:'';
 const dayC=x=>{const r=X.rec[x.d],line=(k,l,ex)=>hasK(x,k)?`<div class="row" style="justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;margin-top:6px"><span class="note" style="margin:0">${l}</span><span class="row" style="gap:6px;align-items:center;flex-wrap:wrap">${ex||''}${money('incDay',k,x.d,M2(dayAmt(x,k)))}</span></div>`:'';
  return `<div class="card" style="margin:8px 0"><div class="row" style="justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap"><b>${esc(df(x.d))}</b><b dir="ltr">${ils(M2(dayAmt(x,'all')))}</b></div>
  ${line('zc','סגירות קופה')}${line('pos','קופה חדשה')}${X.M?line('oth','הכנסות אחרות'):''}${X.cxOn&&x.hasCx?`<div style="border-top:1px solid var(--line);margin-top:8px;padding-top:2px">${line('cx','כספית – להשוואה',ptTag(x.pt)+rTag(r))}</div>`:''}</div>`};
 return{t:T,s:(D.f===D.t?df(D.f):df(D.f)+' – '+df(D.t)),h:per+`<div class="card">${tiles}<p class="note" style="margin-bottom:0">לחיצה על משבצת מציגה את הפירוט לפי יום, ומשם את הרשומות.${notes.length?' '+notes.join(' '):''}</p></div>${cxC}
 ${X.M?'<button class="btn g w" style="min-height:44px;margin-top:8px" data-a="go" data-v="incSee">עובדים שרואים את המסך</button>':''}
 <h3 style="margin:14px 0 4px">לפי יום</h3>${X.days.length?X.days.map(dayC).join(''):'<div class="empty">אין הכנסות בתקופה הזו</div>'}`}};
ACT.incPer=el=>{Q.per=el.dataset.k;Q.D=null;Q.err='';rerender()};
ACT.incRe=()=>{Q.D=null;Q.err='';rerender()};
FRM.incRange=f=>{const x=fd(f);if(!x.from||!x.to||x.from>x.to)return toast('טווח תאריכים לא תקין');if((Date.parse(x.to)-Date.parse(x.from))/864e5>400)return toast('טווח של עד 400 ימים');Q.from=x.from;Q.to=x.to;Q.D=null;Q.err='';rerender()};

/* ---------- משבצת → לפי יום ---------- */
ACT.incDl=el=>{const X=Q.M;if(!X)return;let k=el.dataset.k;
 if(k==='gap'){const L=X.days.filter(x=>X.rec[x.d]&&['ok','gap','over'].includes(X.rec[x.d].st));
  return dlg(`<h3>הפרש כספית מול סגירות · לפי יום</h3><div style="max-height:60vh;overflow:auto">${L.map(x=>{const r=X.rec[x.d];return `<div class="card" style="margin:6px 0;padding:10px"><div class="row" style="justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap"><b>${esc(df(x.d))}</b>${rTag(r)}</div><div class="row" style="gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px"><span class="note" style="margin:0">כספית</span>${money('incDay','cx',x.d,r.cx)}<span class="note" style="margin:0">סגירה</span>${money('incDay','zc',x.d,r.z)}</div></div>`}).join('')||'<p class="note">אין ימים להשוואה</p>'}</div>${closeBtn}`)}
 const L=X.days.filter(x=>hasK(x,k));
 dlg(`<h3>${SRC[k]} · לפי יום</h3><div style="max-height:60vh;overflow:auto">${L.map(x=>`<div class="row" style="justify-content:space-between;align-items:center;gap:8px;margin:6px 0;flex-wrap:wrap"><span>${esc(df(x.d))}${k==='cx'?ptTag(x.pt)+' '+rTag(X.rec[x.d]):''}</span>${k==='all'?`<b dir="ltr">${ils(M2(dayAmt(x,k)))}</b>`:money('incDay',k,x.d,M2(dayAmt(x,k)))}</div>`).join('')||'<p class="note">אין</p>'}</div>
 <div class="row" style="justify-content:space-between;border-top:1px solid var(--line);margin-top:6px;padding-top:6px"><b>סה"כ</b><b dir="ltr">${ils(M2(L.reduce((a,x)=>a+dayAmt(x,k),0)))}</b></div>${k==='all'?'<p class="note">לפירוט – לוחצים על סכום במשבצות של כל מקור או בכרטיס של היום.</p>':''}${closeBtn}`)};

/* ---------- יום → הרשומות ---------- */
const back=k=>`<button class="btn g w" style="min-height:44px;margin-top:8px" data-a="incDl" data-k="${k}">לכל הימים</button>`;
ACT.incDay=async el=>{const X=Q.M;if(!X)return;const k=el.dataset.k,d=el.dataset.d,h=`${SRC[k]} · ${esc(df(d))}`;
 if(k==='zc'){const Z=X.zc.filter(z=>z.d===d);
  return dlg(`<h3>${h}</h3><div style="max-height:60vh;overflow:auto">${Z.map(z=>`<div class="card" style="margin:6px 0;padding:10px"><b>דוח Z ${esc(z.no||'—')} · ${esc(regNm(z.reg))}</b>${z.cl?' <span class="tag t1">מהענן</span>':''} <small class="note">${z.tm?esc(z.tm):''}${z.od&&z.od!==z.d?' · נפתחה ב-'+esc(df(z.od)):''}${z.by?' · '+esc(z.by):''}</small>${(z.rows||[]).map(r=>row(esc(r[0]||'הכנסה'),r[1])).join('')}<div class="row" style="justify-content:space-between;border-top:1px solid var(--line);margin-top:6px;padding-top:6px"><b>סה"כ</b><b dir="ltr">${ils(z.amt)}</b></div></div>`).join('')||'<p class="note">אין</p>'}</div>${back(k)}${closeBtn}`)}
 if(k==='oth'){const L=X.oth.filter(o=>o.d===d);
  return dlg(`<h3>${h}</h3><div style="max-height:60vh;overflow:auto">${L.map(o=>`<div class="card" style="margin:6px 0;padding:10px">${row(`<b>${esc(o.c||'הכנסה')}</b>${o.s&&o.s!=='—'?' · '+esc(o.s):''}`,o.amt,o.amt<0?'color:var(--bad)':'')}${o.note?`<small class="note">${esc(o.note)}</small>`:''}</div>`).join('')||'<p class="note">אין</p>'}<div class="row" style="justify-content:space-between;border-top:1px solid var(--line);margin-top:6px;padding-top:6px"><b>סה"כ</b><b dir="ltr">${ils(M2(L.reduce((a,o)=>a+A(o.amt),0)))}</b></div></div>${back(k)}${closeBtn}`)}
 if(k==='cx'){const L=Q.D.cx.days.filter(c=>c.d===d),r=X.rec[d];
  return dlg(`<h3>${h}</h3><p class="note" style="margin-top:0">להשוואה בלבד – לא נכלל בסך ההכנסות.</p>${r?`<p style="margin:0 0 6px">${rTag(r)}${['ok','gap','over'].includes(r.st)?' <span class="note">כספית <bdi dir="ltr">'+ils(r.cx)+'</bdi> · סגירות <bdi dir="ltr">'+ils(r.z)+'</bdi></span>':''}</p>`:''}<div style="max-height:55vh;overflow:auto">${L.map(c=>`<div class="card" style="margin:6px 0;padding:10px"><b>${esc(c.bn||c.bk)}</b>${ptTag(c.pt&&c.pt.hm)}${row('פדיון מכירות',c.gross)}${c.ret?row('החזרות',-c.ret):''}${c.disc?row('הנחות',-c.disc):''}<div class="row" style="justify-content:space-between;border-top:1px solid var(--line);margin-top:6px;padding-top:6px"><b>נטו</b><b dir="ltr">${ils(M2(A(c.gross)-A(c.ret)-A(c.disc)))}</b></div><small class="note">${c.ntx|0} עסקאות</small></div>`).join('')||'<p class="note">אין</p>'}</div>${back(k)}${closeBtn}`)}
 if(k!=='pos')return;
 dlg(`<h3>${h}</h3><p class="note">טוען…</p>${closeBtn}`);
 let P=Q.PD[d];if(!P){try{P=Q.PD[d]=await fnCall('incAll',{op:'day',d})}catch(e){closeDlg();return err(e)}}
 const dl=document.getElementById('dlg');if(!dl||!dl.open)return;
 const S2=(P.sales||[]).filter(x=>x.st!=='void'),R2=(P.rets||[]).filter(x=>x.st!=='void'),sa=S2.reduce((a,x)=>a+A(x.gross),0),ra=R2.reduce((a,x)=>a+A(x.amt),0);
 const sl=x=>`<div class="row" style="justify-content:space-between;gap:8px;margin-top:6px;flex-wrap:wrap"><span>מכירה ${x.seq!=null?esc(String(x.seq)):''} · קופה ${esc(x.dev)}${x.hm?' · '+esc(x.hm):''}${x.cust?' · '+esc(x.cust):''}${x.st==='void'?' <span class="tag">בוטלה – לא נספרה</span>':''}${x.debt?' <span class="tag t1">בהקפה <bdi dir="ltr">'+ils(x.debt)+'</bdi></span>':''}${x.chk?' <span class="tag t1">לבדיקת מנהל</span>':''}</span><b dir="ltr"${x.st==='void'?' style="text-decoration:line-through;opacity:.6"':''}>${ils(x.gross)}</b></div>`;
 const rl=x=>`<div class="row" style="justify-content:space-between;gap:8px;margin-top:6px;flex-wrap:wrap"><span>החזרה · קופה ${esc(x.dev)}${x.hm?' · '+esc(x.hm):''}${x.st==='void'?' <span class="tag">בוטלה – לא נספרה</span>':''}</span><b dir="ltr" style="color:var(--bad)">${ils(-x.amt)}</b></div>`;
 dlg(`<h3>${h}</h3><div style="max-height:60vh;overflow:auto"><div class="card" style="margin:6px 0;padding:10px"><b>מכירות (${S2.length})</b>${(P.sales||[]).map(sl).join('')||'<p class="note">אין</p>'}</div>${(P.rets||[]).length?`<div class="card" style="margin:6px 0;padding:10px"><b>החזרות (${R2.length})</b>${P.rets.map(rl).join('')}</div>`:''}${P.more?'<p class="note">מוצגות 3,000 הרשומות הראשונות של היום.</p>':''}
 ${row('<b>סה"כ אחרי החזרות</b>',M2(sa-ra))}</div>${back(k)}${closeBtn}`)};

/* ---------- מי מהעובדים רואה את "כל ההכנסות" (מנהל בוחר; staff/{uid}.incA – נכתב רק בשרת, incAll op:'see') ---------- */
const SE={L:null,b:0,err:''},UID_OK=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
async function seLoad(){if(SE.b)return;SE.b=1;SE.err='';
 try{const j=await fsx('/staff?pageSize=300');SE.L=((j&&j.documents)||[]).map(d=>{const f=fvj({mapValue:d})||{};return{uid:idOf(d),name:String(f.name||''),email:String(f.email||''),role:String(f.role||''),active:f.active===true,on:f.incA===true}})
  .filter(u=>UID_OK(u.uid)&&u.role!=='manager'&&u.uid!==SY.uid).sort((a,b)=>(b.active-a.active)||(a.name||a.email).localeCompare(b.name||b.email,'he'))}
 catch(e){SE.err=e&&e.offline?e.message:'טעינת רשימת העובדים נכשלה'}
 finally{SE.b=0;try{if(cur().v==='incSee')rerender()}catch(e){}}}
V.incSee=()=>{const T='מי רואה את כל ההכנסות';if(!mgr())return{t:T,h:'<div class="empty">המסך מיועד למנהל בלבד</div>'};
 if(!SE.L&&!SE.err&&!SE.b)seLoad();
 const r=u=>`<div class="card" style="padding:10px 12px;margin:0 0 8px"><b>${esc(u.name||u.email||u.uid)}</b>${u.active?'':' <span class="tag t4">מושבת</span>'}${u.email&&u.name?`<small style="display:block;color:var(--mut)"><bdi dir="ltr">${esc(u.email)}</bdi></small>`:''}`
  +`<label class="cb" style="margin:6px 0 0;min-height:44px;display:flex;align-items:center;gap:8px"><input type="checkbox" data-c="incSeeT" data-uid="${esc(u.uid)}"${u.on?' checked':''}> רואה את כל ההכנסות</label></div>`;
 return{t:T,s:'בחירה לכל עובד',h:'<p class="note">עובד מסומן רואה את מסך "כל ההכנסות": סגירות הקופה, הקופה החדשה ומכירות כספית להשוואה. הכנסות אחרות שנרשמו במכשיר המנהל לא מוצגות לו. השינוי נראה אצלו בכניסה הבאה לאפליקציה.</p>'
  +(SE.err?`<div class="card"><p>${esc(SE.err)}</p><button class="btn g" style="min-height:44px" data-a="incSeeRe">נסה שוב</button></div>`:SE.L?(SE.L.length?SE.L.map(r).join(''):'<div class="empty">אין עובדים</div>'):'<div class="empty">טוען…</div>')}};
ACT.incSeeRe=()=>{SE.L=null;SE.err='';rerender()};
if(typeof CHG!=='undefined')CHG.incSeeT=async el=>{const uid=el.dataset.uid,u=(SE.L||[]).find(x=>x.uid===uid);if(!u||!mgr())return;const on=!!el.checked,nm=u.name||u.email||'העובד';el.disabled=true;
 try{await fnCall('incAll',{op:'see',uid,on});u.on=on;toast(on?'✓ '+nm+' רואה את כל ההכנסות':nm+' כבר לא רואה את כל ההכנסות')}
 catch(e){el.checked=!on;err(e)}finally{el.disabled=false}};
/* עובד מסומן: כפתור במסך הבית */
{const o=V.wk;if(typeof o==='function')V.wk=function(){const r=o.apply(this,arguments);
 try{if(isW()&&typeof WS!=='undefined'&&WS==='home'&&view()&&r&&typeof r.h==='string'){const m='<button class="btn g" style="width:100%;margin-top:14px" data-a="updChk">',b='<button class="btn g" style="width:100%;margin-top:8px;min-height:48px" data-a="go" data-v="incAll">כל ההכנסות</button>';
  r.h=r.h.includes(m)?r.h.replace(m,()=>b+m):r.h+b}}catch(e){}return r}}
})();
