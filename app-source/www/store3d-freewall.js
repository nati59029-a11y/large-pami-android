/* ניסוי "צילום חופשי של קיר" (אב-טיפוס, בטלפון בלבד): כמה תמונות, סימון לאיזו שורה של הקיר כל תמונה שייכת, וחיבור לתמונה אחת.
   כלום לא נשלח לשרת ולא נשמר כחזית – הכול בטלפון (התמונות המוקטנות, מצב המסך והקיר שנבנה ב-IndexedDB, בלי מערכת). נטען אחרי store3d-setupcap.js ו-store3d-warp.js.
   החיבור: OpenCV (opencv.js מקומי, www/opencv/opencv.js – מועתק בבנייה מ-@techstark/opencv-js, נטען רק כשנכנסים למסך).
   נקודות מאפיינות (AKAZE) ← התאמות בין זוגות ← פתרון כולל לכל התמונות ← מיזוג רך באריחים. החיבור אוטומטי, ותמונה שלא חוברה מסומנת. "צלמו עם עזרה" = מצלמה חיה עם תמונה שקופה, פלס, מחוון חפיפה ושורות.
   החלק הראשון (wallsOf, plan, frame, tile, gains) הוא קוד טהור (בלי DOM, opencv מועבר כפרמטר) ורץ גם בבדיקות Node. החלק השני הוא המסך.
   מוסכמות: בקוד הטהור rows[0] = השורה העליונה בקיר. במסך שורה 1 = התחתונה (ליד הרצפה) והמסך הופך את הסדר לפני החיבור. בכל שורה התמונה הראשונה = הכי שמאלית. */
(function(root){
'use strict';
const MAXPH=120,DEFH=300,TILE=1536/* אריח פלט מרבי */,MAXA=60e6/* שטח תוצאה מרבי */;
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
/* ---------- חיבור עם OpenCV (opencv.js) ---------- */
/* קואורדינטות: לכל תמונה "גודל מלא" = התמונה השמורה (צלע ארוכה עד 1600). המאפיינים מחושבים בגרסה מוקטנת (צלע ארוכה FEAT) ומומרים לגודל המלא.
   שלבים: מאפיינים (AKAZE, או ORB אם AKAZE לא זמין) ← התאמות בין זוגות (רצועות חפיפה, יחס Lowe, RANSAC של דמיון עם הגבלות כיוון,
   כמה השערות ובדיקת דמיון תמונה) ← פתרון כולל (ריבועים פחותים על כל ההתאמות, ייחוס לתמונה האמצעית, הסרת חיבורים סותרים)
   ← פריסה, חיתוך ומיזוג באריחים (תפר חכם – seams – או מיזוג רך לפי המרחק מהשוליים). */
const FEAT=1200,NKP=6000,RAT=.9,MAXM=2500,WPOW=4,PRIOR=20,SMH=200/* גובה התמונה הקטנה לבדיקת דמיון */;
const rnd=s=>()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296};
/* opencv.js מוכן לשימוש. מחזיר {cv} (עטיפה: המודול עצמו "thenable" ו-await עליו נתקע בלולאה) */
async function cvReady(cv){
 if(!cv)throw new Error('no-cv');
 if(cv instanceof Promise)cv=await cv.then(m=>({m})).then(o=>o.m);
 if(!cv.Mat)await new Promise((res,rej)=>{const t=setTimeout(()=>rej(new Error('cv-timeout')),90000),prev=cv.onRuntimeInitialized;cv.onRuntimeInitialized=()=>{clearTimeout(t);if(typeof prev==='function')try{prev()}catch(e){}res()};if(cv.Mat){clearTimeout(t);res()}});
 return{cv}}
/* מאפיינים לתמונה אפורה im={w,h,g} (כבר בגודל המוקטן). s = יחס גודל מוקטן/מלא. מחזיר נקודות בגודל המלא */
function feats(cv,im,s){
 const m=new cv.Mat(im.h,im.w,cv.CV_8UC1);m.data.set(im.g);const no=new cv.Mat(),kp=new cv.KeyPointVector(),d=new cv.Mat();let det=null;
 try{
  if(typeof cv.AKAZE==='function'){det=new cv.AKAZE();try{det.setThreshold(.0005)}catch(e){}}else det=new cv.ORB(NKP);
  det.detectAndCompute(m,no,kp,d);
  const n=kp.size(),dl=d.cols||0,L=[];for(let i=0;i<n;i++){const k=kp.get(i);L.push({x:k.pt.x,y:k.pt.y,r:k.response,i})}
  /* פיזור אחיד: רשת 6×8, בכל תא הנקודות החזקות ביותר, עד NKP */
  let keep=L;if(n>NKP){const GX=6,GY=8,cells=Array.from({length:GX*GY},()=>[]);for(const p of L)cells[Math.min(GY-1,Math.floor(p.y/im.h*GY))*GX+Math.min(GX-1,Math.floor(p.x/im.w*GX))].push(p);
   for(const c of cells)c.sort((a,b)=>b.r-a.r);keep=[];const per=Math.ceil(NKP/(GX*GY));for(const c of cells)keep.push(...c.slice(0,per))}
  keep.sort((a,b)=>b.r-a.r);/* החזקות קודם – בהתאמה לוקחים רק את הראשונות */
  const P=new Float32Array(2*keep.length),D=new Uint8Array(keep.length*dl);
  keep.forEach((p,j)=>{P[2*j]=p.x/s;P[2*j+1]=p.y/s;if(dl)D.set(d.data.subarray(p.i*dl,p.i*dl+dl),j*dl)});
  /* תמונה קטנה לבדיקת דמיון (גובה SMH) */
  const k2=SMH/im.h,sw=Math.max(8,Math.round(im.w*k2)),sm=new cv.Mat();cv.resize(m,sm,new cv.Size(sw,SMH),0,0,cv.INTER_AREA);const g=sm.data.slice();sm.delete();
  return{P,D,dl,n:keep.length,sm:{w:sw,h:SMH,g,s:k2*s}}}
 finally{m.delete();no.delete();kp.delete();d.delete();if(det)det.delete()}}
function subDesc(cv,F,pred){const idx=[];for(let k=0;k<F.n&&idx.length<MAXM;k++)if(pred(F.P[2*k],F.P[2*k+1]))idx.push(k);const m=new cv.Mat(Math.max(1,idx.length),F.dl,cv.CV_8UC1);idx.forEach((k,r)=>m.data.set(F.D.subarray(k*F.dl,k*F.dl+F.dl),r*F.dl));return{idx,m}}
/* דמיון (סקאלה+סיבוב+הזזה) B→A: x_A = p*x - q*y + tx, y_A = q*x + p*y + ty */
const simAp=(T,x,y)=>[T[0]*x-T[1]*y+T[2],T[1]*x+T[0]*y+T[3]];
function simFit(a,b,ids){let n=0,mbx=0,mby=0,max=0,may=0;for(const k of ids){mbx+=b[2*k];mby+=b[2*k+1];max+=a[2*k];may+=a[2*k+1];n++}
 mbx/=n;mby/=n;max/=n;may/=n;let sxx=0,sp=0,sq=0;for(const k of ids){const u=b[2*k]-mbx,v=b[2*k+1]-mby,X=a[2*k]-max,Y=a[2*k+1]-may;sxx+=u*u+v*v;sp+=u*X+v*Y;sq+=u*Y-v*X}
 const p=sxx>1e-9?sp/sxx:1,q=sxx>1e-9?sq/sxx:0;return[p,q,max-(p*mbx-q*mby),may-(q*mbx+p*mby)]}
/* בדיקת התאמת השערה לכיוון המצופה. wa,ha = גודל A; wb,hb = גודל B (מלא). dir: h = B מימין ל-A, v = B מתחת ל-A, a = כל כיוון */
function priorOk(T,dir,wa,ha,wb,hb){const s=Math.hypot(T[0],T[1]),r=Math.abs(Math.atan2(T[1],T[0]));if(s<.6||s>1.65||r>.3)return false;
 const c=simAp(T,wb/2,hb/2),cx=c[0]-wa/2,cy=c[1]-ha/2;
 if(dir==='h')return cx>.2*wa&&cx<1.05*wa&&Math.abs(cy)<.4*ha;
 if(dir==='v')return cy>.15*ha&&cy<1.05*ha&&Math.abs(cx)<.75*wa;
 return Math.abs(cx)<1.1*wa&&Math.abs(cy)<1.1*ha}
function ransacSim(a,b,dir,wa,ha,wb,hb,thr,excl,seed){const n=a.length/2,R=rnd(seed||7);let best=null;
 if(n<3)return null;const its=Math.min(4000,40*n);
 for(let it=0;it<its;it++){const i=Math.floor(R()*n),j=Math.floor(R()*n);if(i===j||excl[i]||excl[j])continue;
  const bx=b[2*j]-b[2*i],by=b[2*j+1]-b[2*i+1],ax=a[2*j]-a[2*i],ay=a[2*j+1]-a[2*i+1],d=bx*bx+by*by;if(d<900)continue;
  const p=(ax*bx+ay*by)/d,q=(ay*bx-ax*by)/d,T=[p,q,a[2*i]-(p*b[2*i]-q*b[2*i+1]),a[2*i+1]-(q*b[2*i]+p*b[2*i+1])];
  if(!priorOk(T,dir,wa,ha,wb,hb))continue;
  let c=0;for(let k=0;k<n;k++){if(excl[k])continue;const ex=T[0]*b[2*k]-T[1]*b[2*k+1]+T[2]-a[2*k],ey=T[1]*b[2*k]+T[0]*b[2*k+1]+T[3]-a[2*k+1];if(ex*ex+ey*ey<thr*thr)c++}
  if(!best||c>best.c)best={c,T}}
 if(!best||best.c<4)return null;
 /* חידוד: התאמה מחדש על הנקודות המתאימות, פעמיים */
 let T=best.T,ids=[];for(let r=0;r<2;r++){ids=[];for(let k=0;k<n;k++){if(excl[k])continue;const e=simAp(T,b[2*k],b[2*k+1]);if(Math.hypot(e[0]-a[2*k],e[1]-a[2*k+1])<thr)ids.push(k)}if(ids.length<3)break;T=simFit(a,b,ids)}
 return{T,ids,c:ids.length}}
/* דמיון תמונה (NCC) באזור החפיפה, על התמונות הקטנות. T ביחידות מלאות B→A */
function photo(A,B,T){const sa=A.sm,sb=B.sm,ka=sa.s,kb=sb.s;
 /* נקודה בקטנה של B → מלא B → מלא A → קטנה A */
 let n=0,s1=0,s2=0,s11=0,s22=0,s12=0;
 for(let y=1;y<sb.h-1;y+=2)for(let x=1;x<sb.w-1;x+=2){const P=simAp(T,x/kb,y/kb),X=P[0]*ka,Y=P[1]*ka;if(X<1||Y<1||X>=sa.w-2||Y>=sa.h-2)continue;
  const xi=X|0,yi=Y|0,fx=X-xi,fy=Y-yi,o=yi*sa.w+xi,va=(sa.g[o]*(1-fx)+sa.g[o+1]*fx)*(1-fy)+(sa.g[o+sa.w]*(1-fx)+sa.g[o+sa.w+1]*fx)*fy,vb=sb.g[y*sb.w+x];
  n++;s1+=va;s2+=vb;s11+=va*va;s22+=vb*vb;s12+=va*vb}
 if(n<150)return{ncc:0,n};const v1=s11-s1*s1/n,v2=s22-s2*s2/n;if(v1<1e-6||v2<1e-6)return{ncc:0,n};return{ncc:(s12-s1*s2/n)/Math.sqrt(v1*v2),n}}
/* התאמת זוג: A ו-B = תוצאות feats (+w,h מלאים). מחזיר קצה {T (B→A), pa, pb (נקודות מתאימות, מלא), inl, ncc, sc} או null */
function matchPair(cv,bf,A,B,dir){
 const SW=.55;let fa,fb;
 if(dir==='h'){fa=x=>x>A.w*(1-SW);fb=x=>x<B.w*SW}else if(dir==='v'){fa=(x,y)=>y>A.h*.25;fb=(x,y)=>y<B.h*.75}else{fa=fb=()=>true}
 const sa=subDesc(cv,A,fa),sb=subDesc(cv,B,fb);if(sa.idx.length<8||sb.idx.length<8){sa.m.delete();sb.m.delete();return null}
 const mm=new cv.DMatchVectorVector(),a=[],b=[];
 try{bf.knnMatch(sb.m,sa.m,mm,2);
  for(let k=0;k<mm.size();k++){const v=mm.get(k);if(v.size()>=2){const m0=v.get(0),m1=v.get(1);if(m0.distance<RAT*m1.distance){const qb=sb.idx[m0.queryIdx],qa=sa.idx[m0.trainIdx];a.push(A.P[2*qa],A.P[2*qa+1]);b.push(B.P[2*qb],B.P[2*qb+1])}}v.delete()}}
 finally{mm.delete();sa.m.delete();sb.m.delete()}
 const thr=.018*Math.max(A.h,A.w),excl=new Uint8Array(a.length/2),hyp=[];
 for(let h=0;h<3;h++){const r=ransacSim(a,b,dir,A.w,A.h,B.w,B.h,thr,excl,7+h);if(!r||r.c<6)break;const ph=photo(A,B,r.T);hyp.push(Object.assign(r,{ncc:ph.ncc,sc:r.c*Math.max(.05,ph.ncc+.15)}));for(const k of r.ids)excl[k]=1}
 if(!hyp.length)return null;hyp.sort((x,y)=>y.sc-x.sc);const H=hyp[0];
 /* נקודות לפתרון הכולל: עד 60, מפוזרות */
 let ids=H.ids;if(ids.length>60){const st=ids.length/60,o=[];for(let k=0;k<60;k++)o.push(ids[Math.floor(k*st)]);ids=o}
 const pa=new Float32Array(2*ids.length),pb=new Float32Array(2*ids.length);ids.forEach((k,j)=>{pa[2*j]=a[2*k];pa[2*j+1]=a[2*k+1];pb[2*j]=b[2*k];pb[2*j+1]=b[2*k+1]});
 const alt=hyp.length>1?hyp[1].sc/H.sc:0;
 return{T:H.T,pa,pb,inl:H.c,ncc:+H.ncc.toFixed(3),alt:+alt.toFixed(2),sc:+H.sc.toFixed(1),n:a.length/2}}
/* חיבור חזק = מספיק לבדו; חלש = מתקבל רק אם הוא מסכים עם מה שכבר נקבע (שלב 4) */
const edgeOk=e=>!!e&&e.ncc>=.12&&(e.inl>=15||e.inl>=10&&e.ncc>=.35);
const edgeWeak=e=>!!e&&e.inl>=7&&e.ncc>=.05;
/* פתרון כולל: לכל תמונה העתקה אפינית x' = a x + b y + tx, y' = c x + d y + ty. ריבועים פחותים על כל זוגות הנקודות + עיגון תמונת הייחוס
   + משיכה חלשה לדמיון (בלי גזירה/מתיחה) כדי שהשרשרת לא תתעוות. מחזיר Map id→[a,b,tx,c,d,ty] */
function solve(ids,edges,ref,o){
 o=o||{};const n=ids.length,ix=new Map(ids.map((id,k)=>[id,k])),N=6*n,M=new Float64Array(N*N),V=new Float64Array(N),lam=o.lam==null?.3:o.lam;
 const add=(row,val,w)=>{/* row: [[index,coef]...] */for(const[i,ci]of row){V[i]+=w*ci*val;for(const[j,cj]of row)M[i*N+j]+=w*ci*cj}};
 const deg=new Float64Array(n);/* deg = משקל הנקודות של כל תמונה */
 for(const e of edges){const i=ix.get(e.a),j=ix.get(e.b);if(i==null||j==null)continue;const np=e.pa.length/2,w=(e.w||1)*Math.min(e.inl,60)/np;deg[i]+=w*np/1e3;deg[j]+=w*np/1e3;
  for(let k=0;k<np;k++){const xa=e.pa[2*k],ya=e.pa[2*k+1],xb=e.pb[2*k],yb=e.pb[2*k+1],I=6*i,J=6*j;
   add([[I,xa],[I+1,ya],[I+2,1],[J,-xb],[J+1,-yb],[J+2,-1]],0,w);
   add([[I+3,xa],[I+4,ya],[I+5,1],[J+3,-xb],[J+4,-yb],[J+5,-1]],0,w)}
  /* גם החלק הליניארי (קנה מידה וסיבוב) של B = של A כפול זה של החיבור – אחרת תמונות רחוקות מהייחוס "מתכווצות" כדי להקטין שגיאה */
  const p=e.T[0],q=e.T[1],wl=(e.w||1)*Math.min(e.inl,60)*(o.lin==null?4e4:o.lin),I=6*i,J=6*j;
  add([[J,1],[I,-p],[I+1,-q]],0,wl);add([[J+1,1],[I,q],[I+1,-p]],0,wl);add([[J+3,1],[I+3,-p],[I+4,-q]],0,wl);add([[J+4,1],[I+3,q],[I+4,-p]],0,wl)}
 for(let k=0;k<n;k++){const I=6*k,r=lam*Math.max(1,deg[k])*1e4/* קנה מידה: מקדמים × פיקסלים בריבוע */;add([[I,1],[I+4,-1]],0,r);add([[I+1,1],[I+3,1]],0,r);const pr=(o.prior==null?PRIOR:o.prior)*Math.max(1,deg[k])*4e4/* כל התמונות צולמו מאותו מרחק: קנה מידה ~1, בלי סיבוב – משיכה רכה */;add([[I,1]],1,pr);add([[I+4,1]],1,pr);add([[I+1,1]],0,pr);add([[I+3,1]],0,pr)}
 const R=ix.get(ref),BIG=1e12,id6=[1,0,0,0,1,0];for(let c=0;c<6;c++)add([[6*R+c,1]],id6[c],BIG);
 const X=cholSolve(M,V,N);if(!X)return null;const out=new Map();ids.forEach((id,k)=>out.set(id,Array.from(X.subarray(6*k,6*k+6))));return out}
function cholSolve(A,b,n){const L=new Float64Array(n*n);
 for(let j=0;j<n;j++){let s=A[j*n+j];for(let k=0;k<j;k++)s-=L[j*n+k]*L[j*n+k];if(!(s>1e-12))return null;const d=Math.sqrt(s);L[j*n+j]=d;
  for(let i=j+1;i<n;i++){let t=A[i*n+j];for(let k=0;k<j;k++)t-=L[i*n+k]*L[j*n+k];L[i*n+j]=t/d}}
 const y=new Float64Array(n);for(let i=0;i<n;i++){let s=b[i];for(let k=0;k<i;k++)s-=L[i*n+k]*y[k];y[i]=s/L[i*n+i]}
 const x=new Float64Array(n);for(let i=n-1;i>=0;i--){let s=y[i];for(let k=i+1;k<n;k++)s-=L[k*n+i]*x[k];x[i]=s/L[i*n+i]}return x}
const afAp=(T,x,y)=>[T[0]*x+T[1]*y+T[2],T[3]*x+T[4]*y+T[5]];
const simAf=T=>[T[0],-T[1],T[2],T[1],T[0],T[3]];
const afMul=(A,B)=>[A[0]*B[0]+A[1]*B[3],A[0]*B[1]+A[1]*B[4],A[0]*B[2]+A[1]*B[5]+A[2],A[3]*B[0]+A[4]*B[3],A[3]*B[1]+A[4]*B[4],A[3]*B[2]+A[4]*B[5]+A[5]];
const afInv=A=>{const d=A[0]*A[4]-A[1]*A[3],a=A[4]/d,b=-A[1]/d,c=-A[3]/d,e=A[0]/d;return[a,b,-(a*A[2]+b*A[5]),c,e,-(c*A[2]+e*A[5])]};
function edgeRes(e,G){const A=G.get(e.a),B=G.get(e.b);if(!A||!B)return Infinity;let s=0;const np=e.pa.length/2;for(let k=0;k<np;k++){const p=afAp(A,e.pa[2*k],e.pa[2*k+1]),q=afAp(B,e.pb[2*k],e.pb[2*k+1]);s+=(p[0]-q[0])**2+(p[1]-q[1])**2}return Math.sqrt(s/np)}
function comps(ids,edges){const par=new Map(ids.map(i=>[i,i])),f=x=>par.get(x)===x?x:(par.set(x,f(par.get(x))),par.get(x));for(const e of edges)if(par.has(e.a)&&par.has(e.b))par.set(f(e.a),f(e.b));const C=new Map();for(const i of ids){const r=f(i);if(!C.has(r))C.set(r,[]);C.get(r).push(i)}return[...C.values()].sort((a,b)=>b.length-a.length)}
/* פתרון חוזר: מסירים את החיבור הסותר ביותר (שארית גבוהה) עד שהכול עקבי */
function solveRobust(ids,edges,pickRef,o){
 let E=edges.slice(),G=null,ref=null,main=[];const dropped=[];
 for(let it=0;it<=edges.length;it++){
  main=comps(ids,E)[0]||[];ref=pickRef(main);const Em=E.filter(e=>main.includes(e.a)&&main.includes(e.b));
  G=main.length>1?solve(main,Em,ref,o):new Map([[ref,[1,0,0,0,1,0]]]);if(!G)break;
  const R=Em.map(e=>({e,r:edgeRes(e,G)})),med=R.length?R.map(x=>x.r).sort((a,b)=>a-b)[R.length>>1]:0,lim=Math.max(o.minRes||60,3.5*med);
  /* חיבור שהוא הקשר היחיד בין שני חלקים (גשר) לא מוסר – אין לו מה לסתור; שארית גבוהה בו = מגבלת המודל, לא טעות */
  const n0=comps(main,Em).length,bad=R.filter(x=>!x.e.manual&&x.r>lim).sort((a,b)=>b.r-a.r).find(x=>comps(main,Em.filter(e=>e!==x.e)).length===n0);if(!bad)break;
  E=E.filter(e=>e!==bad.e);dropped.push(Object.assign(bad.e,{res:+bad.r.toFixed(1)}))}
 if(G)for(const e of E)e.res=+edgeRes(e,G).toFixed(1);
 return{G,ref,main,E,dropped}}
/* נקודות מלאכותיות לחיבור ידני: הזזה (dx,dy) של B ביחס ל-A (ביחידות מלאות של A, B בקנה מידה של A) */
function manualEdge(a,b,A,B,dx,dy){const k=A.h/B.h,pa=[],pb=[];for(const fx of [.1,.5,.9])for(const fy of [.1,.5,.9]){const xb=fx*B.w,yb=fy*B.h;pb.push(xb,yb);pa.push(dx+xb*k,dy+yb*k)}
 return{a,b,T:[k,0,dx,dy],pa:Float32Array.from(pa),pb:Float32Array.from(pb),inl:60,ncc:1,manual:true,w:3}}
/* בניית התוכנית: rows = [[id,...]] (rows[0] = עליונה, משמאל לימין). io.gray(id) → {w,h,g,W,H} (אפור בגודל FEAT, ו-W,H מלאים).
   o.manual = {'a:b':{dx,dy}}; o.known = הסדר בשורות ודאי (מהמצלמה עם העזרה); o.onP(שלב, נעשה, סה"כ). מחזיר {G (Map id→affine), edges, dropped, unplaced:[id], ref, tried} */
async function plan(cv,rows,io,o){
 o=o||{};const P=o.onP||(()=>{}),tick=o.tick||(()=>Promise.resolve()),F=new Map(),man=o.manual||{};rows=rows.filter(r=>r.length);const all=[].concat(...rows);
 const bf=new cv.BFMatcher(cv.NORM_HAMMING,false);
 try{
  for(let k=0;k<all.length;k++){const id=all[k];P('feat',k,all.length);await tick();const g=await io.gray(id),s=g.w/g.W,f=feats(cv,g,s);f.w=g.W;f.h=g.H;F.set(id,f)}
  const E=[],W=[],tried=new Set(),key=(a,b)=>a+':'+b;
  const tryE=(a,b,dir)=>{const k=key(a,b);if(tried.has(k)||a===b)return null;tried.add(k);const m=man[k];if(m){const e=manualEdge(a,b,F.get(a),F.get(b),m.dx,m.dy);E.push(e);return e}
   const e=matchPair(cv,bf,F.get(a),F.get(b),dir);if(o.dbg)o.dbg.push([a,b,dir,e?e.n:0,e?e.inl:0,e?e.ncc:0,e?e.alt:0,e&&e.T.map(v=>+v.toFixed(2)).join(',')]);if(e){e.a=a;e.b=b;e.dir=dir;e.ok=edgeOk(e);if(e.ok)E.push(e);else if(edgeWeak(e))W.push(e)}return e};
  /* 1. בתוך כל שורה: שכנים, ושכן-של-שכן (אם תמונה באמצע חלשה) */
  const hp=[];rows.forEach(r=>{for(let j=0;j+1<r.length;j++)hp.push([r[j],r[j+1]]);for(let j=0;j+2<r.length;j++)hp.push([r[j],r[j+2]])});
  for(let k=0;k<hp.length;k++){P('match',k,hp.length);await tick();const e=tryE(hp[k][0],hp[k][1],'h');if(!(e&&e.ok)&&!o.known)tryE(hp[k][1],hp[k][0],'h')/* אולי הסדר הפוך (לא כשהסדר ידוע מהמצלמה עם העזרה) */}
  /* 2. בין שורות (rows[r] מעל rows[r+1]): כל הזוגות, מהסבירים לפחות סבירים (לפי מיקום יחסי בשורה); תמונה שכבר יש לה 2 חיבורים בין השורות – מדלגים */
  for(let r=0;r+1<rows.length;r++){const U=rows[r],D=rows[r+1],pr=[],cnt=new Map(),rel=(L,j)=>(j+.5)/L.length;
   U.forEach((u,i)=>D.forEach((d,j)=>pr.push([u,d,Math.abs(rel(U,i)-rel(D,j))+(i===0&&j===0?-1:0)])));pr.sort((x,y)=>x[2]-y[2]);
   const cap=Math.max(150,3*(U.length+D.length));
   for(let k=0;k<pr.length&&k<cap;k++){const[u,d]=pr[k];if((cnt.get(u)||0)>=2&&(cnt.get(d)||0)>=2)continue;P('rows',k,Math.min(pr.length,cap));await tick();
    const e=tryE(u,d,'v');if(e&&e.ok){cnt.set(u,(cnt.get(u)||0)+1);cnt.set(d,(cnt.get(d)||0)+1)}}}
  /* 3. תמונה בלי שום חיבור: חיפוש מול התמונות הקרובות לה בסדר (כל כיוון) – סדר שגוי לא הורס */
  for(const id of all){if(E.some(e=>e.a===id||e.b===id))continue;const i0=all.indexOf(id),others=all.filter(x=>x!==id).sort((x,y)=>Math.abs(all.indexOf(x)-i0)-Math.abs(all.indexOf(y)-i0)).slice(0,16);
   for(let k=0;k<others.length;k++){P('rescue',k,others.length);await tick();const x=others[k];const e1=tryE(x,id,'a');if(e1&&e1.ok)break}}
  /* 4. פתרון כולל: קודם החיבורים החזקים; אחר כך חיבורים חלשים שמסכימים עם הפתרון (או שני חלשים שמסכימים זה עם זה לתמונה שלא מוקמה) */
  P('solve',0,1);await tick();
  const big=rows.reduce((a,r)=>r.length>a.length?r:a,rows[0]),pickRef=m=>{const c=big.filter(x=>m.includes(x));return c.length?c[c.length>>1]:m[m.length>>1]};
  let S=solveRobust(all,E,pickRef,{});
  if(S.G&&W.length){const add=[],lim=e=>.04*Math.max(F.get(e.a).h,F.get(e.a).w);
   for(const e of W){if(S.G.has(e.a)&&S.G.has(e.b)&&edgeRes(e,S.G)<lim(e))add.push(e)}
   /* תמונה שלא מוקמה: מיקום מוצע מכל חיבור חלש לתמונה שכבר מוקמה; מתקבל אם שניים מסכימים, או אחד עם 12+ נקודות */
   for(const id of all){if(S.G.has(id))continue;const sug=[];
    for(const e of W){let T=null;if(e.b===id&&S.G.has(e.a))T=afMul(S.G.get(e.a),simAf(e.T));else if(e.a===id&&S.G.has(e.b))T=afMul(S.G.get(e.b),afInv(simAf(e.T)));if(T)sug.push({e,T})}
    const f=F.get(id),c=[f.w/2,f.h/2],agree=(x,y)=>{const p=afAp(x.T,c[0],c[1]),q=afAp(y.T,c[0],c[1]);return Math.hypot(p[0]-q[0],p[1]-q[1])<.06*Math.max(f.w,f.h)};
    const ok=sug.filter(x=>sug.some(y=>y!==x&&agree(x,y)));if(ok.length)add.push(...ok.map(x=>x.e));else{const b1=sug.filter(x=>x.e.inl>=12).sort((x,y)=>y.e.inl-x.e.inl)[0];if(b1)add.push(b1.e)}}
   if(add.length)S=solveRobust(all,E.concat(add),pickRef,{})}
  const unplaced=all.filter(id=>!S.G||!S.G.has(id));
  return{G:S.G||new Map(),edges:S.E,dropped:S.dropped,unplaced,ref:S.ref,tried:tried.size,size:new Map(all.map(id=>[id,[F.get(id).w,F.get(id).h]])),sm:new Map(all.map(id=>[id,F.get(id).sm])),rows}}
 finally{bf.delete()}}
/* גבולות, כיסוי (בהקטנה), חיתוך ואזורים שלא צולמו. q = רזולוציית מסכת הכיסוי (פיקסלים בצלע הארוכה) */
function frame(cv,pl,q){
 q=q||600;const ids=[...pl.G.keys()];let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;const C=new Map();
 for(const id of ids){const T=pl.G.get(id),[w,h]=pl.size.get(id),c=[[0,0],[w,0],[w,h],[0,h]].map(p=>afAp(T,p[0],p[1]));C.set(id,c);for(const p of c){x0=Math.min(x0,p[0]);x1=Math.max(x1,p[0]);y0=Math.min(y0,p[1]);y1=Math.max(y1,p[1])}}
 const W=x1-x0,H=y1-y0,k=q/Math.max(W,H),mw=Math.max(2,Math.ceil(W*k)),mh=Math.max(2,Math.ceil(H*k)),mask=cv.Mat.zeros(mh,mw,cv.CV_8UC1);
 try{for(const id of ids){const c=C.get(id),pts=cv.matFromArray(4,1,cv.CV_32SC2,[].concat(...c.map(p=>[Math.round((p[0]-x0)*k),Math.round((p[1]-y0)*k)])));cv.fillConvexPoly(mask,pts,new cv.Scalar(255));pts.delete()}
  const M=mask.data.slice(),cov=M.reduce((s,v)=>s+(v?1:0),0);
  /* המלבן הגדול ביותר שמכוסה כולו (שיטת ההיסטוגרמה) */
  const hgt=new Int32Array(mw);let best={a:0};
  for(let y=0;y<mh;y++){for(let x=0;x<mw;x++)hgt[x]=M[y*mw+x]?hgt[x]+1:0;const st=[];for(let x=0;x<=mw;x++){const hh=x<mw?hgt[x]:0;let s=x;while(st.length&&st[st.length-1][1]>=hh){const[sx,sh]=st.pop();const a=sh*(x-sx);if(a>best.a)best={a,x0:sx,x1:x,y0:y-sh+1,y1:y+1};s=sx}st.push([s,hh])}}
  /* חיתוך: אם המלבן המלא מכיל רוב הקיר – אותו; אחרת קיצוץ שוליים כמעט ריקים בלבד */
  let cr;if(best.a>=.8*cov)cr=best;else{let a=0,b=mw,c=0,d=mh;const colF=x=>{let s=0;for(let y=c;y<d;y++)s+=M[y*mw+x]?1:0;return s/(d-c)},rowF=y=>{let s=0;for(let x=a;x<b;x++)s+=M[y*mw+x]?1:0;return s/(b-a)};
   for(let ch=1;ch;){ch=0;if(b-a>4&&colF(a)<.35){a++;ch=1}if(b-a>4&&colF(b-1)<.35){b--;ch=1}if(d-c>4&&rowF(c)<.35){c++;ch=1}if(d-c>4&&rowF(d-1)<.35){d--;ch=1}}cr={x0:a,x1:b,y0:c,y1:d}}
  const crop={x0:x0+cr.x0/k,y0:y0+cr.y0/k,x1:x0+cr.x1/k,y1:y0+cr.y1/k};
  /* אזורים שלא צולמו בתוך החיתוך: רכיבים קשירים של "לא מכוסה" */
  const gaps=[],seen=new Uint8Array(mw*mh);
  for(let y=cr.y0;y<cr.y1;y++)for(let x=cr.x0;x<cr.x1;x++){const i=y*mw+x;if(M[i]||seen[i])continue;let n=0,sx=0,sy=0;const st=[i];seen[i]=1;
   while(st.length){const j=st.pop(),jx=j%mw,jy=(j/mw)|0;n++;sx+=jx;sy+=jy;for(const[ddx,ddy]of[[1,0],[-1,0],[0,1],[0,-1]]){const X=jx+ddx,Y=jy+ddy;if(X<cr.x0||X>=cr.x1||Y<cr.y0||Y>=cr.y1)continue;const t=Y*mw+X;if(!M[t]&&!seen[t]){seen[t]=1;st.push(t)}}}
   if(n>=Math.max(30,.004*mw*mh))gaps.push({x:x0+(sx/n+.5)/k,y:y0+(sy/n+.5)/k,n})}
  return{x0,y0,x1,y1,W,H,corners:C,crop,gaps,cover:cov/(mw*mh)}}
 finally{mask.delete()}}
/* משקל מיזוג לפי גודל תמונה (מטמון): מרחק מהשוליים, בהקטנה פי 4, בחזקה 2 – מעבר רך אבל צר יחסית (פחות "רוחות" מפרלקסה) */
const WCACHE=new Map();
function weightOf(cv,w,h){const k=w+'x'+h;if(WCACHE.has(k))return WCACHE.get(k);const sw=Math.max(4,Math.round(w/4)),sh=Math.max(4,Math.round(h/4)),m=cv.Mat.zeros(sh,sw,cv.CV_8UC1),d=new cv.Mat();
 try{m.roi(new cv.Rect(1,1,sw-2,sh-2)).setTo(new cv.Scalar(255));cv.distanceTransform(m,d,cv.DIST_L2,3);let mx=0;const D=d.data32F;for(let i=0;i<D.length;i++)if(D[i]>mx)mx=D[i];const f=new Float32Array(D.length);for(let i=0;i<D.length;i++){const v=D[i]/mx;f[i]=v>0?Math.max(Math.pow(v,WPOW),1e-4*v):0}/* מינימום קטן: גם שולי תמונה שאין עליה אחרת מכוסים */
  const o={w:sw,h:sh,f};if(WCACHE.size>6)WCACHE.clear();WCACHE.set(k,o);return o}finally{m.delete();d.delete()}}
/* אריח אחד: X,Y,tw,th בקואורדינטות הפלט; k = קנה מידה פלט/פסיפס; V = פינת החיתוך. io.color(id) → {w,h,data:RGBA} בגודל מלא.
   מחזיר {rgba:Uint8ClampedArray, cov: שבר המכוסה} – לא מכוסה = פסים אפורים */
async function tile(cv,pl,fr,io,V,k,X,Y,tw,th){
 const acc=new Float32Array(tw*th*3),ws=new Float32Array(tw*th);
 for(const[id,T]of pl.G){const c=fr.corners.get(id);let bx0=1e9,by0=1e9,bx1=-1e9,by1=-1e9;for(const p of c){const u=(p[0]-V.x0)*k-X,v=(p[1]-V.y0)*k-Y;bx0=Math.min(bx0,u);bx1=Math.max(bx1,u);by0=Math.min(by0,v);by1=Math.max(by1,v)}
  const ix0=Math.max(0,Math.floor(bx0)),iy0=Math.max(0,Math.floor(by0)),ix1=Math.min(tw,Math.ceil(bx1)),iy1=Math.min(th,Math.ceil(by1));if(ix1-ix0<2||iy1-iy0<2)continue;
  const bw=ix1-ix0,bh=iy1-iy0,im=await io.color(id),src=new cv.Mat(im.h,im.w,cv.CV_8UC4);src.data.set(im.data);
  /* מיפוי מקור (מלא) → בתוך התיבה: k*(T p - V) - (X+ix0, Y+iy0) */
  const A=[k*T[0],k*T[1],k*(T[2]-V.x0)-X-ix0,k*T[3],k*T[4],k*(T[5]-V.y0)-Y-iy0],Wt=(pl.seam&&pl.seam.get(id))||weightOf(cv,im.w,im.h)/* תפר חכם אם חושב */,sx=im.w/Wt.w,sy=im.h/Wt.h;
  const MA=cv.matFromArray(2,3,cv.CV_64F,A),MW=cv.matFromArray(2,3,cv.CV_64F,[A[0]*sx,A[1]*sy,A[2]+A[0]*(sx-1)/2+A[1]*(sy-1)/2,A[3]*sx,A[4]*sy,A[5]+A[3]*(sx-1)/2+A[4]*(sy-1)/2]),
   dst=new cv.Mat(),wsrc=cv.matFromArray(Wt.h,Wt.w,cv.CV_32F,Wt.f),wdst=new cv.Mat(),sz=new cv.Size(bw,bh);
  try{cv.warpAffine(src,dst,MA,sz,cv.INTER_LINEAR,cv.BORDER_CONSTANT,new cv.Scalar(0,0,0,0));cv.warpAffine(wsrc,wdst,MW,sz,cv.INTER_LINEAR,cv.BORDER_CONSTANT,new cv.Scalar(0));
   const D=dst.data,Wd=wdst.data32F,g=io.gain?io.gain(id):1;
   for(let y=0;y<bh;y++){const ro=(iy0+y)*tw+ix0;for(let x=0;x<bw;x++){const i=y*bw+x,w=Wd[i];if(w<=1e-9||D[4*i+3]<128)continue;const o=ro+x;ws[o]+=w;acc[3*o]+=w*D[4*i]*g;acc[3*o+1]+=w*D[4*i+1]*g;acc[3*o+2]+=w*D[4*i+2]*g}}}
  finally{src.delete();MA.delete();MW.delete();dst.delete();wsrc.delete();wdst.delete()}}
 const out=new Uint8ClampedArray(tw*th*4);let cov=0;
 for(let y=0;y<th;y++)for(let x=0;x<tw;x++){const o=y*tw+x,w=ws[o];if(w>1e-9){out[4*o]=acc[3*o]/w;out[4*o+1]=acc[3*o+1]/w;out[4*o+2]=acc[3*o+2]/w;cov++}else{const s=((X+x+Y+y)%24)<3;out[4*o]=s?59:42;out[4*o+1]=s?59:42;out[4*o+2]=s?68:48}out[4*o+3]=255}
 return{rgba:out,cov:cov/(tw*th)}}
/* פיצוי חשיפה פשוט: לכל תמונה מקדם בהירות לפי ממוצעי הנקודות המשותפות בתמונות הקטנות (ממוצע גיאומטרי סביב 1) */
function gains(pl,smalls){const ids=[...pl.G.keys()],ix=new Map(ids.map((id,k)=>[id,k])),n=ids.length,M=new Float64Array(n*n),V=new Float64Array(n);
 for(const e of pl.edges){const i=ix.get(e.a),j=ix.get(e.b),A=smalls.get(e.a),B=smalls.get(e.b);if(i==null||j==null||!A||!B)continue;let la=0,lb=0,c=0;const np=e.pa.length/2;
  for(let k=0;k<np;k++){const xa=Math.round(e.pa[2*k]*A.s),ya=Math.round(e.pa[2*k+1]*A.s),xb=Math.round(e.pb[2*k]*B.s),yb=Math.round(e.pb[2*k+1]*B.s);if(xa<0||ya<0||xa>=A.w||ya>=A.h||xb<0||yb<0||xb>=B.w||yb>=B.h)continue;la+=Math.log(4+A.g[ya*A.w+xa]);lb+=Math.log(4+B.g[yb*B.w+xb]);c++}
  if(c<5)continue;const d=(la-lb)/c,w=c;/* log g_i - log g_j = -(d) */M[i*n+i]+=w;M[j*n+j]+=w;M[i*n+j]-=w;M[j*n+i]-=w;V[i]-=w*d;V[j]+=w*d}
 for(let k=0;k<n;k++)M[k*n+k]+=.5;const x=cholSolve(M,V,n);const out=new Map();ids.forEach((id,k)=>out.set(id,x?Math.min(1.4,Math.max(.7,Math.exp(x[k]))):1));return out}
/* ---------- תפר חכם: במקום מיזוג ממוצע בכל אזור החפיפה, כל נקודה בקיר לוקחת מתמונה אחת, והגבול בין תמונות עובר במסלול שבו הן הכי דומות
   (מסלול בעלות מינימלית באזור החפיפה). כך פחות "רוחות" כשיש פרלקסה. רק בגבול עצמו מעבר רך וצר. ---------- */
/* מסלול אנכי (שורה אחר שורה, זז לכל היותר פיקסל אחד לצד) עם עלות מינימלית. C = עלויות nx×ny. מחזיר Int32Array של x לכל שורה */
function minPath(C,nx,ny){
 const D=new Float64Array(nx*ny),B=new Int8Array(nx*ny);for(let x=0;x<nx;x++)D[x]=C[x];
 for(let y=1;y<ny;y++)for(let x=0;x<nx;x++){let b=D[(y-1)*nx+x],o=0;if(x>0&&D[(y-1)*nx+x-1]<b){b=D[(y-1)*nx+x-1];o=-1}if(x+1<nx&&D[(y-1)*nx+x+1]<b){b=D[(y-1)*nx+x+1];o=1}D[y*nx+x]=b+C[y*nx+x];B[y*nx+x]=o}
 const P=new Int32Array(ny);let bx=0;for(let x=1;x<nx;x++)if(D[(ny-1)*nx+x]<D[(ny-1)*nx+bx])bx=x;P[ny-1]=bx;for(let y=ny-1;y>0;y--){bx+=B[y*nx+bx];P[y-1]=bx}return P}
/* טשטוש תיבה נפרד (פעמיים ≈ גאוסיאני), r = רדיוס, במקום */
function boxBlur(f,w,h,r){if(r<1)return f;const t=new Float32Array(f.length);
 for(let p=0;p<2;p++){for(let y=0;y<h;y++){let s=0,c=0;for(let x=-r;x<w+r;x++){if(x+r<w){s+=f[y*w+x+r];c++}if(x-r-1>=0){s-=f[y*w+x-r-1];c--}if(x>=0&&x<w)t[y*w+x]=s/c}}
  for(let x=0;x<w;x++){let s=0,c=0;for(let y=-r;y<h+r;y++){if(y+r<h){s+=t[(y+r)*w+x];c++}if(y-r-1>=0){s-=t[(y-r-1)*w+x];c--}if(y>=0&&y<h)f[y*w+x]=s/c}}}return f}
/* מפת תוויות לכל הקיר (בהקטנה, צלע ארוכה q) ומסכת משקל לכל תמונה. pl.sm = התמונות האפורות הקטנות, pl.rows = שורות (עליונה ראשונה).
   מחזיר Map id→{w,h,f} (מסכה בגודל עד ms בצלע הארוכה, במערכת התמונה) – tile משתמש בה במקום משקל המרחק מהשוליים. null אם אין מה לעשות */
function seams(cv,pl,fr,o){
 o=o||{};const q=o.q||1600,gain=o.gain||(()=>1),FE=o.feather==null?3:o.feather,MS=o.ms||200;
 const ids=[...pl.G.keys()];if(ids.length<2||!pl.sm)return null;
 const k=q/Math.max(fr.W,fr.H),mw=Math.max(2,Math.ceil(fr.W*k)),mh=Math.max(2,Math.ceil(fr.H*k)),R=new Map();
 /* 1. כל תמונה אפורה מעוותת למערכת הקיר המוקטנת – רק בתיבה שלה; ערך שלילי = מחוץ לתמונה */
 for(const id of ids){const T=pl.G.get(id),sm=pl.sm.get(id),c=fr.corners.get(id);if(!sm||!c)continue;
  let bx0=1e9,by0=1e9,bx1=-1e9,by1=-1e9;for(const p of c){const u=(p[0]-fr.x0)*k,v=(p[1]-fr.y0)*k;bx0=Math.min(bx0,u);bx1=Math.max(bx1,u);by0=Math.min(by0,v);by1=Math.max(by1,v)}
  const x0=Math.max(0,Math.floor(bx0)),y0=Math.max(0,Math.floor(by0)),w=Math.min(mw,Math.ceil(bx1))-x0,h=Math.min(mh,Math.ceil(by1))-y0;if(w<2||h<2)continue;
  const s=1/sm.s,A=[k*T[0]*s,k*T[1]*s,k*(T[2]-fr.x0)-x0,k*T[3]*s,k*T[4]*s,k*(T[5]-fr.y0)-y0];
  const src=new cv.Mat(sm.h,sm.w,cv.CV_8UC1),one=new cv.Mat(sm.h,sm.w,cv.CV_8UC1,new cv.Scalar(255)),M=cv.matFromArray(2,3,cv.CV_64F,A),d=new cv.Mat(),dv=new cv.Mat(),sz=new cv.Size(w,h);
  try{src.data.set(sm.g);cv.warpAffine(src,d,M,sz,cv.INTER_LINEAR,cv.BORDER_CONSTANT,new cv.Scalar(0));cv.warpAffine(one,dv,M,sz,cv.INTER_LINEAR,cv.BORDER_CONSTANT,new cv.Scalar(0));
   const g=new Float32Array(w*h),gn=gain(id)||1;for(let i=0;i<g.length;i++)g[i]=dv.data[i]>=250?d.data[i]*gn:-1;R.set(id,{x:x0,y:y0,w,h,g})}
  finally{src.delete();one.delete();M.delete();d.delete();dv.delete()}}
 const gv=(id,x,y)=>{const r=R.get(id);if(!r)return -1;const u=x-r.x,v=y-r.y;return u<0||v<0||u>=r.w||v>=r.h?-1:r.g[v*r.w+u]};
 const num=new Map(),byN=[];for(const id of R.keys()){num.set(id,byN.length);byN.push(id)}
 /* 2. בתוך שורה: לפי מרכז משמאל לימין; כל תמונה חדשה מול מה שכבר נבנה – תפר אנכי */
 const cx=id=>{const r=R.get(id);return r.x+r.w/2},cy=id=>{const r=R.get(id);return r.y+r.h/2};
 const EDGE=8,BIG=1e6;
 function addTo(L,id,vert){const r=R.get(id),n=num.get(id);
  /* אזור החפיפה (בתוך התיבה של התמונה): שם יש כבר תווית וגם התמונה החדשה מכסה */
  const ov=new Uint8Array(r.w*r.h);let any=0;for(let v=0;v<r.h;v++)for(let u=0;u<r.w;u++){const i=(r.y+v)*mw+r.x+u;if(L[i]>=0&&r.g[v*r.w+u]>=0){ov[v*r.w+u]=1;any=1}}
  if(any){/* עלות: הבדל בהירות (עם פיצוי חשיפה) + קנס ליד שולי החפיפה. vert = תפר אנכי (תמונה מימין), אחרת אופקי (תמונה מתחת) – מחושב על המטריצה המוחלפת */
   const nx=vert?r.w:r.h,ny=vert?r.h:r.w,C=new Float32Array(nx*ny),at=(a,b)=>vert?b*r.w+a:a*r.w+b;let y0=-1,y1=-1;
   for(let b=0;b<ny;b++){let lo=-1,hi=-1;for(let a=0;a<nx;a++)if(ov[at(a,b)]){if(lo<0)lo=a;hi=a}
    if(lo<0){continue}if(y0<0)y0=b;y1=b;
    for(let a=0;a<nx;a++){const j=at(a,b);if(!ov[j]){C[b*nx+a]=BIG;continue}const u=j%r.w,v=(j/r.w)|0,X=r.x+u,Y=r.y+v,o2=gv(byN[L[Y*mw+X]],X,Y),e=Math.min(a-lo,hi-a);
     C[b*nx+a]=Math.abs(r.g[j]-o2)+(e<EDGE?(EDGE-e)*3:0)}}
   if(y0>=0){const sub=C.subarray(y0*nx,(y1+1)*nx),P=minPath(sub,nx,y1-y0+1);
    for(let b=y0;b<=y1;b++){const s=P[b-y0];for(let a=s;a<nx;a++){const j=at(a,b);if(ov[j]){const u=j%r.w,v=(j/r.w)|0;L[(r.y+v)*mw+r.x+u]=n}}}}}
  for(let v=0;v<r.h;v++)for(let u=0;u<r.w;u++){const i=(r.y+v)*mw+r.x+u;if(L[i]<0&&r.g[v*r.w+u]>=0)L[i]=n}}
 const rows=(pl.rows&&pl.rows.length?pl.rows:[ids]).map(rw=>rw.filter(id=>R.has(id))).filter(rw=>rw.length);
 const seen=new Set([].concat(...rows)),extra=[...R.keys()].filter(id=>!seen.has(id));if(extra.length)rows.push(extra);
 const RL=rows.map(rw=>{const L=new Int16Array(mw*mh).fill(-1);rw.slice().sort((a,b)=>cx(a)-cx(b)).forEach((id,j)=>addTo(L,id,true));return L});
 /* 3. בין השורות (מלמעלה למטה): תפר אופקי בין מה שנבנה לשורה הבאה */
 rows.forEach((rw,j)=>{rw.my=rw.reduce((s,id)=>s+cy(id),0)/rw.length});const ord=rows.map((rw,j)=>j).sort((a,b)=>rows[a].my-rows[b].my);
 const L=RL[ord[0]];
 for(let t=1;t<ord.length;t++){const Lr=RL[ord[t]];
  /* מטפלים בשורה כולה כ"תמונה" אחת: אזור חפיפה בכל הקיר */
  let x0=mw,x1=-1;for(let i=0;i<L.length;i++)if(L[i]>=0&&Lr[i]>=0){const x=i%mw;if(x<x0)x0=x;if(x>x1)x1=x}
  if(x1>=x0){const nx=mh,ny=x1-x0+1,C=new Float32Array(nx*ny);/* מטריצה מוחלפת: "שורה" = עמודה x, "מיקום" = y */
   for(let b=0;b<ny;b++){const X=x0+b;let lo=-1,hi=-1;for(let Y=0;Y<mh;Y++){const i=Y*mw+X;if(L[i]>=0&&Lr[i]>=0){if(lo<0)lo=Y;hi=Y}}
    for(let Y=0;Y<mh;Y++){const i=Y*mw+X;if(!(L[i]>=0&&Lr[i]>=0)){C[b*nx+Y]=lo<0?0:BIG;continue}const e=Math.min(Y-lo,hi-Y);C[b*nx+Y]=Math.abs(gv(byN[Lr[i]],X,Y)-gv(byN[L[i]],X,Y))+(e<EDGE?(EDGE-e)*3:0)}}
   const P=minPath(C,nx,ny);for(let b=0;b<ny;b++){const X=x0+b;for(let Y=P[b];Y<mh;Y++){const i=Y*mw+X;if(L[i]>=0&&Lr[i]>=0)L[i]=Lr[i]}}}
  for(let i=0;i<L.length;i++)if(L[i]<0&&Lr[i]>=0)L[i]=Lr[i]}
 /* 4. מסכה לכל תמונה במערכת שלה: 1 איפה שהתווית שלה, מטושטש קצת (מעבר רך בתפר); מינימום זעיר לפי המרחק מהשוליים כדי שלא ייווצרו חורים */
 const out=new Map();
 for(const id of byN){const T=pl.G.get(id),[W,H]=pl.size.get(id),s=Math.min(1,MS/Math.max(W,H)),w=Math.max(4,Math.round(W*s)),h=Math.max(4,Math.round(H*s)),f=new Float32Array(w*h),n=num.get(id);
  for(let v=0;v<h;v++)for(let u=0;u<w;u++){const X=(u+.5)*W/w,Y=(v+.5)*H/h,p=afAp(T,X,Y),mx=Math.floor((p[0]-fr.x0)*k),my=Math.floor((p[1]-fr.y0)*k);f[v*w+u]=mx>=0&&my>=0&&mx<mw&&my<mh&&L[my*mw+mx]===n?1:0}
  boxBlur(f,w,h,FE);
  for(let v=0;v<h;v++)for(let u=0;u<w;u++){const e=Math.min(u,v,w-1-u,h-1-v)/(Math.min(w,h)/2);f[v*w+u]=Math.max(f[v*w+u],1e-3*e*e)}
  out.set(id,{w,h,f})}
 return out}
/* ---------- עזרה בזמן הצילום (קוד טהור) ---------- */
/* פלס: מזוויות deviceorientation (beta,gamma במעלות) וזווית המסך. pitch = כמה המצלמה מוטה למעלה (+) או למטה (−); roll = נטייה הצידה. */
function levelOf(beta,gamma,ang,lim){
 if(!Number.isFinite(beta)||!Number.isFinite(gamma))return null;lim=lim||5;const r=Math.PI/180,b=beta*r,g=gamma*r,a=(ang||0)*r;
 const ux=-Math.sin(g)*Math.cos(b),uy=Math.sin(b),uz=Math.cos(g)*Math.cos(b);/* כיוון "למעלה" במערכת הטלפון */
 const pitch=Math.asin(cl(-uz,-1,1))/r,su=ux*Math.sin(a)+uy*Math.cos(a),sr=ux*Math.cos(a)-uy*Math.sin(a),roll=Math.atan2(sr,su)/r;
 const ok=Math.abs(pitch)<=lim&&Math.abs(roll)<=lim,P=Math.round(Math.abs(pitch)),Q=Math.round(Math.abs(roll));
 const msg=ok?'הטלפון ישר ✓':Math.abs(pitch)>lim&&Math.abs(pitch)>=Math.abs(roll)?(pitch<0?`החזיקו את הטלפון ישר – מוטה למטה ${P}°`:`החזיקו את הטלפון ישר – מוטה למעלה ${P}°`):`החזיקו את הטלפון ישר – נטוי הצידה ${Q}°`;
 return{pitch,roll,ok,msg}}
/* שורות במצלמה: assign[i] = תמונות שורה i (0 = התחתונה). איזו "רוח" להציג לפני הצילום הבא:
   יש כבר תמונה בשורה ← השליש הימני של האחרונה (בצד שמאל של המסך); שורה ריקה מעל שורה שצולמה ← הפס העליון של התמונה הראשונה בשורה שמתחת (בתחתית) */
function ghostOf(assign,row){const r=(assign&&assign[row])||[];if(r.length)return{id:r[r.length-1],dir:'h'};const d=row>0&&assign[row-1]||[];return d.length?{id:d[0],dir:'v'}:null}
const rowName=(i,n)=>'שורה '+(i+1)+(i===0?' (למטה)':i===n-1&&n>1?' (למעלה)':'');
const shotLabel=(assign,row,n)=>rowName(row,n)+' – תמונה '+(((assign&&assign[row])||[]).length+1);
/* הערכת הזזה בין התמונה הקודמת A לפריים החי B (אפורים קטנים באותו גודל {w,h,g}): A(x,y) ≈ B(x−dx, y−dy). דמיון ZNCC על אזור החפיפה, גס ואז עדין.
   dir 'h' = זזים ימינה (dx חיובי), 'v' = שורה מעל (dy שלילי). מחזיר {dx,dy,ov (שבר חפיפה),z (דמיון)} */
function shiftEst(A,B,dir){const w=A.w,h=A.h,a=A.g,b=B.g;
 const zn=(dx,dy)=>{const xa=Math.max(0,dx),xb=Math.min(w,w+dx),ya=Math.max(0,dy),yb=Math.min(h,h+dy);let n=0,s1=0,s2=0,s11=0,s22=0,s12=0;
  for(let y=ya;y<yb;y++){const oa=y*w,ob=(y-dy)*w-dx;for(let x=xa;x<xb;x++){const p=a[oa+x],q=b[ob+x];s1+=p;s2+=q;s11+=p*p;s22+=q*q;s12+=p*q}n+=xb-xa}
  if(n<.06*w*h)return -2;const v1=s11-s1*s1/n,v2=s22-s2*s2/n;if(v1<1e-6||v2<1e-6)return -2;return(s12-s1*s2/n)/Math.sqrt(v1*v2)*Math.sqrt(Math.min(1,n/(.2*w*h)))};
 const H=dir!=='v',R=H?[Math.round(.04*w),Math.round(.94*w),-Math.round(.25*h),Math.round(.25*h)]:[-Math.round(.25*w),Math.round(.25*w),-Math.round(.94*h),-Math.round(.04*h)];
 let best={s:-3,dx:0,dy:0};for(let dy=R[2];dy<=R[3];dy+=2)for(let dx=R[0];dx<=R[1];dx+=2){const s=zn(dx,dy);if(s>best.s)best={s,dx,dy}}
 const c=best;for(let dy=c.dy-2;dy<=c.dy+2;dy++)for(let dx=c.dx-2;dx<=c.dx+2;dx++){if(dx<R[0]||dx>R[1]||dy<R[2]||dy>R[3])continue;const s=zn(dx,dy);if(s>best.s)best={s,dx,dy}}
 return{dx:best.dx,dy:best.dy,ov:H?1-best.dx/w:1+best.dy/h,z:best.s,w,h}}
/* הודעה למשתמש לפי ההזזה: חפיפה טובה 25%–55% */
function ovMsg(r,dir){if(!r||!(r.z>=.3))return{t:'לא מזהה את החלק המשותף – יישרו לפי התמונה השקופה',ok:false};
 const p=Math.round(r.ov*100);let t,ok=false;if(r.ov<.25)t=`חפיפה ${p}% – זוזו פחות (חזרו מעט)`;else if(r.ov>.55)t=`חפיפה ${p}% – זוזו עוד קצת`;else{t=`חפיפה: ${p}% ✓`;ok=true}
 if(dir!=='v'&&Math.abs(r.dy)>.12*(r.h||1e9))t+=' · שמרו על אותו גובה';return{t,ok}}
const API={wallsOf,cvReady,feats,matchPair,solve,plan,frame,tile,gains,seams,minPath,boxBlur,levelOf,ghostOf,rowName,shotLabel,shiftEst,ovMsg,MAXPH,DEFH,TILE,MAXA,FEAT};
if(typeof module!=='undefined'&&module.exports)module.exports=API;else root.S3FreeWall=API;
if(typeof window==='undefined'||!window.S3UI||typeof ACT==='undefined'||!window.S3UI.K3)return;

/* ---------- המסך ---------- */
const U=window.S3UI,esc=U.esc2,K=U.K3,GOLD='#d4a017',CYAN='#4cc9f0';
const F={photos:[],seq:0,wall:'',rows:2,cur:0,assign:[],view:'edit',res:null,busy:'',prog:null,msg:'',zoom:1,adj:{},pl:null,as:null,crop:true,seam:true,all:false,cvs:''};
let host=null;
const fmt=cm=>(cm/100).toFixed(2).replace(/\.00$/,'');
const walls=()=>wallsOf(K.plan,K.map);
const wallNow=()=>walls().find(w=>w.key===F.wall)||null;
const wallH=w=>w&&w.h?w.h:DEFH;
/* שורות לפי המשתמש: assign[0] = שורה 1 = התחתונה. rowsOf מחזיר לפי סדר המשתמש */
const rowsOf=()=>{const R=[];for(let i=0;i<F.rows;i++)R.push((F.assign[i]||[]).filter(id=>F.photos.some(p=>p.id===id)));return R};
const topFirst=()=>rowsOf().map((r,i)=>({r,i})).filter(x=>x.r.length).reverse();/* עליונה ראשונה; i = מספר שורה אצל המשתמש */
/* ---- אחסון ב-IndexedDB (מאגר s3fw, טבלה p): תמונה מוקטנת (מפתח = מספר), תמונה ממוזערת ('t'+מספר), מצב המסך ('meta') ותוצאת הבנייה ('res').
   כך שום דבר לא הולך לאיבוד כשאנדרואיד טוען את האפליקציה מחדש (למשל בזמן שחלון אחר פתוח). בלי IndexedDB – בזיכרון ---- */
let dbp=null;const mem=new Map();
const idb=()=>dbp||(dbp=new Promise((res,rej)=>{try{const q=indexedDB.open('s3fw',1);q.onupgradeneeded=()=>q.result.createObjectStore('p');q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)}catch(e){rej(e)}}));
async function bPut(id,b){try{const d=await idb();await new Promise((res,rej)=>{const t=d.transaction('p','readwrite');t.objectStore('p').put(b,id);t.oncomplete=()=>res();t.onerror=t.onabort=()=>rej(t.error)})}catch(e){mem.set(id,b)}}
async function bGet(id){if(mem.has(id))return mem.get(id);try{const d=await idb();return await new Promise((res,rej)=>{const r=d.transaction('p').objectStore('p').get(id);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}catch(e){return undefined}}
async function bDel(id){mem.delete(id);try{const d=await idb();d.transaction('p','readwrite').objectStore('p').delete(id)}catch(e){}}
async function bClear(){mem.clear();try{const d=await idb();await new Promise(res=>{const t=d.transaction('p','readwrite');t.objectStore('p').clear();t.oncomplete=t.onerror=t.onabort=()=>res()})}catch(e){}}
let metaT=0;
const metaNow=()=>({v:2,photos:F.photos.map(p=>Object.assign({id:p.id,w:p.w,h:p.h,t:p.t},p.cam?{cam:1}:{})),seq:F.seq,wall:F.wall,rows:F.rows,cur:F.cur,assign:F.assign,adj:F.adj,crop:F.crop,seam:F.seam,view:F.view==='res'&&F.res?'res':'edit'});
function saveMeta(){if(!F.ready)return;clearTimeout(metaT);metaT=setTimeout(()=>{bPut('meta',metaNow())},300)}/* לא לפני שהשחזור הסתיים – שלא ידרוס מצב שמור במצב ריק */
const flushMeta=()=>{clearTimeout(metaT);return F.ready?bPut('meta',metaNow()):Promise.resolve()};
/* תוצאת הבנייה: האריחים כ-JPEG + מה שצריך כדי להציג אותה שוב */
function saveRes(){const R=F.res;if(!R)return bDel('res');return bPut('res',{w:R.w,h:R.h,k:R.k,wall:R.wall&&R.wall.key,tiles:R.tiles.map(t=>({blob:t.blob,x:t.x,y:t.y,w:t.w,h:t.h})),info:R.info})}
async function restore(){
 const m=await bGet('meta');if(!m||!Array.isArray(m.photos))return false;
 F.busy='משחזר את העבודה הקודמת…';draw();const ph=[];
 for(const p of m.photos){const th=await bGet('t'+p.id);if(!th&&!(await bGet(p.id)))continue;ph.push({id:p.id,w:p.w,h:p.h,t:p.t||0,cam:p.cam?1:0,url:th?URL.createObjectURL(th):''})}
 Object.assign(F,{photos:ph,seq:Math.max(m.seq|0,...ph.map(p=>p.id),0),wall:m.wall||'',rows:cl(m.rows|0||2,1,6),cur:cl(m.cur|0,0,5),assign:Array.isArray(m.assign)?m.assign:[],adj:m.adj&&typeof m.adj==='object'?m.adj:{},crop:m.crop!==false,seam:m.seam!==false});
 const r=m.view==='res'?await bGet('res'):null;
 if(r&&Array.isArray(r.tiles)&&r.tiles.length&&r.tiles.every(t=>t.blob&&t.blob.size)){F.res={w:r.w,h:r.h,k:r.k,info:r.info||{},wall:walls().find(w=>w.key===r.wall)||wallNow(),tiles:r.tiles.map(t=>Object.assign({},t,{url:URL.createObjectURL(t.blob)}))};F.view='res';F.msg='הקיר שנבנה שוחזר.'}
 F.busy='';return true}
function relRes(){if(F.res){for(const t of F.res.tiles){try{URL.revokeObjectURL(t.url)}catch(e){}}}F.res=null}
/* "חזרה": סוגר את המסך אבל שומר הכול (התמונות, הסימון והקיר שנבנה) – בכניסה הבאה הכול חוזר */
function closeAll(){if(C.el)camClose();if(host)flushMeta();F.ready=false;relRes();for(const p of F.photos){try{URL.revokeObjectURL(p.url)}catch(e){}}F.photos=[];F.assign=[];F.adj={};F.pl=F.as=null;F.view='edit';F.busy='';F.msg='';if(host){host.remove();host=null}document.body.style.overflow=''}
/* "התחלה מחדש": מוחק את התמונות ואת התוצאה מהטלפון */
async function wipe(){relRes();for(const p of F.photos){try{URL.revokeObjectURL(p.url)}catch(e){}}Object.assign(F,{photos:[],assign:[],adj:{},pl:null,as:null,view:'edit',msg:'',seq:0});await bClear();await flushMeta();draw()}
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
   const id=++F.seq;await bPut(id,big);await bPut('t'+id,th);F.photos.push({id,w,h,t:f._t||0,url:URL.createObjectURL(th)})}
  catch(e){skipped++}
  finally{if(d)d.close()}}
 if(skipped)F.msg=(F.msg?F.msg+' ':'')+(skipped===1?'תמונה אחת לא נפתחה ודולגה.':skipped+' תמונות לא נפתחו ודולגו.');
 F.busy='';draw()}
/* ---- OpenCV: נטען רק כשנכנסים למסך (קובץ מקומי באפליקציה, בלי אינטרנט) ---- */
let cvP=null;
function loadCV(){
 if(cvP)return cvP;
 F.cvs='טוען את מנוע החיבור (OpenCV)…';
 cvP=(async()=>{
  if(!window.cv||!window.cv.Mat&&!window.cv.onRuntimeInitialized&&!(window.cv instanceof Promise)){await new Promise((res,rej)=>{const s=document.createElement('script');s.src='opencv/opencv.js';s.async=true;s.onload=res;s.onerror=()=>rej(new Error('cv-load'));document.head.appendChild(s)})}
  const r=await cvReady(window.cv);F.cvs='';draw();return r})();
 cvP.catch(()=>{cvP=null;F.cvs='מנוע החיבור לא נטען. סגרו את המסך ונסו שוב.';draw()});
 return cvP}
/* תמונה אפורה בגודל FEAT (לחיפוש המאפיינים) ובגודל המלא השמור */
/* k0 = הקטנה נוספת כשמערבבים תמונות בגדלים שונים (מצלמה עם עזרה 2400 / גלריה 1600) – כולן באותו קנה מידה, כמו שהחיבור מניח */
const dimK=(d,k0)=>k0>=1?[d.w,d.h]:[Math.max(8,Math.round(d.w*k0)),Math.max(8,Math.round(d.h*k0))];
async function loadGray(id,k0){
 const d=await U.decode(await bGet(id));
 try{const[W,H]=dimK(d,k0||1),k=Math.min(1,FEAT/Math.max(W,H)),w=Math.max(8,Math.round(W*k)),h=Math.max(8,Math.round(H*k)),c=document.createElement('canvas');c.width=w;c.height=h;
  const g=c.getContext('2d',{willReadFrequently:true});g.imageSmoothingQuality='high';g.drawImage(d.src,0,0,w,h);const px=g.getImageData(0,0,w,h).data,o=new Uint8Array(w*h);
  for(let i=0;i<o.length;i++)o[i]=(px[4*i]*77+px[4*i+1]*150+px[4*i+2]*29)>>8;c.width=c.height=1;return{w,h,g:o,W,H}}
 finally{d.close()}}
const lru=[];
async function loadColor(id,k0){
 const i=lru.findIndex(x=>x.id===id);if(i>=0){const x=lru.splice(i,1)[0];lru.push(x);return x.im}
 const d=await U.decode(await bGet(id));
 try{const[W,H]=dimK(d,k0||1),c=document.createElement('canvas');c.width=W;c.height=H;const g=c.getContext('2d',{willReadFrequently:true});if(W!==d.w)g.imageSmoothingQuality='high';g.drawImage(d.src,0,0,W,H);const im={w:W,h:H,data:g.getImageData(0,0,W,H).data};c.width=c.height=1;
  lru.push({id,im});while(lru.length>3)lru.shift();return im}
 finally{d.close()}}
/* בנייה באריחים (כל אריח ≤ TILE×TILE): לכל אריח מיזוג רך של התמונות שנופלות בו (OpenCV), ואז JPEG מיד; "לא צולם" על אזורים ריקים */
async function render(cv){
 const pl=F.pl,fr=pl.fr,V=F.crop?fr.crop:{x0:fr.x0,y0:fr.y0,x1:fr.x1,y1:fr.y1},vw=V.x1-V.x0,vh=V.y1-V.y0;
 const k=Math.min(1,Math.sqrt(MAXA/(vw*vh))),OW=Math.max(8,Math.round(vw*k)),OH=Math.max(8,Math.round(vh*k)),nx=Math.ceil(OW/TILE),ny=Math.ceil(OH/TILE),tiles=[];let n=0;
 const io={color:id=>loadColor(id,pl.kOf?pl.kOf(id):1),gain:id=>pl.gain.get(id)||1};
 for(let ty=0;ty<ny;ty++)for(let tx=0;tx<nx;tx++){
  const X=tx*TILE,Y=ty*TILE,tw=Math.min(TILE,OW-X),th=Math.min(TILE,OH-Y);
  F.busy='בונה את הקיר – אריח '+(++n)+' מתוך '+nx*ny+'…';F.prog=[n-1,nx*ny];draw();await tick();
  const t=await tile(cv,pl,fr,io,V,k,X,Y,tw,th),cvs=document.createElement('canvas');cvs.width=tw;cvs.height=th;const g=cvs.getContext('2d');g.putImageData(new ImageData(t.rgba,tw,th),0,0);
  g.fillStyle='#8a8a95';g.font='bold 28px sans-serif';g.textAlign='center';g.textBaseline='middle';g.direction='rtl';
  for(const q of fr.gaps){const cx=(q.x-V.x0)*k-X,cy=(q.y-V.y0)*k-Y;if(cx>-100&&cx<tw+100&&cy>-20&&cy<th+20)g.fillText('לא צולם',cx,cy)}
  const blob=await U.blobOf(cvs,.9);cvs.width=cvs.height=1;if(!blob||!blob.size)throw new Error('empty');
  tiles.push({blob,url:URL.createObjectURL(blob),x:X,y:Y,w:tw,h:th})}
 lru.length=0;
 return{tiles,w:OW,h:OH,k}}
const STG={feat:'מאתר נקודות מאפיינות בתמונות',match:'מחפש חיבורים בתוך השורות',rows:'מחבר בין השורות',rescue:'מחפש מקום לתמונות שלא חוברו',solve:'מחשב את המיקום של כל תמונה'};
async function doBuild(){
 const w=wallNow(),R=topFirst();if(!w||!R.length||F.busy)return;
 relRes();bDel('res');F.view='edit';F.msg='';F.busy=F.cvs||'טוען את מנוע החיבור…';F.prog=null;draw();
 try{
  const cv=(await loadCV()).cv;
  const rows=R.map(x=>x.r),used=[].concat(...rows),ph=id=>F.photos.find(p=>p.id===id),Lmin=Math.min(...used.map(id=>{const p=ph(id);return p?Math.max(p.w,p.h):1e9})),
   kOf=id=>{const p=ph(id);return p?Math.min(1,Lmin/Math.max(p.w,p.h)):1},manual={};
  for(const key in F.adj){const m=F.adj[key],a=+key.split(':')[0],k0=kOf(a);manual[key]={dx:m.dx*k0,dy:m.dy*k0}}
  /* known = כל התמונות צולמו ב"צלמו עם עזרה" – הסדר בשורה ידוע, לא מחפשים חיבור בסדר הפוך */
  const known=used.every(id=>{const p=ph(id);return p&&p.cam});
  const pl=await plan(cv,rows,{gray:id=>loadGray(id,kOf(id))},{manual,known,tick,onP:(s,d,n)=>{F.prog=[d,n||1];F.busy=(STG[s]||'מעבד')+'… '+(n>1?(d+1)+' מתוך '+n:'');draw()}});
  if(!pl.G.size)throw new Error('none');
  pl.fr=frame(cv,pl,600);pl.gain=gains(pl,pl.sm);pl.kOf=kOf;
  if(F.seam){F.busy='מחפש את התפרים הטובים ביותר בין התמונות…';draw();await tick();try{pl.seam=seams(cv,pl,pl.fr,{gain:id=>pl.gain.get(id)||1})}catch(e){pl.seam=null}}
  pl.sm=null;pl.map=R.map(x=>x.i);F.pl=pl;
  const r=await render(cv);
  F.res=Object.assign(r,{wall:w,info:infoOf(pl)});F.view='res';F.zoom=1;F.busy='';F.prog=null;await saveRes();await flushMeta();draw()}
 catch(e){F.busy='';F.prog=null;F.msg=e&&e.message==='cv-load'?'מנוע החיבור לא נטען.':'החיבור נכשל (ייתכן שהזיכרון בטלפון אזל). נסו פחות תמונות או סגרו אפליקציות אחרות.';draw()}}
/* סיכום לתצוגה (נשמר עם התוצאה): כמה חיבורים, אילו תמונות לא חוברו, ואילו זוגות שכנים בשורה לא חוברו ישירות */
function infoOf(pl){
 const has=(a,b)=>pl.edges.some(e=>e.a===a&&e.b===b||e.a===b&&e.b===a),pairs=[];
 pl.rows.forEach((r,ri)=>{for(let j=0;j+1<r.length;j++)pairs.push({a:r[j],b:r[j+1],row:pl.map[ri],ok:has(r[j],r[j+1]),manual:!!F.adj[r[j]+':'+r[j+1]]})});
 return{unplaced:pl.unplaced.slice(),edges:pl.edges.length,pairs,rows:pl.rows.map(r=>r.slice()),map:pl.map.slice()}}
/* ---- שמירה ושיתוף: JPEG תקין (FF D8 FF, גודל > 0, ניתן לפענוח), שם עם .jpg, ≤16M פיקסלים ---- */
const isJpeg=u=>u&&u.length>3&&u[0]===0xFF&&u[1]===0xD8&&u[2]===0xFF;
async function bytesOk(blob){if(!blob||!blob.size)return null;const u=new Uint8Array(await blob.arrayBuffer());return isJpeg(u)?u:null}
async function finalBlob(){
 const R=F.res;if(!R)return null;
 const sc=Math.min(1,Math.sqrt(16e6/(R.w*R.h)),12000/Math.max(R.w,R.h)),one=sc>=1&&R.tiles.length===1;let blob;R.down=null;
 if(one)blob=R.tiles[0].blob;
 else{const w=Math.max(8,Math.round(R.w*sc)),h=Math.max(8,Math.round(R.h*sc)),c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');g.imageSmoothingQuality='high';g.fillStyle='#2a2a30';g.fillRect(0,0,w,h);
  for(const t of R.tiles){const b=await createImageBitmap(t.blob);g.drawImage(b,Math.floor(t.x*sc),Math.floor(t.y*sc),Math.ceil(t.w*sc)+1,Math.ceil(t.h*sc)+1);b.close()}
  blob=await U.blobOf(c,.9);c.width=c.height=1;if(sc<1)R.down=[w,h]}
 const u=await bytesOk(blob);if(!u)throw new Error('bad-jpeg');
 try{const b=await createImageBitmap(blob);const ok=b.width>0&&b.height>0;b.close();if(!ok)throw 0}catch(e){throw new Error('bad-jpeg')}
 return{blob,u8:u,w:one?R.w:Math.round(R.w*sc),h:one?R.h:Math.round(R.h*sc)}}
const b64=u=>{let s='';for(let i=0;i<u.length;i+=8192)s+=String.fromCharCode.apply(null,u.subarray(i,i+8192));return btoa(s)};
const isNat=()=>{const C=window.Capacitor;return!!(C&&C.isNativePlatform&&C.isNativePlatform())};
/* שמירה לגלריה: בטלפון – ישר לגלריה (Pictures/LargePami) בלי חלון "שמירה בשם", כך שהאפליקציה לא יוצאת לרקע.
   אם זה לא אפשרי (אנדרואיד ישן מ-10 או גרסה ישנה של האפליקציה) – חלון השיתוף, שבו אפשר לבחור "שמירה". במחשב – הורדה. */
async function toGallery(f,name){
 const C=window.Capacitor;
 if(isNat()&&C.Plugins&&C.Plugins.SaveFile){try{await C.Plugins.SaveFile.saveImage({filename:name,mime:'image/jpeg',data:b64(f.u8)});return 'gallery'}catch(e){const m=String(e&&(e.message||e));if(!/unsupported|not implemented|unimplemented/i.test(m))throw e}}
 if(isNat()){await share(f,name);return 'share'}
 const a=document.createElement('a');a.href=URL.createObjectURL(f.blob);a.download=name;document.body.append(a);a.click();setTimeout(()=>{a.remove();URL.revokeObjectURL(a.href)},1500);return 'download'}
async function share(f,name){
 if(typeof saveFile==='function')return saveFile(name,f.u8,'image/jpeg');/* index.html: Filesystem (CACHE) + Share */
 const a=document.createElement('a');a.href=URL.createObjectURL(f.blob);a.download=name;document.body.append(a);a.click();setTimeout(()=>{a.remove();URL.revokeObjectURL(a.href)},1500)}
async function save(mode){
 if(!F.res||F.saving)return;F.saving=1;F.msg='מכין את הקובץ…';draw();
 try{await saveRes();await flushMeta();const f=await finalBlob(),name='LargePami_wall_'+Date.now()+'.jpg',dn=F.res.down?` (הוקטן ל-${f.w}×${f.h} – עד 16 מיליון פיקסלים)`:'';
  if(mode==='share'){await share(f,name);F.msg=''}
  else{const how=await toGallery(f,name);F.msg=how==='gallery'?'✓ נשמר בגלריה, בתיקייה Pictures/LargePami'+dn:how==='share'?'בחרו בחלון השיתוף איפה לשמור'+dn:'הקובץ הורד'+dn}}
 catch(e){F.msg='השמירה נכשלה'+(e&&e.message&&e.message!=='bad-jpeg'?': '+String(e.message).slice(0,80):' (הקובץ לא נוצר תקין)')+'. נסו "שתפו".'}
 finally{F.saving=0;draw()}}

/* ---- "צלמו עם עזרה": מצלמה חיה בתוך המסך (getUserMedia ב-WebView, כמו בצילום 360; ההרשאה CAMERA כבר ב-patch-android.sh, ו-Capacitor מאשר את בקשת המצלמה של הדף).
   רוח רפאים של התמונה הקודמת, פלס מחיישן הכיוון, בדיקת חפיפה חיה (פריים מוקטן, כל ~0.5 שנייה), ושורה/מיקום לכל תמונה (נכנס ישר לסימון).
   כל צילום נשמר מיד ב-IndexedDB, בצלע ארוכה עד CAMMAX (אם לא מצליח – 1600) ---- */
const CAMMAX=2400,OVW=96/* צלע ארוכה של הפריים הקטן לבדיקת החפיפה */;
const C={el:null,phase:'',stream:null,v:null,row:0,ghost:true,lvl:null,lvlT:0,ov:null,tm:0,ovMs:500,busy:0,cache:new Map(),gs:null,stopS:null,onVis:null,onRes:null};
const scrAng=()=>{try{if(screen.orientation&&typeof screen.orientation.angle==='number')return screen.orientation.angle}catch(e){}return typeof window.orientation==='number'?window.orientation:0};
function camErr(e){const n=String(e&&e.name||'');
 if(/NotAllowed|Security|Permission/i.test(n))return'אין הרשאה למצלמה. אשרו מצלמה לאפליקציה בהגדרות הטלפון ונסו שוב.';
 if(/NotFound|DevicesNotFound/i.test(n))return'לא נמצאה מצלמה בטלפון הזה.';
 if(/NotReadable|TrackStart|Abort/i.test(n))return'המצלמה תפוסה על ידי אפליקציה אחרת. סגרו אותה ונסו שוב.';
 return'המצלמה לא נפתחה. נסו שוב, או צלמו בכפתור "צלמו" הרגיל.'}
const cq=s=>C.el&&C.el.querySelector(s);
/* תמונה קודמת לרוח: קנבס עד 640 (נשמר בזיכרון אחרי צילום; לתמונה ישנה – נטען מ-IndexedDB) */
async function ghostSrc(id){if(C.cache.has(id))return C.cache.get(id);const b=await bGet(id);if(!b)return null;const d=await U.decode(b);
 try{const k=Math.min(1,640/Math.max(d.w,d.h)),c=document.createElement('canvas');c.width=Math.max(2,Math.round(d.w*k));c.height=Math.max(2,Math.round(d.h*k));c.getContext('2d').drawImage(d.src,0,0,c.width,c.height);C.cache.set(id,c);if(C.cache.size>4)C.cache.delete(C.cache.keys().next().value);return c}finally{d.close()}}
function grayOf(src,w,h){const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d',{willReadFrequently:true});g.drawImage(src,0,0,w,h);const px=g.getImageData(0,0,w,h).data,o=new Uint8Array(w*h);for(let i=0;i<o.length;i++)o[i]=(px[4*i]*77+px[4*i+1]*150+px[4*i+2]*29)>>8;c.width=c.height=1;return{w,h,g:o}}
const ovSize=()=>{const v=C.v,W=v&&v.videoWidth||4,H=v&&v.videoHeight||3,k=OVW/Math.max(W,H);return[Math.max(8,Math.round(W*k)),Math.max(8,Math.round(H*k))]};
/* הרוח הנוכחית לפי השורה: {id,dir,c (קנבס),s (אפור קטן)} */
async function loadGhost(){const g=ghostOf(rowsOf(),C.row);C.gs=null;C.ov=null;if(g){try{const c=await ghostSrc(g.id);if(c){const[w,h]=ovSize();C.gs=Object.assign(g,{c,s:grayOf(c,w,h)})}}catch(e){C.gs=null}}drawGhost();camUI()}
function fit(){const st=cq('.stg'),vw=cq('.vw'),v=C.v;if(!st||!vw)return;const W=st.clientWidth,H=st.clientHeight,r=v&&v.videoWidth?v.videoWidth/v.videoHeight:3/4;let w=W,h=W/r;if(h>H){h=H;w=H*r}vw.style.width=Math.round(w)+'px';vw.style.height=Math.round(h)+'px';drawGhost()}
function drawGhost(){const c=cq('.gh'),vw=cq('.vw');if(!c||!vw)return;const W=c.width=vw.clientWidth||1,H=c.height=vw.clientHeight||1,g=c.getContext('2d'),G=C.gs;g.clearRect(0,0,W,H);
 if(G&&C.ghost){const s=G.c;g.globalAlpha=.5;if(G.dir==='h')g.drawImage(s,s.width*2/3,0,s.width/3,s.height,0,0,W/3,H);else g.drawImage(s,0,0,s.width,s.height/3,0,H*2/3,W,H/3);g.globalAlpha=1}
 if(G){g.strokeStyle=GOLD;g.lineWidth=2;g.setLineDash([8,6]);g.beginPath();if(G.dir==='h'){g.moveTo(W/3,0);g.lineTo(W/3,H)}else{g.moveTo(0,H*2/3);g.lineTo(W,H*2/3)}g.stroke()}}
function camUI(){if(!C.el||C.phase!=='cam')return;const R=rowsOf(),n=F.rows,last=C.row>=n-1;
 cq('.lb').textContent=shotLabel(R,C.row,n);
 const L=C.lvl&&Date.now()-C.lvlT<2000?C.lvl:null,lv=cq('.lv'),vw=cq('.vw');lv.hidden=!L;if(L){lv.textContent=L.msg;lv.className='lv '+(L.ok?'ok':'bad')}
 vw.classList.toggle('ok',!!L&&L.ok);vw.classList.toggle('bad',!!L&&!L.ok);
 const ov=cq('.ov');ov.hidden=!C.ov;if(C.ov){ov.textContent=C.ov.t;ov.className='ov '+(C.ov.ok?'ok':'bad')}
 const gb=cq('[data-c=ghost]');gb.textContent='תמונה שקופה: '+(C.ghost?'פעיל':'כבוי');gb.setAttribute('aria-pressed',String(C.ghost));gb.disabled=!C.gs;
 cq('[data-c=undo]').disabled=!(R[C.row]||[]).length||!!C.busy;cq('[data-c=shot]').disabled=!!C.busy||!C.v;
 cq('[data-c=next]').textContent=last?'סיימתי – סיום':'סיימתי שורה – לשורה '+(C.row+2);
 cq('.cn').textContent=F.photos.length+' תמונות · '+R.map((r,i)=>'ש'+(i+1)+': '+r.length).join(' · ')}
function camMsg(t){const m=cq('.cm');if(m){m.textContent=t||'';m.hidden=!t}}
function stopStream(){clearInterval(C.tm);C.tm=0;try{C.stream&&C.stream.getTracks().forEach(t=>t.stop())}catch(e){}C.stream=null;if(C.v){try{C.v.srcObject=null}catch(e){}}}
async function startStream(){
 const md=navigator.mediaDevices;if(!md||!md.getUserMedia){camMsg('אין גישה למצלמה בתוך האפליקציה בטלפון הזה. צלמו בכפתור "צלמו" הרגיל.');return false}
 const tries=[{facingMode:{ideal:'environment'},width:{ideal:3840},height:{ideal:2160}},{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},{facingMode:{ideal:'environment'}}];
 let s=null,err=null;for(const v of tries){try{s=await md.getUserMedia({audio:false,video:v});break}catch(e){err=e;if(/NotAllowed|Security|Permission|NotReadable/i.test(String(e&&e.name)))break}}
 if(!s){camMsg(camErr(err));return false}
 if(!C.el||C.phase!=='cam'){s.getTracks().forEach(t=>t.stop());return false}
 C.stream=s;const v=C.v;v.srcObject=s;try{await v.play()}catch(e){}
 for(let i=0;i<80&&!v.videoWidth;i++)await new Promise(r=>setTimeout(r,50));
 if(!v.videoWidth){camMsg('המצלמה לא נפתחה. נסו שוב.');stopStream();return false}
 camMsg('');fit();await loadGhost();
 C.tm=setInterval(ovTick,C.ovMs);return true}
/* בדיקת חפיפה חיה: פריים קטן מול התמונה הקודמת. אם החישוב איטי בטלפון – מרווח ארוך יותר */
let ovC=null;
function ovTick(){const G=C.gs,v=C.v;if(!G||!v||!v.videoWidth||C.busy||document.hidden){if(C.ov){C.ov=null;camUI()}return}
 const[w,h]=ovSize();if(G.s.w!==w||G.s.h!==h)G.s=grayOf(G.c,w,h);
 const t0=performance.now();try{if(!ovC)ovC=document.createElement('canvas');ovC.width=w;ovC.height=h;const x=ovC.getContext('2d',{willReadFrequently:true});x.drawImage(v,0,0,w,h);const px=x.getImageData(0,0,w,h).data,o=new Uint8Array(w*h);for(let i=0;i<o.length;i++)o[i]=(px[4*i]*77+px[4*i+1]*150+px[4*i+2]*29)>>8;
  C.ov=ovMsg(shiftEst(G.s,{w,h,g:o},G.dir),G.dir)}catch(e){C.ov=null}
 const ms=performance.now()-t0;if(ms>150&&C.ovMs<1500){C.ovMs=1500;clearInterval(C.tm);C.tm=setInterval(ovTick,C.ovMs)}camUI()}
async function shoot(){
 const v=C.v;if(C.busy||!v||!v.videoWidth)return;if(F.photos.length>=MAXPH){camMsg('אפשר עד '+MAXPH+' תמונות לקיר.');return}
 C.busy=1;camUI();const fl=cq('.fl');if(fl){fl.classList.remove('on');void fl.offsetWidth;fl.classList.add('on')}
 const W=v.videoWidth,H=v.videoHeight;let c=document.createElement('canvas'),big=null,w=0,h=0;
 try{c.width=W;c.height=H;c.getContext('2d').drawImage(v,0,0,W,H);
  for(const M of[CAMMAX,1600]){const k=Math.min(1,M/Math.max(W,H));w=Math.max(1,Math.round(W*k));h=Math.max(1,Math.round(H*k));let s=c;
   if(k<1){s=document.createElement('canvas');s.width=w;s.height=h;const g=s.getContext('2d');g.imageSmoothingQuality='high';g.drawImage(c,0,0,w,h)}
   try{big=await U.blobOf(s,.9)}catch(e){big=null}if(s!==c)s.width=s.height=1;if(big&&big.size)break;big=null}
  if(!big)throw new Error('enc');
  const k2=Math.min(1,200/Math.max(W,H)),t=document.createElement('canvas');t.width=Math.max(1,Math.round(W*k2));t.height=Math.max(1,Math.round(H*k2));t.getContext('2d').drawImage(c,0,0,t.width,t.height);
  const k3=Math.min(1,640/Math.max(W,H)),gc=document.createElement('canvas');gc.width=Math.max(2,Math.round(W*k3));gc.height=Math.max(2,Math.round(H*k3));gc.getContext('2d').drawImage(c,0,0,gc.width,gc.height);
  const th=await U.blobOf(t,.7);t.width=t.height=1;if(!th)throw new Error('enc');
  const id=++F.seq;await bPut(id,big);await bPut('t'+id,th);
  F.photos.push({id,w,h,t:Date.now(),cam:1,url:URL.createObjectURL(th)});(F.assign[C.row]||(F.assign[C.row]=[])).push(id);F.cur=C.row;
  C.cache.set(id,gc);if(C.cache.size>4)C.cache.delete(C.cache.keys().next().value);await flushMeta();camMsg('')}
 catch(e){camMsg('הצילום לא נשמר (ייתכן שהזיכרון בטלפון מלא). נסו שוב.')}
 finally{c.width=c.height=1;C.busy=0}
 await loadGhost()}
function undoShot(){const r=F.assign[C.row]||[];if(!r.length||C.busy)return;if(!confirm('למחוק את התמונה האחרונה בשורה הזו?'))return;
 const id=r.pop(),p=F.photos.find(x=>x.id===id);if(p){try{URL.revokeObjectURL(p.url)}catch(e){}}F.photos=F.photos.filter(x=>x.id!==id);C.cache.delete(id);bDel(id);bDel('t'+id);flushMeta();loadGhost()}
function camClose(){stopStream();if(C.stopS)C.stopS();C.stopS=null;if(C.onVis)document.removeEventListener('visibilitychange',C.onVis);if(C.onRes)window.removeEventListener('resize',C.onRes);C.onVis=C.onRes=null;
 if(C.el){C.el.remove();C.el=null}C.phase='';C.v=null;C.gs=null;C.ov=null;C.lvl=null;C.cache.clear();if(host){F.msg='';draw()}}
/* שלב א: קיר, מספר שורות ושורת ההתחלה */
function camSetup(){const WL=walls(),R=rowsOf(),n=F.rows;
 cq('.su').innerHTML=`<h2>צילום עם עזרה</h2>
 <ol class="ins"><li>עמדו באותו מרחק מהקיר – כ-1.5–2 מטר.</li><li>החזיקו את הטלפון ישר (המסגרת ירוקה).</li><li>יישרו את המציאות על התמונה השקופה בצד.</li><li>זוזו הצידה בין תמונה לתמונה – לא להסתובב במקום.</li><li>מתחילים משמאל, שורה 1 = למטה.</li></ol>
 ${WL.length?`<label class="tips" for="fwcw">קיר</label><select id="fwcw"><option value="">בחרו קיר…</option>${WL.map(x=>`<option value="${esc(x.key)}"${x.key===F.wall?' selected':''}>${esc(wName(x))} (${fmt(x.len)} מ')</option>`).join('')}</select>`:''}
 <p class="tips">מספר שורות בקיר</p><div class="chips" role="group" aria-label="מספר שורות">${[1,2,3,4,5,6].map(k=>`<button class="b${k===n?' g':''}" data-c="rows" data-n="${k}" aria-pressed="${k===n}">${k}</button>`).join('')}</div>
 <p class="tips">מתחילים בשורה</p><div class="chips" role="group" aria-label="שורת התחלה">${Array.from({length:n},(_,i)=>`<button class="b${i===C.row?' g':''}" data-c="srow" data-n="${i}" aria-pressed="${i===C.row}">${esc(rowName(i,n))} (${R[i].length})</button>`).join('')}</div>
 <div class="rw"><button class="b g" data-c="go">פתחו את המצלמה</button><button class="b" data-c="x">ביטול</button></div>`}
function camOpen(){
 if(C.el||!host||F.busy)return;const R=rowsOf();let r0=R.findIndex(r=>!r.length);if(r0<0)r0=F.rows-1;C.row=cl(r0,0,F.rows-1);C.phase='setup';C.ovMs=500;
 const el=C.el=document.createElement('div');el.className='s3fwc';el.setAttribute('role','dialog');el.setAttribute('aria-label','צילום עם עזרה');
 el.innerHTML=`<div class="su"></div><div class="cam" hidden>
 <div class="top"><b class="lb"></b><button class="b" data-c="done">סיום</button></div>
 <div class="st"><span class="lv" hidden></span><span class="ov" hidden></span></div>
 <div class="stg"><div class="vw"><video playsinline muted autoplay></video><canvas class="gh" aria-hidden="true"></canvas><div class="fl"></div></div></div>
 <p class="tp">באותו מרחק (1.5–2 מ') · טלפון ישר · יישרו על התמונה השקופה · זוזו הצידה, לא להסתובב</p>
 <div class="cm busy" role="alert" hidden></div>
 <div class="bar"><button class="b" data-c="ghost" aria-pressed="true"></button><button class="b" data-c="undo">בטלו אחרונה</button><button class="shot" data-c="shot" aria-label="צלמו"></button><button class="b g" data-c="next"></button></div>
 <p class="cn tips"></p></div>`;
 document.body.append(el);C.v=cq('video');camSetup();
 el.addEventListener('change',e=>{if(e.target.id==='fwcw'){F.wall=e.target.value;saveMeta()}});
 el.addEventListener('click',async e=>{const b=e.target.closest('[data-c]');if(!b||b.disabled)return;const a=b.dataset.c;
  if(a==='x'||a==='done')return camClose();
  if(a==='rows'){F.rows=cl(+b.dataset.n|0,1,6);F.assign.length=Math.min(F.assign.length,F.rows);C.row=Math.min(C.row,F.rows-1);F.cur=Math.min(F.cur,F.rows-1);saveMeta();return camSetup()}
  if(a==='srow'){C.row=cl(+b.dataset.n|0,0,F.rows-1);return camSetup()}
  if(a==='go'){C.phase='cam';cq('.su').hidden=true;cq('.cam').hidden=false;camUI();camMsg('פותח את המצלמה…');
   C.onRes=()=>fit();window.addEventListener('resize',C.onRes);
   C.onVis=()=>{if(C.phase!=='cam')return;if(document.hidden)stopStream();else if(!C.stream)startStream()};document.addEventListener('visibilitychange',C.onVis);
   if(typeof DeviceOrientationEvent!=='undefined'){try{if(typeof DeviceOrientationEvent.requestPermission==='function')DeviceOrientationEvent.requestPermission().catch(()=>{})}catch(_){}
    const h=ev=>{const L=levelOf(ev.beta,ev.gamma,scrAng());if(!L)return;const ch=!C.lvl||C.lvl.msg!==L.msg;C.lvl=L;C.lvlT=Date.now();if(ch||Date.now()-(C.lvlU||0)>1000){C.lvlU=Date.now();camUI()}};
    window.addEventListener('deviceorientation',h);C.stopS=()=>window.removeEventListener('deviceorientation',h)}
   await startStream();return camUI()}
  if(a==='shot')return shoot();
  if(a==='ghost'){C.ghost=!C.ghost;drawGhost();return camUI()}
  if(a==='undo')return undoShot();
  if(a==='next'){if(C.row>=F.rows-1)return camClose();C.row++;F.cur=C.row;saveMeta();return loadGhost()}})}

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
.s3fw .miss{display:flex;align-items:center;gap:8px;border:2px solid #d33;border-radius:10px;padding:6px;margin:6px 0}.s3fw .miss img{width:56px;height:56px;object-fit:cover;border-radius:8px}.s3fw .miss span{flex:1}
.s3fw canvas.adj{display:block;width:100%;background:#111;border-radius:10px;touch-action:none}
.s3fwc{position:fixed;inset:0;z-index:320;background:#0b0b0e;color:#eee;direction:rtl;display:flex;flex-direction:column;overflow:auto}
.s3fwc .su{padding:12px 12px 40px}.s3fwc .su h2{margin:0 0 6px;font-size:1.15rem;color:${GOLD}}.s3fwc .ins{margin:6px 0;padding-inline-start:20px;font-size:.92rem}
.s3fwc .tips{font-size:.85rem;color:#aaa;margin:8px 0 4px}.s3fwc .chips{display:flex;flex-wrap:wrap;gap:6px}
.s3fwc .rw{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.s3fwc .rw>*{flex:1;min-width:120px}
.s3fwc .b{display:inline-flex;align-items:center;justify-content:center;min-height:44px;min-width:44px;padding:0 10px;border-radius:10px;border:2px solid #333;background:#1e1e24;color:#eee;font:inherit;font-weight:700;cursor:pointer;box-sizing:border-box}
.s3fwc .b.g{background:${GOLD};border-color:${GOLD};color:#1b1b1f}.s3fwc .b[disabled]{opacity:.45}
.s3fwc select{min-height:44px;width:100%;font:inherit;background:#1e1e24;color:#eee;border:2px solid #333;border-radius:10px;padding:0 8px;box-sizing:border-box}
.s3fwc .cam{display:flex;flex-direction:column;flex:1;min-height:0;padding:6px 8px calc(6px + env(safe-area-inset-bottom))}.s3fwc .cam[hidden],.s3fwc .su[hidden]{display:none}
.s3fwc .top{display:flex;align-items:center;gap:8px}.s3fwc .top .lb{flex:1;font-size:1.05rem;color:${GOLD}}
.s3fwc .st{display:flex;flex-wrap:wrap;gap:6px;min-height:30px;margin:4px 0}.s3fwc .st span{border-radius:8px;padding:3px 8px;font-size:.88rem;font-weight:700}.s3fwc .st span[hidden]{display:none}
.s3fwc .st .ok{background:#1f5f35;color:#d8ffe4}.s3fwc .st .bad{background:#7a1f1f;color:#ffe0e0}
.s3fwc .stg{flex:1;min-height:160px;display:flex;align-items:center;justify-content:center;overflow:hidden}
.s3fwc .vw{position:relative;background:#000;outline:4px solid #444;outline-offset:-4px;border-radius:6px;overflow:hidden}.s3fwc .vw.ok{outline-color:#3ccf6e}.s3fwc .vw.bad{outline-color:#e03131}
.s3fwc video,.s3fwc canvas.gh{position:absolute;inset:0;width:100%;height:100%;display:block}.s3fwc video{object-fit:fill}
.s3fwc .fl{position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none}.s3fwc .fl.on{animation:s3fwfl .35s ease-out}@keyframes s3fwfl{from{opacity:.8}to{opacity:0}}
.s3fwc .tp{font-size:.8rem;color:#bbb;margin:4px 0;text-align:center}.s3fwc .cn{text-align:center;margin:2px 0}
.s3fwc .cm{padding:6px 8px;border-radius:10px;background:#3a1d1d;margin:4px 0;font-size:.9rem}.s3fwc .cm[hidden]{display:none}
.s3fwc .bar{display:grid;grid-template-columns:1fr 1fr 76px 1fr;gap:6px;align-items:center}.s3fwc .bar .b{font-size:.82rem;line-height:1.15;padding:2px 6px;min-height:48px}
.s3fwc .shot{width:72px;height:72px;border-radius:50%;border:5px solid #fff;background:${GOLD};cursor:pointer;justify-self:center}.s3fwc .shot[disabled]{opacity:.45}`;
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
/* תיקון ידני: B שקופה למחצה מעל A (שתיהן בגובה ADJH), גרירה → הזזה. נשמר ביחידות התמונה המלאה של A */
const ADJH=480;
async function adjImg(id){const d=await U.decode(await bGet(id));try{const k=ADJH/d.h,c=document.createElement('canvas');c.width=Math.max(8,Math.round(d.w*k));c.height=ADJH;c.getContext('2d').drawImage(d.src,0,0,c.width,c.height);return{c,W:d.w,H:d.h}}finally{d.close()}}
async function openAdj(a,b){
 if(F.busy)return;F.busy='פותח את התיקון הידני…';draw();
 try{const A=await adjImg(a),B=await adjImg(b),m=F.adj[a+':'+b],ka=ADJH/A.H;F.as={a,b,A,B,dx:m?Math.round(m.dx*ka):Math.round(A.c.width*.7),dy:m?Math.round(m.dy*ka):0,px:1};F.view='adj'}
 catch(e){F.msg='לא הצלחתי לפתוח את התמונות.'}
 F.busy='';draw()}
function drawAdj(){
 const cv=host&&host.querySelector('#fwadj');if(!cv||!F.as)return;const a=F.as,A=a.A.c,B=a.B.c;
 const x0=Math.min(0,a.dx),y0=Math.min(0,a.dy),x1=Math.max(A.width,a.dx+B.width),y1=Math.max(A.height,a.dy+B.height),sc=Math.min(1.5,(cv.parentNode.clientWidth||320)/(x1-x0)),W=Math.max(1,Math.round((x1-x0)*sc)),H=Math.max(1,Math.round((y1-y0)*sc));
 cv.width=W;cv.height=H;a.px=sc;const g=cv.getContext('2d');g.fillStyle='#111';g.fillRect(0,0,W,H);
 g.drawImage(A,(0-x0)*sc,(0-y0)*sc,A.width*sc,A.height*sc);g.globalAlpha=.5;g.drawImage(B,(a.dx-x0)*sc,(a.dy-y0)*sc,B.width*sc,B.height*sc);g.globalAlpha=1}
function draw(){
 if(!host)return;const w=wallNow(),WL=walls(),R=rowsOf();saveMeta();
 const bz=F.busy?`<div class="busy" role="status">${esc(F.busy)}${F.prog?`<progress max="${F.prog[1]||1}" value="${F.prog[0]||0}"></progress>`:''}</div>`:'';
 if(F.view==='adj'&&F.as){const a=F.as;
  host.querySelector('#fwd').innerHTML=`<h3>חיבור ידני</h3><p class="tips">תמונה ${numOf(a.b)} (שקופה למחצה) מעל תמונה ${numOf(a.a)}. גררו באצבע (או לחצו על החצים) עד שהחלק המשותף מתיישר.</p>
  <canvas class="adj" id="fwadj" aria-label="יישור ידני"></canvas>
  <div class="rw"><button class="b" data-fw="ar" data-x="-4" data-y="0" aria-label="שמאלה">◀</button><button class="b" data-fw="ar" data-x="4" data-y="0" aria-label="ימינה">▶</button><button class="b" data-fw="ar" data-x="0" data-y="-4" aria-label="למעלה">▲</button><button class="b" data-fw="ar" data-x="0" data-y="4" aria-label="למטה">▼</button></div>
  <div class="rw"><button class="b g" data-fw="aok">שמרו ובנו מחדש</button>${F.adj[a.a+':'+a.b]?'<button class="b" data-fw="aauto">חזרה לחיבור אוטומטי</button>':''}<button class="b" data-fw="acx">ביטול</button></div>`;drawAdj();return}
 if(F.view==='res'&&F.res){
  const r=F.res,W=r.wall||w,I=r.info||{},Z=Math.round(F.zoom*100),miss=(I.unplaced||[]).filter(id=>F.photos.some(p=>p.id===id)),bp=(I.pairs||[]).filter(p=>!p.ok),shown=F.all?(I.pairs||[]):bp;
  const nb=id=>{for(const row of I.rows||[]){const j=row.indexOf(id);if(j>=0)return j>0?[row[j-1],id]:row[j+1]!=null?[id,row[j+1]]:null}return null};
  host.querySelector('#fwd').innerHTML=`<h3>הקיר הבנוי</h3>
  <div class="exp">ניסיון – לא נשמר במערכת. התמונה נשארת רק בטלפון, עד שתשמרו אותה בעצמכם.</div>
  <p class="tips">${W?esc(wName(W))+` · אורך ${fmt(W.len)} מ' · גובה ${fmt(wallH(W))} מ'${W.h?'':' (גובה משוער)'} · `:''}תוצאה ${r.w}×${r.h} פיקסלים${r.tiles.length>1?' ב-'+r.tiles.length+' אריחים':''}</p>
  ${bz}${F.msg?`<div class="busy" role="status">${esc(F.msg)}</div>`:''}
  ${miss.map(id=>{const p=F.photos.find(x=>x.id===id),q=nb(id);return`<div class="miss" role="alert">${p&&p.url?`<img src="${p.url}" alt="">`:''}<span>תמונה ${numOf(id)} לא נמצא לה חיבור, והיא לא בקיר.</span>${q?`<button class="b" data-fw="man" data-a="${q[0]}" data-b="${q[1]}">חברו ידנית</button>`:''}</div>`}).join('')}
  <div class="rw"><button class="b" data-fw="zo" aria-label="הקטנה">−</button><button class="b" data-fw="zi" aria-label="הגדלה">+</button><button class="b" data-fw="z1">התאמה למסך</button></div>
  <div class="view" id="fwv"><div class="cv" style="width:${Z}%;aspect-ratio:${r.w}/${r.h}">${r.tiles.map(t=>`<img src="${t.url}" alt="" style="left:${(100*t.x/r.w).toFixed(4)}%;top:${(100*t.y/r.h).toFixed(4)}%;width:${(100*t.w/r.w).toFixed(4)}%;height:${(100*t.h/r.h).toFixed(4)}%">`).join('')}</div></div>
  <p class="tips">אפשר לגלול, לצבוט להגדלה או ללחוץ + ו־−. אזור מסומן "לא צולם" = לא היו שם תמונות.</p>
  <div class="rw"><button class="b${F.crop?' g':''}" data-fw="crop" aria-pressed="${F.crop}">חיתוך שוליים ריקים: ${F.crop?'פעיל':'כבוי'}</button><button class="b${F.seam?' g':''}" data-fw="seam" aria-pressed="${F.seam}">תפר חכם: ${F.seam?'פעיל':'כבוי (מיזוג ממוצע)'}</button></div>
  <h3>חיבורים${bp.length?` – ${bp.length} זוגות שכנים בלי חיבור ישיר`:''}</h3><p class="tips">החיבור אוטומטי. זוג שכנים בלי חיבור ישיר יכול עדיין להיות במקום הנכון דרך תמונות אחרות. אם משהו נראה לא נכון – לחצו על הזוג וחברו ידנית.</p>
  <div class="chips">${shown.map(p=>`<button class="b${p.ok?'':' bad'}" data-fw="man" data-a="${p.a}" data-b="${p.b}">שורה ${p.row+1}: ${numOf(p.a)} ו־${numOf(p.b)} · ${p.manual?'ידני':p.ok?'מחובר':'לא חובר'}</button>`).join('')||'<span class="tips">כל השכנים חוברו.</span>'}</div>
  <div class="rw"><button class="b" data-fw="all">${F.all?'הסתר זוגות מחוברים':'הצג את כל הזוגות ('+(I.pairs||[]).length+')'}</button></div>
  <div class="rw"><button class="b g" data-fw="dl" ${F.saving?'disabled':''}>שמרו לגלריה</button><button class="b g" data-fw="sh" ${F.saving?'disabled':''}>שתפו (וואטסאפ וכו')</button></div>
  <div class="rw"><button class="b" data-fw="back">חזרה לסימון</button></div>`;return}
 const nUsed=new Set(R.flat()).size;
 const h=`<h3>1. התמונות</h3>
 <div class="rw"><button class="b g" data-fw="cam" ${F.busy?'disabled':''}>צלמו</button><button class="b" data-fw="gal" ${F.busy?'disabled':''}>בחרו מהגלריה</button></div>
 <div class="rw"><button class="b g" data-fw="acam" ${F.busy?'disabled':''}>צלמו עם עזרה (תמונה שקופה, פלס ושורות)</button></div>
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
 <p class="tips">המערכת מוצאת לבד את החלק המשותף בין התמונות (גם בין השורות) ומחברת. תמונה שלא נמצא לה חיבור תסומן, ואפשר לחבר אותה ידנית.</p>
 ${F.cvs?`<div class="busy" role="status">${esc(F.cvs)}</div>`:''}
 <div class="rw"><button class="b g" data-fw="build" ${!w||!nUsed||F.busy?'disabled':''}>בנו את הקיר</button></div>
 ${!w?'<p class="tips">בחרו קיר כדי להמשיך.</p>':!nUsed?'<p class="tips">סמנו לפחות תמונה אחת לשורה.</p>':''}
 ${F.photos.length?`<div class="rw"><button class="b bad" data-fw="wipe" ${F.busy?'disabled':''}>התחלה מחדש (מחיקת התמונות מהמסך הזה)</button></div>`:''}`;
 host.querySelector('#fwd').innerHTML=h}

async function open(){
 if(host)return;
 host=document.createElement('div');host.className='s3fw';host.setAttribute('role','dialog');host.setAttribute('aria-label','צילום חופשי של קיר');
 host.innerHTML=`<div class="rw" style="margin-top:0"><button class="b" data-fw="close">חזרה</button></div>
 <h2>צילום חופשי של קיר (ניסיון)</h2>
 <div class="exp">ניסיון – לא נשמר במערכת ולא נשלח לשרת. הכול נשאר בטלפון, גם אם יוצאים מהמסך.</div>
 <ol><li>צלמו או בחרו מהגלריה את תמונות הקיר.</li><li>בחרו קיר (במפה) ומספר שורות.</li><li>לכל שורה סמנו את התמונות משמאל לימין (שורה 1 = למטה).</li><li>לחצו "בנו את הקיר".</li></ol>
 <p class="tips"><b>איך מצלמים:</b> עמדו תמיד באותו מרחק מהקיר, החזיקו את הטלפון ישר (לא מוטה למטה או למעלה), וזוזו הצידה בין תמונה לתמונה כך שכשליש מכל תמונה יופיע גם בתמונה הבאה. בין השורות – גם חפיפה של כשליש.</p>
 <div id="fwd"></div>
 <input type="file" accept="image/*" capture="environment" id="fwcam" hidden><input type="file" accept="image/*" multiple id="fwgal" hidden>`;
 document.body.append(host);document.body.style.overflow='hidden';
 host.addEventListener('change',e=>{const i=e.target;if(i&&(i.id==='fwcam'||i.id==='fwgal')){const L=[...i.files];i.value='';addFiles(L)}else if(i&&i.id==='fwwall'){F.wall=i.value;draw()}});
 let drag=null;
 host.addEventListener('pointerdown',e=>{if(e.target.id==='fwadj'&&F.as){drag={x:e.clientX,y:e.clientY,dx:F.as.dx,dy:F.as.dy};try{e.target.setPointerCapture(e.pointerId)}catch(_){}}});
 host.addEventListener('pointermove',e=>{if(drag&&F.as){F.as.dx=Math.round(drag.dx+(e.clientX-drag.x)/F.as.px);F.as.dy=Math.round(drag.dy+(e.clientY-drag.y)/F.as.px);drawAdj()}});
 host.addEventListener('pointerup',()=>{drag=null});
 host.addEventListener('click',e=>{const b=e.target.closest('[data-fw]');if(!b||b.disabled)return;const a=b.dataset.fw,id=+b.dataset.id;
  if(a==='close')return closeAll();
  if(a==='cam')return host.querySelector('#fwcam').click();
  if(a==='gal')return host.querySelector('#fwgal').click();
  if(a==='acam')return camOpen();
  if(a==='wall'){F.wall=b.dataset.key}
  else if(a==='del'){const p=F.photos.find(x=>x.id===id);if(p){try{URL.revokeObjectURL(p.url)}catch(e){}}F.photos=F.photos.filter(x=>x.id!==id);F.assign=F.assign.map(r=>(r||[]).filter(x=>x!==id));bDel(id);bDel('t'+id)}
  else if(a==='mv'){const i=F.photos.findIndex(x=>x.id===id),j=i+(+b.dataset.d);if(i>=0&&j>=0&&j<F.photos.length){const t=F.photos[i];F.photos[i]=F.photos[j];F.photos[j]=t}}
  else if(a==='rows'){F.rows=cl(+b.dataset.n|0,1,6);F.cur=Math.min(F.cur,F.rows-1);F.assign.length=Math.min(F.assign.length,F.rows)}
  else if(a==='row')F.cur=cl(+b.dataset.n|0,0,F.rows-1);
  else if(a==='pick'){const r=F.assign[F.cur]||(F.assign[F.cur]=[]),k=r.indexOf(id);if(k>=0)r.splice(k,1);else{for(let i=0;i<F.assign.length;i++){const q=(F.assign[i]||[]).indexOf(id);if(q>=0)F.assign[i].splice(q,1)}r.push(id)}}
  else if(a==='build')return doBuild();
  else if(a==='wipe'){if(confirm('למחוק את כל התמונות ואת הקיר שנבנה מהמסך הזה? (התמונות בגלריה של הטלפון לא נמחקות)'))wipe();return}
  else if(a==='back'){F.view='edit';F.msg=''}
  else if(a==='zi')F.zoom=Math.min(12,F.zoom*1.5);else if(a==='zo')F.zoom=Math.max(1,F.zoom/1.5);else if(a==='z1')F.zoom=1;
  else if(a==='dl')return save('dl');else if(a==='sh')return save('share');
  else if(a==='tsort'){F.msg=sortByTime()?'התמונות סודרו לפי זמן הצילום (המספור התעדכן). אם כבר סימנתם שורות – בדקו שהסימון עדיין נכון.':'אין בתמונות מידע על זמן הצילום.'}
  else if(a==='crop'){F.crop=!F.crop;return doBuild()}else if(a==='seam'){F.seam=!F.seam;return doBuild()}else if(a==='all')F.all=!F.all;
  else if(a==='man')return openAdj(+b.dataset.a,+b.dataset.b);
  else if(a==='ar'&&F.as){F.as.dx+=+b.dataset.x;F.as.dy+=+b.dataset.y}
  else if(a==='aok'&&F.as){const s=F.as,k=s.A.H/ADJH;F.adj[s.a+':'+s.b]={dx:Math.round(s.dx*k),dy:Math.round(s.dy*k)};F.as=null;F.view='edit';return doBuild()}
  else if(a==='aauto'&&F.as){delete F.adj[F.as.a+':'+F.as.b];F.as=null;F.view='edit';return doBuild()}
  else if(a==='acx'){F.as=null;F.view=F.res?'res':'edit'}
  draw()});
 F.ready=false;draw();loadCV().catch(()=>{});
 try{await restore()}catch(e){F.busy=''}
 F.ready=true;draw()}
ACT.s3ffOpen=()=>open();
API.finalBlob=finalBlob;API.state=()=>F;
})(typeof window!=='undefined'?window:this);
