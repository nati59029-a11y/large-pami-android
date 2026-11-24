/* גיטי – התחייבויות מהודעות (24.11.2026, "גיטי מנהלת עסק", סבב 3 חלק ב, החלטות 3–4). נטען אחרי sec-comm.js.
   השרת מזהה התחייבות ("אחזור אליך מחר", "הספק ישלח ביום ג'") בהודעה חדשה במייל, בווצאפ או בקבוצה שפתוחה לגיטי, ושומר הצעה בלבד (sec_cmt).
   1. מרכז האישורים (sec-hub.js apprH): כרטיס לכל הצעה (secComm op:'cmts') – עריכת הטקסט, התאריך ולמי (עובד/ים = משימה, "תזכורת לי" = תזכורת ביומן),
      אזהרת משימה דומה (task-dup.js, אזהרה בלבד), "ההודעה המקורית" (פותח את המסך הקיים: מייל / ווצאפ / הקבוצה).
      אישור: קודם secPrefs op:'cmt' st:'claim' (רק הצעה שעדיין ממתינה נתפסת; הוכרעה – לא נוצר כלום), ואז משימה – window.__secCx.create (אותו קוד כמו כרטיס משימה בשיחה, מזהה קבוע tasks/sec<cid> – אישור חוזר לא פותח שנייה);
      תזכורת – secCal op:'add' rem:true cid (sec_cal/sec<cid>). אחר כך secPrefs op:'cmt' – השרת בודק שבאמת נוצרה, מסמן ורושם ביומן. דחייה – secPrefs op:'cmt' st:'no'.
   2. הגדרות המזכירה: מתג "זיהוי התחייבויות" (secPrefs op:'cmtOn'), כבוי כברירת מחדל.
   3. תפריט משימה (tasks-wc.js): משימה שנוצרה מהתחייבות (מזהה seccm…) – "ההודעה המקורית" (secComm op:'src').
   עיצוב: רק משתני הערכה. שום דבר לא נשמר במכשיר. */
(function(root){
'use strict';
if(typeof ACT==='undefined'||typeof CHG==='undefined')return;
const X=root.__sec;if(!X)return;
const fnCall=(n,d)=>{d=d&&typeof d==='object'?d:{};if(SY&&SY.sa&&SY.bizId&&!('bizId'in d))d=Object.assign({bizId:SY.bizId},d);return root.fnCall(n,d)};
const M={L:null,b:0,err:'',ld:0};
const re=()=>{try{if(cur().v==='sec'&&!(typeof typing==='function'&&typing()))rerender()}catch(e){}};
const cx=()=>root.__secCx||null;
const CHL={mail:'מייל',wa:'ווצאפ',grp:'קבוצה'};
const ymd=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
const dShow=d=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(d||'');return m?(+m[3])+'.'+(+m[2]):''};

async function load(){if(M.b)return;M.b=1;M.err='';
 try{const r=await fnCall('secComm',{op:'cmts'});if(!r||!Array.isArray(r.items))throw new Error('לא נטען');
  const old=new Map((M.L||[]).map(c=>[c.cid,c]));
  M.L=r.items.map(x=>{const o=old.get(x.cid);if(o)return o;const k=cxOk()?'task':'rem';return Object.assign({},x,{kind:k,txt:x.what,to:[],all:false,busy:0})});
  M.auto=r.auto===true;if(M.auto)setTimeout(autoRun,0)}
 catch(e){M.err=e&&e.message||'לא נטען'}
 finally{M.b=0;M.ld=1;re()}}
function cxOk(){try{const c=cx();return !!(c&&c.on())}catch(e){return false}}
const byId=id=>(M.L||[]).find(c=>c.cid===id)||null;
const srcL=c=>(CHL[c.ch]||'')+(c.ch==='grp'&&c.grp?' "'+c.grp+'"':'')+' מ'+(c.from||'שולח לא ידוע');
const whoL=c=>c.who==='me'?'התחייבות שלנו':'התחייבות של הצד השני';
function dueOf(c){if(!c.d)return null;const[y,m,d]=c.d.split('-').map(Number);return {y,m:m-1,d,h:23,n:59}}
function dups(c){try{if(c.kind==='rem'||!root.TaskDup||!c.txt)return [];const L=((typeof TK!=='undefined'&&TK&&TK.L)||[]).filter(t=>t&&(t.st==='open'||t.st==='wait')&&!t.prv);
 const du=dueOf(c);return root.TaskDup.find({txt:c.txt,uids:c.all?[]:(c.to||[]).map(z=>z.uid),dl:du?new Date(du.y,du.m,du.d,23,59).getTime():0},L)}catch(e){return []}}
let prep=0;
function prepTasks(){if(prep)return;prep=1;const c=cx();
 Promise.all([c&&c.staff?c.staff().catch(()=>[]):[],(typeof tkLoad==='function'&&typeof TK!=='undefined'&&(!TK.at||Date.now()-TK.at>60000))?tkLoad().catch(()=>{}):null]).then(re).catch(()=>{})}

function cardH(c){const id=esc(c.cid),rem=c.kind==='rem',can=cxOk(),dis=c.busy?' disabled':'';
 const F=(f,x)=>`data-c="cmtF" data-id="${id}" data-f="${f}"${x||''}`;
 const S=typeof TKST!=='undefined'&&Array.isArray(TKST.L)?TKST.L.slice(0,30):[],sel=new Set((c.to||[]).map(z=>z.uid));
 const kindH=can?`<label class="note" style="display:block;margin:4px 0">מה ליצור <select ${F('kind')} style="min-height:40px"><option value="task"${rem?'':' selected'}>משימה לעובד/ים</option><option value="rem"${rem?' selected':''}>תזכורת לי</option></select></label>`:'';
 const whoH=rem?'':`<fieldset style="border:0;padding:0;margin:4px 0"><legend class="note">למי</legend><div class="secrow" style="flex-wrap:wrap"><label class="chip" style="min-height:40px"><input type="checkbox" ${F('all')}${c.all?' checked':''}> כל העובדים</label>${S.map(z=>`<label class="chip" style="min-height:40px"><input type="checkbox" ${F('to',` data-u="${esc(z.uid)}"`)}${sel.has(z.uid)?' checked':''}${c.all?' disabled':''}> ${esc(z.name)}</label>`).join('')}${S.length?'':'<span class="note">טוען את רשימת העובדים…</span>'}</div></fieldset>`;
 const D=dups(c),dupH=D.length?`<div class="note" role="alert" style="margin:4px 0"><b>שימו לב: נראה שכבר יש משימה דומה</b> (אזהרה בלבד – אפשר לאשר בכל זאת):<ul style="margin:2px 0;padding-inline-start:18px">${D.map(x=>`<li>${esc(String(x.task&&x.task.txt||'').slice(0,100))}${x.why&&x.why.length?' · '+esc(x.why.join(', ')):''}</li>`).join('')}</ul></div>`:'';
 return `<div class="secli" data-cmt="${id}"><p style="margin:0"><b>${esc(whoL(c))}</b> <span class="sectags">${esc(srcL(c))}</span>${c.d?` <span class="sectags g">עד ${esc(dShow(c.d))}</span>`:''}</p>
 ${c.prev?`<p class="note" dir="auto" style="margin:4px 0;overflow-wrap:anywhere">"${esc(c.prev)}"</p>`:''}${kindH}
 <label class="note" style="display:block;margin:4px 0">${rem?'על מה להזכיר':'מה לעשות'}<textarea ${F('txt')} maxlength="${rem?120:400}" rows="2" style="width:100%;box-sizing:border-box">${esc(c.txt||'')}</textarea></label>${whoH}
 <label class="note">${rem?'תאריך':'יעד'} <input type="date" ${F('d')} min="${ymd()}" value="${esc(c.d||'')}" style="min-height:40px"></label>${!rem&&!c.d?' <span class="note">בלי יעד – 3 ימי עסקים.</span>':''}
 ${dupH}${c.ref?'<p class="note" style="margin:2px 0">התזכורת נקבעה, אבל הסימון נכשל. לחצו "אישור" שוב.</p>':''}
 <div class="secrow"><button class="chip" style="min-height:44px" data-a="cmtOk" data-id="${id}"${dis}>אישור</button><button class="chip" style="min-height:44px" data-a="cmtNo" data-id="${id}"${dis}>דחייה</button><button class="chip" style="min-height:44px" data-a="cmtSrc" data-id="${id}">ההודעה המקורית</button></div></div>`}

/* מרכז האישורים: מחזיר '' כשאין הצעות (וכשהטעינה עוד לא הסתיימה – כדי לא להבהב) */
root.__secCmtH=()=>{
 if(!M.ld&&!M.b)load();
 if(M.err&&!M.L)return `<div class="sec"><h3>התחייבויות מהודעות</h3></div><div class="card"><p class="note">${esc(M.err)}</p><button class="chip" data-a="cmtRe" style="min-height:44px">נסה שוב</button></div>`;
 const L=(M.L||[]).filter(c=>!c.st);if(!L.length)return '';
 if(L.some(c=>c.kind!=='rem'))prepTasks();
 return `<div class="sec"><h3>התחייבויות מהודעות (${L.length})</h3></div><div class="card"><p class="note" style="margin:0 0 6px">גיטי זיהתה התחייבות בהודעה. שום דבר לא נוצר עד שתאשרו – אפשר לערוך לפני האישור.</p>${L.map(cardH).join('')}</div>`};
root.__secCmtN=()=>(M.L||[]).filter(c=>!c.st).length;
ACT.cmtRe=()=>{M.L=null;M.err='';M.ld=0;load();re()};
{const t0=ACT.secTab;if(typeof t0==='function')ACT.secTab=el=>{if(el&&el.dataset&&el.dataset.v==='appr'){M.ld=0;M.err=''}return t0(el)}}

/* עריכה – נשמר בכרטיס; טקסט/תאריך בלי ציור מחדש (שלחיצה על "אישור" מיד אחרי הקלדה לא תאבד) */
CHG.cmtF=el=>{const c=byId(el.dataset.id);if(!c||c.st||c.busy)return;const f=el.dataset.f;
 if(f==='txt')c.txt=String(el.value||'').trim().slice(0,c.kind==='rem'?120:400);
 else if(f==='d')c.d=/^\d{4}-\d{2}-\d{2}$/.test(el.value)?el.value:'';
 else if(f==='to'){const u=el.dataset.u,z=(typeof TKST!=='undefined'&&Array.isArray(TKST.L)?TKST.L:[]).find(x=>x.uid===u);c.to=(c.to||[]).filter(x=>x.uid!==u);if(el.checked&&z)c.to.push({uid:z.uid,name:z.name});re()}
 else if(f==='all'){c.all=!!el.checked;re()}
 else if(f==='kind'){c.kind=el.value==='rem'?'rem':'task';if(c.kind==='rem')c.txt=String(c.txt||'').slice(0,120);re()}};
function sync(c,box){if(!box)return;const v=f=>box.querySelector(`[data-c=cmtF][data-f=${f}]`);let e;
 if((e=v('txt')))c.txt=String(e.value||'').trim().slice(0,c.kind==='rem'?120:400);
 if((e=v('d')))c.d=/^\d{4}-\d{2}-\d{2}$/.test(e.value)?e.value:''}
async function mark(c,st,kind){return fnCall('secPrefs',Object.assign({op:'cmt',cid:c.cid,st},kind?{kind}:{}))}
function done(c,st){c.st=st;c.busy=0;re()}
const STL={ok:'ההצעה כבר אושרה',no:'ההצעה כבר נדחתה'};
/* תפיסה בשרת לפני יצירה: רק אם ההצעה עדיין ממתינה (או בתפיסה שלי) נוצרת משימה / תזכורת. אחרת – לא יוצרים כלום */
async function claim(c){try{const r=await mark(c,'claim');if(r&&r.already){done(c,r.st||'ok');toast(STL[r.st]||'ההצעה כבר הוכרעה');return false}return true}
 catch(e){c.busy=0;re();if(e&&e.reason==='not-found'){done(c,'gone');toast('ההצעה כבר לא קיימת')}else toast(e&&e.message||'הפעולה נכשלה');return false}}
/* סיום אחרי יצירה: אם השרת עונה שההצעה כבר נדחתה (למשל התפיסה פגה בזמן שחלון "לקבוע בכל זאת?" היה פתוח) –
   מבטלים את מה שנוצר עכשיו (undo: מחיקת tasks/sec<cid> לפי החוקים, או secCal op:'del' לתזכורת) ואומרים זאת בבירור */
async function fin(c,kind,undo){const r=await mark(c,'ok',kind);if(!(r&&r.already&&r.st!=='ok'))return true;
 let u=1;try{await undo()}catch(e){u=0}c.ref='';done(c,r.st);
 toast((STL[r.st]||'ההצעה כבר הוכרעה')+(u?(kind==='rem'?' – התזכורת שנוצרה בוטלה':' – המשימה שנוצרה נמחקה'):(kind==='rem'?' – לא הצלחתי לבטל את התזכורת, מחקו אותה ביומן':' – לא הצלחתי למחוק את המשימה, מחקו אותה במסך המשימות')));
 try{if(kind!=='rem'&&typeof tkLoad==='function')tkLoad()}catch(e){}return false}
/* 24.11.2026 (גיטי סבב 4, החלטות המשתמש 1–2): "אישור התחייבות" מוגדר "לבד" אצל המנהל הזה (השרת מחזיר auto רק כש"עצור הכל" כבוי) –
   הצעה עם תאריך נקבעת לבד כתזכורת למנהל (אותה זרימה: תפיסה → secCal → סימון; השרת בודק את ההרשאות בכל שלב). בלי תאריך – נשארת לאישור.
   עד AUTO_N בכל טעינה, וכל הצעה פעם אחת בלבד בדף הזה */
const AUTO_N=5,tried=new Set();
async function autoRun(){if(!M.auto)return;let n=0;
 for(const c of (M.L||[]).filter(x=>!x.st&&!x.busy&&x.d&&!tried.has(x.cid))){if(n>=AUTO_N)break;n++;tried.add(c.cid);c.kind='rem';c.txt=String(c.txt||c.what||'').slice(0,120);
  try{await okRem(c,true,true)}catch(e){}}}
root.__secCmtAuto=()=>{M.L=null;M.ld=0;load()};/* מ-sec-perm.js: אחרי תשובה "לבד" לשאלה הראשונה – טעינה מחדש (השרת יחזיר auto) */
async function okRem(c,force,quiet){c.busy=1;re();
 if(!c.ref&&!(await claim(c)))return;
 try{if(!c.ref){const d={op:'add',title:c.txt.slice(0,120),d:c.d,rem:true,cid:c.cid};if(force)d.force=true;
   const r=await fnCall('secCal',d);
   if(r&&r.ok===false&&r.warn){c.busy=0;re();return ask('התאריך נופל ב'+r.warn.kind+'. לקבוע את התזכורת בכל זאת?',()=>okRem(c,true),'כן, לקבוע')}
   c.ref=r&&r.id||'sec'+c.cid}
  if(!(await fin(c,'rem',()=>fnCall('secCal',{op:'del',id:'sec'+c.cid}))))return;c.ref='';done(c,'ok');toast(quiet?'✓ גיטי קבעה לבד תזכורת מהתחייבות':'✓ התזכורת נקבעה')}
 catch(e){c.busy=0;toast(c.ref?'התזכורת נקבעה, אבל הסימון נכשל. לחצו "אישור" שוב':(e&&e.message)||'הקביעה נכשלה');re()}}
ACT.cmtOk=async el=>{const c=byId(el.dataset.id);if(!c||c.st||c.busy)return;sync(c,el.closest('[data-cmt]'));
 if(!c.txt)return toast(c.kind==='rem'?'כתבו על מה להזכיר':'כתבו מה צריך לעשות');
 if(c.kind==='rem'){if(!c.d)return toast('בחרו תאריך לתזכורת');return okRem(c,false)}
 const k=cx();if(!cxOk()||!k)return toast('אי אפשר לפתוח משימה כאן. אפשר לבחור "תזכורת לי"');
 if(!c.all&&!(c.to||[]).length)return toast('סמנו למי המשימה, או "כל העובדים"');
 c.busy=1;re();
 try{const rv=await k.rvNow();
  if(!(await claim(c)))return;/* תפיסה (או רענון התפיסה) ממש לפני היצירה */
  /* קישור להודעה המקורית: בטקסט המשימה (מקור), ובתפריט המשימה – "ההודעה המקורית" (מזהה seccm…) */
  const txt=(c.txt+' · מקור: '+srcL(c)).slice(0,500);
  const r=await k.create({id:c.cid,txt,all:!!c.all,to:c.to||[],due:dueOf(c),pri:'',rv});
  try{if(!(await fin(c,'task',()=>fsx('/tasks/sec'+c.cid,{method:'DELETE'}))))return}catch(e){c.busy=0;re();return toast('המשימה נפתחה, אבל הסימון נכשל. לחצו "אישור" שוב (לא תיפתח משימה נוספת)')}
  done(c,'ok');toast(r&&r.dup?'✓ המשימה כבר נפתחה':'✓ המשימה נפתחה'+(r&&r.dlL?', יעד: '+r.dlL:''));try{if(typeof tkLoad==='function')tkLoad()}catch(e){}}
 catch(e){c.busy=0;re();toast(e&&e.cx||(typeof tkErr==='function'?tkErr(e):'פתיחת המשימה נכשלה'))}};
ACT.cmtNo=async el=>{const c=byId(el.dataset.id);if(!c||c.st||c.busy)return;if(c.ref)return toast('התזכורת כבר נקבעה. לחצו "אישור" כדי לסיים');
 c.busy=1;re();try{const r=await mark(c,'no');if(r&&r.already){done(c,r.st);return toast(STL[r.st]||'ההצעה כבר הוכרעה')}done(c,'no');toast('ההצעה נדחתה')}catch(e){c.busy=0;re();toast(e&&e.message||'הפעולה נכשלה')}};
/* פתיחת ההודעה המקורית במסך הקיים שלה (sec-comm.js) */
function openSrc(ch,ref){if(typeof root.__secCommOpen!=='function')return toast('המסך הזה לא זמין');root.__secCommOpen({ch,ref})}
ACT.cmtSrc=el=>{const c=byId(el.dataset.id);if(!c)return toast('ההצעה כבר לא ברשימה');openSrc(c.ch,c.ref)};
/* מתפריט המשימה (tasks-wc.js): data-id = מזהה המשימה seccm… */
ACT.tkwSrc=async el=>{const tid=String(el&&el.dataset&&el.dataset.id||''),cid=tid.replace(/^sec/,'');if(!/^cm[0-9a-f]{16}$/.test(cid))return toast('אין הודעה מקורית למשימה הזו');
 try{const r=await fnCall('secComm',{op:'src',cid});if(cur().v!=='sec')go('sec');openSrc(r.ch,r.ref)}catch(e){toast(e&&e.reason==='not-found'?'ההודעה המקורית לא נמצאה':(e&&e.message)||'לא הצלחתי לפתוח')}};

/* הגדרות המזכירה: המתג */
root.__secCmtSetH=()=>{const s=X.st&&X.st.cmt;if(!s)return '';
 return `<div class="card" id="secCmtSet" style="margin-top:8px"><b>זיהוי התחייבויות בהודעות</b>
 <p class="note" style="margin:4px 0 8px">כשפעיל, גיטי בודקת הודעות חדשות במייל, בווצאפ העסקי ובקבוצות שפתוחות לה, ומציעה במרכז האישורים משימה או תזכורת כשמישהו מתחייב ("אחזור אליך מחר"). שום דבר לא נוצר בלי אישור. נספר בתקרת העלות של המזכירה, ועד 100 בדיקות ביום. התראות מהטלפון לא נבדקות.</p>
 <label class="chip" style="min-height:44px;width:100%;justify-content:flex-start"><input type="checkbox" data-c="cmtOn"${s.on?' checked':''}${s.edit?'':' disabled'}> פעיל</label>${s.edit?'':'<p class="note" style="margin:6px 0 0">רק מנהל בלי הגבלת סניפים יכול לשנות.</p>'}</div>`};
CHG.cmtOn=async el=>{const on=!!el.checked;el.disabled=true;
 try{await fnCall('secPrefs',{op:'cmtOn',on});if(X.st&&X.st.cmt)X.st.cmt.on=on;toast(on?'✓ זיהוי ההתחייבויות פעיל':'✓ זיהוי ההתחייבויות כבוי')}
 catch(e){el.checked=!on;toast(e&&e.message||'השמירה נכשלה')}
 finally{el.disabled=!(X.st&&X.st.cmt&&X.st.cmt.edit)}};
})(typeof window!=='undefined'?window:this);
