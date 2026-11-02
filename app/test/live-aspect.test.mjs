import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Readable} from 'node:stream';
import {Store,Vault,Studio,runProcess} from '../src/core.mjs';
import {CaptureFeeds} from '../src/capture-feeds.mjs';
import {LiveCapture} from '../src/live-capture.mjs';
import {LocalRecordings} from '../src/local-recordings.mjs';
import {validateEncoding,outputDimensions,encodingAspects} from '../src/encoding.mjs';
import {videoAspects,videoDimensions} from '../public/video-geometry.js';
import {createApplication} from '../src/server.mjs';
import {dispatch} from './transport.mjs';

const sizes=[['16:9',1280,720],['9:16',720,1280],['1:1',720,720],['4:3',960,720],['3:4',720,960],['21:9',1680,720]];
const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});
const root=fs.mkdtempSync(path.join(parent,'live-aspect-')),source=path.join(root,'source.webm');
before(async()=>{
 await runProcess('ffmpeg',['-v','error','-f','lavfi','-i','color=c=0x111827:s=640x360:r=20','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-vf','drawbox=x=128:y=128:w=64:h=64:color=lime:t=fill','-t','0.6','-c:v','libvpx-vp9','-deadline','realtime','-c:a','libopus','-y',source]);
});
after(()=>{assert.ok(root.startsWith(parent+path.sep));fs.rmSync(root,{recursive:true,force:true});});

function fixture(t){
 const directory=fs.mkdtempSync(path.join(root,'data-')),store=new Store(directory),studio=new Studio(store,new Vault(directory,{portable:true}));
 const feeds=new CaptureFeeds(studio,{clock:false}),live=new LiveCapture(studio,{clock:false}),recordings=new LocalRecordings(studio,{clock:false});
 const id=studio.saveChannel({name:'Local aspect proof',url:'rtmp://127.0.0.1:9/live',key:'test'}),destination=path.join(directory,'live.flv');
 const spawn=studio.spawnProcess;let workers=0;
 studio.spawnProcess=(command,args,options)=>{
  workers++;const transport=args.indexOf('-rw_timeout');
  // Exercise the production encoder and stream-copy destination unchanged,
  // replacing only the external RTMP transport with an owned local FLV file.
  return spawn(command,transport<0?args:[...args.slice(0,transport),'-f','flv','-y',destination],options);
 };
 t.after(()=>studio.shutdown());
 return {directory,store,studio,feeds,live,recordings,id,destination,workers:()=>workers};
}
const input=(id,aspect,extra={})=>({confirmed:true,source:'screen',quality:'720p',aspect,channelIds:[id],mimeType:'video/webm;codecs=vp9,opus',...extra});
async function upload(ingest){
 const bytes=fs.readFileSync(source),chunks=[bytes.subarray(0,17),bytes.subarray(17)];
 for(let sequence=0;sequence<chunks.length;sequence++){const request=Readable.from([chunks[sequence]]);request.headers={'content-type':'video/webm'};await ingest(String(sequence),request);}
}
async function verifyFrame(file,width,height,directory,label){
 const info=JSON.parse((await runProcess('ffprobe',['-v','error','-show_streams','-of','json',file])).stdout),video=info.streams.find(s=>s.codec_type==='video'),audio=info.streams.find(s=>s.codec_type==='audio');
 assert.deepEqual([video.width,video.height],[width,height]);assert.equal(video.codec_name,'h264');assert.equal(video.sample_aspect_ratio,'1:1');assert.equal(audio.codec_name,'aac');
 const raw=path.join(directory,label+'.rgb');await runProcess('ffmpeg',['-v','error','-i',file,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','-y',raw]);
 const frame=fs.readFileSync(raw);assert.equal(frame.length,width*height*3);
 let left=width,top=height,right=-1,bottom=-1;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const at=(y*width+x)*3;
  if(frame[at]<40&&frame[at+1]>180&&frame[at+2]<40){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
 }
 const scale=Math.min(width/640,height/360),expected=64*scale,offsetX=(width-640*scale)/2,offsetY=(height-360*scale)/2;
 assert.ok(Math.abs((right-left+1)-expected)<=3&&Math.abs((bottom-top+1)-expected)<=3,'Source marker remains square without stretching');
 assert.ok(Math.abs(left-(offsetX+128*scale))<=3&&Math.abs(top-(offsetY+128*scale))<=3,'Source marker remains centered within the fitted screen');
}

test('live preview and encoder share six exact even dimensions at both quality levels',()=>{
 assert.equal(encodingAspects,videoAspects);assert.equal(outputDimensions,videoDimensions);
 assert.deepEqual(videoAspects,sizes.map(([aspect])=>aspect));
 for(const [aspect,width,height]of sizes){
  assert.equal(validateEncoding({aspect}).aspect,aspect);
  assert.deepEqual(videoDimensions('720p',aspect),[width,height]);
  assert.deepEqual(videoDimensions('1080p',aspect),[width*1.5,height*1.5]);
 }
 assert.throws(()=>videoDimensions('720p','1:0'),RangeError);
});

test('invalid live shapes are rejected before reserving feeds, channels or workers',async t=>{
 const f=fixture(t),before=structuredClone(f.store.data);
 for(const aspect of ['original','2:3','1:0','16:9,scale=2:2','',null]){
  assert.throws(()=>f.feeds.create(input(f.id,aspect)),/supported/);
  assert.throws(()=>f.live.start(input(f.id,aspect)),/supported/);
 }
 assert.equal(f.feeds.active.size,0);assert.equal(f.live.sessions.size,0);assert.equal(f.studio.jobs.size,0);assert.equal(f.workers(),0);assert.deepEqual(f.store.data,before);
});

test('the shared video geometry module is served to authenticated browsers for GET and HEAD',async t=>{
 const app=await createApplication({directory:path.join(root,'api'),listen:false,clock:false,portableVault:true});t.after(()=>app.close());
 const headers={Cookie:'go_streams='+app.token};assert.equal((await dispatch(app,'/video-geometry.js')).status,401);
 const response=await dispatch(app,'/video-geometry.js',{headers});assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'text/javascript');assert.match(response.body.toString(),/export function videoDimensions/);
 const head=await dispatch(app,'/video-geometry.js',{method:'HEAD',headers});assert.equal(head.status,200);assert.equal(head.body.length,0);assert.equal(Number(head.headers.get('content-length')),response.body.length);
});

for(const [aspect,width,height]of sizes){
 test(`shared ${aspect} live output and local recording retain exact dimensions and screen geometry`,async t=>{
  const f=fixture(t),before=structuredClone(f.store.data.settings.encoding),feed=f.feeds.create(input(f.id,aspect)),recording=f.recordings.start({confirmed:true,feedId:feed.id,format:'mp4'}),session=f.live.start(input(f.id,aspect,{feedId:feed.id}));
  assert.throws(()=>f.live.start(input(f.id,aspect==='1:1'?'4:3':'1:1',{feedId:feed.id})),/must match/);
  const completion=f.feeds.get(feed.id).completion;await upload((sequence,request)=>f.feeds.ingest(feed.id,sequence,request));f.feeds.stop(feed.id);await completion;
  await f.recordings.finish(recording.id);const job=f.studio.jobs.get(session.jobs[0].id);await job.completion;assert.equal(job.status,'stopped',job.error);
  await verifyFrame(f.destination,width,height,f.directory,'live');await verifyFrame(f.recordings.media(recording.id),width,height,f.directory,'recording');
  assert.deepEqual(f.store.data.settings.encoding,before);assert.equal(f.recordings.active.size,0);assert.equal(f.feeds.active.size,0);
 });
 test(`direct ${aspect} live encoding retains exact dimensions and screen geometry`,async t=>{
  const f=fixture(t),session=f.live.start(input(f.id,aspect));await upload((sequence,request)=>f.live.ingest(session.id,sequence,request));f.live.stop(session.id);
  const job=f.studio.jobs.get(session.jobs[0].id);await job.completion;assert.equal(job.status,'stopped',job.error);await verifyFrame(f.destination,width,height,f.directory,'direct');assert.equal(f.live.sessions.size,0);
 });
}
