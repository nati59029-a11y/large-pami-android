/* POS:IMP – קופה: אשף "ייבוא מכספיט" (משימה 2026-11-17_תוכנית-קופה-לחנות, סשן י', ענף feature/pos-import).
   מנהל בלבד, באזור הניהול (הגדרות ← קופה), מאחורי מתג העסק 'pos'. לא מופיע במסך הקופה.
   שלבים: בחירת קובץ (Excel / CSV; עברית ב-UTF-8 או windows-1255) ← התאמת עמודות (+ מחיר כולל / לפני מע"מ) ← מיפוי מחלקות (מוצרים) ←
          בדיקה מול השרת (posImpCheck) ← תצוגה מקדימה: חדשים / כפולים / שגויים / לא פעילים ← אישור ← ייבוא במנות של 200 (posImport) ←
          יומן ייבוא (posImpList) ← "ביטול ייבוא" (posImpUndo – מכבה מוצרים שעוד לא נמכרו, בלי מחיקה).
   כלל ברזל: רשומה קיימת לא נדרסת לעולם (השרת רק יוצר). כפילות: מוצר – ברקוד (בלי ברקוד: שם מדויק); לקוח – טלפון או ת"ז.
   הליבה (PosImpCore) טהורה ורצה גם ב-Node לבדיקות (firebase/tests/pos-import.unit.test.js). כל כתיבה – דרך השרת (functions/pos-import.js). */
(function(root){
'use strict';
// ===================== ליבה טהורה =====================
const VAT0=18;
const BCL=root.PosBarcode||(typeof require==='function'?(()=>{try{return require('./pos-barcode.js')}catch(e){return null}})():null);
const KN={prod:'מוצרים',cust:'לקוחות'};
const FIELDS={
 prod:[['name','שם המוצר',1],['barcode','ברקוד'],['sku','מק"ט / קוד פריט'],['price','מחיר מכירה'],['priceEx','מחיר לפני מע"מ'],['cost','מחיר עלות (לפני מע"מ)'],['cat','מחלקה / קטגוריה'],['active','פעיל / סטטוס']],
 cust:[['name','שם הלקוח',1],['first','שם פרטי'],['last','שם משפחה'],['phone','טלפון'],['tz','ת"ז'],['mail','מייל']]};
const norm=h=>String(h==null?'':h).replace(/["'״׳`\s._\-/\\()]/g,'').toLowerCase();
// ניחוש לפי כותרת. פורמט הייצוא של כספיט לא ידוע (לא מאומת) – המשתמש מאשר / משנה כל עמודה
function guess(kind,h){const s=norm(h);if(!s)return '';
 if(kind==='prod'){
  if(/ברקוד|barcode|^ean|^upc/.test(s))return 'barcode';
  if(/מקט|קודפריט|^קוד$|^sku|מספרפריט|itemcode/.test(s))return 'sku';
  if(/עלות|קניה|cost/.test(s))return 'cost';
  if(/(לפני|ללא|בלי)מעמ|נטו|net/.test(s))return 'priceEx';
  if(/מחיר|price|לצרכן/.test(s))return 'price';
  if(/מחלקה|קטגוריה|קבוצה|category|dept/.test(s))return 'cat';
  if(/פעיל|סטטוס|status|active|מוקפא/.test(s))return 'active';
  if(/שם|תיאור|פריט|name|desc/.test(s))return 'name';
  return '';}
 if(/פרטי|first/.test(s))return 'first';
 if(/משפחה|last/.test(s))return 'last';
 if(/טל|נייד|פלאפון|phone|mobile|cell/.test(s))return 'phone';
 if(/זהות|^תז$|^id$|teudat/.test(s))return 'tz';
 if(/מייל|דואל|דואר|mail/.test(s))return 'mail';
 if(/שם|לקוח|name/.test(s))return 'name';
 return ''}
// פענוח טקסט: BOM ← UTF-8 תקין ← windows-1255 (כספיט / Excel ישן בעברית)
function decode(bytes){const b=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
 if(b[0]===0xEF&&b[1]===0xBB&&b[2]===0xBF)return{text:new TextDecoder('utf-8').decode(b.subarray(3)),enc:'utf-8'};
 if(b[0]===0xFF&&b[1]===0xFE)return{text:new TextDecoder('utf-16le').decode(b.subarray(2)),enc:'utf-16le'};
 try{return{text:new TextDecoder('utf-8',{fatal:true}).decode(b),enc:'utf-8'}}catch(e){}
 return{text:new TextDecoder('windows-1255').decode(b),enc:'windows-1255'}}
function parseCsv(t){t=String(t||'');const l0=t.split(/\r?\n/)[0]||'';const cnt=c=>l0.split(c).length;
 const d=cnt('\t')>cnt(',')&&cnt('\t')>cnt(';')?'\t':(cnt(';')>cnt(',')?';':',');
 const rows=[];let r=[],c='',q=false;
 for(let i=0;i<t.length;i++){const ch=t[i];
  if(q){if(ch==='"'){if(t[i+1]==='"'){c+='"';i++}else q=false}else c+=ch}
  else if(ch==='"'&&c==='')q=true;else if(ch===d){r.push(c);c=''}
  else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&t[i+1]==='\n')i++;r.push(c);rows.push(r);r=[];c=''}else c+=ch}
 if(c!==''||r.length){r.push(c);rows.push(r)}
 return rows}
const filled=r=>Array.isArray(r)&&r.some(c=>String(c==null?'':c).trim()!=='');
// שורת הכותרות: הראשונה (מתוך 15) עם 2 תאים מלאים ומעלה, שרובם טקסט (בדוחות יש לפעמים שורת כותרת של הדוח מעל)
function headerAt(rows){for(let i=0;i<Math.min(rows.length,15);i++){const r=rows[i]||[];const f=r.filter(c=>String(c==null?'':c).trim()!=='');
  if(f.length>=2&&f.filter(c=>typeof c!=='number'&&!/^[\d.,\s₪-]+$/.test(String(c))).length>=Math.ceil(f.length/2))return i}return 0}
// קריאת קובץ: Excel דרך XLSX (קיים באפליקציה), CSV/TXT – פענוח קידוד ואז ניתוח
function readRows(name,bytes,XL){name=String(name||'');
 if(/\.(xlsx|xlsm|xls|ods)$/i.test(name)){if(!XL)throw new Error('ספריית האקסל לא נטענה. שמרו את הקובץ כ-CSV ונסו שוב.');
  const wb=XL.read(bytes,{type:'array',codepage:1255,cellDates:false});const ws=wb.Sheets[wb.SheetNames[0]];
  return{rows:XL.utils.sheet_to_json(ws,{header:1,raw:true,defval:''}),enc:'xlsx',src:'xlsx'}}
 const d=decode(bytes);return{rows:parseCsv(d.text.replace(/^﻿/,'')),enc:d.enc,src:'csv'}}
// מספר: 12.90 / "12,90" / "1,234.50" / "₪ 12.9" / "12.90-" ← 12.9. לא מספר – NaN
function num(v){if(typeof v==='number')return Number.isFinite(v)?v:NaN;let s=String(v==null?'':v).replace(/[₪\s ]|ש"ח|שח|nis/gi,'');if(!s)return NaN;
 let neg=false;if(/-$/.test(s)){neg=true;s=s.slice(0,-1)}
 if(s.includes('.')&&s.includes(','))s=s.replace(/,/g,'');else if(/^-?\d+,\d{1,2}$/.test(s))s=s.replace(',','.');else s=s.replace(/,/g,'');
 if(!/^-?\d*\.?\d+$/.test(s))return NaN;const n=+s;return neg?-n:n}
const r2=x=>Math.round(x*100)/100;
function barcodeOf(v){if(v==null||v==='')return{v:''};
 if(typeof v==='number'){if(!Number.isInteger(v)||v<0)return{err:'ברקוד לא תקין'};if(v>Number.MAX_SAFE_INTEGER)return{err:'ברקוד ארוך מדי – שמרו את העמודה כטקסט'};return{v:String(v)}}
 const s=String(v).trim().replace(/\s/g,'');if(!s)return{v:''};
 if(/^\d+(\.\d+)?e\+?\d+$/i.test(s))return{err:'ברקוד בכתיב מדעי (7.29E+12) – שמרו את העמודה כטקסט'};
 if(!/^[0-9A-Za-z-]{3,30}$/.test(s))return{err:'ברקוד: ספרות / אותיות, 3 עד 30'};return{v:s}}
function phoneOf(raw){let p=String(raw==null?'':raw).trim().replace(/[\s\-().]/g,'');if(!p)return{v:''};
 if(/^\+?972\d{8,9}$/.test(p))p='0'+p.replace(/^\+?972/,'');if(/^5\d{8}$/.test(p))p='0'+p;
 return /^0(5\d{8}|7\d{8}|[23489]\d{7})$/.test(p)?{v:p}:{err:'טלפון לא תקין'}}
function tzOf(raw){const t=String(raw==null?'':raw).replace(/\D/g,'');if(!t)return{v:''};if(!/^\d{5,9}$/.test(t))return{err:'ת"ז: 5 עד 9 ספרות'};
 const z=t.padStart(9,'0');let s=0;for(let i=0;i<9;i++){let d=+z[i]*((i%2)+1);if(d>9)d-=9;s+=d}
 return s%10||z==='000000000'?{err:'ת"ז לא תקינה (ספרת ביקורת)'}:{v:z}}
const OFF_RE=/^(לא|לאפעיל|0|false|no|n|off|מוקפא|מבוטל|לאפעילה|inactive|לא פעיל)$/i;
const isOff=v=>{const s=norm(v);return !!s&&OFF_RE.test(s)};
const txt=(v,max)=>String(v==null?'':v).replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
// 8 ספרות ומעלה ברצף בשדה טקסט נדחה בשרת (הגנה מפני מספר כרטיס) – נבדק כבר כאן
const digRun=s=>{let m=0,c=0;for(const ch of String(s)){if(/\d/.test(ch)){c++;if(c>m)m=c}else if(!/[\s\-./_]/.test(ch))c=0}return m};
// בניית השורות לשרת. map[i] = שדה לעמודה i. opts: { vatIn:true|false, rate:18, cats:{<שם מחלקה>:{cid}|{cat}|null} }
// תוצאה: [{ n (מספר השורה בקובץ), st:'ok'|'bad'|'off', why?, row?, key }]
function build(kind,R,map,opts,first){opts=opts||{};first=first||2;const rate=Number.isFinite(opts.rate)?opts.rate:VAT0;const vatIn=opts.vatIn!==false;
 const col=f=>map.indexOf(f);const C={};FIELDS[kind].forEach(([f])=>C[f]=col(f));
 const at=(r,f)=>C[f]>-1?r[C[f]]:'';
 return R.map((r,i)=>{const n=first+i;
  if(!filled(r))return null;
  try{
   if(kind==='prod'){
    if(C.active>-1&&isOff(at(r,'active')))return{n,st:'off',why:'לא פעיל בכספיט – לא מייבאים'};
    const name=txt(at(r,'name'),60);if(!name)throw 'חסר שם מוצר';if(digRun(name)>=8)throw 'שם המוצר כולל מספר ארוך (8 ספרות ומעלה)';
    // P1 (אפיון א): ברקוד ישן לא תקין / ספרת ביקורת שגויה – נקלט בלי ברקוד ומסומן "לבדיקה" (bcRaw). מחיר חסר – נקלט ומסומן "חסר מחיר"
    let bc=barcodeOf(at(r,'barcode')),bcRaw='';if(bc.err||(bc.v&&BCL&&!BCL.check(bc.v).ok)){bcRaw=txt(at(r,'barcode'),40);bc={v:''}}
    let price=NaN;const p=num(at(r,'price')),px=num(at(r,'priceEx'));
    if(C.price>-1&&String(at(r,'price')).trim()!=='')price=vatIn?p:p*(1+rate/100);
    else if(C.priceEx>-1&&String(at(r,'priceEx')).trim()!=='')price=px*(1+rate/100);
    const noP=(C.price<0||String(at(r,'price')).trim()==='')&&(C.priceEx<0||String(at(r,'priceEx')).trim()==='');
    if(noP)price=0;else if(!Number.isFinite(price))throw 'מחיר לא תקין';if(price<0||price>1000000)throw 'מחיר מחוץ לטווח';
    const row={name,price:r2(price)};if(bc.v)row.barcode=bc.v;if(bcRaw)row.bcRaw=bcRaw;
    const warn=[noP?'חסר מחיר – לא נמכר עד שמתקנים':'',bcRaw?'ברקוד לא תקין – לבדיקה':''].filter(Boolean).join(' · ');
    const sku=txt(at(r,'sku'),30);if(sku){if(digRun(sku)>=8&&!/[A-Za-z֐-׿]/.test(sku))throw 'מק"ט ארוך מדי (8 ספרות ומעלה) – אם זה ברקוד, בחרו לעמודה "ברקוד"';row.sku=sku}
    if(C.cost>-1&&String(at(r,'cost')).trim()!==''){const c=num(at(r,'cost'));if(!Number.isFinite(c)||c<0||c>1000000)throw 'מחיר עלות לא תקין';row.cost=r2(c)}
    const cat=txt(at(r,'cat'),40);if(cat&&opts.cats){const m=opts.cats[cat];if(m&&m.cid)row.cid=m.cid;else if(m&&m.cat)row.cat=m.cat}else if(cat&&!opts.cats)row.cat=cat;
    return Object.assign({n,st:'ok',row,key:bc.v?'b:'+bc.v:'n:'+name,show:{name,bc:bc.v||bcRaw,price:noP?null:row.price,cat}},warn?{why:warn,warn:1}:{})}
   const name=txt(at(r,'name')||[txt(at(r,'first'),30),txt(at(r,'last'),30)].filter(Boolean).join(' '),60);if(!name)throw 'חסר שם לקוח';if(digRun(name)>=8)throw 'השם כולל מספר ארוך';
   const ph=phoneOf(at(r,'phone')),tz=tzOf(at(r,'tz'));if(ph.err)throw ph.err;if(tz.err)throw tz.err;
   if(!ph.v&&!tz.v)throw 'חסר טלפון או ת"ז – אי אפשר לבדוק כפילות';
   const row={name};if(ph.v)row.phone=ph.v;if(tz.v)row.tz=tz.v;
   const mail=txt(at(r,'mail'),120).toLowerCase();if(mail){if(!/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(mail))throw 'מייל לא תקין';row.mail=mail}
   return{n,st:'ok',row,key:[ph.v?'p:'+ph.v:'',tz.v?'t:'+tz.v:''].filter(Boolean),show:{name,ph:ph.v,tz:tz.v}}
  }catch(e){return{n,st:'bad',why:typeof e==='string'?e:'שורה לא תקינה'}}}).filter(Boolean)}
// סימון כפולים בתוך הקובץ (השני ואילך) + כפולים מול המערכת (ex = קבוצת אינדקסים מתוך רשימת ה-ok, מהשרת)
function classify(list,ex){const seen=new Map();let k=0;const out={add:0,dup:0,bad:0,off:0,rows:list};
 for(const x of list){if(x.st==='bad'){out.bad++;continue}if(x.st==='off'){out.off++;continue}
  const idx=k++;const keys=Array.isArray(x.key)?x.key:[x.key];
  if(ex&&ex.has(idx)){x.st='dup';x.why='קיים במערכת – דילגתי';out.dup++;keys.forEach(q=>{if(!seen.has(q))seen.set(q,x.n)});continue}
  const prev=keys.map(q=>seen.get(q)).find(Boolean);
  if(prev){x.st='dup';x.why='כפול בקובץ (כמו שורה '+prev+')';out.dup++;continue}
  keys.forEach(q=>seen.set(q,x.n));out.add++}
 return out}
// מפתחות לבדיקה בשרת (לפי סדר שורות ה-ok)
const checkKeys=(kind,list)=>list.filter(x=>x.st==='ok').map(x=>kind==='prod'?(x.row.barcode?{bc:x.row.barcode}:{nm:x.row.name}):Object.assign({},x.row.phone?{ph:x.row.phone}:{},x.row.tz?{tz:x.row.tz}:{}));
const distinctCats=(R,map)=>{const c=map.indexOf('cat');if(c<0)return[];const s=new Set();R.forEach(r=>{const v=txt(r&&r[c],40);if(v)s.add(v)});return[...s].sort((a,b)=>a.localeCompare(b,'he'))};
// קבצי דוגמה – השורות מסומנות "(דוגמה)" ונתונים מומצאים; מוחקים לפני ייבוא
const TPL={
 prod:[['ברקוד','שם פריט','מחיר מכירה','מחיר עלות','מחלקה','פעיל'],['7290000000015','צלחות חד-פעמיות 20 יח׳ (דוגמה)',12.9,7.5,'חד פעמי','כן'],['7290000000022','עוגת שמרים (דוגמה)',24.9,'','מאפים','כן'],['','שקית נייר קטנה (דוגמה)',0.5,0.2,'חד פעמי','לא']],
 cust:[['שם לקוח','טלפון','ת.ז','מייל'],['לקוח לדוגמה א','050-0000000','','example-a@example.invalid'],['לקוח לדוגמה ב','','000000018','']]};
const ERR={exists:'קיים – דילגתי','file-dup':'כפול בקובץ','no-cat':'מחלקה לא נמצאה','no-key':'חסר טלפון / ת"ז','bad-name':'שם לא תקין','bad-price':'מחיר לא תקין','bad-barcode':'ברקוד לא תקין','bad-phone':'טלפון לא תקין','bad-tz':'ת"ז לא תקינה','bad-mail':'מייל לא תקין','card-like':'מספר ארוך בשדה טקסט','bad-sku':'מק"ט לא תקין','bad-cat':'מחלקה לא תקינה'};
const Core={VAT0,KN,FIELDS,guess,decode,parseCsv,headerAt,readRows,num,barcodeOf,phoneOf,tzOf,isOff,build,classify,checkKeys,distinctCats,TPL,ERR,filled};
root.PosImpCore=Core;
if(typeof module!=='undefined'&&module.exports)module.exports=Core;

// ===================== ממשק (רק בתוך האפליקציה) =====================
if(typeof ACT==='undefined'||typeof V==='undefined'||typeof document==='undefined')return;
const fnCall=(n,d)=>{d=d&&typeof d==='object'?d:{};if(SY&&SY.sa&&SY.bizId&&!('bizId'in d))d=Object.assign({bizId:SY.bizId},d);return window.fnCall(n,d)};
const mgr=()=>{try{return isA()||!!(SY&&SY.sa)}catch(e){return false}};
const posOn=()=>{try{return bzF('pos')&&bzB()&&!SY.mg}catch(e){return false}}; // כמו pos-base.js (שלב 0): רק במבנה החדש
const on=()=>mgr()&&posOn()&&bzF('orders')&&wp('ord');
const err=e=>toast(e&&e.message||'הפעולה נכשלה');
const jid=()=>{const a='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',r=new Uint8Array(20);crypto.getRandomValues(r);return[...r].map(x=>a[x%a.length]).join('')};
const dd=t=>{try{return new Date(t).toLocaleString('he-IL',{dateStyle:'short',timeStyle:'short'})}catch(e){return ''}};
const money=v=>typeof ils==='function'?ils(v):'₪'+(+v).toFixed(2);
const I={k:'prod',L:null,cats:[],f:null};
const redraw=()=>{try{if(cur().v==='posImp'&&!document.querySelector('#dlg[open]'))rerender()}catch(e){}};
async function listL(){try{const r=await fnCall('posImpList',{});I.L=r.list||[];I.cats=r.cats||[]}catch(e){I.L=[];err(e)}}

V.posImp=()=>{const T='ייבוא מכספיט';if(!on())return{t:T,h:'<div class="empty">למנהל בלבד, כשהקופה מופעלת בעסק</div>'};
 if(I.L===null){I.L=undefined;listL().then(redraw)}
 const L=I.L||[];
 return{t:T,s:'מוצרים ולקוחות מקובץ Excel / CSV',h:`<div class="card"><p class="note" style="margin-top:0">סדר מומלץ: <b>1. מוצרים</b> ← <b>2. לקוחות</b>. יתרות פתיחה של לקוחות – במסך "ייבוא מתוכנה קודמת" שבהגדרות החשבוניות.</p>
  <p class="note"><b>שום רשומה קיימת לא משתנה.</b> מוצר עם ברקוד שכבר קיים (או בלי ברקוד ועם שם זהה), ולקוח עם טלפון או ת"ז שכבר קיימים – מדלגים עליהם ומציגים "קיים, דילגתי". לפני הייבוא רואים תצוגה מקדימה וספירה.</p>
  <div class="chips">${Object.entries(KN).map(([k,l])=>`<button class="chip ${I.k===k?'on':''}" data-a="piK" data-v="${k}" aria-pressed="${I.k===k}">${l}</button>`).join('')}</div>
  <div class="row" style="margin-top:8px"><button class="btn g grow" data-a="piTpl">קובץ דוגמה</button><label class="btn grow" style="display:flex;align-items:center;justify-content:center">בחירת קובץ (Excel / CSV)<input type="file" accept=".xlsx,.xls,.csv,.txt,text/csv" data-c="piFile" hidden></label></div>
  <p class="note">עברית בקובץ CSV: גם UTF-8 וגם windows-1255 (הקידוד של תוכנות ישנות) מזוהים לבד.</p></div>
  <div class="sec"><h3>יומן ייבוא</h3></div>
  ${I.L===undefined?'<div class="empty">טוען…</div>':L.length?L.map(b=>`<div class="li"><div class="grow"><b>${esc(KN[b.kind]||b.kind)}</b>${b.undone?' <small style="color:var(--bad)">בוטל</small>':''}<br><small class="note">${dd(b.at)} · ${esc(b.file||'')} · ${b.rows} שורות · נוספו ${b.added} · קיימים / כפולים ${b.dup} · שגויים ${b.bad}${b.undone?` · כובו ${b.off}${b.kept?` · נשארו פעילים (נמכרו) ${b.kept}`:''}`:''}</small></div>
   <div style="display:flex;flex-direction:column;gap:4px"><button class="btn g s" data-a="piLog" data-id="${esc(b.id)}">פירוט</button>${b.kind==='prod'&&!b.undone&&b.added?`<button class="btn r s" style="white-space:nowrap" data-a="piUndo" data-id="${esc(b.id)}">ביטול ייבוא</button>`:''}</div></div>`).join(''):'<div class="empty">עוד לא היו ייבואים</div>'}`}};

// כניסה: הגדרות ← "קופה" (מנהל, מתג פעיל). לא במסך הקופה.
{const f=V.settings;if(f)V.settings=function(){const r=f.apply(this,arguments);try{if(r&&r.h&&on()){const b=`<div class="sec"><h3>קופה</h3></div><button class="opt" data-a="go" data-v="posImp"><span>ייבוא מכספיט<small>מוצרים ולקוחות מ-Excel / CSV, עם תצוגה מקדימה וביטול</small></span>${typeof ico==='function'?ico('chev'):''}</button>`;const m='<div class="sec"><h3>נתונים</h3></div>';r.h=r.h.includes(m)?r.h.replace(m,b+m):r.h+b}}catch(e){}return r}}

ACT.piK=el=>{I.k=el.dataset.v==='cust'?'cust':'prod';rerender()};
ACT.piTpl=()=>{const k=I.k;if(typeof xlsOrCsv!=='function')return toast('הורדת הקובץ לא זמינה');
 xlsOrCsv('דוגמה לייבוא מכספיט – '+KN[k],{[KN[k]]:TPL[k],'הסבר':[['קובץ דוגמה – הנתונים מומצאים. מחקו את שורות הדוגמה והכניסו את הנתונים שלכם.'],['השורה הראשונה – כותרות. עמודות מיותרות אפשר להשאיר: במסך ההתאמה בוחרים "לא לייבא".'],
  k==='prod'?['מחיר: בשקלים. במסך ההתאמה בוחרים אם המחיר בקובץ כולל מע"מ או לפני מע"מ. מוצר עם "לא" בעמודת "פעיל" לא מיובא.']:['טלפון או ת"ז – חובה (לפיהם בודקים אם הלקוח כבר קיים).'],
  ['ברקוד ארוך: שמרו את העמודה כטקסט, אחרת Excel עלול להפוך אותו ל-7.29E+12.']]})};

CHG.piFile=async el=>{const f=el.files[0];el.value='';if(!f)return;if(/\.pdf$/i.test(f.name))return toast('רק Excel או CSV');
 try{const rd=readRows(f.name,new Uint8Array(await f.arrayBuffer()),typeof XLSX!=='undefined'?XLSX:null);
  const rows=rd.rows.filter(filled);if(rows.length<2)return toast('אין שורות בקובץ');
  const h=headerAt(rows);const H=(rows[h]||[]).map(x=>txt(x,40));const R=rows.slice(h+1);
  if(!R.length)return toast('אין שורות מתחת לכותרות');
  const used=new Set();const map=H.map(x=>{const g=guess(I.k,x);if(!g||used.has(g))return '';used.add(g);return g});
  I.f={kind:I.k,name:txt(f.name,80),src:rd.src,enc:rd.enc,H,R,first:h+2,map,vatIn:true,rate:VAT0,cats:null};
  if(I.L===null||I.L===undefined)await listL();
  dlg(mapH())}catch(e){err(e)}};
const cell=v=>{const s=txt(v,30);const d=s.replace(/\D/g,'');return /^\d{13,19}$/.test(d)&&!/[A-Za-z֐-׿]/.test(s)&&d.length>14?'****'+d.slice(-4):s};
const mapH=()=>{const P=I.f,s=P.R[0]||[],F=FIELDS[P.kind];
 return `<h3>התאמת עמודות · ${esc(KN[P.kind])} · ${P.R.length} שורות</h3><p class="note" style="margin-top:0">קובץ: ${esc(P.name)}${P.enc&&P.enc!=='xlsx'?` · קידוד: ${esc(P.enc)}`:''}. לכל עמודה – מה היא. בסוגריים: הערך בשורה הראשונה.</p>
 <form data-f="piMapF" style="max-height:55vh;overflow:auto">${P.H.map((h,i)=>`<label class="f"><span>${esc(h||'עמודה '+(i+1))} <small class="note">(${esc(cell(s[i]))})</small></span><select name="m${i}"><option value="">לא לייבא</option>${F.map(([k,l])=>`<option value="${k}"${P.map[i]===k?' selected':''}>${esc(l)}</option>`).join('')}</select></label>`).join('')}
 ${P.kind==='prod'?`<label class="f"><span>"מחיר מכירה" בקובץ</span><select name="vatIn"><option value="1"${P.vatIn?' selected':''}>כולל מע"מ (כמו בקופה)</option><option value="0"${P.vatIn?'':' selected'}>לפני מע"מ – להוסיף מע"מ</option></select></label>
 <label class="f"><span>שיעור מע"מ (%)</span><input name="rate" inputmode="decimal" dir="ltr" value="${P.rate}"></label><p class="note">"מחיר לפני מע"מ" (אם יש עמודה כזו) – תמיד מוסיפים לו מע"מ. באפליקציה המחיר נשמר כולל מע"מ.</p>`:''}
 <div class="row"><button class="btn grow">המשך</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`};
FRM.piMapF=async f=>{const v=fd(f),P=I.f;P.map=P.H.map((h,i)=>v['m'+i]||'');
 const dup=FIELDS[P.kind].map(x=>x[0]).filter(k=>P.map.filter(m=>m===k).length>1);if(dup.length)return toast('כל שדה – עמודה אחת בלבד');
 if(P.kind==='prod'){if(!P.map.includes('name'))return toast('צריך עמודת שם מוצר');if(!P.map.includes('price')&&!P.map.includes('priceEx'))return toast('צריך עמודת מחיר');
  P.vatIn=v.vatIn!=='0';const rt=num(v.rate);if(!Number.isFinite(rt)||rt<0||rt>50)return toast('שיעור מע"מ לא תקין');P.rate=rt;
  const cs=distinctCats(P.R,P.map);if(cs.length){P.cl=cs;return dlg(catH())}P.cats=null;return check()}
 if(!P.map.includes('name')&&!P.map.includes('first'))return toast('צריך עמודת שם');if(!P.map.includes('phone')&&!P.map.includes('tz'))return toast('צריך עמודת טלפון או ת"ז');
 return check()};
// מיפוי מחלקות כספיט ← קטגוריות קיימות (C19-013). ברירת מחדל: קטגוריה קיימת באותו שם, אחרת "חדשה"
const catH=()=>{const P=I.f,C=(I.cats||[]).filter(c=>!c.parent);const byN=new Map(C.map(c=>[txt(c.name,40),c.id]));
 return `<h3>מחלקות → קטגוריות (${P.cl.length})</h3><p class="note" style="margin-top:0">לכל מחלקה מהקובץ: קטגוריה קיימת באפליקציה, או קטגוריה חדשה באותו שם.</p>
 <form data-f="piCatF" style="max-height:55vh;overflow:auto">${P.cl.slice(0,300).map((c,i)=>`<label class="f"><span>${esc(c)}</span><select name="c${i}"><option value="+"${byN.has(c)?'':' selected'}>חדשה: ${esc(c)}</option><option value="-">בלי קטגוריה</option>${C.map(x=>`<option value="${esc(x.id)}"${byN.get(c)===x.id?' selected':''}>${esc(x.name)}</option>`).join('')}</select></label>`).join('')}
 ${P.cl.length>300?`<p class="note">ועוד ${P.cl.length-300} מחלקות – ייווצרו כקטגוריות חדשות באותו שם.</p>`:''}
 <div class="row"><button class="btn grow">המשך לבדיקה</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`};
FRM.piCatF=f=>{const v=fd(f),P=I.f;P.cats={};P.cl.forEach((c,i)=>{const s=i<300?v['c'+i]:'+';P.cats[c]=s==='-'?null:s==='+'||!s?{cat:c}:{cid:s}});return check()};
async function check(){const P=I.f;dlg(`<h3>בודק…</h3><p class="note" id="piPr">בודק כפילויות מול הרשומות הקיימות</p>`);
 try{const list=build(P.kind,P.R,P.map,{vatIn:P.vatIn,rate:P.rate,cats:P.cats},P.first);const keys=checkKeys(P.kind,list);const ex=new Set();
  for(let i=0;i<keys.length;i+=500){const pr=document.getElementById('piPr');if(pr)pr.textContent=`בודק כפילויות… ${Math.min(i+500,keys.length)} / ${keys.length}`;
   const r=await fnCall('posImpCheck',{kind:P.kind,keys:keys.slice(i,i+500)});(r.ex||[]).forEach(x=>ex.add(i+x))}
  P.pv=classify(list,ex);P.job=null;P.done=0;dlg(prevH())}catch(e){closeDlg();err(e)}}
const stTxt={ok:'חדש',dup:'קיים / כפול',bad:'שגוי',off:'לא פעיל'};
const prevH=()=>{const P=I.f,pv=P.pv,R=pv.rows;const nm=x=>x.show?x.show.name:'';
 const sub=x=>!x.show?esc(x.why||''):P.kind==='prod'?[x.show.bc?'<bdi dir="ltr">'+esc(x.show.bc)+'</bdi>':'בלי ברקוד',(x.show.price==null?'חסר מחיר':'<bdi dir="ltr">'+esc(money(x.show.price))+'</bdi>'),x.show.cat?esc(x.show.cat):'',x.warn&&x.st==='ok'?'<b>'+esc(x.why)+'</b>':''].filter(Boolean).join(' · '):'<bdi dir="ltr">'+esc([x.show.ph,x.show.tz].filter(Boolean).join(' · '))+'</bdi>';
 const top=R.slice(0,20).map(x=>`<div style="padding:5px 0;border-bottom:1px solid var(--line);overflow-wrap:anywhere"><small class="note">שורה ${x.n} · <b style="${x.st==='bad'?'color:var(--bad)':''}">${esc(stTxt[x.st]||'')}</b></small><br>${esc(nm(x))}${nm(x)?'<br>':''}<small class="note">${sub(x)}</small></div>`).join('');
 const lst=(st,c)=>{const a=R.filter(x=>x.st===st);return a.slice(0,50).map(x=>`<div class="note" style="padding:3px 0;border-bottom:1px solid var(--line)${c?';color:'+c:''}">שורה ${x.n}${nm(x)?': '+esc(nm(x)):''} – ${esc(x.why||'')}</div>`).join('')+(a.length>50?`<p class="note">ועוד ${a.length-50}…</p>`:'')};
 return `<h3>תצוגה מקדימה · ${esc(KN[P.kind])}</h3>
 <p><b>${pv.add}</b> חדשים · <b>${pv.dup}</b> קיימים / כפולים (ידולגו) · <b style="${pv.bad?'color:var(--bad)':''}">${pv.bad}</b> שגויים${pv.off?` · <b>${pv.off}</b> לא פעילים (לא ייובאו)`:''}</p>${(()=>{const w=R.filter(x=>x.st==='ok'&&x.warn).length;return w?`<p class="note">${w} מהחדשים ייובאו עם סימון (חסר מחיר / ברקוד לבדיקה). הם יופיעו ברשימת ההשלמה במסך המוצרים.</p>`:''})()}
 ${P.kind==='prod'?`<p class="note">המחירים ${P.vatIn?'כוללים מע"מ כמו בקובץ':`הם המחיר בקובץ + ${P.rate}% מע"מ`}.</p>`:''}
 <div style="max-height:42vh;overflow:auto"><h4 style="margin:4px 0">${Math.min(20,R.length)} השורות הראשונות</h4>${top}
 ${pv.dup?`<h4>קיימים / כפולים – לא משתנים</h4>${lst('dup')}`:''}${pv.bad?`<h4 style="color:var(--bad)">שגויים – לא ייובאו</h4>${lst('bad','var(--bad)')}`:''}</div>
 <p class="note">רשומה קיימת לא נדרסת. ${P.kind==='prod'?'אפשר לבטל את הייבוא אחר כך ממסך הייבוא (המוצרים שנוספו ועוד לא נמכרו מכובים, בלי מחיקה).':'לקוחות שנוספו לא מבוטלים אוטומטית – בדקו היטב לפני האישור.'}</p>
 <div class="row"><button class="btn grow" data-a="piGo"${pv.add?'':' disabled'}>ייבא ${pv.add}</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div><p class="note" id="piPr" style="margin:6px 0 0"></p>`};
ACT.piGo=async el=>{const P=I.f;if(!P||!P.pv)return;el.disabled=true;const pr=document.getElementById('piPr');
 const ok=P.pv.rows.filter(x=>x.st==='ok').map(x=>Object.assign({n:x.n},x.row));if(!ok.length)return;
 P.job=P.job||jid();const N=200,tot=P.tot||(P.tot={added:0,dup:0,bad:0});
 try{for(let i=P.done||0;i<ok.length;i+=N){if(pr)pr.textContent=`מייבא… ${Math.min(i+N,ok.length)} / ${ok.length}`;let r;
   for(let k=0;;k++){try{r=await fnCall('posImport',{job:P.job,kind:P.kind,file:P.name,src:P.src,total:ok.length,at:i,rows:ok.slice(i,i+N)});break}catch(e){if(!e.offline||k>=3)throw e;await new Promise(z=>setTimeout(z,1500*(k+1)))}}
   if(!r.again){tot.added+=r.added;tot.dup+=r.dup;tot.bad+=r.bad}P.done=i+N}
  I.f=null;I.L=null;
  dlg(`<h3>הייבוא הסתיים</h3><p><b>${tot.added}</b> ${esc(KN[P.kind])} חדשים · ${tot.dup+P.pv.dup} קיימים / כפולים (דילגתי) · ${tot.bad+P.pv.bad} שגויים${P.pv.off?` · ${P.pv.off} לא פעילים`:''}</p><p class="note">הפירוט נשמר ביומן הייבוא.${P.kind==='prod'?' אפשר לבטל משם את הייבוא.':''}</p><button class="btn w" data-a="closeDlg">סגור</button>`);rerender()}
 catch(e){el.disabled=false;el.textContent='נסה שוב (ממשיך מאיפה שנעצר)';err(e)}}; // אותו job – מנה שכבר נשמרה לא נוצרת פעמיים
ACT.piLog=el=>{const b=(I.L||[]).find(x=>x.id===el.dataset.id);if(!b)return;
 dlg(`<h3>פירוט ייבוא · ${esc(KN[b.kind]||'')}</h3><p class="note" style="margin-top:0">${dd(b.at)} · ${esc(b.file||'')}</p><p>${b.rows} שורות נשלחו · נוספו <b>${b.added}</b> · קיימים / כפולים ${b.dup} · שגויים ${b.bad}</p>
 <div style="max-height:45vh;overflow:auto">${(b.skipped||[]).map(s=>`<div class="note" style="padding:3px 0;border-bottom:1px solid var(--line)">שורה ${s.n} – ${esc(ERR[s.why]||s.why)}</div>`).join('')||'<p class="note">אין שורות שדולגו בשרת.</p>'}</div>
 <p class="note">השורות שסומנו כשגויות / כפולות כבר בתצוגה המקדימה לא נשלחו לשרת ולא מופיעות כאן.</p><button class="btn w" data-a="closeDlg">סגור</button>`)};
ACT.piUndo=el=>{const id=el.dataset.id,b=(I.L||[]).find(x=>x.id===id);if(!b)return;
 ask(`לבטל את ייבוא המוצרים (${b.added} מוצרים)? מוצרים שעוד לא נמכרו יכובו (לא יופיעו למכירה). שום דבר לא נמחק, ומוצר שכבר נמכר נשאר פעיל.`,async()=>{
  try{let left=1,n=0,off=0,kept=0;while(left>0&&n<400){const r=await fnCall('posImpUndo',{job:id});left=r.left;off+=r.off;kept+=r.kept;n++}
   toast(`הייבוא בוטל: כובו ${off}${kept?`, נשארו פעילים ${kept} (נמכרו)`:''}`);I.L=null;rerender()}catch(e){err(e)}},'כן, לבטל')};
// POS:M6 – מקור שורות שאינו קובץ (צילום מחירון – pos-ocr.js): אותה התאמת עמודות, אותה תצוגה מקדימה, ושום מוצר לא נוצר לפני "ייבא"
async function fromRows(name,H,R,src){I.k='prod';const used=new Set();const map=H.map(x=>{const g=guess('prod',x);if(!g||used.has(g))return '';used.add(g);return g});
 I.f={kind:'prod',name:txt(name,80),src:src||'csv',enc:'',H,R,first:2,map,vatIn:true,rate:VAT0,cats:null};if(I.L===null||I.L===undefined)await listL();dlg(mapH())}
window.__posImp={I,Core,fromRows};
})(typeof window!=='undefined'?window:globalThis);
