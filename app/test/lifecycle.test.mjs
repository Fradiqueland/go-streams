import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { spawn } from 'node:child_process';
import { Store, Studio, Vault, probe, runProcess, playbackPosition } from '../src/core.mjs';
import { createApplication } from '../src/server.mjs';
import { dispatch } from './transport.mjs';

const parent = path.resolve('.tmp'); fs.mkdirSync(parent, { recursive: true });
const root = fs.mkdtempSync(path.join(parent, 'lifecycle-'));
const video = path.join(root, 'local.mp4'); let meta;
const studios = [];
before(async () => {
  await runProcess('ffmpeg', ['-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=30','-t','4','-c:v','libx264','-preset','ultrafast','-y',video]);
  meta = { ...await probe(video, 'ffprobe'), id: 'video', title: 'Local clip' };
});
after(async () => {
  await Promise.all(studios.map(s => s.shutdown()));
  if (!path.resolve(root).startsWith(parent + path.sep) || !path.basename(root).startsWith('lifecycle-')) throw Error('Unsafe cleanup');
  fs.rmSync(root, { recursive: true, force: true });
});
function setup(options = {}) {
  const children = [], calls = [];
  const spawnProcess = (command,args) => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.stdin = new Writable({ write(chunk, enc, done) { done(); setImmediate(() => child.emit('close', 0)); } });
    child.kill = () => child.emit('close', null); children.push(child); calls.push(args); return child;
  };
  const store = new Store(fs.mkdtempSync(path.join(root,'studio-')));
  const studio = new Studio(store, new Vault(store.directory, { portable: true }), { spawnProcess, ...options }); studios.push(studio);
  store.update(s => s.media.push(meta));
  const channelId = studio.saveChannel({ name: 'Local', url: 'rtmp://127.0.0.1:9/live', key: 'PRIVATE-KEY' });
  const playlistId = studio.savePlaylist({ name: 'Loop', mediaIds: ['video','video'], loop: true });
  return { studio, channelId, playlistId, children, calls, start: () => studio.start({ channelIds: [channelId], playlistId, confirmed: true, autoReconnect: options.autoReconnect }) };
}
async function until(condition, limit = 5000) {
  const end = Date.now()+limit;
  while (!condition()) { if (Date.now()>end) throw Error('Timed out waiting for lifecycle'); await new Promise(r => setTimeout(r,10)); }
}
test('playback position handles duplicate clips, boundaries and looping', () => {
  const media = [meta,meta];
  assert.equal(playbackPosition(media,4,true).index,1);
  assert.equal(playbackPosition(media,9.25,true).offset,1.25);
  assert.equal(playbackPosition(media,20,false).offset,4);
});
test('pause preserves position and reservations; resume seeks and requires consent', async () => {
  const f=setup(); const [result]=await f.start(); const job=f.studio.jobs.get(result.id);
  f.children[0].stdout.write('frame=20\nout_time_us=5250000\n');
  f.studio.pause(job.id); await until(()=>job.status==='paused');
  assert.equal(job.elapsed,5.25); assert.equal(f.studio.state().jobs[0].current.index,1);
  assert.throws(()=>f.studio.resume(job.id,false),/Confirme/);
  assert.throws(()=>f.studio.savePlaylist({name:'Changed',mediaIds:['video']},f.playlistId),/Pare/);
  await assert.rejects(f.start(),/já está a transmitir/);
  f.studio.resume(job.id,true); assert.equal(f.calls[1][f.calls[1].indexOf('-ss')+1],'5.250000');
  f.children[1].stdout.write('frame=1\nout_time_us=1000000\n'); assert.equal(job.elapsed,6.25);
  assert.ok(!JSON.stringify(f.studio.state()).includes('PRIVATE-KEY'));
  f.studio.stop(job.id); await job.completion; assert.equal(job.status,'stopped');
});
test('retry policy is bounded, retains position and redacts keys in each attempt', async () => {
  const f=setup({autoReconnect:true,retryDelays:[5,5,5]}); const [r]=await f.start(); const j=f.studio.jobs.get(r.id);
  for(let attempt=0;attempt<4;attempt++) {
    await until(()=>f.children.length===attempt+1);
    f.children[attempt].stdout.write('frame=1\nout_time_us=500000\n');
    f.children[attempt].stderr.write('failure rtmp://127.0.0.1:9/live/PRIVATE-KEY');
    f.children[attempt].emit('close',1);
  }
  await j.completion; assert.equal(j.status,'error'); assert.equal(j.retries,3); assert.equal(f.children.length,4);
  assert.equal(j.elapsed,2); assert.ok(!JSON.stringify(f.studio.state()).includes('PRIVATE-KEY'));
  assert.equal(f.studio.contexts.size,0);
});
test('stop cancels a queued reconnect and releases the channel', async () => {
  const f=setup({autoReconnect:true,retryDelays:[100]}); const [r]=await f.start(); const j=f.studio.jobs.get(r.id);
  f.children[0].emit('close',1); assert.equal(j.status,'retrying');
  f.studio.stop(j.id); await j.completion;
  await new Promise(r=>setTimeout(r,120)); assert.equal(f.children.length,1); assert.equal(f.studio.busyChannel(f.channelId),false);
});
test('pause during reconnect cancels the timer; shutdown completes paused sessions', async () => {
  const f=setup({autoReconnect:true,retryDelays:[100]}); const [r]=await f.start(); const j=f.studio.jobs.get(r.id);
  f.children[0].emit('close',1); f.studio.pause(j.id); assert.equal(j.status,'paused');
  await f.studio.shutdown(); await j.completion; assert.equal(j.status,'stopped'); assert.equal(j.nextRetry,null);
});
test('stop during preflight never launches a process', async () => {
  const f=setup(); const starting=f.start(); const j=[...f.studio.jobs.values()][0];
  f.studio.stop(j.id); await starting; assert.equal(f.children.length,0); assert.equal(j.status,'stopped');
});
test('real FFmpeg pauses and resumes a loop to an offline null sink using input seek', {timeout:30000}, async () => {
  const calls=[];
  const f=setup({spawnProcess(command,args,options) {
    calls.push(args); const dest=args.indexOf('-rw_timeout'); assert.ok(dest>0);
    return spawn(command,[...args.slice(0,dest),'-f','null','-'],options);
  }});
  const [r]=await f.start(); const j=f.studio.jobs.get(r.id);
  await until(()=>j.elapsed>0.5,15000); f.studio.pause(j.id); await until(()=>j.status==='paused');
  const position=j.elapsed; assert.ok(position>0);
  f.studio.resume(j.id,true); assert.ok(calls[1].includes('-ss'));
  await until(()=>j.elapsed>position+0.3,15000); f.studio.stop(j.id); await j.completion;
  assert.equal(j.status,'stopped'); assert.equal(j.error,'');
});
test('channels validate public links and prevent duplicate stream credentials', () => {
  const f=setup();
  assert.throws(()=>f.studio.saveChannel({name:'Duplicate',url:'rtmp://127.0.0.1:9/live/',key:'PRIVATE-KEY'}),/já estão configurados/);
  for(const link of ['javascript:alert(1)','file:///C:/test','https://user:pass@example.com']) assert.throws(()=>f.studio.saveChannel({name:'Bad',url:'rtmp://localhost/live',key:'x',channelUrl:link}));
  f.studio.saveChannel({name:'Links',url:'rtmp://localhost/live',key:'x',channelUrl:'https://example.com/channel',producerUrl:'https://example.com/studio'});
  assert.equal(f.studio.state().channels[1].producerUrl,'https://example.com/studio');
});
test('schedule preserves timezone and reconnect intent; rejects invalid timezone', () => {
  const f=setup(); const input={playlistId:f.playlistId,channelIds:[f.channelId],at:new Date(Date.now()+60000).toISOString(),timeZone:'Europe/Lisbon',autoReconnect:true};
  assert.throws(()=>f.studio.schedule({...input,timeZone:'Bogus/Zone'}),/Fuso/);
  const saved=f.studio.schedule(input); assert.equal(saved.timeZone,'Europe/Lisbon'); assert.equal(saved.autoReconnect,true); assert.equal(saved.armed,false);
});
test('media rename and history CSV endpoints preserve originals and escape spreadsheet formulas', async () => {
  const app=await createApplication({directory:path.join(root,'api'),portableVault:true,listen:false,clock:false});
  try {
    app.store.update(s=>{s.media.push(meta);s.history.push({time:new Date().toISOString(),message:'=1+2',detail:'quoted "value";next'});});
    const req=async(url,body,method='POST')=>dispatch(app,app.base+url,{method:body===undefined?'GET':method,headers:{Cookie:`go_streams=${app.token}`,...(body===undefined?{}:{'Content-Type':'application/json','X-Go-Streams':'1'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const res=await req('/api/media/video',{title:'Renamed'},'PUT'); assert.equal(res.status,200); assert.equal(app.store.data.media[0].title,'Renamed'); assert.ok(fs.existsSync(video));
    const csv=await req('/api/history.csv'); const output=await csv.text(); assert.match(output,/'=1\+2/); assert.match(output,/quoted ""value"";next/);
    await req('/api/history',{},'DELETE'); assert.equal(app.store.data.history.length,0); assert.equal(app.store.data.media.length,1);
  } finally { await app.close(); }
});
function backup(f) {
  const s=f.studio.state();
  return {version:1,media:s.media,channels:s.channels.map(({hasKey,...c})=>c),playlists:s.playlists,schedules:s.schedules};
}
test('project import merges references and repeated clips without replacing keys or starting jobs', async () => {
  const f=setup();
  f.studio.schedule({playlistId:f.playlistId,channelIds:[f.channelId],at:new Date(Date.now()+60000).toISOString(),armed:true,confirmed:true});
  const before=f.studio.store.data.channels[0].secret;
  const result=await f.studio.importProject(backup(f));
  assert.deepEqual(result,{media:0,channels:0,playlists:1,schedules:1});
  const state=f.studio.store.data; const imported=state.playlists[1];
  assert.deepEqual(imported.mediaIds,['video','video']); assert.notEqual(imported.id,f.playlistId); assert.notEqual(imported.name,state.playlists[0].name);
  assert.equal(state.schedules[1].playlistId,imported.id); assert.equal(state.schedules[1].armed,false);
  assert.equal(state.channels[0].secret,before); assert.equal(f.studio.jobs.size,0);
});
test('new imported channels have no key and cannot transmit until configured', async () => {
  const source=setup(); const directory=fs.mkdtempSync(path.join(root,'empty-'));
  const store=new Store(directory); const dest=new Studio(store,new Vault(directory,{portable:true})); studios.push(dest);
  const result=await dest.importProject(backup(source)); assert.equal(result.channels,1);
  const channel=dest.state().channels[0], playlist=dest.state().playlists[0]; assert.equal(channel.hasKey,false);
  await assert.rejects(dest.start({playlistId:playlist.id,channelIds:[channel.id],confirmed:true}),/Configure/);
  assert.throws(()=>dest.saveChannel({...channel,key:''},channel.id),/Configure/);
  dest.saveChannel({...channel,key:'NEW-PRIVATE'},channel.id); assert.equal(dest.state().channels[0].hasKey,true);
});
test('invalid imports are atomic and do not trust secrets, executable settings or media metadata', async () => {
  const f=setup(); const original=JSON.stringify(f.studio.store.data);
  const badReference=backup(f); badReference.playlists[0].mediaIds=['missing'];
  await assert.rejects(f.studio.importProject(badReference),/referências/); assert.equal(JSON.stringify(f.studio.store.data),original);
  const missing=backup(f); missing.media[0].path=path.join(root,'missing.mp4');
  await assert.rejects(f.studio.importProject(missing),/não existe/); assert.equal(JSON.stringify(f.studio.store.data),original);
  const secret=backup(f); secret.channels[0].key='do-not-import';
  await assert.rejects(f.studio.importProject(secret),/sem chaves/); assert.equal(JSON.stringify(f.studio.store.data),original);
  const safe=backup(f); safe.settings={ffmpeg:'malicious.exe'}; safe.media[0].duration=999; safe.media[0].path=video;
  await f.studio.importProject(safe); assert.equal(f.studio.store.data.settings.ffmpeg,''); assert.equal(f.studio.store.data.media[0].duration,4);
});
test('project import API accepts an export and rejects unauthenticated changes', async () => {
  const app=await createApplication({directory:path.join(root,'import-api'),portableVault:true,listen:false,clock:false});
  try {
    app.store.update(s=>{ s.media.push(meta); s.schedules.push({id:'old',status:'triggered',playlistId:'deleted',channelIds:['removed'],at:new Date().toISOString()}); });
    const headers={Cookie:`go_streams=${app.token}`,'Content-Type':'application/json','X-Go-Streams':'1'};
    const exported=await dispatch(app,app.base+'/api/export',{headers}); const body=await exported.text(); assert.equal(JSON.parse(body).schedules.length,0);
    const denied=await dispatch(app,app.base+'/api/import',{method:'POST',headers:{'Content-Type':'application/json'},body}); assert.equal(denied.status,401);
    const result=await dispatch(app,app.base+'/api/import',{method:'POST',headers,body}); assert.equal(result.status,200); assert.equal(app.store.data.media.length,1);
  } finally {await app.close();}
});


test('permanent failures do not retry or pause as network loss',async()=>{
 for(const message of ['Connection failed: Server error: Authentication failed','Error opening output: Server returned 403 Forbidden','Invalid data found when processing input','Error while decoding stream: Invalid argument','TLS connection: certificate verify failed','Unknown encoder libx264','No space left on device']){
  const f=setup({retryDelays:[5]});const [r]=await f.studio.start({playlistId:f.playlistId,channelIds:[f.channelId],confirmed:true,autoReconnect:true,pauseOnDisconnect:true});
  const j=f.studio.jobs.get(r.id);f.children[0].stderr.write(message);f.children[0].emit('close',1);
  assert.equal(j.status,'error',message);assert.equal(j.retries,0,message);await j.completion;
 }
});
test('temporary network failure retries then pauses with zero live metrics',async()=>{
 const f=setup({retryDelays:[5]});const [r]=await f.studio.start({playlistId:f.playlistId,channelIds:[f.channelId],confirmed:true,autoReconnect:true,pauseOnDisconnect:true});const j=f.studio.jobs.get(r.id);
 f.children[0].stdout.write('frame=4\nfps=30\nbitrate=2000kbits/s\n');f.children[0].stderr.write('Connection reset by peer');f.children[0].emit('close',1);
 assert.equal(j.status,'retrying');assert.equal(j.fps,0);assert.equal(j.bitrate,'');
 await until(()=>f.children.length===2);f.children[1].stderr.write('Network is unreachable');f.children[1].emit('close',1);
 assert.equal(j.status,'paused');assert.equal(j.pauseReason,'network');f.studio.stop(j.id);await j.completion;
});
test('stop terminates its own child if the command pipe throws',async()=>{
 const f=setup();const [r]=await f.start();const j=f.studio.jobs.get(r.id);let killed=0;
 f.children[0].stdin.write=()=>{throw Error('broken command pipe');};f.children[0].kill=()=>{killed++;f.children[0].emit('close',null);};
 assert.doesNotThrow(()=>f.studio.stop(j.id));await j.completion;assert.equal(killed,1);assert.equal(j.status,'stopped');assert.equal(j.timer,null);
});
test('synchronous command-pipe close leaves no stale termination timer',async()=>{
 const f=setup();const [r]=await f.start();const j=f.studio.jobs.get(r.id);
 f.children[0].stdin.write=()=>{f.children[0].emit('close',0);return true;};f.studio.pause(j.id);
 assert.equal(j.status,'paused');assert.equal(j.timer,null);
});
