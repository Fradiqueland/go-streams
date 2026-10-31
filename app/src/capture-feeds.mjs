import crypto from 'node:crypto';
import {AppError,toolsFor} from './core.mjs';
import {encodingArgs} from './encoding.mjs';

const TS_PACKET=188,VIDEO_PID=256,PMT_PID=4096;
// stdout chunks have arbitrary OS-dependent boundaries. A late consumer must
// start with the program tables and a complete IDR PES, including its SPS/PPS.
// Keep only the two program tables and a partial packet; never replay old video.
function bootstrap(feed,chunk){
 const data=feed.tail.length?Buffer.concat([feed.tail,chunk]):chunk;let offset=0,start=-1,headers;
 while(offset+TS_PACKET<=data.length){
  if(data[offset]!==0x47){offset++;continue;}
  const packet=data.subarray(offset,offset+TS_PACKET),pid=((packet[1]&31)<<8)|packet[2],control=(packet[3]>>4)&3;
  if(packet[1]&0x40){
   if(pid===0||pid===PMT_PID)feed.tables.set(pid,Buffer.from(packet));
   if(start<0&&pid===VIDEO_PID&&(control&3)===3&&packet[4]>0&&(packet[5]&0x40)&&feed.tables.has(0)&&feed.tables.has(PMT_PID)){start=offset;headers=[feed.tables.get(0),feed.tables.get(PMT_PID)];}
  }
  offset+=TS_PACKET;
 }
 feed.tail=Buffer.from(data.subarray(offset));
 return start<0?null:Buffer.concat([...headers,data.subarray(start)]);
}

// A single WebM capture is encoded once. Repeated MPEG-TS headers/keyframes let
// live destinations and local recording attach independently at any time.
export class CaptureFeeds {
 constructor(studio,{clock=true}={}){this.studio=studio;this.active=new Map();studio.feeds=this;if(clock)this.timer=setInterval(()=>{for(const feed of this.active.values())if(Date.now()-feed.lastInput>20000)this.stop(feed.id,'Live capture disconnected.');},2000).unref();}
 create(input){
  if(this.studio.closing||this.studio.importingProject)throw new AppError('The studio is busy or closing.',409);
  if(this.active.size>=2)throw new AppError('Finish the current live capture first.',409);
  if(input.confirmed!==true||!['720p','1080p'].includes(input.quality)||!['16:9','9:16'].includes(input.aspect)||!['camera','screen','screen-camera'].includes(input.source))throw new AppError('Confirm a supported capture source and format.');
  const encoded=encodingArgs({...this.studio.store.data.settings.encoding,copy:false,aspect:input.aspect,fps:30,videoBitrate:input.quality==='1080p'?4500:2500},input.quality,[{audio:{}}]);
  const feed={id:crypto.randomUUID(),source:input.source,quality:input.quality,aspect:input.aspect,sequence:0,receiving:false,lastInput:Date.now(),sinks:new Set(),stopped:false,started:false,tail:Buffer.alloc(0),tables:new Map()};
  const args=['-hide_banner','-loglevel','error','-nostdin','-fflags','+genpts','-probesize','1048576','-analyzeduration','1000000','-f','webm','-i','pipe:0',...encoded.args.filter(arg=>arg!=='-shortest'),'-tune','zerolatency','-bf','0','-x264-params','repeat-headers=1','-f','mpegts','-mpegts_start_pid',String(VIDEO_PID),'-mpegts_pmt_start_pid',String(PMT_PID),'-mpegts_flags','resend_headers+pat_pmt_at_frames','-flush_packets','1','-muxdelay','0','-muxpreload','0','pipe:1'];
  const child=this.studio.spawnProcess(toolsFor(this.studio.store.data.settings).ffmpeg,args,{shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});feed.child=child;feed.completion=new Promise(resolve=>{feed.resolve=resolve;});this.active.set(feed.id,feed);
  child.stdin.on('error',()=>{});child.stderr.on('data',()=>{});
  child.stdout.on('data',chunk=>{
   const initial=bootstrap(feed,chunk);feed.started=true;
   for(const sink of [...feed.sinks]){
    if(sink.stream.destroyed||sink.stream.writableEnded||sink.stream.writableLength>4*1024*1024){feed.sinks.delete(sink);sink.onEnd('This output could not keep up with live capture.');continue;}
    const data=sink.waiting?initial:chunk;if(!data)continue;sink.waiting=false;
    try{sink.stream.write(data,error=>{if(error&&feed.sinks.delete(sink))sink.onEnd('This output stopped accepting live capture.');});sink.onData?.(data.length);}catch{if(feed.sinks.delete(sink))sink.onEnd('This output stopped accepting live capture.');}
   }
  });
  child.on('error',()=>this.stop(feed.id,'The capture encoder could not be started.'));
  child.on('close',code=>{clearTimeout(feed.timer);this.active.delete(feed.id);for(const sink of [...feed.sinks])sink.onEnd(feed.error||(!feed.stopped&&code!==0?'Live capture encoder disconnected.':''));feed.sinks.clear();feed.resolve();});
  return {id:feed.id};
 }
 get(id){const feed=this.active.get(id);if(!feed||feed.stopped)throw new AppError('The shared live capture has ended.',410);return feed;}
 attach(id,stream,onEnd,onData){const feed=this.get(id),sink={stream,onEnd,onData,waiting:feed.started};feed.sinks.add(sink);return ()=>feed.sinks.delete(sink);}
 async ingest(id,sequence,req){
  const feed=this.get(id);if(feed.receiving||sequence!==String(feed.sequence))throw new AppError('Capture chunks must arrive in order.',409);if(req.headers['content-type']?.split(';')[0]!=='video/webm')throw new AppError('Expected WebM capture data.',415);
  const declared=req.headers['content-length'];if(declared&&(!/^\d+$/.test(declared)||Number(declared)>8*1024*1024))throw new AppError('Capture chunk too large.',413);
  feed.receiving=true;const deadline=setTimeout(()=>{this.stop(id,'Capture upload timed out.');req.destroy();},20000).unref();
  try{const parts=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>8*1024*1024)throw new AppError('Capture chunk too large.',413);parts.push(Buffer.from(chunk));}if(!size||feed.stopped)throw new AppError('Capture has ended.',410);await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new AppError('Capture encoder stopped accepting video.',502)),15000).unref();feed.child.stdin.write(Buffer.concat(parts),error=>{clearTimeout(timer);error?reject(new AppError('Capture encoder disconnected.',502)):resolve();});});feed.sequence++;feed.lastInput=Date.now();return {ok:true,sequence:feed.sequence};}
  catch(error){this.stop(id,'Capture input was interrupted.');throw error;}finally{clearTimeout(deadline);feed.receiving=false;}
 }
 stop(id,error=''){const feed=this.active.get(id);if(!feed||feed.stopped)return;feed.stopped=true;feed.error=error;feed.timer=setTimeout(()=>{try{feed.child.kill();}catch{}},5000).unref();feed.child.stdin.end();}
 async shutdown(){clearInterval(this.timer);for(const id of this.active.keys())this.stop(id);await Promise.all([...this.active.values()].map(f=>f.completion));}
}
