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
   משתמש ב: V, ACT, FRM, isA, isW, subById, cat, save, dlg?, toast, go, goBack, cur, rerender, esc, fld, selO, pNum, uid, SAL_METHODS, ADM, admStaffOk, admStaffLoad. */
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
 return `<button class="li" data-a="payOpen" data-id="${esc(s.id)}"><div class="m"><b>הגדרות שכר</b><small>${esc(sumLine(s.pay))}</small></div>${s.pay?'':'<span class="tag">חדש</span>'}${typeof ico==='function'?ico('chev','chev'):''}</button>`}catch(e){return''}};
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
})();
