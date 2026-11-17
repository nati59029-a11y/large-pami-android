/* POS:M6 – קופה ש6: קריאת מחירון מצילום (ו A5, ו 5.15; תוכנית 9.3 "אם אין ייצוא מכספיט"). מנהל בלבד, באזור הניהול.
   כפתור "צילום מחירון" במסך "ייבוא מכספיט" (מוצרים). התמונה מוקטנת במכשיר (עד 1600 פיקסלים, JPEG) ונשלחת ל-posOcr,
   שמחזיר שורות { name, price, bc } בלבד. השורות עוברות לאשף הייבוא הרגיל (pos-import.js): התאמת עמודות ← תצוגה מקדימה ← "ייבא".
   **שום מוצר לא נוצר לפני האישור**, וכל הכללים של הייבוא חלים (כפילות, חסר מחיר, לא נדרס כלום). דיוק הקריאה בעברית – לא נבדק (לא מאומת). */
(function(){
'use strict';
if(typeof ACT==='undefined'||typeof V==='undefined')return;
const fnCall=(n,d)=>{d=d&&typeof d==='object'?d:{};if(SY&&SY.sa&&SY.bizId&&!('bizId'in d))d=Object.assign({bizId:SY.bizId},d);return window.fnCall(n,d)};
const on=()=>{try{return bzF('pos')&&bzB()&&!SY.mg&&(isA()||!!SY.sa)}catch(e){return false}};
async function shrink(f){const url=URL.createObjectURL(f);try{const im=new Image();await new Promise((ok,no)=>{im.onload=ok;im.onerror=()=>no(new Error('התמונה לא נפתחה'));im.src=url});
 const k=Math.min(1,1600/Math.max(im.naturalWidth,im.naturalHeight));const c=document.createElement('canvas');c.width=Math.round(im.naturalWidth*k);c.height=Math.round(im.naturalHeight*k);
 const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);g.drawImage(im,0,0,c.width,c.height);return c.toDataURL('image/jpeg',.85).split(',')[1]}finally{URL.revokeObjectURL(url)}}
{const f=V.posImp;if(typeof f==='function')V.posImp=function(){const r=f.apply(this,arguments);try{const I=window.__posImp&&__posImp.I;
 if(r&&typeof r.h==='string'&&on()&&I&&I.k==='prod'){const m='<p class="note">עברית בקובץ CSV';const b=`<label class="btn g w" style="display:flex;align-items:center;justify-content:center;margin-top:8px">צילום מחירון (בלי קובץ)<input type="file" accept="image/*" capture="environment" data-c="ocrFile" hidden></label><p class="note">אין קובץ מכספיט? צלמו מחירון מודפס או צילום מסך. השורות שנקראו עוברות לתצוגה מקדימה, ומשם רק אחרי אישור.</p>`;r.h=r.h.includes(m)?r.h.replace(m,b+m):r.h+b}}catch(e){}return r}}
CHG.ocrFile=async el=>{const f=el.files[0];el.value='';if(!f)return;if(!/^image\//.test(f.type||'image/'))return toast('רק תמונה');
 dlg('<h3>קורא את המחירון…</h3><p class="note">זה לוקח עד דקה.</p>');
 try{const b64=await shrink(f);const r=await fnCall('posOcr',{mime:'image/jpeg',b64});const rows=r.rows||[];
  if(!rows.length){closeDlg();return toast('לא נמצאו מוצרים בתמונה')}
  await __posImp.fromRows('צילום מחירון',['שם פריט','מחיר מכירה','ברקוד'],rows.map(x=>[x.name,x.price==null?'':x.price,x.bc||'']),'csv')}
 catch(e){closeDlg();toast(e&&e.message||'הקריאה נכשלה')}};
})();
