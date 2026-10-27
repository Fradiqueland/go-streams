import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {AppError} from './errors.mjs';
import {outputDimensions} from './encoding.mjs';
const bad=()=>{throw new AppError('Invalid overlay settings or image.');};
const number=(v,min,max)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)bad();return v;};
const color=v=>{if(typeof v!=='string'||!/^#[a-f0-9]{6}$/i.test(v))bad();return v;};
export const overlayDefaults={top:{enabled:false,text:'',fontSize:32,speed:100,direction:'left',color:'#ffffff',background:'#000000',opacity:.65,asset:''},bottom:{enabled:false,text:'',fontSize:32,speed:100,direction:'left',color:'#ffffff',background:'#000000',opacity:.65,asset:''},image:{enabled:false,asset:'',width:15,x:95,y:15,opacity:1}};
const assetPattern=/^[a-f0-9]{64}\.(png|jpg|gif|webp)$/;
export function assetFile(directory,name){if(!assetPattern.test(name))bad();return path.join(directory,'overlays',name);}
function validAsset(directory,name){
 try{const file=assetFile(directory,name),stat=fs.statSync(file);return stat.isFile()&&stat.size<=2*1024*1024&&crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')===name.split('.')[0];}catch{return false;}
}
function decode(data,banner){
 const match=/^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(data||'');if(!match)bad();
 const bytes=Buffer.from(match[2],'base64');if(bytes.length>(banner?512*1024:2*1024*1024)||bytes.length<12)bad();
 const type=match[1],valid=type==='png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):type==='gif'?/^GIF8[79]a$/.test(bytes.subarray(0,6).toString()):type==='jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
 if(!valid||(banner&&type!=='png'))bad();
 return {bytes,name:crypto.createHash('sha256').update(bytes).digest('hex')+'.'+(type==='jpeg'?'jpg':type)};
}
export function validateOverlays(input,{directory,assets,persist=true}={}){
 if(!input||typeof input!=='object'||Array.isArray(input))bad();const result={};const writes=[];
 for(const key of ['top','bottom','image']){
  const v={...overlayDefaults[key],...input[key]};if(typeof v.enabled!=='boolean')bad();
  let asset=v.asset||'';if(asset&&!assetPattern.test(asset))bad();if(v.data){const decoded=decode(v.data,key!=='image');writes.push(decoded);asset=decoded.name;}
  if(asset&&!assetPattern.test(asset))bad();if(v.enabled&&!asset)bad();
  if(asset&&!writes.some(w=>w.name===asset)&&directory&&!assets?.[asset]&&!validAsset(directory,asset)){
    if(v.enabled)throw new AppError('Overlay image is missing or damaged. Select the image again.');asset='';
  }
  if(key==='image')result[key]={enabled:v.enabled,asset,width:number(v.width,5,60),x:number(v.x,0,100),y:number(v.y,0,100),opacity:number(v.opacity,.05,1)};
  else{
   if(typeof v.text!=='string'||v.text.length>500||/[\x00-\x1f]/.test(v.text)||!['left','right'].includes(v.direction))bad();
   if(v.enabled&&!v.text.trim())bad();
   result[key]={enabled:v.enabled,text:v.text,fontSize:number(v.fontSize,16,64),speed:number(v.speed,20,300),direction:v.direction,color:color(v.color),background:color(v.background),opacity:number(v.opacity,0,1),asset};
  }
 }
 if(directory&&persist){for(const w of writes){fs.mkdirSync(path.join(directory,'overlays'),{recursive:true});const file=assetFile(directory,w.name);if(!fs.existsSync(file))fs.writeFileSync(file,w.bytes,{mode:0o600});}}
 return result;
}
export const hasOverlays=config=>Boolean(config&&['top','bottom','image'].some(k=>config[k]?.enabled));
export function overlayAssets(config,directory){const assets={};for(const k of ['top','bottom','image']){const name=config?.[k]?.asset;if(name&&!assets[name]){if(!validAsset(directory,name))throw new AppError('Overlay image is missing or damaged. Select the image again.');const type=name.endsWith('.jpg')?'jpeg':name.split('.').at(-1);assets[name]='data:image/'+type+';base64,'+fs.readFileSync(assetFile(directory,name)).toString('base64');}}return assets;}
export function restoreOverlayAssets(config,assets,directory,{persist=true}={}){
 const checked=validateOverlays(config,{directory,assets,persist:false});
 for(const [name,data]of Object.entries(assets||{})){if(!['top','bottom','image'].some(k=>checked[k].asset===name))bad();const decoded=decode(data,['top','bottom'].some(k=>checked[k].asset===name));if(decoded.name!==name)bad();}
 // Validate all bytes before creating immutable assets.
 if(persist)for(const [name,data]of Object.entries(assets||{})){const decoded=decode(data,false);fs.mkdirSync(path.join(directory,'overlays'),{recursive:true});fs.writeFileSync(assetFile(directory,name),decoded.bytes,{mode:0o600});}
 return checked;
}
export function overlayArguments(config,directory,quality,aspect,baseFilter,firstInput){
 const [width,height]=outputDimensions(quality,aspect),inputs=[],graph=[`[0:v]${baseFilter},setpts=PTS-STARTPTS[ov0]`];let current='ov0',index=firstInput,step=0;
 const attach=(key,filter,x,y)=>{
  const item=config[key],file=assetFile(directory,item.asset);if(!fs.existsSync(file))throw new AppError('Overlay image is missing. Select the image again.');
  inputs.push(...(item.asset.endsWith('.gif')?['-stream_loop','-1']:['-loop','1','-framerate','1']),'-protocol_whitelist','file,pipe','-i',file);
  graph.push(`[${index++}:v]${filter},format=rgba,setpts=PTS-STARTPTS[ovimg${step}]`);
  graph.push(`[${current}][ovimg${step}]overlay=x='${x}':y='${y}':shortest=1:format=auto[ov${step+1}]`);current='ov'+(++step);
 };
 if(config.image.enabled){const i=config.image,w=Math.max(2,Math.round(width*i.width/100/2)*2);attach('image',`scale=${w}:-2,colorchannelmixer=aa=${i.opacity}`,`(W-w)*${i.x/100}`,`(H-h)*${i.y/100}`);}
 for(const key of ['top','bottom'])if(config[key].enabled){const b=config[key],h=Math.max(2,Math.round((b.fontSize+24)*height/720/2)*2),y=key==='top'?'0':'H-h',speed=b.speed*height/720;
  graph.push(`[${current}]drawbox=x=0:y=${key==='top'?0:height-h}:w=iw:h=${h}:color=0x${b.background.slice(1)}@${b.opacity}:t=fill[bar${step}]`);current='bar'+step;
  attach(key,`scale=-2:${h}`,b.direction==='left'?`W-mod(t*${speed}\,W+w)`:`mod(t*${speed}\,W+w)-w`,y);
 }
 return {inputs,filter:graph.join(';'),output:current};
}

export async function checkOverlayFiles(config,directory,execute,ffprobe,{fileFor=name=>assetFile(directory,name),onlyActive=false,verify=new Set(),cancelled=()=>false}={}){
 for(const key of ['top','bottom','image']){if(cancelled())throw new AppError('A aplicação está a encerrar.',503);const item=config[key];if(!item.asset||(onlyActive&&!item.enabled&&!verify.has(item.asset)))continue;
  const {stdout}=await execute(typeof ffprobe==='function'?ffprobe():ffprobe,['-v','error','-protocol_whitelist','file,pipe','-show_streams','-of','json',fileFor(item.asset)],{timeout:15000,maxBytes:128*1024});
  if(cancelled())throw new AppError('A aplicação está a encerrar.',503);
  let stream;try{stream=JSON.parse(stdout).streams?.find(s=>s.codec_type==='video');}catch{}
  if(!stream||!['png','mjpeg','gif','webp'].includes(stream.codec_name)||!(stream.width>0)||!(stream.height>0)||stream.width>(key==='image'?4096:32768)||stream.height>(key==='image'?4096:128))throw new AppError('Unsupported or oversized overlay image.');
 }
}


export async function prepareOverlays(input,directory,execute,ffprobe,cancelled=()=>false){
 const config=validateOverlays(input,{directory,persist:false}),writes=new Map();let stage;
 try{
  for(const key of ['top','bottom','image'])if(input[key]?.data){const decoded=decode(input[key].data,key!=='image');writes.set(decoded.name,decoded.bytes);}
  if(writes.size){stage=fs.mkdtempSync(path.join(directory,'overlays-stage-'));for(const [name,bytes]of writes)fs.writeFileSync(path.join(stage,name),bytes,{mode:0o600});}
  if(['top','bottom','image'].some(key=>config[key].enabled)||writes.size)await checkOverlayFiles(config,directory,execute,ffprobe,{onlyActive:true,cancelled,verify:new Set(writes.keys()),fileFor:name=>writes.has(name)?path.join(stage,name):assetFile(directory,name)});
  if(cancelled())throw new AppError('A aplicação está a encerrar.',503);
  if(writes.size){fs.mkdirSync(path.join(directory,'overlays'),{recursive:true});for(const name of writes.keys())if(!validAsset(directory,name))fs.renameSync(path.join(stage,name),assetFile(directory,name));}
  return config;
 }finally{
  if(stage){const target=path.resolve(stage),base=path.resolve(directory)+path.sep;if(!target.startsWith(base)||!path.basename(target).startsWith('overlays-stage-'))throw Error('Unsafe overlay cleanup');fs.rmSync(target,{recursive:true,force:true});}
 }
}
