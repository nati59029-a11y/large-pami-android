/* store3d-view.js – תצוגת החנות בתלת מימד (שלב 2: מנוע בסיסי).
   תלוי ב-store3d-geo.js (window.S3G). ספריית three.js נטענת מקומית ורק בקריאה ל-Store3D.open / Store3D.preload (אין CDN).
   API ציבורי (window.Store3D):
     supported()                         -> האם יש WebGL במכשיר
     preload()                           -> Promise: טעינת הספרייה מראש (לא חובה)
     open(el, map, opts)                 -> Promise<handle|null>
        opts: {mode:'top'|'walk', sample:bool (מציג תווית "דוגמה"), onPick(bay|null), onError(code, msg), base: נתיב לתיקיית www}
     handle: setMode(m), getMode(), setMap(map), select(bayId|null), focus(fxId), resize(), pause(), resume(), destroy(), stats()
   bay שמוחזר ב-onPick: {id, fx, s, n, lv:[...], lvHit, num, name, k}
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

/* צבע יציב לפי מחרוזת (לאריזות מוצרים) */
function hash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}
function mix(a,b){let h=Math.imul(a^Math.imul(b+1,0x9e3779b1),0x85ebca6b);h^=h>>>13;h=Math.imul(h,0xc2b2ae35);return(h^h>>>16)>>>0}
const PALETTE=[0xd23c3c,0xe8862a,0xf2c230,0x3c9a4a,0x2f7fc1,0x7a4fb5,0xe25a8f,0xf5f0e1,0x2b2b2b,0x6bb7d6,0x9bc53d,0xc0392b,0x1f5f8b,0xffd27f,0x8e6e53];

function makeView(T,el,map0,opts){
  const G=window.S3G,dpr=Math.min(window.devicePixelRatio||1,2);
  const renderer=new T.WebGLRenderer({antialias:dpr<2,powerPreference:'default'});
  renderer.setPixelRatio(dpr);
  const cv=renderer.domElement;cv.style.cssText='display:block;width:100%;height:100%;touch-action:none;outline:none';
  el.appendChild(cv);
  const scene=new T.Scene();scene.background=new T.Color(0x23262c);
  scene.add(new T.HemisphereLight(0xffffff,0x8d8475,2.2));
  const sun=new T.DirectionalLight(0xffffff,1.4);sun.position.set(0.4,1,0.25);scene.add(sun);
  const cam=new T.PerspectiveCamera(55,1,0.05,400);
  const overlay=[];
  if(opts.sample){const b=document.createElement('div');b.dir='rtl';b.textContent='דוגמה – לא נתוני העסק';
    b.style.cssText='position:absolute;top:8px;right:8px;z-index:2;background:rgba(20,20,24,.85);color:#d4af37;border:1px solid #d4af37;border-radius:8px;padding:4px 10px;font:bold 13px sans-serif;pointer-events:none';
    el.appendChild(b);overlay.push(b)}

  /* ---- חומרים משותפים ---- */
  const disp=[];const keep=o=>{disp.push(o);return o};
  function canvasTex(w,h,draw,rep){const c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d'),w,h);
    const t=keep(new T.CanvasTexture(c));t.colorSpace=T.SRGBColorSpace;if(rep){t.wrapS=t.wrapT=T.RepeatWrapping;t.repeat.set(rep,rep)}t.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());return t}
  const floorTex=canvasTex(128,128,(g,w,h)=>{g.fillStyle='#d9d4c8';g.fillRect(0,0,w,h);g.fillStyle='#cfc9bb';g.fillRect(0,0,w/2,h/2);g.fillRect(w/2,h/2,w/2,h/2);
    g.strokeStyle='#a9a294';g.lineWidth=2;g.strokeRect(0,0,w,h);g.beginPath();g.moveTo(w/2,0);g.lineTo(w/2,h);g.moveTo(0,h/2);g.lineTo(w,h/2);g.stroke()},1);
  const ceilTex=canvasTex(64,64,(g,w,h)=>{g.fillStyle='#f4f4f1';g.fillRect(0,0,w,h);g.strokeStyle='#c8c8c2';g.lineWidth=3;g.strokeRect(0,0,w,h)},1);
  const M={
    floor:keep(new T.MeshLambertMaterial({map:floorTex})),
    ceil:keep(new T.MeshLambertMaterial({map:ceilTex})),
    wall:keep(new T.MeshLambertMaterial({color:0xefe9df})),
    inst:keep(new T.MeshLambertMaterial({color:0xffffff})),/* צבע לכל מופע */
    shelf:keep(new T.MeshLambertMaterial({color:0xdcdcdc})),
    glass:keep(new T.MeshLambertMaterial({color:0xbfe6ff,transparent:true,opacity:.22,depthWrite:false})),
    pick:keep(new T.MeshBasicMaterial({visible:false})),
    sel:keep(new T.MeshBasicMaterial({color:0xd4af37,transparent:true,opacity:.28,depthWrite:false})),
    selLine:keep(new T.LineBasicMaterial({color:0xffd24a})),
  };
  const BOX=keep(new T.BoxGeometry(1,1,1)),CYL=keep(new T.CylinderGeometry(.5,.5,1,16));

  let model=null,root=null,wallsG=null,ceilG=null,pickMesh=null,pickBays=[],pickMat=[],buildMs=0,instances=0;
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
    {const b=model.bounds,cx=(b[0]+b[2])/200,cz=(b[1]+b[3])/200;world.center.set(cx,2,cz);world.radius=Math.hypot((b[2]-b[0])/200,(b[3]-b[1])/200,4)+1}
    if(root){scene.remove(root);disposeTree(root)}
    root=new T.Group();wallsG=new T.Group();ceilG=new T.Group();root.add(wallsG,ceilG);
    /* חדרים: רצפה ותקרה */
    for(const r of model.rooms){
      const sh=new T.Shape(),sc=new T.Shape(),n=r.p.length/2;
      for(let i=0;i<n;i++){const x=r.p[2*i]/100,y=r.p[2*i+1]/100;if(i){sh.lineTo(x,-y);sc.lineTo(x,y)}else{sh.moveTo(x,-y);sc.moveTo(x,y)}}
      const fg=new T.ShapeGeometry(sh);fg.rotateX(-Math.PI/2);const fl=new T.Mesh(fg,M.floor);root.add(fl);
      const cg=new T.ShapeGeometry(sc);cg.rotateX(Math.PI/2);const ce=new T.Mesh(cg,M.ceil);ce.position.y=r.h/100;ceilG.add(ce);
    }
    /* קירות (קירות החדרים + קירות פנימיים) */
    const wl=[];
    for(const w of model.walls){const s=w.s,L=Math.hypot(s[2]-s[0],s[3]-s[1])/100,h=w.h/100;
      boxM(wl,(s[0]+s[2])/200,h/2,(s[1]+s[3])/200,-Math.atan2(s[3]-s[1],s[2]-s[0]),L+.12,h,.12)}
    const maxH=model.rooms.reduce((m,r)=>Math.max(m,r.h),300)/100;
    for(const w of model.inner){const s=w.s,L=Math.hypot(s[2]-s[0],s[3]-s[1])/100;
      boxM(wl,(s[0]+s[2])/200,maxH/2,(s[1]+s[3])/200,-Math.atan2(s[3]-s[1],s[2]-s[0]),L,maxH,w.t/100)}
    const wm=inst(BOX,M.wall,wl);if(wm)wallsG.add(wm);
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
    /* גופים: גוף/מסגרת, מדפים, מוצרים, זכוכית, ומשטחי בחירה לכל מקטע */
    const body=[],bodyC=[],shelf=[],prod=[],prodC=[],glass=[],pick=[];pickBays=[];
    for(const f of model.fx){
      const W=f.w/100,D=f.d/100,H=f.h/100;
      const ry=-f.a*Math.PI/180,fc=Math.cos(ry),fs=Math.sin(ry),fx0=f.x/100,fz0=f.y/100;
      const L=(a,x,y,z,sx,sy,sz)=>put(a,fx0,0,fz0,fc,fs,x,y,z,sx,sy,sz);
      const B=(x,y,z,sx,sy,sz,col)=>{L(body,x,y,z,sx,sy,sz);bodyC.push(col)};
      const P=(x,y,z,sx,sy,sz,key)=>{L(prod,x,y,z,sx,sy,sz);prodC.push(PALETTE[key%PALETTE.length])};
      const fh=hash(f.id);
      const nb=f.bays,bw=W/nb;
      /* מוצרים על מדף: שורה של אריזות בכל מקטע, בחזית המדף */
      /* z1 = קצה החזית של המדף; האריזות צמודות לחזית */
      const fill=(y0,gap,z0,z1,keyBase)=>{const ph=Math.min(gap*.78,.42),dep=Math.abs(z1-z0)*.82,zc=z1-Math.sign(z1-z0)*(dep/2+.01);
        for(let b=0;b<nb;b++){const k=bw>=.9?3:2,pw=bw*.94/k;
          for(let i=0;i<k;i++){const key=mix(keyBase,b*16+i),hh=ph*(.6+.4*((mix(key,7)%100)/100));
            P(-W/2+b*bw+bw*.03+pw*(i+.5),y0+hh/2,zc,pw-.012,hh,dep,key)}}};
      if(f.k==='gon'||f.k==='wall'||f.k==='stand'){
        const two=f.sides===2,metal=0x5a5f66;
        B(0,.05,0,W,.1,D,0x3a3d42);
        B(0,(H+.1)/2,two?0:-D/2+.015,W,H-.1,.03,metal);
        for(const sg of[-1,1])B(sg*(W/2-.02),H/2,0,.04,H,D,metal);
        const sides=two?[[.015,D/2],[-.015,-D/2]]:[[-D/2+.03,D/2]],gap=(H-.15)/f.lvl;
        sides.forEach(([z0,z1],si)=>{for(let j=0;j<f.lvl;j++){const y=.1+j*gap;
          L(shelf,0,y+.0125,(z0+z1)/2,W-.08,.025,Math.abs(z1-z0));fill(y+.025,gap,z0,z1,mix(fh,si*64+j))}});
      }else if(f.k==='fridge'){
        const wc=0xf1f3f4;B(0,H/2,-D/2+.02,W,H,.04,wc);for(const sg of[-1,1])B(sg*(W/2-.025),H/2,0,.05,H,D,wc);
        B(0,H-.04,0,W,.08,D,wc);B(0,.075,0,W,.15,D,0x9aa3ab);
        const gap=(H-.3)/f.lvl;for(let j=0;j<f.lvl;j++){const y=.15+j*gap;L(shelf,0,y+.01,0,W-.1,.02,D-.06);fill(y+.02,gap,-D/2+.05,D/2-.03,mix(fh,j))}
        if(f.glass)L(glass,0,(H+.07)/2,D/2-.01,W-.1,H-.23,.02);
      }else if(f.k==='table'){
        B(0,H-.02,0,W,.04,D,0x8b5e3c);for(const sx of[-1,1])for(const sz of[-1,1])B(sx*(W/2-.05),(H-.04)/2,sz*(D/2-.05),.05,H-.04,.05,0x5b3d26);
        fill(H,.32,-D/2+.04,D/2-.04,mix(fh,999));
      }else{/* bin – סל */
        const bc=0x2d6aa3;B(0,.02,0,W,.04,D,bc);for(const sg of[-1,1]){B(sg*(W/2-.015),H/2,0,.03,H,D,bc);B(0,H/2,sg*(D/2-.015),W,H,.03,bc)}
        P(0,H*.38,0,W-.07,H*.7,D-.07,fh);
      }
      for(const b of f.bayList){L(pick,b.lx/100,H/2,b.ly/100,b.w/100,H,.06);pickBays.push({b,f})}
    }
    const add=m=>{if(m)root.add(m);return m};
    add(inst(BOX,M.inst,body,bodyC));add(inst(BOX,M.shelf,shelf));add(inst(BOX,M.inst,prod,prodC));
    const gm=add(inst(BOX,M.glass,glass));if(gm)gm.renderOrder=2;
    pickMat=pick;pickMesh=add(inst(BOX,M.pick,pick));
    scene.add(root);
    buildMs=performance.now()-t0;
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

  /* ---- מצלמה ומצבים ---- */
  let mode=opts.mode==='walk'?'walk':'top';
  const top={tx:0,tz:0,yaw:0,pitch:.95,dist:20,max:60},walk={x:0,z:0,yaw:0,pitch:-.05};
  function resetCams(){
    const b=model.bounds,e=model.ent,W=(b[2]-b[0])/100,H=(b[3]-b[1])/100;
    top.tx=(b[0]+b[2])/200;top.tz=(b[1]+b[3])/200;top.yaw=Math.atan2(e.ly,e.lx);
    const fit=Math.max(W,H)*.5/Math.tan(cam.fov*Math.PI/360)/Math.min(1,cam.aspect||1);
    top.dist=Math.min(140,Math.max(4,fit*.85));top.max=Math.max(top.dist*2,10);
    let x=e.x+e.lx*120,y=e.y+e.ly*120;
    if(!G.inAnyRoom(model,x,y)&&model.rooms[0]){const c=G.centroid(model.rooms[0].p);x=c[0];y=c[1]}
    [x,y]=G.resolveCircle(x,y,25,model.segs);walk.x=x/100;walk.z=y/100;walk.yaw=Math.atan2(e.ly,e.lx);walk.pitch=-.05;
  }
  function applyMode(){wallsG.scale.y=mode==='top'?.35:1;ceilG.visible=mode==='walk';placeCam()}
  function placeCam(){
    if(mode==='top'){const c=Math.cos(top.pitch),fx=Math.cos(top.yaw),fz=Math.sin(top.yaw);
      cam.position.set(top.tx-fx*c*top.dist,Math.sin(top.pitch)*top.dist,top.tz-fz*c*top.dist);cam.lookAt(top.tx,0,top.tz)}
    else{const c=Math.cos(walk.pitch);cam.position.set(walk.x,1.6,walk.z);cam.lookAt(walk.x+Math.cos(walk.yaw)*c,1.6+Math.sin(walk.pitch),walk.z+Math.sin(walk.yaw)*c)}
  }
  function walkBy(fwd,side){const fx=Math.cos(walk.yaw),fz=Math.sin(walk.yaw),tx=walk.x+fx*fwd-fz*side,tz=walk.z+fz*fwd+fx*side;
    const r=G.moveWithCollision(walk.x*100,walk.z*100,tx*100,tz*100,25,model.segs);walk.x=r[0]/100;walk.z=r[1]/100}

  /* ---- ציור לפי דרישה (חוסך סוללה): מציירים רק כשמשהו השתנה ---- */
  let raf=0,paused=false,lost=false,dead=false;
  function frame(){raf=0;if(paused||lost||dead)return;placeCam();renderer.render(scene,cam)}
  function invalidate(){if(!raf&&!paused&&!lost&&!dead)raf=requestAnimationFrame(frame)}
  function resize(){const w=el.clientWidth||1,h=el.clientHeight||1;renderer.setSize(w,h,false);cam.aspect=w/h;cam.updateProjectionMatrix();invalidate()}

  /* ---- מגע: גרירה, צביטה, הקשה ---- */
  const ptr=new Map();let tap=null,pinch=null;
  const ray=new T.Raycaster(),ndc=new T.Vector2();
  function onDown(e){cv.setPointerCapture&&cv.setPointerCapture(e.pointerId);ptr.set(e.pointerId,{x:e.clientX,y:e.clientY});
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
  function doPick(cx,cy){if(!pickMesh)return;const r=cv.getBoundingClientRect();ndc.set((cx-r.left)/r.width*2-1,-(cy-r.top)/r.height*2+1);
    placeCam();cam.updateMatrixWorld();ray.setFromCamera(ndc,cam);
    const hit=ray.intersectObject(pickMesh,false)[0];
    if(!hit||hit.instanceId==null){select(null);fire(null);return}
    const{b,f}=pickBays[hit.instanceId],lvHit=b.lv.length>1?(hit.point.y>f.h/200?'t':'b'):'a';
    select(b.id);fire({id:b.id,fx:b.fx,s:b.s,n:b.n,lv:b.lv.slice(),lvHit,num:f.num,name:f.name,k:f.k})}
  function fire(x){if(opts.onPick)try{opts.onPick(x)}catch(e){console.error(e)}}
  function select(id,quiet){selId=id||null;const i=id?pickBays.findIndex(o=>o.b.id===id):-1;
    if(i<0){sel.visible=false}else{sel.matrixAutoUpdate=false;sel.matrix.fromArray(pickMat,i*16).multiply(new T.Matrix4().makeScale(1.04,1.02,2.2));sel.matrixWorldNeedsUpdate=true;sel.visible=true}
    if(!quiet)invalidate();return i>=0}
  function focus(fxId){const f=model.fx.find(o=>o.id===fxId);if(!f)return false;
    if(mode==='top'){top.tx=f.x/100;top.tz=f.y/100;top.dist=Math.min(top.dist,8)}
    else{const b=f.bayList[0];let x=b.x+b.nx*120,y=b.y+b.ny*120;[x,y]=G.resolveCircle(x,y,25,model.segs);walk.x=x/100;walk.z=y/100;walk.yaw=Math.atan2(-b.ny,-b.nx)}
    invalidate();return true}

  /* ---- אובדן הקשר WebGL, הסתרת המסך ---- */
  let lostBox=null;
  function onLost(e){e.preventDefault();lost=true;if(!lostBox)lostBox=msgBox(el,'התצוגה נעצרה זמנית. מנסה לשחזר…');if(opts.onError)try{opts.onError('lost','התצוגה נעצרה זמנית')}catch(_){}}
  function onRestored(){lost=false;if(lostBox){lostBox.remove();lostBox=null}build(curMap)}
  function onVis(){if(document.hidden){if(raf){cancelAnimationFrame(raf);raf=0}}else invalidate()}
  cv.addEventListener('pointerdown',onDown);cv.addEventListener('pointermove',onMove);
  cv.addEventListener('pointerup',onUp);cv.addEventListener('pointercancel',onUp);
  cv.addEventListener('wheel',onWheel,{passive:false});
  cv.addEventListener('webglcontextlost',onLost,false);cv.addEventListener('webglcontextrestored',onRestored,false);
  document.addEventListener('visibilitychange',onVis);
  const ro=window.ResizeObserver?new ResizeObserver(resize):null;if(ro)ro.observe(el);else window.addEventListener('resize',resize);

  let curMap=null;
  const setMap=m=>{curMap=m;build(m);resetCams();applyMode();invalidate()};
  resize();setMap(map0);

  return{
    setMode(m){mode=m==='walk'?'walk':'top';applyMode();invalidate()},
    getMode:()=>mode,
    setMap,select:id=>select(id),focus,resize,
    pause(){paused=true;if(raf){cancelAnimationFrame(raf);raf=0}},
    resume(){paused=false;invalidate()},
    renderNow(){placeCam();const t=performance.now();renderer.render(scene,cam);const g=renderer.getContext();g.readPixels(0,0,1,1,g.RGBA,g.UNSIGNED_BYTE,new Uint8Array(4));return performance.now()-t},
    stats:()=>({three:THREE_VER,buildMs:+buildMs.toFixed(1),fx:model.fx.length,bays:model.bays.length,instances,calls:renderer.info.render.calls,tris:renderer.info.render.triangles,skip:model.skip.slice(),cam:cam.position.toArray().map(v=>+v.toFixed(2))}),
    destroy(){if(dead)return;dead=true;if(raf)cancelAnimationFrame(raf);
      cv.removeEventListener('pointerdown',onDown);cv.removeEventListener('pointermove',onMove);cv.removeEventListener('pointerup',onUp);cv.removeEventListener('pointercancel',onUp);
      cv.removeEventListener('wheel',onWheel);cv.removeEventListener('webglcontextlost',onLost);cv.removeEventListener('webglcontextrestored',onRestored);
      document.removeEventListener('visibilitychange',onVis);if(ro)ro.disconnect();else window.removeEventListener('resize',resize);
      if(root)disposeTree(root);for(const o of disp)o.dispose&&o.dispose();
      renderer.dispose();try{renderer.forceContextLoss()}catch(e){}cv.remove();overlay.forEach(o=>o.remove());if(lostBox)lostBox.remove();
      model=root=pickMesh=null;pickBays=[];pickMat=[]},
  };
}
window.Store3D={version:THREE_VER,supported,preload,open};
})();
