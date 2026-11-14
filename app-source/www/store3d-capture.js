/* סריקת חנות בתלת מימד – שלב 7 (משימה 2026-11-14_סריקת-חנות-תלת-מימד): מסכי סבב.
   קובץ עצמאי, נטען אחרי store3d.js ו-store3d-editor.js. מוסיף את המסך V.st3c (צילום סבב לעובד) ואת תוכן הלשונית "סבבים" של המנהל (S3UI.tabHtml).
   עובד: מסלול מומלץ לפי מספור הגופים (מהכניסה) + בחירה חופשית של מקטע; תמונה למקטע, או סרטון לצד שלם של גוף (במכשיר שולפים תמונה חדה לכל מקטע, הסרטון לא נשמר);
   מקטע גבוה = תמונה עליונה ותחתונה; הנחיה למקרר; הודעה מיידית "צלמו שוב" כשהתמונה לא חדה או חשוכה (בדיקה במכשיר, ספים לא מאומתים);
   תור שליחה בטלפון (IndexedDB) עם מזהה קבוע לכל פריט (qid) ונסיון חוזר – עובד גם בלי רשת; הפסקה/המשך/סיום עם זמן הטלפון (s3Log).
   שרת: s3View (סבבים ופרטי סבב), s3Move (לקיחה / העברה), s3Run (פתיחה/ביטול), s3Log (אירועי זמן), shelfCheck (תמונה – שלב 8, עוד לא קיימת: עד אז הפריטים נשארים בתור).
   אין כאן שום קריאה לשרת כשהתוסף כבוי (feat()). */
(function(){
'use strict';
const U=window.S3UI;
if(!U||typeof ACT==='undefined'||typeof V==='undefined'||typeof CHG==='undefined'||typeof go==='undefined')return;
const esc2=U.esc2;
/* ספי איכות במכשיר – (לא מאומת) – ערכי פתיחה, לכוונון אחרי בדיקה בטלפון בחנות אמיתית */
const SHARP_MIN=25,DARK_MAX=45,FULL=1600,FULL_MAX=1400000,THUMB=320;
const C={own:'',rid:'',run:null,map:null,slots:[],groups:[],cur:'',open:'',ph:{},loc:{},rt:{},tl:[],err:'',busy:0,msg:'',pend:null,vp:'',cache:0,qn:0,qf:0,qfm:'',fl:0,mg:null,mgAt:0,mgErr:'',mgBusy:0,staff:null};
U.C=C;
const me=()=>(SY&&SY.bizId||'')+'|'+(SY&&SY.uid||'');
const loggedIn=()=>!!(SY&&SY.refresh&&SY.uid);
const typing=()=>{const a=document.activeElement;return !!(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)&&a.closest('#main'))};
const lsG=k=>{try{return JSON.parse(localStorage.getItem(LK('lp-'+k))||'null')}catch(e){return null}};
const lsS=(k,v)=>{try{localStorage.setItem(LK('lp-'+k),JSON.stringify(v))}catch(e){}};
const hm=ms=>{try{return new Date(ms).toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'})}catch(e){return ''}};
const dm=ms=>{try{return new Date(ms).toLocaleDateString('he-IL',{weekday:'long',day:'numeric',month:'numeric'})}catch(e){return ''}};
const qid=()=>{try{if(crypto&&crypto.randomUUID)return crypto.randomUUID()}catch(e){}let s='';for(let i=0;i<32;i++)s+='0123456789abcdef'[Math.random()*16|0];return s};

/* ---------- אחסון בטלפון (IndexedDB): תור שליחה + עותק של הסבב והמפה לעבודה בלי רשת ---------- */
let DB=null,DBN='';
const idb=()=>{const n=LK('lp-s3q');if(DB&&DBN===n)return DB;DBN=n;return DB=new Promise((res,rej)=>{let r;try{r=indexedDB.open(n,1)}catch(e){return rej(e)}
 r.onupgradeneeded=()=>{const d=r.result;d.createObjectStore('q',{keyPath:'id',autoIncrement:true});d.createObjectStore('m')};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})};
const tx=async(st,mode,fn)=>{const d=await idb();return new Promise((res,rej)=>{const t=d.transaction(st,mode);let out;const rq=fn(t.objectStore(st));if(rq)rq.onsuccess=()=>{out=rq.result};t.oncomplete=()=>res(out);t.onerror=t.onabort=()=>rej(t.error)})};
const qAdd=r=>tx('q','readwrite',s=>s.add(r)),qAll=()=>tx('q','readonly',s=>s.getAll()),qPut=r=>tx('q','readwrite',s=>s.put(r)),qDel=id=>tx('q','readwrite',s=>s.delete(id));
const mGet=k=>tx('m','readonly',s=>s.get(k)),mSet=(k,v)=>tx('m','readwrite',s=>s.put(v,k));
async function recount(){try{const L=(await qAll()).filter(r=>r.own===me());const f=L.filter(r=>r.fail);C.qn=L.length-f.length;C.qf=f.length;C.qfm=f.length?f[0].fail:''}catch(e){}}

/* ---------- עיבוד תמונה במכשיר ---------- */
const blobOf=(c,q)=>new Promise(r=>c.toBlob(r,'image/jpeg',q));
async function decode(file){
 if(window.createImageBitmap){try{const b=await createImageBitmap(file,{imageOrientation:'from-image'});return{src:b,w:b.width,h:b.height,close:()=>{try{b.close()}catch(e){}}}}catch(e){}}
 return new Promise((res,rej)=>{const u=URL.createObjectURL(file),i=new Image();i.onload=()=>res({src:i,w:i.naturalWidth,h:i.naturalHeight,close:()=>URL.revokeObjectURL(u)});i.onerror=()=>{URL.revokeObjectURL(u);rej(new Error('bad'))};i.src=u})}
/* חדות (שונות הלפלסיאן) ובהירות ממוצעת, על עותק קטן */
function quality(src,w,h){
 const k=Math.min(1,256/Math.max(w,h)),cw=Math.max(8,Math.round(w*k)),ch=Math.max(8,Math.round(h*k)),c=document.createElement('canvas');c.width=cw;c.height=ch;
 const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(src,0,0,cw,ch);const d=x.getImageData(0,0,cw,ch).data,g=new Float32Array(cw*ch);let sum=0;
 for(let i=0;i<g.length;i++){const v=.299*d[i*4]+.587*d[i*4+1]+.114*d[i*4+2];g[i]=v;sum+=v}
 let m=0,m2=0,n=0;for(let y=1;y<ch-1;y++)for(let xx=1;xx<cw-1;xx++){const i=y*cw+xx,l=4*g[i]-g[i-1]-g[i+1]-g[i-cw]-g[i+cw];m+=l;m2+=l*l;n++}
 return{sharp:n?m2/n-(m/n)*(m/n):0,lum:sum/g.length}}
/* הקטנה לכ-1600px (JPEG, עד כ-1.4MB) + תמונה מוקטנת לתצוגה */
async function shrink(src,w,h){
 const k=Math.min(1,FULL/Math.max(w,h));let cw=Math.round(w*k),ch=Math.round(h*k),q=.85,full=null;
 for(let i=0;i<6;i++){const c=document.createElement('canvas');c.width=cw;c.height=ch;c.getContext('2d').drawImage(src,0,0,cw,ch);full=await blobOf(c,q);if(full&&full.size<=FULL_MAX)break;if(q>.5)q=Math.max(.5,q-.1);else{cw=Math.round(cw*.85);ch=Math.round(ch*.85)}}
 const k2=Math.min(1,THUMB/Math.max(w,h)),tc=document.createElement('canvas');tc.width=Math.max(1,Math.round(w*k2));tc.height=Math.max(1,Math.round(h*k2));tc.getContext('2d').drawImage(src,0,0,tc.width,tc.height);
 return{full,th:await blobOf(tc,.7),w:cw,h:ch}}
async function prep(file){const d=await decode(file);try{return Object.assign(await shrink(d.src,d.w,d.h),quality(d.src,d.w,d.h))}finally{d.close()}}
const badOf=p=>p.lum<DARK_MAX?'dark':p.sharp<SHARP_MIN?'blur':'';
/* סרטון -> לכל מקטע התמונה החדה ביותר מהקטע שלו בסרטון. הסרטון נטען רק לזיכרון הדף ולא נשמר */
async function frames(file,n,onP){
 const u=URL.createObjectURL(file),v=document.createElement('video');v.muted=true;v.playsInline=true;v.preload='auto';v.src=u;
 const wait=(ev,ms)=>new Promise((res,rej)=>{const t=setTimeout(()=>rej(new Error('timeout')),ms);v.addEventListener(ev,()=>{clearTimeout(t);res()},{once:true});v.addEventListener('error',()=>{clearTimeout(t);rej(new Error('err'))},{once:true})});
 try{
  await wait('loadedmetadata',15000);if(!isFinite(v.duration)){const p0=wait('durationchange',8000);v.currentTime=1e9;await p0}const D=v.duration;if(!isFinite(D)||D<n*.5)throw new Error('short');
  const out=[];
  for(let i=0;i<n;i++){let best=null;
   for(let j=0;j<4;j++){const t=D*(i+.15+.7*j/3)/n,p=wait('seeked',6000);v.currentTime=t;await p;
    const w=v.videoWidth,h=v.videoHeight;if(!w||!h)throw new Error('size');const k=Math.min(1,FULL/Math.max(w,h)),cv=document.createElement('canvas');cv.width=Math.round(w*k);cv.height=Math.round(h*k);cv.getContext('2d').drawImage(v,0,0,cv.width,cv.height);
    const q=quality(cv,cv.width,cv.height);if(!best||q.sharp>best.q.sharp)best={cv,q}}
   out.push(Object.assign(await shrink(best.cv,best.cv.width,best.cv.height),best.q));if(onP)onP(i+1,n)}
  return out;
 }finally{try{v.removeAttribute('src');v.load()}catch(e){}URL.revokeObjectURL(u)}}

/* ---------- מקטעים ומסלול ---------- */
const LV={a:0,t:1,b:2};
function build(run,map){
 const G=window.S3G;let md=null;try{md=G&&G.buildModel(map)}catch(e){}
 const fm=new Map(),bm=new Map();if(md){for(const f of md.fx)fm.set(f.id,f);for(const b of md.bays)bm.set(b.id,b)}
 const out=[];
 for(const id of (Array.isArray(run.bays)?run.bays:[])){const m=/^(f[0-9]{1,4})-([ab])-([0-9]{1,2})$/.exec(id);if(!m)continue;const b=bm.get(id),f=fm.get(m[1]);
  for(const l of (b?b.lv:['a']))out.push({slot:id+'_'+l,fx:m[1],s:m[2],n:+m[3],l,num:f&&f.num||0,name:f&&f.name||'',glass:!!(f&&(f.glass||f.k==='fridge')),hi:!!(f&&f.hi)})}
 out.sort((a,b)=>(a.num||1e6)-(b.num||1e6)||(+a.fx.slice(1))-(+b.fx.slice(1))||a.s.localeCompare(b.s)||a.n-b.n||LV[a.l]-LV[b.l]);
 C.slots=out;const g=[];for(const s of out){let x=g[g.length-1];if(!x||x.fx!==s.fx){x={fx:s.fx,num:s.num,name:s.name,glass:s.glass,L:[]};g.push(x)}x.L.push(s)}C.groups=g}
const slotOf=id=>C.slots.find(s=>s.slot===id);
/* מצב מקטע: q = נשמר בטלפון וממתין לשליחה, f = השליחה נכשלה, ok = נשלח, person = בתמונה היה אדם, miss = חסר */
function stOf(id){const l=C.loc[id],p=C.ph[id];if(l==='q')return 'q';if(l==='f')return 'f';if(p&&p.person)return 'person';if(l==='s'||p)return 'ok';return 'miss'}
const doneOf=id=>{const s=stOf(id);return s==='q'||s==='ok'};
const counts=()=>{let d=0;for(const s of C.slots)if(doneOf(s.slot))d++;return{d,n:C.slots.length,m:C.slots.length-d}};
function nextMiss(after){const i=after?C.slots.findIndex(s=>s.slot===after):-1;for(let k=1;k<=C.slots.length;k++){const s=C.slots[(i+k+C.slots.length)%C.slots.length];if(s&&!doneOf(s.slot))return s.slot}return ''}
const lbl=s=>`גוף ${s.num||s.fx}${s.name?' ('+s.name+')':''} · ${s.s==='a'?'צד ראשי':'צד שני'} · מקטע ${s.n}${s.l==='t'?' · תמונה עליונה':s.l==='b'?' · תמונה תחתונה':''}`;
const guide=s=>{let g='צלמו את כל המקטע מקרוב וישר, כך שכל המדפים נכנסים בתמונה. בלי אנשים בתמונה.';
 if(s.l==='t')g='תמונה עליונה: צלמו את החלק העליון של המקטע (המדפים שמעל גובה העיניים).';else if(s.l==='b')g='תמונה תחתונה: צלמו את החלק התחתון של המקטע (ליד הרצפה).';
 if(s.glass)g+=' מקרר: עמדו ישר מול הדלת, בלי הבזק, ואם יש השתקפות זוזו מעט הצידה.';return g};

/* ---------- זמני עבודה (הפסקה והמשך) ---------- */
const mergeTl=(a,b)=>{const m=new Map();for(const e of [].concat(a||[],b||[]))if(e&&/^[spre]$/.test(e.k)&&Number.isFinite(+e.t))m.set(e.k+'|'+e.t,{k:e.k,t:+e.t});return [...m.values()].sort((x,y)=>x.t-y.t)};
const tState=()=>{const l=C.tl[C.tl.length-1];return !l?'idle':l.k==='p'?'pause':l.k==='e'?'end':'work'};
function workMin(){let st='i',from=0,w=0;for(const e of C.tl){if(e.k==='s'||e.k==='r'){if(st!=='w'){st='w';from=e.t}}else if(e.k==='p'){if(st==='w'){w+=e.t-from;st='p'}}else if(e.k==='e'){if(st==='w')w+=e.t-from;st='i'}}if(st==='w')w+=Date.now()-from;return Math.max(0,Math.round(w/60000))}
async function addEv(k){const t=Date.now();C.tl=mergeTl(C.tl,[{k,t}]);lsS('s3t:'+C.rid,C.tl);await qAdd({own:me(),k:'ev',qid:qid(),run:C.rid,ev:k,at:t,tries:0});await recount()}

/* ---------- תור שליחה ---------- */
const b64=b=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result).split(',')[1]||'');r.onerror=()=>rej(r.error);r.readAsDataURL(b)});
/* שלב 11: עזרים לאשף ולכרטיס המדף (הקטנה, בדיקת חדות/חשיכה, base64, מזהה בקשה) */
U.prep=prep;U.badOf=badOf;U.b64=b64;U.qid=qid;U.blobOf=blobOf;U.decode=decode;
const PERM=/^(bad-|not-|no-|too-|full$|run-closed|feature-off|stale)/;
function mark(run,slot,v){if(run!==C.rid||!slot)return;if(v)C.loc[slot]=v;else delete C.loc[slot];lsS('s3d:'+run,C.loc)}
async function flush(){
 if(C.fl||!U.feat()||!loggedIn())return;C.fl=1;
 try{
  const L=(await qAll()).filter(r=>r.own===me()&&!r.fail).sort((a,b)=>a.id-b.id);
  for(const r of L){
   try{
    if(r.k==='ev')await U.fn('s3Log',{qid:r.qid,run:r.run,ev:r.ev,at:r.at});
    else{const x=await U.fn('shelfCheck',{qid:r.qid,mode:'run',run:r.run,slot:r.slot,at:r.at,src:r.src,rt:r.rt,img:await b64(r.img),th:await b64(r.th)});
     if(r.run===C.rid){if(x&&(x.person||x.st==='person'))C.ph[r.slot]={person:true};else if(C.ph[r.slot])delete C.ph[r.slot]}}
    await qDel(r.id);if(r.k==='ph')mark(r.run,r.slot,'s');
   }catch(e){
    if(e&&e.offline)break;
    if(PERM.test(e&&e.reason||'')||(r.tries|0)>=20){r.fail=U.errText(e,'השליחה נכשלה');await qPut(r);if(r.k==='ph')mark(r.run,r.slot,'f')}
    else{r.tries=(r.tries|0)+1;await qPut(r);break}
   }
  }
 }catch(e){}
 C.fl=0;await recount();if(cur().v==='st3c'&&!C.busy&&!typing())rerender()}
window.addEventListener('online',()=>{if(U.feat()&&loggedIn())flush()});
window.addEventListener('offline',()=>{if(cur().v==='st3c'&&!typing())rerender()});
setInterval(()=>{if(U.feat()&&loggedIn()&&navigator.onLine!==false)recount().then(()=>{if(C.qn)flush()})},30000);
ACT.s3cFlush=()=>{flush();toast('שולחים…')};
ACT.s3cRetry=async()=>{try{for(const r of (await qAll()).filter(r=>r.own===me()&&r.fail)){delete r.fail;r.tries=0;await qPut(r);if(r.k==='ph')mark(r.run,r.slot,'q')}}catch(e){}await recount();rerender();flush()};
ACT.s3cDrop=()=>ask('להסיר את הפריטים שלא נשלחו? התמונות שלהם יימחקו מהטלפון והמקטעים יסומנו כחסרים.',async()=>{try{for(const r of (await qAll()).filter(r=>r.own===me()&&r.fail)){await qDel(r.id);if(r.k==='ph')mark(r.run,r.slot,'')}}catch(e){}await recount();rerender()},'כן, הסר');

/* ---------- פתיחת סבב ---------- */
async function loadPh(){const o={};let pt='';try{for(let i=0;i<20;i++){const j=await fsx('/srun/'+C.rid+'/ph?pageSize=300&mask.fieldPaths=person&mask.fieldPaths=ask'+(pt?'&pageToken='+encodeURIComponent(pt):''));
 for(const d of ((j&&j.documents)||[])){const f=U.dec(d)||{};o[d.name.split('/').pop()]={person:f.person===true}}pt=(j&&j.nextPageToken)||'';if(!pt)break}C.ph=o}catch(e){}}
async function openRun(id){
 if(!U.feat()||!loggedIn()||!/^[A-Za-z0-9_-]{6,80}$/.test(id||''))return;
 Object.assign(C,{own:me(),rid:id,run:null,map:null,slots:[],groups:[],err:'',busy:1,msg:'',pend:null,cur:'',open:'',ph:{},cache:0});
 if(cur().v!=='st3c')go('st3c');else rerender();
 let run=null,map=null;
 try{const r=await U.fn('s3View',{runId:id});run=r&&r.run;if(!run||!Array.isArray(run.bays))throw new Error('x');map=await U.get('/smap/'+run.map);if(!map||map.del===1){const x=new Error('x');x.reason='no-map';throw x}
  mSet('run:'+id,{run,map,at:Date.now()}).catch(()=>{})}
 catch(e){const c=e&&e.offline?await mGet('run:'+id).catch(()=>null):null;
  if(c&&c.run&&c.map){run=c.run;map=c.map;C.cache=1}
  else{C.err=e&&e.offline?'אין חיבור לאינטרנט, ואין עדיין נתוני סבב שמורים בטלפון. פתחו את הסבב פעם אחת כשיש חיבור.':U.errText(e,'לא הצלחנו לפתוח את הסבב.');C.busy=0;if(C.rid===id)rerender();return}}
 if(C.rid!==id)return;
 C.run=run;C.map=map;C.loc=lsG('s3d:'+id)||{};C.rt=lsG('s3r:'+id)||{};C.tl=mergeTl(run.tlog,lsG('s3t:'+id));build(run,map);
 if(!C.cache)await loadPh();
 C.cur=nextMiss('');const s=slotOf(C.cur);C.open=s?s.fx:'';C.busy=0;await recount();rerender();flush()}
ACT.s3cOpen=el=>openRun(el.dataset.id);
async function cacheRun(id){try{const c=await mGet('run:'+id);if(c&&Date.now()-c.at<6*36e5)return;const r=await U.fn('s3View',{runId:id}),run=r&&r.run;if(!run)return;const map=await U.get('/smap/'+run.map);if(map&&map.del!==1)await mSet('run:'+id,{run,map,at:Date.now()})}catch(e){}}
/* אחרי שרשימת המשימות נטענה (רק כשיש חיבור): עותק בטלפון של הסבב והמפה, כדי שאפשר יהיה לעבוד בלי רשת */
U.onRuns=L=>{if(navigator.onLine===false)return;(L||[]).slice(0,3).forEach(r=>{if(r&&r.runId)cacheRun(r.runId)});flush()};

/* ---------- צילום ---------- */
const bumpRt=s=>{C.rt[s]=Math.min(50,(C.rt[s]|0)+1);lsS('s3r:'+C.rid,C.rt)};
const dropPend=()=>{if(C.pend&&C.pend.url)URL.revokeObjectURL(C.pend.url);C.pend=null};
async function enqueue(sl,p,src){
 if(!C.tl.some(e=>e.k==='s'))await addEv('s');
 if(stOf(sl.slot)!=='miss')bumpRt(sl.slot);
 await qAdd({own:me(),k:'ph',qid:qid(),run:C.rid,slot:sl.slot,at:Date.now(),src,rt:C.rt[sl.slot]|0,img:p.full,th:p.th,w:p.w,h:p.h,tries:0});
 mark(C.rid,sl.slot,'q')}
async function commit(sl,p,src){
 try{await enqueue(sl,p,src)}catch(e){C.busy=0;C.msg='לא הצלחנו לשמור את התמונה בטלפון (אין מקום פנוי?). נסו לשחרר מקום ולצלם שוב.';return rerender()}
 dropPend();C.msg='';C.busy=0;const nx=nextMiss(sl.slot);C.cur=nx;const s2=slotOf(nx);if(s2)C.open=s2.fx;toast('נשמר בטלפון');await recount();rerender();flush()}
CHG.s3cPick=async el=>{
 const f=el.files&&el.files[0];el.value='';if(!f||!C.run||C.busy)return;const sl=slotOf(C.cur);if(!sl)return;
 if(f.type&&!/^image\//.test(f.type)){C.msg='הקובץ שנבחר אינו תמונה.';return rerender()}
 if(C.pend){bumpRt(C.pend.slot);dropPend()}
 C.busy=1;C.msg='מכינים את התמונה…';rerender();
 try{const p=await prep(f),bad=badOf(p);if(bad){C.busy=0;C.msg='';C.pend={slot:sl.slot,p,bad,url:URL.createObjectURL(p.th)};return rerender()}await commit(sl,p,'photo')}
 catch(e){C.busy=0;C.msg='לא הצלחנו לעבד את התמונה. נסו לצלם שוב.';rerender()}};
ACT.s3cKeep=()=>{const q=C.pend;if(!q||C.busy)return;const sl=slotOf(q.slot);if(!sl)return;C.busy=1;rerender();commit(sl,q.p,'photo')};
const sideOf=sl=>C.slots.filter(s=>s.fx===sl.fx&&s.s===sl.s&&s.l==='a');
CHG.s3cVid=async el=>{
 const f=el.files&&el.files[0];el.value='';if(!f||!C.run||C.busy)return;const sl=slotOf(C.cur);if(!sl)return;const L=sideOf(sl);if(L.length<2||sl.l!=='a')return;
 dropPend();C.busy=1;C.msg='';C.vp=`שולפים תמונות חדות מהסרטון… 0/${L.length}`;rerender();
 try{const fr=await frames(f,L.length,(i,n)=>{C.vp=`שולפים תמונות חדות מהסרטון… ${i}/${n}`;const e=document.getElementById('s3cvp');if(e)e.textContent=C.vp});
  let ok=0,bad=0;for(let i=0;i<L.length;i++){if(badOf(fr[i])){bad++;continue}await enqueue(L[i],fr[i],'video');ok++}
  C.vp='';C.busy=0;C.msg=`נשמרו ${ok} תמונות מהסרטון (הסרטון עצמו לא נשמר).${bad?` ${bad} מקטעים לא יצאו חדים מספיק – צלמו אותם שוב כתמונה.`:''}`;
  const nx=nextMiss(L[L.length-1].slot);C.cur=nx;const s2=slotOf(nx);if(s2)C.open=s2.fx;await recount();rerender();flush()}
 catch(e){C.vp='';C.busy=0;C.msg=e&&e.message==='short'?'הסרטון קצר מדי לכל המקטעים. צלמו לאט, מקטע אחרי מקטע, או צלמו תמונות.':'לא הצלחנו לקרוא את הסרטון. נסו שוב, או צלמו תמונות.';rerender()}};
ACT.s3cSel=el=>{if(C.busy)return;dropPend();C.cur=el.dataset.s;C.msg='';rerender()};
ACT.s3cGrp=el=>{C.open=C.open===el.dataset.f?'':el.dataset.f;rerender()};
ACT.s3cSkip=()=>{if(C.busy)return;dropPend();C.msg='';const n=nextMiss(C.cur);if(n){C.cur=n;const s=slotOf(n);if(s)C.open=s.fx}rerender()};
ACT.s3cEv=el=>{const k=el.dataset.k;if(!/^[sper]$/.test(k))return;
 const go2=async()=>{await addEv(k);rerender();flush()};
 if(k==='e'){const m=counts().m;return ask(m?`יש ${m} מקטעים שלא צולמו. לסיים בכל זאת?`:'לסיים את הסבב?',go2,'כן, סיימתי')}
 go2()};
ACT.s3cMap=()=>go('st3');

/* ---------- המסך ---------- */
const CSS=document.createElement('style');
CSS.textContent=`.s3cc{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}.s3cc button{min-width:44px;min-height:44px;border-radius:var(--r-m,10px);border:2px solid var(--line);background:var(--card);color:var(--ink);font:inherit;font-weight:700;padding:0 8px;cursor:pointer}
.s3cc button.ok{border-color:var(--inc);color:var(--inc)}.s3cc button.q{border-color:var(--acc);color:var(--acc)}.s3cc button.miss{border-color:var(--bad);border-style:dashed;color:var(--bad)}.s3cc button.warn{border-color:var(--warn);color:var(--warn)}.s3cc button.cur{background:var(--acc);border-color:var(--acc);border-style:solid;color:var(--onacc)}
.s3g{background:var(--bg);border:1px solid var(--line);border-radius:var(--r-m,10px);padding:6px 10px;margin:8px 0}.s3g .hd{display:flex;width:100%;justify-content:space-between;align-items:center;min-height:44px;background:none;border:0;color:var(--ink);font:inherit;font-weight:700;cursor:pointer;text-align:right}
.s3bar{height:8px;background:var(--line);border-radius:6px;overflow:hidden;margin:6px 0}.s3bar i{display:block;height:100%;background:var(--acc)}
.s3s label.btn{flex:1;min-width:130px}.s3pv{max-width:100%;max-height:150px;border-radius:var(--r-m,8px);display:block;margin:6px 0}`;
document.head.appendChild(CSS);
function chips(g){return `<div class="s3cc">${g.L.map(s=>`<button type="button" class="${stOf(s.slot)==='ok'?'ok':stOf(s.slot)==='q'?'q':stOf(s.slot)==='miss'?'miss':'warn'} ${s.slot===C.cur?'cur':''}" data-a="s3cSel" data-s="${s.slot}" aria-label="${esc2(lbl(s))}">${s.n}${s.l==='t'?' ע':s.l==='b'?' ת':''}${g.L.some(x=>x.s==='b')?(s.s==='b'?' ב':' א'):''}</button>`).join('')}</div>`}
function curCard(){
 const sl=slotOf(C.cur),c=counts();
 if(!sl)return `<div class="s3info">${c.m?'כל המקטעים שנשארו כבר נבחרו.':'כל המקטעים צולמו. אפשר ללחוץ "סיימתי".'}</div>`;
 let h=`<div class="s3info"><b>${esc2(lbl(sl))}</b><br>${esc2(guide(sl))}`;
 const st=stOf(sl.slot);if(st==='person')h+=`<div class="ban s3warn">בתמונה הקודמת היה אדם והיא לא נשמרה. צלמו שוב בלי אנשים.</div>`;
 h+=`</div>`;
 if(C.pend)h+=`<div class="ban s3warn" role="alert"><b>${C.pend.bad==='blur'?'התמונה לא חדה מספיק. צלמו שוב, והחזיקו את הטלפון יציב.':'התמונה חשוכה מדי. הדליקו אור או התקרבו, וצלמו שוב.'}</b><img class="s3pv" src="${C.pend.url}" alt="התמונה שצולמה"></div>
  <div class="row s3row"><label class="btn">צלמו שוב<input type="file" accept="image/*" capture="environment" data-c="s3cPick" hidden></label><button class="btn g" style="flex:1" data-a="s3cKeep">שמרו בכל זאת</button></div>`;
 else{const L=sideOf(sl);
  h+=`<div class="row s3row"><label class="btn">צלמו תמונה<input type="file" accept="image/*" capture="environment" data-c="s3cPick" hidden></label>${sl.l==='a'&&L.length>1?`<label class="btn g">סרטון לכל הצד (${L.length} מקטעים)<input type="file" accept="video/*" capture="environment" data-c="s3cVid" hidden></label>`:''}<button class="btn g" data-a="s3cSkip">דלגו למקטע הבא</button></div>`;
  if(sl.l==='a'&&L.length>1)h+=`<p class="note s3note">בסרטון: התחילו ממקטע ${L[0].n} והמשיכו לפי המספור, לאט ובלי לעצור. המכשיר ישלוף תמונה חדה לכל מקטע, והסרטון לא נשמר.</p>`}
 return h}
V.st3c=()=>{const T='צילום מדפים';
 if(!loggedIn()||!U.feat())return{t:T,h:'<div class="empty">תלת מימד לא מופעל בעסק הזה</div>'};
 if(C.own!==me()||!C.rid)return{t:T,h:`<div class="card s3s"><p style="margin:0">לא נבחר סבב.</p><button class="btn" style="margin-top:10px" data-a="s3cMap">למפת החנות</button></div>`};
 if(C.err)return{t:T,h:`<div class="card s3s"><p style="margin:0">${esc2(C.err)}</p><button class="btn" style="margin-top:10px" data-a="s3cOpen" data-id="${esc2(C.rid)}">נסו שוב</button></div>`};
 if(!C.run)return{t:T,h:'<div class="empty">טוען את הסבב…</div>'};
 const c=counts(),ts=tState(),R=C.run,off=navigator.onLine===false;
 let h=`<div class="card s3s">`;
 if(off)h+=`<div class="ban s3off" role="status">אין חיבור – התמונות נשמרות בטלפון ויישלחו כשיש רשת</div>`;
 if(C.cache)h+=`<div class="ban s3off" role="status">מוצגים נתונים שנשמרו בטלפון</div>`;
 if(C.qn)h+=`<div class="ban s3off" role="status">${C.qn===1?'פריט אחד ממתין':C.qn+' פריטים ממתינים'} לשליחה${off?'':` <button class="btn g s" data-a="s3cFlush">שלחו עכשיו</button>`}</div>`;
 if(C.qf)h+=`<div class="ban s3warn" role="alert">${C.qf===1?'פריט אחד לא נשלח':C.qf+' פריטים לא נשלחו'}${C.qfm?': '+esc2(C.qfm):''}<div class="row s3row"><button class="btn" data-a="s3cRetry">נסו שוב</button><button class="btn g" data-a="s3cDrop">הסירו</button></div></div>`;
 h+=`<b>צולמו ${c.d} מתוך ${c.n} מקטעים</b>${R.dueAt?` · עד ${esc2(dm(+R.dueAt))}`:''}${R.st==='late'?' · באיחור':''}<div class="s3bar"><i style="width:${c.n?Math.round(100*c.d/c.n):0}%"></i></div>`;
 if(c.m&&c.d)h+=`<p class="note s3note" style="margin:0 0 6px">חסרים ${c.m} מקטעים (מסומנים באדום בהמשך).</p>`;
 const TN={s:'התחלה',p:'הפסקה',r:'המשך',e:'סיום'};
 h+=`<div class="s3info"><b>${ts==='idle'?'עוד לא התחלתם':ts==='work'?'בעבודה':ts==='pause'?'בהפסקה':'סיימתם את הסבב'}</b>${C.tl.length?` · זמן עבודה ${workMin()} דקות`:''}${C.tl.length?`<br><small>${C.tl.map(e=>TN[e.k]+' '+hm(e.t)).join(' · ')}</small>`:''}
  <div class="row s3row">${ts==='idle'?`<button class="btn" data-a="s3cEv" data-k="s">התחלתי</button>`:ts==='work'?`<button class="btn g" data-a="s3cEv" data-k="p">הפסקה</button><button class="btn" data-a="s3cEv" data-k="e">סיימתי</button>`:ts==='pause'?`<button class="btn" data-a="s3cEv" data-k="r">המשך</button><button class="btn g" data-a="s3cEv" data-k="e">סיימתי</button>`:`<button class="btn g" data-a="s3cEv" data-k="s">המשך לעבוד</button>`}</div></div>`;
 if(C.busy)h+=`<div class="s3info" role="status" id="s3cvp">${esc2(C.vp||C.msg||'רגע…')}</div>`;
 else{h+=curCard();if(C.msg)h+=`<div class="s3info" role="status">${esc2(C.msg)}</div>`}
 h+=`<p class="note s3note">מסלול מומלץ לפי מספור הגופים, מהכניסה. אפשר ללחוץ על כל מקטע ולצלם אותו.</p>`;
 for(const g of C.groups){const gd=g.L.filter(s=>doneOf(s.slot)).length,o=C.open===g.fx;
  h+=`<div class="s3g"><button class="hd" data-a="s3cGrp" data-f="${g.fx}" aria-expanded="${o}"><span>גוף ${esc2(g.num||g.fx)}${g.name?' ('+esc2(g.name)+')':''}${g.glass?' · מקרר':''}</span><span>${gd}/${g.L.length}</span></button>${o?chips(g):''}</div>`}
 h+=`<div class="row s3row"><button class="btn g" data-a="s3cMap">מפת החנות</button></div></div>`;
 return{t:T,h}};
/* יציאה מהמסך: שחרור זיכרון של תמונה שמחכה להחלטה */
{const r0=window.render;if(typeof r0==='function')window.render=function(){const r=r0.apply(this,arguments);try{if(cur().v!=='st3c'&&C.pend)dropPend()}catch(e){}return r}}

/* ---------- לקיחת חלק מסבב (כשכל עובד יכול לקחת) ---------- */
U.takeHtml=L=>{const T=(Array.isArray(L)?L:[]).filter(r=>r&&Array.isArray(r.parts)&&r.parts.length);if(!T.length)return '';
 return `<div class="s3info"><b>אפשר לקחת חלק מסבב פתוח</b>${T.map(r=>r.parts.map(p=>`<div class="row s3row"><span style="flex:1">${+p.n} מקטעים${Number.isFinite(+p.d)?` (צולמו ${+p.d})`:''}${r.dueAt?` · עד ${esc2(dm(+r.dueAt))}`:''}</span><button class="btn g" data-a="s3cTake" data-run="${esc2(r.runId)}" data-h="${esc2(p.h)}">קחו את החלק</button></div>`).join('')).join('')}</div>`};
ACT.s3cTake=el=>{const run=el.dataset.run,h=el.dataset.h;ask('לקחת את החלק הזה? הוא יעבור אליכם.',async()=>{
 try{await U.fn('s3Move',{runId:run,fromH:h,take:true});toast('החלק עבר אליכם');U.X.runsAt=0;U.loadRuns(true)}catch(e){toast(U.errText(e,'לא הצלחנו לקחת את החלק'))}},'כן, קחו')};

/* ---------- מבט מנהל: לשונית "סבבים" ---------- */
const ERRS={'staff-disabled':'עובד בכלל הזה מושבת ואין לו מחליף','sub-disabled':'המחליף של הכלל מושבת','no-map':'אין מפה לכלל הזה','map-deleted':'המפה של הכלל נמחקה'};
const RST={open:'פתוח',late:'באיחור',done:'הסתיים',closed:'נסגר באיחור',cancel:'בוטל'};
const FK={week:'כל שבוע',month:'כל חודש',days:'כל כמה ימים',manual:'ידני'};
async function loadStaff(){if(C.staff)return;try{const j=await fsx('/staff?pageSize=300');C.staff=((j&&j.documents)||[]).map(d=>{const f=U.dec(d)||{};return{uid:d.name.split('/').pop(),name:String(f.name||f.email||''),active:f.active===true}})}catch(e){C.staff=[]}if(cur().v==='st3'&&!typing())rerender()}
const nameOf=u=>{const s=(C.staff||[]).find(x=>x.uid===u);return s&&s.name||'עובד'};
function mgLoad(force){
 if(!U.feat()||!U.isMgr()||C.mgBusy||(!force&&Date.now()-C.mgAt<30000))return;C.mgBusy=1;C.mgAt=Date.now();loadStaff();
 U.fn('s3View',{}).then(r=>{C.mg=Array.isArray(r&&r.runs)?r.runs:[];C.mgErr=''}).catch(e=>{C.mg=null;C.mgErr=U.errText(e,'לא הצלחנו לטעון את הסבבים.')}).finally(()=>{C.mgBusy=0;if(cur().v==='st3'&&!typing())rerender()})}
function runCard(r){
 const ws=(Array.isArray(r.uids)?r.uids:[]).map(u=>{const n=r.nUid&&r.nUid[u]||{n:0,d:0},w=r.work&&r.work[u],p=r.pause&&r.pause[u],tl=(r.tlog&&r.tlog[u])||[],l=tl[tl.length-1];
  return `<div class="row s3row" style="justify-content:space-between"><span>${esc2(nameOf(u))}: ${+n.d||0}/${+n.n||0}${Number.isFinite(+w)?` · עבודה ${+w} ד׳`:''}${+p>0?` · הפסקה ${+p} ד׳`:''}${l?` · ${{s:'התחיל',p:'בהפסקה',r:'חזר',e:'סיים'}[l.k]||''}`:' · עוד לא התחיל'}</span>${C.staff&&C.staff.length>1?`<button class="btn g" style="min-height:44px" data-a="s3cMove" data-run="${esc2(r.runId)}" data-from="${esc2(u)}">העבר</button>`:''}</div>`}).join('');
 return `<div class="s3info"><b>${esc2(RST[r.st]||r.st||'')}</b> · ${+r.nDone||0}/${+r.n||0} מקטעים${r.dueAt?` · עד ${esc2(dm(+r.dueAt))}`:''}${ws}<div class="row s3row"><button class="btn g" data-a="s3cCancel" data-run="${esc2(r.runId)}">בטלו את הסבב</button></div></div>`}
function mgHtml(d){
 mgLoad();let h=`<b>סבבים פתוחים</b>`;
 if(C.mgErr)h+=`<div class="s3info">${esc2(C.mgErr)} <button class="btn g" style="min-height:44px" data-a="s3cMgr">נסו שוב</button></div>`;
 else if(C.mg===null)h+=`<div class="s3info">טוען…</div>`;
 else{const L=C.mg.filter(r=>!d||!r.br||r.br===d.br);h+=L.length?L.map(runCard).join(''):`<div class="s3info">אין סבבים פתוחים כרגע.</div>`}
 const R=(d&&d.rounds)||[];h+=`<p style="margin:14px 0 0"><b>פתיחת סבב עכשיו</b></p>`;
 h+=R.length?R.map(r=>`<div class="s3info"><b>${esc2(r.name||'סבב')}</b> · ${esc2(FK[r.f&&r.f.k]||'')}${r.next?` · הבא ${esc2(dm(+r.next))}`:''}${r.err?`<div class="ban s3warn">${esc2(ERRS[r.err]||'יש בעיה בכלל הזה')}</div>`:''}<div class="row s3row"><button class="btn g" data-a="s3cNow" data-rid="${esc2(r.rid||'')}">פתחו סבב עכשיו</button></div></div>`).join(''):`<div class="s3info">עוד אין כללי סבב לסניף הזה.</div>`;
 return h}
{const t0=U.tabHtml;U.tabHtml=(tab,d)=>tab==='rounds'?mgHtml(d):(typeof t0==='function'?t0(tab,d):'')}
ACT.s3cMgr=()=>{C.mgAt=0;mgLoad(true);rerender()};
const done=(msg)=>{toast(msg);C.mgAt=0;mgLoad(true)};
ACT.s3cNow=el=>{const rid=el.dataset.rid;if(!rid)return;ask('לפתוח עכשיו סבב לפי הכלל הזה? העובדים יקבלו התראה.',async()=>{try{await U.fn('s3Run',{rid});done('הסבב נפתח')}catch(e){toast(U.errText(e,'לא הצלחנו לפתוח את הסבב'))}},'כן, פתחו')};
ACT.s3cCancel=el=>{const run=el.dataset.run;ask('לבטל את הסבב? מה שצולם עד עכשיו יישאר, אבל הסבב ייסגר.',async()=>{try{await U.fn('s3Run',{runId:run,cancel:true});done('הסבב בוטל')}catch(e){toast(U.errText(e,'לא הצלחנו לבטל את הסבב'))}},'כן, בטלו')};
ACT.s3cMove=el=>{const run=el.dataset.run,from=el.dataset.from,L=(C.staff||[]).filter(s=>s.active&&s.uid!==from);if(!L.length)return toast('אין עובד פעיל אחר להעברה');
 dlg(`<h3>להעביר את החלק של ${esc2(nameOf(from))}?</h3><label class="f"><span>למי להעביר</span><select id="s3cto" style="min-height:44px">${L.map(s=>`<option value="${esc2(s.uid)}">${esc2(s.name||'עובד')}</option>`).join('')}</select></label><div class="row"><button class="btn grow" data-a="s3cMoveGo" data-run="${esc2(run)}" data-from="${esc2(from)}">העבר</button><button class="btn g grow" data-a="closeDlg">ביטול</button></div>`)};
ACT.s3cMoveGo=async el=>{const to=(document.getElementById('s3cto')||{}).value;if(!to)return;closeDlg();
 try{await U.fn('s3Move',{runId:el.dataset.run,from:el.dataset.from,to});done('החלק הועבר')}catch(e){toast(U.errText(e,'לא הצלחנו להעביר'))}};
})();
