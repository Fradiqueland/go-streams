import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {Store} from '../src/core.mjs';
import {Downloads} from '../src/downloads.mjs';
import {Notifications} from '../src/notifications.mjs';

function fixture(t){
 const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});
 const directory=fs.mkdtempSync(path.join(parent,'background-persistence-'));
 const store=new Store(directory),save=store.update.bind(store);let downloads,notifications;
 t.after(async()=>{store.update=save;await downloads?.shutdown();await notifications?.shutdown();assert.ok(directory.startsWith(parent+path.sep));assert.ok(path.basename(directory).startsWith('background-persistence-'));fs.rmSync(directory,{recursive:true,force:true});});
 const children=[],studio={store,vault:{decrypt:()=>''}};
 return {store,studio,children,failWrites(){store.update=()=>{throw Object.assign(Error('Controlled full disk'),{code:'ENOSPC'});};},downloads(){downloads=new Downloads(studio,{spawnProcess:()=>{const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kills=0;child.kill=()=>{child.kills++;setImmediate(()=>{child.exitCode=1;child.emit('close',1);});};children.push(child);return child;}});return downloads;},notifications(send){notifications=new Notifications(studio,{send});return notifications;}};
}

for(const line of ['TITLE:Preserved local video\n','PROGRESS: 45.0%\n'])test('download '+line.split(':')[0]+' persistence failure stops its worker without throwing from stdout',async t=>{
 const f=fixture(t),downloads=f.downloads(),item=downloads.start({url:'https://youtu.be/abcdefghijk'}),op=downloads.active.get(item.id);
 const partial=path.join(op.directory,'video.mp4.part');fs.writeFileSync(partial,'preserve interrupted bytes');
 const original=fs.readFileSync(f.store.file,'utf8');f.failWrites();
 assert.doesNotThrow(()=>f.children[0].stdout.write(line));await op.done;await downloads.shutdown();
 assert.equal(f.children[0].kills,1);assert.equal(downloads.active.size,0);
 assert.equal(f.store.data.downloads[0].status,'error');assert.equal(f.store.data.downloads[0].persistenceError,true);
 assert.match(f.store.data.downloads[0].error,/guardar/);assert.equal(fs.readFileSync(f.store.file,'utf8'),original);
 assert.equal(fs.readFileSync(partial,'utf8'),'preserve interrupted bytes');
});

test('failed terminal download save still releases done and capacity while preserving disk state and local files',async t=>{
 const f=fixture(t),downloads=f.downloads(),item=downloads.start({url:'https://youtu.be/abcdefghijk'}),op=downloads.active.get(item.id);
 const output=path.join(op.directory,'video.mp4');fs.writeFileSync(output,'recoverable output');
 const original=fs.readFileSync(f.store.file,'utf8');f.failWrites();f.children[0].exitCode=1;
 assert.doesNotThrow(()=>f.children[0].emit('close',1));await op.done;
 assert.equal(downloads.active.size,0);assert.equal(f.store.data.downloads[0].status,'error');assert.equal(f.store.data.downloads[0].persistenceError,true);
 assert.equal(fs.readFileSync(f.store.file,'utf8'),original);assert.equal(fs.readFileSync(output,'utf8'),'recoverable output');
});

test('cancel and shutdown stop both owned downloads even when every status write fails',async t=>{
 const f=fixture(t),downloads=f.downloads();
 const first=downloads.start({url:'https://youtu.be/abcdefghijk'}),second=downloads.start({url:'https://youtu.be/ABCDEFGHIJK'});
 const operations=[downloads.active.get(first.id),downloads.active.get(second.id)];
 for(const op of operations)fs.writeFileSync(path.join(op.directory,'video.mp4.part'),'partial');
 f.failWrites();assert.throws(()=>downloads.cancel(first.id),/Controlled full disk/);
 await downloads.shutdown();await Promise.all(operations.map(op=>op.done));
 assert.equal(downloads.active.size,0);assert.deepEqual(f.children.map(child=>child.kills),[1,1]);
 assert.ok(f.store.data.downloads.every(item=>item.status==='error'&&item.persistenceError));
 for(const op of operations)assert.equal(fs.readFileSync(path.join(op.directory,'video.mp4.part'),'utf8'),'partial');
});

for(const delivered of [true,false])test('SMTP '+(delivered?'delivery success':'delivery failure')+' remains explicit when local status cannot be saved',async t=>{
 const f=fixture(t);f.store.update(s=>s.notifications={enabled:true,host:'smtp.example.test',from:'studio@example.test',to:'owner@example.test'});
 let calls=0;const notifications=f.notifications(async()=>{calls++;if(!delivered)throw Error('Controlled SMTP failure');});
 const original=fs.readFileSync(f.store.file,'utf8');f.failWrites();
 const result=await notifications.test(true);
 assert.equal(calls,1);assert.equal(result.ok,false);assert.equal(result.delivered,delivered);assert.equal(result.persistenceError,true);
 assert.equal(f.store.data.notificationStatus.status,'error');assert.equal(f.store.data.notificationStatus.deliveryStatus,delivered?'sent':'error');
 assert.equal(f.store.data.notificationStatus.persistenceError,true);assert.equal(fs.readFileSync(f.store.file,'utf8'),original);
 await notifications.shutdown();
});

test('queued notifications drain once each during persistent storage failure without retrying delivered emails',async t=>{
 const f=fixture(t);f.store.update(s=>s.notifications={enabled:true,host:'smtp.example.test',from:'studio@example.test',to:'owner@example.test'});
 const subjects=[],notifications=f.notifications(async(config,message)=>subjects.push(message.subject));f.failWrites();
 for(const channelName of ['First','Second'])notifications.enqueue({channelName,playlistName:'Offline test',elapsed:0},'running');
 while(notifications.processing)await notifications.processing;
 assert.equal(subjects.length,2);assert.ok(subjects[0].includes('First'));assert.ok(subjects[1].includes('Second'));
 assert.equal(notifications.pending.length,0);assert.equal(f.store.data.notificationStatus.deliveryStatus,'sent');
});
