import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {createApplication} from '../src/server.mjs';import {exportBackup,decryptBackup,prepareBackupRestore} from '../src/backups.mjs';import {dispatch} from './transport.mjs';import {uiHarness} from './ui-harness.mjs';
const pass='Backup-test-password-123',preferences={language:'pt-PT',layout:'grid',compact:true};
async function fixture(t){const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});const root=fs.mkdtempSync(path.join(parent,'backups-'));const app=await createApplication({directory:root,listen:false,clock:false,portableVault:true,notificationOptions:{send:async()=>{throw Error('No external email');}},updateOptions:{fetcher:async()=>{throw Error('No external requests');}}});t.after(async()=>{await app.close();if(!root.startsWith(parent+path.sep)||!path.basename(root).startsWith('backups-'))throw Error('Unsafe cleanup');fs.rmSync(root,{recursive:true,force:true});});return app;}
const request=(app,url,body)=>dispatch(app,url,{method:'POST',headers:{Cookie:'go_streams='+app.token,'Content-Type':'application/json','X-Go-Streams':'1'},body:JSON.stringify(body)});
function seed(app){
 const key='CHANNEL-PRIVATE-123',cid=app.studio.saveChannel({name:'Original channel',platform:'YouTube',url:'rtmps://a.example.test/live',key,channelUrl:'https://example.test/channel',producerUrl:'https://example.test/producer',autoRestart:true});
 app.store.update(s=>{s.media=[{id:'video-a',title:'Video original',source:'https',path:'https://cdn.example.test/video.mp4',size:0,duration:12,width:320,height:180,fps:30,codec:'h264',pixelFormat:'yuv420p',timeBase:'1/15360',audio:null,thumbnail:false,added:'2026-01-01T00:00:00Z'}];s.playlists=[{id:'playlist-a',name:'Sequência',mediaIds:['video-a','video-a'],loop:true,quality:'720p'}];s.channelPlans={[cid]:{playlistId:'playlist-a',mediaId:null,quality:'720p',countdown:10,autoRestart:true}};s.schedules=[{id:'schedule-a',playlistId:'playlist-a',mediaId:null,channelIds:[cid],at:'2099-01-01T12:00:00Z',timeZone:'Europe/Lisbon',status:'pending',armed:true}];s.history=[{id:'history-a',time:'2026-01-01T00:00:00Z',kind:'session',result:'completed',elapsed:42}];s.downloads=[{id:'download-a',url:'https://www.youtube.com/watch?v=abcdefghijk',status:'completed',title:'Download entry'}];s.settings={ffmpeg:'',ffprobe:'',ytdlp:'',encoding:{copy:false,videoBitrate:4500,audioBitrate:192,fps:60,aspect:'9:16'},operations:{maxConcurrent:10,historyLimit:5000,persistSchedules:true}};s.updates={feed:'',publicKey:'',autoCheck:false};});
 app.notifications.save({enabled:true,host:'smtp.example.test',port:465,security:'tls',username:'owner',password:'SMTP-PRIVATE-456',from:'owner@example.test',to:'owner@example.test'});return cid;
}
test('full encrypted backup restores the same IDs, ordering, duplicates, keys, settings and history into a different vault',async t=>{
 const source=await fixture(t),target=await fixture(t),cid=seed(source);target.studio.saveChannel({name:'Discarded channel',url:'rtmp://localhost/live',key:'OLD'});
 const exported=await request(source,'/api/backups/export',{scope:'all',password:pass,interface:preferences});assert.equal(exported.status,200);const backup=await exported.json(),encoded=JSON.stringify(backup);assert.ok(!encoded.includes('CHANNEL-PRIVATE'));assert.ok(!encoded.includes('SMTP-PRIVATE'));assert.ok(!encoded.includes('Original channel'));
 const restored=await request(target,'/api/backups/restore',{backup,password:pass,confirmed:true});assert.equal(restored.status,200);assert.deepEqual((await restored.json()).interface,preferences);
 assert.deepEqual(target.store.data.playlists,source.store.data.playlists);assert.deepEqual(target.store.data.media,source.store.data.media);assert.deepEqual(target.store.data.channelPlans,source.store.data.channelPlans);assert.deepEqual(target.store.data.schedules,source.store.data.schedules);assert.deepEqual(target.store.data.history,source.store.data.history);assert.deepEqual(target.store.data.settings,source.store.data.settings);assert.deepEqual(target.store.data.downloads,source.store.data.downloads);
 assert.equal(target.store.data.channels[0].id,cid);assert.equal(target.studio.vault.decrypt(target.store.data.channels[0].secret),'CHANNEL-PRIVATE-123');assert.notEqual(target.store.data.channels[0].secret,source.store.data.channels[0].secret);assert.equal(target.studio.vault.decrypt(target.store.data.notifications.secret),'SMTP-PRIVATE-456');assert.equal(target.store.data.notifications.enabled,true);
 assert.ok(!fs.readFileSync(target.store.file,'utf8').includes('PRIVATE'));assert.equal(target.studio.jobs.size,0);
 assert.equal((await request(target,'/api/backups/restore',{backup,password:pass,confirmed:true})).status,200);assert.equal(target.store.data.channels.length,1);assert.equal(target.store.data.playlists.length,1);
 const again=await exportBackup(target.store,target.studio.vault,{scope:'all',password:pass,interface:preferences});assert.deepEqual(await decryptBackup(again,pass),await decryptBackup(backup,pass));
});
test('wrong password, tampering, invalid references and missing confirmation preserve every saved value',async t=>{
 const app=await fixture(t);seed(app);const backup=await exportBackup(app.store,app.studio.vault,{scope:'all',password:pass,interface:preferences}),before=fs.readFileSync(app.store.file,'utf8');
 for(const body of [{backup,password:'Wrong-password-123',confirmed:true},{backup:{...backup,data:(backup.data[0]==='A'?'B':'A')+backup.data.slice(1)},password:pass,confirmed:true},{backup,password:pass}]){const result=await request(app,'/api/backups/restore',body);assert.equal(result.status,400);assert.equal(fs.readFileSync(app.store.file,'utf8'),before);}
 const payload=await decryptBackup(backup,pass);payload.data.playlists[0].mediaIds=['missing'];assert.throws(()=>prepareBackupRestore(payload,app.store.data,app.studio.vault,app.store.directory));assert.equal(fs.readFileSync(app.store.file,'utf8'),before);
 const response=await dispatch(app,'/api/backups/restore',{method:'POST',body:JSON.stringify({backup,password:pass,confirmed:true})});assert.equal(response.status,401);
});
test('project-only restore preserves settings and settings-only restore preserves all project collections',async t=>{
 const source=await fixture(t),target=await fixture(t);seed(source);seed(target);target.store.update(s=>{s.settings.operations.maxConcurrent=2;s.playlists[0].name='Target sequence';});
 const settings=await exportBackup(source.store,source.studio.vault,{scope:'settings',password:pass,interface:preferences});const original=structuredClone(target.store.data.playlists);
 assert.equal((await request(target,'/api/backups/restore',{backup:settings,password:pass,confirmed:true})).status,200);assert.deepEqual(target.store.data.playlists,original);assert.equal(target.store.data.settings.operations.maxConcurrent,10);
 target.store.update(s=>s.settings.operations.maxConcurrent=3);const project=await exportBackup(source.store,source.studio.vault,{scope:'project',password:pass});const result=await request(target,'/api/backups/restore',{backup:project,password:pass,confirmed:true});assert.equal(result.status,200);assert.equal((await result.json()).interface,null);assert.equal(target.store.data.settings.operations.maxConcurrent,3);assert.deepEqual(target.store.data.playlists,source.store.data.playlists);
});
test('restore rejects active sessions and also rechecks operations after decryption',async t=>{
 const app=await fixture(t);seed(app);const backup=await exportBackup(app.store,app.studio.vault,{scope:'all',password:pass,interface:preferences});const before=fs.readFileSync(app.store.file,'utf8');
 app.studio.jobs.set('busy',{id:'busy',ended:null});assert.equal((await request(app,'/api/backups/restore',{backup,password:pass,confirmed:true})).status,409);app.studio.jobs.clear();
 const pending=request(app,'/api/backups/restore',{backup,password:pass,confirmed:true});await new Promise(r=>setImmediate(r));app.studio.pendingOperations.set('busy',{});const result=await pending;app.studio.pendingOperations.clear();assert.equal(result.status,409);assert.equal(fs.readFileSync(app.store.file,'utf8'),before);
});
test('backup UI exports a password-protected file and restores interface preferences through the production API',async t=>{
 const source=await fixture(t);seed(source);const h=uiHarness({fetch:(url,init={})=>dispatch(source,url,{...init,headers:{Cookie:'go_streams='+source.token,...init.headers}})});await h.run('refresh(false)');let blob,clicked=false;
 h.context.Blob=Blob;h.context.URL={createObjectURL:value=>{blob=value;return'blob:backup';},revokeObjectURL:()=>{}};h.context.document.createElement=()=>({click(){clicked=true;},remove(){}});h.context.document.body={append(){}};
 await h.click('backup-export');await h.submit({scope:'all',password:pass,repeat:pass});assert.equal(clicked,true);const backup=JSON.parse(await blob.text());assert.equal(backup.kind,'go-streams-backup');
 const stored={};h.context.localStorage.setItem=(k,v)=>{stored[k]=v;};h.context.location.reload=()=>{h.context.reloaded=true;};h.context.setLanguage=(code)=>{stored['go-streams-language']=code;};h.context.applyLocale=()=>{};
 await h.click('backup-restore');await h.submit({backup:{size:1000,text:async()=>JSON.stringify(backup)},password:pass,confirmed:true});assert.equal(source.store.data.playlists.length,1);assert.equal(h.context.reloaded,true);assert.equal(stored['media-layout'],'list');assert.equal(stored['go-streams-language'],'pt-PT');
});

test('backup of default settings preserves implicit quality profiles instead of introducing an encoding override',async t=>{
 const source=await fixture(t),target=await fixture(t),original=structuredClone(source.store.data.settings);
 const backup=await exportBackup(source.store,source.studio.vault,{scope:'settings',password:pass,interface:preferences});
 assert.equal((await request(target,'/api/backups/restore',{backup,password:pass,confirmed:true})).status,200);assert.deepEqual(target.store.data.settings,original);assert.equal(target.store.data.settings.encoding,undefined);
});


test('encrypted backups can restore a library larger than one thousand videos without changing IDs or order',async t=>{
 const source=await fixture(t),target=await fixture(t);seed(source);
 source.store.update(s=>{const sample=s.media[0];s.media=Array.from({length:1001},(_,i)=>({...sample,id:'video-'+i,path:'https://cdn.example.test/video-'+i+'.mp4'}));s.playlists[0].mediaIds=['video-1000','video-0','video-1000'];s.schedules[0].mediaId=null;s.downloads=Array.from({length:5001},(_,i)=>({id:'download-'+i,url:'https://www.youtube.com/watch?v=abcdefghijk',status:'error',title:'Past download'}));});
 const backup=await exportBackup(source.store,source.studio.vault,{scope:'all',password:pass,interface:preferences});
 const response=await request(target,'/api/backups/restore',{backup,password:pass,confirmed:true});
 assert.equal(response.status,200);assert.deepEqual(target.store.data.media,source.store.data.media);assert.deepEqual(target.store.data.playlists,source.store.data.playlists);assert.deepEqual(target.store.data.downloads,source.store.data.downloads);
});


test('restoring a backup reconnects app-owned media already copied into the new data folder',async t=>{
 const source=await fixture(t),target=await fixture(t);seed(source);
 const relative=path.join('downloads','saved-download','video.mp4');
 for(const app of [source,target]){const destination=path.join(app.store.directory,relative);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,'download fixture');}
 source.store.update(s=>{delete s.media[0].source;s.media[0].downloadUrl='https://www.youtube.com/watch?v=abcdefghijk';s.media[0].path=path.join(source.store.directory,relative);s.downloads=[{id:'saved-download',url:'https://www.youtube.com/watch?v=abcdefghijk',status:'completed',path:s.media[0].path,mediaId:s.media[0].id}];});
 const backup=await exportBackup(source.store,source.studio.vault,{scope:'all',password:pass,interface:preferences});
 const response=await request(target,'/api/backups/restore',{backup,password:pass,confirmed:true});assert.equal(response.status,200);
 const moved=path.join(target.store.directory,relative);assert.equal(target.store.data.media[0].path,moved);assert.equal(target.downloads.file('saved-download'),moved);target.downloads.remove('saved-download');assert.throws(()=>target.downloads.start({url:'https://youtu.be/abcdefghijk'}),/descarregado/);
 assert.equal(source.store.data.media[0].path,path.join(source.store.directory,relative));assert.deepEqual(target.store.data.playlists,source.store.data.playlists);
});


for(const phase of ['before','during'])test('restore refuses pending transmission validation '+phase+' decryption',async t=>{
 const app=await fixture(t);seed(app);const backup=await exportBackup(app.store,app.studio.vault,{scope:'all',password:pass,interface:preferences});const before=fs.readFileSync(app.store.file,'utf8');
 let release;const preparation=new Promise(resolve=>{release=resolve;});
 if(phase==='before')app.studio.pendingPreparations.add(preparation);
 const pending=request(app,'/api/backups/restore',{backup,password:pass,confirmed:true});
 try{
  if(phase==='during'){await new Promise(resolve=>setImmediate(resolve));app.studio.pendingPreparations.add(preparation);}
  const result=await pending;assert.equal(result.status,409);assert.equal(fs.readFileSync(app.store.file,'utf8'),before);
 }finally{app.studio.pendingPreparations.delete(preparation);release();await pending;}
});
