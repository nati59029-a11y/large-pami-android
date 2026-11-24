/* שלב B1 (24.11.2026): מטמון מכשיר משותף – כל מסך מציג את המידע האחרון שהתקבל כשאין אינטרנט.
   window.DC = { get, put, del, out, key, rd, fnOk, mark, ok, sput, sfill, swait, soff, sdel, stale }
   - IndexedDB 'lp-cache', מפתחות: bizId|uid|... (כמו groups.js). כל שגיאה = "אין מטמון" – לא זורק ולא עוצר את האפליקציה.
   - כל ערך נשמר כמחרוזת JSON (בדיוק התשובה מהשרת), עם זמן השמירה. ערך מעל 3MB לא נשמר. עד 400 ערכים ועד 40MB בסך הכול; מעבר לזה (או כשהמקום בטלפון נגמר) נמחק הישן ביותר בשימוש (LRU).
   - 403/404 מהשרת מוחקים את העותק השמור (הרשאה שבוטלה / מסמך שנמחק לא יוצגו מהמטמון). תשובה זהה לקודמת לא נכתבת שוב.
   - out() מוחק את כל המסד – נקרא ביציאה (syOut), ליד GRP.out().
   - fsx ו-fnCall (index.html) משתמשים בזה רק לקריאות: GET, :runQuery, :runAggregationQuery, :batchGet, ופונקציות שרת מרשימה סגורה (FNR).
     כתיבה (PATCH, DELETE, POST יצירה, :commit) לא נשמרת ולא מזויפת.
   - לא נשמר ולא מוחזר מהמטמון (NO): תורי קליטה וסנכרון שמייבאים נתונים למכשיר (inbox, chunks, deposits, closings, supinv, site_income_daily,
     cashout, ordpay, wv, shelf, fb) – מידע ישן היה נקלט שוב; קבוצות ונוכחות (grp, pres) – ל-groups.js מטמון משלו; קופה (pos*) – לקופה מצב לא-מקוון משלה. */
(function(){'use strict';
const DBN='lp-cache',ST='k',SZ='z',MAXB=3*1024*1024,MAXN=400,MAXT=40*1024*1024;
/* 24.11 (בדיקה עצמאית): נוספו ardoc/arcfg (arInc כותב ליומן לפיהם), bk (שחזור גיבוי), admins/superadmins (הרשאות – לא מקבלים הרשאה ממידע ישן) */
const NO_C='inbox|chunks|deposits|closings|supinv|site_income_daily|cashout|ordpay|wv|shelf|fb|grp|pres|pos[A-Za-z_]*|ardoc|arcfg|bk|admins|superadmins';
const NO=new RegExp('(^|/)('+NO_C+')(/|\\?|:|$)|"collectionId":"('+NO_C+')"');
/* פונקציות שרת לקריאה בלבד: true = כל הקריאה; מערך = רק ה-op האלה */
const FNR={getCosts:1,ordProfit:1,arImpList:1,cxHist:1,cxCfg:1,tkStaffNames:1,secChatLoad:1,secState:1,secAdminGet:1,
 incAll:['get','day'],shApi:['cfg'],secMail:['list','get'],secReports:['list','get'],secSens:['list'],secRules:['list'],secWaCfg:['get'],secGoogle:['status'],cxBotTok:['info']};
let P=null,D=null,GEN=0;
const db=()=>P||(P=new Promise((res,rej)=>{const r=indexedDB.open(DBN,2);r.onupgradeneeded=()=>{const x=r.result;if(x.objectStoreNames.contains(ST))x.deleteObjectStore(ST);if(x.objectStoreNames.contains(SZ))x.deleteObjectStore(SZ);x.createObjectStore(ST);x.createObjectStore(SZ).createIndex('a','a')};r.onsuccess=()=>{D=r.result;D.onversionchange=()=>{try{D.close()}catch(e){}D=null;P=null};res(D)};r.onerror=()=>rej(r.error);r.onblocked=()=>rej(new Error('blocked'))}).catch(e=>{P=null;throw e}));
const who=()=>{try{return SY&&SY.uid?(SY.bizId||'')+'|'+SY.uid:''}catch(e){return ''}};
/* hash קצר לגוף ארוך (cyrb53) */
const hs=s=>{let a=0xdeadbeef,b=0x41c6ce57;for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);a=Math.imul(a^c,2654435761);b=Math.imul(b^c,1597334677)}a=Math.imul(a^(a>>>16),2246822507)^Math.imul(b^(b>>>13),3266489909);b=Math.imul(b^(b>>>16),2246822507)^Math.imul(a^(a>>>13),3266489909);return (b>>>0).toString(36)+(a>>>0).toString(36)+'.'+s.length};
/* מפתח מלא: עסק|משתמש|שיטה|כתובת|גוף. '' = אין משתמש (לא שומרים) */
function key(m,url,body){const w=who();if(!w)return '';const b=body==null?'':String(body);return w+'|'+m+'|'+url+(b?'|'+(b.length>200?hs(b):b):'')}
/* האם בקשת Firestore היא קריאה שמותר לשמור. path = החלק אחרי /documents (כמו ב-fsx) */
function rd(path,opt){try{const m=String(opt&&opt.method||'GET').toUpperCase();const p=String(path||'');let ok=false;
 if(m==='GET')ok=true;else if(m==='POST')ok=/:(runQuery|runAggregationQuery|batchGet)$/.test(p.split('?')[0]);
 if(!ok)return false;if(NO.test(p.split('?')[0]))return false;if(m==='POST'&&NO.test(String(opt.body||'')))return false;return true}catch(e){return false}}
function fnOk(name,data){try{const r=FNR[name];if(!r||!Object.prototype.hasOwnProperty.call(FNR,name))return false;if(r===1)return true;return !!(data&&typeof data==='object'&&r.includes(data.op))}catch(e){return false}}
/* ST: k → {v,t}; SZ: k → {n (אורך), a (שימוש אחרון)} – בשביל תקרת הנפח הכוללת (MAXT) ו-LRU בלי לקרוא את הערכים עצמם */
const LH=new Map();/* k → טביעה של הטקסט האחרון שנכתב בהפעלה הזו: תשובה זהה לא נכתבת שוב */
async function get(k){try{if(!k||!who()||k.indexOf(who()+'|')!==0)return null;const g=GEN,d=await db();if(g!==GEN)return null;return await new Promise(res=>{const t=d.transaction([ST,SZ],'readwrite'),r=t.objectStore(ST).get(k);r.onsuccess=()=>{const v=r.result;if(!v||typeof v.v!=='string'){res(null);return}try{t.objectStore(SZ).put({n:v.v.length,a:Date.now()},k)}catch(e){}res({v:v.v,t:+v.t||0})};r.onerror=()=>res(null);t.onabort=()=>res(null)})}catch(e){return null}}
/* מפנה ערכים (הישנים בשימוש קודם) עד שיש פחות מ-MAXN ופחות מ-MAXT; force = כמות לפנות בכל מקרה (המקום בטלפון נגמר) */
function trim(t,keep,force){const z=t.objectStore(SZ),o=t.objectStore(ST);let tot=0,cnt=0;const c=z.openCursor();
 c.onsuccess=()=>{const cu=c.result;if(cu){tot+=+(cu.value&&cu.value.n)||0;cnt++;cu.continue();return}
  let xn=Math.max(cnt-MAXN,force||0),xt=tot-MAXT;if(xn<=0&&xt<=0)return;const q=z.index('a').openCursor();
  q.onsuccess=()=>{const cu=q.result;if(!cu||(xn<=0&&xt<=0))return;if(cu.primaryKey!==keep){LH.delete(cu.primaryKey);o.delete(cu.primaryKey);xt-=+(cu.value&&cu.value.n)||0;xn--;cu.delete()}cu.continue()}}}
async function put(k,txt){try{if(!k||typeof txt!=='string'||k.indexOf(who()+'|')!==0||!who())return;if(txt.length>MAXB){del(k);return}
 const h=hs(txt);if(LH.get(k)===h)return;const g=GEN,d=await db();if(g!==GEN||k.indexOf(who()+'|')!==0)return;
 const wr=force=>new Promise(res=>{let t;try{t=d.transaction([ST,SZ],'readwrite')}catch(e){return res(false)}const n=Date.now();
  if(force)trim(t,'',force);else{t.objectStore(ST).put({v:txt,t:n},k);t.objectStore(SZ).put({n:txt.length,a:n},k);trim(t,k,0)}
  t.oncomplete=()=>res(true);t.onerror=()=>res(false);t.onabort=()=>res(false)});
 if(await wr(0)){if(g===GEN)LH.set(k,h);return}
 /* נכשל (בדרך כלל: אין מקום) – מפנים רבע מהערכים וממשיכים פעם אחת */
 await wr(Math.max(20,Math.ceil(MAXN/4)));if(g===GEN&&await wr(0))LH.set(k,h)}catch(e){}}
async function del(k){try{if(!k||!who())return;LH.delete(k);const d=await db();await new Promise(res=>{const t=d.transaction([ST,SZ],'readwrite');t.objectStore(ST).delete(k);t.objectStore(SZ).delete(k);t.oncomplete=res;t.onerror=res;t.onabort=res})}catch(e){}}
/* ---- שורת "אין חיבור" ---- */
let st0=0;
function css(){if(st0)return;st0=1;try{const s=document.createElement('style');s.textContent='#dcnet{position:fixed;inset-inline:0;bottom:calc(84px + env(safe-area-inset-bottom));z-index:25;margin:0 auto;width:max-content;max-width:calc(100% - 28px);background:var(--card);color:var(--ink);border:1px solid var(--line);border-inline-start:4px solid var(--acc);border-radius:20px;padding:4px 12px;font-size:.8rem;font-weight:600;text-align:center;box-shadow:var(--elev-1,0 2px 6px rgba(0,0,0,.3));pointer-events:none}';document.head.appendChild(s)}catch(e){}}
const p2=n=>String(n).padStart(2,'0');
function tm(t){const d=new Date(t),n=new Date();const h=p2(d.getHours())+':'+p2(d.getMinutes());return d.toDateString()===n.toDateString()?h:p2(d.getDate())+'/'+p2(d.getMonth()+1)+' '+h}
function paint(){try{let e=document.getElementById('dcnet');if(!DC.stale){if(e)e.remove();return}if(!document.body)return;css();if(!e){e=document.createElement('div');e.id='dcnet';e.setAttribute('role','status');e.setAttribute('dir','rtl');document.body.appendChild(e)}e.textContent='📴 אין חיבור – מוצג מידע שמור מ-'+tm(DC.stale)}catch(e){}}
/* הוצג מידע שמור מזמן t (הישן מבין כמה) */
function mark(t){try{t=+t||Date.now();if(!DC.stale||t<DC.stale)DC.stale=t;paint()}catch(e){}}
/* קריאה הצליחה מהשרת – השורה נעלמת */
function ok(){if(DC.stale){DC.stale=0;paint()}}
/* ---- B2a (24.11.2026): מטמון תצוגה של מסכים – נפרד מהמטמון של fsx ----
   sput(n,v): אחרי טעינה מוצלחת מהשרת – שומר את הנתונים המעובדים שהמסך מציג (JSON) תחת עסק|משתמש|SCR|n.
     תצוגה בלבד: לא נכנס לשום מסלול קליטה, סנכרון או כתיבה (pullInbox, ייבוא wv/inbox וכו').
   sfill(n,apply): כשהזיכרון ריק – פעם אחת בהפעלה לכל מפתח קורא את העותק השמור וקורא ל-apply(v,t),
     רק אם עוד לא הגיעה תשובה מהשרת (sput) למפתח הזה בהפעלה הזו. השרת תמיד גובר.
   soff(e,t): הטעינה מהשרת נכשלה בגלל שאין חיבור והמסך מציג עותק שמור מזמן t – שורת "אין חיבור" (mark).
   again=1: גם אם כבר נקרא/נטען בהפעלה הזו (מסך שמתרוקן בכל כניסה); apply חייב לבדוק בעצמו שהזיכרון עדיין ריק.
   swait(n): מחכה לקריאה מהמכשיר שעוד בדרך (לפני הבקשה לשרת), כדי שעותק שמור לא יחליף תשובה חדשה וש-soff יידע מה מוצג. */
const SF=new Set(),SR=new Set(),SP=new Map(),SX=new Set(),skey=n=>key('SCR',String(n),'');
function sput(n,v){try{const k=skey(n);if(!k)return;SR.add(k);const s=JSON.stringify(v);if(typeof s==='string')put(k,s)}catch(e){}}
function sfill(n,apply,again){try{const k=skey(n);if(!k||(!again&&(SF.has(k)||SR.has(k))))return;SF.add(k);SX.delete(k);
 const p=get(k).then(r=>{if(!r||SX.has(k)||(!again&&SR.has(k))||skey(n)!==k)return;let v;try{v=JSON.parse(r.v)}catch(e){return}try{apply(v,r.t)}catch(e){}}).catch(()=>{}).then(()=>{if(SP.get(k)===p)SP.delete(k)});SP.set(k,p)}catch(e){}}
/* 24.11 (בדיקה): עד 3 שניות. אם המכשיר לא ענה עד אז – הטעינה מהשרת ממשיכה, והעותק שיגיע מאוחר לא יוצג (SX) */
function swait(n){try{const k=skey(n),p=SP.get(k);if(!p)return Promise.resolve();return Promise.race([p,new Promise(r=>setTimeout(()=>{if(SP.get(k)===p)SX.add(k);r()},3000))])}catch(e){return Promise.resolve()}}
/* B2b (בדיקה): sdel(n) – 403 מהשרת: מוחק את עותק התצוגה מהמכשיר (ולא רק מהמסך). קריאה שעוד בדרך לא תוצג (SX) */
function sdel(n){try{const k=skey(n);if(!k)return;SF.delete(k);SR.delete(k);if(SP.has(k)){SX.add(k);SP.delete(k)}del(k)}catch(e){}}
function soff(e,t){try{if(e&&e.offline&&t)mark(t)}catch(x){}}
function out(){GEN++;LH.clear();SF.clear();SR.clear();SP.clear();SX.clear();DC.stale=0;paint();try{if(D)D.close()}catch(e){}D=null;P=null;try{indexedDB.deleteDatabase(DBN)}catch(e){}}
const DC={get,put,del,out,key,rd,fnOk,mark,ok,sput,sfill,swait,soff,sdel,stale:0};
window.DC=DC;
})();
