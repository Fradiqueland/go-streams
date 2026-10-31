import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {Store,Studio,Vault} from '../src/core.mjs';

function gate(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
function fixture(t){
 const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});const directory=fs.mkdtempSync(path.join(parent,'shutdown-review-'));
 const children=[],store=new Store(directory),studio=new Studio(store,new Vault(directory,{portable:true}),{spawnProcess(){
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();
  child.stdin=new Writable({write(chunk,encoding,done){done();setImmediate(()=>child.emit('close',0));}});
  child.kill=()=>child.emit('close',null);children.push(child);return child;
 }});
 studio.probeMedia=async media=>media;
 store.update(data=>data.media.push({id:'clip',title:'Local clip',path:path.join(directory,'clip.mp4'),duration:4,width:320,height:180,fps:30,codec:'h264',audio:null}));
 const channel=studio.saveChannel({name:'Local channel',url:'rtmp://127.0.0.1:9/live',key:'test-secret'});
 t.after(async()=>{for(const child of children)child.emit('close',0);await studio.shutdown().catch(()=>{});assert.ok(directory.startsWith(parent+path.sep));fs.rmSync(directory,{recursive:true,force:true});});
 return {studio,channel};
}

for(const asynchronous of [false,true])test('nested service shutdown '+(asynchronous?'rejection':'throw')+' still stops streams and drains every sibling',async t=>{
 const {studio,channel}=fixture(t),[started]=await studio.start({mediaId:'clip',channelIds:[channel],confirmed:true});
 const job=studio.jobs.get(started.id),held=gate(),calls=[];
 for(const name of ['chat','recordings','feeds','liveCapture','remoteSources'])studio[name]={shutdown(){calls.push(name);if(name==='chat'){if(asynchronous)return Promise.reject(Error('controlled nested failure'));throw Error('controlled nested failure');}return name==='recordings'?held.promise:Promise.resolve();}};
 let settled=false;const closing=studio.shutdown().then(()=>{settled=true;return null;},error=>{settled=true;return error;});
 try{
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls,['chat','recordings','feeds','liveCapture','remoteSources']);
  assert.equal(settled,false,'a failed service must not skip draining the slow recording service');
  assert.ok(['stopping','stopped'].includes(job.status));
 }finally{held.resolve();await closing;}
 const error=await closing;assert.ok(error instanceof AggregateError);assert.match(error.errors[0].message,/controlled nested failure/);
 assert.equal(job.status,'stopped');assert.equal(studio.busyChannel(channel),false);
});

test('concurrent Studio shutdown callers share the full drain and run nested shutdown once',async t=>{
 const {studio}=fixture(t),held=gate();let calls=0;
 studio.recordings={shutdown(){calls++;return held.promise;}};
 const first=studio.shutdown(),second=studio.shutdown();
 try{assert.equal(first,second);await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);}
 finally{held.resolve();await Promise.all([first,second]);}
});
