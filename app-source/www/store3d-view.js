/* store3d-view.js – תצוגת החנות בתלת מימד (שלב 2: מנוע; שלב 9: מראה מציאותי ומצב מיני).
   תלוי ב-store3d-geo.js (window.S3G). ספריית three.js נטענת מקומית ורק בקריאה ל-Store3D.open / mini / preload (אין CDN).
   API ציבורי (window.Store3D, וגם window.S3View – אותו אובייקט):
     supported()                         -> האם יש WebGL במכשיר
     preload()                           -> Promise: טעינת הספרייה מראש (לא חובה)
     open(el, map, opts)                 -> Promise<handle|null>
        opts: {mode:'top'|'walk', sample:bool (תווית "דוגמה"), sum: מסמך s3sum (צבעים ותמונות), load(path)->Promise<Blob> (ברירת מחדל: abkSt מ-index.html),
               legend:bool (ברירת מחדל true), frames:bool (ברירת מחדל true), onPick(bay|null), onError(code,msg), base: נתיב לתיקיית www, mini:bool}
     handle: setMode(m), getMode(), setMap(map), setSum(sum), select(bayId|null), focus(fxId), search(q)->[{fx,num,name}], blink(ids|null, ms),
             frames(bool), walkTo(x,y) (ס"מ בתוכנית), resize(), pause(), resume(), destroy(), stats()
     mini(el, map, sum, opts)            -> {update(map,sum), destroy(), stats(), handle} – אותה סצנה, ברזולוציה מוקטנת ובסיבוב איטי.
        נטען רק כשהחלון נראה במסך (IntersectionObserver), נעצר כשהוא יוצא, ומשחרר זיכרון אחרי 15 שניות מחוץ למסך או כשהאלמנט הוסר.
     STAT                                -> צבעי המצב, הסמלים והשמות בעברית (למקרא במסכים): {c, t, y: סמל, f: צבע הסמל}
     badge(k, px)                        -> קנבס של תג המצב (אותו ציור כמו בתלת מימד), למקרא במסכים אחרים
   סימון מצב: פס דק בשפת המדף (כמו פס תוויות, נראה גם מלמעלה) + תג עגול עם סמל מעל המקטע (גודל קבוע במסך). frames(bool) מסתיר/מציג את שניהם.
     clearCache()                        -> ניקוי מטמון התמונות בזיכרון (יציאה / החלפת עסק)
     opts.loadPh(run,slot)               -> Promise<{th,p}|null> – מסמך ph של מקום צילום (שלב 19א; בלי זה אין תמונה לכל מקום צילום)
     blob(path)                          -> Promise<Blob> – אותה טעינה מ-Storage (okPath + מטמון), לסיור 360
   bay שמוחזר ב-onPick: {id, fx, s, n, lv:[...], lvHit, num, name, k, st}
   מראה: קירות מקבלים את הצילום מ-smap.tx[] לפי rooms[].tex {w,f,c}; הרצפה והתקרה לא נמתחות מהצילום: מהצילום נדגם רק צבע ממוצע – רצפה = אריח עץ מצויר (לוחות 20×120 ס"מ) בצבע הזה, תקרה = צבע חלק בהיר; חזית כל מקטע מקבלת את התמונה המוקטנת האחרונה (s3sum.b[id].th).
   בלי צילום: מדף מתכת לבן ריק, רצפה בהירה (במחסן – בטון אפור), קיר בהיר. אין תמונות דוגמה ואין מוצרים מומצאים.
   מוסכמת צירים: x בתוכנית = x בתלת מימד, y בתוכנית = z, גובה = y. יחידות בתלת מימד: מטרים. */
(function(){
'use strict';
const THREE_VER='0.185.1';
const BASE=(document.currentScript&&document.currentScript.src)?new URL('.',document.currentScript.src).href:'';
let threeP=null;
function preload(base){return threeP||(threeP=import((base||BASE)+'vendor/three/three.module.min.js').catch(e=>{threeP=null;throw e}))}
function supported(){try{const c=document.createElement('canvas');return!!(window.WebGLRenderingContext&&(c.getContext('webgl2')||c.getContext('webgl')))}catch(e){return false}}
function msgBox(el,txt){const d=document.createElement('div');d.className='s3d-msg';d.dir='rtl';
  d.style.cssText='position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:20px;background:#15151a;color:#e8d9a8;font:15px/1.6 sans-serif;z-index:3';
  d.textContent=txt;el.appendChild(d);return d}
async function open(el,map,opts){
  opts=opts||{};
  if(getComputedStyle(el).position==='static')el.style.position='relative';
  const fail=(code,txt)=>{msgBox(el,txt);if(opts.onError)try{opts.onError(code,txt)}catch(e){}return null};
  if(!window.S3G)return fail('nogeo','רכיב התצוגה חסר (store3d-geo.js).');
  if(!supported())return fail('nowebgl','המכשיר הזה לא תומך בתצוגת תלת מימד (WebGL).');
  let T;try{T=await preload(opts.base)}catch(e){return fail('load','טעינת תצוגת התלת מימד נכשלה. נסו שוב.')}
  try{return makeView(T,el,map,opts)}catch(e){console.error(e);return fail('init','לא ניתן להפעיל את תצוגת התלת מימד במכשיר הזה.')}
}

/* ---- מצב מקטע (חוזה 4.11: s3sum.b[].s) – המקום היחיד שבו מוגדרים צבעי המצב, הסמלים והשמות (בתלת מימד ובמקרא).
   c: צבע הפס והתג – פלטה מאופקת, ניגודיות ≥3:1 מול מדף לבן (#eef0f2): ירוק 4.6, ענבר 3.2, אדום 5.8, סגול 4.9, אפור 3.4.
   y: סמל התג – המצב מובן גם בלי להבחין בצבע. f: צבע הסמל, ניגודיות ≥3.6:1 מול c (ענבר עם סמל כהה 4.7).
   ל"לא בסבב" אין תג – רק פס אפור. RING: טבעת לבנה וקו כהה סביב התג, כדי שייראה גם על מדף לבן וגם על תמונה כהה. ---- */
const STAT={ok:{c:0x2f7a4f,y:'✓',f:0xffffff,t:'תקין'},iss:{c:0xb7791f,y:'!',f:0x1b1b1f,t:'בעיה'},miss:{c:0xb42318,y:'✕',f:0xffffff,t:'לא צולם / לא ברור'},rev:{c:0x7c4dcc,y:'?',f:0xffffff,t:'לבדיקה'},out:{c:0x7d838b,y:'',f:0,t:'לא בסבב'}};
const RING={i:0xffffff,o:0x1b1b1f},BDG=['ok','iss','miss','rev'];
const hex=c=>'#'+c.toString(16).padStart(6,'0');
/* תג מצב כקנבס (px×px): עיגול בצבע המצב עם טבעת, והסמל מצויר בקווים (לא תלוי בגופן של המכשיר). ל-out – פס אפור קצר */
function badge(k,px){const S=STAT[k]||STAT.out,c=document.createElement('canvas');c.width=c.height=px;const g=c.getContext('2d'),m=px/2,u=px/64;
  if(!S.y){g.fillStyle=hex(S.c);g.fillRect(4*u,26*u,56*u,12*u);return c}
  g.fillStyle=hex(RING.o);g.globalAlpha=.6;g.beginPath();g.arc(m,m,31.5*u,0,7);g.fill();g.globalAlpha=1;
  g.fillStyle=hex(RING.i);g.beginPath();g.arc(m,m,29*u,0,7);g.fill();
  g.fillStyle=hex(S.c);g.beginPath();g.arc(m,m,24.5*u,0,7);g.fill();
  g.strokeStyle=g.fillStyle=hex(S.f);g.lineWidth=7*u;g.lineCap=g.lineJoin='round';g.beginPath();
  if(k==='ok'){g.moveTo(20*u,33*u);g.lineTo(28*u,41*u);g.lineTo(44*u,24*u);g.stroke()}
  else if(k==='miss'){g.moveTo(23*u,23*u);g.lineTo(41*u,41*u);g.moveTo(41*u,23*u);g.lineTo(23*u,41*u);g.stroke()}
  else if(k==='iss'){g.moveTo(m,19*u);g.lineTo(m,35*u);g.stroke();g.beginPath();g.arc(m,44*u,4.2*u,0,7);g.fill()}
  else{g.lineWidth=6.5*u;g.arc(m,27*u,8*u,Math.PI*1.1,Math.PI*2.3);g.lineTo(m,36*u);g.stroke();g.beginPath();g.arc(m,45*u,4*u,0,7);g.fill()}
  return c}

/* ---- טעינת תמונות מ-Storage: מטמון משותף לכל התצוגות (Blob בזיכרון, עד ~48MB), עד 4 הורדות במקביל ---- */
const okPath=p=>typeof p==='string'&&p.length>0&&p.length<=300&&/^b\/[^/]+\/store3d\/[A-Za-z0-9_./-]+\.jpg$/.test(p)&&p.indexOf('..')<0;
function defLoad(p){if(typeof window.abkSt!=='function')return Promise.reject(new Error('no-loader'));return window.abkSt('/'+encodeURIComponent(p)+'?alt=media').then(r=>r.blob())}
const BC=new Map(),NEG=new Map(),BC_MAX=48e6;let bcBytes=0,active=0;const waitq=[];
const slot=()=>new Promise(r=>{if(active<4){active++;r()}else waitq.push(r)});
const release=()=>{const n=waitq.shift();if(n)n();else active--};
function trim(){for(const[k,e]of BC){if(bcBytes<=BC_MAX)break;if(e.n){BC.delete(k);bcBytes-=e.n}}}
function getBlob(path,load,alive){
  if(!okPath(path))return Promise.reject(new Error('path'));
  const c=BC.get(path);if(c){BC.delete(path);BC.set(path,c);return c.p}
  const ng=NEG.get(path);if(ng&&Date.now()-ng<60000)return Promise.reject(new Error('recent-fail'));
  const e={p:null,n:0};
  e.p=slot().then(()=>{if(!alive())throw Object.assign(new Error('cancel'),{cancel:1});return load(path)}).finally(release)
    .then(b=>{if(!(b instanceof Blob)||!b.size)throw new Error('blob');e.n=b.size;bcBytes+=b.size;trim();return b},
      err=>{if(BC.get(path)===e)BC.delete(path);if(!err||!err.cancel)NEG.set(path,Date.now());throw err});
  BC.set(path,e);return e.p}
function clearCache(){BC.clear();NEG.clear();bcBytes=0}
async function decode(blob){
  if(window.createImageBitmap)try{return await createImageBitmap(blob)}catch(e){}
  return new Promise((res,rej)=>{const u=URL.createObjectURL(blob),i=new Image();i.onload=()=>{URL.revokeObjectURL(u);res(i)};i.onerror=()=>{URL.revokeObjectURL(u);rej(new Error('decode'))};i.src=u})}
const pot=(n,max)=>{let p=16;while(p*2<=Math.min(n,max))p*=2;return p};
/* ציור תמונה בתוך מלבן, חיתוך מהמרכז לפי יחס הרוחב/גובה של המשטח (כמו cover) */
function drawCover(g,img,x,y,w,h,aspect){const iw=img.width,ih=img.height;if(!iw||!ih)return;let sx=0,sy=0,sw=iw,sh=ih;
  if(aspect>0){if(iw/ih>aspect){sw=ih*aspect;sx=(iw-sw)/2}else{sh=iw/aspect;sy=(ih-sh)/2}}
  g.drawImage(img,sx,sy,sw,sh,x,y,w,h)}
const closeImg=i=>{try{i&&i.close&&i.close()}catch(e){}};

function makeView(T,el,map0,opts){
  const G=window.S3G,MINI=!!opts.mini,dpr0=Math.min(window.devicePixelRatio||1,2),dpr=MINI?Math.min(dpr0,1):dpr0;
  const TEXMAX=MINI?256:1024,ATLAS=MINI?512:1024,HI_N=MINI?0:6,load=typeof opts.load==='function'?opts.load:defLoad,PH=!MINI&&typeof opts.loadPh==='function'?opts.loadPh:null;
  const renderer=new T.WebGLRenderer({antialias:MINI||dpr<2,powerPreference:MINI?'low-power':'default'});
  renderer.setPixelRatio(dpr);
  const cv=renderer.domElement;cv.style.cssText='display:block;width:100%;height:100%;touch-action:none;outline:none'+(MINI?';pointer-events:none':'');
  el.appendChild(cv);
  const scene=new T.Scene();scene.background=new T.Color(0x23262c);
  scene.add(new T.HemisphereLight(0xffffff,0x9a9286,2.0));
  const sun=new T.DirectionalLight(0xffffff,1.1);sun.position.set(0.4,1,0.25);scene.add(sun);
  const cam=new T.PerspectiveCamera(55,1,0.05,400);
  const overlay=[];
  if(opts.sample){const b=document.createElement('div');b.dir='rtl';b.textContent='דוגמה – לא נתוני העסק';
    b.style.cssText='position:absolute;top:8px;right:8px;z-index:2;background:rgba(20,20,24,.85);color:#d4af37;border:1px solid #d4af37;border-radius:8px;padding:4px 10px;font:bold 13px sans-serif;pointer-events:none';
    el.appendChild(b);overlay.push(b)}
  let dead=false;const alive=()=>!dead;

  /* ---- חומרים משותפים ---- */
  const disp=[];const keep=o=>{disp.push(o);return o};
  const aniso=Math.min(4,renderer.capabilities.getMaxAnisotropy());
  function canvasTex(w,h,draw,rep){const c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d'),w,h);
    const t=keep(new T.CanvasTexture(c));t.colorSpace=T.SRGBColorSpace;if(rep){t.wrapS=t.wrapT=T.RepeatWrapping;t.repeat.set(rep,rep)}t.anisotropy=aniso;return t}
  /* חומרים ניטרליים כשאין צילום: רצפה בהירה (אריחים 1 מ'), במחסן בטון אפור; תקרה לבנה עם פסי תאורה */
  const WH=map0&&map0.kind==='w';
  const floorTex=canvasTex(128,128,(g,w,h)=>{g.fillStyle=WH?'#a7a8a6':'#dedad2';g.fillRect(0,0,w,h);
    if(WH){for(let i=0;i<500;i++){const v=150+((i*7919)%40);g.fillStyle=`rgba(${v},${v},${v-4},.35)`;g.fillRect((i*37)%w,(i*91)%h,2,2)}}
    else{g.fillStyle='#d6d1c7';g.fillRect(0,0,w/2,h/2);g.fillRect(w/2,h/2,w/2,h/2)}
    g.strokeStyle=WH?'#8f908d':'#bdb6a8';g.lineWidth=2;g.strokeRect(0,0,w,h);g.beginPath();g.moveTo(w/2,0);g.lineTo(w/2,h);g.moveTo(0,h/2);g.lineTo(w,h/2);g.stroke()},1);
  const ceilTex=canvasTex(64,64,(g,w,h)=>{g.fillStyle='#f4f4f1';g.fillRect(0,0,w,h);g.fillStyle='#ffffff';g.fillRect(4,w/2-5,w-8,10);g.strokeStyle='#cfcfc9';g.lineWidth=2;g.strokeRect(0,0,w,h)},1);
  const M={
    floor:keep(new T.MeshLambertMaterial({map:floorTex})),
    ceil:keep(new T.MeshBasicMaterial({map:ceilTex,color:0xe2e2de})),/* תקרה בלי הצללה: מהתאורה בה היא נראית כהה מדי */
    wall:keep(new T.MeshLambertMaterial({color:0xefebe4})),
    inst:keep(new T.MeshLambertMaterial({color:0xffffff})),/* צבע לכל מופע */
    shelf:keep(new T.MeshLambertMaterial({color:0xeef0f2})),
    glass:keep(new T.MeshLambertMaterial({color:0xbfe6ff,transparent:true,opacity:.22,depthWrite:false})),
    stat:keep(new T.MeshBasicMaterial({color:0xffffff})),/* פסי מצב – צבע לכל מופע, בלי הצללה */
    pick:keep(new T.MeshBasicMaterial({visible:false})),
    sel:keep(new T.MeshBasicMaterial({color:0xd4af37,transparent:true,opacity:.28,depthWrite:false})),
    selLine:keep(new T.LineBasicMaterial({color:0xffd24a})),
    blink:keep(new T.MeshBasicMaterial({color:0xffd24a,transparent:true,opacity:.5,depthWrite:false})),
  };
  /* תגי מצב: חומר נקודות אחד לכל מצב (4 קריאות ציור לכל החנות), בגודל קבוע בפיקסלים – לא נעלמים כשמתרחקים */
  const BM={};for(const k of BDG){const t=keep(new T.CanvasTexture(badge(k,64)));t.colorSpace=T.SRGBColorSpace;
    BM[k]=keep(new T.PointsMaterial({map:t,size:16,sizeAttenuation:false,transparent:true,alphaTest:.04,depthWrite:false}))}
  /* גודל התג במסך (פיקסלים): בהליכה – קריא; מלמעלה – קטן, ו"תקין" קטן עוד יותר כדי לא להעמיס. במיני (חלון הבית) – רק תגי חריגה; "תקין" מסומן בפס בלבד */
  function bdgSize(){for(const k of BDG)BM[k].size=MINI?8:mode==='top'?(k==='ok'?11:14):(k==='ok'?20:22);BM.ok.visible=!MINI}
  const BOX=keep(new T.BoxGeometry(1,1,1)),CYL=keep(new T.CylinderGeometry(.5,.5,1,16));
  const TILE=2;/* רצפה ותקרה מצולמות: כל עותק של התמונה מכסה 2×2 מ' (הנחה) */

  /* ---- טקסטורות אמיתיות מ-smap.tx[] (צילומי ההקמה). חומר לכל טקסטורה וסוג משטח, נטען ברקע; עד אז – החומר הניטרלי ---- */
  let txById=new Map();const tmats=new Map(),texP=new Map(),texSt={want:0,ok:0,fail:0};
  function loadTex(t){let p=texP.get(t.path);if(p)return p;texSt.want++;
    p=getBlob(t.path,load,alive).then(decode).then(img=>{if(dead){closeImg(img);throw new Error('dead')}
      const c=document.createElement('canvas');c.width=pot(img.width,TEXMAX);c.height=pot(img.height,TEXMAX);c.getContext('2d').drawImage(img,0,0,c.width,c.height);closeImg(img);
      const tx=keep(new T.CanvasTexture(c));tx.colorSpace=T.SRGBColorSpace;tx.wrapS=tx.wrapT=T.RepeatWrapping;tx.anisotropy=aniso;tx.userData.ar=img.width/img.height||1;texSt.ok++;return tx});
    p.catch(()=>{texSt.fail++});texP.set(t.path,p);return p}
  /* רצפה ותקרה: לא מותחים את הצילום (מעוות, ובתקרה מלא פנסים). דוגמים ממנו רק צבע ממוצע (קנבס 16×16 מהתמונה המוקטנת) ומציירים
     אריח עץ חוזר (לוחות 20×120 ס"מ, פסי הפרדה עדינים, גוון משתנה) לרצפה, וצבע חלק בהיר לתקרה. טקסטורה אחת לכל צבע (מטמון). דגימה נכשלה – חומר ברירת המחדל */
  const woodC=new Map();
  function avgColor(img){try{const c=document.createElement('canvas');c.width=c.height=16;const g=c.getContext('2d');g.drawImage(img,0,0,16,16);
    const d=g.getImageData(0,0,16,16).data;let r=0,gg=0,b=0,n=0;for(let i=0;i<d.length;i+=4){r+=d[i];gg+=d[i+1];b+=d[i+2];n++}
    return n?[r/n,gg/n,b/n]:null}catch(e){return null}}
  function woodTex(rgb){const q=rgb.map(v=>Math.max(0,Math.min(255,Math.round(v/8)*8))),key=q.join(',');let t=woodC.get(key);if(t)return t;
    /* אריח 2.4×1.2 מ' (256×128): 6 שורות לוחות ברוחב 20 ס"מ, אורך לוח 120 ס"מ, מקצה מוסט בחצי לוח בכל שורה שנייה */
    t=canvasTex(256,128,(g,w,h)=>{const rh=h/6,pl=w/2;
      for(let r=0;r<6;r++)for(let k=0;k<2;k++){const x0=k*pl+(r%2)*pl/2,sh=(((r*7+k*13+r*k*5)%9)-4)*.035,f=1+sh;
        g.fillStyle=`rgb(${Math.min(255,q[0]*f)|0},${Math.min(255,q[1]*f)|0},${Math.min(255,q[2]*f)|0})`;
        for(const x of[x0,x0-w])g.fillRect(x,r*rh,pl,rh)}
      g.fillStyle='rgba(0,0,0,.22)';for(let r=0;r<6;r++){g.fillRect(0,r*rh,w,1);for(let k=0;k<2;k++)g.fillRect(((k*pl+(r%2)*pl/2)%w),r*rh,1,rh)}
    },1);t.repeat.set(TILE/2.4,TILE/1.2);woodC.set(key,t);return t}
  function texMat(id,kind){const t=id&&txById.get(id);if(!t)return null;const k=t.path+':'+kind;let m=tmats.get(k);if(m)return m;
    const base=kind==='f'?M.floor:kind==='c'?M.ceil:M.wall;m=keep(base.clone());tmats.set(k,m);
    loadTex(t).then(tx=>{if(dead)return;
      if(kind==='w'){m.map=tx;m.color.set(0xffffff)}
      else{const a=avgColor(tx.image);
        if(kind==='f'){if(!a)return;m.map=woodTex(a);m.color.set(0xffffff)}
        else{m.map=null;if(a)m.color.setRGB(...a.map(v=>(v+(255-v)*.75)/255)).convertSRGBToLinear();else m.color.set(0xffffff)}}
      m.needsUpdate=true;invalidate()}).catch(()=>{});return m}
  const texAr=id=>{const t=id&&txById.get(id);return t&&t.w>0&&t.h>0?t.w/t.h:1};

  /* קירות כגיאומטריה אחת לכל חומר: התמונה מכסה את כל גובה הקיר וחוזרת לאורכו לפי יחס הרוחב/גובה שלה (בלי עיוות) */
  function wallGeo(list){const P=[],N=[],U=[],I=[];
    const quad=(a,b,c,d,n,uv)=>{const k=P.length/3;for(const p of[a,b,c,d])P.push(p[0],p[1],p[2]);for(let i=0;i<4;i++)N.push(n[0],n[1],n[2]);U.push(...uv);I.push(k,k+1,k+2,k,k+2,k+3)};
    for(const w of list){const dx=w.x2-w.x1,dz=w.z2-w.z1,L=Math.hypot(dx,dz);if(L<1e-3)continue;
      const ux=dx/L,uz=dz/L,nx=-uz,nz=ux,ht=w.t/2,h=w.h,ru=(L+w.t)/(h*w.ar);
      const ax=w.x1-ux*ht,az=w.z1-uz*ht,bx=w.x2+ux*ht,bz=w.z2+uz*ht;
      const A=[ax+nx*ht,0,az+nz*ht],B=[bx+nx*ht,0,bz+nz*ht],A2=[ax-nx*ht,0,az-nz*ht],B2=[bx-nx*ht,0,bz-nz*ht],up=p=>[p[0],h,p[2]];
      quad(A,B,up(B),up(A),[nx,0,nz],[0,0,ru,0,ru,1,0,1]);
      quad(B2,A2,up(A2),up(B2),[-nx,0,-nz],[0,0,ru,0,ru,1,0,1]);
      quad(up(A),up(B),up(B2),up(A2),[0,1,0],[0,0,1,0,1,.02,0,.02]);
      quad(B,B2,up(B2),up(B),[ux,0,uz],[0,0,.02,0,.02,1,0,1]);
      quad(A2,A,up(A),up(A2),[-ux,0,-uz],[0,0,.02,0,.02,1,0,1])}
    const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(P,3));g.setAttribute('normal',new T.Float32BufferAttribute(N,3));
    g.setAttribute('uv',new T.Float32BufferAttribute(U,2));g.setIndex(I);g.computeBoundingSphere();return g}

  let model=null,root=null,wallsG=null,ceilG=null,floorG=null,pickMesh=null,pickBays=[],pickMat=[],buildMs=0,instances=0;
  const sel=new T.Group();sel.visible=false;sel.renderOrder=5;
  sel.add(new T.Mesh(BOX,M.sel));sel.add(new T.LineSegments(keep(new T.EdgesGeometry(BOX)),M.selLine));scene.add(sel);
  let selId=null;

  /* ---- בניית הסצנה מהמודל ---- */
  /* מטריצות מופעים נכתבות ישירות למערך שטוח (16 מספרים לכל תיבה) – מהיר יותר מיצירת אובייקט לכל תיבה.
     תיבה = הזזה (fx,fy,fz) * סיבוב סביב ציר הגובה (cos c, sin s) * הזזה מקומית (lx,ly,lz) * קנה מידה (sx,sy,sz) */
  function put(a,fx,fy,fz,c,s,lx,ly,lz,sx,sy,sz){a.push(c*sx,0,-s*sx,0,0,sy,0,0,s*sz,0,c*sz,0,fx+c*lx+s*lz,fy+ly,fz-s*lx+c*lz,1)}
  function boxM(a,x,y,z,ry,sx,sy,sz){put(a,x,y,z,Math.cos(ry),Math.sin(ry),0,0,0,sx,sy,sz)}
  const _c=new T.Color(),lin=new Map(),world=new T.Sphere();/* כדור אחד שמקיף את כל החנות: חוסך חישוב לכל מופע */
  function inst(geo,mat,list,colors){const n=list.length/16;if(!n)return null;/* בונים עם 0 ומחליפים את מערך המטריצות: הבנאי של three ממלא כל מופע בנפרד, וזה איטי ל-20 אלף תיבות */
    const im=new T.InstancedMesh(geo,mat,0);im.instanceMatrix=new T.InstancedBufferAttribute(new Float32Array(list),16);im.count=n;
    if(colors){im.instanceColor=new T.InstancedBufferAttribute(new Float32Array(n*3),3);const ca=im.instanceColor.array;
      for(let i=0;i<n;i++){let v=lin.get(colors[i]);if(!v){_c.setHex(colors[i]);v=[_c.r,_c.g,_c.b];lin.set(colors[i],v)}ca[3*i]=v[0];ca[3*i+1]=v[1];ca[3*i+2]=v[2]}
      im.instanceColor.needsUpdate=true}
    im.instanceMatrix.needsUpdate=true;im.boundingSphere=world.clone();instances+=n;return im}
  function label(txt,bg,fg){const tex=canvasTex(256,96,(g,w,h)=>{g.fillStyle=bg;if(g.roundRect){g.beginPath();g.roundRect(4,4,w-8,h-8,18);g.fill()}else g.fillRect(4,4,w-8,h-8);g.fillStyle=fg;g.font='bold 52px sans-serif';g.textAlign='center';g.textBaseline='middle';g.direction='rtl';g.fillText(txt,w/2,h/2+2)});
    const s=new T.Sprite(keep(new T.SpriteMaterial({map:tex,depthWrite:false})));s.scale.set(1.1,.41,1);return s}

  function build(map){
    const t0=performance.now();instances=0;
    model=G.buildModel(map);
    txById=new Map();for(const t of(Array.isArray(map&&map.tx)?map.tx:[]))if(t&&t.del!==1&&/^t[0-9]{1,4}$/.test(t.id||'')&&okPath(t.path))txById.set(t.id,{path:t.path,w:t.w|0,h:t.h|0});
    {const b=model.bounds,cx=(b[0]+b[2])/200,cz=(b[1]+b[3])/200;world.center.set(cx,2,cz);world.radius=Math.hypot((b[2]-b[0])/200,(b[3]-b[1])/200,4)+1}
    if(root){scene.remove(root);disposeTree(root)}
    root=new T.Group();wallsG=new T.Group();ceilG=new T.Group();floorG=new T.Group();root.add(wallsG,ceilG,floorG);
    const scaleUv=(g,k)=>{const u=g.attributes.uv.array;for(let i=0;i<u.length;i++)u[i]*=k};
    /* חדרים: רצפה ותקרה (טקסטורה של החדר אם צולמה) */
    const roomTex=new Map();
    for(const r of model.rooms){
      const sh=new T.Shape(),sc=new T.Shape(),n=r.p.length/2,tx=r.tex&&typeof r.tex==='object'?r.tex:{};roomTex.set(r.id,tx);
      for(let i=0;i<n;i++){const x=r.p[2*i]/100,y=r.p[2*i+1]/100;if(i){sh.lineTo(x,-y);sc.lineTo(x,y)}else{sh.moveTo(x,-y);sc.moveTo(x,y)}}
      const fg=new T.ShapeGeometry(sh);fg.rotateX(-Math.PI/2);scaleUv(fg,1/TILE);const fl=new T.Mesh(fg,texMat(tx.f,'f')||M.floor);floorG.add(fl);
      const cg=new T.ShapeGeometry(sc);cg.rotateX(Math.PI/2);scaleUv(cg,1/TILE);const ce=new T.Mesh(cg,texMat(tx.c,'c')||M.ceil);ce.position.y=r.h/100;ceilG.add(ce);
    }
    floorTex.repeat.set(TILE,TILE);ceilTex.repeat.set(TILE,TILE);
    /* קירות (קירות החדרים + קירות פנימיים), מקובצים לפי טקסטורת הקיר של החדר */
    const wg=new Map(),addW=(id,o)=>{const k=id&&txById.has(id)?id:'';if(!wg.has(k))wg.set(k,[]);wg.get(k).push(o)};
    for(const w of model.walls){const s=w.s,id=(roomTex.get(w.room)||{}).w;
      addW(id,{x1:s[0]/100,z1:s[1]/100,x2:s[2]/100,z2:s[3]/100,h:w.h/100,t:.12,ar:texAr(id)})}
    const maxH=model.rooms.reduce((m,r)=>Math.max(m,r.h),300)/100;
    for(const w of model.inner){const s=w.s,mx=(s[0]+s[2])/2,my=(s[1]+s[3])/2,r=model.rooms.find(q=>G.pointInPoly(mx,my,q.p)),id=r?(roomTex.get(r.id)||{}).w:null;
      addW(id,{x1:s[0]/100,z1:s[1]/100,x2:s[2]/100,z2:s[3]/100,h:maxH,t:w.t/100,ar:texAr(id)})}
    for(const[k,list]of wg)wallsG.add(new T.Mesh(wallGeo(list),k?texMat(k,'w'):M.wall));
    /* עמודים */
    const cb=[],cc=[];for(const c of model.cols)boxM(c.rnd?cc:cb,c.x/100,maxH/2,c.y/100,0,c.w/100,maxH,c.d/100);
    for(const [g,l] of [[BOX,cb],[CYL,cc]]){const m=inst(g,M.wall,l);if(m)wallsG.add(m)}
    /* דלתות: משקוף + שטיח צבעוני לפי סוג */
    const fr=[],frC=[],mats=[],matC=[],DC={ent:0x2e9e4f,in:0x8a6a45,emg:0xc0392b,wh:0x4f6d8a};
    for(const d of model.doors){const ang=doorAngle(d),W=d.w/100,x=d.x/100,z=d.y/100;
      for(const sg of [-1,1]){boxM(fr,x+sg*W/2*Math.cos(ang),1.05,z+sg*W/2*Math.sin(ang),-ang,.08,2.1,.16);frC.push(0x6b4a2f)}
      boxM(fr,x,2.13,z,-ang,W+.16,.08,.16);frC.push(0x6b4a2f);
      boxM(mats,x,.006,z,-ang,W*.9,.012,.9);matC.push(DC[d.k])}
    const fm=inst(BOX,M.inst,fr,frC);if(fm)wallsG.add(fm);
    const mm=inst(BOX,M.inst,mats,matC);if(mm)root.add(mm);
    /* סמלים: קופה (דלפק) ותוויות */
    const cs=[],csC=[];
    for(const y of model.syms){const x=y.x/100,z=y.y/100,ry=-(y.a||0)*Math.PI/180;
      if(y.k==='cash'){boxM(cs,x,.45,z,ry,1.4,.9,.6);csC.push(0x3b3f46);boxM(cs,x,.93,z,ry,.35,.06,.3);csC.push(0x111111);boxM(cs,x+.3,1.1,z,ry,.3,.3,.05);csC.push(0x222831)}
      const lb=y.k==='cash'?label('קופה','#d4af37','#1a1a1a'):y.k==='ent'?label('כניסה','#2e9e4f','#fff'):label('יציאה','#c0392b','#fff');
      lb.position.set(x,y.k==='cash'?1.75:2.4,z);root.add(lb)}
    const cm=inst(BOX,M.inst,cs,csC);if(cm)root.add(cm);
    /* גופים: מדפי מתכת לבנים ריקים (התמונה האמיתית מוצגת על החזית כשיש), זכוכית, ומשטחי בחירה לכל מקטע */
    const body=[],bodyC=[],shelf=[],glass=[],pick=[];pickBays=[];
    for(const f of model.fx){
      const W=f.w/100,D=f.d/100,H=f.h/100;
      const ry=-f.a*Math.PI/180,fc=Math.cos(ry),fs=Math.sin(ry),fx0=f.x/100,fz0=f.y/100;
      const L=(a,x,y,z,sx,sy,sz)=>put(a,fx0,0,fz0,fc,fs,x,y,z,sx,sy,sz);
      const B=(x,y,z,sx,sy,sz,col)=>{L(body,x,y,z,sx,sy,sz);bodyC.push(col)};
      if(f.k==='gon'||f.k==='wall'||f.k==='stand'){
        const two=f.sides===2,metal=0xdfe2e6,back=0xe9ebee;
        B(0,.05,0,W,.1,D,0xc4c8cd);
        B(0,(H+.1)/2,two?0:-D/2+.015,W,H-.1,.03,back);
        for(let i=0;i<=f.bays;i++)B(-W/2+i*W/f.bays+(i===0?.02:i===f.bays?-.02:0),H/2,0,.04,H,D,metal);
        const sides=two?[[.015,D/2],[-.015,-D/2]]:[[-D/2+.03,D/2]],gap=(H-.15)/f.lvl;
        sides.forEach(([z0,z1])=>{for(let j=0;j<f.lvl;j++){const y=.1+j*gap;
          L(shelf,0,y+.0125,(z0+z1)/2,W-.08,.025,Math.abs(z1-z0));
          B(0,y+.035,z1-Math.sign(z1-z0)*.01,W-.08,.045,.02,0xd3d7dc)/* פס חזית המדף */}});
      }else if(f.k==='fridge'){
        const wc=0xf1f3f4;B(0,H/2,-D/2+.02,W,H,.04,wc);for(const sg of[-1,1])B(sg*(W/2-.025),H/2,0,.05,H,D,wc);
        B(0,H-.04,0,W,.08,D,wc);B(0,.075,0,W,.15,D,0x9aa3ab);
        const gap=(H-.3)/f.lvl;for(let j=0;j<f.lvl;j++){const y=.15+j*gap;L(shelf,0,y+.01,0,W-.1,.02,D-.06)}
        if(f.glass)L(glass,0,(H+.07)/2,D/2-.01,W-.1,H-.23,.02);
      }else if(f.k==='table'){
        B(0,H-.02,0,W,.04,D,0x8b5e3c);for(const sx of[-1,1])for(const sz of[-1,1])B(sx*(W/2-.05),(H-.04)/2,sz*(D/2-.05),.05,H-.04,.05,0x5b3d26);
      }else{/* bin – סל תיל */
        const bc=0x6f747a;B(0,.02,0,W,.04,D,bc);for(const sg of[-1,1]){B(sg*(W/2-.015),H/2,0,.03,H,D,bc);B(0,H/2,sg*(D/2-.015),W,H,.03,bc)}
      }
      for(const b of f.bayList){L(pick,b.lx/100,H/2,b.ly/100,b.w/100,H,.06);pickBays.push({b,f,c:fc,s:fs,x0:fx0,z0:fz0,n:b.s==='b'?-1:1})}
    }
    const add=m=>{if(m)root.add(m);return m};
    add(inst(BOX,M.inst,body,bodyC));add(inst(BOX,M.shelf,shelf));
    const gm=add(inst(BOX,M.glass,glass));if(gm)gm.renderOrder=2;
    pickMat=pick;pickMesh=add(inst(BOX,M.pick,pick));
    scene.add(root);
    buildMs=performance.now()-t0;
    buildDyn();
    applyMode();
    if(selId)select(selId,true);
    invalidate();
  }
  /* כיוון הדלת: לפי צלע החדר הקרובה אליה (או השדה a) */
  function doorAngle(d){let best=null,bd=60;
    for(const r of model.rooms){const n=r.p.length/2;for(let i=0;i<n;i++){const j=(i+1)%n,x1=r.p[2*i],y1=r.p[2*i+1],x2=r.p[2*j],y2=r.p[2*j+1],L2=(x2-x1)**2+(y2-y1)**2;if(!L2)continue;
      const t=Math.max(0,Math.min(1,((d.x-x1)*(x2-x1)+(d.y-y1)*(y2-y1))/L2)),dd=Math.hypot(d.x-x1-t*(x2-x1),d.y-y1-t*(y2-y1));if(dd<bd){bd=dd;best=Math.atan2(y2-y1,x2-x1)}}}
    return best==null?(d.a||0)*Math.PI/180:best}
  function disposeTree(o){o.traverse(n=>{if(n.geometry&&n.geometry!==BOX&&n.geometry!==CYL)n.geometry.dispose();if(n.isInstancedMesh)n.dispose()})}

  /* ---- מצב המקטעים מ-s3sum: פס דק בשפת המדף + תג עם סמל מעל המקטע, ותמונות המדפים על החזיתות ---- */
  let sum=opts.sum||null,showFrames=opts.frames!==false,dynG=null,statG=null,bdgN={};
  const ph={atl:[],geo:[],want:0,ok:0,fail:0,skip:0,cell:0,byId:new Map()};
  /* תמונות שמגיעות ברצף: מציירים מחדש לכל היותר פעם ב-300ms (העלאת אטלס לכרטיס הגרפי יקרה) */
  let soonT=0;const soon=()=>{if(!soonT)soonT=setTimeout(()=>{soonT=0;invalidate()},300)};
  const sumB=()=>sum&&sum.b&&typeof sum.b==='object'?sum.b:null;
  const stOf=id=>{const B=sumB(),e=B&&B[id];return e&&STAT[e.s]?e.s:''};
  /* פינות משטח התמונה של מקטע (בעולם), לפי סדר: שמאל-תחתון, ימין-תחתון, ימין-עליון, שמאל-עליון – כפי שרואה מי שעומד מול החזית */
  function quadOf(o,off){const{b,f}=o,n=o.n,W=b.w/100*.96,lx=b.lx/100,lz=b.ly/100,H=f.h/100,xa=lx-n*W/2,xb=lx+n*W/2;let q,asp;
    if(f.k==='table'||f.k==='bin'){const zb0=f.sides===2?0:lz-n*f.d/100,zf=lz-n*.02,zb=zb0+n*.02,y=H+off;q=[[xa,y,zf],[xb,y,zf],[xb,y,zb],[xa,y,zb]];asp=W/Math.max(.05,Math.abs(zf-zb))}
    else{const y0=f.k==='fridge'?.15:.1,y1=f.k==='fridge'?H-.1:H-.03,z=lz+n*off;q=[[xa,y0,z],[xb,y0,z],[xb,y1,z],[xa,y1,z]];asp=W/(y1-y0)}
    return{p:q.map(([x,y,z])=>[o.x0+o.c*x+o.s*z,y,o.z0-o.s*x+o.c*z]),asp}}
  function clearDyn(){if(dynG){scene.remove(dynG);disposeTree(dynG)}for(const a of ph.atl){a.tex.dispose();a.mat.dispose()}ph.atl=[];ph.byId=new Map();dynG=statG=null;bl=null;hiClear();slClear()}
  function buildDyn(){
    clearDyn();if(!model)return;dynG=new T.Group();statG=new T.Group();statG.visible=showFrames;dynG.add(statG);
    const B=sumB(),fr=[],frC=[],list=[],bp={};for(const k of BDG)bp[k]=[];ph.want=ph.ok=ph.fail=ph.skip=0;
    for(const o of pickBays){const e=B&&B[o.b.id];if(!e)continue;const st=STAT[e.s]?e.s:'';
      if(st){const{b,f}=o,n=o.n,bw=b.w/100*.96,lx=b.lx/100,lz=b.ly/100,H=f.h/100,col=STAT[st].c,
          F=(x,y,z,sx,sy,sz)=>{put(fr,o.x0,0,o.z0,o.c,o.s,x,y,z,sx,sy,sz);frC.push(col)};let by,bz;
        if(f.k==='table'||f.k==='bin'){const zb=f.sides===2?0:lz-n*f.d/100,dz=Math.abs(lz-zb);
          F(lx,H+.005,lz-n*.02,bw,.01,.04);/* פס בשפה הקדמית של המשטח */by=H+.16;bz=lz-n*Math.min(dz/2,.2)}
        else{F(lx,H-.02,lz+n*.022,bw,.036,.012);/* פס תוויות בשפה העליונה של החזית */
          F(lx,H+.006,lz-n*.03,bw,.012,.06);/* ושפה דקה מלמעלה – נראית במבט מלמעלה */by=H+.17;bz=lz-n*.06}
        if(bp[st])bp[st].push(o.x0+o.c*lx+o.s*bz,by,o.z0-o.s*lx+o.c*bz)}
      if(okPath(e.th))list.push({o,th:e.th})}
    const sm=inst(BOX,M.stat,fr,frC);if(sm)statG.add(sm);
    bdgN={};for(const k of BDG){const a=bp[k];bdgN[k]=a.length/3;if(!a.length)continue;
      const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(a,3));g.computeBoundingSphere();
      const p=new T.Points(g,BM[k]);p.renderOrder=3;statG.add(p)}
    /* תמונות: אטלס (קנבס אחד לכמה תמונות) – גודל התא לפי מספר התמונות, כדי שהזיכרון יישאר קטן גם עם מאות מקטעים */
    const N=list.length;ph.want=N;
    if(N){const cell0=N<=192?128:N<=768?64:32,cell=MINI?cell0/2:cell0,per=(ATLAS/cell)**2;ph.cell=cell;
      const inset=.5/ATLAS;
      for(let a=0;a*per<N;a++){const c=document.createElement('canvas');c.width=c.height=ATLAS;
        const tex=new T.CanvasTexture(c);tex.colorSpace=T.SRGBColorSpace;tex.anisotropy=aniso;
        const mat=new T.MeshBasicMaterial({map:tex,alphaTest:.5,side:T.DoubleSide});
        const items=list.slice(a*per,(a+1)*per),P=[],U=[],I=[];
        items.forEach((it,i)=>{const cx=i%(ATLAS/cell),cy=Math.floor(i/(ATLAS/cell)),q=quadOf(it.o,.012),k=P.length/3;
          for(const p of q.p)P.push(p[0],p[1],p[2]);
          const u0=cx*cell/ATLAS+inset,u1=(cx+1)*cell/ATLAS-inset,v1=1-cy*cell/ATLAS-inset,v0=1-(cy+1)*cell/ATLAS+inset;
          U.push(u0,v0,u1,v0,u1,v1,u0,v1);I.push(k,k+1,k+2,k,k+2,k+3);
          it.cx=cx;it.cy=cy;it.asp=q.asp;it.a=a;ph.byId.set(it.o.b.id,it)});
        const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(P,3));g.setAttribute('uv',new T.Float32BufferAttribute(U,2));g.setIndex(I);g.computeBoundingSphere();
        const mesh=new T.Mesh(g,mat);dynG.add(mesh);ph.atl.push({c,g:c.getContext('2d'),tex,mat,dirty:false})}
      const gen=ph.gen=(ph.gen|0)+1;
      for(const it of list)getBlob(it.th,load,alive).then(decode).then(img=>{
        if(dead||gen!==ph.gen){closeImg(img);return}const A=ph.atl[it.a];drawCover(A.g,img,it.cx*cell,it.cy*cell,cell,cell,it.asp);closeImg(img);A.dirty=true;ph.ok++;soon()
      }).catch(e=>{if(!dead&&gen===ph.gen)ph.fail++})}
    scene.add(dynG);
  }
  /* תמונות חדות יותר (עד 512) למקטעים הקרובים במבט הליכה – "מוקטנות לפי מרחק": הרחוקות מהאטלס, הקרובות בנפרד */
  const hi={g:null,key:'',cache:new Map(),at:0,t:0};
  function hiClear(){if(hi.g){scene.remove(hi.g);hi.g.traverse(n=>{if(n.geometry)n.geometry.dispose();if(n.material)n.material.dispose()});hi.g=null}hi.key=''}
  function hiTex(it){let p=hi.cache.get(it.th);if(p){hi.cache.delete(it.th);hi.cache.set(it.th,p);return p}
    p=getBlob(it.th,load,alive).then(decode).then(img=>{if(dead){closeImg(img);throw new Error('dead')}
      const c=document.createElement('canvas'),s=pot(Math.max(img.width,img.height),512);c.width=c.height=s;drawCover(c.getContext('2d'),img,0,0,s,s,it.asp);closeImg(img);
      const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;t.anisotropy=aniso;return t});
    hi.cache.set(it.th,p);
    while(hi.cache.size>HI_N*2){const[k,v]=hi.cache.entries().next().value;hi.cache.delete(k);v.then(t=>{if(!hi.g||!hi.g.children.some(m=>m.material.map===t))t.dispose()}).catch(()=>{})}
    return p}
  function hiUpdate(){hi.at=performance.now();if(dead||!HI_N||mode!=='walk'||!ph.byId.size){if(hi.g)hiClear(),invalidate();slClear();return}
    slUpdate();
    const cand=[];for(const it of ph.byId.values()){const b=it.o.b,dx=walk.x-b.x/100,dz=walk.z-b.y/100,d=Math.hypot(dx,dz);
      if(d<4.5&&dx*b.nx+dz*b.ny>0)cand.push([d,it])}
    cand.sort((a,b)=>a[0]-b[0]);const pickd=cand.slice(0,HI_N).map(c=>c[1]),key=pickd.map(i=>i.o.b.id).join(',');
    if(key===hi.key)return;hiClear();hi.key=key;hi.g=new T.Group();scene.add(hi.g);const g0=hi.g;
    for(const it of pickd)hiTex(it).then(t=>{if(dead||hi.g!==g0)return;const q=quadOf(it.o,.016),P=[];for(const p of q.p)P.push(p[0],p[1],p[2]);
      const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(P,3));geo.setAttribute('uv',new T.Float32BufferAttribute([0,0,1,0,1,1,0,1],2));geo.setIndex([0,1,2,0,2,3]);
      g0.add(new T.Mesh(geo,new T.MeshBasicMaterial({map:t,side:T.DoubleSide})));invalidate()}).catch(()=>{})}

  /* ---- שלב 19א: תמונה לכל מקום צילום (opts.loadPh(run,slot) -> Promise<{th,p,person,gone}|null>). בלי loadPh – לא קורה כלום.
     עד 6 מ': th של כל מקום צילום (בגוף גבוה חצי עליון וחצי תחתון). עד 1.8 מ' אחרי 0.5 שנ' במקום: p מוקטנת ל-1024, לכל היותר 4 בזיכרון, ומשוחררות כשמתרחקים.
     מסמך חסר / אדם בתמונה / שגיאה: לא מציירים כלום והתמונה הקיימת נשארת. מצב מיני ומבט עליון: אין קריאות. ---- */
  const sl={g:null,sig:'',cache:new Map(),docs:new Map(),want:new Set(),calls:0,fkey:'',fok:false,t:0};
  const slRun=id=>{const B=sumB(),e=B&&B[id],r=e&&e.r;return typeof r==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(r)?r:''};
  function slDoc(run,slot){const k=run+'|'+slot;let p=sl.docs.get(k);if(p)return p;sl.calls++;
    p=Promise.resolve().then(()=>PH(run,slot)).then(o=>o&&typeof o==='object'&&!o.person&&!o.gone?o:null,()=>null);sl.docs.set(k,p);return p}
  function slClear(){clearTimeout(sl.t);sl.t=0;sl.fkey='';sl.fok=false;sl.sig='';sl.want=new Set();
    if(sl.g){scene.remove(sl.g);sl.g.traverse(n=>{if(n.geometry)n.geometry.dispose();if(n.material)n.material.dispose()});sl.g=null}
    for(const[k,e]of sl.cache){if(e.t)e.t.dispose();e.dead=1;sl.cache.delete(k)}}
  function slTex(sp){const k=sp.k;let e=sl.cache.get(k);if(e)return e.p;e={p:null,t:null,full:sp.full,dead:0};
    e.p=slDoc(sp.run,sp.slot).then(o=>{const path=o&&o[sp.full?'p':'th'];if(!okPath(path))return null;return getBlob(path,load,alive)}).then(b=>{return b?decode(b):null}).then(img=>{
      if(!img)return null;if(dead||e.dead||!sl.want.has(k)){closeImg(img);if(sl.cache.get(k)===e)sl.cache.delete(k);return null}
      const c=document.createElement('canvas'),s=pot(Math.max(img.width,img.height),sp.full?1024:512);c.width=c.height=s;drawCover(c.getContext('2d'),img,0,0,s,s,sp.asp);closeImg(img);
      const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;t.anisotropy=aniso;e.t=t;return t}).catch(()=>null);
    sl.cache.set(k,e);return e.p}
  /* חצי עליון/תחתון של משטח התמונה: פינות q = [שמאל-תחתון, ימין-תחתון, ימין-עליון, שמאל-עליון] */
  function halfQ(q,l){if(l==='a')return q;const m=(a,b)=>[(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2];const ml=m(q[0],q[3]),mr=m(q[1],q[2]);
    return l==='t'?[ml,mr,q[2],q[3]]:[q[0],q[1],mr,ml]}
  function slUpdate(){if(!PH)return;
    const near=[],close=[];
    for(const it of ph.byId.values()){const b=it.o.b;if(!slRun(b.id)||!Array.isArray(b.lv))continue;const dx=walk.x-b.x/100,dz=walk.z-b.y/100,d=Math.hypot(dx,dz);
      if(dx*b.nx+dz*b.ny<=0)continue;if(d<6)near.push([d,it]);if(d<1.8)close.push([d,it])}
    near.sort((a,b)=>a[0]-b[0]);close.sort((a,b)=>a[0]-b[0]);
    const mk=(it,l,full)=>{const id=it.o.b.id,run=slRun(id),slot=id+'_'+l,two=it.o.b.lv.length>1;
      return{k:run+'|'+slot+'|'+(full?'p':'th'),run,slot,l,full,it,asp:it.asp*(two?2:1),off:full?.024:.02}};
    const specs=[];
    for(const[,it]of near){if(specs.length>=HI_N*2)break;if(it.o.b.lv.length>1)for(const l of it.o.b.lv)specs.push(mk(it,l,false))}
    /* תמונה מלאה: רק אחרי עמידה של חצי שנייה מול אותם מקטעים. לכל היותר 4 מקומות צילום (טקסטורות) בו זמנית */
    const fk=close.slice(0,2).map(c=>c[1].o.b.id).join(',');
    if(fk!==sl.fkey){sl.fkey=fk;sl.fok=false;clearTimeout(sl.t);sl.t=0;if(fk)sl.t=setTimeout(()=>{sl.t=0;if(!dead&&mode==='walk'){sl.fok=true;slUpdate()}},500)}
    if(sl.fok){const full=[];for(const[,it]of close.slice(0,2))for(const l of it.o.b.lv)if(full.length<4)full.push(mk(it,l,true));specs.push(...full)}
    const sig=specs.map(s=>s.k).join(',');if(sig===sl.sig)return;sl.sig=sig;sl.want=new Set(specs.map(s=>s.k));
    if(sl.g){scene.remove(sl.g);sl.g.traverse(n=>{if(n.geometry)n.geometry.dispose();if(n.material)n.material.dispose()})}
    sl.g=new T.Group();scene.add(sl.g);const g0=sl.g;
    /* שחרור: תמונות מלאות שכבר לא רצויות מיד; מוקטנות – נשארות עד 12 במטמון */
    let keep=0;for(const[k,e]of[...sl.cache].reverse()){if(sl.want.has(k))continue;if(e.full||++keep>12){if(e.t)e.t.dispose();e.dead=1;sl.cache.delete(k)}}
    for(const sp of specs)slTex(sp).then(t=>{if(!t||dead||sl.g!==g0)return;const q=halfQ(quadOf(sp.it.o,sp.off).p,sp.l),P=[];for(const p of q)P.push(p[0],p[1],p[2]);
      const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(P,3));geo.setAttribute('uv',new T.Float32BufferAttribute([0,0,1,0,1,1,0,1],2));geo.setIndex([0,1,2,0,2,3]);
      g0.add(new T.Mesh(geo,new T.MeshBasicMaterial({map:t,side:T.DoubleSide})));invalidate()})}

  /* ---- מקרא וכפתור הסתרת סימוני המצב (לא במצב מיני). עיצוב מטוקני האפליקציה (ds): --glass, --line, --ink, --r-m, --elev-2, וכפתור "btn s g" ---- */
  let legend=null;const frTxt=()=>showFrames?'הסתר סימונים':'הצג סימונים';
  function drawLegend(){if(MINI||opts.legend===false)return;const B=sumB();
    if(!B||!Object.keys(B).length){if(legend){legend.remove();legend=null}return}
    if(!legend){legend=document.createElement('div');legend.className='s3d-legend';legend.dir='rtl';
      legend.style.cssText='position:absolute;bottom:8px;left:8px;right:8px;z-index:2;display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;background:var(--glass);-webkit-backdrop-filter:blur(var(--blur));backdrop-filter:blur(var(--blur));border:1px solid var(--line);border-radius:var(--r-m);box-shadow:var(--elev-2);padding:6px 10px;color:var(--ink);font-family:var(--font-ui);font-size:.8rem;font-weight:600;line-height:1.3;pointer-events:none';
      el.appendChild(legend);overlay.push(legend)}
    legend.innerHTML='';
    for(const k of['ok','iss','miss','rev','out']){const s=document.createElement('span');s.className='s3d-lg';s.dataset.s=k;s.style.cssText='display:inline-flex;align-items:center;gap:5px;white-space:nowrap';
      const d=badge(k,36);d.setAttribute('aria-hidden','true');d.style.cssText='width:18px;height:18px;flex:none';s.append(d,STAT[k].t);legend.appendChild(s)}
    const btn=document.createElement('button');btn.type='button';btn.className='btn s g s3d-frames';btn.textContent=frTxt();btn.setAttribute('aria-pressed',String(!showFrames));
    btn.style.cssText='flex:none;margin-inline-start:auto;pointer-events:auto';
    btn.onclick=e=>{e.stopPropagation();setFrames(!showFrames)};legend.appendChild(btn)}
  function setFrames(v){showFrames=!!v;if(statG)statG.visible=showFrames;const b=legend&&legend.querySelector('.s3d-frames');if(b){b.textContent=frTxt();b.setAttribute('aria-pressed',String(!showFrames))}invalidate()}

  /* ---- מצלמה ומצבים ---- */
  let mode=MINI?'top':opts.mode==='walk'?'walk':'top';
  const top={tx:0,tz:0,yaw:0,pitch:MINI?.62:.95,dist:20,max:60},walk={x:0,z:0,yaw:0,pitch:-.05};
  function resetCams(){
    const b=model.bounds,e=model.ent,W=(b[2]-b[0])/100,H=(b[3]-b[1])/100;
    top.tx=(b[0]+b[2])/200;top.tz=(b[1]+b[3])/200;top.yaw=Math.atan2(e.ly,e.lx);
    const fit=Math.max(W,H)*.5/Math.tan(cam.fov*Math.PI/360)/Math.min(1,cam.aspect||1);
    top.dist=Math.min(140,Math.max(4,fit*(MINI?.8:.85)));top.max=Math.max(top.dist*2,10);
    let x=e.x+e.lx*120,y=e.y+e.ly*120;
    if(!G.inAnyRoom(model,x,y)&&model.rooms[0]){const c=G.centroid(model.rooms[0].p);x=c[0];y=c[1]}
    [x,y]=G.resolveCircle(x,y,25,model.segs);walk.x=x/100;walk.z=y/100;walk.yaw=Math.atan2(e.ly,e.lx);walk.pitch=-.05;
  }
  function applyMode(){bdgSize();wallsG.scale.y=mode==='top'?(MINI?.55:.35):1;ceilG.visible=mode==='walk';if(mode!=='walk')hiClear(),slClear();else hiUpdate();placeCam()}
  function placeCam(){
    if(mode==='top'){const c=Math.cos(top.pitch),fx=Math.cos(top.yaw),fz=Math.sin(top.yaw);
      cam.position.set(top.tx-fx*c*top.dist,Math.sin(top.pitch)*top.dist,top.tz-fz*c*top.dist);cam.lookAt(top.tx,0,top.tz)}
    else{const c=Math.cos(walk.pitch);cam.position.set(walk.x,1.6,walk.z);cam.lookAt(walk.x+Math.cos(walk.yaw)*c,1.6+Math.sin(walk.pitch),walk.z+Math.sin(walk.yaw)*c)}
  }
  function walkBy(fwd,side){const fx=Math.cos(walk.yaw),fz=Math.sin(walk.yaw),tx=walk.x+fx*fwd-fz*side,tz=walk.z+fz*fwd+fx*side;
    const r=G.moveWithCollision(walk.x*100,walk.z*100,tx*100,tz*100,25,model.segs);walk.x=r[0]/100;walk.z=r[1]/100}

  /* ---- תנועה מונפשת (הקשה על נקודה ברצפה), הבהוב, סיבוב המיני ---- */
  let tw=null,bl=null,last=0;
  const ease=p=>p<.5?2*p*p:1-(-2*p+2)**2/2,angLerp=(a,b,p)=>{let d=((b-a+Math.PI)%(2*Math.PI)+2*Math.PI)%(2*Math.PI)-Math.PI;return a+d*p};
  function goTo(x,z){const now=performance.now();
    if(mode==='walk'){const d=Math.hypot(x-walk.x,z-walk.z);if(d<.15)return;tw={k:'walk',t0:now,dur:Math.min(1600,350+d*260),sx:walk.x,sz:walk.z,tx:x,tz:z,sy:walk.yaw,ty:Math.atan2(z-walk.z,x-walk.x)}}
    else tw={k:'top',t0:now,dur:500,sx:top.tx,sz:top.tz,tx:x,tz:z};invalidate()}
  function step(now){let more=false;
    if(tw){const p=Math.min(1,(now-tw.t0)/tw.dur),e=ease(p);
      if(tw.k==='walk'){walk.yaw=angLerp(tw.sy,tw.ty,Math.min(1,p*2.5));const tx=tw.sx+(tw.tx-tw.sx)*e,tz=tw.sz+(tw.tz-tw.sz)*e;
        const r=G.moveWithCollision(walk.x*100,walk.z*100,tx*100,tz*100,25,model.segs);walk.x=r[0]/100;walk.z=r[1]/100}
      else{top.tx=tw.sx+(tw.tx-tw.sx)*e;top.tz=tw.sz+(tw.tz-tw.sz)*e}
      if(p>=1){tw=null;if(mode==='walk')hiUpdate()}else more=true}
    if(bl){if(now>bl.end){if(bl.mesh){dynG&&dynG.remove(bl.mesh);bl.mesh.dispose()}bl=null}else{M.blink.opacity=.12+.5*(.5+.5*Math.sin((now-bl.t0)/1000*Math.PI*3));more=true}}
    if(MINI&&!paused){top.yaw+=Math.min(.1,(now-(last||now))/1000)*.16;more=true}
    return more}

  /* ---- ציור לפי דרישה (חוסך סוללה): מציירים רק כשמשהו השתנה; במיני – עד 24 פריימים בשנייה ---- */
  let raf=0,paused=false,lost=false,frames=0;
  function frame(now){raf=0;if(paused||lost||dead)return;
    if(MINI&&last&&now-last<40){raf=requestAnimationFrame(frame);return}
    const more=step(now);last=now;
    for(const a of ph.atl)if(a.dirty){a.dirty=false;a.tex.needsUpdate=true}
    placeCam();renderer.render(scene,cam);frames++;
    if(mode==='walk'&&HI_N){clearTimeout(hi.t);hi.t=setTimeout(hiUpdate,250);if(now-hi.at>700)hiUpdate()}
    if(more)invalidate()}
  function invalidate(){if(!raf&&!paused&&!lost&&!dead)raf=requestAnimationFrame(frame)}
  function resize(){const w=el.clientWidth||1,h=el.clientHeight||1;renderer.setSize(w,h,false);cam.aspect=w/h;cam.updateProjectionMatrix();invalidate()}

  /* ---- מגע: גרירה, צביטה, הקשה ---- */
  const ptr=new Map();let tap=null,pinch=null;
  const ray=new T.Raycaster(),ndc=new T.Vector2();
  function onDown(e){tw=null;cv.setPointerCapture&&cv.setPointerCapture(e.pointerId);ptr.set(e.pointerId,{x:e.clientX,y:e.clientY});
    tap=ptr.size===1?{x:e.clientX,y:e.clientY,t:performance.now(),moved:0}:null;pinch=ptr.size===2?pinchState():null}
  function pinchState(){const[a,b]=[...ptr.values()];return{d:Math.hypot(a.x-b.x,a.y-b.y)||1,mx:(a.x+b.x)/2,my:(a.y+b.y)/2}}
  function onMove(e){const p=ptr.get(e.pointerId);if(!p)return;const dx=e.clientX-p.x,dy=e.clientY-p.y;p.x=e.clientX;p.y=e.clientY;
    if(tap)tap.moved+=Math.abs(dx)+Math.abs(dy);
    if(ptr.size===1){
      if(mode==='top'){top.yaw-=dx*.006;top.pitch=Math.min(1.48,Math.max(.3,top.pitch+dy*.004))}
      else{walk.yaw-=dx*.005;walkBy(dy*.012,0)}
    }else if(ptr.size===2&&pinch){const n=pinchState(),k=n.d/pinch.d;
      if(mode==='top'){top.dist=Math.min(top.max,Math.max(2,top.dist/k));
        const s=top.dist/Math.max(200,el.clientHeight),mx=n.mx-pinch.mx,my=n.my-pinch.my,fx=Math.cos(top.yaw),fz=Math.sin(top.yaw);
        top.tx+=(fz*mx+fx*my)*s;top.tz+=(-fx*mx+fz*my)*s}
      else walkBy((n.d-pinch.d)*.02,0);
      pinch=n}
    invalidate()}
  function onUp(e){const was=ptr.has(e.pointerId);ptr.delete(e.pointerId);
    if(was&&tap&&ptr.size===0&&tap.moved<10&&performance.now()-tap.t<400)doPick(e.clientX,e.clientY);
    tap=null;pinch=ptr.size===2?pinchState():null}
  function onWheel(e){e.preventDefault();if(mode==='top')top.dist=Math.min(top.max,Math.max(2,top.dist*(e.deltaY>0?1.1:.9)));else walkBy(e.deltaY<0?.4:-.4,0);invalidate()}
  /* הקשה: על מקטע – בחירה; על הרצפה – תנועה לנקודה (בהליכה: הולכים אליה; מלמעלה: מרכז המבט עובר אליה) */
  function doPick(cx,cy){if(!pickMesh)return;const r=cv.getBoundingClientRect();ndc.set((cx-r.left)/r.width*2-1,-(cy-r.top)/r.height*2+1);
    placeCam();cam.updateMatrixWorld();ray.setFromCamera(ndc,cam);
    const hit=ray.intersectObject(pickMesh,false)[0],fl=ray.intersectObjects(floorG.children,false)[0];
    if(!hit||hit.instanceId==null||(fl&&fl.distance<hit.distance-.05)){if(fl)goTo(fl.point.x,fl.point.z);select(null);fire(null);return}
    const{b,f}=pickBays[hit.instanceId],lvHit=b.lv.length>1?(hit.point.y>f.h/200?'t':'b'):'a';
    select(b.id);fire({id:b.id,fx:b.fx,s:b.s,n:b.n,lv:b.lv.slice(),lvHit,num:f.num,name:f.name,k:f.k,st:stOf(b.id)})}
  function fire(x){if(opts.onPick)try{opts.onPick(x)}catch(e){console.error(e)}}
  function select(id,quiet){selId=id||null;const i=id?pickBays.findIndex(o=>o.b.id===id):-1;
    if(i<0){sel.visible=false}else{sel.matrixAutoUpdate=false;sel.matrix.fromArray(pickMat,i*16).multiply(new T.Matrix4().makeScale(1.04,1.02,2.2));sel.matrixWorldNeedsUpdate=true;sel.visible=true}
    if(!quiet)invalidate();return i>=0}
  function focus(fxId){const f=model.fx.find(o=>o.id===fxId);if(!f)return false;
    if(mode==='top'){top.tx=f.x/100;top.tz=f.y/100;top.dist=Math.min(top.dist,8)}
    else{const b=f.bayList[0];let x=b.x+b.nx*120,y=b.y+b.ny*120;[x,y]=G.resolveCircle(x,y,25,model.segs);walk.x=x/100;walk.z=y/100;walk.yaw=Math.atan2(-b.ny,-b.nx)}
    invalidate();return true}
  /* הבהוב: מזהי גופים (f..) או מקטעים (f..-a-1). null = עצירה */
  function blink(ids,ms){if(bl){if(bl.mesh){dynG&&dynG.remove(bl.mesh);bl.mesh.dispose()}bl=null}
    const L=(Array.isArray(ids)?ids:ids?[ids]:[]).map(String);if(!L.length||!model||!dynG){invalidate();return 0}
    const a=[];for(const id of L){const f=model.fx.find(o=>o.id===id);
      if(f){const ry=-f.a*Math.PI/180;put(a,f.x/100,0,f.y/100,Math.cos(ry),Math.sin(ry),0,f.h/200,0,f.w/100+.08,f.h/100+.08,f.d/100+.08);continue}
      const i=pickBays.findIndex(o=>o.b.id===id);if(i>=0){const m=new T.Matrix4().fromArray(pickMat,i*16).multiply(new T.Matrix4().makeScale(1.06,1.04,3));a.push(...m.elements)}}
    if(!a.length){invalidate();return 0}
    const mesh=inst(BOX,M.blink,a);mesh.renderOrder=6;dynG.add(mesh);const now=performance.now();bl={mesh,t0:now,end:now+(ms>0?ms:6000)};invalidate();return a.length/16}
  function search(q){q=String(q==null?'':q).trim();if(!q||!model)return[];
    const out=model.fx.filter(f=>String(f.num)===q||f.id===q||(f.name&&f.name.indexOf(q)>=0)||f.bayList.some(b=>b.id===q));
    const bayHit=pickBays.find(o=>o.b.id===q);blink(bayHit?[q]:out.map(f=>f.id));if(out[0])focus(out[0].id);
    return out.map(f=>({fx:f.id,num:f.num,name:f.name}))}

  /* ---- אובדן הקשר WebGL, הסתרת המסך ---- */
  let lostBox=null;
  function onLost(e){e.preventDefault();lost=true;if(!lostBox)lostBox=msgBox(el,'התצוגה נעצרה זמנית. מנסה לשחזר…');if(opts.onError)try{opts.onError('lost','התצוגה נעצרה זמנית')}catch(_){}}
  function onRestored(){lost=false;if(lostBox){lostBox.remove();lostBox=null}build(curMap)}
  function onVis(){if(document.hidden){if(raf){cancelAnimationFrame(raf);raf=0}}else{last=0;invalidate()}}
  if(!MINI){cv.addEventListener('pointerdown',onDown);cv.addEventListener('pointermove',onMove);
    cv.addEventListener('pointerup',onUp);cv.addEventListener('pointercancel',onUp);
    cv.addEventListener('wheel',onWheel,{passive:false})}
  cv.addEventListener('webglcontextlost',onLost,false);cv.addEventListener('webglcontextrestored',onRestored,false);
  document.addEventListener('visibilitychange',onVis);
  const ro=window.ResizeObserver?new ResizeObserver(resize):null;if(ro)ro.observe(el);else window.addEventListener('resize',resize);

  let curMap=null;
  const setMap=m=>{curMap=m;build(m);resetCams();applyMode();invalidate()};
  resize();setMap(map0);drawLegend();

  return{
    setMode(m){if(MINI)return;mode=m==='walk'?'walk':'top';tw=null;applyMode();invalidate()},
    getMode:()=>mode,
    setMap,
    setSum(s){sum=s||null;buildDyn();drawLegend();if(selId)select(selId,true);invalidate()},
    frames(v){if(v===undefined)return showFrames;setFrames(v);return showFrames},
    select:id=>select(id),focus,search,blink,
    walkTo(x,y){if(!model||!isFinite(x)||!isFinite(y))return false;goTo(x/100,y/100);return true},
    resize,
    pause(){paused=true;if(raf){cancelAnimationFrame(raf);raf=0}},
    resume(){paused=false;last=0;invalidate()},
    renderNow(){placeCam();for(const a of ph.atl)if(a.dirty){a.dirty=false;a.tex.needsUpdate=true}const t=performance.now();renderer.render(scene,cam);const g=renderer.getContext();g.readPixels(0,0,1,1,g.RGBA,g.UNSIGNED_BYTE,new Uint8Array(4));return performance.now()-t},
    stats:()=>{const st={};for(const k in STAT)st[k]=0;const B=sumB();if(B)for(const o of pickBays){const s=stOf(o.b.id);if(s)st[s]++}
      return{three:THREE_VER,mini:MINI,buildMs:+buildMs.toFixed(1),fx:model.fx.length,bays:model.bays.length,instances,calls:renderer.info.render.calls,tris:renderer.info.render.triangles,
        skip:model.skip.slice(),cam:cam.position.toArray().map(v=>+v.toFixed(2)),walk:[+walk.x.toFixed(2),+walk.z.toFixed(2)],mode,frames,paused,
        tex:Object.assign({},texSt),photos:{want:ph.want,ok:ph.ok,fail:ph.fail,cell:ph.cell,atlases:ph.atl.length,hi:hi.g?hi.g.children.length:0},slots:{on:!!PH,calls:sl.calls,th:sl.g?sl.g.children.length-[...sl.cache.values()].filter(e=>e.full&&e.t).length:0,full:[...sl.cache.values()].filter(e=>e.full&&e.t).length},stat:st,badges:Object.assign({},bdgN),badgePx:BM.ok.size,framesOn:showFrames,blink:!!bl,px:renderer.getPixelRatio()}},
    destroy(){if(dead)return;dead=true;if(raf)cancelAnimationFrame(raf);clearTimeout(hi.t);clearTimeout(soonT);clearTimeout(sl.t);
      cv.removeEventListener('pointerdown',onDown);cv.removeEventListener('pointermove',onMove);cv.removeEventListener('pointerup',onUp);cv.removeEventListener('pointercancel',onUp);
      cv.removeEventListener('wheel',onWheel);cv.removeEventListener('webglcontextlost',onLost);cv.removeEventListener('webglcontextrestored',onRestored);
      document.removeEventListener('visibilitychange',onVis);if(ro)ro.disconnect();else window.removeEventListener('resize',resize);
      clearDyn();for(const p of hi.cache.values())p.then(t=>t.dispose()).catch(()=>{});hi.cache.clear();
      if(root)disposeTree(root);for(const o of disp)o.dispose&&o.dispose();
      renderer.dispose();try{renderer.forceContextLoss()}catch(e){}cv.remove();overlay.forEach(o=>o.remove());if(lostBox)lostBox.remove();
      model=root=pickMesh=null;pickBays=[];pickMat=[]},
  };
}

/* ---- מצב מיני לחלון הבית: אותה סצנה, נטענת רק כשהחלון נראה, נעצרת מחוץ למסך ומשוחררת אחרי keepMs (ברירת מחדל 15 שניות) או כשהאלמנט הוסר ---- */
function mini(el,map,sum,o){
  o=Object.assign({},o||{});let h=null,opening=false,failed=false,vis=false,offT=0,dead=false,cur={map,sum:sum||null};
  const want=()=>!dead&&vis&&!document.hidden;
  async function ensure(){if(h||opening||failed||!want())return;opening=true;
    try{const x=await open(el,cur.map,Object.assign({},o,{mini:true,sum:cur.sum,mode:'top',legend:false}));
      if(!x){failed=true;return}if(dead||!el.isConnected){x.destroy();return}h=x;if(!want())onVis2()}
    finally{opening=false}}
  function onVis2(){if(dead)return;
    if(want()){if(offT){clearTimeout(offT);offT=0}if(h)h.resume();else ensure()}
    else if(h){h.pause();if(!offT)offT=setTimeout(()=>{offT=0;if(h&&!want()){h.destroy();h=null}},o.keepMs>0?o.keepMs:15000)}}
  const io=window.IntersectionObserver?new IntersectionObserver(es=>{for(const e of es)vis=e.isIntersecting;onVis2()},{threshold:[0,.15]}):null;
  if(io)io.observe(el);else{vis=true;onVis2()}
  document.addEventListener('visibilitychange',onVis2);
  const gc=setInterval(()=>{if(!el.isConnected)api.destroy()},2000);
  const api={
    update(m,s){if(m)cur.map=m;if(s!==undefined)cur.sum=s||null;if(h){if(m)h.setMap(cur.map);if(s!==undefined)h.setSum(cur.sum)}},
    destroy(){if(dead)return;dead=true;if(io)io.disconnect();clearInterval(gc);clearTimeout(offT);document.removeEventListener('visibilitychange',onVis2);if(h){h.destroy();h=null}},
    stats:()=>({visible:vis,open:!!h,failed,dead,view:h?h.stats():null}),
    get handle(){return h}};
  return api}

/* שלב 18ה: אותה טעינה (מטמון משותף, בדיקת נתיב okPath, עד 4 הורדות) גם לסיור 360 */
const blob=p=>getBlob(p,defLoad,()=>true);
window.Store3D={version:THREE_VER,supported,preload,open,mini,STAT,badge,clearCache,blob};
window.S3View=window.Store3D;
})();
