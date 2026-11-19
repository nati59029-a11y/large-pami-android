/* POS:HUB (19.11.2026, בקשת בעל העסק): כל מה שקשור לקופה נפתח מאריח אחד "קופה".
   מסך "הוספה" מציג אריח אחד בלבד; לוחצים עליו ונפתח מסך "קופה" עם כל האריחים: מכירה, ניהול קופה, ניהול מכירה,
   משמרת ומזומן, עובדים וקוד. מי רואה כל אריח – בדיוק כמו קודם (posTile המקורי, אותן הרשאות). רק מקום התצוגה השתנה.
   עובד: הכניסה בראש מסך "עוד" פותחת גם היא את מסך "קופה". נטען אחרי כל קובצי pos-*. */
(function(){
'use strict';
if(typeof V==='undefined'||typeof window.posTile!=='function')return;
const inner=window.posTile;
/* האריחים עצמם (כמו קודם). במסך "קופה" אריח המכירה נקרא "מכירה", והניווט בלי סגירת חלונית */
window.posHubTiles=()=>{try{return inner()||''}catch(e){return ''}};
const hubH=()=>window.posHubTiles().replace(/data-a="addGo"/g,'data-a="go"').replace(/(data-v="pos"[^>]*>[\s\S]*?<\/svg>)קופה<\/button>/,'$1מכירה</button>');
window.posTile=()=>{if(!window.posHubTiles())return '';return `<button class="tile" data-a="addGo" data-v="posHub" style="font-size:1rem">${ico('swap')}קופה</button>`};
V.posHub=()=>{const T='קופה',h=hubH();if(!h)return{t:T,h:'<div class="empty">התכונה לא פעילה בעסק הזה</div>'};return{t:T,h:`<div class="big2">${h}</div>`}};
/* עובד: "קופה" בראש "עוד" פותח את מסך "קופה" */
{const o=V.more;if(typeof o==='function')V.more=function(){const r=o.apply(this,arguments);try{if(r&&typeof r.h==='string')r.h=r.h.replace('<button class="opt" data-a="go" data-v="pos"><span>קופה<small>מכירה בדלפק</small>','<button class="opt" data-a="go" data-v="posHub"><span>קופה<small>מכירה, משמרת ומזומן</small>')}catch(e){}return r}}
})();
