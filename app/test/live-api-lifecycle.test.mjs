import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createApplication} from '../src/server.mjs';
import {exportBackup} from '../src/backups.mjs';
import {dispatch} from './transport.mjs';

async function fixture(t){
 const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});
 const directory=fs.mkdtempSync(path.join(parent,'live-api-review-'));
 const app=await createApplication({directory,listen:false,clock:false,portableVault:true});
 t.after(async()=>{await app.close();assert.ok(directory.startsWith(parent+path.sep));fs.rmSync(directory,{recursive:true,force:true});});
 return app;
}
function request(app,url,body,method='POST'){
 return dispatch(app,url,{method,headers:{Cookie:'go_streams='+app.token,'Content-Type':'application/json','X-Go-Streams':'1'},body:JSON.stringify(body)});
}

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
