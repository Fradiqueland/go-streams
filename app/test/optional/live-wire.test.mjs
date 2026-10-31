import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {Store,Vault,Studio,runProcess,toolsFor} from '../../src/core.mjs';
import {LiveCapture} from '../../src/live-capture.mjs';
import {Readable} from 'node:stream';
import {CaptureFeeds} from '../../src/capture-feeds.mjs';
import {LocalRecordings} from '../../src/local-recordings.mjs';

async function port(){const s=net.createServer();await new Promise((resolve,reject)=>{s.once('error',reject);s.listen(0,'127.0.0.1',resolve);});const p=s.address().port;await new Promise(resolve=>s.close(resolve));return p;}
test('native WebM capture reaches two RTMP loopback receivers as H.264/AAC', {timeout:45000},async t=>{
 const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});const root=fs.mkdtempSync(path.join(parent,'live-wire-'));
 const store=new Store(root),studio=new Studio(store,new Vault(root,{portable:true})),live=new LiveCapture(studio,{clock:false});
 const {ffmpeg,ffprobe}=toolsFor(store.data.settings),receivers=[];
 t.after(async()=>{await studio.shutdown();for(const r of receivers)if(r.child.exitCode===null)r.child.kill();await Promise.all(receivers.map(r=>r.done));assert.ok(root.startsWith(parent+path.sep));fs.rmSync(root,{recursive:true,force:true});});
 const file=path.join(root,'capture.webm');
 await runProcess(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=320x180:rate=30','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','3','-c:v','libvpx','-deadline','realtime','-cpu-used','8','-c:a','libopus','-f','webm','-y',file]);
 for(let i=0;i<2;i++){
  const p=await port(),output=path.join(root,`destination-${i}.flv`),url=`rtmp://127.0.0.1:${p}/live`,key=`loopback-${i}`;
  const child=spawn(ffmpeg,['-hide_banner','-loglevel','warning','-listen','1','-timeout','15','-i',`${url}/${key}`,'-c','copy','-f','flv','-y',output],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  let errors='';child.stderr.on('data',d=>{errors+=d.toString();});
  const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>resolve({code,errors}));});
  receivers.push({child,output,done});studio.saveChannel({name:`Destination ${i}`,url,key});
 }
 await delay(700);
 const session=live.start({channelIds:store.data.channels.map(c=>c.id),confirmed:true,source:'camera',quality:'720p',aspect:'16:9',mimeType:'video/webm;codecs=vp8,opus'});
 const bytes=fs.readFileSync(file);let sequence=0;
 for(let offset=0;offset<bytes.length;offset+=30000){const req=Readable.from([bytes.subarray(offset,offset+30000)]);req.headers={'content-type':'video/webm'};await live.ingest(session.id,String(sequence++),req);}
 await delay(1000);live.stop(session.id);
 await Promise.all(session.jobs.map(j=>studio.jobs.get(j.id).completion));
 for(const job of session.jobs)assert.ok(studio.jobs.get(job.id).elapsed>0,studio.jobs.get(job.id).error);
 for(const r of receivers){await r.done;const {stdout}=await runProcess(ffprobe,['-v','error','-show_streams','-of','json',r.output]);const streams=JSON.parse(stdout).streams;assert.equal(streams.find(s=>s.codec_type==='video').codec_name,'h264');assert.equal(streams.find(s=>s.codec_type==='audio').codec_name,'aac');}
});

test('one capture encoder feeds simultaneous RTMP destinations and independent local MP4 recording',{timeout:45000},async t=>{
 const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});const root=fs.mkdtempSync(path.join(parent,'live-wire-'));
 const store=new Store(root),studio=new Studio(store,new Vault(root,{portable:true})),feeds=new CaptureFeeds(studio,{clock:false}),live=new LiveCapture(studio,{clock:false}),recordings=new LocalRecordings(studio,{clock:false});studio.recordings=recordings;
 const {ffmpeg,ffprobe}=toolsFor(store.data.settings),receivers=[];
 t.after(async()=>{await studio.shutdown();for(const r of receivers)if(r.child.exitCode===null)r.child.kill();await Promise.allSettled(receivers.map(r=>r.done));assert.ok(root.startsWith(parent+path.sep));fs.rmSync(root,{recursive:true,force:true});});
 const file=path.join(root,'capture.webm');await runProcess(ffmpeg,['-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=30','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','8','-c:v','libvpx','-deadline','realtime','-cpu-used','8','-c:a','libopus','-y',file]);
 for(let i=0;i<2;i++){const p=await port(),url=`rtmp://127.0.0.1:${p}/live`,key=`shared-${i}`,output=path.join(root,`receiver-${i}.flv`),child=spawn(ffmpeg,['-hide_banner','-loglevel','error','-listen','1','-timeout','20','-i',`${url}/${key}`,'-c','copy','-f','flv','-y',output],{windowsHide:true,stdio:['ignore','ignore','ignore']});const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});receivers.push({child,done,output});studio.saveChannel({name:`Receiver ${i}`,url,key});}
 await delay(500);const config={source:'camera',quality:'720p',aspect:'16:9',confirmed:true},feed=feeds.create(config),recording=recordings.start({confirmed:true,feedId:feed.id}),bytes=fs.readFileSync(file),half=Math.floor(bytes.length/2);
 const first=Readable.from([bytes.subarray(0,half)]);first.headers={'content-type':'video/webm'};await feeds.ingest(feed.id,'0',first);await delay(500);
 const session=live.start({...config,feedId:feed.id,mimeType:'video/webm;codecs=vp8,opus',channelIds:store.data.channels.map(c=>c.id)});
 const req=Readable.from([bytes.subarray(half)]);req.headers={'content-type':'video/webm'};await feeds.ingest(feed.id,'1',req);
 const start=Date.now();while([...studio.jobs.values()].some(j=>j.frame<1)){if(Date.now()-start>10000)throw Error('Shared capture did not produce live frames: '+JSON.stringify(studio.state().jobs));await delay(100);}
 live.stop(session.id);await Promise.all(session.jobs.map(j=>studio.jobs.get(j.id).completion));assert.equal(recordings.active.has(recording.id),true);
 await recordings.finish(recording.id);assert.equal(recordings.state()[0].status,'completed');assert.ok(recordings.media(recording.id).endsWith('.mp4'));
 const {stdout}=await runProcess(ffprobe,['-v','error','-show_streams','-show_format','-of','json',recordings.media(recording.id)]),media=JSON.parse(stdout);assert.equal(media.streams.find(s=>s.codec_type==='video').codec_name,'h264');assert.equal(media.streams.find(s=>s.codec_type==='audio').codec_name,'aac');assert.ok(Number(media.format.duration)>1);
 feeds.stop(feed.id);await Promise.all(receivers.map(r=>r.done));for(const r of receivers)assert.ok(fs.statSync(r.output).size>0);
});
