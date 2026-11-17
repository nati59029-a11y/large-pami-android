/* store3d-pano-ui.js – סיור 360 בתוך האפליקציה (שלבים 18ג, 18ד, 18ה; משימה 2026-11-14_סריקת-חנות-תלת-מימד).
   נטען אחרי store3d.js, store3d-editor.js, store3d-capture.js, store3d-pano.js ו-store3d-pano-cap.js.
   18ד – בעורך המפה (מנהל / s3m): כלי "נקודות 360". מציג את הנקודות (עיגול + חרוט כיוון). הוספה: צילום (S3PanoCap) או קובץ 360 מוכן ←
     הקשה על המקום במפה (בתוך חדר) ← יישור כיוון (רצועה מהצילום עם קו באמצע; הקשה על מה שהקו מצביע עליו; ±5°; "דלג" = 0°) ← s3PutPano.
     נקודה קיימת: צפייה, הזזה ויישור (עדכון בלי תמונה), צילום מחדש (החלפה), שיתוף, מחיקה (s3DelPano – מנהל בלבד, עם אישור). בלי רשת – הודעה (אין תור לא מקוון).
   18ג – תגי מצב בסיור: לכל מקטע עם מצב ב-s3sum – תג במרכז חזית המקטע (b.x,b.y של S3G.fxBays), עם המתג "סימונים" של S3Pano.
   18ה – "סיור בחנות" במסך התלת מימד (גם לעובדים, קריאה בלבד), רק כשיש נקודה פעילה. נתונים: smap/{mapId}/pano (קריאה ישירה, נטען ב-S3UI.load).
   טעינת תמונות: נתיב שעובר בדיקה צרה (b/{העסק}/store3d/{br}/pano/{mapId}/p{n}_{ver}[_s].jpg) ואז Store3D.blob (אותה טעינה ומטמון של התצוגה).
   "חזרה" של אנדרואיד סוגרת את הצילום / הסיור. */
(function(){
'use strict';
const U=window.S3UI;
if(!U||typeof ACT==='undefined'||typeof V==='undefined')return;
const esc2=U.esc2,G=()=>window.S3G;
const P={step:'',cap:null,x:0,y:0,yaw:0,tx:null,ty:null,sel:'',edit:'',qid:'',last:null,busy:0,msg:'',err:'',bmp:null,bmpFor:''};
U.P360=P;
const RE_P=/^b\/([^/]+)\/store3d\/[a-z0-9_]{2,20}\/pano\/[sw]-[a-z0-9_]{2,20}\/p[0-9]{1,4}_[0-9]{1,4}(_s)?\.jpg$/;
const okP=p=>{if(typeof p!=='string'||p.length>300||p.indexOf('..')>=0)return false;const m=RE_P.exec(p);return !!m&&(!(SY&&SY.bizId)||m[1]===SY.bizId)};
const load=p=>okP(p)&&window.Store3D&&typeof Store3D.blob==='function'?Store3D.blob(p):Promise.reject(new Error('path'));
U.panoLoad=load;/* לבדיקות */
const norm360=a=>Math.round((((a%360)+360)%360)*10)/10;
const brg=(ax,ay,bx,by)=>norm360(Math.atan2(bx-ax,-(by-ay))*180/Math.PI);

/* ---------- נתונים ---------- */
U.panoList=async mid=>{try{const r=await fsx('/smap/'+mid+'/pano?pageSize=100');
  return((r&&r.documents)||[]).map(x=>{const o=U.dec(x);if(o)o.id=String(x.name||'').split('/').pop();return o})
   .filter(o=>o&&o.del!==1&&/^p[0-9]{1,4}$/.test(o.id)&&isFinite(o.x)&&isFinite(o.y)&&okP(o.full)&&okP(o.sm))
   .map(o=>({id:o.id,x:+o.x,y:+o.y,yaw:+o.yaw||0,nb:Array.isArray(o.nb)?o.nb.filter(i=>typeof i==='string'):[],full:o.full,sm:o.sm,ver:o.ver|0}))
   .sort((a,b)=>(+a.id.slice(1))-(+b.id.slice(1)))}catch(e){return[]}};
const E=()=>U.E;
const kindE=()=>E()&&E().kind==='w'?'w':'s';
const midE=()=>U.mapIdOf(kindE(),U.brSel());
const listOf=k=>{const d=U.data();return d&&d.pano&&Array.isArray(d.pano[k])?d.pano[k]:[]};
const ptOf=id=>listOf(kindE()).find(p=>p.id===id)||null;
async function refresh(){const d=U.data(),k=kindE();if(!d)return;if(!d.pano)d.pano={s:[],w:[]};d.pano[k]=await U.panoList(midE());if(!ptOf(P.sel))P.sel='';rerender()}

/* ---------- תגי מצב (18ג) ---------- */
function tagsOf(map,sum){const B=sum&&sum.b&&typeof sum.b==='object'?sum.b:null,out=[];if(!B||!G())return out;
 let m;try{m=G().buildModel(map)}catch(e){return out}
 for(const b of m.bays){const e=B[b.id];if(e&&['ok','iss','miss','rev'].includes(e.s))out.push({x:b.x,y:b.y,k:e.s})}return out}
U.panoTags=tagsOf;

/* ---------- שכבה במסך מלא ו"חזרה" ---------- */
let closeCur=null;
function layer(){const d=document.createElement('div');d.dir='rtl';d.className='s3q-layer';d.style.cssText='position:fixed;inset:0;z-index:9999;background:var(--bg)';document.body.appendChild(d);return d}
if(typeof window.goBack==='function'){const g0=window.goBack;window.goBack=function(){
 try{if(window.S3PanoCap&&S3PanoCap.isOpen()){S3PanoCap.close();return true}if(closeCur){closeCur();return true}}catch(e){}return g0.apply(this,arguments)}}

/* ---------- סיור (18ה) ---------- */
async function openTour(kind,startId){
 if(closeCur||!window.S3Pano)return;const d=U.data();if(!d)return;const map=d.maps&&d.maps[kind],L=listOf(kind);
 if(!map||!L.length){toast('אין נקודות 360 במפה הזו');return}
 let st=startId&&L.some(p=>p.id===startId)?startId:'';
 if(!st){let e=null;try{e=G().entrance(map)}catch(x){}const ex=e&&isFinite(e.x)?e.x:(Array.isArray(e)?e[0]:null),ey=e&&isFinite(e.y)?e.y:(Array.isArray(e)?e[1]:null);
  st=L[0].id;if(isFinite(ex)&&isFinite(ey)&&ex!=null){let bd=1e18;for(const p of L){const dd=(p.x-ex)**2+(p.y-ey)**2;if(dd<bd){bd=dd;st=p.id}}}}
 const el=layer();let h=null,dead=false;
 const close=()=>{if(dead)return;dead=true;if(closeCur===close)closeCur=null;try{if(h)h.destroy()}catch(e){}el.remove()};closeCur=close;
 const tour={pts:L.map(p=>({id:p.id,x:p.x,y:p.y,yaw:p.yaw,full:p.full,sm:p.sm,nb:p.nb})),start:st};
 try{h=await S3Pano.open(el,tour,{load,map,tags:kind==='s'?tagsOf(map,d.sum):[],onClose:close});}catch(e){h=null}
 if(dead){try{if(h)h.destroy()}catch(e){}return}
 U.tourH=h;
 /* שלב 9: מתג חזרה לדגם (סוגר רק את שכבת ה-360; הדגם והמצלמה שלו לא נגעו) */
 if(h){const sw=document.createElement('div');sw.setAttribute('role','group');sw.setAttribute('aria-label','מעבר בין דגם לצילום 360');
  sw.style.cssText='position:absolute;top:calc(56px + env(safe-area-inset-top,0px));inset-inline-end:8px;z-index:6;display:flex;gap:6px;direction:rtl';
  const mk=(t,on,f)=>{const b=document.createElement('button');b.type='button';b.className='chip'+(on?' on':'');b.textContent=t;b.style.minHeight='44px';b.setAttribute('aria-pressed',on?'true':'false');b.className+=on?' s3sw-on':' s3sw-back';b.onclick=f;return b};
  sw.append(mk('דגם',false,()=>close()),mk('צילום 360',true,()=>{}));el.appendChild(sw)}
 /* שיתוף התמונה של הנקודה הנוכחית – למי שרשאי לערוך (מנהל / s3m) */
 if(h&&U.canDraw()&&U.canShare&&U.canShare()){const b=document.createElement('button');b.type='button';b.className='btn g';b.textContent='שיתוף התמונה';
  b.style.cssText='position:absolute;top:calc(64px + env(safe-area-inset-top,0px));inset-inline-start:8px;z-index:6;min-height:44px';
  b.onclick=async()=>{const id=h.stats().id,p=L.find(x=>x.id===id);if(!p)return;try{U.shareJpg(await load(p.full),'pano360-'+p.id+'.jpg')}catch(e){toast('טעינת התמונה נכשלה')}};el.appendChild(b)}
}
U.openTour=openTour;
/* שלב 9 – מתג "דגם / צילום 360": שני כפתורים באותה שורה (אחים, בלי עטיפה). "דגם" = המסך הנוכחי (פעיל), "צילום 360" = השכבה הנפרדת (הסיור). בלי טעינה מחדש ובלי נגיעה בדגם או במפה */
U.tourBtn=(kind,d)=>d&&d.pano&&Array.isArray(d.pano[kind])&&d.pano[kind].length&&window.S3Pano?`<button class="chip on" type="button" aria-pressed="true" aria-label="דגם (מוצג עכשיו)" data-a="s3qModel" style="min-height:44px;margin-inline-start:6px">דגם</button><button class="chip" type="button" aria-pressed="false" data-a="s3qTour" data-k="${kind}" style="min-height:44px">צילום 360</button>`:'';
ACT.s3qModel=()=>{};/* כבר בדגם */
ACT.s3qTour=el=>{const k=el&&el.dataset&&el.dataset.k?el.dataset.k:kindE();openTour(k==='w'?'w':'s')};
ACT.s3qView=()=>{if(P.sel)openTour(kindE(),P.sel)};

/* ---------- עורך: כלי "נקודות 360" (18ד) ---------- */
const canEd=()=>{try{return U.feat()&&U.canDraw()&&!!window.S3PanoCap}catch(e){return false}};
const saved=()=>{const e=E();return !!(e&&e.map&&e.baseV>0&&!e.wiz)};
function reset(){P.aimed=false;P.step='';P.cap=null;P.edit='';P.tx=P.ty=null;P.qid='';P.last=null;P.msg='';P.err='';dropBmp()}
function dropBmp(){try{if(P.bmp&&P.bmp.close)P.bmp.close()}catch(e){}P.bmp=null;P.bmpFor=''}
U.pano={
 ok:canEd,
 tool:on=>{if(!on&&!P.busy)reset()},
 opts,svg,tap};
const btn=(a,t,x)=>`<button class="btn${x&&x.g?' g':''}" data-a="${a}"${x&&x.dis?' disabled':''}${x&&x.st?` style="${x.st}"`:''}>${t}</button>`;
function opts(){
 let h='';
 if(!saved())return '<p class="note s3note">כדי להוסיף נקודות 360 קודם שומרים את המפה.</p>';
 if(P.err)h+=`<div class="s3info s3err" role="alert" style="margin-bottom:8px">${esc2(P.err)}${P.last&&!P.busy?`<div class="row s3row">${btn('s3qRetry','נסו שוב')}</div>`:''}</div>`;
 if(P.msg)h+=`<div class="s3info" role="status" style="margin-bottom:8px">${esc2(P.msg)}</div>`;
 if(P.busy)return h+`<div class="s3info" aria-live="polite"><b>${esc2(P.busy===2?'מוחק…':'שומר את הנקודה…')}</b>${P.last&&P.last.full?`<br><small>מעלה צילום של כ-${(P.last.full.length*.75/1048576).toFixed(1)}MB. אל תסגרו את המסך.</small>`:''}</div>`;
 if(P.step==='place')return h+`<p class="note s3note"><b>שלב 2 מתוך 3:</b> הקישו על המפה במקום שבו עמדתם בזמן הצילום (בתוך חדר).</p><div class="row s3row">${btn('s3qCancel','ביטול',{g:1})}</div>`;
 if(P.step==='move')return h+`<p class="note s3note">הקישו על המפה על המיקום החדש של הנקודה.</p><div class="row s3row">${btn('s3qCancel','ביטול',{g:1})}</div>`;
 if(P.step==='aim')return h+`<p class="note s3note"><b>${P.edit&&!P.cap?'יישור כיוון':'שלב 3 מתוך 3: יישור כיוון'}</b> – הקו הזהוב באמצע התמונה מצביע לכיוון מסוים בחנות. הקישו על המפה על המדף או הפריט שהקו מצביע עליו.</p>
 <canvas id="s3qStrip" aria-label="רצועה מהצילום עם קו באמצע" style="display:block;width:100%;height:96px;border-radius:var(--r-m,12px);border:1px solid var(--line);background:var(--srf-0,var(--bg));margin:6px 0"></canvas>
 <div class="row s3row"><span>כיוון: <b>${Math.round(P.yaw)}°</b>${P.aimed?'':' (עוד לא נבחר)'}</span><button class="btn g" data-a="s3qRot" data-d="-5" aria-label="סיבוב 5 מעלות נגד כיוון השעון">‎−5°</button><button class="btn g" data-a="s3qRot" data-d="5" aria-label="סיבוב 5 מעלות עם כיוון השעון">‎+5°</button></div>
 <div class="row s3row">${btn('s3qSave','שמירת הנקודה')}${btn('s3qSkip','דלג (כיוון 0°)',{g:1})}${btn('s3qCancel','ביטול',{g:1})}</div>`;
 const L=listOf(kindE()),e=E();
 h+=`<p class="note s3note">נקודות 360: עומדים באמצע מעבר, כשאין אנשים בחנות, ומצלמים מסביב. ${L.length?`במפה ${L.length} נקודות.`:'עוד אין נקודות במפה.'} הקישו על נקודה כדי לבחור אותה.</p>`;
 if(e&&e.dirty)h+='<p class="note s3note">יש שינויים במפה שעוד לא נשמרו. הנקודות נבדקות מול המפה השמורה.</p>';
 h+=`<div class="row s3row">${btn('s3qAdd','הוספת נקודה')}<label class="btn g" style="cursor:pointer">העלאת קובץ 360<input type="file" accept="image/jpeg" data-c="s3qFile" hidden></label>${L.length?btn('s3qTour','צפייה בסיור',{g:1}):''}</div>`;
 const p=ptOf(P.sel);
 if(p){h+=`<div class="s3info"><b>נקודה ${esc2(p.id.slice(1))}</b><small> · כיוון ${Math.round(p.yaw)}° · ${p.nb.length?'מקושרת ל-'+p.nb.length+' נקודות':'לא מקושרת לנקודות אחרות'}</small>
  <div class="row s3row">${btn('s3qView','צפייה',{g:1})}${btn('s3qMove','הזזה',{g:1})}${btn('s3qAim','יישור כיוון',{g:1})}${btn('s3qRe','צילום מחדש',{g:1})}${U.canShare&&U.canShare()?btn('s3qShare','שיתוף התמונה',{g:1}):''}</div>
  ${U.isMgr()?`<div class="row s3row">${btn('s3qDel','מחיקת הנקודה',{g:1,st:'border-color:var(--bad);color:var(--bad)'})}</div>`:'<p class="note s3note">מחיקת נקודה מותרת למנהל בלבד.</p>'}</div>`}
 return h}
function svg(px,fs,K){
 const L=listOf(kindE());let s='';
 const cone=(x,y,yaw,r,col,op)=>{const a=(yaw-28)*Math.PI/180,b=(yaw+28)*Math.PI/180;return `<path d="M${x} ${y} L${x+r*Math.sin(a)} ${y-r*Math.cos(a)} A${r} ${r} 0 0 1 ${x+r*Math.sin(b)} ${y-r*Math.cos(b)} Z" fill="${col}" fill-opacity="${op}" stroke="none"/>`};
 for(const p of L){if(P.edit===p.id&&(P.step==='aim'||P.step==='move'))continue;const on=P.sel===p.id;
  s+=cone(p.x,p.y,p.yaw,px*34,K.acc,on?.55:.35)+`<circle cx="${p.x}" cy="${p.y}" r="${px*(on?11:9)}" fill="${K.acc}" stroke="${on?K.ink:K.card}" stroke-width="${px*(on?3:2)}" data-pano="${esc2(p.id)}"/><text x="${p.x}" y="${p.y+fs*.32}" fill="${K.onacc}" font-size="${fs*.75}" font-weight="700" text-anchor="middle">${esc2(p.id.slice(1))}</text>`}
 if(P.step==='aim'){if(P.tx!=null)s+=`<line x1="${P.x}" y1="${P.y}" x2="${P.tx}" y2="${P.ty}" stroke="${K.inc}" stroke-width="${px*2}" stroke-dasharray="${px*6} ${px*4}"/><circle cx="${P.tx}" cy="${P.ty}" r="${px*6}" fill="none" stroke="${K.inc}" stroke-width="${px*2}"/>`;
  s+=cone(P.x,P.y,P.yaw,px*44,K.inc,.5)+`<line x1="${P.x}" y1="${P.y}" x2="${P.x+px*60*Math.sin(P.yaw*Math.PI/180)}" y2="${P.y-px*60*Math.cos(P.yaw*Math.PI/180)}" stroke="${K.inc}" stroke-width="${px*3}"/><circle cx="${P.x}" cy="${P.y}" r="${px*11}" fill="${K.inc}" stroke="${K.ink}" stroke-width="${px*2}" data-pano="new"/>`}
 return s}
const inRoom=(x,y)=>{const e=E();return !!(e&&e.map&&G()&&(e.map.rooms||[]).some(r=>r&&r.del!==1&&Array.isArray(r.p)&&G().pointInPoly(x,y,r.p)))};
function tap(x,y){
 P.msg='';if(P.busy)return;
 if(P.step==='place'||P.step==='move'){if(!inRoom(x,y)){P.msg='הקישו בתוך חדר במפה.';return}
  const nx=Math.round(x),ny=Math.round(y);
  if(P.step==='place'){P.x=nx;P.y=ny;P.yaw=0;P.tx=P.ty=null;P.step='aim';return}
  const p=ptOf(P.edit);if(!p){reset();return}put({id:p.id,x:nx,y:ny,yaw:norm360(p.yaw)});return}
 if(P.step==='aim'){if(Math.hypot(x-P.x,y-P.y)<20){P.msg='הקישו על מדף או פריט רחוק יותר מהנקודה.';return}P.tx=Math.round(x);P.ty=Math.round(y);P.yaw=brg(P.x,P.y,x,y);P.aimed=true;return}
 const e=E(),tol=Math.max(40,(e?e.vw:2000)/18);let best=null,bd=1e9;
 for(const p of listOf(kindE())){const d=Math.hypot(p.x-x,p.y-y);if(d<=tol&&d<bd){bd=d;best=p}}
 P.sel=best?best.id:''}
/* הרצועה מהצילום: 120° סביב מרכז התמונה (u=0.5 = הכיוון ששומרים כ-yaw), עם קו זהוב באמצע */
function paintStrip(){
 const c=document.getElementById('s3qStrip');if(!c||P.step!=='aim')return;
 const w=c.clientWidth||300,hh=c.clientHeight||96,dpr=Math.min(2,window.devicePixelRatio||1);c.width=Math.round(w*dpr);c.height=Math.round(hh*dpr);
 const g=c.getContext('2d');const b=P.bmp;
 if(b){const sw=b.width/3,sh=Math.min(b.height*.6,sw*hh/w);g.drawImage(b,b.width/2-sw/2,b.height/2-sh/2,sw,sh,0,0,c.width,c.height)}
 else{g.fillStyle=getComputedStyle(c).color||'gray';g.font=(14*dpr)+'px sans-serif';g.textAlign='center';g.fillText('טוען את הצילום…',c.width/2,c.height/2)}
 const acc=(getComputedStyle(document.documentElement).getPropertyValue('--acc')||'').trim()||'gold';
 g.fillStyle='rgba(0,0,0,.55)';g.fillRect(c.width/2-3*dpr,0,6*dpr,c.height);g.fillStyle=acc;g.fillRect(c.width/2-1.5*dpr,0,3*dpr,c.height)}
async function stripSrc(blob,key){if(P.bmpFor===key&&P.bmp)return;dropBmp();P.bmpFor=key;
 try{const b=await createImageBitmap(blob);if(P.bmpFor!==key){try{b.close()}catch(e){}return}P.bmp=b}catch(e){P.bmp=null}paintStrip()}
{const a0=U.afterEd;U.afterEd=()=>{if(a0)a0();try{if(cur().v==='st3e')paintStrip()}catch(e){}}}

/* ---------- צילום / קובץ ---------- */
const offline=()=>navigator.onLine===false;
const NEED_NET='אין חיבור לאינטרנט. כדי לשמור נקודת 360 צריך חיבור. נסו שוב כשיש חיבור.';
async function capture(editId){
 if(P.busy||closeCur||!window.S3PanoCap)return;reset();
 if(offline()){P.err=NEED_NET;return rerender()}
 const el=layer();let res=null,dead=false;const close=()=>{if(dead)return;dead=true;if(closeCur===close)closeCur=null;try{S3PanoCap.close()}catch(e){}el.remove()};closeCur=close;
 try{res=await S3PanoCap.start(el,{})}catch(e){res=null;P.err='הצילום נכשל. נסו שוב.'}
 close();if(res)accept(res,editId);rerender()}
function accept(res,editId){
 if(!res||!(res.full instanceof Blob)||!(res.sm instanceof Blob)||res.w!==res.h*2){P.err='תמונת 360 חייבת להיות ביחס 2:1 (רוחב כפול מהגובה).';return}
 P.cap={full:res.full,sm:res.sm,w:res.w,h:res.h};P.qid='';stripSrc(res.sm,'cap:'+Date.now());
 const p=editId?ptOf(editId):null;
 if(p){P.edit=p.id;P.x=p.x;P.y=p.y;P.yaw=0;P.tx=P.ty=null;P.step='aim'}else{P.edit='';P.step='place'}}
U.panoAccept=accept;/* לבדיקות */
const toJpg=(c,q)=>new Promise(r=>c.toBlob(r,'image/jpeg',q));
async function fitJpg(src,W,H,max){const c=document.createElement('canvas');c.width=W;c.height=H;const g=c.getContext('2d');g.imageSmoothingQuality='high';g.drawImage(src,0,0,W,H);
 let b=null;for(const q of[.86,.78,.7,.6,.5]){b=await toJpg(c,q);if(b&&b.size<=max)break}c.width=c.height=1;return b&&b.size<=max?b:null}
CHG.s3qFile=async el=>{const f=el.files&&el.files[0];el.value='';if(!f||P.busy)return;reset();
 if(!/^image\/jpe?g$/i.test(f.type||'')){P.err='מותרת רק תמונת JPEG.';return rerender()}
 let b=null;try{b=await createImageBitmap(f)}catch(e){P.err='לא הצלחנו לקרוא את הקובץ.';return rerender()}
 try{if(Math.abs(b.width-2*b.height)>2){P.err='תמונת 360 חייבת להיות ביחס 2:1 (רוחב כפול מהגובה). הקובץ שנבחר הוא '+b.width+'×'+b.height+'.';return rerender()}
  if(b.width<2048){P.err='הקובץ קטן מדי. צריך תמונת 360 ברוחב 2048 פיקסלים לפחות.';return rerender()}
  P.msg='מכין את הקובץ…';rerender();
  const W=b.width>=4096?4096:2048,full=await fitJpg(b,W,W/2,2900000),sm=await fitJpg(b,1024,512,190000);P.msg='';
  if(!full||!sm){P.err='הקובץ גדול מדי גם אחרי הקטנה. נסו קובץ אחר.';return rerender()}
  accept({full,sm,w:W,h:W/2},'')}finally{try{b.close()}catch(e){}}
 rerender()};

/* ---------- שמירה ומחיקה ---------- */
async function put(body){
 if(P.busy)return;if(offline()){P.err=NEED_NET;P.last=null;return rerender()}
 if(!P.qid)P.qid=U.qid();P.last=Object.assign({qid:P.qid,mapId:midE()},body);P.busy=1;P.err='';P.msg='';rerender();
 try{const r=await U.fn('s3PutPano',P.last);P.busy=0;const sel=r&&r.id||body.id||'';reset();P.sel=sel;toast('נקודת ה-360 נשמרה');await refresh()}
 catch(e){P.busy=0;P.err=U.errText(e,'שמירת הנקודה נכשלה');if(e&&e.offline)P.err=NEED_NET;rerender()}}
async function blobsOf(){return{full:await U.b64(P.cap.full),sm:await U.b64(P.cap.sm)}}
async function saveAim(){
 if(P.step!=='aim')return;const yaw=norm360(P.yaw)%360;
 if(P.cap){let im;try{im=await blobsOf()}catch(e){P.err='הכנת התמונה נכשלה. נסו שוב.';return rerender()}
  put(Object.assign(P.edit?{id:P.edit}:{},{x:P.x,y:P.y,yaw},im))}
 else if(P.edit)put({id:P.edit,x:P.x,y:P.y,yaw})}
ACT.s3qAdd=()=>capture('');
ACT.s3qRe=()=>{if(P.sel)capture(P.sel)};
ACT.s3qCancel=()=>{reset();rerender()};
ACT.s3qRetry=()=>{if(P.last&&!P.busy){const b=Object.assign({},P.last);delete b.qid;delete b.mapId;put(b)}};
ACT.s3qMove=()=>{const p=ptOf(P.sel);if(!p)return;reset();P.edit=p.id;P.step='move';rerender()};
ACT.s3qAim=async()=>{const p=ptOf(P.sel);if(!p)return;reset();P.edit=p.id;P.x=p.x;P.y=p.y;P.yaw=p.yaw;P.aimed=true;P.tx=P.ty=null;P.step='aim';rerender();
 try{stripSrc(await load(p.sm),p.sm)}catch(e){}};
ACT.s3qRot=el=>{P.yaw=norm360(P.yaw+(+el.dataset.d||0));P.tx=P.ty=null;P.aimed=true;rerender()};
ACT.s3qSkip=()=>{P.yaw=0;P.tx=P.ty=null;saveAim()};
ACT.s3qSave=()=>saveAim();
ACT.s3qShare=async()=>{const p=ptOf(P.sel);if(!p)return;try{U.shareJpg(await load(p.full),'pano360-'+p.id+'.jpg')}catch(e){toast('טעינת התמונה נכשלה')}};
ACT.s3qDel=()=>{const p=ptOf(P.sel);if(!p||!U.isMgr())return;
 ask('למחוק את נקודה '+p.id.slice(1)+'? היא תצא מהסיור (התמונות נמחקות סופית אחרי 30 יום).',async()=>{
  if(!U.isMgr())return;if(offline()){P.err=NEED_NET;return rerender()}
  P.busy=2;P.err='';rerender();
  try{await U.fn('s3DelPano',{mapId:midE(),id:p.id});P.busy=0;P.sel='';toast('הנקודה נמחקה');await refresh()}
  catch(e){P.busy=0;P.err=U.errText(e,'המחיקה נכשלה');rerender()}},'כן, מחק')};

/* ---------- במסך הראשי: "צילום נקודת 360" במקום כרטיס הניסוי (כשיש מפה) ---------- */
{const r0=V.st3;if(typeof r0==='function')V.st3=function(){const r=r0.apply(this,arguments);try{const d=U.data(),X=U.X,k=X.kind==='w'&&d&&d.maps.w?'w':'s';
 if(r&&typeof r.h==='string'&&canEd()&&U.dataOk()&&d&&!d.err&&d.maps[k]&&X.tab==='map')r.h+=`<div class="card s3s" style="margin-top:12px"><b>צילום נקודת 360</b><p class="note s3note" style="margin:6px 0 10px">עומדים במקום אחד, מסובבים את הטלפון, ומסמנים במפה איפה עמדתם. כך נבנה "סיור בחנות" לכל הצוות.</p><button class="btn" data-a="s3qEd" data-k="${k}">לנקודות 360</button></div>`}catch(e){}return r}}
ACT.s3qEd=el=>{const k=el&&el.dataset.k==='w'?'w':'s';U.openEditor(k);if(cur().v==='st3e'&&U.E&&U.E.map){U.E.tool='pano';U.E.sel=null;rerender()}};
})();
