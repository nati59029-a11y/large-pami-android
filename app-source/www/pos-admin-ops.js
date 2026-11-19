/* POS:M7 – pos-admin-ops.js (קופה, ש7, 17.11.2026). אזור הניהול בלבד. V.posOps – "תפעול" (אפיון ד 3.2):
     • גיבוי ושחזור: הגיבוי האחרון, "גבה עכשיו" (bkManual: מנהל), רשימת גרסאות, "שחזר לגרסה" (restoreBy: בעל העסק בלבד, אישור כפול).
       השחזור מחזיר רק הגדרות (poscfg/main, promo, clubcfg). מכירות, תשלומים ומסמכים לא נמחקים ולא נדרסים לעולם.
     • יומן תקלות (poserr) – טכני בלבד, בלי פרטי לקוחות.
     • התנגשויות (posconf, פתוחות) – המנהל בוחר איזה ערך נשאר.
     • הזנה ידנית אחרי תקלה (manEntry): מכירה עם השעה האמיתית וסיבה, מהמכשיר הזה (קופה רשומה), מסומנת "הוזנה ידנית".
   כל כתיבה – רק דרך השרת: posBackup, posOps (firebase/functions/pos-ops.js, pos-backup.js). */
(function(){
'use strict';
if(typeof ACT==='undefined'||typeof V==='undefined')return;
const fnCall=(n,d)=>{d=d&&typeof d==='object'?d:{};if(SY&&SY.sa&&SY.bizId&&!('bizId'in d))d=Object.assign({bizId:SY.bizId},d);return window.fnCall(n,d)};
const on=()=>{try{return bzF('pos')&&bzB()&&!SY.mg}catch(e){return false}};
const mgr=()=>{try{return isA()||!!(SY&&SY.sa)}catch(e){return false}};
const dec=d=>Object.assign({id:idOf(d)},fvj({mapValue:d}));
const err=e=>toast(e&&e.message||'הפעולה נכשלה');
const ls=k=>{try{return localStorage.getItem(k)}catch(e){return null}};
const P={bk:null,errs:null,conf:null,e:''};let ld=0;
const typing=()=>{const a=document.activeElement;return !!(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)&&a.closest('#main'))};
async function loadAll(){
 const [bk,er,cf]=await Promise.all([fnCall('posBackup',{op:'list'}),fsx('/poserr?orderBy=at%20desc&pageSize=50').catch(()=>null),fsx('/posconf?pageSize=200').catch(()=>null)]);
 P.bk=bk;P.errs=((er&&er.documents)||[]).map(dec);P.conf=((cf&&cf.documents)||[]).map(dec).filter(x=>x.st==='open').sort((a,b)=>(+b.at||0)-(+a.at||0))}
function load(){if(ld)return;ld=1;loadAll().then(()=>{P.e=''},e=>{P.e=e&&e.message||'הטעינה נכשלה'}).finally(()=>{ld=0;if(cur().v==='posOps'&&!typing()&&!document.querySelector('#dlg[open]'))rerender()})}
const when=t=>{if(!t)return'';try{return new Date(+t).toLocaleString('he-IL',{dateStyle:'short',timeStyle:'short'})}catch(e){return''}};
const KIND={auto:'אוטומטי',manual:'ידני',month:'עותק חודשי',pre:'לפני שחזור'};
const SEV={info:['t2','מידע'],err:['t1','שגיאה'],crit:['t4','חמורה']};
const val=v=>{if(v==null)return'—';if(typeof v==='object')return esc(JSON.stringify(v).slice(0,120));return esc(String(v).slice(0,120))};
function myDev(){try{const o=JSON.parse(ls('lp-pos-dev')||'null');return o&&o.bizId===SY.bizId&&/^K[1-9][0-9]{0,3}$/.test(o.dev||'')?o.dev:''}catch(e){return ''}}
function bkCard(){const b=P.bk||{},it=Array.isArray(b.items)?b.items:[];const last=it.find(x=>x.ok);const fail=it.length&&!it[0].ok;
 return `<div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><h3 style="margin:0">גיבוי ושחזור</h3>${window.PosHelp?PosHelp.btn('ops'):''}</div>
 <p class="note" style="margin:6px 0">${last?'גיבוי אחרון: '+esc(when(last.at))+' ('+esc(KIND[last.kind]||last.kind)+')':'עוד לא נעשה גיבוי'}${b.lastExt?' · עותק חודשי אחרון: '+esc(when(b.lastExt)):''}</p>
 ${fail?`<p class="note" style="margin:0 0 6px;color:var(--bad,#c62828)">הגיבוי האחרון נכשל (${esc(when(it[0].at))}). נסו "גבה עכשיו".</p>`:''}
 ${b.canRun?'<button class="btn w" data-a="posBkNow">גבה עכשיו</button>':'<p class="note">גיבוי ידני – לפי ההגדרה bkManual.</p>'}
 ${it.length?'<div style="margin-top:8px">'+it.slice(0,30).map(x=>`<div class="li" style="cursor:default"><div class="m"><b>${esc(when(x.at))}</b><small>${esc(KIND[x.kind]||x.kind)} · ${x.ok?(+x.n||0)+' רשומות':'נכשל'}</small></div>${b.canRestore&&x.ok?`<button class="btn s g" data-a="posBkRestore" data-id="${esc(x.id)}" data-at="${esc(when(x.at))}">שחזר לגרסה</button>`:''}</div>`).join('')+'</div>':''}
 <p class="note">${b.canRestore?'שחזור מחזיר את ההגדרות, המבצעים והגדרות המועדון לגרסה שנבחרה. מכירות, תשלומים ומסמכים לא נמחקים.':'שחזור – רק בעל העסק.'}</p></div>`}
function errCard(){const e=P.errs||[];return `<div class="card"><h3 style="margin-top:0">יומן תקלות</h3>${e.length?e.map(x=>{const s=SEV[x.sev]||SEV.info;return `<div class="li" style="cursor:default"><div class="m"><b><span class="tag ${s[0]}">${s[1]}</span> ${esc(x.msg||x.code||'')}</b><small>${esc(when(x.at))}${x.dev?' · קופה '+esc(x.dev):''}${x.code?' · '+esc(x.code):''}${x.ver?' · גרסה '+esc(x.ver):''}</small></div></div>`}).join(''):'<div class="empty">אין תקלות רשומות</div>'}<p class="note">היומן טכני בלבד: אין בו שמות, טלפונים או סכומים של לקוחות.</p></div>`}
function confCard(){const c=P.conf||[];return `<div class="card"><h3 style="margin-top:0">התנגשויות להכרעה</h3>${c.length?c.map(x=>`<div class="li" style="cursor:default;align-items:flex-start"><div class="m"><b>${esc(x.kind||'שינוי')} ${x.ref?'· '+esc(x.ref):''}</b><small>א: ${val(x.a)}<br>ב: ${val(x.b)}<br>${esc(when(x.at))}</small></div><button class="btn s g" data-a="posConf" data-id="${esc(x.id)}" data-pick="a">להשאיר א</button><button class="btn s g" data-a="posConf" data-id="${esc(x.id)}" data-pick="b">להשאיר ב</button></div>`).join(''):'<div class="empty">אין התנגשויות פתוחות</div>'}</div>`}
function manCard(){const d=myDev();const t=new Date(Date.now()-3600000),pad=n=>String(n).padStart(2,'0');const v=`${t.getFullYear()}-${pad(t.getMonth()+1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`;
 return `<div class="card"><h3 style="margin-top:0">הזנה ידנית אחרי תקלה</h3>${!d?'<p class="note">ההזנה נעשית ממכשיר שרשום כקופה. רשמו את המכשיר הזה במסך "ניהול קופה".</p>':
 `<form data-f="posManF"><p class="note" style="margin:0 0 6px">קופה ${esc(d)}. המכירה נשמרת עם השעה האמיתית והסיבה, ומסומנת "הוזנה ידנית".</p>
 <label class="f"><span>מתי הייתה המכירה</span><input type="datetime-local" name="realAt" value="${v}" required></label>
 <label class="f"><span>סיבה</span><input name="why" maxlength="200" required placeholder="למשל: הפסקת חשמל, נרשם על דף"></label>
 <label class="f"><span>פריטים – שורה לכל פריט: שם | כמות | מחיר ליחידה בש"ח</span><textarea name="lines" rows="4" required placeholder="לחם אחיד | 2 | 6.90"></textarea></label>
 <button class="btn w">שמירת המכירה</button></form>`}</div>`}
V.posOps=()=>{const T='תפעול';if(!on()||!mgr())return{t:T,h:'<div class="empty">התכונה לא פעילה בעסק הזה</div>'};
 if(!P.bk){load();return{t:T,h:P.e?`<div class="card"><p class="note">${esc(P.e)}</p><button class="btn g w" data-a="posOpsRe">נסה שוב</button></div>`:'<div class="empty">טוען…</div>'}}
 return{t:T,h:bkCard()+confCard()+errCard()+manCard()}};
ACT.posOpsRe=()=>{P.bk=null;P.e='';rerender()};
ACT.posBkNow=async el=>{el.disabled=true;try{const r=await fnCall('posBackup',{op:'now'});toast('הגיבוי נשמר ('+(+r.n||0)+' רשומות)');P.bk=null;rerender()}catch(e){err(e)}finally{el.disabled=false}};
ACT.posBkRestore=async el=>{const id=el.dataset.id;
 if(!(await ask('לשחזר את ההגדרות, המבצעים והגדרות המועדון לגרסה של '+el.dataset.at+'? לפני השחזור יישמר גיבוי של המצב הנוכחי. מכירות ותשלומים לא משתנים.')))return;
 const w=window.prompt('אישור שני: כתבו את המילה שחזור');if((w||'').trim()!=='שחזור')return toast('השחזור בוטל');
 el.disabled=true;try{const r=await fnCall('posBackup',{op:'restore',id,confirm:'שחזור'});toast('שוחזר: '+(+r.n||0)+' רשומות');P.bk=null;rerender()}catch(e){err(e)}finally{el.disabled=false}};
ACT.posConf=async el=>{el.disabled=true;try{await fnCall('posOps',{op:'conf',id:el.dataset.id,pick:el.dataset.pick});toast('נשמר');P.bk=null;rerender()}catch(e){err(e)}finally{el.disabled=false}};
/* "לחם | 2 | 6.90" → {n, qty, unit באגורות}. שורה לא תקינה – הודעה, לא שליחה חלקית */
function parseLines(txt){const out=[];for(const raw of String(txt||'').split('\n')){const s=raw.trim();if(!s)continue;const p=s.split('|').map(x=>x.trim());
 const n=p[0],qty=Number((p[1]||'1').replace(',','.')),pr=Number((p[2]||'').replace(/[₪\s]/g,'').replace(',','.'));
 if(!n||!(qty>0)||!Number.isFinite(pr)||pr<0)throw new Error('שורה לא תקינה: '+s.slice(0,40));
 out.push({n:n.slice(0,120),qty:Math.round(qty*1000)/1000,unit:Math.round(pr*100)})}
 if(!out.length)throw new Error('אין פריטים');return out}
FRM.posManF=async f=>{const fd=new FormData(f);let lines;try{lines=parseLines(fd.get('lines'))}catch(e){return toast(e.message)}
 const realAt=new Date(String(fd.get('realAt')||'')).getTime(),why=String(fd.get('why')||'').trim();
 if(!Number.isFinite(realAt)||realAt>Date.now())return toast('שעת המכירה לא תקינה');if(!why)return toast('כתבו סיבה');
 const a=new Uint8Array(12);crypto.getRandomValues(a);const reqId='m'+Array.from(a,b=>b.toString(16).padStart(2,'0')).join('');
 let inst='';try{inst=localStorage.getItem('lp-pos-inst')||''}catch(e){}
 if(!(await ask('לשמור מכירה ידנית של '+lines.length+' פריטים?')))return;
 try{const r=await fnCall('posOps',{op:'manual',dev:myDev(),inst,realAt,why,lines,reqId});toast('המכירה נשמרה: '+r.id);f.reset()}catch(e){err(e)}};
window.addEventListener('lp-biz-change',()=>{P.bk=null;P.errs=null;P.conf=null;P.e=''});
})();
