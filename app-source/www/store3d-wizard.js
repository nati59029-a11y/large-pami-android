/* סריקת חנות בתלת מימד – שלב 11 (משימה 2026-11-14_סריקת-חנות-תלת-מימד): אשף הקמה.
   קובץ עצמאי, נטען אחרי store3d-capture.js. מוסיף את המסך V.st3w ואת S3UI.openWizard. בסיס כללי לכל עסק: אין כאן שום תוכן של עסק מסוים –
   כל עסק מצלם את החנות שלו, והמערכת בונה טיוטה לבד. הזרימה: 1 צלמו (תמונות החנות + תמונות לקירות/רצפה/תקרה) ← 2 טיוטה (mapDraft, AI בשרת)
   ← 3 תקנו (העורך, עם סימון אזורים לא ודאיים uz) ← 4 שמרו (s3SaveMap, רק אחרי שהמנהל עבר על כל אזור לא ודאי ואישר את הטיוטה) ← 5 קבעו סבב (sround).
   החלטת משתמש: המנהל עובר על טיוטת ה-AI ומאשר לפני השמירה הראשונה; אי אפשר לשמור עד שכל uz אושר/תוקן/נמחק.
   האשף פועל רק כשאין עדיין מפה (לא דורס מפה קיימת). טקסטורות: s3PutTex מיד בצילום, והנתיבים נשמרים בטלפון ונכנסים למפה ב-tx[] ובחדרים ב-tex בשמירה (wizPrep).
   אין כאן שום קריאה לשרת כשהתוסף כבוי (feat()).
   הקמת חנות שלב 1 (17.11.2026): (א) סקיצה בלי תמונות = מפה בלי AI (skToMap, באותו מבנה כמו טיוטה מהשרת). (ב) סרטון עד 3 דקות; עד 100
   תמונות מכל המקורות יחד, ותמונה נפרדת קודמת לפריימים (כשאין מקום – הפריימים מדוללים בפיזור שווה). (ג) תמונות פינה עם תווית (lbl).
   לשרת: פריימים קודם ואז תמונות, src = {vid, ph, sk}, ו-lbl רק כשיש תווית (שרת ישן מתעלם משניהם). */
(function(){
'use strict';
const U=window.S3UI;
if(!U||typeof ACT==='undefined'||typeof V==='undefined'||typeof CHG==='undefined'||typeof go==='undefined')return;
const esc2=U.esc2;
const MAXI=100,MAXB=13e6,LBLM=40,STEPS=['צלמו','טיוטה','תקנו','שמרו','סבב'];
const TK={w:'קירות',f:'רצפה',c:'תקרה'};
const DOW=['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
const W={own:'',kind:'s',br:'',step:1,imgs:[],tex:{w:null,f:null,c:null},busy:'',msg:'',qid:'',draft:null,staff:null,staffErr:'',rule:null,rid:'',made:0,runMsg:'',q:null,sk:null,det:0,qSeen:0,lbl:'כניסה'};
/* שאלון וסקיצה (15.11.2026): q = מה שהוקלד (מחרוזות, מטרים); sk = שרטוט בס"מ במערכת הצירים של המפה (x ימינה, y למטה), w/l = המידות שבהן שורטט */
const Q0=()=>({path:'',w:'',l:'',rooms:'',rows:'',ent:'',cash:'',note:''});
const SK0=()=>({rooms:[],cur:[],rows:[],rt:[],rk:[],doors:[],tills:[],pend:null,cpend:null,sel:null,mode:'room',w:0,l:0,undo:[],gen:0});
U.W=W;
const me=()=>(SY&&SY.bizId||'')+'|'+(SY&&SY.uid||'');
const loggedIn=()=>!!(SY&&SY.refresh&&SY.uid);
const mapId=()=>U.mapIdOf(W.kind,W.br||U.brSel());
const lsK=()=>LK('lp-s3w:'+mapId());
/* הטיוטה בטלפון: גרסה 1 = {tex}; גרסה 2 (15.11.2026) = {v:2,tex,q,sk}. גרסה 1 נקראת כמו קודם (בלי שאלון) */
const isO=o=>!!o&&typeof o==='object'&&!Array.isArray(o);
const lsRead=()=>{try{const v=JSON.parse(localStorage.getItem(lsK()));if(!isO(v)||!(isO(v.tex)||isO(v.q)||isO(v.sk)))return null;if(!isO(v.tex))v.tex={};return v}catch(e){return null}};
const qEmpty=()=>{const q=W.q,k=W.sk;return(!q||!Object.values(q).some(x=>String(x).trim()))&&(!k||!(k.rooms.length||k.cur.length||k.rows.length||k.doors.length||k.tills.length))};
const lsSave=()=>{try{const t={};for(const k of ['w','f','c'])if(W.tex[k])t[k]={texId:W.tex[k].texId,path:W.tex[k].path,w:W.tex[k].w,h:W.tex[k].h};
 const o={v:2,tex:t};if(!qEmpty()){o.q=W.q;const k=W.sk;o.sk={rooms:k.rooms,cur:k.cur,rows:k.rows,rt:k.rt,rk:k.rk,doors:k.doors,tills:k.tills,mode:k.mode,w:k.w,l:k.l,gen:k.gen?1:0}}
 if(Object.keys(t).length||o.q)localStorage.setItem(lsK(),JSON.stringify(o));else localStorage.removeItem(lsK())}catch(e){}};
/* שחזור מהטלפון – רק ערכים בצורה הנכונה; כל דבר אחר מתחיל ריק */
const nArr=(a,n)=>Array.isArray(a)&&a.every(v=>Number.isFinite(v))&&(!n||a.length===n);
/* כניסות: {x,y,w (ס"מ), io: in/out = נפתחת פנימה/החוצה, dh: r/l = הציר מימין/משמאל כשעומדים בחוץ מול הדלת}. קופות: {x,y,w,d,a} */
const dLoad=L=>Array.isArray(L)?L.filter(d=>isO(d)&&Number.isFinite(d.x)&&Number.isFinite(d.y)).slice(0,40).map(d=>({x:d.x,y:d.y,w:Number.isFinite(d.w)?Math.min(500,Math.max(60,Math.round(d.w))):120,io:d.io==='out'?'out':'in',dh:d.dh==='l'?'l':'r'})):[];
const tLoad=L=>Array.isArray(L)?L.filter(t=>isO(t)&&Number.isFinite(t.x)&&Number.isFinite(t.y)).slice(0,40).map(t=>({x:t.x,y:t.y,w:Number.isFinite(t.w)?Math.min(1000,Math.max(30,Math.round(t.w))):120,d:Number.isFinite(t.d)?Math.min(1000,Math.max(30,Math.round(t.d))):60,a:t.a===90?90:0})):[];
function qLoad(v){W.q=Q0();W.sk=SK0();if(!v)return;
 if(isO(v.q))for(const k of Object.keys(W.q))if(typeof v.q[k]==='string')W.q[k]=v.q[k].slice(0,k==='note'?200:12);
 const k=v.sk;if(isO(k)){const K=W.sk;if(Array.isArray(k.rooms))K.rooms=k.rooms.filter(p=>nArr(p)&&p.length>=6&&p.length<=40&&!(p.length%2)).slice(0,6);if(nArr(k.cur)&&!(k.cur.length%2))K.cur=k.cur.slice(0,40);
  if(Array.isArray(k.rows))K.rows=k.rows.filter(r=>nArr(r,4)).slice(0,30);if(['row','sel','ent','cash'].includes(k.mode))K.mode=k.mode;if(Number.isFinite(k.w)&&Number.isFinite(k.l)){K.w=k.w;K.l=k.l}
  const ty=(a,ok)=>Array.isArray(a)?a.map(v=>ok.includes(v)?v:ok[ok.length-1]):[];K.rt=ty(k.rt,['s','w','x']);K.rk=ty(k.rk,['wall','fridge','gon']);
  K.doors=dLoad(k.doors);K.tills=tLoad(k.tills);
  /* שרטוט מגרסה קודמת: נקודת כניסה/קופה אחת → כניסה/קופה ברשימה, בגודל ברירת מחדל */
  if(!K.doors.length&&nArr(k.ent,2))K.doors=[{x:k.ent[0],y:k.ent[1],w:120,io:'in',dh:'r'}];
  if(!K.tills.length&&nArr(k.cash,2))K.tills=[{x:k.cash[0],y:k.cash[1],w:120,d:60,a:0}];K.gen=k.gen?1:0}
 if(!['a','b'].includes(W.q.path))W.q.path=''}
const revoke=()=>{for(const i of W.imgs)try{URL.revokeObjectURL(i.url)}catch(e){}for(const k of ['w','f','c'])if(W.tex[k]&&W.tex[k].url)try{URL.revokeObjectURL(W.tex[k].url)}catch(e){}};
function reset(kind){revoke();W.own=me();W.kind=kind==='w'?'w':'s';W.br=U.brSel();W.step=1;W.imgs=[];W.tex={w:null,f:null,c:null};W.busy='';W.msg='';W.qid='';W.draft=null;W.fixTxt='';W.fixQid='';W.fixMsg='';W.staff=null;W.staffErr='';W.rule=null;W.rid='';W.made=0;W.runMsg='';W.det=0;W.qSeen=0;W.nt=null;
 const v=lsRead();qLoad(v);if(v)for(const k of ['w','f','c'])if(v.tex[k]&&typeof v.tex[k].path==='string')W.tex[k]={texId:v.tex[k].texId,path:v.tex[k].path,w:v.tex[k].w,h:v.tex[k].h,url:''}}
U.openWizard=k=>{const kind=k==='w'?'w':'s';if(W.own!==me()||W.kind!==kind||W.br!==U.brSel())reset(kind);if(cur().v!=='st3w')go('st3w')};

/* ---------- אחרי מעבר על הטיוטה בעורך ---------- */
const zs=m=>(m&&Array.isArray(m.uz)?m.uz:[]);
const zOpen=m=>zs(m).filter(z=>z&&z.ok!==true).length;
/* שער השמירה: לא שומרים לפני שהמנהל עבר על כל אזור לא ודאי ואישר את הטיוטה (החלטת משתמש) */
U.wizGate=m=>{const E=U.E,n=zOpen(m);
 if(n)return `יש ${n} ${n===1?'אזור לא ודאי':'אזורים לא ודאיים'} שעוד לא עברתם עליהם. אשרו, תקנו או מחקו כל אחד מהם לפני השמירה.`;
 if(E&&E.wiz&&!E.wiz.appr)return 'סמנו "עברתי על הטיוטה ואני מאשר/ת אותה" לפני השמירה.';return ''};
/* לפני השמירה: טקסטורות שצולמו באשף נכנסות למפה (tx[]) ולכל חדר (tex). רק על עותק השליחה */
U.wizPrep=body=>{
 const E=U.E;if(!E||!E.wiz||!body)return;
 const T=W.tex,got=['w','f','c'].filter(k=>T[k]&&T[k].texId);if(!got.length)return;
 if(!Array.isArray(body.tx))body.tx=[];
 for(const k of got){const t=T[k];if(!body.tx.some(x=>x&&x.id===t.texId))body.tx.push({id:t.texId,path:t.path,w:t.w,h:t.h})}
 for(const r of (body.rooms||[])){if(!r||r.del===1)continue;const o=Object.assign({},r.tex||{});for(const k of got)if(!o[k])o[k]=T[k].texId;r.tex=o}};
U.wizDone=()=>{W.step=5;W.made=1;W.draft=null;W.q=Q0();W.sk=SK0();W.det=0;for(const k of ['w','f','c'])if(W.tex[k]){if(W.tex[k].url)try{URL.revokeObjectURL(W.tex[k].url)}catch(e){}W.tex[k]=null}lsSave();W.msg='';if(U.E)U.E.wiz=null};
const stepper=n=>`<ol class="s3st" aria-label="שלבי ההקמה">${STEPS.map((l,i)=>`<li class="${i+1===n?'on':i+1<n?'dn':''}"${i+1===n?' aria-current="step"':''}>${i+1}. ${l}</li>`).join('')}</ol>`;
const keyOf=z=>[z.x,z.y,z.w,z.d].join('_');
/* הלוח שבעורך: ראש מעל המפה, ואזורים מתחתיה */
U.wizPanel=()=>{/* ראש הלוח: מעל המפה */
 const E=U.E,m=E.map,n=zOpen(m),w=E.wiz||{};
 const step=(n||(w.appr?0:1))?3:4;
 return `<div class="card s3s" id="s3wp">${stepper(step)}<b>${w.sk?'טיוטה מהסקיצה – בדקו לפני השמירה':'טיוטה מהתמונות – בדקו לפני השמירה'}</b>
  <p class="note s3note">${w.sk?'המפה נבנתה מהסקיצה שציירתם, בלי AI: חדרים, שורות, כניסות וקופות. השורות קיבלו מידות ברירת מחדל (מקטע לכל מטר, 5 קומות). עברו על המפה ותקנו מה שלא נכון.':`${w.n?`ה-AI בנה את הטיוטה מ-${+w.n} תמונות. `:''}זו הערכה (לא מאומת)${w.conf!=null?`, רמת ביטחון ${Math.round(+w.conf*100)}% לפי המודל`:''}. עברו על המפה, תקנו מה שלא נכון, ואז על האזורים שמתחתיה.`}</p>
  ${w.notes?`<div class="s3info"><small>הערת ה-AI:</small> ${esc2(w.notes)}</div>`:''}
  <label class="f" style="display:block;margin-top:8px"><span>שם המפה</span><input data-c="s3wName" maxlength="40" value="${esc2(String(m.name||'').replace(/\s*\(טיוטה\)\s*$/,''))}"></label></div>`};
U.wizZones=()=>{/* אזורים לא ודאיים ואישור הטיוטה: מתחת למפה, ממש לפני כפתור השמירה */
 const E=U.E,m=E.map,Z=zs(m),n=zOpen(m),w=E.wiz||{},how=w.how||(w.how={});
 let h=`<div class="card s3s" id="s3wz">`;
 if(Z.length){
  h+=`<p class="s3note" style="margin-top:0"><b>${n?`${n} מתוך ${Z.length} אזורים לא ודאיים עוד לא נבדקו`:`עברתם על כל ${Z.length} האזורים הלא ודאיים`}</b><br><span class="note">האזורים מסומנים במפה במסגרת מקווקווה עם סימן שאלה. אי אפשר לשמור עד שעוברים על כולם: אישור (המפה נכונה), תיקנתי (תיקנתם במפה), או מחיקה (האזור לא רלוונטי).</span></p>`;
  h+=Z.map((z,i)=>`<div class="s3info ${z.ok?'':'s3err'}"><div class="row" style="justify-content:space-between"><b>${z.ok?'✓':'?'} אזור ${i+1}${z.txt?': '+esc2(z.txt):''}</b>${z.ok?`<span class="tag t3">${how[keyOf(z)]==='fix'?'תוקן':'אושר'}</span>`:`<span class="tag t1">לבדיקה</span>`}</div>
   <div class="row s3row"><button class="btn s g" data-a="s3wZ" data-i="${i}">הראו במפה</button>${z.ok?`<button class="btn s g" data-a="s3wUn" data-i="${i}">החזירו לבדיקה</button>`:`<button class="btn s" data-a="s3wOk" data-i="${i}">אישור</button><button class="btn s g" data-a="s3wZFix" data-i="${i}">תיקנתי</button>`}<button class="btn s g" data-a="s3wDel" data-i="${i}" aria-label="מחיקת האזור ${i+1}">מחיקה</button></div></div>`).join('');
 }else h+=`<p class="s3note" style="margin-top:0">${w.sk?'אין אזורים לא ודאיים (המפה מהסקיצה).':'ה-AI לא סימן אזורים לא ודאיים.'} עדיין חשוב לעבור על המפה לפני השמירה.</p>`;
 h+=`<label class="cb" style="display:flex;gap:8px;align-items:center;min-height:44px;margin-top:10px"><input type="checkbox" data-c="s3wAppr"${w.appr?' checked':''}> עברתי על הטיוטה ואני מאשר/ת אותה</label></div>`;
 return h};
const rr=()=>{if(U.edTouch)U.edTouch();else rerender()};
ACT.s3wZ=el=>{const E=U.E,z=zs(E.map)[+el.dataset.i];if(!z)return;E.wiz=E.wiz||{};E.wiz.zi=+el.dataset.i;E.vw=Math.max(1200,Math.max(z.w,z.d)*3);E.vx=z.x+z.w/2-E.vw/2;E.vy=z.y+z.d/2-E.vw*.45;rerender()};
const mark=(i,v,how)=>{const E=U.E,z=zs(E.map)[i];if(!z)return;z.ok=!!v;E.wiz=E.wiz||{};E.wiz.how=E.wiz.how||{};if(v)E.wiz.how[keyOf(z)]=how;else delete E.wiz.how[keyOf(z)];rr()};
ACT.s3wOk=el=>mark(+el.dataset.i,true,'ok');
ACT.s3wZFix=el=>mark(+el.dataset.i,true,'fix');/* שם נפרד מ-s3wFix (שליחת תיקונים בכתב) – קודם התנגשו */
ACT.s3wUn=el=>mark(+el.dataset.i,false);
ACT.s3wDel=el=>{const E=U.E,L=zs(E.map),i=+el.dataset.i;if(!L[i])return;L.splice(i,1);if(E.wiz)E.wiz.zi=-1;toast('האזור הוסר מהרשימה (המפה לא השתנתה)');rr()};
CHG.s3wAppr=el=>{const E=U.E;E.wiz=E.wiz||{};E.wiz.appr=!!el.checked;rr()};
CHG.s3wName=el=>{const E=U.E,v=String(el.value||'').trim().slice(0,40);if(!v){toast('למפה חייב להיות שם');el.value=E.map.name||'';return}E.map.name=v;E.dirty=true};

/* ---------- עיבוד תמונות במכשיר ---------- */
async function small(file){/* תמונת טיוטה: עד 1024px, JPEG */
 const d=await U.decode(file);try{const k=Math.min(1,1024/Math.max(d.w,d.h)),w=Math.max(1,Math.round(d.w*k)),h=Math.max(1,Math.round(d.h*k)),c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(d.src,0,0,w,h);
  const b=await U.blobOf(c,.72);if(!b)throw new Error('x');return{blob:b,w,h}}finally{d.close()}}
async function texBlob(file){/* טקסטורה: כל צלע 256/512/1024 בדיוק (דרישת השרת), חיתוך ממרכז בלי עיוות, עד כ-580KB */
 const d=await U.decode(file);try{const ar=d.w/d.h;let tw=1024,th=1024;if(ar>=1.5)th=512;else if(ar<=.67)tw=512;
  for(let r=0;r<3;r++){const sc=Math.max(tw/d.w,th/d.h),sw=tw/sc,sh=th/sc,c=document.createElement('canvas');c.width=tw;c.height=th;c.getContext('2d').drawImage(d.src,(d.w-sw)/2,(d.h-sh)/2,sw,sh,0,0,tw,th);
   for(let q=.85;q>=.45;q-=.1){const b=await U.blobOf(c,q);if(b&&b.size<=580000)return{blob:b,w:tw,h:th}}
   if(tw>256)tw/=2;if(th>256)th/=2}
  throw new Error('big')}finally{d.close()}}
const total=()=>W.imgs.reduce((a,i)=>a+i.blob.size,0);
const mb=n=>(n/1e6).toFixed(1).replace('.0','');
/* s: 'v' = פריים מסרטון, 'p' = תמונה נפרדת. lbl = תווית פינה (עד 40 תווים, '' = בלי) */
const isV=i=>i.s==='v';
/* תמונה נפרדת קודמת לפריימים: כשאין מקום (100 תמונות או 13MB) מסירים פריים אחד בכל פעם, כך שהנשארים בפיזור שווה. מחזיר כמה הוסרו */
function vroom(sz){let cut=0;
 while(W.imgs.length>=MAXI||total()+sz>MAXB){const V=W.imgs.filter(isV);if(!V.length)break;const keep=new Set(vsel(V,V.length-1));
  W.imgs=W.imgs.filter(i=>{if(!isV(i)||keep.has(i))return true;try{URL.revokeObjectURL(i.url)}catch(e){}return false});cut++}
 return cut}
async function addImgs(files,lbl){
 W.msg='';W.busy='מכינים את התמונות…';rerender();let bad=0,full=0,cut=0;const L=String(lbl||'').replace(/\s+/g,' ').trim().slice(0,LBLM);
 for(const f of files){
  if(W.imgs.length>=MAXI&&!W.imgs.some(isV)){full=1;break}
  if(f.type&&!/^image\//.test(f.type)){bad++;continue}
  try{const p=await small(f);cut+=vroom(p.blob.size);if(W.imgs.length>=MAXI){full=1;break}if(total()+p.blob.size>MAXB){full=2;break}W.imgs.push({blob:p.blob,url:URL.createObjectURL(p.blob),w:p.w,h:p.h,s:'p',lbl:L});W.qid=''}catch(e){bad++}}
 W.busy='';W.msg=(cut?`כדי לפנות מקום לתמונות הוסרו ${cut} פריימים מהסרטון (הנשארים בפיזור שווה). `:'')+(full===1?`אפשר עד ${MAXI} תמונות. `:full===2?'התמונות הגיעו לגודל המרבי. מחקו תמונה כדי להוסיף. ':'')+(bad?`${bad} קבצים לא נקלטו (לא תמונה, או שלא ניתן היה לקרוא אותם). `:'');rerender()}
/* ---------- סרטון: עיבוד בטלפון. פריימים חדים נבחרים ועוברים דרך small() כמו תמונות מהגלריה ---------- */
const VMAX=180,VSTEP=.75,VWIN=2,VERR='לא הצלחנו לקרוא את הסרטון. נסו לצלם שוב, או בחרו תמונות.';
const vwait=(v,ev,ms)=>new Promise((ok,no)=>{let t;const f=()=>{clear();ok()},e=()=>{clear();no(new Error('v'))},clear=()=>{clearTimeout(t);v.removeEventListener(ev,f);v.removeEventListener('error',e)};
 t=setTimeout(e,ms);v.addEventListener(ev,f);v.addEventListener('error',e)});
async function vopen(file){
 const url=URL.createObjectURL(file),v=document.createElement('video');v.muted=true;v.playsInline=true;v.preload='auto';v.style.display='none';
 const done=()=>{try{v.removeAttribute('src');v.load()}catch(e){}URL.revokeObjectURL(url)};
 try{v.src=url;await vwait(v,'loadeddata',15000);
  if(!isFinite(v.duration)){v.currentTime=1e7;await vwait(v,'seeked',8000);v.currentTime=0;await vwait(v,'seeked',8000)}
  if(!(v.duration>0)||!v.videoWidth||!v.videoHeight)throw new Error('v');
  return{v,done}}catch(e){done();throw e}}
const vseek=async(v,t)=>{v.currentTime=t;await vwait(v,'seeked',8000)};
/* חדות = סכום ריבועי ההפרשים בין פיקסלים שכנים (בגווני אפור), בקנה מידה קבוע */
function vgray(v,c){const w=c.width,h=c.height,x=c.getContext('2d',{willReadFrequently:true});x.drawImage(v,0,0,w,h);const d=x.getImageData(0,0,w,h).data,g=new Uint8Array(w*h);
 for(let i=0;i<g.length;i++)g[i]=(d[i*4]*77+d[i*4+1]*150+d[i*4+2]*29)>>8;
 let s=0;for(let y=0;y<h-1;y++)for(let i=y*w,e=i+w-1;i<e;i++){const a=g[i]-g[i+1],b=g[i]-g[i+w];s+=a*a+b*b}
 return{g,s:s/(w*h)}}
const vdiff=(a,b)=>{let s=0;for(let i=0;i<a.length;i++)s+=Math.abs(a[i]-b[i]);return s/a.length};
/* מכל חלון של 2 שניות: המועמדת החדה ביותר, בלי כמעט-כפילות של התמונה שנבחרה לפניה */
function vpick(C,prev){const out=[];let last=prev;
 const W2=new Map();for(const c of C){const k=Math.floor(c.t/VWIN);(W2.get(k)||W2.set(k,[]).get(k)).push(c)}
 for(const k of [...W2.keys()].sort((a,b)=>a-b)){const L=W2.get(k).slice().sort((a,b)=>b.s-a.s);
  const c=L.find(x=>!last||vdiff(x.g,last)>=3);if(c){out.push(c);last=c.g}}
 return out}
const vsel=(P,n)=>{if(P.length<=n)return P;if(n<=1)return n?[P[P.length>>1]]:[];return Array.from({length:n},(_,i)=>P[Math.round(i*(P.length-1)/(n-1))])};
const vprog=(i,n,p)=>{W.busy=`מעבד סרטון ${i+1} מתוך ${n}… ${Math.round(p*100)}%`;rerender()};
async function addVids(files){
 const vf=files.filter(f=>!f.type||/^video\//.test(f.type));
 if(!vf.length){W.msg='הקובץ שנבחר אינו סרטון.';return rerender()}
 const n=vf.length,cv=document.createElement('canvas');cv.width=160;W.vcancel=false;W.vid=true;W.msg='';let err=0,long=0,full=0,last=-1,P=[],prev=null;
 try{
  /* שלב 1: ניתוח – רק מערכים קטנים נשמרים, בלי הפריימים עצמם */
  for(let i=0;i<n&&!W.vcancel;i++){let o;
   try{o=await vopen(vf[i])}catch(e){err++;continue}
   try{const v=o.v,dur=Math.min(v.duration,VMAX);if(v.duration>VMAX+.5)long++;cv.height=Math.max(1,Math.round(160*v.videoHeight/v.videoWidth));
    const C=[];for(let t=VSTEP/2,k=0;t<dur&&!W.vcancel;t+=VSTEP,k++){await vseek(v,Math.min(t,Math.max(0,dur-.05)));const r=vgray(v,cv);C.push({t,s:r.s,g:r.g});
     const p=Math.round(k*VSTEP/dur*50);if(p!==last){last=p;vprog(i,n,p/100)}}
    const sel=vpick(C,prev);if(sel.length)prev=sel[sel.length-1].g;for(const c of sel)P.push({i,t:c.t,s:c.s});
    if(!C.length)err++}
   catch(e){err++}finally{o.done()}}
  const room=MAXI-W.imgs.length;if(P.length>room)full=1;P=vsel(P,room);
  /* שלב 2: חילוץ הפריימים שנבחרו ברזולוציה מלאה והעברה דרך small() */
  const by=new Map();P.forEach((x,k)=>{(by.get(x.i)||by.set(x.i,[]).get(x.i)).push(x)});let done=0;
  for(const [i,L] of by){if(W.vcancel)break;let o;try{o=await vopen(vf[i])}catch(e){err++;continue}
   try{const v=o.v,c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;
    for(const x of L){if(W.vcancel)break;await vseek(v,Math.min(x.t,Math.max(0,v.duration-.05)));c.getContext('2d').drawImage(v,0,0);
     const b=await U.blobOf(c,.92);if(!b)throw new Error('x');const p=await small(b);
     if(total()+p.blob.size>MAXB){full=2;break}
     W.imgs.push({blob:p.blob,url:URL.createObjectURL(p.blob),w:p.w,h:p.h,s:'v',lbl:''});W.qid='';done++;vprog(i,n,.5+.5*done/P.length)}
    c.width=c.height=0}
   catch(e){err++}finally{o.done()}
   if(full===2)break}
 }catch(e){err++}
 cv.width=cv.height=0;
 W.vid=false;W.busy='';
 W.msg=(W.vcancel?'העיבוד בוטל. ':'')+(long?'הסרטון ארוך מ-3 דקות, לקחנו רק את 3 הדקות הראשונות. ':'')+(full===1?`אפשר עד ${MAXI} תמונות, בחרנו מהסרטונים בפיזור שווה. `:full===2?'התמונות הגיעו לגודל המרבי. ':'')+(err?VERR:'');W.vcancel=false;rerender()}
CHG.s3wVid=async el=>{const L=[...(el.files||[])];el.value='';if(!L.length||W.busy)return;W.busy='מעבד סרטון…';rerender();await addVids(L)};
ACT.s3wVidX=()=>{W.vcancel=true};
CHG.s3wPick=async el=>{const L=[...(el.files||[])];el.value='';if(!L.length||W.busy)return;await addImgs(L)};
ACT.s3wRm=el=>{const i=+el.dataset.i,x=W.imgs[i];if(!x)return;try{URL.revokeObjectURL(x.url)}catch(e){}W.imgs.splice(i,1);W.qid='';W.msg='';rerender()};
CHG.s3wTex=async el=>{
 const f=el.files&&el.files[0],k=el.dataset.k;el.value='';if(!f||!TK[k]||W.busy)return;
 if(f.type&&!/^image\//.test(f.type)){W.msg='הקובץ שנבחר אינו תמונה.';return rerender()}
 if(navigator.onLine===false){W.msg='אין חיבור לאינטרנט. תמונות הקירות, הרצפה והתקרה נשלחות רק כשיש רשת (אפשר גם להמשיך בלעדיהן).';return rerender()}
 W.msg='';W.busy='שולחים תמונה ל'+TK[k]+'…';rerender();
 try{const p=await texBlob(f),r=await U.fn('s3PutTex',{qid:U.qid(),mapId:mapId(),img:await U.b64(p.blob)});
  if(!r||!r.texId||!r.path)throw new Error('x');
  const old=W.tex[k];if(old&&old.url)try{URL.revokeObjectURL(old.url)}catch(e){}
  W.tex[k]={texId:r.texId,path:r.path,w:+r.w||p.w,h:+r.h||p.h,url:URL.createObjectURL(p.blob)};lsSave();toast('התמונה ל'+TK[k]+' נשמרה')}
 catch(e){W.msg=e&&e.message==='big'?'לא הצלחנו להקטין את התמונה מספיק. נסו לצלם שוב.':U.errText(e,'שליחת התמונה נכשלה. נסו שוב.')}
 W.busy='';rerender()};
ACT.s3wTexRm=el=>{const k=el.dataset.k,t=W.tex[k];if(!t)return;if(t.url)try{URL.revokeObjectURL(t.url)}catch(e){}W.tex[k]=null;lsSave();rerender()};

/* ---------- טיוטה מהשרת (mapDraft) ---------- */
const needs=d=>{try{return d&&d.m&&typeof d.m==='object'}catch(e){return false}};
async function makeDraft(){
 if(W.busy)return;if(!W.imgs.length)return skDraft();
 if(navigator.onLine===false){W.msg='אין חיבור לאינטרנט. יצירת הטיוטה דורשת רשת.';return rerender()}
 const qb=qBuild();if(qb.err){W.msg=qb.err;W.det=1;return rerender()}
 W.msg='';W.step=2;W.busy='מנתחים את התמונות ובונים טיוטה… זה יכול לקחת כדקה או שתיים. אל תסגרו את האפליקציה.';rerender();
 try{
  if(!W.qid)W.qid=U.qid();
  /* פריימים מסרטון קודם (לפי הסדר), ואחריהם התמונות הנפרדות – כך השרת יודע מה רצף (src.vid) */
  const IM=W.imgs.filter(isV).concat(W.imgs.filter(i=>!isV(i))),nv=IM.filter(isV).length,imgs=[];for(const i of IM)imgs.push(await U.b64(i.blob));
  const body={qid:W.qid,br:W.br||U.brSel(),kind:W.kind,imgs};if(qb.info)body.info=qb.info;if(qb.sketch)body.sketch=qb.sketch;
  body.src={vid:nv,ph:IM.length-nv,sk:!!qb.sketch};if(IM.some(i=>i.lbl))body.lbl=IM.map(i=>i.lbl||'');
  let r;try{r=await U.fn('mapDraft',body)}catch(e){
   /* שרת שעוד לא עודכן לא מכיר כמה כניסות/קופות: שולחים שוב רק את הכניסה והקופה הראשונות (כמו פעם) */
   const sk=body.sketch;if(!(sk&&(sk.doors||sk.tills)&&/השרטוט לא תקין|גדולים מדי/.test(String(e&&e.message||''))))throw e;
   delete sk.doors;delete sk.tills;W.qid=U.qid();body.qid=W.qid;r=await U.fn('mapDraft',body)}
  if(r&&r.st==='fail')throw Object.assign(new Error(r.err||'לא הצלחנו לבנות טיוטה מהתמונות.'),{reason:''});
  /* ניסיון חוזר עם אותו מזהה מחזיר dup בלי המפה: קוראים אותה מהטיוטה השמורה */
  if(r&&!needs(r)&&r.draftId){const dd=await U.get('/s3draft/'+r.draftId);if(dd&&dd.m)r=Object.assign({},r,{m:dd.m})}
  if(!r||!needs(r))throw new Error('התשובה מהשרת חסרה. נסו שוב.');
  W.draft={m:r.m,conf:typeof r.conf==='number'?r.conf:null,notes:String(r.notes||''),n:+r.n||W.imgs.length,drop:+r.drop||0,usage:r.usage||null,id:r.draftId||''};
  W.busy='';W.msg='';W.det=0;W.fixTxt='';W.fixQid='';W.fixMsg='';rerender()}
 catch(e){W.busy='';W.step=1;W.msg=draftErr(e);rerender()}}
/* bad-answer: השרת שולח סיבה מפורטת בעברית (נקטעה / בלי חדרים / לא נספרה במכסה) – מציגים אותה במקום הנוסח הכללי.
   בלי הודעה בעברית מהשרת (fnCall מחליף אותה ב"הפעולה נכשלה, נסה שוב") – הנוסח הכללי של S3UI.RS */
const draftErr=e=>e&&!e.offline&&e.reason==='bad-answer'&&/[\u0590-\u05FF]/.test(e.message||'')&&!/^הפעולה נכשלה, נסה שוב$/.test(e.message)?e.message:U.errText(e,'לא הצלחנו לבנות טיוטה. נסו שוב.');
/* תיקונים בכתב (שלב 20ג): mapFix מקבל את הטיוטה הנוכחית + טקסט, ומחזיר טיוטה מתוקנת. בלי הגבלה, לא נספר במכסה החודשית.
   qid חדש לכל ניסיון תיקון חדש; אחרי כשל (למשל רשת) אותו טקסט ואותו qid – ניסיון חוזר בטוח */
const fixErr=e=>e&&!e.offline&&e.reason==='too-big'?'הטיוטה גדולה מדי לתיקון בכתב. עברו עליה בעורך ותקנו שם.':draftErr(e).replace(/^לא הצלחנו לבנות טיוטה\. נסו שוב\.$/,'לא הצלחנו לתקן את הטיוטה. נסו שוב.');
async function fixDraft(){
 const d=W.draft;if(W.busy||!d)return;
 const ta=document.getElementById('s3wFix');if(ta)W.fixTxt=String(ta.value||'').slice(0,1000);
 const t=String(W.fixTxt||'').trim();
 if(t.length<2||t.length>1000){W.fixMsg='כתבו מה לתקן, בין 2 ל-1000 תווים.';return rerender()}
 if(navigator.onLine===false){W.fixMsg='אין חיבור לאינטרנט. תיקון הטיוטה דורש רשת.';return rerender()}
 const qb=qBuild();
 W.fixMsg='';W.busy='מתקנים את הטיוטה… זה יכול לקחת עד דקה או שתיים. אל תסגרו את האפליקציה.';rerender();
 try{
  if(W.fixQid&&W.fixQtxt!==t)W.fixQid='';if(!W.fixQid)W.fixQid=U.qid();W.fixQtxt=t;
  const body={qid:W.fixQid,br:W.br||U.brSel(),kind:W.kind,m:d.m,txt:t};if(qb&&!qb.err&&qb.sketch){body.sk=qb.sketch;if(qb.info)body.info=qb.info}if(d.id)body.from=d.id;
  let r=await U.fn('mapFix',body);
  if(r&&r.st==='fail')throw Object.assign(new Error(r.err||'לא הצלחנו לתקן את הטיוטה.'),{reason:''});
  if(r&&!needs(r)&&r.draftId){const dd=await U.get('/s3draft/'+r.draftId);if(dd&&dd.m)r=Object.assign({},r,{m:dd.m})}
  if(!r||!needs(r))throw new Error('התשובה מהשרת חסרה. נסו שוב.');
  W.draft={m:r.m,conf:typeof r.conf==='number'?r.conf:null,notes:String(r.notes||''),n:d.n,drop:+r.drop||0,usage:null,id:r.draftId||''};
  W.fixTxt='';W.fixQid='';W.fixMsg='';W.busy='';rerender()}
 catch(e){W.busy='';W.fixMsg=fixErr(e);rerender()}}
ACT.s3wFix=()=>fixDraft();
CHG.s3wFixT=el=>{W.fixTxt=String(el.value||'').slice(0,1000)};
/* "בנו טיוטה" בפעם הראשונה – קודם מסך "פרטים על החנות" (לא חובה, אבל מומלץ). משם "בנו טיוטה" שולח */
ACT.s3wDraft=()=>{if(!W.det&&!W.qSeen&&!W.busy){W.det=1;W.qSeen=1;W.msg='';rerender();window.scrollTo(0,0);return}makeDraft()};
ACT.s3wBack1=()=>{W.draft=null;W.step=1;W.msg='';rerender()};
ACT.s3wEdit=()=>{
 const d=W.draft;
 if(d){const m=JSON.parse(JSON.stringify(d.m));if(!Array.isArray(m.uz))m.uz=[];W.step=3;U.edLoad(m,W.kind,Object.assign({n:d.n,conf:d.conf,notes:d.notes,how:{}},d.sk?{sk:1}:{}));W.draft=null;return}
 if(U.E&&U.E.wiz&&U.E.map)go('st3e');else{W.step=1;rerender()}};
ACT.s3wManual=()=>{if(typeof U.openEditor==='function')U.openEditor(W.kind)};
ACT.s3wAgain=()=>ask('להתחיל מחדש? התמונות והטיוטה שבעבודה יימחקו מהמסך הזה (שום דבר לא נשמר בשרת כמפה).',()=>{const k=W.kind;if(U.E&&U.E.wiz){U.E.wiz=null;U.E.key=''}reset(k);rerender()},'כן, התחילו מחדש');

/* ---------- הערות ושאלות (הקמת חנות שלב 2, 17.11.2026) ----------
   אחרי שהטיוטה מוכנה: הערה כללית (עד 1000) והערות לפריטים (עד 300) – לא חובה – נשמרות בשרת (s3SetupNote). "המערכת תשאל" – mapQs (עד 12
   שאלות, עד 3 סבבים, מחוץ למכסה כמו mapFix). תשובות: בחירה ו/או כתיבה (s3SetupAns), ואז mapFix עם ans/notes מחזיר טיוטה מתוקנת, שבה כל שינוי
   מסומן כאזור לא ודאי (uz) – ואי אפשר לשמור לפני שעוברים עליו. הטיוטה שבטלפון נשלחת (m) כשאין עדיין מפה שמורה, כדי לבדוק שהפריט קיים.
   שרת שעוד לא עודכן: "העדכון בשרת עוד לא הותקן" (הפעולות האלה מוסתרות עד אז). כל השמות כאן עם התחילית s3nt (בלי התנגשות עם שמות קיימים). */
const NT_OLD='העדכון בשרת עוד לא הותקן, ולכן הערות ושאלות עוד לא זמינות. אפשר להמשיך בלעדיהן.';
const ntErr=(e,d)=>e&&!e.offline&&!e.reason&&/^הפעולה נכשלה/.test(e.message||'')?NT_OLD:U.errText(e,d);
const NFX={gon:'גונדולה',wall:'מדף קיר',fridge:'מקרר',table:'שולחן/משטח',stand:'סטנד/מתלה',bin:'סל/מתקן'};
const ntLive=(m,k)=>(m&&Array.isArray(m[k])?m[k]:[]).filter(o=>o&&o.del!==1&&typeof o.id==='string');
/* הפריטים שאפשר לכתוב עליהם הערה: חדרים, גופים, דלתות, קופות (מקטע – בבחירה שנייה אחרי הגוף) */
function ntItems(m){const L=[],rn={};
 ntLive(m,'rooms').forEach((r,i)=>{rn[r.id]=r.name||('חדר '+(i+1));L.push([r.id,'חדר: '+rn[r.id]])});
 ntLive(m,'fx').forEach(f=>L.push([f.id,(NFX[f.k]||'גוף')+(f.num?' '+f.num:'')+(f.name?' – '+f.name:'')+(rn[f.room]?' ('+rn[f.room]+')':'')]));
 ntLive(m,'doors').forEach((d,i)=>L.push([d.id,(d.k==='ent'?'כניסה':'דלת')+' '+(i+1)]));
 ntLive(m,'syms').filter(y=>y.k==='cash').forEach((y,i)=>L.push([y.id,'קופה '+(i+1)]));
 return L}
const ntLbl=(m,id)=>{const b=/^(f[0-9]+)-([ab])-([0-9]+)$/.exec(id||''),x=ntItems(m).find(i=>i[0]===(b?b[1]:id));return x?(b?`מקטע ${b[3]} בצד ${b[2]==='a'?'א':'ב'} של ${x[1]}`:x[1]):id};
/* ההערות לפי מצב מול הטיוטה הנוכחית (S3NK – אותה בדיקה כמו בשרת): ok = על הפריט שבמזהה; re = "לשיוך מחדש" – הטיוטה מוספרה מחדש
   והפריט במזהה הזה כבר אחר (או לא קיים). הערה כזו לא מוצגת על הפריט: אפשר לשייך אותה לפריט שנבחר או למחוק */
/* ok לפי המזהה הנוכחי של הפריט (ההערה הולכת אחרי הפריט הפיזי לפי g – אותה התאמה כמו בשרת), עם from = המזהה שבו היא שמורה */
const ntSplit=(N,m)=>{const K=window.S3NK,I=K?K.itemsOf(m):null,G=K?K.geoIndex(m):null,ok={},re={};
 for(const id of Object.keys(N.D).sort()){const n=N.D[id];if(!n||!n.t)continue;const x=G?K.noteTo(n,id,G):{st:'ok',to:id};
  if(x.st==='ok'&&!ok[x.to])ok[x.to]=Object.assign({},n,{from:id});else re[id]=n}
 return{ok,re,I,G}};
/* אחרי כתיבה: ההערה של הפריט נשמרת במזהה הנוכחי שלו (כמו הסנכרון בשרת) */
const ntPut=(N,S0,id,t)=>{const o=S0.ok[id];if(o&&o.from!==id)delete N.D[o.from];if(!t){delete N.D[id];return}const K=window.S3NK,g=S0.G&&K?K.gOf(S0.G,id):null;N.D[id]=Object.assign({t,d:S0.I?S0.I.get(id):'',on:'draft'},g?{g}:{})};
const NT0=()=>({g:'',gs:'',t:null,item:'',bay:'',D:{},qs:[],qr:0,ans:{},busy:'',msg:'',ok:'',old:0,ld:0,qq:'',qa:'',qf:''});
async function ntLoad(){const N=W.nt;if(!N||N.ld)return;N.ld=1;
 try{const sd=await U.get('/s3setup/'+mapId());if(sd){N.g=N.gs=String(sd.gnote||'');N.qr=+sd.qr||0;N.qs=Array.isArray(sd.qs)?sd.qs:[];
   for(const q of N.qs)if(q&&q.a)N.ans[q.id]={c:Array.isArray(q.a.c)?q.a.c.slice():[],x:String(q.a.x||'')};
   let tok='';for(let i=0;i<5;i++){const j=await fsx('/s3setup/'+mapId()+'/n?pageSize=300'+(tok?'&pageToken='+encodeURIComponent(tok):''));
    for(const d of (j&&j.documents)||[]){const f=U.dec(d)||{};if(typeof f.t==='string'&&f.t)N.D[d.name.split('/').pop()]={t:f.t,d:String(f.d||''),on:f.on,re:f.re,g:f.g}}tok=j&&j.nextPageToken;if(!tok)break}}}
 catch(e){if(e&&e.code===403)N.old=1}
 if(cur().v==='st3w')rerender()}
const ntBody=o=>Object.assign({mapId:mapId(),m:W.draft&&W.draft.m},o);
/* ערכי השדות נקראים לפני הציור מחדש (busy), כדי שלא יאבדו */
const ntGrab=()=>{const N=W.nt;if(!N)return;const g=document.getElementById('s3ntG');if(g)N.g=String(g.value||'').slice(0,1000);const t=document.getElementById('s3ntT');if(t)N.t=String(t.value||'').slice(0,300);
 for(const q of N.qs){const el=document.getElementById('s3ntX_'+q.id);if(el){const a=N.ans[q.id]||(N.ans[q.id]={c:[],x:''});a.x=String(el.value||'').slice(0,200)}}};
const ntRun=async(busy,f)=>{const N=W.nt;if(!N||N.busy||W.busy)return;ntGrab();if(navigator.onLine===false){N.msg='אין חיבור לאינטרנט. נסו שוב כשיש רשת.';return rerender()}
 N.msg='';N.ok='';N.busy=busy;rerender();try{await f(N)}catch(e){N.msg=ntErr(e,'הפעולה נכשלה. נסו שוב.')}N.busy='';rerender()};
ACT.s3ntSaveG=()=>ntRun('שומרים…',async N=>{const t=N.g.replace(/\s+/g,' ').trim();
 await U.fn('s3SetupNote',ntBody({itemId:'',t,qid:U.qid()}));N.g=N.gs=t;N.ok=t?'ההערה הכללית נשמרה':'ההערה הכללית נמחקה'});
ACT.s3ntSaveI=()=>ntRun('שומרים…',async N=>{const id=N.bay||N.item;if(!id){N.msg='בחרו פריט.';return}
 const S0=ntSplit(N,W.draft.m);if(S0.re[id]){N.msg='לפריט הזה יש הערה שמחכה לשיוך (למטה). שייכו או מחקו אותה קודם.';return}
 const t=String(N.t==null?((S0.ok[id]||{}).t||''):N.t).replace(/\s+/g,' ').trim().slice(0,300);
 await U.fn('s3SetupNote',ntBody({itemId:id,t,qid:U.qid()}));ntPut(N,S0,id,t);N.t=null;N.ok=t?'ההערה נשמרה':'ההערה נמחקה'});
/* הערה לשיוך מחדש: לפריט שנבחר בשדה "הערה לפריט" (from), או מחיקה (ניקוי הטקסט) */
ACT.s3ntRe=el=>{const from=el.dataset.id||'';ntRun('משייכים…',async N=>{const n=N.D[from],to=N.bay||N.item;if(!n)return;if(!to){N.msg='בחרו קודם פריט בשדה "הערה לפריט", ואז "שייכו לפריט שנבחר".';return}
 const r=await U.fn('s3SetupNote',ntBody({itemId:to,from,t:n.t,qid:U.qid()}));const S0=ntSplit(N,W.draft.m);ntPut(N,S0,to,String(r&&r.t||n.t));delete N.D[from];N.ok='ההערה שויכה לפריט שנבחר'})};
ACT.s3ntDel=el=>{const id=el.dataset.id||'';ntRun('מוחקים…',async N=>{if(!N.D[id])return;await U.fn('s3SetupNote',ntBody({itemId:id,t:'',qid:U.qid()}));delete N.D[id];N.ok='ההערה נמחקה'})};
ACT.s3ntEdit=el=>{const N=W.nt,id=el.dataset.id||'';if(!N)return;N.t=null;const b=/^(f[0-9]+)-[ab]-[0-9]+$/.exec(id);N.item=b?b[1]:id;N.bay=b?id:'';N.msg='';N.ok='';rerender()};
CHG.s3ntItem=el=>{const N=W.nt;if(!N)return;N.item=String(el.value||'');N.bay='';N.t=null;rerender()};
CHG.s3ntBay=el=>{const N=W.nt;if(!N)return;N.bay=String(el.value||'');N.t=null;rerender()};
CHG.s3ntG=el=>{if(W.nt)W.nt.g=String(el.value||'').slice(0,1000)};
ACT.s3ntAsk=()=>ntRun('המערכת עוברת על הטיוטה ועל ההערות ומכינה שאלות… זה יכול לקחת עד דקה.',async N=>{
 if(!N.qq)N.qq=U.qid();const r=await U.fn('mapQs',ntBody({qid:N.qq}));N.qq='';
 N.qs=Array.isArray(r&&r.qs)?r.qs:[];N.qr=+(r&&r.qr)||N.qr+1;N.ans={};N.ok=N.qs.length?`יש ${N.qs.length} שאלות. ענו על מה שאפשר (אפשר גם לכתוב), ואז "שמרו ותקנו".`:'המערכת לא מצאה מה לשאול – הטיוטה ברורה לה.'});
CHG.s3ntC=el=>{const N=W.nt;if(!N)return;const q=N.qs.find(x=>x.id===el.dataset.q);if(!q)return;const a=N.ans[q.id]||(N.ans[q.id]={c:[],x:''}),i=+el.dataset.i;
 if(q.multi){a.c=a.c.filter(v=>v!==i);if(el.checked)a.c.push(i);a.c.sort()}else a.c=el.checked?[i]:[]};
CHG.s3ntX=el=>{const N=W.nt;if(!N)return;const a=N.ans[el.dataset.q]||(N.ans[el.dataset.q]={c:[],x:''});a.x=String(el.value||'').slice(0,200)};
/* mapFix עם התשובות/ההערות השמורות: הטיוטה המתוקנת מחליפה את הנוכחית (כמו תיקון בכתב), והשינויים מסומנים כאזורים לבדיקה */
async function ntFix(N,o){const d=W.draft;if(!d)return;
 if(!N.qf)N.qf=U.qid();const body=Object.assign({qid:N.qf,br:W.br||U.brSel(),kind:W.kind,m:d.m},o);if(d.id)body.from=d.id;
 let r=await U.fn('mapFix',body);N.qf='';
 if(r&&r.st==='fail')throw Object.assign(new Error(r.err||'לא הצלחנו לתקן את הטיוטה.'),{reason:''});
 if(r&&!needs(r)&&r.draftId){const dd=await U.get('/s3draft/'+r.draftId);if(dd&&dd.m)r=Object.assign({},r,{m:dd.m})}
 if(!r||!needs(r))throw new Error('התשובה מהשרת חסרה. נסו שוב.');
 W.draft={m:r.m,conf:typeof r.conf==='number'?r.conf:null,notes:String(r.notes||''),n:d.n,drop:+r.drop||0,usage:null,id:r.draftId||''};
 const z=zs(r.m).length;N.ok=`הטיוטה תוקנה לפי ${o.ans?'התשובות וההערות':'ההערות'}.${z?` ${z} שינויים מסומנים כאזורים לבדיקה – עברו עליהם לפני השמירה.`:''}`}
ACT.s3ntAns=()=>ntRun('שומרים את התשובות ומתקנים את הטיוטה… זה יכול לקחת עד דקה או שתיים.',async N=>{
 const ans=N.qs.filter(q=>{const a=N.ans[q.id];return a&&(a.c.length||a.x.trim())}).map(q=>({id:q.id,c:N.ans[q.id].c,x:N.ans[q.id].x.trim()}));
 if(!ans.length){N.msg='ענו לפחות על שאלה אחת (בחירה או כתיבה).';return}
 if(!N.qa)N.qa=U.qid();await U.fn('s3SetupAns',{mapId:mapId(),qid:N.qa,ans,qr:N.qr});N.qa='';
 for(const q of N.qs)if(N.ans[q.id]&&ans.some(a=>a.id===q.id))q.a=1;
 await ntFix(N,{ans:true,notes:true})});
ACT.s3ntFix=()=>ntRun('מתקנים את הטיוטה לפי ההערות… זה יכול לקחת עד דקה או שתיים.',async N=>{
 if(!N.gs&&!Object.keys(N.D).length){N.msg='עוד אין הערות שמורות. כתבו הערה ושמרו אותה קודם.';return}await ntFix(N,{notes:true})});
function ntBox(){
 if(!W.draft)return '';if(!W.nt||W.nt.mid!==mapId()){W.nt=Object.assign(NT0(),{mid:mapId()})}
 const N=W.nt,m=W.draft.m,dis=N.busy||W.busy?' disabled':'';ntLoad();const SP=ntSplit(N,m);
 if(N.old)return `<div class="s3info" id="s3nt"><b>הערות ושאלות</b><br><small>${esc2(NT_OLD)}</small></div>`;
 const I=ntItems(m),f=ntLive(m,'fx').find(x=>x.id===N.item),nb=f&&+f.bays>0?Math.min(30,+f.bays):0,sel=N.bay||N.item;
 const opt=(v,c,l)=>`<option value="${esc2(v)}"${v===c?' selected':''}>${esc2(l)}</option>`;
 let h=`<div class="s3info" id="s3nt"><b>הערות ושאלות (לא חובה)</b><br><small>כתבו מה שחשוב לדעת על החנות, כללי או על פריט מסוים. המערכת יכולה לשאול שאלות על מה שלא ברור, ולתקן את הטיוטה לפי התשובות. לא נספר במכסה.</small>`;
 h+=`<label class="f" style="display:block;margin-top:8px"><span>הערה כללית (עד 1000 תווים)</span><textarea id="s3ntG" data-c="s3ntG" rows="3" maxlength="1000" style="width:100%"${dis}>${esc2(N.g)}</textarea></label><div class="row s3row"><button class="btn s g" data-a="s3ntSaveG"${dis}>שמרו הערה כללית</button></div>`;
 h+=`<div class="row" style="gap:6px;flex-wrap:wrap;margin-top:8px"><label class="f" style="flex:1;min-width:150px;margin:0"><span>הערה לפריט</span><select data-c="s3ntItem"${dis}>${opt('',N.item,'בחרו פריט…')}${I.map(i=>opt(i[0],N.item,i[1])).join('')}</select></label>`;
 if(nb){let o=opt('',N.bay,'כל הגוף');for(const sd of (f.sides===2?['a','b']:['a']))for(let n=1;n<=nb;n++)o+=opt(`${f.id}-${sd}-${n}`,N.bay,`מקטע ${n}${f.sides===2?' צד '+(sd==='a'?'א':'ב'):''}`);h+=`<label class="f" style="flex:1;min-width:110px;margin:0"><span>מקטע</span><select data-c="s3ntBay"${dis}>${o}</select></label>`}
 h+=`</div>`;
 if(sel)h+=`<textarea id="s3ntT" rows="2" maxlength="300" style="width:100%;margin-top:6px" aria-label="הערה ל${esc2(ntLbl(m,sel))} (עד 300 תווים)"${dis}>${esc2(N.t!=null?N.t:(SP.ok[sel]||{}).t||'')}</textarea><div class="row s3row"><button class="btn s g" data-a="s3ntSaveI"${dis}>שמרו הערה לפריט</button></div>`;
 const ks=Object.keys(SP.ok),kr=Object.keys(SP.re);
 if(kr.length)h+=`<div class="s3info s3err" id="s3ntRe" style="margin-top:8px"><b>${kr.length} ${kr.length===1?'הערה מחכה':'הערות מחכות'} לשיוך מחדש</b><br><small>הטיוטה השתנתה, והפריט שעליו נכתבה ההערה כבר לא נמצא באותו מקום ברשימה. בחרו את הפריט הנכון בשדה "הערה לפריט" ולחצו "שייכו", או מחקו. הערה כזו לא תועבר לעובדים עד שתשויך.</small>
  <ul style="margin:6px 0 0;padding-inline-start:18px">${kr.map(k=>`<li style="margin:4px 0"><b>נכתבה על: ${esc2(SP.re[k].d||k)}</b><br>${esc2(SP.re[k].t)}<div class="row s3row"><button class="btn s" data-a="s3ntRe" data-id="${esc2(k)}"${dis||!sel?' disabled':''}>שייכו לפריט שנבחר</button><button class="btn s g" data-a="s3ntDel" data-id="${esc2(k)}"${dis}>מחקו</button></div></li>`).join('')}</ul></div>`;
 if(ks.length)h+=`<ul class="s3ntL" style="margin:8px 0 0;padding-inline-start:18px">${ks.map(k=>`<li style="margin:4px 0"><b>${esc2(ntLbl(m,k))}:</b> ${esc2(SP.ok[k].t)} <button class="btn s g" style="min-height:44px" data-a="s3ntEdit" data-id="${esc2(k)}"${dis}>עריכה</button></li>`).join('')}</ul>`;
 /* שאלות */
 h+=`<div style="margin-top:12px"><b>שאלות מהמערכת</b> <small class="note">(סבב ${Math.min(N.qr,3)} מתוך 3)</small></div>`;
 if(N.qs.length){h+=N.qs.map((q,qi)=>{const a=N.ans[q.id]||{c:[],x:''},ty=q.multi?'checkbox':'radio';
   return `<fieldset class="s3ntQ" style="border:1px solid var(--line);border-radius:var(--r-m,10px);margin:8px 0;padding:8px"><legend style="padding:0 4px">${qi+1}. ${esc2(q.t)}${q.ref?` <small class="note">(${esc2(ntLbl(m,q.ref))})</small>`:''}</legend>
    ${(q.o||[]).map((o,i)=>`<label style="display:flex;gap:8px;align-items:center;min-height:44px"><input type="${ty}" name="s3ntQ_${esc2(q.id)}" data-c="s3ntC" data-q="${esc2(q.id)}" data-i="${i}"${a.c.includes(i)?' checked':''}${dis}> ${esc2(o)}</label>`).join('')}
    <input id="s3ntX_${esc2(q.id)}" data-c="s3ntX" data-q="${esc2(q.id)}" maxlength="200" placeholder="או כתבו תשובה משלכם" aria-label="תשובה בכתב לשאלה ${qi+1}" value="${esc2(a.x)}" style="width:100%;min-height:44px"${dis}></fieldset>`}).join('');
  h+=`<div class="row s3row"><button class="btn" data-a="s3ntAns"${dis}>שמרו תשובות ותקנו את הטיוטה</button></div>`}
 h+=`<div class="row s3row"><button class="btn g" data-a="s3ntAsk"${dis||N.qr>=3?' disabled':''}>${N.qr?'שאלו שוב':'המערכת תשאל שאלות'}</button><button class="btn g" data-a="s3ntFix"${dis}>תקנו לפי ההערות</button></div>`;
 if(N.qr>=3)h+=`<p class="note s3note" style="margin:4px 0"><small>היו כבר 3 סבבי שאלות. אפשר להמשיך לתקן בכתב או בעורך.</small></p>`;
 if(N.busy)h+=`<div class="s3info" role="status">${esc2(N.busy)}</div>`;
 if(N.ok)h+=`<div class="s3info" role="status">${esc2(N.ok)}</div>`;
 if(N.msg)h+=`<div class="ban s3warn" role="alert">${esc2(N.msg)}</div>`;
 return h+`</div>`}

/* ---------- קביעת סבב (שלב 5) ---------- */
async function loadStaff(){
 if(W.staff||W.busy==='staff')return;W.busy='staff';
 try{const j=await fsx('/staff?pageSize=300');W.staff=((j&&j.documents)||[]).map(d=>{const f=U.dec(d)||{};return{uid:d.name.split('/').pop(),name:String(f.name||f.email||'עובד'),active:f.active===true,br:Array.isArray(f.br)?f.br:null}}).filter(s=>s.active&&(!s.br||!s.br.length||s.br.includes(W.br||U.brSel())))}
 catch(e){W.staff=[];W.staffErr=e&&e.offline?'אין חיבור לאינטרנט':'לא הצלחנו לטעון את רשימת העובדים'}
 W.busy='';if(cur().v==='st3w')rerender()}
const rnd=()=>{let s='';for(let i=0;i<10;i++)s+='0123456789abcdefghijklmnopqrstuvwxyz'[Math.random()*36|0];return 'r'+s};
const S1=v=>({stringValue:String(v)}),I1=v=>({integerValue:String(Math.round(+v||0))});
CHG.s3wR=el=>{const r=W.rule,f=el.dataset.f;if(!r)return;if(f==='name')r.name=String(el.value||'').slice(0,40);else if(f==='k'&&['week','days','month','manual'].includes(el.value))r.k=el.value;
 else if(f==='dow')r.dow=Math.min(6,Math.max(0,+el.value|0));else if(f==='n')r.n=Math.min(90,Math.max(1,+el.value|0||7));else if(f==='dom')r.dom=Math.min(28,Math.max(1,+el.value|0||1));else if(f==='due')r.due=Math.min(14,Math.max(1,+el.value|0||2));else if(f==='u')r.u=String(el.value||'');
 if(f==='k')rerender()};
ACT.s3wMake=async()=>{
 const r=W.rule;if(!r||W.busy||!U.isMgr())return;const name=String(r.name||'').trim();
 if(!name){W.msg='לסבב צריך שם.';return rerender()}if(!r.u){W.msg='בחרו עובד לסבב.';return rerender()}
 const ff={k:S1(r.k)};if(r.k==='week')ff.dow=I1(r.dow);else if(r.k==='month')ff.dom=I1(r.dom);else if(r.k==='days')ff.n=I1(r.n);
 const id=rnd(),br=W.br||U.brSel();
 const fields={br:S1(br),map:S1('s-'+br),name:S1(name),f:{mapValue:{fields:ff}},asg:{arrayValue:{values:[{mapValue:{fields:{u:S1(r.u),z:{arrayValue:{}}}}}]}},due:I1(r.due),on:{booleanValue:true},upd:I1(Date.now()),by:S1(SY.uid)};
 W.busy='שומרים את הסבב…';W.msg='';rerender();
 try{await fsx('/sround?documentId='+id,{method:'POST',body:JSON.stringify({fields})});W.rid=id;W.busy='';toast('הסבב נקבע');U.drop();U.load(true);rerender()}
 catch(e){W.busy='';W.msg=e&&e.offline?'אין חיבור לאינטרנט. נסו שוב כשיש רשת.':(e&&e.code===403?'אין לכם הרשאה להגדיר סבב.':'לא הצלחנו לשמור את הסבב. נסו שוב.');rerender()}};
ACT.s3wNow=async()=>{if(!W.rid||W.busy)return;W.busy='פותחים סבב…';rerender();
 try{await U.fn('s3Run',{rid:W.rid});W.runMsg='הסבב נפתח. העובדים קיבלו התראה.'}catch(e){W.runMsg=U.errText(e,'לא הצלחנו לפתוח את הסבב עכשיו. הוא ייפתח במועד שנקבע.')}
 W.busy='';rerender()};
ACT.s3wEnd=()=>{const k=W.kind;reset(k);W.own='';U.drop();go('st3')};

/* ---------- פרטים על החנות: שאלון + סקיצה (החלטת המשתמש 15.11.2026) ----------
   שתי דרכים, לבחירת בעל החנות: (א) "אצייר סקיצה" – מציירים פינות חדרים ושורות, ואז שאלות קצרות על השרטוט (סוג כל חדר, סוג כל שורה,
   כניסה וקופה בהקשה, ורוחב אמיתי אם לא הוזנו מידות). (ב) "אענה על שאלות" – שאלון, ואז שרטוט שנבנה אוטומטית מהתשובות ונפתח לעריכה ידנית.
   השאלות הן כללים באפליקציה (בלי AI ובלי מכסה). שתי הדרכים שולחות לשרת אותו מבנה: info (מידות בס"מ, חדרים, שורות, צדדים, הערה)
   ו-sketch (חדרים ושורות בס"מ במערכת הצירים של המפה + סוגים, כניסה וקופה). הכול לא חובה, ונשמר בטלפון (lsSave, גרסה 2). */
const VF=2000,GRID=50,SIDE_L={u:'למעלה',d:'למטה',r:'ימין',l:'שמאל'},RT_L={s:'חנות',w:'מחסן',x:'חדר נוסף'},RK_L={gon:'גונדולה דו-צדדית',wall:'מדף קיר',fridge:'מקררים'};
const G3=()=>window.S3G;
const qNum=(s,a,b)=>{s=String(s==null?'':s).trim().replace(',','.');if(!s)return null;const n=+s;return Number.isFinite(n)&&n>=a&&n<=b?n:NaN};
const qInt=(s,a,b)=>{const n=qNum(s,a,b);return n===null?null:Number.isInteger(n)?n:NaN};
/* המידות האמיתיות (ס"מ) או null */
const realDims=()=>{const w=qNum(W.q.w,2,100),l=qNum(W.q.l,2,100);return w>0&&l>0?{w:Math.round(w*100),l:Math.round(l*100)}:null};
/* המסגרת של השרטוט: המידות האמיתיות, ובלעדיהן מסגרת זמנית של 20×20 (רק בדרך א, עד שעונים על הרוחב האמיתי) */
const frame=()=>realDims()||{w:VF,l:VF,tmp:1};
const skHas=()=>{const k=W.sk;return !!(k.rooms.length||k.cur.length||k.rows.length||k.doors.length||k.tills.length)};
const cl=(v,a,b)=>Math.min(b,Math.max(a,v));
const snap=v=>Math.round(v/GRID)*GRID;
/* w/l = גודל המסגרת שבה השרטוט היה, כדי שביטול אחרי שינוי מידות יחזיר אותו בקנה המידה הנכון */
const skSnap=()=>{const k=W.sk;return JSON.stringify({rooms:k.rooms,cur:k.cur,rows:k.rows,rt:k.rt,rk:k.rk,doors:k.doors,tills:k.tills,w:k.w,l:k.l,qw:W.q.w,ql:W.q.l})};
/* הנקודה הרחוקה ביותר בשרטוט (לבדיקה אם משהו יצא מחוץ למסגרת) */
/* כל הנקודות בשרטוט (פינות, שורות, כניסות, קופות) – לבדיקות ולהזזה/מתיחה של הכול יחד */
const skAll=()=>{const k=W.sk;return [].concat(...k.rooms,k.cur,...k.rows,...k.doors.map(d=>[d.x,d.y]),...k.tills.map(t=>[t.x,t.y]))};
const skMapAll=P=>{const k=W.sk,O=o=>{const q=P([o.x,o.y]);return Object.assign({},o,{x:q[0],y:q[1]})};k.rooms=k.rooms.map(P);k.cur=P(k.cur);k.rows=k.rows.map(P);k.doors=k.doors.map(O);k.tills=k.tills.map(O)};
const skMax=()=>{const A=skAll();let x=0,y=0;for(let i=0;i<A.length;i+=2){x=Math.max(x,A[i]);y=Math.max(y,A[i+1])}return{x,y}};
const skPush=()=>{const k=W.sk;k.undo=k.undo||[];k.undo.push(skSnap());if(k.undo.length>40)k.undo.shift()};
const skDone=()=>{const F=frame(),k=W.sk;k.w=F.w;k.l=F.l;W.qid='';lsSave();rerender()};
const fit=(L,n,d)=>{L=Array.isArray(L)?L.slice(0,n):[];while(L.length<n)L.push(d);return L};
const skNorm=()=>{const k=W.sk;k.rt=fit(k.rt,k.rooms.length,'x');if(k.rooms.length&&!k.rt.includes('s'))k.rt[0]='s';k.rk=fit(k.rk,k.rows.length,'gon')};
/* שינוי מסגרת (המידות השתנו): כל נקודה נמתחת יחסית */
function skRescale(F){const k=W.sk;if(!k.w||!k.l||(k.w===F.w&&k.l===F.l)){k.w=F.w;k.l=F.l;return}
 const sx=F.w/k.w,sy=F.l/k.l,X=v=>cl(Math.round(v*sx),0,F.w),Y=v=>cl(Math.round(v*sy),0,F.l),P=p=>p.map((v,i)=>i%2?Y(v):X(v));
 skMapAll(P);k.pend=null;k.cpend=null;k.w=F.w;k.l=F.l}
/* דרך א: רוחב אמיתי לשרטוט שצויר במסגרת הזמנית – לפי רוחב השרטוט עצמו (מהפינה השמאלית לימנית) */
function skReal(m){const k=W.sk,A=skAll();if(A.length<2)return 'קודם שרטטו משהו.';
 let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;for(let i=0;i<A.length;i+=2){x0=Math.min(x0,A[i]);x1=Math.max(x1,A[i]);y0=Math.min(y0,A[i+1]);y1=Math.max(y1,A[i+1])}
 if(x1-x0<GRID)return 'השרטוט צר מדי כדי לקבוע לפיו רוחב.';
 const s=m*100/(x1-x0),L=Math.round((y1-y0)*s);if(L<200||L>10000)return 'לפי הרוחב הזה האורך יוצא מחוץ לטווח (2 עד 100 מטר). בדקו את הרוחב.';
 skPush();const P=p=>p.map((v,i)=>i%2?cl(Math.round((v-y0)*s),0,L):cl(Math.round((v-x0)*s),0,Math.round(m*100)));
 skMapAll(P);
 W.q.w=String(m);W.q.l=String(Math.round(L/10)/10);return ''}
/* דרך ב: שרטוט מהתשובות. חדר ראשון = חנות (כ-70% כשיש עוד חדרים, בצד של הכניסה), שאר החדרים בשווה בצד השני;
   השורות במרווחים שווים בחנות, לאורך הצלע הארוכה שלה, עם מעבר של 1.5 מטר בקצוות; כניסה וקופה באמצע הצד שנבחר */
function skGen(){const D=realDims();if(!D)return 'כדי לבנות שרטוט צריך רוחב ואורך.';
 const nr=qInt(W.q.rooms,1,6)||1,nw=qInt(W.q.rows,0,30)||0,ent=W.q.ent,W0=D.w,L0=D.l,alongY=L0>=W0;
 const rooms=[],rt=[];const span=alongY?L0:W0,main=nr>1?snap(span*.7):span,rest=nr>1?(span-main)/(nr-1):0;
 const front=alongY?ent!=='u':ent!=='l';/* החנות בצד הכניסה: למטה/ימין כברירת מחדל */
 const cuts=[];if(front){let a=0;for(let i=1;i<nr;i++){cuts.push([Math.round(a),Math.round(a+rest)]);a+=rest}cuts.unshift([span-main,span])}else{cuts.push([0,main]);let a=main;for(let i=1;i<nr;i++){cuts.push([Math.round(a),Math.round(i===nr-1?span:a+rest)]);a+=rest}}
 cuts.forEach(([a,b],i)=>{rooms.push(alongY?[0,a,W0,a,W0,b,0,b]:[a,0,b,0,b,L0,a,L0]);rt.push(i?'x':'s')});
 const r=rooms[0],rx0=r[0],ry0=r[1],rx1=r[4],ry1=r[5],rw=rx1-rx0,rl=ry1-ry0,lng=rl>=rw,M=150,rows=[];
 const lenS=lng?rl:rw,crS=lng?rw:rl,m=Math.min(M,Math.max(0,(lenS-100)/2));
 for(let i=0;i<nw;i++){const c=Math.round((i+1)*crS/(nw+1));rows.push(lng?[rx0+c,ry0+m,rx0+c,ry1-m]:[rx0+m,ry0+c,rx1-m,ry0+c])}
 const side=(sd,f)=>sd==='u'?[Math.round(W0*f),0]:sd==='d'?[Math.round(W0*f),L0]:sd==='l'?[0,Math.round(L0*f)]:sd==='r'?[W0,Math.round(L0*f)]:null;
 skPush();const k=W.sk;k.rooms=rooms;k.rt=rt;k.rows=rows;k.rk=rows.map(()=>'gon');k.cur=[];k.pend=null;k.sel=null;
 const pe=side(ent,.5),pc=W.q.cash?side(W.q.cash,W.q.cash===ent?.25:.5):null;k.doors=pe?[doorNew(pe[0],pe[1])]:[];k.tills=pc?[{x:pc[0],y:pc[1],w:120,d:60,a:SIDE_L[W.q.cash]&&(W.q.cash==='l'||W.q.cash==='r')?90:0}]:[];k.mode='sel';k.gen=1;return ''}
/* מה נשלח לשרת. מחזיר {info, sketch} או {err} */
function qBuild(){const q=W.q,k=W.sk,info={};
 const w=qNum(q.w,2,100),l=qNum(q.l,2,100);
 if(Number.isNaN(w)||Number.isNaN(l))return{err:'הרוחב והאורך צריכים להיות בין 2 ל-100 מטר.'};
 if((w===null)!==(l===null)&&!(k&&skHas()))return{err:'מלאו גם רוחב וגם אורך, או השאירו את שניהם ריקים.'};
 if(w&&l){info.w=Math.round(w*100);info.l=Math.round(l*100)}
 const nr=qInt(q.rooms,1,6),nw=qInt(q.rows,0,30);
 if(Number.isNaN(nr))return{err:'מספר החדרים צריך להיות בין 1 ל-6.'};if(Number.isNaN(nw))return{err:'מספר השורות צריך להיות בין 0 ל-30.'};
 if(nr)info.rooms=nr;if(nw!==null)info.rows=nw;
 for(const s of ['ent','cash'])if(SIDE_L[q[s]])info[s]=q[s];
 const nt=String(q.note||'').replace(/\s+/g,' ').trim().slice(0,200);if(nt)info.note=nt;
 let sketch=null;
 if(skHas()){
  if(!info.w)return{err:'כדי לשלוח את השרטוט צריך את הרוחב האמיתי של החנות (בשאלות שמתחת לשרטוט). אפשר גם למחוק את השרטוט.'};
  if(k.cur.length)return{err:'החדר האחרון בשרטוט לא נסגר. הקישו "סגרו חדר" או "ביטול אחרון".'};
  skNorm();sketch={rooms:k.rooms.map(p=>p.slice()),rows:k.rows.map(r=>r.slice())};
  if(k.rooms.length)sketch.rt=k.rt.slice();if(k.rows.length)sketch.rk=k.rk.slice();const DD=k.doors.map(d=>doorOut(d)),TT=k.tills.map(t=>({x:Math.round(t.x),y:Math.round(t.y),w:t.w,d:t.d,a:t.a}));
  if(DD.length){sketch.doors=DD;sketch.ent=[DD[0].x,DD[0].y]}if(TT.length){sketch.tills=TT;sketch.cash=[TT[0].x,TT[0].y]}
  if(k.rooms.length&&!info.rooms)info.rooms=k.rooms.length;if(!info.rows&&info.rows!==0&&k.rows.length)info.rows=k.rows.length}
 return{info:Object.keys(info).length?info:null,sketch}}
/* ---------- סקיצה ← מפה בלי AI (הקמת חנות שלב 1) ----------
   אותו מבנה כמו טיוטה מהשרת (cleanDraft ואחריו shapeDraft ב-lib/store3d-ai.js ו-lib/store3d-draftin.js), כדי שתעבור את אותה בדיקה בשמירה.
   חדרים: מהסקיצה, ובלעדיה מלבן אחד לפי הרוחב והאורך. שורה ← גוף (סוג מהתשובות, מקטע לכל מטר, 5 קומות). כניסות ← דלתות ent, קופות ← סמלי cash.
   בלי uz: שום דבר כאן לא "ניחוש" של AI. qb = תוצאת qBuild(). מחזיר את המפה, או null כשאין חדר. */
const RTN={s:'אולם מכירות',w:'מחסן',x:''};
function skToMap(qb,kind){
 const G=G3(),info=qb&&qb.info||{},sk=qb&&qb.sketch,W0=info.w,L0=info.l,ok=v=>Number.isFinite(v)&&v>=0&&v<=10000,I=v=>Math.round(v);
 const deg=v=>((Math.round(v)%360)+360)%360,clI=(v,a,b)=>Math.min(b,Math.max(a,Math.round(v)));
 let rooms=[];
 if(sk&&sk.rooms&&sk.rooms.length)rooms=sk.rooms.map((p,i)=>({id:'r'+(i+1),name:RTN[(sk.rt||[])[i]]||(i?'חדר '+(i+1):kind==='w'?'מחסן':'אולם מכירות'),p:p.map(I),h:300}));
 else if(W0>0&&L0>0)rooms=[{id:'r1',name:kind==='w'?'מחסן':'אולם מכירות',p:[0,0,W0,0,W0,L0,0,L0],h:300}];
 rooms=rooms.filter(r=>r.p.every(ok)&&(!G||!G.polyValid||G.polyValid(r.p).ok)).map((r,i)=>Object.assign(r,{id:'r'+(i+1)}));
 if(!rooms.length)return null;
 const roomAt=(x,y)=>(rooms.find(r=>G&&G.pointInPoly&&G.pointInPoly(x,y,r.p))||rooms[0]).id,MB=G&&G.MAX_BAYS||2000;
 const fx=[];let bays=0;
 ((sk&&sk.rows)||[]).forEach((s,ri)=>{if(fx.length>=400||!s.every(ok))return;
  const len=clI(Math.hypot(s[2]-s[0],s[3]-s[1]),30,2000),nb=clI(len/100,1,30),k=((sk.rk||[])[ri])||'gon',sides=k==='gon'?2:1;
  if(bays+sides*nb>MB)return;bays+=sides*nb;
  const x=I((s[0]+s[2])/2),y=I((s[1]+s[3])/2),f={id:'f'+(fx.length+1),k,x,y,w:len,d:k==='gon'?90:k==='fridge'?80:40,h:180,a:deg(Math.atan2(s[3]-s[1],s[2]-s[0])*180/Math.PI),sides,bays:nb,lvl:5,hi:false,room:roomAt(x,y),num:fx.length+1};
  if(k==='fridge')f.glass=true;fx.push(f)});
 const doors=((sk&&sk.doors)||[]).slice(0,40).map((d,i)=>({id:'d'+(i+1),x:I(d.x),y:I(d.y),w:clI(d.w,60,500),a:deg(d.a),k:'ent',sw:d.sw===-1?-1:1,hg:d.hg===-1?-1:1}));
 const syms=((sk&&sk.tills)||[]).slice(0,40).map((t,i)=>({id:'y'+(i+1),k:'cash',x:I(t.x),y:I(t.y),a:deg(t.a),w:clI(t.w,30,1000),d:clI(t.d,30,1000)}));
 const m={br:W.br||U.brSel(),kind:kind==='w'?'w':'s',name:kind==='w'?'מחסן (טיוטה)':'חנות (טיוטה)',seq:fx.length,grid:50,numDir:'rtl',rooms,walls:[],cols:[],doors,fx,syms,uz:[],src:'draft'};
 if(doors.length)m.ent='d1';
 return m}
/* "בנו טיוטה" בלי תמונות: מהסקיצה או מהמידות, בטלפון, בלי AI ובלי מכסה */
function skDraft(){
 const qb=qBuild();if(qb.err){W.msg=qb.err;W.det=1;return rerender()}
 const m=skToMap(qb,W.kind);
 if(!m){W.msg='אין ממה לבנות מפה: ציירו סקיצה (או מלאו רוחב ואורך), או צלמו את החנות.';W.det=1;W.qSeen=1;return rerender()}
 W.draft={m,conf:null,notes:'',n:0,drop:0,usage:null,id:'',sk:1};W.step=2;W.msg='';W.det=0;W.fixTxt='';W.fixQid='';W.fixMsg='';rerender()}
U.skToMap=skToMap;
const qSum=()=>{const D=realDims(),k=W.sk,t=[];if(D)t.push(`רוחב ${+(D.w/100).toFixed(1)} מ', אורך ${+(D.l/100).toFixed(1)} מ'`);
 const nr=qInt(W.q.rooms,1,6);if(nr)t.push(nr+' חדרים');const nw=qInt(W.q.rows,0,30);if(nw!=null&&!Number.isNaN(nw))t.push(nw+' שורות');
 if(k.rooms.length||k.rows.length)t.push(`שרטוט: ${k.rooms.length} חדרים, ${k.rows.length} שורות`);return t.join(' · ')};

/* --- אירועים --- */
ACT.s3wDet=()=>{W.det=1;W.qSeen=1;W.msg='';rerender();window.scrollTo(0,0)};
ACT.s3wDetX=()=>{W.det=0;W.msg='';rerender()};
ACT.s3wPath=el=>{const p=el.dataset.p==='a'?'a':el.dataset.p==='b'?'b':'';W.q.path=p;if(p==='a'&&!skHas())W.sk.mode='room';W.msg='';lsSave();rerender()};
CHG.s3wQ=el=>{const f=el.dataset.f;if(!(f in W.q)||f==='path')return;const v=String(el.value||'').slice(0,f==='note'?200:12);W.q[f]=v;W.msg='';
 if((f==='w'||f==='l')&&skHas()){const D=realDims();if(D){skPush();skRescale(D)}}
 if(f==='w'||f==='l'){const n=qNum(v,2,100);if(Number.isNaN(n))W.msg=(f==='w'?'הרוחב':'האורך')+' צריך להיות בין 2 ל-100 מטר.'}
 if(f==='rooms'&&Number.isNaN(qInt(v,1,6)))W.msg='מספר החדרים צריך להיות בין 1 ל-6.';
 if(f==='rows'&&Number.isNaN(qInt(v,0,30)))W.msg='מספר השורות צריך להיות בין 0 ל-30.';
 W.qid='';lsSave();if(f!=='note')rerender()};
CHG.s3wRw=el=>{const m=qNum(el.value,2,100);if(!(m>0)){W.msg='הרוחב צריך להיות בין 2 ל-100 מטר.';return rerender()}const e=skReal(m);W.msg=e;if(!e){const k=W.sk,F=frame();k.w=F.w;k.l=F.l;toast('השרטוט הותאם למידות')}W.qid='';lsSave();rerender()};
CHG.s3wRt=el=>{const i=+el.dataset.i;if(!RT_L[el.value]||!(i>=0&&i<W.sk.rooms.length))return;skNorm();W.sk.rt[i]=el.value;W.qid='';lsSave();drawSk()};
/* שדות של כניסה/קופה ברשימה שמתחת לשרטוט */
CHG.s3wDo=el=>{const d=W.sk.doors[+el.dataset.i],f=el.dataset.f;if(!d)return;let v=el.value;
 if(f==='w'){const m=qNum(v,.6,5);if(!(m>0)){W.msg='רוחב הכניסה צריך להיות בין 0.6 ל-5 מטר.';return rerender()}v=Math.round(m*100)}else if(f==='io'){if(!['in','out'].includes(v))return}else if(f==='dh'){if(!['r','l'].includes(v))return}else return;
 skPush();d[f]=v;W.msg='';skDone()};
CHG.s3wTi=el=>{const t=W.sk.tills[+el.dataset.i],f=el.dataset.f;if(!t)return;let v=el.value;
 if(f==='w'||f==='d'){const m=qNum(v,.3,10);if(!(m>0)){W.msg='גודל הקופה צריך להיות בין 0.3 ל-10 מטר.';return rerender()}v=Math.round(m*100)}else if(f==='a'){v=v==='90'?90:0}else return;
 skPush();t[f]=v;W.msg='';skDone()};
ACT.s3wDoDel=el=>{const k=W.sk,i=+el.dataset.i,L=el.dataset.t==='k'?k.tills:k.doors;if(!L[i])return;skPush();L.splice(i,1);k.sel=null;hiO={t:'',i:-1};skDone()};
/* ברירות מחדל לכניסה/קופה חדשה */
CHG.s3wDf=el=>{const f=el.dataset.f,v=String(el.value||'').slice(0,6);if(f in DF)DF[f]=v;else if(f==='tw')TD.w=v;else if(f==='td')TD.d=v};
ACT.s3wTh=el=>{TD.how=el.dataset.h==='box'?'box':'one';W.sk.cpend=null;rerender()};
CHG.s3wRk=el=>{const i=+el.dataset.i;if(!RK_L[el.value]||!(i>=0&&i<W.sk.rows.length))return;skNorm();W.sk.rk[i]=el.value;W.qid='';lsSave();drawSk()};
ACT.s3wGen=()=>{if(skHas()&&!W.sk.gen&&!W.sk.genOk){return ask('לבנות שרטוט חדש מהתשובות? השרטוט הנוכחי יוחלף (אפשר לבטל ב"ביטול אחרון").',()=>{W.sk.genOk=1;ACT.s3wGen()},'כן, בנו')}
 const e=skGen();W.msg=e;if(!e){W.sk.genOk=0;const F=frame();W.sk.w=F.w;W.sk.l=F.l;toast('השרטוט נבנה מהתשובות. אפשר לערוך אותו')}W.qid='';lsSave();rerender()};
ACT.s3wSkM=el=>{const m=el.dataset.m;if(!['room','row','sel','ent','cash'].includes(m))return;const k=W.sk;k.mode=m;k.pend=null;k.cpend=null;k.sel=null;W.msg='';rerender()};
/* הקשה על השרטוט – לפי המצב */
const near=(F,px,x,y)=>{const k=W.sk,tol=26/px,c=[];/* פינות, קצוות שורות */
 k.rooms.forEach((p,r)=>{for(let i=0;i<p.length;i+=2)c.push({t:'c',r,i,d:Math.hypot(p[i]-x,p[i+1]-y)})});
 for(let i=0;i<k.cur.length;i+=2)c.push({t:'c',r:-1,i,d:Math.hypot(k.cur[i]-x,k.cur[i+1]-y)});
 k.rows.forEach((s,r)=>{c.push({t:'w',r,i:0,d:Math.hypot(s[0]-x,s[1]-y)});c.push({t:'w',r,i:2,d:Math.hypot(s[2]-x,s[3]-y)})});
 k.doors.forEach((o,r)=>c.push({t:'e',r,i:0,d:Math.hypot(o.x-x,o.y-y)}));k.tills.forEach((o,r)=>c.push({t:'k',r,i:0,d:Math.hypot(o.x-x,o.y-y)}));
 c.sort((a,b)=>a.d-b.d);return c[0]&&c[0].d<=tol?c[0]:null};
/* --- כניסות: הדלת יושבת על הקיר הקרוב (קיר של חדר, או דופן המסגרת) --- */
const DF={w:'1',io:'in',dh:'r'},TD={how:'one',w:'1.2',d:'0.6'};/* ברירות מחדל לכניסה/קופה חדשה (נבחרות מעל השרטוט) */
const doorNew=(x,y)=>({x,y,w:Math.round((qNum(DF.w,.6,5)||1)*100),io:DF.io,dh:DF.dh});
/* הקיר הקרוב לנקודה: {x,y (על הקיר), ux,uy (כיוון הקיר), nx,ny (ניצב פנימה), dd (מרחק)} */
function wallAt(x,y){const k=W.sk,F=frame();let b=null;
 const seg=(x1,y1,x2,y2,cx,cy)=>{const L2=(x2-x1)**2+(y2-y1)**2;if(!L2)return;const t=cl(((x-x1)*(x2-x1)+(y-y1)*(y2-y1))/L2,0,1),px=x1+t*(x2-x1),py=y1+t*(y2-y1),dd=Math.hypot(x-px,y-py);
  if(b&&dd>=b.dd)return;const L=Math.sqrt(L2),ux=(x2-x1)/L,uy=(y2-y1)/L;let nx=-uy,ny=ux;if(!cx(px+nx*20,py+ny*20)){nx=-nx;ny=-ny}b={x:px,y:py,ux,uy,nx,ny,dd}};
 const G=G3();k.rooms.forEach(p=>{const ins=(qx,qy)=>G&&G.pointInPoly?G.pointInPoly(qx,qy,p):false;const n=p.length/2;for(let i=0;i<n;i++){const j=(i+1)%n;seg(p[2*i],p[2*i+1],p[2*j],p[2*j+1],ins)}});
 if(!b||b.dd>150){const fin=(qx,qy)=>qx>0&&qy>0&&qx<F.w&&qy<F.l;const b0=b;b=null;seg(0,0,F.w,0,fin);seg(F.w,0,F.w,F.l,fin);seg(F.w,F.l,0,F.l,fin);seg(0,F.l,0,0,fin);if(b0&&b0.dd<=b.dd)b=b0}
 return b}
/* הקשה לכניסה: נצמדת לקיר אם הוא עד 1.5 מ' מהנקודה */
const wallSnap=(x,y)=>{const F=frame(),w=wallAt(x,y);return w&&w.dd<=150?[cl(Math.round(w.x),0,F.w),cl(Math.round(w.y),0,F.l)]:[cl(snap(x),0,F.w),cl(snap(y),0,F.l)]};
/* גאומטריה לציור ולשליחה: מרכז, כיוון הקיר u, צד הפתיחה s, כיוון הציר h (מבחוץ מול הדלת: "ימין" הוא ימין של מי שמסתכל פנימה) */
function doorGeo(d){const w=wallAt(d.x,d.y)||{ux:1,uy:0,nx:0,ny:-1},vx=w.nx,vy=w.ny,rx=-vy,ry=vx,sg=d.io==='out'?-1:1,hg=d.dh==='l'?-1:1;
 return{x:d.x,y:d.y,ux:w.ux,uy:w.uy,sx:vx*sg,sy:vy*sg,hx:rx*hg,hy:ry*hg}}
/* לשרת/למפה: a = זווית הקיר במעלות; sw = צד הפתיחה ביחס לניצב (−sin a, cos a); hg = הציר בקצה בכיוון a (1) או ההפוך (−1) */
function doorOut(d){const g=doorGeo(d),a=((Math.round(Math.atan2(g.uy,g.ux)*180/Math.PI)%360)+360)%360,r=a*Math.PI/180,px=-Math.sin(r),py=Math.cos(r);
 return{x:Math.round(d.x),y:Math.round(d.y),w:d.w,a,sw:g.sx*px+g.sy*py>=0?1:-1,hg:g.hx*Math.cos(r)+g.hy*Math.sin(r)>=0?1:-1}}
/* הנקודה שנבחרה [x,y] – פינה / קצה שורה / כניסה / קופה */
const selPt=s=>{const k=W.sk;if(!s)return null;if(s.t==='e'||s.t==='k'){const O=(s.t==='e'?k.doors:k.tills)[s.r];return O?[O.x,O.y]:null}const L=s.t==='w'?k.rows[s.r]:s.r<0?k.cur:k.rooms[s.r];return L?[L[s.i],L[s.i+1]]:null};
/* שם הנקודה שנבחרה, למשוב: "פינה 2 של חדר 3" / "קצה של שורה 4" */
const selName=s=>s.t==='e'?`כניסה ${s.r+1}`:s.t==='k'?`קופה ${s.r+1}`:s.t==='w'?`קצה של שורה ${s.r+1}`:s.r<0?`פינה ${s.i/2+1} של החדר הפתוח`:`פינה ${s.i/2+1} של חדר ${s.r+1}`;
const okPoly=p=>{const g=G3();return !g||!g.polyValid||g.polyValid(p).ok};
ACT.s3wSkT=(el,e)=>{const k=W.sk,F=frame(),R=el.getBoundingClientRect();if(!R.width||!e)return;if(Date.now()-zDragT<400)return;zvFit(F);const px=R.width/F.w*ZV.z;
 const rx=cl(ZV.ox+(e.clientX-R.left)/px,0,F.w),ry=cl(ZV.oy+(e.clientY-R.top)/px,0,F.l),x=cl(snap(rx),0,F.w),y=cl(snap(ry),0,F.l);W.msg='';
 if(k.mode==='room'){if(k.rooms.length>=6){W.msg='אפשר עד 6 חדרים.';return rerender()}if(k.cur.length>=40){W.msg='לחדר יכולות להיות עד 20 פינות. סגרו את החדר.';return rerender()}
  const n=k.cur.length;if(n&&k.cur[n-2]===x&&k.cur[n-1]===y)return;skPush();k.cur.push(x,y)}
 else if(k.mode==='row'){if(!k.pend){if(k.rows.length>=30){W.msg='אפשר עד 30 שורות.';return rerender()}k.pend=[x,y];return rerender()}
  if(Math.hypot(x-k.pend[0],y-k.pend[1])<GRID){W.msg='השורה קצרה מדי. הקישו על נקודת הסוף שלה.';return rerender()}skPush();skNorm();k.rows.push([k.pend[0],k.pend[1],x,y]);k.rk.push('gon');k.pend=null}
 else if(k.mode==='ent'){if(k.doors.length>=40){W.msg='אפשר עד 40 כניסות.';return rerender()}skPush();const q=wallSnap(rx,ry);k.doors.push(doorNew(q[0],q[1]));toast(`כניסה ${k.doors.length} נוספה`)}
 else if(k.mode==='cash'){if(k.tills.length>=40){W.msg='אפשר עד 40 קופות.';return rerender()}
  if(TD.how==='box'){if(!k.cpend){k.cpend=[x,y];return rerender()}const w=Math.abs(x-k.cpend[0]),d=Math.abs(y-k.cpend[1]);
   if(w<30||d<30){W.msg='הקופה קטנה מדי (לפחות 30 ס"מ לכל צד). הקישו על הפינה הנגדית.';return rerender()}
   skPush();k.tills.push({x:Math.round((x+k.cpend[0])/2),y:Math.round((y+k.cpend[1])/2),w:Math.min(1000,w),d:Math.min(1000,d),a:0});k.cpend=null}
  else{const w=Math.round((qNum(TD.w,.3,10)||1.2)*100),d=Math.round((qNum(TD.d,.3,10)||.6)*100);skPush();k.tills.push({x,y,w,d,a:0})}
  toast(`קופה ${k.tills.length} נוספה`)}
 else{const h=near(F,px,rx,ry);
  if(h&&!(k.sel&&k.sel.t===h.t&&k.sel.r===h.r&&k.sel.i===h.i)){k.sel={t:h.t,r:h.r,i:h.i};return rerender()}
  if(!k.sel){W.msg='הקישו על פינה או על קצה של שורה כדי לבחור אותם.';return rerender()}
  const s=k.sel;
  if(s.t==='e'||s.t==='k'){const O=s.t==='e'?k.doors[s.r]:k.tills[s.r];if(!O)return;const q=s.t==='e'?wallSnap(rx,ry):[x,y];if(O.x===q[0]&&O.y===q[1])return;skPush();O.x=q[0];O.y=q[1];toast(selName(s)+' הוזזה');return skDone()}
  const L=s.t==='w'?k.rows[s.r]:s.r<0?k.cur:k.rooms[s.r];if(!L)return;
  const o=[L[s.i],L[s.i+1]];if(o[0]===x&&o[1]===y)return;skPush();L[s.i]=x;L[s.i+1]=y;
  const bad=s.t==='c'&&s.r>=0&&!okPoly(L),short=s.t==='w'&&Math.hypot(L[2]-L[0],L[3]-L[1])<GRID;
  if(bad||short){L[s.i]=o[0];L[s.i+1]=o[1];k.undo.pop();W.msg=bad?'אי אפשר להזיז לשם: קירות החדר יחצו זה את זה.':'השורה תהיה קצרה מדי.';return rerender()}
  toast(selName(s)+' הוזז'+(s.t==='w'?'':'ה'))}
 skDone()};
ACT.s3wSkClose=()=>{const k=W.sk;if(k.cur.length<6){W.msg='לחדר צריך לפחות 3 פינות.';return rerender()}if(!okPoly(k.cur)){W.msg='החדר לא תקין: קירות שחוצים זה את זה, או שטח קטן ממטר מרובע. בטלו פינה ונסו שוב.';return rerender()}
 skPush();skNorm();k.rooms.push(k.cur);k.rt.push(k.rooms.length===1?'s':'x');k.cur=[];skDone()};
ACT.s3wSkDel=()=>{const k=W.sk,s=k.sel;if(!s)return;skPush();
 if(s.t==='e'||s.t==='k')(s.t==='e'?k.doors:k.tills).splice(s.r,1);
 else if(s.t==='w'){skNorm();k.rows.splice(s.r,1);k.rk.splice(s.r,1)}
 else{const L=s.r<0?k.cur:k.rooms[s.r];if(!L)return;
  if(s.r>=0&&L.length<=6){skNorm();k.rooms.splice(s.r,1);k.rt.splice(s.r,1);toast('החדר נמחק (היו לו 3 פינות)')}
  else{const c=L.slice();c.splice(s.i,2);if(s.r>=0&&!okPoly(c)){k.undo.pop();W.msg='אי אפשר למחוק את הפינה הזו: החדר יהיה לא תקין.';return rerender()}if(s.r<0)k.cur=c;else k.rooms[s.r]=c}}
 k.sel=null;skDone()};
ACT.s3wSkIns=()=>{const k=W.sk,s=k.sel;if(!s||s.t!=='c'||s.r<0)return;const L=k.rooms[s.r];if(!L||L.length>=40){W.msg='לחדר יכולות להיות עד 20 פינות.';return rerender()}
 const j=(s.i+2)%L.length,x=snap((L[s.i]+L[j])/2),y=snap((L[s.i+1]+L[j+1])/2),c=L.slice();c.splice(s.i+2,0,x,y);
 if(!okPoly(c)){W.msg='אין מקום לפינה נוספת כאן. הזיזו קודם את הפינות.';return rerender()}skPush();k.rooms[s.r]=c;k.sel={t:'c',r:s.r,i:s.i+2};skDone()};
ACT.s3wSkUndo=()=>{const k=W.sk;if(k.pend||k.cpend){k.pend=null;k.cpend=null;return rerender()}const u=k.undo&&k.undo.pop();if(!u)return;
 try{const o=JSON.parse(u);Object.assign(k,{rooms:o.rooms||[],cur:o.cur||[],rows:o.rows||[],rt:o.rt||[],rk:o.rk||[],doors:dLoad(o.doors),tills:tLoad(o.tills)});
  if(typeof o.qw==='string'&&typeof o.ql==='string'){W.q.w=o.qw;W.q.l=o.ql}
  if(o.w>0&&o.l>0){k.w=o.w;k.l=o.l;skRescale(frame())}}catch(e){}k.sel=null;skDone()};
/* הגדלת המסגרת לצד אחד (בחירת המשתמש: כפתור, לא אוטומטי). שמאל/למעלה = כל הנקודות זזות כדי שהשרטוט יישאר במקומו. עד 100 מ' לצד */
let growOpen=0,growM='2';ACT.s3wGrowT=()=>{growOpen=growOpen?0:1;rerender()};
CHG.s3wGm=el=>{growM=String(el.value||'').slice(0,6)};
ACT.s3wGrow=el=>{const sd=el.dataset.s,F=frame(),k=W.sk;if(F.tmp||!['r','l','u','d'].includes(sd))return;const m=qNum(growM,.5,98);
 if(!(m>0)){W.msg='כמה מטרים להוסיף? מספר בין 0.5 ל-98.';return rerender()}const d=snap(m*100),hz=sd==='r'||sd==='l',nw=hz?F.w+d:F.w,nl=hz?F.l:F.l+d;
 if(nw>10000||nl>10000){W.msg=`אי אפשר: ${hz?'הרוחב':'האורך'} יהיה יותר מ-100 מטר.`;return rerender()}
 skPush();const dx=sd==='l'?d:0,dy=sd==='u'?d:0;if(dx||dy){skMapAll(p=>p.map((v,i)=>v+(i%2?dy:dx)));k.pend=null;k.cpend=null}
 W.q.w=String(+(nw/100).toFixed(2));W.q.l=String(+(nl/100).toFixed(2));k.w=nw;k.l=nl;W.msg='';toast(`המסגרת הוגדלה ב-${+(d/100).toFixed(1)} מ' ${({u:'למעלה',d:'למטה',r:'ימינה',l:'שמאלה'})[sd]}`);skDone()};
/* שרטוט שיצא מחוץ למסגרת (נוצר בביטול בגרסה קודמת): מקטינים הכול באותו יחס עד שהכול נכנס */
ACT.s3wSkFit=()=>{const k=W.sk,F=frame(),m=skMax();if(m.x<=F.w&&m.y<=F.l)return;const r=Math.min(F.w/m.x,F.l/m.y);skPush();
 skMapAll(p=>p.map((v,i)=>cl(Math.round(v*r),0,i%2?F.l:F.w)));k.pend=null;k.cpend=null;k.sel=null;
 ZV.z=1;toast('השרטוט הוקטן ונכנס למסגרת');skDone()};
ACT.s3wSkClr=()=>ask('למחוק את כל השרטוט?',()=>{const k=W.sk;skPush();Object.assign(k,{rooms:[],cur:[],rows:[],rt:[],rk:[],doors:[],tills:[],pend:null,cpend:null,sel:null,gen:0});skDone()},'כן, מחקו');

/* --- ציור השרטוט (canvas; צבעים מהטוקנים של הערכה) --- */
/* הגדלה/הקטנה של השרטוט (תצוגה בלבד, לא נשמר): z = פי כמה, ox/oy = הפינה השמאלית העליונה של מה שרואים (ס"מ) */
const ZV={z:1,ox:0,oy:0},ZL=[1,1.5,2,3,4];
const zvFit=F=>{if(!(ZV.z>1)){ZV.z=1;ZV.ox=ZV.oy=0;return}ZV.ox=cl(ZV.ox,0,F.w-F.w/ZV.z);ZV.oy=cl(ZV.oy,0,F.l-F.l/ZV.z)};
ACT.s3wZm=el=>{const F=frame(),d=el.dataset.z,i=ZL.indexOf(ZV.z),k=W.sk;
 const cx=ZV.ox+F.w/ZV.z/2,cy=ZV.oy+F.l/ZV.z/2,s=k.sel,L=selPt(s);
 const z=d==='fit'?1:ZL[cl((i<0?0:i)+(d==='in'?1:-1),0,ZL.length-1)];
 const px=L?L[0]:cx,py=L?L[1]:cy;ZV.z=z;ZV.ox=px-F.w/z/2;ZV.oy=py-F.l/z/2;zvFit(F);rerender()};
/* גרירה באצבע כשהשרטוט מוגדל = הזזת התצוגה. אחרי גרירה ההקשה לא נספרת */
let zDrag=null,zDragT=0;
document.addEventListener('pointerdown',e=>{if(!(ZV.z>1)||!e.target||e.target.id!=='s3wSk')return;zDrag={x:e.clientX,y:e.clientY,ox:ZV.ox,oy:ZV.oy,m:0,w:e.target.getBoundingClientRect().width}});
document.addEventListener('pointermove',e=>{const d=zDrag;if(!d)return;const dx=e.clientX-d.x,dy=e.clientY-d.y;if(!d.m&&Math.hypot(dx,dy)<10)return;d.m=1;
 const F=frame(),u=F.w/ZV.z/d.w;ZV.ox=d.ox-dx*u;ZV.oy=d.oy-dy*u;zvFit(F);drawSk()});
const zEnd=()=>{if(zDrag&&zDrag.m)zDragT=Date.now();zDrag=null};
document.addEventListener('pointerup',zEnd);document.addEventListener('pointercancel',zEnd);
/* השורה שהבחירה שלה פתוחה עכשיו ("שורה N – מה יש בה?") – מודגשת בשרטוט. -1 = אין */
let hiRow=-1;
let hiO={t:'',i:-1};/* כניסה/קופה שהשדות שלה פתוחים */
document.addEventListener('focusin',e=>{const el=e.target,c=el&&el.dataset&&el.dataset.c;if(c==='s3wRk'){hiRow=+el.dataset.i;drawSk()}else if(c==='s3wDo'||c==='s3wTi'){hiO={t:c==='s3wDo'?'e':'k',i:+el.dataset.i};drawSk()}});
document.addEventListener('focusout',e=>{const el=e.target,c=el&&el.dataset&&el.dataset.c;if(c==='s3wRk'&&hiRow>=0){hiRow=-1;drawSk()}else if((c==='s3wDo'||c==='s3wTi')&&hiO.t){hiO={t:'',i:-1};drawSk()}});
function drawSk(){const cv=document.getElementById('s3wSk');if(!cv)return;const F=frame(),k=W.sk;
 const pe=cv.parentElement,ps=pe&&getComputedStyle(pe),box=pe?Math.max(160,pe.clientWidth-parseFloat(ps.paddingLeft||0)-parseFloat(ps.paddingRight||0)-2):300;let cw=box,ch=cw*F.l/F.w;const mx=Math.max(220,Math.min(520,innerHeight*.6));if(ch>mx){ch=mx;cw=ch*F.w/F.l}
 cw=Math.floor(cw);ch=Math.floor(ch);const dpr=window.devicePixelRatio||1;cv.style.width=cw+'px';cv.style.height=ch+'px';cv.width=Math.round(cw*dpr);cv.height=Math.round(ch*dpr);
 const c=cv.getContext('2d');if(!c)return;c.setTransform(dpr,0,0,dpr,0,0);const cs=getComputedStyle(cv),col=n=>cs.getPropertyValue('--'+n).trim()||'gray';
 zvFit(F);const K=cw/F.w*ZV.z,P=v=>v*K,acc=col('acc'),ink=col('ink'),line=col('line'),mut=col('mut');
 c.clearRect(0,0,cw,ch);c.translate(-P(ZV.ox),-P(ZV.oy));cw=P(F.w);ch=P(F.l);/* מכאן cw/ch = כל השרטוט (גם החלק שמחוץ לתצוגה) */
 c.lineWidth=1;c.strokeStyle=line;const st=Math.max(F.w,F.l)>3000?500:100;
 for(let x=0;x<=F.w;x+=st){c.beginPath();c.moveTo(P(x)+.5,0);c.lineTo(P(x)+.5,ch);c.stroke()}for(let y=0;y<=F.l;y+=st){c.beginPath();c.moveTo(0,P(y)+.5);c.lineTo(cw,P(y)+.5);c.stroke()}
 const poly=(p,close)=>{c.beginPath();for(let i=0;i<p.length;i+=2)(i?c.lineTo:c.moveTo).call(c,P(p[i]),P(p[i+1]));if(close)c.closePath()};
 const dot=(x,y,r,fill)=>{c.beginPath();c.arc(P(x),P(y),r,0,7);c.fillStyle=fill;c.fill()};
 c.font='600 12px system-ui,sans-serif';c.textAlign='center';c.textBaseline='middle';
 skNorm();
 k.rooms.forEach((p,r)=>{poly(p,1);c.globalAlpha=.14;c.fillStyle=acc;c.fill();c.globalAlpha=1;c.lineWidth=2.5;c.strokeStyle=acc;c.stroke();
  let sx=0,sy=0;for(let i=0;i<p.length;i+=2){sx+=p[i];sy+=p[i+1]}const n=p.length/2;c.fillStyle=ink;c.fillText(`${r+1}. ${RT_L[k.rt[r]]||''}`,P(sx/n),P(sy/n))});
 if(k.cur.length){poly(k.cur,0);c.setLineDash([6,4]);c.lineWidth=2;c.strokeStyle=acc;c.stroke();c.setLineDash([]);for(let i=0;i<k.cur.length;i+=2)dot(k.cur[i],k.cur[i+1],5,acc)}
 c.lineCap='round';k.rows.forEach((s,r)=>{c.beginPath();c.moveTo(P(s[0]),P(s[1]));c.lineTo(P(s[2]),P(s[3]));c.lineWidth=k.rk[r]==='gon'?7:4;c.strokeStyle=ink;c.globalAlpha=k.rk[r]==='fridge'?.55:1;c.stroke();c.globalAlpha=1});c.lineCap='butt';
 /* מספר ליד כל שורה (כמו בשאלות למטה) + הדגשת השורה שהבחירה שלה פתוחה. תצוגה בלבד, לא נשמר */
 if(hiRow>=0&&k.rows[hiRow]){const s=k.rows[hiRow];c.lineCap='round';c.beginPath();c.moveTo(P(s[0]),P(s[1]));c.lineTo(P(s[2]),P(s[3]));c.lineWidth=14;c.strokeStyle=acc;c.globalAlpha=.45;c.stroke();c.globalAlpha=1;c.lineWidth=k.rk[hiRow]==='gon'?7:4;c.strokeStyle=acc;c.stroke();c.lineCap='butt'}
 c.font='700 11px system-ui,sans-serif';k.rows.forEach((s,r)=>{const x0=P(s[0]),y0=P(s[1]),x1=P(s[2]),y1=P(s[3]),L=Math.hypot(x1-x0,y1-y0)||1,o=13,bx=cl((x0+x1)/2-(y1-y0)/L*o,10,cw-10),by=cl((y0+y1)/2+(x1-x0)/L*o,10,ch-10),on=r===hiRow;
  c.beginPath();c.arc(bx,by,9,0,7);c.fillStyle=on?acc:ink;c.fill();c.lineWidth=1.5;c.strokeStyle=col('bg');c.stroke();c.fillStyle=col('bg');c.fillText(String(r+1),bx,by+.5)});
 c.font='600 12px system-ui,sans-serif';
 if(k.pend)dot(k.pend[0],k.pend[1],6,ink);
 const mark=(pt,t)=>{if(!pt)return;dot(pt[0],pt[1],9,acc);c.fillStyle=ink;const y=P(pt[1])>ch-20?P(pt[1])-16:P(pt[1])+16;c.fillText(t,cl(P(pt[0]),24,cw-24),y)};
 /* כניסות: הדלת על הקיר + קשת הפתיחה; קופות: מלבן בגודל האמיתי. מודגשת = הפריט שהשדות שלו פתוחים ברשימה */
 const inc=col('inc')||acc,bg=col('bg');
 const badge=(x,y,t,on)=>{c.beginPath();c.arc(x,y,10,0,7);c.fillStyle=on?acc:inc;c.fill();c.lineWidth=1.5;c.strokeStyle=bg;c.stroke();c.fillStyle=bg;c.font='700 10px system-ui,sans-serif';c.fillText(t,x,y+.5);c.font='600 12px system-ui,sans-serif'};
 k.doors.forEach((d,r)=>{const g=doorGeo(d),h=d.w/2,on=hiO.t==='e'&&hiO.i===r,col2=on?acc:inc,Hx=g.x+g.hx*h,Hy=g.y+g.hy*h;
  c.lineCap='round';c.beginPath();c.moveTo(P(g.x-g.ux*h),P(g.y-g.uy*h));c.lineTo(P(g.x+g.ux*h),P(g.y+g.uy*h));c.lineWidth=on?9:6;c.strokeStyle=col2;c.stroke();c.lineCap='butt';
  c.beginPath();c.moveTo(P(Hx),P(Hy));c.lineTo(P(Hx+g.sx*d.w),P(Hy+g.sy*d.w));c.lineWidth=2;c.stroke();
  c.beginPath();for(let t=0;t<=12;t++){const a=t/12*Math.PI/2,x=Hx+d.w*(-g.hx*Math.cos(a)+g.sx*Math.sin(a)),y=Hy+d.w*(-g.hy*Math.cos(a)+g.sy*Math.sin(a));t?c.lineTo(P(x),P(y)):c.moveTo(P(x),P(y))}c.setLineDash([4,3]);c.lineWidth=1.5;c.stroke();c.setLineDash([]);
  badge(P(g.x)-g.sx*16,P(g.y)-g.sy*16,'כ'+(r+1),on)});
 k.tills.forEach((t,r)=>{const on=hiO.t==='k'&&hiO.i===r,w=t.a===90?t.d:t.w,d=t.a===90?t.w:t.d;c.beginPath();c.rect(P(t.x-w/2),P(t.y-d/2),P(w),P(d));c.globalAlpha=on?.45:.25;c.fillStyle=acc;c.fill();c.globalAlpha=1;c.lineWidth=on?3:2;c.strokeStyle=acc;c.stroke();
  c.fillStyle=ink;c.font='700 11px system-ui,sans-serif';c.fillText('ק'+(r+1),P(t.x),P(t.y));c.font='600 12px system-ui,sans-serif'});
 if(k.cpend)dot(k.cpend[0],k.cpend[1],6,acc);
 if(k.mode==='sel'){c.lineWidth=1.5;c.strokeStyle=mut;k.rooms.forEach(p=>{for(let i=0;i<p.length;i+=2){c.beginPath();c.arc(P(p[i]),P(p[i+1]),5,0,7);c.stroke()}});k.rows.forEach(s=>{for(const i of [0,2]){c.beginPath();c.arc(P(s[i]),P(s[i+1]),5,0,7);c.stroke()}})}
 const s=k.sel;if(s){const L=selPt(s);if(L){c.beginPath();c.arc(P(L[0]),P(L[1]),11,0,7);c.lineWidth=3;c.strokeStyle=acc;c.stroke()}}}

/* --- המסך "פרטים על החנות" --- */
const opt=(v,cur,l)=>`<option value="${v}"${v===cur?' selected':''}>${l}</option>`;
const numIn=(f,l,a,b,step,mode)=>`<label class="f" style="flex:1;min-width:130px;margin-bottom:8px"><span>${l}</span><input type="number" inputmode="${mode||'numeric'}" min="${a}" max="${b}" step="${step||1}" data-c="s3wQ" data-f="${f}" value="${esc2(W.q[f])}"></label>`;
const sideSel=(f,l)=>`<label class="f" style="flex:1;min-width:130px;margin-bottom:8px"><span>${l}</span><select data-c="s3wQ" data-f="${f}">${opt('',W.q[f],'לא יודע')}${['u','d','r','l'].map(s=>opt(s,W.q[f],SIDE_L[s])).join('')}</select></label>`;
function qForm(){return `<div class="row" style="gap:8px">${numIn('w','רוחב (ימין↔שמאל), מטרים',2,100,.5,'decimal')}${numIn('l','אורך (למעלה↕למטה), מטרים',2,100,.5,'decimal')}</div>
 <div class="row" style="gap:8px">${numIn('rooms','מספר חדרים (1–6)',1,6)}${numIn('rows','מספר שורות / מעברים (0–30)',0,30)}</div>
 <div class="row" style="gap:8px">${sideSel('ent','איפה הכניסה')}${sideSel('cash','איפה הקופה')}</div>
 <label class="f" style="display:block;margin-bottom:8px"><span>הערה קצרה (לא חובה)</span><textarea data-c="s3wQ" data-f="note" maxlength="200" rows="2" style="width:100%">${esc2(W.q.note)}</textarea></label>`}
/* הוראות ציור – נפתחות בכפתור "איך מציירים?" */
let skHelp=0;ACT.s3wHelp=()=>{skHelp=skHelp?0:1;rerender()};
const HELP=`<div class="s3info" style="margin-top:8px"><b>איך מציירים</b><ol style="margin:6px 0 0;padding-inline-start:20px;line-height:1.6">
<li><b>פינות חדר:</b> מקישים על הפינות של החדר אחת אחרי השנייה, לפי הסדר מסביב לחדר (לפחות 3), ואז "סגרו חדר". החדר צריך להיות גדול ממטר רבוע, והקירות שלו לא יכולים לחצות זה את זה. החדר הראשון הוא החנות.</li>
<li><b>שורה:</b> מקישים על תחילת השורה ואז על הסוף שלה. המספר שליד כל שורה הוא המספר שלה בשאלות שמתחת לשרטוט.</li>
<li><b>הזזה ועריכה:</b> מקישים על פינה או על קצה של שורה – סביבה מופיע עיגול, וכתוב מה נבחר. אחר כך מקישים במקום החדש. כאן אפשר גם למחוק פינה או שורה, ולהוסיף פינה באמצע הקיר.</li>
<li><b>כניסות:</b> בוחרים "כניסות", קובעים רוחב, לאן הדלת נפתחת (פנימה/החוצה) ובאיזה צד הציר (כשעומדים בחוץ מול הדלת), ומקישים על הקיר. כל הקשה מוסיפה כניסה (עד 40). בשרטוט רואים את הדלת ואת הקשת שלאן היא נפתחת.</li>
<li><b>קופות:</b> בוחרים "קופות". אפשר לכתוב רוחב ועומק ולהקיש במקום, או לבחור "סימון 2 פינות" ולהקיש על שתי פינות נגדיות. עד 40 קופות.</li>
<li><b>שינוי ומחיקה:</b> לכל כניסה וקופה יש שורה ברשימה שמתחת לשרטוט – משנים שם מידות, כיוון ומחיקה. כשנוגעים בשדה, הפריט מודגש בשרטוט. להזזה: "הזזה ועריכה", מקישים על הכניסה או הקופה ואז במקום החדש.</li>
<li><b>הגדלה:</b> "＋" מגדיל, "－" מקטין, "כל השרטוט" מחזיר לגודל הרגיל. כשהשרטוט מוגדל, גוררים באצבע כדי לזוז בו. כשיש פינה נבחרת, ההגדלה מתמקדת בה.</li>
<li><b>צריך עוד מקום?</b> "הגדילו את המסגרת" ← בוחרים כמה מטרים ← מקישים על הצד (למעלה, למטה, ימינה או שמאלה). אחר כך מציירים שם את החדר החדש. אפשר עד 6 חדרים.</li>
<li><b>טעות?</b> "ביטול אחרון" מבטל פעולה אחת בכל הקשה (עד 40 אחורה, עד שסוגרים את האפליקציה). "ניקוי" מוחק את כל השרטוט.</li>
<li>כל הקשה נצמדת לנקודה הקרובה על רשת של חצי מטר.</li></ol></div>`;
function skTools(){const k=W.sk,m=k.mode,F=frame();
 const chip=(v,l)=>`<button class="chip ${m===v?'on':''}" data-a="s3wSkM" data-m="${v}" aria-pressed="${m===v}">${l}</button>`;
 const hint={room:'הקישו על פינות החדר לפי הסדר, ואז "סגרו חדר".',row:k.pend?'הקישו על נקודת הסוף של השורה.':'הקישו על תחילת השורה ואז על הסוף שלה.',sel:k.sel?`נבחרה ${selName(k.sel)}. הקישו במקום החדש כדי להזיז, או בחרו פעולה.`:'הקישו על פינה, על קצה של שורה, על כניסה או על קופה כדי לבחור.',ent:'הקישו על הקיר במקום של כל כניסה. כל הקשה מוסיפה כניסה, והיא נצמדת לקיר הקרוב.',cash:TD.how==='box'?(k.cpend?'הקישו על הפינה הנגדית של הקופה.':'הקישו על פינה אחת של הקופה ואז על הפינה הנגדית.'):'הקישו במקום של כל קופה. כל הקשה מוסיפה קופה בגודל שכתבתם.'}[m];
 let h=`<div class="chips" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">${chip('room','פינות חדר')}${chip('row','שורה')}${chip('sel','הזזה ועריכה')}${chip('ent','כניסות')}${chip('cash','קופות')}</div>`;
 const sel=(f,c,L,v)=>`<select data-c="${c}" data-f="${f}">${L.map(([a,b])=>opt(a,v,b)).join('')}</select>`;
 if(m==='ent')h+=`<div class="s3info" style="margin-top:8px"><b>כניסה חדשה תהיה:</b><div class="row" style="gap:8px;flex-wrap:wrap;margin-top:4px"><label class="f" style="flex:1;min-width:110px;margin:0"><span>רוחב (מטר)</span><input type="number" inputmode="decimal" min=".6" max="5" step=".1" data-c="s3wDf" data-f="w" value="${esc2(DF.w)}"></label><label class="f" style="flex:1;min-width:110px;margin:0"><span>נפתחת</span>${sel('io','s3wDf',[['in','פנימה'],['out','החוצה']],DF.io)}</label><label class="f" style="flex:1;min-width:110px;margin:0"><span>הציר (מבחוץ, מול הדלת)</span>${sel('dh','s3wDf',[['r','מימין'],['l','משמאל']],DF.dh)}</label></div><small class="note">אפשר לשנות כל כניסה גם אחר כך, ברשימה שמתחת לשרטוט.</small></div>`;
 if(m==='cash')h+=`<div class="s3info" style="margin-top:8px"><div class="row" style="gap:6px;flex-wrap:wrap"><button class="chip ${TD.how==='one'?'on':''}" data-a="s3wTh" data-h="one" aria-pressed="${TD.how==='one'}">לפי מידות שכותבים</button><button class="chip ${TD.how==='box'?'on':''}" data-a="s3wTh" data-h="box" aria-pressed="${TD.how==='box'}">סימון 2 פינות על המפה</button></div>${TD.how==='one'?`<div class="row" style="gap:8px;margin-top:6px"><label class="f" style="flex:1;margin:0"><span>רוחב (מטר)</span><input type="number" inputmode="decimal" min=".3" max="10" step=".1" data-c="s3wDf" data-f="tw" value="${esc2(TD.w)}"></label><label class="f" style="flex:1;margin:0"><span>עומק (מטר)</span><input type="number" inputmode="decimal" min=".3" max="10" step=".1" data-c="s3wDf" data-f="td" value="${esc2(TD.d)}"></label></div>`:''}</div>`;
 h+=`<div class="row" style="gap:6px;margin-top:8px;align-items:center"><button class="btn s g" data-a="s3wZm" data-z="out" aria-label="הקטנה"${ZV.z>1?'':' disabled'}>－</button><button class="btn s g" data-a="s3wZm" data-z="in" aria-label="הגדלה"${ZV.z<4?'':' disabled'}>＋</button><button class="btn s g" data-a="s3wZm" data-z="fit"${ZV.z>1?'':' disabled'}>כל השרטוט</button><small class="note">${ZV.z>1?`מוגדל פי ${ZV.z} · גררו באצבע כדי לזוז`:''}</small><button class="btn s g" data-a="s3wHelp" style="margin-inline-start:auto" aria-expanded="${!!skHelp}">איך מציירים?</button></div>${F.tmp?'':`<div style="margin-top:6px"><button class="btn s g" data-a="s3wGrowT" aria-expanded="${!!growOpen}">הגדילו את המסגרת</button></div>`}${growOpen&&!F.tmp?`<div class="s3info" style="margin-top:6px"><label class="f" style="display:block;margin:0 0 6px"><span>כמה מטרים להוסיף</span><input type="number" inputmode="decimal" min=".5" max="98" step=".5" data-c="s3wGm" value="${esc2(growM)}"></label><div class="row" style="gap:6px;flex-wrap:wrap"><button class="btn s g" data-a="s3wGrow" data-s="u">למעלה ↑</button><button class="btn s g" data-a="s3wGrow" data-s="d">למטה ↓</button><button class="btn s g" data-a="s3wGrow" data-s="r">ימינה →</button><button class="btn s g" data-a="s3wGrow" data-s="l">שמאלה ←</button></div><small class="note" style="display:block;margin-top:4px">המסגרת גדלה בצד שבוחרים, והשרטוט נשאר כמו שהוא. אפשר עד 100 מטר לכל צד. טעיתם? "ביטול אחרון".</small></div>`:''}${skHelp?HELP:''}
 <p class="note s3note" aria-live="polite">${hint}${F.tmp?' <b>השרטוט עוד בלי קנה מידה</b> – בסוף תתבקשו לרוחב אמיתי.':''}</p>`;
 h+=`<canvas id="s3wSk" data-a="s3wSkT" role="img" aria-label="שרטוט החנות. ${k.rooms.length} חדרים, ${k.rows.length} שורות" style="display:block;touch-action:${ZV.z>1?'none':'manipulation'};border:1px solid var(--line);background:var(--bg);margin:8px auto 0;cursor:crosshair"></canvas>`;
 {const m=skMax();if(m.x>F.w+1||m.y>F.l+1)h+=`<div class="ban s3warn" role="alert" style="margin-top:8px">חלק מהשרטוט נמצא מחוץ למסגרת, ולכן לא רואים אותו. <button class="btn s" data-a="s3wSkFit" style="margin-top:6px">הקטינו את השרטוט כדי שייכנס</button></div>`}
 h+=`<p class="s3note"><small>${F.tmp?'מסגרת זמנית (עוד בלי מידות), כל משבצת = יחידה':`רוחב ${+(F.w/100).toFixed(1)} מ', אורך ${+(F.l/100).toFixed(1)} מ', כל משבצת = ${Math.max(F.w,F.l)>3000?5:1} מ'`} · ${k.rooms.length} חדרים · ${k.rows.length} שורות${k.cur.length?` · חדר פתוח עם ${k.cur.length/2} פינות`:''}</small></p>`;
 h+=`<div class="row s3row" style="gap:6px">${m==='room'?`<button class="btn s" data-a="s3wSkClose"${k.cur.length>=6?'':' disabled'}>סגרו חדר</button>`:''}${m==='sel'&&k.sel?`<button class="btn s g" data-a="s3wSkDel">${k.sel.t==='w'?'מחקו שורה':k.sel.t==='e'?'מחקו כניסה':k.sel.t==='k'?'מחקו קופה':'מחקו פינה'}</button>${k.sel.t==='c'&&k.sel.r>=0?`<button class="btn s g" data-a="s3wSkIns">הוסיפו פינה</button>`:''}`:''}<button class="btn s g" data-a="s3wSkUndo"${k.undo&&k.undo.length||k.pend||k.cpend?'':' disabled'}>ביטול אחרון</button><button class="btn s g" data-a="s3wSkClr"${skHas()?'':' disabled'}>ניקוי</button></div>`;
 return h}
/* שאלות ההמשך על השרטוט: סוג כל חדר, סוג כל שורה, כניסה/קופה, ורוחב אמיתי כשאין מידות */
function skAsk(){const k=W.sk;skNorm();if(!skHas())return '';let h=`<div class="s3info"><b>כמה שאלות על השרטוט</b>`;
 if(frame().tmp)h+=`<label class="f" style="display:block;margin:8px 0"><span>כמה מטרים בערך רוחב החנות בשרטוט (מהקיר השמאלי לימני)?</span><input type="number" inputmode="decimal" min="2" max="100" step=".5" data-c="s3wRw" value=""></label>`;
 if(k.rooms.length)h+=k.rooms.map((p,i)=>`<label class="f" style="display:block;margin:8px 0 0"><span>חדר ${i+1} – מה זה?</span><select data-c="s3wRt" data-i="${i}">${['s','w','x'].map(v=>opt(v,k.rt[i],RT_L[v])).join('')}</select></label>`).join('');
 if(k.rows.length)h+=k.rows.map((s,i)=>`<label class="f" style="display:block;margin:8px 0 0"><span>שורה ${i+1} – מה יש בה?</span><select data-c="s3wRk" data-i="${i}">${['gon','wall','fridge'].map(v=>opt(v,k.rk[i],RK_L[v])).join('')}</select></label>`).join('');
 const ml=(c,f,i,v,a,b,st)=>`<label class="f" style="flex:1;min-width:90px;margin:0"><span>${a}</span><input type="number" inputmode="decimal" min="${b[0]}" max="${b[1]}" step="${st}" data-c="${c}" data-f="${f}" data-i="${i}" value="${+(v/100).toFixed(2)}"></label>`;
 const sl=(c,f,i,L,v,a)=>`<label class="f" style="flex:1;min-width:90px;margin:0"><span>${a}</span><select data-c="${c}" data-f="${f}" data-i="${i}">${L.map(([x,y])=>opt(x,v,y)).join('')}</select></label>`;
 const del=(t,i,l)=>`<button class="btn s g" data-a="s3wDoDel" data-t="${t}" data-i="${i}" aria-label="מחקו ${l}" style="align-self:flex-end">מחקו</button>`;
 h+=k.doors.map((d,i)=>`<div style="margin:10px 0 0"><b>כניסה ${i+1} (כ${i+1})</b><div class="row" style="gap:6px;flex-wrap:wrap;margin-top:4px">${ml('s3wDo','w',i,d.w,'רוחב (מטר)',[.6,5],.1)}${sl('s3wDo','io',i,[['in','פנימה'],['out','החוצה']],d.io,'נפתחת')}${sl('s3wDo','dh',i,[['r','מימין'],['l','משמאל']],d.dh,'ציר (מבחוץ)')}${del('e',i,'כניסה '+(i+1))}</div></div>`).join('');
 h+=k.tills.map((t,i)=>`<div style="margin:10px 0 0"><b>קופה ${i+1} (ק${i+1})</b><div class="row" style="gap:6px;flex-wrap:wrap;margin-top:4px">${ml('s3wTi','w',i,t.w,'רוחב (מטר)',[.3,10],.1)}${ml('s3wTi','d',i,t.d,'עומק (מטר)',[.3,10],.1)}${sl('s3wTi','a',i,[['0','רגיל'],['90','מסובב 90°']],String(t.a),'סיבוב')}${del('k',i,'קופה '+(i+1))}</div></div>`).join('');
 h+=`<p class="s3note"><small>${k.doors.length?`${k.doors.length} כניסות ✓`:'אין עדיין כניסה – בחרו "כניסות" והקישו על הקיר.'} ${k.tills.length?`${k.tills.length} קופות ✓`:'אין עדיין קופה – בחרו "קופות" והקישו על השרטוט.'}</small></p></div>`;
 return h}
function stepDet(){const p=W.q.path;
 let h=stepper(1)+`<b>פרטים על החנות</b><p class="note s3note">לא חובה, אבל מומלץ מאוד: מתמונות בלבד אי אפשר לדעת את גודל החנות ואיפה השורות. כמה פרטים ושרטוט גס משפרים מאוד את הטיוטה. ה-AI ישתמש בהם כנתונים מחייבים, ויוסיף מהתמונות את סוגי המדפים והפרטים.</p>`;
 if(!p){h+=`<div class="row s3row" style="gap:8px"><button class="btn grow" data-a="s3wPath" data-p="a">אצייר סקיצה</button><button class="btn grow" data-a="s3wPath" data-p="b">אענה על שאלות</button></div><p class="note s3note"><small>סקיצה: מציירים באצבע את החדרים והשורות, ואז עונים על כמה שאלות עליה. שאלות: עונים על מידות ומספרים, והאפליקציה מציירת לבד שרטוט שאפשר לתקן.</small></p>`}
 else if(p==='b'){h+=`<div class="s3info">${qForm()}<button class="btn s" data-a="s3wGen"${realDims()?'':' disabled'}>${skHas()?'בנו מחדש שרטוט מהתשובות':'צרו שרטוט מהתשובות'}</button>${realDims()?'':'<small class="note" style="display:block;margin-top:4px">כדי לבנות שרטוט צריך רוחב ואורך.</small>'}</div>`;
  if(skHas())h+=`<b style="display:block;margin-top:12px">השרטוט – תקנו אם צריך</b>`+skTools()+skAsk()}
 else{h+=`<b style="display:block;margin-top:8px">ציירו את החנות</b>`+skTools()+skAsk()+`<label class="f" style="display:block;margin-top:8px"><span>הערה קצרה (לא חובה)</span><textarea data-c="s3wQ" data-f="note" maxlength="200" rows="2" style="width:100%">${esc2(W.q.note)}</textarea></label>`}
 if(p)h+=`<p class="s3note"><button class="btn s g" data-a="s3wPath" data-p="${p==='a'?'b':'a'}">${p==='a'?'עברו לשאלות':'עברו לציור סקיצה'}</button></p>`;
 if(W.busy)h+=`<div class="s3info" role="status">${esc2(W.busy)}</div>`;
 if(W.msg)h+=`<div class="ban s3warn" role="alert">${esc2(W.msg)}</div>`;
 h+=`<div class="row s3row"><button class="btn grow" data-a="s3wDraft"${W.busy?' disabled':''}>${W.imgs.length?'בנו טיוטה':'בנו טיוטה מהסקיצה'}</button><button class="btn g" data-a="s3wDetX">חזרה לתמונות</button></div>`;
 if(!W.imgs.length)h+=`<p class="note s3note"><small>בלי תמונות המפה נבנית מהסקיצה בלבד, בלי AI. אפשר לצלם גם אחר כך.</small></p>`;
 if(p&&(p==='a'||skHas()))setTimeout(drawSk,0);
 return h}

/* ---------- המסך ---------- */
const thumbs=()=>W.imgs.length?`<div class="row" style="gap:6px;margin:8px 0;align-items:flex-start">${W.imgs.map((x,i)=>`<div style="position:relative;width:68px"><img src="${x.url}" alt="תמונה ${i+1}${x.lbl?' – '+esc2(x.lbl):isV(x)?' – מסרטון':''}" style="width:68px;height:68px;object-fit:cover;border-radius:var(--r-m,10px);border:1px solid var(--line);display:block"><button type="button" class="chip" style="position:absolute;top:-6px;inset-inline-start:-6px;min-height:28px;width:28px;padding:0;justify-content:center" data-a="s3wRm" data-i="${i}" aria-label="מחיקת תמונה ${i+1}">✕</button>${x.lbl?`<small class="s3lbl" style="display:block;font-size:11px;line-height:1.2;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc2(x.lbl)}</small>`:''}</div>`).join('')}</div>`:'';
/* תוויות פינה מוצעות (אפשר לכתוב אחרת). אחרי כל צילום עוברים לתווית הבאה ברשימה – כך מצלמים לפי הסדר */
const LBLS=['כניסה','פינה ימנית ליד הכניסה','פינה ימנית בעומק','פינה שמאלית בעומק','פינה שמאלית ליד הכניסה','מרכז החנות','מחסן'];
CHG.s3wLbl=el=>{W.lbl=String(el.value||'').replace(/\s+/g,' ').slice(0,LBLM)};
CHG.s3wCorner=async el=>{const L=[...(el.files||[])];el.value='';if(!L.length||W.busy)return;const l=W.lbl;await addImgs(L,l);const k=LBLS.indexOf(String(l).trim());if(k>=0&&k<LBLS.length-1&&W.lbl===l){W.lbl=LBLS[k+1];rerender()}};
const corners=()=>{const nc=W.imgs.filter(x=>x.lbl).length;
 return `<div class="s3info" id="s3wCor"><b>תמונות מהפינות (מומלץ 4–8 לכל חדר)</b><br><small>עמדו בכל פינה וצלמו לכיוון הפינה שממול. בחרו מאיפה מצלמים ואז צלמו: התווית עוזרת להבין את צורת החנות. אחרי כל צילום עוברים לפינה הבאה.</small>
 <div class="row s3row" style="align-items:flex-end;gap:8px"><label class="f" style="flex:1;min-width:150px;margin:0"><span>מאיפה מצלמים?</span><input data-c="s3wLbl" list="s3wLbls" maxlength="${LBLM}" value="${esc2(W.lbl)}"></label><label class="btn">צלמו פינה<input type="file" accept="image/*" capture="environment" data-c="s3wCorner" hidden></label></div>
 <datalist id="s3wLbls">${LBLS.map(x=>`<option value="${esc2(x)}">`).join('')}</datalist>${nc?`<p class="s3note" style="margin:6px 0 0"><small>${nc} תמונות עם תווית פינה</small></p>`:''}</div>`};
const texRow=k=>{const t=W.tex[k];return `<div class="s3info"><div class="row" style="justify-content:space-between"><b>${TK[k]}</b>${t?`<span class="tag t3">נשלח ✓</span>`:`<span class="note">לא חובה</span>`}</div>
 <div class="row s3row">${t&&t.url?`<img src="${t.url}" alt="תצוגה מקדימה של ${TK[k]}" style="width:56px;height:56px;object-fit:cover;border-radius:var(--r-m,10px);border:1px solid var(--line)">`:''}<label class="btn s ${t?'g':''}">${t?'צלמו שוב':'צלמו '+TK[k]}<input type="file" accept="image/*" capture="environment" data-c="s3wTex" data-k="${k}" hidden></label>${t?`<button class="btn s g" data-a="s3wTexRm" data-k="${k}">הסירו</button>`:''}</div></div>`};
function step1(d){
 const off=navigator.onLine===false,qs=qSum(),nv=W.imgs.filter(isV).length;
 /* הסדר (הקמת חנות שלב 1): קודם סקיצה ופרטים, ואז – לא חובה – סריקה בתמונות ובסרטון. בלי תמונות "בנו טיוטה" בונה מהסקיצה, בלי AI */
 let h=stepper(1)+`<b>מתחילים בסקיצה</b><p class="note s3note">ציירו סקיצה של החנות, או ענו על כמה שאלות. אפשר לבנות ממנה מפה מיד, בלי AI. כדי שהמערכת תשלים לבד את המדפים והפרטים, צלמו גם את החנות: סרטון הליכה (עד 3 דקות) ותמונות מכל פינה. עד ${MAXI} תמונות מכל המקורות יחד. לפני השמירה עוברים על המפה ומאשרים.</p>`;
 if(off)h+=`<div class="ban s3off" role="status">אין חיבור לאינטרנט. אפשר לצייר ולצלם, אבל טיוטה מהתמונות דורשת רשת.</div>`;
 h+=`<div class="s3info"><div class="row" style="justify-content:space-between"><b>סקיצה ופרטים על החנות</b>${qs?`<span class="tag t3">מולא ✓</span>`:`<span class="note">מתחילים כאן</span>`}</div><small>${qs?esc2(qs):'מידות, חדרים ושורות, או שרטוט גס באצבע.'}</small><div class="row s3row"><button class="btn s ${qs?'g':''}" data-a="s3wDet">${qs?'עריכת הסקיצה והפרטים':'ציירו סקיצה או מלאו פרטים'}</button></div></div>`;
 h+=`<b style="display:block;margin-top:12px">סריקת החנות (לא חובה)</b>`;
 h+=`<div class="row s3row"><label class="btn">צלמו תמונה<input type="file" accept="image/*" capture="environment" data-c="s3wPick" hidden></label><label class="btn g">בחרו מהגלריה<input type="file" accept="image/*" multiple data-c="s3wPick" hidden></label><label class="btn g">העלו סרטון<input type="file" accept="video/*" multiple data-c="s3wVid" hidden></label><label class="btn g">צלמו סרטון<input type="file" accept="video/*" capture="environment" data-c="s3wVid" hidden></label></div>`;
 h+=corners();
 h+=thumbs();
 h+=`<p class="s3note" aria-live="polite">${W.imgs.length?`${W.imgs.length} תמונות${nv?` (${nv} מסרטון)`:''} · בערך ${mb(total())}MB מתוך ${mb(MAXB)}MB`:'עוד לא צולמו תמונות.'}</p>`;
 h+=`<div class="s3info"><b>תמונות לצבע ולמראה (לא חובה)</b><br><small>תמונה של קיר, של הרצפה ושל התקרה, כדי שהתלת מימד ייראה כמו החנות שלכם. כל תמונה נשלחת מיד.</small>${['w','f','c'].map(texRow).join('')}</div>`;
 if(W.busy)h+=`<div class="s3info" role="status">${esc2(W.busy)}${W.vid?` <button class="btn s g" data-a="s3wVidX">ביטול</button>`:''}</div>`;
 if(W.msg)h+=`<div class="ban s3warn" role="alert">${esc2(W.msg)}</div>`;
 h+=`<div class="row s3row"><button class="btn grow" data-a="s3wDraft"${W.busy?' disabled':''}>${W.imgs.length?'בנו טיוטה':'בנו טיוטה מהסקיצה'}</button><button class="btn g" data-a="s3wManual">ציור ידני במקום</button></div>`;
 return h}
function step2(){
 const d=W.draft;
 if(!d)return stepper(2)+`<div class="s3info" role="status" aria-live="polite">${esc2(W.busy||'רגע…')}</div>`;
 const m=d.m,L=a=>(Array.isArray(a)?a:[]).filter(x=>x&&x.del!==1).length,z=zs(m).length,empty=!L(m.rooms)&&!L(m.fx);
 return stepper(2)+`<b>${d.sk?'הטיוטה מהסקיצה מוכנה (בלי AI)':'הטיוטה מוכנה'}</b><div class="kg" style="margin-top:8px"><div class="k"><small>חדרים</small><b>${L(m.rooms)}</b></div><div class="k"><small>גופים (מדפים, מקררים…)</small><b>${L(m.fx)}</b></div><div class="k"><small>אזורים לא ודאיים</small><b>${z}</b></div>${d.sk?'':`<div class="k"><small>רמת ביטחון (הערכת המודל)</small><b>${d.conf==null?'לא ידוע':Math.round(d.conf*100)+'%'}</b></div>`}</div>
 ${empty?`<div class="ban s3warn">ה-AI לא הצליח לזהות חדרים או מדפים. אפשר לצלם עוד תמונות מזוויות אחרות, או להמשיך ולצייר ידנית בעורך.</div>`:''}
 <p class="note s3note">${d.drop?`${d.drop} פריטים לא תקינים הוסרו מהטיוטה. `:''}הטיוטה עדיין לא נשמרה. בשלב הבא עוברים עליה במפה, מתקנים, ומאשרים.</p>
 ${ntBox()}
 <div class="s3info"><b>תיקונים בכתב</b><br><small>אפשר לכתוב מה לא נכון, והמערכת תתקן את הטיוטה. למשל: "המקרר נמצא בקיר השמאלי, יש 4 שורות מדפים ולא 3".</small><textarea id="s3wFix" data-c="s3wFixT" rows="3" maxlength="1000" style="width:100%;margin-top:6px"${W.busy?' disabled':''}>${esc2(W.fixTxt||'')}</textarea><p class="note s3note" style="margin:4px 0">התיקון לא נספר במכסה החודשית. אפשר לתקן כמה פעמים.</p>${W.busy?`<div class="s3info" role="status">${esc2(W.busy)}</div>`:''}${W.fixMsg?`<div class="ban s3warn" role="alert">${esc2(W.fixMsg)}</div>`:''}<div class="row s3row"><button class="btn g" data-a="s3wFix"${W.busy?' disabled':''}>תקנו את הטיוטה</button></div></div>
 <div class="row s3row"><button class="btn grow" data-a="s3wEdit"${W.busy?' disabled':''}>עברו על הטיוטה</button><button class="btn g" data-a="s3wBack1"${W.busy?' disabled':''}>צלמו עוד</button></div>`}
function step3(){
 return stepper(3)+`<b>הטיוטה בעריכה</b><p class="note s3note">עברו על המפה ועל האזורים הלא ודאיים, ואז שמרו.</p><div class="row s3row"><button class="btn grow" data-a="s3wEdit">חזרה לעריכה</button><button class="btn g" data-a="s3wAgain">התחילו מחדש</button></div>`}
function step5(){
 if(!U.isMgr())return stepper(5)+`<div class="s3info" role="status"><b>המפה נשמרה ✓</b><br>הגדרת סבב נעשית על ידי מנהל.</div><div class="row s3row"><button class="btn" data-a="s3wEnd">לסיום</button></div>`;
 if(W.rid){return stepper(5)+`<div class="s3info" role="status"><b>המפה נשמרה והסבב נקבע ✓</b><br><small>הסבב ייפתח במועד שנקבע, והעובד יקבל התראה. אפשר גם לפתוח אותו עכשיו.</small></div>${W.runMsg?`<div class="s3info" role="status">${esc2(W.runMsg)}</div>`:''}${W.busy?`<div class="s3info">${esc2(W.busy)}</div>`:''}<div class="row s3row"><button class="btn g" data-a="s3wNow"${W.busy||W.runMsg?' disabled':''}>פתחו סבב עכשיו</button><button class="btn grow" data-a="s3wEnd">סיום</button></div>`}
 loadStaff();
 if(!W.rule){W.rule={name:'סבב בדיקת מדפים',k:'week',dow:0,n:7,dom:1,due:2,u:''}}
 const r=W.rule,S=W.staff;
 let h=stepper(5)+`<div class="s3info" role="status"><b>המפה נשמרה ✓</b></div><b style="display:block;margin-top:10px">קבעו סבב בדיקה</b><p class="note s3note">סבב הוא בדיקה קבועה של המדפים: עובד מצלם, וה-AI בודק. אפשר לדלג ולהגדיר אחר כך.</p>`;
 if(S===null||W.busy==='staff')return h+`<div class="s3info">טוען עובדים…</div>`;
 if(!S.length)return h+`<div class="s3info">${esc2(W.staffErr||'אין עדיין עובדים פעילים בסניף הזה. אחרי שתוסיפו עובד אפשר להגדיר סבב.')}</div><div class="row s3row"><button class="btn" data-a="s3wEnd">לסיום</button></div>`;
 if(!r.u)r.u=S[0].uid;
 h+=`<label class="f" style="display:block"><span>שם הסבב</span><input data-c="s3wR" data-f="name" maxlength="40" value="${esc2(r.name)}"></label>
 <label class="f" style="display:block;margin-top:8px"><span>עובד</span><select data-c="s3wR" data-f="u">${S.map(s=>`<option value="${esc2(s.uid)}"${s.uid===r.u?' selected':''}>${esc2(s.name)}</option>`).join('')}</select></label>
 <label class="f" style="display:block;margin-top:8px"><span>תדירות</span><select data-c="s3wR" data-f="k"><option value="week"${r.k==='week'?' selected':''}>כל שבוע</option><option value="days"${r.k==='days'?' selected':''}>כל כמה ימים</option><option value="month"${r.k==='month'?' selected':''}>כל חודש</option><option value="manual"${r.k==='manual'?' selected':''}>ידני (אני אפתח)</option></select></label>`;
 if(r.k==='week')h+=`<label class="f" style="display:block;margin-top:8px"><span>ביום</span><select data-c="s3wR" data-f="dow">${DOW.map((n,i)=>`<option value="${i}"${r.dow===i?' selected':''}>${n}</option>`).join('')}</select></label>`;
 if(r.k==='days')h+=`<label class="f" style="display:block;margin-top:8px"><span>כל כמה ימים (1 עד 90)</span><input type="number" inputmode="numeric" min="1" max="90" data-c="s3wR" data-f="n" value="${r.n}"></label>`;
 if(r.k==='month')h+=`<label class="f" style="display:block;margin-top:8px"><span>ביום בחודש (1 עד 28)</span><input type="number" inputmode="numeric" min="1" max="28" data-c="s3wR" data-f="dom" value="${r.dom}"></label>`;
 h+=`<label class="f" style="display:block;margin-top:8px"><span>ימים לסיום הסבב (1 עד 14)</span><input type="number" inputmode="numeric" min="1" max="14" data-c="s3wR" data-f="due" value="${r.due}"></label>`;
 if(W.busy)h+=`<div class="s3info" role="status">${esc2(W.busy)}</div>`;
 if(W.msg)h+=`<div class="ban s3warn" role="alert">${esc2(W.msg)}</div>`;
 return h+`<div class="row s3row"><button class="btn grow" data-a="s3wMake"${W.busy?' disabled':''}>קבעו סבב</button><button class="btn g" data-a="s3wEnd">דלגו</button></div>`}
V.st3w=()=>{const T='הקמת תלת מימד';
 if(!loggedIn()||!U.feat())return{t:T,h:'<div class="empty">תלת מימד לא מופעל בעסק הזה</div>'};
 if(!U.canDraw())return{t:T,h:'<div class="empty">אין לכם הרשאה להקים מפה בעסק הזה</div>'};
 if(W.own!==me())reset(W.kind);
 if(!U.dataOk()){U.load();return{t:T,h:'<div class="empty">טוען…</div>'}}
 const d=U.data();if(d.err)return{t:T,h:`<div class="card s3s"><p style="margin:0">${esc2(d.err)}</p><button class="btn" style="margin-top:10px" data-a="st3Retry">נסו שוב</button></div>`};
 if(W.br&&W.br!==d.br){W.br=d.br}
 if(W.kind==='w'&&!d.cfg.wh)W.kind='s';
 const have=d.maps[W.kind];
 if(have&&W.step<5&&!W.draft&&!(U.E&&U.E.wiz))return{t:T,h:`<div class="card s3s"><b>כבר יש מפה${W.kind==='w'?' למחסן':' לסניף הזה'}</b><p class="note s3note">האשף בונה מפה חדשה בלבד, ולא דורס מפה קיימת. את המפה הקיימת אפשר לערוך.</p><div class="row s3row"><button class="btn" data-a="st3Edit" data-k="${W.kind}">לעריכת המפה</button><button class="btn g" data-a="st3Open">למפה</button></div></div>`};
 let h='';const L=U.brs();
 if(L.length>1&&W.step<3)h+=`<div class="chips" style="margin:0 0 8px">${L.map(b=>`<button class="chip ${b.id===d.br?'on':''}" data-a="s3wBr" data-id="${esc2(b.id)}">${esc2(b.name)}</button>`).join('')}</div>`;
 h+=W.step===1?(W.det?stepDet():step1(d)):W.step===2?step2():W.step===5?step5():step3();
 return{t:T,s:(L.find(b=>b.id===d.br)||{}).name||'',h:`<div class="card s3s">${h}</div>`}};
ACT.s3wBr=el=>{if(W.busy)return;U.X.br=el.dataset.id;U.X.d=null;W.br=el.dataset.id;W.qid='';for(const k of ['w','f','c'])W.tex[k]=null;const v=lsRead();qLoad(v);W.det=0;W.qSeen=0;if(v)for(const k of ['w','f','c'])if(v.tex[k])W.tex[k]={texId:v.tex[k].texId,path:v.tex[k].path,w:v.tex[k].w,h:v.tex[k].h,url:''};rerender()};
/* התנתקות / החלפת עסק: ניקוי התמונות מהזיכרון */
setInterval(()=>{if(W.own&&W.own!==me()){revoke();W.own='';W.imgs=[];W.draft=null;W.step=1;W.rid='';W.made=0}},3000);
})();
