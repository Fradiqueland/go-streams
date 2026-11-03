import crypto from 'node:crypto';
import {AppError} from './errors.mjs';
import {ChatAuth} from './chat-auth.mjs';

const supported=['YouTube','Twitch'];
export class UnifiedChat {
 constructor(studio,options={}){
  this.studio=studio;this.auth=new ChatAuth(studio,{...options,onSessionEnd:provider=>{for(const c of this.connections.values())if(c.platform===provider)this.disconnect(c.id);}});this.connections=new Map();this.messages=[];this.seen=new Set();this.sends=new Map();this.socketFactory=options.socketFactory||((url)=>new WebSocket(url));this.closed=false;
 }
 state(){return {accounts:this.auth.state(),connections:[...this.connections.values()].map(({socket,sockets,timer,seen,...c})=>c),messages:this.messages,capabilities:this.studio.store.data.channels.map(c=>({channelId:c.id,platform:c.platform,supported:supported.includes(c.platform)}))};}
 add(connection,item){
  if(this.closed||this.connections.get(connection.id)!==connection||connection.status==='disconnected')return;
  if(typeof item.remoteId!=='string'||!item.remoteId||item.remoteId.length>1000)return;
  const key=connection.id+':'+item.remoteId;if(this.seen.has(key))return;
  this.seen.add(key);this.messages.push({id:crypto.randomUUID(),connectionId:connection.id,channelId:connection.channelId,channelName:connection.name,platform:connection.platform,author:String(item.author||'Viewer').slice(0,150),text:String(item.text||'').slice(0,2000),time:item.time||new Date().toISOString(),remoteId:item.remoteId,own:item.own===true});
  while(this.messages.length>500){const old=this.messages.shift();this.seen.delete(old.connectionId+':'+old.remoteId);}
 }
 async api(provider,path,{method='GET',body,validate}={}){
  const account=await this.auth.token(provider),authorizationVersion=this.auth.versions[provider],origin=provider==='YouTube'?'https://www.googleapis.com/youtube/v3/':'https://api.twitch.tv/helix/';
  validate?.();
  if(!/^[a-zA-Z]/.test(path))throw new AppError('Invalid chat API path.');
  const headers={Authorization:'Bearer '+account.accessToken,...(provider==='Twitch'?{'Client-Id':this.auth.data.settings.Twitch.clientId}:{}),...(body?{'Content-Type':'application/json'}:{})};
  const response=await this.auth.http(origin+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})});
  if(!response.ok){
   if(provider==='Twitch'&&response.status===401)this.auth.invalidate(provider,account,authorizationVersion);
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
  for(const message of this.messages)if(message.connectionId===channel.id)this.seen.delete(message.connectionId+':'+message.remoteId);
  this.messages=this.messages.filter(message=>message.connectionId!==channel.id);
  const connection={id:channel.id,channelId:channel.id,name:channel.name,platform:channel.platform,status:'connecting',error:'',resource:String(input.resource||'').trim(),lastMessage:null};
  this.connections.set(connection.id,connection);
  const authorizationVersion=this.auth.versions[channel.platform];
  const validateConnection=()=>{if(this.closed||this.connections.get(connection.id)!==connection||this.auth.versions[channel.platform]!==authorizationVersion)throw new AppError('The chat connection or account authorization was cancelled or changed.',409);};
  try{
   if(channel.platform==='YouTube'){
    let videoId=connection.resource;
    if(!/^[\w-]{11}$/.test(videoId)){
     let url;try{url=new URL(videoId);}catch{}
     if(url?.protocol==='https:'&&!url.username&&!url.password&&!url.port){if(['youtube.com','www.youtube.com'].includes(url.hostname))videoId=url.pathname==='/watch'?url.searchParams.get('v'): /^\/(?:live|embed)\/([\w-]{11})\/?$/.exec(url.pathname)?.[1];else if(url.hostname==='youtu.be')videoId=url.pathname.slice(1);}
    }
    if(!/^[\w-]{11}$/.test(videoId))throw new AppError('Enter the YouTube live video URL or its 11-character video ID.');
    const result=await this.api('YouTube','videos?part=liveStreamingDetails&id='+videoId,{validate:validateConnection});validateConnection();
    connection.chatId=result.items?.[0]?.liveStreamingDetails?.activeLiveChatId;
    if(!connection.chatId)throw new AppError('This YouTube video does not have an active live chat.');
    await this.pollYouTube(connection);
    validateConnection();if(connection.status!=='connected')throw new AppError(connection.error||'This YouTube live chat has ended.',502);
   }else{
    const login=connection.resource.replace(/^https:\/\/(?:www\.)?twitch\.tv\//,'').replace(/\/$/,'').toLowerCase();
    if(!/^[a-z0-9_]{3,25}$/.test(login))throw new AppError('Enter the Twitch channel name or channel URL.');
    const result=await this.api('Twitch','users?login='+encodeURIComponent(login),{validate:validateConnection});validateConnection();
    connection.broadcasterId=result.data?.[0]?.id;if(!connection.broadcasterId)throw new AppError('Twitch channel was not found.');
    this.openTwitch(connection);
   }
   validateConnection();return this.state();
  }catch(error){if(this.connections.get(connection.id)===connection){clearTimeout(connection.timer);this.closeTwitch(connection);connection.status='error';connection.error=error instanceof AppError?error.message:'Chat connection failed.';}throw error;}
 }
 async pollYouTube(c){
  if(this.closed||this.connections.get(c.id)!==c||c.status==='disconnected')return;
  const authorizationVersion=this.auth.versions.YouTube;
  const validate=()=>{if(this.closed||this.connections.get(c.id)!==c||c.status==='disconnected'||this.auth.versions.YouTube!==authorizationVersion)throw new AppError('The chat connection or account authorization was cancelled or changed.',409);};
  try{
   const query=new URLSearchParams({part:'snippet,authorDetails',liveChatId:c.chatId,maxResults:'200',...(c.pageToken?{pageToken:c.pageToken}:{})});
   const result=await this.api('YouTube','liveChat/messages?'+query,{validate});validate();
   const interval=result.pollingIntervalMillis===undefined?5000:result.pollingIntervalMillis;
   if(!Number.isSafeInteger(interval)||interval<0||interval>2147483647||result.items!==undefined&&!Array.isArray(result.items))throw new AppError('Invalid YouTube chat polling response.',502);
   for(const message of result.items||[]){if(message.snippet?.displayMessage)this.add(c,{remoteId:message.id,author:message.authorDetails?.displayName,text:message.snippet.displayMessage,time:message.snippet.publishedAt,own:message.authorDetails?.channelId===this.auth.data.accounts.YouTube?.id});}
   c.pageToken=result.nextPageToken;c.status='connected';c.error='';c.pollingIntervalMillis=Math.max(2000,interval);
   if(result.offlineAt){c.status='ended';return;}
   c.timer=setTimeout(()=>{void this.pollYouTube(c);},c.pollingIntervalMillis).unref();
  }catch(error){if(this.connections.get(c.id)!==c)return;c.status='error';c.error=error instanceof AppError?error.message:'YouTube chat disconnected.';}
 }
 openTwitch(c,url='wss://eventsub.wss.twitch.tv/ws',previous=null){
  const parsed=new URL(url);if(parsed.protocol!=='wss:'||parsed.hostname!=='eventsub.wss.twitch.tv'||parsed.port||parsed.username||parsed.password)throw new AppError('Twitch reconnection address rejected.');
  const socket=this.socketFactory(url),sessionState={timer:null,keepalive:c.sockets?.get(previous)?.keepalive||10,welcomed:false,reconnecting:false};c.socket=socket;c.sockets??=new Map();c.sockets.set(socket,sessionState);
  const alive=()=>!this.closed&&this.connections.get(c.id)===c&&c.sockets.has(socket);
  const fail=message=>{if(alive()){c.status='error';c.error=message;this.closeTwitch(c);}};
  const deadline=seconds=>{clearTimeout(sessionState.timer);sessionState.timer=setTimeout(()=>fail('Twitch chat connection timed out. Reconnect the chat.'),seconds*1000+5000).unref();};
  deadline(previous?30:20);
  socket.addEventListener('message',event=>{
   if(!alive())return;
   void(async()=>{
    if(typeof event.data!=='string'||event.data.length>1024*1024)throw Error();
    const data=JSON.parse(event.data),kind=data.metadata?.message_type,session=data.payload?.session;
    if(kind==='session_welcome'){
     if(typeof session?.id!=='string'||!session.id)throw Error();
     if(sessionState.welcomed){if(sessionState.sessionId!==session.id)throw Error();return;}
     sessionState.welcomed=true;sessionState.sessionId=session.id;
     sessionState.keepalive=Math.min(600,Math.max(10,Number(session.keepalive_timeout_seconds)||sessionState.keepalive));deadline(sessionState.keepalive);
     if(!previous){const account=await this.auth.token('Twitch');if(!alive())return;const subscribed=await this.api('Twitch','eventsub/subscriptions',{method:'POST',validate:()=>{if(!alive())throw new AppError('Chat disconnected.',409);},body:{type:'channel.chat.message',version:'1',condition:{broadcaster_user_id:c.broadcasterId,user_id:account.id},transport:{method:'websocket',session_id:session.id}}});const subscription=subscribed.data?.[0];if(typeof subscription?.id!=='string'||!subscription.id||subscription.status!=='enabled')throw new AppError('Twitch did not enable this chat subscription.',502);}
     if(!alive())return;c.status='connected';c.error='';if(previous)this.closeTwitch(c,previous);
    }else if(kind==='session_keepalive'){if(!sessionState.reconnecting)deadline(sessionState.keepalive);}
    else if(kind==='session_reconnect'){if(c.socket===socket&&!sessionState.reconnecting){sessionState.reconnecting=true;deadline(30);this.openTwitch(c,session.reconnect_url,socket);}}
    else if(kind==='revocation')fail('Twitch chat permission was revoked. Reconnect the account.');
    else if(kind==='notification'){
     if(!sessionState.reconnecting)deadline(sessionState.keepalive);const message=data.payload?.event;
     if(data.payload?.subscription?.type==='channel.chat.message'&&message?.broadcaster_user_id===c.broadcasterId)this.add(c,{remoteId:message.message_id,author:message.chatter_user_name,text:message.message?.text,time:data.metadata.message_timestamp,own:message.chatter_user_id===this.auth.data.accounts.Twitch?.id});
    }
   })().catch(()=>fail('Twitch chat could not be connected. Check account permissions.'));
  });
  const closed=()=>{if(alive()){if(c.socket!==socket&&c.sockets.size>1){this.closeTwitch(c,socket);return;}fail('Twitch chat disconnected. Reconnect the chat.');}};
  socket.addEventListener('error',closed);socket.addEventListener('close',closed);
 }
 closeTwitch(c,only){for(const [socket,state] of c.sockets||[]){if(only&&socket!==only)continue;clearTimeout(state.timer);c.sockets.delete(socket);try{socket.close();}catch{}}}
 async send(input){
  if(input.confirmed!==true)throw new AppError('Confirm sending this chat message.');
  if(!/^[a-f0-9-]{36}$/i.test(input.requestId||''))throw new AppError('A unique message request ID is required.');
  const c=this.connections.get(input.connectionId);if(!c||c.status!=='connected')throw new AppError('Connect this chat before replying.',409);
  if(typeof input.text!=='string'||!input.text.trim()||[...input.text].length>(c.platform==='YouTube'?200:500)||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(input.text))throw new AppError('Enter a message within the platform character limit.');
  const fingerprint=JSON.stringify([c.id,c.chatId||c.broadcasterId,input.text,input.replyTo||null]),old=this.sends.get(input.requestId);
  if(old){if(old.fingerprint!==fingerprint)throw new AppError('A message request ID cannot be reused for different content.',409);return old.task;}
  if(c.sending)throw new AppError('Wait for the pending reply before sending another message.',409);
  const parent=input.replyTo?this.messages.find(m=>m.id===input.replyTo&&m.connectionId===c.id):null;
  if(input.replyTo&&!parent)throw new AppError('The message to reply to is no longer available.');
  if(c.lastSent&&Date.now()-c.lastSent<2000)throw new AppError('Wait before sending another message.',429);
  c.sending=true;
  const authorizationVersion=this.auth.versions[c.platform];
  const task=(async()=>{
   try{
    const validate=()=>{if(this.closed||this.connections.get(c.id)!==c||c.status!=='connected'||this.auth.versions[c.platform]!==authorizationVersion)throw new AppError('The chat or account authorization changed before this reply could be sent.',409);};
    const account=await this.auth.token(c.platform);validate();let id;
    if(c.platform==='YouTube'){
     const message=parent?'@'+parent.author+' '+input.text:input.text;
     if([...message].length>200)throw new AppError('The reply, including the viewer mention, exceeds 200 characters.');
     const result=await this.api('YouTube','liveChat/messages?part=snippet',{method:'POST',validate,body:{snippet:{liveChatId:c.chatId,type:'textMessageEvent',textMessageDetails:{messageText:message}}}});id=result?.id;
    }else{
     const result=await this.api('Twitch','chat/messages',{method:'POST',validate,body:{broadcaster_id:c.broadcasterId,sender_id:account.id,message:input.text,...(parent?{reply_parent_message_id:parent.remoteId}:{})}}),sent=result.data?.[0];
     if(sent?.is_sent!==true)throw new AppError('Twitch did not send this message. Check moderation and chat restrictions.',409);id=sent.message_id;
    }
    if(typeof id!=='string'||!id.trim()||id.length>1000)throw new AppError('The platform did not confirm delivery. Check its chat before retrying.',502);
    c.lastSent=Date.now();this.add(c,{remoteId:id,author:account.name,text:(parent&&c.platform==='YouTube'?'@'+parent.author+' ':'')+input.text,own:true});return {ok:true,messageId:id};
   }finally{c.sending=false;}
  })();
  this.sends.set(input.requestId,{fingerprint,task});while(this.sends.size>100)this.sends.delete(this.sends.keys().next().value);
  return task;
 }
 disconnect(id,{clearMessages=false}={}){const c=this.connections.get(id);if(c){c.status='disconnected';clearTimeout(c.timer);this.connections.delete(id);this.closeTwitch(c);}if(clearMessages){for(const message of this.messages)if(message.connectionId===id)this.seen.delete(message.connectionId+':'+message.remoteId);this.messages=this.messages.filter(message=>message.connectionId!==id);}}
 syncChannel(id){const c=this.connections.get(id),channel=this.studio.store.data.channels.find(item=>item.id===id);if(!channel||c&&c.platform!==channel.platform||this.messages.some(message=>message.connectionId===id&&message.platform!==channel.platform)){this.disconnect(id,{clearMessages:true});return;}if(c)c.name=channel.name;for(const message of this.messages)if(message.connectionId===id)message.channelName=channel.name;}
 disconnectAccount(provider){for(const c of this.connections.values())if(c.platform===provider)this.disconnect(c.id);this.auth.disconnect(provider);}
 async shutdown(){this.closed=true;for(const id of this.connections.keys())this.disconnect(id);await this.auth.shutdown();await Promise.allSettled([...this.sends.values()].map(s=>s.task));this.messages=[];this.seen.clear();}
}
