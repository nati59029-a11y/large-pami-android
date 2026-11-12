/* ORD:CUST – לקוחות להזמנות (ענף fb/ord-cust). קובץ עצמאי, נטען אחרי orders-staff.js.
   - הזמנה חדשה (2026-11-09, לקוח לפי טלפון): שדה ראשון טלפון; טלפון תקין → חיפוש cust/p{phone} + שאילתה phone==; הלקוחות שנמצאו מוצגים לבחירה,
     ואפשר "לקוח חדש עם אותו טלפון" (asNew → מזהה c{20} בשרת). ת"ז – רק בניוד קווים (או כשללקוח שנבחר יש ת"ז). משלוח: רחוב/עיר/קומה/דירה (רשות).
     שמירת ההזמנה → saveCust עם fill (ממלא רק שדות ריקים – כך מצרפים פרטים חדשים ללקוח קיים), id של הלקוח שנבחר, וההזמנה מקושרת ללקוח.
   - לקוח עסקי (= סיטונאי): שם העסק, ע.מ, איש קשר, טלפון, כתובת, עיר, תנאי תשלום. עובד ומנהל פותחים לקוח עסקי חדש; הפיכת לקוח קיים / ביטול – מנהל (נבדק בשרת).
   - מסכים: V.ocList (לקוחות), V.ocCard (כרטיס לקוח + היסטוריית הזמנות), ייבוא Excel/CSV עם התאמת עמודות, שדות חופשיים (מנהל).
   - סיטונאי (22:10): ברירת מחדל רגיל; רק מנהל מסמן, בכרטיס הלקוח. הייבוא מתעלם. בטיוטת ההזמנה: draft.wholesale (לשימוש ענף הקטלוג).
   - אשראי: fb/ord-card – מספר מלא/תוקף/שם/CVV מוצפנים בשרת (customers.js setCard/getCard/delCard); בלקוח נשמרות 4 ספרות + card:true.
   - אשראי (22:04, לעמודות שלא סומנו כ'מספר כרטיס מלא'): רק 4 ספרות. עמודת מספר כרטיס מלא בייבוא נחתכת כאן ל-4 האחרונות לפני השליחה (והשרת חותך שוב).
   כל כתיבה – דרך השרת (functions/customers.js). קריאה – cust, custcfg לפי החוקים. */
(function(){
'use strict';
if(typeof ACT==='undefined'||typeof V==='undefined'||!window.__ox)return;
const fnCall=(n,d)=>{d=d&&typeof d==='object'?d:{};if(SY&&SY.sa&&SY.bizId&&!('bizId'in d))d=Object.assign({bizId:SY.bizId},d);return window.fnCall(n,d)}; // 2026-11-09 (Dפון): מנהל־על שנכנס לעסק – הפונקציות רצות בעסק שנבחר ולא בעסק הבית שלו
const O=window.__ox;
const C={L:null,cfg:null,busy:0,at:0,q:'',hit:{},imp:null};
const on=()=>(isA()||isW()||!!(SY&&SY.sa))&&bzF('orders')&&wp('ord');
/* 00:24: ניודים – רק כשמנהל־העל הפעיל את cellular בעסק (גם בעסק הישן – ברירת מחדל כבוי). כבוי = מוסתר, הנתונים נשארים */
const cell=()=>{const b=SY&&SY.biz;return !!(b&&b.features&&b.features.cellular===true)&&bzF('cellular')};
const mgr=()=>isA()||!!(SY&&SY.sa);window.ocImpOk=()=>(isA()||isW()||!!(SY&&SY.sa))&&bzF('orders')&&wp('ord')&&mgr();
const dec=d=>Object.assign({id:idOf(d)},Object.fromEntries(Object.entries(d.fields||{}).map(([k,v])=>[k,fvj(v)])));
const rid=()=>{const a=new Uint8Array(12);crypto.getRandomValues(a);return 'r'+[...a].map(x=>x.toString(36).padStart(2,'0')).join('').slice(0,22)};
const err=e=>toast(e&&e.message||'הפעולה נכשלה');
const dig=v=>String(v==null?'':v).replace(/\D/g,'');
const tzN=v=>{const t=dig(v);return t.length>=5&&t.length<=9?t.padStart(9,'0'):''};
function tzOk(z){if(!/^\d{9}$/.test(z)||z==='000000000')return false;let s=0;for(let i=0;i<9;i++){let d=+z[i]*((i%2)+1);if(d>9)d-=9;s+=d}return s%10===0}
function phN(v){let p=String(v==null?'':v).trim().replace(/[\s-]/g,'');if(/^\+?972\d{8,9}$/.test(p))p='0'+p.replace(/^\+?972/,'');if(/^5\d{8}$/.test(p))p='0'+p;return /^0(5\d{8}|7\d{8}|[23489]\d{7})$/.test(p)?p:''}
// 4 ספרות: 4 ספרות בדיוק נשארות; 13–19 ספרות (מספר כרטיס) → 4 אחרונות; אחר → ''+סימון שגיאה
const digs=v=>{const s=String(v==null?'':v);return /\p{L}/u.test(s)?s:s.replace(/\D/g,'')};
const CARD8={test:v=>String(v==null?'':v).split(/\p{L}+/u).some(p=>p.replace(/\D/g,'').length>=8)}; // כל תו שאינו אות (פיסוק, מקפים –—־, =, !, U+200F, U+200B…) נחשב מפריד; אות מפרידה בין רצפים
/* 2026-11-10 (ייבוא לקוחות מלא): מספר כרטיס אפשרי = קבוצות ספרות (מופרדות בתו שאינו אות) שסכום אורכן 13–19 – זהה לשרת (orders.js cardAt).
   משמש במייל ובשדות המידע החדשים: טלפונים בהערות/במייל מותרים, מספר כרטיס – נחסם בטופס ומוסתר בייבוא */
// luhn=true (רק בטלפון/ת"ז לא תקינים): רק רצף שעובר בדיקת ספרת ביקורת של כרטיס – כך שני טלפונים מודבקים (19 ספרות) נשמרים כמו שהם
const luhn=d=>{let t=0;for(let i=0;i<d.length;i++){let x=+d[d.length-1-i];if(i%2){x*=2;if(x>9)x-=9}t+=x}return t%10===0};
function cardAt(v,lu){const s=String(v==null?'':v),G=[],re=/\d+/g;let m;while((m=re.exec(s)))G.push([m.index,m.index+m[0].length]);
 for(let i=0;i<G.length;i++){let n=0,d='';for(let j=i;j<G.length;j++){if(j>i&&(/\p{L}/u.test(s.slice(G[j-1][1],G[j][0]))||lu&&G[j][0]-G[j-1][1]>2))break;if(lu&&j>i&&[i,j].some(q=>G[q][1]-G[q][0]<3||G[q][1]-G[q][0]>6))break;n+=G[j][1]-G[j][0];d+=s.slice(G[j][0],G[j][1]);if(n>19)break;if(n>=13&&(!lu||luhn(d)))return [G[i][0],G[j][1]]}}return null}
const cardLike=(v,lu)=>!!cardAt(v,lu); // lu: שדות המידע וערכים לא תקינים – רק רצף שעובר ספרת ביקורת (טלפונים בהערות נשמרים); מייל – כל רצף 13–19
// הסתרה: הרצף מוחלף ב"(כרטיס 1234 הוסתר)" – אותיות משני הצדדים, כך שהרצף לא מתחבר שוב לספרות שליד
function maskCard(v,lu){let s=String(v==null?'':v),n=0;for(let g=0;g<30;g++){const r=cardAt(s,lu);if(!r)break;const d=s.slice(r[0],r[1]).replace(/\D/g,'');s=s.slice(0,r[0])+'(כרטיס '+d.slice(-4)+' הוסתר)'+s.slice(r[1]);n++}return {s,n}}
/* שדות מידע (רק בעסק עם cellular), סימון "לא תקין" (bph/btz/bml – הערך המקורי, לא משמש לאיחוד), חברת ניוד ונויד בפועל בכל קו */
const INF=[['bank','פרטי בנק',300],['prod','מוצר',300],['due','לתשלום',200],['orig','מקור',100],['stat','סטטוס',200],['note','הערות',1000],['od','תאריך הזמנה',100]];
const INFK=INF.map(x=>x[0]);
const PACT=[['y','כן'],['n','לא'],['u','לא ידוע']];
const actTxt=a=>(PACT.find(x=>x[0]===a)||[])[1]||'';
const actOf=v=>{const s=String(v==null?'':v).trim().toLowerCase();return !s?'':/^(כן|yes|y|true|1|v|נויד)$/.test(s)?'y':/^(לא|no|n|false|0|x|לא נויד)$/.test(s)?'n':'u'};
const RED=t=>`<b style="color:var(--bad)">${t}</b>`;
const BADT=RED('(לא תקין)');
const badOf=c=>!c?[]:[c.bph?'טלפון':'',c.btz?'ת.ז':'',c.bml?'מייל':''].filter(Boolean).concat((Array.isArray(c.ports)?c.ports:[]).some(p=>p&&(p.bph||p.btz))?['פרטי ניוד']:[]);
const badTag=c=>{const b=badOf(c);return b.length?' '+RED('לא תקין: '+esc(b.join(', '))):''};
function l4(v){const d=digs(v);if(!d)return {v:''};if(/^\d{4}$/.test(d))return {v:d};if(/^\d{13,19}$/.test(d))return {v:d.slice(-4),cut:1};return {v:'',bad:1}}
/* 00:19: שדות נפרדים. לקוח ישן (שם/כתובת בשדה אחד) – השם הישן מוצג בשם הפרטי והכתובת ברחוב, כהצעה בלבד; הרשומה לא משתנה עד שמירה */
const NP=['fn','ln'],AP=['st','city','fl','apt'],CPK=NP.concat(AP);
function splitOld(c,D){const e=k=>!String(D[k]||'').trim();
 if(NP.every(e)){if(c.fn||c.ln){D.fn=c.fn||'';D.ln=c.ln||''}else if(c.name){if(String(c.name).length<=30)D.fn=String(c.name);else D.name=String(c.name)}}
 if(AP.every(e)){if(AP.some(k=>c[k]))AP.forEach(k=>D[k]=c[k]||'');else if(c.addr){if(String(c.addr).length<=80)D.st=String(c.addr);else D.addr=String(c.addr)}}return D}
// ערך ישן ארוך ממגבלת השדה החדש (שם>30, כתובת>80) נשאר בשדה המלא הישן בלבד – לא חוסם שמירה
const joinC=o=>(window.__custJoin?window.__custJoin(o):o);
/* 00:21: ניודים קודמים – ports:[{d?,phone?,tz?}] בלקוח. port הישן (תאריך בלבד) מוצג כרשומה */
const portsOf=c=>{const L=Array.isArray(c&&c.ports)?c.ports.slice():[];if(c&&c.port&&!Array.isArray(c.ports)&&!L.some(p=>p.d===c.port))L.unshift({d:c.port});return L};
const xKeys=()=>(C.cfg&&Array.isArray(C.cfg.xKeys)?C.cfg.xKeys:[]).filter(x=>x&&x.k);

/* ---------- קריאה ---------- */
async function getC(id){try{const d=await fsx('/cust/'+id);return d?dec(d):null}catch(e){if(e.code===404)return null;throw e}}
async function byTz(z){let c=await getC('t'+z);return c}
// כל הלקוחות עם הטלפון (p{phone} ישן + לקוחות נוספים c… / t… עם אותו טלפון). בלי מסמכים שהועברו (mv)
async function byPhoneAll(p){const out=[],seen=new Set(),add=c=>{if(c&&!c.mv&&!seen.has(c.id)){seen.add(c.id);out.push(c)}};let c=await getC('p'+p);if(c&&c.mv)c=await getC(c.mv);add(c);
 const r=await fsx(':runQuery',{method:'POST',body:JSON.stringify({structuredQuery:{from:[{collectionId:'cust'}],where:{fieldFilter:{field:{fieldPath:'phone'},op:'EQUAL',value:{stringValue:p}}},limit:10}})});
 (r||[]).filter(x=>x.document).map(x=>dec(x.document)).filter(x=>x.phone===p).forEach(add);
 // 2026-11-10: גם לקוחות שהטלפון שמור אצלם כטלפון נוסף (phs) – שאילתה בשרת, לא סינון ברשימה שבטלפון
 const r2=await fsx(':runQuery',{method:'POST',body:JSON.stringify({structuredQuery:{from:[{collectionId:'cust'}],where:{fieldFilter:{field:{fieldPath:'phs'},op:'ARRAY_CONTAINS',value:{stringValue:p}}},limit:10}})});
 (r2||[]).filter(x=>x.document).map(x=>dec(x.document)).filter(x=>Array.isArray(x.phs)&&x.phs.includes(p)).forEach(add);return out}
const phsOf=c=>Array.isArray(c&&c.phs)?c.phs:[];
const allPh=c=>[c&&c.phone].concat(phsOf(c)).filter(Boolean);
const PAYS=[['cash','מזומן'],['n30','שוטף+30'],['n60','שוטף+60'],['n90','שוטף+90'],['credit','אשראי'],['transfer','העברה בנקאית'],['other','אחר']];
const payTxt=c=>c.pay==='other'?String(c.payTxt||'אחר'):((PAYS.find(x=>x[0]===c.pay)||[])[1]||'');
const WSTAG='<span class="tag t1">לקוח עסקי</span>';
const cLabel=c=>esc(c.name||c.bn||'')+(c.wholesale===true?' '+WSTAG:'');
async function cfgLoad(){try{const d=await fsx('/custcfg/main');C.cfg=d?dec(d):{}}catch(e){C.cfg={}}}
async function loadL(force){if(C.busy||(!force&&C.L&&Date.now()-C.at<20000))return;C.busy=1;
 try{const r=await fsx(':runQuery',{method:'POST',body:JSON.stringify({structuredQuery:{from:[{collectionId:'cust'}],limit:3000}})});
  C.L=(r||[]).filter(x=>x.document).map(x=>dec(x.document)).filter(x=>!x.mv).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'he'));C.at=Date.now();if(!C.cfg)await cfgLoad()}
 catch(e){C.err=e.message||'הטעינה נכשלה';C.L=C.L||[]}finally{C.busy=0;if(/^oc/.test(cur().v))rerender()}}
const typing=()=>{const a=document.activeElement;return !!(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)&&a.closest('#main'))};

/* ---------- הזמנה חדשה: ת"ז ראשונה ---------- */
/* סבב 3: פרטי לקוח שנטענו מהמערכת (כולל שם/כתובת ישנים ארוכים שאין להם שדה גלוי) נמחקים כשמחליפים לקוח – הזמנה ללקוח אחר לא יורשת אותם */
const LDK=['name','addr'].concat(CPK,INFK);
function dropLoaded(D){const F=D.cFrom||{};LDK.concat(['phone','mail'].filter(k=>F[k]&&String(D[k]||'').trim()===F[k])).forEach(k=>{D[k]='';document.querySelectorAll('#main input[data-i=oxD][data-k='+k+']').forEach(e=>{e.value=''})});D.cName='';D.cFrom=null;D.cInf=null;D.cBad=null;const ws=D.wholesale===true;D.wholesale=false;if(ws&&window.__oxRedraw)window.__oxRedraw()} // 12.11.2026: סיטונאי ירד – שורות "קרטון" חוזרות לרגילות
function fillDraft(D,c){if(D.custId&&D.custId!==c.id)dropLoaded(D);D.name='';D.addr='';splitOld(c,D);['phone','mail'].forEach(k=>{if(c[k]&&!String(D[k]||'').trim())D[k]=String(c[k])});D.cFrom={phone:String(c.phone||''),mail:String(c.mail||''),tz:String(c.tz||''),all:allPh(c)};D.tz=c.tz||D.tz;D.custId=c.id;D.wholesale=c.wholesale===true;D.cName=c.name||'';
 D.cBad=badOf(c);D.cInf={};INFK.forEach(k=>{D.cInf[k]=String(c[k]||'');if(cell()&&c[k]&&!String(D[k]||'').trim())D[k]=String(c[k])})} // 2026-11-10: שדות המידע של הלקוח נטענים לטופס (עריכה – נשמרת ללקוח)
const NEWB='<button type="button" class="btn g s w" data-a="ocAsNew">לקוח חדש עם אותו טלפון</button>';
const custBox=D=>{const st=D.cSt,w=h=>`<div role="status" id="ocst">${h}</div>`;
 if(st==='found')return w(`<p class="note">לקוח קיים: <b>${esc(D.cName)}</b>${D.wholesale?' '+WSTAG:''} – הפרטים מולאו. פרטים שתוסיפו (כמו כתובת) יצורפו ללקוח.</p>${D.cBad&&D.cBad.length?`<p class="note" data-bad="1">${RED('שימו לב – פרט לא תקין אצל הלקוח: '+esc(D.cBad.join(', ')))}</p>`:''}${NEWB}`);
 if(st==='hits')return w(`<p class="note">לטלפון הזה כבר יש ${(D.cHits||[]).length>1?(D.cHits||[]).length+' לקוחות':'לקוח'}. בחרו:</p>${(D.cHits||[]).map(c=>`<button type="button" class="li" data-a="ocPick" data-id="${esc(c.id)}"><div class="m"><b>${cLabel(c)}</b>${badTag(c)}<small>${esc(c.addr||'')}</small></div>${ico('chev','chev')}</button>`).join('')}${NEWB}`);
 if(st==='asnew')return w(`<p class="note">לקוח חדש עם טלפון קיים – יישמר כלקוח נפרד.</p><button type="button" class="btn g s w" data-a="ocPhAgain">חזרה ללקוחות הקיימים</button>`);
 return w(st==='new'?'<p class="note">לקוח חדש – ממלאים שם פרטי ושם משפחה, והלקוח יישמר עם ההזמנה</p>':st==='bad'?'<p class="note">ת.ז לא תקינה</p>':st==='wait'?'<p class="note">מחפש…</p>':'')};
const tzVis=D=>cell()||!!dig(D.tz); // 2026-11-09: עסק עם ניוד קווים – שדה ת"ז (רשות) כבר בתחילת ההזמנה
{const nw=V.oxNew;if(nw)V.oxNew=()=>{const r=nw();if(!r||!r.h||!on())return r;const D=O.draft;if(!D)return r;
  if(!C.cfg)cfgLoad();
  // ניוד קווים (orders-lines.js, נטען אחרי הקובץ הזה): סימון/ביטול ניוד מצייר מחדש, כדי ששדה הת"ז יופיע/ייעלם
  if(typeof CHG!=='undefined'&&CHG.olOn&&!CHG.olOn.__oc){const f=CHG.olOn;CHG.olOn=el=>{f(el);rerender()};CHG.olOn.__oc=1}
  let h=r.h.replace(/<label class="f"><span>ת\.ז<\/span><input data-i="oxD" data-k="tz"[^>]*><\/label>/,'');
  const ad=AP.some(k=>String(D[k]||'').trim())||String(D.mail||'').trim();
  h=h.replace(/<details><summary([^>]*)>ת\.ז, כתובת ומייל \(רשות\)<\/summary>/,`<details${ad?' open':''}><summary$1>משלוח – כתובת, עיר, קומה ודירה (רשות)</summary>`);
  const ph=/<label class="f"><span>טלפון<\/span><input data-i="oxD" data-k="phone"[^>]*><\/label>/.exec(h);
  if(ph){h=h.replace(ph[0],'');h=h.replace('<div class="card">','<div class="card">'+ph[0].replace('<span>טלפון</span>','<span>טלפון הלקוח (מקלידים קודם – לקוח קיים יימצא לבד)</span>')+custBox(D)+p2H(D)+(tzVis(D)?`<label class="f"><span>ת.ז הלקוח (רשות)</span><input data-i="ocTz" data-k="tz" inputmode="numeric" maxlength="9" autocomplete="off" value="${esc(D.tz||'')}" id="octz"></label>`:''))}
  if(cell()){const ih=`<details${INFK.some(k=>String(D[k]||'').trim())?' open':''}><summary>פרטים נוספים ללקוח (רשות)</summary>${INF.map(([k,l,mx])=>`<label class="f"><span>${l}</span><input data-i="oxD" data-k="${k}" maxlength="${mx}" autocomplete="off" value="${esc(D[k]||'')}"${k==='bank'?' dir="auto"':''}></label>`).join('')}</details>`;
   const am=/<details[^>]*><summary[^>]*>משלוח[\s\S]*?<\/details>/.exec(h);h=am?h.replace(am[0],am[0]+ih):h.replace('<div class="card">','<div class="card">'+ih)}
  if(ocOn()){if(CD.d!==D)cdReset(D);const c=D.custId&&(C.L||[]).find(x=>x.id===D.custId),full=!!c&&cardsOf(c).length>=3;
   const ch=`<details${CD.num?' open':''} id="occd"><summary>כרטיס אשראי (רשות)</summary>${full?'<p class="note">ללקוח כבר שמורים 3 כרטיסים – אפשר להחליף או למחוק בכרטיס הלקוח.</p>':`<p class="note">נשמר מוצפן ללקוח ההזמנה כשהיא נשמרת. נשארות גלויות רק 4 ספרות אחרונות.</p>
    ${CDF.map(([k,l,x])=>`<label class="f"><span>${l}</span><input data-i="ocCd" data-k="${k}" autocomplete="off" ${x} value="${esc(CD[k]||'')}"></label>`).join('')}${cdMore(c)}`}</details>`;
   const am=/<details[^>]*><summary[^>]*>(פרטים נוספים ללקוח|משלוח)[\s\S]*?<\/details>/.exec(h);h=am?h.replace(am[0],am[0]+ch):h.replace('<div class="card">','<div class="card">'+ch)}
  r.h=h;r.s='טלפון, פרטי לקוח ומוצרים';return r}}
/* תוספת 11:50: כרטיס אשראי בטופס ההזמנה (רשות). מתג ordCard לעסק – ברירת מחדל פעיל, רק מנהל־על מכבה (השרת אוכף).
   הערכים נשמרים רק במשתנה מקומי של הטיוטה (לא ב-O.draft, לא באחסון), נשלחים ל-setCard {add, ordId} אחרי שההזמנה נשמרה, ונמחקים. */
const ocOn=()=>!(SY&&SY.biz&&SY.biz.features&&SY.biz.features.ordCard===false);
let CD={};const cdReset=D=>{CD={d:D,more:[]}};
const CDF=[['num','מספר כרטיס','inputmode="numeric" maxlength="23" dir="ltr"'],['exp','תוקף (MM/YY)','inputmode="numeric" maxlength="7" dir="ltr"'],['name','שם בעל הכרטיס','maxlength="60"'],['cvv','CVV','inputmode="numeric" maxlength="4" dir="ltr"']];
/* 2026-11-10 (סעיף 2): עסק עם ניוד – "+" מוסיף משבצת כרטיס נוספת (עד 3 כרטיסים ללקוח בסה"כ, כולל השמורים). כפוף למתג ordCard */
const cdMore=c=>{if(!cell())return '';const M=CD.more||[],room=3-(c?cardsOf(c).length:0)-1-M.length;
 return M.map((m,i)=>`<div class="card" style="margin:8px 0"><div class="row" style="justify-content:space-between;align-items:center"><b>כרטיס נוסף ${i+2}</b><button type="button" class="btn g s" data-a="ocCdX" data-n="${i}">הסר</button></div>${CDF.map(([k,l,x])=>`<label class="f"><span>${l}</span><input data-i="ocCdM" data-n="${i}" data-k="${k}" autocomplete="off" ${x} value="${esc(m[k]||'')}"></label>`).join('')}</div>`).join('')
  +(room>0?'<button type="button" class="btn g s w" data-a="ocCdAdd">＋ כרטיס אשראי נוסף</button>':'')};
ACT.ocCdAdd=()=>{const D=O.draft;if(!D)return;if(CD.d!==D)cdReset(D);CD.more.push({});rerender();setTimeout(()=>{const d=document.getElementById('occd');if(d)d.open=true},0)};
ACT.ocCdX=el=>{CD.more&&CD.more.splice(+el.dataset.n,1);rerender();setTimeout(()=>{const d=document.getElementById('occd');if(d)d.open=true},0)};
INP.ocCdM=el=>{const m=(CD.more||[])[+el.dataset.n];if(m)m[el.dataset.k]=el.value};
const cdOut=(o,lb)=>{if(!['num','exp','name','cvv'].some(k=>String(o[k]||'').trim()))return null;const n=String(o.num||'').replace(/[\s-]/g,'');if(!/^\d{13,19}$/.test(n))throw new Error(lb+'מספר כרטיס: 13 עד 19 ספרות');
 const card={num:n},e=String(o.exp||'').trim(),v=String(o.cvv||'').trim(),nm=String(o.name||'').trim();if(e){const t=CEXP(e);if(!t)throw new Error(lb+'תוקף: חודש/שנה (MM/YY)');card.exp=t}if(v){if(!/^\d{3,4}$/.test(v))throw new Error(lb+'קוד אבטחה: 3 או 4 ספרות');card.cvv=v}if(nm){if(!CNAME(nm))throw new Error(lb+'שם בעל הכרטיס: עד 60 תווים, בלי מספרים');card.name=nm}return card};
INP.ocCd=el=>{const D=O.draft;if(!D)return;if(CD.d!==D)cdReset(D);CD[el.dataset.k]=el.value};
// טלפון בהזמנה: טלפון תקין → חיפוש הלקוחות שלו. שינוי טלפון אחרי בחירת לקוח – מנתק את הקישור (הפרטים שהוקלדו נשארים)
const phSearch=D=>{const p=phN(D.phone);if(D.custId&&(!D.cFrom||(D.cFrom.phone!==p&&!(D.cFrom.all||[]).includes(p)&&D.cBy!=='p2'))){const ph=D.phone,tz=D.cFrom&&D.cFrom.tz;if(tz&&dig(D.tz)===tz)D.tz='';dropLoaded(D);D.phone=ph;D.custId=''}
 if(D.custId)return;D.asNew=false;D.cHits=null;if(!p){D.cSt='';paintSt(D);return}
 D.cSt='wait';paintSt(D);const my=D.phSeq=(D.phSeq||0)+1;
 byPhoneAll(p).then(L=>{if(O.draft!==D||D.phSeq!==my||D.custId)return;if(L.length){D.cHits=L;D.cSt='hits'}else D.cSt='new';paintSt(D)}).catch(e=>{D.cSt='';paintSt(D);err(e)})};
{const f=INP.oxD;if(f)INP.oxD=el=>{f(el);const D=O.draft;if(D&&on()&&el.dataset.k==='phone')phSearch(D)}}
ACT.ocPick=el=>{const D=O.draft;if(!D)return;const c=(D.cHits||[]).find(x=>x.id===el.dataset.id);if(!c)return;fillDraft(D,c);D.cBy='ph';D.asNew=false;D.cSt='found';rerender()};
ACT.ocAsNew=()=>{const D=O.draft;if(!D)return;const ph=D.phone;if(D.custId)dropLoaded(D);D.phone=ph;D.custId='';D.asNew=true;D.cSt='asnew';rerender()};
ACT.ocPhAgain=()=>{const D=O.draft;if(!D)return;D.asNew=false;phSearch(D)};
INP.ocTz=el=>{const D=O.draft;if(!D)return;const t=dig(el.value);D.tz=t;if(D.custId&&D.cBy==='tz'){D.custId='';D.cSt='';dropLoaded(D)}if(D.custId)return; // לקוח שנבחר לפי טלפון – הת"ז רק נוספת לו
 if(t.length<9){D.cSt='';paintSt(D);return}const z=t.padStart(9,'0');if(!tzOk(z)){D.cSt='bad';paintSt(D);return}
 D.cSt='wait';paintSt(D);const my=z;byTz(z).then(c=>{if(O.draft!==D||dig(D.tz).padStart(9,'0')!==my)return;if(c){fillDraft(D,c);D.cBy='tz';D.cSt='found';rerender()}else{D.cSt='new';paintSt(D)}}).catch(e=>{D.cSt='';paintSt(D);err(e)})};
const paintSt=D=>{const s=document.getElementById('ocst');if(s)s.outerHTML=custBox(D)};
/* 2026-11-10: טלפון נוסף בהזמנה (כל העסקים, עד 3). מספר תקין → חיפוש בשרת (byPhoneAll: phone וגם phs).
   אין לקוח מקושר – הלקוחות שנמצאו מוצגים לבחירה. יש לקוח מקושר והמספר שייך ללקוח אחר – שואלים (שינוי 13:16): לאחד את שני הכרטיסים (mergeCust בשרת),
   או לבחור לאיזה מהם לשייך את ההזמנה. בשמירה הטלפונים הנוספים נשמרים בהזמנה ומצטרפים ללקוח (phs). */
const MAXP=3;
const p2St=D=>{const x=D.p2c;if(!x)return '<div id="ocp2st"></div>';const cur=(C.L||[]).find(c=>c.id===D.custId);
 return `<div id="ocp2st" role="status" class="card" style="margin:6px 0;border-color:var(--acc)"><p class="note" style="margin:0 0 6px">הטלפון הנוסף <bdi dir="ltr">${esc(x.p)}</bdi> שייך ללקוח אחר. מה לעשות?</p>
 ${x.L.map(c=>`<div style="margin:4px 0"><b>${cLabel(c)}</b>${badTag(c)}<div class="row" style="margin-top:4px"><button type="button" class="btn s grow" data-a="ocMerge" data-id="${esc(c.id)}">לאחד את שני הכרטיסים</button><button type="button" class="btn g s grow" data-a="ocUseB" data-id="${esc(c.id)}">לשייך ל${esc(c.name||c.bn||'לקוח הזה')}</button></div></div>`).join('')}
 <button type="button" class="btn g s w" data-a="ocKeepA">לשייך ל${esc(D.cName||(cur&&cur.name)||'לקוח הנוכחי')} (הנוכחי)</button></div>`};
const p2H=D=>{const L=D.phs||[];return `<div id="ocp2">${L.map((v,i)=>`<div class="row" style="align-items:flex-end"><label class="f grow"><span>טלפון נוסף ${L.length>1?i+1:''}</span><input data-i="ocP2" data-n="${i}" type="tel" inputmode="tel" autocomplete="off" dir="ltr" value="${esc(v)}"></label><button type="button" class="btn g s" data-a="ocP2X" data-n="${i}" aria-label="הסר טלפון נוסף">הסר</button></div>`).join('')}
 ${L.length<MAXP?'<button type="button" class="btn g s w" data-a="ocP2Add">＋ טלפון נוסף</button>':''}${p2St(D)}</div>`};
const p2Paint=D=>{const s=document.getElementById('ocp2st');if(s)s.outerHTML=p2St(D)};
ACT.ocP2Add=()=>{const D=O.draft;if(!D)return;D.phs=(D.phs||[]).concat(['']).slice(0,MAXP);rerender()};
ACT.ocP2X=el=>{const D=O.draft;if(!D||!D.phs)return;const v=phN(D.phs[+el.dataset.n]);D.phs.splice(+el.dataset.n,1);if(D.p2c&&D.p2c.p===v)D.p2c=null;rerender()};
INP.ocP2=el=>{const D=O.draft;if(!D||!D.phs)return;D.phs[+el.dataset.n]=el.value;const p=phN(el.value);
 if(D.p2c&&!D.phs.some(v=>phN(v)===D.p2c.p)){D.p2c=null;p2Paint(D)}
 if(!p||p===phN(D.phone))return;const my=D.p2Seq=(D.p2Seq||0)+1;
 byPhoneAll(p).then(L=>{if(O.draft!==D||D.p2Seq!==my)return;const o=L.filter(c=>c.id!==D.custId);if(!o.length)return;
  if(!D.custId){D.cHits=o;D.cSt='hits';D.cVia=p;paintSt(D);return}
  D.p2c={p,L:o};p2Paint(D)}).catch(err)};
const relink=(D,c)=>{const ph=D.phone;fillDraft(D,c);D.phone=ph;D.cBy='p2';D.asNew=false;D.cSt='found';D.p2c=null;rerender()};
ACT.ocKeepA=()=>{const D=O.draft;if(!D)return;D.p2c=null;rerender()};
ACT.ocUseB=el=>{const D=O.draft;if(!D||!D.p2c)return;const c=D.p2c.L.find(x=>x.id===el.dataset.id);if(c)relink(D,c)};
/* תיקון 17:23: העובד בוחר איזה משני הלקוחות נשאר (שם/טלפון/ת"ז של כל אחד). השרת מאמת שהבחירה היא אחד מהשניים (keep). */
const mgCard=(c,k)=>`<button type="button" class="btn g w" style="text-align:right;margin-bottom:8px;white-space:normal" data-a="ocMergeK" data-k="${esc(k)}"><b>להשאיר את: ${cLabel(c)}</b><br>טלפון: <bdi dir="ltr">${esc(c.phone||'—')}</bdi> · ת"ז: <bdi dir="ltr">${esc(c.tz||'—')}</bdi></button>`;
ACT.ocMerge=el=>{const D=O.draft;if(!D||!D.p2c||!D.custId)return;const c=D.p2c.L.find(x=>x.id===el.dataset.id);if(!c)return;
 const cur=(C.L||[]).find(x=>x.id===D.custId)||{};const a={name:D.cName||cur.name,bn:cur.bn,wholesale:cur.wholesale,phone:D.phone||cur.phone,tz:D.tz||cur.tz};
 D.p2m={a:D.custId,b:c.id};
 dlg(`<h3>איחוד לקוחות – איזה לקוח נשאר?</h3><p class="note">הפרטים של הלקוח שתבחרו נשארים. מהלקוח השני מצטרפים הטלפונים, השדות הריקים, הניודים, הכרטיסים וההזמנות.</p>${mgCard(a,D.custId)}${mgCard(c,c.id)}<button type="button" class="btn g w" data-a="closeDlg">ביטול</button>`)};
ACT.ocMergeK=async el=>{const D=O.draft,m=D&&D.p2m;if(!m||![m.a,m.b].includes(el.dataset.k))return;closeDlg();D.p2m=null;
 try{const r=await fnCall('mergeCust',{a:m.a,b:m.b,keep:el.dataset.k});const n=await getC(r.id);C.at=0;loadL(true);if(n)relink(D,n);else{D.p2c=null;rerender()}toast('הלקוחות אוחדו')}catch(e){err(e)}};
// שמירת הזמנה → קודם הלקוח (fill: רק שדות ריקים; id = הלקוח שנבחר; asNew = לקוח נוסף עם אותו טלפון). כשל בשמירת הלקוח לא עוצר את ההזמנה.
// לקוח חדש שנשמר – ההזמנה מקושרת אליו (custId)
{const sv=ACT.oxSave;if(sv)ACT.oxSave=async el=>{const D=O.draft;if(D)joinC(D);
  // סבב 1 (ליקוי 1): לקוח חדש (לא נבחר מהרשימה) – שם פרטי ושם משפחה, כל אחד בנפרד
  if(D&&on()&&!D.custId){if(!String(D.fn||'').trim())return toast('חסר שם פרטי');if(!String(D.ln||'').trim())return toast('חסר שם משפחה')}
  if(D&&on()){if(D.p2c)return toast('בחרו מה לעשות עם הטלפון הנוסף ששייך ללקוח אחר');const xs=[];for(const v of D.phs||[]){if(!String(v||'').trim())continue;const p=phN(v);if(!p)return toast('טלפון נוסף לא תקין');if(!xs.includes(p))xs.push(p)}D.phs=xs}
  if(D&&on()&&cell()){const b=INF.find(([k])=>k!=='bank'&&cardLike(D[k],1));if(b)return toast(b[1]+': אסור להקליד מספר כרטיס אשראי')}
  // כרטיס מהטופס: בדיקה לפני שמירה (השרת בודק שוב)
  let cards=[];if(D&&on()&&ocOn()&&CD.d===D){try{const a=cdOut(CD,'');if(a)cards.push(a);(cell()?CD.more||[]:[]).forEach((m,i)=>{const x=cdOut(m,'כרטיס נוסף '+(i+2)+': ');if(x)cards.push(x)})}catch(e){return toast(e.message)}
   if(cards.some((x,i)=>cards.findIndex(y=>y.num===x.num)!==i))return toast('אותו מספר כרטיס הוקלד פעמיים');
   const c=D.custId&&(C.L||[]).find(x=>x.id===D.custId);if(cards.length&&(c?cardsOf(c).length:0)+cards.length>3)return toast(c&&cardsOf(c).length>=3?'ללקוח כבר שמורים 3 כרטיסים':'עד 3 כרטיסים ללקוח (כולל השמורים)')}
  if(D&&on()){const tz=dig(D.tz);if(tz&&!tzOk(tz.padStart(9,'0')))return toast('ת.ז לא תקינה');
   const p=phN(D.phone);if(p&&String(D.name||'').trim()&&D.items&&D.items.length){const c={};if(!NP.some(k=>String(D[k]||'').trim()))c.name=D.name.trim();c.phone=p;if(tz)c.tz=tz;
    // 2026-11-10: הלקוח נמצא לפי טלפון נוסף – הטלפון הראשי שלו לא משתנה, והמספר שהוקלד מצטרף לטלפונים הנוספים
    const xp=(D.phs||[]).slice();if(D.custId&&D.cFrom&&D.cFrom.phone&&D.cFrom.phone!==p){c.phone=D.cFrom.phone;xp.unshift(p)}{const q=xp.filter((x,i)=>x!==c.phone&&xp.indexOf(x)===i).slice(0,3);if(q.length)c.phs=q}if(D.mail)c.mail=D.mail.trim();CPK.forEach(k=>{const v=String(D[k]||'').trim();if(v)c[k]=v});if(D.addr&&!AP.some(k=>c[k]))c.addr=D.addr.trim();
    // 2026-11-10: שדות מידע – לקוח חדש: עם הלקוח; לקוח קיים: רק מה ששונה, כעריכה (לא רק שדות ריקים)
    const ch={};if(cell())INFK.forEach(k=>{const v=String(D[k]||'').trim();if(D.custId){if(D.cInf&&v!==String(D.cInf[k]||'').trim())ch[k]=v}else if(v)c[k]=v});
    const a={fill:true,cust:c};if(D.custId)a.id=D.custId;else if(D.asNew)a.asNew=true;
    try{const r=await fnCall('saveCust',a);C.at=0;if(!D.custId&&r&&r.id){D.custId=r.id;D.asNew=false}
     if(D.custId&&Object.keys(ch).length&&a.id){await fnCall('saveCust',{id:D.custId,cust:ch});D.cInf=Object.assign({},D.cInf,ch)}}catch(e){toast('ההזמנה נשמרת, אבל פרטי הלקוח לא נשמרו: '+(e.message||''))}}}
  const r=await sv(el);
  if(cards.length&&D){const cid=D.custId;cdReset(null);if(r&&r.id){if(!cid)setTimeout(()=>toast('ההזמנה נשמרה, אבל הכרטיס לא נשמר: אין לקוח מקושר'),3000);
   else{const ok=[],bad=[];for(const card of cards){try{const x=await fnCall('setCard',{custId:cid,card,ordId:r.id,add:true});ok.push('****'+(x&&x.last4||''))}catch(e){bad.push(e.message||'')}}
    setTimeout(()=>toast(bad.length?'ההזמנה נשמרה, אבל '+(ok.length?'חלק מהכרטיסים':'הכרטיס')+' לא נשמר: '+bad[0]:(ok.length>1?'הכרטיסים ':'הכרטיס ')+ok.join(', ')+' נשמר מוצפן ללקוח'),3000);C.at=0;loadL(true)}}}
  cards=[];return r}}

/* ---------- כניסה: כפתור "לקוחות" במסך ההזמנות ---------- */
{const ox=V.ox;if(ox)V.ox=()=>{const r=ox();if(on()&&r&&r.h&&r.h.includes('data-v="oxStock"'))r.h=r.h.replace(/(<button class="btn g grow" data-a="go" data-v="oxStock">מלאי<\/button>)/,'$1<button class="btn g grow" data-a="go" data-v="ocList">לקוחות</button>');return r}}

/* ---------- רשימת לקוחות ---------- */
const crow=c=>`<button class="li" data-a="go" data-v="ocCard" data-arg="${esc(c.id)}"><div class="m"><b>${cLabel(c)}</b>${badTag(c)}<small dir="ltr" style="text-align:right">${esc(c.phone||c.bph||'')}${c.tz||c.btz?' · '+esc(c.tz||c.btz):''}</small></div>${ico('chev','chev')}</button>`;
const match=(c,q)=>!q||String(c.name||'').includes(q)||String(c.bn||'').includes(q)||String(c.phone||'').includes(dig(q)||'\u0000')||phsOf(c).some(p=>p.includes(dig(q)||'\u0000'))||String(c.tz||'').includes(dig(q)||'\u0000')||dig(c.bph).includes(dig(q)||'\u0000')||dig(c.btz).includes(dig(q)||'\u0000');
const listH=()=>{const L=(C.L||[]).filter(c=>match(c,C.q.trim()));return L.slice(0,200).map(crow).join('')+(L.length>200?`<p class="note">מוצגים 200 מתוך ${L.length}. חפשו כדי לצמצם.</p>`:'')||'<div class="empty">אין לקוחות</div>'};
V.ocList=()=>{const T='לקוחות';if(!on())return{t:T,h:'<div class="empty">אין לך הרשאה להזמנות</div>'};if(!C.L){loadL();return{t:T,h:'<div class="empty">טוען…</div>'}}
 return{t:T,s:C.L.length+' לקוחות',h:`${mgr()&&typeof impCardH==='function'?impCardH('cust'):''}<div class="row" style="margin-bottom:8px"><button class="btn grow" data-a="ocNew">${ico('plus')}לקוח חדש</button></div>
 <div class="card" id="ocCount" style="margin:8px 0;text-align:center"><b class="a" style="font-size:1.4em">${C.L.length}</b> <span>לקוחות</span></div>
 ${mgr()?'<button class="btn g s w" data-a="ocCfg">שדות נוספים ללקוח</button>':''}
 <label class="f"><span>חיפוש (שם, טלפון או ת.ז)</span><input data-i="ocQ" value="${esc(C.q)}" autocomplete="off"></label><div id="ocl">${listH()}</div>
 <button class="btn g s w" style="margin-top:8px" data-a="ocRe">רענן</button>${mgr()?'<div class="row" style="margin-top:16px"><button class="btn g s grow" data-a="ocWipe" style="color:var(--bad)">מחיקת כל הלקוחות</button><button class="btn g s grow" data-a="ocRest">שחזור לקוחות מגיבוי</button></div>':''}`}};
/* 11.11.2026: מחיקת כל הלקוחות (מנהל) – הקלדת "מחק" לאישור; השרת שומר גיבוי מלא (כולל כרטיסים מוצפנים) לפני המחיקה. שחזור – מהגיבוי האחרון */
ACT.ocWipe=()=>dlg(`<h3>מחיקת כל הלקוחות</h3><p>יימחקו <b>כל הלקוחות</b> (${(C.L||[]).length}) עם כל הפרטים, הקווים המנויידים וכרטיסי האשראי השמורים.</p><p class="note">לא נמחקים: הזמנות והגדרת השדות הנוספים. לפני המחיקה נשמר גיבוי, ואפשר לשחזר אותו בכפתור "שחזור לקוחות מגיבוי".</p><form data-f="ocWipeF"><input type="hidden" name="req" value="${rid()}"><label class="f"><span>כדי לאשר הקלידו: מחק</span><input name="cf" autocomplete="off" required></label><div class="row"><button class="btn r grow">מחק את כל הלקוחות</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`);
FRM.ocWipeF=async f=>{const x=fd(f);if(String(x.cf||'').trim()!=='מחק')return toast('כדי למחוק יש להקליד: מחק');const b=f.querySelector('button');b.disabled=true;try{const r=await fnCall('wipeCusts',{reqId:x.req,confirm:'מחק'});closeDlg();toast('נמחקו '+(r&&r.n||0)+' לקוחות. נשמר גיבוי');await loadL(true)}catch(e){b.disabled=false;err(e)}};
ACT.ocRest=()=>ask('לשחזר את הלקוחות מהגיבוי האחרון? לקוחות שקיימים עכשיו נשארים כמו שהם.',async()=>{try{const r=await fnCall('restoreCusts',{reqId:rid()});toast('שוחזרו '+(r&&r.n||0)+' לקוחות'+(r&&r.skip?' ('+r.skip+' כבר קיימים)':''));await loadL(true)}catch(e){err(e)}},'שחזר');
INP.ocQ=el=>{C.q=el.value;const x=document.getElementById('ocl');if(x)x.innerHTML=listH()};
ACT.ocRe=()=>loadL(true);

/* ---------- כרטיס לקוח ---------- */
const ordsOf=c=>(O.L||[]).filter(o=>o.custId?o.custId===c.id:o.cust&&((c.tz&&o.cust.tz===c.tz)||(c.phone&&o.cust.phone===c.phone))).sort((a,b)=>(b.at||0)-(a.at||0));
/* 11.11.2026: כרטיס לקוח מסודר – אזורים עם כותרת, שורה לכל פרט ("שם: ערך"), ערכים מכמה שורות ייבוא (" | ") כרשימה, קו מנויד כבלוק נפרד */
(()=>{if(document.getElementById('ocCss'))return;const st=document.createElement('style');st.id='ocCss';
 st.textContent='.ocH{display:flex;align-items:center;justify-content:space-between;gap:8px;font-weight:700;font-size:.95rem;color:var(--acc);margin:14px 0 2px;padding-bottom:4px;border-bottom:1px solid var(--line)}.ocH:first-child{margin-top:0}.ocR{padding:7px 0 7px;padding-inline-start:104px;text-indent:-104px;border-bottom:1px solid var(--line);overflow-wrap:anywhere;line-height:1.45}.ocR:last-child{border-bottom:0}.ocK{display:inline-block;width:104px;text-indent:0;color:var(--mut);font-size:.88rem;vertical-align:top}.ocP{border:1px solid var(--line);border-radius:12px;padding:8px 10px;margin-top:8px}.ocP .ocR{padding-inline-start:88px;text-indent:-88px;padding-top:4px;padding-bottom:4px;border:0}.ocP .ocK{width:88px}';
 document.head.appendChild(st)})();
const ocRow=(l,v,o)=>v==null||v===''?'':`<div class="ocR"${o&&o.bad?` data-bad="${o.bad}"`:''}><span class="ocK">${l}:</span> ${o&&o.raw?v:esc(v)}${o&&o.bad?' '+BADT:''}</div>`;
// ערך שהצטבר מכמה שורות ייבוא (מופרד " | ") – כל ערך בשורה משלו, בלי כפילויות
const ocMulti=v=>{const L=[...new Set(String(v).split(' | ').map(x=>x.trim()).filter(Boolean))];return L.length>1?L.map(x=>'• '+esc(x)).join('<br>'):esc(L[0]||'')};
const ocTel=p=>`<a href="tel:${esc(p)}" dir="ltr" style="color:var(--acc);display:inline-flex;min-height:44px;align-items:center;text-indent:0">${esc(p)}</a>`;
const portH=(p,i)=>`<div class="ocP"><b dir="ltr" style="display:block;text-align:right">${p.phone?esc(p.phone):p.bph?esc(p.bph)+' '+BADT:'קו '+(i+1)}</b>${ocRow('תאריך ניוד',p.d)}${ocRow('חברת ניוד',p.co)}${p.tz?ocRow('ת.ז ניוד',p.tz):p.btz?ocRow('ת.ז ניוד',p.btz,{bad:'ptz'}):''}${p.act?ocRow('נויד בפועל',actTxt(p.act)):''}${p.br?ocRow('סניף',brNm(p.br)||p.br):''}</div>`;
V.ocCard=id=>{const T='לקוח';if(!on())return{t:T,h:'<div class="empty">אין לך הרשאה להזמנות</div>'};if(!C.L){loadL();return{t:T,h:'<div class="empty">טוען…</div>'}}
 const c=C.L.find(x=>x.id===id);if(!c)return{t:T,h:'<div class="empty">הלקוח לא נמצא</div>'};
 if(!O.L&&!C.ol){C.ol=1;fnLoadOrders()}
 const L=ordsOf(c),ed=`<button class="btn g s" style="min-height:44px;padding:4px 14px" data-a="ocEdit" data-id="${esc(c.id)}">עריכה</button>`,H=(t,e)=>`<div class="ocH"><span>${t}</span>${e?ed:''}</div>`;
 const biz=(c.bn&&c.bn!==c.name?ocRow('שם העסק',c.bn):'')+ocRow('ע.מ',c.vat)+ocRow('איש קשר',c.ct)+(c.pay?ocRow('תנאי תשלום',payTxt(c)):'');
 const con=(c.phone?ocRow('טלפון',ocTel(c.phone),{raw:1}):'')+(phsOf(c).length?ocRow('טלפון נוסף',phsOf(c).map(ocTel).join(' '),{raw:1}):'')+(c.bph?ocRow('טלפון',c.bph,{bad:'ph'}):'')
  +ocRow('ת.ז',c.tz)+(c.btz?ocRow('ת.ז',c.btz,{bad:'tz'}):'')+(c.mail?ocRow('מייל',`<bdi dir="ltr">${esc(c.mail)}</bdi>`,{raw:1}):'')+(c.bml?ocRow('מייל',c.bml,{bad:'ml'}):'')+ocRow('כתובת',c.addr)
  +(cardsOf(c).length?ocRow(cardsOf(c).length>1?'כרטיסי אשראי':'כרטיס אשראי',cardsOf(c).map(k=>'****'+esc(k.last4||'')).join(', ')+' (מוצפן)',{raw:1}):c.last4?ocRow('כרטיס אשראי','****'+c.last4):'');
 const inf=cell()?INF.filter(([k])=>c[k]).map(([k,l])=>ocRow(l,ocMulti(c[k]),{raw:1})).join(''):'';
 const xs=xKeys().filter(k=>c.x&&c.x[k.k]).map(k=>ocRow(esc(k.label),c.x[k.k])).join('');
 const P=cell()?portsOf(c):[];
 return{t:c.name||c.bn||T,s:c.wholesale===true?'לקוח עסקי (סיטונאי)':'לקוח רגיל',h:`<div class="card"><div class="row" style="justify-content:space-between;align-items:center"><b style="font-size:1.15rem">${esc(c.name||c.bn||'')}</b>${c.wholesale===true?WSTAG:''}</div>${badOf(c).length?`<p class="note" style="margin:4px 0" data-bad="1">${RED('פרט לא תקין: '+esc(badOf(c).join(', '))+' – נשמר כמו שהוא מהקובץ')}</p>`:''}
 ${biz?H('פרטי העסק',1)+biz:''}${H('פרטי קשר',1)}${con||'<p class="note">אין פרטים</p>'}${xs?H('שדות נוספים',1)+xs:''}${inf?H('פרטים נוספים',1)+inf:''}</div>
 ${P.length?`<div class="card" style="margin-top:8px">${H('קווים מנויידים ('+P.length+')',1)}${P.map(portH).join('')}</div>`:''}
 <div class="row" style="margin-top:8px"><button class="btn grow" data-a="ocEdit" data-id="${esc(c.id)}">עריכת כל הפרטים</button>${mgr()?`<button class="btn g grow" data-a="ocWs" data-id="${esc(c.id)}">${c.wholesale===true?'הפוך ללקוח רגיל':'סמן כלקוח עסקי (סיטונאי)'}</button>`:''}</div>
 ${mgr()?cardMgrH(c):''}<div class="sec"><h3>הזמנות</h3></div>${L.length?L.map(o=>`<button class="li" data-a="go" data-v="oxOrd" data-arg="${esc(o.id)}"><div class="m"><b>#${o.no}</b><small>${new Date(o.at).toLocaleDateString('he-IL')}</small></div><b class="a">${ils(o.total)}</b></button>`).join(''):`<p class="note">${O.L?'אין הזמנות':'טוען…'}</p>`}`}};
function fnLoadOrders(){/* V.ox טוען את ההזמנות כשאין עדיין */try{V.ox()}catch(e){}setTimeout(()=>{if(cur().v==='ocCard'&&!typing())rerender()},1500)}
ACT.ocWs=async el=>{const c=(C.L||[]).find(x=>x.id===el.dataset.id);if(!c)return;const to=c.wholesale!==true;
 if(to){if(!C.cfg)await cfgLoad();C.wsMark=c.id;C.ea=!!(c.addr||AP.some(k=>c[k]));return dlg(cForm(c))} // סבב 1: סימון כעסקי – ממלאים את כל פרטי העסק
 ask(to?`לסמן את ${c.name} כלקוח עסקי (סיטונאי)?`:`להחזיר את ${c.name} ללקוח רגיל?`,async()=>{try{await fnCall('saveCust',{id:c.id,cust:{},wholesale:to});toast('עודכן');await loadL(true)}catch(e){err(e)}},'כן')};

/* ---------- fb/ord-card: כרטיס מלא מוצפן בשרת ----------
   מנהל: הצגה בלחיצה (getCard view – נרשם ביומן), העתקה (copy – נרשם), הזנה/החלפה (setCard), מחיקה (delCard).
   עובד עם ord: בכרטיס הזמנה שלא שולמה ומקושרת ללקוח – "העתק מספר כרטיס" (getCard copy + ordId; השרת בודק) והזנת כרטיס.
   הערך המפוענח לא נשמר במשתנה גלובלי, לא ב-localStorage ולא בכתובת; התצוגה נמחקת אחרי 30 שניות או במעבר מסך. */
let shown=null;const unshow=()=>{if(shown){clearTimeout(shown.t);shown=null}};
/* סבב 2: עד 3 כרטיסים ללקוח (cards:[{s,last4}]). לקוח ישן עם card:true בלי cards = כרטיס אחד במקום 1. data-s = מקום הכרטיס (1 בלי data-s – תאימות) */
const cardsOf=c=>!c?[]:Array.isArray(c.cards)?c.cards.filter(x=>x&&[1,2,3].includes(x.s)).sort((a,b)=>a.s-b.s):c.card===true?[{s:1,last4:c.last4||''}]:[];
const freeSlot=c=>[1,2,3].find(n=>!cardsOf(c).some(x=>x.s===n));
const sAt=n=>n>1?` data-s="${n}"`:'';
const cardMgrH=c=>{const L=cardsOf(c),f=freeSlot(c);return `<div class="sec"><h3>${L.length>1?'כרטיסי אשראי ('+L.length+')':'כרטיס אשראי'}</h3></div><div class="card" id="occard">${L.length?'<p class="note" style="margin:0">מוצפן בשרת. כל הצגה והעתקה נרשמות ביומן.</p>'+L.map(k=>`<div style="border-top:1px solid var(--line);margin-top:8px;padding-top:6px" data-card="${k.s}"><p class="note" style="margin:0"><b>כרטיס ****${esc(k.last4||'')}</b></p>
 <div id="occv${k.s>1?k.s:''}"></div><div class="row" style="margin-top:8px"><button class="btn g grow" data-a="ocCardView" data-id="${esc(c.id)}"${sAt(k.s)}>הצג פרטי כרטיס</button><button class="btn g grow" data-a="ocCardCopy" data-id="${esc(c.id)}"${sAt(k.s)}>העתק מספר</button></div>
 <div class="row" style="margin-top:8px"><button class="btn g grow" data-a="ocCardSet" data-id="${esc(c.id)}"${sAt(k.s)}>החלף כרטיס</button><button class="btn g grow" data-a="ocCardDel" data-id="${esc(c.id)}"${sAt(k.s)}>מחק פרטי כרטיס</button></div></div>`).join('')
 :'<p class="note" style="margin:0">אין כרטיס שמור</p>'}${f?`<button class="btn g w" style="margin-top:8px" data-a="ocCardSet" data-id="${esc(c.id)}"${sAt(f)}>${L.length?'הוספת כרטיס נוסף':'הוספת כרטיס'}</button>`:'<p class="note" style="margin:6px 0 0">אפשר לשמור עד 3 כרטיסים ללקוח.</p>'}</div>`};
// ליקוי 5: אחרי 45 שניות הלוח מתנקה – אם אפשר לקרוא, רק כשהתוכן עדיין זהה; בלי הרשאת קריאה – כותבים ריק. כל כישלון נבלע.
let clipT=null;const CLIP_MS=45000;
const clipClear=t=>{clipT=null;const cb=navigator.clipboard;if(!cb||!cb.writeText)return;const w=()=>cb.writeText('').catch(()=>{});
 try{if(cb.readText)cb.readText().then(x=>{if(x===t)w()},w);else w()}catch(e){w()}};
const copyTxt=t=>(navigator.clipboard&&navigator.clipboard.writeText?navigator.clipboard.writeText(t):Promise.reject()).then(()=>{if(clipT)clearTimeout(clipT);clipT=setTimeout(()=>clipClear(t),CLIP_MS);toast('הועתק. הלוח יתנקה בעוד 45 שניות. הפעולה נרשמה ביומן')},()=>toast('ההעתקה נכשלה'));
const slotA=(el,a)=>{const n=+el.dataset.s;if(n>1)a.slot=n;return a};
ACT.ocCardView=async el=>{el.disabled=true;try{const n=+el.dataset.s>1?+el.dataset.s:1,r=await fnCall('getCard',slotA(el,{custId:el.dataset.id,act:'view'}));const k=r.card||{};document.querySelectorAll('[id^=occv]').forEach(x=>x.innerHTML='');const b=document.getElementById('occv'+(n>1?n:''));unshow();
  if(b){b.innerHTML=`<p style="margin:6px 0" dir="ltr"><b>${esc(String(k.num||'').replace(/(\d{4})(?=\d)/g,'$1 '))}</b></p><p class="note" style="margin:0">תוקף ${esc(k.exp||'—')} · CVV ${esc(k.cvv||'—')}</p><p class="note" style="margin:0">${esc(k.name||'')}</p><p class="note" style="margin:0">(יוסתר בעוד 30 שניות)</p>`;
   shown={t:setTimeout(()=>{document.querySelectorAll('[id^=occv]').forEach(x=>x.innerHTML='');shown=null},30000)}}}catch(e){err(e)}finally{el.disabled=false}};
ACT.ocCardCopy=async el=>{el.disabled=true;try{const a=slotA(el,{custId:el.dataset.id,act:'copy'});if(el.dataset.ord)a.ordId=el.dataset.ord;const r=await fnCall('getCard',a);await copyTxt(String(r.card&&r.card.num||''))}catch(e){err(e)}finally{el.disabled=false}};
ACT.ocCardDel=el=>ask('למחוק את פרטי הכרטיס של הלקוח? אי אפשר לשחזר.',async()=>{try{await fnCall('delCard',slotA(el,{custId:el.dataset.id}));toast('פרטי הכרטיס נמחקו');await loadL(true)}catch(e){err(e)}},'מחק');
ACT.ocCardSet=el=>dlg(`<h3>פרטי כרטיס אשראי</h3><form data-f="ocCardF"><input type="hidden" name="id" value="${esc(el.dataset.id)}">${+el.dataset.s>1?`<input type="hidden" name="slot" value="${+el.dataset.s}">`:''}${el.dataset.ord?`<input type="hidden" name="ord" value="${esc(el.dataset.ord)}">`:''}
 ${fld('מספר כרטיס','num','','text','inputmode="numeric" autocomplete="off" required maxlength="23" dir="ltr"')}${fld('תוקף (MM/YY)','exp','','text','inputmode="numeric" autocomplete="off" maxlength="7" dir="ltr"')}
 ${fld('שם בעל הכרטיס','name','','text','autocomplete="off" maxlength="60"')}${fld('CVV','cvv','','text','inputmode="numeric" autocomplete="off" maxlength="4" dir="ltr"')}
 <p class="note">נשמר מוצפן בשרת. באפליקציה נשארות רק 4 ספרות אחרונות.</p><div class="row"><button class="btn grow">שמור</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`);
FRM.ocCardF=async f=>{const v=fd(f);const card={num:v.num};['exp','name','cvv'].forEach(k=>{if(String(v[k]||'').trim())card[k]=String(v[k]).trim()});const a={custId:v.id,card};if(v.ord)a.ordId=v.ord;if(+v.slot>1)a.slot=+v.slot;
 const b=f.querySelector('button');b.disabled=true;try{await fnCall('setCard',a);f.reset();closeDlg();toast('הכרטיס נשמר מוצפן');await loadL(true);rerender()}catch(e){b.disabled=false;err(e)}};
// כרטיס הזמנה (עובד ומנהל): הזמנה שלא שולמה ומקושרת ללקוח → העתקת מספר / הזנת כרטיס
{const oo=V.oxOrd;if(oo)V.oxOrd=id=>{const r=oo(id);unshow();if(!r||!r.h||!on())return r;const o=(O.L||[]).find(x=>x.id===id);if(!o||!o.custId||!['new','work','wait_pay'].includes(o.status))return r;
  if(!C.L&&!C.busy)loadL();const c=(C.L||[]).find(x=>x.id===o.custId);
  const K=cardsOf(c),fs=c?freeSlot(c):0;
  const h=`<div class="sec"><h3>כרטיס אשראי</h3></div><div class="card" id="ocordcard">${K.length?'<p class="note" style="margin:0">ההעתקה נרשמת ביומן.</p>'+K.map(k=>`<p class="note" style="margin:8px 0 0">כרטיס ****${esc(k.last4||'')} שמור</p><button class="btn g w" style="margin-top:6px" data-a="ocCardCopy" data-id="${esc(o.custId)}" data-ord="${esc(o.id)}"${sAt(k.s)}>העתק מספר כרטיס${K.length>1?' ****'+esc(k.last4||''):''}</button>`).join('')
   :`<p class="note" style="margin:0">${c?'אין כרטיס שמור':'…'}</p>`}${c?`<button class="btn g w" style="margin-top:8px" data-a="ocCardSet" data-id="${esc(o.custId)}" data-ord="${esc(o.id)}"${fs?sAt(fs):''}>${!K.length?'הזנת כרטיס':fs?'הוספת כרטיס נוסף':'החלף כרטיס'}</button>`:''}</div>`;
  r.h=r.h.replace('<div class="sec"><h3>היסטוריה</h3></div>',h+'<div class="sec"><h3>היסטוריה</h3></div>');return r}}

/* ---------- טופס לקוח (חדש / עריכה) ---------- */
// 2026-11-10: לכל קו – חברת ניוד ונויד בפועל; טלפון/ת"ז לא תקינים מהייבוא מוצגים באדום ונשמרים כמו שהם אם לא שונו (obph/obtz)
const pRows=()=>(C.pf||[]).map((p,i)=>`<div class="card" style="margin:6px 0"><div class="row"><label class="f grow"><span>תאריך ניוד</span><input type="date" name="pd${i}" value="${esc(p.d||'')}" dir="ltr"></label><label class="f grow"><span>טלפון שנויד${p.obph&&p.phone===p.obph?' '+BADT:''}</span><input name="pp${i}" type="tel" inputmode="tel" value="${esc(p.phone||'')}" dir="ltr"></label></div><div class="row"><label class="f grow"><span>ת.ז שעליה נויד${p.obtz&&p.tz===p.obtz?' '+BADT:''}</span><input name="pt${i}" inputmode="numeric" maxlength="20" value="${esc(p.tz||'')}"></label><label class="f grow"><span>חברת ניוד</span><input name="pc${i}" maxlength="40" value="${esc(p.co||'')}"></label></div><div class="row"><label class="f grow"><span>נויד בפועל</span><select name="pa${i}"><option value="">—</option>${PACT.map(([k,l])=>`<option value="${k}"${p.act===k?' selected':''}>${l}</option>`).join('')}</select></label><button type="button" class="btn g s" data-a="ocPDel" data-n="${i}">מחק</button></div></div>`).join('')||'<p class="note">אין ניודים קודמים</p>';
const pRead=()=>{const f=document.querySelector('#dlg form');if(!f)return;const v=fd(f);C.pf=(C.pf||[]).map((p,i)=>Object.assign({d:v['pd'+i]||'',phone:v['pp'+i]||'',tz:v['pt'+i]||'',co:v['pc'+i]||'',act:v['pa'+i]||''},p.br?{br:p.br}:{},p.obph?{obph:p.obph}:{},p.obtz?{obtz:p.obtz}:{}))};
const pfOf=c=>portsOf(c).map(p=>Object.assign({},p,{phone:p.phone||p.bph||'',tz:p.tz||p.btz||''},p.bph?{obph:p.bph}:{},p.btz?{obtz:p.btz}:{}));
ACT.ocPAdd=()=>{pRead();if(C.pf.length>=30)return toast('עד 30 ניודים');C.pf.push({});const b=document.getElementById('ocpl');if(b)b.innerHTML=pRows()};
ACT.ocPDel=el=>{pRead();C.pf.splice(+el.dataset.n,1);const b=document.getElementById('ocpl');if(b)b.innerHTML=pRows()};
/* 2026-11-09: סוג לקוח בטופס חדש – רגיל (שם פרטי, משפחה, טלפון; כתובת למשלוח רשות; ת"ז רק לניוד) או עסקי (שם העסק, ע.מ, איש קשר, טלפון, כתובת, עיר, תנאי תשלום) */
const isBiz=c=>c?(!!c.bn||C.wsMark===c.id):C.ft==='biz'; // לקוח סיטונאי ישן בלי שם עסק – נערך בטופס הרגיל, כמו קודם
const bizH=c=>{const v=k=>c&&c[k]||'',pay=v('pay');return `${fld('שם העסק','bn',v('bn'),'text','required maxlength="60"')}${fld('ע.מ (9 ספרות)','vat',v('vat'),'text','required inputmode="numeric" maxlength="11" autocomplete="off" dir="ltr"')}${fld('איש קשר','ct',v('ct'),'text','required maxlength="60"')}
 <label class="f"><span>תנאי תשלום</span><select name="pay" data-c="ocPay" required><option value="">בחרו</option>${PAYS.map(([k,l])=>`<option value="${k}"${pay===k?' selected':''}>${l}</option>`).join('')}</select></label>
 <div id="ocpayx"${pay==='other'?'':' hidden'}>${fld('פירוט תנאי התשלום','payTxt',v('payTxt'),'text','maxlength="60"')}</div>`};
CHG.ocPay=el=>{const b=document.getElementById('ocpayx');if(b)b.hidden=el.value!=='other'};
const cForm=c=>{const x=c&&c.x||{},s=splitOld(c||{},{}),bz=isBiz(c);C.pf=pfOf(c);return `<h3>${c?'עריכת לקוח':'לקוח חדש'}</h3>${c?'':`<div class="row" role="group" aria-label="סוג לקוח" style="margin-bottom:8px"><button type="button" class="btn grow${bz?' g':''}" data-a="ocFt" data-t="reg" aria-pressed="${!bz}">לקוח רגיל</button><button type="button" class="btn grow${bz?'':' g'}" data-a="ocFt" data-t="biz" aria-pressed="${bz}">לקוח עסקי (סיטונאי)</button></div>`}<form data-f="ocF">${bz?'<input type="hidden" name="biz" value="1">':''}${c&&C.wsMark===c.id?'<input type="hidden" name="wsmark" value="1">':''}${s.name?`<input type="hidden" name="oname" value="${esc(s.name)}">`:''}${s.addr?`<input type="hidden" name="oaddr" value="${esc(s.addr)}">`:''}${c?`<input type="hidden" name="id" value="${esc(c.id)}">`:''}
 ${bz?bizH(c):''}${(s.name&&!bz?`<p class="note">שם קיים: ${esc(s.name)} (נשמר כמו שהוא אם משאירים ריקים את השם הפרטי ושם המשפחה)</p>`:'')+(bz?'':fld('שם פרטי','fn',s.fn||'','text',(s.name?'':'required ')+'maxlength="30"')+fld('שם משפחה','ln',s.ln||'','text',(s.name?'':'required ')+'maxlength="30"'))}${c&&!c.phone&&c.bph?`<input type="hidden" name="obph" value="${esc(c.bph)}">`:''}${fld('טלפון'+(c&&!c.phone&&c.bph?' '+BADT:''),'phone',c&&(c.phone||c.bph)||'','tel','inputmode="tel"'+(!c||c.phone?' required':'')+(c&&/^p/.test(c.id)?' readonly':''))}${fld('טלפונים נוספים (מופרדים בפסיק, עד 3)','phs',phsOf(c).join(', '),'tel','inputmode="tel" dir="ltr"')}
 ${c&&!c.tz&&c.btz?`<input type="hidden" name="obtz" value="${esc(c.btz)}">`:''}${fld(c&&c.tz?'ת.ז':c&&c.btz?'ת.ז '+BADT:'ת.ז (רק ללקוח עם ניוד קווים – רשות)','tz',c&&(c.tz||c.btz)||'','text','inputmode="numeric" maxlength="'+(c&&!c.tz&&c.btz?20:9)+'" autocomplete="off"'+(c&&c.tz?' readonly':''))}
 ${c&&!c.mail&&c.bml?`<input type="hidden" name="obml" value="${esc(c.bml)}">`:''}${fld('מייל'+(c&&!c.mail&&c.bml?' '+BADT:''),'mail',c&&(c.mail||c.bml)||'',c&&!c.mail&&c.bml?'text':'email','dir="ltr"')}${(s.addr?`<p class="note">כתובת קיימת: ${esc(s.addr)} (נשמרת כמו שהיא אם לא ממלאים רחוב/עיר)</p><label class="row" style="min-height:44px;gap:8px"><input type="checkbox" name="odel" value="1">מחק את הכתובת הקיימת</label>`:'')+fld(bz?'כתובת (רחוב ומספר)':'רחוב ומספר','st',s.st||'','text',(bz?'required ':'')+'maxlength="80"')}${fld('עיר','city',s.city||'','text',(bz?'required ':'')+'maxlength="40"')}<div class="row"><div class="grow">${fld('קומה','fl',s.fl||'','text','maxlength="10"')}</div><div class="grow">${fld('דירה','apt',s.apt||'','text','maxlength="10"')}</div></div>
 ${fld('4 ספרות אחרונות של כרטיס (רשות)','last4',c&&c.last4||'','text','inputmode="numeric" maxlength="4" autocomplete="off"')}
 ${xKeys().map(k=>fld(esc(k.label),'x_'+k.k,x[k.k]||'','text','maxlength="200"')).join('')}
 ${cell()?`<div class="sec"><h3>פרטים נוספים</h3></div>${INF.map(([k,l,mx])=>k!=='orig'&&k!=='od'||String(c&&c[k]||'').includes(' | ')?`<label class="f"><span>${l}</span><textarea name="${k}" maxlength="${mx}" rows="${String(c&&c[k]||'').split(' | ').length>1||k==='note'||k==='bank'?3:2}" dir="auto">${esc(c&&c[k]||'')}</textarea></label>`:fld(l,k,c&&c[k]||'','text','maxlength="'+mx+'"')).join('')}<div class="sec"><h3>ניודים קודמים</h3></div><div id="ocpl">${pRows()}</div><button type="button" class="btn g s w" data-a="ocPAdd">＋ ניוד</button>`:''}
 <p class="note">לא מקלידים מספר כרטיס מלא, תוקף או קוד${cell()?' (גם לא בפרטי הבנק)':''}.</p><div class="row"><button class="btn grow">שמור</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`};
ACT.ocNew=async()=>{if(!C.cfg)await cfgLoad();C.ft='reg';C.wsMark=null;dlg(cForm(null))};
ACT.ocFt=el=>{C.ft=el.dataset.t==='biz'?'biz':'reg';dlg(cForm(null))};
ACT.ocEdit=async el=>{if(!C.cfg)await cfgLoad();C.wsMark=null;const c=(C.L||[]).find(x=>x.id===el.dataset.id);if(c){C.ea=!!(c.addr||AP.some(k=>c[k]));dlg(cForm(c))}};
FRM.ocF=async f=>{pRead();const v=fd(f),bz=!!v.biz;if(CPK.concat(['bn','ct','payTxt']).concat(xKeys().map(k=>'x_'+k.k)).some(n=>CARD8.test(v[n]||'')))return toast('אסור להקליד מספר כרטיס או מספר ארוך. מותר רק 4 ספרות אחרונות.');
 // 2026-11-10: מייל ושדות המידע – חסום מספר כרטיס (13–19 ספרות), טלפון בתוכם מותר. פרטי בנק – טקסט גלוי (החלטת המשתמש)
 if(cardLike(v.mail))return toast('מייל: אסור מספר כרטיס');if(cell()){const b=INF.find(([k])=>k!=='bank'&&cardLike(v[k],1));if(b)return toast(b[1]+': אסור להקליד מספר כרטיס אשראי')}
 // ערך לא תקין מהייבוא שלא שונה – נשאר כמו שהוא (לא נשלח); ערך תקין חדש – מחליף ומבטל את הסימון
 const keepPh=!!v.obph&&String(v.phone||'').trim()===v.obph,keepTz=!!v.obtz&&String(v.tz||'').trim()===v.obtz,keepMl=!!v.obml&&String(v.mail||'').trim()===v.obml;
 const tz=keepTz?'':dig(v.tz);if(tz&&!tzOk(tz.padStart(9,'0')))return toast('ת.ז לא תקינה');
 const ph=keepPh?'':phN(v.phone);if(!ph&&!keepPh&&!(v.id&&!String(v.phone||'').trim()&&!(C.L||[]).some(x=>x.id===v.id&&x.phone)))return toast('טלפון לא תקין');
 if(keepMl)v.mail='';
 const k=l4(v.last4);if(k.bad)return toast('4 ספרות בדיוק');
 const P=[];for(const p of C.pf||[]){const o={};if(p.d)o.d=p.d;const pp=String(p.phone||'').trim(),pt=String(p.tz||'').trim();if(pp){if(p.obph&&pp===p.obph)o.bph=p.obph;else{o.phone=phN(pp);if(!o.phone)return toast('טלפון ניוד לא תקין')}}if(pt){if(p.obtz&&pt===p.obtz)o.btz=p.obtz;else{const z=tzN(pt);if(!z||!tzOk(z))return toast('ת.ז ניוד לא תקינה');o.tz=z}}
  const co=String(p.co||'').trim();if(co){if(CARD8.test(co))return toast('חברת ניוד: אסור מספר ארוך');o.co=co}if(PACT.some(x=>x[0]===p.act))o.act=p.act;if(Object.keys(o).length){if(p.br&&brAll().some(b=>b.id===p.br))o.br=p.br;P.push(o)}}
 v.fn=v.fn||'';v.ln=v.ln||'';
 const bzReq=bz&&(!v.id||!!v.wsmark||!(C.L||[]).some(x=>x.id===v.id&&x.wholesale===true)); // לקוח עסקי חדש / סימון חדש – כל השדות חובה
 if(bz){const t=String(v.vat||'').replace(/[\s-]/g,''),e=k=>!String(v[k]||'').trim();if(e('bn'))return toast('חסר שם העסק');if(t&&!/^\d{9}$/.test(t))return toast('ע.מ: 9 ספרות');
  if(bzReq){if(!t)return toast('חסר ע.מ');if(e('ct'))return toast('חסר איש קשר');if(e('st'))return toast('חסרה כתובת');if(e('city'))return toast('חסרה עיר');if(e('pay'))return toast('בחרו תנאי תשלום')}
  if(v.pay==='other'&&!String(v.payTxt||'').trim())return toast('כתבו את תנאי התשלום')}
 else{if(!v.fn.trim()&&(!v.oname||v.ln.trim()))return toast(v.oname?'ממלאים שם פרטי, או משאירים את שני שדות השם ריקים כדי לשמור את השם הקיים':'חסר שם פרטי');if(v.fn.trim()&&!v.ln.trim())return toast('חסר שם משפחה')}
 const c={};if(ph)c.phone=ph;if(cell())c.ports=P;{const raw=String(v.phs||'').split(/[,;]/).map(x=>x.trim()).filter(Boolean),xs=[];for(const x of raw){const q=phN(x);if(!q)return toast('טלפון נוסף לא תקין: '+x);if(!xs.includes(q))xs.push(q)}if(xs.length>3)return toast('עד 3 טלפונים נוספים');const old0=(C.L||[]).find(x=>x.id===v.id);if(xs.length||phsOf(old0).length)c.phs=xs}const old=(C.L||[]).find(x=>x.id===v.id)||{};
 if(ph&&old.bph&&!old.phone)c.bph='';if(tz&&old.btz&&!old.tz)c.btz=''; /* סבב 2: ערך לא תקין נמחק רק כשהמשתמש החליף אותו (השדה הציג אותו) */if(String(v.mail||'').trim()&&old.bml)c.bml='';
 if(cell())INFK.forEach(k=>{const s=String(v[k]||'').trim();if(s)c[k]=s;else if(v.id&&old[k])c[k]=''});if(tz)c.tz=tz;CPK.forEach(n=>c[n]=(v[n]||'').trim());if(!c.fn&&!c.ln){delete c.fn;delete c.ln;if(v.oname)c.name=v.oname}
 if(bz){c.bn=v.bn.trim();['vat','ct','pay'].forEach(n=>{c[n]=String(v[n]||'').replace(n==='vat'?/[\s-]/g:/^$/,'').trim()});if(v.pay==='other')c.payTxt=v.payTxt.trim();['vat','ct','pay'].forEach(n=>{if(!c[n])delete c[n]})}if(!AP.some(n=>c[n])){AP.forEach(n=>delete c[n]);const had=f.querySelector('[name=id]')&&(v.oaddr||C.ea);if(v.oaddr&&!v.odel)c.addr=v.oaddr;else if(had)c.addr=''}['mail'].forEach(n=>{if(v[n]&&v[n].trim())c[n]=v[n].trim()});if(k.v)c.last4=k.v;
 const x={};xKeys().forEach(q=>{const s=(v['x_'+q.k]||'').trim();if(s)x[q.k]=s});if(Object.keys(x).length)c.x=x;
 const id=(v.id||'').trim(),a={cust:c};if(id){a.id=id;if(v.wsmark)a.wholesale=true}else if(bz)a.wholesale=true;
 const b=f.querySelector('button.grow:not(.g)')||f.querySelector('button');b.disabled=true;
 // לקוח חדש בלי ת"ז עם טלפון שכבר קיים – מציגים את הקיימים לבחירה (פתיחה / צירוף הפרטים / לקוח חדש)
 if(!id&&!tz){try{const L=await byPhoneAll(c.phone);if(L.length){C.pend=a;b.disabled=false;return dlg(dupH(L))}}catch(e){b.disabled=false;return err(e)}}
 try{await saveGo(a)}catch(e){b.disabled=false;err(e)}};
async function saveGo(a){const r=await fnCall('saveCust',a);C.pend=null;C.wsMark=null;closeDlg();toast('נשמר');await loadL(true);if(cur().v!=='ocCard'||a.asNew||!a.id)go('ocCard',r.id);else rerender()}
const dupH=L=>`<h3>הטלפון כבר שייך ל${L.length>1?'-'+L.length+' לקוחות':'לקוח'}</h3>${L.map(c=>`<div class="card" style="margin:6px 0"><b>${cLabel(c)}</b><small class="note" style="display:block">${esc(c.addr||'')}</small>
 <div class="row" style="margin-top:6px"><button type="button" class="btn g grow s" data-a="ocDupOpen" data-id="${esc(c.id)}">פתיחת הלקוח</button><button type="button" class="btn g grow s" data-a="ocDupAdd" data-id="${esc(c.id)}">צרף את הפרטים ללקוח הזה</button></div></div>`).join('')}
 <button type="button" class="btn w" data-a="ocDupNew">שמור כלקוח חדש עם אותו טלפון</button><button type="button" class="btn g w" style="margin-top:8px" data-a="closeDlg">ביטול</button>`;
ACT.ocDupOpen=el=>{C.pend=null;closeDlg();loadL(true).then(()=>go('ocCard',el.dataset.id))};
// צירוף: ממלא רק שדות ריקים בלקוח הקיים (fill) – לא דורס שם/כתובת קיימים. לקוח עסקי: הפיכת לקוח קיים לעסקי – מנהל בלבד (השרת בודק)
ACT.ocDupAdd=async el=>{const a=C.pend;if(!a)return;el.disabled=true;try{await saveGo(Object.assign({},a,{id:el.dataset.id,fill:true}))}catch(e){el.disabled=false;err(e)}};
ACT.ocDupNew=async el=>{const a=C.pend;if(!a)return;el.disabled=true;try{await saveGo(Object.assign({},a,{asNew:true}))}catch(e){el.disabled=false;err(e)}};

/* ---------- שדות נוספים (מנהל) ---------- */
ACT.ocCfg=async()=>{if(!C.cfg)await cfgLoad();C.cf=xKeys().map(k=>({k:k.k,label:k.label}));dlg(cfH())};
const cfH=()=>`<h3>שדות נוספים ללקוח</h3><form data-f="ocCfgF">${C.cf.map((k,i)=>`<div class="row"><label class="f grow"><span>שם השדה</span><input name="l${i}" value="${esc(k.label)}" maxlength="40"></label><button type="button" class="btn g s" data-a="ocCfDel" data-n="${i}" aria-label="הסר">הסר</button></div>`).join('')||'<p class="note">אין שדות נוספים</p>'}
 <button type="button" class="btn g s w" data-a="ocCfAdd">＋ שדה</button><p class="note">שדה שהוסר – הערכים הקיימים נשארים שמורים בלקוחות.</p><div class="row"><button class="btn grow">שמור</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`;
const cfRead=()=>{const f=document.querySelector('#dlg form');if(!f)return;const v=fd(f);C.cf=C.cf.map((k,i)=>({k:k.k,label:v['l'+i]!=null?v['l'+i]:k.label}))};
ACT.ocCfAdd=()=>{cfRead();if(C.cf.length>=20)return toast('עד 20 שדות');C.cf.push({label:''});dlg(cfH())};
ACT.ocCfDel=el=>{cfRead();C.cf.splice(+el.dataset.n,1);dlg(cfH())};
FRM.ocCfgF=async f=>{cfRead();const L=C.cf.filter(k=>String(k.label).trim()).map(k=>k.k?{k:k.k,label:k.label.trim()}:{label:k.label.trim()});const b=f.querySelector('button.grow:not(.g)');b.disabled=true;
 try{const r=await fnCall('setCustCfg',{xKeys:L});C.cfg={xKeys:r.xKeys};closeDlg();toast('נשמר')}catch(e){b.disabled=false;err(e)}};

/* ---------- ייבוא לקוחות (מנהל) ---------- */
const MAPF=[['fn','שם פרטי'],['ln','שם משפחה'],['name','שם מלא'],['phone','טלפון'],['tz','ת.ז'],['mail','מייל'],['st','רחוב ומספר'],['city','עיר'],['fl','קומה'],['apt','דירה'],['addr','כתובת מלאה'],['last4','4 ספרות אחרונות'],['port','תאריך ניוד'],['pph','טלפון ניוד'],['ptz','ת.ז ניוד'],['pbr','סניף הניוד'],['cnum','מספר כרטיס מלא (מוצפן)'],['cexp','תוקף כרטיס'],['cname','שם בעל הכרטיס'],['ccvv','CVV'],['pco','חברת ניוד'],['pact','נויד בפועל']].concat(INF.map(([k,l])=>[k,l]));
const CELLK=['port','pph','ptz','pbr','pco','pact'].concat(INFK); // 2026-11-10: רק בעסק עם cellular
const MK='lp-ocmap';
ACT.ocImp=()=>{dlg(`<h3>ייבוא לקוחות</h3><p class="note">קובץ Excel או CSV. השורה הראשונה – כותרות. אחר כך בוחרים איזו עמודה היא מה.</p>
 <label class="btn w" style="display:flex;align-items:center;justify-content:center">בחירת קובץ<input type="file" accept=".xlsx,.xls,.csv,text/csv" data-c="ocFile" hidden></label>
 <p class="note">עמודה שתסומן "מספר כרטיס מלא (מוצפן)" (וגם תוקף, שם, CVV) – נשמרת מוצפנת בשרת. מספר כרטיס בכל עמודה אחרת – נשמרות רק 4 הספרות האחרונות. עמודת "סיטונאי" – לא מיובאת (מסמנים ידנית).</p><button type="button" class="btn g w" data-a="closeDlg">ביטול</button>`)};
// 2026-11-10: כל 24 הכותרות של קובץ הלקוחות מזוהות (פרטי בנק לפני "פרטי", חברת ניוד / נויד בפועל לפני "ניוד", מספר כרטיס → מוצפן)
const guess=(h)=>{const s=String(h||'').replace(/["'\s.]/g,'');return /בנק/.test(s)?'bank':/חברתניוד|חברהמניידת|ספק/.test(s)?'pco':/נוידבפועל|ניודבפועל|נוידה?$/.test(s)?'pact':/^מוצר|^פריט/.test(s)?'prod':/לתשלום|סכום/.test(s)?'due':/^מקור/.test(s)?'orig':/^סטטוס/.test(s)?'stat':/^הער/.test(s)?'note':/תאריךהזמנה|^הזמנה/.test(s)?'od':/^(מספר)?כרטיס(אשראי)?$|מספרכרטיס/.test(s)?'cnum':/סניף/.test(s)&&!/בנק/.test(s)?'pbr':/ניוד/.test(s)?(/טל|נייד|phone/i.test(s.replace('ניוד',''))?'pph':/זהות|תז/.test(s)?'ptz':'port'):/cvv|קודאבטחה|ספרותבגב/i.test(s)?'ccvv':/תוקף|exp/i.test(s)?'cexp':/בעלהכרטיס|holder/i.test(s)?'cname':/פרטי/.test(s)?'fn':/משפחה/.test(s)?'ln':/שם/.test(s)?'name':/^עיר|ישוב|יישוב|city/i.test(s)?'city':/קומה/.test(s)?'fl':/דירה/.test(s)?'apt':/רחוב|street/i.test(s)?'st':/טל|נייד|phone/i.test(s)?'phone':/זהות|תז|^id$/i.test(s)?'tz':/מייל|דואל|mail/i.test(s)?'mail':/כתובת|addr/i.test(s)?'addr':/4|אחרונות|last/i.test(s)?'last4':''};
CHG.ocFile=async el=>{const f=el.files[0];el.value='';if(!f)return;if(/\.pdf$/i.test(f.name))return toast('רק Excel או CSV');
 try{if(!C.cfg)await cfgLoad();const rows=(await readTable(f)).filter(r=>Array.isArray(r)&&r.some(c=>String(c).trim()));if(rows.length<2)return toast('אין שורות בקובץ');
  const H=rows[0].map(x=>String(x==null?'':x).trim().slice(0,40));let saved={};try{saved=JSON.parse(localStorage.getItem(MK)||'{}')}catch(e){}
  C.imp={H,R:rows.slice(1),req:rid(),map:H.map(h=>{const g=guess(h),m=g?g:saved[h]!==undefined?saved[h]:'x+';return !cell()&&CELLK.includes(m)?'':m})};dlg(mapH())}catch(e){err(e)}}; // כותרת מוכרת – תמיד לפי הזיהוי; אחרת – הבחירה הקודמת
const optH=(v)=>`<option value="">לא לייבא</option>${MAPF.filter(x=>cell()||!CELLK.includes(x[0])).map(([k,l])=>`<option value="${k}"${v===k?' selected':''}>${l}</option>`).join('')}${xKeys().map(k=>`<option value="${esc(k.k)}"${v===k.k?' selected':''}>שדה: ${esc(k.label)}</option>`).join('')}<option value="x+"${v==='x+'?' selected':''}>שדה נוסף חדש</option>`;
const mapH=()=>{const I=C.imp,s=I.R[0]||[];return `<h3>התאמת עמודות · ${I.R.length} שורות</h3><form data-f="ocMapF" style="max-height:60vh;overflow:auto">${I.H.map((h,i)=>`<label class="f"><span>${esc(h||'עמודה '+(i+1))} <small class="note">(${esc(maskCell(s[i]))})</small></span><select name="m${i}">${optH(I.map[i])}</select></label>`).join('')}
 <div class="row"><button class="btn grow">המשך לתצוגה מקדימה</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`};
// דוגמה בכותרת: מספר ארוך מוצג מוסתר (לא מציגים מספר כרטיס על המסך)
const maskCell=v=>{const s=String(v==null?'':v).slice(0,30);const d=digs(s);return /^\d{13,19}$/.test(d)?'****'+d.slice(-4):s};
FRM.ocMapF=async f=>{const v=fd(f),I=C.imp;I.map=I.H.map((h,i)=>v['m'+i]||'');
 const used=MAPF.map(x=>x[0]).filter(k=>I.map.filter(m=>m===k).length>1);if(used.length)return toast('כל שדה – עמודה אחת בלבד');
 if(!I.map.includes('phone')&&!I.map.includes('tz'))return toast('צריך עמודת טלפון או ת.ז');
 const nx=I.map.map((m,i)=>m==='x+'?I.H[i]||('עמודה '+(i+1)):null).filter(Boolean);
 if(nx.length){if(xKeys().length+nx.length>20)return toast('עד 20 שדות נוספים');const b=f.querySelector('button');b.disabled=true;
  try{const r=await fnCall('setCustCfg',{xKeys:xKeys().map(k=>({k:k.k,label:k.label})).concat(nx.map(l=>({label:l.slice(0,40)})))});C.cfg={xKeys:r.xKeys};
   I.map=I.map.map((m,i)=>m==='x+'?(r.xKeys.find(k=>k.label===(I.H[i]||('עמודה '+(i+1))).slice(0,40))||{}).k||'':m)}catch(e){b.disabled=false;return err(e)}}
 try{const s={};I.H.forEach((h,i)=>{if(h)s[h]=I.map[i]});localStorage.setItem(MK,JSON.stringify(s))}catch(e){}
 prep();dlg(prevH())};
const xlDate=v=>{if(typeof v==='number'&&v>20000&&v<80000){const d=new Date(Math.round((v-25569)*864e5));return d.toISOString().slice(0,10)}const s=String(v||'').trim();let m=/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.exec(s);if(m){const y=m[3].length===2?'20'+m[3]:m[3];return y+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0')}m=/^(\d{4})-(\d{2})-(\d{2})/.exec(s);return m?m[0]:(s?'!':'')};
// בונה את השורות לשליחה. המספר המלא לא נשמר: נחתך כאן מיד, והשורות המקוריות של הקובץ נמחקות מהזיכרון אחרי ההכנה.
// 2026-11-10 (ייבוא לקוחות מלא): טלפון/ת"ז/מייל לא תקינים לא נדחים – נשמרים כמו שהם (bph/btz/bml) ומסומנים "לא תקין".
// שורות מתאחדות ללקוח אחד רק לפי ת"ז תקינה, ואחר כך טלפון תקין (שורה עם טלפון בלבד מצטרפת ללקוח עם ת"ז שיש לו אותו טלפון, אם הוא יחיד).
// כל שורה = קו (רשומת ניוד). שדות המידע של כמה שורות מצטרפים (ערכים שונים מופרדים ב-" | ").
const CEXP=v=>{const s=String(v==null?'':v).trim();let m=/^(\d{1,2})\s*[/.\-\\ ]\s*(\d{2}|\d{4})$/.exec(s)||/^(\d{2})(\d{2})$/.exec(s),mm,yy;if(m){mm=+m[1];yy=m[2].slice(-2)}else if((m=/^(\d{4})-(\d{2})(-\d{2})?/.exec(s))){mm=+m[2];yy=m[1].slice(-2)}else return '';return mm>=1&&mm<=12?String(mm).padStart(2,'0')+'/'+yy:''};
const CNAME=v=>{const s=String(v==null?'':v).replace(/\s+/g,' ').trim();return s&&s.length<=60&&!/\d{5,}/.test(s.replace(/\D+/g,x=>x.length<=1?'':' '))?s:''};
const MAILOK=m=>m.length<=254&&/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(m)&&!cardLike(m);
const LIM={fn:30,ln:30,st:80,city:40,fl:10,apt:10};
const pKey=r=>[r.d||'',r.phone||'',r.tz||''].concat(r.bph||r.btz?[r.bph||'',r.btz||'']:[]).join('|'); // זהה לשרת (portKey)
// סבב 2 (החלטה 3): שני טלפונים מודבקים בתא (עם או בלי מפריד) – הראשון לטלפון, השני להערות. רק כששני החלקים טלפונים תקינים
function split2(s){const g=String(s).split(/[^\d+]+/).filter(Boolean);if(g.length===2){const a=phN(g[0]),b=phN(g[1]);if(a&&b)return[a,b]}
 const d=digs(s);if(d.length<17||d.length>20)return null;for(const k of [10,9]){const a=phN(d.slice(0,k)),b=phN(d.slice(k));if(a&&b)return[a,b]}return null}
function prepRows(I){const out=[];let cut=0,mk=0;const mask=(v,n,lu)=>{const r=maskCard(v,lu);mk+=r.n;return r.s.slice(0,n)};
 I.R.forEach((r,ri)=>{const o={},x={},why=[],warn=[],pr={};I.map.forEach((m,i)=>{if(!m)return;let v=r[i];if(v==null||String(v).trim()==='')return;
   const d=digs(v),s0=String(v).trim();
   if(m==='cnum'){if(/^\d{13,19}$/.test(d)){o.card=Object.assign(o.card||{},{num:d});o.last4=d.slice(-4)}else warn.push('מספר כרטיס');return}
   if(m==='cexp'||m==='cname'||m==='ccvv'){const t=m==='cexp'?CEXP(typeof v==='number'?xlDate(v).slice(5,7)+'/'+xlDate(v).slice(2,4):s0):m==='ccvv'?(/^\d{3,4}$/.test(s0)?s0:''):CNAME(s0);if(t)o.card=Object.assign(o.card||{},{[m.slice(1)]:t});else warn.push(m==='cexp'?'תוקף':m==='ccvv'?'קוד אבטחה':'שם בעל הכרטיס');return}
   if(m==='last4'){const k=l4(v);if(k.bad)why.push('4 ספרות');else{o.last4=k.v;if(k.cut)cut++}return}
   if(m==='phone'){const sp=split2(s0);if(sp){o.phone=sp[0];if(cell())o.note=(o.note?o.note+' | ':'')+'טלפון נוסף: '+sp[1];else warn.push('טלפון נוסף');return}const p=phN(v);if(p)o.phone=p;else{o.bph=mask(s0,30,1);warn.push('טלפון')}return}
   if(m==='tz'){const z=tzN(v);if(z&&tzOk(z))o.tz=z;else{o.btz=mask(s0,20,1);warn.push('ת.ז')}return}
   if(m==='pph'){const p=phN(v);if(p)pr.phone=p;else{pr.bph=mask(s0,30,1);warn.push('טלפון ניוד')}return}
   if(m==='ptz'){const z=tzN(v);if(z&&tzOk(z))pr.tz=z;else{pr.btz=mask(s0,20,1);warn.push('ת.ז ניוד')}return}
   if(m==='bank'){o.bank=s0.slice(0,300);return} // טקסט גלוי (החלטת המשתמש)
   if(m==='pco'){const t=s0.slice(0,40);if(CARD8.test(t))warn.push('חברת ניוד');else pr.co=t;return}
   if(m==='pact'){pr.act=actOf(s0);return}
   if(m==='od'){const t=xlDate(v);o.od=t&&t!=='!'?t:mask(s0,100,1);return}
   if(INFK.includes(m)){const mx=INF.find(z=>z[0]===m)[2],t=mask(s0,mx,1);o[m]=o[m]?(t+' | '+o[m]).slice(0,mx):t;return} // הערות + טלפון נוסף מפיצול
   if(/^\d{13,19}$/.test(d)){if(!o.last4)o.last4=d.slice(-4);cut++;return} // מספר כרטיס בעמודה אחרת → 4 ספרות בלבד
   if(m==='mail'){const t=s0.toLowerCase();if(MAILOK(t))o.mail=t;else{o.bml=mask(s0,120);warn.push('מייל')}return}
   if(m==='port'){const t=xlDate(v);if(t==='!')why.push('תאריך ניוד');else if(t)pr.d=t;return} // 00:21: נשמר כרשומה ב-ports
   if(m==='pbr'){const t=String(v).trim(),b=brAll().find(x=>x.id===t||x.name===t);if(!b)why.push('סניף');else pr.br=b.id;return} // 01:00: סניף הניוד – לפי שם או מזהה הסניף
   const s=String(v).trim();if(CARD8.test(s)){why.push('מספר ארוך');return}
   if(m==='name'||m==='addr'||CPK.includes(m))o[m]=s;else x[m]=s.slice(0,200)});
  // ערך ארוך ממגבלת השדה הנפרד – נשמר בשדה המלא (שם 60 / כתובת 150), כמו לקוח ישן
  if(['fn','ln'].some(k=>o[k]&&o[k].length>LIM[k])){const n=[o.fn,o.ln].filter(Boolean).join(' ');if(n.length>60)warn.push('שם קוצר');o.name=n.slice(0,60).trim();delete o.fn;delete o.ln}
  if(AP.some(k=>o[k]&&o[k].length>LIM[k])){const a=[o.st,o.city,o.fl&&'קומה '+o.fl,o.apt&&'דירה '+o.apt].filter(Boolean).join(', ');if(a.length>150)warn.push('כתובת קוצרה');o.addr=a.slice(0,150).trim();AP.forEach(k=>delete o[k])}
  if(Object.keys(x).length)o.x=x;if(Object.keys(pr).length&&cell())o.ports=[pr];joinC(o);if(o.card&&!o.card.num){delete o.card;warn.push('פרטי כרטיס בלי מספר')}if(!o.name&&!o.fn&&!o.bn){o.name='ללא שם';warn.push('שם')} // סבב 2 (הנחה 5): לא נדחית – שם זמני
  out.push({n:ri+2,o,why,warn})});
 return {out,cut,mk}}
// איחוד: ת"ז תקינה → לקוח; טלפון תקין → מצטרף ללקוח היחיד עם ת"ז ואותו טלפון, אחרת לקוח לפי טלפון; בלי שניהם – לקוח נפרד
function groupRows(rows){const T=new Map(),P=new Map(),TP=new Map(),G=[],L=[];let cardX=0,portX=0;
 const mk=r=>({n:r.n,ns:[r.n],o:{},warn:[]});
 const add=(g,r)=>{if(g.ns[g.ns.length-1]!==r.n&&g.o.name)g.ns.push(r.n);g.warn=g.warn.concat(r.warn);const a=g.o,b=r.o;
  for(const [k,v] of Object.entries(b)){
   if(k==='ports'){const ks=new Set((a.ports||[]).map(pKey));a.ports=a.ports||[];v.forEach(p=>{const q=pKey(p);if(!ks.has(q)){ks.add(q);if(a.ports.length<30)a.ports.push(p);else portX++}})}
   else if(k==='x'){a.x=Object.assign({},v,a.x||{})}
   else if(k==='card'){a.cards=a.cards||[];if(!a.cards.some(q=>q.num===v.num)){if(a.cards.length<3){a.cards.push(v);if(!a.last4)a.last4=v.num.slice(-4)}else cardX++}}
   else if(k==='last4'){if(!a.last4)a.last4=v}
   else if(INFK.includes(k)){const mx=INF.find(z=>z[0]===k)[2];if(!a[k])a[k]=v;else if(!a[k].split(' | ').includes(v)){const j=a[k]+' | '+v;if(j.length<=mx)a[k]=j}}
   else if(a[k]===undefined||a[k]==='')a[k]=v}};
 rows.forEach(r=>{if(r.o.tz){let g=T.get(r.o.tz);if(!g){g=mk(r);T.set(r.o.tz,g);G.push(g)}add(g,r);if(r.o.phone){const s=TP.get(r.o.phone)||new Set();s.add(g);TP.set(r.o.phone,s)}}});
 rows.forEach(r=>{if(r.o.tz)return;let g=null;if(r.o.phone){const s=TP.get(r.o.phone);if(s&&s.size===1)g=[...s][0];else{g=P.get(r.o.phone);if(!g){g=mk(r);P.set(r.o.phone,g);L.push(g)}}}else{g=mk(r);L.push(g)}add(g,r)});
 G.concat(L).forEach(g=>flagFix(g.o)); // סבב 2 (החלטה 4) – זהה לשרת
 return {G:G.concat(L),cardX,portX}}
// ללקוח עם טלפון/ת"ז תקינים לא נשמר ערך לא תקין נוסף (bph/btz); אם הוא שונה – מצטרף להערות (רק בעסק עם cellular)
function flagFix(o){const add=[];[['bph','phone','טלפון נוסף (לא תקין)'],['btz','tz','ת.ז נוספת (לא תקינה)']].forEach(([b,v,l])=>{if(!o[b]||!o[v])return;if(o[b]!==o[v])add.push(l+': '+o[b]);delete o[b]});
 if(add.length&&cell()){let n=o.note||'';add.forEach(a=>{if(!n.split(' | ').includes(a)){const j=n?n+' | '+a:a;if(j.length<=1000)n=j}});if(n)o.note=n}}
function prep(){const I=C.imp,{out,cut,mk}=prepRows(I);I.req=rid(); /* סבב 2: מזהה עבודה חדש לכל תצוגה מקדימה (מיפוי חדש); "נסה שוב" באותו מסך – אותו מזהה */const ok=out.filter(r=>!r.why.length),{G,cardX,portX}=groupRows(ok);
 I.out=out;I.G=G;I.cut=cut;I.mk=mk;I.cardX=cardX;I.portX=portX;I.R=null}
const gBad=g=>!!(g.o.bph||g.o.btz||g.o.bml||(g.o.ports||[]).some(p=>p.bph||p.btz));
const prevH=()=>{const I=C.imp,ok=I.G,bad=I.out.filter(r=>r.why.length),nl=ok.reduce((s,g)=>s+(g.o.ports||[]).length,0),nb=ok.filter(gBad).length;
 return `<h3>תצוגה מקדימה</h3><p><b>${ok.length}</b> לקוחות (מתוך ${I.out.length-bad.length} שורות)${cell()?` · <b>${nl}</b> קווים`:''} · <b>${bad.length}</b> שורות שגויות (לא ייובאו)</p>${nb?`<p class="note" style="color:var(--bad)">${nb} לקוחות עם טלפון/ת.ז/מייל לא תקינים – ייובאו כמו שהם עם סימון "לא תקין".</p>`:''}${I.cut?`<p class="note">${I.cut} מספרי כרטיס נחתכו ל-4 ספרות אחרונות.</p>`:''}${I.mk?`<p class="note">${I.mk} מספרי כרטיס בשדות טקסט הוסתרו.</p>`:''}${I.cardX?`<p class="note">${I.cardX} כרטיסים מעבר ל-3 ללקוח לא יישמרו.</p>`:''}${I.portX?`<p class="note">${I.portX} קווים מעבר ל-30 ללקוח לא נשמרו.</p>`:''}
 <div style="max-height:40vh;overflow:auto">${ok.slice(0,5).map(r=>`<div class="note" style="padding:4px 0;border-bottom:1px solid var(--line)">${esc(r.o.name||'')} · <bdi dir="ltr">${esc(r.o.phone||'')}</bdi>${r.o.tz?' · '+esc(r.o.tz):''}${r.o.last4?' · ****'+esc(r.o.last4):''}${r.o.cards?' · '+r.o.cards.length+' כרטיסים מוצפנים':''}${gBad(r)?' '+BADT:''}</div>`).join('')}
 ${bad.slice(0,50).map(r=>`<div class="note" style="padding:4px 0;border-bottom:1px solid var(--line);color:var(--bad)">שורה ${r.n}: ${esc(r.why.join(', '))}</div>`).join('')}</div>
 <p class="note">לקוח קיים (אותה ת.ז או טלפון) – רק שדות ריקים מתמלאים. אין כפולים.</p>
 <div class="row"><button class="btn grow" data-a="ocGo"${ok.length?'':' disabled'}>ייבא ${ok.length} לקוחות</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div>`};
/* 11.11.2026 (ייבוא ברקע): הקובץ נשלח לשרת (startImport, 200 לקוחות בקריאה) והשרת מייבא לבד – אפשר לצאת מהאפליקציה.
   ההתקדמות והסיכום – בכרטיס ברשימת הלקוחות ובמרכז הייבוא (orders-staff.js, impCardH). הייבוא הישן (importCusts) נשאר בשרת לטלפונים ישנים */
ACT.ocGo=async el=>{const I=C.imp;if(!I||!I.out)return;el.disabled=true;const ok=I.G;
 try{await window.__imp.send('cust',ok.map(x=>x.o),ok.map(x=>x.n),null,el,I.req.slice(1,21));
  C.imp.out=null;C.imp.G=null;C.imp=null;dlg(`<h3>הקובץ נשלח לשרת</h3><p>${ok.length} לקוחות מיובאים עכשיו בשרת. <b>אפשר לצאת מהאפליקציה</b> – הייבוא ממשיך, וההתקדמות והסיכום מופיעים ברשימת הלקוחות ובמרכז הייבוא.</p><button class="btn w" data-a="closeDlg">סגור</button>`)}
 catch(e){el.disabled=false;el.textContent='נסה שוב';err(e)}};

window.__ocLoad=f=>loadL(f);C.split=splitOld;C.prepRows=prepRows;C.groupRows=groupRows;C.guess=guess;window.__oc=C;
})();
