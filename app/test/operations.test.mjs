import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createApplication} from '../src/server.mjs';
import {Store,Studio} from '../src/core.mjs';
import {validateOperations} from '../src/operations.mjs';
import {dispatch} from './transport.mjs';
import {uiHarness} from './ui-harness.mjs';
const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});
async function fixture(t){
 const directory=fs.mkdtempSync(path.join(parent,'operations-')),sent=[];
 const app=await createApplication({directory,listen:false,clock:false,portableVault:true,notificationOptions:{send:async(config,message)=>sent.push(message)}});
 t.after(async()=>{await app.close();if(!directory.startsWith(parent+path.sep)||!path.basename(directory).startsWith('operations-'))throw Error('Unsafe cleanup');fs.rmSync(directory,{recursive:true,force:true});});
 const request=(url,body,method='PUT')=>dispatch(app,url,{method,body:JSON.stringify(body),headers:{Cookie:'go_streams='+app.token,'Content-Type':'application/json','X-Go-Streams':'1'}});
 app.notifications.save({enabled:true,host:'smtp.example.test',port:587,username:'',password:'',from:'studio@example.test',to:'owner@example.test'});
 const cid=app.studio.saveChannel({name:'Local',url:'rtmp://127.0.0.1:9/live',key:'PRIVATE-KEY',platform:'TikTok'});
 app.store.update(s=>s.media.push({id:'m',title:'Clip',duration:5,path:path.join(directory,'missing.mp4')}));
 const addSchedule=(offset=-1000)=>app.store.update(s=>s.schedules.push({id:'s',mediaId:'m',channelIds:[cid],status:'pending',armed:true,at:new Date(Date.now()+offset).toISOString(),timeZone:'UTC'}));
 return{app,sent,request,cid,addSchedule};
}
for(const scenario of ['missing-key','missed','busy','capacity'])test('schedule '+scenario+' reports once before any new media process',async t=>{
 const {app,sent,cid,addSchedule}=await fixture(t);addSchedule(scenario==='missed'?-120000:-1000);
 if(scenario==='missing-key')app.store.update(s=>s.channels[0].secret='');
 if(scenario==='busy')app.studio.jobs.set('busy',{id:'busy',channelId:cid,status:'running'});
 if(scenario==='capacity'){app.store.update(s=>s.settings.operations={maxConcurrent:1,historyLimit:500,persistSchedules:false});app.studio.jobs.set('other',{id:'other',channelId:'another',status:'running'});}
 await app.studio.tick();await app.notifications.processing;await app.studio.tick();
 assert.equal(sent.length,1);assert.match(sent[0].body,/Clip/);assert.match(sent[0].body,/Local/);assert.ok(!JSON.stringify(sent).includes('PRIVATE-KEY'));
 assert.equal(app.store.data.schedules[0].status,scenario==='missed'?'missed':'error');assert.equal(app.store.data.history.filter(h=>h.kind==='schedule').length,1);
 app.studio.jobs.clear();
});
test('probe failure sends its job alert without a duplicate schedule email',async t=>{
 const {app,sent,addSchedule}=await fixture(t);addSchedule();await app.studio.tick();await app.notifications.processing;
 assert.equal(app.studio.jobs.size,1);assert.equal(sent.length,1);assert.equal(app.store.data.schedules[0].status,'error');
 assert.equal(app.store.data.history.filter(h=>h.kind==='session').length,1);
});
test('disabled notifications still preserve a missed schedule in history',async t=>{
 const {app,sent,addSchedule}=await fixture(t);app.store.update(s=>s.notifications.enabled=false);addSchedule(-120000);await app.studio.tick();
 assert.equal(sent.length,0);assert.equal(app.store.data.history[0].result,'missed');
});
test('settings API validates atomically and requires deliberate scheduling persistence',async t=>{
 const {app,request}=await fixture(t);const operations={maxConcurrent:0,historyLimit:5000,persistSchedules:true};
 let result=await request('/api/settings',{operations});assert.equal(result.status,400);assert.equal(app.store.data.settings.operations,undefined);
 result=await request('/api/settings',{operations,confirmed:true});assert.equal(result.status,200);assert.deepEqual(app.store.data.settings.operations,operations);
 const before=structuredClone(app.store.data.settings);
 for(const bad of [{...operations,maxConcurrent:-1},{...operations,maxConcurrent:1.5},{...operations,maxConcurrent:'6'},{...operations,historyLimit:0},{...operations,persistSchedules:'yes'}]){
  result=await request('/api/settings',{operations:bad,confirmed:true});assert.equal(result.status,400);assert.deepEqual(app.store.data.settings,before);
 }
});
test('restart preserves only authorized pending schedules when opted in; default remains disarmed',async t=>{
 const {app}=await fixture(t);
 for(const persistSchedules of [true,false]){
  app.store.update(s=>{s.settings.operations={maxConcurrent:6,historyLimit:500,persistSchedules};s.schedules=[{id:'a',status:'pending',armed:true},{id:'b',status:'pending',armed:false},{id:'c',status:'starting',armed:true}];});
  const reopened=new Studio(new Store(app.store.directory),app.studio.vault);
  assert.equal(reopened.store.data.schedules[0].armed,persistSchedules);assert.equal(reopened.store.data.schedules[1].armed,false);
  assert.equal(reopened.store.data.schedules[2].status,'interrupted');assert.equal(reopened.store.data.schedules[2].armed,false);
  await reopened.shutdown();
 }
});
test('removing concurrency cap permits seven reservations but retains busy-channel protection',async t=>{
 const {app,cid}=await fixture(t);const ids=[cid];
 for(let i=1;i<7;i++)ids.push(app.studio.saveChannel({name:'Canal '+i,url:'rtmp://127.0.0.1:9/live',key:'KEY-'+i}));
 await assert.rejects(app.studio.start({mediaId:'m',channelIds:ids,confirmed:true}),/limite configurado/);assert.equal(app.studio.jobs.size,0);
 app.store.update(s=>s.settings.operations={maxConcurrent:0,historyLimit:500,persistSchedules:false});
 await assert.rejects(app.studio.start({mediaId:'m',channelIds:ids,confirmed:true}));assert.equal(app.studio.jobs.size,7);
 app.studio.jobs.set('busy',{id:'busy',channelId:cid,status:'paused'});
 assert.throws(()=>app.studio.selection(null,[cid],false,{mediaId:'m'}),/transmitir/);app.studio.jobs.delete('busy');
});
test('history retention uses configured count and keeps newest events',()=>{
 for(const historyLimit of [500,5000,50000]){
  const store={data:{settings:{operations:{historyLimit}},history:Array.from({length:historyLimit},(_,id)=>({id}))},update(fn){fn(this.data);}};
  Store.prototype.log.call(store,'info','new');assert.equal(store.data.history.length,historyLimit);assert.equal(store.data.history[0].message,'new');assert.equal(store.data.history.at(-1).id,historyLimit-2);
 }
 assert.throws(()=>validateOperations({maxConcurrent:257,historyLimit:500,persistSchedules:false}));
});
test('operation form saves through real API, keeps other drafts and exposes TikTok',async t=>{
 const {app}=await fixture(t);
 const h=uiHarness({fetch:(url,init={})=>dispatch(app,url,{...init,headers:{Cookie:'go_streams='+app.token,...init.headers}})});
 h.run('state='+JSON.stringify(app.studio.state()));h.run("page='settings'");
 const draft=h.fields('notification-form',{host:'unsaved.example.test',password:'DRAFT'});await h.emit('input',draft.elements[0]);
 await h.submit({maxConcurrent:'12',historyLimit:'5000',persistSchedules:true},'operation-form');
 assert.deepEqual(app.store.data.settings.operations,{maxConcurrent:12,historyLimit:5000,persistSchedules:true});
 assert.equal(h.run("settingsDrafts.has('notification-form')"),true);assert.equal(draft.elements.namedItem('password').value,'DRAFT');
 assert.ok(h.run('settings()').includes('Guardar operação'));
 h.run('channelForm()');assert.ok(h.element('#dialog-content').innerHTML.includes('TikTok'));
});

test('schedule failures have their own history filter and never appear as completed broadcasts',()=>{
 const h=uiHarness();h.run("state.history=[{kind:'schedule',result:'missed',time:'2026-10-24T12:00:00Z',playlist:'Missed unique source',message:'Schedule missed'}]");
 assert.ok(h.run('history()').includes('Agendamento'));assert.ok(h.run('history()').includes('Missed unique source'));
 assert.ok(!h.run('dashboard()').includes('Missed unique source'));
 assert.equal(h.run("filterHistory(state.history,{kind:'schedule'}).length"),1);
 assert.equal(h.run("filterHistory(state.history,{kind:'session'}).length"),0);
});

test('notification form saves TLS 465 through the real API without sending while disabled',async t=>{
 const {app,sent}=await fixture(t);
 const h=uiHarness({fetch:(url,init={})=>dispatch(app,url,{...init,headers:{Cookie:'go_streams='+app.token,...init.headers}})});
 h.run('state='+JSON.stringify(app.studio.state()));
 await h.submit({enabled:false,security:'tls',port:'465',host:'smtp.example.test',username:'',password:'',from:'sender@example.test',to:'recipient@example.test'},'notification-form');
 assert.equal(app.store.data.notifications.security,'tls');assert.equal(app.store.data.notifications.port,465);assert.equal(app.store.data.notifications.enabled,false);assert.equal(sent.length,0);
 assert.ok(h.run('settings()').includes('TLS direto'));
});
