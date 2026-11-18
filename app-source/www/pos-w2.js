/* POS:W2 – קופה, איחוד גל 2 (ענף test/pos-wave2, 18.11.2026). קובץ חיבור בלבד – לא משנה את המודולים, רק מחבר ביניהם:
   1. מסך המכירה (ש1, pos-sale.js) עובד מול שכבת הנתונים האמיתית (ש3, pos-data.js) ולא מול pos-data-mock.js.
      pos-data.js נטען לפני הקובץ המדומה ותופס את window.PosData; כאן נוספות לו הפעולות שמסך המכירה צריך ושאין בו
      (קטגוריות, מועדפים, מוצר לפי מזהה, הוספה מהירה, השהיות, יומן, המכירות שלי, חיפוש מכירות, לקוחות, כרטיס מתנה),
      ו-saveSale / saveReturn / getSale ממירים בין צורת המכירה של ש1 (unit, fin, pays:{m,amt}, gross) לזו של ש3.
   2. PosOffline.stats() → {n, oldest} – לש7 (דיווח התור לשרת).
   3. הדפסה: Devices.print (ש7) מקבל מ-ש1 {kind, doc}; כאן הקבלה נבנית ב-PosReceipt (ש2) ומומרת לשורות של LpPosRender.
   0. טעינת ההגדרות של העסק (PosCfg.ready של ש4) – בלעדיה כל המודולים רואים רק ברירות מחדל.
   בלי pos-data.js (למשל בדיקות של ש1 לבד) – לא עושה כלום, והמדומה נשאר. סכומים באגורות. */
(function(root){
'use strict';
if(typeof document==='undefined')return;
/* 0. ההגדרות (ש4): PosCfg.get סינכרוני ומחזיר ברירת מחדל עד ש-PosCfg.ready() נטען פעם אחת (אחר כך pos-cfg.js מרענן כל דקה).
      עד האיחוד רק מסך מצב המערכת קרא ל-ready – כאן הטעינה בהתחלה, במעבר עסק ולפני פתיחת הקופה */
const cfgKick=()=>{try{const C=root.PosCfg;if(C&&typeof C.ready==='function')return C.ready().catch(()=>{})}catch(e){}return Promise.resolve()};
[800,3000,8000,20000].forEach(ms=>setTimeout(cfgKick,ms));
root.addEventListener('lp-biz-change',()=>setTimeout(cfgKick,300));
if(typeof root.posOpen==='function'){const o0=root.posOpen;root.posOpen=async function(){await cfgKick();return o0.apply(this,arguments)};try{if(typeof ACT!=='undefined')ACT.posOpen=()=>root.posOpen()}catch(e){}}
/* 0א. מבצעים: ש1 קורא PosPromo.apply(lines, ctx) ומצפה למערך שורות; ש2 מספק apply(lines, promos, ctx) → {lines:[{pdisc,promo}]}.
       כאן המתאם: המבצעים מהאוסף promo (נקרא כשיש קופה, ומתרענן כל 5 דקות), ואותו חישוב בדיוק כמו בשרת (posSale) */
let PROMOS=[],prAt=0,prBusy=null;
const prLive=()=>{try{return!!(root.PosCfg&&root.PosCfg.open&&root.PosCfg.open())}catch(e){return false}};
function promosLoad(){if(prBusy||!prLive()||typeof root.fsx!=='function')return prBusy;prBusy=(async()=>{try{const j=await root.fsx('/promo?pageSize=500');
 PROMOS=((j&&j.documents)||[]).map(d=>Object.assign({},root.fvj({mapValue:d}),{id:String(d.name||'').split('/').pop()}));prAt=Date.now()}catch(e){/* בלי רשת – הרשימה האחרונה */}})().finally(()=>{prBusy=null});return prBusy}
if(root.PosUI&&root.PosUI.Promo&&root.PosPromo&&typeof root.PosPromo.apply==='function'){
 root.PosUI.Promo.apply=function(lines,ctx){const plain=()=>lines.map(l=>Object.assign({},l,{pdisc:0,promo:null}));
  try{if(Date.now()-prAt>5*60000)promosLoad();if(!PROMOS.length)return plain();const cfg=k=>root.PosUI.cfg(k);
   const r=root.PosPromo.apply(lines.map(l=>({pid:l.gen?undefined:l.pid,qty:l.qty,unit:l.unit,noPromo:!!l.gen})),PROMOS,{at:Date.now(),stack:cfg('promoStack'),cpnStack:cfg('cpnStack')!==false,cpnOnPromo:cfg('cpnOnPromo')===true});
   return lines.map((l,i)=>{const x=(r&&r.lines&&r.lines[i])||{};return Object.assign({},l,{pdisc:x.pdisc||0,promo:x.promo||null})})}catch(e){return plain()}};
 [1500,6000].forEach(ms=>setTimeout(promosLoad,ms));root.addEventListener('lp-biz-change',()=>{PROMOS=[];prAt=0})}
const PD=root.PosData;
if(!PD||PD.isMock!==false)return;
const gSY=()=>{try{return typeof SY!=='undefined'?SY:null}catch(e){return null}};
const bizId=()=>{const s=gSY();return(s&&s.bizId)||''};
const ls=(k,v)=>{try{if(v===undefined)return root.localStorage.getItem(k);if(v===null)root.localStorage.removeItem(k);else root.localStorage.setItem(k,v)}catch(e){return null}};
const jget=k=>{try{return JSON.parse(ls(k)||'null')}catch(e){return null}};
const K=s=>'lp-pos-w2:'+(bizId()||'_')+':'+s;
const fail=(reason,msg)=>{const e=new Error(msg||reason);e.reason=reason;return e};
const clone=o=>JSON.parse(JSON.stringify(o));
const dayOf=t=>{const d=new Date(t);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
const fn=(n,d)=>{d=d&&typeof d==='object'?d:{};const s=gSY();if(s&&s.sa&&s.bizId&&!('bizId'in d))d=Object.assign({bizId:s.bizId},d);return root.fnCall(n,d)};
const rid=()=>{const a=new Uint8Array(9);try{root.crypto.getRandomValues(a)}catch(e){for(let i=0;i<9;i++)a[i]=Math.floor(Math.random()*256)}return'w'+Date.now().toString(36)+Array.from(a,b=>b.toString(16).padStart(2,'0')).join('')};

/* ---------- תפקיד ומשמרת (ש1 צריך cashier.role ו-cashier.no) ---------- */
function myRole(){const s=gSY();try{if(s&&(s.sa||(s.role==='admin'&&s.refresh)))return'mgr';if(s&&s.perms&&s.perms.posMgr===true)return'lead'}catch(e){}return'cashier'}
const getSession0=PD.getSession;
PD.getSession=async function(){const r=await getSession0.apply(null,arguments);r.cashier=Object.assign({},r.cashier,{role:myRole()});if(r.cashier.no==null)r.cashier.no=r.cashier.name||'';
 try{const sh=root.PosShift&&root.PosShift.shift();if(sh){const m=/S0*([0-9]+)$/.exec(sh);r.shift=Object.assign({},r.shift,{id:sh,no:m?+m[1]:r.shift.no})}}catch(e){}
 return r};

/* ---------- מוצרים ---------- */
const GEN={id:'gen',name:'פריט כללי',barcode:'',sku:'0',price:0,gen:true};
PD.getCategories=async()=>[];/* קטגוריות במוצרים – פתוח (pos-data.js לא מעביר cat) */
PD.byCat=async()=>[];
PD.favorites=async n=>{let L=[];try{L=await PD.getProducts()}catch(e){/* בלי רשת ובלי עותק במכשיר – אין אריחים, החיפוש עדיין עובד כשיגיעו */}return(L||[]).slice(0,n||24)};
PD.getProduct=async pid=>{if(pid==='gen')return Object.assign({},GEN);try{return((await PD.getProducts())||[]).find(p=>p.id===pid)||null}catch(e){return null}};
/* ברקוד לא מוכר → posProdQuick (ש6). המחיר בשרת בשקלים */
PD.quickAdd=async o=>{const name=String(o&&o.name||'').trim().slice(0,40),price=o&&o.price;if(!name)throw fail('bad-name','חסר שם');if(!Number.isInteger(price)||price<=0)throw fail('bad-price','מחיר לא תקין');
 const dev=(()=>{try{return(jget('lp-pos-dev')||{}).dev||''}catch(e){return''}})();
 const r=await fn('posProdQuick',Object.assign({reqId:rid(),bc:String(o.barcode||''),name,price:price/100},dev?{dev}:{}));
 try{await PD.refreshProducts()}catch(e){}
 const p=r&&r.id?await PD.getProduct(r.id):null;
 return p||{id:r.id,name:r.name||name,barcode:String(o.barcode||''),sku:r.sku||'',price:typeof r.price==='number'?Math.round(r.price*100):price,fromPos:true}};

/* ---------- השהיות ויומן – במכשיר (pospark / poslog בשרת – פתוח) ---------- */
const parksR=()=>jget(K('park'))||[],parksW=a=>ls(K('park'),JSON.stringify(a.slice(-100)));
PD.park=async cart=>{const a=parksR(),id='k'+Date.now().toString(36)+a.length;a.push(Object.assign(clone(cart),{id,at:Date.now(),st:'open'}));parksW(a);PD.log('park',{id});return{id}};
PD.parked=async()=>parksR().filter(k=>k.st!=='done').reverse();
PD.unpark=async id=>{const a=parksR(),k=a.find(x=>x.id===id);if(!k||k.st==='done')return null;k.st='done';parksW(a);return clone(k)};
PD.flagParked=async()=>{const a=parksR();let n=0;a.forEach(k=>{if(k.st==='open'){k.st='flag';n++}});parksW(a);return n};
PD.log=async(act,data)=>{const a=jget(K('log'))||[];a.push({act:String(act||''),at:Date.now(),data:data||{}});ls(K('log'),JSON.stringify(a.slice(-500)));return true};
PD.getLog=async()=>jget(K('log'))||[];

/* ---------- לקוחות וכרטיס מתנה ---------- */
let CU=null,cuAt=0;
async function custList(){if(CU&&Date.now()-cuAt<5*60000)return CU;const out=[];let tok='';
 for(let i=0;i<5;i++){const j=await root.fsx('/cust?pageSize=1000'+(tok?'&pageToken='+encodeURIComponent(tok):''));
  for(const d of(j&&j.documents)||[]){const o=root.fvj({mapValue:d});const id=String(d.name||'').split('/').pop();if(o&&!o.mv)out.push({id,name:String(o.bn||o.name||''),phone:String(o.phone||''),phx:Array.isArray(o.phx)?o.phx.map(String):[],biz:o.wholesale===true,taxId:o.vat||'',addr:'',limit:typeof o.lim==='number'?Math.round(o.lim*100):0,bal:0})}
  tok=j&&j.nextPageToken;if(!tok)break}
 CU=out;cuAt=Date.now();return CU}
const nrm=s=>(PD.normalize?PD.normalize(s):String(s||'').toLowerCase());
PD.searchCust=async q=>{const s=nrm(q),dg=String(q||'').replace(/\D/g,'');if(!s&&!dg)return[];let L=[];try{L=await custList()}catch(e){return[]}
 return clone(L.filter(c=>(s&&nrm(c.name).includes(s))||(dg.length>=3&&(c.phone.includes(dg)||c.phx.some(p=>p.includes(dg))))).slice(0,10))};
PD.getCust=async id=>{try{return clone((await custList()).find(c=>c.id===id)||null)}catch(e){return null}};
PD.giftBalance=async(m,code)=>{try{const r=await fn('posGift',{op:'get',code:String(code||'').trim().toUpperCase()});if(!r||r.type!==m||r.st==='exp'||r.st==='void')return{ok:false,bal:0};return{ok:true,bal:r.bal}}catch(e){return{ok:false,bal:0}}};

/* ---------- מכירה: צורת ש1 → ש3 (ש3 שולח ל-posSale של ש2 את התשלומים, ההנחות והלקוח) ---------- */
const PF0=['m','amt','ref','reqId'],PF={card:['last4','appr','brand','inst','tx','src','term','termNo'],check:['chk','due','post'],gift:['code'],voucher:['code']};
const payOut=p=>{const o={};for(const k of Object.keys(p))if((PF0.includes(k)||(PF[p.m]||[]).includes(k))&&p[k]!=null&&p[k]!=='')o[k]=p[k];return o};
function closeOk(s){const pays=s.pays||[],chg=s.chg||0,debt=s.debt||0,cash=pays.filter(p=>p.m==='cash').reduce((a,p)=>a+p.amt,0),sum=pays.reduce((a,p)=>a+p.amt,0);
 if(chg<0||debt<0)throw fail('bad-amt','סכום שלילי');if(chg>cash)throw fail('bad-chg','עודף רק במזומן');if(sum-chg+debt!==s.gross)throw fail('not-closed','המכירה לא מאוזנת');
 if(debt>0&&!s.cust)throw fail('debt-cust','הקפה רק ללקוח מזוהה')}
const saveSale0=PD.saveSale;
PD.saveSale=async sale=>{
 if(root.Devices&&typeof root.Devices.blocked==='function'&&root.Devices.blocked())throw fail('BLOCKED',(root.Devices.msg&&root.Devices.msg('BLOCKED'))||'הקופה חסומה למכירה');
 if(!sale||!Array.isArray(sale.lines)||!sale.lines.length)throw fail('bad-sale','אין שורות');closeOk(sale);
 const s=clone(sale);s.total=s.gross;s.change=s.chg||0;s.pays=(s.pays||[]).map(payOut);s.payments=s.pays.map(p=>({m:p.m,a:p.amt}));
 s.lines=s.lines.map(l=>Object.assign(l,{price:l.unit,total:l.fin!=null?l.fin:l.tot,barcode:l.barcode||''}));
 const r=await saveSale0(s);
 const c=sale.cust&&CU&&CU.find(x=>x.id===sale.cust);
 return{id:r.id,no:r.no,at:r.at,reqId:r.reqId,sync:r.sync,doc:c&&c.biz?'inv+rc':'ir'}};
/* מכירה שמורה → צורת ש1 (כמות וסכום שהוחזרו לכל שורה) */
const retMap=()=>jget(K('ret'))||{};
function asUi(s){if(!s)return null;const m=retMap()[s.no]||{};s.gross=s.gross!=null?s.gross:s.total;s.pays=s.pays||(s.payments||[]).map(p=>({m:p.m,amt:p.a}));
 s.lines=(s.lines||[]).map(l=>Object.assign({unit:l.price,fin:l.total,tot:l.total},l));s.retQty=m.q||{};s.retAmt=m.a||{};s.retByM=m.m||{};return s}
const getSale0=PD.getSale;
PD.getSale=async no=>asUi(await getSale0(no));
PD.findSales=async o=>{o=o||{};if(o.no){const s=await PD.getSale(o.no);return s?[s]:[]}
 const days=o.day?[o.day]:Array.from({length:14},(_,i)=>dayOf(Date.now()-i*86400000));let L=[];
 for(const d of days)L=L.concat(((await PD.getSales({day:d}))||[]).map(asUi));
 if(o.phone){const dg=String(o.phone).replace(/\D/g,'');let C=[];try{C=(await custList()).filter(c=>c.phone.includes(dg)||c.phx.some(p=>p.includes(dg))).map(c=>c.id)}catch(e){}L=L.filter(s=>s.cust&&C.includes(s.cust))}
 if(o.gross)L=L.filter(s=>s.gross===o.gross);return L.slice(0,100)};
PD.myStats=async cid=>{const S=((await PD.getSales({day:dayOf(Date.now())}))||[]).filter(s=>!cid||s.cashier===cid);return{sales:S.length,total:S.reduce((a,s)=>a+(s.gross!=null?s.gross:s.total||0),0)}};
/* החזרה – במכשיר (pos-data.js: srv:false). posReturn של ש2 – פתוח */
const saveReturn0=PD.saveReturn;
PD.saveReturn=async ret=>{const s=await PD.getSale(ret.saleNo);if(ret.src==='sale'&&!s)throw fail('no-sale','המכירה לא נמצאה');
 if(s)for(const l of ret.lines){const sl=s.lines[l.i];if(!sl)throw fail('bad-line','שורה לא קיימת');if((s.retQty[l.i]||0)+l.qty>sl.qty)throw fail('over-qty','כמות גבוהה ממה שנמכר');if((s.retAmt[l.i]||0)+l.amt>sl.fin)throw fail('over-amt','סכום גבוה ממה ששולם')}
 const r=await saveReturn0(Object.assign(clone(ret),{lines:ret.lines.map(l=>Object.assign({},l,{price:l.unit,total:l.amt}))}));
 if(s){const M=retMap(),m=M[s.no]||{q:{},a:{},m:{}};ret.lines.forEach(l=>{m.q[l.i]=(m.q[l.i]||0)+l.qty;m.a[l.i]=(m.a[l.i]||0)+l.amt});Object.entries(ret.byM||{}).forEach(([k,a])=>{m.m[k]=(m.m[k]||0)+a});M[s.no]=m;ls(K('ret'),JSON.stringify(M))}
 return{id:r.id,no:r.no,at:r.at,doc:'cr'}};

/* ---------- ש7: מצב התור ---------- */
if(root.PosOffline&&typeof root.PosOffline.stats!=='function')root.PosOffline.stats=()=>{try{return PD.stats()}catch(e){return{n:0,oldest:0}}};

/* ---------- הדפסה: {kind, doc} של ש1 → PosReceipt (ש2) → שורות LpPosRender (ש7) ---------- */
function cfgv(k){try{return root.PosUI?root.PosUI.cfg(k):undefined}catch(e){return undefined}}
function receiptOfDoc(job){const R=root.PosReceipt,d=job.doc;if(!R||!d||!Array.isArray(d.lines))return null;const s=gSY()||{},b=s.biz||{};
 const fmt=String(d.fmt||'r80').replace(/^r/,'');
 const data={hdr:{name:b.name||b.n||''},docs:[],pays:job.kind==='ret'?[]:(d.pays||[]),
  sale:{id:d.id,at:d.at,soldAt:d.at,lines:d.lines.map(l=>({n:l.name,unit:l.unit,qty:l.qty,disc:l.disc||0,promo:l.promo||null})),manDisc:d.manDisc||null,net:d.net!=null?d.net:(d.gross||d.total||0)-(d.vat||0),vat:d.vat||0,rate:cfgv('vatRate')||18,gross:d.gross!=null?d.gross:(d.total||0),chg:d.chg||0,debt:d.debt||0,note:d.note||''}};
 if(job.kind==='ret')data.docs=[{t:'cr',no:d.no||'',id:d.id||''}];
 const out=R.build(data,{fmt:fmt==='a4'?'a4':fmt==='58'?'58':'80',gift:job.kind==='gift',copy:!!job.copy,cashNo:d.cashierNo,cfg:{rcptFooter:cfgv('rcptFooter'),rcptQr:false,rcptBarcode:false}});
 const lines=out.rows.map(r=>r.t==='hr'?{t:'line'}:r.t==='sp'?{t:'feed',n:12}:r.t==='lr'?{t:'cols',cols:[{text:String(r.a||''),w:0.68,align:'right'},{text:String(r.b||''),w:0.32,align:'left'}]}:r.t==='qr'?{t:'qr',data:String(r.a||''),size:0.5}:r.t==='bc'?{t:'barcode',data:String(r.a||''),format:'CODE128',h:60,text:true}:{t:'text',text:String(r.a||''),align:'center',bold:r.t==='b'});
 return{width:fmt==='58'?384:576,lines}}
function hookPrint(){const D=root.Devices;if(!D||typeof D.print!=='function'||D._w2)return false;const p0=D.print;
 D.print=function(job,o){try{if(job&&job.kind&&job.doc&&!job.receipt&&!job.img){const rc=receiptOfDoc(job);if(rc)job={id:String(job.doc.id||job.doc.no||'')+(job.kind==='sale'?'':'-'+job.kind)+(job.copy?'-c'+Date.now().toString(36):''),kind:job.kind,receipt:rc}}}catch(e){}return p0.call(this,job,o)};
 D._w2=true;return true}
/* Devices (ש7) נטען אחרי הקובץ הזה */
if(!hookPrint())root.addEventListener('DOMContentLoaded',hookPrint,{once:true});
})(typeof window!=='undefined'?window:globalThis);
/* /POS:W2 */
