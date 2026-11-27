/* הדפסת דף אכיל (26.11.2026) – אריח "הדפסת דף אכיל": דף A4 אכיל במדפסת הזרקת דיו, חיתוך במספריים.
   אשף 3 צעדים (סבב 2): 1 תמונה (גלריה, מצלמה, PDF – pdf.js המקומי) · 2 עריכה ופריסה במסך אחד (A4 מלא, A5×2, עיגולים / ריבועים
   6/12/24/36 עם הגודל בס"מ, גודל חופשי; העורך edb-edit.js; תצוגה חיה של הדף האמיתי) · 3 הדפסה: כל משבצת ב-300 DPI עם גלישה (bleed) של 1.5 מ"מ מעבר לקו החיתוך, קווי חיתוך אפורים דקים,
   PDF עם MediaBox בדיוק 595.28×841.89 נקודות (A4), כיול (קנה מידה והזזה) שנשמר במכשיר (lp-edb-cal) ומוחל על כל הדפסה.
   העבודה עצמה נשארת במכשיר. מפתחות חדשים במכשיר בלבד: lp-edb-cal, lp-edb-prn (הגדרת תחנת ההדפסה – edb-station.js).
   סבב 2: שליחה לתחנת הדפסה במחשב (תור בענן edbq + תמונות זמניות ב-Storage) – edb-station.js. 36 עיגולים / ריבועים – רשת 6×6 (בחירת בעל העסק).
   הרשאה: מנהל / מנהל־על, או עובד עם המתג edb ("הדפסת דף אכיל", כבוי כברירת מחדל).
   מבנה הנתונים מוכן לסבב 2 (תמונה שונה לכל משבצת): imgs[] · ds[] (עיצוב: תמונה, מיקום, זום, סיבוב, התאמות, כיתובים) · slots[] = {d: אינדקס עיצוב}.
   כל ההדפסה עוברת דרך פונקציה אחת: EdbPrint.send – עוזר ההדפסה המקומי (בתחנה) / שליחה לתחנה / טלפון (PdfPrint) / דפדפן (iframe A4 בלי שוליים).
   החלק הטהור (EdbCore) מיוצא גם ל-Node – firebase/tests/edb-print.unit.test.js.
   סבב 5 (27.11.2026, אחרי הבדיקה בטלפון): כניסה למסך תמיד מצעד 1; אם העבודה האחרונה במכשיר לא הודפסה (pr ברשומת הפרויקט) – פס למטה
     10 שניות "להמשיך את העבודה הקודמת?". אלבום דפים מוכנים בענן (edba + edb_album/{id}/page.png, thumb.jpg) – משותף לכל המכשירים בעסק:
     "שמור לאלבום" בצעד 3 (רק בלחיצה – תמונות מהגלריה לא עולות לענן), "אלבום" בצעד 1: הדפסה מיד (לתחנה – הפניה alb, בלי העלאה) או פתיחה לעריכה. */
(function(root){
'use strict';
/* =================== החלק הטהור =================== */
const PG={w:210,h:297,m:5,g:3,bl:1.5},K=72/25.4,PT={w:595.28,h:841.89},DPI=300,CAP=4000;
const r2=x=>Math.round(x*100)/100,clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const LAYS=[['full','A4 מלא','r',1],['a5','A5 ×2','r',2],['c6','6','c',6],['c12','12','c',12],['c24','24','c',24],['c36','36','c',36],['s6','6','s',6],['s12','12','s',12],['s24','24','s',24],['s36','36','s',36]];
// N פריטים ריבועיים / עגולים: הרשת cols×rows (cols*rows ≥ N) שנותנת את הפריט הגדול ביותר. בשוויון – פחות משבצות ריקות.
// full: רק רשת מלאה ומסודרת (cols*rows == N, בלי שורה חלקית) – כך בפריסות הקבועות (36 = 6×6, בחירת בעל העסק); אין כזו – הרגילה
function fitGrid(n,W,H,g,full){W=W||PG.w-2*PG.m;H=H||PG.h-2*PG.m;g=g==null?PG.g:g;let b=null;
 for(let c=1;c<=n;c++){const r=Math.ceil(n/c),s=Math.min((W-(c-1)*g)/c,(H-(r-1)*g)/r);if(full&&c*r!==n)continue;if(s>0&&(!b||s>b.s+1e-9||(Math.abs(s-b.s)<1e-9&&c*r<b.cols*b.rows)))b={cols:c,rows:r,s}}return b||(full?fitGrid(n,W,H,g):b)}
// מיקום n פריטים w×h ברשת, ממורכזת בדף; שורה אחרונה חלקית – ממורכזת. x,y – הפינה השמאלית העליונה במ"מ
function place(cols,rows,w,h,n,g){g=g==null?PG.g:g;const out=[],tw=cols*w+(cols-1)*g,th=rows*h+(rows-1)*g,x0=(PG.w-tw)/2,y0=(PG.h-th)/2;
 for(let i=0;i<n;i++){const r=Math.floor(i/cols),c=i%cols,inRow=r===rows-1?n-r*cols:cols,dx=(cols-inRow)*(w+g)/2;out.push({x:x0+dx+c*(w+g),y:y0+r*(h+g),w,h})}return out}
// cu (גודל חופשי): {sh:'c'|'s'|'r', w, h} במ"מ – הכמות מחושבת לבד
function layout(k,cu){const W=PG.w-2*PG.m,H=PG.h-2*PG.m,g=PG.g;
 if(k==='full')return fin({k,shape:'r',cols:1,rows:1,w:W,h:H,n:1});
 if(k==='a5'){const h=(H-g)/2;return fin({k,shape:'r',cols:1,rows:2,w:W,h,n:2})}
 const L=LAYS.find(x=>x[0]===k);
 if(L){const f=fitGrid(L[3],0,0,null,true);return fin({k,shape:L[2],cols:f.cols,rows:f.rows,w:f.s,h:f.s,n:L[3]})}
 cu=cu||{};const sh=cu.sh==='s'||cu.sh==='r'?cu.sh:'c',w=clamp(+cu.w||50,10,W),h=sh==='r'?clamp(+cu.h||w,10,H):w,
  cols=Math.floor((W+g)/(w+g)),rows=Math.floor((H+g)/(h+g));
 return fin({k:'cu',shape:sh,cols,rows,w,h,n:cols*rows})}
function fin(L){L.slots=L.n>0?place(L.cols,L.rows,L.w,L.h,L.n):[];return L}
// גדלים לבעל העסק – בס"מ, ספרה אחת אחרי הנקודה (בקשת בעל העסק, סבב 2)
const cm=mm=>(Math.round(mm)/10).toFixed(1);
const laySz=L=>!L||!L.n?'':L.shape==='c'?`קוטר ${cm(L.w)} ס"מ`:L.shape==='s'?`צלע ${cm(L.w)} ס"מ`:`${cm(L.w)}×${cm(L.h)} ס"מ`;
const layTxt=L=>!L||!L.n?'הגודל לא נכנס בדף':L.shape==='c'?`${L.n} עיגולים בקוטר ${cm(L.w)} ס"מ`:L.shape==='s'?`${L.n} ריבועים בצלע ${cm(L.w)} ס"מ`:`${L.n===1?'דף אחד':L.n+' חלקים'} של ${cm(L.w)}×${cm(L.h)} ס"מ`;
// DPI אפקטיבי: תמונה iw×ih שממלאת (cover) משבצת wMm×hMm, בזום z, בסיבוב rot (90/270 – רוחב וגובה מתחלפים)
function dpi(iw,ih,wMm,hMm,z,rot){if(!(iw>0&&ih>0&&wMm>0&&hMm>0))return 0;const q=Math.round((+rot||0)/90)%2!==0,a=q?ih:iw,b=q?iw:ih,mmPx=Math.max(wMm/a,hMm/b)*(+z||1);return Math.round(25.4/mmPx)}
const grade=d=>d>=250?{c:'g',t:'מצוין'}:d>=150?{c:'y',t:'סביר'}:{c:'r',t:'תצא מטושטשת'};
// כיול: הקו של 100 מ"מ נמדד h (אופקי) ו-v (אנכי); הצלב אמור להיות 20 מ"מ מהקצה השמאלי (dl) והעליון (dt)
const CAL0={sx:1,sy:1,ox:0,oy:0};
function calNorm(c){c=c||{};const n=(v,a,b,d)=>{v=+v;return isFinite(v)?clamp(v,a,b):d};return{sx:n(c.sx,0.8,1.25,1),sy:n(c.sy,0.8,1.25,1),ox:n(c.ox,-15,15,0),oy:n(c.oy,-15,15,0)}}
function calFrom(h,v,dl,dt){const s=x=>(+x>0?100/+x:1),o=x=>(x===''||x==null||!isFinite(+x)?0:20-(+x));return calNorm({sx:s(h),sy:s(v),ox:o(dl),oy:o(dt)})}
// מיפוי במ"מ (פינה עליונה שמאלית): x' = e + a·x, y' = f + d·y – קנה מידה סביב מרכז הדף ואז הזזה
function calMap(c){c=calNorm(c);const cx=PG.w/2,cy=PG.h/2;return{a:c.sx,d:c.sy,e:cx*(1-c.sx)+c.ox,f:cy*(1-c.sy)+c.oy}}
// אותו מיפוי כמטריצת PDF (נקודות, ציר y למעלה)
function calXf(c){const m=calMap(c);return[m.a,0,0,m.d,m.e*K,PT.h*(1-m.d)-m.f*K]}
// פי כמה לרנדר עמוד PDF (viewport בגודל vw×vh ב-scale 1) כדי לקבל 450 פיקסלים לאינץ' במשבצת wMm×hMm (מרווח לזום), עד cap בצד הארוך
function pdfScale(vw,vh,wMm,hMm,cap){cap=cap||CAP;const need=450/25.4,s=Math.max(wMm*need/vw,hMm*need/vh);return Math.min(s,cap/Math.max(vw,vh))}
const fitCap=(w,h,cap)=>{cap=cap||CAP;const k=Math.min(1,cap/Math.max(w,h));return{w:Math.max(1,Math.round(w*k)),h:Math.max(1,Math.round(h*k))}};
/* ---------- התאמות צבע (אחרי ציור התמונה, על הפיקסלים) ---------- */
// רמות אוטומטיות: אחוזון 0.5% ו-99.5% לכל ערוץ
function levels(data){const H=[new Uint32Array(256),new Uint32Array(256),new Uint32Array(256)];let n=0;
 for(let i=0;i<data.length;i+=4){if(data[i+3]<8)continue;H[0][data[i]]++;H[1][data[i+1]]++;H[2][data[i+2]]++;n++}
 const lo=[0,0,0],hi=[255,255,255];if(!n)return{lo,hi};const t=n*0.005;
 for(let c=0;c<3;c++){let s=0,k=0;while(k<255&&(s+=H[c][k])<=t)k++;lo[c]=k;s=0;k=255;while(k>0&&(s+=H[c][k])<=t)k--;hi[c]=k;if(hi[c]-lo[c]<16){lo[c]=0;hi[c]=255}}return{lo,hi}}
function luts(lv,auto,br,ct){const L=[0,1,2].map(c=>{const u=new Uint8ClampedArray(256),lo=auto&&lv?lv.lo[c]:0,hi=auto&&lv?lv.hi[c]:255,k=(+ct||0)/100+1,b=(+br||0)*1.28;
 for(let v=0;v<256;v++){let x=(v-lo)*255/(hi-lo);x=(x-128)*k+128+b;u[v]=x}return u});return L}
const adjNeeded=d=>!!(d&&(d.auto||+d.br||+d.ct||+d.sat));
function adjust(data,L,sat){const s=(+sat||0)/100+1,R=L[0],G=L[1],B=L[2];
 for(let i=0;i<data.length;i+=4){let r=R[data[i]],g=G[data[i+1]],b=B[data[i+2]];if(s!==1){const l=0.299*r+0.587*g+0.114*b;r=l+(r-l)*s;g=l+(g-l)*s;b=l+(b-l)*s}data[i]=r;data[i+1]=g;data[i+2]=b}return data}
// סדר תצוגה לכיתוב על קשת (אות אחרי אות, משמאל לימין): עברית הפוכה, רצפים של ספרות / אותיות לטיניות נשארים בסדרם
function visual(s){s=String(s||'');if(!/[֐-׿]/.test(s))return[...s];const seg=s.match(/[A-Za-z0-9.,:%₪$+\-/]+|[^A-Za-z0-9.,:%₪$+\-/]/g)||[];return seg.reverse().flatMap(x=>x.length>1?[...x]:[x])}
/* ---------- PDF: עמוד A4 אחד ---------- */
// pg: {imgs:[{w,h,flate|jpg:Uint8Array}], draws:[{i,x,y,w,h}] (מ"מ, פינה עליונה שמאלית), cuts:[{c (עיגול),x,y,w,h}], lines:[[x1,y1,x2,y2,עובי מ"מ]], cal}
const n3=x=>String(Math.round(x*1000)/1000);
function circ(cx,cy,r){const k=0.5523*r;return `${n3(cx+r)} ${n3(cy)} m ${n3(cx+r)} ${n3(cy+k)} ${n3(cx+k)} ${n3(cy+r)} ${n3(cx)} ${n3(cy+r)} c ${n3(cx-k)} ${n3(cy+r)} ${n3(cx-r)} ${n3(cy+k)} ${n3(cx-r)} ${n3(cy)} c ${n3(cx-r)} ${n3(cy-k)} ${n3(cx-k)} ${n3(cy-r)} ${n3(cx)} ${n3(cy-r)} c ${n3(cx+k)} ${n3(cy-r)} ${n3(cx+r)} ${n3(cy-k)} ${n3(cx+r)} ${n3(cy)} c h`}
function content(pg){const X=x=>x*K,Y=(y,h)=>PT.h-(y+(h||0))*K,xf=calXf(pg.cal);let c=`q ${xf.map(n3).join(' ')} cm\n`;
 (pg.draws||[]).forEach(d=>{c+=`q ${n3(d.w*K)} 0 0 ${n3(d.h*K)} ${n3(X(d.x))} ${n3(Y(d.y,d.h))} cm /Im${d.i} Do Q\n`});
 const C=pg.cuts||[];if(C.length){c+='0.6 G 0.4 w\n';C.forEach(q=>{c+=(q.c?circ(X(q.x+q.w/2),Y(q.y+q.h/2),q.w/2*K):`${n3(X(q.x))} ${n3(Y(q.y,q.h))} ${n3(q.w*K)} ${n3(q.h*K)} re`)+' S\n'})}
 (pg.lines||[]).forEach(l=>{c+=`0 G ${n3((l[4]||0.3)*K)} w ${n3(X(l[0]))} ${n3(Y(l[1]))} m ${n3(X(l[2]))} ${n3(Y(l[3]))} l S\n`});
 return c+'Q\n'}
function mkPdf(pg){const parts=[],offs=[];let len=0;const I=pg.imgs||[];
 const enc=s=>{const u=new Uint8Array(s.length);for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i)&255;return u};
 const push=b=>{if(typeof b==='string')b=enc(b);parts.push(b);len+=b.length};
 const obj=(n,f)=>{offs[n]=len;push(n+' 0 obj\n');f();push('\nendobj\n')};
 const box=`[0 0 ${PT.w} ${PT.h}]`,cs=content(pg),N=4+I.length;
 push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
 obj(1,()=>push('<< /Type /Catalog /Pages 2 0 R /ViewerPreferences << /PrintScaling /None >> >>'));
 obj(2,()=>push('<< /Type /Pages /Count 1 /Kids [3 0 R] >>'));
 obj(3,()=>push(`<< /Type /Page /Parent 2 0 R /MediaBox ${box} /CropBox ${box} /Resources << /XObject << ${I.map((_,i)=>`/Im${i} ${5+i} 0 R`).join(' ')} >> >> /Contents 4 0 R >>`));
 obj(4,()=>{push(`<< /Length ${cs.length} >>\nstream\n`);push(cs);push('endstream')});
 // im.flate – RGB גולמי דחוס zlib (בלי איבוד איכות, ברירת המחדל); im.jpg – JPEG (רק כשאין CompressionStream במכשיר)
 I.forEach((im,i)=>obj(5+i,()=>{const b=im.flate||im.jpg;push(`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${im.flate?'FlateDecode':'DCTDecode'} /Length ${b.length} >>\nstream\n`);push(b);push('\nendstream')}));
 const xr=len;let x=`xref\n0 ${N+1}\n0000000000 65535 f \n`;for(let i=1;i<=N;i++)x+=String(offs[i]).padStart(10,'0')+' 00000 n \n';
 push(x+`trailer\n<< /Size ${N+1} /Root 1 0 R >>\nstartxref\n${xr}\n%%EOF\n`);
 const out=new Uint8Array(len);let o=0;for(const p of parts){out.set(p,o);o+=p.length}return out}
// עיצוב חדש (ds[i]) – סבב 2 ייתן עיצוב לכל משבצת
const newD=img=>({img:img||0,x:0,y:0,z:1,rot:0,fl:false,auto:false,br:0,ct:0,sat:0,tx:[]});
/* ---------- סבב 2ב: היסטוריה (ביטול / חזרה), הסרת רקע לפי צבע, שמירת פרויקטים ---------- */
// היסטוריה: מחרוזות JSON של פרמטרים בלבד (בלי תמונות). cap צעדי ביטול. commit זהה למצב הנוכחי – לא נרשם
function mkHist(cap){cap=cap||30;let u=[],r=[],cur=null;
 return{init(s){u=[];r=[];cur=s},commit(s){if(s===cur)return false;if(cur!=null)u.push(cur);while(u.length>cap)u.shift();r=[];cur=s;return true},
  undo(){if(!u.length)return null;r.push(cur);cur=u.pop();return cur},redo(){if(!r.length)return null;u.push(cur);cur=r.pop();return cur},
  canUndo:()=>u.length>0,canRedo:()=>r.length>0,cur:()=>cur,all:()=>u.concat(cur!=null?[cur]:[],r)}}
const hexRgb=h=>{const m=/^#([0-9a-f]{6})$/i.exec(String(h||''));if(!m)return null;const v=parseInt(m[1],16);return[v>>16&255,v>>8&255,v&255]};
// הסרת רקע לפי צבע: פיקסל קרוב לצבע (מרחק RGB עד tol% מהמרחק המקסימלי) הופך שקוף; ברבע החיצוני של הטווח – שקיפות הדרגתית (קצה חלק)
function keyColor(data,r,g,b,tol){const T=clamp(+tol||0,0,100)/100*441.6729,lo=T*0.75;if(!(T>0))return data;
 for(let i=0;i<data.length;i+=4){const a=data[i]-r,c=data[i+1]-g,e=data[i+2]-b,d=Math.sqrt(a*a+c*c+e*e);if(d<=lo)data[i+3]=0;else if(d<T)data[i+3]=Math.round(data[i+3]*(d-lo)/(T-lo))}return data}
const nm=(v,a,b,df)=>{v=+v;return isFinite(v)?clamp(v,a,b):df},hx=(v,df)=>hexRgb(v)?String(v).toLowerCase():df;
function normT(t){t=t||{};return{s:String(t.s==null?'':t.s).slice(0,60),f:String(t.f||'Rubik').slice(0,40),b:!!t.b,sz:nm(t.sz,1,200,10),col:hx(t.col,'#ffffff'),ol:hx(t.ol,'#000000'),ow:nm(t.ow,0,20,3),sh:!!t.sh,x:nm(t.x,-0.5,1.5,0.5),y:nm(t.y,-0.5,1.5,0.5),arc:t.arc==='top'||t.arc==='bot'?t.arc:''}}
// עיצוב משבצת (נקרא מהמכשיר): ערכים בטווח, שדות חסרים – ברירת מחדל. im = אינדקס תמונה פרטית של המשבצת (אין = התמונה הכללית); kc/kt = צבע להסרה ורגישות
function normD(d){d=d||{};const o={img:0,x:nm(d.x,-5,5,0),y:nm(d.y,-5,5,0),z:nm(d.z,0.3,6,1),rot:nm(d.rot,-360,360,0),fl:!!d.fl,auto:!!d.auto,br:nm(d.br,-100,100,0),ct:nm(d.ct,-100,100,0),sat:nm(d.sat,-100,100,0),tx:(Array.isArray(d.tx)?d.tx:[]).slice(0,8).map(normT)};
 if(d.im!=null&&Number.isInteger(+d.im)&&+d.im>=0)o.im=+d.im;const kc=hx(d.kc,'');if(kc){o.kc=kc;o.kt=nm(d.kt,1,100,25)}return o}
// גודל מקסימלי (בצד הארוך) לתמונה פרטית של משבצת: הצורך ב-300 DPI כפול 2 (מרווח לזום), לפחות 600, עד CAP
const imgCap=L=>!L||!L.n?600:Math.round(clamp(Math.max(L.w,L.h)*2/25.4*DPI,600,CAP));
// st: {name,k,cu,cut,ds,slots,gi,imgs:[{id,name,w,h,cap}|null]} ← → רשומה לשמירה (בלי תמונות; הקבצים נשמרים בנפרד)
function projPack(st){st=st||{};return JSON.parse(JSON.stringify({v:1,name:String(st.name||'').slice(0,60),k:st.k,cu:st.cu,cut:st.cut!==false,ds:st.ds||[],slots:st.slots||[],gi:st.gi==null?-1:st.gi,
 imgs:(st.imgs||[]).map(m=>m?{id:String(m.id),name:String(m.name||'').slice(0,60),w:m.w|0,h:m.h|0,cap:m.cap|0}:null)}))}
function projUnpack(rec){if(!rec||typeof rec!=='object'||!Array.isArray(rec.imgs))return null;
 const imgs=rec.imgs.map(m=>m&&m.id&&m.w>0&&m.h>0?{id:String(m.id),name:String(m.name||'תמונה').slice(0,60),w:m.w|0,h:m.h|0,cap:m.cap>0?m.cap|0:CAP}:null),ok=i=>Number.isInteger(i)&&i>=0&&i<imgs.length&&!!imgs[i];
 let ds=(Array.isArray(rec.ds)?rec.ds:[]).slice(0,64).map(normD);if(!ds.length)ds=[newD(0)];ds.forEach(d=>{if(d.im!=null&&!ok(d.im))delete d.im});
 const cu0=rec.cu||{},cu={sh:cu0.sh==='s'||cu0.sh==='r'?cu0.sh:'c',w:nm(cu0.w,10,200,50),h:nm(cu0.h,10,287,50)},k=rec.k==='cu'||LAYS.some(x=>x[0]===rec.k)?rec.k:'c12';
 const n=layout(k,cu).n,slots=(Array.isArray(rec.slots)?rec.slots:[]).slice(0,n).map(s=>({d:s&&Number.isInteger(+s.d)&&+s.d>=0&&+s.d<ds.length?+s.d:0}));
 let gi=ok(rec.gi)?rec.gi:imgs.findIndex(Boolean);
 return{name:String(rec.name||'').slice(0,60),k,cu,cut:rec.cut!==false,ds,slots,gi,imgs}}
/* ---------- סבב 5: אלבום דפים מוכנים ---------- */
// מסמך edba מהענן (אחרי פענוח) → אובייקט נקי, או null. שם עד 60 תווים, פריסה מוכרת (אחרת 'cu'), מידות בטווח, st: ok | up
function albNorm(o){if(!o||typeof o!=='object')return null;const id=String(o.id||'');if(!/^[A-Za-z0-9_-]{8,40}$/.test(id))return null;
 const w=Math.trunc(+o.w)||0,h=Math.trunc(+o.h)||0;
 return{id,nm:String(o.nm==null?'':o.nm).slice(0,60)||'דף',k:o.k==='cu'||LAYS.some(x=>x[0]===o.k)?o.k:'cu',by:String(o.by||''),at:+o.at>0?+o.at:0,w:w>0&&w<=4000?w:0,h:h>0&&h<=4000?h:0,st:o.st==='ok'?'ok':'up'}}
// חיפוש לפי שם: בלי הבדל בין אותיות גדולות / קטנות ובלי רווחים כפולים; ריק = הכול
const albQ=q=>String(q||'').trim().toLowerCase().replace(/\s+/g,' ');
const albFind=(L,q)=>{q=albQ(q);return(L||[]).filter(a=>a&&(!q||albQ(a.nm).includes(q)))};
const albLay=a=>a&&a.k&&a.k!=='cu'?layTxt(layout(a.k)):'גודל חופשי';
// כיול ברירת מחדל = מדפיסים את תמונת הדף כמו שהיא (בלי ציור מחדש, ולתחנה – הפניה לאלבום בלי העלאה)
const calId=c=>{c=calNorm(c);return c.sx===1&&c.sy===1&&c.ox===0&&c.oy===0};
// "פתח לעריכה": החלק של הדף שבתוך השוליים (5 מ"מ מכל צד) – בפריסת "A4 מלא" הוא חוזר לאותו מקום ובאותו גודל
function albCrop(w,h){const x=Math.round(w*PG.m/PG.w),y=Math.round(h*PG.m/PG.h);return{x,y,w:Math.max(1,w-2*x),h:Math.max(1,h-2*y)}}
const API={PG,K,PT,DPI,CAP,LAYS,albNorm,albQ,albFind,albLay,calId,albCrop,fitGrid,place,layout,layTxt,laySz,cm,dpi,grade,CAL0,calNorm,calFrom,calMap,calXf,pdfScale,fitCap,levels,luts,adjust,adjNeeded,visual,mkPdf,newD,mkHist,hexRgb,keyColor,normD,imgCap,projPack,projUnpack};
root.EdbCore=API;
if(typeof module!=='undefined'&&module.exports)module.exports=API;
if(typeof window==='undefined'||typeof ACT==='undefined'||typeof V==='undefined')return;

/* =================== המסך =================== */
const CALK='lp-edb-cal',T='הדפסת דף אכיל';
const S={pr:0,alb:null,st:1,k:'c12',cu:{sh:'c',w:50,h:50},L:null,img:null,imgs:[],gi:-1,ds:[newD(0)],slots:[],selS:-1,mode:'all',pvBig:false,cut:true,pdf:null,ptg:-1,busy:0,sel:-1,pid:null,pname:'',saveErr:'',rst:0};
const mgr=()=>(typeof isA==='function'&&isA())||!!(SY&&SY.sa);
const ok=()=>!!SY&&!SY.mg&&(mgr()||(typeof isW==='function'&&isW()&&!!(SY.perms&&SY.perms.edb===true)));
const lay=()=>{if(!S.L||S.L.k!==S.k||S.k==='cu')S.L=layout(S.k,S.cu);if(S.slots.length!==S.L.n){S.slots=S.L.slots.map((_,i)=>S.slots[i]||{d:0});if(S.selS>=S.slots.length)S.selS=-1}return S.L};
const calGet=()=>{try{return calNorm(JSON.parse(localStorage.getItem(CALK)||'null'))}catch(e){return calNorm()}};
const calSet=c=>{try{localStorage.setItem(CALK,JSON.stringify(calNorm(c)))}catch(e){}};
const St=()=>root.EdbSt||null,isNatv=()=>!!(typeof shNat==='function'&&shNat());
const redraw=()=>{try{mark();if(cur().v==='edb')rerender()}catch(e){}};
const freeCv=c=>{if(c){c.width=0;c.height=0}};
const freeImg=m=>{if(m){freeCv(m.c);freeCv(m.p)}};
// סבב 2ב: כל התמונות של העבודה (imgs; האינדקס יציב, מקום ריק = null). S.img = התמונה הכללית (imgs[gi]); לכל עיצוב (ds[i]) אפשר im = תמונה פרטית
const imgOfD=d=>d&&d.im!=null&&S.imgs[d.im]?S.imgs[d.im]:S.img;
const curD=()=>{lay();const i=S.selS>=0&&S.selS<S.slots.length?S.selS:0;return S.ds[S.slots[i]?S.slots[i].d:0]||S.ds[0]};
const freeAll=()=>{S.imgs.forEach(freeImg);S.imgs=[];S.gi=-1;S.img=null;try{if(root.EdbEdit)root.EdbEdit.freeKey()}catch(e){}H=mkHist(30)};
let H=mkHist(30);
const relPdf=()=>{if(S.pdf&&S.pdf.doc){try{S.pdf.doc.destroy()}catch(e){}}S.pdf=null};
const css=`<style>#edbW .edSt{display:flex;gap:6px;margin-bottom:10px}#edbW .edSt button{flex:1;min-height:44px;border-radius:12px;border:2px solid var(--line);background:var(--card);color:var(--mut);font-weight:700;font-size:.85rem;padding:0 2px}
#edbW .edSt button.on{border-color:var(--acc);color:var(--acc)}#edbW .edSt button.dn{color:var(--acc)}
#edbW .edG{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}#edbW .edO{min-height:52px;border-radius:12px;border:2px solid var(--line);background:var(--card);color:inherit;font-weight:700;font-size:1.05rem;display:flex;align-items:center;justify-content:center;gap:6px}
#edbW .edL{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:8px;margin-bottom:10px}#edbW .edL .edG{gap:6px}#edbW .edLh{font-size:.8rem;color:var(--mut);margin:4px 0 3px}#edbW .edL .edO{min-height:44px;font-size:.95rem}
#edbW .edPg{text-align:center}#edbW .edPg canvas{display:block;margin:8px auto;width:100%;max-width:240px;background:#fff;border-radius:4px;box-shadow:0 1px 6px #0008}#edbW .edPg small{display:block}
#edbW .edO2{flex-direction:column;gap:2px;padding:4px 2px;line-height:1.1}#edbW .edO2 small{font-size:.72rem;font-weight:400;color:var(--mut)}#edbW .edO2.on small{color:var(--acc)}
#edbW .edO.on{border-color:var(--acc);color:var(--acc);box-shadow:0 0 0 2px color-mix(in srgb,var(--acc) 30%,transparent)}#edbW .edO.w2{grid-column:span 2}
#edbW .edH{margin:14px 0 6px;font-weight:700}#edbW .edNav{display:flex;gap:8px;margin-top:14px}#edbW .edNav .btn{flex:1}
#edbW .edBig{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}#edbW .edBig label{min-height:84px;flex-direction:column;font-size:1rem;cursor:pointer}
#edbW .edAlb{grid-column:1/-1;min-height:64px;border-color:var(--acc);color:var(--acc);gap:10px;cursor:pointer}#edbW .edAlb span{display:flex;flex-direction:column;align-items:flex-start;gap:2px}#edbW .edAlb small{font-size:.75rem;font-weight:400;color:var(--mut)}
#edbW .edTh{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:8px}#edbW .edTh button{border:2px solid var(--line);border-radius:8px;background:#fff;padding:3px;min-height:60px}#edbW .edTh button.on{border-color:var(--acc)}
#edbW .edTh img{width:100%;display:block}#edbW .edTh small{display:block;color:#333}
#edbW .edQ{display:inline-flex;align-items:center;gap:6px;font-weight:700}#edbW .edQ i{width:12px;height:12px;border-radius:50%;display:inline-block}
#edbW .edQ.g i{background:#2fae5b}#edbW .edQ.y i{background:#e6b422}#edbW .edQ.r i{background:#e0483e}#edbW .edQ.r{color:#e0483e}
#edbW .edWarn{border:2px solid var(--acc);border-radius:12px;padding:10px;font-weight:700;color:var(--acc);margin:10px 0}
#edbW label.f{display:block;margin:6px 0}#edbW label.f input,#edbW label.f select{width:100%;min-height:44px}
#edbW .edPv{display:flex;gap:10px;align-items:flex-start}#edbW .edPv .edPg{flex:none;width:136px;padding:0}#edbW .edPv.big{flex-direction:column;align-items:stretch}#edbW .edPv.big .edPg{width:100%}#edbW .edPv.big canvas{max-width:300px}
#edbW .edPv canvas{margin:0 auto;max-width:136px}#edbW .edTb{display:flex;flex-direction:column;gap:6px;flex:1;min-width:0}#edbW .edPv.big .edTb{flex-direction:row;flex-wrap:wrap}#edbW .edTb .btn{min-height:40px;padding:4px 6px;font-size:.85rem}#edbW .edPv.big .edTb .btn{flex:1}
#edbW .edR{display:flex;gap:8px;align-items:center}#edbW .edR>*{flex:1}#edbW details{margin-top:10px}#edbW input[type=range]{accent-color:var(--acc)}#edbW .edBig svg{width:30px;height:30px}#edbW summary{min-height:44px;display:flex;align-items:center;font-weight:700;cursor:pointer}</style>`;
// סבב 2 (בקשת בעל העסק): 3 צעדים – 1 תמונה · 2 עריכה ופריסה (מסך אחד, עם תצוגת הדף האמיתי) · 3 הדפסה
const steps=()=>{const n=['תמונה','עריכה ופריסה','הדפסה'];return `<div class="edSt">${n.map((t,i)=>`<button data-a="edbSt" data-v="${i+1}" class="${S.st===i+1?'on':S.st>i+1?'dn':''}">${i+1} ${t}</button>`).join('')}</div>`};
const nav=(back,next,nextT,dis)=>`<div class="edNav">${back?`<button class="btn g" data-a="edbSt" data-v="${S.st-1}">חזרה</button>`:''}${next?`<button class="btn" data-a="edbSt" data-v="${S.st+1}"${dis?' disabled':''}>${nextT||'הבא'}</button>`:''}</div>`;
// שורת הפריסה (בראש צעד 2): כפתורים קטנים עם הגודל המודפס בס"מ
function layBar(){const L=lay(),o=(k,t,c)=>`<button class="edO edO2${c?' '+c:''}${S.k===k?' on':''}" data-a="edbLay" data-v="${k}"><span>${t}</span>${k==='cu'?'':`<small>${esc(laySz(layout(k)))}</small>`}</button>`;
 let h=`<div class="edL"><div class="edLh">עיגולים</div><div class="edG">${[6,12,24,36].map(n=>o('c'+n,n)).join('')}</div>
<div class="edLh">ריבועים</div><div class="edG">${[6,12,24,36].map(n=>o('s'+n,n)).join('')}</div>
<div class="edLh">דף שלם / אחר</div><div class="edG">${o('full','A4 מלא')}${o('a5','A5 ×2')}${o('cu','גודל חופשי','w2')}</div>`;
 if(S.k==='cu')h+=`<div style="margin-top:6px"><label class="f"><span>צורה</span><select data-c="edbCu" name="sh">${[['c','עיגול'],['s','ריבוע'],['r','מלבן']].map(([v,t])=>`<option value="${v}"${S.cu.sh===v?' selected':''}>${t}</option>`).join('')}</select></label>
<div class="edR"><label class="f"><span>${S.cu.sh==='c'?'קוטר':'רוחב'} (מ"מ) – ${cm(S.cu.w)} ס"מ</span><input type="number" inputmode="decimal" min="10" max="200" data-c="edbCu" name="w" value="${S.cu.w}"></label>${S.cu.sh==='r'?`<label class="f"><span>גובה (מ"מ) – ${cm(S.cu.h)} ס"מ</span><input type="number" inputmode="decimal" min="10" max="287" data-c="edbCu" name="h" value="${S.cu.h}"></label>`:''}</div>`;
 return h+`<div style="margin-top:6px;font-weight:700">${esc(layTxt(L))}</div></div>`}
// צעד 2: פריסה + עורך הצורה + "איך זה ייראה בדף" (הדף האמיתי, ברזולוציה נמוכה)
const SW=L=>L.shape==='c'?['עיגול','עיגולים']:L.shape==='s'?['ריבוע','ריבועים']:['חלק','החלקים'];
function slotPanel(L){if(L.n<2)return '';const w=SW(L),i=S.selS,own=i>=0&&S.slots[i]&&S.slots[i].d!==0,pk=(t,ic,acc,cap)=>`<label class="edO" style="min-height:44px;font-size:.9rem"><span>${t}</span><input type="file" accept="${acc}"${cap?' capture="environment"':''} data-c="${ic}" data-t="s" hidden></label>`;
 if(i<0)return `<div class="card"><b>תמונה שונה לכל ${w[0]}</b><p class="note" style="margin:6px 0 0">לחצו על ${w[0]} בתצוגת הדף כדי לבחור אותו: אפשר לתת לו תמונה משלו, עריכה משלו וכיתוב משלו. בלי בחירה – העריכה חלה על כולם.</p></div>`;
 return `<div class="card"><b>${w[0]} ${i+1} נבחר (מסומן בזהב)</b><p class="note" style="margin:4px 0 8px">${own?'העריכה למטה חלה על '+w[0]+' הזה בלבד.':'העריכה למטה חלה על כל ה'+w[1]+' שאין להם עריכה נפרדת.'}</p>
<div class="edR"><button class="btn ${own?'g ':''}s" data-a="edbMode" data-v="all">תמונה לכל ה${w[1]}</button><button class="btn ${own?'':'g '}s" data-a="edbMode" data-v="one">תמונה שונה ל${w[0]} הזה</button></div>
<div class="edLh" style="margin-top:8px">בחירת תמונה ${own?'ל'+w[0]+' הזה':'לכל ה'+w[1]} (בחרו אחת מהאפשרויות)</div><div class="edG" style="grid-template-columns:repeat(3,1fr)">${pk('מצלמה','edbImg','image/*',1)}${pk('גלריה','edbImg','image/*',0)}${pk('PDF','edbPdf','application/pdf,.pdf',0)}</div>
${own?`<div class="edR" style="margin-top:8px"><button class="btn g s" data-a="edbCopyAll">העתק לכולם</button><button class="btn g s" data-a="edbMode" data-v="all">ביטול העריכה הנפרדת</button></div>`:''}</div>`}
const urBtns=()=>`<button class="btn g s" id="edbUn" data-a="edbUndo" aria-label="ביטול פעולה"${H.canUndo()?'':' disabled'}>↶ ביטול</button><button class="btn g s" id="edbRe" data-a="edbRedo" aria-label="חזרה על פעולה"${H.canRedo()?'':' disabled'}>↷ חזרה</button>`;
// צעד 2: פריסה + תצוגת הדף (קטנה, מיד מתחת לפריסה) + בחירת משבצת + עורך הצורה
function stepEdit(){const L=lay(),E=root.EdbEdit;
 return layBar()+(S.saveErr?`<div class="edWarn">${esc(S.saveErr)}</div>`:'')+`<div class="card"><div class="edPv${S.pvBig?' big':''}"><div class="edPg"><canvas id="edbPg" width="360" height="509" aria-label="תצוגת דף A4"></canvas>${S.pvBig?`<small class="note">איך זה ייראה בדף. שוליים 0.5 ס"מ (מקווקו), רווח 0.3 ס"מ${S.cut?', קווי חיתוך אפורים':''}</small>`:''}</div>
<div class="edTb"><b style="font-size:.85rem">איך זה ייראה בדף</b>${urBtns()}<button class="btn g s" data-a="edbBig">${S.pvBig?'הקטנה':'🔍 הגדלה'}</button><button class="btn g s" data-a="edbProjs">📁 פרויקטים</button></div></div></div>`+slotPanel(L)+(L.n&&E?E.html(S):'')+nav(1,1,'הבא – הדפסה',!L.n)}
// תצוגת הדף: משבצת אחת מצוירת פעם אחת בגודל קטן ומשוכפלת לכל המשבצות. לכל היותר פעם ב-300ms
let PVT=0;const pvSoon=()=>{if(PVT)return;PVT=setTimeout(()=>{PVT=0;pvDraw()},300)};
// תצוגת הדף מצוירת על קנבס c (גם לתמונה הממוזערת של הפרויקט). כל עיצוב בשימוש מצויר פעם אחת בגודל קטן ומשוכפל. hl – סימון המשבצת הנבחרת
function pgPaint(c,hl){const E=root.EdbEdit,L=lay(),W=c.width,H=c.height,k=W/PG.w,g=c.getContext('2d');
 g.setTransform(1,0,0,1,0,0);g.fillStyle='#fff';g.fillRect(0,0,W,H);if(!L.n||!E)return;const tiles={};
 try{L.slots.forEach((q,i)=>{const di=S.slots[i]?S.slots[i].d:0,d=S.ds[di]||S.ds[0],I=imgOfD(d);if(!I)return;
  let tc=tiles[di];if(!tc){const sw=Math.max(8,Math.round(L.w*k*1.5)),sh=Math.max(8,Math.round(L.h*k*1.5));tc=tiles[di]=document.createElement('canvas');tc.width=sw;tc.height=sh;
   E.draw(tc.getContext('2d'),sw,sh,{d,img:I,src:I.p,ox:0,oy:0,ppm:sw/L.w,wMm:L.w,hMm:L.h,shape:L.shape,bl:0})}
  g.imageSmoothingQuality='high';g.drawImage(tc,q.x*k,q.y*k,q.w*k,q.h*k)})}finally{Object.values(tiles).forEach(freeCv)}
 if(S.cut){g.strokeStyle='#999';g.lineWidth=1;L.slots.forEach(q=>{g.beginPath();if(L.shape==='c')g.arc((q.x+q.w/2)*k,(q.y+q.h/2)*k,q.w/2*k,0,Math.PI*2);else g.rect(q.x*k,q.y*k,q.w*k,q.h*k);g.stroke()})}
 g.setLineDash([4,3]);g.strokeStyle='#bbb';g.lineWidth=1;g.strokeRect(PG.m*k,PG.m*k,(PG.w-2*PG.m)*k,(PG.h-2*PG.m)*k);g.setLineDash([]);
 const q=hl&&L.n>1&&S.selS>=0?L.slots[S.selS]:null;if(q){g.strokeStyle='#e7b84d';g.lineWidth=4;g.beginPath();if(L.shape==='c')g.arc((q.x+q.w/2)*k,(q.y+q.h/2)*k,q.w/2*k+2,0,Math.PI*2);else g.rect(q.x*k-2,q.y*k-2,q.w*k+4,q.h*k+4);g.stroke()}}
function pvDraw(){const c=document.getElementById('edbPg');if(!c||!S.img)return;pgPaint(c,true)}
// לחיצה על התצוגה: על משבצת = בחירתה (שוב = ביטול הבחירה); מחוץ למשבצות (או בפריסה של משבצת אחת) = הגדלה / הקטנה
function pgTap(e){const L=lay(),r=e.currentTarget.getBoundingClientRect(),x=(e.clientX-r.left)/r.width*PG.w,y=(e.clientY-r.top)/r.height*PG.h;let hit=-1;
 if(L.n>1)L.slots.forEach((q,i)=>{if(L.shape==='c'?Math.hypot(x-q.x-q.w/2,y-q.y-q.h/2)<=q.w/2:x>=q.x&&x<=q.x+q.w&&y>=q.y&&y<=q.y+q.h)hit=i});
 if(hit<0){S.pvBig=!S.pvBig}else{S.selS=S.selS===hit?-1:hit;S.mode=S.selS>=0&&S.slots[hit].d!==0?'one':'all';S.sel=-1}
 if(root.EdbEdit)root.EdbEdit.unmount();rerender()}
function stepImg(){const I=S.img,P=S.pdf;
 let h=`<div class="edBig"><label class="edO"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg><span>מצלמה</span><input type="file" accept="image/*" capture="environment" data-c="edbImg" hidden></label>
<label class="edO"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/></svg><span>גלריה</span><input type="file" accept="image/*" data-c="edbImg" hidden></label>
<label class="edO"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3h7l4 4v14H7zM14 3v4h4"/><path d="M9.5 13h5M9.5 17h5"/></svg><span>PDF</span><input type="file" accept="application/pdf,.pdf" data-c="edbPdf" hidden></label>
<button class="edO edAlb" data-a="edbAlb"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="9" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg><span>אלבום דפים מוכנים<small>הדפסה מיד, משותף לכל המכשירים בעסק</small></span></button></div>`;
 if(S.busy)h+=`<p class="note" style="margin-top:12px">טוען…</p>`;
 if(P&&P.th&&S.ptg<0)h+=`<div class="edH">בחרו עמוד מתוך הקובץ (${P.n} עמודים${P.n>P.th.length?', מוצגים '+P.th.length+' ראשונים':''})</div><div class="edTh">${P.th.map((u,i)=>`<button data-a="edbPg" data-v="${i+1}" class="${P.sel===i+1?'on':''}"><img src="${u}" alt=""><small>עמוד ${i+1}</small></button>`).join('')}</div>`;
 if(I)h+=`<div class="card" style="margin-top:12px;display:flex;gap:10px;align-items:center"><canvas id="edbTh" width="96" height="96" style="width:72px;height:72px;border-radius:8px;background:#fff;flex:none"></canvas><div><b>${esc(I.name)}</b><small class="note" style="display:block"><span dir="ltr">${I.w}×${I.h}</span> פיקסלים</small></div></div>`;
 else if(!P)h+=`<p class="note" style="margin-top:12px">בחרו תמונה מהגלריה, צלמו, או טענו קובץ PDF. בצעד הבא בוחרים פריסה (עיגולים, ריבועים, דף שלם) ועורכים.</p>`;
 h+=`<div class="edR" style="margin-top:12px"><button class="btn g s" data-a="edbProjs">📁 הפרויקטים שלי</button>${S.pid?'<button class="btn g s" data-a="edbNew">פרויקט חדש</button>':''}</div>${S.saveErr?`<div class="edWarn">${esc(S.saveErr)}</div>`:''}`;
 return h+nav(0,1,'הבא – עריכה ופריסה',!I)}
const worstQ=E=>{let w=null;new Set(S.slots.map(s=>s.d)).forEach(di=>{const v=S.ds[di]?E.quality(S.ds[di]):null;if(v&&(!w||v.d<w.d))w=v});return w};
// סבב 5: דף מהאלבום בצעד ההדפסה (S.alb) – תמונה ממוזערת, שם, הדפסה ופתיחה לעריכה
const albCard=a=>`<div class="card"><div style="display:flex;gap:10px;align-items:center"><img data-th="${esc(a.id)}" alt="" style="width:84px;height:119px;object-fit:contain;background:#fff;border-radius:4px;flex:none"><div style="min-width:0"><b style="display:block;overflow-wrap:anywhere">${esc(a.nm)}</b><small class="note" style="display:block">דף מוכן מהאלבום · ${esc(albLay(a))}</small></div></div>
<button class="btn w" data-a="edbAlbPrint" style="margin-top:10px">הדפסה</button><button class="btn g w" data-a="edbAlbEdit" data-v="${esc(a.id)}" style="margin-top:8px">פתח לעריכה</button></div>`;
function step4(){const L=lay(),c=calGet(),X=St(),p=X?X.cfg():{on:false,name:'',port:''},E=root.EdbEdit,q=S.img&&E?worstQ(E):null,nat=isNatv(),sOn=X&&X.stnOn(S.stn);
 stnLoad();
 let h=p.on?`<div class="edWarn">המחשב הזה הוא תחנת ההדפסה: ההדפסה נשלחת ישר למדפסת "${esc(p.name)}" דרך עוזר ההדפסה</div>`
  :`${sOn?`<div class="card" style="font-weight:700">יש תחנת הדפסה במחשב – בלחיצה על "הדפסה" אפשר לבחור: שליחה למחשב או ${nat?'הדפסה מהטלפון':'הדפסה מהמכשיר הזה'}</div>`:''}<div class="edWarn">${sOn?'בהדפסה מהמכשיר הזה: ':''}בחלון ההדפסה בחרו גודל 100% (לא 'התאם לדף')</div>`;
 h+=S.alb?albCard(S.alb):`
<div class="card"><b>${esc(layTxt(L))}</b>${q?`<div style="margin-top:6px"><span class="edQ ${q.c}"><i></i>איכות: ${q.d} DPI – ${q.t}</span></div>`:''}
<label class="row" style="gap:8px;align-items:center;margin-top:10px;min-height:44px"><input type="checkbox" data-c="edbCut"${S.cut?' checked':''} style="width:24px;height:24px"> קווי חיתוך אפורים</label>
<button class="btn w" data-a="edbPrint" style="margin-top:8px"${S.img?'':' disabled'}>הדפסה</button>
<button class="btn g w" data-a="edbAlbSave" style="margin-top:8px"${S.img?'':' disabled'}>שמור לאלבום</button><small class="note" style="display:block;margin-top:4px">שומר את הדף כמו שהוא בענן של העסק, להדפסה מיד מכל טלפון ומחשב בעסק.</small></div>`;
 h+=`
<details class="card"${c.sx!==1||c.sy!==1||c.ox||c.oy?'':''}><summary>כיול מדפסת</summary>
<p class="note">מדפיסים דף כיול על נייר רגיל, מודדים בסרגל ומקלידים. הכיול נשמר במכשיר ומוחל על כל ההדפסות.</p>
<button class="btn g w" data-a="edbCal">הדפסת דף כיול</button>
<form data-f="edbCal"><div class="edR"><label class="f"><span>אורך הקו האופקי (מ"מ)</span><input name="h" type="number" step="0.1" inputmode="decimal" placeholder="100"></label><label class="f"><span>אורך הקו האנכי (מ"מ)</span><input name="v" type="number" step="0.1" inputmode="decimal" placeholder="100"></label></div>
<div class="edR"><label class="f"><span>הצלב – מרחק מהקצה השמאלי</span><input name="dl" type="number" step="0.1" inputmode="decimal" placeholder="20"></label><label class="f"><span>הצלב – מרחק מהקצה העליון</span><input name="dt" type="number" step="0.1" inputmode="decimal" placeholder="20"></label></div>
<small class="note" style="display:block">כיול נוכחי: רוחב ×${c.sx.toFixed(3)}, גובה ×${c.sy.toFixed(3)}, הזזה ${c.ox.toFixed(1)} / ${c.oy.toFixed(1)} מ"מ</small>
<div class="edNav"><button class="btn" type="submit">שמירת כיול</button><button class="btn g" type="button" data-a="edbCal0">איפוס</button></div></form></details>
${X?`<details class="card"${p.on?' open':''}><summary>תחנת הדפסה (המחשב עם מדפסת הדף האכיל)</summary>
${S.stn?`<p class="note">${esc(X.stnTxt(S.stn)||'אין תחנה פעילה בעסק')}</p>`:'<p class="note">אין עדיין תחנת הדפסה בעסק.</p>'}
${nat?'<p class="note">ההגדרה נעשית במחשב שמחוברת אליו מדפסת הדף האכיל, לא בטלפון.</p>':`<p class="note">מסמנים רק במחשב שמחוברת אליו מדפסת הדף האכיל ושעוזר ההדפסה (edb-helper) פועל בו. הדפסות מהטלפונים יודפסו בו לבד, גם כשמסך אחר פתוח (למשל מדבקות). נקודה קטנה בפינה השמאלית התחתונה: ירוק – פעילה, צהוב – מדפיסה, אדום – תקלה.</p>
<form data-f="edbPrn"><label class="row" style="gap:8px;align-items:center;min-height:44px"><input type="checkbox" name="on"${p.on?' checked':''} style="width:24px;height:24px"> המחשב הזה = תחנת הדפסה לדף אכיל</label>
<div class="edR"><label class="f"><span>שם המדפסת (או חלק ממנו)</span><input name="name" maxlength="80" dir="ltr" value="${esc(p.name)}"></label><label class="f"><span>פורט (קבוע)</span><input name="port" dir="ltr" value="${esc(X.DEF.port)}" readonly disabled></label></div>
<small class="note" style="display:block">הפורט קבוע: 17891. הגדרות האבטחה של האתר מתירות פנייה רק אליו – פורט אחר דורש שינוי גם בקובץ firebase.json (CSP) ופרסום מחדש של האתר.</small>
<button class="btn g w" type="submit">שמירה</button></form>
<button class="btn g w" data-a="edbHlp" style="margin-top:8px">בדיקת עוזר ההדפסה</button><div id="edbHlpR" class="note" style="margin-top:6px"></div>`}</details>`:''}`;
 return h+(S.alb?`<div class="edNav"><button class="btn g" data-a="edbAlb">חזרה לאלבום</button></div>`:nav(1,0))}
// מצב התחנה בעסק (edbs/main) – נטען פעם בדקה כשמסך ההדפסה פתוח
let stnB=0;const stnLoad=()=>{const X=St();if(!X||stnB)return;stnB=1;const f=S.stnF;S.stnF=0;X.stn(f).then(v=>{stnB=0;const a=JSON.stringify(S.stn||null),b=JSON.stringify(v||null);S.stn=v;if(a!==b&&S.st===3)redraw()},()=>{stnB=0})};
V.edb=()=>{if(!ok())return{t:T,h:'<div class="empty">אין לך הרשאה להדפסת דף אכיל</div>'};
 // סבב 5: מתחילים תמיד מצעד 1. העבודה האחרונה לא הודפסה – פס "להמשיך את העבודה הקודמת?" ל-10 שניות (resumeAsk)
 if(!S.img&&!S.busy&&!S.rst&&!S.alb){S.rst=1;const id=lsCur();if(id)setTimeout(()=>resumeAsk(id),0)}
 if(S.alb&&S.st!==3)S.alb=null;if(!S.img&&!S.alb&&S.st>1)S.st=1;lay();const E=root.EdbEdit;
 const body=S.st===1?stepImg():S.st===2?stepEdit():step4();
 setTimeout(()=>{try{if(cur().v!=='edb')return;if(S.st===2){if(E&&lay().n)E.mount(S);pvDraw();const pc=document.getElementById('edbPg');if(pc&&!pc.dataset.on){pc.dataset.on='1';pc.addEventListener('click',pgTap)}}if(S.st===1&&S.img)thumb();if(S.st===3&&S.alb)albThAll()}catch(e){}},0);
 return{t:T,h:css+`<div id="edbW">${steps()}${body}</div>`}};
const thumb=()=>{const c=document.getElementById('edbTh');if(!c||!S.img)return;const g=c.getContext('2d'),s=S.img.p,k=Math.min(96/s.width,96/s.height);g.fillStyle='#fff';g.fillRect(0,0,96,96);g.drawImage(s,(96-s.width*k)/2,(96-s.height*k)/2,s.width*k,s.height*k)};
window.edbTile=k=>ok()?(k==='add'?`<button class="tile" data-a="addGo" data-v="edb" style="font-size:1rem">${ico('doc')}הדפסת דף אכיל</button>`:`<button class="tile" data-a="go" data-v="edb" style="font-size:1.15rem;text-align:center;border-color:var(--acc);color:var(--acc)">${ico('doc')}הדפסת דף אכיל</button>`):'';

ACT.edbSt=el=>{const v=+el.dataset.v;if(!(v>=1&&v<=3))return;if(S.alb){S.alb=null;if(!S.img){S.st=1;rerender();return}}if(v>=2&&!S.img){toast('קודם בוחרים תמונה');return}if(v>=3&&!lay().n)return;if(S.st===2&&root.EdbEdit)root.EdbEdit.unmount();S.st=v;if(v===3)S.stnF=1;rerender()};
// החלפת פריסה שומרת את התמונה והעריכה: מיקום וזום יחסיים למשבצת (מתאימים לבד); גודל הכיתוב (מ"מ) – לפי היחס בין הגדלים
function relay(fn){const a=S.L&&S.L.n?Math.min(S.L.w,S.L.h):0;fn();S.L=null;const L=lay(),b=L.n?Math.min(L.w,L.h):0;
 if(a&&b&&a!==b)S.ds.forEach(d=>(d.tx||[]).forEach(x=>{x.sz=Math.round(clamp(x.sz*b/a,3,60)*2)/2}));mark();if(root.EdbEdit)root.EdbEdit.unmount();rerender()}
ACT.edbLay=el=>relay(()=>{S.k=el.dataset.v});
CHG.edbCu=el=>{const n=el.name;relay(()=>{S.cu[n]=n==='sh'?el.value:clamp(+el.value||10,10,n==='h'?287:200)})};
CHG.edbCut=el=>{S.cut=!!el.checked};
// תמונה: מוקטנת למה שצריך ל-300 DPI (עד cap בצד הארוך; לכללית – 4000, לפרטית של משבצת – לפי גודלה) + עותק קטן לתצוגה (עד 1024). כתובת ה-blob משוחררת מיד
const loadImg=f=>new Promise((res,rej)=>{const u=URL.createObjectURL(f),im=new Image();im.onload=()=>{URL.revokeObjectURL(u);res(im)};im.onerror=()=>{URL.revokeObjectURL(u);rej(new Error('התמונה לא נפתחה'))};im.src=u});
function mkImg(src,w,h,name,cap,blob){const F=fitCap(w,h,cap),c=document.createElement('canvas');c.width=F.w;c.height=F.h;const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,F.w,F.h);g.imageSmoothingQuality='high';g.drawImage(src,0,0,F.w,F.h);
 const P=fitCap(F.w,F.h,1024),p=document.createElement('canvas');p.width=P.w;p.height=P.h;const q=p.getContext('2d');q.imageSmoothingQuality='high';q.drawImage(c,0,0,P.w,P.h);
 let lv=null;try{lv=levels(q.getImageData(0,0,P.w,P.h).data)}catch(e){}
 return{id:'i'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),c,p,w:F.w,h:F.h,name:String(name||'תמונה').slice(0,60),lv,cap:cap||CAP,blob:blob||null,stored:false}}
const addImg=m=>{S.imgs.push(m);return S.imgs.length-1};
function setImg(src,w,h,name,blob){const m=mkImg(src,w,h,name,CAP,blob);S.gi=addImg(m);S.img=m;const d=S.ds[0];S.ds[0]=Object.assign(newD(0),{tx:d?d.tx:[]});initProj()}
// עיצוב נפרד למשבצת (עותק של העיצוב המשותף; אותה תמונה עד שבוחרים אחרת)
const cloneD=d=>JSON.parse(JSON.stringify(d));
function fork(i){if(!S.slots[i]||S.slots[i].d!==0)return;S.ds.push(cloneD(S.ds[0]));S.slots[i].d=S.ds.length-1}
function slotImg(src,w,h,name,blob){const i=S.selS;lay();if(i<0||!S.slots[i])return;const k=addImg(mkImg(src,w,h,name,imgCap(lay()),blob));fork(i);
 const d=S.ds[S.slots[i].d];Object.assign(d,{x:0,y:0,z:1,rot:0,fl:false,im:k});delete d.kc;delete d.kt;S.mode='one';mark()}
const tgtSlot=el=>!!(el&&el.dataset&&el.dataset.t==='s'&&S.mode==='one'&&S.selS>=0);
CHG.edbImg=async el=>{const f=el.files&&el.files[0],sl=tgtSlot(el);el.value='';if(!f)return;S.busy=1;redraw();
 try{const im=await loadImg(f),bl=f.size<=25e6?f:null;if(sl)slotImg(im,im.naturalWidth,im.naturalHeight,f.name,bl);else{setImg(im,im.naturalWidth,im.naturalHeight,f.name,bl);S.st=2}im.src='';if(!sl)relPdf();S.busy=0;redraw()}catch(e){S.busy=0;toast(e.message||'התמונה לא נפתחה');redraw()}};
CHG.edbPdf=async el=>{const f=el.files&&el.files[0],sl=tgtSlot(el);el.value='';if(!f)return;if(typeof pdfLoad!=='function'){toast('PDF לא נתמך כאן');return}
 relPdf();S.ptg=sl?S.selS:-1;S.busy=1;redraw();
 try{const lib=await pdfLoad(),doc=await lib.getDocument({data:new Uint8Array(await f.arrayBuffer())}).promise,n=doc.numPages,th=[];
  for(let i=1;i<=Math.min(n,24);i++){const pg=await doc.getPage(i),v0=pg.getViewport({scale:1}),vp=pg.getViewport({scale:120/v0.width}),c=document.createElement('canvas');c.width=Math.ceil(vp.width);c.height=Math.ceil(vp.height);const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);
   await pg.render({canvasContext:g,viewport:vp}).promise;th.push(c.toDataURL('image/jpeg',0.7));freeCv(c);try{pg.cleanup()}catch(e){}}
  S.pdf={doc,n,th,sel:0,name:String(f.name||'PDF')};S.busy=0;
  if(n===1)await pickPg(1);
  else if(sl){redraw();dlg(`<h3>בחרו עמוד</h3><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;max-height:60vh;overflow:auto">${th.map((u,i)=>`<button data-a="edbPg" data-v="${i+1}" style="border:2px solid var(--line);border-radius:8px;background:#fff;padding:3px;color:#333;min-height:60px"><img src="${u}" alt="" style="width:100%;display:block"><small>עמוד ${i+1}</small></button>`).join('')}</div><button class="btn g w" data-a="edbPgX" style="margin-top:8px">ביטול</button>`)}
  else redraw()}
 catch(e){S.busy=0;relPdf();toast('קובץ ה-PDF לא נפתח');redraw()}};
async function pickPg(i){const P=S.pdf;if(!P||!P.doc)return;S.busy=1;P.sel=i;redraw();const sl=S.ptg>=0;
 try{const L=lay(),pg=await P.doc.getPage(i),v0=pg.getViewport({scale:1}),vp=pg.getViewport({scale:sl?pdfScale(v0.width,v0.height,L.w,L.h,imgCap(L)):pdfScale(v0.width,v0.height,PG.w-2*PG.m,PG.h-2*PG.m)}),c=document.createElement('canvas');c.width=Math.ceil(vp.width);c.height=Math.ceil(vp.height);
  const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);await pg.render({canvasContext:g,viewport:vp}).promise;
  if(sl){slotImg(c,c.width,c.height,P.name+' – עמוד '+i,null);S.ptg=-1;relPdf();closeDlg()}else{setImg(c,c.width,c.height,P.name+' – עמוד '+i,null);S.st=2}
  freeCv(c);try{pg.cleanup()}catch(e){}S.busy=0;redraw()}
 catch(e){S.busy=0;toast('העמוד לא נטען');redraw()}}
ACT.edbPg=el=>pickPg(+el.dataset.v);
ACT.edbPgX=()=>{S.ptg=-1;relPdf();closeDlg();redraw()};

/* =================== סבב 2ב: היסטוריה (ביטול / חזרה) =================== */
// מצב העבודה כפרמטרים בלבד (בלי תמונות). כל שינוי מסמן mark(); 400ms בלי שינוי נוספים = צעד אחד בהיסטוריה (עד 30)
const snap=()=>{lay();return JSON.stringify({k:S.k,cu:S.cu,ds:S.ds,slots:S.slots,gi:S.gi})};
let MT=0,AT=0;
function prune(){if(!S.slots.length)return;const used=new Set([0]);S.slots.forEach(s=>used.add(s.d));if(used.size===S.ds.length)return;const map={},nd=[];S.ds.forEach((d,i)=>{if(used.has(i)){map[i]=nd.length;nd.push(d)}});S.ds=nd;S.slots.forEach(s=>{s.d=map[s.d]})}
function gc(){const ref=new Set(),add=o=>{ref.add(o.gi);(o.ds||[]).forEach(d=>{if(d&&d.im!=null)ref.add(d.im)})};add({ds:S.ds,gi:S.gi});H.all().forEach(x=>{try{add(JSON.parse(x))}catch(e){}});S.imgs.forEach((m,i)=>{if(m&&!ref.has(i)){freeImg(m);S.imgs[i]=null}})}
const updUR=()=>{const a=document.getElementById('edbUn'),b=document.getElementById('edbRe');if(a)a.disabled=!H.canUndo();if(b)b.disabled=!H.canRedo()};
function commit(){if(MT){clearTimeout(MT);MT=0}if(!S.pid||!S.img)return;prune();if(H.commit(snap())){S.pr=0;gc();updUR();asv()}} // סבב 5: שינוי אחרי הדפסה – שוב "לא הודפס"
function mark(){if(!S.pid)return;clearTimeout(MT);MT=setTimeout(()=>{MT=0;commit()},400)}
function hstep(dir){commit();const s=dir<0?H.undo():H.redo();if(!s)return;let o;try{o=JSON.parse(s)}catch(e){return}
 S.k=o.k;S.cu=o.cu;S.ds=o.ds;S.slots=o.slots;S.gi=o.gi;S.img=S.imgs[S.gi]||S.img;S.L=null;S.sel=-1;lay();S.mode=S.selS>=0&&S.slots[S.selS]&&S.slots[S.selS].d!==0?'one':'all';
 if(root.EdbEdit)root.EdbEdit.unmount();rerender();asv()}
ACT.edbUndo=()=>{if(!S.busy)hstep(-1)};ACT.edbRedo=()=>{if(!S.busy)hstep(1)};
ACT.edbBig=()=>{S.pvBig=!S.pvBig;if(root.EdbEdit)root.EdbEdit.unmount();rerender()};
// בחירת מצב למשבצת הנבחרת: תמונה לכולם (חוזרת לעיצוב המשותף) / תמונה שונה (עיצוב נפרד, אותה תמונה עד שבוחרים אחרת)
ACT.edbMode=el=>{const i=S.selS;lay();if(i<0||!S.slots[i])return;if(el.dataset.v==='all'){S.slots[i].d=0;S.mode='all'}else{fork(i);S.mode='one'}S.sel=-1;mark();if(root.EdbEdit)root.EdbEdit.unmount();rerender()};
// "העתק לכולם": העיצוב (והתמונה) של המשבצת הנבחרת הופכים לעיצוב המשותף של כל המשבצות
ACT.edbCopyAll=()=>{const i=S.selS;lay();if(i<0||!S.slots[i]||S.slots[i].d===0)return;const c=cloneD(S.ds[S.slots[i].d]);if(c.im!=null){S.gi=c.im;S.img=S.imgs[S.gi]||S.img;delete c.im}
 S.ds=[c];S.slots=S.slots.map(()=>({d:0}));S.mode='all';S.sel=-1;mark();if(root.EdbEdit)root.EdbEdit.unmount();rerender();toast('הועתק לכולם (אפשר לבטל ב-↶)')};

/* =================== סבב 2ב: פרויקטים במכשיר (IndexedDB) ===================
   מסד lp-edb: proj = רשומה לכל פרויקט (שם, פריסה, משבצות עם פרמטרים, רשימת תמונות, תמונה ממוזערת), img = קובצי התמונות (Blob) לפי מפתח "<פרויקט>|<תמונה>".
   העבודה הנוכחית נשמרת לבד (1.5 שניות אחרי שינוי, ביציאה מהמסך ובמעבר לרקע) ונפתחת מחדש בכניסה. הכול בתוך try/catch; חריגת מכסה – הודעה בעברית
   סבב 3: הפרדה לפי עסק + משתמש באותו מכשיר – לכל פרויקט שדה ow = "<עסק>|<משתמש>"; רואים ופותחים רק את שלכם. פרויקטים ישנים (בלי ow, מסבב 2ב שלא פורסם)
   לא נמחקים ולא משתנים – פשוט לא מוצגים. תמונות שנוצרו בקנבס (עמוד PDF, תמונה מוקטנת למשבצת) נשמרות PNG – בלי איבוד איכות */
const own=()=>String(SY&&SY.bizId||'')+'|'+String(SY&&SY.uid||'');
const LSK=()=>'lp-edb-cur|'+own(),lsCur=()=>{try{return localStorage.getItem(LSK())||''}catch(e){return ''}},lsSet=v=>{try{if(v)localStorage.setItem(LSK(),v);else localStorage.removeItem(LSK())}catch(e){}};
const mineP=r=>!!r&&r.ow===own()&&!!SY&&!!SY.uid;
let DBP=null;const db=()=>DBP||(DBP=new Promise((res,rej)=>{try{const r=indexedDB.open('lp-edb',1);r.onupgradeneeded=()=>{const d=r.result;d.createObjectStore('proj',{keyPath:'id'});d.createObjectStore('img')};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error||new Error('idb'));r.onblocked=()=>rej(new Error('idb'))}catch(e){rej(e)}}).catch(e=>{DBP=null;throw e}));
const dbTx=(stores,mode,fn)=>db().then(d=>new Promise((res,rej)=>{let out;const t=d.transaction(stores,mode);t.oncomplete=()=>res(out&&out.result!==undefined?out.result:out);t.onerror=()=>rej(t.error);t.onabort=()=>rej(t.error||new Error('abort'));try{out=fn(t)}catch(e){try{t.abort()}catch(x){}rej(e)}}));
const dbGet=(st,k)=>dbTx(st,'readonly',t=>t.objectStore(st).get(k)),dbAll=st=>dbTx(st,'readonly',t=>t.objectStore(st).getAll()),keysOf=pid=>dbTx('img','readonly',t=>t.objectStore('img').getAllKeys(IDBKeyRange.bound(pid+'|',pid+'|￿')));
const quotaErr=e=>!!e&&(e.name==='QuotaExceededError'||/quota/i.test(String(e.message||'')));
const tb=c=>new Promise((res,rej)=>c.toBlob(b=>b?res(b):rej(new Error('התמונה לא נשמרה')),'image/png')); // PNG – איכות מלאה (בעל העסק, סבב 3)
const autoName=()=>{const d=new Date(),p=n=>String(n).padStart(2,'0');return `דף אכיל ${p(d.getDate())}.${p(d.getMonth()+1)} ${p(d.getHours())}:${p(d.getMinutes())}`};
function thumbURL(){let c=null;try{c=document.createElement('canvas');c.width=120;c.height=170;pgPaint(c,false);return c.toDataURL('image/jpeg',0.6)}catch(e){return ''}finally{freeCv(c)}}
function initProj(){if(!S.pid){S.ow=own();S.pid='p'+Date.now().toString(36)+Math.random().toString(36).slice(2,5);S.pname=autoName();lsSet(S.pid);H=mkHist(30);H.init(snap());asv()}else mark()}
const asv=()=>{clearTimeout(AT);AT=setTimeout(()=>{save()},1500)};
let SQ=Promise.resolve();
// החלק הסינכרוני (הקלטת הפרמטרים, התחלת קידוד התמונות והתמונה הממוזערת) קורה מיד – אפשר לשחרר את הקנבסים מיד אחרי הקריאה
function save(){if(!S.pid||!S.img)return SQ;const pid=S.pid,ims=S.imgs.slice(),need=ims.filter(m=>m&&!m.stored&&m.c&&m.c.width>0);
 let bl,rec;try{bl=need.map(m=>m.blob?Promise.resolve(m.blob):tb(m.c));rec=root.EdbCore.projPack({name:S.pname||autoName(),k:S.k,cu:S.cu,cut:S.cut,ds:S.ds,slots:S.slots,gi:S.gi,imgs:ims});rec.id=pid;rec.ow=S.ow||own();rec.at=Date.now();rec.th=thumbURL();if(S.pr)rec.pr=1}catch(e){return SQ}
 const job=async()=>{try{const bs=await Promise.all(bl);
   await dbTx(['proj','img'],'readwrite',t=>{need.forEach((m,i)=>t.objectStore('img').put(bs[i],pid+'|'+m.id));t.objectStore('proj').put(rec)});
   need.forEach(m=>{m.stored=true;m.blob=null});
   const live=new Set(ims.filter(Boolean).map(m=>pid+'|'+m.id)),old=(await keysOf(pid)).filter(k=>!live.has(k));
   if(old.length)await dbTx('img','readwrite',t=>old.forEach(k=>t.objectStore('img').delete(k)));
   S.saveErr=''}
  catch(e){const m=quotaErr(e)?'אין מספיק מקום פנוי במכשיר לשמירת הפרויקט. מוחקים פרויקטים ישנים (📁 פרויקטים) או מפנים מקום. העבודה הנוכחית עדיין פתוחה, אבל לא נשמרת.':'שמירת הפרויקט במכשיר נכשלה. העבודה הנוכחית עדיין פתוחה.';if(S.saveErr!==m){S.saveErr=m;try{toast(m)}catch(x){}}}};
 return SQ=SQ.then(job,job)}
function resetWork(){if(root.EdbEdit)root.EdbEdit.unmount();clearTimeout(MT);MT=0;clearTimeout(AT);freeAll();relPdf();S.pr=0;S.alb=null;S.pid=null;S.ow="";S.pname='';S.st=1;S.ds=[newD(0)];S.slots=[];S.selS=-1;S.sel=-1;S.mode='all';S.L=null;S.ptg=-1;PEND=null}
async function openProj(id,silent){if(S.busy)return;S.busy=1;redraw();
 try{if(S.pid&&S.img&&S.pid!==id){commit();await save()}
  const rec=await dbGet('proj',id);if(!mineP(rec))throw new Error('missing');const st=root.EdbCore.projUnpack(rec);if(!st)throw new Error('missing');
  resetWork();const L=[];
  for(const m of st.imgs){if(!m){L.push(null);continue}const b=await dbGet('img',id+'|'+m.id);if(!b){L.push(null);continue}
   const im=await loadImg(b);try{const o=mkImg(im,im.naturalWidth,im.naturalHeight,m.name,m.cap,null);o.id=m.id;o.stored=true;L.push(o)}finally{im.src=''}}
  st.ds.forEach(d=>{if(d.im!=null&&!L[d.im])delete d.im});if(!L[st.gi])st.gi=L.findIndex(Boolean);if(st.gi<0)throw new Error('noimg');
  S.imgs=L;S.gi=st.gi;S.img=L[st.gi];S.k=st.k;S.cu=st.cu;S.cut=st.cut;S.ds=st.ds;S.slots=st.slots;S.L=null;S.pid=id;S.ow=rec.ow;S.pr=rec.pr===1?1:0;S.pname=st.name||autoName();lsSet(id);
  lay();H=mkHist(30);H.init(snap());S.st=2;S.saveErr='';if(!silent)closeDlg();toast(silent?'ממשיכים מהעבודה האחרונה (פרויקט חדש: בצעד 1)':'הפרויקט נפתח')}
 catch(e){resetWork();if(silent)lsSet('');else toast('הפרויקט לא נפתח')}
 finally{S.busy=0;redraw()}}
async function projDlg(){try{if(S.pid&&S.img){commit();await save()}const R=(await dbAll('proj')).filter(mineP).sort((a,b)=>(b.at||0)-(a.at||0)),dt=t=>{try{return new Date(t).toLocaleString('he-IL',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}catch(e){return ''}};
 dlg(`<h3>הפרויקטים שלי</h3><p class="note">הפרויקטים נשמרים במכשיר הזה בלבד (לא בענן). העבודה הנוכחית נשמרת לבד.</p><div style="max-height:55vh;overflow:auto">${R.length?R.map(r=>{let lt='';try{lt=layTxt(layout(r.k,r.cu))}catch(e){}
  return `<div style="display:flex;gap:6px;align-items:center;border:1px solid var(--line);border-radius:12px;padding:6px;margin-bottom:6px${r.id===S.pid?';border-color:var(--acc)':''}"><button data-a="edbPOpen" data-v="${esc(r.id)}" style="flex:1;min-width:0;display:flex;gap:8px;align-items:center;background:none;border:0;color:inherit;text-align:start;min-height:64px;font:inherit"><img src="${esc(r.th||'')}" alt="" style="width:42px;height:60px;object-fit:contain;background:#fff;border-radius:4px;flex:none"><span style="min-width:0"><b style="display:block;overflow:hidden;text-overflow:ellipsis">${esc(r.name||'פרויקט')}${r.id===S.pid?' (פתוח)':''}</b><small class="note" style="display:block">${esc(dt(r.at))} · ${esc(lt)}</small></span></button><button class="btn g s" data-a="edbPRen" data-v="${esc(r.id)}" style="flex:none">שם</button><button class="btn r s" data-a="edbPDel" data-v="${esc(r.id)}" style="flex:none">מחיקה</button></div>`}).join(''):'<p class="note">אין עדיין פרויקטים שמורים.</p>'}</div>
<div style="display:flex;gap:8px;margin-top:8px"><button class="btn w" data-a="edbNew">פרויקט חדש</button><button class="btn g w" data-a="closeDlg">סגירה</button></div>`)}
 catch(e){toast('אין גישה לפרויקטים השמורים במכשיר הזה')}}
ACT.edbProjs=()=>{projDlg()};
ACT.edbPOpen=el=>{openProj(el.dataset.v)};
ACT.edbNew=async()=>{if(S.busy)return;try{if(S.pid&&S.img){commit();await save()}}catch(e){}resetWork();lsSet('');closeDlg();rerender()};
ACT.edbPRen=async el=>{try{const r=await dbGet('proj',el.dataset.v);if(!mineP(r))return;dlg(`<h3>שינוי שם</h3><form data-f="edbPRen"><input type="hidden" name="id" value="${esc(r.id)}"><label class="f"><span>שם הפרויקט</span><input name="n" maxlength="60" value="${esc(r.name||'')}" required></label><div style="display:flex;gap:8px;margin-top:8px"><button class="btn w" type="submit">שמירה</button><button class="btn g w" type="button" data-a="edbProjs">ביטול</button></div></form>`)}catch(e){toast('לא ניתן לפתוח את הפרויקט')}};
FRM.edbPRen=async f=>{const id=(f.querySelector('[name=id]')||{}).value,n=String((f.querySelector('[name=n]')||{}).value||'').trim().slice(0,60);if(!id||!n){toast('הקלידו שם');return}
 try{const r=await dbGet('proj',id);if(!mineP(r))return;if(id===S.pid)S.pname=n;r.name=n;await dbTx('proj','readwrite',t=>t.objectStore('proj').put(r));projDlg()}catch(e){toast(quotaErr(e)?'אין מספיק מקום פנוי במכשיר':'שינוי השם נכשל')}};
ACT.edbPDel=async el=>{try{const r=await dbGet('proj',el.dataset.v);if(!mineP(r))return;dlg(`<h3>מחיקת פרויקט</h3><p>למחוק את "${esc(r.name||'פרויקט')}"? אי אפשר לשחזר אותו.</p><div style="display:flex;gap:8px"><button class="btn r w" data-a="edbPDel2" data-v="${esc(r.id)}">מחיקה</button><button class="btn g w" data-a="edbProjs">ביטול</button></div>`)}catch(e){toast('לא ניתן לפתוח את הפרויקט')}};
ACT.edbPDel2=async el=>{const id=el.dataset.v;try{if(!mineP(await dbGet('proj',id)))return;const ks=await keysOf(id);await dbTx(['proj','img'],'readwrite',t=>{ks.forEach(k=>t.objectStore('img').delete(k));t.objectStore('proj').delete(id)});
  if(id===S.pid){resetWork();lsSet('');rerender()}projDlg()}catch(e){toast('המחיקה נכשלה')}};

/* =================== הדפסה =================== */
// איכות לפני מהירות: תמונת המשבצת נכנסת ל-PDF בלי איבוד – RGB גולמי דחוס Flate (CompressionStream, ברצועות של 256 שורות כדי לא להחזיק עוד עותק מלא).
// מכשיר ישן בלי CompressionStream – JPEG באיכות 0.95 (המוצא היחיד)
async function imgOf(c){const W=c.width,H=c.height;
 if(typeof CompressionStream!=='function')return{w:W,h:H,jpg:await new Promise((res,rej)=>c.toBlob(b=>b?b.arrayBuffer().then(a=>res(new Uint8Array(a)),rej):rej(new Error('התמונה לא נוצרה')),'image/jpeg',0.95))};
 const cs=new CompressionStream('deflate'),w=cs.writable.getWriter(),out=new Response(cs.readable).arrayBuffer(),g=c.getContext('2d');
 for(let y=0;y<H;y+=256){const h=Math.min(256,H-y),d=g.getImageData(0,y,W,h).data,rgb=new Uint8Array(W*h*3);for(let i=0,j=0;i<d.length;i+=4,j+=3){rgb[j]=d[i];rgb[j+1]=d[i+1];rgb[j+2]=d[i+2]}await w.write(rgb)}
 await w.close();return{w:W,h:H,flate:new Uint8Array(await out)}}
const px=mm=>Math.round(mm/25.4*DPI);
// עמוד A4 כתמונת PNG (300 DPI, בלי איבוד) – לדפדפן, לתחנת ההדפסה ולעוזר המקומי. אותו תיאור עמוד של ה-PDF, עם אותו כיול. קנבס עמוד אחד בכל רגע, משוחרר מיד
async function pageBlob(pg,srcs){const W=px(PG.w),H=px(PG.h),k=W/PG.w,c=document.createElement('canvas');c.width=W;c.height=H;const g=c.getContext('2d'),m=calMap(pg.cal);
 g.fillStyle='#fff';g.fillRect(0,0,W,H);g.setTransform(m.a*k,0,0,m.d*k,m.e*k,m.f*k);g.imageSmoothingQuality='high';
 (pg.draws||[]).forEach(d=>{const s=srcs[d.i];if(s)g.drawImage(s,d.x,d.y,d.w,d.h)});
 g.strokeStyle='#999';g.lineWidth=0.14;(pg.cuts||[]).forEach(q=>{g.beginPath();if(q.c)g.arc(q.x+q.w/2,q.y+q.h/2,q.w/2,0,Math.PI*2);else g.rect(q.x,q.y,q.w,q.h);g.stroke()});
 g.strokeStyle='#000';(pg.lines||[]).forEach(l=>{g.lineWidth=l[4]||0.3;g.beginPath();g.moveTo(l[0],l[1]);g.lineTo(l[2],l[3]);g.stroke()});
 const b=await new Promise((res,rej)=>c.toBlob(b=>b?res(b):rej(new Error('התמונה לא נוצרה')),'image/png'));freeCv(c);return b} // PNG – בלי איבוד
const pageImg=async(pg,srcs)=>URL.createObjectURL(await pageBlob(pg,srcs));
/* ---------- הדפסה – פונקציה אחת לכל הדרכים ----------
   EdbPrint.send({pdf (Uint8Array), pdfB64?, pages (Blob[] של PNG, או פונקציה async שמחזירה אותם), name, title, how?})
   1. המחשב הזה = תחנת הדפסה (EdbSt.cfg().on): ישר לעוזר ההדפסה המקומי (http://127.0.0.1:<port>), למדפסת לפי שם. לא עונה – שגיאה,
      בלי חלון הדפסה (ב-Chrome --kiosk-printing חלון ההדפסה היה מדפיס בשקט למדפסת המדבקות).
   2. how === 'station': שליחה לתחנה (EdbSt.send – תור בענן, חלון מצב). go() מציע אותה כברירת מחדל כשיש תחנה פעילה בעסק.
   3. טלפון: התוסף PdfPrint (חלון ההדפסה של אנדרואיד, A4).
   4. דפדפן: iframe נסתר, @page A4 בלי שוליים, כל עמוד <img> של 210×297 מ"מ, ואז print(). */
const pagesOf=async o=>typeof o.pages==='function'?await o.pages():(o.pages||[]);
async function viaWeb(o){const U=(await pagesOf(o)).map(b=>URL.createObjectURL(b));
 const old=document.getElementById('edbPf');if(old)old.remove();
 const f=document.createElement('iframe');f.id='edbPf';f.setAttribute('aria-hidden','true');f.tabIndex=-1;f.style.cssText='position:fixed;left:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none';
 document.body.appendChild(f);const D=f.contentDocument;
 D.open();D.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(o.name||'edible')}</title><style>@page{size:A4;margin:0}html,body{margin:0;padding:0;background:#fff}img{display:block;width:210mm;height:297mm;break-after:page}img:last-child{break-after:auto}</style></head><body>${U.map(u=>`<img src="${u}" alt="">`).join('')}</body></html>`);D.close();
 await Promise.all(Array.from(D.images).map(im=>im.complete?0:new Promise(r=>{im.onload=im.onerror=r})));
 f.contentWindow.focus();f.contentWindow.print();
 setTimeout(()=>{if(document.getElementById('edbPf')===f)f.remove();U.forEach(u=>{try{URL.revokeObjectURL(u)}catch(e){}})},120000);return true}
// סבב 5: o.alb – דף מהאלבום (לתחנה: הפניה בלי העלאה); o.pdfF – יצירת ה-PDF רק כשצריך (טלפון); o.onSent – אחרי שליחה מוצלחת (סימון "הודפס")
async function send(o){const how=await send0(o);if(o.onSent&&['helper','station','native','web'].includes(how)){try{o.onSent(how)}catch(e){}}return how}
async function send0(o){const X=St(),c=X?X.cfg():null;
 if(c&&c.on){await X.local(await pagesOf(o),o.name);return 'helper'} // המצב (חסר נייר / הודפס) – בחלון ההודעות של התחנה
 if(o.how==='station'&&X){const r=o.alb?await X.sendAlb(o.alb,o.title):await X.send(await pagesOf(o),o.title);return r===false?'station-fail':'station'}
 const C=typeof shNat==='function'?shNat():null;
 if(C&&C.Plugins&&C.Plugins.PdfPrint){await C.Plugins.PdfPrint.print({name:o.name||'edible',data:o.pdfB64||shB64(o.pdf||await o.pdfF())});return 'native'}
 await viaWeb(o);return 'web'}
// לפני שליחה: יש תחנה פעילה בעסק והמכשיר הזה אינו התחנה – חלון בחירה (ברירת המחדל, הכפתור הראשון: שליחה למחשב).
// תמונות העמוד נוצרות לפני החלון (הקנבסים משתחררים מיד), ונשמרות ב-PEND עד הבחירה
let PEND=null;
async function go(o){const X=St(),c=X?X.cfg():null;
 if(X&&!(c&&c.on)&&X.ok()){const s=await X.stn(true);if(X.stnOn(s)){if(!o.alb)o.pages=await pagesOf(o);PEND=o;
  dlg(`<h3>לאן להדפיס?</h3><p class="note">${esc(X.stnTxt(s))}</p><div style="display:flex;flex-direction:column;gap:8px"><button class="btn w" data-a="edbHow" data-v="station">שליחה למחשב (מדפסת דף אכיל)</button><button class="btn g w" data-a="edbHow" data-v="here">${isNatv()?'הדפסה מהטלפון':'הדפסה מהמכשיר הזה'}</button><button class="btn g w" data-a="closeDlg">ביטול</button></div>`);return 'ask'}}
 return send(o)}
const doneMsg=how=>{if(how==='helper')toast('נשלח למדפסת הדף האכיל');else if(how==='native'||how==='web')toast('נשלח להדפסה')};
ACT.edbHow=async el=>{const o=PEND;PEND=null;if(!o)return;closeDlg();o.how=el.dataset.v==='station'?'station':'here';
 try{doneMsg(await send(o))}catch(e){toast('ההדפסה נכשלה: '+(e&&e.message||e))}};
// הדף: כל עיצוב (ds) מרונדר פעם אחת ב-300 DPI עם גלישה של 1.5 מ"מ; משבצות עם אותו עיצוב חולקות תמונה
async function build(){const L=lay(),E=root.EdbEdit,bl=PG.bl,used=[...new Set(S.slots.map(s=>s.d))],imgs=[],cvs=[],ix={};
 for(const di of used){const d=S.ds[di],I=imgOfD(d);if(!d||!I)continue;const W=px(L.w+2*bl),H=px(L.h+2*bl),c=document.createElement('canvas');c.width=W;c.height=H;
  E.draw(c.getContext('2d'),W,H,{d,img:I,src:I.c,ox:bl*W/(L.w+2*bl),oy:bl*H/(L.h+2*bl),ppm:W/(L.w+2*bl),wMm:L.w,hMm:L.h,shape:L.shape,bl});
  ix[di]=imgs.length;imgs.push(await imgOf(c));cvs.push(c)}
 const pg={imgs,draws:L.slots.map((q,i)=>({i:ix[S.slots[i].d],x:q.x-bl,y:q.y-bl,w:q.w+2*bl,h:q.h+2*bl})).filter(d=>d.i!=null),cuts:S.cut?L.slots.map(q=>({c:L.shape==='c',x:q.x,y:q.y,w:q.w,h:q.h})):[],cal:calGet()};
 E.freeKey();return{pg,cvs}}
let pBusy=0;
ACT.edbPrint=async el=>{if(pBusy||!S.img)return;pBusy=1;if(el)el.disabled=true;toast('מכין להדפסה…');let cvs=[];
 try{const r=await build();cvs=r.cvs;const pdf=mkPdf(r.pg);API.last={pg:r.pg,size:pdf.length};const pid=S.pid;
  doneMsg(await go({pdf,name:'edible',title:'דף אכיל',pages:async()=>[await pageBlob(r.pg,cvs)],onSent:()=>{if(S.pid===pid&&S.img){S.pr=1;save()}}}))}
 catch(e){toast('ההדפסה נכשלה: '+(e&&e.message||e))}finally{cvs.forEach(freeCv);pBusy=0;if(el)el.disabled=false}};
// דף כיול: קו אופקי וקו אנכי של 100 מ"מ עם שנתות כל 10 מ"מ, וצלב 20 מ"מ מהקצה השמאלי והעליון. בלי כיול (גולמי)
function calPage(){const lines=[],H=[55,60],Vx=30,V0=80;lines.push([H[0],H[1],H[0]+100,H[1],0.3]);for(let i=0;i<=10;i++)lines.push([H[0]+i*10,H[1]-(i%5?2:4),H[0]+i*10,H[1],0.2]);
 lines.push([Vx,V0,Vx,V0+100,0.3]);for(let i=0;i<=10;i++)lines.push([Vx,V0+i*10,Vx+(i%5?2:4),V0+i*10,0.2]);
 lines.push([15,20,25,20,0.2],[20,15,20,25,0.2]);return{lines,cal:CAL0}}
function calTxt(){const W=px(120),Hh=px(70),c=document.createElement('canvas');c.width=W;c.height=Hh;const g=c.getContext('2d'),k=W/120;g.fillStyle='#fff';g.fillRect(0,0,W,Hh);g.fillStyle='#000';g.direction='rtl';g.textAlign='right';
 const F='Rubik,"IBM Plex Sans Hebrew",Assistant,Arial,sans-serif';g.font=`700 ${5*k}px ${F}`;g.fillText('דף כיול – הדפסת דף אכיל',W-2*k,8*k);g.font=`${3.6*k}px ${F}`;
 ['1. מדדו בסרגל את הקו האופקי ואת הקו האנכי (אמורים להיות 100 מ"מ).','2. מדדו את מרכז הצלב: מהקצה השמאלי ומהקצה העליון של הדף (20 מ"מ).','3. הקלידו את המידות באפליקציה ושמרו.','בחלון ההדפסה בחרו גודל 100%.'].forEach((t,i)=>g.fillText(t,W-2*k,(18+i*9)*k));return c}
ACT.edbCal=async el=>{if(pBusy)return;pBusy=1;if(el)el.disabled=true;let c=null;
 try{c=calTxt();const pg=Object.assign(calPage(),{imgs:[await imgOf(c)],draws:[{i:0,x:80,y:80,w:120,h:70}]});
  const how=await go({pdf:mkPdf(pg),name:'edible-calibration',title:'דף כיול',pages:async()=>[await pageBlob(pg,[c])]});if(how==='helper'||how==='native'||how==='web')toast('דף הכיול נשלח להדפסה')}
 catch(e){toast('ההדפסה נכשלה: '+(e&&e.message||e))}finally{freeCv(c);pBusy=0;if(el)el.disabled=false}};
FRM.edbCal=f=>{const v=n=>{const x=f.querySelector('[name='+n+']');return x?x.value.trim():''},o=calGet(),h=v('h'),vv=v('v'),dl=v('dl'),dt=v('dt');
 if(!h&&!vv&&!dl&&!dt){toast('לא הוקלדו מידות');return}const n=calFrom(h||100,vv||100,dl,dt);
 calSet({sx:h?n.sx:o.sx,sy:vv?n.sy:o.sy,ox:dl?n.ox:o.ox,oy:dt?n.oy:o.oy});toast('הכיול נשמר');redraw()};
ACT.edbCal0=()=>{calSet(CAL0);toast('הכיול אופס');redraw()};
// הגדרת התחנה (רק במכשיר הזה). שם ריק = L130; פורט – מספר בלבד
FRM.edbPrn=f=>{const X=St();if(!X)return;const q=n=>f.querySelector('[name='+n+']')||{},on=!!q('on').checked,n=String(q('name').value||'').trim().slice(0,80)||X.DEF.name,p=X.DEF.port; // פורט קבוע (CSP)
 X.setCfg({on,name:n,port:p});toast(on?'נשמר – המחשב הזה הוא תחנת ההדפסה':'נשמר – המחשב הזה אינו תחנת הדפסה');redraw()};
ACT.edbHlp=async()=>{const X=St(),o=document.getElementById('edbHlpR');if(!X||!o)return;o.textContent='בודק…';const c=X.cfg(),r=await X.hStatus(c),e=document.getElementById('edbHlpR');if(!e)return;
 if(!r.ok){e.textContent='עוזר ההדפסה לא עונה בכתובת http://127.0.0.1:'+c.port+' – בודקים שהוא הופעל במחשב הזה (edb-helper.bat).';return}
 const P=Array.isArray(r.j.printers)?r.j.printers:[];
 e.innerHTML=`<b>העוזר עונה.</b> ${r.j.chosen?'מדפסת: <span dir="ltr">'+esc(r.j.chosen)+'</span>':'<b style="color:#e0483e">לא נמצאה מדפסת שמכילה "'+esc(c.name)+'"</b>'} · הגדרות איכות שמורות: ${r.j.saved?'כן':'לא (להריץ edb-helper-setup.bat)'}${P.length?'<br>מדפסות במחשב: <span dir="ltr">'+P.map(esc).join(' · ')+'</span>':''}`};

/* =================== סבב 5: "להמשיך את העבודה הקודמת?" =================== */
// בכניסה למסך: אם הפרויקט האחרון במכשיר (של המשתמש הזה) לא הודפס – פס למטה ל-10 שניות. לחיצה = פתיחה בצעד 2. אחרי 10 שניות הפס נעלם (הפרויקט נשאר ב"פרויקטים")
let RB=null;
const rbOff=()=>{if(RB){clearInterval(RB.t);try{RB.e.remove()}catch(e){}RB=null}};
const onEdb=()=>{try{return cur().v==='edb'}catch(e){return false}};
async function resumeAsk(id){let r=null;try{r=await dbGet('proj',id)}catch(e){return}
 if(!mineP(r)){lsSet('');return}if(r.pr===1||S.img||S.alb||S.busy||!onEdb())return;
 rbOff();const e=document.createElement('div');e.id='edbRb';e.setAttribute('role','status');e.dir='rtl';
 e.style.cssText='position:fixed;left:50%;transform:translateX(-50%);bottom:calc(env(safe-area-inset-bottom,0px) + 12px);z-index:2147482000;width:min(560px,94vw);box-sizing:border-box;background:var(--card,#222);color:var(--ink,#fff);border:2px solid var(--acc,#e7b84d);border-radius:14px;box-shadow:0 6px 24px #000a;padding:10px 12px;display:flex;gap:8px;align-items:center';
 let n=10;const paint=()=>{e.innerHTML=`<div style="flex:1;min-width:0"><b style="display:block">להמשיך את העבודה הקודמת?</b><small class="note" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.name||'פרויקט')}</small></div><button class="btn" data-a="edbResume" data-v="${esc(id)}" style="flex:none;min-height:44px;width:auto;padding:0 14px">המשך <small style="opacity:.8">(${n})</small></button><button class="btn g" data-a="edbRbX" aria-label="סגירה" style="flex:none;min-height:44px;min-width:44px;width:auto;padding:0 10px">✕</button>`};
 paint();document.body.appendChild(e);RB={e,t:setInterval(()=>{n--;if(n<=0||!onEdb()||S.img||S.alb){rbOff();return}paint()},1000)}}
ACT.edbResume=el=>{const id=el&&el.dataset.v;rbOff();if(id)openProj(id)};
ACT.edbRbX=()=>rbOff();

/* =================== סבב 5: אלבום דפים מוכנים (בענן, משותף לכל המכשירים בעסק) ===================
   Firestore edba/{id}: nm, k, by, at, w, h, st ('up' → 'ok'). Storage: edb_album/{id}/page.png (העמוד המוכן, PNG 300 DPI, בלי כיול) + thumb.jpg (עד 300KB).
   בעסק b – תחת b/{bizId}/. ברשימה נטענות רק התמונות הממוזערות, ורק כשהן נראות; הדף המלא יורד רק בהדפסה / פתיחה לעריכה.
   יצירה – מנהל ועובד עם edb; שינוי שם – היוצר או מנהל; מחיקה – מנהל בלבד (גם בחוקים) */
const AL={L:null,t:0,q:'',th:new Map(),io:null,qn:0,wait:[]};
const albF=(id,f)=>(typeof bzB==='function'&&bzB()?'b/'+SY.bizId+'/':'')+'edb_album/'+id+'/'+f;
const albRid=()=>{const a='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',b=new Uint8Array(20);crypto.getRandomValues(b);return Array.from(b,x=>a[x%62]).join('')};
const fldA=o=>{const f={};for(const k in o){const v=o[k];f[k]=typeof v==='number'?{integerValue:String(Math.round(v))}:{stringValue:String(v)}}return f};
const albDt=t=>{try{return t?new Date(t).toLocaleDateString('he-IL',{day:'2-digit',month:'2-digit',year:'2-digit'}):''}catch(e){return ''}};
const albOf=id=>(AL.L||[]).find(x=>x.id===id)||(S.alb&&S.alb.id===id?S.alb:null);
async function albLoad(force){if(!force&&AL.L&&Date.now()-AL.t<60000)return AL.L;
 const r=await fsx(':runQuery',{method:'POST',body:JSON.stringify({structuredQuery:{from:[{collectionId:'edba'}],orderBy:[{field:{fieldPath:'at'},direction:'DESCENDING'}],limit:300}})});
 AL.L=(r||[]).filter(x=>x&&x.document).map(x=>albNorm(Object.assign({},Object.fromEntries(Object.entries(x.document.fields||{}).map(([k,v])=>[k,fvj(v)])),{id:idOf(x.document)}))).filter(Boolean);AL.t=Date.now();return AL.L}
// קובץ מהאלבום (Storage, עם ההרשאה של המשתמש). 403/404 – הדף נמחק או שאין הרשאה
async function albGet(id,f){let r;try{r=await fetch(STB()+'/'+encodeURIComponent(albF(id,f))+'?alt=media',{headers:{Authorization:'Firebase '+await tok()}})}catch(e){throw new Error('אין חיבור לאינטרנט')}
 if(!r.ok)throw new Error(r.status===403||r.status===404?'הדף לא נמצא באלבום (אולי נמחק)':'ההורדה נכשלה ('+r.status+')');return r.blob()}
// תמונה ממוזערת: עד 4 הורדות במקביל, נשמרת בזיכרון עד היציאה מהמסך
function albTh(id){if(AL.th.has(id))return Promise.resolve(AL.th.get(id));
 return new Promise(res=>{const run=async()=>{AL.qn++;let u='';try{u=URL.createObjectURL(await albGet(id,'thumb.jpg'));AL.th.set(id,u)}catch(e){}AL.qn--;const nx=AL.wait.shift();if(nx)nx();res(u)};if(AL.qn<4)run();else AL.wait.push(run)})}
const albThSet=im=>{if(!im||im.dataset.ld)return;const id=im.dataset.th,a=albOf(id);if(!a||a.st!=='ok')return;im.dataset.ld='1';albTh(id).then(u=>{if(u&&im.isConnected)im.src=u})};
const albThAll=()=>document.querySelectorAll('#edbW img[data-th],#dlg img[data-th]').forEach(im=>{if(!im.closest('#edbAlbG'))albThSet(im)});
function albFree(){try{if(AL.io)AL.io.disconnect()}catch(e){}AL.io=null;AL.th.forEach(u=>{try{URL.revokeObjectURL(u)}catch(e){}});AL.th.clear()}
// רשת הדפים: רק הנראים נטענים (IntersectionObserver); חיפוש לפי שם – הסתרה בלי ציור מחדש
const albCell=a=>`<button data-a="edbAlbOpen" data-v="${esc(a.id)}" data-n="${esc(albQ(a.nm))}" style="border:2px solid var(--line);border-radius:10px;background:var(--card);color:inherit;padding:4px;min-height:44px;font:inherit;text-align:center;min-width:0"><img data-th="${esc(a.id)}" alt="" style="width:100%;aspect-ratio:210/297;object-fit:contain;background:#fff;border-radius:4px;display:block"><small style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:3px">${esc(a.nm)}</small>${a.st!=='ok'?'<small style="display:block;color:#e0483e">השמירה לא הושלמה</small>':''}</button>`;
function albFilter(){const g=document.getElementById('edbAlbG'),q=albQ(AL.q);if(!g)return;let n=0;g.querySelectorAll('[data-n]').forEach(b=>{const v=!q||b.dataset.n.includes(q);b.style.display=v?'':'none';if(v)n++});const e=document.getElementById('edbAlbE');if(e)e.textContent=n?'':q?'לא נמצאו דפים בשם הזה':'אין עדיין דפים באלבום. שומרים דף בצעד 3 (הדפסה) – "שמור לאלבום".'}
async function albDlg(){const H3='<h3>אלבום דפים מוכנים</h3>';dlg(H3+'<p class="note">טוען…</p>');let L;
 try{L=await albLoad(true)}catch(e){dlg(H3+`<p class="note">${e&&e.offline?'אין חיבור לאינטרנט – האלבום נמצא בענן.':'האלבום לא נטען.'}</p><button class="btn g w" data-a="closeDlg">סגירה</button>`);return}
 const V=L.filter(a=>a.st==='ok'||mgr());
 dlg(H3+`<p class="note" style="margin:0 0 6px">משותף לכל הטלפונים והמחשבים בעסק. לחיצה על דף – הדפסה מיד או פתיחה לעריכה.</p>
<input type="search" data-i="edbAlbQ" placeholder="חיפוש לפי שם" aria-label="חיפוש לפי שם" value="${esc(AL.q)}" style="width:100%;min-height:44px;margin-bottom:8px;box-sizing:border-box">
<div id="edbAlbG" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;max-height:56vh;overflow:auto">${V.map(albCell).join('')}</div><p class="note" id="edbAlbE" style="margin:6px 0 0"></p>
<button class="btn g w" data-a="closeDlg" style="margin-top:8px">סגירה</button>`);
 albFilter();const g=document.getElementById('edbAlbG');if(!g)return;try{if(AL.io)AL.io.disconnect()}catch(e){}
 if(typeof IntersectionObserver==='function'){AL.io=new IntersectionObserver(es=>es.forEach(x=>{if(x.isIntersecting){AL.io.unobserve(x.target);albThSet(x.target)}}),{root:g,rootMargin:'200px 0px'});g.querySelectorAll('img[data-th]').forEach(im=>AL.io.observe(im))}
 else g.querySelectorAll('img[data-th]').forEach(albThSet)}
ACT.edbAlb=()=>{albDlg()};
INP.edbAlbQ=el=>{AL.q=String(el.value||'').slice(0,60);albFilter()};
// תצוגה מקדימה: הדפסה מיד / פתיחה לעריכה; שינוי שם – היוצר או מנהל; מחיקה – מנהל
ACT.edbAlbOpen=el=>{const a=albOf(el&&el.dataset.v);if(!a)return;const M=mgr(),me=a.by===(SY&&SY.uid);
 dlg(`<h3 style="overflow-wrap:anywhere">${esc(a.nm)}</h3><div style="text-align:center"><img data-th="${esc(a.id)}" alt="" style="width:min(62vw,240px);aspect-ratio:210/297;object-fit:contain;background:#fff;border-radius:6px;box-shadow:0 1px 6px #0008"></div><p class="note" style="text-align:center;margin:6px 0 10px">${esc(albLay(a))}${a.at?' · נשמר '+esc(albDt(a.at)):''}</p>
${a.st==='ok'?`<div style="display:flex;flex-direction:column;gap:8px"><button class="btn w" data-a="edbAlbGo" data-v="${esc(a.id)}">הדפס עכשיו</button><button class="btn g w" data-a="edbAlbEdit" data-v="${esc(a.id)}">פתח לעריכה</button></div>`:'<p class="note" style="color:#e0483e">השמירה של הדף הזה לא הושלמה (הקבצים לא עלו). אפשר למחוק אותו.</p>'}
${(M||me)&&a.st==='ok'||M?`<div style="display:flex;gap:8px;margin-top:8px">${(M||me)&&a.st==='ok'?`<button class="btn g w" data-a="edbAlbRen" data-v="${esc(a.id)}">שינוי שם</button>`:''}${M?`<button class="btn r w" data-a="edbAlbDel" data-v="${esc(a.id)}">מחיקה</button>`:''}</div>`:''}<button class="btn g w" data-a="edbAlb" style="margin-top:8px">חזרה לאלבום</button>`);
 albThSet(document.querySelector('#dlg img[data-th]'))};
// "הדפס עכשיו" – צעד ההדפסה עם הדף מהאלבום (העבודה הפתוחה נשמרת קודם)
ACT.edbAlbGo=async el=>{const a=albOf(el&&el.dataset.v);if(!a||a.st!=='ok'||S.busy)return;closeDlg();try{if(S.pid&&S.img){commit();await save()}}catch(e){}
 if(root.EdbEdit)root.EdbEdit.unmount();S.alb=Object.assign({},a);S.st=3;S.stnF=1;rbOff();rerender()};
ACT.edbAlbPrint=async el=>{const a=S.alb;if(pBusy||!a)return;pBusy=1;if(el)el.disabled=true;toast('מכין להדפסה…');
 try{const cal=calGet(),raw=calId(cal),blob=async()=>a.blob||(a.blob=await albGet(a.id,'page.png'));
  // כיול לא ברירת מחדל – הדף מצויר מחדש עם הכיול של המכשיר הזה (ולתחנה – מועלה כמו עבודה רגילה, כי הכיול שייך לשולח)
  const pages=async()=>{const b=await blob();if(raw)return[b];const im=await loadImg(b);try{return[await pageBlob({draws:[{i:0,x:0,y:0,w:PG.w,h:PG.h}],cal},[im])]}finally{im.src=''}};
  const pdfF=async()=>{const im=await loadImg(await blob()),c=document.createElement('canvas');try{c.width=im.naturalWidth;c.height=im.naturalHeight;const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);g.drawImage(im,0,0);return mkPdf({imgs:[await imgOf(c)],draws:[{i:0,x:0,y:0,w:PG.w,h:PG.h}],cal})}finally{im.src='';freeCv(c)}};
  doneMsg(await go({alb:raw?a.id:'',pdfF,pages,name:'edible',title:a.nm}))}
 catch(e){toast('ההדפסה נכשלה: '+(e&&e.message||e))}finally{pBusy=0;if(el)el.disabled=false}};
// "פתח לעריכה": הדף נטען כתמונה אחת בפריסת "A4 מלא" (רק החלק שבתוך השוליים), כפרויקט חדש במכשיר. קווי החיתוך כבויים – הם כבר בתמונה
ACT.edbAlbEdit=async el=>{const a=albOf(el&&el.dataset.v);if(!a||a.st!=='ok'||S.busy)return;closeDlg();S.busy=1;redraw();
 try{const b=a.blob||await albGet(a.id,'page.png'),im=await loadImg(b);let c=null;
  try{if(S.pid&&S.img){commit();await save()}resetWork();const r=albCrop(im.naturalWidth,im.naturalHeight);c=document.createElement('canvas');c.width=r.w;c.height=r.h;const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,r.w,r.h);g.drawImage(im,r.x,r.y,r.w,r.h,0,0,r.w,r.h);
   S.k='full';S.L=null;S.cut=false;setImg(c,r.w,r.h,a.nm,null);S.pname=a.nm}finally{im.src='';freeCv(c)}
  S.st=2;S.busy=0;rbOff();redraw();toast('הדף נפתח לעריכה (פרויקט חדש במכשיר)')}
 catch(e){S.busy=0;toast(e&&e.message||'הדף לא נפתח');redraw()}};
ACT.edbAlbRen=el=>{const a=albOf(el&&el.dataset.v);if(!a)return;dlg(`<h3>שינוי שם</h3><form data-f="edbAlbRen"><input type="hidden" name="id" value="${esc(a.id)}"><label class="f" style="display:block"><span>שם הדף</span><input name="n" maxlength="60" required value="${esc(a.nm)}" style="width:100%;min-height:44px;box-sizing:border-box"></label><div style="display:flex;gap:8px;margin-top:8px"><button class="btn w" type="submit">שמירה</button><button class="btn g w" type="button" data-a="edbAlbOpen" data-v="${esc(a.id)}">ביטול</button></div></form>`)};
FRM.edbAlbRen=async f=>{const id=(f.querySelector('[name=id]')||{}).value,n=String((f.querySelector('[name=n]')||{}).value||'').trim().slice(0,60),a=albOf(id);if(!a)return;if(!n){toast('הקלידו שם');return}
 try{await fsx('/edba/'+id+'?updateMask.fieldPaths=nm&currentDocument.exists=true',{method:'PATCH',body:JSON.stringify({fields:fldA({nm:n})})});a.nm=n;if(S.alb&&S.alb.id===id){S.alb.nm=n;redraw()}toast('השם עודכן');ACT.edbAlbOpen({dataset:{v:id}})}
 catch(e){toast(e&&e.code===403?'אין הרשאה לשנות את השם':'שינוי השם נכשל')}};
ACT.edbAlbDel=el=>{const a=albOf(el&&el.dataset.v);if(!a||!mgr())return;dlg(`<h3>מחיקה מהאלבום</h3><p>למחוק את "${esc(a.nm)}"? הדף יימחק מהאלבום בכל הטלפונים והמחשבים בעסק, ואי אפשר לשחזר אותו.</p><div style="display:flex;gap:8px"><button class="btn r w" data-a="edbAlbDel2" data-v="${esc(a.id)}">מחיקה</button><button class="btn g w" data-a="edbAlbOpen" data-v="${esc(a.id)}">ביטול</button></div>`)};
ACT.edbAlbDel2=async el=>{const id=el&&el.dataset.v;if(!id||!mgr())return;
 try{const t=await tok();for(const f of ['page.png','thumb.jpg']){const r=await fetch(STB()+'/'+encodeURIComponent(albF(id,f)),{method:'DELETE',headers:{Authorization:'Firebase '+t}});if(!r.ok&&r.status!==404)throw new Error('del '+r.status)}
  await fsx('/edba/'+id,{method:'DELETE'});AL.L=(AL.L||[]).filter(x=>x.id!==id);const u=AL.th.get(id);if(u){URL.revokeObjectURL(u);AL.th.delete(id)}if(S.alb&&S.alb.id===id){S.alb=null;S.st=1;redraw()}toast('נמחק מהאלבום');albDlg()}
 catch(e){toast('המחיקה נכשלה')}};
// "שמור לאלבום" (צעד 3): הדף כמו שהוא עכשיו – PNG בגודל A4 ב-300 DPI, בלי כיול (הכיול מוחל בכל מכשיר בהדפסה), ותמונה ממוזערת
ACT.edbAlbSave=()=>{if(!S.img)return;dlg(`<h3>שמירה לאלבום</h3><p class="note">הדף נשמר בענן של העסק כמו שהוא עכשיו${S.cut?' (עם קווי החיתוך)':''}. כל הטלפונים והמחשבים בעסק יוכלו להדפיס אותו מיד. התמונות המקוריות לא עולות לענן – רק הדף המוכן.</p><form data-f="edbAlbSave"><label class="f" style="display:block"><span>שם הדף</span><input name="n" maxlength="60" required value="${esc(S.pname||'')}" style="width:100%;min-height:44px;box-sizing:border-box"></label><div style="display:flex;gap:8px;margin-top:8px"><button class="btn w" type="submit">שמירה</button><button class="btn g w" type="button" data-a="closeDlg">ביטול</button></div></form>`)};
FRM.edbAlbSave=async f=>{const n=String((f.querySelector('[name=n]')||{}).value||'').trim().slice(0,60);if(!n){toast('הקלידו שם');return}closeDlg();albSave(n)};
const stUp=async(path,b,ct)=>{let r;try{r=await fetch(STB()+'?uploadType=media&name='+encodeURIComponent(path),{method:'POST',headers:{Authorization:'Firebase '+await tok(),'Content-Type':ct},body:b})}catch(e){throw new Error('אין חיבור לאינטרנט')}if(!r.ok)throw new Error(r.status===403?'אין הרשאה לשמור באלבום':'ההעלאה נכשלה ('+r.status+')')};
async function albThumb(page){const im=await loadImg(page),c=document.createElement('canvas');try{c.width=300;c.height=424;const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,300,424);g.imageSmoothingQuality='high';g.drawImage(im,0,0,300,424);
 for(const q of [0.85,0.6,0.4]){const b=await new Promise(r=>c.toBlob(r,'image/jpeg',q));if(b&&b.size<=300*1024)return b}throw new Error('התמונה הממוזערת גדולה מדי')}finally{im.src='';freeCv(c)}}
async function albSave(nm){if(pBusy||!S.img)return;pBusy=1;toast('שומר לאלבום…');let cvs=[];
 try{const r=await build();cvs=r.cvs;const page=await pageBlob(Object.assign({},r.pg,{cal:CAL0}),cvs);cvs.forEach(freeCv);cvs=[];
  if(page.size>30*1024*1024)throw new Error('הדף גדול מדי לשמירה');const th=await albThumb(page),id=albRid();
  await fsx('/edba?documentId='+id,{method:'POST',body:JSON.stringify({fields:fldA({nm,k:S.k==='cu'?'cu':S.k,by:SY.uid,at:Date.now(),w:px(PG.w),h:px(PG.h),st:'up'})})});
  await stUp(albF(id,'page.png'),page,'image/png');await stUp(albF(id,'thumb.jpg'),th,'image/jpeg');
  await fsx('/edba/'+id+'?updateMask.fieldPaths=st&currentDocument.exists=true',{method:'PATCH',body:JSON.stringify({fields:fldA({st:'ok'})})});
  AL.t=0;toast('נשמר לאלבום: '+nm)}
 catch(e){toast('השמירה לאלבום נכשלה: '+(e&&e.offline?'אין חיבור לאינטרנט':e&&e.message||e))}
 finally{cvs.forEach(freeCv);pBusy=0}}
// ביציאה מהמסך – משחררים את התמונה ואת קובץ ה-PDF (זיכרון). בדיקה כל 2 שניות כשיש תמונה
setInterval(()=>{if(S.img&&S.ow&&S.ow!==own()){resetWork();S.rst=0;return} // משתמש / עסק אחר במכשיר – לא שומרים בשמו ולא משאירים בזיכרון
 if(onEdb())return;if(RB)rbOff();if(AL.th.size)albFree(); // סבב 5: יציאה מהמסך – הפס נעלם, התמונות הממוזערות של האלבום משתחררות
 if(!S.img&&!S.pdf&&!S.alb){S.rst=0;return} // הכניסה הבאה – שוב מצעד 1, עם השאלה על העבודה הקודמת
 commit();save();resetWork();S.rst=0},2000); // יציאה מהמסך: שמירה אוטומטית (הפרמטרים והתמונות נשמרים במכשיר) ואז שחרור הזיכרון; בכניסה הבאה העבודה נפתחת מחדש
try{document.addEventListener('visibilitychange',()=>{if(document.hidden&&S.pid&&S.img){commit();save()}})}catch(e){}
root.EdbPrint={S,AL,pvSoon,pvDraw,send,go,build,pageImg,pageBlob,calGet,setImg,ok,redraw,lay,mark,imgOfD,cd:curD,ci:()=>imgOfD(curD()),commit,save,hstep,openProj,albLoad};
})(typeof window!=='undefined'?window:globalThis);
