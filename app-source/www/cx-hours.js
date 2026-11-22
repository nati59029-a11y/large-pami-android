/* שעות עובדים – כספית מול השעון של הקופה החדשה (סבב 2, 22.11.2026; החלטות 6, 7, 11). מנהל בלבד (השרת אוכף: cxBotTok op:'hours' –
   מנהל, posClock op:'list' – מנהל, shApi cfg/setCfg – מנהל; כאן רק מה מוצג). כניסה: כפתור "שעות עובדים" במסך המשמרות (shifts.js, מנהל).
   V.cxHrs – בחירת חודש (הנוכחי כברירת מחדל). לכל עובד ולכל יום: כניסה/יציאה מכספית (עם הסניף) לצד השעון של הקופה (posclock).
     "לבדוק": הפרש מעל 5 דקות בכניסה או ביציאה, יציאה רק באחד המקורות, או רשומה שקיימת רק באחד המקורות. סיכום חודשי לעובד (שעות לפי מקור).
     כל מספר ומשבצת לחיצים ומציגים את השורות שמרכיבות אותם.
   התאמת עובד כספית ← משתמש (shfcfg/map, נשמר ב-shApi setCfg{map} הקיים – כל הטבלה): עובד שאינו ממופה – הצעה לפי שם
     (התאמה מדויקת אחרי נרמול רווחים וגרשיים; שם כפול / לא ברור – "לבדוק" בלי הצעה), "אשר" או בחירה ידנית. עד אישור – בלי השוואה לקופה.
   בלי השעון של הקופה (העסק בלי תוספת הקופה / שגיאה) – מוצגת רק כספית, בלי סימוני "לבדוק".
   רכיבי העיצוב הקיימים בלבד (.card .btn .kg .k .li .tag .note .empty .f), משתני ערכת הנושא.
   משתמש ב: V, ACT, fnCall, esc, toast, dlg, closeDlg, rerender, cur, go, SY, oxImpOk. */
(function(){
'use strict';
if(typeof ACT==='undefined'||typeof V==='undefined')return;
const fnCall=(n,d)=>{d=d&&typeof d==='object'?d:{};if(SY&&SY.sa&&SY.bizId&&!('bizId'in d))d=Object.assign({bizId:SY.bizId},d);return window.fnCall(n,d)};
const on=()=>{try{return typeof window.oxImpOk==='function'&&window.oxImpOk()}catch(e){return false}};
const TOL=5; /* דקות – הפרש מעל זה = "לבדוק" (החלטה 11) */
const big='style="min-height:48px"';
const MN=['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
const DN=['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳'];
const S={m:'',d:null,err:'',ld:0,open:{},P:null};
const err=e=>toast(e&&e.message||'הפעולה נכשלה');
/* שם בכספית → מפתח בטבלת ההתאמה (כמו בשרת: רווחים מנורמלים); להצעה – גם בלי גרשיים/מירכאות */
const nk=s=>String(s||'').replace(/\s+/g,' ').trim();
const nq=s=>nk(String(s||'').replace(/["'`׳״]/g,'')).toLowerCase();
const hmMin=s=>/^([01]\d|2[0-3]):[0-5]\d$/.test(s||'')?+s.slice(0,2)*60+ +s.slice(3,5):null;
const dur=m=>{m=Math.max(0,Math.round(m||0));return Math.floor(m/60)+':'+String(m%60).padStart(2,'0')};
const dm=d=>(+d.slice(8))+'.'+(+d.slice(5,7));
const dow=d=>new Date(d+'T12:00:00Z').getUTCDay();
const dDiff=(a,b)=>Math.round((Date.parse(b+'T12:00:00Z')-Date.parse(a+'T12:00:00Z'))/864e5);
let IL=null;try{IL=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem',hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}catch(e){}
/* רגע → { d: 'YYYY-MM-DD', hm: 'HH:MM' } בשעון ישראל */
function wall(t){const x=new Date(t);if(!IL)return{d:x.toISOString().slice(0,10),hm:x.toISOString().slice(11,16)};const p=IL.formatToParts(x),g=k=>(p.find(z=>z.type===k)||{}).value||'';return{d:g('year')+'-'+g('month')+'-'+g('day'),hm:(g('hour')==='24'?'00':g('hour'))+':'+g('minute')}}
const curM=()=>wall(Date.now()).d.slice(0,7);
const addM=(m,n)=>{const y=+m.slice(0,4),k=+m.slice(5,7)-1+n,d=new Date(Date.UTC(y,k,1));return d.toISOString().slice(0,7)};
const mLbl=m=>MN[+m.slice(5,7)-1]+' '+m.slice(0,4);

async function load(){if(S.ld)return;S.ld=1;const m=S.m;
 try{const y=+m.slice(0,4),k=+m.slice(5,7)-1,from=Date.UTC(y,k,1)-4*36e5,to=Date.UTC(y,k+1,1);
  const [h,c,p]=await Promise.all([fnCall('cxBotTok',{op:'hours',m}),fnCall('shApi',{op:'cfg'}),fnCall('posClock',{op:'list',from,to}).catch(()=>null)]);
  if(m!==S.m){S.ld=0;return load()}
  S.d={m,list:(h&&h.list)||[],cfg:c||{},pos:p&&Array.isArray(p.recs)?p.recs:null};S.P=build(S.d);S.err=''}catch(e){S.err=e&&e.message||'הטעינה נכשלה'}
 S.ld=0;if(cur().v==='cxHrs'&&!document.querySelector('#dlg[open]'))rerender()}
const reload=()=>{S.d=null;S.P=null;S.err='';load()};

/* ---------- בניית הנתונים: אנשים → ימים → השוואה ---------- */
function cRow(r,br){const i=hmMin(r.i),o=r.o?hmMin(r.o)+(r.n===1?1440:0):null;
 return{src:'c',br,d:r.d,i:r.i,o:r.o||'',b:r.b||0,n:r.n===1,im:i,om:o,min:Number.isInteger(r.t)?r.t:(o!=null&&i!=null?Math.max(0,o-i-(r.b||0)):0)}}
function pRow(x){const a=wall(x.in),b=Number.isInteger(x.out)?wall(x.out):null,im=hmMin(a.hm);
 return{src:'p',id:x.id,br:x.br||'',d:a.d,i:a.hm,o:b?b.hm:'',im,om:b?dDiff(a.d,b.d)*1440+hmMin(b.hm):null,xd:b?dDiff(a.d,b.d):0,min:b?Math.max(0,Math.floor((x.out-x.in)/6e4)):0,open:!b,fix:Array.isArray(x.fix)&&x.fix.length>0}}
/* התאמת שורות של יום אחד: לכל שורת כספית – שורת הקופה הקרובה ביותר בכניסה (עד 3 שעות). → [{ c, p, why:[] }] */
function pair(cs,ps){const used=new Set(),out=[];
 for(const c of cs.slice().sort((a,b)=>a.im-b.im)){let best=-1,bd=181;ps.forEach((p,j)=>{if(used.has(j))return;const d=Math.abs(p.im-c.im);if(d<bd){bd=d;best=j}});
  if(best<0){out.push({c,p:null,why:['רק בכספית']});continue}
  used.add(best);const p=ps[best],why=[];
  if(Math.abs(p.im-c.im)>TOL)why.push('הפרש בכניסה '+Math.abs(p.im-c.im)+' דק׳');
  if(c.om!=null&&p.om!=null){if(Math.abs(p.om-c.om)>TOL)why.push('הפרש ביציאה '+Math.abs(p.om-c.om)+' דק׳')}else if(c.om!=null||p.om!=null)why.push(c.om==null?'אין יציאה בכספית':'אין יציאה בקופה');
  out.push({c,p,why})}
 ps.forEach((p,j)=>{if(!used.has(j))out.push({c:null,p,why:['רק בקופה']})});
 return out.sort((a,b)=>(a.c||a.p).im-(b.c||b.p).im)}
function build(D){const m=D.m,cfg=D.cfg||{},staff=Array.isArray(cfg.staff)?cfg.staff:[],mapK=new Map();
 for(const [k,u] of Object.entries(cfg.map||{}))if(typeof u==='string')mapK.set(nk(k),u);
 const stN=u=>{const s=staff.find(x=>x.uid===u);return s?s.name:''};
 /* קבוצות כספית לפי שם (אותו אדם בשני הסניפים = אותו שם); שם כפול = שני מזהים שונים באותו סניף */
 const G=new Map();
 for(const x of D.list){const key=nk(x.nm)||('#'+x.e);let g=G.get(key);if(!g){g={nm:nk(x.nm)||('עובד '+x.e),key,ids:{},brs:new Set(),rows:[],dup:false};G.set(key,g)}
  const k=x.br+'|';if(g.ids[k]&&g.ids[k]!==x.e)g.dup=true;g.ids[k]=x.e;g.brs.add(x.br);for(const r of x.rows||[])if(r&&r.d&&r.d.slice(0,7)===m)g.rows.push(cRow(r,x.br))}
 const P=new Map(),un=[];
 for(const g of G.values()){const u=g.nm&&!g.key.startsWith('#')?mapK.get(g.key):null;
  if(!u){un.push(g);P.set('c:'+g.key,{k:'c:'+g.key,nm:g.nm,cx:[g.nm],brs:g.brs,uid:'',c:g.rows,p:[]});continue}
  let x=P.get('u:'+u);if(!x){x={k:'u:'+u,nm:stN(u)||g.nm,cx:[],brs:new Set(),uid:u,c:[],p:[]};P.set(x.k,x)}
  x.cx.push(g.nm);g.brs.forEach(b=>x.brs.add(b));x.c.push(...g.rows)}
 const pos=D.pos;
 if(pos)for(const r of pos){if(!r||typeof r.who!=='string'||!Number.isInteger(r.in))continue;const q=pRow(r);if(q.d.slice(0,7)!==m)continue;
  let x=P.get('u:'+r.who);if(!x){x={k:'u:'+r.who,nm:stN(r.who)||r.name||'עובד',cx:[],brs:new Set(),uid:r.who,c:[],p:[]};P.set(x.k,x)}x.p.push(q)}
 const list=[...P.values()].map(x=>{const cmp=!!(pos&&x.uid),days=[...new Set(x.c.map(r=>r.d).concat(x.p.map(r=>r.d)))].sort();
  const dd=days.map(d=>{const cs=x.c.filter(r=>r.d===d),ps=x.p.filter(r=>r.d===d),pr=cmp?pair(cs,ps):null;return{d,c:cs,p:ps,pr,chk:!!(pr&&pr.some(z=>z.why.length))}});
  return Object.assign(x,{cmp,days:dd,cMin:x.c.reduce((a,r)=>a+r.min,0),pMin:x.p.reduce((a,r)=>a+r.min,0),nChk:dd.filter(z=>z.chk).length})});
 list.sort((a,b)=>(b.nChk-a.nChk)||(a.nm<b.nm?-1:a.nm>b.nm?1:0));
 /* הצעות התאמה */
 const cnt=new Map();for(const s of staff){const q=nq(s.name);cnt.set(q,(cnt.get(q)||0)+1)}
 const qc=new Map();for(const g of un){const q=nq(g.nm);qc.set(q,(qc.get(q)||0)+1)}
 const sug=un.filter(g=>!g.key.startsWith('#')).map(g=>{const q=nq(g.nm),hit=staff.filter(s=>nq(s.name)===q);
  const ok=!g.dup&&qc.get(q)===1&&hit.length===1&&cnt.get(q)===1;return{nm:g.nm,brs:[...g.brs],s:ok?hit[0]:null,why:g.dup?'שם כפול בכספית':hit.length>1?'כמה משתמשים עם השם הזה':hit.length?'':'אין משתמש עם שם זהה'}});
 const at=D.list.reduce((a,x)=>Math.max(a,x.at||0),0);
 return{list,sug,staff,at,pos:!!pos,map:cfg.map||{}}}

/* ---------- תצוגה ---------- */
const cTxt=r=>`<span dir="ltr">${esc(r.i)}–${r.o?esc(r.o):'?'}</span>${r.n?' ☾':''}`;
const pTxt=r=>`<span dir="ltr">${esc(r.i)}–${r.o?esc(r.o):'?'}</span>${r.xd?' ☾':''}`;
const tile=(l,v,cls,a,k,x)=>`<button type="button" class="k${cls?' '+cls:''}" data-a="${a}" data-k="${esc(k)}"${x?` data-v="${esc(x)}"`:''} style="width:100%;min-height:64px;text-align:start;color:inherit;font:inherit;cursor:pointer"><small>${l}</small><b dir="ltr">${v}</b></button>`;
function dayBtn(x,z){const brs=[...new Set(z.c.map(r=>r.br))].join(', ');
 return `<button type="button" class="li" data-a="cxhDay" data-k="${esc(x.k)}" data-v="${esc(z.d)}" style="width:100%;min-height:48px;text-align:start;font:inherit;color:inherit;cursor:pointer"><div class="m"><b>יום ${DN[dow(z.d)]} ${dm(z.d)}${z.chk?' <span class="tag t4">לבדוק</span>':''}</b>
 <small>כספית: ${z.c.length?z.c.map(cTxt).join(' , '):'—'}${brs?' · '+esc(brs):''}</small>${x.cmp?`<small>קופה: ${z.p.length?z.p.map(pTxt).join(' , '):'—'}</small>`:''}</div></button>`}
function person(x){const op=!!S.open[x.k];
 let h=`<div class="card" style="padding:12px"><div class="row" style="justify-content:space-between;align-items:center"><h3 style="margin:0">${esc(x.nm)}</h3>${x.nChk?`<span class="tag t4">${x.nChk} ימים לבדוק</span>`:''}</div>`;
 h+=`<p class="note" style="margin:4px 0">${x.cx.length&&x.cx[0]!==x.nm?'בכספית: '+esc(x.cx.join(', '))+' · ':''}${x.brs.size?esc([...x.brs].join(', ')):'רק בקופה'}${!x.uid?' · <span class="tag t1">לא מותאם למשתמש – בלי השוואה לקופה</span>':''}</p>`;
 h+=`<div class="kg">${tile('שעות לפי כספית',dur(x.cMin),'','cxhSum',x.k,'c')}${x.cmp?tile('שעות לפי הקופה',dur(x.pMin),'','cxhSum',x.k,'p'):''}${x.cmp?tile('ימים לבדוק',String(x.nChk),x.nChk?'neg':'','cxhSum',x.k,'x'):''}${tile('ימי עבודה',String(x.days.length),'','cxhSum',x.k,'d')}</div>`;
 h+=`<button class="btn g w" ${big} data-a="cxhTog" data-k="${esc(x.k)}" style="margin-top:8px">${op?'הסתר ימים':'פירוט ימים ('+x.days.length+')'}</button>`;
 if(op)h+=`<div style="margin-top:6px">${x.days.map(z=>dayBtn(x,z)).join('')||'<p class="note">אין שורות בחודש הזה.</p>'}</div>`;
 return h+'</div>'}
function sugH(P){if(!P.sug.length)return'';const st=P.staff;
 return `<div class="card"><h3 style="margin-top:0">עובדים בכספית שעוד לא הותאמו למשתמש</h3><p class="note" style="margin-top:0">עד שמאשרים – השעות שלהם מוצגות בלי השוואה לשעון של הקופה.</p>
 ${P.sug.map((g,i)=>`<div style="padding:8px 0;border-bottom:1px solid var(--line)"><b>${esc(g.nm)}</b> <small class="note">${esc(g.brs.join(', '))}</small><br>
 ${g.s?`<span class="note">הצעה: <b>${esc(g.s.name)}</b></span> <button class="btn s" style="min-height:44px" data-a="cxhOk" data-v="${i}">אשר</button>`:`<span class="tag t4">לבדוק</span> <span class="note">${esc(g.why||'אין הצעה')} – בחרו ידנית</span>`}
 <div class="row" style="align-items:flex-end;margin-top:4px"><label class="f grow" style="margin:0"><span>או בחירה ידנית</span><select id="cxhSel${i}" style="min-height:48px"><option value="">— בחרו משתמש —</option>${st.map(s=>`<option value="${esc(s.uid)}">${esc(s.name)}${s.mgr?' (מנהל)':''}</option>`).join('')}</select></label><button class="btn g s" style="min-height:48px" data-a="cxhPick" data-v="${i}">שמירה</button></div></div>`).join('')}</div>`}
V.cxHrs=()=>{const T='שעות עובדים';if(!on())return{t:T,h:'<div class="empty">המסך זמין למנהל בלבד</div>'};
 if(!S.m)S.m=curM();
 const nav=`<div class="row" style="margin-bottom:8px"><button class="btn g grow" ${big} data-a="cxhM" data-v="-1" aria-label="חודש קודם">› הקודם</button><button class="btn g grow" ${big} data-a="cxhM" data-v="0">${esc(mLbl(S.m))}</button><button class="btn g grow" ${big} data-a="cxhM" data-v="1" aria-label="חודש הבא"${S.m>=curM()?' disabled':''}>הבא ‹</button></div>`;
 if(S.err)return{t:T,h:nav+`<div class="card"><p class="note">${esc(S.err)}</p><button class="btn g w" ${big} data-a="cxhRe">נסו שוב</button></div>`};
 if(!S.d){load();return{t:T,h:nav+'<div class="empty">טוען…</div>'}}
 const P=S.P,nChk=P.list.reduce((a,x)=>a+x.nChk,0);
 let h=nav+`<div class="card" style="padding:12px"><div class="kg">${tile('עובדים',String(P.list.length),'','cxhAll','n')}${P.pos?tile('ימים לבדוק',String(nChk),nChk?'neg':'','cxhAll','x'):''}</div>
 <p class="note" style="margin:6px 0 0">${P.at?'עדכון אחרון מכספית: '+esc(new Date(P.at).toLocaleString('he-IL',{day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'})):'עוד לא הגיעו שעות מכספית לחודש הזה.'}${P.pos?'':'<br>השעון של הקופה החדשה לא זמין בעסק הזה – מוצגת רק כספית.'}<br>"לבדוק" = הפרש של יותר מ-${TOL} דקות בכניסה או ביציאה, או רשומה שקיימת רק באחד המקורות.</p></div>`;
 h+=sugH(P);
 h+=P.list.map(person).join('')||'<p class="empty">אין שעות בחודש הזה.</p>';
 return{t:T,s:mLbl(S.m),h}};
const byK=k=>S.P?S.P.list.find(x=>x.k===k):null;
ACT.cxhRe=()=>reload();
ACT.cxhM=el=>{const n=+el.dataset.v;const m=n?addM(S.m||curM(),n):curM();if(m>curM())return;S.m=m;S.open={};reload();rerender()};
ACT.cxhTog=el=>{const k=el.dataset.k;S.open[k]=!S.open[k];rerender()};
/* פירוט יום: השורות מכל מקור וההשוואה */
function dayH(x,z){
 let h=`<h3>${esc(x.nm)} · יום ${DN[dow(z.d)]} ${dm(z.d)}</h3>`;
 if(z.pr&&z.pr.length)h+=z.pr.map(q=>`<div class="li" style="cursor:default;min-height:48px"><div class="m"><b>${q.why.length?'<span class="tag t4">לבדוק</span> '+esc(q.why.join(' · ')):'<span class="tag t3">תואם</span>'}</b>
  <small>כספית: ${q.c?cTxt(q.c)+' · '+esc(q.c.br)+(q.c.b?' · הפסקה '+q.c.b+' דק׳':'')+' · '+dur(q.c.min)+' ש׳':'—'}</small><small>קופה: ${q.p?pTxt(q.p)+(q.p.br?' · '+esc(q.p.br):'')+(q.p.open?' · כניסה פתוחה':' · '+dur(q.p.min)+' ש׳')+(q.p.fix?' · תוקן ע״י מנהל':''):'—'}</small></div></div>`).join('');
 else{h+=z.c.map(r=>`<div class="li" style="cursor:default;min-height:48px"><div class="m"><b>כספית: ${cTxt(r)}</b><small>${esc(r.br)}${r.b?' · הפסקה '+r.b+' דק׳':''} · ${dur(r.min)} ש׳${r.o?'':' · לא הוחתמה יציאה'}</small></div></div>`).join('');
  h+=z.p.map(r=>`<div class="li" style="cursor:default;min-height:48px"><div class="m"><b>קופה: ${pTxt(r)}</b><small>${r.open?'כניסה פתוחה':dur(r.min)+' ש׳'}</small></div></div>`).join('');
  if(!x.cmp)h+='<p class="note">'+(x.uid?'השעון של הקופה לא זמין – בלי השוואה.':'העובד עוד לא הותאם למשתמש – בלי השוואה לקופה.')+'</p>'}
 return h}
ACT.cxhDay=el=>{const x=byK(el.dataset.k);if(!x)return;const z=x.days.find(q=>q.d===el.dataset.v);if(!z)return;dlg(dayH(x,z)+`<button class="btn g w" ${big} data-a="closeDlg" style="margin-top:8px">סגור</button>`)};
/* משבצת סיכום: השורות שמרכיבות אותה */
ACT.cxhSum=el=>{const x=byK(el.dataset.k);if(!x)return;const v=el.dataset.v;let h;
 if(v==='c')h=`<h3>${esc(x.nm)} – שעות לפי כספית: ${dur(x.cMin)}</h3>`+(x.c.slice().sort((a,b)=>a.d<b.d?-1:a.d>b.d?1:a.im-b.im).map(r=>`<div class="li" style="cursor:default;min-height:44px"><div class="m"><b>${dm(r.d)} · ${cTxt(r)} · ${dur(r.min)} ש׳</b><small>${esc(r.br)}${r.b?' · הפסקה '+r.b+' דק׳':''}${r.o?'':' · לא הוחתמה יציאה'}</small></div></div>`).join('')||'<p class="note">אין שורות.</p>');
 else if(v==='p')h=`<h3>${esc(x.nm)} – שעות לפי הקופה: ${dur(x.pMin)}</h3>`+(x.p.slice().sort((a,b)=>a.d<b.d?-1:a.d>b.d?1:a.im-b.im).map(r=>`<div class="li" style="cursor:default;min-height:44px"><div class="m"><b>${dm(r.d)} · ${pTxt(r)} · ${r.open?'פתוחה':dur(r.min)+' ש׳'}</b>${r.fix?'<small>תוקן ע״י מנהל</small>':''}</div></div>`).join('')||'<p class="note">אין שורות.</p>');
 else{const L=x.days.filter(z=>v==='d'||z.chk);h=`<h3>${esc(x.nm)} – ${v==='d'?'ימי עבודה':'ימים לבדוק'}: ${L.length}</h3>`+(L.map(z=>dayBtn(x,z)).join('')||'<p class="note">אין.</p>')}
 dlg(h+`<button class="btn g w" ${big} data-a="closeDlg" style="margin-top:8px">סגור</button>`)};
ACT.cxhAll=el=>{if(!S.P)return;const v=el.dataset.v;let h;
 if(v==='n')h=`<h3>עובדים בחודש: ${S.P.list.length}</h3>`+S.P.list.map(x=>`<div class="li" style="cursor:default;min-height:44px"><div class="m"><b>${esc(x.nm)}</b><small>כספית ${dur(x.cMin)} ש׳${x.cmp?' · קופה '+dur(x.pMin)+' ש׳':''}${x.nChk?' · '+x.nChk+' ימים לבדוק':''}</small></div></div>`).join('');
 else{h='<h3>ימים לבדוק</h3>';const L=S.P.list.filter(x=>x.nChk);h+=L.map(x=>`<h4 style="margin:10px 0 4px">${esc(x.nm)}</h4>`+x.days.filter(z=>z.chk).map(z=>dayBtn(x,z)).join('')).join('')||'<p class="note">אין ימים לבדוק.</p>'}
 dlg(h+`<button class="btn g w" ${big} data-a="closeDlg" style="margin-top:8px">סגור</button>`)};
/* שמירת התאמה: כל הטבלה הקיימת + השורה החדשה (shApi setCfg{map} מחליף את כל הטבלה) */
async function saveMap(nm,uid,b){if(!S.P||!uid)return;const map=Object.assign({},S.P.map,{[nk(nm)]:uid});if(Object.keys(map).length>100)return toast('עד 100 שורות בטבלת ההתאמה');
 if(b)b.disabled=true;try{await fnCall('shApi',{op:'setCfg',map});toast('ההתאמה נשמרה');reload();rerender()}catch(e){if(b)b.disabled=false;err(e)}}
ACT.cxhOk=el=>{const g=S.P&&S.P.sug[+el.dataset.v];if(g&&g.s)saveMap(g.nm,g.s.uid,el)};
ACT.cxhPick=el=>{const i=+el.dataset.v,g=S.P&&S.P.sug[i],s=document.getElementById('cxhSel'+i);if(!g||!s)return;if(!s.value)return toast('בחרו משתמש');saveMap(g.nm,s.value,el)};

/* כניסה: כפתור במסך המשמרות (מנהל) */
window.cxhBtn=()=>on()?`<button class="btn g grow" ${big} data-a="cxhGo">שעות עובדים</button>`:'';
ACT.cxhGo=()=>{S.m=curM();S.open={};S.d=null;S.P=null;S.err='';go('cxHrs')};
window._cxh={build,pair,nk,nq,wall};
})();
