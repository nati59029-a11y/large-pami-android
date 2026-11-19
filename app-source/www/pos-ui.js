/* POS:M1 – קופה, כלים משותפים לממשק (ש1). נטען לפני pos-pay.js, pos-ret.js, pos-cust.js ו-pos-sale.js.
   כאן גם "מתאמים" לממשקים של מודולים אחרים, שנבנים במקביל: אם המודול האמיתי נטען – משתמשים בו, אחרת בגרסה מדומה:
     PosCfg.get(k)          (ש4) – ברירות המחדל של העסק הנוכחי מתוך האפיון הסופי, פרק 2
     PosPromo.apply(lines)  (ש2) – מדומה: בלי מבצעים (pdisc=0)
     Devices.print / openDrawer (ש7) – מדומה: נרשם בלבד
     PosApprove.ask(o)      (ש5) – אישור אחראי/מנהל (טלפון או PIN). מדומה: חלון אישור בתוך הקופה
   כל הסכומים באגורות. אין כאן שום כתיבה של הגדרות. */
(function(root){
'use strict';
/* ברירות מחדל (אפיון סופי פרק 2) למפתחות שהממשק קורא */
const DEF={
 payOn:['cash','card','check','transfer','bit','paybox','gift','extGift','voucher'],payPrimary:'cash',quickCash:[5000,10000,20000],cashRound:0,
 checkPostdated:true,refReq:['transfer','bit','paybox'],creditOverLimit:'block',partialPay:'debt',payVoidRole:'lead',bigSaleAppr:0,cardMin:0,dupWinMin:10,
 termMode:'manual',txTypes:['reg','inst','defer'],instMax:3,instMinAmt:30000,
 cashMax:600000,cashMaxMode:'warn',
 searchMax:10,searchFuzzy:true,parkMax:0,afterPay:'clean',confirmClearCart:false,uiConfirmDel:true,uiUndoSec:5,
 cashierView:['price','stock','custName','myRep','promo'],dailyGoal:null,lockMin:0,
 discMax:{cashier:0,lead:10},discRoles:'lead',discWhy:['לקוח קבוע','פגם קל','התאמת מחיר','אחר'],
 retDays:14,retNoRcpt:'lead',retNoRcptPrice:'cur',retNoRcptDef:'voucher',retRefundPolicy:{card:['card'],gift:['gift'],'*':['cash','voucher','same']},
 retMgrAbove:20000,retDefective:'exchange',retNeedTag:true,retWhy:['לא מתאים','פגום','שינוי דעה','אחר'],
 rcptPrint:'always',rcptWidth:80,rcptBizFmt:'a4',rcptQr:true,rcptBarcode:true,rcptCashier:'num',giftRcpt:true,
 'bc.unknown':'quickAdd','bc.cashierCreate':'always','bc.beep':true,'bc.partialMin':4,
 'inv.zero':'warn',svcPids:['svcWrap','svcDlv'],freeAmt:true,'cat.favMax':24,kbdKeys:true,beginner:true,
 'bc.prefixes':{gift:'98',cpn:'99',rcpt:'97'}
};
const cfg=k=>{try{if(root.PosCfg&&typeof root.PosCfg.get==='function'){const v=root.PosCfg.get(k);if(v!==undefined)return v}}catch(e){}return DEF[k]};
/* תפקידים: cashier < lead < mgr < own */
const RANK={cashier:0,lead:1,mgr:2,own:3};
const atLeast=(role,need)=>(RANK[role]??0)>=(RANK[need]??9);
const E=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function fmt(a){a=Math.round(+a||0);const neg=a<0;a=Math.abs(a);return(neg?'-':'')+'₪'+String(Math.floor(a/100)).replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.'+String(a%100).padStart(2,'0')}
/* "12" / "12.5" / "₪1,234.50" → אגורות; לא תקין → NaN */
function parseAmt(s){s=String(s==null?'':s).replace(/[₪\s,]/g,'');if(!/^\d+(\.\d{0,2})?$/.test(s)&&!/^\.\d{1,2}$/.test(s))return NaN;const[i,f='']=s.split('.');return(+(i||0))*100+ +(f+'00').slice(0,2)}
const hm=t=>{const d=new Date(t);return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')};
const dmy=t=>{const d=new Date(t);return d.getDate()+'.'+(d.getMonth()+1)+'.'+d.getFullYear()};
const reqId=()=>{try{const a=new Uint8Array(9);root.crypto.getRandomValues(a);return'q'+Array.from(a,b=>b.toString(16).padStart(2,'0')).join('')}catch(e){return'q'+Date.now().toString(36)+Math.random().toString(36).slice(2)}};
const M_NAME={cash:'מזומן',card:'אשראי',check:'צ\'ק',transfer:'העברה בנקאית',bit:'ביט',paybox:'פייבוקס',gift:'כרטיס מתנה',voucher:'פתק זיכוי',extGift:'כרטיס מתנה חיצוני',debt:'הקפה',same:'אותו אמצעי'};

/* ---------- שכבת חלונות בתוך הקופה (dialog משלנו – ה-toast וה-dlg של האפליקציה מתחת לשכבת הקופה) ---------- */
const UI={root:null};
function host(){return UI.root||document.body}
function toast(t,kind){const R=host();R.querySelectorAll('.pos-toast').forEach(x=>x.remove());const e=document.createElement('div');e.className='pos-toast'+(kind?' '+kind:'');e.setAttribute('role','status');e.textContent=t;R.append(e);setTimeout(()=>e.remove(),2600);say(t)}
/* הכרזה לקורא מסך (U10) */
function say(t){const R=host();let a=R.querySelector('#posLive');if(!a){a=document.createElement('div');a.id='posLive';a.className='pos-sr';a.setAttribute('aria-live','polite');R.append(a)}a.textContent='';setTimeout(()=>{a.textContent=t},30)}
/* חלון: html + כפתורים. מחזיר Promise עם ערך הכפתור (או null בסגירה). f(el) – אתחול שדות. כל כפתור עם data-v */
function modal(html,o){o=o||{};return new Promise(res=>{const R=host();const w=document.createElement('div');w.className='pos-modal';w.setAttribute('role','dialog');w.setAttribute('aria-modal','true');if(o.label)w.setAttribute('aria-label',o.label);
 w.innerHTML=`<div class="pos-card${o.cls?' '+o.cls:''}">${html}</div>`;R.append(w);UI.stack.push(w);
 const done=v=>{if(!w.isConnected)return;w.remove();UI.stack=UI.stack.filter(x=>x!==w);res(v)};w._close=()=>done(null);
 w.addEventListener('click',ev=>{const b=ev.target.closest('[data-v]');if(b&&w.contains(b)&&!b.disabled){if(o.check&&b.dataset.v!=='no'){const r=o.check(w,b.dataset.v);if(r===false)return}done(o.read?o.read(w,b.dataset.v):b.dataset.v)}});
 w.addEventListener('submit',ev=>{ev.preventDefault();const b=w.querySelector('[data-v][data-def]');if(b)b.click()});
 if(o.init)o.init(w);const f=w.querySelector('[data-autof]')||w.querySelector('[data-v][data-def]');if(f)try{f.focus({preventScroll:true})}catch(e){}})}
UI.stack=[];
const closeTop=()=>{const w=UI.stack[UI.stack.length-1];if(w){w._close();return true}return false};
const confirmBox=(text,ok,o)=>modal(`<p class="pos-ask">${E(text)}</p><div class="pos-row2"><button class="pos-b g" data-v="no">ביטול</button><button class="pos-b ${o&&o.bad?'bad':''}" data-v="yes" data-def aria-label="${E(ok)}">${E(ok)}</button></div>`,{label:text}).then(v=>v==='yes');

/* ---------- מתאמים למודולים האחרים ---------- */
const Promo={apply(lines,ctx){try{if(root.PosPromo&&typeof root.PosPromo.apply==='function')return root.PosPromo.apply(lines,ctx)}catch(e){}return lines.map(l=>Object.assign({},l,{pdisc:0,promo:null}))}};
const Dev={async print(doc){try{if(root.Devices&&typeof root.Devices.print==='function')return await root.Devices.print(doc)}catch(e){toast('ההדפסה נכשלה – אפשר להדפיס שוב מ"מכירה אחרונה"','bad');return{ok:false}}UI.printed.push(doc);return{ok:true,mock:true}},
 async openDrawer(why){try{if(root.Devices&&typeof root.Devices.openDrawer==='function')return await root.Devices.openDrawer(why)}catch(e){return{ok:false}}UI.drawer.push(why||'');return{ok:true,mock:true}},
 beep(kind){try{if(root.Devices&&typeof root.Devices.beep==='function')return root.Devices.beep(kind)}catch(e){}}};
UI.printed=[];UI.drawer=[];
/* אישור אחראי/מנהל. מחזיר {ok, by}. ש5 (pos-approve.js) מספק אישור בטלפון ו-PIN כגיבוי */
async function approve(o){o=o||{};if(atLeast(o.role,o.need))return{ok:true,by:o.me||'self'};
 try{if(root.PosApprove&&typeof root.PosApprove.ask==='function')return await root.PosApprove.ask(o)}catch(e){return{ok:false}}
 const who=o.need==='mgr'?'מנהל':o.need==='own'?'בעל העסק':'אחראי';
 const ok=await confirmBox(`${o.text||'נדרש אישור'} – נדרש אישור ${who}. (גרסה מדומה: האישור בטלפון / PIN יגיע עם מודול העובדים)`,`אושר ע"י ${who}`);return{ok,by:ok?'mock-'+o.need:null}}

const PosUI={DEF,cfg,RANK,atLeast,E,fmt,parseAmt,hm,dmy,reqId,M_NAME,UI,toast,say,modal,closeTop,confirmBox,Promo,Dev,approve,setRoot:r=>{UI.root=r}};
root.PosUI=PosUI;
if(typeof module!=='undefined'&&module.exports)module.exports=PosUI;
})(typeof window!=='undefined'?window:globalThis);
