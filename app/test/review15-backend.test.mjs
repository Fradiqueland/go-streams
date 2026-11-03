import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Store,Vault,Studio} from '../src/core.mjs';
import {Notifications} from '../src/notifications.mjs';

const mail={enabled:true,host:'smtp.example.test',port:587,security:'starttls',username:'owner@example.test',from:'owner@example.test',to:'recipient@example.test',password:'SMTP-OLD-PRIVATE'};
const identities=[{host:'smtp.other.test'},{username:'other@example.test'},{port:2525},{security:'tls'}];

function fixture(t){
  const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});
  const directory=fs.mkdtempSync(path.join(parent,'review15-backend-'));
  const store=new Store(directory),studio=new Studio(store,new Vault(directory,{portable:true})),sent=[];
  const notifications=new Notifications(studio,{send:async(config,message)=>{sent.push({config,message});}});
  t.after(async()=>{
    await notifications.shutdown();await studio.shutdown();
    assert.ok(directory.startsWith(parent+path.sep));assert.ok(path.basename(directory).startsWith('review15-backend-'));
    fs.rmSync(directory,{recursive:true,force:true});
  });
  return {store,studio,notifications,sent};
}

test('changing an authenticated SMTP identity never reuses the previous password or changes saved settings',async t=>{
  const f=fixture(t);f.notifications.save(mail);
  const before=JSON.stringify(f.store.data),disk=fs.readFileSync(f.store.file,'utf8');
  for(const identity of identities){
    assert.throws(()=>f.notifications.save({...mail,...identity,password:''}),/novamente a palavra-passe/);
    assert.equal(JSON.stringify(f.store.data),before);assert.equal(fs.readFileSync(f.store.file,'utf8'),disk);
  }
  assert.equal(f.sent.length,0);
  assert.equal((await f.notifications.test(true)).ok,true);
  assert.equal(f.sent[0].config.host,mail.host);assert.equal(f.sent[0].config.password,mail.password);
});

test('unchanged SMTP credentials survive ordinary edits, host case and legacy default TLS mode',async t=>{
  const f=fixture(t);f.notifications.save(mail);const secret=f.store.data.notifications.secret;
  f.store.update(s=>{delete s.notifications.security;});
  f.notifications.save({...mail,host:'SMTP.EXAMPLE.TEST',username:' owner@example.test ',to:'new-recipient@example.test',password:''});
  assert.equal(f.store.data.notifications.secret,secret);assert.equal(f.notifications.publicSettings().hasPassword,true);
  assert.equal((await f.notifications.test(true)).ok,true);
  assert.equal(f.sent[0].config.password,mail.password);assert.equal(f.sent[0].config.to,'new-recipient@example.test');
});

test('disabled SMTP identity changes discard the old password before later activation',t=>{
  const f=fixture(t);
  for(const identity of identities){
    f.notifications.save(mail);f.notifications.save({...mail,...identity,enabled:false,password:''});
    assert.equal(f.store.data.notifications.secret,'');assert.equal(f.notifications.publicSettings().hasPassword,false);
    const before=JSON.stringify(f.store.data);
    assert.throws(()=>f.notifications.save({...mail,...identity,enabled:true,password:''}),/palavra-passe SMTP/);
    assert.equal(JSON.stringify(f.store.data),before);
  }
  assert.equal(f.sent.length,0);
});

test('SMTP changes permit anonymous delivery without exposing a previously stored password',async t=>{
  const f=fixture(t);f.notifications.save(mail);
  f.notifications.save({...mail,host:'smtp.anonymous.test',username:'',password:''});
  assert.equal(f.store.data.notifications.secret,'');
  assert.equal((await f.notifications.test(true)).ok,true);
  assert.equal(f.sent[0].config.host,'smtp.anonymous.test');assert.equal(f.sent[0].config.username,'');assert.equal(f.sent[0].config.password,'');
});

test('explicit replacement SMTP credentials are encrypted and used only with the new identity',async t=>{
  const f=fixture(t);f.notifications.save(mail);
  f.notifications.save({...mail,host:'smtp.other.test',username:'new-owner',password:'SMTP-NEW-PRIVATE'});
  assert.equal(f.sent.length,0);assert.equal((await f.notifications.test(true)).ok,true);
  assert.equal(f.sent[0].config.host,'smtp.other.test');assert.equal(f.sent[0].config.username,'new-owner');assert.equal(f.sent[0].config.password,'SMTP-NEW-PRIVATE');
  assert.ok(!fs.readFileSync(f.store.file,'utf8').includes('SMTP-NEW-PRIVATE'));assert.ok(!JSON.stringify(f.notifications.publicSettings()).includes('SMTP-NEW-PRIVATE'));
});

test('a failed SMTP credential replacement preserves the old account in memory and on disk',async t=>{
  const f=fixture(t);f.notifications.save(mail);
  const before=JSON.stringify(f.store.data),disk=fs.readFileSync(f.store.file,'utf8'),update=f.store.update.bind(f.store);
  f.store.update=()=>{throw Object.assign(Error('Controlled full disk'),{code:'ENOSPC'});};
  try{assert.throws(()=>f.notifications.save({...mail,host:'smtp.other.test',password:'SMTP-NEW-PRIVATE'}),/Controlled full disk/);}
  finally{f.store.update=update;}
  assert.equal(JSON.stringify(f.store.data),before);assert.equal(fs.readFileSync(f.store.file,'utf8'),disk);
  assert.equal((await f.notifications.test(true)).ok,true);assert.equal(f.sent[0].config.host,mail.host);assert.equal(f.sent[0].config.password,mail.password);
});

function importedProject(at){
  return {version:1,media:[{id:'source-video',title:'Imported video',source:'https',path:'https://media.example.test/video.mp4'}],
    channels:[{id:'source-channel',name:'Imported channel',platform:'YouTube',url:'rtmps://stream.example.test/live'}],playlists:[],
    schedules:[{id:'source-schedule',mediaId:'source-video',channelIds:['source-channel'],at,timeZone:'UTC',status:'pending',armed:true}]};
}
function fakeProbe(studio){
  // Project validation is exercised without fetching a remote video or running tools.
  studio.probeMedia=async media=>({...media,duration:12,width:320,height:180,fps:30,codec:'h264',size:0,audio:null});
}

test('project imports reject coercible non-string schedule dates before committing any project data',async t=>{
  const f=fixture(t);fakeProbe(f.studio);f.studio.savePlaylist({name:'Existing list',mediaIds:[]});
  const before=JSON.stringify(f.store.data),disk=fs.readFileSync(f.store.file,'utf8');
  for(const at of [null,false,true,0,4102444800000,['2099-01-01T00:00:00Z']]){
    await assert.rejects(f.studio.importProject(importedProject(at)),/Data de agendamento inválida/);
    assert.equal(JSON.stringify(f.store.data),before);assert.equal(fs.readFileSync(f.store.file,'utf8'),disk);
    assert.equal(f.studio.importingProject,false);assert.equal(f.studio.pendingImports.size,0);
  }
});

test('valid project schedule dates still import as normalized and unarmed schedules',async t=>{
  const f=fixture(t);fakeProbe(f.studio);
  const result=await f.studio.importProject(importedProject('2099-01-01T12:00:00+01:00'));
  assert.deepEqual(result,{media:1,channels:1,playlists:0,schedules:1});
  const schedule=f.store.data.schedules[0];
  assert.equal(schedule.at,'2099-01-01T11:00:00.000Z');assert.equal(schedule.armed,false);assert.equal(schedule.status,'pending');
  assert.equal(schedule.mediaId,f.store.data.media[0].id);assert.equal(schedule.channelIds[0],f.store.data.channels[0].id);
  assert.equal(f.studio.importingProject,false);assert.equal(f.studio.pendingImports.size,0);
});
