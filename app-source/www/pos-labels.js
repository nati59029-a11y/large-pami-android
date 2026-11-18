/* POS:M6 – קופה ש6: מדבקות מחיר ושלטי מדף (B13). באזור הניהול, אחראי משמרת או מנהל. לא במסך הקופה.
   V.posLbls – תור ההדפסה (posLbl list): מוצרים חדשים, שינויי מחיר, קבלת סחורה, והוספה ידנית ממסך המוצרים.
   הדפסה: דף A4 – מדבקה קטנה 3×8 (שם, מחיר, ברקוד EAN-13 בפסים מ-PosBarcode.bars) או שלט מדף 2×5.
   PDF דרך shMkPdf / PdfPrint הקיימים (כמו פתקי המדף). אחרי ההדפסה: "הודפס" מסמן את השורות (posLbl done). */
(function(){
'use strict';
if(typeof ACT==='undefined'||typeof V==='undefined')return;
const M=()=>window.PosM6;
const S={L:null,sel:new Set()};
const ok=()=>M()&&M().on()&&M().lead();
const WHY={new:'מוצר חדש',rcv:'קבלת סחורה',price:'שינוי מחיר',manual:'ידני'};
const redraw=()=>{try{if(cur().v==='posLbls'&&!document.querySelector('#dlg[open]'))rerender()}catch(e){}};
V.posLbls=()=>{const T='מדבקות ושלטי מדף';if(!ok())return{t:T,h:'<div class="empty">לאחראי משמרת ולמנהל, כשהקופה מופעלת בעסק</div>'};
 if(S.L===null){S.L=undefined;M().fnCall('posLbl',{op:'list'}).then(r=>{S.L=(r.items||[]).filter(x=>!x.gone);S.sel=new Set(S.L.map(x=>x.id));redraw()}).catch(e=>{S.L=[];M().err(e)})}
 const L=S.L||[];
 return{t:T,s:L.length?`${L.length} בתור`:'',h:S.L===undefined?'<div class="empty">טוען…</div>':L.length?`<div class="row"><button class="btn grow" data-a="lbPrint" data-k="lbl">הדפסת מדבקות (${L.filter(x=>S.sel.has(x.id)&&x.kind!=='shelf').length})</button><button class="btn g grow" data-a="lbPrint" data-k="shelf">שלטי מדף</button></div>
  <div class="chips" style="margin-top:6px"><button class="chip" data-a="lbAll" data-v="1">בחר הכול</button><button class="chip" data-a="lbAll" data-v="0">נקה בחירה</button></div>
  ${L.map(x=>`<label class="li" style="cursor:pointer"><input type="checkbox" data-c="lbSel" data-id="${esc(x.id)}"${S.sel.has(x.id)?' checked':''}><div class="m" style="min-width:0"><b style="overflow-wrap:anywhere">${esc(x.name)}</b><small><bdi dir="ltr">${esc(M().ils2(x.price))}</bdi>${x.barcode?' · <bdi dir="ltr">'+esc(x.barcode)+'</bdi>':''} · ${esc(WHY[x.why]||'')}${x.n>1?' · '+x.n+' עותקים':''}${x.kind==='shelf'?' · שלט מדף':''}</small></div></label>`).join('')}
  <p class="note">אחרי ההדפסה לחצו "הודפס" – השורות יורדו מהתור.</p>`:'<div class="empty">אין מדבקות בתור. מוצר חדש, שינוי מחיר וקבלת סחורה מוסיפים לכאן.</div>'}};
CHG.lbSel=el=>{const id=el.dataset.id;if(el.checked)S.sel.add(id);else S.sel.delete(id);rerender()};
ACT.lbAll=el=>{S.sel=el.dataset.v==='1'?new Set((S.L||[]).map(x=>x.id)):new Set();rerender()};

/* ---------- ציור ---------- */
const W=1240,H=1754; // A4 ב-150 DPI
function barsTo(g,code,x,y,w,h){const s=window.PosBarcode?PosBarcode.bars(code):'';if(!s){g.font='22px sans-serif';g.textAlign='center';g.fillText(code||'',x+w/2,y+h/2);return}
 const u=w/s.length;g.fillStyle='#000';for(let i=0;i<s.length;i++)if(s[i]==='1')g.fillRect(x+i*u,y,Math.ceil(u),h);g.font='20px monospace';g.textAlign='center';g.fillText(code,x+w/2,y+h+20)}
function fit(g,t,max,size,weight){let s=size;g.font=`${weight||''} ${s}px sans-serif`;while(g.measureText(t).width>max&&s>12){s-=2;g.font=`${weight||''} ${s}px sans-serif`}return s}
function page(items,kind){const c=document.createElement('canvas');c.width=W;c.height=H;const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,W,H);g.fillStyle='#000';g.direction='rtl';
 const cols=kind==='shelf'?2:3,rows=kind==='shelf'?5:8,mx=40,my=60,cw=(W-2*mx)/cols,ch=(H-2*my)/rows;
 items.forEach((it,i)=>{const cx=mx+(i%cols)*cw,cy=my+Math.floor(i/cols)*ch;g.strokeStyle='#ccc';g.lineWidth=1;g.strokeRect(cx+4,cy+4,cw-8,ch-8);g.fillStyle='#000';g.textAlign='center';
  const nm=String(it.name||'').slice(0,40);fit(g,nm,cw-30,kind==='shelf'?40:26,'bold');g.fillText(nm,cx+cw/2,cy+(kind==='shelf'?60:38));
  const pr=typeof it.price==='number'?'₪'+it.price.toFixed(2):'';fit(g,pr,cw-30,kind==='shelf'?110:46,'bold');g.fillText(pr,cx+cw/2,cy+(kind==='shelf'?170:88));
  if(it.barcode){const bw=Math.min(cw-50,kind==='shelf'?380:300),bh=kind==='shelf'?60:50;g.direction='ltr';barsTo(g,it.barcode,cx+(cw-bw)/2,cy+ch-(kind==='shelf'?110:88),bw,bh);g.direction='rtl'}});
 return c.toDataURL('image/jpeg',.9)}
function sheets(list,kind){const per=kind==='shelf'?10:24,flat=[];list.forEach(x=>{for(let i=0;i<Math.max(1,Math.min(200,x.n||1));i++)flat.push(x)});const out=[];for(let i=0;i<flat.length;i+=per)out.push(page(flat.slice(i,i+per),kind));return out}
async function printPdf(imgs,name){const pdf=shMkPdf(imgs,W,H),C=typeof shNat==='function'?shNat():null;
 if(C&&C.Plugins&&C.Plugins.PdfPrint)await C.Plugins.PdfPrint.print({name,data:shB64(pdf)});else window.open(URL.createObjectURL(new Blob([pdf],{type:'application/pdf'})),'_blank')}
ACT.lbPrint=async el=>{const kind=el.dataset.k==='shelf'?'shelf':'lbl';const L=(S.L||[]).filter(x=>S.sel.has(x.id)&&(kind==='shelf'||x.kind!=='shelf'));if(!L.length)return toast('לא נבחרו שורות');
 if(typeof shMkPdf!=='function')return toast('ההדפסה לא זמינה');
 toast('מכין להדפסה…');try{await printPdf(sheets(L,kind),kind==='shelf'?'shelf-signs':'price-labels');
  dlg(`<h3>ההדפסה נשלחה</h3><p class="note">האם הודפס כמו שצריך? "הודפס" מוריד את ${L.length} השורות מהתור.</p><div class="row"><button class="btn grow" data-a="lbDone" data-ids="${esc(L.map(x=>x.id).join(','))}">הודפס</button><button class="btn g grow" data-a="closeDlg">עוד לא</button></div>`)}catch(e){toast('ההדפסה נכשלה: '+(e&&e.message||e))}};
ACT.lbDone=async el=>{const ids=String(el.dataset.ids||'').split(',').filter(Boolean);try{await M().fnCall('posLbl',{op:'done',ids});closeDlg();S.L=null;rerender()}catch(e){M().err(e)}};
window.PosLabels={sheets,page};
})();
