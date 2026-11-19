/* POS:M6 – קופה ש6: "הוספה מהירה" לברקוד לא מוכר (B5, א 5.7). זו פעולה של מכירה (לא הגדרה), ולכן מסך המכירה (ש1) קורא לה:
     PosProdQuick.open(bc, { onDone(prod), dev })  – חלון: ברקוד (ממולא), שם, מחיר, קטגוריה. כל קופאי רשאי (bc.cashierCreate:'always').
     prod = { id, name, price, sku, dup? }. dup = הברקוד כבר קיים (למשל נוסף בינתיים בקופה אחרת) – מקבלים את המוצר הקיים.
   המוצר נשמר בשרת (posProdQuick) מסומן "נוצר בקופה" + "חסר פרטים", והמנהל רואה התראה במסך המוצרים. אותו reqId בשליחה חוזרת – בלי כפילות.
   בלי רשת – החלון מציג שגיאה, והקופאי ממשיך (ש3 אחראי על תור בלי רשת). */
(function(){
'use strict';
if(typeof ACT==='undefined'||typeof document==='undefined')return;
const fnCall=(n,d)=>{d=d&&typeof d==='object'?d:{};if(SY&&SY.sa&&SY.bizId&&!('bizId'in d))d=Object.assign({bizId:SY.bizId},d);return window.fnCall(n,d)};
const rid=()=>{const a=new Uint8Array(12);crypto.getRandomValues(a);return 'q'+Array.from(a,b=>b.toString(16).padStart(2,'0')).join('')};
let Q=null;
function open(bc,opt){opt=opt||{};const B=window.PosBarcode,c=B?B.clean(bc):String(bc||'').trim();
 if(B&&c&&!B.check(c).ok){if(B.beep)B.beep(false);toast('ברקוד לא תקין: '+c);return false}
 const cats=(window.PosM6&&PosM6.C.cats)||[];
 Q={bc:c,req:rid(),opt};
 dlg(`<h3>מוצר חדש מהקופה</h3><p class="note" style="margin-top:0">הברקוד לא נמצא. הקלידו שם ומחיר – המוצר נשמר, נמכר עכשיו, והמנהל ישלים את שאר הפרטים.</p>
 <form data-f="pqF"><label class="f"><span>ברקוד</span><input name="bc" dir="ltr" value="${esc(c)}" readonly></label>
 <label class="f"><span>שם המוצר</span><input name="name" maxlength="40" required autocomplete="off"></label>
 <label class="f"><span>מחיר כולל מע"מ (₪)</span><input name="price" inputmode="decimal" dir="ltr" required autocomplete="off"></label>
 ${cats.length?`<label class="f"><span>קטגוריה</span><select name="cat"><option value="">—</option>${cats.filter(x=>!x.parent).map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select></label>`:''}
 <div class="row"><button class="btn grow">שמירה ומכירה</button><button type="button" class="btn g grow" data-a="closeDlg">ביטול</button></div><p class="note" id="pqE" style="margin:6px 0 0"></p></form>`);
 setTimeout(()=>{const i=document.querySelector('#dlg [name=name]');if(i)i.focus()},50);return true}
FRM.pqF=async f=>{if(!Q)return;const v=fd(f),price=Number(String(v.price).replace(',','.'));const e=document.getElementById('pqE');
 if(!String(v.name||'').trim())return toast('שם – חובה');if(!(price>0))return toast('מחיר לא תקין');
 const b=f.querySelector('button:not([type=button])');b.disabled=true;
 try{const r=await fnCall('posProdQuick',Object.assign({reqId:Q.req,bc:Q.bc,name:v.name,price},v.cat?{cat:v.cat}:{},Q.opt.dev?{dev:Q.opt.dev}:{}));
  const q=Q;Q=null;closeDlg();toast(r.dup?'הברקוד כבר קיים – נבחר המוצר הקיים':'המוצר נוסף');
  if(window.PosM6&&PosM6.C.prods)PosM6.load(true);
  if(q.opt&&typeof q.opt.onDone==='function')q.opt.onDone({id:r.id,name:r.name||v.name,price:typeof r.price==='number'?r.price:price,sku:r.sku,dup:!!r.dup})}
 catch(x){b.disabled=false;if(e)e.textContent=x&&x.offline?'אין חיבור לאינטרנט. נסו שוב, או מכרו את המוצר כ"שונות".':(x&&x.message||'השמירה נכשלה')}};
window.PosProdQuick={open};
})();
