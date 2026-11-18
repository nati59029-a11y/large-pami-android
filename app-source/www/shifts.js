/* משמרות (שלב 3, 18.11.2026). קובץ עצמאי, נטען אחרי index.html. כבוי (בלי תוספת המשימות) = לא מוסיף כלום לשום מסך.
   V.shf – טבלה שבועית: עמודה לכל יום, משמרות לפי שעה, "חור" (זמן בלי עובדים בשעות הפעילות) באדום, גלילה לצד במסך צר.
     מנהל ועובד עם הרשאת "משמרות" (perms.shf): רואים הכול, מוסיפים/עורכים/מוחקים, ושולחים משימות לעובד שבמשמרת.
     עובד בלי ההרשאה: רואה רק את המשמרות שלו.
   יצירה/עריכה: שואלים "משמרת קבועה?" (כל שבוע באותו יום ושעות). עריכה/מחיקה של מופע במשמרת קבועה: "רק הפעם" / "מכאן והלאה"
   (רק מהיום והלאה; ב"מכאן והלאה" התאריך לא לפני המופע). משימה שלא נשלחה (המשמרת השתנתה / אין עובד) – באדום ביום שלה, עם מחיקה.
   שעת סיום מוקדמת משעת ההתחלה = משמרת שחוצה חצות (20:00–02:00).
   V.shfCfg – הגדרות מנהל: סף איחור, שעת ההתראה היומית, שעות פעילות לכל יום, וטבלת התאמה "עובד בכספית ← משתמש".
   כל קריאה וכתיבה – רק דרך shApi בשרת (functions/shifts.js), שגם אוכף את ההרשאות. כאן רק מה מוצג.
   רכיבי העיצוב הקיימים (.card .btn .chip .f .note .empty .tag .row), משתני ערכת הנושא בלבד.
   משתמש ב: V, ACT, FRM, CHG, fnCall, esc, toast, dlg, closeDlg, ask, go, cur, rerender, isA, isW, bzF, SY, ico, fd. */
(function(){
'use strict';
if(typeof ACT==='undefined'||typeof V==='undefined')return;
const fnCall=(n,d)=>{d=d&&typeof d==='object'?d:{};if(SY&&SY.sa&&SY.bizId&&!('bizId'in d))d=Object.assign({bizId:SY.bizId},d);return window.fnCall(n,d)};
const on=()=>{try{return bzF('tasks')&&!SY.mg&&(isA()||isW()||!!SY.sa)}catch(e){return false}};
const mgr=()=>isA()||!!(SY&&SY.sa);
const DN=['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
const S={w:null,from:'',err:'',ld:0,cfg:null,cf:null,cerr:''};
const err=e=>toast(e&&e.message||'הפעולה נכשלה');
const big='style="min-height:48px"';
const dm=d=>/^\d{4}-\d{2}-\d{2}$/.test(d||'')?(+d.slice(8))+'.'+(+d.slice(5,7)):'';
const dow=d=>new Date(d+'T12:00:00Z').getUTCDay();
const addD=(d,n)=>{const t=new Date(d+'T12:00:00Z');t.setUTCDate(t.getUTCDate()+n);return t.toISOString().slice(0,10)};
const hm=v=>/^([01]\d|2[0-3]):[0-5]\d$/.test(v||'');
const occOf=id=>((S.w&&S.w.occ)||[]).find(o=>o.id===id)||null;
const nmOf=u=>{const s=((S.w&&S.w.staff)||[]).find(x=>x.uid===u);return s?s.name:''};
/* ברירת מחדל מוצעת לשעות הפעילות (לא נשמרת עד שהמנהל שומר): א'–ה' 08:00–20:00, ו' 08:00–14:00, שבת סגור */
const HRS0=[0,1,2,3,4,5,6].map(i=>i<5?{s:'08:00',e:'20:00'}:i===5?{s:'08:00',e:'14:00'}:null);

{const st=document.createElement('style');st.textContent=`.shw{overflow-x:auto;-webkit-overflow-scrolling:touch;max-width:100%;padding-bottom:4px}
.shg{display:grid;grid-template-columns:repeat(7,minmax(118px,1fr));gap:6px;min-width:850px}
.shd{display:flex;flex-direction:column;gap:6px;min-width:0}
.shd>h4{margin:0;padding:6px 4px;text-align:center;border-bottom:2px solid var(--line);font-size:.95rem}
.shd.td>h4{border-color:var(--acc);color:var(--acc)}
.shc{display:block;width:100%;min-height:48px;text-align:start;padding:6px 8px;border-radius:var(--r-s,10px);border:1.5px solid var(--acc);background:var(--card);color:var(--ink);cursor:pointer;font:inherit;line-height:1.3}
.shc b{display:block;direction:ltr;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.shc small{display:block;color:var(--mut);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.shc.op{border-style:dashed;border-color:var(--warn)}
.shh{padding:6px 8px;border-radius:var(--r-s,10px);border:1.5px dashed var(--bad);color:var(--bad);font-size:.85rem;font-weight:600}
.shh span{direction:ltr;display:inline-block}`;document.head.appendChild(st)}

async function load(){if(S.ld)return;S.ld=1;try{const d={op:'week'};if(S.from)d.from=S.from;S.w=await fnCall('shApi',d);S.from=S.w.from;S.err=''}catch(e){S.err=e&&e.message||'הטעינה נכשלה'}S.ld=0;if(cur().v==='shf'&&!document.querySelector('#dlg[open]')){rerender();/* מסך צר: גלילה לעמודה של היום */try{const t=document.querySelector('.shd.td'),w=document.querySelector('.shw');if(t&&w)w.scrollLeft+=t.getBoundingClientRect().left-w.getBoundingClientRect().left-(w.clientWidth-t.clientWidth)/2}catch(e){}}}
const reload=()=>{S.w=null;S.err='';load()};

/* ---------- הטבלה השבועית ---------- */
function chip(o,w){const n=((w.tasks||{})[o.id]||[]).length,nm=o.u?(o.nm||nmOf(o.u)||'עובד'):'בלי עובד';
 return `<button class="shc${o.u?'':' op'}" data-a="shOpen" data-k="${esc(o.id)}"><b>${esc(o.s)}–${esc(o.e)}${o.x?' ☾':''}</b><small>${esc(nm)}</small>${o.fx||n?`<small>${o.fx?'🔁 קבועה':''}${o.fx&&n?' · ':''}${n?'📋 '+n+' משימות':''}</small>`:''}</button>`}
V.shf=()=>{const T='משמרות';if(!on())return{t:T,h:'<div class="empty">המסך זמין כשתוספת המשימות פעילה</div>'};
 if(!S.w&&!S.err)load();const w=S.w;
 if(S.err)return{t:T,h:`<div class="card"><p class="note">${esc(S.err)}</p><button class="btn g w" ${big} data-a="shRe">נסו שוב</button></div>`};
 if(!w)return{t:T,h:'<div class="empty">טוען…</div>'};
 const full=!!w.full;
 let h=`<div class="row" style="margin-bottom:8px"><button class="btn g grow" ${big} data-a="shWk" data-v="-7" aria-label="שבוע קודם">› הקודם</button><button class="btn g grow" ${big} data-a="shWk" data-v="0">השבוע</button><button class="btn g grow" ${big} data-a="shWk" data-v="7" aria-label="שבוע הבא">הבא ‹</button></div>`;
 h+=`<p class="note" style="margin:0 0 8px;text-align:center"><b>${dm(w.days[0])} – ${dm(w.days[6])}</b>${full?'':' · המשמרות שלך'}</p>`;
 if(full)h+=`<div class="row" style="margin-bottom:8px"><button class="btn grow" ${big} data-a="shNew">+ משמרת</button>${w.mgr?`<button class="btn g grow" ${big} data-a="go" data-v="shfCfg">הגדרות</button>`:''}</div>`;
 if(full&&w.mgr&&!w.hrs)h+='<p class="note">כדי לקבל כל בוקר התראה על זמנים בלי עובדים – הגדירו שעות פעילות ב"הגדרות".</p>';
 h+='<div class="shw" role="region" aria-label="טבלת משמרות שבועית" tabindex="0"><div class="shg">';
 for(const d of w.days){const L=w.occ.filter(o=>o.day===d),H=(w.holes||{})[d]||[],X=(w.orph||[]).filter(t=>t.day===d);
  h+=`<div class="shd${d===w.today?' td':''}"><h4>${DN[dow(d)]}<br><small>${dm(d)}</small></h4>${L.map(o=>chip(o,w)).join('')}${H.map(x=>`<div class="shh">אין עובדים <span>${esc(x[0])}–${esc(x[1])}</span></div>`).join('')}${X.map(t=>`<div class="shh" role="alert">⚠ משימה שלא נשלחה (${t.why==='no-user'||t.why==='inactive'?'אין עובד פעיל במשמרת':'המשמרת השתנתה'}): ${esc(t.txt)}<button class="btn s g" style="min-height:44px;width:100%;margin-top:4px" data-a="shTDel" data-k="${esc(t.id)}">מחיקה</button></div>`).join('')}${!L.length&&!H.length&&!X.length?'<p class="note" style="text-align:center;margin:4px 0">—</p>':''}</div>`}
 h+='</div></div>';
 if(!w.occ.length)h+=`<p class="empty">${full?'אין משמרות בשבוע הזה. "+ משמרת" כדי להוסיף.':'אין לך משמרות בשבוע הזה.'}</p>`;
 h+='<p class="note">☾ = המשמרת נגמרת אחרי חצות. 🔁 = משמרת קבועה (כל שבוע).</p>';
 return{t:T,s:full?'טבלה שבועית':'המשמרות שלי',h}};
ACT.shRe=()=>reload();
ACT.shWk=el=>{const n=+el.dataset.v;const base=S.w?S.w.from:'';S.from=n&&base?addD(base,n):'';reload();rerender()};

/* ---------- לחיצה על משמרת: פרטים, משימות, עריכה, מחיקה ---------- */
ACT.shOpen=el=>{const o=occOf(el.dataset.k),w=S.w;if(!o||!w)return;
 const nm=o.u?(o.nm||nmOf(o.u)||'עובד'):'בלי עובד',L=(w.tasks||{})[o.id]||[],ended=o.end<=Date.now();
 let h=`<h3>${esc(nm)} · יום ${DN[dow(o.day)]} ${dm(o.day)}</h3><p class="note" style="margin-top:0"><span dir="ltr">${esc(o.s)}–${esc(o.e)}</span>${o.x?' (נגמרת למחרת)':''} · ${o.fx?'משמרת קבועה (כל שבוע)':'משמרת חד־פעמית'}${o.nt?'<br>'+esc(o.nt):''}</p>`;
 if(!w.full)return dlg(h+`<button class="btn g w" ${big} data-a="closeDlg">סגור</button>`);
 h+=`<h4 style="margin:12px 0 4px">משימות למשמרת</h4>${L.length?L.map(t=>`<div class="li" style="cursor:default;min-height:48px"><div class="m"><b style="white-space:pre-wrap;font-weight:500">${esc(t.txt)}</b><small>${t.st==='wait'?'<span class="tag t1">ממתינה – תוצג לעובד בתחילת המשמרת</span>':'<span class="tag t3">נשלחה לעובד</span>'}</small></div>${t.st==='wait'?`<button class="btn s g" style="min-height:44px" data-a="shTDel" data-k="${esc(t.id)}" aria-label="מחיקת משימה">מחיקה</button>`:''}</div>`).join(''):'<p class="note">עוד אין משימות.</p>'}`;
 if(!o.u)h+='<p class="note">אין עובד במשמרת – קודם בחרו עובד (עריכה) ואז שלחו משימות.</p>';
 else if(ended)h+='<p class="note">המשמרת הסתיימה.</p>';
 else h+=`<form data-f="shTaskF" data-k="${esc(o.id)}" style="margin-top:8px"><label class="f"><span>משימה חדשה ל${esc(nm)}</span><textarea name="txt" rows="2" maxlength="500" required placeholder="למשל: לסדר את מדף החלב"></textarea></label><button class="btn w" ${big}>שליחה ${o.start<=Date.now()?'עכשיו':'– תוצג בתחילת המשמרת'}</button></form>`;
 h+=o.day<w.today?`<p class="note">משמרת שעברה – אי אפשר לשנות.</p><button class="btn g w" ${big} data-a="closeDlg">סגור</button>`:`<div class="row" style="margin-top:12px"><button class="btn g grow" ${big} data-a="shEdit" data-k="${esc(o.id)}">עריכה</button><button class="btn g grow" ${big} data-a="shDel" data-k="${esc(o.id)}">מחיקה</button><button class="btn g grow" ${big} data-a="closeDlg">סגור</button></div>`;
 dlg(h)};
FRM.shTaskF=async f=>{const occ=f.dataset.k,txt=String(fd(f).txt||'').trim();if(!txt)return toast('כתבו משימה');if(txt.length>500)return toast('עד 500 תווים');
 const b=f.querySelector('button');b.disabled=true;
 try{const r=await fnCall('shApi',{op:'task',occ,txt});toast(r.st==='rel'?'המשימה נשלחה לעובד':r.st==='orph'?'המשימה לא נשלחה – אין עובד פעיל במשמרת':'נשמר – העובד יראה את המשימה בתחילת המשמרת');closeDlg();reload()}catch(e){b.disabled=false;err(e)}};
ACT.shTDel=el=>{const id=el.dataset.k;ask('למחוק את המשימה?',async()=>{try{await fnCall('shApi',{op:'taskDel',id});toast('נמחקה');closeDlg();reload()}catch(e){err(e)}},'כן, מחק')};

/* טופס משמרת: חדשה (o = null) או עריכה. "משמרת קבועה?" – חובה לבחור */
function formH(o){const w=S.w,st=(w&&w.staff)||[],d=o?o.day:(w&&w.days&&w.days.includes(w.today)?w.today:w.days[0]);
 const fx=o?(o.fx?'1':'0'):'';
 const rad=(v,t)=>`<label class="chip" style="min-height:48px"><input type="radio" name="fx" value="${v}" required${fx===v?' checked':''}> ${t}</label>`;
 return `<h3>${o?'עריכת משמרת':'משמרת חדשה'}</h3><form data-f="shSaveF" data-k="${o?esc(o.id):''}">
 <label class="f"><span>עובד</span><select name="u" style="min-height:48px"><option value="">— בלי עובד (משמרת פתוחה) —</option>${st.map(s=>`<option value="${esc(s.uid)}"${o&&o.u===s.uid?' selected':''}>${esc(s.name)}${s.mgr?' (מנהל)':''}</option>`).join('')}</select></label>
 <label class="f"><span>תאריך</span><input type="date" name="d" required value="${esc(d)}"${o?` min="${esc(w.today)}"`:''} style="min-height:48px"></label>
 <div class="row"><label class="f grow"><span>משעה</span><input type="time" name="s" required value="${esc(o?o.s:'08:00')}" style="min-height:48px"></label><label class="f grow"><span>עד שעה</span><input type="time" name="e" required value="${esc(o?o.e:'14:00')}" style="min-height:48px"></label></div>
 <p class="note" style="margin-top:0">שעת סיום מוקדמת משעת ההתחלה = המשמרת נגמרת למחרת (למשל 20:00–02:00).</p>
 <div class="f"><span>משמרת קבועה?</span><div class="chips" role="radiogroup" style="margin:4px 0;display:flex;flex-wrap:wrap;gap:6px">${rad('1','כן – כל שבוע באותו יום ושעות')}${rad('0','לא – רק בתאריך הזה')}</div></div>
 <label class="f"><span>הערה (לא חובה)</span><input name="nt" maxlength="200" value="${esc(o?o.nt:'')}" style="min-height:48px"></label>
 <div class="row" style="margin-top:8px"><button class="btn grow" ${big}>שמירה</button><button type="button" class="btn g grow" ${big} data-a="closeDlg">ביטול</button></div></form>`}
ACT.shNew=()=>{if(!S.w||!S.w.full)return;dlg(formH(null))};
ACT.shEdit=el=>{const o=occOf(el.dataset.k);if(o)dlg(formH(o))};
const sidOf=o=>o.sid||o.id.slice(0,o.id.length-11);
async function saveRun(data,b){try{await fnCall('shApi',data);toast('נשמר');closeDlg();reload()}catch(e){if(b)b.disabled=false;err(e)}}
/* שאלה: רק הפעם / מכאן והלאה (משמרת קבועה) */
function askMode(title,fn){S.mf=fn;dlg(`<h3>${esc(title)}</h3><p class="note">זו משמרת קבועה. השינוי חל:</p><div style="display:grid;gap:8px"><button class="btn" ${big} data-a="shMode" data-v="one">רק הפעם</button><button class="btn g" ${big} data-a="shMode" data-v="fwd">מכאן והלאה</button><button class="btn g" ${big} data-a="closeDlg">ביטול</button></div>`)}
ACT.shMode=el=>{const f=S.mf;S.mf=null;if(f)f(el.dataset.v==='fwd'?'fwd':'one')};
FRM.shSaveF=f=>{const x=fd(f),o=f.dataset.k?occOf(f.dataset.k):null;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(x.d||''))return toast('בחרו תאריך');if(!hm(x.s)||!hm(x.e))return toast('בחרו שעות');if(x.s===x.e)return toast('שעת הסיום שווה לשעת ההתחלה');
 if(x.fx!=='1'&&x.fx!=='0')return toast('בחרו: משמרת קבועה או רק בתאריך הזה');
 const data={op:'save',u:x.u||'',d:x.d,s:x.s,e:x.e,fx:x.fx==='1',nt:String(x.nt||'').trim().slice(0,200)};
 const b=f.querySelector('button');
 if(!o){b.disabled=true;return saveRun(data,b)}
 if(S.w&&x.d<S.w.today)return toast('אפשר לשנות משמרות רק מהיום והלאה');
 data.id=sidOf(o);
 if(!o.fx){b.disabled=true;return saveRun(data,b)}
 data.day=o.day;askMode('שמירת השינוי',m=>{if(m==='fwd'&&data.d<o.day)return toast('ב"מכאן והלאה" התאריך לא יכול להיות לפני '+dm(o.day));saveRun(Object.assign(data,{mode:m}))})};
ACT.shDel=el=>{const o=occOf(el.dataset.k);if(!o)return;const id=sidOf(o);
 if(!o.fx)return ask('למחוק את המשמרת? משימות שממתינות לה יבוטלו.',()=>saveRun({op:'del',id}),'כן, מחק');
 askMode('מחיקת משמרת',m=>saveRun({op:'del',id,day:o.day,mode:m}))};

/* ---------- הגדרות מנהל ---------- */
async function cfgLoad(){try{const r=await fnCall('shApi',{op:'cfg'});S.cfg=r;const c=r.cfg||{},hr=c.hrs||HRS0;
 S.cf={late:c.late,at:c.at,sug:!c.hrs,hrs:hr.map(x=>x?{c:false,s:x.s,e:x.e}:{c:true,s:'08:00',e:'20:00'}),map:Object.entries(r.map||{}).map(([n,u])=>[n,u])};S.cerr=''}catch(e){S.cerr=e&&e.message||'הטעינה נכשלה'}
 if(cur().v==='shfCfg')rerender()}
/* קריאת הטופס (לפני הוספה/הסרה של שורה, כדי לא לאבד הקלדה) */
function cfRead(){const f=document.querySelector('form[data-f=shCfgF]'),F=S.cf;if(!f||!F)return F;const x=fd(f);
 F.late=x.late;F.at=x.at;F.hrs=F.hrs.map((h,i)=>({c:!!f.querySelector(`[name=c${i}]:checked`),s:x['s'+i]||h.s,e:x['e'+i]||h.e}));
 F.map=F.map.map((r,i)=>[String(x['mn'+i]||''),String(x['mu'+i]||'')]);return F}
V.shfCfg=()=>{const T='הגדרות משמרות';if(!on()||!mgr())return{t:T,h:'<div class="empty">ההגדרות זמינות למנהל בלבד</div>'};
 if(S.cerr)return{t:T,h:`<div class="card"><p class="note">${esc(S.cerr)}</p><button class="btn g w" ${big} data-a="shCfgRe">נסו שוב</button></div>`};
 if(!S.cf){cfgLoad();return{t:T,h:'<div class="empty">טוען…</div>'}}
 const F=S.cf,st=(S.cfg&&S.cfg.staff)||[];
 let h=`<form data-f="shCfgF"><div class="card"><h3 style="margin-top:0">התראות</h3>
 <label class="f"><span>שעת ההתראה היומית על זמנים בלי עובדים</span><input type="time" name="at" required value="${esc(F.at)}" style="min-height:48px"></label>
 <label class="f"><span>סף איחור (דקות, 0–60)</span><input type="number" name="late" inputmode="numeric" min="0" max="60" step="1" required value="${esc(String(F.late))}" style="min-height:48px"></label>
 <p class="note" style="margin-top:0">סף האיחור ישמש להתראות איחור כשהנוכחות מכספית תחובר. תזכורת לעובד נשלחת שעה לפני המשמרת. בשבת ובחג לא נשלחות התראות.</p></div>
 <div class="card"><h3 style="margin-top:0">שעות פעילות</h3>${F.sug?'<p class="note" style="margin-top:0">הצעה – עוד לא נשמרה. בלי שעות פעילות לא נשלחת התראה על זמנים בלי עובדים.</p>':''}
 ${F.hrs.map((x,i)=>`<div style="padding:6px 0;border-bottom:1px solid var(--line)"><div class="row" style="align-items:center;justify-content:space-between"><b>${DN[i]}</b><label class="cb" style="min-height:44px;display:flex;align-items:center;gap:6px"><input type="checkbox" name="c${i}" data-c="shCfgC" value="1"${x.c?' checked':''}> סגור</label></div>
 ${x.c?'':`<div class="row"><label class="f grow"><span>משעה</span><input type="time" name="s${i}" value="${esc(x.s)}" style="min-height:48px"></label><label class="f grow"><span>עד</span><input type="time" name="e${i}" value="${esc(x.e)}" style="min-height:48px"></label></div>`}</div>`).join('')}
 <p class="note">שעת סיום מוקדמת משעת הפתיחה = פתוח עד אחרי חצות.</p></div>
 <div class="card"><h3 style="margin-top:0">עובדים בכספית ← משתמשים באפליקציה</h3><p class="note" style="margin-top:0">השם בדיוק כמו בכספית. ההתאמה תשמש להשוואת הנוכחות מכספית למשמרות.</p>
 ${F.map.map((r,i)=>`<div style="padding:6px 0;border-bottom:1px solid var(--line)"><label class="f"><span>שם בכספית</span><input name="mn${i}" maxlength="60" value="${esc(r[0])}" style="min-height:48px"></label><div class="row" style="align-items:flex-end"><label class="f grow"><span>משתמש</span><select name="mu${i}" style="min-height:48px"><option value="">— בחרו —</option>${st.map(s=>`<option value="${esc(s.uid)}"${r[1]===s.uid?' selected':''}>${esc(s.name)}</option>`).join('')}</select></label><button type="button" class="btn g s" style="min-height:48px" data-a="shMapDel" data-n="${i}" aria-label="הסרת שורה">הסרה</button></div></div>`).join('')||'<p class="note">עוד אין התאמות.</p>'}
 <button type="button" class="btn g w" ${big} data-a="shMapAdd" style="margin-top:8px">+ שורה</button></div>
 <button class="btn w" ${big}>שמירת ההגדרות</button></form>`;
 return{t:T,h}};
ACT.shCfgRe=()=>{S.cerr='';S.cf=null;rerender()};
CHG.shCfgC=()=>{cfRead();rerender()};
ACT.shMapAdd=()=>{const F=cfRead();if(!F)return;if(F.map.length>=100)return toast('עד 100 שורות');F.map.push(['','']);rerender()};
ACT.shMapDel=el=>{const F=cfRead();if(!F)return;F.map.splice(+el.dataset.n,1);rerender()};
FRM.shCfgF=async f=>{const F=cfRead();if(!F)return;const late=Math.round(+F.late);
 if(!Number.isInteger(late)||late<0||late>60||String(F.late).trim()==='')return toast('סף איחור: מספר בין 0 ל-60');if(!hm(F.at))return toast('שעת התראה לא תקינה');
 const hrs=[];for(let i=0;i<7;i++){const x=F.hrs[i];if(x.c){hrs.push(null);continue}if(!hm(x.s)||!hm(x.e)||x.s===x.e)return toast('שעות לא תקינות ביום '+DN[i]);hrs.push({s:x.s,e:x.e})}
 const map={};for(const [n0,u] of F.map){const n=n0.replace(/\s+/g,' ').trim();if(!n&&!u)continue;if(!n||!u)return toast('בכל שורה בטבלת ההתאמה – שם ומשתמש');if(map[n])return toast('השם "'+n+'" מופיע פעמיים');map[n]=u}
 const b=f.querySelector('button:not([type=button])');if(b)b.disabled=true;
 try{const r=await fnCall('shApi',{op:'setCfg',late,at:F.at,hrs,map});S.cfg=r;S.cf=null;S.w=null;toast('ההגדרות נשמרו');cfgLoad()}catch(e){if(b)b.disabled=false;err(e)}};

/* כניסות: משבצת במסך ה-+ (מנהל), כפתור במסך המשימות של העובד, והתראה (k:'sh' – secretary.js) */
window.shTile=()=>on()&&mgr()?`<button class="tile" data-a="addGo" data-v="shf" style="font-size:1rem">${ico('clock')}משמרות</button>`:'';
window.shBtn=()=>on()&&isW()?`<button class="btn g" data-a="go" data-v="shf">${ico('clock')} ${SY.perms&&SY.perms.shf===true?'משמרות':'המשמרות שלי'}</button>`:'';
window.shOpen=()=>{if(!on())return;S.from='';S.w=null;S.err='';if(cur().v!=='shf')go('shf');else{load();rerender()}};
})();
