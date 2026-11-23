/* זיהוי משימה כפולה (23.11.2026, "גיטי מנהלת עסק", סבב 1). פונקציה טהורה, בלי DOM ובלי רשת – נבדקת ב-node (firebase/tests/task-dup.unit.test.js).
   משווה משימה חדשה למשימות פתוחות לפי משמעות: ניקוד, אותיות שימוש בתחילת מילה (ו/ה/ל/ב/ש/כ/מ), ריבוי, מילים נרדפות נפוצות בעסק,
   דמיון מילים, ומשקל לאותו עובד ולתאריך יעד קרוב. מחזירה רק חשד – לעולם לא מוחקת ולא חוסמת (ההחלטה בממשק: "צור בכל זאת" / "פתח את הקיימת"). */
(function(root){
'use strict';
const FIN={'ם':'מ','ן':'נ','ך':'כ','ף':'פ','ץ':'צ'};
const STOP=new Set(['את','של','על','עם','אל','או','גם','כי','מה','אם','זה','זאת','זו','כל','יש','אין','לא','כן','רק','כבר','עוד','בבקשה','נא','תודה','צריך','צריכה','צריכים','צריכות','צריך','לעשות','תעשה','תעשו','היום','מחר','מחרתיים','דחוף','בדחיפות','השבוע','מהר','ללא','בלי','אחרי','לפני','עד','מ','ב','ל','ה','ו','ש','כ','אני','אתה','הוא','היא','אנחנו','הם','הן','אותו','אותה']);
/* קבוצות מילים נרדפות (המילים מוזנות דרך אותו נרמול, ולכן אפשר לכתוב בכל צורה) */
const SYN=[
 ['נקה','ניקוי','ניקיון','לנקות','נקי','לשטוף','שטוף','שטיפה','לנגב','נגב','ניגוב','לטאטא','טאטא','טאטוא','לשפשף'],
 ['הזמן','הזמנה','להזמין','לרכוש','רכישה','רכוש','לקנות','קנה','קניה','קנייה','קניית','לקנות'],
 ['סדר','סידור','לסדר','לארגן','ארגן','ארגון'],
 ['בדוק','בדיקה','לבדוק','לוודא','וודא','וידוא','לאמת','אימות'],
 ['התקשר','להתקשר','טלפון','לטלפן','צלצל','לצלצל','שיחה','לדבר'],
 ['שלח','שליחה','לשלוח','להעביר','העבר'],
 ['תקן','תיקון','לתקן','לתקן','לטפל','טפל','טיפול'],
 ['שלם','תשלום','לשלם','לפרוע','פרע','פירעון'],
 ['ספר','ספירה','לספור','ספור','לספור'],
 ['החזר','להחזיר','החזרה','זיכוי','לזכות'],
 ['הדפס','הדפסה','להדפיס','לצלם','צילום'],
 ['מקרר','מקפיא','פריזר'],
 ['מחסן','מחסנים','אחסון'],
 ['ספק','ספקים','סוחר'],
 ['עובד','עובדים','איש','אנשי'],
 ['חשבונית','חשבוניות','קבלה','קבלות','חשבון'],
 ['מלאי','מלאים','סחורה','סחורות','מוצרים','מוצר']
];
/* מילות "פעולה" כלליות: התאמה רק בהן אינה מספיקה לחשד (צריך גם מילת תוכן משותפת) */
const ACT_GROUPS=new Set([0,1,2,3,4,5,6,7,8,9,10]);
function strip(s){return String(s==null?'':s).replace(/[֑-ׇ]/g,'').replace(/[‎‏‪-‮]/g,'').replace(/["'׳״`´]/g,'').toLowerCase()}
/* גזע מילה: ללא אותיות שימוש בתחילה (עד שתיים, כשנשארות 3 אותיות לפחות) וללא סיומת ריבוי/נקבה */
function stem(w){
 w=strip(w);if(!w)return '';
 if(w.length>=4&&(/^[והלבש]/.test(w)||/^[מכ]ה/.test(w))){const f=w[0];w=w.slice(1);/* שכבה שנייה רק אחרי ו/ש, או "ה" אחרי ב/ל/כ/מ (למשל "והמדפים", "בהזמנה") */if(w.length>=4&&((/[וש]/.test(f)&&/^[הלבכמ]/.test(w))||(/[בלכמ]/.test(f)&&w[0]==='ה')))w=w.slice(1)}
 if(w.length>=5&&/(ים|ות|יות)$/.test(w))w=w.replace(/(יות|ים|ות)$/,'');
 else if(w.length>=4&&/[הת]$/.test(w))w=w.slice(0,-1);
 return w.replace(/[םןךףץ]/g,c=>FIN[c]);
}
const SYNMAP=new Map();
SYN.forEach((g,i)=>g.forEach(w=>{const s=stem(w);if(s&&!SYNMAP.has(s))SYNMAP.set(s,i)}));
/* טוקנים של טקסט: [{k:מפתח להשוואה, g:קבוצה נרדפת או -1, n:מספר?}] */
function tokens(t){
 const raw=strip(t).replace(/[^א-תa-z0-9\s]/g,' ').split(/\s+/).filter(Boolean),out=[];
 raw.forEach(w=>{
  if(STOP.has(w))return;
  if(/^\d+$/.test(w)){out.push({k:'#'+w,g:-1,n:1});return}
  const s=stem(w);if(!s||STOP.has(s)||s.length<2)return;
  const g=SYNMAP.has(s)?SYNMAP.get(s):-1;
  out.push({k:g>=0?'~'+g:s,g,n:0});
 });
 const seen=new Set();return out.filter(x=>!seen.has(x.k)&&seen.add(x.k));
}
const norm=t=>tokens(t).map(x=>x.k).sort().join(' ');
/* ציון דמיון בין שני טקסטים (0..1) + האם יש מילת תוכן משותפת */
function textScore(a,b){
 const A=tokens(a),B=tokens(b);if(!A.length||!B.length)return{s:0,content:false,same:false};
 const kb=new Set(B.map(x=>x.k)),ka=new Set(A.map(x=>x.k));
 const shared=A.filter(x=>kb.has(x.k)),inter=shared.length,uni=new Set(A.map(x=>x.k).concat(B.map(x=>x.k))).size;
 const jac=inter/uni,ov=inter/Math.min(A.length,B.length);
 let s=0.5*jac+0.5*ov;
 /* מספרים שונים (הזמנה 5 / הזמנה 6) – כנראה דברים שונים */
 const na=A.filter(x=>x.n).map(x=>x.k),nb=B.filter(x=>x.n).map(x=>x.k);
 if(na.length&&nb.length&&!na.some(k=>nb.includes(k)))s-=0.35;
 const same=ka.size===kb.size&&[...ka].every(k=>kb.has(k));
 /* מילת תוכן: משותפת, לא מספר, ולא מקבוצת פעולה כללית */
 const content=shared.some(x=>!x.n&&!(x.g>=0&&ACT_GROUPS.has(x.g)));
 return{s:Math.max(0,s),content,same};
}
const DAY=864e5;
/* newTask: {txt, uids:[uid…] (ריק = כל הצוות), dl:ms|0|null}; existing: [{id,txt,st,ow,to:[uid],dl,due}] – רק פתוחות (open/wait) נבדקות.
   מחזירה [{task, score, why:[…]}] ממוין מהחשוד ביותר, עד opts.max (ברירת מחדל 3), סף opts.th (ברירת מחדל 0.62). */
function find(newTask,existing,opts){
 opts=opts||{};const th=opts.th==null?0.62:opts.th,max=opts.max||3;
 const nt=newTask||{},want=new Set((nt.uids||[]).filter(Boolean));
 const res=[];
 (Array.isArray(existing)?existing:[]).forEach(t=>{
  if(!t||(t.st!=='open'&&t.st!=='wait'))return;
  const r=textScore(nt.txt,t.txt);
  if(!r.same&&!r.content)return;
  let s=r.s;const why=[];
  if(r.same)why.push('אותו תוכן');else why.push('תוכן דומה');
  /* אותו עובד */
  const have=new Set((Array.isArray(t.to)&&t.to.length?t.to:(t.ow?[t.ow]:[])).filter(Boolean));
  if(want.size&&have.size){const hit=[...want].some(u=>have.has(u));if(hit){s+=0.1;why.push('אותו עובד')}else{s-=0.15}}
  /* יעד קרוב (עד 36 שעות) */
  const d1=+nt.dl>0?+nt.dl:0,d2=+t.dl>0?+t.dl:(t.dl===0?0:(+t.due>0?+t.due:0));
  if(d1&&d2){if(Math.abs(d1-d2)<=1.5*DAY){s+=0.05;why.push('יעד קרוב')}else if(Math.abs(d1-d2)>7*DAY)s-=0.1}
  if(r.same)s=Math.max(s,0.9);
  if(s>=th)res.push({task:t,score:Math.min(1,Math.round(s*100)/100),why});
 });
 res.sort((a,b)=>b.score-a.score);
 return res.slice(0,max);
}
const API={find,norm,tokens,stem,textScore};
if(typeof module==='object'&&module&&module.exports)module.exports=API;
else root.TaskDup=API;
})(typeof window!=='undefined'?window:this);
