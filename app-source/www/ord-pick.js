/* ORD:PICK – מסך טיפול/ליקוט (משימה 2026-11-14_הזמנות-לקוח-עסקי-וחשבוניות, משוב בעל הפרויקט סעיף 6, החלטות 19–20). קובץ עצמאי, נטען אחרי orders-staff.js, ord-biz.js ו-prod-match.js.
   - לחיצה על "בטיפול" (וגם "טיפול בהזמנה" בכרטיס של הזמנה בטיפול) פותחת את V.oxPick: כל מוצרי ההזמנה, לכל מוצר "יש במלאי" / "אין במלאי", וכפתור "הכול במלאי" – לכל ההזמנות.
   - "אין" ← 3 אפשרויות: (1) להוריד מההזמנה – הסכום יורד; (2) מוצר דומה – "יש לעדכן את הלקוח" + חיפוש מוצר חלופי שמחליף את השורה (המחיר לפי כללי המחיר בשרת);
     (3) להזמין מספק – ספק מוצע מהמוצר (prod.sup) עם אפשרות שינוי, אחרת מקלידים; כמות; תאריך צפי (רשות). נכנס לרשימה הפנימית "להזמין מספקים" – לא נשלח לספק ולא משנה מלאי.
   - "סיום וסיכום": orderPick (סימונים) ← updateOrder הקיים (רק כשיש הורדה/החלפה) ← מסך סיכום: כל השינויים במוצרים ובמחירים (לפני/אחרי), הוראה לחייג ללקוח, "הלקוח אישר את השינויים".
     עד האישור השרת לא מאפשר "נשלח" / "ממתין לתשלום" / "יצא" / "הושלם" (מנהל יכול לעקוף – כאן שואלים אותו קודם). הזמנה בלי שינויים – לא נחסמת. הזמנה ישנה בלי pk – כמו קודם.
   - V.oxSup: "להזמין מספקים", מקובץ לפי ספק, עם "הוזמן" / "הגיע" / "לא צריך".
   - 15.11.2026 (החלטה 32): בסיכום (בלי שינויים ממתינים) – מסגרת / "חויב" של חיוב אחרי ליקוט (window.__oxAuthH מ-orders-staff.js).
   כל כתיבה – דרך השרת (functions/ord-pick.js, orders.js). */
(function(){
'use strict';
if(typeof ACT==='undefined'||typeof V==='undefined'||!window.__ox)return;
const O=window.__ox;
const fnCall=(n,d)=>{d=d&&typeof d==='object'?d:{};if(SY&&SY.sa&&SY.bizId&&!('bizId'in d))d=Object.assign({bizId:SY.bizId},d);return window.fnCall(n,d)};
const on=()=>(isA()||isW()||!!(SY&&SY.sa))&&bzF('orders')&&wp('ord');
const mgr=()=>isA()||!!(SY&&SY.sa);
const NB='_';
const err=e=>toast(e&&e.message||'הפעולה נכשלה');
const num=v=>{const x=+String(v==null?'':v).replace(',','.');return String(v==null?'':v).trim()!==''&&isFinite(x)?x:NaN};
const n3=x=>Math.round(x*1000)/1000;
const ag=x=>Math.round(x*100);
const rid=()=>{const a=new Uint8Array(12);crypto.getRandomValues(a);return 'r'+[...a].map(x=>x.toString(36).padStart(2,'0')).join('').slice(0,22)};
const dec=d=>Object.assign({id:idOf(d)},Object.fromEntries(Object.entries(d.fields||{}).map(([k,v])=>[k,fvj(v)])));
const prod=id=>(O.P||[]).find(p=>p.id===id);
const ordOf=id=>(O.L||[]).find(o=>o.id===id);
const brs=()=>brAll().filter(b=>b.on);
const hasBr=()=>brs().length>0;
const q=(p,br)=>{const v=p&&p.q&&typeof p.q==='object'?p.q[br]:0;return typeof v==='number'?v:0};
const unitP=(p,br)=>{const v=p&&p.bp&&typeof p.bp==='object'?p.bp[br]:undefined;return typeof v==='number'?v:(+(p&&p.price)||0)};
const amtOf=o=>o&&(o.vm==='ex'||o.vm==='inc')&&typeof o.gross==='number'?o.gross:(o&&o.total||0);
const lineT=it=>Math.round((+it.qty||0)*(+it.price||0)*100)/100;
const dmy=s=>{const m=/^(\d{4})-(\d\d)-(\d\d)$/.exec(String(s||''));return m?`${+m[3]}.${+m[2]}.${m[1]}`:''};
const tm=t=>{if(!t)return '';const d=new Date(t);return d.toLocaleDateString('he-IL',{day:'numeric',month:'numeric'})+' '+d.toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'})};
const after=async id=>{if(window.__oxAfter)await window.__oxAfter(id)};
const OPEN=['new','work','wait_pay'];
const canPick=o=>!!(o&&OPEN.includes(o.status)&&!o.shp&&(o.items||[]).length);
const back=()=>{if(cur().v==='oxPick'){NAV.pop();render(0)}};
// מחיר משוער למוצר החלופי (להצגה בלבד – המחיר הסופי נקבע בשרת לפי כללי המחיר: מחיר קבוע ← סיטונאי ← רגיל)
const estP=(o,pid)=>{try{const b=window.__obBiz;if(b&&b.defOf)return b.defOf({custId:o.custId||'',br:o.br,wholesale:o.vm==='ex'},pid)}catch(e){}return unitP(prod(pid),o.br)};

/* ---------- מצב הליקוט (בזיכרון, עד הסיום) ---------- */
const PS={};
function sess(o){let s=PS[o.id];if(!s||(!s.sent&&s.l.length!==o.items.length)){s=PS[o.id]={rq:rid(),upd:o.upd,sent:0,err:'',it:o.items.map(x=>Object.assign({},x)),l:o.items.map(()=>({ok:null,act:'',pid:'',q:'',sup:'',qty:'',eta:''}))}}return s}
const supOf=it=>{const p=it&&it.pid?prod(it.pid):null;return p&&typeof p.sup==='string'?p.sup:''};

/* ---------- חיפוש מוצר חלופי (החיפוש החכם הקיים – ProdMatch) ---------- */
const IX={src:null,idx:null};
const ix=()=>{if(!window.ProdMatch)return null;if(IX.src!==O.P){IX.src=O.P;IX.idx=ProdMatch.index((O.P||[]).filter(p=>p.on!==false))}return IX.idx};
function hits(o,i,t){t=String(t||'').trim();if(!t)return[];const not=o.items[i]&&o.items[i].pid;const I=ix();
 const R=I?ProdMatch.search(I,t,{limit:7}).map(r=>r.p):(O.P||[]).filter(p=>p.on!==false&&String(p.name).includes(t)).slice(0,7);return R.filter(p=>p&&p.id!==not).slice(0,6)}
const hitsH=(o,i,t)=>{const H=hits(o,i,t);return H.length?H.map(p=>`<button type="button" class="li" data-a="oxPkRep" data-id="${esc(o.id)}" data-n="${i}" data-p="${esc(p.id)}"><div class="m"><b>${esc(p.name)}</b><small>במלאי${hasBr()&&o.br!==NB?' ב'+esc(brNm(o.br)):''}: ${n3(q(p,o.br))}</small></div><b class="a">${ils(estP(o,p.id))}</b></button>`).join(''):(String(t||'').trim()?'<p class="note">לא נמצא מוצר.</p>':'')};

/* ---------- מסך הליקוט ---------- */
const chip=(on,a,o,i,k,t)=>`<button type="button" class="chip${on?' on':''}" data-a="${a}" data-id="${esc(o.id)}" data-n="${i}"${k?` data-k="${k}"`:''} aria-pressed="${!!on}">${t}</button>`;
function lineH(o,s,i){const it=s.it[i],x=s.l[i],p=it.pid?prod(it.pid):null;
 let h=`<div class="card" style="margin:8px 0${x.ok===false?';border-color:var(--acc)':''}"><div class="row" style="justify-content:space-between;gap:8px;align-items:flex-start"><b style="flex:1;min-width:0;overflow-wrap:anywhere">${esc(it.n)}</b><b class="a">${ils(lineT(it))}</b></div>
 <small class="note">${n3(it.qty)} × ${ils(it.price)}${p?` · במלאי${hasBr()&&o.br!==NB?' ב'+esc(brNm(o.br)):''}: ${n3(q(p,o.br))}`:''}</small>
 <div class="row" style="margin-top:6px;gap:6px">${chip(x.ok===true,'oxPkYes1',o,i,'','✓ יש במלאי')}${chip(x.ok===false,'oxPkNo',o,i,'','✗ אין במלאי')}</div>`;
 if(x.ok===false){
  h+=`<div class="chips" role="group" aria-label="מה עושים עם המוצר" style="flex-wrap:wrap;gap:6px;margin-top:8px">${chip(x.act==='rm','oxPkAct',o,i,'rm','להוריד מההזמנה')}${chip(x.act==='rep','oxPkAct',o,i,'rep','מוצר דומה')}${chip(x.act==='ord','oxPkAct',o,i,'ord','להזמין מספק')}</div>`;
  if(x.act==='rm')h+=`<p class="note" style="margin:6px 0 0">המוצר יוסר מההזמנה, והסכום ירד ב-${ils(lineT(it))}.</p>`;
  if(x.act==='rep'){h+=`<p style="margin:6px 0 0;color:var(--acc)"><b>יש לעדכן את הלקוח</b> על המוצר החלופי.</p>`;
   if(x.pid){const np=prod(x.pid);h+=`<div class="li" style="cursor:default"><div class="m"><b>במקום: ${esc(np?np.name:x.pid)}</b><small>${n3(it.qty)} יח' · מחיר משוער ${ils(estP(o,x.pid))} (המחיר הסופי לפי כללי המחיר)</small></div></div><button type="button" class="btn g s" data-a="oxPkRepX" data-id="${esc(o.id)}" data-n="${i}">בחירת מוצר אחר</button>`}
   else h+=`<label class="f" style="margin-top:6px"><span>חיפוש מוצר חלופי</span><input data-i="oxPkQ" data-id="${esc(o.id)}" data-n="${i}" value="${esc(x.q)}" autocomplete="off"></label><div id="oxpkh${i}">${hitsH(o,i,x.q)}</div>`}
  if(x.act==='ord'){const sp=supOf(it);
   h+=`<label class="f" style="margin-top:6px"><span>ספק${sp?' (זוהה לפי המוצר – אפשר לשנות)':' (לא זוהה – כתבו את שם הספק)'}</span><input data-i="oxPkF" data-k="sup" data-id="${esc(o.id)}" data-n="${i}" maxlength="60" value="${esc(x.sup)}" list="oxSupDL" autocomplete="off"></label>${window.supDL?window.supDL('oxSupDL'):''}
   <div class="row" style="gap:8px"><label class="f grow"><span>כמות</span><input data-i="oxPkF" data-k="qty" data-id="${esc(o.id)}" data-n="${i}" inputmode="decimal" value="${esc(x.qty)}"></label><label class="f grow"><span>תאריך צפי (רשות)</span><input type="date" data-i="oxPkF" data-k="eta" data-id="${esc(o.id)}" data-n="${i}" value="${esc(x.eta)}"></label></div>
   <p class="note" style="margin:0">נכנס לרשימה "להזמין מספקים". לא נשלח לספק, והמוצר נשאר בהזמנה.</p>`}
 }
 return h+'</div>'}
V.oxPick=id=>{const T='טיפול בהזמנה';if(!on())return{t:T,h:'<div class="empty">אין לך הרשאה להזמנות</div>'};
 if(!O.L){const r=V.oxOrd(id);return Object.assign({},r,{t:T})}
 const o=ordOf(id);if(!o)return{t:T,h:'<div class="empty">ההזמנה לא נמצאה</div>'};
 if(!PS[id]&&o.pk&&o.pk.l)return sumV(o);
 if(!canPick(o))return{t:T,s:'#'+o.no,h:`<div class="empty">אי אפשר לטפל בהזמנה במצב הזה</div><button type="button" class="btn g w" data-a="oxPkBack">חזרה להזמנה</button>`};
 const s=sess(o),c=o.cust||{};
 return{t:T,s:'הזמנה #'+o.no,h:`<div class="card"><b>#${o.no} · ${esc(c.name||'')}</b><p class="note" style="margin:4px 0 0">סמנו לכל מוצר אם יש במלאי. למוצר שאין – בחרו מה עושים.</p></div>
 <button type="button" class="btn g w" data-a="oxPkAll" data-id="${esc(id)}" style="margin-top:8px">✓ הכול במלאי</button>
 ${s.l.map((x,i)=>lineH(o,s,i)).join('')}
 ${s.err?`<p class="note" style="color:var(--bad)">${esc(s.err)}</p>`:''}
 <button type="button" class="btn w" data-a="oxPkDone" data-id="${esc(id)}" style="margin-top:8px">סיום וסיכום</button>
 <button type="button" class="btn g s w" data-a="oxPkBack" style="margin-top:6px">חזרה בלי לשמור</button>`}};
const S_=el=>{const o=ordOf(el.dataset.id);if(!o)return null;const s=sess(o),i=+el.dataset.n;return{o,s,i,x:s.l[i]}};
ACT.oxPkYes1=el=>{const r=S_(el);if(!r)return;Object.assign(r.x,{ok:true,act:''});rerender()};
ACT.oxPkNo=el=>{const r=S_(el);if(!r)return;r.x.ok=false;rerender()};
ACT.oxPkAll=el=>{const o=ordOf(el.dataset.id);if(!o)return;sess(o).l.forEach(x=>Object.assign(x,{ok:true,act:''}));rerender()};
ACT.oxPkAct=el=>{const r=S_(el);if(!r)return;r.x.act=el.dataset.k;if(r.x.act==='ord'){const it=r.s.it[r.i];if(!r.x.sup)r.x.sup=supOf(it);if(!r.x.qty)r.x.qty=String(n3(it.qty))}rerender()};
ACT.oxPkRep=el=>{const r=S_(el);if(!r)return;r.x.pid=el.dataset.p;rerender()};
ACT.oxPkRepX=el=>{const r=S_(el);if(!r)return;r.x.pid='';rerender()};
ACT.oxPkBack=()=>back();
INP.oxPkQ=el=>{const r=S_(el);if(!r)return;r.x.q=el.value;const h=document.getElementById('oxpkh'+r.i);if(h)h.innerHTML=hitsH(r.o,r.i,el.value)};
INP.oxPkF=el=>{const r=S_(el);if(!r)return;r.x[el.dataset.k]=el.value};
ACT.oxPkDone=async el=>{const id=el.dataset.id,o=ordOf(id);if(!o)return;const s=sess(o);const L=[];
 for(let i=0;i<s.l.length;i++){const x=s.l[i],n=s.it[i].n;
  if(x.ok===null)return toast(`"${n}": סמנו יש או אין במלאי`);
  if(x.ok){L.push({i,ok:true});continue}
  if(!x.act)return toast(`"${n}": בחרו להוריד, מוצר דומה או להזמין`);
  if(x.act==='rep'&&!x.pid)return toast(`"${n}": בחרו מוצר חלופי`);
  const m={i,ok:false,act:x.act};
  if(x.act==='rep')m.pid=x.pid;
  if(x.act==='ord'){const sp=String(x.sup||'').trim(),qt=num(x.qty);if(!sp)return toast(`"${n}": כתבו את שם הספק`);if(!(qt>0))return toast(`"${n}": כמות לא תקינה`);m.sup=sp;m.qty=qt;if(x.eta)m.eta=x.eta}
  L.push(m)}
 if(L.every(m=>m.act==='rm'))return toast('כל המוצרים מסומנים להורדה. לביטול ההזמנה – "ביטול הזמנה" בכרטיס ההזמנה');
 el.disabled=true;s.err='';
 // 19.11.2026: מוצרים שסומנו "להזמין מספק" – אחרי השמירה שואלים אם להוסיף גם לחוסרים (hs.js, window.hsAskSo). אותו מוצר פעמיים – שורה אחת, הכמויות מצטרפות (כמו בשרת)
 const SOQ=[];s.l.forEach((x,i)=>{if(x.act!=='ord')return;const it=s.it[i],k=it.pid?'p:'+it.pid:'n:'+it.n,q=num(x.qty),e=SOQ.find(y=>y.k===k);if(e){e.qty=n3(e.qty+q);e.sup=String(x.sup||'').trim()}else SOQ.push({k,n:it.n,qty:q,sup:String(x.sup||'').trim()})});
 try{const r=await fnCall('orderPick',Object.assign({id,reqId:s.rq,l:L},typeof s.upd==='number'?{upd:s.upd}:{}));s.sent=1;
  if(s.l.some(x=>x.act==='rm'||x.act==='rep')&&!(r&&r.applied)){
   const items=[];s.it.forEach((it,i)=>{const x=s.l[i];if(x.act==='rm')return;if(x.act==='rep'){items.push({pid:x.pid,qty:it.qty});return}
    const w={qty:it.qty,price:it.price};if(it.pid){w.pid=it.pid;if(it.from)w.from=it.from}else{w.n=it.n;if(typeof it.c==='number')w.c=it.c;if(it.lb)w.lb=it.lb}items.push(w)});
   try{const u=await fnCall('updateOrder',Object.assign({id,items},r&&typeof r.upd==='number'?{ver:r.upd}:{}));if(u&&u.warn&&u.warn.length)setTimeout(()=>toast('שים לב: אין מספיק במלאי – '+u.warn.map(w=>w.n).join(', ')),2700)}
   catch(e){el.disabled=false;if(e&&e.reason==='stale')return stale(id);s.err=(e&&e.message||'הפעולה נכשלה')+' – השינויים במוצרים לא נשמרו. תקנו ולחצו שוב "סיום וסיכום".';toast(s.err);rerender();return}}
  delete PS[id];await after(id);
  if(r&&r.st==='ok'){toast('הכול במלאי – אפשר להמשיך');back()}else rerender();
  if(SOQ.length&&typeof window.hsAskSo==='function')try{window.hsAskSo(ordOf(id)||o,SOQ)}catch(e){}}
 catch(e){el.disabled=false;if(e&&e.reason==='stale')return stale(id);err(e)}};
// תיקון אחרי בדיקה: עובד אחר שינה את ההזמנה בזמן הסימון – לא דורסים. טוענים מחדש ומתחילים סימון חדש
async function stale(id){toast('ההזמנה השתנתה בינתיים (מישהו אחר עדכן אותה). נטען מחדש – סמנו שוב.');delete PS[id];await after(id);const o=ordOf(id);if(o&&canPick(o))sess(o);rerender()}

/* ---------- סיכום השינויים ואישור הלקוח ---------- */
function sumV(o){const pk=o.pk,B=pk.sum||{it:[]},c=o.cust||{},chg=pk.st==='chg';
 const used=new Set();
 const rows=(pk.l||[]).filter(x=>!x.ok).map(x=>{const b=B.it[x.i]||{n:'',qty:0,price:0};
  if(x.act==='rm')return`<div class="li" style="cursor:default"><div class="m"><b>הוסר: ${esc(b.n)}</b><small>${n3(b.qty)} × ${ils(b.price)}</small></div><b class="a neg">−${ils(lineT(b))}</b></div>`;
  if(x.act==='rep'){const k=(o.items||[]).findIndex((it,j)=>!used.has(j)&&it.pid===(x.rep&&x.rep.pid));if(k>=0)used.add(k);const nw=k>=0?o.items[k]:null;
   return`<div class="li" style="cursor:default"><div class="m"><b>הוחלף: ${esc(b.n)} ← ${esc(x.rep&&x.rep.n||'')}</b><small>${n3(b.qty)} יח' · מחיר ${ils(b.price)} ← ${nw?ils(nw.price):'—'}</small></div><b class="a">${nw?ils(lineT(nw)):''}</b></div>`}
  if(x.act==='ord')return`<div class="li" style="cursor:default"><div class="m"><b>להזמין מספק: ${esc(b.n)}</b><small>${x.sup?'ספק '+esc(x.sup)+' · ':''}${x.qty!=null?'כמות '+n3(x.qty):''}${x.eta?' · צפי '+dmy(x.eta):''} · נשאר בהזמנה</small></div></div>`;
  return''}).join('');
 const a0=typeof B.g==='number'?B.g:(B.t||0),a1=amtOf(o),d=(ag(a1)-ag(a0))/100;
 return{t:'סיכום שינויים',s:'הזמנה #'+o.no,h:`<div class="card"><b>#${o.no} · ${esc(c.name||'')}</b>${rows?'':'<p class="note" style="margin:4px 0 0">כל המוצרים במלאי – אין שינויים.</p>'}</div>
 ${rows?`<div class="sec"><h3>שינויים במוצרים</h3></div>${rows}`:''}
 <div class="card" style="margin-top:8px"><div class="row" style="justify-content:space-between"><span>סכום לפני</span><b>${ils(a0)}</b></div><div class="row" style="justify-content:space-between"><span>סכום אחרי</span><b class="amt">${ils(a1)}</b></div>${d?`<p class="note" style="margin:4px 0 0">הפרש: ${d>0?'+':'−'}${ils(Math.abs(d))}</p>`:''}</div>
 ${chg?`<div class="card" style="margin-top:8px;border-color:var(--acc)"><p style="margin:0"><b>התקשרו ללקוח</b>, עדכנו אותו בשינויים ובמחיר, ובקשו את אישורו.</p>
  <a class="btn g w" href="tel:${esc(c.phone||'')}" data-a="oxCall" data-id="${esc(o.id)}" style="display:flex;align-items:center;justify-content:center;text-decoration:none;margin-top:8px">חייג ללקוח <span dir="ltr" style="margin-inline-start:6px">${esc(c.phone||'')}</span></a>
  <button type="button" class="btn w" data-a="oxPkOk" data-id="${esc(o.id)}" style="margin-top:8px">הלקוח אישר את השינויים</button>
  <p class="note" style="margin:6px 0 0">עד האישור אי אפשר לסמן "נשלח" או "ממתין לתשלום".</p></div>`
  :`<p class="note">${pk.okAt?'הלקוח אישר את השינויים · '+tm(pk.okAt):'אין שינויים שדורשים אישור.'}</p>`}
 ${!chg&&OPEN.includes(o.status)&&!o.shp&&!(o.custId&&window.__onTerms&&window.__onTerms(o.custId))&&window.__oxAuthH?window.__oxAuthH(o):''}
 ${canPick(o)&&!chg?`<button type="button" class="btn g s w" data-a="oxPkRe" data-id="${esc(o.id)}" style="margin-top:8px">סימון מלאי מחדש</button>`:''}
 <button type="button" class="btn g w" data-a="oxPkBack" style="margin-top:6px">חזרה להזמנה</button>`}}
ACT.oxPkOk=async el=>{const id=el.dataset.id;el.disabled=true;try{await fnCall('orderPickOk',{id});toast('נרשם: הלקוח אישר את השינויים');await after(id);back()}catch(e){el.disabled=false;err(e)}};
ACT.oxPkRe=el=>{const o=ordOf(el.dataset.id);if(!o)return;delete PS[o.id];sess(o);rerender()};
// תיקון סבב 1 (החלטה 32): "ההזמנה השתנתה אחרי הליקוט" – ליקוט חדש מהכרטיס או מהסיכום
ACT.oxPkGo=el=>{const o=ordOf(el.dataset.id);if(!o||!canPick(o))return toast('אי אפשר לטפל בהזמנה במצב הזה');delete PS[o.id];sess(o);if(cur().v==='oxPick')rerender();else ACT.go(el)};

/* ---------- כרטיס ההזמנה: כניסה לליקוט, מצב השינויים, וחסימת "נשלח" עד אישור ---------- */
{const f=V.oxOrd;if(f)V.oxOrd=id=>{const r=f(id);try{if(!r||!r.h||!on())return r;const o=ordOf(id);if(!o)return r;const pk=o.pk;let h='';
 if(pk&&pk.st==='chg')h=`<div class="card" style="border-color:var(--acc)"><b>יש שינויים שממתינים לאישור הלקוח</b><p class="note" style="margin:4px 0 0">עד האישור אי אפשר לסמן "נשלח" או "ממתין לתשלום".</p><button type="button" class="btn w" data-a="go" data-v="oxPick" data-arg="${esc(id)}" style="margin-top:6px">סיכום השינויים ואישור הלקוח</button></div>`;
 else if(canPick(o)&&o.status==='work')h=`<button type="button" class="btn w" data-a="go" data-v="oxPick" data-arg="${esc(id)}">${pk?'סימון מלאי מחדש':'טיפול בהזמנה – סימון מלאי'}</button>${pk?`<p class="note" style="margin:4px 0 0">${pk.okAt?'הלקוח אישר את השינויים · '+tm(pk.okAt):'הליקוט הושלם'}</p>`:''}`;
 else if(pk&&pk.okAt)h=`<p class="note">הלקוח אישר את השינויים · ${tm(pk.okAt)}</p>`;
 const k='<div class="sec"><h3>פריטים</h3>';const at=r.h.indexOf(k);if(h&&at>=0)r.h=r.h.slice(0,at)+h+r.h.slice(at)}catch(e){}return r}}
{const f=ACT.oxStat;if(f)ACT.oxStat=async el=>{const id=el.dataset.id,s=el.dataset.s,o=ordOf(id);
 if(o&&o.pk&&o.pk.st==='chg'&&['out','wait_pay','done'].includes(s)&&s!==o.status){
  if(!mgr())return toast('הלקוח עוד לא אישר את השינויים במוצרים. קודם "סיכום השינויים ואישור הלקוח".');
  return ask('הלקוח עוד לא אישר את השינויים במוצרים. לעקוף ולהמשיך? (נרשם בהיסטוריה)',async()=>{try{await fnCall('setOrderStatus',{id,status:s,force:true});toast('הסטטוס עודכן');await after(id)}catch(e){err(e)}},'כן, לעקוף')}
 await f(el);
 if(s==='work'){const n=ordOf(id);if(n&&n.status==='work'&&canPick(n)&&cur().v==='oxOrd'&&cur().a===id)go('oxPick',id)}}}

/* ---------- להזמין מספקים ---------- */
const SO={L:null,busy:0,err:''};window.__so=SO;/* סנכרון ספקים (sup-sync.js) */
async function soLoad(){if(SO.busy)return;SO.busy=1;SO.err='';
 try{const m=brMineIds(),vs=a=>({arrayValue:{values:a.map(v=>({stringValue:v}))}});
  // עובד משויך לסניפים – השאילתה חייבת לסנן לפי סניף (החוקים); אחרת – רק פתוחות
  const where=m&&hasBr()?{fieldFilter:{field:{fieldPath:'br'},op:'IN',value:vs(m.slice(0,30))}}:{fieldFilter:{field:{fieldPath:'st'},op:'IN',value:vs(['open','ord'])}};
  const r=await fsx(':runQuery',{method:'POST',body:JSON.stringify({structuredQuery:{from:[{collectionId:'supord'}],where,limit:1000}})});
  SO.L=(r||[]).filter(x=>x.document).map(x=>dec(x.document)).filter(x=>x.st==='open'||x.st==='ord').sort((a,b)=>(a.at||0)-(b.at||0))}
 catch(e){SO.err=e&&e.message||'הטעינה נכשלה'}finally{SO.busy=0;if(cur().v==='oxSup')rerender()}}
const supK=s=>String(s||'').trim().toLowerCase();
V.oxSup=()=>{const T='להזמין מספקים';if(!on())return{t:T,h:'<div class="empty">אין לך הרשאה להזמנות</div>'};
 if(!SO.L){if(!SO.busy&&!SO.err)soLoad();return{t:T,h:SO.err?`<div class="card"><p class="note">${esc(SO.err)}</p><button type="button" class="btn g w" data-a="oxSoRe">נסה שוב</button></div>`:'<div class="empty">טוען…</div>'}}
 const G=new Map();SO.L.forEach(x=>{const k=supK(x.sup);if(!G.has(k))G.set(k,{n:x.sup,L:[]});G.get(k).L.push(x)});
 const gs=[...G.values()].sort((a,b)=>String(a.n).localeCompare(String(b.n),'he'));
 const b=(x,st,t)=>`<button type="button" class="btn g s grow" data-a="oxSoSt" data-id="${esc(x.id)}" data-s="${st}">${t}</button>`;
 const row=x=>`<div class="li" style="cursor:default;flex-wrap:wrap"><div class="m"><b>${esc(x.n)}</b><small>כמות ${n3(x.qty)} · הזמנה #${x.no}${x.cust?' · '+esc(x.cust):''}${x.eta?' · צפי '+dmy(x.eta):''}${hasBr()&&x.br&&x.br!==NB?' · '+esc(brNm(x.br)):''}</small></div><span class="tag${x.st==='ord'?' t1':''}">${x.st==='ord'?'הוזמן':'להזמין'}</span>
  <div class="row" style="width:100%;gap:6px">${x.st==='open'?b(x,'ord','הוזמן'):''}${b(x,'done','הגיע')}<button type="button" class="btn g s grow" data-a="go" data-v="oxOrd" data-arg="${esc(x.ord)}">להזמנה</button>${b(x,'void','לא צריך')}</div></div>`;
 return{t:T,s:SO.L.length+' פריטים',h:`<p class="note">רשימה פנימית – לא נשלחת לספק. כשהסחורה מגיעה מסמנים "הגיע", ומכניסים אותה למלאי ב"הכנסת מלאי".</p>
 ${gs.length?gs.map(g=>`<div class="sec"><h3>${esc(g.n)} (${g.L.length})</h3></div>${g.L.map(row).join('')}`).join(''):'<div class="empty">אין מוצרים להזמין</div>'}
 <button type="button" class="btn g s w" data-a="oxSoRe" style="margin-top:8px">רענן</button>`}};
ACT.oxSoRe=()=>{SO.L=null;SO.err='';soLoad();rerender()};
ACT.oxSoSt=el=>{const id=el.dataset.id,st=el.dataset.s;const run=async()=>{el.disabled=true;try{await fnCall('supOrdSet',{id,st});const x=(SO.L||[]).find(y=>y.id===id);if(x){if(st==='done'||st==='void')SO.L=SO.L.filter(y=>y!==x);else x.st=st}toast(st==='done'?'סומן: הגיע. אל תשכחו להכניס למלאי':'עודכן');rerender()}catch(e){el.disabled=false;err(e)}};
 if(st==='void')ask('להוריד את המוצר מהרשימה "להזמין מספקים"?',run,'כן, להוריד');else run()};
// כניסה מרשימת ההזמנות
{const f=V.ox;if(f)V.ox=()=>{const r=f();try{if(!r||!r.h||!on())return r;if(SO.L===null&&!SO.busy&&!SO.err&&O.L)soLoad();const n=SO.L?SO.L.length:0;
 const a0=r.h.indexOf('data-v="oxStock"'),at=a0>=0?r.h.indexOf('</div>',a0)+6:-1;if(at>5)r.h=r.h.slice(0,at)+`<button type="button" class="btn g s w" data-a="go" data-v="oxSup" style="margin-bottom:6px">להזמין מספקים${n?` (${n})`:''}</button>`+r.h.slice(at)}catch(e){}return r}} // אחרי שורת "הזמנה חדשה / מלאי / לקוחות"
window.__oxPick={PS,sess,SO};
})();
