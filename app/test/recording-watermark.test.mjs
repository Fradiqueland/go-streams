import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Readable} from 'node:stream';
import {spawn} from 'node:child_process';
import {Store,Vault,Studio,runProcess} from '../src/core.mjs';
import {LocalRecordings} from '../src/local-recordings.mjs';
import {CaptureFeeds} from '../src/capture-feeds.mjs';
import {LiveCapture} from '../src/live-capture.mjs';
import {webmHeader} from './webm-fixture.mjs';
import {appendProgramOutput} from '../src/program-output.mjs';
import {createApplication} from '../src/server.mjs';
import {dispatch} from './transport.mjs';

const brand=fileURLToPath(new URL('../src/assets/program.png',import.meta.url));
function fixture(t){
 const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});const root=fs.mkdtempSync(path.join(parent,'recording-brand-'));
 const store=new Store(root),studio=new Studio(store,new Vault(root,{portable:true})),recordings=new LocalRecordings(studio,{clock:false});
 t.after(async()=>{await recordings.shutdown();await studio.shutdown();assert.ok(root.startsWith(parent+path.sep));fs.rmSync(root,{recursive:true,force:true});});
 return {root,studio,recordings};
}
async function verifyBrand(file,width,height,root){
 const raw=path.join(root,'frame.rgb'),scaled=path.join(root,'brand.rgba'),size=Math.max(2,Math.round(width*.15/2)*2),margin=Math.max(8,Math.round(Math.min(width,height)*.02)),imageHeight=Math.max(1,Math.round(size*948/1660));
 await runProcess('ffmpeg',['-v','error','-ss','0.2','-i',file,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','-y',raw]);
 await runProcess('ffmpeg',['-v','error','-i',brand,'-vf',`scale=${size}:${imageHeight}`,'-frames:v','1','-pix_fmt','rgba','-f','rawvideo','-y',scaled]);
 const frame=fs.readFileSync(raw),image=fs.readFileSync(scaled),base=[...frame.subarray(0,3)],left=width-size-margin;
 assert.equal(frame.length,width*height*3);assert.ok(base[0]>240&&base[1]<20&&base[2]<20,'Original red foreground stays outside the watermark: '+JSON.stringify(base));
 let count=0,onceError=0,twiceError=0,missingError=0;
 for(let offset=0;offset<image.length;offset+=4){
  if(image[offset+3]<230||Math.max(...image.subarray(offset,offset+3))<120)continue;
  const pixel=offset/4,x=pixel%size,y=Math.floor(pixel/size);if(x<1||x>=size-1||y<1||y>=imageHeight-1)continue;
  // H.264 4:2:0 blends chroma around transparent edges. Use opaque, smooth
  // interiors to measure alpha instead of confusing subsampling with opacity.
  let interior=true;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const neighbor=((y+dy)*size+x+dx)*4;if(image[neighbor+3]<230||[0,1,2].some(c=>Math.abs(image[neighbor+c]-image[offset+c])>80))interior=false;}
  if(!interior)continue;
  const at=((margin+y)*width+left+x)*3;
  for(let channel=0;channel<3;channel++){
   const actual=frame[at+channel],ink=image[offset+channel],background=base[channel],alpha=image[offset+3]/255*.5,twice=1-(1-alpha)**2;
   onceError+=Math.abs(actual-(ink*alpha+background*(1-alpha)));twiceError+=Math.abs(actual-(ink*twice+background*(1-twice)));missingError+=Math.abs(actual-background);count++;
  }
 }
 assert.ok(count>=30,'Enough opaque image pixels remain at this output size');
 onceError/=count;twiceError/=count;missingError/=count;
 assert.ok(onceError<15,`Saved watermark matches 50% opacity (mean error ${onceError.toFixed(2)})`);
 assert.ok(onceError+8<twiceError,`Saved watermark is applied once, not twice (${onceError.toFixed(2)} vs ${twiceError.toFixed(2)})`);
 assert.ok(onceError+20<missingError,'Encoded pixels differ from unbranded foreground');
 for(const [x,y]of [[width-1,margin],[left,0],[margin,margin],[left+Math.floor(size/2),height-1]]){
  const at=(y*width+x)*3;for(let channel=0;channel<3;channel++)assert.ok(Math.abs(frame[at+channel]-base[channel])<=5,'Watermark stays within the top-right image rectangle');
 }
}

for(const [width,height]of [[640,360],[720,1280],[720,720],[640,480],[840,360]])test(`standalone MP4 embeds one foreground watermark at 50% opacity (${width}x${height})`,async t=>{
 const {root,recordings}=fixture(t),source=path.join(root,'input.webm');
 await runProcess('ffmpeg',['-v','error','-f','lavfi','-i',`color=c=red:s=${width}x${height}:r=20`,'-t','0.6','-c:v','libvpx','-deadline','realtime','-y',source]);
 const {id}=recordings.start({confirmed:true,kind:'video',format:'mp4'}),request=Readable.from([fs.readFileSync(source)]);request.headers={'content-type':'video/webm'};
 await recordings.ingest(id,'0',request);await recordings.finish(id);await verifyBrand(recordings.media(id),width,height,root);
});

test('shared live MP4 retains its existing watermark without applying it twice',async t=>{
 const {root,studio,recordings}=fixture(t),source=path.join(root,'shared.ts'),width=640,height=360;
 const args=['-v','error','-f','lavfi','-i',`color=c=red:s=${width}x${height}:r=20`];
 appendProgramOutput(args,['-map','0:v:0','-c:v','libx264','-pix_fmt','yuv420p']);
 await runProcess('ffmpeg',[...args,'-t','0.6','-f','mpegts','-y',source]);
 let sink,onData;studio.feeds={get:()=>({}),attach:(_id,stream,_end,data)=>{sink=stream;onData=data;return ()=>{};},shutdown:async()=>{}};
 const {id}=recordings.start({confirmed:true,feedId:'shared'}),bytes=fs.readFileSync(source);
 await new Promise((resolve,reject)=>sink.write(bytes,error=>error?reject(error):resolve()));onData(bytes.length);
 await recordings.finish(id);await verifyBrand(recordings.media(id),width,height,root);
});

for(const codec of ['vp8','vp9'])for(const range of ['pc','tv'])for(const mode of ['standalone','shared','direct'])test(codec+' '+range+' colour survives '+mode+' encoding with fragmented headers',async t=>{
 const {root,studio,recordings}=fixture(t),source=path.join(root,'color.webm'),raw=path.join(root,'color.rgb'),reference=path.join(root,'color-source.rgb');
 const pattern=`drawbox=x=32:y=100:w=128:h=160:color=red:t=fill,drawbox=x=192:y=100:w=128:h=160:color=lime:t=fill,drawbox=x=352:y=100:w=128:h=160:color=blue:t=fill,scale=in_color_matrix=bt601:out_color_matrix=bt709:out_range=${range}`;
 await runProcess('ffmpeg',['-v','error','-f','lavfi','-i','color=c=0x111827:s=640x360:r=20','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-vf',pattern,'-t','0.6','-c:v',codec==='vp8'?'libvpx':'libvpx-vp9',...(codec==='vp8'?['-qmin','0','-qmax','0','-crf','0','-b:v','0']:['-lossless','1']),'-deadline','realtime','-c:a','libopus','-color_range',range,'-colorspace','bt709','-y',source]);
 const sourceInfo=JSON.parse((await runProcess('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=codec_name,color_range,color_space','-of','json',source])).stdout).streams[0];assert.equal(sourceInfo.codec_name,codec);assert.equal(sourceInfo.color_range,range);assert.equal(sourceInfo.color_space,'bt709');
 // VP8's decoder can discard the fixture's declared metadata. Restore those
 // independently known tags for the reference, not the parser being tested.
 await runProcess('ffmpeg',['-v','error','-i',source,...(codec==='vp8'?['-vf',`setparams=range=${range==='pc'?'full':'limited'}:colorspace=bt709`]:[]),'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','-y',reference]);
 const original=fs.readFileSync(reference),target=[17,24,39];for(let c=0;c<3;c++)assert.ok(Math.abs(original[c]-target[c])<=8,`Source fixture retains its dark color, got ${[...original.subarray(0,3)]}`);
 const feeds=mode==='shared'?new CaptureFeeds(studio,{clock:false}):null,feed=feeds?.create({confirmed:true,source:'screen',quality:'720p',aspect:'16:9'});
 let live,session,id,file;
 if(mode==='direct'){
  file=path.join(root,'direct-live.flv');const spawn=studio.spawnProcess;
  // Retain the real live encoder/filter pipeline, directing only its final
  // destination into this test's local file instead of opening a broadcast.
  studio.spawnProcess=(command,args,options)=>spawn(command,[...args.slice(0,args.indexOf('-rw_timeout')),'-f','flv','-y',file],options);
  live=new LiveCapture(studio,{clock:false});const channelId=studio.saveChannel({name:'Local color test',url:'rtmp://127.0.0.1:9/live',key:'test'});
  session=live.start({confirmed:true,source:'screen',quality:'720p',aspect:'16:9',mimeType:`video/webm;codecs=${codec},opus`,channelIds:[channelId]});
 }else id=recordings.start({confirmed:true,kind:'video',format:'mp4',...(feed?{feedId:feed.id}:{})}).id;
 const data=fs.readFileSync(source),chunks=[data.subarray(0,3),data.subarray(3,17),data.subarray(17)];
 for(let sequence=0;sequence<chunks.length;sequence++){const request=Readable.from([chunks[sequence]]);request.headers={'content-type':'video/webm'};if(live)await live.ingest(session.id,String(sequence),request);else if(feed)await feeds.ingest(feed.id,String(sequence),request);else await recordings.ingest(id,String(sequence),request);}
 if(feed){const completion=feeds.get(feed.id).completion;feeds.stop(feed.id);await completion;}
 if(live){live.stop(session.id);const job=studio.jobs.get(session.jobs[0].id);await job.completion;assert.equal(job.status,'stopped',job.error);}else{await recordings.finish(id);file=recordings.media(id);}
 await runProcess('ffmpeg',['-v','error','-i',file,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','-y',raw]);
 const output=fs.readFileSync(raw),scale=mode==='standalone'?1:2,width=640*scale;assert.equal(output.length,640*360*3*scale*scale);
 for(const [x,y]of [[10,10],[80,160],[240,160],[400,160]]){const at=(y*640+x)*3,actual=(y*scale*width+x*scale)*3;for(let c=0;c<3;c++)assert.ok(Math.abs(output[actual+c]-original[at+c])<=5,`Source ${[...original.subarray(at,at+3)]} retains range/matrix, got ${[...output.subarray(actual,actual+3)]}`);}
});

test('an incomplete standalone WebM header stops without spawning and preserves its received prefix',async t=>{
 const {root,studio,recordings}=fixture(t),prefix=webmHeader({range:2,matrix:1}).subarray(0,17);let launched=0;studio.spawnProcess=()=>{launched++;throw Error('No encoder should start');};
 const {id}=recordings.start({confirmed:true,format:'mp4'}),request=Readable.from([prefix]);request.headers={'content-type':'video/webm'};await recordings.ingest(id,'0',request);
 await assert.rejects(recordings.finish(id),/preserved/);assert.equal(launched,0);assert.equal(recordings.active.size,0);assert.equal(recordings.finalizing.size,0);assert.equal(recordings.state()[0].status,'interrupted');assert.deepEqual(fs.readFileSync(path.join(root,'recordings',id+'.part')),prefix);
});

test('an asynchronous encoder launch failure preserves the acknowledged standalone header on disk',async t=>{
 const {root,studio,recordings}=fixture(t),header=webmHeader({range:2,matrix:1});studio.spawnProcess=()=>spawn('gostreams-test-missing-encoder-593af851',[],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 const {id}=recordings.start({confirmed:true,format:'mp4'});
 const first=Readable.from([header.subarray(0,10)]);first.headers={'content-type':'video/webm'};await recordings.ingest(id,'0',first);
 const last=Readable.from([header.subarray(10)]);last.headers={'content-type':'video/webm'};await assert.rejects(recordings.ingest(id,'1',last));await assert.rejects(recordings.finish(id));
 assert.equal(recordings.state()[0].status,'interrupted');assert.equal(recordings.active.size,0);assert.equal(recordings.finalizing.size,0);assert.deepEqual(fs.readFileSync(path.join(root,'recordings',id+'.part')),header);
});

test('a shared capture stopped before its first chunk closes without starting an encoder',async t=>{
 const {studio}=fixture(t);let launched=0;studio.spawnProcess=()=>{launched++;throw Error('No encoder should start');};const feeds=new CaptureFeeds(studio,{clock:false}),feed=feeds.create({confirmed:true,source:'screen',quality:'720p',aspect:'16:9'}),completion=feeds.get(feed.id).completion;
 feeds.stop(feed.id);await completion;assert.equal(launched,0);assert.equal(feeds.active.size,0);
});

test('recorder preview exposes only the authenticated fixed branding asset for GET and HEAD',async t=>{
 const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});const root=fs.mkdtempSync(path.join(parent,'recording-brand-api-'));
 const app=await createApplication({directory:root,listen:false,clock:false,portableVault:true});
 t.after(async()=>{await app.close();assert.ok(root.startsWith(parent+path.sep));fs.rmSync(root,{recursive:true,force:true});});
 const headers={Cookie:'go_streams='+app.token};
 assert.equal((await dispatch(app,'/program.png')).status,401);
 const response=await dispatch(app,'/program.png',{headers});assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');assert.deepEqual(response.body,fs.readFileSync(brand));
 const head=await dispatch(app,'/program.png',{method:'HEAD',headers});assert.equal(head.status,200);assert.equal(head.body.length,0);assert.equal(Number(head.headers.get('content-length')),response.body.length);
 const post=await dispatch(app,'/program.png',{method:'POST',headers:{...headers,'X-Go-Streams':'1','Content-Type':'application/json'},body:'{}'});assert.equal(post.status,404);
 assert.equal((await dispatch(app,'/src/assets/program.png',{headers})).status,404);
});
