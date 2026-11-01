import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createApplication} from '../src/server.mjs';
import {exportBackup} from '../src/backups.mjs';
import {dispatch} from './transport.mjs';

async function fixture(t,options={}){
 const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});
 const directory=fs.mkdtempSync(path.join(parent,'live-api-review-'));
 const app=await createApplication({directory,listen:false,clock:false,portableVault:true,...options});
 t.after(async()=>{await app.close();assert.ok(directory.startsWith(parent+path.sep));fs.rmSync(directory,{recursive:true,force:true});});
 return app;
}
function request(app,url,body,method='POST'){
 return dispatch(app,url,{method,headers:{Cookie:'go_streams='+app.token,'Content-Type':'application/json','X-Go-Streams':'1'},body:JSON.stringify(body)});
}

test('recording folder selection supports cancellation and persists a user-selected default through the authenticated API',async t=>{
 let selected=null,calls=0;const app=await fixture(t,{folderPicker:async()=>{calls++;return selected;}}),before=JSON.stringify(app.store.data);
 let response=await request(app,'/api/recordings/pick-directory',{});assert.equal(response.status,200);assert.deepEqual(await response.json(),{directory:null});
 selected=path.join(app.store.directory,'Chosen recording folder');response=await request(app,'/api/recordings/pick-directory',{});assert.equal((await response.json()).directory,selected);assert.equal(calls,2);
 response=await request(app,'/api/recordings/preferences',{directory:selected,askEveryTime:false},'PUT');assert.equal(response.status,200);assert.equal((await response.json()).askEveryTime,false);
 const state=await dispatch(app,'/api/state',{headers:{Cookie:'go_streams='+app.token}});assert.equal((await state.json()).recordingPreferences.directory,fs.realpathSync(selected));
 assert.equal(JSON.stringify(app.store.data),before);assert.equal(app.recordings.active.size,0);assert.equal(app.feeds.active.size,0);
 assert.equal((await request(app,'/api/recordings/preferences',{directory:'relative',askEveryTime:false},'PUT')).status,400);
});

for(const phase of ['before','during'])test('backup restore refuses a capture feed '+phase+' decryption',async t=>{
 const app=await fixture(t),password='Review-backup-password-123';
 const backup=await exportBackup(app.store,app.studio.vault,{scope:'all',password,interface:{language:'en',layout:'list',compact:false}});
 const original=JSON.stringify(app.store.data);
 if(phase==='before')app.feeds.active.set('review-feed',{});
 const pending=request(app,'/api/backups/restore',{backup,password,confirmed:true});
 try{
  if(phase==='during'){await new Promise(resolve=>setImmediate(resolve));app.feeds.active.set('review-feed',{});}
  assert.equal((await pending).status,409);assert.equal(JSON.stringify(app.store.data),original);
 }finally{app.feeds.active.delete('review-feed');await pending;}
});

for(const manager of ['feeds','recordings','finalizing'])test('tool changes refuse active '+manager+' while unrelated preferences remain editable',async t=>{
 const app=await fixture(t),map=manager==='finalizing'?app.recordings.finalizing:app[manager].active;
 app.store.update(data=>{data.settings.ffmpeg=process.execPath;});
 map.set('review-active',{});
 try{
  const denied=await request(app,'/api/settings',{ffmpeg:''},'PUT');assert.equal(denied.status,409);assert.equal(app.store.data.settings.ffmpeg,process.execPath);
  assert.equal((await request(app,'/api/settings',{ffmpeg:process.execPath},'PUT')).status,200);
  assert.equal((await request(app,'/api/settings',{operations:{maxConcurrent:4,historyLimit:500,persistSchedules:false}},'PUT')).status,200);
 }finally{map.delete('review-active');}
 assert.equal((await request(app,'/api/settings',{ffmpeg:''},'PUT')).status,200);
});

test('destination edits synchronize chat names and removal or platform changes close the old chat',async t=>{
 const app=await fixture(t),chat=app.studio.chat;
 const id=app.studio.saveChannel({name:'Original name',platform:'YouTube',url:'rtmp://localhost/live',key:'review-key'});
 const connection={id,channelId:id,name:'Original name',platform:'YouTube',status:'connected'};
 chat.connections.set(id,connection);chat.add(connection,{remoteId:'review-message',author:'Viewer',text:'Hello'});
 assert.equal((await request(app,'/api/channels/'+id,{name:'New name',platform:'YouTube',url:'rtmp://localhost/live',key:''},'PUT')).status,200);
 assert.equal(chat.connections.get(id),connection);assert.equal(connection.name,'New name');assert.equal(chat.messages[0].channelName,'New name');
 assert.equal((await request(app,'/api/channels/'+id,{name:'New name',platform:'Twitch',url:'rtmp://localhost/live',key:''},'PUT')).status,200);
 assert.equal(chat.connections.size,0);assert.equal(chat.messages.length,0);
 connection.platform='Twitch';connection.status='connected';chat.connections.set(id,connection);chat.add(connection,{remoteId:'review-next',author:'Viewer',text:'Next'});
 assert.equal((await request(app,'/api/channels/'+id,{},'DELETE')).status,200);
 assert.equal(chat.connections.size,0);assert.equal(chat.messages.length,0);assert.equal(chat.seen.size,0);
});

test('every privileged live, recording and chat route rejects unauthenticated, foreign-origin and missing-CSRF requests',async t=>{
 const app=await fixture(t),before=JSON.stringify(app.store.data);
 const routes=[
  ['POST','/api/capture/start'],['POST','/api/capture/review/chunks?sequence=0'],['POST','/api/capture/review/stop'],
  ['POST','/api/live/start'],['POST','/api/live/review/chunks?sequence=0'],['POST','/api/live/review/stop'],
  ['POST','/api/recordings/start'],['POST','/api/recordings/review/chunks?sequence=0'],['POST','/api/recordings/review/finish'],
  ['POST','/api/recordings/pick-directory'],['PUT','/api/recordings/preferences'],
  ['GET','/api/recordings/review/file'],['HEAD','/api/recordings/review/file'],
  ['GET','/api/chat'],['PUT','/api/chat/settings'],['POST','/api/chat/authorize'],['POST','/api/chat/account/disconnect'],
  ['POST','/api/chat/connect'],['POST','/api/chat/disconnect'],['POST','/api/chat/send']
 ];
 for(const [method,url]of routes){
  const body=['GET','HEAD'].includes(method)?undefined:'{}';
  assert.equal((await dispatch(app,url,{method,body,headers:{'Content-Type':'application/json','X-Go-Streams':'1'}})).status,401,method+' '+url);
  assert.equal((await dispatch(app,url,{method,body,headers:{Cookie:'go_streams='+app.token,Origin:'https://foreign.example','Content-Type':'application/json','X-Go-Streams':'1'}})).status,403,method+' '+url);
  if(body)assert.equal((await dispatch(app,url,{method,body,headers:{Cookie:'go_streams='+app.token,'Content-Type':'application/json'}})).status,403,method+' '+url);
 }
 assert.equal(JSON.stringify(app.store.data),before);assert.equal(app.feeds.active.size,0);assert.equal(app.recordings.active.size,0);assert.equal(app.studio.chat.connections.size,0);
});
