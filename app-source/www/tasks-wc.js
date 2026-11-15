/* מרכז עבודה – סבב 1 (מסך המשימות): לשונית "היום שלי", לוח צוות למנהל ו"דורש ממני", תזכורות אישיות במכשיר עם התראות מקומיות,
   "דחה" במכשיר (היעד האמיתי לא משתנה), סינון וחיפוש (בזיכרון, נשמר במכשיר), תבניות משימה למנהל (במכשיר), "הזכר לעובד" (nd/ndN).
   הכול מאחורי bzF('tasks'). נטען אחרי index.html; ה-hooks שם בודקים window.TKW, כך שבלי הקובץ הזה המסך נשאר כמו קודם.
   אין כאן קריאות fsx: כתיבה לשרת רק דרך tkPatch / FRM.tkAdd / ACT.ptDone הקיימים.
   נשמר במכשיר (לכל עסק ומשתמש): lp-rem-<uid> תזכורות, lp-snz-<uid> דחיות, lp-tk-dt-<uid> "בוצע היום", lp-tk-ndv-<uid> "ראיתי" לתזכורת מנהל,
   lp-tk-mn-<uid> הודעת בוקר; lp-tk-flt סינון, lp-tk-tpl תבניות מנהל.
   התראות: @capacitor/local-notifications, רק אם התוסף קיים (APK ישן / דפדפן – הכול בתוך האפליקציה בלבד). */
(function(){'use strict';
if(typeof V==='undefined'||typeof V.tk!=='function'||typeof tkIL==='undefined'||typeof tkDl!=='function')return;
const W={},H=36e5,MIN=6e4,ND_GAP=30*MIN,MID=7000001;
const on=()=>{try{return !!(fbRole()&&bzF('tasks'))}catch(e){return false}};
const KU=k=>LK(k+'-'+(SY.uid||'')),rd=(k,d)=>{try{const v=JSON.parse(localStorage.getItem(k));return v==null?d:v}catch(e){return d}},wr=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}};
/* ---- זמן (שעון ישראל) ---- */
const ILF=(()=>{try{return new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Jerusalem',hourCycle:'h23',year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric'})}catch(e){return null}})();
const ilP=ms=>{if(!ILF){const x=new Date(ms);return{y:x.getFullYear(),m:x.getMonth(),d:x.getDate(),h:x.getHours(),n:x.getMinutes()}}const p={};ILF.formatToParts(new Date(ms)).forEach(x=>p[x.type]=+x.value);return{y:p.year,m:p.month-1,d:p.day,h:p.hour%24,n:p.minute}};
const day0=o=>{const t=tkIL.today(),x=tkYMD(t[0],t[1],t[2]+(o||0));return tkIL.at(x[0],x[1],x[2])};
const dowOf=(y,m,d)=>new Date(Date.UTC(y,m,d)).getUTCDay();
const wkEnd=()=>{const t=tkIL.today();return day0(7-dowOf(t[0],t[1],t[2]))};
const atDay=(o,h,n)=>{const t=tkIL.today(),x=tkYMD(t[0],t[1],t[2]+o);return tkIL.at(x[0],x[1],x[2],h,n)};
const p2=n=>String(n).padStart(2,'0'),hhmm=ms=>{const p=ilP(ms);return p2(p.h)+':'+p2(p.n)};
const DW=['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳'];
const whenTx=ms=>{if(!(ms<Infinity))return 'בלי תאריך';const d0=day0(0);if(ms>=d0&&ms<day0(1))return 'היום '+hhmm(ms);if(ms>=day0(1)&&ms<day0(2))return 'מחר '+hhmm(ms);if(ms>=day0(-1)&&ms<d0)return 'אתמול '+hhmm(ms);const p=ilP(ms);return 'יום '+DW[dowOf(p.y,p.m,p.d)]+' '+p.d+'/'+(p.m+1)+' '+p2(p.h)+':'+p2(p.n)};
/* ---- דחייה במכשיר: {'p:<id>'|'r:<id>': עד מתי} ---- */
function snzL(){const m=rd(KU('lp-snz'),{}),now=Date.now();let ch=0;for(const k in m)if(!(m[k]>now)){delete m[k];ch=1}if(ch)wr(KU('lp-snz'),m);return m}
const snzSet=(k,v)=>{const m=snzL();if(v)m[k]=v;else delete m[k];wr(KU('lp-snz'),m)};
/* ---- תזכורות: {id,txt,at,rp:''|'d'|'w'|'m',wd:[0-6],md,hm,nid} – at = המופע הבא שעוד לא בוצע ---- */
const remL=()=>{const a=rd(KU('lp-rem'),[]);return Array.isArray(a)?a.filter(r=>r&&r.id&&typeof r.txt==='string'):[]};
const remW=a=>wr(KU('lp-rem'),a.slice(0,100));
function nextOcc(r,after){const hm=String(r.hm||'08:00').split(':'),h=+hm[0]||0,n=+hm[1]||0,a=ilP(after);
 for(let i=0;i<400;i++){const x=tkYMD(a.y,a.m,a.d+i),t=tkIL.at(x[0],x[1],x[2],h,n);if(t<=after)continue;const dw=dowOf(x[0],x[1],x[2]);
  if(r.rp==='d'||(r.rp==='w'&&(r.wd||[]).includes(dw))||(r.rp==='m'&&x[2]===Math.min(+r.md||1,new Date(Date.UTC(x[0],x[1]+1,0)).getUTCDate())))return t}return 0}
function occ(r,from,n){const o=[];let t=r.at;if(!r.rp)return t>from?[t]:[];for(let i=0;i<n*40&&o.length<n&&t;i++){if(t>from)o.push(t);t=nextOcc(r,t)}return o}
const RPT={'':'',d:'כל יום',w:'ימים בשבוע',m:'כל חודש'};
const rpTx=r=>r.rp==='w'?'כל '+(r.wd||[]).slice().sort().map(d=>DW[d]).join(' '):r.rp==='m'?'כל חודש ב-'+r.md:RPT[r.rp||''];
/* ---- "בוצע היום" במכשיר (עובד לא טוען משימות שבוצעו) ---- */
function logDone(k,id,txt){const t0=day0(0);let o=rd(KU('lp-tk-dt'),{});if(o.d!==t0)o={d:t0,L:[]};o.L=(o.L||[]).filter(x=>!(x.k===k&&x.id===id));o.L.unshift({k,id,txt:String(txt||'').slice(0,200),t:Date.now()});o.L=o.L.slice(0,200);wr(KU('lp-tk-dt'),o)}
function doneToday(){const t0=day0(0),me=SY.uid,by=String(fbBy()||'').toLowerCase(),m={},o=rd(KU('lp-tk-dt'),{});
 if(o.d===t0)(o.L||[]).forEach(x=>{if(x.k==='t'){const t=tkGet(x.id);if(t&&t.st==='open')return}m[x.k+':'+x.id]=x});
 (TK.L||[]).forEach(t=>{if((t.st==='done'||t.st==='wait')&&t.sub>=t0&&String(t.doneBy||'').toLowerCase()===by)m['t:'+t.id]={k:'t',id:t.id,txt:t.txt,t:t.sub}});
 (PT.L||[]).forEach(p=>{if(p.st==='done'&&p.owner===me&&p.sub>=t0)m['p:'+p.id]={k:'p',id:p.id,txt:p.txt,t:p.sub}});
 return Object.values(m).sort((a,b)=>b.t-a.t)}
/* ---- "הזכר לעובד" ---- */
const ndSeen=()=>rd(KU('lp-tk-ndv'),{});
const ndNew=t=>!!(t&&t.st==='open'&&t.nd>0&&!fbAdmin()&&tkSee(t)&&(!t.ow||t.ow===SY.uid)&&ndSeen()[t.id]!==t.nd);
/* ---- סינון וחיפוש ---- */
const FLK=()=>LK('lp-tk-flt'),fl=()=>{const f=rd(FLK(),{});return{q:typeof f.q==='string'?f.q.slice(0,60):'',c:typeof f.c==='string'?f.c:''}};
const FC=[['','הכול'],['mine','שלי'],['mgr','מהמנהל'],['prv','פרטיות'],['late','באיחור'],['today','להיום'],['week','השבוע']];
function pass(x,F,now){if(F.q){const s=[x.txt,x.by,x.owN,(x.toN||[]).join(' ')].join(' ').toLowerCase();if(!s.includes(F.q.toLowerCase()))return false}
 const rem=x.k==='r',dl=rem?x.at:tkDl(x);
 switch(F.c){case'mine':return rem||(x.pv?x.owner===SY.uid:(x.ow===SY.uid||x.owner===SY.uid));case'mgr':return !rem&&!x.pv&&x.role==='a';case'prv':return rem||!!x.pv;
  case'late':return rem?x.at<now:x.pv?(x.st!=='done'&&now>dl)||x.late==='1':tkIsLate(x);case'today':return dl<day0(1);case'week':return dl<wkEnd()}return true}
W.flt=L=>{const F=fl();if(!on()||(!F.q&&!F.c))return L;const now=Date.now();return L.filter(x=>pass(x,F,now))};
W.fbar=tab=>{if(!on()||!['my','open','late','done','wait'].includes(tab))return '';const F=fl();
 return `<div class="chips" style="flex-wrap:nowrap;overflow-x:auto;margin:-4px 0 8px;padding-bottom:2px">${FC.map(c=>`<button class="chip ${F.c===c[0]?'on':''}" data-a="tkwF" data-v="${c[0]}" style="flex:none;min-height:36px;padding:0 12px">${c[1]}</button>`).join('')}</div>
 <label class="f" style="margin:0 0 10px"><input type="search" data-i="tkwQ" value="${esc(F.q)}" maxlength="60" placeholder="חיפוש במשימות…" aria-label="חיפוש במשימות" style="width:100%"></label>`};
ACT.tkwF=el=>{const F=fl();F.c=el.dataset.v||'';wr(FLK(),F);tkRe()};
let qT=0;INP.tkwQ=el=>{clearTimeout(qT);qT=setTimeout(()=>{const F=fl();F.q=String(el.value||'').slice(0,60);wr(FLK(),F);tkRe();const n=document.querySelector('input[data-i=tkwQ]');if(n){n.focus();try{n.setSelectionRange(n.value.length,n.value.length)}catch(e){}}},300)};
/* ---- פריטי "היום שלי" ---- */
function items(){const me=SY.uid,adm=fbAdmin(),out=[],now=Date.now(),sz=snzL();
 (TK.L||[]).forEach(t=>{if(t.st!=='open')return;if(adm){if(!(t.ow===me||(tkNew(t)&&!t.ow&&t.to.includes(me))))return}else{if(!tkSee(t)||(t.ow&&t.ow!==me))return}
  out.push({k:'t',id:t.id,o:t,at:tkDl(t),src:t.owner===me?'שלי':t.role==='a'?'מהמנהל':'מהצוות',nd:ndNew(t)})});
 (PT.L||[]).forEach(p=>{if(p.st!=='done'&&p.owner===me)out.push({k:'p',id:p.id,o:p,at:tkDl(p),src:'פרטית'})});
 remL().forEach(r=>out.push({k:'r',id:r.id,o:Object.assign({k:'r'},r),at:r.at||Infinity,src:'תזכורת'}));
 out.forEach(x=>{const s=sz[x.k+':'+x.id];if(s>now)x.sz=s});return out}
const grpOf=(ms,now)=>!(ms<Infinity)?'nd':ms<now?'late':ms<day0(1)?'today':ms<day0(2)?'tom':ms<wkEnd()?'week':'later';
const GR=[['mgr','תזכורת מהמנהל','var(--bad)'],['late','באיחור / הגיע הזמן','var(--bad)'],['today','היום',''],['tom','מחר',''],['week','השבוע',''],['later','בהמשך',''],['nd','בלי תאריך','']];
W.myCount=()=>{if(!on())return 0;const now=Date.now();return items().filter(x=>!x.sz&&(x.nd||x.at<day0(1))).length};
W.tabs=(adm,L,PL)=>{if(!on())return [];if(!W.d0){W.d0=1;if(!adm&&TKT==='open')TKT='my'}
 return [['my',icd('clock')+' היום שלי',W.myCount()]].concat(adm?[['team',icd('users')+' צוות',0]]:[])};
const remCard=r=>{const did=esc(r.id),sz=snzL()['r:'+r.id];
 return `<div class="card" id="rmc-${did}"><div style="white-space:pre-wrap;font-weight:700">${esc(r.txt)}</div><div style="margin:6px 0"><span class="tag t2">${icd('bell')} תזכורת</span>${r.rp?` <span class="tag t1">${icd('refresh')} ${esc(rpTx(r))}</span>`:''}${sz?` <span class="tag t1">${icd('clock')} נדחתה עד ${esc(whenTx(sz))}</span>`:''}</div>
 <p class="note" style="margin:0">${esc(whenTx(r.at))}</p><div class="row" style="flex-wrap:wrap;gap:8px;margin-top:10px"><button class="btn" data-a="tkwRDone" data-id="${did}">✓ בוצע</button><button class="btn g" data-a="tkwSnz" data-k="r" data-id="${did}">${icd('clock')} דחה</button><button class="btn g" data-a="tkwRDel" data-id="${did}" aria-label="מחק תזכורת">${icd('trash')}</button></div></div>`};
const srcTag=x=>`<span class="tag ${x.src==='מהמנהל'?'t2':'t1'}" style="opacity:.85">${x.src==='פרטית'?icd('lock'):x.src==='מהמנהל'?icd('user'):''} ${x.src}</span>`;
let inMy=null;
function myView(card){const now=Date.now(),F=fl(),all=items(),dn=doneToday(),L=all.filter(x=>pass(x.o,F,now));
 const open=all.filter(x=>!x.sz&&(x.nd||x.at<day0(1))).length,X=dn.length,Y=X+open,pc=Y?Math.round(X*100/Y):0;
 const G={};L.filter(x=>!x.sz).forEach(x=>{const g=x.nd?'mgr':grpOf(x.at,now);(G[g]=G[g]||[]).push(x)});
 const one=x=>{inMy=x;try{return x.k==='t'?card(x.o):x.k==='p'?ptCard(x.o):remCard(x.o)}finally{inMy=null}};
 let h=`<div class="card" style="padding:12px 14px"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;font-weight:700"><span>${Y?`בוצעו ${X} מתוך ${Y} היום`:'אין משימות להיום'}</span><span style="color:var(--acc)">${Y?pc+'%':''}</span></div>
  <div role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pc}" aria-label="התקדמות היום" style="height:8px;border-radius:99px;background:var(--line);margin-top:8px;overflow:hidden"><div style="width:${pc}%;height:100%;background:var(--acc);border-radius:99px"></div></div>
  <div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap"><button class="btn g" data-a="tkwRNew">${icd('bell')} תזכורת חדשה</button><button class="btn g" data-a="tkwMorn">${icd('clock')} הודעת בוקר</button></div>${LN()?'':'<p class="note" style="margin:6px 0 0">בגרסה הזו של האפליקציה אין התראות בטלפון: התזכורות מופיעות רק כאן, בתוך האפליקציה.</p>'}</div>`;
 for(const g of GR){const a=G[g[0]];if(!a||!a.length)continue;a.sort((p,q)=>((p.at-q.at)||0));h+=`<div class="mh" style="${g[2]?'color:'+g[2]:''}"><span>${g[1]}</span><span>${a.length}</span></div>`+a.map(one).join('')}
 if(!L.some(x=>!x.sz))h+=`<p class="note">${F.q||F.c?'אין תוצאות לסינון הזה.':'אין משימות פתוחות. אפשר להוסיף משימה למעלה או תזכורת אישית.'}</p>`;
 const S=L.filter(x=>x.sz).sort((p,q)=>p.sz-q.sz);
 if(S.length)h+=`<details class="card" style="padding:10px 14px"><summary style="cursor:pointer;font-weight:700">${icd('clock')} נדחו (${S.length})</summary><div style="margin-top:8px">${S.map(one).join('')}</div></details>`;
 if(dn.length)h+=`<details class="card" style="padding:10px 14px"><summary style="cursor:pointer;font-weight:700">✓ בוצע היום (${dn.length})</summary><div style="margin-top:6px">${dn.map(x=>`<p style="margin:6px 0;display:flex;gap:8px;justify-content:space-between"><span style="white-space:pre-wrap;opacity:.8">${esc(x.txt||'')}</span><small class="note" style="flex:none">${hhmm(x.t)}</small></p>`).join('')}</div></details>`;
 return h}
/* ---- לוח צוות (מנהל) ---- */
function teamView(){const S=TKST.L,L=TK.L||[],now=Date.now(),t0=day0(0),m30=now-30*864e5,p=typeof tkPend==='function'?tkPend():{w:0,c:0},q=typeof rqN==='function'?rqN():0,fr=L.filter(t=>t.st==='open'&&tkNew(t)&&!t.ow).length;
 const op=(a,v,t,n)=>`<button class="opt" data-a="${a}" ${v?`data-v="${v}"`:''}><span>${t}</span><b style="color:${n?'var(--acc)':'var(--mut)'}">${n}</b></button>`;
 let h=`<div class="card"><h3 style="margin:0 0 8px">${icd('bell')} דורש ממני</h3>${op('tkwTab','wait','משימות שממתינות לאישור',p.w)}${op('tkwTab','wait','תגובות חדשות במשימות',p.c)}${op('go','rq','בקשות חדשות מעובדים',q)}${op('tkwTab','open','משימות שאף עובד לא תפס',fr)}</div>`;
 if(!S)return h+`<p class="note">${TKST.busy||!TKST.t?'טוען רשימת עובדים…':'לא ניתן לטעון את רשימת העובדים.'}</p>`;
 const st={};S.forEach(s=>st[s.uid]={s,o:0,l:0,d:0,n30:0,ok30:0});
 const byEm={};S.forEach(s=>{if(s.em)byEm[s.em]=s.uid});
 L.forEach(t=>{if(t.st==='done'||t.st==='wait'){const u=t.ow&&st[t.ow]?t.ow:byEm[String(t.doneBy||'').toLowerCase()];const r=u&&st[u];if(!r)return;if(t.sub>=t0)r.d++;if(t.st==='done'&&t.sub>=m30){r.n30++;if(!tkIsLate(t))r.ok30++}return}
  const us=t.ow?[t.ow]:tkNew(t)?t.to:[];us.forEach(u=>{const r=st[u];if(!r)return;r.o++;if(tkLateNow(t))r.l++})});
 const rows=Object.values(st).sort((a,b)=>(b.l-a.l)||(b.o-a.o)||a.s.name.localeCompare(b.s.name,'he'));
 const k=(lb,v,c)=>`<div style="flex:1;min-width:60px;text-align:center"><b style="display:block;font-size:1.1rem;${c?'color:'+c:''}">${v}</b><small class="note">${lb}</small></div>`;
 h+=`<div class="mh"><span>העובדים</span><span>${rows.length}</span></div>`+(rows.length?rows.map(r=>`<div class="card" style="padding:10px 12px"><div style="font-weight:700;margin-bottom:6px">${esc(r.s.name)}</div><div style="display:flex;gap:4px;flex-wrap:wrap">${k('פתוחות',r.o)}${k('באיחור',r.l,r.l?'var(--bad)':'')}${k('בוצעו היום',r.d,r.d?'var(--inc)':'')}${k('בזמן (30 יום)',r.n30?Math.round(r.ok30*100/r.n30)+'%':'–')}</div></div>`).join(''):'<p class="note">אין עובדים פעילים.</p>');
 return h+'<p class="note">מחושב מהמשימות שנטענו במכשיר. "בזמן" – מתוך המשימות שבוצעו ב-30 הימים האחרונים.</p>'}
ACT.tkwTab=el=>{TKT=el.dataset.v||'open';rerender()};
W.view=(tab,card)=>{if(!on())return '';return tab==='team'?(fbAdmin()?teamView():''):myView(card)};
/* ---- תגיות ופעולות בכרטיס משימה ---- */
W.tag=t=>{if(!on())return '';let s=inMy&&inMy.k==='t'?srcTag(inMy)+' ':'';
 if(t.nd>0&&t.st==='open'){if(fbAdmin())s+=`<span class="tag t2">${icd('bell')} נשלחה תזכורת · ${hhmm(t.nd)}</span> `;else if(ndNew(t))s+=`<span class="tag t4">${icd('bell')} תזכורת מהמנהל · ${hhmm(t.nd)}</span> `}return s};
W.act=t=>{if(!on()||t.st!=='open')return '';const did=esc(t.id);
 if(fbAdmin())return tkNew(t)?`<button class="btn g" data-a="tkwNd" data-id="${did}">${icd('bell')} הזכר לעובד</button>`:'';
 return ndNew(t)?`<button class="btn g" data-a="tkwNdSeen" data-id="${did}">ראיתי את התזכורת</button>`:''};
W.ptTag=p=>{if(!on())return '';const s=inMy?srcTag(inMy)+' ':'',z=p.st!=='done'&&snzL()['p:'+p.id];return s+(z?`<span class="tag t1">${icd('clock')} נדחתה עד ${esc(whenTx(z))}</span>`:'')};
W.ptAct=p=>on()&&p.st!=='done'&&p.owner===SY.uid?`<button class="btn g" data-a="tkwSnz" data-k="p" data-id="${esc(p.id)}">${icd('clock')} דחה</button>`:'';
ACT.tkwNd=el=>{const t=tkGet(el.dataset.id);if(!t||!fbAdmin())return;const ago=Date.now()-(t.nd||0);
 if(t.nd&&ago<ND_GAP)return toast('כבר נשלחה תזכורת לפני '+Math.max(1,Math.round(ago/MIN))+' דקות. אפשר שוב בעוד '+Math.ceil((ND_GAP-ago)/MIN)+' דקות');
 ask('לשלוח לעובד תזכורת על המשימה? היא תופיע לו בראש "היום שלי" כשיפתח את האפליקציה',()=>tkDo(()=>tkPatch(t.id,{nd:Date.now(),ndN:String(fbBy()||'מנהל').slice(0,60)}),'✓ התזכורת תופיע לעובד באפליקציה'),'שלח תזכורת')};
const ndMark=ids=>{const m=ndSeen();ids.forEach(id=>{const t=tkGet(id);if(t&&t.nd)m[id]=t.nd});wr(KU('lp-tk-ndv'),m)};
ACT.tkwNdSeen=el=>{ndMark([el.dataset.id]);tkRe()};
/* ---- דחייה ---- */
const snzOpts=()=>[['h','עוד שעה',Date.now()+H],['t','מחר ב-08:00',atDay(1,8,0)],['w','שבוע הבא (ראשון 08:00)',(()=>{const t=tkIL.today();return atDay(7-dowOf(t[0],t[1],t[2]),8,0)})()]];
ACT.tkwSnz=el=>{const k=el.dataset.k,id=el.dataset.id,cur0=snzL()[k+':'+id];
 dlg(`<h3>${icd('clock')} לדחות עד מתי?</h3><p class="note">הדחייה נשמרת רק במכשיר הזה. היעד של המשימה לא משתנה.</p><div style="display:grid;gap:8px">${snzOpts().map(o=>`<button class="btn g" data-a="tkwSnzGo" data-k="${esc(k)}" data-id="${esc(id)}" data-v="${o[0]}">${o[1]}<small style="display:block;opacity:.7">${esc(whenTx(o[2]))}</small></button>`).join('')}${cur0?`<button class="btn r" data-a="tkwSnzGo" data-k="${esc(k)}" data-id="${esc(id)}" data-v="x">בטל דחייה</button>`:''}<button class="btn g" data-a="closeDlg">ביטול</button></div>`)};
ACT.tkwSnzGo=el=>{const k=el.dataset.k,id=el.dataset.id,v=el.dataset.v,o=snzOpts().find(x=>x[0]===v);closeDlg();if(!['p','r'].includes(k))return;
 snzSet(k+':'+id,o?o[2]:0);W.sched();tkRe();toast(o?'נדחה עד '+whenTx(o[2]):'הדחייה בוטלה')};
/* ---- תזכורות: טופס בחלון (כדי שרענון הרשימה לא ימחק מה שהוקלד) ---- */
const ymd=ms=>{const p=ilP(ms);return p.y+'-'+p2(p.m+1)+'-'+p2(p.d)};
ACT.tkwRNew=()=>{const t=Date.now()+H,r5=t-(t%(5*MIN))+5*MIN;
 dlg(`<h3>${icd('bell')} תזכורת חדשה</h3><form data-f="tkwRem"><label class="f"><span>על מה להזכיר?</span><input name="txt" maxlength="200" required autocomplete="off"></label>
 <div class="chips" style="margin:4px 0 8px"><button type="button" class="chip" data-a="tkwRQ" data-v="h">בעוד שעה</button><button type="button" class="chip" data-a="tkwRQ" data-v="e">היום 18:00</button><button type="button" class="chip" data-a="tkwRQ" data-v="t">מחר 08:00</button></div>
 <div class="row" style="gap:8px"><label class="f grow"><span>תאריך</span><input type="date" name="d" value="${ymd(r5)}" required></label><label class="f grow"><span>שעה</span><input type="time" name="tm" value="${hhmm(r5)}" required></label></div>
 <label class="f"><span>חזרה</span><select name="rp" data-c="tkwRp"><option value="">בלי חזרה</option><option value="d">כל יום</option><option value="w">ימים מסוימים בשבוע</option><option value="m">כל חודש (באותו תאריך)</option></select></label>
 <div id="tkwWd" hidden class="chips" style="margin:0 0 8px">${DW.map((d,i)=>`<label class="chip" style="min-height:36px;padding:0 10px"><input type="checkbox" name="wd${i}" value="1"> ${d}</label>`).join('')}</div>
 ${LN()?'<p class="note">תופיע גם התראה בטלפון בזמן שנבחר (בפעם הראשונה הטלפון יבקש אישור להתראות).</p>':'<p class="note">בגרסה הזו של האפליקציה אין התראות בטלפון – התזכורת תופיע בתוך האפליקציה בלבד.</p>'}
 <div class="row"><button class="btn grow">שמור תזכורת</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`);
 setTimeout(()=>{const i=document.querySelector('#dlg input[name=txt]');if(i)i.focus()},50)};
CHG.tkwRp=el=>{const w=document.getElementById('tkwWd');if(w)w.hidden=el.value!=='w'};
ACT.tkwRQ=el=>{const f=el.closest('form');if(!f)return;const v=el.dataset.v,t=v==='h'?Date.now()+H:v==='e'?atDay(0,18,0):atDay(1,8,0);f.elements.d.value=ymd(t);f.elements.tm.value=hhmm(t);f.querySelectorAll('[data-a=tkwRQ]').forEach(c=>c.classList.toggle('on',c===el))};
FRM.tkwRem=async f=>{const x=fd(f),txt=String(x.txt||'').trim().slice(0,200);if(!txt)return toast('כתוב על מה להזכיר');
 const dm=/^(\d{4})-(\d{2})-(\d{2})$/.exec(x.d||''),tm=/^(\d{1,2}):(\d{2})/.exec(x.tm||'');if(!dm||!tm)return toast('בחר תאריך ושעה');
 const rp=['d','w','m'].includes(x.rp)?x.rp:'',hm=p2(+tm[1])+':'+tm[2];let at=tkIL.at(+dm[1],+dm[2]-1,+dm[3],+tm[1],+tm[2]);
 const r={id:'r'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),txt,at,rp,hm,nid:1+Math.floor(Math.random()*499999)};
 if(rp==='w'){r.wd=DW.map((d,i)=>x['wd'+i]?i:-1).filter(i=>i>=0);if(!r.wd.length)r.wd=[dowOf(+dm[1],+dm[2]-1,+dm[3])]}
 if(rp==='m')r.md=+dm[3];
 if(rp){r.at=nextOcc(r,at-1);if(r.at<=Date.now())r.at=nextOcc(r,Date.now())}else if(at<Date.now()-MIN)return toast('הזמן שנבחר כבר עבר');
 if(!r.at)return toast('לא נמצא מועד מתאים לחזרה');
 const a=remL();if(a.length>=100)return toast('אפשר לשמור עד 100 תזכורות');a.push(r);remW(a);closeDlg();
 toast('✓ התזכורת נשמרה: '+whenTx(r.at));if(LN())await lnPerm(true);W.sched();tkRe()};
function remDone(id){const a=remL(),r=a.find(z=>z.id===id);if(!r)return;logDone('r',r.id,r.txt);snzSet('r:'+id,0);
 if(r.rp){r.at=nextOcc(r,Math.max(Date.now(),r.at));remW(a);toast('✓ בוצע. הפעם הבאה: '+whenTx(r.at))}else{remW(a.filter(z=>z.id!==id));toast('✓ בוצע')}W.sched();tkRe()}
ACT.tkwRDone=el=>remDone(el.dataset.id);
ACT.tkwRDel=el=>{const id=el.dataset.id;ask('למחוק את התזכורת?',()=>{remW(remL().filter(z=>z.id!==id));snzSet('r:'+id,0);W.sched();tkRe();toast('התזכורת נמחקה')},'מחק')};
/* ---- הודעת בוקר ---- */
const mnCfg=()=>{const c=rd(KU('lp-tk-mn'),{});return{on:!!c.on,hm:/^\d{2}:\d{2}$/.test(c.hm||'')?c.hm:'07:30'}};
ACT.tkwMorn=()=>{const c=mnCfg();dlg(`<h3>${icd('clock')} הודעת בוקר</h3><form data-f="tkwMorn"><p class="note">כל בוקר בשעה שתבחר: כמה משימות יש להיום, כמה באיחור וכמה תזכורות. מחושב מהעדכון האחרון במכשיר.</p>
 <label class="cb"><input type="checkbox" name="on" value="1" ${c.on?'checked':''}> להפעיל הודעת בוקר</label><label class="f"><span>שעה</span><input type="time" name="hm" value="${c.hm}" required></label>
 ${LN()?'':'<p class="note" style="color:var(--bad)">בגרסה הזו של האפליקציה אין התראות בטלפון. ההגדרה תפעל אחרי עדכון האפליקציה.</p>'}
 <div class="row"><button class="btn grow">שמור</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`)};
FRM.tkwMorn=async f=>{const x=fd(f),m=/^(\d{1,2}):(\d{2})/.exec(x.hm||'');if(!m)return toast('בחר שעה');wr(KU('lp-tk-mn'),{on:!!x.on,hm:p2(+m[1])+':'+m[2]});closeDlg();
 toast(x.on?'✓ הודעת בוקר הופעלה':'הודעת הבוקר כבויה');if(x.on&&LN())await lnPerm(true);W.sched()};
function mornTxt(){const now=Date.now(),a=items().filter(x=>!x.sz),l=a.filter(x=>x.k!=='r'&&x.at<now).length,t=a.filter(x=>x.k!=='r'&&x.at>=now&&x.at<day0(2)).length,r=a.filter(x=>x.k==='r'&&x.at<day0(2)).length;
 return 'לפי העדכון האחרון: '+[t+' משימות פתוחות להיום ולמחר',l?l+' באיחור':'',r?r+' תזכורות':''].filter(Boolean).join(', ')}
/* ---- התראות מקומיות ---- */
function LN(){try{const C=window.Capacitor;return C&&typeof C.isPluginAvailable==='function'&&C.isPluginAvailable('LocalNotifications')&&C.Plugins&&C.Plugins.LocalNotifications||null}catch(e){return null}}
let lnI=0,lnQ=null;
async function lnSetup(){const P=LN();if(!P)return null;if(lnI)return P;lnI=1;
 try{await P.registerActionTypes({types:[{id:'lpwc',actions:[{id:'h1',title:'בעוד שעה'},{id:'done',title:'✓ בוצע'}]}]})}catch(e){}
 try{await P.addListener('localNotificationActionPerformed',a=>{lnQ=a;setTimeout(lnAct,300)})}catch(e){}return P}
async function lnPerm(askIt){const P=LN();if(!P)return false;try{let p=await P.checkPermissions();if(p&&p.display!=='granted'&&askIt)p=await P.requestPermissions();return !!(p&&p.display==='granted')}catch(e){return false}}
function lnAct(){const a=lnQ;if(!a)return;if(!on()){return}lnQ=null;const n=a.notification||{},ex=n.extra||{};if(ex.lp!=='wc')return;
 if(ex.u!==SY.uid||ex.b!==LK(''))return;
 if(a.actionId==='h1'&&(ex.k==='r'||ex.k==='p')){snzSet(ex.k+':'+ex.id,Date.now()+H);W.sched();tkRe();return toast('נדחה לעוד שעה')}
 if(a.actionId==='done'&&ex.k==='r')return remDone(ex.id);
 if(a.actionId==='done'&&ex.k==='p'&&typeof ptGet==='function'&&ptGet(ex.id))return ACT.ptDone({dataset:{id:ex.id}});
 TKT='my';W.d0=1;if(cur().v!=='tk')go('tk');else rerender()}
const nt=(id,title,body,at,ex)=>({id,title,body:String(body||'').slice(0,180),schedule:{at:new Date(at),allowWhileIdle:true},smallIcon:'ic_stat_notify',actionTypeId:ex.k==='m'?undefined:'lpwc',extra:Object.assign({lp:'wc',b:LK(''),u:SY.uid},ex)});
const hid=s=>{let h=0;for(const c of String(s))h=(h*31+c.charCodeAt(0))|0;return 5000000+Math.abs(h)%1000000};
let sT=0;W.sched=()=>{clearTimeout(sT);sT=setTimeout(()=>{schedNow().catch(()=>{})},1200)};
async function schedNow(){if(!LN()||!SY.uid)return;const P=await lnSetup();if(!P||!(await lnPerm(false)))return;const b=LK(''),u=SY.uid;
 let pend=[];try{pend=((await P.getPending())||{}).notifications||[]}catch(e){}
 const old=pend.filter(n=>n&&n.extra&&n.extra.lp==='wc'&&n.extra.b===b&&n.extra.u===u).map(n=>({id:n.id}));if(old.length)try{await P.cancel({notifications:old})}catch(e){}
 if(!on())return;const now=Date.now(),L=[],sz=snzL();
 remL().forEach(r=>{let ts=occ(r,now,4);const s=sz['r:'+r.id];if(s>now)ts=[s].concat(ts.filter(x=>x>s&&x!==r.at)).slice(0,4);/* הדחייה מחליפה את המופע הנוכחי */ts.forEach((at,i)=>L.push(nt(r.nid*8+i,'תזכורת',r.txt,at,{k:'r',id:r.id})))});
 (PT.L||[]).forEach(p=>{const s=sz['p:'+p.id];if(p.st!=='done'&&p.owner===u&&s>now)L.push(nt(hid(p.id),'משימה שנדחתה חזרה',p.txt,s,{k:'p',id:p.id}))});
 const m=mnCfg();if(m.on){const at=nextOcc({rp:'d',hm:m.hm},now);if(at)L.push(nt(MID,'בוקר טוב',mornTxt(),at,{k:'m'}))}
 if(L.length)try{await P.schedule({notifications:L.slice(0,64)})}catch(e){}}
/* ---- התראה בתוך האפליקציה: תזכורת מהמנהל, ותזכורות שהגיע זמנן כשאין התראות בטלפון ---- */
const SHN=new Set();
function wcAlert(){if(!on()||fbAdmin())return;const d=$('#dlg');if(d&&d.open)return;const now=Date.now();
 const nd=tkVis().filter(t=>ndNew(t)&&!SHN.has(t.id+':'+t.nd)),rm=LN()?[]:remL().filter(r=>r.at<=now&&!SHN.has('r'+r.id+':'+r.at)&&!(snzL()['r:'+r.id]>now));
 if(!nd.length&&!rm.length)return;nd.forEach(t=>SHN.add(t.id+':'+t.nd));rm.forEach(r=>SHN.add('r'+r.id+':'+r.at));W.al=nd.map(t=>t.id);
 dlg(`<h3>${icd('bell')} ${nd.length?'תזכורת מהמנהל':'תזכורת'}</h3><div style="max-height:55vh;overflow:auto">${nd.map(t=>`<div class="card" style="margin:0 0 8px;padding:8px 10px"><div style="font-weight:700;white-space:pre-wrap;max-height:3em;overflow:hidden">${esc(t.txt)}</div><p class="note" style="margin:2px 0 0">${esc(t.ndN||'המנהל')} · ${hhmm(t.nd)}</p></div>`).join('')}${rm.map(r=>`<div class="card" style="margin:0 0 8px;padding:8px 10px"><div style="font-weight:700;white-space:pre-wrap">${esc(r.txt)}</div><p class="note" style="margin:2px 0 0">${esc(whenTx(r.at))}</p></div>`).join('')}</div>
 <div class="row" style="margin-top:8px"><button class="btn grow" data-a="tkwAlGo">לצפייה</button><button class="btn g grow" data-a="tkwAlOk">${nd.length?'ראיתי':'סגור'}</button></div>`)}
ACT.tkwAlOk=()=>{ndMark(W.al||[]);closeDlg();tkRe()};
ACT.tkwAlGo=()=>{ndMark(W.al||[]);closeDlg();TKT='my';W.d0=1;if(cur().v!=='tk')go('tk');else rerender()};
/* ---- תבניות משימה (מנהל, במכשיר) ---- */
const TPK=()=>LK('lp-tk-tpl'),tplL=()=>{const a=rd(TPK(),[]);return Array.isArray(a)?a.filter(x=>x&&typeof x.txt==='string').slice(0,20):[]};
W.tplBar=()=>{if(!on()||!fbAdmin())return '';const a=tplL();
 return `<details style="margin:2px 0 8px"><summary style="cursor:pointer;color:var(--acc);font-weight:600">${icd('doc')} תבניות${a.length?' ('+a.length+')':''}</summary><div style="margin-top:6px">${a.map((t,i)=>`<div style="border:1px solid var(--line);border-radius:10px;padding:8px;margin:0 0 6px"><div style="white-space:pre-wrap;max-height:3em;overflow:hidden;font-weight:600">${esc(t.txt)}</div><small class="note">${t.to&&t.to.length?esc(tplNames(t)):'כל העובדים'}${t.np?' · '+t.np+' תמונות':''}</small><div class="row" style="gap:6px;flex-wrap:wrap;margin-top:6px"><button type="button" class="btn g" data-a="tkwTplFill" data-i="${i}">מלא טופס</button><button type="button" class="btn" data-a="tkwTplSend" data-i="${i}">שלח מתבנית</button><button type="button" class="btn g" data-a="tkwTplDel" data-i="${i}" aria-label="מחק תבנית">${icd('trash')}</button></div></div>`).join('')||'<p class="note" style="margin:0 0 6px">אין עדיין תבניות.</p>'}<button type="button" class="btn g" data-a="tkwTplSave">שמור את הטופס כתבנית</button><p class="note" style="margin:4px 0 0">התבניות נשמרות רק במכשיר הזה.</p></div></details>`};
const tplNames=t=>{const S=TKST.L||[];return (t.to||[]).map(u=>{const s=S.find(z=>z.uid===u);return s?s.name:null}).filter(Boolean).join(', ')||'עובדים שאינם פעילים'};
const tkForm=()=>document.querySelector('form[data-f=tkAdd]');
ACT.tkwTplSave=()=>{const f=tkForm();if(!f)return;const txt=String(f.elements.txt.value||'').trim().slice(0,500);if(!txt)return toast('כתוב קודם את המשימה בטופס');
 if(f.elements.prv&&f.elements.prv.checked)return toast('תבנית נשמרת רק למשימה לעובדים, לא למשימה פרטית');
 const S=TKST.L,sel=S&&S.length?tkSelInit():null,all=!S||!S.length||sel.size===S.length,a=tplL();if(a.length>=20)return toast('אפשר לשמור עד 20 תבניות. מחק תבנית ישנה');
 a.unshift({txt,to:all?[]:[...sel],np:+TKN.np||0});wr(TPK(),a.slice(0,20));toast('✓ התבנית נשמרה');tkRe()};
function tplFill(i){const t=tplL()[i],f=tkForm();if(!t||!f)return null;if(f.elements.prv&&f.elements.prv.checked){f.elements.prv.checked=false;tkPrvSync()}
 const S=TKST.L||[],act=(t.to||[]).filter(u=>S.some(z=>z.uid===u));
 f.elements.txt.value=t.txt;TKN.np=Math.min(3,Math.max(0,+t.np||0));TKN.sel=S.length?new Set(t.to&&t.to.length?act:S.map(z=>z.uid)):null;tkRe();return{t,miss:t.to&&t.to.length&&!act.length}}
ACT.tkwTplFill=el=>{const r=tplFill(+el.dataset.i);if(!r)return;if(r.miss)toast('העובדים שבתבנית אינם פעילים – בחר נמענים');const n=tkForm();if(n){n.scrollIntoView({block:'start'});n.elements.txt.focus()}};
ACT.tkwTplSend=el=>{const i=+el.dataset.i,t=tplL()[i];if(!t)return;
 ask('לשלוח את המשימה "'+t.txt.slice(0,60)+(t.txt.length>60?'…':'')+'" ל'+(t.to&&t.to.length?tplNames(t):'כל העובדים')+'?',()=>{const r=tplFill(i),f=tkForm();if(!r||!f)return;if(r.miss)return toast('העובדים שבתבנית אינם פעילים – בחר נמענים ושלח מהטופס');FRM.tkAdd(f)},'שלח')};
ACT.tkwTplDel=el=>{const i=+el.dataset.i;ask('למחוק את התבנית?',()=>{const a=tplL();a.splice(i,1);wr(TPK(),a);tkRe()},'מחק')};
/* ---- חיבור לקוד הקיים ---- */
{const o=tkPatch;tkPatch=async function(id,ob){const r=await o.apply(this,arguments);try{if(ob&&ob.doneBy&&(ob.st==='done'||ob.st==='wait')&&ob.doneBy===fbBy()){const t=tkGet(id);logDone('t',id,t?t.txt:'')}}catch(e){}return r}}
{const o=tkLoad;tkLoad=async function(){const r=await o.apply(this,arguments);try{W.sched();if(lnQ)lnAct()}catch(e){}return r}}
{const o=tkAlert;tkAlert=async function(){await o.apply(this,arguments);try{wcAlert()}catch(e){}}}
['tkGoIt','tkGoAl','tkGoWait'].forEach(k=>{const o=ACT[k];if(o)ACT[k]=function(){W.d0=1;return o.apply(this,arguments)}});
setTimeout(()=>{try{if(on()){W.sched();wcAlert()}}catch(e){}},6000);
setTimeout(()=>{try{if(LN())lnSetup()}catch(e){}},500);
window.TKW=W;
})();
