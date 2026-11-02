import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {AppError,atomicWrite,runProcess,toolsFor} from './core.mjs';
import {appendProgramOutput} from './program-output.mjs';

export class LocalRecordings {
 constructor(studio,{clock=true,execute=runProcess}={}){
  Object.assign(this,{studio,execute});this.root=path.join(studio.store.directory,'recordings');fs.mkdirSync(this.root,{recursive:true});this.file=path.join(this.root,'index.json');this.active=new Map();this.finalizing=new Map();this.closed=false;
  this.preferencesFile=path.join(this.root,'preferences.json');this.preferences={directory:this.root,askEveryTime:true,revision:0};
  try{if(fs.existsSync(this.preferencesFile)){const saved=JSON.parse(fs.readFileSync(this.preferencesFile,'utf8'));if(!saved||typeof saved.askEveryTime!=='boolean'||!this.validDirectory(saved.directory)||(saved.revision!==undefined&&(!Number.isSafeInteger(saved.revision)||saved.revision<0)))throw Error();this.preferences={...saved,revision:saved.revision||0};}}catch{throw new AppError('Recording preferences could not be read. Files were preserved.',500);}
  try{
   this.items=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):[];
   if(!Array.isArray(this.items)||this.items.some(i=>!i||typeof i!=='object'||! /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(i.id)||typeof i.created!=='string'||!Number.isFinite(Date.parse(i.created))||!['recording','finalizing','interrupted','completed'].includes(i.status)||!['webm','mp4','m4a',undefined].includes(i.format)||!['video','audio',undefined].includes(i.kind)||!Number.isSafeInteger(i.bytes)||i.bytes<0||(i.error!==undefined&&typeof i.error!=='string')||(i.ended!==undefined&&(typeof i.ended!=='string'||!Number.isFinite(Date.parse(i.ended)))))||new Set(this.items.map(i=>i.id)).size!==this.items.length)throw Error();
   for(const item of this.items){if(item.directory!==undefined&&!this.validDirectory(item.directory))throw Error();item.format||='webm';item.error||='';}
  }catch{throw new AppError('Local recording index could not be read. Files were preserved.',500);}
  for(const item of this.items)if(['recording','finalizing'].includes(item.status))item.status='interrupted';
  if(clock)this.timer=setInterval(()=>{for(const record of this.active.values())if(Date.now()-record.lastInput>20000)void this.finish(record.item.id).catch(()=>{});},2000).unref();
 }
 save(){atomicWrite(this.file,JSON.stringify(this.items));}
 // Legacy/default-folder entries intentionally omit directory on disk so a
 // moved data profile stays portable. The UI must still receive the actual
 // location, never substitute a subsequently changed recording preference.
 state(){return this.items.map(i=>({...i,directory:this.location(i)}));}
 validDirectory(value){return typeof value==='string'&&value.length<=4096&&path.isAbsolute(value)&&!/[\x00-\x1f]/.test(value);}
 prepareDirectory(value){
  if(!this.validDirectory(value))throw new AppError('Choose an absolute recording folder path.');
  let probe,fd,created=false;
  try{fs.mkdirSync(value,{recursive:true});const directory=fs.realpathSync(value);if(!fs.statSync(directory).isDirectory())throw Error();probe=path.join(directory,'.gostreams-writecheck-'+crypto.randomUUID());fd=fs.openSync(probe,'wx',0o600);created=true;fs.closeSync(fd);fd=undefined;fs.unlinkSync(probe);created=false;return directory;}
  catch{throw new AppError('The recording folder is unavailable or cannot be written. Choose another folder.',403);}
  finally{if(fd!==undefined)try{fs.closeSync(fd);}catch{}if(created)try{fs.unlinkSync(probe);}catch{}}
 }
 configure(input){
  if(this.closed||this.studio.closing)throw new AppError('The studio is closing.',409);
  if(!input||typeof input!=='object'||Array.isArray(input)||typeof input.askEveryTime!=='boolean')throw new AppError('Choose valid recording preferences.');
  const next={directory:this.prepareDirectory(input.directory),askEveryTime:input.askEveryTime,revision:Math.max(Date.now(),this.preferences.revision+1)};
  this.checkSpace(next.directory);atomicWrite(this.preferencesFile,JSON.stringify(next));this.preferences=next;return {...next};
 }
 location(item){return item.directory||this.root;}
 start({confirmed=false,feedId,directory,kind='video',format=feedId?'mp4':kind==='audio'?'m4a':'webm'}={}){
  if(!confirmed)throw new AppError('Confirm recording to this computer.');
  if(!['video','audio'].includes(kind)||!(kind==='audio'?['m4a','webm']:['mp4','webm']).includes(format)||(feedId&&(kind!=='video'||format!=='mp4')))throw new AppError('Choose a valid recording type and format.');
  if(this.closed||this.studio.closing||this.studio.importingProject||this.active.size>=2)throw new AppError('Close or finish the current recording first.',409);
  if(feedId)this.studio.feeds.get(feedId);
  const destination=this.prepareDirectory(directory===undefined?this.preferences.directory:directory);this.checkSpace(destination);const id=crypto.randomUUID(),item={id,created:new Date().toISOString(),status:'recording',format,kind,bytes:0,error:'',...(destination!==fs.realpathSync(this.root)?{directory:destination}:{})};
  // Persist ownership before opening a writer. ENOSPC must not leave an
  // untracked process writing after the start request has failed.
  this.items.unshift(item);try{this.save();}catch{this.items.shift();throw new AppError('The local recording index could not be saved. Check free disk space.',507);}
  let child,stream,record;
  try{
  // Encode browser input while recording. Finishing only remuxes the index;
  // it never needs to transcode the whole recording after the user presses Stop.
  if(format!=='webm'){
   const args=['-hide_banner','-loglevel','error','-nostdin','-probesize','1048576','-analyzeduration','1000000','-f',feedId?'mpegts':'webm','-i','pipe:0'];
   const encoding=[...(kind==='audio'?['-map','0:a:0','-vn']:['-map','0:v:0','-map','0:a:0?']),...(feedId?['-c','copy']:kind==='audio'?['-c:a','aac','-b:a','192k']:['-c:v','libx264','-preset','veryfast','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k'])];
   // Shared capture is already branded by its encoder. Standalone video must
   // apply the same foreground image after the browser's complete composition.
   if(!feedId&&kind==='video')appendProgramOutput(args,encoding);else args.push(...encoding);
   args.push('-f','matroska','-n',path.join(destination,id+'.part'));
   child=this.studio.spawnProcess(toolsFor(this.studio.store.data.settings).ffmpeg,args,{shell:false,windowsHide:true,stdio:['pipe','ignore','pipe']});
  }
  stream=child?child.stdin:fs.createWriteStream(path.join(destination,id+'.part'),{flags:'wx',mode:0o600});
  record={item,stream,feedId,sequence:0,receiving:false,lastInput:Date.now(),error:null,ownsPart:false};
  if(!child)stream.once('open',()=>{record.ownsPart=true;});
  stream.on('error',()=>{record.error='The local recording could not be written. Check free disk space.';if(item.status==='recording'&&this.active.get(id)===record)void this.finish(id).catch(()=>{});});
  this.active.set(id,record);
  if(child){
   record.child=child;record.childDone=new Promise(resolve=>child.once('close',code=>{record.exitCode=code;if((code!==0||item.status==='recording')&&!record.error)record.error='The local recording encoder stopped unexpectedly. Original local data was preserved.';resolve(code);if(item.status==='recording')void this.finish(id).catch(()=>{});}));child.stderr.on('data',()=>{});child.on('error',()=>{record.error='The local recording encoder could not be started.';});
   if(feedId)record.detach=this.studio.feeds.attach(feedId,stream,error=>{if(error)record.error=error;void this.finish(id).catch(()=>{});},bytes=>{item.bytes+=bytes;record.lastInput=Date.now();});
  }
  return {id};
  }catch{
   this.active.delete(id);item.status='interrupted';record?.detach?.();stream?.destroy();try{child?.kill();}catch{}
   this.items=this.items.filter(entry=>entry!==item);try{this.save();}catch{}
   throw new AppError('The local recording could not be started. Files were preserved.',500);
  }
 }
 checkSpace(directory=this.root){try{const stat=fs.statfsSync(directory);if(stat.bavail*stat.bsize<64*1024*1024)throw Error();}catch{throw new AppError('Not enough free space or the recording folder is unavailable.',507);}}
 async ingest(id,sequence,req){
  const record=this.active.get(id);if(!record||record.item.status!=='recording')throw new AppError('Recording has ended.',410);
  if(record.feedId)throw new AppError('This recording uses the shared capture input.',409);
  if(record.receiving||String(record.sequence)!==sequence)throw new AppError('Recording chunks must arrive in order.',409);
  if(!(record.item.kind==='audio'?['audio/webm','video/webm']:['video/webm']).includes(req.headers['content-type']?.split(';')[0]))throw new AppError('Expected WebM recording data.',415);
  const declared=req.headers['content-length'];if(declared&&(!/^\d+$/.test(declared)||Number(declared)>8*1024*1024))throw new AppError('Recording chunk too large.',413);
  record.receiving=true;const deadline=setTimeout(()=>{req.destroy();void this.finish(id).catch(()=>{});},20000).unref();
  try{
   const chunks=[];let size=0;for await(const data of req){size+=data.length;if(size>8*1024*1024)throw new AppError('Recording chunk too large.',413);chunks.push(Buffer.from(data));}
   if(!size||record.item.status!=='recording')throw new AppError('Recording ended before this chunk arrived.',409);
   this.checkSpace(this.location(record.item));if(record.error)throw new AppError(record.error,507);
   await new Promise((resolve,reject)=>record.stream.write(Buffer.concat(chunks),error=>error?reject(new AppError('The recording could not be written.',507)):resolve()));
   if(record.item.status!=='recording'||this.active.get(id)!==record)throw new AppError('Recording has ended.',410);
   record.item.bytes+=size;record.sequence++;record.lastInput=Date.now();return {ok:true,sequence:record.sequence};
  }finally{clearTimeout(deadline);record.receiving=false;}
 }
 async finish(id,{discardEmpty=false}={}){
  if(this.finalizing.has(id))return this.finalizing.get(id);
  const item=this.items.find(i=>i.id===id);if(!item)throw new AppError('Recording not found.',404);if(item.status==='completed')return {ok:true,id};
  const record=this.active.get(id),part=path.join(this.location(item),id+'.part'),output=path.join(this.location(item),id+'.'+item.format);
  if(!record&&!fs.existsSync(part))throw new AppError('Recording data is unavailable.',404);
  // Cancellation can race the start response before MediaRecorder produces
  // its first chunk. Only that active, untouched standalone session may be
  // discarded; existing history, shared feeds and in-flight uploads survive.
  const cancelEmpty=discardEmpty===true&&record&&item.status==='recording'&&!record.feedId&&!record.receiving&&record.sequence===0&&item.bytes===0;
  item.status='finalizing';
  const task=(async()=>{
   await Promise.resolve();
   try{
    let indexFailure;try{this.save();}catch(error){indexFailure=error;}
    if(record){
     record.detach?.();
     if(record.child){const timer=setTimeout(()=>record.child.kill(),10000).unref();record.stream.end();await record.childDone;clearTimeout(timer);}
     else await new Promise(resolve=>{if(record.stream.closed)return resolve();record.stream.once('close',resolve);record.stream.end();});
     this.active.delete(id);
    }
    if(indexFailure)throw indexFailure;
    if(cancelEmpty){
     const info=fs.lstatSync(part,{throwIfNoEntry:false});
     // An encoder with no input normally produces no file. Only remove an
     // empty file whose exclusive writer was opened by this exact session.
     if(!info||(record.ownsPart&&info.isFile()&&info.size===0)){
      const index=this.items.indexOf(item);this.items.splice(index,1);
      try{this.save();if(info)fs.unlinkSync(part);}
      catch(error){this.items.splice(index,0,item);throw error;}
      return {ok:true,id,discarded:true};
     }
    }
    if(record?.error)throw Error(record.error);
    if(!fs.statSync(part).size)throw Error('Empty recording');
    // Rewrites the WebM index and duration so the completed recording can be sought.
    await this.execute(toolsFor(this.studio.store.data.settings).ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-protocol_whitelist','file,pipe','-f',item.format==='webm'?'webm':'matroska','-i',part,...(item.kind==='audio'?['-map','0:a:0','-vn']:['-map','0:v:0','-map','0:a:0?']),'-c','copy',...(item.format!=='webm'?['-movflags','+faststart']:[]),'-f',item.format==='m4a'?'ipod':item.format,'-y',output],{timeout:120000});
    item.bytes=fs.statSync(output).size;item.status='completed';item.error='';item.ended=new Date().toISOString();
    // Commit the downloadable metadata before removing the recovery source.
    // If persisting completion fails, retry still has the original .part file.
    this.save();try{fs.unlinkSync(part);}catch{}return {ok:true,id};
   }catch{item.status='interrupted';item.error='Recording could not be finalized. Original local data was preserved for recovery.';try{this.save();}catch{}throw new AppError(item.error,500);}
   finally{this.active.delete(id);this.finalizing.delete(id);}
  })();this.finalizing.set(id,task);return task;
 }
 media(id){const item=this.items.find(i=>i.id===id);if(!item||item.status!=='completed')throw new AppError('Finish the recording before downloading it.',409);return path.join(this.location(item),id+'.'+item.format);}
 async shutdown(){this.closed=true;clearInterval(this.timer);await Promise.allSettled([...this.active.keys()].map(id=>this.finish(id)).concat([...this.finalizing.values()]));}
}
