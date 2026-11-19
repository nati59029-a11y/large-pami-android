/* שכר – תלושים (שלב ה', משימה 2026-11-18_שכר-ותלושים). קובץ עצמאי, נטען אחרי index.html ואחרי payroll.js.
   חלק טהור (נטען גם ב-node, firebase/tests/payroll-psl.unit.test.js): פענוח טקסט של תלוש – parseSlip, findMon, findEmp, groupPages, checkVals.
   חלק אפליקציה (מנהל בלבד; עובד לא רואה כלום):
     העלאה בשלוש צורות – PDF של עובד אחד; PDF מרוכז של כל העובדים (טקסט לכל עמוד ← זיהוי עובד וחודש ← כל עמוד/רצף עמודים של
     אותו עובד מרונדר לתמונה ונשמר כ-PDF נפרד בעזרת mkScanPdf הקיים; עמוד שלא זוהה – שיוך ידני או דילוג, ולעולם לא מצורף אוטומטית);
     תמונה (JPG/PNG) – הזנה ידנית עם תצוגת התמונה. עד 3MB לקובץ שנשמר (דחיסה אם צריך).
     חלון אישור: עובד, חודש, ברוטו, נטו ורכיבי עלות מעביד – הכול ניתן לעריכה; מה שלא נקרא – ריק.
     שמירה: S.psl {id,sub,mon,f,name,gross,net,ec:[{k,n,a}],src,ok:1,at} + הקובץ ב-IndexedDB (fput, מזהה 'ps…', נכנס לגיבוי דרך bkFileIds)
       + רשומת S.tx לכל רכיב עלות מעביד: {t:'exp',cat,sub,date:סוף החודש,amt,plan:חודש,pays:[],ec:1,eck,psl,note} – נספרת ברווח, לא ב"שולם לעובד".
     תלוש חדש לאותו עובד וחודש מחליף את הקודם; מחיקה/החלפה חסומות כשרשומת ec שויכה לחיוב אשראי (t.ecl) או לבנק (stl).
     חיוב אשראי ← עלויות מעביד: בטופס חיוב אשראי חדש (אותה רשימה של "תשלום עבור חשבונית") נוספות קבוצות של עלויות מעביד לפי חודש/רכיב.
       בחירה ← החיוב מסומן x (לא נספר פעמיים, כמו בחשבונית) ונשמרת בו רשימת ה-ec (ecl). שיוך מחושב מ-ecl – מחיקת החיוב משחררת.
     פרטיות: רשומות ec לא נכנסות לרשימה לפי עובד במראה לעובדים (sal_), רק לסכומים (rps_, bal_); תוכן תלושים לא נכתב ליומן.
     רשומת ec לא נמחקת ולא נערכת כתנועה רגילה (רק דרך התלוש); כרטיס עובד עם תלושים/שעות/בונוסים לא נמחק (pslSubN).
   משתמש ב: S, V, ACT, FRM, CHG, isA, isW, subById, cat, save, dlg, closeDlg, ask, toast, go, rerender, esc, pNum, uid, fput, fget, fdelK,
     pdfLoad, mkScanPdf, viewImg, ils, mfmt, NOWM, isNat, u8b64, du2b, rdU, ldImg, s_, detHtml, readTx, wvWant. */
(function(root){
'use strict';
/* ================= חלק טהור ================= */
const BIDI=/[‎‏‪-‮⁦-⁩؜﻿]/g;
const HEB=/[א-ת]/;
const rv=s=>[...String(s)].reverse().join('');
function norm(s){return String(s==null?'':s).replace(BIDI,'').replace(/[    \t]/g,' ').replace(/[״”“„]/g,'"').replace(/[׳’‘`´]/g,"'").replace(/[−–—]/g,'-')
  .replace(/ש"ח|ח"ש|₪|NIS/g,' ').replace(/%/g,' % ').replace(/ {2,}/g,' ')}
const key=t=>String(t).replace(/["'.:,;()[\]{}|*]/g,'').replace(/^-+|-+$/g,'');
const lines=text=>norm(text).split(/\r?\n/).map(l=>l.trim().split(' ').filter(Boolean)).filter(T=>T.length);
/* מילון תוויות (אחרי key: בלי גרשיים, נקודות ונקודתיים). הסדר = עדיפות */
const LB={gross:['סהכ ברוטו','סך הכל ברוטו','סך ברוטו','שכר ברוטו','ברוטו לתשלום','סהכ תשלומים'],
  net:['נטו לתשלום','שכר נטו','סהכ נטו','נטו לבנק','נטו בבנק','סכום נטו']};
const EC=[['bl','ביטוח לאומי מעביד',['ביטוח לאומי מעביד','ביטוח לאומי מעסיק','בטוח לאומי מעביד','בטוח לאומי מעסיק','ביטוח לאומי חלק מעביד','בל מעביד','בל מעסיק']],
  ['pen','פנסיה / תגמולי מעביד',['פנסיה מעביד','פנסיה מעסיק','תגמולי מעביד','תגמולי מעסיק','תגמולים מעביד','תגמולים מעסיק','גמל מעביד','גמל מעסיק']],
  ['sev','פיצויים',['פיצויים מעביד','פיצויים מעסיק','הפרשה לפיצויים','פיצויים']],
  ['kh','קרן השתלמות מעביד',['קרן השתלמות מעביד','קרן השתלמות מעסיק','השתלמות מעביד','השתלמות מעסיק','קהשתלמות מעביד']],
  ['mt','מס מעסיקים',['מס מעסיקים','מס מעסיק']]];
const NOTAFTER=new Set(['עובד','עובדת','העובד','לעובד']);
/* מספר כספי מטוקן. טקסט עברי הפוך (סדר חזותי) הופך לפעמים גם את הספרות: "76.543,21" ← 12,345.67. כמו שהוא – אם תקין; אחרת הפוך */
const MONEY=/^(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/;
function numTok(tok){let s=String(tok).replace(/^\(|\)$/g,'');let neg=false;if(/^-|-$/.test(s)){neg=true;s=s.replace(/^-+|-+$/g,'')}
  if(!/^[\d.,]+$/.test(s))return null;const ok=x=>MONEY.test(x)&&!/^0\d/.test(x),v=ok(s)?s:ok(rv(s))?rv(s):null;if(v===null)return null;
  const n=+v.replace(/,/g,'');return Number.isFinite(n)?{n:neg?-n:n,dec:/\.\d{1,2}$/.test(v),dig:v.replace(/\D/g,'').length}:null}
function nums(T){const o=[];T.forEach((t,i)=>{const x=numTok(t);if(!x||((T[i+1]==='%'||T[i-1]==='%')&&Math.abs(x.n)<100))return;o.push(Object.assign({i},x))});/* אחוז (מספר קטן ליד %) אינו סכום */
  const d=o.filter(x=>x.dec);return d.length?d:o.filter(x=>x.dig<=6)}
/* תווית בשורה: 4 כיוונים (סדר מילים רגיל/הפוך × אותיות רגילות/הפוכות). מחזיר {s,e,n,f} במרחב האינדקסים של הכיוון, או null */
function matchLabel(T,seq){const n=T.length,K=T.map(key),R=T.map(t=>key(rv(t)));
  const C=[[K,0],[K.slice().reverse(),1],[R,0],[R.slice().reverse(),1]];
  for(const [A,f] of C){for(let i=0;i+seq.length<=A.length;i++){let ok=true;for(let j=0;j<seq.length;j++)if(A[i+j]!==seq[j]){ok=false;break}
    if(!ok)continue;const nx=A[i+seq.length],nxr=nx?rv(nx):'';if(nx&&(NOTAFTER.has(nx)||NOTAFTER.has(nxr)))continue;return{s:i,e:i+seq.length-1,n,f}}}return null}
/* הסכום של התווית: הראשון אחריה (עד המילה העברית הבאה); אם אין – הראשון לפניה (עד המילה העברית הקודמת). בכיוון שבו התווית נמצאה */
function near(T,m){const N=new Map(nums(T).map(x=>[m.f?m.n-1-x.i:x.i,x.n])),A=m.f?T.slice().reverse():T;
  for(let k=m.e+1;k<A.length;k++){if(N.has(k))return N.get(k);if(HEB.test(A[k]))break}
  for(let k=m.s-1;k>=0;k--){if(N.has(k))return N.get(k);if(HEB.test(A[k]))break}return null}
function findVal(L,labels){for(const lb of labels){const seq=lb.split(' ');for(let li=0;li<L.length;li++){const m=matchLabel(L[li],seq);if(!m)continue;
  let v=near(L[li],m);if(v===null&&li+1<L.length){const nx=nums(L[li+1]);if(nx.length===1)v=nx[0].n}if(v!==null)return v}}return null}
const pos=v=>typeof v==='number'&&Number.isFinite(v)&&v>0&&v<1e7;
const r2=v=>Math.round(v*100)/100;
/* פענוח תלוש מטקסט. מחזיר {gross, net, ec:[{k,n,a}], found, warn}. מה שלא נמצא/לא תקין – null (ריק בחלון האישור) */
function parseSlip(text){const L=lines(text),warn=[];let gross=findVal(L,LB.gross),net=findVal(L,LB.net);
  if(gross!==null&&!pos(gross)){warn.push('ברוטו שנקרא לא תקין – לא נלקח');gross=null}
  if(net!==null&&!pos(net)){warn.push('נטו שנקרא לא תקין – לא נלקח');net=null}
  if(gross!==null)gross=r2(gross);if(net!==null)net=r2(net);
  if(gross!==null&&net!==null&&net>gross)warn.push('הנטו שנקרא גדול מהברוטו – בדקו');
  const ec=[];EC.forEach(([k,n,lb])=>{const v=findVal(L,lb);if(v===null)return;if(!pos(v)){warn.push(n+': ערך לא תקין – לא נלקח');return}
    if(gross!==null&&v>gross){warn.push(n+': גדול מהברוטו – לא נלקח');return}ec.push({k,n,a:r2(v)})});
  return{gross,net,ec,found:(gross!==null)+(net!==null)+ec.length,warn}}
/* בדיקת הערכים לפני שמירה (מחלון האישור). מחזיר רשימת שגיאות */
function checkVals(o){const e=[],v=o||{};
  if(!pos(v.net))e.push('נטו לתשלום: מספר חיובי (חובה)');
  if(v.gross!==null&&v.gross!==undefined&&!pos(v.gross))e.push('ברוטו: מספר חיובי או ריק');
  if(pos(v.net)&&pos(v.gross)&&v.net>v.gross+0.004)e.push('הנטו גדול מהברוטו – בדקו');
  (Array.isArray(v.ec)?v.ec:[]).forEach(x=>{if(!x||!pos(x.a))e.push((x&&x.n||'עלות מעביד')+': מספר חיובי או ריק')});return e}
/* חודש התלוש */
const MNS=['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
const RX_N=new RegExp('[\\s(:\\-/][לב]?('+MNS.join('|')+'|מרס)[\\s,\\-/]*(20\\d{2})(?=[\\s,.)]|$)');
const RX_D=/[\s(:]((?:0?[1-9])|(?:1[0-2]))[/.\-](20\d{2})(?=[\s,)]|$)/;
const RX_I=/[\s(:](20\d{2})-(0[1-9]|1[0-2])(?=[\s,)]|$)/;
const p2=n=>String(n).padStart(2,'0');
function findMon(text){const L=lines(text),hits=[];
  L.forEach((T,li)=>{const h=T.map(t=>HEB.test(t)?rv(t):t),r=T.map(rv),V=[T,h,r,T.slice().reverse(),h.slice().reverse(),r.slice().reverse()].map(x=>' '+x.join(' ')+' ');
    const pri=V.some(s=>/תלוש|חודש|שכר/.test(s))?1:0;
    for(const s of V){let m=RX_N.exec(s);if(m){const k=m[1]==='מרס'?3:MNS.indexOf(m[1])+1;hits.push({m:m[2]+'-'+p2(k),pri,w:2,li});continue}
      m=RX_I.exec(s);if(m){hits.push({m:m[1]+'-'+m[2],pri,w:1,li});continue}
      m=RX_D.exec(s);if(m)hits.push({m:m[2]+'-'+p2(+m[1]),pri,w:1,li})}});
  if(!hits.length)return'';hits.sort((a,b)=>b.pri-a.pri||b.w-a.w||a.li-b.li);return hits[0].m}
/* זיהוי עובד: ת"ז (s.pay.tz) קודם, אחר כך שם מלא (כל מילות השם ברצף אחד בשורה, בכל סדר). יותר מאחד ← null (שיוך ידני) */
function nameToks(n){return norm(n).split(' ').map(key).filter(x=>x.length>=2)}
function nameIn(L,nt){const want=nt.slice().sort().join(' ');
  for(const T of L){for(const A of [T.map(key),T.map(t=>key(rv(t)))]){for(let i=0;i+nt.length<=A.length;i++){if(A.slice(i,i+nt.length).sort().join(' ')===want)return true}}}return false}
function findEmp(text,emps){const L=lines(text),E=(Array.isArray(emps)?emps:[]).filter(e=>e&&e.id);
  const dg=new Set();L.forEach(T=>T.forEach(t=>{const d=t.replace(/-/g,'');if(/^\d{5,9}$/.test(d)){dg.add(d.padStart(9,'0'));dg.add(rv(d).padStart(9,'0'))}}));
  const tz=E.filter(e=>{const z=String(e.tz||'').replace(/\D/g,'');return z.length>=5&&z.length<=9&&dg.has(z.padStart(9,'0'))});
  if(tz.length===1)return{id:tz[0].id,by:'tz'};if(tz.length>1)return null;
  const H=E.map(e=>{const nt=nameToks(e.name);return nt.length&&nameIn(L,nt)?{e,nt}:null}).filter(Boolean);
  if(!H.length)return null;H.sort((a,b)=>b.nt.length-a.nt.length);const top=H[0];
  for(const h of H.slice(1)){if(h.nt.length===top.nt.length||!h.nt.every(x=>top.nt.includes(x)))return null}
  return{id:top.e.id,by:'name'}}
/* PDF מרוכז: עמודים ← קבוצות. עמודים רצופים של אותו עובד (ואותו חודש, או חודש לא מזוהה) – קבוצה אחת. עמוד לא מזוהה – תמיד לבד (sub:'') */
function groupPages(pages,emps){const G=[];(Array.isArray(pages)?pages:[]).forEach((tx,i)=>{const e=findEmp(tx,emps),m=findMon(tx),last=G[G.length-1];
  if(e&&last&&last.sub===e.id&&last.pages[last.pages.length-1]===i-1&&(!m||!last.mon||last.mon===m)){last.pages.push(i);if(!last.mon)last.mon=m;last.text+='\n'+tx;return}
  G.push({sub:e?e.id:'',by:e?e.by:'',mon:m,pages:[i],text:String(tx||'')})});return G}
const API={norm,numTok,parseSlip,checkVals,findMon,findEmp,groupPages,EC:EC.map(([k,n])=>({k,n}))};
if(typeof module!=='undefined'&&module.exports){module.exports=API;return}
root.PayPsl=API;

/* ================= חלק אפליקציה ================= */
if(typeof V==='undefined'||typeof ACT==='undefined'||typeof FRM==='undefined'||typeof CHG==='undefined'||typeof isA!=='function'||typeof save!=='function'||typeof S==='undefined')return;
const on=()=>{try{return isA()&&!(typeof isW==='function'&&isW())}catch(e){return false}};
const MAXB=3*1024*1024,MAXPG=60,PART=24;
const big='style="min-height:48px"';
const G2='style="display:grid;grid-template-columns:1fr 1fr;gap:8px"';
const AR=k=>{if(!Array.isArray(S[k]))S[k]=[];return S[k]};
const empOf=id=>{try{const s=id&&subById(id);return s&&(cat(s.cat)||{}).beh==='emp'?s:null}catch(e){return null}};
const emps=()=>(S.subs||[]).filter(s=>s&&(cat(s.cat)||{}).beh==='emp');
const monV=m=>/^\d{4}-(0[1-9]|1[0-2])$/.test(m||'');
const prevMon=()=>{let m;try{m=NOWM()}catch(e){const d=new Date();m=d.getFullYear()+'-'+p2(d.getMonth()+1)}let y=+m.slice(0,4),k=+m.slice(5,7)-1;if(!k){k=12;y--}return y+'-'+p2(k)};
const lastDay=m=>{const y=+m.slice(0,4),k=+m.slice(5,7);return m+'-'+p2(new Date(Date.UTC(y,k,0)).getUTCDate())};
const duBytes=du=>{const i=du.indexOf(',');return Math.floor((du.length-i-1)*3/4)};
const pdfDU=u8=>'data:application/pdf;base64,'+u8b64(u8);
const uerr=m=>{const e=new Error(m);e.user=1;return e};
const safe=s=>String(s||'').replace(/[^\w֐-׿]+/g,'_').replace(/^_+|_+$/g,'');
const fname=p=>{const s=empOf(p.sub);return 'Payslip_'+(safe(s&&s.name)||'emp')+'_'+p.mon};
const ag=v=>v==null||v===''?'—':ils(v);
const ecOf=pid=>S.tx.filter(t=>t&&t.ec&&t.psl===pid);
/* רשומת ec ששויכה לחיוב אשראי (ecl) או לבנק (stl / שורת דף בנק) – לא נמחקת */
function ecLock(t){if(!t)return false;if(t.stl||(Array.isArray(t.pays)&&t.pays.length))return true;
  if(Array.isArray(S.stl)&&S.stl.some(l=>l&&l.tx===t.id))return true;return S.tx.some(c=>c&&Array.isArray(c.ecl)&&c.ecl.includes(t.id))}
const pslLock=p=>ecOf(p.id).some(ecLock);
/* מוחק תלוש ואת רשומות ה-ec שלו (רק אחרי בדיקת pslLock). מחזיר את מזהה הקובץ למחיקה אחרי save */
function pslDrop(p){for(let i=S.tx.length-1;i>=0;i--){const t=S.tx[i];if(t&&t.ec&&t.psl===p.id)S.tx.splice(i,1)}const L=AR('psl'),i=L.indexOf(p);if(i>=0)L.splice(i,1);
  return p.f&&!L.some(x=>x&&x.f===p.f)?p.f:''}
const delF=ids=>ids.filter(Boolean).forEach(id=>{try{if(typeof fdelK==='function')fdelK(id)}catch(e){}});

/* ---- PDF: טקסט ותמונות עמודים (pdf.js המקומי) ---- */
async function pdfOpen(du){const L=await pdfLoad();return L.getDocument({data:new Uint8Array(await du2b(du).arrayBuffer())}).promise}
async function pageText(doc,p){const pg=await doc.getPage(p),tc=await pg.getTextContent(),L=[];
  tc.items.forEach(it=>{const s=String(it.str||'');if(!s.trim())return;const x=it.transform[4],y=it.transform[5],w=it.width||0;let ln=L.find(l=>Math.abs(l.y-y)<3);if(!ln){ln={y,it:[]};L.push(ln)}ln.it.push({x0:x,x1:x+w,s})});
  return L.sort((a,b)=>b.y-a.y).map(l=>{let s='',px=null;l.it.sort((a,b)=>b.x1-a.x1).forEach(i=>{s+=px!==null&&px-i.x1<1.2?i.s:(s?' ':'')+i.s;px=i.x0});return s}).join('\n')}
async function pageImg(doc,p,maxW,q){const pg=await doc.getPage(p),v0=pg.getViewport({scale:1}),v=pg.getViewport({scale:Math.min(3,maxW/v0.width)}),c=document.createElement('canvas');
  c.width=Math.round(v.width);c.height=Math.round(v.height);const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);
  await pg.render({canvasContext:x,viewport:v}).promise;const u=c.toDataURL('image/jpeg',q);c.width=c.height=0;return u}
/* עמודים נבחרים בלבד ← PDF חדש (תמונות), עד 3MB */
async function pagesPdf(doc,nums){for(const [w,q] of [[1400,.85],[1100,.72],[850,.6],[650,.5]]){const pgs=[];for(const p of nums)pgs.push(await pageImg(doc,p,w,q));
  const u8=await mkScanPdf(pgs);if(u8.length<=MAXB)return{du:pdfDU(u8),pv:pgs[0],pgs}}throw uerr('הקובץ גדול מדי גם אחרי דחיסה (עד 3MB)')}
async function imgDU(f){const i=await ldImg(await rdU(f));for(const [w,q] of [[1800,.85],[1400,.75],[1100,.65],[850,.55]]){const k=Math.min(1,w/Math.max(i.width,i.height)),c=document.createElement('canvas');
  c.width=Math.max(1,Math.round(i.width*k));c.height=Math.max(1,Math.round(i.height*k));const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);x.drawImage(i,0,0,c.width,c.height);
  const o=c.toDataURL('image/jpeg',q);c.width=c.height=0;if(duBytes(o)<=MAXB)return o}throw uerr('התמונה גדולה מדי גם אחרי דחיסה (עד 3MB)')}

/* ---- העלאה ---- */
const PS={busy:0,q:[],i:0,batch:{},sel:new Set(),sh:null,sub:'',saved:0};
async function intake(f,mode,sub){
  const isPdf=f.type==='application/pdf'||/\.pdf$/i.test(f.name||''),isImg=/^image\/(jpeg|png)$/.test(f.type)||/\.(jpe?g|png)$/i.test(f.name||'');
  if(!isPdf&&!isImg)return toast('אפשר PDF או תמונה (JPG / PNG)');
  if(f.size>40*1048576)return toast('הקובץ גדול מדי');
  const def=prevMon(),Q=[];
  if(isImg){if(mode==='all')return toast('קובץ מרוכז – רק PDF');const du=await imgDU(f);
    Q.push({sub,mon:def,du,pv:du,src:'img',v:{gross:null,net:null,ec:[]},why:['תמונה – בלי קריאה אוטומטית. הזינו את הנתונים לפי התמונה.'],cf:1})}
  else{const du0=await rdU(f);let doc;try{doc=await pdfOpen(du0)}catch(e){return toast('לא הצלחתי לפתוח את קובץ ה-PDF')}
    try{const n=doc.numPages;if(n>MAXPG)return toast('עד '+MAXPG+' עמודים בקובץ');
      const T=[];for(let p=1;p<=n;p++){let t='';try{t=await pageText(doc,p)}catch(e){}T.push(t)}
      const E=emps().map(s=>({id:s.id,name:s.name,tz:s.pay&&s.pay.tz})),G=groupPages(T,E),ids=[...new Set(G.filter(g=>g.sub).map(g=>g.sub))];
      const noTxt=!T.some(t=>t.trim());
      if(mode==='one'&&n===1){const all=T.join('\n'),v=parseSlip(all),why=v.warn.slice();
        let s0=sub;if(ids.length===1&&ids[0]!==sub){const a=empOf(sub),b=empOf(ids[0]);why.unshift('הקובץ הועלה מהכרטיס של '+(a?a.name:'—')+', אבל בתלוש זוהה '+(b?b.name:'—')+'. בדקו את העובד.');s0=ids[0]}
        if(noTxt)why.unshift('אין טקסט בקובץ (כנראה סרוק) – הזינו ידנית.');else if(!v.found)why.unshift('לא נמצאו נתונים בתלוש – הזינו ידנית.');
        /* עמוד אחד שלא זוהה בוודאות לעובד – נשמר רק באישור מפורש (סימון בחלון) */const cf=!ids.length;if(cf)why.unshift('בתלוש לא זוהה שם העובד או ת״ז שלו. ודאו שזה התלוש של העובד שנבחר וסמנו אישור.');
        let o;if(duBytes(du0)<=MAXB)o={du:du0,pv:await pageImg(doc,1,700,.8),pgs:null};else o=await pagesPdf(doc,T.map((_,i)=>i+1));
        Q.push({sub:s0,mon:findMon(all)||def,du:o.du,pv:o.pv,pgs:o.pgs,src:'pdf',v,why,cf})}
      else{/* העלאה מכרטיס עובד של קובץ עם כמה עמודים: תמיד פיצול לפי עמוד. עמוד שלא זוהה לעובד – לא נשמר אוטומטית (שיוך ידני או דילוג), והערכים נקראים רק מהעמודים של כל קבוצה */
        if(mode==='one')toast(ids.length>1?'בקובץ יש תלושים של כמה עובדים – מפצלים לפי עמוד':'בקובץ כמה עמודים – כל עמוד נבדק בנפרד');
        for(const g of G){const o=await pagesPdf(doc,g.pages.map(i=>i+1)),v=parseSlip(g.text),why=v.warn.slice(),pl=g.pages.length>1?'עמודים '+(g.pages[0]+1)+'–'+(g.pages[g.pages.length-1]+1):'עמוד '+(g.pages[0]+1);
          if(!g.sub)why.unshift(pl+': לא זוהה עובד'+(noTxt?' (אין טקסט בקובץ)':'')+'. בחרו עובד או דלגו.'+(mode==='one'?' ייתכן שזה עמוד של עובד אחר – אל תשייכו אותו בלי לבדוק.':''));
          else if(mode==='one'&&sub&&g.sub!==sub){const a=empOf(sub),b=empOf(g.sub);why.unshift(pl+': זוהה '+(b?b.name:'—')+' ולא '+(a?a.name:'—')+'. העמוד יישמר רק אצל העובד שנבחר כאן.')}if(g.sub&&!v.found)why.unshift(pl+': לא נמצאו נתונים – הזינו ידנית.');
          Q.push({sub:g.sub,mon:g.mon||def,du:o.du,pv:o.pv,pgs:o.pgs,src:'pdfc',v,why,pl,auto:!!g.sub})}}}
    finally{try{doc.destroy()}catch(e){}}}
  PS.q=Q;PS.i=0;PS.batch={};PS.saved=0;showPiece()}
CHG.pslFile=async el=>{const f=el.files&&el.files[0];el.value='';if(!f||!on())return;if(PS.busy)return toast('קורא קובץ קודם…');PS.busy=1;toast('קורא את הקובץ…');
  try{await intake(f,el.dataset.m==='all'?'all':'one',el.dataset.sub||'')}catch(e){toast(e&&e.user?e.message:'קריאת הקובץ נכשלה')}finally{PS.busy=0}};

/* ---- חלון אישור ---- */
const inp=(l,n,v,x)=>`<label class="f"><span>${l}</span><input name="${n}" value="${esc(v==null?'':String(v))}" ${x||''}></label>`;
function showPiece(){const it=PS.q[PS.i];
  if(!it){const n=PS.saved,N=PS.q.length;PS.q=[];PS.i=0;closeDlg();if(N)toast(n?(n===1?'התלוש נשמר':n+' תלושים נשמרו')+(N>n?' · '+(N-n)+' דולגו':''):'לא נשמר תלוש');rerender();return}
  const N=PS.q.length,ecv=k=>{const x=(it.v.ec||[]).find(e=>e.k===k);return x?x.a:''};
  const E=emps(),old=it.sub&&AR('psl').some(p=>p&&p.sub===it.sub&&p.mon===it.mon);
  const opts=`<option value="">בחרו עובד</option>`+E.map(s=>`<option value="${esc(s.id)}"${s.id===it.sub?' selected':''}>${esc(s.name)}</option>`).join('');
  dlg(`<h3>אישור תלוש${N>1?' · '+(PS.i+1)+' מתוך '+N:''}</h3>${it.pv?`<img alt="תצוגת התלוש" src="${esc(it.pv)}" style="display:block;max-width:100%;max-height:260px;margin:0 auto 6px;border:1px solid var(--line);border-radius:8px;background:#fff">`:''}
<button type="button" class="btn g s" data-a="pslPv">צפייה מלאה</button>
${(it.why||[]).map(w=>`<div class="note"><span class="tag t1">לבדיקה</span> ${esc(w)}</div>`).join('')}
<form data-f="pslOkF" novalidate><label class="f"><span>עובד</span><select name="sub">${opts}</select></label>
${inp('חודש התלוש','mon',it.mon,'type="month"')}<div ${G2}>${inp('ברוטו (₪)','gross',it.v.gross,'inputmode="decimal" autocomplete="off"')}${inp('נטו לתשלום (₪)','net',it.v.net,'inputmode="decimal" autocomplete="off"')}</div>
<div class="sec"><h3>עלויות מעביד</h3></div><div ${G2}>${EC.map(([k,n])=>inp(n+' (₪)','ec_'+k,ecv(k),'inputmode="decimal" autocomplete="off"')).join('')}</div>
<p class="note">שדה ריק = לא נרשם. כל עלות מעביד נרשמת כהוצאה של העובד לאותו חודש (נספרת ברווח, לא ב"שולם לעובד").${old?' <b>לעובד כבר יש תלוש לחודש הזה – הוא יוחלף.</b>':''}${it.pgs&&!it.auto?' אם בוחרים עובד וחודש שכבר אושרו בהעלאה הזו – העמוד מצורף לתלוש שלו (שדה ריק = הערך שכבר אושר).':''}</p>
${it.cf?`<label class="cb" style="min-height:48px;display:flex;align-items:center;gap:8px"><input type="checkbox" name="cf"> בדקתי: זה התלוש של העובד שנבחר</label>`:''}
<div class="row"><button type="submit" class="btn grow" ${big}>אישור ושמירה</button>${N>1?`<button type="button" class="btn g grow" ${big} data-a="pslSkip">דילוג</button>`:''}<button type="button" class="btn g grow" ${big} data-a="pslCancel">${N>1?'הפסקה':'ביטול'}</button></div></form>`)}
ACT.pslPv=()=>{const it=PS.q[PS.i];if(it&&typeof viewImg==='function')viewImg(null,'Payslip',it.du)};
ACT.pslSkip=()=>{if(!PS.q[PS.i])return;PS.i++;showPiece()};
ACT.pslCancel=()=>{PS.i=PS.q.length;showPiece()};
FRM.pslOkF=async f=>{if(!on()||f.dataset.busy)return;const it=PS.q[PS.i];if(!it)return;const g=n=>s_((f.elements[n]||{}).value||'');
  const s=empOf(g('sub'));if(!s)return toast('בחרו עובד');const mon=g('mon');if(!monV(mon))return toast('חודש לא תקין');
  const num=n=>{const v=g(n);if(!v)return null;const x=pNum(v);return typeof x==='number'&&Number.isFinite(x)?r2(x):NaN};
  let v={gross:num('gross'),net:num('net'),ec:EC.map(([k,n])=>({k,n,a:num('ec_'+k)})).filter(x=>x.a!==null)};
  const kb=s.id+'|'+mon,pb=PS.batch[kb];let du=it.du,pgs=it.pgs;
  if(pb&&pb.pgs&&it.pgs){/* צירוף לתלוש שנשמר באותה העלאה */v={gross:v.gross!==null?v.gross:pb.v.gross,net:v.net!==null?v.net:pb.v.net,ec:pb.v.ec.filter(e=>!v.ec.some(x=>x.k===e.k)).concat(v.ec)}}
  const er=checkVals(v);if(er.length)return toast(er[0]);
  if(it.cf&&!(f.elements.cf&&f.elements.cf.checked))return toast('העובד לא זוהה בתלוש – סמנו שבדקתם שזה התלוש של העובד שנבחר');
  const old=AR('psl').filter(p=>p&&p.sub===s.id&&p.mon===mon);
  if(old.some(pslLock))return toast('לתלוש הקיים של '+s.name+' ל'+mfmt(mon)+' יש עלויות מעביד ששויכו לחיוב אשראי או בנק. בטלו קודם את השיוך.');
  f.dataset.busy='1';
  try{if(pb&&pb.pgs&&it.pgs){pgs=pb.pgs.concat(it.pgs);const u8=await mkScanPdf(pgs);if(u8.length>MAXB){delete f.dataset.busy;return toast('הצירוף גדול מ-3MB – דלגו על העמוד')}du=pdfDU(u8)}
    const fid='ps'+uid();await fput(fid,du);
    const gone=old.map(pslDrop),id=uid(),p={id,sub:s.id,mon,f:fid,name:fname({sub:s.id,mon}),gross:v.gross,net:v.net,ec:v.ec.map(e=>({k:e.k,n:e.n,a:e.a})),src:it.src,ok:1,at:new Date().toISOString()};
    AR('psl').push(p);
    v.ec.forEach(e=>S.tx.push({id:uid(),t:'exp',cat:s.cat,sub:s.id,date:lastDay(mon),amt:e.a,plan:mon,pays:[],ec:1,eck:e.k,psl:id,note:'עלות מעביד: '+e.n}));
    save();delF(gone);if(!pb)PS.saved++;PS.batch[kb]={pid:id,pgs,v};PS.i++;showPiece()}
  catch(e){delete f.dataset.busy;toast('שמירת התלוש נכשלה')}};

/* ---- כרטיס עובד: שורה + מסך תלושים ---- */
const pslOf=id=>AR('psl').filter(p=>p&&p.sub===id).sort((a,b)=>String(b.mon).localeCompare(String(a.mon))||String(b.at||'').localeCompare(String(a.at||'')));
window.pslRowH=s=>{try{if(!on()||!s||!empOf(s.id)||!s.pay)return'';const L=pslOf(s.id);if(!s.pay.slip&&!L.length)return'';
  return `<button class="li" data-a="pslOpen" data-id="${esc(s.id)}"><div class="m"><b>תלושים</b><small>${L.length?L.length+' תלושים · אחרון '+esc(mfmt(L[0].mon)):'עוד לא הועלה תלוש'}</small></div>${typeof ico==='function'?ico('chev','chev'):''}</button>`}catch(e){return''}};
/* במסך "שכר חודשי": מצב התלוש לחודש + מעבר למסך התלושים */
window.pslMonH=(s,m)=>{try{if(!on()||!s||!s.pay||!s.pay.slip)return'';const p=pslOf(s.id).find(x=>x.mon===m);
  return `<button type="button" class="li" data-a="pslOpen" data-id="${esc(s.id)}"><div class="m"><b>תלוש ל${esc(mfmt(m))}</b><small>${p?'נטו '+ils(p.net)+(p.gross?' · ברוטו '+ils(p.gross):''):'לא הועלה – העלאה וצפייה'}</small></div>${typeof ico==='function'?ico('chev','chev'):''}</button>`}catch(e){return''}};
ACT.pslOpen=el=>{if(!on())return;const s=empOf(el.dataset.id);if(!s)return;PS.sub=s.id;PS.sel=new Set();go('pslList',s.id)};
V.pslList=id=>{const T='תלושים';if(!on())return{t:T,h:'<div class="empty">המסך זמין למנהל בלבד</div>'};const s=empOf(id);if(!s)return{t:T,h:'<div class="empty">הכרטיס לא נמצא</div>'};
  if(PS.sub!==s.id){PS.sub=s.id;PS.sel=new Set()}const L=pslOf(s.id);PS.sel=new Set([...PS.sel].filter(x=>L.some(p=>p.id===x)));
  let h=`<div class="card"><label class="btn w" style="min-height:48px;display:flex;align-items:center;justify-content:center;cursor:pointer">העלאת תלוש (PDF או תמונה)<input type="file" hidden accept="application/pdf,image/jpeg,image/png" data-c="pslFile" data-m="one" data-sub="${esc(s.id)}"></label>
<label class="btn g w" style="min-height:48px;display:flex;align-items:center;justify-content:center;cursor:pointer;margin-top:8px">קובץ מרוכז של כל העובדים (PDF)<input type="file" hidden accept="application/pdf" data-c="pslFile" data-m="all"></label>
<p class="note" style="margin:8px 0 0">בקובץ מרוכז כל עמוד משויך לעובד לפי השם או ת״ז, ונשמר לו בנפרד. עמוד שלא זוהה – בוחרים עובד או מדלגים.</p></div>`;
  h+=`<div class="sec"><h3>תלושים לפי חודש</h3></div>`;
  if(!L.length)h+='<p class="note">עוד לא הועלה תלוש.</p>';
  else{h+=L.map(p=>{const ec=(p.ec||[]).reduce((a,e)=>a+(+e.a||0),0),lk=pslLock(p);
    return `<div class="card" data-psl="${esc(p.id)}"><div class="row" style="justify-content:space-between;flex-wrap:nowrap;gap:8px"><label class="cb" style="margin:0;min-width:0"><input type="checkbox" data-c="pslSel" value="${esc(p.id)}"${PS.sel.has(p.id)?' checked':''}> <b>${esc(mfmt(p.mon))}</b></label><b style="white-space:nowrap">נטו ${ag(p.net)}</b></div>
<div class="note" style="margin:4px 0 8px">ברוטו ${ag(p.gross)}${ec?' · עלויות מעביד '+ils(ec):''}${lk?' · <span class="tag t2">משויך לחיוב</span>':''}</div>
<div class="row" style="gap:6px"><button type="button" class="btn g grow" data-a="pslView" data-id="${esc(p.id)}">צפייה</button><button type="button" class="btn g grow" data-a="pslSh1" data-id="${esc(p.id)}">שיתוף</button><button type="button" class="btn r grow" data-a="pslDel" data-id="${esc(p.id)}">מחיקה</button></div></div>`}).join('');
    h+=`<div class="sec"><h3>שיתוף</h3></div><div class="card"><button type="button" class="btn w" ${big} data-a="pslShSel"${PS.sel.size?'':' disabled'}>שיתוף החודשים שנבחרו (<span data-psln>${PS.sel.size}</span>)</button><button type="button" class="btn g w" style="min-height:48px;margin-top:8px" data-a="pslShAll">שיתוף כל התלושים (${L.length})</button><p class="note" style="margin:8px 0 0">הקבצים עצמם נשלחים בשיתוף אחד${L.length>PART?' (מעל '+PART+' – בחלקים)':''}.</p></div>`}
  h+=`<div class="sec"><h3>זיהוי בקובץ מרוכז</h3></div><form class="card" data-f="pslTzF" novalidate><label class="f"><span>ת״ז העובד (לא חובה)</span><input name="tz" value="${esc(String(s.pay&&s.pay.tz||''))}" inputmode="numeric" autocomplete="off" maxlength="9"></label><button type="submit" class="btn g w" style="min-height:48px">שמירת ת״ז</button><p class="note" style="margin:8px 0 0">בלי ת״ז העמוד מזוהה לפי השם המלא שבכרטיס.</p></form>`;
  h+='<p class="note">התלושים גלויים למנהל בלבד. העובד מקבל רק מה שמשתפים איתו.</p>';
  return{t:T,s:s.name,h}};
CHG.pslSel=el=>{if(el.checked)PS.sel.add(el.value);else PS.sel.delete(el.value);const b=document.querySelector('[data-a=pslShSel]');if(b){b.disabled=!PS.sel.size;const n=b.querySelector('[data-psln]');if(n)n.textContent=String(PS.sel.size)}};
const pslById=id=>AR('psl').find(p=>p&&p.id===id);
FRM.pslTzF=f=>{if(!on())return;const s=empOf(PS.sub);if(!s||!s.pay)return toast('לעובד עוד אין הגדרות שכר');const z=s_((f.elements.tz||{}).value||'').replace(/[\s-]/g,'');
  if(z&&!/^\d{5,9}$/.test(z))return toast('ת״ז: 5–9 ספרות');s.pay=Object.assign({},s.pay,{tz:z});save();toast(z?'הת״ז נשמרה':'הת״ז נמחקה');rerender()};
ACT.pslView=el=>{if(!on())return;const p=pslById(el.dataset.id);if(p&&typeof viewImg==='function')viewImg(p.f,fname(p))};
ACT.pslDel=el=>{if(!on())return;const p=pslById(el.dataset.id);if(!p)return;if(pslLock(p))return toast('לתלוש יש עלויות מעביד ששויכו לחיוב אשראי או בנק. בטלו קודם את השיוך.');
  ask('למחוק את התלוש של '+mfmt(p.mon)+'? גם עלויות המעביד שלו יימחקו.',()=>{const q=pslById(p.id);if(!q||pslLock(q)){closeDlg();return toast('המחיקה בוטלה')}const f=pslDrop(q);PS.sel.delete(q.id);save();delF([f]);closeDlg();toast('התלוש נמחק');rerender()},'מחיקה')};

/* ---- שיתוף: הקבצים עצמם, עד 24 בשיתוף אחד ---- */
async function shareL(list){if(!on())return;const files=[];
  for(const p of list){let du=null;try{du=await fget(p.f)}catch(e){}if(typeof du!=='string')continue;const pdf=/^data:application\/pdf;base64,/.test(du),im=/^data:image\/(jpeg|png);base64,/.exec(du);if(!pdf&&!im)continue;
    files.push({name:fname(p)+(pdf?'.pdf':im[1]==='png'?'.png':'.jpg'),mime:pdf?'application/pdf':'image/'+im[1],data:new Uint8Array(await du2b(du).arrayBuffer())})}
  if(!files.length)return toast('הקבצים לא נמצאו במכשיר');const miss=list.length-files.length;
  const parts=[];for(let i=0;i<files.length;i+=PART)parts.push(files.slice(i,i+PART));PS.sh={parts,i:0,n:files.length,miss};
  if(parts.length===1)return shPart();shDraw()}
function shDraw(){const P=PS.sh;if(!P)return;dlg(`<h3>מוכן לשיתוף</h3><p>${P.n} תלושים ב-${P.parts.length} חלקים.${P.miss?' '+P.miss+' לא נמצאו במכשיר.':''}</p><button class="btn w" ${big} data-a="pslShPart">שיתוף חלק ${P.i+1} מתוך ${P.parts.length} (${P.parts[P.i].length} קבצים)</button><button class="btn g w" style="margin-top:8px" data-a="closeDlg">סגירה</button>`)}
async function shPart(){const P=PS.sh;if(!P)return;const part=P.parts[P.i];
  try{const nat=typeof isNat==='function'&&isNat();
    if(nat){const C=window.Capacitor,uris=[];for(const o of part){const r=await C.Plugins.Filesystem.writeFile({path:'psl_'+o.name,data:u8b64(o.data),directory:'CACHE'});uris.push(r.uri)}
      await C.Plugins.Share.share({title:'תלושים',files:uris,dialogTitle:'שיתוף תלושים'})}
    else{const fs=part.map(o=>new File([o.data],o.name,{type:o.mime}));
      if(navigator.canShare&&navigator.share&&navigator.canShare({files:fs}))await navigator.share({files:fs,title:'תלושים'});
      else for(const f of fs){const a=document.createElement('a');a.href=URL.createObjectURL(f);a.download=f.name;document.body.append(a);a.click();setTimeout(()=>{a.remove();URL.revokeObjectURL(a.href)},1500)}}
    P.i++;if(P.i<P.parts.length)shDraw();else{PS.sh=null;if(P.parts.length>1)closeDlg();toast(P.n===1?'התלוש מוכן לשיתוף':P.n+' תלושים מוכנים לשיתוף'+(P.miss?' · '+P.miss+' לא נמצאו':''))}}
  catch(e){if(/cancel|abort/i.test(String(e&&(e.name||e.message||e))))return;toast('השיתוף נכשל')}}
ACT.pslShPart=()=>shPart();
ACT.pslSh1=el=>{const p=pslById(el.dataset.id);if(p)shareL([p])};
ACT.pslShSel=()=>{const L=pslOf(PS.sub).filter(p=>PS.sel.has(p.id));if(!L.length)return toast('בחרו חודשים');shareL(L)};
ACT.pslShAll=()=>{const L=pslOf(PS.sub);if(L.length)shareL(L)};

/* ---- חיוב אשראי ← עלויות מעביד (אותו מנגנון של "תשלום עבור חשבונית": החיוב מסומן x ולא נספר פעמיים) ---- */
const KN=Object.fromEntries(EC.map(([k,n])=>[k,n]));
const ecFree=()=>S.tx.filter(t=>t&&t.ec&&!t.x&&monV(t.plan)&&!ecLock(t));
function ecGroups(){const F=ecFree(),M=[...new Set(F.map(t=>t.plan))].sort().reverse().slice(0,6),o=[];
  M.forEach(m=>{const A=F.filter(t=>t.plan===m),sum=L=>L.reduce((a,t)=>a+(+t.amt||0),0),ne=L=>new Set(L.map(t=>t.sub)).size;
    o.push({v:'ec:'+m+':*',l:'כל עלויות המעביד · '+mfmt(m)+' · '+ils(sum(A))+' ('+ne(A)+' עובדים)'});
    [...new Set(A.map(t=>t.eck))].forEach(k=>{const B=A.filter(t=>t.eck===k);o.push({v:'ec:'+m+':'+k,l:(KN[k]||'עלות מעביד')+' · '+mfmt(m)+' · '+ils(sum(B))+' ('+ne(B)+' עובדים)'})})});return o}
function ecSel(v){const m=/^ec:(\d{4}-\d{2}):([\w*]+)$/.exec(v||'');if(!m)return[];return ecFree().filter(t=>t.plan===m[1]&&(m[2]==='*'||t.eck===m[2]))}
if(typeof detHtml==='function'){const o=detHtml;detHtml=function(c,t){let h=o.apply(this,arguments);
  try{if(c&&c.beh==='cc'&&!t&&on()){const G=ecGroups(),A='</select><div class="hd">אם תבחר חשבונית';if(G.length&&h.includes(A))h=h.replace(A,'<optgroup label="עלויות מעביד מתלושים">'+G.map(g=>`<option value="${esc(g.v)}">${esc(g.l)}</option>`).join('')+'</optgroup>'+A).replace(A,A.replace('אם תבחר חשבונית','עלויות מעביד מתלוש: אם תבחר אותן, החלק שמשויך לא ייספר פעמיים (עלויות המעביד כבר נספרות), ומה שמעבר להן נרשם כהוצאה רגילה. אם תבחר חשבונית'))}}catch(e){}return h}}
if(typeof readTx==='function'){const o=readTx;readTx=function(f,c,sub,t0){
  if(!(f&&typeof f.link==='string'&&f.link.startsWith('ec:')&&c&&c.beh==='cc'&&!t0))return o.apply(this,arguments);
  const L=ecSel(f.link),r=o.call(this,Object.assign({},f,{link:''}),c,sub,t0);if(!r||r.errs)return r;
  if(!L.length)return{errs:['לא נמצאו עלויות מעביד פתוחות לשיוך']};const sm=r2(L.reduce((a,t)=>a+(+t.amt||0),0));
  /* חיוב קטן מהעלויות שנבחרו – לא נועלים את כולן (היתרה ששולמה בדרך אחרת הייתה נספרת פעמיים) */
  if(r.t.amt<sm-0.004)return{errs:['החיוב ('+ils(r.t.amt)+') קטן מסכום העלויות שנבחרו ('+ils(sm)+') – בחר רכיבים לפי הסכום']};
  r.t.x=1;r.t.ecl=L.map(t=>t.id);PEND=null;
  /* חיוב גדול מהעלויות (ניכויי העובד שמועברים לרשויות): פיצול – החלק המשויך (x, ecl) לא נספר, והיתרה נרשמת כחיוב רגיל באותה קטגוריה ונספרת.
     שתי הרשומות מקושרות ב-ecg: מחיקת אחת מוחקת את שתיהן. היתרה נוספת רק כשהחיוב באמת נשמר (FRM.addsave), כי readTx רץ שוב אחרי שאלת כפילות */
  if(r.t.amt>sm+0.004){const g=uid(),tot=r.t.amt,rest=Object.assign({},r.t,{id:uid(),amt:r2(tot-sm),ecg:g,ecr:1,pays:[],note:(r.t.note?r.t.note+' · ':'')+'יתרת חיוב אשראי מעבר לעלויות המעביד'});
    delete rest.x;delete rest.ecl;r.t.amt=sm;r.t.ecg=g;PEND={id:r.t.id,rest,tot}}
  return r}}
/* שמירת היתרה אחרי שהחיוב המשויך נשמר */
let PEND=null;
if(FRM&&typeof FRM.addsave==='function'){const o=FRM.addsave;FRM.addsave=function(){const r=o.apply(this,arguments);
  try{const P=PEND;if(P&&S.tx.some(t=>t&&t.id===P.id)&&!S.tx.some(t=>t&&t.id===P.rest.id)){PEND=null;S.tx.push(P.rest);save();rerender();
    toast('נשמר חיוב '+ils(P.tot)+': '+ils(P.tot-P.rest.amt)+' משויך לעלויות מעביד, '+ils(P.rest.amt)+' נספר כהוצאה')}}catch(e){}return r}}
/* רשומת עלות מעביד (ec) נוצרת ונמחקת רק עם התלוש שלה – לא נמחקת ולא נערכת כתנועה רגילה */
const ecMsg='זו עלות מעביד מתלוש שכר. כדי למחוק או לתקן אותה – מוחקים או מחליפים את התלוש במסך "תלושים" שבכרטיס העובד.';
const isEc=el=>{try{const t=S.tx.find(x=>x&&x.id===(el&&el.dataset&&el.dataset.id));return !!(t&&t.ec)}catch(e){return false}};
if(typeof ACT.txEdit==='function'){const o=ACT.txEdit;ACT.txEdit=function(el){if(isEc(el)){try{closeDlg()}catch(e){}return toast(ecMsg)}return o.apply(this,arguments)}}
/* כרטיס עובד עם תלושים / שעות / בונוסים – לא נמחק (אחרת נשארים יתומים, והקובץ ממשיך להיכנס לגיבוי). index.html (subMenu) מסתיר את כפתור המחיקה לפי זה */
window.pslSubN=id=>{try{return ['psl','wh','bon'].reduce((a,k)=>a+(Array.isArray(S[k])?S[k].filter(x=>x&&x.sub===id).length:0),0)}catch(e){return 0}};
if(typeof ACT.subDel==='function'){const o=ACT.subDel;ACT.subDel=function(el){if(window.pslSubN(el&&el.dataset&&el.dataset.id))return toast('לכרטיס יש תלושים, שעות או בונוסים – אי אפשר למחוק אותו. אפשר להסתיר.');return o.apply(this,arguments)}}
/* מחיקת חיוב מפוצל (החלק המשויך או היתרה) ← מוחקת גם את בן הזוג, כך שהשיוך משתחרר ולא נשארת יתרה יתומה */
if(typeof ACT.txDel==='function'){const o=ACT.txDel;ACT.txDel=function(el){if(isEc(el)){try{closeDlg()}catch(e){}return toast(ecMsg)}const t=S.tx.find(x=>x&&x.id===(el&&el.dataset&&el.dataset.id)),r=o.apply(this,arguments);
  try{const g=t&&t.ecg,f=typeof PENDING!=='undefined'?PENDING:null;if(g&&typeof f==='function')PENDING=function(){f();let n=0;for(let i=S.tx.length-1;i>=0;i--){if(S.tx[i]&&S.tx[i].ecg===g){S.tx.splice(i,1);n++}}if(n){save();rerender()}}}catch(e){}return r}}
/* פרטיות: רשומות עלות מעביד לא נכנסות לרשימה לפי עובד במראה לעובדים (sal_). בסכומים המצטברים (rps_, bal_) הן נשארות,
   כדי שעובד עם הרשאת דוחות / מצב העסק יראה את אותן הוצאות כמו המנהל (סכום בלבד, בלי שם ובלי פירוט תלוש) */
if(typeof wvWant==='function'){const o=wvWant;wvWant=function(){const T=S.tx;if(!Array.isArray(T)||!T.some(t=>t&&t.ec))return o.apply(this,arguments);
  const R=o.apply(this,arguments);let F;S.tx=T.filter(t=>!(t&&t.ec));try{F=o.apply(this,arguments)}finally{S.tx=T}
  Object.keys(R).forEach(k=>{if(/^sal_/.test(k))R[k]=F[k]});return R}}
})(typeof self!=='undefined'?self:this);
