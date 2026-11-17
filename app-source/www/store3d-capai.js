/* הקמת חנות – שלב 5 (משימה 2026-11-17_תהליך-הקמת-חנות): "בדיקה חכמה" לפריט ו"המערכת מציעה", במסך "צילום החנות".
   נטען אחרי store3d-setupcap.js ו-store3d-crop.js. נקודת חיבור אחת לכרטיס הפריט: U.aiBtn(it,s) (שורה אחת ב-store3d-setupcap.js).
   הבדיקה (s3CapCheck) רצה בשרת על התמונות שכבר נשלחו, ונספרת במכסת ההקמה של המפה (חד-פעמית: 2 × מקטעים + 50, מנהל המערכת יכול להגדיל).
   התוצאה נשמרת ב-cap/{key}.ai ומוצגת כאן: סוג המידוף, קומות, כיסוי וקטעים חסרים, ו"נכתב X, נמצא Y".
   מוצר/קטגוריה בביטחון גבוה (0.8 ומעלה) נכנסים לבד, ואפשר לבטל; מתחת – "לבדיקה". שינוי סוג/קומות/מקטעים – תמיד באישור (s3CapDec);
   סוג וקומות שאושרו נשמרים במפה (גרסה קודמת נשמרת). המוצרים לא נכתבים ל"מה אמור להיות" לבד – יש כפתור "העתיקו לרשימה" (מנהל).
   כל שמות הפעולות כאן מתחילים ב-s3ai. */
(function(){
'use strict';
const U=window.S3UI,PL=window.S3Plan,K=U&&U.K3;
if(!U||!PL||!K||typeof ACT==='undefined'||typeof dlg==='undefined')return;
const esc2=U.esc2;
const A={key:'',doc:null,busy:0,msg:'',use:null,tok:0};
const itemOf=k=>K.plan&&K.plan.items.find(i=>i.key===k)||null;
const OLD='העדכון בשרת עוד לא הותקן, ולכן הבדיקה החכמה עוד לא זמינה.';
const RS={'no-photos':'אין עדיין תמונות שנשלחו לפריט הזה. צלמו קודם, וחכו שהתמונות יישלחו.','skipped':'הפריט מסומן כדילוג. בטלו את הדילוג כדי לבדוק אותו.','busy':'הפריט הזה כבר בבדיקה. נסו שוב בעוד דקה.',
 'bad-answer':'התשובה מהבדיקה החכמה לא נקראה. נסו שוב.','stale-ai':'תוצאת הבדיקה התחלפה. טוענים מחדש…','kind-sides':'לגוף הזה יש שני צדדים, והסוג החדש הוא חד-צדדי. שנו את הסוג בעורך המפה.',
 'not-mgr':'העתקה לרשימה מותרת למנהל.','not-s3m':'הבדיקה החכמה מותרת למנהל או לעובד עם הרשאת "שרטוט מפה".','no-key':'הבדיקה החכמה לא מוגדרת בשרת. פנו למנהל המערכת.'};
const msgOf=(e,d)=>{if(e&&e.reason==='s3-setup-limit')return e.message||'נגמרה מכסת הבדיקות החכמות של ההקמה. מנהל המערכת יכול להגדיל אותה.';
 if(e&&RS[e.reason])return RS[e.reason];if(e&&!e.offline&&!e.reason&&/^הפעולה נכשלה/.test(e.message||''))return OLD;return U.errText(e,d)};
const KN={gon:'גונדולה',wall:'מדף קיר',fridge:'מקרר',table:'שולחן',stand:'מעמד',bin:'סל',dfr:'מקרר דלתות',ofr:'מקרר פתוח',frz:'מקפיא',pal:'משטח',rack:'סטנד / מתלה',ctr:'דלפק',oth:'אחר'};
const DK={kind:'סוג המידוף',lvl:'מספר הקומות',bays:'מספר המקטעים',w:'הרוחב',prod:'מוצר',cat:'קטגוריה'};
const pct=v=>'<bdi dir="ltr">'+Math.round((+v||0)*100)+'%</bdi>';
const phN=d=>(d&&Array.isArray(d.ph)?d.ph:[]).filter(p=>p&&p.off!==true).length;

/* כפתור בכרטיס הפריט: רק כשיש תמונה שכבר בשרת */
U.aiBtn=(it,s)=>{if(!it||s==='skip')return '';return phN(K.docs[it.key])?`<button class="btn g" data-a="s3aiOpen">בדיקה חכמה</button>`:''};

const CSS=document.createElement('style');
CSS.textContent=`.s3ai h3{margin:0 0 6px}.s3ai .s3aiL{list-style:none;margin:6px 0;padding:0}.s3ai .s3aiL li{border:1px solid var(--line);border-radius:var(--r-m,10px);padding:8px 10px;margin:6px 0;background:var(--card);overflow-wrap:anywhere}
.s3ai .s3aiL li.rev{border-color:#e8892b}.s3ai .s3aiL li.no{opacity:.6}.s3ai .s3aiB{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}.s3ai .s3aiB .btn{min-height:44px;min-width:88px;flex:1}
.s3ai .s3aiT{display:inline-block;font-size:.8rem;border-radius:8px;padding:1px 8px;margin-inline-start:6px;border:1px solid var(--line);color:var(--mut)}.s3ai .row .btn{min-height:44px;flex:1;min-width:120px}`;
document.head.appendChild(CSS);

async function load(){const t=++A.tok;
 try{const d=await U.get('/s3setup/'+K.mapId+'/cap/'+A.key);if(t!==A.tok)return;A.doc=d||null;
  if(d){K.docs[A.key]=Object.assign({},K.docs[A.key]||{},d)}}
 catch(e){if(t!==A.tok)return;A.msg=e&&e.offline?'אין חיבור לאינטרנט.':'לא הצלחנו לטעון את תוצאת הבדיקה.'}
 paint()}
const tag=st=>st==='auto'?'נכנס לבד':st==='rev'?'לבדיקה':st==='ok'?'אושר':st==='no'?'בוטל':'';
function diffLi(d,i){
 const st=d.st,map=d.k==='kind'||d.k==='lvl',info=d.k==='bays'||d.k==='w';
 let b='';
 if(st==='auto')b=`<button class="btn g" data-a="s3aiDec" data-k="diff" data-i="${i}" data-st="no">בטלו</button>`;
 else if(st==='rev')b=`<button class="btn" data-a="s3aiDec" data-k="diff" data-i="${i}" data-st="ok">${info?'הבנתי':'אשרו'}</button><button class="btn g" data-a="s3aiDec" data-k="diff" data-i="${i}" data-st="no">דחו</button>`;
 else if(st==='no')b=`<button class="btn g" data-a="s3aiDec" data-k="diff" data-i="${i}" data-st="ok">החזירו</button>`;
 const note=st==='ok'&&map?'<br><small>נשמר במפה (אפשר לחזור לגרסה קודמת בעורך).</small>':info&&st==='rev'?'<br><small>לתיקון בעורך המפה.</small>':map&&st==='rev'?'<br><small>אישור ישנה את המפה.</small>':'';
 return `<li class="${esc2(st)}"><b>${esc2(DK[d.k]||d.k)}</b><span class="s3aiT">${tag(st)}</span><br>נכתב <b>${esc2(d.was||'—')}</b>, נמצא <b>${esc2(d.got||'—')}</b> <small>(${pct(d.conf)})</small>${note}${b?`<div class="s3aiB">${b}</div>`:''}</li>`}
function prodLi(p,i){
 const ex=[p.brand,p.var,p.size].filter(Boolean).join(' · ');
 const b=p.st==='rev'?`<button class="btn" data-a="s3aiDec" data-k="prod" data-i="${i}" data-st="ok">אשרו</button><button class="btn g" data-a="s3aiDec" data-k="prod" data-i="${i}" data-st="no">דחו</button>`:
  p.st==='no'?`<button class="btn g" data-a="s3aiDec" data-k="prod" data-i="${i}" data-st="ok">החזירו</button>`:`<button class="btn g" data-a="s3aiDec" data-k="prod" data-i="${i}" data-st="no">בטלו</button>`;
 return `<li class="${esc2(p.st)}"><b>${esc2(p.n)}</b><span class="s3aiT">${tag(p.st)}</span>${ex?`<br><small>${esc2(ex)}</small>`:''}${p.lv?`<br><small>קומה ${+p.lv}${p.bc?' · ברקוד '+esc2(p.bc):''}</small>`:p.bc?`<br><small>ברקוד ${esc2(p.bc)}</small>`:''} <small>(${pct(p.conf)})</small><div class="s3aiB">${b}</div></li>`}
function paint(){
 const it=itemOf(A.key);if(!it){closeDlg();return}
 const d=A.doc||K.docs[A.key]||{},ai=d.ai&&typeof d.ai==='object'?d.ai:null,off=navigator.onLine===false;
 let h=`<div class="s3ai"><h3>המערכת מציעה – ${esc2(PL.label(it,K.map))}</h3>`;
 if(A.use&&A.use.w80)h+=`<div class="ban s3warn" role="status">נוצלו ${+A.use.n} מתוך ${+A.use.lim} בדיקות חכמות של הקמת המפה (80% ומעלה). מנהל המערכת יכול להגדיל את המכסה.</div>`;
 if(A.busy)h+=`<div class="s3info" role="status">${esc2(A.msg||'רגע…')}</div>`;
 else if(A.msg)h+=`<div class="s3info" role="alert">${esc2(A.msg)}</div>`;
 if(!ai)h+=`<p class="note">הבדיקה החכמה מזהה את סוג המידוף, הקומות והמוצרים, ובודקת שאין קטע חסר. כל בדיקה נספרת במכסת ההקמה של המפה.</p>`;
 else{
  const gaps=Array.isArray(ai.gaps)?ai.gaps.length:0,ends=Array.isArray(ai.ends)?ai.ends:[];
  h+=`<div class="s3info">${ai.kind?`סוג: <b>${esc2(KN[ai.kind]||ai.kind)}</b>${ai.lvl?` · ${+ai.lvl} קומות`:''}<br>`:''}כיסוי ${pct(ai.cov)}${ends.length<2?' · '+(ends.length?'קצה אחד לא נראה':'הקצוות לא נראים'):''}${gaps?` · <b>${gaps} קטעים חסרים</b>`:''}<br><small>בדיקה ${new Date(ai.at).toLocaleString('he-IL')}</small></div>`;
  if(ai.retake)h+=`<div class="ban s3warn" role="alert">${esc2(ai.retake)}</div>`;
  if(ai.cut)h+=`<p class="note">${+ai.cut} פריטים בביטחון נמוך לא נשמרו (התוצאה הייתה גדולה מדי).</p>`;
  const D=Array.isArray(ai.diff)?ai.diff:[];
  if(D.length)h+=`<b>נכתב מול נמצא</b><ul class="s3aiL">${D.map(diffLi).join('')}</ul>`;
  const P=Array.isArray(ai.prods)?ai.prods:[];
  if(P.length){const idx=P.map((p,i)=>[p,i]);
   const inn=idx.filter(([p])=>p.st==='auto'||p.st==='ok'),rv=idx.filter(([p])=>p.st==='rev'),no=idx.filter(([p])=>p.st==='no');
   if(rv.length)h+=`<b>לבדיקה (${rv.length})</b><ul class="s3aiL">${rv.map(([p,i])=>prodLi(p,i)).join('')}</ul>`;
   if(inn.length)h+=`<b>מוצרים שזוהו (${inn.length})</b><ul class="s3aiL">${inn.map(([p,i])=>prodLi(p,i)).join('')}</ul>`;
   if(no.length)h+=`<b>בוטלו (${no.length})</b><ul class="s3aiL">${no.map(([p,i])=>prodLi(p,i)).join('')}</ul>`;
   if(it.k==='b'&&U.isMgr()&&inn.length)h+=`<div class="row s3row"><button class="btn g" data-a="s3aiExp">העתיקו לרשימת "מה אמור להיות"</button></div><p class="note">רק מוצרים שזוהו ועוד לא ברשימה נוספים. מה שכבר ברשימה לא משתנה.</p>`}
  else if(it.k==='b')h+=`<p class="note">לא זוהו מוצרים.</p>`}
 h+=`<div class="row s3row"><button class="btn" data-a="s3aiRun" ${A.busy||off?'disabled':''}>${ai?'בדקו שוב':'בדקו עכשיו'}</button><button class="btn g" data-a="s3aiClose">סגרו</button></div>`;
 if(off)h+=`<p class="note">אין חיבור לאינטרנט – הבדיקה החכמה דורשת חיבור.</p>`;
 dlg(h+'</div>')}

ACT.s3aiOpen=()=>{if(K.busy)return;const it=itemOf(K.cur);if(!it)return;
 if(A.key!==it.key)A.use=null;Object.assign(A,{key:it.key,doc:null,busy:0,msg:''});paint();load()};
ACT.s3aiClose=()=>{A.tok++;closeDlg();if(typeof rerender==='function')rerender()};
ACT.s3aiRun=async()=>{if(A.busy)return;if(K.q&&K.q[A.key])return toast('מחכים שהתמונות יישלחו…');
 A.busy=1;A.msg='בודקים את התמונות… (עד דקה או שתיים)';paint();
 try{const r=await U.fn('s3CapCheck',{qid:U.qid(),mapId:K.mapId,key:A.key});A.use=r&&r.usage||A.use;
  A.msg=r&&r.per?'בתמונה היה אדם, ולכן היא נמחקה. צלמו שוב.':'';A.busy=0;await load();return}
 catch(e){A.busy=0;A.msg=msgOf(e,'הבדיקה נכשלה')}
 paint()};
ACT.s3aiDec=async el=>{const ai=A.doc&&A.doc.ai;if(A.busy||!ai)return;
 const o={qid:U.qid(),mapId:K.mapId,key:A.key,at:ai.at,k:el.dataset.k,i:+el.dataset.i,st:el.dataset.st};
 A.busy=1;A.msg='שומרים…';paint();
 try{const r=await U.fn('s3CapDec',o);A.msg=r&&r.mapV?'המפה עודכנה.':'';
  /* המפה השתנתה (סוג/קומות) – תוכנית הצילום מחושבת מחדש מהמפה השמורה */
  if(r&&r.mapV){try{const m=await U.get('/smap/'+K.mapId);if(m){K.map=m;K.plan=PL.capPlan(m)}}catch(e){}}}
 catch(e){A.msg=msgOf(e,'השמירה נכשלה')}
 A.busy=0;await load()};
ACT.s3aiExp=async()=>{const ai=A.doc&&A.doc.ai;if(A.busy||!ai||!U.isMgr())return;
 A.busy=1;A.msg='מעתיקים…';paint();
 try{const r=await U.fn('s3CapDec',{qid:U.qid(),mapId:K.mapId,key:A.key,at:ai.at,k:'exp'});A.msg=r&&r.added?`נוספו ${+r.added} מוצרים לרשימה (${+r.n} ברשימה).`:'כל המוצרים כבר ברשימה.'}
 catch(e){A.msg=msgOf(e,'ההעתקה נכשלה')}
 A.busy=0;paint()};
})();
