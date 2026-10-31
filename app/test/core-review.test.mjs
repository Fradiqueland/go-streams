import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {Store,Studio,Vault} from '../src/core.mjs';

function fixture(t){
 const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});
 const directory=fs.mkdtempSync(path.join(parent,'core-review-')),children=[],calls=[];
 const store=new Store(directory),studio=new Studio(store,new Vault(directory,{portable:true}),{spawnProcess(command,args){
  calls.push(args);const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();
  child.stdin=new Writable({write(chunk,encoding,done){done();setImmediate(()=>child.emit('close',0));}});
  child.kill=()=>child.emit('close',null);children.push(child);return child;
 }});
 studio.probeMedia=async media=>media;
 store.update(data=>{for(const id of ['a','b','c'])data.media.push({id,title:id.toUpperCase(),path:path.join(directory,id+'.mp4'),duration:4,width:320,height:180,fps:30,codec:'h264',audio:null});});
 const channel=studio.saveChannel({name:'Local channel',url:'rtmp://127.0.0.1:9/live',key:'test-secret'});
 const playlist=studio.savePlaylist({name:'Sequence',mediaIds:['a','b','c'],loop:true});
 t.after(async()=>{for(const child of children)child.emit('close',0);await studio.shutdown();assert.ok(directory.startsWith(parent+path.sep));assert.ok(path.basename(directory).startsWith('core-review-'));fs.rmSync(directory,{recursive:true,force:true});});
 return {studio,store,channel,playlist,children,calls};
}

test('loop continuation advances after the failed current video before repeating earlier entries',async t=>{
 const f=fixture(t),[started]=await f.studio.start({playlistId:f.playlist,channelIds:[f.channel],confirmed:true,endOnVideoFailure:false});
 const job=f.studio.jobs.get(started.id);f.children[0].stdout.write('out_time_us=5000000\n');
 assert.equal(f.studio.publicJob(job).current.mediaId,'b');
 f.children[0].stderr.write('Error while decoding stream #0');f.children[0].emit('close',1);
 assert.equal(f.children.length,2);assert.deepEqual(job.skippedVideos.map(item=>item.id),['b']);
 assert.equal(f.studio.publicJob(job).current.mediaId,'c');
 f.children[1].stdout.write('out_time_us=4000000\n');assert.equal(f.studio.publicJob(job).current.mediaId,'a');
 f.children[1].stdout.write('out_time_us=8000000\n');assert.equal(f.studio.publicJob(job).current.mediaId,'c');
 assert.equal(job.elapsed,13);assert.deepEqual(f.store.data.playlists[0].mediaIds,['a','b','c']);
});

test('saved playlists detach caller-owned queue arrays from the persisted project',t=>{
 const f=fixture(t),mediaIds=['a','b'];f.studio.savePlaylist({name:'Saved order',mediaIds},f.playlist);
 mediaIds.splice(0,2,'missing');
 assert.deepEqual(f.store.data.playlists[0].mediaIds,['a','b']);
 assert.deepEqual(new Store(f.store.directory).data.playlists[0].mediaIds,['a','b']);
});

test('schedule inputs and returned schedules cannot change an already saved destination or authorization',t=>{
 const f=fixture(t),channelIds=[f.channel],schedule=f.studio.schedule({mediaId:'a',channelIds,at:'2099-01-01T00:00:00Z'});
 channelIds[0]='missing';schedule.armed=true;schedule.mediaId='b';
 const saved=f.store.data.schedules[0];assert.deepEqual(saved.channelIds,[f.channel]);assert.equal(saved.armed,false);assert.equal(saved.mediaId,'a');
 assert.deepEqual(JSON.parse(JSON.stringify(saved)),new Store(f.store.directory).data.schedules[0]);
});

test('returned channel preparations and retained Store drafts cannot mutate committed data',t=>{
 const f=fixture(t),plan=f.studio.saveChannelPlan(f.channel,{mediaId:'a',countdown:0});
 plan.mediaId='missing';assert.equal(f.store.data.channelPlans[f.channel].mediaId,'a');
 let draft;const returned=f.store.update(data=>{draft=data;return data.media[0];});
 draft.media.length=0;returned.title='Changed without saving';
 assert.equal(f.store.data.media.length,3);assert.equal(f.store.data.media[0].title,'A');
 assert.equal(new Store(f.store.directory).data.media[0].title,'A');
});

test('a queued video whose duration changed becomes protected when it starts during draining',async t=>{
 const f=fixture(t),[started]=await f.studio.start({playlistId:f.playlist,channelIds:[f.channel],confirmed:true});
 const job=f.studio.jobs.get(started.id);f.children[0].stdout.write('out_time_us=3000000\n');
 f.studio.probeMedia=async media=>({...media,duration:media.id==='b'?8:media.duration});
 f.children[0].stdin=new Writable({write(chunk,encoding,done){done();f.children[0].stdout.write('out_time_us=5000000\n');setImmediate(()=>f.children[0].emit('close',0));}});
 await assert.rejects(f.studio.reconfigure(job.id,{mediaIds:['a','b','c'],confirmed:true}),error=>error.status===409);
 assert.equal(job.status,'paused');assert.equal(f.children.length,1);assert.equal(f.studio.publicJob(job).current.mediaId,'b');
 assert.equal(f.studio.contexts.get(job.id).media[1].duration,4);
});

function emptyProject(f,{status,plan=false}={}){
 return {version:1,media:[],channels:f.studio.state().channels.map(({hasKey,...channel})=>channel),playlists:[{id:'empty',name:'Empty',mediaIds:[]}],
  schedules:status===undefined&&plan?[]:[{id:'scheduled',playlistId:'empty',channelIds:[f.channel],at:'2099-01-01T00:00:00Z',status,armed:true}],
  channelPlans:plan?{[f.channel]:{playlistId:'empty',countdown:0}}:{}};
}

for(const status of [undefined,'pending','starting'])test('imported '+(status||'unclassified')+' schedules reject empty playlists atomically',async t=>{
 const f=fixture(t),before=fs.readFileSync(f.store.file,'utf8');
 await assert.rejects(f.studio.importProject(emptyProject(f,{status})),/playlist|agendamento/i);
 assert.equal(fs.readFileSync(f.store.file,'utf8'),before);assert.equal(f.store.data.playlists.length,1);
});

for(const status of ['triggered','cancelled','interrupted','error','missed'])test('imported '+status+' schedule history stays disarmed and retains terminal status for an empty playlist',async t=>{
 const f=fixture(t);await f.studio.importProject(emptyProject(f,{status}));
 assert.equal(f.store.data.schedules[0].status,status);assert.equal(f.store.data.schedules[0].armed,false);
 assert.equal(f.store.data.playlists.find(item=>item.id===f.store.data.schedules[0].playlistId).mediaIds.length,0);
});

test('imported channel preparations reject empty playlists before saving any entities',async t=>{
 const f=fixture(t),before=fs.readFileSync(f.store.file,'utf8');
 await assert.rejects(f.studio.importProject(emptyProject(f,{plan:true})),/canal|playlist/i);
 assert.equal(fs.readFileSync(f.store.file,'utf8'),before);assert.equal(f.store.data.playlists.length,1);
});
