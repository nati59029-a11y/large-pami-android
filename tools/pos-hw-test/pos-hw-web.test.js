/* Test of app-source/www/pos-hw-web.js (the computer / Chrome "plugin", wave 3) and its use by pos-hw.js and pos-devices.js.
   No real browser: fake navigator.serial / window.open. Android path (Capacitor plugin present) must stay exactly as before.
   Optional: with Playwright installed, one test draws the test receipt in Chromium and saves a PNG (path: env WIN_RECEIPT_PNG).
   Run: node tools/pos-hw-test/pos-hw-web.test.js */
'use strict';
const assert=require('assert'),path=require('path'),fs=require('fs');
const W=path.join(__dirname,'../../app-source/www/');
const webF=require(W+'pos-hw-web.js'),hwF=require(W+'pos-hw.js'),devF=require(W+'pos-devices.js');
function store(){const m={};return{getItem:k=>k in m?m[k]:null,setItem:(k,v)=>{m[k]=String(v)},removeItem:k=>{delete m[k]},_m:m}}
const hex=a=>Array.from(a).map(b=>b.toString(16).padStart(2,'0')).join(' ');
/* fake Web Serial: one granted port that records what was written */
function fakeSerial(o){o=o||{};const written=[],opened=[];
 const port={info:o.info||{usbVendorId:0x0416,usbProductId:0x5011},getInfo(){return this.info},writable:null,
  async open(a){opened.push(a);if(o.openFail){const e=new Error('x');e.name='NetworkError';throw e}this.writable={getWriter:()=>({write:async c=>{written.push(...c)},releaseLock(){}})}},
  async close(){this.writable=null}};
 return{written,opened,port,serial:{getPorts:async()=>o.none?[]:[port],requestPort:async()=>port}}}
(async()=>{
 const P0=webF({});const T=P0._t;

 // --- ESC/POS bytes (same as LpPosEscPos.java)
 assert.strictEqual(hex(T.init()),'1b 40');
 assert.strictEqual(hex(T.cut(0)),'1d 56 42 00','GS V 66 0 = feed and cut');
 assert.strictEqual(hex(T.drawer(2,100,200)),'1b 70 00 32 64','ESC p pin 2');
 assert.strictEqual(hex(T.drawer(5,100,200)),'1b 70 01 32 64','ESC p pin 5');
 assert.strictEqual(hex(T.drawer(2,400,100)),'1b 70 00 c8 c8','t2 >= t1');
 // 10x3 image: left column black -> bit 7 of the first byte in each row
 const lum=new Uint8Array(30).fill(255);[0,10,20].forEach(i=>lum[i]=0);lum[29]=10;
 assert.strictEqual(hex(T.toBits(lum,10,3,false)),'80 00 80 00 80 40');
 // raster: GS v 0 m xL xH yL yH, split into bands
 const bits=new Uint8Array(2*300),ras=T.raster(bits,16,300,128);
 assert.strictEqual(hex(ras.slice(0,8)),'1d 76 30 00 02 00 80 00');
 assert.strictEqual(ras.length,3*8+600,'3 bands (128+128+44 rows)');
 assert.strictEqual(hex(ras.slice(8+256,8+256+8)),'1d 76 30 00 02 00 80 00');
 assert.strictEqual(hex(ras.slice(2*(8+256),2*(8+256)+8)),'1d 76 30 00 02 00 2c 00');
 // whole job: init, picture, feed 3, cut, drawer pin 5 at the end
 let j=T.job(lum,10,3,{cut:true,drawer:true,pin:5});
 assert.strictEqual(hex(j.slice(0,2)),'1b 40');assert.strictEqual(hex(j.slice(2,10)),'1d 76 30 00 02 00 03 00');
 assert.strictEqual(hex(j.slice(-12)),'1b 64 03 1d 56 42 00 1b 70 01 32 64');
 j=T.job(lum,10,3,{cut:false});assert.strictEqual(hex(j.slice(-3)),'1b 64 04','no cut: feed 4, no drawer');

 // --- CODE128 (set B): start B, checksum, stop; every symbol is 11 modules, stop 13
 const m=T.code128('LP-TEST-1234');assert.strictEqual(m.length,11*(12+2)+13);assert.strictEqual(m[0],true);
 assert.strictEqual(T.code128('שלום'),null,'not ASCII');assert.strictEqual(T.code128(''),null);
 const pat=m.slice(0,11).map(x=>x?1:0).join('');assert.strictEqual(pat,'11010010000','start B');
 assert.strictEqual(m.slice(-13).map(x=>x?1:0).join(''),'1100011101011','stop');
 // --- QR: size by version, finder patterns, too long = null
 const q=T.qr('LP-TEST 19/11/2026 10:00');assert.strictEqual(q.version,2);assert.strictEqual(q.size,25);
 assert.ok(q.get(0,0)&&q.get(6,0)&&!q.get(1,1)&&q.get(2,2),'finder top-left');assert.ok(q.get(q.size-1,0)&&q.get(0,q.size-1));
 assert.strictEqual(T.qr('א'.repeat(1000)).version>=20,true);assert.strictEqual(T.qr('x'.repeat(3000)),null);
 assert.strictEqual(T.isRtl('שלום abc'),true);assert.strictEqual(T.isRtl('Coffee שלום'),false);assert.strictEqual(T.isRtl('₪13.80'),true);

 // --- printer settings in pos-hw.js: new types
 const H0=hwF({localStorage:store()}),C=H0.cleanPrinter;
 assert.deepStrictEqual(C({type:'win',host:'1.2.3.4',address:'x',width:384}),{type:'win',width:384,drawerPin:2,name:''},'win keeps no address fields');
 assert.deepStrictEqual(C({type:'serial'}),{type:'serial',width:576,drawerPin:2,name:'',baud:9600});
 assert.deepStrictEqual(C({type:'serial',baud:'115200',drawerPin:5,usbVendorId:1046,usbProductId:20497,path:'COM3'}),{type:'serial',width:576,drawerPin:5,name:'',baud:115200,usbVendorId:1046,usbProductId:20497});
 assert.strictEqual(C({type:'serial',baud:4800}),null,'baud only from the list');
 assert.strictEqual(C({type:'serial',baud:'9600; x'}),null);
 assert.strictEqual(C({type:'serial',usbVendorId:-1,usbProductId:70000}).usbVendorId,undefined);
 assert.strictEqual(H0.pDesc(C({type:'win'})),'מדפסת Windows (מנהל התקן) · 80 מ"מ');

 // --- Android path unchanged: native plugin wins even when LpPosWeb is loaded; openDrawer args exactly as before
 const log=[];const nat={isAvailable:async()=>({ok:true}),addListener(){},disconnect:async()=>{},openDrawer:async a=>{log.push(a);return{ok:true}},
  print:async a=>{log.push(a);return{printed:true}}};
 const web=webF({});
 const HA=hwF({Capacitor:{isNativePlatform:()=>true,Plugins:{LpPos:nat}},LpPosWeb:web,localStorage:store()});
 assert.strictEqual(HA.plug(),nat);assert.strictEqual(HA.web(),false);
 HA.setPrinter({type:'mock',width:384});await HA.openDrawer({reason:'cash'});
 assert.deepStrictEqual(log[0],{printer:{type:'mock',width:384,drawerPin:2,name:''},pin:2},'no reason field to the native plugin');
 await HA.print({lines:[]});assert.deepStrictEqual(Object.keys(log[1]),['printer','receipt','preview']);
 // old APK without LpPos: still "no hardware" (the web plugin is not used inside the app)
 const HO=hwF({Capacitor:{isNativePlatform:()=>true,Plugins:{}},LpPosWeb:web,localStorage:store()});
 assert.strictEqual(HO.plug(),null);assert.strictEqual(await HO.available(),false);
 // browser: the web plugin
 const HB=hwF({LpPosWeb:web,localStorage:store()});assert.strictEqual(HB.plug(),web);assert.strictEqual(HB.web(),true);assert.strictEqual(await HB.available(),true);

 // --- web plugin, serial: drawer = ESC p only (no paper), remembered port, OFFLINE when missing
 let fs1=fakeSerial();let P=webF({navigator:{serial:fs1.serial}});
 let r=await P.openDrawer({printer:{type:'serial',baud:19200,drawerPin:5,usbVendorId:0x0416},pin:5});
 assert.deepStrictEqual(r,{ok:true,via:'serial'});assert.strictEqual(hex(fs1.written),'1b 70 01 32 64');assert.strictEqual(fs1.opened[0].baudRate,19200);
 await P.openDrawer({printer:{type:'serial',baud:19200,drawerPin:2},pin:2});assert.strictEqual(fs1.opened.length,1,'port kept open');
 await P.openDrawer({printer:{type:'serial',baud:115200,drawerPin:2},pin:2});assert.strictEqual(fs1.opened[1].baudRate,115200,'reopened at the new speed');
 assert.deepStrictEqual(await P.printerStatus({printer:{type:'serial',baud:9600}}),{connected:true,via:'serial',answered:false});
 assert.deepStrictEqual(await P.requestSerial(),{ok:true,usbVendorId:0x0416,usbProductId:0x5011});
 P=webF({navigator:{serial:fakeSerial({none:true}).serial}});
 await assert.rejects(P.openDrawer({printer:{type:'serial',baud:9600}}),e=>e.code==='OFFLINE');
 assert.strictEqual((await P.printerStatus({printer:{type:'serial'}})).connected,false);
 P=webF({navigator:{serial:fakeSerial({info:{usbVendorId:1}}).serial}});
 await assert.rejects(P.openDrawer({printer:{type:'serial',usbVendorId:2}}),e=>e.code==='OFFLINE','other device');
 P=webF({navigator:{serial:fakeSerial({openFail:true}).serial}});
 await assert.rejects(P.openDrawer({printer:{type:'serial'}}),e=>e.code==='OFFLINE');
 P=webF({navigator:{}});await assert.rejects(P.requestSerial(),/לא תומך/);
 await assert.rejects(webF({}).openDrawer({}),e=>e.code==='NO_PRINTER');
 assert.deepStrictEqual(await webF({}).printerStatus({printer:{type:'win'}}),{connected:true,via:'win',answered:false});
 assert.strictEqual(H0.printerState({type:'win'},{connected:true,via:'win',answered:false}).state,'ok');
 // win: no paper slip right after a cash receipt (driver already opened the drawer) – here no receipt was sent, so a slip is needed (needs canvas → fails in Node with ERROR)
 await assert.rejects(webF({}).openDrawer({printer:{type:'win'},reason:'noSale'}),e=>e.code==='ERROR');
 const sl=T.drawerSlip({width:576},'דנה');assert.strictEqual(sl.lines[0].text,'פתיחת מגירה');assert.strictEqual(sl.lines[2].text,'עובד: דנה');assert.strictEqual(sl.cut,true);
 assert.strictEqual(T.drawerSlip({width:384},'').lines.length,2,'no worker line when unknown');

 // --- customer window: blocked = shown:false (no crash); open = shown:true
 P=webF({open:()=>null});assert.deepStrictEqual(await P.displayShow({html:'<b>x</b>'}),{shown:false,blocked:true});
 const wrote=[];const win={closed:false,document:{open(){},write(h){wrote.push(h)},close(){}},moveTo(){},resizeTo(){}};
 P=webF({open:()=>win,screen:{isExtended:true}});assert.deepStrictEqual(await P.displayShow({html:'<b>x</b>'}),{shown:true});assert.strictEqual(wrote[0],'<b>x</b>');
 assert.deepStrictEqual(await P.displayInfo(),{available:true,displays:[{id:1,name:'חלון לקוח'}],showing:true});
 await P.displayClear();assert.strictEqual(wrote.length,2,'cleared to an empty page, window stays open');
 const HD=hwF({LpPosWeb:webF({open:()=>{throw new Error('blocked')}}),localStorage:store()});assert.deepStrictEqual(await HD.display.show('x'),{shown:false,blocked:true});

 // --- pos-devices in the browser: printer set → normal H.print path (receipt lines); no printer + img → print window (old fallback)
 function webHw(o){const lg=[];return{lg,web:()=>true,available:async()=>true,printer:()=>o.printer||null,
  print:async rc=>{lg.push(['print',rc]);if(o.fail){const e=new Error('x');e.code=o.fail;throw e}return{printed:true,via:o.printer.type}},
  openDrawer:async a=>{lg.push(['drawer',a]);return{ok:true,via:'win'}},on:()=>()=>{},plug:()=>({})}}
 let Hw=webHw({printer:{type:'win',width:576,drawerPin:2}}),D=devF({LpPosHw:Hw,localStorage:store()});
 r=await D.print({id:'s1',kind:'sale',receipt:{width:576,lines:[{t:'text',text:'קבלה'}]}});
 assert.deepStrictEqual(r,{ok:true,via:'win',paperLow:false});assert.strictEqual(Hw.lg[0][1].lines[0].text,'קבלה');
 r=await D.openDrawer('cash');assert.deepStrictEqual(r,{ok:true});assert.deepStrictEqual(Hw.lg[1],['drawer',{reason:'cash'}]);
 await D.openDrawer('refund');assert.deepStrictEqual(Hw.lg[2],['drawer',{reason:'refund'}],'raw reason reaches the web plugin');
 Hw=webHw({printer:{type:'serial',baud:9600},fail:'OFFLINE'});D=devF({LpPosHw:Hw,localStorage:store()});
 r=await D.print({id:'s2',kind:'sale',receipt:{lines:[]}});assert.strictEqual(r.code,'OFFLINE');assert.strictEqual(r.queued,true);assert.strictEqual(D.queue().length,1);
 let printed=0;const doc={body:{append:el=>{el.contentWindow={document:{open(){},write(){},close(){},createElement:()=>({complete:true}),body:{append(){}}},focus(){},print(){printed++}}}},createElement:()=>({setAttribute(){},style:{},remove(){}})};
 Hw=webHw({});D=devF({LpPosHw:Hw,localStorage:store(),document:doc});
 r=await D.print({id:'s3',img:'data:image/png;base64,iVBORw0KGgo='});assert.strictEqual(r.via,'browser');assert.strictEqual(printed,1);
 r=await D.print({id:'s4',receipt:{lines:[]}});assert.strictEqual(r.code,'NO_PRINTER','lines without a printer → queue');
 // native H (no web()) without printer: still NO_PRINTER, no print window (unchanged)
 const Hn=Object.assign(webHw({}),{web:undefined});D=devF({LpPosHw:Hn,localStorage:store(),document:doc});
 r=await D.print({id:'s5',img:'data:image/png;base64,iVBORw0KGgo='});assert.strictEqual(r.code,'NO_PRINTER');assert.strictEqual(printed,1);

 console.log('pos-hw-web.js: all tests passed');

 // --- optional: draw in Chromium (Playwright), check CODE128/QR/serial bytes from a real canvas, save a picture
 let pw=null;try{pw=require('playwright')}catch(e){}
 if(!pw){console.log('playwright not installed – canvas test skipped');return}
 const out=process.env.WIN_RECEIPT_PNG||'';
 const br=await pw.chromium.launch();try{const pg=await br.newPage();
  /* real origin (localStorage does not work on about:blank) */
  await pg.route('http://pos.test/**',rt=>rt.fulfill({contentType:'text/html',body:'<!doctype html><html dir=rtl><body></body></html>'}));await pg.goto('http://pos.test/');
  for(const f of ['pos-hw-web.js','pos-hw.js','pos-devices.js'])await pg.addScriptTag({content:fs.readFileSync(W+f,'utf8')});
  const res=await pg.evaluate(async()=>{const H=window.LpPosHw,P=window.LpPosWeb;
   const rc=H.testReceipt({title:'לארג\' פעמי',drawer:true});const cv=await P._t.render(Object.assign({width:576},rc));
   /* serial with a fake port: the whole job comes from the canvas */
   const got=[];const port={getInfo:()=>({}),writable:null,async open(){this.writable={getWriter:()=>({write:async c=>{for(const b of c)got.push(b)},releaseLock(){}})}},async close(){}};
   Object.defineProperty(navigator,'serial',{value:{getPorts:async()=>[port],requestPort:async()=>port}});
   H.setPrinter({type:'serial',baud:115200,drawerPin:5});const r=await H.print(rc,{preview:true});
   /* win: Devices.print → iframe + window.print (no dialog in headless) */
   H.setPrinter({type:'win'});const d=await window.Devices.print({id:'w1',kind:'sale',receipt:{width:576,lines:[{t:'text',text:'בדיקה',align:'center'}]}});
   const dr=await P.openDrawer({printer:H.printer(),reason:'cash'});
   H.openPanel();const pn=document.querySelector('[role=dialog]'),ks=Array.from(pn.querySelectorAll('[data-k]')).map(x=>x.dataset.k);
   const panel={win:ks.includes('win'),serial:ks.includes('serial'),find:ks.includes('find'),net:ks.includes('net'),help:/kiosk-printing/.test(pn.innerHTML)};
   return{panel,w:cv.width,h:cv.height,png:cv.toDataURL('image/png'),bytes:got.length,head:got.slice(0,8),tail:got.slice(-12),via:r.via,prev:!!r.preview,dev:d,dr}});
  assert.strictEqual(res.w,576);assert.ok(res.h>600&&res.h<2000,'height '+res.h);
  assert.strictEqual(hex(res.head),'1b 40 1d 76 30 00 48 00');assert.strictEqual(hex(res.tail),'1b 64 03 1d 56 42 00 1b 70 01 32 64');
  assert.ok(res.bytes>72*res.h,'raster for every row');assert.strictEqual(res.via,'serial');assert.ok(res.prev);
  assert.deepStrictEqual(res.dev,{ok:true,via:'win',paperLow:false});assert.deepStrictEqual(res.dr,{ok:true,via:'win',slip:false},'cash right after a receipt: no extra slip');
  assert.deepStrictEqual(res.panel,{win:true,serial:true,find:false,net:false,help:true},'browser panel: Windows/Serial buttons, no USB/Bluetooth');
  if(out){fs.writeFileSync(out,Buffer.from(res.png.split(',')[1],'base64'));console.log('receipt picture: '+out)}
  console.log('pos-hw-web.js canvas (Chromium): all tests passed')}finally{await br.close()}
})().catch(e=>{console.error(e);process.exit(1)});
