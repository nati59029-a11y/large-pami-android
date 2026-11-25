/* רובוט כספית – כרטיס "רובוט – מחשב החנות" במסך "סנכרון כספית" (שלב B, 18.11.2026). מנהל בלבד (השרת אוכף: functions/caspit-bot.js).
   חיבור מחשב (קוד שמוצג פעם אחת + העתקה), ניתוק, מצב (סנכרון אחרון ואיך התחיל, 14 הריצות האחרונות, תקלות בעברית פשוטה),
   כמה פריטים חדשים מותר לרובוט לטעון לכספית בכל ריצה (newMax), הורדת התוסף והוראות התקנה, ודוח היכרות (מנהל־על בלבד).
   עדכון אוטומטי (19.11, תוסף 0.1.7): שורת מצב לפי i.dev.upd (תקין / נכשל / הורד וממתין לטעינה / לא מותקן).
   "עדכון המחשב" (19.11, תוסף 0.1.10): חלון עם הגרסה המותקנת, מתי המחשב בדק עדכון ומצב (i.dev.upd), ובקשה לתוסף (cxBotTok op:'upd', i.ureq)
   לבדוק אם בדיסק יש גרסה חדשה ולהיטען מחדש אם בטוח. מכירות היום: שורת "עודכנו עד HH:MM" (i.tp).
   0.1.12: בריצה שנכשלה בהעלאה לכספית – "פירוט מסך הייבוא" מקופל (r.scr: כותרות, טבלאות ומספר שורות, כפתורים, שדה הקובץ, חלון קופץ).
   "סנכרן עכשיו" (18.11): בקשה למחשב החנות (cxBotTok op:'now'); התוסף 0.1.5 בודק כל דקה. בזמן המתנה / ריצה – רענון כל 20 שניות, רק כשהמסך פתוח וגלוי.
   לקוחות הקפה מכספית (24.11, סבב 2): כרטיס נפרד מתחת לכרטיס הרובוט (hkCardH) לפי hkGet – אין תמונה / ממתין לאישור (תצוגה מקדימה + "אשר ייבוא",
   hkApprove בלולאה עד done עם התקדמות) / פעיל (הריצה הלילית האחרונה + רשימת "לבדוק" עם "טופל" – hkChkDone). מנהל בלבד (השרת אוכף: functions/hk-import.js).
   רכיבי העיצוב הקיימים בלבד (.card .btn .kg .k .li .note .f). משתמש ב: V, ACT, FRM, fnCall, esc, toast, dlg, closeDlg, ask, rerender, cur, fd, saveFile, SY, APP_REPO. */
(function(){
'use strict';
if(typeof ACT==='undefined'||typeof V==='undefined')return;
const fnCall=(n,d)=>{d=d&&typeof d==='object'?d:{};if(SY&&SY.sa&&SY.bizId&&!('bizId'in d))d=Object.assign({bizId:SY.bizId},d);return window.fnCall(n,d)};
const B={i:null,err:'',ld:0};
const NEW_ALL=100000; /* "ללא הגבלה" לפריטים חדשים (24.11.2026) */
const REPO=()=>typeof APP_REPO==='string'&&/^[\w.-]+\/[\w.-]+$/.test(APP_REPO)&&!/__/.test(APP_REPO)?APP_REPO:'nati59029-a11y/large-pami-android'; /* APP_REPO נקבע בבנייה (main.yml); בלי – המאגר הזה */
const dt=t=>t?new Date(t).toLocaleString('he-IL',{day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
const dd=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)?d.slice(8)+'/'+d.slice(5,7):'—';
const ST={ok:'הצליח',fail:'נכשל','needs-login':'צריך להתחבר לכספית',run:'לא הסתיים',wait:'ממתין לניסיון חוזר'};
/* קודי התקלה של התוסף (caspit-extension/src/lib/plan.js) – בעברית פשוטה */
const ERR={'import-errors':'כספית טענה את הקובץ עם שורות שגויות (או שהטעינה נכשלה). הקובץ השגוי נמצא בכספית, ב"טעינות קודמות".','import-timeout':'כספית לא סיימה את הטעינה בזמן – כדאי לבדוק ב"טעינות קודמות" בכספית.','import-queue-not-empty':'במסך הייבוא של כספית ממתינים קבצים שמישהו הוסיף ולא העלה. הרובוט לא העלה כלום – כדאי לנקות את "ממתין לטעינה" בכספית.','wrong-page':'התוסף הגיע לדף שאינו המשרד האחורי של כספית (/bo) ועצר – בלי לגעת בקופה. כדאי לפתוח את כספית במחשב ולבדוק.','needs-login':'צריך להתחבר לכספית ב-Chrome במחשב החנות. אחרי ההתחברות הסנכרון ממשיך לבד.','selector-miss':'מסך בכספית השתנה והרובוט לא מצא כפתור או שדה.','endpoint-changed':'הקובץ שהתקבל מכספית לא נראה כמו שציפינו.',
 'hours-format':'קובץ השעות שירד מכספית לא נראה כמו שציפינו – שעות העובדים לא עודכנו (השאר עודכן).','hours-list':'הרובוט לא הצליח לקרוא את רשימת העובדים בכספית – שעות העובדים לא עודכנו.','hours-month':'הרובוט לא הצליח לבחור בכספית את החודש הקודם – השעות של החודש הקודם לא עודכנו.','hours-branch':'שעות העובדים של סניף נחל לכיש לא עודכנו (יהודה הנשיא עודכן).','hours-fail':'עדכון שעות העובדים מכספית נכשל (השאר עודכן).',
 limit:'יותר מדי שינויים לכספית בבת אחת – הרובוט עצר. אפשר להעלות את המגבלה למטה, או לשלוח את הקבצים מכאן.',auth:'החיבור בוטל. צריך לחבר מחדש עם קוד חדש.','min-ver':'צריך לעדכן את התוסף לגרסה חדשה.',disabled:'הסנכרון האוטומטי כבוי.',
 network:'אין חיבור לאינטרנט במחשב החנות.',offline:'אין חיבור לאינטרנט במחשב החנות.',timeout:'הפעולה לקחה יותר מדי זמן.',server:'תקלה זמנית בשרת.',rate:'יותר מדי פניות היום.',stale:'הנתונים השתנו באמצע – ננסה שוב.',busy:'סנכרון אחר רץ באותו זמן.',
 tab:'תקלה זמנית בלשונית של כספית.',stuck:'העדכון התחיל ולא הסתיים (Chrome נסגר באמצע, או שהדף של כספית נתקע).',parse:'לא הצלחנו לקרוא את הקובץ מכספית.','first-manual':'את הקטלוג הראשון מסנכרנים כאן באפליקציה.',fail:'הסנכרון נכשל.'};
const errTxt=(code,msg)=>ERR[code]||msg||(ERR.fail+(code&&code!=='fail'?' (קוד: '+String(code).slice(0,40)+')':'')); // 25.11: קוד לא מוכר – מציגים אותו (בלי הודעה מהרובוט, למשל במכירות היום) כדי שאפשר לדעת את הסיבה
window.cxErrTxt=errTxt; /* 24.11.2026: גם למסך "מכירות כספית" (עדכון שעתי שנכשל) */
/* פירוט התקלה מהתוסף (מסך וצעד) – מוצג בנוסף להסבר הכללי, כדי לדעת איפה הריצה נעצרה */
const errDet=e=>{if(!e)return'';const m=String(e.msg||'').trim(),st=String(e.step||'').trim();return m&&ERR[e.code]&&m!==ERR[e.code]?'פירוט: '+m+(st?' (צעד '+st+')':''):''};
async function load(){if(B.ld)return;B.ld=1;try{B.i=await fnCall('cxBotTok',{op:'info'});B.at=Date.now();B.err=''}catch(e){B.err=e&&e.message||'הטעינה נכשלה'}B.ld=0;if(cur().v==='cxSync')rerender()}
const tm=t=>t?new Date(t).toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'}):'';
const verLt=(a,b)=>{const p=v=>String(v||'0').split('.').map(x=>parseInt(x,10)||0),x=p(a),y=p(b);for(let k=0;k<3;k++)if((x[k]||0)!==(y[k]||0))return(x[k]||0)<(y[k]||0);return false};
/* מצב "סנכרן עכשיו" לפי שעון השרת (i.now + הזמן שעבר מאז הטעינה): wait = נשלח וממתין למחשב, run = המחשב התחיל, late = המחשב לא הגיב,
   retry / retryOld = המחשב באמצע סנכרון שממתין לניסיון חוזר (q.wait) – בזמן הבקשה / אחרי שפגה */
function nowSt(i){const q=i.req;if(!q)return'';const sn=(i.now||Date.now())+(Date.now()-(B.at||Date.now())),lr=i.lr,live=sn-q.at<(i.reqMs||600000);
 if(!q.took&&q.wait&&sn-q.at<864e5&&!(lr&&(lr.at||0)>=q.at))return live?'retry':'retryOld';
 if(!q.took)return live?'wait':sn-q.at<864e5&&!(lr&&(lr.at||0)>=q.at)?'late':'';
 return !(lr&&(lr.at||0)>=q.took)&&sn-q.took<18e5?'run':''}
/* רענון בזמן המתנה / ריצה: כל 20 שניות, רק כשהמסך הזה פתוח והאפליקציה גלויה */
function nowTick(on){if(!on||B.tm)return;B.tm=setTimeout(()=>{B.tm=0;if(cur().v==='cxSync'&&!document.hidden)load()},20000)}
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&B.i&&/^(wait|run|retry)$/.test(nowSt(B.i))&&cur().v==='cxSync')load()});
const big='style="min-height:48px"';
/* היום לפי שעון ישראל (שורת "מכירות היום" – רק כשהעדכון האחרון הוא של היום) */
const ilToday=()=>{try{return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}catch(e){return new Date().toISOString().slice(0,10)}};

/* הכרטיס – נקרא מ-V.cxSync (caspit-sync.js) */
window.cxBotCardH=()=>{if(!B.i&&!B.err)load();const i=B.i;
 let h='<div class="card"><h3 style="margin-top:0">רובוט – מחשב החנות</h3><p class="note" style="margin-top:0">תוסף ב-Chrome במחשב החנות מסנכרן לבד כל לילה ב-03:00: קטלוג, '+(typeof window.cxSalesOk==='function'&&window.cxSalesOk()?'מכירות של הימים שעברו, ':'')+'וקבצים לכספית. '+(typeof window.cxSalesOk==='function'&&window.cxSalesOk()?'מכירות היום מתעדכנות כל שעה (07:00–23:00, נתון חלקי). ':'')+'הקטלוג הראשון – רק כאן באפליקציה.</p>';
 if(B.err)h+=`<p class="note">${esc(B.err)}</p><button class="btn g w" ${big} data-a="cxBotRe">נסו שוב</button>`;
 else if(!i)h+='<p class="note">טוען…</p>';
 else{
  if(!i.dev)h+=`<p class="note">אין מחשב מחובר.</p><button class="btn w" ${big} data-a="cxBotNew">חיבור מחשב</button>`;
  else{const lr=i.lr;
   h+=`<div class="kg"><div class="k"><small>סנכרון אחרון</small><b>${lr?esc(ST[lr.st]||lr.st):'עוד לא'}</b><small>${lr?dt(lr.at)+' · '+(lr.manual?'ידני':'אוטומטי'):''}</small></div>${typeof window.cxSalesOk==='function'&&window.cxSalesOk()?`<div class="k"><small>מכירות נקלטו עד</small><b>${dd(i.sd)}</b></div>`:''}<div class="k"><small>המחשב נראה לאחרונה</small><b>${dt(Math.max(i.dev.last||0,i.pl||0))}</b><small>${i.dev.ver?'גרסה '+esc(i.dev.ver):''}</small></div></div>`;
   /* "סנכרן עכשיו" – בקשה למחשב החנות */
   const ns=nowSt(i),q=i.req,nv=i.nowVer||'0.1.5';
   h+=`<button class="btn w" data-a="cxBotNow" ${/^(wait|run|retry)$/.test(ns)?'disabled':''} style="min-height:48px;margin-bottom:8px">סנכרן עכשיו</button>`;
   if(ns==='wait')h+=`<p class="note" role="status">נשלח – ממתין למחשב (${tm(q.at)}). המחשב בודק כל דקה.</p>`;
   else if(ns==='run')h+=`<p class="note" role="status">המחשב התחיל (${tm(q.took)}). התוצאה תופיע כאן בסיום.</p>`;
   else if(/retry/.test(ns))h+=`<p class="note" role="status">המחשב באמצע סנכרון קודם שנתקל בתקלה זמנית – ${q.wait<Date.now()?'ניסה שוב':'ינסה שוב'} ב-${tm(q.wait)}.</p>`;
   else if(ns==='late')h+=`<p class="note" role="alert">⚠ המחשב לא הגיב לבקשה (${tm(q.at)}) – בדקו שהוא דלוק ו-Chrome פתוח.</p>`;
   if(!i.pl||verLt(i.dev.ver,nv))h+=`<p class="note">כדי ש"סנכרן עכשיו" יעבוד צריך לעדכן את התוסף במחשב לגרסה ${esc(nv)} ומעלה ("הורדת התוסף" למטה).</p>`;
   nowTick(/^(wait|run|retry)$/.test(ns));
   /* עדכון אוטומטי של התוסף (0.1.7, הסקריפט במחשב – upd.json) */
   {const u=i.dev.upd;
    if(!u)h+=`<p class="note">עדכון אוטומטי של התוסף: לא מותקן. בתיקיית התוסף במחשב – הפעלה אחת של install-auto-update.cmd (מגרסה 0.1.7).</p>`;
    else if(!u.ok)h+=`<p class="note" role="alert">⚠ עדכון אוטומטי של התוסף נכשל (${dt(u.at)}${u.fails>1?', '+u.fails+' פעמים ברצף':''})${u.err?': '+esc(u.err):''}. הסנכרון ממשיך בגרסה הנוכחית.</p>`;
    else if(u.ver&&verLt(i.dev.ver,u.ver))h+=`<p class="note" role="alert">⚠ גרסה ${esc(u.ver)} של התוסף הורדה למחשב וממתינה לטעינה. אם זה נמשך – לסגור ולפתוח את Chrome במחשב.</p>`;
    else h+=`<p class="note">עדכון אוטומטי של התוסף: תקין (נבדק ${dt(u.at)}).</p>`;}
   h+=`<button class="btn g w" ${big} data-a="cxBotUpd" style="min-height:48px;margin-bottom:8px">עדכון המחשב</button>`;
   if(i.tp&&i.tp.d&&i.tp.d===ilToday())h+=`<p class="note">מכירות היום (${dd(i.tp.d)}) עודכנו מהמחשב עד השעה ${esc(String(i.tp.hm||''))} – חלקי, הסכום הסופי נקלט בלילה.</p>`;
   /* תוסף 0.1.19: העדכון השעתי האחרון נכשל (ואחריו לא הצליח עדכון) */
   if(i.tf&&i.tf.s&&!(i.tp&&i.tp.at>i.tf.at))h+=`<p class="note" role="alert">⚠ העדכון של מכירות היום בשעה ${esc(String(i.tf.s).slice(11))}:00 נכשל: ${esc(errTxt(i.tf.c))}</p>`;
   if(lr&&lr.st!=='ok'&&lr.code)h+=`<p class="note" role="alert">⚠ ${esc(errTxt(lr.code,lr.msg))}${errDet(lr)?`<br><bdi>${esc(errDet(lr))}</bdi>`:''}</p>`;
   /* הטעינה האחרונה לכספית (טבלת "טעינות קודמות" בכספית) */
   if(i.li&&i.li.id)h+=`<p class="note">טעינה אחרונה לכספית (${i.li.kind==='new'?'פריטים חדשים':'מחירים'}, ${dt(i.li.at)}): מזהה ${esc(String(i.li.id))} · ${esc(i.li.status||'')} · נטענו ${i.li.loaded<0?'?':i.li.loaded} · שגויים ${i.li.errors<0?'?':i.li.errors}${i.li.errors>0?' ⚠':''}</p>`;
   if(i.first)h+='<p class="note">קודם מסנכרנים כאן קטלוג ראשון (בחירת קובץ למעלה). עד אז הרובוט קולט רק מכירות.</p>';
   h+=`<button class="btn g w" ${big} data-a="cxBotRuns">הריצות האחרונות (${(i.runs||[]).length})</button><div class="row" style="margin-top:8px"><button class="btn g grow" ${big} data-a="cxBotNew">חיבור מחשב אחר</button><button class="btn g grow" ${big} data-a="cxBotRev">ניתוק</button></div>`}
  h+=`<form data-f="cxBotMaxF" style="margin-top:12px"><label class="f"><span>פריטים חדשים שהרובוט טוען לכספית בכל ריצה${+i.newMax>=NEW_ALL?' – עכשיו: ללא הגבלה':''}</span><input name="n" type="number" inputmode="numeric" min="0" max="${NEW_ALL}" step="1" value="${+i.newMax>=NEW_ALL?'':+i.newMax||0}" placeholder="מספר" style="min-height:48px"></label><label style="display:flex;align-items:center;gap:8px;min-height:44px"><input type="checkbox" name="all" ${+i.newMax>=NEW_ALL?'checked':''} style="width:22px;height:22px"> ללא הגבלה</label><p class="note" style="margin-top:0">1 = בדיקה ראשונה עם פריט אחד. "ללא הגבלה" – הרובוט טוען לכספית את כל הפריטים החדשים בכל ריצה. עם מספר – מעל המגבלה הרובוט עוצר ומודיע.</p><button class="btn g w" ${big}>שמירה</button></form>`;
  if(i.sa)h+=`<details style="margin-top:12px"><summary style="min-height:44px;display:flex;align-items:center"><b>דוח היכרות (מנהל־על)</b></summary>${(i.disc||[]).length?i.disc.map(x=>`<button class="btn g w" style="min-height:48px;margin-top:6px" data-a="cxBotDisc" data-k="${esc(x.id)}">${dt(x.at)} · ${Math.ceil((x.size||0)/1024)} KB</button>`).join(''):'<p class="note">עוד לא נשלח דוח. שולחים מחלון התוסף: "מצב היכרות" ← "שליחה".</p>'}</details>`}
 h+=`<div class="row" style="margin-top:12px"><button class="btn g grow" ${big} data-a="cxBotDl">הורדת התוסף</button><button class="btn g grow" ${big} data-a="cxBotGuide">הוראות התקנה</button></div></div>`;
 return h+hkCardH()};

/* ---------- לקוחות הקפה מכספית (24.11, סבב 2) ---------- */
const HK={g:null,err:'',ld:0,hide:0,run:0,prog:''};
async function hkLoad(){if(HK.ld)return;HK.ld=1;try{HK.g=await fnCall('hkGet',{});HK.err='';HK.hide=0}catch(e){if(e&&e.reason==='manager-only')HK.hide=1;else HK.err=e&&e.message||'הטעינה נכשלה'}HK.ld=0;if(cur().v==='cxSync')rerender()}
const ag=n=>ils((+n||0)/100); /* השרת שומר באגורות */
const kv=(l,v,c)=>`<div class="k${c?' '+c:''}"><small>${l}</small><b>${v}</b></div>`;
const hkLi=(x,btn)=>`<div class="li" style="cursor:default;align-items:center"><div class="m"><b><bdi>${esc(x.name||'לקוח כספית '+(x.xc||''))}</bdi></b><small>מספר לקוח בכספית ${esc(String(x.xc||''))}${typeof x.bal==='number'?' · יתרה '+ag(x.bal):''}${typeof x.diff==='number'&&x.diff?(x.diff<0?' · ירידה של '+ag(-x.diff):' · חיוב של '+ag(x.diff)):''}${x.day?' · '+dd(x.day):''}</small><small>${esc(x.msg||'')}</small></div>${btn?`<button class="btn g s" style="min-height:48px;padding:4px 14px;flex:none" data-a="hkDone" data-id="${esc(x.id)}">טופל</button>`:''}</div>`;
function hkCardH(){if(HK.hide)return'';if(!HK.g&&!HK.err)hkLoad();const g=HK.g;
 let h='<div class="card"><h3 style="margin-top:0">לקוחות הקפה מכספית</h3>';
 if(HK.err)h+=`<p class="note">${esc(HK.err)}</p><button class="btn g w" ${big} data-a="hkRe">נסו שוב</button>`;
 else if(!g)h+='<p class="note">טוען…</p>';
 else if(HK.run)h+=`<p class="note" role="status" id="hkprog">${esc(HK.prog||'מאשר…')}</p><p class="note">אל תסגרו את האפליקציה עד שהאישור מסתיים.</p>`;
 else if(g.st==='none')h+='<p class="note" style="margin-top:0">הרובוט יביא את רשימת הלקוחות מכספית בריצה הלילית. אחר כך תופיע כאן תצוגה מקדימה לאישור – עד האישור לא נוצר שום לקוח.</p>';
 else if((g.st==='pend'||g.st==='apr')&&g.pend){const p=g.pend,v=p.pv||{},L=v.chkL||[];
  h+=`<p class="note" style="margin-top:0">ממתין לאישור – עוד לא נוצר שום לקוח. כל הלקוחות ייכנסו כלקוחות פרטיים, עם יתרת פתיחה לכל מי שהיתרה שלו אינה 0.</p>
  <div class="kg">${kv('תאריך התמונה',dd(p.day))}${kv('לקוחות',+v.n||0)}${kv('חדשים',+v.new||0)}${kv('מותאמים ללקוח קיים',+v.match||0)}${kv('לבדוק',+v.chk||0,v.chk?'neg':'')}${kv('סך היתרות',ag(v.sum))}${kv('עם יתרה שלילית',+v.neg||0)}${kv('עם יתרה 0',+v.zero||0)}</div>
  ${v.chk?`<p class="note">ב"לבדוק" לא ייווצר כלום – מטפלים בהם ידנית אחרי האישור. סך היתרות שייכנסו בפועל (בלי "לבדוק"): ${ag(v.sumOk)}.</p>`:''}
  <p class="note" role="alert"><b>בדקו שסך החובות תואם לדוח 'דוח לקוחות - הקפה' בכספית לפני האישור.</b></p>
  ${g.st==='apr'&&g.apr?`<p class="note" role="status">האישור התחיל ולא הסתיים (${+g.apr.pos||0} מתוך ${+g.apr.n||0}). לחצו "המשך אישור" כדי להשלים.</p>`:''}
  <button class="btn w" ${big} data-a="hkApr">${g.st==='apr'?'המשך אישור':'אשר ייבוא'}</button>
  ${L.length?`<details style="margin-top:8px"><summary style="min-height:48px;display:flex;align-items:center"><b>לבדוק (${L.length}${v.chk>L.length?' מתוך '+v.chk:''})</b></summary>${L.map(x=>hkLi(x,false)).join('')}</details>`:''}`}
 else if(g.st==='on'){const n=g.night,f=g.first,L=g.chk||[];
  h+=n?`<div class="kg">${kv('ריצה לילית אחרונה',dd(n.day))}${kv('חיובים שנוספו',+n.add||0)}${kv('בסכום',ag(n.sum))}${kv('לקוחות חדשים',+n.new||0)}${kv('ירידות יתרה (לבדוק)',+n.neg||0,n.neg?'neg':'')}</div><p class="note">נקלט ${dt(n.at)} · ${+n.n||0} לקוחות בתמונה${n.del?' · '+n.del+' שנמחקו באפליקציה (לא נוצרים שוב)':''}${n.pend?' · '+n.pend+' חיובים ללקוחות שממתינים לבדיקה ('+ag(n.psum)+') – לא נכנסו':''}${n.full?' · '+n.full+' חיובים נוספים באותו יום ('+ag(n.fsum)+') – ייכנסו מחר':''}</p>`
   :`<p class="note" style="margin-top:0">הייבוא הראשון אושר${f?' ('+dt(f.at)+')':''}. הריצה הלילית הבאה תוסיף חיובים חדשים מכספית.</p>`;
  h+=`<div class="sec"><h3>לבדוק (${L.length})</h3></div>${L.length?L.map(x=>hkLi(x,true)).join(''):'<p class="note">אין פריטים פתוחים.</p>'}`}
 h+=`<button class="btn g w" ${big} data-a="hkRe" style="margin-top:8px">רענן</button></div>`;
 return h}
const hkSet=t=>{HK.prog=t;const e=document.getElementById('hkprog');if(e)e.textContent=t;else if(cur().v==='cxSync')rerender()};
ACT.hkRe=()=>{HK.err='';HK.g=null;rerender()};
ACT.hkApr=()=>{const g=HK.g,p=g&&g.pend;if(!p||HK.run)return;const v=p.pv||{};
 ask(`לאשר ייבוא של ${+v.n||0} לקוחות מכספית (${+v.new||0} חדשים, ${+v.match||0} מותאמים, ${+v.chk||0} לבדוק), סך יתרות ${ag(v.sum)}?`,async()=>{
  HK.run=1;HK.prog='מאשר…';rerender();let r=null,k=0;
  try{do{r=await fnCall('hkApprove',{sid:p.sid});hkSet('אושרו '+(+r.pos||0)+' מתוך '+(+r.n||0)+' לקוחות…')}while(r&&!r.done&&++k<100);
   HK.run=0;const c=(r&&r.c)||{};
   dlg(`<h3>${r&&r.done?'הייבוא הסתיים':'הייבוא עוד לא הסתיים'}</h3><div class="kg">${kv('לקוחות חדשים',+c.new||0)}${kv('מותאמים ללקוח קיים',+c.match||0)}${kv('יתרות פתיחה',+c.ob||0)}${kv('לבדוק',+c.chk||0,c.chk?'neg':'')}${kv('סך יתרות הפתיחה',ag(c.sum))}</div><p class="note">${r&&r.done?'עכשיו אפשר לעבור על כרטיסי הלקוחות: להזין קבלות ולמחוק לקוחות לא רלוונטיים. את "לבדוק" מסמנים "טופל" כאן.':'לחצו שוב "המשך אישור".'}</p><button class="btn g w" ${big} data-a="closeDlg">סגור</button>`)}
  catch(e){HK.run=0;toast(e&&e.message||'הפעולה נכשלה')}
  HK.g=null;HK.ld=0;hkLoad()},'אשר ייבוא')};
ACT.hkDone=async el=>{const id=el.dataset.id;el.disabled=true;try{await fnCall('hkChkDone',{id});toast('סומן כטופל');if(HK.g&&HK.g.chk)HK.g.chk=HK.g.chk.filter(x=>x.id!==id);rerender()}catch(e){el.disabled=false;toast(e&&e.message||'הפעולה נכשלה')}};

ACT.cxBotRe=()=>{B.err='';B.i=null;rerender()};
/* "עדכון המחשב": מצב + בקשה לתוסף לבדוק את הדיסק ולהיטען מחדש. ההורדה עצמה – המשימה ב-Windows (כל 10 דקות, אחרי הרצה חוזרת של install-auto-update.cmd) */
const UST={reload:'התוסף מצא גרסה חדשה במחשב ונטען מחדש.',same:'אין גרסה חדשה במחשב – התוסף כבר מעודכן לגרסה שהורדה.',copying:'גרסה חדשה בהורדה למחשב – התוסף ייטען לבד כשתסתיים.',busy:'סנכרון רץ עכשיו – התוסף ייטען לבד מיד אחריו.',none:'העדכון האוטומטי לא מותקן במחשב (אין upd.json) – צריך להריץ את install-auto-update.cmd.'};
function updSt(i){const q=i&&i.ureq;if(!q)return'';const sn=(i.now||Date.now())+(Date.now()-(B.at||Date.now()));if(q.took)return'done';return sn-q.at<(i.reqMs||600000)?'wait':'late'}
function updH(){const i=B.i||{},d=i.dev||{},u=d.upd,q=i.ureq,us=updSt(i),uv=i.updVer||'0.1.10',old=d.ver&&verLt(d.ver,uv);
 const stx=!u?'לא מותקן':!u.ok?'נכשל'+(u.err?' ('+esc(u.err)+')':''):u.ver&&verLt(d.ver,u.ver)?'גרסה '+esc(u.ver)+' הורדה וממתינה לטעינה':'תקין';
 return `<h3>עדכון המחשב</h3><div class="kg"><div class="k"><small>גרסה מותקנת</small><b dir="ltr">${esc(d.ver||'—')}</b></div><div class="k"><small>בדיקת עדכון אחרונה</small><b>${u?dt(u.at):'—'}</b></div><div class="k${u&&!u.ok?' neg':''}"><small>מצב</small><b>${stx}</b></div></div>
 ${us==='wait'?`<p class="note" role="status">נשלח – ממתין למחשב (${tm(q.at)}). המחשב בודק כל דקה.</p>`:us==='done'?`<p class="note" role="status">המחשב ענה (${tm(q.took)}): ${esc((q.res&&UST[q.res.st])||'')}${q.res&&q.res.disk?' גרסה בדיסק: <bdi dir="ltr">'+esc(q.res.disk)+'</bdi>.':''}</p>`:us==='late'?`<p class="note" role="alert">⚠ המחשב לא ענה לבקשה (${tm(q.at)}) – אולי הוא כבוי, Chrome סגור או שסנכרון רץ.</p>`:''}
 <button class="btn w" ${big} data-a="cxBotUpdGo"${us==='wait'||old?' disabled':''}>בדיקת עדכון עכשיו</button>
 ${old?`<p class="note">בתוסף שבמחשב (${esc(d.ver)}) אין עדיין "עדכון המחשב" – צריך גרסה ${esc(uv)} ומעלה. העדכון האוטומטי יביא אותה לבד.</p>`:''}
 <p class="note">העדכון עצמו מגיע מהמחשב: הוא בודק כל 10 דקות אם פורסמה גרסה חדשה, ולכן גרסה חדשה מגיעה תוך עד 10 דקות מהפרסום. הכפתור רק מבקש מהתוסף לבדוק אם הגרסה כבר במחשב ולהיטען מחדש (רק כשאין סנכרון באמצע).</p>
 <p class="note"><b>פעם אחת:</b> כדי להפעיל את הבדיקה כל 10 דקות, מריצים שוב במחשב את הקובץ <span dir="ltr">install-auto-update.cmd</span> שבתיקיית התוסף (לחיצה כפולה).</p>
 <button class="btn g w" ${big} data-a="closeDlg" style="min-height:48px;margin-top:8px">סגור</button>`}
const updRe=()=>{if(document.querySelector('#dlg[open] [data-a=cxBotUpdGo]'))dlg(updH())};
ACT.cxBotUpd=()=>{dlg(updH());load().then(updRe)};
ACT.cxBotUpdGo=async el=>{if(el)el.disabled=true;try{await fnCall('cxBotTok',{op:'upd'});toast('נשלח למחשב החנות')}catch(e){toast(e&&e.reason==='bad-op'?'השרת עוד לא תומך ב"עדכון המחשב". נסו שוב אחרי עדכון השרת.':e&&e.message||'הפעולה נכשלה')}
 B.ld=0;await load();updRe();updWait()};
/* בזמן המתנה לתשובת המחשב: רענון כל 20 שניות, רק כשהחלון פתוח והאפליקציה גלויה */
function updWait(){if(B.ut||updSt(B.i)!=='wait')return;B.ut=setTimeout(async()=>{B.ut=0;if(!document.hidden&&document.querySelector('#dlg[open] [data-a=cxBotUpdGo]')){await load();updRe();updWait()}},20000)}
/* "סנכרן עכשיו": בקשה אחת בכל פעם (השרת מסרב לבקשה כפולה / בזמן ריצה). אין הגבלה יומית */
ACT.cxBotNow=async el=>{if(el)el.disabled=true;try{await fnCall('cxBotTok',{op:'now'});toast('נשלח למחשב החנות')}catch(e){toast(e&&e.message||'הפעולה נכשלה')}load()};
window.cxBotReset=()=>{B.err='';B.i=null;if(!HK.run){HK.err='';HK.g=null}};
/* חיבור: קוד חדש (מוצג פעם אחת). מחשב שמחובר עכשיו מתנתק */
const mk=async()=>{try{const r=await fnCall('cxBotTok',{op:'new'});
 dlg(`<h3>קוד חיבור למחשב</h3><p class="note"><b>הקוד מוצג פעם אחת בלבד.</b> במחשב: סמל התוסף ← "חיבור לאפליקציה והגדרות" ← מדביקים ← "חבר". לא שולחים את הקוד לאף אחד, ומוחקים אותו אחרי החיבור.</p><div class="card" style="word-break:break-all;direction:ltr;text-align:left"><code id="cxBotTok">${esc(r.token)}</code></div><div class="row"><button class="btn grow" ${big} data-a="cxBotCopy">העתקה</button><button class="btn g grow" ${big} data-a="closeDlg">סגור</button></div>`);
 B.i=null;load()}catch(e){toast(e&&e.message||'הפעולה נכשלה')}};
ACT.cxBotNew=()=>{if(B.i&&B.i.dev)return ask('ליצור קוד חיבור חדש? המחשב שמחובר עכשיו יתנתק.',mk,'כן, קוד חדש');mk()};
ACT.cxBotCopy=()=>{const e=document.getElementById('cxBotTok');if(!e)return;const t=e.textContent;(navigator.clipboard&&navigator.clipboard.writeText?navigator.clipboard.writeText(t):Promise.reject()).then(()=>toast('הקוד הועתק'),()=>{try{const r=document.createRange();r.selectNodeContents(e);const s=getSelection();s.removeAllRanges();s.addRange(r);toast('סמנו והעתיקו ידנית')}catch(x){}})};
{const d=document.getElementById('dlg');if(d)d.addEventListener('close',()=>{if(document.getElementById('cxBotTok'))d.innerHTML=''})} /* הקוד נמחק מהמסך בכל סגירה */
ACT.cxBotRev=()=>ask('לנתק את המחשב? הרובוט יפסיק לסנכרן עד שתחברו מחשב מחדש.',async()=>{try{await fnCall('cxBotTok',{op:'revoke'});toast('המחשב נותק');B.i=null;load()}catch(e){toast(e&&e.message||'הפעולה נכשלה')}},'כן, נתק');
/* 0.1.12: תמונת מסך הייבוא בכספית כשהקובץ לא נכנס לתור (r.scr מהשרת – מסוננת, בלי תוכן טבלאות) – לאבחון, בתוך "פירוט" מקופל */
const QH={none:'לא נמצאה במסך',exact:'נמצאה',part:'נמצאה רק כחלק מטקסט ארוך יותר',hidden:'קיימת אבל מוסתרת'};
const scrH=x=>{if(!x||typeof x!=='object')return'';const A=a=>Array.isArray(a)?a:[],j=(a,s)=>A(a).filter(Boolean).map(t=>esc(String(t))).join(s||' · '),L=[];
 L.push('הכותרת "ממתין לטעינה": '+esc(QH[x.qhead]||x.qhead||'—'));
 if(A(x.heads).length)L.push('כותרות במסך: <bdi>'+j(x.heads)+'</bdi>');
 if(A(x.wait).length)L.push('טקסטים עם "ממתין" / "לטעינה": <bdi>'+A(x.wait).map(w=>esc(String(w&&w.t||''))+(w&&w.vis?'':' (מוסתר)')).join(' · ')+'</bdi>');
 L.push('טבלאות: '+A(x.tables).length+(A(x.tables).length?' – <bdi>'+A(x.tables).map(t=>(t&&A(t.th).length?j(t.th,' | '):'בלי כותרות')+' ('+(+(t&&t.rows)||0)+' שורות'+(t&&t.vis?'':', מוסתרת')+')').join(' · ')+'</bdi>':''));
 if(A(x.btns).length)L.push('כפתורים: <bdi>'+j(x.btns)+'</bdi>');
 L.push('שדות קובץ: '+A(x.files).length+A(x.files).map((f,k)=>'<br>'+(k+1)+'. '+(f&&f.vis?'גלוי':'מוסתר')+(f&&f.multi?', כמה קבצים':'')+(f&&f.n?', נבחר קובץ':'')+(f&&f.accept?', סוגים: <bdi>'+esc(f.accept)+'</bdi>':'')+(f&&f.lbl?', תווית: <bdi>'+esc(f.lbl)+'</bdi>':'')+(f&&A(f.up).length?', סביב: <bdi>'+j(f.up)+'</bdi>':'')).join(''));
 if(A(x.dialogs).length)L.push('חלון קופץ: <bdi>'+j(x.dialogs)+'</bdi>');
 return`<details><summary style="min-height:44px;display:flex;align-items:center"><small>פירוט מסך הייבוא בכספית (לאבחון${x.op?' – צעד '+esc(x.op):''})</small></summary><small style="display:block;line-height:1.6">${L.join('<br>')}</small></details>`};
ACT.cxBotRuns=()=>{const R=(B.i&&B.i.runs)||[];
 const imp=x=>!x?'':['new','price'].filter(k=>x[k]).map(k=>`${k==='new'?'פריטים חדשים':'מחירים'} לכספית: ${x[k].n}${x[k].id?` (טעינה ${x[k].id}: נטענו ${x[k].loaded<0?'?':x[k].loaded}, שגויים ${x[k].errors<0?'?':x[k].errors})`:''}${x[k].ok?'':' – לבדוק'}`).join(' · ');
 dlg(`<h3>הריצות האחרונות</h3><div style="max-height:60vh;overflow:auto">${R.map(r=>`<div class="li" style="cursor:default"><div class="m"><b>${dt(r.at)} · ${esc(ST[r.st]||r.st||'')}</b><small>${r.req?'ידני – "סנכרן עכשיו" מהטלפון':r.manual?'ידני – "סנכרן עכשיו"':'אוטומטי'}${r.days&&r.days.length&&typeof window.cxSalesOk==='function'&&window.cxSalesOk()?' · ימי מכירות: '+r.days.map(dd).join(', '):''}</small>${r.err&&r.err.code&&r.st!=='ok'?`<small>⚠ ${esc(errTxt(r.err.code,r.err.msg))}</small>${errDet(r.err)?`<small><bdi>${esc(errDet(r.err))}</bdi></small>`:''}`:''}${imp(r.imp)?`<small>${esc(imp(r.imp))}</small>`:''}${r.st!=='ok'?scrH(r.scr):''}</div></div>`).join('')||'<p class="note">עוד לא היו ריצות.</p>'}</div><button class="btn g w" ${big} data-a="closeDlg">סגור</button>`)};
/* 24.11.2026 (בעל העסק): "ללא הגבלה" = NEW_ALL (התקרה הטכנית בשרת, caspit.js). עד אז 0–50 */
FRM.cxBotMaxF=async f=>{const x=fd(f),n=x.all?NEW_ALL:Math.round(+x.n);if(!x.all&&(String(x.n||'').trim()===''||!Number.isInteger(n)||n<0||n>=NEW_ALL))return toast('מספר מ-0 ומעלה, או "ללא הגבלה"');const b=f.querySelector('button');b.disabled=true;
 try{await fnCall('cxSetCfg',{newMax:n});toast('נשמר');if(B.i)B.i.newMax=n;rerender()}catch(e){b.disabled=false;toast(e&&e.message||'הפעולה נכשלה')}};
/* התוסף: release caspit-ext-v<גרסה> במאגר (ציבורי) – בלי פונקציה בשרת */
ACT.cxBotDl=()=>window.open(`https://github.com/${REPO()}/releases?q=caspit-ext&expanded=true`,'_system');
ACT.cxBotGuide=()=>dlg(`<h3>התקנת התוסף במחשב החנות</h3><ol style="padding-inline-start:20px;line-height:1.7;margin-top:0">
 <li>במחשב (Windows + Chrome) מורידים את הקובץ <span dir="ltr">caspit-extension-….zip</span> ("הורדת התוסף").</li>
 <li>לחיצה ימנית על הקובץ ← "חלץ הכל" לתיקייה קבועה (למשל מסמכים). לא מוחקים אותה אחר כך.</li>
 <li>ב-Chrome: <span dir="ltr">chrome://extensions</span> ← מדליקים "מצב מפתח" ← "טעינת פריט לא ארוז" ← בוחרים את התיקייה.</li>
 <li>מצמידים את התוסף (סמל הפאזל ← סיכה).</li>
 <li>כאן באפליקציה: "חיבור מחשב" ← מעתיקים את הקוד ← בתוסף: "חיבור לאפליקציה והגדרות" ← מדביקים ← "חבר".</li>
 <li>נכנסים לכספית באותו Chrome ולוחצים בתוסף "סנכרן עכשיו" לבדיקה.</li></ol>
 <p class="note">המחשב צריך להיות דלוק ו-Chrome פתוח בלילה. אם כבה – הסנכרון משלים כשהוא נדלק.</p>
 <div class="row"><button class="btn g grow" ${big} data-a="cxBotDoc">המדריך המלא</button><button class="btn g grow" ${big} data-a="closeDlg">סגור</button></div>`);
ACT.cxBotDoc=()=>window.open(`https://github.com/${REPO()}/blob/main/docs/caspit-extension-install.md`,'_system');
/* דוח היכרות – מנהל־על: צפייה (תחילת הדוח) והורדה מלאה */
ACT.cxBotDisc=async el=>{const id=el.dataset.k;try{const r=await fnCall('cxBotDisc',{id});let txt=r.data||'';try{txt=JSON.stringify(JSON.parse(txt),null,1)}catch(e){}
 B.dsc={id,txt};dlg(`<h3>דוח היכרות · ${dt(r.at)}</h3><pre dir="ltr" style="max-height:50vh;overflow:auto;white-space:pre-wrap;word-break:break-all;font-size:12px;text-align:left">${esc(txt.slice(0,20000))}${txt.length>20000?'\n…':''}</pre><div class="row"><button class="btn grow" ${big} data-a="cxBotDiscDl">הורדה (JSON)</button><button class="btn g grow" ${big} data-a="closeDlg">סגור</button></div>`)}
 catch(e){toast(e&&e.message||'הפעולה נכשלה')}};
ACT.cxBotDiscDl=()=>{if(B.dsc)saveFile('caspit-discovery-'+B.dsc.id+'.json',B.dsc.txt,'application/json')};
})();
