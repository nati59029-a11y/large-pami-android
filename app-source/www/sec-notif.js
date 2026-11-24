/* המזכירה – "התראות מהטלפון" (22.11.2026, החלטת בעל הפרויקט). בלי שינוי שרת ובלי שינוי חוקים: הכול נשמר רק במכשיר.
   התוסף LpNotif (android-plugin/LpNotifListen.java + LpNotifPlugin.java) קולט התראות רק מהאפליקציות שהמנהל בחר, ומדלג על שולחים ברשימת ההחרגה.
   כאן: לשונית "התראות מהטלפון" במסך המזכירה (רק למנהל, רק באפליקציה), "מה לעשות?" לכל התראה, למידה מהבחירות והצעת כלל אחרי פעמיים,
   וביצוע לבד של כלל שאושר במפורש (פתיחת משימה לעובד שנלמד – אותו קוד כמו אישור כרטיס משימה במזכירה, מזהה קבוע מהמפתח של ההתראה; או "התעלם").
   פרטיות: תוכן ההתראה (שולח וטקסט) נשמר רק בתור של התוסף (SharedPreferences "lp_notif_in", מוחרג מגיבוי אנדרואיד) ובזיכרון של הדף – לא ב-localStorage (שנכלל בגיבוי).
   הוא יוצא מהמכשיר רק כשפותחים ממנו משימה (ידנית או בכלל אוטומטי – "<שולח>: <טקסט>" נכנס למשימה) או בלחיצה על "שאלי את המזכירה". לא נכתב ליומן (console).
   ביציאה מהחשבון (tasks-wc.js W.out ← __secNfOut): הקליטה כבה, התור נמחק, ומפתחות lp-ntf-* של המשתמש נמחקים.
   החלק הראשון (Core) – לוגיקה טהורה בלי DOM, נבדקת ב-node (firebase/tests/sec-notif.unit.test.js). השאר – המסך.
   נשמר ב-localStorage (בלי טקסט הודעה): lp-ntf-m-<uid> מצב לכל התראה לפי המפתח שלה בלבד (טופל/התעלם/משימה…),
   lp-ntf-<עסק>|<uid> בחירות, כללים, יומן "מה עשיתי לבד" (50), מוני התקרה היומית ועצירת הביצוע האוטומטי. lp-ntf-in-<uid> (גרסה קודמת, עם טקסט) נמחק בכניסה. */
(function(root){
'use strict';
/* ===================== Core (טהור) ===================== */
const MAXI=300,LOGN=50,AUTO_RUN=10,AUTO_DAY=30,MAXM=600;
/* שולח להשוואה: אותיות קטנות, בלי "(3 הודעות)" בסוף, רווחים אחידים – אותו כלל כמו senderKey ב-LpNotifListen.java */
const senderKey=s=>String(s==null?'':s).replace(/\s*\(\d+[^)]*\)\s*$/,'').replace(/\s+/g,' ').trim().toLowerCase();
/* 24.11.2026 (גיטי, סבב 4 חלק א): קודי אימות / סיסמאות (OTP) – לא נשמרים, לא מוצגים ולא נשלחים ל-AI. אותו כלל כמו isOtp ב-firebase/functions/lib/sec-perm.js וב-LpNotifListen.java */
const OTP_KW=/(קוד\s*(ה)?(אימות|זיהוי|כניסה|חד[\s-]?פעמי|סודי|גישה)|סיסמ[אה]\s*(חד[\s-]?פעמית|זמנית)?|סיסמתך|קוד\s*ה?OTP|\bOTP\b|verification\s*code|security\s*code|one[\s-]?time\s*(pass(word|code)?|code|pin)|\bpasscode\b|\bpassword\b|login\s*code|auth(entication)?\s*code|\b2FA\b|confirmation\s*code|your\s*code\s*is|is\s+your\s+(\w+\s+)?code|\bcode\s*[:：]|הקוד\s*(שלך|שלכם|הוא)|קוד\s*[:：]|\bPIN\b|\bG-\d{6}\b)/i,OTP_NUM=/(^|[^\d])\d{4,8}([^\d]|$)|\b[A-Z0-9]{3,4}-[A-Z0-9]{3,4}\b/;
const isOtp=(x,s)=>{const t=String(s||'')+' '+String(x||'');return OTP_KW.test(t)&&(OTP_NUM.test(t)||/סיסמ|password|passcode/i.test(t))};
const isSkipped=(skip,s)=>{const k=senderKey(s);return !!k&&(Array.isArray(skip)?skip:[]).some(x=>senderKey(x)===k)};
const STOP=new Set(['של','את','על','עם','זה','זו','זאת','אני','אתה','את','הוא','היא','אנחנו','הם','יש','אין','לא','כן','מה','מי','איך','למה','מתי','איפה','גם','רק','כבר','עוד','אבל','או','אם','כי','שלום','היי','בוקר','טוב','ערב','תודה','בבקשה','אפשר','צריך','רוצה','לך','לי','לו','לה','לנו','שלי','שלך','הזה','הזאת','היום','מחר','עכשיו','the','and','for','you','hi','ok']);
/* מילת המפתח העיקרית (אופציונלית): המילה הראשונה בת 3 אותיות לפחות שאינה מילת קישור */
function kwOf(t){const w=String(t||'').toLowerCase().replace(/[^א-תa-z0-9\s]/g,' ').split(/\s+/).filter(Boolean);for(const x of w){const y=x.replace(/^[ו]/,'');if(y.length>=3&&!STOP.has(x)&&!STOP.has(y)&&!/^\d+$/.test(y))return y.slice(0,30)}return ''}
/* מיזוג התראות חדשות מהתוסף לרשימה: מפתח שכבר קיים לא נכנס שוב; שולח מוחרג לא נכנס; עד max (קודם נמחקות הישנות שטופלו) */
function merge(list,items,skip,max){const L=Array.isArray(list)?list.slice():[],seen=new Set(L.map(x=>x.k)),added=[];max=max||MAXI;
 (Array.isArray(items)?items:[]).forEach(o=>{if(!o||typeof o.k!=='string'||!o.k||seen.has(o.k))return;if(isSkipped(skip,o.s)||isOtp(o.x,o.s))return;seen.add(o.k);
  const it={k:o.k.slice(0,200),p:String(o.p||'').slice(0,150),a:String(o.a||o.p||'').slice(0,80),s:String(o.s||'').slice(0,200),x:String(o.x||'').slice(0,1000),t:+o.t||0,st:'new'};L.push(it);added.push(it)});
 L.sort((a,b)=>a.t-b.t);while(L.length>max){const i=L.findIndex(x=>x.st!=='new');L.splice(i>=0?i:0,1)}
 return {list:L,added:added.filter(x=>L.includes(x))}}
const AUTO=new Set(['task','ign']);
const ruleKey=it=>String(it.p||'')+'|'+senderKey(it.s);
/* בחירה: (אפליקציה, שולח, פעולה, עובד) ← מספר הפעמים. to = {uid, un} למשימה (uid '*' = כל העובדים) */
function record(Lr,it,act,to,now){const rk=ruleKey(it),uid=to&&to.uid||'',k=rk+'|'+act+'|'+uid;Lr=Lr||{};
 const e=Lr[k]||(Lr[k]={rk,p:it.p,a:it.a,s:it.s,act,uid,un:'',n:0,t:0});e.n++;e.t=now||Date.now();e.s=it.s;e.a=it.a;if(to&&to.un)e.un=to.un;delete e.kw;return e}
/* הצעות "ללמוד?": לכל שולח – הבחירה האחרונה שלו, אם נבחרה פעמיים לפחות, היא פעולה שמותר לבצע לבד (משימה לעובד / התעלם), ואין עדיין החלטה (כלל או "תמיד לשאול") */
function suggest(Lr,R){const best={};Object.keys(Lr||{}).forEach(k=>{const e=Lr[k];if(!e)return;const b=best[e.rk];if(!b||e.t>b.t)best[e.rk]=e});
 return Object.values(best).filter(e=>e.n>=2&&AUTO.has(e.act)&&(e.act!=='task'||!!e.uid)&&!(R&&R[e.rk])).sort((a,b)=>b.t-a.t)}
const ruleFor=(R,it)=>{const r=R&&R[ruleKey(it)];return r&&r.on===true&&AUTO.has(r.act)?r:null};
function setRule(R,e,on,now){R[e.rk]={p:e.p,a:e.a,s:e.s,act:e.act,uid:e.uid||'',un:e.un||'',on:!!on,t:now||Date.now()};return R[e.rk]}
/* מחיקת כלל – גם הספירה של אותו שולח מתאפסת (אחרת ההצעה הייתה חוזרת מיד) */
function delRule(R,Lr,rk){delete R[rk];Object.keys(Lr||{}).forEach(k=>{if(Lr[k]&&Lr[k].rk===rk)delete Lr[k]})}
/* מזהה קבוע מהמפתח של ההתראה (משימה ממנה = 'sec'+id): פתיחה חוזרת, ידנית או אוטומטית, מזוהה בשרת (409) ולא יוצרת כפילות */
function tidOf(k){let a=0x811c9dc5,b=0x01000193^0x5bd1e995;const s=String(k||'');for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);a=Math.imul(a^c,16777619)>>>0;b=Math.imul(b^c,2246822519)>>>0;b=(b^(b>>>13))>>>0}
 return 'n'+a.toString(16).padStart(8,'0')+b.toString(16).padStart(8,'0')}
const logAdd=(G,e)=>{G=Array.isArray(G)?G:[];G.unshift(e);return G.slice(0,LOGN)};
/* מצב לכל התראה – לפי המפתח בלבד (המפתח מהתוסף: אפליקציה|hash|זמן, בלי טקסט). שדות מותרים בלבד, בלי שולח ובלי טקסט */
const STF=['st','by','tk','at','cap'];
function stPut(M,k,o,now){if(!M||typeof k!=='string'||!k)return null;const e=Object.assign({},M[k]||{});STF.forEach(f=>{if(o&&o[f]!==undefined)e[f]=String(o[f]).slice(0,80)});e.at=+(o&&o.at)||now||Date.now();M[k]=e;return e}
const applySt=(list,M)=>(Array.isArray(list)?list:[]).map(x=>{const e=M&&M[x.k]||{};return Object.assign({},x,{st:'new'},e,{at:+e.at||0})});
/* מחיקת מצב של התראות שכבר לא בתור (keys = המפתחות שבתור), ועד MAXM – קודם הישנים. מחזיר true אם משהו נמחק */
function stTrim(M,keys,max){let ch=false;max=max||MAXM;if(keys)Object.keys(M).forEach(k=>{if(!keys.has(k)){delete M[k];ch=true}});
 const ks=Object.keys(M);if(ks.length>max){ks.sort((a,b)=>(+M[a].at||0)-(+M[b].at||0)).slice(0,ks.length-max).forEach(k=>delete M[k]);ch=true}return ch}
/* תקרה לביצוע אוטומטי של משימות: עד AUTO_RUN בכל עיבוד (used = כמה כבר בוצעו בעיבוד הזה), ועד AUTO_DAY ביום לכל כלל.
   C = {d:<יום>, n:{<מפתח כלל>: מספר}} – מתאפס ביום חדש. why: 'run' (תקרת עיבוד) / 'day' (תקרה יומית של הכלל) */
function capTake(C,rk,day,used){if(!C||typeof C!=='object'||C.d!==day)C={d:day,n:{}};if(!C.n||typeof C.n!=='object')C.n={};
 if((used|0)>=AUTO_RUN)return{ok:false,C,why:'run'};if((+C.n[rk]||0)>=AUTO_DAY)return{ok:false,C,why:'day'};C.n[rk]=(+C.n[rk]||0)+1;return{ok:true,C}}
/* 24.11.2026 (סבב 4 חלק א): הרשאת "פעולה על הודעה מאפליקציה / SMS" של המנהל (X.st.perm.m.app) ו"עצור הכל" (X.st.stop).
   מחזיר 'auto' (מותר לבצע כלל לבד) / 'approve' / 'deny' / 'ask' (טרם הוגדר – לשאול את המנהל, ובינתיים לא לבד). בלי מידע מהשרת – לא לבד.
   act – הפעולה שהכלל מבצע (תיקון סבב 1, ליקוי 2): 'task' – גם "יצירת משימה" לא מוגדרת "אסור" (task:deny → deny, גם כשההתראות "לבד") */
function appPerm(st,act){const p=st&&st.perm;if(!p||!p.m||typeof p.m!=='object')return 'approve';
 if(act==='task'&&p.m.task&&p.m.task.m==='deny')return 'deny';
 const e=p.m.app;if(!e)return 'ask';if(e.m==='deny')return 'deny';if(e.m!=='auto')return 'approve';return st.stop===true?'approve':'auto'}
const Core={MAXI,LOGN,AUTO_RUN,AUTO_DAY,MAXM,isOtp,appPerm,senderKey,isSkipped,kwOf,merge,record,suggest,ruleFor,ruleKey,setRule,delRule,tidOf,logAdd,stPut,applySt,stTrim,capTake};
if(typeof module==='object'&&module&&module.exports){module.exports=Core;return}
root.SecNotifCore=Core;

/* ===================== המסך ===================== */
if(typeof ACT==='undefined'||typeof V==='undefined'||typeof FRM==='undefined')return;
const TABS=window.__secTabs;if(!Array.isArray(TABS))return;
const TK='notif',TL='התראות מהטלפון';
if(!TABS.some(x=>x[0]===TK))TABS.push([TK,TL]);
/* ברירת מחדל: ווצאפ, ווצאפ עסקי, ואפליקציות ה-SMS הנפוצות (מסומנות רק אם מותקנות) */
const DEF=['com.whatsapp','com.whatsapp.w4b','com.google.android.apps.messaging','com.samsung.android.messaging','com.android.mms','com.android.messaging'];
const SUG=DEF.concat(['com.google.android.gm','org.telegram.messenger','com.microsoft.office.outlook','com.facebook.orca','com.instagram.android']);
const DEFN={'com.whatsapp':'WhatsApp','com.whatsapp.w4b':'WhatsApp Business','com.google.android.apps.messaging':'הודעות (Google)','com.samsung.android.messaging':'הודעות (Samsung)','com.android.mms':'הודעות','com.android.messaging':'הודעות'};
const N={cfg:null,en:null,apps:null,v:'list',cards:{},busy:0,tk:0,lis:0,remK:'',ld:0,wr:0,lastN:-1,q:null,qU:'',lg:''};
const cap=()=>window.Capacitor||null;
const fnCallSec=(n,d)=>{d=d&&typeof d==='object'?d:{};if(SY&&SY.sa&&SY.bizId&&!('bizId'in d))d=Object.assign({bizId:SY.bizId},d);return window.fnCall(n,d)};
const native=()=>{try{const C=cap();return !!(C&&C.isNativePlatform&&C.isNativePlatform())}catch(e){return false}};
const plug=()=>{const C=cap();return native()&&C.Plugins&&C.Plugins.LpNotif||null};
const adm=()=>{try{return typeof isA==='function'&&isA()}catch(e){return false}};
const uid=()=>SY&&SY.uid||'';
const rd=(k,d)=>{try{const v=JSON.parse(localStorage.getItem(k));return v==null?d:v}catch(e){return d}};
const wr=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));return true}catch(e){return false}};
const kM=()=>'lp-ntf-m-'+uid(),kSt=()=>'lp-ntf-'+(SY&&SY.bizId||'')+'|'+uid();
/* ההתראות עצמן: רק בזיכרון (N.q), נטענות מהתור של התוסף בכל כניסה. המצב (טופל/התעלם…) – לפי מפתח בלבד */
const stM=()=>{const o=rd(kM(),{});return o&&typeof o==='object'&&!Array.isArray(o)?o:{}};
const stMW=o=>wr(kM(),o);
const inbox=()=>N.q&&N.qU&&N.qU===uid()?applySt(N.q,stM()):[];
/* גרסה קודמת שמרה את ההתראות (שולח וטקסט) ב-lp-ntf-in-<uid>: מעבירים רק את ההחלטות (לפי מפתח) ומוחקים את המפתח */
function legacy(){const u=uid();if(!u||N.lg===u)return;N.lg=u;const k='lp-ntf-in-'+u,a=rd(k,null);
 try{if(Array.isArray(a)){const M=stM();a.forEach(x=>{if(x&&typeof x.k==='string'&&x.st&&x.st!=='new'&&!M[x.k])stPut(M,x.k,{st:x.st,by:x.by,tk:x.tk,at:x.at},Date.now())});stMW(M)}}catch(e){}
 try{localStorage.removeItem(k)}catch(e){}}
/* מחיקת כל המידע המקומי של משתמש (יציאה מהחשבון / העברת הקליטה לחשבון אחר): ההחלטות, הכללים והיומן בכל העסקים, והעותק הישן עם הטקסט */
function wipe(u){if(!u)return;try{const del=[];for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k&&(k==='lp-ntf-in-'+u||k==='lp-ntf-m-'+u||(k.startsWith('lp-ntf-')&&k.endsWith('|'+u))))del.push(k)}del.forEach(k=>localStorage.removeItem(k))}catch(e){}
 if(N.qU===u){N.q=null;N.qU=''}if(N.lg===u)N.lg=''}
const st=()=>{const o=rd(kSt(),{});return{L:o&&typeof o.L==='object'&&o.L?o.L:{},R:o&&typeof o.R==='object'&&o.R?o.R:{},G:Array.isArray(o&&o.G)?o.G:[],off:!!(o&&o.off),C:o&&o.C&&typeof o.C==='object'?o.C:null}};
const stW=o=>wr(kSt(),o);
const newN=()=>{try{return uid()?inbox().filter(x=>x.st==='new').length:0}catch(e){return 0}};
const typing=()=>{const a=document.activeElement;return !!(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)&&a.closest('#main'))};
const onTab=()=>{try{return cur().v==='sec'&&window.__sec&&window.__sec.tab===TK}catch(e){return false}};
const re=force=>{try{if(cur().v==='sec'&&(force||!typing()))rerender()}catch(e){}};
const cx=()=>window.__secCx||null;
const cxOk=()=>{const c=cx();try{return !!(c&&c.on())}catch(e){return false}};
const when=t=>{if(!t)return '';try{const d=new Date(t),n=new Date(),o={timeZone:'Asia/Jerusalem',hour:'2-digit',minute:'2-digit',hour12:false},hm=d.toLocaleTimeString('he-IL',o);
 const dk=x=>x.toLocaleDateString('en-CA',{timeZone:'Asia/Jerusalem'});return dk(d)===dk(n)?'היום '+hm:d.toLocaleDateString('he-IL',{timeZone:'Asia/Jerusalem',day:'numeric',month:'numeric'})+' '+hm}catch(e){return ''}};
const actL=(e,full)=>e.act==='ign'?'לסמן "התעלם"':'לפתוח משימה ל'+(e.uid==='*'?'כל העובדים':(e.un||'העובד'))+(full?' (יעד: 3 ימי עסקים)':'');
const STL={task:'נפתחה משימה',rem:'נקבעה תזכורת',ask:'נשאלה המזכירה',done:'טופל',ign:'התעלמות',blk:'השולח הוחרג'};

/* ---------- מצב התוסף ---------- */
async function loadCfg(){const P=plug();if(!P)return;N.ld=1;
 try{const c=await P.getConfig();N.cfg={on:!!(c&&c.on),all:!!(c&&c.all),pkgs:Array.isArray(c&&c.pkgs)?c.pkgs:[],skip:Array.isArray(c&&c.skip)?c.skip:[],u:String(c&&c.u||'')}}catch(e){N.cfg={on:false,all:false,pkgs:[],skip:[],u:''}}
 try{N.en=!!(await P.isEnabled()).on}catch(e){N.en=false}
 N.ld=2}
async function loadApps(){const P=plug();if(!P||N.apps)return;try{const r=await P.getApps();N.apps=Array.isArray(r&&r.apps)?r.apps.filter(a=>a&&a.p):[]}catch(e){N.apps=[]}if(onTab())re()}
const mine=()=>!!(N.cfg&&N.cfg.on&&N.cfg.u===uid());
async function saveCfg(o){const P=plug();if(!P)throw new Error('no plugin');const c=Object.assign({},N.cfg||{},o,{u:uid()});await P.setConfig({on:!!c.on,all:!!c.all,pkgs:c.pkgs||[],skip:c.skip||[],u:c.u});N.cfg=c}

/* ---------- קליטה: משיכה מהתוסף, מיזוג, וביצוע כללים שאושרו ---------- */
async function tick(){const P=plug();if(!P||!adm()||!uid()||N.tk)return;N.tk=1;
 try{if(!N.lis&&typeof P.addListener==='function'){N.lis=1;try{await P.addListener('notif',()=>{setTimeout(tick,300)})}catch(e){}}
  if(!N.cfg||N.ld!==2)await loadCfg();if(!mine())return;legacy();
  /* קודם החדשות (שעוד לא נלקחו) – רק עליהן רצים הכללים; בכניסה הראשונה גם כל התור (pull all), כי ההתראות לא נשמרות בדף */
  const r=await P.pull({});const fresh=Array.isArray(r&&r.items)?r.items:[];if(r&&typeof r.on==='boolean')N.en=r.on;let added;
  if(!N.q||N.qU!==uid()){const a=await P.pull({all:true});const all=Array.isArray(a&&a.items)?a.items:[],fk=new Set(fresh.map(o=>o&&o.k));
   const m=merge([],all.concat(fresh),N.cfg.skip);N.q=m.list;N.qU=uid();added=m.added.filter(x=>fk.has(x.k));
   if(all.length){const M=stM();if(stTrim(M,new Set(all.map(o=>o&&o.k))))stMW(M)}}
  else{if(!fresh.length)return;const m=merge(N.q,fresh,N.cfg.skip);N.q=m.list;added=m.added}
  const M=stM();added=added.filter(x=>!M[x.k]);
  if(added.length)await autoRun(added)}
 catch(e){/* בשקט – ננסה שוב בפעם הבאה */}
 finally{N.tk=0;const n=newN();if(onTab())re();else if(n!==N.lastN)re();N.lastN=n}}
/* תקרה: עד AUTO_RUN משימות בכל עיבוד ועד AUTO_DAY ביום לכל כלל. מעבר לתקרה – ההתראה נשארת "ממתינה להחלטה" (cap), ושורה אחת ביומן לכל כלל */
const CAPM={day:'הגעתי לתקרה היומית של הכלל – ממתין לאישורך',run:'הגעתי לתקרה של '+AUTO_RUN+' משימות אוטומטיות בבת אחת – ממתין לאישורך'};
const dayK=t=>{try{return new Date(t).toLocaleDateString('en-CA',{timeZone:'Asia/Jerusalem'})}catch(e){return new Date(t).toISOString().slice(0,10)}};
async function autoRun(added){const S=st();if(S.off)return;
 /* 24.11.2026 (סבב 4 חלק א): כלל "לבד" רץ רק אם מסך ההרשאות של המנהל מתיר "פעולה על הודעה מאפליקציה / SMS" ו"עצור הכל" כבוי. אחרת ההתראה נשארת "מה לעשות?" */
 const pm=appPerm(window.__sec&&window.__sec.st);
 if(pm!=='auto'){if(pm==='ask'&&!N.pa&&added.some(it=>ruleFor(S.R,it))){N.pa=1;try{fnCallSec('secPrefs',{op:'permAsk',type:'app'}).catch(()=>{N.pa=0})}catch(e){N.pa=0}}return}
 let ch=0,used=0;const day=dayK(Date.now()),capd={};
 for(const it of added){const r=ruleFor(S.R,it);if(!r)continue;
  if(r.act==='ign'){setSt(it.k,{st:'ign',by:'auto'});S.G=logAdd(S.G,{t:Date.now(),k:it.k,s:it.s,a:it.a,act:'ign',ok:1});ch=1;continue}
  if(r.act==='task'&&appPerm(window.__sec&&window.__sec.st,'task')==='deny'){S.G=logAdd(S.G,{t:Date.now(),k:it.k,s:it.s,a:it.a,act:'task',un:r.un||'',ok:0,why:'לפי מסך ההרשאות שלך "יצירת משימה" אסורה'});ch=1;continue}
  if(r.act==='task'){const cp=capTake(S.C,ruleKey(it),day,used);S.C=cp.C;ch=1;
   if(!cp.ok){setSt(it.k,{cap:cp.why});const ck=ruleKey(it)+'|'+cp.why,g=capd[ck]||(capd[ck]={t:Date.now(),k:it.k,s:it.s,a:it.a,act:'cap',why:cp.why,n:0});g.n++;continue}
   used++;let res;try{res=await autoTask(it,r)}catch(e){res={ok:0,why:e&&e.cx||'פתיחת המשימה נכשלה'}}
   if(res.ok)setSt(it.k,{st:'task',by:'auto',tk:res.tk});
   S.G=logAdd(S.G,{t:Date.now(),k:it.k,s:it.s,a:it.a,act:'task',un:r.un||'',ok:res.ok?1:0,tk:res.tk||'',dup:res.dup?1:0,why:res.why||''});ch=1}}
 Object.values(capd).forEach(g=>{S.G=logAdd(S.G,g)});
 if(ch)stW(S)}
async function autoTask(it,r){const c=cx();if(!cxOk())return{ok:0,why:'המשימות לא זמינות כאן'};
 const S=await c.staff();let to=[];if(r.uid!=='*'){for(const u of String(r.uid).split(',')){const z=S.find(x=>x.uid===u);if(!z)return{ok:0,why:'העובד לא נמצא ברשימת העובדים הפעילים'};to.push({uid:z.uid,name:z.name})}}
 const card={id:tidOf(it.k),txt:taskTxt(it),all:r.uid==='*',to,due:null,pri:'',rv:false};
 const x=await c.create(card);return{ok:1,tk:'sec'+card.id,dup:!!x.dup}}
const taskTxt=it=>((it.s?it.s+': ':'')+it.x).trim().slice(0,500);
function setSt(k,o){const it=itemOf(k);if(!it)return null;const M=stM(),e=stPut(M,k,o,Date.now());stMW(M);return Object.assign(it,e)}
const itemOf=k=>inbox().find(x=>x.k===k)||null;

/* ---------- למידה ---------- */
function learn(it,act,to){try{const S=st();record(S.L,it,act,to,Date.now());stW(S)}catch(e){}}

/* ---------- HTML ---------- */
const B=(a,l,x,cls)=>`<button class="chip${cls||''}" style="min-height:44px" data-a="${a}"${x||''}>${l}</button>`;
function notifH(){
 if(!native())return `<div class="card"><b>${TL}</b><p class="note" style="margin:6px 0 0">זמין רק באפליקציה בטלפון (אנדרואיד). כאן אפשר לבחור אפליקציות כמו ווצאפ, SMS ו-Gmail, והמזכירה תשאל מה לעשות עם כל הודעה שמגיעה.</p></div>`;
 if(!adm())return `<div class="card"><p class="note" style="margin:0">המסך הזה זמין רק למנהל העסק.</p></div>`;
 if(!plug())return `<div class="card"><b>${TL}</b><p class="note" style="margin:6px 0 0">כדי להשתמש באפשרות הזו צריך לעדכן את האפליקציה לגרסה החדשה.</p></div>`;
 if(N.ld!==2){if(!N.ld)loadCfg().then(()=>{if(onTab())re()});return '<p class="note">טוען…</p>'}
 const c=N.cfg;
 if(c.on&&c.u&&c.u!==uid())return `<div class="card"><b>${TL}</b><p class="note" style="margin:6px 0">קליטת ההתראות בטלפון הזה הופעלה בחשבון אחר. אפשר להפעיל אותה לחשבון שלך – ההתראות שנקלטו עד עכשיו יימחקו מהטלפון.</p><div class="secrow">${B('secNfTake','הפעל לחשבון שלי')}</div></div>`;
 if(!c.on||N.v==='set')return setH();
 const nav=`<div class="secrow" role="group" aria-label="תצוגה">${B('secNfV',`רשימה${newN()?' ('+newN()+')':''}`,' data-v="list"',N.v==='list'?' on':'')}${B('secNfV','הכללים שנלמדו',' data-v="rules"',N.v==='rules'?' on':'')}${B('secNfV','הגדרות',' data-v="set"')}</div>`;
 const warn=N.en?'':`<div class="card" style="border-color:var(--bad)"><b>אין גישה להתראות</b><p class="note" style="margin:4px 0">בלי הגישה הזו לא נקלטות התראות חדשות. בהגדרות של אנדרואיד מסמנים את האפליקציה ברשימה "גישה להתראות".</p><div class="secrow">${B('secNfOpen','תן גישה להתראות')}${B('secNfRe','בדוק שוב')}</div></div>`;
 return nav+warn+(N.v==='rules'?rulesH():listH())}
function setH(){const c=N.cfg,P=new Set(c.pkgs&&c.pkgs.length?c.pkgs:[]),A=N.apps;if(!A)loadApps();
 const inst=A?new Set(A.map(a=>a.p)):null,first=!c.pkgs||!c.pkgs.length;
 const nm=p=>(A&&(A.find(a=>a.p===p)||{}).l)||DEFN[p]||p;
 const chk=p=>first?DEF.includes(p)&&(!inst||inst.has(p)):P.has(p);
 const box=p=>`<label class="chip" style="min-height:44px;justify-content:flex-start;gap:8px"><input type="checkbox" name="p" value="${esc(p)}"${chk(p)?' checked':''}> ${esc(nm(p))}</label>`;
 const top=SUG.filter(p=>(inst?inst.has(p):DEF.includes(p))||P.has(p));
 const rest=A?A.map(a=>a.p).filter(p=>!top.includes(p)):[];
 return `<div class="card"><b>${TL}</b>
 <p class="note" style="margin:6px 0">המזכירה תראה את ההתראות שמגיעות לטלפון <b>רק מהאפליקציות שתבחרו כאן</b> (או מכולן, אם תסמנו "כל האפליקציות וה-SMS"), ותשאל מה לעשות עם כל אחת. ביצוע לבד של כלל – רק אם במסך ההרשאות "פעולה על הודעה מאפליקציה / SMS" מוגדרת "לבד".</p>
 <ul class="note" style="margin:0 0 8px;padding-inline-start:18px"><li>נקלט רק מה שמופיע בהתראה עצמה (שם השולח והטקסט) – לא כל השיחה.</li><li>קודי אימות וסיסמאות (OTP) לא נקלטים ולא נשלחים לבינה המלאכותית.</li><li>ההתראות נשמרות רק בטלפון. כשפותחים מהן משימה (ידנית או בכלל אוטומטי), השולח וטקסט ההודעה נכנסים למשימה ונראים לעובד שמקבל אותה. 'שאלי את המזכירה' שולח את הטקסט לבינה המלאכותית.</li><li>אפשר לכבות בכל רגע.</li></ul>
 <p style="margin:6px 0"><b>גישה להתראות:</b> ${N.en?'✓ ניתנה':'עוד לא ניתנה'}</p>
 <div class="secrow">${N.en?'':B('secNfOpen','תן גישה להתראות')}${B('secNfRe','בדוק שוב')}</div>
 ${N.en?'':'<p class="note" style="margin:4px 0">בחלון שייפתח: מוצאים את האפליקציה ברשימה "גישה להתראות" ומפעילים. אחר כך חוזרים לכאן.</p><p class="note" style="margin:4px 0">אם אנדרואיד כותב "הגדרה מוגבלת": בהגדרות הטלפון ← אפליקציות ← האפליקציה הזו ← ⋮ (שלוש נקודות למעלה) ← "התרת הגדרות מוגבלות", ואז שוב "תן גישה להתראות".</p>'}</div>
 <form class="card" data-f="secNfSave"><b>מאילו אפליקציות לקלוט?</b>
 <label class="chip" style="min-height:44px;justify-content:flex-start;gap:8px;margin-top:8px"><input type="checkbox" name="all" value="1"${c.all?' checked':''}> <span><b>כל האפליקציות וה-SMS</b><br><small class="note">כל התראה שמגיעה לטלפון (חוץ מהתראות קבועות ושל האפליקציה הזו). קודי אימות וסיסמאות לא נקלטים לעולם.</small></span></label>
 <div style="display:grid;gap:6px;margin:8px 0">${top.map(box).join('')||'<p class="note">טוען את רשימת האפליקציות…</p>'}</div>
 ${rest.length?`<details><summary style="cursor:pointer;min-height:44px;display:flex;align-items:center">כל האפליקציות בטלפון (${rest.length})</summary><div style="display:grid;gap:6px;margin:8px 0">${rest.map(box).join('')}</div></details>`:''}
 <label class="f"><span>שולחים שלא נקלטים (שורה לכל שולח, בדיוק כמו שהשם מופיע בהתראה)</span><textarea name="skip" rows="3" maxlength="5000">${esc((c.skip||[]).join('\n'))}</textarea></label>
 <div class="secrow"><button class="btn grow" style="min-height:44px">${c.on?'שמור':'שמור והפעל'}</button>${c.on?B('secNfOff','כבה את הקליטה'):''}${c.on?B('secNfV','חזרה לרשימה',' data-v="list"'):''}</div></form>`}
function sugH(){const S=st();return suggest(S.L,S.R).slice(0,3).map(e=>`<div class="card" style="border-color:var(--acc);border-width:2px"><b>ללמוד?</b><p style="margin:4px 0">מעכשיו כשמגיעה הודעה מ<b>${esc(e.s||'השולח')}</b> (${esc(e.a||'')}) – ${esc(actL(e,true))}.</p><p class="note" style="margin:0 0 4px">בחרת בזה ${e.n} פעמים.</p>${e.act==='task'?'<p class="note" style="margin:0 0 4px">כל הודעה מהשולח הזה תיפתח כמשימה לעובד, כולל הטקסט שלה.</p>':''}<div class="secrow">${B('secNfRuleOk','כן, לבצע לבד',` data-k="${esc(e.rk)}"`)}${B('secNfRuleNo','תמיד לשאול',` data-k="${esc(e.rk)}"`)}</div></div>`).join('')}
function cardH(it){const c=N.cards[it.k];const k=` data-k="${esc(it.k)}"`;
 const head=`<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b>${esc(it.s||'(בלי שם)')}</b><small class="note">${esc(it.a)} · ${esc(when(it.t))}</small></div><p style="margin:6px 0;white-space:pre-wrap;word-break:break-word">${esc(it.x)}</p>`;
 if(c){const C=cx(),S=c.staff||[];const who=c.all?'כל העובדים':(c.to||[]).map(z=>z.name).join(' ו');
  return `<div class="card">${head}<div class="card" style="margin:6px 0 0;padding:8px"><b>לפתוח משימה?</b><p style="margin:4px 0"><b>מה:</b> ${esc(c.txt)}</p><p style="margin:4px 0"><b>למי:</b> ${who?esc(who):'<span class="note">בחרו עובד</span>'}</p>
  ${S.length?`<div class="secrow" role="group" aria-label="למי">${S.slice(0,30).map(z=>B('secNfWho',esc(z.name),k+` data-u="${esc(z.uid)}"`,!c.all&&c.to.length===1&&c.to[0].uid===z.uid?' on':'')).join('')}${B('secNfWho','כל העובדים',k+' data-u="*"',c.all?' on':'')}</div>`:'<p class="note" style="margin:4px 0">רשימת העובדים לא נטענה – המשימה תיפתח לכל הצוות.</p>'}
  <p style="margin:4px 0"><b>יעד:</b> ${esc(C&&C.dueL?C.dueL(c):'3 ימי עסקים')}</p><div class="secrow">${B('secNfTkOk','אשר ופתח',k)}${B('secNfTkNo','בטל',k)}</div></div></div>`}
 return `<div class="card">${head}${it.cap&&CAPM[it.cap]?`<p class="note" style="margin:4px 0;color:var(--bad)">${esc(CAPM[it.cap])}</p>`:''}<p class="note" style="margin:4px 0">מה לעשות?</p><div class="secrow">${B('secNfTask','פתח משימה',k)}${B('secNfRem','תזכורת',k)}${B('secNfAsk','שאלי את המזכירה',k)}</div><div class="secrow">${B('secNfDone','✓ טופל',k)}${B('secNfIgn','התעלם',k)}${B('secNfBlock','לא לקלוט מהשולח הזה',k)}</div></div>`}
function listH(){const L=inbox(),nw=L.filter(x=>x.st==='new').sort((a,b)=>b.t-a.t),old=L.filter(x=>x.st!=='new').sort((a,b)=>(b.at||b.t)-(a.at||a.t));
 let h=sugH();
 h+=nw.length?nw.slice(0,50).map(cardH).join('')+(nw.length>50?`<p class="note">מוצגות 50 החדשות מתוך ${nw.length}.</p>`:''):`<div class="card"><p class="note" style="margin:0">אין התראות חדשות. כשתגיע הודעה מאחת האפליקציות שבחרתם, היא תופיע כאן.</p></div>`;
 if(old.length)h+=`<details class="card"><summary style="cursor:pointer;min-height:44px;display:flex;align-items:center">טופלו לאחרונה (${old.length})</summary>${old.slice(0,30).map(x=>`<div class="secli"><p style="margin:2px 0"><b>${esc(x.s)}</b> <small class="note">${esc(x.a)} · ${esc(when(x.t))}</small></p><p class="note" style="margin:2px 0;word-break:break-word">${esc(String(x.x).slice(0,140))}</p><small class="note">${esc(STL[x.st]||'')}${x.by==='auto'?' (לבד, לפי כלל)':''}</small>${x.tk?` ${B('secCxGo','למשימה',` data-tid="${esc(x.tk)}"`)}`:''}</div>`).join('')}</details>`;
 return h}
function rulesH(){const S=st(),R=Object.entries(S.R).sort((a,b)=>(b[1].t||0)-(a[1].t||0));
 let h=`<div class="card"><b>הכללים שנלמדו</b>${R.length?R.map(([rk,r])=>`<div class="secli"><p style="margin:2px 0">הודעה מ<b>${esc(r.s||'')}</b> (${esc(r.a||'')}) – ${r.on?esc(actL(r)):'תמיד לשאול'}</p><div class="secrow">${B('secNfRuleDel','מחק',` data-k="${esc(rk)}"`)}</div></div>`).join(''):'<p class="note" style="margin:6px 0 0">עוד אין כללים. אחרי שתבחרו אותה פעולה פעמיים לאותו שולח, המזכירה תציע ללמוד.</p>'}</div>`;
 h+=`<label class="card" style="display:flex;gap:10px;align-items:center;min-height:44px"><input type="checkbox" data-c="secNfStop"${S.off?' checked':''}> <span><b>עצור את הביצוע האוטומטי</b><br><small class="note">הכללים נשמרים, אבל המזכירה רק שואלת ולא מבצעת לבד.</small></span></label>`;
 h+=`<div class="card"><b>מה עשיתי לבד</b>${S.G.length?S.G.map(g=>`<div class="secli"><p style="margin:2px 0">${esc(when(g.t))} · ${esc(g.a||'')} · <b>${esc(g.s||'')}</b></p><small class="note">${g.act==='cap'?esc((CAPM[g.why]||CAPM.day)+(g.n>1?' ('+g.n+' הודעות)':'')):g.act==='ign'?'סומן "התעלם"':g.ok?(g.dup?'המשימה כבר הייתה פתוחה':'נפתחה משימה ל'+esc(g.un||'העובד')):'לא נפתחה משימה: '+esc(g.why||'')+' – ההתראה נשארה ברשימה'}</small>${g.tk?` ${B('secCxGo','למשימה',` data-tid="${esc(g.tk)}"`)}`:''}</div>`).join(''):'<p class="note" style="margin:6px 0 0">עוד לא בוצעה פעולה לבד.</p>'}</div>`;
 return h}
window.__secNotifH=()=>{try{return notifH()}catch(e){return '<p class="note">לא ניתן להציג את המסך כרגע.</p>'}};
/* 23.11.2026 (גיטי, סבב 3): ללשונית "תקשורת" (sec-comm.js) – ההתראות שבזיכרון של הדף, לקריאה בלבד ורק במכשיר הזה (לא נשלחות לשרת). null = הקליטה לא פעילה כאן */
window.__secNfList=()=>{try{return native()&&adm()&&plug()&&uid()&&N.cfg&&mine()?inbox().map(x=>({k:x.k,a:x.a,s:x.s,x:x.x,t:x.t,st:x.st})):null}catch(e){return null}};
window.__secNfTick=()=>{try{tick()}catch(e){}};

/* ---------- פעולות ---------- */
const pick=el=>{const it=itemOf(el.dataset.k);if(!it){toast('ההתראה כבר לא ברשימה');re(1)}return it};
function done(it,stv,act,to,extra){setSt(it.k,Object.assign({st:stv},extra||{}));if(act)learn(it,act,to);delete N.cards[it.k];re(1)}
ACT.secNfV=el=>{N.v=el.dataset.v||'list';if(N.v==='set')loadApps();re(1)};
ACT.secNfOpen=async()=>{const P=plug();if(!P)return;try{await P.openSettings()}catch(e){toast('לא הצלחתי לפתוח את ההגדרות. פתחו בהגדרות הטלפון: התראות ← גישה להתראות')}};
ACT.secNfRe=async()=>{await loadCfg();re(1);if(N.en)tick()};
ACT.secNfTake=()=>ask('להפעיל את קליטת ההתראות לחשבון שלך? ההתראות שנקלטו עד עכשיו בטלפון הזה יימחקו.',async()=>{const P=plug(),u0=N.cfg&&N.cfg.u||'';try{await P.clear();if(u0&&u0!==uid())wipe(u0);N.q=null;N.qU='';await saveCfg({on:true});toast('✓ הופעל לחשבון שלך')}catch(e){toast('הפעולה נכשלה')}re(1);setTimeout(tick,300)},'הפעל');
FRM.secNfSave=async f=>{const pk=[...f.querySelectorAll('input[name=p]:checked')].map(i=>i.value),all=!!f.querySelector('input[name=all]:checked');if(!pk.length&&!all)return toast('בחרו לפחות אפליקציה אחת, או "כל האפליקציות"');
 const skip=String(fd(f).skip||'').split('\n').map(s=>s.trim()).filter(Boolean).slice(0,200);const was=!!(N.cfg&&N.cfg.on);
 try{await saveCfg({on:true,all,pkgs:pk,skip})}catch(e){return toast('השמירה נכשלה')}
 toast(was?'✓ נשמר':'✓ הקליטה הופעלה');N.v='list';re(1);if(!N.en)setTimeout(()=>ask('כדי שההתראות ייקלטו, צריך לתת לאפליקציה "גישה להתראות" בהגדרות של אנדרואיד. לפתוח את ההגדרות עכשיו?',ACT.secNfOpen,'פתח הגדרות'),300)};
ACT.secNfOff=()=>ask('לכבות את קליטת ההתראות? מה שכבר נקלט יישאר כאן. אפשר גם לבטל את "גישה להתראות" בהגדרות של אנדרואיד.',async()=>{try{await saveCfg({on:false});toast('הקליטה כובתה')}catch(e){toast('הפעולה נכשלה')}N.v='list';re(1)},'כבה');
/* פתח משימה: פענוח בעזרת sec-cmd.js. יש עובד/יעד – כרטיס אישור; אחרת כרטיס עם "<שולח>: <טקסט>" ובחירת עובד */
ACT.secNfTask=async el=>{const it=pick(el);if(!it)return;const C=cx();if(!cxOk())return toast('אי אפשר לפתוח משימה כאן');el.disabled=true;
 try{const S=await C.staff();let r=null;try{if(window.SecCmd)r=SecCmd.parse(it.x,{staff:S,now:C.P(Date.now())})}catch(e){r=null}
  const ok=r&&r.k==='new'&&r.txt&&(r.all||(r.to||[]).length)&&!r.amb;
  N.cards[it.k]=ok?{id:tidOf(it.k),txt:r.txt.slice(0,500),all:!!r.all,to:(r.to||[]).map(z=>({uid:z.uid,name:z.name})),due:r.err?null:r.due||null,pri:r.pri==='h'?'h':'',rv:await C.rvNow(),staff:S}
   :{id:tidOf(it.k),txt:taskTxt(it),all:false,to:[],due:null,pri:'',rv:false,staff:S}}
 catch(e){toast('לא הצלחתי להכין את המשימה')}re(1)};
ACT.secNfWho=el=>{const c=N.cards[el.dataset.k];if(!c||c.busy)return;const u=el.dataset.u;if(u==='*'){c.all=true;c.to=[]}else{const z=(c.staff||[]).find(x=>x.uid===u);if(!z)return;c.all=false;c.to=[{uid:z.uid,name:z.name}]}re(1)};
ACT.secNfTkNo=el=>{delete N.cards[el.dataset.k];re(1)};
ACT.secNfTkOk=async el=>{const it=pick(el),c=N.cards[el.dataset.k];if(!it||!c||c.busy)return;if(!cxOk())return toast('אי אפשר לפתוח משימה כאן');
 if(!c.all&&!c.to.length&&(c.staff||[]).length)return toast('בחרו למי לפתוח את המשימה');c.busy=1;el.disabled=true;
 try{const r=await cx().create(c);const to=c.all?{uid:'*',un:'כל העובדים'}:c.to.length?{uid:c.to.map(z=>z.uid).sort().join(','),un:c.to.map(z=>z.name).join(' ו')}:null;
  toast(r.dup?'✓ המשימה כבר נפתחה':'✓ המשימה נפתחה');done(it,'task',to?'task':'',to,{tk:'sec'+c.id});try{if(typeof tkLoad==='function')tkLoad()}catch(e){}}
 catch(e){c.busy=0;el.disabled=false;toast(e&&e.cx||(typeof tkErr==='function'?tkErr(e):'פתיחת המשימה נכשלה'))}};
/* תזכורת: החלון הקיים של "תזכורת חדשה" (tasks-wc.js), ממולא בטקסט. ההתראה מסומנת רק אחרי שהתזכורת נשמרה */
ACT.secNfRem=el=>{const it=pick(el);if(!it)return;if(typeof ACT.tkwRNew!=='function'||typeof bzF!=='function'||!bzF('tasks'))return toast('התזכורות לא זמינות כאן');
 remWrap();N.remK=it.k;ACT.tkwRNew();setTimeout(()=>{const i=document.querySelector('#dlg form[data-f=tkwRem] input[name=txt]');if(i){i.value=taskTxt(it).slice(0,200);i.focus()}},80)};
/* tasks-wc.js נטען אחרי הקובץ הזה – העטיפה נעשית בלחיצה הראשונה */
function remWrap(){const f0=FRM.tkwRem;if(N.wr||typeof f0!=='function')return;N.wr=1;FRM.tkwRem=async function(f){const k=N.remK;N.remK='';const r=await f0.apply(this,arguments);
 try{const d=document.getElementById('dlg');if(k&&!(d&&d.open)){const it=itemOf(k);if(it)done(it,'rem','rem')}else if(k)N.remK=k}catch(e){}return r}}
/* שאלי את המזכירה: הנקודה היחידה שבה תוכן ההתראה יוצא מהמכשיר – בלחיצה, לצ'אט הקיים */
ACT.secNfAsk=el=>{const it=pick(el);if(!it)return;if(typeof window.__secAsk!=='function')return toast('הצ\'אט לא זמין כרגע');
 const q=`התקבלה הודעה ב${it.a||'אפליקציה'} מ${it.s||'שולח לא ידוע'}: «${it.x}». מה מומלץ לעשות?`;
 done(it,'ask','ask');try{ACT.secTab({dataset:{v:'chat'}})}catch(e){}window.__secAsk(q)};
ACT.secNfDone=el=>{const it=pick(el);if(it)done(it,'done','done')};
ACT.secNfIgn=el=>{const it=pick(el);if(it)done(it,'ign','ign')};
ACT.secNfBlock=el=>{const it=pick(el);if(!it)return;if(!it.s)return toast('אין שם שולח בהתראה הזו');
 ask(`לא לקלוט יותר הודעות מ"${it.s}"? אפשר להחזיר בהגדרות.`,async()=>{const sk=(N.cfg&&N.cfg.skip||[]).slice();if(!isSkipped(sk,it.s))sk.push(String(it.s).replace(/\s*\(\d+[^)]*\)\s*$/,'').trim());
  try{await saveCfg({skip:sk})}catch(e){return toast('הפעולה נכשלה')}
  const M=stM(),now=Date.now();inbox().forEach(x=>{if(x.st==='new'&&senderKey(x.s)===senderKey(it.s))stPut(M,x.k,{st:'blk'},now)});stMW(M);toast('✓ לא ייקלטו יותר הודעות מהשולח הזה');re(1)},'לא לקלוט')};
ACT.secNfRuleOk=el=>{const S=st(),e=suggest(S.L,S.R).find(x=>x.rk===el.dataset.k);if(!e)return re(1);setRule(S.R,e,true);stW(S);toast('✓ מעכשיו זה יבוצע לבד');re(1)};
ACT.secNfRuleNo=el=>{const S=st(),e=suggest(S.L,S.R).find(x=>x.rk===el.dataset.k);if(!e)return re(1);setRule(S.R,e,false);stW(S);toast('בסדר, אמשיך לשאול');re(1)};
ACT.secNfRuleDel=el=>{const rk=el.dataset.k;ask('למחוק את הכלל? המזכירה תחזור לשאול על הודעות מהשולח הזה.',()=>{const S=st();delRule(S.R,S.L,rk);stW(S);toast('הכלל נמחק');re(1)},'מחק')};
CHG.secNfStop=el=>{const S=st();S.off=!!el.checked;stW(S);toast(S.off?'הביצוע האוטומטי נעצר':'הביצוע האוטומטי חזר')};

/* ---------- יציאה מהחשבון (נקרא מ-tasks-wc.js W.out, לפני ש-SY מתאפס): אם הקליטה שייכת למשתמש שיוצא (או לאף אחד) – מכבים, מוחקים את התור והתצורה בתוסף. ובכל מקרה מוחקים את המפתחות המקומיים שלו. לא זורק ---------- */
window.__secNfOut=u=>{u=u||uid();
 try{const P=plug();if(P)Promise.resolve(P.getConfig()).then(c=>{const cu=String(c&&c.u||'');if(cu&&cu!==u)return;return Promise.resolve(P.setConfig({on:false,all:false,pkgs:[],skip:[],u:''})).then(()=>P.clear())}).catch(()=>{})}catch(e){}
 wipe(u);N.q=null;N.qU='';N.lg='';N.cfg=null;N.ld=0;N.cards={};N.lastN=-1};

/* ---------- חיבור: מונה בלשונית, הסתרה ממי שאינו מנהל, קליטה בפתיחה / חזרה לאפליקציה / אירוע מהתוסף ---------- */
{const r0=V.sec;V.sec=function(){const r=r0.apply(this,arguments);
 try{if(r&&typeof r.h==='string'&&r.h.includes('data-v="'+TK+'"')){
  if(!adm())r.h=r.h.replace(new RegExp('<button[^>]*data-v="'+TK+'"[^>]*>[^<]*</button>'),'');
  else{const n=newN();if(n)r.h=r.h.replace('data-v="'+TK+'">'+TL,'data-v="'+TK+'">'+TL+' <span class="secbadge">'+n+'</span>')}}}catch(e){}
 return r}}
{const t0=ACT.secTab;ACT.secTab=el=>{if(el&&el.dataset&&el.dataset.v===TK){N.cards={};if(N.ld===2)loadCfg().then(()=>{if(onTab())re()});setTimeout(tick,0)}return t0(el)}}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)setTimeout(()=>{if(onTab())loadCfg().then(()=>re());tick()},800)});
setTimeout(tick,4000);
})(typeof window!=='undefined'?window:this);
