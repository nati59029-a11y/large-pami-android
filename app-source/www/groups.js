/* קבוצות התכתבות (17.11.2026, סבב 3, חבילה ב'). נטען אחרי index.html. הכול מאחורי bzF('groups'); בלי הקובץ הזה האפליקציה נשארת כמו קודם.
   נתונים (חוזה): grp/{gid} {name,mem[],ao,md,by,t,last{txt,byN,t,k}}, grp/{gid}/m/{mid} {by,byN,t,k:t|img|vid,txt,vp,vs,vb},
   תמונה grp/{gid}/m/{mid}/p/1 {img,t,uid} (אותה דחיסה ואותו דפוס כמו תמונות בבקשות), מצב קריאה grp/{gid}/r/{uid} {t,d,u,n,mu}: t=נקרא עד, d=התקבל עד, u=זמן כתיבה, n=תחילית מייל, mu רק false (השתקה בוטלה). נוכחות pres/{uid} {on,t,n,e}.
   סרטון: Storage grpv/{gid}/{mid} (בעסק b: b/{bizId}/grpv/...), עד 60 שניות ו-30MB; נמחק בשרת אחרי 90 יום (ההודעה נשארת).
   ה-last וההתראות נכתבים בשרת (עובד לא יכול לכתוב ל-grp/{gid}). 403 ברשימה = שרת ישן ← "הקבוצות יופעלו בקרוב".
   תוספת 19.11: הודעה יכולה לכלול re {mid,txt,byN,k} (תשובה) ו-fw (הועברה). סימונים (אימוג'י): grp/{gid}/x/{mid}_{uid} {mid,uid,byN,e,t}, e='' = בוטל.
   תפריט ⋯ לכל הודעה (לכולם): סימון, תשובה, שיתוף מחוץ לאפליקציה, העברה לקבוצה אחרת, שמירה בגלריה; למנהל גם הצמדה ומחיקה.
   וי (23.11): ✓ נשמר, ✓✓ אפור כולם d>=t ההודעה, ✓✓ כחול כולם t>=t ההודעה; 403 בכתיבה/קריאה של r = חוזרים ל-t בלבד / ✓ בלבד.
   מסכים: V.gr (רשימה), V.grc (שיחה), V.grs (הגדרות מנהל).
   שמירה במכשיר (24.11.2026): הקבוצות, עד 150 ההודעות האחרונות בכל קבוצה, התמונות (עד 150) והודעות שממתינות לשליחה נשמרות ב-IndexedDB (lp-grp),
   לפי עסק ומשתמש. כניסה מציגה מיד את מה שבמכשיר ומתעדכנת מהשרת ברקע; בלי רשת רואים את מה שנשמר, והודעת טקסט נשלחת כשהרשת חוזרת (🕓).
   מהירות: בשיחה פתוחה בודקים כל 3 שניות, ומיד כשמגיעה התראה, כשחוזרים לאפליקציה וכשהרשת חוזרת. יציאה מהחשבון מוחקת את השמירה (GRP.out). */
(function(){'use strict';
if(typeof V==='undefined'||typeof fsx!=='function'||typeof bzF!=='function')return;
const DAY=864e5,VMAX=30*1024*1024,VSEC=60,PAGE=50,CNTMAX=100;
const GR={L:null,at:0,busy:0,off:0,err:'',n:0,c:null,s:null,staff:null,img:{},vu:'',q:[],ix:null,cb:0};
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
const gOf=d=>{const f=fvj({mapValue:d})||{},l=f.last&&typeof f.last==='object'?f.last:null;return{id:idOf(d),name:String(f.name||'').slice(0,60),mem:Array.isArray(f.mem)?f.mem.map(String):[],ao:f.ao===true,md:f.md===true,t:+f.t||0,last:l?{txt:String(l.txt||''),byN:String(l.byN||''),t:+l.t||0,k:String(l.k||'t')}:null,rt:0,rd:0,muw:false,n:0,np:false,pin:pOf(f.pin)}};
const reOf=r=>r&&typeof r==='object'&&idOk(String(r.mid||''))?{mid:String(r.mid),txt:String(r.txt||'').slice(0,120),byN:String(r.byN||'').slice(0,100),k:r.k==='img'||r.k==='vid'?r.k:'t'}:null;
const mOf=d=>{const f=fvj({mapValue:d})||{};return{id:idOf(d),by:String(f.by||''),byN:String(f.byN||''),t:+f.t||0,k:f.k==='img'||f.k==='vid'?f.k:'t',txt:String(f.txt||''),vp:String(f.vp||''),vs:+f.vs||0,vb:+f.vb||0,re:reOf(f.re),fw:f.fw===true}};
/* סימונים: רשימה קבועה (זהה לכללי השרת) */
const EMO=['👍','❤️','😂','😮','😢','🙏'];
const mSum=m=>m.k==='img'?'📷 תמונה'+(m.txt?' '+m.txt:''):m.k==='vid'?'🎬 סרטון'+(m.txt?' '+m.txt:''):String(m.txt||'');
const cut120=t=>String(t||'').replace(/\s+/g,' ').trim().slice(0,120);
const canSend=g=>!!g&&(fbAdmin()||!g.ao);
const gGet=id=>(GR.L||[]).find(g=>g.id===id)||(GR.c&&GR.c.g&&GR.c.g.id===id?GR.c.g:null);
const lastTx=g=>{const l=g.last;if(!l)return'אין הודעות עדיין';const t=l.k==='img'?'📷 תמונה':l.k==='vid'?'🎬 סרטון':l.txt;return(l.byN?nmP(l.byN)+': ':'')+t};
const recount=()=>{GR.n=(GR.L||[]).reduce((a,g)=>a+g.n,0)};
/* שם אמיתי לתצוגה בלבד (NM מ-act-log.js); בלי NM – הערך השמור */
const nm=(uid,byN)=>{try{return (window.NM&&(NM.byUid(uid)||NM.byPfx(byN)))||byN||''}catch(e){return byN||''}};
const nmP=byN=>nm('',byN);

/* ---- שמירה במכשיר: IndexedDB אחד (lp-grp), מפתח = עסק|משתמש|שם. כל תקלה = כאילו אין שמירה (האפליקציה עובדת כמו קודם) ---- */
const KEEP=150,IMAX=150,POLL=3000;
let CDBP=null,CDBD=null;
const cdb=()=>CDBP||(CDBP=new Promise((res,rej)=>{const r=indexedDB.open('lp-grp',1);r.onupgradeneeded=()=>r.result.createObjectStore('k');r.onsuccess=()=>{CDBD=r.result;res(r.result)};r.onerror=()=>rej(r.error)}).catch(e=>{CDBP=null;throw e}));
const ck=k=>(SY.bizId||'-')+'|'+SY.uid+'|'+k;
async function cGet(k){try{if(!SY.uid)return null;const key=ck(k),d=await cdb();return await new Promise(res=>{const r=d.transaction('k').objectStore('k').get(key);r.onsuccess=()=>res(r.result===undefined?null:r.result);r.onerror=()=>res(null)})}catch(e){return null}}
async function cPut(k,v){try{if(!SY.uid)return;const key=ck(k),d=await cdb();await new Promise(res=>{const t=d.transaction('k','readwrite'),o=t.objectStore('k');if(v===null)o.delete(key);else o.put(v,key);t.oncomplete=res;t.onerror=res;t.onabort=res})}catch(e){}}
/* תמונות: עד IMAX במכשיר, הישנה ביותר נמחקת */
async function imPut(k,du){try{if(!GR.ix){const x=await cGet('ix');GR.ix=Array.isArray(x)?x:[]}if(GR.ix.includes(k))return;GR.ix.push(k);while(GR.ix.length>IMAX)cPut('i:'+GR.ix.shift(),null);cPut('ix',GR.ix.slice());cPut('i:'+k,du)}catch(e){}}
const gLite=g=>({id:g.id,name:g.name,mem:(g.mem||[]).slice(),ao:!!g.ao,md:!!g.md,t:g.t||0,last:g.last||null,rt:g.rt||0,rd:g.rd||0,muw:false,n:g.n||0,np:!!g.np,pin:g.pin||null});
const mLite=m=>({id:m.id,by:m.by,byN:m.byN,t:m.t,k:m.k,txt:m.txt,vp:m.vp||'',vs:m.vs||0,vb:m.vb||0,re:m.re||null,fw:!!m.fw});
/* פעם אחת אחרי הכניסה: רשימת הקבוצות והתור מהמכשיר (רק אם עוד לא נטען מהשרת) */
function cBoot(){if(GR.cb||!on()||!SY.uid)return;GR.cb=SY.uid;const u=SY.uid;
 cGet('L').then(L=>{if(SY.uid!==u||GR.L!==null||!Array.isArray(L))return;GR.L=L.filter(g=>g&&idOk(String(g.id||'')));recount();const v=cur().v;if(v==='gr'||['home','wk'].includes(v))rerender();else try{wbUp()}catch(e){}});
 cGet('q').then(q=>{if(SY.uid!==u||!Array.isArray(q))return;q.forEach(x=>{if(x&&idOk(String(x.gid||''))&&idOk(String(x.mid||''))&&!GR.q.some(y=>y.mid===x.mid))GR.q.push({gid:x.gid,mid:x.mid,txt:String(x.txt||'').slice(0,2000),re:x.re||null,t:+x.t||Date.now()})});qFlush()})}
function cSaveC(c){clearTimeout(c.sv);c.sv=setTimeout(()=>{if(!c.ready||!c.msgs.length)return;const ms=c.msgs.filter(m=>!m.pend);
 cPut('c:'+c.gid,{msgs:ms.slice(-KEEP).map(mLite),rt:c.rtSaved||0,rd:[...c.rd],rx:[...c.rx].map(([k,v])=>[k,[...v]]),g:gLite(c.g)})},600)}
/* יציאה מהחשבון: מוחקים את כל מה שנשמר */
function grOut(){GR.L=null;GR.c=null;GR.img={};GR.n=0;GR.cb=0;GR.q=[];GR.ix=null;GR.at=0;try{if(CDBD)CDBD.close()}catch(e){}CDBD=null;CDBP=null;try{indexedDB.deleteDatabase('lp-grp')}catch(e){}}

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
.gr-comp textarea{flex:1;min-height:44px;max-height:40vh;border-radius:22px;padding:10px 14px;resize:none;overflow-y:auto;line-height:1.45;field-sizing:content}
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
.gr-srbar{display:flex;gap:8px;align-items:center;position:sticky;top:calc(64px + env(safe-area-inset-top));z-index:5;background:var(--bg);padding:4px 0}.gr-srbar input{flex:1;min-height:44px;border-radius:22px;padding:8px 14px}
.gr-sr .t{flex:1;min-width:0}.gr-sr .t b{display:block}.gr-sr .t span{display:block;font-size:.84rem;color:var(--mut);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.gr-sr .m{display:flex;flex-direction:column;align-items:flex-end;font-size:.74rem;color:var(--mut);flex:none}
.gr-sr mark{background:var(--acc2);color:var(--ink);border-radius:3px}
.gr-sth{width:44px;height:44px;border-radius:8px;object-fit:cover;flex:none;display:inline-flex;align-items:center;justify-content:center;background:var(--line);font-size:1.2rem}
.gr-circ.rec{background:var(--neg,#c0392b);color:#fff;border:0;animation:grpls 1.2s infinite}@keyframes grpls{50%{opacity:.6}}
.gr-b{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;transition:transform .15s}
.gr-tk{display:inline-block;min-height:0;min-width:0;height:auto;padding:0 0 0 4px;margin-inline-start:4px;border:0;background:none;color:var(--mut);font-size:.78rem;font-weight:800;cursor:pointer;vertical-align:baseline}.gr-tk.s3{color:#3aa8ff}
.gr-pr{display:flex;gap:8px;overflow-x:auto;margin-bottom:8px;padding-bottom:2px;-webkit-overflow-scrolling:touch}.gr-pr:empty{display:none}
.gr-pc{flex:none;display:inline-flex;align-items:center;gap:5px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:3px 10px;font-size:.78rem;white-space:nowrap;color:var(--ink)}.gr-pc small{color:var(--mut);font-size:.7rem}
.gr-pc i{width:9px;height:9px;border-radius:50%;background:var(--line);flex:none}.gr-pc i.on{background:#2ecc71}
.gr-emp{position:fixed;z-index:60;display:flex;gap:2px;background:var(--card);border:1px solid var(--line);border-radius:24px;padding:3px 6px;box-shadow:0 4px 14px rgba(0,0,0,.45)}
.gr-emp button{min-height:0;min-width:0;width:38px;height:38px;font-size:1.4rem;background:none;border:0;padding:0;cursor:pointer;border-radius:50%}
.gr-b.pk{outline:3px solid var(--acc);outline-offset:2px}.gr-b.pk::after{content:'✓';position:absolute;top:-8px;inset-inline-start:-8px;width:24px;height:24px;border-radius:50%;background:var(--acc);color:var(--onacc);font-weight:800;display:flex;align-items:center;justify-content:center;font-size:.85rem}
.gr-b.no{opacity:.45}
.gr-selbar{display:flex;align-items:center;gap:6px;position:sticky;top:calc(64px + env(safe-area-inset-top));z-index:6;background:var(--bg);padding:6px 0;margin-bottom:8px;border-bottom:1px solid var(--line)}.gr-selbar b{flex:1}
.gr-ct{display:flex;align-items:center;gap:10px;min-width:180px}.gr-ct .t b{display:block}.gr-ct .t span{display:block;color:var(--mut);font-size:.86rem}
.gr-cta{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}.gr-cta button{flex:1;min-height:38px;font-size:.82rem;padding:0 8px;border-radius:10px;background:var(--bg);color:var(--ink);border:1px solid var(--line);cursor:pointer;white-space:nowrap}
.gr-rebar{display:flex;align-items:center;gap:8px;margin-bottom:6px}.gr-rebar .gr-q{flex:1;margin:0;cursor:default}
`;document.head.appendChild(st);

/* ---- רשימה: קבוצות, מצב קריאה ומונה לא-נקרא (שאילתה מוגבלת, רק לקבוצה שההודעה האחרונה שלה חדשה מהקריאה) ---- */
/* התקבל עד: כותבים d,u,n (ו-mu:false אם היה true) בלי GET נוסף; 403 = שרת ישן, ממשיכים בלי */
function rdPut(g,uid){const fl={d:iv(Math.max(g.rd||0,g.rt||0,g.last?g.last.t:0)),u:iv(Date.now()),n:sv(fbBy().slice(0,100))};if(g.muw)fl.mu=bv(false);
 fsx('/grp/'+g.id+'/r/'+uid+'?'+Object.keys(fl).map(k=>'updateMask.fieldPaths='+k).join('&'),{method:'PATCH',body:JSON.stringify({fields:fl})}).then(()=>{g.rd=+fl.d.integerValue;g.muw=false}).catch(e=>{if(e&&e.code===403)GR.rdOff=1})}
async function grLoad(){
 if(GR.busy||!on())return;cBoot();GR.busy=1;GR.err='';const uid=SY.uid;let ch=0;
 try{
  let docs;
  if(fbAdmin())docs=(await fsx('/grp?pageSize=200')||{}).documents||[];
  else docs=await qrun('',{from:[{collectionId:'grp'}],where:{fieldFilter:{field:{fieldPath:'mem'},op:'ARRAY_CONTAINS',value:sv(uid)}},limit:100});
  const L=docs.map(gOf).filter(g=>idOk(g.id));
  await Promise.all(L.map(async g=>{
   try{const r=await fsx('/grp/'+g.id+'/r/'+uid),f=fvj({mapValue:r})||{};g.rt=+f.t||0;g.rd=+f.d||0;g.muw=f.mu===true}catch(e){if(e.code===403)throw e}
   if(!GR.rdOff&&g.mem.includes(uid)&&((g.last&&g.last.t>g.rd)||g.muw))rdPut(g,uid);
   const lt=g.last?g.last.t:g.t;
   if(g.last&&lt>g.rt){try{const q=await qrun('/grp/'+g.id,{from:[{collectionId:'m'}],select:{fields:[{fieldPath:'by'}]},where:tF('GREATER_THAN',g.rt),limit:CNTMAX});g.n=q.filter(d=>gv(d,'by')!==uid).length;g.np=q.length>=CNTMAX}catch(e){if(e.code===403)throw e}}}));
  L.sort((a,b)=>((b.last?b.last.t:b.t)-(a.last?a.last.t:a.t)));
  const sig=x=>(x||[]).map(g=>g.id+':'+g.n+':'+(g.last?g.last.t:0)+':'+g.name).join();ch=sig(L)!==sig(GR.L);GR.L=L;GR.off=0;recount();cPut('L',L.map(gLite))}
 catch(e){if(e&&e.code===403)GR.off=1;else GR.err=tkErr(e);ch=1}
 finally{GR.busy=0;GR.at=Date.now()}
 if(cur().v==='gr'||(ch&&['home','wk'].includes(cur().v)))rerender();else try{wbUp()}catch(e){}}
function grTick(){if(!on())return;cBoot();if(!GR.busy&&Date.now()-GR.at>60000)grLoad()}
/* רענון מיידי: התראה שהגיעה כשהאפליקציה פתוחה, חזרה לאפליקציה, חזרת הרשת. id = הקבוצה של ההתראה ('' = כל אחת) */
function grKick(id){if(!on()||document.hidden)return;cBoot();qFlush();const c=GR.c,v=cur();
 if(c&&v.v==='grc'&&v.a===c.gid&&(!id||id===c.gid))grPoll(c,0);
 if(!GR.busy&&Date.now()-GR.at>2000)grLoad()}
const grAvatar=n=>`<span class="gr-av" aria-hidden="true">${esc((String(n||'?').trim()[0]||'?'))}</span>`;
function rowH(g){const n=g.n,lt=g.last?g.last.t:0;
 return `<button class="li gr-row" data-a="grOpen" data-id="${esc(g.id)}">${grAvatar(g.name)}<div class="t"><b>${esc(g.name)}</b><span>${esc(lastTx(g))}</span></div><div class="m"><span>${esc(lTime(lt))}</span>${n?`<span class="gr-cnt">${g.np?(CNTMAX-1)+'+':n>99?'99+':n}</span>`:''}</div></button>`}
V.gr=()=>{
 if(!on())return{t:'קבוצות',s:'',h:'<div class="card"><p class="note">המסך הזה לא זמין.</p></div>'};
 cBoot();if(!GR.busy&&(GR.L===null||Date.now()-GR.at>3000))grLoad();
 const adm=fbAdmin(),top=`<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px"><span class="note" style="margin:0">${GR.L&&GR.L.length?GR.L.length+' קבוצות':''}</span>${adm?'<button class="chip on" data-a="grNew">＋ קבוצה חדשה</button>':''}</div>`;
 if(GR.off)return{t:'קבוצות',s:'',h:`${top}<div class="card"><p class="note" style="margin:0">הקבוצות יופעלו בקרוב.</p></div>`};
 if(GR.L===null)return{t:'קבוצות',s:'',h:`${top}<p class="note">${GR.err?esc(GR.err):'טוען…'}</p>`};
 return{t:'קבוצות',s:GR.n?GR.n+' הודעות שלא נקראו':'',h:`${top}${GR.L.length?GR.L.map(rowH).join(''):`<p class="note">${adm?'עוד אין קבוצות. אפשר ליצור קבוצה חדשה.':'אתה עוד לא חבר באף קבוצה.'}</p>`}${GR.err?`<p class="note">${esc(GR.err)}${GR.L.length?' – מוצג המידע השמור במכשיר':''}</p>`:''}<button class="btn g w" data-a="grRefresh" style="margin-top:8px">רענן</button>`}};
ACT.grRefresh=()=>{GR.at=0;grLoad();toast('מרענן...')};
const newC=(id,g)=>({gid:id,g,msgs:[],more:false,rt:0,rtSaved:0,dS:0,muw:0,rd:new Map(),rdOk:0,rdOff:0,ru:0,unr:'',ready:0,loading:1,started:0,draft:'',sending:'',gone:0,tm:0,rx:new Map(),xt:0,xoff:0,re:null,stale:0,fc:0,pt:0});
ACT.grOpen=el=>{const id=el.dataset.id;if(!idOk(id))return;const g=gGet(id);if(!g)return;GR.c=newC(id,g);go('grc',id)};
/* לחיצה על התראה (data.k='grp', data.id=gid): פותח את שיחת הקבוצה.
   24.11.2026: אם האפליקציה עוד עולה (אין משתמש / העסק לא נטען) – מחכים עד 30 שניות במקום לוותר בשקט;
   הקבוצה נפתחת מיד ממה שנשמר במכשיר (גם בלי רשת), והפרטים שלה מתעדכנים מהשרת ברקע */
async function grOpenId(id){id=String(id||'');if(!idOk(id))return;
 if(!on()){const t0=Date.now(),w=()=>{if(on())grOpenId(id);else if(Date.now()-t0<30000)setTimeout(w,500)};setTimeout(w,500);return}
 cBoot();const v=cur();if(v.v==='grc'&&v.a===id&&GR.c&&GR.c.gid===id){grKick(id);return}
 let g=gGet(id);
 if(!g){const cc=await cGet('c:'+id);if(cc&&cc.g&&cc.g.id===id)g=cc.g}
 if(!g){const L=await cGet('L');g=(Array.isArray(L)&&L.find(x=>x&&x.id===id))||null}
 if(g){const c=newC(id,g);GR.c=c;go('grc',id);
  fsx('/grp/'+id).then(d=>{const n=gOf(d);if(!n.id||GR.c!==c)return;const ch=n.name!==c.g.name||n.ao!==c.g.ao||n.md!==c.g.md;['name','mem','ao','md','last'].forEach(k=>{c.g[k]=n[k]});if(ch&&cur().v==='grc'&&cur().a===id)rerender()}).catch(e=>{if(e&&(e.code===403||e.code===404)&&GR.c===c){c.err='הקבוצה לא זמינה';c.msgs=[];c.ready=0;c.stale=0;clearTimeout(c.tm);grPaint()}});return}
 try{const g2=gOf(await fsx('/grp/'+id));if(!g2.id)throw 0;GR.c=newC(id,g2);go('grc',id)}
 catch(e){toast(e&&e.offline?'אין חיבור לאינטרנט':'הקבוצה לא זמינה')}}
window.GRP={n:()=>on()?GR.n:0,tick:grTick,off:()=>GR.off,open:grOpenId,kick:grKick,out:grOut};

/* ---- שיחה ---- */
const mineId=m=>m.by===SY.uid;
/* איש קשר: הודעת טקסט בתבנית קבועה (גרסאות ישנות רואות אותה כטקסט רגיל) */
const CTRX=/^👤 איש קשר: ([^\n]{1,60})\n📞 (\+?[\d\- ()]{5,25})$/;
const ctOf=m=>{if(m.k!=='t')return null;const x=CTRX.exec(String(m.txt||''));return x?{name:x[1].trim(),phone:x[2].trim()}:null};
const ctP=()=>{const C=window.Capacitor,P=C&&C.Plugins&&C.Plugins.LpContact;if(!P||!isNat()||(C.isPluginAvailable&&!C.isPluginAvailable('LpContact')))return null;return P};
const selOk=m=>!m.pend&&(m.k==='img'||(m.k==='vid'&&!m.gone&&Date.now()-m.t<=90*DAY));
function msgH(m,c){
 const me=mineId(m),ct=ctOf(m);let b='';
 if(ct){const I=`data-id="${esc(m.id)}"`;b=`<div class="gr-ct"><span class="gr-av">👤</span><div class="t"><b>${esc(ct.name)}</b><span dir="ltr">${esc(ct.phone)}</span></div></div><div class="gr-cta"><button data-a="grCall" ${I}>📞 התקשר</button><button data-a="grWa" ${I}>💬 וואטסאפ</button>${ctP()?`<button data-a="grCtSave" ${I}>➕ שמור</button>`:''}</div>`}
 if(m.k==='img'){const du=GR.img[c.gid+'/'+m.id];b=`<button class="gr-pic" data-a="grImg" data-id="${esc(m.id)}" aria-label="תמונה">${du?`<img src="${esc(du)}" alt="תמונה">`:`<span class="ph" data-gimg="${esc(m.id)}">${GR.img['x'+c.gid+'/'+m.id]?'התמונה לא נטענה. לחץ לנסות שוב':'טוען תמונה…'}</span>`}</button>`}
 else if(m.k==='vid'){const old=Date.now()-m.t>90*DAY;b=old||m.gone?`<div class="gr-pic" style="cursor:default"><span class="ph">🎬 הסרטון נמחק אחרי 90 יום</span></div>`:`<button class="gr-pic" data-a="grVid" data-id="${esc(m.id)}" aria-label="סרטון"><span class="ph" style="min-height:110px;background:var(--bg)"></span><span class="play">▶</span><span class="dr">${dur(m.vs)}</span></button>`}
 const q=m.re?`<button class="gr-q" data-a="grJump" data-id="${esc(m.re.mid)}"><b>${esc(nmP(m.re.byN))}</b><span>${esc(m.re.k==='img'?'📷 '+(m.re.txt||'תמונה'):m.re.k==='vid'?'🎬 '+(m.re.txt||'סרטון'):m.re.txt)}</span></button>`:'';
 const sc=c.sel?(c.sel.has(m.id)?' pk':selOk(m)?'':' no'):'';
 return `<div class="gr-b${me?' me':''}${sc}" data-mid="${esc(m.id)}"><button class="dl" data-a="grMenu" data-id="${esc(m.id)}" aria-label="אפשרויות הודעה">⋯</button>${me?'':`<div class="who">${esc(nm(m.by,m.byN))}</div>`}${m.fw?'<div class="gr-fw">↪ הועברה</div>':''}${q}${b}${m.txt&&!ct?`<div class="tx">${esc(m.txt)}</div>`:''}${rxH(m,c)}<div class="tm">${hm(m.t)}${tkH(c,m)}</div></div>`}
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
 const dis=c.sending?' disabled':'',re=c.re?`<div class="gr-rebar"><div class="gr-q"><b>↩ תשובה ל${esc(nmP(c.re.byN))}</b><span>${esc(c.re.k==='img'?'📷 '+(c.re.txt||'תמונה'):c.re.k==='vid'?'🎬 '+(c.re.txt||'סרטון'):c.re.txt)}</span></div><button class="gr-circ" data-a="grReX" aria-label="בטל תשובה" style="width:36px;height:36px">✕</button></div>`:'';
 return `${re}<div class="gr-comp"><button class="gr-circ" data-a="grAtt" aria-label="צרף"${dis}>📎</button><textarea id="grtx" data-i="grDraft" rows="1" maxlength="2000" placeholder="${DT.on?'מדברים… המילים נכתבות כאן':'כתוב הודעה…'}" aria-label="הודעה"${dis}${DT.on?' readonly':''}>${esc(c.draft)}</textarea>${isNat()?`<button class="gr-circ${DT.on?' rec':''}" data-a="grMic" aria-label="${DT.on?'עצור הקלטה':'הקלט והקלד'}"${dis}>${DT.on?'⏹':'🎤'}</button>`:''}<button class="gr-circ go" data-a="grSend" aria-label="שלח"${dis}>➤</button></div>${c.sending?`<p class="note" style="margin:6px 0 0">${esc(c.sending)}</p>`:DT.on?'<p class="note" style="margin:6px 0 0">🎤 מקליט – המילים נכתבות בתיבה. לחצו ⏹ לסיום, ואז אפשר לערוך ולשלוח.</p>':''}`}
function topH(c){const g=c.g;
 if(c.sel){const n=c.sel.size,d=n?'':' disabled';return `<div class="gr-selbar"><button class="gr-circ" data-a="grSelX" aria-label="סיום בחירה" style="width:38px;height:38px">✕</button><b>${n?'נבחרו '+n:'לחצו על תמונות וסרטונים לבחירה'}</b><button class="chip" data-a="grSelShare"${d}>📤 שיתוף</button><button class="chip" data-a="grSelGal"${d}>⬇ שמירה</button></div>`}
 const sb='<button class="chip" data-a="grSr" aria-label="חיפוש בקבוצה">🔍 חיפוש</button>';
 if(fbAdmin())return `<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:8px"><span class="note" style="margin:0">${g.mem.length} חברים${g.ao?' · רק המנהל שולח':''}</span><span style="display:flex;gap:6px">${sb}<button class="chip" data-a="grSet" data-id="${esc(g.id)}">⚙ הגדרות</button></span></div><div id="grpr" class="gr-pr">${prH(c)}</div>`;
 return `<div style="display:flex;justify-content:flex-end;margin-bottom:8px">${sb}</div><div id="grpr" class="gr-pr">${prH(c)}</div>`}
V.grc=gid=>{
 const c=GR.c;if(!on()||!c||c.gid!==gid)return{t:'קבוצה',s:'',h:'<div class="card"><p class="note">הקבוצה לא זמינה.</p></div>'};
 if(!c.started){c.started=1;grEnter(c)}
 if(c.sr)return{t:c.g.name,s:'חיפוש',h:srH(c)};
 return{t:c.g.name,s:'קבוצה',h:`<div id="grtop">${topH(c)}</div><div id="grnet"></div><div id="grpin">${pinH(c)}</div><div id="grmsgs">${msgsH(c)}</div><div id="grcomp">${compH(c)}</div>`}};
const atBottom=()=>window.innerHeight+window.scrollY>=document.documentElement.scrollHeight-160;
function grPaint(opt){const c=GR.c;if(!c||cur().v!=='grc'||cur().a!==c.gid)return;const m=$('#grmsgs');if(!m)return;
 const bot=atBottom(),h0=document.documentElement.scrollHeight;m.innerHTML=msgsH(c);
 if(opt==='keep')window.scrollBy(0,document.documentElement.scrollHeight-h0);else if(opt==='bottom'||bot)window.scrollTo(0,document.documentElement.scrollHeight);
 grImgs();cSaveC(c)}
function grFit(t){t=t||$('#grtx');if(!t)return;try{t.style.height='auto';t.style.height=(t.scrollHeight+(t.offsetHeight-t.clientHeight))+'px'}catch(e){}}
function grComp(){const c=GR.c;if(!c||cur().v!=='grc')return;const e=$('#grcomp');if(e){e.innerHTML=compH(c);grFit()}}
function grScrollInit(){grFit();const u=document.getElementById('grunr');if(u)u.scrollIntoView({block:'start'});else window.scrollTo(0,document.documentElement.scrollHeight)}
/* כניסה: קודם מה שנשמר במכשיר (מיד, גם בלי רשת), ואז מהשרת (grFresh). הודעות שממתינות לשליחה מוצגות עם 🕓 */
async function grEnter(c){
 const cc=await cGet('c:'+c.gid);if(GR.c!==c)return;
 if(cc&&Array.isArray(cc.msgs)&&cc.msgs.length&&!c.ready){
  c.msgs=cc.msgs.filter(m=>m&&idOk(String(m.id||''))).map(m=>Object.assign(mLite(m),{re:reOf(m.re)}));c.more=true;c.fc=1;
  c.rt=c.rtSaved=Math.max(+cc.rt||0,0);
  try{(cc.rd||[]).forEach(([u,x])=>{if(idOk(String(u))&&x)c.rd.set(u,{t:+x.t||0,d:+x.d||0,u:+x.u||0,n:String(x.n||'').slice(0,100)})});if(c.rd.size)c.rdOk=1}catch(e){}
  try{(cc.rx||[]).forEach(([mid,L])=>{const r=new Map();(L||[]).forEach(([u,x])=>{if(x)r.set(u,{e:EMO.includes(x.e)?x.e:'',byN:String(x.byN||'').slice(0,100),t:+x.t||0})});c.rx.set(mid,r)})}catch(e){}
  qMine(c);c.ready=1;c.loading=0;
  if(cur().v==='grc'&&cur().a===c.gid){const m=$('#grmsgs');if(m){m.innerHTML=msgsH(c);grScrollInit();grImgs()}}}
 grFresh(c)}
async function grFresh(c){
 let rt=0,dS=0,muw=false,d;
 try{
  try{const r=await fsx('/grp/'+c.gid+'/r/'+SY.uid),f=fvj({mapValue:r})||{};rt=+f.t||0;dS=+f.d||0;muw=f.mu===true}catch(e){if(e.code!==404)throw e}
  d=await qrun('/grp/'+c.gid,{from:[{collectionId:'m'}],orderBy:[{field:{fieldPath:'t'},direction:'DESCENDING'}],limit:PAGE})}
 catch(e){if(GR.c!==c)return;
  if(e&&e.code===403){c.err='אין הרשאה לקבוצה הזו';c.ready=0;c.msgs=[];c.stale=0;c.loading=0;if(cur().v==='grc')grPaint();return}
  /* בלי רשת / תקלה זמנית: נשארים עם מה שבמכשיר ומנסים שוב בעוד כמה שניות */
  c.stale=1;c.loading=0;if(!c.ready)c.err=tkErr(e);if(cur().v==='grc'){grPaint();grNet()}grPoll(c,6000);return}
 if(GR.c!==c)return;
 const was=c.ready,seen=new Set(c.msgs.map(m=>m.id));
 c.rt=rt;c.dS=dS;c.muw=muw;c.rtSaved=rt;c.stale=0;c.err='';grPinGet(c);
 const fr=d.map(mOf).filter(m=>idOk(m.id)).reverse();let ms=fr,more=d.length>=PAGE;
 /* מה שבמכשיר נשאר רק כשאין "חור" בינו לבין מה שהגיע עכשיו; קבוצה קטנה (פחות מ-PAGE) – השרת קובע הכול (גם הודעות שנמחקו) */
 if(more&&fr.length&&c.fc){const o=fr[0].t,ids=new Set(fr.map(m=>m.id));if(c.msgs.some(m=>!m.pend&&m.t>=o))ms=c.msgs.filter(m=>!m.pend&&m.t<o&&!ids.has(m.id)).concat(fr)}
 const pd=c.msgs.filter(m=>m.pend&&!ms.some(x=>x.id===m.id));c.msgs=ms.concat(pd);c.more=more;qMine(c);
 const f=c.msgs.find(m=>m.t>c.rt&&!mineId(m)&&!m.pend);c.unr=f?f.id:'';
 await grRxLoad(c,true);if(GR.c!==c)return;c.ready=1;c.loading=0;
 if(cur().v!=='grc'||cur().a!==c.gid)return;
 const m=$('#grmsgs');if(m){
  if(!was){m.innerHTML=msgsH(c);grScrollInit();grImgs()}
  else{const nw=c.unr&&!seen.has(c.unr);grPaint(nw?'':undefined);if(nw){const u=document.getElementById('grunr');if(u)u.scrollIntoView({block:'start'})}}}
 const t=$('#grtop');if(t)t.innerHTML=topH(c);grNet();
 grMark();grPoll(c);grRdLoad(c,true);grPres(c);grSact()}
/* שורת "אין חיבור" מעל ההודעות */
function grNet(){const c=GR.c;if(!c||cur().v!=='grc')return;const e=$('#grnet');if(e)e.innerHTML=c.stale&&c.ready?'<p class="note" style="margin:0 0 8px">📴 אין חיבור לשרת – מוצגות ההודעות השמורות במכשיר. מתעדכן אוטומטית כשהחיבור חוזר.</p>':''}
async function grPinGet(c){try{const d=await fsx('/grp/'+c.gid),p=pOf((fvj({mapValue:d})||{}).pin);if(GR.c!==c)return;if(JSON.stringify(p)!==JSON.stringify(c.g.pin||null)){c.g.pin=p;grPinPaint()}}catch(e){}}
/* סימון "נקרא עד" – הודעה אחרונה שנטענה (לא קודם ממה שכבר נשמר) */
function grMark(){const c=GR.c;if(!c||!c.ready||c.stale)return;const nt=c.msgs.reduce((a,m)=>m.pend?a:Math.max(a,m.t),c.rtSaved);if(nt<=c.rtSaved)return;c.rtSaved=nt;
 rWr(c,nt);
 const g=gGet(c.gid);if(g&&g!==c.g){g.rt=nt}c.g.rt=nt;c.g.n=0;c.g.np=false;recount();try{wbUp()}catch(e){}}
/* כותב t,d=max(d,t),u,n (ו-mu:false אם היה true) בבקשה אחת; 403 = שרת ישן ← t בלבד */
async function rWr(c,t){const p='/grp/'+c.gid+'/r/'+SY.uid,q=o=>'?'+Object.keys(o).map(k=>'updateMask.fieldPaths='+k).join('&');
 if(!GR.rdOff){const d=Math.max(c.dS||0,t),fl={t:iv(t),d:iv(d),u:iv(Date.now()),n:sv(fbBy().slice(0,100))};if(c.muw)fl.mu=bv(false);
  try{await fsx(p+q(fl),{method:'PATCH',body:JSON.stringify({fields:fl})});c.dS=d;c.muw=0;return}catch(e){if(!e||e.code!==403)return;GR.rdOff=1}}
 try{await fsx(p+'?updateMask.fieldPaths=t',{method:'PATCH',body:JSON.stringify({fields:{t:iv(t)}})})}catch(e){}}
/* ---- וי: רשימת r של הקבוצה (בכניסה), רענון בשאילתה u>maxU-130000 ---- */
const memOf=(c,m)=>{const sa=GR.sact;return(c.g.mem||[]).filter(u=>u!==m.by&&!(fbAdmin()&&sa&&sa[u]===false))};
function tkS(c,m){if(c.rdOff||!c.rdOk)return 1;const M=memOf(c,m);if(!M.length)return 1;let r=1,d=1;
 M.forEach(u=>{const x=c.rd.get(u),t=x?x.t:0,dd=x?Math.max(x.d,x.t):0;if(t<m.t)r=0;if(dd<m.t)d=0});return r?3:d?2:1}
function tkH(c,m){if(m.pend)return '<span class="gr-tk" aria-label="ממתין לשליחה" title="ממתין לשליחה">🕓</span>';if(!(mineId(m)||fbAdmin()))return '';const s=tkS(c,m);return `<button class="gr-tk s${s}" data-a="grInfo" data-id="${esc(m.id)}" aria-label="פרטי הודעה">${s>1?'✓✓':'✓'}</button>`}
const tkPend=c=>!c.rdOff&&c.msgs.some(m=>!m.pend&&(mineId(m)||fbAdmin())&&tkS(c,m)<3);
async function grRdLoad(c,full){if(c.rdOff)return;
 try{let d;
  if(full)d=((await fsx('/grp/'+c.gid+'/r?pageSize=300')||{}).documents)||[];
  else d=await qrun('/grp/'+c.gid,{from:[{collectionId:'r'}],where:{fieldFilter:{field:{fieldPath:'u'},op:'GREATER_THAN',value:iv(Math.max(0,c.ru-130000))}},limit:300});
  let ch=false;
  d.forEach(doc=>{const f=fvj({mapValue:doc})||{},id=idOf(doc);if(!idOk(id))return;const t=+f.t||0,dd=+f.d||0,u=+f.u||0,n=String(f.n||'').slice(0,100);if(u>c.ru)c.ru=u;
   const o=c.rd.get(id);if(o&&o.t===t&&o.d===dd)return;c.rd.set(id,{t,d:dd,u,n});ch=true});
  const first=!c.rdOk;c.rdOk=1;if((ch||first)&&GR.c===c&&cur().v==='grc'&&!c.sr)grPaint()}
 catch(e){if(e&&e.code===403){c.rdOff=1;if(GR.c===c&&cur().v==='grc'&&!c.sr)grPaint()}}}
/* רשימת עובדים פעילים (מנהל בלבד): עובד לא פעיל לא נספר בחישוב הוי */
async function grSact(){if(!fbAdmin()||GR.sact!==undefined)return;GR.sact=null;
 try{const j=await fsx('/staff?pageSize=300'),o={};((j&&j.documents)||[]).forEach(d=>{const f=fvj({mapValue:d})||{};o[idOf(d)]=f.active===true});GR.sact=o;const c=GR.c;if(c&&cur().v==='grc'&&!c.sr)grPaint()}catch(e){GR.sact=undefined}}
/* "פרטי הודעה": קראו / קיבלו / עוד לא */
ACT.grInfo=el=>{const c=GR.c;if(!c)return;const m=c.msgs.find(x=>x.id===el.dataset.id);if(!m||!(mineId(m)||fbAdmin()))return;closeDlg();
 if(c.rdOff||!c.rdOk)return dlg('<h3>פרטי הודעה</h3><p class="note">'+(c.rdOff?'פרטי הקריאה יהיו זמינים בקרוב.':'טוען…')+'</p><button class="btn g w" data-a="closeDlg">סגור</button>');
 const R=[],D=[],N=[];memOf(c,m).forEach(u=>{const x=c.rd.get(u),t=x?x.t:0,d=x?Math.max(x.d,x.t):0,n=nm(u,x&&x.n)||'חבר';(t>=m.t?R:d>=m.t?D:N).push(n)});
 const sec=(h,L)=>L.length?`<b>${h} (${L.length})</b><div class="card" style="padding:2px 12px;margin:4px 0 10px">${L.sort((a,b)=>a.localeCompare(b,'he')).map(n=>`<div class="gr-mem"><span>${esc(n)}</span></div>`).join('')}</div>`:'';
 dlg(`<h3>פרטי הודעה</h3>${sec('<span style="color:#3aa8ff">✓✓</span> קראו',R)}${sec('✓✓ קיבלו',D)}${sec('עוד לא',N)}${R.length+D.length+N.length?'':'<p class="note">אין חברים נוספים בקבוצה.</p>'}<button class="btn g w" data-a="closeDlg">סגור</button>`)};
/* ---- נוכחות בראש השיחה: pres/{uid}; 403 = מוסתרת ---- */
function prH(c){if(c.prOff||!c.pr)return '';const now=Date.now();
 return(c.g.mem||[]).filter(u=>u!==SY.uid).map(u=>{const x=c.pr[u],n=nm(u,x&&x.e)||(x&&x.n)||'חבר';
  const on=!!(x&&x.on&&now-x.t<300000),sub=on?'':x&&x.t?'נראה '+(dk(x.t)===dk(now)?'ב-'+hm(x.t):dk(x.t)===dk(now-DAY)?'אתמול':dLbl(x.t)):'';
  return `<span class="gr-pc"><i class="${on?'on':''}"></i>${esc(n)}${sub?`<small>${esc(sub)}</small>`:''}</span>`}).join('')}
async function grPres(c){if(c.prOff)return;
 try{const j=await fsx('/pres?pageSize=300'),o={};((j&&j.documents)||[]).forEach(d=>{const f=fvj({mapValue:d})||{};o[idOf(d)]={on:f.on===true,t:+f.t||0,n:String(f.n||'').slice(0,100),e:String(f.e||'').slice(0,100)}});c.pr=o}
 catch(e){if(e&&e.code===403)c.prOff=1;else return}
 if(GR.c===c&&cur().v==='grc'&&!c.sr){const e=$('#grpr');if(e)e.innerHTML=prH(c)}}
/* בשיחה פתוחה: הודעות חדשות כל POLL (3 שניות) כשהאפליקציה על המסך; ✓✓ כל 6 שניות (רק כשיש הודעה שעוד לא נקראה על ידי כולם),
   סימונים כל 12, הצמדה כל 30, נוכחות כל 60. ms=0 = עכשיו (התראה / חזרה לאפליקציה). השאילתה חוזרת 15 שניות אחורה (שעונים שונים בטלפונים) ומסננת כפולים */
function grPoll(c,ms){clearTimeout(c.tm);c.tm=setTimeout(async()=>{
 if(GR.c!==c||cur().v!=='grc'||cur().a!==c.gid)return;
 if(document.hidden||c.pb){grPoll(c);return}
 if(c.stale){c.pb=1;try{await grFresh(c)}finally{c.pb=0}return}
 c.pb=1;
 try{c.pt=(c.pt||0)+1;if(c.pt%10===0)grPinGet(c);if(c.pt%2===0&&tkPend(c))grRdLoad(c,false);if(c.pt%20===0)grPres(c);if(c.pt%4===0&&await grRxLoad(c,false)&&GR.c===c)grPaint();
  qFlush();
  const nw=c.msgs.reduce((a,m)=>m.pend?a:Math.max(a,m.t),0),d=await qrun('/grp/'+c.gid,{from:[{collectionId:'m'}],where:tF('GREATER_THAN',Math.max(0,nw-15000)),orderBy:[{field:{fieldPath:'t'},direction:'ASCENDING'}],limit:PAGE});
  if(GR.c===c){let ch=false;
   d.map(mOf).filter(m=>idOk(m.id)).forEach(m=>{const o=c.msgs.find(x=>x.id===m.id);if(!o){c.msgs.push(m);ch=true}else if(o.pend){Object.assign(o,m,{pend:0});ch=true}});
   if(ch){c.msgs.sort((x,y)=>(x.pend?1:0)-(y.pend?1:0)||x.t-y.t);grPaint();grMark()}}}
 catch(e){}finally{c.pb=0}
 grPoll(c)},ms===undefined?POLL:ms)}
/* ---- תור שליחה (טקסט): ההודעה מופיעה מיד עם 🕓, נשלחת ברקע; בלי רשת – נשארת בתור (גם במכשיר) ונשלחת כשהרשת חוזרת.
   אותו מזהה הודעה בכל ניסיון (documentId), ולכן "כבר קיים" (409) = נשלחה. t נקבע בכל ניסיון מחדש (החוקים דורשים זמן אמת ±2 דקות) ---- */
const qSave=()=>cPut('q',GR.q.map(x=>({gid:x.gid,mid:x.mid,txt:x.txt,re:x.re||null,t:x.t})));
function qMine(c){GR.q.filter(x=>x.gid===c.gid&&!c.msgs.some(m=>m.id===x.mid)).forEach(x=>c.msgs.push({id:x.mid,by:SY.uid,byN:fbBy(),t:x.t,k:'t',txt:x.txt,vp:'',vs:0,vb:0,re:reOf(x.re),fw:false,pend:1}))}
const netErr=e=>!e||e.offline||!e.code||e.code===429||e.code>=500;
function qFlush(){if(!on()||!GR.q.length)return;GR.q.forEach(x=>{if(!x.busy)qSend(x)})}
async function qSend(x){x.busy=1;let ok=false,bad=null;const t=Date.now();
 try{const f={by:sv(SY.uid),byN:sv(fbBy().slice(0,100)),t:iv(t),k:sv('t'),txt:sv(x.txt)},re=reOf(x.re);
  if(re)f.re={mapValue:{fields:{mid:sv(re.mid),txt:sv(cut120(re.txt)),byN:sv(String(re.byN||'').slice(0,100)),k:sv(re.k)}}};
  await fsx('/grp/'+x.gid+'/m?documentId='+encodeURIComponent(x.mid),{method:'POST',body:JSON.stringify({fields:f})});ok=true}
 catch(e){if(e&&e.code===409)ok=true;else if(!netErr(e))bad=e}
 x.busy=0;if(!ok&&!bad)return;
 GR.q=GR.q.filter(y=>y!==x);qSave();
 const c=GR.c;if(!c||c.gid!==x.gid)return;const m=c.msgs.find(y=>y.id===x.mid);if(!m)return;
 if(ok){if(m.pend){m.pend=0;m.t=Math.max(t,m.t)}grPaint();grMark();return}
 /* נדחה בשרת (למשל אין הרשאה): ההודעה יורדת מהמסך והטקסט חוזר לתיבה */
 c.msgs=c.msgs.filter(y=>y!==m);if(!String(c.draft||'').trim()){c.draft=x.txt;grComp()}grPaint();toast('ההודעה לא נשלחה: '+tkErr(bad))}
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
 try{let du=await cGet('i:'+k);if(!imgOk(du)){const d=await fsx('/grp/'+gid+'/m/'+mid+'/p/1');du=gv(d,'img');if(!imgOk(du))throw 0;imPut(k,du)}GR.img[k]=du;delete GR.img['x'+k]}catch(e){GR.img['x'+k]=1}
 finally{delete imgBusy[k]}
 if(GR.c&&GR.c.gid===gid){grPaint();srPaint()}}
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
INP.grDraft=el=>{if(GR.c)GR.c.draft=el.value;grFit(el)};
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
ACT.grSend=async()=>{const c=GR.c;if(!c||c.sending||!c.ready)return;dtFlush();const tx=$('#grtx'),txt=String((tx?tx.value:c.draft)||'').trim().slice(0,2000);if(!txt)return;
 if(!fbAdmin()&&c.g.ao)return toast('רק המנהל יכול לשלוח הודעות בקבוצה הזו');
 const re=c.re?{mid:c.re.mid,txt:cut120(c.re.txt),byN:String(c.re.byN||'').slice(0,100),k:c.re.k}:null,x={gid:c.gid,mid:newMid(),txt,re,t:Date.now()};
 GR.q.push(x);qSave();c.msgs.push({id:x.mid,by:SY.uid,byN:fbBy(),t:x.t,k:'t',txt,vp:'',vs:0,vb:0,re:reOf(re),fw:false,pend:1});
 c.draft='';if(tx)tx.value='';c.re=null;grComp();grPaint('bottom');qSend(x)};
/* 📎: תמונות וסרטונים (כמה בבת אחת, עד FMAX) – רק כשמדיה מותרת בקבוצה; איש קשר – תמיד (נשלח כטקסט) */
const FMAX=30;
ACT.grAtt=()=>{const c=GR.c;if(!c||c.sending||!canSend(c.g))return;dtFlush();const tx=$('#grtx');if(tx)c.draft=tx.value;
 dlg(`<h3>צירוף</h3>${c.g.md?`<label class="btn g w" style="margin-bottom:8px">🖼 תמונות וסרטונים<input type="file" accept="image/*,video/*" multiple data-c="grFile" hidden></label><p class="note" style="margin:-2px 0 10px">אפשר לבחור כמה ביחד (עד ${FMAX}). כל אחת נשלחת כהודעה נפרדת.</p>`:''}<button class="btn g w" data-a="grCt" style="margin-bottom:8px">👤 איש קשר</button><button class="btn g w" data-a="closeDlg">ביטול</button>`)};
const isVid=f=>/^video\//.test(f.type||'')||/\.(mp4|webm|3gp|mov)$/i.test(f.name||'');
/* תמונה אחת: מכווצים, שולחים את ההודעה ואז את התמונה. מחזיר '' או אזהרה (ההודעה נשלחה אבל התמונה לא עלתה) */
async function grImgUp(c,f,cap,x,st){
 if(f.type&&!/^image\//.test(f.type))throw new Error('אפשר לשלוח תמונה או סרטון בלבד');
 st('מכין את התמונה…');let du;try{du=await fbShrink(await rdU(f));if(du.length>880000||!imgOk(du))throw 0}catch(e){throw new Error('תמונה לא תקינה או גדולה מדי')}
 st('שולח…');let m;try{m=await grPost(c,'img',cap,x)}catch(e){throw new Error(tkErr(e))}GR.img[c.gid+'/'+m.id]=du;imPut(c.gid+'/'+m.id,du);
 try{await fsx('/grp/'+c.gid+'/m/'+m.id+'/p/1',{method:'PATCH',body:JSON.stringify({fields:{img:sv(du),t:iv(Date.now()),uid:sv(SY.uid)}})});return ''}catch(e2){return 'ההודעה נשלחה, אבל התמונה לא עלתה. '+tkErr(e2)}}
CHG.grFile=async el=>{let fs=[...(el.files||[])];el.value='';closeDlg();const c=GR.c;if(!fs.length||!c||c.sending||!c.g.md)return;dtFlush();
 const tx=$('#grtx');if(tx)c.draft=tx.value;
 if(fs.length>FMAX){toast('אפשר עד '+FMAX+' בבת אחת. נשלחות '+FMAX+' הראשונות.');fs=fs.slice(0,FMAX)}
 const n=fs.length;let ok=0,cap=String(c.draft||'').trim().slice(0,2000),re=c.re;const bad=[],warn=[];
 for(let i=0;i<n;i++){const f=fs[i],st=t=>{c.sending=n>1?'('+(i+1)+' מתוך '+n+') '+t:t;grComp()};
  /* הכיתוב והתשובה הולכים עם ההודעה הראשונה שנשלחת בהצלחה */
  const x=re?{re}:null;
  try{if(isVid(f))await grVidUp(c,f,cap,x,st);else{const w=await grImgUp(c,f,cap,x,st);if(w)warn.push(w)}
   ok++;if(cap||re){cap='';re=null;c.draft='';c.re=null}if(n>1)grPaint('bottom')}
  catch(e){bad.push((e&&e.message)||'השליחה נכשלה')}}
 sendDone(c);
 if(n===1){if(bad.length)toast(bad[0]);else if(warn.length)toast(warn[0]);return}
 if(!bad.length&&!warn.length)toast('✓ נשלחו '+n);
 else toast('נשלחו '+ok+' מתוך '+n+'.'+(bad.length?' '+bad.length+' לא נשלחו: '+bad[0]:' '+warn[0]))};
/* משך הסרטון נמדד ב-<video> מקומי לפני ההעלאה */
async function vidProbe(f){const url=URL.createObjectURL(f),v=document.createElement('video');v.preload='metadata';v.muted=true;v.playsInline=true;
 try{const d0=await new Promise((ok,no)=>{const bad=()=>no(new Error('לא הצלחנו לקרוא את הסרטון. נסו סרטון אחר.')),t=setTimeout(bad,10000);v.onloadedmetadata=()=>{clearTimeout(t);ok(v.duration)};v.onerror=()=>{clearTimeout(t);bad()};v.src=url});
  let d=d0;if(d===Infinity){await new Promise(ok=>{const t=setTimeout(ok,4000);v.ondurationchange=()=>{if(Number.isFinite(v.duration)){clearTimeout(t);ok()}};v.currentTime=1e101});d=v.duration}
  if(!Number.isFinite(d)||d<=0)throw new Error('לא הצלחנו לקרוא את אורך הסרטון. נסו סרטון אחר.');return d}
 finally{URL.revokeObjectURL(url);try{v.removeAttribute('src');v.load()}catch(e){}}}
async function grVidUp(c,f,cap,x,st){
 const EXT={'video/mp4':1,'video/webm':1,'video/3gpp':1};let type=String(f.type||'').split(';')[0];
 if(!type){const e=(/\.(\w+)$/.exec(f.name||'')||[])[1];type=e==='mp4'?'video/mp4':e==='webm'?'video/webm':e==='3gp'?'video/3gpp':''}
 if(!EXT[type])throw new Error('פורמט הסרטון לא נתמך. אפשר MP4, WebM או 3GP.');
 if(f.size>VMAX)throw new Error('הסרטון גדול מדי (מעל 30MB). אפשר סרטון עד דקה ועד 30MB.');
 st('בודק את הסרטון…');const d=await vidProbe(f);
 if(d>VSEC+0.5)throw new Error('הסרטון ארוך מדי ('+Math.round(d)+' שניות). אפשר עד דקה.');
 st('מעלה את הסרטון…');
 const mid=newMid(),name=(bzB()?'b/'+SY.bizId+'/':'')+'grpv/'+c.gid+'/'+mid;
 try{const t=await tok();let r;
  try{r=await fetch(STB()+'?uploadType=media&name='+encodeURIComponent(name),{method:'POST',headers:{Authorization:'Firebase '+t,'Content-Type':type},body:f})}catch(e){throw Object.assign(new Error('אין חיבור לאינטרנט'),{offline:true})}
  if(!r.ok)throw Object.assign(new Error(r.status===403?'אין הרשאה להעלות סרטון בקבוצה הזו':'העלאת הסרטון נכשלה ('+r.status+')'),{code:r.status});
  st('שולח…');
  await grPost(c,'vid',cap,Object.assign({mid,vp:name,vs:Math.min(VSEC,Math.max(1,Math.ceil(d))),vb:f.size},x||{}))}
 catch(e){throw new Error(e&&e.code===403&&e.message?e.message:e&&e.offline?e.message:e&&e.code?tkErr(e):(e&&e.message)||'השליחה נכשלה')}}
/* ⋯ של הודעה (כולם): סימון, תשובה, שיתוף, העברה, שמירה בגלריה; מנהל: גם הצמדה ומחיקה */
ACT.grMenu=el=>{const c=GR.c;if(!c)return;const id=el.dataset.id,m=c.msgs.find(x=>x.id===id);if(!m)return;if(m.pend)return toast('🕓 ההודעה עוד לא נשלחה. היא תישלח מיד כשיהיה חיבור');const adm=fbAdmin(),pd=c.g.pin&&c.g.pin.mid===id;
 const r=c.rx&&c.rx.get(id),mine=r&&r.get(SY.uid)?r.get(SY.uid).e:'',I=`data-id="${esc(id)}"`,B=(a,t,cl)=>`<button class="btn ${cl||'g'} w" data-a="${a}" ${I} style="margin-bottom:8px">${t}</button>`;
 const media=m.k==='img'||(m.k==='vid'&&!m.gone&&Date.now()-m.t<=90*DAY);
 dlg(`<h3>אפשרויות הודעה</h3>${c.xoff?'':`<div class="gr-emo">${EMO.map(e=>`<button class="${e===mine?'on':''}" data-a="grReact" ${I} data-e="${e}" aria-label="סמן ${e}">${e}</button>`).join('')}</div>`}`
  +(canSend(c.g)?B('grRe','↩ השב'):'')+(mineId(m)||adm?B('grInfo','ℹ פרטי הודעה'):'')+B('grShare','📤 שיתוף')+(media?B('grSelOn','☑ בחירת כמה תמונות וסרטונים'):'')+B('grFwd','↪ העבר לקבוצה אחרת')+(media?B('grGal',m.k==='img'?'⬇ שמור תמונה בגלריה':'⬇ שמור סרטון בגלריה'):'')
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
 dlg(`<h3>סימונים</h3><div class="card" style="padding:2px 12px;margin-bottom:10px">${L.map(([u,x])=>`<div class="gr-mem"><span style="font-size:1.3rem">${esc(x.e)}</span><span>${u===SY.uid?'אני':esc(nm(u,x.byN))}</span></div>`).join('')}</div>${mine&&mine.e?`<button class="btn g w" data-a="grReact" data-id="${esc(id)}" data-e="${esc(mine.e)}" style="margin-bottom:8px">הסר את הסימון שלי</button>`:''}<button class="btn g w" data-a="closeDlg">סגור</button>`)};

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
async function galSave(o,q){const C=window.Capacitor,T=t=>{if(!q)toast(t)};if(!isNat()){await saveFile(o.name,o.b,o.mime);return ''}
 const data=u8b64(new Uint8Array(await o.b.arrayBuffer())),P=C.Plugins.SaveFile;
 if(P&&typeof P.gallery==='function'){try{await P.gallery({filename:o.name,mime:o.mime,data});T('✓ נשמר בגלריה');return ''}
  catch(e){const s=String(e&&(e.message||e));if(!/not implemented|unimplemented|old_android/i.test(s)){T('השמירה נכשלה: '+s);return 'השמירה נכשלה: '+s}}}
 if(P){try{await P.save({filename:o.name,mime:o.mime,data});T('✓ נשמר במכשיר');return ''}catch(e){const s=String(e&&(e.message||e)),t=/cancel/i.test(s)?'השמירה בוטלה':'השמירה נכשלה: '+s;T(t);return t}}
 await saveFile(o.name,o.b,o.mime);return ''}
ACT.grGal=async el=>{const c=GR.c;if(!c)return;closeDlg();const m=c.msgs.find(x=>x.id===el.dataset.id);if(!m||m.k==='t')return;
 try{toast(m.k==='vid'?'מוריד את הסרטון…':'שומר…');await galSave(await mFile(c,m))}
 catch(e){if(m.gone)grPaint();toast(e&&e.message?e.message:'השמירה נכשלה')}};

/* ---- בחירה של כמה תמונות וסרטונים: שיתוף ביחד / שמירה ביחד בגלריה (עד FMAX) ---- */
const selPaint=()=>{const c=GR.c;if(!c||cur().v!=='grc')return;const t=$('#grtop');if(t)t.innerHTML=topH(c)};
ACT.grSelOn=el=>{const c=GR.c;if(!c)return;closeDlg();const m=c.msgs.find(x=>x.id===el.dataset.id);c.sel=new Set(m&&selOk(m)?[m.id]:[]);selPaint();grPaint('keep')};
ACT.grSelX=()=>{const c=GR.c;if(!c)return;c.sel=null;selPaint();grPaint('keep')};
function selTap(b){const c=GR.c,id=b.dataset.mid,m=c&&c.msgs.find(x=>x.id===id);if(!m)return;
 if(!selOk(m))return toast('אפשר לבחור רק תמונות וסרטונים');
 if(c.sel.has(id))c.sel.delete(id);else{if(c.sel.size>=FMAX)return toast('אפשר לבחור עד '+FMAX);c.sel.add(id)}
 b.classList.toggle('pk',c.sel.has(id));selPaint()}
/* הקבצים לפי סדר ההודעות; שם ייחודי לכל קובץ */
async function selFiles(c,what){const L=c.msgs.filter(m=>c.sel.has(m.id)),out=[],bad=[];let sz=0;
 for(let i=0;i<L.length;i++){toast(what+' '+(i+1)+' מתוך '+L.length+'…');
  try{const o=await mFile(c,L[i]);o.name=o.name.replace(/(\.\w+)$/,'_'+(i+1)+'$1');sz+=o.b.size;if(sz>150*1024*1024){bad.push('גדול מדי ביחד – בחרו פחות סרטונים');break}out.push(o)}
  catch(e){bad.push((e&&e.message)||'לא נטען')}}
 if(L.some(m=>m.gone))grPaint('keep');return{out,bad,n:L.length}}
ACT.grSelShare=async()=>{const c=GR.c;if(!c||!c.sel||!c.sel.size||c.selBusy)return;c.selBusy=1;
 try{const{out,bad,n}=await selFiles(c,'מכין לשיתוף');if(!out.length)return toast(bad[0]||'השיתוף נכשל');
  const C=window.Capacitor;
  if(isNat()&&C.Plugins.Filesystem&&C.Plugins.Share){const uris=[];for(const o of out){const r=await C.Plugins.Filesystem.writeFile({path:o.name,data:u8b64(new Uint8Array(await o.b.arrayBuffer())),directory:'CACHE'});uris.push(r.uri)}
   try{await C.Plugins.Share.share({files:uris,dialogTitle:'שיתוף'})}catch(e){if(/cancel/i.test(String(e&&e.message)))return;throw e}}
  else{const fs=typeof File==='function'?out.map(o=>new File([o.b],o.name,{type:o.mime})):[];
   if(fs.length&&navigator.canShare&&navigator.share&&navigator.canShare({files:fs})){try{await navigator.share({files:fs})}catch(e){if(e&&e.name==='AbortError')return;throw e}}
   else for(const o of out)await saveFile(o.name,o.b,o.mime)}
  if(bad.length)toast('שותפו '+out.length+' מתוך '+n+'. '+bad[0]);c.sel=null;selPaint();grPaint('keep')}
 catch(e){toast(e&&e.message?'השיתוף נכשל: '+e.message:'השיתוף נכשל')}
 finally{c.selBusy=0}};
ACT.grSelGal=async()=>{const c=GR.c;if(!c||!c.sel||!c.sel.size||c.selBusy)return;c.selBusy=1;
 try{const{out,bad,n}=await selFiles(c,'מוריד');let ok=0;
  for(const o of out){const e=await galSave(o,1);if(e)bad.push(e);else ok++}
  toast(ok===n?'✓ נשמרו '+n+' בגלריה':'נשמרו '+ok+' מתוך '+n+(bad.length?'. '+bad[0]:''));if(ok){c.sel=null;selPaint();grPaint('keep')}}
 catch(e){toast(e&&e.message?e.message:'השמירה נכשלה')}
 finally{c.selBusy=0}};

/* ---- איש קשר: בחירה מאנשי הקשר בטלפון (תוסף LpContact, בלי הרשאה), או הקלדה ידנית (APK ישן / דפדפן) ---- */
const ctNum=p=>{p=String(p||'').trim();const plus=p[0]==='+',d=p.replace(/\D/g,'');return d.length>=5&&d.length<=15?(plus?'+':'')+d:''};
function ctForm(name,phone,note){dlg(`<h3>👤 שליחת איש קשר</h3>${note?`<p class="note">${esc(note)}</p>`:''}<label class="f"><span>שם</span><input id="grctn" maxlength="60" value="${esc(name||'')}" autocomplete="off"></label><label class="f"><span>מספר טלפון</span><input id="grctp" type="tel" dir="ltr" maxlength="25" value="${esc(phone||'')}" autocomplete="off"></label><button class="btn w" data-a="grCtSend" style="margin:10px 0 8px">שלח</button><button class="btn g w" data-a="closeDlg">ביטול</button>`)}
ACT.grCt=async()=>{const c=GR.c;if(!c||c.sending||!canSend(c.g))return;closeDlg();const P=ctP();
 if(!P)return ctForm('','',isNat()?'בחירה מאנשי הקשר תעבוד אחרי עדכון האפליקציה. בינתיים אפשר להקליד.':'');
 try{const r=await P.pick();ctForm(String(r&&r.name||'').slice(0,60),String(r&&r.phone||'').slice(0,25))}
 catch(e){if(!/cancel/i.test(String(e&&(e.message||e))))ctForm('','','לא הצלחנו לפתוח את אנשי הקשר. אפשר להקליד.')}};
ACT.grCtSend=async()=>{const c=GR.c;if(!c||c.sending||!canSend(c.g))return;
 const ph=String(($('#grctp')||{}).value||'').trim(),num=ctNum(ph);if(!num)return toast('מספר הטלפון לא תקין');
 const name=(String(($('#grctn')||{}).value||'').replace(/\s+/g,' ').trim()||num).slice(0,60),txt='👤 איש קשר: '+name+'\n📞 '+ph.replace(/[^\d+\- ()]/g,'').slice(0,25);
 if(!CTRX.test(txt))return toast('מספר הטלפון לא תקין');closeDlg();c.sending='שולח…';grComp();
 try{await grPost(c,'t',txt,reX(c));sendDone(c)}catch(e){sendErr(c,e)}};
const ctMsg=el=>{const c=GR.c,m=c&&c.msgs.find(x=>x.id===el.dataset.id);return m?ctOf(m):null};
ACT.grCall=el=>{const ct=ctMsg(el),n=ct&&ctNum(ct.phone);if(n)window.open('tel:'+n,'_system')};
/* וואטסאפ: מספר שמתחיל ב-0 נחשב ישראלי (972) */
ACT.grWa=el=>{const ct=ctMsg(el);let n=ct&&ctNum(ct.phone);if(!n)return;n=n[0]==='+'?n.slice(1):n[0]==='0'?'972'+n.slice(1):n;window.open('https://wa.me/'+n,'_system')};
ACT.grCtSave=async el=>{const ct=ctMsg(el),P=ctP();if(!ct||!P)return;try{await P.save({name:ct.name,phone:ctNum(ct.phone)})}catch(e){toast('לא נמצאה אפליקציית אנשי קשר')}};

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

/* ---- הכתבה קולית (19.11): זיהוי הדיבור של הטלפון (תוסף LpSpeech, כמו במזכירה – בלי שרת ובלי עלות).
   המילים נכתבות בתיבה תוך כדי דיבור; בזמן ההקלטה התיבה לקריאה בלבד. אחרי "עצור" עורכים ושולחים בלחיצה (לא נשלח לבד).
   לא נשמרת הקלטה – רק הטקסט. עד 3 דקות להקלטה אחת. ---- */
const DT={on:0,P:null,hs:[],base:'',fin:'',par:'',tm:0,st:0,t0:0,gid:'',stp:0};
const DTE={perm:'אין הרשאה למיקרופון. אפשרו לאפליקציה גישה למיקרופון בהגדרות הטלפון ונסו שוב.',net:'זיהוי הדיבור צריך חיבור לאינטרנט. בדקו את החיבור ונסו שוב, או הקלידו.',lang:'זיהוי דיבור בעברית לא זמין בטלפון הזה. אפשר להקליד.',audio:'המיקרופון תפוס או לא זמין.',silence:'לא שמעתי דיבור. נסו שוב.',fail:'זיהוי הדיבור נעצר. אפשר להמשיך להקליד או להקליט שוב.'};
async function spP(){const C=window.Capacitor,P=C&&C.Plugins&&C.Plugins.LpSpeech;if(!P||!isNat()||(C.isPluginAvailable&&!C.isPluginAvailable('LpSpeech')))return null;
 try{const r=await P.available();return r&&r.ok?P:null}catch(e){return null}}
const dtTxt=()=>[DT.base,DT.fin,DT.par].map(x=>String(x||'').trim()).filter(Boolean).join(' ').slice(0,2000);
function dtShow(){const c=GR.c;if(!DT.on||!c||c.gid!==DT.gid)return;const v=dtTxt();c.draft=v;const t=$('#grtx');if(t){t.readOnly=true;if(t.value!==v)t.value=v;grFit(t);try{t.scrollTop=t.scrollHeight}catch(e){}}}
function dtOff(){clearInterval(DT.tm);clearTimeout(DT.st);const hs=DT.hs||[];DT.hs=[];hs.forEach(h=>{try{h&&h.remove&&h.remove()}catch(e){}});Object.assign(DT,{on:0,P:null,stp:0})}
function dtEnd(code){if(!DT.on)return;const v=dtTxt(),got=v.trim()!==String(DT.base||'').trim(),gid=DT.gid;dtOff();const c=GR.c;
 if(c&&c.gid===gid){c.draft=v;grComp();const t=$('#grtx');if(t){t.focus();try{t.setSelectionRange(v.length,v.length)}catch(e){}}}
 if(code&&code!=='pause'&&(code!=='silence'||!got))toast(DTE[code]||DTE.fail);else if(got)toast('אפשר לערוך את הטקסט ואז לשלוח')}
function dtStop(){if(!DT.on||DT.stp)return;DT.stp=1;const P=DT.P;try{P.stop().catch(()=>dtEnd(''))}catch(e){dtEnd('')}DT.st=setTimeout(()=>dtEnd(''),4000)}
/* שליחה או יציאה באמצע הקלטה: עוצרים מיד ושומרים את מה שנכתב */
function dtFlush(){if(!DT.on)return;const v=dtTxt(),gid=DT.gid;try{DT.P&&DT.P.cancel().catch(()=>{})}catch(e){}dtOff();const c=GR.c;if(c&&c.gid===gid){c.draft=v;const t=$('#grtx');if(t){t.readOnly=false;t.value=v;grFit(t)}}}
ACT.grMic=async()=>{const c=GR.c;if(!c||c.sending)return;if(DT.on)return dtStop();
 const P=await spP();if(!P)return toast('הקלטה עם הקלדה אוטומטית זמינה בטלפון עם הגרסה המעודכנת של האפליקציה. אפשר להקליד.');
 if(GR.c!==c||DT.on)return;const t=$('#grtx');
 Object.assign(DT,{on:1,P,base:t?t.value:c.draft,fin:'',par:'',stp:0,gid:c.gid,t0:Date.now()});
 const on=(n,fn)=>P.addListener(n,e=>{if(DT.on&&DT.P===P)fn(e||{})});
 try{DT.hs=await Promise.all([on('partial',e=>{DT.par=String(e.text||'');dtShow()}),on('final',e=>{const x=String(e.text||'').trim();if(x)DT.fin=(DT.fin?DT.fin+' ':'')+x;DT.par='';dtShow()}),on('end',e=>dtEnd(String(e.code||'')))]);
  grComp();dtShow();await P.start({lang:'he-IL'})}
 catch(e){const code=e&&e.code;dtOff();grComp();return toast(code==='perm'?DTE.perm:code==='na'?'אין זיהוי דיבור בטלפון הזה. אפשר להקליד.':DTE.fail)}
 DT.tm=setInterval(()=>{if(!DT.on)return;if(!GR.c||GR.c.gid!==DT.gid||cur().v!=='grc'||GR.c.sr){dtFlush();return}if(!DT.stp&&Date.now()-DT.t0>180000){toast('ההקלטה נעצרה אחרי 3 דקות');dtStop()}},500)};

/* ---- חיפוש בקבוצה (19.11): מילים, לפי שולח, לפי סוג (טקסט / תמונות / סרטונים). החיפוש רץ על ההודעות שנטענו במכשיר
   (בלי עלות שרת); "חפש גם בהודעות ישנות" טוען עוד עמודים (עד 250 בכל לחיצה). ---- */
const nrm=s=>String(s||'').toLowerCase().replace(/[֑-ׇ]/g,'');
function srRes(c){const s=c.sr,q=nrm(s.q).trim();
 return c.msgs.filter(m=>(!s.by||m.by===s.by)&&(!s.k||m.k===s.k)&&(!q||nrm(m.txt).includes(q))).slice().reverse()}
function hlTx(t,q){t=String(t||'');q=String(q||'').trim();const n=nrm(t),k=nrm(q);
 /* nrm שומר על האורך רק כשאין ניקוד; עם ניקוד – בלי הדגשה, רק קטע מההתחלה */
 if(!k||n.length!==t.length){return esc(t.slice(0,140))}
 const i=n.indexOf(k);if(i<0)return esc(t.slice(0,140));const a=Math.max(0,i-40);
 return (a?'…':'')+esc(t.slice(a,i))+'<mark>'+esc(t.slice(i,i+k.length))+'</mark>'+esc(t.slice(i+k.length,i+k.length+80))}
function srRowH(m,c){const s=c.sr,du=m.k==='img'?GR.img[c.gid+'/'+m.id]:'';
 const ic=m.k==='img'?(du?`<img src="${esc(du)}" alt="" class="gr-sth">`:`<span class="gr-sth" data-simg="${esc(m.id)}">📷</span>`):m.k==='vid'?'<span class="gr-sth">🎬</span>':'';
 const tx=m.txt?hlTx(m.txt,s.q):(m.k==='img'?'תמונה':m.k==='vid'?'סרטון ('+dur(m.vs)+')':'');
 return `<button class="li gr-sr" data-a="grSrGo" data-id="${esc(m.id)}">${ic}<div class="t"><b>${mineId(m)?'אני':esc(nm(m.by,m.byN))}</b><span>${tx}</span></div><div class="m"><span>${esc(dLbl(m.t))}</span><span>${hm(m.t)}</span></div></button>`}
function srListH(c){const L=srRes(c),s=c.sr,any=s.q.trim()||s.by||s.k;
 const more=c.more?`<button class="btn g w" data-a="grSrMore" style="margin-top:8px"${c.loading?' disabled':''}>${c.loading?'טוען…':'חפש גם בהודעות ישנות יותר'}</button>`:'';
 if(!any)return `<p class="note">כתבו מילה לחיפוש, או בחרו שולח או סוג.</p>`;
 return `<p class="note" style="margin:0 0 6px">${L.length?L.length+' תוצאות':'לא נמצאו הודעות'}${c.more?' (בהודעות שנטענו)':''}</p>${L.slice(0,200).map(m=>srRowH(m,c)).join('')}${L.length>200?'<p class="note">מוצגות 200 התוצאות החדשות. אפשר לצמצם את החיפוש.</p>':''}${more}`}
function srH(c){const s=c.sr,who=new Map();c.msgs.forEach(m=>{if(!who.has(m.by))who.set(m.by,mineId(m)?'אני':(nm(m.by,m.byN)||'ללא שם'))});
 const ws=[...who.entries()].sort((a,b)=>a[1].localeCompare(b[1],'he')),K=[['','הכול'],['t','טקסט'],['img','📷 תמונות'],['vid','🎬 סרטונים']];
 return `<div class="gr-srbar"><input id="grsq" data-i="grSq" type="search" maxlength="60" placeholder="חיפוש בקבוצה…" aria-label="חיפוש" value="${esc(s.q)}" autocomplete="off" enterkeyhint="search"><button class="chip" data-a="grSrX">סגור</button></div>
 <label class="f" style="margin:8px 0"><span>שולח</span><select data-c="grSby"><option value="">כל השולחים</option>${ws.map(([u,n])=>`<option value="${esc(u)}"${u===s.by?' selected':''}>${esc(n)}</option>`).join('')}</select></label>
 <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">${K.map(([k,l])=>`<button class="chip${s.k===k?' on':''}" data-a="grSk" data-k="${k}">${l}</button>`).join('')}</div><div id="grsr">${srListH(c)}</div>`}
function srPaint(){const c=GR.c;if(!c||!c.sr||cur().v!=='grc')return;const e=$('#grsr');if(e)e.innerHTML=srListH(c);srImgs()}
function srImgs(){const c=GR.c;if(!c)return;[...document.querySelectorAll('#grsr [data-simg]')].filter(e=>!GR.img['x'+c.gid+'/'+e.dataset.simg]).slice(0,40).forEach(e=>grImgGet(c.gid,e.dataset.simg))}
ACT.grSr=()=>{const c=GR.c;if(!c||!c.ready)return;dtFlush();c.sr={q:'',by:'',k:''};rerender();window.scrollTo(0,0);const i=$('#grsq');if(i)i.focus()};
ACT.grSrX=()=>{const c=GR.c;if(!c)return;c.sr=null;rerender();grImgs();window.scrollTo(0,document.documentElement.scrollHeight)};
INP.grSq=el=>{const c=GR.c;if(!c||!c.sr)return;c.sr.q=el.value;clearTimeout(c.sr.tm);c.sr.tm=setTimeout(srPaint,200)};
CHG.grSby=el=>{const c=GR.c;if(!c||!c.sr)return;c.sr.by=el.value;srPaint()};
ACT.grSk=el=>{const c=GR.c;if(!c||!c.sr)return;c.sr.k=el.dataset.k||'';document.querySelectorAll('[data-a="grSk"]').forEach(b=>b.classList.toggle('on',b===el));srPaint()};
ACT.grSrMore=async()=>{const c=GR.c;if(!c||!c.sr||c.loading)return;let n=0;
 while(c.more&&n<5&&GR.c===c&&c.sr){n++;await ACT.grMore()}
 srPaint()};
ACT.grSrGo=el=>{const c=GR.c;if(!c)return;const id=el.dataset.id;c.sr=null;rerender();grImgs();grJump(id,'ההודעה לא נמצאה')};

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
/* ---- רענון מיידי: התראה על הודעה בקבוצה כשהאפליקציה פתוחה, חזרה לאפליקציה, חזרת הרשת ----
   ההתראה (grp-notify.js בשרת) נושאת data {k:'grp', id:gid}. מאזין נוסף ל-PushNotifications (לא מחליף את זה של secretary.js); רק כש-PushGate מוכן */
document.addEventListener('visibilitychange',()=>{if(!document.hidden)setTimeout(()=>grKick(''),300)});
window.addEventListener('online',()=>setTimeout(()=>grKick(''),300));
try{const C=window.Capacitor,P=C&&C.Plugins&&C.Plugins.PushNotifications,G=C&&C.Plugins&&C.Plugins.PushGate;
 if(P&&G&&isNat())G.state().then(g=>{if(g&&g.ready===true)P.addListener('pushNotificationReceived',n=>{const d=(n&&n.data)||{};if(d.k==='grp')grKick(String(d.id||''))})}).catch(()=>{})}catch(e){}
/* ---- החלקה ימינה = תשובה; לחיצה ארוכה = שורת אימוג'י. החלקה שמאלה (חזרה, index.html) לא מושפעת ---- */
(function(){let g=null,sup=0,pop=null;
 const emoOff=()=>{if(pop){pop.remove();pop=null}};
 const emoOn=(b,mid)=>{emoOff();const c=GR.c;if(!c||c.xoff)return;const r=b.getBoundingClientRect(),w=EMO.length*40+16;
  pop=document.createElement('div');pop.className='gr-emp';pop.innerHTML=EMO.map(e=>`<button data-a="grReact" data-id="${esc(mid)}" data-e="${e}" aria-label="סמן ${e}">${e}</button>`).join('');
  pop.style.top=Math.max(70,r.top-48)+'px';pop.style.left=Math.max(4,Math.min(innerWidth-w-4,r.left+r.width/2-w/2))+'px';document.body.append(pop)};
 const ok=e=>{const b=e.target.closest&&e.target.closest('#grmsgs .gr-b');return b&&!e.target.closest('.gr-emp')?b:null};
 document.addEventListener('touchstart',e=>{if(!e.target.closest||!e.target.closest('.gr-emp'))emoOff();
  const b=GR.c&&!GR.c.sel&&cur().v==='grc'&&e.touches.length===1?ok(e):null;if(g){clearTimeout(g.tm);if(g.b)g.b.style.transform=''}g=null;if(!b)return;const t=e.touches[0];
  g={b,x:t.clientX,y:t.clientY,mid:b.dataset.mid,lp:0,mv:0,tm:setTimeout(()=>{if(g&&!g.mv){g.lp=1;emoOn(g.b,g.mid)}},500)}},{passive:true});
 document.addEventListener('touchmove',e=>{if(!g)return;const t=e.touches[0],dx=t.clientX-g.x,dy=t.clientY-g.y;
  if(Math.abs(dx)>10||Math.abs(dy)>10){g.mv=1;clearTimeout(g.tm)}
  if(dx>10&&Math.abs(dy)<dx/2&&!g.lp){g.b.style.transition='none';g.b.style.transform='translateX('+Math.min(dx,80)+'px)'}},{passive:true});
 document.addEventListener('touchend',e=>{if(!g)return;const t=e.changedTouches[0],dx=t.clientX-g.x,dy=t.clientY-g.y,o=g;g=null;clearTimeout(o.tm);o.b.style.transition='';o.b.style.transform='';
  if(o.lp)sup=Date.now()+500;
  else if(dx>60&&Math.abs(dy)<Math.abs(dx)/2&&Math.abs(dy)<40){sup=Date.now()+500;if(GR.c)ACT.grRe({dataset:{id:o.mid}})}},{passive:true});
 document.addEventListener('touchcancel',()=>{if(g){clearTimeout(g.tm);g.b.style.transform='';g=null}},{passive:true});
 window.addEventListener('click',e=>{if(e.target.closest&&e.target.closest('.gr-emp')){setTimeout(emoOff,0);return}
  const sb=GR.c&&GR.c.sel&&cur().v==='grc'&&e.target.closest&&e.target.closest('#grmsgs .gr-b');if(sb){e.stopPropagation();e.preventDefault();selTap(sb);return}
  if(Date.now()<sup&&e.target.closest&&e.target.closest('#grmsgs')){e.stopPropagation();e.preventDefault();return}emoOff()},true);
 document.addEventListener('contextmenu',e=>{if(e.target.closest&&e.target.closest('#grmsgs .gr-b'))e.preventDefault()},true);
 window.addEventListener('scroll',emoOff,{passive:true})})();
})();
