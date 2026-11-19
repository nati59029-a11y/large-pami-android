/* POS:M6 – קופה, מודול ש6: ברקודים (pos-barcode.js). נמסר ראשון – מודול ש3 (קטלוג וחיפוש) ומסך המכירה (ש1) תלויים בו.
   קובץ זהה בשרת: firebase/functions/lib/pos-barcode.js (בדיקה אוטומטית שהשניים זהים – pos-barcode.unit.test.js).
   ממשק (window.PosBarcode, ובשרת require):
     clean(s)                → מחרוזת נקייה (בלי רווחים ותווי בקרה) או ''
     check(code)             → { ok, why? } – ספרת ביקורת רק לאורך 8/12/13 ספרות (EAN-8, UPC-A, EAN-13; B1). אורך אחר: 3–30 תווים, בלי בדיקה
     ckDigit(body)           → ספרת הביקורת (GS1 mod 10) לרצף ספרות
     internal(prefix, n)     → ברקוד פנימי EAN-13 תקין: קידומת (bc.intPrefix, ברירת מחדל '200') + מספר רץ + ספרת ביקורת (B2)
     kind(code, cfg)         → 'gift' | 'cpn' | 'rcpt' | 'int' | 'prod' לפי קידומת (B9). **מוצר קיים קודם**: הקורא בודק קודם באינדקס המוצרים,
                               ורק ברקוד שלא נמצא נבדק לפי קידומת (ספרים, 978/979, מתחילים ב-97 כמו קבלה – לכן לא מסווגים לפני חיפוש מוצר).
     clash(codes, cfg)       → ברקודים (למשל מייבוא כספיט) שמתחילים בקידומות השמורות – כדי להחליט על הקידומות לפני העלייה לאוויר (4.3 א-11)
     partial(q, list, min)   → חיפוש לפי סוף הברקוד: רק מ-min ספרות (bc.partialMin, ברירת מחדל 4; B6). list = [{ id, codes:[…] }]
     weight(code, wbc)       → ברקוד משקל/מחיר { plu, val } – רק כשהמודול weight דלוק (כבוי בעסק הנוכחי)
     bars(code)              → פסי EAN-13/EAN-8 כמחרוזת '1'/'0' (למדבקות, pos-labels.js)
     listen(onScan, opt)     → האזנה לסורק במצב מקלדת (B3): תווים מהירים שמסתיימים ב-Enter/Tab. מחזיר פונקציית עצירה.
                               opt: { minLen:3, gap:50 (מ"ש בין תווים), inInputs:false, beep:true }
     beep(ok)                → צליל קצר: הצלחה / שגיאה (bc.beep) */
(function(root){
'use strict';
const PFX={gift:'98',cpn:'99',rcpt:'97'};
const INT0='200';
function clean(s){if(s==null)return '';return String(s).replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩\s]/g,'').slice(0,40)}
const digits=s=>/^[0-9]+$/.test(s);
function ckDigit(body){body=String(body);let s=0;for(let i=0;i<body.length;i++){const d=+body[body.length-1-i];s+=i%2===0?d*3:d}return String((10-s%10)%10)}
function check(code){const c=clean(code);
 if(!c)return{ok:false,why:'empty'};
 if(!/^[0-9A-Za-z-]{3,30}$/.test(c))return{ok:false,why:'chars'};
 if(digits(c)&&[8,12,13].includes(c.length)){if(ckDigit(c.slice(0,-1))!==c.slice(-1))return{ok:false,why:'check'}}
 return{ok:true}}
function internal(prefix,n){const p=digits(String(prefix||''))&&String(prefix).length>=1&&String(prefix).length<=6?String(prefix):INT0;
 const w=12-p.length;if(!Number.isInteger(n)||n<1||String(n).length>w)throw new Error('pos-barcode: מספר רץ מחוץ לטווח');
 const body=p+String(n).padStart(w,'0');return body+ckDigit(body)}
function pfxOf(cfg){const b=cfg&&cfg.bc||cfg||{};return{p:Object.assign({},PFX,b.prefixes&&typeof b.prefixes==='object'?b.prefixes:{}),i:typeof b.intPrefix==='string'&&b.intPrefix?b.intPrefix:INT0}}
function kind(code,cfg){const c=clean(code),P=pfxOf(cfg);if(!c)return '';
 if(digits(c)&&c.length===13){for(const k of ['gift','cpn','rcpt'])if(P.p[k]&&c.startsWith(P.p[k]))return k;if(c.startsWith(P.i))return 'int'}
 return 'prod'}
function clash(codes,cfg){const P=pfxOf(cfg),out={gift:[],cpn:[],rcpt:[],int:[]};
 for(const x of codes||[]){const c=clean(x);if(!digits(c)||c.length!==13)continue;for(const k of ['gift','cpn','rcpt'])if(P.p[k]&&c.startsWith(P.p[k]))out[k].push(c);if(c.startsWith(P.i))out.int.push(c)}
 return out}
function partial(q,list,min){const s=clean(q);const m=Number.isInteger(min)&&min>0?min:4;if(s.length<m)return[];
 const out=[];for(const x of list||[]){if((x.codes||[]).some(c=>c&&String(c).endsWith(s)))out.push(x);if(out.length>=50)break}return out}
// ברקוד משקל/מחיר: wbc = { prefix:'2', mode:'w'|'p', plu:5 } → 2 + PLU (5) + ערך (5) + ספרת ביקורת. מחזיר null אם לא מתאים
function weight(code,wbc){const c=clean(code);if(!wbc||!wbc.prefix||!digits(c)||c.length!==13||!c.startsWith(wbc.prefix))return null;
 if(ckDigit(c.slice(0,12))!==c[12])return null;const pl=Number.isInteger(wbc.plu)?wbc.plu:5,st=wbc.prefix.length;
 const plu=c.slice(st,st+pl),v=+c.slice(st+pl,12);return{plu,val:wbc.mode==='p'?v:v,mode:wbc.mode==='p'?'p':'w'}}
// EAN-13 / EAN-8: קידוד L/G/R
const L=['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
const R=L.map(x=>x.split('').map(b=>b==='1'?'0':'1').join(''));
const G=R.map(x=>x.split('').reverse().join(''));
const PAR=['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL'];
function bars(code){const c=clean(code);
 if(digits(c)&&c.length===13&&check(c).ok){const p=PAR[+c[0]];let s='101';for(let i=1;i<=6;i++)s+=(p[i-1]==='L'?L:G)[+c[i]];s+='01010';for(let i=7;i<=12;i++)s+=R[+c[i]];return s+'101'}
 if(digits(c)&&c.length===8&&check(c).ok){let s='101';for(let i=0;i<4;i++)s+=L[+c[i]];s+='01010';for(let i=4;i<8;i++)s+=R[+c[i]];return s+'101'}
 return ''}
let AC=null;
function beep(ok){try{const W=root.AudioContext||root.webkitAudioContext;if(!W)return;AC=AC||new W();const o=AC.createOscillator(),g=AC.createGain();
 o.frequency.value=ok===false?300:1400;g.gain.value=.08;o.connect(g);g.connect(AC.destination);o.start();o.stop(AC.currentTime+(ok===false?.25:.07))}catch(e){}}
function listen(onScan,opt){opt=Object.assign({minLen:3,gap:50,inInputs:false,beep:true},opt||{});const doc=root.document;if(!doc||typeof onScan!=='function')return()=>{};
 let buf='',last=0,fast=0;
 const editable=t=>t&&(/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)||t.isContentEditable);
 const h=e=>{const t=e.target;if(editable(t)&&!opt.inInputs&&!(t.dataset&&t.dataset.posScan!==undefined))return;
  const now=Date.now();if(now-last>opt.gap){buf='';fast=0}last=now;
  if(e.key==='Enter'||e.key==='Tab'){const c=clean(buf);buf='';if(c.length>=opt.minLen&&fast>=c.length-1){e.preventDefault();if(opt.beep)beep(true);try{onScan(c)}catch(x){}}return}
  if(e.key&&e.key.length===1){if(buf)fast++;buf+=e.key}};
 doc.addEventListener('keydown',h,true);
 return()=>doc.removeEventListener('keydown',h,true)}
const API={PFX,INT0,clean,check,ckDigit,internal,kind,clash,partial,weight,bars,beep,listen};
root.PosBarcode=API;
if(typeof module!=='undefined'&&module.exports)module.exports=API;
})(typeof window!=='undefined'?window:globalThis);
