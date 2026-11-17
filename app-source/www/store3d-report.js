/* סריקת חנות בתלת מימד – שלב 13 (משימה 2026-11-14_סריקת-חנות-תלת-מימד): דוחות, מגמה, ביצועי עובדים, סניפים, המלצות, חוסרים, הגדרות, משימות תיקון וערעורים.
   קובץ עצמאי, נטען אחרי store3d-capture.js. מחבר את הלשוניות "דוחות", "המלצות" ו"הגדרות" של המסך הראשי (U.tabHtml), ומספק למסך העובד את משימות התיקון (U.fixHtml).
   מנהל קורא ישירות מ-Firestore (srun, ai, ph, s3perf, s3fix, s3appeal, s3short, s3set). עובד – רק דרך s3View ו-s3perf שלו (החוקים והשרת אוכפים; כאן לא מנסים לקרוא מה שאסור).
   כותב ישירות רק מה שהחוקים מתירים: s3set (מנהל), s3appeal (יצירה – עובד בסבב או מנהל; הכרעה – מנהל), s3short (אישור מנהל). שאר הפעולות – פונקציות שרת (s3Fix, shelfCheck verify, s3SetBranch).
   אין שליחה לספק: רשימת החוסרים היא רשימה בלבד. ייצוא PDF נוצר במכשיר (mkPdf של האפליקציה: עמודי תמונה). אין נתוני דוגמה: בלי נתונים – הודעה. נתוני מכירות לפי מוצר: אין באפליקציה – "לא זמין". */
(function(){
'use strict';
const U=window.S3UI;
if(!U||typeof ACT==='undefined'||typeof CHG==='undefined'||typeof dlg==='undefined'||typeof fsx==='undefined')return;
const X=U.X,esc2=U.esc2;
const R={tok:0,key:'',sub:'run',runs:null,runsErr:'',rb:0,rid:'',ai:{},url:{},ph:{},staff:null,perf:{},pm:0,short:{},apps:null,fixes:null,set:undefined,use:undefined,more:15,busy:'',msg:'',wr:{},vq:{},vr:{},vp:null,dec:null,md:null,show:{}};
const ISS={noprice:'אין מחיר',pricepos:'מחיר לא ליד המוצר',promoexp:'מבצע שפג תוקפו',hole:'חור במדף',low:'מוצר שנגמר',damaged:'מוצר פגום',fallen:'מוצר שנפל',upside:'מוצר הפוך',face:'החזית לא גלויה',order:'סדר לא תקין',misplaced:'מוצר לא במקום',missing:'מוצר חסר'};
const SEV=['','קלה','בינונית','חמורה'],SEVT=['','t2','t1','t4'];
const CAT={p:'מחירים',h:'חורים ומוצרים שנגמרו',o:'סדר וחזית',d:'מוצרים פגומים'};
const WHY={miss:'חסר',low:'אוזל',hole:'חור במדף'};
const FST={open:['לתקן','t1'],sent:['נשלח, ממתין לאישור','t2'],ok:['תוקן','t3'],rej:['לא תוקן – צלמו שוב','t4'],cancel:['בוטל','']};
const typing=()=>{const a=document.activeElement;return !!(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)&&a.closest('#main'))};
const again=()=>{if(cur().v==='st3'&&['rep','recs','set','map'].includes(X.tab)&&!typing())rerender()};
const dd=ms=>{try{return new Date(+ms).toLocaleDateString('he-IL',{day:'numeric',month:'numeric'})}catch(e){return ''}};
const dd2=ms=>{try{return new Date(+ms).toLocaleDateString('he-IL',{day:'numeric',month:'numeric',year:'2-digit'})}catch(e){return ''}};
const isSa=()=>!!(SY&&SY.sa);
const fv=v=>v===null?{nullValue:null}:typeof v==='boolean'?{booleanValue:v}:typeof v==='number'?{integerValue:String(Math.round(v))}:typeof v==='string'?{stringValue:v}:Array.isArray(v)?{arrayValue:v.length?{values:v.map(fv)}:{}}:{mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,fv(x)]))}};
const mapId=()=>{const d=U.data();return d?U.mapIdOf(X.kind==='w'&&d.maps.w?'w':'s',d.br):''};
function sync(){const k=(SY&&SY.bizId||'')+'|'+(SY&&SY.uid||'')+'|'+U.brSel();if(R.key===k)return;R.key=k;R.tok++;
 for(const u of Object.values(R.url)){try{if(u)URL.revokeObjectURL(u)}catch(e){}}
 Object.assign(R,{runs:null,runsErr:'',rb:0,rid:'',ai:{},url:{},ph:{},staff:null,perf:{},short:{},apps:null,fixes:null,set:undefined,use:undefined,more:15,wr:{},md:null,show:{}})}
async function fsList(p){let out=[],tk='',n=0;do{const j=await fsx(p+(tk?'&pageToken='+encodeURIComponent(tk):''));out=out.concat((j&&j.documents)||[]);tk=(j&&j.nextPageToken)||''}while(tk&&++n<12);return out}
const idOf=d=>String(d.name||'').split('/').pop();
const dcd=d=>{const o=U.dec(d)||{};o.id=idOf(d);return o};
/* ---------- שמות מקומות (מהמפה) ---------- */
function mdOf(mid){const d=U.data(),m=d&&d.maps&&(String(mid||'')[0]==='w'?d.maps.w:d.maps.s);if(!m)return null;if(R.md&&R.md.src===m)return R.md;let md=null;try{md=window.S3G&&window.S3G.buildModel(m)}catch(e){}R.md={src:m,fm:new Map(((md&&md.fx)||[]).map(f=>[f.id,f]))};return R.md}
const lblT=(slot,mid)=>{const m=/^(f[0-9]{1,4})-([ab])-([0-9]{1,2})(?:_([atb]))?$/.exec(slot||'');if(!m)return 'מקום לא מוכר';const md=mdOf(mid),f=md&&md.fm.get(m[1]);
 return `גוף ${f&&f.num||m[1].slice(1)}${f&&f.name?' ('+f.name+')':''} · ${m[2]==='a'?'צד ראשי':'צד שני'} · מקטע ${m[3]}${m[4]==='t'?' · עליונה':m[4]==='b'?' · תחתונה':''}`};
const lbl=(slot,mid)=>esc2(lblT(slot,mid));
/* ---------- תמונות ---------- */
function img(path){if(!path||R.url[path]!==undefined)return;R.url[path]='';const t=R.tok;
 if(typeof window.abkSt!=='function'){R.url[path]=null;return}
 window.abkSt('/'+encodeURIComponent(path)+'?alt=media').then(r=>r.blob()).then(b=>{if(t!==R.tok)return;R.url[path]=URL.createObjectURL(b);again();paintDec()}).catch(()=>{if(t===R.tok){R.url[path]=null;again();paintDec()}})}
const boxH=(b,c)=>{const a=Array.isArray(b)&&b.length===4?b.map(n=>Math.max(0,Math.min(1000,+n||0))):null;return a?`<i class="s3bx${c?' '+c:''}" style="left:${a[0]/10}%;top:${a[1]/10}%;width:${a[2]/10}%;height:${a[3]/10}%"></i>`:''};
function pic(path,boxes){if(!path)return `<div class="s3info">אין תמונה למקום הזה.</div>`;const u=R.url[path];if(u===undefined)img(path);
 if(!u)return `<div class="s3info" style="text-align:center">${u===null?'לא הצלחנו לטעון את התמונה.':'טוענים את התמונה…'}</div>`;
 return `<div class="s3pic"><img src="${u}" alt="תמונת המדף">${(boxes||[]).map(b=>boxH(b.box,b.c)).join('')}</div>`}
async function phLoad(rid,slot){const k=rid+'|'+slot;if(R.ph[k]!==undefined)return;R.ph[k]=null;const t=R.tok;
 try{const o=U.dec(await fsx('/srun/'+rid+'/ph/'+slot));if(t!==R.tok)return;R.ph[k]=o&&!o.person&&!o.gone&&typeof o.th==='string'&&o.th?o.th:''}catch(e){if(t!==R.tok)return;R.ph[k]=e&&e.code===404?'':'err'}
 if(R.ph[k])img(R.ph[k]);again();paintDec()}
/* ---------- סבבים ותוצאות (מנהל) ---------- */
async function rl(){if(R.runs!==null||R.rb)return;R.rb=1;const t=R.tok;
 try{const L=await fsList('/srun?pageSize=60&orderBy=openAt%20desc&'+['br','map','k','st','n','nDone','openAt','dueAt','doneAt','sum','recs','uids','work','pause'].map(f=>'mask.fieldPaths='+f).join('&'));
  if(t!==R.tok)return;R.runs=L.map(d=>{const o=dcd(d);o.rid=o.id;return o}).filter(r=>r.map&&r.k!=='adhoc');R.runsErr=''}
 catch(e){if(t!==R.tok)return;R.runs=null;R.runsErr=U.errText(e,'לא הצלחנו לטעון את הסבבים.')}
 R.rb=0;again()}
const mine=()=>{const d=U.data(),mid=mapId();return(R.runs||[]).filter(r=>r.map===mid&&(!d||!r.br||r.br===d.br))};
const doneSt=r=>r&&(r.st==='done'||r.st==='closed');
function curRun(){const L=mine();if(R.rid){const r=L.find(x=>x.rid===R.rid);if(r)return r}return L.find(r=>r.sum&&doneSt(r))||L.find(r=>r.sum)||L[0]||null}
const prevRun=r=>{if(!r)return null;const L=mine(),i=L.findIndex(x=>x.rid===r.rid);return L.slice(i+1).find(x=>x.sum&&doneSt(x))||null};
async function aiLoad(rid){if(!rid||R.ai[rid]!==undefined)return;R.ai[rid]=null;const t=R.tok;
 try{const L=await fsList('/srun/'+rid+'/ai?pageSize=300');if(t!==R.tok)return;R.ai[rid]=L.map(d=>{const o=U.dec(d)||{};o.slot=idOf(d);return o})}
 catch(e){if(t!==R.tok)return;R.ai[rid]=e&&e.offline?'offline':'err'}again()}
async function staffLoad(){if(R.staff!==null)return;R.staff=[];const t=R.tok;
 try{const j=await fsx('/staff?pageSize=300');if(t!==R.tok)return;R.staff=((j&&j.documents)||[]).map(d=>{const f=U.dec(d)||{};return{uid:idOf(d),name:String(f.name||f.email||'עובד'),active:f.active===true}})}catch(e){}again()}
const nameOf=u=>{const s=(R.staff||[]).find(x=>x.uid===u);return s&&s.name||'עובד'};
const shown=a=>a&&(a.st==='issue'||a.st==='review'||a.st==='bad');
const maxSev=a=>Math.max(0,...(Array.isArray(a.iss)?a.iss:[]).filter(i=>!i.warn).map(i=>+i.sev||0));
const nReal=a=>(Array.isArray(a.iss)?a.iss:[]).filter(i=>!i.warn).length;
function probRows(list){return list.filter(shown).sort((a,b)=>(a.st==='issue'?0:1)-(b.st==='issue'?0:1)||maxSev(b)-maxSev(a)||nReal(b)-nReal(a)||(a.slot<b.slot?-1:1))}
/* שורה של מדף עם בעיות. canFix = מנהל (משימת תיקון); הערעור פתוח לכולם (עובד בסבב / מנהל) */
function shelfRow(a,rid,mid,pm,canFix,wk){
 const iss=Array.isArray(a.iss)?a.iss:[],pr=pm&&pm.get(a.slot),
  tg=a.st==='bad'?'<span class="tag t4">תמונה לא קריאה</span>':a.st==='review'?'<span class="tag t2">לבדיקה</span>':'<span class="tag t1">יש בעיות</span>',
  cmp=pr?(pr.st==='issue'?'<span class="tag t1">נשארה מהסבב הקודם</span>':'<span class="tag t4">חדשה</span>'):'';
 const k=rid+'|'+a.slot,on=R.show[k];
 let h=`<div class="s3info"><div class="row" style="justify-content:space-between;align-items:flex-start"><b>${lbl(a.slot,mid)}</b><span>${tg}</span></div>${cmp?`<div style="margin-top:4px">${cmp}</div>`:''}`;
 h+=iss.length?iss.map((i,ix)=>`<div style="margin-top:8px"><b>${esc2(ISS[i.k]||'בעיה')}</b> ${i.sev?`<span class="tag ${SEVT[i.sev]||''}">${SEV[i.sev]||''}</span>`:''}${i.warn?'<span class="tag t2">אזהרה</span>':''}${i.t?`<br><small>${esc2(i.t)}</small>`:''}
  ${i.warn?'':`<div class="row s3row" style="margin-top:4px"><button class="btn g s" data-a="s3rAppeal" data-run="${esc2(rid)}" data-slot="${esc2(a.slot)}" data-ik="${ix}">זו טעות</button></div>`}</div>`).join(''):`<div style="margin-top:6px"><small>${a.st==='bad'?'צלמו שוב, התמונה לא היתה ברורה.':'ה-AI לא היה בטוח. אין בעיה מוכחת.'}</small></div>`;
 if(!wk){
  h+=`<div class="row s3row" style="margin-top:8px">${on?'':`<button class="btn g s" data-a="s3rImg" data-run="${esc2(rid)}" data-slot="${esc2(a.slot)}">הצג תמונה</button>`}${canFix?`<button class="btn g s" data-a="s3rFixNew" data-run="${esc2(rid)}" data-slot="${esc2(a.slot)}">משימת תיקון</button>`:''}${iss.length?`<button class="btn g s" data-a="s3rAppeal" data-run="${esc2(rid)}" data-slot="${esc2(a.slot)}" data-ik="all">הכל טעות</button>`:''}</div>`;
  if(on){const p=R.ph[k];h+=p===undefined||p===null?'<div class="s3info">טוענים את התמונה…</div>':p==='err'?'<div class="s3info">לא הצלחנו לטעון את התמונה.</div>':pic(p,iss.map(i=>({box:i.box,c:i.warn?'rc':''})))}
 }else h+=`<div class="row s3row" style="margin-top:8px">${iss.length?`<button class="btn g s" data-a="s3rAppeal" data-run="${esc2(rid)}" data-slot="${esc2(a.slot)}" data-ik="all">הכל טעות</button>`:''}</div>`;
 return h+'</div>'}
ACT.s3rImg=el=>{const k=el.dataset.run+'|'+el.dataset.slot;R.show[k]=1;phLoad(el.dataset.run,el.dataset.slot);rerender()};
/* ---------- מבנה הדוח ---------- */
const kgH=(a,b,c)=>`<div class="kg">${[a,b,c].filter(Boolean).map(x=>`<div class="k"><small>${esc2(x[0])}</small><b>${esc2(x[1])}</b></div>`).join('')}</div>`;
const dlt=n=>n>0?'+'+n:String(n);
function catBars(sum,psum){const c=sum&&sum.cat;if(!c)return '';return `<div style="margin-top:10px">${['p','h','o','d'].filter(k=>Number.isFinite(+c[k])).map(k=>{const pv=psum&&psum.cat&&Number.isFinite(+psum.cat[k])?+c[k]-+psum.cat[k]:null;
 return `<div style="margin-top:8px"><div class="row" style="justify-content:space-between"><span>${CAT[k]}</span><b>${+c[k]}${pv!=null&&pv!==0?` <small class="tag ${pv>0?'t3':'t4'}">${dlt(pv)}</small>`:''}</b></div><div class="s3bar"><i style="width:${Math.max(0,Math.min(100,+c[k]))}%"></i></div></div>`}).join('')}</div>`}
function trendH(L){const P=L.filter(r=>r.sum&&Number.isFinite(+r.sum.score)&&doneSt(r)).slice(0,12).reverse();
 if(P.length<2)return `<div class="s3info">${P.length?'יש סבב אחד עם ציון. המגמה תופיע אחרי הסבב השני.':'עוד אין סבבים שהסתיימו עם ציון.'}</div>`;
 const W=320,Hh=140,px=36,py=24,n=P.length,x=i=>W-px-(W-2*px)*(n-1-i)/(n-1),y=s=>Hh-py-(Hh-2*py)*Math.max(0,Math.min(100,s))/100;
 /* הישן ביותר מימין (כיוון הקריאה בעברית) */
 const pts=P.map((r,i)=>[x(n-1-i),y(+r.sum.score),r]);
 return `<div class="s3info"><svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="מגמת הציון לאורך הסבבים" style="width:100%;height:auto;display:block;direction:ltr">
 ${[0,50,100].map(v=>`<line x1="${px/2}" x2="${W-px/2}" y1="${y(v)}" y2="${y(v)}" style="stroke:var(--line);stroke-width:1"/><text x="2" y="${y(v)+3}" style="fill:var(--mut);font-size:9px">${v}</text>`).join('')}
 <polyline points="${pts.map(p=>p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ')}" style="fill:none;stroke:var(--acc);stroke-width:2.5;stroke-linejoin:round"/>
 ${pts.map(p=>`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="4" style="fill:var(--acc)"/><text x="${p[0].toFixed(1)}" y="${(p[1]-8).toFixed(1)}" text-anchor="middle" style="fill:var(--ink);font-size:10px;font-weight:700">${+p[2].sum.score}</text><text x="${p[0].toFixed(1)}" y="${Hh-6}" text-anchor="middle" style="fill:var(--mut);font-size:8.5px">${esc2(dd(p[2].openAt))}</text>`).join('')}</svg>
 <small class="note">ציון כל סבב שהסתיים (עד 12 אחרונים). הישן ביותר מימין.</small></div>`}
const SUBS=()=>[['run','סבב'],['trend','מגמה'],['wk','עובדים'],...(isSa()?[['br','סניפים']]:[]),['short','חוסרים'],['fix','תיקונים וערעורים']];
function runChips(L){return `<div class="s3tabs" role="tablist" style="margin-bottom:6px">${L.slice(0,10).map(r=>`<button class="chip ${R.rid&&r.rid===R.rid||(!R.rid&&r===curRun())?'on':''}" data-a="s3rRun" data-id="${esc2(r.rid)}">${esc2(dd(r.openAt))}${r.sum?' · '+(+r.sum.score||0):''}</button>`).join('')}</div>`}
function runH(d){
 const L=mine();if(!L.length)return `<div class="s3info">עוד אין סבבים בסניף הזה. כשסבב יסתיים יופיע כאן הדוח שלו.</div>`;
 const r=curRun(),pr=prevRun(r);aiLoad(r.rid);if(pr)aiLoad(pr.rid);
 const s=r.sum,ps=pr&&pr.sum;
 let h=runChips(L);
 h+=`<div class="s3info"><b>סבב מ-${esc2(dd2(r.openAt))}</b> · ${esc2(({open:'פתוח',late:'באיחור',done:'הסתיים',closed:'נסגר באיחור',cancel:'בוטל'})[r.st]||'')}${r.nDone!=null?` · צולמו ${+r.nDone} מתוך ${+r.n}`:''}`;
 if(s&&Number.isFinite(+s.score)){const dS=Number.isFinite(+s.dScore)?+s.dScore:ps&&Number.isFinite(+ps.score)?+s.score-+ps.score:null;
  h+=kgH(['ציון',+s.score],dS!=null?['מול הסבב הקודם',dlt(dS)]:['מול הסבב הקודם','אין סבב קודם'],['מדפים תקינים',(+s.nOk||0)+' מתוך '+((+s.nOk||0)+(+s.nIss||0)+(+s.nRev||0)+(+s.nMiss||0)+(+s.nBad||0))]);
  h+=catBars(s,ps);h+=`<p class="note s3note">יש בעיות: ${+s.nIss||0} · לבדיקה: ${+s.nRev||0} · לא צולמו: ${+s.nMiss||0} · תמונה לא קריאה: ${+s.nBad||0}. "לבדיקה" לא מוריד את הציון.</p>`}
 else h+=`<p class="note s3note">הסבב עוד לא סוכם, ולכן אין ציון.</p>`;
 h+='</div>';
 const A=R.ai[r.rid];
 if(A==null)h+=`<div class="s3info">טוענים את הבעיות לפי מדף…</div>`;
 else if(typeof A==='string')h+=`<div class="s3info">${A==='offline'?'אין חיבור לאינטרנט.':'לא הצלחנו לטעון את הבעיות לפי מדף.'} <button class="btn g s" data-a="s3rRetry">נסו שוב</button></div>`;
 else{
  const PA=pr?R.ai[pr.rid]:null,pm=Array.isArray(PA)?new Map(PA.map(a=>[a.slot,a])):null,rows=probRows(A);
  if(pm){const fixed=A.filter(a=>a.st==='ok'&&pm.get(a.slot)&&pm.get(a.slot).st==='issue').length,nw=rows.filter(a=>a.st==='issue'&&pm.get(a.slot)&&pm.get(a.slot).st!=='issue').length;
   h+=`<div class="s3info"><b>לעומת הסבב הקודם (${esc2(dd(pr.openAt))})</b><br>טופלו: ${fixed} מדפים · בעיות חדשות: ${nw} מדפים</div>`}
  h+=`<h4 style="margin:14px 0 4px">בעיות לפי מדף (${rows.length})</h4>`;
  h+=rows.length?rows.slice(0,R.more).map(a=>shelfRow(a,r.rid,r.map,pm,true,false)).join('')+(rows.length>R.more?`<div class="row s3row"><button class="btn g" data-a="s3rMore">הציגו עוד (${rows.length-R.more})</button></div>`:''):`<div class="s3info">לא נמצאו בעיות בסבב הזה.</div>`}
 h+=`<div class="row s3row" style="margin-top:12px"><button class="btn" data-a="s3rPdf"${R.busy?' aria-disabled="true"':''}>${R.busy==='pdf'?'מכינים PDF…':'ייצוא PDF עם תמונות'}</button></div>`;
 if(R.msg)h+=`<div class="ban s3warn" role="alert">${esc2(R.msg)}</div>`;
 h+=`<p class="note s3note">נתוני מכירות לפי מוצר: לא זמין. האפליקציה לא מחזיקה מכירות לפי מוצר, ולכן אין כאן קישור בין בעיות במדף למכירות.</p>`;
 return h}
ACT.s3rRun=el=>{R.rid=el.dataset.id;R.more=15;R.msg='';rerender()};
ACT.s3rMore=()=>{R.more+=20;rerender()};
ACT.s3rRetry=()=>{const r=curRun();if(r){delete R.ai[r.rid];const p=prevRun(r);if(p)delete R.ai[p.rid]}rerender()};
ACT.s3rSub=el=>{R.sub=el.dataset.k;R.msg='';rerender()};
/* ---------- ביצועי עובדים ---------- */
const mk=off=>{const d=new Date();d.setDate(15);d.setMonth(d.getMonth()-off);const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit'}).formatToParts(d);return p.find(x=>x.type==='year').value+'-'+p.find(x=>x.type==='month').value};
const mlbl=k=>{const[y,m]=k.split('-');try{return new Date(+y,+m-1,1).toLocaleDateString('he-IL',{month:'long',year:'numeric'})}catch(e){return k}};
async function perfLoad(uid,m){const k=uid+'|'+m;if(R.perf[k]!==undefined)return;R.perf[k]=null;const t=R.tok;
 try{R.perf[k]=await U.get('/s3perf/'+uid+'/m/'+m)||{}}catch(e){R.perf[k]=e&&e.offline?'offline':'err'}if(t===R.tok)again()}
function perfH(uid,name,m){const p=R.perf[uid+'|'+m];
 if(p===undefined||p===null)return `<div class="s3info"><b>${esc2(name)}</b><br><small>טוענים…</small></div>`;
 if(typeof p==='string')return `<div class="s3info"><b>${esc2(name)}</b><br><small>${p==='offline'?'אין חיבור לאינטרנט.':'לא הצלחנו לטעון.'}</small></div>`;
 if(!p.upd&&!p.runs&&!p.photos)return `<div class="s3info"><b>${esc2(name)}</b><br><small>אין נתונים לחודש הזה.</small></div>`;
 const n=x=>+x||0,rt=n(p.photos)?Math.round(100*n(p.retakes)/n(p.photos)):0,fx=n(p.fixOk)+n(p.fixRej);
 return `<div class="s3info"><b>${esc2(name)}</b>${kgH(['סבבים',n(p.runs)],['בזמן / באיחור',n(p.onTime)+' / '+n(p.late)],['דקות עבודה',n(p.work)])}
 <small>צילומים: ${n(p.photos)} · צלם שוב: ${n(p.retakes)} (${rt}%) · הפסקות: ${n(p.pauses)} (${n(p.pause)} ד׳)${fx?` · תיקונים: ${n(p.fixOk)} אושרו, ${n(p.fixRej)} נדחו`:''}${n(p.appeals)?` · ערעורים: ${n(p.appeals)} (התקבלו ${n(p.appAcc)})`:''}</small></div>`}
function wkH(){
 staffLoad();const m=mk(R.pm),L=(R.staff||[]).filter(s=>s.active).slice(0,40);
 let h=`<div class="chips" style="margin:0 0 8px">${[0,1].map(o=>`<button class="chip ${R.pm===o?'on':''}" data-a="s3rPm" data-o="${o}">${esc2(mlbl(mk(o)))}</button>`).join('')}</div>`;
 if(R.staff===null)return h+'<div class="s3info">טוענים…</div>';
 if(!L.length)return h+'<div class="s3info">אין עובדים פעילים.</div>';
 L.forEach(s=>perfLoad(s.uid,m));return h+L.map(s=>perfH(s.uid,s.name,m)).join('')+`<p class="note s3note">הנתונים מחושבים בשרת בסיום סבב או תיקון. עובד רואה רק את הנתונים של עצמו.</p>`}
ACT.s3rPm=el=>{R.pm=+el.dataset.o===1?1:0;rerender()};
/* ---------- השוואת סניפים (מנהל־על) ---------- */
function brH(){
 if(R.runs===null)return '<div class="s3info">טוענים…</div>';
 const rows=U.brs().map(b=>{const r=R.runs.filter(x=>x.br===b.id&&x.map&&x.map[0]==='s'&&x.sum&&doneSt(x)&&Number.isFinite(+x.sum.score)).sort((a,c)=>+c.openAt-+a.openAt)[0];return{b,r}});
 if(rows.length<2)return `<div class="s3info">יש בעסק סניף אחד בלבד. ההשוואה מופיעה כשיש שני סניפים או יותר.</div>`;
 rows.sort((a,c)=>(c.r?+c.r.sum.score:-1)-(a.r?+a.r.sum.score:-1));
 return rows.map(({b,r})=>`<div class="s3info"><div class="row" style="justify-content:space-between"><b>${esc2(b.name)}</b><b>${r?+r.sum.score:'עוד אין'}</b></div>${r?`<div class="s3bar" style="margin-top:6px"><i style="width:${Math.max(0,Math.min(100,+r.sum.score))}%"></i></div><small>סבב מ-${esc2(dd2(r.openAt))}${Number.isFinite(+r.sum.dScore)&&+r.sum.dScore?` · ${dlt(+r.sum.dScore)} מול הקודם`:''}${+r.sum.nIss?` · ${+r.sum.nIss} מדפים עם בעיות`:''}</small>`:'<small>עוד אין סבב שהסתיים.</small>'}</div>`).join('')+`<p class="note s3note">הציון הוא של הסבב האחרון שהסתיים בחנות של כל סניף.</p>`}
/* ---------- רשימת חוסרים להזמנה (בלי שליחה) ---------- */
async function shLoad(rid){if(!rid||R.short[rid]!==undefined)return;R.short[rid]=null;const t=R.tok;
 try{const o=await U.get('/s3short/'+rid);R.short[rid]=o?{o,drop:new Set((Array.isArray(o.drop)?o.drop:[]).map(Number))}:{o:null,drop:new Set()}}catch(e){R.short[rid]=e&&e.offline?'offline':'err'}if(t===R.tok)again()}
function shH(){
 if(R.runs===null)return '<div class="s3info">טוענים…</div>';
 const r=curRun();if(!r)return '<div class="s3info">עוד אין סבבים בסניף הזה.</div>';shLoad(r.rid);
 const S=R.short[r.rid];let h=runChips(mine());
 if(S==null)return h+'<div class="s3info">טוענים…</div>';
 if(typeof S==='string')return h+`<div class="s3info">${S==='offline'?'אין חיבור לאינטרנט.':'לא הצלחנו לטעון את הרשימה.'}</div>`;
 if(!S.o||!Array.isArray(S.o.items)||!S.o.items.length)return h+`<div class="s3info">אין חוסרים להזמנה בסבב הזה.</div>`;
 const items=S.o.items,st=S.o.st||'draft',keep=items.filter((_,i)=>!S.drop.has(i)).length;
 h+=`<div class="s3info"><b>רשימה להזמנה מסבב ${esc2(dd2(r.openAt))}</b><br><small>${st==='ok'?'אושרה':st==='no'?'סומנה: לא להזמין':'טיוטה – ממתינה לאישור שלכם'} · ${keep} מתוך ${items.length} פריטים. הרשימה לא נשלחת לספק. אתם מעתיקים אותה ומזמינים בעצמכם.</small></div>`;
 const bc={};items.forEach((it,i)=>{(bc[it.c||'ללא קטגוריה']=bc[it.c||'ללא קטגוריה']||[]).push([it,i])});
 h+=Object.keys(bc).map(c=>`<div class="s3info"><b>${esc2(c)}</b>${bc[c].map(([it,i])=>`<label class="row" style="margin-top:8px;min-height:44px;gap:8px;align-items:flex-start"><input type="checkbox" data-c="s3rShDrop" data-rid="${esc2(r.rid)}" data-i="${i}" ${S.drop.has(i)?'':'checked'} ${st!=='draft'?'disabled':''} style="width:22px;height:22px;flex:none"><span style="flex:1">${esc2(it.n)}<br><small>${esc2(WHY[it.why]||'')}${it.bay?' · '+lbl(it.bay,r.map):''}</small></span></label>`).join('')}</div>`).join('');
 h+=`<div class="row s3row"><button class="btn g" data-a="s3rShCopy" data-rid="${esc2(r.rid)}">העתקת הרשימה</button>${st==='draft'?`<button class="btn" data-a="s3rShOk" data-rid="${esc2(r.rid)}">אישור הרשימה</button><button class="btn g" data-a="s3rShNo" data-rid="${esc2(r.rid)}">לא להזמין</button>`:''}</div>`;
 if(R.msg)h+=`<div class="ban s3warn" role="alert">${esc2(R.msg)}</div>`;
 return h}
CHG.s3rShDrop=el=>{const S=R.short[el.dataset.rid];if(!S||typeof S==='string'||!S.drop)return;const i=+el.dataset.i;if(el.checked)S.drop.delete(i);else S.drop.add(i)};
ACT.s3rShCopy=async el=>{const S=R.short[el.dataset.rid];if(!S||!S.o||!Array.isArray(S.o.items))return;
 const t=S.o.items.filter((_,i)=>!S.drop.has(i)).map(it=>'• '+it.n+(it.c?' ('+it.c+')':'')).join('\n');
 try{await navigator.clipboard.writeText(t);toast('הרשימה הועתקה')}catch(e){dlg(`<h3>רשימה להזמנה</h3><textarea readonly style="width:100%;min-height:200px">${esc2(t)}</textarea><div class="row"><button class="btn g grow" data-a="closeDlg">סגירה</button></div>`)}};
async function shDec(rid,st){const S=R.short[rid];if(!S||!S.o||R.busy)return;R.busy='sh';R.msg='';
 const drop=[...S.drop].filter(i=>i>=0&&i<200).sort((a,b)=>a-b);
 try{await fsx('/s3short/'+rid+'?updateMask.fieldPaths=st&updateMask.fieldPaths=drop&updateMask.fieldPaths=okBy&updateMask.fieldPaths=okAt',{method:'PATCH',body:JSON.stringify({fields:{st:fv(st),drop:fv(drop),okBy:fv(SY.uid),okAt:fv(Date.now())}})});
  S.o.st=st;S.o.drop=drop;toast(st==='ok'?'הרשימה אושרה':'סומן: לא להזמין')}
 catch(e){R.msg=e&&e.code===403?'אין הרשאה, או שההחלטה כבר ניתנה.':U.errText(e,'השמירה נכשלה. נסו שוב.')}
 R.busy='';rerender()}
ACT.s3rShOk=el=>ask('לאשר את הרשימה? היא לא תישלח לספק. אחרי האישור אי אפשר לשנות אותה.',()=>shDec(el.dataset.rid,'ok'),'כן, אשרו');
ACT.s3rShNo=el=>ask('לסמן שלא מזמינים לפי הרשימה הזו? אי אפשר לשנות אחר כך.',()=>shDec(el.dataset.rid,'no'),'כן, לא להזמין');
/* ---------- משימות תיקון, ערעורים והכרעה ---------- */
async function fxLoad(){if(R.fixes!==null)return;R.fixes=[];R.fl=1;const t=R.tok,d=U.data();
 try{const L=await fsList('/s3fix?pageSize=100');if(t!==R.tok)return;R.fixes=L.map(dcd).filter(f=>!d||!f.br||f.br===d.br).sort((a,b)=>+b.at-+a.at)}catch(e){if(t!==R.tok)return;R.fixes=e&&e.offline?'offline':'err'}R.fl=0;again()}
async function apLoad(){if(R.apps!==null)return;R.apps=[];const t=R.tok;
 try{const L=await fsList('/s3appeal?pageSize=100');if(t!==R.tok)return;R.apps=L.map(dcd).filter(a=>a.st==='open').sort((a,b)=>+b.at-+a.at)}catch(e){if(t!==R.tok)return;R.apps=e&&e.offline?'offline':'err'}again()}
function fixLine(f){return `<div class="s3info"><div class="row" style="justify-content:space-between;align-items:flex-start"><b>${lbl(f.slot,f.map)}</b><span class="tag ${(FST[f.st]||[])[1]||''}">${esc2((FST[f.st]||['',''])[0])}</span></div>
 <small>${f.man?esc2(f.man)+' · ':f.by==='ai'?'נפתחה אוטומטית מבדיקת AI · ':''}אחראי: ${esc2(nameOf(f.u))}${f.dueAt?' · עד '+esc2(dd(f.dueAt)):''}</small>`}
function fxH(){
 staffLoad();fxLoad();apLoad();let h='';
 const A=R.apps;
 h+=`<h4 style="margin:0 0 4px">ערעורים פתוחים${Array.isArray(A)?' ('+A.length+')':''}</h4>`;
 if(A==null||R.apps===null)h+='<div class="s3info">טוענים…</div>';else if(typeof A==='string')h+='<div class="s3info">לא הצלחנו לטעון את הערעורים.</div>';
 else h+=A.length?A.map(a=>`<div class="s3info"><b>${lbl(a.slot,mapId())}</b><br><small>${esc2(nameOf(a.by))}: ${esc2(a.txt)}</small><div class="row s3row"><button class="btn" data-a="s3rDec" data-id="${esc2(a.id)}">הכריעו</button></div></div>`).join(''):'<div class="s3info">אין ערעורים פתוחים.</div>';
 const F=R.fixes;h+=`<h4 style="margin:14px 0 4px">משימות תיקון</h4>`;
 if(F==null||(Array.isArray(F)&&!F.length&&R.fl))h+='<div class="s3info">טוענים…</div>';else if(typeof F==='string')h+=`<div class="s3info">${F==='offline'?'אין חיבור לאינטרנט.':'לא הצלחנו לטעון את משימות התיקון.'}</div>`;
 else h+=F.length?F.slice(0,30).map(f=>fixLine(f)+(f.st==='sent'?`${f.vth?`<div style="margin-top:6px">${pic(f.vth)}</div>`:''}<small>${f.vst==='ok'?'ה-AI: נראה שתוקן. אתם מחליטים.':f.vst?'ה-AI: ייתכן שלא תוקן. אתם מחליטים.':''}</small><div class="row s3row"><button class="btn" data-a="s3rFixDec" data-id="${esc2(f.id)}" data-d="ok">אישור תיקון</button><button class="btn g" data-a="s3rFixDec" data-id="${esc2(f.id)}" data-d="rej">לא תוקן</button></div>`:'')+((f.st==='open'||f.st==='rej'||f.st==='sent')?`<div class="row s3row"><button class="btn g s" data-a="s3rFixCancel" data-id="${esc2(f.id)}">ביטול המשימה</button></div>`:'')+'</div>').join(''):'<div class="s3info">אין משימות תיקון. אפשר לפתוח משימה מדוח הסבב (כפתור "משימת תיקון" ליד מדף עם בעיה).</div>';
 if(R.msg)h+=`<div class="ban s3warn" role="alert">${esc2(R.msg)}</div>`;
 return h}
ACT.s3rFixDec=el=>{const id=el.dataset.id,d=el.dataset.d==='ok'?'ok':'rej';ask(d==='ok'?'לאשר שהתיקון בוצע?':'לסמן שהתיקון לא בוצע? העובד יתבקש לצלם שוב.',async()=>{
 try{await U.fn('s3Fix',{fixTaskId:id,decide:d});toast(d==='ok'?'התיקון אושר':'סומן שלא תוקן');R.fixes=null;rerender()}catch(e){toast(U.errText(e,'ההכרעה נכשלה'))}},'כן')};
ACT.s3rFixCancel=el=>{const id=el.dataset.id;ask('לבטל את משימת התיקון?',async()=>{try{await U.fn('s3Fix',{fixTaskId:id,cancel:true});toast('המשימה בוטלה');R.fixes=null;rerender()}catch(e){toast(U.errText(e,'הביטול נכשל'))}},'כן, בטלו')};
ACT.s3rFixNew=el=>{staffLoad();const run=(R.runs||[]).find(r=>r.rid===el.dataset.run),L=(R.staff||[]).filter(s=>s.active);
 if(!L.length)return toast('אין עובד פעיל למשימה');R.vp={run:el.dataset.run,slot:el.dataset.slot,map:run&&run.map||mapId(),qid:U.qid()};
 const pref=run&&(run.uids||[]).find(u=>L.some(s=>s.uid===u))||L[0].uid,dd0=(R.set&&+R.set.due)||2;
 dlg(`<h3>משימת תיקון</h3><p style="margin:0 0 8px">${lbl(el.dataset.slot,R.vp.map)}</p>
 <label class="f"><span>למי</span><select id="s3rfu" style="min-height:44px">${L.map(s=>`<option value="${esc2(s.uid)}"${s.uid===pref?' selected':''}>${esc2(s.name)}</option>`).join('')}</select></label>
 <label class="f"><span>מה לתקן (עד 200 תווים)</span><textarea id="s3rfm" maxlength="200" rows="3" style="width:100%"></textarea></label>
 <label class="f"><span>ימים לתיקון (1 עד 14)</span><input id="s3rfd" type="number" min="1" max="14" value="${dd0}" style="min-height:44px"></label>
 <div class="row"><button class="btn grow" data-a="s3rFixGo">שלחו משימה</button><button class="btn g grow" data-a="closeDlg">ביטול</button></div>`)};
ACT.s3rFixGo=async()=>{const v=R.vp;if(!v||R.busy)return;const u=(document.getElementById('s3rfu')||{}).value,man=String((document.getElementById('s3rfm')||{}).value||'').trim(),days=Math.round(+(document.getElementById('s3rfd')||{}).value);
 if(!man)return toast('כתבו מה צריך לתקן');if(!(days>=1&&days<=14))return toast('ימים לתיקון: מספר בין 1 ל-14');R.busy='fx';
 try{const r=await U.fn('s3Fix',{qid:v.qid,map:v.map,slot:v.slot,u,man:man.slice(0,200),dueDays:days});closeDlg();toast(r&&r.toMgr?'העובד לא משויך לסניף, ולכן המשימה נפתחה אצלכם':'המשימה נשלחה לעובד');R.fixes=null;R.vp=null}
 catch(e){toast(U.errText(e,'לא הצלחנו לפתוח את המשימה'))}R.busy='';if(!document.getElementById('dlg')||!document.getElementById('dlg').open)rerender()};
/* ערעור "טעות" (עובד בסבב או מנהל) */
ACT.s3rAppeal=el=>{R.vp={run:el.dataset.run,slot:el.dataset.slot,ik:el.dataset.ik};const all=el.dataset.ik==='all';
 dlg(`<h3>${all?'המדף הזה תקין (טעות בכל התוצאה)':'זו טעות'}</h3><p style="margin:0 0 8px">${lbl(el.dataset.slot,mapId())}</p>
 <label class="f"><span>מה לא נכון? (עד 300 תווים)</span><textarea id="s3rat" maxlength="300" rows="3" style="width:100%"></textarea></label>
 <div class="row"><button class="btn grow" data-a="s3rApGo">שלחו ערעור</button><button class="btn g grow" data-a="closeDlg">ביטול</button></div>`)};
ACT.s3rApGo=async()=>{const v=R.vp;if(!v||R.busy)return;const txt=String((document.getElementById('s3rat')||{}).value||'').trim().slice(0,300);if(!txt)return toast('כתבו במילים מה לא נכון');
 R.busy='ap';const aid=v.run+'__'+v.slot+'__'+v.ik;
 try{await fsx('/s3appeal?documentId='+encodeURIComponent(aid),{method:'POST',body:JSON.stringify({fields:{run:fv(v.run),slot:fv(v.slot),ik:fv(String(v.ik)),by:fv(SY.uid),txt:fv(txt),at:fv(Date.now()),st:fv('open')}})});closeDlg();toast('הערעור נשלח למנהל');R.apps=null}
 catch(e){toast(e&&e.code===409?'כבר נשלח ערעור על הבעיה הזו':e&&e.offline?'אין חיבור לאינטרנט':e&&e.code===403?'אין הרשאה לערער על הסבב הזה':'שליחת הערעור נכשלה')}R.busy=''};
/* מסך הכרעה למנהל */
function decBody(){const D=R.dec;if(!D)return '';const a=D.a,ai=D.ai,ik=a.ik==='all'?null:+a.ik,is=ai&&Array.isArray(ai.iss)&&ik!=null?ai.iss[ik]:null,p=R.ph[a.run+'|'+a.slot];
 return `<h3>הכרעה בערעור</h3><p style="margin:0 0 6px"><b>${lbl(a.slot,mapId())}</b></p>
 <div class="s3info"><b>${a.ik==='all'?'כל התוצאה של המדף':is?esc2(ISS[is.k]||'בעיה'):'הבעיה'}</b>${is&&is.t?`<br><small>${esc2(is.t)}</small>`:''}${a.ik==='all'&&ai&&ai.st?`<br><small>תוצאת ה-AI: ${esc2(({ok:'תקין',issue:'יש בעיות',review:'לבדיקה',bad:'לא קריא'})[ai.st]||ai.st)}</small>`:''}</div>
 <div class="s3info"><b>${esc2(nameOf(a.by))} כתב/ה:</b><br>${esc2(a.txt)}</div>
 ${p&&p!=='err'?pic(p,is?[{box:is.box}]:[]):p===undefined||p===null?'<div class="s3info">טוענים את התמונה…</div>':''}
 <label class="f"><span>תגובה לעובד (לא חובה)</span><textarea id="s3rdt" maxlength="300" rows="2" style="width:100%">${esc2(D.txt||'')}</textarea></label>
 <label class="row" style="min-height:44px;gap:8px"><input type="checkbox" id="s3rdn" ${D.note?'checked':''} style="width:22px;height:22px;flex:none"><span>אם מקבלים: להפוך להערה קבועה למדף הזה, כדי שה-AI יתחשב בה בעתיד</span></label>
 <div class="row"><button class="btn grow" data-a="s3rDecGo" data-d="acc">מקבלים את הערעור</button><button class="btn g grow" data-a="s3rDecGo" data-d="rej">דוחים</button></div><div class="row"><button class="btn g grow" data-a="closeDlg">סגירה</button></div>`}
function paintDec(){const D=R.dec,dl=document.getElementById('dlg');if(!D||!dl||!dl.open||!dl.querySelector('[data-a=s3rDecGo]'))return;
 const t=document.getElementById('s3rdt'),n=document.getElementById('s3rdn');if(t)D.txt=t.value;if(n)D.note=n.checked;dlg(decBody())}
ACT.s3rDec=async el=>{const a=(Array.isArray(R.apps)?R.apps:[]).find(x=>x.id===el.dataset.id);if(!a)return;R.dec={a,ai:undefined,txt:'',note:false};dlg(decBody());phLoad(a.run,a.slot);
 try{const o=U.dec(await fsx('/srun/'+a.run+'/ai/'+a.slot));if(R.dec&&R.dec.a===a){R.dec.ai=o||null;paintDec()}}catch(e){}};
ACT.s3rDecGo=async el=>{const D=R.dec;if(!D||R.busy)return;const st=el.dataset.d==='acc'?'acc':'rej',dec=String((document.getElementById('s3rdt')||{}).value||'').trim().slice(0,300),note=st==='acc'&&!!(document.getElementById('s3rdn')||{}).checked;R.busy='dc';
 const f={st:fv(st),dec:fv(dec),decBy:fv(SY.uid),decAt:fv(Date.now())};if(st==='acc')f.note=fv(note);
 try{await fsx('/s3appeal/'+encodeURIComponent(D.a.id)+'?'+Object.keys(f).map(k=>'updateMask.fieldPaths='+k).join('&'),{method:'PATCH',body:JSON.stringify({fields:f})});closeDlg();R.dec=null;R.apps=null;
  toast(st==='acc'?'הערעור התקבל. הציון יתעדכן בשרת בדקות הקרובות':'הערעור נדחה')}
 catch(e){toast(e&&e.code===403?'ההכרעה כבר ניתנה, או שאין הרשאה':U.errText(e,'ההכרעה נכשלה'))}R.busy='';rerender()};
/* ---------- המלצות ---------- */
function recsH(){
 rlGo();if(R.runsErr)return `<div class="s3info">${esc2(R.runsErr)} <button class="btn g s" data-a="s3rRetryRuns">נסו שוב</button></div>`;
 if(R.runs===null)return '<div class="s3info">טוענים…</div>';
 const L=mine();if(!L.length)return `<div class="s3info">עוד אין סבבים בסניף הזה. ההמלצות יופיעו אחרי הסבב הראשון.</div>`;
 const r=curRun();aiLoad(r.rid);const A=R.ai[r.rid];let h=runChips(L);
 const sr=Array.isArray(r.recs)?r.recs:[];
 h+=`<div class="s3info"><b>המלצות מסבב ${esc2(dd2(r.openAt))}</b><br><small>${sr.length?'המלצות לסידור החנות כולה, ואחריהן המלצות לפי מדף. ':''}כמה המלצות לכל מדף – לפי ההגדרות. אלה הצעות של ה-AI, לא הוראות.</small></div>`;
 if(sr.length)h+=sr.map(x=>`<div class="s3info">${esc2(x.t)}${x.bay?`<br><small>${lbl(x.bay,r.map)}</small>`:''}</div>`).join('');
 if(A==null)return h+'<div class="s3info">טוענים…</div>';
 if(typeof A==='string')return h+`<div class="s3info">${A==='offline'?'אין חיבור לאינטרנט.':'לא הצלחנו לטעון את ההמלצות.'} <button class="btn g s" data-a="s3rRetry">נסו שוב</button></div>`;
 const it=A.filter(a=>Array.isArray(a.recs)&&a.recs.length).slice(0,12);
 if(!it.length&&!sr.length)return h+'<div class="s3info">אין המלצות לסבב הזה. ייתכן שמספר ההמלצות בהגדרות הוא 0.</div>';
 it.forEach((a,i)=>{if(i<4)phLoad(r.rid,a.slot)});
 return h+it.map(a=>{const p=R.ph[r.rid+'|'+a.slot],bx=a.recs.map(x=>({box:x.box,c:'rc'}));
  return `<div class="s3info"><b>${lbl(a.slot,r.map)}</b>${a.recs.map((x,i)=>`<div style="margin-top:6px">${i+1}. ${esc2(x.t)}</div>`).join('')}
  ${p===undefined?`<div class="row s3row"><button class="btn g s" data-a="s3rRecImg" data-run="${esc2(r.rid)}" data-slot="${esc2(a.slot)}">הצג תמונה עם סימון</button></div>`:p===null?'<div class="s3info">טוענים את התמונה…</div>':p==='err'?'<div class="s3info">לא הצלחנו לטעון את התמונה.</div>':`<div style="margin-top:8px">${pic(p,bx)}</div>`}</div>`}).join('')}
ACT.s3rRecImg=el=>{phLoad(el.dataset.run,el.dataset.slot);rerender()};
function rlGo(){if(R.runs===null&&!R.rb&&!R.runsErr)rl()}
ACT.s3rRetryRuns=()=>{R.runsErr='';R.runs=null;rerender()};
/* ---------- הגדרות ---------- */
const SET0=()=>({w:{p:35,h:30,o:20,d:15},show:['fix'],recN:3,stype:'',catMode:'mix',cats:[],sub:'manual',subU:'',due:2,numDir:'rtl'});
async function setLoad(){if(R.set!==undefined)return;R.set=null;const t=R.tok,br=U.brSel();
 try{const o=await U.get('/s3set/'+br);R.set=Object.assign(SET0(),o||{});R.setNew=!o}catch(e){R.set=e&&e.offline?'offline':'err'}
 if(U.isMgr()&&R.use===undefined){R.use=null;try{R.use=await U.get('/s3use/b_'+br)||{}}catch(e){R.use={}}
  R.suse=null;try{R.suse=await U.get('/s3use/s_'+U.mapIdOf('s',br))||{}}catch(e){R.suse={}}}
 if(t===R.tok)again()}
function setH(d){
 setLoad();staffLoad();const S=R.set;
 if(S===undefined||S===null)return '<div class="s3info">טוענים…</div>';
 if(typeof S==='string')return `<div class="s3info">${S==='offline'?'אין חיבור לאינטרנט.':'לא הצלחנו לטעון את ההגדרות.'} <button class="btn g s" data-a="s3rSetRetry">נסו שוב</button></div>`;
 const sh=new Set(S.show||[]),W=S.w||{},tot=['p','h','o','d'].reduce((a,k)=>a+(+W[k]||0),0);
 let h=`<p class="note s3note" style="margin-top:0">ההגדרות חלות על הסניף ${esc2((U.brs().find(b=>b.id===d.br)||{}).name||'')}. ${R.setNew?'עוד לא נשמרו הגדרות, ומוצגות ברירות המחדל.':''}</p>
 <div class="s3info"><b>משקלות הציון (הסכום חייב להיות 100)</b>${['p','h','o','d'].map(k=>`<label class="row" style="margin-top:8px;justify-content:space-between;min-height:44px"><span>${CAT[k]}</span><input type="number" inputmode="numeric" min="0" max="100" id="s3rw-${k}" data-c="s3rWc" value="${+W[k]||0}" style="width:84px;min-height:44px;text-align:center"></label>`).join('')}
 <div class="row" style="margin-top:6px"><b>סכום: <span id="s3rwt">${tot}</span></b><small id="s3rwm" class="note">${tot===100?'':'צריך להיות 100'}</small></div></div>
 <div class="s3info"><b>מה העובד רואה בסוף הצילום</b><small class="note"><br>משימות התיקון שלו מוצגות תמיד.</small>
  ${[['score','הציון'],['recs','המלצות סידור'],['full','כל התוצאות המלאות (מוצרים וחוסרים)']].map(([k,l])=>`<label class="row" style="min-height:44px;gap:8px;margin-top:4px"><input type="checkbox" id="s3rs-${k}" ${sh.has(k)?'checked':''} style="width:22px;height:22px;flex:none"><span>${l}</span></label>`).join('')}</div>
 <div class="s3info"><label class="f"><span>כמה המלצות לכל מדף (0 עד 10)</span><input type="number" inputmode="numeric" min="0" max="10" id="s3rrn" value="${+S.recN||0}" style="min-height:44px"></label>
  <label class="f"><span>סוג החנות (עד 40 תווים, עוזר ל-AI)</span><input type="text" maxlength="40" id="s3rst" value="${esc2(S.stype||'')}" style="min-height:44px"></label>
  <label class="f"><span>איך מזהים קטגוריות מוצרים</span><select id="s3rcm" style="min-height:44px">${[['list','לפי הרשימה שלי בלבד'],['ai','זיהוי אוטומטי בלבד'],['mix','שניהם']].map(([v,l])=>`<option value="${v}"${S.catMode===v?' selected':''}>${l}</option>`).join('')}</select></label>
  <label class="f"><span>רשימת הקטגוריות (שורה לכל קטגוריה, עד 150)</span><textarea id="s3rcc" rows="4" style="width:100%">${esc2((S.cats||[]).join('\n'))}</textarea></label></div>
 <div class="s3info"><label class="f"><span>מי מחליף עובד שלא יכול</span><select id="s3rsb" data-c="s3rSbc" style="min-height:44px">${[['manual','המנהל בוחר'],['fixed','מחליף קבוע'],['any','כל עובד יכול לקחת']].map(([v,l])=>`<option value="${v}"${S.sub===v?' selected':''}>${l}</option>`).join('')}</select></label>
  <label class="f" id="s3rsuw"${S.sub==='fixed'?'':' hidden'}><span>המחליף הקבוע</span><select id="s3rsu" style="min-height:44px"><option value="">לא נבחר</option>${(R.staff||[]).filter(s=>s.active).map(s=>`<option value="${esc2(s.uid)}"${S.subU===s.uid?' selected':''}>${esc2(s.name)}</option>`).join('')}</select></label>
  <label class="f"><span>ימים לסיום סבב ולתיקון (1 עד 14)</span><input type="number" inputmode="numeric" min="1" max="14" id="s3rdu" value="${+S.due||2}" style="min-height:44px"></label></div>
 <div class="row s3row"><button class="btn grow" data-a="s3rSetSave"${R.busy==='set'?' aria-disabled="true"':''}>שמירת ההגדרות</button></div>`;
 if(U.isMgr()){const cap=R.use&&Number.isInteger(R.use.cap)?R.use.cap:d.cfg.cap,mn=R.use&&R.use.m===new Date().toISOString().slice(0,7)||R.use&&!R.use.m,n=mn&&R.use&&Number.isInteger(R.use.n)?R.use.n:null,su=R.suse||{},sn=Number.isInteger(su.n)?su.n:0;
  h+=`<div class="s3info"><b>מכסת AI חודשית לסניף</b><br><small>${n!=null?`נוצלו החודש: ${n} מתוך ${cap}. `:''}תמונה אחת שנשלחה לבדיקה נספרת כיחידה אחת.</small>
  <br><b>מכסת הקמת המפה (חד-פעמית)</b><br><small>${Number.isInteger(su.lim)?`נוצלו בהקמה: ${sn} מתוך ${su.lim}.`:'עוד לא נעשה שימוש בבדיקה חכמה בהקמה.'}</small></div>`}
 if(isSa()){const cap=R.use&&Number.isInteger(R.use.cap)?R.use.cap:d.cfg.cap;
  h+=`<div class="s3info"><b>שינוי מכסה חודשית (מנהל־על)</b>
  <label class="f"><span>מכסה (0 עד 100,000)</span><input type="number" inputmode="numeric" min="0" max="100000" id="s3rcap" value="${+d.cfg.cap||0}" style="min-height:44px"></label><div class="row"><button class="btn g grow" data-a="s3rCapSave">שמירת המכסה</button></div></div>`}
 if(R.msg)h+=`<div class="ban s3warn" role="alert">${esc2(R.msg)}</div>`;
 return h}
CHG.s3rWc=()=>{const t=['p','h','o','d'].reduce((a,k)=>a+(Math.round(+(document.getElementById('s3rw-'+k)||{}).value)||0),0),e=document.getElementById('s3rwt'),m=document.getElementById('s3rwm');if(e)e.textContent=t;if(m)m.textContent=t===100?'':'צריך להיות 100'};
CHG.s3rSbc=el=>{const w=document.getElementById('s3rsuw');if(w)w.hidden=el.value!=='fixed'};
ACT.s3rSetRetry=()=>{R.set=undefined;rerender()};
ACT.s3rSetSave=async()=>{if(R.busy)return;const g=id=>document.getElementById(id),S=R.set;if(!S||typeof S==='string')return;
 const w={};for(const k of ['p','h','o','d']){const n=Math.round(+g('s3rw-'+k).value);if(!(n>=0&&n<=100)){R.msg='כל משקל צריך להיות בין 0 ל-100.';return rerender()}w[k]=n}
 if(w.p+w.h+w.o+w.d!==100){R.msg='סכום המשקלות חייב להיות 100. כרגע '+(w.p+w.h+w.o+w.d)+'.';return rerender()}
 const recN=Math.round(+g('s3rrn').value),due=Math.round(+g('s3rdu').value);
 if(!(recN>=0&&recN<=10)){R.msg='מספר ההמלצות לכל מדף: בין 0 ל-10.';return rerender()}
 if(!(due>=1&&due<=14)){R.msg='ימים לסיום: בין 1 ל-14.';return rerender()}
 const show=['fix',...['score','recs','full'].filter(k=>g('s3rs-'+k).checked)],cats=[...new Set(String(g('s3rcc').value).split('\n').map(x=>x.trim().slice(0,30)).filter(Boolean))].slice(0,150),sub=g('s3rsb').value,subU=sub==='fixed'?String(g('s3rsu').value||''):'';
 const o={w,show,recN,stype:String(g('s3rst').value||'').trim().slice(0,40),catMode:g('s3rcm').value,cats,sub,due,numDir:S.numDir==='ltr'?'ltr':'rtl',upd:Date.now(),by:SY.uid};if(subU)o.subU=subU;
 R.busy='set';R.msg='';
 try{await fsx('/s3set/'+U.brSel(),{method:'PATCH',body:JSON.stringify({fields:Object.fromEntries(Object.entries(o).map(([k,v])=>[k,fv(v)]))})});R.set=undefined;toast('ההגדרות נשמרו')}
 catch(e){R.msg=e&&e.code===403?'אין הרשאה לשמור הגדרות, או שהערכים לא עברו בדיקה.':U.errText(e,'השמירה נכשלה. נסו שוב.')}
 R.busy='';rerender()};
ACT.s3rCapSave=()=>{const d=U.data(),cap=Math.round(+(document.getElementById('s3rcap')||{}).value);if(!d||!(cap>=0&&cap<=100000))return toast('מכסה: מספר בין 0 ל-100,000');
 ask('לשנות את המכסה החודשית של הסניף ל-'+cap+' תמונות?',async()=>{try{await U.fn('s3SetBranch',{brId:d.br,wh:!!d.cfg.wh,cap,on:d.cfg.on!==false});R.use=undefined;U.drop();toast('המכסה נשמרה');rerender()}catch(e){toast(U.errText(e,'השמירה נכשלה'))}},'כן, שנו')};
/* ---------- לשונית דוחות: מנהל ---------- */
function repMgr(d){
 rlGo();
 let h=`<div class="s3tabs" role="tablist">${SUBS().map(([k,l])=>`<button role="tab" aria-selected="${R.sub===k}" class="chip ${R.sub===k?'on':''}" data-a="s3rSub" data-k="${k}">${l}</button>`).join('')}</div>`;
 h+=secBtn();
 if(R.runsErr)return h+`<div class="s3info">${esc2(R.runsErr)} <button class="btn g s" data-a="s3rRetryRuns">נסו שוב</button></div>`;
 if(R.runs===null&&R.sub!=='set')return h+'<div class="s3info">טוענים את הסבבים…</div>';
 if(R.sub==='trend')h+=trendH(mine());else if(R.sub==='wk')h+=wkH();else if(R.sub==='br')h+=brH();else if(R.sub==='short')h+=shH();else if(R.sub==='fix')h+=fxH();else h+=runH(d);
 return h}
/* ---------- עובד: הדוח שלי ---------- */
async function wrLoad(rid){if(R.wr[rid]!==undefined)return;R.wr[rid]=null;const t=R.tok;
 try{const r=await U.fn('s3View',{runId:rid});R.wr[rid]=r&&r.run||{}}catch(e){R.wr[rid]=e&&e.offline?'offline':'err'}if(t===R.tok)again()}
function repWk(d){
 const m=[mk(0),mk(1)];m.forEach(x=>perfLoad(SY.uid,x));
 let h=`<b>הנתונים שלי</b>`+m.map(x=>perfH(SY.uid,mlbl(x),x)).join('');
 const L=Array.isArray(X.runs)?X.runs:[];
 if(X.runs===null&&!X.runsErr)U.loadRuns();
 h+=`<h4 style="margin:14px 0 4px">התוצאות של הסבב הפתוח</h4>`;
 if(!L.length)h+=`<div class="s3info">אין סבב פתוח. התוצאות מוצגות בזמן שהסבב פתוח.</div>`;
 for(const r of L){wrLoad(r.runId);const v=R.wr[r.runId];
  if(v==null)h+='<div class="s3info">טוענים…</div>';
  else if(typeof v==='string')h+=`<div class="s3info">${v==='offline'?'אין חיבור לאינטרנט.':'לא הצלחנו לטעון את התוצאות.'}</div>`;
  else{const A=Object.entries(v.ai||{}).map(([slot,a])=>Object.assign({slot},a)),rows=probRows(A);
   h+=`<div class="s3info"><b>סבב עד ${esc2(dd(r.dueAt))}</b>${v.sum&&Number.isFinite(+v.sum.score)?kgH(['ציון הסבב',+v.sum.score]):''}<small class="note"><br>${rows.length?'מדפים שלך עם בעיות: '+rows.length:'עוד אין בעיות במדפים שצולמו.'}</small></div>`+rows.map(a=>shelfRow(a,r.runId,r.map,null,false,true)).join('')}}
 h+=pastH();
 return h+fixCards('')}
/* סבבים שנסגרו (s3View.past, החדש קודם; בשרת ישן השדה חסר = רשימה ריקה) */
function pastH(){
 const P=Array.isArray(X.past)?X.past:[];
 let h=`<h4 style="margin:14px 0 4px">הסבבים הקודמים שלי</h4>`;
 if(!P.length)return h+`<div class="s3info">עוד אין סבבים קודמים ב-30 הימים האחרונים.</div>`;
 return h+P.map(r=>{const n=r.n||{},ad=r.k==='adhoc';return `<div class="s3info" data-past="${esc2(r.runId||'')}"><b>${ad?'דיווח יזום':'סבב'} · ${esc2(dd(r.doneAt||r.dueAt))}</b>${ad?' <span class="chip on" style="min-height:0;padding:2px 8px">יזום</span>':''}<small class="note"><br>${Number.isFinite(+n.n)?'צולמו '+(+n.d||0)+' מתוך '+(+n.n)+' מקטעים':''}</small></div>`}).join('')}
/* כפתור "שאלו את המזכירה" – למנהל בלבד, כשהמזכירה פעילה בעסק (פותח את המזכירה הקיימת, ACT.secOpen) */
function secBtn(){try{if(!U.isMgr()||typeof ACT==='undefined'||typeof ACT.secOpen!=='function')return '';const b=SY&&SY.biz;if(!(b&&b.features&&b.features.secretary===true))return '';return `<div class="row s3row" style="margin-top:8px"><button class="btn g" data-a="secOpen" style="min-height:44px">שאלו את המזכירה על הדוחות</button></div>`}catch(e){return ''}}
/* ---------- משימות התיקון של העובד + צילום אימות ---------- */
function fixCards(head){
 const F=Array.isArray(X.fixes)?X.fixes:[];if(!F.length)return head?'':`<h4 style="margin:14px 0 4px">משימות תיקון</h4><div class="s3info">אין לך משימות תיקון.</div>`;
 const mid=F[0]&&F[0].map;
 return `<h4 style="margin:14px 0 4px">משימות תיקון (${F.length})</h4>`+F.map(f=>{
  if(f.run)wrLoad(f.run);const v=f.run&&R.wr[f.run],a=v&&typeof v==='object'&&v.ai&&v.ai[f.slot],is=a&&Array.isArray(a.iss)?(f.iks||[]).map(i=>a.iss[i]).filter(Boolean):[];
  const vr=R.vr[f.id],busy=R.busy==='v'+f.id,st=FST[f.st]||['',''];
  return `<div class="s3info"><div class="row" style="justify-content:space-between;align-items:flex-start"><b>${lbl(f.slot,f.map||mid)}</b><span class="tag ${st[1]}">${esc2(st[0])}</span></div>
  ${f.man?`<div style="margin-top:6px">${esc2(f.man)}</div>`:''}${is.map(i=>`<div style="margin-top:6px"><b>${esc2(ISS[i.k]||'בעיה')}</b>${i.t?`<br><small>${esc2(i.t)}</small>`:''}</div>`).join('')}
  <small class="note">${f.dueAt?'לסיים עד '+esc2(dd(f.dueAt)):''}</small>
  ${vr?`<div class="ban s3warn" role="status">${esc2(vr)}</div>`:''}${busy?'<div class="s3info" role="status">שולחים ובודקים…</div>':''}
  ${f.st==='sent'?'<div class="s3info">צילום האימות נשלח. ממתין לאישור המנהל.</div>':''}
  ${f.st==='open'||f.st==='rej'?`<div class="row s3row"><label class="btn grow"${busy?' aria-disabled="true"':''}>${f.st==='rej'?'צלמו שוב לאימות':'צלמו לאימות'}<input type="file" accept="image/*" capture="environment" data-c="s3rVPick" data-fix="${esc2(f.id)}" data-slot="${esc2(f.slot)}" hidden></label></div>`:''}</div>`}).join('')}
async function vSend(fid,slot,p){R.busy='v'+fid;R.vr[fid]='';rerender();
 try{if(!R.vq[fid])R.vq[fid]=U.qid();
  const r=await U.fn('shelfCheck',{qid:R.vq[fid],mode:'verify',fix:fid,slot,at:Date.now(),src:'photo',rt:0,img:await U.b64(p.full),th:await U.b64(p.th)});delete R.vq[fid];
  R.vr[fid]=r&&(r.person||r.st==='person')?'בתמונה היה אדם, ולכן היא לא נשמרה. צלמו שוב בלי אנשים.':r&&r.fixSt==='ok'?'הבעיה תוקנה. תודה!':r&&r.fixSt==='rej'?'נראה שהבעיה עדיין קיימת. תקנו וצלמו שוב.':r&&r.fixSt==='sent'?'הצילום נשלח למנהל לאישור.':'הצילום התקבל.';
  X.runsAt=0;U.loadRuns(true)}
 catch(e){if(!(e&&e.offline))delete R.vq[fid];R.vr[fid]=U.errText(e,'השליחה נכשלה. נסו שוב.')}
 R.busy='';rerender()}
CHG.s3rVPick=async el=>{const f=el.files&&el.files[0],fid=el.dataset.fix,slot=el.dataset.slot;el.value='';if(!f||R.busy)return;
 if(f.type&&!/^image\//.test(f.type)){R.vr[fid]='הקובץ שנבחר אינו תמונה.';return rerender()}
 if(navigator.onLine===false){R.vr[fid]='אין חיבור לאינטרנט. צלמו שוב כשיש רשת.';return rerender()}
 R.busy='v'+fid;R.vr[fid]='';rerender();
 try{const p=await U.prep(f),bad=U.badOf(p);if(bad){R.busy='';R.vr[fid]=bad==='blur'?'התמונה לא חדה. החזיקו את הטלפון יציב וצלמו שוב.':'התמונה חשוכה מדי. הדליקו אור וצלמו שוב.';return rerender()}await vSend(fid,slot,p)}
 catch(e){R.busy='';R.vr[fid]='לא הצלחנו לעבד את התמונה. נסו לצלם שוב.';rerender()}};
U.fixHtml=()=>{if(!U.feat()||!Array.isArray(X.fixes)||!X.fixes.length)return '';sync();return fixCards('x')};
/* ---------- ייצוא PDF (נוצר במכשיר) ---------- */
async function bmp(path){if(!path||typeof window.abkSt!=='function')return null;try{const r=await window.abkSt('/'+encodeURIComponent(path)+'?alt=media');return await createImageBitmap(await r.blob())}catch(e){return null}}
async function pdfRun(){
 const r=curRun(),A=r&&R.ai[r.rid];if(!r||!Array.isArray(A)||R.busy)return;
 if(typeof mkPdf!=='function'||typeof saveFile!=='function'){R.msg='ייצוא PDF לא זמין בגרסה הזו.';return rerender()}
 R.busy='pdf';R.msg='';rerender();
 try{
  const W=1754,H=1240,M=70,F='"Heebo","Noto Sans Hebrew","Segoe UI",Arial,sans-serif',pages=[],d=U.data(),pr=prevRun(r),s=r.sum||{},ps=pr&&pr.sum;
  try{await document.fonts.load('700 30px Heebo')}catch(e){}
  const pg=()=>{const c=document.createElement('canvas');c.width=W;c.height=H;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,W,H);x.direction='rtl';x.textAlign='right';x.fillStyle='rgb(25,25,25)';pages.push(c);return x};
  const wrap=(x,t,w)=>{const o=[];let l='';for(const wd of String(t||'').split(/\s+/)){const tr=l?l+' '+wd:wd;if(x.measureText(tr).width>w&&l){o.push(l);l=wd}else l=tr}if(l)o.push(l);return o};
  const T=(x,t,px,y,sz,b,col)=>{x.font=(b?'700 ':'')+sz+'px '+F;x.fillStyle=col||'rgb(25,25,25)';x.fillText(t,px,y)};
  let x=pg();
  T(x,'דוח סבב בדיקת מדפים',W-M,100,52,1);T(x,((d&&d.maps.s&&d.maps.s.name)||'')+' · סבב מ-'+dd2(r.openAt),W-M,160,32);
  T(x,Number.isFinite(+s.score)?'ציון: '+(+s.score):'הסבב עוד לא סוכם',W-M,270,90,1,'rgb(140,100,10)');
  let y=340;
  if(Number.isFinite(+s.dScore)||ps){const dS=Number.isFinite(+s.dScore)?+s.dScore:+s.score-+ps.score;T(x,'מול הסבב הקודם: '+dlt(dS),W-M,y,34);y+=60}
  for(const k of ['p','h','o','d'])if(s.cat&&Number.isFinite(+s.cat[k])){T(x,CAT[k]+': '+(+s.cat[k]),W-M,y,32);x.fillStyle='rgb(225,225,225)';x.fillRect(W-M-700,y+14,700,14);x.fillStyle='rgb(140,100,10)';x.fillRect(W-M-700*Math.min(100,+s.cat[k])/100,y+14,700*Math.min(100,+s.cat[k])/100,14);y+=70}
  T(x,`תקינים ${+s.nOk||0} · עם בעיות ${+s.nIss||0} · לבדיקה ${+s.nRev||0} · לא צולמו ${+s.nMiss||0} · לא קריאים ${+s.nBad||0}`,W-M,y+10,30);
  T(x,'נתוני מכירות לפי מוצר: לא זמין',W-M,H-70,26,0,'rgb(110,110,110)');
  const rows=probRows(A).slice(0,24),PA=pr?R.ai[pr.rid]:null,pm=Array.isArray(PA)?new Map(PA.map(a=>[a.slot,a])):null;
  for(let i=0;i<rows.length;i+=4){x=pg();T(x,'בעיות לפי מדף',W-M,80,40,1);
   for(let j=0;j<4&&i+j<rows.length;j++){const a=rows[i+j],top=120+j*270,iss=Array.isArray(a.iss)?a.iss:[];
    x.fillStyle='rgb(240,240,240)';x.fillRect(M,top,W-2*M,250);
    let ph='';try{const o=U.dec(await fsx('/srun/'+r.rid+'/ph/'+a.slot));ph=o&&!o.person&&!o.gone?o.th||'':''}catch(e){}
    const im=await bmp(ph),bw=330,bh=230,bx=W-M-10-bw,by=top+10;
    if(im){const k=Math.max(bw/im.width,bh/im.height),sw=bw/k,sh=bh/k;x.save();x.beginPath();x.rect(bx,by,bw,bh);x.clip();x.drawImage(im,(im.width-sw)/2,(im.height-sh)/2,sw,sh,bx,by,bw,bh);x.restore();
     iss.forEach(it=>{if(Array.isArray(it.box)&&it.box.length===4){const q=it.box.map(n=>Math.max(0,Math.min(1000,+n||0))),ox=(im.width-sw)/2,oy=(im.height-sh)/2;x.strokeStyle='rgb(200,30,30)';x.lineWidth=3;x.strokeRect(bx+(q[0]/1000*im.width-ox)*k,by+(q[1]/1000*im.height-oy)*k,q[2]/1000*im.width*k,q[3]/1000*im.height*k)}})}
    else{x.fillStyle='rgb(200,200,200)';x.fillRect(bx,by,bw,bh);T(x,'אין תמונה',bx+bw-20,by+bh/2,28,0,'rgb(90,90,90)')}
    const tx=bx-20;x.font='700 30px '+F;let ty=top+44;T(x,lblT(a.slot,r.map)+(pm&&pm.get(a.slot)&&pm.get(a.slot).st==='issue'?' · נשארה מהסבב הקודם':''),tx,ty,30,1);ty+=14;
    for(const it of iss.slice(0,4)){x.font='26px '+F;for(const ln of wrap(x,'• '+(ISS[it.k]||'בעיה')+(it.sev?' ('+SEV[it.sev]+')':'')+(it.t?': '+it.t:''),W-2*M-bw-60).slice(0,2)){ty+=34;if(ty<top+240)T(x,ln,tx,ty,26)}}
    if(Array.isArray(a.recs)&&a.recs[0]&&ty<top+200){x.font='24px '+F;ty+=36;T(x,'המלצה: '+String(a.recs[0].t).slice(0,90),tx,ty,24,0,'rgb(110,80,10)')}}}
  const name='דוח-סבב-'+new Date(+r.openAt).toISOString().slice(0,10)+'.pdf';
  await saveFile(name,mkPdf(pages.map(c=>c.toDataURL('image/jpeg',.82))),'application/pdf');
  R.msg=rows.length<probRows(A).length?`ה-PDF כולל את ${rows.length} המדפים הראשונים (לפי חומרה).`:'';
 }catch(e){R.msg='יצירת ה-PDF נכשלה: '+(e&&e.message||'שגיאה');}
 R.busy='';rerender()}
ACT.s3rPdf=()=>{pdfRun()};
/* ---------- חיבור ללשוניות ---------- */
{const t0=U.tabHtml;U.tabHtml=(tab,d)=>{
 if(tab!=='rep'&&tab!=='recs'&&tab!=='set')return typeof t0==='function'?t0(tab,d):'';
 if(!U.feat()||!d)return '';sync();
 if(tab==='rep')return U.isMgr()?repMgr(d):repWk(d);
 if(!U.isMgr())return '';
 return tab==='recs'?recsH():setH(d)}}
const css=document.createElement('style');
css.textContent=`/* דוחות (שלב 13): רק טוקני עיצוב */
.s3pic{position:relative;direction:ltr;border-radius:var(--r-m,12px);overflow:hidden;border:1px solid var(--line);background:var(--bg);line-height:0}.s3pic img{width:100%;max-height:46vh;object-fit:contain;display:block}
.s3bx{position:absolute;border:2px solid var(--bad);border-radius:4px;box-shadow:0 0 0 1px var(--bg)}.s3bx.rc{border-color:var(--acc)}
.s3bar{height:8px;border-radius:4px;background:var(--line);overflow:hidden}.s3bar>i{display:block;height:100%;background:var(--acc)}`;
document.head.appendChild(css);
})();
