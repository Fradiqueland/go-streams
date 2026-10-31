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
