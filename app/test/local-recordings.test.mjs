import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Readable} from 'node:stream';
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
test('invalid recording data is retained locally as interrupted, rather than reported as a saved video',async t=>{
 const {root,recordings}=fixture(t),{id}=recordings.start({confirmed:true});const req=Readable.from([Buffer.from('invalid-webm')]);req.headers={'content-type':'video/webm'};await recordings.ingest(id,'0',req);await assert.rejects(recordings.finish(id),/preserved/);assert.equal(recordings.state()[0].status,'interrupted');assert.ok(fs.existsSync(path.join(root,'recordings',id+'.part')));assert.throws(()=>recordings.media(id),/Finish/);
});
test('production layouts stay within both landscape and portrait frames and fall back to available sources',()=>{
 for(const [w,h]of [[1280,720],[720,1280]])for(const layout of ['camera','screen','pip','split'])for(const sources of [[true,true],[false,true],[true,false]])for(const r of layoutRects(layout,w,h,...sources)){assert.ok(r.x>=0&&r.y>=0&&r.x+r.w<=w+1&&r.y+r.h<=h+1);assert.ok(r.w>0&&r.h>0);}
 assert.deepEqual(layoutRects('pip',1280,720,false,false),[]);
});
