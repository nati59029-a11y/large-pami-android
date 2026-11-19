/* "השכר שלי" לעובד (שלב E, משימה 2026-11-19_תנאי-שכר-והערות-עובד). קובץ עצמאי, נטען אחרי payroll*.js ו-emp-notes.js.
   הנתונים של השכר נשארים במכשיר המנהל. המכשיר של המנהל (isA, מבנה b, לא מנהל־על שנכנס לעסק) מפרסם מראה לעובד:
     wv/pay_<YYYY-MM>_<uid> לחודש הנוכחי ולקודם (wvMonths), רק לכרטיס עובד עם pay.show && pay.uid. השדות כמו בשאר wv: {data,h,m,at}.
     data = JSON: {v:1, m, mode, slip, est, calc, exp, due, paid, left, st, min, days, rows:[{n, a|null, s, det:[], h:[], est?, bd?}]}
       סכומים באגורות. s: 'calc' לפי שעות · 'fix' קבוע · 'exp' צפוי · 'ok' אושר · 'man' ידני · 'acc' לרואה החשבון (עובד בתלוש).
     לא נכנס: comp[].src (טקסט המנהל), הערות, תלושים, עלויות מעביד, אזהרות, שמות/נתונים של עובדים אחרים, פירוט בונוס שהמנהל כתב (b.n/b.det).
     רכיב מכירות בלי amt:1 – בלי סכומי מכירות בכלל: הפירוט ו"מה אפשר לשפר" נבנים כאן מהשדות המספריים (אחוז מהיעד / מהסף).
     בונוס אוטומטי שאושר בסכום 0 – לא מוצג.
   לולאה נפרדת מ-wvSync (מצב משלה; 403 על pay_ לא עוצר את inc/sal/bal ולהפך). כתיבה רק כשהתוכן השתנה (hash ב-localStorage).
   מתג כבוי / uid השתנה / הכרטיס נמחק ← מחיקת המסמכים שפורסמו (לפי המטמון), ופעם אחת בכל הפעלה גם pay_ של כרטיס מקושר שהמתג שלו כבוי.
   משימות ומכירות נטענות (PayComp.ensure) רק לעובדים עם show, ולא יותר מפעם ב-10 דקות לעובד/חודש. עד שנטענו – המסמך לא נכתב (ולא נמחק).
   העובד: משבצת "שכר משוער" במסך הבית רק אם יש מסמך (החוקים: רק ה-uid שבמזהה, עובד פעיל). לחיצה ← V.wk (WS='pm'), לחיצה על רכיב ← פירוט.
   משתמש ב: S, SY, isA, isW, bzB, fsx, wvGet, wvMonths, supHash, sv, iv, LK, cat, pmon, PayCore, PayComp, PayUI, ACT, dlg, esc, ils, mfmt, ico, rerender, cur, toast. */
(function(){
'use strict';
if(typeof ACT==='undefined'||typeof PayCore==='undefined')return;
const PC=PayCore,z2=n=>String(n).padStart(2,'0'),uidOk=u=>typeof u==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(u);
const sh=ag=>'₪'+PC.fmtAg(ag),hmF=m=>{m=Math.max(0,Math.round(m||0));return Math.floor(m/60)+':'+z2(m%60)};
const r1=x=>Math.round(x*10)/10,t1=x=>String(r1(x));
const months=()=>{try{return wvMonths()}catch(e){return[]}};

/* ================= מכשיר המנהל: בניית המסמך ================= */
const isEmpT=t=>{try{return!!t&&t.t==='exp'&&(cat(t.cat)||{}).beh==='emp'}catch(e){return false}};
const compOf=(s,id)=>{const c=(s.pay.comp||[]).find(x=>x&&x.id===id);const v=c?PC.validComp(c):null;return v&&v.ok?v.comp:null};
function basis(it,c){let t=c&&c.ss==='hrs'?'לפי המכירות בשעות המשמרות שלך':'לפי מכירות החנות בימים שעבדת';
 if(it.byDay)t+=' (בחלק מהימים – לפי כל היום, אין פילוח לפי שעה)';if(it.est)t+=' · חלק מהחישוב הוא הערכה';return t}
/* רכיב מכירות בלי amt:1 – פירוט בלי סכומי מכירות: רק אחוז מהיעד/מהסף וסכומי הבונוס */
function salesSafe(it,c){const S=Math.max(0,Math.round(it.sales||0)),det=[],h=[];
 if(c&&c.k==='sl'){const T=c.t.map(u=>({min:PC.toAg(u.min),a:PC.toAg(u.a)}));let ci=-1;T.forEach((u,i)=>{if(S>=u.min)ci=i});
  det.push(ci>=0?'הגעת למדרגה '+(ci+1)+' מתוך '+T.length+' – בונוס '+sh(T[ci].a):'עדיין מתחת למדרגה הראשונה ('+T.length+' מדרגות)');
  const nx=T[ci+1];
  if(nx){const gap=nx.min?Math.max(0.1,Math.ceil((nx.min-S)*1000/nx.min)/10):100,got=r1(100-gap);
   det.push('הגעת ל-'+t1(got)+'% מהיעד של מדרגה '+(ci+2)+' (בונוס '+sh(nx.a)+')');
   h.push('חסרים '+t1(gap)+'% מהיעד למדרגה '+(ci+2)+' – בונוס '+sh(nx.a)+(ci>=0?' במקום '+sh(T[ci].a):''))}
  else det.push('הגעת למדרגה הגבוהה ביותר');
  det.push(basis(it,c));return{det,h}}
 if(c&&c.k==='pc'){const amt=Math.round(it.amt||0),per=sh(Math.round(1000*c.p));
  if(c.th!==undefined){const th=PC.toAg(c.th);
   if(S<th){const gap=th?Math.max(0.1,Math.ceil((th-S)*1000/th)/10):0;det.push(c.p+'% מהמכירות שמעל הסף – הגעת ל-'+t1(r1(100-gap))+'% מהסף');h.push('חסרים '+t1(gap)+'% מהסף – מעליו מקבלים '+c.p+'% מכל שקל')}
   else{det.push(c.p+'% מהמכירות שמעל הסף = '+sh(amt));h.push('כל 1,000 ₪ מכירות נוספות = עוד '+per)}}
  else{det.push(c.p+'% מהמכירות = '+sh(amt));h.push('כל 1,000 ₪ מכירות נוספות = עוד '+per)}
  det.push(basis(it,c));return{det,h}}
 return{det:['לפי המכירות'],h:[]}}
/* המסמך לעובד/חודש. ctx = נתוני הרכיבים (PayComp) או null כשאין pay.comp. מחזיר אובייקט או null */
function build(s,m,ctx){const p=s.pay,U=window.PayUI;
 const D={wh:U.AR('wh'),bon:U.AR('bon'),psl:U.AR('psl'),tx:(S.tx||[]).filter(isEmpT),pmon};
 if(Array.isArray(p.comp)&&ctx)Object.assign(D,ctx);
 const r=PC.monthSum(s,m,D);if(!r)return null;
 const isSlip=!!p.slip,R=[];
 if(r.mode==='mo')R.push({n:'שכר חודשי',a:r.base,s:'fix',det:['שכר חודשי קבוע'],h:[]});
 else{const B=new Map();r.rows.forEach(x=>(x.buckets||[]).forEach(b=>B.set(b.rAg,(B.get(b.rAg)||0)+b.min)));
  R.push({n:'שכר לפי שעות',a:r.base,s:'calc',det:[hmF(r.minutes)+' שעות ב-'+r.days+' ימי עבודה'].concat([...B.entries()].sort((a,b)=>a[0]-b[0]).map(([ra,mi])=>hmF(mi)+' שעות × '+sh(ra)+' לשעה')),h:[]})}
 r.adds.forEach(a=>R.push({n:String(a.n||'תוספת').slice(0,60),a:a.amt,s:'fix',det:[a.k==='mo'?'תוספת חודשית קבועה':sh(a.per)+' ליום עבודה × '+a.cnt+' ימים'],h:[]}));
 const items=Array.isArray(r.comp)?r.comp:[],ids=new Set(items.map(i=>i.id));
 U.AR('bon').forEach(b=>{if(!b||b.sub!==s.id||b.mon!==m)return;const au=b.src==='auto';if(au&&typeof b.cid==='string'&&ids.has(b.cid))return;
  const v=PC.num(b.a);if(v===null||(au&&v===0))return;
  R.push({n:au?String(b.n||'בונוס').slice(0,60):'בונוס',a:PC.toAg(v),s:isSlip?'acc':'ok',det:[isSlip?'בונוס שנרשם – עובר לרואה החשבון ונכלל בתלוש':'בונוס שנרשם'],h:[]})});
 items.forEach(it=>{if(it.appr&&!it.bonA)return;const c=compOf(s,it.id),sec=(it.k==='sl'||it.k==='pc')&&!(c&&c.amt);
  const o={n:String(it.n||'').slice(0,80),a:it.appr?it.bonA:it.man?null:Math.round(it.amt||0),s:it.appr?(isSlip?'acc':'ok'):it.man?'man':'exp'};
  if(sec){const x=salesSafe(it,c);o.det=x.det;o.h=it.appr?[]:x.h}else{o.det=(it.det||[]).map(String);o.h=it.appr?[]:(it.hints||[]).map(x=>String(x.t))}
  if(it.est)o.est=1;if(it.byDay)o.bd=1;R.push(o)});
 const exp=Math.round(r.exp||0),est=r.slip?r.slip.net:r.calc+(isSlip?r.bonus:0)+exp;
 return{v:1,m,mode:r.mode,slip:isSlip,est,calc:r.calc,exp,due:r.due,paid:r.paid,left:r.left,st:r.status,min:r.minutes,days:r.days,rows:R}}

/* ================= מכשיר המנהל: לולאת הפרסום (נפרדת מ-wvSync) ================= */
const PS={b:0,again:0,off:0,ld:{},dz:{}};
let PK='lp-wvpay';try{PK=LK('lp-wvpay')}catch(e){}
const mgr=()=>{try{return!!window.PayUI&&PayUI.on()&&!SY.sa&&bzB()}catch(e){return false}};
const emps=()=>(typeof S!=='undefined'&&S&&Array.isArray(S.subs)?S.subs:[]).map(s=>s&&PayUI.empOf(s.id)).filter(s=>s&&s.pay&&typeof s.pay==='object');
/* נתוני הרכיבים: מה שכבר נטען (10 דק'), אחרת טעינה – לא יותר מפעם ב-10 דקות. undefined = לא זמין (לא כותבים) */
async function ctxFor(s,m){if(!Array.isArray(s.pay.comp))return null;if(!window.PayComp||typeof PayComp.ensure!=='function')return undefined;
 const r=PayComp.ctxReady(s,m);if(r)return r;
 /* המפתח כמו המטמון של PayComp: עובד, חודש, uid ואילו נתונים צריך – כך שינוי uid/רכיבים טוען מיד, ואותו צורך לא נטען שוב לפני 10 דקות */
 const K=s.pay.comp.map(c=>PC.validComp(c)).filter(v=>v.ok&&v.comp.on).map(v=>v.comp.k),k=s.id+'|'+m+'|'+s.pay.uid+'|'+(K.includes('tk')?'t':'')+(K.some(x=>x==='sl'||x==='pc')?'s':'');if(Date.now()-(PS.ld[k]||0)<6e5)return undefined;PS.ld[k]=Date.now();
 const x=await PayComp.ensure(s,m);return x&&x.st==='ok'?x.ctx:undefined}
async function pmSync(){if(!mgr()||Date.now()<PS.off)return;if(PS.b){PS.again=1;return}PS.b=1;try{
 let C={};try{C=JSON.parse(localStorage.getItem(PK))||{}}catch(e){}if(!C||typeof C!=='object')C={};
 const store=()=>{try{localStorage.setItem(PK,JSON.stringify(C))}catch(e){}};
 const M=months(),W={},want=new Set();if(M.length!==2)return;
 for(const s of emps()){if(!s.pay.show||!uidOk(s.pay.uid))continue;
  for(const m of M){const id='pay_'+m+'_'+s.pay.uid;if(want.has(id))continue;want.add(id);
   const ctx=await ctxFor(s,m);if(ctx===undefined)continue;const d=build(s,m,ctx);if(d)W[id]=JSON.stringify(d)}}
 for(const id of Object.keys(W)){const h=supHash(W[id]);if(C[id]===h||W[id].length>900000)continue;
  await fsx('/wv/'+id,{method:'PATCH',body:JSON.stringify({fields:{data:sv(W[id]),h:sv(h),m:sv(id.split('_')[1]),at:iv(Date.now())}})});C[id]=h;store()}
 /* מחיקה: מה שפורסם ממכשיר זה ולא רלוונטי יותר; ופעם אחת בהפעלה – pay_ של כרטיס מקושר שהמתג שלו כבוי (גם אם פורסם ממכשיר אחר) */
 const del=new Set(Object.keys(C).filter(id=>/^pay_/.test(id)&&!want.has(id)));
 for(const s of emps())if(!s.pay.show&&uidOk(s.pay.uid))for(const m of M){const id='pay_'+m+'_'+s.pay.uid;if(!want.has(id)&&!PS.dz[id])del.add(id)}
 for(const id of del){try{await fsx('/wv/'+id,{method:'DELETE'})}catch(e){if(e.code!==404)throw e}PS.dz[id]=1;if(id in C){delete C[id];store()}}
}catch(e){if(e&&e.code===403)PS.off=Date.now()+6e5;throw e}finally{PS.b=0;if(PS.again){PS.again=0;setTimeout(()=>{pmSync().catch(()=>{})},4000)}}}
window.pmSync=pmSync;

/* ================= העובד: משבצת ומסך ================= */
const wOn=()=>{try{return isW()&&bzB()&&uidOk(SY.uid)}catch(e){return false}};
const HM={u:'',t:0,b:0,m:'',d:null};/* משבצת: המסמך של החודש הנוכחי (או הקודם, אם עוד אין) */
const PW={m:'',D:{},at:{},b:0,err:''};/* המסך: D[m] = המסמך או null (אין), at[m] = זמן הפרסום */
const docOf=async m=>{const r=await wvGet('pay_'+m+'_'+SY.uid);const v=r.v&&typeof r.v==='object'&&!Array.isArray(r.v)&&Array.isArray(r.v.rows)?r.v:null;return{v,at:v?r.at||0:0}};
async function homeLoad(){if(HM.b||!wOn())return;HM.b=1;const u=SY.uid;let m='',d=null,at=0;
 try{for(const k of months()){const r=await docOf(k);if(r.v){m=k;d=r.v;at=r.at;break}}}catch(e){/* 403 / רשת – אין משבצת */}
 if(SY.uid===u){HM.u=u;HM.t=Date.now();HM.m=m;HM.d=d;if(d){PW.D[m]=d;PW.at[m]=at}}HM.b=0;
 try{if(cur().v==='wk'&&WS==='home')rerender()}catch(e){}}
window.pmTile=()=>{try{if(!wOn())return'';if((HM.u!==SY.uid||Date.now()-HM.t>3e5)&&!HM.b)setTimeout(homeLoad,0);if(HM.u!==SY.uid||!HM.d)return'';
 const d=HM.d;return `<button class="tile" data-a="pmGo" data-pay-tile style="border-color:var(--acc);color:var(--acc);font-size:1.05rem;text-align:center">${ico('chart')}שכר משוער<b style="display:block;font-size:1.15rem;margin-top:2px">${ils((d.est||0)/100)}</b><small style="display:block;font-size:.72rem;font-weight:600;opacity:.85;line-height:1.25">${d.slip?'הסכום הסופי לפי התלוש':'הסכום הסופי בסוף החודש'}</small></button>`}catch(e){return''}};
async function viewLoad(){const m=PW.m;if(PW.b||!wOn())return;PW.b=1;PW.err='';try{const r=await docOf(m);PW.D[m]=r.v;PW.at[m]=r.at}
 catch(e){PW.err=e&&e.offline?e.message:(e&&e.code===403?'אין לך הרשאה לנתוני השכר':'הטעינה נכשלה: '+(e&&e.message||''))}
 finally{PW.b=0}try{if(cur().v==='wk'&&WS==='pm')rerender()}catch(e){}}
ACT.pmGo=()=>{if(!wOn())return;WS='pm';PW.m=HM.m||months()[0];PW.err='';rerender();if(!(PW.m in PW.D))viewLoad()};
ACT.pmMon=el=>{const m=el.dataset.m;if(!months().includes(m)||PW.b)return;PW.m=m;PW.err='';rerender();if(!(m in PW.D))viewLoad()};
ACT.pmRefresh=()=>{delete PW.D[PW.m];HM.t=0;viewLoad()};
const STN={calc:['לפי שעות',''],fix:['קבוע',''],exp:['צפוי','t1'],ok:['אושר','t3'],man:['ידני',''],acc:['לרואה החשבון','']};
const LN=(a,b,x)=>`<div class="row" style="justify-content:space-between;margin:6px 0;flex-wrap:nowrap;gap:8px"${x||''}><span style="min-width:0">${a}</span><b style="white-space:nowrap">${b}</b></div>`;
const val=r=>r.a==null?'—':ils(r.a/100);
window.pmView=()=>{const head=`<button class="btn g" style="margin-bottom:10px" data-a="wkHome">‹ חזרה</button>`,T='השכר שלי';
 if(!wOn())return{t:T,h:head+'<div class="card"><p class="note">המסך זמין לעובד בלבד.</p></div>'};
 const M=months();if(!M.includes(PW.m))PW.m=M[0];const m=PW.m;
 const mb=`<div class="row" style="margin-bottom:10px;flex-wrap:wrap">${M.map(k=>`<button class="chip${k===m?' on':''}" data-a="pmMon" data-m="${k}">${esc(mfmt(k))}</button>`).join('')}<button class="btn s g" data-a="pmRefresh" ${PW.b?'disabled':''}>${PW.b?'טוען...':'רענן'}</button></div>`;
 if(!(m in PW.D))return{t:T,s:mfmt(m),h:head+mb+(PW.err?`<div class="card"><p class="note">${esc(PW.err)}</p><button class="btn g" data-a="pmRefresh">נסה שוב</button></div>`:'<p class="note" style="padding:16px">טוען...</p>')};
 const d=PW.D[m];if(!d)return{t:T,s:mfmt(m),h:head+mb+'<div class="card"><p class="note">המנהל עוד לא פרסם נתוני שכר לחודש הזה.</p></div>'};
 const at=PW.at[m],rows=Array.isArray(d.rows)?d.rows:[];
 let h=`<div class="hero hk" data-pay-hero style="--hk:var(--inc)"><small>שכר משוער · ${esc(mfmt(m))}</small><div class="big">${ils((d.est||0)/100)}</div><small>${d.slip?'הסכום הסופי – לפי התלוש':'הסכום הסופי – בסוף החודש'}</small>
  <div class="two"><div><small>שעות</small><b>${hmF(d.min)}</b></div><div><small>ימי עבודה</small><b>${Math.max(0,Math.round(d.days||0))}</b></div></div></div>`;
 h+=`<p class="note" data-pay-at>${at?'נכון ל-'+esc(new Date(at).toLocaleString('he-IL',{day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'}))+' · ':''}קריאה בלבד. לחיצה על רכיב – פירוט.</p>`;
 h+=`<div class="card" data-pay-tbl style="padding:8px 10px">`+LN('<b>רכיב</b>','<b>סכום</b>')+rows.map((r,i)=>{const st=STN[r.s]||['',''];
  return `<button type="button" class="li" data-a="pmRow" data-i="${i}" style="width:100%;font:inherit;color:inherit;text-align:inherit;cursor:pointer"><div class="m" style="min-width:0"><b>${esc(String(r.n||''))}</b><small>${st[0]?`<span class="tag ${st[1]}">${st[0]}</span>`:''}${r.bd?' · לפי יום':''}${r.est?' · הערכה':''}</small></div><div class="a" style="white-space:nowrap">${val(r)}</div></button>`}).join('')+`</div>`;
 h+=`<div class="card" data-pay-sum>`+LN(d.slip?'חישוב לפי שעות ותוספות':'לפי שעות, תוספות ובונוסים שאושרו',ils((d.calc||0)/100))+(d.exp?LN('בונוס צפוי (עוד לא אושר)',ils(d.exp/100)):'')
  +LN('שולם עד עכשיו',ils((d.paid||0)/100))+(d.st==='over'?LN('שולם ביתר',ils(-(d.left||0)/100)):LN('נשאר לקבל',ils(Math.max(0,d.left||0)/100)))+`</div>`;
 h+=`<p class="note">זה סכום משוער. בונוסים במהלך החודש הם "צפוי" – הם מאושרים בסוף החודש, והמנהל יכול לשנות אותם לפני התשלום.${d.slip?' הסכום הסופי נקבע לפי התלוש.':''}</p>`;
 return{t:T,s:mfmt(m),h:head+mb+h}};
ACT.pmRow=el=>{const d=PW.D[PW.m];if(!d||!Array.isArray(d.rows))return;const r=d.rows[+el.dataset.i];if(!r)return;const st=STN[r.s]||['',''];
 let b=`<p class="note">${st[0]?esc(st[0])+' · ':''}${val(r)}</p>`+(Array.isArray(r.det)?r.det:[]).map(t=>`<div class="note" style="margin:4px 0">${esc(String(t))}</div>`).join('');
 if(Array.isArray(r.h)&&r.h.length)b+='<div class="sec"><h3>מה אפשר לשפר</h3></div>'+r.h.map(t=>`<div class="note" style="margin:4px 0">• ${esc(String(t))}</div>`).join('');
 dlg(`<h3>${esc(String(r.n||''))}</h3><div data-pay-det>${b}</div><button type="button" class="btn g w" style="margin-top:12px" data-a="closeDlg">סגירה</button>`)};

window.PayMe={build,pmSync,_st:{PS,HM,PW},_reset:()=>{PS.b=0;PS.again=0;PS.off=0;PS.ld={};PS.dz={};HM.u='';HM.t=0;HM.d=null;HM.m='';PW.D={};PW.at={};PW.m='';PW.err=''}};
})();
