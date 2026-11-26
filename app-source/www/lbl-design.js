/* עורך תבניות מדבקות (מדבקות שלב 2, סבבים 4–5, 24.11.2026) – מסכים V.lblD (רשימה), V.lblDE (עורך), V.lblDS (גדלים וברירת מחדל).
   הרשאה: כמו מסך ההדפסה (LblPrint.ok – מנהל או עובד עם הרשאת מדבקות). שמירה: LblPrint.tSave / sSave ('ok' בענן, 'dev' במכשיר בלבד).
   מחיקה רכה (del:true) ו"שחזר למקור" (תבנית מקורית ערוכה ← del:true, וההדפסה חוזרת ל-draw() המקורי). אין שינוי ברשומות קיימות.
   הציור – אותו drawT של ההדפסה; תצוגה מדויקת = אותה תמונת 1 ביט + מלבני הברקוד שנכנסים ל-PDF. בדיקות: firebase/tests/app-multibiz/ui-lbl-design.js */
(function(root){
'use strict';
if(typeof window==='undefined'||typeof V==='undefined'||!root.LblPrint||!root.LblTpl)return;
const LP=root.LblPrint,LT=root.LblTpl;
const E={D:null,drag:null,snap:1,z:1,pi:0,S:null};
const r2=v=>Math.round(v*100)/100,mm=px=>r2(px*25.4/300),pxOf=m=>r2(m*300/25.4);
const clone=o=>JSON.parse(JSON.stringify(o));
const nrm=T=>LT.tplOk({id:T.id,v:1,name:String(T.name||'').trim()||'תבנית',w:T.w,h:T.h,base:T.base||undefined,j:LT.toJ(T),at:T.at});
const newId=()=>{const a=new Uint8Array(10);crypto.getRandomValues(a);return 'u'+[...a].map(x=>(x%36).toString(36)).join('')};
const sz=(w,h)=>LP.szT(w,h)+' מ"מ';
const TPLN=['','ברקוד ומחיר','בלי ברקוד','מחיר גדול','מבצע','מחיר ליחידה'];
const all=()=>LP.tAll();
// מפתח ברשימה: b1..b5 (מקורית – ערוכה אם יש) או מזהה תבנית משלך
const edOf=n=>all().find(t=>t.base===n&&!t.del)||null;
const byKey=k=>{const m=/^b([1-5])$/.exec(k);if(m){const n=+m[1];return edOf(n)||LT.builtin(n)}return all().find(t=>t.id===k&&!t.base)||null};
/* "חותמת גדולה" – לארג' פעמי בלבד: חותמת הבד"ץ בערך כפולה (140 במקום ~56) לצד השם והמחיר, לוגו מעליהם, ברקוד למטה. 50×25 */
const LPS=()=>({id:'',v:1,name:'חותמת גדולה',w:50,h:25,grid:12,brand:'el',els:[{id:'s',t:'stamp',x:10,y:24,w:146,h:146,al:'c'},{id:'l',t:'logo',x:170,y:6,w:407,h:40,al:'r'},
 {id:'n',t:'name',fit:'wrap2',x:170,y:50,w:407,h:64,fs:44,min:18},{id:'p',t:'price',x:170,y:116,w:407,h:92,fs:92,if:'bc'},{id:'p2',t:'price',x:170,y:118,w:407,h:160,fs:140,if:'!bc'},
 {id:'b',t:'bc',x:14,y:212,w:563,h:60,dg:16}]});
/* ---------- רכיבים ---------- */
const TL={name:'שם מוצר',price:'מחיר',sale:'מחיר מבצע',reg:'מחיר רגיל מחוק',unit:'מחיר ליחידה',pack:'גודל אריזה',bc:'ברקוד',logo:'לוגו',stamp:'חותמת כשרות',text:'טקסט קבוע',hl:'מילה מודגשת',line:'קו',rect:'מסגרת',box:'תיבה שחורה עם טקסט לבן',exp:'"בתוקף עד"',multi:'מבצע כמות ("2 ב-20 ₪")'};
const ADD=['name','price','sale','reg','unit','pack','bc','logo','stamp','text','hl','line','rect','box','exp','multi'];
// ברירות מחדל: w – חלק מהרוחב; h – פיקסלים (או חלק מהגובה אם ≤1)
const NEW={name:{t:'name',w:.9,h:60,fs:48,min:18},price:{t:'price',w:.6,h:100,fs:96},sale:{t:'price',src:'sale',w:.6,h:100,fs:96},reg:{t:'reg',w:.8,h:36,fs:32,min:16,fw:500,if:'pp'},
 unit:{t:'unit',w:.9,h:32,fs:30,min:14,fw:600,ph:1},pack:{t:'pack',w:.4,h:38,fs:34,min:14},bc:{t:'bc',w:.8,h:70,dg:22},logo:{t:'logo',w:.3,h:70},stamp:{t:'stamp',w:.25,h:100},
 text:{t:'text',w:.6,h:40,fs:34,min:14,txt:'טקסט'},hl:{t:'hl',w:.3,h:44},line:{t:'line',w:.9,h:12,sw:3},rect:{t:'rect',w:.9,h:.8,sw:3},box:{t:'box',w:.6,h:60,fs:44,min:16,txt:'מבצע',al:'c'},
 exp:{t:'exp',w:.6,h:36,fs:30,min:14},multi:{t:'multi',w:.6,h:40,fs:36,min:14}};
const elL=e=>(e.t==='price'&&e.src==='sale'?TL.sale:TL[e.t]||e.t)+(e.txt&&(e.t==='text'||e.t==='box')?': '+e.txt:'');
const TXT=['name','price','reg','unit','pack','text','exp','multi','box'];
const IFL=[['','תמיד'],['bc','רק כשיש ברקוד'],['!bc','רק כשאין ברקוד'],['pp','רק כשיש מחיר מבצע'],['!pp','רק כשאין מחיר מבצע'],['pack','רק כשיש גודל אריזה'],['!pack','רק כשאין גודל אריזה']];
// מוצרים לתצוגה: הקצר, הארוך, היקר. בלי מלאי – דוגמה (מסומן)
const SMP=[{name:'לחם (דוגמה)',price:'6.5',code:'7290000000017',pack:'750 גרם'},{name:'עוגת שמרים שוקולד גדולה במיוחד עם אגוזים (דוגמה)',price:'34.9',code:'5901234123457',pack:''},{name:'מארז כוסות (דוגמה)',price:'1299.9',code:'',pack:'1 ק"ג'}];
function prods(){const I=LP.inv(),L=I.L;if(!L.length)return{ex:1,busy:I.busy,P:SMP.map((p,i)=>Object.assign({k:['הקצר ביותר','הארוך ביותר','המחיר הגבוה'][i]},p))};
 const by=f=>L.reduce((a,b)=>f(b,a)?b:a,L[0]),pr=x=>parseFloat(x.price)||0;
 return{ex:0,busy:I.busy,P:[Object.assign({k:'השם הקצר ביותר'},by((b,a)=>b.name.length<a.name.length)),Object.assign({k:'השם הארוך ביותר'},by((b,a)=>b.name.length>a.name.length)),Object.assign({k:'המחיר הגבוה ביותר'},by((b,a)=>pr(b)>pr(a)))]}}
const itOf=(p,T)=>({name:p.name,price:p.price,code:p.code,pack:p.pack,fs:100,hl:T&&T.els.some(e=>e.t==='hl'||e.hlIn)?'חדש!':'',pp:''});
/* ---------- ביטול / חזרה (50) ---------- */
const snap=()=>JSON.stringify(E.D.T);
function push(){const D=E.D;D.U.push(snap());if(D.U.length>50)D.U.shift();D.R=[];D.dirty=1;D.pk='';D.st=''}
const sel=()=>E.D&&E.D.sel?E.D.T.els.find(e=>e.id===E.D.sel)||null:null;
/* ---------- ציור ---------- */
const xf=T=>{const b=LP.brand(),L=b&&T.brand!=='el'?LP.layBox(b.lay,LT.dims(T.w,T.h).W,LT.dims(T.w,T.h).H):null;return L&&L.t?L.t:{s:1,dx:0,dy:0}};
const box=(e,X)=>({x:e.x*X.s+X.dx,y:e.y*X.s+X.dy,w:e.w*X.s,h:e.h*X.s});
const corners=r=>[['nw',r.x,r.y],['ne',r.x+r.w,r.y],['sw',r.x,r.y+r.h],['se',r.x+r.w,r.y+r.h]];
function drawEd(){const D=E.D,c=document.getElementById('lblDC');if(!D||!c)return;const T=D.T,g=c.getContext('2d'),P=prods().P,b=LP.brand();
 try{LP.drawT(g,T,itOf(P[E.pi]||P[0],T),b?{prev:1,brand:b}:{prev:1})}catch(e){}
 const X=xf(T),k=c.width/Math.max(1,c.getBoundingClientRect().width||c.width);g.setTransform(1,0,0,1,0,0);
 for(const e of T.els){const r=box(e,X),on=e.id===D.sel;g.save();g.lineWidth=(on?3:1.5)*k;g.strokeStyle=on?'#c8a24a':'rgba(40,110,220,.75)';if(!on)g.setLineDash([6*k,4*k]);g.strokeRect(r.x,r.y,r.w,r.h);g.restore();
  if(on){const hs=9*k;g.fillStyle='#c8a24a';g.strokeStyle='#000';g.lineWidth=k;corners(r).forEach(([,x,y])=>{g.fillRect(x-hs/2,y-hs/2,hs,hs);g.strokeRect(x-hs/2,y-hs/2,hs,hs)})}}}
// תצוגה מדויקת: drawT בלי prev → toBits (כמו ה-PDF) → תמונה, ומעליה מלבני הברקוד. מחזיר מדדים לבדיקות
function bw(c,T,it){const D=LT.dims(T.w,T.h),o=document.createElement('canvas');o.width=D.W;o.height=D.H;const g=o.getContext('2d',{willReadFrequently:true}),m={},b=LP.brand();
 const R=LP.drawT(g,T,it,Object.assign({rects:[],m},b?{brand:b}:{})),bits=LP.toBits(g.getImageData(0,0,D.W,D.H).data,D.W,D.H),rb=Math.ceil(D.W/8),id=g.createImageData(D.W,D.H);
 for(let y=0;y<D.H;y++)for(let x=0;x<D.W;x++){const v=bits[y*rb+(x>>3)]&(0x80>>(x&7))?255:0,i=(y*D.W+x)*4;id.data[i]=id.data[i+1]=id.data[i+2]=v;id.data[i+3]=255}
 if(c){c.width=D.W;c.height=D.H;const x=c.getContext('2d');x.putImageData(id,0,0);x.fillStyle='#000';const q=Math.round;R.forEach(r=>{const x0=q(r[0]),y0=q(r[1]);x.fillRect(x0,y0,q(r[0]+r[2])-x0,q(r[1]+r[3])-y0)})}return m} // מלבנים מעוגלים לפיקסל (ב-PDF – וקטוריים)
// אזהרות (לא חוסמות): checks של lbl-tpl.js עם מדדים מ-3 המוצרים
const merge=(M,m)=>{for(const id in m){const a=M[id]=M[id]||{},x=m[id];if(x.over)a.over=true;if(x.mod!=null)a.mod=a.mod==null?x.mod:Math.min(a.mod,x.mod)}return M};
const warnH=(T,M)=>{const W=LT.checks(T,M);return W.length?W.map(w=>{const e=T.els.find(x=>x.id===w.id);return `<button type="button" class="li" data-a="lblDSel" data-id="${esc(w.id)}" style="color:var(--bad,#e66);min-height:40px"><small>⚠ ${esc(w.msg)}${e?' · '+esc(elL(e)):''}</small></button>`}).join('')+'<small class="note">אזהרות בלבד – אפשר לשמור ולהדפיס.</small>':'<small class="note">אין אזהרות.</small>'};
function paint(){drawEd();const D=E.D;if(!D)return;const P=prods().P,M={};document.querySelectorAll('#main canvas[data-lbld-p]').forEach(c=>{try{merge(M,bw(c,D.T,itOf(P[+c.dataset.lbldP],D.T)))}catch(e){}});
 const w=document.getElementById('lblDWarn');if(w)w.innerHTML=warnH(D.T,M)}
let raf=0;const soon=()=>{if(!raf)raf=requestAnimationFrame(()=>{raf=0;drawEd()})};
const later=()=>setTimeout(()=>{paint();const b=LP.brand();LP.ensureImgs(b).then(()=>{if(/^lblD/.test(cur().v))paint()});try{document.fonts.ready.then(()=>{if(/^lblD/.test(cur().v))paint()})}catch(e){}
 const w=document.getElementById('lblDW');if(w&&E.sc){w.scrollLeft=E.sc[0];w.scrollTop=E.sc[1]}},0);
/* ---------- גרירה (pointer events) ---------- */
const pt=(c,ev)=>{const r=c.getBoundingClientRect();return{x:(ev.clientX-r.left)*c.width/r.width,y:(ev.clientY-r.top)*c.height/r.height,k:c.width/r.width}};
const sn=v=>E.snap?r2(Math.round(v/pxOf(E.snap))*pxOf(E.snap)):r2(v);
// הרכיב הקטן ביותר שמכיל את הנקודה (כדי שמסגרת גדולה לא "תבלע" רכיבים קטנים)
function hit(P,X){let best=null,ba=Infinity;for(const e of E.D.T.els){const r=box(e,X),pd=8*P.k,a=r.w*r.h;if(P.x>=r.x-pd&&P.x<=r.x+r.w+pd&&P.y>=r.y-pd&&P.y<=r.y+r.h+pd&&a<=ba){best=e;ba=a}}return best}
function pDown(ev){const D=E.D,c=ev.currentTarget;if(!D||ev.button>0)return;ev.preventDefault();const P=pt(c,ev),X=xf(D.T);let e=sel(),h=null;
 if(e){const hs=16*P.k;for(const[n,x,y] of corners(box(e,X)))if(Math.abs(P.x-x)<=hs&&Math.abs(P.y-y)<=hs){h=n;break}}
 const s0=D.sel;if(!h){e=hit(P,X);D.sel=e?e.id:null}
 const w=document.getElementById('lblDW');E.drag={e,h,P,X,o:e?{x:e.x,y:e.y,w:e.w,h:e.h,y1:e.y1,y2:e.y2}:null,mv:0,ch:s0!==D.sel,cx:ev.clientX,cy:ev.clientY,sl:w?w.scrollLeft:0,st:w?w.scrollTop:0};
 try{c.setPointerCapture(ev.pointerId)}catch(x){}drawEd()}
function pMove(ev){const G=E.drag;if(!G)return;ev.preventDefault();const c=ev.currentTarget,P=pt(c,ev),e=G.e;
 if(!e){if(E.z>1){const w=document.getElementById('lblDW');if(w){w.scrollLeft=G.sl-(ev.clientX-G.cx);w.scrollTop=G.st-(ev.clientY-G.cy)}}return}
 const dx=(P.x-G.P.x)/G.X.s,dy=(P.y-G.P.y)/G.X.s;if(!G.mv){if(Math.abs(dx)<3&&Math.abs(dy)<3)return;push();G.mv=1}
 const o=G.o,MIN=10;
 if(!G.h){e.x=sn(o.x+dx);e.y=sn(o.y+dy);if(o.y1!=null)e.y1=r2(o.y1+e.y-o.y);if(o.y2!=null)e.y2=r2(o.y2+e.y-o.y)}
 else{let x1=o.x,y1=o.y,x2=o.x+o.w,y2=o.y+o.h;if(G.h[1]==='w')x1=Math.min(sn(o.x+dx),x2-MIN);else x2=Math.max(sn(x2+dx),x1+MIN);
  if(G.h[0]==='n')y1=Math.min(sn(o.y+dy),y2-MIN);else y2=Math.max(sn(y2+dy),y1+MIN);e.x=r2(x1);e.y=r2(y1);e.w=r2(x2-x1);e.h=r2(y2-y1);delete e.y1;delete e.y2;if(e.hh!=null&&e.hh>e.h)e.hh=e.h}
 soon()}
function pUp(){const G=E.drag;E.drag=null;if(!G)return;if(G.mv||G.ch)rr()}
const rr=()=>{const w=document.getElementById('lblDW');E.sc=w?[w.scrollLeft,w.scrollTop]:null;rerender()};
// מאזינים על הקנבס עצמו (נוצר מחדש בכל ציור מסך)
const wire=()=>{const c=document.getElementById('lblDC');if(!c||c.dataset.w)return;c.dataset.w=1;c.addEventListener('pointerdown',pDown);c.addEventListener('pointermove',pMove);c.addEventListener('pointerup',pUp);c.addEventListener('pointercancel',pUp)};
function nudge(d){const e=sel();if(!e)return;push();const s=E.snap?pxOf(E.snap):1;if(d==='l')e.x=sn(e.x-s);else if(d==='r')e.x=sn(e.x+s);else if(d==='u'){e.y=sn(e.y-s);if(e.y1!=null)e.y1-=s;if(e.y2!=null)e.y2-=s}else{e.y=sn(e.y+s);if(e.y1!=null)e.y1+=s;if(e.y2!=null)e.y2+=s}paint();mmUp()}
const mmUp=()=>{const e=sel();if(!e)return;document.querySelectorAll('#main [data-mm]').forEach(i=>{if(document.activeElement!==i)i.value=String(mm(e[i.dataset.k]))})};
document.addEventListener('keydown',ev=>{try{if(cur().v!=='lblDE'||!E.D||!sel()||document.querySelector('#dlg[open]'))return;const a=document.activeElement;if(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))return;
 const d={ArrowLeft:'l',ArrowRight:'r',ArrowUp:'u',ArrowDown:'d'}[ev.key];if(d){ev.preventDefault();nudge(d)}}catch(e){}});
/* ---------- מסך: רשימת התבניות ---------- */
const noPerm=t=>({t,h:'<div class="empty">אין לך הרשאה להדפסת מדבקות</div>'});
const SAMPLE={name:'שם המוצר (דוגמה)',price:'12.90',code:'5901234123457',fs:100,hl:'',pp:'',pack:''};
const thumb=k=>`<canvas data-lbld-t="${esc(k)}" width="10" height="10" style="width:96px;height:auto;display:block;background:#fff;border-radius:4px;flex:none"></canvas>`;
const row=(k,T,nm,tags,btns)=>`<div class="li" style="cursor:default;gap:8px;align-items:center">${thumb(k)}<div class="m" style="min-width:0"><b style="overflow-wrap:anywhere">${esc(nm)}</b><small>${sz(T.w,T.h)}${tags}</small>
 <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:4px">${btns}</div></div></div>`;
const bt=(a,k,l,x)=>`<button type="button" class="btn s g" data-a="${a}" data-k="${esc(k)}"${x||''}>${l}</button>`;
V.lblD=()=>{const t='עיצוב תבניות';if(!LP.ok())return noPerm(t);LP.prep();const A=all(),def=LP.ls().def||'b1',D=E.D;
 let h=`<div class="card"><p class="note" style="margin-top:0">עיצוב המדבקות של העסק – לכל המכשירים. תבנית מקורית שנערכה מחליפה את המקורית בהדפסה, ו"שחזר למקור" מחזיר אותה.</p>
  <div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn grow" data-a="lblDNew">תבנית חדשה</button><button class="btn g grow" data-a="go" data-v="lblDS">גדלים וברירת מחדל</button></div>${LP.ready()?'':'<small class="note">טוען תבניות…</small>'}</div>`;
 if(D&&D.dirty)h+=`<div class="card" style="border:2px solid var(--acc)"><b>יש שינויים שלא נשמרו: ${esc(D.T.name)}</b><div class="row" style="gap:8px;margin-top:8px"><button class="btn grow" data-a="go" data-v="lblDE">המשך עריכה</button><button class="btn g grow" data-a="lblDDrop">בטל את השינויים</button></div></div>`;
 h+='<div class="sec"><h3>תבניות מקוריות</h3></div>';
 for(let n=1;n<=5;n++){const ed=edOf(n),k='b'+n,T=ed||LT.builtin(n);h+=row(k,T,n+'. '+TPLN[n],(ed?' · <span class="tag">ערוכה</span>':'')+(def===k?' · <span class="tag">ברירת מחדל</span>':''),bt('lblDEd',k,'עריכה')+bt('lblDDup',k,'שכפול')+(ed?bt('lblDOrig',k,'שחזר למקור'):''))}
 const C=A.filter(x=>!x.base&&!x.del).sort((a,b)=>a.name.localeCompare(b.name,'he')),X=A.filter(x=>!x.base&&x.del);
 h+=`<div class="sec"><h3>התבניות שלי</h3></div>`+(C.length?C.map(T=>row(T.id,T,T.name,def===T.id?' · <span class="tag">ברירת מחדל</span>':'',bt('lblDEd',T.id,'עריכה')+bt('lblDDup',T.id,'שכפול')+bt('lblDRen',T.id,'שינוי שם')+bt('lblDDel',T.id,'מחיקה'))).join(''):'<p class="note" style="padding:4px">עדיין אין. לחצו "תבנית חדשה" או "שכפול".</p>');
 if(X.length)h+=`<details style="margin-top:10px"><summary style="min-height:44px;display:flex;align-items:center;cursor:pointer"><b>תבניות שנמחקו (${X.length})</b></summary>${X.map(T=>row(T.id,T,T.name,'',bt('lblDUndel',T.id,'שחזר'))).join('')}</details>`;
 setTimeout(()=>{const go=()=>document.querySelectorAll('#main canvas[data-lbld-t]').forEach(c=>{const k=c.dataset.lbldT,m=/^b([1-5])$/.exec(k),T=m?edOf(+m[1]):A.find(x=>x.id===k),D2=T?LT.dims(T.w,T.h):{W:LP.W,H:LP.H};
  c.width=D2.W;c.height=D2.H;const b=LP.brand();try{LP.render(c.getContext('2d'),T||+m[1],SAMPLE,b?{prev:1,brand:b}:{prev:1})}catch(e){}});go();LP.ensureImgs(LP.brand()).then(()=>{if(cur().v==='lblD')go()})},0);
 return{t,s:'מדבקות',h}};
const edit=(T,o)=>{E.D=Object.assign({T:clone(T),at0:T.at||(all().find(x=>x.id===T.id)||{}).at||0,sel:null,U:[],R:[],dirty:0,st:'',pk:''},o||{});E.pi=0;E.sc=null;go('lblDE')};
ACT.lblDEd=el=>{const T=byKey(el.dataset.k);if(!T)return toast('התבנית לא נמצאה');const D=E.D;if(D&&D.dirty&&D.T.id===T.id&&D.key===el.dataset.k)return go('lblDE');edit(T,{key:el.dataset.k})};
ACT.lblDDrop=()=>ask('לבטל את השינויים שלא נשמרו?',()=>{E.D=null;closeDlg();rerender()},'כן, בטל');
const full=()=>{if(all().length>=LT.LIM.tpls){toast('אפשר עד '+LT.LIM.tpls+' תבניות');return true}return false};
// שמירה מהרשימה (שכפול / שם / מחיקה / שחזור)
async function put(T,okMsg){try{const r=await LP.tSave(T);toast(r==='ok'?okMsg:'נשמר במכשיר בלבד – יישלח לענן בכניסה הבאה');rerender();return r}catch(e){toast('השמירה נכשלה');return null}}
ACT.lblDDup=el=>{const S=byKey(el.dataset.k);if(!S||full())return;const T=nrm(Object.assign(clone(S),{id:newId(),base:0,name:('עותק של '+S.name).slice(0,LT.LIM.name)}));if(T)put(T,'שוכפל')};
ACT.lblDRen=el=>{const T=byKey(el.dataset.k);if(!T)return;dlg(`<h3>שינוי שם</h3><form data-f="lblDRen" data-k="${esc(T.id)}" autocomplete="off"><label class="f"><span>שם התבנית</span><input name="name" value="${esc(T.name)}" maxlength="40" required></label><div class="row"><button class="btn grow">שמור</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`)};
FRM.lblDRen=f=>{const T=byKey(f.dataset.k),nm=String(f.elements.name.value||'').trim();if(!T)return;if(!nm||nm.length>LT.LIM.name)return toast('שם: 1 עד 40 תווים');closeDlg();put(Object.assign(clone(T),{name:nm}),'השם נשמר')};
ACT.lblDDel=el=>{const T=byKey(el.dataset.k);if(!T)return;ask('למחוק את התבנית "'+T.name+'"? (אפשר לשחזר מ"תבניות שנמחקו")',()=>{closeDlg();if(E.D&&E.D.T.id===T.id)E.D=null;put(Object.assign(clone(T),{del:true}),'נמחקה')},'כן, מחק')};
ACT.lblDUndel=el=>{const T=all().find(x=>x.id===el.dataset.k&&x.del);if(T)put(Object.assign(clone(T),{del:undefined}),'שוחזרה')};
ACT.lblDOrig=el=>{const m=/^b([1-5])$/.exec(el.dataset.k),T=m&&edOf(+m[1]);if(!T)return;ask('להחזיר את "'+TPLN[+m[1]]+'" לעיצוב המקורי? השינויים שלך בתבנית יימחקו.',()=>{closeDlg();if(E.D&&E.D.T.id===T.id)E.D=null;put(Object.assign(clone(T),{del:true}),'הוחזרה למקור')},'כן, שחזר')};
// תבנית חדשה: ריקה / מתבנית מקורית (מותאמת לגודל) / "חותמת גדולה" (לארג' פעמי בלבד)
const sizes=()=>[{w:50,h:25}].concat(LP.ls().sz.filter(s=>!LT.isDef(s.w,s.h)));
ACT.lblDNew=()=>{if(full())return;const lp=LP.isLP();dlg(`<h3>תבנית חדשה</h3><form data-f="lblDNew" autocomplete="off"><label class="f"><span>שם התבנית</span><input name="name" maxlength="40" required placeholder="למשל: מבצע שבועי"></label>
 <label class="f"><span>גודל</span><select name="sz">${sizes().map(s=>`<option value="${s.w}x${s.h}">${sz(s.w,s.h)}</option>`).join('')}</select></label>
 <label class="f"><span>להתחיל מ</span><select name="from">${lp?'<option value="lp" selected>חותמת גדולה (לארג\' פעמי)</option>':''}<option value="0">תבנית ריקה</option>${[1,2,3,4,5].map(n=>`<option value="${n}"${!lp&&n===1?' selected':''}>${n}. ${TPLN[n]}</option>`).join('')}</select></label>
 <div class="row"><button class="btn grow">צור</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`)};
// התאמת רכיבים לגודל אחר (יחסית ל-591×295)
function fitTo(T,w,h){const A=LT.dims(T.w,T.h),B=LT.dims(w,h),sx=B.W/A.W,sy=B.H/A.H,sf=Math.min(sx,sy);if(sx===1&&sy===1)return T;
 T.els.forEach(e=>{e.x=r2(e.x*sx);e.w=r2(e.w*sx);e.y=r2(e.y*sy);e.h=r2(e.h*sy);for(const k of ['y1','y2','hh'])if(e[k]!=null)e[k]=r2(e[k]*sy);for(const k of ['fs','min','dg'])if(e[k])e[k]=Math.max(k==='dg'?8:6,r2(e[k]*sf))});T.w=w;T.h=h;return T}
FRM.lblDNew=f=>{const nm=String(f.elements.name.value||'').trim(),[w,h]=String(f.elements.sz.value).split('x').map(Number),fr=f.elements.from.value;if(!nm||nm.length>LT.LIM.name)return toast('שם: 1 עד 40 תווים');
 if(full())return;let T=fr==='lp'&&LP.isLP()?LPS():/^[1-5]$/.test(fr)?LT.builtin(+fr):{v:1,w:50,h:25,grid:12,brand:'lay',els:[]};
 T=fitTo(Object.assign(T,{id:newId(),name:nm,base:0}),w||50,h||25);delete T.base;closeDlg();edit(T,{dirty:1,isNew:1})};
/* ---------- מסך: העורך ---------- */
const opt=(L,v)=>L.map(([a,b])=>`<option value="${esc(a)}"${String(v)===String(a)?' selected':''}>${b}</option>`).join('');
const sl=(l,k,L,v)=>`<label class="f" style="margin:0"><span>${l}</span><select data-c="lblDP" data-k="${k}">${opt(L,v)}</select></label>`;
const nb=(l,k,v,x)=>`<label class="f" style="margin:0"><span>${l}</span><input type="number" inputmode="decimal" data-i="lblDP" data-k="${k}" data-n="1" value="${esc(v==null?'':String(v))}" ${x||''}></label>`;
const tx=(l,k,v,n)=>`<label class="f" style="margin:0"><span>${l}</span><input data-i="lblDP" data-k="${k}" value="${esc(v||'')}" maxlength="${n}"></label>`;
const cb=(l,k,on)=>`<label class="cb" style="min-height:44px;display:flex;align-items:center;gap:6px"><input type="checkbox" data-c="lblDP" data-k="${k}"${on?' checked':''}> ${l}</label>`;
const CUR=[['sh','ש"ח'],['ils','₪'],['','בלי']];
function propsH(e,T){if(!e)return '<small class="note">לחצו על רכיב במדבקה (או ברשימה) כדי לבחור אותו. גוררים כדי להזיז, והריבועים בפינות משנים גודל.</small>';
 const t=e.t,big=t==='price'&&e.sty!=='line';let h=`<div class="row" style="gap:6px;align-items:center;flex-wrap:wrap"><b class="grow">${esc(elL(e))}</b>
  ${[['r','→','ימינה'],['u','↑','למעלה'],['d','↓','למטה'],['l','←','שמאלה']].map(([d,s,a])=>`<button type="button" class="chip" data-a="lblDNudge" data-d="${d}" aria-label="הזזה ${a}">${s}</button>`).join('')}
  <button type="button" class="btn s g" data-a="lblDElDel">מחק רכיב</button></div>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:6px;margin-top:6px">`+[['x','מימין לשמאל X'],['y','מלמעלה Y'],['w','רוחב'],['h','גובה']].map(([k,l])=>`<label class="f" style="margin:0"><span>${l} (מ"מ)</span><input type="number" step="0.1" inputmode="decimal" data-i="lblDP" data-k="${k}" data-mm="1" value="${mm(e[k])}"></label>`).join('');
 if(TXT.includes(t)){h+=nb('גודל טקסט','fs',e.fs||(t==='price'?96:40),'min="6" max="400"');if(!big)h+=nb('גודל מינימלי','min',e.min||14,'min="6" max="400"')}
 if(TXT.includes(t)&&!big)h+=sl('עובי','fw',[[500,'רגיל'],[700,'מודגש'],[800,'מודגש מאוד']],e.fw||(t==='reg'?500:t==='unit'?600:700));
 if(TXT.includes(t)||t==='logo'||t==='stamp')h+=sl('יישור','al',[['r','ימין'],['c','מרכז'],['l','שמאל']],e.al||({name:'r',text:'r',exp:'r',logo:'c',stamp:'c'}[t]||'c'));
 if(t==='name')h+=sl('שם ארוך','fit',[['shrink','הקטנה אוטומטית'],['wrap2','עד 2 שורות']],e.fit||'shrink');
 if(t==='price')h+=sl('סגנון','sty',[['big','מספר גדול'],['line','שורה אחת']],e.sty||'big')+sl('מחיר','src',[['p','רגיל'],['sale','מבצע (אם הוקלד)']],e.src||'p');
 if(t==='price'||t==='reg'||t==='unit'||t==='multi')h+=sl('מטבע','cur',CUR,e.cur==null?(t==='multi'?'ils':'sh'):e.cur);
 if((t==='price'&&e.sty==='line')||t==='reg'||t==='exp')h+=tx('כיתוב לפני','lbl',e.lbl!=null?e.lbl:t==='reg'?'מחיר רגיל':t==='exp'?'בתוקף עד':'',LT.LIM.lbl);
 if(t==='text'||t==='box')h+=tx('טקסט','txt',e.txt,LT.LIM.txt);
 if(t==='bc')h+=nb('גודל הספרות','dg',e.dg||0,'min="0" max="80"');
 if(t==='line'||t==='rect')h+=nb('עובי קו','sw',e.sw||3,'min="1" max="40"');
 h+=sl('להציג','if',IFL,e.if||'')+'</div>';
 if(t==='name')h+=cb('גודל לפי "גודל השם" במסך ההדפסה','k',e.k!==0)+cb('מילה מודגשת בתוך שורת השם','hlIn',!!e.hlIn);
 if(t==='bc')h+=cb('ספרות מתחת לברקוד','dgs',e.dgs!==0);
 if((t==='logo'||t==='stamp')&&T.brand!=='el')h+='<small class="note">לוגו וחותמת כרכיבים מוצגים רק כשהם "כרכיבים בתבנית" (למטה).</small>';
 return h}
V.lblDE=()=>{const t='עורך תבנית';if(!LP.ok())return noPerm(t);LP.prep();const D=E.D;if(!D)return{t,h:'<div class="empty">אין תבנית פתוחה</div><button class="btn w" data-a="back">חזרה לרשימה</button>'};
 const T=D.T,Dm=LT.dims(T.w,T.h),e=sel(),PR=prods();if(E.pi>2)E.pi=0;
 let h=`<div class="card" style="padding:10px"><div class="row" style="gap:8px;align-items:flex-end"><label class="f grow" style="margin:0"><span>שם התבנית · ${sz(T.w,T.h)}</span><input data-i="lblDN" value="${esc(T.name)}" maxlength="40"></label><button class="btn" data-a="lblDSave">שמור</button></div>
  ${D.st==='dev'?'<p class="note" style="color:var(--bad,#e66);margin:6px 0 0">נשמר במכשיר בלבד – יישלח לענן בכניסה הבאה למסך</p>':D.st==='ok'?'<p class="note" style="margin:6px 0 0">נשמר</p>':''}
  <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:8px;align-items:center"><button type="button" class="chip" data-a="lblDUndo"${D.U.length?'':' disabled'} aria-label="ביטול">↶ ביטול</button><button type="button" class="chip" data-a="lblDRedo"${D.R.length?'':' disabled'} aria-label="חזרה">↷ חזרה</button>
  <button type="button" class="chip" data-a="lblDZoom" aria-pressed="${E.z>1}">הגדלה ×2</button><select data-c="lblDSnap" aria-label="הצמדה לרשת" style="min-height:44px">${opt([['1','רשת 1 מ"מ'],['0.5','רשת 0.5 מ"מ'],['0','בלי רשת']],E.snap)}</select>
  <select data-c="lblDAdd" aria-label="הוספת רכיב" style="min-height:44px"><option value="">+ הוספת רכיב</option>${ADD.map(k=>`<option value="${k}">${esc(TL[k])}</option>`).join('')}</select></div>
  <div id="lblDW" dir="ltr" style="overflow:auto;max-height:62vh;margin-top:8px;background:#fff;border-radius:6px;border:1px solid var(--line)"><canvas id="lblDC" width="${Dm.W}" height="${Dm.H}" style="width:${E.z*100}%;height:auto;display:block;touch-action:none;cursor:crosshair"></canvas></div>
  <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:6px;align-items:center"><small class="note">מוצר בעורך:</small>${PR.P.map((p,i)=>`<button type="button" class="chip" data-a="lblDPi" data-v="${i}" aria-pressed="${E.pi===i}" title="${esc(p.name)}">${i+1}</button>`).join('')}</div>
  <div id="lblDWarn" style="margin-top:6px"></div>
  <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:6px">${T.els.map(x=>`<button type="button" class="chip" data-a="lblDSel" data-id="${esc(x.id)}" aria-pressed="${x.id===D.sel}" style="min-height:38px">${esc(elL(x).slice(0,22))}</button>`).join('')||'<small class="note">אין רכיבים – הוסיפו מ"+ הוספת רכיב"</small>'}</div></div>
  <div class="card" id="lblDProps">${propsH(e,T)}</div>
  <div class="card"><label class="f" style="margin:0"><span>לוגו וחותמת כשרות</span><select data-c="lblDBrand">${opt([['lay','לפי הגדרת העסק (פס עליון / פינות)'],['el','כרכיבים בתבנית (במיקום שבחרתם)']],T.brand)}</select></label></div>
  <div class="card"><div class="sec" style="margin-top:0"><h3>תצוגה מדויקת (שחור-לבן)</h3></div><p class="note" style="margin-top:0">כך בדיוק יודפס${PR.ex?' · <b>(דוגמה)</b> – אין מוצרים במלאי, מוצגים מוצרים לדוגמה':''}${PR.busy?' · טוען מוצרים…':''}</p>
  ${PR.P.map((p,i)=>`<div style="margin-bottom:10px"><small class="note">${esc(p.k)}: ${esc(p.name)}</small><canvas data-lbld-p="${i}" width="${Dm.W}" height="${Dm.H}" style="width:100%;height:auto;display:block;background:#fff;border-radius:6px;margin-top:2px"></canvas></div>`).join('')}
  <button class="btn g w" data-a="lblDTest">הדפסת ניסיון – מדבקה אחת (${esc(PR.P[E.pi].name)})</button></div>`;
 setTimeout(wire,0);later();return{t,s:T.name,h}};
const sel1=id=>{E.D.sel=id;E.D.pk='';rr()};
ACT.lblDSel=el=>{if(E.D)sel1(el.dataset.id)};
ACT.lblDPi=el=>{E.pi=Math.max(0,Math.min(2,+el.dataset.v||0));rr()};
ACT.lblDZoom=()=>{E.z=E.z>1?1:2;E.sc=null;rerender()};
CHG.lblDSnap=el=>{E.snap=[1,.5,0].includes(+el.value)?+el.value:1};
ACT.lblDUndo=()=>{const D=E.D;if(!D||!D.U.length)return;D.R.push(snap());D.T=JSON.parse(D.U.pop());D.dirty=1;D.pk='';if(!sel())D.sel=null;rr()};
ACT.lblDRedo=()=>{const D=E.D;if(!D||!D.R.length)return;D.U.push(snap());D.T=JSON.parse(D.R.pop());D.dirty=1;D.pk='';if(!sel())D.sel=null;rr()};
ACT.lblDNudge=el=>nudge(el.dataset.d);
ACT.lblDElDel=()=>{const D=E.D,e=sel();if(!e)return;push();D.T.els=D.T.els.filter(x=>x!==e);D.sel=null;rr()};
CHG.lblDAdd=el=>{const D=E.D,k=el.value;el.value='';if(!D||!NEW[k])return;if(D.T.els.length>=LT.LIM.els)return toast('עד '+LT.LIM.els+' רכיבים בתבנית');
 const Dm=LT.dims(D.T.w,D.T.h),o=Object.assign({},NEW[k]),w=r2(Dm.W*o.w),h=r2(o.h<=1?Dm.H*o.h:Math.min(o.h,Dm.H-8));let n=1;while(D.T.els.some(x=>x.id===o.t+n))n++;
 const e=Object.assign(o,{id:o.t+n,w,h,x:sn((Dm.W-w)/2),y:sn((Dm.H-h)/2)});push();D.T.els.push(LT.normEl(e,D.T.els.length)||e);D.sel=e.id;
 if((k==='logo'||k==='stamp')&&D.T.brand!=='el'){D.T.brand='el';toast('לוגו וחותמת – עכשיו כרכיבים בתבנית')}rr()};
CHG.lblDBrand=el=>{const D=E.D;if(!D)return;push();D.T.brand=el.value==='el'?'el':'lay';rr()};
INP.lblDN=el=>{const D=E.D;if(!D)return;if(D.pk!=='name'){push();D.pk='name'}D.T.name=el.value.slice(0,LT.LIM.name)};
// מאפיין של הרכיב הנבחר: INP (מספרים/טקסט – חי, ביטול אחד לכל רצף הקלדה) ו-CHG (בחירה/תיבת סימון – ציור מסך מחדש)
function setP(el,live){const D=E.D,e=sel();if(!D||!e)return;const k=el.dataset.k;let v;
 if(el.type==='checkbox')v=el.checked?1:0;else if(el.dataset.n||el.dataset.mm){v=parseFloat(el.value);if(!isFinite(v))return;if(el.dataset.mm)v=pxOf(v)}
 else if(k==='fw')v=+el.value;else v=el.value;
 const key=e.id+'|'+k;if(D.pk!==key){push();D.pk=key}
 if(el.dataset.mm&&k==='y'){const d=v-e.y;if(e.y1!=null)e.y1=r2(e.y1+d);if(e.y2!=null)e.y2=r2(e.y2+d)}
 if(el.dataset.mm&&(k==='w'||k==='h'))v=Math.max(10,v);
 if(k==='hlIn'&&!v)delete e.hlIn;else if(k==='if'&&!v)delete e.if;else e[k]=v;
 if(k==='dgs'&&v&&!e.dg)e.dg=22;if(k==='h'){delete e.y1;delete e.y2}
 const n=LT.normEl(e,0);if(n){n.id=e.id;D.T.els[D.T.els.indexOf(e)]=n}
 if(live)paint();else rr()}
INP.lblDP=el=>setP(el,1);CHG.lblDP=el=>{if(el.tagName==='SELECT'||el.type==='checkbox')setP(el,0);else{if(E.D)E.D.pk='';paint()}};
// שמירה: tplOk; אם בענן יש גרסה חדשה יותר (at) – שואלים לפני דריסה
ACT.lblDSave=async el=>{const D=E.D;if(!D)return;const nm=String(D.T.name||'').trim();if(!nm||nm.length>LT.LIM.name)return toast('שם התבנית: 1 עד 40 תווים');
 const T=nrm(Object.assign({},D.T,{name:nm}));if(!T||!LT.ID_OK.test(T.id))return toast('התבנית לא תקינה (עד '+LT.LIM.els+' רכיבים)');
 if(D.isNew&&full())return;if(el)el.disabled=true;let cl=null;try{const d=await fsx('/lblt/'+T.id);cl=d&&d.fields?LP.dec(d):null}catch(e){}
 const go2=async()=>{try{const r=await LP.tSave(T);D.at0=(all().find(x=>x.id===T.id)||{}).at||Date.now();D.T.name=nm;D.dirty=0;D.isNew=0;D.st=r;toast(r==='ok'?'התבנית נשמרה':'נשמר במכשיר בלבד');}catch(e){toast('השמירה נכשלה'+(e&&e.message?': '+e.message:''))}if(cur().v==='lblDE')rr()};
 if(cl&&+cl.at>(D.at0||0)){if(el)el.disabled=false;return ask('התבנית עודכנה במכשיר אחר אחרי שפתחת אותה. לשמור בכל זאת ולדרוס את השינויים שם?',()=>{closeDlg();go2()},'כן, שמור')}
 await go2()};
// הדפסת ניסיון: מדבקה אחת של המוצר שבעורך, אותו build של ההדפסה
ACT.lblDTest=async el=>{const D=E.D;if(!D)return;const T=nrm(D.T);if(!T)return toast('התבנית לא תקינה');if(el)el.disabled=true;toast('מכין הדפסת ניסיון…');
 try{const P=prods().P,it=itOf(P[E.pi]||P[0],T);await LP.out(await LP.build([{it,tpl:0,n:1,T}]))}catch(e){toast('ההדפסה נכשלה: '+(e&&e.message||e))}finally{if(el)el.disabled=false}};
/* ---------- מסך: גדלים ותבנית ברירת מחדל (lbls/main – כל מי שיש לו הרשאת מדבקות) ---------- */
V.lblDS=()=>{const t='גדלים וברירת מחדל';if(!LP.ok())return noPerm(t);LP.prep();
 if(!E.sIn){E.sIn=1;E.S=null;const iv=setInterval(()=>{let on=false;try{on=cur().v==='lblDS'}catch(e){}if(!on){clearInterval(iv);E.sIn=0}},1000)} // בכל כניסה – טיוטה חדשה מההגדרות השמורות
 const L=LP.ls();if(!E.S)E.S={sz:L.sz.filter(s=>!LT.isDef(s.w,s.h)),def:L.def||''};const S=E.S;
 const TL2=[['b1','1. '+TPLN[1]]].concat([2,3,4,5].map(n=>['b'+n,n+'. '+TPLN[n]])).concat(all().filter(x=>!x.base&&!x.del).map(x=>[x.id,x.name]));
 return{t,s:'מדבקות',h:`<div class="card"><div class="sec" style="margin-top:0"><h3>גדלי מדבקות</h3></div><p class="note" style="margin-top:0">הגדלים שמופיעים ביצירת תבנית חדשה. לכל העסק, בכל המכשירים.</p>
  <div class="li" style="cursor:default"><div class="m"><b>${sz(50,25)}</b><small>ברירת מחדל – קבוע</small></div></div>
  ${S.sz.map((s,i)=>`<div class="li" style="cursor:default;gap:8px"><div class="m"><b>${sz(s.w,s.h)}</b></div><button class="btn s g" data-a="lblDSzDel" data-n="${i}">הסר</button></div>`).join('')}
  ${S.sz.length<LT.LIM.sz-1?`<form data-f="lblDSz" autocomplete="off" class="row" style="gap:8px;align-items:flex-end;margin-top:8px"><label class="f grow" style="margin:0"><span>רוחב (מ"מ)</span><input name="w" type="number" inputmode="decimal" min="15" max="104" step="0.5" required></label><label class="f grow" style="margin:0"><span>גובה (מ"מ)</span><input name="h" type="number" inputmode="decimal" min="10" max="100" step="0.5" required></label><button class="btn s">הוסף</button></form>`:'<small class="note">הגעתם למספר הגדלים המרבי</small>'}</div>
  <div class="card"><label class="f" style="margin:0"><span>תבנית ברירת מחדל במסך ההדפסה</span><select data-c="lblDDef">${opt([['','1. '+TPLN[1]+' (ללא הגדרה)']].concat(TL2.slice(1)),S.def==='b1'?'':S.def)}</select></label></div>
  <button class="btn w" data-a="lblDSSave">שמור</button>`}};
FRM.lblDSz=f=>{const S=E.S,w=+f.elements.w.value,h=+f.elements.h.value;if(!S)return;if(!(w>=15&&w<=104&&h>=10&&h<=100))return toast('רוחב 15–104 מ"מ, גובה 10–100 מ"מ');
 if(LT.isDef(w,h)||S.sz.some(s=>s.w===w&&s.h===h))return toast('הגודל כבר קיים');S.sz.push({w,h});rerender()};
ACT.lblDSzDel=el=>{const S=E.S;if(S){S.sz.splice(+el.dataset.n,1);rerender()}};
CHG.lblDDef=el=>{if(E.S)E.S.def=String(el.value||'').slice(0,40)};
ACT.lblDSSave=async el=>{const S=E.S;if(!S)return;if(el)el.disabled=true;try{const r=await LP.sSave({sz:S.sz,def:S.def});E.S=null;toast(r==='ok'?'נשמר':'נשמר במכשיר בלבד – יישלח לענן בכניסה הבאה');goBack()}catch(e){if(el)el.disabled=false;toast('השמירה נכשלה')}};
root.LblDesign={busy:()=>!!E.drag,E,LPS};
})(typeof window!=='undefined'?window:globalThis);
