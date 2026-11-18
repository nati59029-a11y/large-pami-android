/* ניסוי "צילום חופשי של קיר" (אב-טיפוס, בטלפון בלבד): כמה תמונות, סימון לאיזו שורה של הקיר כל תמונה שייכת, וחיבור לתמונה אחת.
   כלום לא נשלח לשרת ולא נשמר כחזית – הכול בזיכרון הטלפון. נטען אחרי store3d-setupcap.js ו-store3d-warp.js.
   זיהוי חפיפה אוטומטי: לכל שתי תמונות שכנות בשורה (ולכל שתי שורות שכנות) מחפשים את ההזזה שבה החלק המשותף הכי דומה
   (התאמה מנורמלת NCC על תמונה אפורה מוקטנת אחרי סינון גבוה – עמידה בהבדלי תאורה), גס ואז עדין. ביטחון נמוך = "לא בטוח" וחלוקה לפי מחוון החפיפה.
   החלק הראשון (S3FreeWall: wallsOf, estimate, layout) הוא קוד טהור (בלי DOM) ורץ גם בבדיקות Node. החלק השני הוא המסך.
   מוסכמות: בקוד הטהור rows[0] = השורה העליונה בקיר. במסך שורה 1 = התחתונה (ליד הרצפה) והמסך הופך את הסדר לפני החיבור. בכל שורה התמונה הראשונה = הכי שמאלית. */
(function(root){
'use strict';
const MAXPH=40,HE=360/* גובה כל תמונה לזיהוי החפיפה */,DEFH=300,OKT=.4/* סף ביטחון (NCC) */,OUT=2048;
const cl=(v,a,b)=>v<a?a:v>b?b:v;
const tick=()=>new Promise(r=>setTimeout(r,0));
/* קירות המפה: פריטי k==='w' מקובצים לפי חדר+צלע. אורך = סכום אורכי הקטעים (ס"מ), גובה = גובה התקרה של החדר אם קיים */
function wallsOf(plan,map){
 const by=new Map(),out=[];
 for(const it of (plan&&plan.items)||[]){if(!it||it.k!=='w'||!Array.isArray(it.geo)||it.geo.length<4)continue;
  const key=it.room+'|'+it.edge;let g=by.get(key);
  if(!g){const rm=((map&&map.rooms)||[]).find(r=>r&&r.id===it.room);g={key,room:it.room,edge:it.edge,name:rm&&rm.name?String(rm.name).slice(0,30):'',len:0,h:rm&&Number.isFinite(rm.h)&&rm.h>=200?rm.h:0};by.set(key,g);out.push(g)}
  g.len+=Math.hypot(it.geo[2]-it.geo[0],it.geo[3]-it.geo[1])}
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
/* NCC על אזור החפיפה של A ו-B כש-B מוזזת ב-(dx,dy) ביחס ל-A. -2 = אין מספיק חפיפה, 0 = אין מרקם */
function ncc(A,B,dx,dy,st,minN){
 const x0=Math.max(0,dx),x1=Math.min(A.w,dx+B.w),y0=Math.max(0,dy),y1=Math.min(A.h,dy+B.h);
 if(x1-x0<4||y1-y0<4)return -2;
 let n=0,sa=0,sb=0,saa=0,sbb=0,sab=0;const ad=A.d,bd=B.d;
 for(let y=y0;y<y1;y+=st){const ia=y*A.w,ib=(y-dy)*B.w-dx;for(let x=x0;x<x1;x+=st){const a=ad[ia+x],b=bd[ib+x];n++;sa+=a;sb+=b;saa+=a*a;sbb+=b*b;sab+=a*b}}
 if(n<minN)return -2;
 const va=saa-sa*sa/n,vb=sbb-sb*sb/n;if(va<.3*n||vb<.3*n)return 0;
 return(sab-sa*sb/n)/Math.sqrt(va*vb)}
/* חיפוש הזזה (dx,dy) של B ביחס ל-A בטווח r={x0,x1,y0,y1} (פיקסלים בגודל המלא). גס (רבע) ← בינוני ← עדין */
function findShift(A,B,r){
 const a2=lv(A,2),b2=lv(B,2),cx0=Math.floor(r.x0/4),cx1=Math.ceil(r.x1/4),cy0=Math.floor(r.y0/4),cy1=Math.ceil(r.y1/4),nx=cx1-cx0+1,ny=cy1-cy0+1;
 const st=a2.w>400?2:1,G=new Float32Array(Math.max(1,nx*ny)).fill(-2);let best=-3,bx=cx0,by=cy0;
 for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){const v=ncc(a2,b2,cx0+i,cy0+j,st,120);G[j*nx+i]=v;if(v>best){best=v;bx=cx0+i;by=cy0+j}}
 let second=-3;for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){if(Math.abs(cx0+i-bx)<=2&&Math.abs(cy0+j-by)<=2)continue;if(G[j*nx+i]>second)second=G[j*nx+i]}
 if(best<=-2)return{dx:Math.round((r.x0+r.x1)/2),dy:Math.round((r.y0+r.y1)/2),score:0,ok:false};
 let cx=bx*2,cy=by*2,s1=-3;const a1=lv(A,1),b1=lv(B,1);
 for(let dy=cy-3;dy<=cy+3;dy++)for(let dx=cx-3;dx<=cx+3;dx++){const v=ncc(a1,b1,dx,dy,1,300);if(v>s1){s1=v;cx=dx;cy=dy}}
 let fx=cx*2,fy=cy*2,s0=-3;const a0=lv(A,0),b0=lv(B,0);
 for(let dy=fy-3;dy<=fy+3;dy++)for(let dx=fx-3;dx<=fx+3;dx++){const v=ncc(a0,b0,dx,dy,2,600);if(v>s0){s0=v;fx=dx;fy=dy}}
 let conf=Math.max(0,s0);if(best-second<.04&&best<.85)conf*=.75;/* שתי התאמות כמעט שוות (מוצרים חוזרים) = פחות בטוח */
 return{dx:fx,dy:fy,score:+conf.toFixed(3),ok:conf>=OKT}}
const shiftOf=(p,fb,adj)=>{const a=adj&&adj[p.key];return a?{dx:a.dx,dy:a.dy,ok:true,manual:true}:p.ok?{dx:p.dx,dy:p.dy,ok:true}:{dx:fb.dx,dy:fb.dy,ok:false}};
/* מיקום תמונות שורה (יחסית לפינת הרצועה) */
function place(row,G,hs,ov,adj){
 let x=0,y=0;const P=[],S=[];
 row.forEach((id,j)=>{const g=G.get(id);if(j>0){const a=G.get(row[j-1]),s=shiftOf(hs[j-1],{dx:Math.round(a.w*(1-ov)),dy:0},adj);x+=s.dx;y+=s.dy;S.push(s)}P.push({id,x,y,w:g.w,h:g.h})});
 let mx=1e9,my=1e9,W=0,H=0;for(const p of P){mx=Math.min(mx,p.x);my=Math.min(my,p.y)}
 for(const p of P){p.x-=mx;p.y-=my;W=Math.max(W,p.x+p.w);H=Math.max(H,p.y+p.h)}
 return{P,S,W,H}}
function strip(pl,G){const d=new Uint8Array(pl.W*pl.H).fill(128);
 for(const p of pl.P){const g=G.get(p.id).g;for(let y=0;y<p.h;y++)d.set(g.subarray(y*p.w,(y+1)*p.w),(p.y+y)*pl.W+p.x)}
 return{w:pl.W,h:pl.H,g:d}}
/* rows: [[id,...]] (עליונה ראשונה, כל שורה משמאל לימין); load(id) → {w,h,g} אפור בגובה HE.
   o: {ov (0–.4, לחיבור לא בטוח), adj:{key:{dx,dy}}, grays:Map, cache:{}, onP(done,total)}. מחזיר {h:[[pair]],v:[pair],grays} */
async function estimate(rows,load,o){
 o=o||{};const G=o.grays||new Map(),adj=o.adj||{},ov=o.ov==null?.2:o.ov,cache=o.cache||{};rows=rows.filter(r=>r.length);
 const ids=[].concat(...rows).filter(id=>!G.has(id)),total=ids.length+rows.reduce((s,r)=>s+r.length-1,0)+Math.max(0,rows.length-1);let done=0;const prog=()=>o.onP&&o.onP(done,total);
 prog();for(const id of ids){G.set(id,await load(id));done++;prog();await tick()}
 const hs=[];
 for(const row of rows){const arr=[];
  for(let j=1;j<row.length;j++){const a=G.get(row[j-1]),b=G.get(row[j]),key='h:'+row[j-1]+':'+row[j];let p=cache['H'+key];
   if(!p){p=Object.assign(findShift(a,b,{x0:Math.round(.3*a.w),x1:Math.round(.95*a.w),y0:-Math.round(.1*a.h),y1:Math.round(.1*a.h)}),{key});cache['H'+key]=p;await tick()}
   done++;prog();arr.push(p)}
  hs.push(arr)}
 const pls=rows.map((row,r)=>place(row,G,hs[r],ov,adj)),v=[];
 for(let r=0;r<rows.length-1;r++){
  const key='v:'+rows[r][0]+':'+rows[r+1][0],ck='V'+rows[r].join(',')+'/'+rows[r+1].join(',')+'|'+ov+'|'+pls[r].S.concat(pls[r+1].S).map(s=>s.dx+','+s.dy).join(';');let p=cache[ck];
  if(!p){const A=strip(pls[r],G),B=strip(pls[r+1],G),aw=pls[r].P.concat(pls[r+1].P).reduce((s,q)=>s+q.w,0)/(pls[r].P.length+pls[r+1].P.length);
   p=findShift(A,B,{x0:-Math.round(.12*aw),x1:Math.round(.12*aw),y0:Math.round(.3*A.h),y1:Math.round(.95*A.h)});cache[ck]=p;await tick()}
  done++;prog();v.push(Object.assign({},p,{key}))}
 return{h:hs,v,grays:G}}
/* פריסה סופית: מיקום כל תמונה (יחידות HE), תפרים, וחיתוך כל תמונה באמצע אזור החפיפה עם שכנותיה */
function layout(rows,G,est,o){
 o=o||{};rows=rows.filter(r=>r.length);const adj=o.adj||{},ov=o.ov==null?.2:o.ov;
 const pls=rows.map((row,r)=>place(row,G,est.h[r],ov,adj)),off=[{x:0,y:0}],seams=[];
 pls.forEach((pl,r)=>pl.S.forEach((s,j)=>seams.push({key:est.h[r][j].key,t:'h',r,j,dx:s.dx,dy:s.dy,ok:s.ok,manual:!!s.manual,score:est.h[r][j].score,a:rows[r][j],b:rows[r][j+1]})));
 for(let r=1;r<rows.length;r++){const s=shiftOf(est.v[r-1],{dx:0,dy:Math.round(pls[r-1].H*(1-ov))},adj);off.push({x:off[r-1].x+s.dx,y:off[r-1].y+s.dy});
  seams.push({key:est.v[r-1].key,t:'v',r:r-1,dx:s.dx,dy:s.dy,ok:s.ok,manual:!!s.manual,score:est.v[r-1].score,a:rows[r-1][0],b:rows[r][0]})}
 let mx=1e9,my=1e9,W=0,H=0;const R=pls.map((pl,r)=>pl.P.map(p=>({id:p.id,x:p.x+off[r].x,y:p.y+off[r].y,w:p.w,h:p.h})));
 for(const row of R)for(const p of row){mx=Math.min(mx,p.x);my=Math.min(my,p.y)}
 for(const row of R)for(const p of row){p.x-=mx;p.y-=my;W=Math.max(W,p.x+p.w);H=Math.max(H,p.y+p.h)}
 const top=R.map(row=>Math.min(...row.map(p=>p.y))),bot=R.map(row=>Math.max(...row.map(p=>p.y+p.h))),mid=(a,b)=>b>a?(a+b)/2:a;
 const clips=new Map();
 R.forEach((row,r)=>row.forEach((p,j)=>{
  const pe=j>0?row[j-1].x+row[j-1].w:0,ns=j<row.length-1?row[j+1].x:0;
  const cx0=j>0?(p.x<pe?(p.x+pe)/2:p.x):p.x,cx1=j<row.length-1?(ns<p.x+p.w?(ns+p.x+p.w)/2:p.x+p.w):p.x+p.w;
  const cy0=r>0?Math.max(p.y,top[r]<bot[r-1]?(top[r]+bot[r-1])/2:top[r]):p.y,cy1=r<R.length-1?Math.min(p.y+p.h,top[r+1]<bot[r]?(top[r+1]+bot[r])/2:bot[r]):p.y+p.h;
  clips.set(p.id,{x:p.x,y:p.y,w:p.w,h:p.h,cx0,cx1,cy0,cy1,fl:j>0,fr:j<row.length-1,ft:r>0,fb:r<R.length-1})}));
 return{rows:R,pls,seams,W,H,clips}}
const API={wallsOf,estimate,layout,findShift,place,strip,MAXPH,HE,DEFH,OKT,OUT};
if(typeof module!=='undefined'&&module.exports)module.exports=API;else root.S3FreeWall=API;
if(typeof window==='undefined'||!window.S3UI||typeof ACT==='undefined'||!window.S3UI.K3)return;

/* ---------- המסך ---------- */
const U=window.S3UI,esc=U.esc2,K=U.K3,GOLD='#d4a017';
const F={photos:[],seq:0,wall:'',rows:2,cur:0,ov:20,assign:[],view:'edit',res:null,busy:'',prog:null,msg:'',zoom:1,gray:new Map(),cache:{},adj:{},est:null,lay:null,as:null};
let host=null;
const fmt=cm=>(cm/100).toFixed(2).replace(/\.00$/,'');
const walls=()=>wallsOf(K.plan,K.map);
const wallNow=()=>walls().find(w=>w.key===F.wall)||null;
const wallH=w=>w&&w.h?w.h:DEFH;
/* שורות לפי המשתמש: assign[0] = שורה 1 = התחתונה. rowsOf מחזיר לפי סדר המשתמש */
const rowsOf=()=>{const R=[];for(let i=0;i<F.rows;i++)R.push((F.assign[i]||[]).filter(id=>F.photos.some(p=>p.id===id)));return R};
const topFirst=()=>rowsOf().map((r,i)=>({r,i})).filter(x=>x.r.length).reverse();/* עליונה ראשונה; i = מספר שורה אצל המשתמש */
function relUrl(){if(F.res&&F.res.url){try{URL.revokeObjectURL(F.res.url)}catch(e){}}F.res=null}
function closeAll(){relUrl();for(const p of F.photos){try{URL.revokeObjectURL(p.url)}catch(e){}}F.photos=[];F.assign=[];F.gray=new Map();F.cache={};F.adj={};F.est=F.lay=F.as=null;F.view='edit';F.busy='';F.msg='';if(host){host.remove();host=null}document.body.style.overflow=''}
const tag=id=>{for(let i=0;i<F.rows;i++){const k=(F.assign[i]||[]).indexOf(id);if(k>=0)return`ש${i+1}·${k+1}`}return''};
const numOf=id=>F.photos.findIndex(p=>p.id===id)+1;
const resetEst=()=>{F.est=F.lay=null;F.cache={};F.adj={}};

async function addFiles(files){
 const L=[...files].filter(f=>f&&/^image\//.test(f.type||'image/'));if(!L.length)return;
 F.msg='';
 for(const f of L){
  if(F.photos.length>=MAXPH){F.msg='אפשר עד '+MAXPH+' תמונות. התמונות הנוספות לא נוספו.';break}
  F.busy='מכין תמונה '+(F.photos.length+1)+'…';draw();
  let d=null;
  try{d=await U.decode(f);/* U.decode מכבד כיוון EXIF (תמונה לאורך/לרוחב) */
   const k=Math.min(1,200/Math.max(d.w,d.h)),c=document.createElement('canvas');c.width=Math.max(1,Math.round(d.w*k));c.height=Math.max(1,Math.round(d.h*k));c.getContext('2d').drawImage(d.src,0,0,c.width,c.height);
   const b=await U.blobOf(c,.7);if(!b)throw new Error('x');F.photos.push({id:++F.seq,file:f,w:d.w,h:d.h,url:URL.createObjectURL(b)})}
  catch(e){F.msg='אחת התמונות לא נפתחה ודולגה.'}
  finally{if(d)d.close()}}
 F.busy='';draw()}
/* תמונה אפורה בגובה HE (כל התמונות מנורמלות לאותו גובה) */
async function loadGray(id){
 const p=F.photos.find(x=>x.id===id),d=await U.decode(p.file);
 try{const h=HE,w=cl(Math.round(d.w*HE/d.h),64,900),c=document.createElement('canvas');c.width=w;c.height=h;
  const g=c.getContext('2d',{willReadFrequently:true});g.imageSmoothingQuality='high';g.drawImage(d.src,0,0,w,h);const px=g.getImageData(0,0,w,h).data,o=new Uint8Array(w*h);
  for(let i=0;i<o.length;i++)o[i]=(px[4*i]*77+px[4*i+1]*150+px[4*i+2]*29)>>8;c.width=c.height=1;return{w,h,g:o}}
 finally{d.close()}}
/* תמונה מפוענחת אחת בכל פעם, מוקטנת לצלע ארוכה ~1600 */
async function loadColor(id){
 const p=F.photos.find(x=>x.id===id),d=await U.decode(p.file);
 try{const k=Math.min(1,1600/Math.max(d.w,d.h)),c=document.createElement('canvas');c.width=Math.max(1,Math.round(d.w*k));c.height=Math.max(1,Math.round(d.h*k));
  const g=c.getContext('2d');g.imageSmoothingQuality='high';g.drawImage(d.src,0,0,c.width,c.height);return c}
 finally{d.close()}}
const optOf=()=>({ov:F.ov/100,adj:F.adj,grays:F.gray,cache:F.cache});
const rowsIds=()=>topFirst().map(x=>x.r);
async function render(){
 const w=wallNow(),L=F.lay,A=w.len/wallH(w);let k=OUT/Math.max(L.W,L.H),kx=k,ky=k;const An=L.W/L.H;
 if(Math.abs(An/A-1)<=.25)ky=k*An/A;/* יחס קרוב ליחס הקיר במפה – מותחים קלות ליחס הקיר; אחרת נשאר היחס מהתמונות */
 const OW=Math.max(8,Math.round(L.W*kx)),OH=Math.max(8,Math.round(L.H*ky)),out=document.createElement('canvas');out.width=OW;out.height=OH;
 const g=out.getContext('2d');g.fillStyle='#28282e';g.fillRect(0,0,OW,OH);
 const e=Math.max(3,Math.round(OW*.006));let i=0;const ids=[...L.clips.keys()];
 for(const id of ids){
  F.busy='מרכיב תמונה '+(++i)+' מתוך '+ids.length+'…';F.prog=[i-1,ids.length];draw();await tick();
  const c=L.clips.get(id),src=await loadColor(id);
  const ex0=Math.max(c.x,c.cx0-(c.fl?e/kx:0)),ex1=Math.min(c.x+c.w,c.cx1+(c.fr?e/kx:0)),ey0=Math.max(c.y,c.cy0-(c.ft?e/ky:0)),ey1=Math.min(c.y+c.h,c.cy1+(c.fb?e/ky:0));
  const tw=Math.max(1,Math.round((ex1-ex0)*kx)),th=Math.max(1,Math.round((ey1-ey0)*ky)),t=document.createElement('canvas');t.width=tw;t.height=th;const tg=t.getContext('2d');tg.imageSmoothingQuality='high';
  tg.drawImage(src,(ex0-c.x)/c.w*src.width,(ey0-c.y)/c.h*src.height,(ex1-ex0)/c.w*src.width,(ey1-ey0)/c.h*src.height,0,0,tw,th);src.width=src.height=1;
  const ramp=(horiz)=>{const n=horiz?tw:th,f=Math.min(.5,2*e/n),a=horiz?c.fl:c.ft,b=horiz?c.fr:c.fb;if(!a&&!b)return;
   const gr=horiz?tg.createLinearGradient(0,0,tw,0):tg.createLinearGradient(0,0,0,th);
   gr.addColorStop(0,a?'rgba(0,0,0,0)':'#000');gr.addColorStop(a?f:0,'#000');gr.addColorStop(b?1-f:1,'#000');gr.addColorStop(1,b?'rgba(0,0,0,0)':'#000');
   tg.globalCompositeOperation='destination-in';tg.fillStyle=gr;tg.fillRect(0,0,tw,th);tg.globalCompositeOperation='source-over'};
  ramp(true);ramp(false);
  g.drawImage(t,Math.round((ex0)*kx),Math.round((ey0)*ky));t.width=t.height=1}
 const b=await U.blobOf(out,.9);out.width=out.height=1;if(!b)throw new Error('x');
 return{blob:b,url:URL.createObjectURL(b),w:OW,h:OH}}
async function doBuild(){
 const w=wallNow(),R=topFirst();if(!w||!R.length||F.busy)return;
 relUrl();F.view='edit';F.msg='';F.busy='מחפש חפיפה בין התמונות…';F.prog=[0,1];draw();
 try{
  await new Promise(r=>setTimeout(r,30));
  const rows=R.map(x=>x.r),o=optOf();o.onP=(d,n)=>{F.prog=[d,n];F.busy='מחפש חפיפה… '+d+' מתוך '+n;draw()};
  F.est=await estimate(rows,loadGray,o);
  F.lay=layout(rows,F.gray,F.est,o);F.lay.map=R.map(x=>x.i);
  const r=await render();F.res=Object.assign(r,{wall:w});F.view='res';F.zoom=1;F.busy='';F.prog=null;draw()}
 catch(e){F.busy='';F.prog=null;F.msg='החיבור נכשל (ייתכן שהזיכרון בטלפון אזל). נסו פחות תמונות או סגרו אפליקציות אחרות.';draw()}}
/* בנייה מחדש אחרי תיקון ידני – בלי חיפוש חדש (הזוגות נשמרו) */
async function rebuild(){
 if(F.busy)return;relUrl();F.view='edit';F.busy='מרכיב מחדש…';F.prog=[0,1];draw();
 try{const R=topFirst(),rows=R.map(x=>x.r),o=optOf();F.est=await estimate(rows,loadGray,o);F.lay=layout(rows,F.gray,F.est,o);F.lay.map=R.map(x=>x.i);
  F.res=Object.assign(await render(),{wall:wallNow()});F.view='res';F.busy='';F.prog=null;draw()}
 catch(e){F.busy='';F.prog=null;F.msg='הבנייה מחדש נכשלה.';draw()}}
async function save(mode){
 if(!F.res)return;const nm='LargePami_wall_'+Date.now()+'.jpg';
 try{const u8=new Uint8Array(await F.res.blob.arrayBuffer());
  if(typeof outSave==='function')await outSave({name:nm,data:u8,mime:'image/jpeg'},mode);
  else{const a=document.createElement('a');a.href=URL.createObjectURL(F.res.blob);a.download=nm;document.body.append(a);a.click();setTimeout(()=>{a.remove();URL.revokeObjectURL(a.href)},1500)}}
 catch(e){F.msg='השמירה נכשלה.';draw()}}

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
.s3fw .view{overflow:auto;border:1px solid var(--line);border-radius:10px;margin:8px 0;max-height:70vh;touch-action:pan-x pan-y pinch-zoom}.s3fw .view img{display:block;max-width:none}
.s3fw canvas.adj{display:block;width:100%;background:#111;border-radius:10px;touch-action:none}.s3fw input[type=range]{width:100%;min-height:44px}`;
document.head.appendChild(CSS);

const seamName=s=>s.t==='h'?`שורה ${F.lay.map[s.r]+1}: תמונה ${numOf(s.a)} ו־${numOf(s.b)}`:`בין שורה ${F.lay.map[s.r+1]+1} לשורה ${F.lay.map[s.r]+1}`;
function drawAdj(){
 const cv=host&&host.querySelector('#fwadj');if(!cv||!F.as)return;const a=F.as,A=a.A,B=a.B;
 const x0=Math.min(0,a.dx),y0=Math.min(0,a.dy),x1=Math.max(A.w,a.dx+B.w),y1=Math.max(A.h,a.dy+B.h),sc=Math.min(1.5,(cv.parentNode.clientWidth||320)/(x1-x0)),W=Math.max(1,Math.round((x1-x0)*sc)),H=Math.max(1,Math.round((y1-y0)*sc));
 cv.width=W;cv.height=H;a.sc=sc;const g=cv.getContext('2d');g.fillStyle='#111';g.fillRect(0,0,W,H);const put=(im,x,y,al)=>{if(!im.cv){const c=document.createElement('canvas');c.width=im.w;c.height=im.h;const t=c.getContext('2d'),d=t.createImageData(im.w,im.h);for(let i=0;i<im.g.length;i++){d.data[4*i]=d.data[4*i+1]=d.data[4*i+2]=im.g[i];d.data[4*i+3]=255}t.putImageData(d,0,0);im.cv=c}
  g.globalAlpha=al;g.drawImage(im.cv,(x-x0)*sc,(y-y0)*sc,im.w*sc,im.h*sc)};
 put(A,0,0,1);put(B,a.dx,a.dy,.5);g.globalAlpha=1}
function draw(){
 if(!host)return;const w=wallNow(),WL=walls(),R=rowsOf();
 const bz=F.busy?`<div class="busy" role="status">${esc(F.busy)}${F.prog?`<progress max="${F.prog[1]||1}" value="${F.prog[0]||0}"></progress>`:''}</div>`:'';
 if(F.view==='adj'&&F.as){const a=F.as;
  host.querySelector('#fwd').innerHTML=`<h3>תיקון חיבור ידני</h3><p class="tips">${esc(seamName(a.seam))}. התמונה השנייה שקופה למחצה מעל הראשונה. גררו באצבע (או לחצו על החצים) עד שהחפיפה מתיישרת.</p>
  <canvas class="adj" id="fwadj" aria-label="יישור ידני"></canvas>
  <div class="rw"><button class="b" data-fw="ar" data-x="-2" data-y="0" aria-label="שמאלה">◀</button><button class="b" data-fw="ar" data-x="2" data-y="0" aria-label="ימינה">▶</button><button class="b" data-fw="ar" data-x="0" data-y="-2" aria-label="למעלה">▲</button><button class="b" data-fw="ar" data-x="0" data-y="2" aria-label="למטה">▼</button></div>
  <div class="rw"><button class="b g" data-fw="aok">שמרו ובנו מחדש</button><button class="b" data-fw="aauto">חזרה לזיהוי אוטומטי</button><button class="b" data-fw="acx">ביטול</button></div>`;drawAdj();return}
 if(F.view==='res'&&F.res&&F.lay){
  const r=F.res,W=r.wall;
  host.querySelector('#fwd').innerHTML=`<h3>הקיר הבנוי</h3>
  <div class="exp">ניסיון – לא נשמר במערכת. התמונה נשארת רק בטלפון, עד שתשמרו אותה בעצמכם.</div>
  <p class="tips">קיר ${esc(W.edge)}${W.name?' · '+esc(W.name):''} · אורך ${fmt(W.len)} מ' · גובה ${fmt(wallH(W))} מ'${W.h?'':' (גובה משוער)'}</p>
  ${bz}${F.msg?`<div class="busy" role="status">${esc(F.msg)}</div>`:''}
  <div class="rw"><button class="b" data-fw="zo" aria-label="הקטנה">−</button><button class="b" data-fw="zi" aria-label="הגדלה">+</button><button class="b" data-fw="z1">התאמה למסך</button></div>
  <div class="view" id="fwv"><img src="${r.url}" alt="הקיר הבנוי" style="width:${Math.round(F.zoom*100)}%"></div>
  <p class="tips">אפשר לגלול, לצבוט להגדלה או ללחוץ + ו־−.</p>
  <h3>חיבורים</h3><p class="tips">לחיצה על חיבור מאפשרת לתקן אותו ידנית. באדום = המערכת לא בטוחה (נעשתה חלוקה לפי מחוון החפיפה).</p>
  <div class="chips">${F.lay.seams.map((s,i)=>`<button class="b${s.ok?'':' bad'}" data-fw="seam" data-i="${i}">${esc(seamName(s))} · ${s.manual?'ידני':s.ok?'בטוח':'לא בטוח'}</button>`).join('')||'<span class="tips">אין חיבורים (תמונה אחת).</span>'}</div>
  <div class="rw"><button class="b g" data-fw="dl">שמרו לגלריה / הורידו</button><button class="b" data-fw="sh">שיתוף</button></div>
  <div class="rw"><button class="b" data-fw="back">חזרה לסימון</button></div>`;return}
 const nUsed=new Set(R.flat()).size;
 const h=`<h3>1. התמונות (${F.photos.length}/${MAXPH})</h3>
 <div class="rw"><button class="b g" data-fw="cam" ${F.busy?'disabled':''}>צלמו</button><button class="b" data-fw="gal" ${F.busy?'disabled':''}>בחרו מהגלריה</button></div>
 ${bz}${F.msg?`<div class="busy" role="status">${esc(F.msg)}</div>`:''}
 ${F.photos.length?`<div class="grid">${F.photos.map((p,i)=>{const t=tag(p.id);return`<div class="ph${t?' on':''}"><button class="sel" data-fw="pick" data-id="${p.id}" aria-label="תמונה ${i+1}${t?' – '+t:''}"><img src="${p.url}" alt=""></button><span class="n">${i+1}</span>${t?`<span class="t">${t}</span>`:''}<div class="ac"><button data-fw="mv" data-id="${p.id}" data-d="-1" aria-label="הקדמה" ${i?'':'disabled'}>▶</button><button data-fw="del" data-id="${p.id}" aria-label="מחיקה">✕</button><button data-fw="mv" data-id="${p.id}" data-d="1" aria-label="אחרי" ${i<F.photos.length-1?'':'disabled'}>◀</button></div></div>`}).join('')}</div>`:'<p class="tips">עוד אין תמונות.</p>'}
 <h3>2. קיר ומספר שורות</h3>
 ${WL.length?`<select id="fwwall" aria-label="בחירת קיר"><option value="">בחרו קיר…</option>${WL.map(x=>`<option value="${esc(x.key)}"${x.key===F.wall?' selected':''}>קיר ${esc(x.edge)}${x.name?' · '+esc(x.name):''} (${fmt(x.len)} מ')</option>`).join('')}</select>`:'<p class="tips">אין קירות במפה.</p>'}
 ${w?`<p class="tips">אורך ${fmt(w.len)} מ' · גובה ${fmt(wallH(w))} מ'${w.h?'':' (גובה משוער)'}</p>`:''}
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
 if(host)return;
 host=document.createElement('div');host.className='s3fw';host.setAttribute('role','dialog');host.setAttribute('aria-label','צילום חופשי של קיר');
 host.innerHTML=`<div class="rw" style="margin-top:0"><button class="b" data-fw="close">חזרה</button></div>
 <h2>צילום חופשי של קיר (ניסיון)</h2>
 <div class="exp">ניסיון – לא נשמר במערכת ולא נשלח לשרת. הכול נשאר בטלפון.</div>
 <ol><li>צלמו או בחרו מהגלריה את תמונות הקיר.</li><li>בחרו קיר ומספר שורות.</li><li>לכל שורה סמנו את התמונות משמאל לימין (שורה 1 = למטה).</li><li>לחצו "בנו את הקיר".</li></ol>
 <p class="tips">טיפים: עמדו תמיד באותו מרחק, ישר מול הקיר, ובכל תמונה השאירו חפיפה של כשליש עם התמונה השכנה. תמונות לאורך ולרוחב מתאימות.</p>
 <div id="fwd"></div>
 <input type="file" accept="image/*" capture="environment" id="fwcam" hidden><input type="file" accept="image/*" multiple id="fwgal" hidden>`;
 document.body.append(host);document.body.style.overflow='hidden';
 host.addEventListener('change',e=>{const i=e.target;if(i&&(i.id==='fwcam'||i.id==='fwgal')){const L=[...i.files];i.value='';addFiles(L)}else if(i&&i.id==='fwwall'){F.wall=i.value;F.est=F.lay=null;draw()}});
 host.addEventListener('input',e=>{const i=e.target;if(i&&i.id==='fwov'){F.ov=cl(+i.value|0,0,40);const v=host.querySelector('#fwovv');if(v)v.textContent=F.ov+'%'}});
 let drag=null;
 host.addEventListener('pointerdown',e=>{if(e.target.id==='fwadj'&&F.as){drag={x:e.clientX,y:e.clientY,dx:F.as.dx,dy:F.as.dy};try{e.target.setPointerCapture(e.pointerId)}catch(_){}}});
 host.addEventListener('pointermove',e=>{if(drag&&F.as){F.as.dx=Math.round(drag.dx+(e.clientX-drag.x)/F.as.sc);F.as.dy=Math.round(drag.dy+(e.clientY-drag.y)/F.as.sc);drawAdj()}});
 host.addEventListener('pointerup',()=>{drag=null});
 host.addEventListener('click',e=>{const b=e.target.closest('[data-fw]');if(!b||b.disabled)return;const a=b.dataset.fw,id=+b.dataset.id;
  if(a==='close')return closeAll();
  if(a==='cam')return host.querySelector('#fwcam').click();
  if(a==='gal')return host.querySelector('#fwgal').click();
  if(a==='del'){const p=F.photos.find(x=>x.id===id);if(p){try{URL.revokeObjectURL(p.url)}catch(e){}}F.photos=F.photos.filter(x=>x.id!==id);F.assign=F.assign.map(r=>(r||[]).filter(x=>x!==id));F.gray.delete(id)}
  else if(a==='mv'){const i=F.photos.findIndex(x=>x.id===id),j=i+(+b.dataset.d);if(i>=0&&j>=0&&j<F.photos.length){const t=F.photos[i];F.photos[i]=F.photos[j];F.photos[j]=t}}
  else if(a==='rows'){F.rows=cl(+b.dataset.n|0,1,6);F.cur=Math.min(F.cur,F.rows-1);F.assign.length=Math.min(F.assign.length,F.rows)}
  else if(a==='row')F.cur=cl(+b.dataset.n|0,0,F.rows-1);
  else if(a==='pick'){const r=F.assign[F.cur]||(F.assign[F.cur]=[]),k=r.indexOf(id);if(k>=0)r.splice(k,1);else{for(let i=0;i<F.assign.length;i++){const q=(F.assign[i]||[]).indexOf(id);if(q>=0)F.assign[i].splice(q,1)}r.push(id)}}
  else if(a==='build')return doBuild();
  else if(a==='back'){relUrl();F.view='edit';F.msg=''}
  else if(a==='zi')F.zoom=Math.min(5,F.zoom+.5);else if(a==='zo')F.zoom=Math.max(1,F.zoom-.5);else if(a==='z1')F.zoom=1;
  else if(a==='dl')return save('dl');else if(a==='sh')return save('share');
  else if(a==='seam'){const s=F.lay.seams[+b.dataset.i];if(!s)return;let A,B;
   if(s.t==='h'){A=F.gray.get(s.a);B=F.gray.get(s.b)}else{A=strip(F.lay.pls[s.r],F.gray);B=strip(F.lay.pls[s.r+1],F.gray)}
   F.as={seam:s,A,B,dx:s.dx,dy:s.dy,sc:1};F.view='adj'}
  else if(a==='ar'&&F.as){F.as.dx+=+b.dataset.x;F.as.dy+=+b.dataset.y}
  else if(a==='aok'&&F.as){F.adj[F.as.seam.key]={dx:F.as.dx,dy:F.as.dy};F.as=null;return rebuild()}
  else if(a==='aauto'&&F.as){delete F.adj[F.as.seam.key];F.as=null;return rebuild()}
  else if(a==='acx'){F.as=null;F.view='res'}
  draw()});
 draw()}
ACT.s3ffOpen=()=>open();
})(typeof window!=='undefined'?window:this);
