/* סריקת חנות בתלת מימד – שלב 4: עורך המפה (משימה 2026-11-14_סריקת-חנות-תלת-מימד).
   קובץ עצמאי, נטען אחרי store3d.js. מוסיף את המסך V.st3e ואת S3UI.openEditor. מי רשאי: מנהל, מנהל־על, ועובד עם המתג s3m ("שרטוט מפה").
   עריכה: הקשה על המפה מציבה פינות של חדר (ברשת), גופים (גונדולה, מדף קיר, מקרר, שולחן, מעמד, סל), דלתות, עמודים וסמלים. מספור גופים אוטומטי
   מהכניסה (S3G.autoNumber) + שם חופשי. חדר לא חוקי נחסם בהודעה בעברית (S3G.polyValid). כל שינוי נשמר גם כטיוטה בטלפון.
   שמירה: פונקציית השרת s3SaveMap ({mapId,baseV,map,why}) – היא שומרת את הגרסה הקודמת באותה טרנזקציה (חוזה 4.3–4.4). גרסאות קודמות: smap/{id}/ver (קריאה),
   שחזור = שמירה חדשה. מחיקה: רק מנהל, עם אישור כפול, ורק כסימון del:1 (סל מחזור) – לא מוחקים רשומה. מנהל־על: סניף ומחסן (s3SetBranch). */
(function(){
'use strict';
const U=window.S3UI;
if(!U||typeof ACT==='undefined'||typeof V==='undefined'||typeof CHG==='undefined')return;
const G=()=>window.S3G;
const esc2=s=>typeof esc==='function'?esc(s):String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const E={key:'',kind:'s',map:null,baseV:0,fresh:new Set(),undo:[],tool:'sel',fxk:'gon',drk:'ent',syk:'cash',pts:[],sel:null,msg:'',sec:'',vx:0,vy:0,vw:2000,dirty:false,busy:0,vers:null,offer:null,tm:0};
U.E=E;
const KEYS=['rooms','walls','cols','doors','fx','syms'];
const clone=o=>JSON.parse(JSON.stringify(o));
const clampN=(v,a,b)=>Math.min(b,Math.max(a,v));
const now=()=>Date.now();
const mid=()=>U.mapIdOf(E.kind,U.brSel());
const live=a=>(Array.isArray(a)?a:[]).filter(o=>o&&o.del!==1);
const MAXN={rooms:20,walls:100,cols:100,doors:40,fx:400,syms:40};
const FXN={gon:'גונדולה',wall:'מדף קיר',fridge:'מקרר',table:'שולחן',stand:'מעמד',bin:'סל'};
const FXD={gon:{w:200,d:90,h:180,sides:2,bays:2,lvl:5},wall:{w:300,d:50,h:220,sides:1,bays:3,lvl:6},fridge:{w:200,d:80,h:200,sides:1,bays:2,lvl:4},table:{w:160,d:100,h:90,sides:1,bays:1,lvl:1},stand:{w:80,d:60,h:160,sides:1,bays:1,lvl:4},bin:{w:100,d:70,h:60,sides:1,bays:1,lvl:1}};
const TWO=['gon','table','stand'];
const DRN={ent:'כניסה',in:'דלת פנימית',emg:'יציאת חירום',wh:'למחסן'},SYN={cash:'קופה',ent:'כניסה',exit:'יציאה'};
const TN={rooms:'חדר',fx:'גוף',doors:'דלת',cols:'עמוד',syms:'סמל',walls:'קיר'};

/* ---------- מצב העבודה ---------- */
const draftKey=()=>LK('lp-s3e:'+mid());
const readDraft=()=>{try{const v=JSON.parse(localStorage.getItem(draftKey()));return v&&v.map&&typeof v.map==='object'?v:null}catch(e){return null}};
const saveDraftNow=()=>{try{if(E.map)localStorage.setItem(draftKey(),JSON.stringify({baseV:E.baseV,map:E.map,at:now()}))}catch(e){}};
const dropDraft=()=>{try{localStorage.removeItem(draftKey())}catch(e){}};
function touch(){E.dirty=true;clearTimeout(E.tm);E.tm=setTimeout(saveDraftNow,400)}
function snap(){try{E.undo.push(JSON.stringify(E.map));if(E.undo.length>25)E.undo.shift()}catch(e){}}
function blank(){const L=U.brs(),b=L.find(x=>x.id===U.brSel());
 return{br:U.brSel(),kind:E.kind,name:(E.kind==='w'?'המחסן':'החנות')+(L.length>1&&b?' – '+b.name:''),seq:0,grid:50,numDir:'rtl',rooms:[],walls:[],cols:[],doors:[],fx:[],syms:[],src:'manual'}}
function fit(){
 const m=E.map,ps=[];for(const r of live(m&&m.rooms))for(let i=0;i+1<r.p.length;i+=2)ps.push([r.p[i],r.p[i+1]]);
 let a=0,b=0,c=2000,d=1500;if(ps.length){a=Math.min(...ps.map(p=>p[0]));b=Math.min(...ps.map(p=>p[1]));c=Math.max(...ps.map(p=>p[0]));d=Math.max(...ps.map(p=>p[1]))}
 const w=Math.max(400,c-a)*1.1,h=Math.max(300,d-b)*1.1;E.vw=Math.max(w,h*1.2);E.vx=(a+c)/2-E.vw/2;E.vy=(b+d)/2-E.vw*.45}
function init(){
 const d=U.data(),m=d&&d.maps[E.kind];
 E.key=U.mapIdOf(E.kind)+'|'+(SY&&SY.bizId||'');
 E.map=m?clone(m):blank();E.baseV=m&&Number.isInteger(m.v)?m.v:0;
 for(const k of KEYS)if(!Array.isArray(E.map[k]))E.map[k]=[];
 if(!E.map.grid)E.map.grid=50;
 E.fresh=new Set();E.undo=[];E.tool='sel';E.pts=[];E.sel=null;E.msg='';E.sec='';E.dirty=false;E.vers=null;E.wiz=null;
 const dr=readDraft();E.offer=dr&&dr.baseV===E.baseV&&JSON.stringify(dr.map)!==JSON.stringify(E.map)?dr:null;
 fit()}
/* שלב 11 (אשף ההקמה): טעינת טיוטה (מפה שעוד לא נשמרה) לעורך. כל הפריטים "חדשים" (אפשר להסיר אותם), baseV=0. מי שקורא: store3d-wizard.js */
U.edLoad=(map,kind,wiz)=>{E.kind=kind==='w'?'w':'s';E.map=clone(map);for(const k of KEYS)if(!Array.isArray(E.map[k]))E.map[k]=[];if(!Array.isArray(E.map.uz))E.map.uz=[];if(!E.map.grid)E.map.grid=50;
 E.baseV=0;E.fresh=new Set();for(const t of KEYS)for(const o of E.map[t])if(o&&o.id)E.fresh.add(t+':'+o.id);
 E.undo=[];E.tool='sel';E.pts=[];E.sel=null;E.msg='';E.sec='';E.dirty=true;E.vers=null;E.offer=null;E.wiz=wiz||{};E.key=U.mapIdOf(E.kind)+'|'+(SY&&SY.bizId||'');
 renum();fit();saveDraftNow();if(cur().v!=='st3e')go('st3e');else rerender()};
U.edTouch=()=>{touch();rerender()};U.edDraw=()=>draw();U.edFit=()=>{fit();draw()};
function renum(){const G0=G();if(!G0)return;const by=new Map(G0.autoNumber(E.map).map(o=>[o.id,o.num]));for(const f of E.map.fx)if(by.has(f.id))f.num=by.get(f.id)}
function nextId(t,p){let n=0;const re=new RegExp('^'+p+'([0-9]+)$');for(const o of E.map[t]){const m=re.exec(o.id||'');if(m)n=Math.max(n,+m[1])}return p+(n+1)}
const roomAt=(x,y)=>live(E.map.rooms).find(r=>G().pointInPoly(x,y,r.p));
const snapV=v=>{const g=E.map.grid||50;return clampN(Math.round(v/g)*g,0,10000)};
const findSel=()=>{if(!E.sel)return null;const o=(E.map[E.sel.t]||[]).find(x=>x.id===E.sel.id&&x.del!==1);return o||null};
function limit(t){if(E.map[t].length>=MAXN[t]){E.msg='אי אפשר להוסיף עוד '+TN[t]+' (המקסימום הוא '+MAXN[t]+').';return false}return true}

/* ---------- הקשה על המפה ---------- */
function addAt(x,y){
 const t=E.tool;E.msg='';
 if(t==='room'){E.pts.push(snapV(x),snapV(y));return}
 if(t==='fx'){
  if(!limit('fx'))return;const r=roomAt(x,y);if(!r){E.msg='מקמו את הגוף בתוך חדר. קודם ציירו חדר.';return}
  if(E.map.seq>=9999){E.msg='נגמרו המזהים במפה.';return}
  snap();const k=E.fxk,d=FXD[k];E.map.seq=(E.map.seq|0)+1;
  const f=Object.assign({id:'f'+E.map.seq,k,x:snapV(x),y:snapV(y),a:0,hi:d.lvl>=6,room:r.id,num:1},d);if(k==='fridge')f.glass=false;
  E.map.fx.push(f);E.fresh.add('fx:'+f.id);renum();E.sel={t:'fx',id:f.id};E.tool='sel';return}
 if(t==='door'){if(!limit('doors'))return;snap();const k=E.drk,o={id:nextId('doors','d'),x:snapV(x),y:snapV(y),w:k==='ent'?180:100,a:0,k};E.map.doors.push(o);if(k==='ent'&&!E.map.ent)E.map.ent=o.id;E.fresh.add('doors:'+o.id);renum();E.sel={t:'doors',id:o.id};E.tool='sel';return}
 if(t==='col'){if(!limit('cols'))return;snap();const o={id:nextId('cols','c'),x:snapV(x),y:snapV(y),w:40,d:40,rnd:false};E.map.cols.push(o);E.fresh.add('cols:'+o.id);E.sel={t:'cols',id:o.id};E.tool='sel';return}
 if(t==='sym'){if(!limit('syms'))return;snap();const o={id:nextId('syms','y'),k:E.syk,x:snapV(x),y:snapV(y),a:0};E.map.syms.push(o);E.fresh.add('syms:'+o.id);renum();E.sel={t:'syms',id:o.id};E.tool='sel';return}
 if(t==='move'){const o=findSel();if(!o||!('x'in o)){E.msg='קודם בחרו פריט להזזה.';E.tool='sel';return}
  const nx=snapV(x),ny=snapV(y);let rm=null;
  if(E.sel.t==='fx'){rm=roomAt(nx,ny);if(!rm){E.msg='הגוף חייב להישאר בתוך חדר.';return}}
  snap();o.x=nx;o.y=ny;if(rm)o.room=rm.id;renum();E.tool='sel';return}
 /* בחירה */
 E.sel=hit(x,y)}
function hit(x,y){
 const m=E.map,tol=Math.max(30,E.vw/20);
 const near=(o,r)=>Math.hypot(o.x-x,o.y-y)<=Math.max(r,tol);
 for(const o of live(m.syms))if(near(o,40))return{t:'syms',id:o.id};
 for(const o of live(m.doors))if(near(o,o.w/2))return{t:'doors',id:o.id};
 for(const o of live(m.cols))if(near(o,Math.max(o.w,o.d)/2))return{t:'cols',id:o.id};
 for(const o of live(m.fx).slice().reverse()){const c=G().fxCorners(o).flat();if(G().pointInPoly(x,y,c)||near(o,Math.min(o.w,o.d)/2+10))return{t:'fx',id:o.id}}
 for(const o of live(m.rooms).slice().reverse())if(G().pointInPoly(x,y,o.p))return{t:'rooms',id:o.id};
 return null}

/* ---------- ציור המפה (SVG בס"מ) ---------- */
/* צבעי השרטוט נלקחים מטוקני העיצוב של האפליקציה (לא צבעים קשיחים) */
function tk(){const cs=getComputedStyle(document.documentElement),g=(k,d)=>(cs.getPropertyValue('--'+k)||'').trim()||d;return{line:g('line','#888'),card:g('card','#222'),ink:g('ink','#eee'),mut:g('mut','#999'),acc:g('acc','#c80'),acc2:g('acc2','#444'),onacc:g('onacc','#fff'),inc:g('inc','#3a3'),bad:g('bad','#e55'),warn:g('warn','#ca3')}}
function planSvg(){
 const m=E.map,K=tk();if(!m)return '';const el=document.getElementById('s3pl'),rw=el?el.clientWidth:340,rh=el?el.clientHeight:380,vw=E.vw,vh=vw*(rh/Math.max(rw,1));
 const px=vw/Math.max(rw,1),fs=Math.max(18,px*13),sel=E.sel;let s='';
 const g=m.grid||50;let gs=g;while(gs/px<10)gs*=2;
 const x0=Math.floor(Math.max(0,E.vx)/gs)*gs,x1=Math.min(10000,E.vx+vw),y0=Math.floor(Math.max(0,E.vy)/gs)*gs,y1=Math.min(10000,E.vy+vh);
 let n=0;for(let x=x0;x<=x1&&n<200;x+=gs,n++)s+=`<line x1="${x}" y1="${Math.max(0,E.vy)}" x2="${x}" y2="${y1}" stroke="${K.line}" stroke-opacity=".6" stroke-width="${px}"/>`;
 n=0;for(let y=y0;y<=y1&&n<200;y+=gs,n++)s+=`<line x1="${Math.max(0,E.vx)}" y1="${y}" x2="${x1}" y2="${y}" stroke="${K.line}" stroke-opacity=".6" stroke-width="${px}"/>`;
 const isS=(t,id)=>sel&&sel.t===t&&sel.id===id;
 for(const r of live(m.rooms)){const pts=[];for(let i=0;i+1<r.p.length;i+=2)pts.push(r.p[i]+','+r.p[i+1]);const c=G().centroid(r.p);
  s+=`<polygon points="${pts.join(' ')}" fill="${isS('rooms',r.id)?K.acc2:K.card}" stroke="${K.acc}" stroke-width="${px*(isS('rooms',r.id)?4:2)}"/><text x="${c[0]}" y="${c[1]}" fill="${K.mut}" font-size="${fs}" text-anchor="middle">${esc2(r.name)}</text>`}
 for(const w of live(m.walls)){if(w.p&&w.p.length===4)s+=`<line x1="${w.p[0]}" y1="${w.p[1]}" x2="${w.p[2]}" y2="${w.p[3]}" stroke="${K.acc}" stroke-width="${Math.max(w.t||10,px*2)}"/>`}
 for(const o of live(m.cols)){const sw=isS('cols',o.id)?px*4:px;s+=o.rnd?`<ellipse cx="${o.x}" cy="${o.y}" rx="${o.w/2}" ry="${o.d/2}" fill="${K.mut}" stroke="${K.ink}" stroke-width="${sw}"/>`:`<rect x="${o.x-o.w/2}" y="${o.y-o.d/2}" width="${o.w}" height="${o.d}" fill="${K.mut}" stroke="${K.ink}" stroke-width="${sw}"/>`}
 for(const f of live(m.fx)){const sw=isS('fx',f.id)?px*4:px*1.5,col=f.k==='fridge'?K.inc:f.k==='wall'?K.warn:f.k==='gon'?K.acc:K.mut;
  s+=`<g transform="translate(${f.x} ${f.y}) rotate(${f.a||0})"><rect x="${-f.w/2}" y="${-f.d/2}" width="${f.w}" height="${f.d}" fill="${col}" fill-opacity=".75" stroke="${K.ink}" stroke-width="${sw}"/><line x1="${-f.w/2}" y1="${f.d/2}" x2="${f.w/2}" y2="${f.d/2}" stroke="${K.ink}" stroke-width="${px*3}"/></g><text x="${f.x}" y="${f.y+fs*.35}" fill="${K.ink}" stroke="${K.card}" stroke-width="${px*.8}" paint-order="stroke" font-size="${fs}" font-weight="700" text-anchor="middle">${f.num||''}</text>`}
 for(const o of live(m.doors)){const col={ent:K.inc,in:K.acc,emg:K.bad,wh:K.warn}[o.k]||K.acc;
  s+=`<g transform="translate(${o.x} ${o.y}) rotate(${o.a||0})"><line x1="${-o.w/2}" y1="0" x2="${o.w/2}" y2="0" stroke="${col}" stroke-width="${isS('doors',o.id)?px*9:px*6}" stroke-linecap="round"/></g>`}
 for(const o of live(m.syms)){s+=`<circle cx="${o.x}" cy="${o.y}" r="${isS('syms',o.id)?px*17:px*13}" fill="${K.card}" stroke="${K.acc}" stroke-width="${px*2}"/><text x="${o.x}" y="${o.y+fs*.35}" fill="${K.ink}" font-size="${fs*.8}" text-anchor="middle">${esc2((SYN[o.k]||'?').slice(0,1))}</text>`}
 if(E.pts.length){const pp=[];for(let i=0;i+1<E.pts.length;i+=2)pp.push(E.pts[i]+','+E.pts[i+1]);
  s+=`<polyline points="${pp.join(' ')}" fill="none" stroke="${K.ink}" stroke-width="${px*2}" stroke-dasharray="${px*6} ${px*4}"/>`;
  for(let i=0;i+1<E.pts.length;i+=2)s+=`<circle cx="${E.pts[i]}" cy="${E.pts[i+1]}" r="${px*(i?6:9)}" fill="${i?K.acc:K.inc}"/>`}
 /* שלב 11: אזורים לא ודאיים מטיוטת ה-AI – מסגרת מקווקווה, בולטת עד שהמנהל עבר עליהם (x,y = פינה, w,d = מידות) */
 for(let i=0;i<(Array.isArray(m.uz)?m.uz.length:0);i++){const z=m.uz[i];if(!z||!isFinite(z.x))continue;const cur2=E.wiz&&E.wiz.zi===i;
  s+=`<rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.d}" fill="${z.ok?'none':K.warn}" fill-opacity=".18" stroke="${z.ok?K.inc:K.warn}" stroke-width="${px*(cur2?5:2.5)}" stroke-dasharray="${px*8} ${px*5}"/><text x="${z.x+z.w/2}" y="${z.y+z.d/2+fs*.35}" fill="${K.ink}" stroke="${K.card}" stroke-width="${px*.8}" paint-order="stroke" font-size="${fs}" font-weight="700" text-anchor="middle">${z.ok?'✓':'?'}${i+1}</text>`}
 /* שלב 18ד: נקודות 360 (store3d-pano-ui.js) */
 if(U.pano&&E.tool==='pano')try{s+=U.pano.svg(px,fs,K)}catch(e){}
 return `<svg viewBox="${E.vx} ${E.vy} ${vw} ${vh}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style="display:block;touch-action:none">${s}</svg>`}
function draw(){const el=document.getElementById('s3pl');if(el)el.innerHTML=planSvg()}
U.afterEd=()=>{if(cur().v==='st3e')draw()};

/* ---------- מגע: הזזה, צביטה והקשה ---------- */
{const P=new Map();let g=null;
 const el=()=>document.getElementById('s3pl');
 const toCm=(cx,cy)=>{const r=el().getBoundingClientRect(),sc=E.vw/r.width;return[E.vx+(cx-r.left)*sc,E.vy+(cy-r.top)*sc]};
 document.addEventListener('pointerdown',e=>{const t=e.target.closest&&e.target.closest('#s3pl');if(!t||cur().v!=='st3e')return;
  P.set(e.pointerId,{x:e.clientX,y:e.clientY});try{t.setPointerCapture(e.pointerId)}catch(x){}
  if(P.size===1)g={x0:e.clientX,y0:e.clientY,vx:E.vx,vy:E.vy,moved:false};
  else if(P.size===2){const a=[...P.values()];g={pinch:true,d0:Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y)||1,vw0:E.vw,moved:true}}});
 document.addEventListener('pointermove',e=>{if(!P.has(e.pointerId)||!g)return;P.set(e.pointerId,{x:e.clientX,y:e.clientY});const t=el();if(!t)return;
  if(g.pinch&&P.size>=2){const a=[...P.values()],d=Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y)||1,r=t.getBoundingClientRect(),cx=E.vx+E.vw/2,cy=E.vy+E.vw*(r.height/r.width)/2;
   const nv=clampN(g.vw0*g.d0/d,300,14000);E.vx=cx-nv/2;E.vy=cy-nv*(r.height/r.width)/2;E.vw=nv;draw();return}
  if(P.size===1){const dx=e.clientX-g.x0,dy=e.clientY-g.y0;if(!g.moved&&Math.hypot(dx,dy)>8)g.moved=true;
   if(g.moved){const sc=E.vw/t.getBoundingClientRect().width;E.vx=g.vx-dx*sc;E.vy=g.vy-dy*sc;draw()}}});
 const up=e=>{if(!P.has(e.pointerId))return;const was=P.size,gg=g;P.delete(e.pointerId);if(!P.size)g=null;
  if(e.type==='pointerup'&&was===1&&gg&&!gg.moved&&!gg.pinch&&el()){const[x,y]=toCm(e.clientX,e.clientY);if(E.tool==='pano'&&U.pano){U.pano.tap(x,y);rerender();return}addAt(x,y);touch();rerender()}};
 /* החלקה לחזרה של האפליקציה (index.html) לא תופעל על גרירת המפה */window.addEventListener('touchend',e=>{if(e.target&&e.target.closest&&e.target.closest('#s3pl'))e.stopImmediatePropagation()},true);
 document.addEventListener('pointerup',up);document.addEventListener('pointercancel',up)}

/* ---------- המסך ---------- */
const TOOLS=[['sel','בחירה'],['room','חדר'],['fx','גוף'],['door','דלת'],['col','עמוד'],['sym','סמל'],['move','הזזה']];
const FIELDS={fx:[['w','אורך (ס"מ)',30,2000],['d','עומק (ס"מ)',20,300],['h','גובה (ס"מ)',30,300],['bays','מקטעים לכל צד',1,30],['lvl','קומות מדף',1,12]],
 rooms:[['h','גובה תקרה (ס"מ)',200,600]],doors:[['w','רוחב (ס"מ)',60,500]],cols:[['w','רוחב (ס"מ)',10,300],['d','עומק (ס"מ)',10,300]],syms:[]};
function optsH(){
 if(E.tool==='pano'&&U.pano)return U.pano.opts();
 const t=E.tool,sl=(id,cur2,m)=>`<select data-c="${id}" aria-label="סוג" style="min-height:44px">${Object.entries(m).map(([k,l])=>`<option value="${k}"${cur2===k?' selected':''}>${l}</option>`).join('')}</select>`;
 if(t==='room')return `<p class="note s3note">הקישו על המפה כדי להוסיף פינות (לפחות 3). ${E.pts.length/2} פינות.</p><div class="row s3row"><button class="btn" data-a="s3eClose">סגרו את החדר</button><button class="btn g" data-a="s3ePtUndo">בטלו פינה</button><button class="btn g" data-a="s3ePtClr">נקו</button></div>`;
 if(t==='fx')return `<div class="row s3row"><span>סוג הגוף:</span>${sl('s3eFxK',E.fxk,FXN)}</div><p class="note s3note">הקישו על המקום בתוך החדר.</p>`;
 if(t==='door')return `<div class="row s3row"><span>סוג הדלת:</span>${sl('s3eDrK',E.drk,DRN)}</div><p class="note s3note">הקישו על המקום בקיר.</p>`;
 if(t==='sym')return `<div class="row s3row"><span>סמל:</span>${sl('s3eSyK',E.syk,SYN)}</div><p class="note s3note">הקישו על המקום במפה.</p>`;
 if(t==='col')return '<p class="note s3note">הקישו על המקום של העמוד.</p>';
 if(t==='move')return `<p class="note s3note">${findSel()?'הקישו על המקום החדש של הפריט שנבחר.':'קודם בחרו פריט (כלי "בחירה").'}</p>`;
 return '<p class="note s3note">הקישו על פריט במפה כדי לבחור אותו. גרירה מזיזה את המפה, צביטה מקרבת.</p>'}
function selH(){
 const o=findSel();if(!E.sel||!o)return '';const t=E.sel.t,F=FIELDS[t]||[];
 const nm=t==='fx'?`${FXN[o.k]||'גוף'} מספר ${o.num||''}`:t==='rooms'?'חדר':t==='doors'?'דלת – '+(DRN[o.k]||''):t==='syms'?'סמל – '+(SYN[o.k]||''):'עמוד';
 let h=`<div class="s3info"><b>${esc2(nm)}</b>`;
 if(t==='fx'||t==='rooms')h+=`<label class="f" style="display:block;margin-top:6px"><span>${t==='fx'?'שם חופשי (לא חובה)':'שם החדר'}</span><input data-c="s3eF" data-f="name" maxlength="${t==='fx'?30:30}" value="${esc2(o.name||'')}"></label>`;
 h+=`<div class="row s3row">${F.map(([f,l,a,b])=>`<label class="f" style="flex:1;min-width:110px"><span>${l}</span><input type="number" inputmode="numeric" min="${a}" max="${b}" data-c="s3eF" data-f="${f}" value="${+o[f]||''}"></label>`).join('')}</div>`;
 if(t==='fx'){if(TWO.includes(o.k))h+=`<label class="cb"><input type="checkbox" data-c="s3eF" data-f="sides2"${o.sides===2?' checked':''}> שני צדדים</label>`;
  h+=`<label class="cb"><input type="checkbox" data-c="s3eF" data-f="hi"${o.hi?' checked':''}> צילום עליון ותחתון (מדף גבוה)</label>`;if(o.k==='fridge')h+=`<label class="cb"><input type="checkbox" data-c="s3eF" data-f="glass"${o.glass?' checked':''}> דלת זכוכית</label>`}
 if(t==='cols')h+=`<label class="cb"><input type="checkbox" data-c="s3eF" data-f="rnd"${o.rnd?' checked':''}> עמוד עגול</label>`;
 if(t==='doors')h+=`<div class="row s3row"><span>סוג:</span><select data-c="s3eF" data-f="k" style="min-height:44px">${Object.entries(DRN).map(([k,l])=>`<option value="${k}"${o.k===k?' selected':''}>${l}</option>`).join('')}</select></div>`;
 if(t!=='rooms'&&t!=='cols')h+=`<div class="row s3row"><button class="btn g" data-a="s3eRot" data-d="-90">סיבוב ‎−90°</button><button class="btn g" data-a="s3eRot" data-d="90">סיבוב ‎+90°</button></div>`;
 const fresh=E.fresh.has(t+':'+o.id);
 if(fresh)h+=`<div class="row s3row"><button class="btn g" data-a="s3eRemove">הסרה (עוד לא נשמר)</button></div>`;
 else if(U.isMgr())h+=`<div class="row s3row"><button class="btn g" style="border-color:var(--bad);color:var(--bad)" data-a="s3eDel">מחיקה (לסל המחזור)</button></div>`;
 else h+=`<p class="note s3note">מחיקה של פריט שכבר נשמר מותרת למנהל בלבד.</p>`;
 return h+'</div>'}
function binH(){
 const L=[];for(const t of KEYS)for(const o of E.map[t])if(o&&o.del===1)L.push([t,o]);
 if(!L.length)return '<p class="note s3note">סל המחזור ריק.</p>';
 return L.map(([t,o])=>`<div class="s3info"><b>${TN[t]}${t==='fx'?' '+(o.num||o.id):o.name?' '+esc2(o.name):''}</b><small> נמחק ${o.delAt?esc2(new Date(o.delAt).toLocaleDateString('he-IL')):''}</small><div class="row s3row"><button class="btn g" data-a="s3eRestore" data-t="${t}" data-id="${esc2(o.id)}">שחזור</button></div></div>`).join('')}
function verH(){
 if(E.vers==null){loadVers();return '<p class="note s3note">טוען גרסאות…</p>'}
 if(E.vers.err)return `<p class="note s3note">${esc2(E.vers.err)}</p>`;
 if(!E.vers.L.length)return '<p class="note s3note">עוד אין גרסאות קודמות. גרסה נשמרת בכל שמירה של שינוי.</p>';
 return E.vers.L.map(v=>`<div class="s3info"><b>גרסה ${v.v}</b> · ${v.by==='system'?'ניקוי אוטומטי · ':''}${esc2(v.at?new Date(v.at).toLocaleString('he-IL',{day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'}):'')}${v.why?' · '+esc2(v.why):''}<div class="row s3row"><button class="btn g" data-a="s3eVer" data-v="${v.v}">שחזר את הגרסה הזו</button></div></div>`).join('')}
function brH(){
 const d=U.data(),c=d&&d.cfg||{wh:false,on:true,cap:500},br=U.brSel();
 return `<p class="note s3note">הגדרות הסניף "${esc2((U.brs().find(b=>b.id===br)||{}).name||br)}" (מנהל־על בלבד).</p>
 <div class="row s3row"><button class="chip ${c.wh?'on':''}" data-a="s3eBr" data-f="wh" aria-pressed="${!!c.wh}">${c.wh?'יש מחסן':'אין מחסן'}</button><button class="chip ${c.on!==false?'on':''}" data-a="s3eBr" data-f="on" aria-pressed="${c.on!==false}">${c.on!==false?'תלת מימד פעיל בסניף':'תלת מימד כבוי בסניף'}</button></div>
 <p class="note s3note">מכסת בדיקות חודשית לסניף: ${+c.cap||0} (שינוי המכסה יתווסף בהגדרות).</p>`}
V.st3e=()=>{const T='עריכת המפה';
 if(!U.feat()||!U.canDraw())return{t:T,h:'<div class="empty">אין לכם הרשאה לעריכת מפה בעסק הזה</div>'};
 if(!U.dataOk()){U.load();return{t:T,h:'<div class="empty">טוען…</div>'}}
 if(U.data().err)return{t:T,h:`<div class="card s3s"><p style="margin:0">${esc2(U.data().err)}</p></div>`};
 const d=U.data();if(E.kind==='w'&&!d.cfg.wh)E.kind='s';
 if(E.key!==U.mapIdOf(E.kind)+'|'+(SY&&SY.bizId||''))init();
 let h='';
 if(typeof U.wizPanel==='function'&&E.map&&(E.wiz||(Array.isArray(E.map.uz)&&E.map.uz.length)))h+=U.wizPanel();
 if(d.cfg.wh&&!E.wiz)h+=`<div class="chips" style="margin:0 0 8px"><button class="chip ${E.kind==='s'?'on':''}" data-a="s3eKind" data-k="s">החנות</button><button class="chip ${E.kind==='w'?'on':''}" data-a="s3eKind" data-k="w">המחסן</button></div>`;
 if(E.offer)h+=`<div class="s3info">יש שינויים שלא נשמרו מהפעם הקודמת (${esc2(new Date(E.offer.at).toLocaleString('he-IL',{day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'}))}).<div class="row s3row"><button class="btn" data-a="s3eDraft" data-y="1">המשיכו מהם</button><button class="btn g" data-a="s3eDraft" data-y="0">התעלמו מהם</button></div></div>`;
 const TL=U.pano&&U.pano.ok()?TOOLS.concat([['pano','נקודות 360']]):TOOLS;if(E.tool==='pano'&&!(U.pano&&U.pano.ok()))E.tool='sel';
 h+=`<div class="s3tabs" role="toolbar">${TL.map(([k,l])=>`<button class="chip ${E.tool===k?'on':''}" data-a="s3eTool" data-k="${k}" aria-pressed="${E.tool===k}">${l}</button>`).join('')}</div>${optsH()}`;
 if(E.msg)h+=`<div class="s3info s3err" role="alert" style="margin-bottom:8px">${esc2(E.msg)}</div>`;
 h+=`<div class="s3main" id="s3pl" style="touch-action:none;height:min(52vh,420px)"></div>
 <div class="row s3row"><button class="btn g" data-a="s3eZoom" data-d="0.7" aria-label="קרב">＋</button><button class="btn g" data-a="s3eZoom" data-d="1.4" aria-label="הרחק">－</button><button class="btn g" data-a="s3eFit">הכול</button><button class="btn g" data-a="s3eUndo"${E.undo.length?'':' disabled'}>בטל פעולה</button></div>${selH()}
 ${typeof U.wizZones==='function'&&E.map&&(E.wiz||(Array.isArray(E.map.uz)&&E.map.uz.length))?U.wizZones():''}
 <div class="row s3row" style="margin-top:12px"><button class="btn" data-a="s3eSave"${E.busy||(typeof U.wizGate==='function'&&U.wizGate(E.map))?' disabled':''}>${E.busy?'שומר…':'שמירה'}</button>${E.dirty?'<span class="note s3note" style="margin:0">יש שינויים שלא נשמרו</span>':''}</div>
 <div class="s3tabs" style="margin-top:12px"><button class="chip ${E.sec==='ver'?'on':''}" data-a="s3eSec" data-k="ver">גרסאות קודמות</button>${U.isMgr()?`<button class="chip ${E.sec==='bin'?'on':''}" data-a="s3eSec" data-k="bin">סל מחזור</button>`:''}${SY&&SY.sa?`<button class="chip ${E.sec==='br'?'on':''}" data-a="s3eSec" data-k="br">סניף ומחסן</button>`:''}</div>`;
 if(E.sec==='ver')h+=verH();else if(E.sec==='bin'&&U.isMgr())h+=binH();else if(E.sec==='br'&&SY&&SY.sa)h+=brH();
 return{t:T,s:E.map?E.map.name:'',h:`<div class="card s3s">${h}</div>`}};
U.openEditor=k=>{E.kind=k==='w'?'w':'s';if(cur().v!=='st3e')go('st3e')};

/* ---------- פעולות ---------- */
const re=()=>{touch();rerender()};
ACT.s3eTool=el=>{E.tool=el.dataset.k;E.msg='';if(E.tool!=='room')E.pts=[];if(E.tool==='pano')E.sel=null;if(U.pano)U.pano.tool(E.tool==='pano');rerender()};
ACT.s3eKind=el=>{E.kind=el.dataset.k==='w'?'w':'s';E.key='';rerender()};
CHG.s3eFxK=el=>{if(FXD[el.value])E.fxk=el.value};CHG.s3eDrK=el=>{if(DRN[el.value])E.drk=el.value};CHG.s3eSyK=el=>{if(SYN[el.value])E.syk=el.value};
ACT.s3eZoom=el=>{const c=E.vw/2,r=document.getElementById('s3pl'),ar=r?r.clientHeight/Math.max(r.clientWidth,1):1,nv=clampN(E.vw*(+el.dataset.d),300,14000);E.vx+=c-nv/2;E.vy+=c*ar-nv*ar/2;E.vw=nv;draw()};
ACT.s3eFit=()=>{fit();draw()};
ACT.s3eUndo=()=>{const s=E.undo.pop();if(!s)return;try{E.map=JSON.parse(s)}catch(e){return}E.sel=null;E.msg='';re()};
ACT.s3ePtUndo=()=>{E.pts.splice(-2,2);rerender()};ACT.s3ePtClr=()=>{E.pts=[];rerender()};
ACT.s3eClose=()=>{
 const G0=G();if(E.pts.length<6){E.msg='לחדר צריכות להיות לפחות 3 פינות.';return rerender()}
 const v=G0.polyValid(E.pts);if(!v.ok){E.msg=v.err+'. תקנו את הפינות או נקו ונסו שוב.';return rerender()}
 if(!limit('rooms'))return rerender();
 snap();const o={id:nextId('rooms','r'),name:'חדר '+(live(E.map.rooms).length+1),p:E.pts.slice(),h:300};E.map.rooms.push(o);E.fresh.add('rooms:'+o.id);E.pts=[];E.sel={t:'rooms',id:o.id};E.tool='sel';E.msg='';re()};
CHG.s3eF=el=>{
 const o=findSel();if(!o)return;const f=el.dataset.f,t=E.sel.t;snap();E.msg='';
 if(el.type==='checkbox'){if(f==='sides2')o.sides=el.checked?2:1;else o[f]=el.checked}
 else if(f==='name'){const v=String(el.value||'').trim().slice(0,30);if(t==='rooms'&&!v){E.undo.pop();E.msg='לחדר חייב להיות שם.';return rerender()}if(v)o.name=v;else delete o.name}
 else if(f==='k'){if(DRN[el.value])o.k=el.value}
 else{const F=(FIELDS[t]||[]).find(x=>x[0]===f);if(!F){E.undo.pop();return}const n=Math.round(+el.value);if(!isFinite(n)||n<F[2]||n>F[3]){E.undo.pop();E.msg=F[1].replace(/ \(.*\)/,'')+' צריך להיות בין '+F[2]+' ל-'+F[3]+'.';return rerender()}o[f]=n}
 if(t==='fx'&&o.sides===2&&!TWO.includes(o.k))o.sides=1;
 renum();re()};
ACT.s3eRot=el=>{const o=findSel();if(!o||!('x'in o)||E.sel.t==='cols')return;snap();o.a=(((o.a||0)+(+el.dataset.d))%360+360)%360;renum();re()};
ACT.s3eRemove=()=>{const o=findSel(),t=E.sel&&E.sel.t;if(!o||!E.fresh.has(t+':'+o.id))return;
 if(t==='rooms'&&live(E.map.fx).some(f=>f.room===o.id)){E.msg='קודם הסירו את הגופים שבחדר.';return rerender()}
 snap();E.map[t]=E.map[t].filter(x=>x!==o);E.fresh.delete(t+':'+o.id);if(t==='doors'&&E.map.ent===o.id)delete E.map.ent;E.sel=null;renum();re()};
ACT.s3eDel=()=>{
 const o=findSel(),t=E.sel&&E.sel.t;if(!o||!U.isMgr())return;
 if(t==='rooms'&&live(E.map.fx).some(f=>f.room===o.id)){E.msg='קודם מחקו או הזיזו את הגופים שבחדר.';return rerender()}
 ask('למחוק את הפריט? הוא יעבור לסל המחזור וניתן יהיה לשחזר אותו.',()=>ask('לוודא פעם נוספת: למחוק את הפריט מהמפה?',()=>{
  const o2=findSel();if(!o2||!U.isMgr())return;snap();o2.del=1;o2.delAt=now();o2.delBy=SY.uid;if(E.map.ent===o2.id)delete E.map.ent;E.sel=null;renum();re()},'כן, מחק'),'כן, המשך')};
ACT.s3eRestore=el=>{const t=el.dataset.t,o=(E.map[t]||[]).find(x=>x.id===el.dataset.id);if(!o||!U.isMgr())return;
 if(t==='fx'&&!roomAt(o.x,o.y)){E.msg='החדר של הגוף הזה נמחק. שחזרו קודם את החדר.';return rerender()}
 snap();o.del=0;renum();E.sel={t,id:o.id};re()};
ACT.s3eSec=el=>{E.sec=E.sec===el.dataset.k?'':el.dataset.k;if(E.sec==='ver')E.vers=null;rerender()};
ACT.s3eDraft=el=>{if(el.dataset.y==='1'&&E.offer){E.map=clone(E.offer.map);E.dirty=true;fit()}else dropDraft();E.offer=null;rerender()};

/* ---------- שמירה (s3SaveMap) ---------- */
const errMsg=e=>e&&e.offline?'אין חיבור לאינטרנט. השינויים שמורים בטלפון, ואפשר לנסות לשמור שוב כשיש חיבור.':((U.RS&&e&&U.RS[e.reason])||(e&&e.message)||'השמירה נכשלה')+'. השינויים שמורים בטלפון.';
async function save(why){
 if(E.busy)return;const G0=G(),m=E.map;
 const zg=typeof U.wizGate==='function'?U.wizGate(m):'';if(zg){E.msg=zg;return rerender()}
 const errs=G0.validateMap(m);if(errs.length){E.msg='אי אפשר לשמור: '+errs.slice(0,3).join(' · ')+(errs.length>3?' ועוד '+(errs.length-3):'');return rerender()}
 const body=clone(m);delete body.v;delete body.upd;delete body.by;if(typeof U.wizPrep==='function')U.wizPrep(body);
 const wz=!!E.wiz;E.busy=1;E.msg='';rerender();
 try{
  const r=await U.fn('s3SaveMap',{mapId:mid(),baseV:E.baseV,map:body,why:why||'עריכה'});
  dropDraft();clearTimeout(E.tm);E.dirty=false;E.fresh=new Set();E.key='';U.drop();E.busy=0;toast('המפה נשמרה');U.load(true);
  /* שלב 7: השרת החליף מזהי גופים (renamed) או לא שמר שדות לא מוכרים (dropped) – המפה נטענת מחדש מהשרת (E.key='' ו-U.drop), ומציגים הודעה */
  const nr=r&&r.renamed&&typeof r.renamed==='object'?Object.keys(r.renamed).length:0,nd=r&&Array.isArray(r.dropped)?r.dropped.length:0;
  if(nr||nd)dlg(`<h3>המפה נשמרה</h3>${nr?`<p>${nr} גופים קיבלו מהשרת מספר חדש, כדי שלא יהיו שני גופים עם אותו מספר. המפה נטענה מחדש.</p>`:''}${nd?'<p>חלק מהפרטים שהוזנו לא נשמרו בשרת.</p>':''}<button class="btn w" data-a="closeDlg">הבנתי</button>`);
  if(wz&&typeof U.wizDone==='function')U.wizDone();
  if(cur().v==='st3e')ACT.back();
 }catch(e){E.busy=0;E.msg=errMsg(e);saveDraftNow();rerender()}
}
ACT.s3eSave=()=>save(E.wiz?'טיוטת AI':'עריכה');

/* ---------- גרסאות קודמות ---------- */
const pad6=n=>String(n).padStart(6,'0');
async function loadVers(){
 const k=mid();E.vers={L:[],err:'',loading:1};
 try{const r=await fsx('/smap/'+k+'/ver?pageSize=50&mask.fieldPaths=v&mask.fieldPaths=at&mask.fieldPaths=by&mask.fieldPaths=why');
  const L=((r&&r.documents)||[]).map(U.dec).filter(x=>x&&Number.isInteger(x.v)).sort((a,b)=>b.v-a.v);E.vers={L,err:''}}
 catch(e){E.vers={L:[],err:e&&e.offline?'אין חיבור לאינטרנט.':'לא הצלחנו לטעון את הגרסאות הקודמות.'}}
 if(cur().v==='st3e'&&E.sec==='ver')rerender()}
ACT.s3eVer=el=>{const v=+el.dataset.v;if(!Number.isInteger(v))return;
 ask('לשחזר את גרסה '+v+'? המפה הנוכחית תישמר כגרסה קודמת ולא תיאבד.',async()=>{
  try{const doc=U.dec(await fsx('/smap/'+mid()+'/ver/'+pad6(v)));const m=doc&&doc.m;if(!m||typeof m!=='object')throw new Error('x');
   snap();const keep={br:E.map.br,kind:E.map.kind,name:E.map.name},seq0=E.map.seq|0;E.map=Object.assign(clone(m),keep);for(const k of KEYS)if(!Array.isArray(E.map[k]))E.map[k]=[];
   E.map.seq=Math.max(seq0,E.map.seq|0);E.sel=null;renum();E.dirty=true;saveDraftNow();await save('שחזור')}
  catch(e){E.msg='לא הצלחנו לשחזר את הגרסה הזו.';rerender()}},'כן, שחזר')};

/* ---------- סניף ומחסן (מנהל־על) ---------- */
ACT.s3eBr=async el=>{
 if(!(SY&&SY.sa)||E.busy)return;const d=U.data(),c=d&&d.cfg||{wh:false,on:true,cap:500},f=el.dataset.f,v={brId:U.brSel(),wh:!!c.wh,on:c.on!==false,cap:Number.isInteger(c.cap)?c.cap:500};
 v[f]=!v[f];E.busy=1;
 try{await U.fn('s3SetBranch',v);U.drop();toast('נשמר');await U.load(true)}catch(e){E.msg=errMsg(e)}
 E.busy=0;rerender()};
})();
