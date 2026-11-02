import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Readable} from 'node:stream';
import {Store,Vault,Studio,runProcess} from '../src/core.mjs';
import {LocalRecordings} from '../src/local-recordings.mjs';
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

for(const range of ['pc','tv'])test('VP9 '+range+' canvas color metadata survives standalone MP4 encoding without crushing dark tones',async t=>{
 const {root,recordings}=fixture(t),source=path.join(root,'color.webm'),raw=path.join(root,'color.rgb'),reference=path.join(root,'color-source.rgb');
 await runProcess('ffmpeg',['-v','error','-f','lavfi','-i','color=c=0x111827:s=640x360:r=20','-vf',`scale=in_color_matrix=bt601:out_color_matrix=bt709:out_range=${range}`,'-t','0.6','-c:v','libvpx-vp9','-lossless','1','-deadline','realtime','-color_range',range,'-colorspace','bt709','-y',source]);
 const sourceInfo=JSON.parse((await runProcess('ffprobe',['-v','error','-show_entries','stream=codec_name,color_range,color_space','-of','json',source])).stdout).streams[0];assert.equal(sourceInfo.codec_name,'vp9');assert.equal(sourceInfo.color_range,range);assert.equal(sourceInfo.color_space,'bt709');
 // Compare to decoded source pixels: YUV conversion and codec builds can round
 // the original RGB color differently before the recorder receives it.
 await runProcess('ffmpeg',['-v','error','-i',source,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','-y',reference]);
 const expected=[...fs.readFileSync(reference).subarray(0,3)],target=[17,24,39];
 for(let channel=0;channel<3;channel++)assert.ok(Math.abs(expected[channel]-target[channel])<=8,`Source fixture must retain dark color, got ${expected}`);
 const {id}=recordings.start({confirmed:true,kind:'video',format:'mp4'}),request=Readable.from([fs.readFileSync(source)]);request.headers={'content-type':'video/webm'};await recordings.ingest(id,'0',request);await recordings.finish(id);
 await runProcess('ffmpeg',['-v','error','-i',recordings.media(id),'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','-y',raw]);
 const pixel=[...fs.readFileSync(raw).subarray(0,3)];for(let channel=0;channel<3;channel++)assert.ok(Math.abs(pixel[channel]-expected[channel])<=5,`Decoded source ${expected} retains its range/matrix after recording, got ${pixel}`);
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
