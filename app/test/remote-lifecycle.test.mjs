import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough,Readable,Writable} from 'node:stream';
import {EventEmitter} from 'node:events';
import {RemoteSources,openRemote} from '../src/remote-sources.mjs';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
function response(statusCode=200,headers={},body='video') {return Object.assign(Readable.from([Buffer.from(body)]),{statusCode,headers:{'content-type':'video/mp4',...headers}});}
function sink(){const res=new Writable({write(chunk,encoding,done){done();}});res.writeHead=(status,headers)=>{res.status=status;res.headers=headers;};return res;}
function remote(options={}){return new RemoteSources({base:'http://127.0.0.1:4317',settings:()=>({}),execute:async()=>{throw Error('No external tools');},...options});}
const request=(range)=>({method:'GET',headers:range?{range}:{}});

test('a disconnected reader releases its slot while another reader keeps shared YouTube resolution',async()=>{
 const gate=deferred();let resolutions=0,opened=0,firstSettled=false;
 const sources=remote({execute:async()=>{resolutions++;await gate.promise;return{stdout:JSON.stringify({protocol:'https',ext:'mp4',duration:2,url:'https://r.googlevideo.com/test'})};},open:async()=>{opened++;return response();}});
 const entry=sources.entry({path:'https://youtu.be/abcdefghijk'}),first=sink(),second=sink();
 const a=sources.serve(request(),first,entry).then(()=>({ok:true}),error=>({error})).finally(()=>{firstSettled=true;});
 const b=sources.serve(request(),second,entry);
 try{await tick();first.destroy();await tick();assert.equal(firstSettled,true);assert.equal(sources.requests.size,1);assert.equal(resolutions,1);gate.resolve();assert.ok((await a).error);await b;assert.equal(second.status,200);assert.equal(opened,1);}
 finally{gate.resolve();await Promise.allSettled([a,b]);await sources.shutdown();}
});

test('shutdown cancels an active relay pipeline and waits for its read slot and streams to close',async()=>{
 const upstream=Object.assign(new PassThrough(),{statusCode:200,headers:{'content-type':'video/mp4'}});
 const sources=remote({open:async()=>upstream}),destination=sink(),entry=sources.entry({path:'https://cdn.test/file.mp4'});
 const work=sources.serve(request(),destination,entry),outcome=work.then(()=>({ok:true}),error=>({error}));
 try{await tick();assert.equal(destination.status,200);await sources.shutdown();assert.equal(upstream.destroyed,true);assert.equal(destination.destroyed,true);assert.equal(sources.requests.size,0);assert.ok((await outcome).error);}
 finally{upstream.destroy();destination.destroy();await outcome;await sources.shutdown();}
});

test('disconnect during upstream opening returns immediately and destroys an eventual late response',async()=>{
 const gate=deferred();let settled=false;const upstream=response();
 const sources=remote({open:async()=>{await gate.promise;return upstream;}}),destination=sink(),entry=sources.entry({path:'https://cdn.test/file.mp4'});
 const work=sources.serve(request(),destination,entry).then(()=>({ok:true}),error=>({error})).finally(()=>{settled=true;});
 try{await tick();destination.destroy();await tick();assert.equal(settled,true);assert.equal(sources.requests.size,0);gate.resolve();await work;await tick();assert.equal(upstream.destroyed,true);}
 finally{gate.resolve();await work;await sources.shutdown();}
});

for(const range of ['bytes=9-2','bytes=-0','bytes=9007199254740992-'])test('invalid byte range '+range+' is rejected before any upstream request',async()=>{
 let opened=0;const sources=remote({open:async()=>{opened++;return response();}}),entry=sources.entry({path:'https://cdn.test/file.mp4'});
 try{await assert.rejects(sources.serve(request(range),sink(),entry),error=>error.status===416);assert.equal(opened,0);assert.equal(sources.requests.size,0);}
 finally{await sources.shutdown();}
});

for(const headers of [{},{'content-range':'bytes 4-2/8'},{'content-range':'bytes 0-2/2'},{'content-range':'bytes 1-3/8','content-length':'3'}])test('invalid partial upstream headers '+JSON.stringify(headers)+' are rejected instead of corrupting seeks',async()=>{
 const sources=remote({open:async()=>response(206,headers,'abc')}),entry=sources.entry({path:'https://cdn.test/file.mp4'});
 try{await assert.rejects(sources.serve(request('bytes=2-4'),sink(),entry),error=>error.status===502);assert.equal(sources.requests.size,0);}
 finally{await sources.shutdown();}
});

test('valid suffix, open-ended and end-clipped partial reads retain headers and complete successfully',async()=>{
 for(const [range,contentRange,body] of [['bytes=-3','bytes 5-7/8','abc'],['bytes=2-','bytes 2-4/*','abc'],['bytes=2-99','bytes 2-7/8','abcdef']]){
  const sources=remote({open:async()=>response(206,{'content-range':contentRange,'content-length':String(body.length)},body)}),entry=sources.entry({path:'https://cdn.test/file.mp4'}),destination=sink();
  try{await sources.serve(request(range),destination,entry);assert.equal(destination.status,206);assert.equal(destination.headers['content-range'],contentRange);assert.equal(destination.writableFinished,true);assert.equal(sources.requests.size,0);}
  finally{await sources.shutdown();}
 }
});

for(const body of ['ab','abcd'])test('chunked partial body with '+body.length+' bytes cannot silently complete a three-byte range',async()=>{
 const upstream=response(206,{'content-range':'bytes 2-4/8'},body),sources=remote({open:async()=>upstream}),entry=sources.entry({path:'https://cdn.test/file.mp4'}),destination=sink();
 try{await assert.rejects(sources.serve(request('bytes=2-4'),destination,entry),error=>error.status===502);assert.equal(destination.writableFinished,false);assert.equal(destination.destroyed,true);assert.equal(upstream.destroyed,true);assert.equal(sources.requests.size,0);}
 finally{await sources.shutdown();}
});

test('remote request deadline bounds a connection that never receives a socket timeout or headers',async()=>{
 let destroyed=false;
 const work=openRemote('https://cdn.test/file.mp4',{timeout:15,lookup:async()=>[{address:'8.8.8.8'}],request:()=>{const req=new EventEmitter();req.setTimeout=()=>{};req.end=()=>{};req.destroy=error=>{destroyed=true;req.emit('error',error);};return req;}});
 await assert.rejects(work,/timed out/);assert.equal(destroyed,true);
});

test('remote request abort releases a connecting request even when its transport ignores the signal',async()=>{
 const controller=new AbortController(),ready=deferred();let destroyed=false;
 const work=openRemote('https://cdn.test/file.mp4',{signal:controller.signal,lookup:async()=>[{address:'8.8.8.8'}],request:()=>{const req=new EventEmitter();req.setTimeout=()=>{};req.end=()=>ready.resolve();req.destroy=error=>{destroyed=true;req.emit('error',error);};return req;}});
 const rejected=assert.rejects(work,/cancelled/);await ready.promise;controller.abort();await rejected;assert.equal(destroyed,true);
});
