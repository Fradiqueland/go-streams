import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {Readable,Writable} from 'node:stream';
import {CaptureFeeds} from '../src/capture-feeds.mjs';
import {LocalRecordings} from '../src/local-recordings.mjs';
import {runProcess,toolsFor} from '../src/core.mjs';

async function ingest(target,id,sequence,data){
 const request=Readable.from([data]);request.headers={'content-type':'video/webm'};
 await target.ingest(id,String(sequence),request);
}

test('an independent short recording retains its final frames while the live encoder keeps accepting media',{timeout:60000},async t=>{
 const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});
 const directory=fs.mkdtempSync(path.join(parent,'review16-independent-output-'));
 const {ffmpeg,ffprobe}=toolsFor({}),short=path.join(directory,'short.webm'),long=path.join(directory,'long.webm');
 let feeds,recordings,liveEncoder,liveBytes=0;const liveChunks=[],workers=[];
 t.after(async()=>{
  const stopped=await Promise.allSettled([recordings?.shutdown(),feeds?.shutdown()]);
  for(const {child}of workers)if(child.exitCode===null&&child.signalCode===null)child.kill();
  await Promise.all(workers.map(worker=>worker.closed));
  assert.equal(path.dirname(directory),parent);fs.rmSync(directory,{recursive:true,force:true});
  for(const result of stopped)if(result.status==='rejected')throw result.reason;
 });
 const generated=await Promise.allSettled([
  runProcess(ffmpeg,['-v','error','-f','lavfi','-i','color=c=red:size=320x240:rate=30:d=0.4','-f','lavfi','-i','color=c=green:size=320x240:rate=30:d=0.2','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[v]','-map','[v]','-map','2:a','-t','0.6','-c:v','libvpx','-deadline','realtime','-c:a','libopus','-f','webm','-y',short],{timeout:20000}),
  runProcess(ffmpeg,['-v','error','-f','lavfi','-i','testsrc2=size=320x240:rate=30','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','4','-c:v','libvpx','-g','15','-deadline','realtime','-c:a','libopus','-cluster_time_limit','500','-f','webm','-y',long],{timeout:20000})
 ]);
 for(const result of generated)if(result.status==='rejected')throw result.reason;
 const studio={store:{directory,data:{settings:{}}},spawnProcess(binary,args,options){
  const child=spawn(binary,args,options),closed=new Promise(resolve=>child.once('close',resolve));workers.push({child,closed});
  if(args.at(-1)==='pipe:1')liveEncoder=child;return child;
 }};
 feeds=new CaptureFeeds(studio,{clock:false});recordings=new LocalRecordings(studio,{clock:false});
 const feed=feeds.create({confirmed:true,source:'camera',quality:'720p',aspect:'16:9'});
 feeds.attach(feed.id,new Writable({write(data,_encoding,done){liveBytes+=data.length;liveChunks.push(Buffer.from(data));done();}}),()=>{});
 async function liveOutputAfter(bytes){
  if(liveBytes>bytes)return;
  await new Promise((resolve,reject)=>{
   const done=()=>{if(liveBytes<=bytes)return;cleanup();resolve();},fail=()=>{cleanup();reject(Error('Live encoder closed unexpectedly'));};
   const timer=setTimeout(()=>{cleanup();reject(Error('Live encoder produced no further output'));},15000);
   const cleanup=()=>{clearTimeout(timer);liveEncoder.stdout.removeListener('data',done);liveEncoder.removeListener('close',fail);};
   liveEncoder.stdout.on('data',done);liveEncoder.on('close',fail);
  });
 }
 const liveData=fs.readFileSync(long),split=Math.floor(liveData.length/2);
 await ingest(feeds,feed.id,0,liveData.subarray(0,split));await liveOutputAfter(0);
 // A separate local input can reach EOF and drain without closing the live
 // encoder. Stop immediately after upload; do not wait for output or a timer.
 const take=recordings.start({confirmed:true,format:'mp4'}),recordedData=fs.readFileSync(short),middle=Math.floor(recordedData.length/2);
 await ingest(recordings,take.id,0,recordedData.subarray(0,middle));await ingest(recordings,take.id,1,recordedData.subarray(middle));
 await recordings.finish(take.id);
 assert.equal(recordings.state()[0].status,'completed');assert.equal(liveEncoder.exitCode,null);assert.equal(liveEncoder.killed,false);
 assert.equal(workers.length,2,'Local recording and live output must have independent encoders');
 const media=recordings.media(take.id),info=JSON.parse((await runProcess(ffprobe,['-v','error','-count_frames','-show_format','-show_streams','-of','json',media],{timeout:15000})).stdout);
 const video=info.streams.find(stream=>stream.codec_type==='video'),audio=info.streams.find(stream=>stream.codec_type==='audio');
 assert.equal(video.codec_name,'h264');assert.equal(audio.codec_name,'aac');
 assert.equal(Number(video.nb_read_frames),18,'All frames from the short recording must survive immediate Stop');assert.ok(Number(info.format.duration)>=.58);
 const pixelFile=path.join(directory,'frame-pixels.rgb');
 // Decode every frame: seeking near EOF can round beyond the last frame in
 // supported FFmpeg versions, even when the complete recording is present.
 await runProcess(ffmpeg,['-v','error','-i',media,'-vf','format=rgb24,crop=1:1:0:0','-an','-f','rawvideo','-y',pixelFile],{timeout:15000});
 const pixels=fs.readFileSync(pixelFile);assert.equal(pixels.length,18*3,'Every saved frame must decode to one RGB pixel');
 const pixel=[...pixels.subarray(-3)];
 assert.ok(pixel[1]>pixel[0]+50&&pixel[1]>pixel[2]+50,'The final green frames must survive Stop');
 const beforeTail=liveBytes;await ingest(feeds,feed.id,1,liveData.subarray(split));await liveOutputAfter(beforeTail);
 assert.equal(liveEncoder.exitCode,null,'Saving the recording must leave live output running');
 await feeds.stop(feed.id);const liveFile=path.join(directory,'live.ts');fs.writeFileSync(liveFile,Buffer.concat(liveChunks));
 const liveInfo=JSON.parse((await runProcess(ffprobe,['-v','error','-show_format','-of','json',liveFile],{timeout:15000})).stdout);
 assert.ok(Number(liveInfo.format.duration)>3.9,'The ongoing live feed must retain media accepted after local Stop');
});
