/* Test of app-source/www/pos-hw.js with a mocked Capacitor plugin and a fake document. Run: node tools/pos-hw-test/pos-hw.test.js */
'use strict';
const assert=require('assert'),path=require('path');
const factory=require(path.join(__dirname,'../../app-source/www/pos-hw.js'));
function store(){const m={};return{getItem:k=>k in m?m[k]:null,setItem:(k,v)=>{m[k]=String(v)},_m:m}}
function fakeDoc(){const ls=[];return{ls,addEventListener:(n,f,c)=>ls.push(f),removeEventListener:(n,f)=>{const i=ls.indexOf(f);if(i>=0)ls.splice(i,1)},
 key(k,t,target){const e={key:k,timeStamp:t,target:target||{tagName:'BODY'},prevented:false,preventDefault(){this.prevented=true},stopPropagation(){}};ls.slice().forEach(f=>f(e));return e}}}
function mock(o){o=o||{};const log=[];return{log,
 isAvailable:async()=>({ok:true,version:1}),addListener:(n,cb)=>{log.push(['listen',n])},
 disconnect:async()=>{log.push('disconnect')},
 listDevices:async()=>o.dev||{usb:[],bt:{state:'ok',devices:[]},displays:[],keyboards:o.kb||[]},
 printerStatus:async a=>{log.push(['status',a.printer.type]);if(o.stThrow)throw new Error('boom');return o.st||{connected:true,answered:true,online:true,paperOut:false,paperLow:false,coverOpen:false,drawerOpen:false}},
 print:async a=>{log.push(['print',a]);return{printed:true,bytes:123,ms:5,preview:a.preview?'PNG':undefined}},
 openDrawer:async a=>{log.push(['drawer',a])},
 displayInfo:async()=>o.di||{available:false,displays:[],showing:false},
 displayShow:async a=>{log.push(['dshow',a.html.length]);return{shown:true}},displayClear:async()=>{log.push('dclear')}}}
function mk(plugin,doc){return factory({Capacitor:plugin?{Plugins:{LpPos:plugin}}:undefined,localStorage:store(),document:doc})}
(async()=>{
 // --- no plugin (browser / old APK)
 const N=mk(null);
 assert.strictEqual(await N.available(),false);
 await assert.rejects(N.print({lines:[]}),/אין חיבור לחומרה/);
 const s0=await N.status();assert.strictEqual(s0.native,false);assert.strictEqual(s0.printer.state,'err');assert.strictEqual(s0.display.state,'none');
 assert.deepStrictEqual(await N.display.show('<b>x</b>'),{shown:false});

 // --- printer settings: only clean values are kept
 const C=N.cleanPrinter;
 assert.deepStrictEqual(C({type:'net',host:'192.168.1.50'}),{type:'net',width:576,drawerPin:2,name:'',host:'192.168.1.50',port:9100});
 assert.strictEqual(C({type:'net',host:'1.2.3.4; rm -rf',port:9100}),null);
 assert.strictEqual(C({type:'net',host:'printer.local',port:70000}),null);
 assert.strictEqual(C({type:'net',host:'printer.local',port:'9100'}).port,9100);
 assert.deepStrictEqual(C({type:'bt',address:'aa:bb:cc:dd:ee:ff',width:384,drawerPin:5,extra:'x'}),{type:'bt',width:384,drawerPin:5,name:'',address:'AA:BB:CC:DD:EE:FF'});
 assert.strictEqual(C({type:'bt',address:'nope'}),null);
 assert.deepStrictEqual(C({type:'usb',deviceName:'/dev/bus/usb/001/004',vendorId:1046,productId:20497}),{type:'usb',width:576,drawerPin:2,name:'',deviceName:'/dev/bus/usb/001/004',vendorId:1046,productId:20497});
 assert.strictEqual(C({type:'usb',deviceName:'../../etc'}),null);
 assert.strictEqual(C({type:'sunmi'}),null);assert.strictEqual(C(null),null);
 assert.throws(()=>N.setPrinter({type:'net',host:''}),/לא תקינה/);

 // --- scan detector: fast keys + Enter = scan, human typing = nothing
 const D=N.ScanDetector({maxGap:40,minLen:4});
 const typeIt=(s,t0,gap)=>{let r=null,t=t0;for(const ch of s){r=D.feed(ch,t)||r;t+=gap}return D.feed('Enter',t)||r};
 assert.deepStrictEqual(typeIt('7290000123456',1000,8),{code:'7290000123456',ms:96});
 assert.strictEqual(typeIt('7290000123456',5000,120),null,'human typing');
 assert.strictEqual(typeIt('abc',9000,5),null,'too short');
 assert.strictEqual(D.feed('Enter',20000),null,'bare Enter');
 // Shift between characters does not break the run
 let t=30000;for(const k of ['A','Shift','B','Shift','C','1']){D.feed(k,t);t+=5}assert.deepStrictEqual(D.feed('Enter',t),{code:'ABC1',ms:25});
 // a slow first key followed by a fast burst: only the burst counts
 D.feed('x',40000);let r=null;t=40500;for(const ch of '12345678'){D.feed(ch,t);t+=6}r=D.feed('Enter',t);assert.strictEqual(r.code,'12345678');
 // Enter long after the last key = not a scan
 t=50000;for(const ch of '12345678'){D.feed(ch,t);t+=6}assert.strictEqual(D.feed('Enter',t+500),null);

 // --- card data is thrown away
 assert.strictEqual(N.looksLikeCard('%B4580000000000000^ISRAELI/ISRAEL^2512'),true);
 assert.strictEqual(N.looksLikeCard(';4580000000000000=2512101'),true);
 assert.strictEqual(N.looksLikeCard('4580458045804580'),true,'Luhn-valid 16 digits');
 assert.strictEqual(N.looksLikeCard('4580458045804581'),false,'Luhn-invalid');
 assert.strictEqual(N.looksLikeCard('7290000123456'),false,'EAN-13');
 assert.strictEqual(N.looksLikeCard('LP-TEST-1234'),false);
 assert.deepStrictEqual(typeIt('%B4580000000000000^X^25',60000,5),{rejected:'card'});

 // --- onScan on a document: emits, restores the focused field, ignores card swipes
 const doc=fakeDoc(),m=mock(),P=mk(m,doc);
 const got=[],rej=[];const off=P.onScan(s=>got.push(s));P.on('rejected',x=>rej.push(x));
 assert.strictEqual(doc.ls.length,1);
 const field={tagName:'INPUT',value:'before',dataset:{}};
 t=1000;for(const ch of '7290000123456'){doc.key(ch,t,field);field.value+=ch;t+=7}
 const ent=doc.key('Enter',t,field);
 assert.strictEqual(ent.prevented,true);assert.strictEqual(got.length,1);assert.strictEqual(got[0].code,'7290000123456');assert.strictEqual(field.value,'before','field restored');
 const keep={tagName:'INPUT',value:'',dataset:{posScan:'keep'}};
 t=3000;for(const ch of '12345'){doc.key(ch,t,keep);keep.value+=ch;t+=7}doc.key('Enter',t,keep);assert.strictEqual(keep.value,'12345');assert.strictEqual(got.length,2);
 t=5000;for(const ch of ';4580000000000000=2512'){doc.key(ch,t);t+=5}doc.key('Enter',t);
 assert.strictEqual(got.length,2,'card not emitted');assert.deepStrictEqual(rej,[{reason:'card'}]);
 assert.ok(!JSON.stringify(got).includes('4580'));
 const human=doc.key('Enter',9000);assert.strictEqual(human.prevented,false,'a normal Enter passes');
 off();off();assert.strictEqual(doc.ls.length,0,'listener removed');

 // --- printing with a saved printer
 assert.strictEqual(await P.available(),true);
 await assert.rejects(P.print({lines:[]}),/לא נבחרה מדפסת/);
 P.setPrinter({type:'mock',width:384});assert.ok(m.log.includes('disconnect'));
 assert.deepStrictEqual(P.printer(),{type:'mock',width:384,drawerPin:2,name:''});
 const pr=await P.print(P.testReceipt({date:new Date(2026,10,17,9,5)}),{preview:true});
 assert.strictEqual(pr.preview,'PNG');
 const call=m.log.find(x=>x[0]==='print')[1];
 assert.deepStrictEqual(call.printer,{type:'mock',width:384,drawerPin:2,name:''});
 const kinds=call.receipt.lines.map(l=>l.t);
 for(const k of ['text','cols','line','barcode','qr'])assert.ok(kinds.includes(k),k);
 assert.ok(call.receipt.lines.some(l=>l.text==='17/11/2026 09:05'));
 assert.strictEqual(call.receipt.cut,true);
 await P.openDrawer();assert.deepStrictEqual(m.log.find(x=>x[0]==='drawer')[1],{printer:{type:'mock',width:384,drawerPin:2,name:''},pin:2});

 // --- status mapping
 const S=P.printerState;
 assert.strictEqual(S(null,null).state,'none');
 assert.strictEqual(S({},{connected:false,error:'x'}).state,'err');
 assert.strictEqual(S({},{connected:true,answered:true,paperOut:true}).msg,'נגמר הנייר');
 assert.strictEqual(S({},{connected:true,answered:true,coverOpen:true}).state,'err');
 assert.strictEqual(S({},{connected:true,answered:true,online:false}).state,'err');
 assert.strictEqual(S({},{connected:true,answered:true,online:true,paperLow:true}).state,'warn');
 assert.strictEqual(S({},{connected:true,answered:false}).state,'ok');
 let st=await P.status();
 assert.strictEqual(st.printer.state,'ok');assert.strictEqual(st.drawer.state,'ok');assert.strictEqual(st.scanner.state,'ok','a scan was seen');assert.strictEqual(st.display.state,'none');
 const m2=mock({stThrow:true,kb:[{name:'Barcode Scanner HID'}],di:{available:true,displays:[{id:2,name:'HDMI'}],showing:false}}),P2=mk(m2,fakeDoc());
 P2.setPrinter({type:'net',host:'10.0.0.9'});
 st=await P2.status();
 assert.strictEqual(st.printer.state,'err');assert.ok(st.printer.msg.includes('boom'));assert.strictEqual(st.drawer.state,'err');
 assert.strictEqual(st.scanner.state,'warn');assert.ok(st.scanner.msg.includes('Barcode Scanner HID'));
 assert.strictEqual(st.display.state,'ok');assert.ok(st.display.msg.includes('HDMI'));

 // --- customer display HTML is escaped and script-free
 const h=P.cartHtml({title:'<script>alert(1)</script>',lines:[{name:'חלב "תנובה" <b>',qty:2,price:6.9}],total:13.8,msg:"x'y"});
 assert.ok(!/<script/i.test(h));assert.ok(h.includes('&lt;script&gt;'));assert.ok(h.includes('חלב &quot;תנובה&quot; &lt;b&gt;'));
 assert.ok(h.includes('₪13.80'));assert.ok(h.includes('dir=rtl'));assert.ok(h.includes('x&#39;y'));
 assert.ok(!P.cartHtml({lines:[{name:'a',price:'abc'}]}).includes('NaN'));
 await P.display.showCart({lines:[],total:0});assert.ok(m.log.some(x=>x[0]==='dshow'));
 console.log('pos-hw.js: all tests passed');
})().catch(e=>{console.error(e);process.exit(1)});
