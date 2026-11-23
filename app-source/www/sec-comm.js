/* גיטי – מרכז תקשורת והרשאת קבוצות (23.11.2026, "גיטי מנהלת עסק", סבב 3 חלק א, החלטות 1–2). נטען אחרי sec-hub.js.
   1. לשונית "תקשורת" במסך המזכירה: פיד אחד מהחדש לישן – מייל, ווצאפ עסקי וקבוצות פנימיות שפתוחות לגיטי (מהשרת: secComm op:'feed', 50 בכל דף),
      יחד עם ההתראות מהטלפון (sec-notif.js) – הן מוצגות רק במכשיר שקלט אותן ולא נשלחות לשרת. נטען רק כשפותחים את הלשונית.
      לכל פריט כפתור אמיתי שפותח את המסך הקיים שלו: לשונית מייל (המייל עצמו), לשונית ווצאפ (השיחה), שיחת הקבוצה (GRP.open), לשונית "התראות מהטלפון".
   2. בהגדרות המזכירה: "קבוצות פנימיות" – מתג לכל קבוצה (secComm op:'groups' לרשימה, secPrefs op:'grp' לשינוי). ברירת מחדל כבוי; כיבוי עוצר מיד (השרת בודק בכל קריאה).
   עיצוב: רק משתני הערכה (--acc, --card, --line, --bad). אין כאן שום דבר שנשמר במכשיר. */
(function(root){
'use strict';
if(typeof ACT==='undefined'||typeof V==='undefined'||typeof CHG==='undefined')return;
const X=root.__sec,TABS=root.__secTabs,HUB=root.__secHub;
if(!X||!Array.isArray(TABS)||!HUB||!HUB.tabs)return;
const fnCall=(n,d)=>{d=d&&typeof d==='object'?d:{};if(SY&&SY.sa&&SY.bizId&&!('bizId'in d))d=Object.assign({bizId:SY.bizId},d);return root.fnCall(n,d)};
const TK='comm',TL='תקשורת';
{const i=TABS.findIndex(x=>x[0]==='wa');if(!TABS.some(x=>x[0]===TK))TABS.splice(i<0?TABS.length:i,0,[TK,TL])}
const css=document.createElement('style');
css.textContent='.cmrow{display:block}.cmh{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}.cmh b{overflow-wrap:anywhere}.cmi{font-size:1.1rem;flex:none}'
+'.cmp{margin:4px 0 0;overflow-wrap:anywhere;word-break:break-word}.cmrow.un{border-inline-start:3px solid var(--acc);padding-inline-start:8px}'
+'.cmf{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 8px}.cmf .chip{min-height:40px}';
document.head.appendChild(css);

const C={ch:'all',st:'all',items:[],next:null,more:false,busy:0,err:'',at:0,grpOn:false,groups:[],seq:0};
const G={L:null,b:0,err:'',edit:false,max:50};
const re=()=>{try{if(cur().v==='sec'&&!(typeof typing==='function'&&typing()))rerender()}catch(e){}};
const onTab=()=>{try{return cur().v==='sec'&&X.tab===TK}catch(e){return false}};
const nf=()=>{try{return typeof root.__secNfList==='function'?root.__secNfList():null}catch(e){return null}};
const TZ='Asia/Jerusalem';
const when=t=>{if(!t)return '';try{const d=new Date(t),o={timeZone:TZ,hour:'2-digit',minute:'2-digit',hour12:false},hm=d.toLocaleTimeString('he-IL',o),dk=x=>x.toLocaleDateString('en-CA',{timeZone:TZ});
 return dk(d)===dk(new Date())?'היום '+hm:d.toLocaleDateString('he-IL',{timeZone:TZ,day:'numeric',month:'numeric',year:'2-digit'})+' '+hm}catch(e){return ''}};
const ICON={mail:'✉️',wa:'💬',grp:'👥',notif:'🔔'};
const CHL={mail:'מייל',wa:'ווצאפ',grp:'קבוצה',notif:'התראה בטלפון'};
const GO={mail:'פתיחה במייל',wa:'פתיחה בווצאפ',grp:'פתיחת הקבוצה',notif:'למסך ההתראות'};

/* ---------- טעינה מהשרת (דף אחד; "עוד" = הדף הבא לפי before) ---------- */
async function load(more){
 if(C.ch==='notif'){C.items=[];C.more=false;C.next=null;C.at=Date.now();C.err='';return}/* רק מקומי – בלי שרת (נקרא גם מתוך הציור, ולכן בלי ציור חוזר כאן) */
 const seq=++C.seq;C.busy=1;C.err='';
 try{const d={op:'feed',ch:C.ch,limit:50};if(more&&C.next)d.before=C.next;
  const r=await fnCall('secComm',d);if(seq!==C.seq)return;
  if(!r||!Array.isArray(r.items))throw new Error('לא נטען');
  C.items=more?C.items.concat(r.items.filter(x=>!C.items.some(y=>y.id===x.id))):r.items;
  C.more=!!r.more;C.next=r.next||null;C.grpOn=!!r.grpOn;C.groups=Array.isArray(r.groups)?r.groups:[];C.at=Date.now()}
 catch(e){if(seq===C.seq)C.err=e&&e.message||'לא נטען'}
 finally{if(seq===C.seq){C.busy=0;re()}}}
const reset=()=>{C.items=[];C.next=null;C.more=false;C.at=0;C.err='';C.seq++;C.busy=0};

/* ---------- איחוד עם ההתראות מהטלפון (רק במכשיר הזה) ---------- */
function view(){
 let L=C.ch==='notif'?[]:C.items.slice();
 const N=nf();
 if(N&&(C.ch==='all'||C.ch==='notif')){
  /* כשיש עוד פריטים ישנים בשרת – התראות רק עד הזמן של הפריט הישן ביותר שנטען, כדי שהסדר יישאר נכון */
  const floor=C.ch==='all'&&C.more&&L.length?L[L.length-1].t:0;
  N.filter(x=>x&&x.t>=floor).forEach(x=>L.push({id:'nf:'+x.k,ch:'notif',t:+x.t||0,from:x.s||'(בלי שם)',app:x.a||'',prev:String(x.x||'').slice(0,160),open:x.st==='new',done:x.st!=='new'}))}
 if(C.st==='open')L=L.filter(x=>x.open);
 return L.sort((a,b)=>b.t-a.t)}

/* ---------- HTML ---------- */
function rowH(x){
 const tags=[];
 if(x.ch==='grp'&&x.grp)tags.push(`<span class="sectags">${esc(x.grp)}</span>`);
 if(x.ch==='notif'&&x.app)tags.push(`<span class="sectags">${esc(x.app)}</span>`);
 if(x.unread)tags.push('<span class="sectags g">לא נקראה</span>');
 if(x.done===true)tags.push(`<span class="sectags">${x.ch==='notif'?'טופלה':'טופל'}</span>`);
 else if(x.open&&x.ch!=='grp')tags.push('<span class="sectags g">לטיפול</span>');
 if(x.sus)tags.push('<span class="sectags w">תוכן חשוד</span>');
 if(x.file)tags.push('<span class="sectags">קובץ מצורף</span>');
 return `<div class="secli cmrow${x.unread||(x.open&&x.ch!=='grp')?' un':''}"><div class="cmh"><span class="cmi" aria-hidden="true">${ICON[x.ch]||''}</span><b dir="auto">${esc(x.from||'')}</b><small class="note">${esc(CHL[x.ch]||'')} · ${esc(when(x.t))}</small></div>
 ${x.prev?`<p class="cmp" dir="auto">${esc(x.prev)}</p>`:''}<div class="secrow">${tags.join('')}<button class="chip" style="min-height:44px" data-a="commGo" data-id="${esc(x.id)}" aria-label="${esc((GO[x.ch]||'פתיחה')+': '+(x.from||''))}">${esc(GO[x.ch]||'פתיחה')}</button></div></div>`}
function commH(){
 if(!C.at&&!C.busy&&!C.err)load(false);
 const hasNf=nf()!==null,gOn=C.grpOn||!!(X.st&&X.st.grp&&X.st.grp.on);
 const CH=[['all','הכול'],['mail','מייל'],['wa','ווצאפ']].concat(gOn?[['grp','קבוצות']]:[]).concat(hasNf?[['notif','התראות מהטלפון']]:[]);
 if(!CH.some(c=>c[0]===C.ch))C.ch='all';
 const chip=(a,k,l,on)=>`<button class="chip${on?' on':''}" data-a="${a}" data-v="${k}" aria-pressed="${on}">${l}</button>`;
 let h=`<div class="cmf" role="group" aria-label="ערוץ">${CH.map(([k,l])=>chip('commCh',k,l,C.ch===k)).join('')}</div>
 <div class="cmf" role="group" aria-label="מצב">${chip('commSt','all','הכול',C.st==='all')}${chip('commSt','open','לטיפול / לא נקרא',C.st==='open')}<button class="chip" data-a="commRe">רענון</button></div>`;
 if(gOn&&C.at&&!C.groups.length&&(C.ch==='all'||C.ch==='grp'))h+=`<div class="card"><p class="note" style="margin:0 0 6px">אף קבוצה פנימית לא פתוחה לגיטי, ולכן הודעות מהקבוצות לא מופיעות כאן.</p><button class="chip" data-a="commSet" style="min-height:44px">פתיחת קבוצות בהגדרות</button></div>`;
 if(C.err&&!C.items.length)return h+`<div class="card"><p class="note">${esc(C.err)}</p><button class="btn g w" data-a="commRe">נסה שוב</button></div>`;
 if(!C.at&&C.ch!=='notif')return h+'<div class="empty">טוען…</div>';
 const L=view();
 h+=`<div class="card" id="secCommList">${L.length?L.map(rowH).join(''):`<p class="note" style="margin:0">${C.st==='open'?'אין כרגע הודעות שממתינות לטיפול.':'אין הודעות להצגה.'}</p>`}</div>`;
 if(C.more&&C.ch!=='notif')h+=`<button class="btn g w" data-a="commMore" style="margin-top:8px"${C.busy?' disabled':''}>${C.busy?'טוען…':'הודעות ישנות יותר'}</button>`;
 if(C.err&&C.items.length)h+=`<p class="note">${esc(C.err)}</p>`;
 if(hasNf&&(C.ch==='all'||C.ch==='notif'))h+='<p class="note" style="margin:8px 0 0">🔔 התראות מהטלפון מוצגות רק במכשיר הזה ולא נשלחות לשרת.</p>';
 return h}
HUB.tabs[TK]={s:TL,h:()=>{try{return commH()}catch(e){return '<p class="note">לא ניתן להציג את המסך כרגע.</p>'}}};

/* ---------- פעולות ---------- */
ACT.commCh=el=>{const v=el.dataset.v;if(v===C.ch)return;C.ch=v;reset();load(false);re()};/* load מסמן busy מיד, והציור מציג "טוען…" */
ACT.commSt=el=>{C.st=el.dataset.v==='open'?'open':'all';re()};
ACT.commRe=()=>{reset();try{if(typeof root.__secNfTick==='function')root.__secNfTick()}catch(e){}load(false);re()};
ACT.commMore=()=>{if(!C.busy&&C.more)load(true)};
ACT.commSet=()=>{try{ACT.secSet()}catch(e){}setTimeout(()=>{const e=document.getElementById('secGrpSet');if(e)e.scrollIntoView({block:'start'})},120)};
const hasTab=k=>TABS.some(x=>x[0]===k);
ACT.commGo=el=>{const id=el.dataset.id,x=view().find(i=>i.id===id);if(!x)return toast('הפריט כבר לא ברשימה');
 try{
  if(x.ch==='mail'){if(!hasTab('mail'))return toast('המסך הזה לא זמין');ACT.secTab({dataset:{v:'mail'}});if(X.ml){X.ml.cur=x.ref.id;X.ml.card=null}rerender();window.scrollTo(0,0);return}
  if(x.ch==='wa'){if(!hasTab('wa'))return toast('המסך הזה לא זמין');ACT.secTab({dataset:{v:'wa'}});if(X.wa&&x.ref.wa){X.wa.cur=x.ref.wa;X.wa.card=null}rerender();window.scrollTo(0,0);return}
  if(x.ch==='grp'){if(root.GRP&&typeof root.GRP.open==='function')return root.GRP.open(x.ref.gid);return toast('הקבוצות לא זמינות כאן')}
  if(x.ch==='notif'){if(!hasTab('notif'))return toast('המסך הזה לא זמין');ACT.secTab({dataset:{v:'notif'}});return}
 }catch(e){toast('לא הצלחתי לפתוח')}};
{const t0=ACT.secTab;ACT.secTab=el=>{if(el&&el.dataset&&el.dataset.v===TK){reset();try{if(typeof root.__secNfTick==='function')root.__secNfTick()}catch(e){}}return t0(el)}}

/* ---------- הגדרות: קבוצות פנימיות ---------- */
async function grpLoad(){G.b=1;G.err='';
 try{const r=await fnCall('secComm',{op:'groups'});if(!r||!Array.isArray(r.groups))throw new Error('לא נטען');G.L=r.groups;G.edit=!!r.edit;G.max=r.max||50}
 catch(e){G.err=e&&e.message||'לא נטען'}
 finally{G.b=0;re()}}
root.__secGrpSetH=()=>{const g=X.st&&X.st.grp;if(!g||!g.on)return '';
 if(!G.L&&!G.b&&!G.err)grpLoad();
 const L=G.L||[];
 const rows=G.L?(L.length?L.map(x=>`<label class="chip" style="min-height:44px;width:100%;justify-content:flex-start;gap:8px"><input type="checkbox" data-c="secGrpT" data-g="${esc(x.gid)}"${x.on?' checked':''}${G.edit?'':' disabled'}> <span dir="auto">${esc(x.name)}</span> <small class="note">· ${x.n===1?'חבר אחד':esc(String(x.n))+' חברים'}</small></label>`).join(''):'<p class="note" style="margin:0">אין עדיין קבוצות בעסק.</p>'):(G.err?`<p class="note">${esc(G.err)}</p><button class="chip" data-a="secGrpRe" style="min-height:40px">נסה שוב</button>`:'<p class="note">טוען…</p>');
 return `<div class="card" id="secGrpSet" style="margin-top:8px"><b>קבוצות פנימיות – מה גיטי רשאית לקרוא</b>
 <p class="note" style="margin:4px 0 8px">כבוי כברירת מחדל. בקבוצה שמסומנת כאן גיטי קוראת את כל ההיסטוריה – לשאלות בשיחה ולמסך "תקשורת". כיבוי עוצר את הקריאה מיד. הקבוצה עצמה והחברים בה לא משתנים.</p>
 ${G.edit||!G.L?'':'<p class="note" style="margin:0 0 6px">רק מנהל בלי הגבלת סניפים יכול לשנות.</p>'}<div style="display:grid;gap:6px">${rows}</div></div>`};
ACT.secGrpRe=()=>{G.L=null;G.err='';grpLoad()};
CHG.secGrpT=async el=>{const gid=el.dataset.g,on=!!el.checked;el.disabled=true;
 try{await fnCall('secPrefs',{op:'grp',gid,on});const x=(G.L||[]).find(z=>z.gid===gid);if(x)x.on=on;
  if(X.st&&X.st.grp)X.st.grp.n=(G.L||[]).filter(z=>z.on).length;C.at=0;C.items=[];
  toast(on?'✓ גיטי יכולה לקרוא את הקבוצה':'✓ גיטי כבר לא קוראת את הקבוצה')}
 catch(e){el.checked=!on;toast(e&&e.message||'השמירה נכשלה')}
 finally{el.disabled=false}};
{const s0=ACT.secSet;if(typeof s0==='function')ACT.secSet=function(){G.L=null;G.err='';return s0.apply(this,arguments)}}
})(typeof window!=='undefined'?window:this);
