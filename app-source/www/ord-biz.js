/* ORD:BIZ – לקוח עסקי ומחירים (משימה 2026-11-14_הזמנות-לקוח-עסקי-וחשבוניות, שלב 1). קובץ עצמאי, נטען אחרי orders-staff.js, orders-cust.js ו-ar-calc.js.
   - הקמת לקוח עסקי ("+ לקוח עסקי"): כמה אנשי קשר, כמה כתובות (סניפי הלקוח), תנאי תשלום כמו בספקים (ברירת מחדל מיידי). ע.מ כפול – אזהרה ואפשר להמשיך.
     עריכה: תנאי תשלום, חסימה ומסגרת אשראי – מנהל בלבד (השרת אוכף).
   - זיהוי בהזמנה: טלפון של איש קשר (phx) מצטרף לחיפוש הטלפון הקיים; חיפוש לקוח עסקי לפי שם (גם חלקי ועם שגיאת כתיב), ע.מ, ת"ז או טלפון → רשימה לבחירה.
   - לקוח שנבחר: תווית "לקוח עסקי" (קיימת), מחירים נכנסים לבד – מחיר קבוע ← סיטונאי ← רגיל (עסקי בלי סיטונאי: רגיל ÷ (1+מע"מ)). רק שורות שהמחיר שלהן
     לא שונה ידנית (it.auto). בחירת כתובת מסניפי הלקוח → כתובת משלוח של ההזמנה. לקוח חסום – אזהרה (השרת חוסם עובד).
   - שינוי מחיר בשורה: מתחת למינימום – "אין אפשרות לתת במחיר הזה" והמחיר חוזר; בתוך המגבלה – "לשמור קבוע ללקוח?" (setCustPrice). מנהל עוקף.
   - הנחה כללית על ההזמנה – מנהל בלבד (disc נשלח עם createOrder). סיכום לפני מע"מ / מע"מ / לתשלום לפי סוג הלקוח.
   - מסך הגדרות מחיר (מנהל): אחוז מעל העלות לעסק ולקטגוריה, מגבלה נפרדת ללקוח פרטי, הנחה כללית מקסימלית, והתראות "המחירון השתנה ויש מחיר קבוע".
   - בכרטיס הלקוח: פרטים עסקיים, אנשי קשר, כתובות, תנאים, ומחירים קבועים (כולם רואים, מנהל עורך ומוחק).
   כל כתיבה – דרך השרת (customers.js / orders.js). המינימום נאכף בשרת; כאן רק הודעה מוקדמת. */
(function(){
'use strict';
if(typeof ACT==='undefined'||typeof V==='undefined'||!window.__ox||!window.ArCalc)return;
const O=window.__ox,AC=window.ArCalc;
const fnCall=(n,d)=>{d=d&&typeof d==='object'?d:{};if(SY&&SY.sa&&SY.bizId&&!('bizId'in d))d=Object.assign({bizId:SY.bizId},d);return window.fnCall(n,d)};
const on=()=>(isA()||isW()||!!(SY&&SY.sa))&&bzF('orders')&&wp('ord');
const mgr=()=>isA()||!!(SY&&SY.sa);
const dec=d=>Object.assign({id:idOf(d)},Object.fromEntries(Object.entries(d.fields||{}).map(([k,v])=>[k,fvj(v)])));
const err=e=>toast(e&&e.message||'הפעולה נכשלה');
const num=v=>{const x=+String(v==null?'':v).replace(',','.').replace(/[₪\s]/g,'');return String(v==null?'':v).trim()!==''&&isFinite(x)?x:NaN};
const rid=()=>{const a=new Uint8Array(12);crypto.getRandomValues(a);return 'r'+[...a].map(x=>x.toString(36).padStart(2,'0')).join('').slice(0,22)};
const sv=(v,t)=>t==='s'?{stringValue:v}:t==='b'?{booleanValue:v}:{stringValue:String(v)};
async function runQ(coll,f,lim){const sq={from:[{collectionId:coll}],limit:lim||500};if(f)sq.where={fieldFilter:{field:{fieldPath:f[0]},op:f[1],value:f[2]}};
 const r=await fsx(':runQuery',{method:'POST',body:JSON.stringify({structuredQuery:sq})});return(r||[]).filter(x=>x.document).map(x=>dec(x.document))}
async function get1(p){try{const d=await fsx(p);return d?dec(d):null}catch(e){if(e.code===404)return null;throw e}}
const B={L:null,at:0,busy:0,cfg:undefined,cp:{},c:{},wp:{},al:null,f:null};
const vatP=()=>{const v=O.cfg&&O.cfg.vat;return typeof v==='number'&&v>=0&&v<=100?v:AC.VAT0};
const prod=id=>(O.P||[]).find(p=>p.id===id);
const unitP=(p,br)=>{const v=p&&p.bp&&typeof p.bp==='object'?p.bp[br]:undefined;return typeof v==='number'?v:(+(p&&p.price)||0)};
const phN=v=>{let p=String(v==null?'':v).trim().replace(/[\s-]/g,'');if(/^\+?972\d{8,9}$/.test(p))p='0'+p.replace(/^\+?972/,'');if(/^5\d{8}$/.test(p))p='0'+p;return /^0(5\d{8}|7\d{8}|[23489]\d{7})$/.test(p)?p:''};
const WSTAG='<span class="tag t1">לקוח עסקי</span>',BLK='<span class="tag" style="color:var(--bad);border-color:var(--bad)">חסום</span>';
const TB=[['imm','מיידי'],['eom','שוטף+'],['inv','ימים מהחשבונית']];

/* ---------- טעינה ---------- */
async function bizL(force){if(B.busy||(!force&&B.L&&Date.now()-B.at<30000))return;B.busy=1;try{B.L=(await runQ('cust',['wholesale','EQUAL',sv(true,'b')],3000)).filter(c=>!c.mv);B.at=Date.now()}catch(e){B.L=B.L||[]}finally{B.busy=0}}
async function cfgL(force){if(B.cfg!==undefined&&!force)return B.cfg;try{B.cfg=await get1('/ordcfg/price')}catch(e){B.cfg=null}return B.cfg}
async function cpL(cid,force){if(!cid)return {};if(B.cp[cid]&&!force)return B.cp[cid];const m={};try{(await runQ('cprice',['cust','EQUAL',sv(cid,'s')],1000)).forEach(x=>{if(typeof x.p==='number')m[x.pid]=x})}catch(e){}B.cp[cid]=m;return m}
async function custL(id,force){if(!force&&B.c[id])return B.c[id];const c=await get1('/cust/'+id);if(c)B.c[id]=c;return c}
/* סיטונאי: מנהל – כל המחירים (בעמודים); עובד – רק מוצרי ההזמנה, ללקוח העסקי שמקושר לטיוטה (reqId), כמו "החל מחיר סיטונאי" */
async function wpL(D,pids){const need=pids.filter(p=>!(p in B.wp));if(!need.length)return;
 if(mgr()){if(B.wpAll)return;let a;for(let g=0;g<200;g++){const r=await fnCall('getWsPrices',a?{after:a}:{});Object.assign(B.wp,r&&r.wp||{});if(!r||!r.next)break;a=r.next}B.wpAll=1;need.forEach(p=>{if(!(p in B.wp))B.wp[p]=null});return}
 if(!D.custId||D.wholesale!==true)return;if(D.wsC&&D.wsC!==D.custId)D.req=rid();D.wsC=D.custId;
 const r=await fnCall('getWsPrices',{custId:D.custId,reqId:D.req,pids:need.slice(0,100)});Object.assign(B.wp,r&&r.wp||{});need.forEach(p=>{if(!(p in B.wp))B.wp[p]=null})}

/* ---------- חיפוש: נרמול עברית, חלק מהשם ושגיאת כתיב ---------- */
const FIN={'ך':'כ','ם':'מ','ן':'נ','ף':'פ','ץ':'צ'};
const nrm=s=>String(s==null?'':s).toLowerCase().replace(/[֑-ׇ]/g,'').replace(/[ךםןףץ]/g,c=>FIN[c]).replace(/["'`׳״\-.,()/\\]/g,' ').replace(/\s+/g,' ').trim();
function lev(a,b,mx){if(Math.abs(a.length-b.length)>mx)return mx+1;let p=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){const c=[i];let lo=i;for(let j=1;j<=b.length;j++){c[j]=Math.min(p[j]+1,c[j-1]+1,p[j-1]+(a[i-1]===b[j-1]?0:1));lo=Math.min(lo,c[j])}if(lo>mx)return mx+1;p=c}return p[b.length]}
const tolOf=n=>n<=3?0:n<=7?1:2;
// ציון למילת חיפוש מול מילה בשם: 3 = התחלה, 2 = מוכלת, 1 = שגיאת כתיב קטנה, 0 = לא
function wsc(q,w){if(w.startsWith(q))return 3;if(w.includes(q))return 2;const t=tolOf(q.length);if(!t)return 0;return lev(q,w.slice(0,Math.max(q.length,Math.min(w.length,q.length+t))),t)<=t||lev(q,w,t)<=t?1:0}
function nameScore(q,c){const Q=nrm(q).split(' ').filter(Boolean);if(!Q.length)return 0;const W=nrm([c.name,c.bn,c.ct].concat((c.cts||[]).map(x=>x&&x.n)).filter(Boolean).join(' ')).split(' ').filter(Boolean);
 let s=0;for(const x of Q){let b=0;for(const w of W){b=Math.max(b,wsc(x,w));if(b===3)break}if(!b)return 0;s+=b}return s}
const phAll=c=>[c.phone].concat(c.phs||[],c.phx||[],(c.cts||[]).map(x=>x&&x.ph)).filter(Boolean);
function bizFind(q){const L=B.L||[],d=String(q||'').replace(/\D/g,''),t=String(q||'').trim();if(t.length<2)return [];
 if(d&&d.length===String(t).replace(/[\s-]/g,'').length){if(d.length<3)return [];return L.filter(c=>phAll(c).some(p=>p.includes(d))||String(c.vat||'').startsWith(d)||String(c.tz||'').includes(d)).slice(0,8)}
 return L.map(c=>[c,nameScore(t,c)]).filter(x=>x[1]>0).sort((a,b)=>b[1]-a[1]).slice(0,8).map(x=>x[0])}

/* ---------- מחיר ברירת מחדל ללקוח ---------- */
const vmOf=D=>D&&D.custId&&D.wholesale===true?'ex':'inc';
function defOf(D,pid){const p=prod(pid),cp=D.custId&&B.cp[D.custId]&&B.cp[D.custId][pid];return AC.defPrice({cp:cp?cp.p:undefined,wp:typeof B.wp[pid]==='number'?B.wp[pid]:undefined,price:unitP(p,D.br),vm:vmOf(D),vat:vatP()})}
let applying=0;
async function bizApply(D){if(!D||D!==O.draft)return;const my=++applying;
 try{await cfgL();if(D.custId)await cpL(D.custId);const pids=[...new Set(D.items.filter(it=>it.pid).map(it=>it.pid))];if(vmOf(D)==='ex'&&pids.length)await wpL(D,pids).catch(err);
  if(my!==applying||D!==O.draft)return;let k=0;D.items.forEach(it=>{if(!it.pid||!it.auto||it.gk)return;const v=String(defOf(D,it.pid));if(v!==String(it.price)){it.price=v;k++}});
  if(window.__oxRedraw)window.__oxRedraw();sumPaint();if(k&&D.custId)toast(vmOf(D)==='ex'?'הוחלו מחירי לקוח עסקי (לפני מע"מ) על '+k+' שורות':'הוחלו מחירי הלקוח על '+k+' שורות')}catch(e){err(e)}}
{const f=window.__oxWsChg;window.__oxWsChg=(D,was)=>{if(f)f(D,was);if(D&&D===O.draft)setTimeout(()=>bizApply(D),0)}}
{const f=ACT.oxAdd;if(f)ACT.oxAdd=el=>{f(el);const D=O.draft;if(D&&(D.custId||B.cfg))bizApply(D)}}

/* ---------- הזמנה חדשה: חיפוש לקוח עסקי, פרטי הלקוח, הנחה וסיכום ---------- */
const hitH=c=>`<button type="button" class="li" data-a="obPick" data-id="${esc(c.id)}"><div class="m"><b>${esc(c.name||c.bn||'')}</b> ${c.wholesale===true?WSTAG:''}${c.blk?' '+BLK:''}<small>${[c.vat?'ע.מ '+c.vat:'',c.phone||''].filter(Boolean).map(esc).join(' · ')}</small></div></button>`;
const hitsH=q=>{const L=bizFind(q);return L.length?L.map(hitH).join(''):(String(q||'').trim().length>=2?'<p class="note">לא נמצא לקוח עסקי. אפשר להקים לקוח חדש.</p>':'')};
function infoH(D){const c=D.custId&&B.c[D.custId];if(!c)return '';const t=AC.termsOfCust(c),cp=B.cp[D.custId]||{},n=Object.keys(cp).length;
 const A=Array.isArray(c.addrs)?c.addrs:[];
 return `<div class="card" id="obinfo" style="margin:8px 0">${c.blk?`<p class="note" style="color:var(--bad);font-weight:700;margin-top:0">הלקוח חסום. ${mgr()?'מנהל יכול להמשיך.':'רק מנהל יכול לפתוח לו הזמנה.'}</p>`:''}
 ${c.wholesale===true?`<p class="note" style="margin-top:0">${WSTAG} המחירים בהזמנה <b>לפני מע"מ</b>. תנאי תשלום: <b>${esc(AC.termsTxt(t))}</b>${t.warn?' ('+esc(t.txt||'אחר')+')':''}${typeof c.lim==='number'?' · מסגרת אשראי '+ils(c.lim):''}</p>`:''}
 ${n?`<p class="note" style="margin:0">ללקוח ${n} מחירים קבועים – מוחלים לבד.</p>`:''}
 ${A.length?`<label class="f"><span>כתובת למשלוח (סניף הלקוח)</span><select data-c="obAddr"><option value="">כתובת הלקוח</option>${A.map(a=>`<option value="${esc(a.k)}"${D.obA===a.k?' selected':''}>${esc([a.nm,a.st,a.city].filter(Boolean).join(' – '))}</option>`).join('')}</select></label>`:''}</div>`}
function sumH(D){if(!D||!D.items.length)return '';const pk=window.__oxPk||((D,it)=>+it.qty||0);const tot=D.items.reduce((s,it)=>s+Math.round(pk(D,it)*(num(it.price)||0)*100),0)/100;
 const vm=vmOf(D),t=AC.totals(tot,vm,vatP(),D.disc);
 return `<div class="card" id="obsum" style="margin:8px 0">${t.dsc?`<div class="row" style="justify-content:space-between"><span>הנחה ${D.disc}%</span><bdi>-${ils(t.dsc)}</bdi></div>`:''}${vm==='ex'?`<div class="row" style="justify-content:space-between"><span>סה״כ לפני מע"מ</span><b>${ils(t.net)}</b></div><div class="row" style="justify-content:space-between"><span>מע"מ ${vatP()}%</span><b>${ils(t.vat)}</b></div>`:`<div class="row" style="justify-content:space-between"><span>מתוכם מע"מ ${vatP()}%</span><span>${ils(t.vat)}</span></div>`}<div class="row" style="justify-content:space-between"><b>לתשלום</b><b class="amt">${ils(t.gross)}</b></div></div>`}
function sumPaint(){const D=O.draft,e=document.getElementById('obsum');if(!D||!e)return;const h=sumH(D);if(h)e.outerHTML=h}
{const nw=V.oxNew;if(nw)V.oxNew=()=>{const r=nw();try{const D=O.draft;if(!r||!r.h||!on()||!D)return r;if(!B.L)bizL().then(()=>{if(cur().v==='oxNew'&&document.getElementById('obq')&&String(document.getElementById('obq').value).trim())INP.obQ(document.getElementById('obq'))});if(B.cfg===undefined)cfgL();
  if(D.custId&&!B.c[D.custId])custL(D.custId).then(c=>{if(c&&O.draft===D&&cur().v==='oxNew')rerender()}).catch(()=>{});
  const top=`<details${D.obq?' open':''}><summary class="note" style="min-height:44px;display:flex;align-items:center">חיפוש לקוח עסקי (שם, ע.מ, ת.ז או טלפון)</summary><label class="f"><span>שם העסק / איש קשר / ע.מ / טלפון</span><input data-i="obQ" id="obq" value="${esc(D.obq||'')}" autocomplete="off"></label><div id="obhits">${D.obq?hitsH(D.obq):''}</div><button type="button" class="btn g s w" data-a="obNew" data-v="ord">＋ לקוח עסקי חדש</button></details>`;
  let h=r.h.replace('<div class="card">','<div class="card">'+top);
  const inf=infoH(D);if(inf)h=h.replace('<div class="sec"><h3>מוצרים</h3>',inf+'<div class="sec"><h3>מוצרים</h3>');
  const dsc=mgr()?`<label class="f"><span>הנחה כללית על ההזמנה % (מנהל)</span><input data-i="obDisc" inputmode="decimal" value="${esc(D.disc||'')}" autocomplete="off"></label>`:'';
  h=h.replace('<button class="btn w" data-a="oxSave">',dsc+(D.items.length?sumH(D):'<div id="obsum"></div>')+'<button class="btn w" data-a="oxSave">');
  r.h=h}catch(e){}return r}}
INP.obQ=el=>{const D=O.draft;if(!D)return;D.obq=el.value;const x=document.getElementById('obhits');if(!B.L){bizL().then(()=>{if(document.getElementById('obhits'))document.getElementById('obhits').innerHTML=hitsH(D.obq)});return}
 if(x)x.innerHTML=hitsH(el.value);
 /* ע.מ / ת"ז / טלפון מלא – חיפוש מדויק גם בשרת (גם לקוח שאינו עסקי, ולקוח ישן) */
 const d=String(el.value).replace(/\D/g,'');if(d.length===9||d.length===10){const my=el.value;fnCall('findCust',{q:d}).then(async r=>{if(D.obq!==my)return;const L=(r&&r.list||[]).filter(c=>!(B.L||[]).some(x=>x.id===c.id));if(!L.length)return;const x2=document.getElementById('obhits');if(x2)x2.innerHTML=hitsH(my).replace('<p class="note">לא נמצא לקוח עסקי. אפשר להקים לקוח חדש.</p>','')+L.map(hitH).join('')}).catch(()=>{})}};
ACT.obPick=async el=>{const D=O.draft;if(!D)return;try{const c=(B.L||[]).find(x=>x.id===el.dataset.id)||await custL(el.dataset.id,1);if(!c)return toast('הלקוח לא נמצא');B.c[c.id]=c;D.cHits=[c];D.obq='';D.obA='';
 if(typeof ACT.ocPick==='function')ACT.ocPick({dataset:{id:c.id}});else rerender()}catch(e){err(e)}};
CHG.obAddr=el=>{const D=O.draft;if(!D)return;const c=B.c[D.custId],a=(c&&c.addrs||[]).find(x=>x.k===el.value);D.obA=el.value;if(a){D.ship={st:a.st||'',city:a.city||'',fl:'',apt:''};toast('כתובת המשלוח עודכנה')}else D.ship=null;rerender()};
INP.obDisc=el=>{const D=O.draft;if(!D)return;const v=num(el.value);D.disc=v>0&&v<=100?Math.round(v*100)/100:0;sumPaint()};
/* טלפון של איש קשר: אחרי החיפוש הקיים (טלפון / טלפון נוסף) – גם phx. נמצא לקוח נוסף → מצטרף לרשימת הבחירה */
const NEWB='<button type="button" class="btn g s w" data-a="ocAsNew">לקוח חדש עם אותו טלפון</button>';
{const f=INP.oxD;if(f)INP.oxD=el=>{f(el);const D=O.draft;if(!D||!on()||el.dataset.k!=='phone')return;const p=phN(D.phone);if(!p)return;const seq=D.phSeq;
 runQ('cust',['phx','ARRAY_CONTAINS',sv(p,'s')],10).then(async L=>{L=L.filter(c=>!c.mv);if(!L.length)return;for(let i=0;i<40&&D.cSt==='wait';i++)await new Promise(r=>setTimeout(r,150));
  if(O.draft!==D||D.custId||D.phSeq!==seq||phN(D.phone)!==p)return;const H=(D.cHits||[]).slice(),add=L.filter(c=>!H.some(x=>x.id===c.id));if(!add.length)return;D.cHits=H.concat(add);D.cSt='hits';
  const s=document.getElementById('ocst');if(s)s.outerHTML=`<div role="status" id="ocst"><p class="note">לטלפון הזה כבר יש ${D.cHits.length>1?D.cHits.length+' לקוחות':'לקוח'} (גם לפי איש קשר). בחרו:</p>${D.cHits.map(c=>`<button type="button" class="li" data-a="ocPick" data-id="${esc(c.id)}"><div class="m"><b>${esc(c.name||c.bn||'')}</b>${c.wholesale===true?' '+WSTAG:''}${c.blk?' '+BLK:''}<small>${esc(c.addr||'')}</small></div></button>`).join('')}${NEWB}</div>`}).catch(()=>{})}}
{const f=ACT.ocPick;if(f)ACT.ocPick=el=>{const D=O.draft,c=D&&(D.cHits||[]).find(x=>x.id===el.dataset.id);if(c)B.c[c.id]=c;f(el);if(D&&D===O.draft)setTimeout(()=>bizApply(D),0)}}
/* מחיר בשורה: מינימום (הודעה מוקדמת – השרת אוכף), ושאלה "לשמור קבוע ללקוח?" (22, 23) */
document.addEventListener('change',e=>{const el=e.target;if(!el||!el.isConnected||!el.matches||!el.matches('input[data-i="oxLn"][data-k="price"]')||!on())return;const D=O.draft;if(!D)return;const it=D.items[+el.dataset.n];if(!it||!it.pid||it.gk)return;
 const p=prod(it.pid),price=num(el.value);if(!(price>=0))return;const def=defOf(D,it.pid),vm=vmOf(D);
 if(!mgr()&&B.cfg){const c=O.cost&&typeof O.cost[it.pid]==='number'?O.cost[it.pid]:null,r=AC.priceOk({price,def,cost:c,vm,vat:vatP(),pct:AC.pctFor(B.cfg,vm==='ex',p&&p.cat,p&&p.sub)});
  if(!r.ok){toast('אין אפשרות לתת במחיר הזה'+(r.why==='below-cost'?' – מתחת לעלות':r.min!=null?' (מינימום '+ils(r.min)+')':''));it.price=String(def);it.auto=1;if(window.__oxRedraw)window.__oxRedraw();sumPaint();return}}
 sumPaint();if(!D.custId||AC.ag(price)===AC.ag(def))return;const has=B.cp[D.custId]&&B.cp[D.custId][it.pid];if(has&&!mgr())return toast('ללקוח יש מחיר קבוע למוצר הזה – רק מנהל משנה אותו');
 const nm=(p&&p.name)||'';ask(`לשמור את המחיר ${ils(price)}${vm==='ex'?' (לפני מע"מ)':''} ל"${nm}" באופן קבוע ללקוח הזה?`,async()=>{try{await fnCall('setCustPrice',{custId:D.custId,pid:it.pid,p:Math.round(price*100)/100});await cpL(D.custId,1);toast('נשמר מחיר קבוע ללקוח')}catch(x){err(x)}},'כן, שמור קבוע')},true);
document.addEventListener('input',e=>{const el=e.target;if(el&&el.matches&&el.matches('input[data-i="oxLn"]')&&document.getElementById('obsum'))sumPaint()},true);
/* הנחה כללית – נשלחת עם createOrder של הטיוטה (מנהל בלבד; השרת אוכף ומחשב) */
{const f=window.fnCall;if(typeof f==='function')window.fnCall=function(n,d){const D=O.draft;if(n==='createOrder'&&D&&d&&d.reqId===D.req&&D.disc>0&&mgr()&&d.disc===undefined)d=Object.assign({},d,{disc:D.disc});return f.apply(this,[n,d].concat([].slice.call(arguments,2)))}}
/* כרטיס הזמנה: סכומים לפי סוג הלקוח (הזמנה עם vm) */
{const f=V.oxOrd;if(f)V.oxOrd=id=>{const r=f(id);try{const o=(O.L||[]).find(x=>x.id===id);if(r&&r.h&&o&&(o.vm==='ex'||o.vm==='inc')&&typeof o.gross==='number'){
 const h=`<div class="card" style="margin:8px 0">${o.disc?`<div class="row" style="justify-content:space-between"><span>הנחה כללית</span><span>${o.disc}%</span></div>`:''}${o.vm==='ex'?`<div class="row" style="justify-content:space-between"><span>${WSTAG} לפני מע"מ</span><b>${ils(o.net)}</b></div><div class="row" style="justify-content:space-between"><span>מע"מ ${o.vr}%</span><b>${ils(o.vat)}</b></div>`:`<div class="row" style="justify-content:space-between"><span>מתוכם מע"מ ${o.vr}%</span><span>${ils(o.vat)}</span></div>`}<div class="row" style="justify-content:space-between"><b>לתשלום</b><b class="amt">${ils(o.gross)}</b></div></div>`;
 const i=r.h.indexOf('<div class="row"');r.h=i>=0?r.h.slice(0,i)+h+r.h.slice(i):r.h+h}}catch(e){}return r}}

/* ---------- הקמה / עריכה של לקוח עסקי ---------- */
const FLD=[['bn','שם העסק / המוסד','maxlength="60"'],['vat','ע.מ / ח.פ','inputmode="numeric" maxlength="11"'],['phone','טלפון ראשי','inputmode="tel" dir="ltr"'],['ct','איש קשר ראשי','maxlength="60"'],['mail','מייל','type="email" dir="ltr"'],['st','רחוב ומספר','maxlength="80"'],['city','עיר','maxlength="40"']];
function fNew(c,from){const t=c?AC.termsOfCust(c):{b:'imm',d:0};return {id:c?c.id:'',from:from||'',v:Object.fromEntries(FLD.map(([k])=>[k,String(c&&c[k]||'')])),cts:(c&&Array.isArray(c.cts)?c.cts:[]).map(x=>Object.assign({n:'',ph:'',mail:''},x)),
 addrs:(c&&Array.isArray(c.addrs)?c.addrs:[]).map(x=>Object.assign({nm:'',st:'',city:''},x)),tb:t.b,td:t.b==='imm'?'':String(t.d),blk:!!(c&&c.blk),lim:c&&typeof c.lim==='number'?String(c.lim):'',hadT:!!(c&&c.terms)}}
ACT.obNew=el=>{B.f=fNew(null,el&&el.dataset.v);const D=O.draft;if(D&&B.f.from==='ord'){if(D.phone)B.f.v.phone=D.phone;if(D.obq&&!/\d{5}/.test(D.obq))B.f.v.bn=D.obq}go('obNew')};
ACT.obEdit=async el=>{try{const c=await custL(el.dataset.id,1);if(!c)return toast('הלקוח לא נמצא');B.f=fNew(c);go('obNew')}catch(e){err(e)}};
const rowsH=(g,L,F)=>L.map((x,i)=>`<div class="card" style="margin:6px 0"><div class="row">${F.map(([k,l,a])=>`<label class="f grow"><span>${l}</span><input data-i="obF" data-g="${g}" data-n="${i}" data-k="${k}" value="${esc(x[k]||'')}" ${a||''}></label>`).join('')}</div><button type="button" class="btn g s" data-a="obRowX" data-g="${g}" data-n="${i}">הסר</button></div>`).join('');
V.obNew=()=>{const F=B.f,T=F&&F.id?'עריכת לקוח עסקי':'לקוח עסקי חדש';if(!on())return{t:T,h:'<div class="empty">אין לך הרשאה להזמנות</div>'};if(!F)return{t:T,h:'<div class="empty">אין טופס פתוח</div>'};
 const M=mgr(),tEd=!F.id||M,ro=k=>F.id&&k==='phone'&&/^p/.test(F.id)?' readonly':'';
 return{t:T,s:F.id?'':'הלקוח יזוהה בהזמנות לפי כל טלפון, ע.מ או שם',h:`<div class="card">${FLD.map(([k,l,a])=>`<label class="f"><span>${l}${['bn','vat','phone','st','city'].includes(k)?' *':''}</span><input data-i="obF" data-k="${k}" value="${esc(F.v[k])}" ${a}${ro(k)} autocomplete="off"></label>`).join('')}</div>
 <div class="sec"><h3>אנשי קשר</h3></div><p class="note">כל טלפון של איש קשר מזהה את הלקוח בהזמנה.</p>${rowsH('cts',F.cts,[['n','שם','maxlength="60"'],['ph','טלפון','inputmode="tel" dir="ltr"'],['mail','מייל','type="email" dir="ltr"']])}<button type="button" class="btn g s w" data-a="obRowAdd" data-g="cts">＋ איש קשר</button>
 <div class="sec"><h3>כתובות / סניפים של הלקוח</h3></div><p class="note">בכל הזמנה בוחרים לאיזו כתובת.</p>${rowsH('addrs',F.addrs,[['nm','שם הסניף','maxlength="40"'],['st','רחוב ומספר','maxlength="80"'],['city','עיר','maxlength="40"']])}<button type="button" class="btn g s w" data-a="obRowAdd" data-g="addrs">＋ כתובת</button>
 <div class="sec"><h3>תנאי תשלום</h3></div><div class="card">${tEd?`<div class="row"><label class="f grow"><span>תנאי תשלום</span><select data-c="obTb">${TB.map(([k,l])=>`<option value="${k}"${F.tb===k?' selected':''}>${l}</option>`).join('')}</select></label>${F.tb==='imm'?'':`<label class="f grow"><span>ימים</span><input data-i="obF" data-k="td" inputmode="numeric" value="${esc(F.td)}" placeholder="${F.tb==='eom'?'30 / 60 / 90':'למשל 45'}"></label>`}</div>${F.id?'':'<p class="note" style="margin:0">אחרי ההקמה – רק מנהל משנה.</p>'}`:`<p class="note" style="margin:0">${esc(AC.termsTxt({b:F.tb,d:+F.td||0}))} · שינוי – מנהל בלבד</p>`}
 ${M?`<label class="f"><span>מסגרת אשראי ₪ (רשות)</span><input data-i="obF" data-k="lim" inputmode="decimal" value="${esc(F.lim)}"></label><label class="row" style="align-items:center;gap:8px;min-height:44px"><input type="checkbox" data-c="obBlk"${F.blk?' checked':''}> לקוח חסום – עובד לא יכול לפתוח לו הזמנה</label>`:''}</div>
 <button class="btn w" data-a="obSave">${F.id?'שמור':'הקם לקוח עסקי'}</button>`}};
INP.obF=el=>{const F=B.f;if(!F)return;const g=el.dataset.g;if(g)F[g][+el.dataset.n][el.dataset.k]=el.value;else if(el.dataset.k==='td'||el.dataset.k==='lim')F[el.dataset.k]=el.value;else F.v[el.dataset.k]=el.value};
ACT.obRowAdd=el=>{const F=B.f;if(!F)return;const g=el.dataset.g;if(F[g].length>=(g==='cts'?10:20))return toast('הגעתם למקסימום');F[g].push(g==='cts'?{n:'',ph:'',mail:''}:{nm:'',st:'',city:''});rerender()};
ACT.obRowX=el=>{const F=B.f;if(!F)return;F[el.dataset.g].splice(+el.dataset.n,1);rerender()};
CHG.obTb=el=>{const F=B.f;if(!F)return;F.tb=el.value;if(F.tb==='imm')F.td='';rerender()};
CHG.obBlk=el=>{if(B.f)B.f.blk=el.checked};
function fOut(F){const v=F.v,t=k=>String(v[k]||'').trim(),c={};
 if(!t('bn'))throw new Error('חסר שם העסק');const vat=t('vat').replace(/[\s-]/g,'');if(!/^\d{9}$/.test(vat))throw new Error('ע.מ / ח.פ: 9 ספרות');
 if(!F.id||!/^p/.test(F.id)){if(!phN(t('phone')))throw new Error('טלפון ראשי לא תקין');c.phone=t('phone')}
 if(!t('st')||!t('city'))throw new Error('חסרים רחוב ועיר');
 const cts=F.cts.map(x=>({n:String(x.n||'').trim(),ph:String(x.ph||'').trim(),mail:String(x.mail||'').trim()})).filter(x=>x.n||x.ph||x.mail);
 for(const x of cts)if(x.ph&&!phN(x.ph))throw new Error('טלפון של איש קשר לא תקין: '+x.ph);
 const ct=t('ct')||(cts[0]&&cts[0].n)||'';if(!ct)throw new Error('חסר איש קשר');
 const addrs=F.addrs.map(x=>Object.assign({},x.k?{k:x.k}:{},{nm:String(x.nm||'').trim(),st:String(x.st||'').trim(),city:String(x.city||'').trim()})).filter(x=>x.nm||x.st||x.city);
 for(const a of addrs)if(!a.st)throw new Error('כתובת בלי רחוב: '+(a.nm||a.city));
 Object.assign(c,{bn:t('bn'),name:t('bn'),vat,ct,st:t('st'),city:t('city'),cts:cts.map(x=>Object.fromEntries(Object.entries(x).filter(([,y])=>y))),addrs:addrs.map(x=>Object.fromEntries(Object.entries(x).filter(([,y])=>y)))});
 if(t('mail'))c.mail=t('mail');
 if(!F.id||mgr()){const d=F.tb==='imm'?0:parseInt(F.td,10);if(F.tb!=='imm'&&!(d>=0&&d<=365))throw new Error('תנאי תשלום: מספר ימים 0–365');const nt={b:F.tb,d};
  if(!F.id||mgr())c.terms=nt}
 if(mgr()&&F.id){c.blk=!!F.blk;const l=String(F.lim||'').trim();c.lim=l?num(l):null;if(l&&!(c.lim>=0))throw new Error('מסגרת אשראי לא תקינה')}else if(mgr()&&!F.id){if(F.blk)c.blk=true;const l=String(F.lim||'').trim();if(l){c.lim=num(l);if(!(c.lim>=0))throw new Error('מסגרת אשראי לא תקינה')}}
 return c}
ACT.obSave=async el=>{const F=B.f;if(!F)return;let c;try{c=fOut(F)}catch(e){return toast(e.message)}
 const go2=async()=>{el.disabled=true;try{const r=await fnCall('saveCust',F.id?{id:F.id,cust:c}:{cust:c,wholesale:true});const id=r&&r.id||F.id;toast(F.id?'נשמר':'הלקוח העסקי נשמר');
  const cc=await custL(id,1).catch(()=>null);await bizL(true);B.f=null;NAV.pop();
  const D=O.draft;if(F.from==='ord'&&D&&cc){B.c[cc.id]=cc;D.cHits=[cc];if(typeof ACT.ocPick==='function')ACT.ocPick({dataset:{id:cc.id}});else rerender()}else rerender()}catch(e){el.disabled=false;err(e)}};
 await bizL();const dup=(B.L||[]).filter(x=>x.vat===c.vat&&x.id!==F.id);if(dup.length)return ask(`כבר קיים לקוח עם ע.מ ${c.vat} (${dup.map(x=>x.name||x.bn).join(', ')}). להמשיך בכל זאת?`,go2,'כן, המשך');go2()};

/* ---------- כרטיס לקוח: פרטים עסקיים ומחירים קבועים ---------- */
{const f=V.ocCard;if(f)V.ocCard=id=>{const r=f(id);try{if(!r||!r.h||!on())return r;const c=B.c[id];
 if(!c||!B.cp[id]){Promise.all([custL(id,!c),cpL(id,1)]).then(()=>{if(cur().v==='ocCard'&&cur().a===id&&!document.querySelector('#dlg[open]'))rerender()}).catch(()=>{});return r}
 const cp=Object.values(B.cp[id]||{}),biz=c.wholesale===true||c.cts||c.addrs||c.terms;if(!biz&&!cp.length)return r;const t=AC.termsOfCust(c);
 const row=(l,v)=>v?`<div class="note" style="padding:4px 0">${l}: <b>${v}</b></div>`:'';
 const h=`<div class="card" id="obcard" style="margin:8px 0"><div class="row" style="justify-content:space-between;align-items:center"><b>לקוח עסקי ${c.blk?BLK:''}</b>${c.wholesale===true?`<button class="btn g s" data-a="obEdit" data-id="${esc(id)}">עריכה</button>`:''}</div>
 ${c.wholesale===true?row('תנאי תשלום',esc(AC.termsTxt(t))+(t.warn?' ('+esc(t.txt||'אחר')+')':''))+row('מסגרת אשראי',typeof c.lim==='number'?ils(c.lim):''):''}
 ${(c.cts||[]).length?'<div class="note" style="margin-top:6px">אנשי קשר:</div>'+c.cts.map(x=>`<div class="note">• ${esc(x.n||'')} ${x.ph?`<a href="tel:${esc(x.ph)}" dir="ltr">${esc(x.ph)}</a>`:''} ${x.mail?esc(x.mail):''}</div>`).join(''):''}
 ${(c.addrs||[]).length?'<div class="note" style="margin-top:6px">כתובות:</div>'+c.addrs.map(a=>`<div class="note">• ${esc([a.nm,a.st,a.city].filter(Boolean).join(' – '))}</div>`).join(''):''}
 <div class="note" style="margin-top:8px;font-weight:700">מחירים קבועים${c.wholesale===true?' (לפני מע"מ)':''}</div>${cp.length?cp.sort((a,b)=>String(a.n).localeCompare(String(b.n),'he')).map(x=>`<div class="li" style="cursor:default"><div class="m"><b>${esc(x.n||(prod(x.pid)||{}).name||x.pid)}</b><small>${(x.h||[]).length?'עודכן '+new Date(x.at).toLocaleDateString('he-IL'):''}</small></div><b class="a">${ils(x.p)}</b>${mgr()?`<button class="btn g s" data-a="obCpEd" data-c="${esc(id)}" data-p="${esc(x.pid)}">שנה</button><button class="btn g s" data-a="obCpDel" data-c="${esc(id)}" data-p="${esc(x.pid)}">מחק</button>`:''}</div>`).join(''):'<p class="note">אין מחירים קבועים. נקבעים מתוך הזמנה, כששואלים "לשמור קבוע ללקוח?".</p>'}</div>`;
 const i=r.h.indexOf('<div class="ocH">');r.h=i>=0?r.h.slice(0,i)+h+r.h.slice(i):h+r.h}catch(e){}return r}}
ACT.obCpEd=el=>{const c=el.dataset.c,p=el.dataset.p,x=(B.cp[c]||{})[p];dlg(`<h3>מחיר קבוע – ${esc(x&&x.n||'')}</h3><form data-f="obCpF"><input type="hidden" name="c" value="${esc(c)}"><input type="hidden" name="p" value="${esc(p)}"><label class="f"><span>מחיר ₪</span><input name="v" inputmode="decimal" value="${esc(x?x.p:'')}" required></label><div class="row"><button class="btn grow">שמור</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`)};
FRM.obCpF=async f=>{const x=fd(f),v=num(x.v);if(!(v>=0))return toast('מחיר לא תקין');const b=f.querySelector('button');b.disabled=true;try{await fnCall('setCustPrice',{custId:x.c,pid:x.p,p:Math.round(v*100)/100});await cpL(x.c,1);closeDlg();toast('נשמר');rerender()}catch(e){b.disabled=false;err(e)}};
ACT.obCpDel=el=>{const c=el.dataset.c,p=el.dataset.p;ask('למחוק את המחיר הקבוע? ההזמנות הבאות יקבלו את המחיר הרגיל של הלקוח.',async()=>{try{await fnCall('delCustPrice',{custId:c,pid:p});await cpL(c,1);toast('נמחק');rerender()}catch(e){err(e)}},'מחק')};
{const f=V.ocList;if(f)V.ocList=()=>{const r=f();try{if(r&&r.h&&on()){const b=`<div class="row" style="margin-bottom:8px"><button class="btn g grow" data-a="obNew">＋ לקוח עסקי</button>${mgr()?'<button class="btn g grow" data-a="go" data-v="obCfg">מחירים ללקוח עסקי</button>':''}</div>`;const i=r.h.indexOf('<div class="card" id="ocCount"');r.h=i>=0?r.h.slice(0,i)+b+r.h.slice(i):b+r.h}}catch(e){}return r}}

/* ---------- הגדרות מחיר (מנהל) + התראות מחירון ---------- */
const pctV=v=>typeof v==='number'?String(v):'';
V.obCfg=()=>{const T='מחירים ללקוח עסקי';if(!on()||!mgr())return{t:T,h:'<div class="empty">למנהל בלבד</div>'};
 if(B.cfg===undefined||B.al===null){Promise.all([cfgL(true),runQ('aralert',null,200).then(L=>{B.al=L.filter(x=>x.st!=='done').sort((a,b)=>(b.at||0)-(a.at||0))}).catch(()=>{B.al=[]})]).then(()=>{if(cur().v==='obCfg')rerender()});if(B.al===null)B.al=undefined;return{t:T,h:'<p class="note">טוען…</p>'}}
 const c=B.cfg||{},cats=(O.C||[]);
 return{t:T,s:B.cfg?'המגבלה פעילה':'המגבלה כבויה – אין מינימום',h:`<form class="card" data-f="obCfgF"><p class="note" style="margin-top:0">המחיר המינימלי = עלות המוצר × (1 + האחוז). מתחת לזה העובד מקבל "אין אפשרות לתת במחיר הזה". מתחת לעלות – חסום תמיד לעובד. מנהל יכול לעקוף. מוצר בלי עלות – העובד לא מוריד מתחת למחיר הרגיל.</p>
 <label class="f"><span>אחוז מעל העלות – לקוח עסקי (לכל העסק)</span><input name="pct" inputmode="decimal" value="${esc(pctV(c.pct))}" placeholder="למשל 15"></label>
 <label class="f"><span>אחוז מעל העלות – לקוח פרטי (ריק = כמו עסקי)</span><input name="pp" inputmode="decimal" value="${esc(pctV(c.pp))}"></label>
 <label class="f"><span>הנחה כללית מקסימלית על הזמנה % (מנהל)</span><input name="disc" inputmode="decimal" value="${esc(pctV(c.disc))}"></label>
 ${cats.length?`<details><summary class="note" style="min-height:44px;display:flex;align-items:center">אחוז שונה לקטגוריה (ריק = כמו העסק)</summary>${cats.map(x=>`<label class="f"><span>${x.parent?'– ':''}${esc(x.name)}</span><input name="cat_${esc(x.id)}" inputmode="decimal" value="${esc(pctV(c.cat&&c.cat[x.id]))}"></label>`).join('')}</details>`:''}
 <button class="btn w">שמור והפעל</button></form>${B.cfg?'<button class="btn g s w" data-a="obCfgOff">כיבוי המגבלה (ההגדרות נשמרות)</button>':''}
 <div class="sec"><h3>התראות: המחירון השתנה ויש מחיר קבוע</h3></div>${(B.al||[]).length?B.al.map(a=>`<div class="card" style="margin:6px 0"><b>${esc(a.n||a.pid)}</b><p class="note" style="margin:4px 0">${a.from&&a.to?`סיטונאי: ${a.from.wp!=null?ils(a.from.wp):'—'} ← ${a.to.wp!=null?ils(a.to.wp):'—'} · רגיל: ${a.from.price!=null?ils(a.from.price):'—'} ← ${a.to.price!=null?ils(a.to.price):'—'}`:''}<br>${a.cnt||0} לקוחות עם מחיר קבוע למוצר. המחיר הקבוע לא השתנה.</p>
  <div class="row" style="flex-wrap:wrap">${(a.custs||[]).map(id=>`<button class="btn g s" data-a="go" data-v="ocCard" data-arg="${esc(id)}">${esc(((B.L||[]).find(x=>x.id===id)||{}).name||'לקוח')}</button>`).join('')}</div>
  <p class="note" style="margin:4px 0">שליחת הודעה ללקוח על השינוי – תיפתח בשלב "אישור הזמנה ושליחה".</p><button class="btn g s w" data-a="obAlOk" data-id="${esc(a.id)}">טופל</button></div>`).join(''):'<p class="note">אין התראות פתוחות.</p>'}`}};
FRM.obCfgF=async f=>{const x=fd(f),o={},cat={};const pv=(v,l)=>{const s=String(v||'').trim();if(!s)return null;const n=num(s);if(!(n>=0&&n<=1000))throw new Error(l+': אחוז לא תקין');return Math.round(n*100)/100};
 try{o.pct=pv(x.pct,'עסקי');o.pp=pv(x.pp,'פרטי');o.disc=pv(x.disc,'הנחה');if(o.disc!=null&&o.disc>100)throw new Error('הנחה: עד 100%');for(const [k,v] of Object.entries(x))if(k.startsWith('cat_')){const n=pv(v,'קטגוריה');if(n!=null)cat[k.slice(4)]=n}o.cat=cat}catch(e){return toast(e.message)}
 const b=f.querySelector('button');b.disabled=true;try{await fnCall('setPriceCfg',o);await cfgL(true);toast('נשמר – המגבלה פעילה');rerender()}catch(e){err(e)}finally{b.disabled=false}};
ACT.obCfgOff=()=>ask('לכבות את מגבלת המחיר? העובדים יוכלו לשנות מחיר בלי מינימום. ההגדרות נשמרות.',async()=>{try{await fnCall('setPriceCfg',{off:true});await cfgL(true);toast('המגבלה כובתה');rerender()}catch(e){err(e)}},'כבה');
ACT.obAlOk=async el=>{el.disabled=true;try{await fnCall('ackPriceAlert',{id:el.dataset.id});B.al=(B.al||[]).filter(x=>x.id!==el.dataset.id);rerender()}catch(e){el.disabled=false;err(e)}};
{const f=V.oxCfg;if(f)V.oxCfg=()=>{const r=f();try{if(r&&r.h&&on()&&mgr())r.h+='<button class="btn g w" style="margin-top:10px" data-a="go" data-v="obCfg">מחירים ללקוח עסקי ומגבלת מחיר</button>'}catch(e){}return r}}
window.__obBiz={B,bizFind,defOf,nameScore};
})();
