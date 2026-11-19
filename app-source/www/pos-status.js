/* POS:M4 – "מצב המערכת" של הקופה באזור הניהול (אפיון ה ד26, C18-044–046): גרסת האפליקציה, מצב הקופה לעסק, גרסת ההגדרות,
   קופות (סנכרון אחרון / נראה לאחרונה), תור ממתין במכשיר הזה ומדפסת (כשהמודולים של ש3 / ש7 קיימים), ו"דווח על בעיה" (posBug).
   קריאה בלבד – חוץ מהדיווח. מתג 'pos' כבוי = לא מוצג. */
(function(){
'use strict';
if(typeof ACT==='undefined'||typeof V==='undefined')return;
const fnCall=(n,d)=>{d=d&&typeof d==='object'?d:{};if(SY&&SY.sa&&SY.bizId&&!('bizId'in d))d=Object.assign({bizId:SY.bizId},d);return window.fnCall(n,d)};
const on=()=>{try{return bzF('pos')&&bzB()&&!SY.mg}catch(e){return false}};
const mgr=()=>{try{return isA()||!!(SY&&SY.sa)}catch(e){return false}};
const Z={devs:null,err:'',busy:0};
const when=t=>t?new Date(t).toLocaleString('he-IL'):'—';
async function load(){const j=await fsx('/posdev?pageSize=200');Z.devs=((j&&j.documents)||[]).map(d=>Object.assign({id:idOf(d)},fvj({mapValue:d}))).filter(x=>x.st!=='retired');try{await PosCfg.ready()}catch(e){}}
function q(){try{const o=window.PosOffline;if(o&&typeof o.qLen==='function')return String(o.qLen())}catch(e){}return 'לא זמין עדיין'}
function prn(){try{const d=window.Devices;if(d&&typeof d.status==='function'){const s=d.status();return s&&s.printer?String(s.printer):'לא ידוע'}}catch(e){}return 'לא זמין עדיין'}
V.posStatus=()=>{const T='מצב המערכת – קופה';if(!on()||!mgr())return{t:T,h:'<div class="empty">התכונה לא פעילה בעסק הזה</div>'};
 if(!Z.devs){if(!Z.busy&&!Z.err){Z.busy=1;load().catch(e=>{Z.err=e&&e.message||'הטעינה נכשלה'}).finally(()=>{Z.busy=0;if(cur().v==='posStatus')rerender()})}
  return{t:T,h:Z.err?`<div class="card"><p class="note">${esc(Z.err)}</p></div>`:'<div class="empty">טוען…</div>'}}
 const P=window.PosCfg;const st=P?P.st():'';
 const devs=Z.devs.length?Z.devs.map(x=>`<div class="li" style="cursor:default"><div class="m"><b>${esc(x.name||x.id)} <span class="tag ${x.on===true?'t3':'t4'}">${esc(x.id)}</span></b><small>סנכרון אחרון: ${esc(when(x.lastSync))} · נראה לאחרונה: ${esc(when(x.lastSeen))}${x.ver?' · גרסה '+esc(String(x.ver)):''}</small></div></div>`).join(''):'<div class="empty">אין קופות</div>';
 const h=`<div class="card"><h3 style="margin-top:0">כללי</h3>
   <p style="margin:0">גרסת האפליקציה: <b dir="ltr">${esc(String(typeof APP_VC!=='undefined'?APP_VC:'?'))}</b></p>
   <p style="margin:4px 0 0">הקופה לעסק: <b>${P&&P.open()?(st==='trial'?'פתוחה (ניסיון)':'פתוחה'):st==='susp'?'מושעית':'סגורה'}</b> · גרסת הגדרות: <span dir="ltr">${esc(P?P.ver:'?')}</span></p>
   <p style="margin:4px 0 0">תור ממתין במכשיר הזה: ${esc(q())} · מדפסת: ${esc(prn())}</p></div>
  <div class="card"><h3 style="margin-top:0">קופות</h3>${devs}</div>
  <div class="card"><h3 style="margin-top:0">דווח על בעיה</h3><form data-f="posBugF"><label class="f"><span>מה קרה?</span><textarea name="txt" rows="3" maxlength="2000" required></textarea></label><button class="btn w">שליחה</button></form>
   <p class="note">הדיווח נשלח לצוות התמיכה (מנהל־העל) עם שם העסק וגרסת האפליקציה.</p></div>`;
 return{t:T,h}};
FRM.posBugF=async f=>{const txt=String(new FormData(f).get('txt')||'').trim();if(!txt)return toast('כתבו מה קרה');
 let dev='';try{const o=JSON.parse(localStorage.getItem('lp-pos-dev')||'null');if(o&&o.bizId===SY.bizId)dev=o.dev||''}catch(e){}
 try{await fnCall('posBug',Object.assign({txt,ver:String(typeof APP_VC!=='undefined'?APP_VC:'')},dev?{dev}:{}));toast('הדיווח נשלח. תודה!');f.reset()}catch(e){toast(e&&e.message||'השליחה נכשלה')}};
window.addEventListener('lp-biz-change',()=>{Z.devs=null;Z.err=''});
})();
