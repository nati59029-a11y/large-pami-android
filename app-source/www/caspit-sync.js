/* סנכרון כספית – שלב A1 (17.11.2026). מסך V.cxSync: מנהל בלבד (השרת אוכף: functions/caspit.js; כאן רק מה מוצג).
   1. בוחרים קובץ "קטלוג פריטים" מכספית (Excel/CSV) → קריאה בטלפון וקיבוץ לפי קוד (CaspitCore.groupCat) → שליחה לשרת בחלקים (cxUpload).
   2. תצוגה מקדימה (cxPreview): מונים למעלה, ורשימות בכרטיסיות (100 שורות בכל עמוד). אפשר להוריד סימון משורות "חדש" ו"מכספית".
   3. "אשר ושמור" (cxApply, בחלקים, עד שמסתיים). לפני הפעם הראשונה השרת שומר גיבוי של המוצרים ("שחזור מלאי מגיבוי").
   4. "קבצים לכספית" (cxExport): פריטים חדשים / עדכון מחיר – CSV בדיוק לפי התבניות של כספית.
   רכיבי העיצוב הקיימים בלבד (.card .btn .chip .li .tag .note .kg .k .empty .f). משתמש ב: V, ACT, CHG, FRM, fnCall, esc, ils, toast, dlg, closeDlg, ask,
   rerender, readTable, parseCsv, saveFile, fd, SY, CaspitCore.
   A2 (17.11): קובץ שזוהה כ"דוח מכירות לפריטים" עובר ל-caspit-sales.js (window.cxSalesFile → מסך cxSalesPv). CSV נקרא כבייטים ומפוענח
   ב-CaspitCore.decode (UTF-8, ואם לא – windows-1255, כמו שכספית מוציאה), גם בקטלוג.
   שלב B (18.11): כרטיס "רובוט – מחשב החנות" – caspit-bot.js (window.cxBotCardH). */
(function(){
'use strict';
if(typeof ACT==='undefined'||typeof V==='undefined'||typeof CaspitCore==='undefined')return;
const C=CaspitCore;
const fnCall=(n,d)=>{d=d&&typeof d==='object'?d:{};if(SY&&SY.sa&&SY.bizId&&!('bizId'in d))d=Object.assign({bizId:SY.bizId},d);return window.fnCall(n,d)};
const ok=()=>typeof window.oxImpOk==='function'&&window.oxImpOk();
const X={st:'pick',tab:'new',pg:0,skip:new Set(),take:'app',cfg:null};
const rid=()=>{const a=new Uint8Array(12);crypto.getRandomValues(a);return 'cx'+[...a].map(x=>x.toString(36).padStart(2,'0')).join('').slice(0,22)};
const err=e=>toast(e&&e.message||'הפעולה נכשלה');
const nf=n=>Number(n||0).toLocaleString('he-IL');
const pz=v=>v==null?'—':ils(v);
const PG=100;
const ACTN={in:'מכספית',out:'לכספית',conf:'קונפליקט – האפליקציה קובעת',first:'הבדל ראשון',ack:'נקלט בכספית',base:'זהה',same:'—'};
const VIA={cx:'קישור קודם',sku:'קוד פריט',bc:'ברקוד',name:'שם זהה'};
const prog=t=>{X.prog=t;const e=document.getElementById('cxprog');if(e)e.textContent=t};

/* ---------- טעינת הגדרות ---------- */
async function cfgLoad(){try{X.cfg=await fnCall('cxCfg',{});}catch(e){X.cfg={err:e.message||'הטעינה נכשלה'}}if(cur().v==='cxSync')rerender()}

/* ---------- המסך ---------- */
V.cxSync=()=>{const T='סנכרון כספית';if(!ok())return{t:T,h:'<div class="empty">המסך מיועד למנהל בלבד</div>'};
 if(X.st==='busy')return{t:T,s:'רגע…',h:`<div class="card"><p id="cxprog" style="margin:0">${esc(X.prog||'עובד…')}</p><p class="note">אל תסגרו את האפליקציה עד שהפעולה מסתיימת.</p></div>`};
 if(X.st==='pv')return{t:T,s:'תצוגה מקדימה – עוד לא נשמר כלום',h:pvH()};
 if(X.st==='done')return{t:T,s:'נשמר',h:doneH()};
 if(!X.cfg){cfgLoad();if(window.cxBotReset)cxBotReset()}
 const c=X.cfg&&X.cfg.cfg,last=c&&c.last;
 return{t:T,s:'קטלוג ומחירים מול כספית',h:`<div class="card"><h3 style="margin-top:0">קובץ מכספית</h3><p class="note" style="margin-top:0">מוציאים מכספית את "קטלוג פריטים"${typeof window.cxSalesOk==='function'&&window.cxSalesOk()?' או "דוח מכירות לפריטים"':''} (Excel או CSV) ובוחרים אותו כאן. הסוג מזוהה לבד. לפני שמשהו נשמר תוצג תצוגה מקדימה לאישור.</p>
 <label class="btn w" style="display:flex;align-items:center;justify-content:center;min-height:48px">בחירת קובץ<input type="file" accept=".xlsx,.xls,.csv" data-c="cxFile" style="position:absolute;opacity:0;width:1px;height:1px"></label>
 ${typeof window.cxSalesOk==='function'&&window.cxSalesOk()?'<button class="btn g w" style="min-height:48px;margin-top:8px" data-a="go" data-v="cxSales">מכירות כספית והתאמה לסגירת קופה</button>':''}
 <p class="note">${X.cfg?X.cfg.err?esc(X.cfg.err):last?'סנכרון אחרון: '+esc(new Date(last.at).toLocaleString('he-IL'))+' · '+nf(X.cfg.items)+' קודים מקושרים':'עוד לא היה סנכרון. בסנכרון הראשון כל הקטלוג נקלט כמוצרים, עם כמות 0 ("לא נספר").':'טוען…'}</p></div>
 ${expH(!!last)}
 ${typeof window.cxBotCardH==='function'?window.cxBotCardH():''}
 <details class="card"><summary style="min-height:44px;display:flex;align-items:center"><b>הגדרות</b></summary><form data-f="cxCfgF"><label class="f"><span>קודים מיוחדים שלא נקלטים כמוצרים (מופרדים בפסיק)</span><input name="skip" dir="ltr" value="${esc(((c&&c.skip)||C.SKIP).join(', '))}"></label><p class="note" style="margin-top:0">למשל 1000 פריט כללי, 9999 תשלום חוב. בשלב הבא גם לא ישנו מלאי.</p><button class="btn g w">שמירה</button></form></details>`}};

const expH=has=>`<div class="card"><h3 style="margin-top:0">קבצים לכספית</h3><p class="note" style="margin-top:0">שינויים שנעשו באפליקציה יוצאים לכספית בקובץ. טוענים אותו בכספית במסך ייבוא הפריטים (בפעם הראשונה – לנסות עם פריט אחד).</p>
 <div class="row"><button class="btn g grow" style="min-height:48px" data-a="cxExp" data-k="price">עדכון מחירים ועלויות</button><button class="btn g grow" style="min-height:48px" data-a="cxExp" data-k="new"${has?'':' disabled'}>פריטים חדשים</button></div>
 ${has?'':'<p class="note">"פריטים חדשים" זמין אחרי הסנכרון הראשון של הקטלוג.</p>'}</div>`;

/* ---------- קריאת הקובץ ושליחה ---------- */
/* CSV: בייטים → UTF-8 או windows-1255 (readTable קורא תמיד כ-UTF-8, וקובץ של כספית ב-windows-1255 היה יוצא ג'יבריש) */
async function readF(f){if(/\.csv$/i.test(f.name||'')||f.type==='text/csv')return parseCsv(C.decode(await f.arrayBuffer()));return readTable(f)}
CHG.cxFile=async el=>{const f=el.files&&el.files[0];el.value='';if(!f)return;X.st='busy';prog('קורא את הקובץ…');rerender();
 try{const T=await readF(f);const rows=(T||[]).filter(r=>Array.isArray(r));const d=C.detect(rows);
  if(d.kind==='sales'){if(typeof window.cxSalesOk!=='function'||!window.cxSalesOk())throw new Error('קליטת דוח מכירות כבויה בעסק הזה (תוספת “מכירות כספית”). פנו למנהל־העל.');if(typeof window.cxSalesFile!=='function')throw new Error('קליטת מכירות לא נטענה');await window.cxSalesFile(f,rows,d,prog);X.st='pick';return}
  if(d.kind!=='cat')throw new Error('הקובץ לא מזוהה כקובץ של כספית ("קטלוג פריטים"'+(typeof window.cxSalesOk==='function'&&window.cxSalesOk()?' או "דוח מכירות לפריטים"':'')+').');
  const g=C.groupCat(rows,d),P=C.parts(g.items),run=rid();
  for(let k=0;k<P.length;k++){prog(`זוהה קטלוג: ${nf(g.items.length)} קודים. שולח חלק ${k+1} מתוך ${P.length}…`);await fnCall('cxUpload',{run,part:k,parts:P.length,items:P[k]})}
  prog('משווה מול המוצרים באפליקציה…');
  const r=await fnCall('cxPreview',{run});
  Object.assign(X,{st:'pv',run,file:f.name,R:r,tab:r.cnt.nw?'new':'in',pg:0,skip:new Set(),take:'app'});rerender()}
 catch(e){X.st='pick';rerender();err(e)}};

/* ---------- תצוגה מקדימה ---------- */
const isL=r=>r[1]==='link';
const TABS=[['new','חדשים',r=>r[1]==='new'],['in','מכספית',r=>isL(r)&&(r[3]==='in'||r[6]==='in')],['out','לכספית',r=>isL(r)&&['out','conf'].some(a=>r[3]===a||r[6]===a)],['first','הבדל ראשון',r=>isL(r)&&(r[3]==='first'||r[6]==='first')],['link','מקושרים',isL]];
const listOf=k=>{const t=TABS.find(x=>x[0]===k);if(t)return X.R.rows.filter(t[2]);if(k==='mrg')return X.R.merged;if(k==='flt')return X.R.filt;return X.R.warn};
const cntOf=k=>dlList(k).length;
/* תיקון סבב 1 (החלטה 12): כל משבצת לחיצה ופותחת את הרשימה המלאה שמאחוריה (חלון, 100 בכל פעם + "הצג עוד") */
const tile=(l,v,cls,key)=>`<button type="button" class="k${cls?' '+cls:''}" data-a="cxDl" data-k="${key}" style="width:100%;min-height:64px;text-align:start;color:inherit;font:inherit;cursor:pointer"><small>${l}</small><b>${nf(v)}</b></button>`;
const live=r=>!X.skip.has(r[0]);
const fIn=i=>r=>isL(r)&&live(r)&&(r[i]==='in'||(r[i]==='first'&&X.take==='cx'));
const fOut=i=>r=>isL(r)&&live(r)&&(r[i]==='out'||r[i]==='conf'||(r[i]==='first'&&X.take!=='cx'));
const DL={newS:['יקלטו כמוצרים חדשים',r=>r[1]==='new'&&live(r)],link:['מקושרים למוצרים קיימים',isL],in:['מחיר/עלות מכספית',r=>TABS[1][2](r)&&live(r)],out:['ייצאו לכספית',r=>TABS[2][2](r)],first:['הבדל ראשון',TABS[3][2]],
 pin:['מחירים מכספית',fIn(3)],cin:['עלויות מכספית',fIn(6)],pout:['מחירים לכספית',fOut(3)],cout:['עלויות לכספית',fOut(6)],dlink:['קישורים',r=>isL(r)&&live(r)]};
const dlList=k=>DL[k]?X.R.rows.filter(DL[k][1]):listOf(k);
const DLT={mrg:'אוחדו',flt:'סוננו',warn:'אזהרות'};
const arrow=(a,b)=>`${pz(a)} ← ${pz(b)}`; // מימין לשמאל: ישן ← חדש
function dlRow(k,r){
 if(k==='mrg')return `<div class="li" style="cursor:default"><div class="m"><b>${esc(r.n)}</b><small>קוד ${esc(r.c)} אוחד לקוד ${esc(r.to)} (אותו שם, מחיר וצבע/מידה)</small></div></div>`;
 if(k==='flt')return `<div class="li" style="cursor:default"><div class="m"><b>${esc(r.n||'(בלי שם)')}</b><small>קוד ${esc(r.c)} · הסיבה: ${esc(C.WHY[r.why]||r.why)}</small></div></div>`;
 if(k==='warn')return `<div class="li" style="cursor:default"><div class="m"><b>קוד ${esc(r.c)}</b><small>${esc(C.WARN[r.w]||r.w)}${r.v?' · '+esc(String(r.v).slice(0,60)):''}</small></div></div>`;
 if(r[1]==='new')return `<div class="li" style="cursor:default"><div class="m"><b>${esc(r[2])}</b><small>קוד ${esc(r[0])} · מחיר ${pz(r[3])} · עלות ${pz(r[4])}${r[5]?' · אוחדו אליו '+r[5]+' קודים':''}</small></div></div>`;
 const ln=(a,f,ap,l)=>{const inn=a==='in'||(a==='first'&&X.take==='cx'),out=a==='out'||a==='conf'||(a==='first'&&X.take!=='cx');
  return inn?`<small>${l} באפליקציה: ${arrow(ap,f)} (מכספית)</small>`:out?`<small>${l} בכספית: ${arrow(f,ap)} (יוצא לכספית${a==='conf'?' – התנגשות, האפליקציה קובעת':''})</small>`:a==='same'?'':`<small>${l}: ${pz(ap)} (זהה)</small>`};
 return `<div class="li" style="cursor:default"><div class="m"><b>${esc(r[2])}</b><small>קוד ${esc(r[0])}${r[10]&&r[10]!==r[2]?' · באפליקציה: '+esc(r[10]):''} · קושר לפי ${VIA[r[9]]||'—'}</small>${ln(r[3],r[4],r[5],'מחיר')}${ln(r[6],r[7],r[8],'עלות')}</div></div>`}
const dlH=()=>{const D=X.dl,L=dlList(D.k),S=L.slice(0,D.n);return `<h3>${esc((DL[D.k]&&DL[D.k][0])||DLT[D.k]||'')} · ${nf(L.length)}</h3><div style="max-height:60vh;overflow:auto">${S.map(r=>dlRow(D.k,r)).join('')||'<p class="note">אין פריטים</p>'}</div>${L.length>S.length?`<button class="btn g w" style="min-height:44px;margin-top:8px" data-a="cxDlMore">הצג עוד (${nf(L.length-S.length)})</button>`:''}<button class="btn g w" style="min-height:44px;margin-top:8px" data-a="closeDlg">סגור</button>`};
ACT.cxDl=el=>{if(!X.R)return;X.dl={k:el.dataset.k,n:PG};dlg(dlH())};
ACT.cxDlMore=()=>{if(!X.dl)return;X.dl.n+=PG;const b=document.querySelector('#dlg [data-a=cxDlMore]');const sc=document.querySelector('#dlg div[style*="max-height"]');const t=sc?sc.scrollTop:0;dlg(dlH());const s2=document.querySelector('#dlg div[style*="max-height"]');if(s2)s2.scrollTop=t;void b};
function pvH(){const R=X.R,c=R.cnt,pin=cntOf('in'),pout=cntOf('out'),fst=cntOf('first');
 const k=(l,v,cls,key)=>tile(l,v,cls,key);
 const tabs=TABS.map(t=>[t[0],t[1]]).concat([['mrg','מאוחדים'],['flt','מסוננים'],['warn','אזהרות']]);
 const L=listOf(X.tab),pages=Math.max(1,Math.ceil(L.length/PG)),pg=Math.min(X.pg,pages-1),S=L.slice(pg*PG,pg*PG+PG);
 return `<div class="card"><p class="note" style="margin-top:0">${esc(X.file||'')} · ${nf(c.codes)} קודים בקובץ</p><div class="kg">${k('יקלטו כמוצרים חדשים',cntOf('newS'),'pos','newS')}${k('מקושרים למוצרים קיימים',c.link,'','link')}${k('אוחדו (שם, מחיר וצבע זהים)',c.merged,'','mrg')}${k('סוננו',c.filt,c.filt?'neg':'','flt')}${k('מחיר/עלות מכספית',pin,'','in')}${k('ייצאו לכספית',pout,'','out')}${fst?k('הבדל ראשון',fst,'','first'):''}${k('אזהרות',c.warn,'','warn')}</div><p class="note" style="margin-bottom:0">לחיצה על משבצת מציגה את כל הפריטים שמאחורי המספר.</p>
 ${c.appOnly?`<p class="note">${nf(c.appOnly)} מוצרים קיימים באפליקציה ואינם בכספית – אחרי השמירה הם ייכנסו לקובץ "פריטים חדשים".</p>`:''}
 ${fst?`<p class="note"><b>הבדל ראשון</b> = המחיר באפליקציה ובכספית שונים ואין סנכרון קודם. מי קובע?</p><div class="chips" role="group"><button class="chip${X.take==='app'?' on':''}" data-a="cxTake" data-k="app" aria-pressed="${X.take==='app'}">האפליקציה (יוצא לכספית)</button><button class="chip${X.take==='cx'?' on':''}" data-a="cxTake" data-k="cx" aria-pressed="${X.take==='cx'}">קח הכול מכספית</button></div>`:''}</div>
 <div class="chips scroll-x nw" role="tablist" style="margin:8px 0">${tabs.map(([id,l])=>`<button class="chip${X.tab===id?' on':''}" role="tab" aria-selected="${X.tab===id}" data-a="cxTab" data-k="${id}">${l} ${nf(cntOf(id))}</button>`).join('')}</div>
 ${(X.tab==='new'||X.tab==='in')&&L.length?`<div class="row" style="margin-bottom:6px"><button class="btn g s grow" data-a="cxAll" data-k="1">סמן הכול</button><button class="btn g s grow" data-a="cxAll" data-k="0">בטל הכול</button></div>`:''}
 ${X.tab==='flt'&&L.length?'<button class="btn g s w" style="margin-bottom:6px" data-a="cxFltDl">הורדת רשימת המסוננים (CSV)</button>':''}
 <div id="cxlist">${S.map(rowH).join('')||'<div class="empty">אין שורות בכרטיסייה הזו</div>'}</div>
 ${pages>1?`<div class="row" style="margin-top:8px"><button class="btn g s grow" data-a="cxPg" data-k="-1"${pg?'':' disabled'}>הקודמים</button><span class="note" style="align-self:center">עמוד ${pg+1} מתוך ${pages}</span><button class="btn g s grow" data-a="cxPg" data-k="1"${pg<pages-1?'':' disabled'}>הבאים</button></div>`:''}
 <div class="row" style="margin-top:16px"><button class="btn grow" style="min-height:48px" data-a="cxApply">אשר ושמור</button><button class="btn g grow" style="min-height:48px" data-a="cxX">ביטול</button></div>`}
const chk=c=>`<input type="checkbox" data-c="cxChk" data-k="${esc(c)}"${X.skip.has(c)?'':' checked'} aria-label="לכלול" style="width:22px;height:22px;flex:none">`;
function rowH(r){const t=X.tab;
 if(t==='mrg')return `<div class="li" style="cursor:default"><div class="m"><b>${esc(r.n)}</b><small>קוד ${esc(r.c)} → אוחד לקוד ${esc(r.to)}</small></div></div>`;
 if(t==='flt')return `<div class="li" style="cursor:default"><div class="m"><b>${esc(r.n||'(בלי שם)')}</b><small>קוד ${esc(r.c)} · ${esc(C.WHY[r.why]||r.why)}</small></div></div>`;
 if(t==='warn')return `<div class="li" style="cursor:default"><div class="m"><b>קוד ${esc(r.c)}</b><small>${esc(C.WARN[r.w]||r.w)}${r.v?' · '+esc(String(r.v).slice(0,60)):''}</small></div></div>`;
 if(r[1]==='new')return `<label class="li" style="cursor:pointer;gap:10px">${chk(r[0])}<div class="m"><b>${esc(r[2])}</b><small>קוד ${esc(r[0])} · ${pz(r[3])}${r[4]!=null?' · עלות '+ils(r[4]):''}${r[5]?' · כולל '+r[5]+' קודים מאוחדים':''}</small></div></label>`;
 const pl=(a,f,ap,l)=>a==='base'||a==='same'||a==='ack'?'':`<small>${l}: באפליקציה ${pz(ap)} · בכספית ${pz(f)} – <span class="tag">${ACTN[a]||a}</span></small>`;
 const body=`<div class="m"><b>${esc(r[2])}</b><small>קוד ${esc(r[0])}${r[10]&&r[10]!==r[2]?' · באפליקציה: '+esc(r[10]):''} · ${VIA[r[9]]||''}</small>${pl(r[3],r[4],r[5],'מחיר')}${pl(r[6],r[7],r[8],'עלות')}</div>`;
 return t==='in'?`<label class="li" style="cursor:pointer;gap:10px">${chk(r[0])}${body}</label>`:`<div class="li" style="cursor:default">${body}</div>`}
ACT.cxTab=el=>{X.tab=el.dataset.k;X.pg=0;rerender()};
ACT.cxPg=el=>{X.pg=Math.max(0,X.pg+(+el.dataset.k));rerender();window.scrollTo(0,0)};
ACT.cxTake=el=>{X.take=el.dataset.k==='cx'?'cx':'app';rerender()};
CHG.cxChk=el=>{const c=el.dataset.k;if(el.checked)X.skip.delete(c);else X.skip.add(c)};
ACT.cxAll=el=>{const L=listOf(X.tab);L.forEach(r=>{if(el.dataset.k==='1')X.skip.delete(r[0]);else X.skip.add(r[0])});rerender()};
ACT.cxX=()=>ask('לבטל את הסנכרון? שום דבר לא נשמר.',()=>{X.st='pick';X.R=null;rerender()},'כן, בטל');
ACT.cxFltDl=()=>{const L=X.R.filt.map(f=>[f.c,f.n,C.WHY[f.why]||f.why]).concat(X.R.merged.map(m=>[m.c,m.n,'אוחד לקוד '+m.to]));
 saveFile('caspit-filtered.csv','﻿'+[['קוד פריט','שם פריט','סיבה']].concat(L).map(r=>r.map(C.cell).join(',')).join('\n')+'\n','text/csv')};
ACT.cxApply=()=>{const R=X.R,nw=R.rows.filter(r=>r[1]==='new'&&!X.skip.has(r[0])).length,pin=listOf('in').filter(r=>!X.skip.has(r[0])).length;
 dlg(`<h3>לשמור?</h3><div class="kg">${[['מוצרים חדשים',nw],['עדכוני מחיר/עלות מכספית',pin],['קישורים למוצרים קיימים',R.cnt.link]].map(([l,v])=>`<div class="k"><small>${l}</small><b>${nf(v)}</b></div>`).join('')}</div>
 <p class="note">מוצרים חדשים נכנסים עם כמות 0 ומסומנים "לא נספר". שום מוצר לא נמחק.${R.first?' לפני השמירה הראשונה נשמר גיבוי של כל המוצרים.':''}</p>
 <div class="row"><button class="btn grow" style="min-height:48px" data-a="cxGo">כן, לשמור</button><button type="button" class="btn g grow" style="min-height:48px" data-a="closeDlg">ביטול</button></div>`)};
ACT.cxGo=async()=>{closeDlg();X.st='busy';prog('שומר… זה יכול לקחת כמה דקות בקטלוג גדול.');rerender();
 try{let r,first=true;for(let i=0;i<20;i++){r=await fnCall('cxApply',first?{run:X.run,take:X.take,skip:[...X.skip]}:{run:X.run});first=false;if(r.done)break;prog('שומר… עדיין עובד')}
  if(!r||!r.done)throw new Error('השמירה לא הסתיימה. לחצו שוב "אשר ושמור" – מה שכבר נשמר לא יישמר פעמיים.');
  X.res=r.res||{};X.st='done';X.cfg=null;rerender();toast('✓ הסנכרון נשמר');if(typeof window.__oxReload==='function')window.__oxReload()}
 catch(e){if(e&&e.reason==='stale')return restale();X.st='pv';rerender();err(e)}};
/* תצוגה מיושנת (נשמר בינתיים סנכרון או קובץ לכספית): מציגים שוב את אותו קובץ; אם האישור כבר התחיל ונעצר – מתחילים מהקובץ */
async function restale(){prog('הנתונים השתנו מאז התצוגה המקדימה – משווה שוב…');try{const r=await fnCall('cxPreview',{run:X.run});Object.assign(X,{st:'pv',R:r,pg:0});rerender();toast('הנתונים השתנו מאז התצוגה המקדימה. בדקו שוב ואשרו.')}catch(e){X.st='pick';X.R=null;rerender();toast('הנתונים השתנו באמצע השמירה. מה שנשמר נשאר. בחרו שוב את הקובץ כדי להשלים.')}}

/* ---------- סיום ---------- */
function doneH(){const r=X.res||{},k=(l,v,key)=>X.R?tile(l,v,'',key):`<div class="k"><small>${l}</small><b>${nf(v)}</b></div>`;
 return `<div class="card"><h3 style="margin-top:0">✓ הסנכרון נשמר</h3><div class="kg">${k('מוצרים חדשים',r.nw,'newS')}${k('קישורים',r.link,'dlink')}${k('מחירים מכספית',r.pin,'pin')}${k('עלויות מכספית',r.cin,'cin')}${k('מחירים לכספית',r.pout,'pout')}${k('עלויות לכספית',r.cout,'cout')}</div>
 ${X.R?'<p class="note" style="margin-bottom:0">לחיצה על משבצת מציגה את הפריטים.</p>':''}${r.chg?`<p class="note">${nf(r.chg)} מוצרים השתנו באפליקציה בזמן התצוגה המקדימה ולא עודכנו – יופיעו בסנכרון הבא.</p>`:''}</div>${expH(true)}<button class="btn g w" style="min-height:48px" data-a="cxX0">סיום</button>`}
ACT.cxX0=()=>{X.st='pick';X.R=null;rerender()};

/* ---------- קבצים לכספית ---------- */
ACT.cxExp=async el=>{const k=el.dataset.k==='new'?'new':'price';el.disabled=true;const t0=el.textContent;el.textContent='מכין…';
 try{const r=await fnCall('cxExport',{kind:k});if(!r.n){toast(k==='new'?'אין פריטים חדשים לשליחה':'אין שינויים במחירים לשליחה');return}
  const d=new Date(),st=d.getFullYear()+String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0');
  await saveFile((k==='new'?'caspit-new-items-':'caspit-price-update-')+st+'.csv',r.csv,'text/csv');
  dlg(`<h3>${k==='new'?'פריטים חדשים':'עדכון מחירים'} · ${nf(r.n)} שורות</h3><p class="note">הקובץ נשמר. טוענים אותו בכספית. בסנכרון הבא של הקטלוג נבדק שכספית קלטה – ואז השורות לא יוצעו שוב.</p><div style="max-height:45vh;overflow:auto">${r.rows.slice(0,100).map(x=>`<div class="li" style="cursor:default"><div class="m"><b>${esc(x.n||'')}</b><small>קוד ${esc(x.c)} · ${pz(x.p)}${x.cost!=null?' · עלות '+ils(x.cost):''}</small></div></div>`).join('')}${r.rows.length>100?`<p class="note">ועוד ${nf(r.rows.length-100)}…</p>`:''}</div><button class="btn g w" style="min-height:48px" data-a="closeDlg">סגור</button>`)}
 catch(e){err(e)}finally{el.disabled=false;el.textContent=t0}};
FRM.cxCfgF=async f=>{const x=fd(f),skip=String(x.skip||'').split(/[,\s]+/).map(s=>s.trim()).filter(Boolean);const b=f.querySelector('button');b.disabled=true;
 try{await fnCall('cxSetCfg',{skip});toast('נשמר');X.cfg=null;rerender()}catch(e){b.disabled=false;err(e)}};
})();
