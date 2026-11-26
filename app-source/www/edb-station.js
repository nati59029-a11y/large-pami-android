/* הדפסת דף אכיל – סבב 2 (26.11.2026): תחנת הדפסה במחשב המדבקות + תור בענן.
   מהטלפון: תמונות העמוד (PNG, 300 DPI) עולות ל-Storage (edb_tmp/{id}/p{i}.png, בעסק b: b/{bizId}/edb_tmp/...), ומסמך עבודה edbq/{id}:
     st 'up' (מעלה) → 'new' (ממתין למחשב) → 'taken' (המחשב מדפיס) → 'done' (הודפס) / 'err' (נכשל, msg). השולח יכול לבטל (up/new → err).
   במחשב: הגדרה במכשיר "המחשב הזה = תחנת הדפסה" (lp-edb-prn: on, name, port). כשהיא דולקת והמשתמש מורשה (מנהל / עובד עם edb),
     לולאה ברקע (בכל מסך, גם במסך המדבקות): בודקת את עוזר ההדפסה המקומי (http://127.0.0.1:<port>/status), תופסת עבודה 'new'
     (PATCH עם currentDocument.updateTime – אטומי; החוקים דורשים st == 'new'), מורידה את העמודים, שולחת לעוזר (POST /print),
     מסמנת done/err ומוחקת את הקבצים. עבודה ישנה מ-24 שעות – מסומנת err ולא מודפסת. edbs/main – "דופק" של התחנה (on, pr, hp, at),
     כדי שהטלפון יידע שיש תחנה. נקודה קטנה בפינה (לא מודפסת) מראה את מצב התחנה. אין חלון הדפסה בדפדפן – מדבקות לא מושפעות.
   עוזר ההדפסה: tools/edb-helper/edb-helper.ps1 (מאזין רק ל-127.0.0.1, מקבל רק את כתובות האפליקציה). */
(function(root){
'use strict';
if(typeof window==='undefined'||typeof ACT==='undefined')return;
const PRNK='lp-edb-prn',DEF={on:false,name:'L130',port:'17891'},MAXB=30*1024*1024,DAY=864e5;
const cfg=()=>{try{const o=JSON.parse(localStorage.getItem(PRNK)||'null')||{};return{on:o.on===true,name:String(o.name==null?DEF.name:o.name).slice(0,80),port:/^\d{2,5}$/.test(String(o.port||''))?String(o.port):DEF.port}}catch(e){return Object.assign({},DEF)}};
const cfgSet=o=>{try{localStorage.setItem(PRNK,JSON.stringify(o))}catch(e){}};
const mgr=()=>(typeof isA==='function'&&isA())||!!(SY&&SY.sa);
const ok=()=>!!SY&&!!SY.refresh&&!SY.mg&&(mgr()||(typeof isW==='function'&&isW()&&!!(SY.perms&&SY.perms.edb===true)));
const pre=()=>(typeof bzB==='function'&&bzB()?'b/'+SY.bizId+'/':'');
const fp=(id,i)=>pre()+'edb_tmp/'+id+'/p'+i+'.png';
const dec=d=>Object.assign({id:idOf(d)},Object.fromEntries(Object.entries(d.fields||{}).map(([k,v])=>[k,fvj(v)])));
const fld=o=>{const f={};for(const k in o){const v=o[k];f[k]=typeof v==='boolean'?{booleanValue:v}:typeof v==='number'?{integerValue:String(Math.round(v))}:{stringValue:String(v)}}return f};
const mask=ks=>ks.map(k=>'updateMask.fieldPaths='+k).join('&');
const rid=()=>{const a='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',b=new Uint8Array(20);crypto.getRandomValues(b);return Array.from(b,x=>a[x%62]).join('')};
const ago=t=>{const m=Math.round((Date.now()-t)/60000);return m<1?'עכשיו':m<60?'לפני '+m+' דק\'':m<1440?'לפני '+Math.round(m/60)+' שע\'':'לפני '+Math.round(m/1440)+' ימים'};

/* ---------- עוזר ההדפסה המקומי (רק בתחנה) ----------
   fetch בלי עוגיות (credentials:'omit'). POST עם Content-Type application/octet-stream → Chrome שולח קודם OPTIONS (כולל Private Network Access) – העוזר עונה. */
const HE={'no-printer':'המדפסת לא נמצאה במחשב','bad-request':'בקשה לא תקינה','too-big':'הקובץ גדול מדי','bad-png':'תמונת העמוד פגומה','print-failed':'ההדפסה נכשלה במחשב','origin':'העוזר חסם את הכתובת'};
const hUrl=(p,path)=>'http://127.0.0.1:'+p.port+path;
async function hFetch(url,opt,ms){const ac=typeof AbortController==='function'?new AbortController():null,t=setTimeout(()=>{try{ac&&ac.abort()}catch(e){}},ms);
 try{const r=await fetch(url,Object.assign({mode:'cors',credentials:'omit',cache:'no-store',signal:ac?ac.signal:undefined},opt));let j=null;try{j=await r.json()}catch(e){}return{ok:r.ok&&!!j&&j.ok===true,j:j||{},st:r.status}}
 catch(e){return{ok:false,j:{},st:0,down:true}}finally{clearTimeout(t)}}
const hStatus=p=>{p=p||cfg();return hFetch(hUrl(p,'/status?p='+encodeURIComponent(p.name||'')),{method:'GET'},3000)};
// pages: מערך Blob של PNG. גוף הבקשה = העמודים ברצף; הגדלים ב-s (מופרדים בפסיק)
async function hPrint(p,pages,name){const q='/print?p='+encodeURIComponent(p.name||'')+'&s='+pages.map(b=>b.size).join(',')+'&name='+encodeURIComponent(String(name||'edible').slice(0,40));
 const r=await hFetch(hUrl(p,q),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:new Blob(pages,{type:'application/octet-stream'})},180000);
 if(r.ok)return{ok:true,pr:String(r.j.printer||'')};
 return{ok:false,msg:r.down?'עוזר ההדפסה לא עונה במחשב':(HE[r.j.err]||'שגיאה בעוזר ההדפסה')+(r.j.err==='no-printer'&&p.name?' (מחפש "'+p.name+'")':'')}}

/* ---------- התחנה (edbs/main) – לטלפון ---------- */
let SN={t:0,v:null};
async function stn(force){if(!ok())return null;if(!force&&Date.now()-SN.t<60000)return SN.v;let v=null;
 try{const d=await fsx('/edbs/main');v=d&&d.fields?dec(d):null}catch(e){if(!e||e.code!==404)return SN.v}SN={t:Date.now(),v};return v}
const stnOn=v=>!!(v&&v.on===true);
const stnTxt=v=>!stnOn(v)?'':'תחנת הדפסה במחשב: '+(v.hp===false?'עוזר ההדפסה לא ענה':'פעילה')+', עדכון אחרון '+ago(+v.at||0);

/* ---------- שליחה מהטלפון לתחנה ---------- */
const ST={up:'שולח למחשב…',new:'נשלח – ממתין למחשב',taken:'מודפס עכשיו במחשב…',done:'הודפס',err:'נכשל'};
let JB=null;
const jHtml=()=>{const j=JB;if(!j)return'';const c=j.st==='done'?'var(--acc)':j.st==='err'?'#e0483e':'inherit';
 return `<p style="font-size:1.15rem;font-weight:700;color:${c}">${esc(ST[j.st]||j.st)}${j.st==='err'&&j.msg?': '+esc(j.msg):''}</p>${j.st==='up'&&j.pg?`<p class="note">עמוד ${j.pg} מתוך ${j.n}</p>`:''}${j.st==='new'&&j.hint?`<p class="note">${esc(j.hint)}</p>`:''}
<div class="row" style="gap:8px">${j.st==='up'||j.st==='new'?'<button class="btn g grow" data-a="edbQx">ביטול השליחה</button>':''}<button class="btn grow" data-a="closeDlg">סגירה</button></div>`};
const jShow=()=>{const e=document.getElementById('edbJs');if(e)e.innerHTML=jHtml();return!!e};
async function jSet(id,st,msg){const f={st};if(msg)f.msg=String(msg).slice(0,200);return fsx('/edbq/'+id+'?'+mask(Object.keys(f))+'&currentDocument.exists=true',{method:'PATCH',body:JSON.stringify({fields:fld(f)})})}
async function stDel(id,n){const t=await tok();for(let i=0;i<n;i++){try{await fetch(STB()+'/'+encodeURIComponent(fp(id,i)),{method:'DELETE',headers:{Authorization:'Firebase '+t}})}catch(e){}}}
// pages: Blob[] (PNG). מחזיר מיד אחרי שהחלון נפתח; המצב מתעדכן בחלון
async function send(pages,name){if(!ok())throw new Error('אין הרשאה');if(!pages||!pages.length||pages.length>10)throw new Error('אין עמודים');
 if(pages.some(b=>!b||b.size>MAXB))throw new Error('תמונת העמוד גדולה מדי');
 const id=rid(),n=pages.length,s=await stn();JB={id,n,st:'up',pg:0,hint:s&&s.hp===false?'עוזר ההדפסה במחשב לא ענה לאחרונה – כדאי לבדוק שהמחשב פועל':''};
 dlg(`<h3>שליחה למחשב – ${esc(name||'דף אכיל')}</h3><div id="edbJs">${jHtml()}</div>`);
 try{await fsx('/edbq?documentId='+id,{method:'POST',body:JSON.stringify({fields:fld({by:SY.uid,at:Date.now(),st:'up',n})})})}
 catch(e){JB.st='err';JB.msg=e.offline?'אין חיבור לאינטרנט':'לא נשמר ('+(e.message||e)+')';jShow();return}
 try{const t=await tok();for(let i=0;i<n;i++){if(!JB||JB.id!==id||JB.st!=='up')return;JB.pg=i+1;jShow();let r;
   try{r=await fetch(STB()+'?uploadType=media&name='+encodeURIComponent(fp(id,i)),{method:'POST',headers:{Authorization:'Firebase '+t,'Content-Type':'image/png'},body:pages[i]})}catch(e){throw new Error('אין חיבור לאינטרנט')}
   if(!r.ok)throw new Error(r.status===403?'אין הרשאה להעלות':'ההעלאה נכשלה ('+r.status+')')}
  await jSet(id,'new');if(JB&&JB.id===id){JB.st='new';jShow()}}
 catch(e){const m=e&&e.message||String(e);try{await jSet(id,'err',m)}catch(e2){}stDel(id,n);if(JB&&JB.id===id){JB.st='err';JB.msg=m;jShow()}return}
 poll(id,Date.now())}
// מצב העבודה – כל 3 שניות כל עוד החלון פתוח, עד 20 דקות
async function poll(id,t0){if(!JB||JB.id!==id||!document.getElementById('edbJs'))return;if(Date.now()-t0>20*60000)return;
 try{const d=await fsx('/edbq/'+id);const j=d&&d.fields?dec(d):null;if(j&&JB&&JB.id===id){JB.st=j.st;JB.msg=j.msg||'';if(!jShow())return;if(j.st==='done'||j.st==='err')return}}catch(e){}
 setTimeout(()=>poll(id,t0),3000)}
ACT.edbQx=async()=>{const j=JB;if(!j||(j.st!=='up'&&j.st!=='new'))return;const was=j.st;j.st='err';j.msg='בוטל';jShow();
 if(was==='new'){try{await jSet(j.id,'err','בוטל');stDel(j.id,j.n)}catch(e){toast('הביטול נכשל – אולי המחשב כבר התחיל להדפיס');j.st='new';jShow()}}
 else{try{await jSet(j.id,'err','בוטל')}catch(e){}stDel(j.id,j.n)}};

/* ---------- התחנה במחשב: לולאה ברקע ---------- */
const W={busy:0,hp:null,hb:0,hbOn:null,err:'',pr:'',last:'',t:null};
function dot(){let e=document.getElementById('edbStDot');const c=cfg();
 if(!c.on){if(e)e.remove();return}
 if(!e){e=document.createElement('div');e.id='edbStDot';e.setAttribute('aria-hidden','true');
  e.style.cssText='position:fixed;left:4px;bottom:4px;width:10px;height:10px;border-radius:50%;z-index:2147483000;pointer-events:none;opacity:.85;box-shadow:0 0 0 1px #0008';
  const s=document.createElement('style');s.textContent='@media print{#edbStDot{display:none!important}}';e.appendChild(s);document.body.appendChild(e)}
 const col=!ok()?'#888':W.err?'#e0483e':W.busy?'#e6b422':'#2fae5b';e.style.background=col;
 e.title='תחנת דף אכיל: '+(!ok()?'אין הרשאה / לא מחובר':W.err||(W.busy?'מדפיס…':'פעילה'))}
async function beat(force){const c=cfg();if(!ok())return;const on=c.on,hp=W.hp===true;
 if(!force&&W.hbOn===on&&W.hbHp===hp&&Date.now()-W.hb<10*60000)return;
 try{await fsx('/edbs/main',{method:'PATCH',body:JSON.stringify({fields:fld({by:SY.uid,at:Date.now(),on,pr:(W.pr||c.name||'').slice(0,80),hp})})});W.hb=Date.now();W.hbOn=on;W.hbHp=hp;SN={t:0,v:null}}catch(e){}}
async function one(c,d){const j=dec(d.document),id=j.id,n=Math.max(1,Math.min(10,+j.n||1));
 if(!(+j.at>Date.now()-DAY)){try{await jSet(id,'err','פג תוקף – לא הודפס תוך 24 שעות')}catch(e){}return}
 // תפיסה אטומית: רק אם המסמך לא השתנה מאז הקריאה (ובחוקים: רק מ-'new')
 try{await fsx('/edbq/'+id+'?'+mask(['st','tk','msg'])+'&currentDocument.updateTime='+encodeURIComponent(d.document.updateTime),{method:'PATCH',body:JSON.stringify({fields:fld({st:'taken',tk:SY.uid,msg:'המחשב מדפיס'})})})}catch(e){return}
 W.busy=1;dot();let res;
 try{const t=await tok(),pages=[];
  for(let i=0;i<n;i++){const r=await fetch(STB()+'/'+encodeURIComponent(fp(id,i))+'?alt=media',{headers:{Authorization:'Firebase '+t}});if(!r.ok)throw new Error('הורדת העמוד נכשלה ('+r.status+')');pages.push(await r.blob())}
  res=await hPrint(c,pages,'edible-'+id.slice(0,6))}
 catch(e){res={ok:false,msg:e&&e.message||String(e)}}
 try{await jSet(id,res.ok?'done':'err',res.ok?'הודפס'+(res.pr?' ב-'+res.pr:''):res.msg)}catch(e){}
 if(res.ok)W.last='הודפס '+new Date().toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'});
 stDel(id,n);W.busy=0}
async function tick(){let wait=15000;
 try{const c=cfg();dot();if(!c.on||!ok()){W.err='';return}
  if(navigator.onLine===false){W.err='אין חיבור לאינטרנט';wait=30000;return}
  const h=await hStatus(c);W.hp=h.ok;W.pr=h.ok?String(h.j.chosen||''):W.pr;W.err=h.ok?(h.j.chosen?'':'מדפסת "'+c.name+'" לא נמצאה במחשב'):'עוזר ההדפסה לא עונה';dot();beat();
  if(!h.ok||!h.j.chosen){wait=30000;return}
  const r=await fsx(':runQuery',{method:'POST',body:JSON.stringify({structuredQuery:{from:[{collectionId:'edbq'}],where:{fieldFilter:{field:{fieldPath:'st'},op:'EQUAL',value:{stringValue:'new'}}},limit:10}})});
  const L=(r||[]).filter(x=>x&&x.document).sort((a,b)=>(+fvj(a.document.fields.at)||0)-(+fvj(b.document.fields.at)||0));
  if(L.length){await one(c,L[0]);if(L.length>1)wait=1000}}
 catch(e){W.busy=0;wait=60000}
 finally{dot();clearTimeout(W.t);W.t=setTimeout(tick,wait)}}
setTimeout(tick,8000);
function setCfg(o){const was=cfg().on;cfgSet(o);dot();if(o.on!==was||o.on){W.hbOn=null;beat(true)}clearTimeout(W.t);W.t=setTimeout(tick,1000)}

root.EdbSt={cfg,setCfg,ok,stn,stnOn,stnTxt,send,hStatus,hPrint,HE,W,DEF};
})(typeof window!=='undefined'?window:globalThis);
