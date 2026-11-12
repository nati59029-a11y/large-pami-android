/* תמחור מחשבונית ספק, שלב 3 (משימה 2026-11-12_תמחור-חשבונית-ספק): כל חשבונית ספק (או תעודת משלוח) שנשמרת עם צילום
   נכנסת גם ל"חשבוניות לתמחור" בענן (pinv, דרך פונקציית השרת piCreate). קובץ עצמאי, נטען אחרי index.html (וגם אחרי pricing-calc.js
   ו-pricing-lines.js). לא משנה שום קוד קיים: רק עוטף (wrap) את נקודות השמירה, ותמיד אחרי שהשמירה הרגילה הסתיימה.
   נקודות השמירה: FRM.scanok (סריקה ישנה + סריקה אחידה trInv לתמונה), FRM.addsave (קובץ סרוק שנשמר בטופס הרגיל – trInv ל-PDF,
   המסך האחיד), bqSaveOne (תור הסריקה המרובה + מסמכים ששותפו לאפליקציה – siToBq), awJoin (חשבונית סרוקה שחוברה לתשלום שממתין לה),
   pushItem (עובד שולח הוצאה למנהל – נכנס לתמחור כבר בשליחה), inbDrop (המנהל דחה את ההוצאה של העובד → piVoid).
   התנאים: מחובר לחשבון (מנהל / עובד), תוספת "מדף" או "הזמנות" פעילה, קטגוריה מסוג ספק (beh==='sup'), חשבונית (לא זיכוי) עם צילום.
   הכול ברקע ובתוך try: ההוצאה עצמה (S.tx) לא משתנה, וכשל כאן לא מפריע לשמירה.
   תור (localStorage, lp-piq לפי העסק): בלי רשת הבקשה ממתינה ונשלחת אחר כך (בחזרת הרשת / כל דקה / בפתיחה). בכל בקשה אחת:
   1. זיהוי השורות – scanDocument kind:'invlines' (הצילום נקרא מהקובץ השמור במכשיר, fget), פענוח – PricingLines.invLines.
      התוצאה נשמרת בתור, כך שכשל בשליחה לא גורם לזיהוי נוסף (מכסה).
   2. piCreate עם מזהה בקשה קבוע לפי הקובץ (rqOf) – לחיצה כפולה / ניסיון חוזר / אותו קובץ פעמיים = מסמך אחד.
   הצילום לא מועלה לענן בשלב הזה: במכשיר נשמר קישור מהחשבונית לקובץ המקומי (PI.img, lp-piimg) – למסך התמחור (שלב 4). */
(function(){
'use strict';
if(typeof ACT==='undefined'||typeof FRM==='undefined'||typeof S==='undefined')return;
const QK=LK('lp-piq'),DK=LK('lp-pidone'),IK=LK('lp-piimg');
const PI={busy:0,cand:new Set(),log:[]};window.PI=PI;
/* ניסיונות חוזרים: 30 שניות ועד שעה; מכסת זיהוי יומית – שעה; עד 40 ניסיונות ואז מוותרים */
PI.dl=[30e3,60e3,120e3,300e3,600e3,1800e3,3600e3];PI.max=40;PI.wait=3000;
const rd=k=>{try{const v=JSON.parse(localStorage.getItem(k));return v&&typeof v==='object'?v:null}catch(e){return null}};
const wr=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}};
const qGet=()=>{const v=rd(QK);return Array.isArray(v)?v:[]};
const qSet=L=>wr(QK,L);
const done=()=>{const v=rd(DK);return Array.isArray(v)?v:[]};
const markDone=rq=>{const L=done().filter(x=>x!==rq);L.push(rq);wr(DK,L.slice(-300))};
/* מזהה בקשה לפי הקובץ: אותו קובץ = אותה חשבונית לתמחור (בשרת: pinv/'i'+reqId). עובד: 'o'+מזהה ההוצאה; המנהל מחשב אותו דבר בדחייה */
const rqOf=fid=>{let s=('pi'+String(fid||'')).replace(/[^A-Za-z0-9_-]/g,'').slice(0,40);while(s.length<8)s+='0';return s};
PI.rqOf=rqOf;
const ID_OK=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,40}$/.test(v);
const DATE_OK=v=>typeof v==='string'&&/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v);
function on(){try{return(isA()||isW())&&(bzF('shelf')||bzF('orders'))&&typeof PricingLines!=='undefined'}catch(e){return false}}
PI.on=on;
const fnc=(n,d)=>{if(SY&&SY.sa&&SY.bizId)d=Object.assign({bizId:SY.bizId},d);return fnCall(n,d)};

/* ---------- הכנסה לתור ---------- */
function add(j){try{if(!on()||!j||!j.rq)return;const L=qGet();if(L.some(x=>x.rq===j.rq&&x.t===j.t)||(j.t==='c'&&done().includes(j.rq)))return;
 j.n=0;j.nx=Date.now()+PI.wait;j.at=Date.now();L.push(j);qSet(L);
 if(j.t==='c'&&j.fid){const m=rd(IK)||{};m['i'+j.rq]=j.fid;const ks=Object.keys(m);if(ks.length>300)delete m[ks[0]];wr(IK,m)}
 later(PI.wait)}catch(e){}}
PI.img=id=>{const m=rd(IK)||{};return m[id]||''};
/* הוצאה של המנהל שנשמרה עם קובץ סרוק */
function fromTx(t,fid){try{if(!t||!fid)return;const c=cat(t.cat);if(!c||c.beh!=='sup')return;
 if((t.kind||'inv')!=='inv'||!(num(t.amt)>0))return;
 const s=t.sub?subById(t.sub):null;
 add({t:'c',rq:rqOf(fid),fid,sup:s&&s.name||'',supId:ID_OK(t.sub)?t.sub:'',inv:s_(t.inv||'')||(t.dn?String(t.note||'').replace(/^ת\. משלוח\s*/,''):''),date:DATE_OK(t.date)?t.date:''})}catch(e){}}
const fromNew=(n0,fid)=>{try{if(!fid)return;for(const t of S.tx.slice(n0))if(t&&t.file===fid)fromTx(t,fid)}catch(e){}};

/* ---------- הוווים (עטיפה בלבד; הקוד המקורי רץ קודם וללא שינוי) ---------- */
{const o=FRM.scanok;if(typeof o==='function')FRM.scanok=function(form,ev){let n0=0,fid=null;try{n0=S.tx.length;fid=A&&A.fid||null;if(fid)PI.cand.add(fid)}catch(e){}
 const r=o.apply(this,arguments);fromNew(n0,fid);return r}}
{const o=FRM.addsave;if(typeof o==='function')FRM.addsave=function(form,ev){let n0=0,fid=null;try{n0=S.tx.length;const c=A&&!A.edit&&A.fid?cat(A.cat):null;if(c&&c.beh==='sup'){fid=A.fid;PI.cand.add(fid)}}catch(e){}
 const r=o.apply(this,arguments);fromNew(n0,fid);return r}}
if(typeof bqSaveOne==='function'){const o=bqSaveOne;bqSaveOne=function(it){let n0=0;try{n0=S.tx.length;if(it&&it.fid)PI.cand.add(it.fid)}catch(e){}
 const r=o.apply(this,arguments);if(r)fromNew(n0,it&&it.fid);return r}}
{const o=ACT.bqAw;if(typeof o==='function')ACT.bqAw=function(el){try{const it=(BQ||[]).find(x=>x.id===el.dataset.id);if(it&&it.fid)PI.cand.add(it.fid)}catch(e){}return o.apply(this,arguments)}}
/* חשבונית סרוקה שחוברה לתשלום בהעברה שממתין לה: הרשומה הקיימת (e) מקבלת את הקובץ. רק קובץ שהגיע מאחת מנקודות הסריקה שלמעלה (PI.cand) –
   לא אישור הוצאה של עובד (inbOk), שכבר נכנסה לתמחור בשליחה */
if(typeof awJoin==='function'){const o=awJoin;awJoin=function(e,t,fid,fx){const r=o.apply(this,arguments);
 try{if(fid&&!fx&&PI.cand.has(fid)&&e)fromTx(Object.assign({},e,{file:fid,kind:'inv',amt:num(e.amt)>0?e.amt:num(t&&t.amt),inv:e.inv||t&&t.inv,dn:t&&t.dn,note:t&&t.note}),fid)}catch(x){}return r}}
/* עובד: ההוצאה נשלחה למנהל (inbox) → לתמחור כבר עכשיו */
if(typeof pushItem==='function'){const o=pushItem;pushItem=async function(it){const r=await o.apply(this,arguments);
 try{const d=it&&it.data;if(isW()&&d&&!d.repl&&!d.reg&&d.kind!=='check'&&it.fileId&&num(d.amt)>0){const c=((cfgLocal()||{}).cats||[]).find(z=>z.id===d.cat);
  if(c&&c.beh==='sup')add({t:'c',rq:rqOf(it.fileId),fid:it.fileId,sup:String(d.subName||''),supId:ID_OK(d.sub)?d.sub:'',inv:s_(d.inv||''),date:DATE_OK(d.date)?d.date:''})}}catch(e){}
 return r}}
/* מנהל דחה הוצאה של עובד → החשבונית יוצאת מהתמחור (piVoid). אותו מזהה כמו אצל העובד: הקובץ שלו הוא 'o'+מזהה ההוצאה */
if(typeof inbDrop==='function'){const o=inbDrop;inbDrop=function(id){let it=null;try{it=(S.inbox||[]).find(x=>x.id===id)||null}catch(e){}
 const r=o.apply(this,arguments);
 try{const d=it&&it.d;if(isA()&&d&&!d.repl&&!d.reg&&ID_OK(id)){const c=cat(d.cat);if(c&&c.beh==='sup')add({t:'v',rq:rqOf('o'+id)})}}catch(e){}
 return r}}

/* ---------- ביצוע (אחד בכל פעם) ---------- */
const PERM_RS=['feature-off','no-perm','manager-only','bad-req','bad-lines','bad-field','bad-date','bad-id','bad-barcode','bad-unit','closed'];
async function pages(fid){const v=await fget(fid);if(!v||typeof v!=='string')throw Object.assign(new Error('הקובץ לא נמצא במכשיר'),{perm:1});
 let L;if(v.startsWith('PAGES:')){try{L=JSON.parse(v.slice(6))}catch(e){L=[]}}else L=[v];
 L=L.filter(x=>typeof x==='string'&&/^data:/.test(x)).slice(0,4);if(!L.length)throw Object.assign(new Error('הקובץ לא נקרא'),{perm:1});
 const out=[];for(const u of L){if(/^data:application\/pdf/.test(u)){out.push({mime_type:'application/pdf',data:u.split(',')[1]});break}
  let x=u;try{x=await ocrDown(u,1800)}catch(e){}out.push({mime_type:'image/jpeg',data:x.split(',')[1]})}
 return out}
async function run(j){
 if(j.t==='v'){await fnc('piVoid',{id:'i'+j.rq});return}
 if(!j.r){const parts=(await pages(j.fid)).map(p=>({inline_data:p}));
  const txt=await shAIcall({contents:[{parts:[{text:''}].concat(parts)}],generationConfig:{responseMimeType:'application/json',temperature:0}},'srv',120000,false,'invlines');
  const x=PricingLines.invLines(String(txt||''));j.r={sup:x.sup,inv:x.inv,date:x.date,lines:x.lines};
  const L=qGet(),k=L.findIndex(y=>y.rq===j.rq&&y.t===j.t);if(k>=0){L[k].r=j.r;qSet(L)}}
 const r=j.r,d={reqId:j.rq,sup:String(j.sup||r.sup||'').slice(0,60),inv:String(j.inv||r.inv||'').slice(0,30),date:DATE_OK(j.date)?j.date:(DATE_OK(r.date)?r.date:''),lines:(r.lines||[]).slice(0,100)};
 if(ID_OK(j.supId))d.supId=j.supId;
 await fnc('piCreate',d)}
/* שגיאה: קבועה (לא מנסים שוב) או זמנית. ביטול שעוד לא מצא את המסמך (העובד עוד לא שלח אותו) – מנסים עוד כמה פעמים */
function kind(j,e){const rs=e&&(e.reason||e.rs)||'';
 if(e&&e.perm)return'perm';
 if(rs==='no-pinv')return j.t==='v'&&j.n<8?'tmp':'perm';
 if(PERM_RS.includes(rs))return'perm';
 if(e&&(e.offline||e.net))return'net';
 if(e&&(e.http===429||e.st==='RESOURCE_EXHAUSTED'))return'quota';
 if(e&&(e.http===400||e.http===401||e.http===403||e.st==='PERMISSION_DENIED'||e.st==='INVALID_ARGUMENT'))return'perm';
 return'tmp'}
async function pump(){if(PI.busy||!on())return;if(typeof navigator!=='undefined'&&navigator.onLine===false)return;
 const now=Date.now(),j=qGet().find(x=>!(x.nx>now));if(!j)return;
 PI.busy=1;let res='ok';
 try{await run(j)}catch(e){res=kind(j,e);PI.log.push({rq:j.rq,t:j.t,res,msg:String(e&&e.message||e).slice(0,120)});if(PI.log.length>50)PI.log.shift()}
 finally{PI.busy=0}
 try{let L=qGet();const k=L.findIndex(x=>x.rq===j.rq&&x.t===j.t);
  if(res==='ok'||res==='perm'){if(k>=0)L.splice(k,1);if(j.t==='c')markDone(j.rq)}
  else if(k>=0){const x=L[k];x.n=(x.n||0)+(res==='net'?0:1);if(x.n>=PI.max){L.splice(k,1);if(j.t==='c')markDone(j.rq)}
   else x.nx=Date.now()+(res==='quota'?3600e3:PI.dl[Math.min(Math.max(0,x.n-1),PI.dl.length-1)])}
  qSet(L)}catch(e){}
 if(res==='ok'||res==='perm')later(50)}
PI.pump=()=>pump().catch(()=>{});
let tmr=0;function later(ms){clearTimeout(tmr);tmr=setTimeout(PI.pump,ms)}
PI.q=qGet;PI.add=add;
try{window.addEventListener('online',()=>later(1000));setInterval(()=>{if(qGet().length)PI.pump()},60e3);later(8000)}catch(e){}
})();
