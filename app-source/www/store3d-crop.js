/* הקמת חנות – שלב 4 (משימה 2026-11-17_תהליך-הקמת-חנות): עורך "חיבור וחיתוך" לפריט במסך "צילום החנות".
   נטען אחרי store3d-warp.js ו-store3d-setupcap.js. נקודת חיבור אחת למסך הצילום: U.wpBtn(it,s) – כפתור בכרטיס הפריט.
   לכל תמונה של הפריט (עד 6 לכל גובה): 4 פינות (quad, גוררים באצבע) + איזה טווח לאורך הפריט היא מכסה (xr, משמאל לימין).
   ברירת מחדל: מה שה-AI יחזיר בשלב 5 (ph[].quad/xr מהשרת), ואם אין – כל התמונה וחלוקה שווה. העורך זמין תמיד, גם אחרי AI.
   "בנו חזית" מיישר ומחבר בטלפון (S3Warp, תמונה מפוענחת אחת בכל רגע), מסמן "חסר קטע" לפי הפיקסלים שבאמת נכנסו,
   ו"אשרו חזית" שולח אותה (s3CapPut op front, man:true, עד 2048px) – רק כשאין קטע חסר. אין כאן AI ואין העלאת צילומים (שלב 3 עושה).
   שלב 4ב: התיקונים הידניים (פינות/טווח רוחב/טווח גובה) נשמרים בשרת ב-ph[n] (s3CapPut op geo) דרך תור השליחה של הטלפון (U.geoAdd,
   עובד גם בלי רשת): בכפתור "שמרו תיקונים", ב"בנו חזית" ובסגירה. תמונה שעוד לא נשלחה (בלי n) – נשמרת אחרי שתישלח. "הוציאו מהחזית" – בזיכרון בלבד. */
(function(){
'use strict';
const U=window.S3UI,WP=window.S3Warp,K=U&&U.K3;
if(!U||!WP||!K||typeof ACT==='undefined'||typeof INP==='undefined')return;
const esc2=U.esc2,GOLD='#d4a017',BAD='var(--bad)';
const FRONT_MAX=1450000,TH_MAX=145000;
/* ---------- תמונות מהצילום הנוכחי (בלי להוריד שוב מהשרת) ----------
   עוטפים את U.capAdd (התור של store3d-capture.js) ואת U.onCap (התשובה) – בלי לשנות את הקבצים שלהם.
   נשמרות רק תמונות של 3 הפריטים האחרונים, כדי שהזיכרון לא יגדל לאורך הקמה של מאות פריטים. */
const SES=new Map(),KEEP=3;let SEQ=0;
const sk=(m,k)=>m+'|'+k;
{const a0=U.capAdd;if(typeof a0==='function')U.capAdd=async rec=>{let k='',s=null;
  try{if(rec&&rec.mapId&&rec.key&&rec.img){k=sk(rec.mapId,rec.key);const L=SES.get(k)||[];SES.delete(k);rec=Object.assign({},rec,{wpId:++SEQ});s={sid:rec.wpId,lv:rec.lv||'a',full:rec.img,th:rec.th,w:rec.w,h:rec.h,pi:null};L.push(s);SES.set(k,L.slice(-12));
   while(SES.size>KEEP)SES.delete(SES.keys().next().value)}}catch(e){}
  /* נרשם לפני השליחה (התשובה יכולה להגיע מהר); אם השמירה בתור נכשלה – מוציאים */
  try{return await a0(rec)}catch(e){const L=k&&SES.get(k);if(L&&s){const i=L.indexOf(s);if(i>=0)L.splice(i,1)}throw e}}}
{const o0=U.onCap;U.onCap=(r,x,err)=>{try{if(r&&x&&Number.isInteger(x.ph)&&x.ph>0){const L=SES.get(sk(r.mapId,r.key));const s=L&&L.find(p=>p.sid===r.wpId&&p.pi===null);if(s)s.pi=x.ph-1}}catch(e){}
  return typeof o0==='function'?o0(r,x,err):undefined}}

/* ---------- מצב העורך ---------- */
const C={key:'',sel:0,res:null,busy:0,msg:'',url:{},ed:{},qid:'',tok:0};
const itemOf=k=>K.plan&&K.plan.items.find(i=>i.key===k)||null;
/* רשימת התמונות של הפריט: מהשרת (ph, לפי הסדר) + מה שעוד בתור. תמונה שצולמה עכשיו – מהזיכרון */
function photos(key){
 const d=K.docs[key]||{},sv=Array.isArray(d.ph)?d.ph:[],S=SES.get(sk(K.mapId,key))||[],out=[];
 sv.forEach((p,i)=>{if(!p||typeof p!=='object')return;const s=S.find(x=>x.pi===i);
  out.push({id:s?'s'+s.sid:'n'+p.n,n:p.n,lv:p.lv||'a',w:p.w|0||(s&&s.w)|0,h:p.h|0||(s&&s.h)|0,p:p.p,thP:p.th,full:s&&s.full,th:s&&s.th,quad:p.quad,xr:p.xr,yr:p.yr,off:p.off===true})});
 for(const s of S)if(s.pi===null||s.pi>=sv.length)out.push({id:'s'+s.sid,lv:s.lv,w:s.w|0,h:s.h|0,full:s.full,th:s.th,pend:true});
 const E=C.ed[key]||{};for(const p of out){const e=E[p.id];if(e){if(e.quad)p.quad=e.quad;if(e.xr)p.xr=e.xr;if(e.yr)p.yr=e.yr;if(e.off!==undefined)p.off=e.off}}
 /* טווח לכל תמונה: מה שנשמר/נערך, אחרת חלוקה שווה בין התמונות שבשימוש באותו גובה */
 const use=out.filter(p=>!p.off),dx=WP.defXr(use.filter(p=>!WP.xrOk(p.xr)));
 for(const p of out){if(!WP.quadOk(p.quad))p.quad=WP.FULLQ.slice();if(!WP.xrOk(p.xr))p.xr=dx.get(p)||{a:0,b:1000};
  /* מדף גבוה: טווח גובה (yr, אלפיות מלמעלה). ברירת מחדל חצי/חצי; כדאי חפיפה כדי שהתפר יתיישר */
  if((p.lv==='t'||p.lv==='b')&&!WP.yrOk(p.yr))p.yr=p.lv==='t'?{a:0,b:500}:{a:500,b:1000}}
 return out}
/* תיקונים שעוד לא נשמרו בשרת (רק לתמונה שיש לה n – כבר בשרת) */
const GF=['quad','xr','yr'];
const dirty=key=>{const E=C.ed[key]||{};return photos(key).filter(p=>Number.isInteger(p.n)&&E[p.id]&&GF.some(f=>E[p.id][f]))};
const r1k=v=>Math.min(1000,Math.max(0,Math.round(+v||0)));
async function saveGeo(key){
 const L=dirty(key);if(!L.length||typeof U.geoAdd!=='function')return 0;
 const E=C.ed[key],d=K.docs[key];let n=0;
 for(const p of L){const e=E[p.id],rec={mapId:K.mapId,key,n:p.n};
  if(e.quad&&WP.quadOk(e.quad))rec.quad=e.quad.map(r1k);
  for(const f of ['xr','yr'])if(e[f]){const a=r1k(e[f].a),b=r1k(e[f].b);if(a<b)rec[f]={a,b}}
  if(rec.quad||rec.xr||rec.yr){try{await U.geoAdd(rec)}catch(x){continue}n++;
   /* מעדכנים גם את העותק בטלפון, כדי שהעורך ייפתח שוב עם אותם ערכים */
   if(d&&Array.isArray(d.ph))d.ph=d.ph.map(q=>q&&q.n===p.n?Object.assign({},q,rec.quad?{quad:rec.quad}:{},rec.xr?{xr:rec.xr}:{},rec.yr?{yr:rec.yr}:{}):q)}
  for(const f of GF)delete e[f]}
 return n}
const edit=(id,o)=>{const E=C.ed[C.key]=C.ed[C.key]||{};E[id]=Object.assign(E[id]||{},o);C.res=null;C.qid='';
 const b=document.querySelector('#dlg [data-a=s3wpGeo]');if(b)b.disabled=!dirty(C.key).length};
/* יחס רוחב/גובה אמיתי של הפריט מהמפה (ס"מ) */
function aspectOf(it){const m=K.map||{},g=it.geo||[],len=Math.hypot((g[2]||0)-(g[0]||0),(g[3]||0)-(g[1]||0));
 const room=(m.rooms||[]).find(r=>r&&r.id===it.room)||{};
 if(it.k==='b'){const f=(m.fx||[]).find(x=>x&&x.id===it.ref)||{};return len/((f.h|0)||180)}
 if(it.k==='w'||it.k==='iw')return len/((room.h|0)||300);
 if(it.k==='fl'||it.k==='ce')return(g[2]||1)/(g[3]||1);
 if(it.k==='d')return((g[2]|0)||90)/210;
 return 1.2}
/* תמונה מוקטנת לתצוגה: מהזיכרון או מ-Storage (abkSt), בלי כפילות */
function thUrl(p){if(p.th instanceof Blob){const k='b'+p.id;if(!C.url[k])C.url[k]=URL.createObjectURL(p.th);return C.url[k]}
 const path=p.thP;if(!path)return '';if(C.url[path]!==undefined)return C.url[path]||'';C.url[path]=null;
 if(typeof window.abkSt==='function'){const t=C.tok;window.abkSt('/'+encodeURIComponent(path)+'?alt=media').then(r=>r.blob()).then(b=>{if(t!==C.tok)return;C.url[path]=URL.createObjectURL(b);paint()}).catch(()=>{})}
 return ''}
function clearUrls(){for(const k in C.url)if(C.url[k])try{URL.revokeObjectURL(C.url[k])}catch(e){}C.url={}}
async function fullBlob(p){if(p.full instanceof Blob)return p.full;if(!p.p||typeof window.abkSt!=='function')throw new Error('no-src');const r=await window.abkSt('/'+encodeURIComponent(p.p)+'?alt=media');return await r.blob()}
/* פענוח (כולל כיוון EXIF) ← פיקסלים; משחררים מיד את התמונה והקנבס */
async function pixels(blob){const d=await U.decode(blob);try{const c=document.createElement('canvas');c.width=d.w;c.height=d.h;const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(d.src,0,0);
 const im=x.getImageData(0,0,d.w,d.h);c.width=c.height=0;return{w:im.width,h:im.height,data:im.data}}finally{d.close()}}
const pct=v=>Math.round(v/10)+'%';
const LVN={a:'',t:'עליון',b:'תחתון'};
const gapTx=(g,hi)=>`${hi&&g.lv?LVN[g.lv]+': ':''}<bdi dir="ltr">${pct(g.a)}–${pct(g.b)}</bdi>`;/* bdi: שהטווח לא יתהפך בעברית */

/* ---------- ציור ---------- */
function covBar(L,hi){const lvs=hi?['t','b']:['a'];let h='';
 for(const lv of lvs){const P=L.filter(p=>!p.off&&(hi?(p.lv==='t'?'t':'b'):'a')===lv);
  h+=`<div class="s3wpcv" dir="ltr" aria-hidden="true">${hi?`<em>${LVN[lv]}</em>`:''}${P.map(p=>`<i style="left:${p.xr.a/10}%;width:${(p.xr.b-p.xr.a)/10}%" class="${L.indexOf(p)===C.sel?'on':''}"></i>`).join('')}</div>`}
 return h}
function editor(L,it){
 const p=L[C.sel];if(!p)return '';const u=thUrl(p),ar=p.w&&p.h?p.h/p.w:.75,q=p.quad;
 const pts=[0,1,2,3].map(i=>[q[2*i]/1000*100,q[2*i+1]/1000*100*ar]);
 let h=`<div class="s3wped" style="aspect-ratio:${p.w||4}/${p.h||3}">${u?`<img src="${u}" alt="">`:'<div class="s3wpld">טוען תמונה…</div>'}
 <svg viewBox="0 0 100 ${100*ar}" preserveAspectRatio="none" data-wp="q" aria-label="גררו את 4 הפינות לקצוות החלק המצולם">
 <polygon points="${pts.map(x=>x.join(',')).join(' ')}" fill="${GOLD}" fill-opacity=".12" stroke="${GOLD}" stroke-width=".6" vector-effect="non-scaling-stroke"/>
 ${pts.map((x,i)=>`<circle data-c="${i}" cx="${x[0]}" cy="${x[1]}" r="3.2" fill="${GOLD}" stroke="#1b1b1f" stroke-width="2" vector-effect="non-scaling-stroke"/>`).join('')}</svg></div>`;
 h+=`<p class="note s3note">גררו את 4 הנקודות לפינות של ${it.k==='b'?'המקטע':'החלק'} בתמונה. מה שמחוץ למסגרת לא ייכנס.</p>`;
 h+=`<div class="s3wprg" dir="ltr"><label><span dir="rtl">מתחיל ב-<b data-wp="a">${pct(p.xr.a)}</b></span><input type="range" min="0" max="995" step="5" value="${p.xr.a}" data-i="s3wpA" aria-label="התמונה מתחילה ב (מצד שמאל)"></label>
 <label><span dir="rtl">נגמר ב-<b data-wp="b">${pct(p.xr.b)}</b></span><input type="range" min="5" max="1000" step="5" value="${p.xr.b}" data-i="s3wpB" aria-label="התמונה נגמרת ב (מצד שמאל)"></label></div>
 <p class="note s3note">איזה חלק מהאורך התמונה מכסה – משמאל (0%) לימין (100%), כפי שעומדים מול ${it.k==='b'?'המדף':'הקיר'}. כדאי חפיפה קטנה בין תמונות.</p>`;
 if(p.yr)h+=`<div class="s3wprg" dir="ltr"><label><span dir="rtl">גובה מ-<b data-wp="c">${pct(p.yr.a)}</b></span><input type="range" min="0" max="950" step="5" value="${p.yr.a}" data-i="s3wpC" aria-label="התמונה מתחילה בגובה (מלמעלה)"></label>
 <label><span dir="rtl">עד <b data-wp="d">${pct(p.yr.b)}</b></span><input type="range" min="50" max="1000" step="5" value="${p.yr.b}" data-i="s3wpD" aria-label="התמונה נגמרת בגובה (מלמעלה)"></label></div>
 <p class="note s3note">איזה חלק מהגובה התמונה מכסה – מלמעלה (0%) למטה (100%). כדאי שהעליונה והתחתונה יחפפו במדף אחד, כדי שהמערכת תיישר את התפר.</p>`;
 h+=`<div class="row s3row"><button class="btn" data-a="s3wpGeo" ${dirty(C.key).length?'':'disabled'}>שמרו תיקונים</button><button class="btn g" data-a="s3wpReset">כל התמונה</button><button class="btn g" data-a="s3wpOff">${p.off?'החזירו לחזית':'הוציאו מהחזית'}</button></div>`;
 return h}
function paint(){
 const it=itemOf(C.key);if(!it){closeDlg();return}
 const L=photos(C.key),hi=it.lv.length>1;if(C.sel>=L.length)C.sel=Math.max(0,L.length-1);
 let h=`<div class="s3wp2"><h3>חיבור וחיתוך – ${esc2(U.K3&&window.S3Plan?S3Plan.label(it,K.map):'')}</h3>`+(U.qtBanner?U.qtBanner('s'):'');
 if(!L.length)h+=`<p>עוד אין תמונות לפריט הזה. צלמו קודם.</p>`;
 else if(C.res){const r=C.res,miss=r.gaps.length>0;
  h+=`<div class="s3wppv" dir="ltr"><img src="${C.res.url}" alt="החזית המחוברת">${r.gaps.map(g=>`<i style="left:${g.a/10}%;width:${(g.b-g.a)/10}%;${hi?(g.lv==='t'?'top:0;height:50%':'top:50%;height:50%'):'top:0;height:100%'}"></i>`).join('')}</div>`;
  h+=miss?`<div class="ban s3warn" role="alert"><b>חסר קטע</b>: ${r.gaps.map(g=>gapTx(g,hi)).join(', ')} מאורך ${it.k==='b'?'המקטע':'החלק'} (משמאל). צלמו עוד תמונה של החלק הזה, או תקנו את הטווחים.</div>`
   :`<div class="s3info" role="status">החזית מלאה (${Math.round(r.cov*100)}% כיסוי, ${r.n} תמונות). בדקו שהיא נראית נכון ואשרו.</div>`;
  h+=`<div class="row s3row"><button class="btn" data-a="s3wpSave" ${miss||C.busy?'disabled':''}>אשרו חזית</button><button class="btn g" data-a="s3wpBack">חזרה לעריכה</button></div>`}
 else{
  h+=`<div class="s3wpst">${L.map((p,i)=>{const u=thUrl(p);return`<button type="button" data-a="s3wpSel" data-n="${i}" class="${i===C.sel?'on':''}${p.off?' off':''}" aria-label="תמונה ${i+1}${hi?' '+LVN[p.lv==='t'?'t':'b']:''}${p.off?' (לא בחזית)':''}">${u?`<img src="${u}" alt="">`:''}<span>${i+1}${hi?' '+LVN[p.lv==='t'?'t':'b']:''}</span></button>`}).join('')}</div>`;
  h+=covBar(L,hi)+editor(L,it);
  h+=`<div class="row s3row"><button class="btn" data-a="s3wpBuild" ${C.busy||!L.some(p=>!p.off)?'disabled':''}>בנו חזית</button><button class="btn g" data-a="s3wpClose">סגרו</button></div>`}
 if(C.msg)h+=`<div class="s3info" role="status">${esc2(C.msg)}</div>`;
 if(C.res)h+=`<div class="row s3row"><button class="btn g" data-a="s3wpClose">סגרו</button></div>`;
 dlg(h+'</div>');bindDrag();}
/* גרירת פינה: הנקודה הקרובה ביותר עד ~30px מהאצבע (יעד מגע גדול מהעיגול שרואים) */
function bindDrag(){
 const sv=document.querySelector('#dlg svg[data-wp=q]');if(!sv)return;
 let ci=-1;const L=photos(C.key),p=L[C.sel];if(!p)return;const q=p.quad.slice();
 const at=e=>{const r=sv.getBoundingClientRect();return[(e.clientX-r.left)/r.width*1000,(e.clientY-r.top)/r.height*1000,r]};
 const draw=()=>{const ar=p.h&&p.w?p.h/p.w:.75,pts=[0,1,2,3].map(i=>[q[2*i]/10,q[2*i+1]/10*ar]);sv.querySelector('polygon').setAttribute('points',pts.map(x=>x.join(',')).join(' '));
  sv.querySelectorAll('circle').forEach((c,i)=>{c.setAttribute('cx',pts[i][0]);c.setAttribute('cy',pts[i][1])})};
 sv.addEventListener('pointerdown',e=>{const[x,y,r]=at(e);let best=1e9;ci=-1;
  for(let i=0;i<4;i++){const d=Math.hypot((q[2*i]-x)/1000*r.width,(q[2*i+1]-y)/1000*r.height);if(d<best){best=d;ci=i}}
  if(best>30){ci=-1;return}e.preventDefault();try{sv.setPointerCapture(e.pointerId)}catch(_){}});
 sv.addEventListener('pointermove',e=>{if(ci<0)return;e.preventDefault();const[x,y]=at(e);q[2*ci]=Math.round(Math.min(1000,Math.max(0,x)));q[2*ci+1]=Math.round(Math.min(1000,Math.max(0,y)));draw()});
 const end=()=>{if(ci<0)return;ci=-1;if(WP.quadOk(q))edit(p.id,{quad:q.slice()});else{toast('הפינות לא יוצרות מסגרת תקינה – נסו שוב');paint()}};
 sv.addEventListener('pointerup',end);sv.addEventListener('pointercancel',end)}

/* ---------- פעולות ---------- */
U.wpBtn=(it,s)=>{if(!it||s==='skip')return '';const n=photos(it.key).length;return n?`<button class="btn g" data-a="s3wpOpen">חיבור וחיתוך (${n})</button>`:''};
ACT.s3wpOpen=()=>{if(K.busy)return;if(C.key!==K.cur){clearUrls();C.ed[K.cur]=C.ed[K.cur]||{}}C.tok++;C.key=K.cur;C.sel=0;C.res=null;C.msg='';C.busy=0;paint()};
ACT.s3wpSel=el=>{C.sel=+el.dataset.n||0;paint()};
ACT.s3wpReset=()=>{const p=photos(C.key)[C.sel];if(!p)return;edit(p.id,{quad:WP.FULLQ.slice()});paint()};
ACT.s3wpOff=()=>{const p=photos(C.key)[C.sel];if(!p)return;edit(p.id,{off:!p.off});paint()};
const rng=(which,el)=>{const p=photos(C.key)[C.sel];if(!p)return;const vert=which==='c'||which==='d',R0=vert?p.yr:p.xr;if(!R0)return;let a=R0.a,b=R0.b,v=Math.round(+el.value),gap=vert?50:5;
 if(which==='a'||which==='c')a=Math.min(v,b-gap);else b=Math.max(v,a+gap);edit(p.id,vert?{yr:{a,b}}:{xr:{a,b}});
 const t=document.querySelector('#dlg [data-wp='+which+']');if(t)t.textContent=pct(which==='a'||which==='c'?a:b);
 const it=itemOf(C.key),cv=document.querySelectorAll('#dlg .s3wpcv');if(it&&cv.length){const tmp=document.createElement('div');tmp.innerHTML=covBar(photos(C.key),it.lv.length>1);cv.forEach((n,i)=>{if(tmp.children[i])n.replaceWith(tmp.children[i].cloneNode(true))})}};
INP.s3wpA=el=>rng('a',el);INP.s3wpB=el=>rng('b',el);INP.s3wpC=el=>rng('c',el);INP.s3wpD=el=>rng('d',el);
ACT.s3wpBack=()=>{if(C.res&&C.res.url)try{URL.revokeObjectURL(C.res.url)}catch(e){}C.res=null;C.msg='';paint()};
ACT.s3wpClose=()=>{if(C.res&&C.res.url)try{URL.revokeObjectURL(C.res.url)}catch(e){}C.res=null;C.tok++;if(C.key)saveGeo(C.key).catch(()=>{});closeDlg()};
ACT.s3wpGeo=async()=>{if(C.busy)return;C.busy=1;let n=0;try{n=await saveGeo(C.key)}catch(e){}C.busy=0;
 C.msg=n?(navigator.onLine===false?'התיקונים נשמרו בטלפון ויישלחו כשתהיה רשת.':'התיקונים נשמרו.'):'לא הצלחנו לשמור את התיקונים. נסו שוב.';paint()};
const yieldUI=()=>new Promise(r=>setTimeout(r,0));
ACT.s3wpBuild=async()=>{if(C.busy)return;const it=itemOf(C.key);if(!it)return;
 try{await saveGeo(C.key)}catch(e){}/* שלב 4ב: התיקונים נשמרים גם אם החזית לא תיבנה/תאושר */
 const L=photos(C.key).filter(p=>!p.off);if(!L.length)return;
 C.busy=1;C.msg='מחברים את התמונות…';paint();const t=C.tok,t0=Date.now();
 try{
  const S=WP.create(L,{aspect:aspectOf(it)});let i=0;
  for(const o of S.order){i++;C.msg=`מיישרים תמונה ${i} מתוך ${S.order.length}…`;paint();await yieldUI();
   let im=await pixels(await fullBlob(o.p));if(t!==C.tok)return;S.add(o,im);im=null}
  const r=S.done();if(t!==C.tok)return;
  /* קידוד: JPEG עד ~1.45MB (הורדת איכות, ואם צריך – הקטנה), ומוקטנת עד 512px */
  const c=document.createElement('canvas');c.width=r.w;c.height=r.h;c.getContext('2d').putImageData(new ImageData(r.data,r.w,r.h),0,0);r.data=null;
  let full=null,q=.86,cw=r.w,ch=r.h,src=c;
  for(let k=0;k<8;k++){full=await U.blobOf(src,q);if(full&&full.size<=FRONT_MAX)break;if(q>.55)q-=.1;else{cw=Math.round(cw*.85);ch=Math.round(ch*.85);const s2=document.createElement('canvas');s2.width=cw;s2.height=ch;s2.getContext('2d').drawImage(c,0,0,cw,ch);if(src!==c)src.width=src.height=0;src=s2}}
  const k2=Math.min(1,512/Math.max(r.w,r.h)),tc=document.createElement('canvas');tc.width=Math.max(16,Math.round(r.w*k2));tc.height=Math.max(16,Math.round(r.h*k2));tc.getContext('2d').drawImage(c,0,0,tc.width,tc.height);
  let th=null;for(let tq=.72;tq>=.4;tq-=.08){th=await U.blobOf(tc,tq);if(th&&th.size<=TH_MAX)break}
  c.width=c.height=0;if(src!==c)src.width=src.height=0;tc.width=tc.height=0;
  if(!full||full.size>FRONT_MAX||!th||th.size>TH_MAX)throw new Error('big');
  C.res={gaps:r.gaps,cov:r.cov,ends:r.ends,n:L.length,w:cw,h:ch,full,th,url:URL.createObjectURL(th),ms:Date.now()-t0,seams:r.seams};C.qid='';C.msg=''}
 catch(e){C.msg=e&&e.message==='no-src'?'חלק מהתמונות עוד לא זמינות בטלפון. חכו שיישלחו ונסו שוב.':'לא הצלחנו לחבר את התמונות. נסו שוב, או הוציאו תמונה מהחזית.'}
 C.busy=0;if(t===C.tok)paint()};
ACT.s3wpSave=async()=>{const r=C.res;if(!r||C.busy||r.gaps.length)return;
 C.busy=1;C.msg='שומרים את החזית…';paint();const key=C.key;C.qid=C.qid||U.qid();
 try{await U.fn('s3CapPut',{qid:C.qid,mapId:K.mapId,key,op:'front',img:await U.b64(r.full),th:await U.b64(r.th),man:true});
  try{const d=await U.get('/s3setup/'+K.mapId+'/cap/'+key);if(d)K.docs[key]=d}catch(e){}
  C.busy=0;ACT.s3wpClose();if(K.cur===key&&typeof ACT.s3cpNext==='function')ACT.s3cpNext();K.msg='החזית המחוברת נשמרה ואושרה.';rerender()}
 catch(e){C.busy=0;C.msg=U.errText(e,'לא הצלחנו לשמור את החזית');paint()}};

const CSS=document.createElement('style');
CSS.textContent=`.s3wp2 h3{margin:0 0 6px}.s3wpst{display:flex;gap:6px;overflow-x:auto;padding:2px 0 6px}
.s3wpst button{flex:0 0 auto;width:64px;min-height:56px;border:2px solid var(--line);border-radius:var(--r-m,10px);background:var(--bg);color:var(--ink);padding:2px;position:relative;font:inherit;font-size:.75rem;cursor:pointer}
.s3wpst button img{display:block;width:100%;height:40px;object-fit:cover;border-radius:6px}.s3wpst button.on{border-color:${GOLD}}.s3wpst button.off{opacity:.45}
.s3wped{position:relative;width:100%;max-height:52vh;background:#000;border-radius:var(--r-m,10px);overflow:hidden;margin:4px 0}.s3wped img{position:absolute;inset:0;width:100%;height:100%;object-fit:fill}
.s3wped svg{position:absolute;inset:0;width:100%;height:100%;touch-action:none}.s3wpld{color:var(--mut);padding:20px;text-align:center}
.s3wprg{display:grid;grid-template-columns:1fr 1fr;gap:8px}.s3wprg label{display:flex;flex-direction:column;text-align:start;font-size:.85rem;color:var(--mut)}.s3wprg input{width:100%;min-height:44px;accent-color:${GOLD}}
.s3wpcv{position:relative;height:14px;background:${BAD};border-radius:4px;margin:4px 0;overflow:hidden}.s3wpcv i{position:absolute;top:0;bottom:0;background:var(--inc);opacity:.8;border-inline:1px solid #1b1b1f}.s3wpcv i.on{background:${GOLD};opacity:1}
.s3wpcv em{position:absolute;left:4px;top:-1px;font-size:.7rem;font-style:normal;color:#fff;z-index:1}
.s3wppv{position:relative;width:100%;margin:6px 0}.s3wppv img{display:block;width:100%;border-radius:6px}.s3wppv i{position:absolute;background:repeating-linear-gradient(45deg,rgba(220,50,50,.55) 0 6px,rgba(220,50,50,.2) 6px 12px);border:2px solid #e33}
.s3wp2 .row .btn{flex:1;min-width:120px;min-height:44px}`;
document.head.appendChild(CSS);
})();
