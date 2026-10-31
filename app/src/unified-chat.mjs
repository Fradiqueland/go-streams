import crypto from 'node:crypto';
import {AppError} from './errors.mjs';
import {ChatAuth} from './chat-auth.mjs';

const supported=['YouTube','Twitch'];
export class UnifiedChat {
 constructor(studio,options={}){
  this.studio=studio;this.auth=new ChatAuth(studio,options);this.connections=new Map();this.messages=[];this.seen=new Set();this.sends=new Map();this.socketFactory=options.socketFactory||((url)=>new WebSocket(url));this.closed=false;
 }
 state(){return {accounts:this.auth.state(),connections:[...this.connections.values()].map(({socket,timer,seen,...c})=>c),messages:this.messages,capabilities:this.studio.store.data.channels.map(c=>({channelId:c.id,platform:c.platform,supported:supported.includes(c.platform)}))};}
 add(connection,item){
  if(this.closed||this.connections.get(connection.id)!==connection||connection.status==='disconnected')return;
  const key=connection.id+':'+item.remoteId;if(this.seen.has(key))return;
  this.seen.add(key);this.messages.push({id:crypto.randomUUID(),connectionId:connection.id,channelId:connection.channelId,channelName:connection.name,platform:connection.platform,author:String(item.author||'Viewer').slice(0,150),text:String(item.text||'').slice(0,2000),time:item.time||new Date().toISOString(),remoteId:item.remoteId,own:item.own===true});
  while(this.messages.length>500){const old=this.messages.shift();this.seen.delete(old.connectionId+':'+old.remoteId);}
 }
 async api(provider,path,{method='GET',body}={}){
  const account=await this.auth.token(provider),origin=provider==='YouTube'?'https://www.googleapis.com/youtube/v3/':'https://api.twitch.tv/helix/';
  if(!/^[a-zA-Z]/.test(path))throw new AppError('Invalid chat API path.');
  const headers={Authorization:'Bearer '+account.accessToken,...(provider==='Twitch'?{'Client-Id':this.auth.data.settings.Twitch.clientId}:{}),...(body?{'Content-Type':'application/json'}:{})};
  const response=await this.auth.http(origin+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})});
  if(!response.ok){
   const message=response.status===401?'Account authorization expired. Reconnect the account.':response.status===403?'The platform denied chat access. Check permissions, quota and live chat availability.':response.status===429?'Chat rate limit reached. Wait before trying again.':'The platform rejected the chat request ('+response.status+').';
   throw new AppError(message,response.status===429?429:response.status===401?401:502);
  }
  return response.value;
 }
 async connect(input){
  const channel=this.studio.store.data.channels.find(c=>c.id===input.channelId);
  if(!channel||!supported.includes(channel.platform))throw new AppError('Integrated chat is currently available for YouTube and Twitch. Use the platform producer panel for this destination.');
  if(input.confirmed!==true)throw new AppError('Confirm the account and chat destination.');
  this.disconnect(channel.id);
  const connection={id:channel.id,channelId:channel.id,name:channel.name,platform:channel.platform,status:'connecting',error:'',resource:String(input.resource||'').trim(),lastMessage:null};
  this.connections.set(connection.id,connection);
  try{
   if(channel.platform==='YouTube'){
    let videoId=connection.resource;
    if(!/^[\w-]{11}$/.test(videoId)){
     let url;try{url=new URL(videoId);}catch{}
     if(url?.protocol==='https:'&&!url.username&&!url.password&&!url.port){if(['youtube.com','www.youtube.com'].includes(url.hostname))videoId=url.pathname==='/watch'?url.searchParams.get('v'): /^\/(?:live|embed)\/([\w-]{11})\/?$/.exec(url.pathname)?.[1];else if(url.hostname==='youtu.be')videoId=url.pathname.slice(1);}
    }
    if(!/^[\w-]{11}$/.test(videoId))throw new AppError('Enter the YouTube live video URL or its 11-character video ID.');
    const result=await this.api('YouTube','videos?part=liveStreamingDetails&id='+videoId);
    connection.chatId=result.items?.[0]?.liveStreamingDetails?.activeLiveChatId;
    if(!connection.chatId)throw new AppError('This YouTube video does not have an active live chat.');
    if(this.connections.get(connection.id)!==connection)return this.state();
    await this.pollYouTube(connection);
   }else{
    const login=connection.resource.replace(/^https:\/\/(?:www\.)?twitch\.tv\//,'').replace(/\/$/,'').toLowerCase();
    if(!/^[a-z0-9_]{3,25}$/.test(login))throw new AppError('Enter the Twitch channel name or channel URL.');
    const result=await this.api('Twitch','users?login='+encodeURIComponent(login));
    connection.broadcasterId=result.data?.[0]?.id;if(!connection.broadcasterId)throw new AppError('Twitch channel was not found.');
    if(this.connections.get(connection.id)!==connection)return this.state();
    this.openTwitch(connection);
   }
   return this.state();
  }catch(error){if(this.connections.get(connection.id)===connection){connection.status='error';connection.error=error instanceof AppError?error.message:'Chat connection failed.';}throw error;}
 }
 async pollYouTube(c){
  if(this.closed||this.connections.get(c.id)!==c||c.status==='disconnected')return;
  try{
   const query=new URLSearchParams({part:'snippet,authorDetails',liveChatId:c.chatId,maxResults:'200',...(c.pageToken?{pageToken:c.pageToken}:{})});
   const result=await this.api('YouTube','liveChat/messages?'+query);
   if(this.closed||this.connections.get(c.id)!==c||c.status==='disconnected')return;
   for(const message of result.items||[]){if(message.snippet?.displayMessage)this.add(c,{remoteId:message.id,author:message.authorDetails?.displayName,text:message.snippet.displayMessage,time:message.snippet.publishedAt,own:message.authorDetails?.channelId===this.auth.data.accounts.YouTube?.id});}
   c.pageToken=result.nextPageToken;c.status='connected';c.error='';c.pollingIntervalMillis=Math.max(2000,Number(result.pollingIntervalMillis)||5000);
   if(result.offlineAt){c.status='ended';return;}
   c.timer=setTimeout(()=>{void this.pollYouTube(c);},c.pollingIntervalMillis).unref();
  }catch(error){if(this.connections.get(c.id)!==c)return;c.status='error';c.error=error instanceof AppError?error.message:'YouTube chat disconnected.';}
 }
 openTwitch(c,url='wss://eventsub.wss.twitch.tv/ws',previous=null){
  const parsed=new URL(url);if(parsed.protocol!=='wss:'||parsed.hostname!=='eventsub.wss.twitch.tv'||parsed.username||parsed.password)throw new AppError('Twitch reconnection address rejected.');
  const socket=this.socketFactory(url);c.socket=socket;
  const alive=()=>!this.closed&&this.connections.get(c.id)===c&&c.socket===socket;
  const deadline=seconds=>{clearTimeout(c.timer);c.timer=setTimeout(()=>{if(alive()){c.status='error';c.error='Twitch chat connection timed out. Reconnect the chat.';socket.close();previous?.close();}},Math.max(10,seconds)*1000+5000).unref();};
  deadline(20);
  socket.addEventListener('message',event=>{
   if(!alive())return;
   void(async()=>{
    if(typeof event.data!=='string'||event.data.length>1024*1024)throw Error();
    const data=JSON.parse(event.data),kind=data.metadata?.message_type,session=data.payload?.session;
    if(kind==='session_welcome'){
     deadline(session.keepalive_timeout_seconds||10);
     if(!previous){const account=await this.auth.token('Twitch');await this.api('Twitch','eventsub/subscriptions',{method:'POST',body:{type:'channel.chat.message',version:'1',condition:{broadcaster_user_id:c.broadcasterId,user_id:account.id},transport:{method:'websocket',session_id:session.id}}});}
     if(!alive())return;c.status='connected';c.error='';if(previous)previous.close();
    }else if(kind==='session_keepalive')deadline(20);
    else if(kind==='session_reconnect')this.openTwitch(c,session.reconnect_url,socket);
    else if(kind==='revocation'){c.status='error';c.error='Twitch chat permission was revoked. Reconnect the account.';socket.close();}
    else if(kind==='notification'){
     deadline(20);const message=data.payload?.event;
     if(data.payload?.subscription?.type==='channel.chat.message'&&message?.broadcaster_user_id===c.broadcasterId)this.add(c,{remoteId:message.message_id,author:message.chatter_user_name,text:message.message?.text,time:data.metadata.message_timestamp,own:message.chatter_user_id===this.auth.data.accounts.Twitch?.id});
    }
   })().catch(()=>{if(alive()){c.status='error';c.error='Twitch chat could not be connected. Check account permissions.';socket.close();}});
  });
  const closed=()=>{if(alive()){previous?.close();if(c.status!=='disconnected'){clearTimeout(c.timer);c.status='error';c.error||='Twitch chat disconnected. Reconnect the chat.';}}};
  socket.addEventListener('error',closed);socket.addEventListener('close',closed);
 }
 async send(input){
  if(input.confirmed!==true)throw new AppError('Confirm sending this chat message.');
  if(!/^[a-f0-9-]{36}$/i.test(input.requestId||''))throw new AppError('A unique message request ID is required.');
  const c=this.connections.get(input.connectionId);if(!c||c.status!=='connected')throw new AppError('Connect this chat before replying.',409);
  if(typeof input.text!=='string'||!input.text.trim()||[...input.text].length>(c.platform==='YouTube'?200:500)||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(input.text))throw new AppError('Enter a message within the platform character limit.');
  const fingerprint=JSON.stringify([c.id,input.text,input.replyTo||null]),old=this.sends.get(input.requestId);
  if(old){if(old.fingerprint!==fingerprint)throw new AppError('A message request ID cannot be reused for different content.',409);return old.task;}
  if(c.sending)throw new AppError('Wait for the pending reply before sending another message.',409);
  const parent=input.replyTo?this.messages.find(m=>m.id===input.replyTo&&m.connectionId===c.id):null;
  if(input.replyTo&&!parent)throw new AppError('The message to reply to is no longer available.');
  if(c.lastSent&&Date.now()-c.lastSent<2000)throw new AppError('Wait before sending another message.',429);
  c.sending=true;
  const task=(async()=>{
   try{
    const account=await this.auth.token(c.platform);let id;
    if(c.platform==='YouTube'){
     const message=parent?'@'+parent.author+' '+input.text:input.text;
     if([...message].length>200)throw new AppError('The reply, including the viewer mention, exceeds 200 characters.');
     const result=await this.api('YouTube','liveChat/messages?part=snippet',{method:'POST',body:{snippet:{liveChatId:c.chatId,type:'textMessageEvent',textMessageDetails:{messageText:message}}}});id=result.id;
    }else{
     const result=await this.api('Twitch','chat/messages',{method:'POST',body:{broadcaster_id:c.broadcasterId,sender_id:account.id,message:input.text,...(parent?{reply_parent_message_id:parent.remoteId}:{})}}),sent=result.data?.[0];
     if(!sent?.is_sent)throw new AppError('Twitch did not send this message. Check moderation and chat restrictions.',409);id=sent.message_id;
    }
    if(!id)throw new AppError('The platform did not confirm delivery. Check its chat before retrying.',502);
    c.lastSent=Date.now();this.add(c,{remoteId:id,author:account.name,text:(parent&&c.platform==='YouTube'?'@'+parent.author+' ':'')+input.text,own:true});return {ok:true,messageId:id};
   }finally{c.sending=false;}
  })();
  this.sends.set(input.requestId,{fingerprint,task});while(this.sends.size>100)this.sends.delete(this.sends.keys().next().value);
  return task;
 }
 disconnect(id){const c=this.connections.get(id);if(!c)return;c.status='disconnected';clearTimeout(c.timer);c.socket?.close();this.connections.delete(id);}
 disconnectAccount(provider){for(const c of this.connections.values())if(c.platform===provider)this.disconnect(c.id);this.auth.disconnect(provider);}
 async shutdown(){this.closed=true;for(const id of this.connections.keys())this.disconnect(id);await this.auth.shutdown();await Promise.allSettled([...this.sends.values()].map(s=>s.task));this.messages=[];this.seen.clear();}
}
