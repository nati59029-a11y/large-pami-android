/* ORD:1 – מערכת הזמנות, שלב 1: עובד מכניס הזמנות, מלאי לכל סניף, כרטיס הזמנה ותשלום ידני. קובץ עצמאי, נטען אחרי index.html.
   מסכים: V.ox (רשימה), V.oxNew (הזמנה חדשה), V.oxOrd (כרטיס הזמנה), V.oxStock (מלאי), V.oxCfg (מקור מלאי לכל סניף, מנהל),
   ובכרטיס העסק של מנהל־על – "תשלום בהזמנות" (קישור סליקה / תשלום בטלפון).
   כל כתיבה – רק דרך פונקציות השרת (functions/orders.js). קריאה – Firestore לפי החוקים (ord, prod, stockLog, ordcfg).
   ההרשאות נאכפות בשרת ובחוקים; כאן רק מה מוצג למי. קישור הסליקה לא מוצג לעולם – getPayLink מחזיר אותו ונפתח מיד.
   רכיבי D1 בלבד (.li .card .btn .chip .f .tag .sec .empty .note), בלי צבע קבוע. משתמש ב: V, ACT, FRM, INP, fsx, fnCall, fvj, idOf,
   esc, ils, dlg, closeDlg, ask, toast, go, cur, rerender, isA, isW, wp, bzF, brAll, brList, brMineIds, brNm, SY, ADM. */
(function(){
'use strict';
if(typeof ACT==='undefined'||typeof V==='undefined')return;
const NB='_';
const fnCall=(n,d)=>{d=d&&typeof d==='object'?d:{};if(SY&&SY.sa&&SY.bizId&&!('bizId'in d))d=Object.assign({bizId:SY.bizId},d);return window.fnCall(n,d)}; // 2026-11-09 (Dפון): מנהל־על שנכנס לעסק – הפונקציות רצות בעסק שנבחר ולא בעסק הבית שלו
const ST={new:'חדשה',work:'בטיפול',wait_pay:'ממתין לתשלום',paid:'שולם',out:'יצא למשלוח',done:'הושלם',cancel:'בוטלה'};
const NEXT={new:['work','wait_pay'],work:['wait_pay','new'],wait_pay:['work'],paid:['out','done'],out:['done'],done:[],cancel:[]};
const PM=[['link','אשראי בקישור'],['phone','אשראי בטלפון'],['cash','מזומן'],['transfer','העברה'],['other','אחר']];
const WHY={in:'הכנסת מלאי',set:'תיקון כמות',zero:'נגמר במלאי',order:'הזמנה',xout:'הועבר לסניף אחר',xin:'העברה נכנסת',cancel:'ביטול הזמנה',edit:'עריכת הזמנה',prod:'עריכת מוצר'};
const O={L:null,P:null,C:[],cf:'',cfg:null,err:'',busy:0,at:0,st:'open',log:{},sl:null,draft:null};
const on=()=>(isA()||isW()||!!(SY&&SY.sa))&&bzF('orders')&&wp('ord');
const mgr=()=>isA()||!!(SY&&SY.sa);window.oxImpOk=()=>on()&&mgr();
const brs=()=>brAll().filter(b=>b.on);
const hasBr=()=>brs().length>0;
const mine=()=>brMineIds();
const myBr=()=>hasBr()?brList():[];
const bn=id=>id===NB||!id?'':brNm(id);
const rid=()=>{const a=new Uint8Array(12);crypto.getRandomValues(a);return 'r'+[...a].map(x=>x.toString(36).padStart(2,'0')).join('').slice(0,22)};
const dec=d=>Object.assign({id:idOf(d)},Object.fromEntries(Object.entries(d.fields||{}).map(([k,v])=>[k,fvj(v)])));
const tm=t=>{if(!t)return '';const d=new Date(t);return d.toLocaleDateString('he-IL',{day:'numeric',month:'numeric'})+' '+d.toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'})};
const q=(p,br)=>{const v=p&&p.q&&typeof p.q==='object'?p.q[br]:0;return typeof v==='number'?v:0};
const qAll=p=>Object.values(p&&p.q||{}).reduce((s,v)=>s+(typeof v==='number'?v:0),0);
const n3=x=>Math.round(x*1000)/1000;
const err=e=>toast(e&&e.message||'הפעולה נכשלה');

/* ---------- קריאה ---------- */
async function runQ(coll,where,lim,ord){const sq={from:[{collectionId:coll}],limit:lim||500};if(where)sq.where=where;if(ord)sq.orderBy=[{field:{fieldPath:ord},direction:'DESCENDING'}];
 const r=await fsx(':runQuery',{method:'POST',body:JSON.stringify({structuredQuery:sq})});return(r||[]).filter(x=>x.document).map(x=>dec(x.document))}
const brWhere=()=>{const m=mine();return m&&hasBr()?{fieldFilter:{field:{fieldPath:'br'},op:'IN',value:{arrayValue:{values:m.slice(0,30).map(s=>({stringValue:s}))}}}}:null};
let load=async function(force){if(O.busy||(!force&&O.L&&Date.now()-O.at<20000))return;O.busy=1;O.err='';
 try{const[L,P,c,C]=await Promise.all([runQ('ord',brWhere(),500),runQ('prod',null,2000),fsx('/ordcfg/main').catch(e=>{if(e.code===404)return null;throw e}),runQ('cat',null,500).catch(()=>[])]);O.C=C.sort((a,b)=>(a.ord||0)-(b.ord||0)||String(a.name).localeCompare(String(b.name),'he'));
  O.L=L.sort((a,b)=>(b.no||0)-(a.no||0));O.P=P.sort((a,b)=>String(a.name).localeCompare(String(b.name),'he'));O.cfg=c?dec(c):{};O.at=Date.now();costLoad()}
 catch(e){O.err=e.message||'הטעינה נכשלה'}finally{O.busy=0;if(/^ox/.test(cur().v)&&!typing())rerender()}}
/* עלות (החלטה 00:12): מנהל ועובד עם ord רואים עלות בכל מקום; נטען ברקע מ-getCosts (בעמודים) */
async function costLoad(){try{const W={};let a;for(let g=0;g<200;g++){const r=await fnCall('getCosts',a?{after:a}:{});Object.assign(W,r&&r.cost||{});if(!r||!r.next)break;a=r.next}O.cost=W;O.cerr=0;if(/^ox/.test(cur().v)&&!typing()&&!document.querySelector('#dlg[open]'))rerender()}catch(e){O.cerr=1}}
const costOf=id=>O.cost&&typeof O.cost[id]==='number'?O.cost[id]:null;
const costH=id=>{const c=costOf(id);return c==null?'':' · עלות '+ils(c)};
/* עלות לפני מע"מ: מחושב להצגה בלבד מול "מחיר עלות" (כולל מע"מ); נשמר רק cost. אחוז המע"מ בהגדרות העסק (ברירת מחדל 18) */
const vatP=()=>{const v=O.cfg&&O.cfg.vat;return typeof v==='number'&&v>=0&&v<=100?v:18};
const r2=x=>Math.round((x+Number.EPSILON)*100)/100;
const exVat=c=>r2(c/(1+vatP()/100)),incVat=c=>r2(c*(1+vatP()/100));
const costXH=id=>{const c=costOf(id);return c==null?'':' · לפני מע"מ '+ils(exVat(c))};
/* סיכום מלאי (12.11.2026): מוצרים, יחידות, שווי לפי עלות לפני מע"מ (מנהל בלבד). חישוב באגורות שלמות; העלות השמורה כוללת מע"מ ולכן מחולקת באחוז המע"מ של העסק (כמו costXH). מוצר בלי עלות לא נספר בשווי; כמות שלילית נספרת כמו שהיא. נשמר בזיכרון עד שהנתונים משתנים – לא מחושב מחדש בכל ציור */
const stockSum=(P,cost,vat,br)=>{let n=0,u=0,ua=0,v=0,va=0,nc=0;for(const p of P||[]){n++;const qa=qAll(p),qb=q(p,br);ua+=qa;u+=qb;const c=cost&&typeof cost[p.id]==='number'?cost[p.id]:null;if(c==null){nc++;continue}const unit=Math.round(c*100/(1+vat/100));v+=Math.round(qb*unit);va+=Math.round(qa*unit)}return{n,u:n3(u),ua:n3(ua),v,va,nc}};
window.oxStockSum=stockSum;
const sumGet=br=>{const k=[O.P,O.cost,vatP(),br];const m=O.sm;if(m&&m.k.every((x,i)=>x===k[i]))return m.r;const r=stockSum(O.P,O.cost,vatP(),br);O.sm={k,r};return r};
const agH=a=>ils(a/100);
const sumH=br=>{const r=sumGet(br),M=mgr(),multi=hasBr()&&brs().length>1;
 const cell=(l,v,id)=>`<div style="flex:1 1 30%;min-width:84px;text-align:center"><b class="a" id="${id}" style="display:block;font-size:1.25em">${v}</b><small class="note">${l}</small></div>`;
 const val=!M?'':O.cost?cell('שווי לפני מע"מ',agH(r.v),'oxSumV'):cell('שווי לפני מע"מ',O.cerr?'לא נטען':'טוען…','oxSumV');
 return `<div class="card" id="oxsum" style="margin:8px 0"><div class="row" style="flex-wrap:wrap;gap:8px;justify-content:space-between">${cell('מוצרים',r.n,'oxSumN')}${cell(multi?'יחידות בסניף':'יחידות',r.u,'oxSumU')}${val}</div>`
 +(M&&multi?`<small class="note" id="oxSumA" style="display:block;margin-top:6px">כל הסניפים: ${r.ua} יחידות${O.cost?' · שווי '+agH(r.va)+' לפני מע"מ':''}</small>`:'')
 +(M&&O.cost&&r.nc?`<small class="note" id="oxSumNC" style="display:block;margin-top:4px">${r.nc===1?'מוצר אחד':r.nc+' מוצרים'} בלי עלות – לא נכללים בשווי</small>`:'')+'</div>'};
// בכל מסך עם הקלדה – רענון לא בונה מחדש כשיש טקסט בתיבה (לקח)
const typing=()=>{const a=document.activeElement;return !!(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)&&a.closest('#main'))};
const prod=id=>(O.P||[]).find(p=>p.id===id);
const srcOf=br=>{const s=O.cfg&&O.cfg.src&&O.cfg.src[br];return s&&s!=='stock'&&brs().some(b=>b.id===s)?s:'stock'};
const payMode=()=>{const p=O.cfg&&O.cfg.pay;return p&&p.mode==='link'&&p.has?'link':'phone'};
const loading=t=>({t,h:O.err?`<div class="card"><p class="note">${esc(O.err)}</p><button class="btn g w" data-a="oxRe">נסה שוב</button></div>`:'<div class="empty">טוען…</div>'});
const deny=t=>({t,h:'<div class="empty">אין לך הרשאה להזמנות</div>'});
ACT.oxRe=()=>load(true);

/* ---------- כניסה: אריח לעובד, שורה ב"עוד" למנהל, באנר בבית ---------- */
window.oxTile=()=>on()?`<button class="tile" data-a="go" data-v="ox" style="font-size:1.15rem;text-align:center;border-color:var(--acc);color:var(--acc)">${ico('doc')}הזמנות</button>`:'';
{const m=V.more;if(m)V.more=()=>{const r=m();if(on()&&!(isA()&&typeof adOrd==='function'&&adOrd())&&r&&r.h)r.h=r.h.replace('<div class="mlist">',`<div class="mlist"><button class="opt" data-a="go" data-v="ox"><span>הזמנות<small>הזמנות לקוחות, מלאי ותשלום</small></span>${openN()?`<span class="tag t1">${openN()}</span>`:''}${ico('chev')}</button>`);return r}}
{const h=V.home;if(h)V.home=()=>{const r=h();if(on()&&r&&r.h){if(!O.L&&bzB())load();const n=openN(),s=sumMonth();if(O.L&&(n||s))r.h=r.h.replace(/(<div class="chips hacts")/,`<button class="ban" style="margin-top:12px" data-a="go" data-v="ox"><span class="tag t1">הזמנות</span><span style="flex:1"><b>${n}</b> פתוחות · החודש שולם <b>${ils(s)}</b></span>${ico('chev')}</button>$1`)}return r}}
const openN=()=>(O.L||[]).filter(o=>!['done','cancel'].includes(o.status)).length;
const sumMonth=()=>{const d=new Date(),m0=new Date(d.getFullYear(),d.getMonth(),1).getTime();return(O.L||[]).filter(o=>o.paid&&o.paid.at>=m0&&o.status!=='cancel').reduce((s,o)=>s+(o.total||0),0)};

/* ---------- רשימת הזמנות ---------- */
const FL=[['open','פתוחות'],['new','חדשה'],['work','בטיפול'],['wait_pay','ממתין לתשלום'],['paid','שולם'],['out','יצא למשלוח'],['done','הושלם'],['cancel','בוטלה'],['all','הכול']];
let OBR='';
V.ox=()=>{const T='הזמנות';if(!on())return deny(T);if(!O.L){load();return loading(T)}
 const L0=O.L.filter(o=>!OBR||o.br===OBR),cnt=k=>k==='all'?L0.length:k==='open'?L0.filter(o=>!['done','cancel'].includes(o.status)).length:L0.filter(o=>o.status===k).length;
 const L=L0.filter(o=>O.st==='all'||(O.st==='open'?!['done','cancel'].includes(o.status):o.status===O.st));
 const B=myBr(),bc=B.length>1?`<div class="chips scroll-x" role="group" aria-label="סינון לפי סניף" style="margin:8px 0"><button class="chip ${OBR?'':'on'}" data-a="oxBr" data-id="" aria-pressed="${!OBR}">כל הסניפים</button>${B.map(b=>`<button class="chip ${OBR===b.id?'on':''}" data-a="oxBr" data-id="${esc(b.id)}" aria-pressed="${OBR===b.id}">${esc(b.name)}</button>`).join('')}</div>`:'';
 const sc=`<div class="chips scroll-x" role="group" aria-label="סינון לפי סטטוס" style="margin:8px 0">${FL.map(([k,l])=>`<button class="chip ${O.st===k?'on':''}" data-a="oxSt" data-k="${k}" aria-pressed="${O.st===k}">${l} ${cnt(k)}</button>`).join('')}</div>`;
 const top=`<div class="row" style="margin-bottom:8px"><button class="btn grow" data-a="go" data-v="oxNew">${ico('plus')}הזמנה חדשה</button><button class="btn g grow" data-a="go" data-v="oxStock">מלאי</button></div>${mgr()&&hasBr()?'<button class="btn g s w" data-a="go" data-v="oxCfg">מאיזה סניף יורד המלאי</button>':''}`;
 const kp=mgr()?`<div class="card" style="margin:8px 0"><div class="row" style="justify-content:space-between"><span><small class="note">פתוחות</small><br><b class="amt">${cnt('open')}</b></span><span><small class="note">ממתין לתשלום</small><br><b class="amt">${cnt('wait_pay')}</b></span><span><small class="note">שולם החודש</small><br><b class="amt">${ils(sumMonth())}</b></span></div></div>`:'';
 return{t:T,s:hasBr()&&mine()?mine().map(bn).join(', '):'הזמנות לקוחות',h:top+kp+bc+sc+(L.length?L.map(row).join(''):`<div class="empty">אין הזמנות${O.st==='open'?' פתוחות':''}</div>`)+`<button class="btn g s w" style="margin-top:8px" data-a="oxRe">רענן</button>`}};
const row=o=>`<button class="li" data-a="go" data-v="oxOrd" data-arg="${esc(o.id)}"><div class="m"><b>#${o.no} · ${esc(o.cust&&o.cust.name||'')}</b><small>${tm(o.at)}${hasBr()&&o.br!==NB?' · '+esc(bn(o.br)):''} · ${(o.items||[]).length} פריטים</small></div><span class="tag">${ST[o.status]||o.status}</span><b class="a">${ils(o.total)}</b></button>`;
ACT.oxSt=el=>{O.st=el.dataset.k;rerender()};
ACT.oxBr=el=>{OBR=el.dataset.id;rerender()};

/* ---------- הזמנה חדשה ---------- */
/* 00:19: שם פרטי/משפחה, רחוב/עיר/קומה/דירה. name/addr = חיבור (תאימות להזמנות ולקוחות ישנים) */
const CPK=['fn','ln','st','city','fl','apt'];
function custJoin(D){const t=k=>String(D[k]||'').trim();const cap=(v,n)=>v.slice(0,n).trim();if(t('fn')||t('ln'))D.name=cap([t('fn'),t('ln')].filter(Boolean).join(' '),60);if(t('st')||t('city')||t('fl')||t('apt'))D.addr=cap([t('st'),t('city'),t('fl')&&'קומה '+t('fl'),t('apt')&&'דירה '+t('apt')].filter(Boolean).join(', '),150);return D}
window.__custJoin=custJoin;
function draft(){if(!O.draft){const B=myBr();O.draft={br:B.length===1?B[0].id:'',name:'',fn:'',ln:'',phone:'',tz:'',addr:'',st:'',city:'',fl:'',apt:'',mail:'',note:'',items:[],q:'',req:rid()}}return O.draft}
const lineH=(it,i,br)=>{const p=it.pid?prod(it.pid):null,src=hasBr()&&br?srcOf(br):null;
 let stock='';if(p){const from=it.from||br||NB;stock=`<small class="note">במלאי${hasBr()?' ב'+esc(bn(from)):''}: <b>${n3(q(p,from))}</b>${costH(p.id)}${q(p,from)<it.qty?' – אין מספיק, ההזמנה תישמר והמלאי ירד למינוס':''}</small>`;}
 const sel=p&&hasBr()&&br&&src==='stock'?`<label class="f"><span>הסחורה מסניף</span><select data-i="oxLn" data-k="from" data-n="${i}">${brs().map(b=>`<option value="${esc(b.id)}"${(it.from||br)===b.id?' selected':''}>${esc(b.name)} (${n3(q(p,b.id))})</option>`).join('')}</select></label>`:p&&hasBr()&&br&&src!=='stock'?`<small class="note">יורד ממלאי ${esc(bn(src))} (הגדרת המנהל)</small>`:'';
 return `<div class="card" style="margin:6px 0">${p?`<b>${esc(p.name)}</b>${it.gk?' <span class="tag">מתנה מהמבצע</span>':''}`:`<label class="f"><span>פריט</span><input data-i="oxLn" data-k="n" data-n="${i}" value="${esc(it.n||'')}" maxlength="80"></label>`}
 <div class="row"><label class="f grow"><span>כמות</span><input data-i="oxLn" data-k="qty" data-n="${i}" inputmode="decimal" value="${esc(it.qty)}"></label><label class="f grow"><span>מחיר ליחידה ₪</span><input data-i="oxLn" data-k="price" data-n="${i}" inputmode="decimal" value="${esc(it.price)}"></label></div>
 ${p?'':freeH(it,i,br)}${stock}${sel}<button type="button" class="btn g s" data-a="oxLnDel" data-n="${i}">הסר שורה</button></div>`};
/* שורה ידנית (00:18): עלות ליחידה וסניף השורה (רשות; ברירת מחדל = סניף ההזמנה, רק סניפים שמותרים לעובד). לא משנה מלאי */
const freeH=(it,i,br)=>{const B=myBr();return `<div class="row"><label class="f grow"><span>עלות ליחידה ₪ (רשות)</span><input data-i="oxLn" data-k="c" data-n="${i}" inputmode="decimal" value="${esc(it.c==null?'':it.c)}"></label>${B.length>1?`<label class="f grow"><span>סניף השורה</span><select data-i="oxLn" data-k="lb" data-n="${i}"><option value="">כמו ההזמנה</option>${B.filter(b=>b.id!==br).map(b=>`<option value="${esc(b.id)}"${it.lb===b.id?' selected':''}>${esc(b.name)}</option>`).join('')}</select></label>`:''}</div>`};
// "לפי המלאי": מוצע הסניף שיש בו מספיק (קודם הסניף של ההזמנה) – כמו בשרת
function suggest(p,br,qty){if(!hasBr()||!br||srcOf(br)!=='stock')return '';if(q(p,br)>=qty)return '';const c=brs().map(b=>b.id).filter(b=>q(p,b)>=qty);return c.length?c[0]:''}
V.oxNew=()=>{const T='הזמנה חדשה';if(!on())return deny(T);if(!O.P){load();return loading(T)}const D=draft(),B=myBr();
 const brH=B.length>1?`<label class="f"><span>סניף ההזמנה</span><select data-i="oxD" data-k="br" required><option value="">בחר סניף</option>${B.map(b=>`<option value="${esc(b.id)}"${D.br===b.id?' selected':''}>${esc(b.name)}</option>`).join('')}</select></label>`:B.length===1?`<p class="note">סניף: ${esc(B[0].name)}</p>`:'';
 const f=(l,k,t,x)=>`<label class="f"><span>${l}</span><input data-i="oxD" data-k="${k}" type="${t||'text'}" value="${esc(D[k])}" ${x||''}></label>`;
 const hits=D.q?(O.P||[]).filter(p=>p.on!==false&&(String(p.name).includes(D.q)||(p.barcode&&String(p.barcode)===D.q.trim()))).slice(0,8):[];
 const tot=D.items.reduce((s,it)=>s+Math.round((+it.qty||0)*(+it.price||0)*100),0)/100;
 return{t:T,s:'פרטי לקוח ומוצרים',h:`<div class="card">${brH}${f('שם פרטי','fn','text','maxlength="30" autocomplete="off"')}${f('שם משפחה','ln','text','maxlength="30" autocomplete="off"')}${f('טלפון','phone','tel','inputmode="tel" autocomplete="off"')}
 <details><summary class="note" style="min-height:44px;display:flex;align-items:center">ת.ז, כתובת ומייל (רשות)</summary>${f('ת.ז','tz','text','inputmode="numeric" maxlength="9"')}${f('רחוב ומספר','st','text','maxlength="80"')}${f('עיר','city','text','maxlength="40"')}${f('קומה','fl','text','maxlength="10"')}${f('דירה','apt','text','maxlength="10"')}${f('מייל','mail','email','dir="ltr"')}</details>${shipH(D)}</div>
 <div class="sec"><h3>מוצרים</h3></div>
 <label class="f"><span>חיפוש מוצר (שם או ברקוד)</span><input data-i="oxQ" value="${esc(D.q)}" autocomplete="off" id="oxq"></label>
 <div id="oxhits">${hitsH(hits,D)}</div>
 <button type="button" class="btn g s w" data-a="oxFree">＋ שורה חופשית (לא מהמלאי)</button>
 <div id="oxlines">${D.items.map((it,i)=>lineH(it,i,D.br)).join('')}</div>
 ${f('הערה (לא להקליד פרטי אשראי)','note','text','maxlength="300"')}
 <div class="card" style="margin:10px 0"><div class="row" style="justify-content:space-between"><b>סה״כ</b><b class="amt" id="oxtot">${ils(tot)}</b></div><p class="note" style="margin:4px 0 0">הסכום הסופי מחושב בשרת.</p></div>
 <button class="btn w" data-a="oxSave">שמור הזמנה</button><button class="btn g w" style="margin-top:8px" data-a="oxDrop">נקה טופס</button>`}};
/* 2026-11-10: כתובת משלוח נפרדת – להזמנה בלבד (לא משנה את כתובת הלקוח). בכל העסקים */
const SHK=[['st','רחוב ומספר',80],['city','עיר',40],['fl','קומה',10],['apt','דירה',10]];
const shipH=D=>D.ship?`<div class="card" style="margin:8px 0" id="oxship"><div class="row" style="justify-content:space-between;align-items:center"><b>כתובת משלוח נפרדת</b><button type="button" class="btn g s" data-a="oxShipX">הסר</button></div><p class="note" style="margin:0">להזמנה הזו בלבד. כתובת הלקוח לא משתנה.</p>${SHK.map(([k,l,m])=>`<label class="f"><span>${l}</span><input data-i="oxS" data-k="${k}" maxlength="${m}" autocomplete="off" value="${esc(D.ship[k]||'')}"></label>`).join('')}</div>`:'<button type="button" class="btn g s w" data-a="oxShip" style="margin-top:6px">＋ כתובת משלוח נפרדת</button>';
ACT.oxShip=()=>{draft().ship={st:'',city:'',fl:'',apt:''};rerender()};
ACT.oxShipX=()=>{draft().ship=null;rerender()};
INP.oxS=el=>{const D=draft();if(D.ship)D.ship[el.dataset.k]=el.value};
const hitsH=(hits,D)=>hits.map(p=>`<button type="button" class="li" data-a="oxAdd" data-id="${esc(p.id)}"><div class="m"><b>${esc(p.name)}</b><small>${hasBr()&&D.br?'במלאי ב'+esc(bn(D.br))+': '+n3(q(p,D.br))+' · ':''}סה״כ במלאי: ${n3(hasBr()?qAll(p):q(p,NB))}${costH(p.id)}</small></div><b class="a">${ils(unitP(p,D.br))}</b></button>`).join('')||(D.q?'<p class="note">לא נמצא מוצר. אפשר להוסיף שורה חופשית או מוצר חדש במסך המלאי.</p>':'');
INP.oxD=el=>{const D=draft();D[el.dataset.k]=el.value;if(el.dataset.k==='br'){D.items.forEach(it=>{if(it.pid){const p=prod(it.pid);it.from=suggest(p,D.br,+it.qty||0)||'';if(it.auto&&p)it.price=String(unitP(p,D.br))}});redrawLines()}};
INP.oxQ=el=>{const D=draft();D.q=el.value;const hits=D.q?(O.P||[]).filter(p=>p.on!==false&&(String(p.name).includes(D.q)||(p.barcode&&String(p.barcode)===D.q.trim()))).slice(0,8):[];const h=document.getElementById('oxhits');if(h)h.innerHTML=hitsH(hits,D)};
INP.oxLn=el=>{const D=draft(),it=D.items[+el.dataset.n];if(!it)return;it[el.dataset.k]=el.value;if(el.dataset.k==='price')it.auto=0;if(el.dataset.k==='from'||el.tagName==='SELECT')redrawLines();else totRedraw()};
function totRedraw(){const D=draft(),t=document.getElementById('oxtot');if(t)t.textContent=ils(D.items.reduce((s,it)=>s+Math.round((+it.qty||0)*(+it.price||0)*100),0)/100)}
function redrawLines(){const D=draft(),l=document.getElementById('oxlines');if(l)l.innerHTML=D.items.map((it,i)=>lineH(it,i,D.br)).join('');totRedraw()}
ACT.oxAdd=el=>{const D=draft(),p=prod(el.dataset.id);if(!p)return;const ex=D.items.find(it=>it.pid===p.id&&!it.gk);if(ex)ex.qty=String((+ex.qty||0)+1);else D.items.push({pid:p.id,qty:'1',price:String(unitP(p,D.br)),auto:1,from:suggest(p,D.br,1)});D.q='';rerender()};
ACT.oxFree=()=>{draft().items.push({n:'',qty:'1',price:''});rerender()};
ACT.oxLnDel=el=>{draft().items.splice(+el.dataset.n,1);rerender()};
ACT.oxDrop=()=>ask('לנקות את הטופס?',()=>{O.draft=null;rerender()},'כן, נקה');
const num=v=>{const x=+String(v).replace(',','.');return isFinite(x)?x:NaN};
function itemsOut(items){const out=[];for(const it of items){const qty=num(it.qty),price=num(it.price);if(!(qty>0))throw new Error('כמות לא תקינה');if(!(price>=0))throw new Error('מחיר לא תקין');
 const o={qty,price};if(it.pid){o.pid=it.pid;if(it.from)o.from=it.from}else{if(!String(it.n||'').trim())throw new Error('חסר שם לשורה חופשית');o.n=String(it.n).trim();const c=String(it.c==null?'':it.c).trim();if(c){const v=num(c);if(!(v>=0))throw new Error('עלות לא תקינה');o.c=v}if(it.lb)o.lb=it.lb}out.push(o)}return out}
ACT.oxSave=async el=>{const D=draft();custJoin(D);let items;try{if(hasBr()&&!D.br)throw new Error('בחר סניף');if(!D.name.trim())throw new Error('חסר שם לקוח');if(!D.phone.trim())throw new Error('חסר טלפון');if(!D.items.length)throw new Error('הוסף לפחות פריט אחד');items=itemsOut(D.items)}catch(e){return toast(e.message)}
 if(D.wsC&&D.wsC!==D.custId){D.req=rid();D.wsC=''} // הלקוח הוחלף אחרי טעינת סיטונאי – הטיוטה מקבלת מזהה חדש (השרת קושר סיטונאי ל-reqId)
 const cust={name:D.name,phone:D.phone};if(D.tz)cust.tz=D.tz;CPK.forEach(k=>{const v=String(D[k]||'').trim();if(v)cust[k]=v});if(D.addr&&!CPK.slice(2).some(k=>cust[k]))cust.addr=D.addr;if(D.mail)cust.mail=D.mail;
 const xp=(D.phs||[]).map(v=>String(v||'').trim()).filter(Boolean);if(xp.length)cust.phs=xp;
 if(D.ship){const sp={};SHK.forEach(([k])=>{const v=String(D.ship[k]||'').trim();if(v)sp[k]=v});if(Object.keys(sp).length){if(!sp.st)return toast('כתובת משלוח: חסר רחוב ומספר');cust.ship=sp}}
 el.disabled=true;try{const r=await fnCall('createOrder',{reqId:D.req,br:hasBr()?D.br:undefined,cust,custId:D.custId||undefined,items,note:D.note||undefined,cell:D.cellOut});O.draft=null;
  toast(`הזמנה #${r.no} נשמרה · ${ils(r.total)}`);if(r.warn&&r.warn.length)setTimeout(()=>toast('שים לב: אין מספיק במלאי – '+r.warn.map(w=>w.n+(hasBr()?' ב'+bn(w.br):'')).join(', ')),2700);
  await load(true);NAV.pop();go('oxOrd',r.id);return r}catch(e){el.disabled=false;err(e)}}; // מחזיר את ההזמנה שנשמרה (לכרטיס מטופס ההזמנה)

/* ---------- כרטיס הזמנה ---------- */
V.oxOrd=id=>{const T='הזמנה';if(!on())return deny(T);if(!O.L){load();return loading(T)}const o=O.L.find(x=>x.id===id);if(!o)return{t:T,h:'<div class="empty">ההזמנה לא נמצאה</div>'};
 const c=o.cust||{},open=['new','work','wait_pay'].includes(o.status);
 const items=(o.items||[]).map(it=>`<div class="li" style="cursor:default"><div class="m"><b>${esc(it.n)}</b><small>${n3(it.qty)} × ${ils(it.price)}${it.from&&hasBr()?' · מסניף '+esc(bn(it.from)):''}</small></div><b class="a">${ils(Math.round(it.qty*it.price*100)/100)}</b></div>`).join('');
 const nx=(NEXT[o.status]||[]).map(s=>`<button class="btn g grow" data-a="oxStat" data-id="${esc(o.id)}" data-s="${s}">${ST[s]}</button>`).join('');
 const pay=open?(payMode()==='link'?`<button class="btn w" data-a="oxPay" data-id="${esc(o.id)}">לתשלום</button><p class="note">נפתח דף הסליקה של העסק. מקלידים שם את פרטי האשראי של הלקוח – הם לא נשמרים באפליקציה.</p>`:`<a class="btn w" href="tel:${esc(c.phone)}" data-a="oxCall" data-id="${esc(o.id)}" style="display:flex;align-items:center;justify-content:center;text-decoration:none">תשלום בטלפון</a><p class="note">התקשר ללקוח וגבה בטלפון. אחר כך סמן "שולם".</p>`)+`<button class="btn g w" data-a="oxPaid" data-id="${esc(o.id)}">סמן שולם</button>`:'';
 const paid=o.paid?`<div class="card"><b>שולם ${ils(o.paid.amt!=null?o.paid.amt:o.total)}</b><p class="note" style="margin:4px 0 0">${(PM.find(x=>x[0]===o.paid.method)||[0,o.paid.method])[1]}${o.paid.last4?' · ****'+esc(o.paid.last4):''}${o.paid.conf?' · אישור '+esc(o.paid.conf):''} · ${tm(o.paid.at)}${o.paid.sup?' · זיכוי אצל '+esc(o.paid.sup.name):''}</p>${mgr()&&o.status==='paid'?`<button class="btn g s" data-a="oxUnpay" data-id="${esc(o.id)}">ביטול "שולם"</button>`:''}</div>`:'';
 const lg=O.log[id];if(lg===undefined){O.log[id]=null;logLoad(id)}
 return{t:'הזמנה #'+o.no,s:ST[o.status],h:`<div class="card"><div class="row" style="justify-content:space-between"><b>${esc(c.name||'')}</b><span class="tag">${ST[o.status]}</span></div>
 <p style="margin:6px 0"><a href="tel:${esc(c.phone)}" dir="ltr" data-a="oxCall" data-id="${esc(o.id)}" style="color:var(--acc);display:inline-flex;min-height:44px;align-items:center">${esc(c.phone||'')}</a>${o.calledAt?` <small class="note">· חייגת ${tm(o.calledAt)}</small>`:''}</p>
 ${(c.phs||[]).length?`<p class="note" style="margin:0">טלפון נוסף: ${c.phs.map(p=>`<a href="tel:${esc(p)}" dir="ltr" style="color:var(--acc)">${esc(p)}</a>`).join(', ')}</p>`:''}${c.addr?`<p class="note" style="margin:0">${esc(c.addr)}</p>`:''}${c.ship&&c.ship.addr?`<p style="margin:4px 0 0"><b>משלוח ל:</b> ${esc(c.ship.addr)}</p>`:''}${c.mail?`<p class="note" style="margin:0" dir="ltr">${esc(c.mail)}</p>`:''}${c.tz?`<p class="note" style="margin:0">ת.ז ${esc(c.tz)}</p>`:''}
 <p class="note" style="margin:6px 0 0">${tm(o.at)}${hasBr()&&o.br!==NB?' · סניף '+esc(bn(o.br)):''}${o.byName?' · הזין '+esc(o.byName):''}</p>${o.note?`<p style="margin:6px 0 0">${esc(o.note)}</p>`:''}</div>
 <div class="sec"><h3>פריטים</h3>${open?`<button class="btn s g" data-a="oxEdit" data-id="${esc(o.id)}">עריכה</button>`:''}</div>${items}
 <div class="card"><div class="row" style="justify-content:space-between"><b>סה״כ</b><b class="amt">${ils(o.total)}</b></div>${open?'':'<p class="note" style="margin:4px 0 0">הסכום נעול.</p>'}</div>
 ${o.status==='cancel'?`<div class="card"><b>בוטלה</b><p class="note" style="margin:4px 0 0">${esc(o.cancel&&o.cancel.reason||'')}</p></div>`:''}
 ${paid}${pay?`<div class="sec"><h3>תשלום</h3></div>${pay}`:''}
 ${nx?`<div class="sec"><h3>שינוי סטטוס</h3></div><div class="row">${nx}</div>`:''}
 ${o.status!=='done'&&o.status!=='cancel'&&(o.status!=='paid'||mgr())?`<button class="btn g w" style="margin-top:14px" data-a="oxCancel" data-id="${esc(o.id)}">ביטול הזמנה</button>`:''}
 <div class="sec"><h3>היסטוריה</h3></div>${lg?lg.map(x=>`<div class="note" style="padding:6px 0;border-bottom:1px solid var(--line)">${tm(x.t)} · ${esc(LOGW[x.act]||x.act)}${x.note?' · '+esc(x.note):''}</div>`).join('')||'<p class="note">אין</p>':'<p class="note">טוען…</p>'}`}};
const LOGW={create:'נוצרה',edit:'נערכה',status:'סטטוס',paid:'סומן שולם',unpay:'בוטל "שולם"',cancel:'בוטלה',called:'חייגו ללקוח',payOpen:'נפתח דף התשלום'};
async function logLoad(id){try{const r=await fsx('/ord/'+id+'/log?pageSize=100');O.log[id]=((r&&r.documents)||[]).map(dec).sort((a,b)=>b.t-a.t)}catch(e){O.log[id]=[]}if(cur().v==='oxOrd'&&!typing())rerender()}
async function after(id){O.log[id]=undefined;await load(true)}
ACT.oxStat=async el=>{el.disabled=true;try{await fnCall('setOrderStatus',{id:el.dataset.id,status:el.dataset.s});toast('הסטטוס עודכן');await after(el.dataset.id)}catch(e){el.disabled=false;err(e)}};
ACT.oxCall=el=>{fnCall('markOrderCalled',{id:el.dataset.id}).then(()=>after(el.dataset.id)).catch(()=>{})/* החיוג עצמו – הקישור tel: */};
ACT.oxPay=async el=>{el.disabled=true;try{const r=await fnCall('getPayLink',{id:el.dataset.id});const u=String(r&&r.link||'');if(!/^https:\/\//.test(u))throw new Error('קישור התשלום לא תקין');window.open(u,'_system');O.log[el.dataset.id]=undefined;setTimeout(rerender,600)}catch(e){err(e)}finally{el.disabled=false}};
ACT.oxPaid=el=>{const id=el.dataset.id,o=(O.L||[]).find(x=>x.id===id);if(!o)return;
 dlg(`<h3>סימון שולם · ${ils(o.total)}</h3><form data-f="oxPaidF"><input type="hidden" name="id" value="${esc(id)}"><label class="f"><span>אמצעי תשלום</span><select name="method" required>${PM.map(([k,l])=>`<option value="${k}"${k===(payMode()==='link'?'link':'phone')?' selected':''}>${l}</option>`).join('')}</select></label>
 <label class="f"><span>4 ספרות אחרונות של הכרטיס (רשות)</span><input name="last4" inputmode="numeric" maxlength="4" pattern="\\d{4}" autocomplete="off"></label><label class="f"><span>מספר אישור (רשות)</span><input name="conf" maxlength="20" autocomplete="off" dir="ltr"></label>
 <p class="note">לא מקלידים כאן מספר כרטיס מלא, תוקף או קוד – זה נדחה.</p><div class="row"><button class="btn grow">שולם</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`)};
FRM.oxPaidF=async f=>{const x=fd(f),b=f.querySelector('button');if(x.last4&&!/^\d{4}$/.test(x.last4))return toast('4 ספרות בדיוק');b.disabled=true;
 try{await fnCall('markOrderPaid',{id:x.id,method:x.method,last4:x.last4||undefined,conf:x.conf||undefined});closeDlg();toast('סומן שולם');await after(x.id)}catch(e){b.disabled=false;err(e)}};
const reasonDlg=(ttl,fn,ok)=>{dlg(`<h3>${esc(ttl)}</h3><form data-f="oxWhy"><label class="f"><span>סיבה (חובה)</span><input name="r" required maxlength="200"></label><div class="row"><button class="btn r grow">${ok}</button><button type="button" class="btn g grow" data-a="closeDlg">חזרה</button></div></form>`);O.why=fn};
FRM.oxWhy=async f=>{const r=fd(f).r.trim();if(!r)return;const b=f.querySelector('button');b.disabled=true;try{await O.why(r);closeDlg()}catch(e){b.disabled=false;err(e)}};
ACT.oxCancel=el=>{const id=el.dataset.id;reasonDlg('לבטל את ההזמנה? המלאי יחזור.',async r=>{await fnCall('cancelOrder',{id,reason:r});toast('ההזמנה בוטלה');await after(id)},'בטל הזמנה')};
ACT.oxUnpay=el=>{const id=el.dataset.id;reasonDlg('לבטל את סימון "שולם"? ההזמנה תחזור ל"ממתין לתשלום".',async r=>{await fnCall('unpayOrder',{id,reason:r});toast('"שולם" בוטל');await after(id)},'בטל "שולם"')};
ACT.oxEdit=el=>{const o=(O.L||[]).find(x=>x.id===el.dataset.id);if(!o)return;O.ed={id:o.id,items:(o.items||[]).map(it=>({pid:it.pid,n:it.n,qty:String(it.qty),price:String(it.price),from:it.from||'',c:it.c,lb:it.lb}))};
 dlg(edH());};
const edH=()=>`<h3>עריכת פריטים</h3><form data-f="oxEdF">${O.ed.items.map((it,i)=>`<div class="card" style="margin:6px 0"><b>${esc(it.n||'פריט')}</b><div class="row"><label class="f grow"><span>כמות</span><input name="q${i}" inputmode="decimal" value="${esc(it.qty)}"></label><label class="f grow"><span>מחיר ₪</span><input name="p${i}" inputmode="decimal" value="${esc(it.price)}"></label></div><label class="cb" style="min-height:44px;display:flex;align-items:center;gap:6px"><input type="checkbox" name="d${i}"> הסר</label></div>`).join('')}<p class="note">שינוי מחיר נרשם בהיסטוריה. המלאי מתעדכן לפי ההפרש.</p><div class="row"><button class="btn grow">שמור</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`;
FRM.oxEdF=async f=>{const x=fd(f),E=O.ed;const L=E.items.map((it,i)=>Object.assign({},it,{qty:x['q'+i],price:x['p'+i]})).filter((it,i)=>!x['d'+i]);let items;try{if(!L.length)throw new Error('צריך לפחות פריט אחד. לביטול – "ביטול הזמנה".');items=itemsOut(L)}catch(e){return toast(e.message)}
 const b=f.querySelector('button');b.disabled=true;try{const r=await fnCall('updateOrder',{id:E.id,items});closeDlg();toast('נשמר · '+ils(r.total));if(r.warn&&r.warn.length)setTimeout(()=>toast('אין מספיק במלאי: '+r.warn.map(w=>w.n).join(', ')),2700);await after(E.id)}catch(e){b.disabled=false;err(e)}};

/* ---------- מלאי ---------- */
let SBR='';
V.oxStock=()=>{const T='מלאי';if(!on())return deny(T);if(!O.P){load();return loading(T)}const B=myBr();if(hasBr()&&!SBR&&B.length)SBR=B[0].id;const br=hasBr()?SBR:NB;
 const bc=B.length>1?`<div class="chips scroll-x" role="group" aria-label="סניף" style="margin:8px 0">${B.map(b=>`<button class="chip ${SBR===b.id?'on':''}" data-a="oxSBr" data-id="${esc(b.id)}" aria-pressed="${SBR===b.id}">${esc(b.name)}</button>`).join('')}</div>`:B.length===1?`<p class="note">סניף: ${esc(B[0].name)}</p>`:'';
 const L=stockL();
 return{t:T,s:hasBr()?bn(br):'כמויות במלאי',h:`<div class="row" style="margin-bottom:8px"><button class="btn grow" data-a="oxIn">הכנסת מלאי</button><button class="btn g grow" data-a="oxNewP">מוצר חדש</button></div>${sumH(br)}${catBar()}${bc}
 <label class="f"><span>חיפוש (שם או ברקוד)</span><input data-i="oxSQ" value="${esc(O.sq||'')}" autocomplete="off"></label>
 <div id="oxpl">${plH(L,br)}</div><button class="btn g s w" style="margin-top:8px" data-a="oxHist">היסטוריית תנועות</button>${mgr()?'<div class="row" style="margin-top:16px"><button class="btn g s grow" data-a="oxWipe" style="color:var(--bad)">מחיקת כל המלאי</button><button class="btn g s grow" data-a="oxRest">שחזור מלאי מגיבוי</button></div>':''}`}};
const plH=(L,br)=>L.map(p=>`<div class="li" style="cursor:default;flex-wrap:wrap"><div class="m"><b>${esc(p.name)}${p.on===false?' <span class="tag">לא זמין</span>':''}</b><small>${ils(unitP(p,br))}${p.barcode?' · '+esc(p.barcode):''}${p.cat?' · '+esc(catNm(p.cat))+(p.sub?' / '+esc(catNm(p.sub)):''):''}${costH(p.id)}${costXH(p.id)}${p.pk?' · מארז '+p.pk:''}${p.ct?' · קרטון '+p.ct:''}${hasBr()&&brs().length>1?' · '+brs().map(b=>esc(b.name)+': '+n3(q(p,b.id))).join(' · '):''}</small>${p.note?`<small class="note" style="width:100%;white-space:pre-wrap;overflow-wrap:anywhere">הערות: ${esc(p.note)}</small>`:''}</div><b class="a${q(p,br)<0?' neg':''}">${n3(q(p,br))}</b>
 <div class="row" style="width:100%"><button class="btn g s grow" data-a="oxZero" data-id="${esc(p.id)}">נגמר במלאי</button>${mgr()?`<button class="btn g s grow" data-a="oxFix" data-id="${esc(p.id)}">תיקון כמות</button>`:''}<button class="btn g s grow" data-a="oxEditP" data-id="${esc(p.id)}">עריכה</button></div></div>`).join('')||'<div class="empty">אין מוצרים. הוסף מוצר חדש.</div>';
INP.oxSQ=el=>{O.sq=el.value;const br=hasBr()?SBR:NB,L=stockL();const x=document.getElementById('oxpl');if(x)x.innerHTML=plH(L,br)};
ACT.oxSBr=el=>{SBR=el.dataset.id;rerender()};
const sbr=()=>hasBr()?SBR:undefined;
ACT.oxZero=el=>{const p=prod(el.dataset.id);if(!p)return;ask(`לסמן "${p.name}" כנגמר במלאי${hasBr()?' ב'+bn(SBR):''}? הכמות תתאפס.`,async()=>{try{await fnCall('stockSet',{reqId:rid(),pid:p.id,br:sbr(),qty:0});toast('עודכן');await load(true)}catch(e){err(e)}},'כן, נגמר')};
ACT.oxFix=el=>{const p=prod(el.dataset.id);if(!p)return;dlg(`<h3>תיקון כמות · ${esc(p.name)}</h3><form data-f="oxFixF"><input type="hidden" name="id" value="${esc(p.id)}"><label class="f"><span>הכמות הנכונה${hasBr()?' ב'+esc(bn(SBR)):''}</span><input name="q" inputmode="decimal" value="${n3(q(p,hasBr()?SBR:NB))}" required></label><div class="row"><button class="btn grow">שמור</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`)};
/* 11.11.2026: מחיקת כל המלאי (מנהל) – הקלדת "מחק" לאישור; השרת שומר גיבוי מלא לפני המחיקה. שחזור – מהגיבוי האחרון */
ACT.oxWipe=()=>dlg(`<h3>מחיקת כל המלאי</h3><p>יימחקו <b>כל המוצרים</b> (${(O.P||[]).length}) עם הכמויות, העלויות והמחירים, בכל הסניפים.</p><p class="note">לא נמחקים: קטגוריות, הזמנות והיסטוריית תנועות. לפני המחיקה נשמר גיבוי, ואפשר לשחזר אותו בכפתור "שחזור מלאי מגיבוי".</p><form data-f="oxWipeF"><input type="hidden" name="req" value="${rid()}"><label class="f"><span>כדי לאשר הקלידו: מחק</span><input name="cf" autocomplete="off" required></label><div class="row"><button class="btn r grow">מחק את כל המלאי</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`);
FRM.oxWipeF=async f=>{const x=fd(f);if(String(x.cf||'').trim()!=='מחק')return toast('כדי למחוק יש להקליד: מחק');const b=f.querySelector('button');b.disabled=true;try{const r=await fnCall('wipeStock',{reqId:x.req,confirm:'מחק'});closeDlg();toast('נמחקו '+(r&&r.n||0)+' מוצרים. נשמר גיבוי');await load(true)}catch(e){b.disabled=false;err(e)}};
ACT.oxRest=()=>ask('לשחזר את המלאי מהגיבוי האחרון? מוצרים שקיימים עכשיו נשארים כמו שהם.',async()=>{try{const r=await fnCall('restoreStock',{reqId:rid()});toast('שוחזרו '+(r&&r.n||0)+' מוצרים'+(r&&r.skip?' ('+r.skip+' כבר קיימים)':''));await load(true)}catch(e){err(e)}},'שחזר');
FRM.oxFixF=async f=>{const x=fd(f),v=num(x.q);if(!isFinite(v))return toast('כמות לא תקינה');const b=f.querySelector('button');b.disabled=true;try{await fnCall('stockSet',{reqId:rid(),pid:x.id,br:sbr(),qty:v});closeDlg();toast('עודכן');await load(true)}catch(e){b.disabled=false;err(e)}};
const pForm=(p)=>`<h3>${p?'עריכת מוצר':'מוצר חדש'}</h3><form data-f="oxPF">${p?`<input type="hidden" name="id" value="${esc(p.id)}">`:`<input type="hidden" name="req" value="${rid()}">`}${fld('שם המוצר','name',p?p.name:'','text','required maxlength="60"')}${fld('מחיר מכירה ₪','price',p?p.price:'','text','required inputmode="decimal"')}${fld('ברקוד (רשות)','barcode',p?p.barcode||'':'','text','inputmode="numeric" maxlength="30" dir="ltr"')}
 ${pExtH(p)}${p?'':fld('כמות פתיחה'+(hasBr()?' ב'+esc(bn(SBR)):'')+' (רשות)','qty','','text','inputmode="decimal"')}<div class="row">${fld('עלות לפני מע"מ ₪','costx',p&&costOf(p.id)!=null?exVat(costOf(p.id)):'','text','inputmode="decimal" data-i="oxCostX"').replace('<label class="f">','<label class="f grow">')}${fld('מחיר עלות כולל מע"מ ₪ (ריק = לא משתנה)','cost',p&&costOf(p.id)!=null?costOf(p.id):'','text','inputmode="decimal" data-i="oxCostInc"').replace('<label class="f">','<label class="f grow">')}</div><p class="note" style="margin:0 0 8px">ממלאים אחד מהשניים והשני יתמלא לבד (מע"מ ${vatP()}%).</p><label class="f"><span>הערות (רשות, עד 500 תווים)</span><textarea name="note" maxlength="500" rows="3" style="width:100%;box-sizing:border-box">${esc(p&&p.note||'')}</textarea></label>${p?`<label class="cb" style="min-height:44px;display:flex;align-items:center;gap:6px"><input type="checkbox" name="off"${p.on===false?' checked':''}> לא זמין להזמנה</label>`:''}
 <div class="row"><button class="btn grow">שמור</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`;
INP.oxCostX=el=>{const o=el.form&&el.form.elements.cost;if(!o)return;const n=num(el.value);o.value=el.value.trim()&&n>=0?String(incVat(n)):''};
INP.oxCostInc=el=>{const o=el.form&&el.form.elements.costx;if(!o)return;const n=num(el.value);o.value=el.value.trim()&&n>=0?String(exVat(n)):''};
ACT.oxNewP=()=>dlg(pForm(null));
ACT.oxEditP=el=>{const p=prod(el.dataset.id);if(p)dlg(pForm(p))};
FRM.oxPF=async f=>{const x=fd(f),price=num(x.price);if(!x.name.trim())return toast('חסר שם');if(!(price>=0))return toast('מחיר לא תקין');const d={name:x.name.trim(),price,barcode:x.barcode.trim()};
 if(!(x.cost&&x.cost.trim())&&x.costx&&x.costx.trim()){const e=num(x.costx);if(!(e>=0))return toast('עלות לא תקינה');x.cost=String(incVat(e))}/* רק 'לפני מע"מ' מולא – מחשבים כולל */
 if(x.cost&&x.cost.trim()){const c=num(x.cost);if(!(c>=0))return toast('עלות לא תקינה');if(!x.id||c!==costOf(x.id))d.cost=c}
 if(x.id){d.id=x.id;d.on=!x.off}else{d.reqId=x.req;if(x.qty&&x.qty.trim()){const v=num(x.qty);if(!(v>=0))return toast('כמות לא תקינה');d.qty=v;d.br=sbr()}else if(hasBr())d.br=SBR}
 try{Object.assign(d,pExtRead(f,x,!x.id))}catch(e){return toast(e.message)}
 const b=f.querySelector('button');b.disabled=true;try{await fnCall('saveProduct',d);closeDlg();toast('המוצר נשמר');await load(true)}catch(e){b.disabled=false;err(e)}};
// הכנסת מלאי – כמה שורות בבת אחת
ACT.oxIn=()=>{O.inL=[{pid:'',qty:''}];O.inReq=rid();dlg(inH())};
const inH=()=>`<h3>הכנסת מלאי${hasBr()?' · '+esc(bn(SBR)):''}</h3><form data-f="oxInF">${O.inL.map((l,i)=>`<div class="row"><label class="f grow"><span>מוצר</span><select name="p${i}"><option value="">בחר</option>${(O.P||[]).map(p=>`<option value="${esc(p.id)}"${l.pid===p.id?' selected':''}>${esc(p.name)}${p.barcode?' · '+esc(p.barcode):''}</option>`).join('')}</select></label><label class="f" style="width:96px"><span>כמות</span><input name="q${i}" inputmode="decimal" value="${esc(l.qty)}"></label></div>`).join('')}
 <button type="button" class="btn g s w" data-a="oxInAdd">＋ שורה</button><div class="row" style="margin-top:8px"><button class="btn grow">הוסף למלאי</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`;
const inRead=()=>{const f=document.querySelector('#dlg form');if(!f)return;const x=fd(f);O.inL=O.inL.map((l,i)=>({pid:x['p'+i]||'',qty:x['q'+i]||''}))};
ACT.oxInAdd=()=>{inRead();O.inL.push({pid:'',qty:''});dlg(inH())};
FRM.oxInF=async f=>{inRead();const lines=[];for(const l of O.inL){if(!l.pid&&!l.qty)continue;const v=num(l.qty);if(!l.pid)return toast('בחר מוצר בכל שורה');if(!(v>0))return toast('כמות לא תקינה');lines.push({pid:l.pid,qty:v})}if(!lines.length)return toast('אין שורות');
 const b=f.querySelector('button.grow:not(.g)');b.disabled=true;try{await fnCall('stockIn',{reqId:O.inReq,br:sbr(),lines});closeDlg();toast('המלאי עודכן');await load(true)}catch(e){b.disabled=false;err(e)}};
ACT.oxHist=async()=>{dlg('<h3>היסטוריית תנועות</h3><p class="note">טוען…</p>');try{const L=(await runQ('stockLog',brWhere(),300)).sort((a,b)=>b.at-a.at).slice(0,150);
 dlg(`<h3>היסטוריית תנועות</h3><div style="max-height:60vh;overflow:auto">${L.map(x=>`<div class="note" style="padding:6px 0;border-bottom:1px solid var(--line)">${tm(x.at)} · <b>${esc(x.name)}</b>${hasBr()?' · '+esc(bn(x.br)):''} · ${WHY[x.why]||x.why} · <bdi dir="ltr">${x.delta>0?'+':''}${n3(x.delta)}</bdi>${x.no?' · הזמנה #'+x.no:''}${x.note?' · '+esc(x.note):''}</div>`).join('')||'<p class="note">אין תנועות</p>'}</div><button class="btn g w" data-a="closeDlg">סגור</button>`)}catch(e){dlg(`<h3>היסטוריית תנועות</h3><p class="note">${esc(e.message)}</p><button class="btn g w" data-a="closeDlg">סגור</button>`)}};

/* ---------- מקור המלאי לכל סניף (מנהל) ---------- */
V.oxCfg=()=>{const T='מאיזה סניף יורד המלאי';if(!on()||!mgr())return deny(T);if(!O.cfg){load();return loading(T)}const B=brs();
 return{t:T,s:'לכל סניף בנפרד',h:`<p class="note">"לפי המלאי" – בכל שורה מוצע הסניף שיש בו מספיק, והעובד יכול לשנות. סניף קבוע – כל ההזמנות של הסניף יורדות ממלאי של הסניף שנבחר; הסחורה מועברת לסניף ההזמנה.</p>
 <form class="card" data-f="oxCfgF">${B.map(b=>`<label class="f"><span>הזמנות של ${esc(b.name)}</span><select name="${esc(b.id)}"><option value="stock">לפי המלאי</option>${B.map(x=>`<option value="${esc(x.id)}"${srcOf(b.id)===x.id?' selected':''}>תמיד מ${esc(x.name)}</option>`).join('')}</select></label>`).join('')}<button class="btn w">שמור</button></form>
 <form class="card" data-f="oxVatF"><label class="f"><span>אחוז מע"מ (לחישוב עלות לפני/אחרי מע"מ)</span><input name="vat" inputmode="decimal" value="${vatP()}" required></label><button class="btn w">שמור</button></form>`}};
FRM.oxVatF=async f=>{const x=fd(f),v=num(x.vat);if(!(v>=0&&v<=100))return toast('אחוז מע"מ: מספר בין 0 ל-100');const b=f.querySelector('button');b.disabled=true;try{await fnCall('setOrderCfg',{vat:r2(v)});toast('נשמר');await load(true)}catch(e){err(e)}finally{b.disabled=false}};
FRM.oxCfgF=async f=>{const src=fd(f),b=f.querySelector('button');b.disabled=true;try{await fnCall('setOrderCfg',{src});toast('נשמר');await load(true)}catch(e){err(e)}finally{b.disabled=false}};

/* ---------- מנהל־על: תשלום בהזמנות, בכרטיס העסק ---------- */
const PAYC={};
{const s=V.sab;if(s)V.sab=id=>{const r=s(id);try{const b=(ADM.L||[]).find(x=>x.id===id);if(!SY.sa||!b||(b.missing&&id!==BZ0)||!r||!r.h)return r;const pf=(b.dataRoot==='legacy'||b.missing)&&id===BZ0?'':'/b/'+id;
 const c=PAYC[id];if(c===undefined){PAYC[id]=null;Promise.all([fsx(pf+'/ordcfg/main',{},true).then(d=>dec(d).pay||{}).catch(()=>({})),fsx(pf+'/cfg/main',{},true).then(d=>{const j=JSON.parse(fvj(d.fields&&d.fields.data)||'{}');return(j.cats||[]).filter(c=>c.beh==='sup').flatMap(c=>(c.subs||[]).map(x=>({id:x.id,name:x.name})))}).catch(()=>[])]).then(([p,sups])=>{PAYC[id]=Object.assign({},p,{sups})}).finally(()=>{if(cur().v==='sab')rerender()})}
 const p=c||{},mode=p.mode==='link'?'link':'phone';
 r.h+=`<div class="sec"><h3>תשלום בהזמנות</h3></div><form class="card" data-f="oxPayF" data-id="${esc(id)}"><p class="note" style="margin-top:0">${c===null?'טוען…':p.mode==='link'&&p.has?'מוגדר קישור סליקה. מטעמי אבטחה הקישור לא מוצג – אפשר להחליף אותו.':p.mode==='phone'?'מוגדר: תשלום בטלפון.':'עדיין לא הוגדר. ברירת המחדל: תשלום בטלפון.'} העובדים לא רואים את הקישור, רק כפתור "לתשלום".</p>
 <div class="chips" role="radiogroup"><label class="chip" style="min-height:44px"><input type="radio" name="mode" value="link"${mode==='link'?' checked':''}> קישור סליקה</label><label class="chip" style="min-height:44px"><input type="radio" name="mode" value="phone"${mode==='phone'?' checked':''}> תשלום בטלפון</label></div>
 <label class="f"><span>הקישור שייך לספק (זיכוי אצלו על כל הזמנה ששולמה בקישור; יסומן אוטומטית כספק קיזוז)</span><select name="sup"><option value="">בלי ספק</option>${(p.sups||[]).map(x=>`<option value="${esc(x.id)}"${p.sup&&p.sup.id===x.id?' selected':''}>${esc(x.name)}</option>`).join('')}</select></label>
 <label class="f"><span>קישור לדף הסליקה (https)</span><input name="link" type="url" dir="ltr" maxlength="500" placeholder="https://" autocomplete="off"></label><button class="btn w">שמור</button></form>`}catch(e){}return r}}
FRM.oxPayF=async f=>{const id=f.dataset.id,x=fd(f);if(x.mode==='link'&&!/^https:\/\/[^\s]+\.[^\s]+/.test(x.link||''))return toast('קישור חייב להתחיל ב-https://');const b=f.querySelector('button');b.disabled=true;
 try{const P0=PAYC[id]||{},su=x.sup?(P0.sups||[]).find(s=>s.id===x.sup):null;const r=await fnCall('setBusinessPayLink',{bizId:id,mode:x.mode,link:x.mode==='link'?x.link.trim():undefined,sup:x.mode==='link'&&su?{id:su.id,name:su.name}:undefined});PAYC[id]=Object.assign({},P0,{mode:r.mode,has:r.has,sup:r.sup||null});toast('נשמר');rerender()}catch(e){err(e)}finally{b.disabled=false}};

/* ---------- 17:47–17:59: הזמנה ששולמה דרך קישור הספק → הכנסה בסניף ההזמנה + זיכוי אצל הספק ----------
   השרת כותב ordpay/{ordId} (st paid/void). היומן נמצא במכשיר המנהל (S), ולכן כאן – רק אצל מנהל – כל רשומה הופכת לתנועת הכנסה אחת:
   tx.id='op_'+ordId, t:'inc', קטגוריה "הכנסות מהזמנות", br = סניף ההזמנה, off:{sub:ספק} = זכות אצל הספק לקיזוז (המנגנון הקיים offBal/offPay).
   הזכות עצמה לא נספרת שוב: offBal סופר את ההכנסה הזו כזכות, וחשבונית הספק נרשמת כהוצאה רגילה ומשולמת ב'קיזוז'. void → t.x=1 (מבוטל, לא נמחק). */
const OPC='c_ordinc';
function opCat(){let c=S.cats.find(x=>x.id===OPC);if(!c){c={id:OPC,kind:'inc',name:'הכנסות מהזמנות',beh:'simple'};S.cats.push(c)}let u=S.subs.find(x=>x.cat===OPC&&x.name==='תשלום בקישור');if(!u){u={id:'s_ordlink',cat:OPC,name:'תשלום בקישור'};S.subs.push(u)}return u.id}
const ymd2=t=>{const d=new Date(t);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
let OPB=0;
async function opSync(){if(OPB||!isA()||!bzF('orders')||typeof S==='undefined'||!S)return 0;OPB=1;let n=0;
 /* 2,000 השינויים האחרונים (לפי upd) – רשומה ישנה יותר כבר נקלטה בסנכרון קודם */const warn=[];try{const L=await runQ('ordpay',null,2000,'upd');for(const r of L){if(!r.ord||!(r.amt>=0)||!r.sup||!r.sup.id)continue;const id='op_'+r.ord;let t=S.tx.find(x=>x.id===id);
   /* בודק סבב 1, ליקוי 2: הספק של הקישור מסומן אוטומטית כ"ספק קיזוז" כדי שהזכות תיראה בכרטיס שלו ותהיה ניתנת לקיזוז */const u=subById(r.sup.id);if(u&&!u.offset&&r.st==='paid'){u.offset=true;n++;toast('הספק "'+u.name+'" סומן כספק קיזוז – הזיכויים מהזמנות בקישור מופיעים בכרטיס שלו')}
   if(r.st==='paid'){const f={t:'inc',cat:OPC,sub:opCat(),date:ymd2(r.at),amt:Math.round(r.amt*100)/100,note:'הזמנה #'+r.no,off:{sub:r.sup.id},ordp:r.ord};if(r.br&&r.br!==NB)f.br=r.br;
    if(!t){S.tx.push(Object.assign({id},f));n++}else if(t.x||t.amt!==f.amt||t.date!==f.date||t.br!==f.br||!t.off||t.off.sub!==f.off.sub){delete t.x;Object.assign(t,f);n++}}
   else if(r.st==='void'&&t&&!t.x){t.x=1;n++;try{const B=offBal(r.sup.id);if(B.bal<-0.004)warn.push((u?u.name:r.sup.name)+': '+ils(B.bal))}catch(e){}}}
  if(warn.length)setTimeout(()=>toast('שים לב: יתרת זכות שלילית אצל '+warn.join(', ')),2700);
  if(n){save();if(!typing())rerender()}}catch(e){}finally{OPB=0}return n}
{const L0=load;load=async f=>{await L0(f);opSync()}}
/* סנכרון רק כשהמנהל בבית או במסכי ההזמנות (לא טיימר כללי שמתערב בפעולות אחרות) */let OPT=0;const opMaybe=()=>{if(Date.now()-OPT<120000)return;OPT=Date.now();opSync()};
{const h1=V.home;if(h1)V.home=()=>{const r=h1();try{if(isA()&&bzB()&&bzF('orders'))setTimeout(opMaybe,1500)}catch(e){}return r}}

/* 17:51: שיוך ספק לסניף (subs[].br, רשות). בכרטיס הספק – בחירת סניף; חשבונית חדשה של הספק מקבלת אותו כסניף ברירת מחדל (brGuess).
   חשבוניות קיימות לא משתנות. עסק עם פחות מ-2 סניפים – שום שינוי. */
{const c0=V.card;if(c0)V.card=id=>{const r=c0(id);try{const u=subById(id),c=u&&cat(u.cat);if(!isA()||!u||!c||c.beh!=='sup'||!r||!r.h||brs().length<2)return r;
 r.h+=`<div class="sec"><h3>סניף הספק</h3></div><div class="card"><label class="f"><span>חשבוניות של הספק נרשמות כהוצאה בסניף</span><select data-c="oxSupBr" data-id="${esc(u.id)}"><option value="">לא משויך (לפי זיהוי)</option>${brs().map(b=>`<option value="${esc(b.id)}"${u.br===b.id?' selected':''}>${esc(b.name)}</option>`).join('')}</select></label>${u.offset?'<p class="note" style="margin:0">הזיכויים מהזמנות ששולמו בקישור של הספק מצטברים בכרטיס הקיזוז שלו.</p>':''}</div>`}catch(e){}return r}}
CHG.oxSupBr=el=>{const u=subById(el.dataset.id);if(!u)return;if(el.value&&brs().some(b=>b.id===el.value))u.br=el.value;else delete u.br;save();toast('נשמר')};
if(typeof brGuess==='function'){const g0=brGuess;brGuess=function(t){try{const u=t&&t.sub?subById(t.sub):null;if(u&&u.br&&!(t&&t.br)&&brList().some(b=>b.id===u.br))return{id:u.br,sure:true}}catch(e){}return g0(t)}}

/* 18:56: העברה פנימית בדוח "לפי סניף" – הזכות אצל ספק קיזוז שנוצלה (תשלום 'קיזוז' על חשבונית הספק) כשסניף ההכנסה ≠ סניף החשבונית.
   הקצאה: הזכות הוותיקה ביותר מנוצלת ראשונה (יתרת פתיחה – בלי סניף, לא מעבירה). החודש = תאריך הקיזוז. סך העסק = 0. שאר הדוחות לא משתנים. */
function brXfer(m){const N={};let any=false;
 for(const u of S.subs.filter(x=>x&&x.offset)){const src=[];const b0=typeof u.offBal0==='number'?u.offBal0:0;if(b0>0)src.push({br:null,left:b0,d:''});
  live().filter(t=>t.t==='inc'&&t.off&&t.off.sub===u.id&&+t.amt>0).sort((a,b)=>String(a.date).localeCompare(String(b.date))).forEach(t=>src.push({br:txBr(t),left:+t.amt,d:t.date}));
  const use=[];live().filter(t=>t.t==='exp'&&t.sub===u.id).forEach(t=>(t.pays||[]).forEach(p=>{if(p&&p.m==='קיזוז'&&+p.a>0)use.push({br:txBr(t),a:+p.a,d:String(p.d||t.date||'')})}));
  use.sort((a,b)=>a.d.localeCompare(b.d));let i=0;
  for(const x of use){let need=x.a;while(need>0.004&&i<src.length){const c=Math.min(need,src[i].left);if(src[i].br&&x.br&&src[i].br!==x.br&&x.d.startsWith(m)){N[src[i].br]=rnd((N[src[i].br]||0)-c);N[x.br]=rnd((N[x.br]||0)+c);any=true}src[i].left-=c;need-=c;if(src[i].left<=0.004)i++}}}
 return any?N:null}
if(typeof brTable==='function'){const bt0=brTable;brTable=function(m){const h=bt0(m);try{if(!h)return h;const X=brXfer(m);if(!X)return h;const E=brFil(),L=brList(),ids=new Set(L.map(b=>b.id));
  const rows=brAll().filter(b=>(ids.has(b.id)||(!brMineIds()&&live().some(t=>t.date.startsWith(m)&&txBr(t)===b.id)))&&(!E.length||E.includes(b.id)));
  const v=b=>X[b.id]||0,tot=rnd(rows.reduce((s,b)=>s+v(b),0));
  return h+`<div class="tw" style="margin-top:6px"><table id="brXfer"><thead><tr><th>העברה פנימית</th><th class="n">סכום</th></tr></thead><tbody>${rows.map(b=>`<tr><td>${esc(b.name)}</td><td class="n ${v(b)>=0?'pos':'neg'}"><bdi dir="ltr">${v(b)>0?'+':''}</bdi>${ils(v(b))}</td></tr>`).join('')}</tbody><tfoot><tr><th>סה״כ לעסק</th><th class="n">${ils(tot)}</th></tr></tfoot></table></div><p class="note">זכות אצל ספק קיזוז שנוצלה לחשבונית בסניף אחר. מתקזז לאפס ברמת העסק; לא נכלל בהכנסות ובהוצאות.</p>`}catch(e){return h}}}

/* ---------- fb/ord-catalog: קטגוריות, מחיר לסניף, סיטונאי, מארז/קרטון, סניף בית, ייבוא מלאי, העברות ----------
   מחיר בפועל: bp[סניף] ?? price (מוצר ישן בלי bp – כמו קודם). מחיר סיטונאי לא נמצא על מסמך המוצר: נטען דרך getWsPrices.
   מי רואה סיטונאי – נקבע בשרת (WS_SHOW ב-orders.js); כאן wsCan() רק מסתיר כפתור, ושתי הנקודות צריכות להשתנות יחד.
   ללקוח בהזמנה: draft().custId + draft().wholesale – ממולאים ע"י מסך הלקוחות (fb/ord-cust); כאן רק נקראים. */
const unitP=(p,br)=>{const v=p&&p.bp&&typeof p.bp==='object'?p.bp[br]:undefined;return typeof v==='number'?v:(+(p&&p.price)||0)};
const catNm=id=>{const c=(O.C||[]).find(x=>x.id===id);return c?c.name:''};
const topC=()=>(O.C||[]).filter(c=>!c.parent);
const subC=id=>(O.C||[]).filter(c=>c.parent===id);
const catBar=()=>{const T=topC();if(!T.length&&!mgr())return '';return `<div class="row" style="margin:8px 0">${T.length?`<label class="f grow" style="margin:0"><span>קטגוריה</span><select data-c="oxCF"><option value="">הכול</option>${T.map(c=>`<option value="${esc(c.id)}"${O.cf===c.id?' selected':''}>${esc(c.name)}</option>${subC(c.id).map(u=>`<option value="${esc(u.id)}"${O.cf===u.id?' selected':''}>– ${esc(u.name)}</option>`).join('')}`).join('')}</select></label>`:''}</div>
 <div class="row" style="margin-bottom:8px">${mgr()?'<button class="btn g s grow" data-a="oxCats">קטגוריות</button>':''}${mgr()?'':'<button class="btn g s grow" data-a="go" data-v="oxImp">ייבוא מלאי</button>'}${hasBr()&&brs().length>1?'<button class="btn g s grow" data-a="go" data-v="oxXfer">העברות</button>':''}</div>`};
const stockL=()=>(O.P||[]).filter(p=>(!O.sq||String(p.name).includes(O.sq)||String(p.barcode||'')===O.sq.trim())&&(!O.cf||p.cat===O.cf||p.sub===O.cf));
CHG.oxCF=el=>{O.cf=el.value;rerender()};
const wsCan=()=>mgr()||!!(O.draft&&O.draft.custId&&O.draft.wholesale===true);
// טופס מוצר: קטגוריה/תת, מחיר שונה לסניף (נפתח לפי צורך), סיטונאי (מנהל ועובד עם ord), מארז, קרטון, סניף בית
const pExtH=p=>{const T=topC(),c=p&&p.cat||'',B=brs(),bp=p&&p.bp||{};
 const cs=T.length?`<div class="row"><label class="f grow"><span>קטגוריה</span><select name="cat"><option value="">ללא</option>${T.map(x=>`<option value="${esc(x.id)}"${c===x.id?' selected':''}>${esc(x.name)}</option>`).join('')}</select></label><label class="f grow"><span>תת־קטגוריה</span><select name="sub"><option value="">ללא</option>${T.flatMap(x=>subC(x.id).map(u=>`<option value="${esc(u.id)}"${p&&p.sub===u.id?' selected':''}>${esc(x.name)} / ${esc(u.name)}</option>`)).join('')}</select></label></div>`:'';
 const bh=B.length>1?`<details${Object.keys(bp).length?' open':''}><summary class="note" style="min-height:44px;display:flex;align-items:center">מחיר שונה לסניף (ריק = מחיר המכירה)</summary>${B.map(b=>fld('מחיר ב'+esc(b.name)+' ₪','bp_'+b.id,bp[b.id]!=null?bp[b.id]:'','text','inputmode="decimal"')).join('')}</details>`:'';
 return cs+bh+`<div class="row"><label class="f grow"><span>כמות במארז</span><input name="pk" inputmode="numeric" value="${esc(p&&p.pk||'')}"></label><label class="f grow"><span>כמות בקרטון</span><input name="ct" inputmode="numeric" value="${esc(p&&p.ct||'')}"></label></div>`
 +(B.length>1?`<label class="f"><span>סניף הבית של הפריט</span><select name="home"><option value="">לא נקבע</option>${B.map(b=>`<option value="${esc(b.id)}"${p&&p.home===b.id?' selected':''}>${esc(b.name)}</option>`).join('')}</select></label>`:'')
 +fld('מחיר סיטונאי ₪ (ריק = לא משתנה)','wp','','text','inputmode="decimal"')}; // 00:13: גם עובד עם ord
function pExtRead(f,x,isNew){const d={},T=topC();if(T.length){d.cat=x.cat||null;d.sub=x.sub||null;if(d.sub){const s=(O.C||[]).find(c=>c.id===d.sub);if(s&&!d.cat)d.cat=s.parent;if(s&&d.cat!==s.parent)throw new Error('תת־הקטגוריה לא שייכת לקטגוריה שנבחרה')}}
 const B=brs();if(B.length>1){const bp={};let any=false;for(const b of B){const v=String(x['bp_'+b.id]||'').trim();if(v){const n=num(v);if(!(n>=0))throw new Error('מחיר לסניף לא תקין');bp[b.id]=n;any=true}else if(!isNew)bp[b.id]=''}if(any||!isNew)d.bp=bp;d.home=x.home||null}
 for(const k of['pk','ct']){const v=String(x[k]||'').trim();if(v){const n=num(v);if(!(n>0)||!Number.isInteger(n))throw new Error('מארז/קרטון: מספר שלם');d[k]=n}else if(!isNew)d[k]=null}
 if(x.wp&&x.wp.trim()){const n=num(x.wp);if(!(n>=0))throw new Error('מחיר סיטונאי לא תקין');d.wp=n}
 {const nt=String(x.note||'').trim();if(nt.length>500)throw new Error('הערות: עד 500 תווים');if(nt)d.note=nt;else if(!isNew)d.note=null}return d}

/* קטגוריות (מנהל) */
ACT.oxCats=()=>dlg(catsH());
const catsH=()=>`<h3>קטגוריות</h3><div style="max-height:45vh;overflow:auto">${topC().map(c=>`<div class="li" style="cursor:default"><div class="m"><b>${esc(c.name)}</b><small>${subC(c.id).map(u=>esc(u.name)).join(' · ')||'אין תת־קטגוריות'}</small></div></div>`).join('')||'<p class="note">עדיין אין קטגוריות</p>'}</div>
 <form data-f="oxCatF"><label class="f"><span>שם</span><input name="name" required maxlength="40"></label><label class="f"><span>תחת קטגוריה (לתת־קטגוריה)</span><select name="parent"><option value="">קטגוריה ראשית</option>${topC().map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></label><div class="row"><button class="btn grow">הוסף</button><button type="button" class="btn g grow" data-a="closeDlg">סגור</button></div></form>`;
FRM.oxCatF=async f=>{const x=fd(f),b=f.querySelector('button');if(!x.name.trim())return;b.disabled=true;try{await fnCall('saveCat',{name:x.name.trim(),parent:x.parent||undefined});O.C=await runQ('cat',null,500).catch(()=>O.C);toast('נשמר');dlg(catsH())}catch(e){b.disabled=false;err(e)}};

/* מחיר סיטונאי בהזמנה: כפתור רק כשמותר (wsCan); המחירים נטענים מהשרת ומוחלים על שורות המוצרים */
{const n0=V.oxNew;V.oxNew=()=>{const r=n0();try{if(r&&r.h&&O.P&&wsCan())r.h=r.h.replace('<div class="sec"><h3>מוצרים</h3></div>',`<div class="sec"><h3>מוצרים</h3><button class="btn s g" data-a="oxWs">החל מחיר סיטונאי</button></div>`)}catch(e){}return r}}
ACT.oxWs=async el=>{const D=draft();el.disabled=true;try{const W=await wsLoad(D);let k=0;D.items.forEach(it=>{if(it.pid&&typeof W[it.pid]==='number'){it.price=String(W[it.pid]);it.auto=0;k++}});O.wsP=W;toast(k?'הוחל מחיר סיטונאי על '+k+' שורות':'אין מחיר סיטונאי למוצרים שבהזמנה');rerender()}catch(e){err(e)}finally{el.disabled=false}};
/* מנהל: כל המחירים, בעמודים (next) – בלי חיתוך. עובד: רק שורות ההזמנה, ללקוח שמקושר לטיוטה (reqId) */
async function wsLoad(D){if(mgr()){const W={};let a;for(let g=0;g<200;g++){const r=await fnCall('getWsPrices',a?{after:a}:{});Object.assign(W,r&&r.wp||{});if(!r||!r.next)break;a=r.next}return W}
 const pids=[...new Set(D.items.filter(it=>it.pid).map(it=>it.pid))].slice(0,100);if(!pids.length)return {};D.wsC=D.custId;const r=await fnCall('getWsPrices',{custId:D.custId,reqId:D.req,pids});return r&&r.wp||{}}

/* העברות בין סניפים: רשימה + העברה ידנית */
V.oxXfer=()=>{const T='העברות בין סניפים';if(!on())return deny(T);if(!O.P){load();return loading(T)}if(O.xf===undefined){O.xf=null;xfLoad()}
 const XW={order:'הזמנה',cancel:'ביטול הזמנה',edit:'עריכת הזמנה',manual:'ידנית'};
 return{t:T,s:'סחורה שעברה מסניף לסניף',h:`<button class="btn w" data-a="oxXfNew">העברה ידנית</button><div class="sec"><h3>אחרונות</h3></div>${O.xf?O.xf.map(x=>`<div class="li" style="cursor:default"><div class="m"><b>${esc(x.name)}</b><small>${tm(x.at)} · ${esc(bn(x.from))} ← ${esc(bn(x.to))} · ${XW[x.why]||esc(x.why)}${x.no?' · הזמנה #'+x.no:''}${x.note?' · '+esc(x.note):''}</small></div><b class="a">${n3(x.qty)}</b></div>`).join('')||'<div class="empty">אין העברות</div>':'<p class="note">טוען…</p>'}`}};
async function xfLoad(){try{const m=mine()&&hasBr()?mine().slice(0,30):null;
 /* עובד עם סניפים מוגבלים: שתי שאילתות (מקור / יעד בסניפים שלו) – כך החוקים מאשרים את הרשימה */
 const inF=f=>({fieldFilter:{field:{fieldPath:f},op:'IN',value:{arrayValue:{values:m.map(x=>({stringValue:x}))}}}});
 const L0=m?[].concat(...await Promise.all([runQ('xfer',inF('from'),300),runQ('xfer',inF('to'),300)])):await runQ('xfer',null,300);
 const L=[...new Map(L0.map(x=>[x.id,x])).values()];O.xf=L.sort((a,b)=>b.at-a.at).slice(0,150)}catch(e){O.xf=[]}if(cur().v==='oxXfer'&&!typing())rerender()}
ACT.oxXfNew=()=>{const B=brs(),M=mine(),F=M?B.filter(b=>M.includes(b.id)):B;if(!F.length)return toast('אין סניף מקור שמשויך אליך');
 dlg(`<h3>העברה ידנית</h3><form data-f="oxXfF"><input type="hidden" name="req" value="${rid()}"><label class="f"><span>מוצר</span><select name="pid" required><option value="">בחר</option>${(O.P||[]).map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></label>
 <div class="row"><label class="f grow"><span>מסניף</span><select name="from">${F.map(b=>`<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('')}</select></label><label class="f grow"><span>לסניף</span><select name="to">${B.map((b,i)=>`<option value="${esc(b.id)}"${i===1?' selected':''}>${esc(b.name)}</option>`).join('')}</select></label></div>
 <label class="f"><span>כמות</span><input name="qty" inputmode="decimal" required></label><label class="f"><span>הערה (רשות)</span><input name="note" maxlength="200"></label><div class="row"><button class="btn grow">העבר</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`)};
FRM.oxXfF=async f=>{const x=fd(f),v=num(x.qty);if(!x.pid)return toast('בחר מוצר');if(x.from===x.to)return toast('סניף המקור והיעד זהים');if(!(v>0))return toast('כמות לא תקינה');const b=f.querySelector('button');b.disabled=true;
 try{const r=await fnCall('transferStock',{reqId:x.req,pid:x.pid,from:x.from,to:x.to,qty:v,note:x.note||undefined});closeDlg();toast(r&&r.warn?'הועבר. שים לב: בסניף המקור המלאי במינוס':'הועבר');O.xf=undefined;await load(true)}catch(e){b.disabled=false;err(e)}};

/* ייבוא מלאי (מנהל, ועובד עם ord – כולל סיטונאי ועלות, 00:12): קובץ ← התאמת עמודות (נזכרת) ← תצוגה מקדימה עם שורות שגויות ← ייבוא במנות של 200 */
const IMF0=[['name','שם המוצר',1],['price','מחיר מכירה',1],['barcode','ברקוד'],['qty','כמות'],['cat','קטגוריה'],['sub','תת־קטגוריה'],['wp','מחיר סיטונאי'],['cost','מחיר עלות'],['costx','עלות לפני מע"מ'],['pk','כמות במארז'],['ct','כמות בקרטון'],['note','הערות']];
const IMF=IMF0; // 00:12: גם עובד מייבא סיטונאי ועלות
const IMK='lp-ox-imp-map';
const imMap0=()=>{try{return JSON.parse(localStorage.getItem(IMK)||'{}')||{}}catch(e){return{}}};
V.oxImp=()=>{const T='ייבוא מלאי';if(!on())return deny(T);if(!O.P){load();return loading(T)}const I=O.im;
 if(!I)return{t:T,s:'Excel או CSV',h:`<div class="card"><p class="note" style="margin-top:0">שורה ראשונה = כותרות. אחרי בחירת הקובץ בוחרים איזו עמודה היא איזה שדה. מוצר קיים (לפי ברקוד, ואם אין – לפי שם מדויק) מתעדכן ולא נוצר פעמיים.</p><label class="btn w" style="display:flex;align-items:center;justify-content:center">בחר קובץ<input type="file" accept=".xlsx,.xls,.csv" data-c="oxImpFile" style="position:absolute;opacity:0;width:1px;height:1px"></label></div>`};
 const opt=(k)=>`<option value="">— לא לייבא —</option>${I.head.map((h,i)=>`<option value="${i}"${String(I.map[k])===String(i)?' selected':''}>${esc(String(h||'עמודה '+(i+1)))}</option>`).join('')}`;
 const pv=imRows(),bad=pv.filter(r=>r.err),good=pv.length-bad.length;
 return{t:T,s:esc(I.file),h:`<div class="card"><b>התאמת עמודות</b>${IMF.map(([k,l,req])=>`<label class="f"><span>${l}${req?' (חובה)':''}</span><select data-c="oxImpMap" data-k="${k}">${opt(k)}</select></label>`).join('')}</div>
 ${hasBr()?`<label class="f"><span>הכמות נכנסת לסניף</span><select data-c="oxImpBr">${myBr().map(b=>`<option value="${esc(b.id)}"${I.br===b.id?' selected':''}>${esc(b.name)}</option>`).join('')}</select></label>`:''}
 <label class="cb" style="min-height:44px;display:flex;align-items:center;gap:6px"><input type="checkbox" data-c="oxImpAdd"${I.add?' checked':''}> הוסף כמות גם למוצרים קיימים (בלי סימון – מוצר קיים מתעדכן בשם/מחיר בלבד)</label>
 <div class="card"><b>${good} שורות תקינות</b>${bad.length?` · <span class="neg">${bad.length} שגויות (לא ייובאו)</span>`:''}<div style="max-height:40vh;overflow:auto;margin-top:6px">${pv.slice(0,60).map(r=>`<div class="note" style="padding:4px 0;border-bottom:1px solid var(--line)${r.err?';color:var(--neg,#e66)':''}">${r.n}. ${esc(r.o.name||'')} · ${esc(String(r.o.price!=null?r.o.price:''))}${r.o.qty?' · כמות '+esc(String(r.o.qty)):''}${r.err?' – '+esc(r.err):''}</div>`).join('')}${pv.length>60?`<p class="note">ועוד ${pv.length-60} שורות…</p>`:''}</div></div>
 <button class="btn w" data-a="oxImpGo"${good?'':' disabled'}>ייבא ${good} שורות</button><button class="btn g w" style="margin-top:8px" data-a="oxImpX">קובץ אחר</button>`}};
CHG.oxImpFile=async el=>{const f=el.files&&el.files[0];if(!f)return;try{if(/\.pdf$/i.test(f.name))throw new Error('ייבוא מלאי – רק Excel או CSV');const T=await readTable(f);const rows=(T||[]).filter(r=>Array.isArray(r)&&r.some(c=>String(c).trim()));if(rows.length<2)throw new Error('בקובץ אין שורות מתחת לכותרות');
 const head=rows[0].map(c=>String(c==null?'':c).trim()),M0=imMap0(),map={};for(const[k]of IMF){const v=M0[k];const i=v?head.indexOf(v):-1;if(i>-1)map[k]=i};/* 10.11: זיהוי אוטומטי לפי שם הכותרת כשאין התאמה שמורה */const IMG={name:/^(שם ?ה?(מוצר|פריט)|שם|מוצר|פריט|תיאור)$/,price:/^(מחיר( מכירה| לצרכן)?)$/,barcode:/^(ברקוד|מק"?ט ברקוד|barcode)$/i,qty:/^(כמות|מלאי|כמות במלאי|יתרה)$/,cat:/^קטגוריה$/,sub:/^תת.?קטגוריה$/,wp:/^מחיר סיטונאי$/,cost:/^(עלות|מחיר עלות|מחיר קנייה)$/,costx:/^(עלות|מחיר) (לפני|ללא) מע["״”']?מ$/,note:/^(הערות|הערה|תיאור נוסף)$/,pk:/^כמות במארז$/,ct:/^כמות בקרטון$/};const used=new Set(Object.values(map));for(const[k]of IMF){if(map[k]!=null||!IMG[k])continue;const i=head.findIndex((h,j)=>!used.has(j)&&IMG[k].test(h));if(i>-1){map[k]=i;used.add(i)}}
 O.im={file:f.name,head,rows:rows.slice(1),map,br:hasBr()?(SBR||(myBr()[0]||{}).id||''):'',add:false,req:rid()};rerender()}catch(e){err(e)}};
CHG.oxImpMap=el=>{const I=O.im;if(!I)return;if(el.value==='')delete I.map[el.dataset.k];else I.map[el.dataset.k]=+el.value;I.req=rid();const m={};for(const[k,i]of Object.entries(I.map))m[k]=I.head[i];try{localStorage.setItem(IMK,JSON.stringify(m))}catch(e){}rerender()};
CHG.oxImpBr=el=>{if(O.im){O.im.br=el.value;O.im.req=rid()}};
CHG.oxImpAdd=el=>{if(O.im){O.im.add=el.checked;O.im.req=rid()}};
ACT.oxImpX=()=>{O.im=null;rerender()};
const cellN=v=>{if(typeof v==='number')return v;const s=String(v==null?'':v).replace(/[₪\s,]/g,'');if(s==='')return null;return /^-?\d+(\.\d+)?$/.test(s)?+s:NaN};
function imRows(){const I=O.im,M=I.map,out=[];if(M.name==null||M.price==null)return I.rows.map((r,i)=>({n:i+2,o:{},err:'יש לבחור עמודות לשם ולמחיר'}));
 I.rows.forEach((r,i)=>{const g=k=>M[k]==null?'':r[M[k]];const o={name:String(g('name')).trim()},e=[];if(!o.name)e.push('חסר שם');
  const pr=cellN(g('price'));if(pr==null||isNaN(pr)||pr<0)e.push('מחיר לא תקין');else o.price=pr;
  const bc=String(g('barcode')).trim();if(bc){if(/^[0-9A-Za-z-]{3,30}$/.test(bc))o.barcode=bc;else e.push('ברקוד לא תקין')}
  for(const k of['qty','wp','cost','pk','ct']){if(M[k]==null)continue;const v=cellN(g(k));if(v==null)continue;if(isNaN(v)||v<0||((k==='pk'||k==='ct')&&!Number.isInteger(v)))e.push(IMF.find(x=>x[0]===k)[1]+' לא תקין');else if(v||k==='wp'||k==='cost')o[k]=v}
  if(M.costx!=null){const v=cellN(g('costx'));if(v!=null){if(isNaN(v)||v<0)e.push('עלות לפני מע"מ לא תקינה');else if(o.cost==null)o.cost=incVat(v)}}/* אם יש גם כולל מע"מ – הוא גובר */
  if(M.note!=null){const v=String(g('note')).replace(/\s+/g,' ').trim();if(v.length>500)e.push('הערות: עד 500 תווים');else if(v)o.note=v}
  for(const k of['cat','sub']){const v=String(g(k)).trim();if(v)o[k]=v.slice(0,40)}if(o.sub&&!o.cat)e.push('תת־קטגוריה בלי קטגוריה');
  out.push({n:i+2,o,err:e.join(', ')})});return out}
ACT.oxImpGo=async el=>{const I=O.im;if(!I)return;const G=imRows().filter(r=>!r.err).map(r=>r.o);if(!G.length)return;if(hasBr()&&!I.br&&(G.some(o=>o.qty)||!mgr()))return toast('בחר סניף');el.disabled=true;
 let a=0,u=0,b=0;try{for(let k=0;k<G.length;k+=200){el.textContent='מייבא… '+Math.min(k+200,G.length)+'/'+G.length;const r=await fnCall('importProducts',{reqId:(I.req+'_'+(k/200)).slice(0,40),br:hasBr()?I.br:undefined,addQty:I.add,rows:G.slice(k,k+200)});a+=r.added||0;u+=r.updated||0;b+=(r.bad||[]).length}
  O.im=null;toast(`יובא: ${a} חדשים, ${u} עודכנו${b?', '+b+' נדחו':''}`);await load(true);rerender()}catch(e){el.disabled=false;el.textContent='נסה שוב';err(e)}};
window.__ox=O;window.__opSync=opSync;window.__brXfer=brXfer;
})();
