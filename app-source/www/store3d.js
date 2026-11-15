/* סריקת חנות בתלת מימד – שלב 3 (משימה 2026-11-14_סריקת-חנות-תלת-מימד): מסגרת המסכים.
   קובץ עצמאי, נטען אחרי index.html (ואחרי store3d-geo.js ו-store3d-view.js). לא משנה קוד קיים: רק עוטף (wrap) את מסך הבית של המנהל (V.home)
   ואת מסך הבית של העובד (V.wk), ומוסיף את מסך V.st3 (מסך ראשי עם לשוניות). העורך נמצא ב-store3d-editor.js.
   מה יש כאן:
   1. חלון בבית (מתחת להכנסות ולמזכירה): מנהל – מפה מיני (בלי מגע), ציון וסבב הבא; עובד – המשימה שלו.
   2. חלון הזמנה "בנה את החנות שלך בתלת מימד" כשעוד אין מפה (למנהל / עובד עם הרשאת שרטוט s3m). אפשר להסתיר (ונשאר שורת קישור קטנה).
   3. מסך ראשי: מפה במרכז (מלמעלה / הליכה) + לשוניות סבבים, דוחות, המלצות, הגדרות – מוצגות רק למנהל. עובד בלי הרשאה רואה רק את המפה והמשימה שלו.
   נתונים: smap/s-<סניף> (ו-w- למחסן), s3sum, sround (מנהל), s3br – קריאה ישירה (REST, כמו שאר המסכים). עובד קורא סבבים רק דרך s3View (פונקציית שרת, שלב 10 –
   עד שהיא קיימת מוצגת הודעה "לא ניתן לטעון"). אין נתוני דוגמה במסך אמיתי: בלי מפה – אין מפה (לא מפת דוגמה). */
(function(){
'use strict';
if(typeof ACT==='undefined'||typeof V==='undefined'||typeof fvj==='undefined'||typeof fsx==='undefined')return;
const X={d:null,at:0,busy:0,br:'',kind:'s',tab:'map',mode:'top',pick:null,h:null,seq:0,runs:null,runsAt:0,runsErr:'',busyR:0,take:[]};
const S3UI={X};window.S3UI=S3UI;
const esc2=s=>typeof esc==='function'?esc(s):String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const keyBiz=()=>(SY&&SY.bizId||'')+'|'+(SY&&SY.uid||'');

/* ---------- הרשאות ---------- */
const feat=()=>{try{const b=SY&&SY.biz;return !!(b&&b.features&&b.features.store3d===true)&&bzF('store3d')}catch(e){return false}};
const isMgr=()=>!isW()&&(isA()||!!(SY&&SY.sa));
const canDraw=()=>isMgr()||(isW()&&!!(SY&&SY.perms&&typeof SY.perms==='object'&&SY.perms.s3m===true));
const loggedIn=()=>!!(SY&&SY.refresh&&SY.uid);
S3UI.feat=feat;S3UI.isMgr=isMgr;S3UI.canDraw=canDraw;

/* ---------- סניף נבחר ---------- */
const brs=()=>{let L=[];try{L=brList()}catch(e){}return L.length?L:[{id:'main',name:'החנות'}]};
const brSel=()=>{const L=brs();return L.some(b=>b.id===X.br)?X.br:L[0].id};
const mapIdOf=(k,br)=>(k==='w'?'w-':'s-')+(br||brSel());
S3UI.brs=brs;S3UI.brSel=brSel;S3UI.mapIdOf=mapIdOf;

/* ---------- קריאת נתונים ---------- */
const dec=d=>d&&d.fields?Object.fromEntries(Object.entries(d.fields).map(([k,v])=>[k,fvj(v)])):null;
S3UI.dec=dec;
const msgOf=e=>e&&e.offline?'אין חיבור לאינטרנט. בדקו את החיבור ונסו שוב.':e&&e.code===403?'אין לכם הרשאה לצפות בתלת מימד בעסק הזה.':'לא הצלחנו לטעון את נתוני החנות. נסו שוב.';
const g404=async p=>{try{return dec(await fsx(p))}catch(e){if(e&&e.code===404)return null;throw e}};
S3UI.get=g404;S3UI.esc2=esc2;
/* שלב 7: קריאה לפונקציית שרת. מנהל־על שעבר לעסק אחר (bzSwitch) שולח את העסק בקלט – השרת מקבל bizId רק ממנהל־על (takeBizInput) */
S3UI.fn=(n,d)=>window.fnCall(n,(SY&&SY.sa&&SY.bizId)?Object.assign({bizId:SY.bizId},d||{}):(d||{}));
/* שגיאות שרת (details.reason) בעברית פשוטה */
S3UI.RS={'br-off':'התלת מימד כבוי בסניף הזה. מנהל־על צריך להפעיל אותו לפני שמירת מפה.','no-wh':'לסניף הזה אין מחסן בתלת מימד. מנהל־על צריך להפעיל מחסן.','tex-day':'הגעתם למכסת תמונות הטקסטורה להיום (200 למפה). נסו שוב מחר.','run-open':'כבר יש סבב פתוח לכלל הזה.','no-map':'אין מפה בסניף הזה.','map-deleted':'המפה של הסבב נמחקה.','no-rule':'כלל הסבב לא נמצא.','no-take':'אי אפשר לקחת חלק מהסבב הזה.','other-branch':'הסבב הזה שייך לסניף אחר.','run-closed':'הסבב כבר הסתיים.','not-assigned':'אינכם משויכים לסבב הזה.','staff-disabled':'העובד הזה מושבת.','manager-only':'רק מנהל יכול לבצע את זה.','s3-month-limit':'מכסת הבדיקות החודשית של הסניף נגמרה. פנו למנהל המערכת.','s3-user-day':'הגעתם למכסה היומית. נסו שוב מחר.','s3-adhoc-day':'הגעתם למכסת הדיווחים היומית. נסו שוב מחר.','gemini-quota':'שירות ה-AI עמוס כרגע. נסו שוב בעוד כמה דקות.','time-budget':'הבדיקה לקחה יותר מדי זמן. נסו שוב.','bad-answer':'ה-AI לא החזיר תשובה שאפשר להשתמש בה. נסו שוב, או צלמו תמונות ברורות יותר.','bad-img-count':'צריך בין תמונה אחת ל-40 תמונות.','too-big':'התמונות גדולות מדי. מחקו כמה תמונות ונסו שוב.','busy':'השרת עסוק. נסו שוב בעוד רגע.','not-s3m':'אין לכם הרשאת שרטוט מפה.','too-many':'יותר מדי צילומים למקום הזה.'};
S3UI.errText=(e,d)=>e&&e.offline?'אין חיבור לאינטרנט. נסו שוב כשיש חיבור.':(e&&S3UI.RS[e.reason])||(e&&e.message)||d||'הפעולה נכשלה';
async function load(force){
 if(!feat()||!loggedIn())return;
 const br=brSel(),k=keyBiz()+'|'+br;
 if(X.busy||(!force&&X.d&&X.d.key===k&&Date.now()-X.at<60000))return;
 X.busy=1;const d={key:k,br,cfg:{wh:false,on:true,cap:500},maps:{},sum:null,rounds:null,err:''};
 try{
  const c=await g404('/s3br/'+br);if(c){if(typeof c.wh==='boolean')d.cfg.wh=c.wh;if(typeof c.on==='boolean')d.cfg.on=c.on;if(Number.isInteger(c.cap))d.cfg.cap=c.cap}
  d.maps.s=await g404('/smap/s-'+br);
  if(d.cfg.wh)d.maps.w=await g404('/smap/w-'+br);
  if(d.maps.s&&d.maps.s.del===1)d.maps.s=null;
  if(d.maps.w&&d.maps.w.del===1)d.maps.w=null;
 }catch(e){d.err=msgOf(e)}
 if(!d.err&&d.maps.s){try{d.sum=await g404('/s3sum/s-'+br)}catch(e){}
  if(isMgr()){try{const r=await fsx('/sround?pageSize=100');d.rounds=((r&&r.documents)||[]).map(x=>{const o=dec(x);if(o)o.rid=String(x.name||'').split('/').pop();return o}).filter(x=>x&&x.br===br&&x.on===true&&x.del!==1)}catch(e){d.rounds=null}}}
 X.d=d;X.at=Date.now();X.busy=0;
 const v=cur().v;if((v==='home'||v==='st3'||v==='st3e'||v==='st3w'||v==='wk')&&!typing())rerender();
}
const typing=()=>{const a=document.activeElement;return !!(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)&&a.closest('#main'))};
S3UI.load=load;S3UI.data=()=>X.d;S3UI.drop=()=>{X.d=null;X.at=0};
const dataOk=()=>!!(X.d&&X.d.key===keyBiz()+'|'+brSel());
S3UI.dataOk=dataOk;
/* משימות העובד (דרך s3View, פונקציית שרת מצד אחר – ייתכן שעוד לא קיימת) */
async function loadRuns(force){
 if(!isW()||!feat()||X.busyR||(!force&&Date.now()-X.runsAt<60000))return;
 X.busyR=1;X.runsAt=Date.now();
 try{const r=await S3UI.fn('s3View',{});X.runs=Array.isArray(r&&r.runs)?r.runs:[];X.take=Array.isArray(r&&r.take)?r.take:[];X.fixes=Array.isArray(r&&r.fixes)?r.fixes:[];X.past=Array.isArray(r&&r.past)?r.past:[];X.runsErr='';try{if(S3UI.onRuns)S3UI.onRuns(X.runs)}catch(e2){}}catch(e){X.runs=null;X.runsErr=e&&e.offline?'אין חיבור לאינטרנט':'לא ניתן לטעון את המשימה כרגע'}
 X.busyR=0;const v=cur().v;if((v==='st3'||v==='wk')&&!typing())rerender();
}

S3UI.loadRuns=loadRuns;
/* ---------- עיצוב: כהה עם זהב ---------- */
const css=document.createElement('style');
css.textContent=`/* עיצוב לפי מערכת העיצוב של האפליקציה (טוקנים: --card --line --ink --mut --acc --onacc --bad --warn --inc --r-m --r-l). בלי צבעים קשיחים. הרכיבים עצמם: .card .btn .chip .chips .row .note .ban .kg .k */
.s3c{display:block;width:100%;text-align:right;font:inherit;color:var(--ink);cursor:pointer}.s3c:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
.s3c small{display:block;color:var(--mut);margin-top:2px}.s3c .s3mini{height:170px;border-radius:var(--r-m,12px);overflow:hidden;margin:10px 0;position:relative;background:var(--srf-0,var(--bg));border:1px solid var(--line);pointer-events:none}
.s3c .s3mini canvas{pointer-events:none}.s3c .kg .k small{margin:0}.s3c .kg .k b{display:block;font-size:1.1rem}
.s3row{margin-top:10px}.s3s{padding:12px}
.s3tabs{display:flex;flex-wrap:nowrap;gap:8px;overflow-x:auto;margin:0 0 10px;padding-bottom:4px}.s3tabs .chip{flex:none}
.s3main{height:min(58vh,460px);min-height:300px;border-radius:var(--r-m,12px);overflow:hidden;position:relative;background:var(--srf-0,var(--bg));border:1px solid var(--line)}
.s3info{margin-top:8px;background:var(--bg);color:var(--ink);border:1px solid var(--line);border-radius:var(--r-m,12px);padding:10px 12px;min-height:40px;font-size:.92rem}.s3info small{color:var(--mut)}
.s3err{border-color:var(--bad);border-width:1.5px}.s3note{margin:8px 0 0}
.ban.s3off,.ban.s3warn{display:block;cursor:default;min-height:0;margin:8px 0;font-size:.9rem}.ban.s3warn{border-color:var(--bad)}
.s3st{display:flex;gap:4px;flex-wrap:nowrap;margin:0 0 10px;padding:0;list-style:none}.s3st li{flex:1 1 0;min-width:0;text-align:center;font-size:.72rem;padding:6px 2px;white-space:nowrap;border-radius:var(--r-m,12px);border:1px solid var(--line);color:var(--mut);background:var(--card)}
.s3st li.on{background:var(--acc);border-color:var(--acc);color:var(--onacc);font-weight:700}.s3st li.dn{border-color:var(--inc);color:var(--ink)}`;
document.head.appendChild(css);

/* ---------- חלונות בבית ---------- */
const hideKey=()=>LK('lp-s3hide');
const hidden=()=>{try{return localStorage.getItem(hideKey())==='1'}catch(e){return false}};
const when=ms=>{try{return new Date(ms).toLocaleDateString('he-IL',{weekday:'long',day:'numeric',month:'numeric'})}catch(e){return ''}};
function nextRound(d){const L=(d&&d.rounds||[]).map(r=>+r.next).filter(n=>n>0);return L.length?Math.min(...L):0}
function invite(){
 if(hidden())return `<button type="button" class="btn g" style="width:100%;margin-top:12px" data-a="st3Open" aria-label="תלת מימד">תלת מימד – בנו את החנות</button>`;
 return `<div class="card s3c"><b style="font-size:1.05rem">בנו את החנות שלכם בתלת מימד</b><small>מצלמים את החנות, והמערכת בונה לבד טיוטה של המפה. אתם עוברים עליה ומאשרים, ואז אפשר לבדוק את המדפים ולראות הכול על המפה.</small>
 <div class="row s3row"><button class="btn" data-a="st3Build">בואו נתחיל</button><button class="btn g" data-a="st3Hide">הסתר</button></div></div>`}
function homeMgr(){
 if(!dataOk()){load();return ''}
 const d=X.d;if(d.err)return '';
 if(!d.maps.s)return canDraw()?invite():'';
 const sc=d.sum&&Number.isInteger(d.sum.score)?d.sum.score:null,nx=nextRound(d);
 return `<div class="card s3c" data-a="st3Open" role="button" tabindex="0" style="cursor:pointer"><b style="font-size:1.05rem">החנות בתלת מימד</b><small>${esc2(d.maps.s.name||'')}</small>
 <div class="s3mini" id="s3mini" aria-hidden="true"></div>
 <div class="kg"><div class="k"><small>ציון אחרון</small><b>${sc==null?'עוד אין':sc}</b></div><div class="k"><small>הסבב הבא</small><b>${nx?esc2(when(nx)):'לא נקבע'}</b></div></div></div>`}
/* תשובת s3View האמיתית: {runId, st, openAt, dueAt, map, mapV, n:{n,d}} (n = מקטעים שלי, d = צולמו). אין שם לסבב */
const rprog=r=>{const o=r&&r.n&&typeof r.n==='object'?r.n:null;return o&&Number.isFinite(+o.n)&&Number.isFinite(+o.d)?`צולמו ${+o.d} מתוך ${+o.n}`:''};
const rlate=r=>r&&r.st==='late'?' · באיחור':'';
function homeWk(){
 if(!isW())return '';
 if(X.runs===null&&!X.runsErr)loadRuns();
 else if(Date.now()-X.runsAt>60000)loadRuns();
 const L=X.runs||[];
 if(L.length){const r=L[0];return `<button type="button" class="card s3c" data-a="${typeof ACT.s3cOpen==='function'?'s3cOpen':'st3Open'}" data-id="${esc2(r.runId||'')}" style="cursor:pointer"><b style="font-size:1.05rem">המשימה שלך: סבב בדיקת מדפים</b><small>${esc2(rprog(r))}${r.dueAt?` · עד ${esc2(when(+r.dueAt))}`:''}${rlate(r)}</small></button>`}
 if(canDraw()){if(!dataOk()){load();return ''}if(X.d.maps.s)return `<button type="button" class="card s3c" data-a="st3Open" style="cursor:pointer"><b>מפת החנות בתלת מימד</b><small>צפייה ועריכה</small></button>`;return invite()}
 return ''}
const homeH=()=>{try{if(!feat()||!loggedIn())return '';return isW()?homeWk():(isMgr()?homeMgr():'')}catch(e){return ''}};
{const h=V.home;if(h)V.home=()=>{const r=h();try{const c=isMgr()?homeH():'';if(c&&r&&typeof r.h==='string'){if(/<div class="chips hacts"/.test(r.h))r.h=r.h.replace(/(<div class="chips hacts")/,()=>c+'<div class="chips hacts"');else r.h+=c}}catch(e){}return r}}
{const w=V.wk;if(w)V.wk=function(){const r=w.apply(this,arguments);try{if(isW()&&typeof WS!=='undefined'&&WS==='home'&&r&&typeof r.h==='string'){const c=homeH();if(c)r.h+=c}}catch(e){}return r}}

ACT.st3Open=()=>{if(cur().v!=='st3')go('st3')};
ACT.st3Hide=()=>{try{localStorage.setItem(hideKey(),'1')}catch(e){}rerender()};
ACT.st3Build=el=>{try{localStorage.removeItem(hideKey())}catch(e){}const k=el&&el.dataset&&el.dataset.k==='w'?'w':'s';if(typeof S3UI.openWizard==='function')S3UI.openWizard(k);else if(typeof S3UI.openEditor==='function')S3UI.openEditor(k);else go('st3')};

/* ---------- המסך הראשי ---------- */
const TABS=[['map','מפה'],['rounds','סבבים'],['rep','דוחות'],['recs','המלצות'],['set','הגדרות']];
const tabsFor=()=>TABS.filter(([k])=>k==='map'||isMgr()||(k==='rep'&&isW())).map(t=>t[0]==='rep'&&!isMgr()?['rep','הדוח שלי']:t);
function pickInfo(){const b=X.pick;if(!b)return 'הקישו על מדף במפה כדי לבחור אותו.';return `גוף ${esc2(b.num||'')}${b.name?' ('+esc2(b.name)+')':''} · צד ${b.s==='a'?'ראשי':'שני'} · מקטע ${esc2(b.n)}`+(typeof S3UI.cardOpen==='function'?`<div class="row s3row"><button class="btn s" data-a="s3kOpen">כרטיס המדף</button></div>`:'')}
function mapPane(d){
 const kind=X.kind==='w'&&d.maps.w?'w':'s',m=d.maps[kind];
 let h='';
 if(d.cfg.wh&&d.maps.w)h+=`<div class="chips" style="margin:0 0 8px"><button class="chip ${kind==='s'?'on':''}" data-a="st3Kind" data-k="s">החנות</button><button class="chip ${kind==='w'?'on':''}" data-a="st3Kind" data-k="w">המחסן</button></div>`;
 if(!m){h+=`<p class="note s3note">${kind==='w'?'עוד לא נבנתה מפה למחסן.':'עוד לא נבנתה מפה לסניף הזה.'}</p>${canDraw()?`<div class="row"><button class="btn" data-a="st3Build" data-k="${kind}">בנו מתמונות</button><button class="btn g" data-a="st3Edit" data-k="${kind}">ציור ידני</button></div>`:''}`;return h}
 h+=`<div class="row s3row" style="margin:0 0 8px"><button class="chip ${X.mode==='top'?'on':''}" data-a="st3Mode" data-m="top">מבט מלמעלה</button><button class="chip ${X.mode==='walk'?'on':''}" data-a="st3Mode" data-m="walk">הליכה בחנות</button>${canDraw()?`<button class="btn g" style="margin-inline-start:auto" data-a="st3Edit" data-k="${kind}">עריכת המפה</button>`:''}</div>
 <div class="s3main" id="s3main"></div><div class="s3info" id="s3info" aria-live="polite">${pickInfo()}</div>`;
 if(d.cfg.on===false)h+=`<div class="ban s3off">הסניף הזה כבוי בתלת מימד</div>`;
 return h}
function workerTask(){
 if(X.runs===null&&!X.runsErr)loadRuns();
 if(X.runsErr)return `<div class="s3info">${esc2(X.runsErr)}</div>`;
 if(X.runs===null)return `<div class="s3info">טוען את המשימה…</div>`;
 if(!X.runs.length)return `<div class="s3info">אין לך משימה פתוחה כרגע.</div>`+(typeof S3UI.takeHtml==='function'?S3UI.takeHtml(X.take):'');
 return X.runs.map(r=>`<div class="s3info"><b>סבב בדיקת מדפים</b><br>${esc2(rprog(r))}${r.dueAt?` · עד ${esc2(when(+r.dueAt))}`:''}${rlate(r)}<div class="row s3row"><button class="btn" data-a="s3cOpen" data-id="${esc2(r.runId||'')}">${(r.n&&+r.n.d>0)?'המשך צילום':'התחל צילום'}</button></div></div>`).join('')+(typeof S3UI.takeHtml==='function'?S3UI.takeHtml(X.take):'')}
V.st3=()=>{const T='החנות בתלת מימד';
 if(!loggedIn()||!feat())return{t:T,h:'<div class="empty">תלת מימד לא מופעל בעסק הזה</div>'};
 if(!dataOk()){load();return{t:T,h:'<div class="empty">טוען…</div>'}}
 const d=X.d;if(d.err)return{t:T,h:`<div class="card s3s"><p style="margin:0">${esc2(d.err)}</p><button class="btn" style="margin-top:10px" data-a="st3Retry">נסו שוב</button></div>`};
 const L=brs();let h='';
 if(L.length>1)h+=`<div class="chips" style="margin:0 0 8px">${L.map(b=>`<button class="chip ${b.id===d.br?'on':''}" data-a="st3Br" data-id="${esc2(b.id)}">${esc2(b.name)}</button>`).join('')}</div>`;
 const tb=tabsFor();if(!tb.some(t=>t[0]===X.tab))X.tab='map';
 if(tb.length>1)h+=`<div class="s3tabs" role="tablist">${tb.map(([k,l])=>`<button role="tab" aria-selected="${X.tab===k}" class="chip ${X.tab===k?'on':''}" data-a="st3Tab" data-k="${k}">${l}</button>`).join('')}</div>`;
 let body;
 if(X.tab==='map'){body=mapPane(d);if(isW())body=workerTask()+(typeof S3UI.fixHtml==='function'?S3UI.fixHtml():'')+body}
 else{const nm=(TABS.find(t=>t[0]===X.tab)||[])[1]||'';body=typeof S3UI.tabHtml==='function'?S3UI.tabHtml(X.tab,d):'';if(!body)body=`<p class="note s3note">המסך "${esc2(nm)}" ייפתח בשלב הבא של הפיתוח.</p>`}
 return{t:T,s:(L.find(b=>b.id===d.br)||{}).name||'',h:`<div class="card s3s">${h}${body}</div>`}};
ACT.st3Retry=()=>{X.d=null;X.at=0;rerender()};
ACT.st3Tab=el=>{X.tab=el.dataset.k;rerender()};
ACT.st3Kind=el=>{X.kind=el.dataset.k==='w'?'w':'s';X.pick=null;rerender()};
ACT.st3Br=el=>{X.br=el.dataset.id;X.kind='s';X.pick=null;X.d=null;rerender()};
ACT.st3Mode=el=>{X.mode=el.dataset.m==='walk'?'walk':'top';if(X.h&&X.h.handle&&X.h.id==='s3main')try{X.h.handle.setMode(X.mode)}catch(e){}$$('.s3s [data-a=st3Mode]').forEach(b=>b.classList.toggle('on',b.dataset.m===X.mode))};
ACT.st3Edit=el=>{if(typeof S3UI.openEditor==='function')S3UI.openEditor(el.dataset.k==='w'?'w':'s');else toast('העורך עוד לא נטען')};

/* ---------- ציור התלת מימד בתוך המסך ---------- */
/* מסך ראשי: נבנה מחדש אחרי כל ציור של המסך (כמו קודם). חלון הבית: מיני (Store3D.mini) שנשמר בין ציורים כל עוד המפה והסיכום לא השתנו (חתימה v/upd) –
   אלמנט ההדמיה (X.mn.node) עובר למיכל החדש בלי לבנות את הסצנה מחדש. יורד מהמסך = destroy. */
function unmount(){const h=X.h;X.h=null;if(h&&h.handle)try{h.handle.destroy()}catch(e){}}
function unmini(){const m=X.mn;X.mn=null;if(m&&m.api)try{m.api.destroy()}catch(e){}if(m&&m.node&&m.node.parentNode)m.node.parentNode.removeChild(m.node)}
const sig=(m,u)=>(m?(m.v|0)+':'+(m.upd|0):'-')+'|'+(u?(u.upd|0)+':'+(u.run||''):'-');
function mini(el,m,d){
 const sg=sig(m,d.sum);if(X.h)unmount();
 if(X.mn&&X.mn.node){el.appendChild(X.mn.node);if(X.mn.sg!==sg){try{X.mn.api.update(m,d.sum||null)}catch(e){}X.mn.sg=sg}return}
 if(!window.Store3D||!window.S3G||typeof window.Store3D.mini!=='function'){el.textContent='רכיב התצוגה לא נטען';return}
 const node=document.createElement('div');node.style.cssText='position:absolute;inset:0';el.appendChild(node);
 let api=null;try{api=window.Store3D.mini(node,m,d.sum||null)}catch(e){}
 X.mn={node,api,sg}}
function after(){
 try{if(S3UI.afterEd)S3UI.afterEd()}catch(e){}
 const mel=document.getElementById('s3mini'),id=document.getElementById('s3main')?'s3main':'';
 const d=X.d;
 if(mel&&d&&d.maps.s){mini(mel,d.maps.s,d);return}
 if(X.mn)unmini();
 if(!id){if(X.h)unmount();return}
 const el=document.getElementById(id);if(!d)return;
 const kind=X.kind==='w'&&d.maps.w?'w':'s',m=d.maps[kind];if(!m)return;
 if(X.h&&X.h.el===el)return;
 unmount();const tok=++X.seq,rec={el,id,handle:null};X.h=rec;
 if(!window.Store3D||!window.S3G){el.textContent='רכיב התצוגה לא נטען';return}
 window.Store3D.open(el,m,{mode:X.mode,sum:d.sum||null,onPick:b=>{X.pick=b;const i=document.getElementById('s3info');if(i)i.innerHTML=pickInfo()},onError:()=>{}}).then(hd=>{
  if(!hd)return;if(tok!==X.seq||X.h!==rec||!el.isConnected){try{hd.destroy()}catch(e){}return}rec.handle=hd}).catch(()=>{})
}
{const r0=window.render;if(typeof r0==='function')window.render=function(){/* אלמנט המיני יוצא מהדף לפני הציור (בלי להעביר צומת תוך כדי החלפת התוכן), וחוזר ב-after() */try{const n=X.mn&&X.mn.node;if(n&&n.parentNode)n.parentNode.removeChild(n)}catch(e){}const r=r0.apply(this,arguments);try{after()}catch(e){}return r}}
/* יציאה / החלפת עסק: ניקוי המטמון */
{const k0=()=>keyBiz();let last=k0();setInterval(()=>{const k=k0();if(k!==last){last=k;X.d=null;X.at=0;X.runs=null;X.fixes=null;X.runsAt=0;X.runsErr='';X.br='';unmount();unmini();try{if(window.Store3D&&Store3D.clearCache)Store3D.clearCache()}catch(e){}}},3000)}
})();
