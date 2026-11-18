/* store3d-pano.js – צפייה בסיור 360 (שלב 18ב). window.S3Pano. תלוי ב-three.js המקומי (vendor/three), בלי CDN. נטען רק בכניסה לסיור.
   open(el, tour, opts) -> Promise<handle|null>
     tour: {pts:[{id, x, y (ס"מ במפה), yaw (מעלות; כיוון מרכז התמונה, 0 = למעלה במפה, בכיוון השעון), full:path, sm:path, nb:[ids]}], start:id}
     opts: {load(path)->Promise<Blob>, map (smap, למפה הקטנה), onError(code,txt), onClose(), tags:[{x,y,k}] (k: ok|iss|miss|rev), base, maxTex? (לבדיקות בלבד: מגבלת טקסטורה נמוכה מזו של המכשיר)}
   שלב 21ו – תמונות 8192×4096: טקסטורה אחת כש-maxTextureSize ≥ 8192; אחרת (4096 ומעלה) שני חצאים 4096×4096 על שני חצאי כדור – בלי איבוד איכות.
     בטלפון עם deviceMemory < 4 – מוקטן ל-4096. כשנטענה תמונה רחבה מ-4096, נטענת מראש מלאה של שכנה אחת בלבד (במקום שתיים), כדי לחסום את הזיכרון.
   handle: goTo(id) · setTags(tags) · showTags(bool) · setView(yawDeg,pitchDeg,fov) · view() · pause() · resume() · destroy() · stats() · screenOf(id) (לבדיקות)
   מוסכמות: כיוון (bearing) = מעלות מהכיוון "למעלה במפה" עם כיוון השעון. גובה העין 1.5 מ'. */
(function(){
'use strict';
const BASE=(document.currentScript&&document.currentScript.src)?new URL('.',document.currentScript.src).href:'';
let threeP=null;
function preload(base){return threeP||(threeP=import((base||BASE)+'vendor/three/three.module.min.js').catch(e=>{threeP=null;throw e}))}
function supported(){try{const c=document.createElement('canvas');return!!(window.WebGLRenderingContext&&(c.getContext('webgl2')||c.getContext('webgl')))}catch(e){return false}}
const GOLD='#d4af37',DEG=Math.PI/180,EYE=1.5,ARR_D=2.5,FOV_MIN=40,FOV_MAX=90,TAG_MAX_CM=600;
const COL={ok:'#2f7a4f',iss:'#b7791f',miss:'#b42318',rev:'#7c4dcc'},SYM={ok:'✓',iss:'!',miss:'✕',rev:'?'};
const bearing=(a,b)=>Math.atan2(b.x-a.x,-(b.y-a.y))/DEG;
const dist=(a,b)=>Math.hypot(b.x-a.x,b.y-a.y);
const norm=a=>((a%360)+540)%360-180;
function msgBox(el,txt,btn){const d=document.createElement('div');d.className='s3p-msg';d.dir='rtl';
  d.style.cssText='position:absolute;inset:0;display:flex;flex-direction:column;gap:14px;align-items:center;justify-content:center;text-align:center;padding:20px;background:#15151a;color:#e8d9a8;font:15px/1.6 sans-serif;z-index:5';
  const t=document.createElement('div');t.textContent=txt;d.appendChild(t);if(btn)d.appendChild(btn);el.appendChild(d);return d}
function mkBtn(txt,fn){const b=document.createElement('button');b.type='button';b.textContent=txt;
  b.style.cssText='min-width:44px;min-height:44px;padding:0 14px;border-radius:12px;border:1px solid '+GOLD+';background:rgba(21,21,26,.82);color:#e8d9a8;font:600 14px sans-serif;cursor:pointer';
  b.addEventListener('click',e=>{e.stopPropagation();fn()});return b}

async function open(el,tour,opts){
  opts=opts||{};
  if(getComputedStyle(el).position==='static')el.style.position='relative';
  const fail=(code,txt)=>{msgBox(el,txt,opts.onClose?mkBtn('סגירה',()=>opts.onClose()):null);if(opts.onError)try{opts.onError(code,txt)}catch(e){}return null};
  if(!tour||!Array.isArray(tour.pts)||!tour.pts.length)return fail('notour','אין נקודות בסיור.');
  if(!supported())return fail('nowebgl','המכשיר הזה לא תומך בתצוגת תלת מימד (WebGL), לכן אי אפשר להציג את הסיור.');
  let T;try{T=await preload(opts.base)}catch(e){return fail('load','טעינת תצוגת התלת מימד נכשלה. נסו שוב.')}
  try{return make(T,el,tour,opts)}catch(e){console.error(e);return fail('init','לא ניתן להפעיל את הסיור במכשיר הזה.')}
}

function make(T,el,tour,opts){
  const P=new Map();for(const p of tour.pts){if(p&&p.id!=null&&isFinite(p.x)&&isFinite(p.y))P.set(p.id,{id:p.id,x:+p.x,y:+p.y,yaw:+p.yaw||0,full:p.full,sm:p.sm,nb:(p.nb||[]).filter(i=>i!==p.id),t:{sm:null,full:null},pend:{}})}
  for(const p of P.values())p.nb=p.nb.filter(i=>P.has(i));
  if(!P.size)throw new Error('empty');
  const load=typeof opts.load==='function'?opts.load:()=>Promise.reject(new Error('no-loader'));
  const renderer=new T.WebGLRenderer({antialias:false,alpha:false,powerPreference:'high-performance'});
  const maxTex=Math.min(renderer.capabilities.maxTextureSize||2048,+opts.maxTex||1e9),dm=navigator.deviceMemory,memOk=!(dm&&dm<4);
  /* רוחב מרבי של מלאה: 8192 (טקסטורה אחת, או שני חצאים כש-maxTex בין 4096 ל-8192); 4096 בזיכרון נמוך */
  const TEXW=maxTex>=4096?(memOk?8192:4096):2048,SPLIT=TEXW>maxTex;let big8=false;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
  const root=document.createElement('div');root.dir='rtl';root.className='s3p-root';
  root.style.cssText='position:absolute;inset:0;overflow:hidden;background:#101014;touch-action:none;user-select:none;-webkit-user-select:none;font-family:sans-serif';
  const cv=renderer.domElement;cv.style.cssText='position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none';
  root.appendChild(cv);el.appendChild(root);
  const scene=new T.Scene(),cam=new T.PerspectiveCamera(75,1,0.05,50);cam.rotation.order='YXZ';
  let H=0,Pt=0,fov=75,vH=0,vP=0,vF=0;
  const geo=new T.SphereGeometry(10,48,32);geo.scale(-1,1,1);
  /* חצאי כדור לתמונה מפוצלת: שמאל התמונה (u 0–0.5) = phi 0–π, ימין = π–2π; החצי הימני הוא "ילד" של הכדור ומקבל את אותו סיבוב */
  const geoL=new T.SphereGeometry(10,24,32,0,Math.PI),geoR=new T.SphereGeometry(10,24,32,Math.PI,Math.PI);geoL.scale(-1,1,1);geoR.scale(-1,1,1);
  const spheres=[0,1].map(i=>{const m=new T.Mesh(geo,new T.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:1,depthWrite:false}));m.visible=false;m.renderOrder=i;
    const hr=new T.Mesh(geoR,new T.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:1,depthWrite:false}));hr.visible=false;m.add(hr);m.userData.hr=hr;scene.add(m);return m});
  let front=0,cur=null,shown=[null,null],busy=false,tok=0,alive=true,paused=false,dirty=true,raf=0,lost=false,fadeT=null,tagsOn=true,fullMax=0;
  const live={sm:0,full:0};
  /* חצים על הרצפה */
  const ac=document.createElement('canvas');ac.width=ac.height=128;{const g=ac.getContext('2d');g.fillStyle='rgba(20,20,20,.55)';g.beginPath();g.arc(64,64,60,0,7);g.fill();
    g.strokeStyle=GOLD;g.lineWidth=7;g.stroke();g.fillStyle=GOLD;g.beginPath();g.moveTo(64,20);g.lineTo(100,72);g.lineTo(76,72);g.lineTo(76,104);g.lineTo(52,104);g.lineTo(52,72);g.lineTo(28,72);g.closePath();g.fill()}
  const arrTex=new T.CanvasTexture(ac),arrGeo=new T.PlaneGeometry(0.9,0.9);arrGeo.rotateX(-Math.PI/2);
  const arrMat=new T.MeshBasicMaterial({map:arrTex,transparent:true,depthWrite:false,depthTest:false});
  const arrows=new T.Group(),tagG=new T.Group();scene.add(arrows,tagG);
  const bdgTex={};
  function badgeTex(k){if(bdgTex[k])return bdgTex[k];let c;
    if(window.Store3D&&typeof window.Store3D.badge==='function')try{c=window.Store3D.badge(k,64)}catch(e){}
    if(!c){c=document.createElement('canvas');c.width=c.height=64;const g=c.getContext('2d');g.fillStyle=COL[k]||'#555';g.beginPath();g.arc(32,32,28,0,7);g.fill();g.lineWidth=4;g.strokeStyle='#fff';g.stroke();
      g.fillStyle='#fff';g.font='bold 34px sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillText(SYM[k]||'',32,34)}
    return bdgTex[k]=new T.CanvasTexture(c)}
  let tags=Array.isArray(opts.tags)?opts.tags.slice():[];
  /* ממשק */
  const ui=document.createElement('div');ui.style.cssText='position:absolute;inset:0;pointer-events:none';root.appendChild(ui);
  const bar=document.createElement('div');bar.style.cssText='position:absolute;top:8px;left:8px;right:8px;display:flex;justify-content:space-between;gap:8px;pointer-events:auto;direction:rtl';
  const bClose=mkBtn('✕ סגירה',()=>{const f=opts.onClose;destroy();if(f)try{f()}catch(e){}});
  const bTags=mkBtn('סימונים',()=>{showTags(!tagsOn)});bTags.setAttribute('aria-pressed','true');
  bar.append(bClose,bTags);ui.appendChild(bar);
  const hint=document.createElement('div');hint.style.cssText='position:absolute;bottom:10px;right:10px;max-width:60%;color:#e8d9a8;font-size:12px;background:rgba(21,21,26,.7);padding:5px 9px;border-radius:8px;direction:rtl';
  hint.textContent='גררו להסתכלות · צביטה לזום · הקשה על חץ לקפיצה';ui.appendChild(hint);
  const spin=document.createElement('div');spin.style.cssText='position:absolute;top:60px;left:50%;transform:translateX(-50%);color:#e8d9a8;font-size:13px;background:rgba(21,21,26,.8);padding:5px 12px;border-radius:14px;display:none;direction:rtl';spin.textContent='טוען…';ui.appendChild(spin);
  const MS=104,mm=document.createElement('canvas');mm.width=mm.height=MS*2;mm.style.cssText='position:absolute;bottom:10px;left:10px;width:'+MS+'px;height:'+MS+'px;border:1px solid '+GOLD+';border-radius:10px;background:rgba(21,21,26,.78);pointer-events:auto;touch-action:none';
  mm.setAttribute('aria-label','מפה קטנה');ui.appendChild(mm);
  const mg=mm.getContext('2d');
  let bx0=1e9,by0=1e9,bx1=-1e9,by1=-1e9;
  const ext=(x,y)=>{bx0=Math.min(bx0,x);by0=Math.min(by0,y);bx1=Math.max(bx1,x);by1=Math.max(by1,y)};
  for(const p of P.values())ext(p.x,p.y);
  const smap=opts.map&&typeof opts.map==='object'?opts.map:null,mrooms=[],mwalls=[];
  if(smap){for(const r of(smap.rooms||[]))if(r&&r.del!==1&&Array.isArray(r.p)&&r.p.length>=6){mrooms.push(r.p);for(let i=0;i+1<r.p.length;i+=2)ext(r.p[i],r.p[i+1])}
    for(const w of(smap.walls||[]))if(w&&w.del!==1&&Array.isArray(w.p)&&w.p.length===4)mwalls.push(w.p)}
  const padc=Math.max(80,(bx1-bx0)*.05),mS=(MS*2-24)/Math.max(1,bx1-bx0+padc*2,by1-by0+padc*2);
  const mX=x=>12+(x-bx0+padc)*mS,mY=y=>12+(y-by0+padc)*mS;
  function drawMap(){mg.clearRect(0,0,MS*2,MS*2);mg.lineWidth=2;mg.strokeStyle='rgba(232,217,168,.45)';
    for(const p of mrooms){mg.beginPath();for(let i=0;i+1<p.length;i+=2)i?mg.lineTo(mX(p[i]),mY(p[i+1])):mg.moveTo(mX(p[i]),mY(p[i+1]));mg.closePath();mg.stroke()}
    for(const w of mwalls){mg.beginPath();mg.moveTo(mX(w[0]),mY(w[1]));mg.lineTo(mX(w[2]),mY(w[3]));mg.stroke()}
    mg.strokeStyle='rgba(212,175,55,.35)';for(const p of P.values())for(const i of p.nb){const q=P.get(i);if(q&&String(p.id)<String(q.id)){mg.beginPath();mg.moveTo(mX(p.x),mY(p.y));mg.lineTo(mX(q.x),mY(q.y));mg.stroke()}}
    for(const p of P.values()){mg.fillStyle=p===cur?GOLD:'#e8d9a8';mg.beginPath();mg.arc(mX(p.x),mY(p.y),p===cur?7:5,0,7);mg.fill()}
    if(cur){const x=mX(cur.x),y=mY(cur.y),h=H*DEG,hf=fov*DEG/2*(cam.aspect||1)*.8+.3,L=44;
      mg.fillStyle='rgba(212,175,55,.5)';mg.beginPath();mg.moveTo(x,y);mg.arc(x,y,L,h-Math.PI/2-hf,h-Math.PI/2+hf);mg.closePath();mg.fill()}}
  mm.addEventListener('pointerdown',e=>{e.stopPropagation();const r=mm.getBoundingClientRect(),px=(e.clientX-r.left)/r.width*MS*2,py=(e.clientY-r.top)/r.height*MS*2;
    let best=null,bd=40;for(const p of P.values()){const d=Math.hypot(mX(p.x)-px,mY(p.y)-py);if(d<bd){bd=d;best=p}}if(best&&best!==cur)goTo(best.id)});
  /* טקסטורות */
  function decodeTo(blob){return(window.createImageBitmap?createImageBitmap(blob).catch(()=>null):Promise.resolve(null)).then(bm=>{
      if(bm)return bm;return new Promise((res,rej)=>{const u=URL.createObjectURL(blob),i=new Image();i.onload=()=>{URL.revokeObjectURL(u);res(i)};i.onerror=()=>{URL.revokeObjectURL(u);rej(new Error('decode'))};i.src=u})})}
  function mkTex(blob,maxW){return decodeTo(blob).then(im=>{const w0=im.width||im.naturalWidth,h0=im.height||im.naturalHeight;
      if(!w0||!h0||Math.abs(w0/h0-2)>0.05)throw new Error('ratio');
      const w=Math.min(w0,maxW),h=Math.round(w/2);
      if(w>maxTex){/* שני חצאים h×h (רק כש-SPLIT: 8192 על maxTex 4096+) */
        const half=x0=>{const c=document.createElement('canvas');c.width=h;c.height=h;const g2=c.getContext('2d');g2.imageSmoothingEnabled=true;g2.imageSmoothingQuality='high';g2.drawImage(im,x0*w0/w,0,h*w0/w,h0,0,0,h,h);return texOf(c,1)};
        const t=half(0);t.userData.b=half(h);if(im.close)im.close();big8=true;return t}
      const c=document.createElement('canvas');c.width=w;c.height=h;const g2=c.getContext('2d');g2.imageSmoothingEnabled=true;g2.imageSmoothingQuality='high';g2.drawImage(im,0,0,w,h);if(im.close)im.close();
      if(w>4096)big8=true;return texOf(c)})}
  function texOf(c,half){const w=c.width,h=c.height;{
      const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;const p2=n=>n>0&&(n&(n-1))===0,mip=p2(w)&&p2(h);t.generateMipmaps=mip;t.minFilter=mip?T.LinearMipmapLinearFilter:T.LinearFilter;t.magFilter=T.LinearFilter;t.wrapS=half?T.ClampToEdgeWrapping:T.RepeatWrapping;/* חצי: בלי גלישה לצד השני של אותו חצי בקצוות */
      let an=1;try{an=Math.max(1,Math.min(8,(renderer&&renderer.capabilities&&renderer.capabilities.getMaxAnisotropy&&renderer.capabilities.getMaxAnisotropy())||1))}catch(_){}t.anisotropy=an;t.userData.cv=c;return t}}
  function freeTex(p,k){const t=p.t[k];if(!t)return;p.t[k]=null;live[k]--;for(const x of[t,t.userData.b]){if(!x)continue;x.dispose();if(x.userData.cv){x.userData.cv.width=x.userData.cv.height=1;x.userData.cv=null}}t.userData.b=null}
  function ensure(p,k){
    if(p.t[k])return Promise.resolve(p.t[k]);if(p.pend[k])return p.pend[k];const path=p[k];if(!path)return Promise.reject(new Error('nopath'));
    const pr=Promise.resolve().then(()=>load(path)).then(b=>{if(!(b instanceof Blob)||!b.size)throw new Error('blob');return mkTex(b,k==='sm'?1024:TEXW)}).then(t=>{
      delete p.pend[k];if(!alive||lost){disp(t);return Promise.reject(new Error('cancel'))}
      if(!wanted(p,k)){disp(t);return Promise.reject(new Error('cancel'))}
      p.t[k]=t;live[k]++;if(k==='full')fullMax=Math.max(fullMax,live.full);return t},e=>{delete p.pend[k];throw e});
    p.pend[k]=pr;return pr}
  const disp=t=>{t.dispose();if(t.userData.b)t.userData.b.dispose()};/* טקסטורה שלא נכנסה לשימוש (כולל החצי השני) */
  const fnb=()=>big8?1:2;/* מלאות של שכנות שנטענות מראש */
  /* מדיניות זיכרון: מלאות – הנוכחית, ועוד 2 השכנות הקרובות; קטנות – הנוכחית והשכנות. מה שמוצג כרגע לא משתחרר. */
  function nearNb(p){return p.nb.map(i=>P.get(i)).sort((a,b)=>dist(p,a)-dist(p,b))}
  function wantSet(){const tgt=cur,full=new Set(),small=new Set();if(tgt){full.add(tgt);small.add(tgt);nearNb(tgt).forEach((q,i)=>{small.add(q);if(i<fnb())full.add(q)})}
    return{full,small}}
  function wanted(p,k){const w=wantSet();return(k==='full'?w.full:w.small).has(p)||shown.some(id=>id===p.id)}
  function enforce(){const w=wantSet();for(const p of P.values()){const keep=shown.indexOf(p.id)>=0;
      if(p.t.full&&!w.full.has(p)&&!keep)freeTex(p,'full');if(p.t.sm&&!w.small.has(p)&&!keep)freeTex(p,'sm')}}
  /* תצוגה */
  function setSphere(i,p,t){const m=spheres[i],hr=m.userData.hr,b=t.userData.b||null;m.material.map=t;m.material.needsUpdate=true;
    m.geometry=b?geoL:geo;hr.material.map=b;hr.material.needsUpdate=true;hr.visible=!!b;m.rotation.y=-(p.yaw+90)*DEG;m.visible=true;shown[i]=p.id;dirty=true}
  function bestTex(p){return p.t.full||p.t.sm}
  function buildArrows(){while(arrows.children.length)arrows.remove(arrows.children[0]);
    for(const q of nearNb(cur)){const b=bearing(cur,q)*DEG,m=new T.Mesh(arrGeo,arrMat);m.position.set(Math.sin(b)*ARR_D,-EYE+0.05,-Math.cos(b)*ARR_D);m.rotation.y=-b;m.renderOrder=9;m.userData.id=q.id;arrows.add(m)}}
  function buildTags(){while(tagG.children.length)tagG.remove(tagG.children[0]);
    for(const t of tags){if(!t||!COL[t.k]||!isFinite(t.x)||!isFinite(t.y))continue;const d=dist(cur,t);if(d>TAG_MAX_CM||d<30)continue;
      const b=bearing(cur,t)*DEG,r=4,s=new T.Sprite(new T.SpriteMaterial({map:badgeTex(t.k),transparent:true,depthTest:false,depthWrite:false}));
      s.position.set(Math.sin(b)*r,-0.3,-Math.cos(b)*r);s.scale.set(.4,.4,1);s.renderOrder=10;tagG.add(s)}
    tagG.visible=tagsOn;dirty=true}
  function showTags(on){tagsOn=!!on;tagG.visible=tagsOn;bTags.setAttribute('aria-pressed',String(tagsOn));bTags.style.background=tagsOn?'rgba(212,175,55,.9)':'rgba(21,21,26,.82)';bTags.style.color=tagsOn?'#141414':'#e8d9a8';dirty=true}
  function setTags(a){tags=Array.isArray(a)?a.slice():[];if(cur)buildTags()}
  /* הסיבה האמיתית לכשל הטעינה, כדי שאפשר יהיה לדעת מה לתקן (e1 – הכשל בתמונה הקטנה, e2 – בגדולה) */
  function loadMsg(e1,e2){const one=x=>!x?'':String(x.code||'')+(x.raw?' '+x.raw:'')+(x.message&&!x.code&&!x.raw?' '+x.message:'')||'?';
    const det=' [פרטים: קטנה – '+one(e1).trim()+'; גדולה – '+one(e2).trim()+'; '+(navigator.onLine===false?'לא מחובר':'מחובר')+']';
    const has=v=>[e1,e2].some(x=>x&&(x.code===v||x.message===v));
    if(has(403))return'אין הרשאה לצפות בתמונה הזו (403).'+det;
    if(has(404))return'התמונה לא נמצאה בשרת (404). אפשר לצלם את הנקודה מחדש.'+det;
    if(has('ratio')||has('decode')||has('blob'))return'קובץ התמונה לא תקין. אפשר לצלם את הנקודה מחדש.'+det;
    if([e1,e2].some(x=>x&&x.offline))return'הבקשה להורדת התמונה לא הגיעה לשרת.'+det;
    return'טעינת התמונה נכשלה. נסו שוב.'+det}
  function err(code,txt){if(!alive)return;const d=msgBox(root,txt,mkBtn('נסו שוב',()=>{d.remove();if(cur)goTo(cur.id,true);else goTo(tour.start)}));if(opts.onError)try{opts.onError(code,txt)}catch(e){}}
  async function preloadAround(p,my){
    try{await Promise.all(nearNb(p).map(q=>q.sm?ensure(q,'sm').catch(()=>{}):0));
      if(my!==tok)return;
      if(p.full&&!p.t.full){const t=await ensure(p,'full').catch(()=>null);if(t&&my===tok&&shown[front]===p.id&&!busy){setSphere(front,p,t)}}
      for(const q of nearNb(p).slice(0,fnb())){if(my!==tok)return;if(q.full)await ensure(q,'full').catch(()=>{})}
    }catch(e){}}
  async function goTo(id,force){
    const p=P.get(id);if(!p||!alive||(p===cur&&!force)||(busy&&!force))return;
    const my=++tok;busy=true;spin.style.display='block';
    const prev=cur;cur=p;enforce();
    let t=bestTex(p);
    if(!t){let e0=null;try{t=await(p.sm?ensure(p,'sm').catch(e=>{e0=e;return p.full?ensure(p,'full'):Promise.reject(e)}):ensure(p,'full'))}catch(e){
        if(my!==tok||!alive)return;cur=prev;busy=false;spin.style.display='none';err('load',loadMsg(e0||e,e));return}}
    if(my!==tok||!alive)return;
    spin.style.display='none';
    if(!prev||force){setSphere(front,p,t);spheres[1-front].visible=false;shown[1-front]=null}
    else{await fade(p,t,my);if(my!==tok||!alive)return}
    busy=false;buildArrows();buildTags();enforce();drawMap();dirty=true;
    preloadAround(p,my)}
  function fade(p,t,my){return new Promise(res=>{
    const b=1-front;arrows.visible=false;setSphere(b,p,t);const mb=spheres[b],mf=spheres[front];mb.material.opacity=0;mf.material.opacity=1;mb.renderOrder=2;mf.renderOrder=1;
    const t0=performance.now(),f0=fov,DUR=500;
    fadeT=()=>{const k=Math.min(1,(performance.now()-t0)/DUR);mb.material.opacity=k;fov=f0-8*Math.sin(Math.PI*k);dirty=true;
      if(k>=1){fadeT=null;fov=f0;mf.visible=false;shown[front]=null;front=b;mb.renderOrder=1;arrows.visible=true;res()}}
    if(paused||!alive){mb.material.opacity=1;fadeT=null;mf.visible=false;shown[front]=null;front=b;arrows.visible=true;res()}})}
  /* מצלמה */
  function applyCam(){cam.fov=fov;cam.rotation.y=-H*DEG;cam.rotation.x=Pt*DEG;cam.updateProjectionMatrix()}
  function resize(){const w=el.clientWidth||root.clientWidth||1,h=el.clientHeight||root.clientHeight||1;renderer.setSize(w,h,false);cam.aspect=w/h;dirty=true}
  const ro=typeof ResizeObserver==='function'?new ResizeObserver(resize):null;if(ro)ro.observe(el);window.addEventListener('resize',resize);
  /* מגע */
  const ptr=new Map();let down=null,pinch0=0,fov0=75;
  const clampP=()=>{Pt=Math.max(-85,Math.min(85,Pt));fov=Math.max(FOV_MIN,Math.min(FOV_MAX,fov))};
  cv.addEventListener('pointerdown',e=>{if(lost)return;try{cv.setPointerCapture(e.pointerId)}catch(_){}ptr.set(e.pointerId,{x:e.clientX,y:e.clientY});vH=vP=0;
    if(ptr.size===1)down={x:e.clientX,y:e.clientY,t:performance.now(),moved:false,lx:e.clientX,ly:e.clientY,lt:performance.now()};
    else{down=null;const[a,b]=[...ptr.values()];pinch0=Math.hypot(a.x-b.x,a.y-b.y);fov0=fov}});
  cv.addEventListener('pointermove',e=>{const q=ptr.get(e.pointerId);if(!q)return;q.x=e.clientX;q.y=e.clientY;
    if(ptr.size>=2){const[a,b]=[...ptr.values()],d=Math.hypot(a.x-b.x,a.y-b.y);if(pinch0>0){fov=fov0*pinch0/Math.max(10,d);clampP();dirty=true}return}
    if(!down)return;const dx=e.clientX-down.lx,dy=e.clientY-down.ly;
    if(!down.moved&&Math.hypot(e.clientX-down.x,e.clientY-down.y)>6)down.moved=true;
    if(down.moved){const k=fov/Math.max(1,cv.clientHeight),now=performance.now(),dt=Math.max(1,now-down.lt);
      H-=dx*k;Pt+=dy*k;clampP();vH=-dx*k/dt*16;vP=dy*k/dt*16;down.lx=e.clientX;down.ly=e.clientY;down.lt=now;dirty=true}});
  const up=e=>{if(!ptr.has(e.pointerId))return;ptr.delete(e.pointerId);
    if(down&&ptr.size===0){const d=down;down=null;if(e.type==='pointerup'){if(!d.moved&&performance.now()-d.t<600)tap(e.clientX,e.clientY);else if(performance.now()-d.lt>80)vH=vP=0}}
    if(ptr.size<2)pinch0=0;if(ptr.size===1){const q=[...ptr.values()][0];down={x:q.x,y:q.y,t:performance.now(),moved:true,lx:q.x,ly:q.y,lt:performance.now()}}};
  cv.addEventListener('pointerup',up);cv.addEventListener('pointercancel',up);
  cv.addEventListener('wheel',e=>{e.preventDefault();fov+=e.deltaY*0.04;clampP();dirty=true},{passive:false});
  const v3=new T.Vector3();
  function screenOf(id){const m=arrows.children.find(a=>a.userData.id===id);if(!m)return null;applyCam();cam.updateMatrixWorld();v3.copy(m.position).project(cam);
    if(v3.z>1)return null;const r=cv.getBoundingClientRect();return{x:r.left+(v3.x+1)/2*r.width,y:r.top+(1-v3.y)/2*r.height}}
  function tap(cx,cy){if(busy||!cur)return;let best=null,bd=48;for(const m of arrows.children){const s=screenOf(m.userData.id);if(!s)continue;const d=Math.hypot(s.x-cx,s.y-cy);if(d<bd){bd=d;best=m.userData.id}}
    if(best!=null)goTo(best)}
  /* אובדן הקשר WebGL */
  cv.addEventListener('webglcontextlost',e=>{e.preventDefault();lost=true;const d=document.createElement('div');d.className='s3p-lost';
    d.style.cssText='position:absolute;top:60px;left:50%;transform:translateX(-50%);background:#b42318;color:#fff;padding:8px 14px;border-radius:12px;font-size:14px;direction:rtl;z-index:4';d.textContent='התצוגה נקטעה, ממתינים לחידוש…';root.appendChild(d)});
  cv.addEventListener('webglcontextrestored',()=>{lost=false;root.querySelectorAll('.s3p-lost').forEach(n=>n.remove());
    for(const p of P.values()){freeTex(p,'sm');freeTex(p,'full');p.pend={}}shown=[null,null];spheres.forEach(m=>m.visible=false);busy=false;arrTex.needsUpdate=true;for(const k in bdgTex)bdgTex[k].needsUpdate=true;
    if(cur){const id=cur.id;goTo(id,true)}});
  /* לולאת ציור – רק כשיש שינוי */
  function frame(){raf=0;if(!alive||paused)return;
    if(fadeT)fadeT();
    if(Math.abs(vH)>0.01||Math.abs(vP)>0.01){if(!down){H+=vH;Pt+=vP;vH*=.92;vP*=.92;clampP();dirty=true}}else vH=vP=0;
    if(dirty&&!lost){dirty=false;H=norm(H);applyCam();for(const m of spheres){const hr=m.userData.hr;hr.material.opacity=m.material.opacity;hr.renderOrder=m.renderOrder}renderer.render(scene,cam);drawMap()}
    raf=requestAnimationFrame(frame)}
  function pause(){paused=true;if(raf){cancelAnimationFrame(raf);raf=0}}
  function resume(){if(!alive||!paused)return;paused=false;dirty=true;if(!raf)raf=requestAnimationFrame(frame)}
  const vis=()=>{document.hidden?pause():resume()};document.addEventListener('visibilitychange',vis);
  function destroy(){if(!alive)return;alive=false;tok++;if(raf)cancelAnimationFrame(raf);document.removeEventListener('visibilitychange',vis);window.removeEventListener('resize',resize);if(ro)ro.disconnect();
    for(const p of P.values()){freeTex(p,'sm');freeTex(p,'full')}
    for(const k in bdgTex)bdgTex[k].dispose();arrTex.dispose();arrGeo.dispose();arrMat.dispose();geo.dispose();geoL.dispose();geoR.dispose();spheres.forEach(m=>{m.material.dispose();m.userData.hr.material.dispose()});
    renderer.dispose();try{renderer.forceContextLoss()}catch(e){}root.remove()}
  function stats(){return{id:cur?cur.id:null,busy,tex:{sm:live.sm,full:live.full},fullMax,texW:TEXW,maxTex,split:[...P.values()].filter(p=>p.t.full&&p.t.full.userData.b).length,fnb:fnb(),geo:renderer.info.memory.geometries,textures:renderer.info.memory.textures,tags:tagG.children.length,arrows:arrows.children.length,paused,lost}}
  function view(){return{id:cur?cur.id:null,yaw:H,pitch:Pt,fov}}
  function setView(y,p,f){vH=vP=0;if(isFinite(y))H=norm(y);if(isFinite(p))Pt=p;if(isFinite(f))fov=f;clampP();dirty=true}
  resize();showTags(true);raf=requestAnimationFrame(frame);
  goTo(P.has(tour.start)?tour.start:[...P.keys()][0]);
  return{goTo,setTags,showTags,setView,view,pause,resume,destroy,stats,screenOf};
}
window.S3Pano={supported,preload,open};
})();
