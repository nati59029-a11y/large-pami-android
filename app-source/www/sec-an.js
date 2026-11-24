/* גיטי – מגמות, הוצאות חריגות וטיוטות הזמנה מספקים (24.11.2026, "גיטי מנהלת עסק", סבב 4 חלק ב, החלטות 6–10). נטען אחרי sec-perm.js.
   כל החישובים בשרת (firebase/functions/lib/sec-an.js, lib/sec-od.js), בלי AI. כאן רק תצוגה ופעולות:
   1. מרכז השליטה (sec-hub.js top): כרטיס "מגמות וחריגות" – secReports op:'an'. החודש האחרון שהסתיים מול החודש הקודם ומול אותו חודש אשתקד
      (הכנסות, הוצאות, קטגוריות, ספקים), החודש הנוכחי עד היום (מסומן "חלקי"), והוצאות חריגות לפי הספים של מנהל־העל.
      "עודכן לאחרונה" = זמן מראה הכספים בענן (המקור). "לשאול את גיטי" – פותח את השיחה עם שאלה (הכלי getTrends בשרת).
   2. מרכז האישורים (sec-hub.js apprH): טיוטת הזמנה לכל ספק – עריכת כמויות (0 = בלי המוצר), "אישור" → secPrefs op:'od' st:'ok':
      השורות נכנסות לרשימה הקיימת "להזמין מספקים" (supord) – לא נשלח לספק ולא משנה מלאי. "דחייה" → st:'no'.
      "טיוטת הזמנה מספק: אסור" – השרת מחזיר od:null, ואין שום טיוטה במסך. מנהל עם הגבלת סניפים – אין כרטיס ואין טיוטות.
   עיצוב: רק משתני הערכה ומחלקות קיימות (card, chip, note, secli, sectags). שום דבר לא נשמר במכשיר. */
(function(root){
'use strict';
if(typeof ACT==='undefined'||typeof CHG==='undefined')return;
const X=root.__sec;if(!X)return;
const fnCall=(n,d)=>{d=d&&typeof d==='object'?d:{};if(SY&&SY.sa&&SY.bizId&&!('bizId'in d))d=Object.assign({bizId:SY.bizId},d);return root.fnCall(n,d)};
const css=document.createElement('style');
css.textContent='.anrow{display:flex;flex-wrap:wrap;justify-content:space-between;gap:2px 8px;padding:6px 0;border-top:1px solid var(--line)}.anrow:first-child{border-top:0}'
+'.anrow b{flex:1 1 120px}.anrow .anv{font-variant-numeric:tabular-nums;white-space:nowrap}.anrow small{flex:1 1 100%}.anup{color:var(--bad)}.andn{color:var(--acc)}'
+'.odl{display:grid;grid-template-columns:1fr 96px;gap:4px 8px;align-items:center;padding:8px 0;border-top:1px solid var(--line)}.odl:first-of-type{border-top:0}'
+'.odl input{width:100%;min-height:44px;box-sizing:border-box;text-align:center}.odl small{grid-column:1/-1}';
document.head.appendChild(css);
const A={r:null,b:0,err:'',at:0,more:0,ld:0};
const re=()=>{try{if(cur().v==='sec'&&!(typeof typing==='function'&&typing()))rerender()}catch(e){}};
const tmF=t=>{if(!t)return '';try{const d=new Date(t);return d.toLocaleDateString('he-IL',{day:'numeric',month:'numeric',year:'2-digit'})+' '+d.toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'})}catch(e){return ''}};
const ils=v=>typeof v==='number'&&isFinite(v)?Math.round(v).toLocaleString('he-IL')+' ₪':'—';
const monL=m=>/^\d{4}-\d{2}$/.test(m||'')?(+m.slice(5,7))+'/'+m.slice(0,4):'';
const dS=d=>/^\d{4}-\d{2}-\d{2}$/.test(d||'')?(+d.slice(8,10))+'.'+(+d.slice(5,7)):'';
/* שינוי באחוזים: עלייה בהוצאה – אדום, ירידה – זהב; בהכנסה הפוך. null – "אין נתון" */
const chg=(d,exp)=>d===null||d===undefined?'<span class="note">אין נתון</span>':`<span class="${(d>0)===!!exp&&d!==0?'anup':'andn'}">${d>0?'+':''}${d}%</span>`;

async function load(force){if(A.b||(!force&&A.at&&Date.now()-A.at<300000))return;A.b=1;
 try{const r=await fnCall('secReports',{op:'an'});if(!r||!r.ok)throw new Error('לא נטען');A.r=r;A.err=''}
 catch(e){A.err=e&&e.message||'לא נטען'}
 finally{A.b=0;A.ld=1;A.at=Date.now();re()}}

/* ---------- 1. כרטיס "מגמות וחריגות" ---------- */
function rowH(l,c,exp){return `<div class="anrow"><b>${esc(l)}</b><span class="anv">${ils(c.v)}</span><small class="note">מול החודש הקודם: ${c.prev===null?'אין נתון':ils(c.prev)+' ('+chg(c.dPrev,exp)+')'} · מול אשתקד: ${c.py===null?'אין נתון':ils(c.py)+' ('+chg(c.dPy,exp)+')'}</small></div>`}
root.__secAnH=()=>{
 if(!A.ld&&!A.b)load(false);else if(A.at&&Date.now()-A.at>300000&&!A.b)load(false);
 const r=A.r,hd=`<div class="eyh"><div><b>מגמות וחריגות</b><small class="note" style="display:block">${r&&r.at?'עודכן לאחרונה: '+esc(tmF(r.at))+' · מקור: '+esc(r.src||''):r?'מקור: '+esc(r.src||'מראה הכספים בענן'):'טוען…'}</small></div><span><button class="chip" data-a="anRe" style="min-height:44px">רענון</button></span></div>`;
 if(!r){return A.err?`<div class="card" id="secAn">${hd}<p class="note">${esc(A.err)}</p></div>`:`<div class="card" id="secAn">${hd}</div>`}
 if(r.brLimited)return '';
 const T=r.an;
 if(!T||!T.ok)return `<div class="card" id="secAn">${hd}<p class="note" style="margin:6px 0 0">${T&&T.err==='mirror-off'?'מראה הכספים כבוי בהגדרות – אין נתונים למגמות.':'אין עדיין נתוני כספים בענן. פתחו את האפליקציה במכשיר שבו נשמרים הנתונים.'}</p></div>`;
 const an=T.anoms||[],P=T.P||{};
 const anH=an.length?an.map(a=>`<div class="anrow"><b>${a.k==='sup'?'ספק ':''}"${esc(a.n)}"${a.part?' <span class="sectags">החודש עד היום</span>':''}</b><span class="anv anup">${ils(a.v)}</span><small class="note">${esc(monL(a.m))}: ממוצע 3 החודשים הקודמים ${ils(a.avg)} · ${a.pct>0?'+':''}${a.pct}% (${ils(a.diff)} יותר)</small></div>`).join('')
  :`<p class="note" style="margin:4px 0">${T.hist?'אין הוצאות חריגות ✓':'אין עדיין 3 חודשים מלאים בנתונים – לא בודקים חריגות.'}</p>`;
 const list=(L,t)=>L&&L.length?`<h3 style="margin:10px 0 2px;font-size:.95rem">${t}</h3>${L.map(c=>rowH(c.n,c,true)).join('')}`:'';
 const more=A.more?list(T.cats,'הוצאות לפי קטגוריה')+(T.sups?list(T.sups,'ספקים'):'<p class="note" style="margin:8px 0 0">השוואה לספקים תופיע אחרי עדכון האפליקציה במכשיר שבו נשמרים הנתונים.</p>'):'';
 return `<div class="card" id="secAn">${hd}
 <h3 style="margin:8px 0 2px;font-size:.95rem">הוצאות חריגות <small class="note">(${esc(String(P.anPct||30))}% ומעלה מעל ממוצע 3 חודשים, ולפחות ${ils(P.anMin===undefined?200:P.anMin)})</small></h3>${anH}
 ${T.has?`<h3 style="margin:10px 0 2px;font-size:.95rem">${esc(monL(T.last))} מול ${esc(monL(T.prev))} ומול ${esc(monL(T.py))}</h3>${rowH('הכנסות',T.inc,false)}${rowH('הוצאות',T.exp,true)}`:`<p class="note">אין נתונים לחודש ${esc(monL(T.last))}.</p>`}
 ${T.part?`<p class="note" style="margin:6px 0 0"><b>החודש עד היום (חלקי, עד ${esc(dS(T.part.to))}):</b> הכנסות ${ils(T.part.inc)} · הוצאות ${ils(T.part.exp)}</p>`:''}
 ${more}
 <div class="secrow" style="margin-top:8px"><button class="chip" data-a="anMore" style="min-height:44px">${A.more?'פחות':'קטגוריות וספקים'}</button><button class="chip" data-a="anAsk" style="min-height:44px">לשאול את גיטי על המגמות</button></div></div>`};
ACT.anRe=()=>{load(true);re()};
ACT.anMore=()=>{A.more=!A.more;rerender()};
ACT.anAsk=()=>{try{ACT.secTab({dataset:{v:'chat'}});setTimeout(()=>{try{root.__secAsk('מה המגמות וההוצאות החריגות?')}catch(e){}},60)}catch(e){}};

/* ---------- 2. טיוטות הזמנה מספקים (מרכז האישורים) ---------- */
const D=new Map();/* מצב מקומי לכל טיוטה: { q:{pid:כמות}, busy, st } */
const dOf=id=>{if(!D.has(id))D.set(id,{q:{},busy:0,st:''});return D.get(id)};
const ods=()=>A.r&&Array.isArray(A.r.od)?A.r.od:[];
function odH(o){const s=dOf(o.id),dis=s.busy?' disabled':'';
 if(s.st)return `<div class="secli" data-od="${esc(o.id)}"><p><b>${esc(o.sup)}</b> <span class="sectags${s.st==='ok'?' g':''}">${s.st==='ok'?'אושר ✓':'נדחה'}</span></p>${s.st==='ok'?`<p class="note">נוסף לרשימה "להזמין מספקים". שום דבר לא נשלח לספק.</p>${typeof V!=='undefined'&&typeof V.oxSup==='function'?'<div class="secrow"><button class="chip" data-a="odList" style="min-height:44px">לרשימה "להזמין מספקים"</button></div>':''}`:''}</div>`;
 const q=p=>s.q[p]!==undefined?s.q[p]:o.lines.find(l=>l.pid===p).qty;
 const tot=o.lines.filter(l=>typeof l.cost==='number').reduce((a,l)=>a+l.cost*(+q(l.pid)||0),0),priced=o.lines.some(l=>typeof l.cost==='number');
 return `<div class="secli" data-od="${esc(o.id)}"><p style="margin:0"><b>${esc(o.sup)}</b> <span class="sectags">${o.lines.length} מוצרים</span>${o.day?` <span class="sectags">${esc(dS(o.day))}</span>`:''}</p>
 ${o.lines.map(l=>`<label class="odl"><b>${esc(l.n)}</b><input type="number" inputmode="decimal" min="0" step="any" dir="ltr" data-c="odQ" data-id="${esc(o.id)}" data-p="${esc(l.pid)}" value="${esc(String(q(l.pid)))}" aria-label="כמות: ${esc(l.n)}"${dis}><small class="note">${esc(l.why)}</small></label>`).join('')}
 ${priced?`<p class="note" style="margin:4px 0">סכום משוער לפי העלות במלאי: ${ils(tot)}${o.lines.some(l=>typeof l.cost!=='number')?' (לחלק מהמוצרים אין עלות)':''}</p>`:''}
 <div class="secrow"><button class="chip" style="min-height:44px" data-a="odOk" data-id="${esc(o.id)}"${dis}>אישור – להזמין מספקים</button><button class="chip" style="min-height:44px" data-a="odNo" data-id="${esc(o.id)}"${dis}>דחייה</button></div></div>`}
root.__secOdH=()=>{
 if(!A.ld&&!A.b)load(false);
 const L=ods();if(!L.length)return '';
 return `<div class="sec"><h3>טיוטות הזמנה מספקים (${L.filter(o=>!dOf(o.id).st).length})</h3></div><div class="card" id="secOd"><p class="note" style="margin:0 0 6px">גיטי הכינה טיוטה לפי קצב המכירות והמלאי (או לפי ההזמנות הקודמות). שום דבר לא נשלח לספק – באישור המוצרים נכנסים לרשימה "להזמין מספקים". אפשר לשנות כמות; 0 = בלי המוצר.</p>${L.map(odH).join('')}</div>`};
{const t0=ACT.secTab;if(typeof t0==='function')ACT.secTab=el=>{if(el&&el.dataset&&(el.dataset.v==='appr'||el.dataset.v==='eyes'))A.ld=0;return t0(el)}}
CHG.odQ=el=>{const s=dOf(el.dataset.id);if(s.busy||s.st)return;const v=parseFloat(String(el.value).replace(',','.'));s.q[el.dataset.p]=isFinite(v)&&v>=0?v:0};
function sync(id,box){if(!box)return;const s=dOf(id);box.querySelectorAll('input[data-c=odQ]').forEach(i=>{const v=parseFloat(String(i.value).replace(',','.'));s.q[i.dataset.p]=isFinite(v)&&v>=0?v:0})}
ACT.odOk=async el=>{const id=el.dataset.id,o=ods().find(x=>x.id===id),s=dOf(id);if(!o||s.busy||s.st)return;sync(id,el.closest('[data-od]'));
 const lines=o.lines.map(l=>({pid:l.pid,qty:s.q[l.pid]!==undefined?s.q[l.pid]:l.qty})).filter(l=>l.qty>0);
 if(!lines.length)return toast('לא נשארו מוצרים בטיוטה. כדי לוותר עליה – "דחייה"');
 if(lines.some(l=>l.qty>100000))return toast('כמות גדולה מדי');
 s.busy=1;re();
 try{const r=await fnCall('secPrefs',{op:'od',id,st:'ok',lines});s.busy=0;s.st=r&&r.already?(r.st==='no'?'no':'ok'):'ok';re();toast(r&&r.already?'הטיוטה כבר הוכרעה':'✓ נוסף לרשימה "להזמין מספקים" ('+lines.length+')');try{if(root.__so)root.__so.L=null}catch(e){}}
 catch(e){s.busy=0;re();toast(e&&e.reason==='perm-no'?'מנהל־העל הגדיר: טיוטת הזמנה מספק – אסור':e&&e.reason==='not-found'?'הטיוטה כבר לא קיימת':(e&&e.message)||'האישור נכשל')}};
ACT.odNo=async el=>{const id=el.dataset.id,s=dOf(id);if(s.busy||s.st)return;s.busy=1;re();
 try{const r=await fnCall('secPrefs',{op:'od',id,st:'no'});s.busy=0;s.st=r&&r.already?(r.st==='ok'?'ok':'no'):'no';re();toast(r&&r.already?'הטיוטה כבר הוכרעה':'הטיוטה נדחתה')}
 catch(e){s.busy=0;re();toast((e&&e.message)||'הפעולה נכשלה')}};
ACT.odList=()=>{try{go('oxSup')}catch(e){}};
root.__secOdN=()=>ods().filter(o=>!dOf(o.id).st).length;

/* שמות ליומן הפעולות */
{const N=root.__secActs;if(N&&typeof N==='object'){const add={odNew:'גיטי הכינה טיוטות הזמנה מספקים (ממתינות לאישור)',odOk:'טיוטת הזמנה מספק אושרה – נוספה ל"להזמין מספקים"',odNo:'טיוטת הזמנה מספק נדחתה'};Object.keys(add).forEach(k=>{if(!N[k])N[k]=add[k]})}}
})(typeof window!=='undefined'?window:this);
