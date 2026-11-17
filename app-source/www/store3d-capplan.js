/* store3d-capplan.js – תוכנית הצילום של הקמת החנות (שלב 3, משימה 2026-11-17_תהליך-הקמת-חנות). מתמטיקה טהורה, בלי DOM ובלי שרת.
   קובץ משותף: אותו קובץ בדיוק נמצא גם בשרת (firebase/functions/lib/store3d-capplan.js) – בדיקה משווה ביניהם תו-בתו.
   נטען בדפדפן כ-window.S3Plan, וב-Node דרך require.
   capPlan(map) – תוכנית דטרמיניסטית (אותה מפה = אותה תוכנית, בכל מכשיר ובשרת): לכל חדר, מהחדר של הכניסה:
     דלת הכניסה לחדר ← קטעי הקירות ההיקפיים בכיוון השעון מהצלע של הדלת (קטעים עד 250 ס"מ) ← קירות פנימיים (שני הצדדים)
     ← גופים לפי המספור (num, מהכניסה) – כל צד וכל מקטע (מדף גבוה = אותו מפתח, עליון ותחתון) ← דלתות פנימיות וקופות
     ← אריחי רצפה ואחריהם אריחי תקרה (כ-30 מ"ר לתמונה). כל פריט במפה מופיע בתוכנית פעם אחת בדיוק.
   מפתחות (חוזה הנתונים, סעיף 1): b_{bayId}, w_{roomId}-{edge}-{seg}, iw_{wallId}-{a|b}-{seg}, d_{doorId}, k_{symId}, fl_{roomId}-{n}, ce_{roomId}-{n}.
   עמודים (c_) לא בתוכנית בשלב הזה (תוספת לא חובה בחוזה).
   geoMoved / itemState / summary – מצב פריט מול מסמך cap/{key} (חוזה 3.3): גיאומטריה שזזה > 30 ס"מ או > 5 מעלות = "צריך לצלם שוב". */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.S3Plan=factory()})(typeof self!=='undefined'?self:this,function(){
'use strict';
const PLAN_MAX=5000,SEG=250,TILE=548/* 548×548 ס"מ ≈ 30 מ"ר */,MOVE=30,ANG=5,DOOR_OFF=40,MAXC=10000;
const TWO=['gon','table','stand'];
const KEY_RE=/^(b_f[0-9]{1,4}-[ab]-[0-9]{1,2}|w_r[0-9]{1,4}-[0-9]{1,2}-[0-9]{1,2}|iw_w[0-9]{1,4}-[ab]-[0-9]{1,2}|fl_r[0-9]{1,4}-[0-9]{1,3}|ce_r[0-9]{1,4}-[0-9]{1,3}|d_d[0-9]{1,4}|k_y[0-9]{1,4}|c_c[0-9]{1,4})$/;
const isObj=o=>!!o&&typeof o==='object'&&!Array.isArray(o);
const fin=v=>typeof v==='number'&&Number.isFinite(v);
const live=a=>(Array.isArray(a)?a:[]).filter(o=>isObj(o)&&o.del!==1&&typeof o.id==='string');
const idNum=id=>parseInt(String(id).replace(/^[a-z]+/,''),10)||0;
const byId=(a,b)=>idNum(a.id)-idNum(b.id)||(a.id<b.id?-1:a.id>b.id?1:0);
const R=v=>Math.min(MAXC,Math.max(0,Math.round(v)));
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));

/* ---------- גיאומטריה ---------- */
function polyArea(p){let s=0;const n=p.length/2;for(let i=0;i<n;i++){const j=(i+1)%n;s+=p[2*i]*p[2*j+1]-p[2*j]*p[2*i+1]}return s/2}
const polyOk=p=>Array.isArray(p)&&p.length>=6&&p.length<=80&&p.length%2===0&&p.every(fin)&&Math.abs(polyArea(p))>0;
function inPoly(x,y,p){let c=false;const n=p.length/2;for(let i=0,j=n-1;i<n;j=i++){const xi=p[2*i],yi=p[2*i+1],xj=p[2*j],yj=p[2*j+1];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)c=!c}return c}
function centroid(p){let x=0,y=0;const n=p.length/2;for(let i=0;i<n;i++){x+=p[2*i];y+=p[2*i+1]}return[x/n,y/n]}
/* מרחק נקודה מקטע, והמיקום לאורכו (t, 0..L) */
function segDist(px,py,x1,y1,x2,y2){const dx=x2-x1,dy=y2-y1,L=Math.hypot(dx,dy);if(!L)return{d:Math.hypot(px-x1,py-y1),t:0,L};const t=((px-x1)*dx+(py-y1)*dy)/L;return{d:Math.abs((px-x1)*dy-(py-y1)*dx)/L,t,L}}
/* באיזו צלע של החדר הדלת (0..n-1), או -1 */
function doorEdge(p,d){const n=p.length/2;let best=-1,bd=Infinity;
  for(let i=0;i<n;i++){const j=(i+1)%n,s=segDist(d.x,d.y,p[2*i],p[2*i+1],p[2*j],p[2*j+1]);if(s.d<=DOOR_OFF&&s.t>-1&&s.t<s.L+1&&s.d<bd){bd=s.d;best=i}}
  return best}
/* קטע [x1,y1,x2,y2] => רשימת קטעים שווים עד SEG ס"מ */
function split(x1,y1,x2,y2){const L=Math.hypot(x2-x1,y2-y1),k=Math.max(1,Math.ceil(L/SEG-1e-9)),o=[];
  for(let s=0;s<k;s++)o.push([R(x1+(x2-x1)*s/k),R(y1+(y2-y1)*s/k),R(x1+(x2-x1)*(s+1)/k),R(y1+(y2-y1)*(s+1)/k)]);return o}
/* חזית מקטע של גוף (כמו S3G.fxBays): [x1,y1,x2,y2] בתוכנית */
function bayGeo(f,side,n,numDir){
  const nb=clamp(f.bays|0,1,30),bw=f.w/nb,r=(f.a||0)*Math.PI/180,c=Math.cos(r),s=Math.sin(r),ny0=side==='b'?-1:1,rx=ny0,dir=(numDir==='ltr'?-1:1)*rx;
  const lx=dir*(f.w/2-(n-.5)*bw),ly=ny0*f.d/2,P=(ax,ay)=>[f.x+ax*c-ay*s,f.y+ax*s+ay*c];
  const a=P(lx-bw/2,ly),b=P(lx+bw/2,ly);return[R(a[0]),R(a[1]),R(b[0]),R(b[1])]}

/* ---------- התוכנית ---------- */
function capPlan(map){
  const out=[];if(!isObj(map))return{items:out,n:0,big:false};
  const numDir=map.numDir==='ltr'?'ltr':'rtl';
  const rooms=live(map.rooms).filter(r=>/^r[0-9]{1,4}$/.test(r.id)&&polyOk(r.p)).sort(byId);
  if(!rooms.length)return{items:out,n:0,big:false};
  const doors=live(map.doors).filter(d=>/^d[0-9]{1,4}$/.test(d.id)&&fin(d.x)&&fin(d.y)).sort(byId);
  const cash=live(map.syms).filter(y=>y.k==='cash'&&/^y[0-9]{1,4}$/.test(y.id)&&fin(y.x)&&fin(y.y)).sort(byId);
  const fxs=live(map.fx).filter(f=>/^f[0-9]{1,4}$/.test(f.id)&&fin(f.x)&&fin(f.y)&&fin(f.w)&&fin(f.d)&&(f.bays|0)>=1);
  const walls=live(map.walls).filter(w=>/^w[0-9]{1,4}$/.test(w.id)&&Array.isArray(w.p)&&w.p.length===4&&w.p.every(fin)).sort(byId);
  /* הכניסה: map.ent, אחרת דלת מסוג ent, אחרת סמל כניסה, אחרת הדלת הראשונה */
  const entD=doors.find(d=>d.id===map.ent)||doors.find(d=>d.k==='ent')||null;
  const entY=live(map.syms).find(y=>y.k==='ent'&&fin(y.x)&&fin(y.y));
  const E=entD||entY||doors[0]||null;
  const roomAt=(x,y)=>rooms.find(r=>inPoly(x,y,r.p))||null;
  const near=(x,y)=>{let b=rooms[0],bd=Infinity;for(const r of rooms){const c=centroid(r.p),d=Math.hypot(c[0]-x,c[1]-y);if(d<bd){bd=d;b=r}}return b};
  /* סדר החדרים: החדר של הכניסה, ואחריו לפי המרחק מהכניסה (ואז לפי המזהה) */
  let first=null;
  if(E){first=(entD&&rooms.find(r=>doorEdge(r.p,entD)>=0))||roomAt(E.x,E.y)||near(E.x,E.y)}
  first=first||rooms[0];
  const ex=E?E.x:centroid(first.p)[0],ey=E?E.y:centroid(first.p)[1];
  const order=[first].concat(rooms.filter(r=>r!==first).map(r=>{const c=centroid(r.p);return{r,d:Math.round(Math.hypot(c[0]-ex,c[1]-ey))}}).sort((a,b)=>a.d-b.d||byId(a.r,b.r)).map(o=>o.r));
  const rank=new Map(order.map((r,i)=>[r.id,i]));
  /* שיוך כל פריט לחדר אחד בלבד */
  const roomOfPt=(x,y)=>roomAt(x,y)||near(x,y);
  const doorRoom=new Map();
  for(const d of doors){let r=order.find(rr=>doorEdge(rr.p,d)>=0);if(!r)r=roomOfPt(d.x,d.y);doorRoom.set(d.id,r.id)}
  const fxRoom=new Map();for(const f of fxs){const r=rooms.find(rr=>rr.id===f.room)||roomOfPt(f.x,f.y);fxRoom.set(f.id,r.id)}
  const cashRoom=new Map();for(const y of cash)cashRoom.set(y.id,roomOfPt(y.x,y.y).id);
  const wallRoom=new Map();for(const w of walls)wallRoom.set(w.id,roomOfPt((w.p[0]+w.p[2])/2,(w.p[1]+w.p[3])/2).id);
  const done=new Set();
  const push=(o)=>{if(done.has(o.key))return;done.add(o.key);o.ord=out.length+1;out.push(o)};
  for(const r of order){
    const p=r.p,n=p.length/2;
    /* הדלת שממנה נכנסים לחדר: הכניסה (בחדר הראשון), אחרת דלת שמחברת לחדר שכבר צולם, אחרת הדלת הראשונה בהיקף */
    const onEdge=doors.map(d=>({d,e:doorEdge(p,d)})).filter(o=>o.e>=0);
    let st=null;
    if(r===first&&entD)st=onEdge.find(o=>o.d.id===entD.id)||null;
    if(!st)st=onEdge.find(o=>rank.get(doorRoom.get(o.d.id))<rank.get(r.id))||null;
    if(!st)st=onEdge.find(o=>doorRoom.get(o.d.id)===r.id)||onEdge[0]||null;
    if(st&&doorRoom.get(st.d.id)===r.id)push({key:'d_'+st.d.id,k:'d',room:r.id,ref:st.d.id,geo:[R(st.d.x),R(st.d.y),R(st.d.w||0),R(((st.d.a|0)%360+360)%360)],lv:['a']});
    /* קירות היקפיים בכיוון השעון (על המסך, y למטה: שטח חיובי = עם כיוון השעון) */
    /* מתחילים מהדלת עצמה: בצלע של הדלת – קודם הקטעים שאחרי הדלת (בכיוון ההליכה), והקטעים שלפניה בסוף הסיבוב */
    const cw=polyArea(p)>0,e0=st?st.e:0,tail=[];
    for(let s=0;s<n;s++){const e=cw?(e0+s)%n:((e0-s)%n+n)%n,j=(e+1)%n;
      const segs=split(p[2*e],p[2*e+1],p[2*j],p[2*j+1]);
      const idx=segs.map((g,i)=>i);if(!cw)idx.reverse();
      const L=Math.hypot(p[2*j]-p[2*e],p[2*j+1]-p[2*e+1])||1,dt=st&&s===0?segDist(st.d.x,st.d.y,p[2*e],p[2*e+1],p[2*j],p[2*j+1]).t:null;
      for(const i of idx){const g=segs[i],o={key:'w_'+r.id+'-'+(e+1)+'-'+(i+1),k:'w',room:r.id,ref:r.id,edge:e+1,seg:i+1,geo:cw?g:[g[2],g[3],g[0],g[1]],lv:['a']};
        const mid=L*(i+.5)/segs.length;
        if(dt!==null&&(cw?mid<dt:mid>dt))tail.push(o);else push(o)}}
    for(const o of tail)push(o);
    /* קירות פנימיים: שני הצדדים */
    for(const w of walls){if(wallRoom.get(w.id)!==r.id)continue;
      const segs=split(w.p[0],w.p[1],w.p[2],w.p[3]);
      for(const sd of ['a','b'])segs.forEach((g,i)=>push({key:'iw_'+w.id+'-'+sd+'-'+(i+1),k:'iw',room:r.id,ref:w.id,side:sd,seg:i+1,geo:sd==='a'?g:[g[2],g[3],g[0],g[1]],lv:['a']}))}
    /* גופים לפי המספור מהכניסה */
    const fl=fxs.filter(f=>fxRoom.get(f.id)===r.id).sort((a,b)=>((a.num|0)||1e6)-((b.num|0)||1e6)||byId(a,b));
    for(const f of fl){const sides=f.sides===2&&TWO.includes(f.k)?['a','b']:['a'],nb=clamp(f.bays|0,1,30);
      for(const sd of sides)for(let i=1;i<=nb;i++)push({key:'b_'+f.id+'-'+sd+'-'+i,k:'b',room:r.id,ref:f.id,side:sd,n:i,num:f.num|0,hi:f.hi===true,geo:bayGeo(f,sd,i,numDir),lv:f.hi===true?['t','b']:['a']})}
    /* דלתות פנימיות וקופות */
    for(const d of doors)if(doorRoom.get(d.id)===r.id)push({key:'d_'+d.id,k:'d',room:r.id,ref:d.id,geo:[R(d.x),R(d.y),R(d.w||0),R(((d.a|0)%360+360)%360)],lv:['a']});
    for(const y of cash)if(cashRoom.get(y.id)===r.id)push({key:'k_'+y.id,k:'k',room:r.id,ref:y.id,geo:[R(y.x),R(y.y),R(y.w||60),R(((y.a|0)%360+360)%360)],lv:['a']});
    /* רצפה ותקרה: רשת אריחים על המלבן החוסם, רק אריחים שנוגעים בחדר; שורות הלוך-חזור (נוח ללכת) */
    let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;for(let i=0;i<n;i++){x0=Math.min(x0,p[2*i]);x1=Math.max(x1,p[2*i]);y0=Math.min(y0,p[2*i+1]);y1=Math.max(y1,p[2*i+1])}
    const nx=Math.max(1,Math.ceil((x1-x0)/TILE-1e-9)),ny=Math.max(1,Math.ceil((y1-y0)/TILE-1e-9)),tw=(x1-x0)/nx,td=(y1-y0)/ny,tiles=[];
    for(let j=0;j<ny;j++)for(let q=0;q<nx;q++){const i=j%2?nx-1-q:q;let hit=false;
      for(let a=0;a<3&&!hit;a++)for(let b=0;b<3&&!hit;b++)if(inPoly(x0+tw*(i+(a+.5)/3),y0+td*(j+(b+.5)/3),p))hit=true;
      if(hit&&tiles.length<999)tiles.push([R(x0+tw*i),R(y0+td*j),R(tw),R(td)])}
    tiles.forEach((g,i)=>push({key:'fl_'+r.id+'-'+(i+1),k:'fl',room:r.id,ref:r.id,n:i+1,geo:g,lv:['a']}));
    tiles.forEach((g,i)=>push({key:'ce_'+r.id+'-'+(i+1),k:'ce',room:r.id,ref:r.id,n:i+1,geo:g,lv:['a']}));
  }
  return{items:out,n:out.length,big:out.length>PLAN_MAX};
}

/* ---------- מצב פריט ---------- */
const ANGK=['d','k','c'];
/* האם הגיאומטריה זזה: אחד מ-4 המספרים ביותר מ-30 ס"מ (בדלת/קופה/עמוד – 3 הראשונים, והזווית ביותר מ-5 מעלות). בלי geo שמור – לא זז */
function geoMoved(old,cur,k){
  if(!Array.isArray(old)||old.length!==4||!Array.isArray(cur)||cur.length!==4)return false;
  const ang=ANGK.includes(k);
  for(let i=0;i<4;i++){if(ang&&i===3){const d=Math.abs(((old[3]-cur[3])%360+540)%360-180);if(d>ANG)return true}else if(Math.abs(old[i]-cur[i])>MOVE)return true}
  return false}
const hasPh=d=>Array.isArray(d.ph)&&d.ph.length>0;
/* מצב לתצוגה ולסיום: todo / part / ok / skip. מסמך חסר = todo; ok שזז = part; skip עם סיבה נשאר skip */
function itemState(doc,item){
  if(!isObj(doc))return 'todo';
  if(doc.st==='skip'&&typeof doc.why==='string'&&doc.why.trim())return 'skip';
  const moved=!!item&&geoMoved(doc.geo,item.geo,item.k);
  if(doc.st==='ok'&&!moved)return 'ok';
  if(hasPh(doc)||doc.fr)return 'part';
  return 'todo'}
/* סיכום: docs = { key: מסמך cap }. miss = המפתחות שעוד לא ok ולא skip, לפי סדר הצילום */
function summary(plan,docs){
  const c={n:0,ok:0,part:0,skip:0,todo:0,miss:[],moved:0};
  for(const it of (plan&&plan.items)||[]){const d=docs&&docs[it.key],s=itemState(d,it);c.n++;c[s]++;
    if(s!=='ok'&&s!=='skip')c.miss.push(it.key);if(isObj(d)&&d.st==='ok'&&s==='part')c.moved++}
  c.done=c.ok+c.skip;c.all=c.n>0&&c.done===c.n;return c}
/* תווית בעברית לפריט (למסך) */
function label(it,map){
  if(!it)return '';
  const fx=it.k==='b'&&map?live(map.fx).find(f=>f.id===it.ref):null;
  const room=map?live(map.rooms).find(r=>r.id===it.room):null,rn=room&&room.name?' · '+String(room.name).slice(0,30):'';
  switch(it.k){
    case 'b':return 'גוף '+((fx&&fx.num)||it.num||it.ref)+(fx&&fx.name?' ('+String(fx.name).slice(0,30)+')':'')+' · '+(it.side==='b'?'צד שני':'צד ראשי')+' · מקטע '+it.n;
    case 'w':return 'קיר '+it.edge+' · קטע '+it.seg+rn;
    case 'iw':return 'קיר פנימי '+idNum(it.ref)+' · '+(it.side==='b'?'צד שני':'צד ראשון')+' · קטע '+it.seg;
    case 'd':return 'דלת '+idNum(it.ref)+rn;
    case 'k':return 'קופה '+idNum(it.ref)+rn;
    case 'fl':return 'רצפה · אזור '+it.n+rn;
    case 'ce':return 'תקרה · אזור '+it.n+rn;
    default:return it.key}}
/* הנחיית צילום קצרה לפי סוג הפריט */
function guide(it){
  switch(it&&it.k){
    case 'b':return it.hi?'מדף גבוה: צלמו תמונה עליונה ותמונה תחתונה, ישר מול המקטע, כך ששני הקצוות נראים.':'עמדו ישר מול המקטע, וצלמו כך ששני הקצוות וכל המדפים נכנסים בתמונה.';
    case 'w':case 'iw':return 'עמדו מול הקיר וצלמו את כל הקטע המסומן, מהרצפה ועד התקרה.';
    case 'd':return 'צלמו את הדלת מבפנים, כולה, עם המשקוף.';
    case 'k':return 'צלמו את עמדת הקופה מלפנים, כולל הדלפק.';
    case 'fl':return 'כוונו את הטלפון אל הרצפה באזור המסומן וצלמו.';
    case 'ce':return 'כוונו את הטלפון אל התקרה באזור המסומן וצלמו (כולל תאורה).';
    default:return ''}}
return{PLAN_MAX,SEG,TILE,MOVE,ANG,KEY_RE,capPlan,geoMoved,itemState,summary,label,guide,bayGeo,doorEdge};
});
