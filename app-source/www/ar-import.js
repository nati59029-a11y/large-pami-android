/* AR:IMP – ייבוא יתרות ומסמכים מתוכנה קודמת (כספית ואחרות). משימה 2026-11-14_הזמנות-לקוח-עסקי-וחשבוניות, שלב 6. מנהל בלבד.
   קובץ Excel/CSV ← התאמת עמודות (נשמרת בשרת לפעם הבאה, arcfg/impmap) ← תצוגה מקדימה מהשרת (arImp dry: שגיאות, כפילויות, סכום) ←
   ייבוא במנות של 25 (arImp) ← "ביטול קבוצה" (arImpVoid – סימון מבוטל, לא מחיקה). לקוחות – במסך ייבוא הלקוחות הקיים (כולל לקוח עסקי).
   מסמך מיובא: המספר המקורי, "מסמך מיובא", בלי קובץ PDF, לא נרשם בהכנסות. ייבוא חוזר של אותו קובץ – 0 רשומות חדשות (מזהה x_{סוג}_{מספר}).
   נטען אחרי ar-inv.js. כל כתיבה דרך השרת (functions/ar-import.js). */
(function(){
'use strict';
if(typeof ACT==='undefined'||typeof V==='undefined'||!window.__arInv)return;
const fnCall=(n,d)=>{d=d&&typeof d==='object'?d:{};if(SY&&SY.sa&&SY.bizId&&!('bizId'in d))d=Object.assign({bizId:SY.bizId},d);return window.fnCall(n,d)};
const mgr=()=>isA()||!!(SY&&SY.sa);
const on=()=>mgr()&&bzF('orders')&&wp('ord');
const err=e=>toast(e&&e.message||'הפעולה נכשלה');
const ag=a=>ils((a||0)/100);
const bid=()=>{const a=new Uint8Array(12);crypto.getRandomValues(a);return 'b'+[...a].map(x=>x.toString(36).padStart(2,'0')).join('').slice(0,22)};
const KN={ob:'יתרות פתיחה',inv:'חשבוניות',rc:'קבלות',cr:'חשבוניות זיכוי'};
const F=[['xc','מספר לקוח (בתוכנה הקודמת)'],['vat','ע.מ / ח.פ'],['phone','טלפון'],['tz','ת.ז'],['name','שם הלקוח / העסק'],['no','מספר מסמך'],['d','תאריך'],['amt','סכום (חיובי / שלילי)'],['dr','חובה'],['cr','זכות'],['ref','מספר חשבונית (שהקבלה / הזיכוי סוגרים)'],['due','תאריך לתשלום']];
const FOK={ob:['xc','vat','phone','tz','name','d','amt','dr','cr'],inv:['xc','vat','phone','tz','name','no','d','amt','dr','cr','due'],rc:['xc','vat','phone','tz','name','no','d','amt','dr','cr','ref'],cr:['xc','vat','phone','tz','name','no','d','amt','dr','cr','ref']};
// זיהוי לפי כותרת (כשאין התאמה שמורה). פורמט כספית לא ידוע (לא מאומת) – ניחוש בלבד, המשתמש מאשר
const guess=(h,k)=>{const s=String(h||'').replace(/["'\s.]/g,'');const g=/^(מספר|קוד|מס)?לקוח$|^(מספר|מס)?כרטסת$|^חשבון$/.test(s)?'xc':/^(עמ|חפ|עמ\/חפ|חפ\/עמ|עוסקמורשה|מספרעוסק)$/.test(s)?'vat':/טל|נייד|phone/i.test(s)?'phone':/זהות|^תז$/.test(s)?'tz':/שם/.test(s)?'name':
 /לתשלום|פירעון|^due/i.test(s)?'due':/תאריך|^תערך$|date/i.test(s)?'d':/^חובה$|debit/i.test(s)?'dr':/^זכות$|credit/i.test(s)?'cr':/סכום|יתרה|סהכ|amount|total/i.test(s)?'amt':/חשבונית/.test(s)&&k!=='inv'?'ref':/מספר|מס|אסמכתא|^no$|number/i.test(s)?'no':'';return FOK[k].includes(g)?g:''};
const I={L:null,maps:{},k:'inv'};
async function listL(){try{const r=await fnCall('arImpList',{});I.L=r.batches||[];I.maps=r.maps||{}}catch(e){I.L=[];err(e)}}
const redraw=()=>{if(cur().v==='arImp'&&!document.querySelector('#dlg[open]'))rerender()};
const ymd=d=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d||''));return m?`${m[3]}/${m[2]}/${m[1].slice(2)}`:''};
const dd=t=>{try{return new Date(t).toLocaleDateString('he-IL')}catch(e){return ''}};

V.arImp=()=>{const T='ייבוא מתוכנה קודמת';if(!on())return{t:T,h:'<div class="empty">למנהל בלבד</div>'};
 if(I.L===null){I.L=undefined;listL().then(redraw)}
 const L=I.L||[];
 return{t:T,h:`<div class="card"><p class="note" style="margin-top:0">מעבר מכספית או מתוכנה אחרת. סדר מומלץ: <b>1. לקוחות</b> (במסך ייבוא הלקוחות – כולל לקוח עסקי, תנאי תשלום ו"מספר לקוח בתוכנה הקודמת") ← <b>2. יתרות פתיחה</b> או מסמכים ישנים ← <b>3. קבלות וזיכויים</b>.</p>
  <p class="note">הלקוח במסמך מזוהה לפי מספר לקוח, ע.מ, ת.ז, טלפון או שם מדויק. מסמך מיובא נשמר עם המספר המקורי, בלי קובץ, ולא נרשם בהכנסות. ייבוא חוזר של אותו קובץ לא מכפיל. הפורמט המדויק שכספית מייצאת לא ידוע – בוחרים בעצמכם איזו עמודה היא מה (הבחירה נשמרת).</p>
  <label class="f"><span>מה מייבאים?</span><select id="aiK">${Object.entries(KN).map(([k,l])=>`<option value="${k}"${I.k===k?' selected':''}>${l}</option>`).join('')}</select></label>
  <p class="note">לא בטוחים איך הקובץ צריך להיראות? הורידו קובץ דוגמה לסוג שבחרתם, והעבירו אליו את הנתונים מכספית באותן עמודות.</p>
  <div class="row"><button class="btn g grow" data-a="aiTpl">הורדת קובץ דוגמה</button><label class="btn grow" style="display:flex;align-items:center;justify-content:center">בחירת קובץ (Excel / CSV)<input type="file" accept=".xlsx,.xls,.csv,text/csv" data-c="aiFile" hidden></label></div>
  ${typeof ACT.ocImp==='function'?'<button class="btn g w" style="margin-top:8px" data-a="ocImp">ייבוא לקוחות</button>':''}</div>
  <div class="sec"><h3>ייבואים קודמים</h3></div>
  ${I.L===undefined?'<div class="empty">טוען…</div>':L.length?L.map(b=>`<div class="li"><div class="grow"><b>${esc(KN[b.kind]||b.kind)}</b>${b.st==='void'?' <small style="color:var(--bad)">בוטל</small>':''}<br><small class="note">${dd(b.at)} · ${esc(b.name||'')} · ${b.n} רשומות · <bdi dir="ltr">${ag(b.sum)}</bdi></small></div>${b.st!=='void'?`<button class="btn r s" style="white-space:nowrap" data-a="aiVoid" data-id="${esc(b.id)}">ביטול קבוצה</button>`:''}</div>`).join(''):'<div class="empty">עוד לא יובאו מסמכים</div>'}`}};
// קובץ דוגמה (החלטת בעל הפרויקט 15.11.2026): גיליון ראשון = הנתונים (הכותרות מזוהות אוטומטית ב-guess), גיליון שני = הסבר. שורות "לדוגמה" בלבד – למחוק לפני הייבוא
const TPL={
 ob:[['מספר לקוח','ע.מ / ח.פ','טלפון','שם הלקוח','תאריך','יתרה'],[101,'','050-0000000','לקוח לדוגמה א','31/12/2025',1500],[102,'500000000','','לקוח לדוגמה ב','31/12/2025',-200]],
 inv:[['מספר לקוח','ע.מ / ח.פ','טלפון','שם הלקוח','מספר מסמך','תאריך','סכום','תאריך לתשלום'],[101,'','050-0000000','לקוח לדוגמה א',2025101,'15/11/2025',1170,'31/12/2025'],[102,'500000000','','לקוח לדוגמה ב',2025102,'20/11/2025',585,'']],
 rc:[['מספר לקוח','ע.מ / ח.פ','טלפון','שם הלקוח','מספר מסמך','תאריך','סכום','מספר חשבונית'],[101,'','050-0000000','לקוח לדוגמה א',5001,'01/12/2025',1170,2025101]],
 cr:[['מספר לקוח','ע.מ / ח.פ','טלפון','שם הלקוח','מספר מסמך','תאריך','סכום','מספר חשבונית'],[102,'500000000','','לקוח לדוגמה ב',7001,'25/11/2025',100,2025102]]};
const TPL_H={
 ob:['יתרה אחת לכל לקוח (שורה שנייה לאותו לקוח – שגיאה).','יתרה: חיובי = הלקוח חייב, שלילי = יתרת זכות. אפשר במקום זה שתי עמודות: חובה וזכות.','תאריך – לא חובה (בלעדיו: היום). מועד התשלום של היתרה נקבע לפי תנאי התשלום של הלקוח.'],
 inv:['מספר מסמך ותאריך – חובה.','סכום כולל מע״מ. שלילי = זכות. אפשר במקום זה שתי עמודות: חובה וזכות.','תאריך לתשלום – לא חובה. בלעדיו המועד נקבע לפי תנאי התשלום של הלקוח (כמו בחשבונית חדשה).'],
 rc:['מספר מסמך ותאריך – חובה.','מספר חשבונית – לא חובה: החשבונית שהקבלה סוגרת. בלעדיו הקבלה סוגרת את החובות הישנים של הלקוח.','סכום שלילי (למשל צ׳ק חוזר) נרשם כחוב.'],
 cr:['מספר מסמך ותאריך – חובה.','מספר חשבונית – לא חובה: החשבונית שהזיכוי מקטין.','זיכוי תמיד נרשם כזכות ללקוח.']};
ACT.aiTpl=()=>{const ks=document.getElementById('aiK');const k=ks&&TPL[ks.value]?ks.value:I.k;I.k=k;
 const help=[['איך ממלאים'],['1. הגיליון הראשון הוא הקובץ שמייבאים. השורה הראשונה – כותרות. השורות שמתחתיה הן דוגמה בלבד: מחקו אותן והכניסו את הנתונים שלכם.'],
  ['2. זיהוי הלקוח: מספר הלקוח בתוכנה הקודמת, ע.מ / ח.פ, טלפון או שם מדויק – מספיק אחד. ייבאו קודם את הלקוחות (במסך ייבוא הלקוחות).'],
  ['3. תאריכים: יום/חודש/שנה (31/12/2025) או תאריך של Excel. סכומים בשקלים, בלי סימן ₪.'],...TPL_H[k].map((t,i)=>[(i+4)+'. '+t]),
  ['עמודות מיותרות מהקובץ של כספית אפשר להשאיר – במסך ההתאמה בוחרים "לא לייבא".']];
 if(typeof xlsOrCsv!=='function')return toast('הורדת הקובץ לא זמינה');
 xlsOrCsv('דוגמה לייבוא – '+KN[k],{[KN[k]]:TPL[k],'הסבר':help})};
// כניסה: מהגדרות החשבוניות (מנהל)
{const f=V.arCfg;if(f)V.arCfg=()=>{const r=f();try{if(r&&r.h&&on())r.h+=`<button class="btn g w" style="margin-top:8px" data-a="go" data-v="arImp">ייבוא מתוכנה קודמת (כספית ואחרות)</button>`}catch(e){}return r}}

CHG.aiFile=async el=>{const f=el.files[0];el.value='';if(!f)return;if(/\.pdf$/i.test(f.name))return toast('רק Excel או CSV');const ks=document.getElementById('aiK');I.k=ks?ks.value:I.k;
 try{const rows=(await readTable(f)).filter(r=>Array.isArray(r)&&r.some(c=>String(c==null?'':c).trim()));if(rows.length<2)return toast('אין שורות בקובץ');
  const H=rows[0].map(x=>String(x==null?'':x).trim().slice(0,40)),sv=I.maps[I.k]||{};
  I.f={name:String(f.name||'').slice(0,80),H,R:rows.slice(1),map:H.map(h=>sv[h]!==undefined&&(sv[h]===''||FOK[I.k].includes(sv[h]))?sv[h]:guess(h,I.k))};dlg(mapH())}catch(e){err(e)}};
const cell=v=>{const s=String(v==null?'':v).slice(0,30);const d=s.replace(/\D/g,'');return /^\d{13,19}$/.test(d)?'****'+d.slice(-4):s};
const mapH=()=>{const P=I.f,s=P.R[0]||[];return `<h3>התאמת עמודות · ${esc(KN[I.k])} · ${P.R.length} שורות</h3><p class="note" style="margin-top:0">סכום: עמודה אחת (חיובי / שלילי) או חובה וזכות.${I.k==='ob'?' בלי תאריך – היום.':''}</p><form data-f="aiMapF" style="max-height:60vh;overflow:auto">${P.H.map((h,i)=>`<label class="f"><span>${esc(h||'עמודה '+(i+1))} <small class="note">(${esc(cell(s[i]))})</small></span><select name="m${i}"><option value="">לא לייבא</option>${F.filter(([k])=>FOK[I.k].includes(k)).map(([k,l])=>`<option value="${k}"${P.map[i]===k?' selected':''}>${l}</option>`).join('')}</select></label>`).join('')}
 <div class="row"><button class="btn grow">המשך לתצוגה מקדימה</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`};
const rowsOf=()=>{const P=I.f;return P.R.map(r=>{const o={};P.map.forEach((m,i)=>{if(!m)return;const v=r[i];if(v==null||String(v).trim()==='')return;o[m]=typeof v==='number'?v:String(v).trim().slice(0,80)});return o})};
FRM.aiMapF=async f=>{const v=fd(f),P=I.f;P.map=P.H.map((h,i)=>v['m'+i]||'');
 const dup=F.map(x=>x[0]).filter(k=>P.map.filter(m=>m===k).length>1);if(dup.length)return toast('כל שדה – עמודה אחת בלבד');
 if(!['xc','vat','phone','tz','name'].some(k=>P.map.includes(k)))return toast('צריך עמודה שמזהה את הלקוח (מספר לקוח / ע.מ / טלפון / שם)');
 if(!P.map.includes('amt')&&!P.map.includes('dr')&&!P.map.includes('cr'))return toast('צריך עמודת סכום (או חובה / זכות)');
 if(I.k!=='ob'&&(!P.map.includes('no')||!P.map.includes('d')))return toast('צריך עמודת מספר מסמך ועמודת תאריך');
 const b=f.querySelector('button');b.disabled=true;b.textContent='בודק…';
 const map={};P.H.forEach((h,i)=>{if(h&&!/[.$#[\]/]/.test(h))map[h]=P.map[i]});
 try{const rows=rowsOf(),pv={rows:[],add:0,dup:0,bad:0,sum:0};
  for(let i=0;i<rows.length;i+=500){const r=await fnCall('arImp',Object.assign({kind:I.k,dry:true,rows:rows.slice(i,i+500)},i?{}:{map}));
   pv.add+=r.add;pv.dup+=r.dup;pv.bad+=r.bad;pv.sum+=r.sum;pv.rows.push(...r.rows.map(x=>Object.assign({},x,{n:x.i+i+2})))}
  I.maps[I.k]=map;P.rows=rows;P.pv=pv;dlg(prevH())}catch(e){b.disabled=false;b.textContent='המשך לתצוגה מקדימה';err(e)}};
const prevH=()=>{const P=I.f,pv=P.pv,bad=pv.rows.filter(r=>!r.ok),okr=pv.rows.filter(r=>r.ok&&r.st!=='dup');
 return `<h3>תצוגה מקדימה · ${esc(KN[I.k])}</h3><p><b>${pv.add}</b> חדשות · <b>${pv.dup}</b> כבר יובאו (ידולגו) · <b style="${bad.length?'color:var(--bad)':''}">${bad.length}</b> שגויות (לא ייובאו)</p>
 <p>סכום החדשות (חובה − זכות): <b dir="ltr">${ag(pv.sum)}</b></p>
 <div style="max-height:40vh;overflow:auto">${okr.slice(0,5).map(r=>`<div class="note" style="padding:4px 0;border-bottom:1px solid var(--line)">${esc(r.name||'')}${r.no?' · #'+esc(r.no):''} · ${esc(ymd(r.d))} · <bdi dir="ltr">${ag(r.k==='cr'?-r.ag:r.ag)}</bdi></div>`).join('')}
 ${bad.slice(0,50).map(r=>`<div class="note" style="padding:4px 0;border-bottom:1px solid var(--line);color:var(--bad)">שורה ${r.n}: ${esc(r.msg||'')}</div>`).join('')}${bad.length>50?`<p class="note">ועוד ${bad.length-50} שגויות…</p>`:''}</div>
 <p class="note">מסמך מיובא נשמר עם המספר המקורי ו"מסמך מיובא", בלי קובץ. קבלה / זיכוי סוגרים קודם את החשבונית שצוינה, ואחר כך את החובות הישנים של הלקוח. אפשר לבטל את כל הקבוצה אחר כך.</p>
 <div class="row"><button class="btn grow" id="aiGoB" data-a="aiGo"${pv.add?'':' disabled'}>ייבא ${pv.add}</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div><p class="note" id="aiPr" style="margin:6px 0 0"></p>`};
ACT.aiGo=async el=>{const P=I.f;if(!P||!P.rows)return;el.disabled=true;const pr=document.getElementById('aiPr');P.b=P.b||bid();const N=25,tot={add:0,dup:0,bad:0,sum:0};
 try{for(let i=0;i<P.rows.length;i+=N){if(pr)pr.textContent=`מייבא… ${Math.min(i+N,P.rows.length)} / ${P.rows.length}`;let r;
   for(let k=0;;k++){try{r=await fnCall('arImp',{batch:P.b,kind:I.k,rows:P.rows.slice(i,i+N),name:P.name});break}catch(e){if(!e.offline||k>=2)throw e;await new Promise(z=>setTimeout(z,1500*(k+1)))}}
   tot.add+=r.add;tot.dup+=r.dup;tot.bad+=r.bad;tot.sum+=r.sum}
  I.f=null;I.L=null;dlg(`<h3>הייבוא הסתיים</h3><p><b>${tot.add}</b> רשומות חדשות · ${tot.dup} כבר היו · ${tot.bad} שגויות</p><p>סכום (חובה − זכות): <b dir="ltr">${ag(tot.sum)}</b></p><p class="note">היתרות מתעדכנות בכרטיסי הלקוחות. אפשר לבטל את הקבוצה ממסך הייבוא.</p><button class="btn w" data-a="closeDlg">סגור</button>`);rerender()}
 catch(e){el.disabled=false;el.textContent='נסה שוב (ממשיך מאיפה שנעצר)';err(e)}}; // ניסיון חוזר עם אותה קבוצה – מה שכבר יובא מדולג
ACT.aiVoid=el=>{const id=el.dataset.id,b=(I.L||[]).find(x=>x.id===id);if(!b)return;
 ask(`לבטל את הקבוצה "${KN[b.kind]||''}" (${b.n} רשומות)? הרשומות לא נמחקות – הן מסומנות "מבוטל", והיתרות של הלקוחות חוזרות למה שהיו בלעדיהן.`,async()=>{
  try{let left=1,n=0;while(left>0&&n<200){const r=await fnCall('arImpVoid',{batch:id,reason:'ביטול ייבוא'});left=r.left;n++}toast('הקבוצה בוטלה');I.L=null;rerender()}catch(e){err(e)}},'כן, לבטל')};
window.__arImp={I,guess,mapH,prevH,TPL};
})();
