/* store3d-pano-cap.js – שלב 18ו (משימה 2026-11-14_סריקת-חנות-תלת-מימד): צילום 360 מודרך בטלפון, והחיבור לתמונת equirectangular – הכול בטלפון.
   נטען בדפדפן כ-window.S3PanoCap, וב-Node דרך require (רק החלק המתמטי S3PanoCap._m, לבדיקות יחידה).
   S3PanoCap.start(el, opts) -> Promise<{full:Blob, sm:Blob, w, h, meta:{n, fovH, fovL, yawRef, dev, ms}} | null>   (null = ביטול או שגיאה, אחרי הודעה בעברית)
   S3PanoCap.close() – סוגר מסך פתוח (ל"חזרה" של אנדרואיד) ומחזיר true אם היה פתוח; S3PanoCap.isOpen().
     opts.fov   – שדה ראייה של הצלע הארוכה במעלות (לא חובה; אחרת: כיול שנשמר בטלפון, אחרת 65°, ואחרי הצילום כיול אוטומטי מהחפיפה)
     opts.mock  – לבדיקות בלבד: {camera:{el, w, h, stop?}, sensor:(cb, api)=>stopFn, angle?}. cb מקבל {alpha, beta, gamma, angle}.
   מצלמה: getUserMedia בתוך ה-WebView (כמו "צילום רציף" ב-index.html; ההרשאה CAMERA כבר ב-patch-android.sh). חיישן: אירוע deviceorientation (בלי הרשאת Android).
   מוסכמות: עולם x=מזרח, y=צפון, z=למעלה (כמו W3C DeviceOrientation, אבל alpha יחסי – לא צפון אמיתי). מצלמה: x ימינה במסך, y למעלה במסך, מסתכלת ל-z-.
   equirect: מרכז התמונה (u=0.5) = כיוון הפריים הראשון (yawRef); ימינה בתמונה = סיבוב עם כיוון השעון (מבט מלמעלה); שורה עליונה = זנית. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.S3PanoCap=factory()})(typeof self!=='undefined'?self:this,function(){
'use strict';
const D=Math.PI/180;
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
/* ספי פתיחה – (לא מאומת) – לכוונון אחרי בדיקה בטלפון */
const FOV_DEF=65/* צלע ארוכה, מצלמה ראשית רגילה */,OVERLAP=.3,AIM_TOL=5,STAB_MS=300,STAB_DEG=1.2,FRAME_MAX=1280,FEATHER_POW=2,
  FULL_MAX=2500000,SM_MAX=150000,FOV_KEY='lp-s3pc-fovL';

/* ---------------- מתמטיקה טהורה ---------------- */
/* קווטרניון [w,x,y,z] */
function qMul(a,b){return[a[0]*b[0]-a[1]*b[1]-a[2]*b[2]-a[3]*b[3],a[0]*b[1]+a[1]*b[0]+a[2]*b[3]-a[3]*b[2],a[0]*b[2]-a[1]*b[3]+a[2]*b[0]+a[3]*b[1],a[0]*b[3]+a[1]*b[2]-a[2]*b[1]+a[3]*b[0]]}
function qNorm(q){const n=Math.hypot(q[0],q[1],q[2],q[3])||1;return[q[0]/n,q[1]/n,q[2]/n,q[3]/n]}
function qAxis(ax,deg){const h=deg*D/2,s=Math.sin(h);return[Math.cos(h),ax===0?s:0,ax===1?s:0,ax===2?s:0]}
/* alpha/beta/gamma (מעלות, W3C: R=Rz(alpha)·Rx(beta)·Ry(gamma)) + זווית המסך (screen.orientation.angle) ⇒ קווטרניון מצלמה→עולם */
function oriToQuat(alpha,beta,gamma,screenDeg){return qNorm(qMul(qMul(qMul(qAxis(2,alpha||0),qAxis(0,beta||0)),qAxis(1,gamma||0)),qAxis(2,-(screenDeg||0))))}
/* מטריצה 3x3 (שורות) מצלמה→עולם */
function qToMat(q){const[w,x,y,z]=q;return[1-2*(y*y+z*z),2*(x*y-w*z),2*(x*z+w*y),2*(x*y+w*z),1-2*(x*x+z*z),2*(y*z-w*x),2*(x*z-w*y),2*(y*z+w*x),1-2*(x*x+y*y)]}
/* זווית (מעלות) בין שני כיוונים מלאים */
function qAngle(a,b){const d=Math.abs(a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3]);return 2*Math.acos(Math.min(1,d))/D}
function camFwd(q){const m=qToMat(q);return[-m[2],-m[5],-m[8]]}
function dirOf(yaw,pitch){const cp=Math.cos(pitch*D);return[cp*Math.sin(yaw*D),cp*Math.cos(yaw*D),Math.sin(pitch*D)]}
function yawPitch(q){const f=camFwd(q);return{yaw:Math.atan2(f[0],f[1])/D,pitch:Math.asin(clamp(f[2],-1,1))/D}}
const wrap180=a=>{a=(a+180)%360;if(a<0)a+=360;return a-180};
const angDir=(a,b)=>Math.acos(clamp(a[0]*b[0]+a[1]*b[1]+a[2]*b[2],-1,1))/D;
/* שדה ראייה של הצלע הארוכה ⇒ רוחב/גובה של הפריים (מעלות) ומוקד בפיקסלים */
function fovOf(fovLong,w,h){const L=Math.max(w,h),f=(L/2)/Math.tan(fovLong*D/2);return{fw:2*Math.atan(w/2/f)/D,fh:2*Math.atan(h/2/f)/D,f}}
const fovLongOf=(fw,w,h)=>{const f=(w/2)/Math.tan(fw*D/2);return 2*Math.atan(Math.max(w,h)/2/f)/D};
/* נקודות יעד על הכדור לפי שדה הראייה של הפריים (fw רוחב, fh גובה), עם חפיפה. סדר: שורת האופק, אחריה למעלה/למטה לסירוגין, בסוף זנית ונדיר. yaw יחסי לכיוון ההתחלה. */
function pickTargets(fw,fh,overlap){
 const ov=overlap==null?OVERLAP:overlap,hs=Math.max(5,fw*(1-ov)),vs=Math.max(5,fh*(1-ov)),k=Math.max(1,Math.ceil((90-.15*fh)/vs))/* הזנית/נדיר מכסים כיפה, ולכן המרווח האחרון יכול להיות מעט גדול יותר */,rows=[0];
 for(let i=1;i<k;i++)rows.push(i*90/k,-i*90/k);rows.push(90,-90);
 const out=[];rows.forEach((p,ri)=>{const n=Math.abs(p)>89.9?1:Math.max(3,Math.ceil(360*Math.cos(p*D)/hs)),off=ri%2&&n>1?180/n:0;
  for(let j=0;j<n;j++)out.push({yaw:wrap180(off+j*360/n),pitch:p,row:ri})});
 return out}
/* פיקסל במצלמה (u,v בפיקסלים, מרכז הפריים cx,cy) של כיוון עולם d. null אם מאחור. */
function projToFrame(m,d,f,cx,cy){
 const x=m[0]*d[0]+m[3]*d[1]+m[6]*d[2],y=m[1]*d[0]+m[4]*d[1]+m[7]*d[2],z=m[2]*d[0]+m[5]*d[1]+m[8]*d[2];
 if(z>=-1e-6)return null;const iz=-1/z;return[cx+f*x*iz,cy-f*y*iz]}
/* פיקסל equirect (x,y; W×H; מרכז yawRef) ⇒ כיוון עולם */
function eqDir(x,y,W,H,yawRef){const lon=((x+.5)/W-.5)*360+(yawRef||0),lat=(.5-(y+.5)/H)*180;return dirOf(lon,lat)}
function eqToFrame(x,y,W,H,yawRef,q,fr){const m=qToMat(q),c=fovOf(fr.fovL,fr.w,fr.h);return projToFrame(m,eqDir(x,y,W,H,yawRef),c.f,fr.w/2,fr.h/2)}

/* טביעת הרגל של פריים על ה-equirect: טווח שורות ועמודות (עמודות יכולות "לעטוף") */
function footprint(m,f,w,h,W,H,yawRef){
 const N=12,pts=[];for(let i=0;i<=N;i++){const t=i/N;pts.push([t*w,0],[t*w,h],[0,t*h],[w,t*h])}pts.push([w/2,h/2]);
 const fw=[-m[2],-m[5],-m[8]],lc=Math.atan2(fw[0],fw[1])/D;let la0=90,la1=-90,dl0=180,dl1=-180,full=false;
 for(const[u,v]of pts){const cx=(u-w/2)/f,cy=-(v-h/2)/f,dx=m[0]*cx+m[1]*cy-m[2],dy=m[3]*cx+m[4]*cy-m[5],dz=m[6]*cx+m[7]*cy-m[8],n=Math.hypot(dx,dy,dz);
  const lat=Math.asin(clamp(dz/n,-1,1))/D,dl=wrap180(Math.atan2(dx,dy)/D-lc);la0=Math.min(la0,lat);la1=Math.max(la1,lat);dl0=Math.min(dl0,dl);dl1=Math.max(dl1,dl);if(Math.abs(dl)>150)full=true}
 for(const s of[1,-1]){const p=projToFrame(m,[0,0,s],f,w/2,h/2);if(p&&p[0]>=0&&p[0]<=w&&p[1]>=0&&p[1]<=h){full=true;if(s>0)la1=90;else la0=-90}}
 const y0=Math.max(0,Math.floor((.5-la1/180)*H)-2),y1=Math.min(H-1,Math.ceil((.5-la0/180)*H)+2);
 if(full||dl1-dl0>300)return{y0,y1,x0:0,x1:W-1};
 const rel=wrap180(lc-(yawRef||0));return{y0,y1,x0:Math.floor(((rel+dl0)/360+.5)*W)-2,x1:Math.ceil(((rel+dl1)/360+.5)*W)+2}}

/* מאגר equirect אחד שאליו ממזגים פריים אחרי פריים (ממוצע משוקלל רץ; משקל = מרחק ממרכז הפריים).
   זיכרון: RGBA 8 ביט + משקל 16 ביט לכל פיקסל (4096×2048 ≈ 50MB). */
function makePano(W,H,yawRef){
 const col=new Uint8ClampedArray(W*H*4),wt=new Uint16Array(W*H),sLo=new Float32Array(W),cLo=new Float32Array(W),sLa=new Float32Array(H),cLa=new Float32Array(H);
 for(let x=0;x<W;x++){const a=(((x+.5)/W-.5)*360+(yawRef||0))*D;sLo[x]=Math.sin(a);cLo[x]=Math.cos(a)}
 for(let y=0;y<H;y++){const a=(.5-(y+.5)/H)*Math.PI;sLa[y]=Math.sin(a);cLa[y]=Math.cos(a)}
 for(let i=3;i<col.length;i+=4)col[i]=255;
 /* מעבר על טביעת הרגל; fn(i, r,g,b, weight) */
 function each(fr,step,fn){
  const m=qToMat(fr.q),c=fovOf(fr.fovL,fr.w,fr.h),f=c.f,w=fr.w,h=fr.h,hw=w/2,hh=h/2,d=fr.data,fp=footprint(m,f,w,h,W,H,yawRef);
  for(let y=fp.y0;y<=fp.y1;y+=step){const sl=sLa[y],cl=cLa[y];
   for(let xx=fp.x0;xx<=fp.x1;xx+=step){const x=((xx%W)+W)%W,d0=cl*sLo[x],d1=cl*cLo[x];
    const z=m[2]*d0+m[5]*d1+m[8]*sl;if(z>=-1e-6)continue;const iz=-f/z;
    const u=hw+(m[0]*d0+m[3]*d1+m[6]*sl)*iz,v=hh-(m[1]*d0+m[4]*d1+m[7]*sl)*iz;
    const nx=Math.abs(u-hw)/hw,ny=Math.abs(v-hh)/hh;if(nx>=1||ny>=1)continue;
    const fx=u-.5,fy=v-.5,ix=fx<0?0:fx>w-1.001?w-2:Math.floor(fx),iy=fy<0?0:fy>h-1.001?h-2:Math.floor(fy),ax=clamp(fx-ix,0,1),ay=clamp(fy-iy,0,1);
    const p=(iy*w+ix)*4,q=p+w*4,w00=(1-ax)*(1-ay),w10=ax*(1-ay),w01=(1-ax)*ay,w11=ax*ay;
    fn(y*W+x,d[p]*w00+d[p+4]*w10+d[q]*w01+d[q+4]*w11,d[p+1]*w00+d[p+5]*w10+d[q+1]*w01+d[q+5]*w11,d[p+2]*w00+d[p+6]*w10+d[q+2]*w01+d[q+6]*w11,Math.pow((1-nx)*(1-ny),FEATHER_POW))}}}
 /* פריים: {data(RGBA), w, h, q, fovL}. מחזיר את תיקון הבהירות שהוחל. */
 function add(fr){
  let sa=0,sf=0,n=0;each(fr,3,(i,r,g,b,k)=>{if(wt[i]>0&&k>.02){const j=i*4;sa+=col[j]*.299+col[j+1]*.587+col[j+2]*.114;sf+=r*.299+g*.587+b*.114;n++}});
  const gain=n>=60&&sf>0?clamp(sa/sf,.6,1.6):1;
  each(fr,1,(i,r,g,b,k)=>{const W0=wt[i]/4096,tot=W0+k;if(tot<=0)return;const a=k/tot,j=i*4;
   col[j]+=(r*gain-col[j])*a;col[j+1]+=(g*gain-col[j+1])*a;col[j+2]+=(b*gain-col[j+2])*a;wt[i]=Math.min(65535,Math.max(1,Math.round(tot*4096)))});
  return gain}
 /* חורים (בדרך כלל זנית/נדיר): צבע ממוצע מטושטש מרשת נמוכה */
 function fill(){
  const GW=64,GH=32,S=new Float32Array(GW*GH*3),C=new Float32Array(GW*GH);let holes=0;
  for(let y=0;y<H;y++){const gy=Math.min(GH-1,(y*GH/H)|0);for(let x=0;x<W;x++){const i=y*W+x;if(!wt[i]){holes++;continue}const g=gy*GW+Math.min(GW-1,(x*GW/W)|0),j=i*4;S[g*3]+=col[j];S[g*3+1]+=col[j+1];S[g*3+2]+=col[j+2];C[g]++}}
  if(!holes)return 0;
  let G=new Float32Array(GW*GH*3),ok=new Uint8Array(GW*GH),left=0;
  for(let g=0;g<GW*GH;g++){if(C[g]>0){ok[g]=1;for(let c=0;c<3;c++)G[g*3+c]=S[g*3+c]/C[g]}else left++}
  if(left===GW*GH){G.fill(96);left=0;ok.fill(1)}
  for(let it=0;left>0&&it<GW+GH;it++){const ok2=ok.slice(),G2=G.slice();
   for(let gy=0;gy<GH;gy++)for(let gx=0;gx<GW;gx++){const g=gy*GW+gx;if(ok[g])continue;let r=0,gg=0,b=0,k=0;
    const nb=[[gx-1,gy],[gx+1,gy],[gx,gy-1],[gx,gy+1]];for(const[a,c]of nb){if(c<0||c>=GH)continue;const h2=c*GW+((a+GW)%GW);if(ok[h2]){r+=G[h2*3];gg+=G[h2*3+1];b+=G[h2*3+2];k++}}
    if(!k&&(gy===0||gy===GH-1)){/* שורת קוטב: ממוצע השורה */for(let a=0;a<GW;a++){const h2=gy*GW+a;if(ok[h2]){r+=G[h2*3];gg+=G[h2*3+1];b+=G[h2*3+2];k++}}}
    if(k){G2[g*3]=r/k;G2[g*3+1]=gg/k;G2[g*3+2]=b/k;ok2[g]=1;left--}}
   ok=ok2;G=G2}
  for(let pass=0;pass<3;pass++){const G2=G.slice();for(let gy=0;gy<GH;gy++)for(let gx=0;gx<GW;gx++){const g=gy*GW+gx;for(let c=0;c<3;c++){let s=0,k=0;
   for(let dy=-1;dy<=1;dy++){const yy=gy+dy;if(yy<0||yy>=GH)continue;for(let dx=-1;dx<=1;dx++){s+=G[(yy*GW+((gx+dx+GW)%GW))*3+c];k++}}G2[g*3+c]=s/k}}G=G2}
  for(let y=0;y<H;y++){const fy=clamp(y*GH/H-.5,0,GH-1),y0=Math.min(GH-2,fy|0),ay=fy-y0;
   for(let x=0;x<W;x++){const i=y*W+x;if(wt[i])continue;const fx=x*GW/W-.5,x0=Math.floor(fx),ax=fx-x0,a0=(x0+GW)%GW,a1=(x0+1)%GW,j=i*4;
    for(let c=0;c<3;c++)col[j+c]=(G[(y0*GW+a0)*3+c]*(1-ax)+G[(y0*GW+a1)*3+c]*ax)*(1-ay)+(G[((y0+1)*GW+a0)*3+c]*(1-ax)+G[((y0+1)*GW+a1)*3+c]*ax)*ay}}
  return holes}
 return{W,H,col,wt,add,fill,each}}

/* כיול שדה ראייה מהחפיפה: מנסה ערכים ומודד את אי-ההתאמה בין פריימים חופפים (על equirect קטן, בהירות מנורמלת לכל פריים).
   frames: [{data,w,h,q}] קטנים. מחזיר {fovL, score, base} או null אם אין מספיק חפיפה. */
function estFov(frames,def,yawRef){
 if(!frames||frames.length<2)return null;const W=512,H=256,P=makePano(W,H,yawRef);
 const means=frames.map(fr=>{let s=0;const d=fr.data;for(let i=0;i<d.length;i+=16)s+=d[i]*.299+d[i+1]*.587+d[i+2]*.114;return Math.max(1,s/(d.length/16))});
 const S=new Float32Array(W*H),S2=new Float32Array(W*H),N=new Uint8Array(W*H);
 function score(fovL){S.fill(0);S2.fill(0);N.fill(0);
  frames.forEach((fr,k)=>{const m=means[k];P.each(Object.assign({},fr,{fovL}),2,(i,r,g,b)=>{const l=(r*.299+g*.587+b*.114)/m;S[i]+=l;S2[i]+=l*l;N[i]++})});
  let v=0,n=0;for(let i=0;i<W*H;i++)if(N[i]>=2){v+=S2[i]/N[i]-(S[i]/N[i])**2;n++}return n>=150?v/n:Infinity}
 const lo=def*.75,hi=Math.min(110,def*1.35);let best=def,bs=score(def);const base=bs;if(!isFinite(bs))return null;
 for(let f=lo;f<=hi+1e-9;f+=2.5){const s=score(f);if(s<bs){bs=s;best=f}}
 for(let f=best-2;f<=best+2+1e-9;f+=.5){const s=score(f);if(s<bs){bs=s;best=f}}
 return{fovL:best,score:bs,base}}

const M={qMul,qNorm,qAxis,oriToQuat,qToMat,qAngle,camFwd,dirOf,yawPitch,wrap180,angDir,fovOf,fovLongOf,pickTargets,projToFrame,eqDir,eqToFrame,footprint,makePano,estFov,
  C:{FOV_DEF,OVERLAP,AIM_TOL,STAB_MS,STAB_DEG,FRAME_MAX,FULL_MAX,SM_MAX}};
if(typeof document==='undefined')return{_m:M};

/* ---------------- דפדפן: מסך הצילום ---------------- */
const CSS=`.s3pc{position:fixed;inset:0;z-index:10050;background:#000;color:#f3ead7;font-family:"IBM Plex Sans Hebrew","Noto Sans Hebrew",Heebo,Roboto,Arial,sans-serif;direction:rtl;overflow:hidden;touch-action:none;user-select:none}
.s3pc .s3pc-cam{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#000}
.s3pc canvas.s3pc-ov{position:absolute;inset:0;width:100%;height:100%}
.s3pc .s3pc-top{position:absolute;top:0;left:0;right:0;padding:calc(8px + env(safe-area-inset-top,0px)) 12px 8px;background:rgba(12,12,14,.74);border-bottom:1px solid rgba(212,175,55,.45);text-align:center}
.s3pc .s3pc-ins{font-size:13px;line-height:1.35;color:#e9dcb8}
.s3pc .s3pc-cnt{font-size:18px;font-weight:700;color:#d4af37;margin-top:2px}
.s3pc .s3pc-hint{font-size:14px;min-height:20px;color:#fff}
.s3pc .s3pc-bar{position:absolute;bottom:0;left:0;right:0;display:flex;gap:8px;padding:10px 10px calc(10px + env(safe-area-inset-bottom,0px));background:rgba(12,12,14,.74);border-top:1px solid rgba(212,175,55,.45)}
.s3pc button{flex:1;min-height:44px;min-width:0;border-radius:12px;border:1px solid #d4af37;background:#1d1d22;color:#f1d77a;font:inherit;font-size:14px;padding:6px 8px;cursor:pointer}
.s3pc button.s3pc-pri{background:#d4af37;color:#17140a;font-weight:700}
.s3pc button:disabled{opacity:.4}
.s3pc .s3pc-fl{position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none;transition:opacity .25s}
.s3pc .s3pc-fl.on{opacity:.55;transition:none}
.s3pc .s3pc-msg{position:absolute;inset:0;display:none;align-items:center;justify-content:center;padding:20px;background:rgba(8,8,10,.92)}
.s3pc .s3pc-msg.on{display:flex}
.s3pc .s3pc-card{max-width:420px;width:100%;background:#1b1b20;border:1px solid #d4af37;border-radius:16px;padding:18px 16px;text-align:center;line-height:1.5}
.s3pc .s3pc-card b{display:block;color:#d4af37;font-size:17px;margin-bottom:6px}
.s3pc .s3pc-pb{height:8px;border-radius:4px;background:#333;overflow:hidden;margin:12px 0 4px}
.s3pc .s3pc-pb i{display:block;height:100%;width:0;background:#d4af37}
.s3pc .s3pc-card button{margin-top:14px;width:100%}
@media (min-width:600px){.s3pc .s3pc-ins{font-size:15px}.s3pc .s3pc-bar{justify-content:center}.s3pc .s3pc-bar button{flex:0 1 200px}}`;
function css(){if(document.getElementById('s3pc-css'))return;const s=document.createElement('style');s.id='s3pc-css';s.textContent=CSS;document.head.appendChild(s)}
const lsG=k=>{try{return localStorage.getItem(k)}catch(e){return null}};
const lsS=(k,v)=>{try{localStorage.setItem(k,v)}catch(e){}};
const blobOf=(c,q)=>new Promise(r=>c.toBlob(r,'image/jpeg',q));
const cv=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c};
const tick=()=>new Promise(r=>setTimeout(r,0));
async function decodeBlob(b){
 if(window.createImageBitmap){try{const i=await createImageBitmap(b);return{src:i,w:i.width,h:i.height,close:()=>{try{i.close()}catch(e){}}}}catch(e){}}
 return new Promise((res,rej)=>{const u=URL.createObjectURL(b),i=new Image();i.onload=()=>res({src:i,w:i.naturalWidth,h:i.naturalHeight,close:()=>URL.revokeObjectURL(u)});i.onerror=()=>{URL.revokeObjectURL(u);rej(new Error('bad'))};i.src=u})}
function pixels(src,w,h){const c=cv(w,h),x=c.getContext('2d',{willReadFrequently:true});x.drawImage(src,0,0,w,h);return x.getImageData(0,0,w,h).data}
function maxTex(){try{const c=cv(1,1),g=c.getContext('webgl')||c.getContext('experimental-webgl');if(!g)return 0;const v=g.getParameter(g.MAX_TEXTURE_SIZE);const l=g.getExtension('WEBGL_lose_context');if(l)l.loseContext();return v||0}catch(e){return 0}}
function devName(){const m=/Android [\d.]+;\s*([^;)]+)/.exec(navigator.userAgent||'');return m?m[1].trim().slice(0,40):''}
function screenAngle(){try{if(screen.orientation&&typeof screen.orientation.angle==='number')return screen.orientation.angle}catch(e){}return typeof window.orientation==='number'?window.orientation:0}
function camErr(e){const n=String(e&&e.name||'');
 if(/NotAllowed|Security|Permission/i.test(n))return'אין הרשאה למצלמה. אשרו מצלמה לאפליקציה בהגדרות הטלפון ונסו שוב.';
 if(/NotFound|Overconstrained|DevicesNotFound/i.test(n))return'לא נמצאה מצלמה בטלפון הזה.';
 if(/NotReadable|TrackStart|Abort/i.test(n))return'המצלמה תפוסה על ידי אפליקציה אחרת. סגרו אותה ונסו שוב.';
 return'המצלמה לא נפתחה. נסו שוב.'}

/* חיבור הפריימים (אחרי הצילום, המצלמה כבר סגורה) */
async function stitch(frames,o,onP){
 const mt=o.maxTex!=null?o.maxTex:maxTex(),low=navigator.deviceMemory&&navigator.deviceMemory<=2,W=o.width||(mt>=4096&&!low?4096:2048),H=W/2;
 const yawRef=frames[0].yaw;let fovL=o.fovL,cal=null;
 if(!o.fixedFov){/* כיול מהחפיפה על עותקים קטנים */
  const sm=[];for(const fr of frames){const d=await decodeBlob(fr.blob);try{const k=320/Math.max(d.w,d.h),w=Math.max(8,Math.round(d.w*k)),h=Math.max(8,Math.round(d.h*k));sm.push({data:pixels(d.src,w,h),w,h,q:fr.q})}finally{d.close()}}
  onP(.08);await tick();cal=estFov(sm,fovL,yawRef);if(cal&&cal.score<cal.base*.92)fovL=cal.fovL;onP(.15);await tick()}
 const P=makePano(W,H,yawRef);
 for(let i=0;i<frames.length;i++){const fr=frames[i],d=await decodeBlob(fr.blob);try{P.add({data:pixels(d.src,d.w,d.h),w:d.w,h:d.h,q:fr.q,fovL})}finally{d.close()}onP(.15+.7*(i+1)/frames.length);await tick()}
 P.fill();onP(.9);await tick();
 const big=cv(W,H);big.getContext('2d').putImageData(new ImageData(P.col,W,H),0,0);
 let full=null;for(const q of[.85,.78,.7,.62,.55]){full=await blobOf(big,q);if(full&&full.size<=FULL_MAX)break}
 const sc=cv(1024,512),sx=sc.getContext('2d');sx.imageSmoothingQuality='high';sx.drawImage(big,0,0,1024,512);big.width=big.height=1;
 let sm=null;for(const q of[.8,.72,.64,.56,.48,.4]){sm=await blobOf(sc,q);if(sm&&sm.size<=SM_MAX)break}
 onP(1);const fw=fovOf(fovL,frames[0].w,frames[0].h).fw;
 return{full,sm,w:W,h:H,fovL,fovH:fw,cal}}

let cur=null;
/* סגירה מבחוץ (למשל כפתור "חזרה" של אנדרואיד): מחזיר true אם היה מסך פתוח; ההבטחה של start מסתיימת ב-null */
function close(){if(!cur)return false;cur(null);return true}
function start(el,opts){
 opts=opts||{};css();
 return new Promise(resolve=>{
  const mock=opts.mock||null,host=el&&el.appendChild?el:document.body;
  const R=document.createElement('div');R.className='s3pc';R.setAttribute('role','dialog');R.setAttribute('aria-label','צילום 360');
  R.innerHTML=`<div class="s3pc-camw"></div><canvas class="s3pc-ov"></canvas><div class="s3pc-fl"></div>
<div class="s3pc-top"><div class="s3pc-ins">עמדו במקום אחד, סובבו את הטלפון סביב העדשה, צלמו כשהחנות ריקה מאנשים</div><div class="s3pc-cnt"></div><div class="s3pc-hint" aria-live="polite"></div></div>
<div class="s3pc-bar"><button type="button" data-k="x">ביטול</button><button type="button" data-k="r" disabled>צלם שוב את האחרונה</button><button type="button" class="s3pc-pri" data-k="d" disabled>סיום</button></div>
<div class="s3pc-msg"><div class="s3pc-card"><b></b><div class="s3pc-mt"></div><div class="s3pc-pb" hidden><i></i></div><button type="button" data-k="c" hidden>סגירה</button></div></div>`;
  host.appendChild(R);
  const $=s=>R.querySelector(s),ov=$('canvas.s3pc-ov'),cnt=$('.s3pc-cnt'),hint=$('.s3pc-hint'),msg=$('.s3pc-msg'),fl=$('.s3pc-fl');
  const S={done:false,stream:null,camEl:null,cw:0,ch:0,stopSensor:null,q:null,hist:[],frames:[],T:[],TD:[],yaw0:null,fovL:0,fw:0,fh:0,raf:0,busy:false,last:0,xArm:0,phase:'init'};
  function cleanup(){if(S.raf)cancelAnimationFrame(S.raf);S.raf=0;try{S.stopSensor&&S.stopSensor()}catch(e){}S.stopSensor=null;
   try{S.stream&&S.stream.getTracks().forEach(t=>t.stop())}catch(e){}S.stream=null;try{mock&&mock.camera&&mock.camera.stop&&mock.camera.stop()}catch(e){}
   if(S.camEl&&S.camEl.tagName==='VIDEO'){try{S.camEl.srcObject=null}catch(e){}}window.removeEventListener('resize',size)}
  function finish(v){if(S.done)return;S.done=true;if(cur===finish)cur=null;cleanup();R.remove();resolve(v)}
  if(cur)cur(null);cur=finish;
  function showMsg(title,text,opt){opt=opt||{};$('.s3pc-card b').textContent=title;$('.s3pc-mt').textContent=text||'';$('.s3pc-pb').hidden=!opt.pb;$('[data-k=c]').hidden=!opt.close;msg.classList.add('on')}
  function fail(text){cleanup();S.phase='err';showMsg('אי אפשר לצלם 360',text,{close:true})}
  R.addEventListener('click',e=>{const b=e.target.closest('button[data-k]');if(!b||b.disabled)return;const k=b.dataset.k;
   if(k==='c')return finish(null);
   if(k==='x'){if(S.phase!=='cap'||S.frames.length<3||Date.now()-S.xArm<2500)return finish(null);S.xArm=Date.now();b.textContent='לבטל? הקישו שוב';setTimeout(()=>{if(!S.done)b.textContent='ביטול'},2500);return}
   if(k==='r'&&S.phase==='cap'){const f=S.frames.pop();if(f)S.T[f.ti].got=false;S.last=Date.now()+750;upd();return}
   if(k==='d'&&S.phase==='cap'&&S.frames.length>=2)return run()});
  function size(){const r=R.getBoundingClientRect(),dp=Math.min(2,window.devicePixelRatio||1);ov.width=Math.max(1,Math.round(r.width*dp));ov.height=Math.max(1,Math.round(r.height*dp))}
  function nextT(){return S.T.findIndex(t=>!t.got)}
  function upd(){const n=S.frames.length,tot=S.T.length;cnt.textContent='צולמו '+n+' מתוך '+tot;
   $('[data-k=r]').disabled=!n;$('[data-k=d]').disabled=n<2;$('[data-k=d]').textContent=n>=tot?'חיבור':'סיום'}
  function stable(now){const h=S.hist;if(!h.length||now-h[0].t<STAB_MS)return 0;let mx=0;for(let i=h.length-1;i>=0&&now-h[i].t<=STAB_MS;i--)mx=Math.max(mx,qAngle(h[i].q,S.q));return mx<=STAB_DEG?1:0}
  function grab(ti){S.busy=true;const k=Math.min(1,FRAME_MAX/Math.max(S.cw,S.ch)),w=Math.round(S.cw*k),h=Math.round(S.ch*k),c=cv(w,h),q=S.q.slice();
   try{c.getContext('2d').drawImage(S.camEl,0,0,w,h)}catch(e){S.busy=false;return}
   const yaw=yawPitch(q).yaw;if(!S.frames.length&&S.yaw0==null)S.yaw0=yaw;S.T[ti].got=true;
   const rec={blob:null,q,ti,w,h,yaw,t:Date.now()};S.frames.push(rec);S.last=Date.now();
   try{navigator.vibrate&&navigator.vibrate(30)}catch(e){}fl.classList.remove('on');void fl.offsetWidth;fl.classList.add('on');setTimeout(()=>fl.classList.remove('on'),60);
   blobOf(c,.9).then(b=>{rec.blob=b;c.width=c.height=1;S.busy=false;if(!b){const i=S.frames.indexOf(rec);if(i>=0){S.frames.splice(i,1);S.T[ti].got=false}}upd();
    if(S.phase==='cap'&&S.frames.length>=S.T.length&&S.T.every(t=>t.got))setTimeout(()=>{if(S.phase==='cap')run()},350)});upd()}
  function loop(){S.raf=requestAnimationFrame(loop);if(S.phase!=='cap'||!S.q)return;const now=performance.now(),g=ov.getContext('2d'),Wd=ov.width,Hd=ov.height;
   g.clearRect(0,0,Wd,Hd);
   const m=qToMat(S.q),sc=Math.max(Wd/S.cw,Hd/S.ch),f=fovOf(S.fovL,S.cw,S.ch).f*sc,cx=Wd/2,cy=Hd/2,fwd=camFwd(S.q),dp=Wd/Math.max(1,R.clientWidth);
   const ni=nextT();let aim=-1,best=1e9;
   if(S.yaw0==null){const yp=yawPitch(S.q);S.base=yp.yaw}
   const y0=S.yaw0!=null?S.yaw0:S.base;
   S.TD=S.T.map(t=>dirOf(t.yaw+y0,t.pitch));
   S.T.forEach((t,i)=>{const a=angDir(fwd,S.TD[i]);if(!t.got&&a<best){best=a;aim=i}
    const p=projToFrame(m,S.TD[i],f,cx,cy);if(!p||p[0]<-40||p[0]>Wd+40||p[1]<-40||p[1]>Hd+40)return;
    g.beginPath();g.arc(p[0],p[1],(t.got?7:i===ni?20:9)*dp,0,Math.PI*2);
    if(t.got){g.fillStyle='rgba(108,196,154,.85)';g.fill()}else if(i===ni){g.lineWidth=4*dp;g.strokeStyle='#d4af37';g.stroke();g.fillStyle='rgba(212,175,55,.25)';g.fill()}else{g.lineWidth=2*dp;g.strokeStyle='rgba(255,255,255,.75)';g.stroke()}});
   const tol=Math.min(AIM_TOL,S.fw*.12),on=aim>=0&&best<=tol,st=on&&stable(Date.now());
   /* כוונת */
   g.beginPath();g.arc(cx,cy,26*dp,0,Math.PI*2);g.lineWidth=3*dp;g.strokeStyle=on?'#fff':'rgba(212,175,55,.9)';g.stroke();
   g.beginPath();g.moveTo(cx-8*dp,cy);g.lineTo(cx+8*dp,cy);g.moveTo(cx,cy-8*dp);g.lineTo(cx,cy+8*dp);g.lineWidth=2*dp;g.stroke();
   if(on){const h=S.hist;let k=0;if(h.length){let t0=Date.now();for(let i=h.length-1;i>=0;i--){if(qAngle(h[i].q,S.q)>STAB_DEG)break;t0=h[i].t}k=clamp((Date.now()-t0)/STAB_MS,0,1)}
    g.beginPath();g.arc(cx,cy,26*dp,-Math.PI/2,-Math.PI/2+k*Math.PI*2);g.lineWidth=6*dp;g.strokeStyle='#d4af37';g.stroke()}
   /* חץ ליעד הבא כשהוא לא על המסך */
   if(ni>=0&&!on){const d=S.TD[ni],x=m[0]*d[0]+m[3]*d[1]+m[6]*d[2],y=m[1]*d[0]+m[4]*d[1]+m[7]*d[2],z=m[2]*d[0]+m[5]*d[1]+m[8]*d[2];
    const p=z<0?[x*f/-z,-y*f/-z]:[x,-y],L=Math.hypot(p[0],p[1]);
    if(z>=0||Math.abs(p[0])>Wd/2-30*dp||Math.abs(p[1])>Hd/2-30*dp){const ux=p[0]/(L||1),uy=p[1]/(L||1),r=Math.min(Wd,Hd)*.3,ax=cx+ux*r,ay=cy+uy*r;
     g.save();g.translate(ax,ay);g.rotate(Math.atan2(uy,ux));g.beginPath();g.moveTo(18*dp,0);g.lineTo(-10*dp,-13*dp);g.lineTo(-4*dp,0);g.lineTo(-10*dp,13*dp);g.closePath();g.fillStyle='#d4af37';g.fill();g.restore()}}
   let h='';if(ni<0)h='כל הנקודות צולמו';else if(on)h=S.busy?'שומר…':'החזיקו יציב…';else{
    const d=S.TD[ni],x=m[0]*d[0]+m[3]*d[1]+m[6]*d[2],y=m[1]*d[0]+m[4]*d[1]+m[7]*d[2];h=Math.abs(x)>=Math.abs(y)?(x>0?'סובבו ימינה אל העיגול הזהוב':'סובבו שמאלה אל העיגול הזהוב'):(y>0?'הטו למעלה אל העיגול הזהוב':'הטו למטה אל העיגול הזהוב')}
   if(hint.textContent!==h)hint.textContent=h;
   if(st&&!S.busy&&Date.now()-S.last>250&&S.camEl&&(S.camEl.videoWidth||S.camEl.width))grab(aim)}
  function onOri(e){if(S.done||e==null||e.alpha==null||e.beta==null||e.gamma==null)return;
   const ang=e.angle!=null?e.angle:mock&&mock.angle!=null?mock.angle:screenAngle();S.q=oriToQuat(+e.alpha,+e.beta,+e.gamma,ang);const t=Date.now();S.hist.push({t,q:S.q});
   while(S.hist.length&&t-S.hist[0].t>STAB_MS+400)S.hist.shift()}
  const api={target:()=>{const i=nextT();if(i<0||!S.T.length)return null;const y0=S.yaw0!=null?S.yaw0:S.base!=null?S.base:0;return{yaw:S.T[i].yaw+y0,pitch:S.T[i].pitch,i}},state:()=>({phase:S.phase,n:S.frames.length,tot:S.T.length})};
  async function run(){if(S.phase!=='cap')return;
   S.phase='stitch';if(S.busy){for(let i=0;i<50&&S.busy;i++)await new Promise(r=>setTimeout(r,50))}
   const frames=S.frames.filter(f=>f.blob);cleanup();if(frames.length<2)return fail('צולמו פחות משתי תמונות.');
   const pb=$('.s3pc-pb i');showMsg('מחבר את התמונות…','זה לוקח כמה שניות. אל תסגרו את האפליקציה.',{pb:true});
   const t0=Date.now();
   try{const r=await stitch(frames,{fovL:S.fovL,fixedFov:!!opts.fov,maxTex:opts.maxTex,width:opts.width},p=>{pb.style.width=Math.round(p*100)+'%';$('.s3pc-mt').textContent='מחבר את התמונות… '+Math.round(p*100)+'%'});
    if(!r.full||!r.sm)throw new Error('encode');
    if(!opts.fov&&r.cal&&r.fovL!==S.fovL)lsS(FOV_KEY,String(Math.round(r.fovL*10)/10));
    finish({full:r.full,sm:r.sm,w:r.w,h:r.h,meta:{n:frames.length,fovH:Math.round(r.fovH*10)/10,fovL:Math.round(r.fovL*10)/10,yawRef:Math.round(frames[0].yaw*100)/100,dev:mock?'mock':devName(),ms:Date.now()-t0}})}
   catch(e){fail('החיבור נכשל (ייתכן שאין מספיק זיכרון בטלפון). נסו שוב.')}}
  /* מכשיר אמיתי: בקשת הרשאת חיישן (אם הדפדפן דורש) חייבת לצאת מיד, בזמן שהלחיצה של המשתמש עוד "טרייה"; לא נכשלים לפי התשובה – רק אם לא מגיעים אירועים */
  let perm=null;
  if(!mock&&typeof DeviceOrientationEvent!=='undefined'){
   try{if(typeof DeviceOrientationEvent.requestPermission==='function')perm=Promise.resolve(DeviceOrientationEvent.requestPermission()).catch(()=>'')}catch(e){}
   const h=e=>onOri(e);window.addEventListener('deviceorientation',h);S.stopSensor=()=>window.removeEventListener('deviceorientation',h)}
  (async()=>{
   showMsg('פותח את המצלמה…','');
   /* מצלמה */
   if(mock){S.camEl=mock.camera.el;S.cw=mock.camera.w||S.camEl.width;S.ch=mock.camera.h||S.camEl.height}
   else{const md=navigator.mediaDevices;if(!md||!md.getUserMedia)return fail('אין גישה למצלמה בטלפון הזה.');
    try{S.stream=await md.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1440}}})}catch(e){return fail(camErr(e))}
    if(S.done)return cleanup();const v=document.createElement('video');v.setAttribute('playsinline','');v.muted=true;v.autoplay=true;v.srcObject=S.stream;S.camEl=v;
    try{await v.play()}catch(e){}
    for(let i=0;i<60&&!v.videoWidth;i++)await new Promise(r=>setTimeout(r,50));
    if(!v.videoWidth)return fail('המצלמה לא נפתחה. נסו שוב.');S.cw=v.videoWidth;S.ch=v.videoHeight}
   if(S.done)return cleanup();
   S.camEl.classList.add('s3pc-cam');$('.s3pc-camw').appendChild(S.camEl);
   /* חיישן כיוון (במכשיר אמיתי המאזין נרשם כבר בהתחלה, למטה) */
   if(mock)S.stopSensor=mock.sensor(onOri,api);
   for(let i=0;i<40&&!S.q&&!S.done;i++)await new Promise(r=>setTimeout(r,50));
   if(S.done)return;
   if(!S.q){const p=perm?await Promise.race([perm,new Promise(r=>setTimeout(()=>r(''),300))]):'';
    return fail(p==='denied'?'אין הרשאה לחיישן הכיוון של הטלפון, ובלעדיו אי אפשר לצלם 360.':'חיישן הכיוון של הטלפון לא עונה (אין ג\'ירוסקופ או שהוא חסום), ובלעדיו אי אפשר לצלם 360.')}
   /* שדה ראייה ונקודות יעד */
   S.fovL=clamp(+opts.fov||+lsG(FOV_KEY)||FOV_DEF,35,110);const fv=fovOf(S.fovL,S.cw,S.ch);S.fw=fv.fw;S.fh=fv.fh;
   S.T=pickTargets(S.fw,S.fh).map(t=>Object.assign(t,{got:false}));
   msg.classList.remove('on');size();window.addEventListener('resize',size);S.phase='cap';upd();loop()})().catch(()=>fail('תקלה בפתיחת הצילום. נסו שוב.'));
 })}

return{start,close,isOpen:()=>!!cur,_m:M};
});
