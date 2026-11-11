/* SEC:1 – המזכירה העסקית, שלב 1 ("שלד ותוספת"). קובץ עצמאי, נטען אחרי index.html (כמו orders-staff.js).
   מה יש כאן: כפתור צף (רק למנהל שאישר, רק כשהתוספת פעילה), כרטיס בבית, מסך המזכירה (V.sec): מסך הסכמה בהפעלה הראשונה,
   אשף קצר (1. שם המזכירה, 2. אופן פנייה), "בקרוב" + יומן פעולות; ובכרטיס העסק של מנהל־על (V.sab): מצב מנהלים, תקרה,
   מתג שכר לכל מנהל, ניתוח עובדים ומידע רגיש, מצב ההסכמה, וצפייה בשיחה (נרשמת ביומן).
   כל כתיבה – רק דרך פונקציות השרת (functions/secretary.js). כל ההרשאות נאכפות בשרת ובחוקים; כאן רק מה מוצג למי.
   תוספת כבויה = הקובץ לא מוסיף דבר לשום מסך (כמו orders-lines.js). רכיבי העיצוב הקיימים בלבד (.card .btn .chip .f .sec .note .empty .li),
   צבעים רק ממשתני הערכה (--acc, --card, --line, --ink). משתמש ב: V, ACT, FRM, fsx, fnCall, fvj, esc, dlg, closeDlg, ask, toast, go, cur,
   rerender, render, isA, isW, bzF, SY, ADM, BZ0, fd. */
(function(){
'use strict';
if(typeof ACT==='undefined'||typeof V==='undefined')return;
const fnCall=(n,d)=>{d=d&&typeof d==='object'?d:{};if(SY&&SY.sa&&SY.bizId&&!('bizId'in d))d=Object.assign({bizId:SY.bizId},d);return window.fnCall(n,d)};
const err=e=>toast(e&&e.message||'הפעולה נכשלה');
const X={st:null,key:'',busy:0,at:0,wz:0,edit:0,log:null,logAt:0};
/* התוספת פעילה בעסק הנוכחי (כמו cellular: גם בעסק הישן – רק כשמנהל־העל הפעיל במפורש) */
const featOn=()=>{try{const b=SY&&SY.biz;return !!(b&&b.features&&b.features.secretary===true)&&bzF('secretary')}catch(e){return false}};
const elig=()=>featOn()&&!isW()&&(isA()||!!(SY&&SY.sa));
const keyNow=()=>(SY&&SY.bizId||'')+'|'+(SY&&SY.uid||'');
const ok=()=>!!(X.st&&X.st.ok);
const ready=()=>ok()&&X.st.consented;

async function load(force){
 if(!elig()){X.st=null;fabSync();return}
 const k=keyNow();if(k!==X.key){X.key=k;X.st=null;X.log=null;X.wz=0;X.edit=0}
 if(X.busy||(!force&&X.st&&Date.now()-X.at<60000))return;
 X.busy=1;
 try{X.st=await fnCall('secState',{})}
 catch(e){X.st={ok:false,reason:e&&e.reason||'',msg:e&&e.message||''}}
 finally{X.busy=0;X.at=Date.now();fabSync();const v=cur().v;if((v==='sec'||v==='home')&&!typing())rerender()}
}
const typing=()=>{const a=document.activeElement;return !!(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)&&a.closest('#main'))};

/* ---------- עיצוב: כפתור צף בלבד (כל השאר ברכיבים הקיימים) ----------
   פינה שמאלית (בעברית – הצד שלא מסתיר את כפתור ה-＋ שבמרכז הסרגל), מעל הסרגל התחתון. מוסתר כשהמקלדת פתוחה (שדה בפוקוס),
   כשסרגל הבחירה המרובה פתוח, במסך הסריקה האחידה, בעסק מושהה ובהדפסה. ריווח תחתון נוסף לתוכן, כדי שאפשר יהיה לגלול אותו אל מעל הכפתור. */
const css=document.createElement('style');
css.textContent='.secfab{position:fixed;left:max(12px,env(safe-area-inset-left));bottom:calc(84px + env(safe-area-inset-bottom));z-index:29;width:52px;height:52px;border-radius:50%;border:1.5px solid var(--acc);background:var(--card);color:var(--acc);box-shadow:0 8px 20px -8px rgba(0,0,0,.55);display:grid;place-items:center;cursor:pointer;padding:0}'
+'.secfab svg{width:26px;height:26px}.secfab:active{transform:scale(.94)}.secfab:focus-visible{outline:3px solid var(--acc);outline-offset:3px}'
+'body.secfab-on main{padding-bottom:76px}'
+'body:has(.msbar) .secfab,body:has(#main :is(input,textarea,select):focus) .secfab,body:has(.sheet:not([hidden])) .secfab,body.us-on .secfab,body.susp .secfab{display:none}'
+'@media(min-width:901px){.secfab{left:max(12px,calc((100vw - 980px)/2 + 12px))}}@media print{.secfab{display:none}}@media(prefers-reduced-motion:reduce){.secfab:active{transform:none}}'
+'.secav{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;border:1.5px solid var(--acc);color:var(--acc);flex:none}.secav svg{width:24px;height:24px}'
+'.secterms{margin:8px 0 0;padding-inline-start:20px}.secterms li{margin:0 0 8px;line-height:1.5}';
document.head.appendChild(css);
const SVG='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4h0A1.5 1.5 0 0 1 4 14.5z"/><path d="M8.5 8.5h7M8.5 11.5h4.5"/></svg>';

function fabSync(){
 let b=document.getElementById('secfab');
 const show=elig()&&ready();
 document.body.classList.toggle('secfab-on',!!show);
 if(!show){if(b)b.remove();return}
 if(!b){b=document.createElement('button');b.id='secfab';b.type='button';b.className='secfab';b.dataset.a='secOpen';b.innerHTML=SVG;document.body.appendChild(b)}
 const nm=X.st.name||'המזכירה';b.setAttribute('aria-label',nm);b.title=nm;
}
window.secFabSync=fabSync;
ACT.secOpen=()=>{if(cur().v!=='sec')go('sec')};

/* כל ציור מסך: מסנכרנים את הכפתור (עסק אחר / התוספת כובתה / התנתקות) – בלי קריאה לשרת אם אין צורך */
{const r0=window.render;if(typeof r0==='function')window.render=function(){const r=r0.apply(this,arguments);try{if(keyNow()!==X.key||(!elig()&&X.st))load();else fabSync()}catch(e){}return r}}

/* ---------- כרטיס בבית (11): מתמלא בהדרגה. בשלב 1 – אין שורות של שלבים עתידיים; רק כניסה למזכירה ---------- */
{const h=V.home;if(h)V.home=()=>{const r=h();try{if(!elig()||!r||!r.h)return r;if(!X.st||keyNow()!==X.key){load();return r}if(!ok())return r;
 const S=X.st,rows=(S.rows||[]).map(x=>`<div class="note" style="margin-top:4px">${esc(x.t||'')}</div>`).join('');
 const sub=!S.consented?'לפני שמתחילים – אישור תנאי השימוש':!S.setupDone?'הגדרה ראשונה: שם ואופן פנייה':'השיחה עם המזכירה – בקרוב';
 const card=`<button type="button" class="card" id="secHome" data-a="secOpen" style="display:flex;gap:12px;align-items:center;width:100%;text-align:right;cursor:pointer;margin-top:12px;min-height:56px;color:var(--ink)"><span class="secav">${SVG}</span><span style="flex:1;min-width:0"><b>${esc(S.name||'המזכירה העסקית')}</b><small class="note" style="display:block">${esc(sub)}</small>${rows}</span></button>`;
 if(/<div class="chips hacts"/.test(r.h))r.h=r.h.replace(/(<div class="chips hacts")/,card+'$1');else r.h+=card}catch(e){}return r}}

/* ---------- מסך המזכירה ---------- */
const DENY={'not-main-manager':'בעסק הזה המזכירה זמינה רק למנהל הראשי.','not-biz-admin':'המזכירה זמינה למנהלי העסק בלבד.','not-manager':'המזכירה זמינה למנהלי העסק בלבד.','feature-off':'המזכירה לא מופעלת בעסק הזה.','biz-suspended':'החשבון מושהה – פנה לספק.'};
const ACTS={consent:'אישור תנאי השימוש',setup:'הגדרת שם ואופן פנייה',cfg:'מנהל המערכת עדכן הגדרות',readChat:'מנהל המערכת צפה בשיחה'};
const tm=t=>{if(!t)return '';const d=new Date(t);return d.toLocaleDateString('he-IL',{day:'numeric',month:'numeric',year:'2-digit'})+' '+d.toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'})};
V.sec=()=>{const T='המזכירה';
 if(!elig())return{t:T,h:'<div class="empty">המזכירה לא מופעלת בעסק הזה</div>'};
 if(!X.st||keyNow()!==X.key){load();return{t:T,h:'<div class="empty">טוען…</div>'}}
 const S=X.st;
 if(!S.ok)return{t:T,h:`<div class="card"><p class="note" style="margin:0">${esc(DENY[S.reason]||S.msg||'לא ניתן לפתוח את המזכירה כרגע.')}</p>${DENY[S.reason]?'':'<button class="btn g w" data-a="secRe" style="margin-top:10px">נסה שוב</button>'}</div>`};
 if(!S.consented)return{t:T,h:consentH(S)};
 if(!S.setupDone||X.edit)return{t:S.name||T,h:wizH(S)};
 if(!X.log||Date.now()-X.logAt>60000)logLoad();
 const hi=S.call?`שלום ${esc(S.call)}, `:'';
 return{t:S.name||T,s:'המזכירה העסקית',h:`<div class="card" style="display:flex;gap:12px;align-items:flex-start"><span class="secav">${SVG}</span><div style="flex:1;min-width:0"><b>${hi}אני ${esc(S.name)}.</b><p class="note" style="margin:6px 0 0">השיחה איתי תיפתח כאן בקרוב. בינתיים אפשר לעדכן את השם ואת אופן הפנייה.</p></div></div>
 <button class="btn g w" data-a="secEdit" style="margin-top:10px">שינוי שם ואופן פנייה</button>
 <div class="sec"><h3>יומן פעולות</h3></div>${logH()}`}};
ACT.secRe=()=>{X.st=null;load(true);rerender()};
ACT.secEdit=()=>{X.edit=1;X.wz=1;rerender()};

function consentH(S){const c=S.consent||{};
 return `<form class="card" data-f="secConsF"><h3 style="margin-top:0">${esc(c.title||'תנאי שימוש')}</h3><ul class="secterms">${(c.items||[]).map(t=>`<li>${esc(t)}</li>`).join('')}</ul>
 <label class="chip" style="min-height:44px;margin-top:6px;width:100%;justify-content:flex-start"><input type="checkbox" name="ok" value="1"> ${esc(c.ok||'קראתי ואני מסכים/ה')}</label>
 <input type="hidden" name="ver" value="${esc(c.ver||'')}"><button class="btn w" style="margin-top:10px">אישור והמשך</button>
 <p class="note" style="margin:8px 0 0">בלי אישור אי אפשר להשתמש במזכירה. האישור נשמר עם התאריך ומזהה הנוסח.</p></form>`}
FRM.secConsF=async f=>{const x=fd(f),b=f.querySelector('button');if(x.ok!=='1')return toast('צריך לסמן אישור');b.disabled=true;
 try{await fnCall('secConsent',{ver:x.ver,ok:true});X.wz=1;await load(true);toast('נשמר. תודה!')}catch(e){b.disabled=false;err(e);if(e&&e.reason==='bad-consent-ver')load(true)}};

function wizH(S){const st=X.wz===2?2:1;X.wz=st;const nm=X.nm!=null?X.nm:(S.name||''),ad=X.ad||S.addr||'',call=X.call!=null?X.call:(S.call||'');
 const steps=`<p class="note" style="margin:0 0 8px">שלב ${st} מתוך 2</p>`;
 if(st===1)return `<form class="card" data-f="secWz1">${steps}<h3 style="margin-top:0">איך לקרוא למזכירה?</h3><label class="f"><span>שם המזכירה</span><input name="name" maxlength="30" autocomplete="off" value="${esc(nm)}" placeholder="למשל: רותי"></label><div class="row" style="margin-top:10px"><button class="btn grow">המשך</button>${X.edit?'<button type="button" class="btn g grow" data-a="secWzX">ביטול</button>':''}</div></form>`;
 return `<form class="card" data-f="secWz2">${steps}<h3 style="margin-top:0">איך ${esc(nm||'המזכירה')} תפנה אליך?</h3>
 <div class="chips" role="radiogroup" aria-label="לשון פנייה"><label class="chip" style="min-height:44px"><input type="radio" name="addr" value="m"${ad==='m'?' checked':''}> בלשון זכר</label><label class="chip" style="min-height:44px"><input type="radio" name="addr" value="f"${ad==='f'?' checked':''}> בלשון נקבה</label></div>
 <label class="f" style="margin-top:8px"><span>שם לפנייה (לא חובה)</span><input name="call" maxlength="30" autocomplete="off" value="${esc(call)}" placeholder="למשל: נתי"></label>
 <div class="row" style="margin-top:10px"><button class="btn grow">סיום</button><button type="button" class="btn g grow" data-a="secWzB">חזרה</button></div></form>`}
FRM.secWz1=f=>{const v=String(fd(f).name||'').replace(/\s+/g,' ').trim();if(!v||v.length>30)return toast('שם עד 30 תווים');X.nm=v;X.wz=2;rerender()};
ACT.secWzB=()=>{const f=document.querySelector('form[data-f=secWz2]');if(f){const x=fd(f);if(x.addr)X.ad=x.addr;X.call=x.call||''}X.wz=1;rerender()};
ACT.secWzX=()=>{X.edit=0;X.wz=0;X.nm=X.ad=X.call=null;rerender()};
FRM.secWz2=async f=>{const x=fd(f),b=f.querySelector('button');if(!['m','f'].includes(x.addr))return toast('בחרו אופן פנייה');b.disabled=true;
 try{await fnCall('secSetup',{name:X.nm!=null?X.nm:X.st.name,addr:x.addr,call:String(x.call||'').trim()});X.edit=0;X.wz=0;X.nm=X.ad=X.call=null;await load(true);toast('נשמר')}catch(e){b.disabled=false;err(e)}};

/* יומן פעולות (10.7): הוספה בלבד, נכתב רק בשרת. כאן – 20 האחרונות, כולל צפיות של מנהל המערכת בשיחות */
async function logLoad(){X.logAt=Date.now();try{const sq={from:[{collectionId:'sec_log'}],orderBy:[{field:{fieldPath:'t'},direction:'DESCENDING'}],limit:20};
 const r=await fsx(':runQuery',{method:'POST',body:JSON.stringify({structuredQuery:sq})});
 X.log=(r||[]).filter(x=>x.document).map(x=>Object.fromEntries(Object.entries(x.document.fields||{}).map(([k,v])=>[k,fvj(v)])))}catch(e){X.log=X.log||[];X.logErr=1}
 if(cur().v==='sec'&&!typing())rerender()}
function logH(){if(!X.log)return '<div class="empty">טוען…</div>';if(!X.log.length)return `<div class="empty">${X.logErr?'היומן לא נטען':'אין עדיין פעולות'}</div>`;
 return '<div class="card">'+X.log.map(l=>{const me=l.tgt&&l.tgt===SY.uid;const a=(ACTS[l.act]||l.act||'')+(l.act==='readChat'?(me?' (השיחה שלך)':' (של מנהל אחר)'):'');
  return `<div class="li" style="cursor:default"><div class="m"><b>${esc(a)}</b><small>${esc(tm(l.t))}</small></div></div>`}).join('')+'</div>'}

/* ---------- מנהל־על: בכרטיס העסק ---------- */
const SA={};
const saLoad=id=>{SA[id]=null;fnCall('secAdminGet',{bizId:id}).then(r=>{SA[id]=r}).catch(e=>{SA[id]={err:e&&e.message||'שגיאה'}}).finally(()=>{if(cur().v==='sab')rerender()})};
{const s=V.sab;if(s)V.sab=id=>{const r=s(id);try{const b=(ADM.L||[]).find(x=>x.id===id);if(!SY.sa||!b||(b.missing&&id!==BZ0)||!r||!r.h)return r;
 if(SA[id]===undefined)saLoad(id);const c=SA[id];
 const on=!!(b.features&&b.features.secretary===true);
 let h=`<div class="sec"><h3>המזכירה העסקית</h3></div>`;
 if(!c){r.h+=h+'<div class="empty">טוען…</div>';return r}
 if(c.err){r.h+=h+`<div class="card"><p class="note">${esc(c.err)}</p><button class="btn g w" data-a="secSaRe" data-id="${esc(id)}">נסה שוב</button></div>`;return r}
 const A=c.admins||[],dollars=c.capCents==null?'':String(Math.round(c.capCents/100));
 const nm=a=>esc(a.email||a.uid);
 h+=`<form class="card" data-f="secSaF" data-id="${esc(id)}"><p class="note" style="margin-top:0">${on?'התוספת פעילה בעסק.':'התוספת כבויה בעסק. אפשר להכין את ההגדרות, ולהפעיל במתג "המזכירה העסקית" ברשימת התוספות.'}</p>
 <b>1. מי משתמש במזכירה</b><div class="chips" role="radiogroup" style="margin:6px 0"><label class="chip" style="min-height:44px"><input type="radio" name="mode" value="all"${c.mode!=='main'?' checked':''}> כל המנהלים</label><label class="chip" style="min-height:44px"><input type="radio" name="mode" value="main"${c.mode==='main'?' checked':''}> מנהל ראשי בלבד</label></div>
 <label class="f"><span>המנהל הראשי</span><select name="mainUid"><option value="">לא נבחר</option>${A.map(a=>`<option value="${esc(a.uid)}"${c.mainUid===a.uid?' selected':''}>${nm(a)}</option>`).join('')}</select></label>
 <b style="display:block;margin-top:10px">2. תקרת עלות חודשית</b><label class="f"><span>דולרים בחודש (מספר שלם; מנהל העסק רואה רק אחוז ניצול)</span><input name="cap" inputmode="numeric" dir="ltr" maxlength="5" value="${esc(dollars)}" placeholder="לא נקבעה"></label>
 <b style="display:block;margin-top:10px">3. שאלות שכר – לכל מנהל</b>${A.length?A.map(a=>`<label class="chip" style="min-height:44px;margin:4px 0;width:100%;justify-content:flex-start"><input type="checkbox" name="pay_${esc(a.uid)}" value="1"${c.pay&&c.pay[a.uid]?' checked':''}> ${nm(a)}</label>`).join(''):'<p class="note">אין מנהלים בעסק</p>'}
 <b style="display:block;margin-top:10px">4. ניתוח עובדים ומידע רגיש</b><label class="chip" style="min-height:44px;margin:4px 0;width:100%;justify-content:flex-start"><input type="checkbox" name="emp" value="1"${c.emp?' checked':''}> פעיל</label>
 <p class="note" style="margin:0">${c.empDefault?'עסק הפיילוט: פעיל כברירת מחדל (החלטה פ4).':'בעסק של לקוח – להפעיל רק אחרי חוות דעת עורך דין.'}</p>
 <button class="btn w" style="margin-top:10px">שמירה</button></form>`;
 h+=`<div class="card" style="margin-top:8px"><b>מנהלים ותנאי השימוש</b>${A.map(a=>{const k=c.consent&&c.consent[a.uid];return `<div class="li" style="cursor:default"><div class="m"><b>${nm(a)}</b><small>${k?(k.cur?'אישר/ה ב-'+esc(tm(k.at)):'אישר/ה נוסח קודם'):'עוד לא אישר/ה'}</small></div>${on?`<button class="chip" data-a="secSaChat" data-id="${esc(id)}" data-u="${esc(a.uid)}" style="min-height:44px">צפייה בשיחה</button>`:''}</div>`}).join('')||'<p class="note">אין מנהלים</p>'}
 <p class="note" style="margin:6px 0 0">כל צפייה בשיחה נרשמת ביומן הפעולות, ומנהל העסק רואה אותה.</p></div>`;
 r.h+=h}catch(e){}return r}}
ACT.secSaRe=el=>{saLoad(el.dataset.id);rerender()};
FRM.secSaF=async f=>{const id=f.dataset.id,c=SA[id];if(!c||c.err)return;const x=fd(f),b=f.querySelector('button');
 const cap=String(x.cap||'').trim();if(cap&&(!/^\d{1,5}$/.test(cap)))return toast('תקרה: מספר שלם של דולרים');
 if(x.mode==='main'&&!x.mainUid)return toast('בחרו מנהל ראשי');
 const pay={};for(const a of c.admins||[])pay[a.uid]=x['pay_'+a.uid]==='1';
 const data={bizId:id,mode:x.mode==='main'?'main':'all',mainUid:x.mainUid||'',emp:x.emp==='1'};if(Object.keys(pay).length)data.pay=pay;if(cap)data.capCents=+cap*100;
 b.disabled=true;try{const r=await window.fnCall('secAdminSetCfg',data);SA[id]=r;toast('נשמר')}catch(e){err(e)}finally{b.disabled=false;if(cur().v==='sab')rerender()}};
ACT.secSaChat=el=>{const id=el.dataset.id,u=el.dataset.u;ask('לצפות בשיחה? הצפייה תירשם ביומן הפעולות, ומנהל העסק יראה אותה.',async()=>{
 try{const r=await window.fnCall('secAdminReadChat',{bizId:id,uid:u});const L=r&&r.msgs||[];
  dlg(`<h3>שיחה (קריאה בלבד)</h3>${L.length?L.map(m=>`<div class="card" style="margin:6px 0;${m.role==='a'?'border-color:var(--acc)':''}"><small class="note">${m.role==='a'?'המזכירה':'המנהל'} · ${esc(tm(m.t))}</small><div style="white-space:pre-wrap">${esc(m.text)}</div></div>`).join(''):'<p class="note">אין הודעות בשיחה</p>'}<button class="btn g w" data-a="closeDlg">סגירה</button>`)}catch(e){err(e)}},'כן, לצפות')};

window.__sec=X;
})();
