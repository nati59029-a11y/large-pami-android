/* AR:LEDGER – כרטיס חשבון לקוח, כרטסת, דוח חובות והגדרות תזכורות תשלום (משימה 2026-11-14_הזמנות-לקוח-עסקי-וחשבוניות, שלב 5). קובץ עצמאי, נטען אחרי ar-inv.js.
   בלי "מסמכים פעילים" (arcfg/main.on) – אין שום שינוי במסכים ואין שום שאילתה חדשה.
   - כרטיס הלקוח: כפתור "כרטיס חשבון וכרטסת" ← מסך arLed עם לשוניות: כל החשבוניות, פתוחות, קבלות, כרטסת (103). המסמכים נטענים רק בפתיחת המסך.
     כרטסת (104): תאריך, מסמך, חובה, זכות, יתרה מצטברת (ArCalc.ledger – אותו חישוב כמו cust.ar.bal בשרת), סינון לפי תאריכים וסוג מסמך.
     ייצוא PDF (arStatement בשרת) ו-Excel (ספריית xlsx הקיימת), ושליחה ללקוח במייל / ווטסאפ (105). מנהל: תזכורות ללקוח (כיבוי, ימים לפני) וסיכום חודשי אוטומטי.
   - דוח חובות (107, 109): כל החשבוניות הפתוחות (ardoc open>0), לפי לקוח, עם סינון לפי תאריכים, סוג מסמך ושם לקוח. Excel. מנהל ועובד עם הזמנות (106).
   - הגדרות (מנהל): "תזכורות תשלום" (arcfg/rem – setRemCfg): הפעלה, שעה, ימים לפני / אחרי, חזרה חודשית, תקרה יומית, נוסח, סיכום יומי, וסיכומי הימים האחרונים.
   כל כתיבה – דרך השרת (functions/ar.js). קריאה – ardoc / cust לפי החוקים הקיימים. */
(function(){
'use strict';
if(typeof ACT==='undefined'||typeof V==='undefined'||!window.__ox||!window.__arDocs||!window.ArCalc)return;
const AD=window.__arDocs,R=AD.R,AC=window.ArCalc;
const fnCall=(n,d)=>{d=d&&typeof d==='object'?d:{};if(SY&&SY.sa&&SY.bizId&&!('bizId'in d))d=Object.assign({bizId:SY.bizId},d);return window.fnCall(n,d)};
const on=()=>(isA()||isW()||!!(SY&&SY.sa))&&bzF('orders')&&wp('ord');
const mgr=()=>isA()||!!(SY&&SY.sa);
const live=()=>!!(R.cfg&&R.cfg.on);
const dec=d=>Object.assign({id:idOf(d)},Object.fromEntries(Object.entries(d.fields||{}).map(([k,v])=>[k,fvj(v)])));
const err=e=>toast(e&&e.message||'הפעולה נכשלה');
const rid=()=>{const a=new Uint8Array(12);crypto.getRandomValues(a);return 'r'+[...a].map(x=>x.toString(36).padStart(2,'0')).join('').slice(0,22)};
const ag=a=>ils((a||0)/100);
const dd=d=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d||''));return m?`${m[3]}/${m[2]}/${m[1].slice(2)}`:''};
const TN={inv:'חשבונית מס',ir:'חשבונית מס קבלה',rc:'קבלה',cr:'זיכוי'};
const redraw=v=>{const a=document.activeElement;if(cur().v===v&&!(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))&&!document.querySelector('#dlg[open]'))rerender()};
const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Jerusalem'});
const lateOf=due=>{if(!due)return 0;const a=Date.parse(due+'T00:00:00Z'),b=Date.parse(today()+'T00:00:00Z');return Math.round((b-a)/864e5)};
async function runQ(coll,f,lim){const sq={from:[{collectionId:coll}],limit:lim||500};if(f)sq.where={fieldFilter:{field:{fieldPath:f[0]},op:f[1],value:f[2]}};
 const r=await fsx(':runQuery',{method:'POST',body:JSON.stringify({structuredQuery:sq})});return(r||[]).filter(x=>x.document).map(x=>dec(x.document))}
const S={c:{},cu:{},tab:{},f:{},debt:undefined,df:{q:'',from:'',to:'',t:'inv'},rem:undefined};
const TABS=[['all','חשבוניות'],['open','פתוחות'],['rc','קבלות'],['led','כרטסת']];

/* ---------- כרטיס הלקוח: כניסה לכרטיס החשבון ---------- */
{const f=V.ocCard;if(f)V.ocCard=id=>{const r=f(id);try{if(!r||!r.h||!on()||!live())return r;
 r.h+=`<button class="btn g w" style="margin-top:8px" data-a="go" data-v="arLed" data-arg="${esc(id)}">כרטיס חשבון וכרטסת</button>`}catch(e){}return r}}

/* ---------- כרטיס חשבון: לשוניות ---------- */
async function loadC(cid){try{const [L,c]=await Promise.all([runQ('ardoc',['cust','EQUAL',{stringValue:cid}],1000),fsx('/cust/'+cid).catch(()=>null)]);S.c[cid]=L;S.cu[cid]=c?dec(c):{}}catch(e){S.c[cid]=[];S.cu[cid]=S.cu[cid]||{}}}
function rowL(x){const sg=x.t==='cr'||x.t==='rc'?-1:1;const h=window.__arInv&&window.__arInv.rowH;if(h)return h(x);
 return `<div class="li"><div class="grow"><b>${esc(TN[x.t]||x.t)} #${esc(x.no)}</b><br><small class="note">${dd(x.d)}</small></div><b dir="ltr">${ag(sg*x.gross)}</b></div>`}
function ledH(cid,L){const f=S.f[cid]||{},lg=AC.ledger(L,f.from||'',f.to||'');const rows=lg.rows.filter(r=>!f.t||f.t===r.t||(f.t==='inv'&&r.t==='ir'));
 const td='style="padding:6px 4px;white-space:normal"',tn='class="n" style="padding:6px 4px"';
 return `<form class="card" data-f="arLedF"><input type="hidden" name="cid" value="${esc(cid)}"><div class="row" style="gap:6px;align-items:end"><label class="f grow" style="margin:0"><span>מתאריך</span><input type="date" name="from" value="${esc(f.from||'')}"></label><label class="f grow" style="margin:0"><span>עד תאריך</span><input type="date" name="to" value="${esc(f.to||'')}"></label></div>
  <div class="row" style="gap:6px;align-items:end;margin-top:6px"><label class="f grow" style="margin:0"><span>סוג מסמך</span><select name="t"><option value="">הכול</option><option value="inv"${f.t==='inv'?' selected':''}>חשבוניות</option><option value="rc"${f.t==='rc'?' selected':''}>קבלות</option><option value="cr"${f.t==='cr'?' selected':''}>זיכויים</option></select></label><button class="btn g">סינון</button></div></form>
  <div class="tw" id="arled"><table style="font-size:.78rem;table-layout:fixed"><thead><tr><th ${td}>תאריך</th><th ${td}>מסמך</th><th ${tn}>חובה</th><th ${tn}>זכות</th><th ${tn}>יתרה</th></tr></thead><tbody>
  ${f.from?`<tr><td ${td}>${dd(f.from)}</td><td ${td}>יתרת פתיחה</td><td ${tn}></td><td ${tn}></td><td ${tn} dir="ltr">${ag(lg.open)}</td></tr>`:''}
  ${rows.map(r=>`<tr><td ${td}>${dd(r.d)}</td><td ${td}>${esc((TN[r.t]||'')+' '+r.no)}</td><td ${tn} dir="ltr">${r.dr?ag(r.dr):''}</td><td ${tn} dir="ltr">${r.cr?ag(r.cr):''}</td><td ${tn} dir="ltr">${ag(r.bal)}</td></tr>`).join('')||`<tr><td colspan="5" ${td}>אין תנועות בטווח</td></tr>`}
  </tbody></table></div><p class="note" style="margin:6px 0">סה״כ חובה ${ag(lg.dr)} · סה״כ זכות ${ag(lg.cr)} · יתרה לסוף התקופה <b dir="ltr">${ag(lg.end)}</b></p>
  <div class="row"><button class="btn g grow" data-a="arLedPdf" data-id="${esc(cid)}">PDF</button><button class="btn g grow" data-a="arLedXls" data-id="${esc(cid)}">Excel</button><button class="btn g grow" data-a="arLedSend" data-id="${esc(cid)}">שליחה ללקוח</button></div>`}
V.arLed=cid=>{const T='כרטיס חשבון';if(!on())return{t:T,h:'<div class="empty">אין לך הרשאה להזמנות</div>'};
 if(R.cfg===undefined){AD.cfgL().then(()=>redraw('arLed'));return{t:T,h:'<div class="empty">טוען…</div>'}}
 if(!live())return{t:T,h:'<div class="empty">מסמכים ללקוח כבויים</div>'};
 if(!cid)return{t:T,h:'<div class="empty">לא נבחר לקוח</div>'};
 if(S.c[cid]===undefined){S.c[cid]=null;loadC(cid).then(()=>redraw('arLed'));return{t:T,h:'<div class="empty">טוען…</div>'}}
 if(S.c[cid]===null)return{t:T,h:'<div class="empty">טוען…</div>'};
 const L=S.c[cid],c=S.cu[cid]||{},a=c.ar||{},tab=S.tab[cid]||'all',nm=c.bn||c.name||'';
 const open=L.filter(x=>x.t==='inv'&&x.open>0&&!x.void);
 let h=`<div class="card"><b>${esc(nm)}</b><div class="row" style="justify-content:space-between;margin-top:6px"><span>יתרה לתשלום</span><b dir="ltr" id="arbal">${ag(a.bal||0)}</b></div>
  <p class="note" style="margin:4px 0 0">${open.length} חשבוניות פתוחות${a.cr>0?' · יתרת זכות '+ag(a.cr):''}${open.length&&lateOf(open.map(x=>x.dueX||x.due).sort()[0])>0?' · <b style="color:var(--bad)">באיחור</b>':''}</p></div>
  <div class="chips scroll-x nw" role="tablist" style="margin:8px 0">${TABS.map(([k,l])=>`<button class="chip ${tab===k?'on':''}" role="tab" aria-selected="${tab===k}" data-a="arLedT" data-id="${esc(cid)}" data-k="${k}">${l}</button>`).join('')}</div>`;
 if(tab==='led')h+=ledH(cid,L);
 else{const P=tab==='open'?open:tab==='rc'?L.filter(x=>x.t==='rc'):L.filter(x=>['inv','ir','cr'].includes(x.t));
  h+=P.length?P.slice().sort((x,y)=>(y.at||0)-(x.at||0)).slice(0,200).map(rowL).join(''):'<div class="empty">אין מסמכים</div>'}
 if(mgr()){const rm=c.rem||{};h+=`<div class="sec"><h3>תזכורות וסיכום חודשי ללקוח</h3></div><form class="card" data-f="arCRemF"><input type="hidden" name="cid" value="${esc(cid)}">
  <label class="row" style="gap:8px;align-items:center;min-height:44px"><input type="checkbox" name="on"${rm.on===false?'':' checked'}> תזכורות תשלום ללקוח</label>
  <label class="f"><span>ימים לפני המועד (ריק = לפי הגדרות העסק)</span><input name="b" inputmode="numeric" value="${Number.isInteger(rm.b)?rm.b:''}" dir="ltr"></label>
  <label class="row" style="gap:8px;align-items:center;min-height:44px"><input type="checkbox" name="invM"${c.invM?' checked':''}> סיכום חודשי אוטומטי ללקוח</label>
  <button class="btn w">שמור</button></form>`}
 return{t:T,s:nm,h}};
ACT.arLedT=el=>{S.tab[el.dataset.id]=el.dataset.k;rerender()};
FRM.arLedF=f=>{const x=fd(f);if(x.from&&x.to&&x.from>x.to)return toast('טווח תאריכים לא תקין');S.f[x.cid]={from:x.from||'',to:x.to||'',t:x.t||''};rerender()};
ACT.arLedPdf=async el=>{const cid=el.dataset.id,f=S.f[cid]||{};el.disabled=true;try{const r=await fnCall('arStatement',Object.assign({cust:cid},f.from?{from:f.from}:{},f.to?{to:f.to}:{}));await dxShareDU('data:application/pdf;base64,'+r.b64,'כרטסת')}catch(e){err(e)}finally{el.disabled=false}};
ACT.arLedXls=el=>{const cid=el.dataset.id,f=S.f[cid]||{},L=S.c[cid]||[],lg=AC.ledger(L,f.from||'',f.to||''),c=S.cu[cid]||{};
 const rows=[['תאריך','מסמך','מספר','חובה','זכות','יתרה']];if(f.from)rows.push([f.from,'יתרת פתיחה','','','',lg.open/100]);
 lg.rows.filter(r=>!f.t||f.t===r.t||(f.t==='inv'&&r.t==='ir')).forEach(r=>rows.push([r.d,TN[r.t]||r.t,r.no,r.dr/100,r.cr/100,r.bal/100]));
 xlsOrCsv('כרטסת-'+String(c.bn||c.name||cid).replace(/[\\/:*?"<>|]/g,'').slice(0,40),{'כרטסת':rows})};
ACT.arLedSend=el=>{const cid=el.dataset.id;dlg(`<h3>שליחת כרטסת ללקוח</h3><form data-f="arLedSF"><input type="hidden" name="cid" value="${esc(cid)}"><input type="hidden" name="q" value="${rid()}">
  <label class="row" style="gap:8px;align-items:center;min-height:44px"><input type="radio" name="what" value="led" checked> כרטסת (לפי הסינון)</label><label class="row" style="gap:8px;align-items:center;min-height:44px"><input type="radio" name="what" value="open"> פירוט יתרה פתוחה בלבד</label>
  <div class="row"><button class="btn grow" name="ch" value="mail">מייל</button><button class="btn g grow" name="ch" value="wa">ווטסאפ</button></div><button type="button" class="btn g w" style="margin-top:8px" data-a="closeDlg">ביטול</button></form>`)};
FRM.arLedSF=async(f,ev)=>{const x=fd(f),s=ev&&ev.submitter,ch=(s&&s.value)||'mail',fl=S.f[x.cid]||{};const p={cust:x.cid,ch,reqId:x.q};if(x.what==='open')p.open=true;else{if(fl.from)p.from=fl.from;if(fl.to)p.to=fl.to}
 for(const b of f.querySelectorAll('button'))b.disabled=true;try{const r=await fnCall('arStatement',p);closeDlg();const s0=(r.sent||[])[0];toast(s0&&s0.ok?'נשלח':'לא נשלח'+(s0&&s0.why?' ('+s0.why+')':''))}catch(e){for(const b of f.querySelectorAll('button'))b.disabled=false;err(e)}};
FRM.arCRemF=async f=>{const x=fd(f),b=f.querySelector('button');const bv=String(x.b||'').trim();if(bv&&!(/^\d+$/.test(bv)&&+bv<=60))return toast('ימים לפני: 0–60');
 b.disabled=true;try{await fnCall('setRemCfg',{cust:x.cid,rem:bv?{on:!!x.on,b:+bv}:{on:!!x.on},invM:!!x.invM});S.c[x.cid]=undefined;try{R.c[x.cid]=undefined}catch(e){}toast('נשמר');rerender()}catch(e){err(e)}finally{b.disabled=false}};

/* ---------- דוח חובות (107, 109) ---------- */
{const f=V.ox;if(f)V.ox=()=>{const r=f();try{if(!r||!r.h||!on())return r;if(R.cfg===undefined){AD.cfgL().then(()=>redraw('ox'));return r}if(!live())return r;
 const b='<button class="btn g s w" style="margin-top:6px" data-a="go" data-v="arDebt">דוח חובות לקוחות</button>',k='data-v="oxStock">מלאי</button></div>',i=r.h.indexOf(k);
 r.h=i>=0?r.h.slice(0,i+k.length)+b+r.h.slice(i+k.length):r.h+b}catch(e){}return r}}
V.arDebt=()=>{const T='דוח חובות לקוחות';if(!on())return{t:T,h:'<div class="empty">אין לך הרשאה להזמנות</div>'};
 if(R.cfg===undefined){AD.cfgL().then(()=>redraw('arDebt'));return{t:T,h:'<div class="empty">טוען…</div>'}}
 if(!live())return{t:T,h:'<div class="empty">מסמכים ללקוח כבויים</div>'};
 if(S.debt===undefined){S.debt=null;runQ('ardoc',['open','GREATER_THAN',{integerValue:'0'}],3000).then(L=>{S.debt=L.filter(x=>!x.void);redraw('arDebt')},()=>{S.debt=[];redraw('arDebt')});return{t:T,h:'<div class="empty">טוען…</div>'}}
 if(S.debt===null)return{t:T,h:'<div class="empty">טוען…</div>'};
 const G=debtRows(),tot=G.reduce((s,g)=>s+g.open,0),q=S.df;
 const h=`<form class="card" data-f="arDebtF"><label class="f"><span>שם לקוח</span><input name="q" value="${esc(q.q)}" placeholder="חיפוש לפי שם"></label>
  <div class="row" style="gap:6px;align-items:end"><label class="f grow" style="margin:0"><span>מתאריך</span><input type="date" name="from" value="${esc(q.from)}"></label><label class="f grow" style="margin:0"><span>עד תאריך</span><input type="date" name="to" value="${esc(q.to)}"></label></div>
  <div class="row" style="gap:6px;align-items:end;margin-top:6px"><label class="f grow" style="margin:0"><span>סוג מסמך</span><select name="t"><option value="inv"${q.t==='inv'?' selected':''}>חשבוניות פתוחות (חוב)</option><option value="cr"${q.t==='cr'?' selected':''}>זכויות פתוחות (קבלות / זיכויים)</option></select></label><button class="btn g">סינון</button></div></form>
  <div class="card"><div class="row" style="justify-content:space-between"><span>${G.length} לקוחות</span><b dir="ltr" id="ardebt">${ag(tot)}</b></div></div>
  ${G.map(g=>`<button class="li" data-a="go" data-v="arLed" data-arg="${esc(g.cust)}"><div class="m"><b>${esc(g.name)}</b><small>${g.n} מסמכים${q.t==='inv'?' · הוותיק לתשלום עד '+dd(g.due)+(g.late>0?' · באיחור '+g.late+' ימים':''):''}</small></div><b class="a" dir="ltr">${ag(g.open)}</b></button>`).join('')||'<div class="empty">אין חובות פתוחים</div>'}
  ${G.length?'<button class="btn g w" style="margin-top:8px" data-a="arDebtXls">Excel</button>':''}<button class="btn g s w" style="margin-top:6px" data-a="arDebtRe">רענן</button>`;
 return{t:T,s:'חשבוניות פתוחות לפי לקוח',h}};
function debtRows(){const q=S.df,nq=String(q.q||'').trim().toLowerCase(),M=new Map();
 for(const x of S.debt||[]){const isInv=x.t==='inv';if(q.t==='inv'?!isInv:!['rc','cr'].includes(x.t))continue;if(q.from&&x.d<q.from)continue;if(q.to&&x.d>q.to)continue;
  const nm=String((x.custSnap&&x.custSnap.name)||x.cust||'');if(nq&&!nm.toLowerCase().includes(nq))continue;
  const k=x.cust||'?';const g=M.get(k)||{cust:k,name:nm,open:0,n:0,due:''};g.open+=x.open;g.n++;const du=x.dueX||x.due||'';if(isInv&&du&&(!g.due||du<g.due))g.due=du;M.set(k,g)}
 return [...M.values()].map(g=>Object.assign(g,{late:lateOf(g.due)})).sort((a,b)=>b.open-a.open)}
FRM.arDebtF=f=>{const x=fd(f);if(x.from&&x.to&&x.from>x.to)return toast('טווח תאריכים לא תקין');S.df={q:String(x.q||''),from:x.from||'',to:x.to||'',t:x.t==='cr'?'cr':'inv'};rerender()};
ACT.arDebtRe=()=>{S.debt=undefined;rerender()};
ACT.arDebtXls=()=>{const G=debtRows(),rows=[['לקוח','מסמכים פתוחים','סכום פתוח','הוותיק לתשלום עד','ימי איחור']];G.forEach(g=>rows.push([g.name,g.n,g.open/100,g.due,g.late>0?g.late:0]));xlsOrCsv('דוח-חובות-'+today(),{'חובות':rows})};

/* ---------- הגדרות: תזכורות תשלום (מנהל) ---------- */
const TXT0='שלום {שם},\nתזכורת ידידותית: לפי הרישומים שלנו יתרה פתוחה לתשלום בסך {סכום}.\n{פירוט}\nאם התשלום כבר בוצע – תודה, ואפשר להתעלם מההודעה.\n{קישור}\n{עסק}';
{const f=V.arCfg;if(f)V.arCfg=()=>{const r=f();try{if(r&&r.h&&on()&&mgr()&&live())r.h+=`<div class="row" style="margin-top:8px"><button class="btn g grow" data-a="go" data-v="arRemCfg">תזכורות תשלום</button><button class="btn g grow" data-a="go" data-v="arDebt">דוח חובות</button></div>`}catch(e){}return r}}
const WHY={'no-to':'אין מייל','no-secrets':'מייל לא מוגדר בשרת','no-smtp':'מייל לא מוגדר בשרת','rate':'מכסת מייל','send':'שליחה נכשלה','bad-to':'מייל לא תקין'};
V.arRemCfg=()=>{const T='תזכורות תשלום';if(!on()||!mgr())return{t:T,h:'<div class="empty">למנהל בלבד</div>'};
 if(R.cfg===undefined){AD.cfgL().then(()=>redraw('arRemCfg'));return{t:T,h:'<div class="empty">טוען…</div>'}}
 if(!live())return{t:T,h:'<div class="empty">קודם מפעילים "מסמכים פעילים" בהגדרות אישור הזמנה</div>'};
 if(S.rem===undefined){S.rem=null;fnCall('setRemCfg',{get:true}).then(r=>{S.rem=r||{cfg:{},sums:[]};redraw('arRemCfg')},e=>{S.rem={cfg:{},sums:[],err:1};redraw('arRemCfg')});return{t:T,h:'<div class="empty">טוען…</div>'}}
 if(S.rem===null)return{t:T,h:'<div class="empty">טוען…</div>'};
 const c=S.rem.cfg||{},st=Array.isArray(c.steps)?c.steps:[0,3,7,30];
 let h=`<form class="card" data-f="arRemF"><p class="note" style="margin-top:0">תזכורת נשלחת במייל ללקוח עם חשבונית פתוחה, רק ביום עסקים (לא בשישי, בשבת ובחג – עוברת ליום העסקים הבא). הודעה אחת ללקוח ביום, עם כל החשבוניות הפתוחות שלו. ווטסאפ – אחרי שתאושר תבנית ב-Meta.</p>
  <label class="row" style="gap:8px;align-items:center;min-height:44px"><input type="checkbox" name="on"${c.on?' checked':''}> <b>לשלוח תזכורות תשלום</b></label>
  <div class="row" style="gap:6px"><label class="f grow"><span>שעת שליחה</span><input name="hour" inputmode="numeric" value="${Number.isInteger(c.hour)?c.hour:9}" dir="ltr"></label><label class="f grow"><span>ימים לפני המועד</span><input name="b" inputmode="numeric" value="${Number.isInteger(c.b)?c.b:3}" dir="ltr"></label></div>
  <label class="f"><span>ימים אחרי המועד (0 = ביום המועד), מופרדים בפסיק</span><input name="steps" value="${esc(st.join(', '))}" dir="ltr"></label>
  <div class="row" style="gap:6px"><label class="f grow"><span>חזרה כל X ימים (0 = בלי)</span><input name="mon" inputmode="numeric" value="${Number.isInteger(c.mon)?c.mon:30}" dir="ltr"></label><label class="f grow"><span>תקרה יומית</span><input name="cap" inputmode="numeric" value="${Number.isInteger(c.cap)?c.cap:200}" dir="ltr"></label></div>
  <label class="f"><span>נוסח ההודעה – {שם} {סכום} {פירוט} {קישור} {עסק}</span><textarea name="txt" rows="7" maxlength="1500" placeholder="${esc(TXT0)}">${esc(c.txt||'')}</textarea></label>
  <label class="row" style="gap:8px;align-items:center;min-height:44px"><input type="checkbox" name="sum"${c.sum===false?'':' checked'}> סיכום יומי למנהל במייל</label><p class="note" style="margin:0 0 8px">למי נשלח ומי עדיין חייב – למייל העסק שבהגדרות אישור הזמנה.</p>
  <button class="btn w">שמור</button></form>`;
 const sums=(S.rem.sums||[]).slice().sort((a,b)=>String(b.d).localeCompare(String(a.d)));
 h+=`<div class="sec"><h3>סיכומים אחרונים</h3></div>`+(sums.length?sums.map(s=>`<div class="card"><b>${dd(s.d)}</b> <small class="note">נשלחו ${(s.sent||[]).filter(x=>x.ok).length} · לקוחות עם יתרה ${s.nOwe||(s.owe||[]).length} · ${ag(s.tot||0)}</small>
  ${(s.sent||[]).slice(0,50).map(x=>`<div class="row" style="justify-content:space-between"><span>${esc(x.name||x.cust)}</span><small class="note">${x.ok?'נשלח':'לא נשלח – '+esc(WHY[x.why]||x.why||'')}</small></div>`).join('')}</div>`).join(''):'<div class="empty">עוד לא נשלחו תזכורות</div>');
 return{t:T,h}};
FRM.arRemF=async f=>{const x=fd(f),b=f.querySelector('button');const n=(v,d)=>{const s=String(v==null?'':v).trim();return s===''?d:+s};
 const steps=String(x.steps||'').split(/[,\s]+/).filter(Boolean).map(Number);if(steps.some(v=>!Number.isInteger(v)))return toast('ימים אחרי המועד: מספרים שלמים');
 const p={on:!!x.on,sum:!!x.sum,hour:n(x.hour,9),b:n(x.b,3),steps,mon:n(x.mon,30),cap:n(x.cap,200),txt:String(x.txt||'')};
 b.disabled=true;try{await fnCall('setRemCfg',p);S.rem=undefined;toast('נשמר');rerender()}catch(e){err(e)}finally{b.disabled=false}};
window.__arLed={S,debtRows};
})();
