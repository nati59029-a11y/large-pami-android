/* הקמת חנות – שלב 3 (משימה 2026-11-17_תהליך-הקמת-חנות): המסך "צילום החנות" (V.st3k).
   קובץ עצמאי, נטען אחרי store3d.js, store3d-capture.js, store3d-pano-ui.js ו-store3d-capplan.js. לא משנה קוד קיים: מוסיף כפתור "צילום החנות"
   בשורת הכפתורים של המפה (עוטף את S3UI.tourBtn) – רק למנהל ולעובד עם הרשאת "שרטוט מפה" (canDraw).
   תוכנית הצילום (S3Plan.capPlan) מחושבת בטלפון מהמפה השמורה – אותו קוד בדיוק כמו בשרת. המסך מסמן במפה את הפריט הנוכחי (זהב),
   מה שהושלם (ירוק), מה שצולם ועוד לא הושלם (כתום) ומה שחסר (אדום); דילוג רק עם סיבה; "סיום" רק כשהכול הושלם או דולג (s3SetupDone).
   כל צילום נשמר מיד בתור השליחה של הטלפון (IndexedDB, store3d-capture.js) ונשלח מיד (s3CapPut) – עובד גם בלי רשת, עם ניסיון חוזר.
   "אשרו כחזית" שולח את התמונה האחרונה כחזית ידנית (man) – עד שיגיע חיבור התמונות וחיתוך (שלב 4). אין כאן AI. */
(function(){
'use strict';
const U=window.S3UI,PL=window.S3Plan;
if(!U||!PL||typeof ACT==='undefined'||typeof V==='undefined'||typeof CHG==='undefined'||typeof go==='undefined')return;
const esc2=U.esc2,GOLD='#d4a017',ORANGE='#e8892b';
const K={own:'',mapId:'',map:null,plan:null,docs:{},setup:null,cur:'',busy:0,msg:'',err:'',open:'',last:{},q:{},tok:0,miss:null};
U.K3=K;
const me=()=>(SY&&SY.bizId||'')+'|'+(SY&&SY.uid||'');
const loggedIn=()=>!!(SY&&SY.refresh&&SY.uid);
const typing=()=>{const a=document.activeElement;return !!(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)&&a.closest('#main'))};
const onScr=()=>{try{return cur().v==='st3k'}catch(e){return false}};
const OLD='העדכון בשרת עוד לא הותקן, ולכן אי אפשר עדיין לצלם את החנות. נסו שוב אחרי העדכון.';
/* פונקציה שלא קיימת בשרת (שרת ישן) מחזירה שגיאה כללית בלי reason – (לא מאומת מול שרת אמיתי) */
const errOf=(e,d)=>e&&!e.offline&&!e.reason&&/^הפעולה נכשלה/.test(e.message||'')?OLD:U.errText(e,d);
const RS={'not-in-plan':'הפריט כבר לא נמצא במפה. טענו מחדש את תוכנית הצילום.','ph-full':'יש כבר מספיק תמונות לחלק הזה. אשרו חזית או דלגו עם סיבה.','plan-too-big':'התוכנית גדולה מדי – פצלו את המפה.','not-s3m':'צילום החנות מותר למנהל או לעובד עם הרשאת "שרטוט מפה".','no-map':'המפה לא קיימת. שמרו את המפה לפני הצילום.','bad-why':'כתבו למה מדלגים (עד 120 תווים).'};
const msgOf=(e,d)=>(e&&RS[e.reason])||errOf(e,d);

/* ---------- טעינה ---------- */
const itemOf=k=>K.plan&&K.plan.items.find(i=>i.key===k)||null;
const stOf=it=>{const s=PL.itemState(K.docs[it.key],it);return s==='todo'&&K.q[it.key]?'part':s};
const doneOf=it=>{const s=stOf(it);return s==='ok'||s==='skip'};
function nextOf(after){const L=(K.plan&&K.plan.items)||[];const i=after?L.findIndex(x=>x.key===after):-1;for(let k=1;k<=L.length;k++){const it=L[(i+k+L.length)%L.length];if(it&&!doneOf(it)&&!K.q[it.key])return it.key}return ''}
async function loadDocs(){const o={};let pt='';
 for(let i=0;i<20;i++){const j=await fsx('/s3setup/'+K.mapId+'/cap?pageSize=300'+['st','why','ph','fr','frTh','geo','okBy','man'].map(f=>'&mask.fieldPaths='+f).join('')+(pt?'&pageToken='+encodeURIComponent(pt):''));
  for(const d of ((j&&j.documents)||[])){o[d.name.split('/').pop()]=U.dec(d)||{}}pt=(j&&j.nextPageToken)||'';if(!pt)break}
 return o}
async function refreshQ(){const L=typeof U.capQ==='function'?await U.capQ().catch(()=>[]):[];const q={};for(const r of L)if(r.mapId===K.mapId&&!r.fail)q[r.key]=(q[r.key]|0)+1;K.q=q;K.qf=L.filter(r=>r.mapId===K.mapId&&r.fail);}
async function open(mapId){
 if(!U.feat()||!loggedIn()||!U.canDraw()||!/^[sw]-[a-z0-9_]{2,20}$/.test(mapId||''))return;
 const t=++K.tok;Object.assign(K,{own:me(),mapId,map:null,plan:null,docs:{},setup:null,cur:'',busy:1,msg:'',err:'',open:'',miss:null});
 if(!onScr())go('st3k');else rerender();
 try{
  const map=await U.get('/smap/'+mapId);if(t!==K.tok)return;
  if(!map||map.del===1){K.err='עוד אין מפה שמורה. שרטטו ושמרו את המפה, ואז חזרו לצילום.';K.busy=0;return rerender()}
  K.map=map;K.plan=PL.capPlan(map);
  try{K.docs=await loadDocs();K.setup=await U.get('/s3setup/'+mapId)}catch(e){if(e&&e.code===403){K.err=OLD;K.busy=0;return rerender()}if(!(e&&e.code===404))throw e}
  await refreshQ();
 }catch(e){if(t!==K.tok)return;K.err=e&&e.offline?'אין חיבור לאינטרנט. פתחו את צילום החנות כשיש חיבור.':'לא הצלחנו לטעון את תוכנית הצילום. נסו שוב.';K.busy=0;return rerender()}
 if(t!==K.tok)return;
 K.cur=nextOf('')||(K.plan.items[0]&&K.plan.items[0].key)||'';const it=itemOf(K.cur);K.open=it?it.room:'';K.busy=0;rerender()}
ACT.s3cpOpen=el=>{const d=U.data();open(U.mapIdOf(el.dataset.k==='w'?'w':'s',d&&d.br))};
ACT.s3cpReload=()=>open(K.mapId);
/* כפתור הכניסה – ליד "דגם / 360" בשורת הכפתורים של המפה */
{const t0=U.tourBtn;U.tourBtn=(kind,d)=>(typeof t0==='function'?t0(kind,d)||'':'')+(U.canDraw()?`<button class="chip" type="button" data-a="s3cpOpen" data-k="${kind==='w'?'w':'s'}" style="min-height:44px;margin-inline-start:6px">צילום החנות</button>`:'')}
/* תשובה מהתור (store3d-capture.js): רענון הפריט שנשלח */
U.onCap=async(r,x,err)=>{if(!r||r.mapId!==K.mapId)return;
 if(x){try{const d=await U.get('/s3setup/'+K.mapId+'/cap/'+r.key);if(d)K.docs[r.key]=d}catch(e){}}
 if(err)K.msg='צילום של "'+PL.label(itemOf(r.key),K.map)+'" לא נשלח: '+msgOf(err,'השליחה נכשלה');
 await refreshQ();if(onScr()&&!K.busy&&!typing())rerender()};

/* ---------- צילום ---------- */
CHG.s3cpPick=async el=>{
 const f=el.files&&el.files[0],lv=el.dataset.lv||'a';el.value='';const it=itemOf(K.cur);if(!f||!it||K.busy)return;
 if(f.type&&!/^image\//.test(f.type)){K.msg='הקובץ שנבחר אינו תמונה.';return rerender()}
 K.busy=1;K.msg='מכינים את התמונה…';rerender();
 try{
  const p=await U.prep(f),bad=U.badOf(p);
  if(bad){K.busy=0;K.msg=bad==='blur'?'התמונה לא חדה מספיק. צלמו שוב, והחזיקו את הטלפון יציב.':'התמונה חשוכה מדי. הדליקו אור או התקרבו, וצלמו שוב.';return rerender()}
  await U.capAdd({mapId:K.mapId,key:it.key,lv,img:p.full,th:p.th,w:p.w,h:p.h,at:Date.now()});
  K.last[it.key]={full:p.full,th:p.th};K.busy=0;
  const need=it.lv.length>1&&!K.last[it.key+'|'+(lv==='t'?'b':'t')];K.last[it.key+'|'+lv]=1;
  K.msg=need?(lv==='t'?'נשמר. צלמו עכשיו את התמונה התחתונה.':'נשמר. צלמו עכשיו את התמונה העליונה.'):'נשמר ונשלח. אם התמונה טובה – אשרו אותה כחזית, או צלמו עוד תמונה.';
  await refreshQ();rerender()}
 catch(e){K.busy=0;K.msg='לא הצלחנו לשמור את התמונה בטלפון (אין מקום פנוי?). נסו שוב.';rerender()}};
const fn=(op,o)=>U.fn('s3CapPut',Object.assign({qid:U.qid(),mapId:K.mapId,key:K.cur,op},o||{}));
async function upd(r){if(r&&r.key){try{const d=await U.get('/s3setup/'+K.mapId+'/cap/'+r.key);if(d)K.docs[r.key]=d}catch(e){}}}
ACT.s3cpFront=async()=>{const it=itemOf(K.cur),L=it&&K.last[it.key];if(!L||K.busy)return;
 if(K.q[it.key])return toast('מחכים שהתמונות יישלחו…');
 K.busy=1;K.msg='שומרים את החזית…';rerender();
 try{const r=await fn('front',{img:await U.b64(L.full),th:await U.b64(L.th),man:true});await upd(r);K.msg='החזית אושרה.';const n=nextOf(it.key);if(n){K.cur=n;K.open=itemOf(n).room}}
 catch(e){K.msg=msgOf(e,'לא הצלחנו לשמור את החזית')}
 K.busy=0;rerender()};
const WHY=['מוסתר / אין גישה','אין כאן מה לצלם','יצולם אחר כך'];
ACT.s3cpSkip=()=>{const it=itemOf(K.cur);if(!it||K.busy)return;
 dlg(`<h3>לדלג על ${esc2(PL.label(it,K.map))}?</h3><p class="note">אפשר לסיים את ההקמה רק כשכל פריט צולם או דולג עם סיבה.</p><div class="chips">${WHY.map(w=>`<button class="chip" type="button" style="min-height:44px" data-a="s3cpWhy" data-w="${esc2(w)}">${esc2(w)}</button>`).join('')}</div>
 <label class="f"><span>סיבה</span><input id="s3kwhy" maxlength="120" style="min-height:44px"></label><div class="row"><button class="btn grow" data-a="s3cpSkipGo">דלגו</button><button class="btn g grow" data-a="closeDlg">ביטול</button></div>`)};
ACT.s3cpWhy=el=>{const i=document.getElementById('s3kwhy');if(i)i.value=el.dataset.w||''};
ACT.s3cpSkipGo=async()=>{const w=((document.getElementById('s3kwhy')||{}).value||'').trim();if(!w)return toast('כתבו סיבה');if(w.length>120)return toast('עד 120 תווים');closeDlg();
 const k=K.cur;K.busy=1;rerender();
 try{const r=await fn('skip',{why:w});await upd(r);const n=nextOf(k);if(n){K.cur=n;K.open=itemOf(n).room}K.msg=''}catch(e){K.msg=msgOf(e,'הדילוג נכשל')}
 K.busy=0;rerender()};
ACT.s3cpUnskip=async()=>{if(K.busy)return;K.busy=1;rerender();try{await upd(await fn('unskip'))}catch(e){K.msg=msgOf(e,'הפעולה נכשלה')}K.busy=0;rerender()};
ACT.s3cpNext=()=>{if(K.busy)return;const n=nextOf(K.cur);if(n){K.cur=n;K.open=itemOf(n).room}K.msg='';rerender()};
ACT.s3cpSel=el=>{if(K.busy)return;K.cur=el.dataset.k;K.msg='';rerender()};
ACT.s3cpRoom=el=>{K.open=K.open===el.dataset.r?'':el.dataset.r;rerender()};
ACT.s3cpDone=async()=>{if(K.busy)return;K.busy=1;K.miss=null;rerender();
 try{await U.fn('s3SetupDone',{qid:U.qid(),mapId:K.mapId});K.setup=Object.assign({},K.setup||{},{st:'done'});K.msg='ההקמה הסתיימה. כל החנות צולמה.'}
 catch(e){if(e&&e.reason==='not-done'){K.msg=e.message||'עוד יש פריטים שלא צולמו.'}else K.msg=msgOf(e,'לא הצלחנו לסיים')}
 K.busy=0;rerender()};
ACT.s3cpBack=()=>go('st3');
ACT.s3cpRetry=()=>{if(typeof ACT.s3cRetry==='function')ACT.s3cRetry();setTimeout(()=>refreshQ().then(()=>{if(onScr())rerender()}),300)};

/* ---------- המפה (SVG) ---------- */
const COL={ok:'var(--inc)',part:ORANGE,todo:'var(--bad)',skip:'var(--mut)'};
function svgMap(){
 const m=K.map,items=K.plan.items,rooms=(m.rooms||[]).filter(r=>r&&r.del!==1&&Array.isArray(r.p));
 let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;for(const r of rooms)for(let i=0;i+1<r.p.length;i+=2){x0=Math.min(x0,r.p[i]);x1=Math.max(x1,r.p[i]);y0=Math.min(y0,r.p[i+1]);y1=Math.max(y1,r.p[i+1])}
 if(!(x1>x0))return '';const pad=40,W=x1-x0+2*pad,H=y1-y0+2*pad,u=Math.max(W,H)/180;
 let h=`<svg class="s3kmap" viewBox="${x0-pad} ${y0-pad} ${W} ${H}" role="img" aria-label="מפת החנות עם תוכנית הצילום" preserveAspectRatio="xMidYMid meet">`;
 for(const r of rooms)h+=`<polygon points="${r.p.join(' ')}" fill="var(--card)" stroke="var(--line)" stroke-width="${u}"/>`;
 const cur=itemOf(K.cur);
 const draw=(it,col,w)=>{const g=it.geo;
  if(it.k==='fl'||it.k==='ce')return `<rect x="${g[0]}" y="${g[1]}" width="${g[2]}" height="${g[3]}" fill="${col}" fill-opacity="${it===cur?.35:.12}" stroke="${col}" stroke-width="${w*.6}"/>`;
  if(it.k==='d'||it.k==='k')return `<circle cx="${g[0]}" cy="${g[1]}" r="${u*(it===cur?6:4)}" fill="${col}" stroke="var(--card)" stroke-width="${u}"/>`;
  return `<line x1="${g[0]}" y1="${g[1]}" x2="${g[2]}" y2="${g[3]}" stroke="${col}" stroke-width="${w}" stroke-linecap="round"/>`};
 for(const it of items){if(it.k==='ce'||it===cur)continue;if(it.k==='fl')h+=draw(it,COL[stOf(it)],u)}
 for(const it of items){if(it.k==='ce'||it.k==='fl'||it===cur)continue;h+=draw(it,COL[stOf(it)],u*2.2)}
 if(cur)h+=draw(cur,GOLD,u*4);
 return h+'</svg>'}

/* ---------- המסך ---------- */
const CSS=document.createElement('style');
CSS.textContent=`.s3kmap{display:block;width:100%;height:220px;background:var(--bg);border:1px solid var(--line);border-radius:var(--r-m,10px);margin:8px 0}
.s3kleg{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:.85rem;color:var(--mut)}.s3kleg i{display:inline-block;width:12px;height:12px;border-radius:3px;margin-inline-end:4px;vertical-align:-1px}
.s3kcc{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}.s3kcc button{min-width:44px;min-height:44px;border-radius:var(--r-m,10px);border:2px solid var(--line);background:var(--card);color:var(--ink);font:inherit;font-weight:700;padding:0 8px;cursor:pointer}
.s3kcc button.ok{border-color:var(--inc);color:var(--inc)}.s3kcc button.part{border-color:${ORANGE};color:${ORANGE}}.s3kcc button.todo{border-color:var(--bad);border-style:dashed;color:var(--bad)}.s3kcc button.skip{border-color:var(--mut);color:var(--mut)}
.s3kcc button.cur{background:${GOLD};border-color:${GOLD};border-style:solid;color:#1b1b1f}.s3k .row label.btn,.s3k .row .btn{flex:1;min-width:130px;min-height:44px}`;
document.head.appendChild(CSS);
const SH={b:'מ',w:'ק',iw:'ק',d:'ד',k:'₪',fl:'ר',ce:'ת'};
const chipTx=it=>it.k==='b'?`${(it.num||'')}${it.side==='b'?'ב':''}·${it.n}`:it.k==='w'?`ק${it.edge}·${it.seg}`:it.k==='iw'?`פ${it.seg}${it.side==='b'?'ב':''}`:it.k==='fl'||it.k==='ce'?`${SH[it.k]}${it.n}`:SH[it.k]+String(it.ref).replace(/^[a-z]+/,'');
function curCard(){
 const it=itemOf(K.cur);if(!it)return '';
 const d=K.docs[it.key]||{},s=stOf(it),ph=(Array.isArray(d.ph)?d.ph:[]).filter(p=>p&&!p.off).length+(K.q[it.key]|0);
 const ST={ok:'הושלם',part:'צולם – עוד לא אושר',todo:'עוד לא צולם',skip:'דולג'};
 let h=`<div class="s3info"><b>${esc2(PL.label(it,K.map))}</b> <small>(${it.ord} מתוך ${K.plan.n})</small><br>${esc2(PL.guide(it))}<br><small>${ST[s]}${ph?` · ${ph} תמונות`:''}${s==='skip'&&d.why?' · '+esc2(d.why):''}${d.st==='ok'&&s==='part'?' · המקום השתנה במפה – צלמו שוב':''}</small></div>`;
 /* שלב 4ב: הנחיית צילום למקטע של יותר מתמונה אחת (מדף גבוה, או שכבר יש תמונה) – מקטינה פרלקסה בתפרים */
 if(it.k==='b'&&(it.lv.length>1||ph>=1))h+=`<p class="note s3note" data-tip="wp">צלמו מאותו מרחק ובזווית ישרה; כוונו שהחיבור בין תמונות ייפול על שפת מדף או על עמוד.</p>`;
 const cam=(lv,t)=>`<label class="btn">${t}<input type="file" accept="image/*" capture="environment" data-c="s3cpPick" data-lv="${lv}" hidden></label>`;
 h+=`<div class="row s3row">${it.lv.length>1?cam('t','צלמו עליון')+cam('b','צלמו תחתון'):cam('a','צלמו')}</div>`;
 h+=`<div class="row s3row">${K.last[it.key]&&s!=='ok'?`<button class="btn" data-a="s3cpFront">אשרו כחזית</button>`:''}${typeof U.wpBtn==='function'?U.wpBtn(it,s):''/* שלב 4: נקודת החיבור היחידה לעורך "חיבור וחיתוך" (store3d-crop.js) */}${typeof U.aiBtn==='function'?U.aiBtn(it,s):''/* שלב 5: "בדיקה חכמה" / "המערכת מציעה" (store3d-capai.js) */}${s==='skip'?`<button class="btn g" data-a="s3cpUnskip">בטלו את הדילוג</button>`:`<button class="btn g" data-a="s3cpSkip">דלגו (עם סיבה)</button>`}<button class="btn g" data-a="s3cpNext">הבא</button></div>`;
 return h}
V.st3k=()=>{const T='צילום החנות';
 if(!loggedIn()||!U.feat())return{t:T,h:'<div class="empty">תלת מימד לא מופעל בעסק הזה</div>'};
 if(!U.canDraw())return{t:T,h:'<div class="card s3s"><p style="margin:0">צילום החנות מותר למנהל או לעובד עם הרשאת "שרטוט מפה".</p><button class="btn" style="margin-top:10px" data-a="s3cpBack">למפת החנות</button></div>'};
 if(K.own!==me()||!K.mapId)return{t:T,h:'<div class="card s3s"><p style="margin:0">לא נבחרה מפה.</p><button class="btn" style="margin-top:10px" data-a="s3cpBack">למפת החנות</button></div>'};
 if(K.err)return{t:T,h:`<div class="card s3s"><p style="margin:0" role="alert">${esc2(K.err)}</p><div class="row s3row"><button class="btn" data-a="s3cpReload">נסו שוב</button><button class="btn g" data-a="s3cpBack">למפת החנות</button></div></div>`};
 if(!K.plan)return{t:T,h:'<div class="empty">טוען את תוכנית הצילום…</div>'};
 if(!K.plan.n)return{t:T,h:'<div class="card s3s"><p style="margin:0">אין במפה מה לצלם. שרטטו חדר אחד לפחות.</p><button class="btn" style="margin-top:10px" data-a="s3cpBack">למפת החנות</button></div>'};
 const c={ok:0,part:0,todo:0,skip:0};for(const it of K.plan.items)c[stOf(it)]++;const dn=c.ok+c.skip,N=K.plan.n,off=navigator.onLine===false,qn=Object.values(K.q).reduce((a,b)=>a+b,0);
 let h=`<div class="card s3s s3k">`;
 if(off)h+=`<div class="ban s3off" role="status">אין חיבור – התמונות נשמרות בטלפון ויישלחו כשיש רשת</div>`;
 if(qn)h+=`<div class="ban s3off" role="status">${qn===1?'תמונה אחת ממתינה':qn+' תמונות ממתינות'} לשליחה</div>`;
 if(K.qf&&K.qf.length)h+=`<div class="ban s3warn" role="alert">${K.qf.length} תמונות לא נשלחו${K.qf[0].fail?': '+esc2(K.qf[0].fail):''}<div class="row s3row"><button class="btn" data-a="s3cpRetry">נסו שוב</button></div></div>`;
 if(K.setup&&K.setup.st==='done')h+=`<div class="ban s3off" role="status">ההקמה הסתיימה. אפשר להמשיך לצלם כדי לעדכן.</div>`;
 h+=`<b>הושלמו ${dn} מתוך ${N}</b><div class="s3bar"><i style="width:${Math.round(100*dn/N)}%"></i></div>
 <div class="s3kleg"><span><i style="background:${GOLD}"></i>עכשיו</span><span><i style="background:var(--inc)"></i>הושלם ${c.ok}</span><span><i style="background:${ORANGE}"></i>צולם ${c.part}</span><span><i style="background:var(--bad)"></i>חסר ${c.todo}</span>${c.skip?`<span><i style="background:var(--mut)"></i>דולג ${c.skip}</span>`:''}</div>`;
 h+=svgMap();
 if(K.busy)h+=`<div class="s3info" role="status">${esc2(K.msg||'רגע…')}</div>`;
 else{h+=curCard();if(K.msg)h+=`<div class="s3info" role="status">${esc2(K.msg)}</div>`}
 const rooms=[];for(const it of K.plan.items){let g=rooms[rooms.length-1];if(!g||g.r!==it.room){g=rooms.find(x=>x.r===it.room);if(!g){g={r:it.room,L:[]};rooms.push(g)}}g.L.push(it)}
 h+=`<p class="note s3note">הסדר המומלץ: דלת, קירות עם כיוון השעון, גופים לפי המספור, דלתות וקופות, רצפה ותקרה. אפשר לבחור כל פריט.</p>`;
 for(const g of rooms){const rm=(K.map.rooms||[]).find(r=>r.id===g.r),o=K.open===g.r,gd=g.L.filter(doneOf).length;
  h+=`<div class="s3g"><button class="hd" data-a="s3cpRoom" data-r="${esc2(g.r)}" aria-expanded="${o}"><span>${esc2(rm&&rm.name||'חדר')}</span><span>${gd}/${g.L.length}</span></button>${o?`<div class="s3kcc">${g.L.map(it=>`<button type="button" class="${stOf(it)}${it.key===K.cur?' cur':''}" data-a="s3cpSel" data-k="${esc2(it.key)}" aria-label="${esc2(PL.label(it,K.map))}">${esc2(chipTx(it))}</button>`).join('')}</div>`:''}</div>`}
 h+=`<div class="row s3row"><button class="btn" data-a="s3cpDone" ${dn===N&&!qn?'':'disabled'}>סיום ההקמה</button><button class="btn g" data-a="s3cpBack">מפת החנות</button></div>`;
 if(dn<N)h+=`<p class="note s3note">"סיום ההקמה" ייפתח כשכל פריט יושלם או ידולג עם סיבה (חסרים ${N-dn}).</p>`;
 return{t:T,h:h+'</div>'}};
window.addEventListener('online',()=>{if(onScr()&&!typing())rerender()});
window.addEventListener('offline',()=>{if(onScr()&&!typing())rerender()});
})();
