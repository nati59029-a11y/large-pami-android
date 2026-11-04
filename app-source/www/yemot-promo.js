/* כפתור "שלח לקו": שליחת מבצע לשלוחת המבצעים בקו הטלפוני (דרך פונקציית השרת sendPromoToLine).
   קובץ עצמאי. משתמש רק ב: tok, FB, EMU, SH, ACT, toast, dlg, closeDlg, esc, shN, shTouch, shAdd. התפקיד והמכסה נאכפים בשרת, לא כאן.
   promoKey (it.ym): מזהה קבוע של המבצע, נוצר פעם אחת ונשמר על הפריט. השרת מחזיק קובץ אחד בקו לכל promoKey.
   requestId: אחד לכל תוכן שליחה. ניסיון חוזר עם אותו תוכן = אותו requestId (השרת לא שולח פעמיים); תוכן אחר = requestId חדש. */
(function(){
'use strict';
const YM_DEFAULT_DAYS=7,YM_MAX_DAYS=60,YM_TEXT_MAX=400; // לפי חוזה השמות (שלב 1)
const YM_BASE=()=>(typeof EMU!=='undefined'&&EMU)?`http://${EMU}:5001/${FB.projectId}/us-central1`:`https://us-central1-${FB.projectId}.cloudfunctions.net`;
const YM_MSG={ // הודעות לפי reason מהחוזה; כולן בעברית
 'voice-unavailable':'הקול האנושי לא זמין כרגע. אפשר לשלוח בקול הממוחשב, או לנסות שוב מאוחר יותר.','voice-quota':'הגענו לתקרת הקול האנושי לחודש הזה.',
 'daily-limit':'כבר שלחת היום צינתוק לנרשמים. סימנו "בלי צינתוק": אפשר לשלוח כך עכשיו, לשלוח עם צינתוק מחר, או לבקש ממנהל.',
 'line-full':'אין מקום לעוד מבצעים בשלוחה. פנו למנהל.',
 'yemot-upload-failed':q=>'העלאת ההודעה לקו נכשלה'+(q&&q.withTz?', ולא נשלח צינתוק':'')+'. נסו שוב מאוחר יותר.',
 'busy':'השליחה של המבצע הזה כבר בטיפול. נסו שוב בעוד רגע.','bad-promo-key':'הבקשה לא תקינה. נסו שוב.',
 'no-key':'הקו הטלפוני עוד לא מחובר בשרת. פנו למנהל.',
 'not-signed-in':'צריך להתחבר לאפליקציה.',
 'not-staff':'אין לך הרשאה לשלוח מבצעים לקו.','staff-disabled':'המשתמש שלך מושבת. פנו למנהל.',
 'empty-text':'הנוסח ריק. כתבו מה יוקרא בקו.','text-too-long':`הנוסח ארוך מדי (עד ${YM_TEXT_MAX} תווים).`,
 'bad-date':'תאריך ההורדה לא תקין.','date-past':'תאריך ההורדה כבר עבר.','date-too-far':`אפשר להשאיר מבצע בקו עד ${YM_MAX_DAYS} ימים.`,
 'bad-request-id':'הבקשה לא תקינה. נסו שוב.','bad-input':'הקלט לא תקין.','internal':'שגיאה בשליחה לקו.'};
const YM_STATUS_MSG={UNAUTHENTICATED:'צריך להתחבר לאפליקציה מחדש.',PERMISSION_DENIED:'אין לך הרשאה לשלוח מבצעים לקו.'}; // כשאין reason
const YM_TZ_BLOCKED='כבר שלחת היום צינתוק לנרשמים (עובד: פעם ביום). אפשר להעלות לקו בלי צינתוק, בלי הגבלה.';
const YM_ID=/^[A-Za-z0-9_-]{8,64}$/;
const ymRand=()=>(crypto.randomUUID?crypto.randomUUID().replace(/-/g,''):Date.now().toString(36)+Math.random().toString(36).slice(2,12)+Math.random().toString(36).slice(2,12)).slice(0,24);
let Q=null; // מצב החלון הפתוח. ברירת מחדל: מנהל – עם צינתוק; עובד – בלי צינתוק (צינתוק מהאפליקציה עולה יחידות)
const isoDay=d=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem'}).format(d); // YYYY-MM-DD לפי שעון ישראל
const addDays=(iso,n)=>{const d=new Date(iso+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
const heDate=iso=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(iso||'');return m?`${+m[3]}.${+m[2]}`:''};
const money=v=>shN(v); // שלם או שתי ספרות אחרי הנקודה
function ymText(it,until){ // נוסח אוטומטי. כותבים "שקלים" ולא ₪ כי מנוע ההקראה לא מתועד (לפי שלב 1)
 const p=["מבצע בלארג'"];p.push(String(it.n||'').trim());if(it.d)p.push(String(it.d).trim());
 let o='';
 if(it.kind==='A')o=`${it.k} ב-${money(it.tot)} שקלים`;
 else if(it.kind==='B')o=`רק ${money(it.now)} שקלים`+(it.reg?` במקום ${money(it.reg)}`:'');
 else if(it.p)o=`${money(it.p)} שקלים`;
 let t=p.filter(Boolean).join('. ')+(o?'. '+o:'')+'.';
 if(until)t+=` המבצע בתוקף עד ${heDate(until)}.`;
 return t}
function ymValid(){ // מחזיר '' אם אפשר לשלוח, אחרת סיבה בעברית
 const t=Q.text.trim(),today=isoDay(new Date());
 if(!t)return'הנוסח ריק';
 if(t.length>YM_TEXT_MAX)return`הנוסח ארוך מדי (עד ${YM_TEXT_MAX} תווים)`;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(Q.until))return'יש לבחור תאריך הורדה';
 if(Q.until<today)return'תאריך ההורדה כבר עבר';
 if(Q.until>addDays(today,YM_MAX_DAYS))return`אפשר להשאיר מבצע בקו עד ${YM_MAX_DAYS} ימים`;
 return''}
function ymModes(){return [[true,'העלה לקו + צינתוק לנרשמים'],[false,'העלה לקו בלי צינתוק']].map(([v,t])=>`<button type="button" class="chip ${Q.withTz===v?'on':''}" role="radio" aria-checked="${Q.withTz===v}" data-a="ymMode" data-v="${v}"${v&&Q.tzBlocked?' aria-disabled="true"':''}>${t}</button>`).join('')}
function ymDraw(){
 const d=document.getElementById('dlg');if(!d||!Q)return;const md=d.querySelector('#ymMode');if(md){md.innerHTML=ymModes();md.querySelectorAll('button').forEach(b=>b.disabled=Q.busy||(b.dataset.v==='true'&&Q.tzBlocked))}
 const tn=d.querySelector('#ymTzNote');if(tn){tn.textContent=Q.tzBlocked?YM_TZ_BLOCKED:'';tn.style.display=Q.tzBlocked?'':'none'}
 const bad=Q.busy?'':ymValid(),$q=s=>d.querySelector(s);
 const ok=$q('[data-a=ymConfirm]'),cn=$q('[data-a=ymCancel]'),w=$q('#ymWhy'),c=$q('#ymCnt');
 if(ok){ok.disabled=!!bad||Q.busy;ok.textContent=Q.busy?'שולח…':'אשר ושלח'}
 if(cn)cn.disabled=Q.busy;
 if(w){w.textContent=Q.busy?'':bad;w.style.display=bad?'':'none'}
 if(c)c.textContent=Q.text.trim().length+' / '+YM_TEXT_MAX}
function ymOpen(k,i,opts){
 opts=opts||{}; // opts.builder: נפתח מ"שמור ושלח לקו" במסך בניית מבצע (בלי בחירת צינתוק בחלון; opts.withTz נקבע בכפתור)
 const it=SH&&SH[k]&&SH[k].items&&SH[k].items[i];if(!it){toast('המבצע לא נמצא');return}
 const today=isoDay(new Date());let until=it.vf||'',note='';
 if(until&&until<today){until='';note='תאריך התוקף של המבצע כבר עבר. בחרו תאריך הורדה חדש.'}
 if(!YM_ID.test(it.ym||'')){it.ym='pk'+ymRand();shTouch(k)} // promoKey נוצר פעם אחת לכל מבצע ונשמר (גם בסנכרון)
 Q={k,i,it,key:it.ym,until,fromVf:!!(it.vf&&until),edited:false,busy:false,builder:!!opts.builder,withTz:opts.builder?(opts.withTz===true&&typeof SY!=='undefined'&&!!SY&&SY.role==='admin'):typeof SY!=='undefined'&&!!SY&&SY.role==='admin',tzBlocked:false,rid:null,sig:null,note,text:''};
 Q.text=ymText(it,until);
 const chips=[7,14,30].map(n=>`<button type="button" class="chip" data-a="ymDays" data-v="${n}">${n===YM_DEFAULT_DAYS?n+' ימים (מומלץ)':n+' ימים'}</button>`).join('');
 dlg(`<h3>שליחת מבצע לקו</h3><form data-f="ymform" onsubmit="return false">
 <p class="note" style="margin:0 0 12px">${Q.builder?'המבצע נשמר במכשיר. בדקו את הנוסח, ואשרו כדי להעלות אותו לשלוחת המבצעים.':'המבצע יעלה לשלוחת המבצעים. בחרו אם לשלוח גם צינתוק לנרשמים, ובדקו את הנוסח לפני האישור.'}</p>
 <label class="f"><span>הנוסח שיוקרא בקו</span><textarea id="ymTxt" name="text" rows="5">${esc(Q.text)}</textarea><span class="note" dir="ltr" id="ymCnt" style="text-align:left;margin:4px 0 0"></span></label>
 ${window.ypButton?`<div style="margin:0 0 12px">${ypButton('ymTxt')}</div>`:''}
 ${Q.builder?`<p class="note" id="ymBMode" style="margin:0 0 12px;font-weight:700">${Q.withTz?'יעלה לקו, ויישלח צינתוק לנרשמים (עולה יחידות).':'יעלה לקו, בלי צינתוק.'}</p>`:`<label class="f"><span>מה לעשות</span><div class="chips" id="ymMode"></div><span class="note" id="ymCost" style="display:block;margin:4px 0 0">צינתוק מהאפליקציה עולה יחידות לכל נרשם. צינתוק חינמי – מהטלפון בשלוחת הניהול.</span><span class="note" id="ymTzNote" style="color:var(--warn);display:none"></span></label>`}
 <label class="f"><span>${it.vf&&Q.until?'תאריך הורדה (לפי תוקף המבצע)':'מתי להוריד את המבצע מהקו?'}</span><input id="ymDate" name="until" type="date" value="${esc(Q.until)}" min="${today}" max="${addDays(today,YM_MAX_DAYS)}"></label>
 <div class="chips" style="margin:0 0 12px">${chips}</div>
 ${note?`<p class="note" style="color:var(--warn);font-weight:700;margin:6px 0">${esc(note)}</p>`:''}
 <p id="ymWhy" class="note" style="color:var(--bad);font-weight:700;margin:6px 0"></p>
 <div class="row"><button type="button" class="btn grow" data-a="ymConfirm">אשר ושלח</button><button type="button" class="btn g grow" data-a="ymCancel">ביטול</button></div></form>`);
 const d=document.getElementById('dlg');
 d.querySelector('#ymTxt').addEventListener('input',e=>{Q.text=e.target.value;Q.edited=true;ymDraw()});
 d.querySelector('#ymDate').addEventListener('input',e=>{Q.until=e.target.value;if(!Q.edited)ymRetext();ymDraw()});
 d.addEventListener('cancel',e=>{if(Q&&Q.busy)e.preventDefault()},{once:true});
 d.addEventListener('close',()=>{if(Q&&!Q.busy)Q=null},{once:true});
 ymDraw();ymStatus(Q)}
async function ymStatus(q){
 if(q&&q.builder)return; // במסך החדש אין בחירת צינתוק לעובד, ואין צורך לשאול // האם העובד עוד יכול לצנתק היום (בלי פנייה לימות). כשל = לא משנים כלום, השרת אוכף ממילא
 if(typeof SY!=='undefined'&&SY&&SY.role==='admin')return; // מנהל: אין מגבלה, לא צריך לשאול
 try{const r=await ymCall({statusOnly:true});const t=r&&r.tzintukToday;
  if(Q!==q||q.busy||!t)return;
  if(t.allowed===false){q.tzBlocked=true;q.withTz=false;ymDraw()}}catch(e){}}
function ymRetext(){Q.text=ymText(Q.it,Q.until);const t=document.getElementById('ymTxt');if(t)t.value=Q.text}
function ymErrMsg(e,q){ // כל שגיאה מוצגת בעברית
 if(e&&e.offline)return'אין חיבור לאינטרנט. בדקו ונסו שוב.';
 const r=e&&e.reason;if(r&&YM_MSG[r])return typeof YM_MSG[r]==='function'?YM_MSG[r](q):YM_MSG[r];
 if(e&&e.status&&YM_STATUS_MSG[e.status])return YM_STATUS_MSG[e.status];
 if(e&&e.msg&&/[֐-׿]/.test(e.msg))return e.msg;
 return'השליחה לקו נכשלה. נסו שוב מאוחר יותר.'}
async function ymCall(data){
 const t=await tok();let r,j=null;
 try{r=await fetch(YM_BASE()+'/sendPromoToLine',{method:'POST',headers:{Authorization:'Bearer '+t,'Content-Type':'application/json'},body:JSON.stringify({data})})}
 catch(e){const x=new Error('offline');x.offline=true;throw x}
 try{j=await r.json()}catch(e){}
 if(!r.ok||!j||j.error){const er=(j&&j.error)||{};const x=new Error('send');x.reason=er.details&&er.details.reason;x.status=er.status;x.msg=er.message;throw x}
 return j.result}
function ymSend(q){
 const text=q.text.trim(),sig=JSON.stringify([text,q.until,q.withTz,q.engine||'']);
 if(!q.rid||q.sig!==sig){q.rid='ym'+ymRand();q.sig=sig} // אותו תוכן = אותו requestId בניסיון חוזר; תוכן אחר = חדש
 return ymCall({requestId:q.rid,promoKey:q.key,text,until:q.until,withTzintuk:q.withTz===true,...(q.builder?{origin:'builder'}:{}),...(q.engine?{engine:q.engine}:{}),source:{size:q.k,index:q.i,name:String(q.it.n||'').slice(0,80)}})}
const ymDone=(res,wt)=>res&&typeof res.message==='string'&&/[֐-׿]/.test(res.message)?res.message:res&&res.duplicate?'המבצע הזה כבר נשלח.':wt&&res&&res.tzintuk==='failed'?'ההודעה עלתה לקו, אבל הצינתוק לנרשמים לא נשלח.':wt?'✓ המבצע נשלח לקו, ונשלח צינתוק לנרשמים.':'✓ המבצע הועלה לקו, בלי צינתוק.';
ACT.ymSend=el=>ymOpen(el.dataset.k,+el.dataset.i);
ACT.ymCancel=()=>{if(Q&&Q.busy)return;Q=null;closeDlg()};
ACT.ymDays=el=>{if(!Q||Q.busy)return;Q.until=addDays(isoDay(new Date()),+el.dataset.v);const i=document.getElementById('ymDate');if(i)i.value=Q.until;if(!Q.edited)ymRetext();ymDraw()};
ACT.ymMode=el=>{if(!Q||Q.busy||(el.dataset.v==='true'&&Q.tzBlocked))return;Q.withTz=el.dataset.v==='true';ymDraw()};
ACT.ymConfirm=async()=>{
 if(!Q||Q.busy||ymValid())return; // נעילה סינכרונית: לחיצה כפולה לא עוברת
 Q.busy=true;ymDraw();const q=Q;
 try{const res=await ymSend(q);if(res&&res.warnings&&res.warnings.length)console.warn('yemot warnings',res.warnings);Q=null;closeDlg();toast(ymDone(res,q.withTz))}
 catch(e){q.busy=false;
  // הקול האנושי לא זמין / תקרה: לא עוברים לבד לקול הממוחשב – המשתמש בוחר (שני המסכים)
  if(window.ypIsVoiceErr&&ypIsVoiceErr(e)&&window.ypChoice){ymVoiceChoice(q,e);return}
  if(e&&e.reason==='daily-limit'){q.tzBlocked=true;q.withTz=false}ymDraw();const w=document.getElementById('ymWhy');const m=ymErrMsg(e,q);if(w){w.textContent=m;w.style.display=''}toast(m)}};
function ymVoiceChoice(q,e){
 ypChoice(e,{
  onTts:async()=>{if(Q!==q)throw Object.assign(new Error('gone'),{userMsg:'החלון נסגר. פתחו את המבצע ושלחו שוב.'});
   q.engine='tts';q.busy=true;
   try{const res=await ymSend(q);Q=null;closeDlg();toast(ymDone(res,q.withTz))}
   catch(err){q.busy=false;q.engine=null;err.userMsg=ymErrMsg(err,q);throw err}},
  onLater:()=>{if(Q===q)Q=null}})}
// עריכת מבצע (shAdd עם מקום קיים) יוצרת פריט חדש; שומרים עליו את promoKey, כדי שהשרת יחליף את הקובץ בקו ולא יוסיף עוד אחד
if(typeof shAdd==='function'){const shAdd0=shAdd;window.shAdd=function(k,it,idx){try{const o=idx!=null&&idx>=0&&SH[k]&&SH[k].items&&SH[k].items[idx];if(o&&o.ym&&it&&!it.ym)it=Object.assign({},it,{ym:o.ym})}catch(e){}return shAdd0.call(this,k,it,idx)}}
/* "שמור ושלח לקו" בטופס "מבצע למדף". לא משנים את FRM.shpromo: עוטפים אותו, והחלון נפתח אחרי ש-shAdd שמר את המבצע במכשיר.
   כפתור "שמור, שלח לקו וצנתק" מוצג למנהל בלבד (הנוחות במסך; האכיפה בשרת). שמירה רגילה ("אישור והוספה") לא משתנה. */
let YB=null; // {withTz, at}: נקבע בכל שליחת טופס (גם null בשמירה רגילה), כך שאין מצב תקוע
const ymIsAdmin=()=>typeof SY!=='undefined'&&!!SY&&SY.role==='admin';
window.ymSaveBtns=()=>`<div class="row" style="margin-top:8px"><button class="btn g grow" name="go" value="ym">שמור ושלח לקו</button>${ymIsAdmin()?'<button class="btn g grow" name="go" value="ymtz">שמור, שלח לקו וצנתק</button>':''}</div>`;
if(typeof shAdd==='function'){const shAdd1=window.shAdd;window.shAdd=function(k,it,idx){const r=shAdd1.call(this,k,it,idx);
 if(YB&&Date.now()-YB.at<60000&&k!=='price'&&typeof r==='number'){const b=YB;YB=null;setTimeout(()=>ymOpen(k,r,{builder:true,withTz:b.withTz}),0)}return r}}
if(typeof FRM!=='undefined'&&FRM.shpromo){const f0=FRM.shpromo;FRM.shpromo=function(f,e){const v=e&&e.submitter&&e.submitter.value;
 YB=v==='ym'||(v==='ymtz'&&ymIsAdmin())?{withTz:v==='ymtz',at:Date.now()}:null;
 const r=f0.apply(this,arguments);const d=document.getElementById('dlg');if(!(d&&d.open))YB=null; // אם לא נפתח חלון אישור-החלפה, אין מה להשאיר
 return r}}
window.ymText=ymText; // נוסח המבצע האוטומטי – משותף גם למשבצת "שלוחות הקו" (yemot-line.js)
window.ymBtn=(k,i)=>k==='price'?'':`<button class="btn s g" style="flex:0 0 100%" data-a="ymSend" data-k="${esc(k)}" data-i="${+i}">שלח לקו</button>`;
})();
