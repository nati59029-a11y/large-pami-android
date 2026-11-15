/* AR:INV – חשבוניות מס, קבלות וזיכויים (משימה 2026-11-14_הזמנות-לקוח-עסקי-וחשבוניות, שלב 4). קובץ עצמאי, נטען אחרי ar-docs.js.
   כל המסמכים מסומנים "טיוטה – לא מסמך רשמי" עד שמנהל־העל מדליק "רשמי". בלי "מסמכים פעילים" (arcfg/main.on) – אין שום שינוי במסכים.
   - כרטיס ההזמנה: "חשבונית" – מספר, שיתוף, ווטסאפ / מייל, זיכוי. הזמנה בלי חשבונית – "הפק חשבונית" (arIssue).
     "סמן שולם" בהזמנה עם חשבונית פתוחה (עובד): חובה לצלם אסמכתא – העברה, צ'ק, או צילום של הכסף / פתק חתום (החלטה 25).
   - כרטיס הלקוח: יתרה, מסמכים, "רישום תשלום (קבלה)" – חלקי, בחירת חשבוניות, עודף = זכות; "סיכום חודשי" (לא חשבונית מס).
   - מנהל: "קבלות שהופקו" – צפייה באסמכתא וביטול קבלה. הגדרות: תבניות ווטסאפ לחשבוניות, "מה ששולם בקופה כבר נספר בדוח Z" לכל סניף.
   - מנהל־על: סוג העסק, מספרי התחלה, סף מספר הקצאה, והמתג "רשמי" (setArOff).
   כל כתיבה – דרך השרת (functions/ar.js, orders.js). קריאה – ardoc / aralloc לפי החוקים. */
(function(){
'use strict';
if(typeof ACT==='undefined'||typeof V==='undefined'||!window.__ox||!window.__arDocs)return;
const O=window.__ox,AD=window.__arDocs,R=AD.R;
const fnCall=(n,d)=>{d=d&&typeof d==='object'?d:{};if(SY&&SY.sa&&SY.bizId&&!('bizId'in d))d=Object.assign({bizId:SY.bizId},d);return window.fnCall(n,d)};
const on=()=>(isA()||isW()||!!(SY&&SY.sa))&&bzF('orders')&&wp('ord');
const mgr=()=>isA()||!!(SY&&SY.sa);
const dec=d=>Object.assign({id:idOf(d)},Object.fromEntries(Object.entries(d.fields||{}).map(([k,v])=>[k,fvj(v)])));
const err=e=>toast(e&&e.message||'הפעולה נכשלה');
const rid=()=>{const a=new Uint8Array(12);crypto.getRandomValues(a);return 'r'+[...a].map(x=>x.toString(36).padStart(2,'0')).join('').slice(0,22)};
const ag=a=>ils((a||0)/100);
const dd=d=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d||''));return m?`${m[3]}/${m[2]}/${m[1].slice(2)}`:''};
const TN={inv:'חשבונית מס',ir:'חשבונית מס קבלה',rc:'קבלה',cr:'חשבונית מס זיכוי'};
const PAYN={cash:'מזומן',transfer:'העברה בנקאית',chq:'צ׳ק',card:'אשראי',other:'אחר'};
const STN={open:'פתוחה',part:'שולמה חלקית',paid:'שולמה',void:'מבוטלת'};
const DRAFT='<span class="tag" style="color:var(--bad)">טיוטה – לא מסמך רשמי</span>';
const ordOf=id=>(O.L||[]).find(x=>x.id===id);
const redraw=v=>{const a=document.activeElement;if(cur().v===v&&!(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))&&!document.querySelector('#dlg[open]'))rerender()};
const reasonOf=e=>e&&(e.details&&e.details.reason||e.reason);
async function runQ(coll,f,lim){const sq={from:[{collectionId:coll}],limit:lim||300};if(f)sq.where={fieldFilter:{field:{fieldPath:f[0]},op:f[1],value:f[2]}};
 const r=await fsx(':runQuery',{method:'POST',body:JSON.stringify({structuredQuery:sq})});return(r||[]).filter(x=>x.document).map(x=>dec(x.document))}
const D={c:{},rc:undefined,off:undefined};
async function docsL(cid,force){if(!force&&D.c[cid])return D.c[cid];try{D.c[cid]=(await runQ('ardoc',['cust','EQUAL',{stringValue:cid}],300)).sort((a,b)=>(b.at||0)-(a.at||0))}catch(e){D.c[cid]=[]}return D.c[cid]}
const docOf=id=>{for(const L of Object.values(D.c))for(const x of L||[])if(x.id===id)return x;return (D.rc||[]).find(x=>x.id===id)||null};
const live=()=>!!(R.cfg&&R.cfg.on);

/* ---------- העלאת אסמכתא (arProof): תמונה מוקטנת במכשיר, PDF כמו שהוא; עד 5MB, בחלקים ---------- */
async function proofUp(file){if(!file)return '';if(!/^(image\/(jpeg|png)|application\/pdf)$/.test(file.type)&&!/^image\//.test(file.type))throw new Error('רק תמונה או PDF');
 let du=await shrinkDU(file);if(/^data:image\/(?!jpeg|png)/.test(du))du=await new Promise((ok,no)=>{const i=new Image();i.onload=()=>{const c=document.createElement('canvas');c.width=i.width;c.height=i.height;c.getContext('2d').drawImage(i,0,0);ok(c.toDataURL('image/jpeg',.85))};i.onerror=()=>no(new Error('התמונה לא נקראה'));i.src=du});
 if(du.length>6990000)throw new Error('הקובץ גדול מ-5MB');
 const CH=690000,np=Math.ceil(du.length/CH);let id=null;
 for(let k=0;k<np;k++){const r=await fnCall('arProof',Object.assign({k,np,data:du.slice(k*CH,(k+1)*CH)},id?{id}:{}));id=r.id}
 return id}
/* זיהוי מהצילום (payproof) – ממלא את הטופס, והעובד מאשר (97) */
async function proofAI(file){const du=await shrinkDU(file),m=/^data:([^;]+);base64,(.*)$/.exec(du);if(!m)throw new Error('הקובץ לא נקרא');
 const t=await shAIcall({contents:[{parts:[{text:''},{inline_data:{mime_type:m[1],data:m[2]}}]}]},'srv',120000,false,'payproof');
 let o=null;try{o=JSON.parse(String(t).replace(/```json|```/g,'').trim())}catch(e){}return o||{}}
const proofBox=(req)=>`<label class="f"><span>צילום אסמכתא${req?' (חובה)':' (רשות)'} – העברה, צ׳ק, אישור אשראי, או צילום של הכסף / פתק חתום</span><input type="file" name="pf" accept="image/*,application/pdf" capture="environment"${req?' required':''}></label>`;

/* ---------- כרטיס ההזמנה: חשבונית ---------- */
function invH(o){if(!live()||o.status==='cancel')return '';const v=o.inv&&o.inv.id?o.inv:null;
 // בלי חשבונית: הכפתור רק אחרי "נשלח" / "שולם" (שם החשבונית הייתה אמורה לצאת לבד – הזמנה ישנה, סכום שלא תאם, או לפני שהמסמכים הופעלו)
 if(!v){if(!(o.shp||o.paid))return '';
  return `<div class="sec"><h3>חשבונית</h3></div><div class="card" id="arinv"><p class="note" style="margin:0 0 8px">עוד לא הופקה חשבונית להזמנה.</p><button class="btn g w" data-a="arIss" data-id="${esc(o.id)}">הפק חשבונית</button></div>`}
 return `<div class="sec"><h3>חשבונית</h3></div><div class="card" id="arinv"><p style="margin:0"><b>${esc(TN[v.t]||'חשבונית')} #${esc(v.no)}</b> ${v.draft?DRAFT:''}</p>
  <div class="row" style="margin-top:8px"><button class="btn g grow" data-a="arDShare" data-id="${esc(v.id)}">שיתוף</button><button class="btn g grow" data-a="arDSend" data-id="${esc(v.id)}" data-ch="wa">ווטסאפ</button><button class="btn g grow" data-a="arDSend" data-id="${esc(v.id)}" data-ch="mail">מייל</button></div>
  <button class="btn g w" style="margin-top:8px" data-a="arCr" data-id="${esc(v.id)}">זיכוי</button></div>`}
{const f=V.oxOrd;if(f)V.oxOrd=id=>{const r=f(id);try{if(!r||!r.h||!on()||R.cfg===undefined)return r;const o=ordOf(id);if(!o)return r;const h=invH(o);if(!h)return r;
 const i=r.h.indexOf('<div class="sec"><h3>תשלום</h3>'),j=r.h.indexOf('<div class="sec"><h3>היסטוריה</h3>'),k=i>=0?i:j;r.h=k>=0?r.h.slice(0,k)+h+r.h.slice(k):r.h+h}catch(e){}return r}}
async function issue(id,x,el){const o=ordOf(id);if(el)el.disabled=true;
 try{const r=await fnCall('arIssue',Object.assign({reqId:rid(),ord:id},x||{}));if(o)o.inv={id:r.id,no:r.no,t:r.t,draft:r.draft};
  toast(`${TN[r.t]} #${r.no} הופקה${r.draft?' (טיוטה)':''}${(r.sent||[]).length?' · נשלחה ללקוח':''}`);closeDlg();redraw('oxOrd')}
 catch(e){if(el)el.disabled=false;const rs=reasonOf(e);
  if(rs==='need-vm')return dlg(`<h3>הזמנה ישנה: המחירים בה –</h3><div class="row"><button class="btn grow" data-a="arIssX" data-id="${esc(id)}" data-vm="inc">כוללים מע"מ</button><button class="btn g grow" data-a="arIssX" data-id="${esc(id)}" data-vm="ex">לפני מע"מ</button></div><button class="btn g w" style="margin-top:8px" data-a="closeDlg">ביטול</button>`);
  if(rs==='need-alloc')return dlg(`<h3>מספר הקצאה</h3><p class="note">לחשבונית ללקוח עסקי בסכום הזה נדרש מספר הקצאה מרשות המסים (לא מאומת – לבדיקה עם רואה החשבון).</p><form data-f="arAllocF"><input type="hidden" name="id" value="${esc(id)}"><input type="hidden" name="vm" value="${esc((x&&x.vm)||'')}">
   <label class="f"><span>מספר הקצאה</span><input name="al" inputmode="numeric" maxlength="20" pattern="\\d{1,20}" dir="ltr"></label><div class="row"><button class="btn grow">הפק</button><button type="button" class="btn g grow" data-a="arAllocSkip" data-id="${esc(id)}" data-vm="${esc((x&&x.vm)||'')}">דלג</button></div></form>`);
  err(e)}}
ACT.arIss=el=>{const o=ordOf(el.dataset.id);if(!o)return;ask(`להפיק ${o.paid?'חשבונית מס קבלה':'חשבונית מס'} להזמנה #${o.no}? אחרי ההפקה ההזמנה ננעלת, ותיקון – רק בזיכוי.`,()=>issue(o.id,null,el),'הפק')};
ACT.arIssX=el=>{closeDlg();issue(el.dataset.id,{vm:el.dataset.vm})};
FRM.arAllocF=f=>{const x=fd(f);if(!/^\d{1,20}$/.test(x.al||''))return toast('ספרות בלבד');issue(x.id,Object.assign({alloc:x.al},x.vm?{vm:x.vm}:{}))};
ACT.arAllocSkip=el=>issue(el.dataset.id,Object.assign({skipAlloc:true},el.dataset.vm?{vm:el.dataset.vm}:{}));
ACT.arDShare=async el=>{if(el.dataset.busy)return;el.dataset.busy='1';try{const r=await fnCall('arDoc',{id:el.dataset.id,op:'pdf'});await dxShareDU('data:application/pdf;base64,'+r.b64,String(r.name||'מסמך').replace(/\.pdf$/,''))}catch(e){err(e)}finally{delete el.dataset.busy}};
ACT.arDSend=async el=>{const id=el.dataset.id,ch=el.dataset.ch;let v='';const d=docOf(id);const o=(O.L||[]).find(x=>x.inv&&x.inv.id===id);
 const k=(d&&d.custSnap)||(o&&o.cust)||{};v=ch==='wa'?(k.phone||''):(k.mail||'');
 dlg(`<h3>שליחה ב${ch==='wa'?'ווטסאפ':'מייל'}</h3><form data-f="arDSendF"><input type="hidden" name="id" value="${esc(id)}"><input type="hidden" name="ch" value="${esc(ch)}"><input type="hidden" name="q" value="${rid()}">
  <label class="f"><span>${ch==='wa'?'מספר ווטסאפ':'כתובת מייל'}</span><input name="to" value="${esc(v)}" dir="ltr" ${ch==='wa'?'inputmode="tel"':'type="email"'} required maxlength="254"></label>
  <div class="row"><button class="btn grow">שלח</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`)};
FRM.arDSendF=async f=>{const x=fd(f),b=f.querySelector('button');b.disabled=true;
 try{const r=await fnCall('arDoc',{id:x.id,op:'send',ch:x.ch,to:String(x.to||'').trim(),reqId:x.q});closeDlg();const s=(r.sent||[])[0];toast(s?(s.ok?'נשלח ✓':'לא נשלח – '+(s.why||'שגיאה')):'נשלח')}catch(e){b.disabled=false;err(e)}};

/* ---------- "סמן שולם" בהזמנה עם חשבונית פתוחה: עובד – חובה אסמכתא ---------- */
{const f=ACT.oxPaid;if(f)ACT.oxPaid=el=>{const o=ordOf(el.dataset.id);if(!(o&&live()&&o.inv&&o.inv.t==='inv'&&!mgr()))return f(el);
 dlg(`<h3>תשלום על ${esc(TN.inv)} #${esc(o.inv.no)}</h3><p class="note" style="margin-top:0">תופק קבלה על היתרה לתשלום. ${o.inv.draft?'(טיוטה – לא מסמך רשמי)':''}</p><form data-f="arPaidF"><input type="hidden" name="id" value="${esc(o.id)}">
  <label class="f"><span>אמצעי תשלום</span><select name="method"><option value="transfer">העברה בנקאית</option><option value="cash">מזומן</option><option value="phone">אשראי</option><option value="other">אחר (צ׳ק – דרך "רישום תשלום" בכרטיס הלקוח)</option></select></label>
  ${proofBox(true)}<div class="row"><button class="btn grow">שולם</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`)}}
FRM.arPaidF=async f=>{const x=fd(f),b=f.querySelector('button'),file=f.querySelector('[name=pf]').files[0];if(!file)return toast('צריך לצלם אסמכתא');b.disabled=true;
 try{const pf=await proofUp(file);const r=await fnCall('markOrderPaid',{id:x.id,method:x.method,proofId:pf});closeDlg();toast('סומן שולם'+(r&&r.ar&&r.ar.no?' · קבלה #'+r.ar.no:''));const o=ordOf(x.id);if(o)O.log[x.id]=undefined;try{await window.__oxAfter(x.id)}catch(e){rerender()}}catch(e){b.disabled=false;err(e)}};

/* ---------- כרטיס הלקוח: יתרה, מסמכים, קבלה, סיכום חודשי ---------- */
function rowH(x){const sg=x.t==='cr'||x.t==='rc'?-1:1;
 return `<div class="li" data-a="arDocV" data-id="${esc(x.id)}" style="cursor:pointer"><div class="grow"><b>${esc(TN[x.t]||x.t)} #${esc(x.no)}</b>${x.draft?' <small style="color:var(--bad)">טיוטה</small>':''}<br><small class="note">${dd(x.d)}${x.t==='inv'?' · לתשלום עד '+dd(x.dueX||x.due):''}${STN[x.st]?' · '+STN[x.st]:''}${x.t==='cr'&&refTx(x.ref)?' · '+esc(refTx(x.ref)):''}</small></div>
  <div style="text-align:left"><b dir="ltr">${ag(sg*x.gross)}</b>${x.t==='inv'&&x.open>0&&x.open<x.gross?`<br><small class="note">פתוח ${ag(x.open)}</small>`:''}${(x.t==='rc'||x.t==='cr')&&x.open>0&&!x.void?`<br><small class="note">זכות ${ag(x.open)}</small>`:''}</div></div>`}
{const f=V.ocCard;if(f)V.ocCard=id=>{const r=f(id);try{if(!r||!r.h||!on()||!live())return r;
 if(!D.c[id]){docsL(id).then(()=>redraw('ocCard'));return r}
 const L=D.c[id],c=R.c[id]||{},a=c.ar||{};
 r.h+=`<div class="sec"><h3>חשבוניות וקבלות</h3></div><div class="card"><div class="row" style="justify-content:space-between"><span>יתרה לתשלום</span><b dir="ltr">${ag(a.bal||0)}</b></div>${a.cr>0?`<p class="note" style="margin:4px 0 0">יתרת זכות: ${ag(a.cr)} (תקוזז בחשבונית הבאה)</p>`:''}
  <div class="row" style="margin-top:8px"><button class="btn grow" data-a="arRc" data-id="${esc(id)}">רישום תשלום (קבלה)</button><button class="btn g grow" data-a="arMon" data-id="${esc(id)}">סיכום חודשי</button></div></div>
  ${L.length?L.slice(0,40).map(rowH).join(''):'<div class="empty">אין עדיין מסמכים</div>'}`}catch(e){}return r}}
ACT.arDocV=el=>{const x=docOf(el.dataset.id);if(!x)return;const p=x.pay||{};
 dlg(`<h3>${esc(TN[x.t])} #${esc(x.no)} ${x.draft?DRAFT:''}</h3>${x.t==='cr'&&refTx(x.ref)?`<p style="margin:0 0 6px;font-size:1.05em"><b style="color:var(--acc)">${esc(refTx(x.ref))}</b></p>`:''}${x.t==='cr'&&rfTx(x.rf)?`<p style="margin:0 0 6px"><b>${esc(rfTx(x.rf))}</b></p>`:''}<p class="note" style="margin-top:0">${dd(x.d)} · ${ag(x.gross)}${x.t==='inv'?' · לתשלום עד '+dd(x.dueX||x.due)+' · '+(STN[x.st]||''):''}${x.t==='rc'?' · '+(PAYN[p.m]||'')+(p.chq?` · צ׳ק ${esc(p.chq.no)} (${esc(p.chq.bank)}, ${dd(p.chq.d)})`:''):''}${x.void?' · <b style="color:var(--bad)">מבוטלת</b>: '+esc(x.void.why||''):''}</p>
  <div class="row"><button class="btn g grow" data-a="arDShare" data-id="${esc(x.id)}">שיתוף</button><button class="btn g grow" data-a="arDSend" data-id="${esc(x.id)}" data-ch="wa">ווטסאפ</button><button class="btn g grow" data-a="arDSend" data-id="${esc(x.id)}" data-ch="mail">מייל</button></div>
  ${['inv','ir'].includes(x.t)?`<button class="btn g w" style="margin-top:8px" data-a="arCr" data-id="${esc(x.id)}">זיכוי</button>`:''}
  ${x.t==='inv'&&mgr()?`<form data-f="arDueF" class="row" style="margin-top:8px;align-items:end"><input type="hidden" name="id" value="${esc(x.id)}"><label class="f grow" style="margin:0"><span>מועד תשלום</span><input type="date" name="due" value="${esc(x.dueX||x.due||'')}" min="${esc(x.d)}"></label><button class="btn g">שנה</button></form>`:''}
  ${x.t==='rc'&&mgr()&&!x.void?`<div class="row" style="margin-top:8px">${x.proof?`<button class="btn g grow" data-a="arPfV" data-id="${esc(x.proof)}">אסמכתא</button>`:''}<button class="btn r grow" id="arVoidB" data-a="arVoid" data-id="${esc(x.id)}">ביטול קבלה</button></div><p class="note" id="arVoidN" style="display:none;margin:6px 0 0"></p>`:''}
  <button class="btn g w" style="margin-top:8px" data-a="closeDlg">סגירה</button>`);
 if(x.t==='rc'&&mgr()&&!x.void)rcRf(x.id).then(h=>{const b=document.getElementById('arVoidB'),n=document.getElementById('arVoidN');if(!h||!b||b.dataset.id!==x.id)return;b.disabled=true;if(n){n.textContent=RCRF;n.style.display=''}})};
/* החלטה 37: על חשבונית שהקבלה הוקצתה אליה יש זיכוי עם החזר כסף (rf) – ביטול הקבלה מושבת (השרת דוחה: rc-refunded). שגיאת קריאה – הכפתור נשאר והשרת מכריע */
const RCRF='הוחזר כסף על החשבונית – אי אפשר לבטל את הקבלה. תיקון – בזיכוי';
async function rcRf(id){try{const inv=[...new Set((await runQ('aralloc',['rc','EQUAL',{stringValue:id}],100)).filter(a=>!a.void).map(a=>a.inv).filter(Boolean))];
 for(const v of inv)if((await runQ('ardoc',['ref','EQUAL',{stringValue:v}],100)).some(d=>d.t==='cr'&&!d.void&&d.rf))return true}catch(e){}return false}
FRM.arDueF=async f=>{const x=fd(f);try{await fnCall('arDoc',{id:x.id,op:'due',due:x.due});const d=docOf(x.id);if(d)d.dueX=x.due;closeDlg();toast('מועד התשלום עודכן');rerender()}catch(e){err(e)}};
ACT.arPfV=async el=>{try{const r=await fnCall('arProofGet',{id:el.dataset.id});if(/^data:image\//.test(r.data))dlg(`<h3>אסמכתא</h3><img src="${esc(r.data)}" style="max-width:100%"><button class="btn g w" style="margin-top:8px" data-a="closeDlg">סגירה</button>`);else await dxShareDU(r.data,'אסמכתא')}catch(e){err(e)}};

/* קבלה: סכום, אמצעי תשלום, צ'ק, אסמכתא (עובד – חובה), בחירת חשבוניות (בלי בחירה – מהמוקדמת); עודף = זכות */
ACT.arRc=async el=>{const cid=el.dataset.id;const L=(await docsL(cid,true)).filter(x=>x.t==='inv'&&x.open>0&&!x.void).sort((a,b)=>String(a.dueX||a.due).localeCompare(String(b.dueX||b.due)));
 dlg(`<h3>רישום תשלום (קבלה)</h3><form data-f="arRcF"><input type="hidden" name="cust" value="${esc(cid)}"><input type="hidden" name="q" value="${rid()}">
  ${proofBox(!mgr())}<button type="button" class="btn g s" data-a="arRcAI">זהה פרטים מהצילום</button>
  <label class="f"><span>סכום (₪)</span><input name="amt" inputmode="decimal" required></label>
  <label class="f"><span>אמצעי תשלום</span><select name="method">${Object.entries(PAYN).map(([k,l])=>`<option value="${k}">${l}</option>`).join('')}</select></label>
  <div class="row"><label class="f grow"><span>מס׳ צ׳ק</span><input name="cno" inputmode="numeric" maxlength="12" dir="ltr"></label><label class="f grow"><span>בנק</span><input name="cbank" maxlength="40"></label><label class="f grow"><span>פירעון</span><input type="date" name="cd"></label></div>
  <label class="f"><span>אסמכתא / מספר אישור (רשות)</span><input name="conf" maxlength="20" dir="ltr"></label>
  ${L.length?`<p style="margin:8px 0 4px"><b>על אילו חשבוניות?</b> <small class="note">בלי סימון – מהמוקדמת. עודף נשמר כזכות.</small></p>${L.map(x=>`<label class="row" style="gap:8px;align-items:center;min-height:44px"><input type="checkbox" name="i_${esc(x.id)}"> #${esc(x.no)} · ${dd(x.d)} · פתוח ${ag(x.open)} <input name="a_${esc(x.id)}" inputmode="decimal" placeholder="${(x.open/100).toFixed(2)}" style="width:90px"></label>`).join('')}`:'<p class="note">אין חשבוניות פתוחות – הסכום יישמר כזכות.</p>'}
  <div class="row"><button class="btn grow">הפק קבלה</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`)};
ACT.arRcAI=async el=>{const f=el.closest('form'),file=f&&f.querySelector('[name=pf]').files[0];if(!file)return toast('קודם צלמו את האסמכתא');el.disabled=true;
 try{const o=await proofAI(file);const set=(n,v)=>{const i=f.querySelector(`[name=${n}]`);if(i&&v!=null&&v!=='')i.value=v};
  if(['cash','transfer','chq','card','other'].includes(o.method))set('method',o.method);if(typeof o.amt==='number'&&o.amt>0)set('amt',o.amt);
  if(o.chq){set('cno',String(o.chq.no||'').replace(/\D/g,''));set('cbank',o.chq.bank);if(/^\d{4}-\d{2}-\d{2}$/.test(o.chq.d||''))set('cd',o.chq.d)}if(o.ref)set('conf',String(o.ref).replace(/[^0-9A-Za-z-]/g,'').slice(0,20));
  toast('הפרטים מולאו – בדקו ואשרו')}catch(e){err(e)}finally{el.disabled=false}};
FRM.arRcF=async f=>{const x=fd(f),b=f.querySelector('button:not([type])'),file=f.querySelector('[name=pf]').files[0];const amt=+String(x.amt||'').replace(/[^\d.]/g,'');
 if(!(amt>0))return toast('סכום לא תקין');if(!file&&!mgr())return toast('צריך לצלם אסמכתא');
 const alloc=Object.keys(x).filter(k=>k.indexOf('i_')===0&&x[k]).map(k=>{const id=k.slice(2),d=docOf(id),v=+String(x['a_'+id]||'').replace(/[^\d.]/g,'');return{inv:id,amt:v>0?v:(d?d.open/100:0)}}).filter(a=>a.amt>0);
 const s=alloc.reduce((t,a)=>t+a.amt,0);if(s>amt+0.001)return toast('הסכום לחשבוניות גדול מסכום הקבלה');
 const p={reqId:x.q,cust:x.cust,amt:Math.round(amt*100)/100,method:x.method};if(x.method==='chq')p.chq={no:String(x.cno||''),bank:String(x.cbank||''),d:String(x.cd||'')};if(x.conf)p.conf=x.conf;if(alloc.length)p.alloc=alloc.map(a=>({inv:a.inv,amt:Math.round(a.amt*100)/100}));
 b.disabled=true;try{if(file)p.proofId=await proofUp(file);const r=await fnCall('arReceipt',p);closeDlg();toast(`קבלה #${r.no} הופקה${r.draft?' (טיוטה)':''}${r.left>0?' · זכות '+ag(r.left):''}`);await docsL(x.cust,true);try{AD.R.c[x.cust]=undefined}catch(e){}rerender()}catch(e){b.disabled=false;err(e)}};

/* זיכוי (החלטה 29): החשבונית לא מבוטלת. כל הפריטים שבחשבונית – לכל פריט "+" / "−" עד הכמות שנקנתה פחות מה שכבר זוכה; הסכום מתעדכן תוך כדי.
   "החזרה למלאי" כבויה כברירת מחדל (החלטה 11). זיכוי לפי סכום (בלי פריטים) – נשאר כאפשרות משנית. השרת בודק שוב את הכמויות (arCredit) */
const r3=n=>Math.round(n*1000)/1000;
// החלטה 31: החזר כסף באמצעי התשלום המקורי – המערכת רק רושמת (זיכוי האשראי עצמו – במסוף, כמו היום)
const RFN={card:'זיכוי באשראי',cash:'החזר מזומן',transfer:'החזר בהעברה בנקאית',chq:'החזר בצ׳ק',other:'החזר – אחר'};
const rfTx=rf=>rf&&Number.isInteger(rf.amt)?`הוחזר ללקוח: ${RFN[rf.m]||RFN.other}, ${ag(rf.amt)}`:'';
const refTx=ref=>{const m=/^(inv|ir)([DO])(\d+)$/.exec(String(ref||''));return m?`זיכוי ל${TN[m[1]]} מספר ${m[3]}${m[2]==='D'?' (טיוטה)':''}`:''};
let CR=null;
function crSum(){if(!CR)return;const f=document.querySelector('#dlg form[data-f=arCrF]');if(!f)return;const x=CR.x,L=x.lines||[];
 L.forEach((l,i)=>{const q=CR.q[i]||0,e=f.querySelector(`[data-cq="${i}"]`),h=f.querySelector(`[name=l_${i}]`);if(e)e.textContent=String(q);if(h)h.value=String(q);
  const m=f.querySelector(`[data-a=arCrM][data-i="${i}"]`),p=f.querySelector(`[data-a=arCrP][data-i="${i}"]`);if(m)m.disabled=!(q>0);if(p)p.disabled=!(q<CR.left[i])});
 const sel=L.map((l,i)=>({n:l.n,q:CR.q[i]||0,p:l.p})).filter(l=>l.q>0);const AC=window.ArCalc;
 let s=sel.length&&AC?AC.docSums(sel,x.vm,x.rate,x.disc||0):{net:0,vat:0,gross:0};
 // זיכוי שמכסה את כל מה שנשאר = בדיוק היתרה (כמו בשרת – adj)
 if(sel.length&&!CR.pAmt&&L.every((l,i)=>!(l.q>0)||r3(CR.left[i]-(CR.q[i]||0))<=0))s={net:x.net-CR.pN,vat:x.vat-CR.pV,gross:x.gross-CR.pG};
 const amt=+String((f.querySelector('[name=amt]')||{}).value||'').replace(/[^\d.]/g,'');
 const box=f.querySelector('#arCrSum');if(box)box.innerHTML=sel.length?(x.vm==='ex'?`<div class="row" style="justify-content:space-between"><span>לפני מע"מ</span><b dir="ltr">${ag(s.net)}</b></div><div class="row" style="justify-content:space-between"><span>מע"מ</span><b dir="ltr">${ag(s.vat)}</b></div>`:'')+`<div class="row" style="justify-content:space-between"><span>סה"כ זיכוי${x.vm==='ex'?'':' (כולל מע"מ)'}</span><b dir="ltr">${ag(s.gross)}</b></div>${x.vm==='ex'?'':`<small class="note">מתוכם מע"מ ${ag(s.vat)}</small>`}`:(amt>0?`<div class="row" style="justify-content:space-between"><span>זיכוי לפי סכום (כולל מע"מ)</span><b dir="ltr">${ils(amt)}</b></div>`:'<small class="note">עוד לא נבחר פריט לזיכוי</small>');
 // החזר כסף (החלטה 31): רק על מה ששולם – בחשבונית מס הזיכוי קודם סוגר את החוב הפתוח, ורק העודף מוחזר
 const g=sel.length?s.gross:Math.round(amt*100),bk=!!f.querySelector('[name=rk][value=back]:checked'),rA=Math.max(0,g-(x.t==='inv'?Math.max(0,x.open||0):0));
 const rs=f.querySelector('[name=rm]'),rw=f.querySelector('#arCrRm');if(rw)rw.hidden=!bk;
 if(box&&bk&&g>0)box.innerHTML+=rA>0?`<div class="row" style="justify-content:space-between"><span>יוחזר ללקוח (${esc(RFN[rs&&rs.value]||'')})</span><b dir="ltr">${ag(rA)}</b></div>`:'<p class="note" style="margin:4px 0 0;color:var(--bad)">החשבונית לא שולמה – הזיכוי רק מוריד את החוב, ואין כסף להחזיר.</p>';
 const b=f.querySelector('button:not([type])');if(b)b.disabled=!(sel.length||amt>0)||(bk&&!(rA>0))||(bk&&!(rs&&RFN[rs.value]))}
ACT.arCr=async el=>{const id=el.dataset.id;let x=null;try{const d=await fsx('/ardoc/'+id);x=d?dec(d):null}catch(e){x=null}if(!x)x=docOf(id);if(!x)return toast('המסמך לא נמצא');
 // אמצעי התשלום של החשבונית המקורית: חשבונית מס קבלה – pay; חשבונית מס – הקבלות שהוקצו לה (aralloc)
 let src=[];if(x.t==='ir'){if(x.pay)src=[x.pay.m]}else{try{for(const a of (await runQ('aralloc',['inv','EQUAL',{stringValue:x.id}],100)).filter(a=>!a.void&&/^rc/.test(a.rc||''))){let d=docOf(a.rc);if(!d){try{const z=await fsx('/ardoc/'+a.rc);d=z?dec(z):null}catch(e){}}if(d&&d.pay&&!d.void)src.push(d.pay.m)}}catch(e){}}
 src=[...new Set(src.filter(m=>RFN[m]))];
 let prev=[];try{prev=(await runQ('ardoc',['ref','EQUAL',{stringValue:x.id}],300)).filter(p=>p.t==='cr')}catch(e){return err(e)}
 const used={};prev.forEach(p=>(Array.isArray(p.li)?p.li:[]).forEach(l=>{used[l.i]=r3((used[l.i]||0)+(+l.q||0))}));
 const L=x.lines||[];CR={x,q:{},used,left:L.map((l,i)=>Math.max(0,r3((+l.q||0)-(used[i]||0)))),pAmt:prev.some(p=>!Array.isArray(p.li)),
  pG:prev.reduce((s,p)=>s+(p.gross||0),0),pN:prev.reduce((s,p)=>s+(p.net||0),0),pV:prev.reduce((s,p)=>s+(p.vat||0),0)};
 const rest=Math.max(0,x.gross-CR.pG);
 closeDlg();dlg(`<h3>זיכוי ל${esc(TN[x.t])} #${esc(x.no)}</h3>${x.draft?DRAFT:''}<p class="note" style="margin:4px 0 8px">החשבונית לא מבוטלת. לחצו + על כל פריט שמזכים.${CR.pG?` כבר זוכו ${ag(CR.pG)}, נשאר לזכות עד ${ag(rest)}.`:''}</p><form data-f="arCrF"><input type="hidden" name="id" value="${esc(x.id)}"><input type="hidden" name="q" value="${rid()}">
  ${L.map((l,i)=>`<div class="row" style="gap:6px;align-items:center;min-height:48px;border-bottom:1px solid var(--line);flex-wrap:nowrap"><span class="grow" style="min-width:0;overflow-wrap:anywhere">${esc(l.n)}<br><small class="note">${ils(l.p)} · נקנו ${esc(l.q)}${used[i]?' · זוכו '+esc(used[i]):''}</small></span>
   <input type="hidden" name="l_${i}" value="0"><button type="button" class="btn g" style="min-width:44px;min-height:44px;padding:0" data-a="arCrM" data-i="${i}" aria-label="פחות" disabled>−</button><b data-cq="${i}" style="min-width:30px;text-align:center" dir="ltr">0</b><button type="button" class="btn g" style="min-width:44px;min-height:44px;padding:0" data-a="arCrP" data-i="${i}" aria-label="עוד אחד"${CR.left[i]>0?'':' disabled'}>+</button></div>`).join('')}
  ${CR.left.some(v=>v>0)?'<button type="button" class="btn g s" style="margin-top:8px" data-a="arCrAll">הכול</button>':'<p class="note">כל הפריטים כבר זוכו.</p>'}
  <div class="card" id="arCrSum" style="margin:8px 0"></div>
  <details style="margin-bottom:8px"><summary style="min-height:44px;line-height:44px">זיכוי לפי סכום (בלי פריטים)</summary><label class="f"><span>סכום (כולל מע"מ, ₪)</span><input name="amt" inputmode="decimal" style="width:120px"></label></details>
  <label class="row" style="gap:8px;align-items:center;min-height:44px"><input type="checkbox" name="rs"> החזרה למלאי</label>
  <div class="card" style="margin:8px 0"><b>מה עושים עם הזיכוי?</b>
   <label class="row" style="gap:8px;align-items:center;min-height:44px"><input type="radio" name="rk" value="cr" checked> זיכוי ללקוח <small class="note">(יתרת זכות – תקוזז בחשבונית הבאה)</small></label>
   <label class="row" style="gap:8px;align-items:center;min-height:44px"><input type="radio" name="rk" value="back"> החזר כסף <small class="note">(רק על מה ששולם)</small></label>
   <label class="f" id="arCrRm" hidden><span>אמצעי ההחזר${src.length>1?' – שולם בכמה אמצעים, בחרו':src.length?' – כמו התשלום המקורי':' – לא ידוע, בחרו'}</span><select name="rm">${src.length?'':'<option value="" selected>בחרו…</option>'}${Object.entries(RFN).map(([k,l])=>`<option value="${k}"${k===src[0]?' selected':''}>${l}</option>`).join('')}</select></label></div>
  <label class="f"><span>סיבה (חובה)</span><input name="why" required maxlength="200"></label>
  <div class="row"><button class="btn r grow" disabled>הפק זיכוי</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`);
 const fm=document.querySelector('#dlg form[data-f=arCrF]');if(fm)fm.onchange=crSum;
 const a=document.querySelector('#dlg [name=amt]');if(a)a.oninput=()=>{if(+String(a.value||'').replace(/[^\d.]/g,'')>0)CR.q={};crSum()};crSum()};
const crAdd=(i,d)=>{if(!CR||!(i>=0))return;const q=CR.q[i]||0,mx=CR.left[i]||0;CR.q[i]=Math.max(0,Math.min(mx,r3(d>0?q+Math.min(1,mx-q):q-1)));if(CR.q[i]>0){const a=document.querySelector('#dlg [name=amt]');if(a)a.value=''}crSum()};
ACT.arCrP=el=>crAdd(+el.dataset.i,1);
ACT.arCrM=el=>crAdd(+el.dataset.i,-1);
ACT.arCrAll=()=>{if(!CR)return;CR.left.forEach((v,i)=>{CR.q[i]=v});const a=document.querySelector('#dlg [name=amt]');if(a)a.value='';crSum()};
FRM.arCrF=async f=>{const x=fd(f),b=f.querySelector('button:not([type])');const p={reqId:x.q,inv:x.id,reason:String(x.why||'').trim()};
 p.lines=Object.keys(x).filter(k=>/^l_\d+$/.test(k)&&+x[k]>0).map(k=>({i:+k.slice(2),q:+x[k]})).sort((a,c)=>a.i-c.i);
 if(p.lines.length)p.mode='lines';else{delete p.lines;p.amt=Math.round(+String(x.amt||'').replace(/[^\d.]/g,'')*100)/100;if(!(p.amt>0))return toast('לחצו + על פריט לזיכוי');p.mode='amt'}
 if(!p.reason)return toast('כתבו סיבה');
 if(x.rs&&p.mode!=='amt')p.restock=true;
 if(x.rk==='back'){if(!RFN[x.rm])return toast('בחרו אמצעי החזר');p.refund={m:x.rm}}
 b.disabled=true;try{const r=await fnCall('arCredit',p);CR=null;closeDlg();toast(`זיכוי #${r.no} הופק${r.draft?' (טיוטה)':''}${r.rs?' · הוחזר למלאי':''}${r.rf?' · '+rfTx(r.rf):''}`);for(const k of Object.keys(D.c))D.c[k]=undefined;rerender()}catch(e){b.disabled=false;err(e)}};

/* סיכום חודשי (לא חשבונית מס – החלטה 23): הפקה ושיתוף, או שליחה */
ACT.arMon=el=>{const cid=el.dataset.id,d=new Date(),ym=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
 dlg(`<h3>סיכום חודשי ללקוח</h3><p class="note" style="margin-top:0">מסמך סיכום של כל החשבוניות בחודש – לא חשבונית מס.</p><form data-f="arMonF"><input type="hidden" name="cust" value="${esc(cid)}"><label class="f"><span>חודש</span><input type="month" name="ym" value="${ym}" required></label>
  <div class="row"><button class="btn grow" name="go" value="share">הפק ושתף</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`)};
FRM.arMonF=async f=>{const x=fd(f),b=f.querySelector('button:not([type])');b.disabled=true;try{const r=await fnCall('arMonthly',{cust:x.cust,ym:x.ym});closeDlg();await dxShareDU('data:application/pdf;base64,'+r.b64,'סיכום חשבוניות '+x.ym)}catch(e){b.disabled=false;err(e)}};

/* ---------- מנהל: קבלות שהופקו – אסמכתא וביטול ---------- */
V.arRcList=()=>{const T='קבלות שהופקו';if(!on()||!mgr())return{t:T,h:'<div class="empty">למנהל בלבד</div>'};
 if(D.rc===undefined){D.rc=null;runQ('ardoc',['t','EQUAL',{stringValue:'rc'}],500).then(L=>{D.rc=L.sort((a,b)=>(b.at||0)-(a.at||0));redraw('arRcList')},()=>{D.rc=[];redraw('arRcList')});return{t:T,h:'<div class="empty">טוען…</div>'}}
 if(D.rc===null)return{t:T,h:'<div class="empty">טוען…</div>'};
 return{t:T,h:D.rc.length?D.rc.slice(0,200).map(x=>`<div class="li" data-a="arDocV" data-id="${esc(x.id)}" style="cursor:pointer"><div class="grow"><b>קבלה #${esc(x.no)}</b>${x.draft?' <small style="color:var(--bad)">טיוטה</small>':''}${x.void?' <small style="color:var(--bad)">מבוטלת</small>':''}<br><small class="note">${dd(x.d)} · ${esc((x.custSnap&&x.custSnap.name)||'')} · ${esc(PAYN[(x.pay||{}).m]||'')}</small></div><b dir="ltr">${ag(x.gross)}</b></div>`).join(''):'<div class="empty">אין קבלות</div>'}};
ACT.arVoid=el=>{if(el.disabled)return;const id=el.dataset.id;closeDlg();dlg(`<h3>ביטול קבלה</h3><p class="note" style="margin-top:0">המספר נשמר, הקבלה מסומנת "מבוטל", והחשבוניות שנסגרו בה נפתחות שוב. (הנוהל המשפטי – לא מאומת, לבדיקה עם רואה החשבון.)</p><form data-f="arVoidF"><input type="hidden" name="id" value="${esc(id)}"><input type="hidden" name="q" value="${rid()}"><label class="f"><span>סיבה (חובה)</span><input name="why" required maxlength="200"></label><div class="row"><button class="btn r grow">בטל קבלה</button><button type="button" class="btn g grow" data-a="closeDlg">חזרה</button></div></form>`)};
FRM.arVoidF=async f=>{const x=fd(f),b=f.querySelector('button');b.disabled=true;try{await fnCall('arVoidRc',{reqId:x.q,id:x.id,reason:String(x.why||'').trim()});closeDlg();toast('הקבלה בוטלה');D.rc=undefined;for(const k of Object.keys(D.c))D.c[k]=undefined;rerender()}catch(e){b.disabled=false;err(e)}};

/* ---------- הגדרות: תבניות ווטסאפ לחשבוניות, דוח Z לכל סניף (מנהל); מנהל־על – רשמי, סוג עסק, מספרי התחלה, סף הקצאה ---------- */
{const f=V.arCfg;if(f)V.arCfg=()=>{const r=f();try{if(!r||!r.h||!on()||!mgr()||R.cfg===undefined)return r;const c=R.cfg||{},wt=c.wt||{},z=c.z||{};
 const brs=(typeof brAll==='function'?brAll():[]).filter(b=>b&&b.on!==false);
 r.h+=`<div class="sec"><h3>חשבוניות וקבלות</h3></div><form class="card" data-f="arInvCfgF"><p class="note" style="margin-top:0">כשהמסמכים פעילים: חשבונית מס יוצאת לבד ב"נשלח" (לקוח בשוטף), חשבונית מס קבלה – ב"שולם" (לקוח פרטי) או כשהסחורה יוצאת (לקוח עסקי ששילם). עד אישור רואה החשבון הכול "טיוטה – לא מסמך רשמי".</p>
  ${[['inv','חשבונית מס'],['ir','חשבונית מס קבלה'],['rc','קבלה'],['cr','זיכוי'],['st','סיכום חודשי']].map(([k,l])=>`<label class="f"><span>תבנית ווטסאפ – ${l}</span><input name="wt_${k}" value="${esc(wt[k]||'')}" dir="ltr" maxlength="100"></label>`).join('')}
  <p style="margin:8px 0 4px"><b>מה ששולם בקופה כבר נספר בדוח Z</b> <small class="note">(חשבונית מס קבלה ששולמה במזומן / אשראי בסניף המסומן לא תיכנס שוב להכנסות)</small></p>
  ${(brs.length?brs:[{id:'_',name:'העסק'}]).map(b=>`<label class="row" style="gap:8px;align-items:center;min-height:44px"><input type="checkbox" name="z_${esc(b.id)}"${z[b.id]?' checked':''}> ${esc(b.name||b.id)}</label>`).join('')}
  <button class="btn w">שמור</button></form><button class="btn g w" style="margin-top:8px" data-a="go" data-v="arRcList">קבלות שהופקו</button>`;
 if(SY&&SY.sa){if(D.off===undefined){D.off=null;fsx('/arcfg/off').then(d=>{D.off=d?dec(d):{};redraw('arCfg')},()=>{D.off={};redraw('arCfg')})}const o=D.off||{},st=o.start||{};
  r.h+=`<div class="sec"><h3>מנהל־על: חשבוניות רשמיות</h3></div><form class="card" data-f="arOffF"><p class="note" style="margin-top:0;color:var(--bad)">רק אחרי אישור רואה החשבון. מסמך שהופק כטיוטה נשאר טיוטה. (הדרישות החוקיות – לא מאומת.)</p>
   <label class="f"><span>סוג העסק</span><select name="bt">${[['osek','עוסק מורשה'],['co','חברה'],['patur','עוסק פטור']].map(([k,l])=>`<option value="${k}"${(o.bt||'osek')===k?' selected':''}>${l}</option>`).join('')}</select></label>
   ${[['inv','חשבונית מס'],['ir','חשבונית מס קבלה'],['rc','קבלה'],['cr','זיכוי']].map(([k,l])=>`<label class="f"><span>מספר ראשון רשמי – ${l}</span><input name="s_${k}" inputmode="numeric" value="${esc(st[k]||'')}" dir="ltr"></label>`).join('')}
   <label class="f"><span>סף למספר הקצאה (₪ לפני מע"מ, ריק = לא נדרש)</span><input name="amin" inputmode="decimal" value="${esc(o.amin||'')}" dir="ltr"></label>
   <label class="row" style="gap:8px;align-items:center;min-height:44px"><input type="checkbox" name="on"${o.on?' checked':''}> <b>מסמכים רשמיים</b></label>
   <button class="btn w">שמור</button></form>`}}catch(e){}return r}}
FRM.arInvCfgF=async f=>{const x=fd(f),b=f.querySelector('button');b.disabled=true;const wt={oc:((R.cfg||{}).wt||{}).oc||''},z={};
 for(const k of ['inv','ir','rc','cr','st'])wt[k]=String(x['wt_'+k]||'').trim();for(const i of f.querySelectorAll('input[name^="z_"]'))z[i.name.slice(2)]=i.checked;
 try{await fnCall('setArCfg',{wt,z});await AD.cfgL(true);toast('נשמר');rerender()}catch(e){err(e)}finally{b.disabled=false}};
FRM.arOffF=f=>{const x=fd(f);const p={bt:x.bt};const st={};for(const k of ['inv','ir','rc','cr']){const v=String(x['s_'+k]||'').trim();if(v&&v!==String(((D.off||{}).start||{})[k]||''))st[k]=+v}if(Object.keys(st).length)p.start=st;
 const am=String(x.amin||'').trim();p.amin=am?+am:null;p.on=!!x.on;
 const go=async()=>{try{await fnCall('setArOff',p);D.off=undefined;toast('נשמר');rerender()}catch(e){err(e)}};
 if(p.on&&!(D.off||{}).on)return ask('להפוך את המסמכים לרשמיים? מעכשיו יופקו חשבוניות מס רשמיות במספור הרשמי. רק אחרי אישור רואה החשבון.',go,'כן, רשמי');go()};
window.__arInv={D,invH,rowH,proofUp};
})();
