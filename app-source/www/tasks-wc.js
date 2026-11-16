/* מרכז עבודה – סבב 1 (מסך המשימות): לשונית "היום שלי", לוח צוות למנהל ו"דורש ממני", תזכורות אישיות במכשיר עם התראות מקומיות,
   "דחה" במכשיר (היעד האמיתי לא משתנה), סינון וחיפוש (בזיכרון, נשמר במכשיר), תבניות משימה למנהל (במכשיר), "הזכר לעובד" (nd/ndN).
   הכול מאחורי bzF('tasks'). נטען אחרי index.html; ה-hooks שם בודקים window.TKW, כך שבלי הקובץ הזה המסך נשאר כמו קודם.
   אין כאן קריאות fsx: כתיבה לשרת רק דרך tkPatch / FRM.tkAdd / ACT.ptDone הקיימים.
   נשמר במכשיר (לכל עסק ומשתמש): lp-rem-<uid> תזכורות, lp-snz-<uid> דחיות, lp-tk-dt-<uid> "בוצע היום", lp-tk-ndv-<uid> "ראיתי" לתזכורת מנהל,
   lp-tk-mn-<uid> הודעת בוקר; lp-tk-flt סינון, lp-tk-tpl תבניות מנהל.
   התראות: @capacitor/local-notifications, רק אם התוסף קיים (APK ישן / דפדפן – הכול בתוך האפליקציה בלבד).
   סבב 2: שדות חדשים במשימה ובמשימה פרטית – dl (יעד בפועל), pri, cat, est, ck/ckd (רשימת סימון), sa ("התחלתי").
   מוצגים לעריכה רק כשהכללים החדשים פורסמו: גלאי rv/tk2 (tkRv ב-index.html) – נשמר במכשיר לכל עסק ל-6 שעות (lp-tk-rv), ומתרענן ב"רענן".
   סבב 3: בקשות למנהל – סוג פנייה (k), תגיות שלב (ph), "בטיפול", "הפוך למשימה" (tk) – רק כשהגלאי מצא כללים חדשים; "הזכר לעובד" קורא גם ל-tkNudge
   בשרת (התראת טלפון; כל כשל נבלע); יצירת משימה מתוך "היום שלי" נשארת ב"היום שלי"; items() נשמר לאורך ציור אחד.
   ביציאה מהחשבון (syOut ← W.out): מבטלים את ההתראות המקומיות ומוחקים מהמכשיר את התזכורות, הדחיות, התבניות והסינון. */
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
const FLK=()=>LK('lp-tk-flt'),fl=()=>{const f=rd(FLK(),{});return{q:typeof f.q==='string'?f.q.slice(0,60):'',c:typeof f.c==='string'?f.c:'',t:typeof f.t==='string'?f.t.slice(0,30):''}};
const FC=[['','הכול'],['mine','שלי'],['mgr','מהמנהל'],['urg','דחוף'],['prv','פרטיות'],['late','באיחור'],['today','להיום'],['week','השבוע']];
function pass(x,F,now){if(F.q){const s=[x.txt,x.by,x.owN,x.cat,(x.toN||[]).join(' ')].join(' ').toLowerCase();if(!s.includes(F.q.toLowerCase()))return false}
 if(F.t&&(x.k==='r'||(x.cat||'')!==F.t))return false;
 const rem=x.k==='r',dl=rem?x.at:tkDl(x);
 switch(F.c){case'mine':return rem||(x.pv?x.owner===SY.uid:(x.ow===SY.uid||x.owner===SY.uid));case'mgr':return !rem&&!x.pv&&x.role==='a';case'prv':return rem||!!x.pv;case'urg':return !rem&&x.pri==='h';
  case'late':return rem?x.at<now:x.pv?(x.st!=='done'&&now>dl)||x.late==='1':tkIsLate(x);case'today':return dl<day0(1);case'week':return dl<wkEnd()}return true}
W.flt=L=>{const F=fl();if(!on()||(!F.q&&!F.c&&!F.t))return L;const now=Date.now();return L.filter(x=>pass(x,F,now))};
W.fbar=tab=>{if(!on()||!['my','open','late','done','wait'].includes(tab))return '';const F=fl();
 return `<div class="chips" style="flex-wrap:nowrap;overflow-x:auto;margin:-4px 0 8px;padding-bottom:2px">${FC.map(c=>`<button class="chip ${F.c===c[0]?'on':''}" data-a="tkwF" data-v="${c[0]}" style="flex:none;min-height:36px;padding:0 12px">${c[1]}</button>`).join('')}</div>
 ${(()=>{const C=cats();if(F.t&&!C.includes(F.t))C.unshift(F.t);return C.length?`<label class="f" style="margin:0 0 8px"><span>נושא</span><select data-c="tkwT" aria-label="סינון לפי נושא"><option value="">כל הנושאים</option>${C.map(c=>`<option value="${esc(c)}" ${c===F.t?'selected':''}>${esc(c)}</option>`).join('')}</select></label>`:''})()}
 <label class="f" style="margin:0 0 10px"><input type="search" data-i="tkwQ" value="${esc(F.q)}" maxlength="60" placeholder="חיפוש במשימות…" aria-label="חיפוש במשימות" style="width:100%"></label>`};
CHG.tkwT=el=>{const F=fl();F.t=String(el.value||'').slice(0,30);wr(FLK(),F);tkRe()};
ACT.tkwF=el=>{const F=fl();F.c=el.dataset.v||'';wr(FLK(),F);tkRe()};
let qT=0;INP.tkwQ=el=>{clearTimeout(qT);qT=setTimeout(()=>{const F=fl();F.q=String(el.value||'').slice(0,60);wr(FLK(),F);tkRe();const n=document.querySelector('input[data-i=tkwQ]');if(n){n.focus();try{n.setSelectionRange(n.value.length,n.value.length)}catch(e){}}},300)};
/* ---- פריטי "היום שלי" ---- */
/* סבב 3 (ביצועים): בציור אחד items() נקרא כמה פעמים (מונה הלשונית, "היום שלי", הודעת בוקר) – התוצאה נשמרת עד סוף הציור הנוכחי בלבד
   (מתאפסת ב-microtask), ורק אם הרשימות והמפתחות במכשיר לא השתנו */
let IC=null;const icKey=()=>[SY.uid,localStorage.getItem(KU('lp-rem')),localStorage.getItem(KU('lp-snz')),localStorage.getItem(KU('lp-tk-ndv'))].join('\u0001');
function items(){const k=icKey();if(IC&&IC.T===TK.L&&IC.P===PT.L&&IC.k===k)return IC.v;const v=items0();IC={T:TK.L,P:PT.L,k,v};Promise.resolve().then(()=>{IC=null});return v}
function items0(){const me=SY.uid,adm=fbAdmin(),out=[],now=Date.now(),sz=snzL();
 (TK.L||[]).forEach(t=>{if(t.st!=='open')return;if(adm){if(!(t.ow===me||(tkNew(t)&&!t.ow&&t.to.includes(me))))return}else{if(!tkSee(t)||(t.ow&&t.ow!==me))return}
  out.push({k:'t',id:t.id,o:t,at:tkDl(t),src:t.owner===me?'שלי':t.role==='a'?'מהמנהל':'מהצוות',nd:ndNew(t)})});
 (PT.L||[]).forEach(p=>{if(p.st!=='done'&&p.owner===me)out.push({k:'p',id:p.id,o:p,at:tkDl(p),src:'פרטית'})});
 remL().forEach(r=>out.push({k:'r',id:r.id,o:Object.assign({k:'r'},r),at:r.at||Infinity,src:'תזכורת'}));
 out.forEach(x=>{const s=sz[x.k+':'+x.id];if(s>now)x.sz=s});return out}
const grpOf=(ms,now)=>!(ms<Infinity)?'nd':ms<now?'late':ms<day0(1)?'today':ms<day0(2)?'tom':ms<wkEnd()?'week':'later';
const GR=[['mgr','תזכורת מהמנהל','var(--bad)'],['late','באיחור / הגיע הזמן','var(--bad)'],['today','היום',''],['tom','מחר',''],['week','השבוע',''],['later','בהמשך',''],['nd','בלי תאריך','']];
W.myCount=()=>{if(!on())return 0;const now=Date.now();return items().filter(x=>!x.sz&&(x.nd||x.at<day0(1))).length};
W.tabs=(adm,L,PL)=>{if(!on())return [];W.rvChk(0);if(!W.d0){W.d0=1;if(!adm&&TKT==='open')TKT='my'}
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
 const st={};S.forEach(s=>st[s.uid]={s,o:0,l:0,d:0,n30:0,ok30:0,w:0});
 const byEm={};S.forEach(s=>{if(s.em)byEm[s.em]=s.uid});
 L.forEach(t=>{if(t.st==='done'||t.st==='wait'){const u=t.ow&&st[t.ow]?t.ow:byEm[String(t.doneBy||'').toLowerCase()];const r=u&&st[u];if(!r)return;if(t.sub>=t0)r.d++;if(t.st==='done'&&t.sub>=m30){r.n30++;if(!tkIsLate(t))r.ok30++}return}
  const us=t.ow?[t.ow]:tkNew(t)?t.to:[];us.forEach(u=>{const r=st[u];if(!r)return;r.o++;if(tkLateNow(t))r.l++;if(t.sa>0&&t.st==='open'&&t.ow===u)r.w++})});
 const rows=Object.values(st).sort((a,b)=>(b.l-a.l)||(b.o-a.o)||a.s.name.localeCompare(b.s.name,'he'));
 const k=(lb,v,c)=>`<div style="flex:1;min-width:60px;text-align:center"><b style="display:block;font-size:1.1rem;${c?'color:'+c:''}">${v}</b><small class="note">${lb}</small></div>`;
 h+=`<div class="mh"><span>העובדים</span><span>${rows.length}</span></div>`+(rows.length?rows.map(r=>`<div class="card" style="padding:10px 12px"><div style="font-weight:700;margin-bottom:6px">${esc(r.s.name)}</div><div style="display:flex;gap:4px;flex-wrap:wrap">${k('פתוחות',r.o)}${k('באיחור',r.l,r.l?'var(--bad)':'')}${k('בוצעו היום',r.d,r.d?'var(--inc)':'')}${k('בזמן (30 יום)',r.n30?Math.round(r.ok30*100/r.n30)+'%':'–')}${k('בעבודה',r.w,r.w?'var(--acc)':'')}</div></div>`).join(''):'<p class="note">אין עובדים פעילים.</p>');
 return h+'<p class="note">מחושב מהמשימות שנטענו במכשיר. "בזמן" – מתוך המשימות שבוצעו ב-30 הימים האחרונים.</p>'}
ACT.tkwTab=el=>{TKT=el.dataset.v||'open';rerender()};
W.view=(tab,card)=>{if(!on())return '';return tab==='team'?(fbAdmin()?teamView():''):myView(card)};
/* ---- תגיות ופעולות בכרטיס משימה ---- */
W.tag=t=>{if(!on())return '';let s=(inMy&&inMy.k==='t'?srcTag(inMy)+' ':'')+xTags(t);
 if(t.sa>0&&t.st==='open')s+=`<span class="tag t3">${icd('clock')} ${t.ow===SY.uid?'התחלתי ב-':'בעבודה אצל '+esc(t.owN||'עובד')+' מ-'}${hhmm(t.sa)}</span> `;
 if(t.nd>0&&t.st==='open'){if(fbAdmin())s+=`<span class="tag t2">${icd('bell')} נשלחה תזכורת · ${hhmm(t.nd)}</span> `;else if(ndNew(t))s+=`<span class="tag t4">${icd('bell')} תזכורת מהמנהל · ${hhmm(t.nd)}</span> `}return s};
W.act=t=>{if(!on()||t.st!=='open')return '';const did=esc(t.id),sa=rvNew()&&t.ow===SY.uid&&!(t.sa>0)?`<button class="btn g" data-a="tkwSa" data-id="${did}">▶ התחלתי</button>`:'';
 if(fbAdmin())return sa+(tkNew(t)?`<button class="btn g" data-a="tkwNd" data-id="${did}">${icd('bell')} הזכר לעובד</button>`:'');
 return sa+(ndNew(t)?`<button class="btn g" data-a="tkwNdSeen" data-id="${did}">ראיתי את התזכורת</button>`:'')};
W.ptTag=p=>{if(!on())return '';const s=(inMy?srcTag(inMy)+' ':'')+xTags(p)+(p.st!=='done'&&p.dl>=0?`<span class="tag t1">${icd('clock')} ${p.dl>0?'יעד: '+esc(whenTx(p.dl)):'בלי יעד'}</span> `:''),z=p.st!=='done'&&snzL()['p:'+p.id];return s+(z?`<span class="tag t1">${icd('clock')} נדחתה עד ${esc(whenTx(z))}</span>`:'')};
W.ptAct=p=>on()&&p.st!=='done'&&p.owner===SY.uid?`<button class="btn g" data-a="tkwSnz" data-k="p" data-id="${esc(p.id)}">${icd('clock')} דחה</button>`:'';
ACT.tkwNd=el=>{const t=tkGet(el.dataset.id);if(!t||!fbAdmin())return;const ago=Date.now()-(t.nd||0);
 if(t.nd&&ago<ND_GAP)return toast('כבר נשלחה תזכורת לפני '+Math.max(1,Math.round(ago/MIN))+' דקות. אפשר שוב בעוד '+Math.ceil((ND_GAP-ago)/MIN)+' דקות');
 ask('לשלוח לעובד תזכורת על המשימה? היא תופיע לו בראש "היום שלי" כשיפתח את האפליקציה',()=>tkDo(async()=>{await tkPatch(t.id,{nd:Date.now(),ndN:String(fbBy()||'מנהל').slice(0,60)});nudge(t.id)},'✓ התזכורת תופיע לעובד באפליקציה'),'שלח תזכורת')};
/* סבב 3 – שכבה ב': התראת טלפון מהשרת (tkNudge). כל כשל נבלע – התזכורת עדיין מופיעה לעובד באפליקציה */
const nudge=id=>{try{if(typeof fnCall!=='function')return;Promise.resolve(fnCall('tkNudge',SY.sa&&SY.bizId?{taskId:id,bizId:SY.bizId}:{taskId:id})).then(r=>{if(r&&r.sent>0)toast('✓ נשלחה גם התראה לטלפון של העובד')}).catch(()=>{})}catch(e){}};
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
 try{await P.registerActionTypes({types:[{id:'lpwc',actions:[{id:'done',title:'טופל'},{id:'d1',title:'הזכר לי מחר'},{id:'h1',title:'הזכר לי בעוד שעה'}]}]})}catch(e){}
 try{await P.addListener('localNotificationActionPerformed',a=>{lnQ=a;setTimeout(lnAct,300)})}catch(e){}return P}
async function lnPerm(askIt){const P=LN();if(!P)return false;try{let p=await P.checkPermissions();if(p&&p.display!=='granted'&&askIt)p=await P.requestPermissions();return !!(p&&p.display==='granted')}catch(e){return false}}
function lnAct(){const a=lnQ;if(!a)return;if(!on()){return}lnQ=null;const n=a.notification||{},ex=n.extra||{};if(ex.lp!=='wc')return;
 if(ex.u!==SY.uid||ex.b!==LK(''))return;
 /* 16.11.2026: כפתורי ההתראה – "טופל", "הזכר לי מחר" (בדיוק 24 שעות), "הזכר לי בעוד שעה" */
 if((a.actionId==='h1'||a.actionId==='d1')&&(ex.k==='r'||ex.k==='p')){const d1=a.actionId==='d1';snzSet(ex.k+':'+ex.id,Date.now()+(d1?24*H:H));W.sched();tkRe();return toast(d1?'נדחה למחר':'נדחה לעוד שעה')}
 if(a.actionId==='done'&&ex.k==='r')return remDone(ex.id);
 if(a.actionId==='done'&&ex.k==='p'&&typeof ptGet==='function'&&ptGet(ex.id))return ACT.ptDone({dataset:{id:ex.id}});
 TKT='my';W.d0=1;if(cur().v!=='tk')go('tk');else rerender()}
const nt=(id,title,body,at,ex)=>({id,title,body:String(body||'').slice(0,180),schedule:{at:new Date(at),allowWhileIdle:true},smallIcon:'ic_stat_notify',actionTypeId:ex.k==='m'?undefined:'lpwc',extra:Object.assign({lp:'wc',b:LK(''),u:SY.uid},ex)});
const hid=s=>{let h=0;for(const c of String(s))h=(h*31+c.charCodeAt(0))|0;return 5000000+Math.abs(h)%1000000};
let sT=0;W.sched=()=>{clearTimeout(sT);sT=setTimeout(()=>{schedNow().catch(()=>{})},1200)};
async function schedNow(){if(!LN()||!SY.uid)return;const P=await lnSetup();if(!P||!(await lnPerm(false)))return;const b=LK(''),u=SY.uid;
 let pend=[];try{pend=((await P.getPending())||{}).notifications||[]}catch(e){}
 /* גם התראות של משתמש אחר שהתחבר קודם במכשיר הזה (אם הביטול ביציאה לא הספיק) */
 const old=pend.filter(n=>n&&n.extra&&n.extra.lp==='wc'&&((n.extra.b===b&&n.extra.u===u)||n.extra.u!==u)).map(n=>({id:n.id}));if(old.length)try{await P.cancel({notifications:old})}catch(e){}
 if(!on())return;const now=Date.now(),L=[],sz=snzL();
 remL().forEach(r=>{let ts=occ(r,now,4);const s=sz['r:'+r.id];if(s>now)ts=[s].concat(ts.filter(x=>x>s&&x!==r.at)).slice(0,4);/* הדחייה מחליפה את המופע הנוכחי */ts.forEach((at,i)=>L.push(nt(r.nid*8+i,'תזכורת',r.txt,at,{k:'r',id:r.id})))});
 (PT.L||[]).forEach(p=>{const s=sz['p:'+p.id];if(p.st!=='done'&&p.owner===u&&s>now)L.push(nt(hid(p.id),'משימה שנדחתה חזרה',p.txt,s,{k:'p',id:p.id}))});
 const m=mnCfg();if(m.on){const at=nextOcc({rp:'d',hm:m.hm},now);if(at)L.push(nt(MID,'בוקר טוב',mornTxt(),at,{k:'m'}))}
 const L2=L.slice(0,64);wr(KU('lp-ln-ids'),L2.map(n=>n.id));if(L2.length)try{await P.schedule({notifications:L2})}catch(e){}}
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
 return rqcBan()+`<details style="margin:2px 0 8px"><summary style="cursor:pointer;color:var(--acc);font-weight:600">${icd('doc')} תבניות${a.length?' ('+a.length+')':''}</summary><div style="margin-top:6px">${a.map((t,i)=>`<div style="border:1px solid var(--line);border-radius:10px;padding:8px;margin:0 0 6px"><div style="white-space:pre-wrap;max-height:3em;overflow:hidden;font-weight:600">${esc(t.txt)}</div><small class="note">${t.to&&t.to.length?esc(tplNames(t)):'כל העובדים'}${t.np?' · '+t.np+' תמונות':''}${t.pri==='h'?' · דחוף':''}${t.cat?' · '+esc(t.cat):''}${t.ck&&t.ck.length?' · רשימה '+t.ck.length:''}</small><div class="row" style="gap:6px;flex-wrap:wrap;margin-top:6px"><button type="button" class="btn g" data-a="tkwTplFill" data-i="${i}">מלא טופס</button><button type="button" class="btn" data-a="tkwTplSend" data-i="${i}">שלח מתבנית</button><button type="button" class="btn g" data-a="tkwTplDel" data-i="${i}" aria-label="מחק תבנית">${icd('trash')}</button></div></div>`).join('')||'<p class="note" style="margin:0 0 6px">אין עדיין תבניות.</p>'}<button type="button" class="btn g" data-a="tkwTplSave">שמור את הטופס כתבנית</button><p class="note" style="margin:4px 0 0">התבניות נשמרות רק במכשיר הזה.</p></div></details>`};
const tplNames=t=>{const S=TKST.L||[];return (t.to||[]).map(u=>{const s=S.find(z=>z.uid===u);return s?s.name:null}).filter(Boolean).join(', ')||'עובדים שאינם פעילים'};
const tkForm=()=>document.querySelector('form[data-f=tkAdd]');
ACT.tkwTplSave=()=>{const f=tkForm();if(!f)return;const txt=String(f.elements.txt.value||'').trim().slice(0,500);if(!txt)return toast('כתוב קודם את המשימה בטופס');
 if(f.elements.prv&&f.elements.prv.checked)return toast('תבנית נשמרת רק למשימה לעובדים, לא למשימה פרטית');
 const S=TKST.L,sel=S&&S.length?tkSelInit():null,all=!S||!S.length||sel.size===S.length,a=tplL();if(a.length>=20)return toast('אפשר לשמור עד 20 תבניות. מחק תבנית ישנה');
 const o={txt,to:all?[]:[...sel],np:+TKN.np||0};if(rvNew()){const c=fxClean();if(['td','tm','none'].includes(FX.dk))o.dk=FX.dk;if(FX.pri)o.pri=FX.pri;if(c.cat)o.cat=c.cat;if(FX.est>0)o.est=FX.est;if(c.ck.length)o.ck=c.ck}
 a.unshift(o);wr(TPK(),a.slice(0,20));toast('✓ התבנית נשמרה');tkRe()};
function tplFill(i){const t=tplL()[i],f=tkForm();if(!t||!f)return null;if(f.elements.prv&&f.elements.prv.checked){f.elements.prv.checked=false;tkPrvSync()}
 const S=TKST.L||[],act=(t.to||[]).filter(u=>S.some(z=>z.uid===u));
 f.elements.txt.value=t.txt;TKN.np=Math.min(3,Math.max(0,+t.np||0));if(rvNew()){const z=FX0();if(['td','tm','none'].includes(t.dk))z.dk=t.dk;if(['h','l'].includes(t.pri))z.pri=t.pri;z.cat=String(t.cat||'').slice(0,30);z.est=EST.some(e=>e[0]===+t.est)?+t.est:0;z.ck=(Array.isArray(t.ck)?t.ck:[]).map(x=>String(x).slice(0,120)).slice(0,20);z.more=!!(z.cat||z.est||z.ck.length);FX=z}TKN.sel=S.length?new Set(t.to&&t.to.length?act:S.map(z=>z.uid)):null;tkRe();return{t,miss:t.to&&t.to.length&&!act.length}}
ACT.tkwTplFill=el=>{const r=tplFill(+el.dataset.i);if(!r)return;if(r.miss)toast('העובדים שבתבנית אינם פעילים – בחר נמענים');const n=tkForm();if(n){n.scrollIntoView({block:'start'});n.elements.txt.focus()}};
ACT.tkwTplSend=el=>{const i=+el.dataset.i,t=tplL()[i];if(!t)return;
 ask('לשלוח את המשימה "'+t.txt.slice(0,60)+(t.txt.length>60?'…':'')+'" ל'+(t.to&&t.to.length?tplNames(t):'כל העובדים')+'?',()=>{const r=tplFill(i),f=tkForm();if(!r||!f)return;if(r.miss)return toast('העובדים שבתבנית אינם פעילים – בחר נמענים ושלח מהטופס');FRM.tkAdd(f)},'שלח')};
ACT.tkwTplDel=el=>{const i=+el.dataset.i;ask('למחוק את התבנית?',()=>{const a=tplL();a.splice(i,1);wr(TPK(),a);tkRe()},'מחק')};
/* ---- סבב 2: גלאי גרסת הכללים (rv) ---- */
const RVK=()=>LK('lp-tk-rv'),RVT=6*H;let rvB=0;
const rvC=()=>{const c=rd(RVK(),null);return c&&typeof c==='object'&&(c.v===0||c.v===1)?c:null};
const rvNew=()=>{const c=rvC();return !!(c&&c.v===1)};
const rvSet=v=>{const c=rvC(),ch=!c||c.v!==v;wr(RVK(),{v,t:Date.now()});if(ch){tkRe();try{if(cur().v==='rq'&&typeof rqRe==='function')rqRe()}catch(e){}}};
W.rv=rvNew;
W.rvChk=f=>{if(!on()||rvB||typeof tkRv!=='function')return;const c=rvC(),n=Date.now();if(!f&&c&&n-c.t<RVT&&c.t<=n)return;rvB=1;
 tkRv().then(v=>{if(v===0||v===1)rvSet(v)}).catch(()=>{}).then(()=>{rvB=0})};
/* ---- הגדרת עסק: "עובדים רשאים לקבוע עדיפות ויעד" (cfg/tkw, שדה wp; המנהל כותב, כל הצוות קורא; אין ערך = מותר). אכיפה בממשק בלבד.
   נשמר במכשיר לכל עסק ל-10 דקות. כשל בטעינה (רשת) – נשאר מה שנשמר, ובלי ערך שמור – מותר ---- */
const WPK=()=>LK('lp-tk-wp'),WPT=10*MIN;let wpB=0,wpF=0;
const wpC=()=>{const c=rd(WPK(),null);return c&&typeof c==='object'&&(c.v===0||c.v===1)?c:null};
const wpOk=()=>{const c=wpC();return !c||c.v!==0};
const wpLim=()=>on()&&!fbAdmin()&&!wpOk();
const wpSet=v=>{const ch=wpOk()!==!!v;wr(WPK(),{v:v?1:0,t:Date.now()});if(ch)tkRe()};
W.wpChk=()=>{if(!on()||wpB||typeof tkWpGet!=='function')return;const c=wpC(),n=Date.now();if(c&&n-c.t<WPT&&c.t<=n)return;if(n-wpF<6e4)return;wpB=1;
 tkWpGet().then(v=>{if(v===0||v===1)wpSet(v);else wpF=Date.now()}).catch(()=>{wpF=Date.now()}).then(()=>{wpB=0})};
/* ---- סבב 2: תגיות, פס צבע ורשימת סימון בכרטיס ---- */
const EST=[[0,'בלי'],[15,'15 דק׳'],[30,'30 דק׳'],[60,'שעה'],[120,'שעתיים']];
const estTx=m=>{const e=EST.find(x=>x[0]===m);return e?e[1]:m>=60?(Math.round(m/6)/10)+' שע׳':m+' דק׳'};
const ckN=x=>{const n=(x.ck||[]).length,s=new Set((x.ckd||[]).filter(i=>i>=0&&i<n));return[s.size,n,s]};
function xTags(x){let s='';if(x.pri==='h')s+=`<span class="tag t4">${icd('warn')} דחוף</span> `;else if(x.pri==='l')s+='<span class="tag" style="color:var(--mut)">נמוכה</span> ';
 if(x.cat)s+=`<span class="tag t2">${esc(x.cat)}</span> `;if(x.est>0)s+=`<span class="tag t1">${icd('clock')} ${esc(estTx(x.est))}</span> `;
 const c=ckN(x);if(c[1])s+=`<span class="tag ${c[0]===c[1]?'t3':'t1'}">☑ ${c[0]}/${c[1]}</span> `;return s}
W.bar=x=>!on()?'':x.pri==='h'?';border-inline-start:5px solid var(--bad)':x.pri==='l'?';border-inline-start:5px solid var(--mut)':'';
const ckCan=x=>rvNew()&&(x.pv?(x.st!=='done'&&(x.owner===SY.uid||fbAdmin())):(x.st==='open'&&(fbAdmin()||x.ow===SY.uid||(!tkNew(x)&&!x.ow))));
const ckO=new Set();
W.ckH=x=>{if(!on())return '';const c=ckN(x);if(!c[1])return '';const k=(x.pv?'p':'t'),can=ckCan(x),did=esc(x.id);
 return `<details class="tkck" style="margin:0 0 6px" ${ckO.has(k+':'+x.id)?'open':''}><summary data-a="tkwCkTog" data-k="${k}" data-id="${did}" style="cursor:pointer;font-weight:600;color:var(--acc)">רשימת סימון ${c[0]}/${c[1]}</summary><div style="display:grid;gap:4px;margin-top:6px">${x.ck.map((t,i)=>{const d=c[2].has(i);
  return can?`<button type="button" class="opt" data-a="tkwCk" data-k="${k}" data-id="${did}" data-n="${i}" aria-pressed="${d}" style="justify-content:flex-start;gap:8px;text-align:start;min-height:40px"><span aria-hidden="true">${d?'☑':'☐'}</span><span style="${d?'text-decoration:line-through;opacity:.7':''};white-space:pre-wrap">${esc(t)}</span></button>`
  :`<div style="display:flex;gap:8px"><span aria-hidden="true">${d?'☑':'☐'}</span><span style="${d?'text-decoration:line-through;opacity:.7':''};white-space:pre-wrap">${esc(t)}</span></div>`}).join('')}</div></details>`};
ACT.tkwCkTog=el=>{const d=el.parentElement,k=el.dataset.k+':'+el.dataset.id;if(!d)return;d.open=!d.open;if(d.open)ckO.add(k);else ckO.delete(k)};
let ckQ=Promise.resolve();
ACT.tkwCk=el=>{const k=el.dataset.k,id=el.dataset.id,n=+el.dataset.n,x=k==='p'?(typeof ptGet==='function'?ptGet(id):null):tkGet(id);if(!x||!ckCan(x))return;
 const prev=(x.ckd||[]).slice(),s=new Set(prev);if(s.has(n))s.delete(n);else s.add(n);const nx=[...s].filter(i=>i>=0&&i<(x.ck||[]).length).sort((a,b)=>a-b);
 x.ckd=nx;ckO.add(k+':'+id);tkSave();tkRe();
 ckQ=ckQ.then(()=>k==='p'?docPatch('ptk',id,{ckd:nx}):tkPatch(id,{ckd:nx})).catch(e=>{x.ckd=prev;tkSave();tkRe();toast(tkErr(e))})};
W.ckWarn=t=>{if(!on())return '';const c=ckN(t);return c[1]&&c[0]<c[1]?'שים לב: סומנו '+c[0]+' מתוך '+c[1]+' פריטים ברשימה. ':''};
ACT.tkwSa=el=>{const t=tkGet(el.dataset.id);if(!t||!rvNew())return;tkDo(()=>tkPatch(t.id,{sa:Date.now()}),'✓ סומן שהתחלת לעבוד על המשימה')};
/* ---- סבב 2: הטופס – יעד, עדיפות, משך, נושא, רשימת סימון (מצב בזיכרון, כדי שרענון לא ימחק) ---- */
const FX0=()=>({dk:'d3',d:'',tm:'',est:0,pri:'',cat:'',ck:[],more:0});let FX=FX0();
const NOTE72='<p class="note" style="margin:2px 0 8px">3 ימי עסקים (72 שעות, ראשון–חמישי, בלי חגים, חול המועד, ערבי חג, פורים ותשעה באב).</p>';
function cats(){const m=new Set();(TK.L||[]).concat(PT.L||[]).forEach(x=>{if(x&&x.cat)m.add(x.cat)});tplL().forEach(t=>{if(t.cat)m.add(String(t.cat).slice(0,30))});return [...m].slice(0,30).sort((a,b)=>a.localeCompare(b,'he'))}
const fxClean=()=>({cat:String(FX.cat||'').trim().slice(0,30),ck:(FX.ck||[]).map(x=>String(x||'').trim().slice(0,120)).filter(Boolean).slice(0,20)});
W.fold=tab=>on()&&tab==='my'&&!W.fo;
ACT.tkwFold=()=>{W.fo=1;rerender();setTimeout(()=>{const t=document.querySelector('form[data-f=tkAdd] textarea');if(t){t.scrollIntoView({block:'center'});t.focus()}},60)};
W.formX=()=>{if(!on())return '';
 if(!rvNew())return '<p class="note" style="margin:4px 0 2px">יעד לביצוע: '+NOTE72.replace(/^<p[^>]*>|<\/p>$/g,'')+'</p><p class="note" style="margin:0 0 8px">יעד גמיש, עדיפות, נושא ורשימת סימון – יופעל אחרי עדכון השרת.</p>';
 const ch=(a,v,t,o)=>`<button type="button" class="chip ${o?'on':''}" data-a="${a}" data-v="${esc(String(v))}" aria-pressed="${!!o}" style="min-height:36px;padding:0 12px">${t}</button>`;
 W.wpChk();const lim=wpLim(),wpT=fbAdmin()?`<div class="f" style="margin:8px 0 2px"><button type="button" class="chip ${wpOk()?'on':''}" data-a="tkwWp" aria-pressed="${wpOk()}" style="min-height:36px;padding:0 12px">${wpOk()?'✓ ':''}עובדים רשאים לקבוע עדיפות ויעד למשימות שלהם</button><p class="note" style="margin:2px 0 0">הגדרה לכל העסק. כשהיא כבויה, עובד יוצר משימה בעדיפות רגילה וביעד של 3 ימי עסקים.</p></div>`:'';
 const DK=[['td','היום 23:59'],['tm','מחר'],['at','תאריך ושעה'],['d3','3 ימי עסקים'],['none','בלי יעד']];
 let h=lim?NOTE72:`<div class="f" style="margin:6px 0 2px"><span>יעד לביצוע</span><div class="chips" style="margin:4px 0">${DK.map(d=>ch('tkwDk',d[0],d[1],FX.dk===d[0])).join('')}</div></div>`;
 if(!lim&&FX.dk==='at')h+=`<div class="row" style="gap:8px"><label class="f grow"><span>תאריך</span><input type="date" data-i="tkwD" value="${esc(FX.d)}"></label><label class="f grow"><span>שעה</span><input type="time" data-i="tkwTm" value="${esc(FX.tm)}"></label></div>`;
 if(!lim&&FX.dk==='d3')h+=NOTE72;
 if(!lim)h+=`<div class="f" style="margin:2px 0"><span>עדיפות</span><div class="chips" style="margin:4px 0">${[['h','דחוף'],['','רגילה'],['l','נמוכה']].map(p=>ch('tkwPri',p[0],p[1],FX.pri===p[0])).join('')}</div></div>`;
 const c=fxClean(),sm=[FX.est>0?estTx(FX.est):'',c.cat,c.ck.length?c.ck.length+' פריטים':''].filter(Boolean).join(' · ');
 h+=`<button type="button" class="btn g" data-a="tkwMore" aria-expanded="${!!FX.more}" style="margin:4px 0 8px;min-height:40px">${FX.more?'▴':'▾'} משך, נושא ורשימת סימון${sm?' ('+esc(sm)+')':''}</button>`;
 if(FX.more){const C=cats();
  h+=`<div class="f" style="margin:2px 0"><span>משך משוער</span><div class="chips" style="margin:4px 0">${EST.map(e=>ch('tkwEst',e[0],e[1],FX.est===e[0])).join('')}</div></div>
  <label class="f"><span>נושא</span><input data-i="tkwCat" list="tkwCats" maxlength="30" value="${esc(FX.cat)}" placeholder="למשל: מלאי, קופה, ניקיון" autocomplete="off"></label><datalist id="tkwCats">${C.map(x=>`<option value="${esc(x)}"></option>`).join('')}</datalist>
  <div class="f"><span>רשימת סימון${FX.ck.length?' ('+FX.ck.length+'/20)':''}</span>${FX.ck.map((v,i)=>`<div class="row" style="gap:6px;margin:4px 0;flex-wrap:nowrap"><input data-i="tkwCkI" data-n="${i}" value="${esc(v)}" maxlength="120" placeholder="פריט ${i+1}" aria-label="פריט ${i+1}" style="flex:1;min-width:0"><button type="button" class="btn g" data-a="tkwCkDel" data-n="${i}" aria-label="הסר פריט ${i+1}" style="flex:none;min-height:40px;padding:0 12px">✕</button></div>`).join('')}${FX.ck.length<20?'<button type="button" class="btn g" data-a="tkwCkAdd" style="min-height:40px;margin:4px 0 8px">+ הוסף פריט</button>':''}<p class="note" style="margin:0 0 8px">הרשימה לא חוסמת "בוצע" – רק מזכירה.</p></div>`}
 return h+wpT};
ACT.tkwWp=()=>{if(!fbAdmin())return;const v=!wpOk();tkWpSet(v).then(()=>{wpSet(v);toast(v?'✓ עובדים יכולים לקבוע עדיפות ויעד':'✓ עובדים לא יכולים לקבוע עדיפות ויעד')}).catch(e=>toast(tkErr(e)))};
ACT.tkwDk=el=>{FX.dk=el.dataset.v;if(FX.dk==='at'&&!FX.d){const t=Date.now()+2*H,r=t-(t%(15*MIN))+15*MIN;FX.d=ymd(r);FX.tm=hhmm(r)}tkRe()};
ACT.tkwPri=el=>{FX.pri=el.dataset.v||'';tkRe()};
ACT.tkwEst=el=>{FX.est=+el.dataset.v||0;tkRe()};
ACT.tkwMore=()=>{FX.more=FX.more?0:1;tkRe()};
ACT.tkwCkAdd=()=>{if(FX.ck.length>=20)return;FX.ck.push('');FX.more=1;tkRe();setTimeout(()=>{const a=document.querySelectorAll('form[data-f=tkAdd] [data-i=tkwCkI]');if(a.length)a[a.length-1].focus()},40)};
ACT.tkwCkDel=el=>{FX.ck.splice(+el.dataset.n,1);tkRe()};
INP.tkwD=el=>{FX.d=String(el.value||'')};INP.tkwTm=el=>{FX.tm=String(el.value||'')};INP.tkwCat=el=>{FX.cat=String(el.value||'').slice(0,30)};
INP.tkwCkI=el=>{const i=+el.dataset.n;if(i>=0&&i<FX.ck.length)FX.ck[i]=String(el.value||'').slice(0,120)};
/* FRM.tkAdd: השדות לשליחה (בפורמט Firestore). כללים ישנים / לא ידוע – בלי שדות חדשים */
W.fx=()=>{if(!on())return null;const X={msg:'',f:()=>({}),done:id=>{FX=FX0();W.fo=0;rqcDone(id)},
  old:(e,fl0)=>{if(!e||e.code!==403)return false;const ks=['dl','pri','cat','est','ck','ckd'].filter(k=>k in fl0);if(!ks.length)return false;rvSet(0);
   if('dl' in fl0){const x=new Error('rules');x.tkw='השרת עוד לא עודכן ליעד גמיש, ולכן המשימה לא נשלחה. אפשר לשלוח שוב עם יעד של 3 ימי עסקים.';throw x}
   ks.forEach(k=>delete fl0[k]);X.msg='✓ המשימה נוספה (בלי עדיפות, נושא ורשימה – יופעלו אחרי עדכון השרת)';return true}};
 if(!rvNew())return X;
 const now=Date.now();let dl=null;
 const lim=wpLim();
 if(lim){}else if(FX.dk==='td')dl=atDay(0,23,59);else if(FX.dk==='tm')dl=atDay(1,23,59);else if(FX.dk==='none')dl=0;
 else if(FX.dk==='at'){const dm=/^(\d{4})-(\d{2})-(\d{2})$/.exec(FX.d||''),tm=/^(\d{1,2}):(\d{2})/.exec(FX.tm||'');if(!dm||!tm){X.err='בחר תאריך ושעה ליעד';return X}
  dl=tkIL.at(+dm[1],+dm[2]-1,+dm[3],+tm[1],+tm[2]);if(dl<=now){X.err='היעד שנבחר כבר עבר. בחר זמן עתידי';return X}if(dl>now+399*864e5){X.err='אפשר לקבוע יעד עד שנה קדימה';return X}}
 const c=fxClean();
 X.f=()=>{const o={};if(dl!==null)o.dl=iv(Math.max(0,dl));if(!lim&&(FX.pri==='h'||FX.pri==='l'))o.pri=sv(FX.pri);if(c.cat)o.cat=sv(c.cat);if(FX.est>0&&FX.est<=1440)o.est=iv(FX.est);
  if(c.ck.length){o.ck={arrayValue:{values:c.ck.map(sv)}};o.ckd={arrayValue:{}}}return o};
 return X};
/* ---- סבב 3: בקשות למנהל (rq) – סוג פנייה k, שלב ph בתוך st=='new' ('' נשלחה, 'r' נקראה, 'w' בטיפול), "הפוך למשימה" (tk).
   רק כשהכללים החדשים פורסמו (rvNew). כללים ישנים / לא ידוע – לא שולחים k/ph/tk, והתגיות והכפתורים כמו קודם ---- */
W.rvOld=()=>rvSet(0);
const RQK=[['q','בקשה'],['s','שאלה'],['b','תקלה'],['u','עדכון']],RQKN={q:'בקשה',s:'שאלה',b:'תקלה',u:'עדכון'};
const rqKind=x=>['s','b','u'].includes(x.k)?x.k:'q';
W.rqKindH=()=>{if(!on())return '';W.rvChk(0);if(!rvNew())return '';
 return `<div class="f" style="margin:0 0 8px"><span>סוג הפנייה</span><div class="chips" role="radiogroup" aria-label="סוג הפנייה" style="margin:4px 0">${RQK.map((k,i)=>`<label class="chip" style="min-height:40px;padding:0 12px"><input type="radio" name="k" value="${k[0]}" ${i?'':'checked'}> ${k[1]}</label>`).join('')}</div></div>`};
W.rqK=f=>{if(!on()||!rvNew())return '';const v=String((f&&f.elements&&f.elements.k&&f.elements.k.value)||'');return ['q','s','b','u'].includes(v)?v:''};
W.rqTag=(x,adm)=>{if(!on())return '';W.rvChk(0);if(!rvNew())return '';const k=rqKind(x);
 const ph=x.st==='done'?[k==='q'?'אושרה':'טופלה','t3']:x.st==='rej'?['נדחתה','t4']:x.ph==='w'?['בטיפול','t2']:x.ph==='r'?['נקראה','t1']:['נשלחה','t1'];
 return `<span class="tag" style="opacity:.85">${RQKN[k]}</span> <span class="tag ${ph[1]}">${ph[0]}</span> ${x.tk?'<span class="tag t2">✓ נוצרה משימה</span> ':''}`};
const rqOk=()=>{try{return on()&&isA()&&rvNew()}catch(e){return false}};
const dlgClose=fn=>{const d=$('#dlg');if(d&&d.open)d.addEventListener('close',fn,{once:true});else fn()};
/* מנהל פתח שרשור של בקשה שעוד לא נקראה ← ph:'r' (כשל – בשקט) */
{const o=rqThreadOpen;rqThreadOpen=async function(id){const r=await o.apply(this,arguments);try{const x=rqGet(id);if(rqOk()&&!TKST.L&&!TKST.busy&&typeof tkStaffLoad==='function')tkStaffLoad().catch(()=>{});if(x&&rqOk()&&x.st==='new'&&!x.ph){x.ph='r';docPatch('rq',id,{ph:'r'}).then(()=>dlgClose(()=>rqRe())).catch(()=>{x.ph=''})}}catch(e){}return r}}
/* כפתורי מנהל בשרשור: "בטיפול" ו"הפוך למשימה" */
{const o=rqCmView;rqCmView=function(x){let h=o.apply(this,arguments);try{if(rqOk()&&x&&x.st==='new'){const did=esc(x.id),m='<button type="button" class="btn g w" data-a="closeDlg"';
 const b=`<div class="row" style="margin-top:8px;flex-wrap:wrap;gap:8px">${x.ph!=='w'?`<button type="button" class="btn g grow" data-a="tkwRqW" data-id="${did}">${icd('clock')} בטיפול</button>`:''}${x.tk?'':`<button type="button" class="btn g grow" data-a="tkwRqTk" data-id="${did}">${icd('doc')} הפוך למשימה</button>`}</div>`;
 if(h.includes(m))h=h.replace(m,()=>b+m)}}catch(e){}return h}}
ACT.tkwRqW=el=>{const id=el.dataset.id,x=rqGet(id);if(!x||!rqOk())return;el.disabled=true;
 docPatch('rq',id,{ph:'w'}).then(()=>{x.ph='w';el.remove();toast('✓ סומן "בטיפול"');dlgClose(()=>rqRe())}).catch(e=>{el.disabled=false;toast(tkErr(e))})};
/* "הפוך למשימה": טופס המשימה ממולא (טקסט הבקשה, נמען = מי ששלח). אחרי יצירה ← ph:'w', tk:<מזהה המשימה> */
ACT.tkwRqTk=el=>{const id=el.dataset.id,x=rqGet(id);if(!x||!rqOk())return;const S=TKST.L;
 if(!S){if(typeof tkStaffLoad==='function'&&!TKST.busy)tkStaffLoad();return toast('טוען את רשימת העובדים… נסה שוב בעוד רגע')}
 const s=S.find(z=>z.uid===x.owner);if(S.length&&!s)return toast('העובד ששלח את הבקשה אינו פעיל ברשימת העובדים, ולכן אי אפשר לשלוח לו משימה');
 closeDlg();W.rqc={id,txt:String(x.txt||'').slice(0,500),n:s?s.name:(x.by||'עובד')};if(S.length)TKN.sel=new Set([x.owner]);TKN.np=0;TKN.imgs=[];FX=FX0();
 TKT='open';W.fo=1;W.d0=1;if(cur().v!=='tk')go('tk');else rerender();
 setTimeout(()=>{const f=tkForm();if(!f||!W.rqc)return;if(f.elements.prv&&f.elements.prv.checked){f.elements.prv.checked=false;tkPrvSync()}const ta=f.elements.txt;if(ta&&!ta.value.trim())ta.value=W.rqc.txt;f.scrollIntoView({block:'start'});if(ta)ta.focus()},80)};
function rqcBan(){const c=W.rqc;if(!c)return '';
 return `<div class="card" style="margin:6px 0;padding:8px 10px;border-color:var(--acc)"><b>${icd('chat')} משימה מבקשה של ${esc(c.n)}</b><p class="note" style="margin:4px 0 6px">הנמען: ${esc(c.n)}. אחרי יצירת המשימה הבקשה תסומן "בטיפול".</p><button type="button" class="btn g s" data-a="tkwRqX">ביטול</button></div>`}
ACT.tkwRqX=()=>{const c=W.rqc;W.rqc=null;TKN.sel=null;const f=tkForm();if(f&&c&&f.elements.txt.value===c.txt)f.elements.txt.value='';tkRe()};
function rqcDone(id){const c=W.rqc;if(!id||!c)return;W.rqc=null;const x=rqGet(c.id);
 docPatch('rq',c.id,{ph:'w',tk:String(id)}).then(()=>{if(x){x.ph='w';x.tk=String(id)}}).catch(()=>toast('המשימה נוצרה, אבל סימון הבקשה "בטיפול" נכשל'))}
/* ---- יציאה מהחשבון: ביטול ההתראות המקומיות ומחיקת המפתחות של המשתמש מהמכשיר (טלפון משותף). לא זורק שגיאות ---- */
W.out=u=>{const k=x=>LK(x+'-'+(u||''));clearTimeout(sT);
 try{const P=LN();if(P){const ids=rd(k('lp-ln-ids'),[]);if(Array.isArray(ids)&&ids.length)Promise.resolve(P.cancel({notifications:ids.map(id=>({id}))})).catch(()=>{});
  Promise.resolve(P.getPending()).then(r=>{const a=((r&&r.notifications)||[]).filter(n=>n&&n.extra&&n.extra.lp==='wc').map(n=>({id:n.id}));if(a.length)return P.cancel({notifications:a})}).catch(()=>{})}}catch(e){}
 ['lp-rem','lp-snz','lp-tk-dt','lp-tk-ndv','lp-tk-mn','lp-ln-ids'].forEach(x=>{try{localStorage.removeItem(k(x))}catch(e){}});
 ['lp-tk-flt','lp-tk-tpl','lp-tk-rv'].forEach(x=>{try{localStorage.removeItem(LK(x))}catch(e){}});
 FX=FX0();W.fo=0;W.rqc=null};
/* ---- חיבור לקוד הקיים ---- */
{const o=tkPatch;tkPatch=async function(id,ob){const r=await o.apply(this,arguments);try{if(ob&&ob.doneBy&&(ob.st==='done'||ob.st==='wait')&&ob.doneBy===fbBy()){const t=tkGet(id);logDone('t',id,t?t.txt:'')}}catch(e){}return r}}
{const o=tkLoad;tkLoad=async function(){const r=await o.apply(this,arguments);try{W.sched();if(lnQ)lnAct()}catch(e){}return r}}
{const o=tkAlert;tkAlert=async function(){await o.apply(this,arguments);try{wcAlert()}catch(e){}}}
{const o=ACT.tkRefresh;if(o)ACT.tkRefresh=function(){W.rvChk(1);return o.apply(this,arguments)}}
{const o=ACT.tkTab;if(o)ACT.tkTab=function(){W.fo=0;return o.apply(this,arguments)}}
/* רענון המסך לא מאבד את הפוקוס בשדות החדשים של הטופס (נושא, פריט ברשימה, תאריך) */
{const o=tkRe;tkRe=function(){const a=document.activeElement,k=a&&a.dataset&&a.dataset.i&&/^tkw(Cat|CkI|D|Tm)$/.test(a.dataset.i)?[a.dataset.i,a.dataset.n||'',a.selectionStart]:null;const r=o.apply(this,arguments);
 if(k){const n=document.querySelector(`form[data-f=tkAdd] [data-i="${k[0]}"]${k[1]?`[data-n="${k[1]}"]`:''}`);if(n&&document.activeElement!==n){n.focus();try{if(k[2]!=null)n.setSelectionRange(k[2],k[2])}catch(e){}}}return r}}
['tkGoIt','tkGoAl','tkGoWait'].forEach(k=>{const o=ACT[k];if(o)ACT[k]=function(){W.d0=1;return o.apply(this,arguments)}});
setTimeout(()=>{try{if(on()){W.sched();wcAlert()}}catch(e){}},6000);
setTimeout(()=>{try{if(LN())lnSetup()}catch(e){}},500);
window.TKW=W;
})();
