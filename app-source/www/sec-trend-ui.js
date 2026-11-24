/* גיטי – לשונית "ניתוחים" במסך המזכירה (24.11.2026, "גיטי מנהלת עסק", סבב 4 חלק ב). נטען אחרי sec-hub.js ו-sec-trend.js. קריאה בלבד – לא כותב שום נתון.
   1. הוצאות חריגות (30% ומעלה מעל ממוצע 3 החודשים הקודמים של אותו ספק/קטגוריה, וגם מעל 200 ₪).
   2. כדאי להזמין – לפי קצב החשבוניות הקודמות מכל ספק סחורה. הצעה בלבד: אין כאן כפתור ששולח או יוצר הזמנה.
   3. מגמות לפי קטגוריה / ספק, הוצאות / הכנסות: החודש מול החודש הקודם ומול אותו חודש אשתקד, 12 חודשים אחורה.
   הנתונים: secFin (secretary.js – אותם סכומים כמו במסכי ההכנסות וההוצאות, כל העסק) והחישוב ב-SecTrend (sec-trend.js – אותו קובץ כמו בשרת).
   מחושב פעם אחת וחוזר רק אחרי שמירה (wvSched) – לא בכל רינדור. בלי נתונים: "אין מספיק נתונים" (לא נתוני דוגמה). עיצוב: רק משתני הערכה. */
(function(root){
'use strict';
if(typeof ACT==='undefined'||typeof CHG==='undefined')return;
const X=root.__sec,TABS=root.__secTabs,HUB=root.__secHub,TR=root.SecTrend;
if(!X||!Array.isArray(TABS)||!HUB||!HUB.tabs||!TR)return;
{const i=TABS.findIndex(x=>x[0]==='hlog');if(!TABS.some(x=>x[0]==='trend'))TABS.splice(i<0?TABS.length:i+1,0,['trend','ניתוחים'])}
const C={dirty:1,fin:null,at:0,an:[],tips:[],tk:'',tr:null,mon:'',by:'cat',kind:'e',all:0};
/* אחרי כל שמירה – החישוב יתבצע מחדש בפעם הבאה שהלשונית מוצגת */
{const w=root.wvSched;if(typeof w==='function')root.wvSched=function(){const r=w.apply(this,arguments);C.dirty=1;return r}}
/* גם בלי שמירה (נתונים שהגיעו בסנכרון) – לכל היותר פעם ב-10 דקות */
function load(){if(!C.dirty&&Date.now()-C.at<600000)return;C.dirty=0;C.tk='';C.tr=null;
 try{C.fin=typeof root.secFin==='function'?root.secFin({}):null}catch(e){C.fin=null}
 C.at=Date.now();const td=today();
 try{C.an=C.fin?TR.anomalies(C.fin,{today:td}):[];C.tips=C.fin?TR.orderTips(C.fin,{today:td}):[]}catch(e){C.an=[];C.tips=[]}}
function trd(){const k=[C.mon,C.by,C.kind].join('|');if(C.tk!==k||!C.tr){C.tk=k;C.tr=TR.trends(C.fin,{month:C.mon,today:today(),by:C.by,kind:C.kind})}return C.tr}
const pc=p=>p===null||p===undefined?'':' (<bdi dir="ltr">'+(p>0?'+':'')+p+'%</bdi>)';
const tm=t=>{try{const d=new Date(t);return d.toLocaleDateString('he-IL',{day:'numeric',month:'numeric'})+' '+d.toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'})}catch(e){return ''}};
const chip=(a,v,on,l)=>`<button type="button" class="chip${on?' on':''}" data-a="${a}" data-v="${v}" style="min-height:44px" aria-pressed="${on}">${l}</button>`;
function anH(){const m0=NOWM(),f=C.fin&&TR.trends(C.fin,{today:today(),limit:1}).firstMonth;
 const few=!f||TR.addMon(m0,-4)<f;/* גם לחודש הקודם אין 3 חודשים לפניו */
 const rows=C.an.map(x=>`<div class="li"><div class="m"><b>${esc(x.name)}</b><small>${x.by==='sup'?'ספק':'קטגוריה'}${x.cat?' · '+esc(x.cat):''} · ${esc(mfmt(x.month))} · ממוצע 3 חודשים: ${ils(x.avg3)}</small></div><div class="a">${ils(x.amount)}<small><bdi dir="ltr">+${x.overPct}%</bdi></small></div></div>`).join('');
 return `<div class="card" id="secTrAn"><b>הוצאות חריגות</b><p class="note" style="margin:4px 0">הוצאה חודשית לספק או לקטגוריה שגבוהה ב-${TR.PCT}% לפחות מהממוצע של 3 החודשים הקודמים, וגם מעל ${TR.MIN} ₪. זיכויים מורידים את הסכום. ספק חדש, בלי היסטוריה – לא נחשב חריג.</p>
 ${rows||`<div class="empty">${few&&!C.an.length?'אין מספיק נתונים (צריך לפחות 3 חודשים של הוצאות)':'לא נמצאו הוצאות חריגות החודש ובחודש הקודם'}</div>`}</div>`}
function ordH(){const has=!!(C.fin&&Array.isArray(C.fin.ord));
 const rows=C.tips.map(x=>`<div class="li"><div class="m"><b>כדאי להזמין מ${esc(x.name)}</b><small>בדרך כלל כל ${x.every} ימים · האחרונה לפני ${x.daysSince} ימים (${esc(dfmt(x.lastDate))}) · ${x.orders} חשבוניות בשנה</small></div>${x.late?'<div class="a"><small class="sectags">עבר הזמן הרגיל</small></div>':''}</div>`).join('');
 return `<div class="card" id="secTrOrd"><b>כדאי להזמין</b><p class="note" style="margin:4px 0">לפי קצב החשבוניות הקודמות מכל ספק. הצעה בלבד – גיטי לא שולחת הזמנות. הזמנה מספק תמיד באישור שלך.</p>
 ${rows||`<div class="empty">${has?'אין כרגע ספק שהגיע הזמן להזמין ממנו':'אין מספיק נתונים'}</div>`}</div>`}
function trH(){const r=trd();if(r.error)return `<div class="card"><div class="empty">אין מספיק נתונים</div></div>`;
 const mons=r.months.slice().reverse(),T=r.totals,tot=k=>(T.find(x=>x.month===k)||{})[C.kind==='i'?'income':'expenses']||0,M=C.fin.months||{};
 const cur=tot(r.month),pv=tot(r.prevMonth),ly=M[r.lastYearMonth]?(M[r.lastYearMonth][C.kind==='i'?'inc':'exp']||0):null;
 const sel=`<label class="note" style="display:flex;align-items:center;gap:6px">חודש <select data-c="trMon" style="min-height:44px">${mons.map(m=>`<option value="${m}"${m===r.month?' selected':''}>${esc(mfmt(m))}</option>`).join('')}</select></label>`;
 const noSup=C.by==='sup'&&!r.hasSup;
 const L=C.all?r.rows:r.rows.slice(0,30);
 const rows=noSup?'<div class="empty">אין מספיק נתונים לפי ספק</div>':L.length?L.map(x=>`<div class="li"><div class="m"><b>${esc(x.name)}</b><small>חודש קודם: ${ils(x.prevMonth)}${pc(x.vsPrevPct)} · אשתקד: ${M[r.lastYearMonth]?ils(x.lastYear)+pc(x.vsLastYearPct):'אין נתונים'}</small></div><div class="a">${ils(x.month)}</div></div>`).join(''):'<div class="empty">אין מספיק נתונים לחודש הזה</div>';
 return `<div class="card" id="secTrT"><b>מגמות</b>
 <div class="secrow" style="flex-wrap:wrap;align-items:center;gap:6px">${sel}${chip('trBy','cat',C.by==='cat','קטגוריות')}${chip('trBy','sup',C.by==='sup','ספקים')}${chip('trKind','e',C.kind==='e','הוצאות')}${chip('trKind','i',C.kind==='i','הכנסות')}</div>
 <p class="note" style="margin:6px 0">${C.kind==='i'?'הכנסות':'הוצאות'} ב${esc(mfmt(r.month))}: <b>${ils(cur)}</b> · מול ${esc(mfmt(r.prevMonth))}: ${ils(pv)}${pc(TR.pct(cur,pv))} · מול ${esc(mfmt(r.lastYearMonth))}: ${ly===null?'אין נתונים':ils(ly)+pc(TR.pct(cur,ly))}</p>
 ${rows}${!noSup&&r.rows.length>30?`<button type="button" class="chip" data-a="trAll" style="min-height:44px">${C.all?'פחות':'הכול ('+r.rows.length+')'}</button>`:''}</div>`}
function trendH(){load();
 if(!C.fin)return `<div class="card" id="secTr"><b>ניתוחים</b><div class="empty">אין מספיק נתונים. הניתוחים מחושבים מהנתונים שבמכשיר הזה, ורק למנהל שרואה את כל העסק.</div></div>`;
 return `<div id="secTr"><div class="card"><b>ניתוחים</b><small class="note" style="display:block">מקור: נתוני האפליקציה במכשיר הזה · נכון ל-${esc(tm(C.at))}</small></div>${anH()}${ordH()}${trH()}</div>`}
HUB.tabs.trend={s:'ניתוחים',h:trendH};
ACT.trBy=el=>{C.by=el.dataset.v==='sup'?'sup':'cat';C.all=0;rerender()};
ACT.trKind=el=>{C.kind=el.dataset.v==='i'?'i':'e';C.all=0;rerender()};
ACT.trAll=()=>{C.all=!C.all;rerender()};
CHG.trMon=el=>{C.mon=/^\d{4}-\d{2}$/.test(el.value)?el.value:'';C.all=0;rerender()};
root.__secTrend={C,load};
})(typeof window!=='undefined'?window:this);
