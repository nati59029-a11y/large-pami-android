/* POS:M1 – קופה, שכבת נתונים מדומה. כל הנתונים של מסך הקופה עוברים רק דרך window.PosData.
   ש3 (pos-data.js) מחליף את הקובץ הזה באותו ממשק בדיוק. כל הסכומים באגורות (מספר שלם). כל הפונקציות מחזירות Promise.
   מכירה (צורת possale, אפיון ב 4): {reqId, lines:[{pid,name,unit,qty,disc,pdisc,promo,mdisc,tot,sd,fin,stk}], sub, sdisc, manDisc, gross, net, vat,
     pays:[{m,amt,ref?,chk?,due?,last4?,appr?,tx?,inst?,src?,code?}], chg, debt, cust, note}
   הממשק:
     getSession()                 → {cashier:{id,no,name,role}, shift:{id,no,openedAt}, dev}
     getCategories()              → [{id,name}]
     byCat(cat,limit)             → [מוצר]
     search(q,limit)              → [מוצר]  (ברקוד מדויק קודם; כל המילים; אם חסר – סלחני לשגיאת כתיב אחת)
     byBarcode(code)              → מוצר | {variants:[...]} למוצר אב | null
     getProduct(pid)              → מוצר | null
     quickAdd({barcode,name,price}) → מוצר חדש (fromPos)
     searchCust(q)                → [לקוח]   לקוח={id,name,phone,biz,taxId,limit,bal}
     giftBalance(m,code)          → {ok,bal}
     park(cart) / parked() / unpark(id) / flagParked()
     log(act,data)                → poslog
     saveSale(sale)               → {id,no,doc,at}   (בדיקת כלל הסגירה כמו בשרת; דחייה = Error עם reason)
     getSale(no) / findSales({no,phone,day})
     saveReturn(ret)              → {id,no,doc,at}
     dayStats() / myStats(cashierId)
   מוצר: {id,name,barcode,sku,price,stock,cat,min?,gen?,svc?,fromPos?,parent?} */
(function(root){
'use strict';
const LSK='lp-pos-mock-v2';
function rng(seed){let s=seed>>>0;return()=>{s=(s+0x6D2B79F5)>>>0;let t=s;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296}}
function ean13(d12){let s=0;for(let i=0;i<12;i++)s+=(+d12[i])*(i%2?3:1);return d12+((10-s%10)%10)}
const CATS=[{id:'milk',name:'חלב וגבינות'},{id:'bake',name:'מאפים'},{id:'dry',name:'יבשים'},{id:'drink',name:'משקאות'},{id:'snack',name:'חטיפים'},{id:'clean',name:'ניקיון'},{id:'disp',name:'חד-פעמי'},{id:'svc',name:'שירותים'}];
const KIND=[['חלב','milk'],['גבינה לבנה','milk'],['גבינה צהובה','milk'],['יוגורט','milk'],['לחם','bake'],['לחמניות','bake'],['פיתות','bake'],['עוגת שמרים','bake'],['עוגיות','bake'],['אורז','dry'],['פסטה','dry'],['קמח','dry'],['סוכר','dry'],['שמן','dry'],['טחינה','dry'],['קפה','drink'],['תה','drink'],['מיץ','drink'],['מים מינרליים','drink'],['סודה','drink'],['שוקולד','snack'],['ופלים','snack'],['במבה','snack'],['ביסלי','snack'],['קרקרים','snack'],['סבון כלים','clean'],['אבקת כביסה','clean'],['מרכך כביסה','clean'],['שקיות אשפה','clean'],['מגבונים','clean'],['צלחות','disp'],['כוסות','disp'],['סכו"ם','disp'],['מפיות','disp'],['תבניות אלומיניום','disp'],['נייר כסף','disp'],['ניילון נצמד','disp']];
const BRAND=['השדה','הגליל','עמק','הכרמל','הבית','טבעי','הזהב','מעדן','הר','גן','שפע','נחל','הדר','אור','כרם'];
const VAR=['רגיל','מהדרין','דל שומן','מלא','קלאסי','ללא סוכר','משפחתי','מיני','פרימיום','מוקטן'];
const SIZE=['100 גרם','200 גרם','250 גרם','500 גרם','1 ק"ג','1 ליטר','1.5 ליטר','2 ליטר','מארז 4','מארז 6','מארז 12','מארז 50','300 מ"ל'];
function build(n){const r=rng(5787),L=[],seen=new Set();
 for(let i=0;L.length<n;i++){const k=KIND[Math.floor(r()*KIND.length)],b=BRAND[Math.floor(r()*BRAND.length)],v=VAR[Math.floor(r()*VAR.length)],z=SIZE[Math.floor(r()*SIZE.length)];
  const name=k[0]+' '+b+' '+v+' '+z;if(seen.has(name))continue;seen.add(name);const price=(Math.floor(r()*480)+19)*10;
  L.push({id:'p'+(L.length+1),name,barcode:ean13('7291'+String(L.length+1).padStart(8,'0')),sku:String(10000+L.length),price,stock:Math.floor(r()*60),cat:k[1],min:Math.round(price*0.7)})}
 /* מוצרים קבועים לבדיקות */
 L.unshift(
  {id:'p0',name:'חלב תנובה 3% 1 ליטר',barcode:'7290000000015',sku:'1',price:690,stock:50,cat:'milk',min:600},
  {id:'p00',name:'לחם אחיד פרוס',barcode:'7290000000022',sku:'2',price:850,stock:30,cat:'bake',min:700},
  {id:'p01',name:'עוגת שמרים שוקולד',barcode:'7290000000039',sku:'3',price:2990,stock:0,cat:'bake',min:2500},
  {id:'p02',name:'סינר מטבח',barcode:'7290000000046',sku:'4',price:3990,stock:0,cat:'disp',variants:['p02s','p02m','p02l']},
  {id:'p02s',name:'סינר מטבח – קטן',barcode:'',sku:'4-S',price:3990,stock:5,cat:'disp',parent:'p02'},
  {id:'p02m',name:'סינר מטבח – בינוני',barcode:'',sku:'4-M',price:3990,stock:5,cat:'disp',parent:'p02'},
  {id:'p02l',name:'סינר מטבח – גדול',barcode:'',sku:'4-L',price:3990,stock:5,cat:'disp',parent:'p02'},
  {id:'gen',name:'פריט כללי',barcode:'',sku:'0',price:0,stock:0,cat:'svc',gen:true},
  {id:'svcWrap',name:'אריזת מתנה',barcode:'',sku:'901',price:500,stock:0,cat:'svc',svc:true},
  {id:'svcDlv',name:'משלוח',barcode:'',sku:'902',price:2500,stock:0,cat:'svc',svc:true});
 return L}
const NIQ=/[֑-ׇ]/g,FIN={'ך':'כ','ם':'מ','ן':'נ','ף':'פ','ץ':'צ'};
const norm=s=>String(s||'').replace(NIQ,'').toLowerCase().replace(/[ךםןףץ]/g,c=>FIN[c]).replace(/["'״׳.,\-_/]+/g,' ').replace(/\s+/g,' ').trim();
/* מרחק עריכה ≤1 (החלפה, הוספה או מחיקה של תו אחד) */
function near1(a,b){if(a===b)return true;const la=a.length,lb=b.length;if(Math.abs(la-lb)>1)return false;let i=0,j=0,e=0;
 while(i<la&&j<lb){if(a[i]===b[j]){i++;j++;continue}if(++e>1)return false;if(la>lb)i++;else if(lb>la)j++;else{i++;j++}}return e+(la-i)+(lb-j)<=1}
let P=null,KEY=null,WORDS=null,BC=null,BYID=null;
function ensure(){if(P)return;P=build(6000);(st.added||[]).forEach(p=>P.push(p));idx()}
function idx(){KEY=P.map(p=>norm(p.name+' '+p.barcode+' '+p.sku));WORDS=KEY.map(k=>k.split(' '));BC=new Map();BYID=new Map();P.forEach(p=>{if(p.barcode)BC.set(p.barcode,p);BYID.set(p.id,p)})}
function searchSync(q,limit){ensure();limit=limit||10;const s=String(q||'').trim();if(!s)return[];
 const ex=BC.get(s.replace(/\s+/g,''));const out=ex?[ex]:[];const T=norm(s).split(' ').filter(Boolean);if(!T.length)return out;
 for(let i=0;i<P.length&&out.length<limit;i++){if(P[i].variants)continue;const k=KEY[i];let ok=true;for(let j=0;j<T.length;j++){if(k.indexOf(T[j])<0){ok=false;break}}if(ok&&P[i]!==ex)out.push(P[i])}
 if(out.length<limit&&T.some(t=>t.length>=3)){const seen=new Set(out);
  for(let i=0;i<P.length&&out.length<limit;i++){if(seen.has(P[i])||P[i].variants)continue;const W=WORDS[i];let ok=true;
   for(const t of T){if(KEY[i].indexOf(t)>=0)continue;if(t.length<3||!W.some(w=>near1(w,t)||(w.length>t.length&&near1(w.slice(0,t.length),t)))){ok=false;break}}
   if(ok)out.push(P[i])}}
 return out}
/* מצב מדומה: מכירות, החזרות, עגלות מושהות, יומן, לקוחות וכרטיסים */
const st={sales:[],rets:[],parks:[],log:[],seq:{},rseq:{},stock:{},debt:{},gifts:{},added:[]};
const dayOf=t=>{const d=new Date(t);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
function load(){try{const o=JSON.parse(root.localStorage&&root.localStorage.getItem(LSK)||'null');if(o&&Array.isArray(o.sales))Object.assign(st,o)}catch(e){}}
function persist(){try{root.localStorage&&root.localStorage.setItem(LSK,JSON.stringify(st))}catch(e){}}
load();
const clone=o=>JSON.parse(JSON.stringify(o));
const fail=(reason,msg)=>{const e=new Error(msg||reason);e.reason=reason;return e};
const role=()=>{try{const r=root.localStorage&&root.localStorage.getItem('lp-pos-mock-role');return['cashier','lead','mgr'].includes(r)?r:'cashier'}catch(e){return'cashier'}};
const SESSION=()=>({cashier:{id:'c7',no:'7',name:'קופאי 7',role:role()},shift:{id:'sh1',no:1,openedAt:new Date(new Date().setHours(8,0,0,0)).getTime()},dev:'K1'});
const CUST=[{id:'cu1',name:'משה כהן',phone:'0501234567',biz:false,limit:50000,bal:0},{id:'cu2',name:'אפייה בע"מ',phone:'0527654321',biz:true,taxId:'512345678',addr:'רחוב התעשייה 5',contact:'יוסי',limit:0,bal:0},{id:'cu3',name:'דוד לוי',phone:'0549876543',biz:false,limit:0,bal:0}];
for(let i=4;i<=200;i++)CUST.push({id:'cu'+i,name:'לקוח '+i,phone:'05'+String(10000000+i*7919).slice(0,8),biz:false,limit:i%5?0:30000,bal:0});
const GIFT0={G100:{m:'gift',bal:10000},V250:{m:'voucher',bal:25000}};
const M_OK=['cash','card','check','transfer','bit','paybox','gift','voucher','extGift'];
const prodOf=pid=>{ensure();const p=BYID.get(pid);if(!p)return null;const s=st.stock[pid];return s==null?p:Object.assign({},p,{stock:s})};
const withStock=L=>L.map(p=>st.stock[p.id]==null?p:Object.assign({},p,{stock:st.stock[p.id]}));
/* בדיקת המכירה כמו בשרת (ת7): paid + debt = gross, עודף רק במזומן ועד סכום המזומן, אמצעים מהרשימה הסגורה, אסמכתא חובה */
function checkSale(s){if(!s||!Array.isArray(s.lines)||!s.lines.length)throw fail('bad-sale','אין שורות');
 const pays=s.pays||[];for(const p of pays){if(!M_OK.includes(p.m))throw fail('bad-m','אמצעי תשלום לא מוכר: '+p.m);if(!Number.isInteger(p.amt)||p.amt<=0)throw fail('bad-amt','סכום לא תקין');
  if(['transfer','bit','paybox','extGift'].includes(p.m)&&!String(p.ref||'').trim())throw fail('no-ref','חסרה אסמכתא');
  if(p.m==='check'&&p.post&&!p.due)throw fail('no-due','צ\'ק דחוי בלי תאריך');
  if(p.m==='card'&&!(/^\d{4}$/.test(p.last4||'')&&String(p.appr||'').trim()))throw fail('bad-card','חסרים פרטי אשראי');
  for(const k of Object.keys(p))if(!['m','amt','ref','chk','due','post','last4','appr','brand','inst','tx','src','term','termNo','reqId','round','code'].includes(k))throw fail('bad-field','שדה אסור בתשלום: '+k)}
 const chg=s.chg||0,debt=s.debt||0,cash=pays.filter(p=>p.m==='cash').reduce((a,p)=>a+p.amt,0),sum=pays.reduce((a,p)=>a+p.amt,0);
 if(chg<0||debt<0)throw fail('bad-amt','סכום שלילי');if(chg>cash)throw fail('bad-chg','עודף רק במזומן');
 if(sum-chg+debt!==s.gross)throw fail('not-closed','המכירה לא מאוזנת');
 if(debt>0){const c=CUST.find(x=>x.id===s.cust);if(!c)throw fail('debt-cust','הקפה רק ללקוח מזוהה');const free=c.limit-(st.debt[c.id]||0);if(debt>free)throw fail('debt-limit','חריגה ממסגרת ההקפה')}}
const API={
 isMock:true,
 normalize:norm,
 M_OK,
 getSession:async()=>SESSION(),
 getCategories:async()=>clone(CATS),
 byCat:async(cat,limit)=>{ensure();const out=[];for(const p of P){if(p.cat===cat&&!p.parent&&!p.gen){out.push(p);if(limit&&out.length>=limit)break}}return withStock(out)},
 getProducts:async()=>{ensure();return P},
 /* מועדפים לאריחים (cat.favMax). במימוש האמיתי – לפי בחירת המנהל או המוצרים הנמכרים */
 favorites:async n=>{ensure();return withStock(P.filter(p=>!p.parent&&!p.gen&&!p.svc&&!p.variants).slice(0,(n||24)-1).concat([BYID.get('p02')]))},
 search:async(q,limit)=>withStock(searchSync(q,limit)),
 searchSync,
 byBarcode:async code=>{ensure();const p=BC.get(String(code||'').trim());if(!p)return null;if(p.variants)return Object.assign({},p,{variants:p.variants.map(prodOf)});return prodOf(p.id)},
 getProduct:async pid=>prodOf(pid),
 quickAdd:async o=>{ensure();const name=String(o&&o.name||'').trim().slice(0,40),price=o&&o.price;if(!name)throw fail('bad-name','חסר שם');if(!Number.isInteger(price)||price<=0)throw fail('bad-price','מחיר לא תקין');
  const p={id:'q'+Date.now().toString(36)+P.length,name,barcode:String(o.barcode||''),sku:'',price,stock:0,cat:'dry',fromPos:true};P.push(p);idx();st.added.push(p);API.log('quickAdd',{pid:p.id,barcode:p.barcode});persist();return clone(p)},
 searchCust:async q=>{const s=norm(q);if(!s)return[];return clone(CUST.filter(c=>norm(c.name).includes(s)||c.phone.includes(s.replace(/\D/g,'')||'#')).slice(0,10).map(c=>Object.assign({},c,{bal:st.debt[c.id]||0})))},
 getCust:async id=>{const c=CUST.find(x=>x.id===id);return c?Object.assign(clone(c),{bal:st.debt[c.id]||0}):null},
 giftBalance:async(m,code)=>{const k=String(code||'').trim().toUpperCase(),g=GIFT0[k];if(!g||g.m!==m)return{ok:false,bal:0};const used=st.gifts[k]||0;return{ok:true,bal:g.bal-used}},
 park:async cart=>{const id='k'+Date.now().toString(36)+st.parks.length;st.parks.push(Object.assign(clone(cart),{id,at:Date.now(),st:'open'}));API.log('park',{id});persist();return{id}},
 parked:async()=>clone(st.parks.filter(k=>k.st!=='done').reverse()),
 unpark:async id=>{const k=st.parks.find(x=>x.id===id);if(!k||k.st==='done')return null;k.st='done';persist();return clone(k)},
 flagParked:async()=>{let n=0;st.parks.forEach(k=>{if(k.st==='open'){k.st='flag';n++}});persist();return n},
 log:async(act,data)=>{st.log.push({act,at:Date.now(),data:data||{}});if(st.log.length>2000)st.log.splice(0,st.log.length-2000);persist();return true},
 getLog:async()=>clone(st.log),
 saveSale:async sale=>{checkSale(sale);const dup=sale.reqId&&st.sales.find(x=>x.reqId===sale.reqId);if(dup)return{id:dup.id,no:dup.no,doc:dup.doc,at:dup.at};
  const at=Date.now(),dev=SESSION().dev,no=(st.seq[dev]=(st.seq[dev]||0)+1),c=sale.cust&&CUST.find(x=>x.id===sale.cust),doc=c&&c.biz?'inv+rc':'ir',id='s'+at+'_'+no;
  sale.lines.forEach(l=>{const p=BYID.get(l.pid);if(p&&!p.gen&&!p.svc){const cur=st.stock[l.pid]==null?p.stock:st.stock[l.pid];st.stock[l.pid]=cur-l.qty}});
  if(sale.debt)st.debt[sale.cust]=(st.debt[sale.cust]||0)+sale.debt;
  (sale.pays||[]).forEach(p=>{if((p.m==='gift'||p.m==='voucher')&&p.code){const k=String(p.code).toUpperCase();st.gifts[k]=(st.gifts[k]||0)+p.amt}});
  const ses=SESSION();st.sales.push(Object.assign(clone(sale),{id,no,doc,dev,at,day:dayOf(at),cashier:ses.cashier.id,cashierNo:ses.cashier.no,shift:ses.shift.id,retQty:{},retAmt:{},retByM:{}}));persist();return{id,no,doc,at}},
 getSale:async no=>{const s=st.sales.find(x=>x.no===+no);return s?clone(s):null},
 findSales:async o=>{o=o||{};let L=st.sales;if(o.no)L=L.filter(s=>s.no===+o.no);if(o.phone){const c=CUST.filter(x=>x.phone.includes(String(o.phone).replace(/\D/g,''))).map(x=>x.id);L=L.filter(s=>c.includes(s.cust))}
  if(o.day)L=L.filter(s=>s.day===o.day);if(o.gross)L=L.filter(s=>s.gross===o.gross);return clone(L.slice(-100).reverse())},
 saveReturn:async ret=>{const s=st.sales.find(x=>x.no===+ret.saleNo);if(ret.src==='sale'&&!s)throw fail('no-sale','המכירה לא נמצאה');
  if(ret.reqId){const d=st.rets.find(x=>x.reqId===ret.reqId);if(d)return{id:d.id,no:d.no,doc:'cr',at:d.at}}
  if(s){for(const l of ret.lines){const sl=s.lines[l.i];if(!sl)throw fail('bad-line','שורה לא קיימת');if((s.retQty[l.i]||0)+l.qty>sl.qty)throw fail('over-qty','כמות גבוהה ממה שנמכר');if((s.retAmt[l.i]||0)+l.amt>sl.fin)throw fail('over-amt','סכום גבוה ממה ששולם')}
   ret.lines.forEach(l=>{s.retQty[l.i]=(s.retQty[l.i]||0)+l.qty;s.retAmt[l.i]=(s.retAmt[l.i]||0)+l.amt});
   Object.entries(ret.byM||{}).forEach(([m,a])=>{s.retByM[m]=(s.retByM[m]||0)+a});if(ret.debtOff&&s.cust)st.debt[s.cust]=Math.max(0,(st.debt[s.cust]||0)-ret.debtOff)}
  ret.lines.forEach(l=>{if(l.back&&l.pid){const p=BYID.get(l.pid);if(p){const cur=st.stock[l.pid]==null?p.stock:st.stock[l.pid];st.stock[l.pid]=cur+l.qty}}});
  const at=Date.now(),dev=SESSION().dev,no=(st.rseq[dev]=(st.rseq[dev]||0)+1),id='r'+at+'_'+no;st.rets.push(Object.assign(clone(ret),{id,no,at,day:dayOf(at),cashier:SESSION().cashier.id}));persist();return{id,no,doc:'cr',at}},
 dayStats:async()=>{const d=dayOf(Date.now()),S=st.sales.filter(s=>s.day===d),R=st.rets.filter(r=>r.day===d);return{sales:S.length,total:S.reduce((a,s)=>a+s.gross,0),returns:R.length,returnsTotal:R.reduce((a,r)=>a+r.total,0)}},
 myStats:async cid=>{const d=dayOf(Date.now()),S=st.sales.filter(s=>s.day===d&&s.cashier===cid),R=st.rets.filter(r=>r.day===d&&r.cashier===cid);return{sales:S.length,total:S.reduce((a,s)=>a+s.gross,0)-R.reduce((a,r)=>a+r.total,0)}},
 _reset:()=>{st.sales=[];st.rets=[];st.parks=[];st.log=[];st.seq={};st.rseq={};st.stock={};st.debt={};st.gifts={};if(st.added.length&&P){P=P.filter(p=>!p.fromPos);idx()}st.added=[];persist()}
};
if(!root.PosData)root.PosData=API;
if(typeof module!=='undefined'&&module.exports)module.exports=API;
})(typeof window!=='undefined'?window:globalThis);
