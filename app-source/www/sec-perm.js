/* גיטי – הרשאות פעולה (24.11.2026, "גיטי מנהלת עסק", סבב 4 חלק א, החלטות 1–5, 12). נטען אחרי sec-cmt.js.
   1. בהגדרות המזכירה: "הרשאות של גיטי" – לכל סוג פעולה (משימה, תזכורת, שליחת הודעה, טיוטת הזמנה מספק, תיוג/סיווג הוצאה):
      אסור / רק אחרי אישור / לבד, ותקרות הסכום (לפעולה וליום) וספי ההוצאה החריגה. הערכים מהשרת (secState → perm).
      רק מנהל־העל משנה (secPrefs op:'perm', שינוי אחד בכל לחיצה); שאר המנהלים רואים את אותו מסך נעול. השרת אוכף בכל מקרה.
      סוג שעוד לא נשמר במפורש – הערך האפקטיבי מהשרת (perm.src != 'set') וסימון "לפי ההגדרות הקיימות".
   2. בשיחה: כרטיס "שינוי הרשאה" (k:'perm') שהשרת מכין למנהל־העל כשהוא כותב הוראה ("תני לעצמך לשלוח הודעות לבד").
      "אשר" – secPrefs op:'permCard' st:'ok' (השינוי נקרא מהכרטיס השמור בשרת); "בטל" – st:'no'. שום דבר לא נשמר לפני האישור.
   עיצוב: רק משתני הערכה ומחלקות קיימות (card, chip, note, btn). שום דבר לא נשמר במכשיר. */
(function(root){
'use strict';
if(typeof ACT==='undefined'||typeof CHG==='undefined'||typeof FRM==='undefined')return;
const X=root.__sec;if(!X)return;
const fnCall=(n,d)=>{d=d&&typeof d==='object'?d:{};if(SY&&SY.sa&&SY.bizId&&!('bizId'in d))d=Object.assign({bizId:SY.bizId},d);return root.fnCall(n,d)};
const css=document.createElement('style');
css.textContent='.pmrow{display:grid;gap:4px;padding:8px 0;border-top:1px solid var(--line)}.pmrow:first-of-type{border-top:0}'
+'.pmrow .chips{display:flex;flex-wrap:wrap;gap:6px;margin:0}.pmrow .chip{min-height:44px;flex:1 1 auto;justify-content:center}'
+'.pmnum{display:flex;flex-wrap:wrap;gap:6px;align-items:end;padding:6px 0}.pmnum label{flex:1 1 140px;margin:0}.pmnum input{width:100%}.pmnum .chip{min-height:44px}';
document.head.appendChild(css);
const fmt=v=>Number(v||0).toLocaleString('he-IL');
const NUML={cap1:['תקרת סכום לפעולה','₪'],capD:['תקרת סכום ליום','₪'],anPct:['הוצאה חריגה – מעל הממוצע ב-','%'],anMin:['הוצאה חריגה – לפחות','₪']};
const P=()=>X.st&&X.st.perm||null;

/* ---------- הגדרות ---------- */
root.__secPermSetH=()=>{const p=P();if(!p||!Array.isArray(p.types))return '';
 const ed=!!p.edit,dis=ed?'':' disabled';
 const rows=p.types.map(t=>`<div class="pmrow" data-pm="${esc(t.k)}"><b>${esc(t.l)}${(p.src||{})[t.k]&&p.src[t.k]!=='set'?' <small class="note pmsrc">· לפי ההגדרות הקיימות</small>':''}</b><div class="chips" role="radiogroup" aria-label="${esc(t.l)}">${(p.lv||[]).map(l=>`<label class="chip"><input type="radio" name="pm_${esc(t.k)}" data-c="permLv" data-t="${esc(t.k)}" value="${esc(l.k)}"${p.t[t.k]===l.k?' checked':''}${dis}> ${esc(l.l)}</label>`).join('')}</div></div>`).join('');
 const nums=['cap1','capD','anPct','anMin'].map(k=>{const L=NUML[k],lim=(p.lim||{})[k]||[0,1e6];
  return `<form class="pmnum" data-f="permNumF" data-k="${k}"><label class="f"><span>${esc(L[0])} (${esc(L[1])})</span><input class="amt" name="v" inputmode="numeric" dir="ltr" maxlength="9" value="${esc(String(p[k]))}" aria-label="${esc(L[0])}" data-min="${lim[0]}" data-max="${lim[1]}"${dis}></label>${ed?'<button class="chip">שמירה</button>':''}</form>`}).join('');
 return `<div class="card" id="secPermSet" style="margin-top:8px"><b>הרשאות של גיטי</b>
 <p class="note" style="margin:4px 0 8px">מה גיטי רשאית לעשות בעצמה. "אסור" – גם לא מציעה. "רק אחרי אישור" – מכינה הצעה, ושום דבר לא קורה בלי לחיצה שלך. "לבד" – מבצעת בעצמה, רק בתוך תקרות הסכום; מעל התקרה תמיד מבקשת אישור. בשליחת הודעות זה כולל גם מענה אוטומטי במייל, "קיבלנו" והודעת פתיחה בווצאפ, כללים אישיים ושליחת טיוטת הזמנה ללקוח.</p>
 ${ed?'':'<p class="note" style="margin:0 0 6px">רק מנהל־העל יכול לשנות. כאן אפשר לראות מה מוגדר.</p>'}
 <div>${rows}</div>
 <div class="pmrow"><b>תקרות סכום וספים</b>${nums}<p class="note" style="margin:0">פעולה מעל התקרה לפעולה, או שמצטברת היום מעל התקרה היומית – תמיד באישור, גם כשהסוג מוגדר "לבד". ספי ההוצאה החריגה משמשים להתראות על הוצאות חריגות.</p></div></div>`};
function setP(r){if(r&&r.perm&&X.st){const e=X.st.perm&&X.st.perm.edit;X.st.perm=Object.assign({},r.perm,{edit:e})}}
CHG.permLv=async el=>{const type=el.dataset.t,lvl=el.value,p=P();if(!p||!p.edit)return;const old=p.t[type];
 document.querySelectorAll(`input[data-c=permLv][data-t="${type}"]`).forEach(i=>i.disabled=true);
 try{const r=await fnCall('secPrefs',{op:'perm',type,lvl});setP(r);toast('✓ נשמר')}
 catch(e){if(P())P().t[type]=old;toast(e&&e.message||'השמירה נכשלה')}
 finally{rerender()}};
FRM.permNumF=async f=>{const k=f.dataset.k,p=P();if(!p||!p.edit)return;const raw=String(f.v.value||'').replace(/[,\s₪%]/g,'');
 const min=+f.v.dataset.min,max=+f.v.dataset.max;
 if(!/^\d{1,9}$/.test(raw)||+raw<min||+raw>max)return toast('אפשר לקבוע בין '+fmt(min)+' ל-'+fmt(max));
 const b=f.querySelector('button');if(b)b.disabled=true;
 try{const r=await fnCall('secPrefs',{op:'perm',num:k,v:+raw});setP(r);toast('✓ נשמר')}
 catch(e){toast(e&&e.message||'השמירה נכשלה')}
 finally{rerender()}};

/* ---------- כרטיס בשיחה ---------- */
root.__secPermCardH=(c,mid)=>`<div class="card" style="margin:6px 0 0;padding:8px" data-card="${esc(c.id)}"><b>שינוי הרשאה של גיטי</b><p style="margin:4px 0">${esc(c.txt||'')}</p><p class="note" style="margin:0 0 4px">השינוי יישמר רק אחרי אישור.</p><div class="secrow"><button class="chip" data-a="permCOk" data-mid="${esc(mid||'')}" data-id="${esc(c.id)}" style="min-height:40px">אשר</button><button class="chip" data-a="permCNo" data-mid="${esc(mid||'')}" data-id="${esc(c.id)}" style="min-height:40px">בטל</button></div></div>`;
function mark(cid,st){X.done=X.done||{};X.done[cid]={st};(X.msgs||[]).forEach(m=>(m.cards||[]).forEach(c=>{if(c&&c.id===cid)c.st=st}))}
async function decide(el,st){const mid=el.dataset.mid,cid=el.dataset.id;if(!mid||!cid)return;el.disabled=true;
 try{const r=await fnCall('secPrefs',{op:'permCard',mid,cid,st});setP(r);mark(cid,r&&r.already?(r.st||'ok'):st);if(st==='ok'&&!(r&&r.already))toast('✓ ההרשאה עודכנה');rerender()}
 catch(e){if(e&&e.reason==='not-found'){mark(cid,'gone');rerender()}else{el.disabled=false;toast(e&&e.message||'הפעולה נכשלה')}}}
ACT.permCOk=el=>decide(el,'ok');
ACT.permCNo=el=>decide(el,'no');
})(typeof window!=='undefined'?window:this);
