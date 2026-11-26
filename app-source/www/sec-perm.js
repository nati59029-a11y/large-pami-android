/* גיטי – הרשאות לפי סוג פעולה, לכל מנהל בנפרד (24.11.2026, "גיטי מנהלת עסק", סבב 4 חלק א). נטען אחרי sec-cmt.js.
   הנתונים מ-secState (X.st.perm: { edit, m: {<סוג>:{m,cap?}}, q: {<סוג>:{t,n,note}}, types:[{k,l,auto,money,fixed}] }) – תמיד של המנהל המחובר בלבד.
   1. הגדרות המזכירה ← "הרשאות": שורה לכל סוג פעולה – מצב (טרם הוגדר / לבד / מכינה ואני מאשר / אסור) ובסוג כספי תקרת סכום. secPrefs op:'perm' scope:'always'.
   2. מרכז האישורים: "שאלה בפעם הראשונה" לכל סוג שגיטי הגיעה אליו בלי הגדרה – לבד / מכינה ואני מאשר / אסור, ואז תמיד כך / רק הפעם / לשאול שוב,
      ובסוג כספי "עד איזה סכום". "תמיד כך" נשמר; השאר רק סוגר את השאלה. השרת בודק הכול (רק ההגדרות של המנהל עצמו) ורושם ביומן.
   ברמת העסק וקבוע (לא כאן): "עצור הכל", תקרת העלות, הזמנה מספק – תמיד באישור. עיצוב: רק משתני הערכה. שום דבר לא נשמר במכשיר. */
(function(root){
'use strict';
if(typeof ACT==='undefined'||typeof FRM==='undefined')return;
const X=root.__sec;if(!X)return;
const fnCall=(n,d)=>{d=d&&typeof d==='object'?d:{};if(SY&&SY.sa&&SY.bizId&&!('bizId'in d))d=Object.assign({bizId:SY.bizId},d);return root.fnCall(n,d)};
const re=()=>{try{if(cur().v==='sec'&&!(typeof typing==='function'&&typing()))rerender()}catch(e){}};
const P=()=>X.st&&X.st.perm&&Array.isArray(X.st.perm.types)?X.st.perm:null;
const ML={auto:'לבד',approve:'מכינה ואני מאשר',deny:'אסור'};
const nis=n=>Number(n).toLocaleString('he-IL')+' ₪';
function curL(t,e){if(!e)return 'טרם הוגדר';if(t.fixed==='approve'&&e.m!=='deny')return ML.approve+' (תמיד)';return ML[e.m]+(t.money&&e.m==='auto'&&e.cap!=null?' · עד '+nis(e.cap):'')}
const capIn=(t,v)=>t.money&&!t.fixed?`<label class="note" style="display:block;margin:4px 0">עד איזה סכום (₪) לבד <input type="number" name="cap" min="0" max="10000000" step="1" inputmode="numeric" value="${v!=null?esc(String(v)):''}" style="min-height:40px;width:9em"></label>`:'';
function optH(t,sel,withUnset){
 const o=(v,l,dis)=>`<option value="${v}"${sel===v?' selected':''}${dis?' disabled':''}>${l}</option>`;
 return (withUnset?o('unset','טרם הוגדר'):'')+o('auto',ML.auto+(t.auto?'':' (עדיין לא זמין בסוג הזה)'),!t.auto)+o('approve',ML.approve)+o('deny',ML.deny)}

/* ---------- הגדרות המזכירה: מסך "הרשאות" ---------- */
root.__secPermSetH=()=>{const p=P();if(!p)return '';
 const rows=p.types.map(t=>{const e=p.m[t.k]||null,k=esc(t.k);
  return `<form class="secli" data-f="permSet" data-k="${k}" style="display:block"><p style="margin:0"><b>${esc(t.l)}</b> <span class="sectags${e?' g':''}">${esc(curL(t,e))}</span>${p.q[t.k]?' <span class="sectags">גיטי שאלה – במרכז האישורים</span>':''}</p>
  ${t.fixed==='approve'?'<p class="note" style="margin:2px 0">הזמנה מספק תמיד באישור שלך – גם אם תבחרו אחרת. אפשר רק לאסור.</p>':''}
  <div class="secrow" style="flex-wrap:wrap;align-items:center"><label class="note">מצב <select name="m" style="min-height:44px">${optH(t,e?e.m:'unset',true)}</select></label>${capIn(t,e&&e.cap)}<button class="chip" style="min-height:44px">שמור</button></div></form>`}).join('');
 return `<div class="card" id="secPermSet" style="margin-top:8px"><b>הרשאות – מה גיטי רשאית לעשות בשמך</b>
 <p class="note" style="margin:4px 0">ההגדרות שלך בלבד – כל מנהל קובע לעצמו, וההגדרה שלך לא חלה על מנהלים אחרים. "טרם הוגדר" – בפעם הראשונה שגיטי תגיע לפעולה כזו היא תשאל אותך במרכז האישורים, ובינתיים תכין ותחכה לאישור.</p>
 <p class="note" style="margin:4px 0 8px">"לבד" אף פעם לא עוקף את "עצור הכל", את תקרת הסכום ואת כללי הבטיחות הקבועים.</p>${rows}</div>`};

async function save(type,m,scope,cap,btn){
 const p=P();if(!p)return false;const t=p.types.find(x=>x.k===type);if(!t)return false;
 const d={op:'perm',type,m,scope};
 if(m==='auto'&&t.money){const c=Number(cap);if(cap===''||cap==null||!Number.isFinite(c)||c<0){toast('כתבו עד איזה סכום (₪) גיטי רשאית לבד');return false}d.cap=c}
 if(btn)btn.disabled=true;
 try{const r=await fnCall('secPrefs',d);
  if(r&&r.saved)p.m[type]=Object.assign({m:r.m},r.cap!=null?{cap:r.cap}:{});
  else if(m==='unset')delete p.m[type];
  delete p.q[type];
  toast(m==='unset'?'✓ חזר ל"טרם הוגדר"':r&&r.saved?'✓ נשמר: '+curL(t,p.m[type]):'✓ רק הפעם – לא נשמר');
  /* 24.11.2026 (החלטת המשתמש 1): התשובה חלה מיד גם על הפריט שעורר את השאלה – "לבד" מבצע אותו (השרת בודק שוב: הרשאות, ו"עצור הכל" דרך auto:true),
     "אסור" מבטל אותו (שורה ביומן), "מכינה ואני מאשר" – נשאר לאישור. "עצור הכל" פעיל (r.stop) – לא מבצעים לבד; השרת עוצר גם הוא (auto:true ב-tkCard chk / secCal) */
  try{if(r&&r.stop===true&&X.st)X.st.stop=true;if(r&&r.stop===true&&m==='auto'){if(r.ref)toast('"עצור הכל" פעיל – הפעולה שעוררה את השאלה נשארת לאישור שלך')}else applyRef(r&&r.ref,m)}catch(e){}
  re();return true}
 catch(e){toast(e&&e.message||'השמירה נכשלה');if(btn)btn.disabled=false;return false}}
function applyRef(ref,m){if(!ref||!ref.k||(m!=='auto'&&m!=='deny'))return;
 if(ref.k==='tkp'&&ref.cid){const ok=m==='auto'?root.__secTpAuto&&root.__secTpAuto(ref.cid):root.__secTpCancel&&root.__secTpCancel(ref.cid);
  if(m==='auto'&&!ok)toast('הכרטיס שעורר את השאלה חסר פרטים (למי / תאריך) או כבר לא פתוח – אשרו אותו בשיחה')}
 else if(ref.k==='cmt'){if(root.__secCmtAuto)root.__secCmtAuto()}/* "לבד" – נטען מחדש ומאושר לבד; "אסור" – ההצעות לא מוצגות לך יותר */
 else if(ref.k==='app'){if(root.__secNfAutoNow)root.__secNfAutoNow(m)}}
FRM.permSet=async f=>{const v=fd(f);await save(f.dataset.k,v.m,'always',v.cap,f.querySelector('button'))};

/* ---------- מרכז האישורים: שאלה בפעם הראשונה ---------- */
const SCL={always:'תמיד כך',once:'רק הפעם',again:'לשאול שוב בפעם הבאה'};
root.__secPermN=()=>{const p=P();return p?Object.keys(p.q||{}).length:0};
root.__secPermH=()=>{const p=P();if(!p||!p.q)return '';
 const L=p.types.filter(t=>p.q[t.k]);if(!L.length)return '';
 const card=t=>{const q=p.q[t.k],k=esc(t.k);
  const r=(n,v,l,dis,chk)=>`<label class="chip" style="min-height:44px"><input type="radio" name="${n}" value="${v}"${chk?' checked':''}${dis?' disabled':''}> ${l}</label>`;
  return `<form class="secli" data-f="permQ" data-k="${k}" style="display:block"><p style="margin:0"><b>${esc(t.l)}</b>${q.n>1?` <span class="sectags">${esc(String(q.n))} פעמים</span>`:''}</p>
  <p class="note" style="margin:4px 0">גיטי הגיעה בפעם הראשונה לפעולה מהסוג הזה${q.note?' ('+esc(q.note)+')':''}. התשובה תחול מיד גם עליה: "לבד" – גיטי מבצעת אותה עכשיו; ${t.k==='app'?'"אסור" – ההתראות נשארות לטיפול ידני שלך':'"אסור" – היא מבוטלת'}; "מכינה ואני מאשר" – נשארת לאישור שלך.</p>
  <fieldset style="border:0;padding:0;margin:4px 0"><legend class="note">מה גיטי רשאית</legend><div class="secrow" style="flex-wrap:wrap">${r('m','auto',ML.auto+(t.auto?'':' (לא זמין)'),!t.auto)}${r('m','approve',ML.approve,false,true)}${r('m','deny',ML.deny)}</div></fieldset>
  <fieldset style="border:0;padding:0;margin:4px 0"><legend class="note">לכמה זמן</legend><div class="secrow" style="flex-wrap:wrap">${r('sc','always',SCL.always,false,true)}${r('sc','once',SCL.once)}${r('sc','again',SCL.again)}</div></fieldset>
  ${capIn(t,null)}<div class="secrow"><button class="chip" style="min-height:44px">שמור</button></div></form>`};
 return `<div class="sec"><h3>גיטי שואלת – הרשאות (${L.length})</h3></div><div class="card"><p class="note" style="margin:0 0 6px">התשובה חלה מיד על הפעולה שעוררה את השאלה. "תמיד כך" נשמר גם לפעמים הבאות במסך ההרשאות שלך.</p>${L.map(card).join('')}</div>`};
FRM.permQ=async f=>{const v=fd(f);if(!v.m||!v.sc)return toast('בחרו מה גיטי רשאית ולכמה זמן');await save(f.dataset.k,v.m,v.sc,v.cap,f.querySelector('button'))};
})(typeof window!=='undefined'?window:this);
