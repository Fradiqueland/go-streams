import {machoFixture} from './macho-fixture.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
export function runtimeFixture(root){
 for(const target of ['win32-x64','darwin-x64','darwin-arm64']){
  const directory=path.join(root,'vendor','runtime',target);fs.mkdirSync(directory,{recursive:true});const suffix=target.startsWith('win')?'.exe':'';
  const files=['node'+suffix,'ffmpeg'+suffix,'ffprobe'+suffix,'NODE-LICENSE.txt','FFMPEG-LICENSE.txt','FFMPEG-README.txt'].map(name=>{const bytes=target.startsWith('darwin')&&['node','ffmpeg','ffprobe'].includes(name)?machoFixture(target.slice(7),name==='node'?0x0d0500:0x0c0000):Buffer.from('Fixture: '+target+'/'+name);fs.writeFileSync(path.join(directory,name),bytes);return {name,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};});
  fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify({target,files}));
 }
}
