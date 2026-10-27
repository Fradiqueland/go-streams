import {universalFixture} from './macho-fixture.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
// Tiny non-executable fixtures; never used as real yt-dlp binaries.
export function vendorFixture(root,{macBinary=false}={}){
 const directory=path.join(root,'vendor','yt-dlp');fs.mkdirSync(directory,{recursive:true});
 const files=[['win32/yt-dlp.exe',['win32']],['darwin/yt-dlp',['darwin']],['source/yt-dlp.tar.gz',['win32','darwin']],['LICENSE',['win32','darwin']],['THIRD_PARTY_LICENSES.txt',['win32','darwin']]].map(([name,platforms])=>{
  const bytes=macBinary&&name==='darwin/yt-dlp'?universalFixture():Buffer.from('Fixture only: '+name),file=path.join(directory,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);
  return {path:name,platforms,url:'https://github.com/yt-dlp/yt-dlp/releases/download/test/'+name.split('/').pop(),bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
 });
 fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify({version:'fixture',files}));return {directory,files};
}
