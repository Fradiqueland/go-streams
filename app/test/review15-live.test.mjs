import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveCapturePanel,LiveUploader} from '../public/live-capture.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>Promise.resolve().then(()=>Promise.resolve());
function replaceGlobal(t,name,value){const previous=Object.getOwnPropertyDescriptor(globalThis,name);Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});t.after(()=>{if(previous)Object.defineProperty(globalThis,name,previous);else delete globalThis[name];});}
function panel(api=async()=>({})){
 const value=new LiveCapturePanel({api,toast(){},getState:()=>({})}),controls={};
 value.controls=()=>{};value.status=(message,error=false)=>{value.lastStatus={message,error};};
 value.element={querySelector:selector=>controls[selector]||=(selector.includes('consent')?{checked:true}:{}),querySelectorAll:()=>[]};
 value.output={getTracks:()=>[]};value.config={source:'camera',quality:'720p',aspect:'16:9'};
 value.production={async stopRecording(){},stopClip(){},stopVisuals(){}};
 return value;
}
function recorder(t){
 const instances=[];
 replaceGlobal(t,'MediaRecorder',class{
  static isTypeSupported(){return true;}
  constructor(stream){this.stream=stream;this.state='inactive';this.events=new Map();instances.push(this);}
  start(){this.state='recording';this.starts=(this.starts||0)+1;}
  addEventListener(name,callback){this.events.set(name,callback);}
  stop(){this.state='inactive';Promise.resolve().then(()=>this.events.get('stop')?.());}
 });
 return instances;
}

test('finishing a live upload drains accepted chunks once and rejects new admission immediately',async()=>{
 const pending=deferred(),sent=[];let stops=0;
 const upload=new LiveUploader({fetchChunk:async(blob,sequence)=>{sent.push([blob.size,sequence]);await pending.promise;},stopRemote:async()=>{stops++;},onError(){assert.fail('No error is expected');}});
 upload.push({size:3});await tick();const finishing=upload.finish();upload.push({size:5});
 assert.equal(upload.finish(),finishing);assert.equal(upload.bytes,3);pending.resolve();await finishing;
 assert.deepEqual(sent,[[3,0]]);assert.equal(stops,1);assert.equal(upload.bytes,0);assert.equal(upload.closed,true);
 await upload.finish();assert.equal(stops,1);
});

test('failed uploads retain the original failure when cleanup also rejects and finalize only once',async()=>{
 const failure=Error('Upload disconnected'),observed=[];let stops=0;
 const upload=new LiveUploader({fetchChunk:async()=>{throw failure;},stopRemote:async()=>{stops++;throw Error('Stop unavailable');},onError:error=>observed.push(error)});
 upload.push({size:2});upload.push({size:2});await upload.pending;
 await assert.rejects(upload.finish(),error=>error===failure);await assert.rejects(upload.finish(),error=>error===failure);
 assert.deepEqual(observed,[failure]);assert.equal(stops,1);assert.equal(upload.bytes,0);
});

test('remote shutdown failures are returned to the live upload finalizer',async()=>{
 const failure=Error('Capture shutdown unavailable');let stops=0;
 const upload=new LiveUploader({fetchChunk:async()=>{},stopRemote:async()=>{stops++;throw failure;},onError(){}});
 upload.push({size:1});await assert.rejects(upload.finish(),error=>error===failure);
 assert.equal(upload.closed,true);assert.equal(stops,1);assert.equal(upload.bytes,0);
});

test('waiting for an old live feed to close cannot acquire a replacement after preview cancellation',async t=>{
 recorder(t);
 for(const cancel of [value=>{value.releasing=Promise.resolve();},value=>{value.captureEpoch++;value.output={getTracks:()=>[]};}]){
  const pending=deferred(),calls=[],value=panel(async route=>{calls.push(route);return {id:'new-feed'};});
  value.feedSession={id:'old-feed'};value.feedClosing=pending.promise.then(()=>{value.feedClosing=null;value.feedSession=null;});
  const acquiring=value.acquireFeed('recording');cancel(value);pending.resolve();
  await assert.rejects(acquiring,/cancelled/);assert.deepEqual(calls,[]);assert.ok(!value.feedUsers?.size);assert.ok(!value.feedStarting);assert.equal(value.feedSession,null);
 }
});

test('a capture creation response after device release is closed without starting its browser encoder',async t=>{
 const instances=recorder(t),pending=deferred(),calls=[],value=panel(async route=>{calls.push(route);return route==='/api/capture/start'?pending.promise:{ok:true};});
 const acquiring=value.acquireFeed('recording');value.releaseDevices();pending.resolve({id:'obsolete-feed'});
 await assert.rejects(acquiring,/cancelled/);
 assert.deepEqual(calls,['/api/capture/start','/api/capture/obsolete-feed/stop']);assert.equal(instances.length,1);assert.ok(!instances[0].starts);
 assert.equal(value.output,null);assert.equal(value.feedSession,null);assert.equal(value.feedStarting,null);assert.equal(value.feedUsers.size,0);assert.equal(value.feedRecorder,null);assert.equal(value.feedUploader,null);
});

test('releasing a preview waits for a concurrent live stop and its pending feed flush',async()=>{
 const remote=deferred(),flushed=deferred(),events=[],value=panel(async route=>{events.push(route);await remote.promise;});
 value.output={getTracks:()=>[{stop(){events.push('devices-stopped');}}]};value.session={id:'active-live'};value.feedSession={id:'active-feed'};
 value.releaseFeed=async role=>{events.push('release-'+role);if(role==='live')await flushed.promise;else value.feedSession=null;};
 const stopping=value.stop(),closing=value.release();await tick();assert.ok(!events.includes('devices-stopped'));
 remote.resolve();await tick();assert.ok(!events.includes('devices-stopped'));flushed.resolve();await Promise.all([stopping,closing]);
 assert.equal(events.filter(event=>event==='/api/live/active-live/stop').length,1);assert.ok(events.indexOf('devices-stopped')>events.indexOf('release-live'));
 assert.equal(value.output,null);assert.equal(value.session,null);assert.equal(value.stopping,false);assert.equal(value.releasing,null);
});

test('a live upload failure arriving during an existing stop remains visible after cleanup',async()=>{
 const remote=deferred(),calls=[],value=panel(async route=>{calls.push(route);await remote.promise;});
 value.session={id:'active-live'};value.releaseFeed=async()=>{};
 const stopping=value.stop(),failed=value.stop(Error('Original upload failure'));remote.resolve();await Promise.all([stopping,failed]);
 assert.deepEqual(calls,['/api/live/active-live/stop']);assert.deepEqual(value.lastStatus,{message:'Original upload failure',error:true});
 assert.equal(value.stopping,false);assert.equal(value.stopDone,null);
});

test('shared live upload errors close the encoder once and remain visible instead of success',async t=>{
 const instances=recorder(t),calls=[],value=panel(async route=>{calls.push(route);return {id:'feed'};});
 await value.acquireFeed('live');value.session={id:'live'};const failure=Error('Live upload connection lost');
 value.feedUploader.fail(failure);await value.stopDone;
 assert.deepEqual(value.lastStatus,{message:failure.message,error:true});assert.equal(value.session,null);assert.equal(value.feedSession,null);assert.equal(value.feedUploader,null);assert.equal(value.feedRecorder,null);assert.equal(value.feedUsers.size,0);
 assert.equal(instances[0].state,'inactive');assert.equal(calls.filter(route=>route==='/api/capture/feed/stop').length,1);assert.equal(calls.filter(route=>route==='/api/live/live/stop').length,1);
});

for(const failedEndpoint of ['live','capture'])test('preview release preserves '+failedEndpoint+' shutdown errors while releasing devices',async()=>{
 const failure=Error(failedEndpoint+' shutdown unavailable'),cleanupFailure=Error('Capture cleanup unavailable'),calls=[];
 const value=panel(async route=>{
  calls.push(route);
  if(route.includes('/'+failedEndpoint+'/'))throw failure;
  if(failedEndpoint==='live'&&route.includes('/capture/'))throw cleanupFailure;
  return {ok:true};
 });
 let stoppedDevices=0;
 value.output={getTracks:()=>[{stop(){stoppedDevices++;}}]};
 value.session={id:'active-live'};value.feedSession={id:'active-feed'};value.feedUsers=new Set(['live']);
 value.feedRecorder={state:'inactive'};
 value.feedUploader=new LiveUploader({fetchChunk:async()=>{},stopRemote:()=>value.api('/api/capture/active-feed/stop',{}),onError(){assert.fail('No upload error is expected');}});
 await value.release();
 assert.deepEqual(value.lastStatus,{message:failure.message,error:true});assert.equal(value.stopFailure,failure);
 assert.deepEqual(calls,['/api/live/active-live/stop','/api/capture/active-feed/stop']);
 assert.equal(stoppedDevices,1);assert.equal(value.output,null);assert.equal(value.feedSession,null);assert.equal(value.feedUploader,null);assert.equal(value.feedRecorder,null);assert.equal(value.feedUsers.size,0);
 assert.equal(value.session?.id,failedEndpoint==='live'?'active-live':undefined);
 assert.equal(value.stopping,false);assert.equal(value.releasing,null);
});
