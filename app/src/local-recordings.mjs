import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {AppError,atomicWrite,runProcess,toolsFor} from './core.mjs';

export class LocalRecordings {
 constructor(studio,{clock=true,execute=runProcess}={}){
  Object.assign(this,{studio,execute});this.root=path.join(studio.store.directory,'recordings');fs.mkdirSync(this.root,{recursive:true});this.file=path.join(this.root,'index.json');this.active=new Map();this.finalizing=new Map();this.closed=false;
  try{this.items=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):[];if(!Array.isArray(this.items)||this.items.some(i=>! /^[a-f0-9-]{36}$/i.test(i.id)))throw Error();}catch{throw new AppError('Local recording index could not be read. Files were preserved.',500);}
  for(const item of this.items)if(['recording','finalizing'].includes(item.status))item.status='interrupted';
  if(clock)this.timer=setInterval(()=>{for(const record of this.active.values())if(Date.now()-record.lastInput>20000)void this.finish(record.item.id).catch(()=>{});},2000).unref();
 }
 save(){atomicWrite(this.file,JSON.stringify(this.items));}
 state(){return this.items.map(i=>({...i}));}
 start({confirmed=false,feedId}={}){
  if(!confirmed)throw new AppError('Confirm recording to this computer.');
  if(this.closed||this.studio.closing||this.studio.importingProject||this.active.size>=2)throw new AppError('Close or finish the current recording first.',409);
  if(feedId)this.studio.feeds.get(feedId);
  this.checkSpace();const id=crypto.randomUUID(),item={id,created:new Date().toISOString(),status:'recording',format:feedId?'mp4':'webm',bytes:0,error:''};
  const child=feedId?this.studio.spawnProcess(toolsFor(this.studio.store.data.settings).ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-probesize','4194304','-analyzeduration','3000000','-f','mpegts','-i','pipe:0','-map','0:v:0','-map','0:a:0?','-c','copy','-f','matroska','-y',path.join(this.root,id+'.part')],{shell:false,windowsHide:true,stdio:['pipe','ignore','pipe']}):null;
  const stream=child?child.stdin:fs.createWriteStream(path.join(this.root,id+'.part'),{flags:'wx',mode:0o600});
  const record={item,stream,sequence:0,receiving:false,lastInput:Date.now(),error:null};stream.on('error',()=>{record.error='The local recording could not be written. Check free disk space.';});
  if(child){
   record.child=child;record.childDone=new Promise(resolve=>child.once('close',code=>{record.exitCode=code;if(code!==0&&!record.error)record.error='The local recording encoder stopped unexpectedly. Original local data was preserved.';resolve(code);if(item.status==='recording')void this.finish(id).catch(()=>{});}));child.stderr.on('data',()=>{});child.on('error',()=>{record.error='The local recording encoder could not be started.';});
   record.detach=this.studio.feeds.attach(feedId,stream,error=>{if(error)record.error=error;void this.finish(id).catch(()=>{});},bytes=>{item.bytes+=bytes;record.lastInput=Date.now();});
  }
  this.items.unshift(item);this.active.set(id,record);this.save();return {id};
 }
 checkSpace(){if(fs.statfsSync(this.root).bavail*fs.statfsSync(this.root).bsize<64*1024*1024)throw new AppError('Not enough free space for a local recording.',507);}
 async ingest(id,sequence,req){
  const record=this.active.get(id);if(!record||record.item.status!=='recording')throw new AppError('Recording has ended.',410);
  if(record.child)throw new AppError('This recording uses the shared capture input.',409);
  if(record.receiving||String(record.sequence)!==sequence)throw new AppError('Recording chunks must arrive in order.',409);
  if(req.headers['content-type']?.split(';')[0]!=='video/webm')throw new AppError('Expected WebM recording data.',415);
  const declared=req.headers['content-length'];if(declared&&(!/^\d+$/.test(declared)||Number(declared)>8*1024*1024))throw new AppError('Recording chunk too large.',413);
  record.receiving=true;const deadline=setTimeout(()=>{req.destroy();void this.finish(id).catch(()=>{});},20000).unref();
  try{
   const chunks=[];let size=0;for await(const data of req){size+=data.length;if(size>8*1024*1024)throw new AppError('Recording chunk too large.',413);chunks.push(Buffer.from(data));}
   if(!size||record.item.status!=='recording')throw new AppError('Recording ended before this chunk arrived.',409);
   this.checkSpace();if(record.error)throw new AppError(record.error,507);
   await new Promise((resolve,reject)=>record.stream.write(Buffer.concat(chunks),error=>error?reject(new AppError('The recording could not be written.',507)):resolve()));
   record.item.bytes+=size;record.sequence++;record.lastInput=Date.now();return {ok:true,sequence:record.sequence};
  }finally{clearTimeout(deadline);record.receiving=false;}
 }
 async finish(id){
  if(this.finalizing.has(id))return this.finalizing.get(id);
  const item=this.items.find(i=>i.id===id);if(!item)throw new AppError('Recording not found.',404);if(item.status==='completed')return {ok:true,id};
  const record=this.active.get(id),part=path.join(this.root,id+'.part'),output=path.join(this.root,id+(item.format==='mp4'?'.mp4':'.webm'));
  if(!record&&!fs.existsSync(part))throw new AppError('Recording data is unavailable.',404);
  item.status='finalizing';this.save();
  const task=(async()=>{
   await Promise.resolve();
   try{
    if(record){
     record.detach?.();
     if(record.child){const timer=setTimeout(()=>record.child.kill(),10000).unref();record.stream.end();await record.childDone;clearTimeout(timer);}
     else await new Promise(resolve=>{if(record.stream.closed)return resolve();record.stream.once('close',resolve);record.stream.end();});
     this.active.delete(id);
    }
    if(record?.error)throw Error(record.error);
    if(!fs.statSync(part).size)throw Error('Empty recording');
    // Rewrites the WebM index and duration so the completed recording can be sought.
    await this.execute(toolsFor(this.studio.store.data.settings).ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-protocol_whitelist','file,pipe','-f',item.format==='mp4'?'matroska':'webm','-i',part,'-map','0:v:0','-map','0:a:0?','-c','copy',...(item.format==='mp4'?['-movflags','+faststart']:[]),'-f',item.format==='mp4'?'mp4':'webm','-y',output],{timeout:120000});
    item.bytes=fs.statSync(output).size;item.status='completed';item.error='';item.ended=new Date().toISOString();fs.unlinkSync(part);return {ok:true,id};
   }catch{item.status='interrupted';item.error='Recording could not be finalized. Original local data was preserved for recovery.';throw new AppError(item.error,500);}
   finally{this.active.delete(id);this.finalizing.delete(id);this.save();}
  })();this.finalizing.set(id,task);return task;
 }
 media(id){const item=this.items.find(i=>i.id===id);if(!item||item.status!=='completed')throw new AppError('Finish the recording before downloading it.',409);return path.join(this.root,id+(item.format==='mp4'?'.mp4':'.webm'));}
 async shutdown(){this.closed=true;clearInterval(this.timer);await Promise.allSettled([...this.active.keys()].map(id=>this.finish(id)).concat([...this.finalizing.values()]));}
}
