import {ytdlpPath,mediaToolPath} from './tool-paths.mjs';
import dns from 'node:dns/promises';
import https from 'node:https';
import net from 'node:net';
import crypto from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {AppError} from './errors.mjs';

const invalid=()=>new AppError('Use a public HTTPS MP4 link or an individual YouTube video.');
export function sourceUrl(value) {
  if(typeof value!=='string'||value.length>4000||/[\x00-\x20]/.test(value))throw invalid();
  let u;try{u=new URL(value);}catch{throw invalid();}
  if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443')||u.hash)throw invalid();
  if(['youtube.com','www.youtube.com','m.youtube.com','youtu.be','www.youtu.be'].includes(u.hostname)){
    const id=u.hostname.endsWith('youtu.be')?u.pathname.slice(1):u.pathname==='/watch'?u.searchParams.get('v'):/^\/(?:shorts|live|embed)\/([\w-]{11})\/?$/.exec(u.pathname)?.[1];
    if(!/^[\w-]{11}$/.test(id||''))throw invalid();
    return {source:'youtube',path:`https://www.youtube.com/watch?v=${id}`};
  }
  // Finite MP4 sources only: manifests can introduce additional, untrusted URLs.
  if(!/\.mp4$/i.test(u.pathname))throw invalid();
  return {source:'https',path:u.href};
}
export function publicAddress(address) {
  if(net.isIP(address)!==4)return false; // Fail closed for IPv6 and mapped/transition ranges.
  const [a,b,c]=address.split('.').map(Number);
  return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===2)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);
}
export function mediaHeaders(input={}) {
  const output={};
  for(const [name,value] of Object.entries(input||{})){
    const key=name.toLowerCase();
    if(!['user-agent','accept','accept-language','referer','origin'].includes(key)||typeof value!=='string'||value.length>2000||/[^\x20-\x7e]/.test(value))continue;
    if(['referer','origin'].includes(key)){
      let u;try{u=new URL(value);}catch{continue;}
      if(u.protocol!=='https:'||u.username||u.password||u.port||!['youtube.com','www.youtube.com'].includes(u.hostname))continue;
    }
    output[key]=value;
  }
  return output;
}
async function resolveAddresses(host,lookup,signal,timeout) {
  if(signal?.aborted)throw new AppError('Remote source cancelled.');
  let timer,abort;
  try{
    return await Promise.race([
      Promise.resolve().then(()=>lookup(host,{family:4,all:true})),
      new Promise((resolve,reject)=>{
        timer=setTimeout(()=>reject(new AppError('Remote DNS lookup timed out.')),timeout);
        abort=()=>reject(new AppError('Remote source cancelled.'));
        signal?.addEventListener('abort',abort,{once:true});
      })
    ]);
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
export async function publicTarget(value,lookup=dns.lookup,{signal,timeout=15000}={}) {
  let u;try{u=new URL(value);}catch{throw invalid();}
  if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443'))throw invalid();
  const records=await resolveAddresses(u.hostname,lookup,signal,timeout);
  if(!records.length||records.some(r=>!publicAddress(r.address)))throw new AppError('Private and reserved network addresses are not allowed.');
  return {url:u,address:records[0].address};
}
export async function openRemote(value,{range,signal,headers,lookup=dns.lookup,request=https.request}={}) {
  for(let hop=0;hop<6;hop++){
    if(signal?.aborted)throw new AppError('Remote source cancelled.');
    const {url,address}=await publicTarget(value,lookup,{signal});
    const response=await new Promise((resolve,reject)=>{
      const req=request(url,{method:'GET',agent:false,signal,headers:{'user-agent':'GoStreams/0.12',...mediaHeaders(headers),'accept-encoding':'identity',...(range?{Range:range}:{})},lookup:(_host,options,cb)=>options.all?cb(null,[{address,family:4}]):cb(null,address,4)},resolve);
      req.setTimeout(15000,()=>req.destroy(new Error('Remote source timed out.')));
      req.once('error',reject);req.end();
    });
    if([301,302,303,307,308].includes(response.statusCode)){
      const location=response.headers.location;response.destroy();if(!location)throw invalid();
      value=new URL(location,url).href;continue;
    }
    return response;
  }
  throw new AppError('Too many redirects from the video source.');
}
export class RemoteSources {
  constructor({base,settings,execute,open=openRemote}) {
    this.base=base;this.settings=settings;this.execute=execute;this.open=open;this.entries=new Map();this.requests=new Set();this.closed=false;this.probes=0;
  }
  entry(media) {
    if(this.closed)throw new AppError('Remote sources are shutting down.',503);
    const source=sourceUrl(media.path);
    let entry=this.entries.get(source.path);
    if(!entry){if(this.entries.size>=2000)throw new AppError('Remote source limit reached. Restart the application to clear unused links.');entry={...source,token:crypto.randomBytes(32).toString('hex'),resolved:null,at:0};this.entries.set(source.path,entry);}
    return entry;
  }
  input(media) {const e=this.entry(media);return `${this.base}/source/${e.token}`;}
  async resolve(entry,force=false) {
    if(entry.source==='https')return {url:entry.path};
    // A late rejection of an old signed URL must not discard a newer shared resolution.
    if(force&&(force===true||entry.resolved?.url===force)){entry.at=0;entry.resolved=null;}
    if(entry.resolved&&Date.now()-entry.at<5*60*1000)return entry.resolved;
    if(entry.pending)return entry.pending;
    entry.pending=(async()=>{
      try{
        const settings=this.settings();
        const {stdout}=await this.execute(ytdlpPath(settings),['--ignore-config','--no-playlist','--no-cache-dir','--no-plugin-dirs','--no-remote-components','--js-runtimes',`node:${process.execPath}`,'--skip-download','--dump-single-json','--no-warnings','--socket-timeout','15','--retries','1','-f','b[ext=mp4][protocol=https][vcodec!=none][acodec!=none]','--',entry.path],{timeout:45000,maxBytes:4*1024*1024,signal:this.controller.signal});
        const info=JSON.parse(stdout);
        if(info.protocol!=='https'||info.ext!=='mp4'||info.is_live||info.is_upcoming||info.live_status==='is_live'||!(info.duration>0)||!info.url)throw Error();
        const url=new URL(info.url);
        if(url.protocol!=='https:'||url.username||url.password||!(url.hostname==='googlevideo.com'||url.hostname.endsWith('.googlevideo.com')))throw Error();
        entry.resolved={url:url.href,headers:mediaHeaders(info.http_headers),title:String(info.title||'YouTube video').replace(/[\x00-\x1f]/g,' ').slice(0,200)};entry.at=Date.now();return entry.resolved;
      }catch{throw new AppError('YouTube source unavailable. Check yt-dlp, video access and availability of a combined MP4 format.');}
      finally{entry.pending=null;}
    })();
    return entry.pending;
  }
  controller=new AbortController();
  async serve(req,res,entry) {
    if(this.closed)throw new AppError('Remote sources are shutting down.',503);
    if(!['GET','HEAD'].includes(req.method))throw new AppError('Method not allowed.',405);
    if(this.requests.size>=32)throw new AppError('Too many active remote reads. Try again shortly.',429);
    const range=req.headers.range;
    if(range&&(range.length>100||!/^bytes=(?:\d+-\d*|-\d+)$/.test(range)))throw new AppError('Invalid range.',416);
    const controller=new AbortController();this.requests.add(controller);
    const abort=()=>controller.abort();res.once('close',abort);
    let upstream,rejectedUrl;
    try{
      for(let attempt=0;attempt<2;attempt++){
        const resolved=await this.resolve(entry,attempt>0?rejectedUrl:false);
        upstream=await this.open(resolved.url,{range,signal:controller.signal,headers:resolved.headers});
        if(![401,403].includes(upstream.statusCode)||entry.source!=='youtube'||attempt)break;
        rejectedUrl=resolved.url;upstream.destroy();
      }
      if(![200,206,416].includes(upstream.statusCode))throw new AppError('Remote source unavailable. Check the link and your Internet connection.',502);
      const type=String(upstream.headers['content-type']||'').split(';')[0].toLowerCase();
      if(upstream.statusCode!==416&&!['video/mp4','application/mp4','application/octet-stream','binary/octet-stream'].includes(type))throw new AppError('The link must return an MP4 video, not a webpage or playlist.',415);
      const headers={'Content-Type':'video/mp4','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
      for(const key of ['content-length','content-range','accept-ranges'])if(upstream.headers[key])headers[key]=upstream.headers[key];
      res.writeHead(upstream.statusCode,headers);
      if(req.method==='HEAD'){upstream.destroy();res.end();}else await pipeline(upstream,res);
    }finally{upstream?.destroy();res.removeListener('close',abort);this.requests.delete(controller);}
  }
  async handle(req,res) {
    const token=/^\/source\/([a-f0-9]{64})$/.exec(req.url)?.[1];
    const entry=token&&[...this.entries.values()].find(e=>e.token===token);
    if(!entry)throw new AppError('Source not found.',404);
    return this.serve(req,res,entry);
  }
  async probe(media) {
    if(this.probes>=2)throw new AppError('Wait for the current remote video checks to finish.',429);
    this.probes++;
    try{return await this.probeSource(media);}finally{this.probes--;}
  }
  async probeSource(media) {
    const entry=this.entry(media),input=this.input(media);
    const resolved=await this.resolve(entry);
    try{
      const {stdout}=await this.execute(mediaToolPath('ffprobe',this.settings()),['-v','error','-protocol_whitelist','http,tcp','-format_whitelist','mov','-rw_timeout','15000000','-show_format','-show_streams','-of','json',input],{timeout:45000,signal:this.controller.signal});
      const info=JSON.parse(stdout),v=info.streams?.find(s=>s.codec_type==='video'),a=info.streams?.find(s=>s.codec_type==='audio');
      const duration=Number(info.format?.duration||v?.duration),[num,den]=(v?.avg_frame_rate||'0/1').split('/').map(Number);
      if(!v||!(duration>0)||!Number.isFinite(duration)||!(v.width>0)||!(v.height>0))throw Error();
      let name=new URL(entry.path).pathname.split('/').pop();try{name=decodeURIComponent(name);}catch{}
      return {source:entry.source,path:entry.path,title:resolved.title||name.slice(0,200),duration,width:v.width,height:v.height,fps:den?num/den:0,codec:v.codec_name,pixelFormat:v.pix_fmt,timeBase:v.time_base,audio:a?{codec:a.codec_name,rate:a.sample_rate,channels:a.channels,layout:a.channel_layout}:null,size:0,thumbnail:false};
    }catch{throw new AppError('Could not read the remote MP4 video. Check the link, Internet connection and format.');}
  }
  async shutdown() {this.closed=true;this.controller.abort();for(const c of this.requests)c.abort();await Promise.allSettled([...this.entries.values()].map(e=>e.pending).filter(Boolean));this.entries.clear();}
}
