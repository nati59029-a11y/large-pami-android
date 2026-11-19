/* סנכרון כספית – שלבים A2 ו-A3 (17.11.2026). מנהל בלבד (השרת אוכף: functions/caspit.js; כאן רק מה מוצג).
   A2 – V.cxSalesPv: "דוח מכירות לפריטים" מכספית → מלאי. הקובץ נקרא בטלפון (CaspitCore.parseSales, כולל windows-1255), נשלח בחלקים (cxUpload kind:'sales'),
        תצוגה מקדימה (cxPreview) עם משבצות לחיצות, תיקון כמויות "לא בטוח", ואישור (cxApply). שורה שכבר נקלטה לא נספרת שוב.
   A3 – V.cxSales: "מכירות כספית": תקופה (היום, אתמול, שבוע, חודש, טווח), סיכומים, "כמה נמכר מכל מוצר", קופות, קטגוריות,
        שורות "לא בטוח" לאישור/תיקון (cxFix), התאמה מול סגירת קופה (S.zc במכשיר, לכל יום ולכל קופה + סך יומי).
        החלטת בעל העסק (18.11): דוחות כספית – לתצוגה ולהשוואה בלבד. ההכנסות נרשמות רק מסגירת הקופה (אין הגדרת "מקור הכנסות").
   כל מספר לחיץ ומציג את השורות שמאחוריו (החלטה 12). רכיבי העיצוב הקיימים בלבד (.card .btn .chip .li .tag .note .kg .k .empty .f).
   משתמש ב: V, ACT, CHG, INP, FRM, fnCall, esc, ils, toast, dlg, closeDlg, ask, rerender, go, cur, fd, SY, S, ZREG, zcThr, bzF, dfmt, subName, CaspitCore. */
(function(){
'use strict';
if(typeof ACT==='undefined'||typeof V==='undefined'||typeof CaspitCore==='undefined')return;
const C=CaspitCore;
const fnCall=(n,d)=>{d=d&&typeof d==='object'?d:{};if(SY&&SY.sa&&SY.bizId&&!('bizId'in d))d=Object.assign({bizId:SY.bizId},d);return window.fnCall(n,d)};
const ok=()=>typeof window.oxImpOk==='function'&&window.oxImpOk();
const err=e=>toast(e&&e.message||'הפעולה נכשלה');
const nf=n=>Number(n||0).toLocaleString('he-IL',{maximumFractionDigits:3});
const pz=v=>v==null?'—':ils(v);
const df=d=>typeof dfmt==='function'?dfmt(d):d;
const PG=100;
const rid=()=>{const a=new Uint8Array(12);crypto.getRandomValues(a);return 'cs'+[...a].map(x=>x.toString(36).padStart(2,'0')).join('').slice(0,22)};
const btn=(a,attrs,inner,extra)=>`<button type="button" class="li" data-a="${a}" ${attrs} style="cursor:pointer;color:inherit;font:inherit${extra?';'+extra:''}">${inner}</button>`;
const tile=(l,v,cls,a,k,money)=>`<button type="button" class="k${cls?' '+cls:''}" data-a="${a}" data-k="${k}" style="width:100%;min-height:64px;text-align:start;color:inherit;font:inherit;cursor:pointer"><small>${l}</small><b${money?' dir="ltr"':''}>${money?ils(v):nf(v)}</b></button>`;
const brName=(bk,m)=>esc((m&&m[bk])||bk);
const qsTag=(qs,why)=>{const t=C.QS[qs]||qs;const cls=qs==='unsure'?'t1':qs==='own'||qs==='ok'?'t3':qs==='nolink'||qs==='skip'?'':'t3';return `<span class="tag ${cls}">${esc(t)}${qs==='unsure'&&why&&C.UNSURE_WHY[why]?' – '+esc(C.UNSURE_WHY[why]):''}</span>`};
const goBack=()=>{if(NAV.length>1){NAV.pop();render(-1)}else rerender()};
const zcOn=()=>typeof bzF==='function'&&bzF('cashClose')&&typeof ZREG!=='undefined';

/* ===================== A2: קליטת דוח מכירות ===================== */
const X={st:'',R:null,qty:{},file:'',bad:[],res:null,dl:null};
/* נקרא מ-caspit-sync.js (CHG.cxFile) כשהקובץ זוהה כדוח מכירות */
window.cxSalesFile=async(f,rows,det,prog)=>{
 const p=C.parseSales(rows,det);
 if(!p.lines.length)throw new Error('לא נמצאו שורות מכירה תקינות בקובץ'+(p.bad.length?` (${nf(p.bad.length)} שורות פגומות)`:''));
 const P=C.parts(p.lines,1000),run=rid();
 for(let k=0;k<P.length;k++){prog(`זוהה דוח מכירות: ${nf(p.lines.length)} שורות. שולח חלק ${k+1} מתוך ${P.length}…`);await fnCall('cxUpload',{run,kind:'sales',part:k,parts:P.length,lines:P[k]})}
 prog('בודק מה כבר נקלט ומחשב כמויות…');
 const r=await fnCall('cxPreview',{run});
 Object.assign(X,{st:'pv',run,R:r,qty:{},file:f.name,bad:p.bad,res:null});
 go('cxSalesPv')};
const L0=()=>(X.R&&X.R.rows)||[];
const SDL={
 all:['כל השורות בקובץ',()=>L0()],
 nw:['שורות חדשות',()=>L0().filter(r=>r[8]!=='dup')],
 dup:['כבר נקלטו קודם – לא ייספרו שוב',()=>L0().filter(r=>r[8]==='dup')],
 sure:['כמות בטוחה',()=>L0().filter(r=>r[8]==='sure'||r[8]==='disc')],
 unsure:['לא בטוח – לבדיקה',()=>L0().filter(r=>r[8]==='unsure')],
 ret:['החזרות',()=>L0().filter(r=>r[8]!=='dup'&&r[5]<0)],
 skip:['קודים מיוחדים (בלי מלאי)',()=>L0().filter(r=>r[8]==='skip')],
 nolink:['קודים לא מוכרים (בלי מלאי)',()=>L0().filter(r=>r[8]==='nolink')],
 gross:['פדיון השורות החדשות',()=>L0().filter(r=>r[8]!=='dup'&&r[5]>=0)],
 disc:['שורות עם הנחה',()=>L0().filter(r=>r[8]!=='dup'&&r[6])],
 pc:['מכירות מלפני ספירת מלאי',()=>L0().filter(r=>r[8]!=='dup'&&r[12])],
 /* מסך הסיום (תיקון סבב 1, הערה 10): רק מה שנשמר בפועל (מספרי השורות מהשרת) */
 aAll:['שורות שנקלטו',()=>L0().filter(r=>X.ap&&X.ap.has(r[0]))],
 aOut:['יחידות שירדו מהמלאי',()=>L0().filter(r=>X.ap&&X.ap.has(r[0])&&!['skip','nolink'].includes(r[8])&&qOf(r)>0)],
 aBack:['יחידות שחזרו (החזרות)',()=>L0().filter(r=>X.ap&&X.ap.has(r[0])&&!['skip','nolink'].includes(r[8])&&qOf(r)<0)],
 aUn:['לא בטוח – לבדיקה',()=>L0().filter(r=>X.ap&&X.ap.has(r[0])&&r[8]==='unsure'&&X.qty[r[0]]===undefined)],
 aSkip:['קודים מיוחדים',()=>L0().filter(r=>X.ap&&X.ap.has(r[0])&&r[8]==='skip')],
 aNo:['קודים לא מוכרים',()=>L0().filter(r=>X.ap&&X.ap.has(r[0])&&r[8]==='nolink')],
 aDup:['נקלטו בינתיים ממקום אחר – לא נספרו שוב',()=>L0().filter(r=>X.ap&&r[8]!=='dup'&&!X.ap.has(r[0]))],
};
const qOf=r=>X.qty[r[0]]!==undefined?X.qty[r[0]]:r[9];
function lineRow(r){const bks=X.R&&X.R.bks,q=qOf(r),own=X.qty[r[0]]!==undefined;
 return `<div class="li" style="cursor:default"><div class="m"><b>${esc(r[4]||'(בלי שם)')}</b><small>קוד ${esc(r[3])} · עסקה ${esc(r[2])} · ${esc(df(r[1]))} · ${brName(r[7],bks)}</small><small>פדיון <bdi dir="ltr">${ils(r[5])}</bdi>${r[6]?' · הנחה <bdi dir="ltr">'+ils(r[6])+'</bdi>':''}${q!=null?' · כמות <b>'+nf(q)+'</b>':''}${r[10]?' · מחיר <bdi dir="ltr">'+ils(r[10])+'</bdi>':''}</small><small>${r[8]==='dup'?'<span class="tag">כבר נקלט</span>':own?qsTag('own'):qsTag(r[8],r[11])}${r[12]?' <span class="tag t1">לפני ספירת המלאי מ-'+esc(df(r[12]))+'</span>':''}</small></div></div>`}
const sdlH=()=>{const D=X.dl,L=SDL[D.k][1](),S=L.slice(0,D.n);return `<h3>${esc(SDL[D.k][0])} · ${nf(L.length)}</h3><div data-sc style="max-height:60vh;overflow:auto">${S.map(lineRow).join('')||'<p class="note">אין שורות</p>'}</div>${L.length>S.length?`<button class="btn g w" style="min-height:44px;margin-top:8px" data-a="cxSDlMore">הצג עוד (${nf(L.length-S.length)})</button>`:''}<button class="btn g w" style="min-height:44px;margin-top:8px" data-a="closeDlg">סגור</button>`};
ACT.cxSDl=el=>{if(!X.R||!SDL[el.dataset.k])return;X.dl={k:el.dataset.k,n:PG};dlg(sdlH())};
ACT.cxSDlMore=()=>{if(!X.dl)return;X.dl.n+=PG;const sc=document.querySelector('#dlg [data-sc]'),t=sc?sc.scrollTop:0;dlg(sdlH());const s2=document.querySelector('#dlg [data-sc]');if(s2)s2.scrollTop=t};
/* שורות שנקלטו בעבר ולא מופיעות בקובץ (באותן עסקאות) – מפתח השורה: קוד|פדיון|הנחה|מופע */
ACT.cxSGone=()=>{const G=(X.R&&X.R.gone)||[];dlg(`<h3>נקלטו בעבר ולא בקובץ · ${nf(X.R.cnt.gone)}</h3><p class="note">השורות נשארות כמו שהן – המלאי לא מתבטל. אם מכירה בוטלה בכספית, מתקנים את הכמות במלאי.</p><div style="max-height:55vh;overflow:auto">${G.map(g=>{const p=String(g.k).split('|');return `<div class="li" style="cursor:default"><div class="m"><b>קוד ${esc(p[0])}</b><small>עסקה ${esc(g.tx)} · ${esc(df(g.d))} · ${brName(g.bk,X.R.bks)}</small><small>פדיון <bdi dir="ltr">${ils(+p[1]||0)}</bdi>${+p[2]?' · הנחה <bdi dir="ltr">'+ils(+p[2])+'</bdi>':''}</small></div></div>`}).join('')}${X.R.cnt.gone>G.length?`<p class="note">ועוד ${nf(X.R.cnt.gone-G.length)}…</p>`:''}</div><button class="btn g w" style="min-height:44px;margin-top:8px" data-a="closeDlg">סגור</button>`)};
ACT.cxSBad=()=>dlg(`<h3>שורות פגומות · ${nf(X.bad.length)}</h3><p class="note">השורות האלה לא נשלחו (לא ייקלטו).</p><div style="max-height:55vh;overflow:auto">${X.bad.slice(0,300).map(b=>`<div class="li" style="cursor:default"><div class="m"><b>שורה ${b.r} בקובץ</b><small>${esc(C.SBAD[b.why]||b.why)}</small></div></div>`).join('')}</div><button class="btn g w" style="min-height:44px;margin-top:8px" data-a="closeDlg">סגור</button>`);
const brSel=()=>{const B=typeof brAll==='function'?brAll().filter(b=>b.on):[];if(!B.length)return '';return `<form class="card" data-f="cxBrF" style="border-color:var(--warn)"><b>מאיזה סניף יורד המלאי?</b><p class="note" style="margin:4px 0">שתי הקופות בכספית נכנסות לאותו מלאי. בוחרים פעם אחת.</p><label class="f"><span>סניף</span><select name="br" required><option value="">בחרו סניף</option>${B.map(b=>`<option value="${esc(b.id)}">${esc(b.name||b.n||b.id)}</option>`).join('')}</select></label><button class="btn w" style="min-height:48px">שמירה</button></form>`};
FRM.cxBrF=async f=>{const x=fd(f);if(!x.br)return;const b=f.querySelector('button');b.disabled=true;try{await fnCall('cxSetCfg',{br:x.br});X.R.br=x.br;toast('נשמר');rerender()}catch(e){b.disabled=false;err(e)}};
function spvH(){const R=X.R,c=R.cnt,bks=Object.values(R.bks||{});
 const un=L0().filter(r=>r[8]==='unsure'||(r[12]&&r[8]!=='dup'&&r[9]!=null));
 return `<div class="card"><p class="note" style="margin-top:0">${esc(X.file)} · ${nf(c.lines)} שורות · ${nf(c.tx)} עסקאות · ${c.days.length?esc(df(c.days[0]))+(c.days.length>1?' – '+esc(df(c.days[c.days.length-1])):''):''}${bks.length?' · '+bks.map(esc).join(', '):''}</p>
 <div class="kg">${tile('שורות חדשות',c.nw,'pos','cxSDl','nw')}${tile('כבר נקלטו קודם',c.dup,'','cxSDl','dup')}${tile('כמות בטוחה',c.sure+c.disc,'','cxSDl','sure')}${tile('לא בטוח – לבדיקה',c.unsure,c.unsure?'neg':'','cxSDl','unsure')}${tile('החזרות',c.ret,'','cxSDl','ret')}${tile('קודים מיוחדים',c.skip,'','cxSDl','skip')}${tile('קודים לא מוכרים',c.nolink,c.nolink?'neg':'','cxSDl','nolink')}${tile('פדיון (חדש)',c.gross,'','cxSDl','gross',1)}${c.discA?tile('הנחות (חדש)',c.discA,'','cxSDl','disc',1):''}${c.pc?tile('מלפני ספירת מלאי',c.pc,'neg','cxSDl','pc'):''}${tile('כל השורות בקובץ',c.lines,'','cxSDl','all')}</div>
 <p class="note" style="margin-bottom:0">לחיצה על משבצת מציגה את השורות שמאחורי המספר. קודים מיוחדים (למשל 1000) וקודים שאינם באפליקציה לא משנים מלאי, אבל נספרים במכירות.</p>
 ${c.pc?`<p class="note" style="color:var(--warn)">${nf(c.pc)} שורות הן מכירות מיום שלפני ספירת המלאי האחרונה של המוצר. אם הספירה כבר כללה אותן, המלאי ירד פעמיים – אפשר לתקן את הכמות בשורות האלה ל-0 (במשבצת).</p>`:''}
 ${X.bad.length?`<button class="btn g s w" style="margin-top:8px;min-height:44px" data-a="cxSBad">${nf(X.bad.length)} שורות פגומות בקובץ – לא נשלחו</button>`:''}
 ${c.badSrv?`<p class="note" style="color:var(--warn)">${nf(c.badSrv)} שורות נדחו בשרת (ערך לא תקין) ולא ייקלטו.</p>`:''}
 ${c.bkLeft?`<p class="note" style="color:var(--warn)">ב-${nf(c.bkLeft)} שורות אין מספר סניף, והשם לא מוכר – הן נשמרות לפי שם הסניף.</p>`:''}
 ${c.gone?`<button class="btn g s w" style="margin-top:8px;min-height:44px" data-a="cxSGone">${nf(c.gone)} שורות שנקלטו בעבר לא מופיעות בקובץ (באותן עסקאות) – המלאי לא מתבטל</button>`:''}</div>
 ${R.br?'':brSel()}
 ${un.length?`<div class="card"><h3 style="margin-top:0">לבדיקה – ${nf(un.length)} שורות</h3><p class="note" style="margin-top:0">"לא בטוח": הכמות חושבה מהפדיון ומהמחיר ולא יצאה מספר שלם – הכמות המוצעת תרד מהמלאי והשורה תסומן לבדיקה. "לפני ספירת מלאי": אם הספירה כבר כללה את המכירה – כמות 0. אפשר לתקן כבר עכשיו, או אחר כך במסך המכירות.</p>
 ${un.slice(0,X.un||30).map(r=>`<div class="li" style="cursor:default;flex-wrap:wrap"><div class="m" style="flex:1 1 100%;min-width:0"><b>${esc(r[4]||'(בלי שם)')}</b><small>קוד ${esc(r[3])} · עסקה ${esc(r[2])} · פדיון <bdi dir="ltr">${ils(r[5])}</bdi>${r[10]?' · מחיר <bdi dir="ltr">'+ils(r[10])+'</bdi>':''} · ${r[8]==='unsure'?esc(C.UNSURE_WHY[r[11]]||'לא בטוח'):'לפני ספירת המלאי מ-'+esc(df(r[12]))}</small></div><label class="f" style="margin:0;flex:1 1 100%"><span>כמות (מוצעת: ${esc(String(r[9]))})</span><input inputmode="decimal" dir="ltr" data-c="cxSQ" data-k="${r[0]}" value="${esc(String(qOf(r)))}" style="min-height:44px"></label></div>`).join('')}
 ${un.length>(X.un||30)?`<button class="btn g w" style="min-height:44px" data-a="cxSUnMore">הצג עוד (${nf(un.length-(X.un||30))})</button>`:''}</div>`:''}
 <div class="row" style="margin-top:16px"><button class="btn grow" style="min-height:48px" data-a="cxSApply"${c.nw?'':' disabled'}>אשר ושמור</button><button class="btn g grow" style="min-height:48px" data-a="cxSX">ביטול</button></div>
 ${c.nw?'':'<p class="note">אין שורות חדשות – הכול כבר נקלט.</p>'}`}
ACT.cxSUnMore=()=>{X.un=(X.un||30)+50;rerender()};
CHG.cxSQ=el=>{const i=+el.dataset.k,r=L0().find(x=>x[0]===i);if(!r)return;const v=C.num(el.value);if(Number.isNaN(v)||Math.abs(v)>100000){toast('כמות לא תקינה');el.value=String(qOf(r));return}
 if(!C.qSignOk(r[5],v)){toast(r[5]<0?'בהחזרה הכמות שלילית (או 0)':'במכירה הכמות חיובית (או 0)');el.value=String(qOf(r));return}
 if(v===r[9])delete X.qty[i];else X.qty[i]=Math.round(v*1000)/1000};
ACT.cxSX=()=>ask('לבטל את קליטת הדוח? שום דבר לא נשמר.',()=>{X.st='';X.R=null;goBack()},'כן, בטל');
function moveSum(){let out=0,back=0,un=0;for(const r of L0()){if(['dup','skip','nolink'].includes(r[8]))continue;const q=qOf(r);if(typeof q!=='number')continue;if(q>0)out+=q;else back+=-q;if(r[8]==='unsure'&&X.qty[r[0]]===undefined)un++}return{out,back,un}}
ACT.cxSApply=()=>{const R=X.R;if(!R.br)return toast('קודם בוחרים מאיזה סניף יורד המלאי');const m=moveSum();
 dlg(`<h3>לשמור את המכירות?</h3><div class="kg">${[['שורות חדשות',R.cnt.nw],['יחידות יורדות מהמלאי',m.out],['יחידות חוזרות למלאי (החזרות)',m.back],['לא בטוח – יסומנו לבדיקה',m.un]].map(([l,v])=>`<div class="k"><small>${l}</small><b>${nf(v)}</b></div>`).join('')}</div>
 <p class="note">כל תנועה נרשמת בהיסטוריית המלאי ("מכירה בכספית"). שורות שכבר נקלטו לא ייספרו שוב.</p>
 <div class="row"><button class="btn grow" style="min-height:48px" data-a="cxSGo">כן, לשמור</button><button type="button" class="btn g grow" style="min-height:48px" data-a="closeDlg">ביטול</button></div>`)};
ACT.cxSGo=async()=>{closeDlg();X.st='busy';rerender();
 try{let r,first=true;for(let i=0;i<20;i++){r=await fnCall('cxApply',first?{run:X.run,qty:X.qty}:{run:X.run});first=false;if(r.done)break}
  if(!r||!r.done)throw new Error('השמירה לא הסתיימה. לחצו שוב "אשר ושמור" – מה שכבר נשמר לא יישמר פעמיים.');
  X.res=r.res||{};X.ap=new Set(r.ix||[]);X.st='done';Y.D=null;HC.clear();rerender();toast('✓ המכירות נשמרו');if(typeof window.__oxReload==='function')window.__oxReload()}
 catch(e){if(e&&e.reason==='stale'){try{X.R=await fnCall('cxPreview',{run:X.run});toast('קישורי המוצרים השתנו מאז התצוגה (נשמר קטלוג). מה שכבר נשמר מסומן "כבר נקלט". בדקו שוב ואשרו.')}catch(e2){X.R=null;X.st='';rerender();return err(e2)}X.st='pv';rerender();return}X.st='pv';rerender();err(e)}};
V.cxSalesPv=()=>{const T='קליטת דוח מכירות';if(!ok())return{t:T,h:'<div class="empty">המסך מיועד למנהל בלבד</div>'};
 if(X.st==='busy')return{t:T,s:'שומר…',h:'<div class="card"><p style="margin:0">שומר את המכירות ומעדכן את המלאי…</p><p class="note">אל תסגרו את האפליקציה עד שהפעולה מסתיימת.</p></div>'};
 if(X.st==='done'){const r=X.res||{};return{t:T,s:'נשמר',h:`<div class="card"><h3 style="margin-top:0">✓ המכירות נשמרו</h3><div class="kg">${tile('שורות שנקלטו',r.lines,'pos','cxSDl','aAll')}${tile('יחידות שירדו מהמלאי',r.sold,'','cxSDl','aOut')}${tile('יחידות שחזרו (החזרות)',r.back,'','cxSDl','aBack')}${tile('לא בטוח – לבדיקה',r.unsure,r.unsure?'neg':'','cxSDl','aUn')}${tile('קודים מיוחדים',r.skip,'','cxSDl','aSkip')}${tile('קודים לא מוכרים',r.nolink,'','cxSDl','aNo')}${r.dup?tile('נקלטו בינתיים ממקום אחר',r.dup,'','cxSDl','aDup'):''}</div><p class="note" style="margin-bottom:0">לחיצה על משבצת מציגה את השורות שנשמרו בפועל.</p></div>
 <div class="row"><button class="btn grow" style="min-height:48px" data-a="cxGoSales">למסך המכירות</button><button class="btn g grow" style="min-height:48px" data-a="cxSDone">סיום</button></div>`}}
 if(X.st!=='pv'||!X.R)return{t:T,h:'<div class="empty">אין דוח פתוח. בוחרים קובץ במסך "סנכרון כספית".</div>'};
 return{t:T,s:'תצוגה מקדימה – עוד לא נשמר כלום',h:spvH()}};
ACT.cxSDone=()=>{X.st='';X.R=null;goBack()};
ACT.cxGoSales=()=>{X.st='';X.R=null;NAV.pop();Y.D=null;go('cxSales')};

/* ===================== A3: מסך "מכירות כספית" ===================== */
const Y={per:'today',from:'',to:'',D:null,T:null,tab:'prod',sort:'q',s:'',n:PG,cat:null,U:null,load:0,err:''};
const ymd=t=>{try{return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit'}).format(t)}catch(e){return new Date(t).toISOString().slice(0,10)}};
const addD=(d,n)=>new Date(Date.parse(d+'T12:00:00Z')+n*864e5).toISOString().slice(0,10);
function range(p){const t=ymd(new Date());if(p==='yday'){const y=addD(t,-1);return[y,y]}if(p==='week')return[addD(t,-6),t];if(p==='month')return[t.slice(0,8)+'01',t];if(p==='custom'&&Y.from&&Y.to)return[Y.from,Y.to];return[t,t]}
const PER=[['today','היום'],['yday','אתמול'],['week','שבוע'],['month','חודש'],['custom','טווח']];
/* תיקון סבב 1 (הערה 5): השרת מחזיר עד 92 ימים בבקשה, בצורה קומפקטית (CaspitCore.unpackDays); טווח ארוך – כמה בקשות */
async function yLoad(){const [f,t]=range(Y.per);Y.load=1;Y.err='';
 try{let r=null,days=[];for(const [a,b] of C.chunks(f,t,92)){const x=await fnCall('cxSales',{from:a,to:b});days=days.concat(C.unpackDays(x));r=r||x}
  Y.D=Object.assign(r,{days,f,t});Y.T=C.aggDays(days);Y.U=null}catch(e){Y.err=e.message||'הטעינה נכשלה';Y.D=null}
 Y.load=0;if(cur().v==='cxSales')rerender()}
const catN=c=>c?(Y.D&&Y.D.cats&&Y.D.cats[c])||'קטגוריה':'בלי קטגוריה';
const bkN=bk=>{const b=Y.T&&Y.T.br[bk];return esc((b&&b.bn)||bk)};
V.cxSales=()=>{const T='מכירות כספית';if(!ok())return{t:T,h:'<div class="empty">המסך מיועד למנהל בלבד</div>'};
 const per=`<div class="chips scroll-x nw" role="group" style="margin-bottom:8px">${PER.map(([k,l])=>`<button class="chip${Y.per===k?' on':''}" data-a="cxYPer" data-k="${k}" aria-pressed="${Y.per===k}" style="min-height:44px">${l}</button>`).join('')}</div>
 ${Y.per==='custom'?`<form class="card" data-f="cxYRange"><div class="row"><label class="f grow"><span>מתאריך</span><input type="date" name="from" value="${esc(Y.from)}" required style="min-height:44px"></label><label class="f grow"><span>עד תאריך</span><input type="date" name="to" value="${esc(Y.to)}" required style="min-height:44px"></label></div><button class="btn w" style="min-height:48px">הצג</button></form>`:''}`;
 if(!Y.D&&!Y.load&&!Y.err&&(Y.per!=='custom'||(Y.from&&Y.to)))yLoad();
 if(Y.err)return{t:T,h:per+`<div class="card"><p>${esc(Y.err)}</p><button class="btn w" style="min-height:48px" data-a="cxYRe">נסה שוב</button></div>`};
 if(!Y.D)return{t:T,s:Y.per==='custom'&&!(Y.from&&Y.to)?'בחרו טווח תאריכים':'טוען…',h:per};
 const A=Y.T,D=Y.D,[f,t]=[D.f,D.t];
 const k=(l,v,cls,key,m)=>tile(l,v,cls,'cxYDl',key,m);
 const tabs=[['prod','מוצרים'],['hr','לפי שעה'],['reg','קופות'],['cat','קטגוריות'],['rec','התאמה לסגירת קופה'],['un','לא בטוח'+(A.un?' '+nf(A.un):'')]];
 let body='';
 if(Y.tab==='prod')body=prodH();else if(Y.tab==='hr')body=hrH();else if(Y.tab==='reg')body=regH();else if(Y.tab==='cat')body=catH();else if(Y.tab==='rec')body=recH();else body=unH();
 return{t:T,s:(f===t?df(f):df(f)+' – '+df(t))+(D.cfg&&D.cfg.lastSales?' · דוח אחרון נקלט '+new Date(D.cfg.lastSales.at).toLocaleDateString('he-IL'):''),h:per+(!D.days.length?`<div class="card"><p style="margin-top:0">אין מכירות מכספית בתקופה הזו.</p><p class="note">מעלים "דוח מכירות לפריטים" מכספית במסך "סנכרון כספית".</p><button class="btn w" style="min-height:48px" data-a="go" data-v="cxSync">לסנכרון כספית</button></div>`+(Y.tab==='rec'?recH():''):
  `<div class="card"><div class="kg">${k('הכנסה נטו (אחרי הנחות והחזרות)',A.net,'pos','net',1)}${k('פדיון מכירות',A.gross,'','gross',1)}${k('החזרות',A.ret,A.ret?'neg':'','ret',1)}${k('הנחות',A.disc,'','disc',1)}${k('עסקאות',A.ntx,'','ntx')}${k('לא בטוח',A.un,A.un?'neg':'','un')}</div><p class="note" style="margin-bottom:0">לחיצה על משבצת מציגה את הפירוט לפי יום, ומשם את העסקאות.${A.sp?' מתוך הפדיון, קודים מיוחדים (למשל פריט כללי): <bdi dir="ltr">'+ils(A.sp)+'</bdi>.':''}</p>${hrLine()}</div>
 <div class="chips scroll-x nw" role="tablist" style="margin:8px 0">${tabs.map(([id,l])=>`<button class="chip${Y.tab===id?' on':''}" role="tab" aria-selected="${Y.tab===id}" data-a="cxYTab" data-k="${id}" style="min-height:44px">${l}</button>`).join('')}</div>${body}`)}};
ACT.cxYPer=el=>{Y.per=el.dataset.k;Y.D=null;Y.err='';Y.n=PG;rerender()};
ACT.cxYRe=()=>{Y.D=null;Y.err='';rerender()};
FRM.cxYRange=f=>{const x=fd(f);if(!C.dateOf(x.from)||!C.dateOf(x.to)||x.from>x.to)return toast('טווח תאריכים לא תקין');if((Date.parse(x.to)-Date.parse(x.from))/864e5>400)return toast('טווח של עד 400 ימים');Y.from=x.from;Y.to=x.to;Y.D=null;Y.err='';rerender()};
ACT.cxYTab=el=>{Y.tab=el.dataset.k;Y.n=PG;rerender()};

/* ---- מוצרים: "כמה נמכר מכל מוצר" ---- */
function prodL(){let L=Y.T.items;if(Y.cat!=null)L=L.filter(i=>(i.cat||'')===Y.cat);return C.itemList(L,Y.sort,Y.s)}
const prodRow=i=>btn('cxYProd',`data-k="${esc(i.c)}"`,`<div class="m"><b>${esc(i.n||'(בלי שם)')}${i.u?' <span class="tag t1">לא בטוח</span>':''}${i.sp?' <span class="tag">קוד מיוחד</span>':''}</b><small>קוד ${esc(i.c)} · נמכרו <b>${nf(i.q)}</b>${i.r?' · הוחזרו <b>'+nf(i.r)+'</b>':''}</small></div><b dir="ltr" style="flex:none">${ils(i.a)}</b>`);
function prodListH(){const L=prodL(),S=L.slice(0,Y.n);return (S.map(prodRow).join('')||'<div class="empty">לא נמצאו מוצרים</div>')+(L.length>S.length?`<button class="btn g w" style="min-height:44px" data-a="cxYMore">הצג עוד (${nf(L.length-S.length)})</button>`:'')}
function prodH(){return `${Y.cat!=null?`<div class="row" style="margin-bottom:6px;align-items:center"><span class="tag t2">קטגוריה: ${esc(catN(Y.cat))}</span><button class="btn g s" style="min-height:44px" data-a="cxYCatX">הצג את כל המוצרים</button></div>`:''}
 <label class="f"><span>חיפוש מוצר (שם או קוד)</span><input data-i="cxYQ" value="${esc(Y.s)}" autocomplete="off" style="min-height:44px"></label>
 <div class="chips" role="group" style="margin-bottom:8px"><button class="chip${Y.sort==='q'?' on':''}" data-a="cxYSort" data-k="q" aria-pressed="${Y.sort==='q'}" style="min-height:44px">הכי נמכר</button><button class="chip${Y.sort==='a'?' on':''}" data-a="cxYSort" data-k="a" aria-pressed="${Y.sort==='a'}" style="min-height:44px">הכי הרבה פדיון</button></div>
 <div id="cxypl">${prodListH()}</div>`}
INP.cxYQ=el=>{Y.s=el.value;Y.n=PG;const e=document.getElementById('cxypl');if(e)e.innerHTML=prodListH()};
ACT.cxYSort=el=>{Y.sort=el.dataset.k==='a'?'a':'q';Y.n=PG;rerender()};
ACT.cxYMore=()=>{Y.n+=PG;const e=document.getElementById('cxypl');if(e)e.innerHTML=prodListH()};
ACT.cxYCatX=()=>{Y.cat=null;Y.n=PG;rerender()};
ACT.cxYProd=el=>{const i=Y.T.items.find(x=>x.c===el.dataset.k);if(!i)return;const ds=Object.keys(i.days).sort().reverse();
 dlg(`<h3>${esc(i.n||i.c)}</h3><p class="note" style="margin-top:0">קוד ${esc(i.c)} · ${esc(catN(i.cat))}</p><div class="kg"><div class="k"><small>נמכרו</small><b>${nf(i.q)}</b></div><div class="k"><small>הוחזרו</small><b>${nf(i.r)}</b></div><div class="k"><small>פדיון נטו</small><b dir="ltr">${ils(i.a)}</b></div>${i.u?`<div class="k neg"><small>שורות לא בטוחות</small><b>${nf(i.u)}</b></div>`:''}</div>
 <p class="note">לפי יום – לחיצה מציגה את העסקאות:</p><div style="max-height:45vh;overflow:auto">${ds.map(d=>{const v=i.days[d];return btn('cxYPL',`data-k="${esc(i.c)}" data-d="${d}"`,`<div class="m"><b>${esc(df(d))}</b><small>נמכרו ${nf(v.q)}${v.r?' · הוחזרו '+nf(v.r):''}${v.u?' · <span class="tag t1">לא בטוח</span>':''}</small></div><b dir="ltr" style="flex:none">${ils(v.a)}</b>`)}).join('')}</div>
 ${ds.length>1?`<button class="btn g w" style="min-height:44px;margin-top:8px" data-a="cxYPL" data-k="${esc(i.c)}" data-d="">כל העסקאות בתקופה</button>`:''}<button class="btn g w" style="min-height:44px;margin-top:8px" data-a="closeDlg">סגור</button>`)};
/* שורות (עסקאות) מהשרת: לפי מוצר+ימים או לפי יום+סניף */
const txH=(L,title,back)=>`<h3>${esc(title)}</h3><div style="max-height:60vh;overflow:auto">${L.map(x=>`<div class="card" style="margin:6px 0;padding:10px"><b>עסקה ${esc(x.tx)}</b> <small class="note">${esc(df(x.d))} · ${esc(x.bn||x.bk)}</small>${x.lines.map(l=>`<div class="row" style="justify-content:space-between;gap:8px;margin-top:6px;align-items:flex-start"><span style="min-width:0;overflow-wrap:anywhere">${esc(l.n||l.c)} <small class="note">קוד ${esc(l.c)}${typeof l.q==='number'?' · כמות '+nf(l.q):''}${l.ds?' · הנחה '+ils(l.ds):''}</small><br>${qsTag(l.qs,l.why)}</span><b dir="ltr" style="flex:none">${ils(l.a)}</b></div>`).join('')}</div>`).join('')||'<p class="note">לא נמצאו שורות</p>'}</div>${back||''}<button class="btn g w" style="min-height:44px;margin-top:8px" data-a="closeDlg">סגור</button>`;
async function txLoad(q,title){dlg(`<h3>${esc(title)}</h3><p class="note">טוען…</p>`);try{const r=await fnCall('cxLines',q);dlg(txH(r.tx,title))}catch(e){dlg(`<h3>${esc(title)}</h3><p class="note">${esc(e.message||'הטעינה נכשלה')}</p><button class="btn g w" style="min-height:44px" data-a="closeDlg">סגור</button>`)}}
ACT.cxYPL=el=>{const i=Y.T.items.find(x=>x.c===el.dataset.k);if(!i)return;const days=el.dataset.d?[el.dataset.d]:Object.keys(i.days);txLoad({c:i.c,days},(i.n||i.c)+(el.dataset.d?' · '+df(el.dataset.d):''))};

/* ---- משבצות הסיכום → פירוט לפי יום → עסקאות היום ---- */
const YDL={net:['הכנסה נטו',d=>d.net,1],gross:['פדיון מכירות',d=>d.gross,1],ret:['החזרות',d=>d.ret,1],disc:['הנחות',d=>d.disc,1],ntx:['עסקאות',d=>d.ntx,0]};
ACT.cxYDl=el=>{const k=el.dataset.k;if(k==='un'){Y.tab='un';rerender();return}const m=YDL[k];if(!m)return;
 dlg(`<h3>${m[0]} לפי יום</h3><div style="max-height:60vh;overflow:auto">${Y.T.days.map(d=>btn('cxYDay',`data-d="${d.d}"`,`<div class="m"><b>${esc(df(d.d))}</b><small>${nf(d.ntx)} עסקאות</small></div><b ${m[2]?'dir="ltr"':''} style="flex:none">${m[2]?ils(m[1](d)):nf(m[1](d))}</b>`)).join('')||'<p class="note">אין</p>'}</div><button class="btn g w" style="min-height:44px;margin-top:8px" data-a="closeDlg">סגור</button>`)};
async function dayTx(d,bks,title,flt){dlg(`<h3>${esc(title)}</h3><p class="note">טוען…</p>`);
 try{let L=[];for(const bk of bks){const r=await fnCall('cxLines',{bd:C.dayId(bk,d)});L=L.concat(r.tx)}if(flt)L=L.map(x=>Object.assign({},x,{lines:x.lines.filter(flt)})).filter(x=>x.lines.length);dlg(txH(L,title+' · '+nf(L.length)+' עסקאות'))}catch(e){dlg(`<h3>${esc(title)}</h3><p class="note">${esc(e.message||'הטעינה נכשלה')}</p><button class="btn g w" style="min-height:44px" data-a="closeDlg">סגור</button>`)}}
ACT.cxYDay=el=>{const d=el.dataset.d,bk=el.dataset.b;const bks=bk?[bk]:[...new Set(Y.D.days.filter(x=>x.d===d).map(x=>x.bk))];dayTx(d,bks,'עסקאות '+df(d)+(bk?' · '+((Y.T.br[bk]||{}).bn||bk):''))};

/* ---- C2: שעת מכירה – כמה מהפדיון הגיע עם שעה (cxDay.h: 'na' מול השאר), ופירוט לפי שעה לכל יום ---- */
/* cxDay.tm = { y, n, p, q } מהדוח האחרון שעדכן את היום: שורות עם/בלי שעה, ודפוס מוסווה של תא התאריך (d ספרה, a אות לועזית, h אות עברית) */
function hrStat(){const S=C.salesHours(Y.D.days);let k=0,a=0,tm=null,td='';
 for(const d of Object.keys(S.day)){const H=S.hours[d];if(!Object.keys(H).length){a+=Math.abs(S.day[d]);continue}for(const [h,v] of Object.entries(H)){a+=Math.abs(v);if(h!==C.HOUR_NA)k+=Math.abs(v)}}
 for(const x of Y.D.days)if(x&&x.tm&&typeof x.tm==='object'&&x.d>=td){tm=x.tm;td=x.d}
 const pct=!a?0:k>=a?100:Math.min(99,Math.max(k?1:0,Math.round(k/a*100)));return{S,pct,tm,a}}
function hrLine(){const {pct,tm,a}=hrStat();if(!a&&!tm)return '';const T=tm&&+tm.y+ +tm.n?` (בדוח האחרון: ${nf(tm.y)} מתוך ${nf(+tm.y+ +tm.n)} שורות)`:'';
 return `<p class="note" style="margin:6px 0 0">שעת מכירה: נמצאה ב-${pct}% מהפדיון${T}.${!pct&&tm&&tm.p?` הפורמט שהתקבל: <bdi dir="ltr"><code>${esc(tm.p)}</code></bdi> <small>(d = ספרה, a = אות לועזית, h = אות עברית)</small>`:''}</p>`}
const hrNm=h=>h===C.HOUR_NA?'בלי שעה':h+':00–'+String((+h+1)%24).padStart(2,'0')+':00';
function hrH(){const {S}=hrStat(),ds=Object.keys(S.day).sort().reverse(),has=ds.filter(d=>Object.keys(S.hours[d]).length),no=ds.filter(d=>!Object.keys(S.hours[d]).length);
 if(!has.length)return `<div class="card"><p class="note" style="margin:0">אין פילוח לפי שעה בתקופה הזו – בדוחות שנקלטו לא נמצאה שעת מכירה (או שנקלטו לפני העדכון).</p></div>`;
 return `<p class="note">פדיון נטו (אחרי הנחות והחזרות) לפי שעת המכירה. לחיצה על שעה מציגה את העסקאות.</p>`+has.map(d=>{const H=S.hours[d],ks=Object.keys(H).sort((x,y)=>x===C.HOUR_NA?1:y===C.HOUR_NA?-1:x<y?-1:1),mx=Math.max(...ks.map(h=>Math.abs(H[h])))||1;
  return `<div class="card" style="margin:8px 0"><div class="row" style="justify-content:space-between;gap:6px"><b>${esc(df(d))}</b><b dir="ltr">${ils(S.day[d])}</b></div>${ks.map(h=>btn('cxYHr',`data-d="${d}" data-h="${h}"`,`<span style="flex:none;width:96px;font-size:.85rem" dir="ltr">${esc(hrNm(h))}</span><span aria-hidden="true" style="flex:1;min-width:40px;height:10px;border-radius:5px;background:var(--line);position:relative;overflow:hidden"><span style="position:absolute;top:0;bottom:0;inset-inline-start:0;width:${Math.round(Math.abs(H[h])/mx*100)}%;background:${H[h]<0?'var(--warn)':'var(--acc)'}"></span></span><b dir="ltr" style="flex:none">${ils(H[h])}</b>`,'gap:8px;align-items:center;min-height:44px')).join('')}</div>`}).join('')
  +(no.length?`<p class="note">ימים בלי שעת מכירה: ${no.map(d=>esc(df(d))).join(', ')}</p>`:'')}
ACT.cxYHr=el=>{const d=el.dataset.d,h=el.dataset.h,bks=[...new Set(Y.D.days.filter(x=>x.d===d).map(x=>x.bk))];dayTx(d,bks,'עסקאות '+df(d)+' · '+hrNm(h),l=>C.hourKey(l.t)===h)};

/* ---- קופות (סניפים בכספית) ---- */
function regH(){const B=Object.values(Y.T.br).sort((a,b)=>b.net-a.net);return B.map(b=>btn('cxYReg',`data-k="${esc(b.bk)}"`,`<div class="m"><b>${esc(b.bn)}</b><small>${nf(b.ntx)} עסקאות · פדיון <bdi dir="ltr">${ils(b.gross)}</bdi>${b.ret?' · החזרות <bdi dir="ltr">'+ils(b.ret)+'</bdi>':''}${b.disc?' · הנחות <bdi dir="ltr">'+ils(b.disc)+'</bdi>':''}</small></div><b dir="ltr" style="flex:none">${ils(b.net)}</b>`)).join('')||'<div class="empty">אין</div>'}
ACT.cxYReg=el=>{const bk=el.dataset.k,L=Y.D.days.filter(x=>x.bk===bk).sort((a,b)=>a.d<b.d?1:-1);
 dlg(`<h3>${bkN(bk)} לפי יום</h3><div style="max-height:60vh;overflow:auto">${L.map(x=>btn('cxYDay',`data-d="${x.d}" data-b="${esc(bk)}"`,`<div class="m"><b>${esc(df(x.d))}</b><small>${nf(x.ntx)} עסקאות</small></div><b dir="ltr" style="flex:none">${ils((x.gross||0)-(x.ret||0)-(x.disc||0))}</b>`)).join('')}</div><button class="btn g w" style="min-height:44px;margin-top:8px" data-a="closeDlg">סגור</button>`)};

/* ---- קטגוריות ---- */
function catH(){const L=Object.values(Y.T.cats).sort((a,b)=>b.a-a.a);return L.map(c=>btn('cxYCat',`data-k="${esc(c.cat)}"`,`<div class="m"><b>${esc(catN(c.cat))}</b><small>${nf(c.n)} מוצרים · ${nf(c.q)} יחידות נטו</small></div><b dir="ltr" style="flex:none">${ils(c.a)}</b>`)).join('')||'<div class="empty">אין</div>'}
ACT.cxYCat=el=>{Y.cat=el.dataset.k;Y.tab='prod';Y.n=PG;rerender()};

/* ---- לא בטוח: אישור / תיקון כמות ---- */
async function unLoad(){try{const r=await fnCall('cxLines',{un:true});Y.U=r.tx}catch(e){Y.U={err:e.message||'הטעינה נכשלה'}}if(cur().v==='cxSales'&&Y.tab==='un')rerender()}
function unH(){if(!Y.U){unLoad();return '<p class="note">טוען…</p>'}if(Y.U.err)return `<div class="card"><p>${esc(Y.U.err)}</p><button class="btn w" style="min-height:48px" data-a="cxYUnRe">נסה שוב</button></div>`;
 const L=Y.U.flatMap(x=>x.lines.map(l=>Object.assign({id:x.id,d:x.d,tx:x.tx,bn:x.bn},l)));
 return `<p class="note">שורות שבהן הכמות חושבה ולא יצאה מספר שלם (מכל התקופות). הכמות המוצעת כבר ירדה מהמלאי. "אישור" = הכמות נכונה. שינוי הכמות מעדכן את המלאי בהפרש.</p>`+(L.map(l=>`<form class="li" data-f="cxYFix" data-id="${esc(l.id)}" data-k="${esc(l.k)}" data-am="${+l.a||0}" style="cursor:default;flex-wrap:wrap"><div class="m" style="flex:1 1 100%;min-width:0"><b>${esc(l.n||l.c)}</b><small>קוד ${esc(l.c)} · ${esc(df(l.d))} · עסקה ${esc(l.tx)} · ${esc(l.bn||'')}</small><small>פדיון <bdi dir="ltr">${ils(l.a)}</bdi>${l.P?' · מחיר <bdi dir="ltr">'+ils(l.P)+'</bdi>':''} · ${esc(C.UNSURE_WHY[l.why]||'')}</small></div><div class="row" style="flex:1 1 100%;gap:8px;align-items:flex-end"><label class="f grow" style="margin:0"><span>כמות</span><input name="q" inputmode="decimal" dir="ltr" value="${esc(String(l.q))}" required style="min-height:44px"></label><button class="btn" style="min-height:48px">אישור</button></div></form>`).join('')||'<div class="empty">✓ אין שורות לבדיקה</div>')}
ACT.cxYUnRe=()=>{Y.U=null;rerender()};
FRM.cxYFix=async f=>{const v=C.num(fd(f).q);if(Number.isNaN(v)||Math.abs(v)>100000)return toast('כמות לא תקינה');if(!C.qSignOk(+f.dataset.am,v))return toast(+f.dataset.am<0?'בהחזרה הכמות שלילית (או 0)':'במכירה הכמות חיובית (או 0)');const b=f.querySelector('button');b.disabled=true;
 try{const r=await fnCall('cxFix',{id:f.dataset.id,k:f.dataset.k,q:v});toast(r.delta?'✓ הכמות תוקנה והמלאי עודכן':'✓ אושר');Y.U=null;Y.D=null;Y.tab='un';rerender();if(r.delta&&typeof window.__oxReload==='function')window.__oxReload()}catch(e){b.disabled=false;err(e)}};

/* ---- התאמה מול סגירת קופה ---- */
/* סגירות הקופה במכשיר: סכום ההכנסות שנכנסו מכל סגירה (S.tx של הסגירה, כולל כל אמצעי התשלום) */
function zcList(f,t){if(typeof S==='undefined'||!S||!Array.isArray(S.zc))return[];const by=new Map((S.tx||[]).map(x=>[x.id,x]));
 return S.zc.filter(z=>z&&z.d&&z.d>=f&&z.d<=t).map(z=>{const T=(z.tx||[]).map(id=>by.get(id)).filter(x=>x&&!x.x);return{id:z.id,reg:z.reg,d:z.d,od:z.od||'',tm:z.tm||'',otm:z.otm||'',no:z.no||'',by:z.by||'',amt:Math.round(T.reduce((s,x)=>s+(+x.amt||0),0)*100)/100,T}})}
const regNm=r=>(typeof ZREG!=='undefined'&&ZREG[r]&&ZREG[r].n)||r;
function regMap(){return(Y.D&&Y.D.cfg&&Y.D.cfg.reg)||{}}
function mapH(){if(!zcOn())return '';const reg=regMap(),bks=new Map();for(const x of(Y.D?Y.D.days:[]))bks.set(x.bk,x.bn||x.bk);for(const k of Object.keys(reg))if(!bks.has(k))bks.set(k,k);
 if(!bks.size)return '';const sug=bn=>{const h=Object.keys(ZREG).filter(k=>ZREG[k].k.test(String(bn||'')));return h.length===1?h[0]:''};const all=[...bks].every(([bk])=>reg[bk]);
 return `<details class="card"${all?'':' open'}><summary style="min-height:44px;display:flex;align-items:center"><b>חיבור קופות כספית לקופות בסגירת הקופה</b>${all?'':' <span class="tag t1" style="margin-inline-start:6px">צריך לחבר</span>'}</summary><form data-f="cxRegF"><p class="note" style="margin-top:0">פעם אחת: איזו קופה בכספית היא איזו קופה בסגירת הקופה באפליקציה.</p>${[...bks].map(([bk,bn])=>`<label class="f"><span>${esc(bn)}${bk!==bn?' ('+esc(bk)+')':''}</span><select name="r_${esc(bk)}" style="min-height:44px"><option value="">לא מחובר</option>${Object.keys(ZREG).map(k=>`<option value="${k}"${(reg[bk]||(!reg[bk]&&!all?sug(bn):''))===k?' selected':''}>${esc(ZREG[k].n)}</option>`).join('')}</select></label>`).join('')}<button class="btn w" style="min-height:48px">שמירה</button></form></details>`}
FRM.cxRegF=async f=>{const x=fd(f),reg={};for(const [k,v] of Object.entries(x))if(k.startsWith('r_'))reg[k.slice(2)]=v||'';const b=f.querySelector('button');b.disabled=true;
 try{const r=await fnCall('cxSetCfg',{reg});if(Y.D)Y.D.cfg.reg=r.reg||{};toast('נשמר');rerender()}catch(e){b.disabled=false;err(e)}};
const RCLS={ok:'t3',gap:'t1',over:'t4',noz:'',nocx:'',span:'',part:'',none:''};
const rTag=(st,gap)=>`<span class="tag ${RCLS[st]||''}">${st==='ok'?'✓ תואם':st==='gap'||st==='over'?'פער <bdi dir="ltr">'+ils(gap)+'</bdi>'+(st==='over'?' – מעל הסף':''):esc(C.RST[st]||st)}</span>`;
function recH(){if(!zcOn())return '<div class="card"><p class="note" style="margin:0">סגירת קופה לא פעילה בעסק – אין מול מה להשוות.</p></div>';
 const D=Y.D,reg=regMap();if(!Object.keys(reg).length)return mapH()+'<div class="card"><p class="note" style="margin:0">כדי להשוות, מחברים קודם את קופות כספית לקופות של סגירת הקופה (למעלה).</p></div>';
 const zc=zcList(D.f,D.t),th=typeof zcThr==='function'?zcThr():0,R=C.recon(D.days,reg,zc,th,Object.keys(ZREG));Y.R=R;Y.ZC=zc;
 const money=(a,key,v)=>`<button type="button" class="btn g s" data-a="${a}" data-k="${key}" style="min-height:44px;min-width:0"><bdi dir="ltr">${ils(v)}</bdi></button>`;
 return mapH()+`<p class="note">לכל יום ולכל קופה: ההכנסה בכספית (פדיון פחות הנחות והחזרות) מול ההכנסות שנכנסו מסגירת הקופה.${th?' סף הפער: '+ils(th)+'.':' לא הוגדר סף פער (בהגדרות).'} לחיצה על סכום מציגה את השורות.</p>`+(R.map(x=>`<div class="card" style="margin:8px 0"><div class="row" style="justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap"><b>${esc(df(x.d))}</b>${rTag(x.tot.st,x.tot.gap)}</div>
 ${x.regs.filter(c=>c.st!=='none').map(c=>`<div style="border-top:1px solid var(--line);margin-top:8px;padding-top:8px"><div class="row" style="justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap"><b>${esc(regNm(c.reg))}</b>${rTag(c.st,c.gap)}</div>
 ${c.sx&&c.sx.length?`<p class="note" style="margin:4px 0 0">${c.sx.map(z=>'דוח Z '+esc(z.no||'—')+' נפתח ביום הזה ('+esc(df(z.od))+') ונסגר ב-'+esc(df(z.d))).join(' · ')} – חלק מהכסף של היום נמצא בסגירה ההיא.</p>`:''}<div class="row" style="gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px"><span class="note" style="margin:0">כספית</span>${c.hasCx?money('cxYRc',x.d+'|'+c.reg,c.cx):'<span>—</span>'}<span class="note" style="margin:0">סגירה</span>${c.zs.length?money('cxYRz',x.d+'|'+c.reg,c.z):'<span>—</span>'}</div>${c.sp?`<p class="note" style="margin:4px 0 0">מתוך הסכום בכספית, קודים מיוחדים (שוברים, תשלום חוב, פריט כללי): <bdi dir="ltr">${ils(c.sp)}</bdi></p>`:''}</div>`).join('')}
 ${x.regs.filter(c=>c.st!=='none').length>1?`<div class="row" style="border-top:1px solid var(--line);margin-top:8px;padding-top:8px;gap:8px;flex-wrap:wrap"><b>סך היום</b><span class="note" style="margin:0">כספית <bdi dir="ltr">${ils(x.tot.cx)}</bdi> · סגירות <bdi dir="ltr">${ils(x.tot.z)}</bdi></span></div>`:''}
 ${x.un.length?`<p class="note" style="color:var(--warn)">קופה בכספית שלא חוברה: ${x.un.map(u=>esc(u.bn)+' <bdi dir="ltr">'+ils(u.net)+'</bdi>').join(', ')}</p>`:''}</div>`).join('')||'<div class="empty">אין נתונים להשוואה בתקופה</div>')}
ACT.cxYRc=el=>{const [d,rg]=el.dataset.k.split('|'),reg=regMap(),bks=[...new Set(Y.D.days.filter(x=>x.d===d&&reg[x.bk]===rg).map(x=>x.bk))];dayTx(d,bks,'כספית · '+regNm(rg)+' · '+df(d))};
ACT.cxYRz=el=>{const [d,rg]=el.dataset.k.split('|'),Z=(Y.ZC||[]).filter(z=>z.d===d&&z.reg===rg);const sn=t=>typeof subName==='function'?subName(t):'';
 dlg(`<h3>סגירת קופה · ${esc(regNm(rg))} · ${esc(df(d))}</h3><div style="max-height:60vh;overflow:auto">${Z.map(z=>`<div class="card" style="margin:6px 0;padding:10px"><b>דוח Z ${esc(z.no||'—')}</b> <small class="note">${z.tm?esc(z.tm):''}${z.od&&z.od!==z.d?' · נפתחה ב-'+esc(df(z.od))+(z.otm?' '+esc(z.otm):''):''}${z.by?' · '+esc(z.by):''}</small>${z.T.map(t=>`<div class="row" style="justify-content:space-between;gap:8px;margin-top:6px"><span>${esc(sn(t)||t.note||'הכנסה')}</span><b dir="ltr">${ils(t.amt)}</b></div>`).join('')||'<p class="note">ההכנסות של הסגירה לא נמצאו במכשיר</p>'}<div class="row" style="justify-content:space-between;border-top:1px solid var(--line);margin-top:6px;padding-top:6px"><b>סה"כ</b><b dir="ltr">${ils(z.amt)}</b></div></div>`).join('')||'<p class="note">אין</p>'}</div><button class="btn g w" style="min-height:44px;margin-top:8px" data-a="closeDlg">סגור</button>`)};

/* ===================== C1: מכירות לפי יום ולפי שעה – לבונוסי מכירות בשכר ===================== */
/* window.CxHours (מכשיר המנהל; cxSales מותר למנהל בלבד). mon = 'YYYY-MM', br = מספר סניף בכספית (bk, למשל '6200'); בלי br – כל הסניפים.
   month(mon,br) → Promise<{ 'YYYY-MM-DD': { 'HH': ש"ח, na?: ש"ח } }>  ·  days(mon,br) → Promise<{ 'YYYY-MM-DD': ש"ח נטו }>  ·  get(mon,br) → Promise<{ day, hours }>
   סכומים = פדיון נטו (אחרי הנחות, החזרות במינוס), כמו "הכנסה נטו" במסך. יום בלי פילוח שעות (נתונים ישנים) → {} (הקורא מחליט). C.salesHours.
   מקור: מה שמסך המכירות כבר טען (אם הטווח מכסה את החודש), אחרת קריאת cxSales אחת לחודש, שמורה 10 דקות. נמחק אחרי קליטת דוח מכירות. */
const HC=new Map(),HTTL=6e5;
function hDays(mon){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(mon||'')))return Promise.reject(new Error('חודש לא תקין (YYYY-MM)'));
 const f=mon+'-01',l=new Date(Date.UTC(+mon.slice(0,4),+mon.slice(5,7),0)).toISOString().slice(0,10),t0=ymd(new Date()),need=l<t0?l:t0;
 if(Y.D&&Y.D.f<=f&&Y.D.t>=need)return Promise.resolve(Y.D.days.filter(x=>x&&x.d>=f&&x.d<=l));
 const c=HC.get(mon);if(c&&Date.now()-c.at<HTTL)return c.p;
 const p=fnCall('cxSales',{from:f,to:l}).then(x=>C.unpackDays(x).map(d=>{delete d.it;return d}));
 HC.set(mon,{at:Date.now(),p});p.catch(()=>{if(HC.get(mon)&&HC.get(mon).p===p)HC.delete(mon)});
 return p}
window.CxHours={
 get:(mon,br)=>hDays(mon).then(D=>C.salesHours(D,br||'')),
 month:(mon,br)=>hDays(mon).then(D=>C.salesHours(D,br||'').hours),
 days:(mon,br)=>hDays(mon).then(D=>C.salesHours(D,br||'').day),
 clear:()=>HC.clear()};
})();
