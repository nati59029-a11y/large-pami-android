/* סיור 360 – ניסוי בטלפון (שלב 18, סבב 1). זמני: יוסר או יוחלף בשילוב המלא (18ד/18ה).
   מוסיף במסך "החנות בתלת מימד", למי שרשאי להקים מפה, כרטיס "ניסוי: צילום 360". הצילום מתבצע ב-S3PanoCap,
   ומוצג מיד ב-S3Pano מתוך הזיכרון בלבד. שום דבר לא נשמר בשרת או במכשיר. אפשר לשתף את התמונה (כדי לשלוח לבדיקה).
   נטען אחרי store3d.js, store3d-pano.js ו-store3d-pano-cap.js. */
(function(){
'use strict';
if(typeof V==='undefined'||typeof V.st3!=='function'||typeof ACT==='undefined'||!window.S3UI)return;
const U=window.S3UI;
const ok=()=>{try{return U.feat()&&U.canDraw()&&!!window.S3PanoCap&&!!window.S3Pano}catch(e){return false}};
const r0=V.st3;
V.st3=function(){const r=r0.apply(this,arguments);
  try{if(r&&typeof r.h==='string'&&ok())r.h+=`<div class="card s3s" style="margin-top:12px"><b>ניסוי: צילום 360</b><p class="note s3note" style="margin:6px 0 10px">עומדים במקום אחד, מסובבים את הטלפון לפי הנקודות, ורואים את החנות כמו בסיור. זה ניסוי בלבד: שום דבר לא נשמר.</p><button class="btn" data-a="s3pTry">התחלת ניסוי</button></div>`}catch(e){}
  return r};
let busy=false;
function layer(){const d=document.createElement('div');d.dir='rtl';d.style.cssText='position:fixed;inset:0;z-index:9999;background:#111114';document.body.appendChild(d);return d}
function bar(el,res,again,done){const b=document.createElement('div');
  b.style.cssText='position:absolute;bottom:calc(10px + env(safe-area-inset-bottom,0px));inset-inline:0;display:flex;gap:8px;justify-content:center;z-index:5;pointer-events:none';
  const mk=(t,f)=>{const x=document.createElement('button');x.type='button';x.className='btn';x.textContent=t;x.style.pointerEvents='auto';x.onclick=f;b.appendChild(x);return x};
  mk('צילום חדש',again);
  if(navigator.canShare){const f=new File([res.full],'pano360.jpg',{type:'image/jpeg'});if(navigator.canShare({files:[f]}))mk('שיתוף התמונה',()=>navigator.share({files:[f],title:'צילום 360'}).catch(()=>{}))}
  b.style.bottom='calc(70px + env(safe-area-inset-bottom,0px))';el.appendChild(b)}
async function run(){if(busy)return;busy=true;const el=layer();let h=null;
  const close=()=>{if(closeCur!==close)return;closeCur=null;try{if(h)h.destroy()}catch(e){}try{S3PanoCap.close()}catch(e){}el.remove();busy=false};closeCur=close;
  try{
    const res=await S3PanoCap.start(el,{});
    if(!res){close();return}
    el.innerHTML='';
    const tour={pts:[{id:'a',x:0,y:0,yaw:0,full:'mem:full',sm:'mem:sm',nb:[]}],start:'a'};
    h=await S3Pano.open(el,tour,{load:p=>Promise.resolve(p==='mem:full'?res.full:res.sm),onClose:close});
    if(!h){return}
    bar(el,res,()=>{close();setTimeout(run,50)},close);
    if(typeof toast==='function')toast(`הצילום חובר: ${res.meta&&res.meta.n||'?'} תמונות, ${Math.round(res.full.size/1024)}KB`);
  }catch(e){console.error(e);close();if(typeof toast==='function')toast('הניסוי נכשל: '+(e&&e.message||e))}}
ACT.s3pTry=()=>{run()};
/* כפתור "חזרה" של אנדרואיד: hookNative ב-index.html קורא ל-goBack(). כשהניסוי פתוח – סוגרים אותו במקום לנווט מאחוריו */
let closeCur=null;
if(typeof window.goBack==='function'){const g0=window.goBack;window.goBack=function(){if(closeCur){try{if(window.S3PanoCap&&S3PanoCap.isOpen())S3PanoCap.close();else closeCur()}catch(e){}return true}return g0.apply(this,arguments)}}
})();
