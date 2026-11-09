/* ORD:LINES – ניוד קווים בהזמנה (ענף fb/ord-lines; החלטות 00:59, 01:00, 01:45, 07:35, 07:38). קובץ עצמאי, נטען אחרי orders-cust.js.
   רק כשמנהל־העל הפעיל את cellular בעסק. כבוי = הקובץ לא מוסיף דבר לשום מסך.
   - הזמנה חדשה: "הלקוח רוצה ניוד" → קווים (טלפון / "הטלפון של הלקוח", ת"ז / "הת"ז של הלקוח", תוכנית, חברה), מאיזה פרסום הגיעו,
     פרטי בנק (בנק/סניף/חשבון) ות"ז בעל הכרטיס. כמות הקווים – אוטומטי.
   - התראה לעובד (01:45): מיד כשמסמנים ניוד ובכל שינוי טלפון – checkLines בשרת (כל סניפי העסק, בטווח של התוכנית; ברירת מחדל 60 יום).
     ניוד קודם → "קו זה כבר נויד בתאריך … בסניף …" עם "המשך בכל זאת" / "בטל ניוד לקו". אי אפשר לשמור לפני שבוחרים.
   - חבילות ניוד (קטגוריה במלאי): מנהל ועובד עם הרשאת הזמנות. מנהל: גם טווח התראה, רשימות, ומסך "הנחות, תקרות ומבצעים" (oxLnCfg).
   כל כתיבה – דרך השרת (orders.js: createOrder.cell, saveLinePlan, setCellCfg, checkLines). קריאה – lineplan, ordcfg/cell לפי החוקים. */
(function(){
'use strict';
if(typeof ACT==='undefined'||typeof V==='undefined'||!window.__ox)return;
const O=window.__ox;
const on=()=>(isA()||isW()||!!(SY&&SY.sa))&&bzF('orders')&&wp('ord');
const cell=()=>{const b=SY&&SY.biz;return !!(b&&b.features&&b.features.cellular===true)&&bzF('cellular')};
const mgr=()=>isA()||!!(SY&&SY.sa);
const dec=d=>Object.assign({id:idOf(d)},Object.fromEntries(Object.entries(d.fields||{}).map(([k,v])=>[k,fvj(v)])));
const err=e=>toast(e&&e.message||'הפעולה נכשלה');
const dig=v=>String(v==null?'':v).replace(/\D/g,'');
function tzOk(z){if(!/^\d{9}$/.test(z)||z==='000000000')return false;let s=0;for(let i=0;i<9;i++){let d=+z[i]*((i%2)+1);if(d>9)d-=9;s+=d}return s%10===0}
const tzN=v=>{const t=dig(v);return t.length>=5&&t.length<=9?t.padStart(9,'0'):''};
function phN(v){let p=String(v==null?'':v).trim().replace(/[\s-]/g,'');if(/^\+?972\d{8,9}$/.test(p))p='0'+p.replace(/^\+?972/,'');if(/^5\d{8}$/.test(p))p='0'+p;return /^0(5\d{8}|7\d{8}|[23489]\d{7})$/.test(p)?p:''}
const bn=id=>!id||id==='_'?'':(brNm(id)||id);
const dd=d=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(d||'');return m?(+m[3])+'.'+(+m[2])+'.'+m[1]:esc(d||'')};
const L={P:null,cfg:null,busy:0};
async function lload(force){if(L.busy||(!force&&L.P))return;L.busy=1;
 try{const[r,c]=await Promise.all([fsx(':runQuery',{method:'POST',body:JSON.stringify({structuredQuery:{from:[{collectionId:'lineplan'}],limit:200}})}),fsx('/ordcfg/cell').catch(e=>{if(e.code===404)return null;throw e})]);
  L.P=(r||[]).filter(x=>x.document).map(x=>dec(x.document)).sort((a,b)=>String(a.name).localeCompare(String(b.name),'he'));L.cfg=c?dec(c):{}}
 catch(e){L.P=L.P||[];L.cfg=L.cfg||{}}finally{L.busy=0;if(/^ox/.test(cur().v)&&!typing())rerender()}}
const typing=()=>{const a=document.activeElement;return !!(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)&&a.closest('#main'))};
const carriers=()=>Array.isArray(L.cfg&&L.cfg.carriers)?L.cfg.carriers:[];
const ads=()=>Array.isArray(L.cfg&&L.cfg.ads)?L.cfg.ads:[];
const plans=()=>(L.P||[]).filter(p=>p.on!==false);
const plan=id=>(L.P||[]).find(p=>p.id===id);
const opts=(list,v,empty)=>`<option value="">${empty}</option>`+list.map(x=>`<option value="${esc(x)}"${v===x?' selected':''}>${esc(x)}</option>`).join('');

/* ---------- טיוטה ---------- */
const CS=D=>{if(!D.cell)D.cell={on:false,lines:[],ad:'',bank:{bank:'',br:'',acct:''},ctz:'',hits:{},ok:{}};return D.cell};
const lnNew=first=>({k:Math.random().toString(36).slice(2,8),same:!!first,phone:'',sameTz:!!first,tz:'',plan:'',carrier:''});
const lnPhone=(D,l)=>l.same?phN(D.phone):phN(l.phone);
const lnTz=(D,l)=>l.sameTz?tzN(D.tz):tzN(l.tz);
// התראה: מאז ההוספה/שינוי – hits[k] = [{d,br,days}] ; ok[k] = העובד בחר "המשך בכל זאת"
const hitH=(D,l)=>{const S=CS(D),h=S.hits[l.k];if(h==='wait')return '<p class="note">בודק ניודים קודמים…</p>';if(!Array.isArray(h)||!h.length)return '';
 const t=h.map(x=>`קו זה כבר נויד בתאריך <b>${dd(x.d)}</b>${x.br?' בסניף <b>'+esc(bn(x.br))+'</b>':''}`).join('<br>');
 return S.ok[l.k]?`<p class="note" role="status">${t}<br>העובד אישר להמשיך בכל זאת.</p>`:`<div class="ban" role="alert" style="display:block;margin:6px 0;border-color:var(--neg)"><p style="margin:0 0 6px">${t}. האם להמשיך בכל זאת בניוד?</p><div class="row"><button type="button" class="btn grow s" data-a="olOk" data-k="${esc(l.k)}">המשך בכל זאת</button><button type="button" class="btn g grow s" data-a="olDel" data-k="${esc(l.k)}">בטל ניוד לקו</button></div></div>`};
const lineH=(D,l,i)=>{const P=plans(),C=carriers();return `<div class="card" style="margin:6px 0" data-ol="${esc(l.k)}"><b>קו ${i+1}</b>
 <label class="row" style="min-height:44px;gap:8px"><input type="checkbox" data-c="olSame" data-k="${esc(l.k)}"${l.same?' checked':''}>הטלפון של הלקוח${l.same&&phN(D.phone)?' (<bdi dir="ltr">'+esc(phN(D.phone))+'</bdi>)':''}</label>
 ${l.same?'':`<label class="f"><span>טלפון לניוד</span><input data-i="olF" data-f="phone" data-k="${esc(l.k)}" type="tel" inputmode="tel" dir="ltr" value="${esc(l.phone)}" autocomplete="off"></label>`}
 <label class="row" style="min-height:44px;gap:8px"><input type="checkbox" data-c="olSameTz" data-k="${esc(l.k)}"${l.sameTz?' checked':''}>הת.ז של הלקוח</label>
 ${l.sameTz?'':`<label class="f"><span>ת.ז לניוד</span><input data-i="olF" data-f="tz" data-k="${esc(l.k)}" inputmode="numeric" maxlength="9" value="${esc(l.tz)}" autocomplete="off"></label>`}
 <div class="row">${P.length?`<label class="f grow"><span>תוכנית</span><select data-c="olSel" data-f="plan" data-k="${esc(l.k)}"><option value="">בלי תוכנית</option>${P.map(p=>`<option value="${esc(p.id)}"${l.plan===p.id?' selected':''}>${esc(p.name)}</option>`).join('')}</select></label>`:''}
 ${C.length?`<label class="f grow"><span>חברת ניוד</span><select data-c="olSel" data-f="carrier" data-k="${esc(l.k)}">${opts(C,l.carrier,'בחר')}</select></label>`:''}</div>
 <div data-olh="${esc(l.k)}">${hitH(D,l)}</div><button type="button" class="btn g s" data-a="olRm" data-k="${esc(l.k)}">הסר קו</button></div>`};
const boxH=D=>{const S=CS(D);if(!S.on)return '';const A=ads();
 return `${S.lines.map((l,i)=>lineH(D,l,i)).join('')}<button type="button" class="btn g s w" data-a="olAdd">＋ קו נוסף לניוד</button>
 <p class="note">כמות קווים: <b id="oln">${S.lines.length}</b></p>
 ${A.length?`<label class="f"><span>מאיזה פרסום הגיעו</span><select data-c="olAd">${opts(A,S.ad,'לא ידוע')}</select></label>`:''}
 <details${S.bank.bank||S.bank.br||S.bank.acct||S.ctz?' open':''}><summary class="note" style="min-height:44px;display:flex;align-items:center">פרטי בנק ות.ז בעל הכרטיס (רשות)</summary>
 <div class="row"><label class="f grow"><span>בנק</span><input data-i="olB" data-f="bank" inputmode="numeric" maxlength="3" value="${esc(S.bank.bank)}" autocomplete="off"></label><label class="f grow"><span>סניף</span><input data-i="olB" data-f="br" inputmode="numeric" maxlength="4" value="${esc(S.bank.br)}" autocomplete="off"></label></div>
 <label class="f"><span>מספר חשבון</span><input data-i="olB" data-f="acct" inputmode="numeric" maxlength="12" value="${esc(S.bank.acct)}" autocomplete="off"></label>
 <label class="f"><span>ת.ז בעל הכרטיס</span><input data-i="olB" data-f="ctz" inputmode="numeric" maxlength="9" value="${esc(S.ctz)}" autocomplete="off"></label></details>`};
const secH=D=>{const S=CS(D);return `<div class="sec"><h3>ניוד קווים</h3></div><div class="card" id="olbox"><label class="row" style="min-height:44px;gap:8px"><input type="checkbox" data-c="olOn"${S.on?' checked':''}><b>הלקוח רוצה ניוד</b></label><div id="olin">${boxH(D)}</div></div>`};
const repaint=()=>{const D=O.draft,b=document.getElementById('olin');if(D&&b)b.innerHTML=boxH(D)};
const paintHit=(D,l)=>{const b=document.querySelector(`[data-olh="${l.k}"]`);if(b)b.innerHTML=hitH(D,l)};
const lnOf=el=>{const D=O.draft;if(!D)return [null,null];const l=CS(D).lines.find(x=>x.k===el.dataset.k);return [D,l]};

// בדיקת ניוד חוזר לקו אחד (מיד – לפני שמירה). תוצאה ישנה (שהטלפון השתנה אחריה) נזרקת.
async function check(D,l){const S=CS(D),ph=lnPhone(D,l);delete S.ok[l.k];if(!ph){delete S.hits[l.k];paintHit(D,l);return}
 const my=l.seq=(l.seq||0)+1;S.hits[l.k]='wait';paintHit(D,l);const ln={phone:ph};const z=lnTz(D,l);if(z&&tzOk(z))ln.tz=z;if(l.plan)ln.plan=l.plan;
 try{const r=await fnCall('checkLines',{lines:[ln]});if(O.draft!==D||my!==l.seq)return;S.hits[l.k]=(r&&r.hits||[]).filter(h=>h.i===0)}
 catch(e){if(my!==l.seq)return;S.hits[l.k]=[];err(e)}if(O.draft===D)paintHit(D,l)}
const checkAll=D=>CS(D).lines.forEach(l=>check(D,l));

CHG.olOn=el=>{const D=O.draft;if(!D)return;const S=CS(D);S.on=el.checked;if(S.on&&!S.lines.length)S.lines.push(lnNew(true));repaint();if(S.on){lload();checkAll(D)}};
ACT.olAdd=()=>{const D=O.draft;if(!D)return;const S=CS(D);if(S.lines.length>=20)return toast('עד 20 קווים');S.lines.push(lnNew(false));repaint()};
ACT.olRm=el=>{const[D,l]=lnOf(el);if(!l)return;const S=CS(D);S.lines=S.lines.filter(x=>x!==l);delete S.hits[l.k];delete S.ok[l.k];repaint()};
ACT.olDel=ACT.olRm;
ACT.olOk=el=>{const[D,l]=lnOf(el);if(!l)return;CS(D).ok[l.k]=1;paintHit(D,l)};
CHG.olSame=el=>{const[D,l]=lnOf(el);if(!l)return;l.same=el.checked;repaint();check(D,l)};
CHG.olSameTz=el=>{const[D,l]=lnOf(el);if(!l)return;l.sameTz=el.checked;repaint()};
CHG.olSel=el=>{const[D,l]=lnOf(el);if(!l)return;l[el.dataset.f]=el.value;if(el.dataset.f==='plan')check(D,l)};
CHG.olAd=el=>{const D=O.draft;if(D)CS(D).ad=el.value};
INP.olF=el=>{const[D,l]=lnOf(el);if(!l)return;l[el.dataset.f]=el.value;if(el.dataset.f==='phone'){if(phN(l.phone))check(D,l);else{delete CS(D).hits[l.k];paintHit(D,l)}}};
INP.olB=el=>{const D=O.draft;if(!D)return;const S=CS(D);if(el.dataset.f==='ctz')S.ctz=el.value;else S.bank[el.dataset.f]=el.value};
// טלפון הלקוח השתנה → קווים עם "הטלפון של הלקוח" נבדקים שוב
{const f=INP.oxD;if(f)INP.oxD=el=>{f(el);const D=O.draft;if(D&&cell()&&D.cell&&D.cell.on&&el.dataset.k==='phone'&&phN(D.phone))D.cell.lines.filter(l=>l.same).forEach(l=>check(D,l))}}

// בונה את cell לשרת. זורק שגיאה בעברית אם חסר / לא תקין / יש התראה שלא נענתה.
function out(D){const S=CS(D);if(!S.on)return undefined;const o={lines:[]};
 for(const l of S.lines){const ph=lnPhone(D,l);if(!ph)throw new Error(l.same?'חסר טלפון לקוח לקו לניוד':'טלפון לניוד לא תקין');
  const r=l.same?{same:true}:{phone:ph};if(l.sameTz){if(!tzN(D.tz))throw new Error('אין ת.ז ללקוח – הקלידו ת.ז לקו');r.sameTz=true}else if(dig(l.tz)){const z=tzN(l.tz);if(!z||!tzOk(z))throw new Error('ת.ז לניוד לא תקינה');r.tz=z}
  if(l.plan)r.plan=l.plan;if(l.carrier)r.carrier=l.carrier;
  const h=S.hits[l.k];if(h==='wait')throw new Error('עוד בודק ניודים קודמים – נסו שוב בעוד רגע');if(Array.isArray(h)&&h.length){if(!S.ok[l.k])throw new Error('יש קו שכבר נויד – בחרו "המשך בכל זאת" או "בטל ניוד לקו"');o.ack=true}
  o.lines.push(r)}
 if(S.ad)o.ad=S.ad;
 const b=S.bank,bb=[b.bank,b.br,b.acct].map(x=>String(x||'').trim());if(bb.some(Boolean)){if(!/^\d{2,3}$/.test(bb[0]))throw new Error('מספר בנק: 2–3 ספרות');if(!/^\d{3,4}$/.test(bb[1]))throw new Error('מספר סניף: 3–4 ספרות');if(!/^\d{4,12}$/.test(bb[2]))throw new Error('מספר חשבון: 4–12 ספרות');o.bank={bank:bb[0],br:bb[1],acct:bb[2]}}
 if(dig(S.ctz)){const z=tzN(S.ctz);if(!z||!tzOk(z))throw new Error('ת.ז בעל הכרטיס לא תקינה');o.ctz=z}
 return o}

{const nw=V.oxNew;if(nw)V.oxNew=()=>{const r=nw();if(!r||!r.h||!on()||!cell())return r;const D=O.draft;if(!D)return r;if(!L.P)lload();
  r.h=r.h.replace('<div class="sec"><h3>מוצרים</h3>',secH(D)+'<div class="sec"><h3>מוצרים</h3>');return r}}
{const sv=ACT.oxSave;if(sv)ACT.oxSave=async el=>{const D=O.draft;if(D)D.cellOut=undefined;if(D&&on()&&cell()&&D.cell&&D.cell.on){try{D.cellOut=out(D)}catch(e){return toast(e.message)}}return sv(el)}}

/* ---------- כרטיס הזמנה: פרטי הניוד (קריאה בלבד) ---------- */
{const vo=V.oxOrd;if(vo)V.oxOrd=id=>{const r=vo(id);if(!r||!r.h||!on()||!cell())return r;const o=(O.L||[]).find(x=>x.id===id),c=o&&o.cell;if(!c)return r;if(!L.P)lload();
  const ls=(c.lines||[]).map((l,i)=>`<p class="note" style="margin:2px 0">קו ${i+1}: <bdi dir="ltr">${esc(l.phone)}</bdi>${l.same?' (של הלקוח)':''}${l.tz?' · ת.ז '+esc(l.tz):''}${l.plan?' · '+esc((plan(l.plan)||{}).name||'תוכנית'):''}${l.carrier?' · '+esc(l.carrier):''}</p>`).join('');
  const h=`<div class="card"><b>ניוד קווים · ${c.n||0} קווים</b>${c.ack?' <span class="tag">אושר למרות ניוד קודם</span>':''}${ls}${c.ad?`<p class="note" style="margin:2px 0">פרסום: ${esc(c.ad)}</p>`:''}${c.bank?`<p class="note" style="margin:2px 0">בנק ${esc(c.bank.bank)} · סניף ${esc(c.bank.br)} · חשבון ${esc(c.bank.acct)}</p>`:''}${c.ctz?`<p class="note" style="margin:2px 0">ת.ז בעל הכרטיס ${esc(c.ctz)}</p>`:''}</div>`;
  r.h=r.h.replace('<div class="sec"><h3>פריטים</h3>',h+'<div class="sec"><h3>פריטים</h3>');return r}}

/* ---------- חבילות ניוד (מלאי: מנהל ועובד עם הרשאת הזמנות) + הגדרות ניוד (מנהל): הנחה קבועה, תקרה, מבצעים – 2026-11-09 ---------- */
const PAY={store:'לחנות',carrier:'לחברה'};
const nm=v=>{const t=String(v==null?'':v).trim().replace(',','.');return t===''?null:(/^\d+(\.\d{1,2})?$/.test(t)?+t:NaN)};
const dscT=d=>d&&typeof d.v==='number'?(d.t==='pct'?d.v+'%':ils(d.v)):'';
const feeT=(l,f)=>f&&typeof f.amt==='number'?`${l} ${ils(f.amt)} (${PAY[f.pay]||''})`:'';
const tpSel=(n,v)=>`<select name="${n}" aria-label="סוג"><option value="amt"${v!=='pct'?' selected':''}>₪ סכום</option><option value="pct"${v==='pct'?' selected':''}>% אחוז</option></select>`;
const paySel=(n,v)=>`<select name="${n}" aria-label="למי משלמים"><option value="store"${v!=='carrier'?' selected':''}>לחנות</option><option value="carrier"${v==='carrier'?' selected':''}>לחברה</option></select>`;
const ck=(n,on,t,v)=>`<label class="row" style="min-height:44px;gap:8px"><input type="checkbox" name="${n}"${v!=null?` value="${esc(v)}"`:''}${on?' checked':''}>${t}</label>`;
// מלאי: כפתור "חבילות ניוד" לכל מי שרואה את המלאי כשהסלולר פעיל
{const st=V.oxStock;if(st)V.oxStock=()=>{const r=st();if(on()&&cell()&&r&&r.h&&r.h.includes('data-a="oxNewP"')){if(!L.P)lload();r.h=r.h.replace(/(data-a="oxNewP">[^<]*<\/button><\/div>)/,`$1<button class="btn g s w" data-a="go" data-v="oxLines">חבילות ניוד${L.P?' ('+L.P.length+')':''}</button>`)}return r}}
{const ox=V.ox;if(ox)V.ox=()=>{const r=ox();if(on()&&cell()&&mgr()&&r&&r.h&&r.h.includes('data-v="oxNew"'))r.h=r.h.replace(/(<div class="row" style="margin-bottom:8px"><button class="btn grow" data-a="go" data-v="oxNew">[\s\S]*?<\/div>)/,'$1<button class="btn g s w" data-a="go" data-v="oxLines">חבילות ניוד והגדרות ניוד</button>');return r}}
V.oxLines=()=>{const T='חבילות ניוד';if(!on()||!cell())return{t:T,h:'<div class="empty">אין לך הרשאה למסך הזה</div>'};if(!L.P){lload();return{t:T,h:'<div class="empty">טוען…</div>'}}const M=mgr();
 const P=L.P.map(p=>{const x=[p.carrier?esc(p.carrier):'',typeof p.monthly==='number'?'חודשי '+ils(p.monthly):'',feeT('משלוח',p.ship),feeT('סים',p.sim),M?'התראה על ניוד חוזר: '+(Number.isInteger(p.days)?p.days:60)+' יום':''].filter(Boolean).join(' · ');
  return `<div class="li" style="cursor:default"><div class="m"><b>${esc(p.name)}${p.on===false?' <span class="tag">כבויה</span>':''}</b><small>${x}</small>${p.details?`<small>${esc(p.details)}</small>`:''}</div><button class="btn g s" data-a="olPE" data-id="${esc(p.id)}">עריכה</button></div>`}).join('')||'<div class="empty">אין חבילות עדיין</div>';
 return{t:T,s:'קטגוריה במלאי',h:`<button class="btn w" data-a="olPE" data-id="">${ico('plus')}חבילה חדשה</button>${M?'<button class="btn g s w" style="margin-top:8px" data-a="go" data-v="oxLnCfg">הנחות, תקרות ומבצעים</button>':''}${P}
 ${M?`<div class="sec"><h3>רשימות</h3></div><div class="card"><p class="note" style="margin:0">חברות ניוד: ${carriers().map(esc).join(', ')||'אין'}</p><p class="note" style="margin:4px 0 0">מקורות פרסום: ${ads().map(esc).join(', ')||'אין'}</p>
 <button class="btn g s w" style="margin-top:8px" data-a="olCfg">עריכת הרשימות</button></div>
 <p class="note">ניוד של אותו קו בתוך הטווח (בכל הסניפים) מקפיץ לעובד התראה בטופס ההזמנה. בלי חבילה – 60 יום.</p>`:''}`}};
const feeF=(l,k,f)=>`<div class="row"><label class="f grow"><span>${l} ₪ (ריק = אין)</span><input name="${k}" inputmode="decimal" maxlength="9" value="${f&&typeof f.amt==='number'?f.amt:''}" autocomplete="off"></label><label class="f grow"><span>משלמים</span>${paySel(k+'P',f&&f.pay)}</label></div>`;
ACT.olPE=el=>{const p=el.dataset.id?plan(el.dataset.id):null,M=mgr();dlg(`<h3>${p?'עריכת חבילה':'חבילה חדשה'}</h3><form data-f="olPF">${p?`<input type="hidden" name="id" value="${esc(p.id)}">`:''}${fld('שם החבילה','name',p?p.name:'','text','required maxlength="40"')}
 ${carriers().length?`<label class="f"><span>חברה</span><select name="carrier">${opts(carriers(),p&&p.carrier||'','בלי')}</select></label>`:'<p class="note">אין חברות ניוד ברשימה. המנהל מוסיף ב"עריכת הרשימות".</p>'}
 <label class="f"><span>פרטי התוכנית (רשות)</span><textarea name="details" rows="3" maxlength="300">${esc(p&&p.details||'')}</textarea></label>
 ${fld('עלות חודשית ללקוח ₪ (רשות)','monthly',p&&typeof p.monthly==='number'?p.monthly:'','text','inputmode="decimal" maxlength="9"')}
 ${feeF('משלוח','ship',p&&p.ship)}${feeF('סים','sim',p&&p.sim)}
 ${M?fld('טווח התראה על ניוד חוזר (ימים)','days',p&&Number.isInteger(p.days)?p.days:60,'text','required inputmode="numeric" maxlength="4"'):''}
 ${p?ck('off',p.on===false,'כבויה (לא מוצגת בהזמנה)'):''}
 <div class="row"><button class="btn grow">שמור</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`)};
FRM.olPF=async f=>{const x=fd(f),M=mgr();if(!x.name.trim())return toast('חסר שם');const d={name:x.name.trim(),carrier:x.carrier||'',details:String(x.details||'').trim()};
 if(M){const days=+dig(x.days);if(!(days>=1&&days<=3650))return toast('טווח: 1 עד 3650 ימים');d.days=days}
 const mo=nm(x.monthly);if(Number.isNaN(mo))return toast('עלות חודשית: מספר');d.monthly=mo==null?'':mo;
 for(const[k,l]of[['ship','משלוח'],['sim','סים']]){const v=nm(x[k]);if(Number.isNaN(v))return toast(l+': מספר');d[k]=v==null?null:{amt:v,pay:x[k+'P']==='carrier'?'carrier':'store'}}
 if(x.id){d.id=x.id;d.on=!x.off}
 const b=f.querySelector('button');b.disabled=true;try{await fnCall('saveLinePlan',d);closeDlg();toast('נשמר');await lload(true)}catch(e){b.disabled=false;err(e)}};
ACT.olCfg=()=>dlg(`<h3>רשימות לניוד</h3><form data-f="olCF"><label class="f"><span>חברות ניוד (שורה לכל חברה)</span><textarea name="c" rows="5" maxlength="1300">${esc(carriers().join('\n'))}</textarea></label>
 <label class="f"><span>מקורות פרסום (שורה לכל מקור)</span><textarea name="a" rows="5" maxlength="1300">${esc(ads().join('\n'))}</textarea></label><p class="note">עד 30 בכל רשימה, עד 40 תווים לשם.</p>
 <div class="row"><button class="btn grow">שמור</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`);
FRM.olCF=async f=>{const x=fd(f),sp=s=>[...new Set(String(s||'').split('\n').map(v=>v.trim()).filter(Boolean))];const c=sp(x.c),a=sp(x.a);if(c.length>30||a.length>30)return toast('עד 30 בכל רשימה');if(c.concat(a).some(v=>v.length>40))return toast('עד 40 תווים לשם');
 const b=f.querySelector('button');b.disabled=true;try{await fnCall('setCellCfg',{carriers:c,ads:a});closeDlg();toast('נשמר');await lload(true)}catch(e){b.disabled=false;err(e)}};

/* הגדרות ניוד – מנהל בלבד (השרת דוחה עובד: setCellCfg = manager-only) */
const cmap=k=>L.cfg&&L.cfg[k]&&typeof L.cfg[k]==='object'&&!Array.isArray(L.cfg[k])?L.cfg[k]:{};
const promos=()=>Array.isArray(L.cfg&&L.cfg.promos)?L.cfg.promos.filter(p=>p&&p.id):[];
const prT=p=>`${(p.carriers||[]).map(esc).join(', ')} · מ-${p.min} קווים · ${dscT(p.disc)} ${p.kind==='once'?'פעם אחת להזמנה':'לכל קו'} · ${p.stack==='replace'?'מחליף את ההנחה הקבועה':'מצטרף להנחה הקבועה'}${p.from||p.to?' · '+(p.from?'מ-'+dd(p.from):'')+(p.to?' עד '+dd(p.to):''):''}`;
const dv=(n,d,l,cap)=>`<div class="row"><label class="f grow"><span>${l}</span><input name="${n}" inputmode="decimal" maxlength="9" value="${d&&typeof d.v==='number'&&(cap||d.v>0)?d.v:''}" autocomplete="off"></label><label class="f grow"><span>סוג</span>${tpSel(n+'T',d&&d.t)}</label></div>`;
V.oxLnCfg=()=>{const T='הנחות, תקרות ומבצעים';if(!on()||!cell()||!mgr())return{t:T,h:'<div class="empty">אין לך הרשאה למסך הזה</div>'};if(!L.P){lload();return{t:T,h:'<div class="empty">טוען…</div>'}}
 const C=carriers(),D=cmap('disc'),K=cmap('cap');
 const cf=C.length?`<form data-f="olDF">${C.map((c,i)=>`<div class="card" style="margin:6px 0"><b>${esc(c)}</b>${dv('d'+i,D[c],'הנחה קבועה (ריק = בלי)')}${dv('k'+i,K[c],'תקרה להנחה ידנית לכל קו (ריק = בלי הגבלה)',1)}</div>`).join('')}
 <p class="note">ההנחה של העסק יורדת מסכום ההזמנה לחנות, עד 0. תקרה 0 = העובד לא נותן הנחה ידנית. התקרה לא מוצגת לעובד.</p><button class="btn w">שמור הנחות ותקרות</button></form>`:'<div class="empty">אין חברות ניוד. הוסיפו ב"עריכת הרשימות" במסך החבילות.</div>';
 const PR=promos().map(p=>`<div class="li" style="cursor:default"><div class="m"><b>${esc(p.name)}${p.on===false?' <span class="tag">כבוי</span>':''}</b><small>${prT(p)}</small></div><button class="btn g s" data-a="olPrE" data-id="${esc(p.id)}">עריכה</button></div>`).join('')||'<div class="empty">אין מבצעים</div>';
 return{t:T,s:'מנהל בלבד',h:`<div class="sec"><h3>הנחה קבועה ותקרה לכל חברה</h3></div>${cf}
 <div class="sec"><h3>מבצעים</h3></div>${C.length?`<button class="btn w" data-a="olPrE" data-id="">${ico('plus')}מבצע חדש</button>`:''}${PR}
 <p class="note">כשכמה מבצעים מתאימים להזמנה – חל רק המשתלם ביותר.</p>`}};
const rdD=(x,n,cap)=>{const v=nm(x[n]);if(v==null)return null;if(Number.isNaN(v))throw new Error('יש סכום לא תקין');const t=x[n+'T']==='pct'?'pct':'amt';if(t==='pct'&&v>100)throw new Error('אחוז: 0 עד 100');if(t==='amt'&&v>100000)throw new Error('סכום: עד 100,000');return !cap&&v===0?null:{t,v}};
FRM.olDF=async f=>{const x=fd(f),C=carriers(),disc={},cap={};try{C.forEach((c,i)=>{const d=rdD(x,'d'+i),k=rdD(x,'k'+i,1);if(d)disc[c]=d;if(k)cap[c]=k})}catch(e){return toast(e.message)}
 const b=f.querySelector('button');b.disabled=true;try{await fnCall('setCellCfg',{disc,cap});toast('נשמר');await lload(true)}catch(e){err(e)}finally{b.disabled=false}};
ACT.olPrE=el=>{const p=el.dataset.id?promos().find(x=>x.id===el.dataset.id):null,C=carriers(),pc=p&&p.carriers||[];
 dlg(`<h3>${p?'עריכת מבצע':'מבצע חדש'}</h3><form data-f="olPrF">${p?`<input type="hidden" name="id" value="${esc(p.id)}">`:''}${fld('שם המבצע','name',p?p.name:'','text','required maxlength="60"')}
 <fieldset style="border:0;padding:0;margin:0"><legend class="note">חברות משתתפות (הקווים לכולן נספרים יחד)</legend>${C.map((c,i)=>ck('c'+i,pc.includes(c),esc(c),c)).join('')}</fieldset>
 ${fld('מינימום קווים','min',p?p.min:2,'text','required inputmode="numeric" maxlength="2"')}
 ${dv('disc',p&&p.disc,'הנחת המבצע')}
 <label class="f"><span>איך ניתנת ההנחה</span><select name="kind"><option value="line"${!p||p.kind!=='once'?' selected':''}>לכל קו</option><option value="once"${p&&p.kind==='once'?' selected':''}>פעם אחת להזמנה (סכום בלבד)</option></select></label>
 <label class="f"><span>מול ההנחה הקבועה של החברה</span><select name="stack"><option value="add"${!p||p.stack!=='replace'?' selected':''}>מצטרף</option><option value="replace"${p&&p.stack==='replace'?' selected':''}>מחליף</option></select></label>
 <div class="row"><label class="f grow"><span>מתאריך (רשות)</span><input name="from" type="date" value="${esc(p&&p.from||'')}"></label><label class="f grow"><span>עד תאריך (רשות)</span><input name="to" type="date" value="${esc(p&&p.to||'')}"></label></div>
 ${ck('on',!p||p.on!==false,'פעיל')}
 <div class="row"><button class="btn grow">שמור</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`)};
FRM.olPrF=async f=>{const x=fd(f),C=carriers();const o={name:String(x.name||'').trim(),carriers:C.filter((c,i)=>x['c'+i]!=null),min:+dig(x.min),kind:x.kind==='once'?'once':'line',stack:x.stack==='replace'?'replace':'add',on:!!x.on};
 if(!o.name)return toast('חסר שם');if(!o.carriers.length)return toast('בחרו חברה אחת לפחות');if(!(o.min>=1&&o.min<=20))return toast('מינימום קווים: 1 עד 20');
 try{o.disc=rdD(x,'disc')}catch(e){return toast(e.message)}if(!o.disc)return toast('חסרה הנחה');if(o.kind==='once'&&o.disc.t==='pct')return toast('מבצע פעם אחת להזמנה – הנחה בסכום בלבד');
 if(x.from)o.from=x.from;if(x.to)o.to=x.to;if(o.from&&o.to&&o.from>o.to)return toast('תאריך ההתחלה אחרי הסיום');
 if(x.id)o.id=x.id;const all=promos().map(p=>Object.fromEntries(['id','name','carriers','min','kind','disc','stack','on','from','to'].filter(k=>p[k]!=null).map(k=>[k,p[k]])));
 const i=all.findIndex(p=>p.id===o.id);if(i>=0)all[i]=o;else all.push(o);
 const b=f.querySelector('button');b.disabled=true;try{await fnCall('setCellCfg',{promos:all});closeDlg();toast('נשמר');await lload(true)}catch(e){b.disabled=false;err(e)}};

window.__ol={L,out,CS};
})();
