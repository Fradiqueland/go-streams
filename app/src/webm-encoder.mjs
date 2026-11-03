import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';

export const MAX_WEBM_HEADER_BYTES=1024*1024;
const incomplete=Symbol('incomplete WebM header');
const invalid=()=>{throw Error('The WebM video header is invalid or unsupported.');};
const matrices=new Map([[1,'bt709'],[4,'fcc'],[5,'bt470bg'],[6,'smpte170m'],[7,'smpte240m'],[8,'ycgco'],[9,'bt2020nc'],[10,'bt2020c']]);

// Only inspect the bounded EBML/Segment/Tracks/TrackEntry/Video/Colour path.
// IDs and enum values follow https://www.matroska.org/technical/elements.html.
// Do not search raw bytes: media payloads can contain the same byte patterns.
export function webmVideoColor(data){
 let elements=0;
 function vint(at,id=false){
  if(at>=data.length)throw incomplete;
  let mask=128,length=1;while(length<=8&&!(data[at]&mask)){length++;mask>>=1;}
  if(length>(id?4:8))invalid();if(at+length>data.length)throw incomplete;
  let value=BigInt(id?data[at]:data[at]&(mask-1)),unknown=!id&&value===BigInt(mask-1);
  for(let n=1;n<length;n++){value=value*256n+BigInt(data[at+n]);unknown&&=data[at+n]===255;}
  if(unknown)return {value:Infinity,length};
  if(value>BigInt(Number.MAX_SAFE_INTEGER))invalid();return {value:Number(value),length};
 }
 function element(at,bound=Infinity){
  if(++elements>4096)invalid();const id=vint(at,true),size=vint(at+id.length),start=at+id.length+size.length,end=start+size.value;
  if(start>bound||end>bound||(Number.isFinite(end)&&!Number.isSafeInteger(end)))invalid();return {id:id.value,start,end};
 }
 function available(item){
  if(!Number.isFinite(item.end)||item.end>MAX_WEBM_HEADER_BYTES)invalid();
  if(item.end>data.length)throw incomplete;
 }
 function children(parent,visit){
  available(parent);for(let at=parent.start;at<parent.end;){const item=element(at,parent.end);available(item);visit(item);at=item.end;}
 }
 function integer(item){
  const length=item.end-item.start;if(length>8)invalid();let value=0n;
  for(let at=item.start;at<item.end;at++)value=value*256n+BigInt(data[at]);
  return value<=BigInt(Number.MAX_SAFE_INTEGER)?Number(value):undefined;
 }
 function string(item){
  // EBML string values end at their first NUL; later padding bytes are not
  // part of DocType or CodecID (RFC 8794, sections 13 and 16).
  const bytes=data.subarray(item.start,item.end),zero=bytes.indexOf(0);
  return bytes.toString('utf8',0,zero<0?bytes.length:zero);
 }
 function videoColor(video){
  const result={};let seen=false;
  children(video,item=>{if(item.id!==0x55b0)return;if(seen)invalid();seen=true;
   const fields=new Set();children(item,field=>{const name=field.id===0x55b9?'range':field.id===0x55b1?'matrix':null;if(!name)return;if(fields.has(name))invalid();fields.add(name);result[name]=field.start===field.end?(name==='matrix'?2:0):integer(field);});
  });return result;
 }
 function tracks(parent){
  let selected;
  children(parent,entry=>{if(entry.id!==0xae)return;let type,codec,video;
   let hasType=false;children(entry,item=>{
    if(item.id===0x83){if(hasType)invalid();hasType=true;type=integer(item);}
    if(item.id===0x86){if(codec!==undefined)invalid();codec=string(item);if(Buffer.byteLength(codec)>128)invalid();}
    if(item.id===0xe0){if(video)invalid();video=item;}
   });
   if(type===1&&!selected){if(!codec||!video)invalid();selected={codec,...videoColor(video)};}
  });
  if(!selected)invalid();const filters=[];
  // VP9 carries these properties in its bitstream. VP8 decoders can replace
  // the container's values, so restore only explicitly specified known tags.
  if(selected.codec==='V_VP8'){
   if(selected.range===1||selected.range===2)filters.push('range='+(selected.range===1?'limited':'full'));
   if(matrices.has(selected.matrix))filters.push('colorspace='+matrices.get(selected.matrix));
  }
  return {...selected,filter:filters.length?'setparams='+filters.join(':'):''};
 }
 try{
  const ebml=element(0);if(ebml.id!==0x1a45dfa3)invalid();let documentType;
  children(ebml,item=>{if(item.id===0x4282){if(documentType!==undefined)invalid();documentType=string(item);}});
  if(!['webm','matroska'].includes(documentType))invalid();
  let at=ebml.end,segment;
  while(!segment){const item=element(at);if(item.id===0x18538067){segment=item;break;}if(![0xec,0xbf].includes(item.id))invalid();available(item);at=item.end;}
  at=segment.start;
  while(at<segment.end){
   const item=element(at,segment.end);if(item.id===0x1654ae6b)return tracks(item);
   if(item.id===0x1f43b675)invalid();available(item);at=item.end;
  }
  invalid();
 }catch(error){if(error!==incomplete)throw error;if(data.length>=MAX_WEBM_HEADER_BYTES)invalid();return null;}
}

// A stable child-process surface lets callers install output/lifecycle handlers
// before the first upload. The real encoder starts as soon as Tracks is known;
// at most 1 MiB of the initial header is retained, never a complete recording.
export class WebmEncoder extends EventEmitter{
 constructor(launch){
  super();this.launch=launch;this.stdout=new PassThrough();this.stderr=new PassThrough();this.exitCode=null;this.killed=false;this.closed=false;this.prefix=Buffer.allocUnsafe(MAX_WEBM_HEADER_BYTES);this.prefixLength=0;
  this.stdin=new Writable({
   write:(data,_encoding,done)=>this.write(data,done),
   final:done=>{
    if(this.closed)return done();
    if(this.worker)return this.worker.stdin.end(done);
    if(this.prefixLength)return done(Error('The WebM video header is incomplete.'));
    done();queueMicrotask(()=>this.complete(0));
   },
   destroy:(error,done)=>{
    if(!this.closed&&(error||!this.stdin.writableFinished)){
     if(error){this.preservePrefix();if(!this.errorEmitted){this.errorEmitted=true;this.emit('error',error);}}
     if(this.worker){this.worker.stdin.destroy();try{this.worker.kill();}catch{}}
     else queueMicrotask(()=>this.complete(error||this.killed?1:0));
    }
    done(error);
   }
  });
 }
 get pid(){return this.worker?.pid;}
 preservePrefix(){if(!this.recoveryInput&&this.prefixLength)this.recoveryInput=Buffer.from(this.prefix.subarray(0,this.prefixLength));}
 write(data,done){
  if(this.killed||this.closed)return done(Error('The video encoder has closed.'));
  const written=error=>done(error||((this.killed||this.closed)?Error('The video encoder has closed.'):undefined));
  try{
   if(!this.worker){
    const previous=this.prefixLength,copied=Math.min(data.length,MAX_WEBM_HEADER_BYTES-previous);data.copy(this.prefix,previous,0,copied);this.prefixLength+=copied;
    const color=webmVideoColor(this.prefix.subarray(0,this.prefixLength));
    if(!color)return done();
    const payload=previous?Buffer.concat([this.prefix.subarray(0,previous),data]):data;
    const worker=this.launch(color.filter);this.worker=worker;
    worker.stdout?.pipe(this.stdout);worker.stderr?.pipe(this.stderr);
    worker.stdin.on('error',error=>this.stdin.destroy(error));
    worker.on('error',error=>{this.preservePrefix();if(!this.errorEmitted){this.errorEmitted=true;this.emit('error',error);}});
    worker.once('close',(code,signal)=>this.complete(code,signal));
    // spawn() can return a child before its asynchronous ENOENT/EPIPE. Keep
    // acknowledged header fragments until its first input write succeeds.
    return worker.stdin.write(payload,error=>{if(error||this.killed||this.closed)this.preservePrefix();else{this.prefix=null;this.prefixLength=0;}written(error);});
   }
   this.worker.stdin.write(data,written);
  }catch(error){done(error);}
 }
 complete(code,signal){
  if(this.closed)return;if(code!==0)this.preservePrefix();this.closed=true;this.exitCode=code;this.prefix=null;this.prefixLength=0;
  this.stdin.destroy();this.stdout.end();this.stderr.end();this.emit('close',code,signal);
 }
 kill(signal){
  if(this.closed)return false;this.killed=true;
  if(this.worker)return this.worker.kill(signal);
  this.stdin.destroy();queueMicrotask(()=>this.complete(1,signal||'SIGTERM'));return true;
 }
}
