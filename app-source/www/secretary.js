/* SEC:1+2 – המזכירה העסקית. שלב 1 ("שלד ותוספת") ושלב 2 ("צ'אט, מראה הכספים וייעוץ"). קובץ עצמאי, נטען אחרי index.html (כמו orders-staff.js).
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
const ACTS={consent:'אישור תנאי השימוש',setup:'הגדרת שם ואופן פנייה',cfg:'מנהל המערכת עדכן הגדרות',readChat:'מנהל המערכת צפה בשיחה'};
const tm=t=>{if(!t)return '';const d=new Date(t);return d.toLocaleDateString('he-IL',{day:'numeric',month:'numeric',year:'2-digit'})+' '+d.toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'})};
V.sec=()=>{const T='המזכירה';
 if(!elig())return{t:T,h:'<div class="empty">המזכירה לא מופעלת בעסק הזה</div>'};
 if(!X.st||keyNow()!==X.key){load();return{t:T,h:'<div class="empty">טוען…</div>'}}
 const S=X.st;
 if(!S.ok)return{t:T,h:`<div class="card"><p class="note" style="margin:0">${esc(DENY[S.reason]||S.msg||'לא ניתן לפתוח את המזכירה כרגע.')}</p>${DENY[S.reason]?'':'<button class="btn g w" data-a="secRe" style="margin-top:10px">נסה שוב</button>'}</div>`};
 if(!S.consented)return{t:T,h:consentH(S)};
 if(!S.setupDone||X.edit)return{t:S.name||T,h:wizH(S)};
 if(X.set){if(!X.log||Date.now()-X.logAt>60000)logLoad();return{t:S.name||T,s:'הגדרות המזכירה',h:setH(S)}}
 if(!X.msgs&&!X.mb)msgLoad();
 return{t:S.name||T,s:'המזכירה העסקית',h:chatH(S)}};
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
  const hc=homeCards(m0),ds=dueStats(m0);
  f.late={sum:hc.lateSum,n:hc.lateN};f.due={m:m0,due:ds.due,rem:ds.rem,debit:hc.debit};
  const CF=cfMonths(m0,4,[]);f.cf=CF.map(x=>[x.m,x.sumAuto,x.sumTr,x.sumChk,x.sumCc,x.sumLn]);
  /* 13 שבועות (52): יציאות לפי התאריך של כל פריט בתזרים (צ'קים, חשבוניות לתשלום, אשראי, הלוואות); מה שכבר עבר מועדו – בשבוע הראשון.
     הכנסות: טווח לפי 3 החודשים המלאים האחרונים (monthIncome), לשבוע */
  const out=Array(WK).fill(0),w0=new Date(td+'T00:00:00'),wi=d=>{const k=Math.floor((new Date(d+'T00:00:00')-w0)/(7*864e5));return k<0?0:k},put=(d,a)=>{if(typeof d!=='string'||!(a>0))return;const k=wi(d);if(k<WK)out[k]=rnd(out[k]+a)};
  CF.forEach(x=>{x.chk.forEach(c=>put(c.date,c.a));x.tr.forEach(c=>put(c.date,c.a));(x.cc||[]).forEach(c=>put(c.date,c.a));(x.ln||[]).forEach(c=>put(c.date,c.a));
   x.chk.filter(c=>c.date>=td).forEach(c=>f.chk.length<200&&f.chk.push([c.date,String(subName(c.t)).slice(0,60),c.a]))});
  inv().filter(t=>bal(t)>0.004&&dueOf(t)<m0+'-01').forEach(t=>{out[0]=rnd(out[0]+bal(t))});
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
const SCR={due:'due',cf:'cf',tasks:'tk',zc:'zc'};
async function msgLoad(){X.mb=1;try{const r=await fnCall('secChatLoad',{limit:50});X.msgs=r&&r.msgs||[]}catch(e){X.msgs=X.msgs||[];X.msgErr=e&&e.message||'השיחה לא נטענה'}finally{X.mb=0;if(cur().v==='sec'&&!typing())rerender()}}
const fmtAt=t=>{if(!t)return '';const d=new Date(t);return d.toLocaleDateString('he-IL',{day:'numeric',month:'numeric'})+' '+d.toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'})};
function bub(m,i){if(m.role!=='a')return `<div class="secmsg u">${esc(m.text)}</div>`;
 const tx=esc(m.text).replace(/\[(\d{1,2})\]/g,'<sup>$1</sup>');
 const src=(m.src||[]).map((s,k)=>`<li><b>${k+1}.</b> לפי ${esc(s.l||'')}${s.at?', נכון ל-'+esc(fmtAt(s.at)):''}${SCR[s.s]&&V[SCR[s.s]]?` <button class="chip" data-a="secGo" data-v="${SCR[s.s]}" style="min-height:32px">למסך</button>`:''}</li>`).join('');
 const ideas=(m.ideas||[]).filter(x=>!(X.nr||{})[x.key]).map(x=>`<div class="card" style="margin:6px 0 0;padding:8px"><small>${esc(x.seen||'')}</small><button class="chip" data-a="secNr" data-k="${esc(x.key)}" style="min-height:40px;margin-top:4px">לא רלוונטי – לא להציע 90 יום</button></div>`).join('');
 const th=m.th&&X.st&&X.st.cfTh==null?`<div class="card" style="margin:6px 0 0;padding:8px"><small>סף מוצע להתראת תזרים: ${esc(Number(m.th).toLocaleString('he-IL'))} ₪</small><div class="row" style="margin-top:4px"><button class="chip" data-a="secTh" data-v="${esc(String(m.th))}" style="min-height:40px">לאשר את הסף</button><button class="chip" data-a="secThEd" style="min-height:40px">סף אחר</button></div></div>`:'';
 return `<div class="secmsg a${m.stale?' secwarn':''}">${tx}${src?`<details class="secsrc"><summary>מקורות (${(m.src||[]).length})</summary><ol style="margin:4px 0;padding-inline-start:18px;list-style:none">${src}</ol></details>`:''}${ideas}${th}</div>`}
function chatH(S){const pct=Number.isFinite(S.pct)?S.pct:null,fin=!!secFinOk();
 const bar=`<div class="secbar" id="secBar"><span>${fin?'נתוני הכספים: מהמכשיר, נכונים ל-'+esc(fmtAt(Date.now())):S.mirror===false?'מראה הכספים כבוי':S.mirrorAt?'נתוני הכספים נכונים ל-'+esc(fmtAt(S.mirrorAt)):'אין נתוני כספים במכשיר הזה'}</span>${pct!=null?`<span id="secPct">ניצול החודש: <bdi dir="ltr">${pct}%</bdi></span>`:''}<button class="chip" data-a="secSet" style="min-height:36px;margin-inline-start:auto">הגדרות</button></div>`;
 const warn=S.saving?`<div class="card secwarn" id="secSaving"><small>${S.saving==='day'?'הגעתם לתקרת השימוש היומית – אפשר להמשיך מחר.':'הגעתם לתקרת השימוש החודשית – המזכירה במצב חיסכון עד תחילת החודש או הגדלת התקרה.'}</small></div>`:pct>=80?`<div class="card secwarn"><small>ניצלתם ${pct}% מתקרת השימוש החודשית.</small></div>`:'';
 const hi=S.call?`שלום ${esc(S.call)}! `:'שלום! ';
 const L=X.msgs||[];
 const body=X.mb&&!L.length?'<div class="empty">טוען…</div>':(L.length?L.map(bub).join(''):`<div class="secmsg a">${hi}אני ${esc(S.name)}. אפשר לשאול אותי על הכספים, הספקים, העובדים, המשימות וההזמנות של העסק.</div>`)+(X.msgErr?`<p class="note">${esc(X.msgErr)}</p>`:'');
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
 <button class="btn g w" data-a="secEdit" style="margin-top:10px">שינוי שם ואופן פנייה</button><button class="btn g w" data-a="secSetX" style="margin-top:8px">חזרה לשיחה</button>
 <div class="sec"><h3>יומן פעולות</h3></div>${logH()}`}
ACT.secSet=()=>{X.set=1;rerender()};
ACT.secSetX=()=>{X.set=0;rerender()};
ACT.secGo=el=>{const v=el.dataset.v;if(V[v])go(v)};
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
  X.msgs.push({role:'a',text:r.reply,src:r.src||[],ideas:r.ideas||[],th:r.th||null,stale:!!r.stale,mode:r.mode,t:Date.now()});
  if(Number.isFinite(r.pct))X.st.pct=r.pct;X.st.saving=r.saving?(X.st.saving||'month'):'';if(r.mode==='saving')X.st.saving=X.st.saving||'month'}
 catch(e){X.msgs.push({role:'a',text:(e&&e.message)||'השליחה נכשלה. נסו שוב.',t:Date.now()});if(e&&e.reason==='rate-limit')X.draft=q}
 finally{X.sending=0;X.deep=0;if(cur().v==='sec')rerender();scrollEnd()}}
window.__secAsk=ask2;

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
 const pay={};for(const a of c.admins||[])pay[a.uid]=x['pay_'+a.uid]==='1';
 const data={bizId:id,mode:x.mode==='main'?'main':'all',mainUid:x.mainUid||'',emp:x.emp==='1'};if(Object.keys(pay).length)data.pay=pay;if(cap)data.capCents=+cap*100;else if(c.capCents!=null)data.capCents=null;/* ריק אחרי שהייתה תקרה = ניקוי */
 b.disabled=true;try{const r=await window.fnCall('secAdminSetCfg',data);SA[id]=r;toast('נשמר')}catch(e){err(e)}finally{b.disabled=false;if(cur().v==='sab')rerender()}};
ACT.secSaChat=el=>{const id=el.dataset.id,u=el.dataset.u;ask('לצפות בשיחה? הצפייה תירשם ביומן הפעולות, ומנהל העסק יראה אותה.',async()=>{
 try{const r=await window.fnCall('secAdminReadChat',{bizId:id,uid:u});const L=r&&r.msgs||[];
  dlg(`<h3>שיחה (קריאה בלבד)</h3>${L.length?L.map(m=>`<div class="card" style="margin:6px 0;${m.role==='a'?'border-color:var(--acc)':''}"><small class="note">${m.role==='a'?'המזכירה':'המנהל'} · ${esc(tm(m.t))}</small><div style="white-space:pre-wrap">${esc(m.text)}</div></div>`).join(''):'<p class="note">אין הודעות בשיחה</p>'}<button class="btn g w" data-a="closeDlg">סגירה</button>`)}catch(e){err(e)}},'כן, לצפות')};

window.__sec=X;
})();
