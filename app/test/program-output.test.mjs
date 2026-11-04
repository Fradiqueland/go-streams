import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
import {createApplication} from '../src/server.mjs';
import {appendProgramOutput} from '../src/program-output.mjs';
import {runProcess,probe} from '../src/core.mjs';
import {outputDimensions} from '../src/encoding.mjs';

for(const [aspect,dimensions,hints,sar] of [['16:9'],['9:16'],['16:9',[320,180]],['16:9',[180,320],[320,180]],['16:9',[320,180],undefined,4/3]])test('composed output retains geometry and alpha: '+aspect+(hints?' display dimensions':dimensions?' source dimensions':'')+(sar?' non-square pixels':''),async t=>{
 const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});const dir=fs.mkdtempSync(path.join(parent,'program-check-'));
 t.after(()=>{assert.ok(dir.startsWith(parent+path.sep));fs.rmSync(dir,{recursive:true,force:true});});
 const [width,height]=dimensions||outputDimensions('720p',aspect),size=Math.round(width*.08/2)*2,margin=Math.max(8,Math.round(Math.min(width,height)*.02));
 const picture=path.join(dir,'program.png'),raw=path.join(dir,'program.rgba'),scaled=path.join(dir,'image.rgba');
 const args=['-v','error','-f','lavfi','-i',`color=c=blue:s=${width}x${height}:r=30`];
 appendProgramOutput(args,['-map','[cover]','-vf',`scale=${width}:${height},setsar=${sar||1}`],'720p',aspect,'[0:v:0]drawbox=x=0:y=0:w=iw:h=ih:color=red:t=fill[cover]',hints||dimensions);
 assert.equal(args.filter(v=>v==='-i').length,2);
 await runProcess('ffmpeg',[...args,'-frames:v','1','-c:v','png','-threads','1','-pix_fmt','rgba','-y',picture]);
 await runProcess('ffmpeg',['-v','error','-i',picture,'-frames:v','1','-pix_fmt','rgba','-f','rawvideo','-y',raw]);
 const imageHeight=sar?Math.round(size*sar*948/1660):-1;
 await runProcess('ffmpeg',['-v','error','-i',fileURLToPath(new URL('../src/assets/program.png',import.meta.url)),'-vf',`scale=${size}:${imageHeight}`,'-frames:v','1','-pix_fmt','rgba','-f','rawvideo','-y',scaled]);
 const frame=fs.readFileSync(raw),image=fs.readFileSync(scaled),base=[...frame.subarray(0,3)],x=width-size-margin;
 let eligible=0;for(let offset=0;offset<image.length;offset+=4)if(image[offset+3]>=64&&Math.max(...image.subarray(offset,offset+3))>=120)eligible++;
 const target=Math.min(50,eligible);assert.ok(target>=10);
 let compared=0;
 for(let offset=0;offset<image.length;offset+=4){
  if(image[offset+3]<64||Math.max(...image.subarray(offset,offset+3))<120)continue;
  const pixel=offset/4,at=((margin+Math.floor(pixel/size))*width+x+pixel%size)*4;
  for(let c=0;c<3;c++)assert.ok(Math.abs(frame[at+c]-(image[offset+c]*(image[offset+3]/510)+base[c]*(1-image[offset+3]/510)))<=6,`channel ${c}, actual ${frame[at+c]}, expected ${image[offset+c]*(image[offset+3]/510)+base[c]*(1-image[offset+3]/510)}`);
  if(++compared===target)break;
 }
 assert.equal(compared,target);
 assert.ok(base[0]>240&&base[1]<10&&base[2]<10,'existing foreground graphic remains outside the image');
 assert.deepEqual([...frame.subarray((width-1)*4,(width-1)*4+3)],base,'right margin remains clear');
});

for(const geometry of ['original','odd','rotated'])test('source-preserving playback encodes '+geometry+' geometry without modifying the file',async t=>{
 const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});const dir=fs.mkdtempSync(path.join(parent,'geometry-check-'));
 let app;t.after(async()=>{await app?.close();assert.ok(dir.startsWith(parent+path.sep));fs.rmSync(dir,{recursive:true,force:true});});
 const input=path.join(dir,'input.mp4'),rotated=path.join(dir,'rotated.mp4'),odd=geometry==='odd',width=odd?321:320,height=odd?181:180;
 await runProcess('ffmpeg',['-v','error','-f','lavfi','-i',`testsrc=s=${width}x${height}:r=25`,'-t','0.6','-c:v','libx264','-pix_fmt',odd?'yuv444p':'yuv420p','-y',input]);
 if(geometry==='rotated'){
  await runProcess('ffmpeg',['-v','error','-display_rotation','90','-i',input,'-c','copy','-y',rotated]);
  const info=JSON.parse((await runProcess('ffprobe',['-v','error','-show_streams','-of','json',rotated])).stdout);
  assert.equal(info.streams[0].side_data_list[0].rotation,90);
 }
 const sourceFile=geometry==='rotated'?rotated:input,original=crypto.createHash('sha256').update(fs.readFileSync(sourceFile)).digest('hex');
 app=await createApplication({directory:path.join(dir,'data'),listen:false,clock:false,portableVault:true});
 app.store.update(s=>s.settings.encoding={copy:true,videoBitrate:2500,audioBitrate:128,fps:30,aspect:'16:9'});
 const imported=await app.studio.importMedia([sourceFile]);assert.equal(imported.imported.length,1,JSON.stringify(imported));
 const [started]=await app.studio.start({mediaId:imported.imported[0],preview:true}),job=app.studio.jobs.get(started.id);
 await job.completion;assert.equal(job.status,'completed',job.error);
 const output=await probe(path.join(app.store.directory,'previews',job.output),'ffprobe');
 assert.deepEqual([output.width,output.height],geometry==='rotated'?[180,320]:odd?[322,182]:[320,180]);
 assert.equal(output.fps,25);assert.equal(output.pixelFormat,'yuv420p');assert.equal(output.audio.codec,'aac');assert.ok(output.duration>=0.55&&output.duration<0.9);
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync(sourceFile)).digest('hex'),original);
});
