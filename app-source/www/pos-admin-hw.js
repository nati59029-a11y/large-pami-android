/* POS:M7 – pos-admin-hw.js (קופה, ש7, 17.11.2026). אזור הניהול בלבד (מנהל / מנהל־על) – במסך הקופה אין הגדרות (אפיון 1.3).
   V.posHw – "ציוד ומכשירים" (אפיון ד 3.2):
     • המכשיר הזה: בחירת מדפסת ובדיקת ציוד (חלון LpPosHw.openPanel – הדפסת ניסיון, מגירה, סורק, מסך לקוח), "צלצל", קבלות שממתינות להדפסה.
     • מצב ציוד חי לכל הקופות (posdev.hwSt, תור, גרסה, סנכרון אחרון) – מתעדכן כל 20 שניות כשהמסך פתוח (H18: הקופאי לא רואה את זה).
     • אישור מכשיר חדש, ניתוק מרחוק (אדום, עם אישור) והחזרה לשימוש – דרך השרת (posOps). פרישה – במסך "ניהול קופה" (pos-base.js).
   הכניסה: כרטיס בראש "ניהול קופה" (V.posAdm), עם קישור גם ל"תפעול" (pos-admin-ops.js). מתג pos כבוי = כלום לא משתנה. */
(function(){
'use strict';
if(typeof ACT==='undefined'||typeof V==='undefined')return;
const fnCall=(n,d)=>{d=d&&typeof d==='object'?d:{};if(SY&&SY.sa&&SY.bizId&&!('bizId'in d))d=Object.assign({bizId:SY.bizId},d);return window.fnCall(n,d)};
const on=()=>{try{return bzF('pos')&&bzB()&&!SY.mg}catch(e){return false}};
const mgr=()=>{try{return isA()||!!(SY&&SY.sa)}catch(e){return false}};
const dec=d=>Object.assign({id:idOf(d)},fvj({mapValue:d}));
const err=e=>toast(e&&e.message||'הפעולה נכשלה');
const P={devs:null,err:'',at:0};let ld=0,tm=0;
const typing=()=>{const a=document.activeElement;return !!(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)&&a.closest('#main'))};
async function devLoad(){const j=await fsx('/posdev?pageSize=200');P.devs=((j&&j.documents)||[]).map(dec).sort((a,b)=>(+String(a.id).slice(1))-(+String(b.id).slice(1)));P.at=Date.now()}
function load(){if(ld)return;ld=1;devLoad().then(()=>{P.err=''},e=>{P.err=e&&e.message||'הטעינה נכשלה'}).finally(()=>{ld=0;if(cur().v==='posHw'&&!typing()&&!document.querySelector('#dlg[open]'))rerender()})}
/* רענון כל 20 שניות, רק כשהמסך פתוח ונראה */
function tick(){clearInterval(tm);tm=setInterval(()=>{if(cur().v!=='posHw'){clearInterval(tm);tm=0;return}if(document.visibilityState!=='hidden')load()},20000)}
const ago=t=>{if(!t)return'אף פעם';const s=Math.max(0,Math.round((Date.now()-t)/1000));return s<60?'לפני '+s+' שניות':s<3600?'לפני '+Math.round(s/60)+' דקות':s<172800?'לפני '+Math.round(s/3600)+' שעות':'לפני '+Math.round(s/86400)+' ימים'};
const PRN={ok:['t3','מדפסת תקינה'],low:['t1','הנייר עומד להיגמר'],paper:['t4','נגמר הנייר'],off:['t4','מדפסת מנותקת'],none:['t2','לא הוגדרה מדפסת']};
function devRow(x){const h=x.hwSt||{},seen=+x.hwAt||0,stale=seen&&Date.now()-seen>120000;
 const kill=!!x.kill,ret=x.st==='retired',pend=!ret&&!kill&&x.on===true&&!!x.inst&&!x.appr;
 const st=ret?['t4','הוצאה משימוש']:kill?['t4','נותקה מרחוק']:x.on!==true?['t1','מושבתת']:pend?['t1','מחכה לאישור']:!x.inst?['t2','לא רשומה על מכשיר']:['t3','מאושרת'];
 const pr=PRN[h.printer]||null;
 const q=+x.qLen||0,old=+x.qOldest||0;
 const info=[];
 if(!ret&&x.inst){info.push(stale?'<span class="tag t1">לא מדווחת</span> '+ago(seen):'דיווח '+ago(seen));
  if(pr)info.push(`<span class="tag ${pr[0]}">${pr[1]}</span>`);
  if(h.disp==='ok'||h.disp==='on')info.push('מסך לקוח מחובר');
  if(+h.prnq>0)info.push(`<span class="tag t1">${+h.prnq} קבלות ממתינות להדפסה</span>`);
  info.push(q?`<span class="tag ${q>=20?'t4':'t1'}">${q} מכירות ממתינות</span>${old?' (הוותיקה '+ago(old)+')':''}`:'אין מכירות ממתינות');
  if(x.ver)info.push('גרסה '+esc(x.ver));
  if(x.lastSync)info.push('סנכרון '+ago(+x.lastSync))}
 const b=[];
 if(pend)b.push(`<button class="btn s" data-a="posHwAppr" data-dev="${esc(x.id)}">אישור המכשיר</button>`);
 if(!ret&&!kill&&x.inst)b.push(`<button class="btn s" style="background:var(--bad,#c62828);color:#fff" data-a="posHwKill" data-dev="${esc(x.id)}">ניתוק מרחוק</button>`);
 if(kill&&!ret)b.push(`<button class="btn s g" data-a="posHwUnkill" data-dev="${esc(x.id)}">החזרה לשימוש</button>`);
 return `<div class="li" style="cursor:default;align-items:flex-start"><div class="m"><b>${esc(x.name||x.id)} <span class="tag t3">${esc(x.id)}</span> <span class="tag ${st[0]}">${st[1]}</span></b><small>${info.join(' · ')}</small></div>${b.join('')}</div>`}
function thisDev(){const H=window.LpPosHw,D=window.Devices;const p=H&&H.printer?H.printer():null,q=D?D.queue():[];
 const st=D?D.state():'none',stTxt={ok:'מאושרת למכירה',pending:'מחכה לאישור מנהל',off:'מושבתת / נותקה',retired:'הוצאה משימוש',none:'המכשיר לא רשום כקופה'}[st]||st;
 return `<div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><h3 style="margin:0">המכשיר הזה</h3>${window.PosHelp?PosHelp.btn('hw'):''}</div>
 <p class="note" style="margin:6px 0">קופה: ${esc(stTxt)} · מדפסת: ${esc(H&&H.pDesc?H.pDesc(p):'אין חיבור לחומרה בגרסה הזו')}</p>
 <button class="btn w" data-a="posHwPanel">בדיקת ציוד והגדרת מדפסת</button>
 <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button class="btn s g" data-a="posHwRing">צלצל (צליל ורטט)</button><button class="btn s g" data-a="posGuide">מדריך התקנת ציוד</button>${q.length?`<button class="btn s" data-a="posHwReprint">הדפסת ${q.length} קבלות ממתינות</button>`:''}</div>
 ${q.length?`<p class="note" style="margin:6px 0 0">${esc(q[0].msg)}</p>`:''}</div>`}
V.posHw=()=>{const T='ציוד ומכשירים';if(!on()||!mgr())return{t:T,h:'<div class="empty">התכונה לא פעילה בעסק הזה</div>'};
 if(!P.devs){load();return{t:T,h:P.err?`<div class="card"><p class="note">${esc(P.err)}</p><button class="btn g w" data-a="posHwRe">נסה שוב</button></div>`:'<div class="empty">טוען…</div>'}}
 if(!tm)tick();
 const live=P.devs.filter(x=>x.st!=='retired'),gone=P.devs.length-live.length;
 const h=thisDev()+`<div class="card"><h3 style="margin-top:0">מצב ציוד חי</h3>${live.length?live.map(devRow).join(''):'<div class="empty">אין קופות עדיין. מוסיפים קופה במסך "ניהול קופה".</div>'}
  <p class="note">מתעדכן כל 20 שניות · עודכן ${ago(P.at)}${gone?' · '+gone+' קופות שהוצאו משימוש לא מוצגות':''}. "ניתוק מרחוק" עוצר מכירה במכשיר תוך דקה; מכשיר חדש לא מוכר לפני אישור.</p></div>`;
 return{t:T,h}};
ACT.posHwRe=()=>{P.devs=null;P.err='';rerender()};
ACT.posHwPanel=()=>{if(window.LpPosHw&&LpPosHw.openPanel)LpPosHw.openPanel();else toast('אין חיבור לחומרה בגרסה הזו של האפליקציה')};
ACT.posHwRing=async()=>{const D=window.Devices;if(!D)return;D.beep('done');const v=await D.vibrate(150);toast(v?'צליל ורטט נשלחו':'צליל נשלח (רטט לא זמין במכשיר הזה)')};
ACT.posHwReprint=async el=>{const D=window.Devices;if(!D)return;el.disabled=true;try{const r=await D.retryQueue();toast(r.left?('הודפסו '+r.done+'. '+D.msg(r.code)):'כל הקבלות הודפסו');rerender()}finally{el.disabled=false}};
async function op(el,body,okMsg){el.disabled=true;try{await fnCall('posOps',body);toast(okMsg);P.devs=null;rerender()}catch(e){err(e)}finally{el.disabled=false}}
ACT.posHwAppr=el=>op(el,{op:'approve',dev:el.dataset.dev},'המכשיר אושר למכירה');
ACT.posHwKill=async el=>{const d=el.dataset.dev;if(!(await ask('לנתק מרחוק את הקופה '+d+'? המכשיר יפסיק למכור תוך דקה. אחר כך אפשר להחזיר אותה לשימוש, והמכשיר יצטרך להירשם ולקבל אישור מחדש.')))return;op(el,{op:'kill',dev:d},'הקופה '+d+' נותקה')};
ACT.posHwUnkill=async el=>{const d=el.dataset.dev;if(!(await ask('להחזיר את הקופה '+d+' לשימוש? המכשיר יירשם מחדש ויחכה לאישור.')))return;op(el,{op:'unkill',dev:d},'הקופה '+d+' הוחזרה. רשמו את המכשיר ואשרו אותו')};
/* כרטיס בראש "ניהול קופה": ציוד ומכשירים + תפעול */
{const o=V.posAdm;if(typeof o==='function')V.posAdm=function(){const r=o.apply(this,arguments);try{if(on()&&mgr()&&r&&typeof r.h==='string'&&!/data-v="posHw"/.test(r.h))
 r.h=`<div class="card"><div class="mlist"><button class="opt" data-a="go" data-v="posHw"><span>ציוד ומכשירים<small>מדפסת, מגירה, סורק, מסך לקוח · מצב חי · אישור וניתוק מכשירים</small></span>${ico('chev')}</button><button class="opt" data-a="go" data-v="posOps"><span>תפעול<small>גיבוי ושחזור · יומן תקלות · התנגשויות · הזנה ידנית אחרי תקלה</small></span>${ico('chev')}</button></div></div>`+r.h}catch(e){}return r}}
window.addEventListener('lp-biz-change',()=>{P.devs=null;P.err=''});
})();
