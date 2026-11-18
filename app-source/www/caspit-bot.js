/* רובוט כספית – כרטיס "רובוט – מחשב החנות" במסך "סנכרון כספית" (שלב B, 18.11.2026). מנהל בלבד (השרת אוכף: functions/caspit-bot.js).
   חיבור מחשב (קוד שמוצג פעם אחת + העתקה), ניתוק, מצב (סנכרון אחרון ואיך התחיל, 14 הריצות האחרונות, תקלות בעברית פשוטה),
   כמה פריטים חדשים מותר לרובוט לטעון לכספית בכל ריצה (newMax), הורדת התוסף והוראות התקנה, ודוח היכרות (מנהל־על בלבד).
   "סנכרן עכשיו" (18.11): בקשה למחשב החנות (cxBotTok op:'now'); התוסף 0.1.5 בודק כל דקה. בזמן המתנה / ריצה – רענון כל 20 שניות, רק כשהמסך פתוח וגלוי.
   רכיבי העיצוב הקיימים בלבד (.card .btn .kg .k .li .note .f). משתמש ב: V, ACT, FRM, fnCall, esc, toast, dlg, closeDlg, ask, rerender, cur, fd, saveFile, SY, APP_REPO. */
(function(){
'use strict';
if(typeof ACT==='undefined'||typeof V==='undefined')return;
const fnCall=(n,d)=>{d=d&&typeof d==='object'?d:{};if(SY&&SY.sa&&SY.bizId&&!('bizId'in d))d=Object.assign({bizId:SY.bizId},d);return window.fnCall(n,d)};
const B={i:null,err:'',ld:0};
const REPO=()=>typeof APP_REPO==='string'&&/^[\w.-]+\/[\w.-]+$/.test(APP_REPO)&&!/__/.test(APP_REPO)?APP_REPO:'nati59029-a11y/large-pami-android'; /* APP_REPO נקבע בבנייה (main.yml); בלי – המאגר הזה */
const dt=t=>t?new Date(t).toLocaleString('he-IL',{day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
const dd=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)?d.slice(8)+'/'+d.slice(5,7):'—';
const ST={ok:'הצליח',fail:'נכשל','needs-login':'צריך להתחבר לכספית',run:'לא הסתיים',wait:'ממתין לניסיון חוזר'};
/* קודי התקלה של התוסף (caspit-extension/src/lib/plan.js) – בעברית פשוטה */
const ERR={'import-errors':'כספית טענה את הקובץ עם שורות שגויות (או שהטעינה נכשלה). הקובץ השגוי נמצא בכספית, ב"טעינות קודמות".','import-timeout':'כספית לא סיימה את הטעינה בזמן – כדאי לבדוק ב"טעינות קודמות" בכספית.','import-queue-not-empty':'במסך הייבוא של כספית ממתינים קבצים שמישהו הוסיף ולא העלה. הרובוט לא העלה כלום – כדאי לנקות את "ממתין לטעינה" בכספית.','wrong-page':'התוסף הגיע לדף שאינו המשרד האחורי של כספית (/bo) ועצר – בלי לגעת בקופה. כדאי לפתוח את כספית במחשב ולבדוק.','needs-login':'צריך להתחבר לכספית ב-Chrome במחשב החנות. אחרי ההתחברות הסנכרון ממשיך לבד.','selector-miss':'מסך בכספית השתנה והרובוט לא מצא כפתור או שדה.','endpoint-changed':'הקובץ שהתקבל מכספית לא נראה כמו שציפינו.',
 limit:'יותר מדי שינויים לכספית בבת אחת – הרובוט עצר. אפשר להעלות את המגבלה למטה, או לשלוח את הקבצים מכאן.',auth:'החיבור בוטל. צריך לחבר מחדש עם קוד חדש.','min-ver':'צריך לעדכן את התוסף לגרסה חדשה.',disabled:'הסנכרון האוטומטי כבוי.',
 network:'אין חיבור לאינטרנט במחשב החנות.',offline:'אין חיבור לאינטרנט במחשב החנות.',timeout:'הפעולה לקחה יותר מדי זמן.',server:'תקלה זמנית בשרת.',rate:'יותר מדי פניות היום.',stale:'הנתונים השתנו באמצע – ננסה שוב.',busy:'סנכרון אחר רץ באותו זמן.',
 tab:'תקלה זמנית בלשונית של כספית.',parse:'לא הצלחנו לקרוא את הקובץ מכספית.','first-manual':'את הקטלוג הראשון מסנכרנים כאן באפליקציה.',fail:'הסנכרון נכשל.'};
const errTxt=(code,msg)=>ERR[code]||msg||ERR.fail;
async function load(){if(B.ld)return;B.ld=1;try{B.i=await fnCall('cxBotTok',{op:'info'});B.at=Date.now();B.err=''}catch(e){B.err=e&&e.message||'הטעינה נכשלה'}B.ld=0;if(cur().v==='cxSync')rerender()}
const tm=t=>t?new Date(t).toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'}):'';
const verLt=(a,b)=>{const p=v=>String(v||'0').split('.').map(x=>parseInt(x,10)||0),x=p(a),y=p(b);for(let k=0;k<3;k++)if((x[k]||0)!==(y[k]||0))return(x[k]||0)<(y[k]||0);return false};
/* מצב "סנכרן עכשיו" לפי שעון השרת (i.now + הזמן שעבר מאז הטעינה): wait = נשלח וממתין למחשב, run = המחשב התחיל, late = המחשב לא הגיב,
   retry / retryOld = המחשב באמצע סנכרון שממתין לניסיון חוזר (q.wait) – בזמן הבקשה / אחרי שפגה */
function nowSt(i){const q=i.req;if(!q)return'';const sn=(i.now||Date.now())+(Date.now()-(B.at||Date.now())),lr=i.lr,live=sn-q.at<(i.reqMs||600000);
 if(!q.took&&q.wait&&sn-q.at<864e5&&!(lr&&(lr.at||0)>=q.at))return live?'retry':'retryOld';
 if(!q.took)return live?'wait':sn-q.at<864e5&&!(lr&&(lr.at||0)>=q.at)?'late':'';
 return !(lr&&(lr.at||0)>=q.took)&&sn-q.took<18e5?'run':''}
/* רענון בזמן המתנה / ריצה: כל 20 שניות, רק כשהמסך הזה פתוח והאפליקציה גלויה */
function nowTick(on){if(!on||B.tm)return;B.tm=setTimeout(()=>{B.tm=0;if(cur().v==='cxSync'&&!document.hidden)load()},20000)}
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&B.i&&/^(wait|run|retry)$/.test(nowSt(B.i))&&cur().v==='cxSync')load()});
const big='style="min-height:48px"';

/* הכרטיס – נקרא מ-V.cxSync (caspit-sync.js) */
window.cxBotCardH=()=>{if(!B.i&&!B.err)load();const i=B.i;
 let h='<div class="card"><h3 style="margin-top:0">רובוט – מחשב החנות</h3><p class="note" style="margin-top:0">תוסף ב-Chrome במחשב החנות מסנכרן לבד כל לילה ב-03:00: קטלוג, מכירות של הימים שעברו, וקבצים לכספית. הקטלוג הראשון – רק כאן באפליקציה.</p>';
 if(B.err)h+=`<p class="note">${esc(B.err)}</p><button class="btn g w" ${big} data-a="cxBotRe">נסו שוב</button>`;
 else if(!i)h+='<p class="note">טוען…</p>';
 else{
  if(!i.dev)h+=`<p class="note">אין מחשב מחובר.</p><button class="btn w" ${big} data-a="cxBotNew">חיבור מחשב</button>`;
  else{const lr=i.lr;
   h+=`<div class="kg"><div class="k"><small>סנכרון אחרון</small><b>${lr?esc(ST[lr.st]||lr.st):'עוד לא'}</b><small>${lr?dt(lr.at)+' · '+(lr.manual?'ידני':'אוטומטי'):''}</small></div><div class="k"><small>מכירות נקלטו עד</small><b>${dd(i.sd)}</b></div><div class="k"><small>המחשב נראה לאחרונה</small><b>${dt(Math.max(i.dev.last||0,i.pl||0))}</b><small>${i.dev.ver?'גרסה '+esc(i.dev.ver):''}</small></div></div>`;
   /* "סנכרן עכשיו" – בקשה למחשב החנות */
   const ns=nowSt(i),q=i.req,nv=i.nowVer||'0.1.5';
   h+=`<button class="btn w" data-a="cxBotNow" ${/^(wait|run|retry)$/.test(ns)?'disabled':''} style="min-height:48px;margin-bottom:8px">סנכרן עכשיו</button>`;
   if(ns==='wait')h+=`<p class="note" role="status">נשלח – ממתין למחשב (${tm(q.at)}). המחשב בודק כל דקה.</p>`;
   else if(ns==='run')h+=`<p class="note" role="status">המחשב התחיל (${tm(q.took)}). התוצאה תופיע כאן בסיום.</p>`;
   else if(/retry/.test(ns))h+=`<p class="note" role="status">המחשב באמצע סנכרון קודם שנתקל בתקלה זמנית – ${q.wait<Date.now()?'ניסה שוב':'ינסה שוב'} ב-${tm(q.wait)}.</p>`;
   else if(ns==='late')h+=`<p class="note" role="alert">⚠ המחשב לא הגיב לבקשה (${tm(q.at)}) – בדקו שהוא דלוק ו-Chrome פתוח.</p>`;
   if(!i.pl||verLt(i.dev.ver,nv))h+=`<p class="note">כדי ש"סנכרן עכשיו" יעבוד צריך לעדכן את התוסף במחשב לגרסה ${esc(nv)} ומעלה ("הורדת התוסף" למטה).</p>`;
   nowTick(/^(wait|run|retry)$/.test(ns));
   if(lr&&lr.st!=='ok'&&lr.code)h+=`<p class="note" role="alert">⚠ ${esc(errTxt(lr.code,lr.msg))}</p>`;
   /* הטעינה האחרונה לכספית (טבלת "טעינות קודמות" בכספית) */
   if(i.li&&i.li.id)h+=`<p class="note">טעינה אחרונה לכספית (${i.li.kind==='new'?'פריטים חדשים':'מחירים'}, ${dt(i.li.at)}): מזהה ${esc(String(i.li.id))} · ${esc(i.li.status||'')} · נטענו ${i.li.loaded<0?'?':i.li.loaded} · שגויים ${i.li.errors<0?'?':i.li.errors}${i.li.errors>0?' ⚠':''}</p>`;
   if(i.first)h+='<p class="note">קודם מסנכרנים כאן קטלוג ראשון (בחירת קובץ למעלה). עד אז הרובוט קולט רק מכירות.</p>';
   h+=`<button class="btn g w" ${big} data-a="cxBotRuns">הריצות האחרונות (${(i.runs||[]).length})</button><div class="row" style="margin-top:8px"><button class="btn g grow" ${big} data-a="cxBotNew">חיבור מחשב אחר</button><button class="btn g grow" ${big} data-a="cxBotRev">ניתוק</button></div>`}
  h+=`<form data-f="cxBotMaxF" style="margin-top:12px"><label class="f"><span>פריטים חדשים שהרובוט טוען לכספית בכל ריצה (0–50)</span><input name="n" type="number" inputmode="numeric" min="0" max="50" step="1" value="${+i.newMax||0}" style="min-height:48px"></label><p class="note" style="margin-top:0">1 = בדיקה ראשונה עם פריט אחד. מעלים אחרי שבדקתם בכספית שהפריט נקלט נכון. מעל המגבלה הרובוט עוצר ומודיע.</p><button class="btn g w" ${big}>שמירה</button></form>`;
  if(i.sa)h+=`<details style="margin-top:12px"><summary style="min-height:44px;display:flex;align-items:center"><b>דוח היכרות (מנהל־על)</b></summary>${(i.disc||[]).length?i.disc.map(x=>`<button class="btn g w" style="min-height:48px;margin-top:6px" data-a="cxBotDisc" data-k="${esc(x.id)}">${dt(x.at)} · ${Math.ceil((x.size||0)/1024)} KB</button>`).join(''):'<p class="note">עוד לא נשלח דוח. שולחים מחלון התוסף: "מצב היכרות" ← "שליחה".</p>'}</details>`}
 h+=`<div class="row" style="margin-top:12px"><button class="btn g grow" ${big} data-a="cxBotDl">הורדת התוסף</button><button class="btn g grow" ${big} data-a="cxBotGuide">הוראות התקנה</button></div></div>`;
 return h};

ACT.cxBotRe=()=>{B.err='';B.i=null;rerender()};
/* "סנכרן עכשיו": בקשה אחת בכל פעם (השרת מסרב לבקשה כפולה / בזמן ריצה). אין הגבלה יומית */
ACT.cxBotNow=async el=>{if(el)el.disabled=true;try{await fnCall('cxBotTok',{op:'now'});toast('נשלח למחשב החנות')}catch(e){toast(e&&e.message||'הפעולה נכשלה')}load()};
window.cxBotReset=()=>{B.err='';B.i=null};
/* חיבור: קוד חדש (מוצג פעם אחת). מחשב שמחובר עכשיו מתנתק */
const mk=async()=>{try{const r=await fnCall('cxBotTok',{op:'new'});
 dlg(`<h3>קוד חיבור למחשב</h3><p class="note"><b>הקוד מוצג פעם אחת בלבד.</b> במחשב: סמל התוסף ← "חיבור לאפליקציה והגדרות" ← מדביקים ← "חבר". לא שולחים את הקוד לאף אחד, ומוחקים אותו אחרי החיבור.</p><div class="card" style="word-break:break-all;direction:ltr;text-align:left"><code id="cxBotTok">${esc(r.token)}</code></div><div class="row"><button class="btn grow" ${big} data-a="cxBotCopy">העתקה</button><button class="btn g grow" ${big} data-a="closeDlg">סגור</button></div>`);
 B.i=null;load()}catch(e){toast(e&&e.message||'הפעולה נכשלה')}};
ACT.cxBotNew=()=>{if(B.i&&B.i.dev)return ask('ליצור קוד חיבור חדש? המחשב שמחובר עכשיו יתנתק.',mk,'כן, קוד חדש');mk()};
ACT.cxBotCopy=()=>{const e=document.getElementById('cxBotTok');if(!e)return;const t=e.textContent;(navigator.clipboard&&navigator.clipboard.writeText?navigator.clipboard.writeText(t):Promise.reject()).then(()=>toast('הקוד הועתק'),()=>{try{const r=document.createRange();r.selectNodeContents(e);const s=getSelection();s.removeAllRanges();s.addRange(r);toast('סמנו והעתיקו ידנית')}catch(x){}})};
{const d=document.getElementById('dlg');if(d)d.addEventListener('close',()=>{if(document.getElementById('cxBotTok'))d.innerHTML=''})} /* הקוד נמחק מהמסך בכל סגירה */
ACT.cxBotRev=()=>ask('לנתק את המחשב? הרובוט יפסיק לסנכרן עד שתחברו מחשב מחדש.',async()=>{try{await fnCall('cxBotTok',{op:'revoke'});toast('המחשב נותק');B.i=null;load()}catch(e){toast(e&&e.message||'הפעולה נכשלה')}},'כן, נתק');
ACT.cxBotRuns=()=>{const R=(B.i&&B.i.runs)||[];
 const imp=x=>!x?'':['new','price'].filter(k=>x[k]).map(k=>`${k==='new'?'פריטים חדשים':'מחירים'} לכספית: ${x[k].n}${x[k].id?` (טעינה ${x[k].id}: נטענו ${x[k].loaded<0?'?':x[k].loaded}, שגויים ${x[k].errors<0?'?':x[k].errors})`:''}${x[k].ok?'':' – לבדוק'}`).join(' · ');
 dlg(`<h3>הריצות האחרונות</h3><div style="max-height:60vh;overflow:auto">${R.map(r=>`<div class="li" style="cursor:default"><div class="m"><b>${dt(r.at)} · ${esc(ST[r.st]||r.st||'')}</b><small>${r.req?'ידני – "סנכרן עכשיו" מהטלפון':r.manual?'ידני – "סנכרן עכשיו"':'אוטומטי'}${r.days&&r.days.length?' · ימי מכירות: '+r.days.map(dd).join(', '):''}</small>${r.err&&r.err.code&&r.st!=='ok'?`<small>⚠ ${esc(errTxt(r.err.code,r.err.msg))}</small>`:''}${imp(r.imp)?`<small>${esc(imp(r.imp))}</small>`:''}</div></div>`).join('')||'<p class="note">עוד לא היו ריצות.</p>'}</div><button class="btn g w" ${big} data-a="closeDlg">סגור</button>`)};
FRM.cxBotMaxF=async f=>{const n=Math.round(+fd(f).n);if(!Number.isInteger(n)||n<0||n>50)return toast('מספר בין 0 ל-50');const b=f.querySelector('button');b.disabled=true;
 try{await fnCall('cxSetCfg',{newMax:n});toast('נשמר');if(B.i)B.i.newMax=n;rerender()}catch(e){b.disabled=false;toast(e&&e.message||'הפעולה נכשלה')}};
/* התוסף: release caspit-ext-v<גרסה> במאגר (ציבורי) – בלי פונקציה בשרת */
ACT.cxBotDl=()=>window.open(`https://github.com/${REPO()}/releases?q=caspit-ext&expanded=true`,'_system');
ACT.cxBotGuide=()=>dlg(`<h3>התקנת התוסף במחשב החנות</h3><ol style="padding-inline-start:20px;line-height:1.7;margin-top:0">
 <li>במחשב (Windows + Chrome) מורידים את הקובץ <span dir="ltr">caspit-extension-….zip</span> ("הורדת התוסף").</li>
 <li>לחיצה ימנית על הקובץ ← "חלץ הכל" לתיקייה קבועה (למשל מסמכים). לא מוחקים אותה אחר כך.</li>
 <li>ב-Chrome: <span dir="ltr">chrome://extensions</span> ← מדליקים "מצב מפתח" ← "טעינת פריט לא ארוז" ← בוחרים את התיקייה.</li>
 <li>מצמידים את התוסף (סמל הפאזל ← סיכה).</li>
 <li>כאן באפליקציה: "חיבור מחשב" ← מעתיקים את הקוד ← בתוסף: "חיבור לאפליקציה והגדרות" ← מדביקים ← "חבר".</li>
 <li>נכנסים לכספית באותו Chrome ולוחצים בתוסף "סנכרן עכשיו" לבדיקה.</li></ol>
 <p class="note">המחשב צריך להיות דלוק ו-Chrome פתוח בלילה. אם כבה – הסנכרון משלים כשהוא נדלק.</p>
 <div class="row"><button class="btn g grow" ${big} data-a="cxBotDoc">המדריך המלא</button><button class="btn g grow" ${big} data-a="closeDlg">סגור</button></div>`);
ACT.cxBotDoc=()=>window.open(`https://github.com/${REPO()}/blob/main/docs/caspit-extension-install.md`,'_system');
/* דוח היכרות – מנהל־על: צפייה (תחילת הדוח) והורדה מלאה */
ACT.cxBotDisc=async el=>{const id=el.dataset.k;try{const r=await fnCall('cxBotDisc',{id});let txt=r.data||'';try{txt=JSON.stringify(JSON.parse(txt),null,1)}catch(e){}
 B.dsc={id,txt};dlg(`<h3>דוח היכרות · ${dt(r.at)}</h3><pre dir="ltr" style="max-height:50vh;overflow:auto;white-space:pre-wrap;word-break:break-all;font-size:12px;text-align:left">${esc(txt.slice(0,20000))}${txt.length>20000?'\n…':''}</pre><div class="row"><button class="btn grow" ${big} data-a="cxBotDiscDl">הורדה (JSON)</button><button class="btn g grow" ${big} data-a="closeDlg">סגור</button></div>`)}
 catch(e){toast(e&&e.message||'הפעולה נכשלה')}};
ACT.cxBotDiscDl=()=>{if(B.dsc)saveFile('caspit-discovery-'+B.dsc.id+'.json',B.dsc.txt,'application/json')};
})();
