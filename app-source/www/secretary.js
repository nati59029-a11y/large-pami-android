/* SEC:1+2+3+4+5+6+7 – המזכירה העסקית. שלב 7: לשונית "חשבוניות" (חשבוניות שהתקבלו מווצאפ ומ-Gmail: אישור, דחייה, עריכה ובחירת סניף, "נכנס ישר" עם ביטול, קבלה → "סמן כשולם", חשבונית אחרי תעודת משלוח → החלפה, שולח חדש). שלב 6: לשונית "מייל" (Gmail – שליחה רק בלחיצה, ניקוי ספאם באישור מנהל העסק), חיבורי Google בהגדרות, סריקת היסטוריה אצל מנהל־על, סנכרון יומן Google. שלב 5: לשונית "ווצאפ" (תיבת הודעות, כרטיס שולח, טיוטה עם "שלח" בלחיצה, חלון 24 שעות ותבניות), "עצור הכל", הגדרות ווצאפ, ובכרטיס העסק של מנהל־על – חיבור המספר ומספרי המנהלים. שלב 4: לשוניות "התראות" ו"דוחות", הגדרות התראות ודוחות, מחיקת היסטוריה באישור כפול, תזכורת ביומן, רישום הטלפון להתראות (אם רכיב ההתראות קיים באפליקציה). שלב 1 ("שלד ותוספת"), שלב 2 ("צ'אט, מראה הכספים וייעוץ") ושלב 3 ("מידע על העסק, בנק תשובות, יומן" – לשוניות בתוך מסך המזכירה). קובץ עצמאי, נטען אחרי index.html (כמו orders-staff.js).
   שלב 2: secFin – נתוני הכספים לצ'אט ולמראה, מחושבים בפונקציות של מסכי האפליקציה עצמם (monthIncome, monthExpense, monthOwner, catTotal,
   inv/bal/dueOf, bsum, homeCards, dueStats, cfDebits, cfMonths) – אין כאן נוסחה כספית שנייה; מראה לענן אחרי כל שמירה (לכל היותר פעם ב-3 דקות);
   מסך הצ'אט (מקורות, "נכון ל-", "חשבי לעומק", אחוז ניצול, סף תזרים, "לא רלוונטי", מתג המראה).
   מה יש כאן: כפתור צף (רק למנהל שאישר, רק כשהתוספת פעילה), כרטיס בבית, מסך המזכירה (V.sec): מסך הסכמה בהפעלה הראשונה,
   אשף קצר (1. שם המזכירה, 2. אופן פנייה), "בקרוב" + יומן פעולות; ובכרטיס העסק של מנהל־על (V.sab): מצב מנהלים, תקרה,
   מתג שכר לכל מנהל, ניתוח עובדים ומידע רגיש, מצב ההסכמה, וצפייה בשיחה (נרשמת ביומן).
   כל כתיבה – רק דרך פונקציות השרת (functions/secretary.js). כל ההרשאות נאכפות בשרת ובחוקים; כאן רק מה מוצג למי.
   תוספת כבויה = הקובץ לא מוסיף דבר לשום מסך (כמו orders-lines.js). רכיבי העיצוב הקיימים בלבד (.card .btn .chip .f .sec .note .empty .li),
   צבעים רק ממשתני הערכה (--acc, --card, --line, --ink). משתמש ב: V, ACT, FRM, fsx, fnCall, fvj, esc, dlg, closeDlg, ask, toast, go, cur,
   rerender, render, isA, isW, bzF, SY, ADM, BZ0, fd. */
(function(){
'use strict';
if(typeof ACT==='undefined'||typeof V==='undefined')return;
const fnCall=(n,d)=>{d=d&&typeof d==='object'?d:{};if(SY&&SY.sa&&SY.bizId&&!('bizId'in d))d=Object.assign({bizId:SY.bizId},d);return window.fnCall(n,d)};
const err=e=>toast(e&&e.message||'הפעולה נכשלה');
const X={st:null,key:'',busy:0,at:0,wz:0,edit:0,log:null,logAt:0};
/* התוספת פעילה בעסק הנוכחי (כמו cellular: גם בעסק הישן – רק כשמנהל־העל הפעיל במפורש) */
const featOn=()=>{try{const b=SY&&SY.biz;return !!(b&&b.features&&b.features.secretary===true)&&bzF('secretary')}catch(e){return false}};
const elig=()=>featOn()&&!isW()&&(isA()||!!(SY&&SY.sa));
const keyNow=()=>(SY&&SY.bizId||'')+'|'+(SY&&SY.uid||'');
const ok=()=>!!(X.st&&X.st.ok);
const ready=()=>ok()&&X.st.consented;

async function load(force){
 if(!elig()){X.st=null;fabSync();return}
 const k=keyNow();if(k!==X.key){X.key=k;X.st=null;X.log=null;X.wz=0;X.edit=0}
 if(X.busy||(!force&&X.st&&Date.now()-X.at<60000))return;
 X.busy=1;
 try{X.st=await fnCall('secState',{})}
 catch(e){X.st={ok:false,reason:e&&e.reason||'',msg:e&&e.message||''}}
 finally{X.busy=0;X.at=Date.now();fabSync();try{if(ready()&&typeof mirSched==='function')mirSched()}catch(e){}const v=cur().v;if((v==='sec'||v==='home')&&!typing())rerender()}
}
const typing=()=>{const a=document.activeElement;return !!(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)&&a.closest('#main'))};

/* ---------- עיצוב: כפתור צף בלבד (כל השאר ברכיבים הקיימים) ----------
   פינה שמאלית (בעברית – הצד שלא מסתיר את כפתור ה-＋ שבמרכז הסרגל), מעל הסרגל התחתון. מוסתר כשהמקלדת פתוחה (שדה בפוקוס),
   כשסרגל הבחירה המרובה פתוח, במסך הסריקה האחידה, בעסק מושהה ובהדפסה. ריווח תחתון נוסף לתוכן, כדי שאפשר יהיה לגלול אותו אל מעל הכפתור.
   תיקון סבב 1: בלי בורר has (לא נתמך ב-WebView ישן) – מחלקות על body שה-JS מעדכן: sec-kb (שדה בפוקוס = מקלדת), sec-cover (סרגל בחירה מרובה / מסך הוספה פתוח). */
const css=document.createElement('style');
css.textContent='.secfab{position:fixed;left:max(12px,env(safe-area-inset-left));bottom:calc(84px + env(safe-area-inset-bottom));z-index:29;width:52px;height:52px;border-radius:50%;border:1.5px solid var(--acc);background:var(--card);color:var(--acc);box-shadow:0 8px 20px -8px rgba(0,0,0,.55);display:grid;place-items:center;cursor:pointer;padding:0}'
+'.secfab svg{width:26px;height:26px}.secfab:active{transform:scale(.94)}.secfab:focus-visible{outline:3px solid var(--acc);outline-offset:3px}'
+'body.secfab-on main{padding-bottom:76px}'
+'body.sec-kb .secfab,body.sec-cover .secfab,body.us-on .secfab,body.susp .secfab{display:none}'
+'@media(min-width:901px){.secfab{left:max(12px,calc((100vw - 980px)/2 + 12px))}}@media print{.secfab{display:none}}@media(prefers-reduced-motion:reduce){.secfab:active{transform:none}}'
+'.secav{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;border:1.5px solid var(--acc);color:var(--acc);flex:none}.secav svg{width:24px;height:24px}'
+'.secterms{margin:8px 0 0;padding-inline-start:20px}.secterms li{margin:0 0 8px;line-height:1.5}';
document.head.appendChild(css);
const SVG='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4h0A1.5 1.5 0 0 1 4 14.5z"/><path d="M8.5 8.5h7M8.5 11.5h4.5"/></svg>';

function fabSync(){
 let b=document.getElementById('secfab');
 const show=elig()&&ready()&&cur().v!=='sec';/* במסך הצ'אט עצמו – בלי כפתור צף (לא מסתיר את כפתור השליחה) */
 document.body.classList.toggle('secfab-on',!!show);
 if(!show){if(b)b.remove();return}
 if(!b){b=document.createElement('button');b.id='secfab';b.type='button';b.className='secfab';b.dataset.a='secOpen';b.innerHTML=SVG;document.body.appendChild(b)}
 const nm=X.st.name||'המזכירה';b.setAttribute('aria-label',nm);b.title=nm;
}
window.secFabSync=fabSync;
/* מקלדת: שדה קלט בתוך המסך בפוקוס */
const isField=t=>!!(t&&t.closest&&t.closest('#main')&&/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)&&!/^(checkbox|radio|button|submit|range|color|file)$/i.test(t.type||''));
document.addEventListener('focusin',e=>{document.body.classList.toggle('sec-kb',isField(e.target))});
document.addEventListener('focusout',()=>{setTimeout(()=>{document.body.classList.toggle('sec-kb',isField(document.activeElement))},0)});
/* סרגל בחירה מרובה (.msbar) או מסך הוספה (#sheet) פתוחים – בדיקה אחרי כל שינוי ב-DOM, לכל היותר פעם בפריים, ורק כשהכפתור מוצג */
let covQ=0;const covSync=()=>{covQ=0;const sh=document.getElementById('sheet');document.body.classList.toggle('sec-cover',!!document.querySelector('.msbar')||!!(sh&&!sh.hidden))};
try{new MutationObserver(()=>{if(!covQ&&document.getElementById('secfab')){covQ=1;requestAnimationFrame(covSync)}}).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden']})}catch(e){}
ACT.secOpen=()=>{if(cur().v!=='sec')go('sec')};

/* כל ציור מסך: מסנכרנים את הכפתור (עסק אחר / התוספת כובתה / התנתקות) – בלי קריאה לשרת אם אין צורך */
{const r0=window.render;if(typeof r0==='function')window.render=function(){const r=r0.apply(this,arguments);try{if(keyNow()!==X.key||(!elig()&&X.st))load();else fabSync()}catch(e){}return r}}

/* ---------- כרטיס בבית (11): מתמלא בהדרגה. בשלב 1 – אין שורות של שלבים עתידיים; רק כניסה למזכירה ---------- */
{const h=V.home;if(h)V.home=()=>{const r=h();try{if(!elig()||!r||!r.h)return r;if(!X.st||keyNow()!==X.key){load();return r}if(!ok())return r;
 const S=X.st,rows=(S.rows||[]).map(x=>`<div class="note" style="margin-top:4px">${esc(x.t||'')}</div>`).join('');
 const sub=!S.consented?'לפני שמתחילים – אישור תנאי השימוש':!S.setupDone?'הגדרה ראשונה: שם ואופן פנייה':'שאלו אותי על העסק – כספים, ספקים, עובדים ומשימות';
 const card=`<button type="button" class="card" id="secHome" data-a="secOpen" style="display:flex;gap:12px;align-items:center;width:100%;text-align:right;cursor:pointer;margin-top:12px;min-height:56px;color:var(--ink)"><span class="secav">${SVG}</span><span style="flex:1;min-width:0"><b>${esc(S.name||'המזכירה העסקית')}</b><small class="note" style="display:block">${esc(sub)}</small>${rows}</span></button>`;
 if(/<div class="chips hacts"/.test(r.h))r.h=r.h.replace(/(<div class="chips hacts")/,card+'$1');else r.h+=card}catch(e){}return r}}

/* ---------- מסך המזכירה ---------- */
const DENY={'not-main-manager':'בעסק הזה המזכירה זמינה רק למנהל הראשי.','not-biz-admin':'המזכירה זמינה למנהלי העסק בלבד.','not-manager':'המזכירה זמינה למנהלי העסק בלבד.','feature-off':'המזכירה לא מופעלת בעסק הזה.','biz-suspended':'החשבון מושהה – פנה לספק.'};
const ACTS={consent:'אישור תנאי השימוש',setup:'הגדרת שם ואופן פנייה',cfg:'מנהל המערכת עדכן הגדרות',readChat:'מנהל המערכת צפה בשיחה',
 factAdd:'נשמרה עובדה',factOk:'אושרה עובדה שהמזכירה הציעה',factNo:'בוטלה הצעה לעובדה',factEdit:'עובדה נערכה',factDel:'עובדה נמחקה',fixed:'עודכנו פרטים קבועים',price:'הועלה מחירון',priceDel:'המחירון נמחק',
 sensRead:'צפייה במידע הרגיש',sensTool:'המזכירה קראה מידע רגיש',sensAdd:'נשמר מידע רגיש',sensEdit:'מידע רגיש נערך',sensDel:'מידע רגיש נמחק',
 ruleAdd:'נוספה תשובה מוכנה',ruleEdit:'תשובה מוכנה נערכה',ruleDel:'תשובה מוכנה נמחקה',bank:'נענתה שאלה מתשובה מוכנה (בלי AI)',import:'ייבוא מהמזכירה הקודמת',
 calAdd:'נוסף אירוע ביומן',calOk:'אושר אירוע שהמזכירה הציעה',calNo:'בוטלה הצעה לאירוע',calEdit:'אירוע נערך',calDel:'אירוע נמחק',calWe:'שונתה הגדרת פגישות בשישי/שבת/חג',
 notify:'שונו הגדרות ההתראות והדוחות',remDone:'תזכורת סומנה כטופלה',remReps:'שונה מספר החזרות בתזכורת',empAlert:'התראה על עובד',report:'נוצר דוח',insightDone:'תובנה סומנה כטופלה',histAsk:'בקשה למחוק היסטוריה',histDel:'ההיסטוריה נמחקה',retention:'ניקוי אוטומטי לפי מדיניות השמירה'};
const tm=t=>{if(!t)return '';const d=new Date(t);return d.toLocaleDateString('he-IL',{day:'numeric',month:'numeric',year:'2-digit'})+' '+d.toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'})};
V.sec=()=>{const T='המזכירה';
 if(!elig())return{t:T,h:'<div class="empty">המזכירה לא מופעלת בעסק הזה</div>'};
 if(!X.st||keyNow()!==X.key){load();return{t:T,h:'<div class="empty">טוען…</div>'}}
 const S=X.st;
 if(!S.ok)return{t:T,h:`<div class="card"><p class="note" style="margin:0">${esc(DENY[S.reason]||S.msg||'לא ניתן לפתוח את המזכירה כרגע.')}</p>${DENY[S.reason]?'':'<button class="btn g w" data-a="secRe" style="margin-top:10px">נסה שוב</button>'}</div>`};
 if(!S.consented)return{t:T,h:consentH(S)};
 if(!S.setupDone||X.edit)return{t:S.name||T,h:wizH(S)};
 if(X.set){if(!X.log||Date.now()-X.logAt>60000)logLoad();return{t:S.name||T,s:'הגדרות המזכירה',h:setH(S)}}
 const tab=X.tab||'chat';
 if(tab==='facts')return{t:S.name||T,s:'מידע על העסק',h:tabsH()+factsH(S)};
 if(tab==='cal')return{t:S.name||T,s:'יומן',h:tabsH()+calH()};
 if(tab==='bank')return{t:S.name||T,s:'תשובות מוכנות',h:tabsH()+bankH()};
 if(tab==='notes')return{t:S.name||T,s:'התראות',h:tabsH()+notesH()};
 if(tab==='reps')return{t:S.name||T,s:'דוחות ותובנות',h:tabsH()+repsH()};
 if(!X.msgs&&!X.mb)msgLoad();
 return{t:S.name||T,s:'המזכירה העסקית',h:tabsH()+chatH(S)}};
ACT.secRe=()=>{X.st=null;load(true);rerender()};
ACT.secEdit=()=>{X.edit=1;X.wz=1;rerender()};

function consentH(S){const c=S.consent||{};
 return `<form class="card" data-f="secConsF"><h3 style="margin-top:0">${esc(c.title||'תנאי שימוש')}</h3><ul class="secterms">${(c.items||[]).map(t=>`<li>${esc(t)}</li>`).join('')}</ul>
 <label class="chip" style="min-height:44px;margin-top:6px;width:100%;justify-content:flex-start"><input type="checkbox" name="ok" value="1"> ${esc(c.ok||'קראתי ואני מסכים/ה')}</label>
 <input type="hidden" name="ver" value="${esc(c.ver||'')}"><button class="btn w" style="margin-top:10px">אישור והמשך</button>
 <p class="note" style="margin:8px 0 0">בלי אישור אי אפשר להשתמש במזכירה. האישור נשמר עם התאריך ומזהה הנוסח.</p></form>`}
FRM.secConsF=async f=>{const x=fd(f),b=f.querySelector('button');if(x.ok!=='1')return toast('צריך לסמן אישור');b.disabled=true;
 try{await fnCall('secConsent',{ver:x.ver,ok:true});X.wz=1;await load(true);toast('נשמר. תודה!')}catch(e){b.disabled=false;err(e);if(e&&e.reason==='bad-consent-ver')load(true)}};

function wizH(S){const st=X.wz===2?2:1;X.wz=st;const nm=X.nm!=null?X.nm:(S.name||''),ad=X.ad||S.addr||'',call=X.call!=null?X.call:(S.call||'');
 const steps=`<p class="note" style="margin:0 0 8px">שלב ${st} מתוך 2</p>`;
 if(st===1)return `<form class="card" data-f="secWz1">${steps}<h3 style="margin-top:0">איך לקרוא למזכירה?</h3><label class="f"><span>שם המזכירה</span><input name="name" maxlength="30" autocomplete="off" value="${esc(nm)}" placeholder="למשל: רותי"></label><div class="row" style="margin-top:10px"><button class="btn grow">המשך</button>${X.edit?'<button type="button" class="btn g grow" data-a="secWzX">ביטול</button>':''}</div></form>`;
 return `<form class="card" data-f="secWz2">${steps}<h3 style="margin-top:0">איך ${esc(nm||'המזכירה')} תפנה אליך?</h3>
 <div class="chips" role="radiogroup" aria-label="לשון פנייה"><label class="chip" style="min-height:44px"><input type="radio" name="addr" value="m"${ad==='m'?' checked':''}> בלשון זכר</label><label class="chip" style="min-height:44px"><input type="radio" name="addr" value="f"${ad==='f'?' checked':''}> בלשון נקבה</label></div>
 <label class="f" style="margin-top:8px"><span>שם לפנייה (לא חובה)</span><input name="call" maxlength="30" autocomplete="off" value="${esc(call)}" placeholder="למשל: נתי"></label>
 <div class="row" style="margin-top:10px"><button class="btn grow">סיום</button><button type="button" class="btn g grow" data-a="secWzB">חזרה</button></div></form>`}
FRM.secWz1=f=>{const v=String(fd(f).name||'').replace(/\s+/g,' ').trim();if(!v||v.length>30)return toast('שם עד 30 תווים');X.nm=v;X.wz=2;rerender()};
ACT.secWzB=()=>{const f=document.querySelector('form[data-f=secWz2]');if(f){const x=fd(f);if(x.addr)X.ad=x.addr;X.call=x.call||''}X.wz=1;rerender()};
ACT.secWzX=()=>{X.edit=0;X.wz=0;X.nm=X.ad=X.call=null;rerender()};
FRM.secWz2=async f=>{const x=fd(f),b=f.querySelector('button');if(!['m','f'].includes(x.addr))return toast('בחרו אופן פנייה');b.disabled=true;
 try{await fnCall('secSetup',{name:X.nm!=null?X.nm:X.st.name,addr:x.addr,call:String(x.call||'').trim()});X.edit=0;X.wz=0;X.nm=X.ad=X.call=null;await load(true);toast('נשמר')}catch(e){b.disabled=false;err(e)}};

/* יומן פעולות (10.7): הוספה בלבד, נכתב רק בשרת. כאן – 20 האחרונות, כולל צפיות של מנהל המערכת בשיחות */
async function logLoad(){X.logAt=Date.now();try{const sq={from:[{collectionId:'sec_log'}],orderBy:[{field:{fieldPath:'t'},direction:'DESCENDING'}],limit:20};
 const r=await fsx(':runQuery',{method:'POST',body:JSON.stringify({structuredQuery:sq})});
 X.log=(r||[]).filter(x=>x.document).map(x=>Object.fromEntries(Object.entries(x.document.fields||{}).map(([k,v])=>[k,fvj(v)])))}catch(e){X.log=X.log||[];X.logErr=1}
 if(cur().v==='sec'&&!typing())rerender()}
function logH(){if(!X.log)return '<div class="empty">טוען…</div>';if(!X.log.length)return `<div class="empty">${X.logErr?'היומן לא נטען':'אין עדיין פעולות'}</div>`;
 return '<div class="card">'+X.log.map(l=>{const me=l.tgt&&l.tgt===SY.uid;const a=(ACTS[l.act]||l.act||'')+(l.act==='readChat'?(me?' (השיחה שלך)':' (של מנהל אחר)'):'');
  return `<div class="li" style="cursor:default"><div class="m"><b>${esc(a)}</b><small>${esc(tm(l.t))}</small></div></div>`}).join('')+'</div>'}

/* =====================================================================================
   שלב 2: נתוני הכספים (secFin), המראה בענן (secMirrorPut) ומסך הצ'אט
   ===================================================================================== */
/* secFin – כל המספרים מהפונקציות של מסכי האפליקציה (בלי סינון סניף: כל העסק). מנהל עם הגבלת סניפים – null (הנתונים חלקיים).
   o.pay – לצרף שכר לכל עובד לחודש (42). המבנה נבדק שוב בשרת (sec-tools.js cleanFin) */
const WK=13,MONTHS=24;
function secFin(o){o=o||{};
 if(typeof S==='undefined'||!S||!Array.isArray(S.tx)||typeof brMineIds!=='function'||brMineIds())return null;
 const sB=BRSEL,sP=P;BRSEL=[];
 try{const now=Date.now(),m0=NOWM(),td=today(),L=live(),f={v:1,at:now,months:{},open:[],sups:[],late:{sum:0,n:0},due:null,cf:[],wk:null,chk:[]};
  const cs=catsOf('inc').concat(catsOf('exp'));
  for(let i=0;i<=MONTHS;i++){const m=addMon(m0,-i);
   P={mode:'month',months:[m],years:[],from:'',to:'',y:+m.slice(0,4),open:false};/* catTotal = הסכום שמסך ההכנסות/ההוצאות מציג לקטגוריה בחודש הזה */
   const cats=cs.map(c=>[String(c.name).slice(0,40),c.kind==='inc'?'i':'e',catTotal(c,L)]).filter(x=>Math.abs(x[2])>0.004);
   const inc=monthIncome(m),exp=monthExpense(m),own=monthOwner(m);
   if(cats.length||Math.abs(inc)>0.004||Math.abs(exp)>0.004||Math.abs(own)>0.004)f.months[m]={inc,exp,own,cats}}
  P=sP;
  const op=inv().filter(t=>bal(t)>0.004).sort((x,y)=>dueOf(x).localeCompare(dueOf(y)));
  f.open=op.slice(0,400).map(t=>[String(subName(t)).slice(0,60),String(t.inv||'').slice(0,30),t.date||'',dueOf(t),rnd(t.amt),bal(t)]);
  f.sups=S.subs.filter(x=>x&&!x.off&&['sup','fixed'].includes((cat(x.cat)||{}).beh)).map(x=>[String(x.name||'').slice(0,60),bsum(x.id)]).filter(x=>Math.abs(x[1])>0.004).slice(0,400);
  /* זיכויים פתוחים שתאריכם עבר (crDueS) – מורידים מהחוב ומ"באיחור", כמו בכרטיס הספק ובמסך "חשבוניות לתשלום" (החלטת בעל העסק 10.11.2026) */
  f.crs=S.subs.filter(x=>x&&['sup','fixed'].includes((cat(x.cat)||{}).beh)).map(x=>[String(x.name||'').slice(0,60),crDueS(x.id)]).filter(x=>x[1]>0.004).slice(0,400);
  const hc=homeCards(m0),ds=dueStats(m0);
  /* "באיחור (אחרי זיכויים)" – אותו חישוב שמסך "חשבוניות לתשלום" (V.due) מציג: לכל ספק באיחור, יתרות באיחור פחות זיכויים פתוחים, לא פחות מ-0.
     (V.due מחשב את זה בתוך המסך ולא בפונקציה נפרדת; הבדיקה ui-sec-2 משווה למספר שהמסך מציג) */
  const lt=inv().filter(t=>bal(t)>0.004&&isLate(t,td)),ls=[...new Set(lt.map(t=>t.sub))];
  f.late={sum:rnd(sum(ls,sd=>Math.max(0,sum(lt.filter(t=>t.sub===sd),bal)-crDueS(sd)))),gross:hc.lateSum,n:hc.lateN};f.due={m:m0,due:ds.due,rem:ds.rem,debit:hc.debit};
  const CF=cfMonths(m0,4,[]);f.cf=CF.map(x=>[x.m,x.sumAuto,x.sumTr,x.sumChk,x.sumCc,x.sumLn]);
  /* 13 שבועות (52): יציאות לפי התאריך של כל פריט בתזרים (צ'קים, חשבוניות לתשלום, אשראי, הלוואות); מה שכבר עבר מועדו – בשבוע הראשון.
     הכנסות: טווח לפי 3 החודשים המלאים האחרונים (monthIncome), לשבוע */
  const out=Array(WK).fill(0),w0=new Date(td+'T00:00:00'),wi=d=>{const k=Math.floor((new Date(d+'T00:00:00')-w0)/(7*864e5));return k<0?0:k},put=(d,a)=>{if(typeof d!=='string'||!(a>0))return;const k=wi(d);if(k<WK)out[k]=rnd(out[k]+a)};
  /* צ'קים, אשראי והלוואות – רק מהיום והלאה (מה שתאריכו עבר כבר ירד מהבנק ונמצא ביתרה של היום). חשבוניות פתוחות שמועדן עבר – בשבוע הראשון */
  const fut=c=>typeof c.date==='string'&&c.date>=td;
  CF.forEach(x=>{x.chk.filter(fut).forEach(c=>put(c.date,c.a));x.tr.forEach(c=>put(c.date,c.a));(x.cc||[]).filter(fut).forEach(c=>put(c.date,c.a));(x.ln||[]).filter(fut).forEach(c=>put(c.date,c.a));
   x.chk.filter(c=>c.date>=td).forEach(c=>f.chk.length<200&&f.chk.push([c.date,String(subName(c.t)).slice(0,60),c.a]))});
  inv().filter(t=>bal(t)>0.004&&!cfOff(t)&&(t.kind||'inv')!=='refund'&&dueOf(t)<m0+'-01').forEach(t=>{out[0]=rnd(out[0]+bal(t))});
  const ms=[1,2,3].map(k=>addMon(m0,-k)),wk=ms.map(m=>{const[y,mm]=m.split('-').map(Number);return monthIncome(m)*7/new Date(y,mm,0).getDate()});
  f.wk={start:td,out,inLo:rnd(Math.min(...wk)),inHi:rnd(Math.max(...wk)),inAvg:rnd(sum(wk,x=>x)/3)};
  if(o.pay){f.pay={};const emp=t=>(cat(t.cat)||{}).beh==='emp';
   for(let i=0;i<=MONTHS;i++){const m=addMon(m0,-i),G={};L.filter(t=>t.t==='exp'&&emp(t)&&pmon(t)===m).forEach(t=>{const n=String(subName(t)).slice(0,60);G[n]=rnd((G[n]||0)+num(t.amt))});
    const r=Object.entries(G);if(r.length)f.pay[m]=r}}
  return f}
 catch(e){try{console.warn('secFin',e&&e.message)}catch(z){}return null}
 finally{BRSEL=sB;P=sP}}
window.secFin=secFin;

/* המראה (5.2): אחרי כל שמירה (supSched → wvSched), לכל היותר פעם ב-3 דקות, ורק כשמשהו השתנה. מתג כבוי (45) – לא שולחים */
const MR={t:0,b:0,last:0,h:'',off:0};
const mirOn=()=>elig()&&ready()&&isA()&&X.st.mirror!==false&&Date.now()>=MR.off;
function mirSched(){if(!mirOn())return;clearTimeout(MR.t);const wait=Math.max(5000,MR.last+180000-Date.now());MR.t=setTimeout(()=>{mirPut().catch(()=>{})},wait)}
async function mirPut(){if(!mirOn()||MR.b)return;const f=secFin({pay:true});if(!f)return;const j=JSON.stringify(Object.assign({},f,{at:0})),h=typeof supHash==='function'?supHash(j):String(j.length);
 if(h===MR.h)return;MR.b=1;try{await fnCall('secMirrorPut',{fin:f});MR.h=h;MR.last=Date.now();X.st.mirrorAt=Date.now()}
 catch(e){if(e&&e.reason==='mirror-off')X.st.mirror=false;else MR.off=Date.now()+600000}finally{MR.b=0}}
window.secMirSched=mirSched;
{const w=window.wvSched;if(typeof w==='function')window.wvSched=function(){const r=w.apply(this,arguments);try{mirSched()}catch(e){}return r}}

/* ---------- מסך הצ'אט ---------- */
const css2=document.createElement('style');
css2.textContent='.secmsg{max-width:88%;padding:10px 12px;border-radius:14px;margin:8px 0;white-space:pre-wrap;line-height:1.55;overflow-wrap:anywhere;border:1px solid var(--line);background:var(--card);color:var(--ink)}'
+'.secmsg.a{margin-inline-end:auto;border-color:var(--acc)}.secmsg.u{margin-inline-start:auto}.secmsg sup{color:var(--acc);font-weight:700;font-size:.72em;margin-inline-start:1px}'
+'.secsrc{margin-top:8px;font-size:.85rem}.secsrc summary{cursor:pointer;color:var(--acc);min-height:32px;display:flex;align-items:center}.secsrc li{margin:4px 0}'
+'.secbar{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;font-size:.85rem;margin:0 0 6px}.secin{width:100%;min-height:72px;resize:vertical;font:inherit;padding:10px;border-radius:12px;border:1px solid var(--line);background:var(--card);color:var(--ink);box-sizing:border-box}'
+'.secwarn{border-color:var(--acc)!important}';
document.head.appendChild(css2);
const QS=['מה קרה היום?','תזרים לחודש','חשבוניות לתשלום השבוע'];
const SCR={due:'due',cf:'cf',tasks:'tk',zc:'zc',facts:'@facts',cal:'@cal',bank:'@bank'};/* @ = לשונית בתוך מסך המזכירה (שלב 3) */
async function msgLoad(){X.mb=1;try{const r=await fnCall('secChatLoad',{limit:50});X.msgs=r&&r.msgs||[]}catch(e){X.msgs=X.msgs||[];X.msgErr=e&&e.message||'השיחה לא נטענה'}finally{X.mb=0;if(cur().v==='sec'&&!typing())rerender()}}
const fmtAt=t=>{if(!t)return '';const d=new Date(t);return d.toLocaleDateString('he-IL',{day:'numeric',month:'numeric'})+' '+d.toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'})};
function bub(m,i){if(m.role!=='a')return `<div class="secmsg u">${esc(m.text)}</div>`;
 const tx=esc(m.text).replace(/\[(\d{1,2})\]/g,'<sup>$1</sup>');
 const src=(m.src||[]).map((s,k)=>`<li><b>${k+1}.</b> לפי ${esc(s.l||'')}${s.at?', נכון ל-'+esc(fmtAt(s.at)):''}${SCR[s.s]&&(SCR[s.s][0]==='@'||V[SCR[s.s]])?` <button class="chip" data-a="secGo" data-v="${SCR[s.s]}" style="min-height:32px">למסך</button>`:''}</li>`).join('');
 const ideas=(m.ideas||[]).filter(x=>!(X.nr||{})[x.key]).map(x=>`<div class="card" style="margin:6px 0 0;padding:8px"><small>${esc(x.seen||'')}</small><button class="chip" data-a="secNr" data-k="${esc(x.key)}" style="min-height:40px;margin-top:4px">לא רלוונטי – לא להציע 90 יום</button></div>`).join('');
 const th=m.th&&X.st&&X.st.cfTh==null?`<div class="card" style="margin:6px 0 0;padding:8px"><small>סף מוצע להתראת תזרים: ${esc(Number(m.th).toLocaleString('he-IL'))} ₪</small><div class="row" style="margin-top:4px"><button class="chip" data-a="secTh" data-v="${esc(String(m.th))}" style="min-height:40px">לאשר את הסף</button><button class="chip" data-a="secThEd" style="min-height:40px">סף אחר</button></div></div>`:'';
 const cards=(m.cards||[]).map(cardH).join('');
 return `<div class="secmsg a${m.stale?' secwarn':''}">${tx}${cards}${src?`<details class="secsrc"><summary>מקורות (${(m.src||[]).length})</summary><ol style="margin:4px 0;padding-inline-start:18px;list-style:none">${src}</ol></details>`:''}${ideas}${th}</div>`}
function chatH(S){const pct=Number.isFinite(S.pct)?S.pct:null,fin=!!secFinOk();
 const bar=`<div class="secbar" id="secBar"><span>${fin?'נתוני הכספים: מהמכשיר, נכונים ל-'+esc(fmtAt(Date.now())):S.mirror===false?'מראה הכספים כבוי':S.mirrorAt?'נתוני הכספים נכונים ל-'+esc(fmtAt(S.mirrorAt)):'אין נתוני כספים במכשיר הזה'}</span>${pct!=null?`<span id="secPct">ניצול החודש: <bdi dir="ltr">${pct}%</bdi></span>`:''}<button class="chip" data-a="secSet" style="min-height:36px;margin-inline-start:auto">הגדרות</button></div>`;
 const warn=S.saving?`<div class="card secwarn" id="secSaving"><small>${S.saving==='day'?'הגעתם לתקרת השימוש היומית – אפשר להמשיך מחר.':'הגעתם לתקרת השימוש החודשית – המזכירה במצב חיסכון עד תחילת החודש או הגדלת התקרה.'}</small></div>`:pct>=80?`<div class="card secwarn"><small>ניצלתם ${pct}% מתקרת השימוש החודשית.</small></div>`:'';
 const hi=S.call?`שלום ${esc(S.call)}! `:'שלום! ';
 const L=X.msgs||[];
 const body=X.mb&&!L.length?'<div class="empty">טוען…</div>':(L.length?L.map(bub).join(''):`<div class="secmsg a">${hi}אני ${esc(S.name)}. אפשר לשאול אותי על הכספים, הספקים, העובדים, המשימות וההזמנות של העסק, על המידע ששמרתם על העסק ועל היומן.</div>`)+(X.msgErr?`<p class="note">${esc(X.msgErr)}</p>`:'');
 const busy=X.sending?`<div class="secmsg a" id="secWait"><small>${X.deep?'חושבת לעומק…':'כותבת…'}</small></div>`:'';
 return bar+warn+`<div id="secChat">${body}${busy}</div>
 <div class="chips" style="margin:10px 0 6px">${QS.map(q=>`<button class="chip" data-a="secQ" data-v="${esc(q)}" style="min-height:40px">${esc(q)}</button>`).join('')}</div>
 <form data-f="secAskF" id="secForm"><textarea class="secin" name="q" maxlength="2000" placeholder="כתבו שאלה על העסק…" aria-label="שאלה למזכירה">${esc(X.draft||'')}</textarea>
 <div class="row" style="margin-top:8px"><button class="btn grow" name="go" value="n"${X.sending?' disabled':''}>שליחה</button><button class="btn g grow" name="go" value="d"${X.sending?' disabled':''} title="מודל איכותי – עולה יותר בתקרה">חשבי לעומק</button></div></form>
 <p class="note" style="margin:6px 0 0">כל מספר מגיע עם מקור. מספר שלא נמצא בנתונים מסומן "לא אומת". המזכירה עלולה לטעות – לפני החלטה כספית, משפטית או לגבי עובד כדאי לבדוק עם איש מקצוע.</p>`}
const secFinOk=()=>{try{return typeof S!=='undefined'&&S&&Array.isArray(S.tx)&&S.tx.length&&!brMineIds()}catch(e){return false}};
function setH(S){return `<div class="card"><b>מראה הכספים בענן</b><p class="note" style="margin:4px 0 8px">עותק מסכם של נתוני הכספים, לתזכורות ולדוחות כשהאפליקציה סגורה. כשהוא כבוי – תזכורות כספים ודוחות לא יפעלו.</p>
 <label class="chip" style="min-height:44px;width:100%;justify-content:flex-start"><input type="checkbox" data-c="secMir"${S.mirror!==false?' checked':''}> פעיל${S.mirrorAt?' · עודכן '+esc(fmtAt(S.mirrorAt)):''}</label></div>
 <div class="card" style="margin-top:8px"><b>סף התראת תזרים</b><p class="note" style="margin:4px 0 8px">${S.cfTh!=null?'הסף שאישרת: '+esc(Number(S.cfTh).toLocaleString('he-IL'))+' ₪':'עדיין לא נקבע. המזכירה תציע סף כשתשאלו על התזרים.'}</p><button class="chip" data-a="secThEd" style="min-height:40px">${S.cfTh!=null?'שינוי':'קביעת סף'}</button></div>
 <div class="card" style="margin-top:8px"><b>פגישה בשישי, בשבת או בחג</b><p class="note" style="margin:4px 0 8px">מה לעשות כשאירוע נקבע ליום שאינו יום עסקים.</p><div class="chips" role="radiogroup"><label class="chip" style="min-height:44px"><input type="radio" name="secWe" data-c="secWe" value="warn"${S.we!=='accept'?' checked':''}> להזהיר ולהציע יום אחר</label><label class="chip" style="min-height:44px"><input type="radio" name="secWe" data-c="secWe" value="accept"${S.we==='accept'?' checked':''}> לקבל בלי הערה</label></div></div>
 ${waSetH()}
 ${gSetH()}
 ${ntH(S)}
 <button class="btn g w" data-a="secEdit" style="margin-top:10px">שינוי שם ואופן פנייה</button><button class="btn g w" data-a="secSetX" style="margin-top:8px">חזרה לשיחה</button>
 <div class="sec"><h3>יומן פעולות</h3></div>${logH()}`}
ACT.secSet=()=>{X.set=1;rerender()};
CHG.secWe=async el=>{const v=el.value;try{await fnCall('secPrefs',{op:'calWe',v});X.st.we=v;toast('נשמר')}catch(e){err(e);rerender()}};
ACT.secSetX=()=>{X.set=0;rerender()};
ACT.secGo=el=>{const v=el.dataset.v;if(v[0]==='@'){X.tab=v.slice(1);X.fl=X.cl=X.rl=null;rerender();return}if(V[v])go(v)};
ACT.secQ=el=>{const f=document.getElementById('secForm');if(f){f.q.value=el.dataset.v;ask2(el.dataset.v,false)}};
FRM.secAskF=(f,ev)=>{const sub=ev&&ev.submitter;ask2(String(f.q.value||''),!!(sub&&sub.value==='d'))};
CHG.secMir=async el=>{const on=!!el.checked;el.disabled=true;try{await fnCall('secPrefs',{op:'mirror',on});X.st.mirror=on;toast(on?'המראה פעיל':'המראה כבוי – תזכורות כספים ודוחות לא יפעלו');if(on){MR.h='';mirSched()}}catch(e){el.checked=!on;err(e)}finally{el.disabled=false;rerender()}};
ACT.secNr=async el=>{const k=el.dataset.k;try{await fnCall('secPrefs',{op:'notRelevant',key:k});X.nr=Object.assign({},X.nr,{[k]:1});toast('לא אציע את זה שוב ב-90 הימים הקרובים');rerender()}catch(e){err(e)}};
async function thSave(a){try{await fnCall('secPrefs',{op:'threshold',amount:a});X.st.cfTh=a;toast(a==null?'הסף נמחק':'הסף נשמר');rerender()}catch(e){err(e)}}
ACT.secTh=el=>{const a=Math.round(+el.dataset.v);if(a>=0)thSave(a)};
ACT.secThEd=()=>{dlg(`<h3>סף התראת תזרים</h3><form data-f="secThF"><label class="f"><span>התראה כשהיתרה הצפויה נמוכה מ- (₪)</span><input class="amt" name="a" inputmode="numeric" dir="ltr" maxlength="9" value="${X.st.cfTh!=null?esc(String(X.st.cfTh)):''}"></label><div class="row"><button class="btn grow">שמירה</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`)};
FRM.secThF=f=>{const v=String(f.a.value||'').replace(/[,\s₪]/g,'');if(v===''){closeDlg();return thSave(null)}if(!/^\d{1,9}$/.test(v))return toast('סכום לא תקין');closeDlg();thSave(+v)};
const scrollEnd=()=>setTimeout(()=>{const f=document.getElementById('secForm');if(f&&f.scrollIntoView)f.scrollIntoView({block:'end'})},30);
// 13.11.2026: קוד הסיבה כשספק ה-AI נכשל (reason מ-functions/lib/sec-ai.js), כדי שיהיה אפשר לאבחן מהמסך
const AIR={'ai-quota':'נגמרה המכסה או אין חיוב פעיל בחשבון ה-AI','ai-rejected':'שירות ה-AI דחה את הבקשה – מפתח או מודל לא תקינים','ai-model':'מודל ה-AI לא נמצא בשירות','ai-overloaded':'עומס זמני בשירות ה-AI','ai-timeout':'שירות ה-AI לא ענה בזמן','ai-network':'אין חיבור מהשרת לשירות ה-AI','ai-error':'שגיאה לא מוכרת בשירות ה-AI'};
async function ask2(q,deep){q=q.replace(/\s+$/,'');if(!q.trim()||X.sending)return;if(q.length>2000)return toast('השאלה ארוכה מדי (עד 2,000 תווים)');
 X.msgs=X.msgs||[];X.msgs.push({role:'u',text:q,t:Date.now()});X.sending=1;X.deep=deep;X.draft='';rerender();scrollEnd();
 try{const fin=secFin({pay:!!X.st.pay});const d={text:q,deep};if(fin)d.fin=fin;
  const r=await fnCall('secChat',d);
  X.msgs.push({role:'a',text:r.reply,src:r.src||[],ideas:r.ideas||[],th:r.th||null,cards:r.cards||[],stale:!!r.stale,mode:r.mode,t:Date.now()});if((r.cards||[]).length){X.fl=null;X.cl=null}
  if(Number.isFinite(r.pct))X.st.pct=r.pct;X.st.saving=r.saving?(X.st.saving||'month'):'';if(r.mode==='saving')X.st.saving=X.st.saving||'month'}
 catch(e){const rs=e&&Object.prototype.hasOwnProperty.call(AIR,e.reason)?' (סיבה: '+AIR[e.reason]+')':'';X.msgs.push({role:'a',text:((e&&e.message)||'השליחה נכשלה. נסו שוב.')+rs,t:Date.now()});if(e&&e.reason==='rate-limit')X.draft=q}
 finally{X.sending=0;X.deep=0;if(cur().v==='sec')rerender();scrollEnd()}}
window.__secAsk=ask2;

/* =====================================================================================
   שלב 3: מידע על העסק (5.3), מידע רגיש (10.8), בנק תשובות (3.5), יומן (7.1), ייבוא מהמזכירה הקודמת (99, 100), כרטיסי אישור בצ'אט.
   הכול דרך פונקציות השרת (secFacts, secSens, secRules, secCal, secImport). כאן רק תצוגה; ההרשאות נאכפות בשרת.
   ===================================================================================== */
const css3=document.createElement('style');
css3.textContent='.sectabs{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px}.sectabs .chip{min-height:40px}'
+'.secoff{background:color-mix(in srgb,var(--acc) 7%,var(--card))}.secday{margin:10px 0 4px;font-weight:700}.secday small{font-weight:400;margin-inline-start:6px}'
+'.secsens{border-style:dashed!important}.sectags{font-size:.78rem;padding:1px 8px;border:1px solid var(--line);border-radius:10px;margin-inline-start:4px;white-space:nowrap}'
+'.secrow{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}.secrow .chip{min-height:40px}.secli{padding:10px 0;border-bottom:1px solid var(--line)}.secli:last-child{border-bottom:0}.secli p{margin:0 0 4px;white-space:pre-wrap;overflow-wrap:anywhere}';
document.head.appendChild(css3);
const TABS=[['chat','שיחה'],['wa','ווצאפ'],['notes','התראות'],['reps','דוחות'],['facts','מידע על העסק'],['cal','יומן'],['bank','תשובות מוכנות']];
const unseenN=()=>X.nl&&!X.nl.err?X.nl.unseen:((X.st&&X.st.unseen)||0);
function tabsH(){const t=X.tab||'chat';return `<div class="sectabs" role="tablist" id="secTabs">${TABS.map(([k,l])=>`<button class="chip${t===k?' on':''}" role="tab" aria-selected="${t===k}" data-a="secTab" data-v="${k}">${l}${k==='facts'&&X.facts&&X.facts.pend?` (${X.facts.pend})`:''}${k==='notes'&&unseenN()?` <span class="secbadge">${unseenN()}</span>`:''}${k==='wa'&&typeof waN==='function'&&waN()?` <span class="secbadge">${waN()}</span>`:''}</button>`).join('')}</div>`}
/* 13.11.2026: מעבר בין לשוניות – המידע הקודם מוצג מיד ומתעדכן ברקע (במקום "טוען…" בכל מעבר). אחרי שגיאה – טעינה רגילה */
const swr=(o,k,b,ld)=>{const R=o[k];if(!R||R.err){o[k]=null;return}if(!X[b])ld()};
ACT.secTab=el=>{X.tab=el.dataset.v;if(X.tab==='facts')swr(X,'fl','fb',factsLoad);if(X.tab==='cal')swr(X,'cl','cb',calLoad);if(X.tab==='bank')swr(X,'rl','rb',rulesLoad);if(X.tab==='notes')swr(X,'nl','nb',notesLoad);if(X.tab==='reps'){X.rp=null;swr(X,'rpl','rb4',repsLoad)}rerender()};
const dShort=d=>{if(!d)return '';const[y,m,x]=d.split('-').map(Number);return x+'.'+m+'.'+y};
const hebD=d=>{try{const[y,m,x]=d.split('-').map(Number);return new Intl.DateTimeFormat('he-u-ca-hebrew',{day:'numeric',month:'long'}).format(new Date(y,m-1,x,12))}catch(e){return ''}};
const wkD=d=>{try{const[y,m,x]=d.split('-').map(Number);return new Date(y,m-1,x,12).toLocaleDateString('he-IL',{weekday:'long'})}catch(e){return ''}};
const isOff=d=>{try{const[y,m,x]=d.split('-').map(Number);const dt=new Date(y,m-1,x,12);return typeof tkBiz==='function'?!tkBiz(dt):dt.getDay()>4}catch(e){return false}};
const todayS=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};

/* ---------- כרטיסי אישור בצ'אט (47, 7.1): "אשר" / "בטל". נשמר רק באישור ---------- */
X.done=X.done||{};
function cardH(c){const d=X.done[c.id];
 if(d)return `<div class="card" style="margin:6px 0 0;padding:8px"><small>${esc(d)}</small></div>`;
 if(c.k==='fact'){const cf=(c.conflict||[]).map(x=>`<li>${esc(x.text)}</li>`).join('');
  return `<div class="card" style="margin:6px 0 0;padding:8px" data-card="${esc(c.id)}"><b>לשמור במידע על העסק?</b><p style="margin:4px 0">${esc(c.text)}${c.exp?` <span class="sectags">עד ${esc(dShort(c.exp))}</span>`:''}</p>
  ${cf?`<p class="note" style="margin:4px 0">זה נראה סותר את מה שכבר שמור:</p><ul style="margin:0 0 4px;padding-inline-start:18px">${cf}</ul><p class="note" style="margin:0">איזו נכונה?</p><div class="secrow"><button class="chip" data-a="secFOk" data-id="${esc(c.id)}" data-rp="${esc((c.conflict||[]).map(x=>x.id).join(','))}">החדשה נכונה</button><button class="chip" data-a="secFNo" data-id="${esc(c.id)}">הקיימת נכונה</button><button class="chip" data-a="secFOk" data-id="${esc(c.id)}" data-both="1">שתיהן נכונות</button></div>`
  :`<div class="secrow"><button class="chip" data-a="secFOk" data-id="${esc(c.id)}">אשר ושמור</button><button class="chip" data-a="secFNo" data-id="${esc(c.id)}">בטל</button></div>`}</div>`}
 if(c.k==='cal'){const w=c.warn;
  return `<div class="card" style="margin:6px 0 0;padding:8px" data-card="${esc(c.id)}"><b>לקבוע ביומן?</b><p style="margin:4px 0">${esc(c.title)} · ${esc(wkD(c.d))} ${esc(dShort(c.d))}${c.tm?' · <bdi dir="ltr">'+esc(c.tm)+'</bdi>':''} <span class="sectags">${c.to==='biz'?'של העסק':'אישי'}</span></p>
  ${w?`<p class="note" style="margin:4px 0">התאריך נופל ב${esc(w.kind)}. להשאיר או להעביר ל${esc(wkD(w.next))} ${esc(dShort(w.next))}?</p><div class="secrow"><button class="chip" data-a="secCOk" data-id="${esc(c.id)}" data-d="${esc(w.next)}">להעביר ל-${esc(dShort(w.next))}</button><button class="chip" data-a="secCOk" data-id="${esc(c.id)}" data-force="1">להשאיר</button><button class="chip" data-a="secCNo" data-id="${esc(c.id)}">בטל</button></div>`
  :`<div class="secrow"><button class="chip" data-a="secCOk" data-id="${esc(c.id)}">אשר</button><button class="chip" data-a="secCNo" data-id="${esc(c.id)}">בטל</button></div>`}</div>`}
 return ''}
const doneMsg=(id,m)=>{X.done[id]=m;X.fl=null;X.cl=null;rerender()};
const notPend=e=>e&&e.reason==='not-pending'||e&&e.reason==='not-found';
ACT.secFOk=async el=>{const id=el.dataset.id,d={op:'approve',id};if(el.dataset.rp){d.force=true;d.replace=el.dataset.rp.split(',').filter(Boolean)}if(el.dataset.both)d.force=true;el.disabled=true;
 try{const r=await fnCall('secFacts',d);if(r&&r.ok===false&&r.conflict){/* סתירה שנוצרה אחרי ההצעה – שואלים */const c=(X.msgs||[]).flatMap(m=>m.cards||[]).find(x=>x.id===id);if(c){c.conflict=r.conflict;rerender()}return}doneMsg(id,'נשמר במידע על העסק.')}
 catch(e){if(notPend(e))doneMsg(id,'ההצעה כבר טופלה.');else{el.disabled=false;err(e)}}};
ACT.secFNo=async el=>{const id=el.dataset.id;el.disabled=true;try{await fnCall('secFacts',{op:'reject',id});doneMsg(id,'לא נשמר.')}catch(e){if(notPend(e))doneMsg(id,'ההצעה כבר טופלה.');else{el.disabled=false;err(e)}}};
ACT.secCOk=async el=>{const id=el.dataset.id,d={op:'approve',id};if(el.dataset.d)d.d=el.dataset.d;if(el.dataset.force)d.force=true;el.disabled=true;
 try{const r=await fnCall('secCal',d);if(r&&r.ok===false&&r.warn){const c=(X.msgs||[]).flatMap(m=>m.cards||[]).find(x=>x.id===id);if(c){c.warn=r.warn;rerender()}else toast('התאריך נופל ב'+r.warn.kind);return}doneMsg(id,'נקבע ביומן'+(d.d?' ל-'+dShort(d.d):'')+'.')}
 catch(e){if(notPend(e))doneMsg(id,'ההצעה כבר טופלה.');else{el.disabled=false;err(e)}}};
ACT.secCNo=async el=>{const id=el.dataset.id;el.disabled=true;try{await fnCall('secCal',{op:'reject',id});doneMsg(id,'לא נקבע.')}catch(e){if(notPend(e))doneMsg(id,'ההצעה כבר טופלה.');else{el.disabled=false;err(e)}}};

/* ---------- מידע על העסק (8.2 מסך 5) ---------- */
async function factsLoad(){X.fb=1;const s0=X.fl;let again=0;try{const r=await fnCall('secFacts',{op:'list'});if(s0&&X.fl===null){again=1;return}X.fl=r;X.facts={pend:(r.facts||[]).filter(f=>f.st==='prop').length}}catch(e){X.fl=X.fl&&!X.fl.err?X.fl:{err:e&&e.message||'לא נטען'}}finally{X.fb=0;if(again){factsLoad();return}if(cur().v==='sec'&&!typing())rerender()}}
function factsH(S){const R=X.fl;if(!R){if(!X.fb)factsLoad();return '<div class="empty">טוען…</div>'}if(R.err)return `<div class="card"><p class="note">${esc(R.err)}</p><button class="btn g w" data-a="secTab" data-v="facts">נסה שוב</button></div>`;
 const F=R.facts||[],TP=R.topics||{},FX=R.fixed||{},pend=F.filter(f=>f.st==='prop'),ok=F.filter(f=>f.st==='ok'&&!f.fx),fx={};F.filter(f=>f.fx).forEach(f=>fx[f.fx]=f);
 const who=f=>`<small class="note">${f.src==='chat'?'הוצע בשיחה':'נכתב ידנית'} · ${esc(tm(f.t))}${f.exp?` · ${f.expired?'פג תוקף':'בתוקף עד'} ${esc(dShort(f.exp))}`:''}</small>`;
 let h=`<p class="note" style="margin:0 0 8px">כאן מלמדים את ${esc(S.name||'המזכירה')} על העסק: שעות, כתובות, ספקים, תפקידי עובדים, מטרות וכללי תשובה. כל עובדה נשמרת רק כשאתם כותבים אותה או מאשרים הצעה. אפשר לקבוע תאריך תפוגה (למשל למבצע).</p>`;
 if(pend.length)h+=`<div class="card secwarn" id="secPend"><b>המזכירה הציעה לשמור (${pend.length})</b>${pend.map(f=>`<div class="secli"><p>${esc(f.text)} <span class="sectags">${esc(TP[f.topic]||'')}</span></p>${who(f)}<div class="secrow"><button class="chip" data-a="secFOk" data-id="${esc(f.id)}">אשר ושמור</button><button class="chip" data-a="secFNo" data-id="${esc(f.id)}">בטל</button></div></div>`).join('')}</div>`;
 h+=`<details class="card" style="margin-top:8px"${Object.keys(fx).length?'':' open'}><summary style="min-height:40px;display:flex;align-items:center;cursor:pointer"><b>פרטים קבועים</b></summary><form data-f="secFxF">${Object.entries(FX).map(([k,l])=>`<label class="f"><span>${esc(l)}</span><input name="${esc(k)}" maxlength="500" autocomplete="off" value="${esc(fx[k]?fx[k].text:'')}"></label>`).join('')}<button class="btn w" style="margin-top:8px">שמירת הפרטים</button></form></details>`;
 h+=`<div class="card" style="margin-top:8px"><b>עובדה חדשה</b><form data-f="secFAddF"><label class="f"><span>נושא</span><select name="topic">${Object.entries(TP).map(([k,l])=>`<option value="${esc(k)}">${esc(l)}</option>`).join('')}</select></label><label class="f"><span>העובדה</span><textarea name="text" maxlength="500" rows="2" class="secin" style="min-height:56px" placeholder="למשל: ספק החלב – משלמים לו תמיד ב-10 לחודש"></textarea></label><label class="f"><span>בתוקף עד (לא חובה)</span><input type="date" name="exp" dir="ltr" min="${todayS()}"></label><button class="btn w" style="margin-top:8px">שמירה</button></form></div>`;
 for(const[k,l]of Object.entries(TP)){const L=ok.filter(f=>f.topic===k);h+=`<details class="card" style="margin-top:8px"${L.length?' open':''}><summary style="min-height:40px;display:flex;align-items:center;cursor:pointer"><b>${esc(l)}</b><span class="sectags">${L.length}</span></summary>${L.length?L.map(f=>`<div class="secli"><p>${esc(f.text)}</p>${who(f)}<div class="secrow"><button class="chip" data-a="secFEd" data-id="${esc(f.id)}">ערוך</button><button class="chip" data-a="secFDel" data-id="${esc(f.id)}">מחק</button></div></div>`).join(''):'<p class="note">אין עדיין עובדות בנושא הזה</p>'}</details>`}
 const P=R.price;h+=`<div class="card" style="margin-top:8px" id="secPrice"><b>מחירון</b><p class="note" style="margin:4px 0">${P?`${esc(P.name||'מחירון')} · ${P.rows.length} פריטים · עודכן ${esc(tm(P.at))}`:'עדיין לא הועלה מחירון.'} המחירון משמש לתשובות על מחירים. קובץ CSV או טקסט: בכל שורה פריט ומחיר (ויחידה, לא חובה), מופרדים בפסיק.</p>
 <div class="secrow"><label class="chip" style="cursor:pointer">העלאת מחירון<input type="file" accept=".csv,.txt,text/csv,text/plain" data-c="secPriceF" hidden></label>${P?'<button class="chip" data-a="secPriceV">הצגה</button><button class="chip" data-a="secPriceDel">מחיקה</button>':''}</div></div>`;
 if(R.sens)h+=sensH();
 return h}
FRM.secFxF=async f=>{const R=X.fl;if(!R)return;const x=fd(f),b=f.querySelector('button'),F=R.facts||[];b.disabled=true;let n=0;
 try{for(const k of Object.keys(R.fixed||{})){const v=String(x[k]||'').replace(/\s+/g,' ').trim(),o=F.find(z=>z.fx===k);if(v!==(o?o.text:'')){await fnCall('secFacts',{op:'fixed',key:k,text:v});n++}}toast(n?'נשמר':'אין שינוי');X.fl=null;rerender()}catch(e){err(e)}finally{b.disabled=false}};
async function factSave(d,b){try{const r=await fnCall('secFacts',d);if(r&&r.ok===false&&r.conflict){
  dlg(`<h3>זה נראה סותר עובדה שכבר שמורה</h3><p>החדשה: <b>${esc(d.text)}</b></p><p class="note">השמורה:</p><ul>${r.conflict.map(c=>`<li>${esc(c.text)}</li>`).join('')}</ul><p>איזו נכונה?</p><div class="secrow"><button class="chip" data-a="secFC" data-m="new">החדשה</button><button class="chip" data-a="secFC" data-m="old">השמורה</button><button class="chip" data-a="secFC" data-m="both">שתיהן</button></div>`);
  X.fpend={d,ids:r.conflict.map(c=>c.id)};return false}
 toast('נשמר');X.fl=null;rerender();return true}catch(e){err(e);return false}finally{if(b)b.disabled=false}}
ACT.secFC=async el=>{const p=X.fpend;closeDlg();if(!p)return;X.fpend=null;if(el.dataset.m==='old')return toast('לא נשמר');const d=Object.assign({},p.d,{force:true});if(el.dataset.m==='new')d.replace=p.ids;await factSave(d)};
FRM.secFAddF=async f=>{const x=fd(f),t=String(x.text||'').trim();if(!t)return toast('כתבו את העובדה');if(t.length>500)return toast('עד 500 תווים');const b=f.querySelector('button');b.disabled=true;await factSave({op:'add',topic:x.topic,text:t,exp:x.exp||''},b)};
ACT.secFEd=el=>{const f=(X.fl.facts||[]).find(z=>z.id===el.dataset.id);if(!f)return;const TP=X.fl.topics||{};
 dlg(`<h3>עריכת עובדה</h3><form data-f="secFEdF" data-id="${esc(f.id)}"><label class="f"><span>נושא</span><select name="topic">${Object.entries(TP).map(([k,l])=>`<option value="${esc(k)}"${k===f.topic?' selected':''}>${esc(l)}</option>`).join('')}</select></label><label class="f"><span>העובדה</span><textarea name="text" maxlength="500" rows="3" class="secin">${esc(f.text)}</textarea></label><label class="f"><span>בתוקף עד (לא חובה)</span><input type="date" name="exp" dir="ltr" value="${esc(f.exp&&!f.expired?f.exp:'')}"></label><div class="row"><button class="btn grow">שמירה</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`)};
FRM.secFEdF=async f=>{const x=fd(f);try{await fnCall('secFacts',{op:'edit',id:f.dataset.id,topic:x.topic,text:String(x.text||'').trim(),exp:x.exp||''});closeDlg();toast('נשמר');X.fl=null;rerender()}catch(e){err(e)}};
ACT.secFDel=el=>{const id=el.dataset.id;ask('למחוק את העובדה? המזכירה לא תשתמש בה יותר.',async()=>{try{await fnCall('secFacts',{op:'del',id});toast('נמחק');X.fl=null;rerender()}catch(e){err(e)}},'מחיקה')};
/* מחירון: פענוח CSV/טקסט במכשיר (פריט, מחיר[, יחידה]); השרת בודק שוב */
function parsePrice(txt){const rows=[];let bad=0;for(const ln of String(txt).replace(/^﻿/,'').split(/\r?\n/)){const l=ln.trim();if(!l)continue;const c=l.split(/\t|;|,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(s=>s.replace(/^"|"$/g,'').trim());
 const p=parseFloat(String(c[1]||'').replace(/[₪\s]/g,''));if(!c[0]||!Number.isFinite(p)||p<0){bad++;continue}rows.push(c[2]?{n:c[0].slice(0,80),p:Math.round(p*100)/100,u:c[2].slice(0,20)}:{n:c[0].slice(0,80),p:Math.round(p*100)/100})}return{rows,bad}}
CHG.secPriceF=el=>{const file=el.files&&el.files[0];el.value='';if(!file)return;if(file.size>300000)return toast('הקובץ גדול מדי');const rd=new FileReader();rd.onload=()=>{const{rows,bad}=parsePrice(rd.result);
 if(!rows.length)return toast('לא נמצאו שורות עם פריט ומחיר');if(rows.length>1000)return toast('עד 1,000 פריטים');
 ask(`נמצאו ${rows.length} פריטים${bad?` (${bad} שורות בלי מחיר דולגו – למשל שורת כותרת)`:''}. להחליף את המחירון הקיים?`,async()=>{try{await fnCall('secFacts',{op:'price',name:file.name.replace(/\.[^.]+$/,'').slice(0,60),rows});toast('המחירון נשמר');X.fl=null;rerender()}catch(e){err(e)}},'שמירה')};rd.readAsText(file)};
ACT.secPriceV=()=>{const P=X.fl&&X.fl.price;if(!P)return;dlg(`<h3>${esc(P.name||'מחירון')}</h3><p class="note">עודכן ${esc(tm(P.at))}</p><div style="max-height:60vh;overflow:auto">${P.rows.map(r=>`<div class="li" style="cursor:default"><div class="m"><b>${esc(r.n)}</b>${r.u?`<small>${esc(r.u)}</small>`:''}</div><bdi dir="ltr">${esc(Number(r.p).toLocaleString('he-IL'))} ₪</bdi></div>`).join('')}</div><button class="btn g w" data-a="closeDlg">סגירה</button>`)};
ACT.secPriceDel=()=>ask('למחוק את המחירון?',async()=>{try{await fnCall('secFacts',{op:'priceDel'});toast('נמחק');X.fl=null;rerender()}catch(e){err(e)}},'מחיקה');

/* מידע רגיש על עובד (10.8, 63): נטען רק בלחיצה (כל קריאה נרשמת ביומן), מוצג רק למנהל עם הרשאה כשהמתג העסקי פעיל */
function sensH(){const L=X.sens;
 return `<div class="card secsens" style="margin-top:8px" id="secSens"><b>מידע רגיש על עובדים</b><p class="note" style="margin:4px 0">מותר לשמור כאן מידע כמו בריאות או מצב משפחתי. המידע מוצפן בשרת, נגיש רק למנהלים עם הרשאה, וכל צפייה נרשמת ביומן הפעולות. מומלץ לכתוב רק מה שנחוץ לניהול. המזכירה משתמשת בו רק כדי להסביר נתונים – לעולם לא כבסיס להחלטה נגד עובד.</p>
 ${L?(L.length?L.map(x=>x.bad?`<div class="secli"><p class="note">רשומה שלא ניתן לפענח</p></div>`:`<div class="secli"><p><b>${esc(x.emp)}</b> – ${esc(x.text)}</p><small class="note">${esc(tm(x.t))}</small><div class="secrow"><button class="chip" data-a="secSEd" data-id="${esc(x.id)}">ערוך</button><button class="chip" data-a="secSDel" data-id="${esc(x.id)}">מחק</button></div></div>`).join(''):'<p class="note">אין מידע רגיש שמור</p>')+'<button class="chip" data-a="secSHide" style="min-height:40px">הסתרה</button>':'<button class="chip" data-a="secSShow" style="min-height:40px">הצגת המידע (נרשם ביומן)</button>'}
 <form data-f="secSAddF" style="margin-top:8px"><label class="f"><span>שם העובד/ת</span><input name="emp" maxlength="60" autocomplete="off"></label><label class="f"><span>המידע</span><textarea name="text" maxlength="500" rows="2" class="secin" style="min-height:56px"></textarea></label><button class="btn w" style="margin-top:8px">שמירה מוצפנת</button></form></div>`}
ACT.secSShow=async()=>{try{const r=await fnCall('secSens',{op:'list'});X.sens=r.items||[];rerender()}catch(e){err(e)}};
ACT.secSHide=()=>{X.sens=null;rerender()};
FRM.secSAddF=async f=>{const x=fd(f),b=f.querySelector('button');if(!String(x.emp||'').trim()||!String(x.text||'').trim())return toast('שם העובד והמידע – חובה');b.disabled=true;
 try{await fnCall('secSens',{op:'add',emp:x.emp,text:x.text});toast('נשמר מוצפן');f.reset();if(X.sens)await ACT.secSShow();else rerender()}catch(e){err(e)}finally{b.disabled=false}};
ACT.secSEd=el=>{const x=(X.sens||[]).find(z=>z.id===el.dataset.id);if(!x)return;dlg(`<h3>עריכת מידע רגיש</h3><form data-f="secSEdF" data-id="${esc(x.id)}"><label class="f"><span>שם העובד/ת</span><input name="emp" maxlength="60" value="${esc(x.emp)}"></label><label class="f"><span>המידע</span><textarea name="text" maxlength="500" rows="3" class="secin">${esc(x.text)}</textarea></label><div class="row"><button class="btn grow">שמירה</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`)};
FRM.secSEdF=async f=>{const x=fd(f);try{await fnCall('secSens',{op:'edit',id:f.dataset.id,emp:x.emp,text:x.text});closeDlg();toast('נשמר');await ACT.secSShow()}catch(e){err(e)}};
ACT.secSDel=el=>{const id=el.dataset.id;ask('למחוק את המידע הרגיש הזה?',async()=>{try{await fnCall('secSens',{op:'del',id});toast('נמחק');await ACT.secSShow()}catch(e){err(e)}},'מחיקה')};

/* ---------- יומן (8.2 מסך 4): רשימה (ברירת מחדל) ושבוע; שישי/שבת/חג בגוון עדין; הצעות מהמזכירה – לאישור ---------- */
async function calLoad(){X.cb=1;const s0=X.cl;let again=0;try{const r=await fnCall('secCal',{op:'list'});if(s0&&X.cl===null){again=1;return}X.cl=r}catch(e){X.cl=X.cl&&!X.cl.err?X.cl:{err:e&&e.message||'לא נטען'}}finally{X.cb=0;if(again){calLoad();return}if(cur().v==='sec'&&!typing())rerender()}}
const SRC={mgr:'ידני',sec:'מהמזכירה',import:'ייבוא',wa:'מווצאפ'};
function evH(e){return `<div class="secli"><p><b>${e.tm?'<bdi dir="ltr">'+esc(e.tm)+'</bdi> · ':''}${esc(e.title)}</b> ${e.rem?'<span class="sectags">תזכורת</span>':''}<span class="sectags">${e.biz?'של העסק':'אישי'}</span><span class="sectags">${esc(SRC[e.src]||'ידני')}</span>${e.offW?'<span class="sectags w">'+esc(e.offW)+'</span>':''}</p>${e.note?`<small class="note">${esc(e.note)}</small>`:''}<div class="secrow"><button class="chip" data-a="secEvEd" data-id="${esc(e.id)}">ערוך</button><button class="chip" data-a="secEvDel" data-id="${esc(e.id)}">מחק</button></div></div>`}
function calH(){const R=X.cl;if(!R){if(!X.cb)calLoad();return '<div class="empty">טוען…</div>'}if(R.err)return `<div class="card"><p class="note">${esc(R.err)}</p><button class="btn g w" data-a="secTab" data-v="cal">נסה שוב</button></div>`;
 const td=R.today||todayS(),E=R.events||[],pend=E.filter(e=>e.st==='prop'),ok=E.filter(e=>e.st==='ok'&&e.d>=td),view=X.cv||'list';
 let h=`<div class="secrow" style="margin:0 0 8px"><button class="btn" data-a="secEvAdd" style="flex:1">+ אירוע</button><button class="chip${view==='list'?' on':''}" data-a="secCv" data-v="list">רשימה</button><button class="chip${view==='week'?' on':''}" data-a="secCv" data-v="week">שבוע</button></div>`;
 const soon=ok.slice(0,3);h+=`<div class="card" id="secSoon"><b>קרוב</b>${soon.length?soon.map(e=>`<div class="note" style="margin-top:4px">${esc(dShort(e.d))}${e.tm?' <bdi dir="ltr">'+esc(e.tm)+'</bdi>':''} – ${esc(e.title)}</div>`).join(''):'<p class="note" style="margin:4px 0 0">אין אירועים קרובים</p>'}</div>`;
 if(pend.length)h+=`<div class="card secwarn" style="margin-top:8px"><b>המזכירה הציעה (${pend.length})</b>${pend.map(e=>cardH({k:'cal',id:e.id,title:e.title,d:e.d,tm:e.tm,to:e.to,warn:e.off&&R.we!=='accept'?{kind:e.off,next:nextBiz(e.d)}:null})).join('')}</div>`;
 const days=[];if(view==='week'){for(let i=0;i<7;i++){const[y,m,x]=td.split('-').map(Number);const d=new Date(y,m-1,x+i,12);days.push(d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'))}}
 else{[...new Set(ok.map(e=>e.d))].slice(0,60).forEach(d=>days.push(d))}
 if(!days.length)return h+'<div class="empty">אין אירועים ביומן</div>';
 h+=days.map(d=>{const L=ok.filter(e=>e.d===d),off=isOff(d);return `<div class="card${off?' secoff':''}" style="margin-top:8px"><div class="secday">${esc(wkD(d))} ${esc(dShort(d))}<small class="note">${esc(hebD(d))}${off?' · יום לא עסקים':''}</small></div>${L.length?L.map(evH).join(''):'<p class="note" style="margin:0">—</p>'}</div>`}).join('');
 return h}
const nextBiz=d=>{let[y,m,x]=d.split('-').map(Number);for(let i=1;i<30;i++){const dt=new Date(y,m-1,x+i,12),s=dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0')+'-'+String(dt.getDate()).padStart(2,'0');if(!isOff(s))return s}return d};
ACT.secCv=el=>{X.cv=el.dataset.v;rerender()};
function evForm(e){e=e||{};return `<h3>${e.id?'עריכת אירוע':'אירוע חדש'}</h3><form data-f="secEvF"${e.id?` data-id="${esc(e.id)}"`:''}><label class="f"><span>כותרת</span><input name="title" maxlength="120" autocomplete="off" value="${esc(e.title||'')}"></label>
 <div class="row"><label class="f grow"><span>תאריך</span><input type="date" name="d" dir="ltr" min="${todayS()}" value="${esc(e.d||todayS())}"></label><label class="f grow"><span>שעה (לא חובה)</span><input type="time" name="tm" dir="ltr" value="${esc(e.tm||'')}"></label></div>
 <label class="f"><span>הערה (לא חובה)</span><input name="note" maxlength="500" autocomplete="off" value="${esc(e.note||'')}"></label>
 ${e.id?'':`<label class="chip" style="min-height:44px;width:100%;justify-content:flex-start;margin-top:6px"><input type="checkbox" name="biz" value="1"> של העסק (כל המנהלים רואים)</label><label class="chip" style="min-height:44px;width:100%;justify-content:flex-start;margin-top:6px"><input type="checkbox" name="rem" value="1"> תזכורת (התראה בשעה שנקבעה)</label>`}
 <div class="row" style="margin-top:8px"><button class="btn grow">שמירה</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`}
ACT.secEvAdd=()=>dlg(evForm());
ACT.secEvEd=el=>{const e=((X.cl||{}).events||[]).find(z=>z.id===el.dataset.id);if(e)dlg(evForm(e))};
async function evSave(d){const r=await fnCall('secCal',d);if(r&&r.ok===false&&r.warn){const w=r.warn;
  dlg(`<h3>${esc(w.kind)}</h3><p>${w.rem?'התזכורת':'האירוע'} נופל${w.rem?'ת':''} ב${esc(w.kind)} (${esc(dShort(w.d))}). ${w.rem?'להשאיר בזמנה':'להשאיר'} או להעביר ל${esc(wkD(w.next))} ${esc(dShort(w.next))}?</p><div class="secrow"><button class="chip" data-a="secEvW" data-m="move">להעביר ל-${esc(dShort(w.next))}</button><button class="chip" data-a="secEvW" data-m="keep">להשאיר</button><button class="chip" data-a="closeDlg">ביטול</button></div>`);X.evp={d,next:w.next};return}
 closeDlg();toast('נשמר ביומן');X.cl=null;rerender()}
FRM.secEvF=async f=>{const x=fd(f),t=String(x.title||'').trim();if(!t)return toast('כתבו כותרת');if(!x.d)return toast('בחרו תאריך');const d={op:f.dataset.id?'edit':'add',title:t,d:x.d,tm:x.tm||'',note:String(x.note||'').trim()};if(f.dataset.id)d.id=f.dataset.id;else{d.biz=x.biz==='1';if(x.rem==='1')d.rem=true}
 const b=f.querySelector('button');b.disabled=true;try{await evSave(d)}catch(e){err(e)}finally{b.disabled=false}};
ACT.secEvW=async el=>{const p=X.evp;if(!p)return;X.evp=null;const d=Object.assign({},p.d);if(el.dataset.m==='move')d.d=p.next;else d.force=true;try{await evSave(d)}catch(e){err(e)}};
ACT.secEvDel=el=>{const id=el.dataset.id;ask('למחוק את האירוע?',async()=>{try{await fnCall('secCal',{op:'del',id});toast('נמחק');X.cl=null;rerender()}catch(e){err(e)}},'מחיקה')};

/* ---------- תשובות מוכנות (בנק תשובות, 3.5) + ייבוא מהמזכירה הקודמת (99, 100) ---------- */
async function rulesLoad(){X.rb=1;const s0=X.rl;let again=0;try{const r=await fnCall('secRules',{op:'list'});if(s0&&X.rl===null){again=1;return}X.rl=r}catch(e){X.rl=X.rl&&!X.rl.err?X.rl:{err:e&&e.message||'לא נטען'}}finally{X.rb=0;if(again){rulesLoad();return}if(cur().v==='sec'&&!typing())rerender()}}
function bankH(){const R=X.rl;if(!R){if(!X.rb)rulesLoad();return '<div class="empty">טוען…</div>'}if(R.err)return `<div class="card"><p class="note">${esc(R.err)}</p><button class="btn g w" data-a="secTab" data-v="bank">נסה שוב</button></div>`;
 const L=R.rules||[];
 return `<p class="note" style="margin:0 0 8px">שאלה שמתאימה לתשובה מוכנה נענית מיד, בלי עלות. תשובה עם "תנאים" (למשל "רק אם יש במלאי") עוברת למזכירה, שבודקת את התנאי.</p>
 <div class="secrow" style="margin:0 0 8px"><button class="btn" data-a="secRAdd" style="flex:1">+ תשובה מוכנה</button><label class="chip" style="cursor:pointer;min-height:44px;display:inline-flex;align-items:center">ייבוא מהמזכירה הקודמת<input type="file" accept=".json,application/json" data-c="secImpF" hidden></label></div>
 <div class="card">${L.length?L.map(r=>`<div class="secli"><p><b>${esc(r.q.join(' / '))}</b>${r.on?'':' <span class="sectags">כבויה</span>'}${r.src==='import'?' <span class="sectags">ייבוא</span>':''}</p><p>${esc(r.a)}</p>${r.cond?`<small class="note">תנאים: ${esc(r.cond)}</small>`:''}<div class="secrow"><button class="chip" data-a="secREd" data-id="${esc(r.id)}">ערוך</button><button class="chip" data-a="secRDel" data-id="${esc(r.id)}">מחק</button></div></div>`).join(''):'<p class="note" style="margin:0">אין עדיין תשובות מוכנות</p>'}</div>`}
function ruleForm(r){r=r||{};return `<h3>${r.id?'עריכת תשובה מוכנה':'תשובה מוכנה חדשה'}</h3><form data-f="secRF"${r.id?` data-id="${esc(r.id)}"`:''}><label class="f"><span>ניסוחים של השאלה (שורה לכל ניסוח, עד 10)</span><textarea name="q" rows="3" class="secin" maxlength="2100" placeholder="שעות פתיחה&#10;מתי אתם פתוחים">${esc((r.q||[]).join('\n'))}</textarea></label>
 <label class="f"><span>התשובה</span><textarea name="a" rows="3" class="secin" maxlength="1000">${esc(r.a||'')}</textarea></label><label class="f"><span>תנאים (לא חובה)</span><input name="cond" maxlength="300" value="${esc(r.cond||'')}" placeholder="למשל: רק אם יש במלאי"></label>
 <label class="chip" style="min-height:44px;width:100%;justify-content:flex-start;margin-top:6px"><input type="checkbox" name="on" value="1"${r.on===false?'':' checked'}> פעילה</label><div class="row" style="margin-top:8px"><button class="btn grow">שמירה</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`}
ACT.secRAdd=()=>dlg(ruleForm());
ACT.secREd=el=>{const r=((X.rl||{}).rules||[]).find(z=>z.id===el.dataset.id);if(r)dlg(ruleForm(r))};
FRM.secRF=async f=>{const x=fd(f),q=String(x.q||'').split(/\n/).map(s=>s.trim()).filter(Boolean);if(!q.length)return toast('כתבו לפחות ניסוח אחד');if(q.length>10)return toast('עד 10 ניסוחים');if(!String(x.a||'').trim())return toast('כתבו תשובה');
 const d={op:f.dataset.id?'edit':'add',q,a:String(x.a).trim(),cond:String(x.cond||'').trim(),on:x.on==='1'};if(f.dataset.id)d.id=f.dataset.id;const b=f.querySelector('button');b.disabled=true;
 try{await fnCall('secRules',d);closeDlg();toast('נשמר');X.rl=null;rerender()}catch(e){err(e)}finally{b.disabled=false}};
ACT.secRDel=el=>{const id=el.dataset.id;ask('למחוק את התשובה המוכנה?',async()=>{try{await fnCall('secRules',{op:'del',id});toast('נמחק');X.rl=null;rerender()}catch(e){err(e)}},'מחיקה')};
/* ייבוא: קודם תצוגה מקדימה (כמה ייכנס, מה כבר קיים, מה עבר), ורק אחרי אישור – ייבוא. לא דורס כלום */
CHG.secImpF=el=>{const file=el.files&&el.files[0];el.value='';if(!file)return;if(file.size>1000000)return toast('הקובץ גדול מדי (עד 1MB)');const rd=new FileReader();rd.onload=async()=>{const raw=String(rd.result||'');
 try{const p=await fnCall('secImport',{raw,dry:true});const bad=(p.bad&&(p.bad.rules+p.bad.events))||0;
  dlg(`<h3>ייבוא מהמזכירה הקודמת</h3><ul class="secterms"><li>תשובות מוכנות חדשות: <b>${p.rules}</b>${p.ruleDup?` (${p.ruleDup} כבר קיימות – לא ישתנו)`:''}</li><li>אירועים עתידיים: <b>${p.events}</b>${p.evDup?` (${p.evDup} כבר ביומן)`:''}</li>${p.past?`<li>${p.past} אירועים שכבר עברו – לא ייובאו</li>`:''}${bad?`<li>${bad} פריטים פגומים – ידולגו</li>`:''}</ul><p class="note">שום דבר קיים לא יימחק ולא יוחלף. האירועים ייכנסו ליומן האישי שלך.</p>
  <div class="row"><button class="btn grow" data-a="secImpGo"${p.rules+p.events?'':' disabled'}>ייבוא</button><button class="btn g grow" data-a="closeDlg">ביטול</button></div>`);X.imp=raw}catch(e){err(e)}};rd.readAsText(file)};
ACT.secImpGo=async el=>{const raw=X.imp;if(!raw)return;el.disabled=true;try{const r=await fnCall('secImport',{raw});X.imp=null;closeDlg();toast(`יובאו ${r.written.rules} תשובות ו-${r.written.events} אירועים`);X.rl=null;X.cl=null;rerender()}catch(e){el.disabled=false;err(e)}};

/* ---------- מנהל־על: בכרטיס העסק ---------- */
const SA={};
const saLoad=id=>{SA[id]=null;fnCall('secAdminGet',{bizId:id}).then(r=>{SA[id]=r}).catch(e=>{SA[id]={err:e&&e.message||'שגיאה'}}).finally(()=>{if(cur().v==='sab')rerender()})};
{const s=V.sab;if(s)V.sab=id=>{const r=s(id);try{const b=(ADM.L||[]).find(x=>x.id===id);if(!SY.sa||!b||(b.missing&&id!==BZ0)||!r||!r.h)return r;
 if(SA[id]===undefined)saLoad(id);const c=SA[id];
 const on=!!(b.features&&b.features.secretary===true);
 let h=`<div class="sec"><h3>המזכירה העסקית</h3></div>`;
 if(!c){r.h+=h+'<div class="empty">טוען…</div>';return r}
 if(c.err){r.h+=h+`<div class="card"><p class="note">${esc(c.err)}</p><button class="btn g w" data-a="secSaRe" data-id="${esc(id)}">נסה שוב</button></div>`;return r}
 const A=c.admins||[],dollars=c.capCents==null?'':String(Math.round(c.capCents/100));
 const nm=a=>esc(a.email||a.uid);
 h+=`<form class="card" data-f="secSaF" data-id="${esc(id)}"><p class="note" style="margin-top:0">${on?'התוספת פעילה בעסק.':'התוספת כבויה בעסק. אפשר להכין את ההגדרות, ולהפעיל במתג "המזכירה העסקית" ברשימת התוספות.'}</p>
 <b>1. מי משתמש במזכירה</b><div class="chips" role="radiogroup" style="margin:6px 0"><label class="chip" style="min-height:44px"><input type="radio" name="mode" value="all"${c.mode!=='main'?' checked':''}> כל המנהלים</label><label class="chip" style="min-height:44px"><input type="radio" name="mode" value="main"${c.mode==='main'?' checked':''}> מנהל ראשי בלבד</label></div>
 <label class="f"><span>המנהל הראשי</span><select name="mainUid"><option value="">לא נבחר</option>${A.map(a=>`<option value="${esc(a.uid)}"${c.mainUid===a.uid?' selected':''}>${nm(a)}</option>`).join('')}</select></label>
 <b style="display:block;margin-top:10px">2. תקרת עלות חודשית</b><label class="f"><span>דולרים בחודש (מספר שלם; מנהל העסק רואה רק אחוז ניצול)</span><input name="cap" inputmode="numeric" dir="ltr" maxlength="6" value="${esc(dollars)}" placeholder="לא נקבעה"><small class="note">עד 10,000 דולר. שדה ריק = בלי תקרה.</small></label>
 <b style="display:block;margin-top:10px">3. שאלות שכר – לכל מנהל</b>${A.length?A.map(a=>`<label class="chip" style="min-height:44px;margin:4px 0;width:100%;justify-content:flex-start"><input type="checkbox" name="pay_${esc(a.uid)}" value="1"${c.pay&&c.pay[a.uid]?' checked':''}> ${nm(a)}</label>`).join(''):'<p class="note">אין מנהלים בעסק</p>'}
 <b style="display:block;margin-top:10px">3ב. מידע רגיש על עובדים – לכל מנהל</b>${A.length?A.map(a=>`<label class="chip" style="min-height:44px;margin:4px 0;width:100%;justify-content:flex-start"><input type="checkbox" name="sens_${esc(a.uid)}" value="1"${c.sens&&c.sens[a.uid]?' checked':''}> ${nm(a)}</label>`).join(''):''}<small class="note">פועל רק כשסעיף 4 (ניתוח עובדים ומידע רגיש) פעיל. המידע מוצפן, וכל צפייה נרשמת ביומן.</small>
 <b style="display:block;margin-top:10px">3א. קצב הודעות לכל מנהל</b><div class="row"><label class="f grow"><span>לשעה</span><input name="rh" inputmode="numeric" dir="ltr" maxlength="3" value="${esc(String((c.rate||{}).hour||''))}"></label><label class="f grow"><span>ליום</span><input name="rd" inputmode="numeric" dir="ltr" maxlength="4" value="${esc(String((c.rate||{}).day||''))}"></label></div><small class="note">ברירת מחדל: ${esc(String((c.rateDefault||{}).hour||40))} לשעה, ${esc(String((c.rateDefault||{}).day||200))} ליום.</small>
 <b style="display:block;margin-top:10px">4. ניתוח עובדים ומידע רגיש</b><label class="chip" style="min-height:44px;margin:4px 0;width:100%;justify-content:flex-start"><input type="checkbox" name="emp" value="1"${c.emp?' checked':''}> פעיל</label>
 <p class="note" style="margin:0">${c.empDefault?'עסק הפיילוט: פעיל כברירת מחדל (החלטה פ4).':'בעסק של לקוח – להפעיל רק אחרי חוות דעת עורך דין.'}</p>
 <button class="btn w" style="margin-top:10px">שמירה</button></form>`;
 h+=`<div class="card" style="margin-top:8px"><b>מנהלים ותנאי השימוש</b>${A.map(a=>{const k=c.consent&&c.consent[a.uid];return `<div class="li" style="cursor:default"><div class="m"><b>${nm(a)}</b><small>${k?(k.cur?'אישר/ה ב-'+esc(tm(k.at)):'אישר/ה נוסח קודם'):'עוד לא אישר/ה'}</small></div>${on?`<button class="chip" data-a="secSaChat" data-id="${esc(id)}" data-u="${esc(a.uid)}" style="min-height:44px">צפייה בשיחה</button>`:''}</div>`}).join('')||'<p class="note">אין מנהלים</p>'}
 <p class="note" style="margin:6px 0 0">כל צפייה בשיחה נרשמת ביומן הפעולות, ומנהל העסק רואה אותה.</p></div>`;
 r.h+=h}catch(e){}return r}}
ACT.secSaRe=el=>{saLoad(el.dataset.id);rerender()};
FRM.secSaF=async f=>{const id=f.dataset.id,c=SA[id];if(!c||c.err)return;const x=fd(f),b=f.querySelector('button');
 const cap=String(x.cap||'').replace(/[,\s$]/g,'').trim();if(cap&&(!/^\d{1,5}$/.test(cap)||+cap>10000))return toast('תקרה: מספר שלם של דולרים, בין 0 ל-10,000');
 if(x.mode==='main'&&!x.mainUid)return toast('בחרו מנהל ראשי');
 const pay={},sens={};for(const a of c.admins||[]){pay[a.uid]=x['pay_'+a.uid]==='1';sens[a.uid]=x['sens_'+a.uid]==='1'}
 const data={bizId:id,mode:x.mode==='main'?'main':'all',mainUid:x.mainUid||'',emp:x.emp==='1'};if(Object.keys(pay).length){data.pay=pay;data.sens=sens}if(cap)data.capCents=+cap*100;else if(c.capCents!=null)data.capCents=null;/* ריק אחרי שהייתה תקרה = ניקוי */
 const rh=String(x.rh||'').trim(),rd=String(x.rd||'').trim(),R=c.rate||{};
 if(rh||rd){if(!/^\d{1,3}$/.test(rh)||!/^\d{1,4}$/.test(rd)||+rh<1||+rh>500||+rd<1||+rd>5000||+rd<+rh)return toast('קצב: לשעה 1–500, ליום 1–5,000 (ליום לא פחות מלשעה)');if(+rh!==R.hour||+rd!==R.day)data.rate={hour:+rh,day:+rd}}
 b.disabled=true;try{const r=await window.fnCall('secAdminSetCfg',data);SA[id]=r;toast('נשמר')}catch(e){err(e)}finally{b.disabled=false;if(cur().v==='sab')rerender()}};
ACT.secSaChat=el=>{const id=el.dataset.id,u=el.dataset.u;ask('לצפות בשיחה? הצפייה תירשם ביומן הפעולות, ומנהל העסק יראה אותה.',async()=>{
 try{const r=await window.fnCall('secAdminReadChat',{bizId:id,uid:u});const L=r&&r.msgs||[];
  dlg(`<h3>שיחה (קריאה בלבד)</h3>${L.length?L.map(m=>`<div class="card" style="margin:6px 0;${m.role==='a'?'border-color:var(--acc)':''}"><small class="note">${m.role==='a'?'המזכירה':'המנהל'} · ${esc(tm(m.t))}</small><div style="white-space:pre-wrap">${esc(m.text)}</div></div>`).join(''):'<p class="note">אין הודעות בשיחה</p>'}<button class="btn g w" data-a="closeDlg">סגירה</button>`)}catch(e){err(e)}},'כן, לצפות')};

/* =====================================================================================
   שלב 4: התראות (7.2), תזכורות (7.3, 76), דוחות ותובנות (6.4, 8.2 מסך 7), הגדרות (67, 69, 74, 77), מחיקת היסטוריה (93), רישום להתראות טלפון.
   הכול דרך השרת (secNotes, secReports, secHistory, secPrefs op:'notify', registerPushToken). תוכן התראת הטלפון כללי – הפרטים רק כאן.
   ===================================================================================== */
const css4=document.createElement('style');
css4.textContent='.secbadge{display:inline-block;min-width:20px;padding:0 6px;border-radius:10px;background:var(--acc);color:var(--card);font-size:.75rem;line-height:20px;text-align:center}'
+'.secnew{border-inline-start:3px solid var(--acc)!important}.secrep h4{margin:12px 0 4px}.secrep ul{margin:0;padding-inline-start:18px}.secrep li{overflow-wrap:anywhere}'
+'.secnt select,.secnt input[type=time]{min-height:40px;max-width:100%}.secnt .row{flex-wrap:wrap}';
document.head.appendChild(css4);
const WDN=['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
/* ---------- התראות ---------- */
async function notesLoad(){X.nb=1;const s0=X.nl;let again=0;try{const r=await fnCall('secNotes',{op:'list'});if(s0&&X.nl===null){again=1;return}X.nl=r;const ids=(r.notes||[]).filter(n=>!n.seen).map(n=>n.id).slice(0,100);
 if(ids.length)fnCall('secNotes',{op:'seen',ids}).then(()=>{if(X.st)X.st.unseen=0;if(X.nl)X.nl.unseen=0}).catch(()=>{})}
 catch(e){X.nl=X.nl&&!X.nl.err?X.nl:{err:e&&e.message||'לא נטען'}}finally{X.nb=0;if(again){notesLoad();return}if(cur().v==='sec'&&!typing())rerender()}}
const KIND={rep:'דוח',emp:'עובד',dig:'תקציר',wa:'ווצאפ'};
function noteH(n,T){const lab=n.k==='rem'?(T[n.typ]||'תזכורת'):(KIND[n.k]||'');const open=n.st==='open'&&n.k==='rem';
 return `<div class="secli${n.seen?'':' secnew'}" style="padding-inline-start:8px"><p><b>${esc(n.title)}</b> <span class="sectags">${esc(lab)}</span>${n.st==='done'?'<span class="sectags">טופל</span>':n.st==='gone'?'<span class="sectags">כבר לא רלוונטי</span>':''}</p>
 <small class="note">${esc(tm(n.at))}${n.n>1?' · נשלחה '+n.n+' פעמים':''}</small>${n.body?`<p class="note" style="margin:4px 0 0">${esc(n.body)}</p>`:''}
 <div class="secrow">${n.k==='rep'&&n.ref?`<button class="chip" data-a="secRpOpen" data-id="${esc(n.ref)}">פתיחת הדוח</button>`:''}${open?`<button class="chip" data-a="secNDone" data-id="${esc(n.id)}">טופל</button><label class="chip" style="gap:6px">חזרות <select data-c="secNReps" data-id="${esc(n.id)}" aria-label="מספר חזרות">${[0,1,2,3].map(k=>`<option value="${k}"${k===n.rep?' selected':''}>${k}</option>`).join('')}</select></label>`:''}</div></div>`}
function notesH(){const R=X.nl;if(!R){if(!X.nb)notesLoad();return '<div class="empty">טוען…</div>'}if(R.err)return `<div class="card"><p class="note">${esc(R.err)}</p><button class="btn g w" data-a="secTab" data-v="notes">נסה שוב</button></div>`;
 const L=R.notes||[];if(!L.length)return '<div class="empty">אין התראות</div>';
 return `<div class="card" id="secNotes">${L.map(n=>noteH(n,R.types||{})).join('')}</div><p class="note">תזכורת שלא טופלה חוזרת עד 3 פעמים, פעם ביום עסקים. אפשר לשנות בכל תזכורת.</p>`}
ACT.secNDone=async el=>{el.disabled=true;try{await fnCall('secNotes',{op:'done',id:el.dataset.id});toast('סומן כטופל');X.nl=null;rerender()}catch(e){el.disabled=false;err(e)}};
CHG.secNReps=async el=>{const n=+el.value;try{await fnCall('secNotes',{op:'reps',id:el.dataset.id,n});toast(n?'התזכורת תחזור עוד '+n+' פעמים':'החזרות בוטלו')}catch(e){err(e);X.nl=null;rerender()}};
/* ---------- דוחות ותובנות ---------- */
async function repsLoad(){X.rb4=1;const s0=X.rpl;let again=0;try{const r=await fnCall('secReports',{op:'list'});if(s0&&X.rpl===null){again=1;return}X.rpl=r}catch(e){X.rpl=X.rpl&&!X.rpl.err?X.rpl:{err:e&&e.message||'לא נטען'}}finally{X.rb4=0;if(again){repsLoad();return}if(cur().v==='sec'&&!typing())rerender()}}
function repH(r){const done=new Set(r.done||[]);
 return `<div class="card secrep" id="secRep"><button class="chip" data-a="secRpBack">חזרה לרשימה</button><h3 style="margin:8px 0 0">${esc(r.title)} · ${esc(dShort(r.key.length===7?r.key+'-01':r.key))}</h3>${r.why?`<p class="note" style="margin:4px 0 0">${esc(r.why)}</p>`:''}
 ${(r.secs||[]).map(x=>`<h4>${esc(x.h)}</h4><ul>${(x.lines||[]).map(l=>`<li>${esc(String(l).replace(/^• /,''))}</li>`).join('')}</ul>`).join('')}
 ${(r.ideas||[]).length?`<h4>רעיונות לשיפור</h4>${r.ideas.map(i=>`<div class="secli"><p>${esc(i.seen)}</p><small class="note">למה זה חשוב: ${esc(i.why||'')}</small>${(i.options||[]).length?`<ul>${i.options.map(o=>`<li>${esc(o)}</li>`).join('')}</ul>`:''}${i.unknown?`<small class="note" style="display:block">מה לא ידוע: ${esc(i.unknown)}</small>`:''}
  <div class="secrow">${done.has(i.key)?'<span class="sectags">טופל</span>':`<button class="chip" data-a="secRpDone" data-id="${esc(r.id)}" data-k="${esc(i.key)}">סמן כטופל</button>`}${X.nr&&X.nr[i.key]?'<span class="sectags">לא יוצע שוב 90 יום</span>':`<button class="chip" data-a="secNr" data-k="${esc(i.key)}">לא רלוונטי</button>`}</div></div>`).join('')}`:''}
 <p class="note" style="margin:10px 0 0">${esc(r.src||'')}</p></div>`}
function repsH(){if(X.rp)return X.rp.err?`<div class="card"><p class="note">${esc(X.rp.err)}</p></div>`:repH(X.rp);
 const R=X.rpl;if(!R){if(!X.rb4)repsLoad();return '<div class="empty">טוען…</div>'}if(R.err)return `<div class="card"><p class="note">${esc(R.err)}</p><button class="btn g w" data-a="secTab" data-v="reps">נסה שוב</button></div>`;
 const L=R.reports||[];if(!L.length)return '<div class="empty">עוד אין דוחות. הדוח השבועי והחודשי יופיעו כאן ביום ובשעה שנקבעו בהגדרות.</div>';
 return `<div class="card">${L.map(r=>`<button type="button" class="li" data-a="secRpOpen" data-id="${esc(r.id)}" style="width:100%;text-align:right;color:var(--ink);background:none;border:0;border-bottom:1px solid var(--line)"><div class="m"><b>${esc(r.title)}</b><small>${esc(tm(r.t))}${r.why?' · '+esc(r.why):''}</small></div></button>`).join('')}</div>`}
ACT.secRpOpen=async el=>{const id=el.dataset.id;X.tab='reps';X.rp={title:'טוען…',key:'',secs:[],ideas:[],id};rerender();try{const r=await fnCall('secReports',{op:'get',id});X.rp=r.report}catch(e){X.rp={err:e&&e.message||'הדוח לא נטען'}}rerender()};
ACT.secRpBack=()=>{X.rp=null;rerender()};
ACT.secRpDone=async el=>{const id=el.dataset.id,key=el.dataset.k;el.disabled=true;try{await fnCall('secReports',{op:'done',id,key});if(X.rp&&X.rp.id===id)X.rp.done=(X.rp.done||[]).concat([key]);toast('סומן כטופל');rerender()}catch(e){el.disabled=false;err(e)}};
/* ---------- הגדרות: התראות ודוחות (67, 69, 74, 76, 77) + מחיקת היסטוריה (93) ---------- */
const hours=(v,nm)=>`<select name="${nm}" aria-label="שעה">${Array.from({length:24},(_,h)=>`<option value="${h}"${h===v?' selected':''}>${String(h).padStart(2,'0')}:00</option>`).join('')}</select>`;
function ntH(S){const n=S.nt||{q:{}},T=S.types||{},rt=n.rt||{};
 return `<form class="card secnt" data-f="secNtF" style="margin-top:8px"><b>התראות ודוחות</b><p class="note" style="margin:4px 0 8px">התראות מופיעות כאן במסך המזכירה, וגם בטלפון (אם ההתראות מופעלות במכשיר). הדוחות – באפליקציה בלבד.</p>
 <div class="row"><label class="f grow"><span>דוח שבועי – יום</span><select name="wd" data-c="secNtWd">${WDN.map((d,i)=>`<option value="${i}"${i===n.wd?' selected':''}>${d}</option>`).join('')}</select></label><label class="f grow"><span>שעה</span>${hours(n.wh,'wh')}</label></div>
 <p class="note" id="secWdWarn" style="margin:0 0 6px">${n.wd===5||n.wd===6?'הדוח יופיע ביום העסקים הבא':''}</p>
 <div class="row"><label class="f grow"><span>דוח חודשי – יום בחודש</span><select name="md" aria-label="יום בחודש"><option value="0"${!n.md?' selected':''}>יום העסקים הראשון</option>${Array.from({length:31},(_,i)=>`<option value="${i+1}"${n.md===i+1?' selected':''}>${i+1}</option>`).join('')}</select></label><label class="f grow"><span>שעה</span>${hours(n.mh,'mh')}</label></div>
 <p class="note" style="margin:0 0 6px">יום שנופל בשישי, בשבת או בחג – הדוח יופיע ביום העסקים הבא. יום שלא קיים בחודש (למשל 31) – ביום האחרון בחודש.</p>
 <div class="row"><label class="chip" style="min-height:44px;flex:1;justify-content:flex-start"><input type="checkbox" name="dg" value="1"${n.dg?' checked':''}> תקציר יומי</label><label class="f grow"><span>בשעה</span>${hours(n.dh,'dh')}</label></div>
 <b style="display:block;margin-top:8px">שעות שקטות</b><small class="note">התראת טלפון שנופלת בהן מחכה לסופן.</small>
 <div class="row"><label class="chip" style="min-height:44px;justify-content:flex-start"><input type="checkbox" name="qon" value="1"${n.q&&n.q.on?' checked':''}> פעיל</label><label class="f grow"><span>מ-</span><input type="time" name="qf" dir="ltr" value="${esc((n.q||{}).f||'22:00')}"></label><label class="f grow"><span>עד</span><input type="time" name="qt" dir="ltr" value="${esc((n.q||{}).t||'07:00')}"></label></div>
 <b style="display:block;margin-top:8px">תזכורות</b>${Object.keys(T).map(k=>`<label class="chip" style="min-height:44px;margin:4px 0;width:100%;justify-content:flex-start"><input type="checkbox" name="rt_${esc(k)}" value="1"${rt[k]?' checked':''}> ${esc(T[k])}${k==='emp'&&!S.emp?' (פועל רק כשניתוח העובדים פעיל)':''}</label>`).join('')}
 <label class="f"><span>חזרות לתזכורת שלא טופלה (פעם ביום עסקים)</span><select name="reps">${[0,1,2,3].map(k=>`<option value="${k}"${k===n.reps?' selected':''}>${k}</option>`).join('')}</select></label>
 <button class="btn w" style="margin-top:8px">שמירה</button></form>
 <div class="card" style="margin-top:8px"><b>מחיקת היסטוריה</b><p class="note" style="margin:4px 0 8px">השיחות נשמרות 12 חודשים, ויומן הפעולות 24 חודשים. אפשר למחוק עכשיו את השיחה, ההתראות והדוחות שלך (יומן הפעולות נשאר). המחיקה מהמזכירה סופית; עותקי הגיבוי בשרת נמחקים לבד תוך 35 יום.</p><button class="btn g w" data-a="secHistDel">מחיקת ההיסטוריה שלי</button></div>`}
CHG.secNtWd=el=>{const w=document.getElementById('secWdWarn');if(w)w.textContent=(+el.value===5||+el.value===6)?'הדוח יופיע ביום העסקים הבא':''};
FRM.secNtF=async f=>{const x=fd(f),T=(X.st&&X.st.types)||{},rt={};for(const k of Object.keys(T))rt[k]=x['rt_'+k]==='1';
 const hm=/^([01]\d|2[0-3]):[0-5]\d$/;if(!hm.test(x.qf||'')||!hm.test(x.qt||'')||x.qf===x.qt)return toast('שעות שקטות: שעת התחלה וסיום שונות');
 const nt={wd:+x.wd,wh:+x.wh,md:+x.md,mh:+x.mh,dg:x.dg==='1',dh:+x.dh,q:{on:x.qon==='1',f:x.qf,t:x.qt},rt,reps:+x.reps};
 const b=f.querySelector('button.btn');b.disabled=true;try{const r=await fnCall('secPrefs',{op:'notify',nt});X.st.nt=r.nt||nt;toast(r.warn?'נשמר. '+r.warn:'נשמר')}catch(e){err(e)}finally{b.disabled=false}};
ACT.secHistDel=()=>{ask('למחוק את כל ההיסטוריה שלך במזכירה (שיחה, התראות ודוחות)?',async()=>{
 try{const r=await fnCall('secHistory',{op:'ask'});const c=r.counts||{};X.hd=r.token;
  dlg(`<h3>אישור שני – מחיקה סופית</h3><p>יימחקו: ${esc(String(c.chat||0))} הודעות בשיחה, ${esc(String(c.notes||0))} התראות ו-${esc(String(c.reports||0))} דוחות. הנתונים יימחקו מהמזכירה ואי אפשר לשחזר אותם מהאפליקציה. עותקי הגיבוי האוטומטי בשרת נמחקים לבד תוך 35 יום. המחיקה תירשם ביומן הפעולות.</p><div class="row"><button class="btn grow" data-a="secHistOk">כן, למחוק סופית</button><button class="btn g grow" data-a="closeDlg">ביטול</button></div>`)}catch(e){err(e)}},'המשך')};
ACT.secHistOk=async el=>{const t=X.hd;X.hd=null;if(!t)return closeDlg();el.disabled=true;try{const r=await fnCall('secHistory',{op:'del',token:t,sure:true});closeDlg();X.msgs=null;X.nl=null;X.rpl=null;X.rp=null;X.log=null;const d=r.deleted||{};toast('נמחק: '+(d.chat||0)+' הודעות, '+(d.notes||0)+' התראות, '+(d.reports||0)+' דוחות');rerender()}catch(e){el.disabled=false;err(e)}};
/* ---------- התראות לטלפון (7.2; 12.11.2026: רכיב ההתראות נוסף לאפליקציה) ----------
   רק באפליקציה לטלפון שנבנתה עם הגדרות Firebase (PushGate.ready). בלי זה – לא קורה כלום, וההתראות רק במסך (כמו קודם).
   מנהל: בכניסה הראשונה – בקשת הרשאה להתראות (Android 13+), פעם אחת בלבד בטלפון. אחר כך בכל פתיחה – רישום מחדש (המזהה מתחדש לפעמים).
   עובד: לא מתבקשת הרשאה. אם ההרשאה כבר קיימת בטלפון – נרשם על שמו, והשרת מוציא את הטלפון מהמשתמש הקודם (עובד לא מקבל התראות של מנהל).
   יציאה מהחשבון – מזהה הטלפון נמחק (unregister), כך שהתראות לא ממשיכות להגיע אליו. לחיצה על התראה – המזכירה, לשונית ההתראות. */
const PN={done:0,ready:0};
async function pushReg(){try{if(PN.done||!(isA()||isW()))return;const C=window.Capacitor,P=C&&C.Plugins&&C.Plugins.PushNotifications,G=C&&C.Plugins&&C.Plugins.PushGate;if(!P||!G)return;PN.done=1;
 const g=await G.state();if(!g||g.ready!==true)return;PN.ready=1;
 await P.addListener('registration',t=>{if(t&&t.value&&(isA()||isW()))window.fnCall('registerPushToken',{token:t.value}).catch(()=>{})});
 await P.addListener('pushNotificationActionPerformed',a=>{const d=a&&a.notification&&a.notification.data||{};if(d.k!=='sec'||!isA())return;X.tab='notes';X.nl=null;try{go('sec')}catch(e){}});
 let p=await P.checkPermissions();
 if(isA()&&(p.receive==='prompt'||p.receive==='prompt-with-rationale')){let asked=false;try{asked=localStorage.getItem('lp-push-asked')==='1'}catch(e){}
  if(!asked){try{localStorage.setItem('lp-push-asked','1')}catch(e){}p=await P.requestPermissions()}}
 if(p.receive==='granted')await P.register()}catch(e){}}
window.secPushBoot=()=>{try{pushReg()}catch(e){}};
window.secPushOff=()=>{try{const P=PN.ready&&window.Capacitor&&window.Capacitor.Plugins.PushNotifications;if(P){P.removeAllListeners().catch(()=>{});P.unregister().catch(()=>{})}PN.done=0;PN.ready=0}catch(e){}};
try{if(isA()||isW())setTimeout(window.secPushBoot,0)}catch(e){}
{const r0=V.sec;V.sec=()=>{const r=r0();try{if(ready())pushReg()}catch(e){}return r}}

/* =====================================================================================
   שלב 5: ווצאפ (3.2, 3.5, 8.2 מסך 2): תיבת הודעות, כרטיס שולח (17), טיוטה עם "שלח" – רק בלחיצה (secSend), חלון 24 שעות ותבניות,
   סימונים ("לא בטוחה", "לבדוק", "חשוד", הודעה קולית עם תמליל), "עצור הכל" (30–33), הגדרות המנהל (מספר המנהל – 16, "קיבלנו" – 22, פתיחה – 97),
   ובכרטיס העסק של מנהל־על: חיבור המספר (14), אישור מספרי המנהלים, מגבלת הודעות לשולח (89), שעות "קיבלנו", תבניות, עצירה לעסק ולכל העסקים.
   הכול דרך השרת (secInbox, secSend, secWaCfg, secAdminWa). כל ההרשאות נאכפות בשרת.
   ===================================================================================== */
const css5=document.createElement('style');
css5.textContent='.secstop{border-color:var(--bad)!important;background:color-mix(in srgb,var(--bad) 12%,var(--card))}.secstop b{color:var(--bad)}'
+'.secwa .li{align-items:flex-start;cursor:pointer}.secwa .li small{display:block;overflow-wrap:anywhere}.secin1{background:color-mix(in srgb,var(--ink) 6%,var(--card));border:1px solid var(--line);border-radius:12px;padding:8px 10px;margin:6px 0;white-space:pre-wrap;overflow-wrap:anywhere}'
+'.secdr{border:1.5px solid var(--acc);border-radius:12px;padding:8px 10px;margin:6px 0 10px;overflow-wrap:anywhere}.secdr textarea{width:100%;min-height:84px;box-sizing:border-box;margin-top:6px}.secdr select{min-height:40px;max-width:100%;flex:1}'
+'.sectags.w{border-color:var(--bad);color:var(--bad)}.sectags.g{border-color:var(--acc);color:var(--acc)}.sectg{display:flex;flex-wrap:wrap;gap:4px;margin:4px 0 0;min-width:0}.sectg .sectags{margin:0;white-space:normal}';
document.head.appendChild(css5);
const STOPW={flood:'הצפת הודעות',cap:'חריגה בתקרת העלות',errors:'שגיאות חוזרות'};
const FL={invErr:['הקובץ לא נקלט – תקלה','w'],err:['לא עובדה – לענות ידנית','w'],unsure:['המזכירה לא בטוחה','w'],sus:['תוכן חשוד – בלי טיוטה','w'],chk:['לבדוק לפני שליחה','w'],over:['מעל מגבלת ההודעות','w'],saving:['מצב חיסכון – בלי עיבוד','w'],voice:['הודעה קולית','g'],file:['קובץ','g'],ord:['בוט ההזמנות','']};
const flH=a=>(a||[]).filter(f=>FL[f]).map(f=>`<span class="sectags ${FL[f][1]}">${FL[f][0]}</span>`).join('');
const winH=ms=>ms>0?`<span class="sectags g">נותרו ${Math.max(1,Math.floor(ms/3600e3))} שעות לחלון</span>`:'<span class="sectags w">עברו 24 שעות</span>';
const linkL=l=>l?`<span class="sectags">${l.k==='sup'?'ספק':'לקוח'}: ${esc(l.name||'')}</span>`:'';
const lastTxt=m=>!m?'':String(m.sum||(m.type==='audio'?(m.tr||'הודעה קולית'):m.type==='other'?'קובץ':m.text)).slice(0,90);
const waN=()=>X.wa&&X.wa.list&&!X.wa.list.err?(X.wa.list.cards||[]).reduce((s,c)=>s+(c.pend||0),0):0;
/* ---------- "עצור הכל" (32: כל מנהל) ---------- */
async function wcLoad(){X.wcb=1;try{const r=await fnCall('secWaCfg',{op:'get'});X.wc=r&&r.ok&&r.stop&&r.ack&&r.open&&r.ackH?r:{err:'לא נטען'}}catch(e){X.wc={err:e&&e.message||'לא נטען'}}finally{X.wcb=0;if(cur().v==='sec'&&!typing())rerender()}}
function stopH(){const c=X.wc;if(!c){if(!X.wcb)wcLoad();return ''}if(c.err)return '';
 if(c.stop&&c.stop.on)return `<div class="card secstop" id="secStopBar" style="margin:0 0 8px" role="status"><b>עצור הכל – פעיל</b><p class="note" style="margin:4px 0 8px">${c.stop.auto?'המזכירה עצרה את עצמה ('+esc(STOPW[c.stop.why]||'תקלה')+'). ':''}שליחה אוטומטית בווצאפ עצורה. ההודעות ממשיכות להיכנס, ו"שלח" בלחיצה שלך עובד.</p><button class="btn w" data-a="secStop" data-on="0">ביטול העצירה</button></div>`;
 return `<div class="secrow" id="secStopBar" style="margin:0 0 8px;justify-content:flex-end"><button class="chip" data-a="secStop" data-on="1" style="min-height:40px">⏸ עצור הכל</button></div>`}
ACT.secStop=el=>{const on=el.dataset.on==='1';const run=async()=>{el.disabled=true;try{const r=await fnCall('secWaCfg',{op:'stop',on});if(r&&r.ok&&r.stop)X.wc=r;if(X.wa)X.wa.list=null;toast(on?'השליחה האוטומטית נעצרה':'העצירה בוטלה')}catch(e){err(e)}finally{el.disabled=false;rerender()}};
 if(on)ask('לעצור את כל השליחה האוטומטית בווצאפ (הודעת פתיחה, "קיבלנו" ותשובות למספר המנהל)? ההודעות ימשיכו להיכנס, ושליחה בלחיצה שלך תמשיך לעבוד.',run,'עצור הכל');else run()};
/* ---------- תיבת ההודעות ---------- */
const WF=[['all','הכול'],['pend','ממתין לתשובה'],['unsure','לא בטוחה'],['chk','לבדוק'],['sus','חשוד']];
async function waLoad(){X.wab=1;const s0=X.wa.list;let again=0;try{const r=await fnCall('secInbox',{op:'list'});if(s0&&X.wa.list===null){again=1;return}X.wa.list=r&&Array.isArray(r.cards)?r:{err:'לא נטען'}}catch(e){X.wa.list=X.wa.list&&!X.wa.list.err?X.wa.list:{err:e&&e.message||'לא נטען'}}finally{X.wab=0;if(again){waLoad();return}if(cur().v==='sec'&&!typing())rerender()}}
function waH(){if(X.wa.cur)return waCardH();const R=X.wa.list;if(!R){if(!X.wab)waLoad();return '<div class="empty">טוען…</div>'}if(R.err)return `<div class="card"><p class="note">${esc(R.err)}</p><button class="btn g w" data-a="secTab" data-v="wa">נסה שוב</button></div>`;
 const f=X.wa.f||'all',L=(R.cards||[]).filter(c=>f==='all'||(f==='pend'?c.pend>0||(c.flags||[]).includes('err'):(c.flags||[]).includes(f)));
 return `${R.connected?'':'<div class="card" style="margin-bottom:8px"><p class="note" style="margin:0">ווצאפ עוד לא מחובר לעסק. מנהל המערכת מחבר את המספר.</p></div>'}
 <div class="chips" style="margin:0 0 8px">${WF.map(([k,l])=>`<button class="chip${f===k?' on':''}" data-a="secWaF" data-v="${k}" style="min-height:40px" aria-pressed="${f===k}">${l}</button>`).join('')}</div>
 <div class="card secwa" id="secWaList">${L.length?L.map(c=>`<div class="li" data-a="secWaOpen" data-wa="${esc(c.wa)}" role="button" tabindex="0"><div class="m"><b>${esc(c.name||c.show)}</b><div class="sectg">${linkL(c.link)}${c.isNew?'<span class="sectags g">שולח חדש</span>':''}</div><small><bdi dir="ltr">${esc(c.show)}</bdi> · ${esc(tm(c.lastIn))}</small><small>${esc(lastTxt(c.last))}</small><div class="sectg">${c.pend?`<span class="sectags g">${c.pend===1?'טיוטה אחת':c.pend+' טיוטות'}</span>`:''}${flH(c.flags)}${winH(c.winLeft)}</div></div></div>`).join(''):'<p class="note">אין הודעות</p>'}</div>`}
ACT.secWaF=el=>{X.wa.f=el.dataset.v;rerender()};
ACT.secWaOpen=el=>{X.wa.cur=el.dataset.wa;X.wa.card=null;rerender()};
ACT.secWaBack=()=>{X.wa.cur=null;X.wa.card=null;X.wa.list=null;rerender()};
/* ---------- כרטיס שולח + טיוטות ---------- */
async function waCardLoad(){const wa=X.wa.cur;X.wa.cb=1;try{const r=await fnCall('secInbox',{op:'get',wa});if(X.wa.cur===wa)X.wa.card=r&&r.card?r:{err:'לא נטען'}}catch(e){X.wa.card={err:e&&e.message||'לא נטען'}}finally{X.wa.cb=0;if(cur().v==='sec'&&!typing())rerender()}}
function drH(d,open,tpls){
 if(d.st==='sent')return `<div class="secdr"><small class="note">נשלח ✓</small><div style="white-space:pre-wrap">${esc(d.sum||d.text)}</div></div>`;
 if(d.st==='done')return '<div class="secdr" style="opacity:.75"><small class="note">טופל בלי לענות</small></div>';
 const why=(d.why||[]).length?`<p class="note" style="margin:4px 0">${d.why.map(esc).join(' · ')}</p>`:'';
 const head=`<small class="note">טיוטת תשובה${d.src==='bank'?' (מתשובה מוכנה)':''}${d.lang&&d.lang!=='he'?' · בשפת הפונה':''}${d.st==='fail'?' · השליחה הקודמת נכשלה':''}</small>${(d.flags||[]).length?'<div class="sectg">'+flH(d.flags)+'</div>':''}${why}`;
 if(open)return `<div class="secdr" data-id="${esc(d.id)}">${head}<textarea class="secin" id="secDr_${esc(d.id)}" maxlength="2000" aria-label="טיוטת תשובה" dir="auto">${esc(d.text)}</textarea><div class="secrow"><button class="btn" data-a="secWaSend" data-id="${esc(d.id)}" style="flex:1">שלח</button><button class="chip" data-a="secWaDone" data-id="${esc(d.id)}">טופל בלי לענות</button></div></div>`;
 return `<div class="secdr" data-id="${esc(d.id)}">${head}<div style="white-space:pre-wrap;margin-top:4px">${esc(d.text)}</div><p class="note" style="margin:6px 0">עברו 24 שעות מההודעה האחרונה של הפונה. אפשר לשלוח רק הודעת תבנית מאושרת.</p>${(tpls||[]).length?`<div class="secrow"><select id="secTpl_${esc(d.id)}" aria-label="תבנית">${tpls.map(t=>`<option value="${esc(t.name)}">${esc(t.label)}</option>`).join('')}</select><button class="btn" data-a="secWaSend" data-id="${esc(d.id)}" data-t="1">שלח תבנית</button></div>`:'<p class="note" style="margin:0">אין תבניות מאושרות. מנהל המערכת מוסיף אותן.</p>'}<div class="secrow"><button class="chip" data-a="secWaDone" data-id="${esc(d.id)}">טופל בלי לענות</button></div></div>`}
function waCardH(){const R=X.wa.card,back='<button class="btn g w" data-a="secWaBack" style="margin-bottom:8px">חזרה לתיבת ההודעות</button>';
 if(!R){if(!X.wa.cb)waCardLoad();return back+'<div class="empty">טוען…</div>'}if(R.err)return back+`<div class="card"><p class="note">${esc(R.err)}</p></div>`;
 const c=R.card,open=c.winLeft>0,dr={};for(const d of R.drafts||[])if(d.in&&!d.auto)dr[d.in]=d;
 const items=(R.msgs||[]).map(m=>{const d=m.draft?dr[m.draft]:null;return `<div class="secin1"><small class="note">${esc(tm(m.t))}${m.clsL?' · '+esc(m.clsL):''}</small>${(m.flags||[]).length?'<div class="sectg">'+flH(m.flags)+'</div>':''}<div>${m.type==='audio'?icd('mic')+' <b>תמליל:</b> '+esc(m.tr||m.sum||'(לא תומלל)'):m.type==='other'?icd('clip')+' קובץ'+(m.sub?' ('+esc(m.sub)+')':'')+' – קליטת חשבוניות תגיע בהמשך':esc(m.sum||m.text)}</div></div>${d?drH(d,open,R.tpls):''}`}).join('');
 const autos=(R.drafts||[]).filter(d=>d.auto).map(d=>`<div class="secin1" style="border-style:dashed"><small class="note">נשלח אוטומטית (${/open/.test(d.kind)?'הודעת פתיחה':''}${/open/.test(d.kind)&&/ack/.test(d.kind)?' + ':''}${/ack/.test(d.kind)?'"קיבלנו"':''}) · ${esc(tm(d.t))}</small><div>${esc(d.sum||d.text)}</div></div>`).join('');
 return back+`<div class="card" id="secWaCard"><b>${esc(c.name||c.show)}</b> <bdi dir="ltr" class="note">${esc(c.show)}</bdi><div class="sectg">${c.link?linkL(c.link):'<span class="sectags">לא מקושר</span>'}${c.langL?`<span class="sectags">${esc(c.langL)}</span>`:''}${c.isNew?'<span class="sectags g">שולח חדש</span>':''}${winH(c.winLeft)}</div>
 <form class="secrow" data-f="secWaLink" style="margin-top:8px"><select name="k" aria-label="סוג" style="min-height:40px"><option value="cust"${c.link&&c.link.k==='cust'?' selected':''}>לקוח</option><option value="sup"${c.link&&c.link.k==='sup'?' selected':''}>ספק</option><option value="">בלי קישור</option></select><input name="name" maxlength="60" placeholder="שם הספק או הלקוח" value="${esc(c.link?c.link.name||'':'')}" style="flex:1;min-width:110px;min-height:40px" aria-label="שם"><button class="chip" style="min-height:40px">קישור</button></form></div>
 <div class="sec"><h3>הודעות</h3></div>${items||'<p class="note">אין הודעות</p>'}${autos}`}
const sid=()=>{try{const a=new Uint8Array(12);crypto.getRandomValues(a);return 's'+Array.from(a,b=>b.toString(16).padStart(2,'0')).join('')}catch(e){return 's'+Date.now().toString(36)+Math.random().toString(36).slice(2,10)}};
ACT.secWaSend=el=>{const id=el.dataset.id,isT=el.dataset.t==='1',d=((X.wa.card||{}).drafts||[]).find(x=>x.id===id);if(!d)return;
 d._sid=d._sid||sid();/* אותו מזהה בכל ניסיון חוזר – השרת לא ישלח פעמיים (10.2) */
 const data={id,sendId:d._sid};
 if(isT){const s=document.getElementById('secTpl_'+id);if(!s||!s.value)return;data.tpl=s.value}
 else{const t=document.getElementById('secDr_'+id),v=t?t.value.trim():d.text;if(!v)return toast('הטיוטה ריקה');if(v.length>2000)return toast('עד 2,000 תווים');if(v!==d.text)data.text=v}
 const run=async()=>{el.disabled=true;try{const r=await fnCall('secSend',data);toast(r&&r.already?'כבר נשלח':'נשלח');X.wa.card=null;X.wa.list=null;
   if(r&&r.offerAuto)dlg(`<h3>לענות על זה לבד?</h3><p>אישרת 3 פעמים תשובה מסוג "${esc(r.offerLabel)}" בלי שינוי. מהיום לענות על זה לבד?</p><p class="note">בשלב הזה רק נרשמת ההעדפה – כל תשובה עדיין נשלחת רק בלחיצה שלך.</p><div class="secrow"><button class="btn" data-a="secAutoYes" data-c="${esc(r.offerAuto)}" style="flex:1">כן</button><button class="btn g" data-a="closeDlg" style="flex:1">לא עכשיו</button></div>`)}
  catch(e){err(e);if(e&&e.reason==='window-closed')X.wa.card=null}finally{el.disabled=false;rerender()}};
 if((d.flags||[]).includes('chk'))ask('בטיוטה יש מידע שכדאי לבדוק ('+(d.why||[]).join(', ')+'). לשלוח בכל זאת?',run,'שלח');else run()};
ACT.secWaDone=el=>{const id=el.dataset.id;ask('לסמן כטופל בלי לענות? לא תישלח תשובה.',async()=>{try{await fnCall('secInbox',{op:'done',id});toast('סומן כטופל');X.wa.card=null;X.wa.list=null;rerender()}catch(e){err(e)}},'טופל')};
ACT.secAutoYes=async el=>{try{await fnCall('secInbox',{op:'autoYes',cls:el.dataset.c});closeDlg();toast('נרשם. בינתיים כל תשובה עדיין באישורך.')}catch(e){err(e)}};
FRM.secWaLink=async f=>{const x=fd(f),wa=X.wa.cur,name=String(x.name||'').trim();if(x.k&&!name)return toast('כתבו שם');try{await fnCall('secInbox',{op:'link',wa,k:x.k||'',name});toast('נשמר');X.wa.card=null;rerender()}catch(e){err(e)}};
/* ---------- הגדרות המנהל: מספר המנהל (16), פתיחה (97), "קיבלנו" (22) ---------- */
function waSetH(){const c=X.wc;if(!c){if(!X.wcb)wcLoad();return '<div class="empty">טוען…</div>'}if(c.err)return '';
 return `<form class="card" data-f="secWaSetF" id="secWaSet" style="margin-top:8px"><b>ווצאפ</b><p class="note" style="margin:4px 0 8px">${c.connected?'מחובר: <bdi dir="ltr">'+esc(c.num)+'</bdi>'+(c.link==='coexist'?' (דו־קיום עם WhatsApp Business בטלפון)':c.link==='moved'?' (המספר הועבר לשירות)':''):'עוד לא מחובר. מנהל המערכת מחבר את מספר העסק.'}</p>
 <label class="f"><span>המספר שלי ("מספר המנהל" – רק יומן ותזכורות)</span><input name="num" type="tel" dir="ltr" inputmode="tel" maxlength="20" value="${esc(c.myNum||c.myReq||'')}" placeholder="050-0000000"><small class="note">${c.myNum?'מאושר. מהמספר הזה אפשר לשאול על היומן ולבקש תזכורת ("תזכירי לי מחר ב-10…"). נתוני כספים והוראות אחרות – רק באפליקציה.':c.myReq?'ממתין לאישור מנהל המערכת.':'מנהל המערכת מאשר את המספר.'}</small></label>
 <label class="chip" style="min-height:44px;width:100%;justify-content:flex-start;margin-top:8px"><input type="checkbox" name="openOn" value="1"${c.open.on?' checked':''}> הודעת פתיחה לפונה חדש</label><label class="f"><span>נוסח הודעת הפתיחה</span><textarea name="openText" rows="2" class="secin" maxlength="500">${esc(c.open.text||'')}</textarea></label>
 <label class="chip" style="min-height:44px;width:100%;justify-content:flex-start;margin-top:8px"><input type="checkbox" name="ackOn" value="1"${c.ack.on?' checked':''}> "קיבלנו" מחוץ לשעות העבודה (<bdi dir="ltr">${esc(c.ackH.f)}–${esc(c.ackH.t)}</bdi>), בימי חול בלבד</label><label class="f"><span>נוסח "קיבלנו"</span><textarea name="ackText" rows="2" class="secin" maxlength="500">${esc(c.ack.text||'')}</textarea></label>
 <small class="note">כל שאר התשובות – טיוטה שנשלחת רק בלחיצה שלך. מגבלה: ${esc(String(c.hour))} הודעות לשעה לכל שולח.</small>
 ${(c.appr||[]).length?`<p class="note" style="margin:8px 0 0">אישורים לפי סוג: ${c.appr.map(a=>esc(a.label)+' '+a.n+(a.want?' (ביקשת לענות לבד)':'')).join(' · ')}</p>`:''}
 <button class="btn w" style="margin-top:10px">שמירה</button></form>`}
FRM.secWaSetF=async f=>{const x=fd(f),c=X.wc||{},b=f.querySelector('button.btn');
 const ack={on:x.ackOn==='1',text:String(x.ackText||'').trim()},open={on:x.openOn==='1',text:String(x.openText||'').trim()};
 if((ack.on&&!ack.text)||(open.on&&!open.text))return toast('כדי להפעיל – כתבו נוסח');
 b.disabled=true;try{let r=null;if(ack.on!==c.ack.on||ack.text!==c.ack.text||open.on!==c.open.on||open.text!==c.open.text)r=await fnCall('secWaCfg',{op:'texts',ack,open});
  const num=String(x.num||'').trim(),curN=c.myNum||c.myReq||'';if(num.replace(/\D/g,'')!==curN.replace(/\D/g,''))r=await fnCall('secWaCfg',{op:'mgrNum',num});
  if(r&&r.ok&&r.stop)X.wc=r;toast(r?'נשמר':'אין שינוי')}catch(e){err(e)}finally{b.disabled=false;rerender()}};
/* ---------- חיבור למסך: לשונית, פס "עצור הכל", החלפת עסק ---------- */
{const t0=ACT.secTab;ACT.secTab=el=>{if(el.dataset.v==='wa'){X.wa={f:X.wa&&X.wa.f||'all',list:X.wa&&X.wa.list||null,cur:null,card:null};swr(X.wa,'list','wab',waLoad)}t0(el)}}
{const r5=V.sec;V.sec=()=>{const k=keyNow();if(X.wcKey!==k){X.wcKey=k;X.wc=null;X.wa=null}
 if(elig()&&ready()&&X.st&&X.st.setupDone&&!X.edit&&!X.set&&X.tab==='wa'){X.wa=X.wa||{f:'all'};const S=X.st;try{pushReg()}catch(e){}return{t:S.name||'המזכירה',s:'ווצאפ',h:stopH()+tabsH()+waH()}}
 const r=r5();try{if(r&&r.h&&r.h.includes('id="secTabs"'))r.h=stopH()+r.h}catch(e){}return r}}
/* ---------- מנהל־על: בכרטיס העסק ---------- */
const SW={};
const swLoad=id=>{SW[id]=null;window.fnCall('secAdminWa',{bizId:id,op:'get'}).then(r=>{SW[id]=r&&r.ok&&r.ackH?r:{err:'לא נטען'}}).catch(e=>{SW[id]={err:e&&e.message||'שגיאה'}}).finally(()=>{if(cur().v==='sab')rerender()})};
{const s5=V.sab;if(s5)V.sab=id=>{const r=s5(id);try{const b=(ADM.L||[]).find(x=>x.id===id);if(!SY.sa||!b||(b.missing&&id!==BZ0)||!r||!r.h||!(b.features&&b.features.secretary===true))return r;
 if(SW[id]===undefined)swLoad(id);const c=SW[id];let h='<div class="sec"><h3>המזכירה – ווצאפ</h3></div>';
 if(!c){r.h+=h+'<div class="empty">טוען…</div>';return r}if(c.err){r.h+=h+`<div class="card"><p class="note">${esc(c.err)}</p></div>`;return r}
 const st=c.stop&&c.stop.on;
 h+=`<form class="card" data-f="secSwF" data-id="${esc(id)}" id="secSwF">
 <label class="f"><span>מזהה המספר אצל Meta (Phone number ID)</span><input name="pnid" dir="ltr" inputmode="numeric" maxlength="25" value="${esc(c.pnid)}"></label>
 <label class="f"><span>מספר העסק (להצגה)</span><input name="num" type="tel" dir="ltr" maxlength="20" value="${esc(c.num)}"></label>
 <b style="display:block;margin-top:6px">אופן החיבור</b><div class="chips" role="radiogroup" style="margin:6px 0"><label class="chip" style="min-height:44px"><input type="radio" name="link" value="coexist"${c.link==='coexist'?' checked':''}> דו־קיום</label><label class="chip" style="min-height:44px"><input type="radio" name="link" value="moved"${c.link==='moved'?' checked':''}> העברת מספר</label></div>
 <label class="f"><span>הודעות לשעה לכל שולח (ברירת מחדל ${esc(String(c.hourDefault))})</span><input name="hour" inputmode="numeric" dir="ltr" maxlength="3" value="${esc(String(c.hour))}"></label>
 <div class="row" style="flex-wrap:wrap"><label class="f grow"><span>שעות עבודה – מ-</span><input type="time" name="af" dir="ltr" value="${esc(c.ackH.f)}"></label><label class="f grow"><span>עד</span><input type="time" name="at" dir="ltr" value="${esc(c.ackH.t)}"></label></div><small class="note">"קיבלנו" נשלח רק מחוץ לשעות האלה, בימי חול.</small>
 <label class="f"><span>תבניות שאושרו ב-Meta (שורה לכל תבנית: שם|תיאור|שפה)</span><textarea name="tpls" rows="3" dir="ltr" maxlength="2000" class="secin">${esc((c.tpls||[]).map(t=>t.name+'|'+t.label+'|'+t.lang).join('\n'))}</textarea></label>
 <button class="btn w" style="margin-top:8px">שמירה</button></form>
 <div class="card" style="margin-top:8px"><b>מספרי המנהלים (יומן ותזכורות בלבד)</b><p class="note" style="margin:4px 0">כדאי לאמת את המספר מול המנהל לפני האישור – מספר שגוי יחשוף את היומן שלו.</p>${(c.admins||[]).map(a=>`<form class="secrow" data-f="secSwMgr" data-id="${esc(id)}" data-u="${esc(a.uid)}" style="margin:8px 0"><span style="flex:1 1 100%;overflow-wrap:anywhere">${esc(a.email||a.uid)}${a.req?` <span class="sectags g">ביקש/ה: <bdi dir="ltr">${esc(a.req)}</bdi></span>`:''}${a.show?' <span class="sectags">מאושר</span>':''}</span><input name="num" type="tel" dir="ltr" maxlength="20" value="${esc(a.show||a.req||'')}" style="flex:1;min-width:110px;min-height:40px" aria-label="מספר"><button class="chip" style="min-height:40px">${a.req&&!a.show?'אישור':'שמירה'}</button></form>`).join('')||'<p class="note">אין מנהלים</p>'}</div>
 <div class="card${st?' secstop':''}" style="margin-top:8px"><b>עצור הכל</b><p class="note" style="margin:4px 0 8px">${st?'פעיל בעסק הזה.':'לא פעיל.'} עוצר רק שליחה אוטומטית; הקליטה ושליחה בלחיצה ממשיכות.</p><div class="secrow"><button class="chip" data-a="secSwStop" data-id="${esc(id)}" data-on="${st?'0':'1'}" style="min-height:44px">${st?'ביטול העצירה בעסק':'עצור בעסק הזה'}</button><button class="chip" data-a="secSwStopAll" data-id="${esc(id)}" style="min-height:44px">עצור הכל – כל העסקים</button></div></div>`;
 r.h+=h}catch(e){}return r}}
FRM.secSwF=async f=>{const id=f.dataset.id,c=SW[id];if(!c||c.err)return;const x=fd(f),b=f.querySelector('button.btn'),data={bizId:id,op:'set'};
 const pn=String(x.pnid||'').trim();if(pn!==c.pnid){if(pn&&!/^\d{5,25}$/.test(pn))return toast('מזהה המספר – ספרות בלבד');data.pnid=pn}
 const num=String(x.num||'').trim();if(num!==c.num)data.num=num;if(x.link&&x.link!==c.link)data.link=x.link;
 const hr=String(x.hour||'').trim();if(hr!==String(c.hour)){if(!/^\d{1,3}$/.test(hr)||+hr<1||+hr>500)return toast('הודעות לשעה: 1 עד 500');data.hour=+hr}
 if(x.af!==c.ackH.f||x.at!==c.ackH.t){if(!x.af||!x.at||x.af===x.at)return toast('שעות עבודה: התחלה וסיום שונות');data.ackH={f:x.af,t:x.at}}
 const tp=String(x.tpls||'').split('\n').map(l=>l.trim()).filter(Boolean).map(l=>{const[n,lb,lg]=l.split('|').map(s=>(s||'').trim());return{name:n,label:lb||n,lang:lg||'he'}});
 if(JSON.stringify(tp)!==JSON.stringify((c.tpls||[]).map(t=>({name:t.name,label:t.label,lang:t.lang})))){if(tp.length>20||tp.some(t=>!/^[a-z0-9_]{1,100}$/.test(t.name)))return toast('שם תבנית: אותיות אנגליות קטנות, ספרות וקו תחתון (עד 20 תבניות)');data.tpls=tp}
 if(Object.keys(data).length<=2)return toast('אין שינוי');
 b.disabled=true;try{SW[id]=await window.fnCall('secAdminWa',data);toast('נשמר')}catch(e){err(e)}finally{b.disabled=false;if(cur().v==='sab')rerender()}};
FRM.secSwMgr=async f=>{const id=f.dataset.id,u=f.dataset.u,x=fd(f),num=String(x.num||'').trim();
 const run=async()=>{try{SW[id]=await window.fnCall('secAdminWa',{bizId:id,op:'mgr',uid:u,num});toast(num?'המספר אושר':'המספר הוסר')}catch(e){err(e)}finally{if(cur().v==='sab')rerender()}};
 if(num)ask('לאשר את '+num+' כ"מספר המנהל"? מהמספר הזה אפשר יהיה לשאול על היומן וליצור תזכורות ביומן האישי שלו. כדאי לאמת את המספר מול המנהל.',run,'אישור');else run()};
ACT.secSwStop=async el=>{const id=el.dataset.id,on=el.dataset.on==='1';el.disabled=true;try{SW[id]=await window.fnCall('secAdminWa',{bizId:id,op:'stop',on});toast(on?'נעצר':'העצירה בוטלה')}catch(e){err(e)}finally{el.disabled=false;if(cur().v==='sab')rerender()}};
ACT.secSwStopAll=el=>{const id=el.dataset.id;ask('לעצור שליחה אוטומטית בווצאפ בכל העסקים?',async()=>{try{const r=await window.fnCall('secAdminWa',{bizId:id,op:'stopAll',on:true});toast('נעצר ב-'+r.n+' עסקים');swLoad(id)}catch(e){err(e)}},'עצור הכל')};

/* =====================================================================================
   שלב 6: Gmail ויומן Google (3.3, 3.5, 7.1, 10.1, 10.2; החלטות 26א, 27, 28, 29, 70, 72, פ3).
   לשונית "מייל": תיבת המיילים, מייל עם סימון "חשוד" (לא מבוצע), טיוטה רק בבקשה, "שלח מה-Gmail של העסק" – רק בלחיצה (secMailSend, מזהה שליחה חד־פעמי),
   ורשימת ניקוי ספאם שממתינה לאישור מנהל העסק – העברה לאשפה של Gmail בלבד (לא מחיקה לצמיתות).
   בהגדרות: חיבור/ניתוק תיבות Gmail (עד המספר שמנהל־על קבע) ויומן Google, "סנכרן עכשיו". בכרטיס העסק של מנהל־על: מספר התיבות, סריקת היסטוריה
   (הכול / 12 / 6 / חודש / בכלל לא) עם ספירה והערכת עלות לפני הסריקה, וניתוק תיבה. הכול דרך השרת (secGoogle, secMail, secMailSend, secAdminMail).
   האסימונים לא מגיעים לטלפון בשום שלב.
   ===================================================================================== */
const css6=document.createElement('style');
css6.textContent='.secml .li{align-items:flex-start;cursor:pointer}.secml .li small{display:block;overflow-wrap:anywhere}.secml .m{min-width:0}'
+'.seccl{display:flex;gap:8px;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--line)}.seccl:last-child{border-bottom:0}.seccl input{width:22px;height:22px;flex:none;margin-top:2px;accent-color:var(--acc)}.seccl span{min-width:0;overflow-wrap:anywhere}'
+'.secaddr{overflow-wrap:anywhere;word-break:break-all}';
document.head.appendChild(css6);
TABS.splice(2,0,['mail','מייל']);
SRC.gcal='מיומן Google';
const MFL={invErr:['קובץ מצורף לא נקלט – תקלה','w'],sus:['תוכן חשוד – לא מבוצע','w'],mgrMail:['מכתובת של מנהל','w'],spam:['ספאם','w'],promo:['פרסומת',''],big:['מייל גדול – רק תקציר',''],cut:['קוצר',''],file:['קובץ מצורף','g'],hist:['מייל ישן (רקע)',''],chk:['לבדוק לפני שליחה','w'],unsure:['המזכירה לא בטוחה','w']};
const mflH=a=>(a||[]).filter(f=>MFL[f]).map(f=>`<span class="sectags ${MFL[f][1]}">${MFL[f][0]}</span>`).join('');
const kb=z=>z>=1048576?(z/1048576).toFixed(1)+' MB':Math.max(1,Math.round((z||0)/1024))+' KB';
const usd=mc=>'$'+((Number(mc)||0)/100000).toFixed(2);
const WHY={spam:'ספאם',promo:'פרסומת',big:'גדול וישן'};
const MF=[['all','הכול'],['pend','עם טיוטה'],['sus','חשוד'],['promo','פרסומות']];
/* ---------- לשונית "מייל" ---------- */
async function mlLoad(){X.mlb=1;const s0=X.ml.list;let again=0;try{const r=await fnCall('secMail',{op:'list'});if(s0&&X.ml.list===null){again=1;return}X.ml.list=r&&Array.isArray(r.mails)?r:{err:'לא נטען'}}catch(e){X.ml.list=X.ml.list&&!X.ml.list.err?X.ml.list:{err:e&&e.message||'לא נטען'}}finally{X.mlb=0;if(again){mlLoad();return}if(cur().v==='sec'&&!typing())rerender()}}
function mailH(){const M=X.ml;if(M.clean)return cleanH();if(M.cur)return mlCardH();const R=M.list;if(!R){if(!X.mlb)mlLoad();return '<div class="empty">טוען…</div>'}if(R.err)return `<div class="card"><p class="note">${esc(R.err)}</p><button class="btn g w" data-a="secTab" data-v="mail">נסה שוב</button></div>`;
 const f=M.f||'all',L=(R.mails||[]).filter(m=>f==='all'||(f==='pend'?m.draft&&['pend','fail'].includes(m.draft.st):f==='promo'?(m.flags||[]).some(x=>x==='promo'||x==='spam'):(m.flags||[]).includes(f)));
 let h='';
 if(R.cleanN)h+=`<div class="card secwarn" id="secClPend" style="margin-bottom:8px"><b>רשימת ניקוי ממתינה לאישורך (${R.cleanN})</b><p class="note" style="margin:4px 0 8px">מנהל המערכת הכין רשימת מיילים לפינוי. שום מייל לא יועבר לאשפה בלי האישור שלך.</p><button class="btn w" data-a="secClOpen">לצפייה ואישור</button></div>`;
 if(!(R.boxes||[]).length)h+=`<div class="card" style="margin-bottom:8px"><p class="note" style="margin:0 0 8px">${R.max?'עוד לא חוברה תיבת Gmail. מחברים בהגדרות המזכירה.':'מנהל המערכת עוד לא אישר חיבור תיבות מייל לעסק.'}</p>${R.max?'<button class="chip" data-a="secSet" style="min-height:40px">להגדרות</button>':''}</div>`;
 else{const ex=(R.boxes||[]).filter(b=>b.st==='expired');if(ex.length)h+=`<div class="card secwarn" style="margin-bottom:8px"><p class="note" style="margin:0">החיבור פג: ${ex.map(b=>'<bdi dir="ltr" class="secaddr">'+esc(b.addr)+'</bdi>').join(', ')}. אפשר לחבר מחדש בהגדרות.</p></div>`}
 h+=`<div class="chips" style="margin:0 0 8px">${MF.map(([k,l])=>`<button class="chip${f===k?' on':''}" data-a="secMlF" data-v="${k}" style="min-height:40px" aria-pressed="${f===k}">${l}</button>`).join('')}</div>`;
 return h+`<div class="card secml" id="secMlList">${L.length?L.map(m=>`<div class="li" data-a="secMlOpen" data-id="${esc(m.id)}" role="button" tabindex="0"><div class="m"><b>${esc(m.subj||'(בלי נושא)')}</b><small><bdi dir="ltr" class="secaddr">${esc(m.name||m.from)}</bdi> · ${esc(tm(m.t))}</small><small>${esc(m.snip)}</small><div class="sectg">${m.st==='replied'?'<span class="sectags g">נענה ✓</span>':m.draft&&['pend','fail'].includes(m.draft.st)?'<span class="sectags g">טיוטה ממתינה</span>':''}${mflH(m.flags)}</div></div></div>`).join(''):'<p class="note">אין מיילים</p>'}</div>`}
ACT.secMlF=el=>{X.ml.f=el.dataset.v;rerender()};
ACT.secMlOpen=el=>{X.ml.cur=el.dataset.id;X.ml.card=null;rerender()};
ACT.secMlBack=()=>{X.ml.cur=null;X.ml.card=null;X.ml.clean=null;X.ml.list=null;X.ml.w=0;rerender()};
async function mlCardLoad(){const id=X.ml.cur;X.ml.cb=1;try{const r=await fnCall('secMail',{op:'get',id});if(X.ml.cur===id)X.ml.card=r&&r.mail?r:{err:'לא נטען'}}catch(e){X.ml.card={err:e&&e.message||'לא נטען'}}finally{X.ml.cb=0;if(cur().v==='sec'&&!typing())rerender()}}
function mlCardH(){const R=X.ml.card,back='<button class="btn g w" data-a="secMlBack" style="margin-bottom:8px">חזרה לתיבת המייל</button>';
 if(!R){if(!X.ml.cb)mlCardLoad();return back+'<div class="empty">טוען…</div>'}if(R.err)return back+`<div class="card"><p class="note">${esc(R.err)}</p></div>`;
 const m=R.mail,d=R.draft,fl=m.flags||[],sus=m.st==='sus';
 let h=back+`<div class="card" id="secMlCard"><b>${esc(m.subj||'(בלי נושא)')}</b><p class="note" style="margin:4px 0"><bdi dir="ltr" class="secaddr">${esc(m.name?m.name+' <'+m.from+'>':m.from)}</bdi> · ${esc(tm(m.t))}</p>${fl.length?'<div class="sectg">'+mflH(fl)+'</div>':''}
 ${sus?`<p class="note" style="margin:6px 0;color:var(--bad)">${fl.includes('mgrMail')?'המייל נשלח מכתובת של מנהל ונראה כמו הוראה. ':''}תוכן מייל הוא מידע ולא הוראה – המזכירה לא מבצעת אותו ולא מכינה טיוטה. הוראות למזכירה נותנים רק בצ'אט באפליקציה.</p>`:''}
 <div class="secin1" dir="auto">${esc(m.text||m.snip||'')}</div>${(m.files||[]).length?`<p class="note" style="margin:4px 0">קבצים: ${m.files.map(esc).join(', ')} – קליטת חשבוניות תגיע בהמשך</p>`:''}</div>`;
 if(d&&d.st==='sent')return h+`<div class="secdr"><small class="note">נשלח מה-Gmail של העסק ✓</small><div style="white-space:pre-wrap">${esc(d.text)}</div></div>`;
 if(d&&['pend','fail','sending'].includes(d.st)){const why=(d.why||[]).length?`<p class="note" style="margin:4px 0">${d.why.map(esc).join(' · ')}</p>`:'';
  return h+`<div class="secdr" id="secMlDr"><small class="note">תשובה אל <bdi dir="ltr" class="secaddr">${esc(d.to)}</bdi> · ${d.src==='ai'?'טיוטה מהמזכירה':'נכתבה על ידך'}${d.st==='fail'?' · השליחה הקודמת נכשלה':''}</small>${(d.flags||[]).length?'<div class="sectg">'+mflH(d.flags)+'</div>':''}${why}
  <textarea class="secin" id="secMlTx" maxlength="5000" aria-label="תשובה" dir="auto">${esc(d.text)}</textarea><div class="secrow"><button class="btn" data-a="secMlSend" style="flex:1">שלח מה-Gmail של העסק</button><button class="chip" data-a="secMlDone">טופל בלי לענות</button></div><small class="note">המייל יוצא רק בלחיצה שלך.</small></div>`}
 if(X.ml.w)return h+`<form class="secdr" data-f="secMlW"><small class="note">תשובה משלך</small><textarea class="secin" name="text" maxlength="5000" aria-label="תשובה" dir="auto"></textarea><div class="secrow"><button class="btn" style="flex:1">שמירת טיוטה</button><button type="button" class="chip" data-a="secMlWx">ביטול</button></div></form>`;
 return h+`<div class="secrow" style="margin-top:8px">${sus?'':'<button class="btn" data-a="secMlDraft" style="flex:1">טיוטה מהמזכירה</button>'}<button class="chip" data-a="secMlW" style="min-height:44px">לכתוב בעצמי</button><button class="chip" data-a="secMlDone" style="min-height:44px">טופל</button></div>`}
ACT.secMlDraft=async el=>{el.disabled=true;try{const r=await fnCall('secMail',{op:'draft',id:X.ml.cur});if(X.ml.card)X.ml.card.draft=r.draft}catch(e){err(e)}finally{el.disabled=false;rerender()}};
ACT.secMlW=()=>{X.ml.w=1;rerender()};ACT.secMlWx=()=>{X.ml.w=0;rerender()};
FRM.secMlW=async f=>{const t=String(fd(f).text||'').trim();if(!t)return toast('כתבו תשובה');const b=f.querySelector('button');b.disabled=true;try{const r=await fnCall('secMail',{op:'write',id:X.ml.cur,text:t});X.ml.w=0;if(X.ml.card)X.ml.card.draft=r.draft}catch(e){err(e)}finally{b.disabled=false;rerender()}};
ACT.secMlSend=el=>{const c=X.ml.card,d=c&&c.draft;if(!d)return;d._sid=d._sid||sid();/* אותו מזהה בכל ניסיון חוזר – השרת לא ישלח פעמיים (10.2) */
 const t=document.getElementById('secMlTx'),v=t?t.value.trim():d.text;if(!v)return toast('התשובה ריקה');const data={id:X.ml.cur,sendId:d._sid};if(v!==d.text)data.text=v;
 const run=async()=>{el.disabled=true;try{const r=await fnCall('secMailSend',data);toast(r&&r.already?'כבר נשלח':'נשלח מה-Gmail של העסק');X.ml.card=null;X.ml.list=null}catch(e){err(e)}finally{el.disabled=false;rerender()}};
 ask('לשלוח את התשובה אל '+d.to+' מה-Gmail של העסק?'+((d.flags||[]).includes('chk')?' בטיוטה יש מידע שכדאי לבדוק ('+(d.why||[]).join(', ')+').':''),run,'שלח')};
ACT.secMlDone=()=>{ask('לסמן כטופל? לא תישלח תשובה.',async()=>{try{await fnCall('secMail',{op:'done',id:X.ml.cur});toast('סומן כטופל');X.ml.cur=null;X.ml.card=null;X.ml.list=null;rerender()}catch(e){err(e)}},'טופל')};
/* ---------- רשימת ניקוי ספאם – אישור מנהל העסק (פ3) ---------- */
ACT.secClOpen=()=>{X.ml.clean={L:null};rerender()};
async function clLoad(){X.clb=1;try{const r=await fnCall('secMail',{op:'cleanList'});X.ml.clean.L=r&&Array.isArray(r.lists)?r.lists:[]}catch(e){X.ml.clean.L={err:e&&e.message||'לא נטען'}}finally{X.clb=0;if(cur().v==='sec'&&!typing())rerender()}}
function cleanH(){const C=X.ml.clean,back='<button class="btn g w" data-a="secMlBack" style="margin-bottom:8px">חזרה לתיבת המייל</button>';
 if(!C.L){if(!X.clb)clLoad();return back+'<div class="empty">טוען…</div>'}if(C.L.err)return back+`<div class="card"><p class="note">${esc(C.L.err)}</p></div>`;
 const P=C.L.filter(l=>l.st==='pend'),D=C.L.filter(l=>l.st!=='pend');
 let h=back+(P.length?'':'<div class="card"><p class="note" style="margin:0">אין רשימה שממתינה לאישור.</p></div>');
 for(const l of P){const z=l.items.reduce((s,i)=>s+(i.z||0),0);
  h+=`<form class="card" data-f="secClOk" data-id="${esc(l.id)}" id="secCl_${esc(l.id)}" style="margin-bottom:8px"><b>רשימת ניקוי · ${esc(l.rangeL||'')}</b><p class="note" style="margin:4px 0">${l.items.length} מיילים · כ-<bdi dir="ltr">${esc(kb(z))}</bdi>. המסומנים יועברו <b>לאשפה</b> של Gmail – לא נמחקים לצמיתות, ואפשר לשחזר אותם מהאשפה ב-Gmail (שם הם נמחקים אוטומטית אחרי כחודש).</p>
  <div class="secrow" style="margin:4px 0"><button type="button" class="chip" data-a="secClAll" data-id="${esc(l.id)}" data-v="1">סמן הכול</button><button type="button" class="chip" data-a="secClAll" data-id="${esc(l.id)}" data-v="0">נקה סימון</button></div>
  ${l.items.map(i=>`<label class="seccl"><input type="checkbox" name="g" value="${esc(i.g)}" checked><span><b>${esc(i.s||'(בלי נושא)')}</b><br><small class="note"><bdi dir="ltr" class="secaddr">${esc(i.f||'')}</bdi>${i.d?' · '+esc(tm(i.d)):''} · <bdi dir="ltr">${esc(kb(i.z))}</bdi> · ${esc(WHY[i.w]||'')}</small></span></label>`).join('')}
  <div class="secrow" style="margin-top:8px"><button class="btn" style="flex:1">העברה לאשפה</button><button type="button" class="chip" data-a="secClNo" data-id="${esc(l.id)}" style="min-height:44px">דחיית הרשימה</button></div></form>`}
 if(D.length)h+=`<div class="sec"><h3>רשימות קודמות</h3></div><div class="card">${D.map(l=>`<p class="note" style="margin:4px 0">${esc(tm(l.t))} · ${esc(l.rangeL||'')} · ${l.st==='done'?'הועברו לאשפה '+l.trashed+(l.failed?' (נכשלו '+l.failed+')':''):l.st==='rej'?'נדחתה':'בטיפול'}</p>`).join('')}</div>`;
 return h}
ACT.secClAll=el=>{const f=document.getElementById('secCl_'+el.dataset.id);if(f)f.querySelectorAll('input[name=g]').forEach(i=>{i.checked=el.dataset.v==='1'})};
FRM.secClOk=f=>{const id=f.dataset.id,ids=[...f.querySelectorAll('input[name=g]:checked')].map(i=>i.value);if(!ids.length)return toast('לא סומנו מיילים');
 ask(`להעביר ${ids.length} מיילים לאשפה של Gmail? אפשר לשחזר אותם מהאשפה ב-Gmail.`,async()=>{const b=f.querySelector('button.btn');if(b)b.disabled=true;try{const r=await fnCall('secMail',{op:'cleanOk',id,ids});toast('הועברו לאשפה: '+r.trashed+(r.failed?' · נכשלו: '+r.failed:''));X.ml.clean={L:null};X.ml.list=null}catch(e){err(e)}finally{if(b)b.disabled=false;rerender()}},'העברה לאשפה')};
ACT.secClNo=el=>{const id=el.dataset.id;ask('לדחות את הרשימה? שום מייל לא יועבר.',async()=>{try{await fnCall('secMail',{op:'cleanNo',id});toast('הרשימה נדחתה');X.ml.clean={L:null};X.ml.list=null;rerender()}catch(e){err(e)}},'דחייה')};
/* ---------- הגדרות: חיבורי Google ---------- */
async function gsLoad(){X.gsb=1;try{const r=await fnCall('secGoogle',{op:'status'});X.gs=r&&r.ok?r:{err:'לא נטען'}}catch(e){X.gs={err:e&&e.message||'לא נטען'}}finally{X.gsb=0;if(cur().v==='sec'&&!typing())rerender()}}
function gSetH(){const g=X.gs;if(!g){if(!X.gsb)gsLoad();return '<div class="empty">טוען…</div>'}if(g.err)return `<div class="card" style="margin-top:8px"><b>Gmail ויומן Google</b><p class="note" style="margin:4px 0 0">${esc(g.err)}</p></div>`;
 const n=(g.boxes||[]).length;
 let h=`<div class="card" id="secGSet" style="margin-top:8px"><b>Gmail ויומן Google</b>${g.configured?'':'<p class="note" style="margin:4px 0">החיבור ל-Google עוד לא הוגדר בשרת. מנהל המערכת צריך להשלים את ההגדרה.</p>'}
 <p class="note" style="margin:4px 0 8px">תיבות Gmail: ${n} מתוך ${g.max} שמנהל המערכת אישר. המזכירה קוראת מיילים חדשים ושולחת תשובה רק בלחיצה שלך. אין מחיקה לצמיתות.</p>`;
 h+=(g.boxes||[]).map(b=>`<div class="secin1"><bdi dir="ltr" class="secaddr"><b>${esc(b.addr)}</b></bdi><div class="sectg">${b.st==='expired'?'<span class="sectags w">החיבור פג – לחבר מחדש</span>':'<span class="sectags g">מחובר</span>'}${b.clean?'<span class="sectags">הרשאת ניקוי ספאם</span>':''}</div><div class="secrow" style="margin-top:6px">${b.st==='expired'||!b.clean?`<button class="chip" data-a="secGCon" data-k="mail" data-c="${b.st==='expired'&&!b.clean?'0':'1'}">${b.st==='expired'?'חיבור מחדש':'הוספת הרשאת ניקוי'}</button>`:''}<button class="chip" data-a="secGOff" data-box="${esc(b.id)}">ניתוק</button></div></div>`).join('');
 if(g.configured&&n<g.max)h+=`<button class="btn w" data-a="secGCon" data-k="mail" data-c="0" style="margin-top:6px">חיבור תיבת Gmail</button><small class="note">הרשאות: קריאה ושליחה בלבד. הרשאת ניקוי (העברה לאשפה) – רק כשמבקשים.</small>`;
 const c=g.cal||{};
 h+=`<div style="margin-top:12px"><b>יומן Google</b><p class="note" style="margin:4px 0 8px">${c.connected?'מחובר'+(c.addr?': <bdi dir="ltr" class="secaddr">'+esc(c.addr)+'</bdi>':'')+(c.st==='expired'?' · <span style="color:var(--bad)">החיבור פג</span>':'')+(c.last?' · סונכרן '+esc(fmtAt(c.last)):''):'היומן האישי שלך באפליקציה יסונכרן בשני הכיוונים עם יומן Google. אירועי העסק עוברים ל-Google, ולא חוזרים ממנו.'}</p>
 <div class="secrow">${c.connected?(c.st==='expired'?'<button class="chip" data-a="secGCon" data-k="cal">חיבור מחדש</button>':'<button class="chip" data-a="secGSync">סנכרן עכשיו</button>')+'<button class="chip" data-a="secGOff" data-k="cal">ניתוק</button>':g.configured?'<button class="btn" data-a="secGCon" data-k="cal" style="flex:1">חיבור יומן Google</button>':''}</div></div>
 <button class="chip" data-a="secGRe" style="margin-top:8px;min-height:40px">רענון</button></div>`;
 return h}
const openExt=u=>{try{window.open(u,'_system')}catch(e){location.href=u}};
ACT.secGCon=async el=>{const kind=el.dataset.k==='cal'?'cal':'mail',d={op:'connect',kind};if(kind==='mail'&&el.dataset.c==='1')d.clean=true;el.disabled=true;
 try{const r=await fnCall('secGoogle',d);if(!r||typeof r.url!=='string'||!/^https?:\/\//.test(r.url))throw new Error('לא התקבל קישור');openExt(r.url);toast('אשרו ב-Google, ואז חזרו לאפליקציה ולחצו "רענון"');X.gs=null}catch(e){err(e)}finally{el.disabled=false;rerender()}};
ACT.secGOff=el=>{const cal=el.dataset.k==='cal',d=cal?{op:'disconnect',kind:'cal'}:{op:'disconnect',kind:'mail',box:el.dataset.box};
 ask(cal?'לנתק את יומן Google? ההרשאה תבוטל והאסימון יימחק. האירועים באפליקציה נשארים.':'לנתק את התיבה? ההרשאה תבוטל והאסימון יימחק. מיילים חדשים לא ייקלטו; המיילים שכבר נקלטו נשארים.',async()=>{try{await fnCall('secGoogle',d);toast('נותק');X.gs=null;if(X.ml)X.ml.list=null}catch(e){err(e)}finally{rerender()}},'ניתוק')};
ACT.secGSync=async el=>{el.disabled=true;try{const r=await fnCall('secGoogle',{op:'calSync'});toast('סונכרן'+(r&&(r.add||r.upd||r.del||r.out)?': '+[r.add?'נוספו '+r.add:'',r.upd?'עודכנו '+r.upd:'',r.del?'נמחקו '+r.del:'',r.out?'נשלחו ל-Google '+r.out:''].filter(Boolean).join(', '):''));X.gs=null;X.cl=null}catch(e){err(e)}finally{el.disabled=false;rerender()}};
ACT.secGRe=()=>{X.gs=null;rerender()};
/* ---------- חיבור למסך ---------- */
{const t0=ACT.secTab;ACT.secTab=el=>{if(el.dataset.v==='mail'){X.ml={f:X.ml&&X.ml.f||'all',list:X.ml&&X.ml.list||null,cur:null,card:null,clean:null};swr(X.ml,'list','mlb',mlLoad)}t0(el)}}
{const s0=ACT.secSet;ACT.secSet=()=>{X.gs=null;s0()}}
{const r6=V.sec;V.sec=()=>{const k=keyNow();if(X.mlKey!==k){X.mlKey=k;X.ml=null;X.gs=null}
 if(elig()&&ready()&&X.st&&X.st.setupDone&&!X.edit&&!X.set&&X.tab==='mail'){X.ml=X.ml||{f:'all'};const S=X.st;return{t:S.name||'המזכירה',s:'מייל',h:stopH()+tabsH()+mailH()}}
 return r6()}}
/* ---------- מנהל־על: בכרטיס העסק – Gmail ---------- */
const SG={};
const sgLoad=id=>{SG[id]=null;window.fnCall('secAdminMail',{bizId:id,op:'get'}).then(r=>{SG[id]=r&&r.ok?r:{err:'לא נטען'}}).catch(e=>{SG[id]={err:e&&e.message||'שגיאה'}}).finally(()=>{if(cur().v==='sab')rerender()})};
const RG=[['all','הכול'],['12','12 חודשים'],['6','6 חודשים'],['1','חודש'],['none','בכלל לא']];
{const s6=V.sab;if(s6)V.sab=id=>{const r=s6(id);try{const b=(ADM.L||[]).find(x=>x.id===id);if(!SY.sa||!b||(b.missing&&id!==BZ0)||!r||!r.h||!(b.features&&b.features.secretary===true))return r;
 if(SG[id]===undefined)sgLoad(id);const c=SG[id];let h='<div class="sec"><h3>המזכירה – Gmail</h3></div>';
 if(!c){r.h+=h+'<div class="empty">טוען…</div>';return r}if(c.err){r.h+=h+`<div class="card"><p class="note">${esc(c.err)}</p></div>`;return r}
 const ct=c.count,rg=c.rg||'12';
 h+=`<form class="card" data-f="secSgMax" data-id="${esc(id)}" id="secSgMax"><label class="f"><span>מספר תיבות Gmail לעסק (ברירת מחדל ${esc(String(c.maxDefault))}; 0 = בלי מייל)</span><input name="max" inputmode="numeric" dir="ltr" maxlength="2" value="${esc(String(c.max))}"></label><button class="btn w" style="margin-top:6px">שמירה</button></form>
 <div class="card" style="margin-top:8px"><b>תיבות מחוברות</b>${(c.boxes||[]).length?c.boxes.map(x=>`<div class="secrow" style="margin:6px 0"><span style="flex:1 1 100%" class="secaddr"><bdi dir="ltr">${esc(x.addr)}</bdi> ${x.st==='expired'?'<span class="sectags w">פג</span>':'<span class="sectags g">מחובר</span>'}${x.clean?' <span class="sectags">ניקוי</span>':''}</span><button class="chip" data-a="secSgOff" data-id="${esc(id)}" data-box="${esc(x.id)}" style="min-height:40px">ניתוק</button></div>`).join(''):'<p class="note" style="margin:4px 0 0">אין. מנהל העסק מחבר מהגדרות המזכירה.</p>'}</div>
 <div class="card" style="margin-top:8px" id="secSgScan"><b>סריקת היסטוריה וניקוי ספאם</b><p class="note" style="margin:4px 0">קודם סופרים ומציגים הערכת עלות, ורק אחרי אישור סורקים. המיילים מהטווח נקלטים לתיבת המזכירה <b>כרקע</b> – בהדרגה, בלי טיוטות ובלי שליחה – ואפשר לעצור באמצע. בנוסף הסריקה מכינה רשימת ניקוי (ספאם, פרסומות, גדולים וישנים) שעוברת <b>לאישור מנהל העסק</b>. שום מייל לא יועבר לאשפה בלי האישור שלו, ואין מחיקה לצמיתות.</p>
 <div class="chips" role="radiogroup" style="margin:6px 0">${RG.map(([k,l])=>`<label class="chip" style="min-height:44px"><input type="radio" name="secSgR_${esc(id)}" data-c="secSgR" data-id="${esc(id)}" value="${k}"${rg===k?' checked':''}> ${l}</label>`).join('')}</div>
 <button class="btn w" data-a="secSgCount" data-id="${esc(id)}">ספירה והערכת עלות</button>
 ${ct?`<div class="secin1" id="secSgCt">${ct.none?'נבחר "בכלל לא" – אין סריקה.':`<b>${esc(Number(ct.n).toLocaleString('he-IL'))}${ct.capped?'+':''} מיילים</b> בטווח "${esc((RG.find(x=>x[0]===ct.range)||[])[1]||'')}"${(ct.per||[]).length>1?'<br>'+ct.per.map(p=>'<bdi dir="ltr" class="secaddr">'+esc(p.addr)+'</bdi>: '+p.n).join(' · '):''}<br><small class="note">עלות הסריקה עצמה: 0 (בלי מודל AI). אם יסוכם כל מייל במודל: כ-${esc(usd(ct.est&&ct.est.aiIfSummarizedMc))} (הערכה, לא מאומת).</small><button class="btn" data-a="secSgRun" data-id="${esc(id)}" style="margin-top:8px;width:100%">אישור וסריקה (${esc(String(ct.n))} מיילים)</button>`}</div>`:''}
 ${c.hist?`<div class="secin1" id="secSgHist" style="margin-top:8px">קליטת היסטוריה (${esc(c.hist.rangeL||'')}): <b>${esc(Number(c.hist.n||0).toLocaleString('he-IL'))}</b> נקלטו${c.hist.total?' מתוך כ-'+esc(Number(c.hist.total).toLocaleString('he-IL')):''} – ${c.hist.st==='run'?'בתהליך (ממשיכה כל 15 דקות)':c.hist.st==='stop'?'נעצרה':c.hist.st==='cap'?'נעצרה – העסק בתקרת העלות החודשית':'הסתיימה'}${['run','cap'].includes(c.hist.st)?`<button class="btn" data-a="secSgHist" data-id="${esc(id)}" data-op="histStop" style="margin-top:8px;width:100%">עצירת הקליטה</button>`:''}${['stop','cap'].includes(c.hist.st)?`<button class="btn" data-a="secSgHist" data-id="${esc(id)}" data-op="histGo" style="margin-top:8px;width:100%">המשך הקליטה</button>`:''}</div>`:''}
 ${(c.lists||[]).length?'<p class="note" style="margin:8px 0 0">רשימות: '+c.lists.map(l=>esc(tm(l.t))+' – '+l.n+' מיילים, '+(l.st==='pend'?'ממתינה לאישור מנהל העסק':l.st==='done'?'הועברו לאשפה '+l.trashed:l.st==='rej'?'נדחתה':'בטיפול')).join(' · ')+'</p>':''}</div>`;
 r.h+=h}catch(e){}return r}}
CHG.secSgR=el=>{const c=SG[el.dataset.id];if(c&&!c.err){c.rg=el.value;c.count=null;rerender()}};
FRM.secSgMax=async f=>{const id=f.dataset.id,v=String(fd(f).max||'').trim();if(!/^\d{1,2}$/.test(v)||+v>10)return toast('מספר תיבות: 0 עד 10');const b=f.querySelector('button');b.disabled=true;try{const rg=(SG[id]||{}).rg;SG[id]=Object.assign(await window.fnCall('secAdminMail',{bizId:id,op:'set',max:+v}),{rg});toast('נשמר')}catch(e){err(e)}finally{b.disabled=false;if(cur().v==='sab')rerender()}};
ACT.secSgCount=async el=>{const id=el.dataset.id,c=SG[id];if(!c||c.err)return;const range=c.rg||'12';el.disabled=true;try{const r=await window.fnCall('secAdminMail',{bizId:id,op:'count',range});SG[id]=Object.assign(r,{rg:range})}catch(e){err(e)}finally{el.disabled=false;if(cur().v==='sab')rerender()}};
ACT.secSgRun=el=>{const id=el.dataset.id,c=SG[id];if(!c||!c.count)return;const ct=c.count;
 ask(`לסרוק ${ct.n} מיילים? הם ייקלטו למזכירה כרקע (בהדרגה, בלי טיוטות ובלי שליחה), ותוכן רשימת ניקוי. הרשימה תעבור לאישור מנהל העסק, ושום מייל לא יועבר לאשפה לפני כן.`,async()=>{try{const r=await window.fnCall('secAdminMail',{bizId:id,op:'run',range:ct.range,confirm:ct.n});SG[id]=Object.assign(r,{rg:ct.range,count:null});toast((r.list&&r.list.n?'הרשימה ('+r.list.n+') נשלחה לאישור מנהל העסק':'לא נמצאו מיילים לניקוי')+(r.hist?'. קליטת ההיסטוריה התחילה':''))}catch(e){err(e)}finally{if(cur().v==='sab')rerender()}},'סריקה')};
ACT.secSgHist=async el=>{const id=el.dataset.id,op=el.dataset.op;if(!['histStop','histGo'].includes(op))return;el.disabled=true;try{const rg=(SG[id]||{}).rg;SG[id]=Object.assign(await window.fnCall('secAdminMail',{bizId:id,op}),{rg});toast(op==='histStop'?'הקליטה נעצרה':'הקליטה ממשיכה')}catch(e){err(e)}finally{el.disabled=false;if(cur().v==='sab')rerender()}};
ACT.secSgOff=el=>{const id=el.dataset.id,box=el.dataset.box;ask('לנתק את התיבה מהעסק? ההרשאה תבוטל והאסימון יימחק.',async()=>{try{const rg=(SG[id]||{}).rg;SG[id]=Object.assign(await window.fnCall('secAdminMail',{bizId:id,op:'disconnect',box}),{rg});toast('נותק')}catch(e){err(e)}finally{if(cur().v==='sab')rerender()}},'ניתוק')};

/* ---------- שלב 7: "חשבוניות שהתקבלו" (קליטת חשבוניות מווצאפ ומ-Gmail, אפיון 4) ----------
   העיקרון (4.1): השרת שומר את המסמך בתור (sec_inv) ולא כותב הוצאה. המכשיר מכניס אותו דרך תיבת ההוצאות הקיימת (S.inbox → ACT.inbOk / ACT.inbEdit / inbChkOpen),
   כלומר אותה פונקציית כניסה של תיבת העובדים, עם בדיקת הכפילויות הקיימת – אחרי "תפיסה" חד־פעמית בשרת (secDecide, 4.7).
   סגירה באמצע (4.7(2–3)): הפריט שנתפס נשמר מקומית יחד עם הנתונים (S.inbox + S.secL – פנקס קטן: נתפס/נדחה), ובפתיחה הבאה ההשלמה מדווחת לשרת.
   ההוצאה שנכנסת שומרת את מזהה המקור (src='s'+מזהה), כך שאותה חשבונית לא תיכנס פעמיים באותו מכשיר.
   "נכנס ישר" (34, 110): השרת מסמן זכאות; המכשיר רק מחמיר (כפילות אצלו, תעודת משלוח פתוחה, תשלום שממתין לחשבונית – מעכב עם התראה), תופס במצב אוטומטי
   (השרת בודק שוב את כל התנאים) ומכניס עם ACT.inbOk. הודעה "נכנסו N חשבוניות" + ביטול במסך. */
const css7=document.createElement('style');
css7.textContent='.secinv .ivh{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}.secinv .ivh b{min-width:0;overflow-wrap:anywhere}.secinv .iva{flex:none;font-weight:800;direction:ltr}'
+'.secinv .ivs{display:block;overflow-wrap:anywhere;margin-top:2px}.secinv .secrow{margin-top:8px}.secinv .secrow .btn,.secinv .secrow .chip{min-height:44px}.secivsug{border:1px solid var(--acc);border-radius:10px;padding:8px;margin-top:8px}'
+'.secivset summary{cursor:pointer;font-weight:800;min-height:44px;display:flex;align-items:center}.secivset .row{flex-wrap:wrap;gap:8px}';
document.head.appendChild(css7);
TABS.splice(1,0,['inv','חשבוניות']);
const IV={L:null,b:0,at:0,auto:0,held:{},sup:''};
const devId=()=>{const k='lp-secdev';let v='';try{v=localStorage.getItem(k)||''}catch(e){}if(!/^[A-Za-z0-9_-]{6,64}$/.test(v)){v='d'+sid().slice(0,20);try{localStorage.setItem(k,v)}catch(e){}}return v};
const lidOf=id=>'s'+id;
const secL=()=>{if(!S.secL||typeof S.secL!=='object'||Array.isArray(S.secL))S.secL={};return S.secL};
const txOfLid=lid=>S.tx.find(t=>t.src===lid||(Array.isArray(t.srcs)&&t.srcs.includes(lid)));
const IVK={inv:'חשבונית',cr:'הודעת זיכוי',rcpt:'קבלה',dn:'תעודת משלוח',chk:'צ׳ק',unk:'מסמך שלא זוהה',bad:'התקבל קובץ שלא נקלט',long:'קובץ ארוך – לבדיקה ידנית',q:'בזיהוי…'};
const IVW={type:'לא חשבונית רגילה',neg:'סכום שלילי או אפס',sup:'ספק לא מוכר',fields:'לא כל השדות זוהו בוודאות',cap:'בגובה התקרה או מעליה',br:'סניף לא ידוע',off:'"נכנס ישר" כבוי',stop:'"עצור הכל" פעיל',dup:'חשד לכפילות',hold:'עוכב לבדיקה',sus:'נשלח עם תוכן חשוד',el:'לא סומנה כזכאית',auth:'שולח לא מאומת'};
const IVB={zip:'קובץ מכווץ (zip)',office:'קובץ Office',exe:'קובץ הפעלה',type:'סוג קובץ שלא נתמך',enc:'PDF מוצפן בסיסמה',active:'PDF עם פקודות',big:'גדול מ-10MB',empty:'קובץ ריק',unv:'PDF שלא ניתן לבדוק (מבנה דחוס לא מוכר)',dl:'תקלה בהורדת הקובץ – לבדוק את הקובץ בווצאפ או במייל'};
const IVE={quota:'נגמרה מכסת הזיהוי של העסק – אפשר להזין ידנית',ai:'הזיהוי לא הצליח – אפשר להזין ידנית',file:'הקובץ לא נקרא'};
const ivAmt=x=>x.k==='chk'?x.f.amt:x.f.total;
const ivSrc=x=>(x.src||[]).map(s=>(s.ch==='mail'?'במייל מ-':'בווצאפ מ-')+(s.ch==='mail'?s.from:'+'+s.from)).join(' · ');
const ivPend=()=>(IV.L&&IV.L.items||[]).filter(x=>x.st==='new'||(x.st==='cl'&&x.mine)).length;
const ivSub=x=>{const s=x.sub&&subById(x.sub);if(s)return s;try{const f={supplier_id:x.f.hp,supplier:x.f.supplier};return x.f&&(x.f.hp||x.f.supplier)&&typeof usSup==='function'?usSup(f,usSupSubs()):null}catch(e){return null}};
const subOk=s=>!!(s&&!s.off&&(cat(s.cat)||{}).beh==='sup');
/* ספקים לשרת (4.3, 40): שם, ח.פ וסניפים (חתימת "ספק" בסניף). נשלח רק כשהרשימה השתנתה */
async function ivSups(){if(IV.supB)return;const on=brAll().filter(b=>b.on);
 const sups=S.subs.filter(s=>subOk(s)).map(s=>({id:s.id,name:s.name,hp:s.hp||'',br:on.filter(b=>(b.sig||[]).some(g=>g.k==='sup'&&(g.v===s.id||(!!g.v&&heKey(g.v)===heKey(s.name))))).map(b=>b.id)})).filter(s=>/^[A-Za-z0-9_-]{1,64}$/.test(s.id));
 const body={op:'sups',sups,nb:on.length,br1:on.length===1?on[0].id:''},h=JSON.stringify(body),k='lp-secsup:'+keyNow();body.dev=devId();let old='';try{old=localStorage.getItem(k)||''}catch(e){}if(old===h)return;
 IV.supB=1;try{await fnCall('secInv',body);try{localStorage.setItem(k,h)}catch(e){}}catch(e){}finally{IV.supB=0}}
async function ivLoad(force){if(!ready()||IV.b)return;if(!force&&IV.L&&Date.now()-IV.at<120000)return;IV.b=1;
 try{const r=await fnCall('secInv',{op:'list'});IV.L=r&&Array.isArray(r.items)?r:{err:'לא נטען',items:[]};IV.at=Date.now();if(!r.br)ivSups()}catch(e){IV.L={err:e&&e.message||'לא נטען',items:[]};IV.at=Date.now()}finally{IV.b=0}
 await ivRec();if(IV.L&&!IV.L.err)await ivAuto();if(['sec','home'].includes(cur().v)&&!typing())rerender()}
/* פנקס ההשלמה: פריט שנתפס ויצא מהתיבה המקומית – אושר (done) או נדחה (rej). מדווח לשרת; בלי רשת – נשאר לפעם הבאה */
let recQ=0;const ivRecSoon=()=>{if(!recQ){recQ=1;setTimeout(()=>{recQ=0;ivRec().then(()=>{if(cur().v==='sec'&&X.tab==='inv'&&!typing())rerender()})},300)}};
async function ivRec(){if(ivRec.b||!S)return;const L=secL(),ids=Object.keys(L).filter(id=>!S.inbox.some(i=>i.sec===id));if(!ids.length)return;ivRec.b=1;let ch=0,cf=0;
 try{for(const id of ids){const v=L[id]||{},op=v.s==='rej'?'rej':'done';
  try{await fnCall('secDecide',{op,id,dev:devId()});
   if(op==='done'&&v.ns){const t=txOfLid(lidOf(id));if(t)t.secNs=v.ns}
   delete L[id];ch=1}
  catch(e){if(['not-found','not-mine','already','taken','rejected'].includes(e&&e.reason)){
   /* תיקון 1 (ליקוי 1): נרשמה כאן, אבל בשרת היא כבר לא "שלי" (שוחררה אחרי 24 שעות / נלקחה במכשיר אחר) – לא מוחקים בשקט: התראה לבדיקה */
   const t=op==='done'?txOfLid(lidOf(id)):null;if(t){secCf()[id]={at:Date.now(),tx:t.id,inv:String(t.inv||''),amt:+t.amt||0,sub:String(t.subName||'')};cf=1}
   delete L[id];ch=1}}}}
 finally{ivRec.b=0;if(ch){save();IV.at=0}if(cf)toast('שימו לב: חשבונית מהמזכירה נרשמה במכשיר הזה, אבל ייתכן שנרשמה גם במכשיר אחר. פרטים במסך "חשבוניות"')}}
const secCf=()=>{if(!S.secCf||typeof S.secCf!=='object'||Array.isArray(S.secCf))S.secCf={};return S.secCf};
/* הורדת הקובץ מהתור (בחלקים) – data URL כמו קובץ שעובד שלח */
async function ivFile(x){if(!x.np)return '';let d='';for(let k=0;k<x.np;k++){const r=await fnCall('secInv',{op:'file',id:x.id,k});d+=r&&r.d||''}return d?'data:'+(x.mime||'application/pdf')+';base64,'+d:''}
/* הפריט שנתפס → תיבת ההוצאות המקומית (אותו מבנה של הוצאה מעובד) */
async function toInbox(x){const lid=lidOf(x.id),L=secL();let it=S.inbox.find(i=>i.id===lid);if(it)return it;
 if(txOfLid(lid)){L[x.id]={s:'in',ns:x.ns||''};save();ivRecSoon();toast('החשבונית כבר נרשמה במכשיר הזה');return null}
 let du='';try{du=await ivFile(x)}catch(e){}if(du){try{await fput('i'+lid,du)}catch(e){du=''}}
 const f=x.f||{},s=ivSub(x),ok=subOk(s),srcN='מהמזכירה – '+ivSrc(x)+(x.ns?' · שולח חדש – לבדוק':'');let d;
 if(x.k==='chk')d={kind:'check',amt:Math.max(0,+f.amt||0),date:'',cdate:f.cdate||'',no:String(f.no||'').replace(/\D/g,'').slice(0,20),bank:String(f.bank||'').slice(0,60),payee:String(f.payee||'').slice(0,80),cat:'',catName:'',sub:'',subName:'',note:'',inv:'',dn:false};
 else d={cat:ok?s.cat:'',sub:ok?s.id:'',subName:ok?s.name:String(f.supplier||'').slice(0,80),amt:typeof f.total==='number'?String(f.total):'',date:/^\d{4}-\d{2}-\d{2}$/.test(f.date||'')?f.date:'',inv:x.k==='dn'?'':x.k==='rcpt'?String(f.rel||''):String(f.num||''),dn:x.k==='dn',note:srcN};
 if(x.br&&brAll().some(b=>b.id===x.br))d.br=x.br;
 it={id:lid,by:'המזכירה',ow:'',at:new Date(x.t||Date.now()).toISOString(),d,file:du?'i'+lid:'',np:0,sec:x.id,secK:x.k};
 S.inbox.push(it);L[x.id]={s:'in',ns:x.ns||''};save();return it}
const brNeed=it=>brMulti()&&!(it.d&&it.d.br&&brAll().some(b=>b.id===it.d.br));
async function ivClaim(x,mode){try{const r=await fnCall('secDecide',{op:'claim',id:x.id,mode,dev:devId()});return r&&r.item||x}catch(e){if(mode==='man')toast(e&&e.reason==='already'?'החשבונית כבר הוכנסה במכשיר אחר':e&&e.message||'לא ניתן לקחת את החשבונית');IV.at=0;return null}}
/* תעודת משלוח פתוחה של אותו ספק שמתאימה לחשבונית (סכום ותקופה) – 4.6 */
function dnOpen(x){const s=ivSub(x),f=x.f||{};if(!s||typeof f.total!=='number')return [];const d=f.date||todayS(),lo=new Date(Date.parse(d)-62*864e5).toISOString().slice(0,10);
 return live().filter(t=>t.t==='exp'&&t.dn&&!t.inv&&t.sub===s.id&&Math.abs(rnd(t.amt)-rnd(f.total))<0.5&&(t.date||'')<=d&&(t.date||'')>=lo)}
/* קבלה: חשבונית פתוחה של אותו ספק – לפי מספר החשבונית שבקבלה, ואם אין – לפי סכום (4.6) */
function rcptOf(x){const s=ivSub(x),f=x.f||{};if(!s)return null;const L=live().filter(t=>t.t==='exp'&&t.sub===s.id&&hasPay(t)&&bal(t)>0.004);
 const n=NINV(f.rel);return(n&&L.find(t=>NINV(t.inv)===n))||(typeof f.total==='number'?L.find(t=>Math.abs(bal(t)-f.total)<0.5||Math.abs(t.amt-f.total)<0.5):null)||null}
function locDup(x){const s=ivSub(x),f=x.f||{};if(!s||x.k!=='inv')return null;const o=dupOf({id:'-',sub:s.id,amt:rnd(+f.total||0),date:f.date,inv:f.num});
 if(o.same||o.inv)return o.inv||o.same;return S.inbox.find(i=>i.sec!==x.id&&i.d&&i.d.sub===s.id&&((NINV(f.num)&&NINV(i.d.inv)===NINV(f.num))||(i.d.date===f.date&&rnd(num(i.d.amt))===rnd(+f.total||0))))||null}
async function ivHold(x,why){if(IV.held[x.id])return;IV.held[x.id]=1;try{await fnCall('secDecide',{op:'hold',id:x.id,why})}catch(e){}}
/* "נכנס ישר": רק מה שהשרת סימן זכאי; המכשיר רק מחמיר */
async function ivAuto(){if(IV.ab)return;const L=(IV.L&&IV.L.items||[]).filter(x=>x.st==='new'&&x.el);if(!L.length)return;IV.ab=1;let n=0;
 try{for(const x of L){const s=ivSub(x);
  if(!subOk(s)||s.id!==x.sub){await ivHold(x,'local');continue}
  if(brMulti()&&!(x.br&&brAll().some(b=>b.id===x.br))){await ivHold(x,'local');continue}
  if(txOfLid(lidOf(x.id))||S.inbox.some(i=>i.sec===x.id))continue;
  if(locDup(x)){await ivHold(x,'dup');continue}
  if(dnOpen(x).length){await ivHold(x,'dn');continue}
  if(awFor(x.sub).length){await ivHold(x,'aw');continue}
  const c=await ivClaim(x,'auto');if(!c)continue;
  const it=await toInbox(c);if(!it)continue;
  await ACT.inbOk({dataset:{id:it.id,ok:'1',aw:'1'}});
  if(!S.inbox.some(i=>i.id===it.id))n++}}
 finally{IV.ab=0}
 if(n){IV.auto+=n;IV.at=0;await ivRec();toast(n===1?'נכנסה חשבונית אחת מהמזכירה. אפשר לבטל במסך "חשבוניות"':'נכנסו '+n+' חשבוניות מהמזכירה. אפשר לבטל במסך "חשבוניות"')}}
/* חיבור לפעולות הקיימות: אחרי אישור / שמירה / דחייה / שיוך צ׳ק – מדווחים לשרת */
{const o=ACT.inbOk;ACT.inbOk=async function(el){const r=await o.apply(this,arguments);ivRecSoon();return r}}
{const o=FRM.inbsave;if(o)FRM.inbsave=function(){const r=o.apply(this,arguments);ivRecSoon();return r}}
{const o=window.inbDrop;if(typeof o==='function')window.inbDrop=function(id){const it=S.inbox.find(x=>x.id===id);if(it&&it.sec){const L=secL();L[it.sec]=Object.assign({},L[it.sec]||{},{s:'rej'})}const r=o.apply(this,arguments);ivRecSoon();return r}}
{const o=ACT.inbRe;if(o)ACT.inbRe=el=>{const it=S.inbox.find(x=>x.id===el.dataset.id);if(it&&it.sec)return toast('חשבונית מהמזכירה – אין עובד לבקש ממנו צילום. אפשר לפתוח את הקובץ או לדחות');return o(el)}}
{const r0=window.render;if(typeof r0==='function')window.render=function(){const r=r0.apply(this,arguments);try{if(elig()&&ready()&&!IV.b&&(!IV.L||Date.now()-IV.at>120000))ivLoad();else if(S&&S.secL&&Object.keys(S.secL).length)ivRecSoon()}catch(e){}return r}}
/* ---------- המסך ---------- */
function ivCard(x){const f=x.f||{},a=ivAmt(x),s=ivSub(x),tg=[],sug=[];let act='';const id=esc(x.id);
 const supL=x.k==='chk'?(f.payee?'מוטב: '+f.payee:''):x.match==='hp'||x.match==='snd'?'ספק: '+(x.subN||''):x.match==='name'?'נראה כמו '+(x.subN||'')+' – לאשר?':(f.supplier||f.hp)?'ספק חדש: '+(f.supplier||'')+(f.hp?' (ח.פ '+f.hp+')':''):'';
 if(x.ns)tg.push(`<span class="sectags w">שולח חדש: <bdi dir="ltr">${esc(x.nsShow)}</bdi></span>`);
 if(x.ua)tg.push('<span class="sectags w">שולח לא מאומת – ייתכן שהמייל מזויף</span>');
 if(x.hold==='rel')tg.push('<span class="sectags w">נלקחה במכשיר אחר ולא הושלמה – לבדוק שלא נרשמה כבר</span>');
 if(x.dup)tg.push('<span class="sectags w">חשד לכפילות</span>');
 const ld=x.st==='new'?locDup(x):null;if(ld)tg.push('<span class="sectags w">כבר רשומה אצלך</span>');
 if(x.st==='new'&&['inv','cr','dn','rcpt'].includes(x.k)&&brMulti()&&!x.br)tg.push('<span class="sectags">ממתין לבחירת סניף</span>');
 if(x.br&&brMulti())tg.push(`<span class="sectags">סניף: ${esc(brNm(x.br))}</span>`);
 if((x.unsure||[]).length&&x.k!=='bad')tg.push('<span class="sectags">יש שדות לא בטוחים</span>');
 if(x.st==='new'&&x.el)tg.push('<span class="sectags g">ייכנס אוטומטית</span>');
 else if(x.st==='new'&&x.k==='inv'&&(x.why||[]).length)tg.push(`<span class="sectags">ממתין לאישור: ${esc((x.why||[]).map(w=>IVW[w]||w).join(', '))}</span>`);
 if(x.err)tg.push(`<span class="sectags w">${esc(IVE[x.err]||x.err)}</span>`);
 const mineIn=S.inbox.find(i=>i.sec===x.id);
 if(x.st==='q'||x.st==='qw')act='<p class="note" style="margin:6px 0 0">המזכירה מזהה את המסמך…</p>';
 else if(x.st==='cl'&&!x.mine&&!x.stale)act='<p class="note" style="margin:6px 0 0">בטיפול במכשיר אחר</p>';
 else if(x.st==='ok')act=`<div class="secrow">${x.mineOk&&x.auto?(txOfLid(lidOf(x.id))?`<button class="btn g" data-a="secIvUndo" data-id="${id}">ביטול ההכנסה</button>`:'<small class="note">נכנסה במכשיר אחר – אפשר לבטל רק שם</small>'):''}${x.ns?`<button class="chip" data-a="secIvSnd" data-id="${id}">אישור השולח</button>`:''}</div>`;
 else if(x.k==='bad')act=`<p class="note" style="margin:6px 0 0">${esc((x.why||[]).map(w=>IVB[w]||w).join(', '))}. הקובץ לא נפתח ולא נשמר.</p><div class="secrow"><button class="btn g" data-a="secIvNo" data-id="${id}">סגירה</button></div>`;
 else{
  if(x.st==='cl'&&x.mine)tg.push('<span class="sectags g">נלקחה במכשיר הזה – לא הושלמה</span>');
  const view=x.np?`<button class="chip" data-a="secIvView" data-id="${id}">צפייה בקובץ</button>`:'';
  const no=`<button class="chip" data-a="secIvNo" data-id="${id}">דחייה</button>`;
  if(x.k==='inv'||x.k==='cr'){const dn=x.k==='inv'?dnOpen(x):[];
   if(dn.length)sug.push(`<div class="secivsug"><small>יש תעודת משלוח פתוחה של ${esc(s?s.name:'')} באותו סכום (${esc(dfmt(dn[0].date))}). כדי שלא תיספר פעמיים:</small><button class="btn w" style="margin-top:6px" data-a="secIvDn" data-id="${id}" data-t="${esc(dn[0].id)}">החלף את תעודת המשלוח בחשבונית</button></div>`);
   act=`<div class="secrow"><button class="btn" data-a="secIvOk" data-id="${id}" style="flex:1">${mineIn||x.mine?'המשך':'אישור'}</button><button class="chip" data-a="secIvEd" data-id="${id}">עריכה${brMulti()&&!x.br?' ובחירת סניף':''}</button>${view}${no}</div>`}
  else if(x.k==='rcpt'){const t=rcptOf(x);
   if(t)sug.push(`<div class="secivsug"><small>נמצאה חשבונית פתוחה: ${esc(t.inv||'')} · ${esc(ils(bal(t)))} לתשלום (${esc(dfmt(t.date))}). זו קבלה – לא הוצאה חדשה.</small><button class="btn w" style="margin-top:6px" data-a="secIvPay" data-id="${id}" data-t="${esc(t.id)}">סמן כשולם</button></div>`);
   else sug.push('<div class="secivsug"><small><b>קבלה בלי חשבונית – מה לעשות?</b> לא נמצאה חשבונית פתוחה מתאימה. אפשר לרשום כהוצאה (רק אם אין עליה חשבונית), או לדחות.</small></div>');
   act=`<div class="secrow">${t?'':`<button class="btn" data-a="secIvEd" data-id="${id}" style="flex:1">רישום כהוצאה</button>`}${view}${no}</div>`}
  else if(x.k==='dn')act=`<div class="secrow"><button class="btn" data-a="secIvEd" data-id="${id}" style="flex:1">רישום כתעודת משלוח</button>${view}${no}</div>`;
  else if(x.k==='chk')act=`<div class="secrow"><button class="btn" data-a="secIvOk" data-id="${id}" style="flex:1">שיוך לחשבונית</button>${view}${no}</div>`;
  else act=`<div class="secrow"><button class="btn" data-a="secIvEd" data-id="${id}" style="flex:1">הזנה ידנית</button>${view}${no}</div>`;
  if(x.ns&&x.sub)act+=`<div class="secrow"><button class="chip" data-a="secIvSnd" data-id="${id}">אישור השולח כ${esc(x.subN||'ספק')}</button></div>`}
 const sub=[f.date?dfmt(f.date):'',x.k==='chk'?(f.no?'צ׳ק '+f.no:'')+(f.cdate?' · לפירעון '+dfmt(f.cdate):''):f.num?'מס׳ '+f.num:'',x.fn?x.fn:''].filter(Boolean).join(' · ');
 return `<div class="card secinv" id="secIv_${id}" style="margin-bottom:8px"><div class="ivh"><b>${esc(IVK[x.k]||'מסמך')}${supL?' · '+esc(supL):''}</b>${typeof a==='number'?`<span class="iva">${esc(ils(a))}</span>`:''}</div>
 ${sub?`<small class="note ivs">${esc(sub)}</small>`:''}<small class="note ivs">${esc(ivSrc(x))} · ${esc(tm(x.t))}</small>${tg.length?'<div class="sectg">'+tg.join('')+'</div>':''}${sug.join('')}${act}</div>`}
function ivSetH(){const R=IV.L;if(!R||R.err||R.br)return '';const c=R.cfg||{},off=c.off||[],subs=S.subs.filter(s=>subOk(s)).sort((a,b)=>heCmp(a.name,b.name));
 return `<details class="card secivset" id="secIvSet" style="margin-bottom:8px"><summary>הגדרות "נכנס ישר"</summary>
 <p class="note" style="margin:4px 0 8px">חשבונית רגילה מספק מוכר, שכל השדות שלה זוהו ושהסכום שלה מתחת לתקרה – נכנסת לבד בפתיחה הבאה של האפליקציה, עם אפשרות ביטול. זיכוי, קבלה, תעודת משלוח, צ׳ק, סכום שלילי וחשד לכפילות – תמיד מחכים לאישור שלך.</p>
 <label class="chip" style="min-height:44px"><input type="checkbox" data-c="secIvAuto"${c.auto!==false?' checked':''}> "נכנס ישר" פעיל בעסק</label>
 <form data-f="secIvCap" class="row" style="margin-top:8px;align-items:flex-end"><label class="f grow"><span>תקרה אחת לעסק (₪, לפי ערך מוחלט)</span><input name="cap" inputmode="decimal" dir="ltr" maxlength="10" value="${esc(String(c.cap!=null?c.cap:20000))}"></label><button class="btn">שמירה</button></form>
 <form data-f="secIvOff" class="row" style="margin-top:8px;align-items:flex-end"><label class="f grow"><span>כיבוי "נכנס ישר" לספק</span><select name="sub"><option value="">בחר ספק</option>${subs.filter(s=>!off.includes(s.id)).map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select></label><button class="btn g">כיבוי</button></form>
 ${off.length?`<div class="sectg" style="margin-top:6px">${off.map(id=>{const s=subById(id);return `<span class="sectags">${esc(s?s.name:id)} <button class="chip" style="min-height:32px;padding:0 8px" data-a="secIvOn" data-id="${esc(id)}" aria-label="הפעלה מחדש">הפעלה</button></span>`}).join('')}</div>`:''}
 ${c.supAt?`<p class="note" style="margin:8px 0 0">רשימת הספקים והסניפים שהשרת משתמש בה עודכנה ${esc(tm(c.supAt))} ${c.supMe&&c.supDev===devId()?'מהמכשיר הזה':'ממכשיר אחר'}. כל מכשיר שולח את הרשימה שלו; כשמשתנה שיוך סניף של ספק, חשבוניות שממתינות חוזרות לאישור ידני.</p>`:''}
 ${R.stop?'<p class="note" style="margin:8px 0 0;color:var(--bad)">"עצור הכל" פעיל – שום חשבונית לא נכנסת לבד עד שהעצירה תבוטל.</p>':''}</details>`}
/* חשבוניות שנרשמו כאן ואולי גם במכשיר אחר (ליקוי 1) */
function ivCfH(){const C=S.secCf&&typeof S.secCf==='object'?S.secCf:{},k=Object.keys(C);if(!k.length)return '';
 return `<div class="card" id="secIvCf" style="margin-bottom:8px;border-color:var(--bad)"><b>לבדוק: ייתכן שנרשמה פעמיים</b><p class="note" style="margin:4px 0 6px">החשבוניות האלה נרשמו במכשיר הזה, אבל הדיווח לשרת התעכב יותר מ-24 שעות, ובינתיים ייתכן שנרשמו גם במכשיר אחר. בדקו ברשימת ההוצאות ומחקו כפילות אם יש.</p>${k.map(id=>{const c=C[id]||{};return `<div class="secrow"><small class="note" style="flex:1">${esc(c.sub||'')} ${c.inv?'· מס׳ '+esc(c.inv):''} · ${esc(ils(+c.amt||0))}</small><button class="chip" data-a="secIvCfOk" data-id="${esc(id)}">בדקתי</button></div>`}).join('')}</div>`}
ACT.secIvCfOk=el=>{const C=secCf();delete C[el.dataset.id];save();rerender()};
function invH(){const R=IV.L;if(!R){if(!IV.b)ivLoad(1);return '<div class="empty">טוען…</div>'}
 if(R.err)return `<div class="card"><p class="note">${esc(R.err)}</p><button class="btn g w" data-a="secIvRe">נסה שוב</button></div>`;
 const L=R.items||[],P=L.filter(x=>['new','cl','q','qw'].includes(x.st)),D=L.filter(x=>x.st==='ok'&&x.auto&&x.mineOk);
 let h=ivCfH()+ivSetH();
 h+=`<div class="secrow" style="margin:0 0 8px"><button class="chip" data-a="secIvRe">רענון</button>${R.br?'<small class="note">מוצגות רק חשבוניות של הסניפים שלך</small>':''}</div>`;
 h+=P.length?P.map(ivCard).join(''):'<div class="card"><p class="note" style="margin:0">אין חשבוניות שממתינות. קבצים שנשלחים לווצאפ של העסק או מצורפים למייל המחובר יופיעו כאן.</p></div>';
 if(D.length)h+=`<div class="sec"><h3>נכנסו אוטומטית (3 ימים אחרונים)</h3></div>`+D.map(ivCard).join('');
 return `<div id="secInv">${h}</div>`}
const ivX=el=>(IV.L&&IV.L.items||[]).find(x=>x.id===el.dataset.id);
ACT.secIvRe=()=>{IV.at=0;IV.L=null;rerender()};
ACT.secIvOk=async el=>{const x=ivX(el);if(!x)return;el.disabled=true;try{const c=x.st==='cl'&&x.mine?x:await ivClaim(x,'man');if(!c)return;const it=await toInbox(c);if(!it)return;
 if(x.k==='chk')return inbChkOpen(it);if(brNeed(it)||!it.d.cat||!it.d.sub)return ACT.inbEdit({dataset:{id:it.id}});await ACT.inbOk({dataset:{id:it.id}})}finally{el.disabled=false;IV.at=0;rerender()}};
ACT.secIvEd=async el=>{const x=ivX(el);if(!x)return;el.disabled=true;try{const c=x.st==='cl'&&x.mine?x:await ivClaim(x,'man');if(!c)return;const it=await toInbox(c);if(!it)return;ACT.inbEdit({dataset:{id:it.id}})}finally{el.disabled=false;IV.at=0}};
ACT.secIvNo=el=>{const x=ivX(el);if(!x)return;ask(x.k==='bad'?'לסגור את הכרטיס?':'לדחות את המסמך? הוא לא יירשם, והקובץ יימחק מהתור אחרי 30 יום.',async()=>{const it=S.inbox.find(i=>i.sec===x.id);
 try{await fnCall('secDecide',{op:'rej',id:x.id});if(it){S.inbox=S.inbox.filter(i=>i!==it);delete secL()[x.id];save()}toast(x.k==='bad'?'נסגר':'נדחה')}catch(e){err(e)}finally{IV.at=0;IV.L=null;rerender()}},x.k==='bad'?'סגירה':'דחייה')};
ACT.secIvView=async el=>{const x=ivX(el);if(!x)return;el.disabled=true;try{const it=S.inbox.find(i=>i.sec===x.id);if(it&&it.file)return viewImg(it.file,'LargePami_'+x.id.slice(0,8));const du=await ivFile(x);if(!du)return toast('הקובץ כבר לא שמור בתור');await fput('sv'+x.id,du);viewImg('sv'+x.id,'LargePami_'+x.id.slice(0,8),du)}catch(e){err(e)}finally{el.disabled=false}};
/* קבלה → "סמן כשולם": הקבלה מצורפת לחשבונית (כמו בסריקה האחידה), ונפתח מסך התשלום הקיים. אין הוצאה חדשה */
ACT.secIvPay=async el=>{const x=ivX(el),t=S.tx.find(z=>z.id===el.dataset.t);if(!x||!t)return;const c=await ivClaim(x,'man');if(!c)return;let du='';try{du=await ivFile(x)}catch(e){}
 if(du){const fid='f'+uid();try{await fput(fid,du);if(!t.file)t.file=fid;else t.rcf=fid}catch(e){}}const lid=lidOf(x.id);t.srcs=Array.isArray(t.srcs)?t.srcs:[];if(!t.srcs.includes(lid))t.srcs.push(lid);
 secL()[x.id]={s:'in'};save();ivRecSoon();IV.at=0;toast('הקבלה צורפה לחשבונית '+(t.inv||''));payDlg(t.id)};
/* חשבונית אחרי תעודת משלוח → "החלף את תעודת המשלוח בחשבונית" (המנגנון הקיים dnfix: מספר וקובץ, הסכום ברשומה לא משתנה) */
ACT.secIvDn=async el=>{const x=ivX(el),t=S.tx.find(z=>z.id===el.dataset.t);if(!x||!t)return;const f=x.f||{},inv=String(f.num||'').trim();if(!inv)return toast('לא זוהה מספר חשבונית – אפשר לאשר ולערוך');
 const dd=dupOf({id:t.id,sub:t.sub,amt:t.amt,date:t.date,inv});
 const na=typeof f.total==='number'&&Number.isFinite(f.total)&&f.total>0?rnd(f.total):null;
 /* החלטת בעל הפרויקט (תיקון 1): בהחלפה מחליפים גם את הסכום לסכום שבחשבונית */
 ask((dd.inv?'מספר החשבונית כבר קיים אצל הספק. ':'')+'להחליף את תעודת המשלוח ('+ils(t.amt)+', '+dfmt(t.date)+') בחשבונית '+inv+'? '+(na!=null&&rnd(t.amt)!==na?'הסכום יעודכן לסכום שבחשבונית: '+ils(na)+'.':'הסכום ברשומה יהיה הסכום שבחשבונית.'),async()=>{const c=await ivClaim(x,'man');if(!c)return;let du='';try{du=await ivFile(x)}catch(e){}
  if(du){const fid='f'+uid();try{await fput(fid,du);t.file=fid}catch(e){}}t.inv=inv;delete t.dn;if(na!=null)t.amt=na;const lid=lidOf(x.id);t.srcs=Array.isArray(t.srcs)?t.srcs:[];if(!t.srcs.includes(lid))t.srcs.push(lid);
  secL()[x.id]={s:'in',ns:x.ns||''};save();ivRecSoon();IV.at=0;rerender();toast('התעודה הוחלפה בחשבונית')},'החלפה')};
ACT.secIvSnd=el=>{const x=ivX(el);if(!x)return;ask('לאשר את '+x.nsShow+' כשולח של '+(x.subN||'הספק')+'? חשבוניות הבאות ממנו לא יסומנו "שולח חדש".',async()=>{try{const r=await fnCall('secDecide',{op:'sender',id:x.id});
 let ch=0;for(const t of S.tx){if(t.secNs===x.ns){delete t.secNs;if(typeof t.note==='string')t.note=t.note.replace(' · שולח חדש – לבדוק','');ch=1}}if(ch)save();toast('השולח אושר: '+(r&&r.sender||''))}catch(e){err(e)}finally{IV.at=0;IV.L=null;rerender()}},'אישור')};
ACT.secIvUndo=el=>{const x=ivX(el);if(!x)return;const t=txOfLid(lidOf(x.id));
 /* תיקון 1 (ליקוי 4): ההוצאה נמצאת רק במכשיר שהכניס – ביטול רק משם */
 if(!t||(x.okDev&&x.okDev!==devId()))return toast('אפשר לבטל רק במכשיר שבו החשבונית נכנסה');if((t.pays||[]).length)return toast('כבר נרשם תשלום על החשבונית – אי אפשר לבטל מכאן');
 ask('לבטל את ההכנסה? ההוצאה תוסר מהרשומות במכשיר הזה, והחשבונית תחזור ל"ממתינות לאישור".',async()=>{try{await fnCall('secDecide',{op:'undo',id:x.id,dev:devId()});if(t){S.tx=S.tx.filter(z=>z!==t);save()}toast('ההכנסה בוטלה')}catch(e){err(e)}finally{IV.at=0;IV.L=null;rerender()}},'ביטול ההכנסה')};
CHG.secIvAuto=async el=>{try{const r=await fnCall('secInv',{op:'cfg',auto:!!el.checked});if(IV.L&&r.cfg)IV.L.cfg=Object.assign(IV.L.cfg||{},r.cfg);toast(el.checked?'"נכנס ישר" הופעל':'"נכנס ישר" כובה')}catch(e){err(e);el.checked=!el.checked}};
FRM.secIvCap=async f=>{const v=pNum(fd(f).cap);if(v==null||v<0)return toast('תקרה לא תקינה');const b=f.querySelector('button');b.disabled=true;try{const r=await fnCall('secInv',{op:'cfg',cap:v});if(IV.L&&r.cfg)IV.L.cfg=Object.assign(IV.L.cfg||{},r.cfg);toast('התקרה נשמרה')}catch(e){err(e)}finally{b.disabled=false;rerender()}};
FRM.secIvOff=async f=>{const s=fd(f).sub;if(!s)return toast('בחר ספק');try{const r=await fnCall('secInv',{op:'cfg',sub:s,off:true});if(IV.L&&r.cfg)IV.L.cfg=Object.assign(IV.L.cfg||{},r.cfg);toast('"נכנס ישר" כובה לספק')}catch(e){err(e)}finally{rerender()}};
ACT.secIvOn=async el=>{try{const r=await fnCall('secInv',{op:'cfg',sub:el.dataset.id,off:false});if(IV.L&&r.cfg)IV.L.cfg=Object.assign(IV.L.cfg||{},r.cfg);toast('"נכנס ישר" הופעל לספק')}catch(e){err(e)}finally{rerender()}};
{const r7=V.sec;V.sec=()=>{const k=keyNow();if(IV.key!==k){IV.key=k;IV.L=null;IV.at=0}
 let r;if(elig()&&ready()&&X.st&&X.st.setupDone&&!X.edit&&!X.set&&X.tab==='inv'){const S0=X.st;r={t:S0.name||'המזכירה',s:'חשבוניות שהתקבלו',h:stopH()+tabsH()+invH()}}else r=r7();
 try{const n=ivPend();if(n&&r&&r.h)r.h=r.h.replace('data-v="inv">חשבוניות','data-v="inv">חשבוניות <span class="secbadge">'+n+'</span>')}catch(e){}return r}}
/* כרטיס בבית (11): שורת חשבוניות – רק כשיש */
{const h7=V.home;if(h7)V.home=()=>{const r=h7();try{const n=ivPend();if(n&&r&&r.h&&r.h.includes('id="secHome"'))r.h=r.h.replace(/(id="secHome"[\s\S]*?<small class="note" style="display:block">[^<]*<\/small>)/,'$1<div class="note" style="margin-top:4px" id="secHomeInv">'+(n===1?'חשבונית אחת ממתינה לאישור':n+' חשבוניות ממתינות לאישור')+'</div>')}catch(e){}return r}}
{const t7=ACT.secTab;ACT.secTab=el=>{if(el.dataset.v==='inv'){IV.at=0}t7(el)}}
window.__secInv=IV;

window.__sec=X;
})();
