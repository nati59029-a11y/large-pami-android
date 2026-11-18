/* שכר – הגדרות עובד (שלב ב', משימה 2026-11-18_שכר-ותלושים). קובץ עצמאי, נטען אחרי index.html (ואחרי payroll-core.js).
   בלי הקובץ הזה, או כשהמשתמש אינו מנהל – שום דבר לא משתנה: כרטיס העובד נראה כמו קודם.
   index.html קורא ל-payCardH(s) בכרטיס עובד (קטגוריה beh==='emp'): שורה "הגדרות שכר" ← המסך V.payCfg.
   נשמר ב-subs[].pay (רשות; עובד בלי pay = כמו היום):
     {mode:'hr'|'mo', rate, mo, m, slip, uid, rules:[{id,d:[0..6],s,e,r}], add:[{id,n,k:'mo'|'day',a}]}
     mode – לפי שעה (ברירת מחדל) / חודשי; rate – ש"ח לשעה; mo – ש"ח לחודש; m – אמצעי תשלום מתוך SAL_METHODS ('' = לא נבחר);
     slip – מקבל תלוש; uid – המשתמש באפליקציה (מרשימת העובדים של העסק, ADM.staff); rules – תעריף לפי ימים ושעות
     (סיום מוקדם מההתחלה = חוצה חצות); add – תוספות קבועות (לחודש / ליום עבודה). שדות אחרים ב-pay (משלבים הבאים) נשמרים כמו שהם.
   מנהל בלבד (isA). השכר לא נשלח לעובדים: pubCfg מפרסם רק id ושם של כרטיס.
   רכיבי העיצוב הקיימים בלבד (.card .btn .chip .f .sec .note .li .tag .cb .row).
   משתמש ב: V, ACT, FRM, isA, isW, subById, cat, save, dlg?, toast, go, goBack, cur, rerender, esc, fld, selO, pNum, uid, SAL_METHODS, ADM, admStaffOk, admStaffLoad.
   שלב ג' (שכר חודשי, בסוף הקובץ) משתמש גם ב: S, CHG, PayCore, pmon, NOWM, today, dfmt, mfmt, ils, txRow, dlg, closeDlg, ask, s_. */
(function(){
'use strict';
if(typeof V==='undefined'||typeof ACT==='undefined'||typeof FRM==='undefined'||typeof isA!=='function'||typeof subById!=='function'||typeof save!=='function'||typeof SAL_METHODS==='undefined')return;
const on=()=>{try{return isA()&&!(typeof isW==='function'&&isW())}catch(e){return false}};
const DN=['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳'];
const MAXR=20,MAXA=20,MAXN=60;
const KN={mo:'לחודש',day:'ליום עבודה'};
const big='style="min-height:48px"';
const G2='style="display:grid;grid-template-columns:1fr 1fr;gap:8px"';/* שני שדות בשורה, גם במסך צר */
const hmOk=v=>/^([01]\d|2[0-3]):[0-5]\d$/.test(v||'');
/* מספר חיובי (גם "45,50" או "₪45"), עד 2 ספרות אחרי הנקודה; אחרת null */
const posN=v=>{const n=pNum(v);return typeof n==='number'&&isFinite(n)&&n>0&&n<1e7?Math.round(n*100)/100:null};
const empOf=id=>{try{const s=subById(id);return s&&(cat(s.cat)||{}).beh==='emp'?s:null}catch(e){return null}};
const str=v=>v==null?'':String(v);
/* טיוטה של המסך: נשמרת רק ב"שמירה" */
const PD={sub:'',p:null};
function draft(s){const p=s.pay&&typeof s.pay==='object'&&!Array.isArray(s.pay)?s.pay:{};
 return{mode:p.mode==='mo'?'mo':'hr',rate:str(p.rate),mo:str(p.mo),m:SAL_METHODS.includes(p.m)?p.m:'',slip:!!p.slip,uid:typeof p.uid==='string'?p.uid:'',
  rules:(Array.isArray(p.rules)?p.rules:[]).filter(r=>r&&typeof r==='object').map(r=>({id:typeof r.id==='string'&&r.id?r.id:uid(),d:Array.isArray(r.d)?r.d.map(Number).filter(k=>Number.isInteger(k)&&k>=0&&k<=6):[],s:str(r.s),e:str(r.e),r:str(r.r)})),
  add:(Array.isArray(p.add)?p.add:[]).filter(a=>a&&typeof a==='object').map(a=>({id:typeof a.id==='string'&&a.id?a.id:uid(),n:str(a.n),k:a.k==='day'?'day':'mo',a:str(a.a)}))}}
/* קורא את הטופס שעל המסך לתוך הטיוטה (לפני ציור מחדש, כדי שמה שהוקלד לא יימחק) */
function pull(){const f=document.querySelector('#main form[data-f=payCfgF]'),p=PD.p;if(!f||!p)return;const g=n=>{const e=f.elements[n];return e?e.value:undefined};
 const set=(k,n)=>{const v=g(n);if(v!==undefined)p[k]=v};set('rate','rate');set('mo','mo');set('m','m');set('uid','uid');
 if(f.elements.slip)p.slip=f.elements.slip.checked;
 p.rules.forEach((r,i)=>{['s','e','r'].forEach(k=>{const v=g('r'+k+i);if(v!==undefined)r[k]=v})});
 p.add.forEach((a,i)=>{const n=g('an'+i),k=g('ak'+i),v=g('aa'+i);if(n!==undefined)a.n=n;if(k!==undefined)a.k=k==='day'?'day':'mo';if(v!==undefined)a.a=v})}
const re=()=>{pull();rerender()};

/* ---- רשימת המשתמשים באפליקציה (עובדי העסק) – אותה רשימה של מסך "עובדים" ---- */
let stTry=0;
function staff(){try{if(typeof ADM==='undefined'||typeof admStaffOk!=='function'||!admStaffOk())return{L:null,why:'רשימת המשתמשים זמינה רק בעסק במבנה החדש.'};
 if(ADM.staff)return{L:ADM.staff};if(ADM.staffErr)return{L:null,why:ADM.staffErr};
 if(!ADM.sbusy&&stTry<2){stTry++;Promise.resolve(admStaffLoad()).catch(()=>{}).then(()=>{if(cur().v==='payCfg')re()})}
 else if(ADM.sbusy)setTimeout(()=>{if(cur().v==='payCfg'&&!ADM.sbusy)re()},900);
 return{L:null,why:'טוען את רשימת המשתמשים…'}}catch(e){return{L:null,why:'רשימת המשתמשים לא זמינה כרגע.'}}}
const uName=u=>u.name||String(u.email||'').split('@')[0]||u.uid;

/* ---- שורה בכרטיס העובד ---- */
function sumLine(p){if(!p||typeof p!=='object')return 'לא הוגדר';const a=[];
 if(p.mode==='mo')a.push('חודשי'+(posN(p.mo)?' '+ils(p.mo):''));else a.push('לפי שעה'+(posN(p.rate)?' '+ils(p.rate):''));
 if(p.m)a.push(p.m);if(p.slip)a.push('תלוש');const nr=Array.isArray(p.rules)?p.rules.length:0,na=Array.isArray(p.add)?p.add.length:0;
 if(nr)a.push(nr+' כללי תעריף');if(na)a.push(na+' תוספות');return a.join(' · ')}
window.payCardH=s=>{try{if(!on()||!s||!empOf(s.id))return'';
 return `<button class="li" data-a="payOpen" data-id="${esc(s.id)}"><div class="m"><b>הגדרות שכר</b><small>${esc(sumLine(s.pay))}</small></div>${s.pay?'':'<span class="tag">חדש</span>'}${typeof ico==='function'?ico('chev','chev'):''}</button>`+monRowH(s)}catch(e){return''}};
ACT.payOpen=el=>{if(!on())return;const s=empOf(el.dataset.id);if(!s)return;PD.sub=s.id;PD.p=draft(s);stTry=0;go('payCfg',s.id)};

/* ---- המסך ---- */
V.payCfg=id=>{const T='הגדרות שכר';if(!on())return{t:T,h:'<div class="empty">המסך זמין למנהל בלבד</div>'};const s=empOf(id);if(!s)return{t:T,h:'<div class="empty">הכרטיס לא נמצא</div>'};
 if(PD.sub!==s.id||!PD.p){PD.sub=s.id;PD.p=draft(s)}const p=PD.p,hr=p.mode!=='mo';
 const ch=(a,v,lbl,onn,x)=>`<button type="button" class="chip${onn?' on':''}" aria-pressed="${onn}" data-a="${a}" data-v="${v}" ${x||''}>${lbl}</button>`;
 let h=`<form data-f="payCfgF" novalidate>`;
 /* סוג שכר וסכום */
 h+=`<div class="card"><div class="sec" style="margin-top:0"><h3>סוג שכר</h3></div><div class="chips" role="group" aria-label="סוג שכר" style="margin-bottom:10px">${ch('payMode','hr','לפי שעה',hr)}${ch('payMode','mo','חודשי קבוע',!hr)}</div>`;
 h+=hr?fld('תעריף לשעה (₪)','rate',p.rate,'text','inputmode="decimal" autocomplete="off" placeholder="למשל 45"'):fld('סכום חודשי (₪)','mo',p.mo,'text','inputmode="decimal" autocomplete="off" placeholder="למשל 8000"');
 h+=selO('אמצעי תשלום','m',[['','לא נבחר'],...SAL_METHODS],p.m);
 h+=`<label class="cb"><input type="checkbox" name="slip" value="1"${p.slip?' checked':''}> מקבל תלוש</label></div>`;
 /* קישור למשתמש */
 const st=staff(),L=st.L||[],known=!p.uid||L.some(u=>u.uid===p.uid);
 const opts=[['','בלי קישור'],...L.map(u=>[u.uid,uName(u)+(u.active===false?' (מושבת)':'')]),...(known?[]:[[p.uid,'משתמש שמור (לא ברשימה)']])];
 h+=`<div class="card"><div class="sec" style="margin-top:0"><h3>קישור למשתמש באפליקציה</h3></div>${selO('המשתמש של העובד','uid',opts,p.uid)}<p class="note" style="margin:0">${st.L?(L.length?'מחברים פעם אחת. לפי הקישור יופיעו בהמשך השעות והמשימות של העובד.':'אין עדיין משתמשים בעסק. אפשר להוסיף במסך "עובדים".'):esc(st.why)+' אפשר לשמור בלי קישור ולחבר אחר כך.'}</p></div>`;
 /* כללי תעריף */
 h+=`<div class="sec"><h3>שכר שונה לשעות מסוימות</h3></div>`;
 if(!hr)h+=`<p class="note">בשכר חודשי כללי התעריף לא משמשים לחישוב.${p.rules.length?' הכללים שהוגדרו נשמרים.':''}</p>`;
 else{h+=p.rules.length?'':'<p class="note">אין כללים – כל השעות לפי התעריף הרגיל.</p>';
  h+=p.rules.map((r,i)=>`<div class="card"><div class="chips" role="group" aria-label="ימים" style="margin-bottom:8px;gap:4px">${DN.map((n,d)=>ch('payDay',d,n,r.d.includes(d),`data-i="${i}" style="min-width:42px;padding:0;justify-content:center"`)).join('')}</div>
<div ${G2}>${fld('משעה','rs'+i,r.s,'time')}${fld('עד שעה','re'+i,r.e,'time')}</div>${fld('תעריף לשעה (₪)','rr'+i,r.r,'text','inputmode="decimal" autocomplete="off"')}
<button type="button" class="btn g s" data-a="payRuleDel" data-i="${i}">מחיקת הכלל</button></div>`).join('');
  h+=p.rules.length<MAXR?`<button type="button" class="btn g w" ${big} data-a="payRuleAdd">＋ כלל תעריף</button><p class="note">שעת סיום מוקדמת משעת ההתחלה = עד אחרי חצות (למשל <bdi dir="ltr">22:00–06:00</bdi>). חפיפה בין כללים – התעריף הגבוה.</p>`:''}
 /* תוספות קבועות */
 h+=`<div class="sec"><h3>תוספות קבועות</h3></div>`;
 h+=p.add.length?'':'<p class="note">אין תוספות.</p>';
 h+=p.add.map((a,i)=>`<div class="card">${fld('שם התוספת','an'+i,a.n,'text',`maxlength="${MAXN}" autocomplete="off" placeholder="למשל נסיעות"`)}<div ${G2}>${selO('סוג','ak'+i,[['mo',KN.mo],['day',KN.day]],a.k)}${fld('סכום (₪)','aa'+i,a.a,'text','inputmode="decimal" autocomplete="off"')}</div>
<button type="button" class="btn g s" data-a="payAddDel" data-i="${i}">מחיקת התוספת</button></div>`).join('');
 if(p.add.length<MAXA)h+=`<button type="button" class="btn g w" ${big} data-a="payAddAdd">＋ תוספת קבועה</button>`;
 h+=`<button type="submit" class="btn w" ${big} style="margin-top:16px">שמירה</button><p class="note">הגדרות השכר גלויות למנהל בלבד.</p></form>`;
 return{t:T,s:s.name,h}};

ACT.payMode=el=>{if(!on()||!PD.p)return;pull();PD.p.mode=el.dataset.v==='mo'?'mo':'hr';rerender()};
ACT.payDay=el=>{if(!on()||!PD.p)return;pull();const r=PD.p.rules[+el.dataset.i],d=+el.dataset.v;if(!r)return;const k=r.d.indexOf(d);if(k>=0)r.d.splice(k,1);else{r.d.push(d);r.d.sort()}rerender()};
ACT.payRuleAdd=()=>{if(!on()||!PD.p)return;pull();if(PD.p.rules.length>=MAXR)return;PD.p.rules.push({id:uid(),d:[],s:'',e:'',r:''});rerender()};
ACT.payRuleDel=el=>{if(!on()||!PD.p)return;pull();PD.p.rules.splice(+el.dataset.i,1);rerender()};
ACT.payAddAdd=()=>{if(!on()||!PD.p)return;pull();if(PD.p.add.length>=MAXA)return;PD.p.add.push({id:uid(),n:'',k:'mo',a:''});rerender()};
ACT.payAddDel=el=>{if(!on()||!PD.p)return;pull();PD.p.add.splice(+el.dataset.i,1);rerender()};

/* אימות ושמירה. מחזיר הודעת שגיאה, או את האובייקט לשמירה */
function build(p){const o={mode:p.mode==='mo'?'mo':'hr'};
 const rate=s_(p.rate),mo=s_(p.mo);
 if(rate){const v=posN(rate);if(v==null)return 'תעריף לשעה: מספר חיובי';o.rate=v}
 if(mo){const v=posN(mo);if(v==null)return 'סכום חודשי: מספר חיובי';o.mo=v}
 if(o.mode==='hr'&&o.rate==null)return 'חסר תעריף לשעה';
 if(o.mode==='mo'&&o.mo==null)return 'חסר סכום חודשי';
 o.m=SAL_METHODS.includes(p.m)?p.m:'';o.slip=!!p.slip;o.uid=typeof p.uid==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(p.uid)?p.uid:'';
 o.rules=[];for(let i=0;i<p.rules.length;i++){const r=p.rules[i],n='כלל תעריף '+(i+1)+': ';
  if(!r.d.length)return n+'בחרו לפחות יום אחד';if(!hmOk(r.s)||!hmOk(r.e))return n+'שעה בפורמט HH:MM';if(r.s===r.e)return n+'שעת ההתחלה והסיום זהות';
  const v=posN(r.r);if(v==null)return n+'תעריף: מספר חיובי';o.rules.push({id:r.id,d:[...new Set(r.d)].sort(),s:r.s,e:r.e,r:v})}
 o.add=[];for(let i=0;i<p.add.length;i++){const a=p.add[i],n='תוספת '+(i+1)+': ',nm=s_(a.n).slice(0,MAXN);
  if(!nm)return n+'חסר שם';const v=posN(a.a);if(v==null)return n+'סכום: מספר חיובי';o.add.push({id:a.id,n:nm,k:a.k==='day'?'day':'mo',a:v})}
 return o}
FRM.payCfgF=()=>{if(!on()||!PD.p)return;const s=empOf(PD.sub);if(!s)return toast('הכרטיס לא נמצא');pull();const o=build(PD.p);if(typeof o==='string')return toast(o);
 const old=s.pay&&typeof s.pay==='object'&&!Array.isArray(s.pay)?s.pay:{};s.pay=Object.assign({},old,o);save();PD.sub='';PD.p=null;toast('הגדרות השכר נשמרו');
 if(cur().v==='payCfg'&&NAV.length>1){NAV.pop();render(0,true)}else rerender()};
/* ===== שלב ג': שכר חודשי – שעות, בונוס, סיכום ו"נשאר להעביר" (מנהל בלבד) =====
   החישוב כולו ב-PayCore.monthSum (payroll-core.js, באגורות). כאן רק תצוגה והזנה.
   שעות: S.wh {id,sub,d,in,out,brk,src,n}. הזנה ידנית = src:'man'. שורה מכספית (src:'cx', בעתיד) – בעריכה המקור נשמר ב-cx {d,in,out,brk} (פעם אחת, לא נדרס).
   בונוס: S.bon {id,sub,mon,a,n} – פירוט "על מה" חובה.
   שולם: רק רשומות tx בקטגוריה beh==='emp' של אותו כרטיס, לפי "חודש המשכורת" (pmon), בלי x (חיוב שאינו נספר) ובלי ec (עלות מעביד).
   התשלומים עצמם נרשמים בזרימות הקיימות (משכורת / הוצאה מקופה / צילום העברה) – לא כאן. ביטול צילום העברה מוחק את הרשומות ← החודש נפתח שוב.
   S.wh/S.bon/S.psl נשמרים עם S (save, גיבוי מוצפן ושחזור דרך ensure) ואינם נכנסים למראה לעובדים (wvWant קורא רק tx). */
const PC=()=>typeof PayCore!=='undefined'&&PayCore&&typeof PayCore.monthSum==='function'?PayCore:null;
const ag=a=>ils((a||0)/100);
const z2=n=>String(n).padStart(2,'0');
const hmF=m=>{m=Math.max(0,Math.round(m||0));return Math.floor(m/60)+':'+z2(m%60)};
const monV=m=>/^\d{4}-(0[1-9]|1[0-2])$/.test(m||'');
const curMon=()=>{try{return NOWM()}catch(e){const d=new Date();return d.getFullYear()+'-'+z2(d.getMonth()+1)}};
const isEmpT=t=>!!t&&t.t==='exp'&&(cat(t.cat)||{}).beh==='emp';
const AR=k=>{if(!Array.isArray(S[k]))S[k]=[];return S[k]};
const MAXT=120;
const STL={open:'פתוח',closed:'נסגר',over:'שולם ביתר'};
const PM={sub:'',mon:''};
const whOf=(id,m)=>AR('wh').filter(r=>r&&r.sub===id&&typeof r.d==='string'&&r.d.slice(0,7)===m).sort((a,b)=>(a.d+(a.in||'')).localeCompare(b.d+(b.in||'')));
const bonOf=(id,m)=>AR('bon').filter(b=>b&&b.sub===id&&b.mon===m);
const paidL=(id,m)=>S.tx.filter(t=>isEmpT(t)&&t.sub===id&&!t.x&&!t.ec&&pmon(t)===m).sort((a,b)=>(a.date||'').localeCompare(b.date||''));
function monSum(s,m){const P=PC();if(!P||!s||!s.pay)return null;try{return P.monthSum(s,m,{wh:AR('wh'),bon:AR('bon'),psl:AR('psl'),tx:S.tx.filter(isEmpT),pmon})}catch(e){return null}}
const stH=r=>!r?'':r.due===0&&r.paid===0?'אין סכום לחודש':STL[r.status]||'';
function monRowH(s){if(!s.pay||!PC())return'';const m=curMon(),r=monSum(s,m);if(!r)return'';
 const t=r.due===0&&r.paid===0?'אין סכום לחודש':r.status==='over'?'שולם ביתר '+ag(-r.left):r.status==='closed'?'נסגר':'נשאר להעביר '+ag(r.left);
 return `<button class="li" data-a="payMonOpen" data-id="${esc(s.id)}"><div class="m"><b>שכר חודשי</b><small>${esc(mfmt(m))} · ${esc(t)}</small></div>${typeof ico==='function'?ico('chev','chev'):''}</button>`}
ACT.payMonOpen=el=>{if(!on())return;const s=empOf(el.dataset.id);if(!s||!s.pay)return;PM.sub=s.id;PM.mon=curMon();go('payMon',s.id)};
CHG.payMonM=el=>{if(!on())return;if(monV(el.value)){PM.mon=el.value;rerender()}};

V.payMon=id=>{const T='שכר חודשי';if(!on())return{t:T,h:'<div class="empty">המסך זמין למנהל בלבד</div>'};const s=empOf(id);if(!s)return{t:T,h:'<div class="empty">הכרטיס לא נמצא</div>'};
 if(!s.pay)return{t:T,s:s.name,h:'<div class="empty">לעובד עוד אין הגדרות שכר</div>'};
 if(PM.sub!==s.id||!monV(PM.mon)){PM.sub=s.id;PM.mon=curMon()}const m=PM.mon,r=monSum(s,m);
 if(!r)return{t:T,s:s.name,h:'<div class="empty">חישוב השכר לא זמין כרגע</div>'};
 const slip=!!s.pay.slip,K=(k,l,v,x)=>`<button class="k${x||''}" data-a="payBrk" data-k="${k}" style="font:inherit;color:inherit;text-align:inherit;width:100%;cursor:pointer"><small>${l} ›</small><b>${v}</b></button>`;
 let h=`<div class="card"><label class="f" style="margin:0"><span>חודש</span><input type="month" data-c="payMonM" value="${esc(m)}"></label></div>`;
 const big=r.status==='over'?-r.left:Math.max(0,r.left);
 h+=`<div class="hero"><small>${esc(mfmt(m))}${s.pay.m?' · '+esc(s.pay.m):''}${slip?' · תלוש':''}</small><div class="big">${ag(big)}</div><small>${r.status==='over'?'שולם ביתר':'נשאר להעביר'} · <b data-st="${r.status}">${esc(stH(r))}</b></small></div>`;
 if(r.warnings.length)h+=`<div class="card"><span class="tag t1">לבדיקה</span>${r.warnings.map(w=>`<div class="note">${esc(w)}</div>`).join('')}</div>`;
 h+=`<div class="kg" style="margin-bottom:10px">${K('hrs','שעות · '+r.days+' ימים',hmF(r.minutes))}${K('base',r.mode==='mo'?'בסיס (חודשי)':'בסיס לפי שעות',ag(r.base))}${K('add','תוספות',ag(r.adds.reduce((a,x)=>a+x.amt,0)))}${K('bon',slip?'בונוס (לרו"ח)':'בונוס',ag(r.bonus))}${K('calc','לפי החישוב',ag(r.calc))}`;
 if(r.slip)h+=K('slip','לפי התלוש · הפרש '+ag(r.slip.diff),ag(r.slip.net));
 h+=`${K('paid','שולם',ag(r.paid))}${K('left',r.status==='over'?'שולם ביתר':'נשאר להעביר',ag(Math.abs(r.left)),r.status==='open'?' neg':'')}</div>`;
 /* שעות */
 const W=whOf(s.id,m),P=PC();
 h+=`<div class="sec"><h3>שעות עבודה</h3></div>`;
 h+=W.length?W.map(w=>{const sm=P.shiftMin(w),x=[];x.push(sm.ok?hmF(sm.min)+' שעות':'שורה לא תקינה');if(+w.brk>0)x.push('הפסקה '+(+w.brk)+' דק׳');if(w.src==='cx')x.push('כספית');if(w.n)x.push(String(w.n));
  return `<button class="li" data-a="payWhEd" data-id="${esc(w.id)}"><div class="m"><b>${esc(dfmt(w.d))} · <bdi dir="ltr">${esc(w.in||'')}–${esc(w.out||'')}</bdi></b><small>${esc(x.join(' · '))}</small></div>${typeof ico==='function'?ico('chev','chev'):''}</button>`}).join(''):'<p class="note">אין שעות בחודש הזה.</p>';
 h+=`<button type="button" class="btn g w" ${big_} data-a="payWhEd">＋ הוספת שעות</button>`;
 /* בונוס */
 const B=bonOf(s.id,m);
 h+=`<div class="sec"><h3>בונוס חודשי</h3></div>`;
 h+=B.length?B.map(b=>`<button class="li" data-a="payBonEd" data-id="${esc(b.id)}"><div class="m"><b>${ag(PayCore.toAg(b.a))}</b><small>${esc(b.n||'')}</small></div>${typeof ico==='function'?ico('chev','chev'):''}</button>`).join(''):'<p class="note">אין בונוס בחודש הזה.</p>';
 h+=`<button type="button" class="btn g w" ${big_} data-a="payBonEd">＋ בונוס</button>`;
 if(slip)h+=`<p class="note">עובד בתלוש: הבונוס לא נכנס לחישוב, ועובר לרואה החשבון. הסכום הסופי – לפי התלוש.</p>`;
 /* לרואה החשבון */
 if(slip){h+=`<div class="sec"><h3>להעביר לרואה החשבון</h3></div><div class="card">${accL(r).map(([a,b])=>`<div class="row" style="justify-content:space-between;margin:4px 0"><span>${esc(a)}</span><b>${esc(b)}</b></div>`).join('')}</div>`}
 /* תשלומים */
 const L=paidL(s.id,m);
 h+=`<div class="sec"><h3>תשלומים לחודש</h3></div>`;
 h+=L.length?L.map(t=>txRow(t)).join(''):'<p class="note">עוד לא נרשם תשלום לחודש הזה.</p>';
 h+=`<p class="note">תשלום נרשם כ"משכורת" (מזומן או העברה), בהוצאה מקופה או בצילום העברה, לפי חודש המשכורת. כשהסכום הושלם – החודש נסגר.</p>`;
 /* שיתוף (שלב ד') – payroll-out.js */
 h+=`<div class="sec"><h3>שיתוף</h3></div><div class="card"><div class="row"><button type="button" class="btn g w" ${big_} data-a="payOut" data-o="emp" data-f="pdf">פירוט לעובד – PDF</button><button type="button" class="btn g w" ${big_} data-a="payOut" data-o="emp" data-f="xlsx">פירוט לעובד – אקסל</button></div>`+(slip?`<div class="row" style="margin-top:8px"><button type="button" class="btn g w" ${big_} data-a="payOut" data-o="acc" data-f="pdf">דוח לרואה החשבון – PDF</button><button type="button" class="btn g w" ${big_} data-a="payOut" data-o="acc" data-f="xlsx">דוח לרואה החשבון – אקסל</button></div>`:'')+`</div>`;
 return{t:T,s:s.name,h}};
ACT.payOut=el=>{if(!on()||PM.outBusy)return;const s=empOf(PM.sub);if(!s||!s.pay||!monV(PM.mon))return;const o=el.dataset.o,f=el.dataset.f==='xlsx'?'xlsx':'pdf',m=PM.mon;
 if(!window.PayOut)return toast('ההפקה לא זמינה');if(o==='acc'&&!s.pay.slip)return;
 const bs=()=>Array.from(document.querySelectorAll('[data-a=payOut]')),dis=v=>bs().forEach(b=>{b.disabled=v});PM.outBusy=true;dis(true);
 let p;try{p=o==='acc'?PayOut.accReport(m,f):PayOut.empReport(s.id,m,f)}catch(e){p=Promise.reject(e)}
 Promise.resolve(p).then(r=>{if(r&&r.ok)toast('הקובץ מוכן');else toast('ההפקה נכשלה')}).catch(()=>toast('ההפקה נכשלה')).then(()=>{PM.outBusy=false;dis(false)})};
const big_='style="min-height:48px"';
function accL(r){const o=[['חודש',mfmt(r.mon)],['שעות',hmF(r.minutes)],['ימי עבודה',String(r.days)],[r.mode==='mo'?'שכר חודשי':'בסיס לפי שעות',ag(r.base)]];
 r.adds.forEach(a=>o.push(['תוספת: '+(a.n||'—')+(a.k==='day'?' ('+a.cnt+' ימים)':''),ag(a.amt)]));
 r.toAccountant.forEach(b=>o.push(['בונוס: '+(b.n||'—'),ag(b.a)]));
 if(r.slip)o.push(['נטו לפי התלוש',ag(r.slip.net)]);return o}

/* מספר לחיץ ← השורות שמרכיבות אותו */
const LN=(a,b)=>`<div class="row" style="justify-content:space-between;margin:6px 0;flex-wrap:nowrap"><span style="min-width:0">${a}</span><b style="white-space:nowrap">${b}</b></div>`;
ACT.payBrk=el=>{if(!on())return;const s=empOf(PM.sub);if(!s)return;const r=monSum(s,PM.mon);if(!r)return;const k=el.dataset.k;let t='',b='';
 const tot=v=>`<hr style="border:0;border-top:1px solid var(--line);margin:8px 0">${LN('<b>סה״כ</b>',v)}`;
 if(k==='hrs'){t='שעות – '+mfmt(r.mon);b=r.rows.length?r.rows.map(x=>LN(esc(dfmt(x.d)),hmF(x.min))).join('')+tot(hmF(r.minutes)+' · '+r.days+' ימים'):'<p class="note">אין שעות.</p>'}
 else if(k==='base'){t='בסיס';b=r.mode==='mo'?LN('שכר חודשי קבוע',ag(r.base)):(r.rows.length?r.rows.map(x=>x.buckets.map(q=>LN(esc(dfmt(x.d))+' · '+hmF(q.min)+' × '+ag(q.rAg),ag(Math.round(q.min*q.rAg/60)))).join('')).join('')+tot(ag(r.base))+'<p class="note">הסכום מעוגל פעם אחת בסוף.</p>':'<p class="note">אין שעות.</p>')}
 else if(k==='add'){t='תוספות';b=r.adds.length?r.adds.map(a=>LN(esc(a.n||'—')+(a.k==='day'?' · '+ag(a.per)+' × '+a.cnt+' ימים':' · לחודש'),ag(a.amt))).join('')+tot(ag(r.adds.reduce((x,a)=>x+a.amt,0))):'<p class="note">אין תוספות.</p>'}
 else if(k==='bon'){t='בונוס';b=r.bons.length?r.bons.map(x=>LN(esc(x.n||'—'),ag(x.a))).join('')+tot(ag(r.bonus)):'<p class="note">אין בונוס.</p>';if(s.pay.slip)b+='<p class="note">עובד בתלוש: הבונוס עובר לרואה החשבון ולא נכנס לחישוב.</p>'}
 else if(k==='calc'){t='לפי החישוב';b=LN('בסיס',ag(r.base))+LN('תוספות',ag(r.adds.reduce((x,a)=>x+a.amt,0)))+(s.pay.slip?'':LN('בונוס',ag(r.bonus)))+tot(ag(r.calc))}
 else if(k==='slip'&&r.slip){t='תלוש';b=LN('נטו לפי התלוש',ag(r.slip.net))+LN('לפי החישוב',ag(r.calc))+LN('הפרש (חישוב פחות תלוש)',ag(r.slip.diff))+'<p class="note">התלוש גובר על החישוב.</p>'}
 else if(k==='paid'){t='שולם – '+mfmt(r.mon);const L=paidL(s.id,r.mon);b=L.length?L.map(x=>txRow(x)).join('')+tot(ag(r.paid)):'<p class="note">עוד לא נרשם תשלום.</p>'}
 else if(k==='left'){t=r.status==='over'?'שולם ביתר':'נשאר להעביר';b=LN(r.slip?'לתשלום לפי התלוש':'לתשלום לפי החישוב',ag(r.due))+LN('שולם',ag(r.paid))+tot(ag(Math.abs(r.left)))+`<p class="note">סטטוס: ${esc(stH(r))}</p>`}
 else return;
 dlg(`<h3>${esc(t)}</h3>${b}<button type="button" class="btn g w" style="margin-top:12px" data-a="closeDlg">סגירה</button>`)};

/* הזנת שעות */
const brkOk=v=>v===''||/^\d{1,4}$/.test(v);
ACT.payWhEd=el=>{if(!on())return;const s=empOf(PM.sub);if(!s||!s.pay)return;const id=el.dataset.id||'',w=id?AR('wh').find(x=>x&&x.id===id&&x.sub===s.id):null;if(id&&!w)return toast('השורה לא נמצאה');
 const d0=w?str(w.d):(PM.mon===curMon()?today():PM.mon+'-01');
 dlg(`<h3>${w?'עריכת שעות':'הוספת שעות'}</h3><form data-f="payWhF" novalidate><input type="hidden" name="id" value="${esc(id)}">${fld('תאריך','d',d0,'date')}<div ${G2}>${fld('כניסה','in',w?str(w.in):'','time')}${fld('יציאה','out',w?str(w.out):'','time')}</div>${fld('הפסקה (דקות)','brk',w&&w.brk!=null?str(w.brk):'','text','inputmode="numeric" autocomplete="off" placeholder="0"')}${fld('הערה','n',w?str(w.n):'','text',`maxlength="${MAXT}" autocomplete="off"`)}
<p class="note">יציאה מוקדמת מהכניסה = עד אחרי חצות.${w&&w.src==='cx'?' השורה הגיעה מכספית – הערכים המקוריים נשמרים.':''}</p><div class="row"><button type="submit" class="btn grow" ${big_}>שמירה</button>${w?`<button type="button" class="btn r grow" ${big_} data-a="payWhDel" data-id="${esc(id)}">מחיקה</button>`:''}<button type="button" class="btn g grow" ${big_} data-a="closeDlg">ביטול</button></div></form>`)};
FRM.payWhF=f=>{if(!on())return;const s=empOf(PM.sub);if(!s||!s.pay)return toast('הכרטיס לא נמצא');const g=n=>s_((f.elements[n]||{}).value||'');
 const id=g('id'),d=g('d'),a=g('in'),b=g('out'),k=g('brk'),n=g('n').slice(0,MAXT);
 if(!PayCore.ymdOk(d))return toast('תאריך לא תקין');if(!hmOk(a)||!hmOk(b))return toast('שעת כניסה ויציאה בפורמט HH:MM');if(a===b)return toast('שעת הכניסה והיציאה זהות');
 if(!brkOk(k))return toast('הפסקה: מספר דקות שלם');const brk=k===''?0:+k,sm=PayCore.shiftMin({d,in:a,out:b,brk:0});if(brk>=sm.gross)return toast('ההפסקה ארוכה מהמשמרת');
 let w=null;if(id){w=AR('wh').find(x=>x&&x.id===id&&x.sub===s.id);if(!w)return toast('השורה לא נמצאה')}
 if(!w){w={id:uid(),sub:s.id,d,in:a,out:b,brk,src:'man',n};S.wh.push(w)}
 else{if(w.src==='cx'&&!(w.cx&&typeof w.cx==='object'&&!Array.isArray(w.cx)))w.cx=Object.assign(w.cx!=null&&w.cx!==''?{ref:w.cx}:{},{d:w.d,in:w.in,out:w.out,brk:w.brk});
  Object.assign(w,{d,in:a,out:b,brk,n});if(w.src!=='cx')w.src='man'}
 save();closeDlg();const mm=d.slice(0,7);if(mm!==PM.mon){PM.mon=mm;toast('השעות נשמרו ב'+mfmt(mm))}else toast('השעות נשמרו');rerender()};
ACT.payWhDel=el=>{if(!on())return;const id=el.dataset.id;ask('למחוק את שורת השעות?',()=>{const L=AR('wh'),i=L.findIndex(x=>x&&x.id===id&&x.sub===PM.sub);if(i>=0){L.splice(i,1);save();toast('השורה נמחקה')}rerender()},'מחיקה')};

/* בונוס חודשי */
ACT.payBonEd=el=>{if(!on())return;const s=empOf(PM.sub);if(!s||!s.pay)return;const id=el.dataset.id||'',b=id?AR('bon').find(x=>x&&x.id===id&&x.sub===s.id):null;if(id&&!b)return toast('הבונוס לא נמצא');
 dlg(`<h3>${b?'עריכת בונוס':'בונוס ל'+esc(mfmt(PM.mon))}</h3><form data-f="payBonF" novalidate><input type="hidden" name="id" value="${esc(id)}">${fld('סכום (₪)','a',b?str(b.a):'','text','inputmode="decimal" autocomplete="off"')}${fld('על מה','n',b?str(b.n):'','text',`maxlength="${MAXT}" autocomplete="off" placeholder="למשל עמידה ביעד מכירות"`)}
<div class="row"><button type="submit" class="btn grow" ${big_}>שמירה</button>${b?`<button type="button" class="btn r grow" ${big_} data-a="payBonDel" data-id="${esc(id)}">מחיקה</button>`:''}<button type="button" class="btn g grow" ${big_} data-a="closeDlg">ביטול</button></div></form>`)};
FRM.payBonF=f=>{if(!on())return;const s=empOf(PM.sub);if(!s||!s.pay)return toast('הכרטיס לא נמצא');const g=n=>s_((f.elements[n]||{}).value||'');
 const id=g('id'),a=posN(g('a')),n=g('n').slice(0,MAXT);if(a==null)return toast('סכום הבונוס: מספר חיובי');if(!n)return toast('חסר פירוט – על מה הבונוס');
 if(id){const b=AR('bon').find(x=>x&&x.id===id&&x.sub===s.id);if(!b)return toast('הבונוס לא נמצא');Object.assign(b,{a,n})}
 else{if(!monV(PM.mon))return toast('חודש לא תקין');AR('bon').push({id:uid(),sub:s.id,mon:PM.mon,a,n})}
 save();closeDlg();toast('הבונוס נשמר');rerender()};
ACT.payBonDel=el=>{if(!on())return;const id=el.dataset.id;ask('למחוק את הבונוס?',()=>{const L=AR('bon'),i=L.findIndex(x=>x&&x.id===id&&x.sub===PM.sub);if(i>=0){L.splice(i,1);save();toast('הבונוס נמחק')}rerender()},'מחיקה')};
})();
