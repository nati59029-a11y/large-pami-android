/* store3d-notekey.js – הקמת חנות שלב 2 (משימה 2026-11-17_תהליך-הקמת-חנות): לאיזה פריט שייכת הערה. טהור, בלי DOM ובלי שרת.
   קובץ משותף: אותו קובץ בדיוק נמצא גם בשרת (firebase/functions/lib/store3d-notekey.js) – בדיקה משווה ביניהם תו-בתו.
   נטען בדפדפן כ-window.S3NK, וב-Node דרך require.
   itemsOf(map) – מזהה ← תיאור קצר בעברית (עד 100 תווים): חדרים, קירות, עמודים, דלתות, גופים, סמלים ומקטעים. פריט מחוק – לא.
   הערה לפריט (s3setup/{mapId}/n/{itemId}) שומרת את התיאור d מזמן הכתיבה. בטיוטה (on != 'map') המזהים לא יציבים: טיוטה חדשה או
   תיקון של ה-AI ממספרים מחדש. לכן noteState משווה את התיאור (בלי קואורדינטות, dKey) לפריט שנמצא עכשיו במזהה:
   'ok' = אותו פריט; 're' = פריט אחר / לא קיים / סומן re:1 ⇒ "לשיוך מחדש" (לא מוצגת על הפריט, לא נשלחת עם המזהה ולא מועתקת ל-bay.notes);
   'empty' = ההערה נוקתה. הערה שנכתבה על מפה שמורה (on == 'map') – המזהים יציבים, נבדק רק שהפריט עוד קיים. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.S3NK=factory()})(typeof self!=='undefined'?self:this,function(){
'use strict';
const DMAX=100,MAX_BAYS=2000;
const FX_HE={gon:'גונדולה',wall:'מדף קיר',fridge:'מקרר',table:'שולחן/משטח',stand:'סטנד/מתלה',bin:'סל/מתקן'};
const DOOR_HE={ent:'כניסה',in:'דלת פנימית',emg:'יציאת חירום',wh:'דלת מחסן'};
const SYM_HE={cash:'קופה',ent:'סימן כניסה',exit:'סימן יציאה'};
const isObj=o=>!!o&&typeof o==='object'&&!Array.isArray(o);
const txt1=v=>String(v==null?'':v).replace(/[\u0000-\u001f\u007f\u2028\u2029]/g,' ').replace(/\s+/g,' ').trim();
const live=(map,k)=>(isObj(map)&&Array.isArray(map[k])?map[k]:[]).filter(o=>isObj(o)&&o.del!==1&&typeof o.id==='string');
const at=o=>Number.isFinite(o.x)&&Number.isFinite(o.y)?` (x=${Math.round(o.x)}, y=${Math.round(o.y)})`:'';
const nm=s=>typeof s==='string'&&txt1(s)?` "${txt1(s).slice(0,30)}"`:'';
function itemsOf(map){
 const out=new Map(),rn=new Map(),fxd=new Map();
 for(const r of live(map,'rooms')){rn.set(r.id,txt1(r.name).slice(0,26));out.set(r.id,'חדר'+nm(r.name))}
 for(const w of live(map,'walls'))out.set(w.id,'קיר פנימי '+w.id);
 for(const c of live(map,'cols'))out.set(c.id,'עמוד'+at(c));
 for(const d of live(map,'doors'))out.set(d.id,(DOOR_HE[d.k]||'דלת')+at(d));
 for(const f of live(map,'fx')){const s=(FX_HE[f.k]||'גוף')+(Number.isInteger(f.num)?' מספר '+f.num:'')+nm(f.name)+(rn.get(f.room)?` בחדר "${rn.get(f.room)}"`:'')+at(f);fxd.set(f.id,s);out.set(f.id,s)}
 for(const y of live(map,'syms'))out.set(y.id,(SYM_HE[y.k]||'סמל')+at(y));
 let nb=0;
 for(const f of live(map,'fx')){if(!/^f[0-9]{1,4}$/.test(f.id)||!Number.isInteger(f.bays)||f.bays<1||f.bays>30)continue;
  for(const s of f.sides===2?['a','b']:['a'])for(let n=1;n<=f.bays;n++){if(++nb>MAX_BAYS)break;out.set(`${f.id}-${s}-${n}`,`מקטע ${n} בצד ${s==='a'?'א':'ב'} של ${fxd.get(f.id)}`)}}
 for(const [k,v] of out)out.set(k,v.slice(0,DMAX));
 return out}
/* התיאור בלי קואורדינטות: הזזה של גוף (או תיקון מידות) לא הופכת אותו לפריט אחר */
const dKey=d=>String(d==null?'':d).replace(/ \(x=-?[0-9]+, y=-?[0-9]+\)/g,'').trim();
/* n = מסמך ההערה ({t,d,on,re}), id = המזהה שלה, items = itemsOf(המפה/הטיוטה הנוכחית) */
function noteState(n,id,items){
 if(!isObj(n)||typeof n.t!=='string'||!n.t.trim())return 'empty';
 if(n.re===1)return 're';
 const cur=items.get(id);if(!cur)return 're';
 if(n.on==='map'||typeof n.d!=='string'||!n.d)return 'ok';
 return dKey(cur)===dKey(n.d)?'ok':'re'}
return{DMAX,itemsOf,dKey,noteState,txt1};
});
