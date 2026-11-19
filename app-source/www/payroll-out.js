/* שכר – דוחות לשיתוף (שלב ד', משימה 2026-11-18_שכר-ותלושים). קובץ עצמאי, נטען אחרי index.html ואחרי payroll-core.js.
   רק מגדיר window.PayOut – לא משנה שום מסך ולא נוגע בנתונים. החיבור לכפתורים נעשה במקום אחר.
     PayOut.empReport(sub, mon, fmt) – פירוט לעובד (sub = כרטיס העובד או מזהה כרטיס, mon = "YYYY-MM", fmt = 'pdf' | 'xlsx'; ברירת מחדל pdf).
       לכל יום: כניסה / יציאה / סה"כ שעות, סיכום היום (דיווח יומי dr), משימות שהוטלו מול שבוצעו (tasks); בסוף תוספות, בונוס עם פירוט וכמה להעביר.
     PayOut.accReport(mon, fmt) – לרואה החשבון: לכל עובד בתלוש – שעות, תוספות, בונוסים עם פירוט.
   שניהם מחזירים Promise עם {ok, file, fmt}. הקובץ נשמר/משותף דרך saveFile הקיים (שיתוף הטלפון, או הורדה בדפדפן). מנהל בלבד.
   דיווח יומי ומשימות נטענים רק בלחיצה (לא בטעינת האפליקציה). אין מבנה b / דיווח יומי / קישור uid / שגיאת טעינה ← "אין דיווח", בלי שגיאה.
   שם הקובץ: שם העובד והחודש בלבד. משתמש ב: S, PayCore, pmon, subById, cat, saveFile, mkPdf, fsx, fvj, idOf, bzF, bzB, isA, toast, XLSX (אם נטען). */
(function(){
'use strict';
const DN=['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
const NONE='אין דיווח';
/* גלובלים של index.html – נקראים בזמן הקריאה (typeof, בלי eval) */
const G={S:()=>typeof S!=='undefined'?S:undefined,toast:()=>typeof toast!=='undefined'?toast:undefined,isA:()=>typeof isA!=='undefined'?isA:undefined,pmon:()=>typeof pmon!=='undefined'?pmon:undefined,saveFile:()=>typeof saveFile!=='undefined'?saveFile:undefined,mkPdf:()=>typeof mkPdf!=='undefined'?mkPdf:undefined,xlsOrCsv:()=>typeof xlsOrCsv!=='undefined'?xlsOrCsv:undefined,fsx:()=>typeof fsx!=='undefined'?fsx:undefined,fvj:()=>typeof fvj!=='undefined'?fvj:undefined,idOf:()=>typeof idOf!=='undefined'?idOf:undefined,bzF:()=>typeof bzF!=='undefined'?bzF:undefined,bzB:()=>typeof bzB!=='undefined'?bzB:undefined,cat:()=>typeof cat!=='undefined'?cat:undefined,XLSX:()=>typeof XLSX!=='undefined'?XLSX:undefined};
const g=n=>G[n]();
const say=m=>{try{const t=g('toast');if(t)t(m)}catch(e){}};
const mgrOk=()=>{try{const f=g('isA');return typeof f==='function'?!!f():true}catch(e){return false}};
const sh=ag=>Math.round(ag||0)/100;/* אגורות ← ש"ח (מספר) */
const money=ag=>{const v=sh(ag);return(v<0?'-':'')+'₪'+Math.abs(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})};
const p2=n=>String(n).padStart(2,'0');
const hmm=min=>Math.floor((min||0)/60)+':'+p2(Math.round(min||0)%60);
const dfm=d=>/^\d{4}-\d{2}-\d{2}$/.test(d||'')?d.split('-').reverse().join('/'):String(d||'');
const monName=m=>{const M=['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];return/^\d{4}-\d{2}$/.test(m||'')?M[+m.slice(5)-1]+' '+m.slice(0,4):String(m||'')};
const safe=s=>String(s||'').replace(/[^\w֐-׿]+/g,'_').replace(/^_+|_+$/g,'');
const ilDay=ms=>{try{const p={};new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(ms)).forEach(x=>{p[x.type]=x.value});return p.year+'-'+p.month+'-'+p.day}catch(e){return new Date(ms).toISOString().slice(0,10)}};

/* ---------- טעינה בלחיצה: דיווח יומי ומשימות. כל כשל ← null ("אין דיווח") ---------- */
async function loadDr(uid,mon){
  try{
    const bzF=g('bzF'),bzB=g('bzB'),fsx=g('fsx'),fvj=g('fvj'),idOf=g('idOf');
    if(!uid||typeof fsx!=='function'||typeof fvj!=='function'||typeof idOf!=='function')return null;
    if(typeof bzF==='function'&&!bzF('dailyRep'))return null;
    if(typeof bzB==='function'&&!bzB())return null;
    const dec=d=>Object.assign({id:idOf(d)},fvj({mapValue:d}));
    const r=await fsx(':runQuery',{method:'POST',body:JSON.stringify({structuredQuery:{from:[{collectionId:'dr'}],where:{fieldFilter:{field:{fieldPath:'uid'},op:'EQUAL',value:{stringValue:String(uid)}}},limit:400}})});
    const L=(r||[]).filter(x=>x&&x.document).map(x=>dec(x.document)).filter(d=>typeof d.day==='string'&&d.day.slice(0,7)===mon);
    const get=async p=>{try{return dec(await fsx(p))}catch(e){return null}};
    const out={};
    await Promise.all(L.map(async d=>{
      const m=await get('/dr/'+d.id+'/x/m'),w=m&&(m.sumW||m.sum)?null:await get('/dr/'+d.id+'/x/w');
      let t=String((m&&(m.sumW||m.sum))||(w&&w.sumW)||'').trim();
      if(!t&&Array.isArray(d.e))t=d.e.map(e=>String(e&&(e.txt||e.tr)||'').trim()).filter(Boolean).join(' / ');
      out[d.day]=t||'דווח (ללא סיכום)'}));
    return out}catch(e){return null}}
async function loadTasks(uid,mon){
  try{
    const bzF=g('bzF'),fsx=g('fsx'),fvj=g('fvj'),idOf=g('idOf');
    if(!uid||typeof fsx!=='function'||typeof fvj!=='function'||typeof idOf!=='function')return null;
    if(typeof bzF==='function'&&!bzF('tasks'))return null;
    const r=await fsx(':runQuery',{method:'POST',body:JSON.stringify({structuredQuery:{from:[{collectionId:'tasks'}],where:{fieldFilter:{field:{fieldPath:'to'},op:'ARRAY_CONTAINS',value:{stringValue:String(uid)}}},limit:500}})});
    const out={};
    (r||[]).filter(x=>x&&x.document).forEach(x=>{const f=fvj({mapValue:x.document}),cr=+f.cr||0;if(!cr)return;const d=ilDay(cr);if(d.slice(0,7)!==mon)return;
      (out[d]=out[d]||[]).push({txt:String(f.txt||'').trim(),done:f.st==='done'})});
    return out}catch(e){return null}}

/* ---------- בניית הנתונים (טהור, בלי רשת) ---------- */
/* בונוס אוטומטי (src:'auto') בסכום 0 = "נבדק, לא הגיע" – לא נכנס לפירוט בדוחות (גם לא לסכום – הוא 0) */
const dataOf=()=>{const S=g('S')||{};return{wh:S.wh,bon:Array.isArray(S.bon)?S.bon.filter(b=>!(b&&b.src==='auto'&&window.PayCore&&window.PayCore.num(b.a)===0)):S.bon,psl:S.psl,tx:S.tx,pmon:g('pmon')}};
function empModel(sub,mon,dr,tk){
  const PC=window.PayCore,ms=PC.monthSum(sub,mon,dataOf());if(!ms)return null;
  const S=g('S')||{},days={};
  (Array.isArray(S.wh)?S.wh:[]).forEach(r=>{if(!r||r.sub!==sub.id||typeof r.d!=='string'||r.d.slice(0,7)!==mon)return;
    const sm=PC.shiftMin(r);if(!sm.ok)return;const k=days[r.d]||(days[r.d]={d:r.d,ins:[],outs:[],min:0});k.ins.push(String(r.in));k.outs.push(String(r.out));k.min+=sm.min});
  const rows=Object.keys(days).sort().map(d=>{const k=days[d],T=tk&&tk[d]||[];
    return{d,wd:DN[PC.wdOf(d)],in:k.ins.join(' / '),out:k.outs.join(' / '),min:k.min,
      sum:dr?(dr[d]||NONE):NONE,
      given:tk?T.map(t=>t.txt).filter(Boolean):null,done:tk?T.filter(t=>t.done).map(t=>t.txt).filter(Boolean):null}});
  return{ms,rows,hasDr:!!dr,hasTk:!!tk}}

/* ---------- אקסל ---------- */
function xlsxBuild(sheets){const X=g('XLSX');if(!X)return null;const wb=X.utils.book_new();
  Object.keys(sheets).forEach(n=>X.utils.book_append_sheet(wb,X.utils.aoa_to_sheet(sheets[n]),n.slice(0,31)));wb.Workbook={Views:[{RTL:true}]};
  return X.write(wb,{bookType:'xlsx',type:'array'})}
async function shareXlsx(name,sheets){
  const buf=xlsxBuild(sheets),sf=g('saveFile');
  if(buf&&typeof sf==='function'){await sf(name+'.xlsx',buf,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');return{ok:true,file:name+'.xlsx',fmt:'xlsx'}}
  const xc=g('xlsOrCsv');/* בלי ספריית האקסל: המנגנון הקיים (CSV) */
  if(typeof xc==='function'){xc(name,sheets);return{ok:true,file:name+'.csv',fmt:'csv'}}
  say('ספריית האקסל לא נטענה');return{ok:false}}

/* ---------- PDF: ציור שורות עם גלישת טקסט ארוך (עותק עצמאי; pdfPages הקיים לא נוגע) ---------- */
function drawPdf(sp){
  const W=1754,H=1240,M=60,LH=28,PAD=8,F='"Heebo","Noto Sans Hebrew","Segoe UI",Arial,sans-serif',MAXL=14,cols=sp.cols,sc=(W-2*M)/cols.reduce((a,c)=>a+c.w,0),pages=[];
  const nw=()=>{const c=document.createElement('canvas');c.width=W;c.height=H;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,W,H);x.direction='rtl';x.textBaseline='middle';pages.push(x);return x};
  const wrap=(x,t,w)=>{const out=[];String(t==null?'':t).split('\n').forEach(par=>{let line='';par.split(/\s+/).filter(Boolean).forEach(word=>{
      while(x.measureText(word).width>w&&word.length>1){let k=word.length-1;while(k>1&&x.measureText(word.slice(0,k)).width>w)k--;if(line){out.push(line);line=''}out.push(word.slice(0,k));word=word.slice(k)}
      const t2=line?line+' '+word:word;if(line&&x.measureText(t2).width>w){out.push(line);line=word}else line=t2});out.push(line)});
    if(out.length>MAXL){out.length=MAXL;out[MAXL-1]=out[MAXL-1]+'…'}return out};
  let x=nw(),y=M;
  const head=()=>{x.fillStyle='#1c5a49';x.fillRect(M,y,W-2*M,44);x.fillStyle='#fff';x.font='bold 21px '+F;let xr=W-M;cols.forEach(k=>{const w=k.w*sc;x.textAlign='right';x.fillText(k.h,xr-8,y+24);xr-=w});y+=44};
  x.fillStyle='#111';x.textAlign='right';x.font='bold 40px '+F;x.fillText(sp.title,W-M,y+20);y+=56;
  x.font='22px '+F;sp.meta.forEach(([k,v])=>{x.fillStyle='#555';x.fillText(k+': ',W-M,y);const kw=x.measureText(k+': ').width;x.fillStyle='#111';x.fillText(String(v),W-M-kw,y);y+=32});y+=10;head();
  x.font='20px '+F;
  sp.rows.forEach((r,i)=>{x.font='20px '+F;const cells=cols.map((k,j)=>wrap(x,r[j],k.w*sc-2*PAD)),h=Math.max(...cells.map(c=>c.length))*LH+2*PAD;
    if(y+h>H-M-50){x=nw();y=M;head();x.font='20px '+F}
    if(i%2){x.fillStyle='#eef1ea';x.fillRect(M,y,W-2*M,h)}
    x.fillStyle='#111';x.font='20px '+F;let xr=W-M;cols.forEach((k,j)=>{const w=k.w*sc;x.textAlign='right';cells[j].forEach((ln,q)=>x.fillText(ln,xr-PAD,y+PAD+LH/2+q*LH));xr-=w});
    x.strokeStyle='#d5dfe1';x.beginPath();x.moveTo(M,y+h);x.lineTo(W-M,y+h);x.stroke();y+=h});
  if(!sp.rows.length){x.fillStyle='#777';x.textAlign='center';x.font='22px '+F;x.fillText('אין שורות בתקופה',W/2,y+20);y+=40}
  y+=16;(sp.blocks||[]).forEach(b=>{const need=(b.title?44:0)+b.lines.length*36+10;if(y+need>H-M-40){x=nw();y=M}
    if(b.title){x.font='bold 26px '+F;x.fillStyle='#1c5a49';x.textAlign='right';x.fillText(b.title,W-M,y+14);y+=44}
    b.lines.forEach(([k,v,bold])=>{x.font=(bold?'bold ':'')+'24px '+F;x.fillStyle=bold?'#1c5a49':'#111';x.textAlign='right';x.fillText(k,W-M,y+14);x.textAlign='left';x.fillText(String(v),W-M-520,y+14);y+=36});y+=10});
  const stamp=new Date().toLocaleDateString('he-IL');
  return pages.map((p,i)=>{p.fillStyle='#777';p.font='18px '+F;p.textAlign='center';p.fillText('הופק ב־'+stamp+' · עמוד '+(i+1)+' מתוך '+pages.length,W/2,H-30);return p.canvas.toDataURL('image/jpeg',.9)})}
async function sharePdf(name,spec){
  const mk=g('mkPdf'),sf=g('saveFile');
  if(typeof mk!=='function'||typeof sf!=='function'){say('יצירת ה־PDF לא זמינה');return{ok:false}}
  await sf(name+'.pdf',mk(drawPdf(spec)),'application/pdf');return{ok:true,file:name+'.pdf',fmt:'pdf'}}

/* ---------- פירוט לעובד ---------- */
async function empReport(sub,mon,fmt){
  try{
    if(!mgrOk()){say('שכר – למנהל בלבד');return{ok:false}}
    if(!window.PayCore){say('מודול השכר לא נטען');return{ok:false}}
    const S=g('S')||{},sb=typeof sub==='string'?(S.subs||[]).find(x=>x.id===sub):sub;
    if(!sb||!sb.pay){say('לעובד אין הגדרות שכר');return{ok:false}}
    fmt=fmt==='xlsx'?'xlsx':'pdf';
    const uid=sb.pay.uid||'';/* בלי קישור uid ← אין דיווח ואין משימות, בלי שגיאה */
    const [dr,tk]=uid?await Promise.all([loadDr(uid,mon),loadTasks(uid,mon)]):[null,null];
    const M=empModel(sb,mon,dr,tk),ms=M.ms,nm=String(sb.name||'עובד'),file='Salary_'+(safe(nm)||'emp')+'_'+mon;
    const tkTxt=a=>a===null?NONE:a.length?a.map((t,i)=>(i+1)+'. '+t).join('\n'):'אין משימות';
    const sumLines=[['שכר בסיס',ms.base]].concat(ms.adds.map(a=>['תוספת: '+(a.n||'ללא שם')+(a.k==='day'?' ('+a.cnt+' ימים × '+money(a.per)+')':''),a.amt]));
    if(ms.slip)sumLines.push(['לפי תלוש (נטו)',ms.slip.net]);
    const total=[['סה״כ לתשלום',ms.due],['שולם',ms.paid],['להעביר',ms.left,1]];
    if(fmt==='xlsx'){
      const rows=[['תאריך','יום','כניסה','יציאה','סה״כ שעות','שעות (מספר)','סיכום היום','משימות שהוטלו','משימות שבוצעו']].concat(M.rows.map(r=>[dfm(r.d),r.wd,r.in,r.out,hmm(r.min),Math.round(r.min/60*100)/100,r.sum,r.given===null?NONE:r.given.length?r.given.join('\n'):'אין משימות',r.done===null?NONE:r.done.length?r.done.join('\n'):'אין משימות']));
      rows.push(['סה״כ','','','',hmm(ms.minutes),Math.round(ms.minutes/60*100)/100,'','','']);
      const sm=[['עובד',nm],['חודש',monName(mon)],['',''],['סעיף','סכום (₪)','פירוט']];
      sumLines.forEach(([k,v])=>sm.push([k,sh(v),'']));
      sm.push(['בונוס (סה״כ)',sh(ms.bonus),'']);ms.bons.forEach(b=>sm.push(['  בונוס: '+(b.n||'ללא פירוט'),sh(b.a),b.n||'']));
      total.forEach(([k,v])=>sm.push([k,sh(v),'']));
      return await shareXlsx(file,{'פירוט':rows,'סיכום':sm})}
    const rows=M.rows.map(r=>[dfm(r.d)+'\n'+r.wd,r.in,r.out,hmm(r.min),r.sum,tkTxt(r.given),tkTxt(r.done)]);
    const blocks=[{title:'תוספות ושכר',lines:sumLines.map(([k,v])=>[k,money(v)])},
      {title:'בונוס',lines:ms.bons.length?ms.bons.map(b=>[b.n||'ללא פירוט',money(b.a)]).concat([['סה״כ בונוס',money(ms.bonus),1]]):[['אין בונוס','']]},
      {title:'סיכום',lines:total.map(([k,v,b])=>[k,money(v),b])}];
    return await sharePdf(file,{title:'פירוט שעות ושכר – '+nm,meta:[['חודש',monName(mon)],['סה״כ שעות',hmm(ms.minutes)+' ('+ms.days+' ימי עבודה)']],
      cols:[{h:'תאריך',w:1.1},{h:'כניסה',w:1},{h:'יציאה',w:1},{h:'סה״כ שעות',w:1},{h:'סיכום היום',w:4},{h:'משימות שהוטלו',w:3},{h:'משימות שבוצעו',w:3}],rows,blocks})
  }catch(e){say('יצירת הדוח נכשלה: '+(e&&e.message||e));return{ok:false}}}

/* ---------- לרואה החשבון ---------- */
async function accReport(mon,fmt){
  try{
    if(!mgrOk()){say('שכר – למנהל בלבד');return{ok:false}}
    if(!window.PayCore){say('מודול השכר לא נטען');return{ok:false}}
    const S=g('S')||{},catf=g('cat');fmt=fmt==='xlsx'?'xlsx':'pdf';
    const isEmp=s=>{try{return typeof catf!=='function'||(catf(s.cat)||{}).beh==='emp'}catch(e){return true}};
    const L=(S.subs||[]).filter(s=>s&&s.pay&&s.pay.slip&&isEmp(s)).map(s=>({s,m:window.PayCore.monthSum(s,mon,dataOf())})).filter(x=>x.m);
    if(!L.length){say('אין עובדים בתלוש');return{ok:false}}
    const file='Accountant_'+mon,sum=(a,f)=>a.reduce((t,x)=>t+f(x),0);
    const addTxt=m=>m.adds.length?m.adds.map(a=>(a.n||'ללא שם')+': '+money(a.amt)).join('\n'):'—';
    const bonTxt=m=>m.bons.length?m.bons.map(b=>(b.n||'ללא פירוט')+': '+money(b.a)).join('\n'):'—';
    if(fmt==='xlsx'){
      const rows=[['עובד','שעות','שעות (מספר)','תוספות (₪)','פירוט תוספות','בונוסים (₪)','פירוט בונוסים','נטו לפי תלוש (₪)']].concat(L.map(({s,m})=>[s.name||'',hmm(m.minutes),Math.round(m.minutes/60*100)/100,sh(sum(m.adds,a=>a.amt)),addTxt(m),sh(m.bonus),bonTxt(m),m.slip?sh(m.slip.net):'']));
      const det=[['עובד','סוג','פירוט','סכום (₪)']];
      L.forEach(({s,m})=>{m.adds.forEach(a=>det.push([s.name||'','תוספת',a.n||'',sh(a.amt)]));m.bons.forEach(b=>det.push([s.name||'','בונוס',b.n||'',sh(b.a)]))});
      return await shareXlsx(file,{'סיכום':rows,'פירוט':det})}
    const rows=L.map(({s,m})=>[s.name||'',hmm(m.minutes),money(sum(m.adds,a=>a.amt)),addTxt(m),money(m.bonus),bonTxt(m),m.slip?money(m.slip.net):'—']);
    return await sharePdf(file,{title:'דוח שכר לרואה החשבון',meta:[['חודש',monName(mon)],['עובדים בתלוש',L.length]],
      cols:[{h:'עובד',w:2},{h:'שעות',w:1},{h:'תוספות',w:1.3},{h:'פירוט תוספות',w:3},{h:'בונוסים',w:1.3},{h:'פירוט בונוסים',w:3},{h:'נטו לפי תלוש',w:1.4}],rows,
      blocks:[{title:'סה״כ',lines:[['תוספות',money(sum(L,x=>sum(x.m.adds,a=>a.amt)))],['בונוסים',money(sum(L,x=>x.m.bonus)),1]]}]})
  }catch(e){say('יצירת הדוח נכשלה: '+(e&&e.message||e));return{ok:false}}}

window.PayOut={empReport,accReport,_model:empModel};
})();
