import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {atomicWrite,AppError} from './core.mjs';

const GOOGLE_SCOPE='https://www.googleapis.com/auth/youtube.force-ssl';
const TWITCH_SCOPES='user:read:chat user:write:chat';
const ORIGINS=new Set(['https://oauth2.googleapis.com','https://www.googleapis.com','https://id.twitch.tv','https://api.twitch.tv']);
function readTokens(tokens){
 if(!tokens||typeof tokens.access_token!=='string'||!tokens.access_token||tokens.access_token.length>10000)throw new AppError('The provider did not return an access token.',502);
 const lifetime=tokens.expires_in===undefined?3600:tokens.expires_in;
 if(!Number.isSafeInteger(lifetime)||lifetime<=0||!Number.isSafeInteger(Date.now()+lifetime*1000))throw new AppError('Invalid access token lifetime response.',502);
 if(tokens.refresh_token!==undefined&&(typeof tokens.refresh_token!=='string'||!tokens.refresh_token||tokens.refresh_token.length>10000))throw new AppError('Invalid refresh token response.',502);
 return {accessToken:tokens.access_token,refreshToken:tokens.refresh_token,expires:Date.now()+lifetime*1000};
}
export class ChatAuth {
 constructor(studio,{base,request=fetch,clock=true,onSessionEnd=()=>{}}={}){
  Object.assign(this,{studio,base,request,clock,onSessionEnd});this.pending=new Map();this.refreshing=new Map();this.operations=new Set();this.controller=new AbortController();this.versions={YouTube:0,Twitch:0};
  this.file=path.join(studio.store.directory,'chat-accounts.json');this.data={settings:{},accounts:{}};
  if(fs.existsSync(this.file)){
   try{this.data=JSON.parse(studio.vault.decrypt(JSON.parse(fs.readFileSync(this.file,'utf8')).secret));if(!this.data.settings||!this.data.accounts)throw Error();}
   catch{throw new AppError('Chat account storage could not be opened. Existing data was preserved.',500);}
  }
  if(this.data.accounts.Twitch){this.data.accounts.Twitch.validated=0;this.scheduleValidation(0);}
 }
 save(data=this.data){if(this.controller.signal.aborted)throw new AppError('The studio is closing.',409);atomicWrite(this.file,JSON.stringify({version:1,secret:this.studio.vault.encrypt(JSON.stringify(data))}));}
 async http(url,options={}){
  if(!ORIGINS.has(new URL(url).origin))throw new AppError('Chat service address rejected.');
  const task=(async()=>{
   let response;const chunks=[];let size=0;
   try{
    response=await this.request(url,{...options,redirect:'error',signal:AbortSignal.any([this.controller.signal,AbortSignal.timeout(15000)])});
    if(response.body){for await(const chunk of response.body){size+=chunk.length;if(size>1024*1024)throw new AppError('Chat service response was too large.',502);chunks.push(Buffer.from(chunk));}}
   }catch(cause){
    if(this.controller.signal.aborted)throw new AppError('The studio is closing.',409);
    if(cause instanceof AppError)throw cause;
    const error=new AppError('The chat service could not be reached.',502);error.retryable=true;throw error;
   }
   let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');if(!value||typeof value!=='object'||Array.isArray(value))throw Error();}catch{throw new AppError('Invalid chat service response.',502);}
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
  const clientSecret=input.clientSecret===undefined||input.clientSecret===''?(old.clientId===clientId?old.clientSecret||'':''):input.clientSecret;
  if(typeof clientSecret!=='string'||clientSecret.length>500||/[\x00-\x20]/.test(clientSecret))throw new AppError('Invalid OAuth application secret.');
  const next={...this.data,settings:{...this.data.settings,[provider]:{clientId,clientSecret}}};
  // A rejected disk write must not replace the active OAuth configuration or
  // cancel a sign-in that still uses the previously saved settings.
  this.save(next);this.data=next;this.cancel(provider);this.versions[provider]++;return this.state();
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
  let url;try{url=new URL(result.value.verification_uri);}catch{throw new AppError('Twitch authorization address rejected.',502);}
  if(url.origin!=='https://www.twitch.tv'||url.pathname!=='/activate'||url.username||url.password||url.port)throw new AppError('Twitch authorization address rejected.',502);
  const expires=result.value.expires_in===undefined?600:result.value.expires_in,interval=result.value.interval===undefined?5:result.value.interval;
  if(!Number.isSafeInteger(expires)||expires<=0||!Number.isSafeInteger(interval)||interval<=0||interval>1800)throw new AppError('Invalid Twitch authorization timing response.',502);
  if(this.versions[provider]!==version)throw new AppError('Authorization was cancelled.',409);
  const pending={deviceCode:result.value.device_code,userCode:String(result.value.user_code||''),version,url:url.href,expires:Date.now()+Math.min(1800,expires)*1000,interval:Math.max(5,interval)*1000};this.pending.set(provider,pending);
  this.scheduleDevice(pending);return this.state();
 }
 scheduleDevice(pending){pending.timer=setTimeout(()=>{void this.pollDevice(pending).catch(()=>{if(this.pending.get('Twitch')===pending)this.pending.delete('Twitch');});},Math.min(pending.interval,Math.max(0,pending.expires-Date.now()))).unref();}
 async pollDevice(pending){
  if(this.pending.get('Twitch')!==pending)return;
  if(Date.now()>=pending.expires||this.controller.signal.aborted){this.cancel('Twitch');return;}
  const {clientId}=this.data.settings.Twitch;
  let result;
  try{result=await this.form('https://id.twitch.tv/oauth2/token',{client_id:clientId,device_code:pending.deviceCode,scopes:TWITCH_SCOPES,grant_type:'urn:ietf:params:oauth:grant-type:device_code'});}
  catch(error){
   if(this.pending.get('Twitch')!==pending||this.controller.signal.aborted)return;
   if(!error.retryable)throw error;
   pending.interval=Math.min(1800000,pending.interval*2);this.scheduleDevice(pending);return;
  }
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
  const {accessToken,refreshToken,expires}=readTokens(tokens);
  let id,name;
  if(provider==='Twitch'){
   const checked=await this.http('https://id.twitch.tv/oauth2/validate',{headers:{Authorization:'OAuth '+tokens.access_token}}),v=checked.value;
   if(!checked.ok)throw new AppError(checked.status===401?'Reconnect your Twitch account.':'Twitch account validation is temporarily unavailable.',checked.status===401?401:502);
   if(v.client_id!==this.data.settings.Twitch.clientId||typeof v.user_id!=='string'||!v.user_id||v.user_id.length>1000||!Array.isArray(v.scopes)||!TWITCH_SCOPES.split(' ').every(s=>v.scopes.includes(s)))throw new AppError('Twitch did not grant permission to read and reply to chat.',403);
   id=v.user_id;name=typeof v.login==='string'?v.login.slice(0,150):'Twitch';
  }else{
   const checked=await this.http('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',{headers:{Authorization:'Bearer '+tokens.access_token}}),item=checked.value.items?.[0];
   if(!checked.ok||typeof item?.id!=='string'||!item.id||item.id.length>1000)throw new AppError('No authorized YouTube channel was found.',403);id=item.id;name=typeof item.snippet?.title==='string'?item.snippet.title.slice(0,150):'YouTube';
  }
  const old=this.data.accounts[provider];
  if(this.versions[provider]!==version||this.controller.signal.aborted)throw new AppError('Authorization was cancelled.',409);
  const account={id,name,accessToken,refreshToken:refreshToken||(old?.id===id?old.refreshToken||'':''),expires,validated:Date.now()};
  const next={...this.data,accounts:{...this.data.accounts,[provider]:account}};
  // Publish the identity only after it is durable. These synchronous steps
  // leave no opportunity for a pending reply to observe a new identity with
  // the old authorization generation when persistence fails.
  this.save(next);this.data=next;
  if(old&&old.id!==id){this.versions[provider]++;this.onSessionEnd(provider);}
  if(provider==='Twitch')this.scheduleValidation();
 }
 async token(provider){
  let account=this.data.accounts[provider];if(!account)throw new AppError('Authorize your '+provider+' account first.',401);
  if(account.expires>Date.now()+60000&&(provider!=='Twitch'||account.validated>Date.now()-3600000))return account;
  if(this.refreshing.has(provider))return this.refreshing.get(provider);
  const version=this.versions[provider];
  const task=(async()=>{
   if(provider==='Twitch'&&account.expires>Date.now()+60000){await this.accept(provider,{access_token:account.accessToken,...(account.refreshToken?{refresh_token:account.refreshToken}:{}),expires_in:Math.floor((account.expires-Date.now())/1000)},version);return this.data.accounts[provider];}
   if(!account.refreshToken)throw new AppError('Reconnect your '+provider+' account.',401);
   const setup=this.data.settings[provider],result=await this.form(provider==='YouTube'?'https://oauth2.googleapis.com/token':'https://id.twitch.tv/oauth2/token',{client_id:setup.clientId,...(setup.clientSecret?{client_secret:setup.clientSecret}:{}),refresh_token:account.refreshToken,grant_type:'refresh_token'});
   if(!result.ok){const invalid=result.status===400||result.status===401;throw new AppError(invalid?'Reconnect your '+provider+' account.':'Account renewal is temporarily unavailable.',invalid?401:502);}
   if(provider==='Twitch'){
    const credentials=readTokens(result.value);
    if(this.versions[provider]!==version||this.data.accounts[provider]!==account||this.controller.signal.aborted)throw new AppError('Authorization was cancelled.',409);
    // Device-flow refresh tokens are single-use. Keep the rotated pair if validation is temporarily unavailable.
    account={...account,...credentials,refreshToken:credentials.refreshToken||'',validated:0};this.data.accounts[provider]=account;this.save();
   }
   await this.accept(provider,result.value,version);return this.data.accounts[provider];
  })();this.refreshing.set(provider,task);try{return await task;}catch(error){if(provider==='Twitch'&&(error.status===401||error.status===403))this.invalidate(provider,account,version);throw error;}finally{this.refreshing.delete(provider);}
 }
 invalidate(provider,account,version){
  if(this.data.accounts[provider]!==account||this.versions[provider]!==version||this.controller.signal.aborted)return;
  if(provider==='Twitch'){clearTimeout(this.validationTimer);this.validationTimer=null;}
  delete this.data.accounts[provider];
  // Keep the one-time state of a replacement sign-in while ending its old session.
  if(this.pending.get(provider)?.version!==version)this.versions[provider]++;
  // Revocation must close existing sockets even if the disk cannot record it.
  // Keep the rejected credentials removed in this running session.
  try{this.save();}finally{this.onSessionEnd(provider);}
 }
 scheduleValidation(delay=3600000){
  clearTimeout(this.validationTimer);this.validationTimer=null;
  if(!this.clock||this.controller.signal.aborted||!this.data.accounts.Twitch)return;
  this.validationTimer=setTimeout(()=>{this.validationTimer=null;this.validationTask=this.validateSession().catch(()=>{}).finally(()=>{this.validationTask=null;});},delay).unref();
 }
 async validateSession(){
  const account=this.data.accounts.Twitch,version=this.versions.Twitch;if(!account||this.controller.signal.aborted)return;
  let retry=false;
  try{await this.token('Twitch');}
  catch(error){
   if(this.controller.signal.aborted)return;
   if(error.status===401||error.status===403){this.invalidate('Twitch',account,version);if(!this.data.accounts.Twitch)return;}
   retry=true;
  }
  if(!this.validationTimer)this.scheduleValidation(retry?60000:3600000);
 }
 cancel(provider){const pending=this.pending.get(provider);if(pending?.timer)clearTimeout(pending.timer);this.pending.delete(provider);}
 disconnect(provider){if(!['YouTube','Twitch'].includes(provider))throw new AppError('Unsupported chat provider.');this.cancel(provider);if(provider==='Twitch'){clearTimeout(this.validationTimer);this.validationTimer=null;}this.versions[provider]++;delete this.data.accounts[provider];this.save();}
 async shutdown(){this.controller.abort();clearTimeout(this.validationTimer);this.validationTimer=null;this.cancel('YouTube');this.cancel('Twitch');await Promise.allSettled([...this.operations,...this.refreshing.values(),...(this.validationTask?[this.validationTask]:[])]);}
}
