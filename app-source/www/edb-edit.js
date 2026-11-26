/* הדפסת דף אכיל (26.11.2026) – העורך (סבב 2: חלק מצעד 2 "עריכה ופריסה"), וציור משבצת (גם להדפסה ב-300 DPI, edb-print.js).
   תצוגה חיה בצורה המדויקת (עיגול / ריבוע / מלבן) עם החשכה מחוץ לקו החיתוך; גרירה, זום בשתי אצבעות, סיבוב (±90 ומחוון), היפוך;
   "שיפור אוטומטי" (רמות) + בהירות / ניגודיות / רוויה; כיתובים (גופנים מקומיים, גודל, צבע, מסגרת, צל, גרירה, קשת עליונה / תחתונה בעיגול);
   מד איכות לפי DPI אפקטיבי בגודל ההדפסה. התצוגה מציירת מעותק קטן של התמונה (עד 1024) – מהיר בטלפון חלש. */
(function(root){
'use strict';
if(typeof window==='undefined'||typeof ACT==='undefined'||!root.EdbCore)return;
const C=root.EdbCore,FONTS=[['Rubik','רוביק'],['IBM Plex Sans Hebrew','IBM Plex'],['Assistant','אסיסטנט']];
const FB=',Arial,sans-serif',DEG=Math.PI/180;
const P=()=>root.EdbPrint,S=()=>P().S,D=()=>S().ds[S().slots.length?S().slots[0].d:0]||S().ds[0];
const newT=()=>({s:'מזל טוב',f:'Rubik',b:true,sz:10,col:'#ffffff',ol:'#000000',ow:3,sh:true,x:0.5,y:0.5,arc:''});
/* ---------- ציור משבצת ----------
   o: {d (עיצוב), img ({w,h,lv}), src (קנבס מקור), ox,oy (פיקסלים – פינת קו החיתוך), ppm (פיקסלים למ"מ), wMm,hMm, shape, bl (מ"מ, הדפסה), prev (תצוגה)} */
function shapePath(g,shape,x,y,w,h,grow){g.beginPath();if(shape==='c')g.arc(x+w/2,y+h/2,w/2+grow,0,Math.PI*2);else g.rect(x-grow,y-grow,w+2*grow,h+2*grow)}
function draw(g,W,H,o){const d=o.d,I=o.img,wp=o.wMm*o.ppm,hp=o.hMm*o.ppm;
 g.save();g.setTransform(1,0,0,1,0,0);g.fillStyle='#fff';g.fillRect(0,0,W,H);
 if(I&&o.src){const q=Math.round((+d.rot||0)/90)%2!==0,a=q?I.h:I.w,b=q?I.w:I.h,sc=Math.max(wp/a,hp/b)*(+d.z||1);
  g.translate(o.ox+wp/2+d.x*wp,o.oy+hp/2+d.y*hp);g.rotate((+d.rot||0)*DEG);g.scale(d.fl?-1:1,1);g.imageSmoothingQuality='high';
  g.drawImage(o.src,-I.w*sc/2,-I.h*sc/2,I.w*sc,I.h*sc);g.setTransform(1,0,0,1,0,0)}
 if(C.adjNeeded(d)){const L=C.luts(I&&I.lv,d.auto,d.br,d.ct);for(let y=0;y<H;y+=256){const h=Math.min(256,H-y),id=g.getImageData(0,y,W,h);C.adjust(id.data,L,d.sat);g.putImageData(id,0,y)}}
 (d.tx||[]).forEach(t=>{try{text(g,t,o,wp,hp)}catch(e){}});
 if(o.prev){g.fillStyle='rgba(0,0,0,.62)';g.beginPath();g.rect(0,0,W,H);if(o.shape==='c')g.arc(o.ox+wp/2,o.oy+hp/2,wp/2,0,Math.PI*2,true);else{g.moveTo(o.ox,o.oy);g.lineTo(o.ox,o.oy+hp);g.lineTo(o.ox+wp,o.oy+hp);g.lineTo(o.ox+wp,o.oy);g.closePath()}g.fill('evenodd');
  g.setLineDash([6,4]);g.lineWidth=2;g.strokeStyle='#e7b84d';shapePath(g,o.shape,o.ox,o.oy,wp,hp,0);g.stroke();g.setLineDash([])}
 else if(o.shape==='c'){g.globalCompositeOperation='destination-in';shapePath(g,'c',o.ox,o.oy,wp,hp,(o.bl||0)*o.ppm);g.fill();g.globalCompositeOperation='destination-over';g.fillStyle='#fff';g.fillRect(0,0,W,H);g.globalCompositeOperation='source-over'}
 g.restore()}
function tStyle(g,t,px){g.font=`${t.b?700:400} ${px}px "${t.f||'Rubik'}"${FB}`;g.lineJoin='round';g.textBaseline='middle';g.textAlign='center'}
function paint(g,t,s,x,y,px){g.save();if(t.sh){g.shadowColor='rgba(0,0,0,.55)';g.shadowBlur=px*0.15;g.shadowOffsetX=g.shadowOffsetY=px*0.05}
 if(+t.ow>0){g.lineWidth=px*0.04*t.ow;g.strokeStyle=t.ol||'#000';g.strokeText(s,x,y);g.shadowColor='transparent'}g.fillStyle=t.col||'#fff';g.fillText(s,x,y);g.restore()}
function text(g,t,o,wp,hp){if(!t||!String(t.s||'').trim())return;const px=(+t.sz||10)*o.ppm;tStyle(g,t,px);
 if(t.arc&&o.shape==='c'){const cx=o.ox+wp/2,cy=o.oy+hp/2,R=wp/2-o.ppm*1.5-px*0.55;if(R<=px*0.5)return;g.direction='ltr';
  const ch=C.visual(t.s),ws=ch.map(c=>g.measureText(c).width),tot=ws.reduce((a,b)=>a+b,0)/R,top=t.arc!=='bot';let acc=0;
  ch.forEach((c,i)=>{const m=(acc+ws[i]/2)/R;acc+=ws[i];const a=top?-Math.PI/2-tot/2+m:Math.PI/2+tot/2-m;g.save();g.translate(cx+R*Math.cos(a),cy+R*Math.sin(a));g.rotate(top?a+Math.PI/2:a-Math.PI/2);paint(g,t,c,0,0,px);g.restore()});return}
 g.direction='rtl';paint(g,t,String(t.s),o.ox+t.x*wp,o.oy+t.y*hp,px)}
function quality(d){const s=S(),L=P().lay(),I=s.img;if(!I||!d)return null;const v=C.dpi(I.w,I.h,L.w,L.h,d.z,d.rot);return Object.assign({d:v},C.grade(v))}

/* ---------- המסך ---------- */
const E={cv:null,pad:0,ppm:1,raf:0,ptr:new Map(),drag:null,pin:null,ro:null};
const rng=(k,t,min,max,st,v)=>`<label class="f"><span>${t}: <b data-edb-v="${k}">${v}</b></span><input type="range" min="${min}" max="${max}" step="${st}" value="${v}" data-i="edbV" data-k="${k}" style="width:100%;min-height:36px"></label>`;
function html(s){const d=D(),L=P().lay(),sel=s.sel,t=d.tx[sel];
 let h=`<div style="display:flex;justify-content:center"><canvas id="edbCv" style="width:100%;max-width:340px;touch-action:none;border-radius:10px;background:#111;display:block"></canvas></div>
<div style="text-align:center;margin:8px 0" id="edbQ"></div>
<p class="note" style="text-align:center;margin:0 0 6px">גוררים עם אצבע, מגדילים בשתי אצבעות. ${L.n>1?'התמונה תחזור על כל '+L.n+' החלקים.':''}</p>
<div class="card"><div class="edR"><button class="btn g s" data-a="edbRot" data-v="-90">⟲ 90°</button><button class="btn g s" data-a="edbRot" data-v="90">⟳ 90°</button><button class="btn g s" data-a="edbFl">היפוך</button></div>
${rng('rot','סיבוב',-180,180,1,d.rot)}${rng('z','זום',0.3,6,0.01,(+d.z).toFixed(2))}
<div class="edR"><button class="btn g s" data-a="edbFit" data-v="cover">מילוי</button><button class="btn g s" data-a="edbFit" data-v="contain">כל התמונה</button><button class="btn g s" data-a="edbFit" data-v="reset">איפוס</button></div></div>
<div class="card"><button class="btn ${d.auto?'':'g '}w" data-a="edbAuto">✨ שיפור אוטומטי${d.auto?' – פעיל':''}</button>
${rng('br','בהירות',-100,100,1,d.br)}${rng('ct','ניגודיות',-100,100,1,d.ct)}${rng('sat','רוויה',-100,100,1,d.sat)}</div>
<div class="card"><div class="edR"><b>כיתוב</b><button class="btn g s" data-a="edbTAdd" style="flex:none">+ הוספת כיתוב</button></div>
${d.tx.length?`<div class="edR" style="flex-wrap:wrap;margin-top:8px">${d.tx.map((x,i)=>`<button class="btn s ${i===sel?'':'g'}" data-a="edbTSel" data-v="${i}" style="flex:none;max-width:48%;overflow:hidden">${esc(String(x.s||'').slice(0,14)||'(ריק)')}</button>`).join('')}</div>`:''}`;
 if(t)h+=`<label class="f"><span>הטקסט</span><input data-i="edbT" data-k="s" value="${esc(t.s)}" maxlength="60" dir="rtl"></label>
<div class="edR"><label class="f"><span>גופן</span><select data-c="edbTC" data-k="f">${FONTS.map(([v,n])=>`<option value="${esc(v)}"${t.f===v?' selected':''}>${n}</option>`).join('')}</select></label>
<label class="f"><span>עובי</span><select data-c="edbTC" data-k="b"><option value="1"${t.b?' selected':''}>מודגש</option><option value=""${t.b?'':' selected'}>רגיל</option></select></label></div>
${rng('t:sz','גודל (מ"מ)',3,60,0.5,t.sz)}
<div class="edR"><label class="f"><span>צבע</span><input type="color" data-i="edbT" data-k="col" value="${esc(t.col)}"></label><label class="f"><span>צבע מסגרת</span><input type="color" data-i="edbT" data-k="ol" value="${esc(t.ol)}"></label></div>
${rng('t:ow','עובי מסגרת',0,10,0.5,t.ow)}
<div class="edR"><label class="row" style="gap:8px;align-items:center;min-height:44px"><input type="checkbox" data-c="edbTC" data-k="sh"${t.sh?' checked':''} style="width:24px;height:24px"> צל</label>
${L.shape==='c'?`<label class="f"><span>צורה</span><select data-c="edbTC" data-k="arc"><option value="">ישר (גוררים)</option><option value="top"${t.arc==='top'?' selected':''}>קשת עליונה</option><option value="bot"${t.arc==='bot'?' selected':''}>קשת תחתונה</option></select></label>`:''}</div>
<button class="btn r s w" data-a="edbTDel">מחיקת הכיתוב</button>`;
 return h+'</div>'}
function mount(){const c=document.getElementById('edbCv');if(!c)return;E.cv=c;const L=P().lay();E.pad=Math.max(L.w,L.h)*0.08;
 const cw=Math.max(200,Math.min(340,c.clientWidth||320)),dpr=Math.min(2,window.devicePixelRatio||1),wMm=L.w+2*E.pad,hMm=L.h+2*E.pad,ch=cw*hMm/wMm;
 c.style.height=ch+'px';c.width=Math.round(cw*dpr);c.height=Math.round(ch*dpr);E.ppm=c.width/wMm;
 if(!c.dataset.on){c.dataset.on='1';c.addEventListener('pointerdown',pd);c.addEventListener('pointermove',pm);['pointerup','pointercancel','pointerleave'].forEach(n=>c.addEventListener(n,pu))}
 paintNow();try{if(document.fonts&&document.fonts.ready)document.fonts.ready.then(soon)}catch(e){}}
function unmount(){E.cv=null;E.ptr.clear();E.drag=null;E.pin=null}
function paintNow(){const c=E.cv;if(!c||!c.isConnected)return;const s=S(),L=P().lay(),d=D();
 draw(c.getContext('2d'),c.width,c.height,{d,img:s.img,src:s.img&&s.img.p,ox:E.pad*E.ppm,oy:E.pad*E.ppm,ppm:E.ppm,wMm:L.w,hMm:L.h,shape:L.shape,prev:1});
 const q=quality(d),e=document.getElementById('edbQ');if(e&&q)e.innerHTML=`<span class="edQ ${q.c}"><i></i>איכות הדפסה: ${q.d} DPI – ${q.t}</span>`;
 try{if(P().pvSoon)P().pvSoon()}catch(x){}} // סבב 2: תצוגת הדף מתעדכנת (לכל היותר פעם ב-300ms)
const soon=()=>{if(E.raf)return;E.raf=requestAnimationFrame(()=>{E.raf=0;paintNow()})};
// נקודה במסך → פיקסלים של הקנבס
const cp=e=>{const r=E.cv.getBoundingClientRect(),k=E.cv.width/r.width;return{x:(e.clientX-r.left)*k,y:(e.clientY-r.top)*k}};
function hit(p){const d=D(),L=P().lay(),g=E.cv.getContext('2d'),wp=L.w*E.ppm,hp=L.h*E.ppm,o=E.pad*E.ppm;
 for(let i=d.tx.length-1;i>=0;i--){const t=d.tx[i];if(t.arc&&L.shape==='c')continue;const px=t.sz*E.ppm;tStyle(g,t,px);const w=g.measureText(String(t.s||'')).width/2+px*0.3,cx=o+t.x*wp,cy=o+t.y*hp;if(Math.abs(p.x-cx)<=w&&Math.abs(p.y-cy)<=px*0.7)return i}return -1}
function pd(e){if(!E.cv)return;try{E.cv.setPointerCapture(e.pointerId)}catch(x){}E.ptr.set(e.pointerId,cp(e));
 if(E.ptr.size===1){const p=cp(e),i=hit(p);E.drag={p,t:i};if(i>=0&&S().sel!==i){S().sel=i;P().redraw()}}
 else if(E.ptr.size===2){const [a,b]=[...E.ptr.values()];E.pin={d0:Math.hypot(a.x-b.x,a.y-b.y)||1,z0:+D().z||1};E.drag=null}}
function pm(e){if(!E.cv||!E.ptr.has(e.pointerId))return;const p=cp(e);E.ptr.set(e.pointerId,p);const d=D(),L=P().lay(),wp=L.w*E.ppm,hp=L.h*E.ppm;
 if(E.pin&&E.ptr.size>=2){const [a,b]=[...E.ptr.values()];d.z=Math.min(6,Math.max(0.3,E.pin.z0*Math.hypot(a.x-b.x,a.y-b.y)/E.pin.d0));sync();soon();return}
 if(!E.drag)return;const dx=p.x-E.drag.p.x,dy=p.y-E.drag.p.y;E.drag.p=p;
 if(E.drag.t>=0){const t=d.tx[E.drag.t];if(t){t.x=Math.min(1.1,Math.max(-0.1,t.x+dx/wp));t.y=Math.min(1.1,Math.max(-0.1,t.y+dy/hp))}}else{d.x+=dx/wp;d.y+=dy/hp}soon()}
function pu(e){E.ptr.delete(e.pointerId);if(E.ptr.size<2)E.pin=null;if(!E.ptr.size)E.drag=null}
// עדכון ערכי המחוונים בלי לבנות את המסך מחדש
function sync(){const d=D();document.querySelectorAll('#edbW [data-k="z"]').forEach(i=>{i.value=d.z});const b=document.querySelector('[data-edb-v="z"]');if(b)b.textContent=(+d.z).toFixed(2);
 const r=document.querySelector('#edbW [data-k="rot"]');if(r)r.value=d.rot;const rb=document.querySelector('[data-edb-v="rot"]');if(rb)rb.textContent=d.rot}
INP.edbV=el=>{const k=el.dataset.k,v=+el.value,d=D();if(k.startsWith('t:')){const t=d.tx[S().sel];if(t)t[k.slice(2)]=v}else d[k]=v;const b=document.querySelector(`[data-edb-v="${k}"]`);if(b)b.textContent=k==='z'?v.toFixed(2):v;soon()};
INP.edbT=el=>{const t=D().tx[S().sel];if(!t)return;t[el.dataset.k]=String(el.value).slice(0,60);soon()};
CHG.edbTC=el=>{const t=D().tx[S().sel];if(!t)return;const k=el.dataset.k;t[k]=k==='sh'?!!el.checked:k==='b'?!!el.value:el.value;soon()};
ACT.edbRot=el=>{const d=D();let r=Math.round((+d.rot||0)+(+el.dataset.v));r=((r+180)%360+360)%360-180;d.rot=r;sync();soon()};
ACT.edbFl=()=>{const d=D();d.fl=!d.fl;soon()};
ACT.edbFit=el=>{const d=D(),v=el.dataset.v,I=S().img,L=P().lay();if(v==='reset'){Object.assign(d,{x:0,y:0,z:1,rot:0,fl:false})}else{d.x=0;d.y=0;
 if(v==='cover')d.z=1;else if(I){const q=Math.round(d.rot/90)%2!==0,a=q?I.h:I.w,b=q?I.w:I.h;d.z=Math.max(0.3,Math.min(L.w/a,L.h/b)/Math.max(L.w/a,L.h/b))}}sync();soon()};
ACT.edbAuto=()=>{const d=D();d.auto=!d.auto;P().redraw()};
ACT.edbTAdd=()=>{const d=D(),L=P().lay();if(d.tx.length>=8){toast('עד 8 כיתובים');return}const t=newT();t.sz=Math.max(4,Math.min(30,Math.round(L.h*0.12)));t.y=d.tx.length?Math.min(0.85,0.3+d.tx.length*0.2):0.5;d.tx.push(t);S().sel=d.tx.length-1;P().redraw()};
ACT.edbTSel=el=>{S().sel=+el.dataset.v;P().redraw()};
ACT.edbTDel=()=>{const d=D(),i=S().sel;if(i>=0&&i<d.tx.length){d.tx.splice(i,1);S().sel=d.tx.length?d.tx.length-1:-1;P().redraw()}};
root.EdbEdit={draw,html,mount,unmount,quality,newT,E};
})(window);
