/* קופה גל 3 (19.11.2026): מסמך ללקוח עסקי בסוף מכירה – לפי כרטיס הלקוח (cust.snd). window.PosBizDoc.
   לקוח פרטי – בלי שינוי (קבלה במדפסת הקופה). לקוח עסקי (cust.wholesale, אצלנו cust.biz):
     snd.a4      – הדפסת המסמך ב-A4 במקום קבלה תרמית. דפדפן: "מדפסת A4" של המכשיר (LpPosHw.a4 – מדפסת ברירת המחדל של Windows,
                   HTML מ-PosReceipt בגודל A4). אנדרואיד: קובץ ה-PDF מהשרת (posDoc op:'pdf') בחלון ההדפסה (PdfPrint).
     snd.ch      – השרת שולח לבד מיד אחרי שהמכירה נשמרה (posSaleSend). כאן רק הודעה, ובדיקה אחרי כמה שניות אם השליחה נכשלה.
     בלי a4 ובלי ch – חלון "איך לתת את המסמך?" (A4 / וואטסאפ / מייל / שניהם / קבלה בקופה). שליחה = posDoc op:'send' (בלחיצה, auto:false).
   כשל בהדפסה או בשליחה לא מבטל את המכירה: הודעה לקופאי, ו"מכירה אחרונה" ← "הדפסת A4" / "שליחה ללקוח" (שלח שוב).
   A4 שנכשל – יוצאת קבלה במדפסת הקופה (כמו היום), כדי שהלקוח לא יישאר בלי מסמך. */
(function(root){
'use strict';
if(typeof document==='undefined')return;
const UI=()=>root.PosUI;
const CHS=['wa','mail','both'];
const CH_N={wa:'וואטסאפ',mail:'מייל',both:'וואטסאפ ומייל'};
const WHY={'no-to':'אין בכרטיס הלקוח טלפון / מייל לשליחה','bad-to':'הטלפון או המייל בכרטיס הלקוח לא תקינים','no-tpl':'אין תבנית וואטסאפ מאושרת למסמך – המנהל מגדיר אותה בהגדרות המסמכים',
 'no-wa':'וואטסאפ העסקי לא מחובר','stopped':'"עצור הכל" פעיל – שליחה אוטומטית עצורה. אפשר לשלוח בלחיצה','limit':'הגעתם למכסת הודעות הוואטסאפ היומית','rate':'נשלחו יותר מדי מיילים בשעה האחרונה – נסו מאוחר יותר',
 'no-secrets':'שליחת מייל לא מוגדרת בשרת','no-smtp':'שליחת מייל לא מוגדרת בשרת','sum-mismatch':'סכום המסמך לא תואם – פנו למנהל','no-doc':'למכירה עוד אין מסמך – נסו שוב כשהרשת תחזור'};
const whyTxt=w=>WHY[w]||'השליחה נכשלה';
const fn=(n,b)=>root.fnCall(n,b);
const errTxt=e=>{const r=e&&e.details&&e.details.reason;return(r&&WHY[r])||(e&&e.message)||'שגיאה'};
const saleId=d=>{const id=String((d&&d.id)||'');return /^K[1-9][0-9]{0,3}-[0-9]{6}$/.test(id)?id:''};
const hasDoc=d=>!!(saleId(d)&&Array.isArray(d.docs)&&d.docs.length);

/* מה לעשות בסוף המכירה. null = לקוח פרטי / בלי לקוח – כמו היום */
function plan(c){if(!c||!c.biz)return null;const s=c.snd&&typeof c.snd==='object'?c.snd:{};
 const a4=s.a4===true,ch=CHS.includes(s.ch)?s.ch:'';return{a4,ch,ask:!a4&&!ch}}
/* קבלה במדפסת הקופה – בדיוק כמו היום */
const thermal=doc=>UI().Dev.print({kind:'sale',doc});

/* ---------- A4 ---------- */
const pdfPlug=()=>{try{const C=root.Capacitor;return C&&C.isNativePlatform&&C.isNativePlatform()&&C.Plugins&&C.Plugins.PdfPrint?C.Plugins.PdfPrint:null}catch(e){return null}};
const H=()=>root.LpPosHw||null;
/* האם במכשיר הזה יש דרך להדפיס A4 */
function a4Ready(){if(pdfPlug())return true;const h=H();return!!(h&&typeof h.a4==='function'&&h.a4())}
async function a4(doc){
 if(!hasDoc(doc))return{ok:false,msg:'המסמך עוד לא התקבל מהשרת'};
 const P=pdfPlug();
 try{
  if(P){const r=await fn('posDoc',{op:'pdf',sale:saleId(doc)});for(const f of(r&&r.files)||[])await P.print({name:String(f.name||'document').replace(/\.pdf$/,''),data:f.b64});return{ok:true}}
  const h=H();if(!h||typeof h.a4!=='function'||!h.a4())return{ok:false,msg:'לא הוגדרה מדפסת A4 במכשיר הזה (אזור הניהול ← ציוד ומכשירים)'};
  const data=await fn('posDoc',{op:'get',sale:saleId(doc)});const R=root.PosReceipt,cfg=UI().cfg;
  const out=R.build(data,{fmt:'a4',cashNo:doc.cashierNo,cfg:{rcptFooter:cfg('rcptFooter'),rcptCashier:cfg('rcptCashier'),rcptQr:false,rcptBarcode:false,docShowSaleId:false}});
  await h.a4Print(out.html);return{ok:true}}
 catch(e){return{ok:false,msg:errTxt(e)}}}
/* A4 שנכשל → קבלה בקופה + הודעה */
async function a4OrThermal(doc){const r=await a4(doc);if(r.ok){UI().toast('המסמך נשלח להדפסת A4');return r}
 thermal(doc);UI().toast('הדפסת A4 לא הצליחה ('+r.msg+') – הודפסה קבלה בקופה. A4 שוב: "מכירה אחרונה"','warn');return r}

/* ---------- שליחה ---------- */
function sentTxt(L){L=Array.isArray(L)?L:[];if(!L.length)return'לא נשלח';const ok=L.filter(x=>x.ok),bad=L.filter(x=>!x.ok);
 const chN=x=>x.ch==='wa'?'וואטסאפ':'מייל';
 if(!bad.length)return'נשלח ללקוח ב'+[...new Set(ok.map(chN))].join(' וב');
 return(ok.length?'נשלח חלקית. ':'')+'לא נשלח ב'+[...new Set(bad.map(chN))].join(' וב')+': '+whyTxt(bad[0].why)}
async function send(doc,ch){if(!CHS.includes(ch))return{ok:false,msg:'ערוץ לא תקין'};
 if(!hasDoc(doc)){const m='המסמך עוד לא התקבל מהשרת – שלחו מ"מכירה אחרונה" כשהרשת תחזור';UI().toast(m,'warn');return{ok:false,msg:m}}
 UI().toast('שולח ב'+CH_N[ch]+'…');
 try{const r=await fn('posDoc',{op:'send',sale:saleId(doc),ch});const L=(r&&r.sent)||[];doc.sent=(doc.sent||[]).concat(L);const ok=L.length&&L.every(x=>x.ok);
  UI().toast(sentTxt(L)+(ok?'':' – אפשר "שליחה ללקוח" שוב ב"מכירה אחרונה"'),ok?'':'bad');return{ok,sent:L}}
 catch(e){const m='השליחה נכשלה: '+errTxt(e)+' – אפשר לשלוח שוב מ"מכירה אחרונה"';UI().toast(m,'bad');return{ok:false,msg:m}}}
/* השליחה האוטומטית (שרת) – בדיקה אחת אחרי כמה שניות; כשל = הודעה לקופאי */
function autoCheck(doc,ch,ms){setTimeout(async()=>{if(!hasDoc(doc))return;try{const r=await fn('posDoc',{op:'get',sale:saleId(doc)});const L=((r&&r.sale&&r.sale.sent)||[]).filter(x=>x.auto);
 if(!L.length)return;doc.sent=L;if(L.some(x=>!x.ok))UI().toast('השליחה האוטומטית ללקוח: '+sentTxt(L)+' – אפשר לשלוח שוב מ"מכירה אחרונה"','bad')}catch(e){}},ms||12000)}

/* חלון בחירת ערוץ (גם ל"שלח שוב"). c = הלקוח (phone, mail) */
function chModal(c,withPrint){const{modal,E}=UI();const ph=!!(c&&c.phone),ml=!!(c&&c.mail);
 const b=(v,t,ok,why)=>`<button class="pos-b g" data-v="${v}"${ok?'':' disabled'}>${E(t)}${ok?'':`<small> – ${E(why)}</small>`}</button>`;
 const pr=withPrint?`<button class="pos-b g" data-v="a4"${a4Ready()?'':' disabled'}>הדפסת A4${a4Ready()?'':'<small> – אין מדפסת A4 במכשיר</small>'}</button>`:'';
 const miss=!ph&&!ml?'<p class="pos-err" role="alert">אין בכרטיס הלקוח טלפון או מייל – אפשר להוסיף אותם בכרטיס הלקוח</p>':'';
 return modal(`<div class="pos-sh"><h2>${withPrint?'איך לתת את המסמך?':'שליחה ללקוח'}</h2></div>${miss}<div class="pos-grid2">${pr}${b('wa','וואטסאפ',ph,'אין טלפון בכרטיס')}${b('mail','מייל',ml,'אין מייל בכרטיס')}${b('both','וואטסאפ ומייל',ph&&ml,'חסר טלפון או מייל')}
  ${withPrint?'<button class="pos-b" data-v="rc" data-def>קבלה בקופה</button>':'<button class="pos-b" data-v="no" data-def>ביטול</button>'}</div>`,{label:withPrint?'איך לתת את המסמך':'שליחה ללקוח',cls:'wide'})}

/* ---------- סוף מכירה ---------- */
/* thermalNow(c) – האם מסך המכירה מדפיס קבלה בקופה מיד (כמו היום). false רק ללקוח עסקי עם A4 או בלי הגדרה (החלטה בחלון) */
function thermalNow(c){const p=plan(c);return!p||(!p.a4&&!p.ask)}
async function after(doc,c){const p=plan(c);if(!p)return;
 try{
  if(p.ch){UI().toast(hasDoc(doc)?'המסמך יישלח ללקוח ב'+CH_N[p.ch]:'המסמך יישלח ללקוח ב'+CH_N[p.ch]+' כשהמכירה תגיע לשרת');autoCheck(doc,p.ch)}
  if(p.a4){await a4OrThermal(doc);return}
  if(!p.ask)return;
  const v=await chModal(c,true);
  if(v==='a4')return void await a4OrThermal(doc);
  if(CHS.includes(v)){const r=await send(doc,v);if(!r.ok&&!hasDoc(doc))thermal(doc);return}
  thermal(doc)} /* "קבלה בקופה" או סגירת החלון – כמו היום */
 catch(e){try{thermal(doc)}catch(x){}}}
/* "מכירה אחרונה": שלח שוב / הדפס A4 שוב */
async function resend(doc){const c=doc&&doc.custObj;const v=await chModal(c||{},false);if(CHS.includes(v))return send(doc,v);return null}
async function a4Again(doc){const r=await a4(doc);UI().toast(r.ok?'המסמך נשלח להדפסת A4':'הדפסת A4 לא הצליחה: '+r.msg,r.ok?'':'bad');return r}

root.PosBizDoc={plan,thermalNow,after,send,resend,a4,a4Again,a4Ready,sentTxt,whyTxt};
})(typeof window!=='undefined'?window:globalThis);
