/* "לקוחות משוב בימות": מסך מנהל. קובץ עצמאי, נטען אחרי yemot-line.js. חושף window.yfOpen() ו-window.ytOpen() ("שליחת צינתוקים", בסוף הקובץ).
   מציג את מצב רשימת הטלפונים של לקוחות המשוב בימות, סנכרון ידני, ומתג צינתוק ללקוחות המשוב.
   ההרשאות נאכפות בשרת (yemotFbList). כאן רק נוחות. כל טקסט מהשרת מוצג ב-textContent בלבד.
   משתמש ב: window.ylApi (מ-yemot-line.js), V, ACT, go, dlg, closeDlg, esc, ico. */
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
const TZ={busy:false,res:null,req:null,denied:false};
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
 ${R?`<div class="card" id="ytRes"><b id="ytResH"></b><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:8px">${num('נשלחו',n0(R.sent))}${num('נכשלו',n0(R.failed))}${num('לא ודאי',n0(R.uncertain))}</div><p class="note" id="ytResM" style="margin:8px 0 0"></p></div>`:''}`}
function tzPaint(msg){const el=document.getElementById('ytBox');if(!el)return;el.innerHTML=tzHtml();
 const t=(id,v)=>{const x=document.getElementById(id);if(x)x.textContent=v};
 t('ytMsg',msg||'');
 const R=TZ.res;if(R){t('ytResH',`${TZN[R.target]||''}: ${TZST[R.status]||''}${R.duplicate?' (כבר טופל קודם)':''}`);t('ytResM',A.he(R.message)?R.message:'')}}
V.ytz=()=>{if(!A.isMgr())return{t:'שליחת צינתוקים',h:'<div class="empty">המסך הזה פתוח למנהל בלבד.</div>'};setTimeout(()=>tzPaint(),0);return{t:'שליחת צינתוקים',s:'מנהל',h:'<div id="ytBox"><p class="note">טוען…</p></div>'}};
window.ytOpen=()=>{if(!A.isMgr()){A.toast('המסך הזה פתוח למנהל בלבד.');return}TZ.res=null;TZ.denied=false;go('ytz')};
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
  ${p.listReady===false?'<p class="note" style="margin:0 0 6px">רשימת "לקוחות משוב" עוד לא נוצרה בימות.</p>':''}
  ${p.capped?`<p class="note" style="color:var(--bad);margin:0 0 6px">מעל המכסה (${esc(String(n0(p.max)))} מספרים בתשלום בשליחה אחת). אי אפשר לשלוח.</p>`:''}`;
 dlg(`<h3>צינתוק ${TZN[target]}?</h3>${body}<div class="row">${total>0&&!p.capped?`<button type="button" class="btn grow" data-a="ytOk">כן, שלח צינתוק</button>`:''}<button type="button" class="btn g grow" data-a="ytNo">ביטול</button></div>`)};
ACT.ytNo=()=>{closeDlg();TZ.ask=null};
ACT.ytOk=async()=>{
 const q=TZ.ask;closeDlg();TZ.ask=null;if(!q||TZ.busy)return;
 if(!TZ.req||TZ.req.target!==q.target)TZ.req={target:q.target,id:'tz_'+A.rand()};
 TZ.busy=true;tzPaint('שולח…');let msg='';
 try{TZ.res=await A.call('sendLineTzintuk',{action:'send',target:q.target,requestId:TZ.req.id},300000);TZ.req=null;A.toast(A.he(TZ.res&&TZ.res.message)?TZ.res.message:'✓ נשלח')}
 catch(e){msg=A.errMsg(e);if(!(e&&(e.timeout||e.offline)))TZ.req=null; // פסק זמן/ניתוק: אותו מזהה בניסיון הבא – השרת לא ישלח פעמיים
  if(e&&e.status==='PERMISSION_DENIED')TZ.denied=true;A.toast(msg)}
 finally{TZ.busy=false}tzPaint(msg)};
})();
