/* POS:M2 – קופה גל 2, ש2: ניהול מכירה באזור הניהול (17.11.2026). לא במסך הקופה (אין בו הגדרות).
   V.posAdmSale – מנהל / מנהל־על: מבצעים (רשימה, הוספה, שכפול לשבוע הבא, מתג), קופונים אישיים (הפקה ידנית ללקוח, ביטול),
   דוחות: החזרות, הנחות ידניות (יומי), יתרות פתקי זיכוי פתוחים, תצוגה מקדימה של קבלה (80 מ"מ / A4).
   גל 3 (19.11.2026): "אשראי במסוף – חיובים בלי מכירה" (poscard: אושר ולא נקשר למכירה, או ממתין יותר מ-5 דקות) עם ביטול החיוב (posCardCancel).
   הגדרות טבלה 2 של אפיון ב (payOn, cashMax, retDays …) – במסך ההגדרות של ש4 (pos-admin.js, PosCfg); כאן רק קוראים (PosCfg.get, עם גרסה מדומה עד המיזוג).
   כל כתיבה – רק דרך פונקציות השרת posPromo / posCouponUse. קריאה – לפי החוקים (promo, posret, possale, posgift, poscpn). רכיבי D1, בלי צבע קבוע. */
(function(){
'use strict';
if(typeof ACT==='undefined'||typeof V==='undefined')return;
const fnCall=(n,d)=>{d=d&&typeof d==='object'?d:{};if(SY&&SY.sa&&SY.bizId&&!('bizId'in d))d=Object.assign({bizId:SY.bizId},d);return window.fnCall(n,d)};
const on=()=>{try{return bzF('pos')&&bzB()&&!SY.mg}catch(e){return false}};
const mgr=()=>isA()||!!(SY&&SY.sa);
// PosCfg (ש4) – עד המיזוג: ברירות המחדל של האפיון הסופי, פרק 2
const CFG0={rcptWidth:80,rcptBizFmt:'a4',rcptCashier:'num',rcptQr:true,rcptBarcode:true,rcptFooter:'',reprintMark:false,docShowSaleId:false};
const cfgGet=k=>{try{if(window.PosCfg&&typeof PosCfg.get==='function'){const v=PosCfg.get(k);if(v!==undefined)return v}}catch(e){}return CFG0[k]};
const P={tab:'promo',promos:null,rets:null,disc:null,vouch:null,err:'',busy:0};
const ld={};
const err=e=>toast(e&&e.message||'הפעולה נכשלה');
const dec=d=>Object.assign({id:idOf(d)},fvj({mapValue:d}));
const sh=a=>(window.PosReceipt?PosReceipt.sh(a):(Math.round(a)/100).toFixed(2));
const reset=()=>{P.promos=null;P.rets=null;P.disc=null;P.late=null;P.vouch=null;P.card=null;P.err=''};
const day0=()=>{const d=new Date();d.setHours(0,0,0,0);return d.getTime()};
const load=(k,fn)=>{if(ld[k]||P.err)return;ld[k]=1;fn().catch(e=>{P.err=e&&e.message||'הטעינה נכשלה'}).finally(()=>{ld[k]=0;if(cur().v==='posAdmSale'&&!document.querySelector('#dlg[open]'))rerender()})};
const list=async q=>{const j=await fsx(q);return((j&&j.documents)||[]).map(dec)};
// שאילתה מובנית (runQuery) דרך fsx – רק אם קיימת; אחרת רשימה מלאה וסינון במכשיר
async function since(coll,t){const all=await list('/'+coll+'?pageSize=300');return all.filter(x=>(x.at||0)>=t).sort((a,b)=>b.at-a.at)}
const TYPE_N={pct:'אחוז',amt:'סכום ליחידה',fixed:'מחיר קבוע',nForX:'N ב-X',bxgy:'קנה X קבל Y',bundle:'חבילה',basket:'סכום קנייה',basketGift:'מתנה בקנייה'};
const csv=s=>String(s||'').split(/[,\s]+/).map(x=>x.trim()).filter(Boolean);
const ag=s=>{const n=Number(String(s||'').replace(',','.'));return Number.isFinite(n)?Math.round(n*100):NaN};
const deny=T=>({t:T,h:'<div class="empty">התכונה לא פעילה בעסק הזה</div>'});
const loading=T=>({t:T,h:P.err?`<div class="card"><p class="note" style="margin:0">${esc(P.err)}</p><button class="btn g w" data-a="psaRe" style="margin-top:10px">נסה שוב</button></div>`:'<div class="empty">טוען…</div>'});
function promoTxt(p){const v=p.type==='pct'||p.type==='basket'&&p.pct?p.pct+'%':p.type==='amt'||p.type==='basket'?sh(p.amt)+' ₪':p.type==='fixed'?sh(p.price)+' ₪':p.type==='nForX'?p.n+' ב-'+sh(p.price)+' ₪':p.type==='bundle'?sh(p.price)+' ₪':p.type==='basketGift'?'מעל '+sh(p.minAmt)+' ₪':'';
 return `${TYPE_N[p.type]||p.type} ${esc(v)}${p.from||p.to?` · ${esc(p.from||'')}–${esc(p.to||'')}`:''}${p.clubOnly?' · מועדון':''}`}
const tabs=()=>`<div class="seg" style="margin-bottom:10px">${[['promo','מבצעים'],['cpn','קופונים'],['rpt','דוחות'],['rcpt','קבלה']].map(([k,n])=>`<button class="btn s ${P.tab===k?'':'g'}" data-a="psaTab" data-t="${k}">${n}</button>`).join(' ')}</div>`;

V.posAdmSale=()=>{const T='ניהול מכירה';if(!on()||!mgr())return deny(T);
 let h=tabs();
 if(P.tab==='promo'){
  if(!P.promos){load('pr',async()=>{P.promos=(await list('/promo?pageSize=300')).sort((a,b)=>String(b.from||'').localeCompare(String(a.from||'')))});return Object.assign(loading(T),{h:tabs()+loading(T).h})}
  const rows=P.promos.length?P.promos.map(p=>`<div class="li" style="cursor:default"><div class="m"><b>${esc(p.n||p.id)} <span class="tag ${p.on?'t3':'t1'}">${p.on?'פעיל':'כבוי'}</span></b><small>${promoTxt(p)}</small></div>
   <button class="btn s g" data-a="psaOn" data-id="${esc(p.id)}" data-on="${p.on?0:1}">${p.on?'כיבוי':'הפעלה'}</button><button class="btn s g" data-a="psaDup" data-id="${esc(p.id)}">שכפול לשבוע הבא</button></div>`).join(''):'<div class="empty">אין מבצעים</div>';
  h+=`<div class="card"><h3 style="margin-top:0">מבצעים</h3>${rows}<p class="note">ביטול מבצע לא משנה קבלות שכבר הופקו.</p></div>
  <div class="card"><h3 style="margin-top:0">מבצע חדש</h3><form data-f="psaPromo">
   <label class="f"><span>שם</span><input name="n" maxlength="80" required></label>
   <label class="f"><span>סוג</span><select name="type">${Object.entries(TYPE_N).map(([k,n])=>`<option value="${k}">${n}</option>`).join('')}</select></label>
   <label class="f"><span>ערך (אחוז / סכום בש"ח / מחיר)</span><input name="v" inputmode="decimal" dir="ltr"></label>
   <label class="f"><span>N (ל"N ב-X")</span><input name="cnt" inputmode="numeric" dir="ltr"></label>
   <label class="f"><span>מוצרים (מזהים, מופרדים בפסיק)</span><input name="pids" dir="ltr"></label>
   <label class="f"><span>קטגוריות</span><input name="cats" dir="ltr"></label>
   <label class="f"><span>קנה (ל"קנה X קבל Y")</span><input name="buy" dir="ltr"></label><label class="f"><span>קבל</span><input name="get" dir="ltr"></label>
   <label class="f"><span>סכום מינימום (ש"ח)</span><input name="min" inputmode="decimal" dir="ltr"></label><label class="f"><span>מוצר מתנה</span><input name="gift" dir="ltr"></label>
   <label class="f"><span>מתאריך</span><input type="date" name="from"></label><label class="f"><span>עד תאריך</span><input type="date" name="to"></label>
   <label class="f"><span>הגבלה ללקוח (יחידות)</span><input name="max" inputmode="numeric" dir="ltr"></label>
   <label class="chip"><input type="checkbox" name="club"> מועדון בלבד</label> <label class="chip"><input type="checkbox" name="on" checked> פעיל</label>
   <button class="btn w" style="margin-top:8px">שמירה</button></form></div>`;
 }else if(P.tab==='cpn'){
  h+=`<div class="card"><h3 style="margin-top:0">קופון אישי</h3><form data-f="psaCpn">
   <label class="f"><span>מזהה לקוח</span><input name="cust" required dir="ltr"></label>
   <label class="f"><span>הנחה</span><select name="type"><option value="amt">סכום (ש"ח)</option><option value="pct">אחוז</option></select></label>
   <label class="f"><span>ערך</span><input name="v" inputmode="decimal" dir="ltr" required></label>
   <label class="f"><span>בתוקף עד</span><input type="date" name="exp"></label>
   <label class="f"><span>קוד (ריק = אוטומטי)</span><input name="code" dir="ltr" maxlength="40"></label>
   <button class="btn w">הפקה</button></form><p class="note">קופון: פעם אחת, ללקוח הזה בלבד, לא על מוצר במבצע (לפי ההגדרות).</p></div>
   <div class="card"><h3 style="margin-top:0">ביטול קופון</h3><form data-f="psaCpnVoid"><label class="f"><span>קוד</span><input name="code" dir="ltr" required></label><button class="btn g w">ביטול</button></form></div>`;
 }else if(P.tab==='rpt'){
  if(!P.rets){load('rt',async()=>{const t=day0()-29*86400000;const[r,s,g,c]=await Promise.all([since('posret',t),since('possale',0),list('/posgift?pageSize=300'),fnCall('posCardList',{}).catch(e=>({err:e&&e.message||'הטעינה נכשלה'}))]);P.card=c;P.rets=r;const d0=day0();P.disc=s.filter(x=>(x.at||0)>=d0&&(x.manDisc||x.discOvr||(x.lines||[]).some(l=>l.mdisc)));P.late=s.filter(x=>x.apLate&&!(x.apChk&&x.apChk.by));P.vouch=g.filter(x=>x.type==='voucher'&&x.st==='open'&&x.bal>0)});return Object.assign(loading(T),{h:tabs()+loading(T).h})}
  const rsum=P.rets.reduce((a,x)=>a+(x.amt||0),0),vsum=P.vouch.reduce((a,x)=>a+x.bal,0);
  /* סבב 2: הרשימה מהשרת (posCardList – מסוננת וממוינת מהחדש לישן); שגיאה מוצגת כהודעה; כפתור ביטול רק כשהשרת מאשר (canVoid) */
  {const C=P.card||{},L=C.list||[],ST={ok:'אושר – בלי מכירה',wait:'אין תשובה מהמסוף',unk:'לא ודאי – בדקו במסוף',voiding:'ביטול בתהליך'};
   if(C.err)h+=`<div class="card"><h3 style="margin-top:0">אשראי במסוף – חיובים בלי מכירה</h3><p class="note" role="alert">לא ניתן לטעון את הרשימה: ${esc(C.err)}</p><button class="btn g w" data-a="psaRe">נסה שוב</button></div>`;
   else if(L.length)h+=`<div class="card"><h3 style="margin-top:0">אשראי במסוף – חיובים בלי מכירה (${L.length}${C.more?'+':''})</h3><p class="note">חיוב שאושר במסוף ולא נקשר למכירה (למשל המכירה נכשלה או בוטלה), או חיוב שאין עליו תשובה ודאית. בדקו מול המסוף: לקשר ידנית, או לבטל את החיוב.</p>${L.map(x=>`<div class="li" style="cursor:default"><div class="m grow"><b>${sh(x.amt)} ₪ · ${esc(x.dev||'')}${x.last4?' · •••• '+esc(x.last4):''}${x.appr?' · אישור '+esc(x.appr):''}</b><small>${x.st!=='ok'?`<span class="tag t4">${esc(ST[x.st]||x.st)}</span> `:''}${x.mock?'<span class="tag t1">מסוף מדומה – בדיקה</span> ':''}${esc(new Date(x.at).toLocaleString('he-IL'))}${x.msg?' · '+esc(x.msg):''}</small></div>${x.st==='voiding'?'':C.canVoid?`<button class="btn s g" data-a="psaCardVoid" data-id="${esc(x.id)}">${x.st==='ok'?'ביטול החיוב':'בדיקה וביטול'}</button>`:'<small class="note">אין הרשאה לביטול – פנו למנהל קופה</small>'}</div>`).join('')}</div>`;}
  h+=`<div class="card"><h3 style="margin-top:0">החזרות – 30 יום (${P.rets.length}, ${sh(rsum)} ₪)</h3>${P.rets.slice(0,100).map(x=>`<div class="li" style="cursor:default"><div class="m"><b>${esc(x.id)} · ${sh(x.amt)} ₪</b><small>${esc(new Date(x.at).toLocaleString('he-IL'))} · ${esc(x.why||'')}${x.debtOff?' · קוזז מהקפה '+sh(x.debtOff):''}${x.dmg?' · פגום':''}</small></div></div>`).join('')||'<div class="empty">אין החזרות</div>'}</div>
   ${(P.late||[]).length?`<div class="card"><h3 style="margin-top:0">הנחות באישור שפג תוקפו – לבדיקה (${P.late.length})</h3><p class="note">המכירה נגבתה בלי רשת עם אישור שהיה תקף ברגע המכירה, והגיעה לשרת אחרי 30 דקות. שעת המכירה נלקחת משעון המכשיר – בדקו שהיא סבירה.</p>${P.late.slice(0,100).map(x=>{const m=(x.manDisc&&x.manDisc.amt||0)+(x.lines||[]).reduce((a,l)=>a+(l.mdisc&&l.mdisc.amt||0),0);return `<div class="li" style="cursor:default"><div class="m grow"><b>${esc(x.id)} · ${sh(m)} ₪</b><small>${x.apCrit?'<span class="tag t4">דחוף – יותר מ-72 שעות</span> ':''}נמכרה ${esc(new Date(x.soldAt||x.at).toLocaleString('he-IL'))} · הגיעה ${esc(new Date(x.at).toLocaleString('he-IL'))}</small></div><button class="btn g" data-a="psaApChk" data-id="${esc(x.id)}">נבדק</button></div>`}).join('')}</div>`:''}
   <div class="card"><h3 style="margin-top:0">הנחות ידניות – היום (${P.disc.length})</h3>${P.disc.map(x=>{const m=(x.manDisc&&x.manDisc.amt||0)+(x.lines||[]).reduce((a,l)=>a+(l.mdisc&&l.mdisc.amt||0),0);return `<div class="li" style="cursor:default"><div class="m"><b>${esc(x.id)} · ${sh(m)} ₪</b><small>${x.discOvr?'<span class="tag t4">מתחת למינימום</span> ':''}${esc(x.manDisc&&x.manDisc.why||'')}</small></div></div>`}).join('')||'<div class="empty">אין הנחות ידניות היום</div>'}</div>
   <div class="card"><h3 style="margin-top:0">פתקי זיכוי פתוחים (${P.vouch.length}, ${sh(vsum)} ₪)</h3>${P.vouch.slice(0,100).map(x=>`<div class="li" style="cursor:default"><div class="m"><b dir="ltr">${esc(x.id)}</b><small>${sh(x.bal)} ₪${x.exp?' · בתוקף עד '+esc(new Date(x.exp).toLocaleDateString('he-IL')):''}</small></div></div>`).join('')||'<div class="empty">אין</div>'}</div>`;
 }else{
  // תצוגה מקדימה של הקבלה – נתוני דוגמה מסומנים (לא נתוני העסק)
  const demo={sale:{lines:[{n:'צלחת (דוגמה)',qty:2,unit:1250,disc:500,promo:'x'}],net:1695,vat:305,gross:2000,rate:18,soldAt:Date.now(),chg:0,debt:0},pays:[{m:'cash',amt:1000},{m:'bit',amt:1000,ref:'88231'}],docs:[{t:'ir',id:'irO-K1-1',no:1,ser:'O'}],hdr:{name:'שם העסק (דוגמה)',addr:'כתובת',bn:'000000000'}};
  const cfg={rcptCashier:cfgGet('rcptCashier'),rcptQr:cfgGet('rcptQr'),rcptBarcode:cfgGet('rcptBarcode'),rcptFooter:cfgGet('rcptFooter'),reprintMark:cfgGet('reprintMark')};
  const R=window.PosReceipt;
  h+=R?`<div class="card"><h3 style="margin-top:0">80 מ"מ (דוגמה)</h3><div style="overflow-x:auto">${R.build(demo,{fmt:String(cfgGet('rcptWidth')),cfg,cashNo:'3'}).html}</div></div>
   <div class="card"><h3 style="margin-top:0">קבלת מתנה (דוגמה)</h3><div style="overflow-x:auto">${R.build(demo,{fmt:'80',gift:true,cfg,cashNo:'3'}).html}</div></div>`:'<div class="empty">רכיב הקבלה לא נטען</div>';
 }
 return{t:T,h}};
ACT.psaRe=()=>{reset();rerender()};
ACT.psaApChk=async el=>{if(el.disabled)return;el.disabled=true;try{await fnCall('posOps',{op:'apChk',sale:el.dataset.id});P.late=(P.late||[]).filter(x=>x.id!==el.dataset.id);toast('סומן כנבדק');rerender()}catch(e){err(e)}finally{el.disabled=false}};
ACT.psaCardVoid=async el=>{if(el.disabled)return;if(!(await ask('לבטל את החיוב במסוף? הכסף יוחזר ללקוח.')))return;el.disabled=true;try{const r=await fnCall('posCardCancel',{id:el.dataset.id});toast(r&&(r.st==='void'||r.st==='cancel')?'החיוב בוטל':r&&r.st==='unk'?'לא ודאי – בדקו במסוף':'מצב החיוב: '+(r&&r.st||''));P.card=null;P.rets=null;rerender()}catch(e){err(e)}finally{el.disabled=false}};
ACT.psaTab=el=>{P.tab=el.dataset.t;P.err='';rerender()};
ACT.psaOn=async el=>{if(el.disabled)return;el.disabled=true;try{await fnCall('posPromo',{op:'on',id:el.dataset.id,on:el.dataset.on==='1'});P.promos=null;rerender()}catch(e){err(e)}finally{el.disabled=false}};
ACT.psaDup=async el=>{const d=new Date();d.setDate(d.getDate()+(7-d.getDay())%7||7);const f=d.toLocaleDateString('en-CA');const e=new Date(d.getTime()+6*86400000).toLocaleDateString('en-CA');
 if(!(await ask(`לשכפל את המבצע לשבוע ${f} – ${e}? המבצע החדש יישמר כבוי.`)))return;
 try{await fnCall('posPromo',{op:'dup',id:el.dataset.id,from:f,to:e});toast('המבצע שוכפל');P.promos=null;rerender()}catch(x){err(x)}};
FRM.psaPromo=async f=>{const g=n=>String((f.elements[n]&&f.elements[n].value)||'').trim();const t=g('type');const p={n:g('n'),type:t,on:!!f.elements.on.checked};
 const v=Number(g('v').replace(',','.'));
 if(t==='pct')p.pct=v;else if(t==='amt')p.amt=ag(g('v'));else if(['fixed','nForX','bundle'].includes(t))p.price=ag(g('v'));
 if(t==='nForX')p.n=Number.parseInt(g('cnt'),10);
 if(t==='basket'){p.minAmt=ag(g('min'));if(g('v').includes('%'))p.pct=Number(g('v').replace('%',''));else p.amt=ag(g('v'))}
 if(t==='basketGift'){p.minAmt=ag(g('min'));p.giftPid=g('gift')}
 for(const k of['pids','cats','buy','get'])if(g(k))p[k]=csv(g(k));
 if(t==='bxgy'&&v>0&&v<=100)p.getPct=v;
 if(g('from'))p.from=g('from');if(g('to'))p.to=g('to');
 if(g('max'))p.maxPerCust=Number.parseInt(g('max'),10);
 if(f.elements.club.checked)p.clubOnly=true;
 if(window.PosPromo){const why=PosPromo.check(p);if(why)return toast('פרטי המבצע לא תקינים ('+why+')')}
 try{await fnCall('posPromo',{op:'set',p});toast('המבצע נשמר');f.reset();P.promos=null;rerender()}catch(e){err(e)}};
FRM.psaCpn=async f=>{const g=n=>String((f.elements[n]&&f.elements[n].value)||'').trim();const t=g('type');
 const disc=t==='pct'?{type:'pct',pct:Number(g('v').replace(',','.'))}:{type:'amt',amt:ag(g('v'))};
 const d={op:'issue',cust:g('cust'),disc};if(g('exp'))d.exp=g('exp');if(g('code'))d.code=g('code');
 try{const r=await fnCall('posCouponUse',d);toast('הופק קופון '+r.code);f.reset()}catch(e){err(e)}};
FRM.psaCpnVoid=async f=>{const code=String(f.elements.code.value||'').trim();if(!(await ask('לבטל את הקופון '+code+'?')))return;
 try{await fnCall('posCouponUse',{op:'void',code});toast('הקופון בוטל');f.reset()}catch(e){err(e)}};
// אריח "ניהול מכירה" ליד "ניהול קופה" (pos-base.js) – עטיפה, בלי לשנות את הקובץ של שלב 0
{const o=window.posTile;if(typeof o==='function')window.posTile=function(){const h=o.apply(this,arguments);try{if(on()&&mgr())return h+`<button class="tile" data-a="addGo" data-v="posAdmSale" style="font-size:1rem">${ico('swap')}ניהול מכירה</button>`}catch(e){}return h}}
window.addEventListener('lp-biz-change',reset);
})();
