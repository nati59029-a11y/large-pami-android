/* הדפסת מדבקות (22.11.2026) – אריח "הדפסת מדבקות" למדפסת גליל (Citizen CL-E321), מדבקה 50×25 מ"מ.
   מוצאים מוצר במלאי (prod) או במוצרים שהוקלדו ידנית (lblp – בענן, לכל המכשירים בעסק): הקלדת ברקוד / שם (השלמה עד 8),
   סורק USB במצב מקלדת (PosBarcode.listen), או צילום (shDecode). 5 תבניות עם תצוגה חיה, עריכה לכל מדבקה, סל, והדפסה.
   PDF: כל מדבקה עמוד משלה, MediaBox בדיוק 141.73×70.87 נקודות (50×25 מ"מ). הטקסט – תמונה של 1 ביט ב-300 DPI (591×295);
   פסי הברקוד – מלבנים וקטוריים (חדים בכל רזולוציה של מדפסת). EAN-13/EAN-8 תקין – PosBarcode.bars; אחרת Code128-B (כאן).
   לא נוגע ב-pos-barcode.js וב-shMkPdf. הרשאה: מנהל / מנהל־על, או עובד עם המתג lbl (נאכף בחוקים – prod ו-lblp).
   נתונים חדשים בלבד: אוסף lblp (שדות name, price, barcode, pack, at, by) ומפתח lp-lbl-basket במכשיר. אין שינוי ברשומות קיימות.
   החלק הטהור (code128, barsFor, parsePack, unitPrice, expand, mkPdf, toBits) מיוצא גם ל-Node – firebase/tests/lbl-print.unit.test.js. */
(function(root){
'use strict';
/* ---------- Code128 (ערכים 0–106, רוחבי פס/רווח) ---------- */
const P128=['212222','222122','222221','121223','121322','131222','122213','122312','132212','221213','221312','231212','112232','122132','122231','113222','123122','123221','223211','221132','221231','213212','223112','312131','311222','321122','321221','312212','322112','322211','212123','212321','232121','111323','131123','131321','112313','132113','132311','211313','231113','231311','112133','112331','132131','113123','113321','133121','313121','211331','231131','213113','213311','213131','311123','311321','331121','312113','312311','332111','314111','221411','431111','111224','111422','121124','121421','141122','141221','112214','112412','122114','122411','142112','142211','241211','221114','413111','241112','134111','111242','121142','121241','114212','124112','124211','411212','421112','421211','212141','214121','412121','111143','111341','131141','114113','114311','411113','411311','113141','114131','311141','411131','211412','211214','211232','2331112'];
const C128_OK=/^[ -~]{1,40}$/;
function code128(s){s=String(s==null?'':s);if(!C128_OK.test(s))throw new Error('code128: תווים לא נתמכים');
 const v=[104];for(let i=0;i<s.length;i++)v.push(s.charCodeAt(i)-32);
 let sum=v[0];for(let i=1;i<v.length;i++)sum+=v[i]*i;v.push(sum%103,106);
 let bars='';for(const x of v){const p=P128[x];for(let i=0;i<p.length;i++)bars+=(i%2?'0':'1').repeat(+p[i])}
 return{codes:v,bars}}
const PB=()=>root.PosBarcode||(typeof require==='function'?(()=>{try{return require('./pos-barcode.js')}catch(e){return null}})():null);
// EAN-13/EAN-8 תקין – פסי PosBarcode; כל קוד אחר (עד 40 תווי ASCII) – Code128-B
function barsFor(code){const c=String(code==null?'':code).trim();if(!c)return{kind:'',bars:''};
 const B=PB(),e=B&&B.bars?B.bars(c):'';if(e)return{kind:e.length===95&&c.length===13?'ean13':'ean8',bars:e};
 if(!C128_OK.test(c))return{kind:'',bars:''};return{kind:'c128',bars:code128(c).bars}}
/* ---------- מחיר ליחידת מידה ---------- */
const r2=x=>Math.round((x+Number.EPSILON)*100)/100;
const fmtP=n=>{n=r2(+n||0);return Number.isInteger(n)?String(n):n.toFixed(2)};
const UN={g:['גרם','גר','ג','g','gr','gram','grams'],kg:['קג','קילו','קילוגרם','kg'],ml:['מל','ml','מיליליטר'],l:['ליטר','ל','l','lt','ltr','liter','litre']};
function parsePack(s){const m=String(s==null?'':s).trim().match(/^(\d+(?:[.,]\d+)?)\s*(.*)$/);if(!m)return null;const n=parseFloat(m[1].replace(',','.'));if(!(n>0))return null;
 const u=m[2].toLowerCase().replace(/[\s.'"׳״]/g,'');
 if(UN.g.includes(u))return{g:n};if(UN.kg.includes(u))return{g:n*1000};if(UN.ml.includes(u))return{ml:n};if(UN.l.includes(u))return{ml:n*1000};return null}
// מחיר ל-100 גרם (גרם / ק"ג) או לליטר (מ"ל / ליטר). null = אין גודל אריזה מוכר
function unitPrice(price,pack){const p=parsePack(pack),v=+price;if(!p||!(v>=0)||String(price).trim()==='')return null;
 return p.g?{per:'100 גרם',v:r2(v*100/p.g)}:{per:'ליטר',v:r2(v*1000/p.ml)}}
/* ---------- PDF ---------- */
const PW=50/25.4*72,PH=25/25.4*72,W=591,H=295; // 50×25 מ"מ; קנבס 300 DPI
const n2=x=>String(Math.round(x*100)/100),n3=x=>String(Math.round(x*1000)/1000);
// סל → רצף עמודים: כל שורה n פעמים (1–200)
function expand(list){const seq=[];(list||[]).forEach((b,i)=>{const n=Math.max(1,Math.min(200,Math.floor(+(b&&b.n)||1)));for(let k=0;k<n;k++)seq.push(i)});return seq}
// RGBA → אפור 1 ביט (1 = לבן), שורות מרופדות לבית שלם
function toBits(data,w,h,thr){const rb=Math.ceil(w/8),out=new Uint8Array(rb*h),t=thr||150;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;if((data[i]*299+data[i+1]*587+data[i+2]*114)/1000>=t)out[y*rb+(x>>3)]|=0x80>>(x&7)}return out}
// labels: [{w,h,bits (1 ביט), rects:[[x,y,w,h] בפיקסלים של הקנבס]}]; seq: אינדקס מדבקה לכל עמוד. עמודים זהים חולקים תמונה ותוכן
function mkPdf(labels,seq,wPt,hPt){wPt=wPt||PW;hPt=hPt||PH;const parts=[],offs=[];let len=0;
 const enc=s=>{const u=new Uint8Array(s.length);for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i)&255;return u};
 const push=b=>{if(typeof b==='string')b=enc(b);parts.push(b);len+=b.length};
 const obj=(n,f)=>{offs[n]=len;push(n+' 0 obj\n');f();push('\nendobj\n')};
 const L=labels.length,pg0=3+2*L,N=pg0+seq.length-1,box=`[0 0 ${n2(wPt)} ${n2(hPt)}]`;
 push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
 obj(1,()=>push('<< /Type /Catalog /Pages 2 0 R /ViewerPreferences << /PrintScaling /None >> >>'));
 obj(2,()=>push(`<< /Type /Pages /Count ${seq.length} /Kids [${seq.map((_,i)=>(pg0+i)+' 0 R').join(' ')}] >>`));
 labels.forEach((lb,i)=>{const sx=wPt/lb.w,sy=hPt/lb.h;
  obj(3+2*i,()=>{push(`<< /Type /XObject /Subtype /Image /Width ${lb.w} /Height ${lb.h} /ColorSpace /DeviceGray /BitsPerComponent 1 /Length ${lb.bits.length} >>\nstream\n`);push(lb.bits);push('\nendstream')});
  let c=`q ${n2(wPt)} 0 0 ${n2(hPt)} 0 0 cm /Im0 Do Q\n`;const R=lb.rects||[];
  if(R.length)c+='0 g\n'+R.map(([x,y,w,h])=>`${n3(x*sx)} ${n3(hPt-(y+h)*sy)} ${n3(w*sx)} ${n3(h*sy)} re`).join('\n')+'\nf\n';
  obj(4+2*i,()=>{push(`<< /Length ${c.length} >>\nstream\n`);push(c);push('endstream')})});
 seq.forEach((k,i)=>obj(pg0+i,()=>push(`<< /Type /Page /Parent 2 0 R /MediaBox ${box} /CropBox ${box} /Resources << /XObject << /Im0 ${3+2*k} 0 R >> >> /Contents ${4+2*k} 0 R >>`)));
 const xr=len;let x=`xref\n0 ${N+1}\n0000000000 65535 f \n`;for(let i=1;i<=N;i++)x+=String(offs[i]).padStart(10,'0')+' 00000 n \n';
 push(x+`trailer\n<< /Size ${N+1} /Root 1 0 R >>\nstartxref\n${xr}\n%%EOF\n`);
 const out=new Uint8Array(len);let o=0;for(const p of parts){out.set(p,o);o+=p.length}return out}
const API={P128,code128,barsFor,parsePack,unitPrice,fmtP,expand,toBits,mkPdf,PW,PH,W,H};
root.LblPrint=API;
if(typeof module!=='undefined'&&module.exports)module.exports=API;
if(typeof window==='undefined'||typeof ACT==='undefined'||typeof V==='undefined')return;

/* =================== ציור המדבקה (קנבס 591×295) =================== */
const F='Rubik,"IBM Plex Sans Hebrew",Assistant,Arial,sans-serif',M=14,IW=W-2*M,SH='ש"ח';
const TPL=[[1,'ברקוד ומחיר'],[2,'בלי ברקוד'],[3,'מחיר גדול'],[4,'מבצע'],[5,'מחיר ליחידה']];
const fnt=(g,s,w)=>{g.font=`${w||700} ${Math.round(s)}px ${F}`};
function fit(g,t,max,size,min,w){let s=size;fnt(g,s,w);while(s>min&&g.measureText(t).width>max){s-=2;fnt(g,s,w)}return s}
function txt(g,t,x,y,al,dir){g.direction=dir||'rtl';g.textAlign=al||'right';g.textBaseline='middle';g.fillText(t,x,y)}
// שם עד שתי שורות: מקטין עד שנכנס; בגודל המינימלי – כל שורה מוקטנת בנפרד
function wrap2(g,t,max,size,min,w){const ws=String(t).split(/\s+/).filter(Boolean);
 for(let s=size;s>=min;s-=2){fnt(g,s,w);const ln=[];let cur='';for(const x of ws){const tr=cur?cur+' '+x:x;if(!cur||g.measureText(tr).width<=max)cur=tr;else{ln.push(cur);cur=x}}if(cur)ln.push(cur);
  if(ln.length<=2&&ln.every(l=>g.measureText(l).width<=max))return{s,ln}}
 const h=Math.ceil(ws.length/2);return{s:min,ln:ws.length>1?[ws.slice(0,h).join(' '),ws.slice(h).join(' ')]:[t]}}
// מילה מודגשת: קופסה שחורה עם טקסט לבן, בצד שמאל למעלה. מחזיר את הרוחב שתפסה
function hlBox(g,t,y,h){t=String(t||'').trim();if(!t)return 0;const s=fit(g,t,200,h*.62,18);const w=Math.ceil(g.measureText(t).width)+20;
 g.fillStyle='#000';g.fillRect(M,y,w,h);g.fillStyle='#fff';txt(g,t,M+w/2,y+h/2+1,'center');g.fillStyle='#000';return w+10}
// מחיר גדול: המספר ומשמאלו ש"ח קטן. cx – מרכז הקבוצה
function bigP(g,v,cx,cy,size,max){const ns=fmtP(v);let s=size;const fitW=()=>{fnt(g,s);const a=g.measureText(ns).width;fnt(g,s*.38);return a+10+g.measureText(SH).width};
 while(s>30&&fitW()>(max||IW))s-=4;fnt(g,s);const a=g.measureText(ns).width;fnt(g,s*.38);const b=g.measureText(SH).width,tot=a+10+b,r=cx+tot/2;
 fnt(g,s);txt(g,ns,r,cy,'right','ltr');fnt(g,s*.38);txt(g,SH,r-a-10,cy+s*.18,'right')}
// ברקוד: פסים (או רשימת מלבנים ל-PDF), ומתחת הספרות (LTR). מחזיר true אם צויר
function bcode(g,code,x,y,w,h,dg,rects){const c=String(code||'').trim();if(!c)return false;const r=barsFor(c);
 if(!r.bars){fit(g,c,w,30,14,500);txt(g,c,x+w/2,y+h/2,'center','ltr');return false}
 const n=r.bars.length,mod=Math.max(1,Math.floor(w/(n+20))),bw=n*mod,x0=Math.round(x+(w-bw)/2);
 for(let i=0;i<n;){if(r.bars[i]!=='1'){i++;continue}let j=i;while(j<n&&r.bars[j]==='1')j++;const R=[x0+i*mod,y,(j-i)*mod,h];if(rects)rects.push(R);else g.fillRect(R[0],R[1],R[2],R[3]);i=j}
 if(dg){fit(g,c,w,dg,12,500);txt(g,c,x+w/2,y+h+dg*.75,'center','ltr')}return true}
const num=v=>{const n=parseFloat(String(v==null?'':v).replace(',','.'));return isFinite(n)?n:null};
// it: {name, price, code, fs (אחוז), hl, pp (מחיר מבצע), pack}. opt.rects – מערך: פסי הברקוד נאספים אליו ולא מצוירים (ל-PDF)
function draw(g,tpl,it,opt){const rects=opt&&opt.rects||null,k=Math.max(.5,Math.min(1.6,(+it.fs||100)/100)),nm=String(it.name||'').trim()||'שם המוצר',pr=num(it.price)||0,cx=W/2;
 g.setTransform(1,0,0,1,0,0);g.fillStyle='#fff';g.fillRect(0,0,W,H);g.fillStyle='#000';g.strokeStyle='#000';
 const name1=(y,size,min,hlH)=>{const hw=hlBox(g,it.hl,y-hlH/2,hlH);fit(g,nm,IW-hw,size*k,min);txt(g,nm,W-M,y)};
 if(tpl===1){name1(46,58,22,54);
  if(bcode(g,it.code,M,86,IW,116,28,rects)){fit(g,`מחיר ${fmtP(pr)} ${SH}`,IW,46,22);txt(g,`מחיר ${fmtP(pr)} ${SH}`,cx,266,'center')}
  else{fit(g,`מחיר ${fmtP(pr)} ${SH}`,IW,84,22);txt(g,`מחיר ${fmtP(pr)} ${SH}`,cx,190,'center')}}
 else if(tpl===2){const hw=hlBox(g,it.hl,14,50),w2=wrap2(g,nm,IW-hw,54*k,22),lh=w2.s*1.12;fnt(g,w2.s);
  w2.ln.forEach((l,i)=>txt(g,l,W-M,(w2.ln.length===1?72:44+i*lh)));bigP(g,pr,cx,210,140)}
 else if(tpl===3){name1(34,40,20,44);if(bcode(g,it.code,M+40,196,IW-80,56,22,rects))bigP(g,pr,cx,128,118);else bigP(g,pr,cx,170,150)}
 else if(tpl===4){g.fillRect(6,6,W-12,70);g.fillStyle='#fff';const t='מבצע';fit(g,t,IW,56,24);txt(g,t,cx,43,'center');g.fillStyle='#000';
  fit(g,nm,IW,38*k,18);txt(g,nm,W-M,104);const pp=num(it.pp);bigP(g,pp!=null?pp:pr,cx,180,96);
  if(pp!=null){const lb='מחיר רגיל',ps=`${fmtP(pr)} ${SH}`;fnt(g,34,500);const lw=g.measureText(lb).width,pw=g.measureText(ps).width,r=cx+(lw+12+pw)/2;
   txt(g,lb,r,262);txt(g,ps,r-lw-12,262);g.fillRect(r-lw-12-pw-3,259,pw+6,4)}}
 else{name1(32,40,18,44);bigP(g,pr,W*.66,104,96,W*.6);const pk=String(it.pack||'').trim();if(pk){fit(g,pk,W*.3,38,16);txt(g,pk,W*.2,104,'center')}
  const u=unitPrice(it.price,it.pack);if(u){const t=`מחיר ל-${u.per}: ${fmtP(u.v)} ${SH}`;fit(g,t,IW,32,16,600);txt(g,t,cx,178,'center')}else if(opt&&opt.prev){g.fillStyle='#888';fit(g,'הקלידו גודל אריזה (למשל 500 גרם)',IW,24,14,500);txt(g,'הקלידו גודל אריזה (למשל 500 גרם)',cx,178,'center');g.fillStyle='#000'}
  bcode(g,it.code,M+60,212,IW-120,48,20,rects)}
 return rects}

/* =================== המסך =================== */
const S={P:null,pB:0,pErr:'',pNo:0,M:null,mB:0,mErr:'',q:'',hits:null,nf:null,cur:null,tpl:1,qty:1,br:'',B:null};
const BK='lp-lbl-basket';
const mgr=()=>(typeof isA==='function'&&isA())||!!(SY&&SY.sa);
const ok=()=>!!SY&&!SY.mg&&(mgr()||(typeof isW==='function'&&isW()&&!!(SY.perms&&SY.perms.lbl===true)));
const dec=d=>Object.assign({id:idOf(d)},Object.fromEntries(Object.entries(d.fields||{}).map(([k,v])=>[k,fvj(v)])));
const typing=()=>{const a=document.activeElement;return!!(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)&&a.closest('#main'))};
const redraw=()=>{try{if(cur().v==='lbl'&&!typing()&&!document.querySelector('#dlg[open]'))rerender()}catch(e){}};
const bkGet=()=>{if(S.B)return S.B;try{const a=JSON.parse(localStorage.getItem(BK)||'[]');S.B=Array.isArray(a)?a.filter(x=>x&&x.it&&TPL.some(t=>t[0]===x.tpl)):[]}catch(e){S.B=[]}return S.B};
const bkSave=()=>{try{localStorage.setItem(BK,JSON.stringify(S.B||[]))}catch(e){}};
const brs=()=>typeof brList==='function'?brList():[];
const brNow=()=>{const B=brs();if(!B.length)return '_';if(!B.some(b=>b.id===S.br))S.br=B[0].id;return S.br};
const unitP=(p,br)=>{const v=p&&p.bp&&typeof p.bp==='object'?p.bp[br]:undefined;return typeof v==='number'?v:(+(p&&p.price)||0)}; // כמו unitP ב-orders-staff.js
const inv=()=>S.P==='ox'?(window.__ox&&window.__ox.P||[]):(S.P||[]);
const rid=()=>{const a=new Uint8Array(12);crypto.getRandomValues(a);return 'm'+[...a].map(x=>x.toString(36).padStart(2,'0')).join('').slice(0,22)};

async function loadInv(){if(S.pB)return;S.pB=1;S.pErr='';try{
 if(!bzF('orders')){S.P=[];S.pNo=1;return}
 /* B2b: מחירים למדבקה – לא מהעותק השמור של ההזמנות (window.__ox.sc) */const ox=window.__ox;if(ox&&!ox.sc&&Array.isArray(ox.P)&&ox.P.length){S.P='ox';return}
 if(typeof window.__oxLoadAll==='function'&&wp('ord')){try{await window.__oxLoadAll()}catch(e){}if(window.__ox&&!window.__ox.sc&&Array.isArray(window.__ox.P)){S.P='ox';return}}
 // עובד עם "הדפסת מדבקות" בלי "הזמנות": קריאה ישירה של המוצרים, בעמודים של 2,000, רק השדות שצריך
 let L=[],after=null;for(let g=0;g<30;g++){const sq={from:[{collectionId:'prod'}],select:{fields:['name','price','barcode','bcx','sku','cx','bp','on'].map(f=>({fieldPath:f}))},orderBy:[{field:{fieldPath:'__name__'},direction:'ASCENDING'}],limit:2000};
  if(after)sq.startAt={values:[{referenceValue:after}],before:false};
  const r=(await fsx(':runQuery',{method:'POST',body:JSON.stringify({structuredQuery:sq})})||[]).filter(x=>x.document);L=L.concat(r.map(x=>dec(x.document)));after=r.length>=2000?r[r.length-1].document.name:null;if(!after)break}
 S.P=L}catch(e){S.P=[];S.pErr=e&&e.offline?'אין חיבור לאינטרנט':'המלאי לא נטען'}finally{S.pB=0;redraw()}}
async function loadMan(){if(S.mB)return;S.mB=1;S.mErr='';try{const r=await fsx(':runQuery',{method:'POST',body:JSON.stringify({structuredQuery:{from:[{collectionId:'lblp'}],limit:3000}})});
 S.M=(r||[]).filter(x=>x.document).map(x=>dec(x.document))}catch(e){S.M=[];S.mErr=e&&e.offline?'אין חיבור לאינטרנט':'המוצרים הידניים לא נטענו'}finally{S.mB=0;redraw()}}

const codeHit=(p,t)=>!!t&&(String(p.barcode||'')===t||(Array.isArray(p.bcx)&&p.bcx.includes(t))||String(p.sku||'')===t||String(p.cx||'')===t);
const all=()=>inv().map(p=>({s:'p',p})).concat((S.M||[]).map(p=>({s:'m',p})));
function find(q){const t=String(q||'').trim();if(!t)return[];const A=all(),ex=A.filter(x=>codeHit(x.p,t));if(ex.length)return ex.slice(0,8);
 const n=t.toLowerCase(),dg=/^\d{4,}$/.test(t),out=[];for(const x of A){if(String(x.p.name||'').toLowerCase().includes(n)||(dg&&String(x.p.barcode||'').includes(t)))out.push(x);if(out.length>=8)break}return out}
const hitsH=H=>H.map(x=>`<button type="button" class="li" data-a="lblPick" data-s="${x.s}" data-id="${esc(x.p.id)}"><div class="m" style="min-width:0"><b style="overflow-wrap:anywhere">${esc(x.p.name||'')}${x.s==='m'?' <span class="tag">ידני</span>':''}${x.p.on===false?' <span class="tag">לא זמין</span>':''}</b><small>${ils(x.s==='m'?(+x.p.price||0):unitP(x.p,brNow()))}${x.p.barcode?' · <bdi dir="ltr">'+esc(x.p.barcode)+'</bdi>':''}</small></div></button>`).join('');
const looksCode=t=>/^[0-9A-Za-z-]{3,40}$/.test(t)&&/\d/.test(t);
// חיפוש מלא (Enter / סריקה): קוד מדויק או תוצאה אחת – נבחר מיד; כמה – רשימה; אין – טופס מוצר ידני
function lookup(q){const t=String(q||'').trim();S.q=t;if(!t)return;const H=find(t),ex=H.filter(x=>codeHit(x.p,t));
 if(ex.length===1||(H.length===1&&!looksCode(t)))return pick(ex[0]||H[0]);
 S.cur=null;S.hits=H;S.nf=H.length?null:(looksCode(t)?{barcode:t,name:''}:{barcode:'',name:t});rerender()}
function pick(x){const p=x.p;S.cur={s:x.s,id:p.id,name:String(p.name||''),price:String(x.s==='m'?(+p.price||0):unitP(p,brNow())),code:String(p.barcode||''),fs:100,hl:'',pp:'',pack:String(p.pack||'')};
 S.hits=null;S.nf=null;S.qty=1;rerender();setTimeout(()=>{const e=document.getElementById('lblEd');if(e)e.scrollIntoView({block:'start'})},30)}
function onScan(c){try{if(!ok()||cur().v!=='lbl'||document.querySelector('#dlg[open]'))return;lookup(c)}catch(e){}}
// סורק USB: מאזינים רק כשהמסך פתוח (בדיקה כל שנייה; ביציאה – עצירה), כדי לא להשפיע על מסכים אחרים
let scStop=null,scT=0;
function scOn(){if(scStop||!window.PosBarcode||!PosBarcode.listen)return;try{scStop=PosBarcode.listen(onScan,{beep:true})}catch(e){scStop=null;return}
 scT=setInterval(()=>{let on=false;try{on=cur().v==='lbl'}catch(e){}if(!on){clearInterval(scT);scT=0;try{scStop()}catch(e){}scStop=null}},1000)}

const prevs=()=>{const it=S.cur;if(!it)return;const go=()=>document.querySelectorAll('#main canvas[data-lbl-t]').forEach(c=>{try{draw(c.getContext('2d'),+c.dataset.lblT,it,{prev:1})}catch(e){}});
 go();try{if(document.fonts&&document.fonts.ready)document.fonts.ready.then(()=>{if(cur().v==='lbl')go()})}catch(e){}};
let raf=0;const prevSoon=()=>{if(raf)return;raf=requestAnimationFrame(()=>{raf=0;prevs()})};
const cv=(t,w)=>`<canvas data-lbl-t="${t}" width="${W}" height="${H}" style="width:${w||'100%'};height:auto;display:block;background:#fff;border-radius:6px"></canvas>`;
const ef=(l,k,v,x)=>`<label class="f" style="margin:0"><span>${l}</span><input data-i="lblE" data-k="${k}" value="${esc(v==null?'':v)}" autocomplete="off" ${x||''}></label>`;
const HINT='בחלון ההדפסה: בחרו את מדפסת Citizen, גודל נייר 50×25 מ"מ, שוליים "ללא" (None), קנה מידה 100% / "גודל בפועל" (Actual size).';

V.lbl=()=>{const T='הדפסת מדבקות';if(!ok())return{t:T,h:'<div class="empty">אין לך הרשאה להדפסת מדבקות</div>'};
 scOn();if(S.P===null&&!S.pB)setTimeout(loadInv,0);if(S.M===null&&!S.mB)setTimeout(loadMan,0);
 const B=bkGet(),tot=B.reduce((s,b)=>s+Math.max(1,Math.min(200,Math.floor(+b.n||1))),0),BR=brs(),it=S.cur;
 const st=S.P===null||S.pB?'טוען מלאי…':S.pNo?'המלאי זמין כשתוספת ההזמנות פעילה בעסק. אפשר להקליד מוצר ידני.':S.pErr?S.pErr:`${inv().length} מוצרים במלאי`;
 let h=`<div class="card"><form data-f="lblQ" autocomplete="off"><label class="f" style="margin:0"><span>ברקוד או שם מוצר</span><input name="q" data-i="lblQ" data-pos-scan value="${esc(S.q)}" placeholder="סרקו, הקלידו ברקוד או התחילו לכתוב שם" enterkeyhint="search"></label>
  <div class="row" style="margin-top:8px;gap:8px"><button class="btn grow">חפש</button><label class="btn g grow" style="cursor:pointer;text-align:center">צלם ברקוד<input type="file" accept="image/*" capture="environment" data-c="lblCam" hidden></label></div></form>
  ${BR.length>1?`<label class="f" style="margin:8px 0 0"><span>מחיר לפי סניף</span><select data-c="lblBr">${BR.map(b=>`<option value="${esc(b.id)}"${b.id===brNow()?' selected':''}>${esc(b.name)}</option>`).join('')}</select></label>`:''}
  <small class="note" style="display:block;margin-top:6px">${esc(st)}${S.M&&S.M.length?' · '+S.M.length+' מוצרים ידניים':''}${S.mErr?' · '+esc(S.mErr):''} · סורק USB עובד גם בלי ללחוץ על התיבה</small>
  <div id="lblHits" style="margin-top:6px">${S.hits&&S.hits.length?hitsH(S.hits):(!S.hits&&S.q&&!it&&!S.nf?hitsH(find(S.q)):'')}</div>${S.hits&&S.hits.length?'<button class="chip" style="margin-top:6px" data-a="lblNfGo">המוצר לא ברשימה – הוספת מוצר ידני</button>':''}</div>`;
 if(S.nf)h+=`<div class="card" style="border:2px solid var(--acc)"><b>המוצר לא נמצא במלאי</b><p class="note" style="margin:4px 0 8px">הקלידו שם ומחיר. המוצר יישמר בענן ויופיע בחיפוש הבא בכל המכשירים של העסק.</p>
  <form data-f="lblNew" autocomplete="off">${fld('שם המוצר','name',S.nf.name,'text','required maxlength="120"')}<div class="row" style="gap:8px"><label class="f grow"><span>מחיר (₪)</span><input name="price" inputmode="decimal" required placeholder="0.00"></label><label class="f grow"><span>גודל אריזה (לא חובה)</span><input name="pack" maxlength="30" placeholder="500 גרם / 1.5 ליטר"></label></div>
  ${fld('ברקוד (לא חובה)','barcode',S.nf.barcode,'text','maxlength="40" dir="ltr" inputmode="numeric"')}<div class="row" style="gap:8px"><button class="btn grow">שמור והמשך</button><button type="button" class="btn g grow" data-a="lblNfX">ביטול</button></div></form></div>`;
 if(it){const u=unitPrice(it.price,it.pack);
  h+=`<div class="card" id="lblEd"><div class="sec" style="margin-top:0"><h3>עריכת המדבקה</h3>${it.s==='m'?'<span class="tag">מוצר ידני</span>':''}</div>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px">${TPL.map(([n,l])=>`<button type="button" data-a="lblTpl" data-v="${n}" aria-pressed="${S.tpl===n}" style="padding:6px;border-radius:10px;border:2px solid ${S.tpl===n?'var(--acc)':'var(--line)'};background:transparent;color:inherit;cursor:pointer;font:inherit">${cv(n)}<small style="display:block;margin-top:4px${S.tpl===n?';color:var(--acc);font-weight:700':''}">${n}. ${l}</small></button>`).join('')}</div>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;margin-top:10px">
  ${ef('שם המוצר','name',it.name,'maxlength="120"')}${ef('מחיר (₪)','price',it.price,'inputmode="decimal"')}${ef('ברקוד','code',it.code,'dir="ltr" maxlength="40"')}
  <label class="f" style="margin:0"><span>גודל השם</span><select data-c="lblFs">${[70,80,90,100,110,120,130,140].map(v=>`<option value="${v}"${+it.fs===v?' selected':''}>${v}%</option>`).join('')}</select></label>
  ${ef('מילה מודגשת (לא חובה)','hl',it.hl,'maxlength="14" placeholder="חדש! / מבצע"')}${ef('מחיר מבצע (תבנית 4)','pp',it.pp,'inputmode="decimal"')}${ef('גודל אריזה (תבנית 5)','pack',it.pack,'maxlength="30" placeholder="500 גרם"')}</div>
  <small class="note" id="lblU" style="display:block;margin-top:6px">${u?`מחיר ל-${u.per}: ${ils(u.v)}`:'מחיר ליחידה: הקלידו גודל אריזה (גרם, ק"ג, מ"ל, ליטר)'}${it.code&&!barsFor(it.code).bars?' · הברקוד לא תקין להדפסה':''}</small>
  <div class="row" style="gap:8px;margin-top:10px;align-items:flex-end"><label class="f" style="margin:0;max-width:120px"><span>כמות מדבקות</span><input type="number" min="1" max="200" step="1" inputmode="numeric" data-i="lblQty" value="${S.qty}"></label><button class="btn grow" data-a="lblAdd">הוסף לסל</button><button class="btn g" data-a="lblX">ביטול</button></div>
  ${it.s==='m'&&mgr()?'<button class="btn g s" style="margin-top:8px" data-a="lblMDel">מחק את המוצר הידני</button>':''}</div>`;
  setTimeout(prevs,0)}
 h+=`<div class="sec"><h3>סל ההדפסה</h3>${B.length?'<button class="btn s g" data-a="lblClr">נקה</button>':''}</div>`;
 h+=B.length?B.map((b,i)=>`<div class="li" style="cursor:default;gap:8px"><div class="m" style="min-width:0"><b style="overflow-wrap:anywhere">${esc(b.it.name||'')}</b><small>${esc((TPL.find(t=>t[0]===b.tpl)||[])[1]||'')} · ${ils(b.tpl===4&&num(b.it.pp)!=null?num(b.it.pp):(num(b.it.price)||0))}${b.it.code?' · <bdi dir="ltr">'+esc(b.it.code)+'</bdi>':''}</small></div><input type="number" min="1" max="200" step="1" inputmode="numeric" aria-label="כמות" data-c="lblBq" data-n="${i}" value="${b.n}" style="width:72px"><button class="btn s g" data-a="lblDel" data-n="${i}" aria-label="מחק">מחק</button></div>`).join('')
  +`<button class="btn w" style="margin-top:10px" data-a="lblPrint">הדפס (${tot} מדבקות)</button><p class="note" style="margin-top:6px">${esc(HINT)}</p>`
  :'<p class="note" style="padding:8px 4px">הסל ריק. בחרו מוצר, תבנית וכמות ולחצו "הוסף לסל".</p>';
 return{t:T,s:tot?tot+' מדבקות בסל':'',h}};

window.lblTile=k=>ok()?(k==='add'?`<button class="tile" data-a="addGo" data-v="lbl" style="font-size:1rem">${ico('doc')}הדפסת מדבקות</button>`:`<button class="tile" data-a="go" data-v="lbl" style="font-size:1.15rem;text-align:center;border-color:var(--acc);color:var(--acc)">${ico('doc')}הדפסת מדבקות</button>`):'';

INP.lblQ=el=>{S.q=el.value;S.hits=null;S.nf=null;const d=document.getElementById('lblHits');if(d)d.innerHTML=hitsH(find(S.q))};
FRM.lblQ=f=>{const i=f.querySelector('[name=q]');lookup(i?i.value:'')};
CHG.lblCam=async el=>{const f=el.files[0];el.value='';if(!f)return;if(typeof shDecode!=='function')return toast('הסריקה לא זמינה');toast('קורא ברקוד…');let c='';try{c=await shDecode(f)}catch(e){}
 if(!c)return toast('לא נקרא ברקוד. צלמו קרוב ובמיקוד, או הקלידו ידנית');lookup(c)};
CHG.lblBr=el=>{S.br=el.value;if(S.cur&&S.cur.s==='p'){const p=inv().find(x=>x.id===S.cur.id);if(p)S.cur.price=String(unitP(p,S.br))}rerender()};
ACT.lblPick=el=>{const s=el.dataset.s,id=el.dataset.id,p=(s==='m'?(S.M||[]):inv()).find(x=>x.id===id);if(p)pick({s,p})};
ACT.lblTpl=el=>{S.tpl=+el.dataset.v||1;rerender()};
ACT.lblX=()=>{S.cur=null;rerender()};ACT.lblNfGo=()=>{const t=String(S.q||'').trim();S.hits=null;S.nf=looksCode(t)?{barcode:t,name:''}:{barcode:'',name:t};rerender()};ACT.lblNfX=()=>{S.nf=null;rerender()};
INP.lblE=el=>{if(!S.cur)return;S.cur[el.dataset.k]=el.value;prevSoon();if(el.dataset.k==='price'||el.dataset.k==='pack'||el.dataset.k==='code'){const u=unitPrice(S.cur.price,S.cur.pack),n=document.getElementById('lblU');
 if(n)n.textContent=(u?`מחיר ל-${u.per}: ${ils(u.v)}`:'מחיר ליחידה: הקלידו גודל אריזה (גרם, ק"ג, מ"ל, ליטר)')+(S.cur.code&&!barsFor(S.cur.code).bars?' · הברקוד לא תקין להדפסה':'')}};
CHG.lblFs=el=>{if(S.cur){S.cur.fs=+el.value||100;prevs()}};
INP.lblQty=el=>{S.qty=el.value};
const pOk=v=>{const n=num(v);return n!=null&&n>=0&&n<=100000};
const mFields=x=>{const f={name:{stringValue:x.name},price:{doubleValue:x.price},at:{integerValue:String(Date.now())},by:{stringValue:SY.uid}};if(x.barcode)f.barcode={stringValue:x.barcode};if(x.pack)f.pack={stringValue:x.pack};return f};
async function mSave(x){const ex=x.barcode&&(S.M||[]).find(m=>m.barcode===x.barcode),id=x.id||(ex&&ex.id)||(/^[0-9A-Za-z-]{1,40}$/.test(x.barcode||'')?'bc_'+x.barcode:rid());
 const d=await fsx('/lblp/'+id,{method:'PATCH',body:JSON.stringify({fields:mFields(x)})});const m=d&&d.fields?dec(d):Object.assign({id},x);S.M=(S.M||[]).filter(q=>q.id!==m.id).concat([m]);return m}
ACT.lblAdd=async()=>{const it=S.cur;if(!it)return;const nm=String(it.name||'').trim();if(!nm)return toast('חסר שם מוצר');if(nm.length>120)return toast('שם המוצר: עד 120 תווים');
 if(!pOk(it.price))return toast('המחיר לא תקין');if(S.tpl===4&&!pOk(it.pp))return toast('בתבנית מבצע צריך מחיר מבצע');
 if(it.code&&!barsFor(it.code).bars)return toast('הברקוד לא תקין להדפסה (עד 40 תווים באנגלית ובספרות)');
 const n=Math.floor(+S.qty);if(!(n>=1&&n<=200))return toast('כמות: 1 עד 200');
 const L=bkGet();L.push({it:{name:nm,price:String(num(it.price)),code:String(it.code||'').trim(),fs:+it.fs||100,hl:String(it.hl||'').trim().slice(0,14),pp:it.pp===''||it.pp==null?'':String(num(it.pp)),pack:String(it.pack||'').trim().slice(0,30)},tpl:S.tpl,n});bkSave();
 // מוצר ידני: גודל האריזה נשמר גם במוצר עצמו (בענן) לפעם הבאה
 if(it.s==='m'){const m=(S.M||[]).find(x=>x.id===it.id),pk=String(it.pack||'').trim().slice(0,30);if(m&&String(m.pack||'')!==pk){try{await mSave({id:m.id,name:String(m.name||'').slice(0,120),price:+m.price||0,barcode:m.barcode||'',pack:pk})}catch(e){toast('גודל האריזה לא נשמר בענן')}}}
 S.cur=null;S.q='';toast('נוסף לסל ('+n+')');rerender();setTimeout(()=>{const q=document.querySelector('#main [name=q]');if(q)q.focus()},30)};
FRM.lblNew=async f=>{const x=fd(f),nm=String(x.name||'').trim(),bc=String(x.barcode||'').trim(),pk=String(x.pack||'').trim();
 if(!nm||nm.length>120)return toast('שם המוצר: 1 עד 120 תווים');if(!pOk(x.price))return toast('המחיר לא תקין');if(pk.length>30)return toast('גודל אריזה: עד 30 תווים');
 if(bc&&!/^[ -~]{1,40}$/.test(bc))return toast('ברקוד: עד 40 תווים באנגלית ובספרות');
 const b=f.querySelector('button');if(b)b.disabled=true;
 try{const m=await mSave({name:nm,price:num(x.price),barcode:bc,pack:pk});toast('המוצר נשמר');pick({s:'m',p:m})}catch(e){if(b)b.disabled=false;toast(e&&e.offline?'אין חיבור לאינטרנט':'השמירה נכשלה'+(e&&e.code===403?' (אין הרשאה)':''))}};
ACT.lblMDel=()=>{const it=S.cur;if(!it||it.s!=='m'||!mgr())return;ask('למחוק את המוצר הידני "'+it.name+'"?',async()=>{closeDlg();try{await fsx('/lblp/'+it.id,{method:'DELETE'});S.M=(S.M||[]).filter(x=>x.id!==it.id);S.cur=null;toast('נמחק');rerender()}catch(e){toast('המחיקה נכשלה')}},'כן, מחק')};
CHG.lblBq=el=>{const L=bkGet(),b=L[+el.dataset.n];if(!b)return;const n=Math.floor(+el.value);b.n=n>=1&&n<=200?n:Math.max(1,Math.min(200,n||1));bkSave();rerender()};
ACT.lblDel=el=>{const L=bkGet();L.splice(+el.dataset.n,1);bkSave();rerender()};
ACT.lblClr=()=>ask('לנקות את סל ההדפסה?',()=>{S.B=[];bkSave();closeDlg();rerender()},'כן, נקה');
// הדפסה: מדבקה ייחודית אחת לכל שורה בסל (תמונה + פסים וקטוריים), עמוד לכל עותק
async function build(L){try{if(document.fonts&&document.fonts.load)await Promise.all([document.fonts.load(`700 40px ${F}`,'אבג 123'),document.fonts.load(`500 40px ${F}`,'אבג 123'),document.fonts.load(`600 40px ${F}`,'אבג 123')])}catch(e){}
 const c=document.createElement('canvas');c.width=W;c.height=H;const g=c.getContext('2d');
 const labels=L.map(b=>{const rects=draw(g,b.tpl,b.it,{rects:[]});return{w:W,h:H,bits:toBits(g.getImageData(0,0,W,H).data,W,H),rects}});
 return mkPdf(labels,expand(L))}
ACT.lblPrint=async el=>{const L=bkGet();if(!L.length)return toast('הסל ריק');if(el)el.disabled=true;toast('מכין להדפסה…');
 try{const pdf=await build(L),C=typeof shNat==='function'?shNat():null;
  if(C&&C.Plugins&&C.Plugins.PdfPrint)await C.Plugins.PdfPrint.print({name:'labels',data:shB64(pdf)});
  else{const w=window.open(URL.createObjectURL(new Blob([pdf],{type:'application/pdf'})),'_blank');if(!w)toast('הדפדפן חסם את החלון. אפשרו חלונות קופצים ונסו שוב')}
  dlg(`<h3>ההדפסה נשלחה</h3><p class="note">${esc(HINT)}</p><p class="note">אם הכול הודפס כמו שצריך – אפשר לנקות את הסל.</p><div class="row"><button class="btn grow" data-a="lblClrOk">נקה את הסל</button><button class="btn g grow" data-a="closeDlg">השאר בסל</button></div>`)}
 catch(e){toast('ההדפסה נכשלה: '+(e&&e.message||e))}finally{if(el)el.disabled=false}};
ACT.lblClrOk=()=>{S.B=[];bkSave();closeDlg();rerender()};
API.draw=draw;API.TPL=TPL;API.build=build;
})(typeof window!=='undefined'?window:globalThis);
