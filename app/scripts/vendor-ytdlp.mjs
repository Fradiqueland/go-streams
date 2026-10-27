import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function vendorFiles(root,platform) {
  if(!['win32','darwin'].includes(platform))throw Error('Unsupported yt-dlp bundle platform');
  const directory=path.join(root,'vendor','yt-dlp');
  const manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'),'utf8'));
  const files=manifest.files.filter(file=>file.platforms.includes(platform));
  for(const file of files){
    if(!file.path||path.isAbsolute(file.path)||file.path.split(/[\\/]/).some(part=>!part||part==='.'||part==='..')||!Number.isSafeInteger(file.bytes)||file.bytes<1||file.bytes>100*1024*1024||!(typeof file.sha256==='string'&&/^[a-f0-9]{64}$/.test(file.sha256)||typeof file.gitSha1==='string'&&/^[a-f0-9]{40}$/.test(file.gitSha1)))throw Error('Invalid yt-dlp manifest');
  }
  for(const required of [platform+'/'+(platform==='win32'?'yt-dlp.exe':'yt-dlp'),'LICENSE','THIRD_PARTY_LICENSES.txt','source/yt-dlp.tar.gz'])if(!files.some(file=>file.path===required))throw Error('Required yt-dlp file missing from manifest: '+required);
  return {directory,manifest,files};
}
export function verifyVendorFile(file,entry) {
  try{
    if(fs.statSync(file).size!==entry.bytes)return false;
    const bytes=fs.readFileSync(file);
    if(entry.sha256)return crypto.createHash('sha256').update(bytes).digest('hex')===entry.sha256;
    return crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')===entry.gitSha1;
  }catch{return false;}
}
export function requireYtdlp(root,platform) {
  const bundle=vendorFiles(root,platform);
  for(const entry of bundle.files)if(!verifyVendorFile(path.join(bundle.directory,entry.path),entry))throw Error(`yt-dlp bundle missing or invalid: ${entry.path}. Run node scripts/prepare-portable.mjs to download the verified official files.`);
  return bundle;
}
export function copyYtdlp(root,destination,platform) {
  const bundle=requireYtdlp(root,platform),target=path.join(destination,'vendor','yt-dlp');
  for(const entry of bundle.files){
    const output=path.join(target,entry.path);fs.mkdirSync(path.dirname(output),{recursive:true});
    fs.copyFileSync(path.join(bundle.directory,entry.path),output);
    if(platform==='darwin'&&entry.path==='darwin/yt-dlp')fs.chmodSync(output,0o755);
  }
  fs.copyFileSync(path.join(bundle.directory,'manifest.json'),path.join(target,'manifest.json'));
}

const downloadHosts=new Set(['nodejs.org','github.com','raw.githubusercontent.com','release-assets.githubusercontent.com','objects.githubusercontent.com']);
export async function downloadVendorFile(entry,destination,{fetcher=fetch,signal=AbortSignal.timeout(180000)}={}) {
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  const temp=destination+'.'+crypto.randomUUID()+'.part';let fd;
  try{
    let url=new URL(entry.url),response;
    for(let redirects=0;redirects<=5;redirects++){
      if(url.protocol!=='https:'||url.username||url.password||url.port||!downloadHosts.has(url.hostname))throw Error('Untrusted yt-dlp download URL');
      response=await fetcher(url,{redirect:'manual',signal,headers:{'User-Agent':'GoStreams-portable-build','Accept-Encoding':'identity'}});
      if([301,302,303,307,308].includes(response.status)){
        const location=response.headers.get('location');await response.body?.cancel();
        if(!location||redirects===5)throw Error('Too many yt-dlp download redirects');
        url=new URL(location,url);continue;
      }
      break;
    }
    if(response.status!==200||!response.body){await response.body?.cancel();throw Error('Official yt-dlp download failed: HTTP '+response.status);}
    fd=fs.openSync(temp,'wx');let count=0;
    for await(const chunk of response.body){count+=chunk.length;if(count>entry.bytes)throw Error('yt-dlp download exceeds pinned size');let offset=0;while(offset<chunk.length)offset+=fs.writeSync(fd,chunk,offset,chunk.length-offset);}
    fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
    if(count!==entry.bytes||!verifyVendorFile(temp,entry))throw Error('yt-dlp download integrity check failed');
    fs.renameSync(temp,destination);
  }finally{if(fd!==undefined)fs.closeSync(fd);if(fs.existsSync(temp))fs.unlinkSync(temp);}
}
export async function prepareYtdlp(root,{platforms=['win32','darwin'],fetcher=fetch}={}) {
  const entries=new Map();let directory;
  for(const platform of platforms){const bundle=vendorFiles(root,platform);directory=bundle.directory;for(const entry of bundle.files)entries.set(entry.path,entry);}
  for(const entry of entries.values()){
    const file=path.join(directory,entry.path);
    if(verifyVendorFile(file,entry))continue;
    console.log('Downloading official yt-dlp file: '+entry.path);
    await downloadVendorFile(entry,file,{fetcher});
  }
  for(const platform of platforms){requireYtdlp(root,platform);if(platform==='darwin')fs.chmodSync(path.join(root,'vendor','yt-dlp','darwin','yt-dlp'),0o755);}
}
