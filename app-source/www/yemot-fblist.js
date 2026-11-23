/* "לקוחות משוב בימות": מסך מנהל. קובץ עצמאי, נטען אחרי yemot-line.js. חושף window.yfOpen(), window.ytOpen() ("שליחת צינתוקים") ו-window.ynOpen() ("מספרים בקו", בסוף הקובץ).
   מציג את מצב רשימת הטלפונים של לקוחות המשוב בימות, סנכרון ידני, ומתג צינתוק ללקוחות המשוב.
   ההרשאות נאכפות בשרת (yemotFbList). כאן רק נוחות. כל טקסט מהשרת מוצג ב-textContent בלבד.
   משתמש ב: window.ylApi (מ-yemot-line.js), V, ACT, INP, go, dlg, closeDlg, esc, ico. */
(function(){
'use strict';
if(typeof ACT==='undefined'||typeof V==='undefined'||!window.ylApi)return;
const A=window.ylApi;
const ERR={'auth-failed':'הסיסמה של ימות לא התקבלה. פנו לתמיכה.','no-key':'הקו הטלפוני עוד לא מחובר בשרת. פנו למנהל.','busy':'סנכרון אחר כבר רץ.','timeout':'ימות לא ענה בזמן.','rate-limit':'ימות מגביל פניות. ננסה שוב בלילה.','template-missing':'הרשימה בימות לא נמצאה.','count-mismatch':'ימות לא אישר את כל המספרים. הם יישלחו שוב בריצה הבאה.'};
const Z={st:null,err:null,loading:false,syncing:false,msg:'',denied:false,tzBusy:false};
const fdt=iso=>{const d=new Date(iso);return isNaN(d)?'':new Intl.DateTimeFormat('he-IL',{timeZone:'Asia/Jerusalem',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(d)};
const lastErr=s=>{if(!s)return'';return ERR[s]||(A.he(s)?s:'שגיאה בחיבור לימות')};
const errT=e=>{if(e&&e.status==='PERMISSION_DENIED')return'המסך הזה פתוח למנהל בלבד.';if(e&&e.reason==='busy')return'סנכרון כבר רץ עכשיו. נסו שוב בעוד דקה.';return A.errMsg(e)};
const here=()=>!!document.getElementById('yfBox');
const num=(l,v)=>`<div class="li" style="cursor:default;margin:0"><div class="m"><small>${l}</small><b>${esc(String(v==null?0:v))}</b></div></div>`;
function html(){
 if(Z.denied)return'<div class="empty">המסך הזה פתוח למנהל בלבד.</div>';
 const s=Z.st;
 if(!s)return Z.err?`<p class="note" style="color:var(--bad)" id="yfErr"></p><button class="btn s g" data-a="yfLoad">נסה שוב</button>`:'<p class="note">טוען…</p>';
 const tz=s.tzMonth||{};
 return`<div class="card"><b id="yfList"></b><p class="note" style="margin:6px 0 0">כל לילה נשלחים אוטומטית רק מספרים חדשים ממשוב שאושר. בלי כפילויות.</p></div>
 <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${num('נשלחו לימות',s.sent)}${num('ממתינים',s.pending)}${num('נדחו (מספר לא תקין)',s.rejected)}${num('לא ודאי',s.uncertain)}</div>
 <div class="card" style="margin-top:12px"><small class="note">הריצה האחרונה</small><div><b id="yfLast"></b></div><p class="note" id="yfLE" style="color:var(--bad);margin:6px 0 0"></p></div>
 <button class="btn grow" data-a="yfSync" id="yfSyncB"${Z.syncing?' disabled':''}>${Z.syncing?'מסנכרן…':'סנכרן עכשיו'}</button>
 <p class="note" id="yfMsg" role="status" style="margin:8px 0 12px"></p>
 <button class="hcrow" data-a="yfTz" role="switch" aria-checked="${!!s.tzOn}"${Z.tzBusy?' disabled':''}><span><b>צינתוק גם ללקוחות המשוב כששולחים מבצע עם צינתוק</b><small>בתשלום: 0.1 יחידה לכל מספר</small></span><i class="sw" aria-hidden="true"></i></button>
 <p class="note" style="margin:8px 0 0">צינתוקים בתשלום החודש: <b id="yfTzN"></b></p>`}
function paint(){const el=document.getElementById('yfBox');if(!el)return;el.innerHTML=html();
 const s=Z.st,t=(id,v)=>{const n=document.getElementById(id);if(n)n.textContent=v};
 t('yfErr',Z.err||'');
 if(s){t('yfList',s.templateId!=null?`הרשימה בימות: נוצרה (מספר ${s.templateId})`:'הרשימה בימות: עוד לא נוצרה – תיווצר בסנכרון הראשון');
  t('yfLast',s.lastRun?fdt(s.lastRun):'עוד לא רצה');t('yfLE',s.lastError?lastErr(s.lastError):'');t('yfTzN',String((s.tzMonth&&s.tzMonth.count)||0));t('yfMsg',Z.msg)}}
async function load(){
 if(Z.loading)return;Z.loading=true;Z.err=null;
 try{Z.st=await A.call('yemotFbList',{action:'state'},60000);Z.denied=false}
 catch(e){if(e&&e.status==='PERMISSION_DENIED')Z.denied=true;else Z.err=errT(e)}
 finally{Z.loading=false}paint()}
V.yfb=()=>{setTimeout(load,0);return{t:'לקוחות משוב בימות',s:'מנהל',h:'<div id="yfBox"><p class="note">טוען…</p></div>'}};
window.yfOpen=()=>{if(!A.isMgr()){A.toast('המסך הזה פתוח למנהל בלבד.');return}Z.st=null;Z.err=null;Z.msg='';Z.denied=false;go('yfb')};
ACT.yfLoad=()=>{load()};
ACT.yfSync=async()=>{
 if(Z.syncing)return;Z.syncing=true;Z.msg='';paint();
 try{const r=await A.call('yemotFbList',{action:'sync'},130000);Z.st=r;const u=r&&r.run||{};
  Z.msg=`נוספו ${u.created||0}, נדחו ${u.rejected||0}`;A.toast(Z.msg)}
 catch(e){Z.msg=errT(e);A.toast(Z.msg);if(e&&e.status==='PERMISSION_DENIED')Z.denied=true}
 finally{Z.syncing=false}paint()};
async function setTz(on){
 Z.tzBusy=true;paint();
 try{Z.st=await A.call('yemotFbList',{action:'setTz',on},60000);Z.msg=''}
 catch(e){Z.msg=errT(e);A.toast(Z.msg)}
 finally{Z.tzBusy=false}paint()}
ACT.yfTz=()=>{if(!Z.st||Z.tzBusy)return;
 if(Z.st.tzOn){setTz(false);return}
 dlg(`<h3>להדליק צינתוק ללקוחות המשוב?</h3><p class="note" style="margin:0 0 12px">כל צינתוק ללקוחות המשוב בתשלום – 0.1 יחידה לכל מספר (לפי התיעוד של ימות). ${Z.st&&Number.isInteger(Z.st.tzMax)?`עד ${Z.st.tzMax} מספרים בכל שליחה; מעל זה לא נשלח להם צינתוק.`:''}</p><div class="row"><button type="button" class="btn grow" data-a="yfTzOk">כן, הדלק</button><button type="button" class="btn g grow" data-a="yfTzNo">ביטול</button></div>`)};
ACT.yfTzNo=()=>closeDlg();
ACT.yfTzOk=()=>{closeDlg();setTz(true)};

/* "שליחת צינתוקים" (מנהל, משימה 2026-11-18): צינתוק בלי מבצע, דרך sendLineTzintuk בשרת. חושף window.ytOpen().
   fb = רק ללקוחות דפי המשוב (בתשלום). all = הרשימה החינמית (כולל מי שנרשם בעצמו בקו) + לקוחות משוב שאינם בה.
   לפני שליחה: preview מהשרת (כמה בפועל ועלות משוערת) בחלון אישור. requestId נשמר עד תשובה ודאית – ניסיון חוזר לא שולח פעמיים. */
const TZ={busy:false,res:null,req:null,denied:false,cont:null}; // req = בקשה שלא קיבלה תשובה ודאית (אותו מזהה בניסיון הבא); cont = שליחה שאפשר להשלים (partial/failed)
const TZ_MS=330000; // ארוך מזמן הריצה של השרת (300 שניות)
const hhmm=iso=>{const d=new Date(iso);return isNaN(d)?'':new Intl.DateTimeFormat('he-IL',{timeZone:'Asia/Jerusalem',hour:'2-digit',minute:'2-digit'}).format(d)};
// תשובה ודאית מהשרת (עם סטטוס שאינו תקלה כללית) – אפשר לשכוח את המזהה. בלי סטטוס (5xx בלי JSON, פסק זמן, ניתוק) – שומרים אותו.
const sure=e=>!!(e&&e.status&&!['INTERNAL','UNAVAILABLE','UNKNOWN','DEADLINE_EXCEEDED'].includes(e.status));
const TZN={fb:'ללקוחות דפי המשוב',all:'לכל הלקוחות'};
const TZST={done:'נשלח',partial:'נשלח חלקית',failed:'לא נשלח',uncertain:'לא ידוע אם נשלח',capped:'לא נשלח – מעל המכסה','not-sent':'לא נשלח'};
const n0=v=>Number.isFinite(+v)?+v:0;
function tzHtml(){
 if(TZ.denied)return'<div class="empty">המסך הזה פתוח למנהל בלבד.</div>';
 const R=TZ.res;
 return`<div class="card"><p class="note" style="margin:0">צינתוק = שיחה קצרה שמודיעה ללקוחות שיש חדש בקו. לפני השליחה יוצג כמה מספרים יקבלו ומה העלות המשוערת.</p></div>
 <button class="opt" data-a="ytAsk" data-v="fb" style="min-height:84px"${TZ.busy?' disabled':''}><span style="font-size:1.1rem;font-weight:800">צינתוק ללקוחות דפי משוב<small>רק למי שברשימה "לקוחות משוב" · בתשלום</small></span>${ico('chev')}</button>
 <button class="opt" data-a="ytAsk" data-v="all" style="min-height:84px"${TZ.busy?' disabled':''}><span style="font-size:1.1rem;font-weight:800">צינתוק לכל הלקוחות<small>כולל מי שנרשם בעצמו בקו · כל מספר מקבל אחד</small></span>${ico('chev')}</button>
 <p class="note" id="ytMsg" role="status" style="margin:8px 0"></p>
 ${R?`<div class="card" id="ytRes"><b id="ytResH"></b><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:8px">${num('נשלחו',n0(R.sent))}${num('נכשלו',n0(R.failed))}${num('לא ודאי',n0(R.uncertain))}</div><p class="note" id="ytResM" style="margin:8px 0 0"></p>${TZ.cont&&R.requestId===TZ.cont.id?`<button class="btn grow" data-a="ytCont" style="margin-top:10px"${TZ.busy?' disabled':''}>השלם את מי שלא קיבל</button>`:''}</div>`:''}`}
function tzPaint(msg){const el=document.getElementById('ytBox');if(!el)return;el.innerHTML=tzHtml();
 const t=(id,v)=>{const x=document.getElementById(id);if(x)x.textContent=v};
 t('ytMsg',msg||'');
 const R=TZ.res;if(R){t('ytResH',`${TZN[R.target]||''}: ${TZST[R.status]||''}${R.duplicate?' (כבר טופל קודם)':''}`);t('ytResM',A.he(R.message)?R.message:'')}}
V.ytz=()=>{if(!A.isMgr())return{t:'שליחת צינתוקים',h:'<div class="empty">המסך הזה פתוח למנהל בלבד.</div>'};setTimeout(()=>tzPaint(),0);return{t:'שליחת צינתוקים',s:'מנהל',h:'<div id="ytBox"><p class="note">טוען…</p></div>'}};
window.ytOpen=()=>{if(!A.isMgr()){A.toast('המסך הזה פתוח למנהל בלבד.');return}if(!TZ.cont)TZ.res=null;TZ.denied=false;go('ytz')}; // שליחה שאפשר להשלים נשארת מוצגת גם אחרי יציאה וחזרה
ACT.ytAsk=async el=>{
 const target=el&&el.dataset&&el.dataset.v;if(!TZN[target]||TZ.busy)return;
 TZ.busy=true;tzPaint('בודק כמה מספרים יקבלו…');let p=null,msg='';
 try{p=await A.call('sendLineTzintuk',{action:'preview',target},60000)}
 catch(e){if(e&&e.status==='PERMISSION_DENIED')TZ.denied=true;msg=A.errMsg(e)}
 finally{TZ.busy=false}tzPaint(msg);if(!p)return;
 const free=n0(p.free),paid=n0(p.paid),total=free+paid;
 TZ.ask={target,total};
 const body=total===0?'<p class="note">אין למי לשלוח: הרשימות ריקות.</p>'
  :`<p style="margin:0 0 6px">יקבלו: <b>${esc(String(total))}</b> מספרים${target==='all'?` (חינם: ${esc(String(free))}, בתשלום: ${esc(String(paid))})`:' (כולם בתשלום)'}.</p>
  <p class="note" style="margin:0 0 6px">עלות משוערת: ${esc(String(n0(p.cost)))} יחידות – 0.1 יחידה לכל מספר בתשלום, לפי התיעוד של ימות.${target==='all'&&free?' הרשימה החינמית – בלי עלות.':''}</p>
  ${n0(p.skipped)?`<p class="note" style="margin:0 0 6px">${esc(String(n0(p.skipped)))} לקוחות משוב יצאו מרשימת הצינתוקים ולא יקבלו.</p>`:''}
  ${p.listReady===false?'<p class="note" style="margin:0 0 6px">רשימת "לקוחות משוב" עוד לא נוצרה בימות.</p>':''}
  ${p.recent&&p.recent.at?`<p class="note" style="color:var(--warn);margin:0 0 6px">נשלח כבר צינתוק היום ב-${esc(hhmm(p.recent.at))} ל-${esc(String(n0(p.recent.sent)))} מספרים. שליחה חדשה תגיע שוב לכולם.</p>`:''}
  ${p.capped?`<p class="note" style="color:var(--bad);margin:0 0 6px">מעל המכסה (${esc(String(n0(p.max)))} מספרים בתשלום בשליחה אחת). אי אפשר לשלוח.</p>`:''}`;
 dlg(`<h3>צינתוק ${TZN[target]}?</h3>${body}<div class="row">${total>0&&!p.capped?`<button type="button" class="btn grow" data-a="ytOk">כן, שלח צינתוק</button>`:''}<button type="button" class="btn g grow" data-a="ytNo">ביטול</button></div>`)};
ACT.ytNo=()=>{closeDlg();TZ.ask=null};
async function tzSend(target,id,resume){
 TZ.req={target,id,resume};TZ.busy=true;tzPaint(resume?'משלים…':'שולח…');let msg='';
 try{const r=await A.call('sendLineTzintuk',Object.assign({action:'send',target,requestId:id},resume?{resume:true}:{}),TZ_MS);
  TZ.res=r;TZ.req=null;TZ.cont=r&&['partial','failed'].includes(r.status)?{target,id}:null; // אפשר להשלים רק את מי שלא קיבל, עם אותו מזהה
  A.toast(A.he(r&&r.message)?r.message:'✓ נשלח')}
 catch(e){msg=A.errMsg(e);if(sure(e))TZ.req=null; // בלי תשובה ודאית: אותו מזהה בניסיון הבא – השרת לא ישלח פעמיים
  if(e&&e.status==='PERMISSION_DENIED')TZ.denied=true;A.toast(msg)}
 finally{TZ.busy=false}tzPaint(msg)}
ACT.ytOk=()=>{
 const q=TZ.ask;closeDlg();TZ.ask=null;if(!q||TZ.busy)return;
 const k=TZ.req&&TZ.req.target===q.target&&!TZ.req.resume?TZ.req:null; // בקשה קודמת בלי תשובה ודאית – אותו מזהה
 tzSend(q.target,k?k.id:'tz_'+A.rand(),false)};
ACT.ytCont=()=>{const c=TZ.cont;if(!c||TZ.busy)return;
 dlg(`<h3>להשלים את השליחה?</h3><p class="note" style="margin:0 0 12px">יישלח רק למי שלא קיבל בשליחה הזו. מי שכבר קיבל לא יקבל שוב ולא ייגבה עליו תשלום נוסף.</p><div class="row"><button type="button" class="btn grow" data-a="ytContOk">כן, השלם</button><button type="button" class="btn g grow" data-a="ytNo">ביטול</button></div>`)};
ACT.ytContOk=()=>{closeDlg();const c=TZ.cont;if(!c||TZ.busy)return;tzSend(c.target,c.id,true)};

/* "מספרים בקו" (מנהל, משימה 2026-11-19): המספרים ברשימה החינמית ובלקוחות משוב, חיפוש לפי מספר, וחסימה/ביטול חסימה בלקוחות משוב.
   yemotFbList { action:'numbers' } / { action:'block'|'unblock', phone }. ההרשאה נאכפת בשרת. חושף window.ynOpen().
   החיפוש מקומי: מתעלם ממקפים ורווחים, 972 ← 0, חלקי. מוצגות עד 200 תוצאות. כל טקסט מהשרת – esc/textContent בלבד. */
const NB={d:null,err:null,loading:false,q:'',busy:false,ask:null,denied:false};
const NB_MAX=200;
const NBE={'not-in-list':'המספר לא נמצא ברשימת לקוחות המשוב.','no-list':'רשימת לקוחות המשוב עוד לא נוצרה בימות.','uncertain':'ימות לא ענה בזמן. לא ידוע אם השינוי בוצע – הרשימה רועננה, בדקו שוב.','not-applied':'ימות לא עדכן את המספר. נסו שוב.'};
const nbErr=e=>{if(e&&e.status==='PERMISSION_DENIED')return'המסך הזה פתוח למנהל בלבד.';return(e&&NBE[e.reason])||A.errMsg(e)};
const dig=s=>String(s||'').replace(/\D/g,'');
// מה שהוקלד ← ספרות לחיפוש: +972/972/00972 בהתחלה ← 0
const nbKey=q=>{let d=dig(q);if(/^00972/.test(d))d='0'+d.slice(5);else if(/^972/.test(d)&&d.length>3)d='0'+d.slice(3);return d};
const nbFmt=p=>{const d=String(p||'');return /^0[57]\d{8}$/.test(d)?d.slice(0,3)+'-'+d.slice(3):/^0\d{8}$/.test(d)?d.slice(0,2)+'-'+d.slice(2):d};
function nbRows(){const D=NB.d;if(!D)return[];
 const fb=(Array.isArray(D.fb)?D.fb:[]).map(x=>({p:String(x&&x.p||''),b:!!(x&&x.b),n:String(x&&x.n||''),fb:true}));
 const fr=(Array.isArray(D.free)?D.free:[]).map(p=>({p:String(p||''),fb:false}));
 return fb.concat(fr).filter(r=>r.p).sort((a,b)=>a.p<b.p?-1:a.p>b.p?1:(a.fb?-1:1))}
const nbFree=()=>new Set((NB.d&&Array.isArray(NB.d.free)?NB.d.free:[]).map(String));
const nbGone=()=>new Set((NB.d&&Array.isArray(NB.d.gone)?NB.d.gone:[]).map(String)); // משימה 2026-11-23: יצאו מהרשימה החינמית
function nbList(){
 const fs=nbFree(),k=nbKey(NB.q),all=nbRows(),hit=k?all.filter(r=>dig(r.p).includes(k)):all,show=hit.slice(0,NB_MAX);
 const head=k?(hit.length?`נמצאו ${hit.length}${hit.length>NB_MAX?` · מוצגים ${NB_MAX} הראשונים – הקלידו עוד ספרות`:''}`:'לא נמצא מספר כזה בשתי הרשימות.')
  :(all.length>NB_MAX?`${all.length} מספרים · מוצגים ${NB_MAX} הראשונים – הקלידו מספר לחיפוש`:`${all.length} מספרים`);
 return`<p class="note" role="status" style="margin:0 0 8px">${esc(head)}</p>`+show.map(r=>`<div class="li" style="cursor:default"><div class="m"><b dir="ltr" style="text-align:right">${esc(nbFmt(r.p))}</b><small>${r.fb?`לקוחות משוב · ${r.b?'<span style="color:var(--bad);font-weight:700">חסום</span>':'פעיל'}${r.n?' · '+esc(r.n):''}${fs.has(r.p)?' · <span style="color:var(--warn);font-weight:700">גם ברשימה החינמית</span>':''}${!r.b&&nbGone().has(r.p)?' · <span style="color:var(--warn);font-weight:700">יצא מהצינתוקים – לא יקבל בתשלום</span>':''}`:'רשימה חינמית · מוציאים דרך שלוחת היציאה בקו או באתר ימות'}</small></div>${r.fb?`<button type="button" class="btn${r.b?'':' g'}" style="min-height:44px;padding:0 12px;flex:none" data-a="ynAsk" data-v="${esc(r.p)}"${NB.busy?' disabled':''}>${r.b?'בטל חסימה':'חסום'}</button>`:''}</div>`).join('')}
function nbHtml(){
 if(NB.denied)return'<div class="empty">המסך הזה פתוח למנהל בלבד.</div>';
 const D=NB.d;
 if(!D)return NB.err?`<p class="note" style="color:var(--bad)">${esc(NB.err)}</p><button class="btn s g" data-a="ynLoad">נסה שוב</button>`:'<p class="note">טוען את המספרים מימות…</p>';
 const c=D.counts||{};
 return`<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">${num('רשימה חינמית',c.free)}${num('משוב – פעילים',c.fbActive)}${num('משוב – חסומים',c.fbBlocked)}</div>
 ${D.freeErr?'<p class="note" style="color:var(--bad);margin:8px 0 0">לא הצלחנו לקרוא את הרשימה החינמית מימות.</p>':''}
 ${D.fbErr?'<p class="note" style="color:var(--bad);margin:8px 0 0">לא הצלחנו לקרוא את רשימת לקוחות המשוב מימות.</p>':''}
 ${D.listReady===false?'<p class="note" style="margin:8px 0 0">רשימת לקוחות המשוב עוד לא נוצרה בימות.</p>':''}
 <div class="card" style="margin-top:12px"><p class="note" style="margin:0">חסימה בלקוחות משוב: המספר נשאר ברשימה אבל לא יקבל צינתוקים כלקוח משוב. אפשר לבטל בכל רגע. מספר שרשום גם ברשימה החינמית ימשיך לקבל ממנה צינתוקים. ברשימה החינמית אין חסימה מהאפליקציה – הלקוח יוצא בעצמו דרך שלוחת היציאה בקו, או שמוציאים אותו באתר ימות.</p></div>
 <input type="tel" inputmode="numeric" autocomplete="off" data-i="ynQ" id="ynQ" placeholder="חפש מספר (למשל 0501234567)" aria-label="חפש מספר" style="width:100%;margin:12px 0 8px" value="${esc(NB.q)}">
 <div id="ynRes">${nbList()}</div>
 <button class="btn s g grow" data-a="ynLoad" style="margin-top:8px"${NB.loading||NB.busy?' disabled':''}>רענן מימות</button>`}
function nbPaint(){const el=document.getElementById('ynBox');if(el)el.innerHTML=nbHtml()}
function nbPaintList(){const el=document.getElementById('ynRes');if(el)el.innerHTML=nbList();else nbPaint()}
async function nbLoad(){
 if(NB.loading)return;NB.loading=true;NB.err=null;
 try{NB.d=await A.call('yemotFbList',{action:'numbers'},60000);NB.denied=false}
 catch(e){if(e&&e.status==='PERMISSION_DENIED')NB.denied=true;else NB.err=nbErr(e)}
 finally{NB.loading=false}nbPaint()}
V.ymn=()=>{if(!A.isMgr())return{t:'מספרים בקו',h:'<div class="empty">המסך הזה פתוח למנהל בלבד.</div>'};setTimeout(()=>{if(!NB.d)nbLoad();else nbPaint()},0);return{t:'מספרים בקו',s:'מנהל',h:'<div id="ynBox"><p class="note">טוען את המספרים מימות…</p></div>'}};
window.ynOpen=()=>{if(!A.isMgr()){A.toast('המסך הזה פתוח למנהל בלבד.');return}NB.d=null;NB.err=null;NB.q='';NB.denied=false;go('ymn')};
ACT.ynLoad=()=>{if(!NB.busy)nbLoad()};
INP.ynQ=el=>{NB.q=el.value;nbPaintList()};
ACT.ynAsk=el=>{
 const p=el&&el.dataset&&el.dataset.v,r=nbRows().find(x=>x.fb&&x.p===p);if(!r||NB.busy)return;
 NB.ask={p:r.p,on:!r.b};const both=nbFree().has(r.p);
 dlg(r.b?`<h3>לבטל את החסימה?</h3><p style="margin:0 0 6px" dir="ltr"><b>${esc(nbFmt(r.p))}</b></p><p class="note" style="margin:0 0 12px">המספר יחזור לקבל צינתוקים ללקוחות המשוב (בתשלום).</p><div class="row"><button type="button" class="btn grow" data-a="ynOk">כן, בטל חסימה</button><button type="button" class="btn g grow" data-a="ynNo">ביטול</button></div>`
  :`<h3>לחסום את המספר?</h3><p style="margin:0 0 6px" dir="ltr"><b>${esc(nbFmt(r.p))}</b></p><p class="note" style="margin:0 0 12px">המספר יישאר ברשימת לקוחות המשוב, אבל לא יקבל צינתוקים כלקוח משוב. אפשר לבטל את החסימה בכל רגע.</p>${both?'<p class="note" style="color:var(--warn);font-weight:700;margin:0 0 12px">שימו לב: המספר רשום גם ברשימה החינמית, ומשם ימשיך לקבל צינתוקים חינמיים עד שיוציאו אותו דרך שלוחת היציאה בקו או באתר ימות.</p>':''}<div class="row"><button type="button" class="btn grow" data-a="ynOk">כן, חסום</button><button type="button" class="btn g grow" data-a="ynNo">ביטול</button></div>`)};
ACT.ynNo=()=>{closeDlg();NB.ask=null};
ACT.ynOk=async()=>{
 const q=NB.ask;closeDlg();NB.ask=null;if(!q||NB.busy)return;
 NB.busy=true;nbPaintList();let reload=false;
 try{const r=await A.call('yemotFbList',{action:q.on?'block':'unblock',phone:q.p},60000);
  const on=!!(r&&r.blocked),D=NB.d;
  if(D&&Array.isArray(D.fb)){D.fb.forEach(x=>{if(x&&x.p===q.p)x.b=on});D.counts=Object.assign({},D.counts,{fbActive:D.fb.filter(x=>x&&!x.b).length,fbBlocked:D.fb.filter(x=>x&&x.b).length})}
  A.toast(on?'✓ המספר נחסם':'✓ החסימה בוטלה')}
 catch(e){if(e&&e.status==='PERMISSION_DENIED')NB.denied=true;A.toast(nbErr(e));reload=!!(e&&['uncertain','not-in-list'].includes(e.reason))}
 finally{NB.busy=false}
 if(reload){NB.d=null;nbPaint();nbLoad()}else nbPaint()};
/* "דוח הקו" (מנהל, משימה 2026-11-23): בחירת חודש ← כמה נרשמו, כמה התנתקו, כמה שמעו את הקו (כל השלוחות), ומי לא מקבל צינתוק בתשלום כי יצא מהרשימה החינמית.
   yemotFbList { action:'report', month:'YYYY-MM' }. כל חלק מציג גם את המספרים, בטבלה. ההרשאה נאכפת בשרת. חושף window.yrOpen().
   "שמעו" = התקשרו לקו (יומן הכניסות של ימות; לא בתיעוד הרשמי – אם לא נקרא, מוצגת הודעה). כל טקסט – esc בלבד. */
const RP={m:null,d:null,err:null,loading:false,tab:'join',denied:false};
const ilMonth=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit'}).format(new Date()).slice(0,7);
const mAdd=(ym,k)=>{let[y,m]=ym.split('-').map(Number);m+=k;while(m<1){m+=12;y--}while(m>12){m-=12;y++}return y+'-'+String(m).padStart(2,'0')};
const mName=ym=>{const[y,m]=ym.split('-').map(Number);return new Intl.DateTimeFormat('he-IL',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(Date.UTC(y,m-1,15)))};
// "2026-11-05T10:00:00" (שעון ישראל) ← "05.11 10:00"
const atT=at=>{const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(at||''));return m?`${m[3]}.${m[2]}.${m[1].slice(2)} ${m[4]}:${m[5]}`:''};
const secT=s=>{s=n0(s);return s<60?s+' שנ׳':Math.floor(s/60)+':'+String(s%60).padStart(2,'0')+' דק׳'};
const HOWN={self:'הסיר את עצמו',admin:'הוצא ע״י מנהל',gone:'יצא מהרשימה'};
const RPT={join:'נרשמו',left:'התנתקו',heard:'שמעו את הקו',out:'לא מקבלים בתשלום'};
function rpTable(){const D=RP.d;
 const tb=(head,rows)=>rows.length?`<div class="fbtw" style="max-height:none"><table class="fbt" style="min-width:0"><thead><tr>${head.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`:'<p class="note">אין מספרים להציג.</p>';
 const ph=p=>`<td dir="ltr" style="text-align:right;white-space:nowrap">${esc(nbFmt(p))}</td>`;
 if(RP.tab==='join'){if(!D.joined)return`<p class="note" style="color:var(--bad)">${D.logErr?'לא הצלחנו לקרוא מימות את יומן ההרשמות.':'אין נתונים.'}</p>`;
  return tb(['מספר','מתי'],D.joined.map(x=>`<tr>${ph(x.p)}<td>${esc(atT(x.at))}</td></tr>`))}
 if(RP.tab==='left'){if(!D.left)return`<p class="note" style="color:var(--bad)">${D.freeErr?'לא הצלחנו לקרוא מימות את רשימת הצינתוקים.':'לא הצלחנו לקרוא מימות את יומן ההרשמות, ועוד אין מידע שמור מבדיקה קודמת. נסו שוב מאוחר יותר.'}</p>`;
  return(D.logOk?'':'<p class="note" style="margin:0 0 8px">יומן ההרשמות בימות לא נקרא – מוצגים רק מי שהמערכת ראתה שיצאו מהרשימה.</p>')+tb(['מספר','מתי','איך'],D.left.map(x=>`<tr>${ph(x.p)}<td>${esc(atT(x.at))}</td><td>${esc(HOWN[x.how]||'')}</td></tr>`))}
 if(RP.tab==='heard'){const H=D.heard;if(!H)return'<p class="note" style="color:var(--bad)">לא הצלחנו לקרוא מימות את יומן השיחות של החודש הזה. ייתכן שלא היו שיחות, או שימות לא מאפשר לקרוא אותו.</p>';
  return(H.more?`<p class="note" style="margin:0 0 8px">מוצגים ${H.rows.length} המספרים האחרונים מתוך ${H.rows.length+n0(H.more)}.</p>`:'')+tb(['מספר','שיחות','זמן בקו','אחרונה'],H.rows.map(x=>`<tr>${ph(x.p)}<td class="c">${esc(String(n0(x.n)))}</td><td>${esc(secT(x.sec))}</td><td>${esc(atT(x.last))}</td></tr>`))}
 if(!D.out)return`<p class="note" style="color:var(--bad)">לא ידוע מי יצא מהרשימה החינמית${D.freeErr?' – הרשימה לא נקראה מימות':''}.</p>`;
 return'<p class="note" style="margin:0 0 8px">מי שיצא מרשימת הצינתוקים החינמית ולא נרשם שוב. לקוח משוב שברשימה הזו לא יקבל צינתוק בתשלום. אם יירשם שוב בקו – יחזור לקבל.</p>'+tb(['מספר','מאז','איך','לקוח משוב'],D.out.map(x=>`<tr>${ph(x.p)}<td>${esc(atT(x.at))}</td><td>${esc(HOWN[x.how]||'')}</td><td class="c">${x.fb?'כן':''}</td></tr>`))}
function rpHtml(){
 if(RP.denied)return'<div class="empty">המסך הזה פתוח למנהל בלבד.</div>';
 const cur=ilMonth(),nav=`<div class="row" style="align-items:center;justify-content:space-between;margin:0 0 10px"><button type="button" class="btn s g" data-a="yrM" data-v="-1" aria-label="חודש קודם"${RP.loading?' disabled':''}>‹ הקודם</button><b>${esc(mName(RP.m))}</b><button type="button" class="btn s g" data-a="yrM" data-v="1" aria-label="חודש הבא"${RP.loading||RP.m>=cur?' disabled':''}>הבא ›</button></div>`;
 const D=RP.d;
 if(!D)return nav+(RP.err?`<p class="note" style="color:var(--bad)">${esc(RP.err)}</p><button class="btn s g" data-a="yrLoad">נסה שוב</button>`:'<p class="note">טוען את הנתונים מימות… (עד דקה)</p>');
 const c=D.counts||{},H=D.heard,v=(ok,x)=>ok?x:'—';
 return nav+`<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${num('נרשמו החודש',v(D.joined,D.joined&&D.joined.length))}${num('התנתקו החודש',v(D.left,D.left&&D.left.length))}${num('שמעו את הקו (מספרים)',v(H,H&&H.phones))}${num('שיחות לקו',v(H,H&&H.calls))}</div>
 <p class="note" style="margin:12px 0 6px">עכשיו:</p>
 <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">${num('רשימה חינמית',v(D.counts,c.free))}${num('משוב – פעילים',v(D.counts&&!D.fbErr,c.fbActive))}${num('משוב שיצאו – לא מקבלים',v(D.counts&&c.skipped!=null,c.skipped))}</div>
 <div class="row" role="tablist" style="flex-wrap:wrap;gap:6px;margin:14px 0 10px">${Object.keys(RPT).map(k=>`<button type="button" class="chip ${RP.tab===k?'on':''}" data-a="yrTab" data-v="${k}" aria-pressed="${RP.tab===k}">${RPT[k]}</button>`).join('')}</div>
 ${rpTable()}
 <button class="btn s g grow" data-a="yrLoad" style="margin-top:10px"${RP.loading?' disabled':''}>רענן מימות</button>`}
function rpPaint(){const el=document.getElementById('yrBox');if(el)el.innerHTML=rpHtml()}
async function rpLoad(){
 if(RP.loading)return;RP.loading=true;RP.err=null;RP.d=null;rpPaint();const m=RP.m;
 try{const r=await A.call('yemotFbList',{action:'report',month:m},150000);if(RP.m===m){RP.d=r;RP.denied=false}}
 catch(e){if(e&&e.status==='PERMISSION_DENIED')RP.denied=true;else if(RP.m===m)RP.err=nbErr(e)}
 finally{RP.loading=false}rpPaint()}
V.ymr=()=>{if(!A.isMgr())return{t:'דוח הקו',h:'<div class="empty">המסך הזה פתוח למנהל בלבד.</div>'};setTimeout(()=>{if(!RP.d&&!RP.loading)rpLoad();else rpPaint()},0);return{t:'דוח הקו',s:'מנהל',h:'<div id="yrBox"><p class="note">טוען…</p></div>'}};
window.yrOpen=()=>{if(!A.isMgr()){A.toast('המסך הזה פתוח למנהל בלבד.');return}RP.m=ilMonth();RP.d=null;RP.err=null;RP.denied=false;go('ymr')};
ACT.yrLoad=()=>{rpLoad()};
ACT.yrM=el=>{if(RP.loading)return;const k=+(el&&el.dataset&&el.dataset.v)||0,n=mAdd(RP.m,k);if(n>ilMonth())return;RP.m=n;rpLoad()};
ACT.yrTab=el=>{const k=el&&el.dataset&&el.dataset.v;if(!RPT[k])return;RP.tab=k;rpPaint()};
})();
