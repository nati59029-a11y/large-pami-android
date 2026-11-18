/* POS:M5 – קופה, ש5: משמרת. קובץ עצמאי, נטען אחרי pos-base.js. מתג 'pos' כבוי (או עסק במצב הקיים) = לא מוסיף כלום לשום מסך.
   V.posShift – משמרת ומזומן (במכשיר הרשום כקופה): פתיחת משמרת, הוצאה / הפקדה / הכנסה, מזומן צפוי ואזהרת תקרה (הקופאי מאשר),
                דוח X, סגירה בדוח Z (ספירת המגירה), החתמת כניסה / יציאה. אחראי משמרת / מנהל – גם רשימת המשמרות של כל הקופות.
   V.posStaff – עובדים וקוד (מנהל): מצב הקוד של כל עובד, איפוס קוד (רק לבעלים), דוח שעון נוכחות ותיקון החתמה. כל עובד קופה – קביעת הקוד שלו.
   window.PosShift – ממשק למסך המכירה (ש2): verify / approve / shift / open / mv / state / ack / x / z / clockIn / clockOut / drawer.
   כל כתיבה – רק דרך posAuth / posCash / posZ / posClock. סכומים באגורות; במסך – בשקלים.
   ממשקים של מודולים אחרים, עם גרסה מדומה עד שיהיו מוכנים:
     PosCfg.get(k)        (ש4) – ההגדרות; בלי PosCfg – posCfg מהשרת.
     Devices.openDrawer() (ש7) – פתיחת המגירה; בלי Devices – לא עושה כלום (מחזיר {mock:true}). */
(function(){
'use strict';
if(typeof ACT==='undefined'||typeof V==='undefined')return;
const fnCall=(n,d)=>{d=d&&typeof d==='object'?d:{};if(SY&&SY.sa&&SY.bizId&&!('bizId'in d))d=Object.assign({bizId:SY.bizId},d);return window.fnCall(n,d)};
const on=()=>{try{return bzF('pos')&&bzB()&&!SY.mg}catch(e){return false}};
const mgr=()=>{try{return isA()||!!(SY&&SY.sa)}catch(e){return false}};
const pv=k=>{try{const p=SY.perms;return !!(p&&typeof p==='object'&&p[k]===true)}catch(e){return false}};
const lead=()=>mgr()||(isW()&&pv('posMgr'));
const seller=()=>{try{if(SY&&SY.sa)return true;if(!isW()&&!isA())return false;return wp('pos')||wp('posMgr')}catch(e){return false}}; // 18.11.2026: גם מנהל רק עם המתג (wp)
const ls=(k,v)=>{try{if(v===undefined)return localStorage.getItem(k);if(v===null)localStorage.removeItem(k);else localStorage.setItem(k,v)}catch(e){return null}};
function myDev(){try{const o=JSON.parse(ls('lp-pos-dev')||'null');return o&&o.bizId===SY.bizId&&/^K[1-9][0-9]{0,3}$/.test(o.dev||'')?o.dev:''}catch(e){return ''}}
const inst=()=>ls('lp-pos-inst')||'';
const err=e=>toast(e&&e.message||'הפעולה נכשלה');
/* כסף: אגורות ↔ שקלים, בלי נקודה צפה */
const F=a=>{a=+a||0;const s=a<0?'-':'',v=Math.abs(a);return s+'₪'+Math.floor(v/100).toLocaleString('he-IL')+'.'+String(v%100).padStart(2,'0')};
function ag(s){s=String(s==null?'':s).trim().replace(/[₪\s]/g,'').replace(',','.');const m=/^([0-9]{1,7})(?:\.([0-9]{1,2}))?$/.exec(s);if(!m)return null;return (+m[1])*100+(+(String(m[2]||'').padEnd(2,'0')))}
const hm=t=>{const d=new Date(t);return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')};
const dmy=t=>{const d=new Date(t);return d.getDate()+'.'+(d.getMonth()+1)+'.'+d.getFullYear()};
const mins=m=>Math.floor(m/60)+':'+String(m%60).padStart(2,'0');

/* ---------- ממשקים של מודולים אחרים (מדומים עד שיתמזגו) ---------- */
const S={cfg:null,shift:null,state:null,shifts:null,staff:null,clk:null,clkOpen:undefined,rep:null,err:'',busy:0};
async function cfg(k){try{if(window.PosCfg&&typeof PosCfg.get==='function'){const v=await PosCfg.get(k);if(v!==undefined)return v}}catch(e){}
 if(!S.cfg)S.cfg=await fnCall('posCfg',{});return S.cfg&&S.cfg.cfg?S.cfg.cfg[k]:undefined}
async function drawer(){try{if(window.Devices&&typeof Devices.openDrawer==='function')return await Devices.openDrawer();return{mock:true}}catch(e){toast('המגירה לא נפתחה: '+(e&&e.message||e));return{ok:false}}}

/* ---------- המשמרת של המכשיר הזה (lp-pos-shift לכל עסק וקופה) ---------- */
const SK=()=>'lp-pos-shift-'+(SY&&SY.bizId||'')+'-'+myDev();
const curShift=()=>{const v=ls(SK());return /^K[1-9][0-9]{0,3}-S[0-9]{6}$/.test(v||'')?v:''};
const setShift=v=>ls(SK(),v||null);

const API={
 verify:(pin,uid)=>fnCall('posAuth',Object.assign({op:'verify',pin,dev:myDev()||undefined},uid?{uid}:{})),
 approve:o=>fnCall('posAuth',Object.assign({op:'approve',dev:myDev()||undefined},o)),
 shift:curShift,
 open:async open=>{const r=await fnCall('posCash',Object.assign({op:'open',dev:myDev(),inst:inst()},open==null?{}:{open}));setShift(r.shift);await drawer();return r},
 mv:async(k,a,note)=>{const r=await fnCall('posCash',{op:'mv',shift:curShift(),k,a,note});await drawer();return r},
 state:()=>fnCall('posCash',{op:'state',shift:curShift()}),
 ack:()=>fnCall('posCash',{op:'ack',shift:curShift()}),
 x:()=>fnCall('posZ',{op:'x',shift:curShift()}),
 z:async(counted,note)=>{const r=await fnCall('posZ',{op:'close',shift:curShift(),counted,note});setShift('');return r},
 clockIn:o=>fnCall('posClock',Object.assign({op:'in',dev:myDev()||undefined},o||{})),
 clockOut:o=>fnCall('posClock',Object.assign({op:'out',dev:myDev()||undefined},o||{})),
 drawer,
 /* בדיקת אזהרת התקרה אחרי מכירה במזומן (ש2 קורא אחרי כל מכירה): warn → הקופה מציגה אזהרה והקופאי מאשר ב-ack() */
 capCheck:async()=>{if(!curShift())return null;const r=await API.state();return r.cap}
};
window.PosShift=API;

const reset=()=>{Object.assign(S,{cfg:null,shift:null,state:null,shifts:null,staff:null,clk:null,clkOpen:undefined,rep:null,err:''})};
const ld={};
const typing=()=>{const a=document.activeElement;return !!(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)&&a.closest('#main'))};
const load=(k,fn)=>{if(ld[k]||S.err)return;ld[k]=1;fn().catch(e=>{S.err=e&&e.message||'הטעינה נכשלה'}).finally(()=>{ld[k]=0;if(['posShift','posStaff'].includes(cur().v)&&!typing()&&!document.querySelector('#dlg[open]'))rerender()})};
const deny=T=>({t:T,h:'<div class="empty">התכונה לא פעילה בעסק הזה</div>'});
const loading=T=>({t:T,h:S.err?`<div class="card"><p class="note" style="margin:0">${esc(S.err)}</p><button class="btn g w" data-a="pshRe" style="margin-top:10px">נסה שוב</button></div>`:'<div class="empty">טוען…</div>'});
const kv=(k,v,b)=>`<div class="row" style="justify-content:space-between;margin:4px 0"><span>${esc(k)}</span>${b?'<b>':'<span>'}${v}${b?'</b>':'</span>'}</div>`;

/* ---------- V.posShift ---------- */
async function stLoad(){const sh=curShift();S.shift=sh;S.state=null;if(sh){try{S.state=await API.state();if(S.state.st==='closed'){setShift('');S.shift='';S.state=null}}catch(e){if(e&&e.details&&e.details.reason==='no-shift'){setShift('');S.shift=''}else throw e}}
 const c=await fnCall('posClock',{op:'status'});S.clkOpen=c.open;
 if(lead()){const l=await fnCall('posCash',{op:'list'});S.shifts=l.shifts}else S.shifts=[];
 if(!S.shift)S.openDef=await cfg('openCashDef')}
function capH(cap,cashMax){if(!cap||!cap.over)return '';
 return `<div class="card" style="border-color:var(--warn)"><p style="margin:0 0 6px"><b>יש במגירה יותר מתקרת המזומן</b> (${F(cashMax)}) – ${F(cap.by)} מעל. מומלץ להפקיד.</p>${cap.warn?'<button class="btn w" data-a="pshAck">ראיתי – המשך</button>':'<p class="note" style="margin:0">האזהרה אושרה.</p>'}</div>`}
function repH(r){const c=r.cash||{},pay=Object.entries(r.pay||{}).map(([m,a])=>kv(m==='cash'?'מזומן':m==='card'?'אשראי':m,F(a))).join('');
 return kv('מכירות ('+r.n+')',F(r.sales))+kv('החזרות ('+r.nRet+')',F(r.rets))+kv('Z – מכירות פחות החזרות',F(r.z),1)+(r.voids?kv('בוטלו',String(r.voids)):'')+
  (pay?'<div class="sec"><h3>לפי אמצעי תשלום</h3></div>'+pay:'')+'<div class="sec"><h3>מזומן</h3></div>'+kv('פתיחה',F(c.open))+kv('מכירות במזומן',F(c.sales))+kv('החזרים במזומן',F(-c.refunds))+
  kv('הכנסות',F(c.in))+kv('הוצאות',F(-c.out))+kv('הפקדות',F(-c.drop))+kv('אמור להיות במגירה',F(c.expected),1)+(r.counted!=null?kv('נספר',F(r.counted))+kv('הפרש',F(r.diff),1):'')+
  (r.bad?`<p class="note">${r.bad} רשומות לא תקינות לא נספרו – פנו למנהל.</p>`:'')}
V.posShift=()=>{const T='משמרת ומזומן';if(!on()||!seller())return deny(T);
 if(S.clkOpen===undefined){load('sh',stLoad);return loading(T)}
 const dev=myDev();let h='';
 h+=`<div class="card"><div class="row" style="justify-content:space-between"><span>${S.clkOpen?'בעבודה מ-'+hm(S.clkOpen.in):'לא החתמת כניסה'}</span><button class="btn s${S.clkOpen?' g':''}" data-a="pshClk">${S.clkOpen?'החתמת יציאה':'החתמת כניסה'}</button></div></div>`;
 if(!dev)h+='<div class="card"><p class="note" style="margin:0">המכשיר הזה לא רשום כקופה. מנהל העסק רושם אותו במסך "ניהול קופה".</p></div>';
 else if(!S.shift)h+=`<div class="card"><h3 style="margin-top:0">פתיחת משמרת – ${esc(dev)}</h3><form data-f="pshOpen"><label class="f"><span>מזומן במגירה בפתיחה (₪)</span><input name="a" inputmode="decimal" dir="ltr" value="${S.openDef!=null?(S.openDef/100).toFixed(2):''}" required></label><button class="btn w">פתיחת משמרת ופתיחת המגירה</button></form></div>`;
 else{const st=S.state||{},c=st.cash||{};
  h+=capH(st.cap,st.cashMax);
  h+=`<div class="card"><h3 style="margin-top:0">משמרת ${esc(S.shift)}</h3>${kv('אמור להיות במגירה',F(c.expected),1)}${kv('פתיחה',F(c.open))}${kv('מכירות במזומן',F(c.sales))}${kv('הוצאות',F(c.out))}${kv('הפקדות',F(c.drop))}</div>
  <div class="card"><h3 style="margin-top:0">תנועה במגירה</h3><form data-f="pshMv"><label class="f"><span>סוג</span><select name="k"><option value="drop">הפקדה (הוצאת מזומן לכספת / לבנק)</option><option value="out">הוצאה (תשלום מהקופה)</option><option value="in">הכנסת מזומן למגירה</option></select></label>
   <label class="f"><span>סכום (₪)</span><input name="a" inputmode="decimal" dir="ltr" required></label><label class="f"><span>הערה (חובה בהוצאה)</span><input name="note" maxlength="120"></label><button class="btn w">רישום ופתיחת המגירה</button></form></div>
  <div class="card"><h3 style="margin-top:0">סגירת משמרת</h3><button class="btn g w" data-a="pshX">דוח X (בלי סגירה)</button>${S.rep?'<div style="margin-top:10px">'+repH(S.rep)+'</div>':''}
   <form data-f="pshZ" style="margin-top:10px"><label class="f"><span>כמה מזומן נספר במגירה (₪)</span><input name="a" inputmode="decimal" dir="ltr" required></label><label class="f"><span>הערה</span><input name="note" maxlength="200"></label><button class="btn w">סגירה – דוח Z</button></form></div>`}
 if(lead()&&S.shifts&&S.shifts.length)h+=`<div class="card"><h3 style="margin-top:0">משמרות אחרונות</h3>${S.shifts.map(x=>`<div class="li" style="cursor:default"><div class="m"><b>${esc(x.id)} <span class="tag ${x.st==='open'?'t3':'t1'}">${x.st==='open'?'פתוחה':'נסגרה'}</span></b><small>${dmy(x.openAt)} ${hm(x.openAt)}${x.closeAt?' – '+hm(x.closeAt):''}${x.z?' · '+esc(x.z):''}</small></div>${x.z?`<button class="btn s g" data-a="pshZv" data-id="${esc(x.z)}">דוח Z</button>`:''}</div>`).join('')}</div>`;
 return{t:T,h}};
ACT.pshRe=()=>{reset();rerender()};
ACT.pshClk=async el=>{el.disabled=true;try{if(S.clkOpen){const r=await API.clockOut();toast('יציאה נרשמה ('+mins(r.min)+' שעות)')}else{await API.clockIn();toast('כניסה נרשמה')}S.clkOpen=undefined;rerender()}catch(e){err(e)}finally{el.disabled=false}};
FRM.pshOpen=async f=>{const a=ag(f.elements.a.value);if(a==null)return toast('סכום לא תקין');try{const r=await API.open(a);toast('נפתחה משמרת '+r.shift);S.clkOpen=undefined;rerender()}catch(e){err(e)}};
FRM.pshMv=async f=>{const a=ag(f.elements.a.value),k=f.elements.k.value,note=f.elements.note.value.trim();if(!a)return toast('סכום לא תקין');if(k==='out'&&!note)return toast('כתבו על מה ההוצאה');
 try{const r=await API.mv(k,a,note);toast('נרשם. במגירה: '+F(r.cash.expected));S.clkOpen=undefined;rerender()}catch(e){err(e)}};
ACT.pshAck=async el=>{el.disabled=true;try{await API.ack();S.clkOpen=undefined;rerender()}catch(e){err(e)}finally{el.disabled=false}};
ACT.pshX=async el=>{el.disabled=true;try{S.rep=(await API.x()).rep;rerender()}catch(e){err(e)}finally{el.disabled=false}};
FRM.pshZ=async f=>{const a=ag(f.elements.a.value);if(a==null)return toast('כתבו כמה מזומן נספר');if(!(await ask('לסגור את המשמרת בדוח Z? אחרי הסגירה אי אפשר להוסיף לה מכירות.')))return;
 try{const r=await API.z(a,f.elements.note.value.trim());await drawer();S.rep=null;showZ(r.rep);S.clkOpen=undefined;rerender()}catch(e){err(e)}};
function showZ(r){const d=document.getElementById('dlg');const html=`<h3 style="margin-top:0">דוח Z ${esc(r.id||'')}</h3>${repH(r)}<button class="btn w" data-a="pshDlgX" style="margin-top:10px">סגירה</button>`;
 if(d&&typeof d.showModal==='function'){d.innerHTML=html;d.showModal()}else toast('דוח Z: '+F(r.z))}
ACT.pshDlgX=()=>{const d=document.getElementById('dlg');if(d&&d.open)d.close()};
ACT.pshZv=async el=>{try{const j=await fsx('/posz/'+encodeURIComponent(el.dataset.id));showZ(Object.assign({id:el.dataset.id},fvj({mapValue:j})))}catch(e){err(e)}};

/* ---------- V.posStaff ---------- */
const dayStart=t=>{const d=new Date(t);d.setHours(0,0,0,0);return d.getTime()};
async function staffLoad(){if(mgr()){S.staff=(await fnCall('posAuth',{op:'list'})).staff;const to=Date.now(),from=dayStart(to-6*86400000);S.clk=await fnCall('posClock',{op:'list',from,to:to+1})}else{S.staff=[];S.clk=null}}
V.posStaff=()=>{const T='עובדים וקוד';if(!on()||!(seller()||mgr()))return deny(T);
 if(!S.staff){load('st',staffLoad);return loading(T)}
 let h=`<div class="card"><h3 style="margin-top:0">הקוד שלי</h3><form data-f="pshPin"><label class="f"><span>קוד נוכחי (אם כבר יש)</span><input name="old" type="password" inputmode="numeric" maxlength="6" autocomplete="off"></label>
  <label class="f"><span>קוד חדש (4–6 ספרות)</span><input name="pin" type="password" inputmode="numeric" maxlength="6" autocomplete="off" required></label><button class="btn w">שמירת הקוד</button></form>
  <p class="note">הקוד משמש לכניסה לקופה ולאישורים. אחרי 5 ניסיונות שגויים הקופה ננעלת ל-30 שניות והמנהל מקבל התראה.</p></div>`;
 if(mgr()){const RN={manager:'מנהל',lead:'אחראי משמרת',cashier:'קופאי'};
  h+=`<div class="card"><h3 style="margin-top:0">עובדי הקופה</h3>${S.staff.length?S.staff.map(x=>`<div class="li" style="cursor:default"><div class="m"><b>${esc(x.name||x.uid)}</b><small>${RN[x.role]||''} · ${x.hasPin?'יש קוד':'אין קוד'}${x.locked?' · נעול ('+x.wait+' שניות)':''}</small></div>${x.hasPin||x.locked?`<button class="btn s g" data-a="pshReset" data-uid="${esc(x.uid)}" data-n="${esc(x.name||'')}">איפוס קוד</button>`:''}</div>`).join(''):'<div class="empty">אין עובדים עם הרשאת קופה</div>'}
   <p class="note">איפוס קוד – רק לבעלים. אחרי האיפוס העובד קובע קוד חדש בעצמו.</p></div>`;
  const c=S.clk||{recs:[],sum:{}},nm=Object.fromEntries(S.staff.map(x=>[x.uid,x.name]));
  h+=`<div class="card"><h3 style="margin-top:0">שעון נוכחות – 7 ימים אחרונים</h3>${Object.entries(c.sum).map(([u,s])=>kv(nm[u]||u,mins(s.min)+' שעות'+(s.open?' · בעבודה עכשיו':'')+(s.long?' · '+s.long+' בלי יציאה':''))).join('')||'<div class="empty">אין החתמות</div>'}
   ${c.recs.slice(-60).reverse().map(r=>`<div class="li" style="cursor:default"><div class="m"><b>${esc(r.name||nm[r.who]||r.who)}</b><small>${dmy(r.in)} ${hm(r.in)} – ${r.out?hm(r.out):'פתוח'} · ${mins(r.min)}${r.fix&&r.fix.length?' · תוקן':''}</small></div><button class="btn s g" data-a="pshFix" data-id="${esc(r.id)}" data-in="${r.in}" data-out="${r.out||''}">תיקון</button></div>`).join('')}</div>`}
 return{t:T,h}};
FRM.pshPin=async f=>{const pin=f.elements.pin.value.trim(),old=f.elements.old.value.trim();try{await fnCall('posAuth',Object.assign({op:'set',pin},old?{old}:{}));toast('הקוד נשמר');f.reset();if(mgr()){S.staff=null;rerender()}}catch(e){err(e)}};
ACT.pshReset=async el=>{if(!(await ask('לאפס את הקוד של '+(el.dataset.n||'העובד')+'?')))return;el.disabled=true;try{await fnCall('posAuth',{op:'reset',uid:el.dataset.uid});toast('הקוד אופס');S.staff=null;rerender()}catch(e){err(e)}finally{el.disabled=false}};
/* תיקון החתמה: שעת יציאה (HH:MM) באותו יום + סיבה */
ACT.pshFix=async el=>{const t=+el.dataset.in,o=el.dataset.out?+el.dataset.out:null;const s=prompt('שעת יציאה נכונה (למשל 17:30)',o?hm(o):'');if(s==null)return;const m=/^([01]?[0-9]|2[0-3]):([0-5][0-9])$/.exec(s.trim());if(!m)return toast('שעה לא תקינה');
 const d=new Date(t);d.setHours(+m[1],+m[2],0,0);const note=prompt('סיבת התיקון','');if(!note||!note.trim())return toast('חובה לכתוב סיבה');
 try{await fnCall('posClock',{op:'fix',id:el.dataset.id,out:d.getTime(),note:note.trim()});toast('ההחתמה תוקנה');S.staff=null;rerender()}catch(e){err(e)}};

/* אריחים: "משמרת ומזומן" (כל מי שבקופה) ו"עובדים וקוד" (כל מי שבקופה – הקוד שלו; מנהל – גם הניהול). נוסף אחרי האריחים של pos-base.js */
{const o=window.posTile;window.posTile=function(){let h=typeof o==='function'?o.apply(this,arguments):'';try{if(on()&&seller())h+=`<button class="tile" data-a="addGo" data-v="posShift" style="font-size:1rem">${ico('swap')}משמרת ומזומן</button>`;if(on()&&(seller()||mgr()))h+=`<button class="tile" data-a="addGo" data-v="posStaff" style="font-size:1rem">${ico('swap')}עובדים וקוד</button>`/* 18.11.2026: "עובדים וקוד" – ניהול, גם למנהל בלי מתג קופה */}catch(e){}return h}}
/* במסך הקופה – קיצור למשמרת */
{const o=V.pos;if(typeof o==='function')V.pos=function(){const r=o.apply(this,arguments);try{if(on()&&seller()&&r&&typeof r.h==='string'&&myDev())r.h+='<div class="card"><button class="btn w" data-a="go" data-v="posShift">משמרת ומזומן</button></div>'}catch(e){}return r}}
window.addEventListener('lp-biz-change',reset);
})();
