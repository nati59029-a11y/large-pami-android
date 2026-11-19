/* POS:M7 – pos-help.js (קופה, ש7, 17.11.2026). עזרה קצרה בעברית פשוטה (אפיון ד 3.1, H17, U-עזרה).
   window.PosHelp:
     btn(screen)     -> HTML של כפתור "?" (data-a="posHelp" data-s="…") – כל מסך קופה שם אותו בפינה
     open(screen)    חלון עזרה קצר למסך + קישור לסרטון ההדרכה (trainVideo מההגדרות, אם יש)
     guide()         מדריך התקנת ציוד לבעל העסק, צעד אחרי צעד (מדפסת, מגירה, סורק, מסך לקוח, רשת)
     add(screen,{t,items})  מודול אחר מוסיף עזרה למסך שלו
     list()          המסכים שיש להם עזרה
   הסיור המודרך (שלב-שלב על המסך) – לא בגל הזה. ב-Node: require(...)(root). */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory;else root.PosHelp=factory(root)})(typeof self!=='undefined'?self:this,function(root){
'use strict';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const H={
 sale:{t:'מסך המכירה',items:['סורקים מוצר או לוחצים על אריח – הוא נכנס לעגלה.','לא מוצאים? מקלידים בחיפוש חלק מהשם או מהמספר.','הנקודה הכתומה בפינה = אין אינטרנט. אפשר להמשיך למכור במזומן. המכירות יישלחו לבד כשהרשת תחזור.','✓ ליד מכירה = נשמרה בענן. ⏳ = מחכה לשליחה.','כבה המכשיר באמצע? בהדלקה לוחצים "המשך מכירה שנקטעה".']},
 pay:{t:'תשלום',items:['בוחרים אמצעי תשלום ומקלידים את הסכום שהתקבל.','במזומן המגירה נפתחת לבד בסוף.','אפשר לשלם בכמה אמצעים: כל תשלום נרשם בנפרד עד שהיתרה 0.','לא מקלידים כאן מספר כרטיס אשראי – רק את מספר האישור מהמסוף.']},
 ret:{t:'החזרה',items:['סורקים את הברקוד שעל הקבלה.','בוחרים מה מוחזר ולמה.','החזרה אפשרית רק כשיש אינטרנט.']},
 print:{t:'הדפסה',items:['נגמר הנייר? המכירה כבר שמורה. מחליפים גליל ולוחצים "הדפס שוב".','"המדפסת לא מחוברת" – בודקים שהכבל מחובר ושהמדפסת דלוקה, ולוחצים "הדפס שוב".','הקבלות שממתינות להדפסה לא הולכות לאיבוד.']},
 z:{t:'סגירת יום',items:['סופרים את הכסף במגירה לפי השטרות והמטבעות.','אם יש הפרש – כותבים הסבר. הפרש גדול מחכה לאישור מנהל בטלפון.','אי אפשר לסגור יום כשיש מכירות שעוד לא נשלחו לענן – מחברים לאינטרנט ומחכים ל-✓.']},
 hw:{t:'ציוד ומכשירים (מנהל)',items:['"בדיקת ציוד" נעשית על המכשיר עצמו: בוחרים מדפסת, מדפיסים קבלת ניסיון, פותחים מגירה וסורקים ברקוד.','"מצב ציוד חי" מראה לכל קופה: מדפסת, נייר, מכירות שממתינות לשליחה וגרסה.','מכשיר חדש לא מוכר לפני אישור. מכשיר שנגנב – "ניתוק מרחוק".']},
 ops:{t:'תפעול: גיבוי, תקלות, התנגשויות (מנהל)',items:['הגיבוי נעשה לבד כל לילה. "גבה עכשיו" – לפני שינוי גדול.','שחזור – רק בעל העסק, עם אישור כפול. מכירות ותשלומים לא נמחקים בשחזור.','יומן התקלות מראה מה קרה, בלי פרטי לקוחות.','מכירה שנרשמה ידנית אחרי תקלה מסומנת "הוזנה ידנית", עם השעה האמיתית והסיבה.']},
 offline:{t:'בלי אינטרנט',items:['אפשר: מכירה במזומן, הדפסת קבלה, חיפוש מוצרים.','אי אפשר: החזרה, תשלום בקישור.','כשיש 20 מכירות שממתינות – כדאי לבדוק את הרשת (נתב גיבוי).']},
};
const GUIDE={t:'התקנת ציוד – מדריך לבעל העסק',steps:[
 ['לפני קנייה','קודם בודקים את הציוד הקיים: מתקינים את האפליקציה על מכשיר אחד ועושים "בדיקת ציוד". קונים רק אם הבדיקה נכשלה.'],
 ['מדפסת קבלות (USB)','מחברים את המדפסת למכשיר בכבל USB (במכשיר קטן – מתאם OTG). כשאנדרואיד שואל "לפתוח את לארג׳ פעמי?" – מסמנים "תמיד" ולוחצים אישור. באזור הניהול ← ציוד ומכשירים ← בדיקת ציוד ← "חיפוש מדפסות" ← בוחרים אותה.'],
 ['רוחב נייר','80 מ"מ (ברירת המחדל) או 58 מ"מ – בוחרים בחלון בדיקת הציוד, ומדפיסים קבלת ניסיון: הטקסט לא צריך להיחתך בצדדים.'],
 ['מדפסת בלוטות׳ או רשת','בלוטות׳: קודם מצמידים את המדפסת בהגדרות הבלוטות׳ של הטלפון. רשת: כותבים את כתובת ה-IP של המדפסת (מודפסת בדף הבדיקה של המדפסת), פורט 9100.'],
 ['מגירת כסף','מחברים את כבל המגירה לשקע DK שבגב המדפסת (לא למכשיר). "פתיחת מגירה" בבדיקת הציוד. לא נפתחת? מנסים "פין 5".'],
 ['סורק ברקודים','מחברים בכבל USB. אין צורך בהגדרה. סורקים ברקוד כשחלון בדיקת הציוד פתוח – המספר מופיע.'],
 ['מסך לקוח','מכשיר עם מסך שני – עובד לבד. אחרת אפשר לחבר מסך ב-HDMI. "הצגת בדיקה במסך הלקוח".'],
 ['רשת','Wi-Fi יציב, ונתב סלולרי לגיבוי. בלי רשת הקופה ממשיכה למכור במזומן.'],
 ['שמירה על הציוד','לא לחסום את פתחי האוורור של המדפסת. לנקות את ראש ההדפסה כשההדפסה דהויה. המכשיר מחובר לחשמל כל היום.'],
]};
function add(s,o){if(typeof s==='string'&&o&&Array.isArray(o.items))H[s]={t:String(o.t||s),items:o.items.map(String)}}
function list(){return Object.keys(H)}
function btn(s){return `<button class="btn s g" data-a="posHelp" data-s="${esc(s)}" aria-label="עזרה" title="עזרה">?</button>`}
function video(){try{const C=root.PosCfg;const v=C&&C.get?C.get('trainVideo'):'';return typeof v==='string'&&/^https:\/\/[^\s"'<>]+$/.test(v)?v:''}catch(e){return ''}}
/* החלון: div משלו (לא תלוי במסך שמתחת), נסגר ב"הבנתי" או ב-Escape, והפוקוס חוזר לכפתור שפתח אותו */
function show(title,body){const d=root.document;if(!d)return null;const prev=d.activeElement;
 const box=d.createElement('div');box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');box.setAttribute('aria-label',title);box.dir='rtl';
 box.style.cssText='position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px';
 box.innerHTML=`<div style="background:var(--card,#fff);color:var(--fg,#111);border-radius:14px;max-width:560px;width:100%;max-height:85vh;overflow:auto;padding:16px 18px"><h2 style="margin:0 0 10px">${esc(title)}</h2>${body}<button class="btn w" data-k="ok" style="margin-top:12px">הבנתי</button></div>`;
 const close=()=>{box.remove();d.removeEventListener('keydown',kh,true);try{prev&&prev.focus&&prev.focus()}catch(e){}};
 const kh=e=>{if(e.key==='Escape'){e.preventDefault();close()}};
 box.addEventListener('click',e=>{if(e.target===box||(e.target.closest&&e.target.closest('[data-k="ok"]')))close()});
 d.addEventListener('keydown',kh,true);d.body.append(box);const b=box.querySelector('[data-k="ok"]');if(b)b.focus();return box}
function bodyOf(s){const x=H[s];if(!x)return null;const v=video();
 return{t:x.t,h:'<ul style="margin:0;padding-inline-start:20px;line-height:1.7">'+x.items.map(i=>`<li>${esc(i)}</li>`).join('')+'</ul>'+(v?`<p><a href="${esc(v)}" target="_blank" rel="noopener">סרטון הדרכה</a></p>`:'')}}
function open(s){const b=bodyOf(s)||bodyOf('sale');return show(b.t,b.h)}
function guide(){return show(GUIDE.t,'<ol style="margin:0;padding-inline-start:22px;line-height:1.7">'+GUIDE.steps.map(([a,b])=>`<li><b>${esc(a)}</b> – ${esc(b)}</li>`).join('')+'</ol>')}
try{if(typeof ACT!=='undefined'){ACT.posHelp=el=>open(el&&el.dataset?el.dataset.s:'sale');ACT.posGuide=()=>guide()}}catch(e){}
return{btn,open,guide,add,list,bodyOf,GUIDE}});
