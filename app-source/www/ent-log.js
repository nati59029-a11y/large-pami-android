/* "יומן הכנסות והוצאות" (23.11.2026, בקשת בעל העסק) – כל ההכנסות וההוצאות לפי הסדר שבו נכנסו לאפליקציה.
   קריאה בלבד: לא כותב ולא משנה נתונים. זמן הכניסה = t.ts (נשמר בכל save() מאז S.tsFrom). רשומות מלפני תחילת המעקב (ts ריק) – שורת פתיחה אחת.
   שתי תצוגות: לפי חודש המסמך (t.date – אותם כללים כמו במסך הבית: בלי משיכות בעלים/הפקדות, לפי הסניף שנבחר, בלי רשומות שבוטלו),
   או לפי חודש הכניסה לאפליקציה (t.ts). ליד כל שורה – המצב המצטבר אחרי הכניסה שלה: סך ההכנסות, סך ההוצאות והרווח/ההפסד.
   הסכומים = t.amt, בדיוק כמו monthIncome/monthExpense, כך שהשורה האחרונה בתצוגת "חודש המסמך" שווה למספרים במסך הבית. מנהל בלבד. */
(function(){
const EL={m:'',b:'doc',f:'all',ord:'new'};
const ok=()=>typeof isA==='function'&&isA();
const tsN=t=>{const x=t&&t.ts?Date.parse(t.ts):NaN;return Number.isFinite(x)?x:0};
const day=n=>ilDay(new Date(n));
const hhmm=n=>{try{return new Date(n).toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Jerusalem'})}catch(e){return ''}};
const wday=d=>{try{return new Date(d+'T12:00:00').toLocaleDateString('he-IL',{weekday:'long'})}catch(e){return ''}};
function kind(t){const c=cat(t.cat)||{},b=c.beh;
 if(t.t==='inc')return 'הכנסה'+(c.name?' · '+c.name:'');
 if(t.kind==='credit')return 'זיכוי'+(t.inv?' '+t.inv:'');
 if(t.kind==='refund')return 'החזר';
 if(b==='emp')return 'משכורת';
 if(b==='sup'||b==='fixed')return (t.dn?'תעודת משלוח':'חשבונית')+(t.inv?' '+t.inv:'');
 return 'הוצאה'+(c.name?' · '+c.name:'')}
function name(t){const c=cat(t.cat)||{},b=c.beh;if(b==='sup'||b==='fixed'||b==='emp')return subName(t);return t.desc?t.desc:(c.name||'')}
function list(){const M=EL.m,E=brFil();
 return live().filter(t=>(t.t==='inc'||t.t==='exp')&&!(t.t==='exp'&&ownOut(t))&&inBr(t,E)&&(EL.b==='doc'?String(t.date||'').startsWith(M):(tsN(t)&&day(tsN(t)).slice(0,7)===M)))
  .sort((x,y)=>(tsN(x)-tsN(y))||String(x.date||'').localeCompare(String(y.date||'')))}
const sgn=v=>`<b class="${v<0?'neg':'pos'}">${ils(v)}</b>`;
V.entLog=()=>{const T='יומן הכנסות והוצאות';if(!ok())return{t:T,h:'<div class="empty">המסך הזה למנהל בלבד</div>'};if(!EL.m)EL.m=typeof HM==='string'&&HM?HM:NOWM();
 const L=list();let I=0,X=0;const old=[],rows=[];
 for(const t of L){if(t.t==='inc')I=rnd(I+t.amt);else X=rnd(X+t.amt);const r={t,I,X,P:rnd(I-X)};if(tsN(t))rows.push(r);else old.push(r)}
 const fOk=t=>EL.f==='all'||(EL.f==='inc'?t.t==='inc':t.t==='exp');
 const seg=(k,v,l)=>`<button class="btn s${EL[k]===v?'':' g'}" data-a="elSet" data-k="${k}" data-v="${v}">${l}</button>`;
 let h=`<div class="card"><div class="row" style="justify-content:space-between;align-items:center"><button class="ib" data-a="elMon" data-d="-1" aria-label="חודש קודם">${ico('chev')}</button><b style="font-size:1.1rem">${mfmt(EL.m)}</b><button class="ib" style="transform:scaleX(-1)" data-a="elMon" data-d="1" aria-label="חודש הבא">${ico('chev')}</button></div>
  <div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap">${seg('b','doc','לפי חודש המסמך')}${seg('b','ent','לפי חודש הכניסה לאפליקציה')}</div>
  <div class="row" style="gap:6px;margin-top:6px;flex-wrap:wrap">${seg('f','all','הכול')}${seg('f','inc','הכנסות')}${seg('f','exp','הוצאות')}<span style="flex:1"></span>${seg('ord','new','חדש למעלה')}${seg('ord','old','ישן למעלה')}</div>
  <p class="note" style="margin:8px 0 0">${EL.b==='doc'?'כל מה שתאריך המסמך שלו ב'+mfmt(EL.m)+', לפי הסדר שבו נכנס לאפליקציה. הסכומים המצטברים הם של החודש – כמו במסך הבית.':'כל מה שנכנס לאפליקציה ב'+mfmt(EL.m)+', מכל תאריך מסמך. הסכומים המצטברים הם של מה שנכנס החודש.'}</p>
  <div class="row" style="gap:12px;margin-top:8px;flex-wrap:wrap"><span>הכנסות: <b class="pos">${ils(I)}</b></span><span>הוצאות: <b class="neg">${ils(X)}</b></span><span>${I-X<0?'הפסד':'רווח'}: ${sgn(rnd(I-X))}</span></div></div>`;
 if(old.length){const o=old[old.length-1],n=old.filter(r=>fOk(r.t)).length;h+=`<div class="card" style="border-style:dashed"><b>נרשמו לפני תחילת המעקב אחרי זמן הכניסה${S.tsFrom?' ('+dfmt(ilDay(S.tsFrom))+')':''}</b><div class="note">${old.length} רשומות${EL.f!=='all'?' ('+n+' בסינון)':''} – אין להן שעת כניסה, ולכן הן מסוכמות כאן כנקודת פתיחה.</div><div class="note">מצטבר: הכנסות ${ils(o.I)} · הוצאות ${ils(o.X)} · ${o.P<0?'הפסד':'רווח'} ${ils(o.P)}</div></div>`}
 const V2=rows.filter(r=>fOk(r.t));if(EL.ord==='new')V2.reverse();
 if(!V2.length)h+=`<div class="empty">${rows.length?'אין שורות בסינון הזה':'אין עדיין רשומות עם זמן כניסה בחודש הזה'}</div>`;
 let cd='';for(const r of V2){const t=r.t,n=tsN(t),d=day(n);
  if(d!==cd){cd=d;const D=rows.filter(z=>day(tsN(z.t))===d),dI=rnd(sum(D.filter(z=>z.t.t==='inc'),z=>z.t.amt)),dX=rnd(sum(D.filter(z=>z.t.t==='exp'),z=>z.t.amt));
   h+=`<div class="sec"><h3>${esc(wday(d))} ${dfmt(d)} · ${D.length} ${D.length===1?'שורה':'שורות'}${dI?' · הכנסות '+ils(dI):''}${dX?' · הוצאות '+ils(dX):''}</h3></div>`}
  const who=typeof dxWho==='function'?dxWho(t):'';
  h+=`<button class="li ${t.t}" data-a="tx" data-id="${esc(t.id)}" style="width:100%;text-align:start"><div class="m"><b>${esc(name(t)||'—')}</b><small>${esc(kind(t))} · נכנס ${hhmm(n)} · תאריך מסמך ${dfmt(t.date)}${who?' · '+esc(who):''}</small><small>אחרי הכניסה: הכנסות ${ils(r.I)} · הוצאות ${ils(r.X)} · ${r.P<0?'הפסד':'רווח'} <b class="${r.P<0?'neg':'pos'}">${ils(r.P)}</b></small></div><div class="a ${t.t==='inc'?'pos':''}">${t.t==='inc'?'+':''}${ils(t.amt)}</div></button>`}
 return{t:T,s:mfmt(EL.m),h}};
ACT.elSet=el=>{const k=el.dataset.k,v=el.dataset.v;if(k in EL){EL[k]=v;rerender()}};
ACT.elMon=el=>{EL.m=addMon(EL.m||NOWM(),+el.dataset.d);rerender()};
/* כניסה: ב"עוד" (מנהל) */
{const o=V.more;if(typeof o==='function')V.more=function(){const r=o.apply(this,arguments);try{if(ok()&&r&&typeof r.h==='string'&&r.h.includes('<div class="mlist">'))r.h=r.h.replace('<div class="mlist">',`<div class="mlist"><button class="opt" data-a="go" data-v="entLog"><span>יומן הכנסות והוצאות<small>לפי הסדר שנכנסו לאפליקציה · מה השתנה מאתמול</small></span>${ico('chev')}</button>`)}catch(e){}return r}}
})();
