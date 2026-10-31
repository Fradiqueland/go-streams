import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {atomicWrite,AppError} from './core.mjs';

const GOOGLE_SCOPE='https://www.googleapis.com/auth/youtube.force-ssl';
const TWITCH_SCOPES='user:read:chat user:write:chat';
const ORIGINS=new Set(['https://oauth2.googleapis.com','https://www.googleapis.com','https://id.twitch.tv','https://api.twitch.tv']);
export class ChatAuth {
 constructor(studio,{base,request=fetch}={}){
  Object.assign(this,{studio,base,request});this.pending=new Map();this.refreshing=new Map();this.operations=new Set();this.controller=new AbortController();this.versions={YouTube:0,Twitch:0};
  this.file=path.join(studio.store.directory,'chat-accounts.json');this.data={settings:{},accounts:{}};
  if(fs.existsSync(this.file)){
   try{this.data=JSON.parse(studio.vault.decrypt(JSON.parse(fs.readFileSync(this.file,'utf8')).secret));if(!this.data.settings||!this.data.accounts)throw Error();}
   catch{throw new AppError('Chat account storage could not be opened. Existing data was preserved.',500);}
  }
 }
 save(){if(this.controller.signal.aborted)throw new AppError('The studio is closing.',409);atomicWrite(this.file,JSON.stringify({version:1,secret:this.studio.vault.encrypt(JSON.stringify(this.data))}));}
 async http(url,options={}){
  if(!ORIGINS.has(new URL(url).origin))throw new AppError('Chat service address rejected.');
  const task=(async()=>{
   let response;
   try{response=await this.request(url,{...options,redirect:'error',signal:AbortSignal.any([this.controller.signal,AbortSignal.timeout(15000)])});}
   catch{throw new AppError('The chat service could not be reached.',502);}
   const chunks=[];let size=0;
   if(response.body){for await(const chunk of response.body){size+=chunk.length;if(size>1024*1024)throw new AppError('Chat service response was too large.',502);chunks.push(Buffer.from(chunk));}}
   let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch{throw new AppError('Invalid chat service response.',502);}
   if(this.controller.signal.aborted)throw new AppError('The studio is closing.',409);
   return {ok:response.ok,status:response.status,value};
  })();
  this.operations.add(task);try{return await task;}finally{this.operations.delete(task);}
 }
 async form(url,values){return this.http(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(values).toString()});}
 state(){
  return Object.fromEntries(['YouTube','Twitch'].map(provider=>{
   const account=this.data.accounts[provider],setup=this.data.settings[provider]||{},pending=this.pending.get(provider);
   return [provider,{configured:Boolean(setup.clientId),clientId:setup.clientId||'',hasClientSecret:Boolean(setup.clientSecret),authorized:Boolean(account),name:account?.name||'',pending:pending?{url:pending.url,code:pending.userCode||'',expires:pending.expires}:null}];
  }));
 }
 configure(provider,input){
  if(!['YouTube','Twitch'].includes(provider))throw new AppError('Unsupported chat provider.');
  const clientId=String(input.clientId||'').trim();
  if(provider==='YouTube'?!/^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(clientId):!/^[a-z0-9]{8,100}$/.test(clientId))throw new AppError('Enter a registered OAuth application client ID.');
  const old=this.data.settings[provider]||{};
  if(old.clientId&&old.clientId!==clientId&&this.data.accounts[provider])throw new AppError('Disconnect the account before changing its application ID.',409);
  const clientSecret=input.clientSecret===undefined||input.clientSecret===''?old.clientSecret||'':input.clientSecret;
  if(typeof clientSecret!=='string'||clientSecret.length>500||/[\x00-\x20]/.test(clientSecret))throw new AppError('Invalid OAuth application secret.');
  this.cancel(provider);this.versions[provider]++;this.data.settings[provider]={clientId,clientSecret};this.save();return this.state();
 }
 async begin(provider){
  const setup=this.data.settings[provider];if(!setup?.clientId)throw new AppError('Configure the registered OAuth application first.');
  this.cancel(provider);
  const version=++this.versions[provider];
  if(provider==='YouTube'){
   const state=crypto.randomBytes(32).toString('hex'),verifier=crypto.randomBytes(48).toString('base64url');
   const params=new URLSearchParams({client_id:setup.clientId,redirect_uri:this.base+'/oauth/youtube',response_type:'code',scope:GOOGLE_SCOPE,state,code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',access_type:'offline',prompt:'consent'});
   const pending={state,verifier,version,expires:Date.now()+600000,url:'https://accounts.google.com/o/oauth2/v2/auth?'+params};this.pending.set(provider,pending);return this.state();
  }
  if(provider!=='Twitch')throw new AppError('Unsupported chat provider.');
  const result=await this.form('https://id.twitch.tv/oauth2/device',{client_id:setup.clientId,scopes:TWITCH_SCOPES});
  if(!result.ok||!result.value.device_code)throw new AppError('Twitch authorization could not be started. Check the public application ID.',502);
  const url=new URL(result.value.verification_uri);
  if(url.origin!=='https://www.twitch.tv'||url.pathname!=='/activate')throw new AppError('Twitch authorization address rejected.',502);
  if(this.versions[provider]!==version)throw new AppError('Authorization was cancelled.',409);
  const pending={deviceCode:result.value.device_code,userCode:String(result.value.user_code||''),version,url:url.href,expires:Date.now()+Math.min(1800,Number(result.value.expires_in)||600)*1000,interval:Math.max(5,Number(result.value.interval)||5)*1000};this.pending.set(provider,pending);
  this.scheduleDevice(pending);return this.state();
 }
 scheduleDevice(pending){pending.timer=setTimeout(()=>{void this.pollDevice(pending).catch(()=>{if(this.pending.get('Twitch')===pending)this.pending.delete('Twitch');});},pending.interval).unref();}
 async pollDevice(pending){
  if(this.pending.get('Twitch')!==pending||Date.now()>pending.expires||this.controller.signal.aborted){this.cancel('Twitch');return;}
  const {clientId}=this.data.settings.Twitch;
  const result=await this.form('https://id.twitch.tv/oauth2/token',{client_id:clientId,device_code:pending.deviceCode,scopes:TWITCH_SCOPES,grant_type:'urn:ietf:params:oauth:grant-type:device_code'});
  if(this.pending.get('Twitch')!==pending)return;
  if(!result.ok){if(result.value.message==='authorization_pending'||result.value.message==='slow_down'){if(result.value.message==='slow_down')pending.interval+=5000;this.scheduleDevice(pending);return;}this.cancel('Twitch');return;}
  await this.accept('Twitch',result.value,pending.version);if(this.pending.get('Twitch')===pending)this.cancel('Twitch');
 }
 async callback(params){
  const pending=this.pending.get('YouTube');
  if(!pending||Date.now()>pending.expires||params.get('state')!==pending.state)throw new AppError('Authorization expired or state did not match.',403);
  this.pending.delete('YouTube');
  if(params.has('error'))throw new AppError('YouTube authorization was declined.');
  const code=params.get('code');if(!code||code.length>4000)throw new AppError('Invalid authorization response.');
  const setup=this.data.settings.YouTube;
  const result=await this.form('https://oauth2.googleapis.com/token',{client_id:setup.clientId,...(setup.clientSecret?{client_secret:setup.clientSecret}:{}),code,code_verifier:pending.verifier,redirect_uri:this.base+'/oauth/youtube',grant_type:'authorization_code'});
  if(!result.ok)throw new AppError('YouTube authorization could not be completed. Check the desktop OAuth application settings.',502);
  await this.accept('YouTube',result.value,pending.version);
 }
 async accept(provider,tokens,version=this.versions[provider]){
  if(typeof tokens.access_token!=='string'||!tokens.access_token||tokens.access_token.length>10000)throw new AppError('The provider did not return an access token.',502);
  let id,name;
  if(provider==='Twitch'){
   const checked=await this.http('https://id.twitch.tv/oauth2/validate',{headers:{Authorization:'OAuth '+tokens.access_token}}),v=checked.value;
   if(!checked.ok||v.client_id!==this.data.settings.Twitch.clientId||!v.user_id||!TWITCH_SCOPES.split(' ').every(s=>v.scopes?.includes(s)))throw new AppError('Twitch did not grant permission to read and reply to chat.',403);
   id=v.user_id;name=v.login;
  }else{
   const checked=await this.http('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',{headers:{Authorization:'Bearer '+tokens.access_token}}),item=checked.value.items?.[0];
   if(!checked.ok||!item?.id)throw new AppError('No authorized YouTube channel was found.',403);id=item.id;name=item.snippet?.title||'YouTube';
  }
  const old=this.data.accounts[provider];
  if(this.versions[provider]!==version||this.controller.signal.aborted)throw new AppError('Authorization was cancelled.',409);
  this.data.accounts[provider]={id,name,accessToken:tokens.access_token,refreshToken:tokens.refresh_token||old?.refreshToken||'',expires:Date.now()+(Number(tokens.expires_in)||3600)*1000,validated:Date.now()};this.save();
 }
 async token(provider){
  const account=this.data.accounts[provider];if(!account)throw new AppError('Authorize your '+provider+' account first.',401);
  if(account.expires>Date.now()+60000&&(provider!=='Twitch'||account.validated>Date.now()-3600000))return account;
  if(this.refreshing.has(provider))return this.refreshing.get(provider);
  const task=(async()=>{
   const version=this.versions[provider];
   if(provider==='Twitch'&&account.expires>Date.now()+60000){await this.accept(provider,{access_token:account.accessToken,refresh_token:account.refreshToken,expires_in:Math.floor((account.expires-Date.now())/1000)},version);return this.data.accounts[provider];}
   if(!account.refreshToken)throw new AppError('Reconnect your '+provider+' account.',401);
   const setup=this.data.settings[provider],result=await this.form(provider==='YouTube'?'https://oauth2.googleapis.com/token':'https://id.twitch.tv/oauth2/token',{client_id:setup.clientId,...(setup.clientSecret?{client_secret:setup.clientSecret}:{}),refresh_token:account.refreshToken,grant_type:'refresh_token'});
   if(!result.ok)throw new AppError('Reconnect your '+provider+' account.',401);
   await this.accept(provider,result.value,version);return this.data.accounts[provider];
  })();this.refreshing.set(provider,task);try{return await task;}finally{this.refreshing.delete(provider);}
 }
 cancel(provider){const pending=this.pending.get(provider);if(pending?.timer)clearTimeout(pending.timer);this.pending.delete(provider);}
 disconnect(provider){if(!['YouTube','Twitch'].includes(provider))throw new AppError('Unsupported chat provider.');this.cancel(provider);this.versions[provider]++;delete this.data.accounts[provider];this.save();}
 async shutdown(){this.controller.abort();this.cancel('YouTube');this.cancel('Twitch');await Promise.allSettled([...this.operations,...this.refreshing.values()]);}
}
