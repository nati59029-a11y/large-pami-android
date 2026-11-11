/* SEC:1+2+3+4 – המזכירה העסקית. שלב 4: לשוניות "התראות" ו"דוחות", הגדרות התראות ודוחות, מחיקת היסטוריה באישור כפול, תזכורת ביומן, רישום הטלפון להתראות (אם רכיב ההתראות קיים באפליקציה). שלב 1 ("שלד ותוספת"), שלב 2 ("צ'אט, מראה הכספים וייעוץ") ושלב 3 ("מידע על העסק, בנק תשובות, יומן" – לשוניות בתוך מסך המזכירה). קובץ עצמאי, נטען אחרי index.html (כמו orders-staff.js).
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
async function ask2(q,deep){q=q.replace(/\s+$/,'');if(!q.trim()||X.sending)return;if(q.length>2000)return toast('השאלה ארוכה מדי (עד 2,000 תווים)');
 X.msgs=X.msgs||[];X.msgs.push({role:'u',text:q,t:Date.now()});X.sending=1;X.deep=deep;X.draft='';rerender();scrollEnd();
 try{const fin=secFin({pay:!!X.st.pay});const d={text:q,deep};if(fin)d.fin=fin;
  const r=await fnCall('secChat',d);
  X.msgs.push({role:'a',text:r.reply,src:r.src||[],ideas:r.ideas||[],th:r.th||null,cards:r.cards||[],stale:!!r.stale,mode:r.mode,t:Date.now()});if((r.cards||[]).length){X.fl=null;X.cl=null}
  if(Number.isFinite(r.pct))X.st.pct=r.pct;X.st.saving=r.saving?(X.st.saving||'month'):'';if(r.mode==='saving')X.st.saving=X.st.saving||'month'}
 catch(e){X.msgs.push({role:'a',text:(e&&e.message)||'השליחה נכשלה. נסו שוב.',t:Date.now()});if(e&&e.reason==='rate-limit')X.draft=q}
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
const TABS=[['chat','שיחה'],['notes','התראות'],['reps','דוחות'],['facts','מידע על העסק'],['cal','יומן'],['bank','תשובות מוכנות']];
const unseenN=()=>X.nl&&!X.nl.err?X.nl.unseen:((X.st&&X.st.unseen)||0);
function tabsH(){const t=X.tab||'chat';return `<div class="sectabs" role="tablist" id="secTabs">${TABS.map(([k,l])=>`<button class="chip${t===k?' on':''}" role="tab" aria-selected="${t===k}" data-a="secTab" data-v="${k}">${l}${k==='facts'&&X.facts&&X.facts.pend?` (${X.facts.pend})`:''}${k==='notes'&&unseenN()?` <span class="secbadge">${unseenN()}</span>`:''}</button>`).join('')}</div>`}
ACT.secTab=el=>{X.tab=el.dataset.v;if(X.tab==='facts')X.fl=null;if(X.tab==='cal')X.cl=null;if(X.tab==='bank')X.rl=null;if(X.tab==='notes')X.nl=null;if(X.tab==='reps'){X.rpl=null;X.rp=null}rerender()};
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
async function factsLoad(){X.fb=1;try{const r=await fnCall('secFacts',{op:'list'});X.fl=r;X.facts={pend:(r.facts||[]).filter(f=>f.st==='prop').length}}catch(e){X.fl={err:e&&e.message||'לא נטען'}}finally{X.fb=0;if(cur().v==='sec'&&!typing())rerender()}}
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
async function calLoad(){X.cb=1;try{X.cl=await fnCall('secCal',{op:'list'})}catch(e){X.cl={err:e&&e.message||'לא נטען'}}finally{X.cb=0;if(cur().v==='sec'&&!typing())rerender()}}
const SRC={mgr:'ידני',sec:'מהמזכירה',import:'ייבוא'};
function evH(e){return `<div class="secli"><p><b>${e.tm?'<bdi dir="ltr">'+esc(e.tm)+'</bdi> · ':''}${esc(e.title)}</b> ${e.rem?'<span class="sectags">תזכורת</span>':''}<span class="sectags">${e.biz?'של העסק':'אישי'}</span><span class="sectags">${esc(SRC[e.src]||'ידני')}</span></p>${e.note?`<small class="note">${esc(e.note)}</small>`:''}<div class="secrow"><button class="chip" data-a="secEvEd" data-id="${esc(e.id)}">ערוך</button><button class="chip" data-a="secEvDel" data-id="${esc(e.id)}">מחק</button></div></div>`}
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
async function rulesLoad(){X.rb=1;try{X.rl=await fnCall('secRules',{op:'list'})}catch(e){X.rl={err:e&&e.message||'לא נטען'}}finally{X.rb=0;if(cur().v==='sec'&&!typing())rerender()}}
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
async function notesLoad(){X.nb=1;try{const r=await fnCall('secNotes',{op:'list'});X.nl=r;const ids=(r.notes||[]).filter(n=>!n.seen).map(n=>n.id).slice(0,100);
 if(ids.length)fnCall('secNotes',{op:'seen',ids}).then(()=>{if(X.st)X.st.unseen=0;if(X.nl)X.nl.unseen=0}).catch(()=>{})}
 catch(e){X.nl={err:e&&e.message||'לא נטען'}}finally{X.nb=0;if(cur().v==='sec'&&!typing())rerender()}}
const KIND={rep:'דוח',emp:'עובד',dig:'תקציר'};
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
async function repsLoad(){X.rb4=1;try{X.rpl=await fnCall('secReports',{op:'list'})}catch(e){X.rpl={err:e&&e.message||'לא נטען'}}finally{X.rb4=0;if(cur().v==='sec'&&!typing())rerender()}}
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
 <label class="f"><span>דוח חודשי – ביום העסקים הראשון בחודש, בשעה</span>${hours(n.mh,'mh')}</label>
 <div class="row"><label class="chip" style="min-height:44px;flex:1;justify-content:flex-start"><input type="checkbox" name="dg" value="1"${n.dg?' checked':''}> תקציר יומי</label><label class="f grow"><span>בשעה</span>${hours(n.dh,'dh')}</label></div>
 <b style="display:block;margin-top:8px">שעות שקטות</b><small class="note">התראת טלפון שנופלת בהן מחכה לסופן.</small>
 <div class="row"><label class="chip" style="min-height:44px;justify-content:flex-start"><input type="checkbox" name="qon" value="1"${n.q&&n.q.on?' checked':''}> פעיל</label><label class="f grow"><span>מ-</span><input type="time" name="qf" dir="ltr" value="${esc((n.q||{}).f||'22:00')}"></label><label class="f grow"><span>עד</span><input type="time" name="qt" dir="ltr" value="${esc((n.q||{}).t||'07:00')}"></label></div>
 <b style="display:block;margin-top:8px">תזכורות</b>${Object.keys(T).map(k=>`<label class="chip" style="min-height:44px;margin:4px 0;width:100%;justify-content:flex-start"><input type="checkbox" name="rt_${esc(k)}" value="1"${rt[k]?' checked':''}> ${esc(T[k])}${k==='emp'&&!S.emp?' (פועל רק כשניתוח העובדים פעיל)':''}</label>`).join('')}
 <label class="f"><span>חזרות לתזכורת שלא טופלה (פעם ביום עסקים)</span><select name="reps">${[0,1,2,3].map(k=>`<option value="${k}"${k===n.reps?' selected':''}>${k}</option>`).join('')}</select></label>
 <button class="btn w" style="margin-top:8px">שמירה</button></form>
 <div class="card" style="margin-top:8px"><b>מחיקת היסטוריה</b><p class="note" style="margin:4px 0 8px">השיחות נשמרות 12 חודשים, ויומן הפעולות 24 חודשים. אפשר למחוק עכשיו את השיחה, ההתראות והדוחות שלך (יומן הפעולות נשאר). המחיקה סופית.</p><button class="btn g w" data-a="secHistDel">מחיקת ההיסטוריה שלי</button></div>`}
CHG.secNtWd=el=>{const w=document.getElementById('secWdWarn');if(w)w.textContent=(+el.value===5||+el.value===6)?'הדוח יופיע ביום העסקים הבא':''};
FRM.secNtF=async f=>{const x=fd(f),T=(X.st&&X.st.types)||{},rt={};for(const k of Object.keys(T))rt[k]=x['rt_'+k]==='1';
 const hm=/^([01]\d|2[0-3]):[0-5]\d$/;if(!hm.test(x.qf||'')||!hm.test(x.qt||'')||x.qf===x.qt)return toast('שעות שקטות: שעת התחלה וסיום שונות');
 const nt={wd:+x.wd,wh:+x.wh,mh:+x.mh,dg:x.dg==='1',dh:+x.dh,q:{on:x.qon==='1',f:x.qf,t:x.qt},rt,reps:+x.reps};
 const b=f.querySelector('button.btn');b.disabled=true;try{const r=await fnCall('secPrefs',{op:'notify',nt});X.st.nt=r.nt||nt;toast(r.warn?'נשמר. '+r.warn:'נשמר')}catch(e){err(e)}finally{b.disabled=false}};
ACT.secHistDel=()=>{ask('למחוק את כל ההיסטוריה שלך במזכירה (שיחה, התראות ודוחות)?',async()=>{
 try{const r=await fnCall('secHistory',{op:'ask'});const c=r.counts||{};X.hd=r.token;
  dlg(`<h3>אישור שני – מחיקה סופית</h3><p>יימחקו: ${esc(String(c.chat||0))} הודעות בשיחה, ${esc(String(c.notes||0))} התראות ו-${esc(String(c.reports||0))} דוחות. אי אפשר לשחזר. המחיקה תירשם ביומן הפעולות.</p><div class="row"><button class="btn grow" data-a="secHistOk">כן, למחוק סופית</button><button class="btn g grow" data-a="closeDlg">ביטול</button></div>`)}catch(e){err(e)}},'המשך')};
ACT.secHistOk=async el=>{const t=X.hd;X.hd=null;if(!t)return closeDlg();el.disabled=true;try{const r=await fnCall('secHistory',{op:'del',token:t,sure:true});closeDlg();X.msgs=null;X.nl=null;X.rpl=null;X.rp=null;X.log=null;const d=r.deleted||{};toast('נמחק: '+(d.chat||0)+' הודעות, '+(d.notes||0)+' התראות, '+(d.reports||0)+' דוחות');rerender()}catch(e){el.disabled=false;err(e)}};
/* ---------- רישום הטלפון להתראות (7.2): רק אם רכיב ההתראות קיים באפליקציה (Capacitor PushNotifications). בלי הרכיב – ההתראות במסך בלבד ---------- */
const PN={done:0};
async function pushReg(){try{if(PN.done||!ready())return;const P=window.Capacitor&&window.Capacitor.Plugins&&window.Capacitor.Plugins.PushNotifications;if(!P)return;PN.done=1;
 await P.addListener('registration',t=>{if(t&&t.value)window.fnCall('registerPushToken',{token:t.value}).catch(()=>{})});
 await P.addListener('pushNotificationActionPerformed',()=>{X.tab='notes';X.nl=null;try{go('sec')}catch(e){}});
 let p=await P.checkPermissions();if(p.receive==='prompt'||p.receive==='prompt-with-rationale')p=await P.requestPermissions();if(p.receive==='granted')await P.register()}catch(e){}}
{const r0=V.sec;V.sec=()=>{const r=r0();try{if(ready())pushReg()}catch(e){}return r}}

window.__sec=X;
})();
