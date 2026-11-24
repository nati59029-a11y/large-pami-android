/* ORD:QT – הצעת מחיר ללקוח (משימה 2026-11-24_הצעת-מחיר-ומיון-חיפוש, שלב 5). קובץ עצמאי, נטען אחרי ar-docs.js (אחרי orders-staff / orders-cust / ord-biz).
   - טופס הזמנה חדשה: כפתור "שמור כהצעת מחיר" (חלון תוקף, ברירת מחדל 14 יום) – אותה בדיקה ואותם פריטים כמו "שמור הזמנה" (עוטף את ACT.oxSave,
     תופס את הקריאה ל-createOrder ושולח אותה כ-qtSave), רשימה V.oxQt (פתוחות / פג תוקף / הפכו להזמנה / בוטלו) וכרטיס V.oxQtCard.
   - כרטיס: הפוך להזמנה (qtConvert), בקשת אישור מנהל / אישור (qtSet), שיתוף PDF (qtPdf), ווטסאפ / מייל (qtSend), ביטול.
   - כל כתיבה – דרך השרת (functions/quotes.js, quotes-pdf.js). הצעה לא תופסת מלאי. "פג תוקף" מחושב לפי תאריך ישראל מתוך vu.
   - שרת שעדיין לא עודכן (הפונקציה לא קיימת / חוקים ישנים): הודעה "התכונה תפעל אחרי עדכון השרת", בלי קריסה.
   רכיבי D1 בלבד (.li .card .btn .chip .f .tag .sec .empty .note), משתני ערכת נושא, בלי צבע קבוע. */
(function(){
'use strict';
if(typeof ACT==='undefined'||typeof V==='undefined'||!window.__ox)return;
const O=window.__ox,NB='_';
const fnCall=(n,d)=>{d=d&&typeof d==='object'?d:{};if(SY&&SY.sa&&SY.bizId&&!('bizId'in d))d=Object.assign({bizId:SY.bizId},d);return window.fnCall(n,d)};
const on=()=>(isA()||isW()||!!(SY&&SY.sa))&&bzF('orders')&&wp('ord');
const mgr=()=>isA()||!!(SY&&SY.sa);
const hasBr=()=>brAll().filter(b=>b.on).length>0;
const bn=id=>id===NB||!id?'':brNm(id);
const dec=d=>Object.assign({id:idOf(d)},Object.fromEntries(Object.entries(d.fields||{}).map(([k,v])=>[k,fvj(v)])));
const rid=()=>{const a=new Uint8Array(12);crypto.getRandomValues(a);return 'r'+[...a].map(x=>x.toString(36).padStart(2,'0')).join('').slice(0,22)};
const tm=t=>{if(!t)return '';const d=new Date(t);return d.toLocaleDateString('he-IL',{day:'numeric',month:'numeric'})+' '+d.toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'})};
const n3=x=>Math.round(x*1000)/1000;
const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Jerusalem'}); // YYYY-MM-DD, שעון ישראל
const fmtD=v=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v||''));return m?m[3]+'/'+m[2]+'/'+m[1]:String(v||'')};
const Q={L:null,c:{},ld:{},st:'open',busy:0,lerr:'',cap:null,cust:{}};
const SENT='__qt_capture__';
const typing=()=>{const a=document.activeElement;return !!(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)&&a.closest('#main'))};
const redraw=v=>{if(cur().v===v&&!typing()&&!document.querySelector('#dlg[open]'))rerender()};
const loading=T=>({t:T,h:'<div class="empty">טוען…</div>'});
const deny=T=>({t:T,h:'<div class="empty">אין לך הרשאה להזמנות</div>'});
async function get1(p){try{const d=await fsx(p);return d?dec(d):null}catch(e){if(e&&e.code===404)return null;throw e}}

/* ---------- סטטוס, שגיאות ---------- */
const expired=q=>q.st==='open'&&typeof q.vu==='string'&&q.vu<today();
const kind=q=>q.st==='conv'?'conv':q.st==='cancel'?'cancel':expired(q)?'exp':'open';
const KL={open:'פתוחה',exp:'פג תוקף',conv:'הפכה להזמנה',cancel:'בוטלה'};
const GEN='הפעולה נכשלה, נסה שוב';
const OLDMSG='התכונה תפעל אחרי עדכון השרת';
// הפונקציה לא קיימת בשרת (404 / internal) או חוקים ישנים (403): בלי reason מהשרת והודעה כללית של האפליקציה
const isOld=e=>!!e&&!e.offline&&(e.reason==='internal'||(!e.reason&&(e.message===GEN||e.message==='אין לך הרשאה לפעולה הזו')));
const MSG={'qt-bad':'ההצעה לא ניתנת להמרה (מזהה ההמרה שלה כבר שימש). צרו הצעה חדשה.','quote-vm':'סוג הלקוח השתנה מאז ההצעה – צרו הצעה חדשה.','bad-br':'הסניף של ההצעה כבר לא פעיל.',
 'manager-only':'רק מנהל יכול לבצע את הפעולה הזו (למשל הצעה עם הנחה כללית).','qt-closed':'ההצעה כבר לא פתוחה.','no-qt':'ההצעה לא נמצאה.','qt-no-cell':'ניוד קווים לא נתמך בהצעת מחיר.','bad-days':'תוקף ההצעה: מספר ימים שלם בין 1 ל-365.',
 'mgr-self':'מנהל מאשר בעצמו – אין צורך בבקשה.','not-owner':'רק מי שיצר את ההצעה או מנהל יכולים לבטל אותה.','ar-off':'מסמכים ללקוח כבויים. מנהל מפעיל ב"הגדרות אישור הזמנה".','no-tpl':'אין תבנית ווטסאפ מאושרת להצעת מחיר.',
 'sum-mismatch':'הסכום במסמך לא תואם להצעה – לא נשלח.','bad-req':'הבקשה כבר שימשה להצעה אחרת. נסו שוב.'};
const msgOf=e=>{if(!e)return GEN;if(e.offline)return e.message;if(isOld(e))return OLDMSG;return MSG[e.reason]||e.message||GEN};
const err=e=>toast(msgOf(e));
const WHYS={'no-tpl':'אין תבנית ווטסאפ מאושרת','stopped':'"עצור הכל" פעיל','limit':'הגעתם למכסת ההודעות היומית','no-wa':'ווטסאפ העסקי לא מחובר','bad-to':'מספר או כתובת לא תקינים','no-to':'אין ללקוח טלפון / מייל','no-secrets':'שליחת מייל לא מוגדרת בשרת','send':'השליחה נכשלה'};
const CHN={wa:'ווטסאפ',mail:'מייל'};
const sentTxt=s=>`${CHN[s.ch]||s.ch}${s.to?' ('+s.to+')':''}: ${s.ok?'נשלח ✓':'לא נשלח – '+(WHYS[s.why]||s.why||'שגיאה')}`;
const whyTxt=w=>(Array.isArray(w)?w:[]).map(x=>x&&x.t==='exp'?'פג תוקף ב-'+fmtD(x.vu):x&&x.t==='floor'?'המחיר של '+(x.n||'מוצר')+' נמוך מהמינימום'+(x.min!=null?' ('+ils(x.min)+')':''):'').filter(Boolean).join(' · ');

/* ---------- טעינה ---------- */
const brWhere=()=>{const m=brMineIds();return m&&hasBr()?{fieldFilter:{field:{fieldPath:'br'},op:'IN',value:{arrayValue:{values:m.slice(0,30).map(s=>({stringValue:s}))}}}}:null};
async function listLoad(force){if(Q.busyL||(!force&&Q.L))return;Q.busyL=1;Q.lerr='';
 try{const sq={from:[{collectionId:'qt'}],limit:300},w=brWhere();if(w)sq.where=w;
  const r=await fsx(':runQuery',{method:'POST',body:JSON.stringify({structuredQuery:sq})});
  const L=(r||[]).filter(x=>x.document).map(x=>dec(x.document)).sort((a,b)=>(b.no||0)-(a.no||0));L.forEach(q=>{Q.c[q.id]=q});Q.L=L}
 catch(e){Q.L=[];Q.lerr=e&&e.offline?'אין חיבור לאינטרנט – נסו לרענן':OLDMSG}
 finally{Q.busyL=0;if(/^oxQt/.test(cur().v)&&!typing()&&!document.querySelector('#dlg[open]'))rerender()}}
async function one(id){if(Q.ld[id])return;Q.ld[id]=1;try{const q=await get1('/qt/'+id);Q.c[id]=q||false}catch(e){Q.c[id]=false}finally{Q.ld[id]=0;redraw('oxQtCard')}}
const put=(id,p)=>{const q=Q.c[id];if(q)Object.assign(q,p);if(Q.L&&q&&!Q.L.includes(q))Q.L.unshift(q)};
async function custMail(q){if(q.cust&&q.cust.mail)return q.cust.mail;if(!q.custId)return '';if(Q.cust[q.custId]===undefined){try{Q.cust[q.custId]=await get1('/cust/'+q.custId)}catch(e){Q.cust[q.custId]=null}}return(Q.cust[q.custId]||{}).mail||''}
async function custPhone(q){if(q.cust&&q.cust.phone)return q.cust.phone;if(!q.custId)return '';if(Q.cust[q.custId]===undefined){try{Q.cust[q.custId]=await get1('/cust/'+q.custId)}catch(e){Q.cust[q.custId]=null}}return(Q.cust[q.custId]||{}).phone||''}

/* ---------- טופס הזמנה חדשה: כפתור "שמור כהצעת מחיר" ---------- */
{const f=V.oxNew;if(f)V.oxNew=()=>{const r=f();try{if(r&&r.h&&on()&&r.h.includes('data-a="oxSave"')&&!r.h.includes('data-a="oxQtAsk"'))r.h=r.h.replace('<button class="btn g w" style="margin-top:8px" data-a="oxDrop">','<button class="btn g w" style="margin-top:8px" data-a="oxQtAsk">שמור כהצעת מחיר</button><button class="btn g w" style="margin-top:8px" data-a="oxDrop">')}catch(e){}return r}}
ACT.oxQtAsk=()=>{if(Q.busy)return;const m=window.__oxPre?window.__oxPre():'';if(m)return toast(m);
 dlg(`<h3>שמירה כהצעת מחיר</h3><form data-f="oxQtF"><label class="f"><span>בתוקף (ימים)</span><input name="days" type="number" inputmode="numeric" min="1" max="365" step="1" value="14" required></label>
  <p class="note">המחירים נשמרים כפי שהם עכשיו. ההצעה לא תופסת מלאי, ואפשר להפוך אותה להזמנה בהמשך.</p>
  <div class="row"><button class="btn grow">שמור הצעה</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`)};
FRM.oxQtF=async f=>{const x=fd(f),days=Number(x.days);if(!Number.isInteger(days)||days<1||days>365)return toast(MSG['bad-days']);const b=f.querySelector('button');if(b)b.disabled=true;closeDlg();await saveRun(days)};
// תופסים את הקריאה ל-createOrder שנבנית ב-ACT.oxSave (אותו ניקוי קלט, לקוח, פריטים, קרטונים) ושולחים אותה כ-qtSave
{const f=window.fnCall;if(typeof f==='function')window.fnCall=function(n,d){if(n==='createOrder'&&Q.cap){Q.cap.p=d;throw new Error(SENT)}return f.apply(this,arguments)}}
{const t=window.toast;if(typeof t==='function')window.toast=function(m){if(Q.cap&&m===SENT)return;return t.apply(this,arguments)}}
async function saveRun(days){const D=O.draft;if(!D||Q.busy)return;Q.busy=1;const cd=D.cdOk;D.cdOk=true;Q.cap={p:null};let p=null;
 try{try{await ACT.oxSave({disabled:false,dataset:{}})}catch(e){}p=Q.cap&&Q.cap.p}finally{Q.cap=null;D.cdOk=cd}
 try{if(!p)return; // בדיקה נכשלה – ההודעה כבר הוצגה
  if(p.cell)return toast(MSG['qt-no-cell']);
  const a={reqId:p.reqId,cust:p.cust,items:p.items,days};if(p.br)a.br=p.br;if(p.custId)a.custId=p.custId;if(p.note)a.note=p.note;if(D.disc>0&&mgr())a.disc=D.disc;
  const r=await fnCall('qtSave',a);
  if(O.draft===D)O.draft=null;Q.L=null;delete Q.c[r.id];
  toast(`הצעת מחיר #${r.no} נשמרה · ${ils(r.gross)} · בתוקף עד ${fmtD(r.vu)}`);
  const i=NAV.map(x=>x.v).lastIndexOf('oxNew');if(i>=0&&i===NAV.length-1)NAV.pop();go('oxQtCard',r.id)}
 catch(e){err(e)}finally{Q.busy=0}}

/* ---------- רשימת הצעות ---------- */
{const f=V.ox;if(f)V.ox=()=>{const r=f();try{if(r&&r.h&&on())r.h=r.h.replace('<div class="chips scroll-x nw" role="group" aria-label="סינון לפי סטטוס"','<button class="btn g s w" style="margin-top:6px" data-a="go" data-v="oxQt">הצעות מחיר</button><div class="chips scroll-x nw" role="group" aria-label="סינון לפי סטטוס"')}catch(e){}return r}}
const amt=q=>typeof q.gross==='number'?q.gross:q.total;
const rowH=q=>{const k=kind(q);return `<button class="li" data-a="go" data-v="oxQtCard" data-arg="${esc(q.id)}"><div class="m"><b>#${q.no} · ${esc(q.cust&&q.cust.name||'')}</b><small>${k==='exp'?'פג תוקף ב-':k==='open'?'בתוקף עד ':'תוקף עד '}${esc(fmtD(q.vu))}${hasBr()&&q.br&&q.br!==NB?' · '+esc(bn(q.br)):''}${q.apr&&q.apr.st==='req'&&k==='open'?' · ממתין לאישור מנהל':''}</small></div><span class="tag${k==='exp'?' t4':k==='conv'?' t3':''}">${KL[k]}</span><b class="a">${ils(amt(q))}</b></button>`};
V.oxQt=()=>{const T='הצעות מחיר';if(!on())return deny(T);if(!Q.L){listLoad();return loading(T)}
 const cnt=k=>Q.L.filter(q=>kind(q)===k).length,L=Q.L.filter(q=>kind(q)===Q.st);
 const sc=`<div class="chips scroll-x nw" role="group" aria-label="סינון הצעות" style="margin:8px 0">${Object.keys(KL).map(k=>`<button class="chip ${Q.st===k?'on':''}" data-a="oxQtSt" data-k="${k}" aria-pressed="${Q.st===k}">${KL[k]} ${cnt(k)}</button>`).join('')}</div>`;
 return{t:T,s:'פתוחות, פגו, הומרו, בוטלו',h:`<button class="btn w" data-a="go" data-v="oxNew">הצעה חדשה</button><p class="note" style="margin:4px 0 0">הצעה חדשה נשמרת מטופס ההזמנה, בכפתור "שמור כהצעת מחיר".</p>${sc}${Q.lerr?`<div class="empty">${esc(Q.lerr)}</div>`:L.length?L.map(rowH).join(''):`<div class="empty">אין הצעות ${esc(KL[Q.st])}</div>`}<button class="btn g s w" style="margin-top:8px" data-a="oxQtRe">רענן</button>`}};
ACT.oxQtSt=el=>{Q.st=el.dataset.k;rerender()};
ACT.oxQtRe=()=>{Q.L=null;rerender()};

/* ---------- כרטיס הצעה ---------- */
V.oxQtCard=id=>{const T='הצעת מחיר';if(!on())return deny(T);const q=Q.c[id];if(q===undefined){one(id);return loading(T)}if(!q)return{t:T,h:'<div class="empty">ההצעה לא נמצאה</div>'};
 const c=q.cust||{},k=kind(q),open=q.st==='open',ap=q.apr&&q.apr.st,isM=mgr();
 const items=(q.items||[]).map(it=>`<div class="li" style="cursor:default"><div class="m"><b>${esc(it.n)}</b><small>${it.ct?`${n3(it.qty/it.ct)} × קרטון (${it.ct} מארזים) · ${ils(it.price)} למארז`:`${n3(it.qty)} × ${ils(it.price)}`}</small></div><b class="a">${ils(Math.round(it.qty*it.price*100)/100)}</b></div>`).join('');
 const rw=(a,b,s)=>`<div class="row" style="justify-content:space-between"><span>${a}</span>${s?`<span>${b}</span>`:`<b>${b}</b>`}</div>`;
 const tot=typeof q.gross==='number'?`<div class="card" style="margin:8px 0">${q.disc?rw('הנחה כללית',q.disc+'%',1):''}${q.vm==='ex'?rw('לפני מע"מ',ils(q.net))+rw('מע"מ '+q.vr+'%',ils(q.vat)):rw('מתוכם מע"מ '+q.vr+'%',ils(q.vat),1)}<div class="row" style="justify-content:space-between"><b>לתשלום</b><b class="amt">${ils(q.gross)}</b></div></div>`:`<div class="card" style="margin:8px 0"><div class="row" style="justify-content:space-between"><b>סה״כ</b><b class="amt">${ils(q.total)}</b></div></div>`;
 const vh=k==='exp'?`<p style="margin:6px 0 0;color:var(--bad)"><b>פג תוקף ב-${esc(fmtD(q.vu))}</b></p>`:`<p style="margin:6px 0 0"><b>בתוקף עד ${esc(fmtD(q.vu))}</b></p>`;
 const aph=open&&ap==='req'?`<p class="note" style="margin:4px 0 0">ממתין לאישור מנהל${q.apr.byName?' · ביקש/ה '+esc(q.apr.byName):''}</p>`:ap==='ok'?`<p class="note" style="margin:4px 0 0">מנהל אישר${q.apr.byName?' ('+esc(q.apr.byName)+')':''} – אפשר להפוך להזמנה גם אם פג התוקף או שהמחיר נמוך מהמינימום.</p>`:'';
 const cv=q.st==='conv'&&q.ord?`<div class="card" style="margin:8px 0;border-color:var(--acc)"><b>הפכה להזמנה #${esc(q.ord.no)}</b><button class="btn g s" style="margin-top:6px" data-a="oxQtOrd" data-id="${esc(q.ord.id)}">פתח את ההזמנה</button></div>`:'';
 const needReq=open&&!isM&&k==='exp'&&ap!=='ok'&&ap!=='req';
 const main=open?`<div class="row" style="margin-top:10px">${needReq?`<button class="btn grow" data-a="oxQtReq" data-id="${esc(q.id)}">בקש אישור מנהל</button>`:`<button class="btn grow" data-a="oxQtConv" data-id="${esc(q.id)}">הפוך להזמנה</button>`}${isM&&ap==='req'?`<button class="btn g grow" data-a="oxQtOk" data-id="${esc(q.id)}">אשר</button>`:''}</div>`:'';
 const more=q.st!=='cancel'?`<div class="row" style="margin-top:8px"><button class="btn g grow" data-a="oxQtShare" data-id="${esc(q.id)}">שיתוף</button><button class="btn g grow" data-a="oxQtSendD" data-id="${esc(q.id)}" data-ch="wa">ווטסאפ</button><button class="btn g grow" data-a="oxQtSendD" data-id="${esc(q.id)}" data-ch="mail">מייל</button></div>`:'';
 const sent=(q.sent||[]).length?`<div class="note" style="margin-top:6px">${q.sent.slice(-4).map(s=>`<div>${esc(tm(s.at))} · ${esc(sentTxt(s))}</div>`).join('')}</div>`:'';
 return{t:'הצעת מחיר #'+q.no,s:KL[k],h:`<div class="card"><div class="row" style="justify-content:space-between"><span><b>${esc(c.name||'')}</b></span><span class="tag${k==='exp'?' t4':k==='conv'?' t3':''}">${KL[k]}</span></div>
 <p style="margin:6px 0"><a href="tel:${esc(c.phone)}" dir="ltr" style="color:var(--acc);display:inline-flex;min-height:44px;align-items:center">${esc(c.phone||'')}</a></p>${c.addr?`<p class="note" style="margin:0">${esc(c.addr)}</p>`:''}${c.mail?`<p class="note" style="margin:0" dir="ltr">${esc(c.mail)}</p>`:''}
 <p class="note" style="margin:6px 0 0">${tm(q.at)}${hasBr()&&q.br&&q.br!==NB?' · סניף '+esc(bn(q.br)):''}${q.byName?' · הזין '+esc((window.NM&&window.NM.byPfx&&window.NM.byPfx(q.byName))||q.byName):''}</p>${q.note?`<p style="margin:6px 0 0">${esc(q.note)}</p>`:''}${vh}${aph}</div>
 ${cv}<div class="sec"><h3>פריטים</h3></div>${items}${tot}<p class="note" style="margin:0">ההצעה לא תופסת מלאי. ההזמנה תיווצר במחירי ההצעה.</p>${main}${more}${sent}
 ${open?`<button class="btn g w" style="margin-top:14px" data-a="oxQtCancel" data-id="${esc(q.id)}">בטל הצעה</button>`:''}`}};
// תווית ביומן ההזמנה (act:'quote' נוספה בשרת; LOGW שייך לקובץ ההזמנות, ולכן מתקנים בתצוגה)
{const f=V.oxOrd;if(f)V.oxOrd=id=>{const r=f(id);try{if(r&&r.h&&r.h.includes('quote'))r.h=r.h.replace(/(<div class="note" style="padding:6px 0;border-bottom:1px solid var\(--line\)">[^<]*? · )quote(?= ·|<)/g,'$1הצעת מחיר')}catch(e){}return r}}
ACT.oxQtOrd=el=>{O.L=null;window.__oxReload&&window.__oxReload();go('oxOrd',el.dataset.id)};

/* ---------- פעולות ---------- */
const guard=async(el,fn)=>{if(Q.busy)return;Q.busy=1;if(el)el.disabled=true;try{return await fn()}finally{Q.busy=0;if(el)el.disabled=false}};
async function refresh(id){try{const q=await get1('/qt/'+id);if(q){Q.c[id]=q;if(Q.L){const i=Q.L.findIndex(x=>x.id===id);if(i>=0)Q.L[i]=q}}}catch(e){}redraw('oxQtCard')}
function convRun(id,el){return guard(el,async()=>{try{const r=await fnCall('qtConvert',{id});const n=r.ord&&r.ord.no;put(id,{st:'conv',ord:r.ord});
  const w=whyTxt(r.why);toast(r.dup?`ההצעה כבר הפכה להזמנה #${n}`:`ההצעה הפכה להזמנה #${n}${w&&mgr()?' · שימו לב: '+w:''}`);
  O.L=null;window.__oxReload&&window.__oxReload();Q.L=null;const i=NAV.map(x=>x.v).lastIndexOf('oxQtCard');if(i>=0&&i===NAV.length-1)NAV.pop();go('oxOrd',r.ord.id)}
 catch(e){closeDlg();if(e&&e.reason==='quote-approval'&&!mgr()){const q=Q.c[id]||{},req=q.apr&&q.apr.st==='req';
   dlg(`<h3>נדרש אישור מנהל</h3><p>${esc(e.message||'')}</p><p class="note">${req?'בקשת האישור כבר נשלחה. אחרי שמנהל יאשר אפשר להפוך להזמנה.':'עובד לא יכול להפוך הצעה כזו להזמנה בלי אישור מנהל.'}</p><div class="row">${req?'':`<button class="btn grow" data-a="oxQtReq" data-id="${esc(id)}">בקש אישור מנהל</button>`}<button class="btn g grow" data-a="closeDlg">סגור</button></div>`)}
  else{err(e);refresh(id)}}})}
ACT.oxQtConv=el=>{const id=el.dataset.id,q=Q.c[id];if(!q||Q.busy)return;const ex=expired(q);
 if(mgr())return dlg(`<h3>להפוך את ההצעה להזמנה?</h3>${ex?`<p style="color:var(--bad)"><b>אזהרה: ההצעה פגה ב-${esc(fmtD(q.vu))}.</b></p>`:''}<p class="note">ההזמנה תיווצר במחירי ההצעה${ex?' גם שהתוקף עבר':''}, גם אם המחירון או העלות השתנו מאז. המלאי יופחת.</p><div class="row"><button class="btn grow" data-a="oxQtConvGo" data-id="${esc(id)}">${ex?'הפוך בכל זאת':'הפוך להזמנה'}</button><button class="btn g grow" data-a="closeDlg">ביטול</button></div>`);
 convRun(id,el)};
ACT.oxQtConvGo=el=>{closeDlg();convRun(el.dataset.id,null)};
ACT.oxQtReq=el=>{const id=el.dataset.id;closeDlg();guard(el,async()=>{try{const r=await fnCall('qtSet',{id,act:'req'});put(id,{apr:r&&r.apr||{st:'req'}});toast('בקשת האישור נשלחה למנהל');await refresh(id)}catch(e){err(e);refresh(id)}})};
ACT.oxQtOk=el=>{const id=el.dataset.id;guard(el,async()=>{try{const r=await fnCall('qtSet',{id,act:'ok'});put(id,{apr:r&&r.apr||{st:'ok'}});toast('אושר. אפשר להפוך להזמנה');await refresh(id)}catch(e){err(e);refresh(id)}})};
ACT.oxQtCancel=el=>{const id=el.dataset.id;ask('לבטל את הצעת המחיר? אי אפשר לחזור לפתוחה.',()=>guard(null,async()=>{try{await fnCall('qtSet',{id,act:'cancel'});put(id,{st:'cancel'});toast('ההצעה בוטלה');await refresh(id)}catch(e){err(e);refresh(id)}}),'כן, בטל')};
ACT.oxQtShare=async el=>{if(el.dataset.busy)return;closeDlg();el.dataset.busy='1';try{const r=await fnCall('qtPdf',{id:el.dataset.id});await dxShareDU('data:application/pdf;base64,'+r.b64,'הצעת מחיר '+r.no)}catch(e){err(e)}finally{delete el.dataset.busy}};
ACT.oxQtSendD=async el=>{const q=Q.c[el.dataset.id];if(!q)return;const ch=el.dataset.ch;const v=ch==='wa'?await custPhone(q):await custMail(q);
 dlg(`<h3>שליחת הצעת מחיר ב${CHN[ch]}</h3><form data-f="oxQtSendF"><input type="hidden" name="id" value="${esc(q.id)}"><input type="hidden" name="ch" value="${esc(ch)}"><input type="hidden" name="q" value="${rid()}">
  <label class="f"><span>${ch==='wa'?'מספר ווטסאפ':'כתובת מייל'}</span><input name="to" value="${esc(v)}" dir="ltr" ${ch==='wa'?'inputmode="tel"':'type="email"'} required maxlength="254"></label>
  <div class="row"><button class="btn grow">שלח</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`)};
const noTpl=id=>dlg(`<h3>ווטסאפ מהשרת עדיין לא מוגדר</h3><p>${esc(MSG['no-tpl'])} אפשר לשתף את ההצעה ישירות מהטלפון.</p><div class="row"><button class="btn grow" data-a="oxQtShare" data-id="${esc(id)}">שיתוף מהטלפון</button><button class="btn g grow" data-a="closeDlg">סגור</button></div>`);
FRM.oxQtSendF=async f=>{const x=fd(f),b=f.querySelector('button');if(Q.busy)return;Q.busy=1;b.disabled=true;
 try{const r=await fnCall('qtSend',{id:x.id,reqId:x.q,ch:x.ch,to:String(x.to||'').trim()});closeDlg();const s=(r&&r.sent)||[];put(x.id,{sent:((Q.c[x.id]||{}).sent||[]).concat(s).slice(-50)});
  if(x.ch==='wa'&&s.some(z=>!z.ok&&z.why==='no-tpl'))noTpl(x.id);else toast(s.map(sentTxt).join(' · ')||'נשלח');redraw('oxQtCard')}
 catch(e){b.disabled=false;if(e&&e.reason==='no-tpl'){closeDlg();noTpl(x.id)}else err(e)}finally{Q.busy=0}};
window.__oxQt={Q,kind,today,fmtD};
})();
