/* הערות עובד (שלב א', משימה 2026-11-19_תנאי-שכר-והערות-עובד). קובץ עצמאי, נטען אחרי payroll-psl.js.
   index.html קורא ל-enotesH(s) בכרטיס עובד (קטגוריה beh==='emp'): רשימת הערות + הוספה/עריכה/מחיקה + "הוספה לכמה עובדים".
   נשמר ב-S.enotes: [{id, sub, t, d, at, ed?, ox?}]
     sub – כרטיס העובד; t – טקסט (חובה, עד 2000 תווים); d – תאריך ההערה (YYYY-MM-DD, ברירת מחדל היום); at – זמן יצירה (ISO);
     ed – זמן עריכה אחרונה (ISO); ox:1 – הערה שהועברה אוטומטית מ-ext.notes (ensure ב-index.html; ext.notes עצמו לא משתנה).
   מנהל בלבד (כמו payroll.js): לעובד לא מוצג כלום. ההערות לא נשלחות לענף העובדים (wvWant/pubCfg), לא לתלוש ולא למזכירה; כן בגיבוי (S כולו).
   מחיקת כרטיס עובד שיש לו הערות – חסומה (כמו תלושים, pslSubN); קודם מוחקים את ההערות, או מסתירים את הכרטיס.
   רכיבי העיצוב הקיימים בלבד (.card .btn .li .tag .cb .f .note .row).
   משתמש ב: S, ACT, FRM, isA, isW, subById, cat, save, dlg, closeDlg, ask, toast, rerender, esc, uid, today, dfmt, subsOf, catsOf. */
(function(){
'use strict';
if(typeof ACT==='undefined'||typeof FRM==='undefined'||typeof isA!=='function'||typeof subById!=='function'||typeof save!=='function'||typeof dlg!=='function')return;
const on=()=>{try{return isA()&&!(typeof isW==='function'&&isW())}catch(e){return false}};
const MAXT=2000;
const empOf=id=>{try{const s=subById(id);return s&&(cat(s.cat)||{}).beh==='emp'?s:null}catch(e){return null}};
const dOk=v=>/^\d{4}-\d{2}-\d{2}$/.test(String(v||''));
const arr=()=>Array.isArray(S.enotes)?S.enotes:(S.enotes=[]);
const notesOf=sid=>arr().filter(n=>n&&n.sub===sid).sort((a,b)=>String(b.d||'').localeCompare(String(a.d||''))||String(b.at||'').localeCompare(String(a.at||'')));
const edLine=iso=>{const t=String(iso||'');return dOk(t.slice(0,10))?dfmt(t.slice(0,10))+(/T\d\d:\d\d/.test(t)?' '+new Date(t).toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'}):''):''};
window.enotesN=sid=>{try{return arr().filter(n=>n&&n.sub===sid).length}catch(e){return 0}};
const TA=(v)=>`<label class="f"><span>הערה</span><textarea name="t" rows="5" maxlength="${MAXT}" required>${esc(v||'')}</textarea></label>`;
const DF=(v)=>`<label class="f"><span>תאריך</span><input name="d" type="date" value="${esc(v)}" required></label>`;

window.enotesH=s=>{try{if(!on()||!s||!empOf(s.id))return'';
 const L=notesOf(s.id);
 return `<div class="sec" data-enotes="${esc(s.id)}">הערות על העובד</div><div class="card">${L.length?L.map(n=>`<div class="li" style="align-items:flex-start;flex-wrap:wrap" data-enote="${esc(n.id)}"><div class="m" style="min-width:0;flex:1 1 100%"><small>${esc(dfmt(n.d))}${n.ox?' · הועבר מהכרטיס הקודם':''}${n.ed?' · נערך ב־'+esc(edLine(n.ed)):''}</small><div style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(n.t)}</div></div><div class="row" style="flex:1 1 100%"><button class="btn g grow" data-a="enEdit" data-id="${esc(n.id)}">עריכה</button><button class="btn r grow" data-a="enDel" data-id="${esc(n.id)}">מחיקה</button></div></div>`).join(''):'<p class="note">אין הערות</p>'}<div class="row" style="margin-top:8px"><button class="btn grow" data-a="enAdd" data-id="${esc(s.id)}">הוספת הערה</button><button class="btn g grow" data-a="enMulti" data-id="${esc(s.id)}">לכמה עובדים</button></div></div>`}catch(e){return''}};

/* הוספה / עריכה (id של הערה ← עריכה; אחרת id של עובד ← חדשה) */
const form=(sid,n)=>dlg(`<h3>${n?'עריכת הערה':'הוספת הערה'} · ${esc((subById(sid)||{}).name||'')}</h3><form data-f="enF"><input type="hidden" name="sub" value="${esc(sid)}"><input type="hidden" name="id" value="${esc(n?n.id:'')}">${TA(n&&n.t)}${DF(n&&dOk(n.d)?n.d:today())}<div class="row"><button class="btn grow">שמירה</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`);
ACT.enAdd=el=>{if(!on())return;const s=empOf(el.dataset.id);if(s)form(s.id,null)};
ACT.enEdit=el=>{if(!on())return;const n=arr().find(x=>x&&x.id===el.dataset.id);if(n&&empOf(n.sub))form(n.sub,n)};
const chk=(t,d)=>{t=String(t==null?'':t).trim();if(!t)return'כתוב את ההערה';if(t.length>MAXT)return'ההערה ארוכה מדי (עד '+MAXT+' תווים)';if(!dOk(d))return'תאריך לא תקין';return''};
FRM.enF=f=>{if(!on())return closeDlg();const x=Object.fromEntries(new FormData(f).entries()),e=chk(x.t,x.d);if(e)return toast(e);
 if(x.id){const n=arr().find(z=>z&&z.id===x.id);if(!n)return closeDlg();n.t=String(x.t).trim();n.d=x.d;n.ed=new Date().toISOString()}
 else{if(!empOf(x.sub))return closeDlg();arr().push({id:uid(),sub:x.sub,t:String(x.t).trim(),d:x.d,at:new Date().toISOString()})}
 save();closeDlg();rerender();toast('נשמר')};
ACT.enDel=el=>{if(!on())return;const id=el.dataset.id;if(!arr().some(x=>x&&x.id===id))return;ask('למחוק את ההערה?',()=>{S.enotes=arr().filter(x=>!(x&&x.id===id));save();rerender();toast('נמחק')},'מחק')};

/* הוספת הערה לכמה עובדים: רשומה נפרדת לכל כרטיס שנבחר */
ACT.enMulti=el=>{if(!on())return;const cur=el.dataset.id,E=S.subs.filter(x=>!x.off&&empOf(x.id)).sort((a,b)=>String(a.name).localeCompare(String(b.name),'he'));
 if(!E.length)return toast('אין עובדים');
 dlg(`<h3>הוספת הערה לכמה עובדים</h3><form data-f="enMF">${E.map(x=>`<label class="cb"><input type="checkbox" name="s" value="${esc(x.id)}" ${x.id===cur?'checked':''}> ${esc(x.name)}</label>`).join('')}${TA('')}${DF(today())}<p class="note">תיווצר הערה נפרדת בכרטיס של כל עובד שנבחר.</p><div class="row"><button class="btn grow">הוספה</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div></form>`)};
FRM.enMF=f=>{if(!on())return closeDlg();const fdt=new FormData(f),ids=[...new Set(fdt.getAll('s'))].filter(empOf),t=fdt.get('t'),d=fdt.get('d'),e=chk(t,d);
 if(!ids.length)return toast('בחר לפחות עובד אחד');if(e)return toast(e);
 const at=new Date().toISOString(),tx=String(t).trim();ids.forEach(sid=>arr().push({id:uid(),sub:sid,t:tx,d,at}));
 save();closeDlg();rerender();toast('נוספה הערה ל־'+ids.length+' עובדים')};

/* מחיקת כרטיס עובד עם הערות – חסומה (כמו תלושים) */
if(typeof ACT.subDel==='function'){const o=ACT.subDel;ACT.subDel=function(el){const id=el&&el.dataset&&el.dataset.id;if(id&&window.enotesN(id))return toast('לכרטיס יש הערות – אי אפשר למחוק אותו. מחק קודם את ההערות, או הסתר את הכרטיס.');return o.apply(this,arguments)}}
})();
