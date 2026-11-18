/* Test of app-source/www/pos-devices.js (Devices) and pos-help.js with a mocked LpPosHw. Run: node tools/pos-hw-test/pos-devices.test.js */
'use strict';
const assert=require('assert'),path=require('path');
const factory=require(path.join(__dirname,'../../app-source/www/pos-devices.js'));
const helpF=require(path.join(__dirname,'../../app-source/www/pos-help.js'));
function store(init){const m=Object.assign({},init||{});return{getItem:k=>k in m?m[k]:null,setItem:(k,v)=>{m[k]=String(v)},removeItem:k=>{delete m[k]},_m:m}}
const IMG='data:image/png;base64,iVBORw0KGgo=';
function hw(o){o=o||{};const log=[];const L={};let fail=o.fail||null;
 const H={log,set fail(v){fail=v},available:async()=>o.avail!==false,printer:()=>o.noPrinter?null:{type:'usb',vendorId:1046,width:576,drawerPin:2},
  print:async(rc)=>{log.push(['print',rc]);if(fail){const e=new Error('x');e.code=fail;throw e}return{printed:true,via:'usb',paperLow:!!o.low}},
  openDrawer:async()=>{log.push('drawer');if(o.drawerFail){const e=new Error('x');e.code=o.drawerFail;throw e}return{ok:true}},
  onScan:(cb)=>{H._scan=cb;return()=>{}},vibrate:async ms=>{log.push(['vib',ms]);return true},
  display:{showCart:async c=>{log.push(['cart',c]);return{shown:true}},clear:async()=>{log.push('dclear')},info:async()=>({available:false})},
  plug:()=>({printerStatus:async()=>({connected:true})}),on:(n,cb)=>{(L[n]=L[n]||[]).push(cb);return()=>{}},_emit:(n,d)=>(L[n]||[]).forEach(f=>f(d))};
 return H}
function mk(H,extra){const root=Object.assign({LpPosHw:H,localStorage:store()},extra||{});return{D:factory(root),root}}
(async()=>{
 // --- print OK: image job → one image line, cut by default
 let H=hw(),{D}=mk(H);
 let r=await D.print({id:'K1-000001',img:IMG});
 assert.deepStrictEqual(r,{ok:true,via:'usb',paperLow:false});
 const rc=H.log[0][1];assert.deepStrictEqual(rc.lines,[{t:'image',data:IMG,w:1}]);assert.strictEqual(rc.cut,true);
 assert.strictEqual(D.queue().length,0);
 // receipt job keeps its own cut; bad image is refused without printing
 await D.print({id:'a',receipt:{lines:[{t:'text',text:'x'}],cut:false}});assert.strictEqual(H.log[1][1].cut,false);
 r=await D.print({id:'b',img:'javascript:alert(1)'});assert.strictEqual(r.ok,false);assert.strictEqual(r.code,'ERROR');

 // --- paper out (H7): sale not stopped, receipt queued, Hebrew message, reprint prints the same receipt once
 H=hw({fail:'PAPER_OUT'});({D}=mk(H));const ev=[];D.on('reprint',e=>ev.push(e));D.on('prn',e=>ev.push(['prn',e.n]));
 r=await D.print({id:'K1-000002',img:IMG});
 assert.strictEqual(r.ok,false);assert.strictEqual(r.code,'PAPER_OUT');assert.strictEqual(r.queued,true);assert.ok(/נגמר הנייר/.test(r.msg));
 assert.deepStrictEqual(D.queue().map(q=>[q.id,q.code]),[['K1-000002','PAPER_OUT']]);
 r=await D.reprint();assert.strictEqual(r.ok,false);assert.strictEqual(D.queue()[0].tries,2,'still queued, tries counted');
 H.fail=null;r=await D.reprint();assert.strictEqual(r.ok,true);assert.strictEqual(D.queue().length,0);
 assert.strictEqual(ev.filter(e=>e&&e.id==='K1-000002').length,1,'one reprint event');
 assert.strictEqual(H.log.filter(x=>x[0]==='print').length,3);
 // reprint with empty queue = the last printed receipt
 r=await D.reprint();assert.strictEqual(r.ok,true);assert.strictEqual(ev.filter(e=>e&&e.last).length,1);
 // same id twice in queue stays one entry; retryQueue stops at first failure
 H.fail='OFFLINE';await D.print({id:'q1',img:IMG});await D.print({id:'q1',img:IMG});await D.print({id:'q2',img:IMG});
 assert.deepStrictEqual(D.queue().map(q=>q.id),['q1','q2']);assert.ok(/לא מחוברת/.test(D.queue()[0].msg));
 let rq=await D.retryQueue();assert.strictEqual(rq.done,0);assert.strictEqual(rq.left,2);
 H.fail=null;rq=await D.retryQueue();assert.deepStrictEqual(rq,{done:2,left:0});
 // test print is never queued
 H.fail='ERROR';r=await D.print({id:'t',img:IMG,kind:'test'});assert.strictEqual(r.queued,false);assert.strictEqual(D.queue().length,0);

 // --- unknown plugin error message → NO_PRINTER / ERROR
 assert.strictEqual(D._t.codeOf({message:'no printer chosen'}),'NO_PRINTER');assert.strictEqual(D._t.codeOf({code:'IO'}),'ERROR');assert.strictEqual(D._t.codeOf({code:'OFFLINE'}),'OFFLINE');
 // no printer chosen on the device
 ({D}=mk(hw({noPrinter:true})));r=await D.print({id:'n',img:IMG});assert.strictEqual(r.code,'NO_PRINTER');assert.strictEqual(r.queued,true);

 // --- drawer (H8): event for poslog, test reason allowed, cfg hwDrawer:false
 H=hw();({D}=mk(H));const dr=[];D.on('drawer',e=>dr.push(e.reason));
 assert.deepStrictEqual(await D.openDrawer('cash'),{ok:true});await D.openDrawer('weird');assert.deepStrictEqual(dr,['cash','noSale']);
 ({D}=mk(hw(),{PosCfg:{get:k=>k==='hwDrawer'?false:undefined}}));r=await D.openDrawer('cash');assert.strictEqual(r.code,'NO_DRAWER');
 ({D}=mk(hw({drawerFail:'OFFLINE'})));r=await D.openDrawer('cash');assert.strictEqual(r.code,'OFFLINE');assert.ok(r.msg);

 // --- device state from posdev (O13)
 const S=D.stateOf;const root2={localStorage:store({'lp-pos-inst':'inst_aaaaaaaaaaaaaaaa'})};const D2=factory(root2);
 assert.strictEqual(D2.stateOf(null,true),'none');
 assert.strictEqual(D2.stateOf({st:'retired'},true),'retired');
 assert.strictEqual(D2.stateOf({on:false},true),'off');
 assert.strictEqual(D2.stateOf({on:true,kill:{at:1}},true),'off');
 assert.strictEqual(D2.stateOf({on:true,inst:'inst_bbbbbbbbbbbbbbbb'},true),'off','registered on another device');
 assert.strictEqual(D2.stateOf({on:true,inst:'inst_aaaaaaaaaaaaaaaa'},true),'pending');
 assert.strictEqual(D2.stateOf({on:true,inst:'inst_aaaaaaaaaaaaaaaa',appr:{at:1}},true),'ok');
 assert.strictEqual(D2.stateOf({on:true,inst:'inst_aaaaaaaaaaaaaaaa'},false),'ok','devApprove off');
 assert.ok(typeof S==='function');
 // devPoll with fsx mock → blocked + state event; drawer refuses when blocked (except test)
 const calls=[];const root3={LpPosHw:hw(),localStorage:store({'lp-pos-inst':'inst_aaaaaaaaaaaaaaaa','lp-pos-dev':JSON.stringify({bizId:'b1',dev:'K1'})}),
  fsx:async p=>{calls.push(p);return{fields:{}}},fvj:()=>({on:true,kill:{at:1},inst:'inst_aaaaaaaaaaaaaaaa'}),fnCall:async(n,b)=>{calls.push([n,b]);return{ok:true}}};
 const D3=factory(root3);const st=[];D3.on('state',e=>st.push(e.state));
 assert.strictEqual(await D3.devPoll(),'off');assert.deepStrictEqual(calls[0],'/posdev/K1');assert.strictEqual(D3.blocked(),true);assert.deepStrictEqual(st,['off']);
 r=await D3.openDrawer('noSale');assert.strictEqual(r.code,'BLOCKED');assert.strictEqual((await D3.openDrawer('test')).ok,true);

 // --- status report to the server: only on change (or every 5 minutes), never with personal data
 D3._t.hwChanged({printer:'paper'});await new Promise(r=>setTimeout(r,5));
 const rep=calls.filter(c=>Array.isArray(c)&&c[0]==='posOps'&&c[1].op==='hw');assert.strictEqual(rep.length,1);
 assert.deepStrictEqual(rep[0][1].hwSt,{printer:'paper',disp:'none',prnq:0});assert.strictEqual(rep[0][1].dev,'K1');
 assert.strictEqual(await D3.report(false),false,'same state → not sent again');assert.strictEqual(await D3.report(true),true);

 // --- error report scrubs phones, cards, mails; ctx only primitives
 await D3.reportErr('crit','PRN<1>','לקוח 050-1234567 a@b.co כרטיס 4580 4580 4580 4580',{screen:'pay',n:2,obj:{a:1},'bad key':1,phone:'0501234567'});
 const er=calls.filter(c=>Array.isArray(c)&&c[1].op==='err')[0][1];
 assert.strictEqual(er.code,'PRN1');assert.strictEqual(er.sev,'crit');assert.ok(!/050|1234567|4580|a@b/.test(er.msg),er.msg);
 assert.deepStrictEqual(er.ctx,{screen:'pay',n:2,phone:'[num]'});assert.strictEqual(er.dev,'K1');

 // --- scanner / customer display / vibrate pass through
 H=hw();({D}=mk(H));const sc=[];D.onScan(s=>sc.push(s.code));H._scan({code:'7290000123456',ms:40});assert.deepStrictEqual(sc,['7290000123456']);
 await D.showCustomer({lines:[],total:1});assert.ok(H.log.some(x=>x[0]==='cart'));
 assert.strictEqual(await D.vibrate(50),true);({D}=mk(hw(),{PosCfg:{get:k=>k==='vibrate'?false:undefined}}));assert.strictEqual(await D.vibrate(50),false);

 // --- USB printer plugged back in → queue printed by itself (P1)
 H=hw({fail:'OFFLINE'});({D}=mk(H,{fsx:async()=>null,fvj:()=>null,localStorage:store({'lp-pos-dev':JSON.stringify({dev:'K1'}),'lp-pos-inst':'inst_aaaaaaaaaaaaaaaa'})}));
 await D.print({id:'u1',img:IMG});assert.strictEqual(D.queue().length,1);D.start();H.fail=null;H._emit('usb',{attached:true,vendorId:1046});
 await new Promise(r=>setTimeout(r,1800));D.stop();assert.strictEqual(D.queue().length,0,'reprinted after USB attach');

 // --- browser without plugin: print through the print window
 let printed=0;const doc={body:{append:el=>{el.contentWindow={document:{open(){},write(){},close(){},createElement:()=>({complete:true}),body:{append(){}}},focus(){},print(){printed++}}}},createElement:()=>({setAttribute(){},style:{},remove(){}})};
 ({D}=mk(hw({avail:false}),{document:doc}));r=await D.print({id:'w',img:IMG});assert.strictEqual(r.via,'browser');assert.strictEqual(printed,1);
 ({D}=mk(null,{}));r=await D.print({id:'w2',receipt:{lines:[]}});assert.strictEqual(r.code,'NO_PRINTER');

 // --- help
 const P=helpF({});assert.ok(P.list().includes('sale')&&P.list().includes('hw')&&P.list().includes('ops'));
 assert.ok(/data-a="posHelp"/.test(P.btn('sale')));assert.ok(!/<script/.test(P.btn('<script>')));
 P.add('x',{t:'<b>',items:['<i>a</i>']});const b=P.bodyOf('x');assert.ok(b.h.includes('&lt;i&gt;'));
 assert.ok(P.GUIDE.steps.length>=8);assert.strictEqual(P.bodyOf('nope'),null);
 const PV=helpF({PosCfg:{get:()=>'https://example.invalid/v'}});assert.ok(PV.bodyOf('sale').h.includes('https://example.invalid/v'));
 const PB=helpF({PosCfg:{get:()=>'javascript:alert(1)'}});assert.ok(!PB.bodyOf('sale').h.includes('javascript'));
 console.log('pos-devices.js + pos-help.js: all tests passed');
})().catch(e=>{console.error(e);process.exit(1)});
