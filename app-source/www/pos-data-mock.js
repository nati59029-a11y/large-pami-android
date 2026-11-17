/* קופה (POS) – שכבת נתונים מדומה. כל הנתונים של מסך הקופה עוברים רק דרך window.PosData.
   סשן התשתית (גל 2) יחליף את הקובץ הזה במימוש אמיתי עם אותו ממשק בדיוק:
     getSession()            → {cashier:{id,name}, shift:{id,no,openedAt}}
     getProducts()           → [{id,name,barcode,sku,price}]   (price באגורות, כולל מע"מ)
     search(q,limit)         → [מוצר]   (ברקוד מדויק קודם, אחר כך כל המילים בשם/ברקוד/מק"ט)
     byBarcode(code)         → מוצר או null
     saveSale(sale)          → {id,no,at}   sale={lines:[{pid,name,barcode,price,qty,total}],total,vat,payments:[{m,a}],change}
     getSales({day})         → [מכירה שמורה]   (החדשה קודם)
     getSale(no)             → מכירה שמורה או null
     saveReturn(ret)         → {id,no,at}   ret={saleNo,lines:[{pid,qty,price,total}],total,vat,method}
     dayStats()              → {sales,total,returns,returnsTotal}
   כל הפונקציות מחזירות Promise. כל הסכומים באגורות (מספר שלם). הנתונים המדומים נשמרים רק בזיכרון, ובמכשיר תחת lp-pos-mock-*. */
(function(root){
'use strict';
const LSK='lp-pos-mock-v1';
/* מחולל אקראי קבוע (אותם 6,000 מוצרים בכל פתיחה) */
function rng(seed){let s=seed>>>0;return()=>{s=(s+0x6D2B79F5)>>>0;let t=s;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296}}
function ean13(d12){let s=0;for(let i=0;i<12;i++)s+=(+d12[i])*(i%2?3:1);return d12+((10-s%10)%10)}
const KIND=['חלב','גבינה לבנה','גבינה צהובה','יוגורט','לחם','לחמניות','פיתות','אורז','פסטה','קמח','סוכר','מלח','שמן','טחינה','חומוס','קפה','תה','קקאו','שוקולד','ופלים','עוגיות','במבה','ביסלי','קרקרים','דגני בוקר','מיץ','מים מינרליים','סודה','רסק עגבניות','תירס','טונה','זיתים','מלפפון חמוץ','חומץ','דבש','ריבה','שקדים','צימוקים','אגוזים','קטשופ','מיונז','חרדל','נייר טואלט','מגבות נייר','סבון כלים','אבקת כביסה','מרכך כביסה','שקיות אשפה','נרות שבת','מגבונים'];
const BRAND=['השדה','הגליל','עמק','הכרמל','הבית','טבעי','הזהב','מעדן','הר','גן','שפע','נחל','הדר','אור','כרם'];
const VAR=['רגיל','מהדרין','דל שומן','מלא','קלאסי','ללא סוכר','משפחתי','מיני','פרימיום','מוקטן'];
const SIZE=['100 גרם','200 גרם','250 גרם','500 גרם','1 ק"ג','1 ליטר','1.5 ליטר','2 ליטר','מארז 4','מארז 6','מארז 12','300 מ"ל'];
function build(n){const r=rng(5787),L=[],seen=new Set();
 for(let i=0;L.length<n;i++){const k=KIND[Math.floor(r()*KIND.length)],b=BRAND[Math.floor(r()*BRAND.length)],v=VAR[Math.floor(r()*VAR.length)],z=SIZE[Math.floor(r()*SIZE.length)];
  const name=k+' '+b+' '+v+' '+z;if(seen.has(name))continue;seen.add(name);
  const bc=ean13('7291'+String(L.length+1).padStart(8,'0')),price=(Math.floor(r()*480)+19)*10;
  L.push({id:'p'+(L.length+1),name,barcode:bc,sku:String(10000+L.length),price})}
 /* מוצרים קבועים לבדיקות */
 L.unshift({id:'p0',name:'חלב תנובה 3% 1 ליטר',barcode:'7290000000015',sku:'1',price:690},{id:'p00',name:'לחם אחיד פרוס',barcode:'7290000000022',sku:'2',price:850});
 return L}
const NIQ=/[֑-ׇ]/g,FIN={'ך':'כ','ם':'מ','ן':'נ','ף':'פ','ץ':'צ'};
const norm=s=>String(s||'').replace(NIQ,'').toLowerCase().replace(/[ךםןףץ]/g,c=>FIN[c]).replace(/["'״׳.,\-_/]+/g,' ').replace(/\s+/g,' ').trim();
let P=null,KEY=null,BC=null;
function ensure(){if(P)return;P=build(6000);KEY=P.map(p=>norm(p.name+' '+p.barcode+' '+p.sku));BC=new Map();P.forEach(p=>BC.set(p.barcode,p))}
function searchSync(q,limit){ensure();limit=limit||200;const s=String(q||'').trim();if(!s)return P.slice(0,limit);
 const ex=BC.get(s.replace(/\s+/g,''));const out=ex?[ex]:[];const T=norm(s).split(' ').filter(Boolean);if(!T.length)return out;
 for(let i=0;i<P.length&&out.length<limit;i++){const k=KEY[i];let ok=true;for(let j=0;j<T.length;j++){if(k.indexOf(T[j])<0){ok=false;break}}if(ok&&P[i]!==ex)out.push(P[i])}
 return out}
/* מכירות והחזרות מדומות */
const st={sales:[],rets:[],seq:0,rseq:0,day:''};
const dayOf=t=>{const d=new Date(t);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
function load(){try{const o=JSON.parse(root.localStorage&&root.localStorage.getItem(LSK)||'null');if(o&&Array.isArray(o.sales)){Object.assign(st,o)}}catch(e){}}
function persist(){try{root.localStorage&&root.localStorage.setItem(LSK,JSON.stringify(st))}catch(e){}}
load();
const clone=o=>JSON.parse(JSON.stringify(o));
const SESSION={cashier:{id:'c1',name:'קופאי ראשי'},shift:{id:'sh1',no:1,openedAt:Date.now()}};
const API={
 isMock:true,
 normalize:norm,
 getSession:async()=>clone(SESSION),
 getProducts:async()=>{ensure();return P},
 search:async(q,limit)=>searchSync(q,limit),
 searchSync,
 byBarcode:async code=>{ensure();return BC.get(String(code||'').trim())||null},
 saveSale:async sale=>{const at=Date.now(),no=++st.seq,id='s'+at+'_'+no;st.sales.push(Object.assign(clone(sale),{id,no,at,day:dayOf(at),cashier:SESSION.cashier.id,shift:SESSION.shift.id}));persist();return{id,no,at}},
 getSales:async o=>{const d=o&&o.day||dayOf(Date.now());return clone(st.sales.filter(s=>s.day===d).reverse())},
 getSale:async no=>{const s=st.sales.find(x=>x.no===+no);return s?clone(s):null},
 returnedQty:async saleNo=>{const m={};st.rets.filter(r=>r.saleNo===+saleNo).forEach(r=>r.lines.forEach(l=>{m[l.pid]=(m[l.pid]||0)+l.qty}));return m},
 saveReturn:async ret=>{const at=Date.now(),no=++st.rseq,id='r'+at+'_'+no;st.rets.push(Object.assign(clone(ret),{id,no,at,day:dayOf(at),cashier:SESSION.cashier.id,shift:SESSION.shift.id}));persist();return{id,no,at}},
 dayStats:async()=>{const d=dayOf(Date.now()),S=st.sales.filter(s=>s.day===d),R=st.rets.filter(r=>r.day===d);return{sales:S.length,total:S.reduce((a,s)=>a+s.total,0),returns:R.length,returnsTotal:R.reduce((a,r)=>a+r.total,0)}},
 _reset:()=>{st.sales=[];st.rets=[];st.seq=0;st.rseq=0;persist()}
};
if(!root.PosData)root.PosData=API;
if(typeof module!=='undefined'&&module.exports)module.exports=API;
})(typeof window!=='undefined'?window:globalThis);
