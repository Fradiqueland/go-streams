import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable,Readable} from 'node:stream';
import {RemoteSources,sourceUrl,publicAddress,publicTarget,openRemote,mediaHeaders} from '../src/remote-sources.mjs';
import {createApplication} from '../src/server.mjs';
import {Store} from '../src/core.mjs';
import {dispatch} from './transport.mjs';
import {uiHarness} from './ui-harness.mjs';
const metadata={streams:[{codec_type:'video',codec_name:'h264',width:320,height:180,avg_frame_rate:'30/1',pix_fmt:'yuv420p',time_base:'1/15360'}],format:{duration:'2'}};
const execute=async()=>({stdout:JSON.stringify(metadata)});
function response(status=200,headers={},body='video'){return Object.assign(Readable.from([Buffer.from(body)]),{statusCode:status,headers:{'content-type':'video/mp4',...headers}});}
function sink(){const chunks=[];const s=new Writable({write(c,e,cb){chunks.push(c);cb();}});s.writeHead=(status,headers)=>{s.status=status;s.headers=headers;};s.body=()=>Buffer.concat(chunks).toString();return s;}
function child(){const p=new EventEmitter();p.stdout=new PassThrough();p.stderr=new PassThrough();p.stdin=new Writable({write(c,e,cb){cb();setImmediate(()=>p.emit('close',0));}});p.kill=()=>setImmediate(()=>p.emit('close',null));return p;}
async function fixture(t,options={}){
 const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});const root=fs.mkdtempSync(path.join(parent,'remote-'));
 const app=await createApplication({directory:root,listen:false,clock:false,portableVault:true,remoteOptions:{execute,...options}});
 t.after(async()=>{await app.close();if(!root.startsWith(parent+path.sep)||!path.basename(root).startsWith('remote-'))throw Error('Unsafe cleanup');fs.rmSync(root,{recursive:true,force:true});});
 const request=(url,body)=>dispatch(app,url,{method:body?'POST':'GET',headers:{Cookie:`go_streams=${app.token}`,'Content-Type':'application/json','X-Go-Streams':'1'},...(body?{body:JSON.stringify(body)}:{})});
 return {app,request};
}
test('source URLs preserve case, canonicalize YouTube and reject playlists, manifests and unsafe protocols',()=>{
 assert.deepEqual(sourceUrl('https://youtu.be/abcdefghijk?si=track'),{source:'youtube',path:'https://www.youtube.com/watch?v=abcdefghijk'});
 assert.equal(sourceUrl('https://cdn.example/A.mp4?token=Case').path,'https://cdn.example/A.mp4?token=Case');
 for(const url of ['file:///a.mp4','http://x/a.mp4','https://u:p@x/a.mp4','https://x:8443/a.mp4','https://x/a.m3u8','https://youtube.com/playlist?list=x','https://youtu.be/short','https://x/a.mp4\noption foo'])assert.throws(()=>sourceUrl(url));
});
test('network checks reject private, metadata, reserved and IPv6 addresses including DNS rebinding',async()=>{
 for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','172.16.1.1','192.168.1.1','100.64.0.1','198.18.0.1','224.0.0.1','0.0.0.0','::1','::ffff:8.8.8.8'])assert.equal(publicAddress(ip),false,ip);
 assert.equal(publicAddress('8.8.8.8'),true);
 await assert.rejects(publicTarget('https://cdn.test/a.mp4',async()=>[{address:'8.8.8.8'},{address:'127.0.0.1'}]),/Private/);
 let called=0;
 const request=(url,opts,cb)=>{called++;opts.lookup(url.hostname,{},(err,address)=>assert.equal(address,'8.8.8.8'));const r=new EventEmitter();r.setTimeout=()=>{};r.end=()=>cb(response(302,{location:'https://127.0.0.1/private.mp4'}));return r;};
 await assert.rejects(openRemote('https://cdn.test/a.mp4',{request,lookup:async host=>[{address:host==='cdn.test'?'8.8.8.8':'127.0.0.1'}]}),/Private/);assert.equal(called,1);
});
test('relay forwards ranges with backpressure, never follows webpages, and drops cookies',async()=>{
 let received;const remote=new RemoteSources({base:'http://127.0.0.1:4317',settings:()=>({}),execute,open:async(url,options)=>{received={url,options};return response(206,{'content-range':'bytes 2-4/8','set-cookie':'secret','content-length':'3'},'abc');}});
 const entry=remote.entry({path:'https://cdn.test/video.mp4'}),res=sink();await remote.serve({method:'GET',headers:{range:'bytes=2-4',cookie:'secret'}},res,entry);
 assert.equal(res.status,206);assert.equal(res.body(),'abc');assert.equal(received.options.range,'bytes=2-4');assert.equal(received.options.cookie,undefined);assert.equal(res.headers['set-cookie'],undefined);
 remote.open=async()=>response(200,{'content-type':'text/html'});await assert.rejects(remote.serve({method:'GET',headers:{}},sink(),entry),/MP4/);
 await remote.shutdown();assert.equal(remote.requests.size,0);
});
test('YouTube resolves without downloads, renews rejected signed links and keeps signatures out of stored metadata',async()=>{
 const commands=[],urls=[];let generation=0;
 const remote=new RemoteSources({base:'http://127.0.0.1:4317',settings:()=>({}),execute:async(command,args)=>{commands.push(args);return {stdout:JSON.stringify(args.includes('--dump-single-json')?{protocol:'https',ext:'mp4',url:`https://r.googlevideo.com/v?signature=${++generation}`,title:'Title',duration:2}:metadata)};},open:async url=>{urls.push(url);return response(url.endsWith('=1')?403:200);}});
 const media={path:'https://youtu.be/abcdefghijk'},meta=await remote.probe(media);assert.equal(meta.title,'Title');assert.equal(JSON.stringify(meta).includes('signature'),false);
 const res=sink();await remote.serve({method:'GET',headers:{}},res,remote.entry(media));assert.equal(res.status,200);assert.equal(generation,2);assert.equal(urls.length,2);
 assert.ok(commands[0].includes('--skip-download'));assert.ok(commands[0].includes('--ignore-config'));assert.ok(commands[0].includes('--no-plugin-dirs'));
 assert.ok(commands[1].includes('http,tcp'));assert.ok(commands[1].includes('mov'));await remote.shutdown();
});
test('live YouTube and resolution failures are rejected without exposing signed URLs',async()=>{
 const remote=new RemoteSources({base:'http://127.0.0.1:4317',settings:()=>({}),execute:async()=>({stdout:JSON.stringify({is_live:true,duration:12,url:'https://r.googlevideo.com/x?secret'})})});
 await assert.rejects(remote.probe({path:'https://youtu.be/abcdefghijk'}),e=>!e.message.includes('secret')&&/unavailable/.test(e.message));await remote.shutdown();
});
test('link import API persists references only, deduplicates, survives export/import and protects access',async t=>{
 const {app,request}=await fixture(t);const body={url:'https://cdn.test/Clip.mp4',title:'Remote <clip>'};
 assert.equal((await dispatch(app,'/api/media/link',{method:'POST',body:JSON.stringify(body)})).status,401);
 const first=await request('/api/media/link',body);assert.equal(first.status,201);const {id}=await first.json();
 assert.equal((await (await request('/api/media/link',body)).json()).id,id);assert.equal(app.store.data.media.length,1);
 const saved=new Store(app.store.directory).data.media[0];assert.equal(saved.path,body.url);assert.equal(saved.source,'https');assert.equal(saved.size,0);assert.equal(saved.thumbnail,false);
 assert.deepEqual(fs.readdirSync(path.join(app.store.directory,'thumbs')),[]);assert.ok(!fs.existsSync(path.join(app.store.directory,'downloads')));
 const backup=await (await request('/api/export')).json();assert.equal((await app.studio.importProject(backup)).media,0);
 await assert.rejects(app.studio.normalize(id),/local file/);
 assert.equal((await request('/source/'+'0'.repeat(64))).status,404);
 const r=app.studio.remoteSources,relay=new URL(r.input(saved)).pathname;
 r.open=async()=>response(206,{'content-range':'bytes 0-4/5','content-length':'5'},'video');
 const streamed=await dispatch(app,relay,{headers:{Range:'bytes=0-4'}});assert.equal(streamed.status,206);assert.equal(await streamed.text(),'video');
 assert.equal((await dispatch(app,relay,{headers:{Origin:'https://foreign.test'}})).status,403);
 const asset=await request(`/api/media/${id}`);assert.equal(asset.status,206);
});
test('remote playlist uses safe relay inputs for playback, pause/resume, loop, retry and stop',async t=>{
 const {app}=await fixture(t);const studio=app.studio,spawned=[];studio.retryDelays=[1];studio.spawnProcess=(cmd,args)=>{const p=child();spawned.push({p,args});return p;};
 const {id}=await studio.importRemote({url:'https://cdn.test/v.mp4'});const pid=studio.savePlaylist({name:'Remote loop',mediaIds:[id,id],loop:true});
 const cid=studio.saveChannel({name:'Offline',url:'rtmp://127.0.0.1:9/live',key:'SECRET'});
 const [start]=await studio.start({playlistId:pid,channelIds:[cid],confirmed:true,autoReconnect:true});const job=studio.jobs.get(start.id);
 const manifest=fs.readFileSync(job.manifest,'utf8');assert.ok(manifest.includes('/source/'));assert.ok(!manifest.includes('cdn.test'));assert.match(manifest,/option protocol_whitelist http,tcp/);assert.match(manifest,/option format_whitelist mov/);assert.match(manifest,/duration 2/);assert.ok(spawned[0].args.includes('-stream_loop'));
 studio.pause(job.id);await new Promise(r=>setImmediate(r));assert.equal(job.status,'paused');studio.resume(job.id,true);assert.equal(spawned.length,2);
 spawned[1].p.stderr.write('Connection timed out http://127.0.0.1:4317/source/private');spawned[1].p.emit('close',1);
 assert.equal(job.status,'retrying');assert.ok(!job.error.includes('source/private'));await new Promise(r=>setTimeout(r,20));assert.equal(spawned.length,3);
 studio.stop(job.id);await job.completion;assert.equal(job.status,'stopped');assert.equal(fs.existsSync(job.manifest),false);
});
test('production Add video link button submits to API and distinguishes online media without conversion',async t=>{
 const {app}=await fixture(t);const h=uiHarness({fetch:(url,init={})=>dispatch(app,url,{...init,headers:{Cookie:'go_streams='+app.token,...init.headers}})});await h.run('refresh(false)');
 h.run("page='media';draw()");assert.doesNotMatch(h.element('#content').innerHTML,/data-action="import-link"/);
 await h.click('import');assert.match(h.element('#dialog-content').innerHTML,/type="button"[^>]*data-action="import-link"/);
 await h.click('import-link');await h.submit({urls:'https://cdn.test/video.mp4',title:'Online <test>'});assert.equal(app.store.data.media.length,1);
 h.run("page='media';draw()");assert.match(h.element('#content').innerHTML,/Online · sem cópia local/);assert.match(h.element('#content').innerHTML,/Online &lt;test&gt;/);
 h.run("page='tools';draw()");assert.ok(!h.element('#content').innerHTML.includes('<option value="'+app.store.data.media[0].id+'">'));
});

test('failed remote validation leaves the project intact and pending probes are bounded and cancelled at shutdown',async t=>{
 let release;const gate=new Promise(r=>{release=r;});let active=0;
 const {app}=await fixture(t,{execute:async(command,args,{signal})=>{active++;await Promise.race([gate,new Promise((resolve,reject)=>{if(signal.aborted)reject(Error());else signal.addEventListener('abort',()=>reject(Error()),{once:true});})]);return{stdout:JSON.stringify(metadata)};}});
 const one=app.studio.importRemote({url:'https://cdn.test/1.mp4'}),two=app.studio.importRemote({url:'https://cdn.test/2.mp4'});
 const settled=Promise.allSettled([one,two]);await new Promise(r=>setImmediate(r));assert.equal(active,2);
 await assert.rejects(app.studio.importRemote({url:'https://cdn.test/3.mp4'}),/Wait/);
 await app.close();assert.ok((await settled).every(r=>r.status==='rejected'));assert.equal(app.store.data.media.length,0);assert.equal(app.studio.pendingImports.size,0);release();
});

test('remote preflight preserves a user title and rejects incompatible playlist media before launching',async t=>{
 const {app}=await fixture(t);let spawns=0;app.studio.spawnProcess=()=>{spawns++;return child();};
 const {id}=await app.studio.importRemote({url:'https://cdn.test/v.mp4',title:'Chosen title'});
 assert.equal((await app.studio.probeMedia(app.store.data.media[0])).title,'Chosen title');
 const second=await app.studio.importRemote({url:'https://cdn.test/v2.mp4'});
 const probe=app.studio.probeMedia.bind(app.studio);app.studio.probeMedia=async m=>({...await probe(m),width:m.id===id?320:640});
 const pid=app.studio.savePlaylist({name:'Mismatch',mediaIds:[id,second.id]});
 await assert.rejects(app.studio.start({playlistId:pid,preview:true}),/matching formats/);assert.equal(spawns,0);
});

test('YouTube chooses progressive HTTPS MP4 and retains only safe required media headers',async()=>{
 let command,received;
 const remote=new RemoteSources({base:'http://127.0.0.1:4317',settings:()=>({}),execute:async(tool,args)=>{command=args;return {stdout:JSON.stringify({protocol:'https',ext:'mp4',duration:5,url:'https://r.googlevideo.com/x',http_headers:{'User-Agent':'Required player','Referer':'https://www.youtube.com/','Cookie':'PRIVATE','Authorization':'Bearer PRIVATE','Host':'localhost','Accept-Encoding':'gzip'}})};},open:async(url,options)=>{received=options;return response();}});
 await remote.serve({method:'GET',headers:{}},sink(),remote.entry({path:'https://youtu.be/abcdefghijk'}));
 assert.match(command[command.indexOf('-f')+1],/\[protocol=https\]/);
 assert.deepEqual(received.headers,{'user-agent':'Required player',referer:'https://www.youtube.com/'});
 assert.deepEqual(mediaHeaders({'User-Agent':'bad\r\nHost: localhost',Referer:'http://127.0.0.1/',Origin:'https://user:password@youtube.com','X-Secret':'private'}),{});
 await remote.shutdown();
});
test('HLS results cannot masquerade as a combined MP4 and never reach the relay',async()=>{
 let opened=false;
 const remote=new RemoteSources({base:'http://127.0.0.1:4317',settings:()=>({}),execute:async()=>({stdout:JSON.stringify({protocol:'m3u8_native',ext:'mp4',duration:5,url:'https://manifest.googlevideo.com/playlist.m3u8'})}),open:async()=>{opened=true;return response();}});
 await assert.rejects(remote.probe({path:'https://youtu.be/abcdefghijk'}),/YouTube source unavailable/);assert.equal(opened,false);await remote.shutdown();
});
test('remote DNS resolution is bounded and cancellation does not wait for a stuck resolver',async()=>{
 const pending=()=>new Promise(()=>{});
 await assert.rejects(publicTarget('https://cdn.test/video.mp4',pending,{timeout:10}),/timed out/);
 const controller=new AbortController();const work=publicTarget('https://cdn.test/video.mp4',pending,{signal:controller.signal});const rejected=assert.rejects(work,/cancelled/);controller.abort();await rejected;
});
test('upstream requests preserve approved User-Agent with pinned DNS and fixed transfer encoding',async()=>{
 let options;
 const stream=await openRemote('https://cdn.test/video.mp4',{lookup:async()=>[{address:'8.8.8.8'}],headers:{'User-Agent':'Required player','Accept-Encoding':'gzip','Authorization':'private'},request:(url,opts,cb)=>{options=opts;const req=new EventEmitter();req.setTimeout=()=>{};req.end=()=>cb(response());return req;}});
 assert.equal(options.headers['user-agent'],'Required player');assert.equal(options.headers['accept-encoding'],'identity');assert.equal(options.headers.Authorization,undefined);stream.destroy();
});


test('batch link import keeps successful videos, retries only failures, deduplicates and processes sequentially',async t=>{
 const {app}=await fixture(t);let active=0,peak=0;const calls=[];
 const h=uiHarness({fetch:async(url,init={})=>{
   if(url!=='/api/media/link')return dispatch(app,url,{...init,headers:{Cookie:'go_streams='+app.token,...init.headers}});
   calls.push(JSON.parse(init.body));active++;peak=Math.max(peak,active);
   try{await new Promise(resolve=>setImmediate(resolve));return await dispatch(app,url,{...init,headers:{Cookie:'go_streams='+app.token,...init.headers}});}
   finally{active--;}
 }});
 await h.click('import');await h.click('import-link');
 await h.submit({urls:' https://cdn.test/a.mp4 \r\n\r\nhttps://cdn.test/bad.m3u8\nhttps://cdn.test/b.mp4\nhttps://cdn.test/a.mp4',title:'Only for one video'});
 assert.equal(peak,1);assert.equal(calls.length,3);assert.ok(calls.every(call=>call.title===''));
 assert.deepEqual(app.store.data.media.map(m=>m.path),['https://cdn.test/a.mp4','https://cdn.test/b.mp4']);
 assert.equal(h.element('#dialog').open,true);assert.equal(h.element('textarea[name=urls]').value,'https://cdn.test/bad.m3u8');
 assert.equal(h.element('#modal-form .form-error').hidden,false);
 assert.match(h.element('#modal-form .form-error').textContent,/2 ligações disponíveis/);
 assert.match(h.element('#modal-form .form-progress').textContent,/3\/3/);
 const originalIds=app.store.data.media.map(m=>m.id);
 await h.submit({urls:'https://cdn.test/c.mp4',title:'Corrected video'});
 assert.equal(app.store.data.media.length,3);assert.deepEqual(app.store.data.media.slice(0,2).map(m=>m.id),originalIds);
 assert.equal(app.store.data.media[2].title,'Corrected video');assert.equal(h.element('#dialog').open,false);
 await h.click('import');await h.click('import-link');
 await h.submit({urls:'https://cdn.test/a.mp4\nhttps://cdn.test/b.mp4',title:''});
 assert.equal(app.store.data.media.length,3);assert.deepEqual(app.store.data.media.slice(0,2).map(m=>m.id),originalIds);
});

test('batch link validation rejects empty and oversized lists before any network import',async()=>{
 const h=uiHarness();await h.click('import');await h.click('import-link');
 for(const urls of [' \r\n ',Array.from({length:101},(_,i)=>`https://cdn.test/${i}.mp4`).join('\n')]){
   await h.submit({urls,title:''});
   assert.equal(h.requests.filter(r=>r.url==='/api/media/link').length,0);
   assert.equal(h.element('#modal-form .form-error').hidden,false);
   assert.match(h.element('#modal-form .form-error').textContent,/1 e 100/);
   assert.equal(h.element('#dialog').open,true);
 }
});

test('simultaneous readers reuse a renewed YouTube link when an older request is rejected late',async()=>{
 let generation=0,oldReads=0,releaseOld;const late=new Promise(resolve=>{releaseOld=resolve;});
 const remote=new RemoteSources({base:'http://127.0.0.1:4317',settings:()=>({}),execute:async()=>({stdout:JSON.stringify({protocol:'https',ext:'mp4',duration:2,url:'https://r.googlevideo.com/video?generation='+ ++generation})}),open:async url=>{
  if(url.endsWith('=1')){if(++oldReads===2)await late;return response(403);}return response();
 }});
 const entry=remote.entry({path:'https://youtu.be/abcdefghijk'});await remote.resolve(entry);
 const a=sink(),b=sink(),first=remote.serve({method:'GET',headers:{}},a,entry),second=remote.serve({method:'GET',headers:{}},b,entry);
 try{await first;assert.equal(generation,2);releaseOld();await second;assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(generation,2,'the second reader must reuse the already refreshed link');}
 finally{releaseOld();await Promise.allSettled([first,second]);await remote.shutdown();}
});

test('shutdown cancels shared YouTube resolution and releases every waiting relay request',async()=>{
 let calls=0,ready;const started=new Promise(resolve=>{ready=resolve;});
 const remote=new RemoteSources({base:'http://127.0.0.1:4317',settings:()=>({}),execute:async(command,args,{signal})=>{calls++;ready();return new Promise((resolve,reject)=>{if(signal.aborted)reject(Error('cancelled'));else signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true});});},open:async()=>assert.fail('No upstream media should open')});
 const entry=remote.entry({path:'https://youtu.be/abcdefghijk'}),requests=[remote.serve({method:'GET',headers:{}},sink(),entry),remote.serve({method:'GET',headers:{}},sink(),entry)],settled=Promise.allSettled(requests);
 await started;await remote.shutdown();assert.equal(calls,1);assert.ok((await settled).every(r=>r.status==='rejected'));assert.equal(remote.requests.size,0);assert.equal(remote.entries.size,0);
});
