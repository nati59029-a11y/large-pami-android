/* POS:M6 – קופה ש6: ספירת מלאי (I4, I5; א 5.13). באזור הניהול, אחראי משמרת או מנהל (inv.countRole). לא במסך הקופה.
   V.posCnt     – רשימת ספירות + "ספירה חדשה" (מלאה / לפי קטגוריה, לכל סניף)
   V.posCntRun  – הספירה עצמה: סורק במצב מקלדת (PosBarcode.listen) או הקלדת ברקוד / 4 ספרות אחרונות / שם; כל סריקה = +1.
                  הסריקות נאספות במכשיר ונשלחות בכל 1.5 שניות (posCnt add). לחיצה על שורה = תיקון הכמות.
                  "סיימתי" ← דוח פערים ← "אישור ועדכון המלאי" (מנהל בלבד). **המלאי לא משתנה לפני האישור.**
   כל כתיבה – posCnt (functions/pos-inv.js). */
(function(){
'use strict';
if(typeof ACT==='undefined'||typeof V==='undefined')return;
const M=()=>window.PosM6;
const S={L:null,id:'',cnt:null,lines:null,pend:new Map(),last:'',timer:0,busy:0,q:''};
const redraw=()=>{try{if(['posCnt','posCntRun'].includes(cur().v)&&!document.querySelector('#dlg[open]')){const a=document.activeElement;if(!(a&&a.id==='pcQ'))rerender()}}catch(e){}};
const ok=()=>M()&&M().on()&&M().lead();
const brName=id=>{try{const b=(typeof brList==='function'?brList():[]).find(x=>x.id===id);return b?b.name:(id==='_'?'':id)}catch(e){return id}};
const ST={open:'בספירה',review:'ממתין לאישור',apply:'מעדכן מלאי',done:'אושר',cancel:'בוטל'};
const dd=t=>{try{return new Date(t).toLocaleString('he-IL',{dateStyle:'short',timeStyle:'short'})}catch(e){return ''}};

V.posCnt=()=>{const T='ספירת מלאי';if(!ok())return{t:T,h:'<div class="empty">לאחראי משמרת ולמנהל, כשהקופה מופעלת בעסק</div>'};
 if(S.L===null){S.L=undefined;M().fnCall('posCnt',{op:'list'}).then(r=>{S.L=r.items||[];redraw()}).catch(e=>{S.L=[];M().err(e)})}
 if(!M().C.cats&&!M().C.busy)M().load().then(redraw);
 const brs=(typeof brList==='function'?brList():[]);
 return{t:T,s:'ספירה בסורק, עם אישור מנהל',h:`<div class="card"><h3 style="margin-top:0">ספירה חדשה</h3><form data-f="pcOpen">
  ${brs.length>1?`<label class="f"><span>סניף / מחסן</span><select name="br">${brs.map(b=>`<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('')}</select></label>`:''}
  <label class="f"><span>מה סופרים</span><select name="scope"><option value="all">ספירה מלאה – כל המוצרים</option>${(M().C.cats||[]).filter(c=>!c.parent).map(c=>`<option value="c:${esc(c.id)}">קטגוריה: ${esc(c.name)}</option>`).join('')}</select></label>
  <label class="f"><span>שם (לא חובה)</span><input name="name" maxlength="40" placeholder="למשל: ספירת חודש"></label>
  <button class="btn w">פתיחת ספירה</button></form><p class="note">המלאי לא משתנה עד שהמנהל מאשר את דוח הפערים. אפשר לספור מכמה מכשירים במקביל.</p></div>
  <div class="sec"><h3>ספירות</h3></div>${S.L===undefined?'<div class="empty">טוען…</div>':(S.L||[]).length?S.L.map(c=>`<div class="li"><div class="m"><b>${esc(c.name)}</b><small>${dd(c.at)}${c.br&&c.br!=='_'?' · '+esc(brName(c.br)):''} · ${esc(ST[c.st]||c.st)} · נספרו ${c.counted} מתוך ${c.n}${c.st==='done'?` · ${c.diffs} פערים`:''}</small></div><button class="btn s ${['open','review','apply'].includes(c.st)?'':'g'}" data-a="pcGo" data-id="${esc(c.id)}">${c.st==='open'?'המשך ספירה':c.st==='done'?'דוח':'פתח'}</button></div>`).join(''):'<div class="empty">עוד לא היו ספירות</div>'}`}};
FRM.pcOpen=async f=>{const v=fd(f);const d={op:'open',br:v.br||'_',name:v.name||''};if(String(v.scope).startsWith('c:')){d.scope='cat';d.cat=v.scope.slice(2)}else d.scope='all';
 const b=f.querySelector('button');b.disabled=true;try{const r=await M().fnCall('posCnt',d);S.L=null;openRun(r.id)}catch(e){b.disabled=false;M().err(e)}};
function openRun(id){S.id=id;S.cnt=null;S.lines=null;S.pend.clear();S.last='';go('posCntRun')}
ACT.pcGo=el=>openRun(el.dataset.id);
async function getCnt(){const r=await M().fnCall('posCnt',{op:'get',id:S.id});S.cnt=r.cnt;S.lines=r.lines}

/* ---------- הספירה ---------- */
const local=pid=>{const l=(S.lines||[]).find(x=>x.pid===pid);return (l&&typeof l.cnt==='number'?l.cnt:0)+(S.pend.get(pid)||0)};
function flush(){clearTimeout(S.timer);S.timer=0;if(S.busy||!S.pend.size)return;const items=[...S.pend.entries()].slice(0,300).map(([pid,n])=>({pid,n}));
 items.forEach(x=>S.pend.delete(x.pid));S.busy=1;
 M().fnCall('posCnt',{op:'add',id:S.id,items}).then(r=>{(r.items||[]).forEach(x=>{if(x.err)return;let l=(S.lines||[]).find(y=>y.pid===x.pid);if(!l){const p=(M().C.prods||[]).find(y=>y.id===x.pid)||{};l={pid:x.pid,name:p.name||'',bc:p.barcode||'',sys:0};S.lines.push(l)}l.cnt=x.cnt})})
  .catch(e=>{items.forEach(x=>S.pend.set(x.pid,(S.pend.get(x.pid)||0)+x.n));M().err(e)}).finally(()=>{S.busy=0;if(S.pend.size)S.timer=setTimeout(flush,1500);redraw()})}
function add(p,n){if(!S.cnt||S.cnt.st!=='open')return;S.pend.set(p.id,(S.pend.get(p.id)||0)+(n||1));S.last=p.id;if(!S.timer)S.timer=setTimeout(flush,1500);redraw()}
function scan(code){if(cur().v!=='posCntRun'||!S.cnt||S.cnt.st!=='open'||document.querySelector('#dlg[open]'))return;
 const p=M().find(code);
 if(p){const pk=(p.packs||[]).find(x=>x&&x.bc===code);add(p,pk?pk.qty:1);return}
 if(window.PosBarcode)PosBarcode.beep(false);
 if(M().mgr()&&window.PosProdQuick)ask(`הברקוד ${code} לא נמצא. להוסיף מוצר חדש?`,()=>PosProdQuick.open(code,{onDone:x=>{M().load(true).then(()=>{const q=(M().C.prods||[]).find(y=>y.id===x.id)||{id:x.id,name:x.name};add(q,1)})}}),'כן, להוסיף');
 else toast('ברקוד לא מוכר: '+code)}
if(window.PosBarcode)PosBarcode.listen(scan,{beep:true});

V.posCntRun=()=>{const T='ספירה';if(!ok())return{t:T,h:'<div class="empty">אין הרשאה</div>'};
 if(!S.id){go('posCnt');return{t:T,h:''}}
 if(!M().C.prods){if(!M().C.busy)M().load().then(redraw);return{t:T,h:'<div class="empty">טוען מוצרים…</div>'}}
 if(!S.cnt){getCnt().then(redraw).catch(e=>{M().err(e);S.id='';go('posCnt')});return{t:T,h:'<div class="empty">טוען…</div>'}}
 const c=S.cnt,open=c.st==='open';
 if(!open)return review();
 const counted=(S.lines||[]).filter(l=>typeof l.cnt==='number'||S.pend.has(l.pid)).length+[...S.pend.keys()].filter(k=>!(S.lines||[]).some(l=>l.pid===k)).length;
 const lp=S.last&&(M().C.prods||[]).find(p=>p.id===S.last);
 const res=S.q.trim().length>=2?(M().C.prods||[]).filter(p=>p.on!==false&&(/^\d{4,}$/.test(S.q.trim())?M().codes(p).some(x=>x.endsWith(S.q.trim())):String(p.name||'').includes(S.q.trim()))).slice(0,8):[];
 const rows=(S.lines||[]).filter(l=>typeof l.cnt==='number'||S.pend.has(l.pid)).concat([...S.pend.keys()].filter(k=>!(S.lines||[]).some(l=>l.pid===k)).map(k=>{const p=(M().C.prods||[]).find(y=>y.id===k)||{};return{pid:k,name:p.name||'',bc:p.barcode||''}}));
 return{t:esc(c.name),s:`נספרו ${counted} מוצרים${c.br&&c.br!=='_'?' · '+esc(brName(c.br)):''}`,h:`<div class="card" style="text-align:center"><p class="note" style="margin:0">סרקו מוצרים בסורק. כל סריקה מוסיפה 1.</p>
  ${lp?`<p style="font-size:1.25em;margin:10px 0 0;overflow-wrap:anywhere"><b>${esc(lp.name)}</b> · ${local(lp.id)}</p>`:'<p style="margin:10px 0 0" class="note">עוד לא נסרק מוצר</p>'}${S.pend.size?`<p class="note" style="margin:4px 0 0">ממתין לשליחה: ${S.pend.size}</p>`:''}</div>
  <label class="f"><span>ברקוד / 4 ספרות אחרונות / שם</span><input id="pcQ" dir="auto" autocomplete="off" value="${esc(S.q)}"></label>
  ${res.map(p=>`<button class="opt" data-a="pcPick" data-id="${esc(p.id)}"><span>${esc(p.name)}<small dir="ltr">${esc(p.barcode||'')}</small></span><b>＋1</b></button>`).join('')}
  <div class="sec"><h3>נספרו</h3></div>${rows.slice().reverse().slice(0,200).map(l=>`<button class="opt" data-a="pcSet" data-id="${esc(l.pid)}"><span style="overflow-wrap:anywhere">${esc(l.name)}<small dir="ltr">${esc(l.bc||'')}</small></span><b>${local(l.pid)}</b></button>`).join('')||'<div class="empty">—</div>'}
  <div class="row" style="margin-top:12px"><button class="btn grow" data-a="pcSubmit">סיימתי – לדוח הפערים</button><button class="btn g grow" data-a="pcBack">חזרה</button></div>`}};
ACT.pcBack=()=>{flush();S.id='';S.L=null;go('posCnt')};
ACT.pcPick=el=>{const p=(M().C.prods||[]).find(x=>x.id===el.dataset.id);if(p){S.q='';add(p,1)}};
document.addEventListener('keydown',e=>{const t=e.target;if(!t||t.id!=='pcQ'||e.key!=='Enter')return;e.preventDefault();e.stopPropagation();const v=t.value.trim();S.q='';t.value='';
 const p=M().find(v);if(p){add(p,1);return}if(/^\d{4,}$/.test(v)){const L=(M().C.prods||[]).filter(x=>M().codes(x).some(c=>c.endsWith(v)));if(L.length===1){add(L[0],1);return}S.q=v;redraw();return}
 if(v.length>=2){S.q=v;redraw()}},true);
document.addEventListener('input',e=>{if(e.target&&e.target.id==='pcQ'){S.q=e.target.value;clearTimeout(S.qt);S.qt=setTimeout(()=>{rerender();const i=document.getElementById('pcQ');if(i){i.focus();i.setSelectionRange(i.value.length,i.value.length)}},300)}});
ACT.pcSet=el=>{const pid=el.dataset.id,p=(M().C.prods||[]).find(x=>x.id===pid)||{};dlg(`<h3>${esc(p.name||'')}</h3><form data-f="pcSetF" data-id="${esc(pid)}"><label class="f"><span>הכמות שנספרה</span><input name="n" inputmode="numeric" dir="ltr" value="${local(pid)}" required></label><div class="row"><button class="btn grow">שמירה</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`)};
FRM.pcSetF=async f=>{const pid=f.dataset.id,n=Number(fd(f).n);if(!Number.isInteger(n)||n<0)return toast('מספר שלם, 0 ומעלה');
 S.pend.delete(pid);try{const r=await M().fnCall('posCnt',{op:'add',id:S.id,items:[{pid,n,set:true}]});const x=(r.items||[])[0];let l=(S.lines||[]).find(y=>y.pid===pid);if(l)l.cnt=x.cnt;closeDlg();rerender()}catch(e){M().err(e)}};
ACT.pcSubmit=()=>ask('לסיים את הספירה? אחרי זה אי אפשר להוסיף סריקות, והמנהל יאשר את הפערים.',async()=>{flush();for(let i=0;i<20&&(S.busy||S.pend.size);i++)await new Promise(r=>setTimeout(r,300));
 try{await M().fnCall('posCnt',{op:'submit',id:S.id});S.cnt=null;rerender()}catch(e){M().err(e)}},'כן, סיימתי');

/* ---------- דוח פערים ואישור ---------- */
function review(){const c=S.cnt,L=S.lines||[];
 const cn=L.filter(l=>typeof l.cnt==='number');const nc=L.filter(l=>typeof l.cnt!=='number');
 const diff=l=>c.st==='done'?(l.d||0):l.cnt-l.now;
 const D=cn.filter(l=>diff(l)!==0).sort((a,b)=>Math.abs(diff(b))-Math.abs(diff(a)));
 return{t:esc(c.name),s:esc(ST[c.st]||c.st),h:`<div class="card"><p style="margin:0"><b>${cn.length}</b> נספרו · <b>${D.length}</b> עם פער · ${nc.length} לא נספרו (לא ישתנו)</p>
  ${c.st==='done'?`<p class="note">אושר ${c.appr?dd(c.appr.at):''}. המלאי עודכן בתנועות "ספירה".</p>`:c.st==='cancel'?'<p class="note">הספירה בוטלה. המלאי לא השתנה.</p>':'<p class="note">פער = נספר פחות המלאי עכשיו. המלאי ישתנה רק אחרי "אישור".</p>'}</div>
  <div class="sec"><h3>פערים</h3></div>${D.slice(0,300).map(l=>`<div class="li" style="cursor:default"><div class="m" style="min-width:0"><b style="overflow-wrap:anywhere">${esc(l.name)}</b><small>במערכת ${c.st==='done'?l.cnt-(l.d||0):l.now} · נספר ${l.cnt}</small></div><b dir="ltr" style="color:${diff(l)<0?'var(--bad)':'inherit'}">${diff(l)>0?'+':''}${diff(l)}</b></div>`).join('')||'<div class="empty">אין פערים</div>'}
  <div class="row" style="margin-top:12px">${['review','apply'].includes(c.st)&&M().mgr()?'<button class="btn grow" data-a="pcAppr">אישור ועדכון המלאי</button>':''}${['review','open'].includes(c.st)?'<button class="btn r grow" data-a="pcCancel">ביטול הספירה</button>':''}<button class="btn g grow" data-a="pcXls">ייצוא</button><button class="btn g grow" data-a="pcBack">חזרה</button></div>
  ${c.st==='review'&&!M().mgr()?'<p class="note">ממתין לאישור מנהל.</p>':''}<p class="note" id="pcPr"></p>`}}
ACT.pcAppr=el=>ask('לעדכן את המלאי לפי הספירה? לכל מוצר עם פער תירשם תנועת מלאי "ספירה".',async()=>{const pr=document.getElementById('pcPr');
 try{let left=1,n=0,a=0;while(left>0&&n<200){const r=await M().fnCall('posCnt',{op:'approve',id:S.id});left=r.left;a+=r.applied;n++;if(pr)pr.textContent=`מעדכן… נשארו ${left}`}
  toast('המלאי עודכן');S.cnt=null;M().load(true);rerender()}catch(e){M().err(e)}},'כן, לעדכן');
ACT.pcCancel=()=>ask('לבטל את הספירה? המלאי לא ישתנה.',async()=>{try{await M().fnCall('posCnt',{op:'cancel',id:S.id});S.cnt=null;rerender()}catch(e){M().err(e)}},'כן, לבטל');
ACT.pcXls=()=>{const c=S.cnt;if(!c||typeof xlsOrCsv!=='function')return;const done=c.st==='done';
 const rows=[['מוצר','ברקוד','במערכת','נספר','פער']].concat((S.lines||[]).map(l=>{const d=typeof l.cnt!=='number'?'':done?(l.d||0):l.cnt-l.now;return[l.name,l.bc||'',typeof l.cnt!=='number'?l.now:done?l.cnt-(l.d||0):l.now,typeof l.cnt==='number'?l.cnt:'לא נספר',d]}));
 xlsOrCsv('ספירת מלאי – '+c.name,{'ספירה':rows})};
})();
