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
const O=window.__ox;
const C={L:null,cfg:null,busy:0,at:0,q:'',hit:{},imp:null};
const on=()=>(isA()||isW()||!!(SY&&SY.sa))&&bzF('orders')&&wp('ord');
/* 00:24: ניודים – רק כשמנהל־העל הפעיל את cellular בעסק (גם בעסק הישן – ברירת מחדל כבוי). כבוי = מוסתר, הנתונים נשארים */
const cell=()=>{const b=SY&&SY.biz;return !!(b&&b.features&&b.features.cellular===true)&&bzF('cellular')};
const mgr=()=>isA()||!!(SY&&SY.sa);
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
const portTxt=p=>[p.d?'תאריך '+esc(p.d):'',p.phone?'טלפון <bdi dir="ltr">'+esc(p.phone)+'</bdi>':'',p.tz?'ת.ז '+esc(p.tz):'',p.br?'סניף '+esc(brNm(p.br)||p.br):''].filter(Boolean).join(' · ');
const xKeys=()=>(C.cfg&&Array.isArray(C.cfg.xKeys)?C.cfg.xKeys:[]).filter(x=>x&&x.k);

/* ---------- קריאה ---------- */
async function getC(id){try{const d=await fsx('/cust/'+id);return d?dec(d):null}catch(e){if(e.code===404)return null;throw e}}
async function byTz(z){let c=await getC('t'+z);return c}
// כל הלקוחות עם הטלפון (p{phone} ישן + לקוחות נוספים c… / t… עם אותו טלפון). בלי מסמכים שהועברו (mv)
async function byPhoneAll(p){const out=[],seen=new Set(),add=c=>{if(c&&!c.mv&&!seen.has(c.id)){seen.add(c.id);out.push(c)}};let c=await getC('p'+p);if(c&&c.mv)c=await getC(c.mv);add(c);
 const r=await fsx(':runQuery',{method:'POST',body:JSON.stringify({structuredQuery:{from:[{collectionId:'cust'}],where:{fieldFilter:{field:{fieldPath:'phone'},op:'EQUAL',value:{stringValue:p}}},limit:10}})});
 (r||[]).filter(x=>x.document).map(x=>dec(x.document)).filter(x=>x.phone===p).forEach(add);return out}
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
const LDK=['name','addr'].concat(CPK);
function dropLoaded(D){const F=D.cFrom||{};LDK.concat(['phone','mail'].filter(k=>F[k]&&String(D[k]||'').trim()===F[k])).forEach(k=>{D[k]='';document.querySelectorAll('#main input[data-i=oxD][data-k='+k+']').forEach(e=>{e.value=''})});D.cName='';D.cFrom=null;D.wholesale=false}
function fillDraft(D,c){if(D.custId&&D.custId!==c.id)dropLoaded(D);D.name='';D.addr='';splitOld(c,D);['phone','mail'].forEach(k=>{if(c[k]&&!String(D[k]||'').trim())D[k]=String(c[k])});D.cFrom={phone:String(c.phone||''),mail:String(c.mail||''),tz:String(c.tz||'')};D.tz=c.tz||D.tz;D.custId=c.id;D.wholesale=c.wholesale===true;D.cName=c.name||''}
const NEWB='<button type="button" class="btn g s w" data-a="ocAsNew">לקוח חדש עם אותו טלפון</button>';
const custBox=D=>{const st=D.cSt,w=h=>`<div role="status" id="ocst">${h}</div>`;
 if(st==='found')return w(`<p class="note">לקוח קיים: <b>${esc(D.cName)}</b>${D.wholesale?' '+WSTAG:''} – הפרטים מולאו. פרטים שתוסיפו (כמו כתובת) יצורפו ללקוח.</p>${NEWB}`);
 if(st==='hits')return w(`<p class="note">לטלפון הזה כבר יש ${(D.cHits||[]).length>1?(D.cHits||[]).length+' לקוחות':'לקוח'}. בחרו:</p>${(D.cHits||[]).map(c=>`<button type="button" class="li" data-a="ocPick" data-id="${esc(c.id)}"><div class="m"><b>${cLabel(c)}</b><small>${esc(c.addr||'')}</small></div>${ico('chev')}</button>`).join('')}${NEWB}`);
 if(st==='asnew')return w(`<p class="note">לקוח חדש עם טלפון קיים – יישמר כלקוח נפרד.</p><button type="button" class="btn g s w" data-a="ocPhAgain">חזרה ללקוחות הקיימים</button>`);
 return w(st==='new'?'<p class="note">לקוח חדש – ממלאים שם פרטי ושם משפחה, והלקוח יישמר עם ההזמנה</p>':st==='bad'?'<p class="note">ת.ז לא תקינה</p>':st==='wait'?'<p class="note">מחפש…</p>':'')};
const tzVis=D=>(cell()&&!!(D.cell&&D.cell.on))||!!dig(D.tz);
{const nw=V.oxNew;if(nw)V.oxNew=()=>{const r=nw();if(!r||!r.h||!on())return r;const D=O.draft;if(!D)return r;
  if(!C.cfg)cfgLoad();
  // ניוד קווים (orders-lines.js, נטען אחרי הקובץ הזה): סימון/ביטול ניוד מצייר מחדש, כדי ששדה הת"ז יופיע/ייעלם
  if(typeof CHG!=='undefined'&&CHG.olOn&&!CHG.olOn.__oc){const f=CHG.olOn;CHG.olOn=el=>{f(el);rerender()};CHG.olOn.__oc=1}
  let h=r.h.replace(/<label class="f"><span>ת\.ז<\/span><input data-i="oxD" data-k="tz"[^>]*><\/label>/,'');
  const ad=AP.some(k=>String(D[k]||'').trim())||String(D.mail||'').trim();
  h=h.replace(/<details><summary([^>]*)>ת\.ז, כתובת ומייל \(רשות\)<\/summary>/,`<details${ad?' open':''}><summary$1>משלוח – כתובת, עיר, קומה ודירה (רשות)</summary>`);
  const ph=/<label class="f"><span>טלפון<\/span><input data-i="oxD" data-k="phone"[^>]*><\/label>/.exec(h);
  if(ph){h=h.replace(ph[0],'');h=h.replace('<div class="card">','<div class="card">'+ph[0].replace('<span>טלפון</span>','<span>טלפון הלקוח (מקלידים קודם – לקוח קיים יימצא לבד)</span>')+custBox(D)+(tzVis(D)?`<label class="f"><span>ת.ז הלקוח (לניוד קווים)</span><input data-i="ocTz" data-k="tz" inputmode="numeric" maxlength="9" autocomplete="off" value="${esc(D.tz||'')}" id="octz"></label>`:''))}
  r.h=h;r.s='טלפון, פרטי לקוח ומוצרים';return r}}
// טלפון בהזמנה: טלפון תקין → חיפוש הלקוחות שלו. שינוי טלפון אחרי בחירת לקוח – מנתק את הקישור (הפרטים שהוקלדו נשארים)
const phSearch=D=>{const p=phN(D.phone);if(D.custId&&(!D.cFrom||D.cFrom.phone!==p)){const ph=D.phone,tz=D.cFrom&&D.cFrom.tz;if(tz&&dig(D.tz)===tz)D.tz='';dropLoaded(D);D.phone=ph;D.custId=''}
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
// שמירת הזמנה → קודם הלקוח (fill: רק שדות ריקים; id = הלקוח שנבחר; asNew = לקוח נוסף עם אותו טלפון). כשל בשמירת הלקוח לא עוצר את ההזמנה.
// לקוח חדש שנשמר – ההזמנה מקושרת אליו (custId)
{const sv=ACT.oxSave;if(sv)ACT.oxSave=async el=>{const D=O.draft;if(D)joinC(D);
  // סבב 1 (ליקוי 1): לקוח חדש (לא נבחר מהרשימה) – שם פרטי ושם משפחה, כל אחד בנפרד
  if(D&&on()&&!D.custId){if(!String(D.fn||'').trim())return toast('חסר שם פרטי');if(!String(D.ln||'').trim())return toast('חסר שם משפחה')}
  if(D&&on()){const tz=dig(D.tz);if(tz&&!tzOk(tz.padStart(9,'0')))return toast('ת.ז לא תקינה');
   const p=phN(D.phone);if(p&&String(D.name||'').trim()&&D.items&&D.items.length){const c={};if(!NP.some(k=>String(D[k]||'').trim()))c.name=D.name.trim();c.phone=p;if(tz)c.tz=tz;if(D.mail)c.mail=D.mail.trim();CPK.forEach(k=>{const v=String(D[k]||'').trim();if(v)c[k]=v});if(D.addr&&!AP.some(k=>c[k]))c.addr=D.addr.trim();
    const a={fill:true,cust:c};if(D.custId)a.id=D.custId;else if(D.asNew)a.asNew=true;
    try{const r=await fnCall('saveCust',a);C.at=0;if(!D.custId&&r&&r.id){D.custId=r.id;D.asNew=false}}catch(e){toast('ההזמנה נשמרת, אבל פרטי הלקוח לא נשמרו: '+(e.message||''))}}}
  return sv(el)}}

/* ---------- כניסה: כפתור "לקוחות" במסך ההזמנות ---------- */
{const ox=V.ox;if(ox)V.ox=()=>{const r=ox();if(on()&&r&&r.h&&r.h.includes('data-v="oxStock"'))r.h=r.h.replace(/(<button class="btn g grow" data-a="go" data-v="oxStock">מלאי<\/button>)/,'$1<button class="btn g grow" data-a="go" data-v="ocList">לקוחות</button>');return r}}

/* ---------- רשימת לקוחות ---------- */
const crow=c=>`<button class="li" data-a="go" data-v="ocCard" data-arg="${esc(c.id)}"><div class="m"><b>${cLabel(c)}</b><small dir="ltr" style="text-align:right">${esc(c.phone||'')}${c.tz?' · '+esc(c.tz):''}</small></div>${ico('chev')}</button>`;
const match=(c,q)=>!q||String(c.name||'').includes(q)||String(c.bn||'').includes(q)||String(c.phone||'').includes(dig(q)||'\u0000')||String(c.tz||'').includes(dig(q)||'\u0000');
const listH=()=>{const L=(C.L||[]).filter(c=>match(c,C.q.trim()));return L.slice(0,200).map(crow).join('')+(L.length>200?`<p class="note">מוצגים 200 מתוך ${L.length}. חפשו כדי לצמצם.</p>`:'')||'<div class="empty">אין לקוחות</div>'};
V.ocList=()=>{const T='לקוחות';if(!on())return{t:T,h:'<div class="empty">אין לך הרשאה להזמנות</div>'};if(!C.L){loadL();return{t:T,h:'<div class="empty">טוען…</div>'}}
 return{t:T,s:C.L.length+' לקוחות',h:`<div class="row" style="margin-bottom:8px"><button class="btn grow" data-a="ocNew">${ico('plus')}לקוח חדש</button>${mgr()?'<button class="btn g grow" data-a="ocImp">ייבוא מאקסל</button>':''}</div>
 ${mgr()?'<button class="btn g s w" data-a="ocCfg">שדות נוספים ללקוח</button>':''}
 <label class="f"><span>חיפוש (שם, טלפון או ת.ז)</span><input data-i="ocQ" value="${esc(C.q)}" autocomplete="off"></label><div id="ocl">${listH()}</div>
 <button class="btn g s w" style="margin-top:8px" data-a="ocRe">רענן</button>`}};
INP.ocQ=el=>{C.q=el.value;const x=document.getElementById('ocl');if(x)x.innerHTML=listH()};
ACT.ocRe=()=>loadL(true);

/* ---------- כרטיס לקוח ---------- */
const ordsOf=c=>(O.L||[]).filter(o=>o.custId?o.custId===c.id:o.cust&&((c.tz&&o.cust.tz===c.tz)||(c.phone&&o.cust.phone===c.phone))).sort((a,b)=>(b.at||0)-(a.at||0));
V.ocCard=id=>{const T='לקוח';if(!on())return{t:T,h:'<div class="empty">אין לך הרשאה להזמנות</div>'};if(!C.L){loadL();return{t:T,h:'<div class="empty">טוען…</div>'}}
 const c=C.L.find(x=>x.id===id);if(!c)return{t:T,h:'<div class="empty">הלקוח לא נמצא</div>'};
 if(!O.L&&!C.ol){C.ol=1;fnLoadOrders()}
 const xs=xKeys().filter(k=>c.x&&c.x[k.k]).map(k=>`<p class="note" style="margin:0">${esc(k.label)}: ${esc(c.x[k.k])}</p>`).join('');
 const L=ordsOf(c);
 return{t:c.name||c.bn||T,s:c.wholesale===true?'לקוח עסקי (סיטונאי)':'לקוח רגיל',h:`<div class="card"><div class="row" style="justify-content:space-between"><b>${esc(c.name||c.bn||'')}</b>${c.wholesale===true?WSTAG:''}</div>
 ${c.bn&&c.bn!==c.name?`<p class="note" style="margin:0">שם העסק: ${esc(c.bn)}</p>`:''}${c.vat?`<p class="note" style="margin:0">ע.מ ${esc(c.vat)}</p>`:''}${c.ct?`<p class="note" style="margin:0">איש קשר: ${esc(c.ct)}</p>`:''}${c.pay?`<p class="note" style="margin:0">תנאי תשלום: ${esc(payTxt(c))}</p>`:''}
 <p style="margin:6px 0"><a href="tel:${esc(c.phone||'')}" dir="ltr" style="color:var(--acc);display:inline-flex;min-height:44px;align-items:center">${esc(c.phone||'')}</a></p>
 ${c.tz?`<p class="note" style="margin:0">ת.ז ${esc(c.tz)}</p>`:''}${c.mail?`<p class="note" style="margin:0" dir="ltr">${esc(c.mail)}</p>`:''}${c.addr?`<p class="note" style="margin:0">${esc(c.addr)}</p>`:''}
 ${c.last4?`<p class="note" style="margin:0">כרטיס ****${esc(c.last4)}${c.card===true?' · שמור מוצפן':''}</p>`:''}${cell()&&portsOf(c).length?'<p class="note" style="margin:6px 0 0"><b>ניודים קודמים</b></p>'+portsOf(c).map(p=>`<p class="note" style="margin:0">${portTxt(p)}</p>`).join(''):''}${xs}</div>
 <div class="row" style="margin-top:8px"><button class="btn g grow" data-a="ocEdit" data-id="${esc(c.id)}">עריכת פרטים</button>${mgr()?`<button class="btn g grow" data-a="ocWs" data-id="${esc(c.id)}">${c.wholesale===true?'הפוך ללקוח רגיל':'סמן כלקוח עסקי (סיטונאי)'}</button>`:''}</div>
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
const cardMgrH=c=>`<div class="sec"><h3>כרטיס אשראי</h3></div><div class="card" id="occard">${c.card===true?`<p class="note" style="margin:0">כרטיס ****${esc(c.last4||'')} · מוצפן בשרת. כל הצגה והעתקה נרשמות ביומן.</p>
 <div id="occv"></div><div class="row" style="margin-top:8px"><button class="btn g grow" data-a="ocCardView" data-id="${esc(c.id)}">הצג פרטי כרטיס</button><button class="btn g grow" data-a="ocCardCopy" data-id="${esc(c.id)}">העתק מספר</button></div>
 <div class="row" style="margin-top:8px"><button class="btn g grow" data-a="ocCardSet" data-id="${esc(c.id)}">החלף כרטיס</button><button class="btn g grow" data-a="ocCardDel" data-id="${esc(c.id)}">מחק פרטי כרטיס</button></div>`
 :`<p class="note" style="margin:0">אין כרטיס שמור</p><button class="btn g w" style="margin-top:8px" data-a="ocCardSet" data-id="${esc(c.id)}">הוספת כרטיס</button>`}</div>`;
// ליקוי 5: אחרי 45 שניות הלוח מתנקה – אם אפשר לקרוא, רק כשהתוכן עדיין זהה; בלי הרשאת קריאה – כותבים ריק. כל כישלון נבלע.
let clipT=null;const CLIP_MS=45000;
const clipClear=t=>{clipT=null;const cb=navigator.clipboard;if(!cb||!cb.writeText)return;const w=()=>cb.writeText('').catch(()=>{});
 try{if(cb.readText)cb.readText().then(x=>{if(x===t)w()},w);else w()}catch(e){w()}};
const copyTxt=t=>(navigator.clipboard&&navigator.clipboard.writeText?navigator.clipboard.writeText(t):Promise.reject()).then(()=>{if(clipT)clearTimeout(clipT);clipT=setTimeout(()=>clipClear(t),CLIP_MS);toast('הועתק. הלוח יתנקה בעוד 45 שניות. הפעולה נרשמה ביומן')},()=>toast('ההעתקה נכשלה'));
ACT.ocCardView=async el=>{el.disabled=true;try{const r=await fnCall('getCard',{custId:el.dataset.id,act:'view'});const k=r.card||{};const b=document.getElementById('occv');unshow();
  if(b){b.innerHTML=`<p style="margin:6px 0" dir="ltr"><b>${esc(String(k.num||'').replace(/(\d{4})(?=\d)/g,'$1 '))}</b></p><p class="note" style="margin:0">תוקף ${esc(k.exp||'—')} · CVV ${esc(k.cvv||'—')}</p><p class="note" style="margin:0">${esc(k.name||'')}</p><p class="note" style="margin:0">(יוסתר בעוד 30 שניות)</p>`;
   shown={t:setTimeout(()=>{const x=document.getElementById('occv');if(x)x.innerHTML='';shown=null},30000)}}}catch(e){err(e)}finally{el.disabled=false}};
ACT.ocCardCopy=async el=>{el.disabled=true;try{const a={custId:el.dataset.id,act:'copy'};if(el.dataset.ord)a.ordId=el.dataset.ord;const r=await fnCall('getCard',a);await copyTxt(String(r.card&&r.card.num||''))}catch(e){err(e)}finally{el.disabled=false}};
ACT.ocCardDel=el=>ask('למחוק את פרטי הכרטיס של הלקוח? אי אפשר לשחזר.',async()=>{try{await fnCall('delCard',{custId:el.dataset.id});toast('פרטי הכרטיס נמחקו');await loadL(true)}catch(e){err(e)}},'מחק');
ACT.ocCardSet=el=>dlg(`<h3>פרטי כרטיס אשראי</h3><form data-f="ocCardF"><input type="hidden" name="id" value="${esc(el.dataset.id)}">${el.dataset.ord?`<input type="hidden" name="ord" value="${esc(el.dataset.ord)}">`:''}
 ${fld('מספר כרטיס','num','','text','inputmode="numeric" autocomplete="off" required maxlength="23" dir="ltr"')}${fld('תוקף (MM/YY)','exp','','text','inputmode="numeric" autocomplete="off" maxlength="7" dir="ltr"')}
 ${fld('שם בעל הכרטיס','name','','text','autocomplete="off" maxlength="60"')}${fld('CVV','cvv','','text','inputmode="numeric" autocomplete="off" maxlength="4" dir="ltr"')}
 <p class="note">נשמר מוצפן בשרת. באפליקציה נשארות רק 4 ספרות אחרונות.</p><div class="row"><button class="btn grow">שמור</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`);
FRM.ocCardF=async f=>{const v=fd(f);const card={num:v.num};['exp','name','cvv'].forEach(k=>{if(String(v[k]||'').trim())card[k]=String(v[k]).trim()});const a={custId:v.id,card};if(v.ord)a.ordId=v.ord;
 const b=f.querySelector('button');b.disabled=true;try{await fnCall('setCard',a);f.reset();closeDlg();toast('הכרטיס נשמר מוצפן');await loadL(true);rerender()}catch(e){b.disabled=false;err(e)}};
// כרטיס הזמנה (עובד ומנהל): הזמנה שלא שולמה ומקושרת ללקוח → העתקת מספר / הזנת כרטיס
{const oo=V.oxOrd;if(oo)V.oxOrd=id=>{const r=oo(id);unshow();if(!r||!r.h||!on())return r;const o=(O.L||[]).find(x=>x.id===id);if(!o||!o.custId||!['new','work','wait_pay'].includes(o.status))return r;
  if(!C.L&&!C.busy)loadL();const c=(C.L||[]).find(x=>x.id===o.custId);
  const h=`<div class="sec"><h3>כרטיס אשראי</h3></div><div class="card" id="ocordcard">${c&&c.card===true?`<p class="note" style="margin:0">כרטיס ****${esc(c.last4||'')} שמור. ההעתקה נרשמת ביומן.</p><button class="btn g w" style="margin-top:8px" data-a="ocCardCopy" data-id="${esc(o.custId)}" data-ord="${esc(o.id)}">העתק מספר כרטיס</button>`
   :`<p class="note" style="margin:0">${c?'אין כרטיס שמור':'…'}</p>`}${c?`<button class="btn g w" style="margin-top:8px" data-a="ocCardSet" data-id="${esc(o.custId)}" data-ord="${esc(o.id)}">${c.card===true?'החלף כרטיס':'הזנת כרטיס'}</button>`:''}</div>`;
  r.h=r.h.replace('<div class="sec"><h3>היסטוריה</h3></div>',h+'<div class="sec"><h3>היסטוריה</h3></div>');return r}}

/* ---------- טופס לקוח (חדש / עריכה) ---------- */
const pRows=()=>(C.pf||[]).map((p,i)=>`<div class="card" style="margin:6px 0"><div class="row"><label class="f grow"><span>תאריך ניוד</span><input type="date" name="pd${i}" value="${esc(p.d||'')}" dir="ltr"></label><label class="f grow"><span>טלפון שנויד</span><input name="pp${i}" type="tel" inputmode="tel" value="${esc(p.phone||'')}" dir="ltr"></label></div><div class="row"><label class="f grow"><span>ת.ז שעליה נויד</span><input name="pt${i}" inputmode="numeric" maxlength="9" value="${esc(p.tz||'')}"></label><button type="button" class="btn g s" data-a="ocPDel" data-n="${i}">מחק</button></div></div>`).join('')||'<p class="note">אין ניודים קודמים</p>';
const pRead=()=>{const f=document.querySelector('#dlg form');if(!f)return;const v=fd(f);C.pf=(C.pf||[]).map((p,i)=>Object.assign({d:v['pd'+i]||'',phone:v['pp'+i]||'',tz:v['pt'+i]||''},p.br?{br:p.br}:{}))};
ACT.ocPAdd=()=>{pRead();if(C.pf.length>=30)return toast('עד 30 ניודים');C.pf.push({});const b=document.getElementById('ocpl');if(b)b.innerHTML=pRows()};
ACT.ocPDel=el=>{pRead();C.pf.splice(+el.dataset.n,1);const b=document.getElementById('ocpl');if(b)b.innerHTML=pRows()};
/* 2026-11-09: סוג לקוח בטופס חדש – רגיל (שם פרטי, משפחה, טלפון; כתובת למשלוח רשות; ת"ז רק לניוד) או עסקי (שם העסק, ע.מ, איש קשר, טלפון, כתובת, עיר, תנאי תשלום) */
const isBiz=c=>c?(!!c.bn||C.wsMark===c.id):C.ft==='biz'; // לקוח סיטונאי ישן בלי שם עסק – נערך בטופס הרגיל, כמו קודם
const bizH=c=>{const v=k=>c&&c[k]||'',pay=v('pay');return `${fld('שם העסק','bn',v('bn'),'text','required maxlength="60"')}${fld('ע.מ (9 ספרות)','vat',v('vat'),'text','required inputmode="numeric" maxlength="11" autocomplete="off" dir="ltr"')}${fld('איש קשר','ct',v('ct'),'text','required maxlength="60"')}
 <label class="f"><span>תנאי תשלום</span><select name="pay" data-c="ocPay" required><option value="">בחרו</option>${PAYS.map(([k,l])=>`<option value="${k}"${pay===k?' selected':''}>${l}</option>`).join('')}</select></label>
 <div id="ocpayx"${pay==='other'?'':' hidden'}>${fld('פירוט תנאי התשלום','payTxt',v('payTxt'),'text','maxlength="60"')}</div>`};
CHG.ocPay=el=>{const b=document.getElementById('ocpayx');if(b)b.hidden=el.value!=='other'};
const cForm=c=>{const x=c&&c.x||{},s=splitOld(c||{},{}),bz=isBiz(c);C.pf=portsOf(c);return `<h3>${c?'עריכת לקוח':'לקוח חדש'}</h3>${c?'':`<div class="row" role="group" aria-label="סוג לקוח" style="margin-bottom:8px"><button type="button" class="btn grow${bz?' g':''}" data-a="ocFt" data-t="reg" aria-pressed="${!bz}">לקוח רגיל</button><button type="button" class="btn grow${bz?'':' g'}" data-a="ocFt" data-t="biz" aria-pressed="${bz}">לקוח עסקי (סיטונאי)</button></div>`}<form data-f="ocF">${bz?'<input type="hidden" name="biz" value="1">':''}${c&&C.wsMark===c.id?'<input type="hidden" name="wsmark" value="1">':''}${s.name?`<input type="hidden" name="oname" value="${esc(s.name)}">`:''}${s.addr?`<input type="hidden" name="oaddr" value="${esc(s.addr)}">`:''}${c?`<input type="hidden" name="id" value="${esc(c.id)}">`:''}
 ${bz?bizH(c):''}${(s.name&&!bz?`<p class="note">שם קיים: ${esc(s.name)} (נשמר כמו שהוא אם משאירים ריקים את השם הפרטי ושם המשפחה)</p>`:'')+(bz?'':fld('שם פרטי','fn',s.fn||'','text',(s.name?'':'required ')+'maxlength="30"')+fld('שם משפחה','ln',s.ln||'','text',(s.name?'':'required ')+'maxlength="30"'))}${fld('טלפון','phone',c&&c.phone||'','tel','inputmode="tel" required'+(c&&/^p/.test(c.id)?' readonly':''))}
 ${fld(c&&c.tz?'ת.ז':'ת.ז (רק ללקוח עם ניוד קווים – רשות)','tz',c&&c.tz||'','text','inputmode="numeric" maxlength="9" autocomplete="off"'+(c&&c.tz?' readonly':''))}
 ${fld('מייל','mail',c&&c.mail||'','email','dir="ltr"')}${(s.addr?`<p class="note">כתובת קיימת: ${esc(s.addr)} (נשמרת כמו שהיא אם לא ממלאים רחוב/עיר)</p><label class="row" style="min-height:44px;gap:8px"><input type="checkbox" name="odel" value="1">מחק את הכתובת הקיימת</label>`:'')+fld(bz?'כתובת (רחוב ומספר)':'רחוב ומספר','st',s.st||'','text',(bz?'required ':'')+'maxlength="80"')}${fld('עיר','city',s.city||'','text',(bz?'required ':'')+'maxlength="40"')}<div class="row"><div class="grow">${fld('קומה','fl',s.fl||'','text','maxlength="10"')}</div><div class="grow">${fld('דירה','apt',s.apt||'','text','maxlength="10"')}</div></div>
 ${fld('4 ספרות אחרונות של כרטיס (רשות)','last4',c&&c.last4||'','text','inputmode="numeric" maxlength="4" autocomplete="off"')}
 ${xKeys().map(k=>fld(esc(k.label),'x_'+k.k,x[k.k]||'','text','maxlength="200"')).join('')}
 ${cell()?`<div class="sec"><h3>ניודים קודמים</h3></div><div id="ocpl">${pRows()}</div><button type="button" class="btn g s w" data-a="ocPAdd">＋ ניוד</button>`:''}
 <p class="note">לא מקלידים מספר כרטיס מלא, תוקף או קוד.</p><div class="row"><button class="btn grow">שמור</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`};
ACT.ocNew=async()=>{if(!C.cfg)await cfgLoad();C.ft='reg';C.wsMark=null;dlg(cForm(null))};
ACT.ocFt=el=>{C.ft=el.dataset.t==='biz'?'biz':'reg';dlg(cForm(null))};
ACT.ocEdit=async el=>{if(!C.cfg)await cfgLoad();C.wsMark=null;const c=(C.L||[]).find(x=>x.id===el.dataset.id);if(c){C.ea=!!(c.addr||AP.some(k=>c[k]));dlg(cForm(c))}};
FRM.ocF=async f=>{pRead();const v=fd(f),tz=dig(v.tz),bz=!!v.biz;if(CPK.concat(['mail','bn','ct','payTxt']).concat(xKeys().map(k=>'x_'+k.k)).some(n=>CARD8.test(v[n]||'')))return toast('אסור להקליד מספר כרטיס או מספר ארוך. מותר רק 4 ספרות אחרונות.');if(tz&&!tzOk(tz.padStart(9,'0')))return toast('ת.ז לא תקינה');if(!phN(v.phone))return toast('טלפון לא תקין');
 const k=l4(v.last4);if(k.bad)return toast('4 ספרות בדיוק');
 const P=[];for(const p of C.pf||[]){const o={};if(p.d)o.d=p.d;if(String(p.phone).trim()){o.phone=phN(p.phone);if(!o.phone)return toast('טלפון ניוד לא תקין')}if(dig(p.tz)){const z=tzN(p.tz);if(!z||!tzOk(z))return toast('ת.ז ניוד לא תקינה');o.tz=z}if(Object.keys(o).length){if(p.br&&brAll().some(b=>b.id===p.br))o.br=p.br;P.push(o)}}
 v.fn=v.fn||'';v.ln=v.ln||'';
 const bzReq=bz&&(!v.id||!!v.wsmark||!(C.L||[]).some(x=>x.id===v.id&&x.wholesale===true)); // לקוח עסקי חדש / סימון חדש – כל השדות חובה
 if(bz){const t=String(v.vat||'').replace(/[\s-]/g,''),e=k=>!String(v[k]||'').trim();if(e('bn'))return toast('חסר שם העסק');if(t&&!/^\d{9}$/.test(t))return toast('ע.מ: 9 ספרות');
  if(bzReq){if(!t)return toast('חסר ע.מ');if(e('ct'))return toast('חסר איש קשר');if(e('st'))return toast('חסרה כתובת');if(e('city'))return toast('חסרה עיר');if(e('pay'))return toast('בחרו תנאי תשלום')}
  if(v.pay==='other'&&!String(v.payTxt||'').trim())return toast('כתבו את תנאי התשלום')}
 else{if(!v.fn.trim()&&(!v.oname||v.ln.trim()))return toast(v.oname?'ממלאים שם פרטי, או משאירים את שני שדות השם ריקים כדי לשמור את השם הקיים':'חסר שם פרטי');if(v.fn.trim()&&!v.ln.trim())return toast('חסר שם משפחה')}
 const c={phone:phN(v.phone)};if(cell())c.ports=P;if(tz)c.tz=tz;CPK.forEach(n=>c[n]=(v[n]||'').trim());if(!c.fn&&!c.ln){delete c.fn;delete c.ln;if(v.oname)c.name=v.oname}
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
const MAPF=[['fn','שם פרטי'],['ln','שם משפחה'],['name','שם מלא'],['phone','טלפון'],['tz','ת.ז'],['mail','מייל'],['st','רחוב ומספר'],['city','עיר'],['fl','קומה'],['apt','דירה'],['addr','כתובת מלאה'],['last4','4 ספרות אחרונות'],['port','תאריך ניוד'],['pph','טלפון ניוד'],['ptz','ת.ז ניוד'],['pbr','סניף הניוד'],['cnum','מספר כרטיס מלא (מוצפן)'],['cexp','תוקף כרטיס'],['cname','שם בעל הכרטיס'],['ccvv','CVV']];
const MK='lp-ocmap';
ACT.ocImp=()=>{dlg(`<h3>ייבוא לקוחות</h3><p class="note">קובץ Excel או CSV. השורה הראשונה – כותרות. אחר כך בוחרים איזו עמודה היא מה.</p>
 <label class="btn w" style="display:flex;align-items:center;justify-content:center">בחירת קובץ<input type="file" accept=".xlsx,.xls,.csv,text/csv" data-c="ocFile" hidden></label>
 <p class="note">עמודה שתסומן "מספר כרטיס מלא (מוצפן)" (וגם תוקף, שם, CVV) – נשמרת מוצפנת בשרת. מספר כרטיס בכל עמודה אחרת – נשמרות רק 4 הספרות האחרונות. עמודת "סיטונאי" – לא מיובאת (מסמנים ידנית).</p><button type="button" class="btn g w" data-a="closeDlg">ביטול</button>`)};
const guess=(h)=>{const s=String(h||'').replace(/["'\s.]/g,'');return /סניף/.test(s)&&!/בנק/.test(s)?'pbr':/ניוד/.test(s)?(/טל|נייד|phone/i.test(s.replace('ניוד',''))?'pph':/זהות|תז/.test(s)?'ptz':'port'):/cvv|קודאבטחה|ספרותבגב/i.test(s)?'ccvv':/תוקף|exp/i.test(s)?'cexp':/בעלהכרטיס|holder/i.test(s)?'cname':/פרטי/.test(s)?'fn':/משפחה/.test(s)?'ln':/שם/.test(s)?'name':/^עיר|ישוב|יישוב|city/i.test(s)?'city':/קומה/.test(s)?'fl':/דירה/.test(s)?'apt':/רחוב|street/i.test(s)?'st':/טל|נייד|phone/i.test(s)?'phone':/זהות|תז|^id$/i.test(s)?'tz':/מייל|דואל|mail/i.test(s)?'mail':/כתובת|addr/i.test(s)?'addr':/4|אחרונות|last/i.test(s)?'last4':''};
CHG.ocFile=async el=>{const f=el.files[0];el.value='';if(!f)return;if(/\.pdf$/i.test(f.name))return toast('רק Excel או CSV');
 try{if(!C.cfg)await cfgLoad();const rows=(await readTable(f)).filter(r=>Array.isArray(r)&&r.some(c=>String(c).trim()));if(rows.length<2)return toast('אין שורות בקובץ');
  const H=rows[0].map(x=>String(x==null?'':x).trim().slice(0,40));let saved={};try{saved=JSON.parse(localStorage.getItem(MK)||'{}')}catch(e){}
  C.imp={H,R:rows.slice(1),req:rid(),map:H.map(h=>{const m=saved[h]!==undefined?saved[h]:(guess(h)||'x+');return !cell()&&['port','pph','ptz','pbr'].includes(m)?'':m})};dlg(mapH())}catch(e){err(e)}};
const optH=(v)=>`<option value="">לא לייבא</option>${MAPF.filter(x=>cell()||!['port','pph','ptz','pbr'].includes(x[0])).map(([k,l])=>`<option value="${k}"${v===k?' selected':''}>${l}</option>`).join('')}${xKeys().map(k=>`<option value="${esc(k.k)}"${v===k.k?' selected':''}>שדה: ${esc(k.label)}</option>`).join('')}<option value="x+"${v==='x+'?' selected':''}>שדה נוסף חדש</option>`;
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
function prep(){const I=C.imp,out=[];let cut=0;
 I.R.forEach((r,ri)=>{const o={},x={},why=[],pr={};I.map.forEach((m,i)=>{if(!m)return;let v=r[i];if(v==null||String(v).trim()==='')return;
   const d=digs(v);
   if(m==='cnum'){if(/^\d{13,19}$/.test(d)){o.card=Object.assign(o.card||{},{num:d});o.last4=d.slice(-4)}else why.push('מספר כרטיס');return}
   if(m==='cexp'||m==='cname'||m==='ccvv'){o.card=Object.assign(o.card||{},{[m.slice(1)]:m==='cexp'&&typeof v==='number'?xlDate(v).slice(5,7)+'/'+xlDate(v).slice(2,4):String(v).trim()});return}
   if(m==='last4'){const k=l4(v);if(k.bad)why.push('4 ספרות');else{o.last4=k.v;if(k.cut)cut++}return}
   if(/^\d{13,19}$/.test(d)){if(!o.last4)o.last4=d.slice(-4);cut++;return} // מספר כרטיס בעמודה אחרת → 4 ספרות בלבד
   if(m==='phone'){const p=phN(v);if(!p)why.push('טלפון');else o.phone=p;return}
   if(m==='tz'){const z=tzN(v);if(!z||!tzOk(z))why.push('ת.ז');else o.tz=z;return}
   if(m==='port'){const t=xlDate(v);if(t==='!')why.push('תאריך ניוד');else if(t)pr.d=t;return} // 00:21: נשמר כרשומה ב-ports
   if(m==='pph'){const p=phN(v);if(!p)why.push('טלפון ניוד');else pr.phone=p;return}
   if(m==='pbr'){const t=String(v).trim(),b=brAll().find(x=>x.id===t||x.name===t);if(!b)why.push('סניף');else pr.br=b.id;return} // 01:00: סניף הניוד – לפי שם או מזהה הסניף
   if(m==='ptz'){const z=tzN(v);if(!z||!tzOk(z))why.push('ת.ז ניוד');else pr.tz=z;return}
   const s=String(v).trim();if(CARD8.test(s)){why.push('מספר ארוך');return}
   if(m==='name'||m==='mail'||m==='addr'||CPK.includes(m))o[m]=s;else x[m]=s.slice(0,200)});
  if(Object.keys(x).length)o.x=x;if(Object.keys(pr).length&&cell())o.ports=[pr];joinC(o);if(o.card&&!o.card.num){delete o.card;why.push('פרטי כרטיס בלי מספר')}if(!o.phone&&!o.tz)why.push('אין טלפון/ת.ז');if(!o.name&&!why.length)why.push('אין שם');
  out.push({n:ri+2,o,why})});
 I.out=out;I.cut=cut;I.R=null}
const prevH=()=>{const I=C.imp,ok=I.out.filter(r=>!r.why.length),bad=I.out.filter(r=>r.why.length);
 return `<h3>תצוגה מקדימה</h3><p><b>${ok.length}</b> שורות תקינות · <b>${bad.length}</b> שגויות (לא ייובאו)</p>${I.cut?`<p class="note">${I.cut} מספרי כרטיס נחתכו ל-4 ספרות אחרונות.</p>`:''}
 <div style="max-height:40vh;overflow:auto">${ok.slice(0,5).map(r=>`<div class="note" style="padding:4px 0;border-bottom:1px solid var(--line)">${esc(r.o.name||'')} · <bdi dir="ltr">${esc(r.o.phone||'')}</bdi>${r.o.tz?' · '+esc(r.o.tz):''}${r.o.last4?' · ****'+esc(r.o.last4):''}${r.o.card?' · כרטיס מוצפן':''}</div>`).join('')}
 ${bad.slice(0,50).map(r=>`<div class="note" style="padding:4px 0;border-bottom:1px solid var(--line);color:var(--neg)">שורה ${r.n}: ${esc(r.why.join(', '))}</div>`).join('')}</div>
 <p class="note">לקוח קיים (אותה ת.ז או טלפון) – רק שדות ריקים מתמלאים. אין כפולים.</p>
 <div class="row"><button class="btn grow" data-a="ocGo"${ok.length?'':' disabled'}>ייבא ${ok.length} לקוחות</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div>`};
ACT.ocGo=async el=>{const I=C.imp;if(!I||!I.out)return;el.disabled=true;const ok=I.out.filter(r=>!r.why.length);const t={c:0,u:0,s:0,b:[]};
 try{for(let i=0;i<ok.length;i+=200){const part=ok.slice(i,i+200);el.textContent=`מייבא… ${i}/${ok.length}`;
   const r=await fnCall('importCusts',{reqId:I.req+'_'+(i/200),rows:part.map(x=>x.o)});t.c+=r.created||0;t.u+=r.updated||0;t.s+=r.same||0;(r.bad||[]).forEach(b=>t.b.push('שורה '+part[b.i].n+': '+b.msg))}
  C.imp.out=null;C.imp=null;dlg(`<h3>הייבוא הסתיים</h3><p>חדשים: <b>${t.c}</b> · עודכנו: <b>${t.u}</b> · ללא שינוי: <b>${t.s}</b></p>${t.b.length?`<div style="max-height:40vh;overflow:auto">${t.b.slice(0,50).map(s=>`<p class="note">${esc(s)}</p>`).join('')}</div>`:''}<button class="btn w" data-a="closeDlg">סגור</button>`);await loadL(true)}
 catch(e){el.disabled=false;el.textContent='נסה שוב';err(e)}};

C.split=splitOld;window.__oc=C;
})();
