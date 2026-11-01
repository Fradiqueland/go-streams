import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Readable} from 'node:stream';
import {Store,Vault,Studio,runProcess} from '../src/core.mjs';
import {LocalRecordings} from '../src/local-recordings.mjs';
import {cropRect,cameraRect,frameSize,containedRect,selectionRect} from '../public/recorder-geometry.js';
import {RecordingUpload,countdown,RecorderPanel} from '../public/recorder.js';
import {uiHarness} from './ui-harness.mjs';

test('screen crops, camera squares and even output dimensions stay inside landscape and portrait frames',()=>{
 for(const [w,h]of [[1920,1080],[1080,1920],[640,360]])for(const crop of [{},{x:.8,y:.9,width:.5,height:.4},{width:0,height:0},{x:NaN,y:-10,width:20,height:Infinity}]){
  const r=cropRect(crop);assert.ok(r.x>=0&&r.y>=0&&r.x+r.width<=1&&r.y+r.height<=1);
  const f=frameSize(w,h,r);assert.equal(f.width%2,0);assert.equal(f.height%2,0);assert.ok(f.width<=1920&&f.height<=1080);
  for(const p of [{},{x:-2,y:5,size:5},{x:.5,y:.5,size:.25}]){const c=cameraRect(p,w,h);assert.equal(c.width,c.height);assert.ok(c.x>=0&&c.y>=0&&c.x+c.width<=w&&c.y+c.height<=h);}
 }
 assert.deepEqual(containedRect({left:10,top:20,width:400,height:400},1600,900),{left:10,top:107.5,width:400,height:225});
 const selected=selectionRect({x:.9,y:.8},{x:.1,y:.2});assert.equal(selected.x,.1);assert.equal(selected.width,.8);assert.ok(Math.abs(selected.height-.6)<1e-12);
});

test('cancelled countdown settles promptly without starting a recording',async()=>{
 const controller=new AbortController(),ticks=[];const waiting=countdown(10,n=>ticks.push(n),controller.signal);controller.abort();assert.equal(await waiting,false);assert.equal(ticks[0],10);assert.equal(ticks.at(-1),null);
 const ended=new AbortController();ended.abort();assert.equal(await countdown(3,()=>assert.fail(),ended.signal),false);
 assert.equal(await countdown(0,()=>{},new AbortController().signal),true);
});

test('local recording uploads are ordered, bounded and stop acknowledging failed chunks',async()=>{
 let unblock;const gate=new Promise(resolve=>{unblock=resolve;});const sent=[],errors=[];const q=new RecordingUpload(async(blob,n)=>{await gate;sent.push([blob.size,n]);},e=>errors.push(e),10);
 q.push(new Blob(['one']));q.push(new Blob(['two']));assert.equal(q.bytes,6);unblock();await q.finish();assert.deepEqual(sent,[[3,0],[3,1]]);assert.equal(q.bytes,0);
 const failed=new RecordingUpload(async()=>{throw Error('Disk full');},e=>errors.push(e));failed.push(new Blob(['data']));failed.push(new Blob(['next']));await assert.rejects(failed.finish(),/Disk full/);assert.equal(failed.sequence,1);assert.equal(failed.bytes,0);
 const overflow=new RecordingUpload(async()=>assert.fail(),e=>errors.push(e),2);overflow.push(new Blob(['too big']));await assert.rejects(overflow.finish());assert.equal(errors.length,2);
});

test('cancelling a start retains source-ended handlers and closing preview releases all devices',async()=>{
 const calls=[],panel=new RecorderPanel({api:async route=>{calls.push(route);return {};},toast(){}}),stream={getTracks:()=>[{stop(){calls.push('track-stop');}}]};
 panel.element={querySelector:()=>({srcObject:null,value:0})};panel.output=stream;panel.streams=[stream];panel.controls=()=>{};panel.status=()=>{};
 panel.starting=true;panel.countdownAbort=new AbortController();panel.startDone=Promise.resolve().then(()=>{panel.starting=false;});const generation=panel.generation;await panel.stop();assert.equal(panel.generation,generation);assert.equal(panel.countdownAbort.signal.aborted,true);
 await panel.release();assert.equal(panel.output,null);assert.ok(calls.includes('track-stop'));assert.equal(calls.filter(c=>c.startsWith('/api/')).length,0);
});

test('recorder route exists and language switching retains a prepared recorder and folder draft',async()=>{
 const h=uiHarness({locale:'en'});h.run('draw()');assert.match(h.element('#nav').innerHTML,/#recorder/);
 for(const value of ['{busy:true}','{busy:false,hasUnsavedChanges:true}']){
  let reloads=0;h.context.location.reload=()=>reloads++;h.run('recorderPanel='+value);h.element('#language-select').value='es';await h.element('#language-select').onchange({target:h.element('#language-select')});assert.equal(reloads,0);assert.equal(h.element('#language-select').value,'en');
 }
});

function fixture(t){const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});const root=fs.mkdtempSync(path.join(parent,'standalone-recorder-')),store=new Store(root),studio=new Studio(store,new Vault(root,{portable:true})),recordings=new LocalRecordings(studio,{clock:false});t.after(async()=>{await recordings.shutdown();await studio.shutdown();assert.ok(root.startsWith(parent+path.sep));fs.rmSync(root,{recursive:true,force:true});});return {root,studio,recordings};}
for(const kind of ['video','audio'])test('streamed '+kind+' recording is encoded while receiving, saved in the chosen folder and reopened',async t=>{
 const {root,studio,recordings}=fixture(t),source=path.join(root,'input.webm'),directory=path.join(root,'Chosen folder');
 await runProcess('ffmpeg',['-v','error',...(kind==='video'?['-f','lavfi','-i','testsrc2=size=320x180:rate=20']:[]),'-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1.3',...(kind==='video'?['-c:v','libvpx','-deadline','realtime']:['-vn']),'-c:a','libopus','-y',source]);
 const format=kind==='audio'?'m4a':'mp4';const {id}=recordings.start({confirmed:true,kind,format,directory});assert.ok(recordings.active.get(id).child,'Encoding must begin immediately');
 const bytes=fs.readFileSync(source);for(let n=0,at=0;at<bytes.length;n++,at+=4096){const req=Readable.from([bytes.subarray(at,at+4096)]);req.headers={'content-type':kind==='audio'?'audio/webm':'video/webm'};await recordings.ingest(id,String(n),req);}
 await recordings.finish(id);assert.equal(recordings.state()[0].status,'completed');const file=recordings.media(id);assert.equal(path.dirname(file),fs.realpathSync(directory));assert.equal(path.extname(file),'.'+format);
 const media=JSON.parse((await runProcess('ffprobe',['-v','error','-show_format','-show_streams','-of','json',file])).stdout);assert.ok(Number(media.format.duration)>1);assert.equal(media.streams.find(s=>s.codec_type==='audio').codec_name,'aac');assert.equal(media.streams.some(s=>s.codec_type==='video'),kind==='video');if(kind==='video')assert.equal(media.streams.find(s=>s.codec_type==='video').codec_name,'h264');
 const reopened=new LocalRecordings(studio,{clock:false});assert.equal(reopened.media(id),file);await reopened.shutdown();assert.ok(!fs.existsSync(path.join(directory,id+'.part')));
});

test('invalid audio/video format pairs are rejected before any files or processes are created',t=>{
 const {recordings}=fixture(t);
 for(const input of [{kind:'audio',format:'mp4'},{kind:'video',format:'m4a'},{kind:'other'},{format:'../../file'},{kind:'audio',feedId:'x'}])assert.throws(()=>recordings.start({confirmed:true,...input}),/valid recording/);
 assert.equal(recordings.items.length,0);assert.equal(recordings.active.size,0);
});
