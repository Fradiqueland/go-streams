import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable,Readable} from 'node:stream';
import {Store,Vault,Studio} from '../src/core.mjs';
import {LiveCapture} from '../src/live-capture.mjs';
import {CaptureFeeds} from '../src/capture-feeds.mjs';
import {createApplication} from '../src/server.mjs';
import {dispatch} from './transport.mjs';
import {LiveUploader} from '../public/live-capture.js';
import {webmHeader} from './webm-fixture.mjs';
import policy from '../electron/capture-policy.cjs';

function fakeWorkers(){
 const workers=[];
 const spawnProcess=(command,args,options)=>{
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.input=[];
  child.stdin=new Writable({write(data,encoding,done){child.input.push(Buffer.from(data));done();},final(done){done();queueMicrotask(()=>child.emit('close',0));}});
  child.kill=()=>{child.killed=true;child.stdin.destroy();queueMicrotask(()=>child.emit('close',1));};
  Object.assign(child,{args,options,command});workers.push(child);return child;
 };
 return {workers,spawnProcess};
}
// Sink lifecycle tests operate after the encoder has seen its valid video
// metadata. Native wire tests separately exercise real fragmented uploads.
function sharedFeedFixture(studio){
 const feeds=new CaptureFeeds(studio,{clock:false}),create=feeds.create.bind(feeds);
 feeds.create=input=>{const result=create(input);feeds.get(result.id).child.stdin.write(webmHeader());return result;};return feeds;
}
function fixture(t){
 const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});const root=fs.mkdtempSync(path.join(parent,'live-test-'));
 const store=new Store(root),vault=new Vault(root,{portable:true}),fake=fakeWorkers(),studio=new Studio(store,vault,{spawnProcess:fake.spawnProcess});
 const live=new LiveCapture(studio,{clock:false});
 const start=live.start.bind(live);live.start=input=>{const result=start(input);if(!input.feedId)for(const job of result.jobs)studio.jobs.get(job.id).child.stdin.write(webmHeader());return result;};
 const ids=['YouTube','Facebook'].map((platform,i)=>studio.saveChannel({name:platform,platform,url:'rtmp://127.0.0.1:9/live',key:`LIVE-SECRET-${i}`}));
 t.after(async()=>{await studio.shutdown();assert.ok(root.startsWith(parent+path.sep));fs.rmSync(root,{recursive:true,force:true});});
 return {root,store,studio,live,ids,...fake};
}
const input=(ids,extra={})=>({channelIds:ids,confirmed:true,source:'screen-camera',quality:'720p',aspect:'16:9',mimeType:'video/webm;codecs=vp8,opus',...extra});
function chunk(bytes=Buffer.from('webm-chunk')){const req=Readable.from([bytes]);req.headers={'content-type':'video/webm'};return req;}

test('live capture reserves all destinations, isolates workers, redacts keys and preserves the project',async t=>{
 const {live,studio,store,ids,workers}=fixture(t),before=structuredClone(store.data);
 const session=live.start(input(ids));assert.equal(session.jobs.length,2);
 assert.ok(workers.every(w=>w.options.shell===false&&w.args.includes('pipe:0')&&w.args.includes('-nostdin')));
 assert.equal(studio.busyChannel(ids[0]),true);
 await live.ingest(session.id,'0',chunk());
 for(const w of workers)assert.deepEqual(Buffer.concat(w.input),Buffer.concat([webmHeader(),Buffer.from('webm-chunk')]));
 assert.throws(()=>live.start(input(ids)),/already in use/);
 workers[0].stderr.write('Connection failed rtmp://127.0.0.1:9/live/LIVE-SECRET-0');workers[0].emit('close',1);
 assert.equal(studio.jobs.get(session.jobs[0].id).status,'error');
 await live.ingest(session.id,'1',chunk(Buffer.from('still-live')));
 assert.equal(workers[1].input.length,3);
 assert.ok(!JSON.stringify(studio.state()).includes('LIVE-SECRET'));
 assert.deepEqual(store.data.channels,before.channels);assert.deepEqual(store.data.playlists,before.playlists);assert.deepEqual(store.data.schedules,before.schedules);
 studio.stop(session.jobs[1].id);await studio.jobs.get(session.jobs[1].id).completion;
 assert.equal(workers[1].input.length,3); // Stop ends the binary pipe instead of inserting a text command.
 assert.equal(studio.busyChannel(ids[1]),false);
 assert.equal(store.data.history.filter(h=>h.kind==='session').length,2);
});
test('live capture rejects missing consent, invalid sources, duplicates and stream limits before starting',t=>{
 const {live,studio,ids,workers}=fixture(t);
 for(const extra of [{confirmed:false},{source:'file'},{channelIds:[ids[0],ids[0]]},{mimeType:'text/plain'},{aspect:'unknown'}])assert.throws(()=>live.start(input(ids,extra)));
 studio.store.update(s=>{s.settings.operations={maxConcurrent:1};});
 assert.throws(()=>live.start(input(ids)),/limit/);assert.equal(workers.length,0);
 studio.store.update(s=>{s.settings.operations={maxConcurrent:6};});
 studio.jobs.set('prerecorded',{id:'prerecorded',channelId:ids[0],status:'running',ended:null});
 assert.throws(()=>live.start(input(ids)),/already in use/);studio.jobs.delete('prerecorded');
});

test('deferred encoder startup failure releases every destination and removes the abandoned session',async t=>{
 const {live,studio,ids}=fixture(t);studio.spawnProcess=()=>{throw Error('spawn failed');};
 const session=live.start(input(ids));await assert.rejects(live.ingest(session.id,'0',chunk()));await Promise.all([...studio.jobs.values()].map(job=>job.completion));assert.equal(live.sessions.size,0);assert.ok([...studio.jobs.values()].every(job=>job.ended&&job.status==='error'));assert.ok(ids.every(id=>!studio.busyChannel(id)));
});

test('an unexpected clean live-worker exit reports a disconnected destination while other outputs continue',async t=>{
 const {live,studio,ids,workers}=fixture(t),session=live.start(input(ids));workers[0].emit('close',0);
 assert.equal(studio.jobs.get(session.jobs[0].id).status,'error');assert.match(studio.jobs.get(session.jobs[0].id).error,/disconnected/);assert.equal(studio.busyChannel(ids[0]),false);
 await live.ingest(session.id,'0',chunk());assert.equal(workers[1].input.length,2);assert.equal(studio.jobs.get(session.jobs[1].id).ended,null);
});

test('an unexpected clean shared-encoder exit reports interruption to every attached output',async t=>{
 const {studio,workers}=fixture(t),feeds=sharedFeedFixture(studio),{id}=feeds.create({confirmed:true,source:'camera',quality:'720p',aspect:'16:9'}),feed=feeds.get(id),errors=[];
 for(let i=0;i<2;i++)feeds.attach(id,new Writable({write(data,encoding,done){done();}}),error=>errors.push(error));
 workers[0].emit('close',0);await feed.completion;assert.equal(feeds.active.size,0);assert.equal(errors.length,2);assert.ok(errors.every(error=>/disconnected/.test(error)));
});
test('ordered uploads reject oversized, concurrent and out-of-order chunks; idle capture shuts down',async t=>{
 const {live,ids,studio}=fixture(t),session=live.start(input(ids));
 await assert.rejects(live.ingest(session.id,'2',chunk()),/in order/);
 const bad=chunk();bad.headers['content-length']=String(8*1024*1024+1);await assert.rejects(live.ingest(session.id,'0',bad),/too large/);
 const internal=live.sessions.get(session.id);internal.receiving=true;await assert.rejects(live.ingest(session.id,'0',chunk()),/in order/);internal.receiving=false;
 await live.ingest(session.id,'0',chunk());
 live.expire(Date.now()+21000);await Promise.all(session.jobs.map(j=>studio.jobs.get(j.id).completion));
 assert.ok(session.jobs.every(j=>studio.jobs.get(j.id).status==='error'));assert.equal(live.sessions.size,0);
});
test('live API uses authenticated same-origin CSRF protection for binary uploads and stop-all',async t=>{
 const f=fixture(t),app=await createApplication({directory:path.join(f.root,'api'),portableVault:true,clock:false,listen:false});t.after(()=>app.close());
 const workers=fakeWorkers();app.studio.spawnProcess=workers.spawnProcess;
 const ids=[app.studio.saveChannel({name:'Live',url:'rtmp://127.0.0.1:9/live',key:'HIDDEN'})];
 const headers={Cookie:`go_streams=${app.token}`,'X-Go-Streams':'1','Content-Type':'application/json'};
 const response=await dispatch(app,'/api/live/start',{method:'POST',headers,body:JSON.stringify(input(ids))});assert.equal(response.status,201);const {id}=await response.json();
 const url=`/api/live/${id}/chunks?sequence=0`,binary={method:'POST',headers:{...headers,'Content-Type':'video/webm'},bodyChunks:[Buffer.concat([webmHeader(),Buffer.from('binary')])]};
 assert.equal((await dispatch(app,url,{...binary,headers:{'Content-Type':'video/webm'}})).status,401);
 assert.equal((await dispatch(app,url,{...binary,headers:{...binary.headers,Origin:'https://foreign.test'}})).status,403);
 assert.equal((await dispatch(app,url,{...binary,headers:{Cookie:headers.Cookie,'Content-Type':'video/webm'}})).status,403);
 assert.equal((await dispatch(app,url,binary)).status,200);
 assert.equal((await dispatch(app,'/api/stop-all',{method:'POST',headers,body:'{}'})).status,200);
 await Promise.all([...app.studio.jobs.values()].map(j=>j.completion));assert.ok([...app.studio.jobs.values()].every(j=>j.status==='stopped'));
});
test('browser uploads stay ordered, stop on errors and bound retained video bytes',async()=>{
 const chunks=[],errors=[];let stops=0;
 const upload=new LiveUploader({limit:10,fetchChunk:async(blob,sequence)=>chunks.push([blob.size,sequence]),stopRemote:async()=>{stops++;},onError:e=>errors.push(e)});
 upload.push({size:3});upload.push({size:4});await upload.finish();assert.deepEqual(chunks,[[3,0],[4,1]]);assert.equal(upload.bytes,0);assert.equal(stops,1);
 const slow=new LiveUploader({limit:5,fetchChunk:async()=>{},stopRemote:async()=>{stops++;},onError:e=>errors.push(e)});
 slow.push({size:6});assert.equal(slow.closed,true);assert.equal(errors.length,1);assert.equal(slow.bytes,0);
 const failed=new LiveUploader({fetchChunk:async()=>{throw Error('offline');},stopRemote:async()=>{stops++;},onError:e=>errors.push(e)});
 failed.push({size:1});failed.push({size:1});await failed.pending;assert.equal(failed.closed,true);assert.equal(errors.at(-1).message,'offline');assert.equal(failed.bytes,0);
});

test('shared capture validates upload sizes before reading and isolates a stalled output',async t=>{
 const {studio,workers}=fixture(t),feeds=sharedFeedFixture(studio);
 studio.importingProject=true;assert.throws(()=>feeds.create({confirmed:true,source:'camera',quality:'720p',aspect:'16:9'}),/busy/);studio.importingProject=false;
 const {id}=feeds.create({confirmed:true,source:'camera',quality:'720p',aspect:'16:9'}),feed=feeds.get(id);
 for(const length of [String(8*1024*1024+1),'invalid']){const req=chunk();req.headers['content-length']=length;await assert.rejects(feeds.ingest(id,'0',req),error=>error.status===413);assert.equal(feed.sequence,0);assert.equal(feed.receiving,false);}
 const ended=[],good=[],stalled=new Writable({write(data,encoding,done){}});stalled.on('error',()=>{});
 feeds.attach(id,stalled,error=>ended.push(error));const receiver=new Writable({write(data,encoding,done){good.push(data.length);done();}});feeds.attach(id,receiver,error=>ended.push(error));
 workers[0].stdout.write(Buffer.alloc(4*1024*1024+1));workers[0].stdout.write(Buffer.from('next'));
 assert.equal(ended.length,1);assert.match(ended[0],/keep up/);assert.equal(feed.sinks.size,1);assert.deepEqual(good,[4*1024*1024+1,4]);
 stalled.destroy();await feeds.shutdown();assert.equal(feeds.active.size,0);assert.equal(ended.length,2);
});

test('late outputs start at a complete keyframe with program headers across split stdout chunks',async t=>{
 const {studio,workers}=fixture(t),feeds=sharedFeedFixture(studio),{id}=feeds.create({confirmed:true,source:'camera',quality:'720p',aspect:'16:9'});
 const packet=(pid,key=false)=>{const value=Buffer.alloc(188,0xff);value[0]=0x47;value[1]=0x40|(pid>>8);value[2]=pid&255;value[3]=key?0x30:0x10;if(key){value[4]=1;value[5]=0x40;}return value;};
 const pat=packet(0),pmt=packet(4096),first=packet(256,true),middle=packet(256),key=packet(256,true),audio=packet(257),received=[];
 workers[0].stdout.write(Buffer.concat([pat,pmt,first,middle]));
 const output=new Writable({write(data,encoding,done){received.push(Buffer.from(data));done();}});feeds.attach(id,output,()=>{});
 workers[0].stdout.write(middle.subarray(0,70));workers[0].stdout.write(middle.subarray(70));assert.equal(received.length,0);
 workers[0].stdout.write(Buffer.concat([pat,pmt,key.subarray(0,100)]));assert.equal(received.length,0);
 workers[0].stdout.write(Buffer.concat([key.subarray(100),audio.subarray(0,50)]));workers[0].stdout.write(audio.subarray(50));
 assert.deepEqual(Buffer.concat(received),Buffer.concat([pat,pmt,key,audio]));assert.equal(feeds.get(id).tables.size,2);assert.ok(feeds.get(id).tail.length<188);await feeds.shutdown();
});

test('late-output bootstrap preserves every TS byte for all subpacket stdout chunk sizes',async t=>{
 const {studio,workers}=fixture(t),feeds=sharedFeedFixture(studio),{id}=feeds.create({confirmed:true,source:'camera',quality:'720p',aspect:'16:9'}),feed=feeds.get(id);
 const packet=(pid,key=false)=>{const data=Buffer.alloc(188,0xff);data[0]=0x47;data[1]=0x40|(pid>>8);data[2]=pid&255;data[3]=key?0x30:0x10;if(key){data[4]=1;data[5]=0x40;}return data;};
 const middle=packet(256),source=Buffer.concat([packet(0),packet(4096),packet(256,true),packet(257)]);workers[0].stdout.write(middle);
 for(let size=1;size<188;size++){
  feed.tables.clear();const received=[],output=new Writable({write(data,encoding,done){received.push(Buffer.from(data));done();}}),detach=feeds.attach(id,output,()=>{});
  for(let offset=0;offset<source.length;offset+=size)workers[0].stdout.write(source.subarray(offset,offset+size));
  assert.deepEqual(Buffer.concat(received),source,'stdout chunk size '+size);assert.equal(feed.tail.length,0);detach();output.destroy();
 }
 await feeds.shutdown();
});

test('throwing shared-output callbacks cannot interrupt sibling output or encoder completion',async t=>{
 const {studio,workers}=fixture(t),feeds=sharedFeedFixture(studio),{id}=feeds.create({confirmed:true,source:'camera',quality:'720p',aspect:'16:9'}),feed=feeds.get(id),received=[],ended=[];
 try{
 const failed=new Writable({write(data,encoding,done){done();}});failed.destroy();
 feeds.attach(id,failed,()=>{throw Error('Output callback failed');});
 const callbackFailure=new Writable({write(data,encoding,done){done();}});
 feeds.attach(id,callbackFailure,()=>{throw Error('Output cleanup failed');},()=>{throw Error('Output accounting failed');});
 feeds.attach(id,new Writable({write(data,encoding,done){received.push(Buffer.from(data));done();}}),error=>ended.push(error));
 assert.doesNotThrow(()=>workers[0].stdout.write(Buffer.from('first')));assert.equal(Buffer.concat(received).toString(),'first');assert.equal(feed.sinks.size,1);
 feeds.attach(id,new Writable({write(data,encoding,done){done();}}),()=>{throw Error('Final callback failed');});
 assert.doesNotThrow(()=>workers[0].emit('close',0));await feed.completion;assert.equal(feed.sinks.size,0);assert.equal(ended.length,1);assert.match(ended[0],/disconnected/);
 }finally{feed.sinks.clear();feed.resolve();}
});

test('shared outputs detach on stream failure and release their listeners independently',async t=>{
 const {studio,workers}=fixture(t),feeds=sharedFeedFixture(studio),{id}=feeds.create({confirmed:true,source:'camera',quality:'720p',aspect:'16:9'}),feed=feeds.get(id),errors=[],received=[];
 const failed=new Writable({write(data,encoding,done){done();}}),good=new Writable({write(data,encoding,done){received.push(Buffer.from(data));done();}});
 const detach=feeds.attach(id,failed,error=>errors.push(error));feeds.attach(id,good,()=>{});
 assert.doesNotThrow(()=>failed.emit('error',Error('Disk full')));assert.equal(feed.sinks.size,1);assert.equal(errors.length,1);detach();assert.equal(failed.listenerCount('close'),0);assert.equal(failed.listenerCount('error'),0);
 workers[0].stdout.write(Buffer.from('continues'));assert.equal(Buffer.concat(received).toString(),'continues');await feeds.shutdown();await new Promise(resolve=>setImmediate(resolve));assert.equal(good.listenerCount('close'),0);assert.equal(good.listenerCount('error'),0);
});

test('a failed asynchronous sink write remains isolated through its subsequent error event',async t=>{
 const {studio,workers}=fixture(t),feeds=sharedFeedFixture(studio),{id}=feeds.create({confirmed:true,source:'camera',quality:'720p',aspect:'16:9'}),feed=feeds.get(id),received=[];let ended=0;
 feeds.attach(id,new Writable({write(data,encoding,done){setImmediate(()=>done(Error('Disk full')));}}),()=>{ended++;throw Error('Cleanup failed');});
 feeds.attach(id,new Writable({write(data,encoding,done){received.push(Buffer.from(data));done();}}),()=>{});
 workers[0].stdout.write(Buffer.from('first'));await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));
 assert.equal(ended,1);assert.equal(feed.sinks.size,1);workers[0].stdout.write(Buffer.from('second'));assert.equal(Buffer.concat(received).toString(),'firstsecond');await feeds.shutdown();
});

for(const ending of ['stop','close'])test('shared capture does not acknowledge an upload whose encoder '+ending+' occurs during its write',async t=>{
 const {studio,workers}=fixture(t),feeds=sharedFeedFixture(studio),{id}=feeds.create({confirmed:true,source:'camera',quality:'720p',aspect:'16:9'}),feed=feeds.get(id);let written;
 const worker=workers[0];worker.stdin.destroy();worker.stdin=new Writable({write(data,encoding,done){written=done;},final(done){done();queueMicrotask(()=>worker.emit('close',0));}});
 const upload=feeds.ingest(id,'0',chunk());while(!written)await new Promise(resolve=>setImmediate(resolve));if(ending==='stop')feeds.stop(id);else worker.emit('close',0);written();
 await assert.rejects(upload,error=>error.status===410);assert.equal(feed.sequence,0);await feed.completion;
});

test('shared capture keeps a pending sink error handled when the encoder closes first',async t=>{
 const {studio,workers}=fixture(t),feeds=sharedFeedFixture(studio),{id}=feeds.create({confirmed:true,source:'camera',quality:'720p',aspect:'16:9'}),feed=feeds.get(id);let written,ended=0;
 const output=new Writable({write(data,encoding,done){written=done;}}),guard=()=>{};
 feeds.attach(id,output,()=>{ended++;});workers[0].stdout.write(Buffer.from('last-frame'));assert.equal(typeof written,'function');
 workers[0].emit('close',0);await feed.completion;
 try{assert.equal(output.listenerCount('error'),1,'the pending write may still emit its error after encoder completion');}
 finally{output.on('error',guard);written(Error('Output closed while the last frame was pending'));await new Promise(resolve=>setImmediate(resolve));output.removeListener('error',guard);}
 assert.equal(ended,1);assert.equal(feed.sinks.size,0);assert.equal(output.listenerCount('error'),0);assert.equal(output.listenerCount('close'),0);
});
test('Electron capture permissions require the trusted main frame, consent and a selected source',async()=>{
 const ses={setPermissionCheckHandler(fn){this.check=fn;},setPermissionRequestHandler(fn){this.request=fn;},setDisplayMediaRequestHandler(fn){this.display=fn;}};
 const contents={mainFrame:{},isDestroyed:()=>false,getURL:()=>base+'/'},base='http://127.0.0.1:4317',source={id:'screen:1',name:'Screen'};let allowed=false;
 policy.wireCapturePermissions(ses,{contents,base,confirmMedia:async()=>allowed,getSources:async()=>[source],chooseSource:async()=>source,platform:'win32'});
 const ask=(wc,permission,details)=>new Promise(resolve=>ses.request(wc,permission,resolve,details));
 assert.equal(ses.check(contents,'media',base),false);
 assert.equal(await ask(contents,'media',{requestingUrl:base+'/',isMainFrame:true}),false);
 allowed=true;assert.equal(await ask(contents,'media',{requestingUrl:base+'/',isMainFrame:true}),true);assert.equal(ses.check(contents,'media',base),true);
 for(const details of [{requestingUrl:'https://evil.test',isMainFrame:true},{requestingUrl:base+'/',isMainFrame:false}])assert.equal(await ask(contents,'media',details),false);
 assert.equal(await ask(contents,'geolocation',{requestingUrl:base+'/'}),false);
 const display=extra=>new Promise(resolve=>ses.display({frame:contents.mainFrame,securityOrigin:base,userGesture:true,videoRequested:true,audioRequested:true,...extra},resolve));
 assert.equal(await display({userGesture:false}),null);assert.equal(await display({frame:{}}),null);
 assert.deepEqual(await display({}),{video:source,audio:'loopback'});
});
