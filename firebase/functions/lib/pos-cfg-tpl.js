/* POS:M4 – תבניות לפי סוג עסק (אפיון ה 0.6). קובץ אחד, זהה בדיוק בשני המקומות:
     app-source/www/pos-cfg-tpl.js  (דפדפן: window.PosCfgTpl)
     firebase/functions/lib/pos-cfg-tpl.js  (שרת: module.exports – זורע את postpl/{type} בפעם הראשונה)
   תבנית = { name, ver, mods:{מודול:bool}, vals:{מפתח:ערך} }. vals משתמש במפתחות של pos-cfg-schema.js בלבד (בדיקה אוטומטית).
   בפתיחת קופה לעסק השרת **מעתיק** את vals ל-poscfg/main ואת mods ל-poscfg/sa (העתקה, לא קישור: שינוי תבנית לא משנה עסקים קיימים).
   "החל תבנית מחדש" מציג רשימת הבדלים ומחיל רק מה שסומן.
   ברירות המחדל בסכמה הן כבר הערכים של העסק הנוכחי (bakeryDisposable), ולכן ב-bakeryDisposable אין vals.
   הערכים לסוגים האחרים הם הצעה בלבד (לא נבדקו מול עסק אמיתי). מסעדה / בית קפה – לא נתמך. */
(function(root){
'use strict';
const T={
 bakeryDisposable:{name:'חד-פעמי ומוצרי אפייה',ver:1,
  mods:{variants:true,lot:true,expiry:true,preorder:true,delivery:true,layaway:true,offsite:true,custDisplay:true,clock:true,gift:true,club:true},
  vals:{}},
 grocery:{name:'מכולת / מינימרקט',ver:1,
  mods:{weight:true,expiry:true,custDisplay:true},
  vals:{wbc:{prefix:'2',mode:'price'},retDays:7,'cat.decimalQty':true,'cat.track':['exp'],scale:'M',multiBranch:false,openDays:[0,1,2,3,4,5,6]}},
 fashion:{name:'ביגוד / הנעלה',ver:1,
  mods:{variants:true,gift:true},
  vals:{retDays:30,retDefective:'exchange',retNoRcptDef:'exchange',giftRcpt:true,'cat.variantAttrs':['size','color'],'cat.track':[],scale:'M',multiBranch:false}},
 electronics:{name:'סלולר / אלקטרוניקה',ver:1,
  mods:{serial:true,services:true},
  vals:{'cat.track':['sn'],rcptFooter:'אחריות לפי תעודת האחריות של היצרן',retDays:14,retNeedTag:true,instMax:12,scale:'M',multiBranch:false}},
 general:{name:'קמעונאות כללית',ver:1,
  mods:{custDisplay:true},
  vals:{'cat.track':[],scale:'M',multiBranch:false,beginner:false,'mig.src':'none','inv.locations':['wh']}},
 service:{name:'שירותים ותיקונים',ver:1,
  mods:{services:true,preorder:true},
  vals:{ordDepPct:50,ordSrc:['phone','wa','store'],'cat.track':[],scale:'S',multiBranch:false,'inv.on':'marked'}},
};
// מודולים שלא מופיעים בתבנית = כבויים
function modsOf(type,MODS){const t=T[type];const o={};for(const m of MODS)o[m]=!!(t&&t.mods[m]);return o}
const api={TPL:T,TYPES:Object.keys(T),modsOf};
if(typeof module==='object'&&module.exports)module.exports=api;else root.PosCfgTpl=api;
})(typeof self!=='undefined'?self:this);
