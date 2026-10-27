import fs from 'node:fs';
import path from 'node:path';

// Case alone does not identify a file on case-sensitive macOS volumes.
export function sameLocalFile(a,b,{realpath=fs.realpathSync,stat=fs.statSync}={}) {
  if(a===b)return true;
  if(a.toLowerCase()!==b.toLowerCase())return false;
  try{
    if(realpath(a)===realpath(b))return true;
    const one=stat(a),two=stat(b);
    return one.ino!==0&&one.ino===two.ino&&one.dev===two.dev;
  }catch{return false;}
}

const managedPattern=/^(?:downloads\/[\w-]+\/video\.mp4|(?:converted|normalized)\/[\w-]+\.mp4)$/;
function ownedFile(root,relative) {
  if(typeof relative!=='string'||!managedPattern.test(relative))return null;
  try{
    const file=path.join(root,...relative.split('/'));
    const actual=fs.realpathSync(file),base=fs.realpathSync(root);
    const resolved=path.relative(base,actual);
    if(resolved.startsWith('..'+path.sep)||path.isAbsolute(resolved)||!fs.statSync(actual).isFile())return null;
    return file;
  }catch{return null;}
}

// Only app-produced files get relative references. Original videos are never copied.
export function refreshManagedPaths(data,directory,previous) {
  const root=path.resolve(directory);
  for(const collection of ['media','downloads']){
    const prior=new Map((previous?.[collection]||[]).map(item=>[item.id,item]));
    for(const entry of data[collection]||[]){
      if(entry.source||typeof entry.path!=='string')continue;
      const old=prior.get(entry.id);
      if(old&&old.path===entry.path&&old.managedPath===entry.managedPath)continue;
      const relative=path.relative(root,entry.path).split(path.sep).join('/');
      if(ownedFile(root,relative)){entry.managedPath=relative;continue;}
      const relocated=ownedFile(root,entry.managedPath);
      if(relocated)entry.path=relocated;
    }
  }
}
