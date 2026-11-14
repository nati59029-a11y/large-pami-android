/* AR:DOCS – אישור הזמנה (משימה 2026-11-14_הזמנות-לקוח-עסקי-וחשבוניות, שלב 3 חלק ב'). קובץ עצמאי, נטען אחרי orders-staff.js, orders-cust.js ו-ord-biz.js.
   - כרטיס ההזמנה: "שלח אישור הזמנה" (arOc – מספור רץ נפרד; אחרי עריכה – מהדורה חדשה), שיתוף מהטלפון (arPdf + חלון השיתוף הקיים), ווטסאפ / מייל (arSend).
     אחרי "שמור הזמנה" הכרטיס נפתח עם הכפתור מודגש. לקוח שמסומן לקבל אישור הזמנה – נשלח אוטומטית מיד אחרי השמירה, בלי לחיצה.
   - הזמנה ישנה (בלי vm): לפני ההפקה בוחרים אם המחירים כוללים מע"מ.
   - כרטיס הלקוח: מה שולחים ללקוח ובאיזה ערוץ (setArCfg – עובד עם הזמנות ומנהל).
   - הגדרות (מנהל): מסמכים פעילים, פרטי העסק, לוגו, טקסט תחתון, שם תבנית ווטסאפ (setArCfg). כניסה ממסך "הגדרות הזמנות".
   כל כתיבה – דרך השרת (functions/ar.js). בלי מסמכים פעילים – אין שינוי במסכים (מנהל רואה הפניה להגדרות). */
(function(){
'use strict';
if(typeof ACT==='undefined'||typeof V==='undefined'||!window.__ox)return;
const O=window.__ox;
const fnCall=(n,d)=>{d=d&&typeof d==='object'?d:{};if(SY&&SY.sa&&SY.bizId&&!('bizId'in d))d=Object.assign({bizId:SY.bizId},d);return window.fnCall(n,d)};
const on=()=>(isA()||isW()||!!(SY&&SY.sa))&&bzF('orders')&&wp('ord');
const mgr=()=>isA()||!!(SY&&SY.sa);
const dec=d=>Object.assign({id:idOf(d)},Object.fromEntries(Object.entries(d.fields||{}).map(([k,v])=>[k,fvj(v)])));
const err=e=>toast(e&&e.message||'הפעולה נכשלה');
const rid=()=>{const a=new Uint8Array(12);crypto.getRandomValues(a);return 'r'+[...a].map(x=>x.toString(36).padStart(2,'0')).join('').slice(0,22)};
const tm=t=>{if(!t)return '';const d=new Date(t);return d.toLocaleDateString('he-IL',{day:'numeric',month:'numeric'})+' '+d.toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'})};
async function get1(p){try{const d=await fsx(p);return d?dec(d):null}catch(e){if(e.code===404)return null;throw e}}
const R={cfg:undefined,cb:0,c:{},just:'',busy:0};
const typing=()=>{const a=document.activeElement;return !!(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)&&a.closest('#main'))};
const redraw=v=>{if(cur().v===v&&!typing()&&!document.querySelector('#dlg[open]'))rerender()};
function cfgL(force){if(R.cfg!==undefined&&!force)return Promise.resolve(R.cfg);if(!R.cb)R.cb=get1('/arcfg/main').then(c=>{R.cfg=c||{}},()=>{R.cfg=R.cfg||{}}).then(()=>{R.cb=0;return R.cfg});return R.cb}
async function custL(id,force){if(!id)return null;if(!force&&R.c[id]!==undefined)return R.c[id];try{R.c[id]=await get1('/cust/'+id)}catch(e){R.c[id]=null}return R.c[id]}
const WHY={'no-tpl':'אין תבנית ווטסאפ מאושרת (הגדרות)','stopped':'"עצור הכל" פעיל','limit':'הגעתם למכסת ההודעות היומית','no-wa':'ווטסאפ העסקי לא מחובר','bad-to':'מספר או כתובת לא תקינים','no-to':'אין ללקוח טלפון / מייל','no-secrets':'שליחת מייל לא מוגדרת בשרת','no-smtp':'שליחת מייל לא מוגדרת בשרת','rate':'הגעתם למכסת המיילים','send':'השליחה נכשלה','bad-link':'הקישור למסמך לא תקין','wa-rejected':'ווטסאפ דחה את ההודעה','wa-quota':'מכסת ווטסאפ'};
const CHN={wa:'ווטסאפ',mail:'מייל'};
const sentTxt=s=>`${CHN[s.ch]||s.ch}${s.to?' ('+s.to+')':''}: ${s.ok?'נשלח ✓':'לא נשלח – '+(WHY[s.why]||s.why||'שגיאה')}`;
const ordOf=id=>(O.L||[]).find(x=>x.id===id);

/* ---------- כרטיס ההזמנה ---------- */
// ההזמנה נערכה אחרי אישור ההזמנה? אותה חתימה כמו בשרת (functions/ar.js sigOf): SHA-256 של אותו JSON, 20 תווים ראשונים
const ST=new Map();
function staleOf(o){const oc=o.oc,k=o.id+'|'+oc.sig+'|'+(o.upd||0)+'|'+o.total+'|'+o.gross;if(ST.has(k))return ST.get(k);ST.set(k,undefined);
 const c=o.cust||{},items=(Array.isArray(o.items)?o.items:[]).map(i=>[i.pid||'',i.n||'',i.qty,i.price,i.ct||0]);
 const t=JSON.stringify([items,o.total,o.gross,o.disc||0,oc.vm,oc.vr,c.name||'',c.phone||'',c.addr||'',(c.ship&&c.ship.addr)||'',o.custId||'']);
 crypto.subtle.digest('SHA-256',new TextEncoder().encode(t)).then(b=>{const h=[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,20);ST.set(k,h!==oc.sig);if(h!==oc.sig)redraw('oxOrd')}).catch(()=>{});return undefined}
function boxH(o){const c=R.cfg||{};
 if(!c.on)return mgr()?`<div class="sec"><h3>אישור הזמנה</h3></div><div class="card"><p class="note" style="margin:0">מסמכים ללקוח כבויים. אפשר להפעיל ב"הגדרות אישור הזמנה".</p><button class="btn g s" style="margin-top:8px" data-a="go" data-v="arCfg">הגדרות אישור הזמנה</button></div>`:'';
 if(o.status==='cancel')return '';
 const oc=o.oc&&o.oc.no?o.oc:null,edited=oc&&staleOf(o)===true,just=R.just===o.id;
 const head=oc?`<p style="margin:0"><b>אישור הזמנה #${esc(oc.no)}</b>${oc.ed>1?' · מהדורה '+esc(oc.ed):''} <small class="note">· ${tm(oc.at)}</small></p>`:'';
 const sent=oc&&(oc.sent||[]).length?`<div class="note" style="margin-top:6px">${oc.sent.slice(-4).map(s=>`<div>${esc(tm(s.at))} · ${esc(sentTxt(s))}${s.ed>1?' · מהדורה '+esc(s.ed):''}</div>`).join('')}</div>`:'';
 const main=!oc||edited?`<button class="btn w" data-a="arOc" data-id="${esc(o.id)}">${oc?'הפק מהדורה חדשה ושלח':'שלח אישור הזמנה'}</button>`:'';
 const more=oc?`<div class="row" style="margin-top:8px"><button class="btn g grow" data-a="arShare" data-id="${esc(o.id)}">שיתוף</button><button class="btn g grow" data-a="arSendD" data-id="${esc(o.id)}" data-ch="wa">ווטסאפ</button><button class="btn g grow" data-a="arSendD" data-id="${esc(o.id)}" data-ch="mail">מייל</button></div>`:'';
 return `<div class="sec"><h3>אישור הזמנה</h3></div><div class="card" id="arbox"${just?' style="border-color:var(--acc)"':''}>${just&&!oc?'<p style="margin:0 0 8px"><b>ההזמנה נשמרה.</b> לשלוח ללקוח אישור הזמנה?</p>':''}${head}${edited?'<p class="note" style="margin:4px 0 0;color:var(--bad)">ההזמנה נערכה אחרי אישור ההזמנה.</p>':''}${main}${more}${sent}</div>`}
{const f=V.oxOrd;if(f)V.oxOrd=id=>{const r=f(id);try{if(!r||!r.h||!on())return r;const o=ordOf(id);if(!o)return r;
 if(R.cfg===undefined){cfgL().then(()=>redraw('oxOrd'));return r}
 const h=boxH(o);if(!h)return r;const i=r.h.indexOf('<div class="sec"><h3>תשלום</h3>'),j=r.h.indexOf('<div class="sec"><h3>היסטוריה</h3>');const k=i>=0?i:j;r.h=k>=0?r.h.slice(0,k)+h+r.h.slice(k):r.h+h}catch(e){}return r}}

async function ocRun(id,vm,el){const o=ordOf(id);if(!o)return;if(el)el.disabled=true;
 try{const r=await fnCall('arOc',Object.assign({id,reqId:rid()},vm?{vm}:{}));if(r&&r.oc)o.oc=r.oc;if(R.just===id)R.just='';
  const s=(r&&r.sent)||[];toast(`אישור הזמנה #${r.no}${r.ed>1?' (מהדורה '+r.ed+')':''}${r.fresh?' הופק':''}${s.length?' · '+s.map(sentTxt).join(' · '):''}`);redraw('oxOrd');return r}
 catch(e){if(el)el.disabled=false;const rs=e&&(e.details&&e.details.reason||e.reason);if(rs==='need-vm')return vmAsk(id);err(e)}}
function vmAsk(id){dlg(`<h3>הזמנה ישנה: המחירים בה –</h3><p class="note">ההזמנה נוצרה לפני הגרסה הזו, ולכן צריך לבחור פעם אחת איך להציג את המחירים באישור ההזמנה.</p><div class="row"><button class="btn grow" data-a="arVm" data-id="${esc(id)}" data-vm="inc">כוללים מע"מ</button><button class="btn g grow" data-a="arVm" data-id="${esc(id)}" data-vm="ex">לפני מע"מ</button></div><button class="btn g w" style="margin-top:8px" data-a="closeDlg">ביטול</button>`)}
ACT.arOc=el=>{const o=ordOf(el.dataset.id);if(!o)return;if(!o.vm&&!(o.oc&&o.oc.vm))return vmAsk(o.id);ocRun(o.id,null,el)};
ACT.arVm=el=>{closeDlg();ocRun(el.dataset.id,el.dataset.vm)};
ACT.arShare=async el=>{if(el.dataset.busy)return;el.dataset.busy='1';try{const r=await fnCall('arPdf',{id:el.dataset.id});if(r.stale)toast('שימו לב: ההזמנה נערכה אחרי אישור ההזמנה');
  await dxShareDU('data:application/pdf;base64,'+r.b64,'אישור הזמנה '+r.no+(r.ed>1?'-'+r.ed:''))}catch(e){err(e)}finally{delete el.dataset.busy}};
ACT.arSendD=async el=>{const o=ordOf(el.dataset.id);if(!o)return;const ch=el.dataset.ch,k=o.cust||{};const c=o.custId?await custL(o.custId):null;
 const v=ch==='wa'?(k.phone||(c&&c.phone)||''):(k.mail||(c&&c.mail)||'');
 dlg(`<h3>שליחת אישור הזמנה ב${CHN[ch]}</h3><form data-f="arSendF"><input type="hidden" name="id" value="${esc(o.id)}"><input type="hidden" name="ch" value="${esc(ch)}"><input type="hidden" name="q" value="${rid()}">
  <label class="f"><span>${ch==='wa'?'מספר ווטסאפ':'כתובת מייל'}</span><input name="to" value="${esc(v)}" dir="ltr" ${ch==='wa'?'inputmode="tel"':'type="email"'} required maxlength="254"></label>
  <div class="row"><button class="btn grow">שלח</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`)};
FRM.arSendF=async f=>{const x=fd(f),b=f.querySelector('button');b.disabled=true;
 try{const r=await fnCall('arSend',{id:x.id,reqId:x.q,ch:x.ch,to:String(x.to||'').trim()});closeDlg();const o=ordOf(x.id);if(o&&o.oc&&r.sent){o.oc.sent=(o.oc.sent||[]).concat(r.sent).slice(-50)}toast((r.sent||[]).map(sentTxt).join(' · ')||'נשלח');redraw('oxOrd')}catch(e){b.disabled=false;err(e)}};

/* ---------- אחרי שמירה: הכפתור מודגש, ושליחה אוטומטית ללקוח מסומן ---------- */
{const f=ACT.oxSave;if(f)ACT.oxSave=async el=>{const r=await f(el);try{if(r&&r.id){R.just=r.id;const c=await cfgL(true);redraw('oxOrd');const o=ordOf(r.id);
  if(c&&c.on&&o&&o.custId){const cu=await custL(o.custId,true);if(cu&&cu.snd&&cu.snd.oc===true)await ocRun(r.id)}}}catch(e){}return r}}

/* ---------- כרטיס הלקוח: מה שולחים ובאיזה ערוץ ---------- */
{const f=V.ocCard;if(f)V.ocCard=id=>{const r=f(id);try{if(!r||!r.h||!on())return r;if(R.cfg===undefined){cfgL().then(()=>redraw('ocCard'));return r}if(!(R.cfg||{}).on)return r;
 if(R.c[id]===undefined){custL(id).then(()=>redraw('ocCard'));return r}const c=R.c[id];if(!c)return r;const s=c.snd||{};
 const h=`<form class="card" data-f="arSndF" style="margin:8px 0"><input type="hidden" name="id" value="${esc(id)}"><b>שליחת מסמכים ללקוח</b>
  <label class="f"><span>ערוץ</span><select name="ch"><option value="wa"${s.ch==='wa'||!s.ch?' selected':''}>ווטסאפ</option><option value="mail"${s.ch==='mail'?' selected':''}>מייל</option><option value="both"${s.ch==='both'?' selected':''}>ווטסאפ ומייל</option></select></label>
  <label class="row" style="gap:8px;align-items:center;min-height:44px"><input type="checkbox" name="oc"${s.oc?' checked':''}> לשלוח אישור הזמנה אוטומטית אחרי כל הזמנה</label>
  <button class="btn g s">שמור</button></form>`;
 r.h+=h}catch(e){}return r}}
FRM.arSndF=async f=>{const x=fd(f),b=f.querySelector('button');b.disabled=true;const snd={ch:x.ch,oc:!!x.oc};
 try{await fnCall('setArCfg',{cust:x.id,snd});if(R.c[x.id])R.c[x.id].snd=Object.assign({inv:false,rc:false},snd);toast('נשמר')}catch(e){err(e)}finally{b.disabled=false}};

/* ---------- הגדרות (מנהל) ---------- */
V.arCfg=()=>{const T='הגדרות אישור הזמנה';if(!on()||!mgr())return{t:T,h:'<div class="empty">למנהל בלבד</div>'};if(R.cfg===undefined){cfgL().then(()=>redraw('arCfg'));return{t:T,h:'<div class="empty">טוען…</div>'}}
 const c=R.cfg||{},F=(n,l,a)=>`<label class="f"><span>${l}</span><input name="${n}" value="${esc(c[n]||'')}" ${a||''}></label>`;
 return{t:T,h:`<form class="card" data-f="arCfgF">
  <label class="row" style="gap:8px;align-items:center;min-height:44px"><input type="checkbox" name="on"${c.on?' checked':''}> <b>מסמכים ללקוח פעילים</b></label>
  <p class="note" style="margin:0 0 8px">כשהמתג כבוי, הכפתור "שלח אישור הזמנה" לא מופיע.</p>
  ${F('name','שם העסק במסמך','maxlength="80"')}${F('bn','ע.מ / ח.פ','maxlength="20" inputmode="numeric"')}${F('addr','כתובת','maxlength="160"')}${F('phone','טלפון','maxlength="30" dir="ltr" inputmode="tel"')}${F('mail','מייל (תשובות הלקוח יגיעו אליו)','maxlength="254" dir="ltr" type="email"')}
  <label class="f"><span>טקסט בתחתית המסמך</span><textarea name="foot" rows="3" maxlength="1500">${esc(c.foot||'')}</textarea></label>
  <label class="f"><span>שם תבנית ווטסאפ מאושרת לאישור הזמנה</span><input name="wt" value="${esc((c.wt&&c.wt.oc)||'')}" dir="ltr" maxlength="100" placeholder="order_confirmation"></label>
  <p class="note" style="margin:0 0 8px">בלי תבנית שאושרה ב-Meta אי אפשר לשלוח את המסמך בווטסאפ מהמספר העסקי. שיתוף מהטלפון ומייל – עובדים גם בלעדיה.</p>
  <button class="btn w">שמור</button></form>
  <div class="card"><b>לוגו במסמכים</b><p class="note" style="margin:4px 0 8px">${c.logo?'הועלה לוגו.':'לא הועלה לוגו – יוצג הלוגו של העסק, אם יש.'} PNG או JPEG.</p>
  <div class="row"><label class="btn g grow" style="display:flex;align-items:center;justify-content:center">בחירת תמונה<input type="file" accept="image/png,image/jpeg" data-c="arLogo" hidden></label>${c.logo?'<button class="btn g grow" data-a="arLogoDel">הסרה</button>':''}</div></div>`}};
FRM.arCfgF=async f=>{const x=fd(f),b=f.querySelector('button');b.disabled=true;
 try{await fnCall('setArCfg',{on:!!x.on,name:x.name||'',bn:x.bn||'',addr:x.addr||'',phone:x.phone||'',mail:String(x.mail||'').trim(),foot:x.foot||'',wt:{oc:String(x.wt||'').trim()}});await cfgL(true);toast('נשמר');rerender()}catch(e){err(e)}finally{b.disabled=false}};
// לוגו: מוקטן במכשיר (עד 400 פיקסלים), PNG או JPEG – עד 300KB
CHG.arLogo=async el=>{const file=el.files&&el.files[0];el.value='';if(!file)return;
 try{const url=URL.createObjectURL(file);const img=await new Promise((ok,no)=>{const i=new Image();i.onload=()=>ok(i);i.onerror=()=>no(new Error('התמונה לא נטענה'));i.src=url});
  const k=Math.min(1,400/Math.max(img.width,img.height)),cv=document.createElement('canvas');cv.width=Math.max(1,Math.round(img.width*k));cv.height=Math.max(1,Math.round(img.height*k));cv.getContext('2d').drawImage(img,0,0,cv.width,cv.height);URL.revokeObjectURL(url);
  let du=cv.toDataURL(file.type==='image/jpeg'?'image/jpeg':'image/png',.9);if(du.length>400000)du=cv.toDataURL('image/jpeg',.8);if(du.length>400000)throw new Error('התמונה גדולה מדי');
  await fnCall('setArCfg',{logo:du});await cfgL(true);toast('הלוגו נשמר');rerender()}catch(e){err(e)}};
ACT.arLogoDel=()=>ask('להסיר את הלוגו מהמסמכים?',async()=>{try{await fnCall('setArCfg',{logo:''});await cfgL(true);rerender()}catch(e){err(e)}},'הסר');
{const f=V.oxCfg;if(f)V.oxCfg=()=>{const r=f();try{if(r&&r.h&&on()&&mgr())r.h+='<button class="btn g w" style="margin-top:10px" data-a="go" data-v="arCfg">הגדרות אישור הזמנה</button>'}catch(e){}return r}}
window.__arDocs={R,boxH,cfgL};
})();
