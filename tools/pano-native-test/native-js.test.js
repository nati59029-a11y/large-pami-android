/* Test of app-source/www/store3d-pano-native.js with a mocked Capacitor plugin. Run: node tools/pano-native-test/native-js.test.js */
'use strict';
const assert=require('assert'),path=require('path');
const factory=require(path.join(__dirname,'../../app-source/www/store3d-pano-native.js'));
function mkRoot(plugin){return{Capacitor:plugin===undefined?undefined:{Plugins:plugin?{PanoStitch:plugin}:{}},btoa,atob,Blob}}
function mock(opt){opt=opt||{};const log=[];let lis=null;
 return{log,isAvailable:async()=>{log.push('isAvailable');if(opt.availThrow)throw new Error('x');return{ok:opt.ok!==false}},
  begin:async a=>{log.push(['begin',a])},addFrame:async a=>{log.push(['addFrame',a.i,a.jpeg,a.q])},
  addListener:async(n,cb)=>{lis=cb;return{remove:async()=>{log.push('remove');lis=null}}},
  run:async()=>{log.push('run');if(lis){lis({p:.5});lis({p:1})}if(opt.runFail)throw new Error('stitch failed');return{jpeg:Buffer.from('JPEGDATA').toString('base64'),fovL:61.9,stats:{pairs:3}}},
  cancel:async()=>{log.push('cancel')}}}
const frames=[{blob:new Blob([Uint8Array.from([1,2,3])]),q:[1,0,0,0],w:1600,h:1200,yaw:12},{blob:new Blob([Uint8Array.from([255,0])]),q:[0,0,0,1],w:1600,h:1200,yaw:40}];
(async()=>{
 // no Capacitor / no plugin -> false, stitch throws
 assert.strictEqual(await factory(mkRoot(undefined)).available(),false);
 assert.strictEqual(await factory(mkRoot(null)).available(),false);
 await assert.rejects(factory(mkRoot(null)).stitch(frames,{fovL:65}),/unavailable/);
 // plugin says ok:false (x86 / armv7) or throws
 assert.strictEqual(await factory(mkRoot(mock({ok:false}))).available(),false);
 assert.strictEqual(await factory(mkRoot(mock({availThrow:true}))).available(),false);
 // success
 const m=mock(),N=factory(mkRoot(m)),ps=[];
 assert.strictEqual(await N.available(),true);await N.available();
 assert.strictEqual(m.log.filter(x=>x==='isAvailable').length,1,'cached');
 const r=await N.stitch(frames,{fovL:65,W:2048},p=>ps.push(p));
 assert.deepStrictEqual(m.log[1],['begin',{n:2,W:2048,fovL:65,yawRef:12,w:1600,h:1200}]);
 assert.deepStrictEqual(m.log[2],['addFrame',0,Buffer.from([1,2,3]).toString('base64'),[1,0,0,0]]);
 assert.deepStrictEqual(m.log[3],['addFrame',1,Buffer.from([255,0]).toString('base64'),[0,0,0,1]]);
 assert.strictEqual(Buffer.from(await r.full.arrayBuffer()).toString(),'JPEGDATA');
 assert.strictEqual(r.full.type,'image/jpeg');assert.strictEqual(r.fovL,61.9);assert.deepStrictEqual(r.stats,{pairs:3});
 for(let i=1;i<ps.length;i++)assert.ok(ps[i]>=ps[i-1],'progress forward');assert.strictEqual(ps[ps.length-1],1);
 assert.ok(m.log.includes('remove'),'listener removed');
 // failure -> rejects, plugin cancelled, can run again
 const m2=mock({runFail:true}),N2=factory(mkRoot(m2));
 await assert.rejects(N2.stitch(frames,{fovL:65,yawRef:3}),/stitch failed/);
 assert.ok(m2.log.includes('cancel'));assert.strictEqual(m2.log[1][1].yawRef,3);
 await assert.rejects(N2.stitch([{q:[1,0,0,0]}],{fovL:65}),/bad frame 0/);
 console.log('store3d-pano-native.js: all checks passed');
})().catch(e=>{console.error(e);process.exit(1)});
