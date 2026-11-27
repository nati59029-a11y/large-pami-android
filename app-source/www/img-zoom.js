/* צפייה בתמונות ובמסמכים (24.11.2026): בכל תמונה, חשבונית או מסמך שמוצגים באפליקציה (למנהל ולעובד) – הגדלה אמיתית, שמירה בגלריה ושיתוף.
   נטען אחרון, אחרי index.html וכל הקבצים. משתמש במסך הצפייה הקיים (viewImg / #viewer) ובפונקציות הקיימות: shareFile ו-galSave (groups.js), mkScanPdf, outSave, imgOk.
   - תמונה: "חזרה" · "שמירה בגלריה" · "שיתוף" (חלון השיתוף של הטלפון; כמה עמודים = PDF אחד). הגדלה בצביטה, הקשה כפולה (פי 1 ↔ פי 2.5), וכפתורי + / − (פי 1 עד פי 5).
   - PDF: התצוגה הקיימת (pdf.js) נשארת; "שיתוף" פותח את חלון השיתוף של הטלפון, ונוסף "שמירה במכשיר" (PDF לא נשמר בגלריה).
   - כל תמונה אחרת שמוצגת (data:image תקינה לפי imgOk, או blob: של תמונה) ואין לה פעולה משלה – נגיעה פותחת את מסך הצפייה.
     לא נפתחות: תמונות בתוך כפתור/קישור/תווית או רכיב עם data-a, תמונות קטנות (סמלים), לוגו ותמונות עם data-nozoom, ומסכי צילום/חיתוך/עריכה (רשימה ב-VZ_NO).
     כתובת https לא נפתחת (לא נטענת ולא מנווטים אליה). לא משנה נתונים שמורים. */
(function(){
if(typeof viewImg!=='function'||typeof ACT==='undefined')return;
const st=document.createElement('style');
st.textContent='#viewer .vbar{gap:8px;padding-left:10px;padding-right:10px}#viewer .vbar .btn{padding:0 8px;font-size:.95rem}#viewer .vbar.vact{padding-top:0}'+
 '#viewer .vimg{position:relative}#viewer .vzw{display:block;text-align:center;transform-origin:0 0}#viewer .vimg img{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}'+
 '#viewer .vzb{position:absolute;left:12px;bottom:calc(12px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:8px;z-index:2}'+
 '#viewer .vzb .btn{flex:none;width:52px;min-width:52px;padding:0;font-size:1.5rem;background:rgba(17,17,17,.75)}';
document.head.append(st);

const EXT={'image/png':'.png','image/webp':'.webp','image/gif':'.gif','image/bmp':'.bmp','image/heic':'.heic','image/heif':'.heif','image/avif':'.avif'};
const ext=t=>EXT[t]||'.jpg';
const base=()=>safeN((VW&&VW.name)||'LargePami_image')||'LargePami_image';
const share=o=>typeof shareFile==='function'?shareFile(o):saveFile(o.name,o.b,o.mime);
const gal=o=>typeof galSave==='function'?galSave(o):saveFile(o.name,o.b,o.mime);
const pdfDU=du=>typeof du==='string'&&/^data:application\/pdf;base64,[A-Za-z0-9+/=]*$/.test(du);

/* ---- הגדלה: צביטה, גרירה, הקשה כפולה, + / −. בפי 1 במסמך של כמה עמודים – גלילה רגילה של הדפדפן ---- */
function vzW0(Z){const r=Z.tg.getBoundingClientRect();return{x:r.left-Z.x,y:r.top-Z.y}}
function vzClamp(Z,W){const C=Z.box.getBoundingClientRect(),w=Z.tg.offsetWidth*Z.s,h=Z.tg.offsetHeight*Z.s;
 const ax=(c0,c1,size,w0,v)=>size>=c1-c0?Math.min(c0-w0,Math.max(c1-size-w0,v)):c0+(c1-c0-size)/2-w0;
 Z.x=ax(C.left,C.right,w,W.x,Z.x);Z.y=ax(C.top,C.bottom,h,W.y,Z.y)}
function vzApply(Z){if(Z.s<=1.001){Z.s=1;Z.x=0;Z.y=0}const on=Z.s>1;
 Z.tg.style.transformOrigin='0 0';Z.tg.style.transform=on?`translate(${Z.x}px,${Z.y}px) scale(${Z.s})`:'';
 Z.box.style.overflow=on?'hidden':'';Z.box.style.touchAction=on||!Z.multi?'none':'pan-y'}
function vzTo(Z,s,fx,fy){const W=vzW0(Z);s=Math.min(5,Math.max(1,s));const lx=(fx-W.x-Z.x)/Z.s,ly=(fy-W.y-Z.y)/Z.s;Z.x=fx-W.x-s*lx;Z.y=fy-W.y-s*ly;Z.s=s;if(s>1)vzClamp(Z,W);vzApply(Z)}
function vzInit(v){const box=v.querySelector('.vimg');if(!box)return;const imgs=[...box.querySelectorAll('img')];if(!imgs.length)return;
 imgs.forEach(i=>{i.draggable=false});let tg=imgs[0];
 if(imgs.length>1){tg=document.createElement('div');tg.className='vzw';imgs.forEach(i=>tg.append(i));box.append(tg)}
 const Z={s:1,x:0,y:0,box,tg,multi:imgs.length>1};v._vz=Z;vzApply(Z);
 let P=null,mv=false,tap=0,tx=0,ty=0,lastT=0;
 const mid=t=>({x:(t[0].clientX+t[1].clientX)/2,y:(t[0].clientY+t[1].clientY)/2}),dist=t=>Math.hypot(t[0].clientX-t[1].clientX,t[0].clientY-t[1].clientY)||1;
 const pan1=t=>{P={m:1,sx:t.clientX,sy:t.clientY,zx:Z.x,zy:Z.y,W:vzW0(Z)}};
 box.addEventListener('touchstart',e=>{lastT=Date.now();const t=e.touches;
  if(t.length>=2){e.preventDefault();const m=mid(t),W=vzW0(Z);P={m:2,d:dist(t),s0:Z.s,W,lx:(m.x-W.x-Z.x)/Z.s,ly:(m.y-W.y-Z.y)/Z.s};mv=true;return}
  mv=false;if(Z.s>1)pan1(t[0]);else P=null},{passive:false});
 box.addEventListener('touchmove',e=>{const t=e.touches;
  if(P&&P.m===2&&t.length>=2){e.preventDefault();const m=mid(t),s=Math.min(5,Math.max(1,P.s0*dist(t)/P.d));Z.s=s;Z.x=m.x-P.W.x-s*P.lx;Z.y=m.y-P.W.y-s*P.ly;if(s>1)vzClamp(Z,P.W);vzApply(Z);return}
  if(t.length!==1)return;
  if(P&&P.m===1){const dx=t[0].clientX-P.sx,dy=t[0].clientY-P.sy;if(Math.abs(dx)+Math.abs(dy)>8)mv=true;e.preventDefault();Z.x=P.zx+dx;Z.y=P.zy+dy;vzClamp(Z,P.W);vzApply(Z)}},{passive:false});
 box.addEventListener('touchmove',e=>{if(!P&&e.touches.length===1)mv=true},{passive:true});
 box.addEventListener('touchend',e=>{lastT=Date.now();const t=e.touches;
  if(t.length===1){if(Z.s>1)pan1(t[0]);else P=null;mv=true;return}if(t.length)return;
  const wasPinch=P&&P.m===2;P=null;if(wasPinch){if(Z.s<1.05){Z.s=1;vzApply(Z)}tap=0;return}
  if(mv){tap=0;return}const c=e.changedTouches&&e.changedTouches[0];if(!c)return;const now=Date.now();
  if(tap&&now-tap<320&&Math.abs(c.clientX-tx)<30&&Math.abs(c.clientY-ty)<30){e.preventDefault();tap=0;if(Z.s>1){Z.s=1;vzApply(Z)}else vzTo(Z,2.5,c.clientX,c.clientY);return}
  tap=now;tx=c.clientX;ty=c.clientY},{passive:false});
 box.addEventListener('touchcancel',()=>{P=null;tap=0},{passive:true});
 /* מחשב (עכבר): הקשה כפולה וגרירה */
 box.addEventListener('dblclick',e=>{if(Date.now()-lastT<800)return;e.preventDefault();if(Z.s>1){Z.s=1;vzApply(Z)}else vzTo(Z,2.5,e.clientX,e.clientY)});
 box.addEventListener('mousedown',e=>{if(Z.s<=1||e.button!==0||Date.now()-lastT<800)return;e.preventDefault();pan1(e);
  const mm=ev=>{if(!P||P.m!==1)return;Z.x=P.zx+ev.clientX-P.sx;Z.y=P.zy+ev.clientY-P.sy;vzClamp(Z,P.W);vzApply(Z)},mu=()=>{P=null;removeEventListener('mousemove',mm);removeEventListener('mouseup',mu)};
  addEventListener('mousemove',mm);addEventListener('mouseup',mu)})}
ACT.vwZoom=el=>{const v=document.getElementById('viewer'),Z=v&&v._vz;if(!Z)return;const C=Z.box.getBoundingClientRect();vzTo(Z,+el.dataset.d>0?Z.s*1.5:Z.s/1.5,C.left+C.width/2,C.top+C.height/2)};

/* ---- כפתורי מסך הצפייה ---- */
function vwEnh(){const v=document.getElementById('viewer');if(!v||v.dataset.enh||!VW)return;v.dataset.enh='1';const bar=v.querySelector('.vbar');if(!bar)return;
 if(VW.pdf){const sh=bar.querySelector('[data-a="vwShare"]'),r=document.createElement('div');r.className='vbar vact';
  r.innerHTML='<button class="btn g" data-a="vwSave">שמירה במכשיר</button>';if(sh)r.append(sh);bar.after(r);return}
 const n=(VW.pgs||[]).length;if(!n)return;
 bar.innerHTML=`<button class="btn" data-a="vwClose">חזרה</button><button class="btn g" data-a="vwGal">שמירה בגלריה</button><button class="btn g" data-a="vwShare">${n>1?'שיתוף (PDF)':'שיתוף'}</button>`;
 const z=document.createElement('div');z.className='vzb';z.innerHTML='<button type="button" class="btn g" data-a="vwZoom" data-d="1" aria-label="הגדלה">+</button><button type="button" class="btn g" data-a="vwZoom" data-d="-1" aria-label="הקטנה">−</button>';v.append(z);
 vzInit(v)}
{const o=viewImg;viewImg=async function(){const r=await o.apply(this,arguments);try{vwEnh()}catch(e){}return r}}

const busy=async(el,f)=>{if(!el||el.dataset.busy)return;el.dataset.busy='1';try{await f()}finally{delete el.dataset.busy}};
/* שיתוף אמיתי (חלון השיתוף של הטלפון): תמונה אחת – כתמונה; כמה עמודים – PDF אחד; PDF – כמו שהוא */
ACT.vwShare=el=>busy(el,async()=>{if(!VW)return;
 try{if(VW.pdf){if(!pdfDU(VW.du))return toast('הקובץ לא תקין ולא ישותף');await share({b:du2b(VW.du),name:base()+'.pdf',mime:'application/pdf'});return}
  const P=(VW.pgs||[]).filter(imgOk);if(!P.length)return toast('התמונה לא תקינה ולא תשותף');
  if(P.length===1){const b=du2b(P[0]);await share({b,name:base()+ext(b.type),mime:b.type||'image/jpeg'})}
  else await share({b:new Blob([await mkScanPdf(P)],{type:'application/pdf'}),name:base()+'.pdf',mime:'application/pdf'})}
 catch(e){toast('השיתוף נכשל: '+(e&&e.message||e))}});
/* 27.11.2026: סוג הקובץ נקבע לפי התוכן עצמו (ולא לפי הכותרת של ה-data:), והתמונה נבדקת שהיא נפתחת – כך שלא נשמר בגלריה קובץ שלא נפתח.
   מחזיר {b,mime,ext} או null אם התמונה פגומה */
const SNF=[[[0xFF,0xD8,0xFF],'image/jpeg','.jpg'],[[0x89,0x50,0x4E,0x47],'image/png','.png'],[[0x47,0x49,0x46,0x38],'image/gif','.gif'],[[0x42,0x4D],'image/bmp','.bmp']];
async function imgReal(du){if(!imgOk(du))return null;let b;try{b=du2b(du)}catch(e){return null}if(!b.size)return null;
 const h=new Uint8Array(await b.slice(0,16).arrayBuffer()),at=(a,o)=>a.every((v,i)=>h[o+i]===v),tx=(t,o)=>at([...t].map(c=>c.charCodeAt(0)),o);
 let m=SNF.find(x=>at(x[0],0));if(!m&&tx('RIFF',0)&&tx('WEBP',8))m=[0,'image/webp','.webp'];
 if(!m&&tx('ftyp',4)){const t=String.fromCharCode(...h.slice(8,12));m=/avif|avis/.test(t)?[0,'image/avif','.avif']:[0,'image/heic','.heic'];return{b:new Blob([b],{type:m[1]}),mime:m[1],ext:m[2]}}
 if(!m)return null;
 if(typeof createImageBitmap==='function'){try{const bm=await createImageBitmap(b);const ok=bm.width>0&&bm.height>0;if(bm.close)bm.close();if(!ok)return null}catch(e){return null}}
 return{b:new Blob([b],{type:m[1]}),mime:m[1],ext:m[2]}}
async function galOne(du,nm){const r=await imgReal(du);if(!r)return false;await gal({b:r.b,name:nm+r.ext,mime:r.mime});return true}
/* שמירה בגלריה (Pictures/LargePami); כמה עמודים – כל עמוד כתמונה נפרדת */
ACT.vwGal=el=>busy(el,async()=>{if(!VW||VW.pdf)return;const P=(VW.pgs||[]).filter(imgOk);if(!P.length)return toast('התמונה לא תקינה ולא תישמר');
 try{const b0=base()+'_'+Date.now().toString(36);let bad=0;for(let i=0;i<P.length;i++){if(!await galOne(P[i],b0+(P.length>1?'_'+(i+1):'')))bad++}
  if(bad)toast(bad===P.length?'התמונה פגומה ולא נשמרה':bad+' תמונות פגומות לא נשמרו')}
 catch(e){toast('השמירה נכשלה: '+(e&&e.message||e))}});
/* תמונה בבקשה של עובד (שרשור "בקשות מעובדים"): כפתור "שמירה בגלריה" מתחת לכל תמונה */
ACT.rqImGal=el=>busy(el,async()=>{const w=el.closest('.rqim'),im=w&&w.querySelector('img'),u=im&&im.getAttribute('src');
 try{if(!await galOne(u,'LargePami_request_'+Date.now().toString(36)))toast('התמונה פגומה ולא נשמרה')}catch(e){toast('השמירה נכשלה: '+(e&&e.message||e))}});
/* לחיצה ארוכה על תמונה בבקשה: לא פותחים את תפריט המערכת (שמירה משם יוצרת קובץ שלא נפתח). נגיעה רגילה – מסך הצפייה */
document.addEventListener('contextmenu',e=>{const t=e.target;if(t&&t.tagName==='IMG'&&t.closest&&t.closest('.rqim'))e.preventDefault()},true);
/* PDF: שמירה במכשיר (חלון "שמירה בשם" בטלפון, הורדה בדפדפן) */
ACT.vwSave=el=>busy(el,async()=>{if(!VW||!VW.pdf)return;if(!pdfDU(VW.du))return toast('הקובץ לא תקין ולא יישמר');
 try{await outSave({name:base()+'.pdf',data:new Uint8Array(await du2b(VW.du).arrayBuffer()),mime:'application/pdf'},'dl')}catch(e){toast('השמירה נכשלה: '+(e&&e.message||e))}});

/* ---- מסכים שהייתה להם הגדלה משלהם – עכשיו פותחים את מסך הצפייה האחיד ---- */
ACT.wkScView=()=>{if(typeof OC!=='undefined'&&OC&&OC.img0&&typeof WK!=='undefined'&&WK.pages&&WK.pages.length)viewImg(null,'invoice',WK.pages.length===1?WK.pages[0]:'PAGES:'+JSON.stringify(WK.pages))};
const srcView=(el,n)=>{const u=el&&el.getAttribute('src');if(imgOk(u))viewImg(null,n,u);else toast('התמונה לא תקינה ולא תוצג')};
ACT.fbZ2=el=>srcView(el,'LargePami_page');
ACT.hsZoom=el=>srcView(el,'LargePami_item');

/* ---- נגיעה בכל תמונה מוצגת (בלי פעולה משלה) – מסך הצפייה ---- */
const VZ_NO_IN='a,button,label,summary,[data-a],[data-nozoom],[contenteditable],#viewer,#fbburst,.s3wppv';
const VZ_NO='#fbim,#usimg,#shPrev,[id^="lblBI-"],.s3pv';
const b2du=b=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>rej(r.error);r.readAsDataURL(b)});
document.addEventListener('click',async e=>{const im=e.target;if(e.defaultPrevented||!im||im.tagName!=='IMG')return;
 if(im.matches(VZ_NO)||im.closest(VZ_NO_IN))return;if((im.clientWidth||0)<40&&(im.clientHeight||0)<40)return;
 const src=im.getAttribute('src')||'';
 if(/^data:image\//.test(src)){if(!imgOk(src))return;e.preventDefault();viewImg(null,'LargePami_image',src);return}
 if(/^blob:/.test(src)){e.preventDefault();try{const b=await (await fetch(src)).blob();if(!/^image\//.test(b.type))return;const du=await b2du(b);if(imgOk(du))viewImg(null,'LargePami_image',du)}catch(err){}}});
})();
