/* הדפסת מדבקות (22.11.2026) – אריח "הדפסת מדבקות" למדפסת גליל (Citizen CL-E321), מדבקה 50×25 מ"מ.
   מוצאים מוצר במלאי (prod) או במוצרים שהוקלדו ידנית (lblp – בענן, לכל המכשירים בעסק): הקלדת ברקוד / שם (השלמה עד 8),
   סורק USB במצב מקלדת (PosBarcode.listen), או צילום (shDecode). 5 תבניות עם תצוגה חיה, עריכה לכל מדבקה, סל, והדפסה.
   PDF: כל מדבקה עמוד משלה, MediaBox בדיוק 141.73×70.87 נקודות (50×25 מ"מ). הטקסט – תמונה של 1 ביט ב-300 DPI (591×295);
   פסי הברקוד – מלבנים וקטוריים (חדים בכל רזולוציה של מדפסת). EAN-13/EAN-8 תקין – PosBarcode.bars; אחרת Code128-B (כאן).
   לא נוגע ב-pos-barcode.js וב-shMkPdf. הרשאה: מנהל / מנהל־על, או עובד עם המתג lbl (נאכף בחוקים – prod ו-lblp).
   נתונים חדשים בלבד: אוסף lblp (שדות name, price, barcode, pack, at, by) ומפתח lp-lbl-basket במכשיר. אין שינוי ברשומות קיימות.
   החלק הטהור (code128, barsFor, parsePack, unitPrice, expand, mkPdf, toBits, layBox, xfRects, bw1, imgOk) מיוצא גם ל-Node – firebase/tests/lbl-print.unit.test.js.
   24.11.2026: "מוצר חדש במלאי" / "עריכת מוצר" – טופס המוצר המלא של orders-staff.js (__oxNewP / __oxEditP). לוגו וחותמת כשרות לכל העסק:
   מסמך cfg/lbl (שדות logo, stamp – PNG שחור-לבן, lay, on, at, by; כתיבה – מנהל) ועותק במכשיר lp-lbl-brand-<bizId>. בלי לוגו – ההדפסה כמו קודם. */
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
// סל → רצף עמודים: כל שורה n פעמים (1–999)
function expand(list){const seq=[];(list||[]).forEach((b,i)=>{const n=Math.max(1,Math.min(999,Math.floor(+(b&&b.n)||1)));for(let k=0;k<n;k++)seq.push(i)});return seq}
// RGBA → אפור 1 ביט (1 = לבן), שורות מרופדות לבית שלם
function toBits(data,w,h,thr){const rb=Math.ceil(w/8),out=new Uint8Array(rb*h),t=thr||150;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;if((data[i]*299+data[i+1]*587+data[i+2]*114)/1000>=t)out[y*rb+(x>>3)]|=0x80>>(x&7)}return out}
// labels: [{w,h,bits (1 ביט), rects:[[x,y,w,h] בפיקסלים של הקנבס], pw?,ph? (גודל העמוד בנקודות – בלי: wPt/hPt)}]; seq: אינדקס מדבקה לכל עמוד. עמודים זהים חולקים תמונה ותוכן
function mkPdf(labels,seq,wPt,hPt){wPt=wPt||PW;hPt=hPt||PH;const parts=[],offs=[];let len=0;
 const enc=s=>{const u=new Uint8Array(s.length);for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i)&255;return u};
 const push=b=>{if(typeof b==='string')b=enc(b);parts.push(b);len+=b.length};
 const obj=(n,f)=>{offs[n]=len;push(n+' 0 obj\n');f();push('\nendobj\n')};
 const L=labels.length,pg0=3+2*L,N=pg0+seq.length-1,bx=lb=>`[0 0 ${n2(lb.pw||wPt)} ${n2(lb.ph||hPt)}]`;
 push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
 obj(1,()=>push('<< /Type /Catalog /Pages 2 0 R /ViewerPreferences << /PrintScaling /None >> >>'));
 obj(2,()=>push(`<< /Type /Pages /Count ${seq.length} /Kids [${seq.map((_,i)=>(pg0+i)+' 0 R').join(' ')}] >>`));
 labels.forEach((lb,i)=>{const lw=lb.pw||wPt,lh=lb.ph||hPt,sx=lw/lb.w,sy=lh/lb.h;
  obj(3+2*i,()=>{push(`<< /Type /XObject /Subtype /Image /Width ${lb.w} /Height ${lb.h} /ColorSpace /DeviceGray /BitsPerComponent 1 /Length ${lb.bits.length} >>\nstream\n`);push(lb.bits);push('\nendstream')});
  let c=`q ${n2(lw)} 0 0 ${n2(lh)} 0 0 cm /Im0 Do Q\n`;const R=lb.rects||[];
  if(R.length)c+='0 g\n'+R.map(([x,y,w,h])=>`${n3(x*sx)} ${n3(lh-(y+h)*sy)} ${n3(w*sx)} ${n3(h*sy)} re`).join('\n')+'\nf\n';
  obj(4+2*i,()=>{push(`<< /Length ${c.length} >>\nstream\n`);push(c);push('endstream')})});
 seq.forEach((k,i)=>obj(pg0+i,()=>{const box=bx(labels[k]);push(`<< /Type /Page /Parent 2 0 R /MediaBox ${box} /CropBox ${box} /Resources << /XObject << /Im0 ${3+2*k} 0 R >> >> /Contents ${4+2*k} 0 R >>`)}));
 const xr=len;let x=`xref\n0 ${N+1}\n0000000000 65535 f \n`;for(let i=1;i<=N;i++)x+=String(offs[i]).padStart(10,'0')+' 00000 n \n';
 push(x+`trailer\n<< /Size ${N+1} /Root 1 0 R >>\nstartxref\n${xr}\n%%EOF\n`);
 const out=new Uint8Array(len);let o=0;for(const p of parts){out.set(p,o);o+=p.length}return out}
/* ---------- לוגו וחותמת כשרות (24.11.2026) ---------- */
// פריסה: top – פס עליון (לוגו מימין, חותמת משמאל), התוכן מוקטן ומוזז מתחתיו; bot – קופסאות 124×64 בפינות התחתונות, השורה התחתונה מוצרת (ib)
const BH=64,BX=64,BW=124; // BW – רוחב קופסאות הפינות (bot): הלוגו והחותמת רחבים – קופסה רחבה מגדילה אותם בלי לעלות לגובה הברקוד
// w,h – גודל הקנבס (רשות, ברירת מחדל 591×295)
function layBox(lay,w,h){w=w||W;h=h||H;if(lay==='top'){const s=(h-BH)/h;return{lay,t:{s,dx:Math.round((w-w*s)/2),dy:BH},logo:[w/2+4,4,w/2-10,BH-8],stamp:[6,4,w/2-10,BH-8],ib:0}}
 if(lay==='bot')return{lay,t:null,logo:[w-6-BW,h-6-BX,BW,BX],stamp:[6,h-6-BX,BW,BX],ib:6+BW+6-14};return null}
// מלבני ברקוד מקואורדינטות התוכן לקנבס (אותו setTransform של התצוגה)
const xfRects=(rects,t)=>t?(rects||[]).map(([x,y,w,h])=>[x*t.s+t.dx,y*t.s+t.dy,w*t.s,h*t.s]):(rects||[]);
// RGBA → שחור-לבן (במקום). שקיפות = רקע לבן; thr – סף בהירות (ברירת מחדל 150)
function bw1(data,w,h,thr){const t=thr||150;for(let i=0;i<w*h*4;i+=4){const a=data[i+3]/255,l=((data[i]*299+data[i+1]*587+data[i+2]*114)/1000)*a+255*(1-a),v=l>=t?255:0;data[i]=data[i+1]=data[i+2]=v;data[i+3]=255}return data}
const imgOk=s=>typeof s==='string'&&s.length<=40000&&/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(s);
const API={P128,code128,barsFor,parsePack,unitPrice,fmtP,expand,toBits,mkPdf,PW,PH,W,H,layBox,xfRects,bw1,imgOk};
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
// מילה מודגשת: קופסה שחורה עם טקסט לבן, בצד שמאל למעלה (x – רשות, ברירת מחדל M). מחזיר את הרוחב שתפסה
function hlBox(g,t,y,h,x){t=String(t||'').trim();if(!t)return 0;if(x==null)x=M;const s=fit(g,t,200,h*.62,18);const w=Math.ceil(g.measureText(t).width)+20;
 g.fillStyle='#000';g.fillRect(x,y,w,h);g.fillStyle='#fff';txt(g,t,x+w/2,y+h/2+1,'center');g.fillStyle='#000';return w+10}
// מחיר גדול: המספר ומשמאלו ש"ח קטן. cx – מרכז הקבוצה (al 'r' – הקצה הימני, 'l' – השמאלי). cu – סימן המטבע (רשות, ברירת מחדל ש"ח; '' – בלי)
function bigP(g,v,cx,cy,size,max,cu,al){const ns=fmtP(v),C=cu==null?SH:cu,gp=C?10:0;let s=size;const fitW=()=>{fnt(g,s);const a=g.measureText(ns).width;fnt(g,s*.38);return a+gp+g.measureText(C).width};
 while(s>30&&fitW()>(max||IW))s-=4;fnt(g,s);const a=g.measureText(ns).width;fnt(g,s*.38);const b=g.measureText(C).width,tot=a+gp+b,r=al==='r'?cx:al==='l'?cx+tot:cx+tot/2;
 fnt(g,s);txt(g,ns,r,cy,'right','ltr');if(C){fnt(g,s*.38);txt(g,C,r-a-gp,cy+s*.18,'right')}return tot}
// ברקוד: פסים (או רשימת מלבנים ל-PDF), ומתחת הספרות (LTR). מחזיר true אם צויר
function bcode(g,code,x,y,w,h,dg,rects){const c=String(code||'').trim();if(!c)return false;const r=barsFor(c);
 if(!r.bars){fit(g,c,w,30,14,500);txt(g,c,x+w/2,y+h/2,'center','ltr');return false}
 const n=r.bars.length,mod=Math.max(1,Math.floor(w/(n+20))),bw=n*mod,x0=Math.round(x+(w-bw)/2);
 for(let i=0;i<n;){if(r.bars[i]!=='1'){i++;continue}let j=i;while(j<n&&r.bars[j]==='1')j++;const R=[x0+i*mod,y,(j-i)*mod,h];if(rects)rects.push(R);else g.fillRect(R[0],R[1],R[2],R[3]);i=j}
 if(dg){fit(g,c,w,dg,12,500);txt(g,c,x+w/2,y+h+dg*.75,'center','ltr')}return true}
const num=v=>{const n=parseFloat(String(v==null?'':v).replace(',','.'));return isFinite(n)?n:null};
// מטמון תמונות הלוגו/החותמת (data URL → Image מפוענח). ensureImgs – לפני הדפסה, כדי שה-PDF יהיה זהה לתצוגה
const IMG={};
const imgOf=s=>{if(!s)return null;let o=IMG[s];if(!o){o=IMG[s]={i:new Image(),ok:0};o.i.src=s;o.p=(o.i.decode?o.i.decode():new Promise((r,j)=>{o.i.onload=r;o.i.onerror=j})).then(()=>{o.ok=1}).catch(()=>{})}return o};
const ensureImgs=b=>Promise.all(b?[b.logo,b.stamp].filter(Boolean).map(s=>imgOf(s).p):[]);
const bImg=s=>{if(!s)return null;if(typeof s!=='string')return s;const o=imgOf(s);return o.ok?o.i:null};
// תמונה בתוך קופסה, שומר יחס. al: r=צמוד לימין, l=לשמאל, אחרת במרכז
function put(g,i,[x,y,w,h],al){if(!i)return;const iw=i.naturalWidth||i.width,ih=i.naturalHeight||i.height;if(!iw||!ih)return;const k=Math.min(w/iw,h/ih),dw=iw*k,dh=ih*k;
 g.drawImage(i,al==='r'?x+w-dw:al==='l'?x:x+(w-dw)/2,y+(h-dh)/2,dw,dh)}
// it: {name, price, code, fs (אחוז), hl, pp (מחיר מבצע), pack}. opt.rects – מערך: פסי הברקוד נאספים אליו ולא מצוירים (ל-PDF)
// opt.brand={lay:'top'|'bot',logo,stamp} – לוגו וחותמת. בלי brand – בדיוק כמו קודם (ib=0)
function draw(g,tpl,it,opt){const rects=opt&&opt.rects||null,k=Math.max(.5,Math.min(1.6,(+it.fs||100)/100)),nm=String(it.name||'').trim()||'שם המוצר',pr=num(it.price)||0,cx=W/2;
 const b=opt&&opt.brand||null,L=b?layBox(b.lay):null,ib=L?L.ib:0,nx=(x,w)=>ib?[Math.max(x,M+ib),Math.min(x+w,W-M-ib)-Math.max(x,M+ib)]:[x,w];
 g.setTransform(1,0,0,1,0,0);g.fillStyle='#fff';g.fillRect(0,0,W,H);g.fillStyle='#000';g.strokeStyle='#000';
 if(L){put(g,bImg(b.logo),L.logo,L.t?'r':'c');put(g,bImg(b.stamp),L.stamp,L.t?'l':'c');if(L.t)g.setTransform(L.t.s,0,0,L.t.s,L.t.dx,L.t.dy)}
 const name1=(y,size,min,hlH)=>{const hw=hlBox(g,it.hl,y-hlH/2,hlH);fit(g,nm,IW-hw,size*k,min);txt(g,nm,W-M,y)};
 if(tpl===1){name1(46,58,22,54);
  if(bcode(g,it.code,M,86,IW,116,28,rects)){fit(g,`מחיר ${fmtP(pr)} ${SH}`,IW-2*ib,46,22);txt(g,`מחיר ${fmtP(pr)} ${SH}`,cx,266,'center')}
  else{fit(g,`מחיר ${fmtP(pr)} ${SH}`,IW-2*ib,84,22);txt(g,`מחיר ${fmtP(pr)} ${SH}`,cx,190,'center')}}
 else if(tpl===2){const hw=hlBox(g,it.hl,14,50),w2=wrap2(g,nm,IW-hw,54*k,22),lh=w2.s*1.12;fnt(g,w2.s);
  w2.ln.forEach((l,i)=>txt(g,l,W-M,(w2.ln.length===1?72:44+i*lh)));bigP(g,pr,cx,210,140,IW-2*ib)}
 else if(tpl===3){name1(34,40,20,44);const[x3,w3]=nx(M+40,IW-80);if(bcode(g,it.code,x3,196,w3,56,22,rects))bigP(g,pr,cx,128,118);else bigP(g,pr,cx,170,150,IW-2*ib)}
 else if(tpl===4){g.fillRect(6,6,W-12,70);g.fillStyle='#fff';const t='מבצע';fit(g,t,IW,56,24);txt(g,t,cx,43,'center');g.fillStyle='#000';
  fit(g,nm,IW,38*k,18);txt(g,nm,W-M,104);const pp=num(it.pp);bigP(g,pp!=null?pp:pr,cx,180,96);
  if(pp!=null){const lb='מחיר רגיל',ps=`${fmtP(pr)} ${SH}`;let f4=34;fnt(g,f4,500);if(ib)while(f4>16&&g.measureText(lb).width+12+g.measureText(ps).width>IW-2*ib){f4-=2;fnt(g,f4,500)}
   const lw=g.measureText(lb).width,pw=g.measureText(ps).width,r=cx+(lw+12+pw)/2;
   txt(g,lb,r,262);txt(g,ps,r-lw-12,262);g.fillRect(r-lw-12-pw-3,259,pw+6,4)}}
 else{name1(32,40,18,44);bigP(g,pr,W*.66,104,96,W*.6);const pk=String(it.pack||'').trim();if(pk){fit(g,pk,W*.3,38,16);txt(g,pk,W*.2,104,'center')}
  const u=unitPrice(it.price,it.pack);if(u){const t=`מחיר ל-${u.per}: ${fmtP(u.v)} ${SH}`;fit(g,t,IW,32,16,600);txt(g,t,cx,178,'center')}else if(opt&&opt.prev){g.fillStyle='#888';fit(g,'הקלידו גודל אריזה (למשל 500 גרם)',IW,24,14,500);txt(g,'הקלידו גודל אריזה (למשל 500 גרם)',cx,178,'center');g.fillStyle='#000'}
  const[x5,w5]=nx(M+60,IW-120);bcode(g,it.code,x5,212,w5,48,20,rects)}
 if(L&&L.t){g.setTransform(1,0,0,1,0,0);if(rects){const X=xfRects(rects,L.t);rects.length=0;X.forEach(r=>rects.push(r))}}
 return rects}
/* תבנית בפורמט החדש (lbl-tpl.js) – אותם כלי ציור של draw(). הקנבס בגודל התבנית (dims). opt.m – אובייקט: מדדים לבדיקות ({[id]:{mod,over}}).
   brand 'lay' – לוגו/חותמת לפי הפריסה (כמו draw); 'el' – רכיבי logo/stamp בתבנית. fw 800 = "מודגש מאוד": 700 + קו מתאר (אין קובץ Rubik 800) */
const AL={r:'right',c:'center',l:'left'},DAL={name:'r',text:'r',exp:'r',hl:'l',logo:'c',stamp:'c'};
function drawT(g,T,it,opt){const rects=opt&&opt.rects||null,m=opt&&opt.m||null,prev=!!(opt&&opt.prev),D=LblTpl.dims(T.w,T.h),Wt=D.W,Ht=D.H;
 const k=Math.max(.5,Math.min(1.6,(+it.fs||100)/100)),nm=String(it.name||'').trim()||'שם המוצר',pr=num(it.price)||0;
 const b=opt&&opt.brand||null,L=b&&T.brand!=='el'?layBox(b.lay,Wt,Ht):null,ib=L?L.ib:0,sc=L&&L.t?L.t.s:1;
 g.setTransform(1,0,0,1,0,0);g.fillStyle='#fff';g.fillRect(0,0,Wt,Ht);g.fillStyle='#000';g.strokeStyle='#000';
 if(L){put(g,bImg(b.logo),L.logo,L.t?'r':'c');put(g,bImg(b.stamp),L.stamp,L.t?'l':'c');if(L.t)g.setTransform(L.t.s,0,0,L.t.s,L.t.dx,L.t.dy)}
 const code=String(it.code||'').trim(),hasBc=!!(code&&barsFor(code).bars),pp=num(it.pp),pk=String(it.pack||'').trim();
 const cond=c=>!c||(c==='bc'?hasBc:c==='!bc'?!hasBc:c==='pp'?pp!=null:c==='!pp'?pp==null:c==='pack'?!!pk:c==='!pack'?!pk:true);
 const over=(e,t,mx)=>{if(m&&g.measureText(t).width>mx+.5)(m[e.id]=m[e.id]||{}).over=true};
 for(const e of T.els){if(!cond(e.if))continue;
  const al=e.al||DAL[e.t]||'c',fw=e.fw||(e.t==='reg'?500:e.t==='unit'?600:700),ff=fw===800?700:fw,cy=e.y+e.h/2,mx=e.w-(e.ib===1&&ib?2*ib:0);
  const X=(hw)=>al==='r'?e.x+e.w:al==='l'?e.x+(hw||0):e.x+(hw||0)+(e.w-(hw||0))/2;
  const put1=(t,x,y,dir)=>{txt(g,t,x,y,AL[al],dir);if(fw===800){const s=parseFloat(g.font.split(' ')[1])||20;g.lineWidth=Math.max(1,s*.05);g.lineJoin='round';g.strokeText(t,x,y)}};
  const cu=e.cur==null||e.cur==='sh'?SH:e.cur==='ils'?'₪':'',sfx=v=>fmtP(v)+(cu?' '+cu:'');
  const grey=t=>{if(!prev)return;g.fillStyle='#888';fit(g,t,mx,Math.round((e.fs||32)*.75),Math.max(8,(e.min||16)-2),500);txt(g,t,X(),cy,AL[al]);g.fillStyle='#000'};
  const line=(t)=>{fit(g,t,mx,e.fs||40,e.min||14,ff);over(e,t,mx);put1(t,X(),cy)};
  try{switch(e.t){
  case 'name':{const fs=(e.fs||40)*(e.k===0?1:k),mn=e.min||14,hw=e.hlIn?hlBox(g,it.hl,e.y,e.hh||e.h,e.x):0,w=e.w-hw;
   if(e.fit==='wrap2'){const w2=wrap2(g,nm,w,fs,mn,ff),lh=w2.s*1.12;fnt(g,w2.s,ff);const y1=e.y1!=null?e.y1:cy,y2=e.y2!=null?e.y2:cy-lh/2;
    w2.ln.forEach((l,i)=>{over(e,l,w);put1(l,X(hw),w2.ln.length===1?y1:y2+i*lh)})}
   else{fit(g,nm,w,fs,mn,ff);over(e,nm,w);put1(nm,X(hw),cy)}break}
  case 'price':{const v=e.src==='sale'&&pp!=null?pp:pr;
   if(e.sty==='line')line((e.lbl?e.lbl+' ':'')+sfx(v));else bigP(g,v,X(),cy,e.fs||96,mx,cu,al==='c'?'':al);break}
  case 'reg':{const lb=e.lbl!=null?e.lbl:'מחיר רגיל',ps=sfx(pr),gp=lb?12:0,f0=e.fs||34;let f=f0;fnt(g,f,ff);
   while(f>(e.min||16)&&g.measureText(lb).width+gp+g.measureText(ps).width>mx){f-=2;fnt(g,f,ff)}
   const lw=g.measureText(lb).width,pw=g.measureText(ps).width,tot=lw+gp+pw,r=al==='r'?e.x+e.w:al==='l'?e.x+tot:e.x+e.w/2+tot/2,th=Math.max(2,Math.round(f0*4/34)),dy=Math.round(f0*3/34);
   txt(g,lb,r,cy);txt(g,ps,r-lw-gp,cy);g.fillRect(r-lw-gp-pw-3,cy-dy,pw+6,th);break}
  case 'unit':{const u=unitPrice(it.price,it.pack);if(u)line(`מחיר ל-${u.per}: ${sfx(u.v)}`);else if(e.ph)grey('הקלידו גודל אריזה (למשל 500 גרם)');break}
  case 'pack':if(pk)line(pk);break;
  case 'text':if(e.txt)line(e.txt);break;
  case 'exp':{const ex=String(it.ex||'').trim(),lb=e.lbl!=null?e.lbl:'בתוקף עד';if(ex)line((lb?lb+' ':'')+ex);else grey((lb?lb+' ':'')+'__.__');break}
  case 'multi':{const q=Math.floor(+it.mq),p=num(it.mp),c=e.cur==null?'₪':cu;if(q>=2&&q<=99&&p!=null)line(`${q} ב-${fmtP(p)}${c?' '+c:''}`);else grey(`2 ב-20${c?' '+c:''}`);break}
  case 'hl':hlBox(g,it.hl,e.y,e.h,e.x);break;
  case 'bc':{let x=e.x,w=e.w;if(e.ib==='nx'&&ib){const a=Math.max(x,M+ib);w=Math.min(x+w,Wt-M-ib)-a;x=a}
   bcode(g,it.code,x,e.y,w,e.h,e.dgs===0?0:(e.dg||0),rects);if(m&&hasBc)(m[e.id]=m[e.id]||{}).mod=Math.max(1,Math.floor(w/(barsFor(code).bars.length+20)))*sc;break}
  case 'line':{const sw=e.sw||3;if(e.w>=e.h)g.fillRect(e.x,cy-sw/2,e.w,sw);else g.fillRect(e.x+e.w/2-sw/2,e.y,sw,e.h);break}
  case 'rect':{const sw=e.sw||3;g.lineWidth=sw;g.strokeRect(e.x+sw/2,e.y+sw/2,e.w-sw,e.h-sw);break}
  case 'box':{g.fillRect(e.x,e.y,e.w,e.h);if(e.txt){g.fillStyle='#fff';const fs=e.fs||40;fit(g,e.txt,e.w-16,fs,e.min||14,ff);txt(g,e.txt,X(),cy+Math.round(fs*.035),AL[al]);g.fillStyle='#000'}break}
  case 'logo':case 'stamp':if(b&&T.brand==='el')put(g,bImg(b[e.t]),[e.x,e.y,e.w,e.h],al==='c'?'c':al);break}}catch(x){}}
 if(L&&L.t){g.setTransform(1,0,0,1,0,0);if(rects){const X=xfRects(rects,L.t);rects.length=0;X.forEach(r=>rects.push(r))}}
 return rects}
// תבנית מקורית (מספר 1..5) – draw() כמו היום; תבנית בפורמט החדש (אובייקט) – drawT
const render=(g,ref,it,opt)=>ref&&typeof ref==='object'?drawT(g,ref,it,opt):draw(g,ref,it,opt);

/* =================== המסך =================== */
const S={P:null,pB:0,pErr:'',pNo:0,M:null,mB:0,mErr:'',q:'',hits:null,nf:null,cur:null,tpl:1,qty:1,br:'',B:null,C:null,cB:0,c0:0,bOn:null,bLay:null,inV:0,D:null,T:null,Ls:null,Q:null,tB:0,t0:0,tU:0};
const BK='lp-lbl-basket';
const mgr=()=>(typeof isA==='function'&&isA())||!!(SY&&SY.sa);
const ok=()=>!!SY&&!SY.mg&&(mgr()||(typeof isW==='function'&&isW()&&!!(SY.perms&&SY.perms.lbl===true)));
const dec=d=>Object.assign({id:idOf(d)},Object.fromEntries(Object.entries(d.fields||{}).map(([k,v])=>[k,fvj(v)])));
const typing=()=>{const a=document.activeElement;return!!(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)&&a.closest('#main'))};
const redraw=()=>{try{const v=cur().v;if((v==='lbl'||(/^lblD/.test(v)&&!(root.LblDesign&&LblDesign.busy())))&&!typing()&&!document.querySelector('#dlg[open]'))rerender()}catch(e){}};
// שורת סל: {it,tpl,n,T?} – T עותק התבנית (מה שבסל הוא מה שיודפס). בלי T – תבנית מקורית 1..5 (draw)
const bkGet=()=>{if(S.B)return S.B;try{const a=JSON.parse(localStorage.getItem(BK)||'[]');S.B=Array.isArray(a)?a.filter(x=>{if(!x||!x.it)return false;if(x.T){x.T=rowT(x.T);return!!x.T}return TPL.some(t=>t[0]===x.tpl)}):[]}catch(e){S.B=[]}return S.B};
const bkSave=()=>{try{localStorage.setItem(BK,JSON.stringify(S.B||[]))}catch(e){}};
const brs=()=>typeof brList==='function'?brList():[];
const brNow=()=>{const B=brs();if(!B.length)return '_';if(!B.some(b=>b.id===S.br))S.br=B[0].id;return S.br};
const unitP=(p,br)=>{const v=p&&p.bp&&typeof p.bp==='object'?p.bp[br]:undefined;return typeof v==='number'?v:(+(p&&p.price)||0)}; // כמו unitP ב-orders-staff.js
const inv=()=>S.P==='ox'?(window.__ox&&window.__ox.P||[]):(S.P||[]);
const rid=()=>{const a=new Uint8Array(12);crypto.getRandomValues(a);return 'm'+[...a].map(x=>x.toString(36).padStart(2,'0')).join('').slice(0,22)};
const oxOn=()=>!!(window.__oxOn&&window.__oxOn()); // מוצר חדש / עריכה במלאי – אותה הרשאה של "מוצר חדש" במסך המלאי
/* לוגו וכשרות: הגדרה אחת לעסק במסמך cfg/lbl (קריאה: צוות, כתיבה: מנהל). עותק במכשיר lp-lbl-brand-<bizId>.
   S.C – ההגדרה; S.bOn/S.bLay – בחירה להדפסה הנוכחית (null = ברירת המחדל), מתאפסת בכל כניסה למסך */
const BRK=()=>'lp-lbl-brand-'+(SY&&SY.bizId||'');
const cfgOk=o=>({logo:imgOk(o&&o.logo)?o.logo:'',stamp:imgOk(o&&o.stamp)?o.stamp:'',lay:o&&o.lay==='bot'?'bot':'top',on:!(o&&o.on===false)});
const bC=()=>S.C||cfgOk(null),bHas=c=>!!(c.logo||c.stamp);
const bOn=()=>S.bOn!=null?S.bOn:bC().on,bLay=()=>S.bLay||bC().lay;
const bOpt=()=>{const c=bC();return bHas(c)&&bOn()?{lay:bLay(),logo:c.logo,stamp:c.stamp}:null};
/* לארג' פעמי (העסק הרגיל של ה-APK): לוגו וחותמת הבד"ץ מ-lbl-def/ – רק כשב-cfg/lbl אין שדה logo / stamp (מחיקה בהגדרות שומרת '' – ואז לא מוצג). עסק אחר – לעולם לא */
const LPD={logo:'lbl-def/lp-logo.png',stamp:'lbl-def/edah-stamp.png'},LPU={};
const isLP=()=>!!SY&&!SY.mg&&(SY.bizId===(typeof BZ0!=='undefined'?BZ0:'larg'+'peami')||(typeof BZOK==='function'&&!BZOK(SY.bizId)));
const lpUrl=async k=>{if(LPU[k]!=null)return LPU[k];let u='';try{const b=await(await fetch(LPD[k])).blob();u=await new Promise(r=>{const f=new FileReader();f.onload=()=>r(String(f.result||''));f.onerror=()=>r('');f.readAsDataURL(b)})}catch(e){}return LPU[k]=imgOk(u)?u:''};
async function lpDef(c,raw){if(!isLP())return c;for(const k of ['logo','stamp'])if(!(raw&&typeof raw[k]==='string'))c[k]=await lpUrl(k);return c}
async function loadCfg(){if(S.cB)return;S.cB=1;if(!S.C){try{const o=JSON.parse(localStorage.getItem(BRK())||'null');if(o&&typeof o==='object')S.C=cfgOk(o)}catch(e){}}
 try{let d=null;try{d=await fsx('/cfg/lbl')}catch(e){if(!e||e.code!==404)throw e}const raw=d&&d.fields?dec(d):null;S.C=await lpDef(cfgOk(raw),raw);try{localStorage.setItem(BRK(),JSON.stringify(S.C))}catch(e){}}
 catch(e){if(!S.C)S.C=await lpDef(cfgOk(null),null)}finally{S.cB=0;S.c0=1;const b=bOpt();ensureImgs(b).then(redraw);redraw()}}

/* תבניות (lblt) והגדרות (lbls/main): עותק במכשיר lp-lbl-tpl-<bizId> = {L: תבניות, s: {sz,def}, q: שמירות שלא הגיעו לענן}.
   שמירה שנכשלה (403 / בלי חיבור / שגיאת שרת) – נשמרת במכשיר בלבד ונשלחת שוב בכל כניסה למסך. נטען מחדש בכל כניסה */
const TK=()=>'lp-lbl-tpl-'+(SY&&SY.bizId||'');
const rowT=T=>T&&typeof T==='object'?LblTpl.tplOk({id:T.id,v:1,name:T.name||'תבנית',w:T.w,h:T.h,base:T.base||undefined,j:LblTpl.toJ(T),del:T.del,at:T.at}):null;
const tKeep=()=>{try{localStorage.setItem(TK(),JSON.stringify({L:S.T||[],s:S.Ls||LblTpl.lblsOk(null),q:S.Q||[]}))}catch(e){}};
const umask=K=>K.map(k=>'updateMask.fieldPaths='+k).join('&');
const tPut=q=>q.k==='t'?fsx('/lblt/'+q.T.id+'?'+umask(LblTpl.MASK),{method:'PATCH',body:JSON.stringify({fields:LblTpl.fields(q.T,SY.uid,q.T.at)})}) // at בענן = at במכשיר (בדיקת "עודכן במכשיר אחר" בעורך)
 :fsx('/lbls/main?'+umask(['sz','def','at','by']),{method:'PATCH',body:JSON.stringify({fields:LblTpl.sFields(q.s,SY.uid)})});
const qOk=e=>!!e&&(e.code===403||e.offline||!e.code||e.code>=500);
async function tFlush(){const Q=S.Q||[];if(!Q.length)return;const keep=[];let stop=0;for(const q of Q){if(stop){keep.push(q);continue}try{await tPut(q)}catch(e){keep.push(q);if(e&&e.offline)stop=1}}S.Q=keep;tKeep()}
async function loadTpl(){if(S.tB)return;S.tB=1;
 if(!S.T){let o={};try{o=JSON.parse(localStorage.getItem(TK())||'null')||{}}catch(e){}S.T=(Array.isArray(o.L)?o.L:[]).map(rowT).filter(Boolean);S.Ls=LblTpl.lblsOk(o.s);S.Q=Array.isArray(o.q)?o.q.filter(x=>x&&(x.k==='s'||(x.k==='t'&&(x.T=rowT(x.T))&&LblTpl.ID_OK.test(x.T.id)))):[]}
 try{await tFlush();const r=await fsx(':runQuery',{method:'POST',body:JSON.stringify({structuredQuery:{from:[{collectionId:'lblt'}],limit:LblTpl.LIM.tpls*2}})});
  let L=(r||[]).filter(x=>x.document).map(x=>LblTpl.tplOk(dec(x.document))).filter(Boolean),s=null;
  try{const d=await fsx('/lbls/main');s=d&&d.fields?dec(d):null}catch(e){if(!e||e.code!==404)throw e}
  for(const q of S.Q){if(q.k==='t')L=L.filter(t=>t.id!==q.T.id).concat([q.T]);else s=q.s} // שמירות שממתינות – גוברות
  S.T=L;S.Ls=LblTpl.lblsOk(s);tKeep()}
 catch(e){}finally{S.tB=0;S.t0=1;tDef();redraw()}}
// שמירה (לעורך): 'ok' – בענן; 'dev' – במכשיר בלבד, תישלח שוב. שגיאה אחרת (למשל 400) – נזרקת
async function tSave(T){const t=rowT(Object.assign({},T,{at:Date.now()}));if(!t||!LblTpl.ID_OK.test(t.id))throw new Error('תבנית לא תקינה');
 S.T=(S.T||[]).filter(x=>x.id!==t.id).concat([t]);S.Q=(S.Q||[]).filter(x=>!(x.k==='t'&&x.T.id===t.id));const q={k:'t',T:t};
 try{await tPut(q);tKeep();return 'ok'}catch(e){if(!qOk(e)){tKeep();throw e}S.Q.push(q);tKeep();return 'dev'}}
async function sSave(v){v=LblTpl.lblsOk(v);S.Ls=v;S.Q=(S.Q||[]).filter(x=>x.k!=='s');const q={k:'s',s:v};
 try{await tPut(q);tKeep();return 'ok'}catch(e){if(!qOk(e)){tKeep();throw e}S.Q.push(q);tKeep();return 'dev'}}
// רשימת התבניות במסך: 1..5 (תבנית ערוכה עם base מחליפה את המקורית) ואחריהן "משלך" ('c:<id>'). T=null – draw() המקורי
const tList=()=>{const A=(S.T||[]).filter(t=>!t.del);return TPL.map(([n,l])=>({r:n,l,T:A.find(t=>t.base===n)||null})).concat(A.filter(t=>!t.base).sort((a,b)=>a.name.localeCompare(b.name,'he')).map(t=>({r:'c:'+t.id,l:t.name,T:t})))};
const tOf=r=>{const x=tList().find(e=>e.r===r);return x?x.T:null};
const tDef=()=>{const d=S.Ls&&S.Ls.def;if(S.tU||!d)return;const r=/^b[1-5]$/.test(d)?+d[1]:'c:'+d;if(tList().some(x=>x.r===r))S.tpl=r};
const szT=(w,h)=>'\u2066'+w+'×'+h+'\u2069'; // גודל בתוך טקסט עברי – בלי היפוך (40×30 ולא 30×40)
async function loadInv(){if(S.pB)return;S.pB=1;S.pErr='';try{
 if(!bzF('orders')){S.P=[];S.pNo=1;return}
 const ox=window.__ox;if(ox&&Array.isArray(ox.P)&&ox.P.length){S.P='ox';return}
 if(typeof window.__oxLoadAll==='function'&&wp('ord')){try{await window.__oxLoadAll()}catch(e){}if(window.__ox&&Array.isArray(window.__ox.P)){S.P='ox';return}}
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
function pick(x){const p=x.p;S.cur={s:x.s,id:p.id,name:String(p.name||''),price:String(x.s==='m'?(+p.price||0):unitP(p,brNow())),code:String(p.barcode||''),fs:100,hl:'',pp:'',pack:String(p.pack||''),ex:'',mq:'',mp:''};
 S.hits=null;S.nf=null;S.qty=1;rerender();setTimeout(()=>{const e=document.getElementById('lblEd');if(e)e.scrollIntoView({block:'start'})},30)}
function onScan(c){try{if(!ok()||cur().v!=='lbl'||document.querySelector('#dlg[open]'))return;lookup(c)}catch(e){}}
// סורק USB: מאזינים רק כשהמסך פתוח (בדיקה כל שנייה; ביציאה – עצירה), כדי לא להשפיע על מסכים אחרים
let scStop=null,scT=0;
function scOn(){if(scStop||!window.PosBarcode||!PosBarcode.listen)return;try{scStop=PosBarcode.listen(onScan,{beep:true})}catch(e){scStop=null;return}
 scT=setInterval(()=>{let on=false;try{on=cur().v==='lbl'}catch(e){}if(!on){clearInterval(scT);scT=0;try{scStop()}catch(e){}scStop=null}},1000)}

const refOf=v=>/^[1-5]$/.test(v)?+v:String(v||'');
const prevs=()=>{const it=S.cur;if(!it)return;const b=bOpt(),go=()=>document.querySelectorAll('#main canvas[data-lbl-t]').forEach(c=>{try{const r=refOf(c.dataset.lblT);render(c.getContext('2d'),tOf(r)||r,it,b?{prev:1,brand:b}:{prev:1})}catch(e){}});
 go();if(b)ensureImgs(b).then(()=>{if(cur().v==='lbl')go()});try{if(document.fonts&&document.fonts.ready)document.fonts.ready.then(()=>{if(cur().v==='lbl')go()})}catch(e){}};
let raf=0;const prevSoon=()=>{if(raf)return;raf=requestAnimationFrame(()=>{raf=0;prevs()})};
const cv=(r,T)=>{const D=T?LblTpl.dims(T.w,T.h):{W,H};return `<canvas data-lbl-t="${esc(String(r))}" width="${D.W}" height="${D.H}" style="width:100%;height:auto;display:block;background:#fff;border-radius:6px"></canvas>`};
const ef=(l,k,v,x)=>`<label class="f" style="margin:0"><span>${l}</span><input data-i="lblE" data-k="${k}" value="${esc(v==null?'':v)}" autocomplete="off" ${x||''}></label>`;

V.lbl=()=>{const T='הדפסת מדבקות';if(!ok())return{t:T,h:'<div class="empty">אין לך הרשאה להדפסת מדבקות</div>'};
 if(!S.inV){S.inV=1;S.bOn=null;S.bLay=null;S.t0=0;const t=setInterval(()=>{let on=false;try{on=cur().v==='lbl'}catch(e){}if(!on){clearInterval(t);S.inV=0}},1000)} // בחירת הלוגו להדפסה – מתאפסת בכל כניסה
 if(!S.c0&&!S.cB)setTimeout(loadCfg,0);if(!S.t0&&!S.tB)setTimeout(loadTpl,0);if(S.t0&&typeof S.tpl==='string'&&!tOf(S.tpl))S.tpl=1;scOn();if(S.P===null&&!S.pB)setTimeout(loadInv,0);if(S.M===null&&!S.mB)setTimeout(loadMan,0);
 const BR=brs(),it=S.cur;
 const st=S.P===null||S.pB?'טוען מלאי…':S.pNo?'המלאי זמין כשתוספת ההזמנות פעילה בעסק. אפשר להקליד מוצר ידני.':S.pErr?S.pErr:`${inv().length} מוצרים במלאי`;
 let h=`<div class="card"><form data-f="lblQ" autocomplete="off"><label class="f" style="margin:0"><span>ברקוד או שם מוצר</span><input name="q" data-i="lblQ" data-pos-scan value="${esc(S.q)}" placeholder="סרקו, הקלידו ברקוד או התחילו לכתוב שם" enterkeyhint="search"></label>
  <div class="row" style="margin-top:8px;gap:8px"><button class="btn grow">חפש</button><label class="btn g grow" style="cursor:pointer;text-align:center">צלם ברקוד<input type="file" accept="image/*" capture="environment" data-c="lblCam" hidden></label></div></form>
  ${BR.length>1?`<label class="f" style="margin:8px 0 0"><span>מחיר לפי סניף</span><select data-c="lblBr">${BR.map(b=>`<option value="${esc(b.id)}"${b.id===brNow()?' selected':''}>${esc(b.name)}</option>`).join('')}</select></label>`:''}
  <small class="note" style="display:block;margin-top:6px">${esc(st)}${S.M&&S.M.length?' · '+S.M.length+' מוצרים ידניים':''}${S.mErr?' · '+esc(S.mErr):''} · סורק USB עובד גם בלי ללחוץ על התיבה</small>
  <div id="lblHits" style="margin-top:6px">${S.hits&&S.hits.length?hitsH(S.hits):(!S.hits&&S.q&&!it&&!S.nf?hitsH(find(S.q)):'')}</div>${S.hits&&S.hits.length?(oxOn()?'<button class="chip" style="margin-top:6px" data-a="lblNewInv">המוצר לא ברשימה – מוצר חדש במלאי</button> ':'')+'<button class="chip" style="margin-top:6px" data-a="lblNfGo">המוצר לא ברשימה – הוספת מוצר ידני</button>':''}</div>`;
 if(S.nf){const ox=oxOn();h+=`<div class="card" style="border:2px solid var(--acc)"><b>המוצר לא נמצא במלאי</b>${ox?'<p class="note" style="margin:4px 0 8px">אפשר להוסיף אותו למלאי (טופס המוצר המלא) – והמדבקה תוכן מיד.</p><button class="btn w" data-a="lblNewInv">מוצר חדש במלאי</button><p style="margin:12px 0 0"><b>או: מדבקה למוצר ידני</b> <small class="note">(בלי להוסיף למלאי)</small></p>':''}<p class="note" style="margin:4px 0 8px">הקלידו שם ומחיר. המוצר יישמר בענן ויופיע בחיפוש הבא בכל המכשירים של העסק.</p>
  <form data-f="lblNew" autocomplete="off">${fld('שם המוצר','name',S.nf.name,'text','required maxlength="120"')}<div class="row" style="gap:8px"><label class="f grow"><span>מחיר (₪)</span><input name="price" inputmode="decimal" required placeholder="0.00"></label><label class="f grow"><span>גודל אריזה (לא חובה)</span><input name="pack" maxlength="30" placeholder="500 גרם / 1.5 ליטר"></label></div>
  ${fld('ברקוד (לא חובה)','barcode',S.nf.barcode,'text','maxlength="40" dir="ltr" inputmode="numeric"')}<div class="row" style="gap:8px"><button class="btn${ox?' g':''} grow">שמור והמשך</button><button type="button" class="btn g grow" data-a="lblNfX">ביטול</button></div></form></div>`}
 if(it){const u=unitPrice(it.price,it.pack),nd=LblTpl.need(tOf(S.tpl));
  h+=`<div class="card" id="lblEd"><div class="sec" style="margin-top:0"><h3>עריכת המדבקה</h3>${it.s==='m'?'<span class="tag">מוצר ידני</span>':''}${it.s==='p'&&oxOn()?'<button class="btn s g" data-a="lblEditP">עריכת מוצר</button>':''}</div>${it.s==='p'?`<p class="note" id="lblPN" style="margin:0 0 8px">שינוי כאן חל רק על המדבקה.${oxOn()?' לשינוי מחיר במלאי, בקופה ובכספית לחצו "עריכת מוצר".':''}</p>`:''}
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px">${tList().map(x=>{const on=S.tpl===x.r,T=x.T,lab=(typeof x.r==='number'?x.r+'. '+x.l+(T?' (ערוכה)':''):esc(x.l))+(T&&!LblTpl.isDef(T.w,T.h)?` · ${szT(T.w,T.h)} מ"מ`:'');
   return `<button type="button" data-a="lblTpl" data-v="${esc(String(x.r))}" aria-pressed="${on}" style="padding:6px;border-radius:10px;border:2px solid ${on?'var(--acc)':'var(--line)'};background:transparent;color:inherit;cursor:pointer;font:inherit">${cv(x.r,T)}<small style="display:block;margin-top:4px${on?';color:var(--acc);font-weight:700':''}">${lab}</small></button>`}).join('')}</div>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;margin-top:10px">
  ${ef('שם המוצר','name',it.name,'maxlength="120"')}${ef('מחיר (₪)','price',it.price,'inputmode="decimal"')}${ef('ברקוד','code',it.code,'dir="ltr" maxlength="40"')}
  <label class="f" style="margin:0"><span>גודל השם</span><select data-c="lblFs">${[70,80,90,100,110,120,130,140].map(v=>`<option value="${v}"${+it.fs===v?' selected':''}>${v}%</option>`).join('')}</select></label>
  ${ef('מילה מודגשת (לא חובה)','hl',it.hl,'maxlength="14" placeholder="חדש! / מבצע"')}${ef('מחיר מבצע (תבנית 4)','pp',it.pp,'inputmode="decimal"')}${ef('גודל אריזה (תבנית 5)','pack',it.pack,'maxlength="30" placeholder="500 גרם"')}${nd.ex?ef('בתוקף עד','ex',it.ex,'maxlength="10" placeholder="31.12.26"'):''}${nd.mq?ef('מבצע כמות – יחידות (2–99)','mq',it.mq,'inputmode="numeric" maxlength="2" placeholder="2"')+ef('מבצע כמות – מחיר (₪)','mp',it.mp,'inputmode="decimal" placeholder="20"'):''}</div>
  <small class="note" id="lblU" style="display:block;margin-top:6px">${u?`מחיר ל-${u.per}: ${ils(u.v)}`:'מחיר ליחידה: הקלידו גודל אריזה (גרם, ק"ג, מ"ל, ליטר)'}${it.code&&!barsFor(it.code).bars?' · הברקוד לא תקין להדפסה':''}</small>
  <div class="row" style="gap:8px;margin-top:10px;align-items:flex-end"><label class="f" style="margin:0;max-width:120px"><span>כמות מדבקות</span><input type="number" min="1" max="999" step="1" inputmode="numeric" data-i="lblQty" value="${esc(String(S.qty))}"></label><button class="btn grow" data-a="lblAdd">הדפס</button><button class="btn g" data-a="lblX">ביטול</button></div>
  <div class="row" style="gap:6px;margin-top:6px;flex-wrap:wrap">${QN.map(v=>`<button type="button" class="chip" data-a="lblQn" data-v="${v}" aria-pressed="${+S.qty===v}">${v}</button>`).join('')}</div>
  ${it.s==='m'&&mgr()?'<button class="btn g s" style="margin-top:8px" data-a="lblMDel">מחק את המוצר הידני</button>':''}</div>`;
  setTimeout(prevs,0)}
 h+=brandH()+`<div class="card"><div class="row" style="gap:8px;align-items:center"><span class="grow"><b>עיצוב תבניות</b><small class="note" style="display:block">תבניות משלך, גדלים ותבנית ברירת מחדל</small></span><button class="btn s g" data-a="go" data-v="lblD">עיצוב תבניות</button></div></div>`;
 return{t:T,h}};

window.lblTile=k=>ok()?(k==='add'?`<button class="tile" data-a="addGo" data-v="lbl" style="font-size:1rem">${ico('doc')}הדפסת מדבקות</button>`:`<button class="tile" data-a="go" data-v="lbl" style="font-size:1.15rem;text-align:center;border-color:var(--acc);color:var(--acc)">${ico('doc')}הדפסת מדבקות</button>`):'';

INP.lblQ=el=>{S.q=el.value;S.hits=null;S.nf=null;const d=document.getElementById('lblHits');if(d)d.innerHTML=hitsH(find(S.q))};
FRM.lblQ=f=>{const i=f.querySelector('[name=q]');lookup(i?i.value:'')};
CHG.lblCam=async el=>{const f=el.files[0];el.value='';if(!f)return;if(typeof shDecode!=='function')return toast('הסריקה לא זמינה');toast('קורא ברקוד…');let c='';try{c=await shDecode(f)}catch(e){}
 if(!c)return toast('לא נקרא ברקוד. צלמו קרוב ובמיקוד, או הקלידו ידנית');lookup(c)};
CHG.lblBr=el=>{S.br=el.value;if(S.cur&&S.cur.s==='p'){const p=inv().find(x=>x.id===S.cur.id);if(p)S.cur.price=String(unitP(p,S.br))}rerender()};
ACT.lblPick=el=>{const s=el.dataset.s,id=el.dataset.id,p=(s==='m'?(S.M||[]):inv()).find(x=>x.id===id);if(p)pick({s,p})};
ACT.lblTpl=el=>{const v=String(el.dataset.v||'');S.tpl=/^[1-5]$/.test(v)?+v:/^c:[A-Za-z0-9_-]{1,40}$/.test(v)&&tOf(v)?v:1;S.tU=1;rerender()};
const QN=[1,10,20,50,100];
ACT.lblQn=el=>{const v=+el.dataset.v;if(!QN.includes(v))return;S.qty=v;const i=document.querySelector('#main [data-i=lblQty]');if(i)i.value=String(v);document.querySelectorAll('#main [data-a=lblQn]').forEach(b=>b.setAttribute('aria-pressed',String(+b.dataset.v===v)))};
ACT.lblX=()=>{S.cur=null;rerender()};ACT.lblNfGo=()=>{const t=String(S.q||'').trim();S.hits=null;S.nf=looksCode(t)?{barcode:t,name:''}:{barcode:'',name:t};rerender()};ACT.lblNfX=()=>{S.nf=null;rerender()};
INP.lblE=el=>{if(!S.cur)return;S.cur[el.dataset.k]=el.value;prevSoon();if(el.dataset.k==='price'||el.dataset.k==='pack'||el.dataset.k==='code'){const u=unitPrice(S.cur.price,S.cur.pack),n=document.getElementById('lblU');
 if(n)n.textContent=(u?`מחיר ל-${u.per}: ${ils(u.v)}`:'מחיר ליחידה: הקלידו גודל אריזה (גרם, ק"ג, מ"ל, ליטר)')+(S.cur.code&&!barsFor(S.cur.code).bars?' · הברקוד לא תקין להדפסה':'')}};
CHG.lblFs=el=>{if(S.cur){S.cur.fs=+el.value||100;prevs()}};
INP.lblQty=el=>{S.qty=el.value};
const pOk=v=>{const n=num(v);return n!=null&&n>=0&&n<=100000};
const mFields=x=>{const f={name:{stringValue:x.name},price:{doubleValue:x.price},at:{integerValue:String(Date.now())},by:{stringValue:SY.uid}};if(x.barcode)f.barcode={stringValue:x.barcode};if(x.pack)f.pack={stringValue:x.pack};return f};
async function mSave(x){const ex=x.barcode&&(S.M||[]).find(m=>m.barcode===x.barcode),id=x.id||(ex&&ex.id)||(/^[0-9A-Za-z-]{1,40}$/.test(x.barcode||'')?'bc_'+x.barcode:rid());
 const d=await fsx('/lblp/'+id,{method:'PATCH',body:JSON.stringify({fields:mFields(x)})});const m=d&&d.fields?dec(d):Object.assign({id},x);S.M=(S.M||[]).filter(q=>q.id!==m.id).concat([m]);return m}
ACT.lblAdd=async el=>{const it=S.cur;if(!it)return;const nm=String(it.name||'').trim();if(!nm)return toast('חסר שם מוצר');if(nm.length>120)return toast('שם המוצר: עד 120 תווים');
 if(!pOk(it.price))return toast('המחיר לא תקין');if(S.tpl===4&&!pOk(it.pp))return toast('בתבנית מבצע צריך מחיר מבצע');
 if(it.code&&!barsFor(it.code).bars)return toast('הברקוד לא תקין להדפסה (עד 40 תווים באנגלית ובספרות)');
 const n=Math.floor(+S.qty);if(!(n>=1&&n<=LblTpl.LIM.q))return toast('כמות: 1 עד 999');
 const T=tOf(S.tpl),nd=LblTpl.need(T),ex=String(it.ex||'').trim(),mq=String(it.mq||'').trim(),mp=String(it.mp||'').trim();
 if(nd.ex&&ex.length>LblTpl.LIM.ex)return toast('בתוקף עד: עד 10 תווים');
 if(nd.mq&&(mq||mp)&&!(/^\d{1,2}$/.test(mq)&&+mq>=2&&+mq<=99&&pOk(mp)))return toast('מבצע כמות: 2 עד 99 יחידות ומחיר תקין');
 const x={name:nm,price:String(num(it.price)),code:String(it.code||'').trim(),fs:+it.fs||100,hl:String(it.hl||'').trim().slice(0,14),pp:it.pp===''||it.pp==null?'':String(num(it.pp)),pack:String(it.pack||'').trim().slice(0,30)};
 if(nd.ex&&ex)x.ex=ex;if(nd.mq&&mq&&mp){x.mq=String(+mq);x.mp=String(num(mp))}
 const row={it:x,tpl:S.tpl,n};if(T)row.T=JSON.parse(JSON.stringify(T));
 const go=async()=>{if(!await lblGo(el,[row],{tot:n}))return;
 // מוצר ידני: גודל האריזה נשמר גם במוצר עצמו (בענן) לפעם הבאה
 if(it.s==='m'){const m=(S.M||[]).find(x=>x.id===it.id),pk=String(it.pack||'').trim().slice(0,30);if(m&&String(m.pack||'')!==pk){try{await mSave({id:m.id,name:String(m.name||'').slice(0,120),price:+m.price||0,barcode:m.barcode||'',pack:pk})}catch(e){toast('גודל האריזה לא נשמר בענן')}}}
 S.cur=null;S.q='';rerender();setTimeout(()=>{const q=document.querySelector('#main [name=q]');if(q)q.focus()},30)};
 if(n>LblTpl.LIM.ask)return ask(`להדפיס ${n} מדבקות?`,()=>{closeDlg();go()},'כן, הדפס');go()};
FRM.lblNew=async f=>{const x=fd(f),nm=String(x.name||'').trim(),bc=String(x.barcode||'').trim(),pk=String(x.pack||'').trim();
 if(!nm||nm.length>120)return toast('שם המוצר: 1 עד 120 תווים');if(!pOk(x.price))return toast('המחיר לא תקין');if(pk.length>30)return toast('גודל אריזה: עד 30 תווים');
 if(bc&&!/^[ -~]{1,40}$/.test(bc))return toast('ברקוד: עד 40 תווים באנגלית ובספרות');
 const b=f.querySelector('button');if(b)b.disabled=true;
 try{const m=await mSave({name:nm,price:num(x.price),barcode:bc,pack:pk});toast('המוצר נשמר');pick({s:'m',p:m})}catch(e){if(b)b.disabled=false;toast(e&&e.offline?'אין חיבור לאינטרנט':'השמירה נכשלה'+(e&&e.code===403?' (אין הרשאה)':''))}};
ACT.lblMDel=()=>{const it=S.cur;if(!it||it.s!=='m'||!mgr())return;ask('למחוק את המוצר הידני "'+it.name+'"?',async()=>{closeDlg();try{await fsx('/lblp/'+it.id,{method:'DELETE'});S.M=(S.M||[]).filter(x=>x.id!==it.id);S.cur=null;toast('נמחק');rerender()}catch(e){toast('המחיקה נכשלה')}},'כן, מחק')};
// הדפסה: מדבקה ייחודית אחת לכל שורה בסל (תמונה + פסים וקטוריים), עמוד לכל עותק
async function build(L,br,raw){if(br===undefined)br=bOpt();try{if(document.fonts&&document.fonts.load)await Promise.all([document.fonts.load(`700 40px ${F}`,'אבג 123'),document.fonts.load(`500 40px ${F}`,'אבג 123'),document.fonts.load(`600 40px ${F}`,'אבג 123')])}catch(e){}
 const c=document.createElement('canvas');c.width=W;c.height=H;const g=c.getContext('2d');
 await ensureImgs(br); // אותו brand ואותן תמונות של התצוגה
 let c2=null; // שורה עם T – drawT בגודל התבנית; גודל שאינו 50×25 – עמוד PDF בגודל שלה (pw/ph). בלי T – בדיוק כמו קודם
 const labels=L.map(b=>{const o=br?{rects:[],brand:br}:{rects:[]};if(b.T){const D=LblTpl.dims(b.T.w,b.T.h);if(!c2)c2=document.createElement('canvas');c2.width=D.W;c2.height=D.H;const g2=c2.getContext('2d');
   const rects=drawT(g2,b.T,b.it,o),lb={w:D.W,h:D.H,bits:toBits(g2.getImageData(0,0,D.W,D.H).data,D.W,D.H),rects};if(!LblTpl.isDef(b.T.w,b.T.h)){lb.pw=D.PW;lb.ph=D.PH}return lb}
  const rects=draw(g,b.tpl,b.it,o);return{w:W,h:H,bits:toBits(g.getImageData(0,0,W,H).data,W,H),rects}});
 return raw?{labels,seq:expand(L)}:mkPdf(labels,expand(L))}
// PDF → חלון ההדפסה (בטלפון – PdfPrint; בדפדפן – חלון חדש). גם להדפסת ניסיון בעורך
async function pOut(pdf,C){if(C===undefined)C=typeof shNat==='function'?shNat():null;
 if(C&&C.Plugins&&C.Plugins.PdfPrint)await C.Plugins.PdfPrint.print({name:'labels',data:shB64(pdf)});
 else{const w=window.open(URL.createObjectURL(new Blob([pdf],{type:'application/pdf'})),'_blank');if(!w)toast('הדפדפן חסם את החלון. אפשרו חלונות קופצים ונסו שוב')}}
// במחשב: עמוד תמונות בגודל המדבקה במסגרת נסתרת + print(). בכרום שנפתח עם --kiosk-printing זה יוצא ישר למדפסת, בלי חלון.
// בלי הדגל – חלון ההדפסה של כרום (בלי לשונית חדשה). בטלפון ובדפדפן נייד – ה-PDF כמו קודם
const isDesk=()=>!/Android|iPhone|iPad|Mobi/i.test(navigator.userAgent||'');
// תמונת הטקסט להדפסה במחשב: אותו ציור (draw/drawT) בפי HK ברזולוציה, עם החלקת קצוות (בלי סף שחור-לבן) – מנהל ההתקן ממיר לנקודות המדפסת.
// setTransform בתוך הציור מוחלט – העטיפה מכפילה אותו ב-HK. הפסים לא מצוירים כאן (rects) – הם SVG
const HK=3;
const hiCtx=(g,k)=>{g.setTransform(k,0,0,k,0,0);return new Proxy(g,{get(t,p){if(p==='setTransform')return(a,b,c,d,e,f)=>t.setTransform(a*k,b*k,c*k,d*k,e*k,f*k);const v=t[p];return typeof v==='function'?v.bind(t):v},set(t,p,v){t[p]=v;return true}})};
const hiPng=(b,br)=>new Promise((ok,no)=>{const D=b.T?LblTpl.dims(b.T.w,b.T.h):{W,H},c=document.createElement('canvas');c.width=D.W*HK;c.height=D.H*HK;const x=c.getContext('2d');x.imageSmoothingQuality='high';const g=hiCtx(x,HK),o=br?{rects:[],brand:br}:{rects:[]};
 if(b.T)drawT(g,b.T,b.it,o);else draw(g,b.tpl,b.it,o);x.setTransform(1,0,0,1,0,0);
 c.toBlob(q=>q?ok(URL.createObjectURL(q)):no(new Error('התמונה לא נוצרה')),'image/png')});
// פסי הברקוד – SVG וקטורי (כמו ב-PDF): כרום מצייר אותם ברזולוציה של המדפסת, בלי עיוות של הקטנת תמונה
const svgOf=lb=>`<svg viewBox="0 0 ${lb.w} ${lb.h}" preserveAspectRatio="none" shape-rendering="crispEdges">${(lb.rects||[]).map(r=>`<rect x="${+r[0].toFixed(2)}" y="${+r[1].toFixed(2)}" width="${+r[2].toFixed(2)}" height="${+r[3].toFixed(2)}"/>`).join('')}</svg>`;
const PSC=0.92,PUP=0.8; // הקטנה קלה במרכז + הזזה למעלה (מ"מ) – שלא ייחתך בתחתית המדבקה (Citizen CL-E321E)
async function htmlPrint(labels,seq,L,br){const U=await Promise.all(L.map(b=>hiPng(b,br))),SV=labels.map(svgOf),mm=v=>(v*25.4/72).toFixed(2),l0=labels[0]||{},wm=mm(l0.pw||PW),hm=mm(l0.ph||PH);
 const old=document.getElementById('lblPf');if(old)old.remove();
 const f=document.createElement('iframe');f.id='lblPf';f.setAttribute('aria-hidden','true');f.tabIndex=-1;f.style.cssText='position:fixed;left:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none';
 document.body.appendChild(f);const D=f.contentDocument;
 D.open();D.write(`<!doctype html><html><head><meta charset="utf-8"><title>labels</title><style>@page{size:${wm}mm ${hm}mm;margin:0}html,body{margin:0;padding:0;background:#fff}.p{width:${wm}mm;height:${hm}mm;overflow:hidden;position:relative}.p+.p{break-before:page}.i{position:absolute;left:${(1-PSC)*50}%;top:calc(${(1-PSC)*50}% - ${PUP}mm);width:${PSC*100}%;height:${PSC*100}%}.i img,.i svg{position:absolute;inset:0;width:100%;height:100%;display:block}.i svg{fill:#000}</style></head><body>${seq.map(i=>`<div class="p"><div class="i"><img src="${U[i]}" alt="">${SV[i]}</div></div>`).join('')}</body></html>`);D.close();
 await Promise.all(Array.from(D.images).map(im=>im.complete?0:new Promise(r=>{im.onload=im.onerror=r})));
 f.contentWindow.focus();f.contentWindow.print();
 setTimeout(()=>{if(document.getElementById('lblPf')===f)f.remove();U.forEach(u=>URL.revokeObjectURL(u))},120000)}
async function lblGo(el,L,g){if(el)el.disabled=true;toast('מכין להדפסה…');API.last=L; // last – השורות שנשלחו אחרונות (לבדיקות)
 try{const C=typeof shNat==='function'?shNat():null;
  if(!(C&&C.Plugins&&C.Plugins.PdfPrint)&&isDesk()){const br=bOpt(),r=await build(L,br,true);await htmlPrint(r.labels,r.seq,L,br)}
  else await pOut(await build(L),C);
  toast('נשלח להדפסה'+(g&&g.tot?' ('+g.tot+' מדבקות)':''));return true}
 catch(e){toast('ההדפסה נכשלה: '+(e&&e.message||e));return false}finally{if(el)el.disabled=false}}
/* ---------- מוצר חדש במלאי / עריכת מוצר (טופס המוצר המלא של orders-staff.js) ---------- */
const pOf=(id,d)=>inv().find(x=>x.id===id)||(window.__ox&&window.__ox.P||[]).find(x=>x.id===id)||Object.assign({id},d||{});
ACT.lblNewInv=()=>{if(!oxOn()||typeof window.__oxNewP!=='function')return;const t=String(S.q||'').trim(),nf=S.nf||(looksCode(t)?{barcode:t,name:''}:{barcode:'',name:t}),f=document.querySelector('#main form[data-f=lblNew]');
 const nm=String(f&&f.elements.name?f.elements.name.value:nf.name||'').trim().slice(0,60);let bc=String(f&&f.elements.barcode?f.elements.barcode.value:nf.barcode||'').trim();
 if(bc&&!/^[0-9A-Za-z-]{3,30}$/.test(bc)){bc='';toast('הברקוד לא מתאים למלאי (3 עד 30 ספרות / אותיות) – לא מולא')}
 window.__oxNewP({name:nm,barcode:bc},(id,d)=>{const P=window.__ox&&window.__ox.P;if(S.P!=='ox'&&Array.isArray(P)&&P.length)S.P='ox';pick({s:'p',p:pOf(id,d)})})};
ACT.lblEditP=async()=>{const it=S.cur;if(!it||it.s!=='p'||!oxOn()||typeof window.__oxEditP!=='function')return;
 const r=await window.__oxEditP(it.id,(id,d)=>{const c=S.cur;if(!c||c.s!=='p'||c.id!==id)return;const p=pOf(id,d); // נשמרים: תבנית, גודל השם, מילה מודגשת, מחיר מבצע
  c.name=String(p.name||'');c.price=String(unitP(p,brNow()));c.code=String(p.barcode||'');if(p.pack)c.pack=String(p.pack);rerender()});
 if(r===false)toast('המוצר לא נמצא במלאי')};
/* ---------- לוגו וכשרות: שורה מעל הסל + הגדרות (מנהל) ---------- */
const LAYS=[['top','פס עליון'],['bot','בפינות למטה']];
const SAMPLE={name:'שם המוצר (דוגמה)',price:'12.90',code:'5901234123457',fs:100,hl:'',pp:'',pack:''};
function brandH(){const c=bC(),M=mgr(),set=M?'<button class="btn s g" data-a="lblBSet">הגדרות</button>':'';if(!bHas(c))return M?`<div class="card"><div class="row" style="gap:8px;align-items:center"><b class="grow">לוגו וכשרות</b>${set}</div><small class="note">עדיין לא הועלו לוגו או חותמת כשרות</small></div>`:'';
 const on=bOn();return `<div class="card"><div class="row" style="gap:8px;align-items:center;flex-wrap:wrap"><label class="cb grow" style="min-height:44px;display:flex;align-items:center;gap:6px"><input type="checkbox" data-c="lblBOn"${on?' checked':''}> <b>לוגו וכשרות</b></label>${on?`<select data-c="lblBLay" aria-label="פריסה">${LAYS.map(([v,l])=>`<option value="${v}"${bLay()===v?' selected':''}>${l}</option>`).join('')}</select>`:''}${set}</div><small class="note">חל על כל ההדפסה הזו. בכל כניסה למסך – חוזר לברירת המחדל של העסק.</small></div>`}
CHG.lblBOn=el=>{S.bOn=!!el.checked;rerender()};
CHG.lblBLay=el=>{S.bLay=el.value==='bot'?'bot':'top';rerender()};
// עיבוד תמונה: עד 240×120, שחור-לבן (bw1), PNG; מקטינים שוב אם מעל ~30KB
function bProc(src,thr){const w=src.naturalWidth||src.width,h=src.naturalHeight||src.height;if(!w||!h)return '';let k=Math.min(1,240/w,120/h);
 for(let n=0;n<8;n++){const cw=Math.max(1,Math.round(w*k)),ch=Math.max(1,Math.round(h*k)),c=document.createElement('canvas');c.width=cw;c.height=ch;const g=c.getContext('2d');g.drawImage(src,0,0,cw,ch);
  const d=g.getImageData(0,0,cw,ch);bw1(d.data,cw,ch,thr);g.putImageData(d,0,0);const u=c.toDataURL('image/png');if(imgOk(u))return u;k*=.8}return ''}
const ldImg=u=>new Promise((r,j)=>{const i=new Image();i.onload=()=>r(i);i.onerror=()=>j(new Error('img'));i.src=u});
const bRow=(k,l)=>{const D=S.D,v=D[k];return `<div style="border:1px solid var(--line);border-radius:10px;padding:8px;margin-bottom:8px"><b>${l}</b>
 <div style="margin:6px 0">${v?`<img id="lblBI-${k}" src="${esc(v)}" alt="${l} בשחור-לבן" style="max-width:160px;max-height:80px;background:#fff;border-radius:4px;padding:2px;display:block">`:'<small class="note">לא הועלה</small>'}</div>
 <div class="row" style="gap:6px;flex-wrap:wrap"><label class="btn s g" style="cursor:pointer">העלאה<input type="file" accept="image/*" data-c="lblBUp" data-k="${k}" hidden></label>${k==='logo'&&typeof bzLastO==='function'&&bzLastO()?'<button type="button" class="btn s g" data-a="lblBBiz">השתמש בלוגו העסק</button>':''}${v?`<button type="button" class="btn s g" data-a="lblBDel" data-k="${k}">מחיקה</button>`:''}</div>
 ${D.src[k]?`<label class="f" style="margin:6px 0 0"><span>בהירות (שחור-לבן)</span><input type="range" min="40" max="240" step="5" value="${280-D.thr[k]}" data-i="lblBThr" data-k="${k}"></label>`:''}</div>`};
function bDlg(){const D=S.D;dlg(`<h3>הגדרות לוגו וכשרות</h3><p class="note" style="margin-top:0">לכל העסק, בכל המכשירים. המדפסת מדפיסה בשחור-לבן – כך זה ייראה במדבקה.</p>${bRow('logo','לוגו')}${bRow('stamp','חותמת כשרות')}
 <label class="f"><span>פריסה כברירת מחדל</span><select data-c="lblBDLay">${LAYS.map(([v,l])=>`<option value="${v}"${D.lay===v?' selected':''}>${l}</option>`).join('')}</select></label>
 <label class="cb" style="min-height:44px;display:flex;align-items:center;gap:6px"><input type="checkbox" data-c="lblBDOn"${D.on?' checked':''}> להדפיס לוגו וכשרות כברירת מחדל</label>
 <p class="note" style="margin:6px 0 4px">דוגמה בשתי הפריסות:</p><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${LAYS.map(([v,l])=>`<div><canvas data-lbl-d="${v}" width="${W}" height="${H}" style="width:100%;height:auto;display:block;background:#fff;border-radius:6px"></canvas><small>${l}</small></div>`).join('')}</div>
 <div class="row" style="margin-top:10px"><button class="btn grow" data-a="lblBSave">שמור</button><button class="btn g grow" data-a="closeDlg">ביטול</button></div>`);bDraw()}
const bDraw=()=>{const D=S.D;if(!D)return;const go=()=>document.querySelectorAll('#dlg canvas[data-lbl-d]').forEach(c=>{try{draw(c.getContext('2d'),1,S.cur||SAMPLE,{prev:1,brand:{lay:c.dataset.lblD,logo:D.logo,stamp:D.stamp}})}catch(e){}});go();ensureImgs(D).then(go)};
ACT.lblBSet=()=>{if(!mgr())return;const c=bC();S.D={logo:c.logo,stamp:c.stamp,lay:c.lay,on:c.on,src:{},thr:{logo:150,stamp:150}};bDlg()};
const bSet=(k,i)=>{const D=S.D;D.src[k]=i;const u=bProc(i,D.thr[k]);if(!u)return toast('לא ניתן לעבד את התמונה');D[k]=u;bDlg()};
CHG.lblBUp=async el=>{const f=el.files[0],k=el.dataset.k==='stamp'?'stamp':'logo';el.value='';if(!f||!S.D)return;if(f.size>10e6)return toast('הקובץ גדול מדי (עד 10MB)');
 try{bSet(k,await ldImg(URL.createObjectURL(f)))}catch(e){toast('לא ניתן לקרוא את התמונה')}};
ACT.lblBBiz=async()=>{const o=typeof bzLastO==='function'?bzLastO():null;if(!o||!o.u||!S.D)return toast('אין לוגו עסק במכשיר');try{bSet('logo',await ldImg(o.u))}catch(e){toast('לא ניתן לקרוא את הלוגו')}};
INP.lblBThr=el=>{const D=S.D,k=el.dataset.k;if(!D||!D.src[k])return;D.thr[k]=280-(+el.value||130);/* ימינה = בהיר יותר (סף נמוך) */const u=bProc(D.src[k],D.thr[k]);if(!u)return;D[k]=u;const i=document.getElementById('lblBI-'+k);if(i)i.src=u;bDraw()};
ACT.lblBDel=el=>{const D=S.D,k=el.dataset.k;if(!D||!(k==='logo'||k==='stamp'))return;D[k]='';D.src[k]=null;bDlg()};
CHG.lblBDLay=el=>{if(S.D)S.D.lay=el.value==='bot'?'bot':'top'};
CHG.lblBDOn=el=>{if(S.D)S.D.on=!!el.checked};
ACT.lblBSave=async el=>{const D=S.D;if(!D||!mgr())return;const c=cfgOk(D);if(D.logo&&!c.logo||D.stamp&&!c.stamp)return toast('התמונה גדולה מדי');if(el)el.disabled=true;
 const f={logo:{stringValue:c.logo},stamp:{stringValue:c.stamp},lay:{stringValue:c.lay},on:{booleanValue:c.on},at:{integerValue:String(Date.now())},by:{stringValue:SY.uid}};
 try{await fsx('/cfg/lbl?'+Object.keys(f).map(k=>'updateMask.fieldPaths='+k).join('&'),{method:'PATCH',body:JSON.stringify({fields:f})});S.C=c;S.bOn=null;S.bLay=null;S.D=null;try{localStorage.setItem(BRK(),JSON.stringify(c))}catch(e){}
  closeDlg();toast('נשמר');rerender()}catch(e){if(el)el.disabled=false;toast(e&&e.offline?'אין חיבור לאינטרנט':'השמירה נכשלה'+(e&&e.code===403?' (אין הרשאה)':''))}};
// לעורך (lbl-design.js): טעינה, כל התבניות (כולל מחוקות), הגדרות, מוצרים לתצוגה, לארג' פעמי, הדפסה
const prep=()=>{if(!S.c0&&!S.cB)setTimeout(loadCfg,0);if(!S.t0&&!S.tB)setTimeout(loadTpl,0);if(S.P===null&&!S.pB)setTimeout(loadInv,0);if(S.M===null&&!S.mB)setTimeout(loadMan,0)};
const invL=()=>({busy:S.P===null||!!S.pB||S.M===null||!!S.mB,L:all().map(x=>({name:String(x.p.name||'').trim(),price:String(x.s==='m'?(+x.p.price||0):unitP(x.p,brNow())),code:String(x.p.barcode||''),pack:String(x.p.pack||'')})).filter(x=>x.name)});
Object.assign(API,{prep,tAll:()=>S.T||[],ls:()=>S.Ls||LblTpl.lblsOk(null),ready:()=>!!S.t0&&!!S.c0,inv:invL,isLP,ok,mgr,dec,out:pOut,szT,TK});
API.draw=draw;API.drawT=drawT;API.render=render;API.TPL=TPL;API.tSave=tSave;API.sSave=sSave;API.tList=tList;API.bk=bkGet;API.build=build;API.brand=bOpt;API.ensureImgs=ensureImgs;
})(typeof window!=='undefined'?window:globalThis);
