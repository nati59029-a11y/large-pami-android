/* POS:M1 – קופה, חלון התשלום (ש1, אפיון ב 1.2–1.3, ב 3 מסך 3).
   PayCalc – חוקי התשלום כפונקציות טהורות (נבדקות ב-firebase/tests/pos-sale-calc.unit.test.js):
     כלל הסגירה (ת7): paid + debt = gross, paid = Σamt − chg. עודף רק במזומן ועד סכום המזומן.
     כל אמצעי שאינו מזומן – עד היתרה. אסמכתא חובה להעברה/ביט/פייבוקס (refReq) ולכרטיס חיצוני. צ'ק דחוי – תאריך חובה.
     אשראי בהקלדה ידנית: 4 ספרות + מספר אישור; תשלומים 2..instMax ורק מעל instMinAmt. הקפה – ללקוח מזוהה, בתוך המסגרת.
   PosPay.open(ctx) – החלון. מחזיר Promise: {pays, chg, debt} כשהמכירה נסגרה, או null בביטול.
   אף אמצעי לא נבחר אוטומטית (ת9); הבולט – payPrimary. "מדויק" במזומן סוגר את המכירה מיד (U1: תשלום ← מזומן ← מדויק).
   גל 3 (19.11.2026): "אשראי במסוף" (רק כש-poscfg/card דלוק, ורק עם רשת וקופה רשומה) – posCardStart ← "העבירו כרטיס במסוף…" (posCardStatus כל 1.5 שניות,
   עד 90 שניות, כפתור ביטול = posCardCancel). מאושר → תשלום {m:'card', src:'term', cardTx, appr, last4, inst}; השרת קושר את החיוב למכירה (posSale).
   נדחה / שגיאה / בלי רשת → הודעה, ו"אשראי ידני (מסוף חיצוני)" נשאר כגיבוי. ביטול תשלום במסוף מחובר = ביטול החיוב אצל הספק. */
(function(root){
'use strict';
const PayCalc=(function(){
 const isAg=a=>Number.isInteger(a);
 const sum=pays=>(pays||[]).reduce((s,p)=>s+p.amt,0);
 const cashSum=pays=>(pays||[]).filter(p=>p.m==='cash').reduce((s,p)=>s+p.amt,0);
 const remaining=(gross,pays,debt)=>Math.max(0,gross-sum(pays)-(debt||0));
 const change=(gross,pays,debt)=>Math.max(0,sum(pays)+(debt||0)-gross);
 const isClosed=(gross,pays,debt)=>gross>0&&sum(pays)+(debt||0)>=gross&&change(gross,pays,debt)<=cashSum(pays);
 const R=(reason,err)=>({ok:false,reason,err});
 /* o: {payOn, refReq, txTypes, instMax, instMinAmt, checkPostdated, bal (יתרת כרטיס מתנה/זיכוי)} */
 function add(gross,pays,debt,p,o){o=o||{};pays=(pays||[]).slice();const on=o.payOn||['cash'];
  if(!p||!on.includes(p.m))return R('bad-m','אמצעי התשלום לא פעיל');
  if(!isAg(p.amt)||p.amt<=0)return R('bad-amt','סכום לא תקין');
  const rem=remaining(gross,pays,debt);if(rem<=0)return R('paid','המכירה כבר שולמה');
  if(p.m!=='cash'&&p.amt>rem)return R('over','הסכום גבוה מהיתרה');
  if(((o.refReq||[]).includes(p.m)||p.m==='extGift')&&!String(p.ref||'').trim())return R('no-ref','חובה להקליד אסמכתא');
  if(p.m==='check'){if(!String(p.chk&&p.chk.no||'').trim())return R('no-chk','חסר מספר צ\'ק');if(p.post){if(o.checkPostdated===false)return R('no-post','צ\'ק דחוי לא מתקבל');if(!/^\d{4}-\d{2}-\d{2}$/.test(p.due||''))return R('no-due','צ\'ק דחוי – חובה תאריך פירעון')}}
  if(p.m==='card'){if(!/^\d{4}$/.test(p.last4||''))return R('bad-last4','4 ספרות אחרונות – בדיוק 4 ספרות');if(!(p.cardTx?/^[0-9A-Za-z-]{1,20}$/:/^[0-9A-Za-z]{1,12}$/).test(p.appr||''))return R('no-appr','חסר מספר אישור');
   const tx=p.tx||'reg';if(!(o.txTypes||['reg']).includes(tx))return R('bad-tx','סוג עסקה לא מותר');
   if(tx==='inst'){const n=p.inst|0,max=o.instMax||3;if(n<2||n>max)return R('bad-inst','מספר תשלומים: 2 עד '+max);if(p.amt<(o.instMinAmt||0))return R('inst-min','תשלומים רק מעל סכום מינימלי')}}
  if((p.m==='gift'||p.m==='voucher')){if(!String(p.code||'').trim())return R('no-code','חסר קוד כרטיס');if(o.bal==null||p.amt>o.bal)return R('over-bal','הסכום גבוה מהיתרה בכרטיס')}
  const keep={m:p.m,amt:p.amt};['ref','chk','due','post','last4','appr','tx','inst','src','code','cardTx','brand'].forEach(k=>{if(p[k]!=null&&p[k]!=='')keep[k]=p[k]});if(p.m==='card'){keep.tx=keep.tx||'reg';keep.src=keep.src||'manual'}
  pays.push(keep);return{ok:true,pays}}
 /* הקפה: היתרה עוברת ללקוח מזוהה, רק בתוך המסגרת הפנויה */
 function toDebt(gross,pays,debt,cust,o){o=o||{};if(o.partialPay!=='debt')return R('no-debt','הקפה לא פעילה');if(!cust)return R('no-cust','הקפה רק ללקוח מזוהה');
  const rem=remaining(gross,pays,debt);if(rem<=0)return R('paid','המכירה כבר שולמה');const free=(cust.limit||0)-(cust.bal||0);
  if(rem>free)return R('limit','חריגה ממסגרת ההקפה (פנוי '+free+')');return{ok:true,debt:(debt||0)+rem}}
 /* סגירה: מחזיר את מה שנשמר במכירה */
 function close(gross,pays,debt){if(!isClosed(gross,pays,debt))return R('open','נותרה יתרה לתשלום');const chg=change(gross,pays,debt);return{ok:true,chg,paid:sum(pays)-chg,debt:debt||0}}
 /* חיוב כפול באשראי ידני (א7): אותו מספר אישור, או אותו סכום, בקופה הזו בחלון הזמן */
 function dupCard(hist,p,winMin,now){const from=(now||Date.now())-(winMin||10)*60000;return(hist||[]).some(h=>h.at>=from&&(h.appr===p.appr||h.amt===p.amt))}
 /* תקרת מזומן: המזומן נטו (אחרי עודף) במכירה */
 const cashNet=(gross,pays,debt)=>cashSum(pays)-change(gross,pays,debt);
 return{sum,cashSum,remaining,change,isClosed,add,toDebt,close,dupCard,cashNet};
})();
root.PayCalc=PayCalc;
if(typeof module!=='undefined'&&module.exports){module.exports={PayCalc};}
if(typeof document==='undefined')return;

const U=()=>root.PosUI;
const cardHist=[];
/* גל 3: אשראי במסוף מחובר. המצב (poscfg/card: on, mode) נקרא מהשרת ונשמר לדקה */
const TERM={mode:'off',at:0};
const lsg=k=>{try{return root.localStorage.getItem(k)}catch(e){return null}};
const gSY=()=>{try{return typeof SY!=='undefined'?SY:null}catch(e){return null}};
function myDev(){try{const s=gSY(),o=JSON.parse(lsg('lp-pos-dev')||'null');return o&&s&&o.bizId===s.bizId&&/^K[1-9][0-9]{0,3}$/.test(o.dev||'')?o.dev:''}catch(e){return''}}
const fnc=(n,d)=>{d=Object.assign({},d);const s=gSY();if(s&&s.sa&&s.bizId)d.bizId=s.bizId;return root.fnCall(n,d)};
async function termLoad(){if(Date.now()-TERM.at<60000)return TERM.mode;
 try{const j=await fsx('/poscfg/card');const fv=typeof fvj==='function'?fvj:root.fvj;const o=j&&j.fields?fv({mapValue:j}):null;TERM.mode=o&&o.on===true&&['mock','cardcom'].includes(o.mode)?o.mode:'off';TERM.at=Date.now()}
 catch(e){TERM.mode='off';TERM.at=Date.now()-50000}return TERM.mode}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const refId=()=>{const a=new Uint8Array(8);try{root.crypto.getRandomValues(a)}catch(e){for(let i=0;i<8;i++)a[i]=Math.floor(Math.random()*256)}return'c'+Date.now().toString(36)+Array.from(a,b=>b.toString(16).padStart(2,'0')).join('')};
/* שגיאה "ודאית" מהשרת (נדחה בבדיקה) – לעומת אין רשת / שגיאה פנימית, שבהן לא ידוע אם החיוב נוצר */
const sure=e=>!!(e&&e.reason&&!e.offline&&e.reason!=='internal');
const TERM_TMO=90000,TERM_POLL=1500;
const MANUAL_HINT=' אפשר לנסות שוב, או "אשראי ידני (מסוף חיצוני)" / אמצעי אחר.';
/* ctx: {gross, cust, role, me} */
function open(ctx){const{E,fmt,cfg,M_NAME,parseAmt}=U();return new Promise(res=>{
 const S={pays:[],debt:0,m:'',busy:0,err:''};const gross=ctx.gross;const opt=()=>({payOn:cfg('payOn'),refReq:cfg('refReq'),txTypes:cfg('txTypes'),instMax:cfg('instMax'),instMinAmt:cfg('instMinAmt'),checkPostdated:cfg('checkPostdated')});
 const R=U().UI.root||document.body,w=document.createElement('div');w.className='pos-modal';w.setAttribute('role','dialog');w.setAttribute('aria-modal','true');w.setAttribute('aria-label','תשלום');R.append(w);U().UI.stack.push(w);
 const done=v=>{if(!w.isConnected)return;w.remove();U().UI.stack=U().UI.stack.filter(x=>x!==w);res(v)};w._close=async()=>{if(S.term)return;if(S.pays.length&&!(await voidAll()))return;done(null)};
 termLoad().then(()=>{if(w.isConnected&&!S.term)draw()});
 async function voidAll(){const a=await U().approve({role:ctx.role,need:cfg('payVoidRole'),text:'ביטול תשלומים שנרשמו'});if(a.ok){for(const p of S.pays.filter(x=>x.cardTx))if(!(await termVoid(p)))return false;S.pays.forEach(p=>root.PosData.log('payVoid',{m:p.m,amt:p.amt,by:a.by}));return true}return false}
 /* ביטול תשלום של אשראי במסוף = ביטול החיוב אצל הספק. נכשל → שואלים; אם מסירים בכל זאת, החיוב נשאר "בלי מכירה" ומופיע אצל המנהל */
 async function termVoid(p){try{const r=await fnc('posCardCancel',{id:p.cardTx});if(r&&(r.st==='void'||r.st==='cancel'))return true}catch(e){
   return U().confirmBox('ביטול החיוב במסוף נכשל'+(e&&e.message?' ('+e.message+')':'')+'. להסיר את התשלום בכל זאת? החיוב יופיע אצל המנהל כ"חיוב בלי מכירה".','הסר בכל זאת')}
  return U().confirmBox('החיוב במסוף לא בוטל. להסיר את התשלום בכל זאת? החיוב יופיע אצל המנהל כ"חיוב בלי מכירה".','הסר בכל זאת')}
 /* חיוב במסוף מחובר: posCardStart ← המתנה (posCardStatus) ← תשלום. ref חדש לכל ניסיון; אותו ref בשליחה חוזרת = אותה עסקה (השרת) */
 async function termRun(amt,n){
  if(root.navigator&&root.navigator.onLine===false){S.err='אין רשת – אשראי במסוף לא זמין.'+MANUAL_HINT;draw();return}
  const dev=myDev(),inst=lsg('lp-pos-inst')||'';if(!dev){S.err='הקופה לא רשומה (מצב תרגול) – אשראי במסוף לא זמין.';draw();return}
  const ref=refId(),id=dev+'_'+ref,data={dev,inst,amt,ref};if(n>1)data.n=n;
  S.term={id,amt,stop:false};S.err='';draw();
  let r=null,er=null;
  try{r=await fnc('posCardStart',data)}catch(e){er=e}
  if(!r&&!sure(er)){try{r=await fnc('posCardStart',data);er=null}catch(e){er=e}}
  if(!r){if(!sure(er))try{await fnc('posCardCancel',{id})}catch(e){} /* אולי נוצרה – מבטלים (אם אושרה ולא בוטלה – תופיע אצל המנהל) */
   return termEnd((er&&er.message||'אין חיבור לשרת')+' – החיוב לא בוצע.'+MANUAL_HINT)}
  const t0=Date.now();
  while(r.st==='wait'||r.st==='unk'){ /* סבב 2: 'unk' (לא ודאי) – ממשיכים לשאול עד ה-timeout */
   if(S.term.stop||Date.now()-t0>TERM_TMO){const tmo=!S.term.stop;let c=null;try{c=await fnc('posCardCancel',{id})}catch(e){}
    if(c&&c.st==='ok'){r=c;break}
    if(c&&(c.st==='cancel'||c.st==='void'))return termEnd((tmo?'אין תשובה מהמסוף. ':'')+'החיוב בוטל.'+MANUAL_HINT);
    return termEnd((tmo?'אין תשובה מהמסוף. ':'')+'הביטול לא אושר – בדקו במסוף. אם החיוב עבר, הוא יופיע אצל המנהל.'+MANUAL_HINT)}
   await sleep(TERM_POLL);
   if(S.term.stop)continue;
   try{r=await fnc('posCardStatus',{id})}catch(e){/* תקלה רגעית – ממשיכים לשאול עד ה-timeout */}
  }
  if(r.st==='no')return termEnd('הכרטיס נדחה'+(r.msg?' ('+r.msg+')':'')+'.'+MANUAL_HINT);
  if(r.st==='voiding')return termEnd('החיוב בתהליך ביטול.'+MANUAL_HINT);
  if(r.st!=='ok')return termEnd((r.st==='cancel'||r.st==='void'?'החיוב בוטל.':(r.msg||'שגיאה בחיוב במסוף')+'.')+MANUAL_HINT);
  const p={m:'card',amt:r.amt,last4:r.last4,appr:r.appr,ref:r.appr,src:'term',cardTx:r.id,tx:r.tx||'reg'};if(r.n>1)p.inst=r.n;if(r.brand)p.brand=r.brand;
  const a=PayCalc.add(gross,S.pays,S.debt,p,opt());
  if(!a.ok){S.term=null;await termVoid(p);S.err=a.err;draw();return} /* לא אמור לקרות (הסכום נבדק לפני החיוב) */
  S.term=null;cardHist.push({at:Date.now(),appr:p.appr,amt:p.amt});root.PosData.log('cardTerm',{amt:p.amt,id:r.id});
  S.pays=a.pays;S.err='';S.m='';U().say('אשראי במסוף אושר '+fmt(p.amt)+'. נותר '+fmt(PayCalc.remaining(gross,S.pays,S.debt)));
  if(PayCalc.isClosed(gross,S.pays,S.debt)){const c=PayCalc.close(gross,S.pays,S.debt);done({pays:S.pays,chg:c.chg,debt:c.debt});return}draw()}
 function termEnd(msg){S.term=null;S.err=msg;draw();U().toast(msg,'bad')}
 const quick=rem=>{const L=[rem];[5000,10000,20000].concat(cfg('quickCash')||[]).forEach(v=>{if(v>rem&&!L.includes(v))L.push(v)});return L.slice(0,4).sort((a,b)=>a-b)};
 function form(){const m=S.m;if(!m)return'';const rem=PayCalc.remaining(gross,S.pays,S.debt);const mn=m==='term'?'אשראי במסוף':M_NAME[m];const amt=`<label class="pos-f"><span>סכום ב${E(mn)} (₪)</span><input id="payAmt" data-autof inputmode="decimal" autocomplete="off" dir="ltr" placeholder="${(rem/100).toFixed(2)}" aria-label="סכום ב${E(mn)}"></label>`;
  let f='';if(m==='cash')f=amt+`<div class="pos-quick">${quick(rem).map(v=>`<button class="pos-b g" data-pa="q" data-v="${v}" aria-label="${v===rem?'מדויק ':''}${fmt(v)}">${v===rem?'מדויק '+fmt(v):fmt(v)}</button>`).join('')}</div>`;
  else if(m==='card')f=amt+`<div class="pos-grid2"><label class="pos-f"><span>4 ספרות אחרונות</span><input id="payL4" inputmode="numeric" maxlength="4" autocomplete="off" dir="ltr" aria-label="4 ספרות אחרונות"></label><label class="pos-f"><span>מספר אישור</span><input id="payAppr" inputmode="numeric" maxlength="12" autocomplete="off" dir="ltr" aria-label="מספר אישור"></label></div>
   <div class="pos-seg" role="radiogroup" aria-label="סוג עסקה">${(cfg('txTypes')||['reg']).map((t,i)=>`<button role="radio" aria-checked="${i===0}" data-pa="tx" data-v="${t}">${{reg:'רגילה',inst:'תשלומים',defer:'חיוב נדחה'}[t]||t}</button>`).join('')}</div>
   <label class="pos-f" id="payInstW" hidden><span>מספר תשלומים (2–${cfg('instMax')}, מעל ${fmt(cfg('instMinAmt'))})</span><input id="payInst" inputmode="numeric" maxlength="2" dir="ltr" aria-label="מספר תשלומים"></label>
   <p class="pos-note">${cfg('termMode')==='manual'?'הקלדה ידנית: מבצעים את החיוב במסוף, ומקלידים כאן 4 ספרות ומספר אישור. לעולם לא מקלידים מספר כרטיס.':''}</p><button class="pos-b g" data-pa="cardFail">הכרטיס נדחה</button>`;
  else if(m==='term')f=amt+`<div class="pos-seg" role="radiogroup" aria-label="סוג עסקה">${(cfg('txTypes')||['reg']).filter(t=>t!=='defer').map((t,i)=>`<button role="radio" aria-checked="${i===0}" data-pa="tx" data-v="${t}">${{reg:'רגילה',inst:'תשלומים'}[t]||t}</button>`).join('')}</div>
   <label class="pos-f" id="payInstW" hidden><span>מספר תשלומים (2–${cfg('instMax')}, מעל ${fmt(cfg('instMinAmt'))})</span><input id="payInst" inputmode="numeric" maxlength="2" dir="ltr" aria-label="מספר תשלומים"></label>
   <p class="pos-note">${TERM.mode==='mock'?'מסוף מדומה (בדיקה) – אין חיוב אמיתי. ':''}הלקוח מעביר את הכרטיס במסוף; לא מקלידים כאן שום פרט כרטיס.</p>`;
  else if(m==='check')f=amt+`<div class="pos-grid2"><label class="pos-f"><span>מספר צ'ק</span><input id="payChk" inputmode="numeric" dir="ltr" aria-label="מספר צ'ק"></label><label class="pos-f"><span>בנק</span><input id="payBank" inputmode="numeric" dir="ltr" aria-label="בנק"></label></div>${cfg('checkPostdated')?`<label class="pos-chk"><input type="checkbox" id="payPost"> צ'ק דחוי</label><label class="pos-f"><span>תאריך פירעון</span><input id="payDue" type="date" dir="ltr" aria-label="תאריך פירעון"></label>`:''}`;
  else if(m==='gift'||m==='voucher')f=amt+`<label class="pos-f"><span>קוד ${E(M_NAME[m])} (סריקה או הקלדה)</span><input id="payCode" autocomplete="off" dir="ltr" aria-label="קוד ${E(M_NAME[m])}"></label>`;
  else f=amt+`<label class="pos-f"><span>אסמכתא${(cfg('refReq')||[]).includes(m)||m==='extGift'?' (חובה)':''}</span><input id="payRef" autocomplete="off" dir="ltr" aria-label="אסמכתא"></label>`;
  return`<div class="pos-payf">${f}<button class="pos-b big w" data-pa="add" data-def>${m==='term'?'חיוב במסוף':'הוספת תשלום ב'+E(M_NAME[m])}</button></div>`}
 function draw(){if(S.term){w.innerHTML=`<div class="pos-card pos-pay" aria-busy="true"><div class="pos-sh"><h2>אשראי במסוף</h2></div>
   <div class="pos-kv big"><span>סכום</span><b>${fmt(S.term.amt)}</b></div>
   <p class="pos-note" role="status" aria-live="polite">${S.term.stop?'מבטל…':'העבירו כרטיס במסוף…'}</p>
   <button class="pos-b w g" data-pa="termX"${S.term.stop?' disabled':''}>ביטול החיוב</button></div>`;return}
  const rem=PayCalc.remaining(gross,S.pays,S.debt),pri=cfg('payPrimary'),cust=ctx.cust,termOn=TERM.mode!=='off'&&(cfg('payOn')||[]).includes('card');
  let ms=(cfg('payOn')||[]).filter(m=>m!=='link');if(termOn)ms=ms.flatMap(m=>m==='card'?['term','card']:[m]);
  const MN=m=>m==='term'?'אשראי במסוף':m==='card'&&termOn?'אשראי ידני (מסוף חיצוני)':M_NAME[m];
  const canDebt=cfg('partialPay')==='debt'&&cust&&(cust.limit||0)>0&&rem>0;
  w.innerHTML=`<div class="pos-card pos-pay"><div class="pos-sh"><h2>תשלום</h2><button class="pos-ib" data-pa="x" aria-label="סגירת חלון התשלום">✕</button></div>
  <div class="pos-kv big"><span>לתשלום</span><b id="payTotal">${fmt(gross)}</b></div>
  ${S.pays.length||S.debt?`<div class="pos-pays">${S.pays.map((p,i)=>`<div class="pos-kv"><span>${E(M_NAME[p.m])}${p.ref?` <small>אסמכתא ${E(p.ref)}</small>`:''}${p.last4?` <small>•••• ${E(p.last4)}</small>`:''}${p.cardTx?' <small>במסוף</small>':''}${p.due?` <small>פירעון ${E(p.due)}</small>`:''}</span><b>${fmt(p.amt)}</b><button class="pos-ib x" data-pa="void" data-i="${i}" aria-label="ביטול תשלום ${E(M_NAME[p.m])} ${fmt(p.amt)}">✕</button></div>`).join('')}${S.debt?`<div class="pos-kv"><span>הקפה – ${E(cust.name)}</span><b>${fmt(S.debt)}</b><button class="pos-ib x" data-pa="undebt" aria-label="ביטול הקפה">✕</button></div>`:''}</div>`:''}
  <div class="pos-kv big"><span>נותר לתשלום</span><b id="payRem" aria-live="polite">${fmt(rem)}</b></div>
  <div class="pos-ms" role="group" aria-label="אמצעי תשלום">${ms.map(m=>`<button class="pos-m${m===pri?' pri':''}${S.m===m?' on':''}" data-pa="m" data-v="${m}" aria-pressed="${S.m===m}" aria-label="${E(MN(m))}">${E(MN(m))}</button>`).join('')}${canDebt?`<button class="pos-m" data-pa="debt" aria-label="העברת היתרה להקפה">הקפה</button>`:''}</div>
  ${form()}
  ${S.err?`<p class="pos-err" role="alert">${E(S.err)}</p>`:''}
  <button class="pos-b w g" data-pa="fin" disabled aria-label="סיום">סיום – נותר ${fmt(rem)}</button></div>`;
  const f=w.querySelector('[data-autof]');if(f)try{f.focus({preventScroll:true})}catch(e){}}
 const val=id=>{const el=w.querySelector('#'+id);return el?String(el.value||'').trim():''};
 async function addP(amt){const m=S.m;if(!m||S.term)return;const rem=PayCalc.remaining(gross,S.pays,S.debt);if(amt==null){const s=val('payAmt');amt=s?parseAmt(s):rem}
  if(m==='term'){if(!Number.isInteger(amt)||amt<=0){S.err='סכום לא תקין';draw();return}if(amt>rem){S.err='הסכום גבוה מהיתרה';draw();return}
   const t=w.querySelector('[data-pa=tx][aria-checked=true]'),n=t&&t.dataset.v==='inst'?(+val('payInst')|0):1;
   if(n!==1){const max=cfg('instMax')||3;if(n<2||n>max){S.err='מספר תשלומים: 2 עד '+max;draw();return}if(amt<(cfg('instMinAmt')||0)){S.err='תשלומים רק מעל סכום מינימלי';draw();return}}
   return termRun(amt,n)}
  const p={m,amt};if(m==='card'){p.last4=val('payL4');p.appr=val('payAppr');const t=w.querySelector('[data-pa=tx][aria-checked=true]');p.tx=t?t.dataset.v:'reg';if(p.tx==='inst')p.inst=+val('payInst')}
  if(m==='check'){p.chk={no:val('payChk'),bank:val('payBank')};const po=w.querySelector('#payPost');p.post=!!(po&&po.checked);if(val('payDue'))p.due=val('payDue')}
  if(['transfer','bit','paybox','extGift'].includes(m))p.ref=val('payRef');
  let bal;if(m==='gift'||m==='voucher'){p.code=val('payCode');if(p.code){const b=await root.PosData.giftBalance(m,p.code);if(!b.ok){S.err='הכרטיס לא נמצא';draw();return}bal=b.bal}}
  const r=PayCalc.add(gross,S.pays,S.debt,p,Object.assign(opt(),{bal}));if(!r.ok){S.err=r.err;draw();U().toast(r.err,'bad');return}
  if(m==='card'&&PayCalc.dupCard(cardHist,p,cfg('dupWinMin'))){root.PosData.log('dupWarn',{appr:p.appr,amt:p.amt});if(!(await U().confirmBox('אותו מספר אישור או אותו סכום נרשמו בקופה הזו בדקות האחרונות. לרשום בכל זאת?','רשום בכל זאת')))return}
  /* תקרת מזומן (ת3) */
  if(m==='cash'){const net=PayCalc.cashNet(gross,r.pays,S.debt),max=cfg('cashMax'),mode=cfg('cashMaxMode');
   if(max&&net>max){if(mode==='block'){S.err='תשלום במזומן מעל התקרה המותרת';draw();return}
    if(mode==='warn'&&!(await U().confirmBox('תשלום במזומן מעל '+fmt(max)+'. לאשר?','אישור')))return;
    if(mode==='lead'&&!(await U().approve({role:ctx.role,need:'lead',text:'מזומן מעל התקרה'})).ok)return;
    if(mode==='note')U().toast('שימו לב: מזומן מעל '+fmt(max));root.PosData.log('cashMax',{amt:net,mode})}}
  if(m==='card')cardHist.push({at:Date.now(),appr:p.appr,amt:p.amt});
  S.pays=r.pays;S.err='';S.m='';U().say('נרשם '+M_NAME[m]+' '+fmt(p.amt)+'. נותר '+fmt(PayCalc.remaining(gross,S.pays,S.debt)));
  if(PayCalc.isClosed(gross,S.pays,S.debt)){const c=PayCalc.close(gross,S.pays,S.debt);done({pays:S.pays,chg:c.chg,debt:c.debt});return}draw()}
 w.addEventListener('click',async ev=>{const b=ev.target.closest('[data-pa]');if(!b||!w.contains(b)||b.disabled)return;const a=b.dataset.pa;
  if(a==='termX'){if(S.term&&!S.term.stop){S.term.stop=true;draw()}return}
  if(S.term)return;
  if(a==='x')return w._close();
  if(a==='m'){S.m=S.m===b.dataset.v?'':b.dataset.v;S.err='';draw();return}
  if(a==='q')return addP(+b.dataset.v);
  if(a==='add')return addP();
  if(a==='tx'){w.querySelectorAll('[data-pa=tx]').forEach(x=>x.setAttribute('aria-checked',String(x===b)));const iw=w.querySelector('#payInstW');if(iw)iw.hidden=b.dataset.v!=='inst';return}
  if(a==='cardFail'){root.PosData.log('cardFail',{amt:PayCalc.remaining(gross,S.pays,S.debt)});S.m='';S.err='הכרטיס נדחה. בחרו אמצעי תשלום אחר.';draw();return}
  if(a==='void'){const i=+b.dataset.i,p=S.pays[i];const ap=await U().approve({role:ctx.role,need:cfg('payVoidRole'),text:'ביטול תשלום'});if(!ap.ok)return;if(p.cardTx&&!(await termVoid(p)))return;root.PosData.log('payVoid',{m:p.m,amt:p.amt,by:ap.by});S.pays.splice(i,1);draw();return}
  if(a==='debt'){const r=PayCalc.toDebt(gross,S.pays,S.debt,ctx.cust,{partialPay:cfg('partialPay')});if(!r.ok){S.err=r.err;draw();return}S.debt=r.debt;
   if(PayCalc.isClosed(gross,S.pays,S.debt)){const c=PayCalc.close(gross,S.pays,S.debt);done({pays:S.pays,chg:c.chg,debt:c.debt});return}draw();return}
  if(a==='undebt'){S.debt=0;draw();return}});
 w.addEventListener('keydown',ev=>{if(ev.key==='Enter'&&ev.target.tagName==='INPUT'&&S.m){ev.preventDefault();addP()}});
 draw()})}
root.PosPay={open,PayCalc};
})(typeof window!=='undefined'?window:globalThis);
