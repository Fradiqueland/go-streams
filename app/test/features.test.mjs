import {windowsTool} from '../src/system-tools.mjs';
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {spawnSync} from 'node:child_process';
import {Studio,Store,Vault,probe,runProcess} from '../src/core.mjs';
import {validateEncoding,outputDimensions,encodingArgs} from '../src/encoding.mjs';
import {Downloads,videoUrl} from '../src/downloads.mjs';
import {Notifications,validateNotifications,sendSmtp} from '../src/notifications.mjs';
import {createApplication} from '../src/server.mjs';
import {dispatch} from './transport.mjs';
import {localToUtc,utcToLocal} from '../public/timezones.js';
import {stopProcessTree} from '../src/processes.mjs';

const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});
const root=fs.mkdtempSync(path.join(parent,'features-'));const video=path.join(root,'clip.mp4');let media;
const closers=[];
before(async()=>{await runProcess('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=30','-f','lavfi','-i','sine=frequency=220:sample_rate=48000','-t','1.5','-c:v','libx264','-preset','ultrafast','-c:a','aac','-ac','2','-y',video]);media={...await probe(video,'ffprobe'),id:'clip',title:'Clip'};});
after(async()=>{for(const close of closers.toReversed())await close();if(!path.resolve(root).startsWith(parent+path.sep)||!path.basename(root).startsWith('features-'))throw Error('Unsafe cleanup');fs.rmSync(root,{recursive:true,force:true});});
function child(){const c=new EventEmitter();c.stdout=new PassThrough();c.stderr=new PassThrough();c.stdin=new Writable({write(data,enc,done){done();setImmediate(()=>c.emit('close',0));}});c.kill=()=>setImmediate(()=>c.emit('close',null));return c;}
function make(options={}){const store=new Store(fs.mkdtempSync(path.join(root,'studio-')));const studio=new Studio(store,new Vault(store.directory,{portable:true}),options);store.update(s=>s.media.push(media));const playlistId=studio.savePlaylist({name:'List',mediaIds:['clip','clip'],loop:true});const channelId=studio.saveChannel({name:'Local',url:'rtmp://127.0.0.1:9/live',key:'CHANNEL-SECRET'});closers.push(()=>studio.shutdown());return{studio,store,playlistId,channelId,start:extra=>studio.start({playlistId,channelIds:[channelId],confirmed:true,...extra})};}
const mail={enabled:true,host:'smtp.example.com',port:587,username:'me@example.com',from:'me@example.com',to:'recipient@example.com',password:'MAIL-SECRET'};
async function until(check,timeout=5000){const end=Date.now()+timeout;while(!check()){if(Date.now()>end)throw Error('Timed out');await new Promise(r=>setTimeout(r,10));}}

test('encoder validates original presets and square, vertical and widescreen dimensions',()=>{
  for(const fps of [25,30,60])assert.equal(validateEncoding({fps}).fps,fps);
  for(const bad of [{fps:120},{videoBitrate:-1},{aspect:'bad'},{copy:'true'}])assert.throws(()=>validateEncoding(bad));
  assert.deepEqual(outputDimensions('720p','9:16'),[720,1280]);assert.deepEqual(outputDimensions('1080p','1:1'),[1080,1080]);assert.deepEqual(outputDimensions('720p','21:9'),[1680,720]);
  assert.throws(()=>encodingArgs({copy:true},'720p',[{...media,codec:'vp9'}]),/H.264/);
});
test('timezone conversion rejects DST gaps and explicitly resolves repeated Lisbon hours',()=>{
  assert.throws(()=>localToUtc('2026-03-29T01:30','Europe/Lisbon'),/não existe/);
  assert.throws(()=>localToUtc('2026-10-25T01:30','Europe/Lisbon'),/duas vezes/);
  assert.equal(localToUtc('2026-10-25T01:30','Europe/Lisbon','earlier'),'2026-10-25T00:30:00.000Z');
  assert.equal(localToUtc('2026-10-25T01:30','Europe/Lisbon','later'),'2026-10-25T01:30:00.000Z');
  assert.equal(localToUtc('2026-11-01T12:00','Asia/Kathmandu'),'2026-11-01T06:15:00.000Z');
  assert.equal(utcToLocal('2026-11-01T06:15:00.000Z','Asia/Kathmandu'),'2026-11-01T12:00');
  assert.throws(()=>localToUtc('2026-02-30T12:00','UTC'),/válidas/);
  assert.throws(()=>localToUtc('2026-11-01T12:00','Invalid/Zone'),/válido/);
});
test('process-tree cancellation targets only the owned PID and avoids completed handles',async()=>{
  let args,launches=0;const owned=child();owned.pid=12345;owned.exitCode=null;
  const ok=await stopProcessTree(owned,{platform:'win32',spawnProcess(command,a,options){launches++;assert.equal(command,windowsTool('taskkill'));assert.equal(options.windowsHide,true);args=a;const c=child();setImmediate(()=>c.emit('close',0));return c;}});
  assert.equal(ok,true);assert.deepEqual(args,['/PID','12345','/T','/F']);
  owned.exitCode=0;await stopProcessTree(owned,{platform:'win32',spawnProcess(){launches++;throw Error();}});assert.equal(launches,1);
});
test('future schedules can be edited while the channel is live, but triggered ones cannot',async()=>{
  const f=make({spawnProcess(){return child();}});await f.start();
  const input={playlistId:f.playlistId,channelIds:[f.channelId],at:new Date(Date.now()+3600000).toISOString(),timeZone:'Europe/Lisbon'};
  const first=f.studio.schedule(input);const updated=f.studio.schedule({...input,at:new Date(Date.now()+7200000).toISOString(),endOnVideoFailure:false},first.id);
  assert.equal(updated.id,first.id);assert.equal(updated.endOnVideoFailure,false);assert.equal(f.store.data.schedules.length,1);
  f.store.update(s=>{s.schedules[0].status='triggered';});assert.throws(()=>f.studio.schedule(input,first.id),/não pode ser editado/);
});
test('real FFmpeg produces square 25 fps output with the chosen profile', {timeout:20000},async()=>{
  const f=make();f.store.update(s=>{s.settings.encoding=validateEncoding({aspect:'1:1',fps:25,videoBitrate:1000,audioBitrate:192});});
  const [r]=await f.studio.start({playlistId:f.playlistId,preview:true});const j=f.studio.jobs.get(r.id);await j.completion;assert.equal(j.status,'completed',j.error);
  const meta=await probe(path.join(f.store.directory,'previews',j.output),'ffprobe');assert.equal(meta.width,720);assert.equal(meta.height,720);assert.equal(meta.fps,25);assert.equal(j.encoding.audioBitrate,192);
});
test('direct stream copy retains source resolution and frame rate', {timeout:20000},async()=>{
  const f=make();f.store.update(s=>{s.settings.encoding=validateEncoding({copy:true});});
  const [r]=await f.studio.start({playlistId:f.playlistId,preview:true});const j=f.studio.jobs.get(r.id);await j.completion;assert.equal(j.status,'completed',j.error);
  const meta=await probe(path.join(f.store.directory,'previews',j.output),'ffprobe');assert.equal(meta.width,320);assert.equal(meta.height,180);assert.equal(meta.fps,30);assert.equal(meta.audio.codec,'aac');
});
test('manual restart stops the previous process and starts from zero',async()=>{
  const processes=[];const f=make({spawnProcess(){const c=child();processes.push(c);return c;}});
  const [r]=await f.start();processes[0].stdout.write('frame=10\nout_time_us=1000000\n');
  await assert.rejects(f.studio.restart(r.id,false),/Confirme/);
  const [next]=await f.studio.restart(r.id,true);assert.notEqual(next.id,r.id);assert.equal(f.studio.jobs.get(r.id).status,'stopped');assert.equal(next.elapsed,0);
});
test('continuation policy skips missing inputs, while strict mode fails before launch',async()=>{
  const processes=[];const f=make({spawnProcess(){const c=child();processes.push(c);return c;}});
  f.store.update(s=>{s.media.push({...media,id:'missing',path:path.join(root,'missing.mp4')});s.playlists[0].mediaIds=['missing','clip'];});
  await assert.rejects(f.start(),/não existe/);assert.equal(processes.length,0);
  const [r]=await f.start({endOnVideoFailure:false});assert.equal(r.skippedVideos.length,1);assert.equal(r.current.mediaId,'clip');assert.equal(processes.length,1);
});
test('decoder failure advances to remaining media without treating a network failure as a bad video',async()=>{
  const processes=[];const f=make({spawnProcess(){const c=child();processes.push(c);return c;}});
  const [r]=await f.start({endOnVideoFailure:false});const job=f.studio.jobs.get(r.id);
  processes[0].stderr.write('Error while decoding stream #0');processes[0].emit('close',1);assert.equal(processes.length,2);assert.equal(job.skippedVideos.length,1);
  processes[1].stderr.write('Connection refused rtmp://127.0.0.1:9/live/CHANNEL-SECRET');processes[1].emit('close',1);await job.completion;assert.equal(job.status,'error');assert.equal(processes.length,2);assert.ok(!job.error.includes('CHANNEL-SECRET'));
});
test('YouTube links are canonicalized without passing playlist, cookies or arbitrary protocols',()=>{
  assert.equal(videoUrl('https://youtu.be/abcdefghijk?si=anything'),'https://www.youtube.com/watch?v=abcdefghijk');
  assert.equal(videoUrl('https://www.youtube.com/shorts/abcdefghijk'),'https://www.youtube.com/watch?v=abcdefghijk');
  for(const url of ['file:///x','http://youtube.com/watch?v=abcdefghijk','https://evil.test/video','https://user:pass@youtube.com/watch?v=abcdefghijk','https://youtube.com/playlist?list=abc'])assert.throws(()=>videoUrl(url));
});
test('download progress, title and completed media are imported through the real probe',async()=>{
  const f=make();let c,args;f.store.update(s=>{s.settings.ytdlp=path.join(root,'configured-yt-dlp.exe');});
  const d=new Downloads(f.studio,{spawnProcess(command,a){assert.equal(command,f.store.data.settings.ytdlp);args=a;c=child();return c;}});closers.push(()=>d.shutdown());
  const item=d.start({url:'https://youtu.be/abcdefghijk'});const folder=args[args.indexOf('--paths')+1];
  assert.ok(args.includes('--ignore-config'));assert.equal(args.at(-2),'--');
  c.stdout.write('PROGRESS: 52.1%\n');assert.equal(f.store.data.downloads[0].progress,52);
  fs.copyFileSync(video,path.join(folder,'video.mp4'));c.stdout.write('TITLE:My downloaded clip\n');c.emit('close',0);
  await until(()=>!d.active.size);const saved=f.store.data.downloads[0];assert.equal(saved.status,'completed');assert.equal(saved.progress,100);assert.equal(f.store.data.media.find(m=>m.id===saved.mediaId).title,'My downloaded clip');assert.ok(fs.existsSync(video));
  assert.throws(()=>d.start({url:'https://youtu.be/abcdefghijk'}),/já foi descarregado/);
});
test('download cancellation cleans only its owned files and enforces the concurrency limit',async()=>{
  const f=make();const d=new Downloads(f.studio,{spawnProcess(){return child();}});closers.push(()=>d.shutdown());
  const a=d.start({url:'https://youtu.be/abcdefghijk'}),b=d.start({url:'https://youtu.be/12345678901'});
  assert.throws(()=>d.start({url:'https://youtu.be/09876543210'}),/dois downloads/);
  const owned=d.active.get(a.id).directory;fs.writeFileSync(path.join(owned,'partial.part'),'partial');d.cancel(a.id);await until(()=>!d.active.has(a.id));
  assert.equal(f.store.data.downloads[0].status,'cancelled');assert.ok(!fs.existsSync(owned));assert.ok(fs.existsSync(video));d.cancel(b.id);await until(()=>!d.active.size);
});
test('missing download executable records an actionable failure without leaking tool stderr',async()=>{
  const f=make();let c;const d=new Downloads(f.studio,{spawnProcess(){c=child();return c;}});closers.push(()=>d.shutdown());
  d.start({url:'https://youtu.be/abcdefghijk'});c.emit('error',new Error('ENOENT'));c.stderr.write('SIGNED-PRIVATE-URL');c.emit('close',-1);await until(()=>!d.active.size);
  assert.match(f.store.data.downloads[0].error,/yt-dlp indisponível/);assert.ok(!JSON.stringify(f.store.data.downloads).includes('SIGNED-PRIVATE-URL'));
});
test('SMTP credentials are encrypted, excluded from state, and sent only when opted in',async()=>{
  const f=make();const sent=[];const n=new Notifications(f.studio,{send:async(config,message)=>sent.push({config,message})});closers.push(()=>n.shutdown());
  n.enqueue({channelName:'Local',playlistName:'List',elapsed:0},'running');assert.equal(sent.length,0);
  n.save(mail);assert.ok(!fs.readFileSync(f.store.file,'utf8').includes('MAIL-SECRET'));assert.ok(!JSON.stringify(f.studio.state()).includes('MAIL-SECRET'));assert.ok(!JSON.stringify(f.studio.state()).includes('"secret"'));
  await assert.rejects(n.test(false),/Confirme/);n.enqueue({preview:true},'completed');assert.equal(sent.length,0);
  n.enqueue({channelName:'Local',playlistName:'List',elapsed:5},'running');await until(()=>sent.length===1&&!n.processing);assert.equal(sent[0].config.password,'MAIL-SECRET');assert.equal(f.store.data.notificationStatus.status,'sent');
  const saved=f.store.data.notifications.secret;n.save({...mail,password:''});assert.equal(f.store.data.notifications.secret,saved);
});
test('SMTP failure is contained and configuration rejects header injection and mismatched TLS settings',async()=>{
  for(const bad of [{to:'x@example.com\r\nBcc:other@example.com'},{port:465,security:'starttls'},{security:'none'},{host:'bad host'}])assert.throws(()=>validateNotifications({...mail,...bad}));
  const f=make();const n=new Notifications(f.studio,{send:async()=>{throw Error('MAIL-SECRET remote failure');}});closers.push(()=>n.shutdown());n.save(mail);
  const result=await n.test(true);assert.equal(result.ok,false);assert.ok(!JSON.stringify(f.studio.state()).includes('MAIL-SECRET'));assert.equal(f.store.data.notificationStatus.status,'error');
});
test('API preserves tool paths when changing encoding, protects SMTP and serves the new UI module',async()=>{
  let sends=0;const app=await createApplication({directory:path.join(root,'api'),listen:false,clock:false,portableVault:true,notificationOptions:{send:async()=>{sends++;}}});
  try{
    const request=async(url,body,method='POST')=>dispatch(app,app.base+url,{method:body===undefined?'GET':method,headers:{Cookie:`go_streams=${app.token}`,...(body===undefined?{}:{'Content-Type':'application/json','X-Go-Streams':'1'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    assert.equal((await request('/api/settings',{encoding:{aspect:'9:16',fps:60}},'PUT')).status,200);assert.equal(app.store.data.settings.encoding.fps,60);assert.equal(app.store.data.settings.ffmpeg,'');
    assert.equal((await request('/api/notifications',mail,'PUT')).status,200);assert.equal(sends,0);
    const backup=await request('/api/export');assert.ok(!(await backup.text()).includes('MAIL-SECRET'));
    assert.equal((await request('/api/notifications/test',{confirmed:true})).status,200);assert.equal(sends,1);
    const asset=await request('/extras.js');assert.equal(asset.status,200);assert.match(await asset.text(),/downloadsPanel/);
  }finally{await app.close();}
});
