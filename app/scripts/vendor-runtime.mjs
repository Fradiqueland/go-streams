import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {downloadVendorFile,verifyVendorFile} from './vendor-ytdlp.mjs';
export function runtimeTargets(platform){if(platform==='win32')return ['win32-x64'];if(platform==='darwin')return ['darwin-x64','darwin-arm64'];throw Error('Unsupported portable platform');}
export function requireRuntime(root,target){
 const directory=path.join(root,'vendor','runtime',target),manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'),'utf8'));
 if(manifest.target!==target)throw Error('Runtime target mismatch');
 const suffix=target.startsWith('win32')?'.exe':'';
 for(const name of ['node'+suffix,'ffmpeg'+suffix,'ffprobe'+suffix,'NODE-LICENSE.txt','FFMPEG-LICENSE.txt','FFMPEG-README.txt'])if(!manifest.files.some(f=>f.name===name))throw Error('Incomplete portable runtime: '+name);
 for(const file of manifest.files){if(file.name!==path.basename(file.name)||/[\\/]/.test(file.name)||!verifyVendorFile(path.join(directory,file.name),file))throw Error('Invalid portable runtime: '+file.name);}
 return {directory,manifest};
}
export function copyRuntime(root,destination,platform){
 const bundles=runtimeTargets(platform).map(target=>({target,...requireRuntime(root,target)}));
 for(const {target,directory,manifest} of bundles){
  const out=path.join(destination,'runtime',target);fs.mkdirSync(out,{recursive:true});
  for(const file of manifest.files){fs.copyFileSync(path.join(directory,file.name),path.join(out,file.name));if(platform==='darwin'&&['node','ffmpeg','ffprobe'].includes(file.name))fs.chmodSync(path.join(out,file.name),0o755);}
  fs.copyFileSync(path.join(directory,'manifest.json'),path.join(out,'manifest.json'));
 }
}
export async function prepareRuntime(root,platform){
 const config=JSON.parse(fs.readFileSync(path.join(root,'vendor','runtime','downloads.json'),'utf8'));
 for(const target of runtimeTargets(platform)){
  try{requireRuntime(root,target);if(target.startsWith('darwin'))for(const name of ['node','ffmpeg','ffprobe'])fs.chmodSync(path.join(root,'vendor','runtime',target,name),0o755);continue;}catch{}
  const directory=path.join(root,'vendor','runtime',target);fs.mkdirSync(directory,{recursive:true});
  const win=target.startsWith('win32'),distTarget=win?'win-x64':target,archiveName=`node-v${config.node}-${distTarget}.${win?'zip':'tar.gz'}`,base=`https://nodejs.org/dist/v${config.node}/`;
  console.log('Preparing portable runtime: '+target);
  const response=await fetch(base+'SHASUMS256.txt',{signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('Cannot fetch official Node checksums');
  const checksums=await response.text(),sha=checksums.split('\n').map(line=>line.trim().split(/\s+/)).find(row=>row[1]===archiveName)?.[0];
  if(!/^[a-f0-9]{64}$/.test(sha||''))throw Error('Official Node checksum not found');
  const head=await fetch(base+archiveName,{method:'HEAD',signal:AbortSignal.timeout(30000)}),bytes=Number(head.headers.get('content-length'));
  if(!head.ok||!Number.isSafeInteger(bytes)||bytes<1||bytes>150*1024*1024)throw Error('Invalid Node archive size');
  const archive=path.join(root,'vendor','runtime',archiveName),entry={bytes,sha256:sha,url:base+archiveName};
  if(!verifyVendorFile(archive,entry))await downloadVendorFile(entry,archive);
  const extract=spawnSync(process.platform==='win32'?'python':'python3',[path.join(root,'scripts','extract-node.py'),archive,directory,config.node,distTarget],{windowsHide:true,stdio:'inherit',timeout:60000});
  if(extract.error||extract.status!==0)throw Error('Cannot extract Node runtime');
  const assets=config.files.filter(f=>f.target===target);
  for(const file of assets){const output=path.join(directory,file.name);if(!verifyVendorFile(output,file)){console.log('Downloading '+target+'/'+file.name);await downloadVendorFile(file,output);}}
  const names=['node'+(win?'.exe':''),'NODE-LICENSE.txt',...assets.map(f=>f.name)];
  const files=names.map(name=>{const data=fs.readFileSync(path.join(directory,name));return {name,bytes:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex')};});
  fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify({target,node:config.node,nodeArchiveSha256:sha,ffmpeg:config.ffmpegRelease,files},null,2)+'\n');requireRuntime(root,target);
  if(!win)for(const name of ['node','ffmpeg','ffprobe'])fs.chmodSync(path.join(directory,name),0o755);
 }
}
