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
function existing(file){try{return fs.lstatSync(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
function publishMigration(stage,target,{platform=process.platform,pause=milliseconds=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,milliseconds)}={}){
 // Windows scanners can briefly lock a newly copied folder. Retry only that
 // publication step, with a bounded startup delay, and never remove a target
 // that another process created while the migration was being prepared.
 for(let attempt=0;;attempt++){
  if(existing(target))throw Error('The destination folder changed during migration. Existing data was preserved.');
  try{fs.renameSync(stage,target);return;}
  catch(error){
   if(platform!=='win32'||!['EPERM','EACCES','EBUSY'].includes(error.code)||attempt>=5)throw error;
   pause(100*(attempt+1));
  }
 }
}
function copyData(source,destination,{skipSession=false}={}){
 regularTree(source);fs.mkdirSync(destination,{recursive:true});
 for(const entry of fs.readdirSync(source,{withFileTypes:true})){
  if(skipSession&&entry.name==='session.url')continue;
  const from=path.join(source,entry.name),to=path.join(destination,entry.name);
  if(entry.isDirectory())copyData(from,to,{skipSession});else fs.copyFileSync(from,to,fs.constants.COPYFILE_EXCL);
 }
}
function migrateData(target,legacy,options){
 target=path.resolve(target);
 if(nonempty(target)||!legacy)return {directory:target,migrated:false};
 const originalTarget=existing(target);
 if(originalTarget&&(!originalTarget.isDirectory()||originalTarget.isSymbolicLink()))throw Error('The data destination must be a regular folder. Existing data was preserved.');
 legacy=path.resolve(legacy);
 if(target===legacy)return {directory:target,migrated:false};
 const a=target.toLowerCase()+path.sep,b=legacy.toLowerCase()+path.sep;
 if(a.startsWith(b)||b.startsWith(a))throw Error('The old and new data folders must be separate.');
 if(!fs.existsSync(path.join(legacy,'project.json')))throw Error('Choose the portable data folder containing project.json.');
 const parent=path.dirname(target);fs.mkdirSync(parent,{recursive:true});
 const stage=path.join(parent,'.electron-data-migration-'+crypto.randomUUID());
 try{
  copyData(legacy,stage,{skipSession:true});
  if(originalTarget){
   const current=existing(target);
   if(!current||current.dev!==originalTarget.dev||current.ino!==originalTarget.ino||current.isSymbolicLink())throw Error('The destination folder changed during migration. Existing data was preserved.');
   // rmdir only succeeds for the same empty folder, never for saved data.
   fs.rmdirSync(target);
  }
  publishMigration(stage,target,options);
  return {directory:target,migrated:true};
 }finally{if(fs.existsSync(stage))fs.rmSync(stage,{recursive:true,force:true});}
}
function migratePreferences(data,options){
 const target=path.join(data,'electron-session');
 const legacy=path.join(data,'desktop-browser','Default','Local Storage');
 if(fs.existsSync(target)||!fs.existsSync(legacy))return target;
 const stage=path.join(data,'.electron-preferences-'+crypto.randomUUID());
 try{
  copyData(legacy,path.join(stage,'Local Storage'));
  fs.writeFileSync(path.join(stage,'.migrated-local-preferences'),'1\n');
  publishMigration(stage,target,options);
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
