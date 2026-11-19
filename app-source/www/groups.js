/* קבוצות התכתבות (17.11.2026, סבב 3, חבילה ב'). נטען אחרי index.html. הכול מאחורי bzF('groups'); בלי הקובץ הזה האפליקציה נשארת כמו קודם.
   נתונים (חוזה): grp/{gid} {name,mem[],ao,md,by,t,last{txt,byN,t,k}}, grp/{gid}/m/{mid} {by,byN,t,k:t|img|vid,txt,vp,vs,vb},
   תמונה grp/{gid}/m/{mid}/p/1 {img,t,uid} (אותה דחיסה ואותו דפוס כמו תמונות בבקשות), מצב קריאה grp/{gid}/r/{uid} {t,mu}.
   סרטון: Storage grpv/{gid}/{mid} (בעסק b: b/{bizId}/grpv/...), עד 60 שניות ו-30MB; נמחק בשרת אחרי 90 יום (ההודעה נשארת).
   ה-last וההתראות נכתבים בשרת (עובד לא יכול לכתוב ל-grp/{gid}). 403 ברשימה = שרת ישן ← "הקבוצות יופעלו בקרוב".
   תוספת 19.11: הודעה יכולה לכלול re {mid,txt,byN,k} (תשובה) ו-fw (הועברה). סימונים (אימוג'י): grp/{gid}/x/{mid}_{uid} {mid,uid,byN,e,t}, e='' = בוטל.
   תפריט ⋯ לכל הודעה (לכולם): סימון, תשובה, שיתוף מחוץ לאפליקציה, העברה לקבוצה אחרת, שמירה בגלריה; למנהל גם הצמדה ומחיקה.
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
const reOf=r=>r&&typeof r==='object'&&idOk(String(r.mid||''))?{mid:String(r.mid),txt:String(r.txt||'').slice(0,120),byN:String(r.byN||'').slice(0,100),k:r.k==='img'||r.k==='vid'?r.k:'t'}:null;
const mOf=d=>{const f=fvj({mapValue:d})||{};return{id:idOf(d),by:String(f.by||''),byN:String(f.byN||''),t:+f.t||0,k:f.k==='img'||f.k==='vid'?f.k:'t',txt:String(f.txt||''),vp:String(f.vp||''),vs:+f.vs||0,vb:+f.vb||0,re:reOf(f.re),fw:f.fw===true}};
/* סימונים: רשימה קבועה (זהה לכללי השרת) */
const EMO=['👍','❤️','😂','😮','😢','🙏'];
const mSum=m=>m.k==='img'?'📷 תמונה'+(m.txt?' '+m.txt:''):m.k==='vid'?'🎬 סרטון'+(m.txt?' '+m.txt:''):String(m.txt||'');
const cut120=t=>String(t||'').replace(/\s+/g,' ').trim().slice(0,120);
const canSend=g=>!!g&&(fbAdmin()||!g.ao);
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
.gr-b{padding-inline-end:30px}
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
.gr-q{display:block;width:100%;text-align:start;background:var(--bg);color:var(--ink);border:0;border-inline-start:3px solid var(--acc);border-radius:8px;padding:4px 8px;margin:2px 0 4px;font-size:.8rem;min-height:0;cursor:pointer;overflow:hidden}
.gr-q b{display:block;color:var(--acc);font-size:.74rem}.gr-q span{display:block;color:var(--mut);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gr-fw{font-size:.72rem;color:var(--mut);font-style:italic;margin-bottom:2px}
.gr-rx{display:inline-flex;gap:4px;align-items:center;margin-top:4px;background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:1px 8px;font-size:.84rem;min-height:26px;color:var(--ink);cursor:pointer}
.gr-rx.me{border-color:var(--acc)}
.gr-emo{display:flex;justify-content:space-between;gap:4px;margin-bottom:12px}
.gr-emo button{flex:1;min-height:48px;font-size:1.5rem;border-radius:12px;background:var(--card);border:1px solid var(--line);cursor:pointer;padding:0}
.gr-emo button.on{border:2px solid var(--acc);background:var(--acc2)}
.gr-rebar{display:flex;align-items:center;gap:8px;margin-bottom:6px}.gr-rebar .gr-q{flex:1;margin:0;cursor:default}
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
ACT.grOpen=el=>{const id=el.dataset.id;if(!idOk(id))return;const g=gGet(id);if(!g)return;GR.c={gid:id,g,msgs:[],more:false,rt:0,rtSaved:0,unr:'',ready:0,loading:1,started:0,draft:'',sending:'',gone:0,tm:0,rx:new Map(),xt:0,xoff:0,re:null};go('grc',id)};
/* לחיצה על התראה (data.k='grp', data.id=gid): פותח את שיחת הקבוצה */
async function grOpenId(id){if(!on()||!idOk(String(id||'')))return;
 try{const g=gOf(await fsx('/grp/'+id));if(!g.id)throw 0;GR.c={gid:id,g,msgs:[],more:false,rt:0,rtSaved:0,unr:'',ready:0,loading:1,started:0,draft:'',sending:'',gone:0,tm:0,rx:new Map(),xt:0,xoff:0,re:null};go('grc',id)}
 catch(e){toast('הקבוצה לא זמינה')}}
window.GRP={n:()=>on()?GR.n:0,tick:grTick,off:()=>GR.off,open:grOpenId};

/* ---- שיחה ---- */
const mineId=m=>m.by===SY.uid;
function msgH(m,c){
 const me=mineId(m);let b='';
 if(m.k==='img'){const du=GR.img[c.gid+'/'+m.id];b=`<button class="gr-pic" data-a="grImg" data-id="${esc(m.id)}" aria-label="תמונה">${du?`<img src="${esc(du)}" alt="תמונה">`:`<span class="ph" data-gimg="${esc(m.id)}">${GR.img['x'+c.gid+'/'+m.id]?'התמונה לא נטענה. לחץ לנסות שוב':'טוען תמונה…'}</span>`}</button>`}
 else if(m.k==='vid'){const old=Date.now()-m.t>90*DAY;b=old||m.gone?`<div class="gr-pic" style="cursor:default"><span class="ph">🎬 הסרטון נמחק אחרי 90 יום</span></div>`:`<button class="gr-pic" data-a="grVid" data-id="${esc(m.id)}" aria-label="סרטון"><span class="ph" style="min-height:110px;background:var(--bg)"></span><span class="play">▶</span><span class="dr">${dur(m.vs)}</span></button>`}
 const q=m.re?`<button class="gr-q" data-a="grJump" data-id="${esc(m.re.mid)}"><b>${esc(m.re.byN||'')}</b><span>${esc(m.re.k==='img'?'📷 '+(m.re.txt||'תמונה'):m.re.k==='vid'?'🎬 '+(m.re.txt||'סרטון'):m.re.txt)}</span></button>`:'';
 return `<div class="gr-b${me?' me':''}" data-mid="${esc(m.id)}"><button class="dl" data-a="grMenu" data-id="${esc(m.id)}" aria-label="אפשרויות הודעה">⋯</button>${me?'':`<div class="who">${esc(m.byN||'')}</div>`}${m.fw?'<div class="gr-fw">↪ הועברה</div>':''}${q}${b}${m.txt?`<div class="tx">${esc(m.txt)}</div>`:''}${rxH(m,c)}<div class="tm">${hm(m.t)}</div></div>`}
function rxH(m,c){const r=c.rx&&c.rx.get(m.id);if(!r)return '';const cnt={};let mine='';r.forEach((x,u)=>{if(!x.e)return;cnt[x.e]=(cnt[x.e]||0)+1;if(u===SY.uid)mine=x.e});
 const ks=EMO.filter(e=>cnt[e]);if(!ks.length)return '';return `<button class="gr-rx${mine?' me':''}" data-a="grRxWho" data-id="${esc(m.id)}" aria-label="מי סימן">${ks.map(e=>e+(cnt[e]>1?' '+cnt[e]:'')).join(' ')}</button>`}
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
 const dis=c.sending?' disabled':'',re=c.re?`<div class="gr-rebar"><div class="gr-q"><b>↩ תשובה ל${esc(c.re.byN||'')}</b><span>${esc(c.re.k==='img'?'📷 '+(c.re.txt||'תמונה'):c.re.k==='vid'?'🎬 '+(c.re.txt||'סרטון'):c.re.txt)}</span></div><button class="gr-circ" data-a="grReX" aria-label="בטל תשובה" style="width:36px;height:36px">✕</button></div>`:'';
 return `${re}<div class="gr-comp">${g.md?`<label class="gr-circ" aria-label="צרף תמונה או סרטון" style="${c.sending?'opacity:.5':''}">📎<input type="file" accept="image/*,video/*" data-c="grFile" hidden${dis}></label>`:''}<textarea id="grtx" data-i="grDraft" rows="1" maxlength="2000" placeholder="כתוב הודעה…" aria-label="הודעה"${dis}>${esc(c.draft)}</textarea><button class="gr-circ go" data-a="grSend" aria-label="שלח"${dis}>➤</button></div>${c.sending?`<p class="note" style="margin:6px 0 0">${esc(c.sending)}</p>`:''}`}
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
  const f=c.msgs.find(m=>m.t>c.rt&&!mineId(m));c.unr=f?f.id:'';await grRxLoad(c,true);c.ready=1;c.loading=0}
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
 c.pt=(c.pt||0)+1;if(c.pt%4===0)grPinGet(c);if(c.pt%2===0&&await grRxLoad(c,false)&&GR.c===c)grPaint();
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
 const re=x&&x.re||null;if(re)f.re={mapValue:{fields:{mid:sv(re.mid),txt:sv(cut120(re.txt)),byN:sv(String(re.byN||'').slice(0,100)),k:sv(re.k)}}};if(x&&x.fw)f.fw=bv(true);
 await fsx('/grp/'+c.gid+'/m?documentId='+encodeURIComponent(mid),{method:'POST',body:JSON.stringify({fields:f})});
 const m={id:mid,by:SY.uid,byN:fbBy(),t:+f.t.integerValue,k,txt,vp:x&&x.vp||'',vs:x&&x.vs||0,vb:x&&x.vb||0,re:re?reOf(re):null,fw:!!(x&&x.fw)};
 c.msgs.push(m);return m}
const sendDone=c=>{c.sending='';c.re=null;grComp();grPaint('bottom');grMark()};
const reX=c=>c.re?{re:c.re}:null;
const sendErr=(c,e)=>{c.sending='';grComp();toast(tkErr(e))};
ACT.grSend=async()=>{const c=GR.c;if(!c||c.sending||!c.ready)return;const tx=$('#grtx'),txt=String((tx?tx.value:c.draft)||'').trim().slice(0,2000);if(!txt)return;
 if(!fbAdmin()&&c.g.ao)return toast('רק המנהל יכול לשלוח הודעות בקבוצה הזו');
 c.sending='שולח…';grComp();
 try{await grPost(c,'t',txt,reX(c));c.draft='';sendDone(c)}catch(e){c.draft=txt;sendErr(c,e)}};
CHG.grFile=async el=>{const f=el.files&&el.files[0];el.value='';const c=GR.c;if(!f||!c||c.sending||!c.g.md)return;
 const tx=$('#grtx');if(tx)c.draft=tx.value;
 if(/^video\//.test(f.type||'')||/\.(mp4|webm|3gp|mov)$/i.test(f.name||''))return grVideo(c,f);
 if(f.type&&!/^image\//.test(f.type))return toast('אפשר לשלוח תמונה או סרטון בלבד');
 c.sending='מכין את התמונה…';grComp();
 let du;try{du=await fbShrink(await rdU(f));if(du.length>880000||!imgOk(du))throw 0}catch(e){c.sending='';grComp();return toast('תמונה לא תקינה או גדולה מדי')}
 c.sending='שולח…';grComp();
 try{const cap=String(c.draft||'').trim().slice(0,2000),m=await grPost(c,'img',cap,reX(c));GR.img[c.gid+'/'+m.id]=du;c.draft='';
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
  await grPost(c,'vid',String(c.draft||'').trim().slice(0,2000),{mid,vp:name,vs:Math.min(VSEC,Math.max(1,Math.ceil(d))),vb:f.size,re:c.re});c.draft='';sendDone(c)}
 catch(e){c.sending='';grComp();toast(e&&e.code===403&&e.message?e.message:e&&e.offline?e.message:e&&e.code?tkErr(e):(e&&e.message)||'השליחה נכשלה')}}
/* השתקה (עובד, לא בקבוצה עם ao) */
CHG.grMute=async el=>{const c=GR.c;if(!c)return;const v=el.checked;
 try{await fsx('/grp/'+c.gid+'/r/'+SY.uid+'?updateMask.fieldPaths=mu',{method:'PATCH',body:JSON.stringify({fields:{mu:bv(v)}})});c.g.mu=v;recount();toast(v?'הקבוצה הושתקה':'ההשתקה בוטלה')}
 catch(e){el.checked=!v;toast(tkErr(e))}};
/* ⋯ של הודעה (כולם): סימון, תשובה, שיתוף, העברה, שמירה בגלריה; מנהל: גם הצמדה ומחיקה */
ACT.grMenu=el=>{const c=GR.c;if(!c)return;const id=el.dataset.id,m=c.msgs.find(x=>x.id===id);if(!m)return;const adm=fbAdmin(),pd=c.g.pin&&c.g.pin.mid===id;
 const r=c.rx&&c.rx.get(id),mine=r&&r.get(SY.uid)?r.get(SY.uid).e:'',I=`data-id="${esc(id)}"`,B=(a,t,cl)=>`<button class="btn ${cl||'g'} w" data-a="${a}" ${I} style="margin-bottom:8px">${t}</button>`;
 const media=m.k==='img'||(m.k==='vid'&&!m.gone&&Date.now()-m.t<=90*DAY);
 dlg(`<h3>אפשרויות הודעה</h3>${c.xoff?'':`<div class="gr-emo">${EMO.map(e=>`<button class="${e===mine?'on':''}" data-a="grReact" ${I} data-e="${e}" aria-label="סמן ${e}">${e}</button>`).join('')}</div>`}`
  +(canSend(c.g)?B('grRe','↩ השב'):'')+B('grShare','📤 שיתוף')+B('grFwd','↪ העבר לקבוצה אחרת')+(media?B('grGal',m.k==='img'?'⬇ שמור תמונה בגלריה':'⬇ שמור סרטון בגלריה'):'')
  +(adm?B('grPin',pd?'בטל הצמדה':'📌 הצמד')+B('grDel','🗑 מחק הודעה','r'):'')+'<button class="btn g w" data-a="closeDlg">ביטול</button>')};
/* הצמדה: עדכון חלקי של השדה pin בלבד; שרת ישן (403) = הודעה ברורה */
ACT.grPin=async el=>{const c=GR.c;if(!c||!fbAdmin())return;closeDlg();const id=el.dataset.id,m=c.msgs.find(x=>x.id===id);if(!m)return;
 const un=c.g.pin&&c.g.pin.mid===id,q='/grp/'+c.gid+'?updateMask.fieldPaths=pin';
 try{if(un){await fsx(q,{method:'PATCH',body:JSON.stringify({fields:{}})});c.g.pin=null;toast('ההצמדה בוטלה')}
  else{const txt=m.k==='img'?'📷 תמונה':m.k==='vid'?'🎬 סרטון':String(m.txt||'').replace(/\s+/g,' ').trim().slice(0,120),byN=fbBy().slice(0,100),t=Date.now();
   await fsx(q,{method:'PATCH',body:JSON.stringify({fields:{pin:{mapValue:{fields:{mid:sv(id),txt:sv(txt),byN:sv(byN),t:iv(t),k:sv(m.k)}}}}})});c.g.pin={mid:id,txt,byN,t,k:m.k};toast('ההודעה הוצמדה')}
  grPinPaint()}
 catch(e){toast(e&&e.code===403?'ההצמדה תופעל בקרוב (השרת עוד לא מוכן)':tkErr(e))}};
/* לחיצה על הפס: גלילה להודעה (טוען עמודים קודמים עד גבול סביר) והדגשה */
ACT.grPinGo=()=>{const c=GR.c;if(c&&c.g.pin)return grJump(c.g.pin.mid,'ההודעה המוצמדת לא נמצאה (ייתכן שנמחקה)')};
ACT.grJump=el=>grJump(el.dataset.id,'ההודעה המקורית לא נמצאה (ייתכן שנמחקה)');
async function grJump(id,miss){const c=GR.c;if(!c||!c.ready||!idOk(String(id||'')))return;let n=0;
 while(!c.msgs.some(x=>x.id===id)&&c.more&&n<10){if(c.loading){await new Promise(r=>setTimeout(r,100));continue}n++;await ACT.grMore()}
 if(GR.c!==c)return;const e=document.querySelector('#grmsgs [data-mid="'+id+'"]');
 if(!e)return toast(miss);
 e.scrollIntoView({block:'center',behavior:'smooth'});e.classList.add('hl');setTimeout(()=>e.classList.remove('hl'),1800)}
/* מחיקת הודעה – מנהל בלבד */
ACT.grDel=el=>{const c=GR.c;if(!c||!fbAdmin())return;const id=el.dataset.id,m=c.msgs.find(x=>x.id===id);if(!m)return;closeDlg();
 ask('למחוק את ההודעה? אי אפשר לשחזר.',async()=>{
  try{if(m.k==='img'){try{await fsx('/grp/'+c.gid+'/m/'+id+'/p/1',{method:'DELETE'})}catch(e){if(e.code!==404)throw e}}
   await fsx('/grp/'+c.gid+'/m/'+id,{method:'DELETE'});c.msgs=c.msgs.filter(x=>x.id!==id);c.rx.delete(id);grRxDel(c.gid,id);if(c.g&&c.g.pin&&c.g.pin.mid===id){delete c.g.pin;grPinPaint()}/* ההצמדה מתבטלת בשרת; מסירים מיד גם במסך */grPaint();toast('ההודעה נמחקה')}
  catch(e){toast(tkErr(e))}},'מחק')};

/* ---- סימונים (אימוג'י) – grp/{gid}/x/{mid}_{uid}. כניסה: 500 האחרונים; סקירה: לפי t עם חפיפה של 130 שניות (שעונים של מכשירים שונים) ---- */
async function grRxLoad(c,full){if(c.xoff)return false;
 try{const sq=full?{from:[{collectionId:'x'}],orderBy:[{field:{fieldPath:'t'},direction:'DESCENDING'}],limit:500}
   :{from:[{collectionId:'x'}],where:tF('GREATER_THAN',Math.max(0,c.xt-130000)),orderBy:[{field:{fieldPath:'t'},direction:'ASCENDING'}],limit:200};
  const d=await qrun('/grp/'+c.gid,sq);let ch=false;
  d.forEach(doc=>{const f=fvj({mapValue:doc})||{},mid=String(f.mid||''),u=String(f.uid||''),e=EMO.includes(f.e)?f.e:'',t=+f.t||0;if(!idOk(mid)||!idOk(u))return;
   if(t>c.xt)c.xt=t;let r=c.rx.get(mid);if(!r){r=new Map();c.rx.set(mid,r)}const o=r.get(u);if(o&&o.t>=t)return;r.set(u,{e,byN:String(f.byN||'').slice(0,100),t});ch=true});
  return ch}
 catch(e){if(e&&e.code===403)c.xoff=1;return false}}
async function grRxDel(gid,mid){try{const d=await qrun('/grp/'+gid,{from:[{collectionId:'x'}],where:{fieldFilter:{field:{fieldPath:'mid'},op:'EQUAL',value:sv(mid)}},limit:300});
 await Promise.all(d.map(x=>fsx('/grp/'+gid+'/x/'+idOf(x),{method:'DELETE'}).catch(()=>{})))}catch(e){}}
/* סימון: לחיצה על אותו אימוג'י שוב = ביטול (e=''). עדכון מיידי במסך, וחזרה אחורה אם השמירה נכשלה */
ACT.grReact=async el=>{const c=GR.c;if(!c)return;closeDlg();if(c.xoff)return toast('הסימונים יופעלו בקרוב');
 const mid=el.dataset.id,e0=el.dataset.e;if(!idOk(String(mid||''))||!EMO.includes(e0)||!c.msgs.some(x=>x.id===mid))return;
 let r=c.rx.get(mid);if(!r){r=new Map();c.rx.set(mid,r)}const old=r.get(SY.uid),e=old&&old.e===e0?'':e0,t=Date.now(),byN=fbBy().slice(0,100);
 r.set(SY.uid,{e,byN,t});grPaint();
 try{await fsx('/grp/'+c.gid+'/x/'+mid+'_'+SY.uid,{method:'PATCH',body:JSON.stringify({fields:{mid:sv(mid),uid:sv(SY.uid),byN:sv(byN),e:sv(e),t:iv(t)}})})}
 catch(x){if(old)r.set(SY.uid,old);else r.delete(SY.uid);grPaint();toast(x&&x.code===403?'לא הצלחנו לשמור את הסימון (ייתכן שהשרת עוד לא עודכן)':tkErr(x))}};
ACT.grRxWho=el=>{const c=GR.c;if(!c)return;const id=el.dataset.id,r=c.rx.get(id);if(!r)return;
 const L=[...r.entries()].filter(x=>x[1].e).sort((a,b)=>a[1].t-b[1].t);if(!L.length)return;const mine=r.get(SY.uid);
 dlg(`<h3>סימונים</h3><div class="card" style="padding:2px 12px;margin-bottom:10px">${L.map(([u,x])=>`<div class="gr-mem"><span style="font-size:1.3rem">${esc(x.e)}</span><span>${u===SY.uid?'אני':esc(x.byN||'')}</span></div>`).join('')}</div>${mine&&mine.e?`<button class="btn g w" data-a="grReact" data-id="${esc(id)}" data-e="${esc(mine.e)}" style="margin-bottom:8px">הסר את הסימון שלי</button>`:''}<button class="btn g w" data-a="closeDlg">סגור</button>`)};

/* ---- תשובה להודעה: ציטוט קצר נשמר בהודעה החדשה (re) ---- */
ACT.grRe=el=>{const c=GR.c;if(!c)return;closeDlg();const m=c.msgs.find(x=>x.id===el.dataset.id);if(!m||!canSend(c.g))return;
 const t0=$('#grtx');if(t0)c.draft=t0.value;
 c.re={mid:m.id,txt:cut120(m.txt),byN:mineId(m)?fbBy().slice(0,100):m.byN,k:m.k};grComp();const t=$('#grtx');if(t)t.focus()};
ACT.grReX=()=>{const c=GR.c;if(!c)return;const t=$('#grtx');if(t)c.draft=t.value;c.re=null;grComp()};

/* ---- קבצים של הודעה: תמונה מהזיכרון (או מהשרת), סרטון מהשרת (עד 30MB, רק בלחיצה) ---- */
async function imgDu(c,m){const k=c.gid+'/'+m.id;if(GR.img[k])return GR.img[k];
 const d=await fsx('/grp/'+c.gid+'/m/'+m.id+'/p/1'),du=gv(d,'img');if(!imgOk(du))throw new Error('התמונה לא נטענה');GR.img[k]=du;return du}
async function vidBlob(m){if(!m.vp||m.gone||Date.now()-m.t>90*DAY)throw new Error('הסרטון נמחק אחרי 90 יום');const t=await tok();let r;
 try{r=await fetch(STB()+'/'+encodeURIComponent(m.vp)+'?alt=media',{headers:{Authorization:'Firebase '+t}})}catch(e){throw new Error('אין חיבור לאינטרנט')}
 if(r.status===404){m.gone=1;throw new Error('הסרטון כבר לא קיים')}if(!r.ok)throw new Error('הסרטון לא נטען ('+r.status+')');return r.blob()}
const vType=b=>{const t=String(b&&b.type||'').split(';')[0];return /^video\/(mp4|webm|3gpp)$/.test(t)?t:'video/mp4'};
const vExt=t=>t==='video/webm'?'.webm':t==='video/3gpp'?'.3gp':'.mp4';
const fnm=()=>'LargePami_'+new Date().toISOString().slice(0,19).replace(/[-:T]/g,'');
async function mFile(c,m){if(m.k==='img'){const b=du2b(await imgDu(c,m));return{b,name:fnm()+(MEXT[b.type]||'.jpg'),mime:b.type||'image/jpeg'}}
 const b=await vidBlob(m),mime=vType(b);return{b,name:fnm()+vExt(mime),mime}}

/* ---- שיתוף מחוץ לאפליקציה: חלון השיתוף של הטלפון (וואטסאפ, מייל…) ---- */
async function shareTxt(txt){const C=window.Capacitor;
 if(isNat()&&C.Plugins.Share){try{await C.Plugins.Share.share({text:txt,dialogTitle:'שיתוף ההודעה'})}catch(e){if(!/cancel/i.test(String(e&&e.message)))toast('השיתוף נכשל')}return}
 if(navigator.share){try{await navigator.share({text:txt})}catch(e){}return}
 try{await navigator.clipboard.writeText(txt);toast('ההודעה הועתקה')}catch(e){toast('השיתוף לא נתמך במכשיר הזה')}}
async function shareFile(o,txt){const C=window.Capacitor;
 if(isNat()&&C.Plugins.Filesystem&&C.Plugins.Share){const r=await C.Plugins.Filesystem.writeFile({path:o.name,data:u8b64(new Uint8Array(await o.b.arrayBuffer())),directory:'CACHE'});
  const a={title:o.name,url:r.uri,dialogTitle:'שיתוף'};if(txt)a.text=txt;try{await C.Plugins.Share.share(a)}catch(e){if(!/cancel/i.test(String(e&&e.message)))throw e}return}
 if(typeof File==='function'&&navigator.canShare&&navigator.share){const f=new File([o.b],o.name,{type:o.mime});if(navigator.canShare({files:[f]})){try{await navigator.share(txt?{files:[f],text:txt}:{files:[f]})}catch(e){if(!e||e.name!=='AbortError')throw e}return}}
 await saveFile(o.name,o.b,o.mime)}
ACT.grShare=async el=>{const c=GR.c;if(!c)return;closeDlg();const m=c.msgs.find(x=>x.id===el.dataset.id);if(!m)return;
 try{if(m.k==='t')return await shareTxt(m.txt);toast(m.k==='vid'?'מכין את הסרטון לשיתוף…':'מכין את התמונה לשיתוף…');await shareFile(await mFile(c,m),m.txt)}
 catch(e){if(m.gone)grPaint();toast(e&&e.message?e.message:'השיתוף נכשל')}};

/* ---- שמירה בגלריה: SaveFile.gallery (אנדרואיד 10 ומעלה, תיקיית LargePami בתמונות/בסרטונים).
   APK ישן בלי gallery, או אנדרואיד ישן – חלון "שמירה בשם" (SaveFile.save). בדפדפן – הורדה ---- */
async function galSave(o){const C=window.Capacitor;if(!isNat())return saveFile(o.name,o.b,o.mime);
 const data=u8b64(new Uint8Array(await o.b.arrayBuffer())),P=C.Plugins.SaveFile;
 if(P&&typeof P.gallery==='function'){try{await P.gallery({filename:o.name,mime:o.mime,data});return toast('✓ נשמר בגלריה')}
  catch(e){const s=String(e&&(e.message||e));if(!/not implemented|unimplemented|old_android/i.test(s))return toast('השמירה נכשלה: '+s)}}
 if(P){try{await P.save({filename:o.name,mime:o.mime,data});toast('✓ נשמר במכשיר')}catch(e){const s=String(e&&(e.message||e));toast(/cancel/i.test(s)?'השמירה בוטלה':'השמירה נכשלה: '+s)}return}
 await saveFile(o.name,o.b,o.mime)}
ACT.grGal=async el=>{const c=GR.c;if(!c)return;closeDlg();const m=c.msgs.find(x=>x.id===el.dataset.id);if(!m||m.k==='t')return;
 try{toast(m.k==='vid'?'מוריד את הסרטון…':'שומר…');await galSave(await mFile(c,m))}
 catch(e){if(m.gone)grPaint();toast(e&&e.message?e.message:'השמירה נכשלה')}};

/* ---- העברה לקבוצה אחרת: רק לקבוצה שמותר לי לשלוח בה (ולמדיה – רק כשמדיה מותרת שם). ההודעה החדשה מסומנת fw ---- */
ACT.grFwd=async el=>{const c=GR.c;if(!c)return;closeDlg();const id=el.dataset.id,m=c.msgs.find(x=>x.id===id);if(!m)return;
 if(GR.L===null){if(GR.busy)return toast('טוען קבוצות, נסו שוב בעוד רגע');toast('טוען קבוצות…');await grLoad()}
 const L=(GR.L||[]).filter(g=>g.id!==c.gid&&canSend(g)&&(m.k==='t'||g.md));
 if(!L.length)return toast(m.k==='t'?'אין קבוצה אחרת שאפשר להעביר אליה':'אין קבוצה אחרת שאפשר לשלוח אליה תמונות וסרטונים');
 dlg(`<h3>העברה לקבוצה</h3>${L.map(g=>`<button class="li gr-row" data-a="grFwdGo" data-id="${esc(id)}" data-g="${esc(g.id)}">${grAvatar(g.name)}<div class="t"><b>${esc(g.name)}</b></div></button>`).join('')}<button class="btn g w" data-a="closeDlg" style="margin-top:8px">ביטול</button>`)};
ACT.grFwdGo=async el=>{const c=GR.c;if(!c||c.fwd)return;const m=c.msgs.find(x=>x.id===el.dataset.id),g=(GR.L||[]).find(x=>x.id===el.dataset.g);closeDlg();
 if(!m||!g||!canSend(g)||(m.k!=='t'&&!g.md))return;c.fwd=1;const tc={gid:g.id,msgs:[]};
 try{if(m.k==='t')await grPost(tc,'t',m.txt,{fw:1});
  else if(m.k==='img'){toast('מעביר את התמונה…');const du=await imgDu(c,m),nm=await grPost(tc,'img',m.txt,{fw:1});
   await fsx('/grp/'+g.id+'/m/'+nm.id+'/p/1',{method:'PATCH',body:JSON.stringify({fields:{img:sv(du),t:iv(Date.now()),uid:sv(SY.uid)}})})}
  else{toast('מעביר את הסרטון…');const b=await vidBlob(m),type=vType(b);if(b.size>VMAX)throw new Error('הסרטון גדול מדי');
   const mid=newMid(),name=(bzB()?'b/'+SY.bizId+'/':'')+'grpv/'+g.id+'/'+mid,t=await tok();let r;
   try{r=await fetch(STB()+'?uploadType=media&name='+encodeURIComponent(name),{method:'POST',headers:{Authorization:'Firebase '+t,'Content-Type':type},body:b})}catch(e){throw new Error('אין חיבור לאינטרנט')}
   if(!r.ok)throw new Error(r.status===403?'אין הרשאה לשלוח סרטון בקבוצה הזו':'העלאת הסרטון נכשלה ('+r.status+')');
   await grPost(tc,'vid',m.txt,{mid,vp:name,vs:Math.min(VSEC,Math.max(1,m.vs||1)),vb:b.size,fw:1})}
  GR.at=0;toast('הועבר לקבוצה '+g.name)}
 catch(e){if(m.gone)grPaint();toast(e&&e.code===403?'אין הרשאה להעביר לקבוצה הזו (ייתכן שהשרת עוד לא עודכן)':e&&e.code?tkErr(e):(e&&e.message)||'ההעברה נכשלה')}
 finally{c.fwd=0}};

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
