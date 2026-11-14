/* סריקת חנות בתלת מימד – שלב 11 (משימה 2026-11-14_סריקת-חנות-תלת-מימד): כרטיס מדף + דיווח יזום מהמפה.
   נטען אחרי store3d-wizard.js. נפתח מהכפתור "כרטיס המדף" במסך הראשי (אחרי הקשה על מקטע במפה), בחלון (dlg) של האפליקציה.
   מציג: התמונה האחרונה (s3sum.b[bay].th), מצב ומספר בעיות, בעיות מפורטות (מנהל בלבד – srun/<סבב>/ai, שהחוקים מגבילים למנהל), היסטוריה (מנהל: הסבבים האחרונים של המקום,
   מצב ותמונה מוקטנת), וכפתור "צלם" – דיווח יזום (shelfCheck mode:'adhoc', כל הצוות; מכסה יומית לעובד נאכפת בשרת). אין קריאה לשרת כשהתוסף כבוי. */
(function(){
'use strict';
const U=window.S3UI;
if(!U||typeof ACT==='undefined'||typeof CHG==='undefined'||typeof dlg==='undefined')return;
const X=U.X,esc2=U.esc2;
const ISS={noprice:'אין מחיר',pricepos:'מחיר לא ליד המוצר',promoexp:'מבצע שפג תוקפו',hole:'חור במדף',low:'מוצר שנגמר',damaged:'מוצר פגום',fallen:'מוצר שנפל',upside:'מוצר הפוך',face:'החזית לא גלויה',order:'סדר לא תקין',misplaced:'מוצר לא במקום',missing:'מוצר חסר'};
const ST={ok:['תקין','t3'],iss:['יש בעיות','t1'],miss:['לא צולם','t4'],rev:['לבדיקה','t2'],out:['לא בסבב','']};
const AI={ok:'תקין',issue:'יש בעיות',review:'לבדיקה',bad:'התמונה לא קריאה',person:'היה אדם בתמונה',skip:'לא נבדק'};
const SEV=['','קלה','בינונית','חמורה'];
const K={tok:0,bay:null,mid:'',url:{},ai:undefined,hist:undefined,busy:'',msg:'',res:null,pend:null,qid:''};
U.K=K;
const dt=ms=>{try{return new Date(ms).toLocaleString('he-IL',{day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'})}catch(e){return ''}};
const bayLbl=b=>`גוף ${esc2(b.num||b.fx||'')}${b.name?' ('+esc2(b.name)+')':''} · ${b.s==='b'?'צד שני':'צד ראשי'} · מקטע ${esc2(b.n)}`;
const sumOf=()=>{const d=U.data(),s=d&&d.sum&&d.sum.b&&d.sum.b[K.bay.id];return s&&typeof s==='object'?s:null};
const loggedIn=()=>!!(SY&&SY.refresh&&SY.uid);
const dropUrls=()=>{for(const k of Object.keys(K.url)){try{if(K.url[k])URL.revokeObjectURL(K.url[k])}catch(e){}}K.url={}};
function img(path,then){/* תמונה מוקטנת מ-Storage (דרך abkSt), בלי כפילות ובלי שגיאה קשה */
 if(typeof path!=='string'||!path||K.url[path]!==undefined)return;K.url[path]='';const t=K.tok;
 if(typeof window.abkSt!=='function')return;
 window.abkSt('/'+encodeURIComponent(path)+'?alt=media').then(r=>r.blob()).then(b=>{if(t!==K.tok)return;K.url[path]=URL.createObjectURL(b);paint()}).catch(()=>{if(t===K.tok)K.url[path]=null})}
const mapIdNow=()=>{const d=U.data();return U.mapIdOf(X.kind==='w'&&d&&d.maps.w?'w':'s',d&&d.br)};
async function loadAi(t){
 const s=sumOf();K.ai=null;
 if(!U.isMgr()||!s||!s.r){return}
 try{const o=U.dec(await fsx('/srun/'+s.r+'/ai/'+K.bay.id));K.ai=o||null}catch(e){K.ai=null}
 if(t===K.tok)paint()}
async function loadHist(t){
 const s=sumOf(),slot=K.bay.id;
 if(!U.isMgr()){K.hist=null;return}
 try{
  const j=await fsx('/srun?pageSize=12&orderBy=openAt%20desc&mask.fieldPaths=map&mask.fieldPaths=openAt&mask.fieldPaths=st');
  const L=((j&&j.documents)||[]).map(d=>{const o=U.dec(d)||{};o.rid=String(d.name||'').split('/').pop();return o}).filter(r=>r.map===K.mid&&r.rid!==(s&&s.r)).slice(0,4);
  const out=[];
  for(const r of L){let ai=null,ph=null;
   try{ai=U.dec(await fsx('/srun/'+r.rid+'/ai/'+slot))}catch(e){}
   try{ph=U.dec(await fsx('/srun/'+r.rid+'/ph/'+slot))}catch(e){}
   if(t!==K.tok)return;out.push({rid:r.rid,at:+(ai&&ai.at)||+(ph&&ph.at)||+r.openAt||0,st:ai&&ai.st||'',n:ai&&Array.isArray(ai.iss)?ai.iss.length:null,th:ph&&!ph.person&&!ph.gone&&typeof ph.th==='string'?ph.th:''})}
  K.hist=out}
 catch(e){K.hist=e&&e.offline?'offline':'err'}
 if(t===K.tok){paint();for(const h of (Array.isArray(K.hist)?K.hist:[]))if(h.th)img(h.th)}}
function body(){
 const b=K.bay,s=sumOf(),stt=s&&ST[s.s]?ST[s.s]:['לא צולם','t4'];
 let h=`<h3 style="margin:0 0 6px">${bayLbl(b)}</h3><div class="row" style="margin-bottom:8px"><span class="tag ${stt[1]}">${stt[0]}</span>${s&&s.t?`<small class="note">צולם ${esc2(dt(s.t))}</small>`:''}</div>`;
 const u=s&&s.th?K.url[s.th]:'';
 h+=u?`<img src="${u}" alt="תמונת המדף" style="width:100%;max-height:42vh;object-fit:contain;border-radius:var(--r-m,12px);border:1px solid var(--line);background:var(--bg)">`:
  `<div class="s3info" style="text-align:center">${s&&s.th&&K.url[s.th]===''?'טוענים את התמונה…':s&&s.th&&K.url[s.th]===null?'לא הצלחנו לטעון את התמונה.':'עוד אין תמונה למקום הזה.'}</div>`;
 /* בעיות */
 h+=`<h4 style="margin:12px 0 4px">בעיות</h4>`;
 const ai=K.ai;
 if(ai&&Array.isArray(ai.iss)){h+=ai.iss.length?ai.iss.map(i=>`<div class="s3info"><b>${esc2(ISS[i.k]||'בעיה')}</b>${i.sev?` <span class="tag ${i.sev>=3?'t4':i.sev===2?'t1':'t2'}">${SEV[i.sev]||''}</span>`:''}${i.warn?' <span class="tag t2">אזהרה</span>':''}${i.t?`<br><small>${esc2(i.t)}</small>`:''}</div>`).join(''):`<div class="s3info">${esc2(AI[ai.st]||'לא נמצאו בעיות')}. לא נמצאו בעיות.</div>`}
 else if(s)h+=`<div class="s3info">${s.n>0?`נמצאו ${+s.n} בעיות.`:s.s==='ok'?'לא נמצאו בעיות.':'אין מידע על בעיות.'}${U.isMgr()?'':' פירוט הבעיות מוצג למנהל.'}</div>`;
 else h+=`<div class="s3info">אין מידע על בעיות.</div>`;
 /* היסטוריה */
 h+=`<h4 style="margin:12px 0 4px">היסטוריה</h4>`;
 if(!U.isMgr())h+=`<div class="s3info">ההיסטוריה זמינה למנהל.</div>`;
 else if(K.hist===undefined)h+=`<div class="s3info">טוענים…</div>`;
 else if(K.hist==='offline')h+=`<div class="s3info">אין חיבור לאינטרנט.</div>`;
 else if(K.hist==='err'||K.hist===null)h+=`<div class="s3info">לא הצלחנו לטעון את ההיסטוריה.</div>`;
 else h+=K.hist.length?K.hist.map(r=>`<div class="s3info"><div class="row" style="justify-content:space-between"><b>${r.at?esc2(dt(r.at)):'סבב קודם'}</b><span class="note">${esc2(AI[r.st]||'לא ידוע')}${r.n?` · ${r.n} בעיות`:''}</span></div>${r.th&&K.url[r.th]?`<img src="${K.url[r.th]}" alt="תמונה מהסבב" style="width:96px;height:72px;object-fit:cover;border-radius:var(--r-m,10px);border:1px solid var(--line);margin-top:6px">`:''}</div>`).join(''):`<div class="s3info">אין סבבים קודמים למקום הזה.</div>`;
 /* דיווח יזום */
 if(K.res){const r=K.res;h+=`<div class="s3info" role="status" aria-live="polite"><b>${r.person?'בתמונה היה אדם, ולכן היא לא נשמרה':r.st==='ok'?'המדף נבדק: לא נמצאו בעיות':r.st==='bad'?'התמונה לא קריאה':'המדף נבדק'}</b>${r.person?'<br><small>צלמו שוב בלי אנשים בתמונה.</small>':''}${Array.isArray(r.iss)&&r.iss.length?r.iss.map(i=>`<br><small>• ${esc2(i.t||ISS[i.k]||'בעיה')}</small>`).join(''):''}${r.t?`<br><small>${esc2(r.t)}</small>`:''}${r.usage&&r.usage.w80&&U.isMgr()?`<br><small>שימו לב: ${+r.usage.n} מתוך ${+r.usage.cap} בדיקות החודש.</small>`:''}</div>`}
 if(K.pend)h+=`<div class="ban s3warn" role="alert"><b>${K.pend.bad==='blur'?'התמונה לא חדה מספיק. החזיקו את הטלפון יציב וצלמו שוב.':'התמונה חשוכה מדי. הדליקו אור או התקרבו.'}</b></div>`;
 if(K.busy)h+=`<div class="s3info" role="status">${esc2(K.busy)}</div>`;
 if(K.msg)h+=`<div class="ban s3warn" role="alert">${esc2(K.msg)}</div>`;
 const off=navigator.onLine===false,dis=K.busy?' aria-disabled="true"':'';
 h+=`<p class="note s3note">${off?'אין חיבור: הדיווח נשלח רק כשיש רשת.':'מצאתם בעיה או סידרתם את המדף? צלמו אותו עכשיו, והוא ייבדק מיד.'}</p>
 <div class="row s3row"><label class="btn grow"${dis}>${K.pend?'צלמו שוב':'צלם'}<input type="file" accept="image/*" capture="environment" data-c="s3kPick" hidden></label>${K.pend?`<button class="btn g" data-a="s3kKeep">שלחו בכל זאת</button>`:''}<button class="btn g" data-a="closeDlg">סגירה</button></div>`;
 return h}
function paint(){const d=document.getElementById('dlg');if(K.bay&&d&&d.open)dlg(body())}
ACT.s3kOpen=()=>{
 const b=X.pick;if(!b||!b.id||!U.feat()||!loggedIn())return;
 dropUrls();K.tok++;K.bay=b;K.mid=mapIdNow();K.ai=undefined;K.hist=undefined;K.busy='';K.msg='';K.res=null;K.pend=null;K.qid='';
 const d=document.getElementById('dlg');if(d&&!d.dataset.s3k){d.dataset.s3k='1';d.addEventListener('close',()=>{K.tok++;K.bay=null;dropUrls();K.pend=null})}
 dlg(body());const t=K.tok,s=sumOf();
 if(s&&s.th)img(s.th);
 loadAi(t);loadHist(t)};
U.cardOpen=ACT.s3kOpen;
/* דיווח יזום: תמונה אחת ל-shelfCheck mode:'adhoc' */
async function send(p){
 const b=K.bay;if(!b)return;
 if(navigator.onLine===false){K.msg='אין חיבור לאינטרנט. צלמו שוב כשיש רשת.';K.pend=null;return paint()}
 K.busy='שולחים ובודקים…';K.msg='';K.res=null;K.pend=null;paint();const t=K.tok;
 try{
  if(!K.qid)K.qid=U.qid();
  const r=await U.fn('shelfCheck',{qid:K.qid,mode:'adhoc',map:K.mid,slot:b.id,at:Date.now(),src:'photo',rt:0,img:await U.b64(p.full),th:await U.b64(p.th)});
  K.qid='';if(t!==K.tok)return;K.busy='';K.res=Object.assign({},r||{},{person:!!(r&&(r.person||r.st==='person'))});
  K.ai=undefined;K.hist=undefined;paint();U.drop();await U.load(true);if(t!==K.tok)return;
  const s=sumOf();if(s&&s.th){try{if(K.url[s.th])URL.revokeObjectURL(K.url[s.th])}catch(e2){}delete K.url[s.th];img(s.th)}
  loadAi(t);loadHist(t)}
 catch(e){if(t!==K.tok)return;K.busy='';if(!(e&&e.offline))K.qid='';K.msg=U.errText(e,'השליחה נכשלה. נסו שוב.');paint()}}
CHG.s3kPick=async el=>{
 const f=el.files&&el.files[0];el.value='';if(!f||!K.bay||K.busy)return;
 if(f.type&&!/^image\//.test(f.type)){K.msg='הקובץ שנבחר אינו תמונה.';return paint()}
 K.busy='מכינים את התמונה…';K.msg='';K.res=null;K.pend=null;paint();
 try{const p=await U.prep(f),bad=U.badOf(p);if(bad){K.busy='';K.pend={p,bad};K.qid='';return paint()}await send(p)}
 catch(e){K.busy='';K.msg='לא הצלחנו לעבד את התמונה. נסו לצלם שוב.';paint()}};
ACT.s3kKeep=()=>{const q=K.pend;if(!q||K.busy)return;send(q.p)};
})();
