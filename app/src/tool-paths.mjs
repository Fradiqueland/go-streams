import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const appRoot=fileURLToPath(new URL('../',import.meta.url));
export function ytdlpPath(settings={}, {root=appRoot,platform=process.platform}={}) {
  if(settings.ytdlp)return settings.ytdlp;
  if(platform==='win32'||platform==='darwin'){
    const file=path.join(root,'vendor','yt-dlp',platform,platform==='win32'?'yt-dlp.exe':'yt-dlp');
    try{if(fs.statSync(file).isFile())return file;}catch{}
  }
  if(fs.existsSync(path.join(root,'runtime')))throw Error('Bundled yt-dlp is missing. Extract the complete application folder again.');
  return 'yt-dlp';
}

export function mediaToolPath(name,settings={}, {root=appRoot,platform=process.platform,arch=process.arch}={}) {
  if(!['ffmpeg','ffprobe'].includes(name))throw Error('Unsupported media tool');
  if(settings[name])return settings[name];
  const target=platform==='win32'?'win32-x64':platform+'-'+arch;
  const file=path.join(root,'runtime',target,name+(platform==='win32'?'.exe':''));
  try{if(fs.statSync(file).isFile())return file;}catch{}
  if(fs.existsSync(path.join(root,'runtime')))throw Error('Bundled '+name+' is missing. Extract the complete application folder again.');
  return name;
}
