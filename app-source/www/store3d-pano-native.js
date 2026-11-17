/* store3d-pano-native.js – שלב 21ג (משימה 2026-11-14_סריקת-חנות-תלת-מימד): חיבור 360 באיכות גבוהה בתוסף Android ‏PanoStitch (OpenCV, android-plugin/PanoStitchCore.java).
   window.S3PanoNative:
     available() -> Promise<bool>   יש תוסף PanoStitch והספרייה נטענה (רק arm64-v8a; ב-APK ישן, x86 או armv7 – false). תשובה חיובית/שלילית מהתוסף נשמרת לכל ההפעלה.
     stitch(frames,{fovL,yawRef,W},onP) -> Promise<{full:Blob(jpeg), fovL, stats}>   זורק בכל כשלון – הקורא חוזר לחיבור ב-JS (store3d-pano-cap.js).
       frames: [{blob:JPEG, q:[w,x,y,z] מצלמה→עולם, w, h, yaw, role?:'nadir', g?, ev? (שלב 21ו – קבוצת HDR ו-‎-1/0/1; כל אחד עובר ל-addFrame רק אם מוגדר)}] – אותה מוסכמה כמו store3d-pano-cap.js; yawRef ברירת מחדל = frames[0].yaw; W ברירת מחדל 4096.
       הפריימים נשלחים אחד-אחד (base64) כדי לא להחזיק את כולם פעמיים בזיכרון. onP(p) מקבל 0..1.
     cancel() – עוצר חיבור פעיל (stitch נדחה).
   ב-Node: require(...)(root) – לבדיקות עם Capacitor מדומה. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory;else root.S3PanoNative=factory(root)})(typeof self!=='undefined'?self:this,function(root){
'use strict';
let avail=null,busy=false;
function plug(){try{const C=root.Capacitor;return C&&C.Plugins&&C.Plugins.PanoStitch||null}catch(e){return null}}
function available(){if(avail)return avail;const P=plug();if(!P||typeof P.isAvailable!=='function')return Promise.resolve(false)/* לא נשמר: אין תוסף (או שעדיין לא נטען) */;
 avail=Promise.resolve().then(()=>P.isAvailable()).then(r=>!!(r&&r.ok),()=>false);return avail}
async function b64(blob){const ab=await(blob.arrayBuffer?blob.arrayBuffer():new Response(blob).arrayBuffer()),u=new Uint8Array(ab);let s='';
 for(let i=0;i<u.length;i+=0x8000)s+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000));return root.btoa(s)}
function unb64(s){const b=root.atob(s),u=new Uint8Array(b.length);for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return new root.Blob([u],{type:'image/jpeg'})}
async function stitch(frames,o,onP){
 o=o||{};const P0=typeof onP==='function'?onP:()=>{};const prog=p=>{try{P0(p)}catch(e){}};
 if(busy)throw new Error('busy');if(!frames||!frames.length)throw new Error('no frames');
 if(!(await available()))throw new Error('unavailable');
 const P=plug(),f0=frames[0];busy=true;let sub=null;
 try{
  await P.begin({n:frames.length,W:o.W||4096,fovL:+o.fovL,yawRef:o.yawRef!=null?+o.yawRef:+f0.yaw||0,w:f0.w,h:f0.h});
  try{sub=await P.addListener('progress',e=>{const p=+(e&&e.p);if(p>=0)prog(.15+.85*Math.min(1,p))})}catch(e){sub=null}
  for(let i=0;i<frames.length;i++){const fr=frames[i];if(!fr||!fr.blob||!fr.q||fr.q.length!==4)throw new Error('bad frame '+i);
   const af={i,jpeg:await b64(fr.blob),q:fr.q.map(Number)};if(fr.role!==undefined)af.role=fr.role;if(fr.g!==undefined&&fr.g!==null)af.g=+fr.g;if(fr.ev!==undefined&&fr.ev!==null)af.ev=+fr.ev;await P.addFrame(af);prog(.15*(i+1)/frames.length)}
  const r=await P.run();
  if(!r||typeof r.jpeg!=='string'||!r.jpeg)throw new Error('empty result');
  const full=unb64(r.jpeg);if(!full.size)throw new Error('empty result');
  prog(1);return{full,fovL:+r.fovL||+o.fovL,stats:r.stats||null}
 }catch(e){try{await P.cancel()}catch(_){}throw e}
 finally{busy=false;if(sub){try{await sub.remove()}catch(e){}}}}
function cancel(){const P=plug();if(P&&busy){try{P.cancel()}catch(e){}}}
return{available,stitch,cancel}});
