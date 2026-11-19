/* POS:M4 – מסך מנהל־העל לקופה של העסק הנוכחי (אפיון ה 3.2). רק SY.sa (מנהל־על שנכנס לעסק); השרת בודק שוב (posSa: not-superadmin).
   פתיחה (סוג עסק + תבנית + מגבלות) · מצב (פתוחה / ניסיון / פעילה / מושעית) · סוג העסק · מודולים · מגבלות · נעילות ו"מי משנה"
   · "החל תבנית מחדש" עם רשימת הבדלים (רק מה שסומן) · עריכת תבניות (גלובלי) · דיווחי בעיה מכל העסקים.
   כל כתיבה – posSa / posCfgSet (מפתחות sa.* נכתבים בשרת גם ל-saPub באותה טרנזקציה). */
(function(){
'use strict';
if(typeof ACT==='undefined'||typeof V==='undefined'||!window.PosCfgSchema)return;
const SC=window.PosCfgSchema,TP=window.PosCfgTpl||{TPL:{}};
const fnCall=(n,d)=>{d=d&&typeof d==='object'?d:{};if(SY&&SY.sa&&SY.bizId&&!('bizId'in d))d=Object.assign({bizId:SY.bizId},d);return window.fnCall(n,d)};
const ok=()=>{try{return !!(SY&&SY.sa)&&bzB()&&!SY.mg}catch(e){return false}};
const X={d:null,diff:null,bugs:null,err:'',busy:0,tpl:''};
const err=e=>toast(e&&e.message||'הפעולה נכשלה');
const reload=()=>{X.d=null;X.diff=null;X.err='';try{window.PosAdm&&PosAdm.reset()}catch(e){}rerender()};
function load(){if(X.busy||X.err)return;X.busy=1;fnCall('posSa',{op:'get'}).then(r=>{X.d=r}).catch(e=>{X.err=e&&e.message||'הטעינה נכשלה'}).finally(()=>{X.busy=0;if(cur().v==='posSa'&&!document.querySelector('#dlg[open]'))rerender()})}
const tname=t=>{const x=(X.d&&X.d.tpls||[]).find(z=>z.type===t)||TP.TPL[t];return x?x.name:t};
const typeSel=(nm,v)=>`<select name="${nm}">${SC.TYPES.map(t=>`<option value="${t}"${t===v?' selected':''}>${esc(tname(t))}</option>`).join('')}</select>`;
const val=v=>v===undefined||v===null?'—':typeof v==='object'?JSON.stringify(v):String(v);

V.posSa=()=>{const T='קופה – מנהל־על';if(!ok())return{t:T,h:'<div class="empty">זמין למנהל־על בלבד</div>'};
 if(!X.d){load();return{t:T,h:X.err?`<div class="card"><p class="note">${esc(X.err)}</p><button class="btn g w" data-a="posSaRe">נסה שוב</button></div>`:'<div class="empty">טוען…</div>'}}
 const sa=X.d.sa||{},opened=!!sa.openedAt,e=SC.eff({sa});
 const feat=(()=>{try{return bzF('pos')}catch(x){return false}})();
 let h=feat?'':'<div class="card"><p class="note" style="margin:0">התוספת "קופה" כבויה בעסק הזה (מסך העסקים ← תוספות). אפשר להכין את ההגדרות מראש; העסק לא יראה כלום עד שתודלק.</p></div>';
 if(!opened)h+=`<div class="card"><h3 style="margin-top:0">פתיחת קופה לעסק</h3><form data-f="posSaOpen">
   <label class="f"><span>סוג העסק (תבנית)</span>${typeSel('type','bakeryDisposable')}</label>
   <label class="f"><span>קופות מרבי</span><input name="maxDev" inputmode="numeric" dir="ltr" value="${SC.BY['sa.maxDev'].def}"></label>
   <label class="f"><span>סניפים מרבי</span><input name="maxBr" inputmode="numeric" dir="ltr" value="${SC.BY['sa.maxBr'].def}"></label>
   <button class="btn w">פתיחה</button></form><p class="note">ערכי התבנית והמודולים שלה מועתקים לעסק (העתקה – שינוי תבנית אחר כך לא משנה את העסק).</p></div>`;
 else h+=`<div class="card"><h3 style="margin-top:0">מצב</h3><form data-f="posSaSet">
   <label class="f"><span>הקופה פתוחה</span><select name="on"><option value="1"${e.on?' selected':''}>כן</option><option value="0"${!e.on?' selected':''}>לא</option></select></label>
   <label class="f"><span>מצב</span><select name="st">${[['trial','ניסיון (עד המעבר)'],['active','פעילה'],['susp','מושעית']].map(([v,n])=>`<option value="${v}"${e.st===v?' selected':''}>${n}</option>`).join('')}</select></label>
   <label class="f"><span>סוג העסק</span>${typeSel('type',e.type)}</label>
   <label class="f"><span>קופות מרבי</span><input name="maxDev" inputmode="numeric" dir="ltr" value="${esc(String(e.cfg['sa.maxDev']))}"></label>
   <label class="f"><span>סניפים מרבי</span><input name="maxBr" inputmode="numeric" dir="ltr" value="${esc(String(e.cfg['sa.maxBr']))}"></label>
   <div class="f"><span>מודולים</span><div>${SC.MODS.map(m=>`<label class="chip"><input type="checkbox" name="mod" value="${m}"${e.mods[m]?' checked':''}> ${esc(SC.MODS_HE[m])}</label>`).join(' ')}</div></div>
   <label class="f"><span>הגדרות נעולות (רק מנהל־על) – שמות מופרדים בפסיקים</span><input name="lock" dir="ltr" value="${esc((sa.lock||[]).join(', '))}"></label>
   <label class="f"><span>"מי משנה" לעסק הזה – {"מפתח":"sa|own|mgr"}</span><textarea name="who" dir="ltr" rows="2">${esc(JSON.stringify(sa.who||{}))}</textarea></label>
   <button class="btn w">שמירה</button></form>
   <p class="note">תבנית: ${esc(tname(sa.tpl||e.type))} (גרסה ${esc(String(sa.tplVer||''))}) · נפתח ${esc(new Date(sa.openedAt).toLocaleDateString('he-IL'))}</p></div>
  <div class="card"><h3 style="margin-top:0">החל תבנית מחדש</h3>${X.diff?diffHtml():'<button class="btn g w" data-a="posSaDiff">הצג הבדלים מול התבנית</button>'}</div>`;
 h+=`<div class="card"><h3 style="margin-top:0">תבניות (לכל העסקים)</h3><form data-f="posSaTpl"><label class="f"><span>סוג</span>${typeSel('type',X.tpl||'grocery')}</label>
   <label class="f"><span>ערכים (JSON: {"מפתח": ערך})</span><textarea name="vals" dir="ltr" rows="4">${esc(JSON.stringify(((X.d.tpls||[]).find(z=>z.type===(X.tpl||'grocery'))||{}).vals||{}))}</textarea></label>
   <button class="btn g w">שמירת התבנית</button></form><p class="note">הערכים לסוגים שאינם העסק הנוכחי הם הצעה בלבד. שינוי תבנית לא משנה עסקים קיימים.</p></div>
  <div class="card"><h3 style="margin-top:0">דיווחי בעיה</h3>${X.bugs?(X.bugs.length?X.bugs.map(b=>`<div class="li" style="cursor:default"><div class="m"><b>${esc(b.bizId)}${b.dev?' · '+esc(b.dev):''}</b><small>${esc(b.txt)} · ${esc(new Date(b.at).toLocaleString('he-IL'))}</small></div></div>`).join(''):'<div class="empty">אין דיווחים</div>'):'<button class="btn g w" data-a="posSaBugs">טעינת דיווחים מכל העסקים</button>'}</div>`;
 return{t:T,h}};
function diffHtml(){const d=X.diff;if(!d.diff.length&&!d.mods.length)return '<p class="note">אין הבדלים מול התבנית.</p>';
 return `<form data-f="posSaApply">${d.diff.map(x=>`<label class="chip" style="display:flex"><input type="checkbox" name="k" value="${esc(x.k)}"> ${esc(x.he)}: ${esc(val(x.cur))} ← ${esc(val(x.tpl))}</label>`).join('')}
  ${d.mods.map(x=>`<label class="chip" style="display:flex"><input type="checkbox" name="m" value="${esc(x.m)}"> מודול ${esc(x.he)}: ${x.cur?'דלוק':'כבוי'} ← ${x.tpl?'דלוק':'כבוי'}</label>`).join('')}
  <button class="btn w">החלת מה שסומן</button></form>`}
ACT.posSaRe=reload;
ACT.posSaDiff=async el=>{el.disabled=true;try{X.diff=await fnCall('posSa',{op:'tplDiff'});rerender()}catch(e){err(e)}finally{el.disabled=false}};
ACT.posSaBugs=async el=>{el.disabled=true;try{X.bugs=(await fnCall('posSa',{op:'bugs'})).bugs;rerender()}catch(e){err(e)}finally{el.disabled=false}};
const int=s=>{const n=Number.parseInt(String(s).trim(),10);return Number.isFinite(n)?n:NaN};
FRM.posSaOpen=async f=>{const fd=new FormData(f);try{await fnCall('posSa',{op:'open',type:fd.get('type'),maxDev:int(fd.get('maxDev')),maxBr:int(fd.get('maxBr'))});toast('הקופה נפתחה לעסק');reload()}catch(e){err(e)}};
FRM.posSaSet=async f=>{const fd=new FormData(f),sa=X.d.sa||{},e=SC.eff({sa});let who;try{who=JSON.parse(String(fd.get('who')||'{}'))}catch(x){return toast('"מי משנה" – JSON לא תקין')}
 const mods={};for(const m of SC.MODS)mods[m]=fd.getAll('mod').includes(m);
 const lock=String(fd.get('lock')||'').split(',').map(x=>x.trim()).filter(Boolean);
 const nv={'sa.on':fd.get('on')==='1','sa.st':fd.get('st'),'sa.type':fd.get('type'),'sa.maxDev':int(fd.get('maxDev')),'sa.maxBr':int(fd.get('maxBr')),'sa.mods':mods,'sa.lock':lock,'sa.who':who};
 const set={};for(const[k,v]of Object.entries(nv))if(JSON.stringify(v)!==JSON.stringify(e.cfg[k]))set[k]=v;
 if(!Object.keys(set).length)return toast('אין שינוי');
 try{await fnCall('posCfgSet',{set});toast('נשמר');reload()}catch(x){err(x)}};
FRM.posSaApply=async f=>{const fd=new FormData(f),keys=fd.getAll('k'),mods=fd.getAll('m');if(!keys.length&&!mods.length)return toast('לא סומן שום שינוי');
 try{const r=await fnCall('posSa',{op:'tplApply',keys,mods});toast('הוחלו '+r.n+' שינויים');reload()}catch(e){err(e)}};
FRM.posSaTpl=async f=>{const fd=new FormData(f);let vals;try{vals=JSON.parse(String(fd.get('vals')||'{}'))}catch(e){return toast('JSON לא תקין')}
 X.tpl=String(fd.get('type'));try{await fnCall('posSa',{op:'tplSet',type:X.tpl,vals});toast('התבנית נשמרה');reload()}catch(e){err(e)}};
document.addEventListener('change',e=>{const t=e.target;if(t&&t.name==='type'&&t.closest('[data-f=posSaTpl]')){X.tpl=t.value;rerender()}});
window.addEventListener('lp-biz-change',()=>{X.d=null;X.diff=null;X.bugs=null;X.err=''});
})();
