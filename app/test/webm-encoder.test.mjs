import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {spawn} from 'node:child_process';
import {WebmEncoder,webmVideoColor,MAX_WEBM_HEADER_BYTES} from '../src/webm-encoder.mjs';
import {ebmlElement,webmHeader} from './webm-fixture.mjs';

test('WebM inspection restores explicit VP8 full and limited range and leaves missing or unknown tags automatic',()=>{
 for(const [range,expected]of [[2,'full'],[1,'limited']])assert.equal(webmVideoColor(webmHeader({range,matrix:1})).filter,`setparams=range=${expected}:colorspace=bt709`);
 for(const range of [undefined,0,3,99])assert.equal(webmVideoColor(webmHeader({range,matrix:2})).filter,'');
 assert.equal(webmVideoColor(webmHeader({matrix:5})).filter,'setparams=colorspace=bt470bg');
 assert.equal(webmVideoColor(webmHeader({range:2,matrix:99})).filter,'setparams=range=full');
 assert.equal(webmVideoColor(webmHeader({codec:'V_VP9',range:2,matrix:1})).filter,'');
 assert.equal(webmVideoColor(webmHeader({documentType:'webm\0',codec:'V_VP8\0',range:2})).filter,'setparams=range=full');
 for(const suffix of ['x','x\0y','x'.repeat(200)]){
  const padded=webmVideoColor(webmHeader({documentType:'webm\0'+suffix,codec:'V_VP8\0'+suffix,range:2,matrix:1}));
  assert.equal(padded.codec,'V_VP8');assert.equal(padded.filter,'setparams=range=full:colorspace=bt709');
 }
 const empty=webmVideoColor(webmHeader({videoExtra:ebmlElement('55b0',Buffer.concat([ebmlElement('55b1'),ebmlElement('55b9')]))}));
 assert.equal(empty.matrix,2);assert.equal(empty.range,0);assert.equal(empty.filter,'');
});

test('WebM inspection handles every header split and ignores colour-looking bytes outside Colour elements',()=>{
 const header=webmHeader({range:1,matrix:1,videoExtra:ebmlElement('ec',Buffer.from('55b9810255b18105','hex'))});
 for(let end=0;end<header.length;end++)assert.equal(webmVideoColor(header.subarray(0,end)),null,'Header split '+end);
 assert.equal(webmVideoColor(Buffer.concat([header,Buffer.from('55b9810255b18105','hex')])).filter,'setparams=range=limited:colorspace=bt709');
});

test('WebM inspection rejects malformed, oversized and conflicting metadata without following arbitrary nesting',()=>{
 for(const bytes of [Buffer.from([0]),webmHeader({documentType:'wrong'}),webmHeader({trackExtra:ebmlElement('83',1)}),webmHeader({videoExtra:ebmlElement('55b0',ebmlElement('55b9',2)),range:1}),Buffer.concat([webmHeader().subarray(0,17),Buffer.from('1654ae6bff','hex')])])assert.throws(()=>webmVideoColor(bytes));
 const huge=Buffer.concat([webmHeader().subarray(0,17),Buffer.from('ec300000','hex')]);assert.throws(()=>webmVideoColor(huge));
 const nested=ebmlElement('ec',Buffer.alloc(40000,0xe0));assert.equal(webmVideoColor(webmHeader({videoExtra:nested})).filter,'');
});

function fixture({hold=false,spawnFailure=false}={}){
 const launched=[],writes=[],errors=[],inputErrors=[],closes=[];let pending;
 const proxy=new WebmEncoder(filter=>{
  launched.push(filter);if(spawnFailure)throw Error('spawn failed');
  const worker=new EventEmitter();worker.stdout=new PassThrough();worker.stderr=new PassThrough();
  worker.stdin=new Writable({write(data,_encoding,done){writes.push(Buffer.from(data));if(hold)pending=done;else done();},final(done){done();queueMicrotask(()=>worker.emit('close',0));}});
  worker.kill=()=>{worker.stdin.destroy();queueMicrotask(()=>worker.emit('close',1));return true;};return worker;
 });
 proxy.on('error',error=>errors.push(error));proxy.stdin.on('error',error=>inputErrors.push(error));proxy.on('close',code=>closes.push(code));
 const closed=new Promise(resolve=>proxy.once('close',resolve));
 return {proxy,launched,writes,errors,inputErrors,closes,closed,release:()=>{const done=pending;pending=undefined;done?.();}};
}
const write=(stream,data)=>new Promise((resolve,reject)=>stream.write(data,error=>error?reject(error):resolve()));

test('incremental header inspection preserves every input byte, backpressure and stable output streams',async()=>{
 const f=fixture({hold:true}),header=webmHeader({range:2,matrix:1}),before=header.subarray(0,10),rest=Buffer.concat([header.subarray(10),Buffer.from('first-frame')]),output=[];
 f.proxy.stdout.on('data',data=>output.push(Buffer.from(data)));await write(f.proxy.stdin,before);assert.equal(f.launched.length,0);
 let acknowledged=false;const pending=write(f.proxy.stdin,rest).then(()=>{acknowledged=true;});await Promise.resolve();assert.equal(acknowledged,false);assert.deepEqual(f.launched,['setparams=range=full:colorspace=bt709']);
 const later=write(f.proxy.stdin,Buffer.from('next-frame'));assert.equal(f.writes.length,1);f.release();await pending;f.release();await later;
 f.proxy.worker.stdout.write('encoded-output');f.proxy.stdin.end();await f.closed;
 assert.equal(Buffer.concat(f.writes).toString('hex'),Buffer.concat([before,rest,Buffer.from('next-frame')]).toString('hex'));assert.equal(Buffer.concat(output).toString(),'encoded-output');assert.deepEqual(f.closes,[0]);assert.equal(f.errors.length,0);
});

test('empty cancellation closes once without spawning, while truncated metadata fails and retains the accepted prefix',async()=>{
 const empty=fixture();empty.proxy.stdin.end();await empty.closed;assert.equal(empty.launched.length,0);assert.deepEqual(empty.closes,[0]);assert.equal(empty.errors.length,0);
 const truncated=fixture(),prefix=webmHeader().subarray(0,11);await write(truncated.proxy.stdin,prefix);truncated.proxy.stdin.end();await truncated.closed;await new Promise(resolve=>setImmediate(resolve));
 assert.equal(truncated.launched.length,0);assert.equal(truncated.errors.length,1);assert.equal(truncated.inputErrors.length,1);assert.deepEqual(truncated.closes,[1]);assert.deepEqual(truncated.proxy.recoveryInput,prefix);
});

test('malformed and oversized metadata stops once with bounded retained data',async()=>{
 for(const data of [Buffer.from([0]),Buffer.concat([webmHeader().subarray(0,17),Buffer.from('ec20100000','hex'),Buffer.alloc(MAX_WEBM_HEADER_BYTES+10)])]){
  const f=fixture();await assert.rejects(write(f.proxy.stdin,data));await f.closed;assert.equal(f.launched.length,0);assert.equal(f.errors.length,1);assert.deepEqual(f.closes,[1]);assert.ok(f.proxy.recoveryInput.length<=MAX_WEBM_HEADER_BYTES);
 }
});

test('kill before metadata completes never starts a late worker and closes only once',async()=>{
 const f=fixture(),header=webmHeader();await write(f.proxy.stdin,header.subarray(0,10));f.proxy.kill();await f.closed;await assert.rejects(write(f.proxy.stdin,header.subarray(10)));f.proxy.kill();assert.equal(f.launched.length,0);assert.deepEqual(f.closes,[1]);
});

test('worker startup failures and kills during a blocked write settle without orphaned callbacks',async()=>{
 const failed=fixture({spawnFailure:true});await assert.rejects(write(failed.proxy.stdin,webmHeader()),/spawn failed/);await failed.closed;assert.equal(failed.errors.length,1);assert.deepEqual(failed.closes,[1]);
 const blocked=fixture({hold:true});const pending=write(blocked.proxy.stdin,webmHeader());const rejected=assert.rejects(pending);blocked.proxy.kill();blocked.release();await rejected;await blocked.closed;assert.deepEqual(blocked.closes,[1]);
});

test('a worker error followed by stream failure and repeated close events is reported exactly once',async()=>{
 const f=fixture();await write(f.proxy.stdin,webmHeader());const worker=f.proxy.worker;
 worker.emit('error',Error('worker unavailable'));worker.stdin.emit('error',Error('pipe closed'));worker.emit('close',1);worker.emit('close',1);await f.closed;await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.errors.length,1);assert.deepEqual(f.closes,[1]);assert.equal(f.proxy.stdin.destroyed,true);assert.equal(f.proxy.kill(),false);
});

test('asynchronous process startup failure retains the header fragments already acknowledged',async()=>{
 const header=webmHeader({range:2,matrix:1}),errors=[],closes=[],proxy=new WebmEncoder(()=>spawn('gostreams-test-missing-encoder-593af851',[],{windowsHide:true,stdio:['pipe','pipe','pipe']}));
 proxy.on('error',error=>errors.push(error));proxy.stdin.on('error',()=>{});proxy.on('close',code=>closes.push(code));const closed=new Promise(resolve=>proxy.once('close',resolve));
 await write(proxy.stdin,header.subarray(0,10));await assert.rejects(write(proxy.stdin,header.subarray(10)));await closed;
 assert.equal(errors.length,1);assert.equal(errors[0].code,'ENOENT');assert.equal(closes.length,1);assert.notEqual(closes[0],0);assert.deepEqual(proxy.recoveryInput,header);
});
