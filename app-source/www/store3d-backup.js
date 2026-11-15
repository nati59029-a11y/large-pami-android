/* סריקת חנות בתלת מימד – שלב 14 (משימה 2026-11-14_סריקת-חנות-תלת-מימד): נתוני הסריקה בתוך הגיבוי הקיים.
   לא מנגנון חדש: index.html (bkCollect) קורא ל-S3BK.collect, והתוצאה נכנסת לקובץ הגיבוי הרגיל כשדה רשות st3 – בגיבוי לקובץ,
   בגיבוי היומי לענן (bk) ובגיבוי המוצפן (app_backups). גיבוי בלי השדה (ישן, עובד, תוספת כבויה) – נשאר כמו שהיה.
   מה נכנס (חוזה, סעיף 7): s3br, s3set, smap + ver + bay, sround, srun של 12 החודשים האחרונים (לפי openAt) + ph (נתיבים בלבד) + ai,
   s3fix, s3appeal, s3short, s3perf (של העובדים שמופיעים בסבבים). בלי שום תמונה (התמונות ב-Storage, רק הנתיב נשמר).
   לא נכנס: s3sum (מחושב מחדש), s3use, s3qid, s3ntf, s3draft, תור הטלפון, טוקני push.
   כל מסמך נשמר כמו שהוא ב-Firestore (p = נתיב יחסי לעסק, f = השדות בפורמט REST) – בלי איבוד סוג (int מול double).
   שחזור: נתוני הסריקה חיים בשרת, והשרת בלבד כותב אותם (חוקים). לכן שחזור גיבוי בטלפון לא כותב ולא מוחק שום דבר מנתוני הסריקה –
   הם נשארים בקובץ, ומוצגת שורת הסבר בחלון השחזור. גיבוי בלי השדה – בלי שורה ובלי שגיאה.
   רק מנהל / מנהל־על, רק כשהתוספת store3d פעילה. כשל בקריאה לא מכשיל את הגיבוי: נרשם ב-miss. */
(function(){
'use strict';
if(typeof fsx==='undefined')return;
const D1=864e5,MONTHS=12,KEEP_MS=30*60e3;
const on=()=>{try{return !!(window.S3UI&&typeof S3UI.feat==='function'&&S3UI.feat()&&typeof S3UI.isMgr==='function'&&S3UI.isMgr())}catch(e){return false}};
/* נתיב יחסי לעסק: בלי התחילית של המסד ובלי b/{bizId}/ */
const rel=n=>{const s=String(n||'').split('/documents/')[1]||'';return s.replace(/^b\/[^/]+\//,'')};
const enc=s=>String(s).split('/').map(encodeURIComponent).join('/');
async function lst(path){const out=[];let tok='';
 for(let i=0;i<100;i++){const j=await fsx(path+'?pageSize=300'+(tok?'&pageToken='+encodeURIComponent(tok):''));((j&&j.documents)||[]).forEach(d=>out.push(d));tok=j&&j.nextPageToken;if(!tok)break}
 return out}
async function pool(L,n,fn){let i=0;const w=async()=>{while(i<L.length){const x=L[i++];await fn(x)}};await Promise.all(Array.from({length:Math.min(n,L.length)},w))}
let last=null;
async function collect(){
 if(!on())return undefined;
 const key=(SY&&SY.bizId||'')+'|'+(SY&&SY.uid||'');
 if(last&&last.key===key&&Date.now()-last.t<KEEP_MS)return last.v;
 const docs=[],miss=[],n={};
 const add=(c,L)=>{L.forEach(d=>docs.push({p:rel(d.name),f:d.fields||{}}));n[c]=(n[c]||0)+L.length;return L};
 const get=async(c,path)=>{try{return add(c,await lst(path))}catch(e){if(!(e&&e.code===404))miss.push(path.replace(/^\//,''));return[]}};
 for(const c of ['s3br','s3set','sround','s3fix','s3appeal','s3short'])await get(c,'/'+c);
 const maps=await get('smap','/smap');
 await pool(maps,4,async d=>{const id=rel(d.name).split('/')[1];await get('ver','/smap/'+enc(id)+'/ver');await get('bay','/smap/'+enc(id)+'/bay')});
 const cut=Date.now()-MONTHS*31*D1;let runs=[];
 try{const r=await fsx(':runQuery',{method:'POST',body:JSON.stringify({structuredQuery:{from:[{collectionId:'srun'}],where:{fieldFilter:{field:{fieldPath:'openAt'},op:'GREATER_THAN_OR_EQUAL',value:{integerValue:String(cut)}}},limit:5000}})});
  runs=add('srun',(r||[]).filter(x=>x&&x.document).map(x=>x.document))}catch(e){miss.push('srun')}
 const uids=new Set();
 runs.forEach(d=>{const f=d.fields||{};((f.uids&&f.uids.arrayValue&&f.uids.arrayValue.values)||[]).forEach(v=>{if(v&&v.stringValue)uids.add(v.stringValue)});Object.keys((f.asg&&f.asg.mapValue&&f.asg.mapValue.fields)||{}).forEach(u=>uids.add(u))});
 await pool(runs,4,async d=>{const id=rel(d.name).split('/')[1];await get('ph','/srun/'+enc(id)+'/ph');await get('ai','/srun/'+enc(id)+'/ai')});
 await pool([...uids],4,async u=>{await get('s3perf','/s3perf/'+enc(u)+'/m')});
 const v={v:1,at:Date.now(),months:MONTHS,n,docs};if(miss.length)v.miss=miss.slice(0,200);
 last={key,t:Date.now(),v};return v}
/* בדיקה בסיסית של השדה בקובץ גיבוי. לא תקין = כאילו אין (שחזור ממשיך בלי שגיאה) */
const ok=x=>!!(x&&typeof x==='object'&&!Array.isArray(x)&&Array.isArray(x.docs));
const pick=o=>o&&ok(o.st3)?o.st3:null;
/* שורת הסבר בחלון השחזור. בלי השדה – מחרוזת ריקה */
function note(r){const x=r&&r.st3;if(!ok(x))return'';
 const runs=x.docs.filter(d=>d&&/^srun\/[^/]+$/.test(d.p||'')).length,maps=x.docs.filter(d=>d&&/^smap\/[^/]+$/.test(d.p||'')).length;
 return`<p class="note">הגיבוי כולל גם נתוני סריקת חנות (${maps} מפות, ${runs} סבבים, בלי תמונות). השחזור לא משנה ולא מוחק את נתוני הסריקה שבשרת – הם נשארים כמו שהם, והעותק נשמר בקובץ הגיבוי.</p>`}
window.S3BK={collect,note,pick,ok,on,rel,reset:()=>{last=null}};
})();
