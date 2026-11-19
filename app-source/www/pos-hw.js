/* pos-hw.js – קופה, חומרה (17.11.2026): שכבה דקה מעל התוסף LpPos (android-plugin/LpPosPlugin.java).
   window.LpPosHw:
     available()                         -> Promise<bool>  יש תוסף LpPos (ב-APK ישן או בדפדפן: false)
     printer() / setPrinter(p)           הגדרת המדפסת של המכשיר הזה (localStorage 'lp-pos-hw', לא נשמר בענן ולא בנתוני העסק)
        p: {type:'usb'|'bt'|'net'|'mock', width:384|576, drawerPin:2|5, host,port | address | deviceName,vendorId,productId}
     listDevices()                       -> {usb:[], bt:{state,devices:[]}, displays:[], keyboards:[]}
     requestUsb(dev) / requestBt()       הרשאות (USB: אנדרואיד שואל לכל מכשיר; בלוטות': רק באנדרואיד 12 ומעלה)
     print(receipt,{preview}) / printTest()   קבלה = {width?, lines:[...], cut, drawer} – ראו LpPosRender.java. העברית מצוירת כתמונה בטלפון.
     openDrawer()                        פתיחת מגירה דרך המדפסת
     status()                            -> {printer,drawer,scanner,display} כל אחד {state:'ok'|'warn'|'err'|'none'|'unknown', msg}
     onScan(cb) -> off()                 סורק ברקודים במצב מקלדת: תווים מהירים (ברירת מחדל עד 40ms בין תווים) שמסתיימים ב-Enter
     display.info()/show(html)/showCart(cart)/clear()   מסך לקוח שני (Presentation)
     on(name,cb) -> off()                'scan' | 'rejected' | 'change' | 'display' | 'usb'
     openPanel()                         חלון "בדיקת ציוד" (בחירת מדפסת, הדפסת בדיקה, מגירה, סורק, מסך לקוח)
   אין כאן שום טיפול בכרטיסי אשראי: קלט שנראה כמו פס מגנטי או מספר כרטיס נזרק (לא נשמר, לא מועבר, לא מוצג).
   ב-Node: require(...)(root) – לבדיקות עם Capacitor מדומה (tools/pos-hw-test/pos-hw.test.js). */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory;else root.LpPosHw=factory(root)})(typeof self!=='undefined'?self:this,function(root){
'use strict';
const KEY='lp-pos-hw',WIDTHS=[384,576];
const L={};
function on(n,cb){(L[n]=L[n]||[]).push(cb);return()=>{L[n]=(L[n]||[]).filter(f=>f!==cb)}}
function emit(n,d){(L[n]||[]).slice().forEach(f=>{try{f(d)}catch(e){}})}
function plug(){try{const C=root.Capacitor;return C&&C.Plugins&&C.Plugins.LpPos||null}catch(e){return null}}
let avail=null,nativeSubs=false;
function available(){if(avail)return avail;const P=plug();if(!P||typeof P.isAvailable!=='function')return Promise.resolve(false);
 avail=Promise.resolve().then(()=>P.isAvailable()).then(r=>!!(r&&r.ok),()=>false);avail.then(ok=>{if(ok)subNative()});return avail}
function subNative(){const P=plug();if(nativeSubs||!P||typeof P.addListener!=='function')return;nativeSubs=true;
 try{P.addListener('display',d=>emit('display',d));P.addListener('usb',d=>emit('usb',d))}catch(e){}}
function need(){const P=plug();if(!P)throw new Error('אין חיבור לחומרה בגרסה הזו של האפליקציה');return P}

/* ---------- הגדרות המכשיר ---------- */
function cfg(){try{const c=JSON.parse(root.localStorage.getItem(KEY)||'{}');return c&&typeof c==='object'?c:{}}catch(e){return{}}}
function saveCfg(c){try{root.localStorage.setItem(KEY,JSON.stringify(c))}catch(e){}}
const HOST=/^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$|^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
const BTADDR=/^[0-9A-F]{2}(?::[0-9A-F]{2}){5}$/i;
/* מחזיר הגדרה נקייה (רק השדות המותרים) או null */
function cleanPrinter(p){if(!p||typeof p!=='object')return null;
 const o={type:p.type,width:WIDTHS.includes(+p.width)?+p.width:576,drawerPin:+p.drawerPin===5?5:2,name:String(p.name||'').slice(0,60)};
 if(p.type==='net'){const port=p.port==null||p.port===''?9100:+p.port;if(!HOST.test(String(p.host||''))||!(port>=1&&port<=65535&&port%1===0))return null;o.host=String(p.host);o.port=port}
 else if(p.type==='bt'){if(!BTADDR.test(String(p.address||'')))return null;o.address=String(p.address).toUpperCase()}
 else if(p.type==='usb'){if(p.deviceName!=null&&!/^\/dev\/bus\/usb\/\d{3}\/\d{3}$/.test(String(p.deviceName)))return null;
  if(p.deviceName)o.deviceName=String(p.deviceName);if(p.vendorId>=0)o.vendorId=+p.vendorId|0;if(p.productId>=0)o.productId=+p.productId|0}
 else if(p.type!=='mock')return null;
 return o}
function printer(){return cleanPrinter(cfg().printer)}
function setPrinter(p){const c=cfg();if(p==null){delete c.printer}else{const x=cleanPrinter(p);if(!x)throw new Error('הגדרת מדפסת לא תקינה');c.printer=x}
 saveCfg(c);const P=plug();if(P&&P.disconnect)P.disconnect().catch(()=>{});emit('change',{printer:printer()})}
function pDesc(p){if(!p)return'לא נבחרה מדפסת';const w=p.width===384?'58 מ"מ':'80 מ"מ';
 return(p.type==='net'?'רשת '+p.host+':'+p.port:p.type==='bt'?'בלוטות\' '+(p.name||p.address):p.type==='usb'?'USB '+(p.name||''):'מדפסת מדומה (בלי חומרה)')+' · '+w}

/* ---------- מכשירים והרשאות ---------- */
async function listDevices(){return need().listDevices()}
async function requestUsb(d){d=d||{};return need().requestUsbPermission({deviceName:d.deviceName,vendorId:d.vendorId,productId:d.productId})}
async function requestBt(){return need().requestBtPermission()}

/* ---------- הדפסה ---------- */
async function print(receipt,o){o=o||{};const P=need(),p=o.printer!==undefined?o.printer:printer();
 if(!p&&!o.previewOnly)throw new Error('לא נבחרה מדפסת');
 return P.print({printer:o.previewOnly?{type:'none',width:(p&&p.width)||576}:p,receipt,preview:!!o.preview})}
async function openDrawer(){const P=need(),p=printer();if(!p)throw new Error('לא נבחרה מדפסת');return P.openDrawer({printer:p,pin:p.drawerPin})}
function nowStr(d){d=d||new Date();const z=n=>String(n).padStart(2,'0');return z(d.getDate())+'/'+z(d.getMonth()+1)+'/'+d.getFullYear()+' '+z(d.getHours())+':'+z(d.getMinutes())}
/* קבלת בדיקה: עברית, עמודות, לוגו, ברקוד ו-QR. logo = data:image/png;base64,... (לא חובה) */
function testReceipt(o){o=o||{};const lines=[];
 if(o.logo)lines.push({t:'image',data:o.logo,w:.35});
 lines.push({t:'text',text:o.title||'לארג\' פעמי',align:'center',size:2,bold:true},{t:'text',text:'בדיקת מדפסת – לא קבלה',align:'center'},{t:'text',text:nowStr(o.date),align:'center'},{t:'line'},
  {t:'cols',bold:true,cols:[{text:'פריט',w:.55},{text:'כמות',w:.15,align:'center'},{text:'סה"כ',w:.3,align:'left'}]},
  {t:'cols',cols:[{text:'לחם אחיד פרוס',w:.55},{text:'2',w:.15,align:'center'},{text:'₪13.80',w:.3,align:'left'}]},
  {t:'cols',cols:[{text:'Coffee 200g',w:.55},{text:'1',w:.15,align:'center'},{text:'₪24.90',w:.3,align:'left'}]},
  {t:'line'},{t:'cols',size:2,bold:true,cols:[{text:'לתשלום',w:.5},{text:'₪38.70',w:.5,align:'left'}]},{t:'line'},
  {t:'barcode',data:'LP-TEST-1234',format:'CODE128',h:70},{t:'qr',data:'LP-TEST '+nowStr(o.date),size:.4},
  {t:'text',text:'אבגדהוזחטיכלמנסעפצקרשת 0123456789',align:'right'},{t:'text',text:'מרכז',align:'center'},{t:'text',text:'שמאל',align:'left'});
 return{lines,cut:true,drawer:!!o.drawer}}
async function appLogo(){try{const r=await root.fetch('icon-192.png');if(!r.ok)return null;const b=await r.blob();
 return await new Promise(ok=>{const f=new root.FileReader();f.onload=()=>ok(String(f.result||'')||null);f.onerror=()=>ok(null);f.readAsDataURL(b)})}catch(e){return null}}
async function printTest(o){o=o||{};return print(testReceipt({logo:await appLogo(),drawer:o.drawer}),{preview:true,printer:o.printer})}

/* ---------- סורק ברקודים במצב מקלדת ---------- */
/* כרטיס אשראי: פס מגנטי (track 1/2) או 15–19 ספרות שעוברות בדיקת Luhn ומתחילות ב-3/4/5/6. לא נשמר, לא מועבר. */
function luhn(s){let sum=0,alt=false;for(let i=s.length-1;i>=0;i--){let n=s.charCodeAt(i)-48;if(alt){n*=2;if(n>9)n-=9}sum+=n;alt=!alt}return sum%10===0}
function looksLikeCard(s){s=String(s||'');if(/^%B\d{8,19}\^/.test(s)||/^;\d{8,19}=/.test(s)||/^%?B?\d{12,19}[\^=]/.test(s))return true;
 return/^[3-6]\d{14,18}$/.test(s)&&luhn(s)}
function ScanDetector(o){o=o||{};const maxGap=o.maxGap||40,minLen=o.minLen||4,maxLen=o.maxLen||128;let buf='',t0=0,last=0;
 function reset(){buf='';t0=0;last=0}
 /* key = KeyboardEvent.key, t = זמן במילישניות. מחזיר {code,ms} בסיום סריקה, {rejected:'card'} לכרטיס, אחרת null */
 function feed(key,t){
  if(key==='Enter'||key==='Tab'){const ok=buf.length>=minLen&&t-last<=maxGap*3;const code=buf,ms=last-t0;reset();if(!ok)return null;
   if(looksLikeCard(code))return{rejected:'card'};return{code,ms}}
  if(typeof key!=='string'||key.length!==1)return null; /* Shift, Control וכו' – לא שוברים רצף */
  if(buf&&t-last>maxGap)reset();
  if(!buf)t0=t;buf+=key;last=t;if(buf.length>maxLen)reset();return null}
 return{feed,reset,startsNew:t=>!buf||t-last>maxGap,get pending(){return buf.length}}}
let det=null,scanSubs=0,snap=null,lastScan=null,keyH=null;
function isField(el){return el&&(el.tagName==='INPUT'||el.tagName==='TEXTAREA')}
function onScan(cb,o){o=o||{};const off=on('scan',cb);scanSubs++;
 if(!keyH&&root.document){det=ScanDetector(Object.assign({},cfg().scan||{},o));
  keyH=e=>{if(e.ctrlKey||e.altKey||e.metaKey)return;const t=e.timeStamp||Date.now();
   if(e.key&&e.key.length===1&&det.startsNew(t)){const el=e.target;snap=isField(el)?{el,v:el.value}:null}
   const r=det.feed(e.key,t);if(!r)return;e.preventDefault();e.stopPropagation();
   /* התווים של הסריקה כבר נכנסו לשדה שהיה בפוקוס: מחזירים את הערך הקודם, אלא אם השדה ביקש לשמור (data-pos-scan="keep") */
   if(snap&&snap.el&&!(snap.el.dataset&&snap.el.dataset.posScan==='keep')){try{snap.el.value=snap.v}catch(_){}}
   const target=snap&&snap.el||null;snap=null;
   if(r.rejected){emit('rejected',{reason:r.rejected});return}
   lastScan={at:Date.now(),ms:r.ms,len:r.code.length};emit('scan',{code:r.code,ms:r.ms,target})};
  root.document.addEventListener('keydown',keyH,true)}
 let done=false;return()=>{if(done)return;done=true;off();if(--scanSubs<=0&&keyH){root.document.removeEventListener('keydown',keyH,true);keyH=null;det=null;scanSubs=0}}}

/* ---------- מסך לקוח ---------- */
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>{const v=Number(n);return Number.isFinite(v)?'₪'+v.toFixed(2):''};
/* cart: {title, lines:[{name,qty,price}], total, msg} -> HTML בלי סקריפטים (המסך השני מציג עם JS כבוי) */
function cartHtml(c){c=c||{};const rows=(Array.isArray(c.lines)?c.lines:[]).slice(-12).map(l=>'<tr><td>'+esc(l.name)+'</td><td class=q>'+esc(l.qty!=null?l.qty:'')+'</td><td class=p>'+money(l.price)+'</td></tr>').join('');
 return'<!doctype html><html dir=rtl lang=he><head><meta charset=utf-8><meta name=viewport content="width=device-width"><style>'+
 'body{margin:0;font-family:sans-serif;background:#fff;color:#111;display:flex;flex-direction:column;height:100vh}h1{margin:0;padding:16px 24px;background:#1f4e79;color:#fff;font-size:5vh}'+
 'table{width:100%;border-collapse:collapse;font-size:4vh}td{padding:1vh 24px;border-bottom:1px solid #ddd}.q{text-align:center;width:15%}.p{text-align:left;width:25%;direction:ltr}'+
 '.list{flex:1;overflow:hidden}.tot{display:flex;justify-content:space-between;padding:2vh 24px;font-size:8vh;font-weight:bold;background:#f2f2f2}.tot b{direction:ltr}.msg{padding:1vh 24px 2vh;font-size:4vh;text-align:center}'+
 '</style></head><body><h1>'+esc(c.title||'ברוכים הבאים')+'</h1><div class=list><table>'+rows+'</table></div>'+
 (c.total!=null?'<div class=tot><span>סה"כ</span><b>'+money(c.total)+'</b></div>':'')+(c.msg?'<div class=msg>'+esc(c.msg)+'</div>':'')+'</body></html>'}
const display={info:async()=>{const P=plug();if(!P)return{available:false,displays:[],showing:false};return P.displayInfo()},
 show:async html=>{const P=plug();if(!P)return{shown:false};return P.displayShow({html:String(html||'')})},
 showCart:async c=>display.show(cartHtml(c)),
 clear:async()=>{const P=plug();if(P)return P.displayClear()}};

/* ---------- מצב כל רכיב ---------- */
function agoStr(ms){const s=Math.round(ms/1000);return s<60?'לפני '+s+' שניות':'לפני '+Math.round(s/60)+' דקות'}
function printerState(p,st){
 if(!p)return{state:'none',msg:'לא נבחרה מדפסת'};
 if(!st||!st.connected)return{state:'err',msg:'אין חיבור למדפסת'+(st&&st.error?' ('+String(st.error).slice(0,80)+')':'')};
 if(st.paperOut)return{state:'err',msg:'נגמר הנייר'};
 if(st.coverOpen)return{state:'err',msg:'המכסה פתוח'};
 if(st.online===false)return{state:'err',msg:'המדפסת לא מוכנה (שגיאה או לא מקוונת)'};
 if(st.paperLow)return{state:'warn',msg:'הנייר עומד להיגמר'};
 if(!st.answered)return{state:'ok',msg:'מחוברת (המדפסת לא מדווחת על נייר ומכסה)'};
 return{state:'ok',msg:'מחוברת ומוכנה'}}
async function status(){const P=plug(),p=printer(),out={native:!!P};
 if(!P){const m={state:'err',msg:'אין חיבור לחומרה בגרסה הזו של האפליקציה'};return Object.assign(out,{printer:m,drawer:m,scanner:scanState(null),display:{state:'none',msg:'אין מסך לקוח'}})}
 let st=null;if(p){try{st=await P.printerStatus({printer:p,timeoutMs:700})}catch(e){st={connected:false,error:e&&e.message}}}
 out.printer=printerState(p,st);
 out.drawer=!p?{state:'none',msg:'המגירה נפתחת דרך המדפסת – בחרו מדפסת'}:out.printer.state==='err'?{state:'err',msg:'המגירה נפתחת דרך המדפסת, והמדפסת לא זמינה'}:
  {state:'ok',msg:'מוכנה (נפתחת דרך המדפסת, פין '+p.drawerPin+')'+(st&&st.drawerOpen!=null?(' · חיישן: '+(st.drawerOpen?'פין גבוה':'פין נמוך')):'')};
 let dev=null;try{dev=await P.listDevices()}catch(e){}
 out.scanner=scanState(dev);
 let di=null;try{di=await P.displayInfo()}catch(e){}
 out.display=di&&di.available?{state:'ok',msg:(di.showing?'מוצג על ':'מחובר: ')+((di.displays[0]||{}).name||'מסך שני')}:{state:'none',msg:'לא מחובר מסך לקוח'};
 return out}
function scanState(dev){if(lastScan)return{state:'ok',msg:'נקלטה סריקה '+agoStr(Date.now()-lastScan.at)+' ('+lastScan.len+' תווים, '+Math.round(lastScan.ms)+'ms)'};
 const k=dev&&Array.isArray(dev.keyboards)?dev.keyboards:[];
 if(k.length)return{state:'warn',msg:'מחובר: '+k.map(x=>x.name).slice(0,2).join(', ')+' – סרקו ברקוד לבדיקה'};
 return{state:'unknown',msg:'סרקו ברקוד כדי לבדוק את הסורק'}}

/* ---------- חלון "בדיקת ציוד" ---------- */
let panel=null;
function openPanel(){const d=root.document;if(!d)return;if(panel){panel.remove();panel=null}
 const box=d.createElement('div');panel=box;box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');box.setAttribute('aria-label','בדיקת ציוד קופה');box.dir='rtl';
 box.style.cssText='position:fixed;inset:0;z-index:9999;background:var(--bg,#fff);color:var(--fg,#111);overflow:auto;padding:12px 16px 40px;font-size:16px';
 const btn='style="margin:4px 0 4px 6px;padding:10px 14px;border-radius:10px;border:1px solid #8884;background:var(--card,#f4f4f4);color:inherit;font:inherit"';
 const dot={ok:'#2e7d32',warn:'#ed6c02',err:'#c62828',none:'#888',unknown:'#888'},lbl={ok:'תקין',warn:'לבדיקה',err:'תקלה',none:'לא מוגדר',unknown:'לא ידוע'};
 const offs=[];let busy=false;
 function close(){offs.forEach(f=>f());box.remove();if(panel===box)panel=null}
 function row(t,s){return'<div style="display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px solid #8883"><span aria-hidden=true style="flex:none;width:14px;height:14px;border-radius:7px;margin-top:4px;background:'+dot[s.state]+'"></span><div><b>'+t+'</b> – '+lbl[s.state]+'<div style="opacity:.8;font-size:14px">'+esc(s.msg)+'</div></div></div>'}
 async function check(){const s=box.querySelector('#phSum');s.textContent='בודק…';try{const r=await status();s.innerHTML=row('מדפסת קבלות',r.printer)+row('מגירת כסף',r.drawer)+row('סורק ברקודים',r.scanner)+row('מסך לקוח',r.display)}catch(e){s.textContent='הבדיקה נכשלה: '+(e&&e.message||e)}}
 function msg(t){box.querySelector('#phMsg').textContent=t}
 async function act(f){if(busy)return;busy=true;try{await f()}catch(e){msg('שגיאה: '+(e&&e.message||e))}finally{busy=false}}
 function render(){const p=printer();
  box.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center"><h2 style="margin:8px 0">בדיקת ציוד קופה</h2><button data-k=close '+btn+'>סגירה</button></div>'+
  '<div id=phSum aria-live=polite></div><button data-k=check '+btn+'>בדיקה מחדש</button>'+
  '<h3>מדפסת קבלות</h3><div>'+esc(pDesc(p))+'</div>'+
  '<button data-k=find '+btn+'>חיפוש מדפסות (USB ובלוטות\')</button><button data-k=net '+btn+'>מדפסת רשת (IP)</button><button data-k=mock '+btn+'>מדפסת מדומה</button>'+
  (p?'<div>רוחב נייר: <button data-k=w58 '+btn+'>'+(p.width===384?'✓ ':'')+'58 מ"מ</button><button data-k=w80 '+btn+'>'+(p.width===576?'✓ ':'')+'80 מ"מ</button></div>'+
   '<div>מגירה: <button data-k=pin2 '+btn+'>'+(p.drawerPin===2?'✓ ':'')+'פין 2</button><button data-k=pin5 '+btn+'>'+(p.drawerPin===5?'✓ ':'')+'פין 5</button></div>'+
   '<button data-k=test '+btn+'>הדפסת קבלת בדיקה</button><button data-k=drawer '+btn+'>פתיחת מגירה</button><button data-k=forget '+btn+'>ביטול המדפסת</button>':'')+
  '<div id=phDev></div><div id=phMsg aria-live=polite style="margin:8px 0;font-weight:bold"></div><div id=phPrev></div>'+
  '<h3>סורק ברקודים</h3><div>סרקו ברקוד כשהחלון פתוח (הסורק במצב מקלדת, עם Enter בסוף).</div><div id=phScan aria-live=polite style="font-size:20px;margin:6px 0">—</div>'+
  '<h3>מסך לקוח</h3><button data-k=dshow '+btn+'>הצגת בדיקה במסך הלקוח</button><button data-k=dclear '+btn+'>ניקוי מסך הלקוח</button>';
  check()}
 async function find(){const r=await listDevices(),el=box.querySelector('#phDev');let h='';
  const usb=(r.usb||[]).filter(u=>u.canPrint);
  h+='<h4>USB</h4>'+(usb.length?usb.map((u,i)=>'<button data-k=usb data-i='+i+' '+btn+'>'+esc(u.name)+(u.isPrinter?' (מדפסת)':'')+(u.hasPermission?'':' – דרוש אישור')+'</button>').join(''):'<div>לא נמצא מכשיר USB מתאים. חברו את המדפסת בכבל OTG.</div>');
  const bt=r.bt||{};h+='<h4>בלוטות\' (מכשירים מצומדים)</h4>';
  if(bt.state==='ok'){const ds=(bt.devices||[]).slice().sort((a,b)=>(b.maybePrinter?1:0)-(a.maybePrinter?1:0));h+=ds.length?ds.map((x,i)=>'<button data-k=bt data-i='+i+' '+btn+'>'+esc(x.name)+(x.maybePrinter?' (מדפסת?)':'')+'</button>').join(''):'<div>אין מכשירים מצומדים. צמדו את המדפסת בהגדרות הבלוטות\' של הטלפון.</div>';box._bt=ds}
  else if(bt.state==='off')h+='<div>הבלוטות\' כבוי.</div>';else if(bt.state==='none')h+='<div>אין בלוטות\' בטלפון.</div>';
  else h+='<button data-k=btperm '+btn+'>אישור גישה לבלוטות\'</button>';
  box._usb=usb;el.innerHTML=h}
 box.addEventListener('click',e=>{const b=e.target.closest('[data-k]');if(!b)return;const k=b.dataset.k,p=printer();
  if(k==='close')return close();if(k==='check')return act(check);
  if(k==='find')return act(find);
  if(k==='btperm')return act(async()=>{await requestBt();await find()});
  if(k==='usb')return act(async()=>{const u=box._usb[+b.dataset.i];if(!u)return;if(!u.hasPermission){const g=await requestUsb(u);if(!g||!g.granted)return msg('לא אושרה גישה ל-USB')}
   setPrinter({type:'usb',deviceName:u.deviceName,vendorId:u.vendorId,productId:u.productId,name:u.name,width:p?p.width:576});render();msg('נבחרה מדפסת USB')});
  if(k==='bt')return act(async()=>{const x=box._bt[+b.dataset.i];if(!x)return;setPrinter({type:'bt',address:x.address,name:x.name,width:p?p.width:576});render();msg('נבחרה מדפסת בלוטות\'')});
  if(k==='net')return act(async()=>{const h=(root.prompt('כתובת IP של המדפסת (לדוגמה 192.168.1.50):',p&&p.host||'')||'').trim();if(!h)return;
   const port=(root.prompt('פורט (בדרך כלל 9100):',String(p&&p.port||9100))||'9100').trim();setPrinter({type:'net',host:h,port:+port,width:p?p.width:576});render();msg('נבחרה מדפסת רשת')});
  if(k==='mock')return act(async()=>{setPrinter({type:'mock',width:p?p.width:576});render();msg('נבחרה מדפסת מדומה – ההדפסה מוצגת כתמונה בלבד')});
  if(k==='forget')return act(async()=>{setPrinter(null);render()});
  if(/^w(58|80)$/.test(k)&&p)return act(async()=>{setPrinter(Object.assign({},p,{width:k==='w58'?384:576}));render()});
  if(/^pin[25]$/.test(k)&&p)return act(async()=>{setPrinter(Object.assign({},p,{drawerPin:k==='pin5'?5:2}));render()});
  if(k==='test')return act(async()=>{msg('מדפיס…');const r=await printTest();msg('הודפס ('+r.bytes+' בתים, '+r.ms+'ms)');
   const pv=box.querySelector('#phPrev');pv.innerHTML='';if(r.preview){const im=d.createElement('img');im.alt='תצוגת הקבלה';im.src='data:image/png;base64,'+r.preview;im.style.cssText='max-width:100%;border:1px solid #8886;background:#fff';pv.append(im)}check()});
  if(k==='drawer')return act(async()=>{await openDrawer();msg('נשלחה פקודת פתיחה למגירה')});
  if(k==='dshow')return act(async()=>{const r=await display.showCart({title:'בדיקת מסך לקוח',lines:[{name:'לחם אחיד פרוס',qty:2,price:13.8},{name:'Coffee 200g',qty:1,price:24.9}],total:38.7,msg:'תודה ולהתראות'});msg(r&&r.shown?'מוצג במסך הלקוח':'לא נמצא מסך לקוח')});
  if(k==='dclear')return act(async()=>{await display.clear();msg('מסך הלקוח נוקה');check()})});
 offs.push(onScan(s=>{const el=box.querySelector('#phScan');if(el)el.textContent=s.code+'  ('+Math.round(s.ms)+'ms)';check()}));
 offs.push(on('rejected',()=>{const el=box.querySelector('#phScan');if(el)el.textContent='נקלט קלט שנראה כמו כרטיס אשראי – נזרק ולא נשמר'}));
 offs.push(on('display',()=>check()),on('usb',()=>check()));
 available();d.body.append(box);render()}

/* הכניסה לחלון: באזור הניהול בלבד (pos-admin-hw.js, מסך "ציוד ומכשירים"). במסך הקופה אין הגדרות (אפיון 1.3). */
/* רטט (P9): קודם התוסף (navigator.vibrate לא עובד בכל WebView), ואם אין – navigator.vibrate */
async function vibrate(ms){ms=Math.max(10,Math.min(1000,+ms||40));const P=plug();if(P&&typeof P.vibrate==='function'){try{const r=await P.vibrate({ms});if(r&&r.ok)return true}catch(e){}}
 try{return!!(root.navigator&&root.navigator.vibrate&&root.navigator.vibrate(ms))}catch(e){return false}}
return{available,plug,vibrate,printer,setPrinter,cleanPrinter,pDesc,listDevices,requestUsb,requestBt,print,printTest,testReceipt,openDrawer,status,printerState,
 onScan,ScanDetector,looksLikeCard,display,cartHtml,on,openPanel}});
