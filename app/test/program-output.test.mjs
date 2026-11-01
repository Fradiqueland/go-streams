import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {appendProgramOutput} from '../src/program-output.mjs';
import {runProcess} from '../src/core.mjs';
import {outputDimensions} from '../src/encoding.mjs';

for(const [aspect,dimensions] of [['16:9'],['9:16'],['16:9',[320,180]]])test('composed output retains geometry and alpha: '+aspect+(dimensions?' source dimensions':''),async t=>{
 const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});const dir=fs.mkdtempSync(path.join(parent,'program-check-'));
 t.after(()=>{assert.ok(dir.startsWith(parent+path.sep));fs.rmSync(dir,{recursive:true,force:true});});
 const [width,height]=dimensions||outputDimensions('720p',aspect),size=Math.round(width*.15/2)*2,margin=Math.max(8,Math.round(Math.min(width,height)*.02));
 const picture=path.join(dir,'program.png'),raw=path.join(dir,'program.rgba'),scaled=path.join(dir,'image.rgba');
 const args=['-v','error','-f','lavfi','-i',`color=c=blue:s=${width}x${height}:r=30`];
 appendProgramOutput(args,['-map','[cover]','-vf',`scale=${width}:${height},setsar=1`],'720p',aspect,'[0:v:0]drawbox=x=0:y=0:w=iw:h=ih:color=red:t=fill[cover]',dimensions);
 assert.equal(args.filter(v=>v==='-i').length,2);
 await runProcess('ffmpeg',[...args,'-frames:v','1','-c:v','png','-threads','1','-pix_fmt','rgba','-y',picture]);
 await runProcess('ffmpeg',['-v','error','-i',picture,'-frames:v','1','-pix_fmt','rgba','-f','rawvideo','-y',raw]);
 await runProcess('ffmpeg',['-v','error','-i',fileURLToPath(new URL('../src/assets/program.png',import.meta.url)),'-vf',`scale=${size}:-1`,'-frames:v','1','-pix_fmt','rgba','-f','rawvideo','-y',scaled]);
 const frame=fs.readFileSync(raw),image=fs.readFileSync(scaled),base=[...frame.subarray(0,3)],x=width-size-margin;
 let compared=0;
 for(let offset=0;offset<image.length;offset+=4){
  if(image[offset+3]!==255||Math.max(...image.subarray(offset,offset+3))<120)continue;
  const pixel=offset/4,at=((margin+Math.floor(pixel/size))*width+x+pixel%size)*4;
  for(let c=0;c<3;c++)assert.ok(Math.abs(frame[at+c]-(image[offset+c]+base[c])/2)<=6,`channel ${c}, actual ${frame[at+c]}, expected ${(image[offset+c]+base[c])/2}`);
  if(++compared===50)break;
 }
 assert.equal(compared,50);
 assert.ok(base[0]>240&&base[1]<10&&base[2]<10,'existing foreground graphic remains outside the image');
 assert.deepEqual([...frame.subarray((width-1)*4,(width-1)*4+3)],base,'right margin remains clear');
});
