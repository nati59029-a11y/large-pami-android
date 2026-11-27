/* עלות מוצרי אפייה – שלב ב' (docs/bakery-cost-plan.md, החלטות בעל הפרויקט 26.11.2026). נטען אחרי pricing.js ו-bake-calc.js.
   מי רואה: רק כשתוספת bake דלוקה ובמבנה b. מנהל (או מנהל־על בעסק) תמיד; עובד – רק עם המתג perms.bake. כולם רואים ועורכים; מחיקה – מנהל בלבד,
   לאחרים "הסתר" (off:1 בתוך j). כל הסכומים לפני מע"מ.
   נתונים: b/{bizId}/bake/{id} = {t:'i'|'c'|'p', j:<JSON 2..16000>, at:<זמן העריכה בטלפון, ms>, by:<המשתמש עצמו>} (החוקים: bakeOk).
   עותק לקריאה במכשיר: lp-bake-<bizId>. תור שמירות: lp-bakeq-<bizId> – שמירה בלי חיבור נכנסת לתור ונשלחת כשהחיבור חוזר (online / כל דקה / כניסה למסך).
   כל שמירה: PATCH עם currentDocument.updateTime (רשומה חדשה: exists=false). התנגשות → קוראים שוב ומחילים את הכלל (BakeCalc.resolve):
   עדכון מחיר בפריט – ההיסטוריה ממוזגת (התאריך המאוחר = המחיר הנוכחי); עריכה אחרת – at המאוחר גובר, והצד שהפסיד מקבל הודעה.
   ספקים: סוג ספק (bt: 'bake'/'pack'/'reg') בכרטיס הספק של המנהל; סימון חד־פעמי של ספקי e_bak בלי bt כ-['bake'] (S.bkM).
   גיבוי: BKBK.collect → שדה רשות bkx בקובץ הגיבוי; שחזור – רק יוצר רשומות שחסרות בענן (לא דורס ולא מוחק). */
(function(){'use strict';
if(typeof V==='undefined'||typeof ACT==='undefined'||typeof FRM==='undefined'||typeof fsx!=='function'||typeof bzF!=='function'||!window.BakeCalc)return;
const B=window.BakeCalc;
const ID=/^[A-Za-z0-9_-]{1,40}$/;
const feat=()=>{try{return !!(bzF('bake')&&bzB()&&!SY.mg)}catch(e){return false}};
const mgr=()=>{try{return isA()||!!(SY&&SY.sa)}catch(e){return false}};
const on=()=>{try{return feat()&&(isA()||!!SY.sa||(isW()&&!!SY.perms&&SY.perms.bake===true))}catch(e){return false}};
const bid=()=>String(SY&&SY.bizId||'');
const CK=()=>'lp-bake-'+bid(),QK=()=>'lp-bakeq-'+bid();
const rd=(k,d)=>{try{const v=JSON.parse(localStorage.getItem(k));return v==null?d:v}catch(e){return d}};
const wr=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));return true}catch(e){return false}};
const rid=()=>{const a=new Uint8Array(12);crypto.getRandomValues(a);return 'k'+[...a].map(x=>x.toString(36).padStart(2,'0')).join('').slice(0,20)};
const who=()=>(SY&&SY.uid||'')+'|'+bid();
const isBk=()=>{try{return /^bake/.test(cur().v)}catch(e){return false}};
const dOpen=()=>!!document.querySelector('#dlg[open]');
const redraw=()=>{try{if(isBk()&&!dOpen())rerender()}catch(e){}};
const UN=u=>u==='g'?'גרם':'יח׳';
const KN={bake:'אפייה',pack:'אריזה',reg:'רגיל'};
const m2=v=>v==null?'—':ils(v);
const ucF=v=>v==null?'—':'₪'+(v<1?(+v.toFixed(4)).toString():(+v.toFixed(2)).toString());
const pct=v=>v==null?'—':v+'%';

/* ---------- עיצוב (רק משתני הערכה הקיימים – כהה/זהב) ---------- */
try{if(!document.getElementById('bk-css')){const st=document.createElement('style');st.id='bk-css';st.textContent=
'.bk-sum{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin:0 0 10px}'
+'.bk-sum>div{border:1px solid var(--line);border-radius:12px;background:var(--card);padding:6px 8px;min-width:0}'
+'.bk-sum small{display:block;color:var(--mut);font-size:.72rem;font-weight:600}.bk-sum b{display:block;font-size:.95rem;overflow-wrap:anywhere}'
+'.bk-sum .neg{color:var(--exp)}.bk-sum .pos{color:var(--inc)}'
+'.bk-ln{display:flex;gap:8px;align-items:flex-start;border-bottom:1px solid var(--line);padding:8px 2px}.bk-ln:last-child{border:0}'
+'.bk-ln .m{flex:1;min-width:0}.bk-ln .m b{display:block;overflow-wrap:anywhere}.bk-ln small{display:block;color:var(--mut);font-size:.78rem;overflow-wrap:anywhere}'
+'.bk-ln .v{text-align:left;white-space:nowrap;font-weight:700}.bk-ln .bt{display:flex;gap:4px;flex-wrap:wrap;margin-top:4px}'
+'.bk-ln .bt .btn{min-height:34px;padding:0 10px;font-size:.8rem}'
+'.bk-li .m{flex:1;min-width:0}.bk-li .m b{display:block;overflow-wrap:anywhere}.bk-li small{display:block;color:var(--mut);font-size:.78rem;overflow-wrap:anywhere}'
+'.bk-li .v{text-align:left;font-weight:700;white-space:nowrap}.bk-li .v small{text-align:left}'
+'.bk-tabs{display:flex;gap:6px;margin:0 0 10px}.bk-tabs .chip{flex:1 1 0;min-width:0;justify-content:center;min-height:40px;padding:0 6px;font-size:.85rem;white-space:nowrap}'
+'.bk-acts{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}.bk-acts .btn{flex:1 1 auto;min-width:0}'
+'.bk-h{width:100%;border-collapse:collapse;font-size:.85rem}.bk-h td,.bk-h th{border-bottom:1px solid var(--line);padding:6px 4px;text-align:right}.bk-h .n{text-align:left;white-space:nowrap}'
+'.bk-bt{display:flex;flex-wrap:wrap;gap:6px 14px;margin:4px 0}.bk-bt label{display:flex;gap:6px;align-items:center}.bk-bt input{width:22px;height:22px}'
+'.bk-ps .li{margin-bottom:6px}';
document.head.appendChild(st)}}catch(e){}

/* ---------- נתונים ---------- */
const fresh=()=>({who:who(),R:null,b:0,err:'',at:0,off:0,tab:'p',hid:0,cf:0});
let D=fresh();
const chk=()=>{if(D.who!==who())D=fresh()};
const qGet=()=>{const v=rd(QK(),[]);return Array.isArray(v)?v.filter(q=>q&&ID.test(q.id)&&['i','c','p'].includes(q.t)&&typeof q.j==='string'):[]};
const qSet=L=>wr(QK(),L);
const cacheSave=()=>{if(!D.R)return;wr(CK(),{at:D.at,L:[...D.R.values()]})};
function cacheLoad(){const c=rd(CK(),null);if(c&&Array.isArray(c.L)){D.R=new Map(c.L.filter(x=>x&&ID.test(x.id)).map(x=>[x.id,x]));D.at=+c.at||0;return true}return false}
const decDoc=d=>{const f=d.fields||{};return{id:idOf(d),t:fvj(f.t),j:fvj(f.j),at:+fvj(f.at)||0,by:String(fvj(f.by)||''),u:d.updateTime||''}};
const docOk=x=>x&&ID.test(x.id)&&['i','c','p'].includes(x.t)&&typeof x.j==='string';
async function load(force){chk();if(D.b||!on())return;if(!force&&D.R&&Date.now()-D.at<30e3)return;D.b=1;D.err='';
 try{const r=await fsx(':runQuery',{method:'POST',body:JSON.stringify({structuredQuery:{from:[{collectionId:'bake'}],limit:3000}})});
  const L=(r||[]).filter(x=>x&&x.document).map(x=>decDoc(x.document)).filter(docOk);
  D.R=new Map(L.map(x=>[x.id,x]));D.at=Date.now();D.off=0;cacheSave()}
 catch(e){if(e&&e.code===403)D.err='no';else{D.off=e&&e.offline?1:0;D.err=D.off?'':'הטעינה נכשלה';}if(!D.R&&!cacheLoad()&&D.off)D.R=new Map()}
 finally{D.b=0;redraw()}
 flush()}
/* פענוח (עם זיכרון לפי התוכן) */
const PC=new Map();
function dec(t,j){const k=t+j;if(PC.has(k))return PC.get(k);if(PC.size>6000)PC.clear();const o=B.parse(t,j);PC.set(k,o);return o}
/* כל הרשומות לתצוגה: מהענן / מהמכשיר, ועליהן התור (שינויים שעוד לא נשלחו) */
function recs(){const M=new Map(D.R||[]);for(const q of qGet())M.set(q.id,{id:q.id,t:q.t,j:q.j,at:q.at,pend:1});
 const I=[],C=[],P=[];for(const r of M.values()){const o=dec(r.t,r.j);if(!o)continue;const x={id:r.id,o,at:r.at,pend:!!r.pend};(r.t==='i'?I:r.t==='c'?C:P).push(x)}
 const hc=(a,b)=>String(a.o.n).localeCompare(String(b.o.n),'he');I.sort(hc);C.sort(hc);P.sort(hc);
 return{I,C,P,cm:new Map(C.map(x=>[x.id,x.o]))}}
const find=(L,id)=>L.find(x=>x.id===id)||null;

/* שמירה: לתור, ומשם לענן. po = עדכון מחיר בלבד (בהתנגשות – רק מיזוג היסטוריה) */
function put(t,id,o,po){const j=JSON.stringify(o);if(j.length>16000){toast('הרשומה גדולה מדי');return false}
 const L=qGet(),k=L.findIndex(x=>x.id===id),r=D.R&&D.R.get(id);
 const at=Math.max(Date.now(),k>=0?L[k].at+1:0);
 if(k>=0)Object.assign(L[k],{j,at,po:!!(L[k].po&&po)});else L.push({id,t,j,at,base:r&&r.u||'',nw:!r,po:!!po,n:0});
 if(!qSet(L)){toast('אין מקום בזיכרון המכשיר – השמירה נכשלה');return false}
 if(navigator.onLine===false){D.off=1;toast('נשמר במכשיר – יישלח כשיחזור החיבור')}
 flush();return true}
function setRec(x){if(!D.R)D.R=new Map();D.R.set(x.id,x);cacheSave()}
/* אחרי שליחה מוצלחת: הרשומה מהתור יוצאת – אלא אם המשתמש ערך שוב בינתיים (אז רק מתעדכנת הגרסה שעליה נשלח) */
function done(q,x){setRec(x);const L=qGet(),k=L.findIndex(y=>y.id===q.id);if(k<0)return;
 if(L[k].at===q.at&&L[k].j===q.j)L.splice(k,1);else Object.assign(L[k],{base:x.u,nw:false});qSet(L)}
function drop(q){const L=qGet().filter(y=>!(y.id===q.id&&y.at===q.at));qSet(L)}
const nmOf=q=>{const o=dec(q.t,q.j);return o?o.n:'הרשומה'};
let FL=0,T403=0;
async function flush(){if(FL||!on()||!qGet().length)return;FL=1;let ch=0;
 try{for(let g=0;g<300;g++){const L=qGet();if(!L.length)break;const r=await send(L[0]);if(r==='stop')break;ch=1}}
 finally{FL=0;if(ch)redraw()}}
async function send(q){const me=SY.uid;if(!q.nw&&!q.base)return clash(q);
 const body=JSON.stringify({fields:{t:{stringValue:q.t},j:{stringValue:q.j},at:{integerValue:String(q.at)},by:{stringValue:me}}});
 const pre=q.nw?'currentDocument.exists=false':'currentDocument.updateTime='+encodeURIComponent(q.base);
 try{const d=await fsx('/bake/'+q.id+'?'+pre,{method:'PATCH',body});D.off=0;done(q,{id:q.id,t:q.t,j:q.j,at:q.at,by:me,u:d&&d.updateTime||''});return'ok'}
 catch(e){if(e&&e.offline){D.off=1;return'stop'}
  if(e&&e.code===403){if(Date.now()-T403>60e3){T403=Date.now();toast('השמירה בענן נדחתה (אין הרשאה, או שהתוספת עוד לא הופעלה). השינוי נשמר במכשיר.')}return'stop'}
  if(e&&[400,404,409,412].includes(e.code))return clash(q);
  return'stop'}}
/* התנגשות: קוראים את הגרסה בענן ומחילים את הכלל */
async function clash(q){let doc=null;
 try{doc=await fsx('/bake/'+q.id)}catch(e){if(!(e&&e.code===404))return'stop'}
 if(!doc){if(q.nw){toast('"'+nmOf(q)+'" לא נשמר');drop(q);return'drop'}
  toast('"'+nmOf(q)+'" נמחק במכשיר אחר – השינוי לא נשמר');drop(q);if(D.R){D.R.delete(q.id);cacheSave()}return'drop'}
 const x=decDoc(doc);
 if(!q.nw&&q.base&&x.u===q.base){toast('השמירה של "'+nmOf(q)+'" נדחתה');drop(q);return'drop'}/* לא התנגשות – בקשה שגויה */
 const ro=x.t===q.t?B.parse(x.t,x.j):null,lo=B.parse(q.t,q.j);
 if(!ro||!lo){toast('"'+nmOf(q)+'" לא נשמר (הגרסה בענן לא תקינה)');drop(q);return'drop'}
 const r=B.resolve(q.t,{o:lo,at:q.at},{o:ro,at:x.at},q.po);
 if(r.lost)toast('"'+(ro.n||lo.n)+'" עודכן במכשיר אחר אחרי השינוי שלך – נשמרה הגרסה החדשה יותר');
 if(r.same){done(q,x);return'ok'}
 const L=qGet(),k=L.findIndex(y=>y.id===q.id);setRec(x);if(k<0)return'ok';
 if(L[k].at!==q.at){Object.assign(L[k],{base:x.u,nw:false});qSet(L);return'ok'}
 const n=(L[k].n||0)+1;if(n>5){drop(q);toast('"'+nmOf(q)+'" לא נשמר – נסו שוב');return'drop'}
 Object.assign(L[k],{j:JSON.stringify(r.o),at:Math.min(r.at,Date.now()),base:x.u,nw:false,n});qSet(L);return'ok'}
window.addEventListener('online',()=>{try{D.off=0;flush()}catch(e){}});
setInterval(()=>{try{if(on()&&qGet().length)flush()}catch(e){}},60e3);
async function hardDel(id){if(!mgr())return;
 try{await fsx('/bake/'+id,{method:'DELETE'});if(D.R){D.R.delete(id);cacheSave()}qSet(qGet().filter(q=>q.id!==id));toast('נמחק');NAV.pop();render(-1)}
 catch(e){toast(e&&e.offline?'מחיקה אפשרית רק עם חיבור לאינטרנט':tkErr(e))}}
const BK={load,flush,recs,put,on,q:qGet,st:()=>D,reset:()=>{D=fresh()}};window.BK=BK;

/* ---------- ספקים ---------- */
function sups(){const o=[];try{
 if(isW()){(cfgLocal().cats||[]).filter(c=>c&&c.beh==='sup').forEach(c=>(c.subs||[]).forEach(s=>{if(s&&ID.test(String(s.id||''))&&B.supBake(s))o.push({id:s.id,name:String(s.name||'').slice(0,60),bt:B.supTypes(s)})}))}
 else (S.cats||[]).filter(c=>c.kind==='exp'&&c.beh==='sup'&&!c.hid&&!c.off).forEach(c=>subsOf(c.id).forEach(s=>{if(B.supBake(s))o.push({id:s.id,name:s.name,bt:B.supTypes(s)})}))}catch(e){}
 return o.sort((a,b)=>String(a.name).localeCompare(String(b.name),'he'))}

/* ---------- חישוב לתצוגה ---------- */
const costOf=(p,R)=>B.prodCost(p.o,R.cm,R.I);
const srcS=x=>x.src?esc([x.src.sn,x.src.n,x.src.d?dfmt(x.src.d):''].filter(Boolean).join(' · '))+(x.pinned?' · <b>נקבע</b>':''):'';
const sumH=c=>{const cl=v=>v==null?'':v<0?' class="neg"':' class="pos"';
 return`<div class="bk-sum"><div><small>עלות מוצר</small><b>${m2(c.prod)}</b></div><div><small>אריזה</small><b>${m2(c.pack)}</b></div><div><small>סה״כ עלות</small><b>${m2(c.total)}</b></div>`
 +`<div><small>מחיר מכירה</small><b>${m2(c.sp)}</b></div><div><small>רווח</small><b${cl(c.profit)}>${m2(c.profit)}</b></div><div><small>שולי רווח</small><b${cl(c.margin)}>${pct(c.margin)}</b></div></div>`};
const pendT=x=>x.pend?' <span class="tag t1">ממתין לשליחה</span>':'';
const offT=x=>x.o.off?' <span class="tag t4">מוסתר</span>':'';
const vis=x=>D.hid||!x.o.off;

/* ---------- מסך ראשי ---------- */
function head(){const n=qGet().length;let h='';
 if(D.err==='no')h+='<div class="card"><p>אין גישה לנתוני האפייה בענן (המתג כבוי, או שהתוספת עוד לא הופעלה בשרת).</p></div>';
 else if(D.err)h+=`<div class="card"><p>${esc(D.err)}</p><button class="btn g" data-a="bkRe">נסה שוב</button></div>`;
 if(D.off||n)h+=`<p class="note">${D.off?'אין חיבור – מוצגים הנתונים האחרונים מהמכשיר. ':''}${n?n+' שינויים ממתינים לשליחה.':''}${n&&!D.off?' <button class="chip" data-a="bkSend">שלח עכשיו</button>':''}</p>`;
 return h}
V.bake=()=>{const T='עלות מוצרי אפייה';if(!on())return{t:T,h:'<div class="empty">המסך זמין כשתוספת "עלות מוצרי אפייה" פעילה, למנהל ולעובד עם הרשאה</div>'};
 chk();if(!D.R&&!D.b){cacheLoad();load(1)}else load();
 if(isW()&&!D.cf&&typeof getCfg==='function'){D.cf=1;getCfg().then(redraw).catch(()=>{})}
 const R=recs(),tb=D.tab,L=tb==='p'?R.P:tb==='c'?R.C:R.I,sh=L.filter(vis),hn=L.length-L.filter(x=>!x.o.off).length;
 const chip=(k,t,n)=>`<button class="chip${tb===k?' on':''}" data-a="bkTab" data-k="${k}" aria-pressed="${tb===k}">${t} (${n})</button>`;
 const cnt=a=>a.filter(x=>!x.o.off).length;
 let rows='';
 if(tb==='p')rows=sh.map(p=>{const c=costOf(p,R);return`<button class="li bk-li" data-a="go" data-v="bakeP" data-arg="${esc(p.id)}"><div class="m"><b>${esc(p.o.n)}${offT(p)}${pendT(p)}</b><small>עלות ${m2(c.total)} · מכירה ${m2(c.sp)}${c.miss?' · <span class="tag t1">חסר מחיר ב-'+c.miss+'</span>':''}</small></div><div class="v">${m2(c.profit)}<small>${pct(c.margin)}</small></div></button>`}).join('');
 else if(tb==='c')rows=sh.map(c=>{const r=B.compCost(c.id,c.o,R.I),ni=R.I.filter(i=>i.o.c===c.id&&!i.o.off).length,np=R.P.filter(p=>!p.o.off&&(p.o.L.concat(p.o.K)).some(l=>l.c===c.id)).length;
  return`<button class="li bk-li" data-a="go" data-v="bakeC" data-arg="${esc(c.id)}"><div class="m"><b>${esc(c.o.n)}${offT(c)}${pendT(c)}</b><small>${r.it?esc([r.it.o.sn,r.it.o.d?dfmt(r.it.o.d):''].filter(Boolean).join(' · '))+' · ':''}${ni} פריטים · ${np} מוצרים</small></div><div class="v">${ucF(r.uc)}<small>ל${UN(c.o.u)}</small></div></button>`}).join('');
 else rows=sh.map(i=>`<button class="li bk-li" data-a="go" data-v="bakeI" data-arg="${esc(i.id)}"><div class="m"><b>${esc(i.o.n)}${offT(i)}${pendT(i)}</b><small>${esc([i.o.sn,KN[i.o.k],i.o.pq+' '+UN(i.o.u)+(i.o.yq!==i.o.pq?' (בפועל '+i.o.yq+')':''),i.o.d?dfmt(i.o.d):''].filter(Boolean).join(' · '))}</small></div><div class="v">${m2(i.o.p)}<small>${ucF(B.unitCost(i.o))}/${UN(i.o.u)}</small></div></button>`).join('');
 const add=tb==='p'?['bkNewP','+ מוצר חדש']:tb==='c'?['bkNewC','+ רכיב חדש']:['bkNewI','+ פריט קנייה חדש'];
 return{t:T,s:'לפני מע״מ',h:head()+`<div class="bk-tabs" role="tablist">${chip('p','מוצרים',cnt(R.P))}${chip('c','רכיבים',cnt(R.C))}${chip('i','פריטי קנייה',cnt(R.I))}</div>`
  +`<button class="btn w" data-a="${add[0]}" style="margin-bottom:10px">${add[1]}</button>`
  +(D.R||L.length?(rows||`<div class="empty">${tb==='p'?'אין מוצרים עדיין. מוצר = מחיר מכירה ורכיבים.':tb==='c'?'אין רכיבים עדיין. רכיב = חומר גלם כללי (למשל קמח) שמקבל מחיר מפריטי קנייה.':'אין פריטי קנייה עדיין. פריט = מה שקונים מספק אפייה או אריזה.'}</div>`):D.err?'':'<div class="empty">טוען…</div>')
  +(hn||D.hid?`<button class="chip" data-a="bkHid" style="margin-top:8px">${D.hid?'הסתר מוסתרים':'הצג מוסתרים ('+hn+')'}</button>`:'')}};
ACT.bkTab=el=>{D.tab=['p','c','i'].includes(el.dataset.k)?el.dataset.k:'p';rerender()};
ACT.bkHid=()=>{D.hid=D.hid?0:1;rerender()};
ACT.bkRe=()=>{D.err='';load(1);rerender()};
ACT.bkSend=()=>{flush()};

/* ---------- פריט קנייה ---------- */
const optS=(v,L)=>L.map(([k,t])=>`<option value="${esc(k)}"${k===v?' selected':''}>${esc(t)}</option>`).join('');
function itemDlg(id){const R=recs(),x=id?find(R.I,id):null,o=x?x.o:{k:'bake',u:'g'};const S0=sups();
 if(!S0.length&&!x)return toast(mgr()?'אין ספקים מסוג אפייה או אריזה. מסמנים סוג בכרטיס הספק (הגדרות כרטיס).':'אין ספקי אפייה או אריזה ברשימה שהמנהל פרסם');
 const supO=S0.some(s=>s.id===o.sup)||!o.sup?S0:S0.concat([{id:o.sup,name:o.sn||'ספק'}]);
 const cO=[['','בלי רכיב']].concat(R.C.filter(c=>!c.o.off||c.id===o.c).map(c=>[c.id,c.o.n+' ('+UN(c.o.u)+')'])).concat([['+new','+ רכיב חדש בשם הפריט']]);
 dlg(`<h3>${x?'עריכת פריט קנייה':'פריט קנייה חדש'}</h3><form data-f="bkI"><input type="hidden" name="id" value="${esc(id||'')}">
 <label class="f"><span>ספק</span><select name="sup" data-c="bkSup" required>${x?'':'<option value="">בחרו ספק</option>'}${optS(o.sup||'',supO.map(s=>[s.id,s.name]))}</select></label>
 ${fld('שם הפריט','n',o.n||'','text','required maxlength="80"')}
 <label class="f"><span>סוג</span><select name="k">${optS(o.k,[['bake','אפייה'],['pack','אריזה']])}</select></label>
 <label class="f"><span>יחידה</span><select name="u">${optS(o.u,[['g','גרם'],['u','יחידות']])}</select></label>
 ${x?'':fld('מחיר לאריזה לפני מע״מ (₪)','p','','text','inputmode="decimal" dir="ltr" required')+fld('כמות באריזה','pq','','text','inputmode="decimal" dir="ltr" required')+fld('כמות בפועל (תפוקה; ריק = כמו באריזה)','yq','','text','inputmode="decimal" dir="ltr"')+fld('תאריך הקנייה','d',today(),'date','required')}
 <label class="f"><span>רכיב מקושר</span><select name="c">${optS(o.c||'',cO)}</select></label>
 <p class="note">עלות ליחידה = מחיר ÷ כמות בפועל.${x?' מחיר וכמות משנים ב"עדכון מחיר".':''}</p><button class="btn w">שמור</button></form>`);
 if(!x)setTimeout(()=>{const f=document.querySelector('#dlg form[data-f=bkI]');if(f&&f.elements.sup.value)CHG.bkSup(f.elements.sup)},0)}
CHG.bkSup=el=>{const f=el.form,s=sups().find(x=>x.id===el.value);if(!f||!s)return;const ks=B.kindsOf(s),k=f.elements.k;
 [...k.options].forEach(op=>{op.disabled=!ks.includes(op.value)});if(ks.length===1)k.value=ks[0]};
ACT.bkNewI=()=>itemDlg('');
ACT.bkEdI=el=>itemDlg(el.dataset.id);
FRM.bkI=form=>{const f=fd(form),R=recs(),id=ID.test(f.id||'')?f.id:'',x=id?find(R.I,id):null;
 const n=B.str(f.n);if(!n)return toast('חסר שם');
 const s=sups().find(y=>y.id===f.sup)||(x&&x.o.sup===f.sup?{id:x.o.sup,name:x.o.sn,bt:['bake','pack']}:null);if(!s)return toast('בחרו ספק אפייה או אריזה');
 const ks=B.kindsOf(s);let k=f.k==='pack'?'pack':'bake';if(ks.length===1)k=ks[0];else if(!ks.includes(k))return toast('סוג לא מתאים לספק');
 const u=f.u==='u'?'u':'g';let c=f.c||'';
 if(c&&c!=='+new'){const co=find(R.C,c);if(!co)c='';else if(co.o.u!==u)return toast('היחידה של הרכיב ('+UN(co.o.u)+') שונה מיחידת הפריט')}
 let o;
 if(x){o=Object.assign({},x.o,{n,sup:s.id,sn:B.str(s.name,60),k,u})}
 else{const p=B.num(f.p),pq=B.pos(f.pq),yq=f.yq===''||f.yq==null?pq:B.pos(f.yq);
  if(p==null)return toast('מחיר לא תקין');if(!pq)return toast('כמות באריזה לא תקינה');if(!yq)return toast('כמות בפועל לא תקינה');
  if(!/^20\d{2}-\d{2}-\d{2}$/.test(f.d||''))return toast('תאריך לא תקין');
  o=B.addPrice({n,sup:s.id,sn:B.str(s.name,60),k,u,pq,yq,h:[]},{p,d:f.d,at:Date.now(),by:SY.uid,pq,yq})}
 if(c==='+new'){const cid=rid();if(!put('c',cid,{n,u}))return;c=cid}
 o.c=c;if(!o.c)delete o.c;
 const nid=id||rid();if(!put('i',nid,o))return;closeDlg();
 if(!id){go('bakeI',nid);toast('נשמר')}else{rerender();toast('נשמר')}};
V.bakeI=id=>{const T='פריט קנייה';if(!on())return V.bake();chk();if(!D.R)cacheLoad();load();
 const R=recs(),x=find(R.I,id);if(!x)return{t:T,h:'<div class="empty">'+(D.R?'הפריט לא נמצא':'טוען…')+'</div>'};
 const o=x.o,uc=B.unitCost(o),co=o.c?find(R.C,o.c):null,used=co?R.P.filter(p=>!p.o.off&&p.o.L.concat(p.o.K).some(l=>l.c===co.id)).length:0;
 const hist=o.h.slice().reverse().map(e=>`<tr><td>${dfmt(e.d)}</td><td class="n">${m2(e.p)}</td><td class="n">${e.pq?e.pq:''}${e.yq&&e.yq!==e.pq?' / '+e.yq:''}</td><td class="n">${ucF(e.p/((e.yq||e.pq||o.yq)||1))}</td></tr>`).join('');
 return{t:o.n,s:T+(o.sn?' · '+o.sn:''),h:head()+`<div class="card">${offT(x)}${pendT(x)}<div class="bk-sum"><div><small>מחיר לאריזה</small><b>${m2(o.p)}</b></div><div><small>כמות באריזה</small><b>${o.pq} ${UN(o.u)}</b></div><div><small>כמות בפועל</small><b>${o.yq} ${UN(o.u)}</b></div>`
  +`<div><small>עלות ל${UN(o.u)}</small><b>${ucF(uc)}</b></div><div><small>סוג</small><b>${KN[o.k]}</b></div><div><small>תאריך</small><b>${o.d?dfmt(o.d):'—'}</b></div></div>`
  +`<p class="note">רכיב: ${co?`<button class="chip" data-a="go" data-v="bakeC" data-arg="${esc(co.id)}">${esc(co.o.n)}</button> (${used} מוצרים)`:'לא מקושר – הפריט לא נכנס לעלות מוצרים'}</p></div>`
  +`<div class="bk-acts"><button class="btn" data-a="bkPrI" data-id="${esc(id)}">עדכון מחיר</button><button class="btn g" data-a="bkEdI" data-id="${esc(id)}">עריכה</button></div>`
  +`<div class="sec"><h3>היסטוריית מחירים (${o.h.length})</h3></div>${o.h.length?`<div class="tw"><table class="bk-h"><thead><tr><th>תאריך</th><th class="n">מחיר</th><th class="n">אריזה / בפועל</th><th class="n">ל${UN(o.u)}</th></tr></thead><tbody>${hist}</tbody></table></div>`:'<p class="note">אין.</p>'}`
  +offActs('i',x)}};
function prDlg(id,d0){const R=recs(),x=find(R.I,id);if(!x)return;const o=x.o;
 dlg(`<h3>עדכון מחיר · ${esc(o.n)}</h3><form data-f="bkPr"><input type="hidden" name="id" value="${esc(id)}">
 ${fld('מחיר לאריזה לפני מע״מ (₪)','p',o.p==null?'':o.p,'text','inputmode="decimal" dir="ltr" required')}
 ${fld('כמות באריזה ('+UN(o.u)+')','pq',o.pq,'text','inputmode="decimal" dir="ltr" required')}${fld('כמות בפועל ('+UN(o.u)+')','yq',o.yq,'text','inputmode="decimal" dir="ltr" required')}
 ${fld('תאריך הקנייה','d',d0||today(),'date','required')}<p class="note">המחיר הקודם נשמר בהיסטוריה. כל המוצרים שמשתמשים ברכיב מתעדכנים.</p><button class="btn w">שמור מחיר</button></form>`)}
ACT.bkPrI=el=>prDlg(el.dataset.id);
FRM.bkPr=form=>{const f=fd(form),R=recs(),x=find(R.I,f.id);if(!x)return;
 const p=B.num(f.p),pq=B.pos(f.pq),yq=B.pos(f.yq);if(p==null)return toast('מחיר לא תקין');if(!pq||!yq)return toast('כמות לא תקינה');if(!/^20\d{2}-\d{2}-\d{2}$/.test(f.d||''))return toast('תאריך לא תקין');
 const o=B.addPrice(x.o,{p,d:f.d,at:Date.now(),by:SY.uid,pq,yq});if(!put('i',x.id,o,true))return;closeDlg();rerender();toast(o.d!==f.d?'נשמר בהיסטוריה (יש מחיר עם תאריך מאוחר יותר)':'המחיר עודכן')};

/* ---------- רכיב ---------- */
function compDlg(id){const R=recs(),x=id?find(R.C,id):null,o=x?x.o:{u:'g'};const used=x&&R.I.some(i=>i.o.c===id);
 dlg(`<h3>${x?'עריכת רכיב':'רכיב חדש'}</h3><form data-f="bkC"><input type="hidden" name="id" value="${esc(id||'')}">${fld('שם הרכיב (למשל: קמח, חמאה)','n',o.n||'','text','required maxlength="80"')}
 <label class="f"><span>יחידה</span><select name="u"${used?' disabled':''}>${optS(o.u,[['g','גרם'],['u','יחידות']])}</select></label>${used?'<p class="note">היחידה נקבעת לפי הפריטים המקושרים.</p>':''}<button class="btn w">שמור</button></form>`)}
ACT.bkNewC=()=>compDlg('');
ACT.bkEdC=el=>compDlg(el.dataset.id);
FRM.bkC=form=>{const f=fd(form),R=recs(),id=ID.test(f.id||'')?f.id:'',x=id?find(R.C,id):null;const n=B.str(f.n);if(!n)return toast('חסר שם');
 const o=Object.assign({},x?x.o:{},{n,u:x&&f.u===undefined?x.o.u:(f.u==='u'?'u':'g')});const nid=id||rid();if(!put('c',nid,o))return;closeDlg();if(!id)go('bakeC',nid);else rerender();toast('נשמר')};
V.bakeC=id=>{const T='רכיב';if(!on())return V.bake();chk();if(!D.R)cacheLoad();load();
 const R=recs(),x=find(R.C,id);if(!x)return{t:T,h:'<div class="empty">'+(D.R?'הרכיב לא נמצא':'טוען…')+'</div>'};
 const r=B.compCost(id,x.o,R.I),its=R.I.filter(i=>i.o.c===id),ps=R.P.filter(p=>p.o.L.concat(p.o.K).some(l=>l.c===id));
 return{t:x.o.n,s:T+' · ל'+UN(x.o.u),h:head()+`<div class="card">${offT(x)}${pendT(x)}<div class="bk-sum"><div><small>עלות ל${UN(x.o.u)}</small><b>${ucF(r.uc)}</b></div><div style="grid-column:span 2"><small>לפי</small><b>${r.it?esc([r.it.o.sn,r.it.o.n,r.it.o.d?dfmt(r.it.o.d):''].filter(Boolean).join(' · ')):'אין פריט עם מחיר'}</b></div></div><p class="note">ברירת מחדל: הקנייה האחרונה. אפשר לקבוע ספק לשורה במוצר.</p></div>`
  +`<div class="bk-acts"><button class="btn g" data-a="bkEdC" data-id="${esc(id)}">עריכה</button></div>`
  +`<div class="sec"><h3>פריטי קנייה (${its.length})</h3></div>${its.length?its.map(i=>`<button class="li bk-li" data-a="go" data-v="bakeI" data-arg="${esc(i.id)}"><div class="m"><b>${esc(i.o.n)}${offT(i)}${r.it&&r.it.id===i.id?' <span class="tag t3">האחרונה</span>':''}</b><small>${esc([i.o.sn,i.o.d?dfmt(i.o.d):''].filter(Boolean).join(' · '))}${i.o.u!==x.o.u?' · <span class="tag t4">יחידה שונה</span>':''}</small></div><div class="v">${ucF(B.unitCost(i.o))}</div></button>`).join(''):'<p class="note">אין. מקשרים פריט קנייה לרכיב בעריכת הפריט.</p>'}`
  +`<div class="sec"><h3>מוצרים (${ps.length})</h3></div>${ps.length?ps.map(p=>`<button class="li bk-li" data-a="go" data-v="bakeP" data-arg="${esc(p.id)}"><div class="m"><b>${esc(p.o.n)}${offT(p)}</b></div><div class="v">${p.o.L.concat(p.o.K).filter(l=>l.c===id).map(l=>l.q+' '+UN(x.o.u)).join(' + ')}</div></button>`).join(''):'<p class="note">אין.</p>'}`
  +offActs('c',x)}};

/* ---------- מוצר ---------- */
function prodDlg(id){const R=recs(),x=id?find(R.P,id):null,o=x?x.o:{};
 dlg(`<h3>${x?'עריכת מוצר':'מוצר חדש'}</h3><form data-f="bkP"><input type="hidden" name="id" value="${esc(id||'')}">${fld('שם המוצר (למשל: עוגיות 200 גרם)','n',o.n||'','text','required maxlength="80"')}
 ${fld('מחיר מכירה לפני מע״מ (₪)','sp',o.sp==null?'':o.sp,'text','inputmode="decimal" dir="ltr"')}<button class="btn w">שמור</button></form>`)}
ACT.bkNewP=()=>prodDlg('');
ACT.bkEdP=el=>prodDlg(el.dataset.id);
FRM.bkP=form=>{const f=fd(form),R=recs(),id=ID.test(f.id||'')?f.id:'',x=id?find(R.P,id):null;const n=B.str(f.n);if(!n)return toast('חסר שם');
 const sp=f.sp===''?null:B.num(f.sp);if(f.sp!==''&&sp==null)return toast('מחיר לא תקין');
 const o=Object.assign({L:[],K:[]},x?x.o:{},{n,sp});if(sp==null)delete o.sp;const nid=id||rid();if(!put('p',nid,o))return;closeDlg();if(!id)go('bakeP',nid);else rerender();toast('נשמר')};
const lineH=(p,sec,l,i)=>`<div class="bk-ln"><div class="m"><b>${esc(l.n||'רכיב חסר')}</b><small>${l.q} ${UN(l.u)} · ${ucF(l.uc)} ל${UN(l.u)}</small>${l.src?`<small>${srcS(l)}</small>`:''}${l.why?`<small class="tag t1">${esc(l.why)}</small>`:''}
 <div class="bt"><button class="btn g" data-a="bkLn" data-id="${esc(p.id)}" data-s="${sec}" data-i="${i}">עריכה</button><button class="btn g" data-a="bkLnDel" data-id="${esc(p.id)}" data-s="${sec}" data-i="${i}">הסר</button></div></div><div class="v">${m2(l.cost)}</div></div>`;
V.bakeP=id=>{const T='מוצר';if(!on())return V.bake();chk();if(!D.R)cacheLoad();load();
 const R=recs(),x=find(R.P,id);if(!x)return{t:T,h:'<div class="empty">'+(D.R?'המוצר לא נמצא':'טוען…')+'</div>'};
 const c=costOf(x,R);
 return{t:x.o.n,s:T+' · לפני מע״מ',h:head()+`${offT(x)}${pendT(x)}${sumH(c)}`
  +`<div class="bk-acts"><button class="btn g" data-a="bkEdP" data-id="${esc(id)}">שם ומחיר מכירה</button></div>`
  +`<div class="sec"><h3>רכיבים (${c.L.length}) · ${m2(c.prod)}</h3></div><div class="card" style="padding:4px 10px">${c.L.length?c.L.map((l,i)=>lineH(x,'L',l,i)).join(''):'<p class="note">אין רכיבים.</p>'}</div>`
  +`<button class="btn w" data-a="bkLn" data-id="${esc(id)}" data-s="L" data-i="-1" style="margin:6px 0 10px">+ הוסף רכיב</button>`
  +`<div class="sec"><h3>אריזה (${c.K.length}) · ${m2(c.pack)}</h3></div><div class="card" style="padding:4px 10px">${c.K.length?c.K.map((l,i)=>lineH(x,'K',l,i)).join(''):'<p class="note">אין אריזה (קופסה, מדבקה…). לא חובה.</p>'}</div>`
  +`<button class="btn g w" data-a="bkLn" data-id="${esc(id)}" data-s="K" data-i="-1" style="margin:6px 0 10px">+ הוסף אריזה</button>`
  +offActs('p',x)}};
ACT.bkLn=el=>{const R=recs(),x=find(R.P,el.dataset.id);if(!x)return;const sec=el.dataset.s==='K'?'K':'L',i=+el.dataset.i,l=i>=0?x.o[sec][i]:null;
 const cs=R.C.filter(c=>!c.o.off||(l&&l.c===c.id));if(!cs.length)return toast('קודם מוסיפים רכיב (לשונית "רכיבים")');
 const c0=l?l.c:cs[0].id;
 dlg(`<h3>${sec==='K'?'שורת אריזה':'שורת רכיב'} · ${esc(x.o.n)}</h3><form data-f="bkL"><input type="hidden" name="id" value="${esc(x.id)}"><input type="hidden" name="s" value="${sec}"><input type="hidden" name="i" value="${i}">
 <label class="f"><span>רכיב</span><select name="c" data-c="bkLc">${optS(c0,cs.map(c=>[c.id,c.o.n+' ('+UN(c.o.u)+')']))}</select></label>
 ${fld('כמות (ביחידת הרכיב)','q',l?l.q:'','text','inputmode="decimal" dir="ltr" required')}
 <label class="f"><span>ספק לשורה (רמה 1)</span><select name="pin">${pinO(R,c0,l&&l.pin)}</select></label><p class="note">ברירת מחדל: לפי הקנייה האחרונה. בחירת פריט קובעת את הספק לשורה הזו בלבד.</p><button class="btn w">שמור</button></form>`)};
function pinO(R,cid,pin){const co=find(R.C,cid);const its=R.I.filter(i=>i.o.c===cid&&(!co||i.o.u===co.o.u)&&B.unitCost(i.o)!=null&&(!i.o.off||i.id===pin));
 return optS(pin||'',[['','לפי הקנייה האחרונה']].concat(its.map(i=>[i.id,[i.o.sn,i.o.n,ucF(B.unitCost(i.o)),i.o.d?dfmt(i.o.d):''].filter(Boolean).join(' · ')])))}
CHG.bkLc=el=>{const f=el.form;if(!f)return;f.elements.pin.innerHTML=pinO(recs(),el.value,'')};
FRM.bkL=form=>{const f=fd(form),R=recs(),x=find(R.P,f.id);if(!x)return;const sec=f.s==='K'?'K':'L',i=+f.i;
 const q=B.pos(f.q);if(!q)return toast('כמות לא תקינה');if(!find(R.C,f.c))return toast('בחרו רכיב');
 const ln={c:f.c,q};if(f.pin&&ID.test(f.pin))ln.pin=f.pin;
 const L=x.o[sec].slice();if(i>=0&&i<L.length)L[i]=ln;else{if(L.length>=B.L_MAX)return toast('יותר מדי שורות');L.push(ln)}
 if(!put('p',x.id,Object.assign({},x.o,{[sec]:L})))return;closeDlg();rerender()};
ACT.bkLnDel=el=>{const R=recs(),x=find(R.P,el.dataset.id);if(!x)return;const sec=el.dataset.s==='K'?'K':'L',i=+el.dataset.i;const L=x.o[sec].slice();if(!(i>=0&&i<L.length))return;
 L.splice(i,1);if(put('p',x.id,Object.assign({},x.o,{[sec]:L})))rerender()};

/* ---------- הסתרה / מחיקה ---------- */
function offActs(t,x){return`<div class="bk-acts" style="margin-top:16px"><button class="btn g" data-a="bkOff" data-t="${t}" data-id="${esc(x.id)}">${x.o.off?'החזר (בטל הסתרה)':'הסתר'}</button>${mgr()&&x.o.off&&!x.pend?`<button class="btn r" data-a="bkDel" data-id="${esc(x.id)}">מחיקה לצמיתות</button>`:''}</div>`
 +`<p class="note">${x.o.off?'מוסתר: לא מוצג ברשימות ולא נכנס לחישוב "הקנייה האחרונה".':'הסתרה לא מוחקת – אפשר להחזיר.'}${mgr()?' מחיקה לצמיתות – רק אחרי הסתרה, למנהל בלבד.':''}</p>`}
ACT.bkOff=el=>{const t=el.dataset.t,R=recs(),L=t==='i'?R.I:t==='c'?R.C:R.P,x=find(L,el.dataset.id);if(!x)return;const o=Object.assign({},x.o);if(o.off)delete o.off;else o.off=1;if(put(t,x.id,o))rerender()};
ACT.bkDel=el=>{const id=el.dataset.id;if(!mgr()||!ID.test(id||''))return;ask('למחוק לצמיתות? אי אפשר לבטל (חוץ משחזור מגיבוי).',()=>hardDel(id),'מחק')};

/* ---------- עדכון מחירי פריטים מתוך הוצאה (txDlg) ---------- */
V.bakeS=a=>{const T='עדכון מחירי פריטים';if(!on())return V.bake();chk();if(!D.R)cacheLoad();load();
 const sup=a&&ID.test(String(a.sup||''))?a.sup:'',d=a&&/^20\d{2}-\d{2}-\d{2}$/.test(String(a.d||''))?a.d:today();
 const R=recs(),L=R.I.filter(i=>i.o.sup===sup&&!i.o.off),sn=(sups().find(s=>s.id===sup)||{}).name||(L[0]&&L[0].o.sn)||'';
 return{t:T,s:sn,h:head()+(L.length?`<form data-f="bkS"><input type="hidden" name="sup" value="${esc(sup)}">${fld('תאריך הקנייה','d',d,'date','required')}<p class="note">מחיר לאריזה לפני מע״מ. שדה ריק = בלי שינוי.</p>`
  +L.map(i=>`<label class="f"><span>${esc(i.o.n)} · ${i.o.pq} ${UN(i.o.u)} · עכשיו ${m2(i.o.p)}</span><input name="p_${esc(i.id)}" inputmode="decimal" dir="ltr" autocomplete="off" placeholder="${i.o.p==null?'':esc(i.o.p)}"></label>`).join('')
  +`<button class="btn w">שמור מחירים</button></form>`:`<div class="empty">${D.R?'אין פריטי קנייה של הספק הזה.':'טוען…'}</div>`)+`<button class="btn g w" data-a="bkNewI" style="margin-top:10px">+ פריט קנייה חדש</button>`}};
FRM.bkS=form=>{const f=fd(form),R=recs();if(!/^20\d{2}-\d{2}-\d{2}$/.test(f.d||''))return toast('תאריך לא תקין');let n=0,bad=0;
 for(const i of R.I.filter(x=>x.o.sup===f.sup&&!x.o.off)){const v=f['p_'+i.id];if(v==null||String(v).trim()==='')continue;const p=B.num(v);if(p==null){bad++;continue}
  if(put('i',i.id,B.addPrice(i.o,{p,d:f.d,at:Date.now(),by:SY.uid,pq:i.o.pq,yq:i.o.yq}),true))n++}
 toast(n?'עודכנו '+n+' מחירים'+(bad?' ('+bad+' לא תקינים)':''):bad?'מחיר לא תקין':'לא הוזן מחיר');if(n){NAV.pop();render(-1)}};
ACT.bakeTx=el=>{closeDlg();go('bakeS',{sup:el.dataset.sup,d:el.dataset.d})};
if(typeof txDlg==='function'){const o=txDlg;txDlg=function(id){const r=o.apply(this,arguments);try{if(!on()||!isA())return r;const t=S.tx.find(x=>x.id===id),s=t&&t.sub?subById(t.sub):null;
 if(s&&B.supBake(s)){const d=$('#dlg');if(d&&!d.querySelector('[data-a=bakeTx]'))d.insertAdjacentHTML('beforeend',`<button type="button" class="btn g w" style="margin-top:8px" data-a="bakeTx" data-sup="${esc(s.id)}" data-d="${esc(t.date||'')}">עדכון מחירי פריטים</button>`)}}catch(e){}return r}}

/* ---------- כניסות: "עוד" של המנהל ושל העובד ---------- */
const opt=()=>`<button class="opt" data-a="go" data-v="bake"><span>עלות מוצרי אפייה<small>פריטי קנייה, רכיבים, מוצרים ורווח</small></span>${qGet().length?`<span class="tag t1">${qGet().length}</span>`:''}${ico('chev')}</button>`;
{const o=V.more;if(typeof o==='function')V.more=function(){const r=o.apply(this,arguments);try{if(on()&&r&&typeof r.h==='string'&&r.h.includes('<div class="mlist">')&&!r.h.includes('data-v="bake"'))r.h=r.h.replace('<div class="mlist">',()=>'<div class="mlist">'+opt())}catch(e){}return r}}
{const o=V.wkMore;if(typeof o==='function')V.wkMore=function(){const r=o.apply(this,arguments);try{if(on()&&r&&typeof r.h==='string'&&!r.h.includes('data-v="bake"'))r.h=`<div class="mlist" style="margin-bottom:12px">${opt()}</div>`+r.h}catch(e){}return r}}

/* ---------- סוג ספק בכרטיס הספק (מנהל, רק כשהתוספת דלוקה) ---------- */
{const o=ACT.subMenu;if(typeof o==='function')ACT.subMenu=el=>{o(el);try{if(!feat()||!isA())return;const s=subById(el.dataset.id);if(!s||(cat(s.cat)||{}).beh!=='sup')return;const b=$('#dlg form[data-f=subsave] button.btn');if(!b)return;const T=B.supTypes(s);
 b.insertAdjacentHTML('beforebegin',`<div class="f" data-bkbt="1"><span>סוג ספק</span><div class="bk-bt">${B.BT.map(k=>`<label><input type="checkbox" name="bt_${k}" value="1"${T.includes(k)?' checked':''}> ${k==='reg'?'רגיל (נכנס לתמחור חשבוניות)':KN[k]}</label>`).join('')}</div><p class="note" style="margin:2px 0 0">ספק אפייה / אריזה בלי "רגיל" לא נכנס ל"חשבוניות לתמחור". ספק מעורב (עם "רגיל") – כן.</p></div>`)}catch(e){}}}
{const o=FRM.subsave;if(typeof o==='function')FRM.subsave=form=>{let ch=false;try{const E=form.elements,s=subById(E.id&&E.id.value);
 if(s&&E.bt_reg&&feat()){const n=B.BT.filter(k=>E['bt_'+k]&&E['bt_'+k].checked),v=n.length?n:['reg'];if(JSON.stringify(v)!==JSON.stringify(s.bt||null)){s.bt=v;ch=true}}}catch(e){}
 const r=o(form);if(ch&&isA()&&typeof pubCfg==='function')pubCfg().catch(()=>{});return r}}

/* ---------- סימון חד־פעמי (4ג, החלטה ה1): ספקי e_bak בלי bt → ['bake']. רק מוסיף שדה; דגל S.bkM ---------- */
function mig(){try{if(!isA()||!feat()||S.bkM)return 0;let n=0;(S.subs||[]).forEach(s=>{if(s&&s.cat==='e_bak'&&!('bt'in s)){s.bt=['bake'];n++}});
 S.bkM=1;save();if(n){if(typeof pubCfg==='function')pubCfg().catch(()=>{});toast(n+' ספקי אפייה סומנו כאפייה – אפשר לשנות בכרטיס הספק')}return n}catch(e){return 0}}
BK.mig=mig;
{const o=V.home;if(typeof o==='function')V.home=function(){const r=o.apply(this,arguments);try{if(isA()&&feat()&&!S.bkM)setTimeout(mig,1500)}catch(e){}return r}}

/* ---------- גיבוי (4ד): שדה רשות bkx = {v,at,docs:[{id,f}]}; שחזור יוצר רק רשומות שחסרות ---------- */
const bxOk=x=>!!(x&&typeof x==='object'&&!Array.isArray(x)&&Array.isArray(x.docs));
let RST=null;
window.BKBK={
 collect:async()=>{if(!mgr()||!feat())return undefined;const r=await fsx(':runQuery',{method:'POST',body:JSON.stringify({structuredQuery:{from:[{collectionId:'bake'}],limit:3000}})});
  return{v:1,at:Date.now(),docs:(r||[]).filter(x=>x&&x.document).map(x=>({id:idOf(x.document),f:x.document.fields||{}})).filter(d=>ID.test(d.id))}},
 pick:o=>o&&bxOk(o.bkx)?o.bkx:null,
 ok:bxOk,
 note:r=>{const x=r&&r.bkx;if(!bxOk(x)){RST=null;return''}RST=x;
  return`<p class="note">הגיבוי כולל גם נתוני עלות מוצרי אפייה (${x.docs.length} רשומות). השחזור הרגיל לא משנה אותם בענן.</p>${mgr()&&feat()&&x.docs.length?'<button type="button" class="btn g w" style="margin:0 0 8px" data-a="bakeRst">לשחזר נתוני אפייה (רק רשומות שחסרות בענן)</button>':''}`},
 restore:async x=>{const res={ok:0,dup:0,bad:0};if(!mgr()||!feat()||!bxOk(x))return res;
  for(const d of x.docs){const f=d&&d.f||{},t=fvj(f.t),j=fvj(f.j);if(!d||!ID.test(String(d.id||''))||!['i','c','p'].includes(t)||typeof j!=='string'||j.length<2||j.length>16000){res.bad++;continue}
   let at=+fvj(f.at)||0;if(!(at>=1700000000000&&at<=Date.now()))at=Date.now();
   try{await fsx('/bake/'+d.id+'?currentDocument.exists=false',{method:'PATCH',body:JSON.stringify({fields:{t:{stringValue:t},j:{stringValue:j},at:{integerValue:String(at)},by:{stringValue:SY.uid}}})});res.ok++}
   catch(e){if(e&&e.offline)throw e;if(e&&(e.code===409||e.code===400))res.dup++;else res.bad++}}
  D.at=0;return res}};
ACT.bakeRst=async el=>{if(!RST)return;if(el)el.disabled=true;
 try{const r=await BKBK.restore(RST);toast('נתוני אפייה: נוצרו '+r.ok+(r.dup?', '+r.dup+' כבר קיימים (לא שונו)':'')+(r.bad?', '+r.bad+' נכשלו':''))}
 catch(e){toast(tkErr(e));if(el)el.disabled=false}};
})();
