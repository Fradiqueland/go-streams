import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Readable} from 'node:stream';
import {PassThrough,Writable} from 'node:stream';
import {EventEmitter} from 'node:events';
import {Store,Vault,Studio,runProcess} from '../src/core.mjs';
import {LocalRecordings} from '../src/local-recordings.mjs';
import {layoutRects} from '../public/live-production.js';
function fixture(t){const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});const root=fs.mkdtempSync(path.join(parent,'recording-test-')),store=new Store(root),studio=new Studio(store,new Vault(root,{portable:true})),recordings=new LocalRecordings(studio,{clock:false});t.after(async()=>{await recordings.shutdown();await studio.shutdown();assert.ok(root.startsWith(parent+path.sep));fs.rmSync(root,{recursive:true,force:true});});return {root,studio,recordings};}
test('local-only recording requires consent, preserves media and settings, finalizes once and produces a seekable WebM',async t=>{
 const {root,studio,recordings}=fixture(t),source=path.join(root,'source.webm'),original=JSON.stringify(studio.store.data);
 await runProcess('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=25','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1.2','-c:v','libvpx','-deadline','realtime','-c:a','libopus','-y',source]);
 assert.throws(()=>recordings.start(),/Confirm/);const {id}=recordings.start({confirmed:true}),bytes=fs.readFileSync(source);
 assert.throws(()=>recordings.media(id),/Finish/);
 const bad=Readable.from([bytes]);bad.headers={'content-type':'video/webm'};await assert.rejects(recordings.ingest(id,'1',bad),/in order/);
 const req=Readable.from([bytes.subarray(0,200),bytes.subarray(200)]);req.headers={'content-type':'video/webm'};await recordings.ingest(id,'0',req);
 const [a,b]=await Promise.all([recordings.finish(id),recordings.finish(id)]);assert.deepEqual(a,b);assert.equal(recordings.state()[0].status,'completed');
 const {stdout}=await runProcess('ffprobe',['-v','error','-show_format','-show_streams','-of','json',recordings.media(id)]),meta=JSON.parse(stdout);assert.ok(Number(meta.format.duration)>=1);assert.equal(meta.streams.find(s=>s.codec_type==='audio').codec_name,'opus');
 assert.equal(JSON.stringify(studio.store.data),original);assert.deepEqual(fs.readFileSync(source),bytes);assert.ok(!fs.existsSync(path.join(root,'recordings',id+'.part')));
});

test('chosen recording folder and ask preference survive restart; interrupted data is recovered from that folder',async t=>{
 const {root,studio,recordings}=fixture(t),directory=path.join(root,'Gravações escolhidas'),source=path.join(root,'sound.webm');
 await runProcess('ffmpeg',['-v','error','-f','lavfi','-i','color=c=black:s=160x90:r=25','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1.2','-c:v','libvpx','-deadline','realtime','-c:a','libopus','-y',source]);
 const preferences=recordings.configure({directory,askEveryTime:false});assert.equal(preferences.directory,fs.realpathSync(directory));assert.equal(preferences.askEveryTime,false);
 const {id}=recordings.start({confirmed:true}),request=Readable.from([fs.readFileSync(source)]);request.headers={'content-type':'video/webm'};await recordings.ingest(id,'0',request);
 const record=recordings.active.get(id);await new Promise(resolve=>{record.stream.once('close',resolve);record.stream.end();});recordings.active.delete(id);recordings.save();
 assert.ok(fs.existsSync(path.join(directory,id+'.part')));assert.ok(!fs.existsSync(path.join(root,'recordings',id+'.part')));
 const reopened=new LocalRecordings(studio,{clock:false});t.after(()=>reopened.shutdown());assert.deepEqual(reopened.preferences,preferences);await reopened.finish(id);
 assert.equal(reopened.media(id),path.join(fs.realpathSync(directory),id+'.webm'));assert.ok(!fs.existsSync(path.join(directory,id+'.part')));
 const info=JSON.parse((await runProcess('ffprobe',['-v','error','-show_format','-of','json',reopened.media(id)])).stdout);assert.ok(Number(info.format.duration)>1);
});

test('changing the default folder never relocates an active or completed recording',async t=>{
 const {root,recordings}=fixture(t),a=path.join(root,'a'),b=path.join(root,'b');recordings.execute=async(_command,args)=>fs.writeFileSync(args.at(-1),'finalized');
 recordings.configure({directory:a,askEveryTime:false});const first=recordings.start({confirmed:true});
 recordings.configure({directory:b,askEveryTime:true});const second=recordings.start({confirmed:true});
 for(const {id}of [first,second]){const request=Readable.from([Buffer.from('source')]);request.headers={'content-type':'video/webm'};await recordings.ingest(id,'0',request);await recordings.finish(id);}
 assert.equal(recordings.media(first.id),path.join(fs.realpathSync(a),first.id+'.webm'));assert.equal(recordings.media(second.id),path.join(fs.realpathSync(b),second.id+'.webm'));
 assert.equal(fs.readFileSync(recordings.media(first.id),'utf8'),'finalized');assert.equal(fs.readFileSync(recordings.media(second.id),'utf8'),'finalized');
});

test('invalid recording folders and a failed preference write preserve prior preferences and do not start workers',t=>{
 const {root,recordings}=fixture(t),before={...recordings.preferences},file=path.join(root,'a-file');fs.writeFileSync(file,'original');
 for(const directory of ['relative',file,root+'\0bad'])assert.throws(()=>recordings.configure({directory,askEveryTime:false}));
 assert.deepEqual(recordings.preferences,before);assert.equal(recordings.active.size,0);assert.equal(recordings.items.length,0);assert.equal(fs.readFileSync(file,'utf8'),'original');
 recordings.preferencesFile=root;assert.throws(()=>recordings.configure({directory:root,askEveryTime:false}));assert.deepEqual(recordings.preferences,before);
});
test('invalid recording data is retained locally as interrupted, rather than reported as a saved video',async t=>{
 const {root,recordings}=fixture(t),{id}=recordings.start({confirmed:true});const req=Readable.from([Buffer.from('invalid-webm')]);req.headers={'content-type':'video/webm'};await recordings.ingest(id,'0',req);await assert.rejects(recordings.finish(id),/preserved/);assert.equal(recordings.state()[0].status,'interrupted');assert.ok(fs.existsSync(path.join(root,'recordings',id+'.part')));assert.throws(()=>recordings.media(id),/Finish/);
});
test('production layouts stay within both landscape and portrait frames and fall back to available sources',()=>{
 for(const [w,h]of [[1280,720],[720,1280]])for(const layout of ['camera','screen','pip','split'])for(const sources of [[true,true],[false,true],[true,false]])for(const r of layoutRects(layout,w,h,...sources)){assert.ok(r.x>=0&&r.y>=0&&r.x+r.w<=w+1&&r.y+r.h<=h+1);assert.ok(r.w>0&&r.h>0);}
 assert.deepEqual(layoutRects('pip',1280,720,false,false),[]);
});

test('recording rejects oversized uploads before consuming them and cannot start during project import',async t=>{
 const {studio,recordings}=fixture(t);studio.importingProject=true;assert.throws(()=>recordings.start({confirmed:true}),error=>error.status===409);studio.importingProject=false;
 const {id}=recordings.start({confirmed:true});for(const length of [String(8*1024*1024+1),'invalid']){const req=Readable.from([Buffer.from('unread')]);req.headers={'content-type':'video/webm','content-length':length};await assert.rejects(recordings.ingest(id,'0',req),error=>error.status===413);assert.equal(recordings.active.get(id).sequence,0);assert.equal(recordings.active.get(id).receiving,false);}
});

for(const exitCode of [0,1])test('an unexpected recording worker exit '+exitCode+' becomes interrupted without reporting a partial file as complete',async t=>{
 const {root,studio,recordings}=fixture(t),child=new EventEmitter();child.stdin=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('close',1);studio.spawnProcess=()=>child;
 let detached=0,remuxed=0;studio.feeds={get:()=>({}),attach:()=>()=>{detached++;},shutdown:async()=>{}};recordings.execute=async()=>{remuxed++;};
 const {id}=recordings.start({confirmed:true,feedId:'test'}),record=recordings.active.get(id),part=path.join(root,'recordings',id+'.part');fs.writeFileSync(part,'partial-matroska');
 child.emit('close',exitCode);await record.childDone;const finalization=recordings.finalizing.get(id);assert.ok(finalization);await assert.rejects(finalization,/preserved/);
 assert.equal(detached,1);assert.equal(remuxed,0);assert.equal(recordings.active.size,0);assert.equal(recordings.finalizing.size,0);assert.equal(recordings.state()[0].status,'interrupted');assert.equal(fs.readFileSync(part,'utf8'),'partial-matroska');assert.throws(()=>recordings.media(id),/Finish/);
});

test('a recording interrupted by application restart can be recovered from its original local data',async t=>{
 const {root,studio,recordings}=fixture(t),source=path.join(root,'restart-source.webm');
 await runProcess('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=160x90:rate=15','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1.2','-c:v','libvpx','-deadline','realtime','-c:a','libopus','-y',source]);
 const {id}=recordings.start({confirmed:true}),req=Readable.from([fs.readFileSync(source)]);req.headers={'content-type':'video/webm'};await recordings.ingest(id,'0',req);
 const record=recordings.active.get(id);await new Promise(resolve=>{record.stream.once('close',resolve);record.stream.end();});recordings.active.delete(id);recordings.save();
 const reopened=new LocalRecordings(studio,{clock:false});t.after(()=>reopened.shutdown());assert.equal(reopened.state()[0].status,'interrupted');await reopened.finish(id);
 assert.equal(reopened.state()[0].status,'completed');const {stdout}=await runProcess('ffprobe',['-v','error','-show_format','-of','json',reopened.media(id)]);assert.ok(Number(JSON.parse(stdout).format.duration)>=1);assert.ok(!fs.existsSync(path.join(root,'recordings',id+'.part')));
});

for(const shared of [false,true])test('an index write failure cannot start an untracked '+(shared?'shared worker':'file writer'),t=>{
 const {studio,recordings}=fixture(t);let launches=0;studio.feeds={get:()=>({}),shutdown:async()=>{}};studio.spawnProcess=()=>{launches++;throw Error('Worker must not start');};
 const save=recordings.save.bind(recordings);recordings.save=()=>{throw Error('ENOSPC index');};
 try{assert.throws(()=>recordings.start({confirmed:true,...(shared?{feedId:'test'}:{})}));assert.equal(launches,0);assert.equal(recordings.active.size,0);assert.equal(recordings.items.length,0);}finally{recordings.save=save;}
});

test('a synchronous capture-attachment failure closes its recording worker and rolls back the index',t=>{
 const {root,studio,recordings}=fixture(t),child=new EventEmitter();child.stdin=new PassThrough();child.stderr=new PassThrough();let killed=0;child.kill=()=>{killed++;child.emit('close',1);};studio.spawnProcess=()=>child;
 studio.feeds={get:()=>({}),attach:()=>{throw Error('Feed stopped before attachment');},shutdown:async()=>{}};
 assert.throws(()=>recordings.start({confirmed:true,feedId:'test'}),/could not be started/);assert.equal(killed,1);assert.equal(child.stdin.destroyed,true);assert.equal(recordings.active.size,0);assert.equal(recordings.items.length,0);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'recordings','index.json'),'utf8')),[]);
});

test('index failure while stopping still closes the writer and preserves recoverable source data',async t=>{
 const {root,recordings}=fixture(t),{id}=recordings.start({confirmed:true}),record=recordings.active.get(id),part=path.join(root,'recordings',id+'.part');
 const req=Readable.from([Buffer.from('source-data')]);req.headers={'content-type':'video/webm'};await recordings.ingest(id,'0',req);
 const save=recordings.save.bind(recordings);recordings.save=()=>{throw Error('ENOSPC index');};
 try{await assert.rejects(recordings.finish(id));assert.equal(record.stream.closed,true);assert.equal(recordings.active.size,0);assert.equal(recordings.finalizing.size,0);assert.equal(recordings.state()[0].status,'interrupted');assert.equal(fs.readFileSync(part,'utf8'),'source-data');}finally{recordings.save=save;}
});

test('failure saving completed metadata preserves the source for retry instead of orphaning a valid output',async t=>{
 const {root,recordings}=fixture(t),{id}=recordings.start({confirmed:true}),req=Readable.from([Buffer.from('recoverable-source')]);req.headers={'content-type':'video/webm'};await recordings.ingest(id,'0',req);
 const save=recordings.save.bind(recordings);recordings.execute=async(_command,args)=>fs.writeFileSync(args.at(-1),'finalized-output');
 recordings.save=()=>{if(recordings.items[0].status==='completed')throw Error('ENOSPC completed index');return save();};
 try{await assert.rejects(recordings.finish(id));assert.equal(recordings.state()[0].status,'interrupted');assert.equal(fs.readFileSync(path.join(root,'recordings',id+'.part'),'utf8'),'recoverable-source');assert.equal(recordings.active.size,0);assert.equal(recordings.finalizing.size,0);}finally{recordings.save=save;}
 await recordings.finish(id);assert.equal(recordings.state()[0].status,'completed');assert.equal(fs.readFileSync(recordings.media(id),'utf8'),'finalized-output');
});

test('malformed recording metadata fails closed before it can break the application state panel',t=>{
 const {root,studio}=fixture(t),file=path.join(root,'recordings','index.json'),id='12345678-1234-1234-1234-123456789abc';
 for(const item of [{id},{id,created:null,status:'completed',format:'mp4',bytes:3,error:''},{id,created:new Date().toISOString(),status:'completed',format:'unknown',bytes:3,error:''}]){
  const original=JSON.stringify([item]);fs.writeFileSync(file,original);assert.throws(()=>new LocalRecordings(studio,{clock:false}),/index could not be read/);assert.equal(fs.readFileSync(file,'utf8'),original);
 }
});

test('legacy raw-WebM recording metadata retains its format and original index',async t=>{
 const {root,studio}=fixture(t),file=path.join(root,'recordings','index.json'),item={id:'12345678-1234-1234-1234-123456789abc',created:new Date().toISOString(),status:'interrupted',bytes:123};
 const original=JSON.stringify([item]);fs.writeFileSync(file,original);const reopened=new LocalRecordings(studio,{clock:false});
 try{assert.equal(reopened.state()[0].format,'webm');assert.equal(reopened.state()[0].error,'');assert.equal(fs.readFileSync(file,'utf8'),original);}finally{await reopened.shutdown();}
});

test('a recording upload finishing after Stop does not acknowledge another capture chunk',async t=>{
 const {root,recordings}=fixture(t),{id}=recordings.start({confirmed:true}),record=recordings.active.get(id);
 await new Promise(resolve=>{record.stream.once('close',resolve);record.stream.end();});
 fs.writeFileSync(path.join(root,'recordings',id+'.part'),'recoverable-source');
 let written;record.stream=new Writable({write(data,encoding,done){written=done;}});
 recordings.execute=async(_command,args)=>fs.writeFileSync(args.at(-1),'finalized-output');
 const req=Readable.from([Buffer.from('last-chunk')]);req.headers={'content-type':'video/webm'};
 const upload=recordings.ingest(id,'0',req);while(!written)await new Promise(resolve=>setImmediate(resolve));
 const stopped=recordings.finish(id),rejected=assert.rejects(upload,error=>error.status===410);written();
 await rejected;await stopped;assert.equal(record.sequence,0);assert.equal(recordings.state()[0].status,'completed');
});
