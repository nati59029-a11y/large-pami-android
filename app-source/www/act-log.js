/* נוכחות ויומן שימוש (23.11.2026). נטען אחרי ent-log.js. נקרא מ-render ב-index.html דרך ALOG.nav(cur, תוצאת המסך).
   נוכחות pres/{uid} {on,t,n,e}: לכל משתמש מחובר (עובד או מנהל), דופק כל 3 דקות רק כשהמסך גלוי, כתיבה רק כשמשהו השתנה; on=false כשהאפליקציה יוצאת לרקע.
   יומן act/{uid}_{YYYY-MM-DD} {uid,n,day,s[{a,b}],v[{k,l,a,b}],t}: רק עובדים, ורק כש-cfg/act.on==true. נשמר לתור ב-localStorage (LK('lp-act')) ונשלח מהתור.
   403 = השבתה שקטה עד חזרה לאפליקציה. מסך מנהל V.actLog: מתג, רשימת עובדים, דוח לפי יום/טווח (עד 31 יום).
   window.NM={byUid,byPfx}: שם אמיתי לתצוגה ('' אם לא ידוע). מנהל: מ-staff; עובד: מרשימת pres. */
(function(){'use strict';
if(typeof V==='undefined'||typeof fsx!=='function'||typeof ACT==='undefined')return;
const TZ='Asia/Jerusalem',TICK=5e3,SAVE=3e4,FLUSH=12e4,BEAT=18e4,LIVE=3e5,NMTTL=6e5,MAXS=300,MAXV=3000,MAXDAYS=31;
const isAd=()=>{try{return typeof isA==='function'&&isA()}catch(e){return false}};
const isWk=()=>{try{return typeof isW==='function'&&isW()&&!isAd()}catch(e){return false}};
const role=()=>{try{return typeof fbRole==='function'&&fbRole()&&!SY.mg&&!!SY.uid}catch(e){return false}};
const bv=v=>({booleanValue:!!v}),iv_=v=>({integerValue:String(Math.round(+v||0))}),sv_=v=>({stringValue:String(v==null?'':v)});
const dayOf=ms=>{try{return new Date(ms).toLocaleDateString('en-CA',{timeZone:TZ})}catch(e){return ''}};
const hm=ms=>{try{return new Date(ms).toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit',timeZone:TZ,hour12:false})}catch(e){return ''}};
const fmtD=d=>d?d.split('-').reverse().join('/'):'';
const dur=ms=>{const m=Math.round(Math.max(0,ms)/6e4);if(m<1)return ms>0?'פחות מדקה':'0 ד׳';const h=Math.floor(m/60),r=m%60;return[h?h+' ש׳':'',r?r+' ד׳':''].filter(Boolean).join(' ')};
const E=s=>typeof esc==='function'?esc(s):String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fv=v=>{try{return typeof fvj==='function'?fvj(v):null}catch(e){return null}};
const QK=()=>{try{return LK('lp-act')}catch(e){return 'lp-act'}};
/* ---------- מצב ---------- */
const ST={uid:'',vis:true,cfg:false,dis:0,D:{},OS:null,OV:null,cur:null,tSave:0,tFlush:0,tBeat:0,pOn:null,pT:0,name:'',tmr:0,hook:0,merged:{},busy:0};
const NMS={u:{},p:{},at:0,busy:0,asked:0};
/* ---------- תור במכשיר ---------- */
function qLoad(){ST.D={};try{const o=JSON.parse(localStorage.getItem(QK())||'null');if(o&&o.uid===ST.uid&&o.d&&typeof o.d==='object'){for(const k of Object.keys(o.d)){const x=o.d[k];if(x&&Array.isArray(x.s)&&Array.isArray(x.v))ST.D[k]={s:x.s,v:x.v,rev:1,sent:x.sent?1:0,m:x.m?1:0}}}}catch(e){}}
function qSave(){try{const d={};for(const k of Object.keys(ST.D)){const x=ST.D[k];if(x.rev===x.sent&&k<dayOf(Date.now()))continue;d[k]={s:x.s,v:x.v,sent:x.rev===x.sent?1:0,m:x.m?1:0}}localStorage.setItem(QK(),JSON.stringify({uid:ST.uid,d}))}catch(e){}ST.tSave=Date.now()}
const dd=day=>ST.D[day]||(ST.D[day]={s:[],v:[],rev:1,sent:0,m:0});
/* ---------- זיהוי המסך ---------- */
function plain(t){return String(t==null?'':t).replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim().slice(0,40)}
function base(c,x){const k=String((c&&c.v)||'?').slice(0,30);return{k,l:plain(x&&x.t)||k}}
function ovl(){/* סריקה או גיליון הוספה פתוחים מעל המסך (נפתחים בלי render) */
 try{if(typeof US!=='undefined'&&US)return{k:'scan',l:'סריקת מסמך'};if(typeof A!=='undefined'&&A)return{k:'sheet',l:A.step==='scan'?'סריקת מסמך':'הוספת רשומה'}}catch(e){}return null}
/* ---------- יומן: פתיחה וסגירה של קטעים ---------- */
function split(day,now){/* חציית חצות: הרגע הראשון של היום החדש (שעון ישראל) */
 let lo=ST.OS.a,hi=now;while(hi-lo>1e3){const mid=Math.floor((lo+hi)/2);if(dayOf(mid)===day)lo=mid;else hi=mid}return hi}
function roll(now){for(let i=0;i<40&&ST.OS&&dayOf(ST.OS.a)!==dayOf(now);i++){const od=dayOf(ST.OS.a),m=split(od,now),ov=ST.OV;
  ST.OS.b=m;if(ov)ov.b=m;dd(od).rev++;const nd=dd(dayOf(m)),ns={a:m,b:now};nd.s.push(ns);ST.OS=ns;if(ov){const nv={k:ov.k,l:ov.l,a:m,b:now};nd.v.push(nv);ST.OV=nv}nd.rev++}}
function openV(now,k,l){const D=dd(dayOf(now));
 const last=D.v[D.v.length-1];
 if(last&&last.k===k&&last.l===l&&now-last.b<=2e3){last.b=now;ST.OV=last}
 else if(D.v.length<MAXV){const v={k,l,a:now,b:now};D.v.push(v);ST.OV=v}else ST.OV=null;
 D.rev++}
function begin(now){if(!logOn()||ST.OS)return;const D=dd(dayOf(now));if(D.s.length>=MAXS)return;const s={a:now,b:now};D.s.push(s);ST.OS=s;D.rev++;
 if(ST.cur)openV(now,ST.cur.k,ST.cur.l)}
function end(now){if(ST.OS){ST.OS.b=Math.max(ST.OS.a,now);if(ST.OV)ST.OV.b=Math.max(ST.OV.a,now);dd(dayOf(ST.OS.a)).rev++}ST.OS=ST.OV=null}
const logOn=()=>isWk()&&ST.cfg&&!ST.dis;
function mark(now){/* מעדכן את הקטע הפתוח; מזהה שינוי מסך (גם גיליון שנפתח בלי render) */
 if(!ST.OS)return;roll(now);if(!ST.OS)return;ST.OS.b=now;if(ST.OV)ST.OV.b=now;dd(dayOf(ST.OS.a)).rev++}
function setScreen(w,now){const same=ST.cur&&ST.cur.k===w.k&&ST.cur.l===w.l;ST.cur=w;if(!ST.OS)return;if(same){mark(now);return}
 roll(now);if(!ST.OS)return;if(ST.OV)ST.OV.b=now;openV(now,w.k,w.l)}
/* ---------- קריאה וכתיבה ---------- */
function fail(e){if(e&&e.code===403){ST.dis=1;if(ST.OS)end(Date.now());return true}return false}
async function readCfg(){ST.cfg=false;if(!isWk())return;try{const d=await fsx('/cfg/act');ST.cfg=fv({mapValue:d}).on===true}catch(e){ST.cfg=false}
 if(ST.vis&&logOn()&&!ST.OS)begin(Date.now());else if(!logOn()&&ST.OS)end(Date.now())}
async function myName(){if(ST.name)return ST.name;let n='';try{const d=await fsx('/staff/'+SY.uid);n=String((fv({mapValue:d})||{}).name||'').trim()}catch(e){}
 ST.name=(n||(typeof fbBy==='function'?fbBy():'')||'').slice(0,100);return ST.name}
async function presWrite(on,force){if(!role()||ST.pdis)return;const now=Date.now();
 if(!force&&ST.pOn===on&&now-ST.pT<BEAT-2e4)return;ST.pOn=on;ST.pT=now;
 try{const n=await myName();const e=(typeof fbBy==='function'?fbBy():'').slice(0,100);
  await fsx('/pres/'+SY.uid,{method:'PATCH',body:JSON.stringify({fields:{on:bv(on),t:iv_(now),n:sv_(n),e:sv_(e)}})})}
 catch(e){if(e&&e.code===403){ST.pdis=1}else{ST.pT=0}}}
const enc=x=>({mapValue:{fields:x}});
const arrS=L=>({arrayValue:{values:L.map(o=>enc({a:iv_(o.a),b:iv_(o.b)}))}});
const arrV=L=>({arrayValue:{values:L.map(o=>enc({k:sv_(o.k),l:sv_(String(o.l).slice(0,40)),a:iv_(o.a),b:iv_(o.b)}))}});
async function mergeRemote(day){/* מכשיר אחר באותו יום: מאחדים לפני דריסה */
 const D=ST.D[day];if(!D||D.m)return;try{const d=await fsx('/act/'+SY.uid+'_'+day),f=fv({mapValue:d})||{};
  const ks=new Set(D.s.map(o=>o.a)),kv=new Set(D.v.map(o=>o.k+'|'+o.a));
  (Array.isArray(f.s)?f.s:[]).forEach(o=>{if(o&&!ks.has(+o.a)&&D.s.length<MAXS)D.s.push({a:+o.a,b:+o.b})});
  (Array.isArray(f.v)?f.v:[]).forEach(o=>{if(o&&!kv.has(o.k+'|'+o.a)&&D.v.length<MAXV)D.v.push({k:String(o.k),l:String(o.l),a:+o.a,b:+o.b})});
  D.s.sort((x,y)=>x.a-y.a);D.v.sort((x,y)=>x.a-y.a);D.rev++}
 catch(e){/* 404 = אין עדיין; 403 = עובד לא רשאי לקרוא את היומן (הכללים) – ממשיכים לכתוב בלי איחוד */if(e&&e.code!==404&&e.code!==403)throw e}D.m=1}
async function flush(){if(ST.busy||!isWk()||ST.dis||!ST.cfg&&!Object.keys(ST.D).some(k=>ST.D[k].rev!==ST.D[k].sent))return;ST.busy=1;ST.tFlush=Date.now();
 try{for(const day of Object.keys(ST.D)){const D=ST.D[day];if(D.rev===D.sent)continue;if(!D.s.length&&!D.v.length){D.sent=D.rev;continue}
   await mergeRemote(day);const rv=D.rev;const n=await myName();
   await fsx('/act/'+SY.uid+'_'+day,{method:'PATCH',body:JSON.stringify({fields:{uid:sv_(SY.uid),n:sv_(n),day:sv_(day),s:arrS(D.s),v:arrV(D.v),t:iv_(Date.now())}})});D.sent=rv}}
 catch(e){fail(e)}finally{ST.busy=0;qSave()}}
/* ---------- מחזור חיים ---------- */
function tick(){const now=Date.now();
 if(!role()||SY.uid!==ST.uid){stop();return}
 if(!ST.vis)return;
 try{if(ST.base)setScreen(ovl()||ST.base,now)}catch(e){}
 if(ST.OS){mark(now)}
 if(now-ST.tSave>=SAVE&&ST.OS)qSave();
 if(logOn()&&now-ST.tFlush>=FLUSH)flush();
 if(now-ST.pT>=BEAT-2e4)presWrite(true,true)}
function hide(){if(!ST.vis)return;ST.vis=false;const now=Date.now();
 if(ST.OS){end(now);qSave();flush()}
 presWrite(false,true)}
function show(){if(ST.vis)return;ST.vis=true;ST.dis=0;ST.pdis=0;ST.tFlush=0;
 presWrite(true,true);readCfg();nmLoad(true)}
function hooks(){if(ST.hook)return;ST.hook=1;
 try{document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')hide();else show()})}catch(e){}
 try{const P=window.Capacitor&&window.Capacitor.Plugins&&window.Capacitor.Plugins.App;if(P&&P.addListener){P.addListener('pause',()=>{try{hide()}catch(e){}});P.addListener('resume',()=>{try{show()}catch(e){}})}}catch(e){}}
function start(){if(ST.uid===SY.uid&&ST.tmr)return;stop();ST.uid=SY.uid;ST.vis=document.visibilityState!=='hidden';ST.dis=0;ST.pdis=0;qLoad();
 hooks();ST.tmr=setInterval(()=>{try{tick()}catch(e){}},TICK);
 if(ST.vis)presWrite(true,true);readCfg().then(()=>{if(ST.D&&logOn())flush()});nmLoad(false)}
function stop(){if(ST.tmr)clearInterval(ST.tmr);ST.tmr=0;ST.OS=ST.OV=null;ST.D={};ST.cfg=false;ST.name='';ST.pOn=null;ST.pT=0;ST.uid=''}
/* ---------- שמות אמיתיים (NM) ---------- */
function nmLoad(force){if(!role()||NMS.busy)return;const now=Date.now();if(!force&&NMS.asked&&now-NMS.at<NMTTL)return;
 NMS.busy=1;NMS.asked=1;NMS.at=now;const adm=isAd();
 const get=async p=>{try{const j=await fsx(p+'?pageSize=300');return(j&&j.documents)||[]}catch(e){return null}};
 Promise.all([adm?get('/staff'):Promise.resolve(null),get('/pres')]).then(([st,pr])=>{
  const u={},p={},pu={};
  (pr||[]).forEach(d=>{const f=fv({mapValue:d})||{},id=d.name.split('/').pop(),n=String(f.n||'').trim(),e=String(f.e||'').trim().toLowerCase();NMS.pres=NMS.pres||{};pu[id]={on:f.on===true,t:+f.t||0,n,e};if(n){u[id]=n;if(e)p[e]=n}});
  (st||[]).forEach(d=>{const f=fv({mapValue:d})||{},id=d.name.split('/').pop(),n=String(f.name||'').trim(),em=String(f.email||'').split('@')[0].trim().toLowerCase();
   if(n){u[id]=n;if(em)p[em]=n}});
  const had=Object.keys(NMS.u).length;NMS.u=u;NMS.p=p;NMS.pres=pu;NMS.staff=st?st.map(d=>{const f=fv({mapValue:d})||{};return{uid:d.name.split('/').pop(),name:String(f.name||'').trim(),email:String(f.email||''),active:f.active===true}}):NMS.staff;
  NMS.at=Date.now();
  if(!had&&Object.keys(u).length&&typeof rerender==='function'){const a=document.activeElement;if(!(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)))try{rerender()}catch(e){}}
  if(cur_()==='actLog'&&typeof rerender==='function')try{rerender()}catch(e){}
 }).finally(()=>{NMS.busy=0})}
const cur_=()=>{try{return cur().v}catch(e){return ''}};
window.NM={
 byUid(uid){uid=String(uid||'');if(!uid)return '';try{if(role()&&Date.now()-NMS.at>NMTTL)nmLoad(false)}catch(e){}return NMS.u[uid]||(uid===(SY&&SY.uid)&&ST.name)||''},
 byPfx(pfx){pfx=String(pfx||'').trim().toLowerCase();if(!pfx)return '';try{if(role()&&Date.now()-NMS.at>NMTTL)nmLoad(false)}catch(e){}return NMS.p[pfx]||''}};
/* ---------- נקודת הכניסה מ-render ---------- */
window.ALOG={nav(c,x){try{if(!role()){if(ST.uid)stop();return}
 if(ST.uid!==SY.uid||!ST.tmr)start();
 ST.base=base(c,x);const w=ovl()||ST.base;if(ST.vis)setScreen(w,Date.now());else ST.cur=w}catch(e){}}};
/* ---------- מסך מנהל ---------- */
const AL={emp:'',from:'',to:'',data:null,busy:0,err:'',cfgOn:null,cfgBusy:0,cfgErr:'',loaded:0};
const today=()=>dayOf(Date.now());
const addD=(d,n)=>{const x=new Date(d+'T12:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10)};
function days(a,b){const L=[];let d=a,i=0;while(d<=b&&i<MAXDAYS){L.push(d);d=addD(d,1);i++}return L}
async function alInit(){if(AL.loaded||AL.busy)return;AL.loaded=1;nmLoad(true);try{const d=await fsx('/cfg/act');AL.cfgOn=fv({mapValue:d}).on===true}catch(e){AL.cfgOn=e&&e.code===404?false:null;if(e&&e.code&&e.code!==404)AL.cfgErr=e.code===403?'אין הרשאה לקרוא את ההגדרה (הכללים עוד לא פורסמו)':'שגיאה בקריאת ההגדרה'}
 if(cur_()==='actLog')rerender()}
async function alLoad(){if(!AL.emp||AL.busy)return;if(!AL.from)AL.from=AL.to=today();if(AL.to<AL.from)AL.to=AL.from;if(days(AL.from,AL.to).length>=MAXDAYS&&AL.to>addD(AL.from,MAXDAYS-1))AL.to=addD(AL.from,MAXDAYS-1);
 AL.busy=1;AL.err='';AL.data=null;rerender();const L=days(AL.from,AL.to),R={};
 try{for(let i=0;i<L.length;i+=8)await Promise.all(L.slice(i,i+8).map(async day=>{try{const d=await fsx('/act/'+AL.emp+'_'+day),f=fv({mapValue:d})||{};
    R[day]={s:(Array.isArray(f.s)?f.s:[]).map(o=>({a:+o.a,b:+o.b})),v:(Array.isArray(f.v)?f.v:[]).map(o=>({k:String(o.k),l:String(o.l),a:+o.a,b:+o.b}))}}catch(e){if(e&&e.code===404)return;throw e}}));
  AL.data=R}
 catch(e){AL.err=e&&e.code===403?'אין הרשאה לקרוא את היומן (ייתכן שהכללים עוד לא פורסמו).':e&&e.offline?'אין חיבור לאינטרנט.':'לא הצלחתי לטעון את היומן.'}
 AL.busy=0;if(cur_()==='actLog')rerender()}
function who(u){const s=(NMS.staff||[]).find(x=>x.uid===u);return(s&&(s.name||String(s.email).split('@')[0]))||NMS.u[u]||u.slice(0,6)}
function report(){const R=AL.data;if(!R)return '';const ks=Object.keys(R).sort();if(!ks.length)return '<div class="empty">אין נתונים לטווח הזה. ייתכן שהמעקב היה כבוי, או שהעובד לא פתח את האפליקציה.</div>';
 const multi=ks.length>1;let tot=0,cnt=0,sess='';const G={};
 const dl=d=>multi?fmtD(d).slice(0,5)+' ':'';
 for(const d of ks){const x=R[d];const S=x.s.slice().sort((p,q)=>p.a-q.a);
  for(const s of S){const t=Math.max(0,s.b-s.a);tot+=t;cnt++;sess+=`<div class="row" style="justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--line)"><span>${dl(d)}${hm(s.a)}–${hm(s.b)}</span><b>${dur(t)}</b></div>`}
  if(!S.length)x.v.forEach(o=>{tot+=Math.max(0,o.b-o.a)});
  for(const o of x.v){const g=G[o.l]||(G[o.l]={l:o.l,t:0,n:0,at:[]});g.t+=Math.max(0,o.b-o.a);g.n++;g.at.push(dl(d)+hm(o.a))}}
 const rows=Object.values(G).sort((p,q)=>q.t-p.t).map(g=>`<tr><td style="padding:6px 4px;border-bottom:1px solid var(--line)"><b>${E(g.l)}</b><div class="note" style="font-size:.8rem">${g.n} ${g.n===1?'כניסה':'כניסות'}: ${E(g.at.slice(0,8).join(', '))}${g.at.length>8?' …':''}</div></td><td style="padding:6px 4px;border-bottom:1px solid var(--line);white-space:nowrap;text-align:end"><b>${dur(g.t)}</b></td></tr>`).join('');
 return `<div class="card"><div class="row" style="justify-content:space-between"><span>סך זמן שימוש</span><b style="color:var(--acc)">${dur(tot)}</b></div><div class="note" style="margin-top:4px">${cnt===1?'כניסה אחת':cnt+' כניסות'} לאפליקציה, ${ks.length} ${ks.length===1?'יום':'ימים'} עם נתונים</div></div>
 ${sess?`<div class="card"><b>כניסות ויציאות</b><div style="margin-top:6px">${sess}</div></div>`:''}
 ${rows?`<div class="card"><b>מסכים</b><table style="width:100%;border-collapse:collapse;margin-top:6px"><tbody>${rows}</tbody></table></div>`:''}`}
function empList(){const S=(NMS.staff||[]).slice().sort((a,b)=>(b.active-a.active)||(a.name||a.email).localeCompare(b.name||b.email,'he'));
 if(!S.length)return `<div class="note">${NMS.busy?'טוען עובדים…':'אין רשימת עובדים'}</div>`;const now=Date.now();
 return S.map(s=>{const p=(NMS.pres||{})[s.uid],on=p&&p.on&&now-p.t<LIVE,sel=AL.emp===s.uid;
  const st=on?'<span style="color:var(--inc)">● מחובר עכשיו</span>':p&&p.t?'נראה לאחרונה: '+(dayOf(p.t)===today()?'':fmtD(dayOf(p.t)).slice(0,5)+' ')+hm(p.t):'עוד לא נראה';
  return `<button class="opt" data-a="alEmp" data-u="${E(s.uid)}" style="width:100%;min-height:48px;margin-bottom:6px;text-align:start${sel?';border-color:var(--acc)':''}"><span><b>${E(s.name||String(s.email).split('@')[0]||s.uid)}</b>${s.active?'':' (לא פעיל)'}<small style="display:block;font-weight:400;color:var(--mut)">${st}</small></span></button>`}).join('')}
V.actLog=()=>{const T='יומן שימוש בעובדים';if(!isAd())return{t:T,h:'<div class="empty">המסך הזה למנהל בלבד</div>'};alInit();
 const on=AL.cfgOn;
 let h=`<div class="card"><label class="opt" style="min-height:48px"><span>מעקב שימוש בעובדים<small style="display:block;font-weight:400;color:var(--mut)">${on===null?(AL.cfgErr||'טוען…'):on?'פעיל – נרשמים זמני כניסה ומסכים של עובדים':'כבוי'}</small></span><input type="checkbox" data-c="alOn"${on?' checked':''}${on===null||AL.cfgBusy?' disabled':''}></label>
 <p class="note" style="margin:8px 0 0">נרשמים רק עובדים (לא מנהלים). העובד לא מקבל הודעה על כך. הנתונים נשמרים ואינם נמחקים.${AL.cfgErr&&on!==null?' '+E(AL.cfgErr):''}</p></div>
 <div class="sec"><h3>עובדים</h3></div>${empList()}`;
 if(AL.emp){const t=today();if(!AL.from){AL.from=AL.to=t}
  h+=`<div class="sec"><h3>${E(who(AL.emp))}</h3></div><div class="card"><div class="row" style="gap:6px;flex-wrap:wrap"><button class="btn s g" data-a="alRng" data-n="0">היום</button><button class="btn s g" data-a="alRng" data-n="1">אתמול</button><button class="btn s g" data-a="alRng" data-n="7">7 ימים</button><button class="btn s g" data-a="alRng" data-n="30">30 ימים</button></div>
  <div class="row" style="gap:8px;margin-top:8px;flex-wrap:wrap"><label style="flex:1;min-width:130px">מתאריך<input type="date" data-c="alFrom" value="${AL.from}" max="${t}" style="width:100%"></label><label style="flex:1;min-width:130px">עד תאריך<input type="date" data-c="alTo" value="${AL.to}" max="${t}" style="width:100%"></label></div>
  <p class="note" style="margin:6px 0 0">עד ${MAXDAYS} ימים בכל פעם. השעות לפי שעון ישראל.</p></div>`;
  h+=AL.busy?'<div class="empty">טוען…</div>':AL.err?`<div class="empty">${E(AL.err)}</div>`:AL.data?report():'<button class="btn" style="width:100%" data-a="alGo">הצג יומן</button>'}
 return{t:T,s:'מנהל',h}};
ACT.alEmp=el=>{AL.emp=el.dataset.u;AL.data=null;AL.err='';if(!AL.from)AL.from=AL.to=today();alLoad()};
ACT.alGo=()=>alLoad();
ACT.alRng=el=>{const n=+el.dataset.n,t=today();AL.to=n===1?addD(t,-1):t;AL.from=n===0?t:n===1?addD(t,-1):addD(t,-(n-1));alLoad()};
CHG.alFrom=el=>{if(/^\d{4}-\d{2}-\d{2}$/.test(el.value)){AL.from=el.value;if(AL.to<AL.from)AL.to=AL.from;if(AL.to>addD(AL.from,MAXDAYS-1))AL.to=addD(AL.from,MAXDAYS-1);alLoad()}};
CHG.alTo=el=>{if(/^\d{4}-\d{2}-\d{2}$/.test(el.value)){AL.to=el.value;if(AL.from>AL.to)AL.from=AL.to;if(AL.from<addD(AL.to,-(MAXDAYS-1)))AL.from=addD(AL.to,-(MAXDAYS-1));alLoad()}};
CHG.alOn=async el=>{const v=el.checked;if(AL.cfgBusy)return;AL.cfgBusy=1;AL.cfgErr='';
 try{await fsx('/cfg/act',{method:'PATCH',body:JSON.stringify({fields:{on:bv(v),by:sv_(typeof fbBy==='function'?fbBy():''),at:iv_(Date.now())}})});AL.cfgOn=v;toast(v?'המעקב הופעל':'המעקב כובה')}
 catch(e){AL.cfgErr=e&&e.code===403?'אין הרשאה לשנות (הכללים עוד לא פורסמו)':'השמירה נכשלה'}
 AL.cfgBusy=0;if(cur_()==='actLog')rerender()};
/* כניסה: ב"עוד" (מנהל), באותו דפוס של יומן ההכנסות וההוצאות */
{const o=V.more;if(typeof o==='function')V.more=function(){const r=o.apply(this,arguments);try{if(isAd()&&r&&typeof r.h==='string'&&r.h.includes('<div class="mlist">'))r.h=r.h.replace('<div class="mlist">',`<div class="mlist"><button class="opt" data-a="go" data-v="actLog"><span>יומן שימוש בעובדים<small>מי מחובר, מתי נכנס ובאילו מסכים</small></span>${typeof ico==='function'?ico('chev'):''}</button>`)}catch(e){}return r}}
})();
