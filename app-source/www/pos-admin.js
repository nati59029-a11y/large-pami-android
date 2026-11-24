/* POS:M4 – אזור הניהול של הקופה (אפיון ה 1.ג, 3.3). באפליקציה בלבד – במסך הקופה אין שום הגדרה.
   V.posAdm    – בית ניהול הקופה (מחליף את המסך של שלב 0): קופות ומכשירים (המסך של שלב 0, בלי טופס ההגדרות הישן), מדורי ההגדרות
                 לפי הסכמה, חיפוש, "השתנו לאחרונה", "הצג מתקדם", יומן שינויים (בעל העסק / מנהל־על), מצב המערכת, מנהל־על.
   V.posCfgSec – מדור הגדרות (cur().a = sec). מדור ריק או ששייך כולו למודול כבוי – לא מוצג. הגדרה בלי הרשאה – נעולה עם "רק בעל העסק" וכו'.
   V.posCfgLog – יומן שינויים: בעל העסק ומנהל־על בלבד; "בטל" על שורה (posCfgUndo).
   כל כתיבה – רק posCfgSet / posCfgUndo בשרת. הגדרה רגישה: בעל העסק מאשר בהקלדה חוזרת (appr:'self'); מנהל – קוד של בעל העסק (apprPin).
   מתג 'pos' כבוי (או עסק legacy / מסך ניהול העסקים) = לא מוסיף ולא משנה כלום. רכיבי D1 בלבד, בלי צבע קבוע. */
(function(){
'use strict';
if(typeof ACT==='undefined'||typeof V==='undefined'||!window.PosCfgSchema)return;
const SC=window.PosCfgSchema;
const fnCall=(n,d)=>{d=d&&typeof d==='object'?d:{};if(SY&&SY.sa&&SY.bizId&&!('bizId'in d))d=Object.assign({bizId:SY.bizId},d);return window.fnCall(n,d)};
const on=()=>{try{return bzF('pos')&&bzB()&&!SY.mg}catch(e){return false}};
const mgr=()=>{try{return isA()||!!(SY&&SY.sa)}catch(e){return false}};
const M={c:null,err:'',busy:0,adv:0,q:'',log:null,logErr:''};
const err=e=>toast(e&&e.message||'הפעולה נכשלה');
const WHO_HE={sa:'רק מנהל־על',own:'רק בעל העסק',mgr:'מנהל'};
const RANK={mgr:1,own:2,sa:3};
const DAYS=['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳'];
const SEC_HE=Object.fromEntries(SC.SECS);
const HE=window.PosCfgHe||{val:(k,v)=>String(v),help:(k,f)=>f||''};
const vHe=(r,o)=>HE.val(r.k,o);
const typing=()=>{const a=document.activeElement;return !!(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)&&a.closest('#main'))};
const VIEWS=['posAdm','posCfgSec','posCfgLog','posSa','posStatus'];
function load(){if(M.busy||M.err)return;M.busy=1;fnCall('posCfg',{}).then(r=>{M.c=r}).catch(e=>{M.err=e&&e.message||'הטעינה נכשלה'}).finally(()=>{M.busy=0;if(VIEWS.includes(cur().v)&&!typing()&&!document.querySelector('#dlg[open]'))rerender()})}
const reset=()=>{M.c=null;M.err='';M.log=null;M.logErr='';try{PosCfg.reset()}catch(e){}};
const deny=T=>({t:T,h:'<div class="empty">התכונה לא פעילה בעסק הזה</div>'});
const loading=T=>({t:T,h:M.err?`<div class="card"><p class="note" style="margin:0">${esc(M.err)}</p><button class="btn g w" data-a="posAdmRe" style="margin-top:10px">נסה שוב</button></div>`:'<div class="empty">טוען…</div>'});
ACT.posAdmRe=()=>{reset();rerender()};
window.PosAdm={reset,state:()=>M};

/* ---------- עזרי הרשאה ותצוגה ---------- */
const role=()=>M.c&&M.c.role||'mgr';
function whoOf(k){const sa=M.c&&M.c.sa?{lock:M.c.sa.lock,who:M.c.sa.who}:{};return SC.whoOf(k,sa)}
const can=k=>RANK[role()]>=RANK[whoOf(k)];
const shown=r=>!(M.c&&M.c.off&&M.c.off[r.k])&&(M.adv||!r.adv||(M.c&&M.c.src&&M.c.src[r.k]==='biz'));
const ag=r=>r.u==='ag';
const money=v=>v==null?'':String(v/100);
function fmt(r,v){if(v===null||v===undefined)return 'לא הוגדר';if(r.t==='bool')return v?'כן':'לא';if(ag(r)&&typeof v==='number')return '₪'+(v/100).toLocaleString('he-IL');
 if(r.t==='days')return v.map(d=>DAYS[d]).join(' ');if(r.t==='enum'&&r.k)return vHe(r,v);if(r.t==='list'&&r.k&&Array.isArray(v))return v.map(x=>vHe(r,x)).join(', ');if(Array.isArray(v))return v.map(x=>ag(r)?'₪'+x/100:x).join(', ');if(typeof v==='object')return JSON.stringify(v);return String(v)}
const unit=r=>({ag:' (₪)',pct:' (%)',min:' (דקות)',day:' (ימים)',yr:' (שנים)'})[r.u]||'';

/* שדה לפי סוג (שם השדה: pa_<מפתח>; obj: pa_<מפתח>__<שדה>) */
function input(r,v,nm,dis){const d=dis?' disabled':'';
 switch(r.t){
  case 'bool':return `<select name="${nm}"${d}><option value="1"${v?' selected':''}>כן</option><option value="0"${!v?' selected':''}>לא</option></select>`;
  case 'enum':return `<select name="${nm}"${d}>${r.vals.map(o=>`<option value="${esc(String(o))}"${o===v?' selected':''}>${esc(vHe(r,o))}</option>`).join('')}</select>`;
  case 'list':return `<div>${r.vals.map(o=>`<label class="chip"><input type="checkbox" name="${nm}" value="${esc(o)}"${(v||[]).includes(o)?' checked':''}${d}> ${esc(vHe(r,o))}</label>`).join(' ')}</div>`;
  case 'days':return `<div>${DAYS.map((n,i)=>`<label class="chip"><input type="checkbox" name="${nm}" value="${i}"${(v||[]).includes(i)?' checked':''}${d}> ${n}</label>`).join(' ')}</div>`;
  case 'time':return `<input type="time" name="${nm}" value="${esc(v||'')}" dir="ltr"${d}>`;
  case 'date':return `<input type="date" name="${nm}" value="${esc(v||'')}" dir="ltr"${d}>`;
  case 'int':case 'num':return `<input name="${nm}" inputmode="decimal" dir="ltr" value="${esc(v==null?'':ag(r)?money(v):String(v))}" placeholder="${r.nul?'ריק = לא הוגדר':''}"${d}>`;
  case 'nums':return `<input name="${nm}" dir="ltr" value="${esc((v||[]).map(x=>ag(r)?x/100:x).join(', '))}" placeholder="מופרד בפסיקים"${d}>`;
  case 'strs':return `<input name="${nm}" value="${esc((v||[]).join(', '))}" placeholder="מופרד בפסיקים"${d}>`;
  case 'json':return `<textarea name="${nm}" dir="ltr" rows="3"${d}>${esc(v==null?'':JSON.stringify(v))}</textarea>`;
  default:return `<input name="${nm}" value="${esc(v==null?'':String(v))}" maxlength="${r.max||200}"${d}>`}}
function read(fm,r,nm){const els=fm.querySelectorAll(`[name="${nm}"]`);if(!els.length)return undefined;const s=String(els[0].value||'').trim();
 const num=x=>{const n=Number(String(x).replace(',','.'));return ag(r)?Math.round(n*100):r.t==='int'?Math.round(n):n};
 switch(r.t){
  case 'bool':return s==='1';
  case 'enum':return r.vals.find(o=>String(o)===s);
  case 'list':return Array.from(els).filter(x=>x.checked).map(x=>x.value);
  case 'days':return Array.from(els).filter(x=>x.checked).map(x=>+x.value);
  case 'int':case 'num':return s===''&&r.nul?null:num(s);
  case 'nums':return s?s.split(/[,\s]+/).filter(Boolean).map(num):[];
  case 'strs':if(!s&&r.nul)return null;return s?s.split(',').map(x=>x.trim()).filter(Boolean):[];
  case 'json':if(!s&&r.nul)return null;try{return JSON.parse(s)}catch(e){return {__bad:1}}
  default:return s}}
function field(r){const c=M.c,v=c.cfg[r.k],ok=can(r.k),nm='pa_'+r.k;
 const lock=ok?'':` <span class="tag t4">${esc(WHO_HE[whoOf(r.k)]||'נעול')}</span>`;
 const sens=r.sens?' <span class="tag t1">רגישה</span>':'';
 const br=r.brOk?' <span class="tag t3">אפשר לסניף</span>':'';
 const hl=HE.help(r.k,r.help);const help=hl?`<small class="note">${esc(hl)}</small>`:'';
 if(r.t==='obj'){const fs=Object.entries(r.fields).map(([f,fd])=>`<label class="f"><span>${esc(fd.he||f)}${unit(fd)}</span>${input(Object.assign({},fd,{k:r.k+'.'+f}),v&&v[f],nm+'__'+f,!ok)}</label>`).join('');
  return `<div class="f" data-k="${esc(r.k)}"><span><b>${esc(r.he)}</b>${unit(r)}${sens}${lock}</span>${fs}${help}</div>`}
 return `<label class="f" data-k="${esc(r.k)}"><span>${esc(r.he)}${unit(r)}${sens}${br}${lock}</span>${input(r,v,nm,!ok)}${help}</label>`}
const rowsOf=sec=>SC.ROWS.filter(r=>r.sec===sec&&shown(r));

/* ---------- בית ניהול הקופה ---------- */
const orig=V.posAdm;
function devCard(){/* קופות ומכשירים – המסך של שלב 0 (pos-base.js), בלי טופס ההגדרות הישן */
 if(typeof orig!=='function')return '';let h='';try{h=orig().h||''}catch(e){return ''}
 const i=h.indexOf('<div class="card"><h3 style="margin-top:0">הגדרות קופה</h3>');return i>0?h.slice(0,i):h}
V.posAdm=()=>{const T='ניהול קופה';if(!on()||!mgr())return deny(T);
 if(!M.c){load();return loading(T)}
 const c=M.c,r=role(),q=M.q.trim();
 const st=c.on?(c.st==='susp'?'<span class="tag t4">מושעית</span>':c.st==='trial'?'<span class="tag t1">ניסיון</span>':'<span class="tag t3">פעילה</span>'):'<span class="tag t4">סגורה</span>';
 const secs=SC.SECS.filter(([s])=>rowsOf(s).length).map(([s,n])=>`<button class="opt" data-a="go" data-v="posCfgSec" data-arg="${s}"><span>${esc(n)}<small>${rowsOf(s).length} הגדרות</small></span>${ico('chev')}</button>`).join('');
 let found='';
 if(q){const ql=q.toLowerCase();const hits=SC.ROWS.filter(x=>!(c.off&&c.off[x.k])&&(x.he.includes(q)||x.k.toLowerCase().includes(ql)||HE.help(x.k,x.help).includes(q))).slice(0,30);
  found=`<div class="card"><h3 style="margin-top:0">תוצאות (${hits.length})</h3>${hits.length?hits.map(x=>`<button class="opt" data-a="go" data-v="posCfgSec" data-arg="${x.sec}"><span>${esc(x.he)}<small>${esc(SEC_HE[x.sec])} · ${esc(fmt(x,c.cfg[x.k]))}</small></span>${ico('chev')}</button>`).join(''):'<div class="empty">לא נמצא</div>'}</div>`}
 const recent=c.upd?`<p class="note" style="margin:6px 0 0">שינוי אחרון: ${esc(new Date(c.upd).toLocaleString('he-IL'))} · גרסה ${esc(String(c.ver))}</p>`:'';
 const h=`<div class="card"><h3 style="margin-top:0">קופה ${st}</h3><p class="note" style="margin:0">סוג העסק: ${esc(c.type)} · ${r==='sa'?'משנה כמנהל־על':r==='own'?'בעל העסק':'מנהל'}</p>${recent}
  ${c.on?'':'<p class="note">הקופה עוד לא נפתחה לעסק. מנהל־העל פותח אותה (סוג עסק ותבנית).</p>'}</div>
  ${devCard()}
  <div class="card"><h3 style="margin-top:0">הגדרות</h3>
   <label class="f"><span>חיפוש בהגדרות</span><input id="posAdmQ" value="${esc(M.q)}" placeholder="למשל: החזרה, מע״מ, קבלה"></label>
   <label class="chip"><input type="checkbox" data-a="posAdmAdv"${M.adv?' checked':''}> הצג הגדרות מתקדמות</label></div>
  ${found}<div class="mlist">${secs}</div>
  <div class="mlist" style="margin-top:12px">
   ${r==='own'||r==='sa'?`<button class="opt" data-a="go" data-v="posCfgLog"><span>יומן שינויים<small>מי שינה מה ומתי, וביטול שינוי</small></span>${ico('chev')}</button>`:''}
   <button class="opt" data-a="go" data-v="posStatus"><span>מצב המערכת<small>גרסה, סנכרון, מדפסת, תור ממתין, דיווח על בעיה</small></span>${ico('chev')}</button>
   ${r==='sa'?`<button class="opt" data-a="go" data-v="posSa"><span>מנהל־על<small>פתיחה, השעיה, סוג עסק, מודולים, נעילות, תבניות</small></span>${ico('chev')}</button>`:''}
  </div>`;
 return{t:T,h}};
ACT.posAdmAdv=el=>{M.adv=el.checked?1:0;rerender()};
document.addEventListener('input',e=>{const t=e.target;if(t&&t.id==='posAdmQ'){M.q=t.value;clearTimeout(M.qt);M.qt=setTimeout(()=>{const p=t.selectionStart;rerender();const n=document.getElementById('posAdmQ');if(n){n.focus();try{n.setSelectionRange(p,p)}catch(x){}}},350)}});

/* ---------- מדור הגדרות ---------- */
V.posCfgSec=()=>{const sec=cur().a,T=SEC_HE[sec]||'הגדרות';if(!on()||!mgr())return deny(T);
 if(!M.c){load();return loading(T)}
 const rows=rowsOf(sec);if(!rows.length)return{t:T,h:'<div class="empty">אין הגדרות במדור הזה</div>'};
 const any=rows.some(r=>can(r.k));
 const h=`<div class="card"><form data-f="posCfgSecF" data-sec="${esc(sec)}">${rows.map(field).join('')}${any?'<button class="btn w">שמירה</button>':''}</form>
  <p class="note">הגדרה שלא שונתה – ברירת המחדל (הערך לעסק הנוכחי מהאפיון). הגדרה נעולה – רק מי שמסומן משנה אותה.${role()==='sa'?' את השינוי ירשם ביומן "כמנהל־על".':''}</p></div>`;
 return{t:T,h}};
FRM.posCfgSecF=async f=>{const c=M.c;if(!c)return;const sec=f.dataset.sec,set={};
 for(const r of rowsOf(sec)){if(!can(r.k))continue;let v;
  if(r.t==='obj'){v={};for(const[fk,fd]of Object.entries(r.fields)){const x=read(f,fd,'pa_'+r.k+'__'+fk);if(x!==undefined)v[fk]=x}}else v=read(f,r,'pa_'+r.k);
  if(v===undefined)continue;if(v&&v.__bad)return toast('ערך לא תקין: '+r.he);
  if(JSON.stringify(v)!==JSON.stringify(c.cfg[r.k]))set[r.k]=v}
 if(!Object.keys(set).length)return toast('אין שינוי');
 await save({set})};
/* שמירה עם אישור שני להגדרה רגישה */
async function save(data,undoId){
 const send=async extra=>{const d=Object.assign({},data,extra);return undoId?fnCall('posCfgUndo',Object.assign({logId:undoId},extra)):fnCall('posCfgSet',d)};
 try{await send({});done()}catch(e){const r=e&&(e.reason||e.details&&e.details.reason);
  if(r==='appr-needed'&&role()==='own'){if(!(await confirmSelf()))return;try{await send({appr:'self'});done()}catch(x){err(x)}return}
  if(r==='appr-needed'&&role()==='mgr'){const pin=await askPin();if(!pin)return;try{await send({apprPin:pin});done()}catch(x){err(x)}return}
  err(e)}}
function done(){toast('נשמר');reset();rerender()}
function confirmSelf(){return new Promise(res=>{window.__posAppr=res;dlg(`<h3>הגדרה רגישה</h3><p>זו הגדרה שדורשת אישור נוסף. כדי לאשר, כתבו <b>מאשר</b>.</p><input id="posApprTxt" autocomplete="off"><div class="row" style="margin-top:10px"><button class="btn grow" data-a="posApprOk">אישור</button><button class="btn g grow" data-a="posApprNo">ביטול</button></div>`)})}
function askPin(){return new Promise(res=>{window.__posAppr=res;dlg(`<h3>אישור של בעל העסק</h3><p>הגדרה רגישה – בעל העסק מקליד את הקוד שלו.</p><input id="posApprPin" type="password" inputmode="numeric" maxlength="8" dir="ltr" autocomplete="off"><div class="row" style="margin-top:10px"><button class="btn grow" data-a="posApprOk">אישור</button><button class="btn g grow" data-a="posApprNo">ביטול</button></div>`)})}
ACT.posApprOk=()=>{const t=document.getElementById('posApprTxt'),p=document.getElementById('posApprPin');const f=window.__posAppr;window.__posAppr=null;closeDlg();
 if(!f)return;if(t)f(t.value.trim()==='מאשר');else f(p?p.value.trim():'')};
ACT.posApprNo=()=>{const f=window.__posAppr;window.__posAppr=null;closeDlg();if(f)f(null)};

/* ---------- יומן שינויים (בעל העסק / מנהל־על) ---------- */
async function logLoad(){const j=await fsx('/poscfglog?pageSize=100&orderBy=at%20desc');M.log=((j&&j.documents)||[]).map(d=>Object.assign({id:idOf(d)},fvj({mapValue:d})))}
V.posCfgLog=()=>{const T='יומן שינויים';if(!on()||!mgr())return deny(T);
 if(!M.c){load();return loading(T)}
 if(role()!=='own'&&role()!=='sa')return{t:T,h:'<div class="empty">היומן זמין לבעל העסק בלבד. "שינוי אחרון" מופיע במסך ניהול הקופה.</div>'};
 if(!M.log){if(!M.logErr&&!M.logBusy){M.logBusy=1;logLoad().catch(e=>{M.logErr=e&&e.message||'הטעינה נכשלה'}).finally(()=>{M.logBusy=0;if(cur().v==='posCfgLog')rerender()})}
  return{t:T,h:M.logErr?`<div class="card"><p class="note">${esc(M.logErr)}</p></div>`:'<div class="empty">טוען…</div>'}}
 const last={};for(const l of M.log)if(!last[l.scope+'|'+l.key])last[l.scope+'|'+l.key]=l.id;
 const src={ui:'',tpl:'תבנית',undo:'ביטול',open:'פתיחה'};
 const rows=M.log.map(l=>{const r=SC.BY[l.key];const n=r?r.he:l.key;
  return `<div class="li" style="cursor:default"><div class="m"><b>${esc(n)}</b><small>${esc(fmt(r||{},l.old))} ← ${esc(fmt(r||{},l.new))} · ${esc(new Date(l.at).toLocaleString('he-IL'))} · ${esc(l.role==='sa'?'מנהל־על':l.role==='own'?'בעל העסק':'מנהל')}${l.scope&&l.scope!=='main'?' · '+esc(l.scope):''}${src[l.src]?' · '+src[l.src]:''}${l.appr?' · אושר':''}</small></div>
   ${last[l.scope+'|'+l.key]===l.id&&r&&l.src!=='open'?`<button class="btn s g" data-a="posCfgUndo" data-id="${esc(l.id)}">בטל</button>`:''}</div>`}).join('');
 return{t:T,h:`<div class="card">${rows||'<div class="empty">אין שינויים עדיין</div>'}</div><p class="note">היומן גלוי לבעל העסק ולמנהל־העל בלבד.</p>`}};
ACT.posCfgUndo=async el=>{el.disabled=true;await save({},el.dataset.id);el.disabled=false};

window.addEventListener('lp-biz-change',reset);
})();
