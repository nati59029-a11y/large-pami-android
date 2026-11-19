/* POS:M6 – קופה ש6: ניהול מוצרים באזור הניהול (לא במסך הקופה). מנהל בלבד, מתג 'pos', מבנה חדש.
   - window.PosM6: טעינת המוצרים והקטגוריות (קריאה בלבד, לפי הכללים הקיימים) – משותף לספירה, למדבקות ולהוספה המהירה.
   - V.posProds: רשימה + חיפוש (שם / ברקוד / מק"ט / 4 ספרות אחרונות) + מסננים (חסר פרטים / חסר מחיר / לבדיקה / נוצר בקופה / מוסתרים),
     עריכה (posProdSave), מוצר חדש (חובה מלאה, ברקוד פנימי אוטומטי), שינוי מחירים קבוצתי עם תצוגה מקדימה (posPriceBulk), התראות "נוצר בקופה".
   - מרכז "מוצרים ומלאי" בתוך "ניהול קופה" (V.posAdm של שלב 0): מוצרים, ייבוא מכספיט, ספירת מלאי, מדבקות.
   כל כתיבה – דרך השרת (functions/pos-catalog.js). רכיבי D1 ומשתני הצבע של האפליקציה, בלי צבע קבוע. */
(function(){
'use strict';
if(typeof ACT==='undefined'||typeof V==='undefined')return;
const fnCall=(n,d)=>{d=d&&typeof d==='object'?d:{};if(SY&&SY.sa&&SY.bizId&&!('bizId'in d))d=Object.assign({bizId:SY.bizId},d);return window.fnCall(n,d)};
const on=()=>{try{return bzF('pos')&&bzB()&&!SY.mg}catch(e){return false}};
const mgr=()=>{try{return isA()||!!(SY&&SY.sa)}catch(e){return false}};
const lead=()=>{try{if(mgr())return true;const p=SY.perms;return isW()&&!!(p&&typeof p==='object'&&p.posMgr===true)}catch(e){return false}};
const err=e=>toast(e&&e.message||'הפעולה נכשלה');
const dec=d=>Object.assign({id:d.name.split('/').pop()},fvj({mapValue:d}));
const ils2=v=>typeof v==='number'?(typeof ils==='function'?ils(v):'₪'+v.toFixed(2)):'—';
const FL={missing:'חסר פרטים',noPrice:'חסר מחיר',bcCheck:'לבדיקה',fromPos:'נוצר בקופה'};
const C={prods:null,cats:null,busy:0,err:'',at:0};
async function pages(path,mask){const out=[];let tok='';for(let i=0;i<60;i++){const q=`${path}?pageSize=300${(mask||[]).map(f=>'&mask.fieldPaths='+f).join('')}${tok?'&pageToken='+encodeURIComponent(tok):''}`;const j=await fsx(q);(j&&j.documents||[]).forEach(d=>out.push(dec(d)));tok=j&&j.nextPageToken;if(!tok)break}return out}
const PM=['name','price','barcode','bcs','packs','sku','cat','sub','on','flags','q','alias','season','minP','src','track','minQ','loc','bcRaw'];
async function load(force){if(C.busy)return C.busy;if(C.prods&&!force&&Date.now()-C.at<120000)return;
 C.busy=(async()=>{try{const[p,c]=await Promise.all([pages('/prod',PM),pages('/cat')]);C.prods=p;C.cats=c.sort((a,b)=>(a.ord||0)-(b.ord||0)||String(a.name).localeCompare(String(b.name),'he'));C.at=Date.now();C.err=''}catch(e){C.err=e&&e.message||'הטעינה נכשלה'}finally{C.busy=0}})();return C.busy}
const codes=p=>[p.barcode].concat(p.bcs||[],(p.packs||[]).map(x=>x&&x.bc)).filter(Boolean);
function find(code){const c=window.PosBarcode?PosBarcode.clean(code):String(code||'').trim();if(!c||!C.prods)return null;for(const p of C.prods)if(codes(p).includes(c))return p;return null}
const catName=id=>{const c=(C.cats||[]).find(x=>x.id===id);return c?c.name:''};
window.PosM6={C,load,find,codes,catName,fnCall,on,mgr,lead,err,ils2,FL};

/* ---------- רשימת מוצרים ---------- */
const S={q:'',f:'',sel:null,alerts:null};
const typing=()=>{const a=document.activeElement;return !!(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)&&a.closest('#main'))};
const redraw=()=>{try{if(['posProds','posAdm'].includes(cur().v)&&!typing()&&!document.querySelector('#dlg[open]'))rerender()}catch(e){}};
function match(p){const f=S.f;if(f==='hidden'){if(p.on!==false)return false}else if(p.on===false)return false;
 if(f&&f!=='hidden'&&!(p.flags||[]).includes(f))return false;
 const q=S.q.trim();if(!q)return true;if(/^\d{4,}$/.test(q))return codes(p).some(c=>c.endsWith(q))||String(p.sku||'')===q;
 const s=q.toLowerCase();return String(p.name||'').toLowerCase().includes(s)||String(p.sku||'').toLowerCase()===s||(p.alias||[]).some(a=>String(a).toLowerCase().includes(s))}
V.posProds=()=>{const T='מוצרים';if(!on()||!mgr())return{t:T,h:'<div class="empty">למנהל בלבד, כשהקופה מופעלת בעסק</div>'};
 if(!C.prods){if(!C.busy&&!C.err)load().then(redraw);return{t:T,h:C.err?`<div class="card"><p class="note">${esc(C.err)}</p><button class="btn g w" data-a="pmRe">נסה שוב</button></div>`:'<div class="empty">טוען מוצרים…</div>'}}
 if(S.alerts===null){S.alerts=undefined;fnCall('posAlert',{op:'list'}).then(r=>{S.alerts=r.items||[];redraw()}).catch(()=>{S.alerts=[]})}
 const all=C.prods,L=all.filter(match);S.sel=L;
 const cnt=k=>all.filter(p=>k==='hidden'?p.on===false:(p.on!==false&&(p.flags||[]).includes(k))).length;
 const chips=[['','הכול',all.filter(p=>p.on!==false).length],['missing',FL.missing,cnt('missing')],['noPrice',FL.noPrice,cnt('noPrice')],['bcCheck',FL.bcCheck,cnt('bcCheck')],['fromPos',FL.fromPos,cnt('fromPos')],['hidden','מוסתרים',cnt('hidden')]];
 const al=(S.alerts||[]).length;
 return{t:T,s:`${all.length} מוצרים`,h:`${al?`<div class="card"><b>${al} מוצרים נוצרו בקופה</b><p class="note" style="margin:4px 0 8px">קופאי הוסיף מוצר לא מוכר. בדקו את הפרטים והשלימו מק"ט, קטגוריה ועלות.</p><button class="btn s" data-a="pmF" data-v="fromPos">הצג</button></div>`:''}
 <div class="row"><button class="btn grow" data-a="pmNew">＋ מוצר חדש</button><button class="btn g grow" data-a="pmBulk">שינוי מחירים</button></div>
 <label class="f" style="margin-top:8px"><span>חיפוש</span><input id="pmQ" data-c="pmQ" value="${esc(S.q)}" placeholder="שם, מק&quot;ט, ברקוד או 4 ספרות אחרונות" autocomplete="off"></label>
 <div class="chips">${chips.map(([k,l,n])=>`<button class="chip ${S.f===k?'on':''}" data-a="pmF" data-v="${k}" aria-pressed="${S.f===k}">${esc(l)} (${n})</button>`).join('')}</div>
 ${L.slice(0,100).map(p=>`<div class="li" style="cursor:default"><div class="m" style="min-width:0"><b style="overflow-wrap:anywhere">${esc(p.name||'')}</b><small><bdi dir="ltr">${esc(ils2(p.price))}</bdi>${p.barcode?' · <bdi dir="ltr">'+esc(p.barcode)+'</bdi>':''}${p.sku?' · מק"ט '+esc(p.sku):''}${p.cat?' · '+esc(catName(p.cat)):''}${(p.flags||[]).filter(f=>FL[f]).map(f=>` <span class="tag t1">${esc(FL[f])}</span>`).join('')}${p.on===false?' <span class="tag t4">מוסתר</span>':''}</small></div><button class="btn s g" data-a="pmEd" data-id="${esc(p.id)}">עריכה</button></div>`).join('')||'<div class="empty">אין מוצרים מתאימים</div>'}
 ${L.length>100?`<p class="note">מוצגים 100 מתוך ${L.length}. צמצמו בחיפוש.</p>`:''}`}};
ACT.pmRe=()=>{C.err='';C.prods=null;rerender()};
ACT.pmF=el=>{S.f=el.dataset.v||'';if(cur().v!=='posProds')go('posProds');else rerender()};
CHG.pmQ=el=>{S.q=el.value;rerender();const i=document.getElementById('pmQ');if(i){i.focus();i.setSelectionRange(i.value.length,i.value.length)}};
{let t=0;document.addEventListener('input',e=>{if(e.target&&e.target.id==='pmQ'){clearTimeout(t);t=setTimeout(()=>{S.q=e.target.value;rerender();const i=document.getElementById('pmQ');if(i){i.focus();i.setSelectionRange(i.value.length,i.value.length)}},250)}})}

/* ---------- עריכה / מוצר חדש ---------- */
const list=v=>String(v||'').split(/[,\n]/).map(s=>s.trim()).filter(Boolean);
async function costOf(id){try{const j=await fsx('/prod/'+encodeURIComponent(id)+'/p/cost');const c=fvj({mapValue:j}).cost;return typeof c==='number'?c:''}catch(e){return ''}}
async function edit(id){const p=id?(C.prods||[]).find(x=>x.id===id):null;if(id&&!p)return;
 const cost=id?await costOf(id):'';const brs=(typeof brList==='function'?brList():[]);
 dlg(`<h3>${p?'עריכת מוצר':'מוצר חדש'}</h3>${p&&(p.flags||[]).length?`<p class="note" style="margin-top:0">${(p.flags||[]).filter(f=>FL[f]).map(f=>esc(FL[f])).join(' · ')}${p.bcRaw?` · ברקוד מקורי: <bdi dir="ltr">${esc(p.bcRaw)}</bdi>`:''}</p>`:''}
 <form data-f="pmSave" data-id="${esc(id||'')}" style="max-height:62vh;overflow:auto">
 <label class="f"><span>שם (עד 40 תווים, גם בקבלה)</span><input name="name" maxlength="40" required value="${esc(p?p.name:'')}"></label>
 <label class="f"><span>מחיר מכירה כולל מע"מ (₪)</span><input name="price" inputmode="decimal" dir="ltr" required value="${p&&typeof p.price==='number'?p.price:''}"></label>
 <label class="f"><span>ברקוד</span><input name="barcode" dir="ltr" inputmode="numeric" data-pos-scan value="${esc(p?p.barcode||'':'')}"></label>
 ${p&&p.barcode?'':`<label class="f"><span><input type="checkbox" name="autoBc" ${p?'':'checked'}> בלי ברקוד – ליצור ברקוד פנימי</span></label>`}
 <label class="f"><span>מק"ט (ריק = מספר רץ)</span><input name="sku" dir="ltr" value="${esc(p?p.sku||'':'')}"></label>
 <label class="f"><span>קטגוריה</span><select name="cat"><option value="">—</option>${(C.cats||[]).map(c=>`<option value="${esc(c.id)}"${p&&p.cat===c.id?' selected':''}>${esc((c.parent?'— ':'')+c.name)}</option>`).join('')}</select></label>
 <label class="f"><span>עלות קנייה לפני מע"מ (₪)</span><input name="cost" inputmode="decimal" dir="ltr" value="${cost}"></label>
 <label class="f"><span>מחיר מינימום (₪, ריק = לפי הגדרת ההזמנות)</span><input name="minP" inputmode="decimal" dir="ltr" value="${p&&typeof p.minP==='number'?(p.minP/100):''}"></label>
 <label class="f"><span>ברקודים נוספים (מופרדים בפסיק)</span><input name="bcs" dir="ltr" value="${esc((p&&p.bcs||[]).join(', '))}"></label>
 <label class="f"><span>ברקודי ארגז (שורה לכל ארגז: ברקוד:כמות)</span><textarea name="packs" dir="ltr" rows="2">${esc((p&&p.packs||[]).map(x=>x.bc+':'+x.qty).join('\n'))}</textarea></label>
 <label class="f"><span>כינויים לחיפוש (מופרדים בפסיק)</span><input name="alias" value="${esc((p&&p.alias||[]).join(', '))}"></label>
 <label class="f"><span>עונה / חג (מופרדים בפסיק)</span><input name="season" value="${esc((p&&p.season||[]).join(', '))}"></label>
 <label class="f"><span>מעקב</span><select name="track"><option value="">בלי</option><option value="lot"${p&&p.track==='lot'?' selected':''}>אצווה</option><option value="exp"${p&&p.track==='exp'?' selected':''}>תפוגה</option></select></label>
 ${brs.length?brs.map(b=>`<label class="f"><span>מלאי מינימום – ${esc(b.name)}</span><input name="minQ_${esc(b.id)}" inputmode="numeric" dir="ltr" value="${p&&p.minQ&&p.minQ[b.id]!=null?p.minQ[b.id]:''}"></label>`).join(''):`<label class="f"><span>מלאי מינימום</span><input name="minQ__" inputmode="numeric" dir="ltr" value="${p&&p.minQ&&p.minQ._!=null?p.minQ._:''}"></label>`}
 <label class="f"><span><input type="checkbox" name="on" ${!p||p.on!==false?'checked':''}> פעיל (מוסתר = לא נמכר, ההיסטוריה נשמרת)</span></label>
 <div class="row"><button class="btn grow">שמירה</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>
 ${p?`<button class="btn g w" style="margin-top:8px" data-a="pmLbl" data-id="${esc(p.id)}">הוספת מדבקה לתור</button>`:''}`)}
ACT.pmEd=el=>edit(el.dataset.id).catch(err);
ACT.pmNew=()=>{if(!C.cats||!C.cats.length)return toast('אין קטגוריות. הוסיפו קטגוריה במסך ההזמנות ואחר כך מוצר.');edit('')};
FRM.pmSave=async f=>{const v=fd(f),id=f.dataset.id||'';const brs=(typeof brList==='function'?brList():[]);
 const packs=list(v.packs).map(s=>{const m=/^\s*([0-9A-Za-z-]+)\s*[:x×*]\s*(\d+)\s*$/.exec(s);return m?{bc:m[1],qty:+m[2]}:{bc:s,qty:0}});
 const minQ={};(brs.length?brs.map(b=>b.id):['_']).forEach(b=>{const x=v['minQ_'+b];if(x!==undefined&&String(x).trim()!=='')minQ[b]=+x});
 const d={name:v.name,price:Number(String(v.price).replace(',','.')),barcode:String(v.barcode||'').trim(),sku:v.sku,cat:v.cat,cost:v.cost===''?'':Number(String(v.cost).replace(',','.')),minP:v.minP===''?'':Number(String(v.minP).replace(',','.')),
  bcs:list(v.bcs),packs,alias:list(v.alias),season:list(v.season),track:v.track,minQ,on:!!f.elements.on.checked};
 if(id)d.id=id;if(f.elements.autoBc&&f.elements.autoBc.checked&&!d.barcode)d.autoBc=true;
 const b=f.querySelector('button:not([type=button])');b.disabled=true;
 try{const r=await fnCall('posProdSave',d);closeDlg();toast(id?'המוצר נשמר':'המוצר נוסף'+(r.barcode?' · ברקוד '+r.barcode:''));
  if(r.priceChanged)ask('המחיר השתנה. להוסיף מדבקת מחיר לתור ההדפסה?',()=>fnCall('posLbl',{op:'add',why:'price',items:[{pid:r.id,n:1,kind:'lbl'}]}).then(()=>toast('נוסף לתור המדבקות')).catch(err),'כן, להוסיף');
  if(!id)fnCall('posLbl',{op:'add',why:'new',items:[{pid:r.id,n:1,kind:'lbl'}]}).catch(()=>{}); // lbl.onNew
  if(S.alerts&&S.alerts.length){const a=S.alerts.filter(x=>x.pid===r.id);for(const x of a)fnCall('posAlert',{op:'close',id:x.id}).catch(()=>{});S.alerts=S.alerts.filter(x=>x.pid!==r.id)}
  await load(true);rerender()}catch(e){b.disabled=false;err(e)}};
ACT.pmLbl=el=>fnCall('posLbl',{op:'add',why:'manual',items:[{pid:el.dataset.id,n:1,kind:'lbl'}]}).then(()=>toast('נוסף לתור המדבקות')).catch(err);

/* ---------- שינוי מחירים קבוצתי (P22) ---------- */
ACT.pmBulk=()=>{const n=(S.sel||[]).filter(p=>p.on!==false).length;
 dlg(`<h3>שינוי מחירים</h3><form data-f="pmBulkF"><label class="f"><span>אילו מוצרים</span><select name="scope"><option value="sel">המוצרים שברשימה עכשיו (${n})</option>${(C.cats||[]).filter(c=>!c.parent).map(c=>`<option value="c:${esc(c.id)}">קטגוריה: ${esc(c.name)}</option>`).join('')}</select></label>
 <label class="f"><span>סוג</span><select name="mode"><option value="pct">אחוז (+5 / -10)</option><option value="add">סכום בשקלים (+1 / -0.5)</option><option value="set">מחיר קבוע</option></select></label>
 <label class="f"><span>ערך</span><input name="val" inputmode="decimal" dir="ltr" required></label>
 <div class="row"><button class="btn grow">תצוגה מקדימה</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`)};
let BK=null;
FRM.pmBulkF=async f=>{const v=fd(f),val=Number(String(v.val).replace(',','.'));if(!Number.isFinite(val))return toast('ערך לא תקין');
 const d={mode:v.mode,val,dry:true};if(v.scope==='sel'){const ids=(S.sel||[]).filter(p=>p.on!==false).map(p=>p.id);if(!ids.length)return toast('אין מוצרים ברשימה');if(ids.length>2000)return toast('עד 2,000 מוצרים בפעם – צמצמו בחיפוש');d.pids=ids}else d.cat=v.scope.slice(2);
 try{const r=await fnCall('posPriceBulk',d);BK=d;
  dlg(`<h3>תצוגה מקדימה · ${r.n} מוצרים</h3><div style="max-height:45vh;overflow:auto">${r.items.slice(0,200).map(x=>`<div class="note" style="padding:3px 0;border-bottom:1px solid var(--line)">${esc(x.name)} · <bdi dir="ltr">${esc(ils2(x.old))} ← ${esc(ils2(x.new))}</bdi></div>`).join('')||'<p class="note">אין שינוי</p>'}</div>
  <p class="note">קבלות קודמות לא משתנות. כל שינוי נרשם בהיסטוריית המחיר.</p><div class="row"><button class="btn grow" data-a="pmBulkGo"${r.n?'':' disabled'}>אשר ${r.n}</button><button class="btn g grow" data-a="closeDlg">ביטול</button></div>`)}catch(e){err(e)}};
ACT.pmBulkGo=async el=>{if(!BK)return;el.disabled=true;try{const r=await fnCall('posPriceBulk',Object.assign({},BK,{dry:false}));BK=null;await load(true);
 dlg(`<h3>המחירים עודכנו (${r.n})</h3><p class="note">להוסיף מדבקות מחיר לתור ההדפסה למוצרים שהשתנו?</p><div class="row"><button class="btn grow" data-a="pmBulkLbl" data-ids="${esc(r.items.map(x=>x.id).join(','))}">כן, להוסיף</button><button class="btn g grow" data-a="closeDlg">לא</button></div>`);rerender()}catch(e){el.disabled=false;err(e)}};
ACT.pmBulkLbl=async el=>{const ids=String(el.dataset.ids||'').split(',').filter(Boolean).slice(0,500);try{await fnCall('posLbl',{op:'add',why:'price',items:ids.map(pid=>({pid,n:1,kind:'lbl'}))});closeDlg();toast('נוספו '+ids.length+' מדבקות לתור')}catch(e){err(e)}};

/* ---------- מרכז "מוצרים ומלאי" בתוך ניהול קופה ---------- */
{const f=V.posAdm;if(typeof f==='function')V.posAdm=function(){const r=f.apply(this,arguments);try{if(r&&typeof r.h==='string'&&on()&&mgr()&&!/<div class="empty">/.test(r.h.slice(0,40))){
 r.h=`<div class="card"><h3 style="margin-top:0">מוצרים ומלאי</h3><button class="opt" data-a="go" data-v="posProds"><span>מוצרים<small>עריכה, מוצר חדש, שינוי מחירים, מוצרים שנוצרו בקופה</small></span>${ico('chev')}</button><button class="opt" data-a="go" data-v="posImp"><span>ייבוא מכספיט<small>מוצרים ולקוחות מקובץ או מצילום מחירון</small></span>${ico('chev')}</button><button class="opt" data-a="go" data-v="posCnt"><span>ספירת מלאי<small>מלאה או חלקית, בסורק, עם אישור מנהל</small></span>${ico('chev')}</button><button class="opt" data-a="go" data-v="posLbls"><span>מדבקות ושלטי מדף<small>תור הדפסה</small></span>${ico('chev')}</button></div>`+r.h}}catch(e){}return r}}
window.addEventListener('lp-biz-change',()=>{C.prods=null;C.cats=null;C.err='';S.alerts=null});
})();
