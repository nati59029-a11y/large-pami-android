/* POS:0 – קופה, שלב 0 (תשתית). קובץ עצמאי, נטען אחרי index.html. מתג 'pos' כבוי (או עסק במצב הקיים) = לא מוסיף כלום לשום מסך.
   V.pos     – כניסה לקופה (קופאי pos / אחראי posMgr / מנהל): מראה איזו קופה רשומה על המכשיר. מסך המכירה עצמו – בשלב 1 (pos-sale.js).
               לפי החלטת בעל העסק: במסך הקופה אין הגדרות בכלל.
   V.posAdm  – ניהול קופה (מנהל / מנהל־על, באזור הניהול): סוג העסק (מנהל־על), הגדרות לפי posCfg (מנהל: הגדרות 'mgr'; מנהל־על: הכול),
               קופות (הוספה, השבתה, פרישה עם קופה חלופית) ורישום המכשיר הזה כקופה.
   כל כתיבה – רק דרך פונקציות השרת posCfgSet / posDev. קריאה: posCfg, ו-posdev לפי החוקים.
   מזהה ההתקנה (lp-pos-inst) נוצר פעם אחת במכשיר; הקופה הרשומה (lp-pos-dev) נשמרת לכל עסק. רכיבי D1 בלבד, בלי צבע קבוע. */
(function(){
'use strict';
if(typeof ACT==='undefined'||typeof V==='undefined')return;
const fnCall=(n,d)=>{d=d&&typeof d==='object'?d:{};if(SY&&SY.sa&&SY.bizId&&!('bizId'in d))d=Object.assign({bizId:SY.bizId},d);return window.fnCall(n,d)};
const on=()=>{try{return bzF('pos')&&bzB()&&!SY.mg}catch(e){return false}};
const mgr=()=>isA()||!!(SY&&SY.sa);
const seller=()=>{try{if(mgr())return true;if(!isW())return false;const p=SY.perms;return !!(p&&typeof p==='object'&&(p.pos===true||p.posMgr===true))}catch(e){return false}};
const P={cfg:null,devs:null,err:'',busy:0};
const ld={};
const err=e=>toast(e&&e.message||'הפעולה נכשלה');
const dec=d=>Object.assign({id:idOf(d)},fvj({mapValue:d}));
const ls=(k,v)=>{try{if(v===undefined)return localStorage.getItem(k);if(v===null)localStorage.removeItem(k);else localStorage.setItem(k,v)}catch(e){return null}};
function inst(){let v=ls('lp-pos-inst');if(!/^[A-Za-z0-9_-]{16,64}$/.test(v||'')){const a=new Uint8Array(18);crypto.getRandomValues(a);v='i'+Array.from(a,b=>b.toString(16).padStart(2,'0')).join('');ls('lp-pos-inst',v)}return v}
function myDev(){try{const o=JSON.parse(ls('lp-pos-dev')||'null');return o&&o.bizId===SY.bizId&&/^K[1-9][0-9]{0,3}$/.test(o.dev||'')?o.dev:''}catch(e){return ''}}
const reset=()=>{P.cfg=null;P.devs=null;P.err=''};
const typing=()=>{const a=document.activeElement;return !!(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)&&a.closest('#main'))};
const load=(k,fn)=>{if(ld[k]||P.err)return;ld[k]=1;fn().catch(e=>{P.err=e&&e.message||'הטעינה נכשלה'}).finally(()=>{ld[k]=0;if(['pos','posAdm'].includes(cur().v)&&!typing()&&!document.querySelector('#dlg[open]'))rerender()})};
async function cfgLoad(){P.cfg=await fnCall('posCfg',{})}
async function devLoad(){const j=await fsx('/posdev?pageSize=200');P.devs=((j&&j.documents)||[]).map(dec).sort((a,b)=>(+String(a.id).slice(1))-(+String(b.id).slice(1)))}
const deny=T=>({t:T,h:'<div class="empty">התכונה לא פעילה בעסק הזה</div>'});
const loading=T=>({t:T,h:P.err?`<div class="card"><p class="note" style="margin:0">${esc(P.err)}</p><button class="btn g w" data-a="posRe" style="margin-top:10px">נסה שוב</button></div>`:'<div class="empty">טוען…</div>'});
const brName=id=>{try{const b=(typeof brList==='function'?brList():[]).find(x=>x.id===id);return b?b.name:(id==='_'?'':id)}catch(e){return id}};

/* ---------- כניסה לקופה ---------- */
V.pos=()=>{const T='קופה';if(!on()||!seller())return deny(T);
 if(!P.devs){load('dev',devLoad);return loading(T)}
 const d=myDev(),x=d&&P.devs.find(v=>v.id===d);
 let h;
 if(!x)h=`<div class="card"><p style="margin:0 0 6px"><b>המכשיר הזה עוד לא רשום כקופה.</b></p><p class="note" style="margin:0">מנהל העסק רושם את המכשיר במסך "ניהול קופה".</p></div>`;
 else if(x.st==='retired')h=`<div class="card"><p class="note" style="margin:0">הקופה ${esc(x.name)} (${esc(x.id)}) הוצאה משימוש. פנו למנהל העסק.</p></div>`;
 else if(x.on!==true)h=`<div class="card"><p class="note" style="margin:0">הקופה ${esc(x.name)} (${esc(x.id)}) מושבתת. פנו למנהל העסק.</p></div>`;
 else h=`<div class="card"><h3 style="margin-top:0">${esc(x.name)} <span class="tag t3">${esc(x.id)}</span></h3>${x.br&&x.br!=='_'?`<p class="note" style="margin:0 0 6px">סניף: ${esc(brName(x.br))}</p>`:''}<p class="note" style="margin:0">מסך המכירה ייפתח כאן בשלב הבא.</p></div>`;
 return{t:T,h}};

/* ---------- ניהול קופה ---------- */
function fieldOf(k,d,val,canEdit){const dis=canEdit?'':' disabled';const nm=`pc_${k}`;
 const one=(n,dd,v,name)=>{if(dd.t==='bool')return `<label class="f"><span>${esc(n)}</span><select name="${name}"${dis}><option value="1"${v?' selected':''}>כן</option><option value="0"${!v?' selected':''}>לא</option></select></label>`;
  if(dd.t==='enum')return `<label class="f"><span>${esc(n)}</span><select name="${name}"${dis}>${dd.opts.map(o=>`<option value="${esc(o)}"${String(o)===String(v)?' selected':''}>${esc(o)}</option>`).join('')}</select></label>`;
  if(dd.t==='arr')return `<div class="f"><span>${esc(n)}</span><div>${dd.opts.map(o=>`<label class="chip"><input type="checkbox" name="${name}" value="${esc(o)}"${(v||[]).includes(o)?' checked':''}${dis}> ${esc(o)}</label>`).join(' ')}</div></div>`;
  const num=dd.t==='int'||dd.t==='num';return `<label class="f"><span>${esc(n)}</span><input name="${name}" ${num?'inputmode="decimal" dir="ltr"':''} value="${esc(v)}"${dis}></label>`};
 if(d.t==='obj')return `<div class="sec"><h3>${esc(d.n)}</h3></div>`+Object.entries(d.f).map(([f,fd])=>one(fd.n,fd,val&&val[f],nm+'__'+f)).join('');
 return one(d.n,d,val,nm)}
function readField(fm,k,d){const g=n=>fm.elements[n];
 const one=(dd,name)=>{if(dd.t==='arr')return Array.from(fm.querySelectorAll(`[name="${name}"]`)).filter(x=>x.checked).map(x=>x.value);const el=g(name);if(!el)return undefined;const s=el.value;
  if(dd.t==='bool')return s==='1';if(dd.t==='int')return Number.parseInt(s,10);if(dd.t==='num')return Number(String(s).replace(',','.'));if(dd.t==='enum')return dd.opts.find(o=>String(o)===s);return s};
 if(d.t==='obj'){const o={};for(const[f,fd]of Object.entries(d.f))o[f]=one(fd,`pc_${k}__${f}`);return o}
 return one(d,`pc_${k}`)}
V.posAdm=()=>{const T='ניהול קופה';if(!on()||!mgr())return deny(T);
 if(!P.cfg){load('cfg',cfgLoad);return loading(T)}
 if(!P.devs){load('dev',devLoad);return loading(T)}
 const c=P.cfg,sa=c.who==='sa',my=myDev();
 const brs=(typeof brList==='function'?brList():[]);
 const devRows=P.devs.length?P.devs.map(x=>`<div class="li" style="cursor:default"><div class="m"><b>${esc(x.name)} <span class="tag ${x.st==='retired'?'t4':x.on===true?'t3':'t1'}">${esc(x.id)}</span></b><small>${x.st==='retired'?'הוצאה משימוש'+(x.replacedBy?' – הוחלפה ב-'+esc(x.replacedBy):''):x.on===true?'פעילה':'מושבתת'}${x.br&&x.br!=='_'?' · '+esc(brName(x.br)):''}${x.inst?' · רשומה על מכשיר':''}${x.id===my?' · המכשיר הזה':''}</small></div>
  ${x.st==='retired'?'':`<button class="btn s g" data-a="posDevOn" data-dev="${esc(x.id)}" data-on="${x.on===true?0:1}">${x.on===true?'השבתה':'הפעלה'}</button><button class="btn s g" data-a="posDevRet" data-dev="${esc(x.id)}">פרישה</button>${!x.inst?`<button class="btn s" data-a="posClaim" data-dev="${esc(x.id)}">רישום המכשיר הזה</button>`:''}`}</div>`).join(''):'<div class="empty">אין קופות עדיין</div>';
 const keys=Object.keys(c.defs||{});
 const typeSel=sa?`<label class="f"><span>סוג העסק</span><select name="pc__type">${(c.types||[]).map(t=>`<option value="${esc(t.id)}"${t.id===c.type?' selected':''}>${esc(t.n)}</option>`).join('')}</select></label>`:`<p class="note">סוג העסק: ${esc(((c.types||[]).find(t=>t.id===c.type)||{}).n||c.type)}</p>`;
 const h=`<div class="card"><h3 style="margin-top:0">קופות</h3>${devRows}
  <form data-f="posDevAdd" style="margin-top:10px"><label class="f"><span>שם קופה חדשה</span><input name="name" maxlength="40" required placeholder="קופה 1"></label>${brs.length>1?`<label class="f"><span>סניף</span><select name="br">${brs.map(b=>`<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('')}</select></label>`:''}<button class="btn w">הוספת קופה</button></form>
  <p class="note">קוד קופה ניתן פעם אחת ולא חוזר. מכשיר שאבד או התקלקל – "פרישה", והמכשיר החלופי מקבל קוד חדש.</p></div>
 <div class="card"><h3 style="margin-top:0">הגדרות קופה</h3><form data-f="posCfgF">${typeSel}${keys.map(k=>fieldOf(k,c.defs[k],c.cfg[k],sa||c.defs[k].who==='mgr')).join('')}<button class="btn w">שמירה</button></form>
  <p class="note">סכומים באגורות. הגדרה שלא שונתה – ברירת המחדל של סוג העסק.${sa?'':' הגדרות אפורות – רק מנהל־על משנה.'}</p></div>`;
 return{t:T,h}};
ACT.posRe=()=>{reset();rerender()};
FRM.posDevAdd=async f=>{const fd=new FormData(f),name=String(fd.get('name')||'').trim();if(!name)return toast('כתבו שם לקופה');
 try{const r=await fnCall('posDev',{op:'add',name,br:String(fd.get('br')||'')});toast('נוספה קופה '+r.dev);P.devs=null;rerender()}catch(e){err(e)}};
ACT.posDevOn=async el=>{if(el.disabled)return;el.disabled=true;try{await fnCall('posDev',{op:'on',dev:el.dataset.dev,on:el.dataset.on==='1'});P.devs=null;rerender()}catch(e){err(e)}finally{el.disabled=false}};
ACT.posDevRet=async el=>{const d=el.dataset.dev;if(!(await ask('פרישת הקופה '+d+'? הקוד לא יחזור לשימוש. תיפתח קופה חלופית עם קוד חדש.')))return;
 el.disabled=true;try{const r=await fnCall('posDev',{op:'retire',dev:d,replace:true});toast('הקופה '+d+' הוצאה משימוש. קופה חלופית: '+r.newDev);P.devs=null;rerender()}catch(e){err(e)}finally{el.disabled=false}};
ACT.posClaim=async el=>{const d=el.dataset.dev;el.disabled=true;try{await fnCall('posDev',{op:'claim',dev:d,inst:inst()});ls('lp-pos-dev',JSON.stringify({bizId:SY.bizId,dev:d}));toast('המכשיר נרשם כקופה '+d);P.devs=null;rerender()}catch(e){err(e)}finally{el.disabled=false}};
FRM.posCfgF=async f=>{const c=P.cfg;if(!c)return;const sa=c.who==='sa',set={};
 for(const[k,d]of Object.entries(c.defs||{})){if(!sa&&d.who!=='mgr')continue;const v=readField(f,k,d);if(v===undefined)continue;if(JSON.stringify(v)!==JSON.stringify(c.cfg[k]))set[k]=v}
 const data={set};if(sa){const t=f.elements['pc__type'];if(t&&t.value!==c.type)data.type=t.value}
 if(!Object.keys(set).length&&!data.type)return toast('אין שינוי');
 try{const r=await fnCall('posCfgSet',data);Object.assign(c,{type:r.type,cfg:r.cfg,src:r.src});toast('ההגדרות נשמרו');rerender()}catch(e){err(e)}};

/* אריחים במסך "הוספה": קופה (מי שמוכר) וניהול קופה (מנהל / מנהל־על). כבוי = מחרוזת ריקה */
window.posTile=()=>{if(!on())return '';let h='';
 if(seller())h+=`<button class="tile" data-a="addGo" data-v="pos" style="font-size:1rem">${ico('swap')}קופה</button>`;
 if(mgr())h+=`<button class="tile" data-a="addGo" data-v="posAdm" style="font-size:1rem">${ico('swap')}ניהול קופה</button>`;
 return h};
/* עובד (קופאי / אחראי משמרת) – כניסה לקופה בראש מסך "עוד" (למנהל יש אריח במסך "הוספה"). כבוי / בלי הרשאה = המסך לא משתנה */
{const o=V.more;if(typeof o==='function')V.more=function(){const r=o.apply(this,arguments);try{if(on()&&seller()&&!mgr()&&r&&typeof r.h==='string'&&r.h.startsWith('<div class="mlist">'))r.h='<div class="mlist"><button class="opt" data-a="go" data-v="pos"><span>קופה<small>מכירה בדלפק</small></span>'+ico('chev')+'</button>'+r.h.slice(19)}catch(e){}return r}}
window.addEventListener('lp-biz-change',reset);
})();
