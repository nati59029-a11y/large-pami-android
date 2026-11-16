/* DR:1 – דיווח יומי (dailyRep). קובץ עצמאי, נטען אחרי index.html. כבוי = לא מוסיף כלום לשום מסך.
   עובד חייב: V.dr (דיווח היום: טקסט, הקלטה עד 120 שניות, עד 3 תמונות; היסטוריה עם הסיכום שאושר).
   מנהל: V.dr (בורר יום ורשימת חייבים, כרטיס דיווח, הערות ופתיחה כמשימה, אישור, היסטוריה לפי עובד, הגדרות).
   כל כתיבה – רק דרך פונקציות השרת drSubmit / drMgr / drSetCfg / drSetCap. קריאה – Firestore לפי החוקים (drcfg, dr).
   רכיבי D1 בלבד (.card .btn .chip .f .sec .note .empty .li .tag), בלי צבע קבוע. משתמש ב: V, ACT, FRM, INP, CHG, fsx, fvj, idOf,
   esc, dlg, closeDlg, ask, toast, go, cur, rerender, isA, isW, bzF, bzB, SY, ico, rdU, imgOk, uid, sv, iv, tkDue, fbBy. */
(function(){
'use strict';
if(typeof ACT==='undefined'||typeof V==='undefined')return;
const fnCall=(n,d)=>{d=d&&typeof d==='object'?d:{};if(SY&&SY.sa&&SY.bizId&&!('bizId'in d))d=Object.assign({bizId:SY.bizId},d);return window.fnCall(n,d)};
const on=()=>{try{return bzF('dailyRep')&&bzB()&&!SY.mg&&(isA()||isW()||!!SY.sa)}catch(e){return false}};
const mgr=()=>isA()||!!(SY&&SY.sa);
const MAXS=120,MAXI=3,MAXB=500000;
const DN=['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
const ST={new:'נשלח, ממתין',sum:'נשלח, ממתין לאישור',raw:'נשלח (ללא סיכום), ממתין',ok:'אושר'};
const D={cfg:null,cap:null,staff:null,tab:'',day:'',dayL:null,my:null,hl:null,hu:'',open:'',card:null,cf:null,w:{},err:'',dr:{txt:'',imgs:[],aud:null,busy:0}};
const ld={};
const err=e=>toast(e&&e.message||'הפעולה נכשלה');
const dec=d=>Object.assign({id:idOf(d)},fvj({mapValue:d}));
const todayIL=()=>{try{const p={};new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).forEach(x=>{p[x.type]=x.value});return p.year+'-'+p.month+'-'+p.day}catch(e){return new Date().toISOString().slice(0,10)}};
const dow=ymd=>new Date(ymd+'T12:00:00Z').getUTCDay();
const fmtDay=ymd=>/^\d{4}-\d{2}-\d{2}$/.test(ymd||'')?'יום '+DN[dow(ymd)]+', '+(+ymd.slice(8))+'.'+(+ymd.slice(5,7)):String(ymd||'');
const cfgDays=c=>Array.isArray(c&&c.days)?c.days.filter(x=>x>=0&&x<=5):[0,1,2,3,4];
const isRepDay=(ymd,c)=>dow(ymd)!==6&&cfgDays(c).includes(dow(ymd))&&!((c&&c.off)||[]).includes(ymd);
const tm=t=>{if(!t)return '';const d=new Date(t);return d.toLocaleDateString('he-IL',{day:'numeric',month:'numeric'})+' '+d.toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'})};
const mmss=s=>{s=Math.max(0,Math.round(s||0));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0')};
const tag=d=>{const c=d.st==='ok'?'t3':d.st==='raw'?'t4':'t1';return `<span class="tag ${c}">${esc(ST[d.st]||'נשלח')}</span>`};
const stf=u=>{const s=(D.staff||[]).find(x=>x.uid===u);return s?s.name:''};
const load=(k,fn)=>{if(ld[k]||D.err)return;ld[k]=1;fn().catch(e=>{D.err=e&&e.message||'הטעינה נכשלה'}).finally(()=>{ld[k]=0;if(['dr','staff'].includes(cur().v)&&!typing()&&!document.querySelector('#dlg[open]'))rerender()})};
const typing=()=>{const a=document.activeElement;return !!(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)&&a.closest('#main'))};
const reset=()=>{D.cfg=null;D.staff=null;D.dayL=null;D.my=null;D.hl=null;D.card=null;D.w={};D.err='';D.cap=null};
const loading=(T)=>({t:T,h:D.err?`<div class="card"><p class="note" style="margin:0">${esc(D.err)}</p><button class="btn g w" data-a="drRe" style="margin-top:10px">נסה שוב</button></div>`:'<div class="empty">טוען…</div>'});
const deny=T=>({t:T,h:'<div class="empty">התכונה לא פעילה בעסק הזה</div>'});

/* ---------- קריאה ---------- */
async function runQ(field,val,lim){const sq={from:[{collectionId:'dr'}],where:{fieldFilter:{field:{fieldPath:field},op:'EQUAL',value:{stringValue:val}}},limit:lim||100};
 const r=await fsx(':runQuery',{method:'POST',body:JSON.stringify({structuredQuery:sq})});return(r||[]).filter(x=>x.document).map(x=>dec(x.document)).sort((a,b)=>String(b.day).localeCompare(String(a.day)))}
const get404=async p=>{try{return dec(await fsx(p))}catch(e){if(e&&e.code===404)return null;throw e}};
async function cfgLoad(){const c=await get404('/drcfg/main');D.cfg=c||{}}
async function staffLoad(){const j=await fsx('/staff?pageSize=300');D.staff=((j&&j.documents)||[]).map(d=>{const f=fvj({mapValue:d});return{uid:idOf(d),name:String(f.name||'').trim()||String(f.email||'').split('@')[0]||idOf(d),active:f.active===true,role:String(f.role||'')}}).filter(x=>x.active).sort((a,b)=>a.name.localeCompare(b.name,'he'))}
async function capLoad(){const c=await get404('/drcfg/cap');D.cap={capCents:c&&Number.isFinite(c.capCents)?c.capCents:500}}
async function cardLoad(id){const C={id,doc:null,p:[],m:null,w:null,nd:[],sumW:'',dirty:0,busy:0};
 C.doc=await get404('/dr/'+id);if(!C.doc)throw new Error('הדיווח לא נמצא');
 try{const j=await fsx('/dr/'+id+'/p?pageSize=10');C.p=((j&&j.documents)||[]).map(dec).filter(x=>imgOk(x.img))}catch(e){}
 if(mgr()){C.m=await get404('/dr/'+id+'/x/m').catch(()=>null)}
 C.w=await get404('/dr/'+id+'/x/w').catch(()=>null);
 const m=C.m||{};C.nd=(Array.isArray(m.notes)?m.notes:[]).map(n=>({txt:String(n&&n.txt||''),tk:Array.isArray(n&&n.tk)?n.tk:[]}));
 C.sumW=String(m.sumW||m.sum||'');D.card=C}

/* ---------- הקלטה (כמו במזכירה) ---------- */
const RC={on:0,mr:null,stream:null,t0:0,tm:0,x:0};
const micErr=e=>{const n=e&&e.name;if(n==='NotAllowedError'||n==='SecurityError')return'אין הרשאה למיקרופון. אפשר לאשר בהגדרות המכשיר.';if(n==='NotFoundError'||n==='DevicesNotFoundError')return'לא נמצא מיקרופון במכשיר.';if(n==='NotReadableError')return'המיקרופון תפוס על ידי אפליקציה אחרת.';return'לא הצלחנו להפעיל את המיקרופון.'};
async function toWav(blob,maxSec){
 const AC=window.AudioContext||window.webkitAudioContext,ac=new AC();let buf;
 try{buf=await ac.decodeAudioData(await blob.arrayBuffer())}finally{try{ac.close()}catch(e){}}
 const len=Math.max(1,Math.min(Math.ceil(buf.duration*16000),maxSec*16000)),oc=new OfflineAudioContext(1,len,16000),src=oc.createBufferSource();
 src.buffer=buf;src.connect(oc.destination);src.start();
 const f=(await oc.startRendering()).getChannelData(0),n=Math.min(len,f.length),bytes=new Uint8Array(44+n*2),dv=new DataView(bytes.buffer);
 const w=(o,s)=>{for(let i=0;i<s.length;i++)dv.setUint8(o+i,s.charCodeAt(i))};
 w(0,'RIFF');dv.setUint32(4,36+n*2,true);w(8,'WAVE');w(12,'fmt ');dv.setUint32(16,16,true);dv.setUint16(20,1,true);dv.setUint16(22,1,true);dv.setUint32(24,16000,true);dv.setUint32(28,32000,true);dv.setUint16(32,2,true);dv.setUint16(34,16,true);w(36,'data');dv.setUint32(40,n*2,true);
 for(let i=0;i<n;i++){const s=Math.max(-1,Math.min(1,f[i]));dv.setInt16(44+i*2,s<0?s*32768:s*32767,true)}
 let bin='';for(let i=0;i<bytes.length;i+=8192)bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+8192));
 return{sec:n/16000,b64:btoa(bin)}}
const micDown=()=>{try{RC.stream&&RC.stream.getTracks().forEach(t=>t.stop())}catch(e){}RC.stream=null};
const micUi=()=>{const e=document.getElementById('drEl');if(e)e.textContent=mmss((performance.now()-RC.t0)/1000)};
function micStop(){if(RC.on&&RC.mr&&RC.mr.state!=='inactive'){clearInterval(RC.tm);try{RC.mr.stop()}catch(e){micDown();RC.on=0;rerender()}}}
function micCancel(){if(!RC.on)return;RC.x=1;if(RC.mr&&RC.mr.state!=='inactive')micStop();else{clearInterval(RC.tm);micDown();RC.on=0}}
async function micStart(){
 if(RC.on||D.dr.busy)return;
 if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia||typeof MediaRecorder==='undefined'||!(window.AudioContext||window.webkitAudioContext))return toast('ההקלטה לא נתמכת במכשיר הזה. אפשר להקליד.');
 RC.on=1;let stream;
 try{stream=await navigator.mediaDevices.getUserMedia({audio:true})}catch(e){RC.on=0;return toast(micErr(e))}
 const mime=['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg'].find(m=>MediaRecorder.isTypeSupported&&MediaRecorder.isTypeSupported(m))||'';
 let mr;try{mr=new MediaRecorder(stream,mime?{mimeType:mime}:undefined)}catch(e){stream.getTracks().forEach(t=>t.stop());RC.on=0;return toast('ההקלטה לא נתמכת במכשיר הזה. אפשר להקליד.')}
 const chunks=[];Object.assign(RC,{on:1,mr,stream,t0:performance.now(),x:0,tm:0});
 mr.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data)};
 mr.onstop=async()=>{clearInterval(RC.tm);micDown();const cancel=RC.x;RC.on=0;if(cancel){if(cur().v==='dr')rerender();return}
  D.dr.proc=1;if(cur().v==='dr')rerender();
  try{const w=await toWav(new Blob(chunks,{type:mr.mimeType||mime||'audio/webm'}),MAXS);if(w.sec<0.5)toast('ההקלטה קצרה מדי. נסו שוב.');else D.dr.aud={b64:w.b64,sec:Math.min(MAXS,Math.round(w.sec))}}
  catch(e){toast('לא הצלחנו לעבד את ההקלטה. נסו שוב או הקלידו.')}
  D.dr.proc=0;if(cur().v==='dr')rerender()};
 stream.getTracks().forEach(t=>{t.onended=()=>micStop()});
 try{mr.start()}catch(e){micDown();RC.on=0;RC.mr=null;return toast('לא הצלחנו להתחיל את ההקלטה. נסו שוב או הקלידו.')}
 RC.tm=setInterval(()=>{if(cur().v!=='dr'){micCancel();return}if((performance.now()-RC.t0)/1000>=MAXS){toast('ההקלטה נעצרה בגבול של '+MAXS+' שניות');micStop();return}micUi()},250);
 rerender()}

/* ---------- תמונות: הקטנה ל-500KB לפני שליחה ---------- */
function shrink(du){return new Promise((ok,no)=>{const im=new Image();im.onload=()=>{let mx=1280,q=.6,out='';for(let i=0;i<6;i++){const r=Math.min(1,mx/Math.max(im.naturalWidth,im.naturalHeight)),c=document.createElement('canvas');c.width=Math.max(1,Math.round(im.naturalWidth*r));c.height=Math.max(1,Math.round(im.naturalHeight*r));c.getContext('2d').drawImage(im,0,0,c.width,c.height);out=c.toDataURL('image/jpeg',q);if(out.length<MAXB)return ok(out);mx=Math.round(mx*.8);q=Math.max(.35,q-.05)}no(new Error('התמונה גדולה מדי'))};im.onerror=()=>no(new Error('תמונה לא תקינה'));im.src=du})}

/* ---------- עובד ---------- */
const imgsH=()=>D.dr.imgs.length?`<div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0">${D.dr.imgs.map((u,i)=>`<div style="position:relative"><img src="${esc(u)}" alt="תמונה ${i+1}" style="width:84px;height:84px;object-fit:cover;border-radius:var(--r-m);border:1px solid var(--line)"><button type="button" class="chip" data-a="drImgDel" data-n="${i}" aria-label="הסר תמונה" style="position:absolute;top:-6px;left:-6px;min-height:28px;padding:0 8px">${ico('x')}</button></div>`).join('')}</div>`:'';
function formH(doc){const R=D.dr,n=doc&&doc.e?doc.e.length:0;
 if(n>=MAXI)return `<div class="card"><p class="note" style="margin:0">שלחת ${MAXI} מתוך ${MAXI} שליחות להיום. הדיווח ממתין לאישור המנהל.</p></div>`;
 const rec=RC.on?`<div class="row"><button type="button" class="btn r grow" data-a="drRecStop">עצור הקלטה (<span id="drEl">0:00</span>)</button></div>`:R.proc?'<p class="note">מעבד את ההקלטה…</p>':R.aud?`<div class="row" style="align-items:center"><span class="tag t3 grow">הקלטה מוכנה · ${mmss(R.aud.sec)}</span><button type="button" class="btn g s" data-a="drRec">הקלטה מחדש</button><button type="button" class="btn g s" data-a="drAudDel">הסר</button></div>`:`<button type="button" class="btn g w" data-a="drRec">הקלטה (עד ${MAXS/60} דקות)</button>`;
 const ph=R.imgs.length<MAXI?`<div class="row" style="margin-top:8px"><label class="btn g grow" style="cursor:pointer">צילום<input type="file" accept="image/*" capture="environment" data-c="drImg" hidden></label><label class="btn g grow" style="cursor:pointer">מהגלריה<input type="file" accept="image/*" multiple data-c="drImg" hidden></label></div>`:'';
 return `<div class="card"><h3 style="margin-top:0">דיווח היום</h3>${n?`<p class="note">כבר שלחת ${n} מתוך ${MAXI} שליחות. אפשר להוסיף עד לאישור המנהל.</p>`:'<p class="note">מה עשית היום? אפשר לכתוב, להקליט ולצרף עד '+MAXI+' תמונות.</p>'}
 <label class="f"><span>טקסט</span><textarea data-i="drT" rows="5" maxlength="3000" placeholder="מה עשית היום, מה נשאר פתוח…">${esc(R.txt)}</textarea></label>${rec}${ph}${imgsH()}
 <button type="button" class="btn w" data-a="drSend" style="margin-top:10px"${R.busy||RC.on||R.proc?' disabled':''}>${R.busy?'שולח… זה יכול לקחת עד דקה':'שלח דיווח'}</button></div>`}
function myToday(){const t=todayIL(),c=D.cfg||{},id=SY.uid+'_'+t.replace(/-/g,''),doc=(D.my||[]).find(x=>x.id===id)||null;
 if(!(c.req&&c.req[SY.uid]===true))return '<div class="card"><p class="note" style="margin:0">אינך חייב בדיווח יומי.</p></div>';
 if(!isRepDay(t,c))return `<div class="card"><p class="note" style="margin:0">היום (${esc(fmtDay(t))}) אינו יום דיווח.</p></div>`;
 if(doc&&doc.st==='ok')return `<div class="card"><b>הדיווח של היום אושר</b><p class="note">הסיכום וההערות של המנהל מופיעים ב"היסטוריה".</p><button class="btn g w" data-a="drOpen" data-id="${esc(doc.id)}">לצפייה</button></div>`;
 return (doc?`<div class="card" style="padding:10px 14px"><div class="row" style="align-items:center"><b class="grow">${esc(fmtDay(t))}</b>${tag(doc)}</div></div>`:`<div class="card" style="padding:10px 14px"><b>${esc(fmtDay(t))}</b></div>`)+formH(doc)}
function histH(L,onClick){return L.length?L.map(d=>`<button class="li" data-a="${onClick}" data-id="${esc(d.id)}"><div class="m"><b>${esc(fmtDay(d.day))}</b><small>${esc(d.n||'')}${d.e?' · '+d.e.length+' שליחות':''}</small></div>${tag(d)}${ico('chev')}</button>`).join(''):'<div class="empty">אין דיווחים</div>'}
function wView(id){const C=D.card;if(!C||C.id!==id){load('c'+id,()=>cardLoad(id));return loading('דיווח')}
 const d=C.doc,w=C.w;
 return `<button class="btn g s" data-a="drBack" style="margin-bottom:8px">חזרה</button><div class="card"><div class="row" style="align-items:center"><b class="grow">${esc(fmtDay(d.day))}</b>${tag(d)}</div>
 ${w?`<div class="sec"><h3>הסיכום שאושר</h3></div><p style="white-space:pre-wrap;margin:0 0 8px">${esc(w.sumW||'')}</p>${Array.isArray(w.notes)&&w.notes.length?`<div class="sec"><h3>הערות המנהל</h3></div>${w.notes.map(n=>`<div class="li" style="cursor:default"><div class="m"><b style="white-space:pre-wrap">${esc(n&&n.txt||'')}</b></div></div>`).join('')}`:''}`:'<p class="note">הדיווח עדיין לא אושר.</p>'}</div>
 <div class="card"><b>מה שדיווחת</b>${(d.e||[]).map((e,i)=>`<p style="white-space:pre-wrap;margin:8px 0 0"><small class="note">שליחה ${i+1} · ${tm(e.t)}${e.au?' · עם הקלטה':''}${e.np?' · '+e.np+' תמונות':''}</small><br>${esc(e.txt||e.tr||'')}</p>`).join('')}</div>`}
function workerV(){const T='דיווח יומי';
 if(!D.cfg){load('cfg',cfgLoad);return loading(T)}
 if(!D.my){load('my',async()=>{D.my=await runQ('uid',SY.uid,60)});return loading(T)}
 const tab=D.tab==='hist'?'hist':'today';
 const tabs=`<div class="chips" role="tablist" style="margin:0 0 10px"><button class="chip ${tab==='today'?'on':''}" data-a="drTab" data-v="today" aria-pressed="${tab==='today'}">דיווח היום</button><button class="chip ${tab==='hist'?'on':''}" data-a="drTab" data-v="hist" aria-pressed="${tab==='hist'}">היסטוריה</button></div>`;
 if(D.open)return{t:T,h:wView(D.open)};
 return{t:T,s:'דיווח אחד ביום',h:tabs+(tab==='today'?myToday():histH(D.my,'drOpen'))}}

/* ---------- מנהל ---------- */
const reqUids=()=>Object.keys((D.cfg&&D.cfg.req)||{}).filter(u=>D.cfg.req[u]===true);
function dayH(){const c=D.cfg,L=D.dayL,by={};L.forEach(d=>{by[d.uid]=d});
 const us=[...new Set([...reqUids(),...L.map(d=>d.uid)])].sort((a,b)=>(stf(a)||(by[a]&&by[a].n)||a).localeCompare(stf(b)||(by[b]&&by[b].n)||b,'he'));
 const rep=us.filter(u=>by[u]).length,ok=us.filter(u=>by[u]&&by[u].st==='ok').length;
 return `<div class="card"><label class="f"><span>יום</span><input type="date" value="${esc(D.day)}" data-c="drDay"></label>
 <p class="note" style="margin:0">${esc(fmtDay(D.day))}${isRepDay(D.day,c)?'':' · לא יום דיווח'}${us.length?` · דיווחו ${rep} מתוך ${us.length} · אושרו ${ok}`:''}</p></div>
 ${us.length?us.map(u=>{const d=by[u],nm=stf(u)||(d&&d.n)||u;return d?`<button class="li" data-a="drOpen" data-id="${esc(d.id)}"><div class="m"><b>${esc(nm)}</b><small>${d.e?d.e.length+' שליחות':''}${d.ai==='cap'?' · בלי סיכום (תקרה)':''}</small></div>${tag(d)}${ico('chev')}</button>`:`<div class="li" style="cursor:default"><div class="m"><b>${esc(nm)}</b></div><span class="tag t4">לא דיווח</span></div>`}).join(''):'<div class="empty">אין עובדים חייבים בדיווח. אפשר לסמן במסך "עובדים".</div>'}`}
function mHist(){const us=[...new Set([...reqUids(),...(D.staff||[]).filter(s=>s.role!=='manager').map(s=>s.uid)])];
 const sel=`<label class="f"><span>עובד</span><select data-c="drHu"><option value="">בחר עובד</option>${us.map(u=>`<option value="${esc(u)}"${u===D.hu?' selected':''}>${esc(stf(u)||u)}</option>`).join('')}</select></label>`;
 if(D.hu&&!D.hl)load('hl',async()=>{D.hl=await runQ('uid',D.hu,100)});
 return `<div class="card">${sel}</div>`+(D.hu?(D.hl?histH(D.hl,'drOpen'):'<div class="empty">טוען…</div>'):'<div class="empty">בחר עובד</div>')}
function cardH(id){const C=D.card;if(!C||C.id!==id){load('c'+id,()=>cardLoad(id));return loading('דיווח')}
 const d=C.doc,m=C.m||{},raw=d.st==='raw'||!m.sum,nm=stf(d.uid)||d.n||'';
 const aiN=d.ai==='cap'?'תקרת ה-AI החודשית הסתיימה, לכן מוצג דיווח גולמי.':d.ai==='err'?'הסיכום האוטומטי נכשל.':'';
 const sub=(d.e||[]).map((e,i)=>`<div class="card" style="margin:6px 0"><small class="note">שליחה ${i+1} · ${tm(e.t)}</small>${e.txt?`<p style="white-space:pre-wrap;margin:6px 0 0">${esc(e.txt)}</p>`:''}${e.tr?`<p style="white-space:pre-wrap;margin:6px 0 0"><small class="note">תמליל:</small><br>${esc(e.tr)}</p>`:''}${e.au?`<button type="button" class="btn g s" data-a="drPlay" data-n="${i}" style="margin-top:6px">השמע הקלטה${e.sec?' ('+mmss(e.sec)+')':''}</button>`:''}</div>`).join('');
 const ph=C.p.length?`<div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0">${C.p.map((p,i)=>`<button type="button" class="chip" data-a="drImgView" data-n="${i}" style="padding:0;border:0;background:none"><img src="${esc(p.img)}" alt="תמונה ${i+1}" style="width:96px;height:96px;object-fit:cover;border-radius:var(--r-m);border:1px solid var(--line)"></button>`).join('')}</div>`:'';
 const tkOn=bzF('tasks');
 const notes=C.nd.map((n,i)=>`<div class="card" style="margin:6px 0"><label class="f"><span>הערה ${i+1}</span><textarea data-i="drNote" data-n="${i}" rows="3" maxlength="1000">${esc(n.txt)}</textarea></label><div class="row" style="flex-wrap:wrap;gap:6px;align-items:center">${tkOn?`<button type="button" class="btn g s" data-a="drTkOpen" data-n="${i}">פתח כמשימה</button>`:''}${n.tk.length?`<span class="tag t3">${n.tk.length} משימות נפתחו</span>`:''}${C.nd.slice(i).some(x=>x.tk.length)?'':`<button type="button" class="btn g s" data-a="drNoteDel" data-n="${i}">הסר</button>`}</div></div>`).join('');
 return `<button class="btn g s" data-a="drBack" style="margin-bottom:8px">חזרה</button>
 <div class="card"><div class="row" style="align-items:center"><div class="grow"><b>${esc(nm)}</b><br><small class="note">${esc(fmtDay(d.day))}</small></div>${tag(d)}</div>${aiN?`<p class="note">${esc(aiN)}</p>`:''}</div>
 <div class="card"><div class="sec"><h3>${raw?'דיווח גולמי':'סיכום AI'}</h3></div>${raw?`<p class="note" style="margin-top:0">אין סיכום. אפשר לקרוא את הדיווח למטה${d.ai==='cap'?'':' או ליצור סיכום שוב'}.</p><button class="btn g w" data-a="drResum"${C.busy?' disabled':''}>צור סיכום שוב</button>`:`<p style="white-space:pre-wrap;margin:0">${esc(m.sum)}</p>`}</div>
 <div class="sec"><h3>מה דווח</h3></div>${sub}${ph}
 <div class="card"><label class="f"><span>הסיכום שיישלח לעובד</span><textarea data-i="drSumW" rows="5" maxlength="4000">${esc(C.sumW)}</textarea></label></div>
 <div class="sec"><h3>הערות לעובד</h3></div>${notes||'<p class="note">אין הערות.</p>'}
 <div class="row" style="gap:8px"><button type="button" class="btn g grow" data-a="drNoteAdd"${C.nd.length>=10?' disabled':''}>＋ הערה</button><button type="button" class="btn g grow" data-a="drNotesSave"${C.busy?' disabled':''}>שמור הערות</button></div>
 <button type="button" class="btn w" data-a="drApprove" style="margin-top:10px"${C.busy?' disabled':''}>${d.st==='ok'?'עדכן ושלח לעובד שוב':'אשר ושלח לעובד'}</button>`}
function cfgH(){const c=D.cfg,F=D.cf||(D.cf={days:cfgDays(c).slice(),hr:String(c.hr||'18:00'),off:Array.isArray(c.off)?c.off.slice():[]});
 const dc=[0,1,2,3,4,5].map(i=>`<button type="button" class="chip ${F.days.includes(i)?'on':''}" data-a="drDayT" data-n="${i}" aria-pressed="${F.days.includes(i)}">${DN[i]}</button>`).join('');
 const cap=SY.sa?(D.cap?`<div class="card"><h3 style="margin-top:0">תקרת AI חודשית (מנהל־על)</h3><form data-f="drCapF"><label class="f"><span>תקרה בדולרים</span><input name="usd" inputmode="decimal" value="${esc(String(D.cap.capCents/100))}" required></label><button class="btn w">שמור תקרה</button></form></div>`:(load('cap',capLoad),'<div class="empty">טוען…</div>')):'';
 return `<div class="card"><h3 style="margin-top:0">ימי דיווח</h3><div class="chips" style="margin:6px 0">${dc}</div><p class="note">שבת לא נכללת.</p>
 <label class="f"><span>שעת תזכורת</span><input type="time" data-i="drHr" value="${esc(F.hr)}"></label></div>
 <div class="card"><h3 style="margin-top:0">ימי חופש וחג</h3>${F.off.length?`<div class="chips" style="margin:6px 0">${F.off.map((o,i)=>`<button type="button" class="chip" data-a="drOffDel" data-n="${i}" aria-label="הסר">${esc(fmtDay(o))} ${ico('x')}</button>`).join('')}</div>`:'<p class="note">אין ימי חופש.</p>'}
 <div class="row"><label class="f grow"><span>הוספת תאריך</span><input type="date" id="drOffIn"></label><button type="button" class="btn g" data-a="drOffAdd">הוסף</button></div></div>
 <button type="button" class="btn w" data-a="drCfgSave">שמור הגדרות</button>${cap}`}
function mgrV(){const T='דיווח יומי';
 if(!D.cfg){load('cfg',cfgLoad);return loading(T)}
 if(!D.staff){load('staff',staffLoad);return loading(T)}
 if(D.open)return{t:T,h:cardH(D.open)};
 const tab=['day','hist','cfg'].includes(D.tab)?D.tab:'day';
 if(!D.day)D.day=todayIL();
 if(tab==='day'&&!D.dayL){const dd=D.day;load('day',async()=>{const L=await runQ('day',dd,200);if(dd===D.day)D.dayL=L});return loading(T)}
 const tb=[['day','היום'],['hist','היסטוריה'],['cfg','הגדרות']].map(([k,l])=>`<button class="chip ${tab===k?'on':''}" data-a="drTab" data-v="${k}" aria-pressed="${tab===k}">${l}</button>`).join('');
 return{t:T,s:'דיווח עובדים',h:`<div class="chips" role="tablist" style="margin:0 0 10px">${tb}</div>`+(tab==='day'?dayH():tab==='hist'?mHist():cfgH())}}
V.dr=()=>{const T='דיווח יומי';if(!on())return deny(T);return mgr()?mgrV():isW()?workerV():deny(T)};

/* ---------- פעולות ---------- */
ACT.drRe=()=>{reset();rerender()};
ACT.drTab=el=>{if(RC.on)micCancel();D.tab=el.dataset.v;D.open='';D.card=null;if(D.tab==='cfg')D.cf=null;rerender()};
ACT.drOpen=el=>{D.open=el.dataset.id;D.card=null;rerender()};
ACT.drBack=()=>{D.open='';D.card=null;rerender()};
window.drOpen=id=>{if(!on()||!/^[A-Za-z0-9_-]{1,80}$/.test(String(id||''))){if(on())go('dr');return}D.open=String(id);D.card=null;D.dayL=null;D.my=null;if(!isW())D.tab='day';else D.tab='hist';if(cur().v!=='dr')go('dr');else rerender()};
window.drTile=()=>on()?`<button class="tile" data-a="addGo" data-v="dr" style="font-size:1rem">${ico('doc')}${mgr()?'דיווח יומי':'דיווח היום'}</button>`:'';
INP.drT=el=>{D.dr.txt=el.value};
INP.drSumW=el=>{if(D.card){D.card.sumW=el.value;D.card.dirty=1}};
INP.drNote=el=>{const n=D.card&&D.card.nd[+el.dataset.n];if(n){n.txt=el.value;D.card.dirty=1}};
INP.drHr=el=>{if(D.cf)D.cf.hr=el.value};
CHG.drDay=el=>{if(/^\d{4}-\d{2}-\d{2}$/.test(el.value)){D.day=el.value;D.dayL=null;rerender()}};
CHG.drHu=el=>{D.hu=el.value;D.hl=null;rerender()};
CHG.drImg=async el=>{const fs=[...(el.files||[])];el.value='';if(!fs.length)return;const room=MAXI-D.dr.imgs.length;if(fs.length>room)toast('אפשר לצרף עד '+MAXI+' תמונות');
 for(const f of fs.slice(0,Math.max(0,room))){try{D.dr.imgs.push(await shrink(await rdU(f)))}catch(e){toast('תמונה לא תקינה או גדולה מדי, דילגתי עליה')}}rerender()};
ACT.drImgDel=el=>{D.dr.imgs.splice(+el.dataset.n,1);rerender()};
ACT.drRec=()=>{D.dr.aud=null;micStart()};
ACT.drRecStop=()=>micStop();
ACT.drAudDel=()=>{D.dr.aud=null;rerender()};
ACT.drSend=async()=>{const R=D.dr;if(R.busy||RC.on||R.proc)return;const txt=String(R.txt||'').trim();
 if(!txt&&!R.aud&&!R.imgs.length)return toast('כתבו, הקלידו או צרפו תמונה לפני השליחה');
 const a={};if(txt)a.txt=txt.slice(0,3000);if(R.aud)a.audio={mime:'audio/wav',b64:R.aud.b64,sec:R.aud.sec};if(R.imgs.length)a.imgs=R.imgs.slice(0,MAXI);
 R.busy=1;rerender();
 try{await fnCall('drSubmit',a);Object.assign(R,{txt:'',imgs:[],aud:null});D.my=null;toast('הדיווח נשלח');}catch(e){err(e)}finally{R.busy=0;if(cur().v==='dr')rerender()}};
/* מנהל: כרטיס */
ACT.drPlay=async el=>{const C=D.card;if(!C||el.disabled)return;el.disabled=true;try{const r=await fnCall('drMgr',{op:'audio',id:C.id,i:+el.dataset.n});if(!r||r.mime!=='audio/wav'||typeof r.b64!=='string')throw new Error('ההקלטה לא נמצאה');if(D.au){try{D.au.pause()}catch(e){}}D.au=new Audio('data:audio/wav;base64,'+r.b64);await D.au.play()}catch(e){err(e)}finally{el.disabled=false}};
ACT.drImgView=el=>{const p=D.card&&D.card.p[+el.dataset.n];if(p&&imgOk(p.img))dlg(`<div style="max-height:75vh;overflow:auto;text-align:center"><img src="${esc(p.img)}" alt="תמונת הדיווח" style="max-width:100%"></div><button class="btn g w" data-a="closeDlg" style="margin-top:8px">סגור</button>`)};
ACT.drNoteAdd=()=>{const C=D.card;if(!C||C.nd.length>=10)return;C.nd.push({txt:'',tk:[]});C.dirty=1;rerender()};
ACT.drNoteDel=el=>{const C=D.card;if(!C)return;C.nd.splice(+el.dataset.n,1);C.dirty=1;rerender()};
async function notesSave(C){/* הערה ריקה בלי משימות בסוף הרשימה נשמטת; לפני הערה עם משימות – אסור להשאיר ריקה (מזהי המשימות נשמרים לפי האינדקס) */
 let last=-1;C.nd.forEach((n,i)=>{if(n.tk.length)last=i});
 for(let i=0;i<=last;i++)if(!C.nd[i].txt.trim())throw new Error('אי אפשר להשאיר הערה ריקה לפני הערה שנפתחו ממנה משימות');
 C.nd=C.nd.filter((n,i)=>i<=last||n.txt.trim());
 await fnCall('drMgr',{op:'notes',id:C.id,notes:C.nd.map(n=>({txt:n.txt.trim()}))});C.dirty=0}
ACT.drNotesSave=async()=>{const C=D.card;if(!C||C.busy)return;C.busy=1;rerender();try{await notesSave(C);toast('ההערות נשמרו')}catch(e){err(e)}finally{C.busy=0;rerender()}};
ACT.drResum=async()=>{const C=D.card;if(!C||C.busy)return;C.busy=1;rerender();try{await fnCall('drMgr',{op:'resum',id:C.id});const id=C.id;D.card=null;D.dayL=null;await cardLoad(id);toast('הסיכום נוצר מחדש')}catch(e){err(e);C.busy=0}finally{rerender()}};
ACT.drApprove=()=>{const C=D.card;if(!C||C.busy)return;const sw=C.sumW.trim();if(!sw&&!C.nd.some(n=>n.txt.trim()))return toast('אין מה לשלוח: כתבו סיכום או הערה');
 ask('לאשר ולשלוח את הסיכום וההערות לעובד?',async()=>{C.busy=1;rerender();try{await notesSave(C);await fnCall('drMgr',{op:'approve',id:C.id,sumW:sw});toast('אושר ונשלח לעובד');const id=C.id;D.card=null;D.dayL=null;D.hl=null;await cardLoad(id)}catch(e){err(e);C.busy=0}finally{rerender()}},'כן, אשר ושלח')};
/* פתיחת הערה כמשימה */
function tkNew(o){/* יצירת משימה בלי טופס: אותם שדות ואותה בדיקה כמו FRM.tkAdd (בלי שדות רשות), ויעד בטווח 3–17 ימים */
 const txt=String(o&&o.txt||'').trim().slice(0,500);if(!txt)throw new Error('אין טקסט למשימה');
 const to=Array.isArray(o.to)?o.to.filter(x=>typeof x==='string'&&x):[],toN=Array.isArray(o.toN)?o.toN.map(x=>String(x||'')):[];
 if(!to.length||to.length>30||toN.length!==to.length)throw new Error('בחר עובד למשימה');
 const now=Date.now(),id=uid(),one=to.length===1;let due=typeof tkDue==='function'?tkDue(now):now+4*864e5;due=Math.max(now+259200000+60000,Math.min(due,now+1468800000-60000));
 const fields={owner:sv(SY.uid),by:sv(fbBy()),role:sv('a'),txt:sv(txt),cr:iv(now),due:iv(due),st:sv('open'),open:sv('1'),pr:sv(''),img:sv(''),sub:iv(0),doneBy:sv(''),note:sv(''),ok:iv(0),late:sv(''),
  to:{arrayValue:{values:to.map(sv)}},toN:{arrayValue:{values:toN.map(sv)}},ow:sv(one?to[0]:''),owN:sv(one?toN[0]:''),clt:iv(one?now:0),np:iv(0),wp:iv(0),mi:iv(0)};
 return fsx('/tasks?documentId='+encodeURIComponent(id),{method:'POST',body:JSON.stringify({fields})}).then(()=>id)}
const lines=t=>String(t||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
ACT.drTkOpen=async el=>{const C=D.card;if(!C||C.busy||!bzF('tasks'))return;const i=+el.dataset.n,n=C.nd[i];if(!n||!n.txt.trim())return toast('כתבו את ההערה קודם');
 if(C.dirty){C.busy=1;try{await notesSave(C)}catch(e){C.busy=0;return err(e)}C.busy=0}
 const L=lines(n.txt),us=(D.staff||[]).map(s=>s.uid),me=C.doc.uid,opt=[...new Set([me,...us])];
 dlg(`<h3>פתיחת משימה מהערה</h3><form data-f="drTkF" data-n="${i}"><label class="f"><span>למי המשימה</span><select name="to">${opt.map(u=>`<option value="${esc(u)}"${u===me?' selected':''}>${esc(stf(u)||C.doc.n||u)}</option>`).join('')}</select></label>
 ${L.length>1?`<div class="f"><span>איך לפתוח</span><div class="chips" role="radiogroup" style="margin:4px 0"><label class="chip"><input type="radio" name="mode" value="one" checked> משימה אחת</label><label class="chip"><input type="radio" name="mode" value="split"> פיצול: משימה לכל שורה</label></div></div>
 <div class="f"><span>שורות (בפיצול – רק המסומנות)</span>${L.map((l,k)=>`<label class="cb" style="display:flex;gap:8px;align-items:flex-start;margin:4px 0"><input type="checkbox" name="l" value="${k}" checked> <span>${esc(l)}</span></label>`).join('')}</div>`:`<p class="note" style="white-space:pre-wrap">${esc(L[0]||'')}</p>`}
 <div class="row"><button class="btn grow">פתח</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`)};
FRM.drTkF=async(f,ev)=>{const C=D.card;if(!C||C.busy)return;const i=+f.dataset.n,n=C.nd[i];if(!n)return;const fdv=new FormData(f),to=String(fdv.get('to')||''),mode=String(fdv.get('mode')||'one');
 const L=lines(n.txt),pick=mode==='split'?fdv.getAll('l').map(Number).filter(k=>L[k]).map(k=>L[k]):[n.txt.trim()];
 if(!pick.length)return toast('סמנו לפחות שורה אחת');if(pick.some(t=>t.length>500))return toast('הטקסט ארוך מ-500 תווים. קצרו או פצלו לשורות');
 const b=f.querySelector('button');if(b)b.disabled=true;C.busy=1;const ids=[],nm=stf(to)||C.doc.n||'';let fail=null;
 try{for(const t of pick)ids.push(await tkNew({txt:t,to:[to],toN:[nm]}))}catch(e){fail=e}
 try{if(ids.length)await fnCall('drMgr',{op:'tk',id:C.id,i,tk:ids})}catch(e){fail=fail||e}
 if(ids.length){n.tk=n.tk.concat(ids);try{if(typeof tkLoad==='function')await tkLoad()}catch(e){}}
 C.busy=0;closeDlg();rerender();
 if(fail)toast((ids.length?'נפתחו '+ids.length+' משימות, ':'')+(fail.message||'הפעולה נכשלה'));else toast(ids.length===1?'נפתחה משימה אחת':'נפתחו '+ids.length+' משימות')};
/* הגדרות */
ACT.drDayT=el=>{const F=D.cf;if(!F)return;const i=+el.dataset.n,k=F.days.indexOf(i);if(k<0)F.days.push(i);else F.days.splice(k,1);F.days.sort();rerender()};
ACT.drOffAdd=()=>{const F=D.cf,v=(document.getElementById('drOffIn')||{}).value;if(!F||!/^\d{4}-\d{2}-\d{2}$/.test(v||''))return toast('בחרו תאריך');if(F.off.includes(v))return;if(F.off.length>=60)return toast('אפשר עד 60 ימים');F.off.push(v);F.off.sort();rerender()};
ACT.drOffDel=el=>{if(D.cf){D.cf.off.splice(+el.dataset.n,1);rerender()}};
ACT.drCfgSave=async el=>{const F=D.cf;if(!F)return;if(!F.days.length)return toast('בחרו לפחות יום אחד');if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(F.hr||''))return toast('שעת תזכורת לא תקינה');
 el.disabled=true;try{await fnCall('drSetCfg',{days:F.days,hr:F.hr,off:F.off});Object.assign(D.cfg,{days:F.days.slice(),hr:F.hr,off:F.off.slice()});D.dayL=null;toast('ההגדרות נשמרו')}catch(e){err(e)}finally{el.disabled=false}};
FRM.drCapF=async f=>{const v=Number(String(new FormData(f).get('usd')||'').replace(',','.'));if(!Number.isFinite(v)||v<0||v>10000)return toast('סכום לא תקין');
 try{await fnCall('drSetCap',{capCents:Math.round(v*100)});D.cap={capCents:Math.round(v*100)};toast('התקרה נשמרה');rerender()}catch(e){err(e)}};
/* מתג "חייב בדיווח יומי" לכל עובד, במסך העובדים */
ACT.drReq=async el=>{const u=el.dataset.uid;if(!on()||!mgr()||!/^[A-Za-z0-9_-]{1,128}$/.test(u||'')||el.disabled)return;const c=D.cfg;if(!c)return;const nv=!(c.req&&c.req[u]===true);el.disabled=true;
 try{await fnCall('drSetCfg',{req:{[u]:nv}});c.req=Object.assign({},c.req,{[u]:nv});D.dayL=null}catch(e){err(e)}finally{el.disabled=false;if(cur().v==='staff')rerender()}};
{const o=V.staff;if(typeof o==='function')V.staff=function(){const r=o.apply(this,arguments);try{if(on()&&mgr()&&r&&r.h){if(!D.cfg){load('cfg',cfgLoad)}else r.h=r.h.replace(/<button class="btn s g" data-a="admStf" data-uid="([A-Za-z0-9_-]{1,128})">/g,(m,u)=>{const q=D.cfg.req&&D.cfg.req[u]===true;return `<button class="chip ${q?'on':''}" data-a="drReq" data-uid="${u}" aria-pressed="${q}">חייב בדיווח יומי</button>`+m})}}catch(e){}return r}}
})();
