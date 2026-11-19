/* רכיבי שכר גמישים – מסך המנהל (שלב C, משימה 2026-11-19_תנאי-שכר-והערות-עובד). קובץ עצמאי, נטען אחרי payroll.js.
   בלי הקובץ הזה – הגדרות השכר והשכר החודשי כמו קודם (payroll.js בודק typeof window.PayComp). מנהל בלבד.
   נשמר ב-subs[].pay (תוספות בלבד, רשות):
     comp:[רכיב] – המבנה ב-PayCore.validComp (payroll-core.js): tk / sl / pc / man; ב-sl/pc גם ss ('day'|'hrs') ו-amt:1 (להציג לעובד סכומים).
     show:true – "העובד רואה את השכר שלו" (רק עם pay.uid; התצוגה לעובד – pay-me.js, מראה wv/pay_<חודש>_<uid>).
     ab:'YYYY-MM' – החודש האחרון שהבונוסים שלו אושרו (ידנית או אוטומטית). בהוספת רכיבים לראשונה = החודש הקודם (לא מאשרים בדיעבד חודשים שלפני הרכיבים).
   בונוס שאושר = רשומת S.bon {id,sub,mon,a,n,src:'auto',cid,calc,det[,est]} (PayCore.autoBon). אחרי אישור החישוב החי של הרכיב נעצר (monthSum);
   הבונוס נערך כמו בונוס רגיל; "ביטול" לא מוחק אותו אלא מאפס (a:0, del:1 – payroll.js), כדי שהרכיב לא יחזור כצפוי. אישור אוטומטי: payAutoAppr() מ-enterApp במכשיר המנהל,
   מה-3 בחודש, לחודש הקודם, פעם אחת (ab) – ורק לעובד שאין לו נתונים חסרים לרכיבים (gaps: אין מכירות מכספית / ימי עבודה בלי מכירות / משימות לא נטענו). אחרת נשאר "ממתין לאישור" עם הסיבה.
   נתונים לחישוב (רק כשיש רכיבים פעילים, ורק מה שצריך): משימות החודש (שאילתת tasks לפי cr בחודש, מסוננות לעובד: ow = uid, או בלי ow ו-to כולל uid),
   מכירות מ-CxHours (כל הסניפים; לפי יום ולפי שעה). נטען בכניסה למסך שכר חודשי, נשמר 10 דקות בזיכרון בלבד.
   "כלל בכתב חופשי": payRuleAi (שרת) ← "הבנתי כך:" ← אישור (שמירה) / תיקון (לעורך, בלי שמירה) / ביטול. שום דבר לא נשמר בלי אישור.
   משתמש ב: PayUI (payroll.js), PayCore, ACT, FRM, dlg, closeDlg, ask, toast, esc, fld, selO, uid, save, rerender, cur, S, fnCall, fsx, tkOf, tkDue, tkIL, CxHours. */
(function(){
'use strict';
if(typeof ACT==='undefined'||typeof FRM==='undefined'||!window.PayUI||typeof PayCore==='undefined')return;
const U=window.PayUI,PC=PayCore,on=U.on;
const big='style="min-height:48px"';
const KN={tk:'בונוס משימות בזמן',sl:'בונוס מכירות במדרגות',pc:'אחוז ממכירות',man:'בונוס ידני (תזכורת)'};
const SSN={day:'כל מכירות החנות בימים שעבד',hrs:'מכירות בשעות שעבד (לפי שעת המכירה בכספית)'};
const MAXC=10,MAXT=20,MAXAI=500;
const str=v=>v==null?'':String(v);
const sh=v=>'₪'+PC.fmtAg(PC.toAg(v));
const z2=n=>String(n).padStart(2,'0');
const prevMon=m=>{let y=+m.slice(0,4),k=+m.slice(5,7)-1;if(!k){k=12;y--}return y+'-'+z2(k)};
const clone=o=>JSON.parse(JSON.stringify(o));
const act=s=>(s&&s.pay&&Array.isArray(s.pay.comp)?s.pay.comp:[]).map(c=>PC.validComp(c)).filter(v=>v.ok&&v.comp.on).map(v=>v.comp);
const need=L=>({tk:L.some(c=>c.k==='tk'),sl:L.some(c=>c.k==='sl'||c.k==='pc'),any:L.some(c=>c.k!=='man')});

/* ---- תיאור רכיב במילים (מהשדות המאומתים בלבד) ---- */
function descr(c){const v=PC.validComp(c);if(!v.ok)return 'רכיב לא תקין: '+v.err;c=v.comp;let t='';
 if(c.k==='tk')t=c.m==='all'?'כל המשימות של החודש בזמן ← '+sh(c.a):'משימות בזמן: '+c.t.map(u=>u.p+'% ← '+sh(u.a)).join(' · ');
 else if(c.k==='sl')t='מכירות בחודש: '+c.t.map(u=>'מ-'+sh(u.min)+' ← '+sh(u.a)).join(' · ');
 else if(c.k==='pc')t=c.p+'% מהמכירות'+(c.th!==undefined?' שמעל '+sh(c.th):'');
 else t='הסכום נקבע ידנית בכל חודש – תזכורת בלבד';
 if(c.k==='sl'||c.k==='pc')t+=' · '+SSN[c.ss]+' · העובד רואה '+(c.amt?'סכומים':'אחוז מהיעד');
 return t}

/* ---- נתונים לחישוב ---- */
const TTL=6e5,TC={},SC={};/* TC[mon] = {at,p,L} משימות החודש (כל העסק); SC[mon] = {at,p,v} מכירות */
function monRange(m){const y=+m.slice(0,4),k=+m.slice(5,7)-1;
 if(typeof tkIL!=='undefined'&&tkIL&&tkIL.at)return{from:tkIL.at(y,k,1),to:tkIL.at(k===11?y+1:y,(k+1)%12,1)};
 return{from:new Date(y,k,1).getTime(),to:new Date(y,k+1,1).getTime()}}
function loadTasks(m){const c=TC[m];if(c&&(c.L||c.p)&&Date.now()-c.at<TTL)return c.L?Promise.resolve(c.L):c.p;
 if(typeof fsx!=='function'||typeof tkOf!=='function')return Promise.resolve(null);/* null = לא נטען (gaps) */
 const r=monRange(m),iv=v=>({integerValue:String(Math.round(v))});
 const sq={from:[{collectionId:'tasks'}],select:{fields:['cr','due','st','sub','late','dl','to','ow','txt'].map(f=>({fieldPath:f}))},limit:10000,
  where:{compositeFilter:{op:'AND',filters:[{fieldFilter:{field:{fieldPath:'cr'},op:'GREATER_THAN_OR_EQUAL',value:iv(r.from)}},{fieldFilter:{field:{fieldPath:'cr'},op:'LESS_THAN',value:iv(r.to)}}]}}};
 const o={at:Date.now(),L:null};
 o.p=fsx(':runQuery',{method:'POST',body:JSON.stringify({structuredQuery:sq})}).then(x=>{
  const L=(x||[]).filter(d=>d&&d.document).map(d=>{const t=tkOf(d.document);if(t.cr&&typeof tkDue==='function')t.due=tkDue(t.cr);return t}).filter(t=>t.cr>=r.from&&t.cr<r.to);
  o.L=L;o.p=null;return L}).catch(e=>{delete TC[m];throw e});
 TC[m]=o;return o.p}
function loadSales(m){const c=SC[m];if(c&&(c.v||c.p)&&Date.now()-c.at<TTL)return c.v?Promise.resolve(c.v):c.p;
 if(!window.CxHours||typeof CxHours.get!=='function'||(typeof window.cxSalesPay==='function'&&!window.cxSalesPay()))return Promise.resolve({day:null,hours:null,na:1});
 const o={at:Date.now(),v:null};o.p=Promise.resolve(CxHours.get(m)).then(v=>{o.v=v&&typeof v==='object'?v:{day:{},hours:{}};o.p=null;return o.v}).catch(e=>{delete SC[m];throw e});
 SC[m]=o;return o.p}
const ownT=(L,u)=>u?(L||[]).filter(t=>t&&(t.ow?t.ow===u:Array.isArray(t.to)&&t.to.includes(u))).map(t=>({id:t.id,n:str(t.txt).slice(0,40),dl:t.dl,due:t.due,st:t.st,sub:t.sub,late:t.late})):[];
/* מצב הנתונים לעובד/חודש: {st:'ok'|'load'|'err', ctx?, err?, noUid?, noCx?} */
const ST={};
function ctxOf(s,m,peek){const L=act(s),n=need(L),u0=s.pay&&s.pay.uid||'',k=s.id+'|'+m+'|'+(n.tk?'t'+u0:'')+'|'+(n.sl?'s':''),x=ST[k];
 if(!n.any)return{st:'ok',ctx:{now:Date.now()}};
 if(x&&x.st==='ok'&&Date.now()-x.at<TTL)return x;
 if(x&&x.st==='load')return x;
 if(x&&x.st==='err'&&Date.now()-x.at<15000)return x;
 if(peek)return null;
 const u=s.pay&&s.pay.uid||'';const o={st:'load',at:Date.now()};ST[k]=o;
 o.p=Promise.all([n.tk&&u?loadTasks(m):Promise.resolve([]),n.sl?loadSales(m):Promise.resolve(null)]).then(([T,X])=>{
  o.ctx={tasks:ownT(T,u),now:Date.now()};if(X&&X.day){o.ctx.salesByDay=X.day;o.ctx.salesByHour=X.hours||{}}
  o.noUid=n.tk&&!u;o.noTk=n.tk&&!!u&&!Array.isArray(T);o.noCx=n.sl&&(!X||X.na);o.st='ok';o.at=Date.now();return o}).catch(e=>{o.st='err';o.err=e&&e.message||'הטעינה נכשלה';o.at=Date.now();return o});
 o.p.then(()=>{try{if(cur().v==='payMon')U.re()}catch(e){}});
 return o}
/* payroll.js: נתוני החישוב לעובד/חודש (או null כשעוד לא נטענו – אז החישוב בלי רכיבים) */
function ctxReady(s,m){if(!s||!s.pay||!Array.isArray(s.pay.comp))return null;const x=ctxOf(s,m,true);return x&&x.st==='ok'?x.ctx:null}/* בלי טעינה – רק מה שכבר נטען */
const ensure=(s,m)=>{const x=ctxOf(s,m);return x.st==='load'?x.p:Promise.resolve(x)};
/* נתונים חסרים לחישוב הרכיבים (x = ctxOf במצב ok). מחזיר רשימת סיבות; ריקה = אפשר לאשר אוטומטית */
function gaps(s,m,x){if(!x||x.st!=='ok')return['הנתונים עוד לא נטענו'];const g=[];
 if(x.noUid)g.push('העובד לא מקושר למשתמש באפליקציה – אין משימות לחישוב');
 if(x.noTk)g.push('המשימות לא נטענו');
 if(x.noCx)g.push('אין נתוני מכירות מכספית לחודש');
 else if(need(act(s)).sl){const w=PC.compSum(s,m,Object.assign({wh:U.AR('wh')},x.ctx)).warnings;w.filter(t=>/חסרים נתוני מכירות|אין נתוני מכירות/.test(t)).forEach(t=>g.push(t))}
 return[...new Set(g)]}

/* ---- מסך הגדרות שכר: רשימת רכיבים, כלל חופשי, מתג תצוגה ---- */
function draftX(s,p){const q=s.pay&&typeof s.pay==='object'?s.pay:{};p.comp=Array.isArray(q.comp)?clone(q.comp).filter(c=>c&&typeof c==='object'):[];p.comp0=Array.isArray(q.comp);p.show=!!q.show;p.show0=q.show!==undefined;p.ab0=typeof q.ab==='string'?q.ab:'';p.aiT=''}
function pullX(f,p){if(!p.comp)return;const e=f.elements;if(e.show)p.show=e.show.checked;if(e.aiT)p.aiT=e.aiT.value}
function buildX(p,o){if(!p.comp)return{};const r={};
 if(p.comp.length||p.comp0){const L=[];for(let i=0;i<p.comp.length;i++){const v=PC.validComp(p.comp[i]);if(!v.ok)return 'רכיב שכר '+(i+1)+': '+v.err;L.push(v.comp)}r.comp=L;
  if(L.length&&!p.comp0&&!p.ab0)r.ab=prevMon(U.curMon())}
 if(p.show&&!o.uid)return 'כדי שהעובד יראה את השכר שלו – קשרו אותו למשתמש באפליקציה';
 if(p.show||p.show0)r.show=!!p.show;
 return r}
function cfgH(s,p){if(!p.comp)return'';let h=`<div class="sec"><h3>רכיבי שכר נוספים</h3></div><p class="note">הבסיס (שעתי/חודשי, תעריפים ותוספות) – למעלה. כאן בונוסים לפי ביצועים. בחודש השוטף הם "צפוי", ונכנסים לתשלום רק אחרי אישור בסוף החודש.</p>`;
 h+=p.comp.length?p.comp.map((c,i)=>{const v=PC.validComp(c),cc=v.ok?v.comp:c,off=v.ok&&!cc.on;
  return `<div class="card" data-comp="${i}"><div class="row" style="justify-content:space-between;align-items:center;flex-wrap:nowrap;gap:8px"><b style="min-width:0;overflow-wrap:anywhere">${esc(cc.n||KN[cc.k]||'רכיב')}</b>${off?'<span class="tag">מושבת</span>':cc.ai?'<span class="tag t3">מכלל בכתב</span>':''}</div>
<div class="note" style="margin:6px 0">${esc(descr(c))}</div>${cc.src?`<div class="note" style="margin:0 0 6px;overflow-wrap:anywhere">"${esc(cc.src)}"</div>`:''}
<div class="row" style="gap:6px"><button type="button" class="btn g s grow" data-a="payCompEd" data-i="${i}">עריכה</button><button type="button" class="btn g s grow" data-a="payCompOn" data-i="${i}">${off?'הפעלה':'השבתה'}</button><button type="button" class="btn g s grow" data-a="payCompDel" data-i="${i}">מחיקה</button></div></div>`}).join(''):'<p class="note">אין רכיבים נוספים.</p>';
 if(p.comp.length<MAXC)h+=`<button type="button" class="btn g w" ${big} data-a="payCompEd">＋ רכיב שכר</button>`;
 h+=`<div class="card" style="margin-top:10px"><label class="f" style="margin:0"><span>כלל בכתב חופשי</span><textarea name="aiT" rows="3" maxlength="${MAXAI}" placeholder="למשל: אם כל המשימות בזמן – 150 ש&quot;ח; 2% מהמכירות מעל 30,000" style="width:100%;box-sizing:border-box">${esc(p.aiT||'')}</textarea></label><p class="note" style="margin:6px 0">עד ${MAXAI} תווים, <b>בלי שמות של עובדים</b>. המערכת תציג מה הבינה, ושום דבר לא יישמר בלי אישור.</p><button type="button" class="btn g w" ${big} data-a="payAi">פענוח הכלל</button></div>`;
 const u=!!p.uid;
 h+=`<div class="sec"><h3>תצוגה לעובד</h3></div><div class="card"><label class="cb"><input type="checkbox" name="show" value="1"${p.show?' checked':''}${u||p.show?'':' disabled'}> העובד רואה את השכר שלו</label><p class="note" style="margin:0">${u?'כבוי – העובד לא רואה דבר. דלוק – יראה רק את השכר שלו (המסך לעובד יתווסף בהמשך).':'אפשר להפעיל רק אחרי קישור העובד למשתמש באפליקציה (למעלה).'}</p></div>`;
 return h}

/* ---- עורך רכיב (חלון) ---- */
const ED={i:-1,c:null};
const cxOn=()=>typeof window.cxSalesPay==='function'&&window.cxSalesPay(); // 19.11.2026: בלי התוספת "מכירות כספית" – אין בונוס מכירות חדש
const blank=k=>k==='tk'?{k,m:'all',a:''}:k==='sl'?{k,t:[{min:'',a:''}],ss:'day'}:k==='pc'?{k,p:'',th:'',ss:'day'}:{k:'man'};
function edH(){const c=ED.c,ch=(k,l)=>`<button type="button" class="chip${c.k===k?' on':''}" aria-pressed="${c.k===k}" data-a="payCompK" data-v="${k}">${l}</button>`;
 const G='style="display:grid;grid-template-columns:1fr 1fr auto;gap:6px;align-items:end"';
 let h=`<h3>${ED.i>=0?'עריכת רכיב':'רכיב שכר חדש'}</h3><form data-f="payCompF" novalidate><div class="chips" role="group" aria-label="סוג רכיב" style="margin-bottom:10px;flex-wrap:wrap">${ch('tk','משימות בזמן')}${cxOn()||c.k==='sl'?ch('sl','מדרגות מכירות'):''}${cxOn()||c.k==='pc'?ch('pc','אחוז ממכירות'):''}${ch('man','ידני')}</div>`;
 h+=fld('שם (לא חובה)','n',str(c.n),'text',`maxlength="60" autocomplete="off" placeholder="${esc(KN[c.k])}"`);
 const tiers=(a,b,la,lb)=>(c.t||[]).map((u,i)=>`<div ${G}>${fld(la,'t'+i+'x',str(u[a]),'text','inputmode="decimal" autocomplete="off"')}${fld(lb,'t'+i+'a',str(u.a),'text','inputmode="decimal" autocomplete="off"')}<button type="button" class="btn g s" style="min-height:44px;margin-bottom:10px" data-a="payCompTD" data-i="${i}" aria-label="מחיקת מדרגה">✕</button></div>`).join('')+((c.t||[]).length<MAXT?`<button type="button" class="btn g w" ${big} data-a="payCompTA">＋ מדרגה</button>`:'');
 const ss=()=>selO('על אילו מכירות','ss',[['day',SSN.day],['hrs',SSN.hrs]],c.ss==='hrs'?'hrs':'day')+`<label class="cb"><input type="checkbox" name="amt" value="1"${c.amt?' checked':''}> להציג לעובד סכומים (אחרת – רק אחוז מהיעד)</label>`;
 if(c.k==='tk'){h+=selO('איך מחשבים','m',[['all','סכום קבוע אם כל המשימות בזמן'],['tier','מדרגות לפי אחוז המשימות בזמן']],c.m==='tier'?'tier':'all');
  h+=c.m==='tier'?tiers('p','a','מ-% בזמן','בונוס (₪)'):fld('בונוס (₪)','a',str(c.a),'text','inputmode="decimal" autocomplete="off"');
  h+='<p class="note">משימה בזמן – לפי היעד שלה במסך המשימות. משימה בלי יעד לא נספרת.</p>'}
 else if(c.k==='sl'){h+=tiers('min','a','ממכירות של (₪)','בונוס (₪)')+ss()+'<p class="note">מקבלים את המדרגה הגבוהה שהושגה בחודש.</p>'}
 else if(c.k==='pc'){h+=`<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${fld('אחוז (%)','p',str(c.p),'text','inputmode="decimal" autocomplete="off"')}${fld('רק מעל (₪, לא חובה)','th',str(c.th),'text','inputmode="decimal" autocomplete="off"')}</div>`+ss()}
 else h+='<p class="note">בלי חישוב: בכל חודש יופיע כתזכורת, והמנהל רושם את הסכום כבונוס.</p>';
 h+=`<div class="row" style="margin-top:8px"><button type="submit" class="btn grow" ${big}>אישור</button><button type="button" class="btn g grow" ${big} data-a="closeDlg">ביטול</button></div><p class="note">הרכיב נשמר בלחיצה על "שמירה" בהגדרות השכר.</p></form>`;
 return h}
function edPull(){const f=document.querySelector('#dlg form[data-f=payCompF]'),c=ED.c;if(!f||!c)return;const e=f.elements,g=n=>e[n]?e[n].value:undefined;
 if(g('n')!==undefined)c.n=g('n');if(g('m')!==undefined)c.m=g('m');['a','p','th','ss'].forEach(k=>{if(g(k)!==undefined)c[k]=g(k)});if(e.amt)c.amt=e.amt.checked?1:0;
 if(Array.isArray(c.t))c.t.forEach((u,i)=>{const x=g('t'+i+'x'),a=g('t'+i+'a');if(x!==undefined)u[c.k==='sl'?'min':'p']=x;if(a!==undefined)u.a=a})}
function edOpen(i,c){ED.i=i;ED.c=clone(c);dlg(edH())}
ACT.payCompEd=el=>{if(!on())return;const P=U.PD.p;if(!P||!P.comp)return;U.pull();const i=el&&el.dataset&&el.dataset.i!==undefined?+el.dataset.i:-1;
 if(i>=0&&P.comp[i])edOpen(i,P.comp[i]);else{if(P.comp.length>=MAXC)return toast('עד '+MAXC+' רכיבים');edOpen(-1,blank('tk'))}};
ACT.payCompK=el=>{if(!ED.c)return;edPull();const k=el.dataset.v;if(!KN[k]||k===ED.c.k)return;const b=blank(k);b.n=ED.c.n;if(ED.c.id)b.id=ED.c.id;if(ED.c.src)b.src=ED.c.src;ED.c=b;dlg(edH())};
ACT.payCompTA=()=>{if(!ED.c)return;edPull();const c=ED.c;if(!Array.isArray(c.t))c.t=[];if(c.t.length>=MAXT)return;c.t.push(c.k==='sl'?{min:'',a:''}:{p:'',a:''});dlg(edH())};
ACT.payCompTD=el=>{if(!ED.c||!Array.isArray(ED.c.t))return;edPull();if(ED.c.t.length<=1)return toast('צריך לפחות מדרגה אחת');ED.c.t.splice(+el.dataset.i,1);dlg(edH())};
document.addEventListener('change',e=>{const t=e.target;if(t&&t.name==='m'&&t.closest&&t.closest('#dlg form[data-f=payCompF]')&&ED.c&&ED.c.k==='tk'){edPull();if(ED.c.m==='tier'&&!(Array.isArray(ED.c.t)&&ED.c.t.length))ED.c.t=[{p:'',a:''}];dlg(edH())}});
FRM.payCompF=()=>{if(!on()||!ED.c)return;const P=U.PD.p;if(!P||!P.comp)return closeDlg();edPull();const c=ED.c;
 const o={id:c.id||'c'+uid(),k:c.k,n:str(c.n).trim(),on:c.on===undefined?true:c.on};if(c.src)o.src=c.src;if(c.ai)o.ai=1;
 const pn=v=>{const n=typeof pNum==='function'?pNum(v):Number(v);return typeof n==='number'&&isFinite(n)?n:str(v)};
 if(c.k==='tk'){o.m=c.m==='tier'?'tier':'all';if(o.m==='all')o.a=pn(c.a);else o.t=(c.t||[]).map(u=>({p:pn(u.p),a:pn(u.a)}))}
 else if(c.k==='sl'){o.t=(c.t||[]).map(u=>({min:pn(u.min),a:pn(u.a)}));o.ss=c.ss==='hrs'?'hrs':'day';if(c.amt)o.amt=1}
 else if(c.k==='pc'){o.p=pn(c.p);if(str(c.th).trim())o.th=pn(c.th);o.ss=c.ss==='hrs'?'hrs':'day';if(c.amt)o.amt=1}
 if(c.k==='tk'&&o.m==='all'&&!(PC.num(o.a)>0))return toast('סכום הבונוס: מספר חיובי');
 if((c.k==='sl'||(c.k==='tk'&&o.m==='tier'))&&o.t.some(u=>!(PC.num(u.a)>0)))return toast('בכל מדרגה: בונוס חיובי');
 const v=PC.validComp(o);if(!v.ok)return toast(v.err);
 if(ED.i>=0&&P.comp[ED.i])P.comp[ED.i]=v.comp;else P.comp.push(v.comp);
 ED.c=null;closeDlg();toast('הרכיב עודכן – לחצו "שמירה" כדי לשמור');rerender()};
ACT.payCompOn=el=>{if(!on())return;const P=U.PD.p;if(!P||!P.comp)return;U.pull();const c=P.comp[+el.dataset.i];if(!c)return;const v=PC.validComp(c);c.on=!(v.ok?v.comp.on:true);rerender()};
ACT.payCompDel=el=>{if(!on())return;const P=U.PD.p;if(!P||!P.comp)return;U.pull();const i=+el.dataset.i;if(!P.comp[i])return;
 ask('למחוק את הרכיב? (נמחק בשמירה. בונוסים שכבר אושרו נשארים)',()=>{P.comp.splice(i,1);closeDlg();rerender()},'מחיקה')};

/* ---- כלל בכתב חופשי ---- */
const AI={r:null,text:'',busy:false};
const fnc=(n,d)=>{d=d&&typeof d==='object'?d:{};if(typeof SY!=='undefined'&&SY&&SY.sa&&SY.bizId&&!('bizId'in d))d=Object.assign({bizId:SY.bizId},d);return window.fnCall(n,d)};
function baseTxt(b){const a=[];if(!b||typeof b!=='object')return a;
 if(b.mode==='hr'||b.mode==='mo')a.push('סוג שכר: '+(b.mode==='mo'?'חודשי קבוע':'לפי שעה'));
 if(PC.num(b.rate)!==null)a.push('תעריף לשעה: '+sh(b.rate));if(PC.num(b.mo)!==null)a.push('שכר חודשי: '+sh(b.mo));
 (Array.isArray(b.add)?b.add:[]).forEach(x=>a.push('תוספת "'+str(x.n)+'": '+sh(x.a)+(x.k==='day'?' ליום עבודה':' לחודש')));
 const DN=['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳'];(Array.isArray(b.rules)?b.rules:[]).forEach(x=>a.push('תעריף '+sh(x.r)+' לשעה בימים '+(Array.isArray(x.d)?x.d.map(d=>DN[d]||'?').join(','):'')+' '+str(x.s)+'–'+str(x.e)));
 return a}
const LN=(a,b)=>`<div class="row" style="justify-content:space-between;margin:4px 0;flex-wrap:nowrap;gap:8px"><span style="min-width:0">${a}</span><b style="white-space:nowrap">${b}</b></div>`;
function exampleH(s,comp){const m=U.curMon(),x=ctxOf(Object.assign({},s,{pay:Object.assign({},s.pay||{},{comp})}),m);
 if(x.st==='load')return '<p class="note" data-aiex="load">טוען נתונים לדוגמת חישוב…</p>';
 if(x.st!=='ok')return '<p class="note">אין נתונים לדוגמת חישוב כרגע.</p>';
 const r=PC.compSum({id:s.id,pay:{comp}},m,Object.assign({wh:U.AR('wh')},x.ctx));
 if(!r.items.length)return '';
 return `<div class="card" data-aiex="ok"><b>דוגמה – ${esc(typeof mfmt==='function'?mfmt(m):m)} עד עכשיו</b>${r.items.map(it=>LN(esc(it.n)+'<br><small class="note">'+esc(it.det[0]||'')+'</small>',it.man?'ידני':U.ag(it.amt))).join('')}</div>`}
function aiDlg(){const r=AI.r,s=U.empOf(U.PD.sub);if(!r||!s)return;
 const comp=(Array.isArray(r.comp)?r.comp:[]).map(c=>PC.validComp(c)).filter(v=>v.ok).map(v=>v.comp),bt=baseTxt(r.base);
 let h=`<h3>הבנתי כך:</h3><p>${esc(str(r.explain))}</p>`;
 h+=comp.map(c=>`<div class="card"><b>${esc(c.n)}</b><div class="note" style="margin:4px 0 0">${esc(descr(c))}</div></div>`).join('');
 if(bt.length)h+=`<div class="card"><b>שינוי בבסיס השכר</b>${bt.map(t=>`<div class="note" style="margin:4px 0 0">${esc(t)}</div>`).join('')}</div>`;
 if(!comp.length&&!bt.length)h+='<p class="note">לא זוהה רכיב לשמירה.</p>';
 if(str(r.unsure).trim())h+=`<div class="card"><span class="tag t1">לא ברור</span><div class="note" style="margin:4px 0 0">${esc(str(r.unsure))}</div></div>`;
 if(r.dropped)h+=`<p class="note">${+r.dropped} חלקים לא הובנו ולא ייכנסו${Array.isArray(r.errs)&&r.errs.length?': '+esc(r.errs.slice(0,5).join(' · ')):''}.</p>`;
 h+=exampleH(s,comp);
 h+=`<div class="row" style="margin-top:10px"><button type="button" class="btn grow" ${big} data-a="payAiOk"${comp.length||bt.length?'':' disabled'}>אישור</button><button type="button" class="btn g grow" ${big} data-a="payAiFix"${comp.length||bt.length?'':' disabled'}>תיקון</button><button type="button" class="btn g grow" ${big} data-a="payAiNo">ביטול</button></div><p class="note">אישור שומר בהגדרות השכר רק את מה שמוצג כאן. תיקון מעביר לעורך בלי לשמור.</p>`;
 dlg(h);
 const x=ctxOf(Object.assign({},s,{pay:Object.assign({},s.pay||{},{comp})}),U.curMon());if(x.st==='load')x.p.then(()=>{if(AI.r===r&&document.querySelector('#dlg[open] [data-aiex=load]'))aiDlg()})}
function failDlg(msg){AI.r=null;dlg(`<h3>לא הצלחתי לפענח את הכלל</h3><p>${esc(msg)}</p><div style="display:grid;gap:8px;margin-top:10px"><button type="button" class="btn g w" ${big} data-a="payAiRe">לנסח מחדש</button><button type="button" class="btn g w" ${big} data-a="payAiMan">לבחור סוג ידנית</button><button type="button" class="btn g w" ${big} data-a="payAiAsMan">לשמור כבונוס ידני</button><button type="button" class="btn g w" ${big} data-a="payAiNo">ביטול</button></div>`)}
ACT.payAi=async()=>{if(!on()||AI.busy)return;const P=U.PD.p;if(!P||!P.comp)return;U.pull();const t=str(P.aiT).trim();
 if(!t)return toast('כתבו את הכלל לפני הפענוח');if(t.length>MAXAI)return toast('הכלל ארוך מדי – עד '+MAXAI+' תווים');
 if(typeof window.fnCall!=='function')return failDlg('הפענוח עוד לא זמין, אפשר להגדיר ידנית.');
 const base={mode:P.mode==='mo'?'mo':'hr'};const n=v=>{const x=typeof pNum==='function'?pNum(v):Number(v);return typeof x==='number'&&isFinite(x)&&x>=0?x:null};if(n(P.rate)!==null)base.rate=n(P.rate);if(n(P.mo)!==null)base.mo=n(P.mo);
 AI.busy=true;AI.text=t;const b=document.querySelector('[data-a=payAi]');if(b){b.disabled=true;b.textContent='מפענח…'}
 let r=null,err=null;try{r=await fnc('payRuleAi',{text:t,base})}catch(e){err=e}
 AI.busy=false;if(cur().v!=='payCfg')return;const b2=document.querySelector('[data-a=payAi]');if(b2){b2.disabled=false;b2.textContent='פענוח הכלל'}
 if(err){const known=err.reason&&err.reason!=='internal';return failDlg(known?str(err.message):err.offline&&navigator.onLine===false?'אין חיבור לאינטרנט. אפשר לנסות שוב או להגדיר ידנית.':'הפענוח עוד לא זמין, אפשר להגדיר ידנית.')}
 if(!r||typeof r!=='object'||r.ok!==true){return failDlg((r&&str(r.explain).trim()?str(r.explain)+' ':'')+(r&&str(r.unsure).trim()?str(r.unsure)+' ':'')+'אפשר לנסח מחדש, לבחור סוג רכיב ידנית או לשמור כבונוס ידני.')}
 AI.r=r;aiDlg()};
/* מכניס את התוצאה לטיוטה (בלי שמירה) */
function aiApply(r){const P=U.PD.p;const comp=(Array.isArray(r.comp)?r.comp:[]).map(c=>PC.validComp(c)).filter(v=>v.ok).map(v=>v.comp);
 if(P.comp.length+comp.length>MAXC){toast('עד '+MAXC+' רכיבים');return false}
 comp.forEach(c=>{if(P.comp.some(x=>x&&x.id===c.id))c.id='c'+uid();P.comp.push(c)});
 const b=r.base&&typeof r.base==='object'?r.base:null;
 if(b){if(b.mode==='hr'||b.mode==='mo')P.mode=b.mode;if(PC.num(b.rate)!==null)P.rate=str(b.rate);if(PC.num(b.mo)!==null)P.mo=str(b.mo);
  (Array.isArray(b.add)?b.add:[]).forEach(a=>{if(a&&P.add.length<20)P.add.push({id:uid(),n:str(a.n),k:a.k==='day'?'day':'mo',a:str(a.a)})});
  (Array.isArray(b.rules)?b.rules:[]).forEach(x=>{if(x&&P.rules.length<20)P.rules.push({id:uid(),d:Array.isArray(x.d)?x.d.map(Number).filter(k=>Number.isInteger(k)&&k>=0&&k<=6):[],s:str(x.s),e:str(x.e),r:str(x.r)})})}
 return true}
/* אישור שומר רק את מה שהוצג בחלון: טיוטה נקייה מההגדרות השמורות + הפענוח. שינויים אחרים בטופס (שלא נשמרו) נשארים בטופס, לא שמורים */
ACT.payAiOk=()=>{if(!on()||!AI.r||!U.PD.p)return;const s=U.empOf(U.PD.sub);if(!s||typeof U.draftC!=='function')return;U.pull();const r=AI.r,pend=clone(U.PD.p),d0=U.draftC(s);
 const nid=L=>(Array.isArray(L)?L:[]).map(x=>Object.assign({},x,{id:''})),key=o=>JSON.stringify(Object.assign({},o,{aiT:'',rules:nid(o.rules),add:nid(o.add)}))/* בלי id של כלל/תוספת – draft מייצר id חדש לרשומה ישנה בלי id */,dirty=key(pend)!==key(d0);
 U.PD.p=d0;if(!aiApply(r)){U.PD.p=pend;return}AI.r=null;closeDlg();
 if(!U.saveCfg(true)){U.PD.p=Object.assign(pend,{aiT:''});rerender();return}
 if(dirty){U.PD.p=Object.assign(pend,{aiT:''});if(aiApply(r)){rerender();toast('הכלל נשמר. שינויים אחרים בטופס עוד לא נשמרו – לשמירה לחצו "שמירה"')}else{U.PD.p=U.draftC(U.empOf(s.id)||s);rerender()}}};
ACT.payAiFix=()=>{if(!on()||!AI.r||!U.PD.p)return;const r=AI.r;if(!aiApply(r))return;AI.r=null;closeDlg();rerender();toast('הערכים הועברו לעורך – בדקו ולחצו "שמירה"');
 const P=U.PD.p,n=(Array.isArray(r.comp)?r.comp:[]).filter(c=>PC.validComp(c).ok).length;if(n)edOpen(P.comp.length-n,P.comp[P.comp.length-n])};
ACT.payAiNo=()=>{AI.r=null;closeDlg()};
ACT.payAiRe=()=>{closeDlg();const t=document.querySelector('#main textarea[name=aiT]');if(t){t.focus();try{t.select()}catch(e){}}};
ACT.payAiMan=()=>{closeDlg();ACT.payCompEd({dataset:{}})};
ACT.payAiAsMan=()=>{if(!on()||!U.PD.p)return;const P=U.PD.p,t=AI.text||str(P.aiT).trim();if(!t)return closeDlg();if(P.comp.length>=MAXC)return toast('עד '+MAXC+' רכיבים');
 const snap=clone(P);P.comp.push({id:'c'+uid(),k:'man',n:t.slice(0,80),on:true,src:t.slice(0,MAXAI)});P.aiT='';closeDlg();
 if(!U.saveCfg(true)){Object.assign(U.PD.p,snap);rerender()}};

/* ---- שכר חודשי: טבלת רכיבים, צפוי, מה אפשר לשפר, אישור בונוסים ---- */
function monH(s,m,r){if(!s.pay||!Array.isArray(s.pay.comp)||!s.pay.comp.length)return'';
 const x=ctxOf(s,m),cm=U.curMon();let h=`<div class="sec"><h3>רכיבי שכר</h3></div>`;
 if(x.st==='load')return h+'<p class="note" data-comp-st="load">טוען משימות ומכירות לחישוב…</p>';
 if(x.st==='err')return h+`<div class="card" data-comp-st="err"><span class="tag t1">לא נטען</span><div class="note">${esc(x.err||'')} – הרכיבים לא חושבו. נסו שוב בעוד רגע.</div><button type="button" class="btn g w" ${big} data-a="payCompRe">ניסיון נוסף</button></div>`;
 const L=Array.isArray(r.comp)?r.comp:[];
 if(!L.length)return h+'<p class="note">אין רכיבים פעילים.</p>';
 const DL=new Set(U.AR('bon').filter(b=>b&&b.sub===s.id&&b.mon===m&&b.src==='auto'&&b.del).map(b=>b.cid));
 const fut=m>cm,past=m<cm;
 h+=`<div class="card" data-comp-tbl>`+LN('<b>רכיב</b>','<b>'+(past?'סכום':'צפוי')+'</b>')+L.map(it=>{const st=it.appr&&!it.bonA&&DL.has(it.id)?'<span class="tag" data-cdel>בוטל</span>':it.appr?'<span class="tag t3">אושר</span>':it.man?'<span class="tag">ידני</span>':past?'<span class="tag t1">ממתין לאישור</span>':'<span class="tag">צפוי</span>';
  const v=it.appr?U.ag(it.bonA):it.man?'—':U.ag(it.amt);
  return `<button type="button" class="li" data-a="payCompBrk" data-cid="${esc(it.id)}" style="width:100%;font:inherit;color:inherit;text-align:inherit;cursor:pointer"><div class="m"><b>${esc(it.n)}</b><small>${st}${it.byDay?' · <span data-byday>לפי יום (אין שעות)</span>':''}${it.est?' · הערכה':''}</small></div><div class="a" style="white-space:nowrap">${v}</div></button>`}).join('');
 h+=LN('בונוס צפוי (לא נכלל ב"נשאר להעביר")','<span data-exp>'+U.ag(r.exp||0)+'</span>')+`</div>`;
 if(x.noUid)h+='<p class="note">העובד לא מקושר למשתמש באפליקציה – אין משימות לחישוב.</p>';
 if(x.noCx)h+='<p class="note">אין נתוני מכירות מכספית – רכיבי המכירות נספרים 0.</p>';
 const pend0=L.some(it=>!it.appr&&!it.man),G=past&&pend0?gaps(s,m,x):[];
 if(G.length)h+=`<div class="card" data-gaps><span class="tag t1">לא אושר אוטומטית – חסרים נתונים</span>${G.map(t=>`<div class="note" style="margin:4px 0 0">• ${esc(t)}</div>`).join('')}<div class="note" style="margin:4px 0 0">אפשר להשלים את הנתונים (למשל ייבוא מכספית) ולחזור, או לאשר ידנית לפי החישוב הנוכחי.</div></div>`;
 if(Array.isArray(r.hints)&&r.hints.length)h+=`<div class="card" data-hints><b>מה אפשר לשפר</b>${r.hints.slice(0,8).map(t=>`<div class="note" style="margin:4px 0 0">• ${esc(t.t)}</div>`).join('')}</div>`;
 const pend=L.filter(it=>!it.appr&&!it.man);
 if(past&&pend.length)h+=`<button type="button" class="btn w" ${big} data-a="payAppr">אשר בונוסים ל${esc(typeof mfmt==='function'?mfmt(m):m)}</button><p class="note">הבונוסים יירשמו בבונוס החודשי. אחר כך אפשר לערוך או לבטל כל אחד, והחישוב החי שלהם נעצר.</p>`;
 else if(!past&&!fut&&pend.length)h+=`<p class="note">בסוף החודש (מה-3 בחודש הבא) הבונוסים יאושרו אוטומטית, ואפשר גם לאשר ידנית.</p>`;
 return h}
ACT.payCompRe=()=>{const s=U.empOf(U.PM.sub);if(!s)return;const k0=s.id+'|'+U.PM.mon+'|';Object.keys(ST).forEach(k=>{if(k.startsWith(k0))delete ST[k]});U.re()};
ACT.payCompBrk=el=>{if(!on())return;const s=U.empOf(U.PM.sub);if(!s)return;const r=U.monSum(s,U.PM.mon);if(!r||!Array.isArray(r.comp))return;const it=r.comp.find(x=>x.id===el.dataset.cid);if(!it)return;
 const c=(s.pay.comp||[]).find(x=>x&&x.id===it.id);
 let b=`<p class="note">${esc(c?descr(c):'')}</p>`+it.det.map(t=>`<div class="note" style="margin:4px 0">${esc(t)}</div>`).join('');
 if(it.appr)b+=LN('אושר כבונוס',U.ag(it.bonA))+'<p class="note">אחרי האישור הסכום לא מחושב מחדש. עריכה או ביטול – ברשימת הבונוסים.</p>';
 else if(!it.man)b+=LN('לפי החישוב עכשיו',U.ag(it.amt));
 if(!it.appr&&it.hints.length)b+='<div class="sec"><h3>מה אפשר לשפר</h3></div>'+it.hints.map(h=>`<div class="note" style="margin:4px 0">• ${esc(h.t)}</div>`).join('');
 dlg(`<h3>${esc(it.n)}</h3>${b}<button type="button" class="btn g w" style="margin-top:12px" data-a="closeDlg">סגירה</button>`)};
/* יצירת רשומות bon לחודש. מחזיר מספר הרשומות (או null כשהנתונים לא זמינים) */
function approve(s,m,ctx){const L=PC.autoBon(s,m,Object.assign({wh:U.AR('wh'),bon:U.AR('bon')},ctx));
 L.forEach(b=>U.AR('bon').push(Object.assign({id:uid()},b)));
 if(!(typeof s.pay.ab==='string'&&s.pay.ab>=m))s.pay.ab=m;return L.length}
ACT.payAppr=()=>{if(!on())return;const s=U.empOf(U.PM.sub),m=U.PM.mon;if(!s||!s.pay||!(m<U.curMon()))return;const x=ctxOf(s,m);if(x.st!=='ok')return toast('הנתונים עוד לא נטענו');
 const n=PC.autoBon(s,m,Object.assign({wh:U.AR('wh'),bon:U.AR('bon')},x.ctx)).length;if(!n)return toast('אין בונוסים לאישור');
 const G=gaps(s,m,x);
 ask((G.length?'שימו לב – חסרים נתונים: '+G.join(' · ')+'. הבונוסים יאושרו לפי החישוב הנוכחי (ייתכן שנמוך מהנכון). ':'')+'לאשר '+n+' בונוסים לחודש '+(typeof mfmt==='function'?mfmt(m):m)+'? אחרי האישור הסכום לא מחושב מחדש, ואפשר לערוך או לבטל.',()=>{const x2=ctxOf(s,m);if(x2.st!=='ok'){closeDlg();return toast('הנתונים לא זמינים')}
  const k=approve(s,m,x2.ctx);save();closeDlg();toast(k?'אושרו '+k+' בונוסים':'אין בונוסים לאישור');rerender()},'אישור')};
/* אישור אוטומטי: מכשיר המנהל, מה-3 בחודש, לחודש הקודם, פעם אחת לכל עובד (pay.ab) */
let autoRan=false;
window.payAutoAppr=async()=>{try{if(autoRan||!on()||typeof S==='undefined'||!S||!Array.isArray(S.subs))return 0;
 const cm=U.curMon(),d=new Date().getDate();if(d<3)return 0;autoRan=true;const tgt=prevMon(cm);let n=0,emp=0,ch=false;
 for(const s of S.subs.slice()){const e=s&&U.empOf(s.id);if(!e||!e.pay||!Array.isArray(e.pay.comp))continue;
  if(typeof e.pay.ab==='string'&&e.pay.ab>=tgt)continue;if(typeof e.pay.from==='string'&&/^\d{4}-\d{2}$/.test(e.pay.from)&&e.pay.from>tgt)continue;
  if(!need(act(e)).any){continue}
  const x=await ensure(e,tgt);if(!x||x.st!=='ok')continue;if(gaps(e,tgt,x).length)continue;/* חסרים נתונים – נשאר "ממתין לאישור" עם הסיבה במסך */
  const k=approve(e,tgt,x.ctx);n+=k;if(k)emp++;ch=true}
 if(ch)save();if(emp){toast('אושרו אוטומטית בונוסים ל'+(typeof mfmt==='function'?mfmt(tgt):tgt)+': '+emp+' עובדים');try{rerender()}catch(e){}}
 return n}catch(e){return 0}};

window.PayComp={draftX,pullX,buildX,cfgH,monH,ctxReady,ensure,gaps,descr,_reset:()=>{Object.keys(ST).forEach(k=>delete ST[k]);Object.keys(TC).forEach(k=>delete TC[k]);Object.keys(SC).forEach(k=>delete SC[k]);autoRan=false}};
})();
