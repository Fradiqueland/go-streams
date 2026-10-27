import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import {EventEmitter} from 'node:events';import {PassThrough,Writable} from 'node:stream';
import {Store,Studio,Vault,runProcess,probe} from '../src/core.mjs';
import {createApplication} from '../src/server.mjs';import {dispatch} from './transport.mjs';
const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});const root=fs.mkdtempSync(path.join(parent,'races-'));const video=path.join(root,'video.mp4');let media;
const gate=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
const until=async fn=>{const end=Date.now()+5000;while(!fn()){if(Date.now()>end)throw Error('Timeout');await new Promise(r=>setTimeout(r,5));}};
before(async()=>{await runProcess('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=30','-t','2','-c:v','libx264','-preset','ultrafast','-y',video]);media={...await probe(video,'ffprobe'),id:'m',title:'Clip'};});
after(()=>{if(!root.startsWith(parent+path.sep)||!path.basename(root).startsWith('races-'))throw Error('Unsafe cleanup');fs.rmSync(root,{recursive:true,force:true});});
function fixture(t,options={}){
 const children=[],store=new Store(fs.mkdtempSync(path.join(root,'data-')));
 const studio=new Studio(store,new Vault(store.directory,{portable:true}),{...options,spawnProcess:()=>{const c=new EventEmitter();c.stdout=new PassThrough();c.stderr=new PassThrough();c.stdin=new Writable({write(chunk,enc,done){done();}});c.kill=()=>c.emit('close',null);children.push(c);return c;}});
 t.after(async()=>{for(const c of children)c.emit('close',0);await studio.shutdown();});
 store.update(s=>s.media.push(media,{...media,id:'extra'}));const cid=studio.saveChannel({name:'Channel',url:'rtmp://127.0.0.1:9/live',key:'SECRET'});const pid=studio.savePlaylist({name:'Playlist',mediaIds:['m'],loop:true});
 return{studio,store,cid,pid,children};
}
function schedules(f){return [0,1].map(i=>f.studio.schedule({mediaId:'m',channelIds:[f.cid],at:new Date(Date.now()+10000+i).toISOString(),armed:true,confirmed:true,timeZone:'UTC'}));}
for(const action of ['disarm','delete','postpone'])test('scheduler rechecks '+action+' after another scheduled start awaited',async t=>{
 const f=fixture(t),[first,second]=schedules(f),hold=gate(),calls=[];
 f.studio.start=async input=>{calls.push(input);await hold.promise;return[{status:'running'}];};
 const pending=f.studio.tick(Date.parse(second.at));await until(()=>calls.length===1);
 if(action==='disarm')f.studio.arm(second.id,false,true);
 if(action==='delete')f.studio.remove('schedules',second.id);
 if(action==='postpone')f.studio.schedule({...second,at:'2099-01-01T00:00:00Z',confirmed:true},second.id);
 hold.resolve();await pending;assert.equal(calls.length,1);assert.equal(f.store.data.schedules.find(s=>s.id===first.id).status,'triggered');
});
test('overlapping scheduler ticks execute each due schedule once in order',async t=>{
 const f=fixture(t),items=schedules(f),hold=gate(),calls=[];f.studio.start=async input=>{calls.push(input);if(calls.length===1)await hold.promise;return[{status:'running'}];};
 const a=f.studio.tick(Date.parse(items[1].at));const b=f.studio.tick(Date.parse(items[1].at));assert.equal(a,b);assert.equal(calls.length,1);hold.resolve();await Promise.all([a,b]);assert.equal(calls.length,2);
});
test('stop during restart drain prevents any replacement process from launching',async t=>{
 const f=fixture(t);const [j]=await f.studio.start({playlistId:f.pid,channelIds:[f.cid],confirmed:true});const restarting=f.studio.restart(j.id,true);f.studio.stop(j.id);f.children[0].emit('close',0);await assert.rejects(restarting,/cancelado/);assert.equal(f.children.length,1);assert.equal(f.studio.jobs.get(j.id).status,'stopped');
});
test('two simultaneous restarts cannot race to reopen the same channel',async t=>{
 const f=fixture(t);const [j]=await f.studio.start({playlistId:f.pid,channelIds:[f.cid],confirmed:true});const restarting=f.studio.restart(j.id,true);await assert.rejects(f.studio.restart(j.id,true),/reiniciada/);f.children[0].emit('close',0);await restarting;assert.equal(f.children.length,2);
});
test('a queued candidate is protected from deletion throughout asynchronous reconfiguration',async t=>{
 const f=fixture(t);const [j]=await f.studio.start({playlistId:f.pid,channelIds:[f.cid],confirmed:true});const update=f.studio.reconfigure(j.id,{mediaIds:['m','extra'],confirmed:true});assert.throws(()=>f.studio.remove('media','extra'),/utilização/);f.studio.stop(j.id);f.children[0].emit('close',0);await assert.rejects(update);f.studio.remove('media','extra');assert.ok(!f.store.data.media.some(m=>m.id==='extra'));
});
test('concurrent imports recheck path identity after thumbnail generation',async t=>{
 const hold=gate();let atThumb=0;const f=fixture(t,{runMediaProcess:async()=>{atThumb++;await hold.promise;}});f.store.update(s=>s.media=[]);
 const a=f.studio.importMedia([video]),b=f.studio.importMedia([video]);await until(()=>atThumb===2);hold.resolve();const [one,two]=await Promise.all([a,b]);assert.deepEqual(one.imported,two.imported);assert.equal(f.store.data.media.length,1);
});
test('shutdown waits for an in-flight thumbnail and does not commit media afterwards',async t=>{
 const hold=gate();let atThumb=false;const f=fixture(t,{runMediaProcess:async()=>{atThumb=true;await hold.promise;}});f.store.update(s=>s.media=[]);
 const importing=f.studio.importMedia([video]);await until(()=>atThumb);let closed=false;const closing=f.studio.shutdown().then(()=>{closed=true;});await new Promise(r=>setImmediate(r));assert.equal(closed,false);hold.resolve();await Promise.all([closing,importing]);assert.equal(f.store.data.media.length,0);assert.equal(f.studio.pendingImports.size,0);
});
test('normalization reserves its source against removal until conversion completes',async t=>{
 const f=fixture(t);const normalizing=f.studio.normalize('extra');assert.throws(()=>f.studio.remove('media','extra'),/utilização/);await normalizing;f.studio.remove('media','extra');assert.equal(fs.existsSync(video),true);
});
test('JSON preserves multibyte channel names across arbitrary transport chunk boundaries',async t=>{
 const app=await createApplication({directory:fs.mkdtempSync(path.join(root,'api-')),listen:false,clock:false,portableVault:true});t.after(()=>app.close());
 const name='Música — Japão 🎵',bytes=Buffer.from(JSON.stringify({name,url:'rtmp://example.test/live',key:'SECRET'}));
 const response=await dispatch(app,'/api/channels',{method:'POST',headers:{Cookie:'go_streams='+app.token,'X-Go-Streams':'1','Content-Type':'application/json'},bodyChunks:Array.from(bytes,b=>Buffer.from([b]))});assert.equal(response.status,201);assert.equal(app.store.data.channels[0].name,name);
});
test('JSON size limit counts transmitted bytes rather than decoded character count',async t=>{
 const app=await createApplication({directory:fs.mkdtempSync(path.join(root,'api-')),listen:false,clock:false,portableVault:true});t.after(()=>app.close());
 const response=await dispatch(app,'/api/channels',{method:'POST',headers:{Cookie:'go_streams='+app.token,'X-Go-Streams':'1','Content-Type':'application/json'},body:JSON.stringify({name:'á'.repeat(530000)})});assert.equal(response.status,413);assert.equal(app.store.data.channels.length,0);
});

test('explicit detach removes every occurrence from idle playlists without deleting the source file',async t=>{
 const f=fixture(t);f.studio.savePlaylist({name:'Duplicates',mediaIds:['m','extra','m']});assert.throws(()=>f.studio.remove('media','m'),/playlists/);f.studio.remove('media','m',{detachFromPlaylists:true});assert.ok(f.store.data.playlists.every(p=>!p.mediaIds.includes('m')));assert.equal(fs.existsSync(video),true);assert.equal(f.store.data.playlists.at(-1).mediaIds[0],'extra');
});
test('detach refuses to empty scheduled playlists and preserves the entire project on failure',async t=>{
 const f=fixture(t);f.studio.schedule({playlistId:f.pid,channelIds:[f.cid],at:'2099-01-01T00:00:00Z'});const before=JSON.stringify(f.store.data);assert.throws(()=>f.studio.remove('media','m',{detachFromPlaylists:true}),/agendada/);assert.equal(JSON.stringify(f.store.data),before);
});
test('codec conversion keeps source resolution and fps instead of silently normalizing to 720p',async t=>{
 const f=fixture(t),input=path.join(f.store.directory,'legacy.avi');await runProcess('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=960x540:rate=60','-t','0.4','-c:v','mpeg4','-y',input]);const original=fs.readFileSync(input);
 const result=await f.studio.importMedia([input],{convert:true});assert.deepEqual(result.errors,[]);const output=f.store.data.media.find(m=>m.id===result.imported[0]);assert.equal(output.codec,'h264');assert.equal(output.width,960);assert.equal(output.height,540);assert.equal(output.fps,60);assert.equal(output.audio,null);assert.deepEqual(fs.readFileSync(input),original);
});
test('container-only conversion preserves decoded video frames',async t=>{
 const f=fixture(t),input=path.join(f.store.directory,'container.mkv');await runProcess('ffmpeg',['-v','error','-i',video,'-c','copy','-y',input]);const result=await f.studio.importMedia([input],{convert:true});assert.deepEqual(result.errors,[]);const output=f.store.data.media.find(m=>m.id===result.imported[0]);
 const hash=async file=>(await runProcess('ffmpeg',['-v','error','-i',file,'-map','0:v:0','-f','md5','-'])).stdout;
 assert.equal(await hash(input),await hash(output.path));assert.equal(output.width,media.width);assert.equal(output.fps,media.fps);
});

test('detach cannot remove playlist media during preflight before its playback context exists',async t=>{
 const f=fixture(t);const starting=f.studio.start({playlistId:f.pid,channelIds:[f.cid],confirmed:true});assert.throws(()=>f.studio.remove('media','m',{detachFromPlaylists:true}),/utilização/);for(const j of f.studio.jobs.values())f.studio.stop(j.id);await starting;assert.equal(f.children.length,0);
});
import {Downloads} from '../src/downloads.mjs';
test('shutdown during download validation never adds a completed file to the library',async t=>{
 const f=fixture(t);let process,args;const d=new Downloads(f.studio,{spawnProcess(command,argv){args=argv;process=new EventEmitter();process.stdout=new PassThrough();process.stderr=new PassThrough();return process;}});t.after(()=>d.shutdown());
 const item=d.start({url:'https://youtu.be/abcdefghijk',addToLibrary:true});const folder=args[args.indexOf('--paths')+1];fs.copyFileSync(video,path.join(folder,'video.mp4'));process.emit('close',0);assert.equal(f.store.data.downloads[0].status,'validating');await d.shutdown();assert.equal(f.store.data.downloads.find(x=>x.id===item.id).status,'cancelled');assert.equal(f.store.data.media.length,2);assert.equal(d.active.size,0);
});


test('conversion cancellation removes partial output, preserves originals and releases reservations',async t=>{
 let output,started=false;
 const f=fixture(t,{runTransformProcess:async(cmd,args,{signal})=>{output=args.at(-1);fs.writeFileSync(output,'partial');started=true;await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('Operação cancelada.')),{once:true}));}});
 const pending=f.studio.normalize('m');const rejected=assert.rejects(pending,/cancelada/);await until(()=>started);
 const op=f.studio.state().mediaOperations[0];assert.equal(op.phase,'converting');assert.equal(op.canCancel,true);assert.equal(op.title,'Clip');assert.equal(op.controller,undefined);
 assert.throws(()=>f.studio.remove('media','m'),/utilização/);f.studio.cancelMediaOperation('m');f.studio.cancelMediaOperation('m');
 assert.equal(f.studio.state().mediaOperations[0].phase,'cancelling');await rejected;
 assert.ok(fs.existsSync(video));assert.ok(!fs.existsSync(output));assert.equal(f.studio.pendingOperations.size,0);assert.equal(f.store.data.media.length,2);
 assert.throws(()=>f.studio.cancelMediaOperation('m'),/terminou/);
});
test('output-directory failure releases conversion slot and cannot hang shutdown',async t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.store.directory,'normalized'),'folder conflict');
 await assert.rejects(f.studio.normalize('m'));assert.equal(f.studio.pendingOperations.size,0);await f.studio.shutdown();assert.ok(fs.existsSync(video));
});
test('conversion cannot be cancelled after library incorporation starts',async t=>{
 const f=fixture(t,{runTransformProcess:async(cmd,args)=>fs.copyFileSync(video,args.at(-1))}),hold=gate();
 const original=f.studio.importMedia.bind(f.studio);let incorporating=false;
 f.studio.importMedia=async(...args)=>{incorporating=true;await hold.promise;return original(...args);};
 const pending=f.studio.normalize('m');await until(()=>incorporating);
 assert.equal(f.studio.state().mediaOperations[0].canCancel,false);assert.throws(()=>f.studio.cancelMediaOperation('m'),/incorporação/);
 hold.resolve();const result=await pending;assert.ok(f.store.data.media.some(m=>m.id===result.id));assert.ok(fs.existsSync(video));
});


test('actual FFmpeg conversion cancels through its AbortSignal without adding partial media',async t=>{
 let started=false,output;
 const f=fixture(t,{runTransformProcess:(command,args,options)=>{const paced=[...args];paced.splice(paced.indexOf('-i'),0,'-re');output=args.at(-1);started=true;return runProcess(command,paced,options);}});
 const pending=f.studio.normalize('m'),rejected=assert.rejects(pending,/cancelada/);await until(()=>started);await new Promise(r=>setTimeout(r,200));
 f.studio.cancelMediaOperation('m');await rejected;assert.ok(!fs.existsSync(output));assert.ok(fs.existsSync(video));assert.equal(f.store.data.media.length,2);assert.equal(f.studio.pendingOperations.size,0);
});


test('concurrent application close calls share completion and run each shutdown once',async()=>{
 const app=await createApplication({directory:fs.mkdtempSync(path.join(root,'close-')),listen:false,clock:false,portableVault:true});
 const hold=gate();let calls=0;const shutdown=app.studio.shutdown.bind(app.studio);app.studio.shutdown=async()=>{calls++;await hold.promise;await shutdown();};
 const first=app.close(),second=app.close();let secondDone=false;second.then(()=>{secondDone=true;});await new Promise(r=>setImmediate(r));
 try{assert.equal(secondDone,false);assert.equal(calls,1);}finally{hold.resolve();await Promise.all([first,second]);}
});
test('one shutdown failure still drains the remaining services and all close callers see the failure',async()=>{
 const app=await createApplication({directory:fs.mkdtempSync(path.join(root,'close-failure-')),listen:false,clock:false,portableVault:true});
 const hold=gate();let completed=false;const shutdown=app.studio.shutdown.bind(app.studio);app.studio.shutdown=async()=>{await hold.promise;await shutdown();completed=true;};
 app.updates.shutdown=()=>{throw Error('controlled failure');};
 const first=app.close(),second=app.close();const a=assert.rejects(first,/encerramento/),b=assert.rejects(second,/encerramento/);
 await new Promise(r=>setImmediate(r));hold.resolve();await Promise.all([a,b]);assert.equal(completed,true);assert.equal(app.notifications.closing,true);assert.equal(app.downloads.closing,true);
});

test('shutdown waits for project validation and prevents a late import from changing saved data',async t=>{
 const f=fixture(t),hold=gate(),before=structuredClone(f.store.data);let closed=false;
 f.studio.probeMedia=async()=>{await hold.promise;return media;};
 const importing=f.studio.importProject({version:1,media:[{id:'imported',title:'Imported clip',path:video}],channels:[],playlists:[],schedules:[]});
 const rejected=assert.rejects(importing,/cancelada/),closing=f.studio.shutdown().then(()=>{closed=true;});
 try{await new Promise(r=>setImmediate(r));assert.equal(closed,false,'shutdown must wait for the outstanding file probe');}
 finally{hold.resolve();await Promise.all([rejected,closing]);}
 assert.deepEqual(f.store.data,before);assert.equal(f.studio.pendingImports.size,0);assert.equal(f.studio.importingProject,false);
});


for(const phase of ['start','reconfigure'])test('shutdown drains outstanding '+phase+' validation before reporting completion',async t=>{
 const f=fixture(t),hold=gate();let probes=0,closed=false;
 let job;if(phase==='reconfigure')[job]=await f.studio.start({playlistId:f.pid,channelIds:[f.cid],confirmed:true});
 f.studio.probeMedia=async m=>{probes++;await hold.promise;return {...media,path:m.path};};
 const pending=phase==='start'?f.studio.start({playlistId:f.pid,channelIds:[f.cid],confirmed:true}):f.studio.reconfigure(job.id,{mediaIds:['m','extra'],confirmed:true});
 const outcome=pending.then(value=>({value}),error=>({error}));await until(()=>probes===1);
 const closing=f.studio.shutdown().then(()=>{closed=true;});for(const c of f.children)c.emit('close',0);
 try{await new Promise(r=>setImmediate(r));assert.equal(closed,false,'the file probe is still active');}
 finally{hold.resolve();await Promise.all([outcome,closing]);}
 assert.equal(probes,1);assert.equal(f.studio.pendingPreparations.size,0);assert.ok([...f.studio.jobs.values()].every(j=>j.ended));
 if(phase==='start')assert.equal(f.children.length,0);else assert.ok((await outcome).error);
});

test('stopping during preflight prevents checking later playlist entries',async t=>{
 const f=fixture(t),hold=gate();let probes=0;
 f.studio.savePlaylist({name:'Many',mediaIds:['m','extra','m']},f.pid);
 f.studio.probeMedia=async m=>{probes++;await hold.promise;return {...media,path:m.path};};
 const pending=f.studio.start({playlistId:f.pid,channelIds:[f.cid],confirmed:true});await until(()=>probes===1);
 for(const j of f.studio.jobs.values())f.studio.stop(j.id);hold.resolve();const result=await pending;
 assert.equal(probes,1);assert.equal(f.children.length,0);assert.equal(result[0].status,'stopped');
});
