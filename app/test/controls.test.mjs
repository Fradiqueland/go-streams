import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import {EventEmitter} from 'node:events';import {PassThrough,Writable} from 'node:stream';import {spawn} from 'node:child_process';
import {Store,Studio,Vault,probe,runProcess} from '../src/core.mjs';
import {Downloads} from '../src/downloads.mjs';import {paginate} from '../public/studio-ui.js';
const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});const root=fs.mkdtempSync(path.join(parent,'controls-')),video=path.join(root,'clip.mp4');let media;const closers=[];
before(async()=>{await runProcess('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=30','-t','4','-c:v','libx264','-preset','ultrafast','-y',video]);media={...await probe(video,'ffprobe'),id:'a',title:'Clip'};});
after(async()=>{for(const close of closers.toReversed())await close();if(!root.startsWith(parent+path.sep)||!path.basename(root).startsWith('controls-'))throw Error('Unsafe cleanup');fs.rmSync(root,{recursive:true,force:true});});
function child(){const c=new EventEmitter();c.stdout=new PassThrough();c.stderr=new PassThrough();c.stdin=new Writable({write(data,encoding,done){done();setImmediate(()=>c.emit('close',0));}});c.kill=()=>setImmediate(()=>c.emit('close',null));return c;}
function setup(options={}){const children=[],calls=[];const store=new Store(fs.mkdtempSync(path.join(root,'data-')));const studio=new Studio(store,new Vault(store.directory,{portable:true}),{spawnProcess:(cmd,args,opts)=>{calls.push(args);const c=options.real?spawn(cmd,[...args.slice(0,args.indexOf('-rw_timeout')),'-f','null','-'],opts):child();children.push(c);return c;}});closers.push(()=>studio.shutdown());store.update(s=>s.media.push(media,{...media,id:'b',title:'Second'},{...media,id:'c',title:'Third'}));const channelId=studio.saveChannel({name:'Channel',platform:options.platform||'Personalizado',url:'rtmp://127.0.0.1:9/live',key:'SECRET'});const playlistId=studio.savePlaylist({name:'Sequence',mediaIds:['a','b'],loop:true});return {studio,store,children,calls,channelId,playlistId,start:()=>studio.start({playlistId,channelIds:[channelId],confirmed:true})};}
async function until(check,ms=5000){const end=Date.now()+ms;while(!check()){if(Date.now()>end)throw Error('Timed out');await new Promise(r=>setTimeout(r,10));}}
test('channel preparation persists without emitting and requires a separate confirmed start',async()=>{const f=setup();f.studio.saveChannelPlan(f.channelId,{mediaId:'a',countdown:0,autoRestart:true});assert.equal(f.children.length,0);assert.equal(new Store(f.store.directory).data.channelPlans[f.channelId].mediaId,'a');await assert.rejects(f.studio.startChannelPlan(f.channelId),/Confirme/);const [j]=await f.studio.startChannelPlan(f.channelId,{confirmed:true});assert.equal(j.autoRestart,true);assert.throws(()=>f.studio.saveChannelPlan(f.channelId,{mediaId:'b'}),/Termine/);f.studio.stop(j.id);await f.studio.jobs.get(j.id).completion;f.studio.remove('channels',f.channelId);assert.equal(f.store.data.channelPlans[f.channelId],undefined);});
test('policies can change on a running session without reopening its process',async()=>{const f=setup();const [j]=await f.start();const updated=await f.studio.reconfigure(j.id,{endOnVideoFailure:false,pauseOnDisconnect:true});assert.equal(updated.endOnVideoFailure,false);assert.equal(updated.pauseOnDisconnect,true);assert.equal(f.children.length,1);await assert.rejects(f.studio.reconfigure(j.id,{autoRestart:false}),/Confirme/);});
test('queue editing preserves the current and played prefix, elapsed time and channel reservation',async()=>{const f=setup();const [j]=await f.start();f.children[0].stdout.write('frame=10\nout_time_us=1000000\n');await assert.rejects(f.studio.reconfigure(j.id,{mediaIds:['b','a'],confirmed:true}),/Preserve/);const updated=await f.studio.reconfigure(j.id,{mediaIds:['a','c','b'],confirmed:true});assert.deepEqual(updated.queue.map(m=>m.id),['a','c','b']);assert.equal(updated.elapsed,1);assert.equal(updated.current.mediaId,'a');assert.ok(f.calls[1].includes('1.000000'));assert.equal(f.studio.busyChannel(f.channelId),true);assert.deepEqual(f.store.data.playlists[0].mediaIds,['a','b']);assert.throws(()=>f.studio.remove('media','c'),/utilização/);});
test('reconfiguration after several loops keeps elapsed monotonic and the correct current position',async()=>{const f=setup();const [j]=await f.start();f.children[0].stdout.write('frame=20\nout_time_us=17000000\n');const updated=await f.studio.reconfigure(j.id,{mediaIds:['a','c','b'],autoRestart:false,confirmed:true});assert.equal(updated.elapsed,17);assert.equal(updated.current.offset,1);assert.ok(f.calls[1].includes('1.000000'));assert.ok(!f.calls[1].includes('-stream_loop'));f.children[1].stdout.write('frame=1\nout_time_us=5000000\n');const state=f.studio.publicJob(f.studio.jobs.get(j.id));assert.equal(state.elapsed,22);assert.equal(state.current.mediaId,'c');assert.equal(state.current.offset,2);});
test('updating a paused queue preserves pause and does not emit until resumed',async()=>{const f=setup();const [j]=await f.start();f.children[0].stdout.write('frame=10\nout_time_us=1000000\n');f.studio.pause(j.id);await until(()=>f.studio.jobs.get(j.id).status==='paused');const updated=await f.studio.reconfigure(j.id,{mediaIds:['a','c'],confirmed:true});assert.equal(updated.status,'paused');assert.equal(f.children.length,1);f.studio.resume(j.id,true);assert.equal(f.children.length,2);});
test('stop during queue validation prevents a replacement process from starting',async()=>{const f=setup();const [j]=await f.start();const updating=f.studio.reconfigure(j.id,{mediaIds:['a','c'],confirmed:true});f.studio.stop(j.id);await assert.rejects(updating,/mudou|terminou/);assert.equal(f.children.length,1);assert.equal(f.studio.jobs.get(j.id).status,'stopped');});
test('a current-video change while draining rejects stale queue edits and leaves a safe pause',async()=>{const f=setup();const [j]=await f.start();f.children[0].stdout.write('frame=10\nout_time_us=3000000\n');f.children[0].stdin=new Writable({write(data,enc,done){done();f.children[0].stdout.write('out_time_us=4100000\n');setImmediate(()=>f.children[0].emit('close',0));}});await assert.rejects(f.studio.reconfigure(j.id,{mediaIds:['a','c'],confirmed:true}),/cancelada/);assert.equal(f.studio.jobs.get(j.id).status,'paused');assert.equal(f.children.length,1);assert.deepEqual(f.studio.publicJob(f.studio.jobs.get(j.id)).queue.map(m=>m.id),['a','b']);});
test('restricted profiles reject in-session queue replacement without changing the job',async()=>{for(const platform of ['Facebook','Restream']){const f=setup({platform});const [j]=await f.start();await assert.rejects(f.studio.reconfigure(j.id,{mediaIds:['a','c'],confirmed:true}),/perfil/);assert.equal(f.children.length,1);}});
test('actual FFmpeg replaces a queue into an offline sink and continues from its position',{timeout:30000},async()=>{const f=setup({real:true});const [j]=await f.start();const job=f.studio.jobs.get(j.id);await until(()=>job.elapsed>.3,15000);const before=job.elapsed;await f.studio.reconfigure(j.id,{mediaIds:['a','b','c'],confirmed:true});assert.equal(f.children.length,2);const resumedAt=job.elapsed;assert.ok(resumedAt>=before);await until(()=>job.status==='running'&&job.elapsed>resumedAt+.3,15000);assert.equal(job.status,'running');assert.ok(f.calls[1].includes('-ss'));f.studio.stop(j.id);await job.completion;assert.equal(job.status,'stopped');});
test('downloads can remain separate, preview and later import exactly once',async()=>{const f=setup();let proc,args;const d=new Downloads(f.studio,{spawnProcess(cmd,a){args=a;proc=child();return proc;}});closers.push(()=>d.shutdown());const item=d.start({url:'https://youtu.be/abcdefghijk',addToLibrary:false});const folder=args[args.indexOf('--paths')+1];fs.copyFileSync(video,path.join(folder,'video.mp4'));proc.stdout.write('TITLE:Downloaded\n');proc.emit('close',0);await until(()=>!d.active.size);assert.equal(f.store.data.downloads[0].status,'completed');assert.equal(f.store.data.media.length,3);assert.ok(fs.existsSync(d.file(item.id)));const first=await d.addToLibrary(item.id),second=await d.addToLibrary(item.id);assert.equal(first.id,second.id);assert.equal(f.store.data.media.length,4);assert.equal(f.store.data.media.at(-1).title,'Downloaded');d.remove(item.id);assert.ok(fs.existsSync(path.join(folder,'video.mp4')));});
test('pagination never loses or duplicates rows and clamps stale page selections',()=>{const rows=Array.from({length:27},(_,i)=>i);const pages=[1,2,3].flatMap(page=>paginate(rows,{page,size:10}).rows);assert.deepEqual(pages,rows);assert.equal(paginate(rows,{page:99,size:10}).page,3);assert.equal(paginate([],{page:99}).start,0);assert.equal(paginate(rows,{size:-5}).size,10);});
import {createApplication} from '../src/server.mjs';
import {dispatch} from './transport.mjs';
test('new API routes preserve plans through export/import and enforce explicit transmission intent',async()=>{const app=await createApplication({directory:fs.mkdtempSync(path.join(root,'api-')),listen:false,clock:false,portableVault:true});try{app.store.update(s=>s.media.push(media));let launches=0;app.studio.spawnProcess=()=>{launches++;return child();};const channel=app.studio.saveChannel({name:'API channel',url:'rtmp://127.0.0.1:9/live',key:'SECRET'});const req=(url,body,method='POST')=>dispatch(app,app.base+url,{method:body===undefined?'GET':method,headers:{Cookie:'go_streams='+app.token,'Content-Type':'application/json','X-Go-Streams':'1'},...(body===undefined?{}:{body:JSON.stringify(body)})});assert.equal((await req('/api/channels/'+channel+'/plan',{mediaId:'a',countdown:0},'PUT')).status,200);assert.equal(launches,0);assert.equal((await req('/api/channels/'+channel+'/start',{})).status,400);const backup=await(await req('/api/export')).json();assert.equal(backup.channelPlans[channel].mediaId,'a');const f=setup();await f.studio.importProject(backup);const imported=f.store.data.channels.find(c=>c.name==='API channel');assert.equal(f.store.data.channelPlans[imported.id].mediaId,'a');assert.equal(f.children.length,0);const res=await req('/api/channels/'+channel+'/start',{confirmed:true});assert.equal(res.status,200);const id=(await res.json()).jobs[0].id;const update=await req('/api/jobs/'+id+'/configuration',{endOnVideoFailure:false},'PUT');assert.equal(update.status,200);assert.equal((await update.json()).endOnVideoFailure,false);assert.equal(launches,1);const invalid={...backup,channelPlans:{[channel]:{mediaId:'missing'}}};const before=JSON.stringify(f.store.data);await assert.rejects(f.studio.importProject(invalid),/Preparação/);assert.equal(JSON.stringify(f.store.data),before);}finally{await app.close();}});
test('disabling recovery cancels an already queued retry and preserves the paused channel',async()=>{const f=setup();f.studio.retryDelays=[100];const [j]=await f.start();await f.studio.reconfigure(j.id,{autoReconnect:true});f.children[0].stderr.write('Connection refused');f.children[0].emit('close',1);assert.equal(f.studio.jobs.get(j.id).status,'retrying');const updated=await f.studio.reconfigure(j.id,{autoReconnect:false});assert.equal(updated.status,'paused');await new Promise(r=>setTimeout(r,150));assert.equal(f.children.length,1);assert.equal(f.studio.busyChannel(f.channelId),true);});


test('editing cannot empty a scheduled playlist and emptying an unscheduled one clears its prepared plans',async()=>{
 const f=setup();f.studio.saveChannelPlan(f.channelId,{playlistId:f.playlistId});
 const schedule=f.studio.schedule({playlistId:f.playlistId,channelIds:[f.channelId],at:'2099-01-01T12:00:00Z',timeZone:'UTC',confirmed:true});
 const before=JSON.stringify(f.store.data);
 assert.throws(()=>f.studio.savePlaylist({name:'Empty',mediaIds:[]},f.playlistId),/agendada/);
 assert.equal(JSON.stringify(f.store.data),before);
 f.studio.remove('schedules',schedule.id);
 f.studio.savePlaylist({name:'Empty',mediaIds:[]},f.playlistId);
 assert.equal(f.store.data.channelPlans[f.channelId],undefined);
 assert.equal(f.store.data.playlists.find(p=>p.id===f.playlistId).mediaIds.length,0);
});


test('renaming an active playlist changes its label without changing the queue or process',async()=>{
 const f=setup();const [j]=await f.start();const before=f.calls.length,queue=f.studio.publicJob(f.studio.jobs.get(j.id)).queue;
 f.studio.renamePlaylist(f.playlistId,'New programme');assert.equal(f.calls.length,before);
 assert.equal(f.store.data.playlists.find(p=>p.id===f.playlistId).name,'New programme');assert.equal(f.studio.jobs.get(j.id).playlistName,'New programme');assert.equal(f.studio.contexts.get(j.id).playlist.name,'New programme');
 assert.deepEqual(f.studio.publicJob(f.studio.jobs.get(j.id)).queue,queue);
 assert.throws(()=>f.studio.savePlaylist({name:'Attempt',mediaIds:['a']},f.playlistId),/Pare/);
 const saved=JSON.stringify(f.store.data);assert.throws(()=>f.studio.renamePlaylist(f.playlistId,'  '));assert.throws(()=>f.studio.renamePlaylist('missing','Valid'));assert.equal(JSON.stringify(f.store.data),saved);
});


test('playlist rename during preflight keeps the label coherent when the context is created',async()=>{
 const f=setup(),starting=f.start();f.studio.renamePlaylist(f.playlistId,'During preflight');const [job]=await starting;
 assert.equal(f.studio.jobs.get(job.id).playlistName,'During preflight');assert.equal(f.studio.contexts.get(job.id).playlist.name,'During preflight');assert.equal(f.children.length,1);
});


for(const automatic of [true,false])test('removing download history preserves duplicate protection for '+(automatic?'automatic':'manual')+' library imports',async()=>{
 const f=setup();let proc,args;const downloads=new Downloads(f.studio,{spawnProcess(command,argv){args=argv;proc=child();return proc;}});closers.push(()=>downloads.shutdown());
 const item=downloads.start({url:'https://youtu.be/abcdefghijk',addToLibrary:automatic});const folder=args[args.indexOf('--paths')+1];fs.copyFileSync(video,path.join(folder,'video.mp4'));proc.emit('close',0);await until(()=>!downloads.active.size);
 if(!automatic)await downloads.addToLibrary(item.id);
 const saved=f.store.data.downloads.find(d=>d.id===item.id),imported=f.store.data.media.find(m=>m.id===saved.mediaId);assert.ok(imported);
 const before=fs.readFileSync(imported.path);downloads.remove(item.id);
 assert.throws(()=>downloads.start({url:'https://www.youtube.com/watch?v=abcdefghijk&feature=share'}),/descarregado/);
 assert.equal(downloads.active.size,0);assert.equal(f.store.data.downloads.length,0);assert.deepEqual(fs.readFileSync(imported.path),before);
 assert.equal(imported.downloadUrl,'https://www.youtube.com/watch?v=abcdefghijk');
});

test('existing completed downloads acquire origin metadata without copying their local files',()=>{
 const f=setup();f.store.update(s=>s.downloads=[{id:'old-download',status:'completed',url:'https://youtu.be/abcdefghijk',path:video,mediaId:'a'}]);
 const downloads=new Downloads(f.studio);closers.push(()=>downloads.shutdown());
 assert.equal(f.store.data.media.find(m=>m.id==='a').downloadUrl,'https://www.youtube.com/watch?v=abcdefghijk');downloads.remove('old-download');
 assert.throws(()=>downloads.start({url:'https://youtu.be/abcdefghijk'}),/descarregado/);assert.ok(fs.existsSync(video));
});


test('a missing downloaded source does not permanently prevent downloading it again',()=>{
 const f=setup(),file=path.join(f.store.directory,'missing-download.mp4');fs.copyFileSync(video,file);
 f.store.update(s=>{s.media.push({...media,id:'downloaded',path:file});s.downloads=[{id:'old',status:'completed',url:'https://youtu.be/abcdefghijk',path:file,mediaId:'downloaded'}];});
 const downloads=new Downloads(f.studio,{spawnProcess(){throw Error('Controlled offline transport');}});closers.push(()=>downloads.shutdown());downloads.remove('old');fs.unlinkSync(file);
 const result=downloads.start({url:'https://youtu.be/abcdefghijk'});assert.equal(result.status,'error');assert.equal(f.store.data.downloads.length,1);assert.equal(downloads.active.size,0);assert.ok(fs.existsSync(video));
});
