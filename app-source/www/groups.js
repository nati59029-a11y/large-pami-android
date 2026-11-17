/* קבוצות התכתבות (17.11.2026, סבב 3, חבילה ב'). נטען אחרי index.html. הכול מאחורי bzF('groups'); בלי הקובץ הזה האפליקציה נשארת כמו קודם.
   נתונים (חוזה): grp/{gid} {name,mem[],ao,md,by,t,last{txt,byN,t,k}}, grp/{gid}/m/{mid} {by,byN,t,k:t|img|vid,txt,vp,vs,vb},
   תמונה grp/{gid}/m/{mid}/p/1 {img,t,uid} (אותה דחיסה ואותו דפוס כמו תמונות בבקשות), מצב קריאה grp/{gid}/r/{uid} {t,mu}.
   סרטון: Storage grpv/{gid}/{mid} (בעסק b: b/{bizId}/grpv/...), עד 60 שניות ו-30MB; נמחק בשרת אחרי 90 יום (ההודעה נשארת).
   ה-last וההתראות נכתבים בשרת (עובד לא יכול לכתוב ל-grp/{gid}). 403 ברשימה = שרת ישן ← "הקבוצות יופעלו בקרוב".
   מסכים: V.gr (רשימה), V.grc (שיחה), V.grs (הגדרות מנהל). אין כאן שום דבר שנשמר במכשיר: הכול בזיכרון. */
(function(){'use strict';
if(typeof V==='undefined'||typeof fsx!=='function'||typeof bzF!=='function')return;
const DAY=864e5,VMAX=30*1024*1024,VSEC=60,PAGE=50,CNTMAX=100;
const GR={L:null,at:0,busy:0,off:0,err:'',n:0,c:null,s:null,staff:null,img:{},vu:''};
const on=()=>{try{return !!(fbRole()&&bzF('groups'))}catch(e){return false}};
const bv=v=>({booleanValue:!!v});
const TZ='Asia/Jerusalem';
const hm=ms=>new Date(ms).toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit',timeZone:TZ,hour12:false});
const dk=ms=>new Date(ms).toLocaleDateString('en-CA',{timeZone:TZ});
const dLbl=ms=>{const k=dk(ms),n=Date.now();if(k===dk(n))return'היום';if(k===dk(n-DAY))return'אתמול';return new Date(ms).toLocaleDateString('he-IL',{day:'2-digit',month:'2-digit',year:'2-digit',timeZone:TZ})};
const lTime=ms=>{if(!ms)return'';const k=dk(ms),n=Date.now();if(k===dk(n))return hm(ms);if(k===dk(n-DAY))return'אתמול';return new Date(ms).toLocaleDateString('he-IL',{day:'2-digit',month:'2-digit',timeZone:TZ})};
const dur=s=>{s=Math.max(0,Math.round(s||0));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0')};
const qrun=async(parent,sq)=>{const r=await fsx((parent||'')+':runQuery',{method:'POST',body:JSON.stringify({structuredQuery:sq})});return(r||[]).filter(x=>x.document).map(x=>x.document)};
const tF=(op,v)=>({fieldFilter:{field:{fieldPath:'t'},op,value:iv(v)}});
const pOf=p=>p&&typeof p==='object'&&idOk(String(p.mid||''))?{mid:String(p.mid),txt:String(p.txt||'').slice(0,120),byN:String(p.byN||''),t:+p.t||0,k:String(p.k||'t')}:null;
const gOf=d=>{const f=fvj({mapValue:d})||{},l=f.last&&typeof f.last==='object'?f.last:null;return{id:idOf(d),name:String(f.name||'').slice(0,60),mem:Array.isArray(f.mem)?f.mem.map(String):[],ao:f.ao===true,md:f.md===true,t:+f.t||0,last:l?{txt:String(l.txt||''),byN:String(l.byN||''),t:+l.t||0,k:String(l.k||'t')}:null,rt:0,mu:false,n:0,np:false,pin:pOf(f.pin)}};
const mOf=d=>{const f=fvj({mapValue:d})||{};return{id:idOf(d),by:String(f.by||''),byN:String(f.byN||''),t:+f.t||0,k:f.k==='img'||f.k==='vid'?f.k:'t',txt:String(f.txt||''),vp:String(f.vp||''),vs:+f.vs||0,vb:+f.vb||0}};
const gGet=id=>(GR.L||[]).find(g=>g.id===id)||(GR.c&&GR.c.g&&GR.c.g.id===id?GR.c.g:null);
const lastTx=g=>{const l=g.last;if(!l)return'אין הודעות עדיין';const t=l.k==='img'?'📷 תמונה':l.k==='vid'?'🎬 סרטון':l.txt;return(l.byN?l.byN+': ':'')+t};
const recount=()=>{GR.n=(GR.L||[]).reduce((a,g)=>a+(g.mu?0:g.n),0)};

/* ---- עיצוב: רק משתני ערכת הנושא ---- */
const st=document.createElement('style');st.textContent=`
.gr-av{width:44px;height:44px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:1.1rem;background:var(--acc2);color:var(--acc);flex:none}
.gr-cnt{display:inline-flex;min-width:20px;height:20px;border-radius:10px;background:var(--acc);color:var(--onacc);font-size:.72rem;font-weight:800;align-items:center;justify-content:center;padding:0 6px}
.gr-cnt.mu{background:var(--mut)}
.gr-row .t{flex:1;min-width:0}.gr-row .t b{display:block}.gr-row .t span{display:block;font-size:.84rem;color:var(--mut);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gr-row .m{display:flex;flex-direction:column;align-items:flex-end;gap:4px;font-size:.76rem;color:var(--mut);flex:none}
#grmsgs{display:flex;flex-direction:column;gap:6px;padding-bottom:8px}
.gr-b{max-width:82%;border-radius:14px;padding:7px 10px;background:var(--card);border:1px solid var(--line);align-self:flex-start;overflow-wrap:anywhere;position:relative}
.gr-b.me{background:var(--acc2);color:var(--ink);align-self:flex-end;border-color:var(--acc2)}
.gr-b .who{font-size:.76rem;font-weight:800;color:var(--acc);margin-bottom:2px}
.gr-b .tm{font-size:.7rem;color:var(--mut);text-align:end;margin-top:2px}
.gr-b .tx{white-space:pre-wrap}
.gr-b .dl{position:absolute;top:2px;inset-inline-end:2px;min-height:0;min-width:28px;height:24px;padding:0;border:0;background:none;color:var(--mut);font-size:1.1rem;cursor:pointer}
.gr-pic{display:block;width:200px;max-width:100%;min-height:90px;border-radius:10px;overflow:hidden;margin-bottom:4px;background:var(--line);position:relative;cursor:pointer;border:0;padding:0;color:var(--mut)}
.gr-pic img{display:block;width:100%;max-height:240px;object-fit:cover}
.gr-pic .ph{display:flex;align-items:center;justify-content:center;min-height:90px;font-size:.8rem;padding:6px;text-align:center}
.gr-pic .play{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:2rem;color:var(--ink)}
.gr-pic .dr{position:absolute;bottom:4px;inset-inline-end:6px;font-size:.74rem;background:var(--card);color:var(--ink);padding:0 6px;border-radius:8px}
.gr-pin{position:sticky;top:calc(72px + env(safe-area-inset-top));z-index:5;box-shadow:var(--elev-1,0 2px 6px rgba(0,0,0,.3));display:block;width:100%;text-align:start;background:var(--card);color:var(--ink);border:1px solid var(--line);border-inline-start:4px solid var(--acc);border-radius:10px;padding:8px 12px;margin-bottom:8px;font-size:.86rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;min-height:40px}
.gr-b.hl{outline:2px solid var(--acc);outline-offset:2px}
.gr-dsep{align-self:center;font-size:.76rem;color:var(--mut);background:var(--card);border:1px solid var(--line);border-radius:20px;padding:2px 12px}
.gr-unr{align-self:stretch;text-align:center;font-size:.8rem;font-weight:800;color:var(--onacc);background:var(--acc);border-radius:20px;padding:3px 0;scroll-margin-top:70px}
#grcomp{position:sticky;bottom:0;background:var(--bg);padding:8px 0 calc(8px + env(safe-area-inset-bottom));border-top:1px solid var(--line)}
.gr-comp{display:flex;gap:8px;align-items:flex-end}
.gr-comp textarea{flex:1;min-height:44px;max-height:120px;border-radius:22px;padding:10px 14px;resize:none}
.gr-circ{width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.2rem;flex:none;background:var(--card);border:1px solid var(--line);cursor:pointer;padding:0;color:var(--ink)}
.gr-circ.go{background:var(--acc);color:var(--onacc);border:0;font-weight:800}
.gr-circ[disabled]{opacity:.5}
.gr-lock{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:11px;text-align:center;font-size:.86rem;color:var(--mut)}
body.grc .bar,body.grc .wbar{display:none!important}body.grc main{padding-bottom:0!important}
.gr-mem{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--line)}.gr-mem:last-child{border:0}
`;document.head.appendChild(st);

/* ---- רשימה: קבוצות, מצב קריאה ומונה לא-נקרא (שאילתה מוגבלת, רק לקבוצה שההודעה האחרונה שלה חדשה מהקריאה) ---- */
async function grLoad(){
 if(GR.busy||!on())return;GR.busy=1;GR.err='';const uid=SY.uid;let ch=0;
 try{
  let docs;
  if(fbAdmin())docs=(await fsx('/grp?pageSize=200')||{}).documents||[];
  else docs=await qrun('',{from:[{collectionId:'grp'}],where:{fieldFilter:{field:{fieldPath:'mem'},op:'ARRAY_CONTAINS',value:sv(uid)}},limit:100});
  const L=docs.map(gOf).filter(g=>idOk(g.id));
  await Promise.all(L.map(async g=>{
   try{const r=await fsx('/grp/'+g.id+'/r/'+uid),f=fvj({mapValue:r})||{};g.rt=+f.t||0;g.mu=f.mu===true}catch(e){if(e.code===403)throw e}
   const lt=g.last?g.last.t:g.t;
   if(g.last&&lt>g.rt){try{const q=await qrun('/grp/'+g.id,{from:[{collectionId:'m'}],select:{fields:[{fieldPath:'by'}]},where:tF('GREATER_THAN',g.rt),limit:CNTMAX});g.n=q.filter(d=>gv(d,'by')!==uid).length;g.np=q.length>=CNTMAX}catch(e){if(e.code===403)throw e}}}));
  L.sort((a,b)=>((b.last?b.last.t:b.t)-(a.last?a.last.t:a.t)));
  const sig=x=>(x||[]).map(g=>g.id+':'+g.n+':'+(g.last?g.last.t:0)+':'+g.name).join();ch=sig(L)!==sig(GR.L);GR.L=L;GR.off=0;recount()}
 catch(e){if(e&&e.code===403)GR.off=1;else GR.err=tkErr(e);ch=1}
 finally{GR.busy=0;GR.at=Date.now()}
 if(cur().v==='gr'||(ch&&['home','wk'].includes(cur().v)))rerender();else try{wbUp()}catch(e){}}
function grTick(){if(on()&&!GR.busy&&Date.now()-GR.at>60000)grLoad()}
const grAvatar=n=>`<span class="gr-av" aria-hidden="true">${esc((String(n||'?').trim()[0]||'?'))}</span>`;
function rowH(g){const n=g.n,lt=g.last?g.last.t:0;
 return `<button class="li gr-row" data-a="grOpen" data-id="${esc(g.id)}">${grAvatar(g.name)}<div class="t"><b>${esc(g.name)}</b><span>${esc(lastTx(g))}</span></div><div class="m"><span>${esc(lTime(lt))}</span>${n?`<span class="gr-cnt${g.mu?' mu':''}">${g.np?(CNTMAX-1)+'+':n>99?'99+':n}</span>`:''}</div></button>`}
V.gr=()=>{
 if(!on())return{t:'קבוצות',s:'',h:'<div class="card"><p class="note">המסך הזה לא זמין.</p></div>'};
 if(!GR.busy&&(GR.L===null||Date.now()-GR.at>20000))grLoad();
 const adm=fbAdmin(),top=`<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px"><span class="note" style="margin:0">${GR.L&&GR.L.length?GR.L.length+' קבוצות':''}</span>${adm?'<button class="chip on" data-a="grNew">＋ קבוצה חדשה</button>':''}</div>`;
 if(GR.off)return{t:'קבוצות',s:'',h:`${top}<div class="card"><p class="note" style="margin:0">הקבוצות יופעלו בקרוב.</p></div>`};
 if(GR.L===null)return{t:'קבוצות',s:'',h:`${top}<p class="note">${GR.err?esc(GR.err):'טוען…'}</p>`};
 return{t:'קבוצות',s:GR.n?GR.n+' הודעות שלא נקראו':'',h:`${top}${GR.L.length?GR.L.map(rowH).join(''):`<p class="note">${adm?'עוד אין קבוצות. אפשר ליצור קבוצה חדשה.':'אתה עוד לא חבר באף קבוצה.'}</p>`}${GR.err?`<p class="note">${esc(GR.err)}</p>`:''}<button class="btn g w" data-a="grRefresh" style="margin-top:8px">רענן</button>`}};
ACT.grRefresh=()=>{GR.at=0;grLoad();toast('מרענן...')};
ACT.grOpen=el=>{const id=el.dataset.id;if(!idOk(id))return;const g=gGet(id);if(!g)return;GR.c={gid:id,g,msgs:[],more:false,rt:0,rtSaved:0,unr:'',ready:0,loading:1,started:0,draft:'',sending:'',gone:0,tm:0};go('grc',id)};
/* לחיצה על התראה (data.k='grp', data.id=gid): פותח את שיחת הקבוצה */
async function grOpenId(id){if(!on()||!idOk(String(id||'')))return;
 try{const g=gOf(await fsx('/grp/'+id));if(!g.id)throw 0;GR.c={gid:id,g,msgs:[],more:false,rt:0,rtSaved:0,unr:'',ready:0,loading:1,started:0,draft:'',sending:'',gone:0,tm:0};go('grc',id)}
 catch(e){toast('הקבוצה לא זמינה')}}
window.GRP={n:()=>on()?GR.n:0,tick:grTick,off:()=>GR.off,open:grOpenId};

/* ---- שיחה ---- */
const mineId=m=>m.by===SY.uid;
function msgH(m,c){
 const me=mineId(m),adm=fbAdmin();let b='';
 if(m.k==='img'){const du=GR.img[c.gid+'/'+m.id];b=`<button class="gr-pic" data-a="grImg" data-id="${esc(m.id)}" aria-label="תמונה">${du?`<img src="${esc(du)}" alt="תמונה">`:`<span class="ph" data-gimg="${esc(m.id)}">${GR.img['x'+c.gid+'/'+m.id]?'התמונה לא נטענה. לחץ לנסות שוב':'טוען תמונה…'}</span>`}</button>`}
 else if(m.k==='vid'){const old=Date.now()-m.t>90*DAY;b=old||m.gone?`<div class="gr-pic" style="cursor:default"><span class="ph">🎬 הסרטון נמחק אחרי 90 יום</span></div>`:`<button class="gr-pic" data-a="grVid" data-id="${esc(m.id)}" aria-label="סרטון"><span class="ph" style="min-height:110px;background:var(--bg)"></span><span class="play">▶</span><span class="dr">${dur(m.vs)}</span></button>`}
 return `<div class="gr-b${me?' me':''}" data-mid="${esc(m.id)}">${adm?`<button class="dl" data-a="grMenu" data-id="${esc(m.id)}" aria-label="אפשרויות הודעה">⋯</button>`:''}${me?'':`<div class="who">${esc(m.byN||'')}</div>`}${b}${m.txt?`<div class="tx">${esc(m.txt)}</div>`:''}<div class="tm">${hm(m.t)}</div></div>`}
function msgsH(c){
 if(!c.ready)return `<p class="note">${c.err?esc(c.err):'טוען…'}</p>`;
 if(!c.msgs.length)return '<p class="note">אין הודעות עדיין.</p>';
 let h=c.more?'<button class="btn g w" data-a="grMore" style="margin-bottom:6px">טען עוד</button>':'',last='',un=0;
 const ui=c.unr?c.msgs.findIndex(m=>m.id===c.unr):-1;if(ui>=0)un=c.msgs.slice(ui).filter(m=>!mineId(m)).length;
 c.msgs.forEach((m,i)=>{const k=dk(m.t);if(k!==last){h+=`<div class="gr-dsep">${esc(dLbl(m.t))}</div>`;last=k}
  if(i===ui)h+=`<div class="gr-unr" id="grunr">${un}${c.more&&ui===0?'+':''} ${un===1?'הודעה שלא נקראה':'הודעות שלא נקראו'}</div>`;h+=msgH(m,c)});
 return h}
function pinH(c){const p=c.g.pin;return p?`<button class="gr-pin" data-a="grPinGo" aria-label="הודעה מוצמדת">📌 ${esc(p.txt)}</button>`:''}
function grPinPaint(){const c=GR.c;if(!c||cur().v!=='grc'||cur().a!==c.gid)return;const e=$('#grpin');if(e)e.innerHTML=pinH(c)}
function compH(c){const g=c.g;
 if(!fbAdmin()&&g.ao)return '<div class="gr-lock">🔒 רק המנהל יכול לשלוח הודעות בקבוצה הזו</div>';
 const dis=c.sending?' disabled':'';
 return `<div class="gr-comp">${g.md?`<label class="gr-circ" aria-label="צרף תמונה או סרטון" style="${c.sending?'opacity:.5':''}">📎<input type="file" accept="image/*,video/*" data-c="grFile" hidden${dis}></label>`:''}<textarea id="grtx" data-i="grDraft" rows="1" maxlength="2000" placeholder="כתוב הודעה…" aria-label="הודעה"${dis}>${esc(c.draft)}</textarea><button class="gr-circ go" data-a="grSend" aria-label="שלח"${dis}>➤</button></div>${c.sending?`<p class="note" style="margin:6px 0 0">${esc(c.sending)}</p>`:''}`}
function topH(c){const g=c.g;
 if(fbAdmin())return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><span class="note" style="margin:0">${g.mem.length} חברים${g.ao?' · רק המנהל שולח':''}</span><button class="chip" data-a="grSet" data-id="${esc(g.id)}">⚙ הגדרות</button></div>`;
 if(g.ao)return '';
 return `<label class="opt" style="min-height:48px;margin-bottom:8px"><span>השתק התראות</span><input type="checkbox" data-c="grMute"${g.mu?' checked':''}></label>`}
V.grc=gid=>{
 const c=GR.c;if(!on()||!c||c.gid!==gid)return{t:'קבוצה',s:'',h:'<div class="card"><p class="note">הקבוצה לא זמינה.</p></div>'};
 if(!c.started){c.started=1;grEnter(c)}
 return{t:c.g.name,s:'קבוצה',h:`<div id="grtop">${topH(c)}</div><div id="grpin">${pinH(c)}</div><div id="grmsgs">${msgsH(c)}</div><div id="grcomp">${compH(c)}</div>`}};
const atBottom=()=>window.innerHeight+window.scrollY>=document.documentElement.scrollHeight-160;
function grPaint(opt){const c=GR.c;if(!c||cur().v!=='grc'||cur().a!==c.gid)return;const m=$('#grmsgs');if(!m)return;
 const bot=atBottom(),h0=document.documentElement.scrollHeight;m.innerHTML=msgsH(c);
 if(opt==='keep')window.scrollBy(0,document.documentElement.scrollHeight-h0);else if(opt==='bottom'||bot)window.scrollTo(0,document.documentElement.scrollHeight);
 grImgs()}
function grComp(){const c=GR.c;if(!c||cur().v!=='grc')return;const e=$('#grcomp');if(e)e.innerHTML=compH(c)}
function grScrollInit(){const u=document.getElementById('grunr');if(u)u.scrollIntoView({block:'start'});else window.scrollTo(0,document.documentElement.scrollHeight)}
async function grEnter(c){
 try{
  try{const r=await fsx('/grp/'+c.gid+'/r/'+SY.uid),f=fvj({mapValue:r})||{};c.rt=+f.t||0;c.g.mu=f.mu===true}catch(e){if(e.code!==404)throw e}
  c.rtSaved=c.rt;grPinGet(c);
  const d=await qrun('/grp/'+c.gid,{from:[{collectionId:'m'}],orderBy:[{field:{fieldPath:'t'},direction:'DESCENDING'}],limit:PAGE});
  c.msgs=d.map(mOf).filter(m=>idOk(m.id)).reverse();c.more=d.length>=PAGE;
  const f=c.msgs.find(m=>m.t>c.rt&&!mineId(m));c.unr=f?f.id:'';c.ready=1;c.loading=0}
 catch(e){c.err=e&&e.code===403?'אין הרשאה לקבוצה הזו':tkErr(e);c.loading=0;if(cur().v==='grc')grPaint();return}
 if(GR.c!==c||cur().v!=='grc')return;
 const m=$('#grmsgs');if(m){m.innerHTML=msgsH(c);grScrollInit();grImgs()}
 const t=$('#grtop');if(t)t.innerHTML=topH(c);
 grMark();grPoll(c)}
async function grPinGet(c){try{const d=await fsx('/grp/'+c.gid),p=pOf((fvj({mapValue:d})||{}).pin);if(GR.c!==c)return;if(JSON.stringify(p)!==JSON.stringify(c.g.pin||null)){c.g.pin=p;grPinPaint()}}catch(e){}}
/* סימון "נקרא עד" – הודעה אחרונה שנטענה (לא קודם ממה שכבר נשמר) */
function grMark(){const c=GR.c;if(!c||!c.ready)return;const nt=c.msgs.reduce((a,m)=>Math.max(a,m.t),c.rtSaved);if(nt<=c.rtSaved)return;c.rtSaved=nt;
 fsx('/grp/'+c.gid+'/r/'+SY.uid+'?updateMask.fieldPaths=t',{method:'PATCH',body:JSON.stringify({fields:{t:iv(nt)}})}).catch(()=>{});
 const g=gGet(c.gid);if(g&&g!==c.g){g.rt=nt}c.g.rt=nt;c.g.n=0;c.g.np=false;recount();try{wbUp()}catch(e){}}
function grPoll(c){clearTimeout(c.tm);c.tm=setTimeout(async()=>{
 if(GR.c!==c||cur().v!=='grc'||cur().a!==c.gid)return;
 c.pt=(c.pt||0)+1;if(c.pt%4===0)grPinGet(c);
 try{const nw=c.msgs.reduce((a,m)=>Math.max(a,m.t),0),d=await qrun('/grp/'+c.gid,{from:[{collectionId:'m'}],where:tF('GREATER_THAN',nw),orderBy:[{field:{fieldPath:'t'},direction:'ASCENDING'}],limit:PAGE});
  const add=d.map(mOf).filter(m=>idOk(m.id)&&!c.msgs.some(x=>x.id===m.id));if(add.length&&GR.c===c){c.msgs=c.msgs.concat(add);grPaint();grMark()}}catch(e){}
 grPoll(c)},8000)}
ACT.grMore=async()=>{const c=GR.c;if(!c||!c.msgs.length||c.loading)return;c.loading=1;
 try{const d=await qrun('/grp/'+c.gid,{from:[{collectionId:'m'}],where:tF('LESS_THAN',c.msgs[0].t),orderBy:[{field:{fieldPath:'t'},direction:'DESCENDING'}],limit:PAGE});
  const old=d.map(mOf).filter(m=>idOk(m.id)&&!c.msgs.some(x=>x.id===m.id)).reverse();c.msgs=old.concat(c.msgs);c.more=d.length>=PAGE}catch(e){toast(tkErr(e))}
 c.loading=0;grPaint('keep')};
/* תמונות: נטענות רק כשהן מתקרבות למסך (IntersectionObserver), ונשמרות בזיכרון */
let IO=null;
function grImgs(){const c=GR.c;if(!c)return;const els=[...document.querySelectorAll('#grmsgs [data-gimg]')];if(!els.length)return;
 if(typeof IntersectionObserver==='undefined'){els.forEach(e=>grImgGet(c.gid,e.dataset.gimg));return}
 if(IO)IO.disconnect();IO=new IntersectionObserver(es=>es.forEach(x=>{if(x.isIntersecting){IO.unobserve(x.target);grImgGet(c.gid,x.target.dataset.gimg)}}),{rootMargin:'300px'});els.forEach(e=>IO.observe(e))}
const imgBusy={};
async function grImgGet(gid,mid){const k=gid+'/'+mid;if(GR.img[k]||imgBusy[k]||!idOk(mid))return;imgBusy[k]=1;
 try{const d=await fsx('/grp/'+gid+'/m/'+mid+'/p/1'),du=gv(d,'img');if(!imgOk(du))throw 0;GR.img[k]=du;delete GR.img['x'+k]}catch(e){GR.img['x'+k]=1}
 finally{delete imgBusy[k]}
 if(GR.c&&GR.c.gid===gid)grPaint()}
ACT.grImg=el=>{const c=GR.c;if(!c)return;const k=c.gid+'/'+el.dataset.id;if(GR.img[k])return viewImg(null,'LargePami_group',GR.img[k]);delete GR.img['x'+k];grImgGet(c.gid,el.dataset.id)};
/* סרטון: Storage דורש כותרת הרשאה, ולכן מורידים ל-blob ומנגנים ב-<video> (עד 30MB, רק בלחיצה) */
ACT.grVid=async el=>{const c=GR.c;if(!c)return;const m=c.msgs.find(x=>x.id===el.dataset.id);if(!m||!m.vp)return;
 if(Date.now()-m.t>90*DAY){m.gone=1;return grPaint()}
 toast('טוען את הסרטון…');
 try{const t=await tok(),r=await fetch(STB()+'/'+encodeURIComponent(m.vp)+'?alt=media',{headers:{Authorization:'Firebase '+t}});
  if(r.status===404){m.gone=1;grPaint();return}if(!r.ok)throw new Error('HTTP '+r.status);
  const bl=await r.blob();if(GR.vu)URL.revokeObjectURL(GR.vu);GR.vu=URL.createObjectURL(bl);
  const o=document.getElementById('viewer');if(o)o.remove();const v=document.createElement('div');v.id='viewer';
  v.innerHTML=`<div class="vbar"><button class="btn" data-a="grVidX">חזרה</button></div><div class="vimg"><video controls autoplay playsinline src="${esc(GR.vu)}" style="max-width:100%;max-height:80vh"></video></div>`;document.body.append(v)}
 catch(e){toast(e&&e.offline?e.message:'לא הצלחנו לפתוח את הסרטון')}};
ACT.grVidX=()=>{const v=document.getElementById('viewer');if(v){const e=v.querySelector('video');if(e){try{e.pause();e.removeAttribute('src');e.load()}catch(x){}}v.remove()}if(GR.vu){URL.revokeObjectURL(GR.vu);GR.vu=''}};
INP.grDraft=el=>{if(GR.c)GR.c.draft=el.value};
/* שליחה */
const newMid=()=>{const m=uid();return idOk(m)?m:'m'+Date.now().toString(36)};
async function grPost(c,k,txt,x){
 const mid=x&&x.mid||newMid(),f={by:sv(SY.uid),byN:sv(fbBy().slice(0,100)),t:iv(Date.now()),k:sv(k),txt:sv(txt)};
 if(x&&x.vp){f.vp=sv(x.vp);f.vs=iv(x.vs);f.vb=iv(x.vb)}
 await fsx('/grp/'+c.gid+'/m?documentId='+encodeURIComponent(mid),{method:'POST',body:JSON.stringify({fields:f})});
 const m={id:mid,by:SY.uid,byN:fbBy(),t:+f.t.integerValue,k,txt,vp:x&&x.vp||'',vs:x&&x.vs||0,vb:x&&x.vb||0};
 c.msgs.push(m);return m}
const sendDone=c=>{c.sending='';grComp();grPaint('bottom');grMark()};
const sendErr=(c,e)=>{c.sending='';grComp();toast(tkErr(e))};
ACT.grSend=async()=>{const c=GR.c;if(!c||c.sending||!c.ready)return;const tx=$('#grtx'),txt=String((tx?tx.value:c.draft)||'').trim().slice(0,2000);if(!txt)return;
 if(!fbAdmin()&&c.g.ao)return toast('רק המנהל יכול לשלוח הודעות בקבוצה הזו');
 c.sending='שולח…';grComp();
 try{await grPost(c,'t',txt);c.draft='';sendDone(c)}catch(e){c.draft=txt;sendErr(c,e)}};
CHG.grFile=async el=>{const f=el.files&&el.files[0];el.value='';const c=GR.c;if(!f||!c||c.sending||!c.g.md)return;
 const tx=$('#grtx');if(tx)c.draft=tx.value;
 if(/^video\//.test(f.type||'')||/\.(mp4|webm|3gp|mov)$/i.test(f.name||''))return grVideo(c,f);
 if(f.type&&!/^image\//.test(f.type))return toast('אפשר לשלוח תמונה או סרטון בלבד');
 c.sending='מכין את התמונה…';grComp();
 let du;try{du=await fbShrink(await rdU(f));if(du.length>880000||!imgOk(du))throw 0}catch(e){c.sending='';grComp();return toast('תמונה לא תקינה או גדולה מדי')}
 c.sending='שולח…';grComp();
 try{const cap=String(c.draft||'').trim().slice(0,2000),m=await grPost(c,'img',cap);GR.img[c.gid+'/'+m.id]=du;c.draft='';
  try{await fsx('/grp/'+c.gid+'/m/'+m.id+'/p/1',{method:'PATCH',body:JSON.stringify({fields:{img:sv(du),t:iv(Date.now()),uid:sv(SY.uid)}})})}catch(e2){toast('ההודעה נשלחה, אבל התמונה לא עלתה. '+tkErr(e2))}
  sendDone(c)}catch(e){sendErr(c,e)}};
/* משך הסרטון נמדד ב-<video> מקומי לפני ההעלאה */
async function vidProbe(f){const url=URL.createObjectURL(f),v=document.createElement('video');v.preload='metadata';v.muted=true;v.playsInline=true;
 try{const d0=await new Promise((ok,no)=>{const bad=()=>no(new Error('לא הצלחנו לקרוא את הסרטון. נסו סרטון אחר.')),t=setTimeout(bad,10000);v.onloadedmetadata=()=>{clearTimeout(t);ok(v.duration)};v.onerror=()=>{clearTimeout(t);bad()};v.src=url});
  let d=d0;if(d===Infinity){await new Promise(ok=>{const t=setTimeout(ok,4000);v.ondurationchange=()=>{if(Number.isFinite(v.duration)){clearTimeout(t);ok()}};v.currentTime=1e101});d=v.duration}
  if(!Number.isFinite(d)||d<=0)throw new Error('לא הצלחנו לקרוא את אורך הסרטון. נסו סרטון אחר.');return d}
 finally{URL.revokeObjectURL(url);try{v.removeAttribute('src');v.load()}catch(e){}}}
async function grVideo(c,f){
 const EXT={'video/mp4':1,'video/webm':1,'video/3gpp':1};let type=String(f.type||'').split(';')[0];
 if(!type){const x=(/\.(\w+)$/.exec(f.name||'')||[])[1];type=x==='mp4'?'video/mp4':x==='webm'?'video/webm':x==='3gp'?'video/3gpp':''}
 if(!EXT[type])return toast('פורמט הסרטון לא נתמך. אפשר MP4, WebM או 3GP.');
 if(f.size>VMAX)return toast('הסרטון גדול מדי (מעל 30MB). אפשר סרטון עד דקה ועד 30MB.');
 c.sending='בודק את הסרטון…';grComp();let d;
 try{d=await vidProbe(f)}catch(e){c.sending='';grComp();return toast(e.message)}
 if(d>VSEC+0.5){c.sending='';grComp();return toast('הסרטון ארוך מדי ('+Math.round(d)+' שניות). אפשר עד דקה.')}
 c.sending='מעלה את הסרטון…';grComp();
 const mid=newMid(),name=(bzB()?'b/'+SY.bizId+'/':'')+'grpv/'+c.gid+'/'+mid;
 try{const t=await tok();let r;
  try{r=await fetch(STB()+'?uploadType=media&name='+encodeURIComponent(name),{method:'POST',headers:{Authorization:'Firebase '+t,'Content-Type':type},body:f})}catch(e){throw Object.assign(new Error('אין חיבור לאינטרנט'),{offline:true})}
  if(!r.ok)throw Object.assign(new Error(r.status===403?'אין הרשאה להעלות סרטון בקבוצה הזו':'העלאת הסרטון נכשלה ('+r.status+')'),{code:r.status});
  c.sending='שולח…';grComp();
  await grPost(c,'vid',String(c.draft||'').trim().slice(0,2000),{mid,vp:name,vs:Math.min(VSEC,Math.max(1,Math.ceil(d))),vb:f.size});c.draft='';sendDone(c)}
 catch(e){c.sending='';grComp();toast(e&&e.code===403&&e.message?e.message:e&&e.offline?e.message:e&&e.code?tkErr(e):(e&&e.message)||'השליחה נכשלה')}}
/* השתקה (עובד, לא בקבוצה עם ao) */
CHG.grMute=async el=>{const c=GR.c;if(!c)return;const v=el.checked;
 try{await fsx('/grp/'+c.gid+'/r/'+SY.uid+'?updateMask.fieldPaths=mu',{method:'PATCH',body:JSON.stringify({fields:{mu:bv(v)}})});c.g.mu=v;recount();toast(v?'הקבוצה הושתקה':'ההשתקה בוטלה')}
 catch(e){el.checked=!v;toast(tkErr(e))}};
/* ⋯ של הודעה (מנהל): הצמדה / מחיקה */
ACT.grMenu=el=>{const c=GR.c;if(!c||!fbAdmin())return;const id=el.dataset.id;if(!c.msgs.some(x=>x.id===id))return;const pd=c.g.pin&&c.g.pin.mid===id;
 dlg(`<h3>אפשרויות הודעה</h3><button class="btn g w" data-a="grPin" data-id="${esc(id)}" style="margin-bottom:8px">${pd?'בטל הצמדה':'📌 הצמד'}</button><button class="btn r w" data-a="grDel" data-id="${esc(id)}" style="margin-bottom:8px">🗑 מחק הודעה</button><button class="btn g w" data-a="closeDlg">ביטול</button>`)};
/* הצמדה: עדכון חלקי של השדה pin בלבד; שרת ישן (403) = הודעה ברורה */
ACT.grPin=async el=>{const c=GR.c;if(!c||!fbAdmin())return;closeDlg();const id=el.dataset.id,m=c.msgs.find(x=>x.id===id);if(!m)return;
 const un=c.g.pin&&c.g.pin.mid===id,q='/grp/'+c.gid+'?updateMask.fieldPaths=pin';
 try{if(un){await fsx(q,{method:'PATCH',body:JSON.stringify({fields:{}})});c.g.pin=null;toast('ההצמדה בוטלה')}
  else{const txt=m.k==='img'?'📷 תמונה':m.k==='vid'?'🎬 סרטון':String(m.txt||'').replace(/\s+/g,' ').trim().slice(0,120),byN=fbBy().slice(0,100),t=Date.now();
   await fsx(q,{method:'PATCH',body:JSON.stringify({fields:{pin:{mapValue:{fields:{mid:sv(id),txt:sv(txt),byN:sv(byN),t:iv(t),k:sv(m.k)}}}}})});c.g.pin={mid:id,txt,byN,t,k:m.k};toast('ההודעה הוצמדה')}
  grPinPaint()}
 catch(e){toast(e&&e.code===403?'ההצמדה תופעל בקרוב (השרת עוד לא מוכן)':tkErr(e))}};
/* לחיצה על הפס: גלילה להודעה (טוען עמודים קודמים עד גבול סביר) והדגשה */
ACT.grPinGo=async()=>{const c=GR.c;if(!c||!c.g.pin||!c.ready)return;const id=c.g.pin.mid;let n=0;
 while(!c.msgs.some(x=>x.id===id)&&c.more&&n<10){if(c.loading){await new Promise(r=>setTimeout(r,100));continue}n++;await ACT.grMore()}
 if(GR.c!==c)return;const e=document.querySelector('#grmsgs [data-mid="'+id+'"]');
 if(!e)return toast('ההודעה המוצמדת לא נמצאה (ייתכן שנמחקה)');
 e.scrollIntoView({block:'center',behavior:'smooth'});e.classList.add('hl');setTimeout(()=>e.classList.remove('hl'),1800)};
/* מחיקת הודעה – מנהל בלבד */
ACT.grDel=el=>{const c=GR.c;if(!c||!fbAdmin())return;const id=el.dataset.id,m=c.msgs.find(x=>x.id===id);if(!m)return;closeDlg();
 ask('למחוק את ההודעה? אי אפשר לשחזר.',async()=>{
  try{if(m.k==='img'){try{await fsx('/grp/'+c.gid+'/m/'+id+'/p/1',{method:'DELETE'})}catch(e){if(e.code!==404)throw e}}
   await fsx('/grp/'+c.gid+'/m/'+id,{method:'DELETE'});c.msgs=c.msgs.filter(x=>x.id!==id);grPaint();toast('ההודעה נמחקה')}
  catch(e){toast(tkErr(e))}},'מחק')};

/* ---- הגדרות קבוצה (מנהל) ---- */
async function grStaff(){if(GR.staff)return;try{const j=await fsx('/staff?pageSize=300');GR.staff=((j&&j.documents)||[]).map(d=>{const f=fvj({mapValue:d}),id=idOf(d);return{uid:id,name:String(f.name||'').trim()||String(f.email||'').split('@')[0]||id,active:f.active===true}}).filter(x=>x.active&&idOk(x.uid)).sort((a,b)=>a.name.localeCompare(b.name,'he'))}catch(e){GR.staff=null;GR.s.err=tkErr(e)}
 if(cur().v==='grs')rerender()}
ACT.grNew=()=>{if(!fbAdmin())return;GR.s={gid:'',name:'',mem:new Set(),ao:false,md:true,err:'',busy:0};go('grs','')};
ACT.grSet=el=>{if(!fbAdmin())return;const g=gGet(el.dataset.id);if(!g)return;GR.s={gid:g.id,name:g.name,mem:new Set(g.mem),ao:g.ao,md:g.md,err:'',busy:0};go('grs',g.id)};
V.grs=()=>{const s=GR.s;if(!on()||!fbAdmin()||!s)return{t:'הגדרות קבוצה',s:'',h:'<div class="card"><p class="note">המסך הזה למנהל בלבד.</p></div>'};
 if(GR.staff===null&&!s.err)grStaff();
 const L=GR.staff||[],all=L.length&&L.every(x=>s.mem.has(x.uid));
 const mem=GR.staff===null?`<p class="note">${s.err?esc(s.err):'טוען עובדים…'}</p>`:L.length?L.map(x=>`<label class="gr-mem"><input type="checkbox" data-c="grMem" data-u="${esc(x.uid)}"${s.mem.has(x.uid)?' checked':''}>${grAvatar(x.name).replace('gr-av','gr-av" style="width:30px;height:30px;font-size:.9rem')}<span>${esc(x.name)}</span></label>`).join(''):'<p class="note">אין עובדים פעילים.</p>';
 return{t:s.gid?'הגדרות קבוצה':'קבוצה חדשה',s:'',h:`<form class="card" data-f="grSave"><label class="f"><span>שם הקבוצה</span><input data-i="grName" maxlength="60" value="${esc(s.name)}" required autocomplete="off"></label>
 <div style="display:flex;justify-content:space-between;align-items:center;margin:10px 0 4px"><b>חברי הקבוצה</b><button type="button" class="chip" data-a="grAll" style="min-height:36px">${all?'בטל הכול':'בחר הכול'}</button></div><div class="card" style="padding:2px 12px;margin:0 0 10px">${mem}</div>
 <label class="opt" style="margin-bottom:8px"><span>רק המנהל יכול לשלוח<small style="display:block;font-weight:400;color:var(--mut)">עובדים רק קוראים</small></span><input type="checkbox" data-c="grAo"${s.ao?' checked':''}></label>
 <div class="card" style="margin:0 0 10px"><label class="opt" style="margin:0"><span>מותר לשלוח תמונות וסרטונים<small style="display:block;font-weight:400;color:var(--mut)">כבוי = רק טקסט</small></span><input type="checkbox" data-c="grMd"${s.md?' checked':''}></label><p class="note" style="margin:8px 0 0">סרטון עד דקה · נמחק אחרי 90 יום (ההודעה נשארת)</p></div>
 <button class="btn w"${s.busy?' disabled':''}>שמור</button></form>${s.gid?'<button class="btn r w" data-a="grDelG" style="margin-top:10px">מחק קבוצה</button>':''}`}};
INP.grName=el=>{if(GR.s)GR.s.name=el.value};
CHG.grMem=el=>{const s=GR.s;if(!s)return;if(el.checked)s.mem.add(el.dataset.u);else s.mem.delete(el.dataset.u);rerender()};
CHG.grAo=el=>{if(GR.s)GR.s.ao=el.checked};CHG.grMd=el=>{if(GR.s)GR.s.md=el.checked};
ACT.grAll=()=>{const s=GR.s,L=GR.staff||[];if(!s||!L.length)return;if(L.every(x=>s.mem.has(x.uid)))s.mem.clear();else L.forEach(x=>s.mem.add(x.uid));rerender()};
FRM.grSave=async f=>{const s=GR.s;if(!s||!fbAdmin()||s.busy)return;const nm=String(s.name||'').trim().slice(0,60);
 if(!nm)return toast('כתוב שם לקבוצה');if(!s.mem.size)return toast('בחר לפחות עובד אחד');
 s.busy=1;const mem={arrayValue:{values:[...s.mem].map(sv)}};
 try{if(s.gid){await fsx('/grp/'+s.gid+'?'+['name','mem','ao','md'].map(k=>'updateMask.fieldPaths='+k).join('&'),{method:'PATCH',body:JSON.stringify({fields:{name:sv(nm),mem,ao:bv(s.ao),md:bv(s.md)}})})}
  else{const id=newMid();await fsx('/grp?documentId='+encodeURIComponent(id),{method:'POST',body:JSON.stringify({fields:{name:sv(nm),mem,ao:bv(s.ao),md:bv(s.md),by:sv(SY.uid),t:iv(Date.now())}})})}
  GR.at=0;GR.L=null;GR.s=null;if(GR.c&&GR.c.g&&s.gid===GR.c.gid){Object.assign(GR.c.g,{name:nm,mem:[...s.mem],ao:s.ao,md:s.md})}toast('נשמר');goBack()}
 catch(e){s.busy=0;toast(tkErr(e))}};
ACT.grDelG=()=>{const s=GR.s;if(!s||!s.gid||!fbAdmin())return;
 ask('למחוק את הקבוצה "'+s.name+'" עם כל ההודעות? אי אפשר לשחזר.',async()=>{
  try{await fsx('/grp/'+s.gid,{method:'DELETE'});GR.at=0;GR.L=null;GR.c=null;GR.s=null;toast('הקבוצה נמחקה');NAV=NAV.filter(x=>x.v!=='grc'&&x.v!=='grs');if(!NAV.length)NAV=[{v:'home'}];render(-1)}
  catch(e){toast(tkErr(e))}},'מחק קבוצה')};
})();
