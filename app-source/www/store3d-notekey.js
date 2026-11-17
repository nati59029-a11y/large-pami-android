/* store3d-notekey.js – הקמת חנות שלב 2 (משימה 2026-11-17_תהליך-הקמת-חנות): לאיזה פריט שייכת הערה. טהור, בלי DOM ובלי שרת.
   קובץ משותף: אותו קובץ בדיוק נמצא גם בשרת (firebase/functions/lib/store3d-notekey.js) – בדיקה משווה ביניהם תו-בתו.
   נטען בדפדפן כ-window.S3NK, וב-Node דרך require.
   itemsOf(map) – מזהה ← תיאור קצר בעברית (עד 100 תווים): חדרים, קירות, עמודים, דלתות, גופים, סמלים ומקטעים. פריט מחוק – לא.
   הערה לפריט (s3setup/{mapId}/n/{itemId}) שומרת את התיאור d ואת צילום הגיאומטריה g מזמן הכתיבה. בטיוטה (on != 'map') המזהים לא
   יציבים (טיוטה חדשה / תיקון של ה-AI ממספרים מחדש, ובשמירה הראשונה renamed), ולכן ההערה הולכת אחרי הפריט הפיזי, לא אחרי המספר:
   resolve(g, G) – מועמדים מאותו סוג (t ו-k) במפה/בטיוטה הנוכחית; הקרוב ביותר למרכז נבחר רק אם הוא עד 60 ס"מ, והשני הכי קרוב רחוק
   לפחות פי 2 (חד-משמעי). אחרת – "לשיוך מחדש". מקטע: לפי הגוף שלו (אותה התאמה) + אותו צד ואותו מספר מקטע.
   noteTo(n, id, G) ← { st: 'ok' | 're' | 'empty', to: המזהה הנוכחי של הפריט }. הערה על מפה שמורה (on == 'map') – המזהים יציבים, רק בודקים שקיים. */
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
/* ---------- גיאומטריה: זיהוי פריט לפי מקום, לא לפי מספר ---------- */
const NEAR=60,AMBIG=2,KINDS=['rooms','walls','cols','doors','fx','syms'];
const R=v=>Math.round(+v||0);
const avg=p=>{let x=0,y=0,n=0;for(let i=0;i+1<p.length;i+=2){x+=+p[i]||0;y+=+p[i+1]||0;n++}return n?[x/n,y/n]:[0,0]};
/* G = מזהה ← { t: סוג הרשימה, k: תת-סוג, x, y (מרכז, ס"מ), a?, p? (קיר: 4 נקודות) }; מקטע ← { t:'bay', f, s, n } */
function geoIndex(map){
 const G=new Map();
 for(const t of KINDS)for(const o of live(map,t)){let x=o.x,y=o.y;
  if((t==='rooms'||t==='walls')&&Array.isArray(o.p)){const c=avg(o.p);x=c[0];y=c[1]}
  if(!Number.isFinite(+x)||!Number.isFinite(+y))continue;
  const g={t,k:typeof o.k==='string'?o.k:'',x:R(x),y:R(y)};if(Number.isFinite(o.a))g.a=R(o.a);if(t==='walls'&&Array.isArray(o.p))g.p=o.p.slice(0,4).map(R);
  G.set(o.id,g)}
 let nb=0;
 for(const f of live(map,'fx')){if(!G.has(f.id)||!Number.isInteger(f.bays)||f.bays<1||f.bays>30)continue;
  for(const s of f.sides===2?['a','b']:['a'])for(let n=1;n<=f.bays;n++){if(++nb>MAX_BAYS)break;G.set(`${f.id}-${s}-${n}`,{t:'bay',f:f.id,s,n})}}
 return G}
/* צילום הגיאומטריה של פריט לשמירה עם ההערה (null = לא קיים) */
function gOf(G,id){const g=G.get(id);if(!g)return null;
 if(g.t==='bay'){const p=G.get(g.f);return p?Object.assign({},p,{t:'bay',s:g.s,n:g.n}):null}
 return Object.assign({},g)}
function near(g,G,t){let b=null,d1=Infinity,d2=Infinity;
 for(const [id,v] of G){if(v.t!==t||v.k!==(g.k||''))continue;const d=Math.hypot(v.x-g.x,v.y-g.y);if(d<d1){d2=d1;d1=d;b=id}else if(d<d2)d2=d}
 return b!==null&&d1<=NEAR&&(d2===Infinity||(d2>0&&d2>=AMBIG*d1))?b:null}
/* g ← המזהה של אותו פריט ב-G, או null (לא נמצא / לא חד-משמעי) */
function resolve(g,G){
 if(!isObj(g)||!Number.isFinite(g.x)||!Number.isFinite(g.y))return null;
 if(g.t==='bay'){const f=near(g,G,'fx');if(!f)return null;const id=`${f}-${g.s}-${g.n}`;return G.has(id)?id:null}
 return KINDS.includes(g.t)?near(g,G,g.t):null}
/* n = מסמך ההערה ({t,d,g,on,re}), id = המזהה שלה, G = geoIndex(המפה/הטיוטה הנוכחית) */
function noteTo(n,id,G){
 if(!isObj(n)||typeof n.t!=='string'||!n.t.trim())return{st:'empty',to:id};
 if(n.re===1)return{st:'re',to:id};
 if(n.on==='map'||!isObj(n.g))return G.has(id)?{st:'ok',to:id}:{st:'re',to:id};
 const to=resolve(n.g,G);return to?{st:'ok',to}:{st:'re',to:id}}
const noteState=(n,id,G)=>noteTo(n,id,G).st;
return{DMAX,NEAR,AMBIG,itemsOf,geoIndex,gOf,resolve,noteTo,noteState,txt1};
});
