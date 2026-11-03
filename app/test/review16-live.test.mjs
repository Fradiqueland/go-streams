import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveCapturePanel} from '../public/live-capture.js';
import {ProductionTools} from '../public/live-production.js';
import {CaptureFeeds} from '../src/capture-feeds.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {createApplication} from '../src/server.mjs';
import {dispatch} from './transport.mjs';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {webmHeader} from './webm-fixture.mjs';

const tick=()=>Promise.resolve().then(()=>Promise.resolve());
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function replaceGlobal(t,name,value){const previous=Object.getOwnPropertyDescriptor(globalThis,name);Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});t.after(()=>{if(previous)Object.defineProperty(globalThis,name,previous);else delete globalThis[name];});}
function snapshotPanel(t){
 const messages=[],links=[],timers=[],revoked=[],objects=[];
 const panel=new LiveCapturePanel({api:async()=>{},toast:(message,error)=>messages.push({message,error}),getState:()=>({})});
 panel.element={};panel.update=()=>{};panel.output={};
 t.mock.method(ProductionTools.prototype,'mount',()=>{});
 panel.mount({appendChild(){}},{});panel.production.update=()=>{};
 replaceGlobal(t,'document',{createElement(tag){assert.equal(tag,'a');const link={click(){link.clicked=true;}};links.push(link);return link;}});
 replaceGlobal(t,'setTimeout',callback=>{timers.push(callback);return 1;});
 t.mock.method(URL,'createObjectURL',blob=>{objects.push(blob);return 'blob:snapshot-'+objects.length;});
 t.mock.method(URL,'revokeObjectURL',url=>revoked.push(url));
 return {panel,tools:panel.production,messages,links,timers,revoked,objects};
}

test('the live snapshot stays pending until PNG encoding completes and releases its download URL',async t=>{
 const f=snapshotPanel(t),button={dataset:{production:'snapshot'}};let encode,draws=0;
 f.panel.canvas={toBlob(callback,type){assert.equal(type,'image/png');encode=callback;}};f.panel.drawFrame=()=>{draws++;};
 const creating=f.tools.action(button);await tick();assert.equal(button.disabled,true);assert.equal(f.links.length,0);
 const blob=new Blob(['PNG bytes'],{type:'image/png'});encode(blob);await creating;
 assert.equal(button.disabled,false);assert.equal(draws,1);assert.deepEqual(f.objects,[blob]);assert.equal(f.links.length,1);assert.equal(f.links[0].clicked,true);assert.match(f.links[0].download,/^Streamland-.*\.png$/);assert.deepEqual(f.messages,[]);
 assert.equal(f.timers.length,1);f.timers[0]();assert.deepEqual(f.revoked,['blob:snapshot-1']);
});

test('a null live PNG result reports an error and permits retry instead of silently succeeding',async t=>{
 const f=snapshotPanel(t),button={dataset:{production:'snapshot'}};let encode;
 f.panel.canvas={toBlob(callback){encode=callback;}};
 const creating=f.tools.action(button);await tick();assert.equal(button.disabled,true);encode(null);await creating;
 assert.equal(button.disabled,false);assert.equal(f.links.length,0);assert.equal(f.messages.length,1);assert.equal(f.messages[0].error,true);assert.match(f.messages[0].message,/PNG.*could not be created/);
 const retry=f.tools.action(button);encode(new Blob(['retry'],{type:'image/png'}));await retry;assert.equal(f.links.length,1);assert.equal(f.links[0].clicked,true);
});

test('a live snapshot download failure is reported and still releases its temporary URL',async t=>{
 const f=snapshotPanel(t),button={dataset:{production:'snapshot'}};
 f.panel.canvas={toBlob(callback){callback(new Blob(['PNG'],{type:'image/png'}));}};
 replaceGlobal(t,'document',{createElement:()=>({click(){throw Error('Download was blocked');}})});
 await f.tools.action(button);assert.equal(button.disabled,false);assert.deepEqual(f.messages,[{message:'Download was blocked',error:true}]);
 assert.equal(f.timers.length,1);f.timers[0]();assert.deepEqual(f.revoked,['blob:snapshot-1']);
});

for(const pendingStart of [false,true])test('closing preview '+(pendingStart?'releases devices during pending folder selection':'retains independent recording output until finalization'),async()=>{
 const finished=deferred(),events=[],panel=new LiveCapturePanel({api:async()=>{},toast(){}});
 panel.controls=()=>{};panel.status=()=>{};panel.element={querySelector:()=>({}),querySelectorAll:()=>[]};
 panel.output={getTracks:()=>[{stop(){events.push('devices-stopped');}}]};
 panel.production={recordingId:pendingStart?null:'local-recording',starting:pendingStart,get recording(){return true;},async stopRecording(){await finished.promise;events.push('recording-finished');this.recordingId=null;},stopClip(){},stopVisuals(){}};
 const closing=panel.release();assert.deepEqual(events,pendingStart?['devices-stopped']:[]);finished.resolve();await closing;
 assert.deepEqual(events,pendingStart?['devices-stopped','recording-finished']:['recording-finished','devices-stopped']);assert.equal(panel.output,null);assert.equal(panel.releasing,null);
});

test('a live upload failure leaves independent local recording and preview devices active',async t=>{
 replaceGlobal(t,'MediaRecorder',class extends EventTarget{static isTypeSupported(){return true;}state='inactive';start(){this.state='recording';}stop(){this.state='inactive';queueMicrotask(()=>this.dispatchEvent(new Event('stop')));}});
 let recordingStops=0,deviceStops=0;const calls=[],panel=new LiveCapturePanel({api:async route=>{calls.push(route);return {id:'live-feed'};},toast(){}});
 panel.controls=()=>{};panel.status=()=>{};panel.element={querySelector:()=>({})};panel.output={getTracks:()=>[{stop(){deviceStops++;}}]};panel.config={source:'camera',quality:'720p',aspect:'16:9'};
 panel.production={recordingId:'independent-file',async stopRecording(){recordingStops++;}};
 await panel.acquireFeed('live');panel.session={id:'broadcast'};panel.feedUploader.fail(Error('RTMP upload disconnected'));await panel.stopDone;
 assert.equal(recordingStops,0);assert.equal(panel.production.recordingId,'independent-file');assert.equal(deviceStops,0);assert.ok(panel.output);
 assert.equal(panel.session,null);assert.equal(panel.feedSession,null);assert.deepEqual(calls.sort(),['/api/capture/start','/api/capture/live-feed/stop','/api/live/broadcast/stop'].sort());
});

for(const strictFirst of [false,true])test('strict preview release receives the current recording failure when '+(strictFirst?'the strict request starts first':'ordinary cleanup starts first'),async()=>{
 const failed=deferred(),error=Error('The final recording upload failed'),events=[],panel=new LiveCapturePanel({api:async()=>{},toast(){}});let attempts=0;
 panel.controls=()=>{};panel.status=()=>{};panel.output={};
 panel.production={recordingId:'pending-file',async stopRecording(options){assert.equal(options.throwOnError,true);attempts++;if(attempts===1)await failed.promise;this.recordingId=null;},stopClip(){}};
 panel.stop=async()=>{events.push('live-stopped');panel.stopFailure=null;};panel.releaseDevices=()=>{events.push('devices-stopped');panel.output=null;};
 const first=panel.release({throwOnError:strictFirst}),second=panel.release({throwOnError:!strictFirst}),strict=strictFirst?first:second,ordinary=strictFirst?second:first;
 const rejected=assert.rejects(strict,failure=>failure===error);failed.reject(error);await rejected;await ordinary;
 assert.equal(attempts,1);assert.deepEqual(events,['live-stopped','devices-stopped']);assert.equal(panel.releasing,null);
 await panel.release({throwOnError:true});assert.equal(attempts,2);
});

test('the capture manager acknowledges repeated stop requests only after the encoder has drained',async()=>{
 const feeds=new CaptureFeeds({}, {clock:false}),completion=deferred();let ends=0,settled=false;
 const feed={id:'draining-feed',stopped:false,completion:completion.promise,child:{stdin:{end(){ends++;}},kill(){}}};feeds.active.set(feed.id,feed);
 try{
  const first=feeds.stop(feed.id),second=feeds.stop(feed.id);first.then(()=>{settled=true;});await tick();assert.equal(settled,false);assert.equal(first,second);assert.equal(ends,1);
  completion.resolve();await first;assert.equal(settled,true);feeds.active.delete(feed.id);await feeds.stop(feed.id);
 }finally{clearTimeout(feed.timer);completion.resolve();feeds.active.clear();await feeds.shutdown();}
});

test('authenticated capture stop responses wait for the shared encoder completion',async t=>{
 const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});const directory=fs.mkdtempSync(path.join(parent,'review16-drain-'));
 const app=await createApplication({directory,listen:false,clock:false,portableVault:true}),completion=deferred();let ended=0;
 const feed={id:'final-slice',stopped:false,completion:completion.promise,child:{stdin:{end(){ended++;}},kill(){}}};app.feeds.active.set(feed.id,feed);
 t.after(async()=>{clearTimeout(feed.timer);completion.resolve();app.feeds.active.delete(feed.id);await app.close();assert.equal(path.dirname(directory),parent);fs.rmSync(directory,{recursive:true,force:true});});
 const headers={Cookie:'go_streams='+app.token,'Content-Type':'application/json','X-Go-Streams':'1'},results=[];
 const one=dispatch(app,'/api/capture/final-slice/stop',{method:'POST',headers,body:'{}'}).then(response=>{results.push(response);return response;});
 const two=dispatch(app,'/api/capture/final-slice/stop',{method:'POST',headers,body:'{}'}).then(response=>{results.push(response);return response;});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(ended,1);assert.equal(results.length,0);
 completion.resolve();const responses=await Promise.all([one,two]);assert.ok(responses.every(response=>response.status===200));assert.deepEqual(await responses[0].json(),{ok:true});
});

for(const exit of [{code:0,error:false},{code:1,error:true},{code:null,signal:'SIGTERM',error:true}])test('shared encoder stop preserves the '+String(exit.code)+' exit result for attached recordings',async()=>{
 const worker=new EventEmitter();worker.stdout=new PassThrough();worker.stderr=new PassThrough();worker.stdin=new Writable({write(data,encoding,done){done();}});worker.kill=()=>{};
 const feeds=new CaptureFeeds({store:{data:{settings:{}}},spawnProcess:()=>worker},{clock:false});
 const {id}=feeds.create({confirmed:true,source:'camera',quality:'720p',aspect:'16:9'}),feed=feeds.get(id),results=[];
 feed.child.stdin.write(webmHeader());feeds.attach(id,new Writable({write(data,encoding,done){done();}}),error=>results.push(error));
 try{
  const stopping=feeds.stop(id);worker.emit('close',exit.code,exit.signal);await stopping;
  assert.equal(results.length,1);if(exit.error)assert.match(results[0],/could not finish/);else assert.equal(results[0],'');assert.equal(feeds.active.size,0);
 }finally{clearTimeout(feed.timer);feed.resolve();feeds.active.clear();worker.stdin.destroy();worker.stdout.destroy();worker.stderr.destroy();await feeds.shutdown();}
});
