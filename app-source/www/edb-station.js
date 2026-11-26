/* הדפסת דף אכיל – סבב 2 (26.11.2026): תחנת הדפסה במחשב המדבקות + תור בענן.
   מהטלפון: תמונות העמוד (PNG, 300 DPI) עולות ל-Storage (edb_tmp/{id}/p{i}.png, בעסק b: b/{bizId}/edb_tmp/...), ומסמך עבודה edbq/{id}:
     st 'up' (מעלה) → 'new' (ממתין למחשב) → 'taken' (המחשב מדפיס) → 'done' (הודפס) / 'err' (נכשל, msg). השולח יכול לבטל (up/new → err).
   במחשב: הגדרה במכשיר "המחשב הזה = תחנת הדפסה" (lp-edb-prn: on, name, port). כשהיא דולקת והמשתמש מורשה (מנהל / עובד עם edb),
     לולאה ברקע (בכל מסך, גם במסך המדבקות): בודקת את עוזר ההדפסה המקומי (http://127.0.0.1:<port>/status), תופסת עבודה 'new'
     (PATCH עם currentDocument.updateTime – אטומי; החוקים דורשים st == 'new'), מורידה את העמודים, שולחת לעוזר (POST /print),
     מסמנת done/err ומוחקת את הקבצים. עבודה ישנה מ-24 שעות – מסומנת err ולא מודפסת. edbs/main – "דופק" של התחנה (on, pr, hp, at),
     כדי שהטלפון יידע שיש תחנה. נקודה קטנה בפינה (לא מודפסת) מראה את מצב התחנה. אין חלון הדפסה בדפדפן – מדבקות לא מושפעות.
   עוזר ההדפסה: tools/edb-helper/edb-helper.ps1 (מאזין רק ל-127.0.0.1:17891, מקבל רק את כתובת האתר במחשב).
   סבב 3 (26.11.2026): ההדפסה אסינכרונית – POST /print מחזיר מזהה, ו-GET /job/<id> מחזיר state (printing / waiting / done / err) ו-code
     (paper-out, jam, door, ink, offline, paused, error…). חסר נייר / תקלה: העבודה לא מתבטלת – נשארת בתור של Windows וממשיכה לבד.
     התחנה מדווחת למסמך העבודה (taken → taken: msg, code, ts), ומציגה חלון בולט מעל כל מסך (גם מסך המדבקות; לא מודפס).
     בטלפון: חלון המצב, ואם יצאו ממנו – פס בראש האפליקציה. "הודפס בהצלחה" / כישלון נשארים עד "אישור"; האישור נפרד לכל צד
     (ackA – השולח, ackS – התחנה). הודעה אחת בכל רגע – החדשה ביותר. מפתחות במכשיר: lp-edb-cur-job (העבודה שבהדפסה, לחידוש אחרי רענון),
     lp-edb-ov (הודעות התחנה שלא אושרו), lp-edb-mine|<עסק>|<משתמש> (העבודות ששלחתי ועוד לא אישרתי). */
(function(root){
'use strict';
if(typeof window==='undefined'||typeof ACT==='undefined')return;
const PRNK='lp-edb-prn',DEF={on:false,name:'L130',port:'17891'},MAXB=30*1024*1024,DAY=864e5;
// הפורט קבוע (17891): הגדרות האבטחה של האתר (CSP ב-firebase.json) מתירות פנייה רק ל-http://127.0.0.1:17891. פורט אחר דורש גם שינוי שם
const cfg=()=>{try{const o=JSON.parse(localStorage.getItem(PRNK)||'null')||{};return{on:o.on===true,name:String(o.name==null?DEF.name:o.name).slice(0,80),port:DEF.port}}catch(e){return Object.assign({},DEF)}};
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
// מחזיר מיד אחרי שהעוזר קיבל את העמודים: {ok, job (מזהה אצל העוזר), pr}. ההדפסה עצמה נמשכת – מעקב ב-hJob
async function hPrint(p,pages,name){const q='/print?p='+encodeURIComponent(p.name||'')+'&s='+pages.map(b=>b.size).join(',')+'&name='+encodeURIComponent(String(name||'edible').slice(0,40));
 const r=await hFetch(hUrl(p,q),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:new Blob(pages,{type:'application/octet-stream'})},180000);
 if(r.ok&&/^[0-9a-f]{18}$/.test(String(r.j.job||'')))return{ok:true,job:r.j.job,pr:String(r.j.printer||'')};
 if(r.ok)return{ok:false,msg:'עוזר ההדפסה במחשב ישן – מעתיקים את הגרסה החדשה של edb-helper.ps1'};
 return{ok:false,msg:r.down?'עוזר ההדפסה לא עונה במחשב':(HE[r.j.err]||'שגיאה בעוזר ההדפסה')+(r.j.err==='no-printer'&&p.name?' (מחפש "'+p.name+'")':'')}}
const hJob=(p,id)=>hFetch(hUrl(p,'/job/'+id),{method:'GET'},20000);
/* מצבי המדפסת: כותרת (t) ומה לעשות (d). ההתנהגות של כפתור הנייר ב-L130 – לפי ההוראות הכלליות של Epson (לא נבדק במדפסת עצמה) */
const PS={spool:{t:'שולח למדפסת…'},printing:{t:'מדפיס עכשיו…',d:'אפשר להמשיך לעבוד כרגיל.'},
 'paper-out':{t:'חסר נייר במדפסת',d:'הכניסו דף אכיל למדפסת – ההדפסה תמשיך לבד. אם היא לא ממשיכה תוך כמה שניות: לחצו על כפתור הנייר במדפסת (הכפתור עם סמל הדף).'},
 jam:{t:'נייר תקוע במדפסת',d:'הוציאו בעדינות את הדף התקוע, ואז לחצו על כפתור הנייר במדפסת. ההדפסה תמשיך לבד.'},
 door:{t:'מכסה המדפסת פתוח',d:'סגרו את המכסה – ההדפסה תמשיך לבד.'},
 ink:{t:'נגמר הדיו במדפסת',d:'מלאו דיו לפי ההוראות של Epson – ההדפסה תמשיך אחרי זה.'},
 offline:{t:'המדפסת כבויה או מנותקת',d:'הדליקו את המדפסת ובדקו שכבל ה-USB מחובר למחשב. ההדפסה תמשיך לבד כשהמדפסת תחזור.'},
 paused:{t:'ההדפסה מושהית במחשב',d:'בתור ההדפסה של Windows לחצו "המשך" (Resume).'},
 error:{t:'תקלה במדפסת',d:'בדקו את המדפסת ואת חלון ההודעות של Epson במחשב. ההדפסה תמשיך לבד כשהתקלה תתוקן.'},
 done:{t:'הודפס בהצלחה'},cancelled:{t:'ההדפסה בוטלה בתור ההדפסה של Windows',d:'אם צריך – שלחו שוב.'},
 timeout:{t:'ההדפסה בוטלה: התקלה לא תוקנה במשך שעתיים',d:'תקנו את המדפסת ושלחו שוב.'},
 'print-failed':{t:'ההדפסה נכשלה במחשב',d:'שלחו שוב. אם זה חוזר – בדקו את המדפסת.'},
 lost:{t:'עוזר ההדפסה הפסיק לענות באמצע ההדפסה',d:'בדקו במדפסת אם הדף יצא. אם לא – הפעילו את edb-helper.bat ושלחו שוב.'}};
const WAITC=['paper-out','jam','door','ink','offline','paused','error'];
// ההודעה שנשמרת במסמך העבודה (עד 200 תווים). בתקלה כללית – גם הטקסט המקורי של Windows
const mtxt=(code,raw)=>{const t=(PS[code]||PS.error).t;return(code==='error'&&raw?t+' (Windows: '+String(raw).replace(/[\u0000-\u001f]/g,' ')+')':t).slice(0,200)};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const lsJ=(k,d)=>{try{const v=JSON.parse(localStorage.getItem(k)||'null');return v==null?d:v}catch(e){return d}};
const lsW=(k,v)=>{try{if(v==null)localStorage.removeItem(k);else localStorage.setItem(k,JSON.stringify(v))}catch(e){}};

/* ---------- התחנה (edbs/main) – לטלפון ---------- */
let SN={t:0,v:null};
async function stn(force){if(!ok())return null;if(!force&&Date.now()-SN.t<60000)return SN.v;let v=null;
 try{const d=await fsx('/edbs/main');v=d&&d.fields?dec(d):null}catch(e){if(!e||e.code!==404)return SN.v}SN={t:Date.now(),v};return v}
const stnOn=v=>!!(v&&v.on===true);
const stnTxt=v=>!stnOn(v)?'':'תחנת הדפסה במחשב: '+(v.hp===false?'עוזר ההדפסה לא ענה':'פעילה')+', עדכון אחרון '+ago(+v.at||0);

/* ---------- שליחה מהטלפון לתחנה ---------- */
const ST={up:'שולח למחשב…',new:'נשלח – ממתין למחשב',taken:'מודפס עכשיו במחשב…',done:'הודפס בהצלחה',err:'ההדפסה נכשלה'};
const fin_=st=>st==='done'||st==='err';
// מצב לתצוגה (טלפון ותחנה): {lv: ok|run|warn|bad, t: כותרת, m: הודעה, d: מה לעשות}
function view(j){const c=String(j.code||''),P=PS[c];
 if(j.st==='done')return{lv:'ok',t:'הודפס בהצלחה',m:j.msg&&!/^הודפס/.test(j.msg)?j.msg:'',d:''};
 if(j.st==='err')return{lv:'bad',t:'ההדפסה נכשלה',m:j.msg||'',d:P&&P.d||''};
 if(j.st==='taken'&&WAITC.includes(c))return{lv:'warn',t:j.msg||(P||PS.error).t,m:'',d:(P||PS.error).d};
 return{lv:'run',t:ST[j.st]||j.st,m:j.st==='taken'&&c==='spool'?PS.spool.t:'',d:''}}
const LVC={ok:'#2fae5b',run:'var(--acc)',warn:'#e6a21a',bad:'#e0483e'};
let JB=null;
const jHtml=()=>{const j=JB;if(!j)return'';const v=view(j);
 return `<p style="font-size:1.25rem;font-weight:800;color:${LVC[v.lv]}">${esc(v.t)}</p>${v.m?`<p>${esc(v.m)}</p>`:''}${v.d?`<p class="note" style="font-size:1rem">${esc(v.d)}</p>`:''}${j.st==='up'&&j.pg?`<p class="note">עמוד ${j.pg} מתוך ${j.n}</p>`:''}${j.st==='new'&&j.hint?`<p class="note">${esc(j.hint)}</p>`:''}
<div class="row" style="gap:8px">${j.st==='up'||j.st==='new'?'<button class="btn g grow" data-a="edbQx">ביטול השליחה</button>':''}${fin_(j.st)?`<button class="btn grow" data-a="edbAckA" data-v="${esc(j.id)}">אישור</button>`:'<button class="btn grow" data-a="closeDlg">סגירה</button>'}</div>`};
// חלון המצב פתוח? (#edbJs נשאר בתוך החלון גם אחרי שנסגר)
const jsOpen=()=>{const e=document.getElementById('edbJs'),d=e&&e.closest('dialog');return!!e&&(!d||d.open)};
const jShow=()=>{const e=document.getElementById('edbJs');if(e)e.innerHTML=jHtml();bn();return jsOpen()};
// השולח (up/new → err): st, msg. התחנה: גם code ו-ts (החוקים: רק מי שתפס)
async function jSet(id,st,msg,code){const f={st};if(msg)f.msg=String(msg).slice(0,200);if(code){f.code=code;f.ts=Date.now()}return fsx('/edbq/'+id+'?'+mask(Object.keys(f))+'&currentDocument.exists=true',{method:'PATCH',body:JSON.stringify({fields:fld(f)})})}
const jAck=(id,k)=>fsx('/edbq/'+id+'?'+mask([k])+'&currentDocument.exists=true',{method:'PATCH',body:JSON.stringify({fields:fld({[k]:true})})});

/* ---------- העבודות ששלחתי (טלפון): רשימה במכשיר עד "אישור", פס בראש האפליקציה כשחלון המצב סגור ---------- */
const mineK=()=>'lp-edb-mine|'+String(SY&&SY.bizId||'')+'|'+String(SY&&SY.uid||'');
const mine=()=>{const L=lsJ(mineK(),[]);return Array.isArray(L)?L.filter(x=>x&&typeof x.id==='string'):[]};
const mineW=L=>lsW(mineK(),L.length?L.slice(-10):null);
function mineUp(o){const L=mine(),i=L.findIndex(x=>x.id===o.id);if(i<0)L.push(Object.assign({t:Date.now()},o));else L[i]=Object.assign(L[i],o);mineW(L);return L}
// הודעה בולטת: popover (שכבה עליונה, לא חוסם את המסך), ובדפדפן ישן – div קבוע. לא מודפס
function box(id,html,top){let e=document.getElementById(id);
 if(!html){if(e){try{e.hidePopover&&e.matches(':popover-open')&&e.hidePopover()}catch(x){}e.remove()}return null}
 if(!e){e=document.createElement('div');e.id=id;e.setAttribute('role','alert');e.dir='rtl';
  const pop=typeof e.showPopover==='function';if(pop)e.setAttribute('popover','manual');
  const s=document.createElement('style');s.textContent='@media print{#'+id+'{display:none!important}}';document.head.appendChild(s);document.body.appendChild(e)}
 e.style.cssText='position:fixed;inset:auto;margin:0;left:50%;transform:translateX(-50%);z-index:2147483001;box-sizing:border-box;color:var(--ink,#111);background:var(--card,#fff);border:2px solid var(--line,#888);border-radius:16px;box-shadow:0 8px 32px #0009;padding:14px 16px;text-align:start;overflow:auto;max-height:80vh;'+top;
 e.innerHTML=html;
 try{if(e.showPopover){if(e.matches(':popover-open'))e.hidePopover();e.showPopover()}}catch(x){} // מוצג מחדש – מעל חלון שנפתח אחריו
 return e}
const boxHtml=(v,extra,btns)=>`<div style="border-inline-start:6px solid ${LVC[v.lv]};padding-inline-start:12px"><div style="font-size:.85rem;opacity:.8">הדפסת דף אכיל${extra?' · '+esc(extra):''}</div><div style="font-size:1.35rem;font-weight:800;color:${LVC[v.lv]};margin:2px 0 4px">${esc(v.t)}</div>${v.m?`<div style="font-size:1.05rem">${esc(v.m)}</div>`:''}${v.d?`<div style="font-size:1.05rem;margin-top:4px">${esc(v.d)}</div>`:''}<div style="display:flex;gap:8px;margin-top:10px">${btns}</div></div>`;
// הפס בטלפון: העבודה החדשה ביותר שלא אושרה, כשחלון המצב שלה לא פתוח
function bn(){if(typeof document==='undefined'||!SY||!SY.uid){box('edbBn','');return}
 const L=mine().sort((a,b)=>(b.t||0)-(a.t||0)),open=jsOpen()&&JB?JB.id:'';
 const j=L.find(x=>x.id!==open);if(!j){box('edbBn','');return}
 const v=view(j),more=L.filter(x=>x.id!==open).length-1;
 box('edbBn',boxHtml(v,j.name||'',(fin_(j.st)?`<button class="btn grow" data-a="edbAckA" data-v="${esc(j.id)}">אישור</button>`:`<button class="btn g grow" data-a="edbJOpen" data-v="${esc(j.id)}">פרטים</button>`)+(more>0?`<span class="note" style="align-self:center">ועוד ${more}</span>`:'')),'top:calc(env(safe-area-inset-top,0px) + 8px);width:min(560px,96vw);')}
ACT.edbAckA=async el=>{const id=el&&el.dataset.v;if(!id)return;const L=mine().filter(x=>x.id!==id);mineW(L);
 if(JB&&JB.id===id){JB=null;if(jsOpen())closeDlg()}bn();try{await jAck(id,'ackA')}catch(e){}};
ACT.edbJOpen=el=>{const j=mine().find(x=>x.id===(el&&el.dataset.v));if(!j)return;JB=Object.assign({},j);dlg(`<h3>שליחה למחשב – ${esc(j.name||'דף אכיל')}</h3><div id="edbJs">${jHtml()}</div>`);bn()};
// מעקב ברקע אחרי העבודות ששלחתי (כל 3 שניות כשחלון המצב פתוח, אחרת כל 6), עד סיום; עד 3 שעות לעבודה
let MT=0;
async function mineTick(){clearTimeout(MT);let wait=6000;
 try{if(!ok()){wait=30000;return}const L=mine(),act=L.filter(x=>!fin_(x.st)&&x.st!=='up'&&Date.now()-(x.t||0)<3*3600e3).sort((a,b)=>(b.t||0)-(a.t||0)).slice(0,3);
  if(!act.length){bn();wait=30000;return}if(document.hidden){wait=15000;return}
  for(const x of act){let d=null;try{d=await fsx('/edbq/'+x.id)}catch(e){if(e&&e.code===404){mineW(mine().filter(y=>y.id!==x.id));continue}}
   const j=d&&d.fields?dec(d):null;if(!j)continue;
   if(j.ackA===true){mineW(mine().filter(y=>y.id!==x.id));continue} // אושר כבר במכשיר אחר
   mineUp({id:x.id,st:j.st,code:j.code||'',msg:j.msg||''});if(JB&&JB.id===x.id){Object.assign(JB,{st:j.st,code:j.code||'',msg:j.msg||''});jShow()}}
  bn();if(jsOpen())wait=3000}
 catch(e){wait=15000}finally{MT=setTimeout(mineTick,wait)}}
setTimeout(mineTick,5000);
// סגירת חלון המצב → הפס מופיע מיד
setTimeout(()=>{const d=document.getElementById('dlg');if(d&&d.addEventListener)d.addEventListener('close',()=>setTimeout(bn,0))},0);
async function stDel(id,n){const t=await tok();for(let i=0;i<n;i++){try{await fetch(STB()+'/'+encodeURIComponent(fp(id,i)),{method:'DELETE',headers:{Authorization:'Firebase '+t}})}catch(e){}}}
// pages: Blob[] (PNG). מחזיר מיד אחרי שהחלון נפתח; המצב מתעדכן בחלון
async function send(pages,name){if(!ok())throw new Error('אין הרשאה');if(!pages||!pages.length||pages.length>10)throw new Error('אין עמודים');
 if(pages.some(b=>!b||b.size>MAXB))throw new Error('תמונת העמוד גדולה מדי');
 const id=rid(),n=pages.length,s=await stn();JB={id,n,name:String(name||'דף אכיל').slice(0,40),st:'up',pg:0,hint:s&&s.hp===false?'עוזר ההדפסה במחשב לא ענה לאחרונה – כדאי לבדוק שהמחשב פועל':''};
 dlg(`<h3>שליחה למחשב – ${esc(name||'דף אכיל')}</h3><div id="edbJs">${jHtml()}</div>`);
 try{await fsx('/edbq?documentId='+id,{method:'POST',body:JSON.stringify({fields:fld({by:SY.uid,at:Date.now(),st:'up',n})})})}
 catch(e){JB.st='err';JB.msg=e.offline?'אין חיבור לאינטרנט':'לא נשמר ('+(e.message||e)+')';jShow();return}
 try{const t=await tok();for(let i=0;i<n;i++){if(!JB||JB.id!==id||JB.st!=='up')return;JB.pg=i+1;jShow();let r;
   try{r=await fetch(STB()+'?uploadType=media&name='+encodeURIComponent(fp(id,i)),{method:'POST',headers:{Authorization:'Firebase '+t,'Content-Type':'image/png'},body:pages[i]})}catch(e){throw new Error('אין חיבור לאינטרנט')}
   if(!r.ok)throw new Error(r.status===403?'אין הרשאה להעלות':'ההעלאה נכשלה ('+r.status+')')}
  await jSet(id,'new');mineUp({id,n,name:JB?JB.name:'',st:'new'});if(JB&&JB.id===id){JB.st='new';jShow()}}
 catch(e){const m=e&&e.message||String(e);try{await jSet(id,'err',m)}catch(e2){}stDel(id,n);if(JB&&JB.id===id){JB.st='err';JB.msg=m;jShow()}return}
 MT=setTimeout(mineTick,3000)}
// ביטול בידי השולח: אין צורך באישור – העבודה יוצאת מהרשימה
ACT.edbQx=async()=>{const j=JB;if(!j||(j.st!=='up'&&j.st!=='new'))return;const was=j.st;j.st='err';j.msg='בוטל';jShow();
 if(was==='new'){try{await jSet(j.id,'err','בוטל');stDel(j.id,j.n);mineW(mine().filter(x=>x.id!==j.id));bn()}catch(e){toast('הביטול נכשל – אולי המחשב כבר התחיל להדפיס');j.st='new';jShow()}}
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
/* ---------- הודעות בתחנה: חלון בולט מעל כל מסך (גם מסך המדבקות), עד "אישור". נשמר במכשיר – נשאר גם אחרי רענון ----------
   פריט: {k (מפתח), id (מסמך בענן; ריק בהדפסה ישירה מהמחשב), st, code, msg, t, nm}. מוצג הפריט החדש ביותר; בזמן הדפסה רגילה אפשר "הסתרה" */
const OVK='lp-edb-ov',CURK='lp-edb-cur-job';
const ovL=()=>{const L=lsJ(OVK,[]);return Array.isArray(L)?L.filter(x=>x&&x.k):[]};
let OVH='';
function ovUp(o){const L=ovL(),i=L.findIndex(x=>x.k===o.k);if(i<0)L.push(Object.assign({t:Date.now()},o));else L[i]=Object.assign(L[i],o);lsW(OVK,L.slice(-10));ov()}
function ov(){const L=ovL().sort((a,b)=>(b.t||0)-(a.t||0)),j=L[0];
 if(!j||!cfg().on){box('edbOv','');return}
 const sig=j.k+'|'+j.st+'|'+j.code;if(OVH===sig&&!fin_(j.st)&&!WAITC.includes(j.code)){box('edbOv','');return}
 const v=view(j),more=L.length-1;
 box('edbOv',boxHtml(v,(j.id?'נשלח מטלפון':'מהמחשב הזה')+(j.nm?' · '+j.nm:''),(fin_(j.st)?`<button class="btn grow" data-a="edbAckS" data-v="${esc(j.k)}" style="min-height:52px;font-size:1.15rem">אישור</button>`:WAITC.includes(j.code)?'':`<button class="btn g grow" data-a="edbOvH" data-v="${esc(sig)}">הסתרה</button>`)+(more>0?`<span class="note" style="align-self:center">ועוד ${more}</span>`:'')),'top:12px;width:min(600px,94vw);border:4px solid '+LVC[v.lv]+';')}
ACT.edbAckS=async el=>{const k=el&&el.dataset.v,j=ovL().find(x=>x.k===k);lsW(OVK,ovL().filter(x=>x.k!==k));ov();if(j&&j.id){try{await jAck(j.id,'ackS')}catch(e){}}};
ACT.edbOvH=el=>{OVH=el&&el.dataset.v||'';ov()};

/* ---------- מעקב אחרי עבודה אצל העוזר (GET /job/<id>), עד done / err ----------
   J: {k, id (מסמך בענן או ריק), n, hid, nm}. דיווח לענן רק כשהמצב משתנה. העוזר לא עונה ~2 דקות / לא מכיר את העבודה – err (lost) */
async function follow(c,J){let last='',fails=0;
 for(;;){await sleep(3000);const r=await hJob(c,J.hid);
  if(!r.ok){if(r.st===404||++fails>=40)return fin(J,'err','lost',PS.lost.t);continue}
  fails=0;const x=r.j,code=PS[x.code]?x.code:'error';
  if(x.state==='done')return fin(J,'done','done','הודפס בהצלחה'+(x.printer?' ב-'+String(x.printer).slice(0,60):''));
  if(x.state==='err')return fin(J,'err',code,mtxt(code,x.raw));
  const msg=x.state==='waiting'?mtxt(code,x.raw):(PS[code]||PS.printing).t;
  if(code+'|'+msg!==last){last=code+'|'+msg;ovUp({k:J.k,st:'taken',code,msg});W.err=x.state==='waiting'?msg:'';dot();
   if(J.id){try{await fsx('/edbq/'+J.id+'?'+mask(['msg','code','ts'])+'&currentDocument.exists=true',{method:'PATCH',body:JSON.stringify({fields:fld({msg,code,ts:Date.now()})})})}catch(e){}}}
  beat()}}
async function fin(J,st,code,msg){if(J.id){try{await jSet(J.id,st,msg,code)}catch(e){}stDel(J.id,J.n)}
 ovUp({k:J.k,st,code,msg});lsW(CURK,null);W.busy=0;W.err='';
 if(st==='done')W.last='הודפס '+new Date().toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'});dot()}
async function one(c,d){const j=dec(d.document),id=j.id,n=Math.max(1,Math.min(10,+j.n||1));
 if(!(+j.at>Date.now()-DAY)){try{await jSet(id,'err','פג תוקף – לא הודפס תוך 24 שעות')}catch(e){}return}
 // תפיסה אטומית: רק אם המסמך לא השתנה מאז הקריאה (ובחוקים: רק מ-'new')
 try{await fsx('/edbq/'+id+'?'+mask(['st','tk','msg'])+'&currentDocument.updateTime='+encodeURIComponent(d.document.updateTime),{method:'PATCH',body:JSON.stringify({fields:fld({st:'taken',tk:SY.uid,msg:'המחשב מדפיס'})})})}catch(e){return}
 const J={k:id,id,n,hid:'',nm:''};W.busy=1;dot();lsW(CURK,J);ovUp({k:id,id,st:'taken',code:'spool',msg:PS.spool.t});let res;
 try{const t=await tok(),pages=[];
  for(let i=0;i<n;i++){const r=await fetch(STB()+'/'+encodeURIComponent(fp(id,i))+'?alt=media',{headers:{Authorization:'Firebase '+t}});if(!r.ok)throw new Error('הורדת העמוד נכשלה ('+r.status+')');pages.push(await r.blob())}
  res=await hPrint(c,pages,'edible-'+id.slice(0,6))}
 catch(e){res={ok:false,msg:e&&e.message||String(e)}}
 if(!res.ok)return fin(J,'err','print-failed',res.msg);
 J.hid=res.job;lsW(CURK,J);ovUp({k:id,code:'printing',msg:PS.printing.t});
 try{await fsx('/edbq/'+id+'?'+mask(['msg','code','ts'])+'&currentDocument.exists=true',{method:'PATCH',body:JSON.stringify({fields:fld({msg:PS.printing.t,code:'printing',ts:Date.now()})})})}catch(e){}
 return follow(c,J)}
// הדפסה ישירה מהמחשב הזה (התחנה עצמה): העמודים לעוזר, ואז מעקב ברקע עם אותו חלון הודעות (בלי ענן)
async function local(pages,name){const c=cfg();if(W.busy)throw new Error('המדפסת עסוקה בהדפסה אחרת – נסו שוב בעוד רגע');
 W.busy=1;dot();let r;try{r=await hPrint(c,pages,name)}catch(e){r={ok:false,msg:e&&e.message||String(e)}}
 if(!r.ok){W.busy=0;dot();throw new Error(r.msg)}
 const J={k:'L'+r.job,id:'',n:pages.length,hid:r.job,nm:''};lsW(CURK,J);ovUp({k:J.k,st:'taken',code:'printing',msg:PS.printing.t});
 follow(c,J).catch(()=>{W.busy=0});return r}
// אחרי רענון / כיבוי באמצע הדפסה: ממשיכים לעקוב (או מסמנים כישלון אם העמודים עוד לא נשלחו לעוזר)
let RES=0;
async function resume(c){if(RES)return;RES=1;const J=lsJ(CURK,null);if(!J||!J.k)return;
 if(J.id){let d=null;try{d=await fsx('/edbq/'+J.id)}catch(e){}const j=d&&d.fields?dec(d):null;if(!j||j.st!=='taken'||j.tk!==SY.uid){lsW(CURK,null);return}}
 W.busy=1;dot();if(!J.hid)return fin(J,'err','print-failed','ההדפסה נקטעה במחשב (רענון או כיבוי) לפני שנשלחה למדפסת – שלחו שוב');
 return follow(c,J)}
async function tick(){let wait=15000;
 try{const c=cfg();dot();ov();if(!c.on||!ok()){W.err='';return}
  if(navigator.onLine===false){W.err='אין חיבור לאינטרנט';wait=30000;return}
  if(W.busy){wait=5000;return} // הדפסה ישירה מהמחשב במעקב
  const h=await hStatus(c);W.hp=h.ok;W.pr=h.ok?String(h.j.chosen||''):W.pr;W.err=h.ok?(h.j.chosen?'':'מדפסת "'+c.name+'" לא נמצאה במחשב'):'עוזר ההדפסה לא עונה';dot();beat();
  if(!h.ok||!h.j.chosen){wait=30000;return}
  if(!RES){await resume(c);wait=1000;return}
  const r=await fsx(':runQuery',{method:'POST',body:JSON.stringify({structuredQuery:{from:[{collectionId:'edbq'}],where:{fieldFilter:{field:{fieldPath:'st'},op:'EQUAL',value:{stringValue:'new'}}},limit:10}})});
  const L=(r||[]).filter(x=>x&&x.document).sort((a,b)=>(+fvj(a.document.fields.at)||0)-(+fvj(b.document.fields.at)||0));
  if(L.length){await one(c,L[0]);if(L.length>1)wait=1000}}
 catch(e){W.busy=0;wait=60000}
 finally{dot();clearTimeout(W.t);W.t=setTimeout(tick,wait)}}
setTimeout(tick,8000);
function setCfg(o){const was=cfg().on;cfgSet(Object.assign({},o,{port:DEF.port}));dot();ov();if(o.on!==was||o.on){W.hbOn=null;beat(true)}clearTimeout(W.t);W.t=setTimeout(tick,1000)}

root.EdbSt={cfg,setCfg,ok,stn,stnOn,stnTxt,send,local,hStatus,hPrint,hJob,HE,PS,view,mtxt,W,DEF};
})(typeof window!=='undefined'?window:globalThis);
