/* הקמת חנות – שלב 4 (משימה 2026-11-17_תהליך-הקמת-חנות): יישור וחיבור של 1–6 תמונות לחזית אחת (S3Warp).
   קוד טהור (בלי DOM), כדי שירוץ גם בבדיקות Node. אין AI ואין העלאה – רק חישוב.
   קלט לכל תמונה: {img:{w,h,data:RGBA}, quad:[8 מספרים 0–1000], xr:{a,b} 0–1000, lv:'a'|'t'|'b'}.
   quad = 4 פינות החלק המצולם בתמונה, באלפיות מרוחב/גובה התמונה, בסדר: שמאל-עליון, ימין-עליון, ימין-תחתון, שמאל-תחתון (כפי שרואים בתמונה).
   xr = איזה טווח לאורך הפריט (משמאל לימין, באלפיות) התמונה מכסה. במדף גבוה: lv 't' = החצי העליון של החזית, 'b' = התחתון.
   התוצאה: חזית אחת עד 2048px, רשימת קטעים חסרים (gaps), כיסוי (cov) וקצוות נראים (ends) – לפי הפיקסלים שבאמת נכנסו לחזית.
   בחפיפה בין תמונות: תיקון הזזה קטן (חיפוש התאמה באזור החפיפה, עד ~2% מהרוחב) ומעבר הדרגתי, כדי שטעות קטנה ב-xr/quad לא תיצור "קפיצה". */
(function(root){
'use strict';
const MAXF=2048,MINGAP=10;/* קטע חסר = לפחות 10 אלפיות מאורך הפריט (כ-2 ס"מ במקטע של 2 מטר) */
const cl=(v,a,b)=>v<a?a:v>b?b:v;
/* ריבוע יחידה ← מרובע (Heckbert). מחזיר 9 מקדמים: u=(a*s+b*t+c)/(g*s+h*t+1), v=(d*s+e*t+f)/(g*s+h*t+1) */
function sq2q(P){
 const[x0,y0,x1,y1,x2,y2,x3,y3]=P,dx1=x1-x2,dx2=x3-x2,dy1=y1-y2,dy2=y3-y2,sx=x0-x1+x2-x3,sy=y0-y1+y2-y3;
 let g=0,h=0;
 if(Math.abs(sx)>1e-9||Math.abs(sy)>1e-9){const den=dx1*dy2-dx2*dy1;if(Math.abs(den)<1e-12)return null;g=(sx*dy2-dx2*sy)/den;h=(dx1*sy-sx*dy1)/den}
 return[x1-x0+g*x1,x3-x0+h*x3,x0,y1-y0+g*y1,y3-y0+h*y3,y0,g,h,1]}
/* האם המרובע תקין (קמור, בכיוון אחד, לא מנוון) */
function quadOk(q){
 if(!Array.isArray(q)||q.length!==8||q.some(v=>typeof v!=='number'||!isFinite(v)))return false;
 let s=0;for(let i=0;i<4;i++){const ax=q[2*i],ay=q[2*i+1],bx=q[(2*i+2)%8],by=q[(2*i+3)%8],cx=q[(2*i+4)%8],cy=q[(2*i+5)%8],z=(bx-ax)*(cy-by)-(by-ay)*(cx-bx);if(Math.abs(z)<1e-6)return false;const sg=z>0?1:-1;if(s&&sg!==s)return false;s=sg}
 let A=0;for(let i=0;i<4;i++)A+=q[2*i]*q[(2*i+3)%8]-q[(2*i+2)%8]*q[2*i+1];return Math.abs(A)/2>=400}/* לפחות 2% משטח התמונה (במונחי 0–1000) */
const LVR={t:0,a:0,b:1};/* סדר: עליון לפני תחתון */
const FULLQ=[0,0,1000,0,1000,1000,0,1000];
const yrOk=x=>!!x&&Number.isFinite(x.a)&&Number.isFinite(x.b)&&x.a>=0&&x.b<=1000&&x.b-x.a>=50;
const xrOk=x=>!!x&&Number.isFinite(x.a)&&Number.isFinite(x.b)&&x.a>=0&&x.b<=1000&&x.a<x.b;
/* ברירת מחדל ל-xr כשאין (לא AI ולא עורך): חלוקה שווה לפי סדר התמונות, משמאל לימין, בכל גובה בנפרד */
function defXr(list){const by={};for(const p of list){const l=p.lv==='t'||p.lv==='b'?p.lv:'a';(by[l]=by[l]||[]).push(p)}
 const out=new Map();for(const l in by){const L=by[l];L.forEach((p,i)=>out.set(p,{a:Math.round(1000*i/L.length),b:Math.round(1000*(i+1)/L.length)}))}return out}
/* גודל החזית: aspect = רוחב/גובה אמיתי (מהמפה). הצלע הארוכה עד 2048 */
function size(aspect,maxSide){const m=Math.min(MAXF,maxSide||MAXF),a=aspect>0&&isFinite(aspect)?cl(aspect,.05,20):2;return a>=1?{w:m,h:Math.max(8,Math.round(m/a))}:{w:Math.max(8,Math.round(m*a)),h:m}}
/* דגימה בילינארית; מחזיר false מחוץ לתמונה */
function samp(img,u,v,o){const W=img.w,Hh=img.h;if(!(u>=-.5&&v>=-.5&&u<=W-.5&&v<=Hh-.5))return false;
 const x=cl(u,0,W-1),y=cl(v,0,Hh-1),x0=Math.floor(x),y0=Math.floor(y),x1=x0+1<W?x0+1:x0,y1=y0+1<Hh?y0+1:y0,fx=x-x0,fy=y-y0,d=img.data;
 const i00=(y0*W+x0)*4,i10=(y0*W+x1)*4,i01=(y1*W+x0)*4,i11=(y1*W+x1)*4;
 for(let c=0;c<3;c++){const t=d[i00+c]+(d[i10+c]-d[i00+c])*fx,b=d[i01+c]+(d[i11+c]-d[i01+c])*fx;o[c]=t+(b-t)*fy}return true}
const lum=o=>.299*o[0]+.587*o[1]+.114*o[2];
/* מיפוי: פיקסל בחזית (x,y) ← נקודה בתמונה. r = מלבן היעד {x0,y0,x1,y1}, k = מקדמי sq2q בפיקסלי התמונה */
function mapper(r,k){const iw=1/(r.x1-r.x0),ih=1/(r.y1-r.y0);
 return(x,y,o)=>{const s=(x-r.x0)*iw,t=(y-r.y0)*ih,z=k[6]*s+k[7]*t+1;o[0]=(k[0]*s+k[1]*t+k[2])/z;o[1]=(k[3]*s+k[4]*t+k[5])/z;return o}}
/* חיפוש הזזה (dx,dy) של התמונה החדשה מול מה שכבר בחזית, באזור החפיפה. ממוצע מוסר (הבדלי תאורה בין תמונות) */
function align(out,mask,F,img,M,r,ov,R){
 const pts=[],c=[0,0,0],uv=[0,0],nx=Math.max(1,Math.min(64,Math.round(ov.x1-ov.x0))),ny=Math.max(1,Math.min(64,Math.round(ov.y1-ov.y0)));
 for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){const x=Math.round(ov.x0+(i+.5)*(ov.x1-ov.x0)/nx),y=Math.round(ov.y0+(j+.5)*(ov.y1-ov.y0)/ny);if(x<0||y<0||x>=F.w||y>=F.h)continue;const p=y*F.w+x;if(!mask[p])continue;const q=p*4;pts.push(x,y,.299*out[q]+.587*out[q+1]+.114*out[q+2])}
 const n=pts.length/3;if(n<40)return null;
 const cost=(dx,dy)=>{let sa=0,sb=0,m=0;const A=new Float32Array(n),B=new Float32Array(n),ok=new Uint8Array(n);
  for(let i=0;i<n;i++){M(pts[3*i]+.5-dx,pts[3*i+1]+.5-dy,uv);if(samp(img,uv[0],uv[1],c)){ok[i]=1;A[i]=pts[3*i+2];B[i]=lum(c);sa+=A[i];sb+=B[i];m++}}
  if(m<n*.6)return Infinity;sa/=m;sb/=m;let e=0;for(let i=0;i<n;i++)if(ok[i])e+=Math.abs(A[i]-sa-(B[i]-sb));return e/m};
 const c0=cost(0,0);let best=c0,bx=0,by=0;const Ry=R;
 for(let dy=-Ry;dy<=Ry;dy+=2)for(let dx=-R;dx<=R;dx+=2){const e=cost(dx,dy);if(e<best){best=e;bx=dx;by=dy}}
 const cx=bx,cy=by;for(let dy=cy-1;dy<=cy+1;dy++)for(let dx=cx-1;dx<=cx+1;dx++){if(!dx&&!dy&&cx===0&&cy===0)continue;const e=cost(dx,dy);if(e<best){best=e;bx=dx;by=dy}}
 /* תת-פיקסל (פרבולה) בכל ציר */
 const par=(m1,z,p1)=>{const d=m1-2*z+p1;return d>1e-9?cl(.5*(m1-p1)/d,-.5,.5):0};
 let sx=bx,sy=by;if(best<Infinity){sx=bx+par(cost(bx-1,by),best,cost(bx+1,by));sy=by+par(cost(bx,by-1),best,cost(bx,by+1))}
 /* מקבלים הזזה רק אם היא משפרת באמת (נגד מדפים עם מוצרים חוזרים) */
 if(!(best<c0*.85)||!(Math.hypot(sx,sy)>=.5))return{dx:0,dy:0,e0:c0,e:c0,n};
 return{dx:sx,dy:sy,e0:c0,e:best,n}}
/* ליבה בשלבים, כדי שבטלפון תהיה בזיכרון רק תמונה מפוענחת אחת בכל רגע:
   const S=create(photos,opt); for(const o of S.order) S.add(o, img); const r=S.done();
   photos = [{img?|w,h, quad, xr, lv, yr?, off}], opt = {aspect, maxSide, fill:[r,g,b], refine:true, minGap}. done() מחזיר {w,h,data,gaps,cov,ends,seams,lv,shifts} */
function create(photos,opt){
 opt=opt||{};const F=size(opt.aspect,opt.maxSide),N=F.w*F.h,data=new Uint8ClampedArray(N*4),mask=new Uint8Array(N),fill=opt.fill||[40,40,46],minGap=opt.minGap||MINGAP;
 for(let i=0;i<N;i++){data[4*i]=fill[0];data[4*i+1]=fill[1];data[4*i+2]=fill[2];data[4*i+3]=255}
 const dim=p=>p.img?p.img:p,L=(photos||[]).filter(p=>p&&!p.off&&dim(p).w>0&&dim(p).h>0),hi=L.some(p=>p.lv==='t'||p.lv==='b'),dx0=defXr(L);
 const band=lv=>!hi?[0,F.h]:lv==='t'?[0,Math.round(F.h/2)]:[Math.round(F.h/2),F.h];
 const seams=[],R=Math.max(4,Math.round(F.w*.02)),c=[0,0,0],uv=[0,0];
 const order=L.map(p=>({p,xr:xrOk(p.xr)?p.xr:dx0.get(p),lv:hi?(p.lv==='t'?'t':'b'):'a'})).sort((a,b)=>LVR[a.lv]-LVR[b.lv]||a.xr.a-b.xr.a||a.xr.b-b.xr.b);
 function add(o,im){
  im=im||o.p.img;if(!im||!(im.w>0)||!(im.h>0))return;
  const q=quadOk(o.p.quad)?o.p.quad:FULLQ,P=q.map((v,i)=>v/1000*(i%2?im.h:im.w)-.5),k=sq2q(P);if(!k)return;
  /* גובה: במדף גבוה אפשר yr (איזה טווח גובה, באלפיות מלמעלה) – כדי שעליון ותחתון יחפפו ויתיישרו; אחרת חצי/חצי */
  const yb=hi&&yrOk(o.p.yr)?o.p.yr:null,[y0,y1]=yb?[yb.a/1000*F.h,yb.b/1000*F.h]:band(o.lv),r={x0:o.xr.a/1000*F.w,x1:o.xr.b/1000*F.w,y0,y1};
  let M=mapper(r,k),sh={dx:0,dy:0};
  /* חפיפה עם מה שכבר בחזית: אורך הרצף המכוסה מכל צד של המלבן (חציון של 3 שורות/עמודות) */
  const runs=(X0,X1,Y0,Y1)=>{const md=a=>a.sort((u,v)=>u-v)[1],R3=[.25,.5,.75];
   const run=(n,f)=>{let i=0;while(i<n&&f(i))i++;return i};
   const W0=X1-X0,H0=Y1-Y0;if(W0<2||H0<2)return{l:0,r:0,t:0,b:0};
   return{l:md(R3.map(q=>{const y=Math.floor(Y0+H0*q);return run(W0,i=>mask[y*F.w+X0+i])})),r:md(R3.map(q=>{const y=Math.floor(Y0+H0*q);return run(W0,i=>mask[y*F.w+X1-1-i])})),
    t:md(R3.map(q=>{const x=Math.floor(X0+W0*q);return run(H0,i=>mask[(Y0+i)*F.w+x])})),b:md(R3.map(q=>{const x=Math.floor(X0+W0*q);return run(H0,i=>mask[(Y1-1-i)*F.w+x])}))}};
  const box=(dx,dy)=>[Math.max(0,Math.floor(r.x0+dx)),Math.min(F.w,Math.ceil(r.x1+dx)),Math.max(0,Math.floor(y0+dy)),Math.min(F.h,Math.ceil(y1+dy))];
  if(opt.refine!==false){const[X0,X1,Y0,Y1]=box(0,0),u=runs(X0,X1,Y0,Y1),ov=Math.max(u.l,u.r,u.t,u.b);
   if(ov>=8){const s=align(data,mask,F,im,M,r,{x0:X0,x1:X1,y0:Y0,y1:Y1},R);if(s){sh=s;seams.push({lv:o.lv,a:o.xr.a,ov,dx:+s.dx.toFixed(2),dy:+s.dy.toFixed(2),e0:+s.e0.toFixed(2),e:+s.e.toFixed(2)})}}}
  const Ms=M,sx=sh.dx,sy=sh.dy;M=(x,y,o2)=>Ms(x-sx,y-sy,o2);
  /* מעבר בחפיפה: חיתוך באמצע אזור החפיפה עם מעבר קצר (FE פיקסלים), ולא מעבר לאורך כל החפיפה –
     בחפיפה רחבה של מוצרים בעומק שונה (פרלקסה) מעבר ארוך יוצר "רוחות" כפולות. d = מרחק מהקצה, run = רוחב החפיפה */
  const FE=Math.max(6,Math.round(F.w*.012)),fe=(d,run)=>run<=FE?(d+1)/(run+1):cl((d-run/2)/FE+.5,0,1);
  const[X0,X1,Y0,Y1]=box(sx,sy),u=runs(X0,X1,Y0,Y1);
  for(let y=Y0;y<Y1;y++)for(let x=X0;x<X1;x++){M(x+.5,y+.5,uv);if(!samp(im,uv[0],uv[1],c))continue;const p=y*F.w+x,q4=p*4;
   let al=1;if(mask[p]){if(u.l)al=Math.min(al,fe(x-X0,u.l));if(u.r)al=Math.min(al,fe(X1-1-x,u.r));if(u.t)al=Math.min(al,fe(y-Y0,u.t));if(u.b)al=Math.min(al,fe(Y1-1-y,u.b))}
   if(al<1){al=cl(al,0,1);data[q4]+=(c[0]-data[q4])*al;data[q4+1]+=(c[1]-data[q4+1])*al;data[q4+2]+=(c[2]-data[q4+2])*al}
   else{data[q4]=c[0];data[q4+1]=c[1];data[q4+2]=c[2]}mask[p]=1}
  o.sh=sh}
 /* כיסוי לפי עמודות: עמודה מכוסה אם לפחות 90% מהשורות שלה (בפס הגובה) נכנסו */
 function done(){
  const lvs=hi?['t','b']:['a'],gaps=[];let covSum=0;const ends=new Set(['l','r']);
  for(const lv of lvs){const[y0,y1]=band(lv),need=Math.ceil((y1-y0)*.9),col=new Uint8Array(F.w);let n=0;
   for(let x=0;x<F.w;x++){let s=0;for(let y=y0;y<y1;y++)s+=mask[y*F.w+x];if(s>=need){col[x]=1;n++}}
   covSum+=n/F.w;let x=0;
   while(x<F.w){if(col[x]){x++;continue}let e=x;while(e<F.w&&!col[e])e++;const a=Math.floor(1000*x/F.w),b=Math.ceil(1000*e/F.w);if(b-a>=minGap&&e-x>=3)gaps.push(hi?{a,b,lv}:{a,b});x=e}
   let f=0;while(f<F.w&&!col[f])f++;let l=F.w-1;while(l>=0&&!col[l])l--;if(f>F.w*.01)ends.delete('l');if(l<F.w*.99-1)ends.delete('r')}
  return{w:F.w,h:F.h,data,gaps:gaps.slice(0,10),cov:+(covSum/lvs.length).toFixed(4),ends:['l','r'].filter(e=>ends.has(e)),seams,lv:hi?'tb':'a',shifts:order.map(o=>o.sh||{dx:0,dy:0})}}
 return{order,add,done,w:F.w,h:F.h}}
/* גרסה בבת אחת (בדיקות; תמונות כבר מפוענחות) */
function stitch(photos,opt){const S=create(photos,opt);for(const o of S.order)S.add(o);return S.done()}
const W={stitch,create,yrOk,sq2q,mapper,quadOk,xrOk,defXr,size,FULLQ,MAXF,MINGAP};
if(typeof module!=='undefined'&&module.exports)module.exports=W;else root.S3Warp=W;
})(typeof window!=='undefined'?window:this);
