import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {EventEmitter} from 'node:events';import {PassThrough,Writable} from 'node:stream';
import {createApplication} from '../src/server.mjs';import {runProcess} from '../src/core.mjs';
import {dispatch} from './transport.mjs';import {uiHarness} from './ui-harness.mjs';
const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});const root=fs.mkdtempSync(path.join(parent,'ui-api-'));const clip=path.join(root,'clip.mp4');
before(()=>runProcess('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=30','-t','1','-c:v','libx264','-preset','ultrafast','-y',clip]));
after(()=>{if(!root.startsWith(parent+path.sep)||!path.basename(root).startsWith('ui-api-'))throw Error('Unsafe cleanup');fs.rmSync(root,{recursive:true,force:true});});
function child(){const p=new EventEmitter();p.stdout=new PassThrough();p.stderr=new PassThrough();p.stdin=new Writable({write(chunk,enc,cb){cb();setImmediate(()=>p.emit('close',0));}});p.kill=()=>setImmediate(()=>p.emit('close',null));return p;}
async function fixture(t,options={}){
 const sent=[],spawned=[],app=await createApplication({directory:fs.mkdtempSync(path.join(root,'data-')),listen:false,clock:false,portableVault:true,notificationOptions:{send:async(...args)=>sent.push(args)},...options});
 t.after(()=>app.close());app.studio.spawnProcess=()=>{const p=child();spawned.push(p);return p;};
 const h=uiHarness({fetch:(url,init={})=>dispatch(app,url,{...init,headers:{Cookie:'go_streams='+app.token,...init.headers}})});await h.run('refresh(false)');return{app,h,sent,spawned};
}
async function seed(h){
 await h.click('import');await h.submit({paths:clip,convert:false});const mid=h.run('state.media[0].id');
 await h.click('channel-new');await h.submit({name:'Channel A',platform:'Personalizado',url:'rtmp://127.0.0.1:9/live',key:'TEST-STREAM-SECRET',channelUrl:'https://example.test/watch',producerUrl:'https://example.test/producer',autoRestart:false});
 const cid=h.run('state.channels[0].id');return{mid,cid};
}
test('production callbacks import, rename, preview, save channel links and update a channel without exposing its key',async t=>{
 const {app,h}=await fixture(t);const {mid,cid}=await seed(h);assert.equal(app.store.data.media.length,1);
 await h.click('rename-media',mid);await h.submit({title:'Renamed <clip>'});assert.equal(app.store.data.media[0].title,'Renamed <clip>');
 await h.click('preview-media',mid);assert.match(h.element('#dialog-content').innerHTML,/Renamed &lt;clip&gt;/);h.element('#dialog').close();
 await h.click('channel-edit',cid);await h.submit({name:'Edited A',platform:'Personalizado',url:'rtmp://127.0.0.1:9/live',key:'',channelUrl:'https://example.test/watch',producerUrl:'https://example.test/producer',autoRestart:true});
 assert.equal(app.studio.state().channels[0].hasKey,true);assert.equal(app.store.data.channels[0].autoRestart,true);h.run("page='channels';draw()");const html=h.element('#content').innerHTML;assert.match(html,/href="https:\/\/example.test\/producer"/);assert.match(html,/noopener noreferrer/);assert.ok(!html.includes('TEST-STREAM-SECRET'));
 const original=app.store.data.channels[0].channelUrl;await h.click('channel-edit',cid);await h.submit({name:'Edited A',platform:'Personalizado',url:'rtmp://127.0.0.1:9/live',key:'',channelUrl:'javascript:alert(1)',producerUrl:'',autoRestart:false});assert.equal(app.store.data.channels[0].channelUrl,original);assert.equal(h.element('#modal-form .form-error').hidden,false);
});
test('channel preparation, schedule creation/edit/activation/removal and countdown cancellation use real routes',async t=>{
 const {app,h,spawned}=await fixture(t);const {mid,cid}=await seed(h);const values={sourceMode:'video',mediaId:mid,quality:'720p',channelIds:[cid],countdown:'30',autoRestart:'no',pauseOnDisconnect:true,endOnVideoFailure:true,autoReconnect:false,confirmed:true};
 await h.click('plan-channel',cid);await h.submit(values);assert.equal(app.store.data.channelPlans[cid].mediaId,mid);assert.equal(spawned.length,0);
 await h.click('plan-schedule',cid);await h.submit({...values,at:'2099-01-01T12:00',timeZone:'UTC',disambiguation:'reject',armed:false});assert.equal(app.store.data.schedules.length,1);const sid=app.store.data.schedules[0].id;
 await h.click('schedule-edit',sid);await h.submit({...values,at:'2099-01-02T12:00',timeZone:'UTC',disambiguation:'reject',armed:false});assert.equal(app.store.data.schedules[0].at,'2099-01-02T12:00:00.000Z');
 await h.click('arm',sid);assert.equal(app.store.data.schedules[0].armed,true);await h.click('arm',sid);assert.equal(app.store.data.schedules[0].armed,false);
 await h.click('plan-start',cid);const job=[...app.studio.jobs.values()][0];assert.equal(job.status,'countdown');assert.equal(spawned.length,0);await h.click('stop-job',job.id);assert.equal(job.status,'stopped');assert.equal(spawned.length,0);
 await h.click('delete-schedule',sid);assert.equal(app.store.data.schedules.length,0);
});
test('monitor pause, resume, restart, policies and stop-all affect the intended engine job',async t=>{
 const {app,h,spawned}=await fixture(t);const {mid,cid}=await seed(h);await h.click('single-live',mid);await h.submit({sourceMode:'video',mediaId:mid,quality:'720p',channelIds:[cid],countdown:'0',autoRestart:'no',endOnVideoFailure:true,confirmed:true});const first=[...app.studio.jobs.values()][0];assert.equal(spawned.length,1);
 await h.click('job-settings',first.id);await h.submit({autoRestart:false,endOnVideoFailure:false,autoReconnect:true,pauseOnDisconnect:true});assert.equal(first.endOnVideoFailure,false);
 await h.click('pause-job',first.id);await new Promise(r=>setImmediate(r));assert.equal(first.status,'paused');await h.run('refresh(false)');await h.click('resume-job',first.id);assert.equal(spawned.length,2);
 await h.click('restart-job',first.id);assert.equal(first.status,'stopped');assert.equal(spawned.length,3);await h.click('stop-all');await new Promise(r=>setImmediate(r));assert.ok([...app.studio.jobs.values()].every(j=>j.status==='stopped'));
});
test('all settings forms persist through real APIs and SMTP test uses only a controlled sender',async t=>{
 const {app,h,sent}=await fixture(t);h.run("page='settings'");
 await h.submit({ffmpeg:'',ffprobe:'',ytdlp:''},'settings-form');assert.equal(app.store.data.settings.ffmpeg,'');
 await h.submit({copy:true,videoBitrate:'1000',audioBitrate:'128',fps:'25',aspect:'16:9'},'encoding-form');assert.deepEqual(app.store.data.settings.encoding,{copy:true,videoBitrate:1000,audioBitrate:128,fps:25,aspect:'16:9'});
 await h.submit({enabled:true,host:'smtp.example.test',port:'587',username:'test',password:'SMTP-TEST-SECRET',from:'from@example.test',to:'to@example.test'},'notification-form');assert.equal(sent.length,0);assert.equal(app.notifications.publicSettings().hasPassword,true);assert.ok(!JSON.stringify(app.studio.state()).includes('SMTP-TEST-SECRET'));
 await h.click('test-email');assert.equal(sent.length,1);assert.equal(app.store.data.notificationStatus.status,'sent');
 await h.submit({enabled:false,host:'smtp.example.test',port:'587',username:'test',password:'',from:'from@example.test',to:'to@example.test'},'notification-form');assert.equal(app.notifications.publicSettings().enabled,false);
});
test('update settings, check and verified download buttons connect to the signed-package implementation',async t=>{
 const {privateKey,publicKey}=crypto.generateKeyPairSync('ed25519'),bytes=Buffer.from('package fixture');const payload=Buffer.from(JSON.stringify({product:'go-streams',platform:process.platform,version:'99.0.0',url:'https://updates.example.test/app.zip',bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}));
 const manifest={payload:payload.toString('base64'),signature:crypto.sign(null,payload,privateKey).toString('base64')};
 const {app,h}=await fixture(t,{updateOptions:{fetcher:async url=>new Response(url.endsWith('json')?JSON.stringify(manifest):bytes)}});h.run("page='settings'");
 await h.submit({feed:'https://updates.example.test/latest.json',publicKey:publicKey.export({type:'spki',format:'pem'}),autoCheck:false},'update-form');assert.equal(app.updates.state().configured,true);
 await h.click('check-updates');assert.equal(app.updates.state().state,'available');await h.click('download-update');assert.equal(app.updates.state().state,'downloaded');assert.deepEqual(fs.readFileSync(app.updates.state().package),bytes);
});
test('download create, cancel and removal buttons preserve files; no external downloader runs',async t=>{
 const processes=[];const {app,h}=await fixture(t,{downloadOptions:{spawnProcess:()=>{const p=child();processes.push(p);return p;}}});
 await h.click('download-new');await h.submit({url:'https://youtu.be/abcdefghijk',addToLibrary:false});const item=app.store.data.downloads[0];assert.equal(item.status,'running');
 // Complete the controlled child as cancelled, avoiding native process-tree termination.
 app.downloads.cancel=id=>{assert.equal(id,item.id);processes[0].emit('close',1);return{ok:true};};
 await h.click('cancel-download',item.id);await new Promise(r=>setImmediate(r));await h.run('refresh(false)');await h.click('remove-download',item.id);assert.equal(app.store.data.downloads.length,0);
});
test('export, CSV and media links return authorized content; deleted items really leave state',async t=>{
 const {app,h}=await fixture(t);const {mid,cid}=await seed(h);const get=url=>dispatch(app,url,{headers:{Cookie:'go_streams='+app.token}});
 for(const url of ['/api/export','/api/history.csv','/api/media/'+mid])assert.equal((await get(url)).status,200,url);
 const backup=await(await get('/api/export')).json();assert.ok(!JSON.stringify(backup).includes('TEST-STREAM-SECRET'));
 await h.click('import-project');await h.submit({project:{size:JSON.stringify(backup).length,text:async()=>JSON.stringify(backup)}});assert.equal(h.element('#dialog').open,false);
 await h.click('clear-history');assert.equal(app.store.data.history.length,0);await h.click('delete-channel',cid);assert.ok(!app.store.data.channels.some(c=>c.id===cid));
 for(const media of [...app.store.data.media])await h.click('delete-media',media.id);assert.equal(app.store.data.media.length,0);assert.equal(fs.existsSync(clip),true);
});


test('tools cancellation button reaches authenticated conversion route without deleting the original',async t=>{
 const {app,h}=await fixture(t);const {mid}=await seed(h);let running=false;
 app.studio.runTransformProcess=async(cmd,args,{signal})=>{fs.writeFileSync(args.at(-1),'partial');running=true;await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('Operação cancelada.')),{once:true}));};
 const pending=app.studio.normalize(mid),rejected=assert.rejects(pending,/cancelada/);
 const deadline=Date.now()+5000;while(!running){if(Date.now()>deadline)throw Error('Timed out');await new Promise(r=>setTimeout(r,5));}
 await h.run("refresh(false)");h.run("page='tools';draw()");assert.match(h.element('#content').innerHTML,/Conversões em curso/);assert.match(h.element('#content').innerHTML,/data-action="cancel-conversion"/);
 const denied=await dispatch(app,'/api/media-operations/'+mid+'/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(denied.status,401);assert.equal(app.studio.pendingOperations.size,1);
 await h.click('cancel-conversion',mid);await rejected;assert.equal(app.studio.pendingOperations.size,0);assert.ok(fs.existsSync(clip));assert.equal(app.store.data.media.length,1);
});


test('playlist rename button updates the name via production API during an active session',async t=>{
 const {app,h,spawned}=await fixture(t);const {mid,cid}=await seed(h);
 const pid=app.studio.savePlaylist({name:'Old programme',mediaIds:[mid],loop:true});const [job]=await app.studio.start({playlistId:pid,channelIds:[cid],confirmed:true});await h.run('refresh(false)');
 await h.click('playlist-rename',pid);await h.submit({name:'New <programme>'});
 assert.equal(spawned.length,1);assert.equal(app.studio.jobs.get(job.id).playlistName,'New <programme>');h.run("page='playlists';draw()");assert.match(h.element('#content').innerHTML,/New &lt;programme&gt;/);
 const response=await dispatch(app,'/api/playlists/'+pid+'/name',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Foreign change'})});assert.equal(response.status,401);assert.equal(app.store.data.playlists[0].name,'New <programme>');
});

test('retry download button keeps import preference, preserves history and rejects duplicate active requests',async t=>{
 const processes=[];const {app,h}=await fixture(t,{downloadOptions:{spawnProcess:()=>{const p=child();processes.push(p);return p;}}});
 await h.click('download-new');await h.submit({url:'https://youtu.be/abcdefghijk',addToLibrary:false});
 const first=app.store.data.downloads[0],done=app.downloads.active.get(first.id).done;processes[0].emit('close',1);await done;
 await h.run("refresh(false)");h.run("page='tools';draw()");assert.match(h.element('#content').innerHTML,/data-action="retry-download"/);
 await h.click('retry-download',first.id);
 assert.equal(app.store.data.downloads.length,2);const second=app.store.data.downloads[1];assert.equal(second.url,first.url);assert.equal(second.addToLibrary,false);assert.equal(app.store.data.downloads[0].status,'error');
 await h.click('retry-download',first.id);assert.equal(app.store.data.downloads.length,2);assert.equal(processes.length,2);
 const last=app.downloads.active.get(second.id).done;processes[1].emit('close',1);await last;
 h.run("state.downloads[0].status='completed'");const before=h.requests.length;await h.click('retry-download',first.id);assert.equal(h.requests.length,before);
});

test('missing custom tools do not block unrelated settings, while explicitly supplied paths remain validated',async t=>{
 const {app,h}=await fixture(t),missing=path.join(root,'missing-ffmpeg.exe');
 app.store.update(s=>{s.settings.ffmpeg=missing;});await h.run('refresh(false)');
 await h.submit({videoBitrate:'1000',audioBitrate:'128',fps:'30',aspect:'16:9',copy:false},'encoding-form');
 assert.equal(app.store.data.settings.encoding?.videoBitrate,1000);assert.equal(app.store.data.settings.ffmpeg,missing);
 const before=structuredClone(app.store.data.settings);
 await h.submit({ffmpeg:path.join(root,'another-missing.exe'),ffprobe:'',ytdlp:''},'settings-form');assert.deepEqual(app.store.data.settings,before);
 await h.submit({ffmpeg:'',ffprobe:'',ytdlp:''},'settings-form');assert.equal(app.store.data.settings.ffmpeg,'');assert.equal(app.store.data.settings.encoding.videoBitrate,1000);
});


test('preparation uses an informational hint while starting and scheduling retain required confirmation',async t=>{
 const {app,h,spawned}=await fixture(t),{mid,cid}=await seed(h);await h.click('plan-channel',cid);let html=h.element('#dialog-content').innerHTML;
 assert.ok(html.includes('Preparação local: guardar não inicia a emissão.'));assert.ok(!html.includes('name="confirmed"'));
 await h.submit({sourceMode:'video',mediaId:mid,quality:'720p',channelIds:[cid],countdown:'0',autoRestart:'no',pauseOnDisconnect:true,endOnVideoFailure:true});assert.equal(app.store.data.channelPlans[cid].mediaId,mid);assert.equal(spawned.length,0);
 await h.click('single-live',mid);assert.match(h.element('#dialog-content').innerHTML,/name="confirmed" required/);
 await h.click('schedule-new');assert.match(h.element('#dialog-content').innerHTML,/name="confirmed" required/);assert.equal(spawned.length,0);
});
