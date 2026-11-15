/* סריקת חנות בתלת מימד – שלב 11 (משימה 2026-11-14_סריקת-חנות-תלת-מימד): אשף הקמה.
   קובץ עצמאי, נטען אחרי store3d-capture.js. מוסיף את המסך V.st3w ואת S3UI.openWizard. בסיס כללי לכל עסק: אין כאן שום תוכן של עסק מסוים –
   כל עסק מצלם את החנות שלו, והמערכת בונה טיוטה לבד. הזרימה: 1 צלמו (תמונות החנות + תמונות לקירות/רצפה/תקרה) ← 2 טיוטה (mapDraft, AI בשרת)
   ← 3 תקנו (העורך, עם סימון אזורים לא ודאיים uz) ← 4 שמרו (s3SaveMap, רק אחרי שהמנהל עבר על כל אזור לא ודאי ואישר את הטיוטה) ← 5 קבעו סבב (sround).
   החלטת משתמש: המנהל עובר על טיוטת ה-AI ומאשר לפני השמירה הראשונה; אי אפשר לשמור עד שכל uz אושר/תוקן/נמחק.
   האשף פועל רק כשאין עדיין מפה (לא דורס מפה קיימת). טקסטורות: s3PutTex מיד בצילום, והנתיבים נשמרים בטלפון ונכנסים למפה ב-tx[] ובחדרים ב-tex בשמירה (wizPrep).
   אין כאן שום קריאה לשרת כשהתוסף כבוי (feat()). */
(function(){
'use strict';
const U=window.S3UI;
if(!U||typeof ACT==='undefined'||typeof V==='undefined'||typeof CHG==='undefined'||typeof go==='undefined')return;
const esc2=U.esc2;
const MAXI=40,MAXB=6000000,STEPS=['צלמו','טיוטה','תקנו','שמרו','סבב'];
const TK={w:'קירות',f:'רצפה',c:'תקרה'};
const DOW=['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
const W={own:'',kind:'s',br:'',step:1,imgs:[],tex:{w:null,f:null,c:null},busy:'',msg:'',qid:'',draft:null,staff:null,staffErr:'',rule:null,rid:'',made:0,runMsg:''};
U.W=W;
const me=()=>(SY&&SY.bizId||'')+'|'+(SY&&SY.uid||'');
const loggedIn=()=>!!(SY&&SY.refresh&&SY.uid);
const mapId=()=>U.mapIdOf(W.kind,W.br||U.brSel());
const lsK=()=>LK('lp-s3w:'+mapId());
const lsRead=()=>{try{const v=JSON.parse(localStorage.getItem(lsK()));return v&&v.tex&&typeof v.tex==='object'?v:null}catch(e){return null}};
const lsSave=()=>{try{const t={};for(const k of ['w','f','c'])if(W.tex[k])t[k]={texId:W.tex[k].texId,path:W.tex[k].path,w:W.tex[k].w,h:W.tex[k].h};if(Object.keys(t).length)localStorage.setItem(lsK(),JSON.stringify({tex:t}));else localStorage.removeItem(lsK())}catch(e){}};
const revoke=()=>{for(const i of W.imgs)try{URL.revokeObjectURL(i.url)}catch(e){}for(const k of ['w','f','c'])if(W.tex[k]&&W.tex[k].url)try{URL.revokeObjectURL(W.tex[k].url)}catch(e){}};
function reset(kind){revoke();W.own=me();W.kind=kind==='w'?'w':'s';W.br=U.brSel();W.step=1;W.imgs=[];W.tex={w:null,f:null,c:null};W.busy='';W.msg='';W.qid='';W.draft=null;W.staff=null;W.staffErr='';W.rule=null;W.rid='';W.made=0;W.runMsg='';
 const v=lsRead();if(v)for(const k of ['w','f','c'])if(v.tex[k]&&typeof v.tex[k].path==='string')W.tex[k]={texId:v.tex[k].texId,path:v.tex[k].path,w:v.tex[k].w,h:v.tex[k].h,url:''}}
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
U.wizDone=()=>{W.step=5;W.made=1;W.draft=null;for(const k of ['w','f','c'])if(W.tex[k]){if(W.tex[k].url)try{URL.revokeObjectURL(W.tex[k].url)}catch(e){}W.tex[k]=null}lsSave();W.msg='';if(U.E)U.E.wiz=null};
const stepper=n=>`<ol class="s3st" aria-label="שלבי ההקמה">${STEPS.map((l,i)=>`<li class="${i+1===n?'on':i+1<n?'dn':''}"${i+1===n?' aria-current="step"':''}>${i+1}. ${l}</li>`).join('')}</ol>`;
const keyOf=z=>[z.x,z.y,z.w,z.d].join('_');
/* הלוח שבעורך: ראש מעל המפה, ואזורים מתחתיה */
U.wizPanel=()=>{/* ראש הלוח: מעל המפה */
 const E=U.E,m=E.map,n=zOpen(m),w=E.wiz||{};
 const step=(n||(w.appr?0:1))?3:4;
 return `<div class="card s3s" id="s3wp">${stepper(step)}<b>טיוטה מהתמונות – בדקו לפני השמירה</b>
  <p class="note s3note">${w.n?`ה-AI בנה את הטיוטה מ-${+w.n} תמונות. `:''}זו הערכה (לא מאומת)${w.conf!=null?`, רמת ביטחון ${Math.round(+w.conf*100)}% לפי המודל`:''}. עברו על המפה, תקנו מה שלא נכון, ואז על האזורים שמתחתיה.</p>
  ${w.notes?`<div class="s3info"><small>הערת ה-AI:</small> ${esc2(w.notes)}</div>`:''}
  <label class="f" style="display:block;margin-top:8px"><span>שם המפה</span><input data-c="s3wName" maxlength="40" value="${esc2(String(m.name||'').replace(/\s*\(טיוטה\)\s*$/,''))}"></label></div>`};
U.wizZones=()=>{/* אזורים לא ודאיים ואישור הטיוטה: מתחת למפה, ממש לפני כפתור השמירה */
 const E=U.E,m=E.map,Z=zs(m),n=zOpen(m),w=E.wiz||{},how=w.how||(w.how={});
 let h=`<div class="card s3s" id="s3wz">`;
 if(Z.length){
  h+=`<p class="s3note" style="margin-top:0"><b>${n?`${n} מתוך ${Z.length} אזורים לא ודאיים עוד לא נבדקו`:`עברתם על כל ${Z.length} האזורים הלא ודאיים`}</b><br><span class="note">האזורים מסומנים במפה במסגרת מקווקווה עם סימן שאלה. אי אפשר לשמור עד שעוברים על כולם: אישור (המפה נכונה), תיקנתי (תיקנתם במפה), או מחיקה (האזור לא רלוונטי).</span></p>`;
  h+=Z.map((z,i)=>`<div class="s3info ${z.ok?'':'s3err'}"><div class="row" style="justify-content:space-between"><b>${z.ok?'✓':'?'} אזור ${i+1}${z.txt?': '+esc2(z.txt):''}</b>${z.ok?`<span class="tag t3">${how[keyOf(z)]==='fix'?'תוקן':'אושר'}</span>`:`<span class="tag t1">לבדיקה</span>`}</div>
   <div class="row s3row"><button class="btn s g" data-a="s3wZ" data-i="${i}">הראו במפה</button>${z.ok?`<button class="btn s g" data-a="s3wUn" data-i="${i}">החזירו לבדיקה</button>`:`<button class="btn s" data-a="s3wOk" data-i="${i}">אישור</button><button class="btn s g" data-a="s3wFix" data-i="${i}">תיקנתי</button>`}<button class="btn s g" data-a="s3wDel" data-i="${i}" aria-label="מחיקת האזור ${i+1}">מחיקה</button></div></div>`).join('');
 }else h+=`<p class="s3note" style="margin-top:0">ה-AI לא סימן אזורים לא ודאיים. עדיין חשוב לעבור על המפה לפני השמירה.</p>`;
 h+=`<label class="cb" style="display:flex;gap:8px;align-items:center;min-height:44px;margin-top:10px"><input type="checkbox" data-c="s3wAppr"${w.appr?' checked':''}> עברתי על הטיוטה ואני מאשר/ת אותה</label></div>`;
 return h};
const rr=()=>{if(U.edTouch)U.edTouch();else rerender()};
ACT.s3wZ=el=>{const E=U.E,z=zs(E.map)[+el.dataset.i];if(!z)return;E.wiz=E.wiz||{};E.wiz.zi=+el.dataset.i;E.vw=Math.max(1200,Math.max(z.w,z.d)*3);E.vx=z.x+z.w/2-E.vw/2;E.vy=z.y+z.d/2-E.vw*.45;rerender()};
const mark=(i,v,how)=>{const E=U.E,z=zs(E.map)[i];if(!z)return;z.ok=!!v;E.wiz=E.wiz||{};E.wiz.how=E.wiz.how||{};if(v)E.wiz.how[keyOf(z)]=how;else delete E.wiz.how[keyOf(z)];rr()};
ACT.s3wOk=el=>mark(+el.dataset.i,true,'ok');
ACT.s3wFix=el=>mark(+el.dataset.i,true,'fix');
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
async function addImgs(files){
 W.msg='';W.busy='מכינים את התמונות…';rerender();let bad=0,full=0;
 for(const f of files){
  if(W.imgs.length>=MAXI){full=1;break}
  if(f.type&&!/^image\//.test(f.type)){bad++;continue}
  try{const p=await small(f);if(total()+p.blob.size>MAXB){full=2;break}W.imgs.push({blob:p.blob,url:URL.createObjectURL(p.blob),w:p.w,h:p.h});W.qid=''}catch(e){bad++}}
 W.busy='';W.msg=(full===1?`אפשר עד ${MAXI} תמונות. `:full===2?'התמונות הגיעו לגודל המרבי. מחקו תמונה כדי להוסיף. ':'')+(bad?`${bad} קבצים לא נקלטו (לא תמונה, או שלא ניתן היה לקרוא אותם). `:'');rerender()}
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
 if(W.busy)return;if(!W.imgs.length){W.msg='צלמו לפחות תמונה אחת.';return rerender()}
 if(navigator.onLine===false){W.msg='אין חיבור לאינטרנט. יצירת הטיוטה דורשת רשת.';return rerender()}
 W.msg='';W.step=2;W.busy='מנתחים את התמונות ובונים טיוטה… זה יכול לקחת כדקה או שתיים. אל תסגרו את האפליקציה.';rerender();
 try{
  if(!W.qid)W.qid=U.qid();
  const imgs=[];for(const i of W.imgs)imgs.push(await U.b64(i.blob));
  let r=await U.fn('mapDraft',{qid:W.qid,br:W.br||U.brSel(),kind:W.kind,imgs});
  if(r&&r.st==='fail')throw Object.assign(new Error(r.err||'לא הצלחנו לבנות טיוטה מהתמונות.'),{reason:''});
  /* ניסיון חוזר עם אותו מזהה מחזיר dup בלי המפה: קוראים אותה מהטיוטה השמורה */
  if(r&&!needs(r)&&r.draftId){const dd=await U.get('/s3draft/'+r.draftId);if(dd&&dd.m)r=Object.assign({},r,{m:dd.m})}
  if(!r||!needs(r))throw new Error('התשובה מהשרת חסרה. נסו שוב.');
  W.draft={m:r.m,conf:typeof r.conf==='number'?r.conf:null,notes:String(r.notes||''),n:+r.n||W.imgs.length,drop:+r.drop||0,usage:r.usage||null,id:r.draftId||''};
  W.busy='';W.msg='';rerender()}
 catch(e){W.busy='';W.step=1;W.msg=U.errText(e,'לא הצלחנו לבנות טיוטה. נסו שוב.');rerender()}}
ACT.s3wDraft=()=>makeDraft();
ACT.s3wBack1=()=>{W.draft=null;W.step=1;W.msg='';rerender()};
ACT.s3wEdit=()=>{
 const d=W.draft;
 if(d){const m=JSON.parse(JSON.stringify(d.m));if(!Array.isArray(m.uz))m.uz=[];W.step=3;U.edLoad(m,W.kind,{n:d.n,conf:d.conf,notes:d.notes,how:{}});W.draft=null;return}
 if(U.E&&U.E.wiz&&U.E.map)go('st3e');else{W.step=1;rerender()}};
ACT.s3wManual=()=>{if(typeof U.openEditor==='function')U.openEditor(W.kind)};
ACT.s3wAgain=()=>ask('להתחיל מחדש? התמונות והטיוטה שבעבודה יימחקו מהמסך הזה (שום דבר לא נשמר בשרת כמפה).',()=>{const k=W.kind;if(U.E&&U.E.wiz){U.E.wiz=null;U.E.key=''}reset(k);rerender()},'כן, התחילו מחדש');

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

/* ---------- המסך ---------- */
const thumbs=()=>W.imgs.length?`<div class="row" style="gap:6px;margin:8px 0">${W.imgs.map((x,i)=>`<div style="position:relative;width:68px;height:68px"><img src="${x.url}" alt="תמונה ${i+1}" style="width:68px;height:68px;object-fit:cover;border-radius:var(--r-m,10px);border:1px solid var(--line)"><button type="button" class="chip" style="position:absolute;top:-6px;inset-inline-start:-6px;min-height:28px;width:28px;padding:0;justify-content:center" data-a="s3wRm" data-i="${i}" aria-label="מחיקת תמונה ${i+1}">✕</button></div>`).join('')}</div>`:'';
const texRow=k=>{const t=W.tex[k];return `<div class="s3info"><div class="row" style="justify-content:space-between"><b>${TK[k]}</b>${t?`<span class="tag t3">נשלח ✓</span>`:`<span class="note">לא חובה</span>`}</div>
 <div class="row s3row">${t&&t.url?`<img src="${t.url}" alt="תצוגה מקדימה של ${TK[k]}" style="width:56px;height:56px;object-fit:cover;border-radius:var(--r-m,10px);border:1px solid var(--line)">`:''}<label class="btn s ${t?'g':''}">${t?'צלמו שוב':'צלמו '+TK[k]}<input type="file" accept="image/*" capture="environment" data-c="s3wTex" data-k="${k}" hidden></label>${t?`<button class="btn s g" data-a="s3wTexRm" data-k="${k}">הסירו</button>`:''}</div></div>`};
function step1(d){
 const off=navigator.onLine===false;
 let h=stepper(1)+`<b>צלמו את החנות</b><p class="note s3note">עברו בחנות וצלמו מכל הכיוונים: את הקירות, המעברים, המדפים והכניסה. כשיש יותר זוויות, הטיוטה מדויקת יותר. המערכת בונה לבד טיוטה של המפה, ואתם עוברים עליה ומאשרים לפני שהיא נשמרת. אפשר עד ${MAXI} תמונות.</p>`;
 if(off)h+=`<div class="ban s3off" role="status">אין חיבור לאינטרנט. אפשר לצלם, אבל יצירת הטיוטה דורשת רשת.</div>`;
 h+=`<div class="row s3row"><label class="btn">צלמו תמונה<input type="file" accept="image/*" capture="environment" data-c="s3wPick" hidden></label><label class="btn g">בחרו מהגלריה<input type="file" accept="image/*" multiple data-c="s3wPick" hidden></label></div>`;
 h+=thumbs();
 h+=`<p class="s3note" aria-live="polite">${W.imgs.length?`${W.imgs.length} תמונות · בערך ${mb(total())}MB מתוך ${mb(MAXB)}MB`:'עוד לא צולמו תמונות.'}</p>`;
 h+=`<div class="s3info"><b>תמונות לצבע ולמראה (לא חובה)</b><br><small>תמונה של קיר, של הרצפה ושל התקרה, כדי שהתלת מימד ייראה כמו החנות שלכם. כל תמונה נשלחת מיד.</small>${['w','f','c'].map(texRow).join('')}</div>`;
 if(W.busy)h+=`<div class="s3info" role="status">${esc2(W.busy)}</div>`;
 if(W.msg)h+=`<div class="ban s3warn" role="alert">${esc2(W.msg)}</div>`;
 h+=`<div class="row s3row"><button class="btn grow" data-a="s3wDraft"${W.imgs.length&&!W.busy?'':' disabled'}>בנו טיוטה</button><button class="btn g" data-a="s3wManual">ציור ידני במקום</button></div>`;
 return h}
function step2(){
 const d=W.draft;
 if(!d)return stepper(2)+`<div class="s3info" role="status" aria-live="polite">${esc2(W.busy||'רגע…')}</div>`;
 const m=d.m,L=a=>(Array.isArray(a)?a:[]).filter(x=>x&&x.del!==1).length,z=zs(m).length,empty=!L(m.rooms)&&!L(m.fx);
 return stepper(2)+`<b>הטיוטה מוכנה</b><div class="kg" style="margin-top:8px"><div class="k"><small>חדרים</small><b>${L(m.rooms)}</b></div><div class="k"><small>גופים (מדפים, מקררים…)</small><b>${L(m.fx)}</b></div><div class="k"><small>אזורים לא ודאיים</small><b>${z}</b></div><div class="k"><small>רמת ביטחון (הערכת המודל)</small><b>${d.conf==null?'לא ידוע':Math.round(d.conf*100)+'%'}</b></div></div>
 ${empty?`<div class="ban s3warn">ה-AI לא הצליח לזהות חדרים או מדפים. אפשר לצלם עוד תמונות מזוויות אחרות, או להמשיך ולצייר ידנית בעורך.</div>`:''}
 <p class="note s3note">${d.drop?`${d.drop} פריטים לא תקינים הוסרו מהטיוטה. `:''}הטיוטה עדיין לא נשמרה. בשלב הבא עוברים עליה במפה, מתקנים, ומאשרים.</p>
 <div class="row s3row"><button class="btn grow" data-a="s3wEdit">עברו על הטיוטה</button><button class="btn g" data-a="s3wBack1">צלמו עוד</button></div>`}
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
 h+=W.step===1?step1(d):W.step===2?step2():W.step===5?step5():step3();
 return{t:T,s:(L.find(b=>b.id===d.br)||{}).name||'',h:`<div class="card s3s">${h}</div>`}};
ACT.s3wBr=el=>{if(W.busy)return;U.X.br=el.dataset.id;U.X.d=null;W.br=el.dataset.id;W.qid='';for(const k of ['w','f','c'])W.tex[k]=null;const v=lsRead();if(v)for(const k of ['w','f','c'])if(v.tex[k])W.tex[k]={texId:v.tex[k].texId,path:v.tex[k].path,w:v.tex[k].w,h:v.tex[k].h,url:''};rerender()};
/* התנתקות / החלפת עסק: ניקוי התמונות מהזיכרון */
setInterval(()=>{if(W.own&&W.own!==me()){revoke();W.own='';W.imgs=[];W.draft=null;W.step=1;W.rid='';W.made=0}},3000);
})();
