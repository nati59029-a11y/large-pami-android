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
   3. (שלב 4) צילום החשבונית לענן – piImg בחלקים (pinv/{id}/p/{k}); אחרי piCreate מוצלח (cr) ניסיון חוזר מעלה רק את הצילום.
   במכשיר נשמר גם קישור מהחשבונית לקובץ המקומי (PI.img, lp-piimg) – גיבוי לתצוגה במסך התמחור כשהצילום עוד לא עלה. */
(function(){
'use strict';
if(typeof ACT==='undefined'||typeof FRM==='undefined'||typeof S==='undefined')return;
const QK=LK('lp-piq'),DK=LK('lp-pidone'),IK=LK('lp-piimg');
const PI={busy:0,cand:new Set(),log:[]};window.PI=PI;
/* ניסיונות חוזרים: 30 שניות ועד שעה; מכסת זיהוי יומית – שעה; עד 40 ניסיונות ואז מוותרים */
PI.dl=[30e3,60e3,120e3,300e3,600e3,1800e3,3600e3];PI.max=40;PI.wait=3000;PI.tmo=120000;
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
 try{if(fid&&!fx&&(PI.cand.has(fid)||PI.aw>0)&&e)fromTx(Object.assign({},e,{file:fid,kind:'inv',amt:num(e.amt)>0?e.amt:num(t&&t.amt),inv:e.inv||t&&t.inv,dn:t&&t.dn,note:t&&t.note}),fid)}catch(x){}return r}}
/* מסך "סריקה" (V.scan) – "שמירה כחשבונית" (ACT.qSave), וחשבונית שהגיעה עם צילום לתשלום שממתין לה (FRM.awatt). הקובץ נוצר בתוך הפונקציה:
   qSave – לפי הרשומות החדשות עם file; חיבור לתשלום (awOffer) – הקובץ נרשם ב-PI.cand. awatt – awJoin בזמן הקריאה (PI.aw) */
{const o=ACT.qSave;if(typeof o==='function')ACT.qSave=async function(el){let n0=0;try{n0=S.tx.length;if(el&&el.dataset&&el.dataset.fid)PI.cand.add(el.dataset.fid)}catch(e){}
 const r=await o.apply(this,arguments);
 try{for(const t of S.tx.slice(n0))if(t&&t.file)fromTx(t,t.file);if(typeof AWP!=='undefined'&&AWP&&AWP.fid)PI.cand.add(AWP.fid)}catch(e){}return r}}
{const o=FRM.awatt;if(typeof o==='function')FRM.awatt=async function(){PI.aw=(PI.aw||0)+1;try{return await o.apply(this,arguments)}finally{PI.aw--}}}
/* עובד: ההוצאה נשלחה למנהל (inbox) → לתמחור כבר עכשיו */
if(typeof pushItem==='function'){const o=pushItem;pushItem=async function(it){const r=await o.apply(this,arguments);
 try{const d=it&&it.data;if(isW()&&d&&!d.repl&&!d.reg&&d.kind!=='check'&&it.fileId&&num(d.amt)>0){const c=((cfgLocal()||{}).cats||[]).find(z=>z.id===d.cat);
  if(c&&c.beh==='sup')add({t:'c',rq:rqOf(it.fileId),fid:it.fileId,sup:String(d.subName||''),supId:ID_OK(d.sub)?d.sub:'',inv:s_(d.inv||''),date:DATE_OK(d.date)?d.date:''})}}catch(e){}
 return r}}
/* מנהל דחה הוצאה של עובד → החשבונית יוצאת מהתמחור (piVoid). אותו מזהה כמו אצל העובד: הקובץ שלו הוא 'o'+מזהה ההוצאה */
if(typeof inbDrop==='function'){const o=inbDrop;inbDrop=function(id){let it=null;try{it=(S.inbox||[]).find(x=>x.id===id)||null}catch(e){}
 const r=o.apply(this,arguments);
 try{const d=it&&it.d;if(isA()&&d&&!d.repl&&!d.reg&&d.kind!=='check'&&it.file&&num(d.amt)>0&&ID_OK(id)){const c=cat(d.cat);if(c&&c.beh==='sup')add({t:'v',rq:rqOf('o'+id)})}}catch(e){}
 return r}}

/* ---------- ביצוע (אחד בכל פעם) ---------- */
const PERM_RS=['feature-off','no-perm','manager-only','bad-req','bad-lines','bad-field','bad-date','bad-id','bad-barcode','bad-unit','closed','img-big','bad-img','bad-part','not-owner'];
async function pages(fid){const v=await fget(fid);if(!v||typeof v!=='string')throw Object.assign(new Error('הקובץ לא נמצא במכשיר'),{perm:1});
 let L;if(v.startsWith('PAGES:')){try{L=JSON.parse(v.slice(6))}catch(e){L=[]}}else L=[v];
 L=L.filter(x=>typeof x==='string'&&/^data:/.test(x)).slice(0,4);if(!L.length)throw Object.assign(new Error('הקובץ לא נקרא'),{perm:1});
 const out=[];for(const u of L){if(/^data:application\/pdf/.test(u)){out.push({mime_type:'application/pdf',data:u.split(',')[1]});break}
  let x=u;try{x=await ocrDown(u,1800)}catch(e){}out.push({mime_type:'image/jpeg',data:x.split(',')[1]})}
 return out}
/* שמירת התקדמות של בקשה בתור (כדי שניסיון חוזר ימשיך מאותה נקודה) */
const jSet=(j,o)=>{Object.assign(j,o);const L=qGet(),k=L.findIndex(y=>y.rq===j.rq&&y.t===j.t);if(k>=0){Object.assign(L[k],o);qSet(L)}};
/* שלב 4: צילום החשבונית לענן (piImg → pinv/{id}/p/{k}), כדי שכל מי שמטפל יראה אותו. העמודים כמו לזיהוי (מוקטנים, עד 4; PDF – כמו שהוא).
   בחלקים של IMG_CH תווים, עד IMG_MAX חלקים (כמו בשרת). צילום גדול מדי / קובץ שלא נמצא – מדלגים (החשבונית עצמה כבר בענן) */
const IMG_CH=700000,IMG_MAX=8;PI.ch=IMG_CH;
async function upImg(j,P){if(!P){try{P=await pages(j.fid)}catch(e){if(e&&e.perm)return;throw e}}
 const pdf=P.find(p=>p.mime_type==='application/pdf'),U=(pdf?[pdf]:P).map(p=>'data:'+p.mime_type+';base64,'+p.data);
 const du=U.length===1?U[0]:'PAGES:'+JSON.stringify(U),np=Math.ceil(du.length/PI.ch);if(!np||np>IMG_MAX)return;
 for(let k=0;k<np;k++)await fnc('piImg',{id:'i'+j.rq,k,np,data:du.slice(k*PI.ch,(k+1)*PI.ch)})}
/* מע"מ העסק (ordcfg/main.vat, כמו במודול ההזמנות) – רק לחשבונית שהמחירים בה כוללים מע"מ. לא נקרא / אין – ברירת המחדל */
let VAT=null;async function vatOf(){if(VAT!=null)return VAT;try{const d=await fsx('/ordcfg/main');const v=d&&d.fields&&d.fields.vat?fvj(d.fields.vat):null;VAT=typeof v==='number'&&v>=0&&v<=100?v:undefined}catch(e){return undefined}return VAT}
async function run(j){
 if(j.t==='v'){await fnc('piVoid',{id:'i'+j.rq});return}
 let P0=null;
 if(j.cr){if(j.fid)await upImg(j);return}
 if(!j.r){P0=await pages(j.fid);const parts=P0.map(p=>({inline_data:p}));
  const txt=await shAIcall({contents:[{parts:[{text:''}].concat(parts)}],generationConfig:{responseMimeType:'application/json',temperature:0}},'srv',PI.tmo,false,'invlines');
  const x=PricingLines.invLines(String(txt||''),await vatOf());j.r={sup:x.sup,inv:x.inv,date:x.date,lines:x.lines};
  const L=qGet(),k=L.findIndex(y=>y.rq===j.rq&&y.t===j.t);if(k>=0){L[k].r=j.r;qSet(L)}}
 const r=j.r,d={reqId:j.rq,sup:String(j.sup||r.sup||'').slice(0,60),inv:String(j.inv||r.inv||'').slice(0,30),date:DATE_OK(j.date)?j.date:(DATE_OK(r.date)?r.date:''),lines:(r.lines||[]).slice(0,100)};
 if(ID_OK(j.supId))d.supId=j.supId;
 await fnc('piCreate',d);jSet(j,{cr:1});
 if(j.fid)await upImg(j,P0)}
/* שגיאה: קבועה (לא מנסים שוב) או זמנית. ביטול שעוד לא מצא את המסמך (העובד עוד לא שלח אותו) – מנסים עוד כמה פעמים */
function kind(j,e){const rs=e&&(e.reason||e.rs)||'';
 if(e&&e.perm)return'perm';
 if(rs==='no-pinv')return j.t==='v'&&j.n<8?'tmp':'perm';
 if(PERM_RS.includes(rs))return'perm';
 if(e&&e.ab)return'tmp'; /* הזיהוי לא ענה בזמן: השרת כבר הוריד מהמכסה – נספר כניסיון, ההמתנה גדלה (סבב 1, ליקוי 1) */
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
  else if(k>=0){const x=L[k];x.n=(x.n||0)+1;/* כל כשל נספר (גם רשת) – ההמתנה גדלה עד שעה, ואחרי PI.max מוותרים; בלי רשת בכלל (navigator.onLine) לא מנסים */if(x.n>=PI.max){L.splice(k,1);if(j.t==='c')markDone(j.rq)}
   else x.nx=Date.now()+(res==='quota'?3600e3:PI.dl[Math.min(Math.max(0,x.n-1),PI.dl.length-1)])}
  qSet(L)}catch(e){}
 if(res==='ok'||res==='perm')later(50)}
PI.pump=()=>pump().catch(()=>{});
let tmr=0;function later(ms){clearTimeout(tmr);tmr=setTimeout(PI.pump,ms)}
PI.q=qGet;PI.add=add;
try{window.addEventListener('online',()=>later(1000));setInterval(()=>{if(qGet().length)PI.pump()},60e3);later(8000)}catch(e){}
})();

/* ===== שלב 4: מסך התמחור – V.pi (רשימת החשבוניות הפתוחות) ו-V.piEd (עריכה) =====
   רשימה: pinv עם st='new' (קריאה לפי החוקים – מנהל, או עובד עם מתג prc). חשבונית שנעולה אצל מישהו אחר (lk פחות מ-30 דקות) –
   "בטיפול של X" ואי אפשר להיכנס, גם למנהל (החלטה 6).
   עריכה: כניסה = piClaim; כל PI.beatMs piBeat; כל שינוי – piDraft אחרי PI.draftMs (debounce) כדי שאחר יוכל להמשיך; יציאה מהמסך
   (חזרה / מעבר לשונית – piEd כבר לא ב-NAV) = טיוטה אחרונה + piRelease. מעבר קדימה ממסך התמחור (למשל פתק מדף, שלב 6) לא משחרר.
   סיום = piFinish אחרי אישור (כמה מוצרים יעודכנו / ייווצרו / יחידות למלאי), מזהה בקשה קבוע לכניסה (ניסיון חוזר לא מכפיל).
   מימין בכל שורה – מה שזוהה (שם, ברקוד, כמות, במארז, בקרטון, עלות לפני מע"מ) + תגית ההתאמה; משמאל – מחיר לצרכן כולל מע"מ,
   % רווח, סיטונאי לפני מע"מ ("מהמלאי" / "חושב אוטומטית"), "רק קרטונים סגורים", הדפסה (שלב 6). עסק עם מדף בלבד – בלי סיטונאי וקרטונים.
   כל החישובים – PricingCalc (אותו קוד כמו בשרת). */
(function(){
'use strict';
if(typeof V==='undefined'||typeof ACT==='undefined'||typeof INP==='undefined'||!window.PI||typeof PricingCalc==='undefined')return;
const PC=PricingCalc,PI=window.PI,LOCK_MS=30*60e3;
const BC_RE=/^[0-9A-Za-z-]{3,30}$/,ID_OK=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,40}$/.test(v);
const KEYS=['n','bc','sku','qty','unit','pk','ct','cost','raw','chk','pid','nw','skip','price','wp','wpSrc','cto'];
const fnc=(n,d)=>{d=d&&typeof d==='object'?d:{};if(SY&&SY.sa&&SY.bizId&&!('bizId'in d))d=Object.assign({bizId:SY.bizId},d);return fnCall(n,d)};
const rid=()=>{const a=new Uint8Array(12);crypto.getRandomValues(a);return 'r'+[...a].map(x=>x.toString(36).padStart(2,'0')).join('').slice(0,22)};
const r2=x=>Math.round(x*100)/100,r3=x=>Math.round(x*1000)/1000;
const LOST=['locked','closed','no-pinv','no-perm','feature-off'];
PI.beatMs=60e3;PI.draftMs=1500;
/* מי רואה: מנהל / מנהל־על, או עובד שהמתג prc דולק אצלו במפורש (כבוי כברירת מחדל, גם בלארג' פעמי – החלטה 5). השרת והחוקים אוכפים */
const can=()=>{try{return(isA()||!!(SY&&SY.sa)||(isW()&&!!(SY.perms&&SY.perms.prc===true)))&&(bzF('shelf')||bzF('orders'))}catch(e){return false}};
PI.can=can;
/* "הדפס מחיר" / "הדפס מבצע" – החיבור למדף בשלב 6 (מחליפים את PI.prP / PI.prS) */
PI.prP=PI.prP||(()=>toast('הדפסת פתק מחיר מהחשבונית – בקרוב'));
PI.prS=PI.prS||(()=>toast('הדפסת דף מבצע מהחשבונית – בקרוב'));
const deny=t=>({t,h:'<div class="empty">אין לך הרשאה לעדכון מחירים ומלאי</div>'});
const fresh=lk=>!!lk&&typeof lk.t==='number'&&Date.now()-lk.t<LOCK_MS;
const lkOther=x=>fresh(x.lk)&&x.lk.uid!==SY.uid;
const money=v=>v==null?'':String(v);

/* ---------- עיצוב (מוזרק פעם אחת; רק משתני הערכה הקיימים – כהה/זהב לפי ערכת העסק) ---------- */
try{if(!document.getElementById('pi-css')){const st=document.createElement('style');st.id='pi-css';st.textContent=
'.pil{border:1px solid var(--line);border-radius:14px;background:var(--card);padding:10px;margin:0 0 10px;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px;min-width:0}'
+'.pil.ck{border-color:var(--warn)}.pil>div{min-width:0}'
+'.pil .pr{border-inline-start:1px solid var(--line);padding-inline-start:10px}'
+'@media (max-width:600px){.pil{grid-template-columns:minmax(0,1fr)}.pil .pr{border-inline-start:0;padding-inline-start:0;border-top:1px dashed var(--line);padding-top:8px}}'
+'.pil .g2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.pil .g3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}'
+'.pil label.pf{display:block;margin:0 0 6px;min-width:0;font-size:.8rem;color:var(--mut);font-weight:600}'
+'.pil label.pf input{display:block;min-height:40px;padding:4px 8px;width:100%;min-width:0;border-radius:10px;font-size:.95rem;color:var(--ink);text-align:right}'
+'.pil label.pf input[dir=ltr]{text-align:left}.pil input.bad{border-color:var(--bad);border-width:2px}'
+'.pil .hd{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-bottom:6px}.pil .tag{white-space:normal}'
+'.pil .no{font-weight:800;color:var(--acc)}'
+'.pil .cch{display:block;margin:0 0 6px;padding:4px 8px;border-radius:10px;font-weight:800;border:2px solid currentColor}'
+'.pil .cch.up{color:var(--bad)}.pil .cch.down{color:var(--inc)}'
+'.pil .sm{display:block;font-size:.75rem;color:var(--mut);margin-top:2px;overflow-wrap:anywhere}'
+'.pil .mg{display:block;font-weight:800;margin:-2px 0 6px}.pil .mg.neg{color:var(--exp)}'
+'.pil .lkb{min-height:34px;padding:0 10px;border-radius:999px;border:1.5px solid var(--acc);background:transparent;color:var(--acc);cursor:pointer;font:inherit;font-size:.8rem;font-weight:700}'
+'.pil .cb{display:flex;align-items:center;gap:8px;font-size:.88rem;font-weight:600;margin:2px 0 4px}'
+'.pil .bt{display:flex;gap:6px;margin-top:6px}.pil .bt .btn{flex:1;min-width:0;min-height:40px;padding:0 6px;font-size:.85rem}'
+'.pi-row>svg{width:20px;height:20px;color:var(--mut);transform:scaleX(-1);flex:none}.pi-row[disabled]{opacity:.78;cursor:not-allowed}.pi-hdr small{display:block;color:var(--mut)}'
+'.pi-fin{margin-top:8px}.pil.sk{display:block;opacity:.55;padding:8px 10px}.pil.sk .hd{margin:0}';
document.head.append(st)}}catch(e){}

/* ---------- רשימה ---------- */
const LS={L:null,b:0,err:'',at:0};PI.ls=LS;
async function lload(force){if(LS.b)return;if(!force&&LS.L&&Date.now()-LS.at<10e3)return;LS.b=1;LS.err='';
 try{const F=['sup','inv','date','n','at','byName','lk','np'].map(f=>({fieldPath:f}));
  const r=await fsx(':runQuery',{method:'POST',body:JSON.stringify({structuredQuery:{from:[{collectionId:'pinv'}],select:{fields:F},where:{fieldFilter:{field:{fieldPath:'st'},op:'EQUAL',value:{stringValue:'new'}}},limit:300}})});
  LS.L=(r||[]).filter(x=>x.document&&ID_OK(idOf(x.document))).map(x=>{const f=fvj({mapValue:x.document})||{};
   return{id:idOf(x.document),sup:String(f.sup||''),inv:String(f.inv||''),date:String(f.date||''),n:+f.n||0,at:+f.at||0,byName:String(f.byName||''),lk:f.lk&&typeof f.lk==='object'?f.lk:null,np:+f.np||0}})
   .sort((a,b)=>b.at-a.at);LS.at=Date.now()}
 catch(e){LS.err=e.offline?e.message:(e.code===403?'אין הרשאה לחשבוניות לתמחור (ייתכן שהכללים בשרת עוד לא עודכנו)':'הטעינה נכשלה: '+String(e.message||''))}
 finally{LS.b=0}
 try{if(cur().v==='pi')rerender()}catch(e){}}
PI.lload=lload;
const rowH=x=>{const o=lkOther(x),me=fresh(x.lk)&&x.lk.uid===SY.uid;
 const meta=[x.date?dfmt(x.date):'',x.inv?'מס׳ '+esc(x.inv):'',x.n===1?'שורה אחת':x.n+' שורות'].filter(Boolean).join(' · ');
 return `<button class="li pi-row" ${o?'disabled aria-disabled="true"':`data-a="piOpen" data-id="${esc(x.id)}"`}><div class="m"><b>${esc(x.sup||'ספק לא ידוע')}</b><small>${meta}</small></div>`
  +(o?`<span class="tag t1">בטיפול של ${esc(String(x.lk.name||'משתמש אחר'))}</span>`:me?'<span class="tag t2">אצלך</span>':'')+(o?'':ico('chev'))+'</button>'};
V.pi=()=>{const T='חשבוניות לתמחור';if(!can())return deny(T);
 if(!LS.L){if(!LS.b&&!LS.err)lload();return{t:T,h:LS.err?`<div class="card"><p class="note">${esc(LS.err)}</p><button class="btn g w" data-a="piRe">נסה שוב</button></div>`:'<div class="empty">טוען…</div>'}}
 if(!LS.b&&!LS.err&&Date.now()-LS.at>=10e3)setTimeout(()=>lload(),0);
 return{t:T,s:'מחירים ומלאי מחשבוניות ספק',h:(LS.err?`<p class="note">${esc(LS.err)}</p>`:'')
  +(LS.L.length?LS.L.map(rowH).join(''):'<div class="empty">אין חשבוניות לתמחור</div>')+'<button class="btn g s w" style="margin-top:8px" data-a="piRe">רענן</button>'}};
ACT.piRe=()=>{LS.err='';lload(true)};
ACT.piOpen=el=>{const id=el.dataset.id;if(ID_OK(id))go('piEd',id)};

/* ---------- עריכה: מצב ---------- */
let E=null;PI.ed=()=>E;
const prodOf=(e,i)=>{const l=e.L[i],m=e.M[i]||{};if(!l||!l.pid)return null;if(m.m&&m.m.pid===l.pid)return m.m;return(m.oth||[]).find(o=>o.pid===l.pid)||null};
/* הצעות קישור לשורה: ההתאמה של השרת (ברקוד+ספק / קוד ספק / שם) ואותו ברקוד אצל ספק אחר */
const cands=(e,i)=>{const m=e.M[i]||{},L=[];if(m.m&&m.k!=='pid')L.push(m.m);else if(m.m&&m.k==='pid'&&e.S0[i])L.push(m.m);for(const o of m.oth||[])if(!L.some(x=>x.pid===o.pid))L.push(o);return L};
function autoWp(e,l){if(!e.ord)return;if(l.wpSrc==='auto'||l.wp==null){const w=PC.wsDefault(l.cost);if(w!=null){l.wp=w;l.wpSrc='auto'}else if(l.wpSrc==='auto'){delete l.wp;delete l.wpSrc}}}
/* קישור למוצר: ממלא מהמלאי מה שעוד לא הוזן (מחיר לצרכן, סיטונאי אם חושב אוטומטית, "קרטונים סגורים") */
function link(e,i,p){const l=e.L[i];l.pid=p.pid;delete l.nw;
 if(l.price==null&&p.price!=null)l.price=p.price;
 if(e.ord){if((l.wp==null||l.wpSrc==='auto')&&p.wp!=null){l.wp=p.wp;l.wpSrc='stock'}if(l.cto==null&&typeof p.cto==='boolean')l.cto=p.cto}}
function unlink(e,i){const l=e.L[i];delete l.pid;l.nw=true;if(l.wpSrc==='stock'){delete l.wp;l.wpSrc='auto';autoWp(e,l)}}
function init(e,r){const inv=r.inv||{};e.inv=inv;e.vat=typeof r.vat==='number'?r.vat:PC.VAT0;e.ord=r.ord!==false;e.until=r.until||0;
 e.M=Array.isArray(r.m)?r.m:[];e.S0=[];e.B=[];
 e.L=[];(Array.isArray(inv.lines)?inv.lines:[]).forEach((l0,i)=>{const l={};for(const k of KEYS)if(l0&&l0[k]!=null)l[k]=l0[k];e.L[i]=l;const m=e.M[i]||{};
  e.S0[i]=m.m&&['bc','sku','name'].includes(m.k)?m.k:(m.k==='pid'?'pid':'');
  if(!l.pid&&!l.nw&&m.m&&['bc','sku','name'].includes(m.k))link(e,i,m.m);/* הצעה – מקושרת כברירת מחדל; אפשר לבטל ("מוצר חדש") */
  else if(l.pid&&m.m&&m.m.pid===l.pid)link(e,i,m.m);
  if(!e.ord){delete l.wp;delete l.wpSrc;delete l.cto}else autoWp(e,l);
  e.B[i]=l.unit==='ct'?{n:l.ct?l.qty/l.ct:l.qty,cp:l.ct&&l.cost!=null?l.cost*l.ct:null}:null})}/* שורת קרטונים: מספר הקרטונים ומחיר קרטון – לשינוי כמות בקרטון */
/* השורות לשליחה (piDraft / piFinish): רק השדות שהשרת מכיר, בלי ערכים ריקים */
function out(e){return e.L.map(l=>{const o={};for(const k of KEYS){const v=l[k];if(v==null||v==='')continue;if(k==='nw'||k==='skip'){if(v===true)o[k]=true;continue}if(k==='cto'){if(e.ord&&typeof v==='boolean')o[k]=v;continue}
  if((k==='wp'||k==='wpSrc')&&!e.ord)continue;if(k==='bc'&&!BC_RE.test(v))continue;o[k]=v}if(!o.n)o.n='';if(o.qty==null)o.qty=0;return o})}
PI.out=()=>E?out(E):null;
async function start(id){const e={id,rq:rid(),busy:1};E=e;
 try{const r=await fnc('piClaim',{id});if(E!==e){fnc('piRelease',{id}).catch(()=>{});return}/* כבר יצאו מהמסך */
  init(e,r);e.busy=0;beat(e)}
 catch(x){if(E!==e)return;e.busy=0;e.err=x&&x.message||'הכניסה לחשבונית נכשלה';if(x&&x.offline)e.err='אין חיבור לאינטרנט – אי אפשר להיכנס לחשבונית';LS.at=0}
 if(E===e&&cur().v==='piEd'&&cur().a===id)rerender()}
function beat(e){clearInterval(e.bt);e.bt=setInterval(async()=>{if(E!==e||e.fin){clearInterval(e.bt);return}
 try{await fnc('piBeat',{id:e.id})}catch(x){await lost(e,x)}},PI.beatMs)}
/* הנעילה כבר לא אצלי. פגה ואף אחד לא נכנס (not-locked) – נכנסים שוב בשקט ושומרים את מה שבמסך */
async function lost(e,x){const rs=x&&x.reason||'';if(!rs||(x&&x.offline))return false;
 if(rs==='not-locked'&&(e.rc=(e.rc||0)+1)<=3){try{await fnc('piClaim',{id:e.id});e.dirty=1;await draft(e);return true}catch(y){x=y}}
 if(!LOST.includes(x&&x.reason||'')&&(x&&x.reason)!=='not-locked')return false;
 e.lost=x.message||'החשבונית כבר לא אצלך';clearInterval(e.bt);clearTimeout(e.dt);if(E===e&&cur().v==='piEd')rerender();return false}
async function draft(e){clearTimeout(e.dt);if(!e||!e.dirty||e.fin||e.lost||!e.L)return;e.dirty=0;
 try{await fnc('piDraft',{id:e.id,lines:out(e)})}catch(x){e.dirty=1;if(!(await lost(e,x))&&!e.lost&&E===e)e.dt=setTimeout(()=>draft(e),Math.max(PI.draftMs,5000))}}
const dirty=()=>{if(!E||!E.L||E.lost||E.fin)return;E.dirty=1;clearTimeout(E.dt);const e=E;E.dt=setTimeout(()=>draft(e),PI.draftMs)};
/* יציאה מהמסך: piEd כבר לא ב-NAV (חזרה / לשונית). מעבר קדימה (piEd עדיין ב-NAV) – הנעילה נשארת */
function leave(){const e=E;E=null;if(!e)return;clearInterval(e.bt);clearTimeout(e.dt);if(e.fin||e.busy||e.err)return;
 (async()=>{if(!e.lost){if(e.dirty&&e.L){try{e.dirty=0;await fnc('piDraft',{id:e.id,lines:out(e)})}catch(x){}}try{await fnc('piRelease',{id:e.id})}catch(x){}}
  LS.at=0;try{if(cur().v==='pi')lload(true)}catch(x){}})()}
PI.leave=leave;
{const r0=render;render=function(){const x=r0.apply(this,arguments);try{if(E&&!NAV.some(n=>n.v==='piEd'&&n.a===E.id))leave()}catch(e){}return x}}
try{document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&E&&E.dirty)draft(E)})}catch(e){}

/* ---------- עריכה: תצוגה ---------- */
const TAGS={bc:'מוצר קיים',pid:'מוצר קיים',sku:'הותאם לפי קוד ספק',name:'הותאם לפי שם – לבדוק'};
function tagH(e,i){const l=e.L[i],m=e.M[i]||{},p=prodOf(e,i),C=cands(e,i),dis=e.lost?' disabled':'';
 if(l.pid){const k=m.m&&m.m.pid===l.pid?(e.S0[i]||'pid'):'oth';
  const t=k==='oth'?`<span class="tag t3">מוצר קיים${p&&p.sup?' · ספק: '+esc(p.sup):''}</span>`:`<span class="tag ${k==='name'?'t1':'t3'}">${TAGS[k]||'מוצר קיים'}</span>`;
  return t+(p&&p.name&&p.name!==l.n?`<small class="sm">במלאי: ${esc(p.name)}</small>`:'')+`<button type="button" class="lkb" data-a="piUnl" data-x="${i}"${dis}>בטל התאמה – מוצר חדש</button>`}
 const o=(m.oth||[])[0];
 return(o&&!l.nw?`<span class="tag t1">קיים אצל ספק אחר: ${esc(o.sup||'')}</span>`:'')+'<span class="tag t2">מוצר חדש</span>'+(C.length?`<button type="button" class="lkb" data-a="piLnk" data-x="${i}"${dis}>קשר למוצר קיים</button>`:'')}
function cchH(e,i){const l=e.L[i],p=prodOf(e,i);if(!p||p.costx==null||l.cost==null)return'';const d=PC.costChange(l.cost,p.costx);if(!d)return'';
 return`<span class="cch ${d}">${d==='up'?'↑ העלות עלתה':'↓ העלות ירדה'} · קודם ${ils(p.costx)}</span>`}
function mgH(e,i){const l=e.L[i],m=PC.marginInc(l.price,l.cost,e.vat);return m==null?'רווח: —':`רווח: ${m}%`}
const wsrc=l=>l.wpSrc==='stock'?'מהמלאי':l.wpSrc==='auto'?'חושב אוטומטית (עלות × 1.5)':l.wpSrc==='man'?'הוזן ידנית':'';
const fld=(lb,i,k,v,a)=>`<label class="pf"><span>${lb}</span><input data-i="piF" data-x="${i}" data-k="${k}" value="${esc(money(v))}" autocomplete="off" ${a||''}${E&&E.lost?' disabled':''}></label>`;
function lineH(e,l,i){const dis=e.lost?' disabled':'',p=prodOf(e,i);
 const L=`<div><div class="hd"><span class="no">${i+1}.</span>${tagH(e,i)}<button type="button" class="lkb" data-a="piSkip" data-x="${i}" data-v="1"${dis}>דלג על השורה</button></div>${l.chk?`<span class="tag t1">לבדיקה: ${esc(l.chk)}</span>`:''}
  ${fld('שם',i,'n',l.n,'maxlength="60"')}
  <div class="g2">${fld('ברקוד',i,'bc',l.bc,'dir="ltr" inputmode="numeric" maxlength="30"')}${fld('כמות למלאי',i,'qty',l.qty,'inputmode="decimal"')}</div>
  <div class="g3">${fld('במארז',i,'pk',l.pk,`inputmode="numeric"${p&&p.pk?` placeholder="${esc(String(p.pk))}"`:''}`)}${fld('מארזים בקרטון',i,'ct',l.ct,`inputmode="numeric"${p&&p.ct?` placeholder="${esc(String(p.ct))}"`:''}`)}${fld('עלות לפני מע"מ',i,'cost',l.cost,'inputmode="decimal"')}</div>
  <span id="pic${i}">${cchH(e,i)}</span>${l.raw?`<small class="sm">בחשבונית: ${esc(l.raw)}</small>`:''}</div>`;
 const R=`<div class="pr">${fld('מחיר לצרכן כולל מע"מ',i,'price',l.price,'inputmode="decimal"')}<b class="mg" id="pim${i}">${mgH(e,i)}</b>
  ${e.ord?`${fld('מחיר סיטונאי לפני מע"מ',i,'wp',l.wp,'inputmode="decimal"')}<small class="sm" id="pis${i}" style="margin-top:-4px;margin-bottom:6px">${wsrc(l)}</small>
  <label class="cb"><input type="checkbox" data-c="piCto" data-x="${i}"${l.cto?' checked':''}${dis}>רק קרטונים סגורים</label>`:''}
  <div class="bt"><button type="button" class="btn g s" data-a="piPrP" data-x="${i}">הדפס מחיר</button><button type="button" class="btn g s" data-a="piPrS" data-x="${i}">הדפס מבצע</button></div></div>`;
 return`<div class="pil${l.chk?' ck':''}" id="pil${i}">${L}${R}</div>`}
/* שורה שדילגו עליה (פיקדון, דמי משלוח…): מעומעמת, עם "החזר". לא נספרת בסיום, לא נוצר ממנה מוצר ולא נוספת כמות (skip בשרת) */
function lineX(e,l,i){if(!l.skip)return lineH(e,l,i);const dis=e.lost?' disabled':'';
 return`<div class="pil sk" id="pil${i}"><div class="hd"><span class="no">${i+1}.</span><b>${esc(l.n||l.bc||'')}</b><span class="tag">דילוג – לא ייכנס למלאי</span><button type="button" class="lkb" data-a="piSkip" data-x="${i}" data-v="0"${dis}>החזר</button></div></div>`}
V.piEd=id=>{const T='תמחור חשבונית';if(!can())return deny(T);
 if(!E||E.id!==id){if(E)leave();start(id);return{t:T,h:'<div class="empty">נכנס לחשבונית…</div>'}}
 if(E.err)return{t:T,h:`<div class="card"><p><b>${esc(E.err)}</b></p><button class="btn g w" data-a="back">חזרה</button></div>`};
 if(E.busy||!E.L)return{t:T,h:'<div class="empty">נכנס לחשבונית…</div>'};
 const v=E.inv,img=(+v.np>0)||!!PI.img(E.id);
 const hdr=`<div class="card pi-hdr"><div class="row" style="justify-content:space-between;flex-wrap:wrap"><div style="min-width:0;flex:1"><b>${esc(v.sup||'ספק לא ידוע')}</b><small>${[v.inv?'חשבונית '+esc(v.inv):'',v.date?dfmt(v.date):'',E.L.length+' שורות'].filter(Boolean).join(' · ')}</small>${v.byName?`<small>נשלחה על ידי ${esc(v.byName)}</small>`:''}</div>${img?'<button type="button" class="btn g s" data-a="piImgV">צילום החשבונית</button>':'<small class="note">אין צילום</small>'}</div>${E.ord?'':'<small class="note" style="display:block;margin-top:6px">עסק בלי הזמנות: בלי מחיר סיטונאי ובלי עדכון מלאי</small>'}</div>`;
 const lostH=E.lost?`<div class="card" style="border-color:var(--bad)"><b>${esc(E.lost)}</b><p class="note">אי אפשר להמשיך לערוך. חזרו לרשימה.</p></div>`:'';
 return{t:T,s:v.sup||'',h:lostH+hdr+(E.L.length?E.L.map((l,i)=>lineX(E,l,i)).join(''):'<div class="empty">לא זוהו שורות בחשבונית</div>')
  +(E.lost?'':`<button type="button" class="btn w pi-fin" data-a="piFin">סיום ושמירה</button>`)}};

/* ---------- עריכה: פעולות ---------- */
const isOn=el=>document.activeElement===el;
function upd(i){if(!E||!E.L[i])return;const l=E.L[i],q=(k)=>document.querySelector(`#pil${i} input[data-k="${k}"]`);
 const a=document.getElementById('pim'+i);if(a){a.textContent=mgH(E,i);const m=PC.marginInc(l.price,l.cost,E.vat);a.classList.toggle('neg',m!=null&&m<0)}
 const c=document.getElementById('pic'+i);if(c)c.innerHTML=cchH(E,i);
 const s=document.getElementById('pis'+i);if(s)s.textContent=wsrc(l);
 for(const k of ['wp','qty','cost']){const x=q(k);if(x&&!isOn(x))x.value=money(l[k])}}
INP.piF=el=>{if(!E||!E.L||E.lost)return;const i=+el.dataset.x,k=el.dataset.k,l=E.L[i];if(!l)return;const v=String(el.value||''),t=v.trim(),n=PC.num(t);let ok=true;
 if(k==='n')l.n=v.slice(0,60);
 else if(k==='bc'){ok=!t||BC_RE.test(t);if(ok){if(t)l.bc=t;else delete l.bc}}
 else if(k==='pk'||k==='ct'){ok=!t||(n!=null&&Number.isInteger(n)&&n>0&&n<=100000);if(ok){if(t)l[k]=n;else delete l[k];
   const B=E.B[i];if(k==='ct'&&B&&t){l.qty=r3(B.n*n);if(B.cp!=null){const c=PC.packCost(B.cp,n);if(c!=null)l.cost=c}autoWp(E,l)}}}
 else{const max=k==='qty'?100000:1000000;ok=!t||(n!=null&&n<=max);if(ok){if(t)l[k]=k==='qty'?r3(n):r2(n);else delete l[k];
   if(k==='qty'&&E.B[i])E.B[i].n=l.ct?l.qty/l.ct:(l.qty||0);
   if(k==='cost'){if(E.B[i])E.B[i].cp=l.ct&&l.cost!=null?l.cost*l.ct:null;autoWp(E,l)}
   if(k==='wp'){if(t)l.wpSrc='man';else delete l.wpSrc}}}
 el.classList.toggle('bad',!ok);upd(i);if(ok)dirty()};
CHG.piCto=el=>{if(!E||!E.L||E.lost)return;const l=E.L[+el.dataset.x];if(!l)return;l.cto=!!el.checked;dirty()};
ACT.piSkip=el=>{if(!E||!E.L||E.lost)return;const l=E.L[+el.dataset.x];if(!l)return;if(el.dataset.v==='1')l.skip=true;else delete l.skip;dirty();rerender()};
ACT.piUnl=el=>{if(!E||E.lost)return;const i=+el.dataset.x;if(!E.L[i])return;unlink(E,i);dirty();rerender()};
ACT.piLnk=el=>{if(!E||E.lost)return;const i=+el.dataset.x,C=cands(E,i);if(!C.length)return;
 if(C.length===1){link(E,i,C[0]);dirty();rerender();return}
 dlg(`<h3>קישור למוצר קיים</h3><p class="note">${esc(E.L[i].n||'')}</p>${C.map(p=>`<button type="button" class="li" data-a="piLnk2" data-x="${i}" data-id="${esc(p.pid)}"><div class="m"><b>${esc(p.name)}</b><small>${p.sup?'ספק: '+esc(p.sup):'בלי ספק'}${p.price!=null?' · '+ils(p.price):''}</small></div></button>`).join('')}<button type="button" class="btn g w" data-a="closeDlg">ביטול</button>`)};
ACT.piLnk2=el=>{if(!E||E.lost)return;const i=+el.dataset.x,p=cands(E,i).find(x=>x.pid===el.dataset.id);closeDlg();if(!p)return;link(E,i,p);dirty();rerender()};
ACT.piPrP=el=>PI.prP(+el.dataset.x);
ACT.piPrS=el=>PI.prS(+el.dataset.x);
ACT.piImgV=async()=>{if(!E||!E.inv)return;const id=E.id,np=+E.inv.np||0;
 if(np>0){toast('טוען צילום...');let du='';try{for(let k=0;k<np;k++){const c=await fsx('/pinv/'+id+'/p/'+k);du+=gv(c,'data')}}catch(e){return toast(e.offline?e.message:'טעינת הצילום נכשלה')}
  return viewImg('','Invoice_'+id,du)}
 const f=PI.img(id);if(f)return viewImg(f,'Invoice_'+id);toast('אין צילום לחשבונית הזו')};
/* סיום: בדיקה, ואז אישור קצר עם מה שיקרה במלאי */
function sums(e){const up=new Set(),nw=new Set();let q=0;
 e.L.forEach((l,i)=>{if(l.skip)return;if(l.pid)up.add(l.pid);else nw.add(l.bc?'b:'+l.bc:'n:'+i);q+=l.qty||0});return{up:up.size,nw:nw.size,q:r3(q)}}
ACT.piFin=()=>{if(!E||!E.L||E.lost||E.fin)return;
 if(document.querySelector('.pil input.bad'))return toast('יש שדה עם ערך לא תקין (מסומן באדום)');
 for(let i=0;i<E.L.length;i++){const l=E.L[i];if(l.skip)continue;
  if(!String(l.n||'').trim()&&!l.pid)return toast(`שורה ${i+1}: חסר שם מוצר`);
  if(E.ord&&!l.pid&&l.price==null)return toast(`שורה ${i+1}: חסר מחיר לצרכן למוצר חדש`)}
 const s=sums(E),B=E.ord&&s.q>0&&typeof brList==='function'?brList():[];
 const brH=B.length>1?`<label class="f"><span>לאיזה סניף נכנס המלאי</span><select name="br">${B.map(b=>`<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('')}</select></label>`:B.length===1?`<input type="hidden" name="br" value="${esc(B[0].id)}"><p class="note">סניף: ${esc(B[0].name)}</p>`:'';
 const body=E.ord?`<p>יעודכנו <b id="piSU">${s.up}</b> מוצרים קיימים · ייווצרו <b id="piSN">${s.nw}</b> מוצרים חדשים · יתווספו <b id="piSQ">${s.q}</b> יחידות למלאי.</p>`:'<p>החשבונית תיסגר. בעסק בלי הזמנות אין מלאי בענן לעדכן.</p>';
 dlg(`<h3>סיום ושמירה</h3>${body}<form data-f="piFinF">${brH}<p class="note">אחרי הסיום החשבונית יוצאת מהרשימה לכולם.</p><div class="row"><button class="btn grow">אישור ושמירה</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`)};
FRM.piFinF=async f=>{if(!E||!E.L||E.fin)return;const e=E,x=fd(f),b=f.querySelector('button');b.disabled=true;clearTimeout(e.dt);
 const d={id:e.id,reqId:e.rq,lines:out(e)};if(x.br)d.br=x.br;
 try{const r=await fnc('piFinish',d);e.fin=1;clearInterval(e.bt);closeDlg();
  toast(e.ord?`נשמר: ${r&&r.updated||0} עודכנו, ${r&&r.added||0} נוספו, ${r&&r.qty||0} יחידות למלאי`:'החשבונית נסגרה');
  if(LS.L)LS.L=LS.L.filter(y=>y.id!==e.id);LS.at=0;
  if(cur().v==='piEd'&&NAV.length>1)goBack();else{E=null;rerender()}}
 catch(y){b.disabled=false;const back=await lost(e,y);if(e.lost)closeDlg();toast(back?'החיבור לחשבונית חודש – נסו שוב':(y&&y.message||'השמירה נכשלה'))}};
})();
