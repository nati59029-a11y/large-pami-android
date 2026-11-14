/* store3d-geo.js – מתמטיקה טהורה למפת החנות בתלת מימד (בלי DOM ובלי three.js).
   נטען בדפדפן כ-window.S3G, וב-Node דרך require (לבדיקות יחידה).
   מבנה המפה: חוזה הנתונים store3d, סעיף 4.3 (smap). יחידות: ס"מ, מספרים שלמים, 0–10000.
   מוסכמת צירים (בתוכנית, כמו על המסך): x ימינה, y למטה. זווית a במעלות, עם כיוון השעון על המסך.
   גוף (fx): האורך w לאורך ציר x המקומי, העומק d לאורך y המקומי. צד a פונה ל-y+ המקומי, צד b ל-y- (רק כש-sides=2). */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.S3G=factory()})(typeof self!=='undefined'?self:this,function(){
'use strict';
const MAXC=10000,MIN_AREA=10000/* 1 מ"ר בסמ"ר */,MAX_BAYS=2000;
const FX_KINDS=['gon','wall','fridge','table','stand','bin'],TWO_SIDED=['gon','table','stand'];
const isInt=v=>Number.isInteger(v);
const inR=(v,a,b)=>isInt(v)&&v>=a&&v<=b;
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const live=a=>(Array.isArray(a)?a:[]).filter(o=>o&&typeof o==='object'&&o.del!==1);

/* ---------- מצולעים (רשימה שטוחה [x1,y1,x2,y2,...]) ---------- */
function pts(p){const r=[];for(let i=0;i+1<p.length;i+=2)r.push([p[i],p[i+1]]);return r}
function polyArea(p){let s=0;const n=p.length/2;for(let i=0;i<n;i++){const j=(i+1)%n;s+=p[2*i]*p[2*j+1]-p[2*j]*p[2*i+1]}return s/2}
function orient(ax,ay,bx,by,cx,cy){const v=(bx-ax)*(cy-ay)-(by-ay)*(cx-ax);return v>0?1:v<0?-1:0}
function onSeg(ax,ay,bx,by,cx,cy){return Math.min(ax,bx)<=cx&&cx<=Math.max(ax,bx)&&Math.min(ay,by)<=cy&&cy<=Math.max(ay,by)}
/* האם הקטעים AB ו-CD נחתכים (כולל נגיעה וחפיפה על אותו קו) */
function segsCross(ax,ay,bx,by,cx,cy,dx,dy){
  const o1=orient(ax,ay,bx,by,cx,cy),o2=orient(ax,ay,bx,by,dx,dy),o3=orient(cx,cy,dx,dy,ax,ay),o4=orient(cx,cy,dx,dy,bx,by);
  if(o1!==o2&&o3!==o4)return true;
  return (o1===0&&onSeg(ax,ay,bx,by,cx,cy))||(o2===0&&onSeg(ax,ay,bx,by,dx,dy))||(o3===0&&onSeg(cx,cy,dx,dy,ax,ay))||(o4===0&&onSeg(cx,cy,dx,dy,bx,by));
}
/* בדיקת מצולע חדר: מחזיר {ok:true, area} או {ok:false, err:'הודעה בעברית'} */
function polyValid(p){
  if(!Array.isArray(p))return{ok:false,err:'החדר חסר פינות'};
  if(p.length%2)return{ok:false,err:'מספר הקואורדינטות של החדר אינו זוגי'};
  if(p.length<6)return{ok:false,err:'לחדר צריכות להיות לפחות 3 פינות'};
  if(p.length>80)return{ok:false,err:'לחדר יכולות להיות עד 40 פינות'};
  for(const v of p)if(!inR(v,0,MAXC))return{ok:false,err:'נקודה מחוץ לתחום המפה (0 עד 100 מטר)'};
  const n=p.length/2;
  for(let i=0;i<n;i++)for(let j=i+1;j<n;j++)if(p[2*i]===p[2*j]&&p[2*i+1]===p[2*j+1])return{ok:false,err:'שתי פינות של החדר באותה נקודה'};
  for(let i=0;i<n;i++){const i2=(i+1)%n;for(let j=i+1;j<n;j++){const j2=(j+1)%n;
    if(j===i2||j2===i)continue;/* צלעות סמוכות */
    if(segsCross(p[2*i],p[2*i+1],p[2*i2],p[2*i2+1],p[2*j],p[2*j+1],p[2*j2],p[2*j2+1]))return{ok:false,err:'קירות החדר חוצים זה את זה'}}}
  for(let i=0;i<n;i++){const a=(i+n-1)%n,b=(i+1)%n;/* שלוש פינות רצופות על קו אחד שחוזר אחורה */
    if(orient(p[2*a],p[2*a+1],p[2*i],p[2*i+1],p[2*b],p[2*b+1])===0&&!onSeg(p[2*a],p[2*a+1],p[2*b],p[2*b+1],p[2*i],p[2*i+1]))return{ok:false,err:'קירות החדר חוצים זה את זה'}}
  const area=Math.abs(polyArea(p));
  if(area<=MIN_AREA)return{ok:false,err:'החדר קטן מדי (צריך יותר ממטר מרובע)'};
  return{ok:true,area};
}
function pointInPoly(x,y,p){let c=false;const n=p.length/2;for(let i=0,j=n-1;i<n;j=i++){const xi=p[2*i],yi=p[2*i+1],xj=p[2*j],yj=p[2*j+1];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)c=!c}return c}
function centroid(p){const A=polyArea(p);if(!A){const q=pts(p);return[q.reduce((s,v)=>s+v[0],0)/q.length,q.reduce((s,v)=>s+v[1],0)/q.length]}
  let cx=0,cy=0;const n=p.length/2;for(let i=0;i<n;i++){const j=(i+1)%n,f=p[2*i]*p[2*j+1]-p[2*j]*p[2*i+1];cx+=(p[2*i]+p[2*j])*f;cy+=(p[2*i+1]+p[2*j+1])*f}return[cx/(6*A),cy/(6*A)]}

/* ---------- גופים ומקטעים ---------- */
function rot(a){const r=a*Math.PI/180;return[Math.cos(r),Math.sin(r)]}
/* נקודה מקומית (lx,ly) של גוף => נקודה בתוכנית */
function toPlan(f,lx,ly){const[c,s]=rot(f.a||0);return[f.x+lx*c-ly*s,f.y+lx*s+ly*c]}
function fxCorners(f){const hw=f.w/2,hd=f.d/2;return[toPlan(f,-hw,-hd),toPlan(f,hw,-hd),toPlan(f,hw,hd),toPlan(f,-hw,hd)]}
/* כיוון "ימין" של אדם שמביט בכיוון (lx,ly) בתוכנית שבה y למטה */
function rightOf(lx,ly){return[-ly,lx]}
/* רשימת המקטעים של גוף (נגזרת, לא נשמרת – חוזה 4.3). numDir: 'rtl' = מקטע 1 מימין לעומד מול החזית */
function fxBays(f,numDir){
  const out=[],sides=f.sides===2&&TWO_SIDED.includes(f.k)?2:1,nb=clamp(f.bays|0,1,30),bw=f.w/nb,[c,s]=rot(f.a||0),hi=!!f.hi;
  for(let si=0;si<sides;si++){
    const side=si?'b':'a',ny0=si?-1:1;/* נורמל מקומי של החזית */
    /* עומד מול החזית מביט אל (0,-ny0) מקומית; ימין שלו מקומית: */
    const rx=rightOf(0,-ny0)[0];/* 1 בצד a, -1 בצד b */
    const dir=(numDir==='ltr'?-1:1)*rx;
    for(let n=1;n<=nb;n++){
      const lx=dir*(f.w/2-(n-.5)*bw),ly=ny0*f.d/2,[px,py]=toPlan(f,lx,ly);
      out.push({id:f.id+'-'+side+'-'+n,fx:f.id,s:side,n,lv:hi?['t','b']:['a'],lx,ly,x:px,y:py,nx:-ny0*s,ny:ny0*c,w:bw,h:f.h});
    }
  }
  return out;
}
function bayCount(map){let t=0;for(const f of live(map&&map.fx))t+=(f.sides===2&&TWO_SIDED.includes(f.k)?2:1)*clamp(f.bays|0,1,30);return t}

/* ---------- נקודת הכניסה ומספור גופים מימין לשמאל ---------- */
function entrance(map){
  const rooms=live(map&&map.rooms).filter(r=>Array.isArray(r.p)&&r.p.length>=6),doors=live(map&&map.doors),syms=live(map&&map.syms);
  const allP=[].concat(...rooms.map(r=>r.p)),cen=allP.length?centroid(rooms.length===1?rooms[0].p:boundsPoly(allP)):[MAXC/2,MAXC/2];
  let e=doors.find(d=>d.id===map.ent)||doors.find(d=>d.k==='ent')||syms.find(y=>y.k==='ent');
  let x,y;
  if(e){x=e.x;y=e.y}else{const b=bounds(allP.length?allP:[0,0,MAXC,MAXC]);x=(b[0]+b[2])/2;y=b[3]}/* בלי כניסה: אמצע הצלע התחתונה */
  let lx=cen[0]-x,ly=cen[1]-y;const L=Math.hypot(lx,ly)||1;lx/=L;ly/=L;if(!isFinite(lx)){lx=0;ly=-1}
  return{x,y,lx,ly};
}
function bounds(p){let a=Infinity,b=Infinity,c=-Infinity,d=-Infinity;for(let i=0;i+1<p.length;i+=2){a=Math.min(a,p[i]);b=Math.min(b,p[i+1]);c=Math.max(c,p[i]);d=Math.max(d,p[i+1])}return[a,b,c,d]}
function boundsPoly(p){const[a,b,c,d]=bounds(p);return[a,b,c,b,c,d,a,d]}
/* מחזיר [{id,num}] – מספור גופים לפי המיקום כפי שנראה מהכניסה: ימין ראשון (rtl) או שמאל ראשון (ltr) */
function autoNumber(map){
  const e=entrance(map),[rx,ry]=rightOf(e.lx,e.ly),sg=(map&&map.numDir)==='ltr'?-1:1;
  const fx=live(map&&map.fx).map(f=>{const dx=f.x-e.x,dy=f.y-e.y;return{id:f.id,side:(dx*rx+dy*ry)*sg,fwd:dx*e.lx+dy*e.ly}});
  fx.sort((a,b)=>(b.side-a.side)||(a.fwd-b.fwd)||(a.id<b.id?-1:1));
  return fx.map((f,i)=>({id:f.id,num:Math.min(999,i+1)}));
}

/* ---------- קטעים חוסמים להליכה (התנגשות) ---------- */
/* חיתוך פתחי דלתות מקטע: מחזיר רשימת קטעים שנשארו */
function cutDoors(x1,y1,x2,y2,doors){
  const L=Math.hypot(x2-x1,y2-y1);if(!L)return[];
  const ux=(x2-x1)/L,uy=(y2-y1)/L,gaps=[];
  for(const d of doors){const t=(d.x-x1)*ux+(d.y-y1)*uy,off=Math.abs((d.x-x1)*uy-(d.y-y1)*ux);
    if(off<=40&&t>-d.w/2&&t<L+d.w/2)gaps.push([t-d.w/2,t+d.w/2])}
  gaps.sort((a,b)=>a[0]-b[0]);
  const out=[];let s=0;
  for(const[g0,g1]of gaps){if(g0>s)out.push([s,Math.min(g0,L)]);s=Math.max(s,g1);if(s>=L)break}
  if(s<L)out.push([s,L]);
  return out.filter(([a,b])=>b-a>1).map(([a,b])=>[x1+ux*a,y1+uy*a,x1+ux*b,y1+uy*b]);
}
function rectSegs(cs){const o=[];for(let i=0;i<4;i++){const a=cs[i],b=cs[(i+1)%4];o.push([a[0],a[1],b[0],b[1]])}return o}
/* קטעי קירות החדרים אחרי חיתוך הדלתות – משמשים גם לציור הקירות */
function roomWallSegs(map){const doors=live(map&&map.doors).filter(d=>isFinite(d.x)&&isFinite(d.y)&&d.w>0),out=[];
  for(const r of live(map&&map.rooms)){if(!polyValid(r.p).ok)continue;const n=r.p.length/2;
    for(let i=0;i<n;i++){const j=(i+1)%n;for(const s of cutDoors(r.p[2*i],r.p[2*i+1],r.p[2*j],r.p[2*j+1],doors))out.push({room:r.id,h:r.h,s})}}
  return out}
function innerWallSegs(map){const doors=live(map&&map.doors).filter(d=>d.w>0),out=[];
  for(const w of live(map&&map.walls)){if(!Array.isArray(w.p)||w.p.length!==4||!w.p.every(v=>inR(v,0,MAXC)))continue;
    for(const s of cutDoors(w.p[0],w.p[1],w.p[2],w.p[3],doors))out.push({id:w.id,t:clamp(w.t|0||10,5,50),s})}
  return out}
/* כל הקטעים שאסור לעבור דרכם: [x1,y1,x2,y2,חצי עובי] */
function walkSegments(map){
  const out=[];
  for(const w of roomWallSegs(map))out.push(w.s.concat(5));
  for(const w of innerWallSegs(map))out.push(w.s.concat(w.t/2));
  for(const f of live(map&&map.fx))if(isFinite(f.x)&&f.w>0&&f.d>0)for(const s of rectSegs(fxCorners(f)))out.push(s.concat(0));
  for(const c of live(map&&map.cols))if(isFinite(c.x)&&c.w>0)for(const s of rectSegs(fxCorners({x:c.x,y:c.y,w:c.w,d:c.d||c.w,a:0})))out.push(s.concat(0));
  return out;
}
function closestOnSeg(px,py,x1,y1,x2,y2){const dx=x2-x1,dy=y2-y1,L2=dx*dx+dy*dy;let t=L2?((px-x1)*dx+(py-y1)*dy)/L2:0;t=clamp(t,0,1);return[x1+t*dx,y1+t*dy]}
/* דוחף עיגול ברדיוס r אל מחוץ לקטעים */
function resolveCircle(x,y,r,segs){
  for(let it=0;it<4;it++){let moved=false;
    for(const s of segs){const rr=r+(s[4]||0),[cx,cy]=closestOnSeg(x,y,s[0],s[1],s[2],s[3]),dx=x-cx,dy=y-cy,d=Math.hypot(dx,dy);
      if(d<rr){if(d>1e-6){x=cx+dx/d*rr;y=cy+dy/d*rr}else{const L=Math.hypot(s[2]-s[0],s[3]-s[1])||1;x=cx-(s[3]-s[1])/L*rr;y=cy+(s[2]-s[0])/L*rr}moved=true}}
    if(!moved)break}
  return[x,y];
}
/* תנועה מ-(x,y) אל (tx,ty) בצעדים קטנים, כדי לא לעבור דרך קיר דק */
function moveWithCollision(x,y,tx,ty,r,segs){
  const D=Math.hypot(tx-x,ty-y),n=Math.max(1,Math.ceil(D/(r/2)));
  const sx=(tx-x)/n,sy=(ty-y)/n;
  for(let i=0;i<n;i++)[x,y]=resolveCircle(x+sx,y+sy,r,segs);
  return[x,y];
}

/* ---------- בדיקת מפה והפיכתה למודל לציור ---------- */
const RE={room:/^r[0-9]{1,4}$/,fx:/^f[0-9]{1,4}$/,door:/^d[0-9]{1,4}$/,wall:/^w[0-9]{1,4}$/,col:/^c[0-9]{1,4}$/,sym:/^y[0-9]{1,4}$/};
/* מחזיר רשימת שגיאות בעברית (ריקה = תקין). לא משנה את המפה. */
function validateMap(map){
  const err=[];if(!map||typeof map!=='object')return['אין מפה'];
  const rooms=live(map.rooms);if(!rooms.length)err.push('במפה אין אף חדר');if(rooms.length>20)err.push('יותר מ-20 חדרים');
  const rid=new Set();
  for(const r of rooms){if(!RE.room.test(r.id||''))err.push('מזהה חדר לא תקין');rid.add(r.id);
    const v=polyValid(r.p);if(!v.ok)err.push('חדר "'+(r.name||r.id)+'": '+v.err);
    if(!inR(r.h,200,600))err.push('חדר "'+(r.name||r.id)+'": גובה התקרה צריך להיות 2 עד 6 מטר')}
  const fx=live(map.fx);if(fx.length>400)err.push('יותר מ-400 גופים');
  const seen=new Set();
  for(const f of fx){const nm='גוף '+(f.num||f.id);
    if(!RE.fx.test(f.id||''))err.push('מזהה גוף לא תקין');else if(seen.has(f.id))err.push(nm+': מזהה כפול');seen.add(f.id);
    if(!FX_KINDS.includes(f.k))err.push(nm+': סוג לא מוכר');
    if(!inR(f.x,0,MAXC)||!inR(f.y,0,MAXC))err.push(nm+': מחוץ למפה');
    if(!inR(f.w,30,2000)||!inR(f.d,20,300)||!inR(f.h,30,300))err.push(nm+': מידות לא תקינות');
    if(!inR(f.a,0,359))err.push(nm+': זווית לא תקינה');
    if(f.sides!==1&&f.sides!==2)err.push(nm+': מספר צדדים 1 או 2');else if(f.sides===2&&!TWO_SIDED.includes(f.k))err.push(nm+': לסוג הזה יש רק צד אחד');
    if(!inR(f.bays,1,30))err.push(nm+': מקטעים 1 עד 30');
    if(!inR(f.lvl,1,12))err.push(nm+': קומות מדף 1 עד 12');
    if(!rid.has(f.room))err.push(nm+': החדר שלו לא קיים')}
  if(bayCount(map)>MAX_BAYS)err.push('יותר מ-'+MAX_BAYS+' מקטעים במפה');
  for(const d of live(map.doors))if(!RE.door.test(d.id||'')||!inR(d.x,0,MAXC)||!inR(d.y,0,MAXC)||!inR(d.w,60,500))err.push('דלת לא תקינה');
  return err;
}
/* מודל מוכן לציור (ס"מ). רכיבים לא תקינים מדולגים ונרשמים ב-skip, כדי שמפה פגומה לא תפיל את התצוגה. */
function buildModel(map){
  const skip=[],numDir=map&&map.numDir==='ltr'?'ltr':'rtl';
  const rooms=[];
  for(const r of live(map&&map.rooms)){const v=polyValid(r.p);if(!v.ok){skip.push((r.name||r.id)+': '+v.err);continue}
    rooms.push({id:r.id,name:String(r.name||''),p:r.p.slice(),h:clamp(r.h|0||300,200,600),area:v.area,tex:r.tex||null})}
  const roomH=new Map(rooms.map(r=>[r.id,r.h]));
  const ok=(o,keys)=>keys.every(k=>Number.isFinite(o[k]));
  const fx=[],bays=[];
  for(const f0 of live(map&&map.fx)){if(!ok(f0,['x','y','w','d','h'])||!FX_KINDS.includes(f0.k)){skip.push('גוף '+(f0.id||'?'));continue}
    const f={id:String(f0.id),k:f0.k,x:clamp(f0.x,0,MAXC),y:clamp(f0.y,0,MAXC),w:clamp(f0.w,30,2000),d:clamp(f0.d,20,300),h:clamp(f0.h,30,300),a:((f0.a|0)%360+360)%360,
      sides:f0.sides===2&&TWO_SIDED.includes(f0.k)?2:1,bays:clamp(f0.bays|0||1,1,30),lvl:clamp(f0.lvl|0||1,1,12),hi:!!f0.hi,glass:!!f0.glass,room:f0.room,num:f0.num|0,name:String(f0.name||'')};
    f.bayList=fxBays(f,numDir);fx.push(f);for(const b of f.bayList)bays.push(b)}
  const pick=(arr,keys,lbl)=>live(arr).filter(o=>{const g=ok(o,keys);if(!g)skip.push(lbl);return g});
  const cols=pick(map&&map.cols,['x','y','w'],'עמוד').map(c=>({id:c.id,x:c.x,y:c.y,w:clamp(c.w,10,300),d:clamp(c.d||c.w,10,300),rnd:!!c.rnd}));
  const doors=pick(map&&map.doors,['x','y','w'],'דלת').map(d=>({id:d.id,x:d.x,y:d.y,w:clamp(d.w,60,500),a:d.a|0,k:['ent','in','emg','wh'].includes(d.k)?d.k:'in'}));
  const syms=pick(map&&map.syms,['x','y'],'סמל').filter(y=>['cash','ent','exit'].includes(y.k)).map(y=>({id:y.id,k:y.k,x:y.x,y:y.y,a:y.a|0}));
  const allP=[].concat(...rooms.map(r=>r.p));
  return{rooms,roomH,walls:roomWallSegs(map),inner:innerWallSegs(map),cols,doors,syms,fx,bays,numDir,
    bounds:allP.length?bounds(allP):[0,0,1000,1000],ent:entrance(map),segs:walkSegments(map),skip};
}
/* האם נקודה בתוך אחד החדרים */
function inAnyRoom(model,x,y){return model.rooms.some(r=>pointInPoly(x,y,r.p))}

/* ---------- מפת דוגמה (לדף הבדיקה בלבד – מסומנת "דוגמה", לא נתוני העסק) ---------- */
function sampleMap(nFx){
  nFx=clamp(nFx|0||24,1,400);
  const cols=Math.ceil(Math.sqrt(nFx*1.6)),rows=Math.ceil(nFx/cols),W=Math.min(MAXC,500+cols*260),H=Math.min(MAXC,900+rows*220);
  const fx=[];let i=0;
  for(let r=0;r<rows&&i<nFx;r++)for(let c=0;c<cols&&i<nFx;c++,i++){
    const k=i%11===5?'fridge':i%13===7?'table':'gon';
    fx.push({id:'f'+(i+1),k,x:350+c*260,y:450+r*220,w:k==='table'?160:200,d:k==='fridge'?80:k==='table'?100:90,h:k==='table'?90:k==='fridge'?200:180,a:k==='fridge'?0:90,
      sides:k==='fridge'?1:2,bays:k==='table'?1:2,lvl:k==='table'?1:5,hi:false,glass:k==='fridge',room:'r1',num:i+1})}
  /* מדפי קיר לאורך הקיר העליון */
  const nw=Math.max(1,Math.floor((W-400)/300));
  for(let k=0;k<nw&&fx.length<400;k++)fx.push({id:'f'+(fx.length+1),k:'wall',x:300+k*300,y:60,w:280,d:50,h:220,a:180,sides:1,bays:2,lvl:6,hi:true,room:'r1',num:0});
  const m={br:'main',kind:'s',name:'דוגמה – חנות לדוגמה',v:1,seq:fx.length+10,grid:50,numDir:'rtl',ent:'d1',
    rooms:[{id:'r1',name:'אולם',p:[0,0,W,0,W,H,0,H],h:320},{id:'r2',name:'מחסן קטן',p:[W,0,Math.min(MAXC,W+400),0,Math.min(MAXC,W+400),400,W,400],h:280}],
    walls:[],cols:[{id:'c1',x:Math.round(W/2),y:Math.round(H/2)+110,w:40,d:40,rnd:true}],
    doors:[{id:'d1',x:Math.round(W*0.7),y:H,w:180,a:0,k:'ent'},{id:'d2',x:W,y:200,w:90,a:90,k:'wh'}],
    fx,syms:[{id:'y1',k:'cash',x:Math.round(W*0.35),y:H-120,a:0},{id:'y2',k:'ent',x:Math.round(W*0.7),y:H-40,a:0},{id:'y3',k:'exit',x:Math.round(W*0.5),y:H-40,a:0}],
    src:'manual',upd:1763100000000,by:'sample'};
  const nums=autoNumber(m),byId=new Map(nums.map(o=>[o.id,o.num]));for(const f of m.fx)f.num=byId.get(f.id);
  return m;
}

return{MAX_BAYS,FX_KINDS,polyArea,polyValid,pointInPoly,centroid,segsCross,toPlan,fxCorners,fxBays,bayCount,entrance,autoNumber,
  cutDoors,roomWallSegs,innerWallSegs,walkSegments,resolveCircle,moveWithCollision,validateMap,buildModel,inAnyRoom,sampleMap};
});
