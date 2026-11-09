/* ORD:LINES – ניוד קווים בהזמנה (ענף fb/ord-lines; החלטות 00:59, 01:00, 01:45, 07:35, 07:38). קובץ עצמאי, נטען אחרי orders-cust.js.
   רק כשמנהל־העל הפעיל את cellular בעסק. כבוי = הקובץ לא מוסיף דבר לשום מסך.
   - הזמנה חדשה: "הלקוח רוצה ניוד" → קווים (טלפון / "הטלפון של הלקוח", ת"ז / "הת"ז של הלקוח", תוכנית, חברה), מאיזה פרסום הגיעו,
     פרטי בנק (בנק/סניף/חשבון) ות"ז בעל הכרטיס. כמות הקווים – אוטומטי.
   - התראה לעובד (01:45): מיד כשמסמנים ניוד ובכל שינוי טלפון – checkLines בשרת (כל סניפי העסק, בטווח של התוכנית; ברירת מחדל 60 יום).
     ניוד קודם → "קו זה כבר נויד בתאריך … בסניף …" עם "המשך בכל זאת" / "בטל ניוד לקו". אי אפשר לשמור לפני שבוחרים.
   - חבילות ניוד (קטגוריה במלאי): מנהל ועובד עם הרשאת הזמנות, כולל טווח התראה ומבצע לחבילה (פישוט 9.11 22:35). מנהל: רשימות.
   כל כתיבה – דרך השרת (orders.js: createOrder.cell, saveLinePlan, setCellCfg, checkLines). קריאה – lineplan, ordcfg/cell לפי החוקים. */
(function(){
'use strict';
if(typeof ACT==='undefined'||typeof V==='undefined'||!window.__ox)return;
const fnCall=(n,d)=>{d=d&&typeof d==='object'?d:{};if(SY&&SY.sa&&SY.bizId&&!('bizId'in d))d=Object.assign({bizId:SY.bizId},d);return window.fnCall(n,d)}; // 2026-11-09 (Dפון): מנהל־על שנכנס לעסק – הפונקציות רצות בעסק שנבחר ולא בעסק הבית שלו
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
const lineH=(D,l,i)=>{const P=plans(),C=carriers(),pk=l.plan&&plan(l.plan);return `<div class="card" style="margin:6px 0" data-ol="${esc(l.k)}"><b>קו ${i+1}</b>
 <label class="row" style="min-height:44px;gap:8px"><input type="checkbox" data-c="olSame" data-k="${esc(l.k)}"${l.same?' checked':''}>הטלפון של הלקוח${l.same&&phN(D.phone)?' (<bdi dir="ltr">'+esc(phN(D.phone))+'</bdi>)':''}</label>
 ${l.same?'':`<label class="f"><span>טלפון לניוד</span><input data-i="olF" data-f="phone" data-k="${esc(l.k)}" type="tel" inputmode="tel" dir="ltr" value="${esc(l.phone)}" autocomplete="off"></label>`}
 <label class="row" style="min-height:44px;gap:8px"><input type="checkbox" data-c="olSameTz" data-k="${esc(l.k)}"${l.sameTz?' checked':''}>הת.ז של הלקוח</label>
 ${l.sameTz?'':`<label class="f"><span>ת.ז לניוד</span><input data-i="olF" data-f="tz" data-k="${esc(l.k)}" inputmode="numeric" maxlength="9" value="${esc(l.tz)}" autocomplete="off"></label>`}
 ${P.length?`<label class="f"><span>חבילה</span><select data-c="olSel" data-f="plan" data-k="${esc(l.k)}"><option value="">בלי חבילה</option>${P.map(p=>`<option value="${esc(p.id)}"${l.plan===p.id?' selected':''}>${esc(pkOpt(p))}</option>`).join('')}</select></label>`:''}
 ${pk?pkH(pk):''}${prSel(l,pk)}${giftSel(l)}
 ${C.length&&!(pk&&pk.carrier)?`<label class="f"><span>חברת ניוד</span><select data-c="olSel" data-f="carrier" data-k="${esc(l.k)}">${opts(C,l.carrier,'בחר')}</select></label>`:''}
 <div data-olh="${esc(l.k)}">${hitH(D,l)}</div><button type="button" class="btn g s" data-a="olRm" data-k="${esc(l.k)}">הסר קו</button></div>`};
/* ---------- חבילה לכל קו, הנחות ומבצעים בטופס (שלב 4, 2026-11-09). החישוב – אותה פונקציה של השרת (line-discount.js, window.LineDisc) ---------- */
const PAY0={store:'לחנות',carrier:'לחברה'};
const pkFee=(l,f)=>f&&typeof f.amt==='number'&&f.amt>0?`${l} ${ils(f.amt)} – ${f.pay==='carrier'?'משלמים לחברה':'משלמים לחנות'}`:'';
const pkOpt=p=>[p.name,p.carrier||'',typeof p.monthly==='number'?ils(p.monthly)+' לחודש':''].filter(Boolean).join(' · ');
const pkH=p=>{const x=[p.carrier?'חברה: '+esc(p.carrier):'',typeof p.monthly==='number'?'עלות חודשית: '+ils(p.monthly)+' (משלמים לחברה)':'',pkFee('משלוח',p.ship),pkFee('סים',p.sim)].filter(Boolean);
 return `<div class="note" data-olpk role="note" style="margin:0 0 6px;padding:8px;border:1px solid var(--line,rgba(127,127,127,.35));border-radius:8px">${x.map(t=>`<div>${t}</div>`).join('')}${p.details?`<div>${esc(p.details)}</div>`:''}</div>`};
const PKG=['monthly','ship','sim','details','promo','promos'];
const isPkg=p=>!!p&&PKG.some(k=>p[k]!=null); // כמו בשרת (cellTotal): חבילה "חדשה" = יש לה אחד מהשדות
const itemsAg=D=>(D.items||[]).reduce((s,it)=>s+Math.round((+String(it.qty).replace(',','.')||0)*(+String(it.price).replace(',','.')||0)*100),0);
/* כמה מבצעים לחבילה (23:52): רשימה (מבנה ישן promo = רשימה עם פריט אחד). לכל קו העובד בוחר מבצע או "בלי מבצע"; ברירת מחדל – הראשון הפעיל.
   l.pr = אינדקס ברשימה או -1. אותה בחירה בשרת: LineDisc.pick */
const prs=p=>window.LineDisc?LineDisc.promosOf(p):[];
const lnPr=l=>{const p=l.plan&&plan(l.plan);return p&&window.LineDisc?LineDisc.pick(p,Number.isInteger(l.pr)?l.pr:undefined,LineDisc.ilDay()):null};
const prSel=(l,p)=>{if(!p)return '';const t=LineDisc.ilDay(),A=prs(p).map((r,i)=>[r,i]).filter(([r])=>LineDisc.live(r,t));if(!A.length)return '';const k=lnPr(l);const cur=k?k.i:-1;
 return `<label class="f"><span>מבצע</span><select data-c="olPr" data-k="${esc(l.k)}">${A.map(([r,i])=>`<option value="${i}"${cur===i?' selected':''}>${esc(prTxt(r))}</option>`).join('')}<option value="-1"${cur===-1?' selected':''}>בלי מבצע</option></select></label>`};
/* מתנות (פישוט 9.11; 23:50): שורת מוצר רגילה במחיר המלא של המוצר (יורדת מהמלאי, עלות לפי המוצר), מסומנת gk = מפתח הקו. אחת – נוספת לבד; כמה – העובד בוחר.
   ההפרש (מלא פחות מחיר המבצע) נכנס ל"סה"כ הנחה" – line-discount.js, אותו חישוב כמו בשרת (הקו נשלח עם gift) */
const fullP=(pid,br)=>{const p=(O.P||[]).find(x=>x.id===pid);const v=p&&p.bp&&typeof p.bp==='object'?p.bp[br]:undefined;return typeof v==='number'?v:(+(p&&p.price)||0)}; // כמו unitP ב-orders-staff.js
const gifts=l=>{const k=lnPr(l);return k&&Array.isArray(k.pr.gifts)?k.pr.gifts.filter(g=>O.P&&(O.P||[]).some(x=>x.id===g.pid)):[]};
const gName=g=>{const x=(O.P||[]).find(p=>p.id===g.pid);return (x?x.name:'מוצר')+' · '+(g.price?ils(g.price):'מתנה')};
const giftSel=l=>{const G=gifts(l);if(G.length<2)return '';return `<label class="f"><span>בחירת מתנה</span><select data-c="olGift" data-k="${esc(l.k)}"><option value="">בלי מתנה</option>${G.map(g=>`<option value="${esc(g.pid)}"${l.gift===g.pid?' selected':''}>${esc(gName(g))}</option>`).join('')}</select></label>`};
function giftSync(D,l){D.items=(D.items||[]).filter(it=>it.gk!==l.k);const G=gifts(l);if(G.length===1)l.gift=G[0].pid;else if(!G.some(g=>g.pid===l.gift))l.gift='';
 const g=G.find(x=>x.pid===l.gift);if(g)D.items.push({pid:g.pid,qty:'1',price:String(fullP(g.pid,D.br)),auto:1,from:'',gk:l.k})}
const giftDrop=(D,k)=>{D.items=(D.items||[]).filter(it=>it.gk!==k)};
// "סה"כ הנחה" (פישוט 9.11): משבצת אחת. S.man = null (המוצע) או מה שהעובד הזין (גם 0, גם למעלה)
function calcOf(D){const S=CS(D);if(!S.on||!window.LineDisc)return null;const pm=new Map((L.P||[]).map(p=>[p.id,p]));
 if(!S.lines.some(l=>isPkg(l.plan&&pm.get(l.plan))))return null;
 const lines=S.lines.map(l=>{const o={};if(l.plan)o.plan=l.plan;if(l.carrier)o.carrier=l.carrier;if(l.plan&&Number.isInteger(l.pr))o.pr=l.pr;if(l.gift&&l.plan)o.gift=l.gift;return o});
 return LineDisc.calcCell(lines,pm,Number.isFinite(S.man)?S.man:null,{itemsAg:itemsAg(D),today:LineDisc.ilDay(),items:D.items||[]})}
const sugT=r=>r.man!=null&&r.man!==r.sug?`מחושב לפי המבצעים: ${ils(r.sug)}`:'';
function calcH(D){const r=calcOf(D);if(!r)return '';const S=CS(D);const v=S.man==null?r.sug:S.manRaw;
 return `<label class="f" style="margin:0"><span><b>סה״כ הנחה ₪</b> (0 = בלי הנחה)</span><input id="olman" data-i="olMan" inputmode="decimal" maxlength="9" value="${esc(v)}" autocomplete="off"></label>
 <p class="note" id="olsug" style="margin:2px 0">${sugT(r)}</p>${r.ext?`<p class="note" style="margin:2px 0">משלמים ישירות לחברה (לא בסכום כאן): ${ils(r.ext)}</p>`:''}${r.monthly?`<p class="note" style="margin:2px 0">עלות חודשית מהחברה: ${ils(r.monthly)}</p>`:''}
 ${r.hint?`<p class="note" role="status" id="olhint" style="margin:4px 0 0;color:var(--gold,inherit)"><b>המלצה:</b> ${esc(r.hint.msg)}</p>`:''}`}
const totSet=r=>{const t=document.getElementById('oxtot');if(t&&r)t.textContent=ils(r.net)};
// מצייר את משבצת ההנחה ואת הסה"כ (מעל הסה"כ של הפריטים מ-orders-staff.js). לא מצייר מחדש בזמן הקלדה במשבצת
function paintCalc(){const D=O.draft;if(!D||!cell())return;const r=calcOf(D),b=document.getElementById('olcalc');
 if(b){if(document.activeElement&&document.activeElement.id==='olman'&&r){const s=document.getElementById('olsug');if(s)s.textContent=sugT(r)}else{const h=calcH(D);b.innerHTML=h;b.hidden=!h}}totSet(r)}
const boxH=D=>{const S=CS(D);if(!S.on)return '';const A=ads();
 return `${S.lines.map((l,i)=>lineH(D,l,i)).join('')}<button type="button" class="btn g s w" data-a="olAdd">＋ קו נוסף לניוד</button>
 <p class="note">כמות קווים: <b id="oln">${S.lines.length}</b></p>
 ${A.length?`<label class="f"><span>מאיזה פרסום הגיעו</span><select data-c="olAd">${opts(A,S.ad,'לא ידוע')}</select></label>`:''}
 <details${S.bank.bank||S.bank.br||S.bank.acct||S.ctz?' open':''}><summary class="note" style="min-height:44px;display:flex;align-items:center">פרטי בנק ות.ז בעל הכרטיס (רשות)</summary>
 <div class="row"><label class="f grow"><span>בנק</span><input data-i="olB" data-f="bank" inputmode="numeric" maxlength="3" value="${esc(S.bank.bank)}" autocomplete="off"></label><label class="f grow"><span>סניף</span><input data-i="olB" data-f="br" inputmode="numeric" maxlength="4" value="${esc(S.bank.br)}" autocomplete="off"></label></div>
 <label class="f"><span>מספר חשבון</span><input data-i="olB" data-f="acct" inputmode="numeric" maxlength="12" value="${esc(S.bank.acct)}" autocomplete="off"></label>
 <label class="f"><span>ת.ז בעל הכרטיס</span><input data-i="olB" data-f="ctz" inputmode="numeric" maxlength="9" value="${esc(S.ctz)}" autocomplete="off"></label></details>`};
const secH=D=>{const S=CS(D);return `<div class="sec"><h3>ניוד קווים</h3></div><div class="card" id="olbox"><label class="row" style="min-height:44px;gap:8px"><input type="checkbox" data-c="olOn"${S.on?' checked':''}><b>הלקוח רוצה ניוד</b></label><div id="olin">${boxH(D)}</div></div>`};
const repaint=()=>{const D=O.draft,b=document.getElementById('olin');if(D&&b)b.innerHTML=boxH(D);paintCalc()};
// שינוי שמוסיף/מסיר שורת מתנה – מצייר את כל הטופס (גם רשימת המוצרים)
const repaintAll=()=>{if(typeof rerender==='function')rerender();else repaint()};
const paintHit=(D,l)=>{const b=document.querySelector(`[data-olh="${l.k}"]`);if(b)b.innerHTML=hitH(D,l)};
const lnOf=el=>{const D=O.draft;if(!D)return [null,null];const l=CS(D).lines.find(x=>x.k===el.dataset.k);return [D,l]};

// בדיקת ניוד חוזר לקו אחד (מיד – לפני שמירה). תוצאה ישנה (שהטלפון השתנה אחריה) נזרקת.
async function check(D,l){const S=CS(D),ph=lnPhone(D,l);delete S.ok[l.k];if(!ph){delete S.hits[l.k];paintHit(D,l);return}
 const my=l.seq=(l.seq||0)+1;S.hits[l.k]='wait';paintHit(D,l);const ln={phone:ph};const z=lnTz(D,l);if(z&&tzOk(z))ln.tz=z;if(l.plan)ln.plan=l.plan;
 try{const r=await fnCall('checkLines',{lines:[ln]});if(O.draft!==D||my!==l.seq)return;S.hits[l.k]=(r&&r.hits||[]).filter(h=>h.i===0)}
 catch(e){if(my!==l.seq)return;S.hits[l.k]=[];err(e)}if(O.draft===D)paintHit(D,l)}
const checkAll=D=>CS(D).lines.forEach(l=>check(D,l));

CHG.olOn=el=>{const D=O.draft;if(!D)return;const S=CS(D);S.on=el.checked;if(S.on&&!S.lines.length)S.lines.push(lnNew(true));if(!S.on){S.lines.forEach(l=>giftDrop(D,l.k));repaintAll()}else repaint();if(S.on){lload();checkAll(D)}};
ACT.olAdd=()=>{const D=O.draft;if(!D)return;const S=CS(D);if(S.lines.length>=20)return toast('עד 20 קווים');S.lines.push(lnNew(false));repaint()};
ACT.olRm=el=>{const[D,l]=lnOf(el);if(!l)return;const S=CS(D);S.lines=S.lines.filter(x=>x!==l);delete S.hits[l.k];delete S.ok[l.k];const g=D.items.some(it=>it.gk===l.k);giftDrop(D,l.k);if(g)repaintAll();else repaint()};
ACT.olDel=ACT.olRm;
ACT.olOk=el=>{const[D,l]=lnOf(el);if(!l)return;CS(D).ok[l.k]=1;paintHit(D,l)};
CHG.olSame=el=>{const[D,l]=lnOf(el);if(!l)return;l.same=el.checked;repaint();check(D,l)};
CHG.olSameTz=el=>{const[D,l]=lnOf(el);if(!l)return;l.sameTz=el.checked;repaint()};
CHG.olSel=el=>{const[D,l]=lnOf(el);if(!l)return;l[el.dataset.f]=el.value;if(el.dataset.f==='plan'){const p=plan(l.plan);if(p&&p.carrier)l.carrier=p.carrier;delete l.pr;l.gift='';const had=D.items.some(it=>it.gk===l.k);giftSync(D,l);if(had||D.items.some(it=>it.gk===l.k))repaintAll();else repaint();check(D,l)}else paintCalc()};
CHG.olPr=el=>{const[D,l]=lnOf(el);if(!l)return;l.pr=+el.value;l.gift='';giftSync(D,l);repaintAll()};
CHG.olGift=el=>{const[D,l]=lnOf(el);if(!l)return;l.gift=el.value;giftSync(D,l);repaintAll()};
INP.olMan=el=>{const D=O.draft;if(!D)return;const S=CS(D),t=String(el.value).trim().replace(',','.');S.manRaw=el.value;
 if(t===''){S.man=null}else if(/^\d+(\.\d{1,2})?$/.test(t)&&+t<=100000)S.man=+t;else{S.man=NaN}paintCalc()};
CHG.olAd=el=>{const D=O.draft;if(D)CS(D).ad=el.value};
INP.olF=el=>{const[D,l]=lnOf(el);if(!l)return;l[el.dataset.f]=el.value;if(el.dataset.f==='phone'){if(phN(l.phone))check(D,l);else{delete CS(D).hits[l.k];paintHit(D,l)}}};
INP.olB=el=>{const D=O.draft;if(!D)return;const S=CS(D);if(el.dataset.f==='ctz')S.ctz=el.value;else S.bank[el.dataset.f]=el.value};
// שינוי כמות/מחיר/סניף בפריטים → הסכום וההנחה מחושבים מחדש (orders-staff.js מצייר את סה"כ הפריטים, ואנחנו אחריו)
{const f=INP.oxLn;if(f)INP.oxLn=el=>{f(el);paintCalc()}}
// טלפון הלקוח השתנה → קווים עם "הטלפון של הלקוח" נבדקים שוב
{const f=INP.oxD;if(f)INP.oxD=el=>{f(el);paintCalc();const D=O.draft;if(D&&cell()&&D.cell&&D.cell.on&&el.dataset.k==='phone'&&phN(D.phone))D.cell.lines.filter(l=>l.same).forEach(l=>check(D,l))}}

// בונה את cell לשרת. זורק שגיאה בעברית אם חסר / לא תקין / יש התראה שלא נענתה.
function out(D){const S=CS(D);if(!S.on)return undefined;const o={lines:[]};
 for(const l of S.lines){const ph=lnPhone(D,l);if(!ph)throw new Error(l.same?'חסר טלפון לקוח לקו לניוד':'טלפון לניוד לא תקין');
  const r=l.same?{same:true}:{phone:ph};if(l.sameTz){if(!tzN(D.tz))throw new Error('אין ת.ז ללקוח – הקלידו ת.ז לקו');r.sameTz=true}else if(dig(l.tz)){const z=tzN(l.tz);if(!z||!tzOk(z))throw new Error('ת.ז לניוד לא תקינה');r.tz=z}
  if(l.plan)r.plan=l.plan;if(l.carrier)r.carrier=l.carrier;if(l.plan&&Number.isInteger(l.pr))r.pr=l.pr;if(l.plan&&l.gift&&gifts(l).some(g=>g.pid===l.gift))r.gift=l.gift;
  const h=S.hits[l.k];if(h==='wait')throw new Error('עוד בודק ניודים קודמים – נסו שוב בעוד רגע');if(Array.isArray(h)&&h.length){if(!S.ok[l.k])throw new Error('יש קו שכבר נויד – בחרו "המשך בכל זאת" או "בטל ניוד לקו"');o.ack=true}
  o.lines.push(r)}
 if(S.ad)o.ad=S.ad;
 const b=S.bank,bb=[b.bank,b.br,b.acct].map(x=>String(x||'').trim());if(bb.some(Boolean)){if(!/^\d{2,3}$/.test(bb[0]))throw new Error('מספר בנק: 2–3 ספרות');if(!/^\d{3,4}$/.test(bb[1]))throw new Error('מספר סניף: 3–4 ספרות');if(!/^\d{4,12}$/.test(bb[2]))throw new Error('מספר חשבון: 4–12 ספרות');o.bank={bank:bb[0],br:bb[1],acct:bb[2]}}
 if(dig(S.ctz)){const z=tzN(S.ctz);if(!z||!tzOk(z))throw new Error('ת.ז בעל הכרטיס לא תקינה');o.ctz=z}
 if(Number.isNaN(S.man))throw new Error('סה״כ הנחה: מספר (0 = בלי הנחה)');const c=calcOf(D);if(c)o.man=S.man==null?c.sug:S.man; // נשמר מה שהעובד ראה/הזין
 return o}

{const nw=V.oxNew;if(nw)V.oxNew=()=>{const r=nw();if(!r||!r.h||!on()||!cell())return r;const D=O.draft;if(!D)return r;if(!L.P)lload();
  r.h=r.h.replace('<div class="sec"><h3>מוצרים</h3>',secH(D)+'<div class="sec"><h3>מוצרים</h3>');
  const c=calcOf(D);r.h=r.h.replace('<div class="card" style="margin:10px 0"><div class="row" style="justify-content:space-between"><b>סה״כ</b>',`<div class="card" id="olcalc" style="margin:10px 0"${c?'':' hidden'}>${calcH(D)}</div><div class="card" style="margin:10px 0"><div class="row" style="justify-content:space-between"><b>סה״כ</b>`);
  if(c)r.h=r.h.replace(/(<b class="amt" id="oxtot">)[^<]*(<\/b>)/,'$1'+ils(c.net)+'$2');return r}}
{const sv=ACT.oxSave;if(sv)ACT.oxSave=async el=>{const D=O.draft;if(D)D.cellOut=undefined;if(D&&on()&&cell()&&D.cell&&D.cell.on){try{D.cellOut=out(D)}catch(e){paintCalc();return toast(e.message)}}return sv(el)}}

/* ---------- כרטיס הזמנה: פרטי הניוד (קריאה בלבד) ---------- */
{const vo=V.oxOrd;if(vo)V.oxOrd=id=>{const r=vo(id);if(!r||!r.h||!on()||!cell())return r;const o=(O.L||[]).find(x=>x.id===id),c=o&&o.cell;if(!c)return r;if(!L.P)lload();
  const ls=(c.lines||[]).map((l,i)=>`<p class="note" style="margin:2px 0">קו ${i+1}: <bdi dir="ltr">${esc(l.phone)}</bdi>${l.same?' (של הלקוח)':''}${l.tz?' · ת.ז '+esc(l.tz):''}${l.plan?' · '+esc((plan(l.plan)||{}).name||'חבילה'):''}${l.carrier?' · '+esc(l.carrier):''}</p>`).join('');
  const h=`<div class="card"><b>ניוד קווים · ${c.n||0} קווים</b>${c.ack?' <span class="tag">אושר למרות ניוד קודם</span>':''}${ls}${c.ad?`<p class="note" style="margin:2px 0">פרסום: ${esc(c.ad)}</p>`:''}${c.bank?`<p class="note" style="margin:2px 0">בנק ${esc(c.bank.bank)} · סניף ${esc(c.bank.br)} · חשבון ${esc(c.bank.acct)}</p>`:''}${c.ctz?`<p class="note" style="margin:2px 0">ת.ז בעל הכרטיס ${esc(c.ctz)}</p>`:''}${c.calc&&c.calc.disc?`<p style="margin:4px 0 0"><b>הנחה: ${ils(c.calc.disc)}</b></p>`:''}</div>`;
  r.h=r.h.replace('<div class="sec"><h3>פריטים</h3>',h+'<div class="sec"><h3>פריטים</h3>');return r}}

/* ---------- חבילות ניוד (מלאי: מנהל ועובד עם הרשאת הזמנות), כולל מבצע לחבילה (פישוט 9.11 22:35) ---------- */
const PAY={store:'לחנות',carrier:'לחברה'};
const nm=v=>{const t=String(v==null?'':v).trim().replace(',','.');return t===''?null:(/^\d+(\.\d{1,2})?$/.test(t)?+t:NaN)};
const feeT=(l,f)=>f&&typeof f.amt==='number'?`${l} ${ils(f.amt)} (${PAY[f.pay]||''})`:'';
const paySel=(n,v)=>`<select name="${n}" aria-label="למי משלמים"><option value="store"${v!=='carrier'?' selected':''}>לחנות</option><option value="carrier"${v==='carrier'?' selected':''}>לחברה</option></select>`;
const ck=(n,on,t,v)=>`<label class="row" style="min-height:44px;gap:8px"><input type="checkbox" name="${n}"${v!=null?` value="${esc(v)}"`:''}${on?' checked':''}>${t}</label>`;
// מלאי: כפתור "חבילות ניוד" לכל מי שרואה את המלאי כשהסלולר פעיל
{const st=V.oxStock;if(st)V.oxStock=()=>{const r=st();if(on()&&cell()&&r&&r.h&&r.h.includes('data-a="oxNewP"')){if(!L.P)lload();r.h=r.h.replace(/(data-a="oxNewP">[^<]*<\/button><\/div>)/,`$1<button class="btn g s w" data-a="go" data-v="oxLines">חבילות ניוד${L.P?' ('+L.P.length+')':''}</button>`)}return r}}
{const ox=V.ox;if(ox)V.ox=()=>{const r=ox();if(on()&&cell()&&mgr()&&r&&r.h&&r.h.includes('data-v="oxNew"'))r.h=r.h.replace(/(<div class="row" style="margin-bottom:8px"><button class="btn grow" data-a="go" data-v="oxNew">[\s\S]*?<\/div>)/,'$1<button class="btn g s w" data-a="go" data-v="oxLines">חבילות ניוד</button>');return r}}
V.oxLines=()=>{const T='חבילות ניוד';if(!on()||!cell())return{t:T,h:'<div class="empty">אין לך הרשאה למסך הזה</div>'};if(!L.P){lload();return{t:T,h:'<div class="empty">טוען…</div>'}}const M=mgr();
 const P=L.P.map(p=>{const x=[p.carrier?esc(p.carrier):'',typeof p.monthly==='number'?'חודשי '+ils(p.monthly):'',feeT('משלוח',p.ship),feeT('סים',p.sim),'התראה על ניוד חוזר: '+(Number.isInteger(p.days)?p.days:60)+' יום'].filter(Boolean).join(' · ');
  return `<div class="li" style="cursor:default"><div class="m"><b>${esc(p.name)}${p.on===false?' <span class="tag">כבויה</span>':''}</b><small>${x}</small>${p.details?`<small>${esc(p.details)}</small>`:''}${prT(p)?`<small class="tag" style="white-space:normal">מבצע: ${prT(p)}</small>`:''}</div><button class="btn g s" data-a="olPE" data-id="${esc(p.id)}">עריכה</button></div>`}).join('')||'<div class="empty">אין חבילות עדיין</div>';
 return{t:T,s:'קטגוריה במלאי',h:`<button class="btn w" data-a="olPE" data-id="">${ico('plus')}חבילה חדשה</button>${P}
 ${M?`<div class="sec"><h3>רשימות</h3></div><div class="card"><p class="note" style="margin:0">חברות ניוד: ${carriers().map(esc).join(', ')||'אין'}</p><p class="note" style="margin:4px 0 0">מקורות פרסום: ${ads().map(esc).join(', ')||'אין'}</p>
 <button class="btn g s w" style="margin-top:8px" data-a="olCfg">עריכת הרשימות</button></div>
 <p class="note">ניוד של אותו קו בתוך הטווח (בכל הסניפים) מקפיץ לעובד התראה בטופס ההזמנה. בלי חבילה – 60 יום.</p>`:''}`}};
const feeF=(l,k,f)=>`<div class="row"><label class="f grow"><span>${l} ₪ (ריק = אין)</span><input name="${k}" inputmode="decimal" maxlength="9" value="${f&&typeof f.amt==='number'?f.amt:''}" autocomplete="off"></label><label class="f grow"><span>משלמים</span>${paySel(k+'P',f&&f.pay)}</label></div>`;
ACT.olPE=el=>{const p=el.dataset.id?plan(el.dataset.id):null,M=mgr();dlg(`<h3>${p?'עריכת חבילה':'חבילה חדשה'}</h3><form data-f="olPF">${p?`<input type="hidden" name="id" value="${esc(p.id)}">`:''}${fld('שם החבילה','name',p?p.name:'','text','required maxlength="40"')}
 ${carriers().length?`<label class="f"><span>חברה</span><select name="carrier">${opts(carriers(),p&&p.carrier||'','בלי')}</select></label>`:'<p class="note">אין חברות ניוד ברשימה. המנהל מוסיף ב"עריכת הרשימות".</p>'}
 <label class="f"><span>פרטי התוכנית (רשות)</span><textarea name="details" rows="3" maxlength="300">${esc(p&&p.details||'')}</textarea></label>
 ${fld('עלות חודשית ללקוח ₪ (רשות)','monthly',p&&typeof p.monthly==='number'?p.monthly:'','text','inputmode="decimal" maxlength="9"')}
 ${feeF('משלוח','ship',p&&p.ship)}${feeF('סים','sim',p&&p.sim)}
 ${fld('טווח התראה על ניוד חוזר (ימים)','days',p&&Number.isInteger(p.days)?p.days:60,'text','required inputmode="numeric" maxlength="4"')}
 ${prFs(p)}
 ${p?ck('off',p.on===false,'כבויה (לא מוצגת בהזמנה)'):''}
 <div class="row"><button class="btn grow">שמור</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`)};
FRM.olPF=async f=>{const x=fd(f),M=mgr();if(!x.name.trim())return toast('חסר שם');const d={name:x.name.trim(),carrier:x.carrier||'',details:String(x.details||'').trim()};
 {const days=+dig(x.days);if(!(days>=1&&days<=3650))return toast('טווח: 1 עד 3650 ימים');d.days=days} // גם עובד (החלטה 9.11 21:25)
 const mo=nm(x.monthly);if(Number.isNaN(mo))return toast('עלות חודשית: מספר');d.monthly=mo==null?'':mo;
 for(const[k,l]of[['ship','משלוח'],['sim','סים']]){const v=nm(x[k]);if(Number.isNaN(v))return toast(l+': מספר');d[k]=v==null?null:{amt:v,pay:x[k+'P']==='carrier'?'carrier':'store'}}
 try{d.promos=prRds(x)}catch(e){return toast(e.message)}
 if(x.id){d.id=x.id;d.on=!x.off}
 const b=f.querySelector('button');b.disabled=true;try{await fnCall('saveLinePlan',d);closeDlg();toast('נשמר');await lload(true)}catch(e){b.disabled=false;err(e)}};
ACT.olCfg=()=>dlg(`<h3>רשימות לניוד</h3><form data-f="olCF"><label class="f"><span>חברות ניוד (שורה לכל חברה)</span><textarea name="c" rows="5" maxlength="1300">${esc(carriers().join('\n'))}</textarea></label>
 <label class="f"><span>מקורות פרסום (שורה לכל מקור)</span><textarea name="a" rows="5" maxlength="1300">${esc(ads().join('\n'))}</textarea></label><p class="note">עד 30 בכל רשימה, עד 40 תווים לשם.</p>
 <div class="row"><button class="btn grow">שמור</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`);
FRM.olCF=async f=>{const x=fd(f),sp=s=>[...new Set(String(s||'').split('\n').map(v=>v.trim()).filter(Boolean))];const c=sp(x.c),a=sp(x.a);if(c.length>30||a.length>30)return toast('עד 30 בכל רשימה');if(c.concat(a).some(v=>v.length>40))return toast('עד 40 תווים לשם');
 const b=f.querySelector('button');b.disabled=true;try{await fnCall('setCellCfg',{carriers:c,ads:a});closeDlg();toast('נשמר');await lload(true)}catch(e){b.disabled=false;err(e)}};

/* מבצעים לחבילה (פישוט 9.11; כמה מבצעים 23:52): כל מבצע – הנחה לקו, מתנות מהמלאי (מחיר 0 = מתנה, או מחיר מבצע), מבצע כמות, תאריכים (רשות).
   בטופס: המבצעים הקיימים + מבצע ריק אחד להוספה (עד 5). מבצע כמות סופר רק קווים שבחרו באותו מבצע */
const PRMAX=5;
const pnm=id=>{const x=(O.P||[]).find(p=>p.id===id);return x?x.name:'מוצר'};
const prTxt=r=>{if(!r)return '';const x=[];if(r.disc)x.push('הנחה '+ils(r.disc)+' לקו');
 if(Array.isArray(r.gifts)&&r.gifts.length)x.push((r.gifts.length>1?'מתנה לבחירה: ':'מתנה: ')+r.gifts.map(g=>pnm(g.pid)+(g.price?' ב-'+ils(g.price):'')).join(' / '));
 if(r.qty)x.push(`${r.qty.n} קווים – הנחה ${ils(r.qty.amt)}`);if(r.from||r.to)x.push((r.from?'מ-'+dd(r.from):'')+(r.to?' עד '+dd(r.to):''));return x.join(' · ')};
const prT=p=>prs(p).map(r=>esc(prTxt(r))).join(' | ');
const GN=3; // שורות מתנה בטופס
const prF=(r,j)=>{const e=!r;r=r||{};const G=Array.isArray(r.gifts)?r.gifts:[],q=r.qty||{},P=(O.P||[]).filter(p=>p.on!==false).concat(G.filter(g=>!(O.P||[]).some(p=>p.id===g.pid&&p.on!==false)).map(g=>({id:g.pid,name:pnm(g.pid)}))),n=Math.max(GN,G.length);
 const gRow=i=>{const g=G[i]||{};return `<div class="row"><label class="f grow"><span>מתנה ${i+1}</span><select name="g${j}_${i}"><option value="">—</option>${P.map(p=>`<option value="${esc(p.id)}"${g.pid===p.id?' selected':''}>${esc(p.name)}</option>`).join('')}</select></label><label class="f" style="width:96px"><span>מחיר ₪</span><input name="gp${j}_${i}" inputmode="decimal" maxlength="9" value="${g.pid&&g.price?g.price:''}" placeholder="0" autocomplete="off"></label></div>`};
 return `<details data-pr="${j}"${e?'':' open'}><summary style="min-height:44px;display:flex;align-items:center"><b>${e?(j?'הוספת מבצע (רשות)':'מבצע לחבילה (רשות)'):'מבצע '+(j+1)}</b></summary>
 ${fld('הנחה בקנייה לכל קו ₪','pd'+j,r.disc||'','text','inputmode="decimal" maxlength="9"')}
 <p class="note" style="margin:4px 0">מתנה מהמלאי: מחיר ריק/0 = מתנה, או מחיר מבצע. כמה מתנות = העובד בוחר אחת לכל קו.</p>${Array.from({length:n},(x,i)=>gRow(i)).join('')}
 <div class="row"><label class="f grow"><span>מבצע כמות: קווים</span><input name="qn${j}" inputmode="numeric" maxlength="2" value="${q.n||''}" autocomplete="off"></label><label class="f grow"><span>הנחה ₪</span><input name="qa${j}" inputmode="decimal" maxlength="9" value="${q.amt||''}" autocomplete="off"></label></div>
 <p class="note" style="margin:4px 0">נספרים רק קווים שבחרו במבצע הזה. ריק = למחוק את המבצע.</p>
 <div class="row"><label class="f grow"><span>מתאריך (רשות)</span><input name="pf${j}" type="date" value="${esc(r.from||'')}"></label><label class="f grow"><span>עד תאריך (רשות)</span><input name="pt${j}" type="date" value="${esc(r.to||'')}"></label></div></details>`};
const prFs=p=>{const R=prs(p).slice(0,PRMAX);return R.map((r,j)=>prF(r,j)).join('')+(R.length<PRMAX?prF(null,R.length):'')};
// קורא מבצע אחד מהטופס → אובייקט לשרת, או null (ריק)
function prRd(x,j){const o={};const N=(k)=>x[k+j];const d=nm(N('pd'));if(Number.isNaN(d))throw new Error('הנחה בקנייה: מספר');if(d)o.disc=d;
 const gs=[];for(let i=0;x['g'+j+'_'+i]!==undefined;i++){const pid=x['g'+j+'_'+i];if(!pid)continue;const v=nm(x['gp'+j+'_'+i]);if(Number.isNaN(v))throw new Error('מחיר מתנה: מספר');if(gs.some(g=>g.pid===pid))throw new Error('אותה מתנה פעמיים');gs.push({pid,price:v||0})}if(gs.length)o.gifts=gs;
 const qn=dig(N('qn')),qa=nm(N('qa'));if(qn||qa!=null){if(!(+qn>=2&&+qn<=20))throw new Error('מבצע כמות: 2 עד 20 קווים');if(!(qa>0))throw new Error('מבצע כמות: חסרה הנחה');o.qty={n:+qn,amt:qa}}
 if(N('pf'))o.from=N('pf');if(N('pt'))o.to=N('pt');if(o.from&&o.to&&o.from>o.to)throw new Error('תאריך ההתחלה אחרי הסיום');
 return o.disc||o.gifts||o.qty?o:null}
const prRds=x=>{const a=[];for(let j=0;j<PRMAX&&x['pd'+j]!==undefined;j++){const r=prRd(x,j);if(r)a.push(r)}return a};

window.__ol={L,out,CS};
})();
