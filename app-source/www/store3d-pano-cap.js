/* store3d-pano-cap.js – שלב 18ו (משימה 2026-11-14_סריקת-חנות-תלת-מימד): צילום 360 מודרך בטלפון, והחיבור לתמונת equirectangular – הכול בטלפון.
   נטען בדפדפן כ-window.S3PanoCap, וב-Node דרך require (רק החלק המתמטי S3PanoCap._m, לבדיקות יחידה).
   S3PanoCap.start(el, opts) -> Promise<{full:Blob, sm:Blob, w, h, meta:{n, mode:'pts'|'video', fovH, fovL, yawRef, dev, ms}} | null>   (null = ביטול או שגיאה, אחרי הודעה בעברית)
   S3PanoCap.close() – סוגר מסך פתוח (ל"חזרה" של אנדרואיד) ומחזיר true אם היה פתוח; S3PanoCap.isOpen().
     opts.fov   – שדה ראייה של הצלע הארוכה במעלות (לא חובה; אחרת: כיול שנשמר בטלפון, אחרת 65°, ואחרי הצילום כיול אוטומטי מהחפיפה)
     opts.mock  – לבדיקות בלבד: {camera:{el, w, h, stop?}, sensor:(cb, api)=>stopFn, angle?, motion?:(cb)=>stopFn}. cb מקבל {alpha, beta, gamma, angle}; motion: cb({acceleration:{x,y,z}}).
     opts.mock.photo – לבדיקות: ()=>Promise<Blob> (מדמה ImageCapture.takePhoto); opts.mock.caps – {caps, settings, apply?(c)} (מדמה getCapabilities/getSettings/applyConstraints של ה-track).
     opts.noAlign – לבדיקות: בלי יישור עדין (וגם בלי עיוות מקומי). opts.noWarp – בלי עיוות מקומי ליד התפרים.
   S3PanoCap.lastRaw() -> Promise<Blob|null>: zip של הצילום האחרון (פריימים + meta.json), לשיפור החיבור. בזיכרון בלבד; משתחרר כשמתחיל צילום חדש.
   שלב 18 (תיקון "רוחות"): אחרי הצילום – יישור עדין של הכיוונים לפי החפיפה (align), וערבוב צר סביב קו התפר במקום ערבוב שקוף רחב;
     בזמן הצילום – אזהרה אם מד התאוצה מראה שהטלפון זז (ולא רק מסתובב).
   שלב 21ה (מצב נקודות): שכבת עזר (כפתור "שכבת עזר", נשמר ב-localStorage; פריימים סמוכים חצי שקופים על התצוגה), חפיפה .4, ובסוף שלב רצפה אופציונלי ("צלם"/"דלג"): פריים עם role:'nadir' (גם ב-meta.frames[i].role ובתוסף). בחיבור ה-JS הוא מוחרג מהיישור והעיוות ומתווסף אחרון רק מתחת ל-65°-.
   שני מצבים במסך (הבחירה האחרונה נשמרת בטלפון): "נקודות" – עוצרים על כל נקודת יעד; "סרטון" – לוחצים "הקלטה" ומסתובבים ברצף, והאפליקציה דוגמת פריימים מהמצלמה החיה
     (כל ~120ms, רק כשהסיבוב איטי מספיק), ושומרת לכל נקודת יעד רק את הפריים החד והקרוב ביותר אליה – כך הזיכרון חסום. החיבור זהה בשני המצבים.
   מצלמה: getUserMedia בתוך ה-WebView (כמו "צילום רציף" ב-index.html; ההרשאה CAMERA כבר ב-patch-android.sh). חיישן: אירוע deviceorientation (בלי הרשאת Android).
   מוסכמות: עולם x=מזרח, y=צפון, z=למעלה (כמו W3C DeviceOrientation, אבל alpha יחסי – לא צפון אמיתי). מצלמה: x ימינה במסך, y למעלה במסך, מסתכלת ל-z-.
   equirect: מרכז התמונה (u=0.5) = כיוון הפריים הראשון (yawRef); ימינה בתמונה = סיבוב עם כיוון השעון (מבט מלמעלה); שורה עליונה = זנית. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.S3PanoCap=factory()})(typeof self!=='undefined'?self:this,function(){
'use strict';
const D=Math.PI/180;
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
/* ספי פתיחה – (לא מאומת) – לכוונון אחרי בדיקה בטלפון */
const FOV_DEF=65/* צלע ארוכה, מצלמה ראשית רגילה */,OVERLAP=.3,OVERLAP_PTS=.4/* מצב נקודות (שלב 21ה): חפיפה גדולה יותר; סרטון נשאר OVERLAP */,AIM_TOL=5,STAB_MS=300,STAB_DEG=1.2,FRAME_MAX=1280,
  /* צילום תמונה אמיתית (מצב נקודות): הצלע הארוכה של הפריים, תזוזה מרבית בזמן הצילום (מעלות), זמן המתנה מרבי לתמונה (מ"ש), מספר כשלונות עד חזרה לפריים מהווידאו */
  PHOTO_MAX=1600,PH_MOVE=1.5,PH_TMO=8000,PH_FAILS=2,
  /* ערבוב צר: רוחב רצועת המעבר סביב קו התפר (מעלות). יישור עדין: טווח חיפוש (מעלות), רזולוציית החפיפה (מעלות לפיקסל), גודל ההקטנה לניתוח */
  BLEND_DEG=1.5,AL_MAX=5/* היה 3: בחומר אמיתי (חניון 1814) רוב הזוגות נפלו על קצה הטווח */,AL_RES=.25,AL_SM=400,
  /* תזוזה של הטלפון (לא רק סיבוב): תאוצה ליניארית ממוצעת (מ'/ש²) שמעליה מוצגת אזהרה */
  MOVE_ACC=1.3,
  /* עיוות מקומי ליד התפרים (שלב 18, אחרי היישור): טווח מדידה (מעלות), רדיוס ההשפעה (מעלות), גודל רשת העיוות לפריים */
  WP_MAX=6,WP_SIG=8/* כוונן על שני צילומי חניון אמיתיים */,WP_GW=12,WP_GH=16,
  FULL_MAX=2500000,SM_MAX=150000,FOV_KEY='lp-s3pc-fovL',/* תמונות אמיתיות: FOV_KEY+'-ph' */
  /* מצב סרטון: מרווח דגימה, מהירות זוויתית מרבית (מעלות לשנייה), הצלע הארוכה של ההקטנה לציון החדות */
  VID_MS=120,VID_SPD=60,VID_SM=160,MODE_KEY='lp-s3pc-mode',
   /* שלב 21ה: שכבת עזר (תמונה ממוזערת של פריימים שצולמו, חצי שקופה), וצילום רצפה נפרד: כיוון מינימלי כלפי מטה (מעלות) */
   HELP_KEY='lp-s3pc-help',HELP_TH=320,HELP_A=.35,HELP_N=6,FLOOR_PITCH=-75;

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

/* מאגר equirect אחד שאליו ממזגים פריים אחרי פריים. ערבוב צר: כל פיקסל לקוח מהפריים שבו הוא הכי רחוק משפת הפריים (בערך: הכי קרוב למרכז),
   עם רצועת מעבר של BLEND_DEG סביב קו התפר – כדי שסטייה קטנה בין פריימים תיראה כתפר ולא ככפילות שקופה רחבה.
   זיכרון: RGBA 8 ביט + 16 ביט לכל פיקסל (המרחק הגדול ביותר משפת פריים עד כה, באלפיות מעלה; 0 = לא כוסה). 4096×2048 ≈ 50MB. */
function makePano(W,H,yawRef){
 const col=new Uint8ClampedArray(W*H*4),wt=new Uint16Array(W*H),sLo=new Float32Array(W),cLo=new Float32Array(W),sLa=new Float32Array(H),cLa=new Float32Array(H);
 for(let x=0;x<W;x++){const a=(((x+.5)/W-.5)*360+(yawRef||0))*D;sLo[x]=Math.sin(a);cLo[x]=Math.cos(a)}
 for(let y=0;y<H;y++){const a=(.5-(y+.5)/H)*Math.PI;sLa[y]=Math.sin(a);cLa[y]=Math.cos(a)}
 for(let i=3;i<col.length;i+=4)col[i]=255;
 /* מעבר על טביעת הרגל; fn(i, r,g,b, weight) */
 function each(fr,step,fn){
  const m=qToMat(fr.q),c=fovOf(fr.fovL,fr.w,fr.h),f=c.f,w=fr.w,h=fr.h,hw=w/2,hh=h/2,d=fr.data,wp=fr.warp||null,fp=footprint(m,f,w,h,W,H,yawRef),ex=c.fw/2,ey=c.fh/2;
   if(fr.latMax!=null)fp.y0=Math.max(fp.y0,Math.ceil((.5-fr.latMax/180)*H-.5))/* פריים רצפה: רק מתחת לקו הרוחב הזה */;
  for(let y=fp.y0;y<=fp.y1;y+=step){const sl=sLa[y],cl=cLa[y];
   for(let xx=fp.x0;xx<=fp.x1;xx+=step){const x=((xx%W)+W)%W,d0=cl*sLo[x],d1=cl*cLo[x];
    const z=m[2]*d0+m[5]*d1+m[8]*sl;if(z>=-1e-6)continue;const iz=-f/z;
    let u=hw+(m[0]*d0+m[3]*d1+m[6]*sl)*iz,v=hh-(m[1]*d0+m[4]*d1+m[7]*sl)*iz;if(wp){const gx=clamp(u/w*(WP_GW-1),0,WP_GW-1.001),gy=clamp(v/h*(WP_GH-1),0,WP_GH-1.001),x0=gx|0,y0=gy|0,tx=gx-x0,ty=gy-y0,k=y0*WP_GW+x0,K=k+WP_GW;
     u+=((wp.u[k]*(1-tx)+wp.u[k+1]*tx)*(1-ty)+(wp.u[K]*(1-tx)+wp.u[K+1]*tx)*ty)*w;v+=((wp.v[k]*(1-tx)+wp.v[k+1]*tx)*(1-ty)+(wp.v[K]*(1-tx)+wp.v[K+1]*tx)*ty)*h}
    const nx=Math.abs(u-hw)/hw,ny=Math.abs(v-hh)/hh;if(nx>=1||ny>=1)continue;const ke=Math.min((1-nx)*ex,(1-ny)*ey)/* מרחק (בקירוב, מעלות) משפת הפריים */;
    const fx=u-.5,fy=v-.5,ix=fx<0?0:fx>w-1.001?w-2:Math.floor(fx),iy=fy<0?0:fy>h-1.001?h-2:Math.floor(fy),ax=clamp(fx-ix,0,1),ay=clamp(fy-iy,0,1);
    const p=(iy*w+ix)*4,q=p+w*4,w00=(1-ax)*(1-ay),w10=ax*(1-ay),w01=(1-ax)*ay,w11=ax*ay;
    fn(y*W+x,d[p]*w00+d[p+4]*w10+d[q]*w01+d[q+4]*w11,d[p+1]*w00+d[p+5]*w10+d[q+1]*w01+d[q+5]*w11,d[p+2]*w00+d[p+6]*w10+d[q+2]*w01+d[q+6]*w11,ke)}}}
 /* פריים: {data(RGBA), w, h, q, fovL}. מחזיר את תיקון הבהירות שהוחל. */
 function add(fr){
  let sa=0,sf=0,n=0;each(fr,3,(i,r,g,b,k)=>{if(wt[i]>0&&k>.5){const j=i*4;sa+=col[j]*.299+col[j+1]*.587+col[j+2]*.114;sf+=r*.299+g*.587+b*.114;n++}});
  const gain=n>=60&&sf>0?clamp(sa/sf,.6,1.6):1,bw=1/(2*BLEND_DEG);
  each(fr,1,(i,r,g,b,k)=>{const k0=wt[i]/1000,a=wt[i]?clamp(.5+(k-k0)*bw,0,1):1,j=i*4;
   if(a>0){col[j]+=(r*gain-col[j])*a;col[j+1]+=(g*gain-col[j+1])*a;col[j+2]+=(b*gain-col[j+2])*a}
   if(!wt[i]||k>k0)wt[i]=Math.min(65535,Math.max(1,Math.round(k*1000)))});
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

/* כיול שדה ראייה לפי ההזזה בין זוגות שכנים (שלב 18, חומר אמיתי): שדה ראייה שגוי מזיז את התוכן בכל זוג לאותו כיוון – לאורך הקו בין שני הפריימים –
   וההזזות לא מתקזזות סביב המעגל (בניגוד לסטיית חיישן). מודדים את החציון של ההזזה הזו בכמה ערכים, ומוצאים בקו ישר את הערך שבו היא אפס.
   frames כמו ב-estFov. מחזיר {fovL, sh:[[fov,חציון במעלות]...], n} או null. */
function estFovShift(frames,def){
 if(!frames||frames.length<3)return null;const G=frames.map(fr=>fr.g||grayOf(fr.data,fr.w,fr.h)),fw=frames.map(fr=>camFwd(fr.q));
 const P=[];for(let i=0;i<frames.length;i++)for(let j=i+1;j<frames.length;j++){const a=angDir(fw[i],fw[j]);/* רק שכנים באותה שורה: בין שורות ההזזה מוטה (תקרה/רצפה קרובות – פרלקסה) */if(a>8&&a<.75*def&&Math.abs(fw[i][2]-fw[j][2])<.2)P.push([i,j])}
 {const Hz=P.filter(([i,j])=>Math.abs(fw[i][2])<.35&&Math.abs(fw[j][2])<.35);/* עדיפות לשורת האופק – הכי רחוקה מהתקרה והרצפה */if(Hz.length>=5)P.splice(0,P.length,...Hz)}
 if(P.length<3)return null;
 const med=fovL=>{const F=frames.map((fr,k)=>{const c=fovOf(fovL,fr.w,fr.h);return{g:G[k],w:fr.w,h:fr.h,f:c.f,m:qToMat(fr.q)}}),v=[];
  for(const[i,j]of P){const c=nrm([fw[i][0]+fw[j][0],fw[i][1]+fw[j][1],fw[i][2]+fw[j][2]]),r=alPair(F[i],F[j],c,{max:8,res:.4,n:40});if(!r||r.ncc<.6)continue;
   const t=[fw[j][0]-fw[i][0],fw[j][1]-fw[i][1],fw[j][2]-fw[i][2]],t1=t[0]*r.e1[0]+t[1]*r.e1[1]+t[2]*r.e1[2],t2=t[0]*r.e2[0]+t[1]*r.e2[1]+t[2]*r.e2[2],tn=Math.hypot(t1,t2)||1;
   v.push((r.s[0]*t1+r.s[1]*t2)/tn/D)}
  if(v.length<3)return null;v.sort((a,b)=>a-b);const q=Math.floor(v.length/4),mid=v.slice(q,v.length-q)/* ממוצע של החצי האמצעי */;return{m:mid.reduce((x,y)=>x+y,0)/mid.length,n:v.length}};
 const sh=[],lo=def*.75,hi=Math.min(110,def*1.35);let a=def-3,b=def+3,ma=med(a),mb=med(b);if(!ma||!mb)return null;sh.push([a,ma.m],[b,mb.m]);
 for(let it=0;it<3;it++){const k=(mb.m-ma.m)/(b-a);if(!(Math.abs(k)>1e-3))return null;const z=clamp(a-ma.m/k,lo,hi),mz=med(z);if(!mz)break;sh.push([z,mz.m]);
  if(Math.abs(mz.m)<.15)return{fovL:z,sh,n:mz.n};if(Math.abs(z-a)<Math.abs(z-b)){b=z;mb=mz}else{a=z;ma=mz}}
 const best=sh.reduce((x,y)=>Math.abs(y[1])<Math.abs(x[1])?y:x);return Math.abs(best[1])<.6?{fovL:best[0],sh,n:P.length}:null}

/* ---------------- יישור עדין אחרי הצילום ----------------
   החיישן סוטה מעט בין פריימים, ולכן אותו עצם נופל בשני פריימים חופפים במקומות קצת שונים. לכל זוג חופף: מקרינים את שניהם לרשת קטנה
   באזור החפיפה (AL_RES מעלות לפיקסל, אפור, מטושטש מעט), ומחפשים (גס ואז עדין) הזזה של עד AL_MAX מעלות שממקסמת התאמה (NCC) של הגרדיאנטים
   – עמיד להבדלי חשיפה. הזזה ברשת שסביב כיוון c = סיבוב קטן יחסי בין שני הפריימים (סביב ציר שניצב ל-c).
   אחר כך פתרון גלובלי: לכל פריים סיבוב תיקון קטן ω (וקטור בעולם, רדיאנים) כך ש-ω_i − ω_j ≈ המדידה של הזוג; הפריים הראשון קבוע.
   התאמה חלשה (אזור חלק, NCC נמוך, שיא על קצה הטווח) – משקל 0. מדידות חריגות מוסרות, והתיקון מוגבל ל-AL_MAX. */
function qFromVec(v){const a=Math.hypot(v[0],v[1],v[2]);if(a<1e-12)return[1,0,0,0];const s=Math.sin(a/2)/a;return[Math.cos(a/2),v[0]*s,v[1]*s,v[2]*s]}
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const nrm=a=>{const n=Math.hypot(a[0],a[1],a[2])||1;return[a[0]/n,a[1]/n,a[2]/n]};
/* RGBA ⇒ אפור */
function grayOf(d,w,h){const g=new Float32Array(w*h);for(let i=0,j=0;i<g.length;i++,j+=4)g[i]=d[j]*.299+d[j+1]*.587+d[j+2]*.114;return g}
/* פריים אפור {g,w,h,m,f} ⇒ רשת N×N סביב c (צירים e1 ימינה, e2 למעלה, res רדיאנים לפיקסל), מטושטשת 3×3; ⇒ גרדיאנטים {gx,gy} (NaN מחוץ לפריים) */
function alPatch(fr,c,e1,e2,N,res){
 const{g,w,h,m,f}=fr,cx=w/2,cy=h/2,h0=(N-1)/2,P=new Float32Array(N*N);
 for(let b=0;b<N;b++){const tb=(h0-b)*res;for(let a=0;a<N;a++){const ta=(a-h0)*res,d0=c[0]+ta*e1[0]+tb*e2[0],d1=c[1]+ta*e1[1]+tb*e2[1],d2=c[2]+ta*e1[2]+tb*e2[2];
  const z=m[2]*d0+m[5]*d1+m[8]*d2;if(z>=-1e-6){P[b*N+a]=NaN;continue}const iz=-f/z,u=cx+(m[0]*d0+m[3]*d1+m[6]*d2)*iz-.5,v=cy-(m[1]*d0+m[4]*d1+m[7]*d2)*iz-.5;
  if(u<0||v<0||u>w-1.001||v>h-1.001){P[b*N+a]=NaN;continue}const ix=u|0,iy=v|0,ax=u-ix,ay=v-iy,p=iy*w+ix;
  P[b*N+a]=(g[p]*(1-ax)+g[p+1]*ax)*(1-ay)+(g[p+w]*(1-ax)+g[p+w+1]*ax)*ay}}
 const B=new Float32Array(N*N).fill(NaN),gx=new Float32Array(N*N).fill(NaN),gy=new Float32Array(N*N).fill(NaN);
 for(let b=1;b<N-1;b++)for(let a=1;a<N-1;a++){let s=0;for(let k=-1;k<=1;k++){const r=(b+k)*N+a;s+=P[r-1]+P[r]+P[r+1]}B[b*N+a]=s/9}
 for(let b=2;b<N-2;b++)for(let a=2;a<N-2;a++){const i=b*N+a;gx[i]=B[i+1]-B[i-1];gy[i]=B[i-N]-B[i+N]}
 return{gx,gy}}
/* NCC של גרדיאנטים: A (N×N) מול B (M×M, M=N+2S) בהזזה (sx,sy). מחזיר {s,n,e} (ציון, מספר פיקסלים, אנרגיה ממוצעת) */
function alScore(A,B,N,S,sx,sy){const M=N+2*S;let ab=0,aa=0,bb=0,n=0;
 for(let b=0;b<N;b++){const ra=b*N,rb=(b+S+sy)*M+S+sx;for(let a=0;a<N;a++){const x=A.gx[ra+a],y=A.gy[ra+a],u=B.gx[rb+a],v=B.gy[rb+a];
  if(x!==x||y!==y||u!==u||v!==v)continue;ab+=x*u+y*v;aa+=x*x+y*y;bb+=u*u+v*v;n++}}
 return{s:aa>0&&bb>0?ab/Math.sqrt(aa*bb):0,n,e:n?Math.min(aa,bb)/n:0}}
/* זוג פריימים: מחזיר {s:[sx,sy] (רדיאנים, ברשת), ncc, w, c, e1, e2} או null */
function alPair(fi,fj,c,opt){
 opt=opt||{};const res=(opt.res||AL_RES)*D,N=opt.n||64,S=Math.ceil((opt.max||AL_MAX)/(opt.res||AL_RES))+1;
 const e1=nrm(Math.abs(c[2])>.95?cross(c,[0,1,0]):cross(c,[0,0,1])),e2=cross(e1,c);
 const A=alPatch(fi,c,e1,e2,N,res),B=alPatch(fj,c,e1,e2,N+2*S,res),minN=N*N*.18;
 const cache=new Map(),sc=(x,y)=>{const k=x*1000+y;let r=cache.get(k);if(!r){r=alScore(A,B,N,S,x,y);if(r.n<minN)r.s=-1;cache.set(k,r)}return r};
 let bx=0,by=0,bs=sc(0,0).s;
 for(let y=-S+1;y<=S-1;y+=2)for(let x=-S+1;x<=S-1;x+=2){const s=sc(x,y).s;if(s>bs){bs=s;bx=x;by=y}}
 for(let it=0;it<4;it++){let mx=bx,my=by;for(let y=by-1;y<=by+1;y++)for(let x=bx-1;x<=bx+1;x++){if(Math.abs(x)>S-1||Math.abs(y)>S-1)continue;const s=sc(x,y).s;if(s>bs){bs=s;mx=x;my=y}}if(mx===bx&&my===by)break;bx=mx;by=my}
 const r0=sc(bx,by);if(r0.s<0)return null;
 const sub=(m,z,p)=>{const d=m-2*z+p;return d<0?clamp(.5*(m-p)/d,-.5,.5):0};
 const edge=Math.abs(bx)>=S-1||Math.abs(by)>=S-1,ox=edge?0:sub(sc(bx-1,by).s,bs,sc(bx+1,by).s),oy=edge?0:sub(sc(bx,by-1).s,bs,sc(bx,by+1).s);
 /* חדות השיא (עקמומיות ה-NCC סביבו): שיא רחב = מיקום לא ודאי (טקסטורה רכה) */
 const cv2=edge?0:Math.min(2*bs-sc(bx-1,by).s-sc(bx+1,by).s,2*bs-sc(bx,by-1).s-sc(bx,by+1).s);
 const E0=opt.e0||1.5,w=edge?0:clamp((bs-.4)/.45,0,1)**2*clamp(r0.e/E0,0,1)*clamp(r0.n/(N*N*.5),0,1)*clamp(cv2/.02,0,1);
 return{s:[(bx+ox)*res,-(by+oy)*res],ncc:bs,e:r0.e,w,c,e1,e2,cv:cv2}}
/* frames: [{data (RGBA קטן), w, h, q}], fovL. מחזיר {qs (מתוקנים), fix (ω במעלות לכל פריים), pairs, used, ms} */
function align(frames,fovL,opt){
 opt=opt||{};const t0=Date.now(),n=frames.length,lim=(opt.max||AL_MAX)*D,F=frames.map(fr=>{const c=fovOf(fovL,fr.w,fr.h);return{g:fr.g||grayOf(fr.data,fr.w,fr.h),w:fr.w,h:fr.h,f:c.f,fw:c.fw,fh:c.fh}});
 let om=frames.map(()=>[0,0,0]),pairs=[],used=0;
 for(let pass=0;pass<(opt.passes||1);pass++){
  const qs=frames.map((fr,i)=>qNorm(qMul(qFromVec(om[i]),fr.q))),fw=qs.map(camFwd);qs.forEach((q,i)=>{F[i].m=qToMat(q)});
  const ms=[];
  for(let i=0;i<n;i++)for(let j=i+1;j<n;j++){const a=angDir(fw[i],fw[j]),lim2=.8*Math.max(F[i].fh,F[i].fw,F[j].fh,F[j].fw);if(a>lim2||a<.5)continue;
   const c=nrm([fw[i][0]+fw[j][0],fw[i][1]+fw[j][1],fw[i][2]+fw[j][2]]),r=alPair(F[i],F[j],c,opt);if(!r||r.w<=0)continue;
   /* s ≈ (ω_i−ω_j)×c ⇒ החלק הניצב ל-c של ω_i−ω_j הוא c×s */
   const sv=[r.s[0]*r.e1[0]+r.s[1]*r.e2[0],r.s[0]*r.e1[1]+r.s[1]*r.e2[1],r.s[0]*r.e1[2]+r.s[1]*r.e2[2]],dl=cross(c,sv);
   ms.push({i,j,c,d:[om[i][0]-om[j][0]+dl[0],om[i][1]-om[j][1]+dl[1],om[i][2]-om[j][2]+dl[2]],w:r.w,ncc:r.ncc})}
  pairs=ms;
  /* פתרון: Gauss–Seidel על (λI+Σ W)ω_i = Σ W(ω_j ± Δ), W = w(I − c cᵀ); הסרת חריגים (>0.6°) ופתרון שוב */
  const solve=act=>{const o=frames.map(()=>[0,0,0]),lam=.02;
   for(let it=0;it<60;it++)for(let i=1;i<n;i++){const A=[lam,0,0,0,lam,0,0,0,lam],b=[0,0,0];
    for(const p of act){let j,dd;if(p.i===i){j=p.j;dd=p.d}else if(p.j===i){j=p.i;dd=[-p.d[0],-p.d[1],-p.d[2]]}else continue;
     const c=p.c,t=[o[j][0]+dd[0],o[j][1]+dd[1],o[j][2]+dd[2]],ct=c[0]*t[0]+c[1]*t[1]+c[2]*t[2];
     for(let r=0;r<3;r++){for(let k=0;k<3;k++)A[r*3+k]+=p.w*((r===k?1:0)-c[r]*c[k]);b[r]+=p.w*(t[r]-c[r]*ct)}}
    const det=A[0]*(A[4]*A[8]-A[5]*A[7])-A[1]*(A[3]*A[8]-A[5]*A[6])+A[2]*(A[3]*A[7]-A[4]*A[6]);if(Math.abs(det)<1e-12)continue;
    const cr=(x,y,z)=>x[0]*(y[1]*z[2]-y[2]*z[1])-x[1]*(y[0]*z[2]-y[2]*z[0])+x[2]*(y[0]*z[1]-y[1]*z[0]),c0=[A[0],A[3],A[6]],c1=[A[1],A[4],A[7]],c2=[A[2],A[5],A[8]];
    o[i]=[cr(b,c1,c2)/det,cr(c0,b,c2)/det,cr(c0,c1,b)/det]}
   return o};
  let act=ms,o=solve(act);
  const res=p=>{const e=[o[p.i][0]-o[p.j][0]-p.d[0],o[p.i][1]-o[p.j][1]-p.d[1],o[p.i][2]-o[p.j][2]-p.d[2]],ce=e[0]*p.c[0]+e[1]*p.c[1]+e[2]*p.c[2];return Math.hypot(e[0]-ce*p.c[0],e[1]-ce*p.c[1],e[2]-ce*p.c[2])};
  const keep=act.filter(p=>res(p)<.6*D);if(keep.length<act.length&&keep.length){act=keep;o=solve(act)}
  used=act.length;om=o.map(v=>{const a=Math.hypot(v[0],v[1],v[2]);return a>lim?v.map(x=>x*lim/a):v})}
 const qs=frames.map((fr,i)=>qNorm(qMul(qFromVec(om[i]),fr.q)));
 return{qs,fix:om.map(v=>v.map(x=>Math.round(x/D*1000)/1000)),pairs:pairs.length,used,ms:Date.now()-t0}}

/* עיוות מקומי: אחרי היישור נשארות סטיות שאינן סיבוב (פרלקסה כשהסיבוב לא סביב העדשה, עיוות עדשה). לכל זוג חופף מודדים את ההזזה
   בכמה נקודות לאורך אזור החפיפה (alPair, טווח קטן), וכל פריים "נמתח" חצי מהדרך לקראת השני – רק סביב הנקודה (גאוסיאן, WP_SIG),
   ודועך לאפס הרחק מהתפר. התוצאה לכל פריים: רשת WP_GW×WP_GH של הזזות (בשבר מרוחב/גובה הפריים) שהפונקציה each מוסיפה לפני הדגימה.
   frames: [{data|g, w, h}] קטנים, qs: כיוונים מתוקנים. opt.sign – לבדיקות. מחזיר {warps:[{u,v}|null], pts, ms} */
function warpFields(frames,qs,fovL,opt){
 opt=opt||{};const t0=Date.now(),n=frames.length,sgn=opt.sign||1,F=frames.map((fr,i)=>{const c=fovOf(fovL,fr.w,fr.h);return{g:fr.g||grayOf(fr.data,fr.w,fr.h),w:fr.w,h:fr.h,f:c.f,fw:c.fw,fh:c.fh,m:qToMat(qs[i])}}),fw=qs.map(camFwd);
 const C=frames.map(()=>[]);let pts=0;
 const proj=(Fi,d)=>projToFrame(Fi.m,d,Fi.f,Fi.w/2,Fi.h/2),inF=(Fi,p,mg)=>p&&p[0]>=mg&&p[1]>=mg&&p[0]<=Fi.w-mg&&p[1]<=Fi.h-mg;
 for(let i=0;i<n;i++)for(let j=i+1;j<n;j++){const a=angDir(fw[i],fw[j]);if(a>.85*Math.max(F[i].fh,F[j].fh)||a<.5)continue;
  const c0=nrm([fw[i][0]+fw[j][0],fw[i][1]+fw[j][1],fw[i][2]+fw[j][2]]),ax=nrm(cross(c0,nrm([fw[j][0]-fw[i][0],fw[j][1]-fw[i][1],fw[j][2]-fw[i][2]])))/* לאורך התפר */;
  for(let k=-3;k<=3;k++){const t=k*5*D,c=nrm([c0[0]*Math.cos(t)+ax[0]*Math.sin(t),c0[1]*Math.cos(t)+ax[1]*Math.sin(t),c0[2]*Math.cos(t)+ax[2]*Math.sin(t)]);
   const pi=proj(F[i],c),pj=proj(F[j],c);if(!inF(F[i],pi,4)||!inF(F[j],pj,4))continue;
   const r=alPair(F[i],F[j],c,{max:opt.max||WP_MAX,res:.25,n:28,e0:1});if(!r||r.w<=.05)continue;
   const sv=[r.s[0]*r.e1[0]+r.s[1]*r.e2[0],r.s[0]*r.e1[1]+r.s[1]*r.e2[1],r.s[0]*r.e1[2]+r.s[1]*r.e2[2]];
   for(const[q,Fq,sg]of[[i,F[i],-.5*sgn],[j,F[j],.5*sgn]]){const p0=proj(Fq,c),p1=proj(Fq,nrm([c[0]+sg*sv[0],c[1]+sg*sv[1],c[2]+sg*sv[2]]));if(!p0||!p1)continue;
    C[q].push({du:(p1[0]-p0[0])/Fq.w,dv:(p1[1]-p0[1])/Fq.h,w:r.w,d:c})}pts++}}
 const warps=frames.map((fr,q)=>{const L=C[q];if(!L.length)return null;const Fq=F[q],m=Fq.m,u=new Float32Array(WP_GW*WP_GH),v=new Float32Array(WP_GW*WP_GH),s2=2*((opt.sig||WP_SIG)*D)**2;
  for(let gy=0;gy<WP_GH;gy++)for(let gx=0;gx<WP_GW;gx++){const px=gx/(WP_GW-1)*Fq.w,py=gy/(WP_GH-1)*Fq.h,cx=(px-Fq.w/2)/Fq.f,cy=-(py-Fq.h/2)/Fq.f;
   const d=nrm([m[0]*cx+m[1]*cy-m[2],m[3]*cx+m[4]*cy-m[5],m[6]*cx+m[7]*cy-m[8]]);let su=0,sv2=0,sw=.25/* דעיכה לאפס הרחק מנקודות המדידה */;
   for(const c of L){const a=angDir(d,c.d)*D,g=c.w*Math.exp(-a*a/s2);su+=g*c.du;sv2+=g*c.dv;sw+=g}
   u[gy*WP_GW+gx]=su/sw;v[gy*WP_GW+gx]=sv2/sw}
  return{u,v}});
 return{warps,pts,ms:Date.now()-t0}}

/* zip פשוט (בלי דחיסה, "store") – files: [{name, data:Uint8Array}] ⇒ Uint8Array */
const CRC_T=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0}return t})();
function crc32(u){let c=0xFFFFFFFF;for(let i=0;i<u.length;i++)c=CRC_T[(c^u[i])&255]^(c>>>8);return(c^0xFFFFFFFF)>>>0}
function zipStore(files,date){
 const enc=new TextEncoder(),dt=date||new Date(),dd=((dt.getFullYear()-1980)<<9)|((dt.getMonth()+1)<<5)|dt.getDate(),tm=(dt.getHours()<<11)|(dt.getMinutes()<<5)|(dt.getSeconds()>>1);
 const ents=files.map(f=>({nm:enc.encode(f.name),data:f.data,crc:crc32(f.data)}));
 let size=22;for(const e of ents)size+=30+46+2*e.nm.length+e.data.length;
 const out=new Uint8Array(size),V=new DataView(out.buffer);let o=0;
 const hdr=(sig,e,cen,off)=>{V.setUint32(o,sig,true);o+=4;if(cen){V.setUint16(o,20,true);o+=2}V.setUint16(o,20,true);V.setUint16(o+2,0x0800,true);V.setUint16(o+4,0,true);V.setUint16(o+6,tm,true);V.setUint16(o+8,dd,true);
  V.setUint32(o+10,e.crc,true);V.setUint32(o+14,e.data.length,true);V.setUint32(o+18,e.data.length,true);V.setUint16(o+22,e.nm.length,true);V.setUint16(o+24,0,true);o+=26;
  if(cen){V.setUint16(o,0,true);V.setUint16(o+2,0,true);V.setUint16(o+4,0,true);V.setUint32(o+6,0,true);V.setUint32(o+10,off,true);o+=14}out.set(e.nm,o);o+=e.nm.length};
 for(const e of ents){e.off=o;hdr(0x04034b50,e,false);out.set(e.data,o);o+=e.data.length}
 const c0=o;for(const e of ents)hdr(0x02014b50,e,true,e.off);
 V.setUint32(o,0x06054b50,true);V.setUint16(o+8,ents.length,true);V.setUint16(o+10,ents.length,true);V.setUint32(o+12,o-c0,true);V.setUint32(o+16,c0,true);
 return out}

/* ---------------- מצב סרטון: מתמטיקה טהורה ---------------- */
/* אינטרפולציה כדורית בין שני קווטרניונים (t בין 0 ל-1) */
function qSlerp(a,b,t){let d=a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3],c=b;if(d<0){d=-d;c=[-b[0],-b[1],-b[2],-b[3]]}
 if(d>.9995)return qNorm([0,1,2,3].map(i=>a[i]+(c[i]-a[i])*t));
 const th=Math.acos(d),s=Math.sin(th),k0=Math.sin((1-t)*th)/s,k1=Math.sin(t*th)/s;return[0,1,2,3].map(i=>a[i]*k0+c[i]*k1)}
/* כיוון ברגע t מתוך היסטוריית חיישן [{t,q}] ממוינת: slerp בין שני הערכים שסביב t; אחרת הערך הקרוב (האחרון שהתקבל) */
function oriAt(h,t){const n=h.length;if(!n)return null;if(t>=h[n-1].t)return h[n-1].q;if(t<=h[0].t)return h[0].q;
 let i=n-2;while(i>0&&h[i].t>t)i--;const a=h[i],b=h[i+1],dt=b.t-a.t;return dt>0?qSlerp(a.q,b.q,(t-a.t)/dt):b.q}
/* מהירות זוויתית (מעלות לשנייה) סביב הרגע t, על חלון של כ-win ms */
function angSpeed(h,t,win){win=win||150;if(h.length<2)return 0;let j=h.length-1;while(j>0&&h[j].t>t)j--;const b=h[j];let i=j;while(i>0&&b.t-h[i].t<win)i--;
 const a=h[i],dt=b.t-a.t;return dt>=30?qAngle(a.q,b.q)/dt*1000:0}
/* ציון חדות זול: וריאנס של הלפלסיאן על גווני אפור (data = RGBA קטן, ~160px) */
function lapVar(d,w,h){if(w<3||h<3)return 0;const g=new Float32Array(w*h);for(let i=0,j=0;i<g.length;i++,j+=4)g[i]=d[j]*.299+d[j+1]*.587+d[j+2]*.114;
 let s=0,s2=0,n=0;for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x,l=4*g[i]-g[i-1]-g[i+1]-g[i-w]-g[i+w];s+=l;s2+=l*l;n++}
 return s2/n-(s/n)**2}
/* רדיוס הקליטה של כל נקודת יעד = מחצית המרחק לנקודה הקרובה אליה */
function vidRadii(T){const ds=T.map(t=>dirOf(t.yaw,t.pitch));return ds.map((d,i)=>{let m=180;for(let j=0;j<ds.length;j++)if(j!==i)m=Math.min(m,angDir(d,ds[j]));return m/2})}
/* לאילו נקודות יעד הפריים (כיוון מבט fwd, חדות sharp) טוב יותר ממה שכבר נשמר. ציון = חדות × קרבה למרכז הנקודה. best[i]={s,...} או null */
function vidPick(fwd,TD,R,best,sharp){const out=[];for(let i=0;i<TD.length;i++){const a=angDir(fwd,TD[i]);if(a>=R[i])continue;
  const s=sharp*(1-.6*(a/R[i])**2);if(!best[i]||s>best[i].s)out.push({i,s,a})}return out}

const M={qMul,qNorm,qAxis,oriToQuat,qToMat,qAngle,camFwd,dirOf,yawPitch,wrap180,angDir,fovOf,fovLongOf,pickTargets,projToFrame,eqDir,eqToFrame,footprint,makePano,estFov,estFovShift,qSlerp,oriAt,angSpeed,lapVar,vidRadii,vidPick,qFromVec,grayOf,alPatch,alPair,align,warpFields,crc32,zipStore,
  C:{FOV_DEF,OVERLAP,OVERLAP_PTS,FLOOR_PITCH,HELP_TH,AIM_TOL,STAB_MS,STAB_DEG,FRAME_MAX,PHOTO_MAX,PH_MOVE,FULL_MAX,SM_MAX,VID_MS,VID_SPD,VID_SM,BLEND_DEG,AL_MAX,AL_RES,AL_SM,MOVE_ACC,WP_MAX,WP_SIG,WP_GW,WP_GH}};
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
.s3pc .s3pc-seg{display:flex;gap:6px;justify-content:center;margin:6px auto 2px;max-width:300px}
.s3pc .s3pc-seg button{min-height:40px;padding:4px 8px;font-size:14px}
.s3pc .s3pc-seg button[aria-pressed=true]{background:#d4af37;color:#17140a;font-weight:700}
.s3pc .s3pc-map{display:block;margin:4px auto 0;width:144px;height:72px;border:1px solid rgba(212,175,55,.5);border-radius:6px;background:rgba(0,0,0,.35)}
.s3pc .s3pc-map[hidden],.s3pc button[hidden]{display:none}
.s3pc .s3pc-hint.warn{color:#ffb199;font-weight:700}
.s3pc .s3pc-tip{font-size:12px;line-height:1.3;color:#cdbf98;margin-top:3px}
.s3pc .s3pc-tip[hidden]{display:none}
.s3pc .s3pc-ol{flex:none;display:block;margin:4px auto 0;min-width:140px}.s3pc .s3pc-ol[aria-pressed=true]{background:#d4af37;color:#17140a;font-weight:700}
.s3pc .s3pc-fb{margin-top:6px}.s3pc .s3pc-fb[hidden]{display:none}.s3pc .s3pc-fi{font-size:14px;line-height:1.4;color:#f1d77a;font-weight:700}.s3pc .s3pc-fr{display:flex;gap:8px;margin-top:6px}
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
/* מצייר מקור (sw×sh) מסובב ב-90° (dir=1 עם כיוון השעון, -1 נגדו, 0 בלי) לקנבס בגודל dw×dh (המידות אחרי הסיבוב), באיכות גבוהה */
function drawRot(c,src,sw,sh,dir){const g=c.getContext('2d'),dw=c.width,dh=c.height;g.imageSmoothingEnabled=true;g.imageSmoothingQuality='high';
 if(!dir){g.drawImage(src,0,0,dw,dh);return}
 g.save();if(dir>0){g.translate(dw,0);g.rotate(Math.PI/2)}else{g.translate(0,dh);g.rotate(-Math.PI/2)}g.drawImage(src,0,0,dh,dw);g.restore()}
/* מתאם צלילה (NCC) בין שני קנבסים באותו גודל, בגווני אפור: 1 = זהים, 0 = אין קשר */
function ncc(a,b){const w=a.width,h=a.height,A=a.getContext('2d').getImageData(0,0,w,h).data,B=b.getContext('2d').getImageData(0,0,w,h).data,n=w*h;let ma=0,mb=0;const ga=new Float32Array(n),gb=new Float32Array(n);
 for(let i=0;i<n;i++){ga[i]=.3*A[i*4]+.59*A[i*4+1]+.11*A[i*4+2];gb[i]=.3*B[i*4]+.59*B[i*4+1]+.11*B[i*4+2];ma+=ga[i];mb+=gb[i]}ma/=n;mb/=n;let sa=0,sb=0,sab=0;
 for(let i=0;i<n;i++){const x=ga[i]-ma,y=gb[i]-mb;sa+=x*x;sb+=y*y;sab+=x*y}return sa>1e-6&&sb>1e-6?sab/Math.sqrt(sa*sb):0}
/* תמונה אמיתית ⇒ קנבס באותה כיוון כמו התצוגה המקדימה (vw×vh), הצלע הארוכה עד PHOTO_MAX. ref = קנבס קטן של הווידאו ברגע הצילום (לבחירת כיוון הסיבוב; known = כיוון שכבר נקבע בצילום קודם באותה הפעלה). null = אי אפשר להתאים. */
async function photoCanvas(blob,vw,vh,ref,known){let d;try{d=await decodeBlob(blob)}catch(e){return null}
 try{const pw=d.w,ph=d.h;if(!pw||!ph)return null;const o=(w,h)=>w>h*1.02?1:h>w*1.02?-1:0,ov=o(vw,vh),op=o(pw,ph);let dir=0;
  if(ov&&op&&ov!==op){/* סיבוב נדרש: בוחרים לפי דמיון לפריים הווידאו */
   if(known)dir=known;else{if(!ref)return null;const tw=ref.width,th=ref.height,sc=[0,0];
   [1,-1].forEach((dd,i)=>{const t=cv(tw,th);drawRot(t,d.src,pw,ph,dd);sc[i]=ncc(ref,t);t.width=t.height=1});
   const bi=sc[0]>=sc[1]?0:1,best=sc[bi],other=sc[1-bi];if(best<.25||best-other<.08)return null;dir=bi?-1:1}}
  const rw=dir?ph:pw,rh=dir?pw:ph,k=Math.min(1,PHOTO_MAX/Math.max(rw,rh)),w=Math.max(2,Math.round(rw*k)),h=Math.max(2,Math.round(rh*k)),c=cv(w,h);drawRot(c,d.src,pw,ph,dir);c._dir=dir;return c}
 catch(e){return null}finally{try{d.close()}catch(e){}}}
function pixels(src,w,h){const c=cv(w,h),x=c.getContext('2d',{willReadFrequently:true});x.drawImage(src,0,0,w,h);return x.getImageData(0,0,w,h).data}
function maxTex(){try{const c=cv(1,1),g=c.getContext('webgl')||c.getContext('experimental-webgl');if(!g)return 0;const v=g.getParameter(g.MAX_TEXTURE_SIZE);const l=g.getExtension('WEBGL_lose_context');if(l)l.loseContext();return v||0}catch(e){return 0}}
function devName(){const m=/Android [\d.]+;\s*([^;)]+)/.exec(navigator.userAgent||'');return m?m[1].trim().slice(0,40):''}
function screenAngle(){try{if(screen.orientation&&typeof screen.orientation.angle==='number')return screen.orientation.angle}catch(e){}return typeof window.orientation==='number'?window.orientation:0}
function camErr(e){const n=String(e&&e.name||'');
 if(/NotAllowed|Security|Permission/i.test(n))return'אין הרשאה למצלמה. אשרו מצלמה לאפליקציה בהגדרות הטלפון ונסו שוב.';
 if(/NotFound|Overconstrained|DevicesNotFound/i.test(n))return'לא נמצאה מצלמה בטלפון הזה.';
 if(/NotReadable|TrackStart|Abort/i.test(n))return'המצלמה תפוסה על ידי אפליקציה אחרת. סגרו אותה ונסו שוב.';
 return'המצלמה לא נפתחה. נסו שוב.'}

/* קידוד התוצאה: מלאה (עד FULL_MAX) וקטנה 1024×512 (עד SM_MAX); משחרר את הקנבס */
async function encodeOut(big,W){
 let full=null;for(const q of[.9,.85,.78,.7,.62,.55]){full=await blobOf(big,q);if(full&&full.size<=FULL_MAX)break}
 const sc=cv(1024,512),sx=sc.getContext('2d');sx.imageSmoothingQuality='high';sx.drawImage(big,0,0,1024,512);big.width=big.height=1;
 let sm=null;for(const q of[.8,.72,.64,.56,.48,.4]){sm=await blobOf(sc,q);if(sm&&sm.size<=SM_MAX)break}
 return{full,sm}}
/* חיבור הפריימים (אחרי הצילום, המצלמה כבר סגורה) */
async function stitch(frames,o,onP){
 const mt=o.maxTex!=null?o.maxTex:maxTex(),low=navigator.deviceMemory&&navigator.deviceMemory<=2,W=o.width||(mt>=4096&&!low?4096:2048),H=W/2;
 const yawRef=frames[0].yaw;let fovL=o.fovL,cal=null;
 /* שלב 21ה: פריים רצפה (role:'nadir', אחרון) לא נכנס ליישור/עיוות, ומתווסף אחרון רק לשורות מתחת ל-65°- (בחיבור ה-JS); בתוסף Android הוא עובר עם role */
 let main=frames.filter(f=>f.role!=='nadir');const nad=main.length&&main.length<frames.length?frames.filter(f=>f.role==='nadir'):[];if(!nad.length)main=frames;frames=main.concat(nad);
 /* שלב 21ד: חיבור מקצועי בתוסף Android (OpenCV) אם קיים; כל כשלון ⇒ ממשיכים לחיבור ב-JS שלמטה */
 const NT=typeof window!=='undefined'&&window.S3PanoNative;
 if(NT&&!o.noNative){try{if(await NT.available()){
  const Wn=o.width||(mt>=4096&&!(navigator.deviceMemory&&navigator.deviceMemory<4)?4096:2048);
  const r=await NT.stitch(frames,{fovL,yawRef,W:Wn},p=>onP(.9*p));
  const d=await decodeBlob(r.full);let big;try{if(Math.abs(d.w/d.h-2)>.01)throw new Error('ratio');big=cv(Wn,Wn/2);const g=big.getContext('2d');g.imageSmoothingQuality='high';g.drawImage(d.src,0,0,Wn,Wn/2)}finally{d.close()}
  const e=await encodeOut(big,Wn);onP(1);const fl=+r.fovL||fovL;
  return{full:e.full,sm:e.sm,w:Wn,h:Wn/2,fovL:fl,fovH:fovOf(fl,frames[0].w,frames[0].h).fw,cal:null,qs:frames.map(f=>f.q),al:null,wf:null,nat:r.stats||{}}}}
  catch(e){console.warn('pano native',e&&e.message);onP(0)}}
 /* עותקים קטנים: לכיול שדה הראייה מהחפיפה ולמדידת הסטייה בין פריימים */
 const lo=[];for(const fr of main){const d=await decodeBlob(fr.blob);try{const k=AL_SM/Math.max(d.w,d.h),w=Math.max(8,Math.round(d.w*k)),h=Math.max(8,Math.round(d.h*k));lo.push({data:pixels(d.src,w,h),w,h,q:fr.q})}finally{d.close()}}
 onP(.06);await tick();
 if(!o.fixedFov){cal=estFovShift(lo,fovL);if(cal)fovL=cal.fovL;else{cal=estFov(lo,fovL,yawRef);if(cal&&cal.score<cal.base*.92)fovL=cal.fovL}onP(.11);await tick()}
 /* יישור עדין; אם נכשל מכל סיבה – ממשיכים עם הכיוונים שנמדדו */
 let qs=main.map(f=>f.q),al=null;
 if(!o.noAlign){try{al=align(lo,fovL);qs=al.qs}catch(e){al=null}}
 let wf=null;if(!o.noAlign&&!o.noWarp){try{wf=warpFields(lo,qs,fovL)}catch(e){wf=null}}
 lo.length=0;onP(.16);await tick();
 const P=makePano(W,H,yawRef);
 for(let i=0;i<frames.length;i++){const fr=frames[i],nd=i>=main.length,d=await decodeBlob(fr.blob);try{P.add({data:pixels(d.src,d.w,d.h),w:d.w,h:d.h,q:nd?fr.q:qs[i],fovL,warp:nd?null:wf?wf.warps[i]:null,latMax:nd?-65:null})}finally{d.close()}onP(.16+.7*(i+1)/frames.length);await tick()}
 P.fill();onP(.9);await tick();
 const big=cv(W,H);big.getContext('2d').putImageData(new ImageData(P.col,W,H),0,0);
 const{full,sm}=await encodeOut(big,W);
 onP(1);const fw=fovOf(fovL,frames[0].w,frames[0].h).fw;
 return{full,sm,w:W,h:H,fovL,fovH:fw,cal,qs:qs.concat(nad.map(f=>f.q)),al,wf:wf?{pts:wf.pts,ms:wf.ms}:null}}

let cur=null,raw=null/* חומר גולמי של הצילום האחרון בלבד (בזיכרון): {frames, meta} */;
/* zip של הצילום האחרון: הפריימים (JPEG כפי שנשמרו) + meta.json (כיוון לכל פריים, שדה ראייה, ממדי וידאו, דגם, התיקונים). null אם אין. */
async function lastRaw(){const r=raw;if(!r)return null;
 try{const files=[];for(let i=0;i<r.frames.length;i++){const b=r.frames[i].blob;files.push({name:r.meta.frames[i].file,data:new Uint8Array(await(b.arrayBuffer?b.arrayBuffer():new Response(b).arrayBuffer()))})}
  files.push({name:'meta.json',data:new TextEncoder().encode(JSON.stringify(r.meta,null,1))});return new Blob([zipStore(files)],{type:'application/zip'})}catch(e){return null}}
/* סגירה מבחוץ (למשל כפתור "חזרה" של אנדרואיד): מחזיר true אם היה מסך פתוח; ההבטחה של start מסתיימת ב-null */
function close(){if(!cur)return false;cur(null);return true}
function start(el,opts){
 opts=opts||{};css();
 return new Promise(resolve=>{
  const mock=opts.mock||null,host=el&&el.appendChild?el:document.body;
  const R=document.createElement('div');R.className='s3pc';R.setAttribute('role','dialog');R.setAttribute('aria-label','צילום 360');
  R.innerHTML=`<div class="s3pc-camw"></div><canvas class="s3pc-ov"></canvas><div class="s3pc-fl"></div>
<div class="s3pc-top"><div class="s3pc-ins"></div><div class="s3pc-tip"></div><div class="s3pc-seg" role="group" aria-label="סוג צילום"><button type="button" data-k="mp">נקודות</button><button type="button" data-k="mv">סרטון</button></div><button type="button" class="s3pc-ol" data-k="ol" aria-pressed="true">שכבת עזר</button><div class="s3pc-cnt"></div><canvas class="s3pc-map" width="288" height="144" aria-label="מפת כיסוי" hidden></canvas><div class="s3pc-hint" aria-live="polite"></div><div class="s3pc-fb" hidden><div class="s3pc-fi">זוזו צעד אחד הצידה, וכוונו את המצלמה ישר למטה, למקום שבו עמדתם</div><div class="s3pc-fr"><button type="button" class="s3pc-pri" data-k="fs">צלם</button><button type="button" data-k="fk">דלג</button></div></div></div>
<div class="s3pc-bar"><button type="button" data-k="x">ביטול</button><button type="button" data-k="r" disabled>צלם שוב את האחרונה</button><button type="button" class="s3pc-pri" data-k="d" disabled>סיום</button></div>
<div class="s3pc-msg"><div class="s3pc-card"><b></b><div class="s3pc-mt"></div><div class="s3pc-pb" hidden><i></i></div><button type="button" data-k="c" hidden>סגירה</button></div></div>`;
  host.appendChild(R);
  const $=s=>R.querySelector(s),ov=$('canvas.s3pc-ov'),cnt=$('.s3pc-cnt'),hint=$('.s3pc-hint'),msg=$('.s3pc-msg'),fl=$('.s3pc-fl');
  const S={help:lsG(HELP_KEY)!=='0',floor:false,floorDone:false,fwUntil:0,ovn:0,off:null,done:false,stream:null,camEl:null,cw:0,ch:0,stopSensor:null,q:null,hist:[],frames:[],T:[],TD:[],yaw0:null,fovL:0,fw:0,fh:0,raf:0,busy:false,last:0,xArm:0,phase:'init',
   mode:lsG(MODE_KEY)==='video'?'video':'pts',rec:false,vh:[],best:[],R:[],lastS:0,fast:0,vfc:0,sc:null,ph:null,track:null,phFail:0,phDir:0,phOff:false,pend:false,qs:null,pmax:0,reaimUntil:0,lock:null,lockDone:false,stopMotion:null,accE:0,accT:0,mv:-1e9};
  const ins=$('.s3pc-ins'),tip=$('.s3pc-tip'),map=$('canvas.s3pc-map');raw=null/* החומר הגולמי של הצילום הקודם משתחרר */;
  function cleanup(){if(S.raf)cancelAnimationFrame(S.raf);S.raf=0;if(S.vfc){try{S.camEl.cancelVideoFrameCallback(S.vfc)}catch(e){}S.vfc=0}try{S.stopSensor&&S.stopSensor()}catch(e){}S.stopSensor=null;try{S.stopMotion&&S.stopMotion()}catch(e){}S.stopMotion=null;
   try{S.stream&&S.stream.getTracks().forEach(t=>t.stop())}catch(e){}S.stream=null;try{mock&&mock.camera&&mock.camera.stop&&mock.camera.stop()}catch(e){}
   if(S.camEl&&S.camEl.tagName==='VIDEO'){try{S.camEl.srcObject=null}catch(e){}}window.removeEventListener('resize',size)}
  function finish(v){if(S.done)return;S.done=true;try{window.S3PanoNative&&window.S3PanoNative.cancel()}catch(e){}if(cur===finish)cur=null;cleanup();R.remove();resolve(v)}
  if(cur)cur(null);cur=finish;
  function showMsg(title,text,opt){opt=opt||{};$('.s3pc-card b').textContent=title;$('.s3pc-mt').textContent=text||'';$('.s3pc-pb').hidden=!opt.pb;$('[data-k=c]').hidden=!opt.close;msg.classList.add('on')}
  function fail(text){cleanup();S.phase='err';showMsg('אי אפשר לצלם 360',text,{close:true})}
  R.addEventListener('click',e=>{const b=e.target.closest('button[data-k]');if(!b||b.disabled)return;const k=b.dataset.k;
   if(k==='c')return finish(null);
   if(k==='ol'){S.help=!S.help;lsS(HELP_KEY,S.help?'1':'0');upd();return}
   if(k==='fs')return floorShoot();
   if(k==='fk'){if(S.phase==='cap'&&S.floor)run();return}
   if(k==='mp'||k==='mv'){if(S.phase==='cap'&&!started()){S.mode=k==='mv'?'video':'pts';lsS(MODE_KEY,S.mode);setFov();upd()}return}
   if(S.mode==='video'&&k==='d'&&S.phase==='cap'){if(!S.rec)startRec();else if(nGot()>=2)run();return}
   if(k==='x'){if(S.phase!=='cap'||nGot()<3||Date.now()-S.xArm<2500)return finish(null);S.xArm=Date.now();b.textContent='לבטל? הקישו שוב';setTimeout(()=>{if(!S.done)b.textContent='ביטול'},2500);return}
   if(k==='r'&&S.phase==='cap'){const f=S.frames.pop();if(f&&f.ti>=0)S.T[f.ti].got=false;S.floor=false;S.last=Date.now()+750;upd();return}
   if(k==='d'&&S.phase==='cap'&&S.frames.length>=2)return run()});
  function size(){const r=R.getBoundingClientRect(),dp=Math.min(2,window.devicePixelRatio||1);ov.width=Math.max(1,Math.round(r.width*dp));ov.height=Math.max(1,Math.round(r.height*dp))}
  /* כיול שדה הראייה נשמר בנפרד לתמונות אמיתיות (FOV_KEY+'-ph') ולווידאו; מחושב מחדש גם כשמחליפים מצב לפני הצילום הראשון */
  function setFov(){const key=S.ph&&!S.phOff&&S.mode!=='video'?FOV_KEY+'-ph':FOV_KEY;S.fovL=clamp(+opts.fov||+lsG(key)||FOV_DEF,35,110);const fv=fovOf(S.fovL,S.cw,S.ch);S.fw=fv.fw;S.fh=fv.fh;
   S.T=pickTargets(S.fw,S.fh,S.mode==='video'?OVERLAP:OVERLAP_PTS).map(t=>Object.assign(t,{got:false}))}
  function nextT(){return S.T.findIndex(t=>!t.got)}
  function nGot(){return S.mode==='video'?S.T.filter(t=>t.got).length:S.frames.length}
  function started(){return S.mode==='video'?S.rec:S.frames.length>0}
  function upd(){const n=nGot(),tot=S.T.length,v=S.mode==='video',st=started();
   ins.textContent=v?'הקליטו לאט: סיבוב אחד באמצע, סיבוב אחד למעלה וסיבוב אחד למטה':'עמדו במקום אחד, סובבו את הטלפון סביב המצלמה עצמה – לא סביב הגוף. צלמו כשהחנות ריקה מאנשים';
   tip.textContent='עמדו במרכז החדר, רחוק מרהיטים; סובבו את הטלפון סביב המצלמה. עצמים קרובים מאוד עלולים להיראות כפולים';tip.hidden=st;
   const ol=$('[data-k=ol]');ol.hidden=v;ol.setAttribute('aria-pressed',S.help?'true':'false');$('.s3pc-fb').hidden=v||!S.floor;
   for(const[k,on]of[['mp',!v],['mv',v]]){const b=$('[data-k='+k+']');b.setAttribute('aria-pressed',on?'true':'false');b.disabled=st&&!on}
   map.hidden=!v;$('[data-k=r]').hidden=v;
   const d=$('[data-k=d]');
   if(v){cnt.textContent='כוסו '+n+' מתוך '+tot;d.textContent=S.rec?'סיום':'הקלטה';d.disabled=S.rec&&n<2;return}
   cnt.textContent=S.floor?'שלב אחרון – צילום רצפה (לא חובה)':'צולמו '+n+' מתוך '+tot;
   $('[data-k=r]').disabled=!n;d.disabled=n<2;d.textContent=n>=tot?'חיבור':'סיום'}
  /* ---- מצב סרטון ---- */
  function startRec(){if(!S.q)return;S.rec=true;S.yaw0=yawPitch(S.q).yaw;S.best=S.T.map(()=>null);S.R=vidRadii(S.T);S.T.forEach(t=>t.got=false);S.lastS=0;upd()}
  /* דגימת פריים מהמצלמה החיה; t = רגע הפריים (performance.now) */
  function sample(t){const now=performance.now();if(S.busy||now-S.lastS<VID_MS||!S.TD.length)return;S.lastS=now;
   const lv=S.vh[S.vh.length-1];if(!lv||t-lv.t>250)return;/* החיישן לא עדכן לאחרונה – הכיוון של הפריים לא ידוע */
   if(angSpeed(S.vh,t)>VID_SPD){S.fast=now;return}
   const q=oriAt(S.vh,t);if(!q)return;
   const k=VID_SM/Math.max(S.cw,S.ch),sw=Math.max(8,Math.round(S.cw*k)),sh=Math.max(8,Math.round(S.ch*k));
   if(!S.sc){S.sc=cv(sw,sh);S.scx=S.sc.getContext('2d',{willReadFrequently:true})}
   let sharp;try{S.scx.drawImage(S.camEl,0,0,sw,sh);sharp=lapVar(S.scx.getImageData(0,0,sw,sh).data,sw,sh)}catch(e){return}
   const c=vidPick(camFwd(q),S.TD,S.R,S.best,sharp);if(!c.length)return;
   const kb=Math.min(1,FRAME_MAX/Math.max(S.cw,S.ch)),w=Math.round(S.cw*kb),h=Math.round(S.ch*kb),big=cv(w,h);
   try{big.getContext('2d').drawImage(S.camEl,0,0,w,h)}catch(e){return}
   const rec={blob:null,q,ti:c[0].i,w,h,yaw:yawPitch(q).yaw,t:Date.now(),src:'video'};S.busy=true;
   blobOf(big,.9).then(b=>{big.width=big.height=1;S.busy=false;if(!b||S.done||!S.rec)return;rec.blob=b;
    for(const x of c)if(!S.best[x.i]||x.s>S.best[x.i].s){S.best[x.i]={s:x.s,rec};S.T[x.i].got=true}upd();
    if(S.phase==='cap'&&S.T.every(t=>t.got))setTimeout(()=>{if(S.phase==='cap')run()},350)})}
  /* כל פריים נשמר פעם אחת, לפי סדר נקודות היעד (הראשון קובע את מרכז התמונה) */
  function vidFrames(){const seen=new Set(),out=[];for(const b of S.best)if(b&&!seen.has(b.rec)){seen.add(b.rec);out.push(b.rec)}return out}
  function drawMap(){const g=map.getContext('2d'),w=map.width,h=map.height,y0=S.yaw0!=null?S.yaw0:S.base||0;g.clearRect(0,0,w,h);const P=10,X=y=>P+(wrap180(y)+180)/360*(w-2*P),Y=p=>P+(90-p)/180*(h-2*P);
   g.strokeStyle='rgba(212,175,55,.35)';g.lineWidth=1;g.beginPath();g.moveTo(0,h/2);g.lineTo(w,h/2);g.stroke();
   S.T.forEach(t=>{g.beginPath();g.arc(X(t.yaw),Y(t.pitch),7,0,Math.PI*2);if(t.got){g.fillStyle='rgba(108,196,154,.95)';g.fill()}else{g.lineWidth=2;g.strokeStyle='rgba(255,255,255,.7)';g.stroke()}});
   if(S.q){const yp=yawPitch(S.q);g.beginPath();g.arc(X(yp.yaw-y0),Y(yp.pitch),5,0,Math.PI*2);g.fillStyle='#d4af37';g.fill()}}
  function stable(now){const h=S.hist;if(!h.length||now-h[0].t<STAB_MS)return 0;let mx=0;for(let i=h.length-1;i>=0&&now-h[i].t<=STAB_MS;i--)mx=Math.max(mx,qAngle(h[i].q,S.q));return mx<=STAB_DEG?1:0}
  /* ---- נעילת חשיפה / איזון לבן / מיקוד לפני הצילום הראשון (רק אם נתמך; כשל = ממשיכים בלי נעילה) ---- */
  const tmo=(p,ms)=>Promise.race([p,new Promise((_,j)=>setTimeout(()=>j(new Error('tmo')),ms))]);
  async function lockAll(){const L={exp:false,wb:false,focus:false};S.lock=L;const t=S.track;if(!t)return;let caps={},st={};
   try{caps=t.getCapabilities?t.getCapabilities()||{}:{};st=t.getSettings?t.getSettings()||{}:{}}catch(e){return}
   const has=(k,v)=>Array.isArray(caps[k])&&caps[k].indexOf(v)>=0,ap=async c=>{try{await tmo(t.applyConstraints({advanced:[c]}),1500);return true}catch(e){return false}};
   try{if(has('exposureMode','manual')){const c={exposureMode:'manual'};if(st.exposureTime!=null)c.exposureTime=st.exposureTime;if(st.iso!=null&&caps.iso)c.iso=st.iso;
    L.exp=await ap(c);if(!L.exp&&c.iso!=null){delete c.iso;L.exp=await ap(c)}}}catch(e){}
   try{if(has('whiteBalanceMode','manual')&&st.colorTemperature!=null)L.wb=await ap({whiteBalanceMode:'manual',colorTemperature:st.colorTemperature})}catch(e){}
   try{if(has('focusMode','manual')&&st.focusDistance!=null)L.focus=await ap({focusMode:'manual',focusDistance:st.focusDistance})}catch(e){}
   if(L.exp||L.wb||L.focus)await new Promise(r=>setTimeout(r,200))}
  /* ---- צילום תמונה אמיתית לנקודת יעד (מצב נקודות). כל כשל ⇒ מחזירים את השליטה ללולאה (שוב, או חזרה לווידאו) ---- */
  function phOff(){S.phOff=true;if(!S.frames.length)setFov()}
  async function grabPhoto(ti,floor){S.busy=true;S.pend=true;S.pmax=0;let blob=null,ref=null,q0=null,ok=false;
   try{S.qs=q0=S.q.slice();
    try{const k=48/Math.max(S.cw,S.ch);ref=cv(Math.max(8,Math.round(S.cw*k)),Math.max(8,Math.round(S.ch*k)));ref.getContext('2d').drawImage(S.camEl,0,0,ref.width,ref.height)}catch(e){ref=null}
    blob=await tmo(Promise.resolve(S.ph.take()),PH_TMO);ok=!!(blob&&blob.size)}catch(e){ok=false}
   S.pend=false;S.qs=null;const moved=Math.max(S.pmax,q0?qAngle(q0,S.q):0);
   if(S.done||S.phase!=='cap'){S.busy=false;return}
   if(!ok){if(++S.phFail>=PH_FAILS)phOff();S.busy=false;S.last=Date.now();upd();return}
   if(!floor&&moved>PH_MOVE){S.reaimUntil=performance.now()+2200;S.busy=false;S.last=Date.now()+500;return}
   const c=await photoCanvas(blob,S.cw,S.ch,ref,S.phDir);if(ref){ref.width=ref.height=1}
   if(c&&c._dir)S.phDir=c._dir;
   if(!c){phOff();S.busy=false;S.last=Date.now();upd();return}
   const th=floor?null:mkThumb(c),b=await blobOf(c,.92),w=c.width,h=c.height;c.width=c.height=1;
   if(S.done||S.phase!=='cap'||!b){if(!b)phOff();S.busy=false;return}
   const yaw=yawPitch(q0).yaw;if(!S.frames.length&&S.yaw0==null)S.yaw0=yaw;const rec={blob:b,q:q0,ti:floor?-1:ti,w,h,yaw,t:Date.now(),src:'photo',th};if(floor){rec.role='nadir';S.floorDone=true;S.floor=false}else S.T[ti].got=true;S.frames.push(rec);S.last=Date.now();
   try{navigator.vibrate&&navigator.vibrate(30)}catch(e){}fl.classList.remove('on');void fl.offsetWidth;fl.classList.add('on');setTimeout(()=>fl.classList.remove('on'),60);
   S.busy=false;upd();afterShot()}
  /* ---- שלב 21ה: תמונה ממוזערת לשכבת העזר, סיום הנקודות ⇒ צילום רצפה, שכבת עזר ---- */
  function mkThumb(c){try{const k=Math.min(1,HELP_TH/Math.max(c.width,c.height)),t=cv(Math.max(2,Math.round(c.width*k)),Math.max(2,Math.round(c.height*k)));t.getContext('2d').drawImage(c,0,0,t.width,t.height);return t}catch(e){return null}}
  function afterShot(){if(S.phase==='cap'&&S.frames.length>=S.T.length&&S.T.every(t=>t.got))setTimeout(()=>{if(S.phase!=='cap')return;if(S.floorDone||S.mode==='video')run();else{S.floor=true;upd()}},350)}
  /* צילום רצפה: בלי בדיקת "זז" (המשתמש אמור לזוז), אבל חייבים לכוון למטה */
  function floorShoot(){if(S.phase!=='cap'||!S.floor||S.floorDone||S.busy||!S.q)return;if(yawPitch(S.q).pitch>=FLOOR_PITCH){S.fwUntil=performance.now()+2500;return}grab(-1,true)}
  /* פריימים קרובים לכיוון הנוכחי, חצי שקופים על התצוגה, ממוקמים לפי הכיוון: רשת HELP_N×HELP_N של משולשים (affine), מצוירת בקנבס צדדי ואז מודבקת בשקיפות אחת */
  function drawHelp(g,m,f,cx,cy,Wd,Hd,fwd){
   const c=[];for(const r of S.frames){if(!r.th)continue;const a=angDir(camFwd(r.q),fwd);if(a<Math.max(S.fw,S.fh))c.push({r,a})}
   if(!c.length)return;c.sort((x,y)=>x.a-y.a);c.length=Math.min(c.length,2);
   if(!S.off||S.off.width!==Wd||S.off.height!==Hd)S.off=cv(Wd,Hd);const og=S.off.getContext('2d'),N=HELP_N;let any=false;og.clearRect(0,0,Wd,Hd);
   for(const{r}of c){const t=r.th,tw=t.width,th=t.height,ft=fovOf(S.fovL,tw,th).f,rm=qToMat(r.q),P=[];
    for(let j=0;j<=N;j++)for(let i=0;i<=N;i++){const u=i/N*tw,v=j/N*th,x=(u-tw/2)/ft,y=-(v-th/2)/ft,d=[rm[0]*x+rm[1]*y-rm[2],rm[3]*x+rm[4]*y-rm[5],rm[6]*x+rm[7]*y-rm[8]],p=projToFrame(m,d,f,cx,cy);P.push(p?{u,v,x:p[0],y:p[1]}:null)}
    const tri=(a,b,e)=>{const det=(b.u-a.u)*(e.v-a.v)-(e.u-a.u)*(b.v-a.v);if(Math.abs(det)<1e-9)return;
     const A=((b.x-a.x)*(e.v-a.v)-(e.x-a.x)*(b.v-a.v))/det,C=((e.x-a.x)*(b.u-a.u)-(b.x-a.x)*(e.u-a.u))/det,B=((b.y-a.y)*(e.v-a.v)-(e.y-a.y)*(b.v-a.v))/det,Dd=((e.y-a.y)*(b.u-a.u)-(b.y-a.y)*(e.u-a.u))/det,
      gx=(a.x+b.x+e.x)/3,gy=(a.y+b.y+e.y)/3,ex=q=>q.x+(q.x>gx?.6:-.6),ey=q=>q.y+(q.y>gy?.6:-.6);/* הרחבה קלה נגד סדקים */
     og.save();og.beginPath();og.moveTo(ex(a),ey(a));og.lineTo(ex(b),ey(b));og.lineTo(ex(e),ey(e));og.closePath();og.clip();og.transform(A,B,C,Dd,a.x-A*a.u-C*a.v,a.y-B*a.u-Dd*a.v);og.drawImage(t,0,0);og.restore();any=true};
    for(let j=0;j<N;j++)for(let i=0;i<N;i++){const a=P[j*(N+1)+i],b=P[j*(N+1)+i+1],d=P[(j+1)*(N+1)+i],e=P[(j+1)*(N+1)+i+1];if(!a||!b||!d||!e)continue;
     if(Math.max(a.x,b.x,d.x,e.x)<0||Math.min(a.x,b.x,d.x,e.x)>Wd||Math.max(a.y,b.y,d.y,e.y)<0||Math.min(a.y,b.y,d.y,e.y)>Hd)continue;tri(a,b,d);tri(b,e,d)}}
   if(any){g.save();g.globalAlpha=HELP_A;g.drawImage(S.off,0,0);g.restore();S.ovn++}}
  function grab(ti,floor){
   if(!S.lockDone){S.busy=true;S.lockDone=true;lockAll().catch(()=>{}).then(()=>{S.busy=false;S.last=Date.now()});return}
   if(S.ph&&!S.phOff){grabPhoto(ti,floor);return}
   S.busy=true;const k=Math.min(1,FRAME_MAX/Math.max(S.cw,S.ch)),w=Math.round(S.cw*k),h=Math.round(S.ch*k),c=cv(w,h),q=S.q.slice();
   try{c.getContext('2d').drawImage(S.camEl,0,0,w,h)}catch(e){S.busy=false;return}
   const yaw=yawPitch(q).yaw;if(!S.frames.length&&S.yaw0==null)S.yaw0=yaw;if(!floor)S.T[ti].got=true;
   const rec={blob:null,q,ti:floor?-1:ti,w,h,yaw,t:Date.now(),src:'video',th:floor?null:mkThumb(c)};if(floor){rec.role='nadir';S.floorDone=true;S.floor=false}S.frames.push(rec);S.last=Date.now();
   try{navigator.vibrate&&navigator.vibrate(30)}catch(e){}fl.classList.remove('on');void fl.offsetWidth;fl.classList.add('on');setTimeout(()=>fl.classList.remove('on'),60);
   blobOf(c,.9).then(b=>{rec.blob=b;c.width=c.height=1;S.busy=false;if(!b){const i=S.frames.indexOf(rec);if(i>=0){S.frames.splice(i,1);if(!floor)S.T[ti].got=false;else S.floorDone=false}}upd();
    afterShot()});upd()}
  function loop(){S.raf=requestAnimationFrame(loop);if(S.phase!=='cap'||!S.q)return;const now=performance.now(),g=ov.getContext('2d'),Wd=ov.width,Hd=ov.height;
   g.clearRect(0,0,Wd,Hd);
   const m=qToMat(S.q),sc=Math.max(Wd/S.cw,Hd/S.ch),f=fovOf(S.fovL,S.cw,S.ch).f*sc,cx=Wd/2,cy=Hd/2,fwd=camFwd(S.q),dp=Wd/Math.max(1,R.clientWidth);
   if(S.help&&S.mode!=='video'&&!S.floor&&S.frames.length)drawHelp(g,m,f,cx,cy,Wd,Hd,fwd);
   const ni=nextT();let aim=-1,best=1e9;
   if(S.yaw0==null){const yp=yawPitch(S.q);S.base=yp.yaw}
   const y0=S.yaw0!=null?S.yaw0:S.base;
   S.TD=S.T.map(t=>dirOf(t.yaw+y0,t.pitch));
   S.T.forEach((t,i)=>{const a=angDir(fwd,S.TD[i]);if(!t.got&&a<best){best=a;aim=i}
    const p=projToFrame(m,S.TD[i],f,cx,cy);if(!p||p[0]<-40||p[0]>Wd+40||p[1]<-40||p[1]>Hd+40)return;
    g.beginPath();g.arc(p[0],p[1],(t.got?7:i===ni?20:9)*dp,0,Math.PI*2);
    if(t.got){g.fillStyle='rgba(108,196,154,.85)';g.fill()}else if(i===ni){g.lineWidth=4*dp;g.strokeStyle='#d4af37';g.stroke();g.fillStyle='rgba(212,175,55,.25)';g.fill()}else{g.lineWidth=2*dp;g.strokeStyle='rgba(255,255,255,.75)';g.stroke()}});
   const vid=S.mode==='video',tol=Math.min(AIM_TOL,S.fw*.12),on=!vid&&aim>=0&&best<=tol,st=on&&stable(Date.now());
   /* כוונת */
   g.beginPath();g.arc(cx,cy,26*dp,0,Math.PI*2);g.lineWidth=3*dp;g.strokeStyle=on?'#fff':'rgba(212,175,55,.9)';g.stroke();
   g.beginPath();g.moveTo(cx-8*dp,cy);g.lineTo(cx+8*dp,cy);g.moveTo(cx,cy-8*dp);g.lineTo(cx,cy+8*dp);g.lineWidth=2*dp;g.stroke();
   if(on){const h=S.hist;let k=0;if(h.length){let t0=Date.now();for(let i=h.length-1;i>=0;i--){if(qAngle(h[i].q,S.q)>STAB_DEG)break;t0=h[i].t}k=clamp((Date.now()-t0)/STAB_MS,0,1)}
    g.beginPath();g.arc(cx,cy,26*dp,-Math.PI/2,-Math.PI/2+k*Math.PI*2);g.lineWidth=6*dp;g.strokeStyle='#d4af37';g.stroke()}
   /* חץ ליעד הבא כשהוא לא על המסך */
   const fd=S.floor?[0,0,-1]:null,ad=fd||(ni>=0?S.TD[ni]:null);
   if(fd){const p=projToFrame(m,fd,f,cx,cy);if(p){g.beginPath();g.arc(p[0],p[1],20*dp,0,Math.PI*2);g.lineWidth=4*dp;g.strokeStyle='#d4af37';g.stroke();g.fillStyle='rgba(212,175,55,.25)';g.fill()}}
   if(ad&&!on){const d=ad,x=m[0]*d[0]+m[3]*d[1]+m[6]*d[2],y=m[1]*d[0]+m[4]*d[1]+m[7]*d[2],z=m[2]*d[0]+m[5]*d[1]+m[8]*d[2];
    const p=z<0?[x*f/-z,-y*f/-z]:[x,-y],L=Math.hypot(p[0],p[1]);
    if(z>=0||Math.abs(p[0])>Wd/2-30*dp||Math.abs(p[1])>Hd/2-30*dp){const ux=p[0]/(L||1),uy=p[1]/(L||1),r=Math.min(Wd,Hd)*.3,ax=cx+ux*r,ay=cy+uy*r;
     g.save();g.translate(ax,ay);g.rotate(Math.atan2(uy,ux));g.beginPath();g.moveTo(18*dp,0);g.lineTo(-10*dp,-13*dp);g.lineTo(-4*dp,0);g.lineTo(-10*dp,13*dp);g.closePath();g.fillStyle='#d4af37';g.fill();g.restore()}}
   let h='',warn=false;
   if(vid){drawMap();if(S.rec&&!S.vfcOn)sample(now);warn=S.rec&&now-S.fast<700}
   if(S.pend)h='מצלם… החזיקו יציב';else if(S.floor)h=now<S.fwUntil||yawPitch(S.q).pitch>=FLOOR_PITCH?'כוונו את המצלמה ישר למטה, אל העיגול הזהוב':'לחצו "צלם"';else if(now<S.reaimUntil)h='זז בזמן הצילום – כוונו שוב והחזיקו יציב';else if(vid&&!S.rec)h='לחצו "הקלטה" והתחילו להסתובב לאט';else if(warn)h='לאט יותר';else if(ni<0)h=vid?'הכיסוי מלא':'כל הנקודות צולמו';else if(on)h=S.busy?'שומר…':'החזיקו יציב…';else{
    const d=S.TD[ni],x=m[0]*d[0]+m[3]*d[1]+m[6]*d[2],y=m[1]*d[0]+m[4]*d[1]+m[7]*d[2];h=Math.abs(x)>=Math.abs(y)?(x>0?'סובבו ימינה אל העיגול הזהוב':'סובבו שמאלה אל העיגול הזהוב'):(y>0?'הטו למעלה אל העיגול הזהוב':'הטו למטה אל העיגול הזהוב')}
   /* הטלפון זז (לא רק מסתובב) ⇒ פרלקסה בעצמים קרובים; הודעה בלבד, בלי לחסום */
   if(!warn&&started()&&now-S.mv<1500){h='סובבו את הטלפון במקום, בלי להזיז אותו';warn=true}
   if(hint.textContent!==h)hint.textContent=h;hint.classList.toggle('warn',warn);
   if(!vid&&st&&!S.busy&&Date.now()-S.last>250&&S.camEl&&(S.camEl.videoWidth||S.camEl.width))grab(aim)}
  function onOri(e){if(S.done||e==null||e.alpha==null||e.beta==null||e.gamma==null)return;
   const ang=e.angle!=null?e.angle:mock&&mock.angle!=null?mock.angle:screenAngle();S.q=oriToQuat(+e.alpha,+e.beta,+e.gamma,ang);const t=Date.now(),pt=performance.now();S.hist.push({t,q:S.q});
   if(S.qs)S.pmax=Math.max(S.pmax,qAngle(S.qs,S.q));S.vh.push({t:pt,q:S.q});while(S.vh.length>2&&pt-S.vh[0].t>1000)S.vh.shift();
   while(S.hist.length&&t-S.hist[0].t>STAB_MS+400)S.hist.shift()}
  /* מד תאוצה (בלי כוח המשיכה): ממוצע נע של גודל התאוצה; אם אין נתון – מדלגים בשקט */
  function onMot(e){if(S.done||!e)return;const a=e.acceleration;if(!a||a.x==null||a.y==null||a.z==null)return;
   const now=performance.now(),dt=S.accT?Math.min(.2,(now-S.accT)/1000):0;S.accT=now;const m=Math.hypot(+a.x||0,+a.y||0,+a.z||0);
   S.accE+=(m-S.accE)*(dt?1-Math.exp(-dt/.25):1);if(S.accE>MOVE_ACC&&S.phase==='cap')S.mv=now}
  const api={target:()=>{if(S.floor)return{yaw:S.yaw0!=null?S.yaw0:0,pitch:-90,i:-1};const i=nextT();if(i<0||!S.T.length)return null;const y0=S.yaw0!=null?S.yaw0:S.base!=null?S.base:0;return{yaw:S.T[i].yaw+y0,pitch:S.T[i].pitch,i}},state:()=>({phase:S.phase,n:nGot(),tot:S.T.length,mode:S.mode,rec:S.rec,floor:S.floor,ovn:S.ovn,help:S.help})};
  async function run(){if(S.phase!=='cap')return;
   S.phase='stitch';if(S.busy){for(let i=0;i<50&&S.busy;i++)await new Promise(r=>setTimeout(r,50))}
   const frames=(S.mode==='video'?vidFrames():S.frames).filter(f=>f.blob);S.frames.forEach(f=>{f.th=null});cleanup();if(frames.length<2)return fail('צולמו פחות משתי תמונות.');
   const pb=$('.s3pc-pb i');showMsg('מחבר את התמונות…','זה לוקח כמה שניות. אל תסגרו את האפליקציה.',{pb:true});
   const t0=Date.now();
   const r6=a=>a.map(x=>Math.round(x*1e6)/1e6);
   const keep=r=>{raw={frames:frames.map(f=>({blob:f.blob})),meta:{kind:'s3pano-raw',v:1,created:new Date().toISOString(),mode:S.mode==='video'?'video':'pts',n:frames.length,ua:navigator.userAgent||'',dev:mock?'mock':devName(),
     screenAngle:screenAngle(),video:{w:S.cw,h:S.ch},lock:S.lock||null,photo:{avail:!!S.ph,off:S.phOff,fails:S.phFail,max:PHOTO_MAX},fovL0:S.fovL,fixedFov:!!opts.fov,fovL:r?Math.round(r.fovL*100)/100:null,fovH:r?Math.round(r.fovH*100)/100:null,cal:r&&r.cal?{fovL:r.cal.fovL,score:r.cal.score,base:r.cal.base,sh:r.cal.sh,n:r.cal.n}:null,
     out:r?{w:r.w,h:r.h}:null,engine:r?(r.nat?'native':'js'):null,nat:r&&r.nat?r.nat:null,ok:!!r,ms:Date.now()-t0,blendDeg:BLEND_DEG,align:r&&r.al?{pairs:r.al.pairs,used:r.al.used,ms:r.al.ms,maxDeg:AL_MAX}:null,warp:r&&r.wf?{pts:r.wf.pts,ms:r.wf.ms,maxDeg:WP_MAX,sigDeg:WP_SIG}:null,yawRef:frames[0].yaw,
     conv:'q=[w,x,y,z] מצלמה→עולם; עולם x=מזרח y=צפון z=למעלה (alpha יחסי); מצלמה x=ימין y=למעלה מבט ל-z-. qFix=סיבוב(fixDeg, וקטור בעולם, מעלות)·q',
     frames:frames.map((f,i)=>Object.assign({file:'frame-'+String(i).padStart(2,'0')+'.jpg',src:f.src||'video',w:f.w,h:f.h,ti:f.ti,t:f.t,yaw:Math.round(f.yaw*1000)/1000,q:r6(f.q),qFix:r&&r.qs?r6(r.qs[i]):null,fixDeg:r&&r.al?r.al.fix[i]:null},f.role?{role:f.role}:{}))}}};
   try{const r=await stitch(frames,{fovL:S.fovL,fixedFov:!!opts.fov,maxTex:opts.maxTex,width:opts.width,noAlign:!!opts.noAlign,noWarp:!!opts.noWarp},p=>{pb.style.width=Math.round(p*100)+'%';$('.s3pc-mt').textContent='מחבר את התמונות… '+Math.round(p*100)+'%'});
    try{keep(r)}catch(e){}if(!r.full||!r.sm)throw new Error('encode');
    const ns=new Set(frames.map(f=>f.src||'video')),fk=ns.size===1?(ns.has('photo')?FOV_KEY+'-ph':FOV_KEY):null;/* מעורב (חזרה לווידאו באמצע) – לא שומרים כיול */
    if(!opts.fov&&fk&&r.cal&&r.fovL!==S.fovL)lsS(fk,String(Math.round(r.fovL*10)/10));
    finish({full:r.full,sm:r.sm,w:r.w,h:r.h,meta:{n:frames.length,mode:S.mode==='video'?'video':'pts',fovH:Math.round(r.fovH*10)/10,fovL:Math.round(r.fovL*10)/10,yawRef:Math.round(frames[0].yaw*100)/100,dev:mock?'mock':devName(),ms:Date.now()-t0,src:frames.filter(f=>f.src==='photo').length+'/'+frames.length,lock:S.lock||null,engine:r.nat?'native':'js'}})}
   catch(e){if(!raw)try{keep(null)}catch(e2){}fail('החיבור נכשל (ייתכן שאין מספיק זיכרון בטלפון). נסו שוב.')}}
  /* מכשיר אמיתי: בקשת הרשאת חיישן (אם הדפדפן דורש) חייבת לצאת מיד, בזמן שהלחיצה של המשתמש עוד "טרייה"; לא נכשלים לפי התשובה – רק אם לא מגיעים אירועים */
  let perm=null;
  if(!mock&&typeof DeviceOrientationEvent!=='undefined'){
   try{if(typeof DeviceOrientationEvent.requestPermission==='function')perm=Promise.resolve(DeviceOrientationEvent.requestPermission()).catch(()=>'')}catch(e){}
   const h=e=>onOri(e);window.addEventListener('deviceorientation',h);S.stopSensor=()=>window.removeEventListener('deviceorientation',h)}
  if(!mock&&typeof window.DeviceMotionEvent!=='undefined'){const hm=e=>onMot(e);window.addEventListener('devicemotion',hm);S.stopMotion=()=>window.removeEventListener('devicemotion',hm)}
  if(mock&&mock.motion)S.stopMotion=mock.motion(onMot);
  (async()=>{
   showMsg('פותח את המצלמה…','');
   /* מצלמה */
   if(mock){S.camEl=mock.camera.el;S.cw=mock.camera.w||S.camEl.width;S.ch=mock.camera.h||S.camEl.height;
    if(typeof mock.photo==='function')S.ph={take:()=>mock.photo()};const mc=mock.caps;
    if(mc)S.track={getCapabilities:()=>mc.caps||{},getSettings:()=>mc.settings||{},applyConstraints:c=>mc.apply?mc.apply(c):Promise.resolve()}}
   else{const md=navigator.mediaDevices;if(!md||!md.getUserMedia)return fail('אין גישה למצלמה בטלפון הזה.');
    try{S.stream=await md.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1440}}})}catch(e){return fail(camErr(e))}
    if(S.done)return cleanup();const v=document.createElement('video');v.setAttribute('playsinline','');v.muted=true;v.autoplay=true;v.srcObject=S.stream;S.camEl=v;
    try{const tr=S.stream.getVideoTracks()[0];S.track=tr||null;if(tr&&window.ImageCapture&&tr.readyState==='live'){const ic=new ImageCapture(tr);S.ph={take:()=>ic.takePhoto()}}}catch(e){S.ph=null}
    try{await v.play()}catch(e){}
    for(let i=0;i<60&&!v.videoWidth;i++)await new Promise(r=>setTimeout(r,50));
    if(!v.videoWidth)return fail('המצלמה לא נפתחה. נסו שוב.');S.cw=v.videoWidth;S.ch=v.videoHeight}
   if(S.done)return cleanup();
   S.camEl.classList.add('s3pc-cam');$('.s3pc-camw').appendChild(S.camEl);
   /* מצב סרטון: דגימה לפי פריימי הווידאו (אם יש), עם זמן הצילום של הפריים; אחרת מתוך הלולאה (rAF + זמן) */
   if(typeof S.camEl.requestVideoFrameCallback==='function'){S.vfcOn=true;const vf=(now,md)=>{if(S.done)return;S.vfc=S.camEl.requestVideoFrameCallback(vf);
    if(S.phase==='cap'&&S.mode==='video'&&S.rec){let t=md&&md.captureTime;if(!(t>now-400&&t<=now+5))t=now;sample(t)}};S.vfc=S.camEl.requestVideoFrameCallback(vf)}
   /* חיישן כיוון (במכשיר אמיתי המאזין נרשם כבר בהתחלה, למטה) */
   if(mock)S.stopSensor=mock.sensor(onOri,api);
   for(let i=0;i<40&&!S.q&&!S.done;i++)await new Promise(r=>setTimeout(r,50));
   if(S.done)return;
   if(!S.q){const p=perm?await Promise.race([perm,new Promise(r=>setTimeout(()=>r(''),300))]):'';
    return fail(p==='denied'?'אין הרשאה לחיישן הכיוון של הטלפון, ובלעדיו אי אפשר לצלם 360.':'חיישן הכיוון של הטלפון לא עונה (אין ג\'ירוסקופ או שהוא חסום), ובלעדיו אי אפשר לצלם 360.')}
   /* שדה ראייה ונקודות יעד */
   setFov();
   msg.classList.remove('on');size();window.addEventListener('resize',size);S.phase='cap';upd();loop()})().catch(()=>fail('תקלה בפתיחת הצילום. נסו שוב.'));
 })}

return{start,close,isOpen:()=>!!cur,lastRaw,_m:M};
});
