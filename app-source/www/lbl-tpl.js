/* מדבקות שלב 2 (24.11.2026) – מודל התבנית, טהור (בלי DOM), מיוצא גם ל-Node – firebase/tests/lbl-tpl.unit.test.js.
   תבנית (מסמך lblt/{id}): {v:1, name 1..40, w 15..104, h 10..100 (מ"מ), base? 0..5, j (JSON) 2..16000, del?, at, by}.
   j = {"grid":12,"brand":"lay"|"el","els":[...]}; רכיב {id,t,x,y,w,h,...} ביחידות הקנבס (300 DPI: 50×25 מ"מ = 591×295).
   v לא מוכר / JSON שבור / חריגה מהגבולות – התבנית לא נטענת (null), בלי קריסה. הציור – drawT ב-lbl-print.js.
   lbls/main: {sz?: [{w,h}] עד 10, def? (מזהה תבנית), at, by}. אין שינוי ברשומות קיימות. */
(function(root){
'use strict';
const LIM={els:30,j:16000,name:40,tpls:100,sz:10,txt:40,lbl:20,ex:10,mq:[2,99],w:[15,104],h:[10,100],q:999,tot:5000,ask:300};
const DEF={w:50,h:25};
const mm2px=mm=>Math.round(mm/25.4*300),mm2pt=mm=>mm/25.4*72;
const dims=(w,h)=>({W:mm2px(w),H:mm2px(h),PW:mm2pt(w),PH:mm2pt(h)});
const isDef=(w,h)=>w===DEF.w&&h===DEF.h;
const TYPES=['name','price','reg','unit','pack','bc','logo','stamp','text','hl','line','rect','box','exp','multi'];
const IFS=['','bc','!bc','pp','!pp','pack','!pack'];
const ID_OK=/^[A-Za-z0-9_-]{1,40}$/;
const fin=v=>typeof v==='number'&&isFinite(v);
const cl=(v,a,b,d)=>fin(v)?Math.min(b,Math.max(a,v)):d;
const str=(v,n)=>typeof v==='string'?v.slice(0,n):'';
const one=(v,L,d)=>L.includes(v)?v:d;
// רכיב: רק שדות מוכרים, בטווח. מחזיר null לסוג לא מוכר
function normEl(e,i){if(!e||typeof e!=='object'||!TYPES.includes(e.t))return null;
 const o={id:typeof e.id==='string'&&/^[A-Za-z0-9_-]{1,20}$/.test(e.id)?e.id:'e'+i,t:e.t,x:cl(e.x,-2000,4000,0),y:cl(e.y,-2000,4000,0),w:cl(e.w,1,4000,100),h:cl(e.h,1,4000,40)};
 if(e.al!==undefined)o.al=one(e.al,['r','c','l'],'r');
 if(e.fw!==undefined)o.fw=one(e.fw,[500,600,700,800],700);
 if(e.fs!==undefined)o.fs=cl(e.fs,6,400,40);
 if(e.min!==undefined)o.min=cl(e.min,6,400,14);
 if(e.if)o.if=one(e.if,IFS,'');
 if(e.ib)o.ib=e.ib==='nx'?'nx':1;
 if(e.k!==undefined)o.k=e.k?1:0;
 if(e.fit!==undefined)o.fit=one(e.fit,['shrink','wrap2'],'shrink');
 if(e.hlIn)o.hlIn=1;
 for(const k of ['hh','y1','y2'])if(fin(e[k]))o[k]=cl(e[k],-2000,4000,0);
 if(e.sty!==undefined)o.sty=one(e.sty,['big','line'],'big');
 if(e.cur!==undefined)o.cur=one(e.cur,['sh','ils',''],'sh');
 if(e.src!==undefined)o.src=one(e.src,['p','sale'],'p');
 if(e.lbl!==undefined)o.lbl=str(e.lbl,LIM.lbl);
 if(e.dg!==undefined)o.dg=cl(e.dg,0,80,0);
 if(e.dgs!==undefined)o.dgs=e.dgs?1:0;
 if(e.txt!==undefined)o.txt=str(e.txt,LIM.txt);
 if(e.sw!==undefined)o.sw=cl(e.sw,1,40,3);
 if(e.ph)o.ph=1;
 return o}
// j (מחרוזת או אובייקט) → {grid,brand,els} או null
function norm(j){let o=j;if(typeof j==='string'){if(j.length<2||j.length>LIM.j)return null;try{o=JSON.parse(j)}catch(e){return null}}
 if(!o||typeof o!=='object'||Array.isArray(o)||!Array.isArray(o.els)||o.els.length>LIM.els)return null;
 const els=[];o.els.forEach((e,i)=>{const n=normEl(e,i);if(n)els.push(n)});
 const seen={};els.forEach((e,i)=>{if(seen[e.id])e.id='e'+i+'_'+e.t;seen[e.id]=1});
 return{grid:cl(o.grid,1,100,12),brand:o.brand==='el'?'el':'lay',els}}
// מסמך lblt מפוענח ({id, v, name, w, h, base, j, del, at, by}) → תבנית {id,name,w,h,base,del,at,grid,brand,els} או null
function tplOk(d){try{if(!d||typeof d!=='object')return null;
 if(d.v!==1)return null;const nm=typeof d.name==='string'?d.name.trim():'';if(!nm||nm.length>LIM.name)return null;
 if(!fin(d.w)||d.w<LIM.w[0]||d.w>LIM.w[1]||!fin(d.h)||d.h<LIM.h[0]||d.h>LIM.h[1])return null;
 if(d.base!=null&&!(Number.isInteger(d.base)&&d.base>=0&&d.base<=5))return null;
 if(typeof d.j!=='string'||d.j.length<2||d.j.length>LIM.j)return null;
 const n=norm(d.j);if(!n)return null;
 const T=Object.assign({id:typeof d.id==='string'&&ID_OK.test(d.id)?d.id:'',v:1,name:nm,w:d.w,h:d.h},n);
 if(d.base)T.base=d.base;if(d.del===true)T.del=true;if(Number.isInteger(d.at))T.at=d.at;return T}catch(e){return null}}
const toJ=T=>JSON.stringify({grid:T.grid||12,brand:T.brand==='el'?'el':'lay',els:T.els||[]});
// שדות Firestore לשמירה (PATCH עם updateMask לכל השדות: base / del שלא קיימים – נמחקים מהמסמך)
const MASK=['v','name','w','h','base','j','del','at','by'];
function fields(T,uid,now){const f={v:{integerValue:'1'},name:{stringValue:String(T.name).trim().slice(0,LIM.name)},w:{doubleValue:+T.w},h:{doubleValue:+T.h},j:{stringValue:toJ(T)},at:{integerValue:String(now||Date.now())},by:{stringValue:String(uid||'')}};
 if(T.base)f.base={integerValue:String(T.base)};if(T.del===true)f.del={booleanValue:true};return f}
// גדלים: [{w,h}] עד 10, בטווח, בלי כפילויות
function szOk(L){const out=[];if(!Array.isArray(L))return out;for(const s of L){if(!s||!fin(s.w)||!fin(s.h)||s.w<LIM.w[0]||s.w>LIM.w[1]||s.h<LIM.h[0]||s.h>LIM.h[1])continue;
 if(out.some(x=>x.w===s.w&&x.h===s.h))continue;out.push({w:s.w,h:s.h});if(out.length>=LIM.sz)break}return out}
const lblsOk=d=>({sz:szOk(d&&d.sz),def:d&&typeof d.def==='string'&&d.def.length<=40?d.def:''});
function sFields(s,uid,now){return{sz:{arrayValue:{values:szOk(s&&s.sz).map(x=>({mapValue:{fields:{w:{doubleValue:x.w},h:{doubleValue:x.h}}}}))}},def:{stringValue:String(s&&s.def||'').slice(0,40)},at:{integerValue:String(now||Date.now())},by:{stringValue:String(uid||'')}}}
// אילו שדות מדבקה התבנית צריכה (ex – "בתוקף עד", mq/mp – מבצע כמות, pp – מחיר מבצע, pack – גודל אריזה)
function need(T){const E=T&&T.els||[],has=f=>E.some(f);
 return{ex:has(e=>e.t==='exp'),mq:has(e=>e.t==='multi'),pp:has(e=>e.t==='reg'||e.src==='sale'||e.if==='pp'||e.if==='!pp'),pack:has(e=>e.t==='pack'||e.t==='unit'||e.if==='pack'||e.if==='!pack')}}
const qty=n=>Math.max(1,Math.min(LIM.q,Math.floor(+n)||1));
// שורות סל → קבוצות לפי גודל (לפי סדר ההופעה). שורה בלי T – 50×25
function grp(rows){const G=[];(rows||[]).forEach((r,i)=>{const T=r&&r.T,w=T?T.w:DEF.w,h=T?T.h:DEF.h;let g=G.find(x=>x.w===w&&x.h===h);if(!g)G.push(g={w,h,idx:[],tot:0});g.idx.push(i);g.tot+=qty(r&&r.n)});return G}
// בדיקות לפני הדפסה. m (רשות) – מדדים מהציור: {[id]:{mod, over}}. ספים – הערכה: פס < 3 נק' (≈0.25 מ"מ), גובה ברקוד < 5 מ"מ
const BC_MOD=3,BC_HMM=5;
function checks(T,m){const R=[];if(!T||!Array.isArray(T.els))return R;const{W,H}=dims(T.w,T.h);m=m||{};
 for(const e of T.els){const dg=e.t==='bc'&&e.dgs!==0?(e.dg||0)*1.25:0;
  if(e.x<0||e.y<0||e.x+e.w>W||e.y+e.h+dg>H)R.push({id:e.id,k:'out',msg:'רכיב מחוץ למדבקה'});
  if(e.t==='bc'){if(e.h<mm2px(BC_HMM))R.push({id:e.id,k:'bcLow',msg:'הברקוד נמוך מדי (פחות מ-5 מ"מ) – ייתכן שלא ייסרק'});
   const x=m[e.id];if(x&&fin(x.mod)&&x.mod<BC_MOD)R.push({id:e.id,k:'bcThin',msg:'פסי הברקוד דקים מדי – הגדילו את רוחב הברקוד'})}
  const x=m[e.id];if(x&&x.over)R.push({id:e.id,k:'fit',msg:'הטקסט לא נכנס – הגדילו את הרכיב'})}
 return R}
const API={LIM,DEF,mm2px,mm2pt,dims,isDef,TYPES,IFS,ID_OK,normEl,norm,tplOk,toJ,MASK,fields,szOk,lblsOk,sFields,need,qty,grp,checks};
root.LblTpl=API;
if(typeof module!=='undefined'&&module.exports)module.exports=API;
})(typeof window!=='undefined'?window:globalThis);
