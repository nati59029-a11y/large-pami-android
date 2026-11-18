/* ניסוי "צילום חופשי של קיר" (אב-טיפוס, בטלפון בלבד): כמה תמונות, סימון לאיזו שורה של הקיר כל תמונה שייכת, וחיבור לתמונה אחת.
   כלום לא נשלח לשרת ולא נשמר כחזית – הכול בטלפון (התמונות המוקטנות ב-IndexedDB, בלי מערכת). נטען אחרי store3d-setupcap.js ו-store3d-warp.js.
   זיהוי חפיפה אוטומטי: לכל שתי תמונות שכנות בשורה – הזזה וקנה מידה (0.9–1.1) לפי התאמה מנורמלת (NCC) על תמונה אפורה מסוננת (high-pass),
   גס ← בינוני ← עדין. בין שורות: התאמה במספר חלונות לאורך הרצועה והתאמת הזזה+קנה מידה לכל השורה. ביטחון נמוך = "לא בטוח" וחלוקה לפי המחוון.
   הבנייה ברזולוציה גבוהה, באריחים (עד 2048×2048 כל אחד), מיזוג רך באזור החפיפה (עד 15% מרוחב התמונה). אזור שלא צולם מסומן.
   החלק הראשון (S3FreeWall: wallsOf, estimate, layout) הוא קוד טהור (בלי DOM) ורץ גם בבדיקות Node. החלק השני הוא המסך.
   מוסכמות: בקוד הטהור rows[0] = השורה העליונה בקיר. במסך שורה 1 = התחתונה (ליד הרצפה) והמסך הופך את הסדר לפני החיבור. בכל שורה התמונה הראשונה = הכי שמאלית. */
(function(root){
'use strict';
const MAXPH=120,HE=480/* גובה כל תמונה לזיהוי החפיפה */,DEFH=300,OKT=.3/* סף ביטחון (NCC) */,ROWH=900/* גובה שורה בתוצאה (פיקסלים) */,TILE=2048,MAXA=60e6/* שטח תוצאה מרבי */;
const cl=(v,a,b)=>v<a?a:v>b?b:v;
const tick=()=>new Promise(r=>setTimeout(r,0));
/* קירות המפה: פריטי k==='w' מקובצים לפי חדר+צלע ומספרים ברצף (n). אורך = סכום אורכי הקטעים (ס"מ), גובה = גובה התקרה של החדר אם קיים.
   x1,y1 = תחילת הקיר (הצד השמאלי כשעומדים מולו – התוכנית מסדרת קטעים בכיוון השעון), x2,y2 = סופו */
function wallsOf(plan,map){
 const by=new Map(),out=[];
 for(const it of (plan&&plan.items)||[]){if(!it||it.k!=='w'||!Array.isArray(it.geo)||it.geo.length<4)continue;
  const key=it.room+'|'+it.edge;let g=by.get(key);
  if(!g){const rm=((map&&map.rooms)||[]).find(r=>r&&r.id===it.room);g={key,n:out.length+1,room:it.room,edge:it.edge,name:rm&&rm.name?String(rm.name).slice(0,30):'',len:0,h:rm&&Number.isFinite(rm.h)&&rm.h>=200?rm.h:0,segs:[]};by.set(key,g);out.push(g)}
  g.len+=Math.hypot(it.geo[2]-it.geo[0],it.geo[3]-it.geo[1]);g.segs.push(it.geo)}
 for(const g of out){const S=g.segs,near=(a,b,c,d)=>Math.hypot(a-c,b-d)<2;
  let st=S.find(a=>!S.some(b=>b!==a&&near(b[2],b[3],a[0],a[1])))||S[0],en=S.find(a=>!S.some(b=>b!==a&&near(b[0],b[1],a[2],a[3])))||S[S.length-1];
  g.x1=st[0];g.y1=st[1];g.x2=en[2];g.y2=en[3]}
 return out}
/* ---------- זיהוי חפיפה ---------- */
/* תמונה: {w,h,g:Uint8Array אפור}. פירמידה (חצי גודל) וסינון גבוה (g פחות טשטוש) נשמרים על האובייקט */
function ds2(im){const w=im.w>>1,h=im.h>>1,d=new Uint8Array(w*h),g=im.g,W=im.w;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=2*y*W+2*x;d[y*w+x]=(g[i]+g[i+1]+g[i+W]+g[i+W+1]+2)>>2}
 return{w,h,g:d}}
function hpOf(im){const{w,h,g}=im,r=3,t=new Float32Array(w*h),o=new Float32Array(w*h),P=new Float32Array(Math.max(w,h)+1);
 for(let y=0;y<h;y++){const q=y*w;P[0]=0;for(let x=0;x<w;x++)P[x+1]=P[x]+g[q+x];for(let x=0;x<w;x++){const a=Math.max(0,x-r),b=Math.min(w,x+r+1);t[q+x]=(P[b]-P[a])/(b-a)}}
 for(let x=0;x<w;x++){P[0]=0;for(let y=0;y<h;y++)P[y+1]=P[y]+t[y*w+x];for(let y=0;y<h;y++){const a=Math.max(0,y-r),b=Math.min(h,y+r+1);o[y*w+x]=g[y*w+x]-(P[b]-P[a])/(b-a)}}
 return{w,h,d:o}}
function lv(im,l){if(!im._p){im._p=[im];im._h=[]}while(im._p.length<=l)im._p.push(ds2(im._p[im._p.length-1]));return im._h[l]||(im._h[l]=hpOf(im._p[l]))}
const free=im=>{if(im){im._p=null;im._h=null}};
/* נרמול בהירות וניגודיות של תמונה (ממוצע 128, סטיית תקן ~48) – כדי שהבדלי חשיפה בין תמונות לא יפגעו בהשוואה */
function norm(im){const g=im.g,n=g.length;let s=0,q=0;for(let i=0;i<n;i++){s+=g[i];q+=g[i]*g[i]}const m=s/n,sd=Math.sqrt(Math.max(1,q/n-m*m)),k=48/sd,o=new Uint8Array(n);for(let i=0;i<n;i++)o[i]=cl(128+(g[i]-m)*k,0,255);return{w:im.w,h:im.h,g:o}}
/* שינוי גודל בילינארי (אפור) */
function resample(im,t){
 if(Math.abs(t-1)<1e-4)return im;const w=Math.max(8,Math.round(im.w*t)),h=Math.max(8,Math.round(im.h*t)),g=new Uint8Array(w*h),sx=im.w/w,sy=im.h/h,X0=new Int32Array(w),X1=new Int32Array(w),FX=new Float32Array(w);
 for(let x=0;x<w;x++){const f=cl((x+.5)*sx-.5,0,im.w-1),a=Math.floor(f);X0[x]=a;X1[x]=Math.min(im.w-1,a+1);FX[x]=f-a}
 for(let y=0;y<h;y++){const f=cl((y+.5)*sy-.5,0,im.h-1),a=Math.floor(f),b=Math.min(im.h-1,a+1),fy=f-a,ra=a*im.w,rb=b*im.w;
  for(let x=0;x<w;x++){const fx=FX[x],p=im.g[ra+X0[x]]*(1-fx)+im.g[ra+X1[x]]*fx,q=im.g[rb+X0[x]]*(1-fx)+im.g[rb+X1[x]]*fx;g[y*w+x]=p+(q-p)*fy+.5}}
 return{w,h,g}}
/* NCC על אזור החפיפה של A ו-B כש-B מוזזת ב-(dx,dy) ביחס ל-A. -2 = אין מספיק חפיפה, 0 = אין מרקם */
function ncc(A,B,dx,dy,st,minN){
 const x0=Math.max(0,dx),x1=Math.min(A.w,dx+B.w),y0=Math.max(0,dy),y1=Math.min(A.h,dy+B.h);
 if(x1-x0<4||y1-y0<4)return -2;
 let n=0,sa=0,sb=0,saa=0,sbb=0,sab=0;const ad=A.d,bd=B.d;
 for(let y=y0;y<y1;y+=st){const ia=y*A.w,ib=(y-dy)*B.w-dx;for(let x=x0;x<x1;x+=st){const a=ad[ia+x],b=bd[ib+x];n++;sa+=a;sb+=b;saa+=a*a;sbb+=b*b;sab+=a*b}}
 if(n<minN)return -2;
 const va=saa-sa*sa/n,vb=sbb-sb*sb/n;if(va<.3*n||vb<.3*n)return 0;
 return(sab-sa*sb/n)/Math.sqrt(va*vb)}
/* NCC של חלון (pw×ph) שפינתו (bx,by) ב-B מול אותו גודל שפינתו (ax,ay) ב-A */
function nccP(A,B,ax,ay,bx,by,pw,ph,st){
 if(ax<0||ay<0||ax+pw>A.w||ay+ph>A.h||bx<0||by<0||bx+pw>B.w||by+ph>B.h)return -2;
 let n=0,sa=0,sb=0,saa=0,sbb=0,sab=0;
 for(let y=0;y<ph;y+=st){const ia=(ay+y)*A.w+ax,ib=(by+y)*B.w+bx;for(let x=0;x<pw;x+=st){const a=A.d[ia+x],b=B.d[ib+x];n++;sa+=a;sb+=b;saa+=a*a;sbb+=b*b;sab+=a*b}}
 const va=saa-sa*sa/n,vb=sbb-sb*sb/n;if(va<.3*n||vb<.3*n)return 0;
 return(sab-sa*sb/n)/Math.sqrt(va*vb)}
function coarse(a2,b2,r,st){
 const cx0=Math.floor(r.x0/4),cx1=Math.ceil(r.x1/4),cy0=Math.floor(r.y0/4),cy1=Math.ceil(r.y1/4),nx=cx1-cx0+1,ny=cy1-cy0+1,G=new Float32Array(Math.max(1,nx*ny)).fill(-2);let best=-3,bx=cx0,by=cy0;
 for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){const v=ncc(a2,b2,cx0+i,cy0+j,st,120);G[j*nx+i]=v;if(v>best){best=v;bx=cx0+i;by=cy0+j}}
 let second=-3;for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){if(Math.abs(cx0+i-bx)<=2&&Math.abs(cy0+j-by)<=2)continue;if(G[j*nx+i]>second)second=G[j*nx+i]}
 return{best,second,bx,by}}
function around(a,b,cx,cy,R,st,minN){let s=-3,bx=cx,by=cy;for(let dy=cy-R;dy<=cy+R;dy++)for(let dx=cx-R;dx<=cx+R;dx++){const v=ncc(a,b,dx,dy,st,minN);if(v>s){s=v;bx=dx;by=dy}}return{s,x:bx,y:by}}
/* חיפוש הזזה (dx,dy) וקנה מידה t של B ביחס ל-A (טווח r בפיקסלים בגודל המלא). גס (רבע, לכל קנה מידה) ← בינוני (עם הערכת קנה מידה עדינה) ← עדין */
function findShift(A,B,r,scales,D,stp){
 scales=scales&&scales.length?scales:[1];D=D||.02;const a2=lv(A,2),st=stp||(a2.w>400?2:1);let top=null;
 for(const t of scales){const Bt=resample(B,t),c=coarse(a2,lv(Bt,2),r,st);if(!top||c.best>top.c.best)top={t,Bt,c}}
 const c=top.c;if(c.best<=-2)return{dx:Math.round((r.x0+r.x1)/2),dy:Math.round((r.y0+r.y1)/2),t:1,score:0,ok:false};
 const a1=lv(A,1);let t=top.t,cx=c.bx*2,cy=c.by*2,s1;
 if(scales.length>1){const Ts=[t-D,t,t+D].map(v=>cl(v,.86,1.14)),R=Ts.map((v,i)=>{const Bt=i===1?top.Bt:resample(B,v);return around(a1,lv(Bt,1),cx,cy,3,1,300)});
  s1=R[1];cx=R[1].x;cy=R[1].y;
  const m=R[0].s,z=R[1].s,p=R[2].s,den=m-2*z+p;if(z>=m&&z>=p&&den<-1e-9)t=cl(t+D*.5*(m-p)/den,.86,1.14);else if(m>z&&m>=p)t=Ts[0];else if(p>z)t=Ts[2]}
 else s1=around(a1,lv(top.Bt,1),cx,cy,3,1,300);
 const A0=lv(A,0);let f=around(A0,lv(resample(B,t),0),cx*2,cy*2,3,2,600);
 if(scales.length>1){/* שיפור עדין של קנה המידה (פרבולה על שלוש נקודות, פעמיים) – שגיאה קטנה בקנה מידה מצטברת לאורך שורה ארוכה */
  for(const d of [.008,.003]){const Ts=[t-d,t,t+d],Rr=Ts.map((v,i)=>i===1?f:around(A0,lv(resample(B,v),0),f.x,f.y,2,1,600));
   const m=Rr[0].s,z=Rr[1].s,p=Rr[2].s,den=m-2*z+p;let nt=t;if(z>=m&&z>=p&&den<-1e-9)nt=t+d*.5*(m-p)/den;else if(m>z&&m>=p)nt=Ts[0];else if(p>z)nt=Ts[2];
   t=cl(nt,.86,1.14);f=Rr.reduce((a,b)=>b.s>a.s?b:a)}
  f=around(A0,lv(resample(B,t),0),f.x,f.y,1,1,600)}
 /* ההתאמה הגסה (רבע גודל) עמידה לסיבוב קל ופרספקטיבה: התאמה גסה חזקה ובולטת מול כל שאר ההזזות נחשבת ביטחון גם כשההתאמה העדינה נמוכה */
 let conf=Math.max(0,f.s,c.best-c.second>=.2&&c.best>=.5?.8*c.best:0);if(c.best-c.second<.04&&c.best<.85)conf*=.75;/* שתי התאמות כמעט שוות (מוצרים חוזרים) = פחות בטוח */
 return{dx:f.x,dy:f.y,t:+t.toFixed(4),score:+conf.toFixed(3),ok:conf>=OKT,cb:+c.best.toFixed(3),c2:+c.second.toFixed(3)}}
const shiftOf=(p,fb,adj)=>{const a=adj&&adj[p.key];return a?{dx:a.dx,dy:a.dy,t:p.ok?p.t:1,ok:true,manual:true}:p.ok?{dx:p.dx,dy:p.dy,t:p.t||1,ok:true}:{dx:fb.dx,dy:fb.dy,t:1,ok:false}};
/* מיקום תמונות שורה (יחסית לפינת הרצועה). c = קנה מידה מצטבר של כל תמונה */
function place(row,G,hs,ov,adj){
 let x=0,y=0,c=1;const P=[],S=[];
 row.forEach((id,j)=>{const g=G.get(id);if(j>0){const a=G.get(row[j-1]),s=shiftOf(hs[j-1],{dx:Math.round(a.w*(1-ov)),dy:0},adj);x+=s.dx*c;y+=s.dy*c;c*=s.t;S.push(s)}P.push({id,x,y,c,w:g.w*c,h:g.h*c})});
 let mx=1e9,my=1e9,W=0,H=0;for(const p of P){mx=Math.min(mx,p.x);my=Math.min(my,p.y)}
 for(const p of P){p.x-=mx;p.y-=my;W=Math.max(W,p.x+p.w);H=Math.max(H,p.y+p.h)}
 return{P,S,W:Math.ceil(W),H:Math.ceil(H)}}
function strip(pl,G){const d=new Uint8Array(pl.W*pl.H).fill(128);
 for(const p of pl.P){const g=resample(G.get(p.id),p.c),x0=Math.round(p.x),y0=Math.round(p.y),sx=Math.max(0,-x0),dx=Math.max(0,x0),w=Math.min(g.w-sx,pl.W-dx);
  if(w<=0)continue;for(let y=0;y<g.h;y++){const yy=y0+y;if(yy<0||yy>=pl.H)continue;d.set(g.g.subarray(y*g.w+sx,y*g.w+sx+w),yy*pl.W+dx)}}
 return{w:pl.W,h:pl.H,g:d}}
/* תיקון מקומי של שורה לפי מה שנמדד בחלונות מול השורה שמעליה (סטייה מהמודל הגלובלי), בהשלמה ליניארית בין חלונות */
function applyRes(pl,v){
 if(!v||!v.res||!v.res.length)return;const R=v.res,s=v.s||1;
 for(const p of pl.P){const cx=p.x+p.w/2;let a=R[0],b=R[R.length-1],k=0;
  if(cx<=R[0].x){k=0;b=a}else if(cx>=R[R.length-1].x){a=b}else{let i=0;while(i<R.length-2&&R[i+1].x<cx)i++;a=R[i];b=R[i+1];k=(cx-a.x)/Math.max(1e-6,b.x-a.x)}
  p.x+=(a.rx+(b.rx-a.rx)*k)/s;p.y+=(a.ry+(b.ry-a.ry)*k)/s}}
const cropS=(S,w,x0)=>{x0=x0||0;const d=new Uint8Array(w*S.h);for(let y=0;y<S.h;y++)d.set(S.g.subarray(y*S.w+x0,y*S.w+x0+w),y*w);return{w,h:S.h,g:d}};
function fitAff(P){const n=P.length;let mbx=0,mby=0,max=0,may=0;for(const p of P){mbx+=p.bx;mby+=p.by;max+=p.ax;may+=p.ay}mbx/=n;mby/=n;max/=n;may/=n;
 let num=0,den=0;for(const p of P){const u=p.bx-mbx,v=p.by-mby;num+=u*(p.ax-max)+v*(p.ay-may);den+=u*u+v*v}
 const s=den>1e-6?cl(num/den,.88,1.12):1;return{s,tx:max-s*mbx,ty:may-s*mby}}
/* שורה מול השורה שמעליה: B (תחתונה) → A (עליונה): p_A = s*p_B + (dx,dy). התחלה מהקצה השמאלי, ואז חלונות לאורך הרצועה (חיזוי ממודל מתעדכן) */
function matchRows(A,B,aw){
 const mw=Math.min(A.w,B.w),W0=Math.min(mw,Math.round(2.4*aw)),cuts=[...new Set([0,Math.floor((mw-W0)/2),mw-W0])].filter(c=>c>=0);let init=null;
 /* חיפוש ראשוני בכמה קטעים לאורך הרצועה (תחילה, אמצע, סוף) ובחירת הטוב – קטע אחד יכול ליפול על אזור בלי מרקם או עם סיבוב/פרספקטיבה */
 for(const cx of cuts){const q=findShift(cropS(A,W0,cx),cropS(B,W0,cx),{x0:-Math.round(.9*aw),x1:Math.round(.9*aw),y0:Math.round(.3*A.h),y1:Math.round(.95*A.h)},[.9,.95,1,1.05,1.1],.03,2);
  q.dx=+(q.dx+cx*(1-q.t)).toFixed(2);if(!init||q.score>init.score)init=q;if(q.ok)break}
 if(!init.ok)return{dx:init.dx,dy:init.dy,s:1,score:init.score,ok:false,n:0,nw:0};
 const t0=init.t,Bs=resample(B,t0),A1=lv(A,1),B1=lv(Bs,1),A0=lv(A,0),B0=lv(Bs,0),pw=Math.round(aw*.45)&~1,ph=Math.max(24,Math.round(.15*Bs.h))&~1,step=Math.max(Math.round(aw*.7),Math.ceil(Bs.w/30)),by0=4,pts=[];let nw=0,mdl={s:1,tx:init.dx,ty:init.dy};
 for(let bx=8;bx+pw<=Bs.w-8;bx+=step){nw++;
  const ax=mdl.s*bx+mdl.tx,ay=mdl.s*by0+mdl.ty,R=8+(pts.length<2?4:0);let best=-3,qx=0,qy=0;
  for(let dy=-R;dy<=R;dy++)for(let dx=-R;dx<=R;dx++){const v=nccP(A1,B1,Math.round(ax/2)+dx,Math.round(ay/2)+dy,bx>>1,by0>>1,pw>>1,ph>>1,1);if(v>best){best=v;qx=Math.round(ax/2)+dx;qy=Math.round(ay/2)+dy}}
  if(best<.3)continue;
  let b2=-3,rx=qx*2,ry=qy*2;for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const v=nccP(A0,B0,qx*2+dx,qy*2+dy,bx,by0,pw,ph,1);if(v>b2){b2=v;rx=qx*2+dx;ry=qy*2+dy}}
  if(b2<.3)continue;
  pts.push({bx:bx+pw/2,by:by0+ph/2,ax:rx+pw/2,ay:ry+ph/2,sc:b2});
  if(pts.length>=2)mdl=fitAff(pts)}
 if(pts.length>=3){for(let it=0;it<2;it++){const f=fitAff(pts),keep=pts.filter(p=>Math.hypot(p.ax-(f.s*p.bx+f.tx),p.ay-(f.s*p.by+f.ty))<=6);if(keep.length<3||keep.length===pts.length){break}pts.length=0;pts.push(...keep)}}
 let f=mdl;if(pts.length>=2)f=fitAff(pts);else if(pts.length<1)f={s:1,tx:init.dx,ty:init.dy};
 else f={s:1,tx:pts[0].ax-pts[0].bx,ty:pts[0].ay-pts[0].by};
 const res=pts.map(p=>({x:p.bx/t0,rx:+(p.ax-(f.s*p.bx+f.tx)).toFixed(2),ry:+(p.ay-(f.s*p.by+f.ty)).toFixed(2)}));
 f={s:f.s*t0,tx:f.tx,ty:f.ty};/* p_A = sr*p_Bs+t, p_Bs = t0*p_B */
 const mean=pts.length?pts.reduce((a,p)=>a+p.sc,0)/pts.length:init.score,ok=pts.length>=Math.max(1,Math.ceil(.25*nw))&&mean>=OKT;
 return{dx:+f.tx.toFixed(2),dy:+f.ty.toFixed(2),s:+f.s.toFixed(5),score:+mean.toFixed(3),ok,n:pts.length,nw,res}}
/* ---------- הצעת סדר: לכל זוג (א משמאל ל-ב) ציון התאמה גס (שמינית גודל), ואז שרשרת בעלת סכום ציונים גבוה (חמדני, בלי מעגלים) ---------- */
function pairScore(A,B){
 const a=lv(A,3),b=lv(B,3);let best=0,second=0;const G=[];
 const x0=Math.round(.3*a.w),x1=Math.round(.95*a.w),y0=-Math.max(1,Math.round(.1*a.h)),y1=-y0;
 for(let dy=y0;dy<=y1;dy++)for(let dx=x0;dx<=x1;dx++){const v=ncc(a,b,dx,dy,1,30);if(v>best)best=v}
 return Math.max(0,best)}
async function suggestOrder(ids,G,onP){
 const n=ids.length;if(n<3)return{order:ids.slice(),score:0,cur:0,changed:false};
 const S=Array.from({length:n},()=>new Float32Array(n));let d=0;
 for(let i=0;i<n;i++){for(let j=0;j<n;j++){if(i!==j)S[i][j]=pairScore(G.get(ids[i]),G.get(ids[j]))}d++;if(onP)onP(d,n);await tick()}
 for(const id of ids)free(G.get(id));
 const E=[];for(let i=0;i<n;i++)for(let j=0;j<n;j++)if(i!==j&&S[i][j]>=.3)E.push([S[i][j],i,j]);E.sort((a,b)=>b[0]-a[0]);
 const nxt=new Array(n).fill(-1),prv=new Array(n).fill(-1),root=Array.from({length:n},(_,i)=>i),find=x=>root[x]===x?x:(root[x]=find(root[x]));
 for(const[,i,j]of E){if(nxt[i]>=0||prv[j]>=0||find(i)===find(j))continue;nxt[i]=j;prv[j]=i;root[find(i)]=find(j)}
 const seen=new Set(),order=[];
 for(let i=0;i<n;i++){if(prv[i]>=0||seen.has(i))continue;for(let k=i;k>=0&&!seen.has(k);k=nxt[k]){seen.add(k);order.push(ids[k])}}
 for(let i=0;i<n;i++)if(!seen.has(i))order.push(ids[i]);
 const ix=new Map(ids.map((id,i)=>[id,i])),sum=o=>{let t=0;for(let k=0;k+1<o.length;k++)t+=S[ix.get(o[k])][ix.get(o[k+1])];return t},sc=sum(order),cur=sum(ids);
 return{order,score:+sc.toFixed(2),cur:+cur.toFixed(2),changed:sc>cur*1.15+.2&&order.some((id,i)=>id!==ids[i])}}
/* rows: [[id,...]] (עליונה ראשונה, כל שורה משמאל לימין); load(id) → {w,h,g} אפור בגובה HE.
   o: {ov (0–.4, לחיבור לא בטוח), adj:{key:{dx,dy}}, grays:Map, cache:{}, onP(done,total)}. מחזיר {h:[[pair]],v:[pair],grays} */
async function estimate(rows,load,o){
 o=o||{};const G=o.grays||new Map(),adj=o.adj||{},ov=o.ov==null?.2:o.ov,cache=o.cache||{};rows=rows.filter(r=>r.length);
 const ids=[].concat(...rows).filter(id=>!G.has(id)),total=ids.length+rows.reduce((s,r)=>s+r.length-1,0)+Math.max(0,rows.length-1);let done=0;const prog=()=>o.onP&&o.onP(done,total);
 prog();for(const id of ids){G.set(id,norm(await load(id)));done++;prog();await tick()}
 const hs=[],SC=[.9,.933,.967,1,1.033,1.067,1.1];
 for(const row of rows){const arr=[];
  for(let j=1;j<row.length;j++){const a=G.get(row[j-1]),b=G.get(row[j]),key='h:'+row[j-1]+':'+row[j];let p=cache['H'+key];
   if(!p){p=Object.assign(findShift(a,b,{x0:Math.round(.3*a.w),x1:Math.round(.95*a.w),y0:-Math.round(.1*a.h),y1:Math.round(.1*a.h)},SC),{key});cache['H'+key]=p;free(a);await tick()}
   done++;prog();arr.push(p)}
  free(G.get(row[row.length-1]));hs.push(arr)}
 const pls=rows.map((row,r)=>place(row,G,hs[r],ov,adj)),v=[];
 for(let r=0;r<rows.length-1;r++){
  const key='v:'+rows[r][0]+':'+rows[r+1][0],ck='V'+rows[r].join(',')+'/'+rows[r+1].join(',')+'|'+ov+'|'+pls[r].S.concat(pls[r+1].S).map(s=>s.dx+','+s.dy+','+s.t).join(';');let p=cache[ck];
  if(!p){const A=strip(pls[r],G),B=strip(pls[r+1],G),aw=pls[r].P.concat(pls[r+1].P).reduce((s,q)=>s+q.w,0)/(pls[r].P.length+pls[r+1].P.length);
   p=matchRows(A,B,aw);cache[ck]=p;await tick()}
  done++;prog();const vp=Object.assign({},p,{key});v.push(vp);if(vp.ok&&!adj[key])applyRes(pls[r+1],vp)}
 return{h:hs,v,grays:G}}
/* פריסה סופית: מיקום כל תמונה (יחידות HE), תפרים, מעברים רכים, שוליים לחיתוך ואזורים שלא צולמו */
function layout(rows,G,est,o){
 o=o||{};rows=rows.filter(r=>r.length);const adj=o.adj||{},ov=o.ov==null?.2:o.ov;
 const pls=rows.map((row,r)=>place(row,G,est.h[r],ov,adj)),seams=[],S=[1],T=[{x:0,y:0}];
 pls.forEach((pl,r)=>{const e=r?est.v[r-1]:null;if(e&&e.ok&&!adj[e.key])applyRes(pl,e)});
 pls.forEach((pl,r)=>pl.S.forEach((s,j)=>seams.push({key:est.h[r][j].key,t:'h',r,j,dx:s.dx,dy:s.dy,sc:s.t,ok:s.ok,manual:!!s.manual,score:est.h[r][j].score,a:rows[r][j],b:rows[r][j+1]})));
 for(let r=1;r<rows.length;r++){const e=est.v[r-1],s=shiftOf(e,{dx:0,dy:Math.round(pls[r-1].H*(1-ov))},adj),sc=s.ok&&e.s?e.s:1;
  S[r]=S[r-1]*sc;T[r]={x:T[r-1].x+S[r-1]*s.dx,y:T[r-1].y+S[r-1]*s.dy};
  seams.push({key:e.key,t:'v',r:r-1,dx:s.dx,dy:s.dy,sc,ok:s.ok,manual:!!s.manual,score:e.score,a:rows[r-1][0],b:rows[r][0]})}
 let mx=1e9,my=1e9,W=0,H=0;const R=pls.map((pl,r)=>pl.P.map(p=>({id:p.id,x:S[r]*p.x+T[r].x,y:S[r]*p.y+T[r].y,w:S[r]*p.w,h:S[r]*p.h,c:S[r]*p.c})));
 for(const row of R)for(const p of row){mx=Math.min(mx,p.x);my=Math.min(my,p.y)}
 for(const row of R)for(const p of row){p.x-=mx;p.y-=my;W=Math.max(W,p.x+p.w);H=Math.max(H,p.y+p.h)}
 W=Math.ceil(W);H=Math.ceil(H);
 /* מעבר רך: כל תמונה מצוירת מעל הקודמת (משמאל לימין, משורה עליונה לתחתונה) ונחשפת בהדרגה בקצה השמאלי והעליון שלה, באמצע אזור החפיפה, ברוחב עד 15% */
 R.forEach((row,r)=>row.forEach((p,j)=>{p.l=p.t=null;
  if(j>0){const q=row[j-1],ovl=q.x+q.w-p.x;if(ovl>0){const rw=Math.min(ovl,.15*p.w);p.l=[(ovl-rw)/2,(ovl+rw)/2]}}
  if(r>0){let pb=Infinity;for(const q of R[r-1])if(q.x<p.x+p.w&&q.x+q.w>p.x)pb=Math.min(pb,q.y+q.h);const ovt=pb-p.y;if(isFinite(pb)&&ovt>0){const rh=Math.min(ovt,.15*p.h);p.t=[(ovt-rh)/2,(ovt+rh)/2]}}}));
 const rowExt=R.map(row=>({x0:Math.min(...row.map(p=>p.x)),x1:Math.max(...row.map(p=>p.x+p.w)),y0:Math.min(...row.map(p=>p.y)),y1:Math.max(...row.map(p=>p.y+p.h))}));
 const gaps=[];rowExt.forEach(e=>{if(e.x0>Math.max(100,.02*W))gaps.push({x:0,y:e.y0,w:e.x0,h:e.y1-e.y0});if(W-e.x1>Math.max(100,.02*W))gaps.push({x:e.x1,y:e.y0,w:W-e.x1,h:e.y1-e.y0})});
 const cx0=Math.max(...rowExt.map(e=>e.x0)),cx1=Math.min(...rowExt.map(e=>e.x1)),crop=cx1-cx0>.3*W?{x0:cx0,y0:0,x1:cx1,y1:H}:null;
 return{rows:R,pls,seams,W,H,S,T,rowExt,gaps,crop}}
const API={wallsOf,suggestOrder,estimate,layout,findShift,matchRows,place,strip,resample,MAXPH,HE,DEFH,OKT,ROWH,TILE,MAXA};
if(typeof module!=='undefined'&&module.exports)module.exports=API;else root.S3FreeWall=API;
if(typeof window==='undefined'||!window.S3UI||typeof ACT==='undefined'||!window.S3UI.K3)return;

/* ---------- המסך ---------- */
const U=window.S3UI,esc=U.esc2,K=U.K3,GOLD='#d4a017',CYAN='#4cc9f0';
const F={photos:[],seq:0,wall:'',rows:2,cur:0,ov:20,assign:[],view:'edit',res:null,busy:'',prog:null,msg:'',zoom:1,gray:new Map(),cache:{},adj:{},est:null,lay:null,as:null,crop:false,all:false,sugg:null};
let host=null;
const fmt=cm=>(cm/100).toFixed(2).replace(/\.00$/,'');
const walls=()=>wallsOf(K.plan,K.map);
const wallNow=()=>walls().find(w=>w.key===F.wall)||null;
const wallH=w=>w&&w.h?w.h:DEFH;
/* שורות לפי המשתמש: assign[0] = שורה 1 = התחתונה. rowsOf מחזיר לפי סדר המשתמש */
const rowsOf=()=>{const R=[];for(let i=0;i<F.rows;i++)R.push((F.assign[i]||[]).filter(id=>F.photos.some(p=>p.id===id)));return R};
const topFirst=()=>rowsOf().map((r,i)=>({r,i})).filter(x=>x.r.length).reverse();/* עליונה ראשונה; i = מספר שורה אצל המשתמש */
/* ---- אחסון התמונות המוקטנות (צלע ארוכה ~1600) ב-IndexedDB, כ-Blob; בלי IndexedDB – בזיכרון ---- */
let dbp=null;const mem=new Map();
const idb=()=>dbp||(dbp=new Promise((res,rej)=>{try{const q=indexedDB.open('s3fw',1);q.onupgradeneeded=()=>q.result.createObjectStore('p');q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)}catch(e){rej(e)}}));
async function bPut(id,b){try{const d=await idb();await new Promise((res,rej)=>{const t=d.transaction('p','readwrite');t.objectStore('p').put(b,id);t.oncomplete=()=>res();t.onerror=t.onabort=()=>rej(t.error)})}catch(e){mem.set(id,b)}}
async function bGet(id){if(mem.has(id))return mem.get(id);const d=await idb();return new Promise((res,rej)=>{const r=d.transaction('p').objectStore('p').get(id);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function bDel(id){mem.delete(id);try{const d=await idb();d.transaction('p','readwrite').objectStore('p').delete(id)}catch(e){}}
async function bClear(){mem.clear();try{const d=await idb();await new Promise(res=>{const t=d.transaction('p','readwrite');t.objectStore('p').clear();t.oncomplete=t.onerror=t.onabort=()=>res()})}catch(e){}}
function relRes(){if(F.res){for(const t of F.res.tiles){try{URL.revokeObjectURL(t.url)}catch(e){}}}F.res=null}
function closeAll(){relRes();for(const p of F.photos){try{URL.revokeObjectURL(p.url)}catch(e){}}F.photos=[];F.assign=[];F.gray=new Map();F.cache={};F.adj={};F.est=F.lay=F.as=null;F.view='edit';F.busy='';F.msg='';bClear();if(host){host.remove();host=null}document.body.style.overflow=''}
const tag=id=>{for(let i=0;i<F.rows;i++){const k=(F.assign[i]||[]).indexOf(id);if(k>=0)return`ש${i+1}·${k+1}`}return''};
const numOf=id=>F.photos.findIndex(p=>p.id===id)+1;

/* זמן הצילום: EXIF DateTimeOriginal (קורא ידני של כותרת ה-JPEG); אחרת תאריך שינוי הקובץ */
async function shotTime(f){
 try{const u=new Uint8Array(await f.slice(0,131072).arrayBuffer());if(u[0]!==0xFF||u[1]!==0xD8)throw 0;
  let i=2;while(i+4<u.length&&u[i]===0xFF){const m=u[i+1],L=(u[i+2]<<8)|u[i+3];
   if(m===0xE1&&u[i+4]===0x45&&u[i+5]===0x78){const b=i+10,le=u[b]===0x49,r16=o=>le?u[b+o]|(u[b+o+1]<<8):(u[b+o]<<8)|u[b+o+1],r32=o=>le?(u[b+o]|(u[b+o+1]<<8)|(u[b+o+2]<<16)|(u[b+o+3]<<24))>>>0:((u[b+o]<<24)|(u[b+o+1]<<16)|(u[b+o+2]<<8)|u[b+o+3])>>>0;
    const str=(o,n)=>{let t='';for(let k=0;k<n;k++){const c=u[b+o+k];if(!c)break;t+=String.fromCharCode(c)}return t};
    const ifd=(o,tags)=>{const n=r16(o),out={};for(let k=0;k<n;k++){const e=o+2+k*12,tg=r16(e);if(tags.includes(tg))out[tg]=r32(e+8)}return out};
    const i0=ifd(r32(4),[0x8769,0x0132]);let d='';if(i0[0x8769]){const x=ifd(i0[0x8769],[0x9003,0x9004]);if(x[0x9003])d=str(x[0x9003],19);else if(x[0x9004])d=str(x[0x9004],19)}if(!d&&i0[0x0132])d=str(i0[0x0132],19);
    const m2=/^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/.exec(d);if(m2)return new Date(+m2[1],+m2[2]-1,+m2[3],+m2[4],+m2[5],+m2[6]).getTime();break}
   if(m===0xDA)break;i+=2+L}}catch(e){}
 return f.lastModified||0}
const byTime=(a,b)=>(a.t||0)-(b.t||0)||a.id-b.id;
function sortByTime(){if(F.photos.every(p=>!p.t))return false;F.photos.sort(byTime);return true}
async function addFiles(files){
 let L=[...files].filter(f=>f&&/^image\//.test(f.type||'image/'));if(!L.length)return;
 F.msg='';let skipped=0;
 F.busy='קורא את זמני הצילום…';draw();
 for(const f of L)f._t=await shotTime(f);
 if(L.length>1&&L.every(f=>f._t))L=L.map((f,i)=>({f,i})).sort((a,b)=>a.f._t-b.f._t||a.i-b.i).map(o=>o.f);/* מיון אוטומטי לפי זמן הצילום */
 for(const f of L){
  if(F.photos.length>=MAXPH){F.msg='אפשר עד '+MAXPH+' תמונות לקיר. התמונות הנוספות לא נוספו.';break}
  F.busy='מכין תמונה '+(F.photos.length+1)+'…';draw();await tick();
  let d=null;
  try{d=await U.decode(f);/* U.decode מכבד כיוון EXIF (תמונה לאורך/לרוחב) */
   const k=Math.min(1,1600/Math.max(d.w,d.h)),c=document.createElement('canvas');c.width=Math.max(1,Math.round(d.w*k));c.height=Math.max(1,Math.round(d.h*k));const g=c.getContext('2d');g.imageSmoothingQuality='high';g.drawImage(d.src,0,0,c.width,c.height);
   const big=await U.blobOf(c,.88),k2=Math.min(1,200/Math.max(c.width,c.height)),t=document.createElement('canvas');t.width=Math.max(1,Math.round(c.width*k2));t.height=Math.max(1,Math.round(c.height*k2));t.getContext('2d').drawImage(c,0,0,t.width,t.height);
   const th=await U.blobOf(t,.7),w=c.width,h=c.height;c.width=c.height=t.width=t.height=1;if(!big||!th)throw new Error('x');
   const id=++F.seq;await bPut(id,big);F.photos.push({id,w,h,t:f._t||0,url:URL.createObjectURL(th)})}
  catch(e){skipped++}
  finally{if(d)d.close()}}
 if(skipped)F.msg=(F.msg?F.msg+' ':'')+(skipped===1?'תמונה אחת לא נפתחה ודולגה.':skipped+' תמונות לא נפתחו ודולגו.');
 F.busy='';draw()}
/* תמונה אפורה בגובה HE (כל התמונות מנורמלות לאותו גובה); מפוענחת אחת בכל פעם */
async function loadGray(id){
 const d=await U.decode(await bGet(id));
 try{const h=HE,w=cl(Math.round(d.w*HE/d.h),64,1100),c=document.createElement('canvas');c.width=w;c.height=h;
  const g=c.getContext('2d',{willReadFrequently:true});g.imageSmoothingQuality='high';g.drawImage(d.src,0,0,w,h);const px=g.getImageData(0,0,w,h).data,o=new Uint8Array(w*h);
  for(let i=0;i<o.length;i++)o[i]=(px[4*i]*77+px[4*i+1]*150+px[4*i+2]*29)>>8;c.width=c.height=1;return{w,h,g:o}}
 finally{d.close()}}
const lru=[];
async function loadColor(id){
 const i=lru.findIndex(x=>x.id===id);if(i>=0){const x=lru.splice(i,1)[0];lru.push(x);return x.c}
 const d=await U.decode(await bGet(id));
 try{const c=document.createElement('canvas');c.width=d.w;c.height=d.h;c.getContext('2d').drawImage(d.src,0,0);lru.push({id,c});while(lru.length>3){const o=lru.shift();o.c.width=o.c.height=1}return c}
 finally{d.close()}}
const optOf=()=>({ov:F.ov/100,adj:F.adj,grays:F.gray,cache:F.cache});
const patt=()=>{const c=document.createElement('canvas');c.width=c.height=24;const g=c.getContext('2d');g.fillStyle='#2a2a30';g.fillRect(0,0,24,24);g.strokeStyle='#3b3b44';g.lineWidth=2;g.beginPath();g.moveTo(0,24);g.lineTo(24,0);g.stroke();return c};
/* בנייה באריחים (כל אריח canvas נפרד ≤ TILE×TILE), תמונה מפוענחת אחת בכל פעם; כל אריח הופך מיד ל-JPEG ומשוחרר */
async function render(){
 const L=F.lay,V=F.crop&&L.crop?L.crop:{x0:0,y0:0,x1:L.W,y1:L.H},vw=V.x1-V.x0,vh=V.y1-V.y0,nr=L.rows.length;
 let k=ROWH/HE;if(vw*vh*k*k>MAXA)k=Math.sqrt(MAXA/(vw*vh));
 const OW=Math.max(8,Math.round(vw*k)),OH=Math.max(8,Math.round(vh*k)),nx=Math.ceil(OW/TILE),ny=Math.ceil(OH/TILE),tiles=[],pat=patt(),photos=[].concat(...L.rows);let n=0;
 for(let ty=0;ty<ny;ty++)for(let tx=0;tx<nx;tx++){
  const X=tx*TILE,Y=ty*TILE,tw=Math.min(TILE,OW-X),th=Math.min(TILE,OH-Y);
  F.busy='בונה את הקיר – אריח '+(++n)+' מתוך '+nx*ny+'…';F.prog=[n-1,nx*ny];draw();await tick();
  const cv=document.createElement('canvas');cv.width=tw;cv.height=th;const g=cv.getContext('2d');
  g.fillStyle=g.createPattern(pat,'repeat');g.fillRect(0,0,tw,th);
  g.fillStyle='#8a8a95';g.font='bold 28px sans-serif';g.textAlign='center';g.textBaseline='middle';g.direction='rtl';
  for(const q of L.gaps){const cx=((q.x+q.w/2)-V.x0)*k-X,cy=((q.y+q.h/2)-V.y0)*k-Y;if(cx>-100&&cx<tw+100&&cy>-20&&cy<th+20)g.fillText('לא צולם',cx,cy)}
  for(const p of photos){
   const px=(p.x-V.x0)*k,py=(p.y-V.y0)*k,pw=p.w*k,ph=p.h*k,ix0=Math.max(px,X),iy0=Math.max(py,Y),ix1=Math.min(px+pw,X+tw),iy1=Math.min(py+ph,Y+th);
   if(ix1-ix0<1||iy1-iy0<1)continue;
   const a0=Math.floor(ix0),b0=Math.floor(iy0),w2=Math.max(1,Math.ceil(ix1)-a0),h2=Math.max(1,Math.ceil(iy1)-b0),src=await loadColor(p.id);
   const t=document.createElement('canvas');t.width=w2;t.height=h2;const tg=t.getContext('2d');tg.imageSmoothingQuality='high';
   tg.drawImage(src,(a0-px)/pw*src.width,(b0-py)/ph*src.height,w2/pw*src.width,h2/ph*src.height,0,0,w2,h2);
   const ramp=(r,horiz)=>{if(!r)return;const o=horiz?px-a0:py-b0,s=o+r[0]*k,e=Math.max(s+1,o+r[1]*k),gr=horiz?tg.createLinearGradient(s,0,e,0):tg.createLinearGradient(0,s,0,e);
    gr.addColorStop(0,'rgba(0,0,0,0)');gr.addColorStop(1,'#000');tg.globalCompositeOperation='destination-in';tg.fillStyle=gr;tg.fillRect(0,0,w2,h2);tg.globalCompositeOperation='source-over'};
   ramp(p.l,true);ramp(p.t,false);g.drawImage(t,a0-X,b0-Y);t.width=t.height=1}
  const blob=await U.blobOf(cv,.9);cv.width=cv.height=1;if(!blob||!blob.size)throw new Error('empty');
  tiles.push({blob,url:URL.createObjectURL(blob),x:X,y:Y,w:tw,h:th})}
 return{tiles,w:OW,h:OH,k}}
async function doBuild(){
 const w=wallNow(),R=topFirst();if(!w||!R.length||F.busy)return;
 relRes();F.view='edit';F.msg='';F.sugg=null;F.busy='מחפש חפיפה בין התמונות…';F.prog=[0,1];draw();
 try{
  await tick();
  const rows=R.map(x=>x.r),o=optOf();o.onP=(d,n)=>{F.prog=[d,n];F.busy='מחפש חפיפה… '+d+' מתוך '+n;draw()};
  F.est=await estimate(rows,loadGray,o);
  F.lay=layout(rows,F.gray,F.est,o);F.lay.map=R.map(x=>x.i);
  await makeSugg(R);
  F.res=Object.assign(await render(),{wall:w});F.view='res';F.zoom=1;F.busy='';F.prog=null;draw()}
 catch(e){F.busy='';F.prog=null;F.msg='החיבור נכשל (ייתכן שהזיכרון בטלפון אזל). נסו פחות תמונות או סגרו אפליקציות אחרות.';draw()}}
/* שורות שבהן יש חיבור לא בטוח: בדיקה אם יש סדר אחר של אותן תמונות עם ציוני חיבור גבוהים יותר (הצעה בלבד – החלה בלחיצה) */
async function makeSugg(R){
 F.sugg=[];
 for(let r=0;r<R.length;r++){if(!F.lay.seams.some(s=>s.t==='h'&&s.r===r&&!s.ok))continue;
  F.busy='בודק אם יש סדר מתאים יותר בשורה '+(R[r].i+1)+'…';F.prog=[0,1];draw();
  const q=await suggestOrder(R[r].r,F.gray,(d,n)=>{F.prog=[d,n];draw()});if(q.changed)F.sugg.push({ui:R[r].i,order:q.order,score:q.score,cur:q.cur})}}
/* בנייה מחדש אחרי תיקון ידני / שינוי חיתוך – הזוגות שכבר חושבו נשמרים */
async function rebuild(){
 if(F.busy)return;relRes();F.view='edit';F.busy='מרכיב מחדש…';F.prog=[0,1];draw();
 try{const R=topFirst(),rows=R.map(x=>x.r),o=optOf();F.est=await estimate(rows,loadGray,o);F.lay=layout(rows,F.gray,F.est,o);F.lay.map=R.map(x=>x.i);
  F.res=Object.assign(await render(),{wall:wallNow()});F.view='res';F.busy='';F.prog=null;draw()}
 catch(e){F.busy='';F.prog=null;F.msg='הבנייה מחדש נכשלה.';draw()}}
/* ---- שמירה ושיתוף: JPEG תקין (FF D8 FF, גודל > 0, ניתן לפענוח), שם עם .jpg, ≤4096 בצלע ארוכה ו-≤16M פיקסלים ---- */
const isJpeg=u=>u&&u.length>3&&u[0]===0xFF&&u[1]===0xD8&&u[2]===0xFF;
async function bytesOk(blob){if(!blob||!blob.size)return null;const u=new Uint8Array(await blob.arrayBuffer());return isJpeg(u)?u:null}
async function finalBlob(){
 const R=F.res;if(!R)return null;
 const sc=Math.min(1,4096/Math.max(R.w,R.h),Math.sqrt(16e6/(R.w*R.h)));let blob;
 if(sc>=1&&R.tiles.length===1)blob=R.tiles[0].blob;
 else{const w=Math.max(8,Math.round(R.w*sc)),h=Math.max(8,Math.round(R.h*sc)),c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');g.imageSmoothingQuality='high';g.fillStyle='#2a2a30';g.fillRect(0,0,w,h);
  for(const t of R.tiles){const b=await createImageBitmap(t.blob);g.drawImage(b,Math.floor(t.x*sc),Math.floor(t.y*sc),Math.ceil(t.w*sc)+1,Math.ceil(t.h*sc)+1);b.close()}
  blob=await U.blobOf(c,.9);c.width=c.height=1;R.down=[w,h]}
 const u=await bytesOk(blob);if(!u)throw new Error('bad-jpeg');
 try{const b=await createImageBitmap(blob);const ok=b.width>0&&b.height>0;b.close();if(!ok)throw 0}catch(e){throw new Error('bad-jpeg')}
 return{blob,u8:u,w:sc>=1&&R.tiles.length===1?R.w:Math.round(R.w*sc),h:sc>=1&&R.tiles.length===1?R.h:Math.round(R.h*sc)}}
async function outFile(blob,u8,name,mode){
 if(typeof outSave==='function')return outSave({name,data:u8,mime:'image/jpeg'},mode);
 const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.append(a);a.click();setTimeout(()=>{a.remove();URL.revokeObjectURL(a.href)},1500)}
async function save(mode){
 if(!F.res||F.saving)return;F.saving=1;
 try{const f=await finalBlob();F.msg=F.res.down?`התמונה הוקטנה לשמירה ל-${f.w}×${f.h} (מגבלת המכשיר). לשמירה ברזולוציה מלאה: "שמרו את כל האריחים".`:'';
  await outFile(f.blob,f.u8,'LargePami_wall_'+Date.now()+'.jpg',mode)}
 catch(e){F.msg='השמירה נכשלה (הקובץ לא נוצר תקין). נסו "שמרו את כל האריחים".'}
 finally{F.saving=0;draw()}}
async function saveTiles(){
 if(!F.res||F.saving)return;F.saving=1;
 try{const R=F.res,st=Date.now();let i=0;for(const t of R.tiles){const u=await bytesOk(t.blob);if(!u)throw new Error('bad');i++;await outFile(t.blob,u,`LargePami_wall_${st}_${Math.floor(t.y/TILE)+1}-${Math.floor(t.x/TILE)+1}.jpg`,'dl')}}
 catch(e){F.msg='שמירת האריחים נכשלה.'}
 finally{F.saving=0;draw()}}

const CSS=document.createElement('style');
CSS.textContent=`.s3fw{position:fixed;inset:0;z-index:300;background:var(--bg);color:var(--ink);overflow:auto;direction:rtl;padding:12px 12px 40px;-webkit-overflow-scrolling:touch}
.s3fw h2{margin:0 0 6px;font-size:1.15rem}.s3fw h3{margin:14px 0 6px;font-size:1rem;color:${GOLD}}
.s3fw ol{margin:6px 0;padding-inline-start:20px;font-size:.92rem}.s3fw .tips{font-size:.85rem;color:var(--mut)}
.s3fw .exp{border:1px dashed ${GOLD};border-radius:10px;padding:6px 10px;font-size:.88rem;margin:8px 0}
.s3fw .rw{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}.s3fw .rw>*{flex:1;min-width:120px;min-height:44px}
.s3fw .b{display:inline-flex;align-items:center;justify-content:center;min-height:44px;min-width:44px;padding:0 12px;border-radius:10px;border:2px solid var(--line);background:var(--card);color:var(--ink);font:inherit;font-weight:700;cursor:pointer;box-sizing:border-box}
.s3fw .b.g{background:${GOLD};border-color:${GOLD};color:#1b1b1f}.s3fw .b.bad{border-color:#d33;color:#ff8a8a}.s3fw .b[disabled]{opacity:.45}
.s3fw select{min-height:44px;width:100%;font:inherit;background:var(--card);color:var(--ink);border:2px solid var(--line);border-radius:10px;padding:0 8px;box-sizing:border-box}
.s3fw .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px;margin:8px 0}
.s3fw .ph{position:relative;border:2px solid var(--line);border-radius:10px;overflow:hidden;background:var(--card)}.s3fw .ph.on{border-color:${GOLD}}
.s3fw .ph img{display:block;width:100%;height:96px;object-fit:cover}.s3fw .ph .n{position:absolute;top:2px;right:2px;background:#000a;color:#fff;border-radius:8px;padding:0 6px;font-size:.8rem;font-weight:700}
.s3fw .ph .t{position:absolute;bottom:46px;left:2px;background:${GOLD};color:#1b1b1f;border-radius:8px;padding:0 6px;font-size:.8rem;font-weight:700}
.s3fw .ph .ac{display:flex}.s3fw .ph .ac button{flex:1;min-height:44px;border:0;border-top:1px solid var(--line);background:var(--card);color:var(--ink);font:inherit;font-size:1rem;cursor:pointer}
.s3fw .sel{display:block;width:100%;height:96px;border:0;padding:0;background:none;cursor:pointer}
.s3fw .chips{display:flex;flex-wrap:wrap;gap:6px}.s3fw .busy{padding:8px;border-radius:10px;background:var(--card);margin:8px 0}.s3fw progress{width:100%;height:10px}
.s3fw .view{overflow:auto;border:1px solid var(--line);border-radius:10px;margin:8px 0;max-height:70vh;touch-action:pan-x pan-y pinch-zoom}.s3fw .view .cv{position:relative}.s3fw .view img{position:absolute;display:block}
.s3fw svg.wm{display:block;width:100%;height:230px;background:var(--bg);border:1px solid var(--line);border-radius:10px;margin:8px 0}.s3fw svg.wm [data-fw]{cursor:pointer}
.s3fw canvas.adj{display:block;width:100%;background:#111;border-radius:10px;touch-action:none}.s3fw input[type=range]{width:100%;min-height:44px}`;
document.head.appendChild(CSS);

/* מפת הקירות: כל קיר ממוספר (תווית בצבע בולט באמצעו), הנבחר בזהב; עיגול ירוק + "התחלה" = הצד השמאלי כשעומדים מול הקיר */
function wallMap(WL){
 const m=K.map,rooms=((m&&m.rooms)||[]).filter(r=>r&&r.del!==1&&Array.isArray(r.p));
 let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;for(const r of rooms)for(let i=0;i+1<r.p.length;i+=2){x0=Math.min(x0,r.p[i]);x1=Math.max(x1,r.p[i]);y0=Math.min(y0,r.p[i+1]);y1=Math.max(y1,r.p[i+1])}
 if(!(x1>x0)||!WL.length)return '';const pad=60,W=x1-x0+2*pad,H=y1-y0+2*pad,u=Math.max(W,H)/180;
 let h=`<svg class="wm" viewBox="${x0-pad} ${y0-pad} ${W} ${H}" role="group" aria-label="מפת הקירות – לחצו על קיר כדי לבחור" preserveAspectRatio="xMidYMid meet">`;
 for(const r of rooms)h+=`<polygon points="${r.p.join(' ')}" fill="var(--card)" stroke="var(--line)" stroke-width="${u}"/>`;
 const sel=WL.find(w=>w.key===F.wall);
 for(const w of WL){const on=w===sel,col=on?GOLD:CYAN;
  h+=`<g data-fw="wall" data-key="${esc(w.key)}">`+w.segs.map(g=>`<line x1="${g[0]}" y1="${g[1]}" x2="${g[2]}" y2="${g[3]}" stroke="${col}" stroke-width="${u*(on?4.5:2.6)}" stroke-linecap="round"/><line x1="${g[0]}" y1="${g[1]}" x2="${g[2]}" y2="${g[3]}" stroke="transparent" stroke-width="${u*14}"/>`).join('');
  const mx=(w.x1+w.x2)/2,my=(w.y1+w.y2)/2,L=Math.hypot(w.x2-w.x1,w.y2-w.y1)||1,nx=(w.y2-w.y1)/L,ny=-(w.x2-w.x1)/L,rr=u*8;
  /* תווית ליד אמצע הקיר, מוסטת לצד הפנימי של החדר (ימין כשהולכים עם כיוון השעון) */
  const lx=mx-nx*rr*1.1,ly=my-ny*rr*1.1;
  h+=`<circle cx="${lx}" cy="${ly}" r="${rr}" fill="${on?GOLD:CYAN}" stroke="#101014" stroke-width="${u*.8}"/><text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="central" font-size="${rr*1.25}" font-weight="700" fill="#101014">${w.n}</text></g>`}
 if(sel){const L=Math.hypot(sel.x2-sel.x1,sel.y2-sel.y1)||1,ux=(sel.x2-sel.x1)/L,uy=(sel.y2-sel.y1)/L;
  h+=`<circle cx="${sel.x1}" cy="${sel.y1}" r="${u*6}" fill="#3ccf6e" stroke="#101014" stroke-width="${u}"/><text x="${sel.x1-ux*u*10}" y="${sel.y1-uy*u*10}" text-anchor="middle" dominant-baseline="central" font-size="${u*8}" font-weight="700" fill="#3ccf6e">התחלה</text>`}
 return h+'</svg>'}
const wName=w=>`קיר ${w.n}${w.name?' · '+w.name:''}`;
const seamName=s=>s.t==='h'?`שורה ${F.lay.map[s.r]+1}: תמונה ${numOf(s.a)} ו־${numOf(s.b)}`:`בין שורה ${F.lay.map[s.r+1]+1} לשורה ${F.lay.map[s.r]+1}`;
function drawAdj(){
 const cv=host&&host.querySelector('#fwadj');if(!cv||!F.as)return;const a=F.as,A=a.A,B=a.B,bw=B.w*a.sc,bh=B.h*a.sc;
 const x0=Math.min(0,a.dx),y0=Math.min(0,a.dy),x1=Math.max(A.w,a.dx+bw),y1=Math.max(A.h,a.dy+bh),sc=Math.min(1.5,(cv.parentNode.clientWidth||320)/(x1-x0)),W=Math.max(1,Math.round((x1-x0)*sc)),H=Math.max(1,Math.round((y1-y0)*sc));
 cv.width=W;cv.height=H;a.px=sc;const g=cv.getContext('2d');g.fillStyle='#111';g.fillRect(0,0,W,H);
 const put=(im,x,y,al,s)=>{if(!im.cv){const c=document.createElement('canvas');c.width=im.w;c.height=im.h;const t=c.getContext('2d'),d=t.createImageData(im.w,im.h);for(let i=0;i<im.g.length;i++){d.data[4*i]=d.data[4*i+1]=d.data[4*i+2]=im.g[i];d.data[4*i+3]=255}t.putImageData(d,0,0);im.cv=c}
  g.globalAlpha=al;g.drawImage(im.cv,(x-x0)*sc,(y-y0)*sc,im.w*s*sc,im.h*s*sc)};
 put(A,0,0,1,1);put(B,a.dx,a.dy,.5,a.sc);g.globalAlpha=1}
function draw(){
 if(!host)return;const w=wallNow(),WL=walls(),R=rowsOf();
 const bz=F.busy?`<div class="busy" role="status">${esc(F.busy)}${F.prog?`<progress max="${F.prog[1]||1}" value="${F.prog[0]||0}"></progress>`:''}</div>`:'';
 if(F.view==='adj'&&F.as){const a=F.as;
  host.querySelector('#fwd').innerHTML=`<h3>תיקון חיבור ידני</h3><p class="tips">${esc(seamName(a.seam))}. התמונה השנייה שקופה למחצה מעל הראשונה. גררו באצבע (או לחצו על החצים) עד שהחפיפה מתיישרת.</p>
  <div class="rw">${[a.seam.a,a.seam.b].map(id=>{const p=F.photos.find(x=>x.id===id);return p?`<figure style="margin:0;flex:1"><img src="${p.url}" alt="" style="width:100%;border-radius:8px"><figcaption class="tips">תמונה ${numOf(id)}</figcaption></figure>`:''}).join('')}</div><p class="tips">ציון ההתאמה: ${(a.seam.score||0).toFixed(2)}${a.seam.ok?'':' – נמוך. בדקו למעלה אם שתי התמונות באמת שכנות, ואם לא – חזרו לסימון ותקנו את הסדר.'}</p>
  <canvas class="adj" id="fwadj" aria-label="יישור ידני"></canvas>
  <div class="rw"><button class="b" data-fw="ar" data-x="-2" data-y="0" aria-label="שמאלה">◀</button><button class="b" data-fw="ar" data-x="2" data-y="0" aria-label="ימינה">▶</button><button class="b" data-fw="ar" data-x="0" data-y="-2" aria-label="למעלה">▲</button><button class="b" data-fw="ar" data-x="0" data-y="2" aria-label="למטה">▼</button></div>
  <div class="rw"><button class="b g" data-fw="aok">שמרו ובנו מחדש</button><button class="b" data-fw="aauto">חזרה לזיהוי אוטומטי</button><button class="b" data-fw="acx">ביטול</button></div>`;drawAdj();return}
 if(F.view==='res'&&F.res&&F.lay){
  const r=F.res,W=r.wall,Z=Math.round(F.zoom*100),unsure=F.lay.seams.filter(s=>!s.ok),shown=F.all?F.lay.seams:unsure.concat(F.lay.seams.filter(s=>s.manual&&s.ok));
  host.querySelector('#fwd').innerHTML=`<h3>הקיר הבנוי</h3>
  <div class="exp">ניסיון – לא נשמר במערכת. התמונה נשארת רק בטלפון, עד שתשמרו אותה בעצמכם.</div>
  <p class="tips">${esc(wName(W))} · אורך ${fmt(W.len)} מ' · גובה ${fmt(wallH(W))} מ'${W.h?'':' (גובה משוער)'} · תוצאה ${r.w}×${r.h} פיקסלים${r.tiles.length>1?' ב-'+r.tiles.length+' אריחים':''}</p>
  ${bz}${F.msg?`<div class="busy" role="status">${esc(F.msg)}</div>`:''}
  <div class="rw"><button class="b" data-fw="zo" aria-label="הקטנה">−</button><button class="b" data-fw="zi" aria-label="הגדלה">+</button><button class="b" data-fw="z1">התאמה למסך</button></div>
  <div class="view" id="fwv"><div class="cv" style="width:${Z}%;aspect-ratio:${r.w}/${r.h}">${r.tiles.map(t=>`<img src="${t.url}" alt="" style="left:${(100*t.x/r.w).toFixed(4)}%;top:${(100*t.y/r.h).toFixed(4)}%;width:${(100*t.w/r.w).toFixed(4)}%;height:${(100*t.h/r.h).toFixed(4)}%">`).join('')}</div></div>
  <p class="tips">אפשר לגלול, לצבוט להגדלה או ללחוץ + ו־−. אזור מסומן "לא צולם" = לא היו שם תמונות.</p>
  ${(F.sugg||[]).map((q,i)=>`<div class="exp">המערכת מצאה סדר אחר בשורה ${q.ui+1} (ציון חיבורים ${q.score} במקום ${q.cur}). להחיל? <div class="rw"><button class="b g" data-fw="sapp" data-i="${i}">החילו את הסדר החדש</button><button class="b" data-fw="sno" data-i="${i}">התעלמו</button></div></div>`).join('')}
  ${F.lay.crop?`<div class="rw"><button class="b${F.crop?' g':''}" data-fw="crop" aria-pressed="${F.crop}">חתכו שוליים ריקים</button></div>`:''}
  <h3>חיבורים${unsure.length?` – ${unsure.length} לא בטוחים`:''}</h3><p class="tips">לחיצה על חיבור מאפשרת לתקן אותו ידנית. באדום = המערכת לא בטוחה (נעשתה חלוקה לפי מחוון החפיפה).</p>
  <div class="chips">${shown.map(s=>`<button class="b${s.ok?'':' bad'}" data-fw="seam" data-i="${F.lay.seams.indexOf(s)}">${esc(seamName(s))} · ${s.manual?'ידני':(s.ok?'בטוח':'לא בטוח')+' ('+(s.score||0).toFixed(2)+')'}</button>`).join('')||'<span class="tips">כל החיבורים בטוחים.</span>'}</div>
  <div class="rw"><button class="b" data-fw="all">${F.all?'הסתר חיבורים בטוחים':'הצג את כל החיבורים ('+F.lay.seams.length+')'}</button></div>
  <div class="rw"><button class="b g" data-fw="dl">שמרו לגלריה / הורידו</button><button class="b g" data-fw="sh">שתפו (וואטסאפ וכו')</button></div>
  ${r.tiles.length>1?`<div class="rw"><button class="b" data-fw="tiles">שמרו את כל האריחים (ברזולוציה מלאה)</button></div>`:''}
  <div class="rw"><button class="b" data-fw="back">חזרה לסימון</button></div>`;return}
 const nUsed=new Set(R.flat()).size;
 const h=`<h3>1. התמונות</h3>
 <div class="rw"><button class="b g" data-fw="cam" ${F.busy?'disabled':''}>צלמו</button><button class="b" data-fw="gal" ${F.busy?'disabled':''}>בחרו מהגלריה</button></div>
 <p class="tips"><b>${F.photos.length} תמונות</b> · אפשר עד ${MAXPH} תמונות לקיר · אפשר להוסיף שוב ושוב · תמונות שנבחרו יחד ממוינות לפי זמן הצילום</p>
 ${F.photos.length>1?`<div class="rw"><button class="b" data-fw="tsort" ${F.busy?'disabled':''}>סדרו לפי זמן הצילום</button></div>`:''}
 ${bz}${F.msg?`<div class="busy" role="status">${esc(F.msg)}</div>`:''}
 ${F.photos.length?`<div class="grid">${F.photos.map((p,i)=>{const t=tag(p.id);return`<div class="ph${t?' on':''}"><button class="sel" data-fw="pick" data-id="${p.id}" aria-label="תמונה ${i+1}${t?' – '+t:''}"><img src="${p.url}" alt=""></button><span class="n">${i+1}</span>${t?`<span class="t">${t}</span>`:''}<div class="ac"><button data-fw="mv" data-id="${p.id}" data-d="-1" aria-label="הקדמה" ${i?'':'disabled'}>▶</button><button data-fw="del" data-id="${p.id}" aria-label="מחיקה">✕</button><button data-fw="mv" data-id="${p.id}" data-d="1" aria-label="אחרי" ${i<F.photos.length-1?'':'disabled'}>◀</button></div></div>`}).join('')}</div>`:'<p class="tips">עוד אין תמונות.</p>'}
 <h3>2. קיר ומספר שורות</h3>
 ${WL.length?`<p class="tips">לחצו על קיר במפה (או בחרו מהרשימה). העיגול הירוק "התחלה" = הצד השמאלי כשעומדים מול הקיר – משם מתחילים לצלם.</p>${wallMap(WL)}<select id="fwwall" aria-label="בחירת קיר"><option value="">בחרו קיר…</option>${WL.map(x=>`<option value="${esc(x.key)}"${x.key===F.wall?' selected':''}>${esc(wName(x))} (${fmt(x.len)} מ')</option>`).join('')}</select>`:'<p class="tips">אין קירות במפה.</p>'}
 ${w?`<p class="tips">${esc(wName(w))} · אורך ${fmt(w.len)} מ' · גובה ${fmt(wallH(w))} מ'${w.h?'':' (גובה משוער)'}</p>`:''}
 <div class="chips" role="group" aria-label="מספר שורות">${[1,2,3,4,5,6].map(n=>`<button class="b${n===F.rows?' g':''}" data-fw="rows" data-n="${n}" aria-pressed="${n===F.rows}">${n}</button>`).join('')}</div>
 <h3>3. סימון תמונות לכל שורה</h3>
 <p class="tips">שורה 1 = למטה (ליד הרצפה), שורה 2 מעליה וכן הלאה. התמונה הראשונה בשורה = הכי שמאלית. לחצו על שורה, ואז געו בתמונות לפי הסדר משמאל לימין. נגיעה חוזרת מסירה תמונה מהשורה.</p>
 <div class="chips" role="group" aria-label="בחירת שורה">${Array.from({length:F.rows},(_,i)=>`<button class="b${i===F.cur?' g':''}" data-fw="row" data-n="${i}" aria-pressed="${i===F.cur}">שורה ${i+1} (${R[i].length})</button>`).join('')}</div>
 <h3>4. בנייה</h3>
 <p class="tips">המערכת מחפשת את החלק המשותף בין כל שתי תמונות ומחברת שם.</p>
 <label class="tips" for="fwov">חפיפה משוערת (בשימוש רק כשהמערכת לא בטוחה בחיבור): <b id="fwovv">${F.ov}%</b></label>
 <input type="range" id="fwov" min="0" max="40" step="1" value="${F.ov}">
 <div class="rw"><button class="b g" data-fw="build" ${!w||!nUsed||F.busy?'disabled':''}>בנו את הקיר</button></div>
 ${!w?'<p class="tips">בחרו קיר כדי להמשיך.</p>':!nUsed?'<p class="tips">סמנו לפחות תמונה אחת לשורה.</p>':''}`;
 host.querySelector('#fwd').innerHTML=h}

function open(){
 if(host)return;bClear();
 host=document.createElement('div');host.className='s3fw';host.setAttribute('role','dialog');host.setAttribute('aria-label','צילום חופשי של קיר');
 host.innerHTML=`<div class="rw" style="margin-top:0"><button class="b" data-fw="close">חזרה</button></div>
 <h2>צילום חופשי של קיר (ניסיון)</h2>
 <div class="exp">ניסיון – לא נשמר במערכת ולא נשלח לשרת. הכול נשאר בטלפון.</div>
 <ol><li>צלמו או בחרו מהגלריה את תמונות הקיר.</li><li>בחרו קיר (במפה) ומספר שורות.</li><li>לכל שורה סמנו את התמונות משמאל לימין (שורה 1 = למטה).</li><li>לחצו "בנו את הקיר".</li></ol>
 <p class="tips">טיפים: עמדו תמיד באותו מרחק, ישר מול הקיר, ובכל תמונה השאירו חפיפה של כשליש עם התמונה השכנה. תמונות לאורך ולרוחב מתאימות.</p>
 <div id="fwd"></div>
 <input type="file" accept="image/*" capture="environment" id="fwcam" hidden><input type="file" accept="image/*" multiple id="fwgal" hidden>`;
 document.body.append(host);document.body.style.overflow='hidden';
 host.addEventListener('change',e=>{const i=e.target;if(i&&(i.id==='fwcam'||i.id==='fwgal')){const L=[...i.files];i.value='';addFiles(L)}else if(i&&i.id==='fwwall'){F.wall=i.value;F.est=F.lay=null;draw()}});
 host.addEventListener('input',e=>{const i=e.target;if(i&&i.id==='fwov'){F.ov=cl(+i.value|0,0,40);const v=host.querySelector('#fwovv');if(v)v.textContent=F.ov+'%'}});
 let drag=null;
 host.addEventListener('pointerdown',e=>{if(e.target.id==='fwadj'&&F.as){drag={x:e.clientX,y:e.clientY,dx:F.as.dx,dy:F.as.dy};try{e.target.setPointerCapture(e.pointerId)}catch(_){}}});
 host.addEventListener('pointermove',e=>{if(drag&&F.as){F.as.dx=Math.round(drag.dx+(e.clientX-drag.x)/F.as.px);F.as.dy=Math.round(drag.dy+(e.clientY-drag.y)/F.as.px);drawAdj()}});
 host.addEventListener('pointerup',()=>{drag=null});
 host.addEventListener('click',e=>{const b=e.target.closest('[data-fw]');if(!b||b.disabled)return;const a=b.dataset.fw,id=+b.dataset.id;
  if(a==='close')return closeAll();
  if(a==='cam')return host.querySelector('#fwcam').click();
  if(a==='gal')return host.querySelector('#fwgal').click();
  if(a==='wall'){F.wall=b.dataset.key;F.est=F.lay=null}
  else if(a==='del'){const p=F.photos.find(x=>x.id===id);if(p){try{URL.revokeObjectURL(p.url)}catch(e){}}F.photos=F.photos.filter(x=>x.id!==id);F.assign=F.assign.map(r=>(r||[]).filter(x=>x!==id));F.gray.delete(id);bDel(id)}
  else if(a==='mv'){const i=F.photos.findIndex(x=>x.id===id),j=i+(+b.dataset.d);if(i>=0&&j>=0&&j<F.photos.length){const t=F.photos[i];F.photos[i]=F.photos[j];F.photos[j]=t}}
  else if(a==='rows'){F.rows=cl(+b.dataset.n|0,1,6);F.cur=Math.min(F.cur,F.rows-1);F.assign.length=Math.min(F.assign.length,F.rows)}
  else if(a==='row')F.cur=cl(+b.dataset.n|0,0,F.rows-1);
  else if(a==='pick'){const r=F.assign[F.cur]||(F.assign[F.cur]=[]),k=r.indexOf(id);if(k>=0)r.splice(k,1);else{for(let i=0;i<F.assign.length;i++){const q=(F.assign[i]||[]).indexOf(id);if(q>=0)F.assign[i].splice(q,1)}r.push(id)}}
  else if(a==='build')return doBuild();
  else if(a==='back'){relRes();F.view='edit';F.msg=''}
  else if(a==='zi')F.zoom=Math.min(12,F.zoom*1.5);else if(a==='zo')F.zoom=Math.max(1,F.zoom/1.5);else if(a==='z1')F.zoom=1;
  else if(a==='dl')return save('dl');else if(a==='sh')return save('share');else if(a==='tiles')return saveTiles();
  else if(a==='tsort'){F.msg=sortByTime()?'התמונות סודרו לפי זמן הצילום (המספור התעדכן). אם כבר סימנתם שורות – בדקו שהסימון עדיין נכון.':'אין בתמונות מידע על זמן הצילום.'}
  else if(a==='sapp'){const q=(F.sugg||[])[+b.dataset.i];if(q){F.assign[q.ui]=q.order.slice();F.sugg=null;return rebuild()}}
  else if(a==='sno'){(F.sugg||[]).splice(+b.dataset.i,1)}
  else if(a==='crop'){F.crop=!F.crop;return rebuild()}else if(a==='all')F.all=!F.all;
  else if(a==='seam'){const s=F.lay.seams[+b.dataset.i];if(!s)return;let A,B;
   if(s.t==='h'){A=F.gray.get(s.a);B=F.gray.get(s.b)}else{A=strip(F.lay.pls[s.r],F.gray);B=strip(F.lay.pls[s.r+1],F.gray)}
   F.as={seam:s,A,B,dx:s.dx,dy:s.dy,sc:s.sc||1,px:1};F.view='adj'}
  else if(a==='ar'&&F.as){F.as.dx+=+b.dataset.x;F.as.dy+=+b.dataset.y}
  else if(a==='aok'&&F.as){F.adj[F.as.seam.key]={dx:F.as.dx,dy:F.as.dy};F.as=null;return rebuild()}
  else if(a==='aauto'&&F.as){delete F.adj[F.as.seam.key];F.as=null;return rebuild()}
  else if(a==='acx'){F.as=null;F.view='res'}
  draw()});
 draw()}
ACT.s3ffOpen=()=>open();
API.finalBlob=finalBlob;API.state=()=>F;
})(typeof window!=='undefined'?window:this);
