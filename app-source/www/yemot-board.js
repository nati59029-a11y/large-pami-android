/* "ההודעות שבקו": בכל מסך שלוחה – "בקו עכשיו" ו"ירדו בשבוע האחרון". קובץ עצמאי, נטען אחרי yemot-line.js.
   עובד: רואה ומאזין (שלוחות 1-3). מנהל: גם מוריד, מאריך תוקף (מבצעים ושלוחה 4 זמנית) ומחזיר לקו.
   ההרשאות נאכפות בשרת (getLineBoard / getLineAudio / removeLineItem / extendLineItem / restoreLineItem). כאן רק נוחות: מה מוצג למי.
   כל פעולה של מנהל עוברת חלון אישור שאומר בדיוק מה יקרה ובאיזו שלוחה. אין צינתוק בשום פעולה כאן.
   הרשימה נטענת רק כשפותחים את השלוחה. משתמש ב: window.ylApi (מ-yemot-line.js), ACT, INP, dlg, closeDlg, toast, esc, isA, cur, ypSpeak, ypLoad, ypStop. */
(function(){
'use strict';
if(typeof ACT==='undefined'||!window.ylApi)return;
const A=window.ylApi;
const SLOTS={'1':'recipes','2':'promos','3':'updates','4':'hours',open:'opening'}; // מסך ← שלוחה
const NAME={recipes:'שלוחה 1 · מתכונים',promos:'שלוחה 2 · מבצעים',updates:'שלוחה 3 · עדכונים',hours:'שלוחה 4 · שעות וכתובת',opening:'הודעת הפתיחה'};
const SCR=Object.fromEntries(Object.entries(SLOTS).map(([a,s])=>[s,a]));
const WHY={removed:'הורדה',expired:'פג תוקף',replaced:'הוחלפה',['legacy-removed']:'קובץ ותיק שהוסר'};
const MSG={'restore-too-old':'אפשר להחזיר רק הודעות שירדו בשבוע האחרון.','restore-not-down':'ההודעה הזו עדיין בקו.','already-on-line':'ההודעה הזו כבר הוחזרה לקו.',
 'no-expiry':'לפריט הזה אין תאריך הורדה. אפשר להאריך רק מבצעים והודעות זמניות בשלוחה 4.','item-not-live':'הפריט כבר לא בקו.','item-uncertain':'מצב הפריט בקו עוד לא ברור. רעננו ונסו שוב בעוד דקה.',
 'no-saved-content':'אין עותק של ההודעה הזו, ולכן אי אפשר להחזיר אותה.','name-taken':'בשלוחה כבר יש קובץ בשם הזה. כדי לא לדרוס אותו, הקובץ לא הוחזר.',
 'listen-limit':'הגעתם למכסת ההאזנות מהקו להיום. נסו שוב מחר.','listen-unavailable':'לא הצלחנו להביא את ההקלטה מהקו. נסו שוב.','audio-too-big':'הקובץ גדול מדי להשמעה באפליקציה.',
 'date-required':'חובה לבחור תאריך הורדה.','tzintuk-not-with-recording':'הודעה מוקלטת נשלחת לקו בלי צינתוק.',
 'backup-failed':'לא הצלחנו לשמור עותק של מה שבקו, ולכן שום דבר לא נמחק ולא הוחלף. נסו שוב מאוחר יותר.',
 'no-backup-confirm':'אין עותק שמור של ההקלטה הזו. אחרי ההורדה לא יהיה אפשר להחזיר אותה. לאשר?','cost-confirm-needed':'אין שמע שמור להודעה הזו. ההחזרה תקריא אותה מחדש בקול האנושי ותנצל חלק מהמכסה. לאשר?'};
const B={}; // slot -> {r,err,at,loading}
let P=null; // נגן יחיד: {key,title,url,text,mode}
let D=null; // חלון אישור פעיל
let busy=false;
const heDay=iso=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(iso||'');return m?`${+m[3]}.${+m[2]}.${m[1]}`:''};
const fdt=iso=>{const d=new Date(iso);return isNaN(d)?'':new Intl.DateTimeFormat('he-IL',{timeZone:'Asia/Jerusalem',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(d)};
const fhm=ms=>new Intl.DateTimeFormat('he-IL',{timeZone:'Asia/Jerusalem',hour:'2-digit',minute:'2-digit'}).format(new Date(ms));
const errT=e=>{const r=e&&e.reason;if(e&&e.msg&&A.he(e.msg))return e.msg;if(r&&MSG[r])return MSG[r];return A.errMsg(e)};
const keyOf=(ref)=>ref?[ref.kind,ref.id||'',ref.ext||'',ref.file||''].join('|'):'';
const refAttr=ref=>esc(JSON.stringify(ref));
// ---------- תצוגה ----------
const tag=(c,t)=>`<span class="tag ${c}">${t}</span>`; // תגית סטנדרטית של האפליקציה
function row(slot,x,mgr){
 const legacy=x.origin==='legacy',ttl=x.title||x.file||'ללא שם',k=keyOf(x.ref);
 const tags=[legacy?tag('','קובץ ותיק'):tag('t2','מהאפליקציה'),x.kind==='audio'?tag('t2','הקלטה'):'',x.uncertain?tag('t1','לא ודאי'):''].join('');
 const meta=[legacy&&x.file?`<span dir="ltr">${esc(x.file)}</span>`:'',x.createdAt?esc(fdt(x.createdAt)):'',x.byRole?(x.byRole==='manager'?'מנהל':'עובד'):'',x.until?'יורד אחרי '+esc(heDay(x.until)):''].filter(Boolean).join(' · ');
 const a=x.actions||{};
 const btns=[x.listen&&x.listen!=='none'?`<button class="btn s g" data-a="ybListen" data-r="${refAttr(x.ref)}" data-t="${esc(ttl)}">האזן</button>`:''];
 if(mgr){ // הסתרה היא נוחות בלבד; השרת דוחה עובד
  if(a.extend)btns.push(`<button class="btn s g" data-a="ybExtend" data-s="${slot}" data-r="${refAttr(x.ref)}" data-t="${esc(ttl)}" data-u="${esc(x.until||'')}">האריך תוקף</button>`);
  if(a.remove)btns.push(`<button class="btn s g" data-a="ybRemove" data-s="${slot}" data-r="${refAttr(x.ref)}" data-t="${esc(ttl)}" data-l="${legacy?1:0}">הורד</button>`)}
 return`<div class="li" style="cursor:default" data-k="${esc(k)}"><div class="m"><b>${esc(ttl)}</b><div>${tags}</div><small>${meta}</small><div class="row" style="margin-top:8px">${btns.join('')}</div></div></div>`}
function rec(slot,x,mgr){
 const ttl=x.title||'ללא שם',rs=x.restore||{};
 const tags=[tag('',WHY[x.downReason]||'ירדה'),x.kind==='audio'?tag('t2','הקלטה'):'',x.hasSavedAudio?'':tag('t1','ללא שמע שמור')].join('');
 const meta=[x.downAt?esc(fdt(x.downAt)):'',x.until?'היה עד '+esc(heDay(x.until)):''].filter(Boolean).join(' · ');
 const btns=[`<button class="btn s g" data-a="ybListen" data-r="${refAttr(x.ref)}" data-t="${esc(ttl)}">האזן</button>`];
 if(mgr&&rs.allowed)btns.push(`<button class="btn s g" data-a="ybRestore" data-s="${slot}" data-r="${refAttr(x.ref)}" data-t="${esc(ttl)}" data-nu="${rs.needsUntil?1:0}" data-c="${rs.costNote?1:0}">החזר לקו</button>`);
 return`<div class="li" style="cursor:default"><div class="m"><b>${esc(ttl)}</b><div>${tags}</div><small>${meta}</small><div class="row" style="margin-top:8px">${btns.join('')}</div></div></div>`}
function playerHtml(){if(!P)return'';
 const body=P.mode==='audio'?`<audio controls ${P.fresh?'autoplay ':''}src="${P.url}" style="width:100%"></audio>`:`<p class="note" style="margin:6px 0 0">${esc(P.text||'')}</p><p class="note" style="margin:4px 0 0">הקראה בטלפון בלבד (קירוב): זה לא השמע של הקו.</p>`;
 return`<div class="card" id="ybPlayer"><div class="sec" style="margin:0 0 8px"><h3>${esc(P.title)}</h3><button class="btn s g" data-a="ybStop">סגור</button></div>${body}</div>`}
function html(slot){
 const S=B[slot],mgr=A.isMgr();
 if(!S||(!S.r&&!S.err))return`<p class="note">טוען…</p>`;
 let h='';
 if(S.err&&!S.r)return`<p class="note" style="color:var(--bad)">לא הצלחנו לטעון: ${esc(S.err)}</p><button class="btn s g" data-a="ybReload" data-s="${slot}">נסה שוב</button>`;
 const r=S.r,on=r.onLine||[],rc=r.recent||[];
 const info=[r.fetchedAt?'עודכן '+fhm(r.fetchedAt):'',r.stale?'<b style="color:var(--warn)">הקו לא ענה, מוצג מידע שמור</b>':''].filter(Boolean).join(' · ');
 h+=`<div class="sec"><h3>בקו עכשיו (${on.length})</h3><button class="btn s g" data-a="ybReload" data-s="${slot}"${S.loading?' disabled':''}>${S.loading?'טוען…':'רענן'}</button></div>`;
 h+=`<p class="note" style="margin:0 0 6px">${NAME[slot]}. מהגבוה לנמוך = לפי סדר ההשמעה.${info?' '+info:''}</p>`;
 if(S.err)h+=`<p class="note" style="color:var(--bad)">הרענון נכשל: ${esc(S.err)}</p>`;
 h+=playerHtml();
 h+=on.length?on.map(x=>row(slot,x,mgr)).join(''):'<p class="note">אין כרגע הודעות בשלוחה.</p>';
 if((r.missing||[]).length)h+=`<p class="note" style="color:var(--warn)">נרשמו מהאפליקציה אבל לא נמצאו בקו: ${r.missing.map(m=>esc(m.title||m.file)).join(', ')}</p>`;
 h+=`<div class="sec"><h3>ירדו בשבוע האחרון (${rc.length})</h3></div>`;
 h+=rc.length?rc.map(x=>rec(slot,x,mgr)).join(''):'<p class="note">לא ירדו הודעות בשבוע האחרון.</p>';
 return h}
function paint(slot){const el=document.getElementById('ylList');if(el&&A.here(SCR[slot]))el.innerHTML=html(slot)}
async function load(a,force){
 const slot=SLOTS[a];if(!slot)return;
 if(slot==='hours'||slot==='opening'){if(!A.isMgr())return}
 const S=B[slot]=B[slot]||{};if(S.loading)return;
 if(!force&&S.r&&Date.now()-S.at<60000){paint(slot);return}
 S.loading=true;if(force||!S.r)paint(slot);
 try{const r=await A.call('getLineBoard',{slot,refresh:!!force},60000);S.r=r;S.err=null;S.at=Date.now()}
 catch(e){S.err=errT(e)}
 finally{S.loading=false}
 paint(slot)}
function stopPlayer(){try{window.ypStop&&ypStop()}catch(e){}if(P&&P.url)URL.revokeObjectURL(P.url);P=null}
// ---------- האזנה (נגן אחד בכל רגע) ----------
const b64blob=(b64,mime)=>{const bin=atob(b64),u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return new Blob([u],{type:mime||'audio/wav'})};
ACT.ybListen=async el=>{
 if(busy)return;let ref;try{ref=JSON.parse(el.dataset.r)}catch(e){return}
 const slot=SLOTS[cur().a||''];busy=true;el.disabled=true;const t0=el.textContent;el.textContent='טוען…';
 stopPlayer();
 try{const r=await A.call('getLineAudio',{ref},60000);
  if(r&&r.mode==='audio'&&r.data){P={title:el.dataset.t,mode:'audio',url:URL.createObjectURL(b64blob(r.data,r.mime)),fresh:true}}
  else if(r&&r.mode==='text'){P={title:el.dataset.t,mode:'text',text:r.text};try{if(window.ypLoad)await ypLoad();if(window.ypSpeak)await ypSpeak(r.text,{})}catch(e){}}
  else throw new Error('x')}
 catch(e){A.toast(errT(e))}
 finally{busy=false}
 if(slot)paint(slot);if(P)P.fresh=false};
ACT.ybStop=()=>{stopPlayer();const slot=SLOTS[cur().a||''];if(slot)paint(slot)};
ACT.ybReload=el=>{const s=el.dataset.s;load(SCR[s],true)};
// ---------- חלון אישור ----------
function dOpen(d){
 D=Object.assign({busy:false,rid:null},d);
 dlg(`<h3>${esc(D.title)}</h3><form data-f="ybform" onsubmit="return false"><p class="note" id="ybMsg" style="margin:0 0 12px">${esc(D.msg)}</p>${D.warn?`<p class="note" style="color:var(--warn);font-weight:700;margin:0 0 12px">${esc(D.warn)}</p>`:''}${D.dateReq?dateHtml():''}
 <p id="ybWhy" class="note" style="color:var(--bad);font-weight:700;margin:6px 0"></p>
 <div class="row"><button type="button" class="btn ${D.danger?'r':''} grow" data-a="ybOk" id="ybOk">${esc(D.ok)}</button><button type="button" class="btn g grow" data-a="ybCancel">ביטול</button></div></form>`);
 const dd=document.getElementById('dlg');
 dd.addEventListener('cancel',e=>{if(D&&D.busy)e.preventDefault()},{once:true});
 dd.addEventListener('close',()=>{if(D&&!D.busy)D=null},{once:true});
 dDraw()}
function dateHtml(){const t=A.isoDay(new Date());
 return`<label class="f"><span>${esc(D.dateLabel)}</span><input id="ybDate" type="date" value="${esc(D.date||'')}" min="${t}" max="${A.addDays(t,60)}" data-i="ybdate"></label><div class="chips" style="margin:0 0 12px">${[7,14,30].map(n=>`<button type="button" class="chip" data-a="ybDays" data-v="${n}">${n} ימים</button>`).join('')}</div>`}
function dBad(){if(!D||!D.dateReq)return'';const t=A.isoDay(new Date()),v=D.dateVal;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(v||''))return'יש לבחור תאריך';if(v<t)return'התאריך כבר עבר';if(v>A.addDays(t,60))return'אפשר עד 60 ימים קדימה';return''}
function dDraw(){const b=document.getElementById('ybOk'),w=document.getElementById('ybWhy'),c=document.querySelector('[data-a=ybCancel]');if(!D||!b)return;
 const bad=D.busy?'':dBad();b.disabled=!!bad||D.busy;if(c)c.disabled=D.busy;b.textContent=D.busy?'מבצע…':D.ok;if(w&&!D.err){w.textContent=bad;w.style.display=bad?'':'none'}}
INP.ybdate=el=>{if(!D)return;D.dateVal=el.value;D.err=null;const w=document.getElementById('ybWhy');if(w)w.textContent='';dDraw()};
ACT.ybDays=el=>{if(!D||D.busy)return;D.dateVal=A.addDays(A.isoDay(new Date()),+el.dataset.v);const i=document.getElementById('ybDate');if(i)i.value=D.dateVal;dDraw()};
ACT.ybCancel=()=>{if(D&&D.busy)return;D=null;closeDlg()};
ACT.ybOk=async()=>{
 const d=D;if(!d||d.busy||busy||dBad())return; // נעילה סינכרונית: לחיצה כפולה = בקשה אחת
 d.busy=true;busy=true;dDraw();
 try{const [fn,p]=d.req(d);const r=await A.call(fn,p,130000);
  D=null;closeDlg();A.toast(r&&A.he(r.message)?r.message:d.done);
  const S=B[d.slot];if(S){S.at=0;S.r&&(S.r.stale=true)}
  busy=false;await load(SCR[d.slot],false)}
 catch(e){d.busy=false;busy=false;
  const rs=e&&e.reason,w=document.getElementById('ybWhy');let m=errT(e);
  if(rs==='no-backup-confirm'){d.noBackup=true;d.ok='כן, הורד בלי עותק';d.danger=true}
  if(rs==='cost-confirm-needed'){d.cost=true;d.ok='כן, החזר ונצל מכסה'}
  d.err=true;dDraw();if(w){w.textContent=m;w.style.display=''}A.toast(m);
  const ok=document.getElementById('ybOk');if(ok&&(rs==='no-backup-confirm'||rs==='cost-confirm-needed'))ok.textContent=d.ok}
 finally{busy=false}};
const parse=el=>{try{return JSON.parse(el.dataset.r)}catch(e){return null}};
// ---------- הורדה באמצע ----------
ACT.ybRemove=el=>{const ref=parse(el),slot=el.dataset.s,legacy=el.dataset.l==='1',ttl=el.dataset.t;if(!ref)return;
 dOpen({slot,title:'להוריד מהקו?',danger:true,ok:'כן, הורד',done:'✓ הורד מהקו',
  msg:`${NAME[slot]}: «${ttl}» תורד מהקו ולא תושמע יותר.`+(legacy?' זה קובץ ותיק שלא הועלה מהאפליקציה: לפני המחיקה נשמר עותק, ואם אי אפשר לשמור עותק הקובץ לא יימחק.':'')+' ההודעה תופיע ב"ירדו בשבוע האחרון" ואפשר יהיה להחזיר אותה.',
  req:d=>{const base=ref.kind==='promo'?{promoKey:ref.id}:ref.kind==='file'?{ext:ref.ext,file:ref.file}:{id:ref.id};
   if(!d.rid)d.rid='yr'+A.rand();const p=Object.assign({requestId:d.rid},base);if(d.noBackup)p.confirmNoBackup=true;return['removeLineItem',p]}})};
// ---------- הארכת תוקף ----------
ACT.ybExtend=el=>{const ref=parse(el),slot=el.dataset.s,ttl=el.dataset.t,cu=el.dataset.u;if(!ref)return;
 dOpen({slot,title:'להאריך תוקף?',ok:'אשר הארכה',done:'✓ תאריך ההורדה עודכן',date:cu,dateVal:cu,dateReq:true,dateLabel:'עד איזה תאריך להשמיע (כולל)?',
  msg:`${NAME[slot]}: «${ttl}»${cu?' מושמעת עד '+heDay(cu):''}. התאריך החדש ייכנס לריצת הלילה. לא נשלחת שום פנייה לקו עכשיו.`,
  req:d=>{if(!d.rid||d.sig!==d.dateVal){d.rid='ye'+A.rand();d.sig=d.dateVal}
   return['extendLineItem',{requestId:d.rid,kind:ref.kind==='promo'?'promo':'item',id:ref.id,until:d.dateVal}]}})};
// ---------- החזרה לקו ----------
ACT.ybRestore=el=>{const ref=parse(el),slot=el.dataset.s,ttl=el.dataset.t,nu=el.dataset.nu==='1',cost=el.dataset.c==='1';if(!ref)return;
 dOpen({slot,title:'להחזיר לקו?',ok:'אשר והחזר',done:'✓ הוחזר לקו',date:nu?'':null,dateVal:'',dateReq:nu,dateLabel:'מתי להוריד את ההודעה מהקו?',
  warn:cost?'אין שמע שמור להודעה הזו. ההחזרה תקריא אותה מחדש בקול האנושי, ותנצל חלק ממכסת התווים החודשית. הקול עלול להישמע מעט שונה.':'',
  msg:`${NAME[slot]}: «${ttl}» תעלה לקו כהודעה חדשה ותושמע ראשונה. בלי צינתוק. ההודעה המקורית לא משתנה.`+(slot==='opening'?' היא תחליף את הפתיחה הנוכחית, שנשמרת קודם.':''),cost,
  req:d=>{if(!d.rid||d.sig!==d.dateVal){d.rid='yb'+A.rand();d.sig=d.dateVal}
   const p={requestId:d.rid,kind:ref.kind,id:ref.id};if(nu)p.until=d.dateVal;if(d.cost||cost)p.confirmCost=true;return['restoreLineItem',p]}})};
window.ylBoard={html,load,slots:SLOTS,stop:stopPlayer};
})();
