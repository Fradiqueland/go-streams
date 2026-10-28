const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

function userPaths(localData,override){
 const state=path.join(path.resolve(localData),'Go Streams');
 return {state,data:override?path.resolve(override):path.join(state,'data'),host:path.join(state,'electron-host')};
}
function regularTree(directory){
 if(fs.lstatSync(directory).isSymbolicLink())throw Error('A data folder contains a directory link. The original was preserved.');
 for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
  const file=path.join(directory,entry.name);
  if(entry.isSymbolicLink())throw Error('A data folder contains a directory link. The original was preserved.');
  if(entry.isDirectory())regularTree(file);
 }
}
function nonempty(directory){return fs.existsSync(directory)&&fs.readdirSync(directory).length>0;}
function copyData(source,destination,{skipSession=false}={}){
 regularTree(source);fs.mkdirSync(destination,{recursive:true});
 for(const entry of fs.readdirSync(source,{withFileTypes:true})){
  if(skipSession&&entry.name==='session.url')continue;
  const from=path.join(source,entry.name),to=path.join(destination,entry.name);
  if(entry.isDirectory())copyData(from,to,{skipSession});else fs.copyFileSync(from,to,fs.constants.COPYFILE_EXCL);
 }
}
function migrateData(target,legacy){
 target=path.resolve(target);
 if(nonempty(target)||!legacy)return {directory:target,migrated:false};
 legacy=path.resolve(legacy);
 if(target===legacy)return {directory:target,migrated:false};
 const a=target.toLowerCase()+path.sep,b=legacy.toLowerCase()+path.sep;
 if(a.startsWith(b)||b.startsWith(a))throw Error('The old and new data folders must be separate.');
 if(!fs.existsSync(path.join(legacy,'project.json')))throw Error('Choose the portable data folder containing project.json.');
 const parent=path.dirname(target);fs.mkdirSync(parent,{recursive:true});
 const stage=path.join(parent,'.electron-data-migration-'+crypto.randomUUID());
 try{
  copyData(legacy,stage,{skipSession:true});
  if(fs.existsSync(target))fs.rmdirSync(target);
  fs.renameSync(stage,target);
  return {directory:target,migrated:true};
 }finally{if(fs.existsSync(stage))fs.rmSync(stage,{recursive:true,force:true});}
}
function migratePreferences(data){
 const target=path.join(data,'electron-session');
 const legacy=path.join(data,'desktop-browser','Default','Local Storage');
 if(fs.existsSync(target)||!fs.existsSync(legacy))return target;
 const stage=path.join(data,'.electron-preferences-'+crypto.randomUUID());
 try{
  copyData(legacy,path.join(stage,'Local Storage'));
  fs.writeFileSync(path.join(stage,'.migrated-local-preferences'),'1\n');
  fs.renameSync(stage,target);
 }finally{if(fs.existsSync(stage))fs.rmSync(stage,{recursive:true,force:true});}
 // Edge/Chrome cookies are never modified or treated as decryptable Electron cookies.
 return target;
}
function discoverLegacy(source){
 if(!source||!fs.existsSync(source))return null;
 const folders=['GoStreams-data','data',path.join('GoStreams','data'),...fs.readdirSync(source,{withFileTypes:true}).filter(e=>e.isDirectory()&&e.name.startsWith('GoStreams')).map(e=>path.join(e.name,'data'))];
 const candidates=[...new Set(folders.map(p=>path.resolve(source,p)).filter(p=>fs.existsSync(path.join(p,'project.json'))))];
 if(candidates.length>1)throw Error('More than one portable data folder was found. Select the intended folder in setup.');
 return candidates[0]||null;
}
module.exports={userPaths,migrateData,migratePreferences,discoverLegacy};
