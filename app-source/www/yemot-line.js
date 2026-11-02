/* משבצת "שלוחות הקו": שליחת תוכן לשלוחות של הקו הטלפוני (ימות), דרך פונקציות השרת.
   קובץ עצמאי. מחבר את עצמו ל-V.yl ול-window.ylTile, ולא משנה מסכים קיימים (חוץ מהוספת המשבצת עצמה).
   עובד: שלוחות 1 (מתכונים), 2 (מבצעים), 3 (עדכונים). מנהל: גם 4 (שעות וכתובת), הודעת פתיחה ומילון הגייה.
   ההרשאות נאכפות בשרת ובכללי המסד. כאן רק נוחות: מה מוצג למי.
   בכל מקום שנשלח טקסט: חלון אישור עם "שמע קודם" (yemot-preview.js). מנעול ריצה: לחיצה כפולה = בקשה אחת.
   טיוטות הטקסט נשמרות בזיכרון ובמכשיר עד שליחה מוצלחת, ורענון אוטומטי לא בונה מחדש מסך שיש בו טקסט.
   משתמש רק ב: V, ACT, INP, CHG, go, cur, render, ask, dlg, closeDlg, toast, esc, ico, isA, tok, fsx, FNB, SY, SH, shTouch, shN, shImg, shAIcall, ypButton, ypLexicon. */
(function(){
'use strict';
if(typeof V==='undefined'||typeof ACT==='undefined')return;
const DK='lp-yl-draft',ID=/^[A-Za-z0-9_-]{8,64}$/,MG=['4','open','lex'];
const DEF={recipes:2500,updates:800,hours:600,opening:600,promo:400,lex:8000,recordSec:120,tempMaxDays:60,promoMaxDays:60}; // ברירות מחדל לפי החוזה; השרת מחזיר את הערכים האמיתיים ב-getLineState
const LEX_DENY='רק מנהל יכול לשנות את מילון ההגייה.';
const MSG={ // הודעות לפי reason מהשרת (גיבוי, אם ההודעה מהשרת לא בעברית)
 'tzintuk-manager-only':'רק מנהל יכול לשלוח צינתוק. אפשר לשלוח לקו בלי צינתוק.','manual-manager-only':'רק מנהל יכול להוסיף מבצע ידני.',
 'slot-manager-only':'רק מנהל יכול לשנות את השלוחה הזו.','manager-only':'הפעולה הזו מותרת למנהל בלבד.','bad-slot':'השלוחה לא מוכרת.',
 'empty-text':'הנוסח ריק. כתבו מה יוקרא בקו.','text-too-long':'הנוסח ארוך מדי.','bad-audio':'ההקלטה לא בפורמט הנכון. הקליטו שוב.','audio-too-long':'ההקלטה ארוכה מדי.',
 'audio-not-allowed':'אפשר לשלוח הקלטה רק לשלוחת העדכונים.','item-not-found':'הפריט לא נמצא (ייתכן שכבר הוסר).','busy':'פעולה אחרת על הקו בטיפול. נסו שוב בעוד רגע.',
 'line-full':'אין מקום לעוד קבצים בשלוחה. פנו למנהל.','yemot-upload-failed':'ההעלאה לקו נכשלה. נסו שוב מאוחר יותר.',
 'yemot-uncertain':'לא בטוח שההעלאה הצליחה. בדקו ברשימה בעוד דקה לפני שליחה חוזרת.','yemot-remove-failed':'ההסרה מהקו נכשלה. נסו שוב.',
 'yemot-list-failed':'לא הצלחנו לקרוא את השלוחה מהקו. נסו שוב.','bad-file':'אפשר למחוק מהאפליקציה רק קובצי תוכן בשלוחה 4.',
 'no-key':'הקו הטלפוני עוד לא מחובר בשרת. פנו למנהל.','bad-request-id':'הבקשה לא תקינה. נסו שוב.','bad-promo-key':'הבקשה לא תקינה. נסו שוב.','bad-input':'הקלט לא תקין.',
 'bad-date':'תאריך ההורדה לא תקין.','date-past':'תאריך ההורדה כבר עבר.','date-too-far':'תאריך ההורדה רחוק מדי.','daily-limit':'כבר שלחת היום צינתוק לנרשמים.',
 'not-signed-in':'צריך להתחבר לאפליקציה.','not-staff':'אין לך הרשאה לשלוח לקו.','staff-disabled':'המשתמש שלך מושבת. פנו למנהל.',
 'opening-verify-failed':'הפתיחה לא עודכנה כמו שצריך ושוחזרה. נסו שוב.','opening-unexpected':'הגדרת הפתיחה בקו לא במבנה הצפוי, ולכן לא שונתה. פנו לתמיכה.','backup-failed':'לא הצלחנו לגבות את מבנה הקו, ולכן לא שינינו כלום. נסו שוב.','internal':'שגיאה בפעולה מול הקו.'};
const STATUS={UNAUTHENTICATED:'צריך להתחבר לאפליקציה מחדש.',PERMISSION_DENIED:'אין לך הרשאה לפעולה הזו.',UNAVAILABLE:'השרת לא זמין כרגע. נסו שוב מאוחר יותר.',DEADLINE_EXCEEDED:'השרת לא הגיב בזמן. נסו שוב.'};
const he=s=>typeof s==='string'&&/[֐-׿]/.test(s);
const rand=()=>(crypto.randomUUID?crypto.randomUUID().replace(/-/g,''):Date.now().toString(36)+Math.random().toString(36).slice(2,12)+Math.random().toString(36).slice(2,12)).slice(0,24);
const isoDay=d=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem'}).format(d);
const addDays=(iso,n)=>{const d=new Date(iso+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
const heDate=iso=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(iso||'');return m?`${+m[3]}.${+m[2]}`:''};
const fdt=iso=>{const d=new Date(iso);return isNaN(d)?'':d.toLocaleString('he-IL',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})};
const fsec=s=>{s=Math.max(0,Math.round(s));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0')};
const Y={d:{},uid:null,st:null,files:null,mode3:'type',rec:null,c:null,sending:false,force:false,scanning:false};
function getD(){const u=(SY&&SY.uid)||'';if(Y.uid===u)return Y.d;Y.uid=u;try{const o=JSON.parse(localStorage.getItem(DK)||'null');Y.d=o&&o.uid===u&&o.d&&typeof o.d==='object'?o.d:{}}catch(e){Y.d={}}return Y.d}
function save(){try{localStorage.setItem(DK,JSON.stringify({uid:Y.uid,d:Y.d}))}catch(e){}}
const lim=()=>Object.assign({},DEF,(Y.st&&Y.st.r&&Y.st.r.limits)||{});
// ---------- שרת ----------
async function call(name,data,ms){
 const t=await tok(),ctl=new AbortController(),tm=setTimeout(()=>ctl.abort(),ms||75000);let r,j=null;
 try{r=await fetch(FNB()+'/'+name,{method:'POST',headers:{Authorization:'Bearer '+t,'Content-Type':'application/json'},body:JSON.stringify({data}),signal:ctl.signal})}
 catch(e){const x=new Error(e&&e.name==='AbortError'?'timeout':'offline');x.offline=true;x.timeout=e&&e.name==='AbortError';throw x}finally{clearTimeout(tm)}
 try{j=await r.json()}catch(e){}
 if(!r.ok||!j||j.error){const er=(j&&j.error)||{};const x=new Error('call');x.reason=er.details&&er.details.reason;x.status=er.status;x.msg=er.message;throw x}
 return j.result}
function errMsg(e){ // כל שגיאה מוצגת בעברית, עם הסיבה האמיתית מהשרת
 if(e&&e.timeout)return'השרת לא הגיב בזמן. אפשר לנסות שוב: אם הפעולה כבר הצליחה, הבקשה לא תישלח פעמיים.';
 if(e&&e.offline)return'אין חיבור לאינטרנט. בדקו ונסו שוב.';
 if(e&&e.msg&&he(e.msg))return e.msg;
 const r=e&&e.reason;if(r&&MSG[r])return MSG[r];
 if(e&&e.status&&STATUS[e.status])return STATUS[e.status];
 if(e&&e.message&&he(e.message))return e.message;
 return'הפעולה נכשלה. נסו שוב מאוחר יותר.'}
async function state(force){
 if(!force&&Y.st&&Date.now()-Y.st.at<30000)return Y.st;
 const r=await call('getLineState',{});Y.st={at:Date.now(),r};
 if(r&&typeof r.lexicon==='string'&&window.ypLexicon)window.ypLexicon(r.lexicon); // מילון שמור = מה ש"שמע קודם" מחיל
 return Y.st}
// ---------- עזרים לתצוגה ----------
const box=f=>document.querySelector(`[data-f="${f}"]`);
const here=a=>cur().v==='yl'&&(cur().a||'')===a;
const typing=()=>{const m=document.getElementById('main');if(!m)return false;const ae=document.activeElement;
 return[...m.querySelectorAll('textarea,input:not([type=file]):not([type=date]):not([type=radio]):not([type=checkbox])')].some(b=>b===ae||String(b.value||'').trim())};
function redraw(){Y.force=true;try{render(0,true)}finally{Y.force=false}}
if(typeof render==='function'){const render0=render;window.render=function(dir,keep){ // רענון אוטומטי לא בונה מחדש מסך שיש בו טקסט בתיבה
 if(keep&&!Y.force&&cur().v==='yl'&&typing())return;
 return render0.apply(this,arguments)}}
function sync(f,max){ // מעדכן מונה וכפתור שליחה בלי לבנות את המסך מחדש
 const b=box(f),v=b?b.value:'',c=document.getElementById('ylc_'+f),g=document.getElementById('ylgo_'+f);
 if(c)c.textContent=v.length+' / '+max;
 if(g)g.disabled=!v.trim()||v.length>max}
const FMAX=f=>({r:lim().recipes,u:lim().updates,h:lim().hours,o:lim().opening,m:lim().promo,x:lim().lex})[f];
INP.ylin=el=>{const f=el.dataset.f;getD()[f]=el.value;save();sync(f,FMAX(f));if(f==='x')lexInfo()};
function setBox(f,v){const b=box(f);if(b){b.value=v;sync(f,FMAX(f))}}
const field=(f,label,rows,ph)=>{const v=getD()[f]==null?'':String(getD()[f]);return`<label class="f"><span>${label}</span><textarea id="yl_${f}" rows="${rows}" dir="auto" data-i="ylin" data-f="${f}"${ph?` placeholder="${esc(ph)}"`:''}>${esc(v)}</textarea><span class="note" id="ylc_${f}" dir="ltr" style="text-align:left;margin:4px 0 0">${v.length} / ${FMAX(f)}</span></label>`};
const sendBtn=(f,s,txt)=>`<button class="btn w" id="ylgo_${f}" data-a="ylSend" data-s="${s}"${String(getD()[f]||'').trim()?'':' disabled'}>${txt||'שלח לקו…'}</button>`;
const opt=(v,t,s)=>`<button class="opt" data-a="ylGo" data-v="${v}" style="min-height:84px"><span style="font-size:1.1rem;font-weight:800">${t}<small>${s}</small></span>${ico('chev')}</button>`;
// ---------- משבצת במסך הבית ----------
window.ylTile=()=>`<button class="tile" data-a="go" data-v="yl" style="border-color:var(--acc);color:var(--acc);font-size:1.15rem;text-align:center"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:34px;height:34px;display:block;margin:0 auto 6px"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>שלוחות הקו</button>`;
ACT.ylGo=el=>go('yl',el.dataset.v);
// ---------- המסכים ----------
V.yl=a=>{a=a||'';
 if(Y.rec&&Y.rec.on&&a!=='3')recDiscard();
 if(MG.includes(a)&&!isA())return{t:'שלוחות הקו',h:'<div class="empty">הפעולה הזו מותרת למנהל בלבד.</div>'};
 getD();setTimeout(()=>ylLoad(a),0);
 return({'':vMain,'1':vRecipes,'2':vPromos,'3':vUpdates,'4':vHours,open:vOpen,lex:vLex}[a]||vMain)()};
function vMain(){const m=isA();
 return{t:'שלוחות הקו',s:m?'מנהל':'עובד',h:`<p class="note" style="margin:0 0 12px">בוחרים שלוחה, כותבים או מקליטים, שומעים איך זה ייראה, ורק אחרי אישור זה עולה לקו.</p>
 ${opt('1','שלוחה 1 · מתכונים','כתיבה או סריקה מצילום · החדש מושמע ראשון')}
 ${opt('2','שלוחה 2 · מבצעים','בחירת מבצע מהמדף, תיקון נוסח ושליחה')}
 ${opt('3','שלוחה 3 · עדכונים','הקלדה או הקלטה · החדש מושמע ראשון')}
 ${m?`${opt('4','שלוחה 4 · שעות וכתובת','הודעה קבועה או זמנית, ומחיקה')}${opt('open','הודעת פתיחה','מה שנשמע בכניסה לקו')}${opt('lex','מילון הגייה','איך לבטא שמות ומילים בקו')}`:''}`}}
function listHtml(slot){
 const L=Y.st&&Y.st.r&&Y.st.r.slots&&Y.st.r.slots[slot];if(!L)return'<p class="note">טוען…</p>';
 if(!L.length)return'<p class="note">עוד לא נשלחו פריטים דרך האפליקציה. קבצים שהיו בקו לפני כן נשארים כמו שהם.</p>';
 return L.map((x,i)=>`<div class="li" style="cursor:default;flex-wrap:wrap"><div class="m"><b>${esc(x.title||x.file||'ללא שם')}</b><small>${esc(fdt(x.createdAt))}${x.byRole?' · '+(x.byRole==='manager'?'מנהל':'עובד'):''}${i===0?' · מושמע ראשון':''}${x.status==='remove-failed'?' · ההסרה נכשלה':''}</small></div>${isA()?`<button class="btn s r" data-a="ylRm" data-id="${esc(x.id)}">הסר</button>`:''}</div>`).join('')}
function paintList(slot){const el=document.getElementById('ylList');if(el)el.innerHTML=listHtml(slot)}
async function ylLoad(a,force){
 if(!here(a)||!['1','3','4','open','lex'].includes(a))return;
 const el=document.getElementById('ylList'),fail=e=>{if(here(a)&&el)el.innerHTML=`<p class="note" style="color:var(--bad)">לא הצלחנו לטעון: ${esc(errMsg(e))}</p>`};
 try{
  if(a==='4'){const r=await call('listLineFiles',{ext:'4'});Y.files=r&&r.files||[];if(here(a))paintFiles();return}
  const s=await state(force);if(!here(a))return;
  if(a==='1')paintList('recipes');
  if(a==='3')paintList('updates');
  if(a==='open'){const cur0=s.r.slots&&s.r.slots.opening&&s.r.slots.opening.current;if(getD().o==null&&cur0&&cur0.text)setBox('o',cur0.text);
   const n=document.getElementById('ylOpenNote');if(n)n.textContent=cur0&&cur0.createdAt?'הנוסח הנוכחי נשלח ב-'+fdt(cur0.createdAt)+'.':'עוד לא נשלחה הודעת פתיחה מהאפליקציה. כתבו את הנוסח המלא.'}
  if(a==='lex'){if(getD().x==null)setBox('x',s.r.lexicon||'');lexInfo()}
 }catch(e){fail(e)}}
// שלוחה 1 – מתכונים
function vRecipes(){
 return{t:'מתכונים',s:'שלוחה 1',h:`<div class="card"><p class="note" style="margin:0 0 10px">כותבים את המתכון, או סורקים אותו מצילום (גם כתב יד). אפשר לתקן לפני השליחה. המתכון החדש יושמע ראשון.</p>
 <label class="btn g w" style="cursor:pointer;margin-bottom:6px">סרוק מתכון מצילום<input type="file" accept="image/*" multiple data-c="ylscan" hidden></label>
 <p class="note" id="ylScanMsg" aria-live="polite" style="margin:0 0 10px">${getD().rs==='scan'&&getD().r?'המתכון נסרק מצילום. בדקו ותקנו לפני השליחה.':'אפשר לבחור עד 2 תמונות (למשל שני עמודים).'}</p>
 ${field('r','נוסח המתכון (שם, מצרכים, אופן ההכנה)',9)}${sendBtn('r','recipes')}</div>
 <div class="sec"><h3>המתכונים שבקו</h3></div><div id="ylList">${listHtml('recipes')}</div>`}}
const scanImgs=async fs=>{const o=[];for(const f of fs){const du=await shImg(f,1800);o.push({inline_data:{mime_type:'image/jpeg',data:du.split(',')[1]}})}return o};
CHG.ylscan=el=>{const all=[...el.files];el.value='';if(!all.length||Y.scanning)return;const fs=all.slice(0,2);
 const msg=(t,bad)=>{const m=document.getElementById('ylScanMsg');if(m){m.textContent=t;m.style.color=bad?'var(--bad)':''}};
 const run=async()=>{Y.scanning=true;msg('קורא את המתכון… זה יכול לקחת עד דקה וחצי.'+(all.length>2?' נשלחו 2 התמונות הראשונות.':''));
  try{
   const t=await shAIcall({contents:[{parts:await scanImgs(fs)}]},'srv',160000,true,'recipe');
   let o=null;try{o=JSON.parse(String(t).replace(/```json|```/g,'').trim())}catch(e){}
   let text=String((o&&o.text)||(o?'':t)||'').trim();const title=String((o&&o.title)||'').trim();
   if(!text)throw new Error('לא זוהה מתכון בתמונה. נסו לצלם מקרוב ובאור טוב, או להקליד.');
   if(title&&!text.includes(title.slice(0,12)))text=title+'. '+text;
   const d=getD();d.r=text;d.rs='scan';save();
   if(here('1')){setBox('r',text);msg('המתכון נסרק מצילום. בדקו ותקנו לפני השליחה.')}
  }catch(e){let m=e&&e.message||'';
   if(/סוג זיהוי לא מוכר/.test(m))m='סריקת מתכונים עוד לא פעילה בשרת';
   msg('הסריקה לא הצליחה: '+(he(m)?m:'השרת של הזיהוי לא זמין כרגע')+'. אפשר להקליד את המתכון.',true)}
  finally{Y.scanning=false}};
 if((getD().r||'').trim())ask('בתיבה כבר יש טקסט. להחליף אותו בטקסט שייסרק מהתמונה?',run,'כן, להחליף');else run()};
// שלוחה 2 – מבצעים
function promoRows(){const rows=[];['p8','p2','p1'].forEach(k=>((typeof SH!=='undefined'&&SH[k]&&SH[k].items)||[]).forEach((it,i)=>{if(it)rows.push({k,i,it})}));return rows}
const offerTxt=it=>it.kind==='A'?`${it.k} ב-${shN(it.tot)} ₪`:it.kind==='B'?`ב-${shN(it.now)} ₪ (רגיל ${shN(it.reg)})`:'₪ '+shN(it.p);
function vPromos(){const rows=promoRows(),m=isA();
 if(typeof shSync==='function'&&typeof shOn==='function'){try{if(shOn())shSync().then(ch=>{if(ch&&here('2')&&!typing())redraw()}).catch(()=>{})}catch(e){}}
 return{t:'מבצעים',s:'שלוחה 2',h:`<div class="card"><p class="note" style="margin:0">בוחרים מבצע מהמדף, מתקנים את הנוסח, שומעים ושולחים. ${m?'מנהל יכול לבחור גם צינתוק.':'השליחה היא בלי צינתוק.'}</p></div>
 <div class="sec"><h3>המבצעים במדף</h3></div>
 ${rows.length?rows.map(x=>`<div class="li" style="cursor:default;flex-wrap:wrap"><div class="m"><b>${esc(x.it.n)}</b><small>${esc(offerTxt(x.it))}${x.it.d?' · '+esc(x.it.d):''}</small></div><button class="btn s" data-a="ylPromo" data-k="${x.k}" data-i="${x.i}">שלח לקו…</button></div>`).join(''):'<p class="note">אין עדיין מבצעים במדף. בונים אותם במסך "מחירים ומבצעים למדף", "מבצע למדף".</p>'}
 ${m?`<div class="sec"><h3>מבצע ידני</h3></div><div class="card"><p class="note" style="margin:0 0 8px">מבצע בלי בסיס במדף. כתבו את הנוסח שיוקרא.</p>${field('m','הנוסח',4)}${sendBtn('m','manual')}</div>`:''}`}}
ACT.ylPromo=el=>{const k=el.dataset.k,i=+el.dataset.i,it=SH&&SH[k]&&SH[k].items&&SH[k].items[i];if(!it){toast('המבצע לא נמצא');return}
 if(!ID.test(it.ym||'')){it.ym='pk'+rand();shTouch(k)} // promoKey קבוע לכל מבצע (כמו בחלון "שלח לקו" הקיים), כך שהקובץ בקו מוחלף ולא מתווסף
 const today=isoDay(new Date());let until=it.vf||'';if(until&&until<today)until='';
 cOpen({kind:'promo',slot:'promos',heading:'שליחת מבצע לקו',note:'המבצע יעלה לשלוחת המבצעים (2). תקנו את הנוסח אם צריך, שמעו ואשרו.'+(isA()?'':' השליחה היא בלי צינתוק.'),promo:{k,i,key:it.ym,name:String(it.n||'').slice(0,80)},it,
  text:promoText(it,until),max:lim().promo,untilReq:true,until,maxDays:lim().promoMaxDays,untilLabel:'מתי להוריד את המבצע מהקו?',retext:true,tzChoice:isA()})};
function promoText(it,until){ // נוסח אוטומטי, אותו אלגוריתם כמו yemot-promo.js (כפילות מכוונת, כי הקובץ ההוא לא נוגעים בו בשלב הזה; לאחד בשלב 6)
 const p=["מבצע בלארג'"];p.push(String(it.n||'').trim());if(it.d)p.push(String(it.d).trim());
 let o='';
 if(it.kind==='A')o=`${it.k} ב-${shN(it.tot)} שקלים`;
 else if(it.kind==='B')o=`רק ${shN(it.now)} שקלים`+(it.reg?` במקום ${shN(it.reg)}`:'');
 else if(it.p)o=`${shN(it.p)} שקלים`;
 let t=p.filter(Boolean).join('. ')+(o?'. '+o:'')+'.';
 if(until)t+=` המבצע בתוקף עד ${heDate(until)}.`;
 return t}
// שלוחה 3 – עדכונים
function vUpdates(){const rec=Y.mode3==='rec',L=lim();
 const chips=[['type','הקלדה'],['rec','הקלטה']].map(([v,t])=>`<button type="button" class="chip ${Y.mode3===v?'on':''}" role="radio" aria-checked="${Y.mode3===v}" data-a="ylMode" data-v="${v}">${t}</button>`).join('');
 return{t:'עדכונים',s:'שלוחה 3',h:`<div class="card"><p class="note" style="margin:0 0 10px">כל העדכונים נשמרים בקו, והחדש מושמע ראשון. הקלדה נשמעת בקול הממוחשב של הקו. הקלטה נשמעת בקול שלכם.</p>
 <div class="chips" role="radiogroup" style="margin-bottom:12px">${chips}</div>
 ${rec?recHtml():`${field('u','נוסח העדכון',5)}${sendBtn('u','updates')}`}</div>
 <div class="sec"><h3>העדכונים שבקו</h3></div><div id="ylList">${listHtml('updates')}</div>`}}
ACT.ylMode=el=>{if(Y.rec&&Y.rec.on)recDiscard();Y.mode3=el.dataset.v;redraw()};
function recHtml(){const R=Y.rec,L=lim();
 if(R&&R.on)return`<p style="font-weight:800;color:var(--bad);margin:0 0 8px">● מקליט… <span id="ylRecT" dir="ltr">0:00 / ${fsec(L.recordSec)}</span></p><button class="btn w" data-a="ylRecStop">עצור הקלטה</button>`;
 if(R&&R.url)return`<p class="note" style="margin:0 0 6px">ההקלטה מוכנה (${fsec(R.sec)}). אפשר להאזין לפני השליחה:</p><audio controls src="${R.url}" style="width:100%;margin-bottom:10px"></audio><div class="row"><button class="btn grow" data-a="ylRecSend">שלח לקו…</button><button class="btn g grow" data-a="ylRecStart">הקלט מחדש</button></div>`;
 return`<p class="note" style="margin:0 0 10px">עד ${fsec(L.recordSec)} דקות. בלחיצה הראשונה הטלפון ישאל אם לאפשר גישה למיקרופון.</p>${R&&R.err?`<p class="note" style="color:var(--bad);font-weight:700;margin:0 0 10px">${esc(R.err)}</p>`:''}<button class="btn w" data-a="ylRecStart">התחל הקלטה</button>`}
function recDiscard(){const R=Y.rec;if(!R)return;R.discard=true;clearInterval(R.tm);try{if(R.mr&&R.mr.state!=='inactive')R.mr.stop()}catch(e){}try{R.stream&&R.stream.getTracks().forEach(t=>t.stop())}catch(e){}if(R.url)URL.revokeObjectURL(R.url);Y.rec=null}
const micErr=e=>{const n=e&&e.name;
 if(n==='NotAllowedError'||n==='SecurityError'||n==='PermissionDeniedError')return'אין הרשאה למיקרופון. אפשרו לאפליקציה גישה למיקרופון בהגדרות הטלפון ונסו שוב.';
 if(n==='NotFoundError'||n==='DevicesNotFoundError')return'לא נמצא מיקרופון במכשיר.';
 if(n==='NotReadableError')return'המיקרופון תפוס על ידי אפליקציה אחרת.';
 return'לא הצלחנו להפעיל את המיקרופון.'};
ACT.ylRecStart=async()=>{
 if(Y.rec&&Y.rec.on)return;
 const keep=Y.rec&&Y.rec.url;if(Y.rec)recDiscard();
 const fail=m=>{Y.rec={err:m};if(here('3'))redraw()};
 if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia||typeof MediaRecorder==='undefined'||!(window.AudioContext||window.webkitAudioContext))return fail('ההקלטה לא נתמכת במכשיר הזה. אפשר להקליד את העדכון.');
 let stream;try{stream=await navigator.mediaDevices.getUserMedia({audio:true})}catch(e){return fail(micErr(e))}
 if(!here('3')||Y.mode3!=='rec'){stream.getTracks().forEach(t=>t.stop());return}
 const mime=['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg'].find(m=>MediaRecorder.isTypeSupported&&MediaRecorder.isTypeSupported(m))||'';
 let mr;try{mr=new MediaRecorder(stream,mime?{mimeType:mime}:undefined)}catch(e){stream.getTracks().forEach(t=>t.stop());return fail('ההקלטה לא נתמכת במכשיר הזה. אפשר להקליד את העדכון.')}
 const chunks=[],R=Y.rec={on:true,t0:Date.now(),mr,stream,tm:null},max=lim().recordSec;
 mr.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data)};
 mr.onstop=async()=>{clearInterval(R.tm);stream.getTracks().forEach(t=>t.stop());if(R.discard)return;R.on=false;
  try{const w=await toWav(new Blob(chunks,{type:mr.mimeType||mime||'audio/webm'}),max);
   if(w.sec<0.5)throw new Error('short');
   if(Y.rec!==R)return;R.sec=w.sec;R.b64=w.b64;R.url=URL.createObjectURL(w.blob)}
  catch(e){if(Y.rec!==R)return;Y.rec={err:e&&e.message==='short'?'ההקלטה קצרה מדי. הקליטו שוב.':'לא הצלחנו לעבד את ההקלטה. הקליטו שוב, או הקלידו את העדכון.'}}
  if(here('3'))redraw()};
 mr.start();
 R.tm=setInterval(()=>{if(cur().v!=='yl'){recDiscard();return}const s=(Date.now()-R.t0)/1000,t=document.getElementById('ylRecT');if(t)t.textContent=fsec(s)+' / '+fsec(max);if(s>=max)ACT.ylRecStop()},250);
 redraw()};
ACT.ylRecStop=()=>{const R=Y.rec;if(R&&R.on&&R.mr&&R.mr.state!=='inactive'){clearInterval(R.tm);R.mr.stop()}};
async function toWav(blob,maxSec){ // מפענח, ממיר ל-WAV PCM 16 ביט, מונו, 8000Hz (חוזה 5.7), וחותך לאורך המרבי
 const AC=window.AudioContext||window.webkitAudioContext,ac=new AC();let buf;
 try{buf=await ac.decodeAudioData(await blob.arrayBuffer())}finally{try{ac.close()}catch(e){}}
 const len=Math.max(1,Math.min(Math.ceil(buf.duration*8000),maxSec*8000)),oc=new OfflineAudioContext(1,len,8000),src=oc.createBufferSource();
 src.buffer=buf;src.connect(oc.destination);src.start();
 const f=(await oc.startRendering()).getChannelData(0),n=Math.min(len,f.length),bytes=new Uint8Array(44+n*2),dv=new DataView(bytes.buffer);
 const w=(o,s)=>{for(let i=0;i<s.length;i++)dv.setUint8(o+i,s.charCodeAt(i))};
 w(0,'RIFF');dv.setUint32(4,36+n*2,true);w(8,'WAVE');w(12,'fmt ');dv.setUint32(16,16,true);dv.setUint16(20,1,true);dv.setUint16(22,1,true);dv.setUint32(24,8000,true);dv.setUint32(28,16000,true);dv.setUint16(32,2,true);dv.setUint16(34,16,true);w(36,'data');dv.setUint32(40,n*2,true);
 for(let i=0;i<n;i++){const s=Math.max(-1,Math.min(1,f[i]));dv.setInt16(44+i*2,s<0?s*32768:s*32767,true)}
 let bin='';for(let i=0;i<bytes.length;i+=8192)bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+8192));
 return{sec:n/8000,b64:btoa(bin),blob:new Blob([bytes],{type:'audio/wav'})}}
ACT.ylRecSend=()=>{const R=Y.rec;if(!R||!R.url||!R.b64)return;
 cOpen({kind:'audio',slot:'updates',heading:'שליחת הקלטה לקו',note:'ההקלטה תעלה לשלוחת העדכונים (3) ותושמע ראשונה.',url:R.url,b64:R.b64,sec:R.sec,clear:()=>recDiscard()})};
// שלוחה 4 – שעות וכתובת (מנהל)
function vHours(){const d=getD(),tmp=!!d.ht;
 const chips=[[0,'קבועה'],[1,'זמנית, עם תאריך תפוגה']].map(([v,t])=>`<button type="button" class="chip ${!!v===tmp?'on':''}" role="radio" aria-checked="${!!v===tmp}" data-a="ylTemp" data-v="${v}">${t}</button>`).join('');
 return{t:'שעות וכתובת',s:'שלוחה 4 · מנהל',h:`<div class="card"><p class="note" style="margin:0 0 10px">כל הודעה חדשה עולה כקובץ חדש ומושמעת ראשונה. הקודמות נשארות עד שמוחקים אותן. הודעה זמנית נמחקת אוטומטית בלילה שאחרי התאריך.</p>
 <div class="chips" role="radiogroup" style="margin-bottom:12px">${chips}</div>${field('h','נוסח ההודעה',5)}${sendBtn('h','hours')}</div>
 <div class="sec"><h3>הקבצים בשלוחה 4</h3><button class="btn s g" data-a="ylReload">רענן</button></div><div id="ylList">${filesHtml()}</div>`}}
ACT.ylTemp=el=>{getD().ht=el.dataset.v==='1';save();redraw()};
ACT.ylReload=()=>{Y.files=null;const el=document.getElementById('ylList');if(el)el.innerHTML='<p class="note">טוען…</p>';ylLoad('4',true)};
function filesHtml(){const F=Y.files;if(!F)return'<p class="note">טוען…</p>';if(!F.length)return'<p class="note">אין קבצי תוכן בשלוחה.</p>';
 return F.map((x,i)=>`<div class="li" style="cursor:default;flex-wrap:wrap"><div class="m"><b dir="ltr" style="text-align:right">${esc(x.name)}</b><small>${x.legacy?'קובץ ותיק (לא הועלה מהאפליקציה)':esc((x.item&&x.item.title)||'')}${x.item&&x.item.temporary?' · זמנית עד '+esc(heDate(x.item.until)):''}${i===0?' · מושמע ראשון':''}</small></div><button class="btn s r" data-a="ylRmF" data-n="${esc(x.name)}" data-l="${x.legacy?1:0}">מחק</button></div>`).join('')}
function paintFiles(){const el=document.getElementById('ylList');if(el)el.innerHTML=filesHtml()}
ACT.ylRmF=el=>{const n=el.dataset.n,leg=el.dataset.l==='1';
 ask(leg?`למחוק את ${n}? זה הקובץ הוותיק של השלוחה, והוא לא יושמע יותר. אי אפשר לשחזר.`:`למחוק את ${n} מהשלוחה? ההודעה לא תושמע יותר, ואי אפשר לשחזר.`,
  ()=>doRemove({ext:'4',file:n},'4'),'כן, מחק')};
ACT.ylRm=el=>{const id=el.dataset.id;ask('להסיר את הפריט מהקו? הוא לא יושמע יותר, ואי אפשר לשחזר.',()=>doRemove({id},here('1')?'1':'3'),'כן, הסר')};
async function doRemove(p,a){
 if(Y.sending)return;Y.sending=true;
 try{const r=await call('removeLineItem',Object.assign({requestId:'yr'+rand()},p),75000);
  toast(r&&he(r.message)?r.message:'✓ הוסר מהקו');Y.st=null;Y.files=null;
  if(here(a)){const el=document.getElementById('ylList');if(el)el.innerHTML='<p class="note">טוען…</p>';ylLoad(a,true)}}
 catch(e){toast(errMsg(e))}finally{Y.sending=false}}
// הודעת פתיחה (מנהל)
function vOpen(){return{t:'הודעת פתיחה',s:'מנהל',h:`<div class="card"><p class="note" style="margin:0 0 6px" id="ylOpenNote">טוען את הנוסח הנוכחי…</p>
 <p class="note" style="margin:0 0 10px;color:var(--warn);font-weight:700">זו ההודעה שנשמעת בכניסה לקו. כתבו אותה במלואה, כולל הוראות התפריט (איזה מקש לאיזו שלוחה).</p>
 ${field('o','נוסח הפתיחה',7)}${sendBtn('o','opening','החלף את הפתיחה…')}</div><div id="ylList"></div>`}}
// מילון הגייה (מנהל)
function vLex(){return{t:'מילון הגייה',s:'מנהל',h:`<div class="card"><p class="note" style="margin:0 0 10px">כל שורה: <b dir="ltr">מילה=הגייה</b>. שורה שמתחילה ב-# היא הערה. למשל: <span dir="ltr">במבה=במבָּה</span>. המילון חל על כל מה שנשלח לקו, וגם על "שמע קודם".</p>
 ${field('x','המילון',10)}<p class="note" id="ylLexInfo" style="margin:0 0 10px"></p>
 <button class="btn w" data-a="ylLexSave">שמור מילון</button><div id="ylList"></div></div>
 <div class="card"><b>בדיקת הגייה</b><p class="note" style="margin:4px 0 8px">ההשמעה משתמשת במילון השמור. הקול בטלפון הוא קירוב בלבד.</p>
 <textarea id="ylTest" rows="2" placeholder="כתבו כאן מילה או משפט"></textarea><div style="margin-top:8px">${window.ypButton?ypButton('ylTest'):''}</div></div>`}}
function lexInfo(){const el=document.getElementById('ylLexInfo'),v=String(getD().x==null?'':getD().x);if(!el)return;
 let ok=0,bad=0;v.split(/\r?\n/).forEach(r=>{r=r.trim();if(!r||r[0]==='#')return;const i=r.indexOf('='),a=i<0?'':r.slice(0,i).trim(),b=i<0?'':r.slice(i+1).trim();if(a&&b&&a.length<=40&&b.length<=40)ok++;else bad++});
 el.textContent=`${ok} ערכים תקינים`+(bad?` · ${bad} שורות לא תקינות (ידולגו; כל צד עד 40 תווים)`:'');el.style.color=bad?'var(--warn)':''}
ACT.ylLexSave=async()=>{
 if(!isA()){toast(LEX_DENY);return}
 if(Y.sending)return;const d=getD(),bx=box('x'),text=String(bx?bx.value:d.x==null?(Y.st&&Y.st.r&&Y.st.r.lexicon)||'':d.x);
 if(text.length>lim().lex){toast(`המילון ארוך מדי (עד ${lim().lex} תווים)`);return}
 Y.sending=true;const b=document.querySelector('[data-a=ylLexSave]');if(b)b.disabled=true;
 try{await fsx('/yemot_lexicon/main',{method:'PATCH',body:JSON.stringify({fields:{text:{stringValue:text},updatedAt:{integerValue:String(Date.now())},updatedBy:{stringValue:String(SY.uid||'')}}})});
  if(window.ypLexicon)window.ypLexicon(text);if(Y.st&&Y.st.r)Y.st.r.lexicon=text;d.x=null;save();toast('✓ המילון נשמר. הוא חל על כל מה שיישלח מעכשיו.')}
 catch(e){toast(e&&e.offline?'אין חיבור לאינטרנט. בדקו ונסו שוב.':e&&e.code===403?(isA()?'השמירה נדחתה. בדקו שהשעה בטלפון נכונה ושהחשבון הוא של מנהל.':LEX_DENY):'שמירת המילון נכשלה. נסו שוב מאוחר יותר.')}
 finally{Y.sending=false;if(b)b.disabled=false}};
// ---------- חלון אישור (לכל שליחה) ----------
const LABELS={recipes:['שליחת מתכון לקו','המתכון יעלה לשלוחה 1 ויושמע ראשון.'],updates:['שליחת עדכון לקו','העדכון יעלה לשלוחה 3 ויושמע ראשון.'],opening:['החלפת הודעת הפתיחה','ההודעה תחליף את הפתיחה של הקו. כל מי שיתקשר ישמע אותה.']};
const FIELD={recipes:'r',updates:'u',hours:'h',opening:'o',manual:'m'};
ACT.ylSend=el=>{const s=el.dataset.s,f=FIELD[s],d=getD(),bx=box(f),text=String(bx?bx.value:d[f]||''),L=lim();
 if(s==='manual'){cOpen({kind:'promo',slot:'promos',manual:true,heading:'שליחת מבצע ידני לקו',note:'מבצע בלי בסיס במדף. יעלה לשלוחת המבצעים (2).',text,field:'m',max:L.promo,untilReq:true,until:d.mu||'',maxDays:L.promoMaxDays,untilLabel:'מתי להוריד את המבצע מהקו?',tzChoice:true,key:'man_'+(d.mk=d.mk||rand()),clear:()=>{d.m='';d.mu='';d.mk=null;save()}});return}
 if(s==='hours'){const tmp=!!d.ht;
  cOpen({kind:'item',slot:'hours',heading:'שליחת הודעה לשלוחה 4',note:tmp?'ההודעה תושמע עד התאריך שתבחרו (כולל), ותימחק אוטומטית בלילה שאחריו.':'ההודעה תעלה כקובץ חדש ותושמע ראשונה. ההודעות הקודמות נשארות עד שתמחקו אותן.',text,field:'h',max:L.hours,source:'typed',untilReq:tmp,until:d.hu||'',maxDays:L.tempMaxDays,untilLabel:'עד איזה תאריך להשמיע (כולל)?',untilField:'hu',clear:()=>{d.h='';save()}});return}
 const lb=LABELS[s];
 cOpen({kind:'item',slot:s,heading:lb[0],note:lb[1],text,field:f,max:L[s],source:s==='recipes'?(d.rs==='scan'?'scan':'typed'):'typed',clear:()=>{if(s==='opening')d.o=null;else d[f]='';if(s==='recipes')d.rs='typed';save()}})};
function cBad(c){
 if(c.kind==='audio')return c.b64?'':'אין הקלטה';
 const t=c.text.trim();if(!t)return'הנוסח ריק';if(t.length>c.max)return`הנוסח ארוך מדי (עד ${c.max} תווים)`;
 if(c.untilReq){const today=isoDay(new Date());
  if(!/^\d{4}-\d{2}-\d{2}$/.test(c.until||''))return'יש לבחור תאריך';if(c.until<today)return'התאריך כבר עבר';if(c.until>addDays(today,c.maxDays))return`אפשר עד ${c.maxDays} ימים קדימה`}
 return''}
function cOpen(c){
 c=Y.c=Object.assign({busy:false,rid:null,sig:null,withTz:false,edited:false},c);const today=isoDay(new Date());
 const body=c.kind==='audio'?`<p class="note" style="margin:0 0 8px">כך תישמע ההקלטה בקו (${fsec(c.sec)}):</p><audio controls src="${c.url}" style="width:100%;margin-bottom:12px"></audio>`
  :`<label class="f"><span>הנוסח שיוקרא בקו</span><textarea id="ylCTxt" rows="6" dir="auto" data-i="ylctxt">${esc(c.text)}</textarea><span class="note" dir="ltr" id="ylCCnt" style="text-align:left;margin:4px 0 0"></span></label>${window.ypButton?`<div style="margin:0 0 12px">${ypButton('ylCTxt')}</div>`:''}`;
 const until=c.untilReq?`<label class="f"><span>${esc(c.untilLabel)}</span><input id="ylCDate" type="date" value="${esc(c.until||'')}" min="${today}" max="${addDays(today,c.maxDays)}" data-i="yldate"></label><div class="chips" style="margin:0 0 12px">${[7,14,30].filter(n=>n<=c.maxDays).map(n=>`<button type="button" class="chip" data-a="ylDays" data-v="${n}">${n} ימים</button>`).join('')}</div>`:'';
 dlg(`<h3>${esc(c.heading)}</h3><form data-f="ylform" onsubmit="return false"><p class="note" style="margin:0 0 12px">${esc(c.note)}</p>${body}${until}
 ${c.tzChoice?'<p class="note" style="margin:0 0 8px">בלי צינתוק: רק העלאה לקו. עם צינתוק: גם צינתוק לנרשמים (עולה יחידות).</p>':''}
 <p id="ylCWhy" class="note" style="color:var(--bad);font-weight:700;margin:6px 0"></p>
 <div class="row"><button type="button" class="btn grow" data-a="ylCOk" data-tz="0">אשר ושלח</button><button type="button" class="btn g grow" data-a="ylCCancel">ביטול</button></div>
 ${c.tzChoice?'<div class="row" style="margin-top:8px"><button type="button" class="btn g grow" data-a="ylCOk" data-tz="1">אשר, שלח וצנתק</button></div>':''}</form>`);
 const d=document.getElementById('dlg');
 d.addEventListener('cancel',e=>{if(Y.c&&Y.c.busy)e.preventDefault()},{once:true});
 d.addEventListener('close',()=>{if(Y.c&&!Y.c.busy)Y.c=null},{once:true});
 cDraw()}
function cDraw(){const c=Y.c,d=document.getElementById('dlg');if(!c||!d)return;
 const bad=c.busy?'':cBad(c),ok=d.querySelectorAll('[data-a=ylCOk]'),cn=d.querySelector('[data-a=ylCCancel]'),w=d.querySelector('#ylCWhy'),n=d.querySelector('#ylCCnt');
 ok.forEach(b=>{b.disabled=!!bad||c.busy;if(b.dataset.tz==='0')b.textContent=c.busy?'שולח…':'אשר ושלח'});
 if(cn)cn.disabled=c.busy;if(w){w.textContent=c.busy?'':bad;w.style.display=bad?'':'none'}
 if(n)n.textContent=c.text.length+' / '+c.max}
INP.ylctxt=el=>{const c=Y.c;if(!c)return;c.text=el.value;c.edited=true;if(c.field){getD()[c.field]=el.value;save()}cDraw()};
INP.yldate=el=>{const c=Y.c;if(!c)return;c.until=el.value;if(c.untilField){getD()[c.untilField]=el.value;save()}if(c.manual){getD().mu=el.value;save()}cRetext();cDraw()};
function cRetext(){const c=Y.c;if(c&&c.retext&&!c.edited&&c.it){c.text=promoText(c.it,c.until);const t=document.getElementById('ylCTxt');if(t)t.value=c.text}}
ACT.ylDays=el=>{const c=Y.c;if(!c||c.busy)return;c.until=addDays(isoDay(new Date()),+el.dataset.v);const i=document.getElementById('ylCDate');if(i)i.value=c.until;
 if(c.untilField){getD()[c.untilField]=c.until;save()}if(c.manual){getD().mu=c.until;save()}cRetext();cDraw()};
ACT.ylCCancel=()=>{if(Y.c&&Y.c.busy)return;Y.c=null;try{window.ypStop&&ypStop()}catch(e){}closeDlg()};
function cReq(c){ // אותו תוכן = אותו requestId בניסיון חוזר (השרת לא מעלה פעמיים); תוכן אחר = חדש
 const sig=JSON.stringify([c.kind,c.slot,c.text,c.until,c.withTz,c.b64?c.b64.length:0]);
 if(!c.rid||c.sig!==sig){c.rid='yl'+rand();c.sig=sig}
 const text=String(c.text||'').trim();
 if(c.kind==='audio')return['publishLineItem',{requestId:c.rid,slot:'updates',audio:{mimeType:'audio/wav',data:c.b64},source:'recording'}];
 if(c.kind==='promo'){const p={requestId:c.rid,promoKey:c.manual?c.key:c.promo.key,text,until:c.until,withTzintuk:c.withTz===true,origin:'builder'};
  if(c.manual)p.manual=true;else p.source={size:c.promo.k,index:c.promo.i,name:c.promo.name};return['sendPromoToLine',p]}
 const p={requestId:c.rid,slot:c.slot,text,source:c.source};if(c.untilReq&&c.slot==='hours')p.until=c.until;return['publishLineItem',p]}
ACT.ylCOk=async el=>{
 const c=Y.c;if(!c||c.busy||Y.sending||cBad(c))return; // נעילה סינכרונית: לחיצה כפולה לא עוברת
 c.busy=true;Y.sending=true;c.withTz=el.dataset.tz==='1'&&isA();cDraw();
 try{const [fn,p]=cReq(c),res=await call(fn,p,75000);
  Y.c=null;try{window.ypStop&&ypStop()}catch(e){}closeDlg();
  let m=c.kind==='promo'?(res&&he(res.message)?res.message:res&&res.duplicate?'המבצע הזה כבר נשלח.':c.withTz&&res&&res.tzintuk==='failed'?'ההודעה עלתה לקו, אבל הצינתוק לא נשלח.':c.withTz?'✓ המבצע נשלח לקו, ונשלח צינתוק לנרשמים.':'✓ המבצע הועלה לקו, בלי צינתוק.')
   :(res&&he(res.message)?res.message:'✓ עלה לקו');
  if(res&&res.warnings&&res.warnings.includes('yemot-remove-failed'))m+=' (הסרת הקודם נכשלה)';
  if(c.clear)c.clear();Y.st=null;Y.files=null;toast(m);
  if(cur().v==='yl')redraw()}
 catch(e){c.busy=false;const w=document.getElementById('ylCWhy'),m=errMsg(e);cDraw();if(w){w.textContent=m;w.style.display=''}toast(m)}
 finally{Y.sending=false}};
})();
