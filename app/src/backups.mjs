import {overlayAssets,validateOverlays,restoreOverlayAssets} from './overlays.mjs';
import crypto from 'node:crypto';
import {promisify} from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import {AppError,validateChannel} from './core.mjs';
import {validateEncoding} from './encoding.mjs';
import {validateOperations} from './operations.mjs';
import {validateNotifications} from './notifications.mjs';
import {validateUpdates} from './updates.mjs';
import {sourceUrl} from './remote-sources.mjs';
const scrypt=promisify(crypto.scrypt),aad=Buffer.from('Go Streams encrypted backup v1');
const maxBytes=16*1024*1024;
const projectFields=['media','channels','playlists','schedules','channelPlans','history','downloads'];
const settingFields=['settings','notifications','updates'];
function fail(message='Cópia de segurança inválida.'){throw new AppError(message);}
function password(value){if(typeof value!=='string'||value.length<10||value.length>1024)fail('Use uma palavra-passe com pelo menos 10 caracteres.');return value;}
function scope(value){if(!['all','project','settings'].includes(value))fail();return value;}
function text(value,max=3000){if(typeof value!=='string'||value.length>max||/[\x00-\x1f]/.test(value))fail();return value;}
function ids(items,max=Infinity){if(!Array.isArray(items)||items.length>max)fail();const seen=new Set();for(const item of items){if(!item||typeof item.id!=='string'||!/^[\w-]{1,100}$/.test(item.id)||seen.has(item.id))fail();seen.add(item.id);}return seen;}
function prefs(input){if(!input||!['en','es','fr','hi','ar','zh','bn','ru','id','pt-PT'].includes(input.language)||!['list','grid'].includes(input.layout)||typeof input.compact!=='boolean')fail('Preferências da interface inválidas.');return{language:input.language,layout:input.layout,compact:input.compact};}
export async function exportBackup(store,vault,input){
 const selected=scope(input.scope),snapshot=structuredClone(store.data),data={};
 for(const key of [...(selected!=='settings'?projectFields:[]),...(selected!=='project'?settingFields:[])])if(snapshot[key]!==undefined)data[key]=snapshot[key];
 if(data.channels)data.channels=data.channels.map(({secret,...c})=>({...c,key:secret?vault.decrypt(secret):''}));
 if(data.notifications){const {secret,...n}=data.notifications;data.notifications={...n,password:secret?vault.decrypt(secret):''};}
 const payload={version:1,scope:selected,data,...(data.settings?.overlays?{overlayAssets:overlayAssets(data.settings.overlays,store.directory)}:{}),...(selected!=='project'?{interface:prefs(input.interface)}:{})};
 const bytes=Buffer.from(JSON.stringify(payload));if(bytes.length>maxBytes)fail('A cópia excede o limite de 16 MB, sem incluir vídeos.');
 const salt=crypto.randomBytes(16),iv=crypto.randomBytes(12),key=await scrypt(password(input.password),salt,32);
 try{const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(aad);const encrypted=Buffer.concat([cipher.update(bytes),cipher.final()]);return{kind:'go-streams-backup',version:1,salt:salt.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:encrypted.toString('base64')};}finally{key.fill(0);bytes.fill(0);}
}
export async function decryptBackup(envelope,pass){
 if(!envelope||envelope.kind!=='go-streams-backup'||envelope.version!==1)fail();
 for(const key of ['salt','iv','tag','data'])if(typeof envelope[key]!=='string'||!envelope[key].length||!/^[A-Za-z0-9+/]*={0,2}$/.test(envelope[key]))fail();
 if(envelope.data.length>Math.ceil(maxBytes/3)*4)fail();
 const salt=Buffer.from(envelope.salt,'base64'),iv=Buffer.from(envelope.iv,'base64'),tag=Buffer.from(envelope.tag,'base64');if(salt.length!==16||iv.length!==12||tag.length!==16)fail();
 const key=await scrypt(password(pass),salt,32);let plain;
 try{const decipher=crypto.createDecipheriv('aes-256-gcm',key,iv);decipher.setAAD(aad);decipher.setAuthTag(tag);plain=Buffer.concat([decipher.update(Buffer.from(envelope.data,'base64')),decipher.final()]);return JSON.parse(plain.toString('utf8'));}catch{fail('Palavra-passe incorreta ou cópia de segurança danificada.');}finally{key.fill(0);plain?.fill(0);}
}
export function prepareBackupRestore(payload,current,vault,directory,{persistAssets=true}={}){
 if(!payload||payload.version!==1||!payload.data||typeof payload.data!=='object')fail();const selected=scope(payload.scope),data=payload.data,next=structuredClone(current);
 if(selected!=='settings'){
  const mediaIds=ids(data.media),channelIds=ids(data.channels),playlistIds=ids(data.playlists);ids(data.schedules);
  next.media=data.media.map(m=>{
   text(m.title,200);text(m.path,4000);
   if(m.source)sourceUrl(m.path);else if(!path.win32.isAbsolute(m.path)&&!path.posix.isAbsolute(m.path))fail();
   if(!Number.isFinite(m.duration)||m.duration<=0||!Number.isFinite(m.fps)||m.fps<0||!Number.isInteger(m.width)||m.width<1||!Number.isInteger(m.height)||m.height<1||!Number.isFinite(m.size)||m.size<0)fail();
   return {...m,thumbnail:!m.source&&fs.existsSync(path.join(directory,'thumbs',m.id+'.jpg'))};
  });
  next.channels=data.channels.map(c=>{const {key,secret,...rest}=c;if(secret!==undefined)fail();const valid=validateChannel({...c,key:key||'validation-only'});text(key,1000);return{...rest,...valid,key:undefined,secret:key?vault.encrypt(key):''};});
  next.channels=next.channels.map(({key,...c})=>c);
  next.playlists=data.playlists.map(p=>{text(p.name,100);if(!Array.isArray(p.mediaIds)||p.mediaIds.length>500||p.mediaIds.some(id=>!mediaIds.has(id))||typeof p.loop!=='boolean'||!['720p','1080p'].includes(p.quality))fail();return p;});
  next.schedules=data.schedules.map(s=>{
   if(Boolean(s.mediaId)===Boolean(s.playlistId)||(s.mediaId&&!mediaIds.has(s.mediaId))||(s.playlistId&&!playlistIds.has(s.playlistId))||!Array.isArray(s.channelIds)||!s.channelIds.length||s.channelIds.some(id=>!channelIds.has(id))||new Set(s.channelIds).size!==s.channelIds.length||!Number.isFinite(Date.parse(s.at))||typeof s.armed!=='boolean'||!['pending','starting','triggered','missed','error','cancelled','interrupted'].includes(s.status))fail();
   try{new Intl.DateTimeFormat('en',{timeZone:s.timeZone||'UTC'});}catch{fail();}
   return s.status==='starting'?{...s,status:'interrupted',armed:false}:s;
  });
  next.channelPlans={};for(const [cid,p] of Object.entries(data.channelPlans||{})){
   if(!channelIds.has(cid)||!p||Boolean(p.mediaId)===Boolean(p.playlistId)||(p.mediaId&&!mediaIds.has(p.mediaId))||(p.playlistId&&!playlistIds.has(p.playlistId))||!Number.isInteger(p.countdown)||p.countdown<0||p.countdown>120)fail();next.channelPlans[cid]=p;
  }
  ids(data.history||[],50000);next.history=data.history||[];
  ids(data.downloads||[]);next.downloads=(data.downloads||[]).map(d=>{
   if(d.path)text(d.path,4000);return ['running','validating','importing','cancelling'].includes(d.status)?{...d,status:'interrupted',error:'Download interrompido antes do restauro.'}:d;
  });
 }
 if(selected!=='project'){
  if(!data.settings||typeof data.settings!=='object')fail();
  const settings={};for(const key of ['ffmpeg','ffprobe','ytdlp']){if(data.settings[key]===undefined)continue;const value=data.settings[key];text(value);if(value&&!path.win32.isAbsolute(value)&&!path.posix.isAbsolute(value))fail();settings[key]=value;}
  if(data.settings.encoding!==undefined)settings.encoding=validateEncoding(data.settings.encoding);if(data.settings.operations!==undefined)settings.operations=validateOperations(data.settings.operations);if(data.settings.overlays!==undefined){
   // Version 1 backups carry immutable files in overlayAssets, never inline uploads.
   if(['top','bottom','image'].some(key=>data.settings.overlays?.[key]?.data!==undefined))fail();
   settings.overlays=validateOverlays(data.settings.overlays,{directory,assets:payload.overlayAssets,persist:false});
  }next.settings=settings;
  if(data.notifications){const {password:pass,...valid}=validateNotifications(data.notifications);next.notifications={...valid,secret:pass?vault.encrypt(pass):''};}else delete next.notifications;
  if(data.updates)next.updates=validateUpdates(data.updates);else delete next.updates;
 }
 const ui=selected==='project'?null:prefs(payload.interface);
 if(selected!=='project'&&next.settings.overlays)next.settings.overlays=restoreOverlayAssets(next.settings.overlays,payload.overlayAssets,directory,{persist:persistAssets});
 return {data:next,scope:selected,interface:ui};
}
