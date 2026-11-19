/* POS:M4 – PosCfg: ההגדרות בפועל לקופה ולכל המודולים (הממשק PosCfg.get(k) של אפיון סופי פרק 6).
   קורא את poscfg/saPub, poscfg/main ו-poscfg/br_{br} ישירות מ-Firestore (מסמך שלם – לפי הכללים), מחשב לפי pos-cfg-schema.js
   (קוד ← עסק ← סניף), ושומר עותק מקומי לכל עסק (lp-pos-cfg:{bizId}) לעבודה בלי רשת. אין כאן שום כתיבה.
     PosCfg.get(k)        → הערך בפועל. מודול כבוי (למשל wbc כש-weight כבוי) → undefined: ההגדרה לא חלה.
     PosCfg.raw(k)        → הערך גם כשהמודול כבוי (למסך הניהול).
     PosCfg.mod(m)        → האם המודול דלוק (sa.mods).
     PosCfg.open()        → הקופה פתוחה לעסק: מתג pos דלוק + saPub.on + st ≠ 'susp'.
     PosCfg.ready(br?)    → Promise: טעינה (או רענון כשהגרסה השתנתה). בלי רשת – העותק המקומי.
     PosCfg.ver / PosCfg.on(fn) – גרסה (main.ver + saPub.ver) ומאזין לשינוי.
   מתג 'pos' כבוי (או עסק legacy / מסך ניהול העסקים) = לא קורא כלום ולא שומר כלום; get מחזיר את ברירת המחדל של הסכמה. */
(function(){
'use strict';
const SC=window.PosCfgSchema;if(!SC)return;
const live=()=>{try{return typeof bzF==='function'&&bzF('pos')&&bzB()&&!SY.mg&&!!SY.bizId}catch(e){return false}};
const LSK=()=>'lp-pos-cfg:'+SY.bizId;
const dec=d=>{try{return d&&d.fields?fvj({mapValue:d}):null}catch(e){return null}};
let st={sa:null,main:null,br:null,brId:null,at:0},E=SC.eff({}),subs=[];
const verOf=()=>((st.main&&st.main.ver)||0)+'.'+((st.sa&&st.sa.ver)||0);
function apply(){E=SC.eff({sa:st.sa,main:st.main,br:st.br});const v=verOf();if(v!==api.ver){api.ver=v;for(const f of subs)try{f(api)}catch(e){}}}
function loadLocal(){try{const o=JSON.parse(localStorage.getItem(LSK())||'null');if(o&&typeof o==='object'){st=Object.assign(st,o);apply()}}catch(e){}}
function saveLocal(){try{localStorage.setItem(LSK(),JSON.stringify({sa:st.sa,main:st.main,br:st.br,brId:st.brId,at:st.at}))}catch(e){}}
async function one(p){try{return dec(await fsx(p))}catch(e){if(e&&(e.code===404||e.status===404))return null;throw e}}
let busy=null,lastBiz='';
async function load(br){
 if(!live())return api;
 if(lastBiz!==SY.bizId){lastBiz=SY.bizId;st={sa:null,main:null,br:null,brId:null,at:0};loadLocal()}
 const b=br===undefined?st.brId:br;
 try{const[sa,main,brd]=await Promise.all([one('/poscfg/saPub'),one('/poscfg/main'),b?one('/poscfg/br_'+b):Promise.resolve(null)]);
  st={sa,main,br:brd,brId:b||null,at:Date.now()};saveLocal()}catch(e){/* בלי רשת – העותק המקומי */}
 apply();return api}
const api={
 ver:'0.0',
 ready(br){if(busy)return busy;busy=load(br).finally(()=>{busy=null});return busy},
 get(k){const r=SC.BY[k];if(!r)return undefined;return E.off[k]?undefined:E.cfg[k]},
 raw(k){return E.cfg[k]},
 src(k){return E.src[k]},
 mod(m){return E.mods[m]===true},
 open(){return live()&&E.on&&E.st!=='susp'},
 st(){return E.st},type(){return E.type},
 all(){return Object.assign({},E)},
 on(fn){if(typeof fn==='function')subs.push(fn);return()=>{subs=subs.filter(x=>x!==fn)}},
 /* אחרי שינוי במסך הניהול – ריענון מיידי */
 reset(){st={sa:null,main:null,br:null,brId:st.brId,at:0};E=SC.eff({});api.ver='0.0'},
};
window.PosCfg=api;
// רענון: מעבר עסק – איפוס; כל דקה כשהמסך פתוח (שינוי מחיר / הגדרה מגיע לקופה תוך דקה – אפיון ה 5.17)
window.addEventListener('lp-biz-change',()=>{lastBiz='';api.reset()});
setInterval(()=>{try{if(live()&&document.visibilityState!=='hidden'&&st.at)api.ready()}catch(e){}},60000);
})();
