/* קופה והפקדות – מסך מנהל (סבב 4, חבילה א', 18.11.2026). נטען אחרי index.html; בלי הקובץ הזה האפליקציה נשארת כמו קודם.
   לשוניות "סגירות" / "הוצאות מקופה"; בורר תקופה (השבוע / החודש / טווח, עד 12 חודשים) ובורר קופה; כרטיס סיכום (סך פערים עם כיוון,
   הוצאות שממתינות להפקדה, סגירות שממתינות לאישור); רשימת סגירות (לחיצה = הפירוט הקיים של "סיכום סגירות קופה", zsRowH/zsDetH);
   פתקי הוצאה מקופה (סיבה, סכום, תאריך, הופקד / ממתין); טבלת פערים לפי עובד.
   אין כאן קריאות חדשות לשרת: הסגירות, ההוצאות שלהן וההפקדות נטענות בחודשים דרך zsLoad (אותו מטמון ZS.D של "סיכום סגירות קופה"),
   וההוצאות שעוד לא שויכו – דרך coLoad. הפער של כל סגירה – zcRes הקיים (חוסר / עודף / מאוזן). מנהל בלבד, מאחורי bzF('cashClose'). שום דבר לא נשמר במכשיר. */
(function(){'use strict';
if(typeof V==='undefined'||typeof zsLoad!=='function'||typeof zcRes!=='function'||typeof ZS==='undefined')return;
if(typeof BZV==='object'&&BZV)BZV.cm='cashClose';
const MAXM=12;
const CM={tab:'z',per:'w',a:'',b:'',reg:'',busy:0};

/* ---- עיצוב: רק משתני ערכת הנושא ---- */
const st=document.createElement('style');st.textContent=`
.cmg-tabs{display:flex;background:var(--card);border-radius:12px;padding:3px;margin:4px 0 10px}
.cmg-tabs button{flex:1;border:0;background:none;padding:9px;border-radius:10px;font:inherit;font-weight:700;font-size:.9rem;color:var(--mut);cursor:pointer}
.cmg-tabs button.a{background:var(--acc);color:var(--onacc)}
.cmg-sel{display:flex;gap:6px;margin-bottom:8px;align-items:center}
.cmg-sel select,.cmg-sel input{flex:1;min-width:0;background:var(--srf-3);color:var(--ink);border:1px solid var(--line);border-radius:10px;padding:8px;font:inherit;font-size:.85rem}
.cmg-sums{display:flex;gap:6px;text-align:center}
.cmg-sums>button{border:0;font-family:inherit;cursor:pointer;flex:1;background:var(--srf-3);border-radius:10px;padding:8px 2px;font-size:.75rem;color:var(--mut)}
.cmg-sums b{display:block;font-size:1.15rem;color:var(--ink)}
.cmg-list{padding:2px 12px}
.cmg-li{display:flex;align-items:center;gap:8px;padding:9px 0;border:0;border-bottom:1px solid var(--line);font:inherit;font-size:.85rem;color:var(--ink);background:none;width:100%;text-align:start;box-sizing:border-box}
button.cmg-li{cursor:pointer}
.cmg-list>.cmg-li:last-child{border-bottom:0}
.cmg-list>.card{margin:8px 0}
.cmg-dot{width:11px;height:11px;border-radius:50%;flex:none}
.cmg-gap{margin-inline-start:auto;font-weight:800;white-space:nowrap}
.cmg-pill{border-radius:20px;padding:1px 9px;font-size:.75rem;font-weight:700;border:1px solid;white-space:nowrap}
.cmg-emp{overflow-x:auto}
.cmg-emp table{width:100%;border-collapse:collapse;font-size:.8rem}
.cmg-emp th,.cmg-emp td{padding:6px 3px;border-bottom:1px solid var(--line);text-align:center;vertical-align:top}
.cmg-emp th{color:var(--mut);font-weight:700}
.cmg-emp td:first-child,.cmg-emp th:first-child{text-align:start}
.cmg-emp tr:last-child td{border-bottom:0}
.cmg-emp small{display:block;color:var(--mut)}
`;document.head.appendChild(st);

/* ---- תקופה ---- */
const sunday=()=>{const d=new Date();d.setDate(d.getDate()-d.getDay());return ymd(d)};/* שבוע ישראלי: ראשון–שבת */
function range(){const t=today();if(CM.per==='m')return[NOWM()+'-01',t];
 if(CM.per==='r'){let a=coDate(CM.a)||t,b=coDate(CM.b)||t;if(a>b){const x=a;a=b;b=x}const lo=addMon(b.slice(0,7),-(MAXM-1))+'-01';return[a<lo?lo:a,b]}
 return[sunday(),t]}
function months(a,b){const out=[];let m=a.slice(0,7);while(m<=b.slice(0,7)&&out.length<MAXM){out.push(m);m=addMon(m,1)}return out}
/* פער עם כיוון לסגירה: חוסר במינוס, עודף בפלוס, מאוזן / לא ניתן לבדוק = 0 */
const sg=r=>r.k==='bad'?-r.a:r.k==='warn'?r.a:0;

/* ---- טעינה: חודש אחרי חודש דרך zsLoad (חודש שכבר נטען – מהמטמון) ---- */
const re=()=>{if(cur().v==='cm'&&!document.querySelector('#dlg[open] form'))rerender()};
async function load(force){if(CM.busy)return;const[a,b]=range(),M=months(a,b);if(force)M.forEach(m=>{delete ZS.D[m]});if(M.every(m=>ZS.D[m]))return;CM.busy=1;
 try{for(const m of M){while(ZS.b){try{await ZS.b}catch(e){}}if(!ZS.D[m])await zsLoad(m)}}catch(e){}finally{CM.busy=0}re()}

/* הנתונים של התקופה והקופה שנבחרו. Z: {z,D,m} – הסגירה, החודש שלה ב-ZS.D ומפתח החודש. CO: הוצאות מקופה (של הסגירות שנטענו ושלא שויכו עדיין) */
function rows(){const[a,b]=range(),M=months(a,b),Z=[],C=new Map(),err=[];let miss=0;
 M.forEach(m=>{const D=ZS.D[m];if(!D){miss++;return}if(D.err&&!err.includes(D.err))err.push(D.err);(D.L||[]).forEach(z=>{const d=z.f&&z.f.d||'';if(d>=a&&d<=b&&(!CM.reg||z.reg===CM.reg))Z.push({z,D,m})});(D.C||[]).forEach(x=>C.set(x.id,x))});
 ((typeof COQ!=='undefined'&&COQ.L)||[]).forEach(x=>C.set(x.id,x));
 const CO=[...C.values()].filter(x=>x.d&&x.d>=a&&x.d<=b&&(!CM.reg||x.reg===CM.reg)).sort((p,q)=>q.d.localeCompare(p.d)||(q.tm||'').localeCompare(p.tm||'')||(q.t||0)-(p.t||0));
 Z.sort((p,q)=>q.z.f.d.localeCompare(p.z.f.d)||(q.z.tm||'').localeCompare(p.z.tm||'')||(q.z.t||0)-(p.z.t||0));
 return{a,b,M,Z,CO,err,miss}}
/* סיכום: G = סך הפערים עם כיוון (בלי סגירות שנדחו), W = הוצאות שממתינות להפקדה, N = סגירות שממתינות לאישור */
function sums(R){const live=R.Z.filter(x=>x.z.st!=='rej');return{G:rnd(sum(live,x=>sg(zcRes(x.z.c)))),W:rnd(sum(R.CO.filter(x=>x.dep==='1'&&!x.dp),x=>x.a)),N:R.Z.filter(x=>x.z.st==='new').length}}
/* היסטוריית פערים לפי עובד (בלי סגירות שנדחו): סגירות, חוסרים (מספר וסכום), עודפים (מספר וסכום), ממוצע = סך הפערים עם כיוון חלקי הסגירות שאפשר היה לבדוק.
   המפתח: מזהה המשתמש (uid) ששלח; סגירה שנשמרה רק במכשיר – לפי השם. השם המוצג – מהסגירה האחרונה */
function emp(Z){const E=new Map();Z.filter(x=>x.z.st!=='rej').forEach(({z})=>{const k=z.ow?'u:'+z.ow:'n:'+(z.by||'—');let e=E.get(k);if(!e){e={by:z.by||'—',n:0,cn:0,t:0,sn:0,sa:0,on:0,oa:0};E.set(k,e)}
  const r=zcRes(z.c);e.n++;if(r.k){e.cn++;e.t+=sg(r)}if(r.k==='bad'){e.sn++;e.sa+=r.a}else if(r.k==='warn'){e.on++;e.oa+=r.a}});
 return[...E.values()].map(e=>({by:e.by,n:e.n,cn:e.cn,sn:e.sn,sa:rnd(e.sa),on:e.on,oa:rnd(e.oa),avg:e.cn?rnd(e.t/e.cn):null})).sort((p,q)=>q.sa-p.sa||q.n-p.n||p.by.localeCompare(q.by,'he'))}

/* ---- תצוגה ---- */
const dd=d=>d?d.slice(8,10)+'.'+d.slice(5,7):'—';
const sgn=v=>Math.abs(v)<0.005?'0':(v<0?'−':'+')+ils(Math.abs(v));
const kc=v=>Math.abs(v)<0.005?'inc':v<0?'bad':'warn';
const pill=(t,k)=>`<span class="cmg-pill" style="color:var(--${k});border-color:var(--${k})">${esc(t)}</span>`;
function zRow(x){const z=x.z;if(ZS.open===z.id)return zsRowH(z,x.D);const r=zcRes(z.c),k=r.k||'mut';
 const g=r.k==='bad'?'חוסר <span dir="ltr">'+ils(r.a)+'</span>':r.k==='warn'?'עודף <span dir="ltr">'+ils(r.a)+'</span>':r.k==='inc'?'מאוזן':'לא ניתן לבדוק';
 return `<button type="button" class="cmg-li" data-a="cmgOpen" data-id="${esc(z.id)}" data-m="${esc(x.m)}" aria-label="פירוט הסגירה"><span class="cmg-dot" style="background:var(--${k})"></span><span dir="ltr">${esc(dd(z.f.d))}</span><span style="min-width:0;overflow-wrap:anywhere">${esc((ZREG[z.reg]||{}).n||'')} · ${esc(z.by||'—')}${z.st==='new'?' '+pill('ממתין','warn'):z.st==='rej'?' '+pill('נדחה','bad'):''}</span><span class="cmg-gap" style="color:var(--${k})">${g}</span></button>`}
function cRow(x){return `<div class="cmg-li"><span style="flex:1;min-width:0;overflow-wrap:anywhere">${esc(x.why||'—')}<br><small class="note" style="margin:0"><span dir="ltr">${esc(dd(x.d))}</span>${CM.reg?'':' · '+esc((ZREG[x.reg]||{}).n||'')} · ${esc(x.by||'—')}</small></span><b dir="ltr">${ils(x.a)}</b>${x.dep==='1'?(x.dp?pill('הופקד','inc'):pill('ממתין להפקדה','warn')):''}</div>`}
function empH(Z){const E=emp(Z);if(!E.length)return '';const n=(c,a)=>c?`${c}<small dir="ltr">${ils(a)}</small>`:'0';
 return `<div class="sec"><h3>פערים לפי עובד</h3></div><div class="card cmg-emp"><table><thead><tr><th>עובד</th><th>סגירות</th><th>חוסרים</th><th>עודפים</th><th>ממוצע</th></tr></thead><tbody>${E.map(e=>`<tr><td>${esc(e.by)}</td><td>${e.n}</td><td style="color:${e.sn?'var(--bad)':'inherit'}">${n(e.sn,e.sa)}</td><td style="color:${e.on?'var(--warn)':'inherit'}">${n(e.on,e.oa)}</td><td dir="ltr" style="color:var(--${e.avg==null?'mut':kc(e.avg)})">${e.avg==null?'—':sgn(e.avg)}</td></tr>`).join('')}</tbody></table>
 <p class="note" style="margin:6px 0 0">חוסר ועודף – לפי שרשרת הבדיקות של כל סגירה. ממוצע = סך הפערים (חוסר במינוס, עודף בפלוס) חלקי הסגירות שאפשר היה לבדוק. בלי סגירות שנדחו.</p></div>`}

V.cm=()=>{const T='קופה והפקדות';if(!isA())return{t:T,s:'',h:'<div class="card"><p class="note">המסך הזה למנהל בלבד.</p></div>'};
 const R=rows();if(R.miss&&!CM.busy)load().catch(()=>{});if(typeof COQ!=='undefined'&&!COQ.L&&!COQ.b&&!COQ.err)coLoad().then(re).catch(re);
 const X=sums(R),ld=R.miss>0,opt=(v,t,s)=>`<option value="${v}" ${s===v?'selected':''}>${t}</option>`;
 const tabs=`<div class="cmg-tabs" role="tablist">${[['z','סגירות'],['c','הוצאות מקופה']].map(([k,t])=>`<button type="button" role="tab" data-a="cmgTab" data-k="${k}" aria-selected="${CM.tab===k}" class="${CM.tab===k?'a':''}">${t}</button>`).join('')}</div>`;
 const sel=`<div class="cmg-sel"><select data-c="cmgPer" aria-label="תקופה">${opt('w','השבוע',CM.per)}${opt('m','החודש',CM.per)}${opt('r','טווח תאריכים',CM.per)}</select><select data-c="cmgReg" aria-label="קופה">${opt('','שתיהן',CM.reg)}${Object.keys(ZREG).map(k=>opt(k,esc(ZREG[k].n),CM.reg)).join('')}</select><button class="btn g s" data-a="cmgRe" ${CM.busy?'disabled':''}>רענן</button></div>`
  +(CM.per==='r'?`<div class="cmg-sel"><input type="date" data-c="cmgA" aria-label="מתאריך" value="${esc(CM.a||R.a)}" max="${today()}"><span>עד</span><input type="date" data-c="cmgB" aria-label="עד תאריך" value="${esc(CM.b||R.b)}" max="${today()}"></div>`:'')
  +`<p class="note" style="margin:0 0 8px">${esc(dfmt(R.a))} – ${esc(dfmt(R.b))}${CM.per==='r'&&R.M.length>=MAXM?' · עד 12 חודשים':''}</p>`;
 const sumH=`<div class="card"><div class="cmg-sums"><button type="button" data-a="cmgK" data-k="g">סך פערים ‹<b dir="ltr" style="color:var(--${kc(X.G)})">${ld?'…':sgn(X.G)}</b></button><button type="button" data-a="cmgK" data-k="w">ממתין להפקדה ‹<b dir="ltr" style="color:var(--${X.W>=0.005?'warn':'ink'})">${ld?'…':ils(X.W)}</b></button><button type="button" data-a="cmgK" data-k="n">ממתין לאישור ‹<b>${ld?'…':X.N}</b></button></div></div>`;
 const err=R.err.map(e=>`<p class="note" style="color:var(--bad)">${esc(e)}</p>`).join('')+(CM.tab==='c'&&typeof COQ!=='undefined'&&COQ.err?`<p class="note" style="color:var(--bad)">${esc(COQ.err)}</p>`:'');
 let body;
 if(ld)body='<p class="note" style="padding:8px">טוען…</p>';
 else if(CM.tab==='z')body=(R.Z.length?`<div class="card cmg-list">${R.Z.map(zRow).join('')}</div>`:'<p class="note">אין סגירות בתקופה הזו.</p>')+empH(R.Z);
 else{const cut=ymd(new Date(Date.now()-62*864e5));
  body=(R.CO.length?`<div class="card cmg-list">${R.CO.map(cRow).join('')}</div>`:'<p class="note">אין הוצאות מקופה בתקופה הזו.</p>')+(R.a<cut?'<p class="note">לפני 62 הימים האחרונים מוצגות רק הוצאות של סגירות שאושרו.</p>':'')}
 return{t:T,s:'מנהל',h:tabs+sel+sumH+err+body}};

ACT.cmgTab=el=>{CM.tab=el.dataset.k==='c'?'c':'z';rerender()};
/* 19.11.2026: לחיצה על סכום בכרטיס הסיכום – הרשימה שמרכיבה אותו (אותם נתונים כמו sums) */
ACT.cmgK=el=>{const R=rows();if(R.miss)return;const k=el.dataset.k,X=sums(R);
 if(k==='g'){const L=R.Z.filter(x=>x.z.st!=='rej'&&Math.abs(sg(zcRes(x.z.c)))>=0.005);kDlg('סך פערים',L.map(zRow).join('')?`<div class="cmg-list">${L.map(zRow).join('')}</div>`:'',kFoot('סה״כ',sgn(X.G)))}
 else if(k==='w'){const L=R.CO.filter(x=>x.dep==='1'&&!x.dp);kDlg('ממתין להפקדה',L.length?`<div class="cmg-list">${L.map(cRow).join('')}</div>`:'',kFoot('סה״כ',ils(X.W)))}
 else{const L=R.Z.filter(x=>x.z.st==='new');kDlg('ממתין לאישור',L.length?`<div class="cmg-list">${L.map(zRow).join('')}</div>`:'',kFoot('סה״כ',String(L.length))+(L.length?'<button class="btn w" style="margin-top:8px" data-a="kGo" data-v="zc">לסגירות לאישור</button>':''))}};
ACT.cmgOpen=el=>{closeDlg();ZS.m=el.dataset.m;ZS.open=el.dataset.id;rerender()};/* ZS.m – בשביל הצילומים והפתקים בפירוט הקיים (zsImg / zsCoPic) */
ACT.cmgRe=()=>{if(CM.busy)return;if(typeof COQ!=='undefined'&&!COQ.b)coLoad().then(re).catch(re);load(1).catch(()=>{});rerender()};
CHG.cmgPer=el=>{CM.per=['w','m','r'].includes(el.value)?el.value:'w';if(CM.per==='r'&&!CM.a){const[a,b]=[NOWM()+'-01',today()];CM.a=a;CM.b=b}rerender()};
CHG.cmgReg=el=>{CM.reg=zcRegOk(el.value)?el.value:'';rerender()};
CHG.cmgA=el=>{CM.a=coDate(el.value)||'';rerender()};
CHG.cmgB=el=>{CM.b=coDate(el.value)||'';rerender()};
/* לבדיקות */
window.CMG={CM,range,months,rows,sums,emp,sg};
})();
