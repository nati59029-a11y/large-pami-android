/* SEC:1+2+3+4+5+6+7+9+10 – המזכירה העסקית. SEC:10 (15.11.2026): צ'אט נקי בכל כניסה, "צ'אט קודם", "מול העיניים", מצב כרטיסים שנשמר, כללי ניתוב (למסך "לטיפול" באפליקציה). שלב 7: לשונית "חשבוניות" (חשבוניות שהתקבלו מווצאפ ומ-Gmail: אישור, דחייה, עריכה ובחירת סניף, "נכנס ישר" עם ביטול, קבלה → "סמן כשולם", חשבונית אחרי תעודת משלוח → החלפה, שולח חדש). שלב 6: לשונית "מייל" (Gmail – שליחה רק בלחיצה, ניקוי ספאם באישור מנהל העסק), חיבורי Google בהגדרות, סריקת היסטוריה אצל מנהל־על, סנכרון יומן Google. שלב 5: לשונית "ווצאפ" (תיבת הודעות, כרטיס שולח, טיוטה עם "שלח" בלחיצה, חלון 24 שעות ותבניות), "עצור הכל", הגדרות ווצאפ, ובכרטיס העסק של מנהל־על – חיבור המספר ומספרי המנהלים. שלב 4: לשוניות "התראות" ו"דוחות", הגדרות התראות ודוחות, מחיקת היסטוריה באישור כפול, תזכורת ביומן, רישום הטלפון להתראות (אם רכיב ההתראות קיים באפליקציה). שלב 1 ("שלד ותוספת"), שלב 2 ("צ'אט, מראה הכספים וייעוץ") ושלב 3 ("מידע על העסק, בנק תשובות, יומן" – לשוניות בתוך מסך המזכירה). קובץ עצמאי, נטען אחרי index.html (כמו orders-staff.js).
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
 if(/<div class="chips hacts"/.test(r.h))r.h=r.h.replace(/(<div class="chips hacts")/,card+'$1');else r.h+=card;
 /* 15.11.2026: התראות חדשות מהמזכירה – פס בולט בראש הבית, לחיצה פותחת ישר את לשונית ההתראות */
 const un=S.consented&&S.setupDone?+S.unseen||0:0;if(un>0)r.h=`<button type="button" class="ban" id="secNBan" data-a="secNotesGo" style="border-color:var(--acc);margin:10px 0"><span style="color:var(--acc);flex:none">${typeof icd==='function'?icd('bell'):''}</span><span style="flex:1;min-width:0"><b>${un===1?'יש התראה חדשה מהמזכירה':'יש '+un+' התראות חדשות מהמזכירה'}</b><small class="note" style="display:block">לחיצה – פתיחת ההתראות</small></span><span class="secbadge" style="flex:none">${un}</span></button>`+r.h}catch(e){}return r}}

/* ---------- מסך המזכירה ---------- */
const DENY={'not-main-manager':'בעסק הזה המזכירה זמינה רק למנהל הראשי.','not-biz-admin':'המזכירה זמינה למנהלי העסק בלבד.','not-manager':'המזכירה זמינה למנהלי העסק בלבד.','feature-off':'המזכירה לא מופעלת בעסק הזה.','biz-suspended':'החשבון מושהה – פנה לספק.'};
const ACTS={consent:'אישור תנאי השימוש',setup:'הגדרת שם ואופן פנייה',cfg:'מנהל המערכת עדכן הגדרות',readChat:'מנהל המערכת צפה בשיחה',
 factAdd:'נשמרה עובדה',factOk:'אושרה עובדה שהמזכירה הציעה',factNo:'בוטלה הצעה לעובדה',factEdit:'עובדה נערכה',factDel:'עובדה נמחקה',fixed:'עודכנו פרטים קבועים',price:'הועלה מחירון',priceDel:'המחירון נמחק',
 sensRead:'צפייה במידע הרגיש',sensTool:'המזכירה קראה מידע רגיש',sensAdd:'נשמר מידע רגיש',sensEdit:'מידע רגיש נערך',sensDel:'מידע רגיש נמחק',
 ruleAdd:'נוספה תשובה מוכנה',ruleEdit:'תשובה מוכנה נערכה',ruleDel:'תשובה מוכנה נמחקה',bank:'נענתה שאלה מתשובה מוכנה (בלי AI)',import:'ייבוא מהמזכירה הקודמת',
 calAdd:'נוסף אירוע ביומן',calOk:'אושר אירוע שהמזכירה הציעה',calNo:'בוטלה הצעה לאירוע',calEdit:'אירוע נערך',calDel:'אירוע נמחק',calWe:'שונתה הגדרת פגישות בשישי/שבת/חג',
 notify:'שונו הגדרות ההתראות והדוחות',remDone:'תזכורת סומנה כטופלה',remReps:'שונה מספר החזרות בתזכורת',remSnooze:'נקבע "תזכירי לי שוב" להתראה',empAlert:'התראה על עובד',report:'נוצר דוח',insightDone:'תובנה סומנה כטופלה',histAsk:'בקשה למחוק היסטוריה',histDel:'ההיסטוריה נמחקה',retention:'ניקוי אוטומטי לפי מדיניות השמירה'};
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
 /* SEC:10: הצ'אט נפתח נקי – בלי טעינת השיחה הקודמת (היא בלשונית "צ'אט קודם"; המזכירה עדיין זוכרת אותה בשרת) */
 X.msgs=X.msgs||[];
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
  const cs=catsOf('inc').concat(catsOf('exp').filter(c=>c&&c.id!=='e_dep'));/* הפקדה לבנק – העברה, לא הוצאה (20.11) */
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
   for(let i=0;i<=MONTHS;i++){const m=addMon(m0,-i),G={};L.filter(t=>t.t==='exp'&&emp(t)&&!t.ec&&pmon(t)===m).forEach(t=>{const n=String(subName(t)).slice(0,60);G[n]=rnd((G[n]||0)+num(t.amt))});
    const r=Object.entries(G);if(r.length)f.pay[m]=r}}
  /* 15.11.2026: o.rec – הפעולות האחרונות שנרשמו (רק לשאלה בצ'אט, לא למראה): מהאחרונה שנרשמה (t.ts), 30 יום, עד 80.
     [זמן רישום, תאריך, i/e, קטגוריה, שם, סכום, מס' חשבונית, אמצעי תשלום, שולם] – כדי לענות על "לאיזה ספק הכנסתי עכשיו חשבונית של 50 באשראי" */
  if(o.rec){const lo=now-30*864e5,tsOf=t=>{const x=t.ts?Date.parse(t.ts):NaN;return Number.isFinite(x)?x:0},key=t=>tsOf(t)||Date.parse((t.date||'')+'T12:00:00')||0;
   /* שכר (beh emp) – רק כשמתג השכר של המנהל פעיל (o.pay), ומסומן [9]=1 כדי שהשרת יסנן גם הוא */const isEmp=t=>(cat(t.cat)||{}).beh==='emp';
   f.rec=L.filter(t=>(t.t==='exp'||t.t==='inc')&&!t.ec&&key(t)>=lo&&(o.pay||!isEmp(t))).sort((x,y)=>key(y)-key(x)).slice(0,80).map(t=>{const P=(t.pays||[]).filter(p=>p&&!p.crof);
    return [Math.round(tsOf(t)),t.date||'',t.t==='inc'?'i':'e',String((cat(t.cat)||{}).name||'').slice(0,40),String(subName(t)).slice(0,60),rnd(num(t.amt)),String(t.inv||'').slice(0,30),[...new Set(P.map(p=>p.m).filter(Boolean))].join(', ').slice(0,40),rnd(sum(P,p=>num(p.a))),isEmp(t)?1:0]})}
  /* 19.11.2026 (שלב F): o.notes – הערות על עובדים (S.enotes, emp-notes.js), רק לשאלה בצ'אט ורק כשלמנהל יש הרשאה למידע רגיש (X.st.sens); לא למראה.
     60 האחרונות (לפי תאריך ההערה ואז זמן הרישום), עד 500 תווים להערה: [שם העובד, תאריך, טקסט]. השרת מקבל אותן רק עם ההרשאה, והתור שקורא אותן נשמר מוצפן */
  if(o.notes&&Array.isArray(S.enotes)){const nm=id=>{const s=typeof subById==='function'?subById(id):null;return s?String(s.name||'').slice(0,60).trim():''};
   f.notes=S.enotes.filter(n=>n&&typeof n.t==='string'&&n.t.trim()&&nm(n.sub)).sort((a,b)=>String(b.d||'').localeCompare(String(a.d||''))||String(b.at||'').localeCompare(String(a.at||''))).slice(0,60)
    .map(n=>[nm(n.sub),/^\d{4}-\d{2}-\d{2}$/.test(String(n.d||''))?n.d:'',n.t.trim().slice(0,500)])}
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
+'.secwarn{border-color:var(--acc)!important}'
/* 15.11.2026: "כותבת" בולט ומונפש – המילה נכתבת שוב ושוב, שלוש נקודות קופצות והבועה פועמת */
+'.sectyp{display:flex;align-items:center;gap:10px;font-weight:800;font-size:1.05rem;color:var(--acc);border-width:2px;white-space:normal;animation:secPulse 1.6s ease-in-out infinite}'
+'.sectypt{display:inline-block;animation:secTw 1.8s steps(7,end) infinite}.sectypd{display:inline-flex;gap:5px}.sectypd i{display:block;width:9px;height:9px;border-radius:50%;background:var(--acc);animation:secDot 1s ease-in-out infinite}.sectypd i:nth-child(2){animation-delay:.15s}.sectypd i:nth-child(3){animation-delay:.3s}'
+'@keyframes secDot{0%,80%,100%{transform:translateY(0);opacity:.35}40%{transform:translateY(-7px);opacity:1}}'
+'@keyframes secTw{0%{clip-path:inset(0 0 0 100%)}65%,100%{clip-path:inset(0 0 0 0)}}'
+'@keyframes secPulse{0%,100%{box-shadow:0 0 0 0 color-mix(in srgb,var(--acc) 40%,transparent)}50%{box-shadow:0 0 0 7px color-mix(in srgb,var(--acc) 0%,transparent)}}'
+'@media(prefers-reduced-motion:reduce){.sectyp,.sectypt,.sectypd i{animation:none!important;clip-path:none!important}}';
document.head.appendChild(css2);
const QS=['מה קרה היום?','תזרים לחודש','חשבוניות לתשלום השבוע'];
/* 22.11.2026: קיצורי משימות (מנהל, תוספת משימות פעילה) – מטופלים בתוך האפליקציה (cxTry), בלי AI */
const QT=['משימה חדשה לעובד','מה באיחור?','ממתין לאישור'];const qsL=()=>{try{return cxOn()?QS.concat(QT):QS}catch(e){return QS}};
const SCR={due:'due',cf:'cf',tasks:'tk',zc:'zc',facts:'@facts',cal:'@cal',bank:'@bank'};/* @ = לשונית בתוך מסך המזכירה (שלב 3) */
const fmtAt=t=>{if(!t)return '';const d=new Date(t);return d.toLocaleDateString('he-IL',{day:'numeric',month:'numeric'})+' '+d.toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'})};
/* 13.11.2026: סימני עיצוב שהמודל מוסיף (Markdown) – מוצגים כעיצוב ולא ככוכביות. רץ על טקסט שכבר עבר esc, ומוסיף רק <b> */
const mdLite=t=>t.split('\n').map(l=>{if(/^\s*([-*_])(\s*\1){2,}\s*$/.test(l))return null;const h=/^\s*#{1,6}\s+(.*)$/.exec(l);if(h)return '<b>'+h[1].replace(/\*\*/g,'')+'</b>';return l.replace(/^(\s*)[-*•]\s+/,'$1• ')}).filter(l=>l!==null).join('\n').replace(/\*\*([^*\n]+?)\*\*/g,'<b>$1</b>').replace(/__([^_\n]+?)__/g,'<b>$1</b>').replace(/\n{3,}/g,'\n\n').replace(/^\n+|\n+$/g,'');
function bub(m,i){if(m.role!=='a')return `<div class="secmsg u">${m.via==='voice'?'🎤 ':m.via==='image'?'📷 ':m.via==='video'?'🎬 ':''}${esc(m.text)}</div>`;
 const tx=mdLite(esc(m.text)).replace(/\[(\d{1,2})\]/g,'<sup>$1</sup>');
 const src=(m.src||[]).map((s,k)=>`<li><b>${k+1}.</b> לפי ${esc(s.l||'')}${s.at?', נכון ל-'+esc(fmtAt(s.at)):''}${SCR[s.s]&&(SCR[s.s][0]==='@'||V[SCR[s.s]])?` <button class="chip" data-a="secGo" data-v="${SCR[s.s]}" style="min-height:32px">למסך</button>`:''}</li>`).join('');
 const ideas=(m.ideas||[]).filter(x=>!(X.nr||{})[x.key]).map(x=>`<div class="card" style="margin:6px 0 0;padding:8px"><small>${esc(x.seen||'')}</small><button class="chip" data-a="secNr" data-k="${esc(x.key)}" style="min-height:40px;margin-top:4px">לא רלוונטי – לא להציע 90 יום</button></div>`).join('');
 const th=m.th&&X.st&&X.st.cfTh!=null?`<div class="card" style="margin:6px 0 0;padding:8px"><small><b>אושר ✓</b> סף התראת תזרים: ${esc(Number(X.st.cfTh).toLocaleString('he-IL'))} ₪</small></div>`:m.th&&X.st&&X.st.cfTh==null?`<div class="card" style="margin:6px 0 0;padding:8px"><small>סף מוצע להתראת תזרים: ${esc(Number(m.th).toLocaleString('he-IL'))} ₪</small><div class="row" style="margin-top:4px"><button class="chip" data-a="secTh" data-v="${esc(String(m.th))}" style="min-height:40px">לאשר את הסף</button><button class="chip" data-a="secThEd" style="min-height:40px">סף אחר</button></div></div>`:'';
 const cards=(m.cards||[]).map(c=>cardH(c,m.id)).join('');
 return `<div class="secmsg a${m.stale?' secwarn':''}">${tx}${cards}${src?`<details class="secsrc"><summary>מקורות (${(m.src||[]).length})</summary><ol style="margin:4px 0;padding-inline-start:18px;list-style:none">${src}</ol></details>`:''}${ideas}${th}${m.id?`<div class="secrow">${mrBtnH('chat',m.id)}</div>`:''}</div>`}
function chatH(S){const pct=Number.isFinite(S.pct)?S.pct:null,fin=!!secFinOk();
 const bar=`<div class="secbar" id="secBar"><span>${fin?'נתוני הכספים: מהמכשיר, נכונים ל-'+esc(fmtAt(Date.now())):S.mirror===false?'מראה הכספים כבוי':S.mirrorAt?'נתוני הכספים נכונים ל-'+esc(fmtAt(S.mirrorAt)):'אין נתוני כספים במכשיר הזה'}</span>${pct!=null?`<span id="secPct">ניצול החודש: <bdi dir="ltr">${pct}%</bdi></span>`:''}<button class="chip" data-a="secSet" style="min-height:36px;margin-inline-start:auto">הגדרות</button></div>`;
 const warn=S.saving?`<div class="card secwarn" id="secSaving"><small>${S.saving==='day'?'הגעתם לתקרת השימוש היומית – אפשר להמשיך מחר.':'הגעתם לתקרת השימוש החודשית – המזכירה במצב חיסכון עד תחילת החודש או הגדלת התקרה.'}</small></div>`:pct>=80?`<div class="card secwarn"><small>ניצלתם ${pct}% מתקרת השימוש החודשית.</small></div>`:'';
 const hi=S.call?`שלום ${esc(S.call)}! `:'שלום! ';
 const L=X.msgs||[];
 const body=X.mb&&!L.length?'<div class="empty">טוען…</div>':(L.length?L.map(bub).join(''):`<div class="secmsg a">${hi}אני ${esc(S.name)}. אפשר לשאול אותי על הכספים, הספקים, העובדים, המשימות וההזמנות של העסק, על היומן, על כל שאלה בניהול העסק – וגם איך עושים משהו באפליקציה או מה לעשות כשמשהו לא עובד.</div>`)+(X.msgErr?`<p class="note">${esc(X.msgErr)}</p>`:'');
 const busy=X.sending||X.mst?`<div class="secmsg a sectyp" id="secWait" role="status" aria-live="polite"><span class="sectypt">${X.mst?esc(String(X.mst).replace(/…$/,'')):X.deep?'חושבת לעומק':'כותבת'}</span><span class="sectypd" aria-hidden="true"><i></i><i></i><i></i></span></div>`:'';
 return bar+warn+`<div id="secChat">${body}${busy}</div>
 <div class="chips" style="margin:10px 0 6px">${qsL().map(q=>`<button class="chip" data-a="secQ" data-v="${esc(q)}" style="min-height:40px">${esc(q)}</button>`).join('')}</div>
 <form data-f="secAskF" id="secForm"><textarea class="secin" name="q" maxlength="2000" placeholder="כתבו שאלה על העסק…" aria-label="שאלה למזכירה"${typeof RC!=='undefined'&&RC.live&&RC.tgt==='chat'?' readonly':''}>${esc(X.draft||'')}</textarea>
 ${mediaH()}
 <div class="row" style="margin-top:8px"><button class="btn grow" name="go" value="n"${X.sending?' disabled':''}>שליחה</button><button class="btn g grow" name="go" value="d"${X.sending?' disabled':''} title="מודל איכותי – עולה יותר בתקרה">חשבי לעומק</button></div></form>
 <p class="note" style="margin:6px 0 0">כל מספר מגיע עם מקור. מספר שלא נמצא בנתונים מסומן "לא אומת". המזכירה עלולה לטעות – לפני החלטה כספית, משפטית או לגבי עובד כדאי לבדוק עם איש מקצוע.</p>`}
const secFinOk=()=>{try{return typeof S!=='undefined'&&S&&Array.isArray(S.tx)&&S.tx.length&&!brMineIds()}catch(e){return false}};
function setH(S){return `<div class="card"><b>מראה הכספים בענן</b><p class="note" style="margin:4px 0 8px">עותק מסכם של נתוני הכספים, לתזכורות ולדוחות כשהאפליקציה סגורה. כשהוא כבוי – תזכורות כספים ודוחות לא יפעלו.</p>
 <label class="chip" style="min-height:44px;width:100%;justify-content:flex-start"><input type="checkbox" data-c="secMir"${S.mirror!==false?' checked':''}> פעיל${S.mirrorAt?' · עודכן '+esc(fmtAt(S.mirrorAt)):''}</label></div>
 <div class="card" style="margin-top:8px"><b>סף התראת תזרים</b><p class="note" style="margin:4px 0 8px">${S.cfTh!=null?'הסף שאישרת: '+esc(Number(S.cfTh).toLocaleString('he-IL'))+' ₪':'עדיין לא נקבע. המזכירה תציע סף כשתשאלו על התזרים.'}</p><button class="chip" data-a="secThEd" style="min-height:40px">${S.cfTh!=null?'שינוי':'קביעת סף'}</button></div>
 <div class="card" style="margin-top:8px"><b>פגישה בשישי, בשבת או בחג</b><p class="note" style="margin:4px 0 8px">מה לעשות כשאירוע נקבע ליום שאינו יום עסקים.</p><div class="chips" role="radiogroup"><label class="chip" style="min-height:44px"><input type="radio" name="secWe" data-c="secWe" value="warn"${S.we!=='accept'?' checked':''}> להזהיר ולהציע יום אחר</label><label class="chip" style="min-height:44px"><input type="radio" name="secWe" data-c="secWe" value="accept"${S.we==='accept'?' checked':''}> לקבל בלי הערה</label></div></div>
 ${mrSetH()}
 ${waSetH()}
 ${mailSetH()}
 ${gSetH()}
 ${ntH(S)}
 <button class="btn g w" data-a="secEdit" style="margin-top:10px">שינוי שם ואופן פנייה</button><button class="btn g w" data-a="secSetX" style="margin-top:8px">חזרה לשיחה</button>
 <div class="sec"><h3>יומן פעולות</h3></div>${logH()}`}
ACT.secSet=()=>{X.set=1;rerender()};
CHG.secWe=async el=>{const v=el.value;try{await fnCall('secPrefs',{op:'calWe',v});X.st.we=v;toast('נשמר')}catch(e){err(e);rerender()}};
ACT.secSetX=()=>{X.set=0;rerender()};
ACT.secGo=el=>{const v=el.dataset.v;if(v[0]==='@'){X.tab=v.slice(1);X.fl=X.cl=X.rl=null;rerender();return}if(V[v])go(v)};
ACT.secQ=el=>{const f=document.getElementById('secForm');if(f){f.q.value=el.dataset.v;ask2(el.dataset.v,false)}};
FRM.secAskF=(f,ev)=>{if(RC.on&&RC.tgt==='chat')return toast('קודם עצרו את ההקלטה');const sub=ev&&ev.submitter;ask2(String(f.q.value||''),!!(sub&&sub.value==='d'),X.vdr?'voice':undefined)};
CHG.secMir=async el=>{const on=!!el.checked;el.disabled=true;try{await fnCall('secPrefs',{op:'mirror',on});X.st.mirror=on;toast(on?'המראה פעיל':'המראה כבוי – תזכורות כספים ודוחות לא יפעלו');if(on){MR.h='';mirSched()}}catch(e){el.checked=!on;err(e)}finally{el.disabled=false;rerender()}};
ACT.secNr=async el=>{const k=el.dataset.k;try{await fnCall('secPrefs',{op:'notRelevant',key:k});X.nr=Object.assign({},X.nr,{[k]:1});toast('לא אציע את זה שוב ב-90 הימים הקרובים');rerender()}catch(e){err(e)}};
async function thSave(a){try{await fnCall('secPrefs',{op:'threshold',amount:a});X.st.cfTh=a;toast(a==null?'הסף נמחק':'הסף נשמר');rerender()}catch(e){err(e)}}
ACT.secTh=el=>{const a=Math.round(+el.dataset.v);if(a>=0)thSave(a)};
ACT.secThEd=()=>{dlg(`<h3>סף התראת תזרים</h3><form data-f="secThF"><label class="f"><span>התראה כשהיתרה הצפויה נמוכה מ- (₪)</span><input class="amt" name="a" inputmode="numeric" dir="ltr" maxlength="9" value="${X.st.cfTh!=null?esc(String(X.st.cfTh)):''}"></label><div class="row"><button class="btn grow">שמירה</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`)};
FRM.secThF=f=>{const v=String(f.a.value||'').replace(/[,\s₪]/g,'');if(v===''){closeDlg();return thSave(null)}if(!/^\d{1,9}$/.test(v))return toast('סכום לא תקין');closeDlg();thSave(+v)};
const scrollEnd=()=>setTimeout(()=>{const f=document.getElementById('secForm');if(f&&f.scrollIntoView)f.scrollIntoView({block:'end'})},30);
// 13.11.2026: קוד הסיבה כשספק ה-AI נכשל (reason מ-functions/lib/sec-ai.js), כדי שיהיה אפשר לאבחן מהמסך
const AIR={'ai-quota':'נגמרה המכסה או אין חיוב פעיל בחשבון ה-AI','ai-rejected':'שירות ה-AI דחה את הבקשה – מפתח או מודל לא תקינים','ai-model':'מודל ה-AI לא נמצא בשירות','ai-overloaded':'עומס זמני בשירות ה-AI','ai-timeout':'שירות ה-AI לא ענה בזמן','ai-network':'אין חיבור מהשרת לשירות ה-AI','ai-error':'שגיאה לא מוכרת בשירות ה-AI'};
async function ask2(q,deep,via){q=q.replace(/\s+$/,'');if(!q.trim()||X.sending)return;if(q.length>2000)return toast('השאלה ארוכה מדי (עד 2,000 תווים)');
 /* 22.11.2026: פקודת משימה מזוהה – מטופלת כאן בלי AI (sec-cmd.js). לא מזוהה – הזרימה לשרת כמו קודם */
 try{if(await cxTry(q,via))return}catch(e){X.sending=0}
 X.msgs=X.msgs||[];X.msgs.push({role:'u',text:q,via:via==='voice'?'voice':undefined,t:Date.now()});X.sending=1;X.deep=deep;X.draft='';X.vdr=0;rerender();scrollEnd();
 try{const fin=secFin({pay:!!X.st.pay,rec:true,notes:X.st.sens===true});const d={text:q,deep};if(via==='voice')d.via='voice';if(fin)d.fin=fin;/* 15.11.2026: לשאלות על תקלות – גרסה ומצב חיבור בלבד */try{const vc=typeof APP_VC!=='undefined'?String(APP_VC):'';d.app={on:navigator.onLine!==false};if(/^\d{1,7}$/.test(vc))d.app.v=vc}catch(e){}
  const r=await fnCall('secChat',d);
  X.msgs.push({role:'a',id:r.id||'',text:r.reply,src:r.src||[],ideas:r.ideas||[],th:r.th||null,cards:r.cards||[],stale:!!r.stale,mode:r.mode,t:Date.now()});if((r.cards||[]).length){X.fl=null;X.cl=null;eyStale()}
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
function tabsH(){const t=X.tab||'chat';return `<div class="sectabs" role="tablist" id="secTabs">${TABS.map(([k,l])=>`<button class="chip${t===k?' on':''}" role="tab" aria-selected="${t===k}" data-a="secTab" data-v="${k}">${l}${k==='facts'&&X.facts&&X.facts.pend?` (${X.facts.pend})`:''}${k==='eyes'&&X.ey&&!X.ey.err&&(X.ey.openN||(X.ey.open||[]).length)?` <span class="secbadge">${X.ey.openN||X.ey.open.length}</span>`:''}${k==='notes'&&unseenN()?` <span class="secbadge">${unseenN()}</span>`:''}${k==='wa'&&typeof waN==='function'&&waN()?` <span class="secbadge">${waN()}</span>`:''}</button>`).join('')}</div>`}
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
/* SEC:10: כרטיס שהוכרע – "אושר ✓" / "בוטל" בלי כפתורים, גם אחרי טעינה מחדש (המצב נשמר בהודעה בשרת: c.st) */
const CST={ok:'אושר ✓',no:'בוטל',gone:'כבר טופל'};
function cardSum(c){if(c.k==='cal')return (c.rem?'תזכורת: ':'')+c.title+' · '+wkD(c.okD||c.d)+' '+dShort(c.okD||c.d)+(c.tm?' '+c.tm:'');if(c.k==='fact')return c.text||'';if(c.k==='route')return rtL(c);if(c.k==='scan')return SCL[c.doc]||'מסמך';if(c.k==='task')return c.txt||'';return ''}
function cardDone(c){const d=X.done[c.id]||(c.st?{st:c.st}:null);if(!d)return '';const st=CST[d.st]?d.st:'gone';
 const det=st==='ok'?(c.k==='fact'?'נשמר במידע על העסק.':c.k==='cal'?(c.rem?'התזכורת נקבעה – תופיע ב"מול העיניים" ותישלח התראה בזמן.':'נקבע ביומן'+(c.okD&&c.okD!==c.d?' ל-'+dShort(c.okD):'')+'.'):c.k==='route'?'הכלל נשמר ב"הכללים שלי".':c.k==='scan'?'נפתח מסך הסריקה.':c.k==='task'?'המשימה נפתחה.':''):st==='no'?(c.k==='fact'?'לא נשמר.':c.k==='cal'?'לא נקבע.':'לא נשמר כלל.'):'';
 return `<div class="card secdone" style="margin:6px 0 0;padding:8px" data-card="${esc(c.id)}" data-st="${st}"><b>${CST[st]}</b> <small class="note">${esc(cardSum(c))}</small>${det?`<small class="note" style="display:block">${esc(det)}</small>`:''}</div>`}
function cardH(c,mid){if(c.loc)return cxCardH(c,mid);if(X.done[c.id]||c.st)return cardDone(c);
 if(c.k==='route')return `<div class="card" style="margin:6px 0 0;padding:8px" data-card="${esc(c.id)}"><b>כלל ניתוב</b><p style="margin:4px 0">${esc(rtL(c))}</p><div class="secrow"><button class="chip" data-a="secRtOk" data-mid="${esc(mid||'')}" data-id="${esc(c.id)}">אשר</button><button class="chip" data-a="secRtNo" data-mid="${esc(mid||'')}" data-id="${esc(c.id)}">בטל</button></div></div>`;
 if(c.k==='fact'){const cf=(c.conflict||[]).map(x=>`<li>${esc(x.text)}</li>`).join('');
  return `<div class="card" style="margin:6px 0 0;padding:8px" data-card="${esc(c.id)}"><b>לשמור במידע על העסק?</b><p style="margin:4px 0">${esc(c.text)}${c.exp?` <span class="sectags">עד ${esc(dShort(c.exp))}</span>`:''}</p>
  ${cf?`<p class="note" style="margin:4px 0">זה נראה סותר את מה שכבר שמור:</p><ul style="margin:0 0 4px;padding-inline-start:18px">${cf}</ul><p class="note" style="margin:0">איזו נכונה?</p><div class="secrow"><button class="chip" data-a="secFOk" data-id="${esc(c.id)}" data-rp="${esc((c.conflict||[]).map(x=>x.id).join(','))}">החדשה נכונה</button><button class="chip" data-a="secFNo" data-id="${esc(c.id)}">הקיימת נכונה</button><button class="chip" data-a="secFOk" data-id="${esc(c.id)}" data-both="1">שתיהן נכונות</button></div>`
  :`<div class="secrow"><button class="chip" data-a="secFOk" data-id="${esc(c.id)}">אשר ושמור</button><button class="chip" data-a="secFNo" data-id="${esc(c.id)}">בטל</button></div>`}</div>`}
 if(c.k==='cal'){const w=c.warn;
  return `<div class="card" style="margin:6px 0 0;padding:8px" data-card="${esc(c.id)}"><b>${c.rem?'לקבוע תזכורת?':'לקבוע ביומן?'}</b><p style="margin:4px 0">${esc(c.title)} · ${esc(wkD(c.d))} ${esc(dShort(c.d))}${c.tm?' · <bdi dir="ltr">'+esc(c.tm)+'</bdi>':''} <span class="sectags">${c.to==='biz'?'של העסק':'אישי'}</span></p>
  ${w?`<p class="note" style="margin:4px 0">התאריך נופל ב${esc(w.kind)}. להשאיר או להעביר ל${esc(wkD(w.next))} ${esc(dShort(w.next))}?</p><div class="secrow"><button class="chip" data-a="secCOk" data-id="${esc(c.id)}" data-d="${esc(w.next)}">להעביר ל-${esc(dShort(w.next))}</button><button class="chip" data-a="secCOk" data-id="${esc(c.id)}" data-force="1">להשאיר</button><button class="chip" data-a="secCNo" data-id="${esc(c.id)}">בטל</button></div>`
  :`<div class="secrow"><button class="chip" data-a="secCOk" data-id="${esc(c.id)}">אשר</button><button class="chip" data-a="secCNo" data-id="${esc(c.id)}">בטל</button></div>`}</div>`}
 if(c.k==='scan'||c.k==='task'){const t=c.k==='scan';
  return `<div class="card" style="margin:6px 0 0;padding:8px" data-card="${esc(c.id)}"><b>${t?'להעביר לסריקה?':'לפתוח משימה?'}</b><p style="margin:4px 0">${t?esc(SCL[c.doc]||'מסמך'):esc(c.txt||'')}</p><div class="secrow"><button class="chip" data-a="${t?'secScOk':'secTkOk'}" data-mid="${esc(mid||'')}" data-id="${esc(c.id)}">${t?'פתח את מסך הסריקה':'פתח משימה'}</button><button class="chip" data-a="secScNo" data-mid="${esc(mid||'')}" data-id="${esc(c.id)}">בטל</button></div></div>`}
 return ''}
/* SEC:10: מצב הכרטיס – גם על הכרטיס עצמו (בשיחה הנוכחית וב"צ'אט קודם"), ו"מול העיניים" מתרענן */
const allCards=()=>(X.msgs||[]).concat(X.pc&&X.pc.L||[]).flatMap(m=>m.cards||[]);
const doneSt=(id,st,o)=>{X.done[id]={st};allCards().filter(c=>c.id===id).forEach(c=>{c.st=st;if(o&&o.d)c.okD=o.d});X.fl=null;X.cl=null;eyStale();rerender()};
const notPend=e=>e&&e.reason==='not-pending'||e&&e.reason==='not-found';
ACT.secFOk=async el=>{const id=el.dataset.id,d={op:'approve',id};if(el.dataset.rp){d.force=true;d.replace=el.dataset.rp.split(',').filter(Boolean)}if(el.dataset.both)d.force=true;el.disabled=true;
 try{const r=await fnCall('secFacts',d);if(r&&r.ok===false&&r.conflict){/* סתירה שנוצרה אחרי ההצעה – שואלים */const c=allCards().find(x=>x.id===id);if(c){c.conflict=r.conflict;rerender()}return}doneSt(id,'ok')}
 catch(e){if(notPend(e))doneSt(id,'gone');else{el.disabled=false;err(e)}}};
ACT.secFNo=async el=>{const id=el.dataset.id;el.disabled=true;try{await fnCall('secFacts',{op:'reject',id});doneSt(id,'no')}catch(e){if(notPend(e))doneSt(id,'gone');else{el.disabled=false;err(e)}}};
ACT.secCOk=async el=>{const id=el.dataset.id,d={op:'approve',id};if(el.dataset.d)d.d=el.dataset.d;if(el.dataset.force)d.force=true;el.disabled=true;
 try{const r=await fnCall('secCal',d);if(r&&r.ok===false&&r.warn){const c=allCards().find(x=>x.id===id);if(c){c.warn=r.warn;rerender()}else toast('התאריך נופל ב'+r.warn.kind);return}doneSt(id,'ok',{d:d.d})}
 catch(e){if(notPend(e))doneSt(id,'gone');else{el.disabled=false;err(e)}}};
ACT.secCNo=async el=>{const id=el.dataset.id;el.disabled=true;try{await fnCall('secCal',{op:'reject',id});doneSt(id,'no')}catch(e){if(notPend(e))doneSt(id,'gone');else{el.disabled=false;err(e)}}};

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
/* 15.11.2026: לוח שנה חודשי (ברירת המחדל) – יום עם אירוע/תזכורת מסומן, לחיצה על יום מציגה את מה שבו */
const ymd=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
function monH(R,td){const E=(R.events||[]).filter(e=>e.st==='ok'),m=X.cm||td.slice(0,7),sel=X.cd&&X.cd.slice(0,7)===m?X.cd:(m===td.slice(0,7)?td:m+'-01');
 const[y,mm]=m.split('-').map(Number),first=new Date(y,mm-1,1,12),n=new Date(y,mm,0).getDate(),by={};E.forEach(e=>{(by[e.d]=by[e.d]||[]).push(e)});
 let cells='';for(let i=0;i<first.getDay();i++)cells+='<span></span>';
 for(let k=1;k<=n;k++){const d=m+'-'+String(k).padStart(2,'0'),L=by[d]||[];cells+=`<button type="button" class="seccd${d===td?' td':''}${d===sel?' sel':''}${isOff(d)?' off':''}${d<td?' past':''}" data-a="secCd" data-v="${d}" aria-label="${esc(wkD(d)+' '+dShort(d))}${L.length?', '+L.length+(L.length===1?' אירוע':' אירועים'):''}"><b>${k}</b>${L.length?`<i>${L.length>1?L.length:''}</i>`:'<i class="z"></i>'}</button>`}
 const L=(by[sel]||[]).slice().sort((a,b)=>(a.tm||'').localeCompare(b.tm||''));
 return `<div class="card seccal" id="secMon"><div class="seccalh"><button class="chip" data-a="secCm" data-v="-1" aria-label="החודש הקודם">›</button><b>${esc(first.toLocaleDateString('he-IL',{month:'long',year:'numeric'}))}</b><button class="chip" data-a="secCm" data-v="1" aria-label="החודש הבא">‹</button></div>
 <div class="seccalg">${['א','ב','ג','ד','ה','ו','ש'].map(c=>`<span class="wd">${c}</span>`).join('')}${cells}</div>
 ${sel!==td?`<button class="chip" data-a="secCd" data-v="${td}" style="margin-top:8px">חזרה להיום</button>`:''}</div>
 <div class="card" style="margin-top:8px" id="secMonDay"><div class="secday">${esc(wkD(sel))} ${esc(dShort(sel))}<small class="note">${esc(hebD(sel))}${isOff(sel)?' · יום לא עסקים':''}</small></div>${L.length?L.map(evH).join(''):'<p class="note" style="margin:0">אין אירועים או תזכורות ביום הזה</p>'}${sel>=td?`<button class="chip" data-a="secEvAdd" data-d="${sel}" style="margin-top:8px">+ אירוע או תזכורת ביום הזה</button>`:''}</div>`}
ACT.secCd=el=>{X.cd=el.dataset.v;X.cm=X.cd.slice(0,7);rerender()};
ACT.secCm=el=>{const[y,m]=(X.cm||todayS().slice(0,7)).split('-').map(Number);X.cm=ymd(new Date(y,m-1+(+el.dataset.v||0),1,12)).slice(0,7);X.cd='';rerender()};
const css3c=document.createElement('style');
css3c.textContent='.seccalh{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}.seccalh b{font-size:1.15rem}.seccalh .chip{min-width:48px;justify-content:center;font-size:1.3rem}'
+'.seccalg{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}.seccalg .wd{text-align:center;font-size:.8rem;font-weight:700;opacity:.7;padding:2px 0}'
+'.seccd{min-height:48px;padding:2px 0;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--ink);font:inherit;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;cursor:pointer}'
+'.seccd b{font-size:1rem}.seccd.off{background:color-mix(in srgb,var(--acc) 8%,var(--card))}.seccd.past{opacity:.55}.seccd.td{border:2px solid var(--acc)}.seccd.td b{color:var(--acc)}'
+'.seccd i{display:block;min-width:9px;height:9px;padding:0 3px;border-radius:9px;background:var(--acc);color:var(--onacc,#fff);font-style:normal;font-size:.62rem;line-height:9px;font-weight:800;box-sizing:border-box}.seccd i.z{visibility:hidden}'
+'.seccd.sel{background:var(--acc);border-color:var(--acc);opacity:1}.seccd.sel b{color:var(--onacc,#fff)}.seccd.sel i{background:var(--onacc,#fff);color:var(--acc)}';
document.head.appendChild(css3c);
function calH(){const R=X.cl;if(!R){if(!X.cb)calLoad();return '<div class="empty">טוען…</div>'}if(R.err)return `<div class="card"><p class="note">${esc(R.err)}</p><button class="btn g w" data-a="secTab" data-v="cal">נסה שוב</button></div>`;
 const td=R.today||todayS(),E=R.events||[],pend=E.filter(e=>e.st==='prop'),ok=E.filter(e=>e.st==='ok'&&e.d>=td),view=X.cv||'month';
 let h=`<div class="secrow" style="margin:0 0 8px"><button class="btn" data-a="secEvAdd" style="flex:1">+ אירוע</button><button class="chip${view==='month'?' on':''}" data-a="secCv" data-v="month">חודש</button><button class="chip${view==='list'?' on':''}" data-a="secCv" data-v="list">רשימה</button><button class="chip${view==='week'?' on':''}" data-a="secCv" data-v="week">שבוע</button></div>`;
 if(view==='month'){if(pend.length)h+=`<div class="card secwarn" style="margin-bottom:8px"><b>המזכירה הציעה (${pend.length})</b>${pend.map(e=>cardH({k:'cal',id:e.id,title:e.title,d:e.d,tm:e.tm,to:e.to,rem:e.rem,warn:e.off&&R.we!=='accept'?{kind:e.off,next:nextBiz(e.d)}:null})).join('')}</div>`;return h+monH(R,td)}
 const soon=ok.slice(0,3);h+=`<div class="card" id="secSoon"><b>קרוב</b>${soon.length?soon.map(e=>`<div class="note" style="margin-top:4px">${esc(dShort(e.d))}${e.tm?' <bdi dir="ltr">'+esc(e.tm)+'</bdi>':''} – ${esc(e.title)}</div>`).join(''):'<p class="note" style="margin:4px 0 0">אין אירועים קרובים</p>'}</div>`;
 if(pend.length)h+=`<div class="card secwarn" style="margin-top:8px"><b>המזכירה הציעה (${pend.length})</b>${pend.map(e=>cardH({k:'cal',id:e.id,title:e.title,d:e.d,tm:e.tm,to:e.to,rem:e.rem,warn:e.off&&R.we!=='accept'?{kind:e.off,next:nextBiz(e.d)}:null})).join('')}</div>`;
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
ACT.secEvAdd=el=>{const d=el&&el.dataset&&el.dataset.d;dlg(evForm(d?{d}:undefined))};
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
 <div class="card">${L.length?L.map(r=>`<div class="secli"><p><b>${esc(r.q.join(' / '))}</b>${r.on?'':' <span class="sectags">כבויה</span>'}${r.src==='import'?' <span class="sectags">ייבוא</span>':''}${r.auto?(r.autoOff?' <span class="sectags w">אוטומטי – כבוי</span>':' <span class="sectags g">אוטומטי</span>'):''}${r.ch==='mail'?' <span class="sectags">מייל</span>':r.ch==='wa'?' <span class="sectags">ווצאפ</span>':''}</p><p>${esc(r.a)}</p>${r.auto&&r.autoOff&&r.offWhy?`<small class="note" style="color:var(--bad)">נכבה אוטומטית: ${esc(r.offWhy)}</small>`:''}${r.auto&&(r.facts||[]).length?`<small class="note">מקור הנתונים בבנק המידע: ${r.facts.map(esc).join(', ')}</small>`:''}${r.auto&&r.n?`<small class="note">נשלחה אוטומטית ${esc(String(r.n))} פעמים</small>`:''}${r.cond?`<small class="note">תנאים: ${esc(r.cond)}</small>`:''}<div class="secrow"><button class="chip" data-a="secREd" data-id="${esc(r.id)}">ערוך</button><button class="chip" data-a="secRDel" data-id="${esc(r.id)}">מחק</button></div></div>`).join(''):'<p class="note" style="margin:0">אין עדיין תשובות מוכנות</p>'}</div>`}
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
 const A=c.admins||[],dollars=c.capCents==null?'':String(Math.round(c.capCents/100)),md=mdOf(c.media);
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
 <b style="display:block;margin-top:10px">5. קול, תמונה וסרטון בצ'אט</b><div class="row"><label class="f grow"><span>הקלטה קולית (שניות, 0 = כבוי)</span><input name="ma" inputmode="numeric" dir="ltr" maxlength="3" value="${esc(String(md.aud))}"></label><label class="f grow"><span>סרטון (שניות, 0 = כבוי)</span><input name="mv" inputmode="numeric" dir="ltr" maxlength="2" value="${esc(String(md.vid))}"></label></div>
 <label class="chip" style="min-height:44px;margin:4px 0;width:100%;justify-content:flex-start"><input type="checkbox" name="mi" value="1"${md.img?' checked':''}> שליחת תמונות פעילה</label><small class="note">קול עד 300 שניות, סרטון עד 60. ברירת מחדל: קול ${MDEF.aud}, סרטון ${MDEF.vid}, תמונות פעילות.</small>
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
 {const ma=String(x.ma==null?'':x.ma).trim(),mv=String(x.mv==null?'':x.mv).trim(),m0=mdOf(c.media);
  if(!/^\d{1,3}$/.test(ma)||+ma>300)return toast('הקלטה קולית: 0 עד 300 שניות');if(!/^\d{1,2}$/.test(mv)||+mv>60)return toast('סרטון: 0 עד 60 שניות');
  const mm={aud:+ma,img:x.mi==='1',vid:+mv};if(mm.aud!==m0.aud||mm.img!==m0.img||mm.vid!==m0.vid||c.mediaSet)data.media=mm}
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
+'.secnt select,.secnt input[type=time]{min-height:40px;max-width:100%}.secnt .row{flex-wrap:wrap}'
+'.secnb{display:block;width:100%;padding:0;margin:0;border:0;background:none;color:inherit;font:inherit;text-align:start;cursor:pointer}.secclamp{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}';
document.head.appendChild(css4);
const WDN=['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
/* ---------- התראות ---------- */
async function notesLoad(){X.nb=1;const s0=X.nl;let again=0;try{const r=await fnCall('secNotes',{op:'list'});if(s0&&X.nl===null){again=1;return}X.nl=r;const ids=(r.notes||[]).filter(n=>!n.seen).map(n=>n.id).slice(0,100);
 if(ids.length)fnCall('secNotes',{op:'seen',ids}).then(()=>{if(X.st)X.st.unseen=0;if(X.nl)X.nl.unseen=0}).catch(()=>{})}
 catch(e){X.nl=X.nl&&!X.nl.err?X.nl:{err:e&&e.message||'לא נטען'}}finally{X.nb=0;if(again){notesLoad();return}if(cur().v==='sec'&&!typing())rerender()}}
const KIND={rep:'דוח',emp:'עובד',dig:'תקציר',wa:'ווצאפ'};
/* 15.11.2026: התראות ישנות של סגירת קופה נשמרו עם מזהה הקופה (i_nl) ותאריך בכתיב מחשב – בתצוגה: שם הסניף (ZREG) ויום בשבוע + תאריך */
const ZN=g=>{try{return typeof ZREG!=='undefined'&&ZREG[g]?ZREG[g].n:''}catch(e){return ''}};
const dayL=d=>{const t=new Date(d+'T12:00:00Z');return isNaN(t)?d:'יום '+WDN[t.getUTCDay()]+' '+(+d.slice(8,10))+'.'+(+d.slice(5,7))};
const nFix=(s,n)=>{s=String(s||'').replace(/(קופה )?\b(i_[a-z]{2})\b/g,(m,a,g)=>ZN(g)?(typeof BZGEN!=='undefined'&&BZGEN?ZN(g):'סניף '+ZN(g)):m)/* עסק חדש: קופה אחת – "קופה" בלי "סניף" */;if(n&&n.typ==='close')s=s.replace(/\b(\d{4}-\d{2}-\d{2})\b/g,(m,d)=>dayL(d));if(n&&n.typ==='cal')s=calFix(s,n);return s};
/* 15.11.2026 (סעיף 7): תזכורת יומן – "2026-11-15 12:00" (התראות ישנות) או "יום ראשון 15.11, 12:00" (חדשות) → "היום 12:00" / "מחר 12:00" /
   "יום ראשון 15.11, 12:00", לפי היום בזמן הציור (שעון ישראל) */
const ilDay=ms=>{try{return new Date(ms).toLocaleDateString('en-CA',{timeZone:'Asia/Jerusalem'})}catch(e){return new Date(ms).toISOString().slice(0,10)}};
const dDiff=(a,b)=>Math.round((Date.parse(a+'T12:00:00Z')-Date.parse(b+'T12:00:00Z'))/864e5);
function calL(d,t){const k=dDiff(d,ilDay(Date.now()));return k===0||k===1||k===-1?['אתמול','היום','מחר'][k+1]+(t?' '+t:''):dayL(d)+(t?', '+t:'')}
function calFix(s,n){let m=/^(\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}))?/.exec(s);if(m)return calL(m[1],m[2]||'')+s.slice(m[0].length);
 m=/^יום [א-ת]+ (\d{1,2})\.(\d{1,2})(?:, (\d{2}:\d{2}))?/.exec(s);if(!m)return s;
 const a=ilDay(n.at||Date.now());let y=+a.slice(0,4);const iso=yy=>yy+'-'+String(m[2]).padStart(2,'0')+'-'+String(m[1]).padStart(2,'0');
 if(dDiff(iso(y),a)>180)y--;else if(dDiff(iso(y),a)<-180)y++;const d=iso(y);return isNaN(Date.parse(d+'T12:00:00Z'))?s:calL(d,m[3]||'')+s.slice(m[0].length)}
/* 15.11.2026 (סעיף 7): "תזכירי לי שוב" – בכרטיס (נפתח בלחיצה) ובחלון הפרטים. השרת קובע את הזמן ושולח שוב (גם לטלפון, גם בשעות השקטות) */
const SNZ=[['h1','שוב בעוד שעה'],['h3','בעוד 3 שעות'],['mo','מחר בבוקר'],['pick','לבחור מתי']];
const snzH=(id,d)=>`<div class="secrow secsnz" role="group" aria-label="תזכירי לי שוב">${SNZ.map(([v,l])=>`<button type="button" class="chip" data-a="secSnz" data-v="${v}" data-id="${esc(id)}"${d?' data-d="1"':''} style="min-height:44px">${l}</button>`).join('')}</div>`;
const snzCan=n=>n&&n.st!=='gone';
async function snzDo(id,o,el){if(el)el.disabled=true;
 try{const r=await fnCall('secNotes',Object.assign({op:'snooze',id},o));if(document.getElementById('dlg').open)closeDlg();X.snz='';toast('אזכיר לך שוב '+(r&&r.l||''));/* 19.11.2026: יוצאת מהרשימה עד שתחזור – בלי טעינה מחדש של כל הרשימה */{const L=X.nl&&!X.nl.err&&X.nl.notes;if(L)X.nl.notes=L.filter(x=>x.id!==id);else X.nl=null}try{eyStale()}catch(e){}rerender()}
 catch(e){if(el)el.disabled=false;err(e)}}
const dtl=ms=>{const d=new Date(ms),z=x=>String(x).padStart(2,'0');return d.getFullYear()+'-'+z(d.getMonth()+1)+'-'+z(d.getDate())+'T'+z(d.getHours())+':'+z(d.getMinutes())};
ACT.secSnz=el=>{const id=el.dataset.id,v=el.dataset.v;if(!id)return;
 if(v==='h1'||v==='h3')return snzDo(id,{at:Date.now()+(v==='h1'?1:3)*3600e3},el);
 if(v==='mo')return snzDo(id,{when:'morning'},el);
 const t0=Math.ceil((Date.now()+3600e3)/9e5)*9e5;
 dlg(`<h3>מתי להזכיר שוב?</h3><form data-f="secSnzF" data-id="${esc(id)}"><label class="f"><span>תאריך ושעה</span><input type="datetime-local" name="at" dir="ltr" required value="${dtl(t0)}" min="${dtl(Date.now()+60e3)}" max="${dtl(Date.now()+60*864e5)}" style="min-height:44px"></label>
 <p class="note" style="margin:4px 0 8px">ההתראה תחזור בזמן הזה, גם לטלפון – גם בשעות השקטות. עד 60 יום קדימה.</p>
 <div class="row"><button class="btn grow">קביעה</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`)};
ACT.secSnzT=el=>{const id=el.dataset.id;X.snz=X.snz===id?'':id;rerender()};
FRM.secSnzF=f=>{const id=f.dataset.id,at=new Date(String(f.at.value||'')).getTime();
 if(!Number.isFinite(at)||at<Date.now()+60e3||at>Date.now()+60*864e5)return toast('אפשר לבחור זמן מעכשיו ועד 60 יום קדימה');
 return snzDo(id,{at},f.querySelector('button:not([type=button])'))};
const nLab=(n,T)=>n.k==='rem'?(T[n.typ]||'תזכורת'):(KIND[n.k]||'');
function noteH(n,T){const lab=nLab(n,T);const open=n.st==='open'&&n.k==='rem';
 return `<div class="secli${n.seen?'':' secnew'}" style="padding-inline-start:8px"><button type="button" class="secnb" data-a="secNOpen" data-id="${esc(n.id)}" aria-label="כל הפרטים: ${esc(nFix(n.title,n))}"><p><b>${esc(nFix(n.title,n))}</b> <span class="sectags">${esc(lab)}</span>${n.st==='done'?'<span class="sectags">טופל</span>':n.st==='gone'?'<span class="sectags">כבר לא רלוונטי</span>':''}</p>
 <small class="note">${esc(tm(n.at))}${n.n>1?' · נשלחה '+n.n+' פעמים':''}</small>${n.body?`<p class="note secclamp" style="margin:4px 0 0">${esc(nFix(n.body,n))}</p>`:''}</button>
 <div class="secrow">${nClosed(n)?'':nActH(n,1)}<button class="chip" data-a="secNOpen" data-id="${esc(n.id)}">כל הפרטים</button>${mrBtnH('note',n.id)}${n.k==='rep'&&n.ref?`<button class="chip" data-a="secRpOpen" data-id="${esc(n.ref)}">פתיחת הדוח</button>`:''}${open?`<button class="chip" data-a="secNDone" data-id="${esc(n.id)}">טופל</button><label class="chip" style="gap:6px">חזרות <select data-c="secNReps" data-id="${esc(n.id)}" aria-label="מספר חזרות">${[0,1,2,3].map(k=>`<option value="${k}"${k===n.rep?' selected':''}>${k}</option>`).join('')}</select></label>`:''}${snzCan(n)?`<button type="button" class="chip" data-a="secSnzT" data-id="${esc(n.id)}" aria-expanded="${X.snz===n.id}">⏰ תזכירי לי שוב</button>`:''}</div>${snzCan(n)&&X.snz===n.id?snzH(n.id):''}</div>`}
function notesH(){const R=X.nl;if(!R){if(!X.nb)notesLoad();return '<div class="empty">טוען…</div>'}if(R.err)return `<div class="card"><p class="note">${esc(R.err)}</p><button class="btn g w" data-a="secTab" data-v="notes">נסה שוב</button></div>`;
 const A=R.notes||[];pnShown();
 /* 19.11.2026: רק התראות פתוחות. מה שטופל (או כבר לא רלוונטי) – מוסתר, ואפשר לראות את 7 הימים האחרונים בקישור "טופלו לאחרונה" */
 const L=A.filter(n=>!nClosed(n)),D=A.filter(n=>nClosed(n)&&Date.now()-(n.at||n.t||0)<7*864e5);
 const dn=D.length?`<button type="button" class="btn g w" data-a="secNHist" aria-expanded="${!!X.nHist}" style="margin-top:8px">${X.nHist?'הסתרת ההתראות שטופלו':'טופלו לאחרונה ('+D.length+')'}</button>${X.nHist?`<div class="card" id="secNDoneL" style="margin-top:8px">${D.map(n=>noteH(n,R.types||{})).join('')}</div>`:''}`:'';
 if(!L.length)return `<div class="empty">אין התראות פתוחות ✓</div>${dn}`;
 return `<div class="card" id="secNotes">${L.map(n=>noteH(n,R.types||{})).join('')}</div>${dn}<p class="note">לחיצה על התראה – כל הפרטים ומה אפשר לעשות. תזכורת שלא טופלה חוזרת עד 3 פעמים, פעם ביום עסקים. אפשר לשנות בכל תזכורת.</p>`}
const nClosed=n=>n.st==='done'||n.st==='gone';
ACT.secNHist=()=>{X.nHist=!X.nHist;rerender()};
/* 15.11.2026: פרטי התראה – הכותרת, הסוג, מתי נוצרה ומתי נשלחה לאחרונה, כמה פעמים, המצב, כל הטקסט, ומה אפשר לעשות */
function noteDlg(id){const R=X.nl,n=R&&!R.err&&(R.notes||[]).find(x=>x.id===id);if(!n)return toast('ההתראה לא נמצאה');const T=R.types||{},open=n.st==='open'&&n.k==='rem',body=nFix(n.body,n);
 const st=n.st==='done'?'טופל':n.st==='gone'?'כבר לא רלוונטי':n.k==='rem'?'פתוחה – עוד לא סומנה כטופלה'+(n.rep?' · תחזור עוד '+n.rep+' פעמים':' · לא תחזור שוב'):'פתוחה';
 const row=(k,v)=>`<p class="note" style="margin:4px 0"><b>${k}:</b> ${esc(v)}</p>`;
 const todo=n.typ==='close'&&!/מה לעשות/.test(body)?'\nמה לעשות:\n• לבקש מהעובד בסניף לשלוח סגירת קופה, או לפתוח את מסך סגירת הקופה ולהכניס אותה.\n• אם יש הפרש מזומן – לבדוק את הסגירה במסך סגירת הקופה ולברר עם העובד.':'';
 dlg(`<h3 style="overflow-wrap:anywhere">${esc(nFix(n.title,n))}</h3>${nActH(n,0)}${row('סוג',nLab(n,T)||'התראה')}${row('נוצרה',tm(n.t||n.at))}${n.n>1?row('נשלחה',n.n+' פעמים (לאחרונה '+tm(n.at)+')'):''}${row('מצב',st)}
 ${body||todo?`<div class="card" style="margin:8px 0;white-space:pre-wrap;overflow-wrap:anywhere" id="secNBody">${esc(body+todo)}</div>`:''}
 ${nmlCan(n)?nmlH(n):''}${snzCan(n)?`<p class="note" style="margin:10px 0 2px"><b>תזכירי לי שוב:</b></p>${snzH(n.id,1)}`:''}${open?`<button class="btn g w" data-a="secNDoneD" data-id="${esc(n.id)}" style="margin-top:8px">סמן כטופל</button>`:''}<button class="btn g w" data-a="closeDlg" style="margin-top:8px">סגירה</button>`)}
ACT.secNOpen=el=>noteDlg(el.dataset.id);
/* 17.11.2026: "המזכירה שואלת לגבי מייל" – עונים לה ומטפלים במייל מתוך ההתראה עצמה, בלי להיכנס למסך המייל:
   כותבים מה לענות ← המזכירה מנסחת תשובה (secMail refine) ← רואים אותה, אפשר לערוך, ושולחים בלחיצה (secMailSend). או "לא לענות" (secMail done).
   אחרי שליחה או "לא לענות" – גם ההתראה מסומנת כטופלה. המייל לא יוצא בלי לחיצה ואישור */
const NMEX=['תעני בנימוס שכרגע לא צריך, תודה','תעני שנחזור אליו מחר','תבקשי ממנו הצעת מחיר מסודרת'];
/* מזהה המייל מגיע מהשרת (n.mail). שרת שעוד לא עודכן – לפי כתובת השולח שבגוף ההתראה ("שאלה לגבי המייל מ-<כתובת>:"), ובחיפוש בתיבה */
const NMT='המזכירה שואלת לגבי מייל',nmlAddr=n=>{const m=/^שאלה לגבי המייל מ-(.+?):\s/.exec(String(n&&n.body||''));const a=m&&/[^\s<>"]+@[^\s<>"]+/.exec(m[1]);return a?a[0].toLowerCase():''};
const nmlCan=n=>!!(n&&(n.mail||n.title===NMT&&nmlAddr(n))&&n.st!=='done'&&n.st!=='gone'&&!(X.st&&X.st.brLimited));
const nmlH=n=>`<div class="card" id="secNMl" style="margin:8px 0" data-id="${esc(n.id)}" data-m="${esc(n.mail||'')}" data-ad="${esc(n.mail?'':nmlAddr(n))}" data-t="${+(n.t||n.at)||0}">${nmlAskH()}</div>`;
async function nmlId(b){if(b.dataset.m)return b.dataset.m;const ad=b.dataset.ad,t0=+b.dataset.t||Date.now();if(!ad)return '';
 const r=await fnCall('secMail',{op:'list'}),L=(r&&r.mails||[]).filter(m=>String(m.from||'').toLowerCase()===ad&&m.draft&&['pend','fail'].includes(m.draft.st)&&(m.t||0)<=t0+60e3).sort((a,b)=>(b.t||0)-(a.t||0));
 const id=L[0]&&L[0].id||'';if(id)b.dataset.m=id;return id}
const nmlAskH=v=>`<b>לטפל במייל מכאן</b><p class="note" style="margin:4px 0 6px">כתבו למזכירה מה לענות. היא תכין תשובה, ותראו אותה לפני שהיא נשלחת.</p>
 <textarea class="secin" id="secNMlT" maxlength="500" dir="auto" aria-label="מה לענות" placeholder="למשל: ${esc(NMEX[0])}">${esc(v||'')}</textarea>
 <div class="chips" style="margin:6px 0">${NMEX.map(x=>`<button type="button" class="chip" data-a="secNMlEx" data-v="${esc(x)}" style="min-height:44px">${esc(x)}</button>`).join('')}</div>
 <div class="row"><button type="button" class="btn grow" data-a="secNMlGo" style="min-height:44px">הכנת תשובה</button><button type="button" class="btn g grow" data-a="secNMlNo" style="min-height:44px">לא לענות</button></div>
 <button type="button" class="chip" data-a="secNMlOpen" style="margin-top:6px;min-height:44px">פתיחת המייל המלא</button>`;
const nmlBox=()=>document.getElementById('secNMl');
ACT.secNMlEx=el=>{const t=document.getElementById('secNMlT');if(t){t.value=el.dataset.v;t.focus()}};
ACT.secNMlGo=async el=>{const b=nmlBox(),t=document.getElementById('secNMlT'),note=t?t.value.trim():'';if(!b)return;if(!note)return toast('כתבו מה לענות');if(note.length>500)return toast(MERR['bad-note']||'עד 500 תווים');
 el.disabled=true;el.textContent='מכינה תשובה…';
 try{const id=await nmlId(b);if(!id)throw new Error('לא מצאתי את המייל. אפשר לפתוח אותו בתיבת המייל.');let r;try{r=await fnCall('secMail',{op:'refine',id,note})}catch(e){if(!(e&&e.reason==='no-draft'))throw e;await fnCall('secMail',{op:'draft',id});r=await fnCall('secMail',{op:'refine',id,note})}
  const d=r&&r.draft;if(!d)throw new Error('התשובה לא הוכנה');X.nml={nid:b.dataset.id,id,d,note};if(nmlBox()===b)b.innerHTML=nmlDrH(d)}
 catch(e){el.disabled=false;el.textContent='הכנת תשובה';if(e&&e.reason==='not-pending'){nmlEnd(b.dataset.id,'המייל כבר טופל');return}merr(e)}};
const nmlDrH=d=>`<b>התשובה שהמזכירה הכינה</b><p class="note" style="margin:4px 0">אל <bdi dir="ltr" class="secaddr">${esc(d.to||'')}</bdi> · אפשר לערוך לפני השליחה</p>${(d.why||[]).length?`<p class="note" style="margin:4px 0">${d.why.map(esc).join(' · ')}</p>`:''}${d.ask?`<div class="secin1" style="margin:6px 0" role="note"><b>❓ המזכירה שואלת:</b> <span dir="auto">${esc(d.ask)}</span></div>`:''}
 <textarea class="secin" id="secNMlDr" maxlength="5000" dir="auto" aria-label="התשובה" style="min-height:120px">${esc(d.text||'')}</textarea>
 <div class="row"><button type="button" class="btn grow" data-a="secNMlSend" style="min-height:44px">שליחה מה-Gmail של העסק</button><button type="button" class="btn g grow" data-a="secNMlRe" style="min-height:44px">לנסח אחרת</button></div>
 <button type="button" class="chip" data-a="secNMlNo" style="margin-top:6px;min-height:44px">לא לענות</button>`;
ACT.secNMlRe=()=>{const b=nmlBox();if(b)b.innerHTML=nmlAskH(X.nml&&X.nml.note)};
/* סוף הטיפול: ההתראה מסומנת כטופלה (אם זה נכשל – רק נשארת פתוחה; המייל עצמו כבר טופל) */
async function nmlEnd(nid,msg){closeDlg();X.nml=null;toast(msg);try{await fnCall('secNotes',{op:'done',id:nid})}catch(e){}X.nl=null;if(X.ml){X.ml.list=null;X.ml.card=null}try{eyStale()}catch(e){}rerender()}
ACT.secNMlSend=()=>{const p=X.nml,b=nmlBox();if(!p||!b)return;const t=document.getElementById('secNMlDr'),v=t?t.value.trim():p.d.text;if(!v)return toast('התשובה ריקה');
 p.d._sid=p.d._sid||sid();/* אותו מזהה בכל ניסיון חוזר – השרת לא ישלח פעמיים */const data={id:p.id,sendId:p.d._sid};if(v!==p.d.text)data.text=v;const fl=p.d.flags||[];
 ask('לשלוח את התשובה אל '+(p.d.to||'')+' מה-Gmail של העסק?'+(fl.includes('chk')?' בטיוטה יש מידע שכדאי לבדוק ('+(p.d.why||[]).join(', ')+').':''),async()=>{
  try{const r=await fnCall('secMailSend',data);await nmlEnd(p.nid,r&&r.already?'כבר נשלח':'נשלח מה-Gmail של העסק');if(r&&r.offerRule)setTimeout(()=>offerDlg(r.offerRule),50)}
  catch(e){if(e&&e.reason==='maybe-sent')return toast(MERR['maybe-sent']);merr(e)}},'שלח')};
ACT.secNMlNo=()=>{const b=nmlBox();if(!b)return;const nid=b.dataset.id;
 ask('לסמן את המייל כטופל? לא תישלח תשובה.',async()=>{try{const id=await nmlId(b);if(!id)throw new Error('לא מצאתי את המייל. אפשר לפתוח אותו בתיבת המייל.');await fnCall('secMail',{op:'done',id});await nmlEnd(nid,'המייל סומן כטופל, בלי תשובה')}catch(e){merr(e)}},'לא לענות')};
ACT.secNMlOpen=async()=>{const b=nmlBox();if(!b)return;let id='';try{id=await nmlId(b)}catch(e){}closeDlg();X.nml=null;X.set=0;X.edit=0;X.mrv=0;X.tab='mail';X.ml={f:X.ml&&X.ml.f||'all',list:null,cur:id,card:null,clean:null};X.rep=null;go('sec')};
ACT.secNRp=el=>{closeDlg();ACT.secRpOpen(el)};
ACT.secNDoneD=el=>{closeDlg();ACT.secNDone(el)};
/* 19.11.2026 (שלב 2): טיפול מיידי מתוך ההתראה – כפתור פעולה ראשי (זהב) בראש חלון הפרטים, וגם כשבב בשורה ברשימה. לפי סוג ההתראה ולפי הנתונים
   שהשרת כבר מחזיר (כותרת וגוף) – בלי שינוי בשרת ובלי שדות חדשים. כל פעולה עוברת דרך המסכים והפונקציות הקיימים של האפליקציה:
   סגירת קופה (V.zc, ממולא מראש בסניף ובתאריך), "סמן כשולם" (חלון סגירת התשלום של האפליקציה – payDlg), תזרים (צ'קים), משימות באיחור, גיבוי (bkCloud),
   ולשוניות המזכירה (מידע על העסק, יומן, חשבוניות, ווצאפ). שום דבר לא נשלח בלי לחיצה מפורשת. */
const nCln=v=>String(v==null?'':v).replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g,'').replace(/\s+/g,' ').trim();/* כמו clean בשרת (sec-tools.js) */
const nRegs=()=>{try{return typeof ZREG!=='undefined'&&ZREG?ZREG:{}}catch(e){return {}}};
/* סגירת קופה: התאריך (ISO בהתראות ישנות, "d.m" בכותרת בחדשות – השנה לפי מועד יצירת ההתראה) והסניפים מהשורות "• סניף <שם>: ..." */
function nZcInfo(n){const R=nRegs(),ti=String(n.title||''),bo=String(n.body||'');let d='',m=/\b(\d{4}-\d{2}-\d{2})\b/.exec(ti+'\n'+bo);
 if(m)d=m[1];else if((m=/(\d{1,2})\.(\d{1,2})/.exec(ti))){const a=ilDay(n.t||n.at||Date.now());let y=+a.slice(0,4);const iso=yy=>yy+'-'+String(m[2]).padStart(2,'0')+'-'+String(m[1]).padStart(2,'0');if(dDiff(iso(y),a)>1)y--;d=iso(y);if(isNaN(Date.parse(d+'T12:00:00Z')))d=''}
 const L=[];bo.split('\n').filter(l=>/^\s*•/.test(l)).forEach(l=>{for(const g of Object.keys(R)){if(!(l.includes('סניף '+R[g].n)||l.includes('• '+R[g].n+':')||new RegExp('\\b'+g+'\\b').test(l)))continue;/* 19.11: בעסק שאינו לארג' פעמי השרת כותב "• קופה: ..." */const x=L.find(y=>y.g===g)||(L.push({g,n:R[g].n,miss:false}),L[L.length-1]);if(/לא נשלחה/.test(l))x.miss=true}});
 return{d,L}}
/* חשבונית לתשלום: "חשבונית <מספר> של <ספק> – יתרה ..." – החשבונית הפתוחה במכשיר עם אותו מספר ואותו ספק (בדיוק כמו ששלחנו במראה – secFin) */
function nInvOf(n){const b=String(n.body||''),o={t:null,sub:''};try{
 if(typeof S==='undefined'||!S||!Array.isArray(S.tx)||typeof inv!=='function'||typeof bal!=='function')return o;
 const L=inv().filter(t=>bal(t)>0.004&&b.startsWith('חשבונית '+nCln(String(t.inv||'').slice(0,30)).slice(0,30)+' של '+(nCln(String(subName(t)).slice(0,60)).slice(0,60)||'ספק')+' – '));
 if(L.length===1&&(typeof msBrOk!=='function'||msBrOk(L[0])))o.t=L[0];
 const m=/^חשבונית .*? של (.+?) – יתרה/.exec(b),sn=m?m[1]:'';const ss=sn?(S.subs||[]).filter(x=>x&&nCln(String(x.name||'').slice(0,60)).slice(0,60)===sn):[];
 o.sub=o.t&&o.t.sub?o.t.sub:ss.length===1?ss[0].id:''}catch(e){}return o}
/* יומן: "יום ראשון 15.11, 12:00" (או "2026-11-15 12:00" בהתראות ישנות) – היום עצמו, כדי לפתוח את היומן עליו */
function nCalDay(n){const s=String(n.body||'');let m=/^(\d{4}-\d{2}-\d{2})/.exec(s);if(m)return m[1];m=/^יום [א-ת]+ (\d{1,2})\.(\d{1,2})/.exec(s);if(!m)return '';
 const a=ilDay(n.at||Date.now());let y=+a.slice(0,4);const iso=yy=>yy+'-'+String(m[2]).padStart(2,'0')+'-'+String(m[1]).padStart(2,'0');if(dDiff(iso(y),a)>180)y--;else if(dDiff(iso(y),a)<-180)y++;const d=iso(y);return isNaN(Date.parse(d+'T12:00:00Z'))?'':d}
/* ווצאפ: "מ-<מספר מוצג> (שם): ..." – חזרה למזהה המספר (972...) כמו ב-waShow בשרת */
function nWaOf(n){const m=/^מ-(\S+)/.exec(String(n.body||''));if(!m)return '';const s=m[1];let x;
 if((x=/^0(5\d)-(\d{7})$/.exec(s)))return '972'+x[1]+x[2];if((x=/^0(\d{8,9})$/.exec(s)))return '972'+x[1];if((x=/^\+(\d{6,15})$/.exec(s)))return x[1];return ''}
/* הפעולות לכל התראה: p = הראשית, s = משניות. {l: טקסט, a: פעולה (ברירת מחדל secNA), k: סוג, v: ערך, g/d: סניף ותאריך, pick: בחירת סניף} */
function nAct(n){const typ=n.k==='emp'?'emp':n.k==='rem'?n.typ:'';const has=v=>typeof V[v]==='function';
 if(n.k==='rep'&&n.ref)return{p:{l:'פתיחת הדוח',a:'secNRp',ref:n.ref},s:[]};
 if(typ==='close'&&has('zc')){const I=nZcInfo(n);if(I.L.length===1){const x=I.L[0];return{p:x.miss&&I.d?{l:'הכנסת סגירת קופה – '+x.n,a:'secNZc',g:x.g,d:I.d}:{l:'פתיחת סגירת הקופה – '+x.n,a:'secNZc'},s:[]}}
  return{p:I.L.length>1?{l:'פתיחת מסך סגירת הקופה',a:'secNZc',pick:1}:{l:'פתיחת מסך סגירת הקופה',a:'secNZc'},s:[]}}
 if(typ==='emp'&&has('zc'))return{p:{l:'פתיחת סגירות הקופה',a:'secNZc'},s:[]};
 if(typ==='invDue'){const o=nInvOf(n),card=o.sub&&has('card')?{l:'כרטיס הספק',k:'card',v:o.sub}:null,due={l:'כל החשבוניות לתשלום',k:'due'};
  if(o.t&&n.st!=='done'&&n.st!=='gone'&&typeof payDlg==='function')return{p:{l:'סמן כשולם',k:'pay',v:o.t.id},s:card?[card]:[due]};
  return card?{p:Object.assign({},card,{l:'פתיחת כרטיס הספק'}),s:[due]}:{p:{l:'פתיחת החשבוניות לתשלום',k:'due'},s:[]}}
 if(typ==='invLate')return{p:{l:'פתיחת החשבוניות באיחור',k:'due',v:'late'},s:[]};
 if(typ==='chk'&&has('cf')){const m=/(\d{4}-\d{2})-\d{2}/.exec(String(n.body||''));return{p:{l:'פתיחת התזרים (צ׳קים)',k:'cf',v:m?m[1]:''},s:[]}}
 if(typ==='task'&&has('tk'))return{p:{l:'פתיחת המשימות באיחור',k:'tk'},s:[]};
 if(typ==='backup'&&typeof bkCloud==='function'&&n.st!=='done'&&n.st!=='gone')return{p:{l:'גבה עכשיו',k:'bk'},s:[]};
 if(typ==='fact')return{p:{l:'פתיחת המידע על העסק',k:'tab',v:'facts'},s:[]};
 if(typ==='cal')return{p:{l:'פתח ביומן',k:'cal',v:nCalDay(n)},s:[]};
 if(typ==='inv')return{p:{l:'פתיחת החשבוניות שהתקבלו',k:'tab',v:'inv'},s:[]};
 if(typ==='win')return{p:{l:'פתיחת השיחה כדי לענות',k:'wa',v:nWaOf(n)},s:[]};
 return null}
const nBtnH=(n,x,cls,st)=>`<button type="button" class="${cls}" data-a="${x.a||'secNA'}" data-id="${esc(x.ref||n.id)}"${x.ref?'':` data-n="${esc(n.id)}"`}${x.k?` data-k="${x.k}"`:''}${x.v?` data-v="${esc(x.v)}"`:''}${x.g?` data-g="${esc(x.g)}" data-d="${esc(x.d)}"`:''}${x.pick?' data-pick="1"':''} style="${st}">${esc(x.l)}</button>`;
/* li=1: שבב בשורה ברשימה (רק הראשית; לדוח כבר יש "פתיחת הדוח" בשורה). li=0: בראש חלון הפרטים – הראשית בולטת, המשניות מתחתיה */
function nActH(n,li){const A=nAct(n);if(!A||!A.p)return '';
 if(li)return n.k==='rep'?'':nBtnH(n,A.p,'chip secpa','min-height:44px');
 return `<div id="secNAct" style="margin:6px 0 8px">${nBtnH(n,A.p,'btn w secpa1','min-height:48px')}${A.s.length?`<div class="secrow">${A.s.map(x=>nBtnH(n,x,'chip','min-height:44px')).join('')}</div>`:''}</div>`}
{const c=document.createElement('style');c.textContent='.chip.secpa{border-color:var(--acc);color:var(--acc);font-weight:700}#secNAct .btn{max-width:100%;white-space:normal;overflow-wrap:anywhere}';document.head.appendChild(c)}
/* התראה שטופלה דרך הפעולה עצמה (שולם / גובה / נכנסה סגירה) – בדיוק כמו "טופל": יוצאת מהרשימה מיד, והשמירה בשרת ברקע עם ניסיונות חוזרים */
function nAuto(id,msg,wait){if(!id)return;if(!nSt(id,'done'))X.nl=null;if(X.snz===id)X.snz='';if(msg)setTimeout(()=>toast(msg),wait||0);if(cur().v==='sec'&&X.tab==='notes'&&!typing())rerender();nDoneBg(id,0)}
function nTab(t,after){closeDlg();X.set=0;X.edit=0;X.mrv=0;if(!TABS.some(x=>x[0]===t))return toast('המסך הזה לא זמין');ACT.secTab({dataset:{v:t}});if(after)after();if(cur().v!=='sec')go('sec');else rerender()}
ACT.secNA=el=>{const k=el.dataset.k,v=el.dataset.v||'',id=el.dataset.n||el.dataset.id||'';
 if(k==='pay'){const t=typeof S!=='undefined'&&S&&(S.tx||[]).find(x=>x.id===v);closeDlg();
  if(!t||!(bal(t)>0.004)){toast('החשבונית כבר לא פתוחה במכשיר');go('due');return}if(typeof msBrOk==='function'&&!msBrOk(t))return toast('אין לך הרשאה לחשבונית הזו');
  X.nPay={nid:id,tid:t.id};payDlg(t.id);return}
 if(k==='card'){closeDlg();go('card',v);return}
 if(k==='due'){closeDlg();go('due',v==='late'?{late:1}:undefined);return}
 if(k==='cf'){closeDlg();go('cf',v||undefined);return}
 if(k==='tk'){closeDlg();try{TKT='late'}catch(e){}go('tk');return}
 if(k==='bk'){closeDlg();el.disabled=true;Promise.resolve(bkCloud(true)).then(r=>{if(r)nAuto(id,'✓ הגיבוי הושלם – ההתראה סומנה כטופלה',1800)}).catch(()=>{});return}
 if(k==='tab')return nTab(v);
 if(k==='cal')return nTab('cal',()=>{if(/^\d{4}-\d{2}-\d{2}$/.test(v)){X.cd=v;X.cm=v.slice(0,7)}});
 if(k==='wa')return nTab('wa',()=>{if(v&&X.wa){X.wa.cur=v;X.wa.card=null}})};
/* סגירת קופה מתוך ההתראה: סניף ותאריך ממולאים מראש (רק כשאין סגירה שהתחלת למלא – היא לא נדרסת). כמה סניפים – בוחרים. */
ACT.secNZc=el=>{const ds=el&&el.dataset||{},id=ds.n||ds.id||'',n=id&&X.nl&&!X.nl.err&&(X.nl.notes||[]).find(x=>x.id===id);closeDlg();
 if(ds.pick&&n){const I=nZcInfo(n);setTimeout(()=>dlg(`<h3>איזה סניף?</h3>${I.L.map(x=>`<button type="button" class="btn w" data-a="secNZc" data-n="${esc(id)}"${x.miss&&I.d?` data-g="${esc(x.g)}" data-d="${esc(I.d)}"`:''} style="margin-top:8px;min-height:48px">${esc((x.miss?'הכנסת סגירת קופה – ':'פתיחת סגירת הקופה – ')+x.n)}</button>`).join('')}<button type="button" class="btn g w" data-a="secNZc" style="margin-top:8px">רק לפתוח את מסך סגירת הקופה</button><button type="button" class="btn g w" data-a="closeDlg" style="margin-top:8px">ביטול</button>`),0);return}
 const g=ds.g||'',d=ds.d||'';
 if(g&&d&&typeof zcRegOk==='function'&&zcRegOk(g)&&/^\d{4}-\d{2}-\d{2}$/.test(d)){
  const busy=typeof ZC!=='undefined'&&ZC&&(ZC.f||(ZC.z||[]).some(Boolean)||ZC.o);
  if(busy)toast('יש סגירה שהתחלת למלא – לא שיניתי אותה');else{ZC=zcNew();ZC.f=zcEmpty();ZC.f.d=d;ZC.reg=g;ZC.rs='manual';ZC.sent=0}
  if(n){const I=nZcInfo(n),R=new Set(I.L.filter(x=>x.miss).map(x=>x.g));X.nZc=R.size&&I.d===d?{id,d,regs:R}:null}}
 go('zc')};
/* סגירה שנשמרה לסניף ולתאריך שבהתראה – כשכל הסניפים החסרים בה נכנסו, ההתראה מסומנת כטופלה. הצלחה = מסך הסגירה התאפס (כמו בסוף FRM.zcSend) */
if(typeof FRM.zcSend==='function'){const o=FRM.zcSend;FRM.zcSend=async(fm,ev)=>{const z0=typeof ZC!=='undefined'?ZC:null,pre=z0&&z0.f?{g:z0.reg,d:z0.f.d}:null;const r=await o(fm,ev);
 try{const q=X.nZc,z1=typeof ZC!=='undefined'?ZC:null;if(q&&pre&&z1!==z0&&z1&&!z1.f&&pre.d===q.d&&q.regs.has(pre.g)){q.regs.delete(pre.g);if(!q.regs.size){X.nZc=null;nAuto(q.id,'ההתראה על סגירת הקופה סומנה כטופלה',2200)}}}catch(e){}return r}}
/* "סמן כשולם": חלון סגירת התשלום של האפליקציה (payDlg/FRM.paysave) – אותה שמירה בדיוק. נסגרה במלואה – ההתראה מסומנת כטופלה; תשלום חלקי – נשארת */
if(typeof FRM.paysave==='function'){const o=FRM.paysave;FRM.paysave=async(form,ev)=>{const p=X.nPay,ie=form&&form.querySelector&&form.querySelector('[name=id]'),tid=ie?ie.value:'';const r=await o(form,ev);
 try{if(p&&p.tid===tid){const t=(S.tx||[]).find(x=>x.id===tid);if(t&&bal(t)<0.005){X.nPay=null;nAuto(p.nid,'החשבונית סומנה כשולמה – ההתראה סומנה כטופלה',1800)}}}catch(e){}return r}}
ACT.secNotesGo=()=>{X.tab='notes';X.set=0;X.edit=0;X.mrv=0;X.rp=null;X.nl=null;go('sec')};
/* 15.11.2026: לחיצה על התראה בטלפון – "לפתוח את ההתראות" נשמר לדקה (גם בזיכרון הטלפון, למקרה שהמסך נטען מחדש) ומוחל שוב עד שרשימת ההתראות באמת מוצגת:
   בפתיחה מאפס האירוע יכול להגיע לפני שההרשאות, העסק או המזכירה נטענו, ומסך שנפתח בדרך מסתיר את המזכירה. כשההתראה אחת – גם פרטיה נפתחים. */
const PNK='lp-pn-open',PNI={t:0,id:''},PNW=[600,1500,3000,6000,10000,20000];
const pnEnd=()=>{PNI.t=0;PNI.id='';try{localStorage.removeItem(PNK)}catch(e){}};
function pnTry(){if(!PNI.t)return;if(Date.now()-PNI.t>60000){pnEnd();return}if(!isA())return;
 if(cur().v!=='sec'||X.tab!=='notes'||X.set||X.edit||X.mrv){try{ACT.secNotesGo()}catch(e){}}}
function pnShown(){if(!PNI.t||cur().v!=='sec')return;const id=PNI.id;pnEnd();if(id&&(X.nl.notes||[]).some(x=>x.id===id))setTimeout(()=>{if(cur().v==='sec'&&X.tab==='notes')noteDlg(id)},0)}
function pnTap(id){PNI.t=Date.now();PNI.id=typeof id==='string'&&/^[A-Za-z0-9_:.-]{1,200}$/.test(id)?id:'';try{localStorage.setItem(PNK,JSON.stringify(PNI))}catch(e){}pnTry();PNW.forEach(ms=>setTimeout(pnTry,ms))}
try{const o=JSON.parse(localStorage.getItem(PNK)||'null');if(o&&+o.t&&Date.now()-o.t<60000){PNI.t=+o.t;PNI.id=String(o.id||'');PNW.forEach(ms=>setTimeout(pnTry,ms))}else if(o)localStorage.removeItem(PNK)}catch(e){}
/* 19.11.2026: "טופל" – ההתראה יוצאת מהרשימה מיד (בלי לטעון את כל הרשימה מחדש, כך שהמסך לא קופץ למעלה), והשמירה בשרת ממשיכה ברקע.
   אין תשובה מהשרת – עוד 3 ניסיונות (אחרי 2, 5 ו-12 שניות). רק אם כולם נכשלו – ההתראה חוזרת לרשימה עם הודעה. "כבר טופלה"/"לא נמצאה" = הצלחה */
const nDoneW=[2000,5000,12000];
function nSt(id,st){const L=X.nl&&!X.nl.err&&X.nl.notes;const n=L&&L.find(x=>x.id===id);if(n)n.st=st;return n}
async function nDoneBg(id,i){try{await fnCall('secNotes',{op:'done',id});try{eyStale()}catch(e){}}
 catch(e){if(notPend(e))return;if(e&&e.offline&&i<nDoneW.length){setTimeout(()=>nDoneBg(id,i+1),nDoneW[i]);return}
  nSt(id,'open');if(cur().v==='sec'&&X.tab==='notes'&&!typing())rerender();toast(e&&e.offline?'לא נשמר – אין חיבור לשרת. ההתראה חזרה לרשימה, נסו שוב':'לא נשמר: '+(e&&e.message||'שגיאה')+'. ההתראה חזרה לרשימה')}}
ACT.secNDone=el=>{const id=el.dataset.id;if(!id)return;if(!nSt(id,'done')){X.nl=null}toast('✓ טופל');if(X.snz===id)X.snz='';rerender();nDoneBg(id,0)};
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
ACT.secHistOk=async el=>{const t=X.hd;X.hd=null;if(!t)return closeDlg();el.disabled=true;try{const r=await fnCall('secHistory',{op:'del',token:t,sure:true});closeDlg();X.msgs=null;X.pc=null;X.ey=null;X.nl=null;X.rpl=null;X.rp=null;X.log=null;const d=r.deleted||{};toast('נמחק: '+(d.chat||0)+' הודעות, '+(d.notes||0)+' התראות, '+(d.reports||0)+' דוחות');rerender()}catch(e){el.disabled=false;err(e)}};
/* ---------- התראות לטלפון (7.2; 12.11.2026: רכיב ההתראות נוסף לאפליקציה) ----------
   רק באפליקציה לטלפון שנבנתה עם הגדרות Firebase (PushGate.ready). בלי זה – לא קורה כלום, וההתראות רק במסך (כמו קודם).
   מנהל: בכניסה הראשונה – בקשת הרשאה להתראות (Android 13+), פעם אחת בלבד בטלפון. אחר כך בכל פתיחה – רישום מחדש (המזהה מתחדש לפעמים).
   עובד: (18.11.2026) כשתוסף המשימות פעיל – בקשת הרשאה פעם אחת בטלפון, כמו מנהל. אחרת לא מתבקשת. אם ההרשאה כבר קיימת בטלפון – נרשם על שמו, והשרת מוציא את הטלפון מהמשתמש הקודם (עובד לא מקבל התראות של מנהל).
   יציאה מהחשבון – מזהה הטלפון נמחק (unregister), כך שהתראות לא ממשיכות להגיע אליו. לחיצה על התראה – המזכירה, לשונית ההתראות. */
const PN={done:0,ready:0};
const pnTkOn=()=>{try{return typeof bzF!=='function'||bzF('tasks')===true}catch(e){return true}};
async function pushReg(){try{if(PN.done||!(isA()||isW()))return;const C=window.Capacitor,P=C&&C.Plugins&&C.Plugins.PushNotifications,G=C&&C.Plugins&&C.Plugins.PushGate;if(!P||!G)return;PN.done=1;
 const g=await G.state();if(!g||g.ready!==true)return;PN.ready=1;PN.act=g.act===true;
 /* 16.11.2026: act:1 רק כשה-APK עצמו (Java) בונה התראות עם כפתורים – לא לפי קוד המסכים, שעדכון חי יכול להביא ל-APK ישן. act נשלח תמיד (0/1): רישום בלי act = מסכים ישנים */
 await P.addListener('registration',t=>{if(t&&t.value&&(isA()||isW())){PN.tk=t.value;pnSend()}});
 await P.addListener('pushNotificationActionPerformed',a=>{const d=a&&a.notification&&a.notification.data||{};if(d.k==='s3'&&(isA()||isW())&&typeof V.st3==='function'){try{go('st3')}catch(e){}return}/* מרכז עבודה סבב 3: "הזכר לעובד" (tkNudge) – פותח את המשימות בלשונית "היום שלי" *//* רובוט כספית (caspit-bot.js בשרת): התראה למנהל – פותח את "סנכרון כספית" */if(d.k==='cx'&&isA()&&typeof V.cxSync==='function'){try{go('cxSync')}catch(e){}return}/* משמרות (shifts.js בשרת, shTick): תזכורת לעובד / זמנים בלי עובדים למנהל – פותח את טבלת המשמרות */if(d.k==='sh'&&(isA()||isW())&&typeof window.shOpen==='function'){try{window.shOpen()}catch(e){}return}if(d.k==='dr'&&(isA()||isW())&&typeof window.drOpen==='function'){try{window.drOpen(d.id)}catch(e){}return}if(d.k==='tk'&&(isA()||isW())&&typeof V.tk==='function'){try{TKT='my';if(window.TKW)TKW.d0=1;if(cur().v!=='tk')go('tk');else rerender()}catch(e){}return}if(d.k==='grp'&&window.GRP&&typeof GRP.open==='function'){GRP.open(d.id);return}if(d.k==='sec')pnTap(d.id)});
 let p=await P.checkPermissions();
 /* 18.11.2026 (החלטת בעל העסק): גם עובד מתבקש פעם אחת – כשתוסף המשימות פעיל בעסק (bzF('tasks')); אם הבדיקה לא זמינה – מבקשים. אותו סימון lp-push-asked כמו אצל מנהל */
 if((isA()||(isW()&&pnTkOn()))&&(p.receive==='prompt'||p.receive==='prompt-with-rationale')){let asked=false;try{asked=localStorage.getItem('lp-push-asked')==='1'}catch(e){}
  if(!asked){try{localStorage.setItem('lp-push-asked','1')}catch(e){}p=await P.requestPermissions()}}
 if(p.receive==='granted')await P.register()}catch(e){}}
/* 16.11.2026 מכשיר אחד: s = מזהה הכניסה (SY.ds), רק אחרי שהשרת אישר אותה (SY.dsc) – כך השרת רושם רק את הטלפון הנוכחי. secPushRe: רישום חוזר אחרי אישור מאוחר (dvCur) */
function pnSend(){if(!PN.tk||!(isA()||isW()))return;const d={token:PN.tk,act:PN.act?1:0};if(SY.dsc&&typeof SY.ds==='string')d.s=SY.ds;fnCall('registerPushToken',d).catch(()=>{})}
window.secPushRe=()=>{try{pnSend()}catch(e){}};
window.secPushBoot=()=>{try{pushReg()}catch(e){}};
/* 15.11.2026 (סריקת חנות, שלב 12): בקשת הרשאה בכניסה לתכונה (החלטת המשתמש) – גם לעובד, שעד עכשיו לא התבקש, ולכן באנדרואיד 13+ לא קיבל
   התראות על סבב חדש, תזכורת, איחור ומשימת תיקון. פעם אחת בטלפון (אותו סימון כמו אצל מנהל). store3d קורא לזה דרך עטיפה ב-index.html. */
async function pushAsk(){if(PN.asking)return;PN.asking=1;try{if(!(isA()||isW()))return;let asked=false;try{asked=localStorage.getItem('lp-push-asked')==='1'}catch(e){}if(asked)return;
 if(!PN.done)await pushReg();if(!PN.ready)return;const P=window.Capacitor.Plugins.PushNotifications;let p=await P.checkPermissions();
 if(p.receive==='prompt'||p.receive==='prompt-with-rationale'){try{localStorage.setItem('lp-push-asked','1')}catch(e){}p=await P.requestPermissions();if(p.receive==='granted')await P.register()}}catch(e){}finally{PN.asking=0}}
window.secPushAsk=()=>{try{pushAsk()}catch(e){}};
window.secPushOff=()=>{try{const P=PN.ready&&window.Capacitor&&window.Capacitor.Plugins.PushNotifications;if(P){P.removeAllListeners().catch(()=>{});P.unregister().catch(()=>{})}PN.done=0;PN.ready=0;PN.act=0;PN.tk='';/* 16.11.2026: ההתראות עם הכפתורים והדחיות המקומיות (lp_notif_snz) נמחקות מהטלפון. APK ישן בלי clearLocal – נדחה בשקט */const G=window.Capacitor&&window.Capacitor.Plugins&&window.Capacitor.Plugins.PushGate;if(G&&typeof G.clearLocal==='function')G.clearLocal().catch(()=>{})}catch(e){}};
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
 if(c.stop&&c.stop.on)return `<div class="card secstop" id="secStopBar" style="margin:0 0 8px" role="status"><b>עצור הכל – פעיל</b><p class="note" style="margin:4px 0 8px">${c.stop.auto?'המזכירה עצרה את עצמה ('+esc(STOPW[c.stop.why]||'תקלה')+'). ':''}שליחה אוטומטית בווצאפ ובמייל עצורה. ההודעות והמיילים ממשיכים להיכנס, ו"שלח" בלחיצה שלך עובד.</p><button class="btn w" data-a="secStop" data-on="0">ביטול העצירה</button></div>`;
 return `<div class="secrow" id="secStopBar" style="margin:0 0 8px;justify-content:flex-end"><button class="chip" data-a="secStop" data-on="1" style="min-height:40px">⏸ עצור הכל</button></div>`}
ACT.secStop=el=>{const on=el.dataset.on==='1';const run=async()=>{el.disabled=true;try{const r=await fnCall('secWaCfg',{op:'stop',on});if(r&&r.ok&&r.stop)X.wc=r;if(X.wa)X.wa.list=null;X.rep=null;toast(on?'השליחה האוטומטית נעצרה':'העצירה בוטלה')}catch(e){err(e)}finally{el.disabled=false;rerender()}};
 if(on)ask('לעצור את כל השליחה האוטומטית בווצאפ ובמייל (הודעת פתיחה, "קיבלנו" ותשובות למספר המנהל)? ההודעות ימשיכו להיכנס, ושליחה בלחיצה שלך תמשיך לעבוד.',run,'עצור הכל');else run()};
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
/* 16.11.2026: שאלת הבהרה של המזכירה למנהל, כשהיא לא בטוחה בהודעה. עונים ב"↩ תגובה" – והיא מכינה טיוטה חדשה לפי התשובה */
const askH=(d,open)=>d&&d.ask?`<div class="secin1" style="margin:6px 0" role="note"><b>❓ המזכירה שואלת:</b> <span dir="auto">${esc(d.ask)}</span>${open&&mrBtnH('wa',d.id)?'<small class="note" style="display:block;margin-top:4px">לחצו "↩ תגובה" למטה וכתבו לה את התשובה – היא תכין טיוטה חדשה לפי מה שתכתבו.</small>':''}</div>`:'';
function drH(d,open,tpls){
 if(d.st==='sent')return `<div class="secdr"><small class="note">${d.am?'נשלח לבד לפי הכלל ✓':'נשלח ✓'}</small><div style="white-space:pre-wrap">${esc(d.sum||d.text)}</div></div>`;
 if(d.st==='done')return '<div class="secdr" style="opacity:.75"><small class="note">טופל בלי לענות</small></div>';
 const why=(d.why||[]).length?`<p class="note" style="margin:4px 0">${d.why.map(esc).join(' · ')}</p>`:'';
 const head=`<small class="note">טיוטת תשובה${d.src==='bank'?' (מתשובה מוכנה)':''}${d.lang&&d.lang!=='he'?' · בשפת הפונה':''}${d.st==='fail'?' · השליחה הקודמת נכשלה':''}</small>${(d.flags||[]).length?'<div class="sectg">'+flH(d.flags)+'</div>':''}${why}${askH(d,open)}`;
 if(open)return `<div class="secdr" data-id="${esc(d.id)}">${head}${mrInfoH(d)}<textarea class="secin" id="secDr_${esc(d.id)}" maxlength="2000" aria-label="טיוטת תשובה" dir="auto">${esc(d.text)}</textarea><div class="secrow"><button class="btn" data-a="secWaSend" data-id="${esc(d.id)}" style="flex:1">שלח</button><button class="chip" data-a="secWaDone" data-id="${esc(d.id)}">טופל בלי לענות</button>${mrBtnH('wa',d.id)}</div></div>`;
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
const MF=[['all','הכול'],['todo','לטיפול'],['pend','עם טיוטה'],['sus','חשוד'],['promo','פרסומות']];
/* מסנן "לטיפול" (16.11.2026): מייל חדש מאדם שעוד לא נענה ולא סומן "טופל", או מייל עם טיוטה ממתינה. בלי מיילים ישנים שנקלטו כרקע, פרסומות וחשודים. hd מגיע מהשרת (שרת ישן – פשוט לא נשלח) */
const mlTodo=m=>{const fl=m.flags||[],d=m.draft;if(m.hd||m.st==='replied'||m.st==='sus'||fl.some(x=>x==='hist'||x==='promo'||x==='spam'||x==='sus'))return false;return d?['pend','fail'].includes(d.st):m.hum===true};
/* ---------- לשונית "מייל" ---------- */
async function mlLoad(){X.mlb=1;const s0=X.ml.list;let again=0;try{const r=await fnCall('secMail',{op:'list'});if(s0&&X.ml.list===null){again=1;return}X.ml.list=r&&Array.isArray(r.mails)?r:{err:'לא נטען'}}catch(e){X.ml.list=X.ml.list&&!X.ml.list.err?X.ml.list:{err:e&&e.message||'לא נטען'}}finally{X.mlb=0;if(again){mlLoad();return}if(cur().v==='sec'&&!typing())rerender()}}
function mailH(){const M=X.ml;if(M.clean)return cleanH();if(M.au)return autoH();if(M.oa)return oaH();if(M.cur)return mlCardH();const R=M.list;if(!R){if(!X.mlb)mlLoad();return '<div class="empty">טוען…</div>'}if(R.err)return `<div class="card"><p class="note">${esc(R.err)}</p><button class="btn g w" data-a="secTab" data-v="mail">נסה שוב</button></div>`;
 const f=M.f||'all',L=(R.mails||[]).filter(m=>f==='all'||(f==='todo'?mlTodo(m):f==='pend'?m.draft&&['pend','fail'].includes(m.draft.st):f==='promo'?(m.flags||[]).some(x=>x==='promo'||x==='spam'):(m.flags||[]).includes(f)));
 let h='';
 if(R.cleanN)h+=`<div class="card secwarn" id="secClPend" style="margin-bottom:8px"><b>רשימת ניקוי ממתינה לאישורך (${R.cleanN})</b><p class="note" style="margin:4px 0 8px">מנהל המערכת הכין רשימת מיילים לפינוי. שום מייל לא יועבר לאשפה בלי האישור שלך.</p><button class="btn w" data-a="secClOpen">לצפייה ואישור</button></div>`;
 if(!(R.boxes||[]).length)h+=`<div class="card" style="margin-bottom:8px"><p class="note" style="margin:0 0 8px">${R.max?'עוד לא חוברה תיבת Gmail. מחברים בהגדרות המזכירה.':'מנהל המערכת עוד לא אישר חיבור תיבות מייל לעסק.'}</p>${R.max?'<button class="chip" data-a="secSet" style="min-height:40px">להגדרות</button>':''}</div>`;
 else{const ex=(R.boxes||[]).filter(b=>b.st==='expired');if(ex.length)h+=`<div class="card secwarn" style="margin-bottom:8px"><p class="note" style="margin:0">החיבור פג: ${ex.map(b=>'<bdi dir="ltr" class="secaddr">'+esc(b.addr)+'</bdi>').join(', ')}. אפשר לחבר מחדש בהגדרות.</p></div>`}
 h+=repPanelH(true)+offersCardH();
 h+=`<div class="chips" style="margin:0 0 8px">${MF.map(([k,l])=>{const n=k==='todo'?(R.mails||[]).filter(mlTodo).length:0;return `<button class="chip${f===k?' on':''}" data-a="secMlF" data-v="${k}" style="min-height:40px" aria-pressed="${f===k}">${l}${n?' ('+n+')':''}</button>`}).join('')}</div>`;
 return h+`<div class="card secml" id="secMlList">${L.length?L.map(m=>`<div class="li" data-a="secMlOpen" data-id="${esc(m.id)}" role="button" tabindex="0"><div class="m"><b>${esc(m.subj||'(בלי נושא)')}</b><small><bdi dir="ltr" class="secaddr">${esc(m.name||m.from)}</bdi> · ${esc(tm(m.t))}</small><small>${esc(m.snip)}</small><div class="sectg">${m.st==='replied'?'<span class="sectags g">נענה ✓</span>':m.hd?'<span class="sectags">טופל</span>':m.draft&&['pend','fail'].includes(m.draft.st)?'<span class="sectags g">טיוטה ממתינה</span>':''}${m.draft&&m.draft.am?'<span class="sectags g">אוטומטי</span>':''}${m.task?'<span class="sectags">נפתחה משימה</span>':''}${mflH(m.flags)}</div></div></div>`).join(''):`<p class="note">${f==='todo'?'אין מיילים שמחכים לטיפול ✓':'אין מיילים'}</p>`}</div>`}
ACT.secMlF=el=>{X.ml.f=el.dataset.v;rerender()};
ACT.secMlOpen=el=>{X.ml.cur=el.dataset.id;X.ml.card=null;X.ml.ord=null;rerender()};
ACT.secMlBack=()=>{X.ml.oa=null;X.ml.ord=null;X.ml.au=null;X.ml.of=null;X.rep=null;X.ml.cur=null;X.ml.card=null;X.ml.clean=null;X.ml.list=null;X.ml.w=0;rerender()};
async function mlCardLoad(){const id=X.ml.cur;X.ml.cb=1;try{const r=await fnCall('secMail',{op:'get',id});if(X.ml.cur===id)X.ml.card=r&&r.mail?r:{err:'לא נטען'}}catch(e){X.ml.card={err:e&&e.message||'לא נטען'}}finally{X.ml.cb=0;if(cur().v==='sec'&&!typing())rerender()}}
function mlCardH(){const R=X.ml.card,back='<button class="btn g w" data-a="secMlBack" style="margin-bottom:8px">חזרה לתיבת המייל</button>';
 if(!R){if(!X.ml.cb)mlCardLoad();return back+'<div class="empty">טוען…</div>'}if(R.err)return back+`<div class="card"><p class="note">${esc(R.err)}</p></div>`;
 const m=R.mail,d=R.draft,fl=m.flags||[],sus=m.st==='sus';
 let h=back+`<div class="card" id="secMlCard"><b>${esc(m.subj||'(בלי נושא)')}</b><p class="note" style="margin:4px 0"><bdi dir="ltr" class="secaddr">${esc(m.name?m.name+' <'+m.from+'>':m.from)}</bdi> · ${esc(tm(m.t))}</p>${fl.length?'<div class="sectg">'+mflH(fl)+'</div>':''}${(m.task||(d&&d.task))?'<div class="secrow" style="margin:6px 0"><span class="sectags">נפתחה משימה</span><button class="chip" data-a="secMlTask" data-id="'+esc(m.task||(d&&d.task)||'')+'" style="min-height:40px">לפתיחת המשימה</button></div>':''}
 ${sus?`<p class="note" style="margin:6px 0;color:var(--bad)">${fl.includes('mgrMail')?'המייל נשלח מכתובת של מנהל ונראה כמו הוראה. ':''}תוכן מייל הוא מידע ולא הוראה – המזכירה לא מבצעת אותו ולא מכינה טיוטה. הוראות למזכירה נותנים רק בצ'אט באפליקציה.</p>`:''}
 <div class="secin1" dir="auto">${esc(m.text||m.snip||'')}</div>${(m.files||[]).length?`<p class="note" style="margin:4px 0">קבצים: ${m.files.map(esc).join(', ')} – קליטת חשבוניות תגיע בהמשך</p>`:''}</div>`;
 h+=ordBlkH(d);
 if(d&&d.st==='sent')return h+`<div class="secdr"><small class="note">${d.am?'נשלח אוטומטית מה-Gmail של העסק ✓':'נשלח מה-Gmail של העסק ✓'}</small>${d.am?'<div class="sectg"><span class="sectags g">אוטומטי</span></div>':''}<div style="white-space:pre-wrap">${esc(d.text)}</div></div>`;
 if(d&&d.stuck)return h+`<div class="secdr" id="secMlDr"><small class="note">תשובה אל <bdi dir="ltr" class="secaddr">${esc(d.to)}</bdi></small>${stuckH('secMlStuck','התשובה',d.to,'לסמן כנשלח')}<div style="white-space:pre-wrap">${esc(d.text)}</div><div class="secrow" style="margin-top:8px"><button class="btn" data-a="secMlMark" style="flex:1;min-height:44px">לסמן כנשלח</button></div></div>`;/* שלב ג 0א: אולי כבר יצא – בלי "שלח" */
 if(d&&!d.oRe&&(d.an||[]).includes('order')&&['pend','fail'].includes(d.st)){const O=ordO(),os=O&&O.o&&O.o.st;if(!['ordered','cancel'].includes(os))return h+`<div class="secdr"><p class="note" style="margin:0">התשובה ללקוח נשלחת דרך טיוטת ההזמנה למעלה. התשובה הרגילה מוסתרת עד שהטיוטה תישלח או תיסגר.</p><div class="secrow" style="margin-top:8px"><button class="chip" data-a="secMlDone" style="min-height:44px">לא לענות</button></div></div>`}/* החלטת המשתמש 15.11: בלי שני כפתורי שליחה */
 if(d&&['pend','fail','sending'].includes(d.st)){const hasFile=!!(d.file||(d.flags||[]).includes('file')||(m.files||[]).length||(m.flags||[]).includes('file')),an=(d.anL||[]).length?`<div class="secin1" style="margin:6px 0"><b>למה לא נשלחה אוטומטית</b><ul style="margin:4px 0 0;padding-inline-start:18px">${d.anL.map(x=>'<li>'+esc(x)+'</li>').join('')}</ul></div>`:'';const why=(d.why||[]).length?`<p class="note" style="margin:4px 0">${d.why.map(esc).join(' · ')}</p>`:'';
  return h+`<div class="secdr" id="secMlDr"><small class="note">תשובה אל <bdi dir="ltr" class="secaddr">${esc(d.to)}</bdi> · ${d.src==='ai'?'טיוטה מהמזכירה':'נכתבה על ידך'}${d.st==='fail'?' · השליחה הקודמת נכשלה':''}</small>${(d.flags||[]).length?'<div class="sectg">'+mflH(d.flags)+'</div>':''}${hasFile?'<div class="sectg"><span class="sectags w">📎 יש קובץ מצורף</span></div>':''}${an}${why}${d.ask?`<div class="secin1" style="margin:6px 0" role="note"><b>❓ המזכירה שואלת:</b> <span dir="auto">${esc(d.ask)}</span><small class="note" style="display:block;margin-top:4px">כתבו לה את התשובה בשדה "לדייק" למטה – היא תכין טיוטה חדשה לפי מה שתכתבו.</small></div>`:''}${mrInfoH(d)}
  <textarea class="secin" id="secMlTx" maxlength="5000" aria-label="תשובה" dir="auto">${esc(d.text)}</textarea><div class="secrow"><button class="btn" data-a="secMlSend" style="flex:1">שלח מה-Gmail של העסק</button><button class="chip" data-a="secMlDone">לא לענות</button></div>
  <div class="secrow" style="margin-top:8px"><input class="secin" id="secMlNote" maxlength="500" dir="auto" placeholder="לדייק: הנחיה קצרה לשינוי הטיוטה" aria-label="הנחיה לדיוק הטיוטה" style="flex:1 1 100%;min-height:44px"><button class="chip" data-a="secMlRefine" style="min-height:44px">לדייק</button>${mrBtnH('mail',X.ml.cur)}</div><small class="note">המייל יוצא רק בלחיצה שלך. לשינוי חופשי – ערכו את התשובה למעלה ושלחו.</small></div>`}
 if(X.ml.w)return h+`<form class="secdr" data-f="secMlW"><small class="note">תשובה משלך</small><textarea class="secin" name="text" maxlength="5000" aria-label="תשובה" dir="auto"></textarea><div class="secrow"><button class="btn" style="flex:1">שמירת טיוטה</button><button type="button" class="chip" data-a="secMlWx">ביטול</button></div></form>`;
 return h+`<div class="secrow" style="margin-top:8px">${sus?'':'<button class="btn" data-a="secMlDraft" style="flex:1">טיוטה מהמזכירה</button>'}<button class="chip" data-a="secMlW" style="min-height:44px">לכתוב בעצמי</button><button class="chip" data-a="secMlDone" style="min-height:44px">טופל</button></div>`}
ACT.secMlDraft=async el=>{el.disabled=true;try{const r=await fnCall('secMail',{op:'draft',id:X.ml.cur});if(X.ml.card)X.ml.card.draft=r.draft}catch(e){merr(e)}finally{el.disabled=false;rerender()}};
ACT.secMlW=()=>{X.ml.w=1;rerender()};ACT.secMlWx=()=>{X.ml.w=0;rerender()};
FRM.secMlW=async f=>{const t=String(fd(f).text||'').trim();if(!t)return toast('כתבו תשובה');const b=f.querySelector('button');b.disabled=true;try{const r=await fnCall('secMail',{op:'write',id:X.ml.cur,text:t});X.ml.w=0;if(X.ml.card)X.ml.card.draft=r.draft}catch(e){merr(e)}finally{b.disabled=false;rerender()}};
ACT.secMlSend=el=>{const c=X.ml.card,d=c&&c.draft;if(!d)return;d._sid=d._sid||sid();/* אותו מזהה בכל ניסיון חוזר – השרת לא ישלח פעמיים (10.2) */
 const t=document.getElementById('secMlTx'),v=t?t.value.trim():d.text;if(!v)return toast('התשובה ריקה');const data={id:X.ml.cur,sendId:d._sid};if(v!==d.text)data.text=v;
 const run=async()=>{el.disabled=true;try{const r=await fnCall('secMailSend',data);toast(r&&r.already?'כבר נשלח':'נשלח מה-Gmail של העסק');X.ml.card=null;X.ml.list=null;X.rep=null;if(r&&r.offerRule)setTimeout(()=>offerDlg(r.offerRule),50)}catch(e){if(e&&e.reason==='maybe-sent')return setTimeout(mlMarkAsk,50);merr(e)}finally{el.disabled=false;rerender()}};
 ask('לשלוח את התשובה אל '+d.to+' מה-Gmail של העסק?'+((d.flags||[]).includes('chk')?' בטיוטה יש מידע שכדאי לבדוק ('+(d.why||[]).join(', ')+').':''),run,'שלח')};
/* שלב ג 0א: סימון ידני "נשלח" לטיוטה שאולי כבר יצאה מ-Gmail (בלי שליחה) */
function mlMarkAsk(){const c=X.ml.card,d=c&&c.draft;if(!d)return;d._sid=d._sid||sid();ask(MERR['maybe-sent']+' לסמן כנשלח?',async()=>{try{await fnCall('secMailSend',{id:X.ml.cur,sendId:d._sid,mark:true});toast('סומן כנשלח');X.ml.card=null;X.ml.list=null}catch(e){merr(e)}finally{rerender()}},'סמן נשלח')}
ACT.secMlMark=()=>mlMarkAsk();
ACT.secMlDone=()=>{ask('לסמן כטופל? לא תישלח תשובה.',async()=>{try{await fnCall('secMail',{op:'done',id:X.ml.cur});toast('סומן כטופל');X.ml.cur=null;X.ml.card=null;X.ml.list=null;rerender()}catch(e){merr(e)}},'טופל')};
/* ---------- שלב ג/8: טיוטת הזמנה מהמייל (secMail: ordGet/ordEdit/ordCust/ordSend/ordReset) + "שליחה לבד" (ordAuto) ---------- */
const ORDST={mgr:'ממתינה לך',sending:'נשלחת…',sent:'נשלח ללקוח – ממתין לתשובה',fail:'השליחה נכשלה',ordered:'הלקוח אישר – נוצרה הזמנה',cancel:'הלקוח ביטל'};
const ORDNO={cust:'צריך לבחור לקוח (או לאשר כרטיס חדש)',br:'צריך לבחור סניף',empty:'אין שורות בהזמנה'};
const ORDPAY=[['','—'],['cash','מזומן'],['n30','שוטף + 30'],['n60','שוטף + 60'],['n90','שוטף + 90'],['credit','אשראי'],['transfer','העברה בנקאית'],['other','אחר']];
const ordM=a=>(Number(a||0)/100).toFixed(2)+' ₪';
const ordO=()=>{const O=X.ml&&X.ml.ord;return O&&O.id===X.ml.cur?O:null};
const ordBlk=o=>{const b=[];if(!o.custId)b.push('cust');if(!o.br)b.push('br');if(!(o.lines||[]).length)b.push('empty');return b};
async function ordLoad(){const id=X.ml.cur,O=X.ml.ord;O.busy=1;try{const r=await fnCall('secMail',{op:'ordGet',id});if(X.ml.cur===id){O.o=r&&r.ord?r.ord:null;O.err=O.o?'':'לא נטען'}}catch(e){O.err=e&&e.message||'לא נטען'}finally{O.busy=0;if(cur().v==='sec'&&!typing())rerender()}}
ACT.secOrdOpen=()=>{X.ml.ord={id:X.ml.cur,o:null,err:'',busy:0};ordLoad();rerender()};
ACT.secOrdRe=()=>{const O=ordO();if(!O)return;O.o=null;O.err='';ordLoad();rerender()};
ACT.secOrdOrig=el=>{X.ml.cur=el.dataset.id;X.ml.card=null;X.ml.ord=null;X.ml.w=0;rerender()};
function ordErr(e){const r=e&&e.reason;if(r==='stale'){toast(e.message||'הטיוטה עודכנה – נטענה מחדש');return ACT.secOrdRe()}if(r==='maybe-sent'){ordMarkAsk();return ACT.secOrdRe()}toast(e&&e.message||'הפעולה נכשלה')}
async function ordEdit(ops,el){const O=ordO();if(!O||!O.o)return;if(el)el.disabled=true;try{const r=await fnCall('secMail',{op:'ordEdit',id:O.id,ver:O.o.ver,ops});if(r&&r.ord)O.o=r.ord}catch(e){ordErr(e)}finally{if(el)el.disabled=false;rerender()}}
ACT.secOrdOp=el=>{const d=el.dataset,k=d.k,op={k};if(d.i!==undefined)op.i=+d.i;if(k==='pick')op.pid=d.pid;if(k==='cust')op.cid=d.cid;if(k==='br')op.br=d.br;const run=()=>ordEdit([op],el);if(k==='del')ask('למחוק את השורה מההזמנה?',run,'מחק');else run()};
CHG.secOrdQty=el=>{const q=+String(el.value).replace(',','.');if(!(q>0)){toast('כמות לא תקינה');return rerender()}ordEdit([{k:'qty',i:+el.dataset.i,qty:q}],el)};
CHG.secOrdBr=el=>{if(el.value)ordEdit([{k:'br',br:el.value}],el)};
FRM.secOrdCust=async f=>{const O=ordO();if(!O||!O.o)return;const v=fd(f),card={},ws=!!v.ws,t=k=>String(v[k]||'').trim();for(const k of['name','phone','mail','st','city'])if(t(k))card[k]=t(k);if(ws)for(const k of['bn','vat','ct','pay','payTxt'])if(t(k))card[k]=t(k);const b=f.querySelector('button');b.disabled=true;try{const r=await fnCall('secMail',{op:'ordCust',id:O.id,card,ws});if(r&&r.ord)O.o=r.ord;toast(r&&r.exists?'כבר יש לקוח עם הטלפון הזה – הוא נוסף לבחירה':'הלקוח נשמר')}catch(e){ordErr(e)}finally{b.disabled=false;rerender()}};
ACT.secOrdSend=el=>{const O=ordO();if(!O||!O.o)return;const o=O.o;ask('לשלוח את טיוטת ההזמנה אל '+o.to+' מה-Gmail של העסק? הלקוח יקבל את הטקסט שמופיע בתצוגה המקדימה.',async()=>{el.disabled=true;try{const r=await fnCall('secMail',{op:'ordSend',id:O.id,ver:o.ver});toast(r&&r.already?'כבר נשלח':'הטיוטה נשלחה ללקוח');X.ml.list=null}catch(e){if(e&&e.reason==='maybe-sent'){ordMarkAsk();return ACT.secOrdRe()}ordErr(e)}finally{el.disabled=false;ACT.secOrdRe()}},'שלח')};
function ordMarkAsk(){const O=ordO();if(!O)return;ask(MERR['maybe-sent']+' לסמן כנשלח?',async()=>{try{await fnCall('secMail',{op:'ordSend',id:O.id,mark:true});toast('סומן כנשלח');X.ml.list=null}catch(e){merr(e)}finally{ACT.secOrdRe()}},'סמן נשלח')}
ACT.secOrdMark=()=>ordMarkAsk();
/* סבב שיפורים: "ייתכן שנשלח" – הודעה בולטת אחת לטיוטת הזמנה ולטיוטת מייל רגילה (מה קרה ומה לעשות) */
const stuckH=(id,what,to,btn)=>`<div class="secin1" id="${id}" role="alert" style="border-color:var(--warn);white-space:normal"><b style="color:var(--warn)">לא ידוע אם ${what} יצאה ללקוח</b><p class="note" style="margin:4px 0">השליחה התחילה ולא הסתיימה כרגיל (למשל בגלל תקלה או ניתוק), ולכן המזכירה לא שולחת שוב – כדי שהלקוח לא יקבל אותה פעמיים.</p><b>מה לעשות:</b><ol style="margin:4px 0 0;padding-inline-start:18px"><li>פתחו את Gmail של העסק ובדקו בתיקייה "נשלח" אם יש מייל אל <bdi dir="ltr">${esc(to)}</bdi>.</li><li>אם הוא שם – לחצו "${btn}" למטה.</li><li>אם הוא לא שם – שלחו ללקוח את הטקסט שמופיע כאן בעצמכם מ-Gmail, ואז לחצו "${btn}".</li></ol></div>`;
/* סבב שיפורים: הטלפון מהמייל לכרטיס הלקוח (ordPhone) – רק בלחיצה ואחרי אישור */
ACT.secOrdPhone=el=>{const O=ordO();if(!O||!O.o)return;const o=O.o;ask('לעדכן את הטלפון '+(o.phoneHint||o.phone)+' בכרטיס הלקוח '+(o.custName||'')+'?',async()=>{el.disabled=true;try{const r=await fnCall('secMail',{op:'ordPhone',id:O.id,ver:o.ver});if(r&&r.ord)O.o=r.ord;toast('הטלפון עודכן בכרטיס הלקוח')}catch(e){ordErr(e)}finally{el.disabled=false;rerender()}},'עדכן')};
ACT.secOrdReset=async el=>{const O=ordO();if(!O)return;el.disabled=true;try{await fnCall('secMail',{op:'ordReset',id:O.id})}catch(e){merr(e)}finally{ACT.secOrdRe()}};
function ordLineH(l,i,ed){const q=ed?`<label class="f"><small class="note">כמות</small><input type="number" inputmode="decimal" min="0" step="any" data-c="secOrdQty" data-i="${i}" value="${l.qty?esc(String(l.qty)):''}" style="min-height:44px" aria-label="כמות בשורה ${i+1}"></label><button class="chip" data-a="secOrdOp" data-k="del" data-i="${i}" style="min-height:44px">מחק שורה</button>`:'';
 let b;const u=l.unit?' '+esc(l.unit):'',tag=(c,t)=>`<span class="sectags ${c}">${t}</span>`;
 if(l.st==='ok'&&l.out)b=`<b>${esc(l.name||l.txt||'')}</b> ${tag('w','אזל')}`;
 else if(l.st==='ok'&&l.pr>0)b=`<b>${esc(l.name||'')}</b>${l.qty?` · ${esc(String(l.qty))}${u}`:''}<br><small class="note">מחיר ${ordM(l.pr)}${l.ex?' (לפני מע"מ)':''} · סה"כ ${ordM(l.sum)}${l.ctw?' · בכפולות של '+esc(String(l.ctw))+' (קרטון)':''}</small>`;
 else if(l.st==='pick'&&(l.opts||[]).length)b=`<b dir="auto">${esc(l.txt||'')}</b>${l.qty?` · ${esc(String(l.qty))}${u}`:''} ${tag('g','לבחירה')}<div class="secrow" style="flex-wrap:wrap;margin-top:4px">${l.opts.map(p=>`<button class="chip" data-a="secOrdOp" data-k="pick" data-i="${i}" data-pid="${esc(p.id)}" style="min-height:44px"${ed?'':' disabled'}>${esc(p.name)}${p.pr?' · '+ordM(p.pr):''}</button>`).join('')}</div>`;
 else b=`<b dir="auto">${esc(l.txt||'')}</b>${l.qty?` · ${esc(String(l.qty))}${u}`:''} ${tag('w','לבירור')}${l.why==='qty'?'<small class="note"> הכמות לא ברורה</small>':''}`;
 return `<div class="secli">${b}<div>${q}</div></div>`}
function ordCustH(o){const n=o.custNew||{},tx=(k,lb,ex)=>`<label class="f"><span>${lb}</span><input class="secin" name="${k}" maxlength="80" dir="auto" value="${esc(n[k]||'')}" style="min-height:44px"${ex||''}></label>`;
 return `<form data-f="secOrdCust" id="secOrdCustF">${o.custNew?'<p class="note" style="margin:4px 0">המזכירה הכינה כרטיס מהמייל. בדקו, תקנו ואשרו:</p>':'<p class="note" style="margin:4px 0">פרטי לקוח חדש:</p>'}${tx('name','שם')}${tx('phone','טלפון',' type="tel" dir="ltr"')}${tx('mail','מייל',' dir="ltr"')}${tx('st','רחוב ומספר')}${tx('city','עיר')}
 <label class="chip" style="min-height:44px;width:100%;justify-content:flex-start"><input type="checkbox" name="ws" value="1"${n.bn||n.vat?' checked':''}> לקוח עסקי (מחירי סיטונאי)</label>
 <div class="secin1" style="margin:4px 0">${tx('bn','שם העסק')}${tx('vat','ע.מ (9 ספרות)',' inputmode="numeric" dir="ltr"')}${tx('ct','איש קשר')}<label class="f"><span>תנאי תשלום</span><select class="secin" name="pay" style="min-height:44px">${ORDPAY.map(p=>`<option value="${p[0]}"${n.pay===p[0]?' selected':''}>${p[1]}</option>`).join('')}</select></label>${tx('payTxt','פירוט תנאי תשלום (כשנבחר "אחר")')}<small class="note">שדות העסק נשמרים רק אם סימנתם "לקוח עסקי".</small></div>
 <button class="btn w" style="min-height:44px">אישור והוספת הלקוח</button></form>`}
function ordBlkH(d){if(!d||!(d.an||[]).includes('order'))return '';
 if(d.oRe)return `<div class="secdr"><span class="sectags g">תשובה לטיוטת הזמנה</span><p class="note" style="margin:6px 0">הלקוח השיב על טיוטת ההזמנה שנשלחה לו.</p><button class="chip" data-a="secOrdOrig" data-id="${esc(d.oRe)}" style="min-height:44px">פתיחת המייל המקורי</button></div>`;
 const O=ordO();if(!O)return `<div class="secdr" id="secOrd"><b>טיוטת הזמנה</b><p class="note" style="margin:4px 0 8px">המזכירה זיהתה במייל הזמנה והכינה טיוטה.</p><button class="btn w" data-a="secOrdOpen">פתיחת טיוטת ההזמנה</button></div>`;
 const hd='<b>טיוטת הזמנה</b>';
 if(!O.o)return `<div class="secdr" id="secOrd">${hd}${O.err?`<p class="note">${esc(O.err)}</p><button class="chip" data-a="secOrdRe" style="min-height:44px">נסה שוב</button>`:'<div class="empty">טוען…</div>'}</div>`;
 const o=O.o,ed=o.st==='mgr',fail=o.st==='fail',stuck=o.stuck===true,blk=ed||fail?ordBlk(o):[],lab=stuck?'ייתכן שנשלח':ORDST[o.st]||o.st;
 let h=`<div class="secdr" id="secOrd">${hd} <span class="sectags ${o.st==='ordered'||o.st==='sent'?'g':fail||stuck?'w':''}">${esc(lab)}</span>`;
 if(stuck)h+=stuckH('secOrdStuck','טיוטת ההזמנה',o.to,'סמן נשלח');
 h+=`<p style="margin:6px 0 2px"><small class="note">אל <bdi dir="ltr" class="secaddr">${esc(o.to)}</bdi></small></p>`;
 if(o.oPrev)h+=`<div class="secrow" style="margin:4px 0;flex-wrap:wrap"><small class="note">הזמנה חדשה בשרשור של הזמנה קודמת (שכבר נסגרה).</small><button class="chip" data-a="secOrdOrig" data-id="${esc(o.oPrev)}" style="min-height:44px">פתיחת ההזמנה הקודמת</button></div>`;
 /* לקוח */
 if(o.custId)h+=`<p style="margin:4px 0"><b>לקוח:</b> ${esc(o.custName||'נבחר')}</p>`;
 else if(ed){h+='<p style="margin:4px 0"><b>לקוח:</b> <span class="sectags w">לא נבחר</span></p>';
  if((o.cands||[]).length)h+=`<small class="note">${o.idBy==='phone'?'זוהה לפי טלפון':o.idBy==='mail'?'זוהה לפי כתובת המייל':'ייתכן שזה אחד מהלקוחות האלה'} – בחרו:</small><div class="secrow" style="flex-wrap:wrap;margin:4px 0">${o.cands.map(c=>`<button class="chip" data-a="secOrdOp" data-k="cust" data-cid="${esc(c.id)}" style="min-height:44px">${esc(c.name||'')}${c.bn?' · '+esc(c.bn):''}</button>`).join('')}</div>`;
  h+=(o.cands||[]).length?`<details style="margin:4px 0"><summary style="min-height:44px">לקוח חדש (במקום המועמדים)</summary>${ordCustH(o)}</details>`:ordCustH(o)}
 /* טלפון */
 const upd=ed&&o.custId&&o.custPh===false?'<button class="chip" data-a="secOrdPhone" style="min-height:44px">עדכן בכרטיס הלקוח</button>':'';/* כרטיס הלקוח בלי טלפון */
 if(ed||fail){if(o.phone)h+=`<div class="secrow" style="margin:4px 0;flex-wrap:wrap"><span><b>טלפון:</b> <bdi dir="ltr">${esc(o.phone)}</bdi></span>${upd}</div>`;
  else if(o.phoneHint)h+=`<div class="secrow" style="margin:4px 0;flex-wrap:wrap"><span><b>טלפון מהמייל:</b> <bdi dir="ltr">${esc(o.phoneHint)}</bdi></span><button class="chip" data-a="secOrdOp" data-k="phone" style="min-height:44px"${ed?'':' disabled'}>אישור הטלפון</button>${upd}</div>${ed&&!o.custId?'<small class="note">כדי לשמור את הטלפון בכרטיס הלקוח – בחרו לקוח קודם.</small>':''}`;
  else h+='<p class="note" style="margin:4px 0">אין טלפון – בטקסט ללקוח יתווסף בקשה לשלוח מספר.</p>'}
 /* סניף */
 if(ed||fail){const B=o.brs||[];if(B.length)h+=`<label class="f" style="display:block;margin:4px 0"><span><b>סניף</b>${o.brDef&&o.br?' <small class="note">(ברירת מחדל – ודאו שזה הסניף הנכון)</small>':''}</span><select class="secin" data-c="secOrdBr" aria-label="סניף" style="min-height:44px"${ed?'':' disabled'}>${o.br?'':'<option value="">בחרו סניף…</option>'}${B.map(b=>`<option value="${esc(b.id)}"${b.id===o.br?' selected':''}>${esc(b.name)}</option>`).join('')}</select></label>`;
  else if(!o.br&&ed)h+='<button class="chip" data-a="secOrdOp" data-k="br" data-br="_" style="min-height:44px">אישור (עסק בלי סניפים)</button>'}
 if(o.catCut)h+='<p class="note" style="margin:4px 0;color:var(--warn)">חלק מהקטלוג לא נבדק (קטלוג גדול) – בדקו את השורות.</p>';
 /* שורות */
 h+=`<div style="margin-top:6px"><b>שורות</b>${(o.lines||[]).length?(o.lines||[]).map((l,i)=>ordLineH(l,i,ed)).join(''):'<p class="note" style="margin:4px 0">אין שורות</p>'}</div>`;
 h+=`<p style="margin:6px 0"><b>סה"כ (שורות עם מחיר): ${ordM(o.total)}</b>${o.nBlock?` <small class="note">· ${esc(String(o.nBlock))} שורות לבחירה/לבירור/אזלו לא נספרו</small>`:''}</p>`;
 if(blk.length)h+=`<div class="secin1" style="margin:6px 0"><b>לא ניתן לשלוח עדיין</b><ul style="margin:4px 0 0;padding-inline-start:18px">${blk.map(k=>'<li>'+esc(ORDNO[k]||k)+'</li>').join('')}</ul></div>`;
 if(o.text)h+=`<details style="margin:6px 0"${ed||stuck?' open':''}><summary style="min-height:44px"><b>הטקסט שיישלח ללקוח</b></summary><div class="secin1" dir="auto" style="white-space:pre-wrap">${esc(o.text)}</div></details>`;
 if(ed)h+=`<div class="secrow"><button class="btn" data-a="secOrdSend" style="flex:1;min-height:44px"${blk.length?' disabled':''}>שלח ללקוח מה-Gmail של העסק</button></div><small class="note">הטיוטה יוצאת רק בלחיצה שלך. המחירים תמיד מהקטלוג.</small>`;
 else if(fail&&!stuck)h+=`<p class="note" style="margin:6px 0;color:var(--bad)">השליחה הקודמת נכשלה.</p><div class="secrow" style="flex-wrap:wrap"><button class="btn" data-a="secOrdSend" style="flex:1;min-height:44px"${blk.length?' disabled':''}>נסה לשלוח שוב</button><button class="chip" data-a="secOrdReset" style="min-height:44px">חזרה לעריכה</button></div>`;
 else if(stuck)h+=`<div class="secrow"><button class="btn" data-a="secOrdMark" style="flex:1;min-height:44px">סמן נשלח</button></div>`;
 else if(o.st==='sending')h+='<p class="note" style="margin:6px 0">השליחה בדרך…</p>';
 return h+`<div class="secrow" style="margin-top:6px"><button class="chip" data-a="secOrdRe" style="min-height:44px">רענון</button></div></div>`}
/* שליחה לבד של הזמנות לכל לקוח (ordAuto) */
async function oaLoad(){const A=X.ml.oa;X.oab=1;try{const r=await fnCall('secMail',{op:'ordAuto',act:'list'});if(X.ml&&X.ml.oa===A){A.on=r.on||[];A.ask=r.ask||[];A.load=0;A.err=''}}catch(e){if(X.ml&&X.ml.oa===A){A.load=0;A.err=e&&e.message||'לא נטען'}}finally{X.oab=0;if(cur().v==='sec'&&!typing())rerender()}}
function oaH(){const A=X.ml.oa,back='<button class="btn g w" data-a="secMlBack" style="margin-bottom:8px">חזרה לתיבת המייל</button>';
 if(A.load){if(!X.oab)oaLoad();return back+'<div class="empty">טוען…</div>'}if(A.err)return back+`<div class="card"><p class="note">${esc(A.err)}</p><button class="btn g w" data-a="secOaOpen">נסה שוב</button></div>`;
 const row=(c,b)=>`<div class="secli"><p><b>${esc(c.name||'לקוח')}</b>${c.at?' <small class="note">· '+esc(fmtAt(c.at))+'</small>':''}</p><div class="secrow" style="flex-wrap:wrap">${b}</div></div>`,btn=(a,c,t,cl)=>`<button class="${cl||'chip'}" data-a="secOaAct" data-act="${a}" data-id="${esc(c.custId)}" style="min-height:44px">${t}</button>`;
 return back+`<div class="card"><b>שליחה לבד של הזמנות</b><p class="note" style="margin:4px 0 0">טיוטת הזמנה נשלחת ללקוח בלי לחכות לך רק אם היא נקייה (בלי שורות לבחירה, לבירור או אזלו), המחירים מהקטלוג, והלקוח מאומת (המייל שנשלח הוא המייל שבכרטיס הלקוח). בכל מקרה אחר הטיוטה נשארת לאישורך. אפשר לכבות בכל רגע.</p></div>
 <div class="sec"><h3>ממתינים לאישורך</h3></div><div class="card" id="secOaAsk">${(A.ask||[]).length?A.ask.map(c=>row(c,btn('on',c,'אשר שליחה לבד','btn')+btn('no',c,'לא'))).join(''):'<p class="note" style="margin:0">אין לקוחות שממתינים לאישור. אחרי שליחה ידנית של טיוטה נקייה המזכירה תציע שליחה לבד.</p>'}</div>
 <div class="sec"><h3>נשלח לבד</h3></div><div class="card" id="secOaOn">${(A.on||[]).length?A.on.map(c=>row(c,btn('off',c,'כבה'))).join(''):'<p class="note" style="margin:0">אין לקוחות עם שליחה לבד</p>'}</div>`}
ACT.secOaOpen=()=>{X.set=0;X.tab='mail';X.ml=X.ml||{f:'all'};X.ml.cur=null;X.ml.card=null;X.ml.clean=null;X.ml.au=null;X.ml.oa={load:1};rerender()};
ACT.secOaAct=async el=>{const d=el.dataset;el.disabled=true;try{await fnCall('secMail',{op:'ordAuto',act:d.act,custId:d.id});toast(d.act==='on'?'השליחה לבד הופעלה ללקוח':d.act==='off'?'השליחה לבד כובתה':'לא נשלח לבד, לא נשאל שוב');X.ml.oa={load:1}}catch(e){merr(e)}finally{el.disabled=false;rerender()}};
/* ---------- סבב ממשק שלב ב: דיוק טיוטה, מענה אוטומטי, הצעות כללים, "נשלח אוטומטית", עצירה ---------- */
const MERR={'maybe-sent':'ייתכן שהמייל כבר נשלח – בדקו בתיקייה "נשלח" ב-Gmail. אם הוא שם, אל תשלחו שוב.','not-stuck':'אפשר לסמן "נשלח" רק לטיוטה שהשליחה שלה לא הסתיימה','no-draft':'אין טיוטה למייל הזה','not-pending':'הטיוטה כבר לא ממתינה (נשלחה או טופלה)','sus':'המייל מסומן כחשוד – אי אפשר להכין לו טיוטה','saving':'הטיוטה בשמירה כרגע, נסו שוב בעוד רגע','bad-note':'ההנחיה חייבת להיות באורך 1 עד 500 תווים','not-auto':'הכלל הזה אינו אוטומטי','src-missing':'אי אפשר להפעיל: מקור המידע של הכלל חסר בבנק המידע','bad-tpl':'התבנית חייבת לכלול שדה קיים וציבורי בסוגריים מסולסלים, למשל {{hours}}'};
const merr=e=>toast(e&&e.reason&&MERR[e.reason]||e&&e.message||'הפעולה נכשלה');
const REPW={cap:'הגעת לתקרת הטיוטות האוטומטיות להיום'};
async function repLoad(){X.repb=1;try{const r=await fnCall('secMail',{op:'repGet'});X.rep=r&&typeof r.auto==='boolean'?r:{err:'לא נטען'}}catch(e){X.rep={err:e&&e.message||'לא נטען'}}finally{X.repb=0;if(cur().v==='sec'&&!typing())rerender()}}
function repSetH(inner){const r=X.rep;if(!r){if(!X.repb)repLoad();return '<div class="empty">טוען…</div>'}if(r.err)return `<div class="card" style="margin-bottom:8px"><p class="note" style="margin:0 0 6px">${esc(r.err)}</p><button class="chip" data-a="secMlRepRe" style="min-height:40px">נסה שוב</button></div>`;return inner(r)}
const heldH=r=>r.held?`<div class="card secwarn" id="secMlHeld" style="margin-bottom:8px" role="status"><b>המענה האוטומטי במייל נעצר</b><p class="note" style="margin:4px 0 8px">אחרי ${esc(String(r.autoDay||100))} תשובות אוטומטיות ביום המזכירה עצרה את עצמה${r.held.at?' ('+esc(fmtAt(r.held.at))+')':''}. העצירה נשארת עד שתפעילו מחדש ידנית. עד אז כל תשובה יוצאת רק בלחיצה שלך.</p><button class="btn w" data-a="secMlRepOn">הפעל שוב</button></div>`:'';
function repPanelH(full){return repSetH(r=>`${heldH(r)}<div class="card" id="secMlRep" style="margin-bottom:8px"><label class="chip" style="min-height:44px;width:100%;justify-content:flex-start"><input type="checkbox" data-c="secMlAuto"${r.auto?' checked':''}> מענה אוטומטי במייל</label><p class="note" style="margin:4px 0 0">${r.auto?'שאלה שמתאימה לכלל אוטומטי נענית בלי לחכות לך (רק לשולח מאומת, בלי קובץ מצורף). ':'כבוי: כל תשובה יוצאת רק בלחיצה שלך. '}${r.cap?'היום: '+esc(String(r.drafts||0))+' טיוטות מתוך '+esc(String(r.cap))+', '+esc(String(r.sent||0))+' נשלחו אוטומטית.':'טיוטות אוטומטיות כבויות על ידי מנהל המערכת.'}</p>${full?'<div class="secrow" style="margin-top:8px"><button class="chip" data-a="secMlAu" style="min-height:44px">נשלח אוטומטית</button><button class="chip" data-a="secOaOpen" style="min-height:44px">שליחה לבד של הזמנות</button></div>':''}</div>`)}
function mailSetH(){return `<div class="card" style="margin-top:8px"><b>מענה אוטומטי במייל</b><div style="margin-top:6px">${repPanelH(false)}</div><div class="secrow"><button class="chip" data-a="secOaOpen" style="min-height:44px">שליחה לבד של הזמנות</button></div><div class="secrow"><button class="chip" data-a="secStop" data-on="${X.wc&&X.wc.stop&&X.wc.stop.on?0:1}" style="min-height:44px">${X.wc&&X.wc.stop&&X.wc.stop.on?'ביטול "עצור הכל"':'⏸ עצור הכל (ווצאפ ומייל)'}</button></div></div>`}
CHG.secMlAuto=async el=>{const on=!!el.checked;el.disabled=true;try{const r=await fnCall('secMail',{op:'repSet',auto:on});X.rep=r;toast(on?'המענה האוטומטי הופעל':'המענה האוטומטי כובה')}catch(e){merr(e);X.rep=null}finally{rerender()}};
ACT.secMlRepOn=async el=>{el.disabled=true;try{X.rep=await fnCall('secMail',{op:'repSet',auto:true});toast('המענה האוטומטי הופעל מחדש')}catch(e){merr(e)}finally{rerender()}};
ACT.secMlRepRe=()=>{X.rep=null;rerender()};
/* מעבר למשימה שנפתחה מהמייל (tasks/m-<מזהה המייל>): לשונית הפתוחות, גלילה לכרטיס וסימון; סגורה / לא נמצאה – הודעה (דפוס ACT.tkGoIt) */
ACT.secMlTask=el=>{const id=String(el.dataset.id||(X.ml.cur?'m-'+X.ml.cur:''));TKT='open';go('tk');if(!id)return;let n=0;
 const look=()=>{const c=document.getElementById('tkc-'+id),t=tkGet(id);if(c){c.scrollIntoView({block:'start'});c.style.outline='2px solid var(--acc)';setTimeout(()=>{c.style.outline=''},2500);return}
  if((t&&t.st==='done')||++n>=10)return toast(t&&t.st==='done'?'המשימה כבר סגורה':'המשימה לא נמצאה ברשימת הפתוחות');setTimeout(look,300)};setTimeout(look,200)};
ACT.secMlRefine=async el=>{const t=document.getElementById('secMlNote'),note=t?t.value.trim():'';if(!note)return toast('כתבו הנחיה לדיוק');if(note.length>500)return toast(MERR['bad-note']);
 el.disabled=true;try{const r=await fnCall('secMail',{op:'refine',id:X.ml.cur,note});if(X.ml.card&&r&&r.draft){X.ml.card.draft=r.draft;toast('הטיוטה עודכנה – קראו ואשרו לפני שליחה')}}catch(e){merr(e)}finally{el.disabled=false;rerender()}};
/* הצעות כללים: תבנית התשובה מוצגת במלואה וניתנת לעריכה (היא עלולה לכלול פרטים אישיים מהתשובה שנשלחה) */
function offerDlg(o){if(!o||!o.learn)return;X.ml=X.ml||{};X.ml.off=o;
 dlg(`<h3>להוסיף תשובה אוטומטית?</h3><p class="note" style="margin:0 0 6px">${o.clsL?'סוג: '+esc(o.clsL)+'. ':''}שאלות דומות יענו אוטומטית לפי התבנית שלמטה, בלי לחכות לך.</p>
 ${(o.q||[]).length?'<b>השאלה</b><div class="secin1" dir="auto" style="white-space:pre-wrap;margin:4px 0 8px">'+(o.q||[]).map(esc).join('\n')+'</div>':''}
 <b>תבנית התשובה (נשלחת כמו שהיא)</b><textarea class="secin" id="secOfA" maxlength="5000" dir="auto" aria-label="תבנית התשובה" style="width:100%;min-height:120px;box-sizing:border-box;margin-top:4px">${esc(o.a||'')}</textarea>
 <p class="note secwarn" style="margin:6px 0;border:1px solid var(--acc);border-radius:8px;padding:6px">חשוב: התבנית נבנתה מהתשובה ששלחת ועלולה לכלול שם, טלפון, כתובת או פרט אישי אחר. עברו עליה ומחקו כל פרט אישי לפני האישור. אפשר להשאיר שדות בסוגריים מסולסלים, כמו {{hours}}.</p>
 ${o.preview?'<small class="note">איך זה ייראה (דוגמה):</small><div class="secin1" dir="auto" style="white-space:pre-wrap;margin:4px 0 8px">'+esc(o.preview)+'</div>':''}
 <div class="row"><button class="btn grow" data-a="secOfOk">כן, צור כלל</button><button class="btn g grow" data-a="closeDlg">לא עכשיו</button></div><button class="chip" data-a="secOfNo" style="margin-top:8px;min-height:44px">לא להציע שוב</button>`)}
ACT.secOfOk=async el=>{const o=X.ml&&X.ml.off;if(!o)return;const t=document.getElementById('secOfA'),a=t?t.value.trim():'';if(!a)return toast('התבנית ריקה');const d={learn:o.learn};if(a!==o.a)d.a=a;
 el.disabled=true;try{await fnCall('secMail',{op:'ruleOk',...d});toast('הכלל נוצר');if(X.ml.of)X.ml.of=X.ml.of.filter(x=>x.learn!==o.learn);X.ml.off=null;X.rl=null;closeDlg()}catch(e){merr(e)}finally{el.disabled=false;rerender()}};
ACT.secOfNo=async el=>{const o=X.ml&&X.ml.off;if(!o)return;el.disabled=true;try{await fnCall('secMail',{op:'ruleNo',learn:o.learn});toast('לא נציע שוב');if(X.ml.of)X.ml.of=X.ml.of.filter(x=>x.learn!==o.learn);X.ml.off=null;closeDlg()}catch(e){merr(e)}finally{el.disabled=false;rerender()}};
async function ofLoad(){X.ofb=1;try{const r=await fnCall('secMail',{op:'offers'});if(X.ml)X.ml.of=r&&Array.isArray(r.offers)?r.offers:[]}catch(e){if(X.ml)X.ml.of=[]}finally{X.ofb=0;if(cur().v==='sec'&&!typing())rerender()}}
function offersCardH(){if(!X.ml.of){if(!X.ofb)ofLoad();return ''}const n=X.ml.of.length;if(!n)return '';
 return `<div class="card secwarn" id="secMlOffers" style="margin-bottom:8px"><b>${n===1?'הצעה אחת לתשובה אוטומטית':n+' הצעות לתשובות אוטומטיות'}</b><p class="note" style="margin:4px 0 8px">המזכירה זיהתה שאלות שחוזרות. כלל נוצר רק באישורך, אחרי שתעברו על התבנית.</p><button class="btn w" data-a="secOfOpen">לצפייה ואישור</button></div>`}
ACT.secOfOpen=()=>{const o=(X.ml.of||[])[0];if(o)offerDlg(o)};
/* "נשלח אוטומטית": רשימת השליחות וכיבוי לכל כלל */
async function auLoad(){X.aub=1;try{const r=await fnCall('secMail',{op:'autoList'});X.ml.au=r&&Array.isArray(r.items)?r:{err:'לא נטען'}}catch(e){X.ml.au={err:e&&e.message||'לא נטען'}}finally{X.aub=0;if(cur().v==='sec'&&!typing())rerender()}}
ACT.secMlAu=()=>{X.ml.au={load:1};rerender()};
function autoH(){const A=X.ml.au,back='<button class="btn g w" data-a="secMlBack" style="margin-bottom:8px">חזרה לתיבת המייל</button>';
 if(A.load){if(!X.aub)auLoad();return back+'<div class="empty">טוען…</div>'}if(A.err)return back+`<div class="card"><p class="note">${esc(A.err)}</p><button class="btn g w" data-a="secMlAu">נסה שוב</button></div>`;
 const R=A.rules||[],I=A.items||[];
 return back+heldH(A.rep||X.rep||{})+`<div class="sec"><h3>כללים אוטומטיים</h3></div><div class="card" id="secAuRules">${R.length?R.map(r=>`<div class="secli"><p><b>${esc((r.q||[]).join(' / '))}</b> ${r.on&&!r.autoOff?'<span class="sectags g">פעיל</span>':'<span class="sectags w">כבוי</span>'}${r.ch==='mail'?' <span class="sectags">מייל</span>':r.ch==='wa'?' <span class="sectags">ווצאפ</span>':''}</p><small class="note" style="display:block;white-space:pre-wrap">${esc(r.a)}</small>${r.autoOff&&r.offWhy?`<small class="note" style="display:block;color:var(--bad)">נכבה אוטומטית: ${esc(r.offWhy)}</small>`:''}${(r.facts||[]).length?`<small class="note" style="display:block">מקור הנתונים: ${r.facts.map(esc).join(', ')}</small>`:''}<small class="note" style="display:block">נשלחה ${esc(String(r.n||0))} פעמים${r.lastAt?' · לאחרונה '+esc(fmtAt(r.lastAt)):''}</small><div class="secrow"><button class="chip" data-a="secAuTog" data-id="${esc(r.id)}" data-on="${r.on&&!r.autoOff?0:1}" style="min-height:44px">${r.on&&!r.autoOff?'כבה מענה אוטומטי':'הפעל מענה אוטומטי'}</button></div></div>`).join(''):'<p class="note" style="margin:0">אין עדיין כללים אוטומטיים</p>'}</div>
 <div class="sec"><h3>נשלח אוטומטית</h3></div><div class="card secml" id="secAuItems">${I.length?I.map(i=>`<div class="secli"><p><b>${esc(i.subj||'(בלי נושא)')}</b> <span class="sectags g">אוטומטי</span></p><small class="note" style="display:block">אל <bdi dir="ltr" class="secaddr">${esc(i.to)}</bdi> · ${esc(tm(i.sentAt))}</small><small class="note" style="display:block;white-space:pre-wrap">${esc(i.text)}</small></div>`).join(''):'<p class="note" style="margin:0">עוד לא נשלחה תשובה אוטומטית</p>'}</div>`}
ACT.secAuTog=async el=>{const on=el.dataset.on==='1';el.disabled=true;try{await fnCall('secMail',{op:'ruleAuto',id:el.dataset.id,on});toast(on?'המענה האוטומטי הופעל לכלל':'המענה האוטומטי כובה לכלל');X.ml.au={load:1};X.rl=null}catch(e){merr(e)}finally{el.disabled=false;rerender()}};
/* ---------- רשימת ניקוי ספאם – אישור מנהל העסק (פ3) ---------- */
ACT.secClOpen=()=>{X.ml.clean={L:null};rerender()};
async function clLoad(){X.clb=1;try{const r=await fnCall('secMail',{op:'cleanList'});X.ml.clean.L=r&&Array.isArray(r.lists)?r.lists:[]}catch(e){X.ml.clean.L={err:e&&e.message||'לא נטען'}}finally{X.clb=0;if(cur().v==='sec'&&!typing())rerender()}}
const clK=i=>String(i.f||'').toLowerCase().trim();
function clGroups(l){const M=new Map();for(const i of l.items||[]){if(!i||i.r==='t')continue;const k=clK(i);let g=M.get(k);if(!g){g={k,n:0,z:0,A:[]};M.set(k,g)}g.n++;g.z+=i.z||0;g.A.push(i)}return[...M.values()].sort((a,b)=>b.z-a.z)}
const clOff=()=>{const C=X.ml.clean;return C.off||(C.off={})},clOp=()=>{const C=X.ml.clean;return C.op||(C.op={})};
const clList=id=>{const L=(X.ml.clean||{}).L;return Array.isArray(L)?L.find(l=>l.id===id):null};
const clSel=l=>(l.items||[]).filter(i=>i&&i.r!=='t'&&!clOff()[i.g]).map(i=>i.g);
function clSenderH(l,g){const key=l.id+'|'+g.k,o=!!clOp()[key],off=clOff(),all=g.A.every(i=>!off[i.g]);
 return `<div class="card" style="margin:6px 0;padding:8px"><label class="seccl"><input type="checkbox" data-c="secClS" data-id="${esc(l.id)}" data-k="${esc(g.k)}"${all?' checked':''}><span><b><bdi dir="ltr" class="secaddr">${esc(g.k||'שולח לא ידוע')}</bdi></b><br><small class="note">${g.n} מיילים · <bdi dir="ltr">${esc(kb(g.z))}</bdi></small></span></label>
 <div class="secrow" style="margin-top:4px"><button type="button" class="chip" data-a="secClOp" data-id="${esc(l.id)}" data-k="${esc(g.k)}" style="min-height:40px">${o?'סגירה':'פתיחה'}</button><button type="button" class="chip" data-a="secClSn" data-id="${esc(l.id)}" data-k="${esc(g.k)}" style="min-height:40px">העבר לאשפה את כל השולח</button></div>
 ${o?g.A.map(i=>`<label class="seccl"><input type="checkbox" data-c="secClI" data-id="${esc(l.id)}" data-k="${esc(g.k)}" data-g="${esc(i.g)}"${off[i.g]?'':' checked'}><span><b>${esc(i.s||'(בלי נושא)')}</b><br><small class="note">${i.d?esc(tm(i.d))+' · ':''}<bdi dir="ltr">${esc(kb(i.z))}</bdi> · ${esc(WHY[i.w]||'')}${i.r==='f'?' · ההעברה נכשלה, אפשר לנסות שוב':''}</small></span></label>`).join(''):''}</div>`}
function cleanH(){const C=X.ml.clean,back='<button class="btn g w" data-a="secMlBack" style="margin-bottom:8px">חזרה לתיבת המייל</button>';
 if(!C.L){if(!X.clb)clLoad();return back+'<div class="empty">טוען…</div>'}if(C.L.err)return back+`<div class="card"><p class="note">${esc(C.L.err)}</p></div>`;
 const P=C.L.filter(l=>l.st==='pend'),D=C.L.filter(l=>l.st!=='pend');
 let h=back+(P.length?'':'<div class="card"><p class="note" style="margin:0">אין רשימה שממתינה לאישור.</p></div>');
 for(const l of P){const G=clGroups(l),n=G.reduce((s,g)=>s+g.n,0),z=G.reduce((s,g)=>s+g.z,0);
  h+=`<form class="card" data-f="secClOk" data-id="${esc(l.id)}" id="secCl_${esc(l.id)}" style="margin-bottom:8px"><b>רשימת ניקוי · ${esc(l.rangeL||'')}</b><p class="note" style="margin:4px 0">${n} מיילים מ-${G.length} שולחים · כ-<bdi dir="ltr">${esc(kb(z))}</bdi>. המסומנים יועברו <b>לאשפה</b> של Gmail – לא נמחקים לצמיתות, ואפשר לשחזר אותם מהאשפה ב-Gmail (שם הם נמחקים אוטומטית אחרי כחודש). אפשר לאשר שולח אחד בכל פעם; מה שנשאר יישאר ברשימה.</p>
  <div class="secrow" style="margin:4px 0"><button type="button" class="chip" data-a="secClAll" data-id="${esc(l.id)}" data-v="1">סמן הכול</button><button type="button" class="chip" data-a="secClAll" data-id="${esc(l.id)}" data-v="0">נקה סימון</button></div>
  ${G.map(g=>clSenderH(l,g)).join('')}
  <div class="secrow" style="margin-top:8px"><button class="btn" style="flex:1">העברה לאשפה (המסומנים)</button><button type="button" class="chip" data-a="secClNo" data-id="${esc(l.id)}" style="min-height:44px">דחיית הרשימה</button></div></form>`}
 if(D.length)h+=`<div class="sec"><h3>רשימות קודמות</h3></div><div class="card">${D.map(l=>`<p class="note" style="margin:4px 0">${esc(tm(l.t))} · ${esc(l.rangeL||'')} · ${l.st==='done'?'הועברו לאשפה '+l.trashed+(l.failed?' (נכשלו '+l.failed+')':''):l.st==='rej'?'נדחתה':'בטיפול'}</p>`).join('')}</div>`;
 return h}
/* הסימונים נשמרים במודל (לא רק ב-DOM), כי מיילים של שולח סגור לא מצוירים */
function clSync(f){const off=clOff();f.querySelectorAll('input[data-c=secClI]').forEach(i=>{i.checked=!off[i.dataset.g]});f.querySelectorAll('input[data-c=secClS]').forEach(s=>{const l=clList(s.dataset.id);const g=l&&clGroups(l).find(x=>x.k===s.dataset.k);s.checked=!!g&&g.A.every(i=>!off[i.g])})}
CHG.secClS=el=>{const l=clList(el.dataset.id),g=l&&clGroups(l).find(x=>x.k===el.dataset.k);if(!g)return;const off=clOff();g.A.forEach(i=>{if(el.checked)delete off[i.g];else off[i.g]=1});clSync(el.closest('form'))};
CHG.secClI=el=>{const off=clOff();if(el.checked)delete off[el.dataset.g];else off[el.dataset.g]=1;clSync(el.closest('form'))};
ACT.secClAll=el=>{const l=clList(el.dataset.id);if(!l)return;const off=clOff();(l.items||[]).forEach(i=>{if(el.dataset.v==='1')delete off[i.g];else off[i.g]=1});const f=document.getElementById('secCl_'+el.dataset.id);if(f)clSync(f)};
ACT.secClOp=el=>{const o=clOp(),k=el.dataset.id+'|'+el.dataset.k;if(o[k])delete o[k];else o[k]=1;rerender()};
function clDo(id,ids,q,btn){if(!ids.length)return toast('לא סומנו מיילים');
 ask(q,async()=>{if(btn)btn.disabled=true;try{const r=await fnCall('secMail',{op:'cleanOk',id,ids});toast(r&&r.already?'המיילים האלה כבר הועברו לאשפה':'הועברו לאשפה: '+r.trashed+(r.failed?' · נכשלו: '+r.failed:'')+(r.st==='pend'&&r.left?' · נשארו ברשימה: '+r.left:''));X.ml.clean={L:null,off:{},op:clOp()};X.ml.list=null}catch(e){err(e)}finally{if(btn)btn.disabled=false;rerender()}},'העברה לאשפה')}
FRM.secClOk=f=>{const l=clList(f.dataset.id);if(!l)return;const ids=clSel(l);clDo(f.dataset.id,ids,`להעביר ${ids.length} מיילים לאשפה של Gmail? אפשר לשחזר אותם מהאשפה ב-Gmail.`,f.querySelector('button.btn'))};
ACT.secClSn=el=>{const l=clList(el.dataset.id),g=l&&clGroups(l).find(x=>x.k===el.dataset.k);if(!g)return;clDo(l.id,g.A.map(i=>i.g),`להעביר לאשפה את כל ${g.n} המיילים של ${g.k||'שולח לא ידוע'} (בלי קשר לסימונים)? אפשר לשחזר אותם מהאשפה ב-Gmail.`,el)};
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
{const t0=ACT.secTab;ACT.secTab=el=>{if(el.dataset.v==='mail'){X.ml={f:X.ml&&X.ml.f||'all',list:X.ml&&X.ml.list||null,cur:null,card:null,clean:null};X.rep=null;swr(X.ml,'list','mlb',mlLoad)}t0(el)}}
{const s0=ACT.secSet;ACT.secSet=()=>{X.gs=null;s0()}}
{const r6=V.sec;V.sec=()=>{const k=keyNow();if(X.mlKey!==k){X.mlKey=k;X.ml=null;X.gs=null;X.rep=null}
 if(elig()&&ready()&&X.st&&X.st.setupDone&&!X.edit&&!X.set&&X.tab==='mail'){X.ml=X.ml||{f:'all'};const S=X.st;return{t:S.name||'המזכירה',s:'מייל',h:stopH()+tabsH()+mailH()}}
 return r6()}}
/* ---------- מנהל־על: בכרטיס העסק – Gmail ---------- */
const SG={};
const sgLoad=id=>{SG[id]=null;window.fnCall('secAdminMail',{bizId:id,op:'get'}).then(r=>{SG[id]=r&&r.ok?r:{err:'לא נטען'}}).catch(e=>{SG[id]={err:e&&e.message||'שגיאה'}}).finally(()=>{if(cur().v==='sab')rerender()})};
const RG=[['all','הכול'],['12','12 חודשים'],['6','6 חודשים'],['1','חודש'],['none','בכלל לא']];
const sgDate=ms=>new Date(ms).toLocaleDateString('he-IL');
function sgInvH(id,c){const nc=+c.noCapUntil||0,on=nc>Date.now(),hi=c.histInv||{},e=esc(id);
 return `<div class="card" style="margin-top:8px" id="secSgInv"><b>חשבוניות ממיילים ישנים</b>
 <label class="chip" style="min-height:44px;margin-top:6px"><input type="checkbox" data-c="secSgAuto" data-id="${e}"${c.auto.on?' checked':''}> חיפוש חשבוניות ישנות בחיבור ראשון</label>
 <p class="note" style="margin:4px 0">${c.auto.on?'כשמחברים תיבה בפעם הראשונה, נסרקים 12 חודשים אחורה בהדרגה.':'כבוי: חיבור תיבה לא מתחיל סריקה.'}</p>
 <p class="note" style="margin:4px 0" id="secSgNc">${on?'<b>ללא הגבלה עד '+esc(sgDate(nc))+'</b>':'מוגבל: '+esc(String(hi.day||0))+' מתוך '+esc(String(hi.dayMax||30))+' היום'}, ממתינים ${esc(String(hi.wait||0))}</p>
 <div class="row" style="align-items:flex-end"><label class="f grow"><span>ביטול הגבלת סריקה עד תאריך (עד ${esc(String(c.noCapMaxDays||31))} ימים)</span><input type="date" id="secSgNcD" dir="ltr" min="${esc(new Date().toISOString().slice(0,10))}" max="${esc(new Date(Date.now()+(c.noCapMaxDays||31)*864e5).toISOString().slice(0,10))}"></label><button class="btn" data-a="secSgNoCap" data-id="${e}">ביטול הגבלה</button></div>
 ${on?`<button class="btn g w" data-a="secSgNoCapOff" data-id="${e}" style="margin-top:6px">החזר הגבלה</button>`:''}</div>`}
async function sgCall(id,d,msg,el){if(el)el.disabled=true;try{const rg=(SG[id]||{}).rg;SG[id]=Object.assign(await window.fnCall('secAdminMail',Object.assign({bizId:id},d)),{rg});toast(msg)}catch(e){err(e)}finally{if(el)el.disabled=false;if(cur().v==='sab')rerender()}}
CHG.secSgAuto=el=>sgCall(el.dataset.id,{op:'histAuto',on:!!el.checked},el.checked?'החיפוש האוטומטי הופעל':'החיפוש האוטומטי כובה',el);
ACT.secSgNoCap=el=>{const v=(document.getElementById('secSgNcD')||{}).value||'';if(!/^\d{4}-\d{2}-\d{2}$/.test(v))return toast('בחר תאריך');const now=Date.now(),max=now+31*864e5-6e4;let u=new Date(v+'T23:59:00').getTime();if(!(u>now))return toast('בחר תאריך עתידי');if(u>max)u=max;sgCall(el.dataset.id,{op:'histNoCap',until:u},'ההגבלה בוטלה עד '+sgDate(u),el)};
ACT.secSgNoCapOff=el=>sgCall(el.dataset.id,{op:'histNoCap',until:0},'ההגבלה הוחזרה',el);
{const s6=V.sab;if(s6)V.sab=id=>{const r=s6(id);try{const b=(ADM.L||[]).find(x=>x.id===id);if(!SY.sa||!b||(b.missing&&id!==BZ0)||!r||!r.h||!(b.features&&b.features.secretary===true))return r;
 if(SG[id]===undefined)sgLoad(id);const c=SG[id];let h='<div class="sec"><h3>המזכירה – Gmail</h3></div>';
 if(!c){r.h+=h+'<div class="empty">טוען…</div>';return r}if(c.err){r.h+=h+`<div class="card"><p class="note">${esc(c.err)}</p></div>`;return r}
 const ct=c.count,rg=c.rg||'12';
 h+=`<form class="card" data-f="secSgMax" data-id="${esc(id)}" id="secSgMax"><label class="f"><span>מספר תיבות Gmail לעסק (ברירת מחדל ${esc(String(c.maxDefault))}; 0 = בלי מייל)</span><input name="max" inputmode="numeric" dir="ltr" maxlength="2" value="${esc(String(c.max))}"></label><button class="btn w" style="margin-top:6px">שמירה</button></form>
 ${c.rep?`<form class="card" data-f="secSgCap" data-id="${esc(id)}" id="secSgCap" style="margin-top:8px"><label class="f"><span>תקרת טיוטות אוטומטיות ביום (0 עד ${esc(String(c.rep.capMax!=null?c.rep.capMax:500))}; 0 = כבוי${c.rep.capDefault!=null?'; ברירת מחדל '+esc(String(c.rep.capDefault)):''})</span><input name="cap" inputmode="numeric" dir="ltr" maxlength="3" value="${esc(String(c.rep.cap!=null?c.rep.cap:''))}"></label><button class="btn w" style="margin-top:6px">שמירה</button></form>`:''}
 <div class="card" style="margin-top:8px"><b>תיבות מחוברות</b>${(c.boxes||[]).length?c.boxes.map(x=>`<div class="secrow" style="margin:6px 0"><span style="flex:1 1 100%" class="secaddr"><bdi dir="ltr">${esc(x.addr)}</bdi> ${x.st==='expired'?'<span class="sectags w">פג</span>':'<span class="sectags g">מחובר</span>'}${x.clean?' <span class="sectags">ניקוי</span>':''}</span><button class="chip" data-a="secSgOff" data-id="${esc(id)}" data-box="${esc(x.id)}" style="min-height:40px">ניתוק</button></div>`).join(''):'<p class="note" style="margin:4px 0 0">אין. מנהל העסק מחבר מהגדרות המזכירה.</p>'}</div>
 <div class="card" style="margin-top:8px" id="secSgScan"><b>סריקת היסטוריה וניקוי ספאם</b><p class="note" style="margin:4px 0">קודם סופרים ומציגים הערכת עלות, ורק אחרי אישור סורקים. המיילים מהטווח נקלטים לתיבת המזכירה <b>כרקע</b> – בהדרגה, בלי טיוטות ובלי שליחה – ואפשר לעצור באמצע. בנוסף הסריקה מכינה רשימת ניקוי (ספאם, פרסומות, גדולים וישנים) שעוברת <b>לאישור מנהל העסק</b>. שום מייל לא יועבר לאשפה בלי האישור שלו, ואין מחיקה לצמיתות.</p>
 <div class="chips" role="radiogroup" style="margin:6px 0">${RG.map(([k,l])=>`<label class="chip" style="min-height:44px"><input type="radio" name="secSgR_${esc(id)}" data-c="secSgR" data-id="${esc(id)}" value="${k}"${rg===k?' checked':''}> ${l}</label>`).join('')}</div>
 <button class="btn w" data-a="secSgCount" data-id="${esc(id)}">ספירה והערכת עלות</button>
 ${ct?`<div class="secin1" id="secSgCt">${ct.none?'נבחר "בכלל לא" – אין סריקה.':`<b>${esc(Number(ct.n).toLocaleString('he-IL'))}${ct.capped?'+':''} מיילים</b> בטווח "${esc((RG.find(x=>x[0]===ct.range)||[])[1]||'')}"${(ct.per||[]).length>1?'<br>'+ct.per.map(p=>'<bdi dir="ltr" class="secaddr">'+esc(p.addr)+'</bdi>: '+p.n).join(' · '):''}<br><small class="note">עלות הסריקה עצמה: 0 (בלי מודל AI). אם יסוכם כל מייל במודל: כ-${esc(usd(ct.est&&ct.est.aiIfSummarizedMc))} (הערכה, לא מאומת).</small><button class="btn" data-a="secSgRun" data-id="${esc(id)}" style="margin-top:8px;width:100%">אישור וסריקה (${esc(String(ct.n))} מיילים)</button>`}</div>`:''}
 ${c.hist?`<div class="secin1" id="secSgHist" style="margin-top:8px">קליטת היסטוריה (${esc(c.hist.rangeL||'')})${c.hist.auto?' <span class="sectags">התחיל אוטומטית</span>':''}: <b>${esc(Number(c.hist.n||0).toLocaleString('he-IL'))}</b> נקלטו${c.hist.total?' מתוך כ-'+esc(Number(c.hist.total).toLocaleString('he-IL')):''} – ${c.hist.st==='run'?'בתהליך (ממשיכה כל 15 דקות)':c.hist.st==='stop'?'נעצרה':c.hist.st==='cap'?'נעצרה – העסק בתקרת העלות החודשית':'הסתיימה'}${['run','cap'].includes(c.hist.st)?`<button class="btn" data-a="secSgHist" data-id="${esc(id)}" data-op="histStop" style="margin-top:8px;width:100%">עצירת הקליטה</button>`:''}${['stop','cap'].includes(c.hist.st)?`<button class="btn" data-a="secSgHist" data-id="${esc(id)}" data-op="histGo" style="margin-top:8px;width:100%">המשך הקליטה</button>`:''}</div>`:''}
 ${c.auto?sgInvH(id,c):''}
 ${(c.lists||[]).length?'<p class="note" style="margin:8px 0 0">רשימות: '+c.lists.map(l=>esc(tm(l.t))+' – '+l.n+' מיילים, '+(l.st==='pend'?'ממתינה לאישור מנהל העסק':l.st==='done'?'הועברו לאשפה '+l.trashed:l.st==='rej'?'נדחתה':'בטיפול')).join(' · ')+'</p>':''}</div>`;
 r.h+=h}catch(e){}return r}}
CHG.secSgR=el=>{const c=SG[el.dataset.id];if(c&&!c.err){c.rg=el.value;c.count=null;rerender()}};
FRM.secSgMax=async f=>{const id=f.dataset.id,v=String(fd(f).max||'').trim();if(!/^\d{1,2}$/.test(v)||+v>10)return toast('מספר תיבות: 0 עד 10');const b=f.querySelector('button');b.disabled=true;try{const rg=(SG[id]||{}).rg;SG[id]=Object.assign(await window.fnCall('secAdminMail',{bizId:id,op:'set',max:+v}),{rg});toast('נשמר')}catch(e){err(e)}finally{b.disabled=false;if(cur().v==='sab')rerender()}};
FRM.secSgCap=async f=>{const id=f.dataset.id,v=String(fd(f).cap||'').trim();if(!/^\d{1,3}$/.test(v)||+v>500)return toast('תקרה: מספר בין 0 ל-500');const b=f.querySelector('button');b.disabled=true;try{await window.fnCall('secAdminMail',{bizId:id,op:'repCap',cap:+v});toast('נשמר');sgLoad(id)}catch(e){toast(e&&e.reason&&MERR[e.reason]||e&&e.message||'הפעולה נכשלה')}finally{b.disabled=false;if(cur().v==='sab')rerender()}};
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
 it={id:lid,by:'המזכירה',ow:'',at:new Date(x.t||Date.now()).toISOString(),d,file:du?'i'+lid:'',np:0,sec:x.id,secK:x.k};if((x.src||[]).some(q=>q&&q.ch==='mail'))it.secM=1;if(ivFrom(x))it.secF=ivFrom(x);if(x.noStock||x.hist)it.noStock=1;
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
  if(!S.inbox.some(i=>i.id===it.id)&&!(x.hist||x.noStock))n++}}
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
 if(x.hist||x.noStock)tg.push('<span class="sectags">ממייל ישן</span>');
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
   /* 16.11 (בעל העסק): גם חשבונית שזוהתה – נפתחת קודם במסך הבדיקה (המסמך משמאל, מה שזוהה מימין, אפשר לשנות), ורק שם מאשרים */
   act=`<div class="secrow"><button class="btn" data-a="secIvEd" data-id="${id}" style="flex:1">${mineIn||x.mine?'המשך':'בדיקה ואישור'}</button>${view}${no}</div>`}
  else if(x.k==='rcpt'){const t=rcptOf(x);
   if(t)sug.push(`<div class="secivsug"><small>נמצאה חשבונית פתוחה: ${esc(t.inv||'')} · ${esc(ils(bal(t)))} לתשלום (${esc(dfmt(t.date))}). זו קבלה – לא הוצאה חדשה.</small><button class="btn w" style="margin-top:6px" data-a="secIvPay" data-id="${id}" data-t="${esc(t.id)}">סמן כשולם</button></div>`);
   else sug.push('<div class="secivsug"><small><b>קבלה בלי חשבונית – מה לעשות?</b> לא נמצאה חשבונית פתוחה מתאימה. אפשר לרשום כהוצאה (רק אם אין עליה חשבונית), או לדחות.</small></div>');
   act=`<div class="secrow">${t?'':`<button class="btn" data-a="secIvEd" data-id="${id}" style="flex:1">רישום כהוצאה</button>`}${view}${no}</div>`}
  else if(x.k==='dn')act=`<div class="secrow"><button class="btn" data-a="secIvEd" data-id="${id}" style="flex:1">רישום כתעודת משלוח</button>${view}${no}</div>`;
  else if(x.k==='chk')act=`<div class="secrow"><button class="btn" data-a="secIvOk" data-id="${id}" style="flex:1">שיוך לחשבונית</button>${view}${no}</div>`;
  else act=`<div class="secrow"><button class="btn" data-a="secIvEd" data-id="${id}" style="flex:1">פתיחה והזנה</button>${view}${no}</div>`;
  if(x.ns&&x.sub)act+=`<div class="secrow"><button class="chip" data-a="secIvSnd" data-id="${id}">אישור השולח כ${esc(x.subN||'ספק')}</button></div>`;
  if(ivFrom(x)&&!(IV.L&&IV.L.br))act+=`<div class="secrow"><button class="chip" data-a="secSpam" data-x="${id}">🚫 ספאם – חסימת השולח</button></div>`}
 const sub=[f.date?dfmt(f.date):'',x.k==='chk'?(f.no?'צ׳ק '+f.no:'')+(f.cdate?' · לפירעון '+dfmt(f.cdate):''):f.num?'מס׳ '+f.num:'',x.fn?x.fn:''].filter(Boolean).join(' · ');
 return `<div class="card secinv" id="secIv_${id}" style="margin-bottom:8px"><div class="ivh"><b>${esc(IVK[x.k]||'מסמך')}${supL?' · '+esc(supL):''}</b>${typeof a==='number'?`<span class="iva">${esc(ils(a))}</span>`:''}</div>
 ${sub?`<small class="note ivs">${esc(sub)}</small>`:''}<small class="note ivs">${esc(ivSrc(x))} · ${esc(tm(x.t))}</small>${tg.length?'<div class="sectg">'+tg.join('')+'</div>':''}${sug.join('')}${act}</div>`}
function ivSetH(){const R=IV.L;if(!R||R.err||R.br)return '';return ivSetH0()+ivBlkH()}
function ivSetH0(){const R=IV.L;const c=R.cfg||{},off=c.off||[],subs=S.subs.filter(s=>subOk(s)).sort((a,b)=>heCmp(a.name,b.name));
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
/* 16.11 (בעל העסק): שולחים חסומים (ספאם). חסימה: מייל חדש מהשולח לא נכנס ועובר לאשפה בג׳ימייל, וגם המיילים הקיימים ממנו עוברים לאשפה (מוריד את נפח התיבה; ג׳ימייל מרוקן את האשפה לבד אחרי 30 יום) */
const ivFrom=x=>{const q=(x&&x.src||[]).find(s=>s&&s.ch==='mail'&&s.from);return q?String(q.from).trim().toLowerCase():''};
function ivBlkH(){const B=IV.blk;if(B===undefined&&!IV.blkB){IV.blkB=1;fnCall('secMail',{op:'blkList'}).then(r=>{IV.blk=r}).catch(()=>{IV.blk=null}).finally(()=>{IV.blkB=0;rerender()})}
 const L=B&&B.list||[];
 return `<details class="card secivset" id="secIvBlk" style="margin-bottom:8px"${IV.bo?' open':''}><summary>שולחים חסומים (ספאם)${L.length?' · '+L.length:''}</summary>
 <p class="note" style="margin:4px 0 8px">מייל משולח חסום לא נכנס לאפליקציה ומועבר לאשפה בג׳ימייל. בחסימה גם המיילים הקיימים ממנו מועברים לאשפה. ג׳ימייל מוחק את האשפה לבד אחרי 30 יום, ועד אז אפשר להחזיר משם.</p>
 ${B&&!B.clean?'<p class="note" style="margin:0 0 8px;color:var(--bad)">התיבה מחוברת בלי הרשאת ניקוי, ולכן המיילים לא נמחקים מג׳ימייל – רק לא נכנסים לאפליקציה. כדי שיימחקו, חברו מחדש את התיבה עם הרשאת ניקוי בהגדרות המזכירה.</p>':''}
 <form data-f="secBlkAdd" class="row" style="align-items:flex-end"><label class="f grow"><span>כתובת מייל לחסימה</span><input name="addr" type="email" dir="ltr" inputmode="email" autocomplete="off" maxlength="254" placeholder="name@example.com"></label><button class="btn">חסימה</button></form>
 ${B===null?'<p class="note" style="margin:8px 0 0">לא ניתן לטעון את הרשימה כרגע. <button type="button" class="chip" data-a="secBlkRe">נסה שוב</button></p>':B===undefined?'<p class="note" style="margin:8px 0 0">טוען…</p>':L.length?L.map(b=>`<div class="secrow" style="flex-wrap:wrap;align-items:center"><bdi dir="ltr" style="flex:1;min-width:160px;overflow-wrap:anywhere">${esc(b.a)}</bdi><small class="note">${b.n?esc(String(b.n))+' הועברו לאשפה':''}</small><button class="chip" data-a="secBlkCl" data-v="${esc(b.a)}">ניקוי שוב</button><button class="chip" data-a="secBlkDel" data-v="${esc(b.a)}">ביטול חסימה</button></div>`).join(''):'<p class="note" style="margin:8px 0 0">אין שולחים חסומים.</p>'}</details>`}
function blkMsg(r){if(!r)return;let t='השולח נחסם';if(r.trashed)t+=' · '+r.trashed+' מיילים קיימים הועברו לאשפה בג׳ימייל';if(r.more)t+=' · נשארו עוד – אפשר "ניקוי שוב" בהגדרות';if(r.noScope)t+=' · בתיבה בלי הרשאת ניקוי המיילים לא נמחקים מג׳ימייל';if(r.fail)t+=' · חלק מהמיילים לא הועברו (תקלה) – אפשר "ניקוי שוב"';toast(t)}
function secBlk(a,after){ask('לחסום את '+a+'? מיילים חדשים ממנו לא ייכנסו ויועברו לאשפה בג׳ימייל, וגם המיילים הקיימים ממנו יועברו לאשפה. אפשר לבטל חסימה בהגדרות החשבוניות.',async()=>{try{const r=await fnCall('secMail',{op:'blkAdd',addr:a});IV.blk=r;if(after)await after();blkMsg(r)}catch(e){err(e)}finally{IV.at=0;IV.L=null;rerender()}},'חסימה')}
/* "ספאם" – מכרטיס בלשונית החשבוניות (data-x) או ממסך הבדיקה (data-id של ההוצאה הממתינה) */
ACT.secSpam=el=>{let x=null,it=null;if(el.dataset.x)x=ivX({dataset:{id:el.dataset.x}});else{it=S.inbox.find(i=>i.id===el.dataset.id);x=it&&(IV.L&&IV.L.items||[]).find(z=>z.id===it.sec)}if(!it&&x)it=S.inbox.find(i=>i.sec===x.id);
 const a=ivFrom(x)||(it&&it.secF)||'',sid=x?x.id:it&&it.sec;if(!a)return toast('לא נמצאה כתובת המייל של השולח');
 secBlk(a,async()=>{/* דחייה כמו "דחה": ההוצאה הממתינה במכשיר – דרך inbDrop (מסמן דחייה ומדווח לשרת גם אם הרשת נפלה); כרטיס שעוד לא נלקח – דחייה בשרת */if(it&&typeof window.inbDrop==='function')window.inbDrop(it.id);else if(sid){try{await fnCall('secDecide',{op:'rej',id:sid})}catch(e){}}})};
window.secSpamOk=()=>!(IV.L&&IV.L.br);
ACT.secBlkRe=()=>{IV.blk=undefined;IV.bo=1;rerender()};
FRM.secBlkAdd=f=>{const a=String(fd(f).addr||'').trim().toLowerCase();if(!/^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,24}$/.test(a))return toast('כתובת מייל לא תקינה');IV.bo=1;secBlk(a)};
ACT.secBlkDel=el=>{const a=el.dataset.v;IV.bo=1;ask('לבטל את החסימה של '+a+'? מיילים חדשים ממנו ייכנסו שוב. מיילים שכבר הועברו לאשפה נשארים שם (אפשר להחזיר אותם בג׳ימייל עד 30 יום).',async()=>{try{IV.blk=await fnCall('secMail',{op:'blkDel',addr:a});toast('החסימה בוטלה')}catch(e){err(e)}finally{rerender()}},'ביטול חסימה')};
ACT.secBlkCl=async el=>{el.disabled=true;IV.bo=1;try{const r=await fnCall('secMail',{op:'blkClean',addr:el.dataset.v});IV.blk=r;toast(r.trashed?r.trashed+' מיילים הועברו לאשפה'+(r.more?' · נשארו עוד – לחצו שוב':''):r.noScope&&!r.clean?'התיבה בלי הרשאת ניקוי – לא ניתן למחוק מג׳ימייל':'לא נמצאו מיילים נוספים מהשולח')}catch(e){err(e)}finally{el.disabled=false;rerender()}};
ACT.secIvCfOk=el=>{const C=secCf();delete C[el.dataset.id];save();rerender()};
/* חלון "חשבוניות מהמייל": כל ההוצאות שנכנסו מהמזכירה במייל. טופלה = שולמה במלואה (bal) או שאין מעקב תשלום להוצאה. זיהוי מייל: t.mail (חדש) או ערוץ mail בפריט השרת של אותה הוצאה (3 ימים אחרונים); הוצאות ישנות יותר שנכנסו מהמזכירה לא ניתנות לזיהוי כמייל */
const ivMailTx=()=>{const m=new Set((IV.L&&IV.L.items||[]).filter(x=>(x.src||[]).some(q=>q&&q.ch==='mail')).map(x=>lidOf(x.id)));return S.tx.filter(t=>t&&t.t==='exp'&&(t.mail===1||(t.src&&m.has(t.src))))};
const ivDone=t=>!hasPay(t)||bal(t)<=0;
function ivMailH(){const all=ivMailTx().sort((a,b)=>(b.date||'').localeCompare(a.date||'')),f=IV.mf||'un',L=f==='un'?all.filter(t=>!ivDone(t)):all,n=IV.mn||40;
 return `<button class="btn g w" data-a="secIvMl" data-v="0" style="margin-bottom:8px">חזרה לחשבוניות</button><div class="chips" style="margin-bottom:8px"><button class="chip${f==='un'?' on':''}" data-a="secIvMf" data-v="un">לא טופלו (${all.filter(t=>!ivDone(t)).length})</button><button class="chip${f==='all'?' on':''}" data-a="secIvMf" data-v="all">הכול (${all.length})</button></div>`
 +(L.length?L.slice(0,n).map(t=>{const d=ivDone(t);return `<div class="card" style="margin-bottom:6px"><div class="ivh"><b>${esc(t.subName||(subById(t.sub)||{}).name||'חשבונית')}</b><span class="iva">${esc(ils(t.amt))}</span></div><small class="note ivs">${esc(dfmt(t.date))}${t.inv?' · מס׳ '+esc(String(t.inv)):''}</small><div class="sectg"><span class="sectags${d?' g':' w'}">${d?'טופלה / שולמה':'לא טופלה'}</span>${t.noStock?'<span class="sectags">ממייל ישן</span>':''}</div></div>`}).join('')+(L.length>n?'<button class="btn g w" data-a="secIvMore">הצג עוד</button>':''):'<div class="card"><p class="note" style="margin:0">אין חשבוניות להצגה. מזהים רק חשבוניות שנכנסו מהמייל מעכשיו והלאה (ובשלושת הימים האחרונים).</p></div>')}
ACT.secIvMl=el=>{IV.ml=el.dataset.v==='1';IV.mn=40;rerender()};ACT.secIvMf=el=>{IV.mf=el.dataset.v;IV.mn=40;rerender()};ACT.secIvMore=()=>{IV.mn=(IV.mn||40)+40;rerender()};
function invH(){const R=IV.L;if(!R){if(!IV.b)ivLoad(1);return '<div class="empty">טוען…</div>'}if(IV.ml)return `<div id="secInv">${ivMailH()}</div>`;
 if(R.err)return `<div class="card"><p class="note">${esc(R.err)}</p><button class="btn g w" data-a="secIvRe">נסה שוב</button></div>`;
 const L=R.items||[],P=L.filter(x=>['new','cl','q','qw'].includes(x.st)),D=L.filter(x=>x.st==='ok'&&x.auto&&x.mineOk);
 let h=ivCfH()+ivSetH();
 h+=`<div class="secrow" style="margin:0 0 8px"><button class="chip" data-a="secIvRe">רענון</button><button class="chip" data-a="secIvMl" data-v="1">חשבוניות מהמייל</button>${R.br?'<small class="note">מוצגות רק חשבוניות של הסניפים שלך</small>':''}</div>`;
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

/* =====================================================================================
   SEC:9 – "תגובה למזכירה" (15.11.2026): כפתור "תגובה" על כל הודעה של המזכירה (תשובה בשיחה, התראה, טיוטת מייל, טיוטת ווצאפ),
   הצעה לשמור את ההוראה ככלל אישי, השאלה "לעשות את זה מעכשיו לבד?" בטיוטה, ומסך "הכללים שלי" (פעיל / לבד / מחיקה) עם יומן "נשלח לבד".
   הכול דרך secLearn בשרת. כללי הבטיחות (תשלום, מחיקה, סיסמאות ופרטים רגישים – תמיד באישור) נאכפים בשרת; כאן רק תצוגה.
   ===================================================================================== */
const mrOn=()=>!!(X.st&&X.st.learn!==false);
const MRCH={chat:'שיחה',note:'התראות',mail:'מייל',wa:'ווצאפ',feed:'מול העיניים',route:'ניתוב'};
const MREX={feed:['מעכשיו להעביר את אלה למסך "לטיפול"','מעכשיו רק בלשונית שלהן, לא בצ\'אט'],chat:['מעכשיו תעני לי בקצרה','תמיד תתחילי בשורה התחתונה'],note:['אל תתריעי לי על התראות כאלה','תשלחי שוב בעוד שעה'],mail:['תעני לו בנימוס שנחזור אליו מחר','תאשרי לו שקיבלנו ושנטפל בזה השבוע'],wa:['תעני לו בנימוס שנחזור אליו מחר','תאשרי לו שקיבלנו ושנטפל בזה השבוע']};
const MRERR={'branch-limited':'כללים על מייל וווצאפ זמינים רק למנהל בלי הגבלת סניפים','learn-off':'הכללים האישיים כבויים בעסק הזה','too-many':'הגעתם למספר הכללים המרבי (50). אפשר למחוק כלל ישן במסך "הכללים שלי".','need-approval':'קודם צריך לאשר פעם אחת תשובה לפי הכלל הזה','safe-rule':'כלל בטיחות – תמיד באישור שלך','not-pending':'הטיוטה כבר נשלחה או טופלה'};
const mrErr=e=>toast(e&&e.reason&&MRERR[e.reason]||e&&e.message||'הפעולה נכשלה');
function mrBtnH(k,id){if(!id||!mrOn()||(X.st.brLimited&&(k==='mail'||k==='wa')))return '';
 return `<button type="button" class="chip" data-a="secMrReply" data-k="${esc(k)}" data-id="${esc(id)}" style="min-height:44px" aria-label="תגובה למזכירה – להגיד לה מה לעשות">↩ תגובה</button>`}
ACT.secMrReply=el=>{const k=el.dataset.k,id=el.dataset.id;if(!MRCH[k]||!id)return;X.mrp={k,id};
 dlg(`<h3>תגובה למזכירה</h3><p class="note" style="margin:0 0 6px">כתבו מה לעשות${k==='mail'||k==='wa'?' – אכין טיוטה חדשה לפי ההוראה (היא לא תישלח בלי לחיצה שלך)':''}. אחר כך אפשר לשמור את ההוראה ככלל קבוע.</p>
 <form data-f="secMrF"><textarea class="secin" name="t" id="secMrT" maxlength="300" dir="auto" aria-label="מה לעשות" placeholder="למשל: ${esc(MREX[k][0])}"></textarea>
 ${micOk()?`<div class="secrow"><button type="button" class="chip" data-a="secMrMic" style="min-height:44px">${micLbl()}</button></div><p class="note" style="margin:0 0 6px">${PRIV}</p>`:''}
 <div class="chips" style="margin:6px 0">${MREX[k].map(x=>`<button type="button" class="chip" data-a="secMrEx" data-v="${esc(x)}" style="min-height:44px">${esc(x)}</button>`).join('')}</div>
 <p class="note" style="margin:0 0 8px">תשלום או העברת כסף, מחיקת נתונים ושליחת סיסמאות או פרטים רגישים – תמיד באישור שלך, גם אם תכתבו אחרת.</p>
 <div class="row"><button class="btn grow" id="secMrGo">שליחה</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`)};
ACT.secMrEx=el=>{const t=document.getElementById('secMrT');if(t){t.value=el.dataset.v;t.focus()}};
FRM.secMrF=async f=>{if(RC.on&&RC.tgt==='mr'){if(RC.live){try{RC.P&&RC.P.cancel().catch(()=>{})}catch(e){}liveEnd('',1)}else micCancel()}/* 16.11.2026: בהכתבה חיה הטקסט כבר בתיבה – נשמר */const p=X.mrp;if(!p)return;const text=String(f.t.value||'').trim();if(!text)return toast('כתבו מה לעשות');if(text.length>300)return toast('עד 300 תווים');
 const b=document.getElementById('secMrGo');if(b){b.disabled=true;b.textContent=p.k==='mail'||p.k==='wa'?'מכינה טיוטה…':'רגע…'}
 try{const r=await fnCall('secLearn',{op:'reply',k:p.k,id:p.id,text});p.text=text;p.prop=r.prop;
  if(r.snz){closeDlg();X.mrp=null;toast('אזכיר לך שוב '+r.snz.l);X.nl=null;try{eyStale()}catch(e){}rerender();return}
  if(r.draft){if(p.k==='mail'&&X.ml&&X.ml.card)X.ml.card.draft=r.draft;if(p.k==='wa'&&X.wa&&X.wa.card){const L=X.wa.card.drafts||[],i=L.findIndex(x=>x.id===r.draft.id);if(i>=0)L[i]=Object.assign({},L[i],r.draft)}}
  mrPropDlg(p,!!r.draft);rerender()}
 catch(e){mrErr(e);if(b){b.disabled=false;b.textContent='שליחה'}}};
function mrPropDlg(p,drafted){const o=p.prop||{};
 if(o.ch==='route')return dlg(`<h3>לשמור כלל ניתוב?</h3><p style="margin:0 0 6px">מעכשיו: ${esc(o.routeL||'')}</p><div class="secin1" dir="auto" style="white-space:pre-wrap;margin:4px 0 8px">${esc(o.instr||p.text)}</div><p class="note" style="margin:0 0 8px">ברירת המחדל – הכול ב"מול העיניים" בצ'אט. אפשר למחוק את הכלל בכל רגע ב"הכללים שלי".</p><div class="row" style="margin-top:8px"><button class="btn grow" data-a="secMrSave">שמירה ככלל</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div>`);
 const did=p.k==='mail'||p.k==='wa'?(drafted?'הכנתי טיוטה חדשה לפי ההוראה. היא לא נשלחה – בדקו אותה ושלחו בלחיצה.':''):p.k==='chat'?'אחרי השמירה אענה כך בשאלות הבאות.':o.act==='mute'?'אחרי השמירה לא אתריע לך על התראות כאלה (התראות בטיחות – תמיד).':'אחרי השמירה אזכור את ההוראה בשיחות איתך. ההתראות עצמן לא ישתנו.';
 dlg(`<h3>לשמור ככלל קבוע?</h3>${did?`<p style="margin:0 0 6px">${esc(did)}</p>`:''}<div class="secin1" dir="auto" style="white-space:pre-wrap;margin:4px 0 8px">${esc(o.instr||p.text)}</div>
 ${o.safe?`<div class="card secwarn" style="margin:0 0 8px;padding:8px" id="secMrSafe"><b>תמיד באישור</b><p class="note" style="margin:4px 0 0">ההוראה נוגעת ב${esc(o.safeL)}. אפשר לשמור אותה, אבל המזכירה לא תעשה את זה לבד – תמיד תכין ותחכה לאישור שלך.</p></div>`:''}
 ${(o.opts||[]).length?`<p class="note" style="margin:0 0 4px">על מה הכלל חל?</p><div class="chips" role="radiogroup" id="secMrSc">${o.opts.map((x,i)=>`<label class="chip" style="min-height:44px"><input type="radio" name="secMrSc" value="${esc(x.v)}"${i?'':' checked'}> ${esc(x.l)}</label>`).join('')}</div>`:''}
 ${o.canAuto?'<p class="note" style="margin:6px 0">אחרי שתאשרו פעם אחת תשובה לפי הכלל, בפעם הבאה אשאל אם לעשות את זה מעכשיו לבד.</p>':''}
 <div class="row" style="margin-top:8px"><button class="btn grow" data-a="secMrSave">שמירה ככלל</button><button type="button" class="btn g grow" data-a="closeDlg">רק הפעם</button></div>`)}
ACT.secMrSave=async el=>{const p=X.mrp;if(!p||!p.text)return;const c=document.querySelector('input[name="secMrSc"]:checked');el.disabled=true;
 try{await fnCall('secLearn',{op:'save',k:p.k,id:p.id,text:p.text,sc:c?c.value:''});closeDlg();toast('נשמר. אפשר לראות ולכבות ב"הכללים שלי" (בהגדרות).');X.mrl=null;if(p.prop&&p.prop.ch==='route')eyStale();
  if(p.k==='note')X.nl=null;if(p.k==='mail'&&X.ml)X.ml.card=null;if(p.k==='wa'&&X.wa)X.wa.card=null;X.mrp=null;rerender()}
 catch(e){el.disabled=false;mrErr(e)}};
/* בטיוטה: לפי איזו הנחיה נכתבה, "לעשות את זה מעכשיו לבד?" (רק לבעל הכלל), ולמה לא נשלחה לבד */
function mrInfoH(d){if(!d)return '';let h='';
 if(d.mr&&d.mrI)h+=`<p class="note" style="margin:4px 0" dir="auto">לפי ההנחיה${d.mrBy&&SY&&d.mrBy===SY.uid?' שלך':' של מנהל'}: "${esc(d.mrI)}"</p>`;
 if(d.mrAsk&&d.mr&&SY&&d.mrBy===SY.uid)h+=`<div class="card secwarn" style="margin:6px 0;padding:8px" id="secMrAsk"><b>לעשות את זה מעכשיו לבד?</b><p class="note" style="margin:4px 0 6px">בפעמים הבאות אכתוב תשובה לפי ההנחיה ואשלח אותה לבד – רק כשאני בטוחה שהיא מתאימה ורק אם עברה את כל בדיקות הבטיחות. כל שליחה נרשמת ב"הכללים שלי", ואפשר לכבות בכל רגע.</p><div class="secrow"><button class="btn" data-a="secMrAuto" data-id="${esc(d.mr)}" data-d="${esc(d.id)}" data-on="1" style="flex:1;min-height:44px">כן, מעכשיו לבד</button><button class="chip" data-a="secMrAuto" data-id="${esc(d.mr)}" data-d="${esc(d.id)}" data-on="0" style="min-height:44px">לא, תמיד לשאול</button></div></div>`;
 if((d.mrNoL||[]).length)h+=`<details class="secsrc"><summary>למה לא נשלח לבד</summary><ul style="margin:4px 0;padding-inline-start:18px">${d.mrNoL.map(x=>'<li>'+esc(x)+'</li>').join('')}</ul></details>`;
 return h}
const mrDraftUpd=(dId,f)=>{const a=[];if(X.ml&&X.ml.card&&X.ml.card.draft)a.push(X.ml.card.draft);if(X.wa&&X.wa.card)a.push(...(X.wa.card.drafts||[]));a.filter(d=>d&&d.id===dId).forEach(f)};
ACT.secMrAuto=el=>{const id=el.dataset.id,dId=el.dataset.d,on=el.dataset.on==='1';
 const run=async()=>{el.disabled=true;try{await fnCall('secLearn',{op:'auto',id,on,never:!on,d:dId});mrDraftUpd(dId,d=>{d.mrAsk=false});X.mrl=null;toast(on?'מעכשיו אעשה את זה לבד. אפשר לכבות ב"הכללים שלי".':'בסדר, אמשיך לשאול לפני כל שליחה.')}catch(e){mrErr(e)}finally{el.disabled=false;rerender()}};
 if(on)ask('מעכשיו פניות שמתאימות לכלל ייענו לבד, בלי לחכות לך (בכפוף לבדיקות הבטיחות ול"עצור הכל"). להמשיך?',run,'כן, לבד');else run()};
/* ---------- מסך "הכללים שלי" ---------- */
function mrSetH(){if(!mrOn())return '';return `<div class="card" style="margin-top:8px" id="secMrSet"><b>הכללים שלי</b><p class="note" style="margin:4px 0 8px">הוראות שנתת למזכירה בכפתור "תגובה", ומה היא שלחה לבד לפיהן.</p><button class="chip" data-a="secMrOpen" style="min-height:44px">לכללים ולשליחות לבד</button></div>`}
ACT.secMrOpen=()=>{X.mrv=1;X.set=0;X.mrl=null;rerender()};
ACT.secMrBack=()=>{X.mrv=0;X.set=1;rerender()};
async function mrLoad(){X.mrb=1;try{const[a,b]=await Promise.all([fnCall('secLearn',{op:'list'}),fnCall('secLearn',{op:'log'})]);X.mrl={rules:a.rules||[],max:a.max||50,br:!!a.brLimited,log:b.items||[]}}catch(e){X.mrl={err:e&&e.message||'לא נטען'}}finally{X.mrb=0;if(cur().v==='sec'&&!typing())rerender()}}
const MRSAFE={pay:'תשלום או העברת כסף',del:'מחיקת נתונים',secret:'סיסמה או פרטים רגישים'};
function mrRuleH(r){const out=r.ch==='mail'||r.ch==='wa';
 if(r.ch==='route')return `<div class="secli" data-id="${esc(r.id)}"><p dir="auto"><b>${esc(r.instr)}</b></p><div class="sectg"><span class="sectags">ניתוב</span><span class="sectags g">${esc(r.scopeL||'')}</span>${r.on?'':'<span class="sectags">כבוי</span>'}</div><small class="note">${esc(tm(r.t))}</small>
 <div class="secrow"><label class="chip" style="min-height:44px"><input type="checkbox" data-c="secMrOn" data-id="${esc(r.id)}"${r.on?' checked':''}> פעיל</label><button class="chip" data-a="secMrDel" data-id="${esc(r.id)}" style="min-height:44px">מחיקה</button></div></div>`;
 const st=r.safe?`<span class="sectags w">תמיד באישור – ${esc(r.safeL||MRSAFE[r.safe]||'')}</span>`:r.auto?'<span class="sectags g">שולחת לבד</span>':r.offWhy==='fail'?'<span class="sectags w">הופסק אחרי 3 כשלונות ברצף</span>':'';
 return `<div class="secli" data-id="${esc(r.id)}"><p dir="auto"><b>${esc(r.instr)}</b></p><div class="sectg"><span class="sectags">${esc(MRCH[r.ch]||'')}</span><span class="sectags">${esc(r.scopeL||'')}</span>${r.act==='mute'?'<span class="sectags">השתקה</span>':''}${st}${r.on?'':'<span class="sectags">כבוי</span>'}</div>
 <small class="note">${out?'אושר '+r.appr+' · ':''}${r.act==='mute'?'הושתקו ':'הופעל לבד '}${r.hits}${r.lastAt?' · לאחרונה '+esc(tm(r.lastAt)):''}${r.asked?' · ביקשת לשאול תמיד':''}</small>
 <div class="secrow"><label class="chip" style="min-height:44px"><input type="checkbox" data-c="secMrOn" data-id="${esc(r.id)}"${r.on?' checked':''}> פעיל</label>${out&&!r.safe?`<label class="chip" style="min-height:44px"${!r.canAuto&&!r.auto?' title="קודם צריך לאשר פעם אחת תשובה לפי הכלל"':''}><input type="checkbox" data-c="secMrAu" data-id="${esc(r.id)}"${r.auto?' checked':''}${(!r.canAuto&&!r.auto)||!r.on?' disabled':''}> לבד</label>`:''}<button class="chip" data-a="secMrDel" data-id="${esc(r.id)}" style="min-height:44px">מחיקה</button></div>
 ${out&&!r.safe&&!r.canAuto&&!r.auto?'<small class="note">"לבד" יתאפשר אחרי שתאשרו פעם אחת תשובה לפי הכלל.</small>':''}</div>`}
function mrH(){const back='<button class="btn g w" data-a="secMrBack" style="margin-bottom:8px">חזרה להגדרות</button>';
 const R=X.mrl;if(!R){if(!X.mrb)mrLoad();return back+stopH()+'<div class="empty">טוען…</div>'}if(R.err)return back+`<div class="card"><p class="note">${esc(R.err)}</p><button class="btn g w" data-a="secMrOpen">נסה שוב</button></div>`;
 const L=R.rules;
 const log=R.log.length?R.log.map(x=>`<div class="secli"><p dir="auto">${x.st==='sent'?'נשלח ✓':'נכשל'} · ${esc(MRCH[x.ch]||x.ch)} · <bdi dir="ltr">${esc(x.to)}</bdi></p><small class="note">${esc(tm(x.t))} · ${x.mine?'לפי הכלל שלי':'לפי הכלל של '+esc(x.by)}${x.ri?': "'+esc(x.ri)+'"':''}</small></div>`).join(''):'<p class="note">עוד לא נשלח שום דבר לבד.</p>';
 return back+stopH()+`<div class="card" id="secMr"><p class="note" style="margin:0 0 6px">הכללים שלך גוברים על ברירת המחדל של המזכירה, אבל לא על כללי הבטיחות: תשלום או העברת כסף, מחיקת נתונים ושליחת סיסמאות או פרטים רגישים – תמיד באישור שלך. "עצור הכל" עוצר גם את השליחה לבד.</p>${R.br?'<p class="note" style="margin:0 0 6px">למנהל עם הגבלת סניפים אין כללים על מייל וווצאפ.</p>':''}
 ${L.length?L.map(mrRuleH).join(''):'<p class="note" style="margin:0">עוד אין כללים. בכל הודעה של המזכירה יש כפתור "↩ תגובה".</p>'}<p class="note" style="margin:6px 0 0">כלל ניתוב (למשל "חשבוניות מהיום – למסך לטיפול") קובע מה מופיע ב"מול העיניים" בצ'אט ומה עובר למסך "לטיפול" באפליקציה. בלי כלל – הכול בצ'אט.</p><small class="note" style="display:block;margin-top:6px">${L.length} מתוך ${R.max} כללים</small></div>
 <div class="sec"><h3>נשלח לבד</h3></div><div class="card" id="secMrLog">${log}</div>`}
CHG.secMrOn=async el=>{const on=!!el.checked;el.disabled=true;try{await fnCall('secLearn',{op:'set',id:el.dataset.id,on});toast(on?'הכלל פעיל':'הכלל כובה')}catch(e){el.checked=!on;mrErr(e)}finally{X.mrl=null;eyStale();rerender()}};
CHG.secMrAu=el=>{const on=!!el.checked,id=el.dataset.id;const run=async()=>{el.disabled=true;try{await fnCall('secLearn',{op:'auto',id,on});toast(on?'מעכשיו לבד':'מעכשיו אשאל לפני כל שליחה')}catch(e){mrErr(e)}finally{X.mrl=null;rerender()}};
 if(on){el.checked=false;ask('מעכשיו פניות שמתאימות לכלל ייענו לבד, בלי לחכות לך (בכפוף לבדיקות הבטיחות ול"עצור הכל"). להמשיך?',run,'כן, לבד')}else run()};
ACT.secMrDel=el=>{const id=el.dataset.id;ask('למחוק את הכלל? המזכירה תפסיק לפעול לפיו.',async()=>{try{await fnCall('secLearn',{op:'del',id});toast('הכלל נמחק')}catch(e){mrErr(e)}finally{X.mrl=null;eyStale();rerender()}},'מחיקה')};
{const r9=V.sec;V.sec=()=>{if(elig()&&ready()&&X.st&&X.st.setupDone&&X.mrv&&!X.set&&!X.edit&&mrOn())return {t:X.st.name||'המזכירה',s:'הכללים שלי',h:mrH()};return r9()}}
window.__secMr=()=>X.mrl;

/* =====================================================================================
   SEC:10 – צ'אט נקי ו"מול העיניים" (15.11.2026; משימות/2026-11-15_התראות-ותגובה-למזכירה/00-בקשה.md סעיף 6):
   - בכל כניסה למסך המזכירה (ממסך אחר) הצ'אט נקי. מעבר בין הלשוניות של המזכירה (למשל ליומן וחזרה) לא מנקה (החלטת המשתמש 15.11). השיחה הקודמת – בלשונית "צ'אט קודם" (קריאה בלבד, בדפים).
     שום הודעה לא נמחקת, והמזכירה ממשיכה לקבל את ההיסטוריה בשרת (secChat) – רק התצוגה השתנתה.
   - בראש הצ'אט "מול העיניים": כל מה שפתוח (הצעות לאישור, טיוטות, התראות שלא טופלו, חשבוניות שהתקבלו, תזכורות קרובות) ומה שהמזכירה עשתה
     מאז הכניסה הקודמת. קריאה אחת לשרת (secLearn op:'eyes'), הכניסה נרשמת בשרת לכל מנהל. כל שורה – לחיצה למקום שלה, אישור במקום כשיש, ו"↩ תגובה".
   - כללי ניתוב ("חשבוניות מהיום – למסך לטיפול"): כרטיס אישור בשיחה / תגובה על פריט; פריטים מסוג שנותב מופיעים במסך "לטיפול" הקיים
     באפליקציה (V.todo, סעיף "מהמזכירה"; החלטת המשתמש 15.11 – לא לשונית במזכירה) או רק בלשונית שלהם.
   ===================================================================================== */
const css10=document.createElement('style');
css10.textContent='.secey{margin:0 0 8px}.secey .secli{padding:8px 0}.secey .secli p{margin:0 0 2px}.secey .secrow .chip{min-height:44px}.secey .eyh{display:flex;justify-content:space-between;align-items:center;gap:8px}'
+'.secey .secday{margin:10px 0 2px}.secdone b{color:var(--acc)}#secPrev .secday{text-align:center;font-size:.85rem}';
document.head.appendChild(css10);
TABS.splice(1,0,['eyes','מול העיניים'],['prev',"צ'אט קודם"]);/* 15.11.2026: "מול העיניים" עבר ללשונית משלו – הצ'אט נפתח ריק בכל כניסה */
const RKL={inv:'חשבוניות',rem:'תזכורות',note:'התראות',draft:'טיוטות תשובה',appr:'הצעות לאישור'},RDL={hold:'מסך "לטיפול" באפליקציה',tab:"רק בלשונית שלהן (לא בצ'אט)",chat:'לשונית "מול העיניים"'};
const rtL=c=>'מעכשיו '+(RKL[c.kind]||'פריטים')+' ← '+(RDL[c.dest]||'');
/* ---------- "מול העיניים" ---------- */
async function eyLoad(visit){if(X.eyb){X.eyQ=X.eyQ===2||visit?2:1;return}X.eyb=1;
 try{const r=await fnCall('secLearn',{op:'eyes',visit:!!visit});X.ey=r&&Array.isArray(r.open)?r:{err:'לא נטען'};if(Array.isArray(X.ey.hold)){TD.key=keyNow();TD.L=X.ey.hold;TD.at=Date.now()}}
 catch(e){X.ey=X.ey&&!X.ey.err?X.ey:{err:e&&e.message||'לא נטען'}}
 finally{X.eyb=0;if(X.eyQ){const v=X.eyQ===2;X.eyQ=0;eyLoad(v);return}if(cur().v==='sec'&&!typing())rerender()}}
/* אחרי פעולה (אישור, "טופל", כלל חדש) – המידע הקיים נשאר על המסך ומתעדכן ברקע */
function eyStale(){if(!X.ey||X.ey.err)X.ey=null;eyLoad(false)}
const EYK={appr:'לאישור',media:'מהשיחה',draft:'טיוטה',note:'התראה',inv:'חשבונית',rem:'תזכורת'};
const EYN=4,EYD=3;
function eyGoA(x){const g=x.go||{};return ` data-tab="${esc(g.tab||'')}"${g.id?` data-id="${esc(g.id)}"`:''}${g.wa?` data-wa="${esc(g.wa)}"`:''}`}
function eyRow(x,dn){const a=x.act,id=a&&esc(a.id);
 const acts=!a?'':a.k==='fact'?`<button class="chip" data-a="secFOk" data-id="${id}">אשר</button><button class="chip" data-a="secFNo" data-id="${id}">בטל</button>`:a.k==='cal'?`<button class="chip" data-a="secCOk" data-id="${id}">אשר</button><button class="chip" data-a="secCNo" data-id="${id}">בטל</button>`:a.k==='note'?`<button class="chip" data-a="secNDone" data-id="${id}">טופל</button>`:a.k==='scan'||a.k==='task'?`<button class="chip" data-a="${a.k==='scan'?'secScOk':'secTkOk'}" data-id="${id}" data-mid="${esc(a.mid||'')}">${a.k==='scan'?'לסריקה':'פתח משימה'}</button><button class="chip" data-a="secScNo" data-id="${id}" data-mid="${esc(a.mid||'')}">בטל</button>`:'';
 const tag=x.k==='rem'&&/^ביומן/.test(x.title)?'יומן':EYK[x.k]||'';
 return `<div class="secli" data-ey="${esc(x.id)}"><button type="button" class="secnb" data-a="secEyGo"${eyGoA(x)} aria-label="פתיחה: ${esc(x.title)}"><p><b>${esc(x.title)}</b> <span class="sectags">${esc(tag)}</span></p>${x.sub?`<small class="note secclamp" style="display:block">${esc(x.sub)}</small>`:''}${x.t&&!x.soon?`<small class="note" style="display:block">${esc(tm(x.t))}</small>`:''}</button>
 <div class="secrow">${acts}${dn?'':`<button class="chip" data-a="secEyGo"${eyGoA(x)}>פתיחה</button>`}${x.r?mrBtnH(x.r.k,x.r.id):''}</div></div>`}
function eyH(){const R=X.ey,hd='<div class="eyh"><b>מול העיניים</b>';
 if(!R){if(!X.eyb){const v=!!X.eyV;X.eyV=0;eyLoad(v)}return `<div class="card secey" id="secEyes">${hd}</div><p class="note" style="margin:4px 0 0">טוען…</p></div>`}
 if(R.err)return `<div class="card secey" id="secEyes">${hd}</div><p class="note" style="margin:4px 0">${esc(R.err)}</p><button class="chip" data-a="secEyRe" style="min-height:44px">נסה שוב</button></div>`;
 const O=R.open||[],D=R.did||[],on=X.eyAll?O.length:Math.min(O.length,EYN),dn=X.didAll?D.length:Math.min(D.length,EYD),H=R.hold||[];
 return `<div class="card secey" id="secEyes">${hd}${O.length?`<span class="secbadge">${esc(String(R.openN||O.length))}</span>`:''}</div>
 <div id="secEyOpen">${O.length?O.slice(0,on).map(x=>eyRow(x)).join(''):'<p class="note" style="margin:4px 0">אין כרגע משהו פתוח ✓</p>'}</div>
 ${O.length>EYN?`<button class="chip" data-a="secEyMore" data-v="o" style="min-height:44px">${X.eyAll?'פחות':'עוד ('+(O.length-EYN)+')'}</button>`:''}
 ${H.length?`<button class="chip" data-a="go" data-v="todo" style="min-height:44px;margin-inline-start:6px">במסך "לטיפול" (${H.length})</button>`:''}
 <div class="secday">מה עשיתי מאז הכניסה הקודמת<small class="note">${esc(tm(R.since))}</small></div>
 <div id="secEyDid">${D.length?D.slice(0,dn).map(x=>eyRow(x,1)).join(''):'<p class="note" style="margin:4px 0">לא עשיתי משהו חדש מאז.</p>'}</div>
 ${D.length>EYD?`<button class="chip" data-a="secEyMore" data-v="d" style="min-height:44px">${X.didAll?'פחות':'עוד ('+((R.didN||D.length)-EYD)+')'}</button>`:''}</div>`}
ACT.secEyMore=el=>{if(el.dataset.v==='d')X.didAll=!X.didAll;else X.eyAll=!X.eyAll;rerender()};
ACT.secEyRe=()=>{X.ey=null;eyLoad(false);rerender()};
ACT.secEyGo=el=>{const t=el.dataset.tab,id=el.dataset.id||'',wa=el.dataset.wa||'';
 if(t==='notes'){if(id)pnTap(id);else ACT.secNotesGo();return}
 if(t==='set'){ACT.secMrOpen();return}
 if(!TABS.some(x=>x[0]===t))return;
 ACT.secTab({dataset:{v:t}});
 if(t==='wa'&&wa&&X.wa){X.wa.cur=wa;X.wa.card=null;rerender()}
 if(t==='mail'&&id&&X.ml){X.ml.cur=id;X.ml.card=null;rerender()}};
{const o=ACT.secNDone;ACT.secNDone=async el=>{await o(el);eyStale()}}
/* ---------- כרטיס ניתוב בשיחה ---------- */
async function rtDo(el,no){const mid=el.dataset.mid,cid=el.dataset.id;if(!mid||!cid)return;el.disabled=true;
 try{await fnCall('secLearn',no?{op:'route',mid,cid,no:true}:{op:'route',mid,cid});X.mrl=null;if(!no)toast('נשמר. אפשר לראות ולמחוק ב"הכללים שלי".');doneSt(cid,no?'no':'ok')}
 catch(e){if(notPend(e))doneSt(cid,'gone');else{el.disabled=false;mrErr(e)}}}
ACT.secRtOk=el=>rtDo(el,false);
ACT.secRtNo=el=>rtDo(el,true);
/* ---------- "צ'אט קודם": קריאה בלבד, 30 הודעות בכל פעם ---------- */
async function pcLoad(){const P=X.pc;if(!P||P.b)return;P.b=1;const d={limit:30},o=(P.L||[]).find(m=>Number.isInteger(m.t));if(o)d.before=o.t;
 try{const r=await fnCall('secChatLoad',d),m=(r&&r.msgs||[]).filter(x=>!P.L.some(y=>y.id&&y.id===x.id));if(X.pc!==P)return;P.L=m.concat(P.L);P.more=r&&typeof r.more==='boolean'?r.more:m.length>=30;P.err=''}
 catch(e){P.err=e&&e.message||'השיחה לא נטענה'}finally{P.b=0;P.ld=1;if(cur().v==='sec'&&!typing())rerender()}}
const dayH=t=>{try{return new Date(t).toLocaleDateString('he-IL',{weekday:'long',day:'numeric',month:'numeric',year:'2-digit'})}catch(e){return ''}};
function prevH(){const P=X.pc||(X.pc={L:[],b:0,more:true,err:'',ld:0});
 if(!P.ld){if(!P.b)pcLoad();return '<div class="empty">טוען…</div>'}
 if(P.err&&!P.L.length)return `<div class="card"><p class="note">${esc(P.err)}</p><button class="btn g w" data-a="secTab" data-v="prev">נסה שוב</button></div>`;
 let last='',h='';for(const m of P.L){const d=m.t?dayH(m.t):'';if(d&&d!==last){last=d;h+=`<div class="secday">${esc(d)}</div>`}h+=bub(m)}
 return `<p class="note" style="margin:0 0 6px">השיחות הקודמות – לקריאה בלבד. ${esc(X.st.name||'המזכירה')} זוכרת אותן גם כשהן לא מוצגות בצ'אט.</p>
 ${P.more&&P.L.length?`<button class="btn g w" data-a="secPcMore"${P.b?' disabled':''} style="margin-bottom:8px">הודעות קודמות</button>`:''}
 <div id="secPrev">${h||'<div class="empty">אין שיחה קודמת</div>'}</div>${P.err?`<p class="note">${esc(P.err)}</p>`:''}`}
ACT.secPcMore=()=>{pcLoad();rerender()};
/* ---------- מסך "לטיפול" באפליקציה (V.todo): מה שנותב לשם בכלל אישי ----------
   secLearn eyes hold:true – בלי כלל "לטיפול" השרת עונה מיד (קריאת הכללים בלבד). לא יותר מפעם בדקה, ורק למי שהמזכירה פתוחה לו. */
const TD={L:[],at:0,b:0,key:''};
const tdOn=()=>{try{return elig()&&ready()&&!!X.st.setupDone}catch(e){return false}};
function tdLoad(force){const k=keyNow();if(TD.key!==k){TD.key=k;TD.L=[];TD.at=0}
 if(!tdOn()||TD.b||(!force&&Date.now()-TD.at<60000))return;TD.b=1;TD.at=Date.now();const s0=TD.L.map(x=>x.id).join();
 fnCall('secLearn',{op:'eyes',hold:true}).then(r=>{if(TD.key===keyNow())TD.L=r&&Array.isArray(r.hold)?r.hold:[]}).catch(()=>{})
  .finally(()=>{TD.b=0;try{if(TD.L.map(x=>x.id).join()!==s0&&['todo','home'].includes(cur().v)&&!typing()&&!document.querySelector('#dlg[open]'))rerender()}catch(e){}})}
const tdN=()=>tdOn()&&TD.key===keyNow()?TD.L.length:0;
function tdRow(x){const g=x.go||{};return `<button class="opt" data-a="secTdGo" data-tab="${esc(g.tab||'')}"${g.id?` data-id="${esc(g.id)}"`:''}${g.wa?` data-wa="${esc(g.wa)}"`:''}><span>${esc(x.title)}<small>${esc([EYK[x.k]||'',x.sub||''].filter(Boolean).join(' · '))}</small></span>${ico('chev')}</button>`}
if(typeof todoC==='function'){const o=todoC;todoC=function(){const r=o.apply(this,arguments);try{r.sec=tdN();r.n+=r.sec}catch(e){r.sec=0}return r}}
{const o=V.todo;if(typeof o==='function')V.todo=function(){const r=o.apply(this,arguments);
 try{if(r&&typeof r.h==='string'&&isA()&&tdOn()){tdLoad(false);const L=TD.L;if(L.length)r.h=adSec('מהמזכירה – לטיפול')+L.slice(0,EYN*3).map(tdRow).join('')+`<p class="note" style="margin:4px 0 8px">הגיעו לכאן לפי כלל ניתוב שלך. אפשר לשנות ב"הכללים שלי" במזכירה.</p>`+r.h}}catch(e){}return r}}
ACT.secTdGo=el=>{const t=el.dataset.tab,id=el.dataset.id||'',wa=el.dataset.wa||'';TD.at=0;
 if(t==='notes'){if(id)pnTap(id);else ACT.secNotesGo();return}
 X.set=0;X.edit=0;X.mrv=0;
 if(t==='set'){X.mrv=1;X.mrl=null;go('sec');return}
 if(TABS.some(x=>x[0]===t))ACT.secTab({dataset:{v:t}});
 if(t==='wa'&&wa&&X.wa){X.wa.cur=wa;X.wa.card=null}
 if(t==='mail'&&id&&X.ml){X.ml.cur=id;X.ml.card=null}
 go('sec')};
/* ---------- כניסה לצ'אט = מסך נקי ---------- */
function chatEnter(){if(X.sending)return;X.msgs=[];X.media={};X.msgErr='';X.ey=null;X.eyV=1;X.eyAll=0;X.didAll=0}
/* מעבר בין לשוניות לא מנקה את הצ'אט (15.11): חזרה ל"שיחה" – "מול העיניים" מתעדכן ברקע */
{const t10=ACT.secTab;ACT.secTab=el=>{const v=el.dataset.v,was=X.tab||'chat';if(v==='eyes'){if(X.eyV){X.eyV=0;eyLoad(true)}else if(was!=='eyes'&&X.ey&&!X.ey.err)eyStale()}if(v==='prev')X.pc=null;t10(el)}}
{const r0=window.render;if(typeof r0==='function')window.render=function(){const r=r0.apply(this,arguments);try{X.pvw=cur().v}catch(e){}return r}}
{const r10=V.sec;V.sec=()=>{try{if(X.pvw!=='sec'){X.pvw='sec';chatEnter()}}catch(e){}
 if(elig()&&ready()&&X.st&&X.st.setupDone&&!X.edit&&!X.set&&!X.mrv&&X.tab==='prev'){const S0=X.st;
  return{t:S0.name||'המזכירה',s:"צ'אט קודם",h:stopH()+tabsH()+prevH()}}
 if(elig()&&ready()&&X.st&&X.st.setupDone&&!X.edit&&!X.set&&!X.mrv&&X.tab==='eyes'){const S0=X.st;
  return{t:S0.name||'המזכירה',s:'מול העיניים',h:stopH()+tabsH()+eyH()}}
 /* מספר הפריטים הפתוחים ללשונית – נטען ברקע (בלי לסמן "ביקור") */
 try{if(elig()&&ready()&&X.st&&X.st.setupDone&&!X.ey&&!X.eyb)eyLoad(false)}catch(e){}
 return r10()}}
window.__secEy=()=>X.ey;window.__secTd=TD;

/* =====================================================================================
   SEC:11 – קול, תמונה וסרטון בצ'אט (15.11.2026). הכול דרך secMedia בשרת (op: stt | see | mark). שום קובץ לא נשמר במכשיר.
   קול: הקלטה ← WAV ← תמלול ← בועת משתמש עם 🎤 ← secChat רגיל. תמונה: הקטנה ל-JPEG ← see ← כרטיס "לסריקה" / "פתח משימה".
   סרטון: בדיקת אורך מקומית, הקטנה במכשיר אם כבד, העלאה ל-sec_tmp ← see. התמונה נשמרת בזיכרון בלבד עד החלטה על הכרטיס.
   ===================================================================================== */
const MDEF={aud:120,img:true,vid:60};
const mdOf=m=>m&&typeof m==='object'?{aud:Number.isFinite(+m.aud)?+m.aud:MDEF.aud,img:m.img!==false&&m.img!==0,vid:Number.isFinite(+m.vid)?+m.vid:MDEF.vid}:{aud:MDEF.aud,img:MDEF.img,vid:MDEF.vid};
const mlim=()=>X.st&&X.st.media?mdOf(X.st.media):null;/* null = השרת עוד לא מחזיר הגבלות: הכפתורים מוסתרים */
const micOk=()=>{const l=mlim();return !!(l&&l.aud>0)};
const PRIV='הקובץ נשלח לעיבוד ב-AI ונמחק';
const SCL={inv:'חשבונית',rcpt:'קבלה',dn:'תעודת משלוח',z:'דוח Z (נפתח מסך סגירת הקופה)'};
const AGAIN='התמונה כבר לא בזיכרון. שלחו שוב את התמונה.';
const VMAX=11*1048576,VHARD=12*1048576,CANT='הסרטון כבד מדי ואי אפשר להקטין אותו במכשיר הזה. צלמו סרטון קצר יותר או באיכות נמוכה יותר.';
const RC={on:0};
const fsec=s=>{s=Math.max(0,Math.floor(s));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0')};
const micLbl=()=>RC.on?(RC.stp?'⏳ מסיימת…':'⏹ עצור ('+fsec(RC.el||0)+')'):'🎤 הקלטה';
const mBusy=()=>!!(X.mst||X.sending);
function micUi(){document.querySelectorAll('[data-a=secMic],[data-a=secMrMic]').forEach(b=>{b.textContent=micLbl();b.disabled=!RC.on&&mBusy()})}
const keepDraft=()=>{const f=document.getElementById('secForm');if(f&&f.q)X.draft=f.q.value};
const updWait=()=>{const w=document.querySelector('#secWait small');if(w)w.textContent=X.mst};
const micErr=e=>{const n=e&&e.name;
 if(n==='NotAllowedError'||n==='SecurityError'||n==='PermissionDeniedError')return'אין הרשאה למיקרופון. אפשרו לאפליקציה גישה למיקרופון בהגדרות הטלפון ונסו שוב.';
 if(n==='NotFoundError'||n==='DevicesNotFoundError')return'לא נמצא מיקרופון במכשיר.';
 if(n==='NotReadableError')return'המיקרופון תפוס על ידי אפליקציה אחרת.';
 return'לא הצלחנו להפעיל את המיקרופון.'};
async function toWav(blob,maxSec){/* מפענח וממיר ל-WAV PCM 16 ביט, מונו, 16kHz; חותך לאורך המרבי */
 const AC=window.AudioContext||window.webkitAudioContext,ac=new AC();let buf;
 try{buf=await ac.decodeAudioData(await blob.arrayBuffer())}finally{try{ac.close()}catch(e){}}
 const len=Math.max(1,Math.min(Math.ceil(buf.duration*16000),maxSec*16000)),oc=new OfflineAudioContext(1,len,16000),src=oc.createBufferSource();
 src.buffer=buf;src.connect(oc.destination);src.start();
 const f=(await oc.startRendering()).getChannelData(0),n=Math.min(len,f.length),bytes=new Uint8Array(44+n*2),dv=new DataView(bytes.buffer);
 const w=(o,s)=>{for(let i=0;i<s.length;i++)dv.setUint8(o+i,s.charCodeAt(i))};
 w(0,'RIFF');dv.setUint32(4,36+n*2,true);w(8,'WAVE');w(12,'fmt ');dv.setUint32(16,16,true);dv.setUint16(20,1,true);dv.setUint16(22,1,true);dv.setUint32(24,16000,true);dv.setUint32(28,32000,true);dv.setUint16(32,2,true);dv.setUint16(34,16,true);w(36,'data');dv.setUint32(40,n*2,true);
 for(let i=0;i<n;i++){const s=Math.max(-1,Math.min(1,f[i]));dv.setInt16(44+i*2,s<0?s*32768:s*32767,true)}
 let bin='';for(let i=0;i<bytes.length;i+=8192)bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+8192));
 return{sec:n/16000,b64:btoa(bin)}}
const micDown=()=>{try{RC.stream&&RC.stream.getTracks().forEach(t=>t.stop())}catch(e){}RC.stream=null};
function micStop(){if(RC.on&&RC.live){liveStop();return}if(RC.on&&RC.mr&&RC.mr.state!=='inactive'){clearInterval(RC.tm);try{RC.mr.stop()}catch(e){micDown();RC.on=0;micUi()}}}
function micCancel(){if(!RC.on)return;RC.x=1;if(RC.live){liveCancel();return}if(RC.mr&&RC.mr.state!=='inactive')micStop();else{clearInterval(RC.tm);micDown();RC.on=0;micUi()}}
/* ההקלטה נעצרת (בלי תמלול) כשהמקום שלה כבר לא מוצג: יציאה מהמזכירה, חלון "↩ תגובה" שנסגר, או לשונית אחרת במקום השיחה */
const micGone=()=>cur().v!=='sec'||(RC.tgt==='mr'?!document.getElementById('secMrT'):((X.tab||'chat')!=='chat'||!document.querySelector('#secMedia [data-a=secMic]')));
let micDlgOn=0;
function micDlgHook(){if(micDlgOn)return;const d=document.getElementById('dlg');if(!d)return;micDlgOn=1;d.addEventListener('close',()=>{if(RC.on&&RC.tgt==='mr')micCancel()})}
async function micStart(tgt){
 if(RC.on||mBusy())return;
 const l=mlim();if(!l||l.aud<=0)return toast('ההקלטה הקולית כבויה בעסק הזה');
 const P=await spAvail();if(P&&!RC.on&&!mBusy()){if(await liveStart(tgt,P,l.aud))return}
 if(RC.on||mBusy())return;
 if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia||typeof MediaRecorder==='undefined'||!(window.AudioContext||window.webkitAudioContext))return toast('ההקלטה לא נתמכת במכשיר הזה. אפשר להקליד.');
 RC.on=1;let stream;
 try{stream=await navigator.mediaDevices.getUserMedia({audio:true})}catch(e){RC.on=0;return toast(micErr(e))}
 const mime=['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg'].find(m=>MediaRecorder.isTypeSupported&&MediaRecorder.isTypeSupported(m))||'';
 let mr;try{mr=new MediaRecorder(stream,mime?{mimeType:mime}:undefined)}catch(e){stream.getTracks().forEach(t=>t.stop());RC.on=0;return toast('ההקלטה לא נתמכת במכשיר הזה. אפשר להקליד.')}
 const chunks=[],max=l.aud;Object.assign(RC,{on:1,live:0,stp:0,tgt,mr,stream,t0:performance.now(),el:0,x:0,auto:0,tm:0});
 mr.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data)};
 mr.onstop=()=>{clearInterval(RC.tm);micDown();const cancel=RC.x,tg=RC.tgt,auto=RC.auto;RC.on=0;micUi();if(cancel){if(tg==='chat'&&cur().v==='sec'){keepDraft();rerender()}return}micDone(new Blob(chunks,{type:mr.mimeType||mime||'audio/webm'}),max,tg,auto)};
 stream.getTracks().forEach(t=>{t.onended=()=>micStop()});
 try{mr.start()}catch(e){micDown();RC.on=0;RC.mr=null;micUi();return toast('לא הצלחנו להתחיל את ההקלטה. נסו שוב או הקלידו.')}
 micDlgHook();
 RC.tm=setInterval(()=>{RC.el=(performance.now()-RC.t0)/1000;if(micGone()){micCancel();return}if(RC.el>=max){RC.auto=1;micStop();return}micUi()},250);
 if(tgt==='chat'){keepDraft();rerender()}else micUi()}
async function micDone(blob,max,tg,auto){
 X.mst='מתמללת…';if(tg==='chat'&&cur().v==='sec'){rerender();scrollEnd()}micUi();let text='';
 try{const w=await toWav(blob,max);if(w.sec<0.5)toast('ההקלטה קצרה מדי. נסו שוב.');
  else{if(auto)toast('ההקלטה נעצרה בגבול של '+max+' שניות');const r=await fnCall('secMedia',{op:'stt',mime:'audio/wav',b64:w.b64})||{};if(Number.isFinite(r.pct))X.st.pct=r.pct;
   if(r.mode==='saving'){X.st.saving=X.st.saving||'month';toast(String(r.reply||'המזכירה במצב חיסכון – אפשר להקליד.'))}/* תקרת שימוש: ההסבר מהשרת, לא "לא הצלחתי להבין" */
   else{text=String(r.text||'').trim();if(!text)toast('לא הצלחתי להבין את ההקלטה. נסו שוב.')}}}
 catch(e){toast(e&&e.message&&!(e instanceof DOMException)&&e.name!=='EncodingError'?e.message:'לא הצלחנו לעבד את ההקלטה. נסו שוב או הקלידו.')}
 X.mst='';blob=null;micUi();
 if(text&&tg==='mr'){const t=document.getElementById('secMrT');if(t){t.value=((t.value?t.value+' ':'')+text).slice(0,300);t.focus()}}
 else if(text&&tg==='chat'&&cur().v==='sec'){keepDraft();const d=String(X.draft||'').trim();X.draft=((d?d+' ':'')+text).slice(0,2000);X.vdr=1;rerender();micFocus('chat')}/* 16.11.2026: לא נשלח לבד – נכנס לתיבה לעריכה */
 else if(cur().v==='sec'){rerender()}}
/* 16.11.2026: הכתבה חיה – זיהוי הדיבור של הטלפון (תוסף LpSpeech ב-APK החדש, בלי שרת ובלי עלות).
   המילים נכנסות לתיבת הכתיבה תוך כדי דיבור; בזמן ההקלטה התיבה לקריאה בלבד, ואחרי "עצור" עורכים ושולחים בלחיצה.
   APK ישן (בלי התוסף) או טלפון בלי זיהוי דיבור – ההקלטה הקודמת (תמלול בשרת אחרי העצירה), וגם היא נכנסת לתיבה ולא נשלחת לבד. */
let SPA=null;
async function spAvail(){if(SPA!==null)return SPA||null;SPA=0;
 try{const C=window.Capacitor,P=C&&C.Plugins&&C.Plugins.LpSpeech;if(!P||!(C.isNativePlatform&&C.isNativePlatform())||(C.isPluginAvailable&&!C.isPluginAvailable('LpSpeech')))return null;
  const r=await P.available();if(r&&r.ok)SPA=P}catch(e){SPA=0}return SPA||null}
const micFld=tg=>{if(tg==='mr')return document.getElementById('secMrT');const f=document.getElementById('secForm');return f&&f.q||null};
const micFocus=tg=>setTimeout(()=>{const t=micFld(tg);if(t){try{t.focus();const n=t.value.length;t.setSelectionRange(n,n)}catch(e){}}},40);
const liveTxt=()=>{const max=RC.tgt==='mr'?300:2000;return[RC.base,RC.fin,RC.par].map(x=>String(x||'').trim()).filter(Boolean).join(' ').slice(0,max)};
function liveShow(){if(!RC.live)return;const v=liveTxt(),t=micFld(RC.tgt);if(RC.tgt==='chat')X.draft=v;
 if(t){t.readOnly=true;if(t.value!==v)t.value=v;try{t.scrollTop=t.scrollHeight}catch(e){}}}
const LVE={perm:'אין הרשאה למיקרופון. אפשרו לאפליקציה גישה למיקרופון בהגדרות הטלפון ונסו שוב.',net:'זיהוי הדיבור צריך חיבור לאינטרנט. בדקו את החיבור ונסו שוב, או הקלידו.',lang:'זיהוי דיבור בעברית לא זמין בטלפון הזה. אפשר להקליד.',audio:'המיקרופון תפוס או לא זמין.',silence:'לא שמעתי דיבור. נסו שוב.',fail:'זיהוי הדיבור נעצר. אפשר להמשיך להקליד או להקליט שוב.'};
async function liveStart(tgt,P,max){
 const f=micFld(tgt);Object.assign(RC,{on:1,live:1,stp:0,tgt,P,max,t0:performance.now(),el:0,x:0,auto:0,tm:0,fin:'',par:'',hs:[],base:f?String(f.value||''):''});
 const on=(n,fn)=>P.addListener(n,e=>{if(RC.live&&RC.P===P)fn(e||{})});
 try{RC.hs=await Promise.all([on('partial',e=>{RC.par=String(e.text||'');liveShow()}),on('final',e=>{const t=String(e.text||'').trim();if(t)RC.fin=(RC.fin?RC.fin+' ':'')+t;RC.par='';liveShow()}),on('end',e=>liveEnd(String(e.code||'')))]);
  await P.start({lang:'he-IL'})}
 catch(e){const c=e&&e.code;liveOff();micUi();if(c==='na'){SPA=0;return false}/* אין זיהוי דיבור – ההקלטה הקודמת */toast(LVE[c==='perm'?'perm':'fail']);return true}
 micDlgHook();
 RC.tm=setInterval(()=>{if(!RC.live)return;RC.el=(performance.now()-RC.t0)/1000;if(micGone()){micCancel();return}if(!RC.stp&&RC.el>=max){RC.auto=1;liveStop();return}micUi()},250);
 if(tgt==='chat'){rerender()}micUi();liveShow();return true}
function liveOff(){clearInterval(RC.tm);clearTimeout(RC.st);const hs=RC.hs||[];RC.hs=[];hs.forEach(h=>{try{h&&h.remove&&h.remove()}catch(e){}});const t=micFld(RC.tgt);if(t)t.readOnly=false;Object.assign(RC,{on:0,live:0,stp:0,P:null})}
function liveStop(){if(!RC.live||RC.stp)return;RC.stp=1;micUi();const P=RC.P;try{P.stop().catch(()=>liveEnd(''))}catch(e){liveEnd('')}RC.st=setTimeout(()=>liveEnd(''),4000)}
function liveCancel(){const P=RC.P,tg=RC.tgt,base=RC.base||'';try{P&&P.cancel().catch(()=>{})}catch(e){}liveOff();const t=micFld(tg);if(t)t.value=base;if(tg==='chat'){X.draft=base;if(cur().v==='sec')rerender()}micUi()}
function liveEnd(code,quiet){if(!RC.live)return;const tg=RC.tgt,auto=RC.auto,v=liveTxt(),got=v.trim()!==String(RC.base||'').trim();liveOff();
 const t=micFld(tg);if(t)t.value=v;if(tg==='chat'){X.draft=v;if(got)X.vdr=1;if(cur().v==='sec')rerender()}micUi();if(quiet)return;micFocus(tg);
 if(auto)toast('ההקלטה נעצרה בגבול של '+(RC.max||'')+' שניות. אפשר לערוך ולשלוח, או להקליט עוד.');
 else if(code&&code!=='pause'&&(code!=='silence'||!got))toast(LVE[code]||LVE.fail);
 else if(got)toast('אפשר לערוך את הטקסט ואז לשלוח')}
ACT.secMic=()=>{if(RC.on)micStop();else micStart('chat')};
ACT.secMrMic=()=>{if(RC.on)micStop();else micStart('mr')};
ACT.secMicX=()=>micCancel();
function mediaH(){const l=mlim();if(!l||(l.aud<=0&&!l.img&&l.vid<=0))return '';
 const dis=mBusy()||RC.on,off=dis?' disabled':'',lb='class="chip" style="min-height:44px;cursor:pointer'+(dis?';opacity:.5':'')+'"';
 return `<div class="secrow" id="secMedia" style="margin-top:8px">${l.aud>0?`<button type="button" class="chip" data-a="secMic" style="min-height:44px"${RC.on?'':mBusy()?' disabled':''}>${micLbl()}</button>`:''}${RC.on&&RC.tgt==='chat'?'<button type="button" class="chip" data-a="secMicX" style="min-height:44px">ביטול</button>':''}${l.img?`<label ${lb}>📷 תמונה<input type="file" accept="image/*" data-c="secImgF" hidden${off}></label>`:''}${l.vid>0?`<label ${lb}>🎬 סרטון<input type="file" accept="video/*" data-c="secVidF" hidden${off}></label>`:''}</div><p class="note" style="margin:4px 0 0">${PRIV}</p>`}
/* ---------- תמונה וסרטון ---------- */
async function mediaSend(via,prep){
 if(mBusy()||RC.on)return;keepDraft();
 const f=document.getElementById('secForm'),cap=String(f&&f.q?f.q.value:X.draft||'').trim().slice(0,300);
 X.msgs=X.msgs||[];X.mst=via==='image'?'מכינה את התמונה…':'בודקת את הסרטון…';rerender();scrollEnd();
 let p=null;
 try{p=await prep()}catch(e){X.mst='';rerender();return toast(e&&e.message||'לא הצלחנו להכין את הקובץ')}
 X.draft='';X.msgs.push({role:'u',text:cap||(via==='image'?'תמונה':'סרטון'),via,t:Date.now()});X.mst=via==='image'?'מתארת את התמונה…':'מעבדת את הסרטון…';rerender();scrollEnd();
 try{const d=Object.assign({},p.call);if(cap)d.cap=cap;const r=await fnCall('secMedia',d);
  const cards=r.cards||[];X.msgs.push({role:'a',id:r.id||'',text:r.reply,src:r.src||[],ideas:[],th:null,cards,stale:false,mvia:via,t:Date.now()});
  if(via==='image'&&p.du&&r.id&&cards.some(c=>c.k==='scan'||c.k==='task')){X.media=X.media||{};X.media[r.id]=p.du}
  if(cards.length){X.fl=null;X.cl=null;eyStale()}
  if(Number.isFinite(r.pct))X.st.pct=r.pct;X.st.saving=r.saving?(X.st.saving||'month'):''}
 catch(e){const rs=e&&Object.prototype.hasOwnProperty.call(AIR,e.reason)?' (סיבה: '+AIR[e.reason]+')':'';X.msgs.push({role:'a',text:((e&&e.message)||'השליחה נכשלה. נסו שוב.')+rs,t:Date.now()});
  if(p.path){tok().then(t=>fetch(STB()+'/'+encodeURIComponent(p.path),{method:'DELETE',headers:{Authorization:'Firebase '+t}})).catch(()=>{})}}/* גיבוי: השרת וגם הניקוי המתוזמן מוחקים בכל מקרה */
 finally{X.mst='';p=null;if(cur().v==='sec')rerender();scrollEnd()}}
CHG.secImgF=el=>{const f=el.files&&el.files[0];el.value='';const l=mlim();if(!f||!l||!l.img)return;
 mediaSend('image',async()=>{if(f.type&&!/^image\//.test(f.type))throw new Error('הקובץ אינו תמונה');
  const du=await fbShrink(await rdU(f));if(du.length>1400000)throw new Error('התמונה גדולה מדי');
  return{du,call:{op:'see',kind:'image',mime:'image/jpeg',b64:du.slice(du.indexOf(',')+1)}}})};
CHG.secVidF=el=>{const f=el.files&&el.files[0];el.value='';const l=mlim();if(!f||!l||l.vid<=0)return;mediaSend('video',()=>vidPrep(f,l.vid))};
const rnd12=()=>Array.from(crypto.getRandomValues(new Uint8Array(12)),b=>b.toString(16).padStart(2,'0')).join('');
async function vidPrep(f,max){
 const url=URL.createObjectURL(f),v=document.createElement('video');v.preload='metadata';v.playsInline=true;let blob=null,name='';
 try{
  const dur0=await new Promise((ok,no)=>{const bad=()=>no(new Error('לא הצלחנו לקרוא את הסרטון. נסו סרטון אחר.')),t=setTimeout(bad,10000);v.onloadedmetadata=()=>{clearTimeout(t);ok(v.duration)};v.onerror=()=>{clearTimeout(t);bad()};v.src=url});
  let dur=dur0;if(dur===Infinity){/* סרטון webm שהוקלט בדפדפן: האורך נקבע רק אחרי דילוג לסוף */await new Promise(ok=>{const t=setTimeout(ok,4000);v.ondurationchange=()=>{if(Number.isFinite(v.duration)){clearTimeout(t);ok()}};v.currentTime=1e101});dur=v.duration;v.ondurationchange=null;try{v.currentTime=0}catch(e){}}
  if(!Number.isFinite(dur)||dur<=0)throw new Error('לא הצלחנו לקרוא את אורך הסרטון. נסו סרטון אחר.');
  if(dur>max+0.5)throw new Error('הסרטון ארוך מדי ('+Math.round(dur)+' שניות). אפשר עד '+max+' שניות.');
  let type=String(f.type||'').split(';')[0];blob=f;
  const EXT={'video/mp4':'.mp4','video/webm':'.webm','video/quicktime':'.mov','video/3gpp':'.3gp'};
  if(!EXT[type]||f.size>VMAX){blob=await vidShrink(v,dur);type='video/webm'}
  if(blob.size>VHARD)throw new Error('הסרטון עדיין כבד מדי אחרי ההקטנה. צלמו סרטון קצר יותר.');
  X.mst='מעלה את הסרטון…';updWait();
  const t=await tok();name=(bzB()?'b/'+SY.bizId+'/':'')+'sec_tmp/'+SY.uid+'/'+rnd12()+EXT[type];let r;
  try{r=await fetch(STB()+'?uploadType=media&name='+encodeURIComponent(name),{method:'POST',headers:{Authorization:'Firebase '+t,'Content-Type':type},body:blob})}catch(e){throw new Error('אין חיבור לאינטרנט')}
  if(!r.ok)throw new Error(r.status===403?'אין הרשאה להעלות סרטון (עד 12MB).':'העלאת הסרטון נכשלה ('+r.status+'). נסו שוב.');
  return{call:{op:'see',kind:'video',path:name},path:name}}
 finally{URL.revokeObjectURL(url);try{v.removeAttribute('src');v.load()}catch(e){}blob=null}}
function vidShrink(v,dur){return new Promise((ok,no)=>{/* הקטנה במכשיר: canvas 640 + MediaRecorder (בזמן אמת, אורך הסרטון) */
 const cv=document.createElement('canvas');
 if(typeof MediaRecorder==='undefined'||!cv.captureStream||!v.videoWidth)return no(new Error(CANT));
 const sc=Math.min(1,640/Math.max(v.videoWidth,v.videoHeight));cv.width=Math.max(2,Math.round(v.videoWidth*sc));cv.height=Math.max(2,Math.round(v.videoHeight*sc));
 const cx=cv.getContext('2d'),vs=cv.captureStream(25);let ac=null;
 try{const AC=window.AudioContext||window.webkitAudioContext;ac=new AC();const src=ac.createMediaElementSource(v),dst=ac.createMediaStreamDestination();src.connect(dst);dst.stream.getAudioTracks().forEach(t=>vs.addTrack(t))}catch(e){ac=null;v.muted=true}
 const mime=['video/webm;codecs=vp8,opus','video/webm;codecs=vp8','video/webm'].find(m=>MediaRecorder.isTypeSupported&&MediaRecorder.isTypeSupported(m))||'';
 const vsStop=()=>{try{vs.getTracks().forEach(t=>t.stop())}catch(e){}};
 let mr;try{mr=new MediaRecorder(vs,Object.assign({videoBitsPerSecond:700000,audioBitsPerSecond:64000},mime?{mimeType:mime}:{}))}catch(e){try{ac&&ac.close()}catch(e2){}vsStop();return no(new Error(CANT))}
 const ch=[];let tm=0,wd=0,fin=0;
 const clean=()=>{clearInterval(tm);clearTimeout(wd);try{ac&&ac.close()}catch(e){}};
 const end=()=>{if(fin)return;fin=1;clean();try{if(mr.state!=='inactive')mr.stop()}catch(e){no(new Error(CANT))}};
 const fail=()=>{if(fin)return;fin=1;clean();try{if(mr.state!=='inactive')mr.stop()}catch(e){}vsStop();no(new Error(CANT))};
 mr.ondataavailable=e=>{if(e.data&&e.data.size)ch.push(e.data)};
 mr.onstop=()=>{vsStop();if(fin){if(ch.length)ok(new Blob(ch,{type:'video/webm'}));else no(new Error(CANT))}};
 v.onended=end;v.onerror=fail;wd=setTimeout(fail,(dur+20)*1000);
 mr.start(1000);
 v.play().then(()=>{tm=setInterval(()=>{try{cx.drawImage(v,0,0,cv.width,cv.height)}catch(e){}X.mst='מקטינה את הסרטון… '+Math.min(99,Math.round(v.currentTime/dur*100))+'%';updWait();if(v.currentTime>=dur-0.05)end()},40)}).catch(fail)})}
/* ---------- כרטיסי "לסריקה" ו"פתח משימה" ---------- */
const cardMsg=id=>(X.msgs||[]).concat(X.pc&&X.pc.L||[]).find(m=>(m.cards||[]).some(c=>c.id===id));
const scMark=(id,mid,st)=>fnCall('secMedia',{op:'mark',mid,cid:id,st});
/* התמונה נשארת בזיכרון עד שכל כרטיסי הסריקה/משימה של אותה הודעה הוכרעו (או יציאה מהשיחה – chatEnter) */
const mdFree=mid=>{if(!X.media||!mid||!X.media[mid])return;const m=(X.msgs||[]).concat(X.pc&&X.pc.L||[]).find(x=>x.id===mid);if(!m||!(m.cards||[]).some(c=>(c.k==='scan'||c.k==='task')&&!c.st))delete X.media[mid]};
/* כרטיס מדיה גם כשההודעה לא נטענה בשיחה – מתוך "מול העיניים" (act: k, id, mid, doc, txt, via) */
const mdCard=id=>{const c=allCards().find(x=>x.id===id);if(c)return c;const a=((X.ey&&X.ey.open)||[]).map(x=>x.act).find(a=>a&&a.id===id&&(a.k==='scan'||a.k==='task'));return a?{id:a.id,k:a.k,doc:a.doc,txt:a.txt,eyVia:a.via}:null};
ACT.secScNo=async el=>{const id=el.dataset.id,mid=el.dataset.mid||(cardMsg(id)||{}).id||'';el.disabled=true;
 try{await scMark(id,mid,'no');doneSt(id,'no');mdFree(mid)}catch(e){if(notPend(e)){doneSt(id,'gone');mdFree(mid)}else{el.disabled=false;err(e)}}};
ACT.secScOk=async el=>{const id=el.dataset.id,m=cardMsg(id),mid=el.dataset.mid||(m||{}).id||'',c=mdCard(id),du=(X.media||{})[mid];
 if(!c||!du)return toast(AGAIN);
 const z=c.doc==='z',sup=z?null:(cat('e_sup')&&!cat('e_sup').hid?cat('e_sup'):catsOf('exp').find(x=>x.beh==='sup'));
 if(z&&(typeof zcNew!=='function'||!V.zc))return toast('מסך סגירת הקופה לא זמין');
 if(!z&&(!sup||typeof openAdd!=='function'||typeof sheetDraw!=='function'||!ACT.scanGo))return toast('אין קטגוריית ספקים. אפשר להוסיף חשבונית ידנית.');
 const run=async()=>{el.disabled=true;
  try{await scMark(id,mid,'ok')}catch(e){if(notPend(e)){doneSt(id,'gone');mdFree(mid);return}el.disabled=false;return err(e)}
  doneSt(id,'ok');mdFree(mid);
  if(z){/* דוח Z: תמיד סגירה חדשה, התמונה בחלק הראשון (צילום הקופה הפותחת של היום נשמר) */const o=ZC&&ZC.o||null;ZC=zcNew();ZC.o=o;ZC.z[0]=du;go('zc')}
  else{openAdd({type:'exp',cat:sup.id});A.step='scan';A.pg=[du];A.hi=[du];A.fid=null;sheetDraw();ACT.scanGo()}};
 /* בסגירת הקופה כבר יש צילומים או פרטים של דוח אחר – לא דורסים בשקט */
 if(z&&ZC&&(ZC.z.some(Boolean)||ZC.f))return ask('בסגירת הקופה כבר יש צילומים או פרטים של דוח אחר. להתחיל סגירה חדשה עם התמונה הזו? הצילומים והפרטים הקודמים יימחקו מהמסך.',run,'כן, סגירה חדשה');
 run()};
ACT.secTkOk=async el=>{const id=el.dataset.id,m=cardMsg(id),mid=el.dataset.mid||(m||{}).id||'',c=mdCard(id);
 if(!c)return toast(AGAIN);const du=(X.media||{})[mid]||'',txt=String(c.txt||'').trim().slice(0,500);
 if(!du&&!(m&&m.mvia==='video')&&c.eyVia!=='video')return toast(AGAIN);
 if(!txt||typeof fsx!=='function'||typeof tkDue!=='function'||!isA())return toast('אי אפשר לפתוח משימה כאן');
 /* מזהה המשימה נגזר מהכרטיס: אישור חוזר (למשל אחרי שהסימון בשרת נכשל) לא יוצר משימה שנייה – הקיימת מזוהה (409) */
 el.disabled=true;const now=Date.now(),tid='sec'+String(id).replace(/[^A-Za-z0-9]/g,''),nm=fbBy();let dup=0;
 const fields={owner:sv(SY.uid),by:sv(nm),role:sv('a'),txt:sv(txt),cr:iv(now),due:iv(tkDue(now)),st:sv('open'),open:sv('1'),pr:sv(''),img:sv(''),sub:iv(0),doneBy:sv(''),note:sv(''),ok:iv(0),late:sv(''),
  mi:iv(du?1:0)};
 /* 15.11.2026 (החלטת בעל הפרויקט): משימה מהמזכירה – לכל העובדים. יש רשימת עובדים (עד 30) – כולם נמענים; אחרת משימה ישנה לכל הצוות (בלי to), כמו FRM.tkAdd */
 if(typeof tkStaffLoad==='function'&&typeof TKST!=='undefined'&&!TKST.L){try{await tkStaffLoad()}catch(e){}}
 const SL=typeof TKST!=='undefined'&&Array.isArray(TKST.L)?TKST.L:null;
 if(SL&&SL.length&&SL.length<=30)Object.assign(fields,{to:{arrayValue:{values:SL.map(z=>sv(z.uid))}},toN:{arrayValue:{values:SL.map(z=>sv(z.name))}},ow:sv(SL.length===1?SL[0].uid:''),owN:sv(SL.length===1?SL[0].name:''),clt:iv(SL.length===1?now:0),np:iv(0),wp:iv(0)});
 try{await fsx('/tasks?documentId='+encodeURIComponent(tid),{method:'POST',body:JSON.stringify({fields})})}catch(e){if(e&&e.code===409)dup=1;else{el.disabled=false;return toast(typeof tkErr==='function'?tkErr(e):'פתיחת המשימה נכשלה')}}
 if(du&&!dup){try{await tkPutImg(tid,'m1',du)}catch(e){toast('המשימה נוצרה, אבל התמונה לא הועלתה');try{await tkPatch(tid,{mi:0})}catch(e2){}}}
 try{await scMark(id,mid,'ok')}catch(e){}
 doneSt(id,'ok');mdFree(mid);toast(dup?'✓ המשימה כבר נפתחה':'✓ המשימה נוספה');try{await tkLoad()}catch(e){}
 if(cur().v==='sec')rerender()};

/* =====================================================================================
   22.11.2026 (החלטת בעל הפרויקט): פקודות משימה בצ'אט – בתוך האפליקציה, בלי AI ובלי שינוי שרת.
   הפענוח ב-sec-cmd.js (SecCmd). רק מנהל (isA) ורק כשתוספת המשימות פעילה; אחרת – הזרימה הרגילה לשרת.
   יצירה: כרטיס אישור ("אשר ופתח" / "בטל" / שינוי יעד מהיר), וכתיבה כמו ACT.secTkOk ו-FRM.tkAdd (אותם שדות, מזהה נגזר מהכרטיס – אישור חוזר = 409).
   יעד מדויק (dl) ודחוף (pri) – רק כשהגלאי rv/tk2 מצא כללים חדשים (TKW.rv), כמו בטופס; כללים ישנים – יעד 3 ימי עסקים, בלי עדיפות.
   מעקב: מחושב מהמשימות שכבר נטענו (TK.L, טעינה מחדש רק אם עברה דקה – כמו tkPend). "הזכר לעובד" = ACT.tkwNd, "העבר לעובד" = ACT.tkMv / FRM.tkMv הקיימים.
   ההודעות והכרטיסים כאן נשמרים רק בשיחה הנוכחית (לא בהיסטוריה בשרת).
   ===================================================================================== */
function cxOn(){try{return !!(window.SecCmd&&typeof isA==='function'&&isA()&&typeof bzF==='function'&&bzF('tasks')&&typeof fsx==='function'&&typeof tkDue==='function')}catch(e){return false}}
const cxId=()=>'x'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const CXF=(()=>{try{return new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Jerusalem',hourCycle:'h23',year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric'})}catch(e){return null}})();
const cxP=ms=>{let o;if(!CXF){const x=new Date(ms);o={y:x.getFullYear(),m:x.getMonth(),d:x.getDate(),h:x.getHours(),n:x.getMinutes()}}else{const p={};CXF.formatToParts(new Date(ms)).forEach(x=>p[x.type]=+x.value);o={y:p.year,m:p.month-1,d:p.day,h:p.hour%24,n:p.minute}}o.dow=new Date(Date.UTC(o.y,o.m,o.d)).getUTCDay();return o};
const cxMs=d=>typeof tkIL!=='undefined'&&tkIL&&tkIL.at?tkIL.at(d.y,d.m,d.d,d.h,d.n):new Date(d.y,d.m,d.d,d.h,d.n).getTime();
const cxWhen=ms=>ms>0&&ms<Infinity?SecCmd.label(cxP(ms),cxP(Date.now())):'בלי יעד';
const cxDl=t=>typeof tkDl==='function'?tkDl(t):(t.dl>0?t.dl:t.dl===0?Infinity:t.due);
/* האם הכללים החדשים (dl/pri) פורסמו: נקבע פעם אחת לכל כרטיס (c.rv), כדי שמה שמוצג בכרטיס הוא בדיוק מה שנכתב */
const cxRv=c=>!!(c&&c.rv&&!c.old);
async function cxRvNow(){try{if(window.TKW&&typeof TKW.rv==='function'&&TKW.rv())return true;if(X.cxRv&&Date.now()-X.cxRv.t<6e5)return X.cxRv.v;if(typeof tkRv!=='function')return false;const v=await tkRv();X.cxRv={v:v===1,t:Date.now()};try{if(window.TKW&&typeof TKW.rvChk==='function')TKW.rvChk(1)}catch(e){}return v===1}catch(e){return false}}
const cxCard=id=>allCards().find(c=>c.loc&&c.id===id)||null;
const cxRe=()=>{if(cur().v==='sec')rerender()};
const cxB=(a,id,l,x)=>`<button class="chip" style="min-height:44px" data-a="${a}" data-id="${esc(id)}"${x||''}>${l}</button>`;
async function cxStaff(){if(typeof TKST==='undefined')return [];if(!TKST.L&&typeof tkStaffLoad==='function'){try{await tkStaffLoad()}catch(e){}}return Array.isArray(TKST.L)?TKST.L:[]}
async function cxTasks(){if(typeof TK==='undefined')return [];if((!TK.at||Date.now()-TK.at>60000)&&typeof tkLoad==='function'){try{await tkLoad()}catch(e){}}return TK.L||[]}
const cxTk=id=>typeof TK!=='undefined'?(TK.L||[]).find(t=>t.id===id)||null:null;
const cxWho=t=>t.owN||((t.toN||[]).length?(t.toN.slice(0,3).join(', ')+(t.toN.length>3?' ועוד '+(t.toN.length-3):'')):(t.role==='w'?'בקשה של '+(t.by||'עובד'):'כל הצוות'));
const cxSay=(text,cards)=>{X.msgs=X.msgs||[];X.msgs.push({role:'a',text,cards:cards||[],t:Date.now()});cxRe();scrollEnd()};
const cxPick=(act,opts,o)=>Object.assign({loc:1,k:'pick',id:cxId(),act,opts},o||{});
const cxStaffOpts=(S,all)=>S.slice(0,30).map(z=>({l:z.name,v:z.uid})).concat(all?[{l:S.length?'כל העובדים':'כל הצוות',v:'*'}]:[]);
const cxNames=c=>c.all?'כל העובדים':(c.to||[]).map(z=>z.name).join(' ו');

/* מיירט ב-ask2: true = טופל כאן */
async function cxTry(q,via){if(!cxOn())return false;const C=window.SecCmd;let k=C.intent(q);
 const pc=X.cq&&cxCard(X.cq.cid);let pend=pc&&!pc.st?X.cq:null;if(!pend)X.cq=null;
 /* ממתינה לתיאור משימה, אבל נשאלה שאלה (סימן שאלה) – השאלה הולכת לזרימה הרגילה והבקשה הפתוחה מבוטלת */
 if(pend&&!k&&/[?？]\s*$/.test(q)){pc.st='no';X.cq=null;pend=null}
 if(!k&&!pend)return false;
 X.msgs=X.msgs||[];const um={role:'u',text:q,via:via==='voice'?'voice':undefined,t:Date.now()};X.msgs.push(um);X.sending=1;X.draft='';X.vdr=0;cxRe();scrollEnd();
 let r;try{r=await cxRun(q,k,pend)}catch(e){X.msgs.push({role:'a',text:'לא הצלחתי לטפל בבקשה. '+((e&&e.message)||'נסו שוב.'),t:Date.now()});r=true}finally{X.sending=0}
 if(r===false){const i=X.msgs.indexOf(um);if(i>=0)X.msgs.splice(i,1);cxRe();return false}
 cxRe();scrollEnd();return true}
async function cxRun(q,k,pend){const C=window.SecCmd,now=cxP(Date.now());
 if(!k&&pend){/* תשובה לשאלה "מה צריך לעשות?" */const pc=cxCard(pend.cid);if(pc)pc.st='ok';X.cq=null;const b=C.body(q,now);return cxNew(Object.assign({},pend.d,{txt:b.txt,due:b.due,err:b.err,pri:b.pri}))}
 if(pend){const pc=cxCard(pend.cid);if(pc)pc.st='no';X.cq=null}
 if(['late','wait','status','lag','today','urg'].includes(k))return cxTrack(k);
 const S=await cxStaff(),r=C.parse(q,{staff:S,now});if(!r)return false;
 if(r.k==='new')return cxNew(r);
 return cxRef(r)}

/* ---------- יצירה ---------- */
async function cxNew(d){const S=await cxStaff();
 if(d.err){cxSay(d.err==='past'?'היעד שזוהה כבר עבר, ולכן הוגדר יעד של 3 ימי עסקים. אפשר לשנות בכרטיס.':'אפשר לקבוע יעד עד שנה קדימה, ולכן הוגדר יעד של 3 ימי עסקים. אפשר לשנות בכרטיס.');d.due=null;d.err=''}
 if(d.amb){const L=d.amb.list,nm=d.amb.nm||'';d.amb=null;return cxSay(`יש ${L.length} עובדים בשם "${nm}". למי התכוונת?`,[cxPick('who',L.map(z=>({l:z.name,v:z.uid})),{d})])}
 if(d.unk){const u=d.unk;d.unk='';return cxSay(S.length?`לא מצאתי עובד בשם "${u}" ברשימת העובדים הפעילים. למי לפתוח את המשימה?`:'רשימת העובדים לא נטענה, ולכן לא זיהיתי את העובד. אפשר לפתוח לכל הצוות, או לנסות שוב בעוד רגע.',[cxPick('who',cxStaffOpts(S,true),{d})])}
 if(!d.all&&!(d.to||[]).length)return cxSay(S.length?'למי לפתוח את המשימה?':'רשימת העובדים לא נטענה. אפשר לפתוח לכל הצוות, או לנסות שוב בעוד רגע.',[cxPick('who',cxStaffOpts(S,true),{d})]);
 if(!d.txt){const c={loc:1,k:'ask',id:cxId()};X.cq={cid:c.id,d};cxSay(`מה ${d.all?'העובדים צריכים':(d.to.length>1?'הם צריכים':d.to[0].name+' צריך/ה')} לעשות? כתבו במשפט אחד, אפשר עם יעד ועדיפות (למשל: לנקות את המחסן עד מחר דחוף).`,[c]);setTimeout(()=>{const f=document.getElementById('secForm');if(f&&f.q)f.q.focus()},60);return}
 const c={loc:1,k:'new',id:cxId(),txt:d.txt.slice(0,500),all:!!d.all,to:(d.to||[]).map(z=>({uid:z.uid,name:z.name})),due:d.due||null,pri:d.pri==='h'?'h':'',rv:await cxRvNow()};
 cxSay('זה מה שהבנתי. לאשר?',[c])}
function cxDueL(c){return c.due&&cxRv(c)?SecCmd.label(c.due,cxP(Date.now())):'3 ימי עסקים ('+cxWhen(tkDue(Date.now()))+')'}
async function cxCreate(c){const now=Date.now(),tid='sec'+String(c.id).replace(/[^A-Za-z0-9]/g,''),rv=cxRv(c),bad=m=>{const e=new Error(m);e.cx=m;return e};
 let SL=c.to;if(c.all){const S=await cxStaff();if(S.length>30)throw bad('יש יותר מ-30 עובדים פעילים. משימה לכולם פותחים ממסך המשימות');SL=S}
 const fields={owner:sv(SY.uid),by:sv(fbBy()),role:sv('a'),txt:sv(c.txt),cr:iv(now),due:iv(tkDue(now)),st:sv('open'),open:sv('1'),pr:sv(''),img:sv(''),sub:iv(0),doneBy:sv(''),note:sv(''),ok:iv(0),late:sv('')};
 /* כמו FRM.tkAdd: עובד אחד – תפוסה אצלו; כמה – מי שלוקח ראשון; אין רשימת עובדים – משימה ישנה לכל הצוות (בלי to) */
 if(SL&&SL.length){const one=SL.length===1;Object.assign(fields,{to:{arrayValue:{values:SL.map(z=>sv(z.uid))}},toN:{arrayValue:{values:SL.map(z=>sv(z.name))}},ow:sv(one?SL[0].uid:''),owN:sv(one?SL[0].name:''),clt:iv(one?now:0),np:iv(0),wp:iv(0),mi:iv(0)})}
 const dl=c.due&&rv?cxMs(c.due):null;if(dl!=null&&dl<=now)throw bad('היעד שנבחר כבר עבר. בחרו יעד אחר');
 if(rv){if(dl!=null)fields.dl=iv(dl);if(c.pri==='h')fields.pri=sv('h')}
 const post=()=>fsx('/tasks?documentId='+encodeURIComponent(tid),{method:'POST',body:JSON.stringify({fields})});let dup=0,np=0;
 try{await post()}catch(e){if(e&&e.code===409)dup=1;
  else if(e&&e.code===403&&('dl' in fields||'pri' in fields)){/* כללים ישנים (כמו X.old ב-tasks-wc.js) */c.old=1;
   if('dl' in fields){c.due=null;throw bad('השרת עוד לא עודכן ליעד גמיש, ולכן המשימה לא נפתחה. אפשר לאשר שוב עם יעד של 3 ימי עסקים.')}
   delete fields.pri;np=1;try{await post()}catch(e2){if(e2&&e2.code===409)dup=1;else throw e2}}
  else throw e}
 return {dup,np,dlL:dl!=null?SecCmd.label(c.due,cxP(now)):'3 ימי עסקים ('+cxWhen(tkDue(now))+')'}}
ACT.secCxOk=async el=>{const c=cxCard(el.dataset.id);if(!c||c.st||c.busy)return;if(!cxOn())return toast('אי אפשר לפתוח משימה כאן');c.busy=1;el.disabled=true;
 try{const r=await cxCreate(c);c.st='ok';c.res=r.dup?'✓ המשימה כבר נפתחה':'✓ המשימה נפתחה ל'+cxNames(c)+', יעד: '+r.dlL+(r.np?' (בלי עדיפות – תופעל אחרי עדכון השרת)':'');toast(c.res);try{await tkLoad()}catch(e){}}
 catch(e){toast(e&&e.cx||(typeof tkErr==='function'?tkErr(e):'פתיחת המשימה נכשלה'))}
 finally{c.busy=0;cxRe()}};
ACT.secCxNo=el=>{const c=cxCard(el.dataset.id);if(!c||c.st||c.busy)return;c.st='no';if(X.cq&&X.cq.cid===c.id)X.cq=null;cxRe()};
ACT.secCxDue=el=>{const c=cxCard(el.dataset.id);if(!c||c.st||c.busy)return;const v=el.dataset.v,n=cxP(Date.now());
 if(v==='b3')c.due=null;else{const x=SecCmd.dayAdd(n,v==='tm'?1:0);c.due={y:x.y,m:x.m,d:x.d,h:23,n:59}}cxRe()};

/* ---------- בחירה (עובד / משימה) ---------- */
ACT.secCxPick=async el=>{const c=cxCard(el.dataset.id);if(!c||c.st)return;const o=(c.opts||[])[+el.dataset.i];if(!o)return;c.st='ok';c.res='נבחר: '+o.l;cxRe();
 if(c.act==='who'){const d=Object.assign({},c.d);if(o.v==='*'){d.all=true;d.to=[]}else{const z=(await cxStaff()).find(x=>x.uid===o.v);if(!z){c.st='';return toast('העובד לא נמצא ברשימה. נסו שוב')}d.all=false;d.to=[z]}return cxNew(d)}
 const r=Object.assign({},c.r);if(c.act==='task')r.tid=o.v;else if(c.act==='rto'){const z=(await cxStaff()).find(x=>x.uid===o.v);if(!z){c.st='';return toast('העובד לא נמצא ברשימה. נסו שוב')}r.to=[z];r.amb=null;r.unk=''}
 cxRef(r)};

/* ---------- "הזכירי ל… על המשימה של …" / "תעבירי את המשימה של … ל…" ---------- */
async function cxRef(r){const S=await cxStaff(),nd=r.k==='nd';
 if(r.amb){const L=r.amb.list,nm=r.amb.nm||'';r.amb=null;return cxSay(`יש ${L.length} עובדים בשם "${nm}". ${nd?'למי להזכיר?':'למי להעביר?'}`,[cxPick('rto',L.map(z=>({l:z.name,v:z.uid})),{r})])}
 if(r.unk){const u=r.unk;r.unk='';if(nd)cxSay(`לא מצאתי עובד בשם "${u}". מחפשת בכל המשימות הפתוחות.`);else return cxSay(`לא מצאתי עובד בשם "${u}" ברשימת העובדים הפעילים. למי להעביר?`,[cxPick('rto',cxStaffOpts(S,false),{r})])}
 if(!r.tid){const L=SecCmd.matchTasks(r.q,await cxTasks(),{uid:nd&&r.to[0]?r.to[0].uid:''});
  if(!L.length)return cxSay(`לא מצאתי משימה פתוחה${r.q.length?' שמתאימה ל"'+r.q.join(' ')+'"':''}${nd&&r.to[0]?' של '+r.to[0].name:''}.`,[{loc:1,k:'go',id:cxId()}]);
  if(L.length>1)return cxSay(`מצאתי ${L.length} משימות פתוחות שמתאימות. על איזו מדובר?`,[cxPick('task',L.slice(0,6).map(t=>({l:String(t.txt||'').slice(0,60)+' · '+cxWho(t)+' · '+cxWhen(cxDl(t)),v:t.id})),{r})]);
  r.tid=L[0].id}
 const t=cxTk(r.tid);if(!t||t.st!=='open')return cxSay('המשימה כבר לא פתוחה.',[{loc:1,k:'go',id:cxId()}]);
 if(!nd&&!r.to.length)return cxSay(`למי להעביר את המשימה "${String(t.txt||'').slice(0,60)}"?`,[cxPick('rto',cxStaffOpts(S,false),{r})]);
 if(!nd&&t.ow===r.to[0].uid)return cxSay(`המשימה כבר בטיפול של ${r.to[0].name}.`);
 cxSay(nd?'לשלוח תזכורת על המשימה הזו?':'להעביר את המשימה?',[{loc:1,k:nd?'nd':'mv',id:cxId(),tid:t.id,txt:String(t.txt||'').slice(0,200),who:cxWho(t),to:nd?null:{uid:r.to[0].uid,name:r.to[0].name}}])}
/* מעקב אחרי פעולה קיימת (שמסיימת בעצמה ב-toast): הכרטיס מסומן "בוצע" כשהשינוי נראה במשימות שנטענו */
function cxWatch(c,ok,res){let k=0;const tm=setInterval(()=>{if(ok()){clearInterval(tm);c.st='ok';c.res=res;cxRe()}else if(++k>40)clearInterval(tm)},500)}
ACT.secCxNd=el=>{const id=el.dataset.tid||(cxCard(el.dataset.id)||{}).tid,t=cxTk(id);if(!t)return toast('המשימה לא נמצאה. רעננו את מסך המשימות');
 if(typeof ACT.tkwNd!=='function')return toast('"הזכר לעובד" לא זמין בגרסה הזו');const c=el.dataset.id&&cxCard(el.dataset.id),b=t.nd||0;
 ACT.tkwNd({dataset:{id:t.id}});/* החלון "לשלוח לעובד תזכורת?" והמגבלה של 30 דקות – של הפעולה הקיימת */
 if(c&&!c.st)cxWatch(c,()=>{const x=cxTk(t.id);return !!(x&&(x.nd||0)>b)},'✓ התזכורת נשלחה ל'+cxWho(t))};
ACT.secCxMv=async el=>{const id=el.dataset.tid;if(!cxTk(id))return toast('המשימה לא נמצאה. רעננו את מסך המשימות');await cxStaff();
 if(typeof ACT.tkMv!=='function')return toast('העברה לא זמינה כאן');ACT.tkMv({dataset:{id}})};
ACT.secCxMvGo=async el=>{const c=cxCard(el.dataset.id);if(!c||c.st||!c.to)return;const t=cxTk(c.tid);if(!t||t.st!=='open'){c.st='gone';cxRe();return toast('המשימה כבר לא פתוחה')}
 if(!(await cxStaff()).some(z=>z.uid===c.to.uid))return toast('העובד לא נמצא ברשימת העובדים הפעילים');
 if(typeof FRM.tkMv!=='function')return toast('העברה לא זמינה כאן');
 /* אותה פעולה כמו "העבר לעובד" במסך המשימות (FRM.tkMv): טופס זמני עם העובד שנבחר */
 const f=document.createElement('form');f.dataset.id=t.id;const i=document.createElement('input');i.type='hidden';i.name='u';i.value=c.to.uid;f.appendChild(i);
 el.disabled=true;FRM.tkMv(f);cxWatch(c,()=>{const x=cxTk(t.id);return !!(x&&x.ow===c.to.uid)},'✓ המשימה הועברה ל'+c.to.name)};
ACT.secCxGo=el=>{if(el.dataset.w){if(ACT.tkGoWait)return ACT.tkGoWait();}if(el.dataset.tid&&ACT.tkGoIt)return ACT.tkGoIt({dataset:{id:el.dataset.tid}});if(V.tk)go('tk')};

/* ---------- מעקב ---------- */
async function cxTrack(k){const L=await cxTasks(),n=Date.now(),p=cxP(n),d0=cxMs({y:p.y,m:p.m,d:p.d,h:0,n:0}),t1=SecCmd.dayAdd(p,1),d1=cxMs({y:t1.y,m:t1.m,d:t1.d,h:0,n:0});
 const op=L.filter(t=>t.st==='open'),late=op.filter(t=>cxDl(t)<n).sort((a,b)=>cxDl(a)-cxDl(b)),wait=L.filter(t=>t.st==='wait').sort((a,b)=>(a.sub||0)-(b.sub||0));
 const today=op.filter(t=>{const x=cxDl(t);return x>=d0&&x<d1}).sort((a,b)=>cxDl(a)-cxDl(b)),urg=op.filter(t=>t.pri==='h').sort((a,b)=>cxDl(a)-cxDl(b));
 const sum=`פתוחות: ${op.length} · באיחור: ${late.length} · ממתינות לאישור: ${wait.length} · להיום: ${today.length} · דחופות: ${urg.length}`;
 if(k==='lag'){const t30=n-30*864e5,m={};L.filter(t=>(t.cr||0)>=t30&&(typeof tkIsLate==='function'?tkIsLate(t):(t.st==='open'&&cxDl(t)<n)||t.late==='1')).forEach(t=>{const w=t.owN||((t.toN||[]).length===1?t.toN[0]:'')||(t.st!=='open'?t.doneBy:'')||'';if(!w)return;const o=m[w]||(m[w]={n:0,o:0});o.n++;if(t.st==='open')o.o++});
  const R=Object.entries(m).sort((a,b)=>b[1].n-a[1].n).slice(0,8);
  return cxSay(R.length?'משימות שעברו את היעד ב-30 הימים האחרונים, לפי עובד:\n'+R.map(([w,o])=>`• ${w}: ${o.n}${o.o?' (מהן '+o.o+' עדיין פתוחות)':''}`).join('\n'):'ב-30 הימים האחרונים אין משימות של עובד מסוים שעברו את היעד.',[{loc:1,k:'go',id:cxId()}])}
 const M={late:['באיחור',late],wait:['ממתינות לאישור',wait],today:['ליעד היום',today],urg:['דחופות (פתוחות)',urg],status:['באיחור ולהיום',late.concat(today.filter(t=>!late.includes(t)))]}[k];
 const A=M[1],items=A.slice(0,8).map(t=>({id:t.id,txt:String(t.txt||'').slice(0,120),who:cxWho(t),due:cxWhen(cxDl(t)),st:t.st,nd:!!(t.ow||(t.to||[]).length)}));
 cxSay(`**${k==='status'?'מצב המשימות':M[0]+': '+A.length}**\n${sum}${A.length?'':'\nאין משימות '+M[0]+'.'}${A.length>8?'\nמוצגות 8 הראשונות מתוך '+A.length+'.':''}`,[{loc:1,k:'list',id:cxId(),items}])}

/* ---------- כרטיסים ---------- */
function cxCardH(c,mid){const box=(h,x)=>`<div class="card${x?' secdone':''}" style="margin:6px 0 0;padding:8px" data-card="${esc(c.id)}">${h}</div>`;
 const goB=`<button class="chip" style="min-height:44px" data-a="secCxGo">למשימות</button>`;
 if(c.k==='go')return box(`<div class="secrow">${goB}</div>`);
 if(c.k==='list'){if(!c.items.length)return box(`<div class="secrow">${goB}</div>`);
  return box(c.items.map(t=>`<div class="secli"><p><b>${esc(t.txt)}</b></p><small class="note">${esc(t.who)} · ${t.st==='wait'?'ממתינה לאישור':'יעד: '+esc(t.due)}</small><div class="secrow">${t.st==='wait'?`<button class="chip" style="min-height:44px" data-a="secCxGo" data-w="1">לאישור</button>`:(t.nd?`<button class="chip" style="min-height:44px" data-a="secCxNd" data-tid="${esc(t.id)}">הזכר לעובד</button>`:'')+`<button class="chip" style="min-height:44px" data-a="secCxMv" data-tid="${esc(t.id)}">העבר לעובד</button><button class="chip" style="min-height:44px" data-a="secCxGo" data-tid="${esc(t.id)}">פתח משימה</button>`}</div></div>`).join(''))}
 if(c.st==='no')return box(`<b>בוטל</b>${c.txt?` <small class="note">${esc(c.txt)}</small>`:''}`,1);
 if(c.st==='gone')return box('<b>כבר לא רלוונטי</b>',1);
 if(c.st==='ok')return box(`<b>${esc(c.res||'בוצע ✓')}</b>${c.k==='new'||c.k==='nd'||c.k==='mv'?`<div class="secrow">${goB}</div>`:''}`,1);
 if(c.k==='ask')return box(`<small class="note">ממתינה לתיאור המשימה בהודעה הבאה.</small><div class="secrow">${cxB('secCxNo',c.id,'בטל')}</div>`);
 if(c.k==='pick')return box(`<div class="secrow">${(c.opts||[]).map((o,i)=>cxB('secCxPick',c.id,esc(o.l),` data-i="${i}"`)).join('')}</div>`);
 if(c.k==='nd')return box(`<b>תזכורת לעובד</b><p style="margin:4px 0">${esc(c.txt)}</p><small class="note">${esc(c.who)}</small><div class="secrow">${cxB('secCxNd',c.id,'שלח תזכורת')}${cxB('secCxNo',c.id,'בטל')}</div>`);
 if(c.k==='mv')return box(`<b>העברה לעובד</b><p style="margin:4px 0">${esc(c.txt)}</p><small class="note">עכשיו: ${esc(c.who)} ← אחרי ההעברה: ${esc(c.to.name)}</small><div class="secrow">${cxB('secCxMvGo',c.id,'אשר והעבר')}${cxB('secCxNo',c.id,'בטל')}</div>`);
 if(c.k==='new'){const rv=cxRv(c),dk=!c.due?'b3':(()=>{const n=cxP(Date.now()),k=Math.round((Date.UTC(c.due.y,c.due.m,c.due.d)-Date.UTC(n.y,n.m,n.d))/864e5);return c.due.h===23&&c.due.n===59&&k>=0&&k<=1?(k?'tm':'td'):''})();
  const q=(v,l)=>`<button class="chip${dk===v?' on':''}" style="min-height:44px" data-a="secCxDue" data-id="${esc(c.id)}" data-v="${v}" aria-pressed="${dk===v}">${l}</button>`;
  return box(`<b>לפתוח משימה?</b><p style="margin:4px 0"><b>מה:</b> ${esc(c.txt)}</p><p style="margin:4px 0"><b>למי:</b> ${esc(cxNames(c))}${c.to.length>1?' <small class="note">(מי שלוקח ראשון)</small>':''}</p><p style="margin:4px 0"><b>יעד:</b> ${esc(cxDueL(c))}</p><p style="margin:4px 0"><b>עדיפות:</b> ${c.pri==='h'&&rv?'דחוף':'רגילה'}</p>${!rv&&(c.due||c.pri)?'<p class="note" style="margin:4px 0">יעד מדויק ועדיפות יופעלו אחרי עדכון השרת. בינתיים המשימה תיפתח עם יעד של 3 ימי עסקים ובעדיפות רגילה.</p>':''}${rv?`<div class="secrow" role="group" aria-label="שינוי יעד">${q('td','היום')}${q('tm','מחר')}${q('b3','3 ימי עסקים')}</div>`:''}<div class="secrow">${cxB('secCxOk',c.id,'אשר ופתח')}${cxB('secCxNo',c.id,'בטל')}</div>`)}
 return ''}

window.__sec=X;
})();
