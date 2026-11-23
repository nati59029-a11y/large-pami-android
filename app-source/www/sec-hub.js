/* גיטי – מרכז שליטה (23.11.2026, "גיטי מנהלת עסק", סבב 1). בלי שינוי שרת ובלי שינוי חוקים: הכול נבנה מפונקציות ומקורות שכבר קיימים באפליקציה.
   מה כאן:
   1. מרכז שליטה (מחליף את "מול העיניים" – הלשונית eyes; כל מה שהיה שם נשאר ב-secretary.js eyH): מצב חיבורים (רק לפי מקור אמיתי, אחרת "טרם נבדק"),
      "מה דורש את תשומת הלב שלך" (פריטי "מול העיניים" + משימות/בקשות/חשבוניות מכרטיס "דורש טיפול" בבית, בלי כפילויות לפי מזהה), פעולות מהירות.
   2. מרכז אישורים מאוחד (לשונית appr): מציג את אותן שורות של "מול העיניים" שממתינות לאישור, עם אותם כפתורים (אותן פעולות), ומשימות שממתינות לאישור (tkOk).
   3. יומן פעולות מלא (לשונית hlog): sec_log בדפים, חיפוש, סינון לפי סוג ותאריך, פירוט בלחיצה, ויומן "מה עשיתי לבד" של התראות הטלפון (מקומי במכשיר).
      sec_mlog אסור לקריאה ישירה מהאפליקציה לפי firestore.rules – נקרא דרך השרת (secLearn op:'log', אותו מקור כמו במסך "כללים אישיים"; רק כשהכללים האישיים פעילים).
   סבב 2 (23.11.2026): תוצאה בכל שורה ביומן (res/why מהשרת – רשומות ישנות: "לא נרשמה"), סינון "נכשל"/"הצליח", ומצב חיבור כספית (cxBotTok op:'info' – רק למנהל שיש לו "סנכרון כספית").
   4. אזהרת משימה כפולה (task-dup.js) לפני יצירת משימה בטופס המשימות, בכרטיס "פתח משימה" בצ'אט ובאישור משימה מתמונה. אזהרה בלבד – לא חוסם ולא מוחק.
   Core (טהור, בלי DOM) נבדק ב-node: firebase/tests/sec-hub.unit.test.js. עיצוב: רק משתני הערכה (--acc, --card, --line, --ink, --bad). */
(function(root){
'use strict';
/* ===================== Core (טהור) ===================== */
const ST={ok:'פעיל',off:'מנותק',perm:'דורש הרשאה',unk:'טרם נבדק'};
/* מצב חיבור לפי מקור אמיתי בלבד. src: {gs: תשובת secGoogle status, wc: תשובת secWaCfg get, nf: {native,plug,on,en,err}, st: תשובת secState,
   cx: תשובת cxBotTok info (או {err}); בלי cx – אין שורת כספית (עסק בלי סנכרון כספית / לא מנהל)}. אין מקור ← unk */
function connOf(src){
 src=src||{};const o=[],gs=src.gs,wc=src.wc,nf=src.nf,st=src.st,cx=src.cx;
 const c=(k,l,s,n,a)=>o.push({k,l,s,sl:ST[s],n:n||'',a:a||''});
 if(!gs||gs.err)c('gmail','Gmail','unk',gs&&gs.err?'לא נטען':'');
 else if(!gs.configured)c('gmail','Gmail','off','החיבור ל-Google עוד לא הוגדר בשרת','set');
 else{const B=gs.boxes||[];
  if(!B.length)c('gmail','Gmail','off','לא חוברה תיבה','set');
  else if(B.some(b=>b.st==='expired'))c('gmail','Gmail','perm','החיבור פג – צריך לחבר מחדש','set');
  else c('gmail','Gmail','ok',B.length===1?'תיבה אחת מחוברת':B.length+' תיבות מחוברות','set')}
 if(!gs||gs.err)c('gcal','יומן Google','unk',gs&&gs.err?'לא נטען':'');
 else if(!gs.configured)c('gcal','יומן Google','off','החיבור ל-Google עוד לא הוגדר בשרת','set');
 else{const k=gs.cal||{};
  if(!k.connected)c('gcal','יומן Google','off','לא מחובר','set');
  else if(k.st==='expired')c('gcal','יומן Google','perm','החיבור פג – צריך לחבר מחדש','set');
  else c('gcal','יומן Google','ok',k.last?'סונכרן '+(root.__hubFmt?root.__hubFmt(k.last):''):'מחובר','set')}
 if(!wc||wc.err)c('wa','ווצאפ','unk',wc&&wc.err?'לא נטען':'');
 else if(wc.connected)c('wa','ווצאפ','ok',wc.stop?'מחובר · השליחה האוטומטית נעצרה':'מחובר','set');
 else c('wa','ווצאפ','off','עוד לא מחובר','set');
 if(!nf||!nf.native)c('notif','התראות מהטלפון','unk','זמין רק באפליקציה בטלפון');
 else if(nf.err||!nf.plug)c('notif','התראות מהטלפון','unk',nf.err?'לא נטען':'צריך לעדכן את האפליקציה','notif');
 else if(nf.on&&nf.en)c('notif','התראות מהטלפון','ok','הקליטה פועלת','notif');
 else if(nf.on&&!nf.en)c('notif','התראות מהטלפון','perm','אין גישה להתראות בהגדרות אנדרואיד','notif');
 else c('notif','התראות מהטלפון','off','הקליטה כבויה','notif');
 if(!st||!st.ok)c('biz','מערכות העסק (נתוני הכספים)','unk');
 else if(st.mirror===false)c('biz','מערכות העסק (נתוני הכספים)','off','מראה הכספים כבוי בהגדרות','set');
 else if(Number.isFinite(st.mirrorAt)&&st.mirrorAt>0)c('biz','מערכות העסק (נתוני הכספים)','ok','נכון ל-'+(root.__hubFmt?root.__hubFmt(st.mirrorAt):''));
 else c('biz','מערכות העסק (נתוני הכספים)','unk','עוד לא נשלחו נתונים');
 if(cx){const L='כספית (רובוט מחשב החנות)',lr=cx.lr,at=lr&&lr.at&&root.__hubFmt?root.__hubFmt(lr.at):'';
  if(cx.err)c('cx',L,'unk','לא נטען');
  else if(!cx.dev)c('cx',L,'off','אין מחשב מחובר','cx');
  else if(!lr)c('cx',L,'unk','עוד לא סונכרן','cx');
  else if(lr.st==='ok')c('cx',L,'ok','סונכרן '+at,'cx');
  else if(lr.st==='needs-login')c('cx',L,'perm','צריך להתחבר לכספית במחשב החנות','cx');
  else if(lr.st==='fail')c('cx',L,'off','הסנכרון האחרון נכשל'+(at?' ('+at+')':''),'cx');
  else c('cx',L,'unk','סנכרון בתהליך או ממתין לניסיון חוזר','cx')}
 return o}
/* איחוד פריטי תשומת לב: eyes ראשונים; פריט נוסף שמזהה שלו (או הפניה) כבר קיים – לא מוצג שוב */
const keysOf=x=>[x&&x.id,x&&x.ref,x&&x.go&&x.go.id,x&&x.act&&x.act.tid].filter(v=>typeof v==='string'&&v);
function mergeAttention(eyes,extra){
 const seen=new Set();(Array.isArray(eyes)?eyes:[]).forEach(x=>keysOf(x).forEach(k=>seen.add(k)));
 const out=[];(Array.isArray(extra)?extra:[]).forEach(x=>{const ks=keysOf(x);if(!ks.length||ks.some(k=>seen.has(k)))return;ks.forEach(k=>seen.add(k));out.push(x)});
 return out}
/* יומן: סוג לפי שם הפעולה */
const LT=[['facts','מידע על העסק',/^(fact|fixed|price|sens|rule|bank|import)/],['cal','יומן ותזכורות',/^(cal|rem)/],['rep','דוחות והתראות',/^(report|insight|notify|empAlert|daySum)/],
 ['chat','שיחה והיסטוריה',/^(readChat|hist|retention)/],['set','הגדרות והסכמה',/^(consent|setup|cfg|mirror|stop|cap)/],['nf','התראות מהטלפון (במכשיר)',/^nf:/],['ml','נשלח לבד (כללים אישיים)',/^ml:/]];
const logType=a=>{a=String(a||'');const m=LT.find(x=>x[2].test(a));return m?m[0]:'other'};
const logTypes=()=>LT.map(x=>[x[0],x[1]]).concat([['other','אחר']]);
const WHO={mgr:'מנהל העסק',sa:'מנהל המערכת',auto:'פעולה אוטומטית',sec:'המזכירה'};
const whoL=w=>WHO[w]||'המערכת';
/* תוצאה (סבב 2): res 'ok'|'fail' מהשרת; רשומה ישנה / פעולה בלי תוצאה – '' */
const resOf=x=>x&&(x.res==='ok'||x.res==='fail')?x.res:'';
const WHY={retries:'לא עובדה אחרי כמה ניסיונות',limit:'הגיע למגבלת ההודעות',send:'השליחה נכשלה','send-off':'השליחה נכשלה שוב – הכלל עבר לאישור ידני',watch:'מעקב המייל לא הופעל',
 'google-error':'תקלה בחיבור ל-Google',stuck:'הזיהוי נתקע',error:'תקלה',exchange:'Google לא אישרה את החיבור','no-refresh':'Google לא נתנה הרשאה קבועה',
 /* תיקון סבב 2: סיבות נפוצות נוספות (חשבוניות, ווצאפ, Google) – בלי "קוד: …" באנגלית */
 file:'הקובץ לא נקרא',quota:'הגיע למגבלת השימוש בבינה המלאכותית',ai:'הזיהוי האוטומטי נכשל','resource-exhausted':'הגיע למגבלת שימוש',
 unavailable:'השירות לא זמין כרגע',internal:'תקלה בשרת','deadline-exceeded':'עבר הזמן המוקצב','permission-denied':'אין הרשאה',unauthenticated:'נדרשת התחברות מחדש',
 'not-connected':'החשבון לא מחובר','maybe-sent':'לא ברור אם נשלח – כדאי לבדוק','no-tpl':'אין תבנית ווצאפ מאושרת','bad-to':'מספר או כתובת לא תקינים',
 'no-wa':'ווצאפ לא מחובר','no-wa-token':'ווצאפ לא מחובר',stopped:'השליחה האוטומטית עצורה','bad-link':'קישור למסמך לא תקין','bad-doc-link':'קישור למסמך לא תקין',
 'google-expired':'החיבור ל-Google פג','google-scope':'חסרה הרשאה ב-Google','google-not-configured':'Google לא הוגדר','no-google-key':'Google לא הוגדר'};
const whyL=w=>{w=String(w||'');return !w?'':WHY[w]||'קוד: '+w};
function resL(x){const r=resOf(x);if(r==='ok')return 'הצליח';if(r==='fail'){const w=Array.isArray(x.why)?x.why.join(', '):whyL(x.why);return 'נכשל'+(w?' – '+w:'')}return ''}
/* sec_mlog דרך השרת (secLearn op:'log': {id,t,ch,st,to,ri,by,mine,whyL[]}) ← שורות יומן */
function mlogRows(items){return (Array.isArray(items)?items:[]).filter(x=>x&&x.id&&x.t).map(x=>({id:'ml'+x.id,t:+x.t,act:'ml:'+(x.st||''),who:'auto',src:'mlog',
 title:(x.st==='fail'?'שליחה לבד נכשלה':'נשלח לבד')+' ב'+(x.ch==='mail'?'מייל':'ווצאפ')+(x.to?' ל'+x.to:''),note:(x.ri?'לפי הכלל: '+x.ri:'')+(x.by?' · בעל הכלל: '+x.by:''),
 res:x.st==='sent'?'ok':x.st==='fail'?'fail':'',why:Array.isArray(x.whyL)?x.whyL.filter(w=>typeof w==='string'):[]}))}
/* תיקון סבב 2 (ליקוי 1): שליחה לבד לפי כלל נרשמת גם ב-sec_log (mrSend/mrFail עם ml = מזהה שורת sec_mlog) – שורת ה-mlog שכבר מופיעה לא מוצגת שוב */
function mlDedup(srv,ml){const has=new Set((Array.isArray(srv)?srv:[]).filter(x=>x&&x.ml).map(x=>'ml'+x.ml));return (Array.isArray(ml)?ml:[]).filter(x=>!has.has(x.id))}
function logFilter(L,f){f=f||{};const q=String(f.q||'').trim().toLowerCase().split(/\s+/).filter(Boolean);
 return (Array.isArray(L)?L:[]).filter(x=>{
  if(f.type&&logType(x.act)!==f.type)return false;
  if(f.res&&resOf(x)!==f.res)return false;
  if(f.from&&!(x.t>=f.from))return false;
  if(f.to&&!(x.t<=f.to))return false;
  if(q.length){const h=(String(x.title||'')+' '+String(x.note||'')+' '+whoL(x.who)+' '+String(x.act||'')).toLowerCase();if(!q.every(w=>h.includes(w)))return false}
  return true})}
/* שאילתת sec_log לדף: t מהחדש לישן; cursor = t של השורה האחרונה שנטענה (כולל, ומסננים כפולות לפי מזהה); from/to = טווח תאריכים במילישניות */
function logQuery(o){o=o||{};const F=[],ff=(op,v)=>({fieldFilter:{field:{fieldPath:'t'},op,value:{integerValue:String(Math.floor(v))}}});
 if(o.from>0)F.push(ff('GREATER_THAN_OR_EQUAL',o.from));
 const up=o.cursor>0?(o.to>0?Math.min(o.to,o.cursor):o.cursor):(o.to>0?o.to:0);
 if(up>0)F.push(ff('LESS_THAN_OR_EQUAL',up));
 const q={from:[{collectionId:'sec_log'}],orderBy:[{field:{fieldPath:'t'},direction:'DESCENDING'}],limit:o.n||50};
 if(F.length===1)q.where=F[0];else if(F.length>1)q.where={compositeFilter:{op:'AND',filters:F}};
 return q}
const Core={ST,connOf,mergeAttention,logType,logTypes,logFilter,logQuery,whoL,resOf,resL,whyL,mlogRows,mlDedup};
if(typeof module==='object'&&module&&module.exports){module.exports=Core;return}
root.SecHubCore=Core;

/* ===================== המסך ===================== */
if(typeof ACT==='undefined'||typeof V==='undefined'||typeof FRM==='undefined')return;
const X=window.__sec,TABS=window.__secTabs;if(!X||!Array.isArray(TABS)||typeof window.__secEyRow!=='function')return;
const fnCall=(n,d)=>{d=d&&typeof d==='object'?d:{};if(SY&&SY.sa&&SY.bizId&&!('bizId'in d))d=Object.assign({bizId:SY.bizId},d);return window.fnCall(n,d)};
const tmF=t=>{if(!t)return '';try{const d=new Date(t);return d.toLocaleDateString('he-IL',{day:'numeric',month:'numeric',year:'2-digit'})+' '+d.toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'})}catch(e){return ''}};
root.__hubFmt=tmF;
const H={at:0,b:0,gs:null,wc:null,nf:null,cx:null,all:0,lg:null};
const re=()=>{try{if(cur().v==='sec'&&!(typeof typing==='function'&&typing()))rerender()}catch(e){}};
const adm=()=>{try{return typeof fbAdmin==='function'&&fbAdmin()&&bzF('tasks')}catch(e){return false}};
/* מקומות בטאבים: אחרי "מרכז שליטה" (eyes) */
{const i=TABS.findIndex(x=>x[0]==='eyes');const add=[['appr','מרכז אישורים'],['hlog','יומן פעולות']].filter(x=>!TABS.some(y=>y[0]===x[0]));TABS.splice(i<0?TABS.length:i+1,0,...add)}

/* ---------- מצב חיבורים: קריאה אחת לכל מקור, בלי שינוי נתונים ---------- */
const cap=()=>window.Capacitor||null;
const native=()=>{try{const C=cap();return !!(C&&C.isNativePlatform&&C.isNativePlatform())}catch(e){return false}};
async function hubLoad(force){
 if(H.b||(!force&&H.at&&Date.now()-H.at<60000))return;H.b=1;
 const em=e=>({err:e&&e.message||'לא נטען'});
 try{
  const C=cap(),P=native()&&C.Plugins&&C.Plugins.LpNotif||null;
  /* כספית: רק מנהל שיש לו מסך "סנכרון כספית" – אחרת אין שורה (לא "מנותק" מומצא) */
  const cxOk=typeof isA==='function'&&isA()&&typeof V.cxSync==='function'&&typeof window.oxImpOk==='function'&&window.oxImpOk();
  const [gs,wc,nf,cx]=await Promise.all([
   fnCall('secGoogle',{op:'status'}).then(r=>r&&r.ok?r:{err:'לא נטען'}).catch(em),
   fnCall('secWaCfg',{op:'get'}).then(r=>r&&r.ok?r:{err:'לא נטען'}).catch(em),
   (async()=>{if(!native())return{native:false};if(!P)return{native:true,plug:false};
    try{const c=await P.getConfig(),e=await P.isEnabled();return{native:true,plug:true,on:!!(c&&c.on)&&String(c&&c.u||'')===String(SY&&SY.uid||''),en:!!(e&&e.on)}}catch(e){return{native:true,plug:true,err:1}}})(),
   cxOk?fnCall('cxBotTok',{op:'info'}).then(r=>r&&typeof r==='object'&&'dev' in r?r:{err:'לא נטען'}).catch(em):Promise.resolve(null)]);
  H.gs=gs;H.wc=wc;H.nf=nf;H.cx=cx;H.at=Date.now()}
 finally{H.b=0;re()}}
const connsH=()=>{const L=Core.connOf({gs:H.gs,wc:H.wc,nf:H.nf,st:X.st,cx:H.cx});
 return L.map(c=>`<div class="secli"><div class="eyh"><div><b>${esc(c.l)}</b><small class="note" style="display:block">${esc(c.n)}</small></div><span class="sectags${c.s==='ok'?' g':c.s==='unk'?'':' w'}">${esc(c.sl)}</span></div>${c.a&&c.s!=='ok'?`<div class="secrow">${c.a==='notif'?'<button class="chip" data-a="secTab" data-v="notif" style="min-height:44px">פתיחה</button>':c.a==='cx'?'<button class="chip" data-a="hubCx" style="min-height:44px">סנכרון כספית</button>':'<button class="chip" data-a="secSet" style="min-height:44px">הגדרות</button>'}</div>`:''}</div>`).join('')};

/* ---------- תשומת לב: משימות / בקשות / חשבוניות מהכרטיס "דורש טיפול" בבית ---------- */
const clip=(s,n)=>{s=String(s||'').replace(/\s+/g,' ').trim();return s.length>n?s.slice(0,n)+'…':s};
function extras(){const o=[];if(!adm())return o;
 try{const now=Date.now(),L=(typeof TK!=='undefined'&&TK&&TK.L)||[];
  L.forEach(t=>{if(!t||!t.id)return;
   if(t.st==='wait')o.push({k:'tk',id:'tk:'+t.id,ref:t.id,title:clip(t.txt,100),sub:'ממתינה לאישור'+(t.doneBy?' · בוצעה ע"י '+t.doneBy:''),tag:'ממתינה לאישור',st:'wait',tid:t.id,ap:1});
   else if(t.st==='open'&&typeof tkDl==='function'&&now>tkDl(t))o.push({k:'tk',id:'tk:'+t.id,ref:t.id,title:clip(t.txt,100),sub:'באיחור'+(t.owN?' · '+t.owN:''),tag:'באיחור',st:'late',tid:t.id})});
  if(typeof RQ!=='undefined'&&typeof rqN==='function'&&rqN()>0)(RQ.L||[]).forEach(r=>{if(r&&r.id)o.push({k:'rq',id:'rq:'+r.id,ref:r.id,title:clip((r.by?r.by+': ':'')+(r.txt||'בקשה'),100),sub:'בקשת עובד שממתינה לטיפול',tag:'בקשת עובד'})})}catch(e){}
 return o}
function invRows(){if(!adm()&&!(typeof isA==='function'&&isA()))return [];const r=[];
 try{const td=today(),E=brFil(),late=inv().filter(t=>inBr(t,E)&&isLate(t,td)).length,D=dueStats(HM);
  if(late>0)r.push({a:'hcLate',n:late,t:'חשבוניות באיחור לתשלום'});if(D&&D.open&&D.open.length>0)r.push({a:'hcDue',n:D.open.length,t:'חשבוניות לתשלום ב'+mfmt(HM)})}catch(e){}
 return r}
function attH(O){const X0=extras();const E=Core.mergeAttention(O,X0),inv0=invRows(),n=E.length,sh=H.all?E:E.slice(0,5);
 const rows=sh.map(x=>`<div class="secli" data-ey="${esc(x.id)}"><button type="button" class="secnb" data-a="hubGo" data-k="${esc(x.k)}" data-id="${esc(x.ref||'')}" data-s="${esc(x.st||'')}" aria-label="פתיחה: ${esc(x.title)}"><p><b>${esc(x.title)}</b> <span class="sectags">${esc(x.tag||'')}</span></p><small class="note">${esc(x.sub||'')}</small></button>
  <div class="secrow">${x.ap?`<button class="chip" data-a="tkOk" data-id="${esc(x.tid)}">אשר</button>`:''}<button class="chip" data-a="hubGo" data-k="${esc(x.k)}" data-id="${esc(x.ref||'')}" data-s="${esc(x.st||'')}">פתיחה</button></div></div>`).join('');
 const iv=inv0.map(r=>`<button type="button" class="chip" data-a="${r.a}" style="min-height:44px"><b>${r.n}</b> ${esc(r.t)}</button>`).join(' ');
 if(!n&&!iv)return '';
 return `<div id="secHubAtt">${rows}${n>5?`<button class="chip" data-a="hubMore" style="min-height:44px">${H.all?'פחות':'עוד ('+(n-5)+')'}</button>`:''}${iv?`<div class="secrow">${iv}</div>`:''}</div>`}
ACT.hubMore=()=>{H.all=!H.all;rerender()};
ACT.hubGo=el=>{const k=el.dataset.k,id=el.dataset.id||'';
 try{if(k==='rq'){go('rq');return}
  if(k==='tk'){TKT=el.dataset.s==='wait'?'wait':'late';go('tk')}}catch(e){}};

/* ---------- פעולות מהירות: רק מה שמחובר לפעולה קיימת ---------- */
const hasTab=k=>TABS.some(x=>x[0]===k);
function quickH(){const q=[],b=(a,t,v)=>q.push(`<button type="button" class="chip" style="min-height:44px" data-a="${a}"${v?` data-v="${v}"`:''}>${t}</button>`);
 if(adm()&&typeof ACT.hmTkNew==='function')b('hmTkNew','＋ משימה חדשה');
 if(hasTab('cal'))b('secTab','תזכורת / אירוע ביומן','cal');
 if(hasTab('inv'))b('secTab','חשבוניות','inv');
 if(hasTab('wa'))b('secTab','ווצאפ','wa');
 if(hasTab('mail'))b('secTab','מייל','mail');
 if(hasTab('reps'))b('secTab','דוחות','reps');
 b('hubAsk','מה מצב העסק?');
 return `<div class="secrow" id="secHubQ" role="group" aria-label="פעולות מהירות">${q.join('')}</div>`}
ACT.hubAsk=()=>{ACT.secTab({dataset:{v:'chat'}});setTimeout(()=>{try{window.__secAsk('מה מצב העסק?')}catch(e){}},60)};

/* ---------- ראש המרכז: כותרת, חיבורים, פעולות מהירות ---------- */
function top(){if(!H.at&&!H.b)hubLoad(false);else if(H.at&&Date.now()-H.at>60000&&!H.b)hubLoad(false);
 const at=Math.max(H.at||0,X.ey&&X.ey.now||0);
 return `<div class="card sechub" id="secHub"><div class="eyh"><div><b>גיטי – המנהלת העסקית הדיגיטלית</b><small class="note" style="display:block">${at?'עודכן לאחרונה: '+esc(tmF(at)):'טוען…'}</small></div><span><button class="chip" data-a="hubRe" style="min-height:44px">רענון</button> <button class="chip" data-a="secSet" style="min-height:44px">הגדרות</button></span></div>
 <h3 style="margin:10px 0 2px;font-size:1rem">מצב חיבורים</h3><div id="secHubConn">${connsH()}</div>
 <h3 style="margin:10px 0 6px;font-size:1rem">פעולות מהירות</h3>${quickH()}</div>
 <h3 style="margin:12px 0 4px;font-size:1rem">אישורים וטיפול</h3><div class="secrow" style="margin:0 0 8px"><button class="chip" data-a="secTab" data-v="appr" style="min-height:44px">מרכז אישורים</button><button class="chip" data-a="secTab" data-v="hlog" style="min-height:44px">יומן פעולות מלא</button></div>`}
ACT.hubCx=()=>{try{if(typeof window.cxBotReset==='function')window.cxBotReset();go('cxSync')}catch(e){}};
ACT.hubRe=()=>{H.at=0;hubLoad(true);try{ACT.secEyRe()}catch(e){}};

/* ---------- מרכז אישורים ---------- */
const APK=new Set(['appr','media','draft','inv']);
function apprH(){const R=X.ey;
 if(!R)return '<div class="empty">טוען…</div>';
 if(R.err)return `<div class="card"><p class="note">${esc(R.err)}</p><button class="btn g w" data-a="secEyRe">נסה שוב</button></div>`;
 const O=(R.open||[]).filter(x=>APK.has(x.k)),W=extras().filter(x=>x.ap),M=Core.mergeAttention(O,W);
 const grp=(t,L,f)=>L.length?`<div class="sec"><h3>${t} (${L.length})</h3></div><div class="card">${L.map(f).join('')}</div>`:'';
 const row=window.__secEyRow;
 const h=grp('הצעות ובקשות מהשיחה',O.filter(x=>x.k==='appr'||x.k==='media'),x=>row(x))
  +grp('טיוטות תשובה (ווצאפ ומייל)',O.filter(x=>x.k==='draft'),x=>row(x))
  +grp('חשבוניות שמחכות לאישור',O.filter(x=>x.k==='inv'),x=>row(x))
  +grp('משימות שממתינות לאישור',M.filter(x=>x.ap),x=>`<div class="secli"><button type="button" class="secnb" data-a="hubGo" data-k="tk" data-s="wait"><p><b>${esc(x.title)}</b></p><small class="note">${esc(x.sub||'')}</small></button><div class="secrow"><button class="chip" data-a="tkOk" data-id="${esc(x.tid)}">אשר</button><button class="chip" data-a="hubGo" data-k="tk" data-s="wait">פתיחה</button></div></div>`);
 return `<div class="card"><b>מה ממתין לאישור שלך</b><p class="note" style="margin:4px 0 0">כל כפתור כאן מבצע אותה פעולה כמו במסך המקורי.</p></div>${h||'<div class="empty">אין כרגע משהו שממתין לאישור ✓</div>'}`}

/* ---------- יומן פעולות מלא ---------- */
const PG=50;
const LG=()=>H.lg||(H.lg={L:[],cur:0,more:true,b:0,err:'',q:'',type:'',res:'',from:'',to:'',seen:new Set(),ld:0,key:'',ml:null,mlb:0});
/* "נשלח לבד" (sec_mlog) – 100 האחרונות, דרך השרת. כללים אישיים כבויים / אין הרשאה – אין שורות (ml=[]), עם הערה */
async function mlLoad(){const G=LG();if(G.mlb||G.ml)return;G.mlb=1;
 try{const r=await fnCall('secLearn',{op:'log'});G.ml=Core.mlogRows(r&&r.items);G.mlErr=''}
 catch(e){G.ml=[];G.mlErr=e&&e.reason==='learn-off'?'off':'err'}
 finally{G.mlb=0;re()}}
const dayMs=(s,end)=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s||'');if(!m)return 0;const d=new Date(+m[1],+m[2]-1,+m[3],end?23:0,end?59:0,end?59:0,end?999:0);return d.getTime()};
const actL=a=>{const A=window.__secActs||{};return A[a]||a||'פעולה'};
function norm1(doc){const f=Object.fromEntries(Object.entries(doc.fields||{}).map(([k,v])=>[k,fvj(v)]));f.id=String(doc.name||'').split('/').pop();
 const me=f.tgt&&f.tgt===SY.uid;f.title=actL(f.act)+(f.act==='readChat'?(me?' (השיחה שלך)':' (של מנהל אחר)'):'');f.src='sec_log';return f}
async function lgLoad(more){const G=LG();if(G.b)return;
 const k=(SY&&SY.bizId||'')+'|'+(SY&&SY.uid||'');if(G.key!==k){Object.assign(G,{L:[],cur:0,more:true,err:'',seen:new Set(),key:k})}
 if(!more){Object.assign(G,{L:[],cur:0,more:true,err:'',seen:new Set()})}
 if(!G.more)return;G.b=1;
 try{const from=dayMs(G.from,0),to=dayMs(G.to,1),sq=Core.logQuery({from,to,cursor:G.cur,n:PG});
  const r=await fsx(':runQuery',{method:'POST',body:JSON.stringify({structuredQuery:sq})});
  const docs=(r||[]).filter(x=>x.document).map(x=>x.document);let add=0;
  docs.forEach(d=>{if(G.seen.has(d.name))return;G.seen.add(d.name);G.L.push(norm1(d));add++});
  if(docs.length){const last=docs[docs.length-1].fields&&fvj(docs[docs.length-1].fields.t);if(Number.isFinite(last))G.cur=last}
  G.more=docs.length>=PG&&add>0;G.err=''}
 catch(e){G.err=(e&&e.message)||'היומן לא נטען';G.more=false}
 finally{G.b=0;G.ld=1;re()}}
/* יומן מקומי של "התראות מהטלפון" (מה עשיתי לבד): נשמר במכשיר, בלי טקסט הודעות */
function nfLocal(){try{const o=JSON.parse(localStorage.getItem('lp-ntf-'+(SY&&SY.bizId||'')+'|'+(SY&&SY.uid||'')));const G=o&&Array.isArray(o.G)?o.G:[];
 return G.filter(g=>g&&g.t).map(g=>({id:'nf'+g.t,t:+g.t,act:'nf:'+(g.act||''),title:'התראה מ'+(g.s||'שולח')+(g.a?' ('+g.a+')':'')+' – '+(g.act==='ign'?'סומנה "התעלם"':g.act==='cap'?'ממתינה לאישור (הגעתי לתקרה)':'נפתחה משימה'+(g.un?' ל'+g.un:'')),who:'auto',note:'',src:'nf'}))}catch(e){return []}}
function lgView(){const G=LG(),F={q:G.q,type:G.type,res:G.res,from:dayMs(G.from,0),to:dayMs(G.to,1)};
 const oldest=G.L.length&&G.more?G.L[G.L.length-1].t:0;
 const loc=Core.logFilter(nfLocal().concat(Core.mlDedup(G.L,G.ml)).filter(x=>!oldest||x.t>=oldest),F);
 const srv=Core.logFilter(G.L,F);
 return srv.concat(loc).sort((a,b)=>b.t-a.t)}
function hlogH(){const G=LG();
 if(!G.ld&&!G.b)lgLoad(false);
 if(!G.ml&&!G.mlb)mlLoad();
 const opt=Core.logTypes().map(([k,l])=>`<option value="${k}"${G.type===k?' selected':''}>${esc(l)}</option>`).join('');
 const L=G.ld?lgView():[];
 const fil=`<form class="card" data-f="hubLgF" id="secHubLgF"><b>יומן פעולות</b>
  <label class="f"><span>חיפוש</span><input name="q" value="${esc(G.q)}" maxlength="60" placeholder="מילה מהפעולה או מההערה"></label>
  <div class="row" style="gap:8px"><label class="f grow"><span>סוג</span><select name="type"><option value="">הכול</option>${opt}</select></label><label class="f grow"><span>תוצאה</span><select name="res"><option value="">הכול</option><option value="fail"${G.res==='fail'?' selected':''}>נכשל</option><option value="ok"${G.res==='ok'?' selected':''}>הצליח</option></select></label><label class="f grow"><span>מתאריך</span><input type="date" name="from" value="${esc(G.from)}"></label><label class="f grow"><span>עד תאריך</span><input type="date" name="to" value="${esc(G.to)}"></label></div>
  <div class="secrow"><button class="chip on" style="min-height:44px">סינון</button><button type="button" class="chip" data-a="hubLgClr" style="min-height:44px">נקה</button></div></form>`;
 let list;
 if(!G.ld)list='<div class="empty">טוען…</div>';
 else if(G.err&&!G.L.length)list=`<div class="card"><p class="note">${esc(G.err)}</p><button class="btn g w" data-a="hubLgMore" data-r="1">נסה שוב</button></div>`;
 else list=L.length?`<div class="card" id="secHubLg">${L.map(x=>`<div class="li" role="button" tabindex="0" data-a="hubLgOpen" data-id="${esc(x.id)}" style="cursor:pointer"><div class="m"><b>${esc(x.title)}</b><small>${esc(tmF(x.t))} · ${esc(Core.whoL(x.who))}${x.src==='nf'?' · במכשיר':''}${Core.resOf(x)==='fail'?' · <b style="color:var(--bad)">נכשל</b>':Core.resOf(x)==='ok'?' · הצליח':''}</small></div></div>`).join('')}</div>`:'<div class="empty">לא נמצאו פעולות לפי הסינון</div>';
 const foot=G.ld?`<p class="note" style="margin:6px 0">נטענו ${G.L.length} פעולות מהשרת${(G.q||G.type||G.res)?' · החיפוש, הסוג והתוצאה פועלים על מה שנטען (אפשר לטעון עוד)':''}.</p>${G.more?`<button class="btn g w" data-a="hubLgMore" style="min-height:44px"${G.b?' disabled':''}>${G.b?'טוען…':'טען עוד'}</button>`:'<p class="note">זה כל היומן.</p>'}`:'';
 return fil+list+foot+'<p class="note" style="margin:8px 0 0">'+(G.mlErr==='off'?'"נשלח לבד" לא מוצג: הכללים האישיים כבויים בעסק.':G.mlErr?'"נשלח לבד" לא נטען.':'כולל "נשלח לבד" לפי כללים אישיים (100 האחרונות).')+' תוצאה מוצגת לשליחות, לחשבוניות ולניסיונות חוזרים מ-23.11.2026; ברשומות ישנות היא לא נרשמה.</p>'}
FRM.hubLgF=f=>{const x=fd(f),G=LG();G.q=String(x.q||'').slice(0,60);G.type=x.type||'';G.res=x.res==='ok'||x.res==='fail'?x.res:'';const ch=G.from!==(x.from||'')||G.to!==(x.to||'');G.from=x.from||'';G.to=x.to||'';if(ch)lgLoad(false);else rerender()};
ACT.hubLgClr=()=>{const G=LG(),ch=G.from||G.to;G.q='';G.type='';G.res='';G.from='';G.to='';if(ch)lgLoad(false);else rerender()};
ACT.hubLgMore=el=>{lgLoad(!(el&&el.dataset.r==='1'))};
ACT.hubLgOpen=el=>{const G=LG(),x=G.L.concat(nfLocal(),G.ml||[]).find(z=>z.id===el.dataset.id);if(!x)return;
 const ts=new Date(x.t),full=ts.toLocaleDateString('he-IL',{weekday:'long',day:'numeric',month:'long',year:'numeric'})+' '+ts.toLocaleTimeString('he-IL');
 const res=x.src==='nf'?(x.act==='nf:ign'?'סומנה "התעלם"':x.act==='nf:cap'?'ממתינה לאישורך':'נפתחה משימה'):Core.resL(x)||'נרשמה ביומן (תוצאה לא נרשמה לפעולה הזו)';
 const mine=x.by&&x.by===SY.uid?'אתה':(x.by?'מנהל אחר':'');
 dlg(`<h3>פירוט פעולה</h3><div class="card"><p><b>מה:</b> ${esc(x.title)}</p><p><b>מתי:</b> ${esc(full)}</p><p><b>מקור:</b> ${x.src==='nf'?'התראות מהטלפון (נשמר רק במכשיר הזה)':x.src==='mlog'?'נשלח לבד לפי כלל אישי':esc(Core.whoL(x.who))+(x.ch==='app'?' · מהאפליקציה':x.ch?' · '+esc(x.ch):'')}</p>${mine?`<p><b>מבצע:</b> ${mine}</p>`:''}<p><b>תוצאה:</b> ${Core.resOf(x)==='fail'?'<b style="color:var(--bad)">'+esc(res)+'</b>':esc(res)}</p>${x.note?`<p><b>הערה:</b> ${esc(x.note)}</p>`:''}${x.src==='sec_log'?`<small class="note">קוד פעולה: <bdi dir="ltr">${esc(x.act||'')}</bdi></small>`:''}</div><button class="btn g w" data-a="closeDlg">סגור</button>`)};
ACT.hubLog=()=>{X.set=0;X.edit=0;X.mrv=0;X.tab='hlog';H.lg=null;rerender()};
/* שמות לפעולות שאין להן שם ב-ACTS של secretary.js (שליחה, חשבוניות, כשלים, סיכומים) – רק להצגה */
{const A=window.__secActs;if(A&&typeof A==='object'){const add={send:'נשלחה תשובה בווצאפ',autoSend:'נשלחה הודעה אוטומטית בווצאפ',mailSend:'נשלח מייל',mailAuto:'נשלח מייל לבד לפי תשובה מוכנה',mailMrAuto:'נשלח מייל לבד לפי כלל אישי',
 ordSend:'נשלחה הצעת הזמנה ללקוח',ordCfm:'נשלח אישור הזמנה',mrSend:'נשלח לבד לפי כלל אישי',waMrAuto:'נשלח בווצאפ לבד לפי כלל אישי',ordAuto:'הזמנה נוצרה לבד',invOk:'חשבונית אושרה',invAuto:'חשבונית נקלטה לבד',
 sendFail:'שליחה נכשלה',waFail:'הודעת ווצאפ לא עובדה',waErr:'תקלה בעיבוד הודעת ווצאפ',invErr:'תקלה בקליטת חשבונית',mailErr:'תקלה בקריאת המייל',mailWorkErr:'תקלה בעיבוד מייל',autoFail:'שליחה אוטומטית נכשלה',
 watchFail:'מעקב המייל לא הופעל',gConnectFail:'החיבור ל-Google נכשל',mrFail:'שליחה לבד לפי כלל נכשלה',mrOff:'כלל אישי הפסיק לשלוח לבד אחרי כשלים',outLimit:'שליחה נעצרה – מגבלת הודעות',
 waRequeue:'הודעות ווצאפ חזרו לתור לניסיון נוסף',media:'נשלח קובץ למזכירה',daySum:'נוצר סיכום בוקר / ערב'};
 Object.keys(add).forEach(k=>{if(!A[k])A[k]=add[k]})}}

/* ---------- רישום המסכים ל-secretary.js ---------- */
window.__secHub={top,att:attH,tabs:{appr:{s:'מרכז אישורים',h:apprH},hlog:{s:'יומן פעולות',h:hlogH}}};

/* ---------- אזהרת משימה כפולה (אזהרה בלבד) ---------- */
const TD=()=>window.TaskDup;
const openTasks=()=>((typeof TK!=='undefined'&&TK&&TK.L)||[]).filter(t=>t&&(t.st==='open'||t.st==='wait')&&!t.prv);
function dupFind(txt,uids,dl){try{const D=TD();if(!D||!txt)return [];return D.find({txt,uids:uids||[],dl:dl||0},openTasks())}catch(e){return []}}
const whoT=t=>{const n=Array.isArray(t.toN)&&t.toN.length?t.toN.join(', '):t.owN||'';return n||'כל הצוות'};
function dupDlg(txt,M,go){H.dupGo=go;
 const rows=M.map(m=>{const t=m.task;let dl='';try{dl=window.TKW&&TKW.dlTx?TKW.dlTx(t):''}catch(e){}
  return `<div class="card" style="margin:6px 0"><b>${esc(clip(t.txt,140))}</b><small class="note" style="display:block">${esc(whoT(t))}${dl?' · יעד: '+esc(dl):''}${t.st==='wait'?' · ממתינה לאישור':''} · ${esc(m.why.join(', '))}</small><div class="secrow"><button type="button" class="chip" data-a="hubDupOpen" data-id="${esc(t.id)}" data-s="${t.st==='wait'?'wait':'open'}" style="min-height:44px">פתח את הקיימת</button></div></div>`}).join('');
 dlg(`<h3>נראה שיש כבר משימה כזו</h3><p class="note">"${esc(clip(txt,140))}"</p>${rows}<div class="row"><button type="button" class="btn grow" data-a="hubDupGo">צור בכל זאת</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div>`)}
ACT.hubDupGo=()=>{const g=H.dupGo;H.dupGo=null;closeDlg();if(typeof g==='function')g()};
ACT.hubDupOpen=el=>{H.dupGo=null;closeDlg();try{TKT=el.dataset.s==='wait'?'wait':'open';go('tk')}catch(e){}};
/* טופס המשימות (FRM.tkAdd): בודקים לפני שליחה; "צור בכל זאת" שולח את אותו טופס */
{const o=FRM.tkAdd;if(typeof o==='function'){let skip=0;
 FRM.tkAdd=function(f){
  if(skip){skip=0;return o.call(this,f)}
  try{const x=fd(f),txt=String(x.txt||'').trim();
   if(txt&&!x.prv){let uids=[],dl=0;
    try{if(typeof tkSelInit==='function'&&typeof fbAdmin==='function'&&fbAdmin()&&typeof TKST!=='undefined'&&TKST.L&&TKST.L.length)uids=[...tkSelInit()]}catch(e){}
    try{const FX=window.TKW&&TKW.fx?TKW.fx():null;if(FX&&!FX.err&&FX.f){const fl=FX.f(Date.now());dl=fl&&fl.dl&&+fl.dl.integerValue||0}}catch(e){}
    const M=dupFind(txt,uids,dl);
    if(M.length){const self=this;dupDlg(txt,M,()=>{skip=1;let g=f;if(!g||!g.isConnected)g=document.querySelector('form[data-f=tkAdd]');if(!g){toast('הטופס נסגר. פתח את המשימה מחדש');return}return o.call(self,g)});return}}}
  catch(e){}
  return o.call(this,f)}}}
/* כרטיס "פתח משימה" בצ'אט (פקודת new) */
{const o=ACT.secCxOk;if(typeof o==='function'){const bypass=new Set();
 ACT.secCxOk=function(el){const id=el&&el.dataset&&el.dataset.id;
  if(id&&!bypass.has(id)){try{const all=(X.msgs||[]).concat(X.pc&&X.pc.L||[]).flatMap(m=>m.cards||[]),c=all.find(z=>z&&z.loc&&z.id===id&&z.k==='new');
   if(c&&!c.st&&!c.busy){let dl=0;try{if(c.due&&typeof tkIL!=='undefined'&&tkIL&&tkIL.at)dl=tkIL.at(c.due.y,c.due.m,c.due.d,c.due.h,c.due.n)}catch(e){}
    const uids=c.all?[]:(c.to||[]).map(z=>z.uid),M=dupFind(c.txt,uids,dl),self=this;
    if(M.length){dupDlg(c.txt,M,()=>{bypass.add(id);try{o.call(self,el)}finally{setTimeout(()=>bypass.delete(id),0)}});return}}}catch(e){}}
  return o.apply(this,arguments)}}}
/* משימה מתמונה (secTkOk) */
{const o=ACT.secTkOk;if(typeof o==='function'){const bypass=new Set();
 ACT.secTkOk=function(el){const id=el&&el.dataset&&el.dataset.id;
  if(id&&!bypass.has(id)){try{const all=(X.msgs||[]).concat(X.pc&&X.pc.L||[]).flatMap(m=>m.cards||[]);let c=all.find(z=>z&&z.id===id&&z.k==='task');
   if(!c){const a=((X.ey&&X.ey.open)||[]).map(x=>x.act).find(a=>a&&a.id===id&&a.k==='task');if(a)c={txt:a.txt}}
   if(c&&!c.st&&c.txt){const M=dupFind(String(c.txt),[],0),self=this;
    if(M.length){dupDlg(String(c.txt),M,()=>{bypass.add(id);try{o.call(self,el)}finally{setTimeout(()=>bypass.delete(id),0)}});return}}}catch(e){}}
  return o.apply(this,arguments)}}}
})(typeof window!=='undefined'?window:this);
