/* POS:M7 – pos-devices.js (קופה, ש7: חומרה ומכשירים, 17.11.2026). הממשק שכל מודולי הקופה משתמשים בו לציוד: window.Devices.
   מעל LpPosHw (pos-hw.js ← התוסף LpPos). במחשב (דפדפן): pos-hw-web.js – מדפסת Windows ('win') או כבל Serial ('serial'), כולל קבלה בשורות ומגירה.
   בדפדפן בלי מדפסת מוגדרת: תמונת קבלה (job.img) נפתחת בחלון ההדפסה (גיבוי, כמו קודם). 'win' = "נשלח למדפסת" – Windows לא מדווח אם הנייר יצא (via:'win').
     Devices.print(job,o)    -> {ok:true,via} | {ok:false,code,msg,queued}
        job: {id, img:'data:image/png;base64,...'} (תמונת קבלה מ-pos-receipt.js) או {id, receipt:{lines,...}} (LpPosRender.java)
        קודים: PAPER_OUT (נגמר נייר / מכסה פתוח), OFFLINE (המדפסת לא זמינה), NO_PRINTER (לא נבחרה), ERROR.
        כשלון = הקבלה נשמרת בתור lp-pos-prnq ("ממתינה להדפסה"), והמכירה עצמה לא נעצרת (אפיון ד H7). אין הצלחה "עיוורת" (P3).
     Devices.reprint(id?)    הדפס שוב: הקבלה מהתור (או האחרונה). כל הדפסה חוזרת יוצאת באירוע 'reprint' (למודול שכותב ל-poslog).
     Devices.queue() / retryQueue()   התור ממתין להדפסה; retryQueue מדפיס לפי הסדר ועוצר בכשלון הראשון.
     Devices.openDrawer(reason)  reason: 'cash' (סיום מזומן) | 'noSale' (ללא מכירה) | 'test'. אירוע 'drawer' לכל פתיחה (ל-poslog, H8).
     Devices.onScan(cb) / showCustomer(cart) / clearCustomer() / beep(kind) / vibrate(ms)
     Devices.msg(code)       הודעה לקופאי בעברית פשוטה (רק כשפעולה נכשלה – הקופאי לא רואה מצב ציוד קבוע, H18).
     Devices.state()         מצב הקופה מהשרת: 'ok' | 'pending' (מחכה לאישור מכשיר) | 'off' (מושבתת / נותקה מרחוק) | 'retired' | 'none'
     Devices.blocked()       true = אסור למכור במכשיר הזה (נותק מרחוק / מושבת / פרש / מחכה לאישור).
     Devices.on(name,cb)     'prn' (התור השתנה), 'reprint', 'drawer', 'state', 'hw' (מצב הציוד השתנה), 'scan'
   מצב הציוד מדווח לשרת (posOps op:'hw') רק מקופה רשומה: בכל שינוי ולפחות כל 5 דקות, כדי שהמנהל יראה "מדפסת מנותקת" תוך 30 שניות.
   אין כאן שום טיפול בכרטיסי אשראי. ב-Node: require(...)(root) – לבדיקות (tools/pos-hw-test/pos-devices.test.js). */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory;else root.Devices=factory(root)})(typeof self!=='undefined'?self:this,function(root){
'use strict';
const QKEY='lp-pos-prnq',QMAX=50,QCHARS=3000000,LASTKEY='lp-pos-prnlast',POLL_MS=20000,REPORT_MS=5*60000,DEVPOLL_MS=60000;
const L={};
function on(n,cb){(L[n]=L[n]||[]).push(cb);return()=>{L[n]=(L[n]||[]).filter(f=>f!==cb)}}
function emit(n,d){(L[n]||[]).slice().forEach(f=>{try{f(d)}catch(e){}})}
const HW=()=>root.LpPosHw||null;
const ls=(k,v)=>{try{const s=root.localStorage;if(v===undefined)return s.getItem(k);if(v===null)s.removeItem(k);else s.setItem(k,v)}catch(e){return null}};
const now=()=>Date.now();
/* SY ו-APP_VC מוגדרים ב-index.html עם let/const – לא מאפיינים של window */
const gSY=()=>{try{return typeof SY!=='undefined'?SY:root.SY}catch(e){return root.SY}};
const gVC=()=>{try{return typeof APP_VC!=='undefined'?APP_VC:root.APP_VC}catch(e){return root.APP_VC}};
/* הגדרות העסק (poscfg) – דרך PosCfg של ש4 כשקיים, אחרת ברירות המחדל של האפיון */
const DEF={hwAutoCut:true,hwPaperOut:'reprint',hwDrawer:true,rcptPrint:'always',bc_beep:true,sndUnknown:true,sndDone:true,vibrate:true};
function cfg(k){try{const C=root.PosCfg;if(C&&typeof C.get==='function'){const v=C.get(k);if(v!==undefined&&v!==null)return v}}catch(e){}return DEF[k.replace('.','_')]}

/* ---------- הודעות לקופאי (אפיון ד 3.1) ---------- */
const MSG={PAPER_OUT:'נגמר הנייר – החליפו גליל ולחצו "הדפס שוב"',OFFLINE:'המדפסת לא מחוברת – בדקו את הכבל או את החיבור ולחצו "הדפס שוב"',
 NO_PRINTER:'לא נבחרה מדפסת במכשיר הזה – המנהל בוחר אותה באזור הניהול',ERROR:'ההדפסה נכשלה – לחצו "הדפס שוב"',NO_DRAWER:'אין מגירה מחוברת למכשיר הזה',
 BLOCKED:'המכשיר הזה לא מאושר למכירה – פנו למנהל'};
const msg=c=>MSG[c]||MSG.ERROR;
function codeOf(e){const c=e&&(e.code||e.errorCode);return['PAPER_OUT','OFFLINE','NO_PRINTER','ERROR'].includes(c)?c:/no printer chosen|לא נבחרה מדפסת/i.test(String(e&&e.message||''))?'NO_PRINTER':'ERROR'}

/* ---------- תור "ממתין להדפסה" (lp-pos-prnq) ---------- */
function qRead(){try{const a=JSON.parse(ls(QKEY)||'[]');return Array.isArray(a)?a.filter(x=>x&&typeof x.id==='string'&&x.job):[]}catch(e){return[]}}
function qWrite(a){let s=JSON.stringify(a);while(a.length>1&&(a.length>QMAX||s.length>QCHARS)){a.shift();s=JSON.stringify(a)}ls(QKEY,a.length?s:null);emit('prn',{n:a.length})}
function qPut(job,code){const a=qRead().filter(x=>x.id!==job.id);a.push({id:job.id,job,code,at:now(),tries:1});qWrite(a)}
function qDrop(id){const a=qRead(),b=a.filter(x=>x.id!==id);if(b.length!==a.length)qWrite(b)}
function queue(){return qRead().map(x=>({id:x.id,code:x.code,at:x.at,tries:x.tries||1,msg:msg(x.code)}))}
const cleanId=v=>String(v==null?'':v).replace(/[^\w.:-]/g,'').slice(0,80)||('r'+now());

/* ---------- הדפסה ---------- */
function receiptOf(job){
 if(job.receipt&&typeof job.receipt==='object'){const r=Object.assign({},job.receipt);if(r.cut===undefined)r.cut=!!cfg('hwAutoCut');return r}
 if(typeof job.img==='string'&&/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(job.img))return{lines:[{t:'image',data:job.img,w:1}],cut:!!cfg('hwAutoCut'),dither:false};
 return null}
/* גיבוי במחשב בלי מדפסת מוגדרת: התמונה נפתחת בחלון ההדפסה (בלי חיתוך מובטח, בלי מגירה – אפיון ד "פתוח" 1) */
function browserPrint(job){const d=root.document;if(!d||!d.body||typeof job.img!=='string')return false;
 const f=d.createElement('iframe');f.setAttribute('aria-hidden','true');f.style.cssText='position:fixed;width:0;height:0;border:0;left:-9999px';d.body.append(f);
 const w=f.contentWindow;if(!w){f.remove();return false}
 w.document.open();w.document.write('<!doctype html><html><head><meta charset="utf-8"><style>@page{margin:0}body{margin:0}img{width:100%}</style></head><body></body></html>');w.document.close();
 const im=w.document.createElement('img');im.src=job.img;w.document.body.append(im);
 const go=()=>{try{w.focus();w.print()}catch(e){}setTimeout(()=>f.remove(),60000)};if(im.complete)go();else im.onload=go;return true}
let printing=Promise.resolve();
/* כל ההדפסות אחת אחרי השנייה (לא שתי קבלות מעורבבות על אותה מדפסת) */
function serial(fn){const r=printing.then(fn,fn);printing=r.catch(()=>{});return r}
async function rawPrint(job){
 const H=HW();
 if(!H||!(await H.available())){if(browserPrint(job))return{ok:true,via:'browser'};return{ok:false,code:'NO_PRINTER'}}
 if(!H.printer()){if(H.web&&H.web()&&browserPrint(job))return{ok:true,via:'browser'};return{ok:false,code:'NO_PRINTER'}}
 const rc=receiptOf(job);if(!rc)return{ok:false,code:'ERROR',msg:'קבלה לא תקינה'};
 /* בדפדפן עם מדפסת 'win': ok = הקבלה נשלחה ל-Windows; אין דרך לדעת שהודפסה בפועל (via:'win') */
 try{const r=await H.print(rc,{});return r&&r.printed===false?{ok:false,code:'NO_PRINTER'}:{ok:true,via:(r&&r.via)||'printer',paperLow:!!(r&&r.paperLow)}}
 catch(e){return{ok:false,code:codeOf(e)}}}
async function print(job,o){o=o||{};if(!job||typeof job!=='object')throw new Error('job');
 const j=Object.assign({},job,{id:cleanId(job.id)});
 return serial(async()=>{const r=await rawPrint(j);
  if(r.ok){qDrop(j.id);ls(LASTKEY,JSON.stringify(j).length<QCHARS?JSON.stringify(j):null);if(r.paperLow)hwChanged({printer:'low'});else hwChanged({printer:'ok'});return r}
  hwChanged({printer:r.code==='PAPER_OUT'?'paper':r.code==='NO_PRINTER'?'none':'off'});
  if(o.queue!==false&&j.kind!=='test'){qPut(j,r.code);return Object.assign({},r,{msg:r.msg||msg(r.code),queued:true})}
  return Object.assign({},r,{msg:r.msg||msg(r.code),queued:false})})}
async function reprint(id){const q=qRead();let it=id?q.find(x=>x.id===id):q[0];
 if(!it){if(id)return{ok:false,code:'ERROR',msg:'הקבלה לא נמצאה'};try{const l=JSON.parse(ls(LASTKEY)||'null');if(l&&l.id)it={id:l.id,job:l,last:true}}catch(e){}}
 if(!it)return{ok:false,code:'ERROR',msg:'אין קבלה להדפסה חוזרת'};
 const r=await serial(()=>rawPrint(it.job));
 if(r.ok){qDrop(it.id);if(!it.last){const js=JSON.stringify(it.job);ls(LASTKEY,js.length<QCHARS?js:null)}emit('reprint',{id:it.id,last:!!it.last,at:now()});hwChanged({printer:'ok'});return r}
 const a=qRead();const x=a.find(y=>y.id===it.id);if(x){x.code=r.code;x.tries=(x.tries||1)+1;qWrite(a)}
 hwChanged({printer:r.code==='PAPER_OUT'?'paper':'off'});
 return Object.assign({},r,{msg:msg(r.code)})}
async function retryQueue(){let done=0;for(const it of qRead()){const r=await reprint(it.id);if(!r.ok)return{done,left:qRead().length,code:r.code};done++}return{done,left:0}}

/* ---------- מגירה (דרך המדפסת) ---------- */
async function openDrawer(reason){const why=['cash','noSale','test'].includes(reason)?reason:'noSale';
 if(blocked()&&why!=='test')return{ok:false,code:'BLOCKED',msg:msg('BLOCKED')};
 if(cfg('hwDrawer')===false)return{ok:false,code:'NO_DRAWER',msg:msg('NO_DRAWER')};
 const H=HW();if(!H||!(await H.available()))return{ok:false,code:'NO_DRAWER',msg:msg('NO_DRAWER')};
 try{await serial(()=>H.openDrawer({reason:String(reason||'')}));emit('drawer',{reason:why,at:now()});if(cfg('sndDone')!==false)beep('done');return{ok:true}}
 catch(e){const c=codeOf(e);hwChanged({printer:c==='NO_PRINTER'?'none':'off'});return{ok:false,code:c,msg:msg(c)}}}

/* ---------- סורק, צלילים ורטט, מסך לקוח ---------- */
function onScan(cb,o){const H=HW();if(!H)return()=>{};return H.onScan(s=>{try{cb(s)}finally{emit('scan',{len:s&&s.code?s.code.length:0})}},o)}
let actx=null;
function beep(kind){try{const C=root.AudioContext||root.webkitAudioContext;if(!C)return false;actx=actx||new C();const o=actx.createOscillator(),g=actx.createGain();
 const f={ok:1600,unknown:420,done:880,err:300}[kind]||1600,d=kind==='unknown'||kind==='err'?0.25:0.08;
 o.frequency.value=f;o.type='square';g.gain.value=0.06;o.connect(g);g.connect(actx.destination);o.start();o.stop(actx.currentTime+d);
 if(kind==='unknown'&&cfg('vibrate')!==false)vibrate(120);return true}catch(e){return false}}
function vibrate(ms){const H=HW();if(cfg('vibrate')===false)return Promise.resolve(false);return H&&H.vibrate?H.vibrate(ms):Promise.resolve(false)}
async function showCustomer(cart){const H=HW();if(!H)return{shown:false};return H.display.showCart(cart)}
async function clearCustomer(){const H=HW();if(H)return H.display.clear()}

/* ---------- מצב הקופה מהשרת (posdev) ומצב הציוד למנהל ---------- */
function myDev(){try{const o=JSON.parse(ls('lp-pos-dev')||'null');const S=gSY();return o&&(!S||o.bizId===S.bizId)&&/^K[1-9][0-9]{0,3}$/.test(o.dev||'')?o.dev:''}catch(e){return ''}}
function inst(){const v=ls('lp-pos-inst');return /^[A-Za-z0-9_-]{16,64}$/.test(v||'')?v:''}
let devSt='none',devAt=0;
/* d = מסמך posdev מפוענח. kill = ניתוק מרחוק; appr חסר + devApprove = מחכה לאישור; inst אחר = הקופה נרשמה במכשיר אחר */
function stateOf(d,needAppr){if(!d)return'none';if(d.st==='retired')return'retired';if(d.on!==true||d.kill)return'off';
 const i=inst();if(d.inst&&i&&d.inst!==i)return'off';if(needAppr&&!d.appr)return'pending';return'ok'}
function setState(s){if(s!==devSt){devSt=s;emit('state',{state:s})}devAt=now()}
function state(){return devSt}
function blocked(){return devSt!=='ok'&&devSt!=='none'?true:false}
async function devPoll(){const d=myDev();if(!d){setState('none');return devSt}
 try{const j=await root.fsx('/posdev/'+d);const doc=j&&j.fields?root.fvj({mapValue:j}):null;setState(stateOf(doc,cfg('devApprove')!==false))}catch(e){/* בלי רשת – נשאר המצב האחרון */}
 return devSt}
let hw={printer:'',disp:''},hwSent='',sentAt=0;
function hwChanged(p){const n=Object.assign({},hw,p);if(JSON.stringify(n)===JSON.stringify(hw))return;hw=n;emit('hw',Object.assign({},hw));report(false)}
function qStats(){try{const O=root.PosOffline;if(O&&typeof O.stats==='function'){const s=O.stats()||{};return{qLen:+s.n||0,qOldest:+s.oldest||0}}}catch(e){}return null}
async function report(force){const d=myDev(),i=inst();if(!d||!i||typeof root.fnCall!=='function')return false;
 const body={op:'hw',dev:d,inst:i,hwSt:{printer:hw.printer||'none',disp:hw.disp||'none',prnq:qRead().length},ver:String(gVC()||'')};
 const q=qStats();if(q)Object.assign(body,q);
 const key=JSON.stringify([body.hwSt,body.qLen||0,Math.floor((body.qOldest||0)/60000)]);
 if(!force&&key===hwSent&&now()-sentAt<REPORT_MS)return false;
 try{await root.fnCall('posOps',body);hwSent=key;sentAt=now();return true}catch(e){return false}}
async function pollHw(){const H=HW();if(!H||!(await H.available()))return;const p=H.printer();
 if(p){let st=null;try{st=await H.plug().printerStatus({printer:p,timeoutMs:600})}catch(e){}
  const v=!st||!st.connected?'off':st.paperOut||st.coverOpen?'paper':st.paperLow?'low':'ok';hwChanged({printer:v})}
 else hwChanged({printer:'none'});
 try{const di=await H.display.info();hwChanged({disp:di&&di.available?(di.showing?'on':'ok'):'none'})}catch(e){}
 report(false)}
/* דיווח תקלה (O17): קוד, הודעה בעברית והקשר טכני בלבד. מספרים ארוכים (טלפון, כרטיס) ומיילים נמחקים לפני השליחה.
   sev: 'info' | 'err' | 'crit' (crit → התראה לבעל העסק ולמפתח, בשרת). בלי רשת – נזרק (התור המקומי lp-pos-err של ש3 יכול לעטוף את זה). */
const scrub=v=>String(v==null?'':v).replace(/[\w.+-]+@[\w-]+\.[\w.]+/g,'[mail]').replace(/\d[\d\s-]{6,}\d/g,'[num]');
function ctxOf(c){const o={};if(!c||typeof c!=='object')return o;let n=0;for(const k of Object.keys(c)){if(n>=12)break;if(!/^[A-Za-z][\w]{0,30}$/.test(k))continue;const v=c[k];
 if(typeof v==='number'&&Number.isFinite(v))o[k]=v;else if(typeof v==='boolean')o[k]=v;else if(typeof v==='string')o[k]=scrub(v).slice(0,120);else continue;n++}return o}
async function reportErr(sev,code,message,ctx){if(typeof root.fnCall!=='function')return false;
 const body={op:'err',sev:['info','err','crit'].includes(sev)?sev:'err',code:String(code||'ERR').replace(/[^\w.:-]/g,'').slice(0,40)||'ERR',msg:scrub(message).slice(0,300),ctx:ctxOf(ctx),ver:String(gVC()||'')};
 const d=myDev();if(d)body.dev=d;
 try{await root.fnCall('posOps',body);return true}catch(e){return false}}
let timers=[];
/* רק בקופה רשומה ופעילה במכשיר: בודק מדפסת כל 20 שניות ואת הקופה בשרת כל דקה. כשהמדפסת חוזרת (USB) – מדפיס את התור. */
function start(){stop();if(!myDev())return false;devPoll();pollHw();
 timers.push(setInterval(()=>{if(!root.document||root.document.visibilityState!=='hidden')pollHw()},POLL_MS));
 timers.push(setInterval(devPoll,DEVPOLL_MS));
 const H=HW();if(H){timers.push(H.on('usb',u=>{const p=H.printer();if(u&&u.attached&&p&&p.type==='usb'&&(p.vendorId==null||u.vendorId===p.vendorId)&&qRead().length)setTimeout(()=>retryQueue(),1500);setTimeout(pollHw,1600)}));
  timers.push(H.on('display',()=>pollHw()))}
 return true}
function stop(){timers.forEach(t=>{if(typeof t==='function')t();else clearInterval(t)});timers=[]}

try{if(root.document&&root.addEventListener){root.addEventListener('lp-biz-change',()=>{stop();setState('none')});
 /* מתחיל רק כשמתג הקופה פעיל בעסק (bzF('pos')) ויש קופה רשומה במכשיר */
 setTimeout(()=>{try{if(typeof root.bzF==='function'&&root.bzF('pos'))start()}catch(e){}},4000)}}catch(e){}

return{reportErr,print,reprint,queue,retryQueue,openDrawer,onScan,beep,vibrate,showCustomer,clearCustomer,msg,state,blocked,stateOf,devPoll,report,start,stop,on,
 _t:{scrub,ctxOf,receiptOf,codeOf,hwChanged,get hw(){return hw}}}});
