/* pos-hw-web.js – קופה במחשב (Windows, דפדפן Chrome), גל 3 (19.11.2026): "תוסף" JavaScript עם אותו ממשק כמו התוסף LpPos באנדרואיד.
   pos-hw.js משתמש בו רק כשאין תוסף מקורי (לא בתוך האפליקציה באנדרואיד) – שם ההתנהגות לא משתנה בכלל.
   window.LpPosWeb (web:true):
     isAvailable / addListener / listDevices / printerStatus / print / openDrawer / disconnect / displayInfo / displayShow / displayClear / requestSerial
   סוגי מדפסת:
     'win'    – הקבלה מצוירת כתמונה ונשלחת ל-window.print() מתוך iframe נסתר (@page ברוחב הנייר). מיועד ל-Chrome עם --kiosk-printing,
                שמדפיס בלי חלון למדפסת ברירת המחדל של Windows. המגירה נפתחת ע"י מנהל ההתקן ("פתח מגירה בתחילת מסמך").
                אין דרך לדעת שההדפסה באמת יצאה (הדפדפן לא מדווח) – התשובה היא {printed:true, via:'win'} = "נשלח למדפסת".
                openDrawer = פתק קצר "פתיחת מגירה" (תאריך, שעה, עובד) – החלטת בעל העסק 19.11; אחרי קבלה שהודפסה זה עתה (מזומן/החזר) – בלי פתק.
     'serial' – Web Serial (navigator.serial): ESC @, התמונה כ-GS v 0 בפסים, חיתוך GS V, מגירה ESC p (פין 2/5). openDrawer = פקודת מגירה בלי נייר.
                היציאה נבחרת פעם אחת (requestSerial, מלחיצה של המשתמש) ונזכרת ע"י הדפדפן (getPorts).
     'mock'   – בלי חומרה: רק ציור (לתצוגה).
   אין WebUSB (ב-Windows מנהל ההתקן תופס את המדפסת). מסך לקוח = חלון שני (window.open), במסך השני אם Window Management API זמין.
   ציור הקבלה = העתק של LpPosRender.java ל-canvas (עברית RTL, עמודות, קו, טקסט מוגדל/מודגש, תמונה, CODE128, QR) – בלי ספריות.
   אין כאן שום טיפול בכרטיסי אשראי. ב-Node: require(...)(root) – לבדיקות (tools/pos-hw-test/pos-hw-web.test.js). */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory;else root.LpPosWeb=factory(root)})(typeof self!=='undefined'?self:this,function(root){
'use strict';
const BAUDS=[9600,19200,38400,115200],MAX_H=12000,BASE=24,BAND=128,DRAWER_SKIP_MS=30000;
function err(code,m){const e=new Error(m);e.code=code;return e}
const L={};
function addListener(n,cb){(L[n]=L[n]||[]).push(cb);return{remove(){L[n]=(L[n]||[]).filter(f=>f!==cb)}}}
function emit(n,d){(L[n]||[]).slice().forEach(f=>{try{f(d)}catch(e){}})}

/* ---------- ESC/POS (כמו LpPosEscPos.java) ---------- */
const ESC=0x1B,GS=0x1D;
const init=()=>[ESC,0x40];
const feed=n=>[ESC,0x64,Math.max(0,Math.min(255,n|0))];
const cut=d=>[GS,0x56,66,Math.max(0,Math.min(255,d|0))];
function drawer(pin,onMs,offMs){const t1=Math.max(1,Math.min(255,(onMs/2)|0));let t2=Math.max(1,Math.min(255,(offMs/2)|0));if(t2<t1)t2=t1;return[ESC,0x70,pin===5?1:0,t1,t2]}
const rowBytes=w=>(w+7)>>3;
/* luma: 0 שחור .. 255 לבן, שורה אחרי שורה -> ביט לנקודה (1 = הדפסה), MSB ראשון */
function toBits(luma,w,h,dither,thr){thr=thr||128;if(!(w>0&&h>0)||!luma||luma.length<w*h)throw new Error('bad image size');
 const rb=rowBytes(w),out=new Uint8Array(rb*h);
 if(!dither){for(let y=0;y<h;y++){const o=y*rb,i=y*w;for(let x=0;x<w;x++)if(luma[i+x]<thr)out[o+(x>>3)]|=0x80>>(x&7)}return out}
 let cur=new Int32Array(w+2),nxt=new Int32Array(w+2);
 for(let y=0;y<h;y++){const o=y*rb,i=y*w;for(let x=0;x<w;x++){const v=Math.max(0,Math.min(255,luma[i+x]))+cur[x+1],nv=v<thr?0:255;if(!nv)out[o+(x>>3)]|=0x80>>(x&7);
   const e=v-nv;cur[x+2]+=(e*7/16)|0;nxt[x]+=(e*3/16)|0;nxt[x+1]+=(e*5/16)|0;nxt[x+2]+=(e/16)|0}const t=cur;cur=nxt;nxt=t;nxt.fill(0)}
 return out}
function raster(bits,w,h,band){const rb=rowBytes(w);if(bits.length<rb*h)throw new Error('bits too short');band=band>0?band:BAND;const o=[];
 for(let y=0;y<h;y+=band){const n=Math.min(band,h-y);o.push(GS,0x76,0x30,0,rb&255,(rb>>8)&255,n&255,(n>>8)&255);for(let k=y*rb;k<(y+n)*rb;k++)o.push(bits[k])}
 return o}
/* עבודה שלמה: אתחול, תמונה, הזנה, חיתוך (לא חובה), מגירה (לא חובה, בסוף) */
function job(luma,w,h,o){o=o||{};const out=init();
 if(luma&&h>0){const r=raster(toBits(luma,w,h,!!o.dither,128),w,h,BAND);for(let i=0;i<r.length;i++)out.push(r[i])}
 out.push(...feed(o.cut?3:4));if(o.cut)out.push(...cut(0));if(o.drawer)out.push(...drawer(o.pin===5?5:2,100,200));
 return Uint8Array.from(out)}

/* ---------- CODE128 (סט B, בלי ספרייה) ---------- */
const C128='212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112'.split(' ');
/* -> מערך מודולים (true = פס). null אם יש תו שאינו ASCII מודפס */
function code128(s){s=String(s||'');if(!s||!/^[\x20-\x7E]+$/.test(s))return null;
 const v=[104];for(let i=0;i<s.length;i++)v.push(s.charCodeAt(i)-32);let sum=104;for(let i=1;i<v.length;i++)sum+=v[i]*i;v.push(sum%103,106);
 const m=[];for(const c of v){const p=C128[c];for(let i=0;i<p.length;i++)for(let k=0;k<+p[i];k++)m.push(i%2===0)}return m}

/* ---------- QR (מצב בתים, תיקון שגיאות M, מסכה 0 – קוד תקני; לפי האלגוריתם של Project Nayuki, MIT) ---------- */
const QECC=[-1,10,16,26,18,24,16,18,22,22,26,30,22,22,24,24,28,28,26,26,26,26,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28];
const QBLK=[-1,1,1,1,2,2,4,4,4,5,5,5,8,9,9,10,10,11,13,14,16,17,17,18,20,21,23,25,26,28,29,31,33,35,37,38,40,43,45,47,49];
function rawMods(v){let r=(16*v+128)*v+64;if(v>=2){const n=Math.floor(v/7)+2;r-=(25*n-10)*n-55;if(v>=7)r-=36}return r}
const dataCw=v=>Math.floor(rawMods(v)/8)-QECC[v]*QBLK[v];
function gmul(x,y){let z=0;for(let i=7;i>=0;i--){z=(z<<1)^((z>>>7)*0x11D);z^=((y>>>i)&1)*x}return z&255}
function rsDiv(d){const r=new Array(d-1).fill(0);r.push(1);let root=1;for(let i=0;i<d;i++){for(let j=0;j<r.length;j++){r[j]=gmul(r[j],root);if(j+1<r.length)r[j]^=r[j+1]}root=gmul(root,2)}return r}
function rsRem(data,div){const r=div.map(()=>0);for(const b of data){const f=b^r.shift();r.push(0);div.forEach((c,i)=>{r[i]^=gmul(c,f)})}return r}
function utf8(s){if(typeof TextEncoder!=='undefined')return Array.from(new TextEncoder().encode(s));return Array.from(Buffer.from(s,'utf8'))}
function alignPos(v,size){if(v===1)return[];const n=Math.floor(v/7)+2,step=v===32?26:Math.ceil((v*4+4)/(n*2-2))*2,r=[6];for(let p=size-7;r.length<n;p-=step)r.splice(1,0,p);return r}
/* -> {size, get(x,y)} או null אם המידע ארוך מדי */
function qr(text){const bytes=utf8(String(text||''));let v=1;
 for(;v<=40;v++){const cc=v<10?8:16;if(4+cc+bytes.length*8<=dataCw(v)*8)break}if(v>40)return null;
 const cap=dataCw(v)*8,bits=[];const put=(val,n)=>{for(let i=n-1;i>=0;i--)bits.push((val>>>i)&1)};
 put(4,4);put(bytes.length,v<10?8:16);bytes.forEach(b=>put(b,8));put(0,Math.min(4,cap-bits.length));put(0,(8-bits.length%8)%8);
 for(let p=0xEC;bits.length<cap;p^=0xEC^0x11)put(p,8);
 const data=[];for(let i=0;i<bits.length;i+=8){let b=0;for(let k=0;k<8;k++)b=(b<<1)|bits[i+k];data.push(b)}
 /* תיקון שגיאות ושזירה */
 const nb=QBLK[v],ecl=QECC[v],raw=Math.floor(rawMods(v)/8),nShort=nb-raw%nb,shortLen=Math.floor(raw/nb),div=rsDiv(ecl),blocks=[];
 for(let i=0,k=0;i<nb;i++){const dat=data.slice(k,k+shortLen-ecl+(i<nShort?0:1));k+=dat.length;const e=rsRem(dat,div);if(i<nShort)dat.push(0);blocks.push(dat.concat(e))}
 const cw=[];for(let i=0;i<blocks[0].length;i++)for(let j=0;j<nb;j++)if(i!==shortLen-ecl||j>=nShort)cw.push(blocks[j][i]);
 /* מטריצה */
 const size=v*4+17,M=[],F=[];for(let y=0;y<size;y++){M.push(new Array(size).fill(false));F.push(new Array(size).fill(false))}
 const set=(x,y,d)=>{M[y][x]=!!d;F[y][x]=true};
 for(let i=0;i<size;i++){set(6,i,i%2===0);set(i,6,i%2===0)}
 for(const [cx,cy] of [[3,3],[size-4,3],[3,size-4]])for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){const x=cx+dx,y=cy+dy,d=Math.max(Math.abs(dx),Math.abs(dy));if(x>=0&&x<size&&y>=0&&y<size)set(x,y,d!==2&&d!==4)}
 const ap=alignPos(v,size),na=ap.length;
 for(let i=0;i<na;i++)for(let j=0;j<na;j++){if((i===0&&j===0)||(i===0&&j===na-1)||(i===na-1&&j===0))continue;for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)set(ap[i]+dx,ap[j]+dy,Math.max(Math.abs(dx),Math.abs(dy))!==1)}
 const fmt=()=>{const d=(0<<3)|0;let r=d;for(let i=0;i<10;i++)r=(r<<1)^((r>>>9)*0x537);const b=((d<<10)|r)^0x5412,g=i=>(b>>>i)&1;
  for(let i=0;i<=5;i++)set(8,i,g(i));set(8,7,g(6));set(8,8,g(7));set(7,8,g(8));for(let i=9;i<15;i++)set(14-i,8,g(i));
  for(let i=0;i<8;i++)set(size-1-i,8,g(i));for(let i=8;i<15;i++)set(8,size-15+i,g(i));set(8,size-8,true)};
 fmt();
 if(v>=7){let r=v;for(let i=0;i<12;i++)r=(r<<1)^((r>>>11)*0x1F25);const b=(v<<12)|r;for(let i=0;i<18;i++){const bit=(b>>>i)&1,a=size-11+i%3,c=Math.floor(i/3);set(a,c,bit);set(c,a,bit)}}
 let i=0;for(let right=size-1;right>=1;right-=2){if(right===6)right=5;for(let vert=0;vert<size;vert++)for(let j=0;j<2;j++){const x=right-j,up=((right+1)&2)===0,y=up?size-1-vert:vert;
   if(!F[y][x]&&i<cw.length*8){M[y][x]=((cw[i>>>3]>>>(7-(i&7)))&1)===1;i++}}}
 for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(!F[y][x]&&(x+y)%2===0)M[y][x]=!M[y][x]; /* מסכה 0 */
 return{size,version:v,get:(x,y)=>M[y][x]}}

/* ---------- ציור הקבלה (LpPosRender.java) ---------- */
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
function isRtl(s){for(const ch of String(s)){if(/[֐-ࣿיִ-﷿ﹰ-﻿]/.test(ch))return true;if(/[A-Za-zÀ-ɏͰ-ϿЀ-ӿ]/.test(ch))return false}return true}
const FONT='Arial,"Segoe UI","Noto Sans Hebrew",sans-serif';
function fontOf(size,bold){size=clamp(size|0||1,1,3);const px=Math.round(BASE*size*(size>=2?0.85:1));return{px,font:(bold?'bold ':'')+px+'px '+FONT}}
/* עטיפת שורות לפי רוחב (מילים; מילה ארוכה מדי נשברת לתווים). עד 40 שורות כמו בטלפון */
function wrap(ctx,s,w){const out=[];for(const para of String(s).split('\n')){let line='';
  for(const word of para.split(' ')){const cand=line?line+' '+word:word;if(ctx.measureText(cand).width<=w||!line&&ctx.measureText(word).width<=w){line=cand;continue}
   if(line)out.push(line);line='';let part='';for(const ch of word){if(ctx.measureText(part+ch).width>w&&part){out.push(part);part=ch}else part+=ch}line=part}
  out.push(line)}return out.slice(0,40)}
function layout(ctx,s,size,bold,w,align){const f=fontOf(size,bold);ctx.font=f.font;const lines=wrap(ctx,s,Math.max(1,w)),lh=Math.ceil(f.px*1.2),rtl=isRtl(s);
 return{h:lines.length*lh,draw(c,x,y){c.save();c.font=f.font;c.fillStyle='#000';c.textBaseline='top';try{c.direction=rtl?'rtl':'ltr'}catch(e){}
  c.textAlign=align==='center'?'center':align==='left'?'left':'right';const ax=align==='center'?x+w/2:align==='left'?x:x+w;
  lines.forEach((l,i)=>c.fillText(l,ax,y+i*lh+Math.round((lh-f.px)/2)));c.restore()}}}
function textBlock(ctx,s,align,size,bold,width){const t=layout(ctx,String(s||''),size,bold,width,align||'right');return{h:t.h+4,draw:(c,y)=>t.draw(c,0,y)}}
function colsBlock(ctx,l,width){const a=Array.isArray(l.cols)?l.cols.filter(x=>x&&typeof x==='object'):[];if(!a.length)return textBlock(ctx,'','right',1,false,width);
 const size=l.size||1,bold=!!l.bold,parts=[];let right=width,h=0;
 for(let i=0;i<a.length;i++){const col=a[i],last=i===a.length-1;let w=last?right:Math.max(8,Math.round(width*(+col.w>0?+col.w:1/a.length)));w=Math.min(w,right);if(w<=0)break;
  const gap=last?0:6,t=layout(ctx,String(col.text==null?'':col.text),col.size||size,col.bold!=null?!!col.bold:bold,Math.max(1,w-gap),col.align||'right');
  parts.push({t,x:right-w+(last?0:gap),w:Math.max(1,w-gap)});h=Math.max(h,t.h);right-=w}
 return{h:h+4,draw:(c,y)=>parts.forEach(p=>p.t.draw(c,p.x,y))}}
function dashedBlock(width){return{h:14,draw(c,y){c.save();c.strokeStyle='#000';c.lineWidth=2;c.setLineDash([8,6]);c.beginPath();c.moveTo(0,y+7);c.lineTo(width,y+7);c.stroke();c.restore()}}}
function imageBlock(ctx,l,width,img){if(!img||!(img.width>0))return textBlock(ctx,'[logo?]','center',1,false,width);
 const f=+l.w>0&&+l.w<=1?+l.w:0.5,w=clamp(Math.round(width*f),16,width),h=Math.max(1,Math.min(2000,Math.round(img.height*w/Math.max(1,img.width)))),al=l.align||'center';
 const x=al==='left'?0:al==='right'?width-w:Math.floor((width-w)/2);return{h:h+6,draw(c,y){c.drawImage(img,x,y,w,h)}}}
function codeBlock(ctx,l,width,isQr){const data=String(l.data==null?'':l.data);if(!data||data.length>1000)return textBlock(ctx,'','center',1,false,width);
 if(isQr){const q=qr(data);if(!q)return textBlock(ctx,'','center',1,false,width);const f=+l.size>0&&+l.size<=1?+l.size:0.45,side=clamp(Math.round(width*f),64,width),n=q.size+2,mod=Math.max(1,Math.floor(side/n)),w=n*mod,x0=Math.floor((width-w)/2);
  return{h:w+8,draw(c,y){c.fillStyle='#000';for(let my=0;my<q.size;my++)for(let mx=0;mx<q.size;mx++)if(q.get(mx,my))c.fillRect(x0+(mx+1)*mod,y+4+(my+1)*mod,mod,mod)}}}
 /* ברקוד: CODE128 בלבד (פורמטים אחרים מצוירים כ-CODE128) */
 const m=code128(data);if(!m)return textBlock(ctx,data,'center',1,false,width);const mod=Math.max(1,Math.min(4,Math.floor(width/m.length)));
 if(m.length*mod>width)return textBlock(ctx,data,'center',1,false,width);
 const w=m.length*mod,h=clamp(+l.h||80,24,300),x0=Math.floor((width-w)/2),cap=l.text!==false?textBlock(ctx,data,'center',1,false,width):null;
 return{h:h+8+(cap?cap.h:0),draw(c,y){c.fillStyle='#000';for(let i=0;i<m.length;i++)if(m[i])c.fillRect(x0+i*mod,y+4,mod,h);if(cap)cap.draw(c,y+4+h+4)}}}
function newCanvas(w,h){const d=root.document;if(d&&d.createElement){const c=d.createElement('canvas');c.width=w;c.height=h;return c}
 if(typeof root.OffscreenCanvas==='function')return new root.OffscreenCanvas(w,h);throw err('ERROR','אין אפשרות לצייר בדפדפן הזה')}
function loadImg(src){return new Promise(ok=>{try{const s=String(src||''),u=s.startsWith('data:')?s:'data:image/png;base64,'+s;if(u.length>6*1024*1024||!root.Image)return ok(null);
 const im=new root.Image();im.onload=()=>ok(im);im.onerror=()=>ok(null);im.src=u}catch(e){ok(null)}})}
/* receipt -> canvas לבן-שחור ברוחב width (384/576) */
async function render(r){r=r||{};let width=+r.width||576;if(width<128||width>1280)throw err('ERROR','bad width');width=Math.floor(width/8)*8;
 const lines=(Array.isArray(r.lines)?r.lines:[]).filter(l=>l&&typeof l==='object');
 const imgs=await Promise.all(lines.map(l=>l.t==='image'?loadImg(l.data):null));
 const meas=newCanvas(8,8).getContext('2d'),blocks=lines.map((l,i)=>{switch(l.t){
  case'line':return dashedBlock(width);
  case'feed':{const n=clamp(+l.n||(l.n===0?0:16),0,400);return{h:n,draw(){}}}
  case'cols':return colsBlock(meas,l,width);
  case'image':return imageBlock(meas,l,width,imgs[i]);
  case'qr':return codeBlock(meas,l,width,true);
  case'barcode':return codeBlock(meas,l,width,false);
  default:return textBlock(meas,l.text==null?'':l.text,l.align||'right',l.size||1,!!l.bold,width)}});
 const h=Math.max(1,Math.min(blocks.reduce((a,b)=>a+b.h,0),MAX_H)),cv=newCanvas(width,h),c=cv.getContext('2d');
 c.fillStyle='#fff';c.fillRect(0,0,width,h);let y=0;for(const b of blocks){if(y>=h)break;b.draw(c,y);y+=b.h}
 return cv}
function luma(cv){const w=cv.width,h=cv.height,d=cv.getContext('2d').getImageData(0,0,w,h).data,o=new Uint8Array(w*h);
 for(let i=0;i<o.length;i++){const a=d[i*4+3],v=(d[i*4]*299+d[i*4+1]*587+d[i*4+2]*114)/1000;o[i]=Math.round((v*a+255*(255-a))/255)}return o}
const pngB64=cv=>String(cv.toDataURL('image/png')).replace(/^data:image\/png;base64,/,'');

/* ---------- 'win': הדפסה דרך מנהל ההתקן של Windows ---------- */
let lastWinAt=0;
function winPrint(cv,width){const d=root.document;if(!d||!d.body)return Promise.reject(err('ERROR','אין חלון להדפסה'));
 const paper=width===384?58:80,printMm=width===384?48:72,hMm=Math.ceil(cv.height*printMm/cv.width)+4,src=cv.toDataURL('image/png');
 return new Promise((ok,no)=>{const f=d.createElement('iframe');f.setAttribute('aria-hidden','true');f.style.cssText='position:fixed;width:0;height:0;border:0;left:-9999px';d.body.append(f);
  const w=f.contentWindow;if(!w){f.remove();return no(err('ERROR','אין חלון להדפסה'))}
  w.document.open();w.document.write('<!doctype html><html><head><meta charset="utf-8"><style>@page{size:'+paper+'mm '+hMm+'mm;margin:0}html,body{margin:0;padding:0;background:#fff}'+
   'img{display:block;width:'+printMm+'mm;margin:0 auto}</style></head><body></body></html>');w.document.close();
  const im=w.document.createElement('img');let done=false;
  const go=()=>{if(done)return;done=true;try{w.focus();w.print();lastWinAt=Date.now();ok()}catch(e){no(err('ERROR','ההדפסה נכשלה'))}setTimeout(()=>f.remove(),60000)};
  im.onload=go;im.onerror=()=>{if(!done){done=true;f.remove();no(err('ERROR','ציור הקבלה נכשל'))}};im.src=src;w.document.body.append(im);if(im.complete&&im.naturalWidth)go()})}

/* ---------- 'serial': Web Serial ---------- */
let port=null,portBaud=0;
const hasSerial=()=>!!(root.navigator&&root.navigator.serial);
function baudOf(p){return BAUDS.includes(+(p&&p.baud))?+p.baud:9600}
/* חייב להיקרא מלחיצה של המשתמש. מחזיר את מזהי ה-USB של היציאה (אם יש) לשמירה בהגדרה */
function requestSerial(){if(!hasSerial())return Promise.reject(err('ERROR','הדפדפן הזה לא תומך בחיבור Serial – השתמשו ב-Chrome או Edge במחשב'));
 return root.navigator.serial.requestPort({}).then(pt=>{const i=pt.getInfo?pt.getInfo()||{}:{};closePort();port=pt;return{ok:true,usbVendorId:i.usbVendorId,usbProductId:i.usbProductId}},
  e=>{throw err('ERROR',e&&e.name==='NotFoundError'?'לא נבחרה יציאה':'בחירת היציאה נכשלה')})}
async function findPort(p){if(!hasSerial())throw err('ERROR','הדפדפן הזה לא תומך בחיבור Serial');
 const ports=await root.navigator.serial.getPorts(),match=pt=>{const i=pt.getInfo?pt.getInfo()||{}:{};return p.usbVendorId==null||(i.usbVendorId===p.usbVendorId&&(p.usbProductId==null||i.usbProductId===p.usbProductId))};
 if(port&&ports.includes(port)&&match(port))return port;const pt=ports.find(match);if(!pt)throw err('OFFLINE','המדפסת לא מחוברת (לא נמצאה יציאת Serial שאושרה)');return pt}
async function openPort(p){const pt=await findPort(p),b=baudOf(p);
 if(port===pt&&portBaud===b&&pt.writable)return pt;
 await closePort();try{await pt.open({baudRate:b,dataBits:8,stopBits:1,parity:'none',flowControl:'none'})}catch(e){if(!(e&&e.name==='InvalidStateError'))throw err('OFFLINE','אין חיבור למדפסת ('+(e&&e.name||'open')+')')}
 port=pt;portBaud=b;return pt}
async function closePort(){const pt=port;port=null;portBaud=0;if(pt){try{await pt.close()}catch(e){}}}
async function serialWrite(p,bytes){const pt=await openPort(p);if(!pt.writable)throw err('OFFLINE','אין חיבור למדפסת');const wr=pt.writable.getWriter();
 try{for(let i=0;i<bytes.length;i+=1024)await wr.write(bytes.subarray(i,i+1024))}catch(e){await closePort().catch(()=>{});throw err('OFFLINE','השליחה למדפסת נכשלה')}finally{try{wr.releaseLock()}catch(e){}}
 return bytes.length}

/* ---------- ממשק התוסף ---------- */
function needPrinter(p){if(!p||!p.type)throw err('NO_PRINTER','לא נבחרה מדפסת');return p}
async function print(a){a=a||{};const p=a.printer||null,rc=a.receipt;if(!rc||typeof rc!=='object')throw err('ERROR','no receipt');const t0=Date.now();
 const r0=Object.assign({},rc);if(r0.width==null&&p&&p.width)r0.width=p.width;
 const cv=await render(r0),out={width:cv.width,height:cv.height};if(a.preview)out.preview=pngB64(cv);
 const type=p&&p.type;
 if(!p||type==='none'){out.printed=false;out.bytes=0}
 else if(type==='win'){await winPrint(cv,cv.width);out.printed=true;out.via='win';out.bytes=0} /* "נשלח" – Windows לא מדווח אם יצא נייר */
 else if(type==='serial'||type==='mock'){const bytes=job(luma(cv),cv.width,cv.height,{dither:!!rc.dither,cut:rc.cut!==false,drawer:!!rc.drawer,pin:p.drawerPin});
  out.bytes=bytes.length;if(type==='serial')await serialWrite(p,bytes);out.printed=true;out.via=type}
 else throw err('ERROR','סוג מדפסת לא נתמך במחשב');
 out.ms=Date.now()-t0;return out}
function whoNow(){try{const S=root.POS_DEBUG&&root.POS_DEBUG.S,c=S&&S.sess&&S.sess.cashier;return String(c&&(c.name||c.no)||'').slice(0,40)}catch(e){return''}}
function nowStr(d){d=d||new Date();const z=n=>String(n).padStart(2,'0');return z(d.getDate())+'/'+z(d.getMonth()+1)+'/'+d.getFullYear()+' '+z(d.getHours())+':'+z(d.getMinutes())}
function drawerSlip(p,who){const lines=[{t:'text',text:'פתיחת מגירה',align:'center',size:2,bold:true},{t:'text',text:nowStr(),align:'center'}];
 if(who)lines.push({t:'text',text:'עובד: '+who,align:'center'});return{width:p.width||576,lines,cut:true}}
async function openDrawer(a){a=a||{};const p=needPrinter(a.printer),pin=+a.pin===5?5:+a.pin===2?2:(p.drawerPin===5?5:2);
 if(p.type==='serial'){await serialWrite(p,Uint8Array.from(drawer(pin,100,200)));return{ok:true,via:'serial'}}
 if(p.type==='win'){
  /* מזומן/החזר מיד אחרי קבלה שנשלחה עכשיו: מנהל ההתקן כבר פתח את המגירה עם הקבלה – לא מדפיסים עוד פתק */
  if((a.reason==='cash'||a.reason==='refund')&&Date.now()-lastWinAt<DRAWER_SKIP_MS)return{ok:true,via:'win',slip:false};
  const cv=await render(drawerSlip(p,a.who!=null?String(a.who).slice(0,40):whoNow()));await winPrint(cv,cv.width);return{ok:true,via:'win',slip:true}}
 if(p.type==='mock')return{ok:true,via:'mock'};
 throw err('ERROR','סוג מדפסת לא נתמך במחשב')}
async function printerStatus(a){const p=a&&a.printer;
 if(!p)return{connected:false,error:'no printer chosen'};
 if(p.type==='win')return{connected:true,via:'win',answered:false};
 if(p.type==='mock')return{connected:true,via:'mock',answered:false};
 if(p.type==='serial'){try{await findPort(p);return{connected:true,via:'serial',answered:false}}catch(e){return{connected:false,error:e.message}}}
 return{connected:false,error:'סוג מדפסת לא נתמך במחשב'}}
async function listDevices(){let serial=[];try{if(hasSerial())serial=(await root.navigator.serial.getPorts()).map(pt=>{const i=pt.getInfo?pt.getInfo()||{}:{};return{usbVendorId:i.usbVendorId,usbProductId:i.usbProductId}})}catch(e){}
 return{usb:[],bt:{state:'none',devices:[]},displays:(await displayInfo()).displays,keyboards:[],serial,web:true,serialSupported:hasSerial()}}
async function disconnect(){await closePort()}

/* ---------- מסך לקוח: חלון שני ---------- */
let cw=null;
const cwOpen=()=>!!(cw&&!cw.closed);
function screenExt(){try{return!!(root.screen&&root.screen.isExtended)}catch(e){return false}}
async function displayInfo(){const showing=cwOpen(),ext=screenExt();
 return{available:showing||ext,displays:showing||ext?[{id:1,name:showing?'חלון לקוח':'מסך שני'}]:[],showing}}
function writeDoc(w,html){try{w.document.open();w.document.write(html);w.document.close();return true}catch(e){return false}}
/* חייב להיות מלחיצה של המשתמש בפעם הראשונה (אחרת הדפדפן חוסם את החלון) */
function displayShow(a){const html=String(a&&a.html||'');if(html.length>512*1024)return Promise.reject(err('ERROR','html too big'));
 if(!cwOpen()){let w=null;try{w=root.open('about:blank','lpPosCustomer','popup=yes,width=1024,height=768')}catch(e){w=null}
  if(!w)return Promise.resolve({shown:false,blocked:true});cw=w;placeOnSecondScreen(w)}
 const ok=writeDoc(cw,html);emit('display',{showing:ok});return Promise.resolve({shown:ok})}
async function placeOnSecondScreen(w){try{if(typeof root.getScreenDetails!=='function')return;const sd=await root.getScreenDetails(),cur=sd.currentScreen;
 const o=(sd.screens||[]).find(s=>s!==cur&&!s.isPrimary)||(sd.screens||[]).find(s=>s!==cur);if(!o||w.closed)return;
 w.moveTo(o.availLeft,o.availTop);w.resizeTo(o.availWidth,o.availHeight)}catch(e){/* אין הרשאה / מסך אחד – החלון נשאר במקום */}}
/* ניקוי = דף ריק (החלון נשאר פתוח, כדי שלא יידרש שוב לחיצה כדי לפתוח אותו) */
async function displayClear(){if(cwOpen())writeDoc(cw,'<!doctype html><html dir=rtl lang=he><head><meta charset=utf-8></head><body style="margin:0;background:#fff"></body></html>');emit('display',{showing:cwOpen()})}

async function isAvailable(){return{ok:true,web:true,version:1}}
return{web:true,isAvailable,addListener,listDevices,printerStatus,print,openDrawer,disconnect,requestSerial,displayInfo,displayShow,displayClear,BAUDS:BAUDS.slice(),
 _t:{init,feed,cut,drawer,toBits,raster,job,code128,qr,render,luma,isRtl,drawerSlip,baudOf}}});
