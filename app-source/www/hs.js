/* חוסרים (שלב 1, 18.11.2026). נטען אחרי index.html ו-hs-core.js. הכול מאחורי bzF('suppliers'); בלי הקובץ הזה האפליקציה נשארת כמו קודם.
   משבצת "חוסרים" עם מונה פתוחים: אצל המנהל במסך ה-+, אצל העובד במסך הבית וב-+ (window.hsTile). עובד ומנהל – אותן אפשרויות.
   מסכים: V.hs (פתוחים / לפי ספק / הגיעו / נמחקו), V.hsEd (הוספה ועריכה).
   נתונים (חוזה ב-hs-core.js ובכללים): hsr/{id}, hsr/{id}/p/1 (תמונה מוקטנת), hsph/{supId} (טלפון ספק), hsx/{supId} (שמות מוצרים מחשבוניות – המנהל בונה מ-pinv).
   "להזמין מספקים" (supord, ord-pick.js) – לא נקרא ולא מוצג כאן (19.11.2026, בקשת בעל הפרויקט: "שיהיה אפשרות לשאול, שהוא לא יכניס לבד").
   במקום זה: אחרי סימון "להזמין מספק" בליקוט, ord-pick.js קורא ל-window.hsAskSo – חלון "להוסיף גם לרשימת החוסרים?" (hsr רגיל, מקושר להזמנה).
   403 (הכללים עוד לא פורסמו / אין הרשאה) ← "החוסרים יופעלו בקרוב", בלי קריסה. שום דבר לא נשמר במכשיר חוץ מזמן הבנייה האחרון של hsx. */
(function(){'use strict';
if(typeof V==='undefined'||typeof ACT==='undefined'||typeof fsx!=='function'||typeof bzF!=='function'||!window.HsCore)return;
const C=window.HsCore;
const PM=()=>window.ProdMatch||null;
const on=()=>{try{return !!((isA()||isW()||!!(SY&&SY.sa))&&!SY.mg&&bzF('suppliers'))}catch(e){return false}};
const mgr=()=>{try{return isA()||!!(SY&&SY.sa)}catch(e){return false}};
const ordOn=()=>{try{return bzF('orders')&&wp('ord')}catch(e){return false}};
const who=()=>(SY&&SY.uid||'')+'|'+(SY&&SY.bizId||'');
const fresh=()=>({who:who(),L:null,at:0,busy:0,off:0,err:'',tab:'open',arr:null,arrAt:0,del:null,delAt:0,lb:0,sel:'',f:null,img:{},ph:{},x:null,xat:0,xi:null,xb:0,cP:null,ci:null,ask:null,G:{},mv:{}});
let HS=fresh();
const chk=()=>{if(HS.who!==who())HS=fresh()};
const DEC=d=>Object.assign({id:idOf(d)},fvj({mapValue:d})||{});
const enc=v=>v===null?{nullValue:null}:typeof v==='string'?{stringValue:v}:typeof v==='boolean'?{booleanValue:v}:typeof v==='number'?(Number.isInteger(v)?{integerValue:String(v)}:{doubleValue:v}):Array.isArray(v)?{arrayValue:{values:v.map(enc)}}:{mapValue:{fields:flds(v)}};
const flds=o=>Object.fromEntries(Object.entries(o).filter(([,x])=>x!==undefined).map(([k,x])=>[k,enc(x)]));
const mask=a=>a.map(k=>'updateMask.fieldPaths='+k).join('&');
const qrun=async sq=>{const r=await fsx(':runQuery',{method:'POST',body:JSON.stringify({structuredQuery:sq})});return(r||[]).filter(x=>x.document).map(x=>DEC(x.document))};
const stQ=(st,lim)=>({from:[{collectionId:'hsr'}],where:{fieldFilter:{field:{fieldPath:'st'},op:'EQUAL',value:{stringValue:st}}},limit:lim});
const err=e=>toast(e&&e.code===403?'החוסרים יופעלו בקרוב':tkErr(e));
/* שינוי מצב שנדחה (403) כשהרשימה כבר נטענה = כנראה הפריט השתנה במכשיר אחר (h כבר לא ההמשך): מרעננים ומודיעים במקום שגיאה */
const stErr=e=>{if(e&&e.code===403&&HS.L&&!HS.off){toast('הפריט עודכן במכשיר אחר. הרשימה רועננה – נסו שוב.');HS.at=0;HS.arr=null;HS.del=null;hsLoad()}else err(e)};
const typing=()=>{const a=document.activeElement;return !!(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)&&a.closest('#main'))};
const dOpen=()=>!!document.querySelector('#dlg[open]');
const tm=t=>{if(!t)return '';const d=new Date(t);return d.toLocaleDateString('he-IL',{day:'numeric',month:'numeric'})+' '+d.toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'})};
const digits=p=>String(p||'').replace(/\D/g,'');
const nextUt=x=>Math.max(Date.now(),(x&&+x.ut||0)+1);
const all=()=>(HS.L||[]).concat(HS.arr||[],HS.del||[]);
const find=id=>all().find(x=>x.id===id)||HS.mv[id];
const valid=x=>x&&idOk(x.id)&&typeof x.n==='string';

/* ---- עיצוב: רק משתני ערכת הנושא ---- */
const st=document.createElement('style');st.textContent=`
.hs-tg{display:flex;flex-wrap:wrap;gap:4px;margin:4px 0}
.hs-it .m{flex:1;min-width:0}.hs-it .m b{display:block;overflow-wrap:anywhere}
.hs-it small{display:block;color:var(--mut);font-size:.8rem;margin-top:2px}
.hs-acts{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.hs-acts .btn{flex:1 1 auto;min-width:0}
.hs-pk .li{min-height:48px;padding:8px 12px;margin-bottom:6px}.hs-pk .li .m b{font-size:.98rem;overflow-wrap:anywhere}.hs-pk .li small{display:block;color:var(--mut);font-size:.8rem;margin-top:2px}
.hs-tabs{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
.hs-thb{padding:0;border:0;background:none;cursor:zoom-in;border-radius:var(--r-m,10px)}
.hs-zw{max-height:65vh;overflow:auto;border-radius:var(--r-m,10px);-webkit-overflow-scrolling:touch}
.hs-zi{display:block;width:100%;max-height:65vh;object-fit:contain;cursor:zoom-in}.hs-zi.z{width:250%;max-width:none;max-height:none;cursor:zoom-out}
.hs-th{width:84px;height:84px;object-fit:cover;border-radius:var(--r-m,10px);border:1px solid var(--line);display:block}
.hs-sr{padding:6px 0;border-bottom:1px solid var(--line)}.hs-sr:last-child{border:0}
.hs-bn{position:fixed;inset:auto 10px calc(100px + env(safe-area-inset-bottom)) 10px;z-index:98;max-width:520px;margin:auto;padding:12px;box-shadow:0 8px 24px rgba(0,0,0,.4)}
`;document.head.appendChild(st);

/* ---------- ספקים ---------- */
function supList(){const o=[],seen=new Set(),put=s=>{if(s&&idOk(String(s.id||''))&&!seen.has(s.id)){seen.add(s.id);o.push({id:s.id,name:String(s.name||'').slice(0,60)})}};
 try{if(isW()){if(typeof wkSubsAll==='function')wkSubsAll().forEach(put)}
  else (S.cats||[]).filter(c=>c.kind==='exp'&&c.beh==='sup'&&!c.hid&&!c.off).forEach(c=>subsOf(c.id).forEach(put))}catch(e){}
 /* סנכרון ספקים (19.11.2026): ספק מהמלאי (prod.sup) שאין לו כרטיס – גם כאן, עם מזהה לפי השם (C.nameId). המנהל יוצר לו כרטיס באותו מזהה (sup-sync.js) */
 try{const ks=new Set(o.map(s=>supK(s.name)));(window.supCatNames?window.supCatNames():[]).forEach(n=>{const k=supK(n);if(k&&!ks.has(k)){ks.add(k);put({id:C.nameId(n),name:n})}})}catch(e){}
 return o.sort((a,b)=>String(a.name).localeCompare(String(b.name),'he'))}
const supK=n=>String(n||'').replace(/["'׳״`’]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
const supName=id=>{const s=supList().find(x=>x.id===id);return s?s.name:''};

/* ---------- שם העובד (19.11.2026) ----------
   byN / ub / h[].byN הם שם המשתמש (החלק שלפני @ – כך הכללים מאמתים). לתצוגה: המנהל ממפה לשם המלא מרשימת העובדים (staff),
   עובד רואה את השם שלו (מסמך ה-staff שלו); אחרת – שם המשתמש כמו קודם. בלי שינוי בשרת. */
const NM={};let nmAt=0;
async function nmLoad(){if(nmAt&&Date.now()-nmAt<600000)return;nmAt=Date.now();const nm0=JSON.stringify(NM);
 try{const put=f=>{f=f||{};const em=String(f.email||'').split('@')[0].toLowerCase(),n=String(f.name||'').trim().slice(0,60);if(em&&n)NM[em]=n};
  if(mgr()){const j=await fsx('/staff?pageSize=300');((j&&j.documents)||[]).forEach(d=>put(fvj({mapValue:d})))}
  else{const d=await fsx('/staff/'+SY.uid);const f=fvj({mapValue:d})||{};const n=String(f.name||'').trim().slice(0,60);if(n)NM[fbBy().toLowerCase()]=n}}catch(e){}
 if(JSON.stringify(NM)!==nm0)paint()}
const nmOf=b=>{const k=String(b||'').toLowerCase();if(!k)return '';return NM[k]||(mgr()&&k===fbBy().toLowerCase()?'מנהל':String(b))};

/* ---------- טעינה ---------- */
async function hsLoad(){if(HS.busy||!on())return;HS.busy=1;HS.err='';const h=HS;
 try{const L=await qrun(stQ('open',500));h.L=L.filter(valid).sort((a,b)=>(b.t||0)-(a.t||0));h.off=0;/* סנכרון ספקים: ספק שנרשם בחוסר בלי כרטיס – לכרטסת (מנהל, sup-sync.js) */if(mgr()&&window.supSyncNames)window.supSyncNames(h.L.flatMap(x=>(x.supN||[]).concat(x.od&&x.od.sup?[x.od.sup]:[])))}
 catch(e){if(e&&e.code===403)h.off=1;else h.err=tkErr(e)}
 finally{h.busy=0;h.at=Date.now()}
 paint()}
async function stLoad(k){if(HS.lb||!on())return;HS.lb=1;
 try{const L=await qrun(stQ(k,200));HS[k]=L.filter(valid).sort((a,b)=>(b.ut||b.t||0)-(a.ut||a.t||0));HS[k+'At']=Date.now()}
 catch(e){if(e&&e.code===403)HS.off=1;HS[k]=HS[k]||[];HS[k+'At']=Date.now()}
 finally{HS.lb=0}paint()}
/* שמות מוצרים מחשבוניות (hsx) – לכל הצוות, להצעת ספק */
async function xLoad(force){if(!force&&HS.x&&Date.now()-HS.xat<600000)return;HS.xat=Date.now();
 try{const j=await fsx('/hsx?pageSize=300');HS.x=((j&&j.documents)||[]).map(DEC).filter(d=>idOk(d.id))}catch(e){HS.x=HS.x||[]}
 HS.xi=null;sugPaint()}
const xIdx=()=>{if(!HS.xi&&HS.x&&HS.x.length&&PM())HS.xi=C.xIndex(HS.x,PM());return HS.xi};
const cIdx=()=>{try{const P=ordOn()&&window.__ox&&Array.isArray(window.__ox.P)?window.__ox.P:null;if(!P||!PM())return null;const SL=supList(),sk=SL.length;if(HS.cP!==P||HS.cK!==sk){HS.cP=P;HS.cK=sk;HS.ci=C.catIndex(P,SL,PM())}return HS.ci}catch(e){return null}};
/* המנהל: בניית hsx מחשבוניות התמחור (pinv) – רק חדשות מאז הפעם הקודמת, רק שמות מוצרים (בלי מחירים). כשל (403 וכו') – בשקט */
async function xBuild(){if(HS.xb||!mgr()||!PM())return;HS.xb=1;const K='hs-xat|'+who();
 try{const last=+localStorage.getItem(K)||0;
  const L=await qrun({from:[{collectionId:'pinv'}],select:{fields:['supId','sup','at','lines','inv','st'].map(f=>({fieldPath:f}))},where:{fieldFilter:{field:{fieldPath:'at'},op:'GREATER_THAN',value:iv(last)}},orderBy:[{field:{fieldPath:'at'},direction:'ASCENDING'}],limit:200});
  if(!L.length)return;invFill(L);await xLoad(true);let mx=last;const add={};
  L.forEach(p=>{mx=Math.max(mx,+p.at||0);const id=String(p.supId||'');if(!idOk(id))return;const a=add[id]||(add[id]={n:String(p.sup||'').slice(0,60),k:[]});
   (Array.isArray(p.lines)?p.lines:[]).forEach(l=>{const k=PM().key(l&&l.n||'');if(k&&k.length<=200)a.k.push(k)})});
  for(const id of Object.keys(add)){const d0=(HS.x||[]).find(d=>d.id===id),old=d0&&Array.isArray(d0.it)?d0.it:[];
   const it=[...new Set(add[id].k.reverse().concat(old))].slice(0,3000);if(d0&&it.length===old.length&&it.every((x,i)=>x===old[i]))continue;
   const d={n:(add[id].n||d0&&d0.n||supName(id)||'').slice(0,60),it,t:Date.now()};
   await fsx('/hsx/'+id,{method:'PATCH',body:JSON.stringify({fields:flds(d)})});
   if(d0)Object.assign(d0,d);else (HS.x=HS.x||[]).push(Object.assign({id},d))}
  localStorage.setItem(K,String(mx));HS.xi=null}
 catch(e){}}
function paint(){try{tilePaint();if(cur().v==='hs'&&!typing()&&!dOpen())rerender()}catch(e){}}

/* ---------- משבצת ---------- */
const tileN=()=>HS.L&&!HS.off?HS.L.length:0;
const tag=n=>n?`<span class="tag t1">${n}</span>`:'';
function tilePaint(){document.querySelectorAll('[data-hsn]').forEach(e=>{e.innerHTML=tag(tileN())})}
/* k='go' – משבצת במסך הבית של העובד; אחרת – משבצת במסך ה-+ (סוגרת את החלון) */
window.hsTile=k=>{if(!on())return '';chk();if(!HS.busy&&Date.now()-HS.at>60000)hsLoad();
 return `<button class="tile" data-a="${k==='go'?'go':'addGo'}" data-v="hs" style="font-size:1rem">${ico('doc')}חוסרים<span data-hsn>${tag(tileN())}</span></button>`};

/* ---------- רשימה ---------- */
const WHYT=w=>C.WHY_L[w]||'';
const supTags=x=>x.gen?'<span class="tag t1">כללי – מופיע לכל הספקים</span>':(x.supN||[]).map((n,i)=>`<span class="tag">${esc(n||supName((x.sups||[])[i])||'ספק')}</span>`).join('');
const lastH=(x,ks)=>{const h=Array.isArray(x.h)?x.h:[];for(let i=h.length-1;i>=0;i--)if(h[i]&&ks.includes(h[i].k))return h[i];return null};
function itemH(x,mode){
 const c=x.cust&&(x.cust.nm||x.cust.ph)?x.cust:null;
 const det=[x.q?'כמות '+C.fmtQ(x.q):'',c?'לקוח: '+[c.nm,c.ph].filter(Boolean).join(' '):''].filter(Boolean).join(' · ');
 const meta='נוסף ע"י '+nmOf(x.byN)+' · '+tm(x.t)+(x.ub&&mode==='open'?' · עודכן ע"י '+nmOf(x.ub)+' · '+tm(x.ut):'');
 const hA=mode==='arr'?lastH(x,['man','inv']):null,hD=mode==='del'?lastH(x,['del']):null,hP=mode==='open'&&C.unpartQ(x)!=null?x.h[x.h.length-1]:null;
 const b=(a,t,cl)=>`<button type="button" class="btn ${cl||'g'} s" data-a="${a}" data-id="${esc(x.id)}">${t}</button>`;
 let acts='';
 if(mode==='open')acts=b('hsArr','✓ הגיע','')+b('hsOd',x.od?'📦 עדכון הזמנה':'📦 הוזמן')+b('hsEdit','עריכה')+b('hsDel','מחיקה')+(hP?b('hsUnp','בטל הגעה חלקית'):'');
 else if(mode==='arr')acts=b('hsUndo','החזר לחוסרים')+(c&&c.ph?b('hsCustWa','הודעה ללקוח בוואטסאפ',''):'');
 else acts=b('hsRes','שחזור');
 if(x.np)acts+=b('hsImg','📷 תמונה');
 if(x.ord&&x.ord.id&&ordOn())acts+=`<button type="button" class="btn g s" data-a="go" data-v="oxOrd" data-arg="${esc(x.ord.id)}">להזמנה #${esc(x.ord.no||'')}</button>`;
 return `<div class="card hs-it" data-hs="${esc(x.id)}" style="padding:10px 12px"><div class="m"><b>${esc(x.n)}</b>
 <div class="hs-tg">${supTags(x)}<span class="tag">${esc(WHYT(x.why))}</span>${x.ord&&x.ord.id?`<span class="tag">הזמנה #${esc(x.ord.no||'')}</span>`:''}${odTag(x,mode)}</div>
 ${det?`<small>${esc(det)}</small>`:''}<small>${esc(meta)}</small>${odLine(x)}${hA?`<small>${hA.k==='inv'?'ירד אוטומטית מחשבונית'+(hA.inv?' #'+esc(hA.inv):'')+(hA.sup?' של '+esc(hA.sup):'')+' · '+esc(tm(hA.t))+' · '+esc(nmOf(hA.byN)):`הגיע · ${esc(tm(hA.t))} · ${esc(nmOf(hA.byN))}`}</small>`:''}${hP?`<small>הגיע חלקית בחשבונית${hP.inv?' #'+esc(hP.inv):''} · ${esc(tm(hP.t))} · ${esc(nmOf(hP.byN))} · נשארו ${esc(C.fmtQ(hP.q))} מתוך ${esc(C.fmtQ(hP.q0))} (לפי יחידות החשבונית)</small>`:''}${hD?`<small>נמחק · ${esc(tm(hD.t))} · ${esc(nmOf(hD.byN))}</small>`:''}</div>
 <div class="hs-acts">${acts}</div></div>`}
/* ---------- הוזמן (19.11.2026) ----------
   od = { u, byN, t, sup, eta }: מי סימן "הוזמן" (u / byN – בשם המבצע, נאכף בכללים), מתי (t = ut), מאיזה ספק (sup, עד 60), צפי הגעה (eta, YYYY-MM-DD או ריק).
   עדכון שמשנה רק od / ub / ut. ביטול = מחיקת od. בלי הכללים החדשים (403) – הודעה שהכפתור יופעל אחרי עדכון השרת. */
const dmy=d=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d||''));return m?(+m[3])+'.'+(+m[2])+'.'+m[1]:''};
const today=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
const odLate=x=>!!(x.od&&x.st==='open'&&x.od.eta&&x.od.eta<today());
const odTag=(x,mode)=>x.od&&mode==='open'?`<span class="tag${odLate(x)?' t1':''}">${odLate(x)?'הוזמן – באיחור':'הוזמן'}</span>`:'';
const odLine=x=>{const o=x.od;if(!o)return '';return `<small>הוזמן ע"י ${esc(nmOf(o.byN))}${o.sup?' מ'+esc(o.sup):''} · ${esc(tm(o.t))}${o.eta?' · צפי הגעה '+esc(dmy(o.eta)):' · אין צפי הגעה'}</small>`};
ACT.hsOd=el=>{const x=find(el.dataset.id);if(!x)return;HS.od={id:x.id};
 const own=(x.supN||[]).map((n,i)=>n||supName((x.sups||[])[i])).filter(Boolean),L=[...new Set(own.concat(supList().map(s=>s.name)))];
 const cur=x.od&&x.od.sup||own[0]||'';
 dlg(`<h3>הוזמן: ${esc(x.n)}</h3><form data-f="hsOdSave" autocomplete="off">
 <label class="f"><span>ממי הוזמן (ספק)</span><input name="sup" list="hsOdL" maxlength="60" value="${esc(cur)}" placeholder="שם הספק"></label><datalist id="hsOdL">${L.map(n=>`<option value="${esc(n)}">`).join('')}</datalist>
 <label class="f"><span>צפי הגעה (רשות)</span><input name="eta" type="date" value="${esc(x.od&&x.od.eta||'')}"></label>
 <p class="note" style="margin:0">יירשם שהזמנת ${esc(nmOf(fbBy()))}, עם התאריך והשעה של עכשיו.</p>
 <div class="row" style="margin-top:10px"><button class="btn grow">שמירה</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div>
 ${x.od?`<button type="button" class="btn g s w" data-a="hsOdRm" style="margin-top:8px">ביטול הסימון "הוזמן"</button>`:''}</form>`)};
async function odPut(id,od){const x=find(id);if(!x)return false;const ut=nextUt(x),ub=fbBy().slice(0,100);if(od)od.t=ut;
 try{await fsx('/hsr/'+id+'?'+mask(['od','ub','ut']),{method:'PATCH',body:JSON.stringify({fields:flds(od?{od,ub,ut}:{ub,ut})})})}
 catch(e){if(e&&e.code===403&&!HS.off){toast('לא נשמר. אם זה חוזר – הכפתור "הוזמן" עוד לא הופעל בשרת.');HS.at=0;hsLoad()}else err(e);return false}
 if(od)x.od=od;else delete x.od;x.ub=ub;x.ut=ut;return true}
FRM.hsOdSave=async f=>{const o=HS.od;if(!o)return;const sup=String(f.sup.value||'').replace(/\s+/g,' ').trim().slice(0,60),eta=String(f.eta.value||'');
 if(eta&&!/^\d{4}-\d{2}-\d{2}$/.test(eta))return toast('תאריך לא תקין');
 const bt=f.querySelector('button:not([type])');if(bt)bt.disabled=true;
 if(await odPut(o.id,{u:SY.uid,byN:fbBy().slice(0,100),t:0,sup,eta})){HS.od=null;closeDlg();toast('סומן: הוזמן');if(sup&&window.supSyncNames)window.supSyncNames([sup]);rerender()}else if(bt)bt.disabled=false};
ACT.hsOdRm=()=>{const o=HS.od;if(!o)return;ask('לבטל את הסימון "הוזמן"?',async()=>{if(await odPut(o.id,null)){HS.od=null;closeDlg();toast('הסימון בוטל');rerender()}},'כן, לבטל')};
function listH(L,mode,empty){return L===null?'<div class="empty">טוען…</div>':L.length?L.map(x=>itemH(x,mode)).join(''):`<div class="empty">${empty}</div>`}

/* ---------- לפי ספק ---------- */
function supTab(){
 const sups=supList(),gen=(HS.L||[]).filter(x=>x.gen),G0=C.groups(HS.L||[],sups,[],PM());let G=G0;
 if(HS.sel){let g=G.find(x=>x.id===HS.sel);if(!g){const nm=supName(HS.sel);g=nm?{id:HS.sel,name:nm,known:true,L:C.forSup(HS.L||[],HS.sel),O:[]}:null}G=g?[g]:[]}
 HS.G={};G.forEach(g=>{HS.G[g.id]=g});
 /* 20.11.2026: במקום תיבת בחירה – כפתור לכל ספק שיש לו פריטים (עם המספר), ו"הכל" */
 const cb=(id,l,on)=>`<button type="button" class="chip${on?' on':''}" data-a="hsSel" data-id="${esc(id)}" aria-pressed="${on}">${l}</button>`;
 const CH=G0.slice();if(HS.sel&&G[0]&&!CH.some(g=>g.id===HS.sel))CH.push(G[0]);
 /* 21.11.2026: "הוזמן" מוצג אצל כל ספקי הפריט; המונה = מה שעוד צריך להזמין, והוזמנו בנפרד ("שמאי (5 · 2 הוזמנו)") */
 const cnt=g=>{const s=C.split(g.L);return s.need.length+(s.done.length?' · '+s.done.length+' הוזמנו':'')};
 const pick=`<div class="hs-tg" role="group" aria-label="הצג ספק">${cb('','הכל',!HS.sel)}${CH.map(g=>cb(g.id,esc(g.name)+' ('+cnt(g)+')',HS.sel===g.id)).join('')}</div>`;
 const genN=gen.length?`<p class="note">${gen.length} פריטים כלליים מופיעים אצל כל ספק${G.length?'':' – בחרו ספק כדי לשלוח אותם'}.</p>`:'';
 const odT=x=>{const o=x.od;if(!o||typeof o!=='object')return '';const l=odLate(x);return `<span class="tag${l?' t1':''}">הוזמן${o.sup?' מ'+esc(o.sup):''}${l?' – באיחור':''}</span>`};
 const row=r=>`<div class="hs-sr"><b>${esc(r.it.n)}</b>${r.it.q?` · כמות ${esc(C.fmtQ(r.it.q))}`:''} ${r.all?'<span class="tag t1">מופיע לכל הספקים</span>':''}${odT(r.it)}${r.it.od?`<div>${odLine(r.it)}</div>`:''}</div>`;
 const card=g=>{const ph=HS.ph[g.id];return `<div class="card" data-hsg="${esc(g.id)}"><div class="row" style="align-items:center"><h3 class="grow" style="margin:0">${esc(g.name)} (${cnt(g)})</h3>${ph?`<button type="button" class="chip" data-a="hsPhEd" data-id="${esc(g.id)}" style="min-height:32px">☎ ${esc(ph)}</button>`:''}</div>
 ${g.L.map(row).join('')}${g.L.length?'':'<p class="note">אין פריטים לספק הזה.</p>'}
 <div class="hs-acts"><button type="button" class="btn s" data-a="hsWa" data-id="${esc(g.id)}">וואטסאפ לספק</button><button type="button" class="btn g s" data-a="hsPdf" data-k="share" data-id="${esc(g.id)}">קובץ לשיתוף</button><button type="button" class="btn g s" data-a="hsPdf" data-k="print" data-id="${esc(g.id)}">הדפסה</button>${tkOk()&&C.split(g.L).need.length?`<button type="button" class="btn g s" style="min-height:44px" data-a="hsTk" data-id="${esc(g.id)}">צור משימת הזמנה</button>`:''}</div></div>`};
 return pick+genN+(G.length?G.map(card).join(''):`<div class="empty">${HS.sel?'אין פריטים לספק הזה':'אין פריטים משויכים לספקים'}</div>`)}

V.hs=()=>{const T='חוסרים';if(!on())return{t:T,h:'<div class="empty">המסך הזה לא זמין</div>'};chk();
 if(!HS.busy&&(HS.L===null||Date.now()-HS.at>20000))hsLoad();
 if(HS.off)return{t:T,h:'<div class="card"><p class="note" style="margin:0">החוסרים יופעלו בקרוב.</p></div>'};
 if(HS.L===null)return{t:T,h:HS.err?`<div class="card"><p class="note" style="margin:0">${esc(HS.err)}</p><button class="btn g w" data-a="hsRe" style="margin-top:10px">נסה שוב</button></div>`:'<div class="empty">טוען…</div>'};
 xBuild();nmLoad();
 const k=HS.tab;if((k==='arr'||k==='del')&&!HS.lb&&(HS[k]===null||Date.now()-HS[k+'At']>20000))stLoad(k);
 const t=(v,l)=>`<button type="button" class="chip${k===v?' on':''}" data-a="hsTab" data-v="${v}" aria-pressed="${k===v}">${l}</button>`;
 const body=k==='sup'?supTab():k==='arr'?listH(HS.arr,'arr','עוד לא הגיע שום פריט'):k==='del'?listH(HS.del,'del','אין פריטים מחוקים'):listH(HS.L,'open','אין חוסרים פתוחים 🎉');
 return{t:T,s:HS.L.length?HS.L.length+' פתוחים':'',h:`<button type="button" class="btn w" data-a="hsNew" style="margin-bottom:10px">＋ הוספת חוסר</button>
 <div class="hs-tabs">${t('open','פתוחים ('+HS.L.length+')')}${t('sup','לפי ספק')}${t('arr','הגיעו')}${t('del','נמחקו')}</div>${body}
 <button type="button" class="btn g s w" data-a="hsRe" style="margin-top:8px">רענן</button>`}};
ACT.hsTab=el=>{HS.tab=['open','sup','arr','del'].includes(el.dataset.v)?el.dataset.v:'open';rerender()};
ACT.hsRe=()=>{HS.at=0;HS.err='';HS.arr=null;HS.del=null;HS.off=0;hsLoad();rerender()};
ACT.hsSel=el=>{const id=String(el.dataset.id||'');HS.sel=idOk(id)?id:'';rerender()};

/* ---------- מצב: הגיע / החזר / מחיקה רכה / שחזור ---------- */
async function setSt(id,stN,k){const x=find(id);if(!x)return false;const ut=nextUt(x),ub=fbBy().slice(0,100),h=C.hAdd(x.h,{k,t:ut,byN:ub,u:SY.uid});/* הכללים: רשומה אחת בסוף, בשם המבצע, t = ut */
 try{await fsx('/hsr/'+id+'?'+mask(['st','h','ub','ut']),{method:'PATCH',body:JSON.stringify({fields:flds({st:stN,h,ub,ut})})})}catch(e){stErr(e);return false}
 const from=x.st;Object.assign(x,{st:stN,h,ub,ut});HS.mv[id]=x;/* נשאר זמין לפעולות (למשל הודעה ללקוח) גם כשרשימת היעד עוד לא נטענה */
 const lk=s=>s==='open'?'L':s;if(HS[lk(from)])HS[lk(from)]=HS[lk(from)].filter(y=>y.id!==id);if(HS[lk(stN)])HS[lk(stN)]=[x].concat(HS[lk(stN)].filter(y=>y.id!==id));
 tilePaint();return true}
ACT.hsArr=async el=>{const id=el.dataset.id,x=find(id);if(!x||el.disabled)return;el.disabled=true;
 if(!await setSt(id,'arr','man')){el.disabled=false;return}
 rerender();const c=x.cust;
 if(c&&c.ph)dlg(`<h3>סומן: הגיע</h3><p>${esc(c.nm||'הלקוח')} ביקש את "${esc(x.n)}".</p><div class="row"><button class="btn grow" data-a="hsCustWa" data-id="${esc(id)}">הודעה ללקוח בוואטסאפ</button><button class="btn g grow" data-a="closeDlg">סגור</button></div>`);
 else toast('סומן: הגיע')};
ACT.hsUndo=async el=>{if(el.disabled)return;el.disabled=true;if(await setSt(el.dataset.id,'open','undo')){toast('הוחזר לחוסרים');rerender()}else el.disabled=false};
ACT.hsRes=async el=>{if(el.disabled)return;el.disabled=true;if(await setSt(el.dataset.id,'open','res')){toast('שוחזר');rerender()}else el.disabled=false};
ACT.hsDel=el=>{const id=el.dataset.id,x=find(id);if(!x)return;ask('למחוק את "'+x.n+'" מהחוסרים? אפשר לשחזר אחר כך ב"נמחקו".',async()=>{if(await setSt(id,'del','del')){toast('נמחק');rerender()}},'מחק')};
ACT.hsCustWa=el=>{const x=find(el.dataset.id);closeDlg();if(!x||!x.cust||!C.phOk(x.cust.ph))return toast('אין טלפון תקין ללקוח');
 window.open('https://wa.me/'+C.intl(x.cust.ph)+'?text='+encodeURIComponent(C.custText(x,'')),'_system')};

/* ---------- תמונה ---------- */
const MAXB=300000;
function shrink(du){return new Promise((ok,no)=>{const im=new Image();im.onload=()=>{let mx=1024,q=.6,out='';for(let i=0;i<6;i++){const r=Math.min(1,mx/Math.max(im.naturalWidth,im.naturalHeight)),c=document.createElement('canvas');c.width=Math.max(1,Math.round(im.naturalWidth*r));c.height=Math.max(1,Math.round(im.naturalHeight*r));c.getContext('2d').drawImage(im,0,0,c.width,c.height);out=c.toDataURL('image/jpeg',q);if(out.length<MAXB)return ok(out);mx=Math.round(mx*.8);q=Math.max(.35,q-.05)}no(new Error('התמונה גדולה מדי'))};im.onerror=()=>no(new Error('תמונה לא תקינה'));im.src=du})}
async function imgGet(id){if(HS.img[id])return HS.img[id];try{const d=DEC(await fsx('/hsr/'+id+'/p/1'));if(imgOk(d.img)&&/^data:image\/(jpeg|png|webp);/.test(d.img))HS.img[id]=d.img}catch(e){}return HS.img[id]||''}
/* תצוגה מוגדלת (19.11.2026): נגיעה בתמונה מגדילה פי 2.5 (גוללים בתוך המסגרת), נגיעה נוספת מחזירה. שיתוף – מה שמוצג (HS.big) */
function imgDlg(t,du){HS.big=du;
 dlg(`<h3>${esc(t)}</h3><div class="hs-zw"><img src="${esc(du)}" alt="${esc(t)}" data-a="hsZoom" class="hs-zi"></div><p class="note" style="margin:6px 0 0">נגיעה בתמונה – הגדלה / הקטנה</p><div class="row" style="margin-top:10px"><button class="btn grow" data-a="hsImgShare">שיתוף</button><button class="btn g grow" data-a="closeDlg">סגור</button></div>`)}
ACT.hsZoom=el=>{const z=!el.classList.contains('z');el.classList.toggle('z',z);if(z){const w=el.parentElement;if(w)requestAnimationFrame(()=>{w.scrollLeft=(w.scrollWidth-w.clientWidth)/2*(document.dir==='rtl'?-1:1);w.scrollTop=(w.scrollHeight-w.clientHeight)/2})}};
ACT.hsImg=async el=>{const id=el.dataset.id,x=find(id);if(!x)return;if(!HS.img[id])toast('טוען תמונה…');const du=await imgGet(id);if(!du)return toast('התמונה לא נמצאה');imgDlg(x.n,du)};
/* התמונה בטופס (קיימת או חדשה שעוד לא נשמרה) */
ACT.hsImgBig=()=>{const f=HS.f;if(!f)return;const du=f.img||(!f.imgDel&&f.id?HS.img[f.id]:'');if(du)imgDlg(String(f.n||'').trim()||'תמונת המוצר',du)};
ACT.hsImgShare=()=>{if(HS.big)dxShareDU(HS.big,'LargePami_item')};

/* ---------- הוספה ועריכה ---------- */
const blank=()=>({id:'',n:'',sups:[],gen:false,why:'store',q:'',custOn:false,cust:{nm:'',ph:''},ord:null,img:null,imgDel:false,np:0,busy:0,touched:false,auto:false});
ACT.hsNew=()=>{if(!on())return;HS.f=blank();xLoad();catLoad();go('hsEd','')};
ACT.hsEdit=el=>{const x=find(el.dataset.id);if(!x)return;
 HS.f=Object.assign(blank(),{id:x.id,n:x.n,sups:(Array.isArray(x.sups)?x.sups:[]).map((id,i)=>({id,name:String((x.supN||[])[i]||supName(id)||id)})).filter(s=>typeof s.id==='string'&&idOk(s.id)),gen:!!x.gen,why:x.why||'store',q:x.q?String(x.q):'',
  custOn:!!(x.cust&&(x.cust.nm||x.cust.ph)),cust:Object.assign({nm:'',ph:''},x.cust||{}),ord:x.ord&&x.ord.id?{id:x.ord.id,no:x.ord.no||0}:null,np:x.np?1:0,touched:true});
 xLoad();catLoad();if(x.np)imgGet(x.id).then(imgPaint);go('hsEd',x.id)};
/* זיהוי המוצר מהמלאי (19.11.2026): חיפוש בכל מוצרי הקטלוג (שם, כינוי, ברקוד, קוד פריט). הספק של המוצר (prod.sup) מוצע ראשון ונבחר אוטומטית בחוסר חדש */
const pIdx=()=>{try{const P=window.__ox&&Array.isArray(window.__ox.P)?window.__ox.P:null;if(!P||!PM())return null;if(HS.pP!==P){HS.pP=P;HS.pi=PM().index(P)}return HS.pi}catch(e){return null}};
function prodHit(){const f=HS.f,n=String(f&&f.n||'').trim(),ix=pIdx();if(n.length<2||!ix)return null;try{return PM().search(ix,n,{limit:1,min:0.75})[0]||null}catch(e){return null}}
/* טעינת המלאי פעם אחת למסך החוסר (אם עוד לא נטען במסך ההזמנות) */
function catLoad(){try{if(window.__ox&&window.__ox.P||!ordOn()||typeof window.__oxLoadAll!=='function'||HS.cl)return;HS.cl=1;Promise.resolve(window.__oxLoadAll()).catch(()=>{}).then(()=>{HS.cl=0;sugPaint()})}catch(e){HS.cl=0}}
const supRef=n=>{const k=supK(n);if(!k)return null;const s=supList().find(y=>supK(y.name)===k);return s?{id:s.id,name:s.name}:{id:C.nameId(n),name:String(n).trim().slice(0,60)}};
function sugList(){const f=HS.f;if(!f)return[];const n=String(f.n||'').trim();if(n.length<2||!PM())return[];
 let L=[];try{L=C.suggest(n,{idx:xIdx(),cidx:cIdx(),items:all(),sups:supList()},PM())}catch(e){}
 const h=prodHit(),sp=h&&typeof h.p.sup==='string'?supRef(h.p.sup):null;
 if(sp&&idOk(sp.id))L=[Object.assign({src:'prod',s:9},sp)].concat(L.filter(x=>x.id!==sp.id)).slice(0,5);
 return L}
const SRC={prev:'נבחר בעבר',inv:'מחשבונית',cat:'מהקטלוג',prod:'ספק המוצר במלאי'};
/* מוצרים מתאימים (20.11.2026): עד 6 שמות מהמלאי ומחוסרים קודמים (פתוחים / הגיעו – מה שכבר נטען, בלי שאילתה חדשה). לחיצה – השם והספק שלו */
const qIdx=()=>{const f=HS.f,id=f&&f.id||'';if(!PM())return null;if(HS.qL!==HS.L||HS.qA!==HS.arr||HS.qF!==id||HS.qN!==all().length){HS.qL=HS.L;HS.qA=HS.arr;HS.qF=id;HS.qN=all().length;try{HS.qi=C.prevIndex(all(),PM(),id)}catch(e){HS.qi=null}}return HS.qi};
function pickList(){const f=HS.f;if(!f||!PM())return[];const n=String(f.n||'').trim(),ix=pIdx(),qi=qIdx();
 if(HS.pkK===n&&HS.pkP===ix&&HS.pkQ===qi)return HS.pkL;/* אותו שם ואותם נתונים – בלי חיפוש חוזר */
 let L=[];try{L=C.picks(n,{prod:ix,prev:qi},PM())}catch(e){}
 L=L.map(p=>Object.assign({},p,{sups:p.sups.map(s=>s.id&&idOk(s.id)?{id:s.id,name:supName(s.id)||s.name||s.id}:supRef(s.name)).filter(s=>s&&idOk(s.id))}));
 HS.pkK=n;HS.pkP=ix;HS.pkQ=qi;HS.pkL=L;return L}
const PSRC={prod:'במלאי',prev:'הוזן בעבר'};
function pickH(){const f=HS.f;if(!f||f.pkd===f.n)return '';/* אחרי בחירה – הרשימה נסגרת עד שמשנים את השם */const L=pickList();if(!L.length)return '';
 return `<p class="note" style="margin:4px 0">מוצרים מתאימים – נגיעה בוחרת:</p><div class="hs-pk">${L.map((p,i)=>`<button type="button" class="li" data-a="hsPick" data-i="${i}"><div class="m"><b>${esc(p.n)}</b><small>${p.sups.length?'ספק: '+esc(p.sups.map(s=>s.name).join(', '))+' · ':''}${PSRC[p.src]||''}</small></div></button>`).join('')}</div>`}
function sugH(S){const f=HS.f;if(!f)return '';const pm=pickH();if(f.gen)return pm;const L=S.filter(s=>!f.sups.some(x=>x.id===s.id));
 if(L.length)return pm+`<p class="note" style="margin:4px 0">ספקים שמביאים את המוצר:</p><div class="hs-tg">${L.map(s=>`<button type="button" class="chip" data-a="hsSupAdd" data-id="${esc(s.id)}" data-n="${esc(s.name)}">＋ ${esc(s.name)} <small>(${SRC[s.src]||''})</small></button>`).join('')}</div>`;
 return pm+(String(f.n||'').trim().length>=2&&!f.sups.length?'<p class="note" style="margin:4px 0">לא זוהה ספק. אפשר לבחור ספק, או לשמור כפריט כללי (יופיע אצל כל הספקים).</p>':'')}
/* לחיצה על מוצר מתאים: השם, והספק שלו נבחר. ספקים שנבחרו ידנית נשארים (מוסיפים לידם). פריט כללי – רק השם */
ACT.hsPick=el=>{const f=HS.f,p=f&&(HS.pkL||[])[+el.dataset.i];if(!p)return;f.n=p.n;f.pkd=f.n;const e=document.querySelector('[data-i="hsN"]');if(e)e.value=f.n;
 if(p.sups.length&&!f.gen){if(f.touched||f.id){p.sups.forEach(s=>{if(f.sups.length<C.MAXS&&!f.sups.some(x=>x.id===s.id))f.sups.push({id:s.id,name:s.name})})}
  else{f.sups=p.sups.slice(0,C.MAXS).map(s=>({id:s.id,name:s.name}));f.auto=true;f.pkN=f.n}
  const h=document.getElementById('hsSups');if(h)h.innerHTML=supsH()}
 sugPaint()};
function supsH(){const f=HS.f,L=supList().filter(s=>!f.sups.some(x=>x.id===s.id));
 const g=f.gen||!f.sups.length;
 return `${f.gen?'':`<div class="hs-tg">${f.sups.map(s=>`<button type="button" class="chip on" data-a="hsSupRm" data-id="${esc(s.id)}" aria-label="הסר ${esc(s.name)}">${esc(s.name)} ✕</button>`).join('')}</div>
 ${f.auto&&!f.touched&&f.sups.length?'<p class="note" style="margin:2px 0">זוהה אוטומטית לפי המלאי, חשבוניות והזמנות קודמות – אפשר לשנות או להוסיף.</p>':''}
 ${L.length?`<select data-c="hsSupPick" aria-label="הוספת ספק" style="margin:4px 0"><option value="">＋ הוספת ספק…</option>${L.map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select>`:(supList().length?'':'<p class="note">אין ספקים מוגדרים במערכת.</p>')}`}
 <label class="opt" style="margin:6px 0"><span>פריט כללי – מופיע לכל הספקים</span><input type="checkbox" data-c="hsGen"${f.gen?' checked':''}></label>
 ${g?'<span class="tag t1">יישמר כפריט כללי – מופיע לכל הספקים</span>':''}`}
function sugPaint(){const f=HS.f;if(!f||cur().v!=='hsEd')return;const S=sugList();
 /* זיהוי אוטומטי: כל עוד המשתמש לא שינה ספקים בעצמו – הספקים המוצעים נבחרים (עד 3) */
 if(!f.touched&&!f.id&&!f.gen&&f.pkN!==f.n){const nw=S.slice(0,3).map(s=>({id:s.id,name:s.name}));if(JSON.stringify(nw)!==JSON.stringify(f.sups)){f.sups=nw;f.auto=nw.length>0;const e=document.getElementById('hsSups');if(e)e.innerHTML=supsH()}}
 const e=document.getElementById('hsSug');if(e)e.innerHTML=sugH(S)}
function imgPaint(){const f=HS.f,e=document.getElementById('hsImgP');if(!f||!e)return;const du=f.img||(!f.imgDel&&f.id&&f.np?HS.img[f.id]:'');
 e.innerHTML=du?`<div class="row" style="align-items:center;margin:6px 0"><button type="button" class="hs-thb" data-a="hsImgBig" aria-label="הגדלה ושיתוף של התמונה"><img class="hs-th" src="${esc(du)}" alt="תמונת המוצר"></button><button type="button" class="btn g s" data-a="hsImgRm">הסר תמונה</button></div>`:(f.np&&!f.imgDel&&!f.img?'<p class="note">טוען תמונה…</p>':'')}
V.hsEd=id=>{const T=id?'עריכת חוסר':'חוסר חדש';const f=HS.f;if(!on()||!f||(f.id||'')!==(id||''))return{t:T,h:'<div class="empty">המסך הזה לא זמין. חזרו לרשימת החוסרים.</div>'};
 const w=(v,l)=>`<button type="button" class="chip${f.why===v?' on':''}" data-a="hsWhy" data-v="${v}" aria-pressed="${f.why===v}">${l}</button>`;
 const oc=ordOn()&&window.__oc&&typeof window.__ocLoad==='function';
 const cust=f.custOn?`<div class="row" style="gap:8px"><label class="f grow"><span>שם הלקוח</span><input data-i="hsCN" maxlength="60" value="${esc(f.cust.nm||'')}" autocomplete="off"></label><label class="f grow"><span>טלפון</span><input data-i="hsCP" type="tel" inputmode="tel" maxlength="20" value="${esc(f.cust.ph||'')}" autocomplete="off"></label></div>${oc?'<button type="button" class="btn g s w" data-a="hsCustPick">בחירת לקוח מהמערכת</button>':''}`:'';
 const ord=ordOn()&&f.why!=='store'?`<div style="margin-top:8px">${f.ord?`<div class="row" style="align-items:center"><span class="tag grow">מקושר להזמנה #${esc(f.ord.no||'')}</span><button type="button" class="btn g s" data-a="hsOrdRm">הסר קישור</button></div>`:'<button type="button" class="btn g s w" data-a="hsOrdPick">קישור להזמנת לקוח</button>'}</div>`:'';
 setTimeout(imgPaint,0);/* התמונה (קיימת או חדשה) מצוירת אחרי שהטופס נכנס למסך */
 return{t:T,h:`<form class="card" data-f="hsSave" autocomplete="off">
 <label class="f"><span>שם המוצר</span><input data-i="hsN" maxlength="80" value="${esc(f.n)}" placeholder="למשל: חלב 3% ליטר" required></label>
 <div id="hsSug">${sugH(sugList())}</div>
 <div class="sec" style="margin-top:6px"><b>ספקים</b></div><div id="hsSups">${supsH()}</div>
 <div class="sec" style="margin-top:8px"><b>בשביל מה?</b></div><div class="hs-tg">${w('store','לחנות')}${w('order','להזמנה')}${w('both','שניהם')}</div>
 <label class="f" style="margin-top:8px"><span>כמות (רשות)</span><input data-i="hsQ" inputmode="decimal" maxlength="9" value="${esc(f.q)}" placeholder="למשל 6"></label>
 <label class="opt" style="margin:8px 0"><span>לקוח ביקש</span><input type="checkbox" data-c="hsCustOn"${f.custOn?' checked':''}></label>${cust}${ord}
 <div class="sec" style="margin-top:8px"><b>תמונה (רשות)</b></div><div id="hsImgP"></div>
 <div class="row"><label class="btn g grow" style="cursor:pointer">צילום<input type="file" accept="image/*" capture="environment" data-c="hsFile" hidden></label><label class="btn g grow" style="cursor:pointer">מהגלריה<input type="file" accept="image/*" data-c="hsFile" hidden></label></div>
 <button class="btn w" style="margin-top:12px"${f.busy?' disabled':''}>${f.busy?'שומר…':'שמירה'}</button></form>`}};
INP.hsN=el=>{const f=HS.f;if(!f)return;f.n=el.value;clearTimeout(HS.st);HS.st=setTimeout(sugPaint,250)};
INP.hsQ=el=>{if(HS.f)HS.f.q=el.value};
INP.hsCN=el=>{if(HS.f){HS.f.cust.nm=el.value;delete HS.f.cust.cid}};
INP.hsCP=el=>{if(HS.f){HS.f.cust.ph=el.value;delete HS.f.cust.cid}};
const supsRe=()=>{const e=document.getElementById('hsSups');if(e)e.innerHTML=supsH();sugPaint()};
ACT.hsSupAdd=el=>{const f=HS.f,id=el.dataset.id;if(!f||!idOk(id)||f.sups.some(x=>x.id===id))return;if(f.sups.length>=C.MAXS)return toast('אפשר עד '+C.MAXS+' ספקים');f.touched=true;f.sups.push({id,name:supName(id)||String(el.dataset.n||'').slice(0,60)||id});supsRe()};
ACT.hsSupRm=el=>{const f=HS.f;if(!f)return;f.touched=true;f.sups=f.sups.filter(x=>x.id!==el.dataset.id);supsRe()};
CHG.hsSupPick=el=>{const f=HS.f,id=el.value;if(!f||!idOk(id))return;if(f.sups.length>=C.MAXS)return toast('אפשר עד '+C.MAXS+' ספקים');f.touched=true;if(!f.sups.some(x=>x.id===id))f.sups.push({id,name:supName(id)||id});supsRe()};
CHG.hsGen=el=>{const f=HS.f;if(!f)return;f.gen=el.checked;f.touched=true;supsRe()};
ACT.hsWhy=el=>{const f=HS.f;if(!f||!C.WHY.includes(el.dataset.v))return;f.why=el.dataset.v;rerender()};
CHG.hsCustOn=el=>{const f=HS.f;if(!f)return;f.custOn=el.checked;rerender()};
ACT.hsOrdRm=()=>{if(HS.f){HS.f.ord=null;rerender()}};
ACT.hsImgRm=()=>{const f=HS.f;if(!f)return;f.img=null;if(f.np)f.imgDel=true;imgPaint()};
CHG.hsFile=async el=>{const fl=el.files&&el.files[0];el.value='';const f=HS.f;if(!fl||!f)return;if(fl.type&&!/^image\//.test(fl.type))return toast('אפשר לצרף תמונה בלבד');
 toast('מכין את התמונה…');try{const du=await shrink(await rdU(fl));if(!imgOk(du))throw 0;f.img=du;f.imgDel=false;imgPaint()}catch(e){toast('תמונה לא תקינה או גדולה מדי')}};
/* בחירת לקוח קיים (מסך הלקוחות של ההזמנות) */
const custRows=()=>{const oc=window.__oc,q=String(HS.cq||'').trim().toLowerCase(),d=digits(q);
 const L=((oc&&oc.L)||[]).filter(c=>!q||String(c.name||'').toLowerCase().includes(q)||(d&&digits(c.phone).includes(d))).slice(0,40);
 return L.length?L.map(c=>`<button type="button" class="li" data-a="hsCustSel" data-id="${esc(c.id)}"><div class="m"><b>${esc(c.name||'')}</b><small>${esc(c.phone||'')}</small></div></button>`).join(''):'<p class="note">לא נמצאו לקוחות</p>'};
ACT.hsCustPick=async()=>{const oc=window.__oc;if(!oc||typeof window.__ocLoad!=='function')return toast('רשימת הלקוחות לא זמינה');
 if(!oc.L){toast('טוען לקוחות…');try{await window.__ocLoad()}catch(e){}}if(!oc.L)return toast('רשימת הלקוחות לא נטענה');HS.cq='';
 dlg(`<h3>בחירת לקוח</h3><label class="f"><span>חיפוש</span><input data-i="hsCq" placeholder="שם או טלפון" autocomplete="off"></label><div id="hsCl" style="max-height:50vh;overflow:auto">${custRows()}</div><button type="button" class="btn g w" data-a="closeDlg" style="margin-top:8px">ביטול</button>`)};
INP.hsCq=el=>{HS.cq=el.value;const e=document.getElementById('hsCl');if(e)e.innerHTML=custRows()};
ACT.hsCustSel=el=>{const f=HS.f,c=((window.__oc&&window.__oc.L)||[]).find(x=>x.id===el.dataset.id);if(!f||!c)return;
 f.cust={nm:String(c.name||'').slice(0,60),ph:digits(c.phone).slice(0,15)};if(idOk(c.id))f.cust.cid=c.id;f.custOn=true;closeDlg();rerender()};
/* קישור להזמנת לקוח פתוחה */
const OPEN=['new','work','wait_pay'];
ACT.hsOrdPick=async()=>{const O=window.__ox;if(!O||!ordOn())return toast('ההזמנות לא זמינות');
 if(!O.L){toast('טוען הזמנות…');try{V.ox()}catch(e){}for(let i=0;i<40&&!O.L;i++)await new Promise(r=>setTimeout(r,150))}
 const L=(O.L||[]).filter(o=>OPEN.includes(o.status)&&idOk(String(o.id||''))).slice(0,60);
 dlg(`<h3>קישור להזמנה</h3><div style="max-height:55vh;overflow:auto">${L.length?L.map(o=>`<button type="button" class="li" data-a="hsOrdSel" data-id="${esc(o.id)}"><div class="m"><b>#${esc(o.no||'')} · ${esc(o.cust&&o.cust.name||'')}</b><small>${esc(tm(o.at))}</small></div></button>`).join(''):'<p class="note">אין הזמנות פתוחות</p>'}</div><button type="button" class="btn g w" data-a="closeDlg" style="margin-top:8px">ביטול</button>`)};
ACT.hsOrdSel=el=>{const f=HS.f,o=((window.__ox&&window.__ox.L)||[]).find(x=>x.id===el.dataset.id);if(!f||!o)return;
 f.ord={id:o.id,no:Number.isInteger(+o.no)?+o.no:0};
 if(!f.custOn&&o.cust&&(o.cust.name||o.cust.phone)){f.cust={nm:String(o.cust.name||'').slice(0,60),ph:digits(o.cust.phone).slice(0,15)};if(idOk(String(o.custId||'')))f.cust.cid=o.custId;f.custOn=true}
 closeDlg();rerender()};
/* שמירה. mk – יצירת פריט חדש מתוצאת C.build (גם מהחלון שאחרי הליקוט) */
async function mk(d,np){const id='h'+uid(),x=Object.assign({},d,{np:np?1:0,st:'open',by:SY.uid,byN:fbBy().slice(0,100),t:Date.now()});
 await fsx('/hsr?documentId='+encodeURIComponent(id),{method:'POST',body:JSON.stringify({fields:flds(x)})});x.id=id;return x}
FRM.hsSave=async()=>{const f=HS.f;if(!f||f.busy||!on())return;
 const r=C.build({n:f.n,sups:f.sups,gen:f.gen,why:f.why,q:f.q,cust:f.custOn?f.cust:null,ord:f.why!=='store'?f.ord:null},PM());if(!r.ok)return toast(r.err);
 const me=fbBy().slice(0,100),old=f.id?find(f.id):null,np=f.img?1:f.imgDel?0:(old&&old.np?1:0);
 f.busy=1;rerender();let id=f.id,x;
 try{if(!id){x=await mk(r.d,np);id=x.id}
  else{if(!old)throw new Error('הפריט לא נמצא. רעננו את הרשימה.');const d=Object.assign({},r.d,{np,ub:me,ut:nextUt(old)});
   await fsx('/hsr/'+id+'?'+mask(['n','nk','gen','sups','supN','why','q','cust','ord','np','ub','ut']),{method:'PATCH',body:JSON.stringify({fields:flds(d)})});
   ['q','cust','ord'].forEach(k=>{if(!(k in d))delete old[k]});x=Object.assign(old,d)}}
 catch(e){f.busy=0;rerender();return err(e)}
 /* תמונה: החלפה = מחיקה + יצירה. כשל – הפריט נשמר, מסמנים שאין תמונה */
 let imgErr=false;
 try{if(old&&old.np&&(f.img||f.imgDel)){try{await fsx('/hsr/'+id+'/p/1',{method:'DELETE'})}catch(e){if(e.code!==404)throw e}delete HS.img[id]}
  if(f.img){await fsx('/hsr/'+id+'/p/1',{method:'PATCH',body:JSON.stringify({fields:{img:sv(f.img),t:iv(Date.now()),uid:sv(SY.uid)}})});HS.img[id]=f.img}}
 catch(e){imgErr=true;try{const ut=nextUt(x);await fsx('/hsr/'+id+'?'+mask(['np','ub','ut']),{method:'PATCH',body:JSON.stringify({fields:flds({np:0,ub:me,ut})})});x.np=0;x.ub=me;x.ut=ut}catch(e2){}}
 if(!f.id&&HS.L)HS.L=[x].concat(HS.L);
 HS.f=null;tilePaint();toast(imgErr?'הפריט נשמר, אבל התמונה לא עלתה':'נשמר');goBack()};

/* ---------- שליחה לספק: וואטסאפ (טלפון נשמר בפעם הראשונה), קובץ להדפסה ושיתוף ---------- */
async function phGet(id){if(!idOk(id))return '';if(id in HS.ph)return HS.ph[id];try{const d=DEC(await fsx('/hsph/'+id));HS.ph[id]=typeof d.ph==='string'?d.ph:''}catch(e){HS.ph[id]=''}return HS.ph[id]}
function phDlg(g,send){dlg(`<h3>הטלפון של ${esc(g.name)}</h3><p class="note">נשמר לפעם הבאה, לכל הצוות.</p><label class="f"><span>טלפון (וואטסאפ)</span><input id="hsPh" type="tel" inputmode="tel" maxlength="20" value="${esc(HS.ph[g.id]||'')}" autocomplete="off"></label>
 <div class="row"><button type="button" class="btn grow" data-a="hsPhSave" data-id="${esc(g.id)}" data-send="${send?1:''}">${send?'שמירה ושליחה':'שמירה'}</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div>`)}
const waSend=(g,ph)=>window.open('https://wa.me/'+C.intl(ph)+'?text='+encodeURIComponent(C.waText(g,'')),'_system');
/* פריטים שכבר הוזמנו (od) לא נשלחים לאף ספק – לא בוואטסאפ ולא בקובץ */
const noSend=g=>{if(C.split(g.L).need.length||g.O.length)return '';return g.L.length?'כל הפריטים לספק הזה כבר הוזמנו':''};
ACT.hsWa=async el=>{const g=HS.G[el.dataset.id];if(!g||!idOk(g.id))return;const ns=noSend(g);if(ns)return toast(ns);if(!g.L.length&&!g.O.length)return toast('אין פריטים לשלוח לספק הזה');
 const ph=await phGet(g.id);if(ph&&C.phOk(ph))return waSend(g,ph);phDlg(g,true)};
/* 22.11.2026: "צור משימת הזמנה" – טופס "משימה חדשה" ממולא מראש (tasks-wc.js: TKW.prefill), יעד מוצע היום. מנהל בלבד, כשתוספת המשימות פעילה. בלי כתיבה מכאן */
const tkOk=()=>{try{return !!(window.TKW&&typeof TKW.pfOk==='function'&&TKW.pfOk())}catch(e){return false}};
ACT.hsTk=el=>{const g=HS.G[el.dataset.id];if(!g||!tkOk())return;const N=C.split(g.L).need.map(r=>r.it.n+(r.it.q?' ×'+C.fmtQ(r.it.q):''));if(!N.length)return toast('כל הפריטים לספק הזה כבר הוזמנו');
 TKW.prefill('להזמין מ'+g.name+': '+N.slice(0,6).join(', ')+(N.length>6?' ועוד '+(N.length-6):''),{dk:'td'})};
ACT.hsPhEd=el=>{const g=HS.G[el.dataset.id];if(g&&idOk(g.id))phDlg(g,false)};
ACT.hsPhSave=async el=>{const g=HS.G[el.dataset.id],i=document.getElementById('hsPh');if(!g||!i||!idOk(g.id))return;/* המזהה נכנס לנתיב – רק תבנית מותרת */const v=i.value;if(!C.phOk(v))return toast('מספר טלפון לא תקין');
 const ph=C.intl(v),send=!!el.dataset.send;el.disabled=true;
 try{await fsx('/hsph/'+g.id,{method:'PATCH',body:JSON.stringify({fields:flds({ph,n:String(g.name||'').slice(0,60),byN:fbBy().slice(0,100),t:Date.now()})})});toast('הטלפון נשמר')}
 catch(e){toast(e&&e.code===403?'הטלפון לא נשמר (החוסרים יופעלו בקרוב)':'הטלפון לא נשמר: '+tkErr(e))}
 HS.ph[g.id]=ph;closeDlg();if(send)waSend(g,ph);else if(cur().v==='hs')rerender()};
/* קובץ: עמודי A4 (תמונה) ← PDF (mkScanPdf) ← שיתוף / הדפסה. בלי פרטי לקוחות */
function pdfPages(g){const W=1240,H=1754,M=90,LH=60,out=[];let c,x,y;
 const np=()=>{c=document.createElement('canvas');c.width=W;c.height=H;x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,W,H);x.fillStyle='#111';x.direction='rtl';x.textAlign='right';y=M;out.push(c)};
 const fit=(t,mw)=>{if(x.measureText(t).width<=mw)return t;while(t.length>1&&x.measureText(t+'…').width>mw)t=t.slice(0,-1);return t+'…'};
 np();x.font='bold 54px Arial, sans-serif';x.fillText(fit('רשימת הזמנה – '+g.name,W-2*M),W-M,y+50);y+=90;
 x.font='32px Arial, sans-serif';x.fillStyle='#555';x.fillText(new Date().toLocaleDateString('he-IL'),W-M,y+30);y+=70;x.fillStyle='#111';
 const rows=C.split(g.L).need.map(r=>'• '+r.it.n+(r.it.q?' – כמות '+C.fmtQ(r.it.q):'')).concat(g.O.map(o=>'• '+String(o.n||'')+(typeof o.qty==='number'?' – כמות '+C.fmtQ(o.qty):'')));
 x.font='40px Arial, sans-serif';rows.forEach(t=>{if(y+LH>H-M){np();x.font='40px Arial, sans-serif'}x.fillText(fit(t,W-2*M),W-M,y+44);y+=LH});
 return out.map(cv=>cv.toDataURL('image/jpeg',.85))}
ACT.hsPdf=async el=>{const g=HS.G[el.dataset.id],k=el.dataset.k;if(!g||!idOk(g.id))return;const ns=noSend(g);if(ns)return toast(ns);if(!g.L.length&&!g.O.length)return toast('אין פריטים לספק הזה');
 toast('מכין קובץ…');
 try{const pdf=await mkScanPdf(pdfPages(g)),name='LargePami_order_'+new Date().toISOString().slice(0,10)+'.pdf',Cp=window.Capacitor,nat=Cp&&Cp.isNativePlatform&&Cp.isNativePlatform();
  if(k==='print'){if(nat&&Cp.Plugins.PdfPrint){let s='';for(let i=0;i<pdf.length;i+=8192)s+=String.fromCharCode.apply(null,pdf.subarray(i,i+8192));await Cp.Plugins.PdfPrint.print({name,data:btoa(s)})}else window.open(URL.createObjectURL(new Blob([pdf],{type:'application/pdf'})),'_blank')}
  else await outSave({name,data:pdf,mime:'application/pdf'},'share')}
 catch(e){toast('הקובץ לא נוצר: '+(e&&e.message||e))}};

/* ---------- שלב 2 (19.11.2026): הורדה אוטומטית בקליטת חשבונית ספק ----------
   pricing.js קורא ל-window.hsOnInv אחרי piCreate מוצלח (פעם אחת לחשבונית), בלי לחכות – כשל כאן לא נוגע בקליטת החשבונית.
   ההתאמה (HsCore.matchInv) מחמירה: עדיף לפספס. כל פריט מתעדכן עם תנאי גרסה (currentDocument.updateTime) – שני מכשירים לא דורסים זה את זה;
   אותה חשבונית לא מטופלת פעמיים (pinv בהיסטוריה). המנהל משלים בפתיחת המסך חשבוניות שנקלטו ולא טופלו (invFill, מתוך xBuild).
   ביטול: "בטל" בהודעה, "החזר לחוסרים" (הגיע כולו) או "בטל הגעה חלקית" (רשומת 'unp' שמחזירה את הכמות). */
let IQ=Promise.resolve();
const invQ=L=>{IQ=IQ.then(()=>invRun(L)).catch(()=>{});return IQ};
const qrunU=async sq=>{const r=await fsx(':runQuery',{method:'POST',body:JSON.stringify({structuredQuery:sq})});return(r||[]).filter(x=>x.document).map(x=>({x:DEC(x.document),u:x.document.updateTime||''}))};
function upLocal(x){HS.mv[x.id]=x;const t=x.st==='open'?'L':x.st;['L','arr','del'].forEach(k=>{const a=HS[k];if(!a)return;const i=a.findIndex(y=>y.id===x.id);if(k===t){if(i>=0)a[i]=x;else HS[k]=[x].concat(a)}else if(i>=0)a.splice(i,1)})}
async function invApply(r,m,d,again){const x=r.x,ut=nextUt(x),ub=fbBy().slice(0,100);
 const h=C.hAdd(x.h,C.invEntry(m,d,ut,ub,SY.uid)),f=m.k==='part'?{q:m.q,h,ub,ut}:{st:'arr',h,ub,ut};
 try{const j=await fsx('/hsr/'+x.id+'?'+mask(Object.keys(f))+(r.u?'&currentDocument.updateTime='+encodeURIComponent(r.u):''),{method:'PATCH',body:JSON.stringify({fields:flds(f)})});
  return{x:Object.assign({},x,f),u:j&&j.updateTime||''}}
 catch(e){/* הפריט השתנה בינתיים (תנאי הגרסה – 400, או הכללים דחו כי h כבר לא ההמשך – 403): קוראים מחדש, בודקים שעדיין פתוח ומתאים, ומנסים פעם אחת */
  if(again||!e||![400,403,409,412].includes(e.code))return null;
  try{const doc=await fsx('/hsr/'+x.id),y=DEC(doc);if(!valid(y))return null;const m2=C.matchInv([y],d,PM())[0];return m2?invApply({x:y,u:doc.updateTime||''},m2,d,1):null}catch(e2){return null}}}
async function invRun(L){if(!on()||!PM()||!Array.isArray(L)||!L.length)return;
 let R;try{R=await qrunU(stQ('open',500))}catch(e){return}
 const M=new Map(R.filter(r=>valid(r.x)).map(r=>[r.x.id,r])),done=[];let A=null;/* פריטים שהגיעו – רק אם יש התאמה, כדי שפריט שכבר ירד באותה חשבונית "יתפוס" את השורות שלו */
 for(const d of L){let ms=[];try{ms=C.matchInv([...M.values()].map(r=>r.x),d,PM());
   if(ms.length){if(!A){try{A=(await qrun(stQ('arr',300))).filter(valid)}catch(e){A=[]}}ms=C.matchInv([...M.values()].map(r=>r.x).concat(A.filter(a=>!M.has(a.id))),d,PM())}}catch(e){continue}
  for(const m of ms){const r=M.get(m.id);if(!r)continue;const w=await invApply(r,m,d);if(!w)continue;
   if(w.x.st==='open')M.set(w.x.id,w);else{M.delete(w.x.id);if(A)A=[w.x].concat(A.filter(a=>a.id!==w.x.id))}upLocal(w.x);done.push({id:w.x.id,n:w.x.n,k:m.k,q:m.q,inv:String(d.inv||'').slice(0,30)})}}
 if(!done.length)return;tilePaint();paint();invMsg(done)}
/* הודעה שלא חוסמת את המסך (גם כשחלון פתוח), עם "בטל" */
function invMsg(D){HS.bn=D;let e=document.getElementById('hsBn');if(!e){e=document.createElement('div');e.id='hsBn';e.className='card hs-bn';e.setAttribute('role','status');document.body.appendChild(e)}
 const invs=[...new Set(D.map(x=>x.inv).filter(Boolean))];
 e.innerHTML=`<b>ירדו מהחוסרים${invs.length?' (חשבונית '+esc(invs.join(', '))+')':''}:</b><div style="margin:6px 0">${D.map(x=>'• '+esc(x.n)+(x.k==='part'?` – הגיע חלקית, נשארו ${esc(C.fmtQ(x.q))}`:'')).join('<br>')}</div>
 <div class="row"><button type="button" class="btn g grow" data-a="hsInvUndo">בטל</button><button type="button" class="btn grow" data-a="hsBnX">סגור</button></div>`;
 clearTimeout(HS.bt);HS.bt=setTimeout(ACT.hsBnX,15000)}
ACT.hsBnX=()=>{const b=document.getElementById('hsBn');if(b)b.remove()};
async function unp(id){const x=find(id),q0=C.unpartQ(x);if(q0==null)return false;const ut=nextUt(x),ub=fbBy().slice(0,100),h=C.hAdd(x.h,{k:'unp',t:ut,byN:ub,u:SY.uid});
 try{await fsx('/hsr/'+id+'?'+mask(['q','h','ub','ut']),{method:'PATCH',body:JSON.stringify({fields:flds({q:q0,h,ub,ut})})})}catch(e){stErr(e);return false}
 Object.assign(x,{q:q0,h,ub,ut});upLocal(x);tilePaint();return true}
ACT.hsUnp=async el=>{if(el.disabled)return;el.disabled=true;if(await unp(el.dataset.id)){toast('הכמות הוחזרה');rerender()}else el.disabled=false};
ACT.hsInvUndo=async el=>{const D=HS.bn||[];if(el.disabled||!D.length)return;el.disabled=true;let n=0;
 for(const d of D){const x=find(d.id);if(!x)continue;if(d.k==='inv'?x.st==='arr'&&await setSt(d.id,'open','undo'):await unp(d.id))n++}
 HS.bn=null;ACT.hsBnX();toast(n===D.length?'בוטל – הפריטים חזרו לחוסרים':'בוטלו '+n+' מתוך '+D.length);paint()};
/* המנהל: חשבוניות חדשות מ-pinv (שכבר נקראו ב-xBuild) – רק מ-30 הימים האחרונים ולא מבוטלות */
function invFill(L){try{const cut=Date.now()-30*864e5,P=L.filter(p=>p&&idOk(String(p.id||''))&&p.st!=='void'&&+p.at>cut).map(p=>({id:p.id,sup:p.sup,supId:p.supId,inv:p.inv,at:+p.at,lines:p.lines}));if(P.length)invQ(P)}catch(e){}}
window.hsOnInv=d=>{try{if(!d||!idOk(String(d.id||''))||!on())return;const v={id:d.id,sup:d.sup,supId:d.supId,inv:d.inv,at:Date.now(),lines:d.lines};setTimeout(()=>invQ([v]),0)}catch(e){}};
/* ---------- 19.11.2026: אחרי "להזמין מספק" בליקוט – שואלים אם להוסיף גם לחוסרים (בקשת בעל הפרויקט: "שיהיה אפשרות לשאול, שהוא לא יכניס לבד") ----------
   ord-pick.js קורא ל-window.hsAskSo(o, rows) אחרי orderPick מוצלח, בלי לחכות (ההזמנה כבר נשמרה). o – ההזמנה ({id,no,cust,custId}); rows – [{n,qty,sup}].
   תוספת כבויה / 403 / כשל בטעינה – בלי חלון. פריט פתוח שכבר מקושר לאותה הזמנה ולאותו מוצר (nk) – לא מוצע שוב. הפריטים נבנים ב-C.build ונשמרים ב-mk (כמו "הוספת חוסר"). */
window.hsAskSo=async(o,rows)=>{try{
 if(!on()||!o||!idOk(String(o.id||''))||!Array.isArray(rows)||!rows.length)return;chk();
 let L;try{L=(await qrun(stQ('open',500))).filter(valid)}catch(e){if(e&&e.code===403)HS.off=1;return}
 HS.L=L.sort((a,b)=>(b.t||0)-(a.t||0));HS.at=Date.now();HS.off=0;tilePaint();
 const c=o.cust&&typeof o.cust==='object'?o.cust:{},ph=digits(c.phone),pOk=C.phOk(ph);
 const cust=String(c.name||'').trim()||pOk?{nm:String(c.name||'').slice(0,60),ph:pOk?ph.slice(0,15):''}:null;if(cust&&idOk(String(o.custId||'')))cust.cid=o.custId;
 const ord={id:o.id,no:Number.isInteger(+o.no)?+o.no:0},sups=supList(),k=v=>C.keyOf(String(v||'').trim(),PM());
 const seen=new Set(L.filter(x=>x.ord&&x.ord.id===o.id).map(x=>x.nk)),A=[];
 rows.forEach(r=>{if(!r)return;const sp=String(r.sup||'').trim(),sv0=sp?sups.find(x=>k(x.name)===k(sp)):null;
  const b=C.build({n:r.n,sups:sv0?[sv0]:[],gen:!sv0,why:'order',q:typeof r.qty==='number'&&r.qty>0&&r.qty<=1e5?r.qty:'',cust,ord},PM());
  if(!b.ok||seen.has(b.d.nk))return;seen.add(b.d.nk);A.push({d:b.d,sup:sv0?sv0.name:''})});
 if(!A.length)return;HS.ask={o:o.id,A};
 dlg(`<h3>להוסיף גם לרשימת החוסרים?</h3><p class="note">הזמנה #${esc(ord.no||'')} – מוצרים שסומנו "להזמין מספק". סמנו מה להוסיף.</p>
 <div style="max-height:50vh;overflow:auto">${A.map((a,i)=>`<label class="opt" style="margin:6px 0"><span style="min-width:0;overflow-wrap:anywhere"><b>${esc(a.d.n)}</b>${a.d.q?' · כמות '+esc(C.fmtQ(a.d.q)):''}<small style="display:block;color:var(--mut)">${a.sup?'ספק: '+esc(a.sup):'פריט כללי – מופיע לכל הספקים'}</small></span><input type="checkbox" data-hso="${i}" checked></label>`).join('')}</div>
 <div class="row" style="margin-top:10px"><button type="button" class="btn grow" data-a="hsSoAdd">הוסף</button><button type="button" class="btn g grow" data-a="hsSoNo">לא עכשיו</button></div>`)}catch(e){}};
ACT.hsSoNo=()=>{HS.ask=null;closeDlg()};
ACT.hsSoAdd=async el=>{const a=HS.ask;if(!a||el.disabled)return;
 const P=[...document.querySelectorAll('#dlg input[data-hso]')].filter(i=>i.checked).map(i=>a.A[+i.dataset.hso]).filter(Boolean);
 if(!P.length){HS.ask=null;closeDlg();return}
 el.disabled=true;HS.ask=null;let n=0;
 for(const p of P){try{const x=await mk(p.d,0);if(HS.L)HS.L=[x].concat(HS.L.filter(y=>y.id!==x.id));n++}catch(e){}}
 closeDlg();tilePaint();toast(n===P.length?(n===1?'נוסף לחוסרים':'נוספו '+n+' פריטים לחוסרים'):n?'נוספו '+n+' מתוך '+P.length+' לחוסרים':'לא נוסף לחוסרים (ההזמנה עצמה נשמרה)');paint()};
})();
