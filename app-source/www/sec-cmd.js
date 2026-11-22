/* המזכירה – פקודות משימה בתוך האפליקציה, בלי AI ובלי שרת (22.11.2026, החלטת בעל הפרויקט).
   כאן רק לוגיקה טהורה (בלי DOM ובלי רשת), כדי שאפשר יהיה לבדוק אותה ב-node: פענוח טקסט, תאריכים בעברית, התאמת שם עובד, התאמת משימה לפי מילים.
   הביצוע עצמו (כרטיסי אישור, כתיבה ל-tasks) – ב-secretary.js.
   כלל זהירות: מה שלא מזוהה בוודאות מחזיר null וממשיך לזרימה הרגילה (ה-AI בשרת). עדיף לפספס פקודה מאשר לתפוס שאלה רגילה.
   תאריכים: "now" = רכיבי היום והשעה בשעון ישראל {y,m(0-11),d,h,n,dow(0=ראשון)}; היעד מוחזר כרכיבים {y,m,d,h,n} – ההמרה לזמן נעשית אצל הקורא (tkIL.at). */
(function(root){
'use strict';
const NIQ=/[֑-ׇ]/g;
/* טקסט לפענוח: בלי ניקוד, מקף עברי → מקף, רווחים אחידים, מירכאות עבריות → רגילות */
const norm=s=>String(s==null?'':s).replace(NIQ,'').replace(/[־‐-—]/g,'-').replace(/[״“”]/g,'"').replace(/[׳‘’`]/g,"'").replace(/\s+/g,' ').trim();
/* מפתח להשוואת שמות: רק אותיות וספרות, בלי ניקוד, גרש ורווחים */
const key=s=>norm(s).toLowerCase().replace(/[^0-9a-zא-ת]/g,'');
/* כתיב מלא/חסר: בלי ו' וי' (חוץ מהאות הראשונה), ה/א בסוף אחידות */
const loose=s=>{const k=key(s);return k?k[0]+k.slice(1).replace(/[וי]/g,'').replace(/[הא]$/,''):''};
const clean=t=>String(t||'').replace(/^[\s"'(\[,.:;!?-]+|[\s"')\],.:;!?-]+$/g,'');
const toks=s=>norm(s).split(' ').filter(Boolean);
const B='(^|\\s)',E='(?=$|[\\s,.!?:;)])';

/* ---------- זמן ---------- */
const DAYS=['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
const DW=['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳'];
const p2=n=>String(n).padStart(2,'0');
const ymd=(y,m,d)=>{const x=new Date(Date.UTC(y,m,d));return{y:x.getUTCFullYear(),m:x.getUTCMonth(),d:x.getUTCDate(),dow:x.getUTCDay()}};
const dayAdd=(now,k)=>ymd(now.y,now.m,now.d+k);
const cmp=(a,b)=>Date.UTC(a.y,a.m,a.d,a.h||0,a.n||0)-Date.UTC(b.y,b.m,b.d,b.h||0,b.n||0);
const dayDiff=(a,b)=>Math.round((Date.UTC(a.y,a.m,a.d)-Date.UTC(b.y,b.m,b.d))/864e5);
/* תווית קצרה: "היום 23:59" / "מחר 10:00" / "יום ה׳ 27/11 23:59" */
function label(due,now){if(!due)return '';const k=dayDiff(due,now),hm=p2(due.h)+':'+p2(due.n);
 if(k===0)return 'היום '+hm;if(k===1)return 'מחר '+hm;if(k===-1)return 'אתמול '+hm;
 return 'יום '+DW[ymd(due.y,due.m,due.d).dow]+' '+due.d+'/'+(due.m+1)+(due.y!==now.y?'/'+due.y:'')+' '+hm}
/* שעה בלי דקות 1–6 = אחר הצהריים (הנחה: "ב-5" בעסק = 17:00) */
const hr=(h,mn)=>{h=+h;const n=mn==null?0:+mn;if(!(h>=0&&h<=23&&n>=0&&n<=59))return null;if(mn==null&&h>=1&&h<=6)h+=12;return{h,n}};

/* מוצא יעד בטקסט ומחזיר את הטקסט בלעדיו.
   נתמך: היום/הערב, מחר, מחרתיים, יום ראשון..שבת (הקרוב/הבא), "עד DD/MM(/YY)", "בעוד N ימים"/יומיים/שבוע, "תוך …",
   שעה: "ב-10", "בשעה 10:30", "עד השעה 14", "ב10:30", ואחרי יום: בבוקר (09:00) / בצהריים (12:00) / בערב (18:00).
   אותו יום בשבוע כמו היום = השבוע הבא (הנחה). יעד שעבר או יותר משנה קדימה – err. */
function parseDue(s,now){let t=' '+norm(s)+' ',day=null,tm=null,err='';
 const cut=(re,f)=>{const m=re.exec(t);if(!m)return false;const r=f(m);if(r===false)return false;t=t.slice(0,m.index)+' '+t.slice(m.index+m[0].length);return true};
 const pre='(?:עד\\s+(?:ה-?|ל-?)?|ב-?|ל-?|ליום\\s+)?';
 cut(new RegExp(B+pre+'(\\d{1,2})[/.](\\d{1,2})(?:[/.](\\d{2,4}))?'+E),m=>{const d=+m[2],mo=+m[3]-1;let y=m[4]?+m[4]:now.y;if(y<100)y+=2000;
  const x=ymd(y,mo,d);if(mo<0||mo>11||x.d!==d||x.m!==mo)return false;day={y:x.y,m:x.m,d:x.d};if(!m[4]&&dayDiff(day,now)<0)day={y:y+1,m:mo,d};return true})
 ||cut(new RegExp(B+'(?:עד\\s+|ל|תוך\\s+)?(?:ה)?מחרתיים'+E),()=>{day=dayAdd(now,2)})
 ||cut(new RegExp(B+'(?:עד\\s+|ל)?מחר'+E),()=>{day=dayAdd(now,1)})
 ||cut(new RegExp(B+'(?:עד\\s+|ל|כבר\\s+)?(?:היום|הערב)'+E),m=>{day=dayAdd(now,0);if(/הערב/.test(m[0]))tm={h:20,n:0}})
 ||cut(new RegExp(B+'(?:בעוד|תוך|עוד)\\s+(?:(\\d{1,3})\\s+ימים|(יומיים)|(יום)|(שבוע)|(שבועיים))'+E),m=>{const k=m[2]?+m[2]:m[3]?2:m[4]?1:m[5]?7:14;if(k<1||k>366)return false;day=dayAdd(now,k)})
 ||cut(new RegExp(B+'(?:עד\\s+(?:יום\\s+)?|ביום\\s+|ליום\\s+|יום\\s+|ב(?=(?:רביעי|חמישי|שישי|שבת)'+E+'))('+DAYS.join('|')+')(?:\\s+(הקרוב|הבא|הזה|הבעל|הזאת))?'+E),m=>{const w=DAYS.indexOf(m[2]);let k=(w-now.dow+7)%7;if(k===0)k=7;day=dayAdd(now,k)});
 cut(new RegExp(B+'(?:בשעה|עד\\s+השעה|עד\\s+שעה|ב-|ב־)\\s*(\\d{1,2})(?::(\\d{2}))?'+E),m=>{const x=hr(m[2],m[3]);if(!x)return false;tm=x})
 ||cut(new RegExp(B+'ב(\\d{1,2}):(\\d{2})'+E),m=>{const x=hr(m[2],m[3]);if(!x)return false;tm=x})
 ||(day&&cut(new RegExp(B+'(בבוקר|בצהריים|בצהרים|בערב)'+E),m=>{tm=/בוקר/.test(m[2])?{h:9,n:0}:/צהר/.test(m[2])?{h:12,n:0}:{h:18,n:0}}));
 const rest=t.replace(/\s+/g,' ').trim();
 if(!day&&!tm)return{due:null,rest,err:''};
 if(!day){day=dayAdd(now,0);if(cmp(Object.assign({},day,tm),now)<=0)day=dayAdd(now,1)}
 const due={y:day.y,m:day.m,d:day.d,h:tm?tm.h:23,n:tm?tm.n:59};
 if(cmp(due,now)<=0)err='past';else if(dayDiff(due,now)>366)err='far';
 return{due,rest,err}}

/* ---------- עדיפות ---------- */
function parsePri(s){let t=' '+norm(s)+' ',pri='';
 const no=new RegExp(B+'(?:לא\\s+(?:דחוף|דחופה)|בלי\\s+לחץ)'+E);if(no.test(t))t=t.replace(no,' ');
 const re=new RegExp(B+'(?:דחוף|דחופה|בדחיפות|דחוף!|עדיפות\\s+גבוהה|בעדיפות\\s+גבוהה)'+E,'g');if(re.test(t)){pri='h';t=t.replace(re,' ')}
 return{pri,rest:t.replace(/\s+/g,' ').trim()}}

/* ---------- עובדים ---------- */
const PRON=new Set(['לי','לנו','לך','לכם','לכן','לו','לה','להם','להן','ממני','ממנו','ממנה','מהם','לעצמי']);
const GEN=new Set(['עובד','עובדת','עובדים','עובדות','מישהו','מישהי','מי']);
const ALLW=[['כל','העובדים'],['כל','הצוות'],['כל','העובדות'],['כולם'],['כולן'],['הצוות'],['צוות']];
/* התאמת מחרוזת שם לרשימת העובדים: שם מלא, שם פרטי, שם משפחה, תחילת המייל; אחר כך כתיב מלא/חסר */
function matchStaff(nm,staff){const k=key(nm);if(!k||!Array.isArray(staff))return[];
 const ex=staff.filter(s=>{const n=norm(s&&s.name);if(!n)return false;return key(n)===k||n.split(' ').some(w=>key(w)===k)||(s.em&&key(s.em)===k)});
 if(ex.length)return ex;const l=loose(nm);if(l.length<2)return[];
 return staff.filter(s=>{const n=norm(s&&s.name);return !!n&&(loose(n)===l||n.split(' ').some(w=>loose(w)===l))})}
/* טוקן עם תחילית (ל / ול / ו / מ): מנסים קודם בלי התחילית ואז כמו שהוא. שם של שתי מילים – קודם */
function nameAt(T,i,staff,pfx){const out=[];
 for(const two of [1,0]){if(two&&i+1>=T.length)continue;const raw=two?clean(T[i])+' '+clean(T[i+1]):clean(T[i]);
  const tries=[];const m=new RegExp('^(?:'+pfx+')(.+)$').exec(raw);if(m)tries.push(m[1]);tries.push(raw);
  for(const x of tries){const r=matchStaff(x,staff);if(r.length)return{list:r,n:two?2:1,nm:x}}if(!two)out.push(m?m[1]:raw)}
 return{list:[],n:1,nm:out[0]||''}}
function allAt(T,i){for(const w of ALLW){const a=clean(T[i]||'').replace(/^ו?ל/,'');if(a!==w[0]&&!(w.length===1&&a===w[0]))continue;
  if(w.length===1){if(a===w[0])return 1;continue}if(clean(T[i+1]||'')===w[1])return 2}return 0}

/* ---------- זיהוי כוונה ---------- */
const VC=new Set(['פתחי','פתח','תפתחי','תפתח','צרי','צור','תצרי','תיצרי','תצור','הוסיפי','הוסף','תוסיפי','תוסיף','רשמי','רשום','תרשמי','תרשום','קבעי','קבע','תקבעי']);
const VI=new Set(['לפתוח','ליצור','להוסיף','לרשום','לקבוע']);/* רק אחרי "אפשר" / "תוכלי" */
const VA=new Set(['תני','תן','תתני','תתן','תגידי','תגיד','תבקשי','תבקש','בקשי','בקש','שלחי','שלח','תשלחי','תשלח']);
const VR=new Set(['תזכירי','הזכירי','תזכיר','הזכר','הזכירו']);
const VM=new Set(['תעבירי','העבירי','תעביר','העבר','העבירו']);
const POL=/^(?:(?:בבקשה|אנא|תודה|היי|הי|שלום)[,!]?\s+)+/;
const POL2=/^(?:אפשר|תוכלי|תוכל|את\s+יכולה|אתה\s+יכול|אני\s+רוצה\s+ש(?:ת)?|רציתי\s+ש)\s+/;
const isTaskW=w=>/^משימה[:,.!]?$/.test(w)||/^משימה-/.test(w);
/* מעקב: התאמה מלאה בלבד (שאלה עם פרטים נוספים – לזרימה הרגילה) */
const QW='(?:מה|אילו|איזה|איזו|אלו|כמה)';
const TRK=[
 ['late',new RegExp('^(?:'+QW+'\\s+)?(?:(?:ה)?משימות\\s+)?(?:יש\\s+|נמצאות\\s+|שנמצאות\\s+|הן\\s+|ש)?(?:ב)?(?:איחור|מאחרות|באיחור)(?:\\s+(?:במשימות|כרגע|עכשיו|היום))?$')],
 ['late',new RegExp('^(?:'+QW+'\\s+)?(?:ה)?משימות\\s+(?:ש)?עבר\\s+(?:להן\\s+|להם\\s+)?(?:ה)?(?:זמן|יעד)$')],
 ['wait',new RegExp('^(?:'+QW+'\\s+)?(?:(?:ה)?משימות\\s+)?(?:יש\\s+)?(?:ש)?(?:ממתין|ממתינה|ממתינות|ממתינים|מחכה|מחכות|מחכים)\\s+(?:לי\\s+)?ל?אישור(?:\\s+שלי)?(?:\\s+במשימות)?$')],
 ['wait',new RegExp('^(?:'+QW+'\\s+)?(?:(?:ה)?משימות\\s+)?(?:יש\\s+)?(?:ש)?לאישור(?:\\s+שלי)?(?:\\s+במשימות)?$')],
 ['status',/^(?:מה\s+)?(?:ה)?(?:מצב|סטטוס|תמונת\s+מצב|תמונת\s+המצב)\s+(?:של\s+)?(?:ה)?משימות(?:\s+(?:היום|עכשיו|כרגע|בעסק|של\s+העובדים))?$/],
 ['status',/^איך\s+(?:אנחנו\s+עם|עומדים\s+עם|עומדות)\s+(?:ה)?משימות(?:\s+(?:היום|עכשיו))?$/],
 ['lag',/^מי\s+(?:לא\s+עומד|לא\s+עומדת|לא\s+עומדים|לא\s+עומדות|הכי\s+מאחר|מאחר|מאחרת|מאחרים|מתעכב|מתעכבים)(?:\s+הכי\s+הרבה)?\s+(?:ב(?:ה)?משימות|ביעדי\s+המשימות|בזמני\s+המשימות)$/],
 ['today',new RegExp('^(?:'+QW+'\\s+)?(?:ה)?משימות\\s+(?:יש\\s+)?(?:ל|של\\s+)?היום$')],
 ['today',/^מה\s+(?:יש\s+)?במשימות\s+(?:ל)?היום$/],
 ['urg',new RegExp('^(?:'+QW+'\\s+)?(?:ה)?משימות\\s+(?:ה)?דחופות(?:\\s+(?:יש|היום|עכשיו))?$')],
 ['urg',/^מה\s+דחוף\s+במשימות$/]];
/* שאלה נקייה לבדיקת מעקב: בלי פנייה מנומסת בהתחלה ובלי סימני פיסוק בסוף */
const trkClean=s=>norm(s).replace(/^(?:(?:תגידי\s+לי|תגיד\s+לי|תראי\s+לי|הראי\s+לי|תני\s+לי|בבקשה|אפשר\s+לדעת|אני\s+רוצה\s+לדעת|רציתי\s+לדעת)[,]?\s+)+/,'').replace(/\s+בבקשה$/,'').replace(/[\s?!.,]+$/,'').replace(/^[\s,]+/,'').replace(/\s+/g,' ').trim();

/* כוונה בלי רשימת עובדים (זול – נבדק על כל הודעה): 'new' | 'nd' | 'mv' | מעקב | null */
function intent(text){const t0=norm(text);if(!t0||t0.length>400)return null;
 const q=trkClean(t0);for(const[k,re]of TRK)if(re.test(q))return k;
 let s=t0.replace(POL,'');let T=toks(s).map(w=>w.toLowerCase());if(!T.length)return null;
 let w0=clean(T[0]),pol=false;const pm=POL2.exec(s);if(pm){pol=true;T=toks(s.slice(pm[0].length));w0=clean(T[0]||'')}
 const hasTask=T.some(isTaskW),hasTaskAny=T.some(w=>/^(?:ה|את\s?ה)?משימה[:,.!]?$/.test(clean(w))||/^המשימה/.test(clean(w)));
 if(VR.has(w0)){if(!hasTaskAny)return null;if(PRON.has(clean(T[1]||'')))return null;return 'nd'}
 if(VM.has(w0)||(pol&&(w0==='להעביר'))){return hasTaskAny?'mv':null}
 if((VC.has(w0)||(pol&&VI.has(w0))||VA.has(w0))&&hasTask)return 'new';
 if(/^משימה[:]?$/.test(w0)&&!/\?\s*$/.test(t0))return 'new';
 /* בלי המילה "משימה": רק "תני/תגידי/תבקשי ל<עובד> ל<פועל>…" (לא "שלחי" – שליחת הודעות נשארת למזכירה) */
 if(VA.has(w0)&&!/^(?:שלחי|שלח|תשלחי|תשלח)$/.test(w0)){const a=clean(T[1]||''),b=clean(T[2]||'');if(a.length>=3&&/^[למ]/.test(a)&&!PRON.has(a)&&/^[לש]\S{2,}/.test(b))return 'new?'}
 return null}

/* ---------- יצירת משימה ---------- */
function bodyOf(s,now){const d=parseDue(s,now),p=parsePri(d.rest);
 let txt=p.rest.replace(/^[\s:,\-–]+/,'').replace(/^(?:ש|את|על)\s+/,'').replace(/[\s:,\-–]+$/,'').trim();
 return{txt:txt.slice(0,500),due:d.due,err:d.err,pri:p.pri}}
/* פענוח מלא. o = {staff:[{uid,name,em}], now}.
   מחזיר null (לא פקודה) או:
   {k:'new', all, to:[staff], amb:{nm,list}|null, unk:'שם'|'', txt, due, err, pri}
   {k:'nd'|'mv', to:[staff], amb, unk, q:[מילות חיפוש]}  ·  {k:'late'|'wait'|'status'|'lag'|'today'|'urg'} */
function parse(text,o){o=o||{};const staff=Array.isArray(o.staff)?o.staff:[],now=o.now;const k0=intent(text);if(!k0)return null;
 if(['late','wait','status','lag','today','urg'].includes(k0))return{k:k0};
 let s=norm(text).replace(POL,'');const pm=POL2.exec(s);if(pm)s=s.slice(pm[0].length);
 const T=toks(s);let i=1;
 if(k0==='nd'||k0==='mv')return refOf(k0,T,staff);
 /* יצירה */
 const r={k:'new',all:false,to:[],amb:null,unk:'',txt:'',due:null,err:'',pri:''};
 const req=/^(?:תבקשי|תבקש|בקשי|בקש)$/.test(clean(T[0]));const pfx=req?'ומ|מ|ול|ל|ו':'ול|ל|ו';
 if(/^משימה/.test(clean(T[0])))i=0;
 const used=new Set([0]);const tI=T.findIndex(isTaskW);if(tI>=0){used.add(tI);if(clean(T[tI+1]||'')==='חדשה')used.add(tI+1)}
 /* חיפוש נמען: בטוקנים הראשונים (עד 4 אחרי הפועל / אחרי "משימה") */
 const lim=Math.min(T.length,Math.max(tI,0)+5);let found=-1;
 for(let j=i;j<lim;j++){if(used.has(j))continue;const w=clean(T[j]);
  const al=allAt(T,j);if(al&&/^(?:ו?ל|כ)/.test(T[j])){r.all=true;used.add(j);if(al===2)used.add(j+1);found=j;break}
  if(!/^(?:ו?ל|מ)/.test(w))continue;if(req?false:/^מ/.test(w)&&!/^ל/.test(w))continue;
  const g=/^ו?ל/.test(w)?w.replace(/^ו?ל/,''):w.replace(/^מ/,'');if(GEN.has(g)){used.add(j);found=j;break}
  if(PRON.has(w)){used.add(j);found=j;break}
  const m=nameAt(T,j,staff,pfx);
  if(m.list.length){for(let z=0;z<m.n;z++)used.add(j+z);if(m.list.length>1)r.amb={nm:m.nm,list:m.list};else r.to=m.list.slice();found=j;
   /* נמענים נוספים: "ולשרה" / "ושרה" / "ו-לשרה" */
   let n=j+m.n;while(n<T.length&&/^ו/.test(clean(T[n]))){const m2=nameAt(T,n,staff,'ול|ו');if(!m2.list.length||m2.list.length>1)break;m2.list.forEach(x=>{if(!r.to.some(y=>y.uid===x.uid))r.to.push(x)});for(let z=0;z<m2.n;z++)used.add(n+z);n+=m2.n}
   break}
  /* "ל…" שלא תואם עובד: שם לא מוכר – רק כשהמבנה ברור (לפני "משימה", או כשאחריו עוד "ל…"/סוף/נקודתיים) */
  const nx=clean(T[j+1]||''),before=tI<0||j<tI;
  if(/^ל/.test(w)&&(before&&j===i||/:$/.test(T[j])||(tI>=0&&j===tI+1&&(!nx||/^ל\S{2,}/.test(nx)))||(tI<0&&j===1&&/^ל\S{2,}/.test(nx)))){used.add(j);r.unk=g||w;found=j;break}
 }
 if(k0==='new?'&&!r.to.length&&!r.amb&&!r.all&&!r.unk)return null;
 const rest=T.filter((w,j)=>!used.has(j)).join(' ');
 const b=bodyOf(rest,now);Object.assign(r,{txt:b.txt,due:b.due,err:b.err,pri:b.pri});
 return r}

/* "הזכירי לדני על המשימה של המחסן" / "תעבירי את המשימה של המחסן לשרה" */
const STOP=new Set(['של','על','את','לגבי','בקשר','עם','זה','זו','הזו','הזאת','שוב','בבקשה','כבר','עוד','ה','אל','לו','לה','המשימה','משימה','משימות','המשימות','שלו','שלה','תזכורת','ש','גם','בעניין','לעובד','לעובדת']);
function refOf(k,T,staff){const r={k,to:[],amb:null,unk:'',q:[]};const used=new Set([0]);
 if(clean(T[1]||'')==='תזכורת')used.add(1);
 const cand=[];T.forEach((w,j)=>{if(j===0)return;const c=clean(w);if(/^ו?ל\S{2,}/.test(c)&&!PRON.has(c))cand.push(j)});
 /* בתזכורת – הנמען בתחילת המשפט; בהעברה – היעד בסוף (או מיד אחרי הפועל) */
 const order=k==='mv'?cand.slice().reverse():cand;
 for(const j of order){const m=nameAt(T,j,staff,'ול|ל');if(m.list.length){for(let z=0;z<m.n;z++)used.add(j+z);if(m.list.length>1)r.amb={nm:m.nm,list:m.list};else r.to=m.list.slice();break}}
 if(!r.to.length&&!r.amb&&cand.length){const j=k==='mv'?cand[cand.length-1]:cand[0],w=clean(T[j]),nx=clean(T[j+1]||'');
  if(k==='mv'?j===T.length-1:(j===1&&/^(?:על|לגבי|בקשר|את)$/.test(nx))){r.unk=w.replace(/^ו?ל/,'');used.add(j)}}
 r.q=T.filter((w,j)=>!used.has(j)).map(clean).filter(w=>w&&!STOP.has(w)&&!/^(?:על|את)ה?משימה$/.test(w)).slice(0,8);
 return r}

/* התאמת משימות פתוחות לפי מילים (בטקסט, וגם בשם המטפל/הנמענים). uid – רק משימות של העובד הזה (מטפל או נמען) */
const stem=w=>{const k=key(w);return k.length>3?k.replace(/^(?:וה|וב|ול|ומ|ה|ב|ל|ש|ו|מ|כ)/,''):k};
function matchTasks(q,tasks,o){o=o||{};const L=(Array.isArray(tasks)?tasks:[]).filter(t=>t&&t.st==='open'&&(!o.uid||t.ow===o.uid||((t.to||[]).includes(o.uid)&&!t.ow)));
 const ws=(q||[]).map(stem).filter(w=>w.length>=2);if(!ws.length)return L.slice();
 return L.map(t=>{const hay=key(t.txt)+'|'+key(t.owN)+'|'+(t.toN||[]).map(key).join('|');const sc=ws.filter(w=>hay.includes(w)).length;return{t,sc}}).filter(x=>x.sc>0).sort((a,b)=>b.sc-a.sc||(a.t.cr||0)-(b.t.cr||0)).filter((x,i,a)=>x.sc===a[0].sc).map(x=>x.t)}

const api={norm,key,loose,parseDue,parsePri,matchStaff,intent,parse,body:bodyOf,matchTasks,label,dayAdd,cmp};
if(typeof module==='object'&&module&&module.exports)module.exports=api;else root.SecCmd=api;
})(typeof window!=='undefined'?window:this);
