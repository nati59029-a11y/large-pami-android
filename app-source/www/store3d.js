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
const X={d:null,at:0,busy:0,br:'',kind:'s',tab:'map',mode:'top',pick:null,h:null,seq:0,runs:null,runsAt:0,runsErr:'',busyR:0};
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
S3UI.get=g404;
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
  if(isMgr()){try{const r=await fsx('/sround?pageSize=100');d.rounds=((r&&r.documents)||[]).map(dec).filter(x=>x&&x.br===br&&x.on===true&&x.del!==1)}catch(e){d.rounds=null}}}
 X.d=d;X.at=Date.now();X.busy=0;
 const v=cur().v;if((v==='home'||v==='st3'||v==='st3e'||v==='wk')&&!typing())rerender();
}
const typing=()=>{const a=document.activeElement;return !!(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)&&a.closest('#main'))};
S3UI.load=load;S3UI.data=()=>X.d;S3UI.drop=()=>{X.d=null;X.at=0};
const dataOk=()=>!!(X.d&&X.d.key===keyBiz()+'|'+brSel());
S3UI.dataOk=dataOk;
/* משימות העובד (דרך s3View, פונקציית שרת מצד אחר – ייתכן שעוד לא קיימת) */
async function loadRuns(force){
 if(!isW()||!feat()||X.busyR||(!force&&Date.now()-X.runsAt<60000))return;
 X.busyR=1;X.runsAt=Date.now();
 try{const r=await window.fnCall('s3View',{});X.runs=Array.isArray(r&&r.runs)?r.runs:[];X.runsErr=''}catch(e){X.runs=null;X.runsErr=e&&e.offline?'אין חיבור לאינטרנט':'לא ניתן לטעון את המשימה כרגע'}
 X.busyR=0;const v=cur().v;if((v==='st3'||v==='wk')&&!typing())rerender();
}

/* ---------- עיצוב: כהה עם זהב ---------- */
const css=document.createElement('style');
css.textContent=`.s3c{display:block;width:100%;text-align:right;background:#15151a;color:#e8d9a8;border:1px solid #d4af37;border-radius:16px;padding:14px;margin:12px 0 0;font:inherit}
.s3c b{color:#f1d77a}.s3c small{display:block;color:#bfae7a;margin-top:2px}.s3c .s3mini{height:170px;border-radius:12px;overflow:hidden;margin:10px 0;position:relative;background:#23262c;pointer-events:none}
.s3c .s3mini canvas{pointer-events:none}.s3k{display:flex;gap:10px;flex-wrap:wrap}.s3k>div{flex:1;min-width:120px;background:#1e1e25;border-radius:10px;padding:8px 10px}
.s3k>div b{display:block;font-size:1.15rem}.s3b{min-height:44px;border:1px solid #d4af37;background:#d4af37;color:#141414;border-radius:12px;padding:0 16px;font-weight:700;font:inherit;font-weight:700;cursor:pointer}
.s3b.g{background:#24242c;color:#e8d9a8}.s3row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px}
.s3s{background:#15151a;color:#e8d9a8;border-radius:16px;padding:12px;margin:0 0 12px;border:1px solid #3a3320}
.s3tabs{display:flex;gap:6px;overflow-x:auto;margin:0 0 10px;padding-bottom:2px}.s3tabs button{flex:none;min-height:44px;padding:0 14px;border-radius:99px;border:1px solid #d4af37;background:#24242c;color:#e8d9a8;font:inherit;font-weight:700;cursor:pointer}
.s3tabs button.on{background:#d4af37;color:#141414}.s3main{height:min(58vh,460px);min-height:300px;border-radius:12px;overflow:hidden;position:relative;background:#23262c}
.s3info{margin-top:8px;background:#1e1e25;border-radius:10px;padding:8px 10px;min-height:40px;font-size:.92rem}.s3note{color:#bfae7a;font-size:.9rem;margin:8px 0 0}
.s3s .chip{background:#24242c;color:#e8d9a8;border-color:#d4af37}.s3s .chip.on{background:#d4af37;color:#141414}
.s3off{display:inline-block;background:#3a2a10;color:#f1d77a;border-radius:8px;padding:4px 10px;font-size:.85rem;margin-top:8px}`;
document.head.appendChild(css);

/* ---------- חלונות בבית ---------- */
const hideKey=()=>LK('lp-s3hide');
const hidden=()=>{try{return localStorage.getItem(hideKey())==='1'}catch(e){return false}};
const when=ms=>{try{return new Date(ms).toLocaleDateString('he-IL',{weekday:'long',day:'numeric',month:'numeric'})}catch(e){return ''}};
function nextRound(d){const L=(d&&d.rounds||[]).map(r=>+r.next).filter(n=>n>0);return L.length?Math.min(...L):0}
function invite(){
 if(hidden())return `<button type="button" class="s3b g" style="width:100%;margin-top:12px" data-a="st3Open" aria-label="תלת מימד">תלת מימד – בנו את החנות</button>`;
 return `<div class="s3c"><b style="font-size:1.05rem">בנו את החנות שלכם בתלת מימד</b><small>מציירים את המפה פעם אחת, ואז אפשר לבדוק את המדפים ולראות הכול על המפה.</small>
 <div class="s3row"><button class="s3b" data-a="st3Build">בואו נתחיל</button><button class="s3b g" data-a="st3Hide">הסתר</button></div></div>`}
function homeMgr(){
 if(!dataOk()){load();return ''}
 const d=X.d;if(d.err)return '';
 if(!d.maps.s)return canDraw()?invite():'';
 const sc=d.sum&&Number.isInteger(d.sum.score)?d.sum.score:null,nx=nextRound(d);
 return `<div class="s3c" data-a="st3Open" role="button" tabindex="0" style="cursor:pointer"><b style="font-size:1.05rem">החנות בתלת מימד</b><small>${esc2(d.maps.s.name||'')}</small>
 <div class="s3mini" id="s3mini" aria-hidden="true"></div>
 <div class="s3k"><div><small>ציון אחרון</small><b>${sc==null?'עוד אין':sc}</b></div><div><small>הסבב הבא</small><b>${nx?esc2(when(nx)):'לא נקבע'}</b></div></div></div>`}
function homeWk(){
 if(!isW())return '';
 if(X.runs===null&&!X.runsErr)loadRuns();
 else if(Date.now()-X.runsAt>60000)loadRuns();
 const L=X.runs||[];
 if(L.length){const r=L[0];return `<button type="button" class="s3c" data-a="st3Open" style="cursor:pointer"><b style="font-size:1.05rem">המשימה שלך: ${esc2(r.name||'סבב בדיקת מדפים')}</b><small>${Number.isFinite(+r.nDone)&&Number.isFinite(+r.n)?`צולמו ${+r.nDone} מתוך ${+r.n}`:''}${r.dueAt?` · עד ${esc2(when(+r.dueAt))}`:''}</small></button>`}
 if(canDraw()){if(!dataOk()){load();return ''}if(X.d.maps.s)return `<button type="button" class="s3c" data-a="st3Open" style="cursor:pointer"><b>מפת החנות בתלת מימד</b><small>צפייה ועריכה</small></button>`;return invite()}
 return ''}
const homeH=()=>{try{if(!feat()||!loggedIn())return '';return isW()?homeWk():(isMgr()?homeMgr():'')}catch(e){return ''}};
{const h=V.home;if(h)V.home=()=>{const r=h();try{const c=isMgr()?homeH():'';if(c&&r&&typeof r.h==='string'){if(/<div class="chips hacts"/.test(r.h))r.h=r.h.replace(/(<div class="chips hacts")/,()=>c+'<div class="chips hacts"');else r.h+=c}}catch(e){}return r}}
{const w=V.wk;if(w)V.wk=function(){const r=w.apply(this,arguments);try{if(isW()&&typeof WS!=='undefined'&&WS==='home'&&r&&typeof r.h==='string'){const c=homeH();if(c)r.h+=c}}catch(e){}return r}}

ACT.st3Open=()=>{if(cur().v!=='st3')go('st3')};
ACT.st3Hide=()=>{try{localStorage.setItem(hideKey(),'1')}catch(e){}rerender()};
ACT.st3Build=()=>{try{localStorage.removeItem(hideKey())}catch(e){}if(typeof S3UI.openEditor==='function')S3UI.openEditor('s');else go('st3')};

/* ---------- המסך הראשי ---------- */
const TABS=[['map','מפה'],['rounds','סבבים'],['rep','דוחות'],['recs','המלצות'],['set','הגדרות']];
const tabsFor=()=>TABS.filter(([k])=>k==='map'||isMgr());
function pickInfo(){const b=X.pick;if(!b)return 'הקישו על מדף במפה כדי לבחור אותו.';return `גוף ${esc2(b.num||'')}${b.name?' ('+esc2(b.name)+')':''} · צד ${b.s==='a'?'ראשי':'שני'} · מקטע ${esc2(b.n)}`}
function mapPane(d){
 const kind=X.kind==='w'&&d.maps.w?'w':'s',m=d.maps[kind];
 let h='';
 if(d.cfg.wh&&d.maps.w)h+=`<div class="chips" style="margin:0 0 8px"><button class="chip ${kind==='s'?'on':''}" data-a="st3Kind" data-k="s">החנות</button><button class="chip ${kind==='w'?'on':''}" data-a="st3Kind" data-k="w">המחסן</button></div>`;
 if(!m){h+=`<p class="s3note">${kind==='w'?'עוד לא נבנתה מפה למחסן.':'עוד לא נבנתה מפה לסניף הזה.'}</p>${canDraw()?`<button class="s3b" data-a="st3Edit" data-k="${kind}">בנו את המפה</button>`:''}`;return h}
 h+=`<div class="s3row" style="margin:0 0 8px"><button class="chip ${X.mode==='top'?'on':''}" data-a="st3Mode" data-m="top">מבט מלמעלה</button><button class="chip ${X.mode==='walk'?'on':''}" data-a="st3Mode" data-m="walk">הליכה בחנות</button>${canDraw()?`<button class="s3b g" style="margin-inline-start:auto" data-a="st3Edit" data-k="${kind}">עריכת המפה</button>`:''}</div>
 <div class="s3main" id="s3main"></div><div class="s3info" id="s3info" aria-live="polite">${pickInfo()}</div>`;
 if(d.cfg.on===false)h+=`<span class="s3off">הסניף הזה כבוי בתלת מימד</span>`;
 return h}
function workerTask(){
 if(X.runs===null&&!X.runsErr)loadRuns();
 if(X.runsErr)return `<div class="s3info">${esc2(X.runsErr)}</div>`;
 if(X.runs===null)return `<div class="s3info">טוען את המשימה…</div>`;
 if(!X.runs.length)return `<div class="s3info">אין לך משימה פתוחה כרגע.</div>`;
 return X.runs.map(r=>`<div class="s3info"><b>${esc2(r.name||'סבב בדיקת מדפים')}</b><br>${Number.isFinite(+r.nDone)&&Number.isFinite(+r.n)?`צולמו ${+r.nDone} מתוך ${+r.n}`:''}${r.dueAt?` · עד ${esc2(when(+r.dueAt))}`:''}</div>`).join('')}
V.st3=()=>{const T='החנות בתלת מימד';
 if(!loggedIn()||!feat())return{t:T,h:'<div class="empty">תלת מימד לא מופעל בעסק הזה</div>'};
 if(!dataOk()){load();return{t:T,h:'<div class="empty">טוען…</div>'}}
 const d=X.d;if(d.err)return{t:T,h:`<div class="s3s"><p style="margin:0">${esc2(d.err)}</p><button class="s3b" style="margin-top:10px" data-a="st3Retry">נסו שוב</button></div>`};
 const L=brs();let h='';
 if(L.length>1)h+=`<div class="chips" style="margin:0 0 8px">${L.map(b=>`<button class="chip ${b.id===d.br?'on':''}" data-a="st3Br" data-id="${esc2(b.id)}">${esc2(b.name)}</button>`).join('')}</div>`;
 const tb=tabsFor();if(!tb.some(t=>t[0]===X.tab))X.tab='map';
 if(tb.length>1)h+=`<div class="s3tabs" role="tablist">${tb.map(([k,l])=>`<button role="tab" aria-selected="${X.tab===k}" class="${X.tab===k?'on':''}" data-a="st3Tab" data-k="${k}">${l}</button>`).join('')}</div>`;
 let body;
 if(X.tab==='map'){body=mapPane(d);if(isW())body=workerTask()+body}
 else{const nm=(TABS.find(t=>t[0]===X.tab)||[])[1]||'';body=typeof S3UI.tabHtml==='function'?S3UI.tabHtml(X.tab,d):'';if(!body)body=`<p class="s3note">המסך "${esc2(nm)}" ייפתח בשלב הבא של הפיתוח.</p>`}
 return{t:T,s:(L.find(b=>b.id===d.br)||{}).name||'',h:`<div class="s3s">${h}${body}</div>`}};
ACT.st3Retry=()=>{X.d=null;X.at=0;rerender()};
ACT.st3Tab=el=>{X.tab=el.dataset.k;rerender()};
ACT.st3Kind=el=>{X.kind=el.dataset.k==='w'?'w':'s';X.pick=null;rerender()};
ACT.st3Br=el=>{X.br=el.dataset.id;X.kind='s';X.pick=null;X.d=null;rerender()};
ACT.st3Mode=el=>{X.mode=el.dataset.m==='walk'?'walk':'top';if(X.h&&X.h.handle&&X.h.id==='s3main')try{X.h.handle.setMode(X.mode)}catch(e){}$$('.s3s [data-a=st3Mode]').forEach(b=>b.classList.toggle('on',b.dataset.m===X.mode))};
ACT.st3Edit=el=>{if(typeof S3UI.openEditor==='function')S3UI.openEditor(el.dataset.k==='w'?'w':'s');else toast('העורך עוד לא נטען')};

/* ---------- ציור התלת מימד בתוך המסך (נבנה מחדש אחרי כל ציור של המסך) ---------- */
function unmount(){const h=X.h;X.h=null;if(h&&h.handle)try{h.handle.destroy()}catch(e){}}
function after(){
 try{if(S3UI.afterEd)S3UI.afterEd()}catch(e){}
 const id=document.getElementById('s3main')?'s3main':document.getElementById('s3mini')?'s3mini':'';
 if(!id){if(X.h)unmount();return}
 const el=document.getElementById(id),d=X.d;if(!d)return;
 const kind=id==='s3main'&&X.kind==='w'&&d.maps.w?'w':'s',m=d.maps[kind];if(!m)return;
 if(X.h&&X.h.el===el)return;
 unmount();const tok=++X.seq,rec={el,id,handle:null};X.h=rec;
 if(!window.Store3D||!window.S3G){el.textContent='רכיב התצוגה לא נטען';return}
 window.Store3D.open(el,m,{mode:id==='s3mini'?'top':X.mode,onPick:b=>{X.pick=b;const i=document.getElementById('s3info');if(i)i.innerHTML=pickInfo()},onError:()=>{}}).then(hd=>{
  if(!hd)return;if(tok!==X.seq||X.h!==rec||!el.isConnected){try{hd.destroy()}catch(e){}return}rec.handle=hd}).catch(()=>{})
}
{const r0=window.render;if(typeof r0==='function')window.render=function(){const r=r0.apply(this,arguments);try{after()}catch(e){}return r}}
/* יציאה / החלפת עסק: ניקוי המטמון */
{const k0=()=>keyBiz();let last=k0();setInterval(()=>{const k=k0();if(k!==last){last=k;X.d=null;X.at=0;X.runs=null;X.runsAt=0;X.runsErr='';X.br='';unmount()}},3000)}
})();
