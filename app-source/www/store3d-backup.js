/* סריקת חנות בתלת מימד – שלב 14 (משימה 2026-11-14_סריקת-חנות-תלת-מימד): נתוני הסריקה בתוך הגיבוי הקיים.
   לא מנגנון חדש: index.html (bkCollect) קורא ל-S3BK.collect, והתוצאה נכנסת לקובץ הגיבוי הרגיל כשדה רשות st3 – בגיבוי לקובץ,
   בגיבוי היומי לענן (bk) ובגיבוי המוצפן (app_backups). גיבוי בלי השדה (ישן, עובד, תוספת כבויה) – נשאר כמו שהיה.
   מה נכנס (חוזה, סעיף 7): s3br, s3set, smap + ver + bay, sround, srun של 12 החודשים האחרונים (לפי openAt) + ph (נתיבים בלבד) + ai,
   s3fix, s3appeal, s3short, s3perf (של העובדים שמופיעים בסבבים). בלי שום תמונה (התמונות ב-Storage, רק הנתיב נשמר).
   לא נכנס: s3sum (מחושב מחדש), s3use, s3qid, s3ntf, s3draft, תור הטלפון, טוקני push.
   כל מסמך נשמר כמו שהוא ב-Firestore (p = נתיב יחסי לעסק, f = השדות בפורמט REST) – בלי איבוד סוג (int מול double).
   שחזור: נתוני הסריקה חיים בשרת, והשרת בלבד כותב אותם (חוקים). לכן שחזור גיבוי בטלפון לא כותב ולא מוחק שום דבר מנתוני הסריקה –
   הם נשארים בקובץ, ומוצגת שורת הסבר בחלון השחזור. גיבוי בלי השדה – בלי שורה ובלי שגיאה.
   רק מנהל / מנהל־על, רק כשהתוספת store3d פעילה. כשל בקריאה לא מכשיל את הגיבוי: נרשם ב-miss.
   תיקון סבב 1: תקרת גודל (12MB) וזמן (20 שניות), רק 3 הגרסאות האחרונות לכל מפה, ובגיבוי המוצפן – אם הקובץ חורג מ-50MB נוצר שוב בלי st3 (abkRun). */
(function(){
'use strict';
if(typeof fsx==='undefined')return;
const D1=864e5,MONTHS=12,KEEP_MS=30*60e3,VER_N=3,RUN_MAX=5000;
/* תיקון סבב 1: נתוני הסריקה לעולם לא מפילים את הגיבוי הקיים.
   MAX = תקרת גודל ל-st3 (תווים ב-JSON). TIME = תקרת זמן לאיסוף. מעבר לתקרה – עוצרים, ומה שנאסף נשמר עם part:1 ורישום ב-miss.
   סדר האיסוף לפי חשיבות: הגדרות, מפות ומקטעים, כללי סבב, תיקונים/ערעורים/חוסרים ← סבבים מהחדש לישן (כל סבב עם ph ו-ai שלו)
   ← 3 הגרסאות האחרונות של כל מפה ← ביצועים. כך בחיתוך נשמרים קודם הנתונים החשובים והעדכניים */
const L={MAX:12e6,TIME:20e3};
const on=()=>{try{return !!(window.S3UI&&typeof S3UI.feat==='function'&&S3UI.feat()&&typeof S3UI.isMgr==='function'&&S3UI.isMgr())}catch(e){return false}};
/* נתיב יחסי לעסק: בלי התחילית של המסד ובלי b/{bizId}/ */
const rel=n=>{const s=String(n||'').split('/documents/')[1]||'';return s.replace(/^b\/[^/]+\//,'')};
const enc=s=>String(s).split('/').map(encodeURIComponent).join('/');
async function lst(path,q,max){const out=[];let tok='';
 for(let i=0;i<100;i++){const j=await fsx(path+'?pageSize='+(max||300)+(q||'')+(tok?'&pageToken='+encodeURIComponent(tok):''));((j&&j.documents)||[]).forEach(d=>out.push(d));tok=j&&j.nextPageToken;if(!tok||max)break}
 return out}
let last=null;
/* הערה בעברית למסך הגיבוי, כשהאיסוף האחרון נחתך או דולג (נשמרת במכשיר) */
const WK='lp-s3bk-warn';
const setWarn=m=>{try{if(m)localStorage.setItem(WK,m);else localStorage.removeItem(WK)}catch(e){}};
const warn=()=>{try{return on()?(localStorage.getItem(WK)||''):''}catch(e){return''}};
const WARN={size:'נתוני סריקת החנות גדולים מהתקרה – בגיבוי נשמרו רק החדשים והחשובים (השאר נשאר בשרת).',time:'איסוף נתוני סריקת החנות לקח יותר מדי זמן – בגיבוי נשמר רק חלק (השאר נשאר בשרת).',big:'הגיבוי לענן עם נתוני סריקת החנות היה גדול מדי – הגיבוי המוצפן נשמר בלעדיהם (שאר הנתונים נשמרו כרגיל).',err:'חלק מנתוני סריקת החנות לא נקראו – בגיבוי נשמר רק חלק.'};
const stub=why=>({v:1,at:Date.now(),months:MONTHS,n:{},docs:[],part:1,miss:[why]});
/* תיקון סבב 2: גיבוי מוצפן שחורג מהתקרה – abkRun מחליף את st3 בסימון קטן, באותו איסוף (בלי דגל משותף, בלי לקרוא שוב קבצים).
   מחזיר את הסימון רק כש-st3 באמת תורם גודל (יש בו מסמכים); אחרת null – ואז אין ניסיון שני, והשגיאה כמו קודם */
function big(x){if(!ok(x)||!x.docs.length)return null;setWarn(WARN.big);return stub('big')}
async function collect(){
 if(!on())return undefined;
 const key=(SY&&SY.bizId||'')+'|'+(SY&&SY.uid||'');
 if(last&&last.key===key&&Date.now()-last.t<KEEP_MS)return last.v;
 const docs=[],miss=[],n={},t0=Date.now();let size=0,stop='';
 const halt=()=>{if(!stop&&Date.now()-t0>L.TIME)stop='time';return !!stop};
 const add=(c,Ld)=>{const out=[];for(const d of Ld){const x={p:rel(d.name),f:d.fields||{}},z=JSON.stringify(x).length+1;if(size+z>L.MAX){stop=stop||'size';break}size+=z;docs.push(x);out.push(d);n[c]=(n[c]||0)+1}return out};
 const get=async(c,path,q,max)=>{if(halt())return[];try{return add(c,await lst(path,q,max))}catch(e){if(!(e&&e.code===404))miss.push(path.replace(/^\//,''));return[]}};
 const work=(async()=>{
  for(const c of ['s3br','s3set'])await get(c,'/'+c);
  const maps=await get('smap','/smap');
  for(const d of maps)await get('bay','/smap/'+enc(rel(d.name).split('/')[1])+'/bay');
  for(const c of ['sround','s3fix','s3appeal','s3short'])await get(c,'/'+c);
  const cut=Date.now()-MONTHS*31*D1;let runs=[];
  if(!halt())try{const r=await fsx(':runQuery',{method:'POST',body:JSON.stringify({structuredQuery:{from:[{collectionId:'srun'}],where:{fieldFilter:{field:{fieldPath:'openAt'},op:'GREATER_THAN_OR_EQUAL',value:{integerValue:String(cut)}}},orderBy:[{field:{fieldPath:'openAt'},direction:'DESCENDING'}],limit:RUN_MAX}})});
   const all=(r||[]).filter(x=>x&&x.document).map(x=>x.document);if(all.length>=RUN_MAX)miss.push('srun-limit');runs=all}catch(e){miss.push('srun')}
  const uids=new Set();
  for(const d of runs){if(halt())break;if(!add('srun',[d]).length)break;const f=d.fields||{},id=rel(d.name).split('/')[1];
   ((f.uids&&f.uids.arrayValue&&f.uids.arrayValue.values)||[]).forEach(v=>{if(v&&v.stringValue)uids.add(v.stringValue)});Object.keys((f.asg&&f.asg.mapValue&&f.asg.mapValue.fields)||{}).forEach(u=>uids.add(u));
   await get('ph','/srun/'+enc(id)+'/ph');await get('ai','/srun/'+enc(id)+'/ai')}
  for(const d of maps){if(halt())break;const id=rel(d.name).split('/')[1];
   try{const r=await fsx('/smap/'+enc(id)+':runQuery',{method:'POST',body:JSON.stringify({structuredQuery:{from:[{collectionId:'ver'}],orderBy:[{field:{fieldPath:'at'},direction:'DESCENDING'}],limit:VER_N}})});add('ver',(r||[]).filter(x=>x&&x.document).map(x=>x.document))}catch(e){miss.push('smap/'+id+'/ver')}}
  for(const u of uids)await get('s3perf','/s3perf/'+enc(u)+'/m');
 })();
 let tm;const late=new Promise(r=>{tm=setTimeout(()=>{stop=stop||'time';r()},L.TIME+5e3)});
 await Promise.race([work.catch(e=>{miss.push('err')}),late]);clearTimeout(tm);
 if(stop)miss.unshift(stop);
 const v={v:1,at:Date.now(),months:MONTHS,n:Object.assign({},n),docs:docs.slice()};
 if(stop)v.part=1;if(miss.length)v.miss=miss.slice(0,200);
 setWarn(stop?WARN[stop]:miss.length?WARN.err:'');
 last={key,t:Date.now(),v};return v}
/* בדיקה בסיסית של השדה בקובץ גיבוי. לא תקין = כאילו אין (שחזור ממשיך בלי שגיאה) */
const ok=x=>!!(x&&typeof x==='object'&&!Array.isArray(x)&&Array.isArray(x.docs));
const pick=o=>o&&ok(o.st3)?o.st3:null;
/* שורת הסבר בחלון השחזור. בלי השדה – מחרוזת ריקה */
function note(r){const x=r&&r.st3;if(!ok(x))return'';
 const runs=x.docs.filter(d=>d&&/^srun\/[^/]+$/.test(d.p||'')).length,maps=x.docs.filter(d=>d&&/^smap\/[^/]+$/.test(d.p||'')).length;
 return`<p class="note">הגיבוי כולל גם נתוני סריקת חנות (${maps} מפות, ${runs} סבבים, בלי תמונות${x.part?', חלקי':''}). השחזור לא משנה ולא מוחק את נתוני הסריקה שבשרת – הם נשארים כמו שהם, והעותק נשמר בקובץ הגיבוי.</p>`}
window.S3BK={collect,note,pick,ok,on,rel,warn,big,L,reset:()=>{last=null}};
})();
