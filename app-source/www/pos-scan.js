/* POS:M1 – קופה, סורק ברקוד שמתנהג כמקלדת (ד H9/U17). עובד בלי שום הגדרה ובלי שדה בפוקוס.
   תווים שמגיעים ברצף מהיר (רווח של עד maxGap מ"ש) ואחריהם Enter, באורך minLen ומעלה = סריקה.
   הקלדה של אדם במקלדת חיצונית איטית יותר, ולכן לא מזוהה כסריקה (Enter בחיפוש = "הוסף").
   unscan – מוציא משדה את התווים של הסריקה שנכנסו אליו (כולם, או רק הסוף אם הפוקוס עבר אליו באמצע). */
(function(root){
'use strict';
function ScanDetector(o){o=o||{};const minLen=o.minLen||4,maxGap=o.maxGap||50,enterGap=o.enterGap||150;let buf='',last=-1e9;
 return{feed(key,t){if(key==='Enter'){const ok=buf.length>=minLen&&t-last<=enterGap?buf:null;buf='';last=-1e9;return ok}
   if(typeof key!=='string'||key.length!==1)return null;if(t-last>maxGap)buf='';buf+=key;last=t;return null},
  reset(){buf='';last=-1e9},get buf(){return buf}}}
function unscan(v,code){v=String(v||'');let k=Math.min(v.length,code.length);while(k>0&&!v.endsWith(code.slice(code.length-k)))k--;return k>0?v.slice(0,v.length-k):v}
const PosScan={ScanDetector,unscan};
root.PosScan=PosScan;
if(typeof module!=='undefined'&&module.exports)module.exports=PosScan;
})(typeof window!=='undefined'?window:globalThis);
